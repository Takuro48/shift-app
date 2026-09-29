"""Google API / Anthropic クライアントを模したオブジェクトで、ラッパーの呼び出し内容を検証する。"""
import json
from datetime import date
from types import SimpleNamespace

from conftest import make_pdf
from drive_service import DriveService
from invoice_parser import ClaudeInvoiceExtractor, parse_invoice
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


class FakeMessages:
    def __init__(self, content, stop_reason="end_turn"):
        self.content = content
        self.stop_reason = stop_reason
        self.kwargs = None

    def create(self, **kw):
        self.kwargs = kw
        return SimpleNamespace(stop_reason=self.stop_reason,
                               content=[SimpleNamespace(type="text", text=self.content)])


def _extract(content, pdf_text, pdf_bytes=b"default", stop_reason="end_turn"):
    msgs = FakeMessages(content, stop_reason)
    client = SimpleNamespace(beta=SimpleNamespace(messages=msgs))
    ext = parse_invoice(
        ClaudeInvoiceExtractor("k", "m", client=client),
        email_subject="請求書", email_sender="a", email_body="振込先: B銀行", received_date=date(2026, 9, 29),
        pdf_filename="x.pdf", pdf_text=pdf_text,
        pdf_bytes=make_pdf("x") if pdf_bytes == b"default" else pdf_bytes,
    )
    return ext, msgs.kwargs


def test_claude_extractor_sends_pdf_document_and_schema():
    ext, kw = _extract(json.dumps({"is_invoice": True, "confidence": 0.9, "amount_total": 1100}), "請求書 1,100円")
    assert ext.amount_total == 1100
    assert kw["model"] == "m" and kw["system"].startswith("あなたは日本企業向けの請求書解析AI")
    fmt = kw["output_config"]["format"]
    assert fmt["type"] == "json_schema" and fmt["schema"]["additionalProperties"] is False
    assert set(fmt["schema"]["required"]) >= {"is_invoice", "confidence", "amount_total", "due_date"}
    assert kw["fallbacks"] == "default" and kw["betas"] == ["server-side-fallback-2026-07-01"]
    doc, text = kw["messages"][0]["content"]
    assert doc["type"] == "document" and doc["source"]["media_type"] == "application/pdf"
    assert "振込先: B銀行" in text["text"] and "添付のPDFドキュメントを参照" in text["text"]


def test_claude_extractor_uses_text_when_pdf_too_large_or_missing():
    _, kw = _extract("{}", "請求書 本文テキスト", pdf_bytes=None)
    parts = kw["messages"][0]["content"]
    assert len(parts) == 1 and "請求書 本文テキスト" in parts[0]["text"]


def test_claude_extractor_invalid_json():
    import pytest
    with pytest.raises(ValueError):
        _extract("not json", "text")


def test_claude_extractor_refusal():
    import pytest
    with pytest.raises(ValueError, match="拒否"):
        _extract("", "text", stop_reason="refusal")
