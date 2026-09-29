import base64
from datetime import date
from zoneinfo import ZoneInfo

import pytest
from pydantic import ValidationError

from conftest import make_encrypted_pdf, make_pdf
from detector import excluded_document_type, score_email, score_filename, score_pdf_text
from drive_service import build_invoice_filename, sanitize_filename_part, with_suffix_number
from gmail_service import build_search_queries, parse_message
from invoice_parser import extract_pdf_text
from models import SHEET_HEADERS, InvoiceExtraction, InvoiceRecord, Status
from processed_store import ProcessedStore
from sheets_service import SheetIndex


# ---- 判定スコア -------------------------------------------------------

def test_scores():
    assert score_email("【ご請求書】9月分", "お振込をお願いします") == 5
    assert score_email("打ち合わせの件", "よろしくお願いします") == 0
    assert score_filename("請求書_202609.pdf") == 3
    assert score_filename("INVOICE-1.PDF") == 3
    assert score_filename("資料.pdf") == 0
    assert score_pdf_text("請求書\n振込先 みずほ銀行") == 3


def test_excluded_document_type():
    assert excluded_document_type("見積書_A社.pdf", "") == "見積書"
    assert excluded_document_type("doc.pdf", "御見積書\n金額") is not None
    assert excluded_document_type("請求書.pdf", "請求書\n見積書番号: 1") is None
    assert excluded_document_type("請求書_見積書対応分.pdf", "") is None


# ---- AI出力のスキーマ検証 -----------------------------------------------

def test_extraction_normalizes_values():
    ext = InvoiceExtraction.model_validate({
        "confidence": "0.9", "vendor_name": None, "invoice_date": "2026/9/5",
        "due_date": "2026年10月31日", "amount_total": "¥110,000", "tax_amount": "10,000円",
        "is_invoice": "true",
    })
    assert ext.invoice_date == date(2026, 9, 5)
    assert ext.due_date == date(2026, 10, 31)
    assert ext.amount_total == 110000 and ext.tax_amount == 10000
    assert ext.vendor_name == "" and ext.is_invoice is True and ext.confidence == 0.9


def test_extraction_invalid_values_become_review_reasons():
    ext = InvoiceExtraction.model_validate({"due_date": "来月末", "amount_total": "約10万円", "confidence": 5})
    assert ext.due_date is None and ext.amount_total is None
    assert ext.confidence == 1.0
    assert len(ext.review_reasons) == 2


def test_extraction_rejects_non_object():
    with pytest.raises(ValidationError):
        InvoiceExtraction.model_validate(["not", "a", "dict"])


# ---- Drive ファイル名 ---------------------------------------------------

def test_filename():
    d = date(2026, 9, 29)
    assert build_invoice_filename(d, "株式会社サンプル", 110000, "INV-1234") == "2026-09-29_株式会社サンプル_110000_INV-1234.pdf"
    assert build_invoice_filename(d, "株式会社サンプル", 110000, "") == "2026-09-29_株式会社サンプル_110000.pdf"
    assert build_invoice_filename(d, 'A/B:C*D?"E<F>G|H\\', None, "No/1") == "2026-09-29_ABCDEFGH_No1.pdf"
    assert build_invoice_filename(d, "", None, "") == "2026-09-29_取引先不明.pdf"
    assert sanitize_filename_part("  a\nb  ") == "ab"
    assert with_suffix_number("x.pdf", 2) == "x_2.pdf"


# ---- PDF テキスト抽出 ---------------------------------------------------

def test_pdf_text_extraction():
    assert "INVOICE 110000" in extract_pdf_text(make_pdf("INVOICE 110000")).text


def test_pdf_password_detected():
    r = extract_pdf_text(make_encrypted_pdf())
    assert r.encrypted and r.text == ""


def test_pdf_broken():
    r = extract_pdf_text(b"not a pdf")
    assert r.error and not r.encrypted


# ---- Gmail ------------------------------------------------------------

def _b64(s: bytes) -> str:
    return base64.urlsafe_b64encode(s).decode().rstrip("=")


def test_parse_message():
    raw = {
        "id": "m1", "threadId": "t1", "internalDate": "1790643600000",
        "payload": {
            "mimeType": "multipart/mixed",
            "headers": [{"name": "Subject", "value": "請求書"}, {"name": "From", "value": "経理 <a@example.com>"}],
            "parts": [
                {"mimeType": "multipart/alternative", "parts": [
                    {"mimeType": "text/html", "body": {"data": _b64("<p>HTML本文</p>".encode())}},
                ]},
                {"mimeType": "application/pdf", "filename": "請求書.pdf", "body": {"attachmentId": "att1", "size": 100}},
                {"mimeType": "application/octet-stream", "filename": "b.PDF", "body": {"data": _b64(b"%PDF"), "size": 4}},
            ],
        },
    }
    m = parse_message(raw, ZoneInfo("Asia/Tokyo"))
    assert m.subject == "請求書" and m.sender_name == "経理" and m.body_text == "HTML本文"
    assert [a.filename for a in m.pdf_attachments] == ["請求書.pdf", "b.PDF"]
    assert m.attachments[0].attachment_id == "att1" and m.attachments[1].data == b"%PDF"
    assert m.received_at.tzinfo is not None


def test_search_queries_exclude_own_mail():
    qs = build_search_queries(30)
    assert all("-from:me" in q and "newer_than:30d" in q for q in qs)
    assert "has:attachment filename:pdf" in qs[0]


# ---- 処理済み記録・シート -------------------------------------------------

def test_processed_store_persists(tmp_path):
    p = tmp_path / "data" / "processed_message_ids.json"
    s = ProcessedStore(p)
    s.mark("a", "registered", "2026-09-29 10:00:00")
    s.mark("a", "registered", "2026-09-29 10:00:01")
    s2 = ProcessedStore(p)
    assert "a" in s2 and len(s2) == 1


def test_record_row_matches_headers():
    rec = InvoiceRecord(status=Status.UNPAID, needs_review=False, message_id="m", thread_id="t",
                        registered_at="x", id=1, account_number="0123456", notes=["a", "b"])
    row = rec.to_row()
    assert len(row) == len(SHEET_HEADERS) == 24
    assert row[1] == "未払い" and row[13] == "0123456" and row[17] == "m" and row[23] == "a / b"


def test_sheet_index():
    idx = SheetIndex([["1"] + [""] * 16 + ["m1"], [5] + [""] * 16 + ["m2"], ["x"]])
    assert idx.message_ids == {"m1", "m2"}
    assert idx.next_id() == 6
