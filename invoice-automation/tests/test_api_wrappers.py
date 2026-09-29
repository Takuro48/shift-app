"""Google API / OpenAI クライアントを模したオブジェクトで、ラッパーの呼び出し内容を検証する。"""
import json
from datetime import date
from types import SimpleNamespace

from conftest import make_pdf
from drive_service import DriveService
from invoice_parser import OpenAIInvoiceExtractor, parse_invoice
from models import SHEET_HEADERS
from sheets_service import SheetsService


class Req:
    def __init__(self, result):
        self.result = result

    def execute(self):
        return self.result


class FakeDriveFiles:
    def __init__(self, existing):
        self.existing = existing  # {(name, parent): id}
        self.created = []

    def list(self, q, **kw):
        for (name, parent), fid in self.existing.items():
            if f"name = '{name}'" in q and f"'{parent}' in parents" in q:
                return Req({"files": [{"id": fid, "name": name}]})
        return Req({"files": []})

    def create(self, body, media_body=None, **kw):
        fid = f"new{len(self.created) + 1}"
        self.created.append((body, media_body is not None))
        self.existing[(body["name"], body.get("parents", [""])[0])] = fid
        return Req({"id": fid, "webViewLink": f"https://drive.google.com/file/d/{fid}/view"})


def test_drive_upload_creates_year_month_and_dedupes_name():
    files = FakeDriveFiles({("2026", "root"): "y2026", ("a.pdf", "new1"): "dup"})
    svc = DriveService(SimpleNamespace(files=lambda: files), "root")
    fid, link, name = svc.upload_pdf(b"%PDF", "a.pdf", date(2026, 9, 29))
    # 2026 は既存、09 を新規作成、a.pdf が既にあるので a_2.pdf
    assert files.created[0] == ({"name": "09", "mimeType": "application/vnd.google-apps.folder", "parents": ["y2026"]}, False)
    assert files.created[1] == ({"name": "a_2.pdf", "parents": ["new1"]}, True)
    assert name == "a_2.pdf" and link.endswith("/view")


def test_drive_query_escapes_quotes():
    files = FakeDriveFiles({})
    seen = []
    orig = files.list
    files.list = lambda q, **kw: (seen.append(q), orig(q, **kw))[1]
    DriveService(SimpleNamespace(files=lambda: files), "root").unique_name("f", "O'Neil.pdf")
    assert "name = 'O\\'Neil.pdf'" in seen[0]


class FakeValues:
    def __init__(self, header):
        self.header = header
        self.calls = []

    def get(self, spreadsheetId, range, **kw):
        self.calls.append(("get", range))
        return Req({"values": self.header} if "A1:X1" in range else {"values": [["1"]]})

    def update(self, **kw):
        self.calls.append(("update", kw["range"], kw["body"]["values"]))
        return Req({})

    def append(self, **kw):
        self.calls.append(("append", kw["range"], kw["valueInputOption"], kw["body"]["values"]))
        return Req({})


class FakeSpreadsheets:
    def __init__(self, titles, header):
        self.titles = titles
        self.v = FakeValues(header)
        self.batch = []

    def get(self, **kw):
        return Req({"sheets": [{"properties": {"title": t}} for t in self.titles]})

    def batchUpdate(self, spreadsheetId, body):
        self.batch.append(body)
        return Req({})

    def values(self):
        return self.v


def test_sheets_creates_sheet_and_header():
    ss = FakeSpreadsheets(["Sheet1"], header=[])
    svc = SheetsService(SimpleNamespace(spreadsheets=lambda: ss), "sid", "支払い一覧")
    svc.ensure_sheet()
    assert ss.batch[0]["requests"][0]["addSheet"]["properties"]["title"] == "支払い一覧"
    assert ("update", "'支払い一覧'!A1", [SHEET_HEADERS]) in ss.v.calls


def test_sheets_keeps_existing_header_and_appends_raw():
    ss = FakeSpreadsheets(["支払い一覧"], header=[SHEET_HEADERS])
    svc = SheetsService(SimpleNamespace(spreadsheets=lambda: ss), "sid", "支払い一覧")
    svc.ensure_sheet()
    svc.append_rows([[1, "未払い"]])
    assert not ss.batch and not any(c[0] == "update" for c in ss.v.calls)
    assert ss.v.calls[-1] == ("append", "'支払い一覧'!A1", "RAW", [[1, "未払い"]])


class FakeCompletions:
    def __init__(self, content):
        self.content = content
        self.kwargs = None

    def create(self, **kw):
        self.kwargs = kw
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=self.content))])


def _extract(content, pdf_text):
    comp = FakeCompletions(content)
    client = SimpleNamespace(chat=SimpleNamespace(completions=comp))
    ext = parse_invoice(
        OpenAIInvoiceExtractor("k", "m", client=client),
        email_subject="請求書", email_sender="a", email_body="振込先: B銀行", received_date=date(2026, 9, 29),
        pdf_filename="x.pdf", pdf_text=pdf_text, pdf_bytes=make_pdf("x"),
    )
    return ext, comp.kwargs


def test_openai_extractor_text_pdf():
    ext, kw = _extract(json.dumps({"is_invoice": True, "confidence": 0.9, "amount_total": "1,100"}), "請求書 1,100円")
    assert ext.amount_total == 1100
    assert kw["response_format"] == {"type": "json_object"} and kw["model"] == "m"
    parts = kw["messages"][1]["content"]
    assert len(parts) == 1 and "振込先: B銀行" in parts[0]["text"] and "請求書 1,100円" in parts[0]["text"]


def test_openai_extractor_sends_pdf_when_no_text():
    _, kw = _extract("{}", "")
    parts = kw["messages"][1]["content"]
    assert parts[1]["type"] == "file" and parts[1]["file"]["file_data"].startswith("data:application/pdf;base64,")


def test_openai_extractor_invalid_json():
    import pytest
    with pytest.raises(ValueError):
        _extract("not json", "text")
