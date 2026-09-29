import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from config import Config  # noqa: E402
from gmail_service import Attachment, EmailMessage  # noqa: E402
from logger import setup_logger  # noqa: E402

JST = ZoneInfo("Asia/Tokyo")


def make_pdf(text: str) -> bytes:
    """ASCIIテキスト1行だけの最小PDFを生成する（テスト用）。"""
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
    objs = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R "
        b"/Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objs) + 1, xref)
    return bytes(out)


def make_encrypted_pdf() -> bytes:
    import io
    from pypdf import PdfWriter
    w = PdfWriter()
    w.add_blank_page(width=200, height=200)
    w.encrypt(user_password="secret", owner_password="owner")
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def make_message(mid="m1", subject="請求書送付のご案内", body="請求書をお送りします。お振込をお願いします。",
                 attachments=None, sender="株式会社サンプル <billing@example.com>") -> EmailMessage:
    return EmailMessage(
        id=mid, thread_id=f"t-{mid}", subject=subject, sender=sender,
        received_at=datetime(2026, 9, 29, 10, 0, tzinfo=JST), body_text=body,
        attachments=attachments if attachments is not None else [],
    )


def pdf_attachment(filename="請求書_INV-1234.pdf", text="INVOICE total 110000") -> Attachment:
    data = make_pdf(text)
    return Attachment(filename=filename, mime_type="application/pdf", size=len(data), data=data)


@pytest.fixture
def config(tmp_path) -> Config:
    setup_logger(None)
    return Config(
        anthropic_api_key="test", anthropic_model="test-model", drive_root_folder_id="root",
        spreadsheet_id="sheet", sheet_name="支払い一覧", gmail_account="", drive_scope="file",
        credentials_path=tmp_path / "credentials.json", token_path=tmp_path / "token.json",
        timezone="Asia/Tokyo", confidence_threshold=0.8, scan_days=30, data_dir=tmp_path / "data",
    )
