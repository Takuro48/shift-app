from datetime import date

from conftest import make_encrypted_pdf, make_message, pdf_attachment
from fakes import VALID, FakeDrive, FakeExtractor, FakeGmail, FakeSheets
from gmail_service import Attachment
from models import COL_MESSAGE_ID
from pipeline import InvoicePipeline
from processed_store import ProcessedStore


def make_pipeline(config, messages, *, extractor=None, sheets=None, dry_run=False):
    gmail, drive = FakeGmail(messages), FakeDrive()
    sheets = sheets if sheets is not None else FakeSheets()
    extractor = extractor or FakeExtractor()
    p = InvoicePipeline(config=config, gmail=gmail, drive=drive, sheets=sheets, extractor=extractor,
                        store=ProcessedStore(config.processed_path), dry_run=dry_run)
    return p, gmail, drive, sheets, extractor


def test_registers_invoice(config):
    msg = make_message(attachments=[pdf_attachment()])
    p, _, drive, sheets, _ = make_pipeline(config, [msg])
    results = p.run(30)

    assert [r.outcome for r in results] == ["registered"]
    assert len(sheets.rows) == 1
    row = sheets.rows[0]
    assert row[0] == 1 and row[1] == "未払い" and row[2] is False
    assert row[3] == "2026-10-31" and row[5] == "株式会社サンプル" and row[6] == 110000
    assert row[13] == "0123456"
    assert row[16] == "https://mail.google.com/mail/u/0/#inbox/t-m1"
    assert row[17] == "m1" and row[18] == "t-m1"
    # 請求日で分類・命名
    assert drive.uploads == [("2026-09-25_株式会社サンプル_110000_INV-1234.pdf", date(2026, 9, 25))]
    assert row[15].startswith("https://drive.google.com/")
    assert "m1" in ProcessedStore(config.processed_path)


def test_rerun_does_not_duplicate(config):
    msg = make_message(attachments=[pdf_attachment()])
    p, gmail, drive, sheets, ext = make_pipeline(config, [msg])
    p.run(30)
    # 新しいプロセス（ローカル記録あり）
    p2, _, drive2, _, ext2 = make_pipeline(config, [msg], sheets=sheets)
    assert [r.outcome for r in p2.run(30)] == ["already_processed"]
    assert len(sheets.rows) == 1 and not drive2.uploads and not ext2.calls


def test_sheet_guard_when_local_store_lost(config):
    msg = make_message(attachments=[pdf_attachment()])
    p, _, _, sheets, _ = make_pipeline(config, [msg])
    p.run(30)
    config.processed_path.unlink()
    p2, _, drive2, _, ext2 = make_pipeline(config, [msg], sheets=sheets)
    assert [r.outcome for r in p2.run(30)] == ["already_processed"]
    assert len(sheets.rows) == 1 and not drive2.uploads and not ext2.calls
    assert "m1" in ProcessedStore(config.processed_path)


def test_force_cannot_duplicate_registered(config):
    msg = make_message(attachments=[pdf_attachment()])
    p, _, _, sheets, _ = make_pipeline(config, [msg])
    p.run(30)
    assert p.process_message("m1", force=True).outcome == "already_processed"
    assert len(sheets.rows) == 1


def test_dry_run_writes_nothing(config):
    msg = make_message(attachments=[pdf_attachment()])
    p, _, drive, sheets, _ = make_pipeline(config, [msg], dry_run=True)
    results = p.run(30)
    assert results[0].outcome == "registered"
    rec = results[0].records[0]
    assert rec.vendor_name == "株式会社サンプル" and rec.drive_filename.startswith("2026/09/2026-09-25_")
    assert not drive.uploads and not sheets.rows
    assert not config.processed_path.exists()


def test_not_invoice_email_skipped(config):
    msg = make_message(subject="会議資料", body="資料を添付します",
                       attachments=[pdf_attachment("資料.pdf", "Agenda")])
    p, _, drive, sheets, ext = make_pipeline(config, [msg])
    assert p.run(30)[0].outcome == "not_invoice"
    assert not sheets.rows and not drive.uploads and not ext.calls
    assert "m1" in ProcessedStore(config.processed_path)


def test_only_invoice_registered_when_estimate_attached(config):
    msg = make_message(attachments=[pdf_attachment("見積書.pdf", "Quotation"), pdf_attachment()])
    p, _, drive, sheets, ext = make_pipeline(config, [msg])
    p.run(30)
    assert len(sheets.rows) == 1 and len(ext.calls) == 1
    assert ext.calls[0]["pdf_filename"] == "請求書_INV-1234.pdf"


def test_ai_says_not_invoice(config):
    msg = make_message(attachments=[pdf_attachment()])
    p, _, drive, sheets, _ = make_pipeline(config, [msg], extractor=FakeExtractor({**VALID, "is_invoice": False}))
    assert p.run(30)[0].outcome == "not_invoice"
    assert not sheets.rows and not drive.uploads


def test_multiple_invoice_pdfs(config):
    msg = make_message(attachments=[pdf_attachment("請求書A.pdf"), pdf_attachment("請求書B.pdf")])
    p, _, drive, sheets, _ = make_pipeline(config, [msg])
    p.run(30)
    assert [r[0] for r in sheets.rows] == [1, 2]
    # 同名ファイルは _2 を付与
    assert drive.uploads[1][0].endswith("_INV-1234_2.pdf")


def test_low_confidence_needs_review(config):
    ext = FakeExtractor({**VALID, "confidence": 0.6})
    p, _, _, sheets, _ = make_pipeline(config, [make_message(attachments=[pdf_attachment()])], extractor=ext)
    p.run(30)
    row = sheets.rows[0]
    assert row[1] == "未確認" and row[2] is True and "AI確信度が低い" in row[23]


def test_missing_amount_and_due_date_needs_review(config):
    ext = FakeExtractor({**VALID, "amount_total": None, "due_date": ""})
    p, _, drive, sheets, _ = make_pipeline(config, [make_message(attachments=[pdf_attachment()])], extractor=ext)
    p.run(30)
    row = sheets.rows[0]
    assert row[1] == "未確認" and "金額が取得できない" in row[23] and "支払期限が取得できない" in row[23]
    assert drive.uploads[0][0] == "2026-09-25_株式会社サンプル_INV-1234.pdf"


def test_correction_word_needs_review(config):
    msg = make_message(subject="【再発行】請求書", attachments=[pdf_attachment()])
    p, _, _, sheets, _ = make_pipeline(config, [msg])
    p.run(30)
    assert sheets.rows[0][1] == "未確認" and "再発行" in sheets.rows[0][23]


def test_no_pdf_invoice_email(config):
    msg = make_message(body="今月分のご請求金額は110,000円です。お振込をお願いします。")
    p, _, drive, sheets, ext = make_pipeline(config, [msg])
    p.run(30)
    row = sheets.rows[0]
    assert row[1] == "未確認" and row[2] is True and row[23] == "添付PDFなし"
    assert row[5] == "株式会社サンプル" and not ext.calls and not drive.uploads


def test_zip_attachment(config):
    zip_att = Attachment(filename="請求書.zip", mime_type="application/zip", size=3, data=b"PK")
    p, _, _, sheets, _ = make_pipeline(config, [make_message(attachments=[zip_att])])
    p.run(30)
    assert "ZIP添付" in sheets.rows[0][23]


def test_password_pdf(config):
    data = make_encrypted_pdf()
    att = Attachment(filename="請求書.pdf", mime_type="application/pdf", size=len(data), data=data)
    p, _, drive, sheets, ext = make_pipeline(config, [make_message(attachments=[att])])
    p.run(30)
    row = sheets.rows[0]
    assert row[1] == "未確認" and row[2] is True and "パスワード付きPDF" in row[23]
    assert not ext.calls
    assert drive.uploads == [("2026-09-29_株式会社サンプル.pdf", date(2026, 9, 29))]


def test_ai_failure_leaves_error_row_and_continues(config):
    msgs = [make_message("m1", attachments=[pdf_attachment()]), make_message("m2", attachments=[pdf_attachment()])]
    ext = FakeExtractor(error=RuntimeError("API timeout"))
    p, _, drive, sheets, _ = make_pipeline(config, msgs, extractor=ext)
    results = p.run(30)
    assert [r.outcome for r in results] == ["registered", "registered"]
    assert all(r[1] == "未確認" and "解析失敗" in r[23] for r in sheets.rows)
    assert len(drive.uploads) == 2  # PDF自体はDriveに残す


def test_sheet_failure_is_retried_next_run(config):
    msgs = [make_message("m1", attachments=[pdf_attachment()]), make_message("m2", attachments=[pdf_attachment()])]
    p, _, _, _, _ = make_pipeline(config, msgs, sheets=FakeSheets(fail=True))
    results = p.run(30)
    assert [r.outcome for r in results] == ["error", "error"]  # 1件失敗しても次へ進む
    assert not config.processed_path.exists()
    sheets = FakeSheets()
    p2, _, _, _, _ = make_pipeline(config, msgs, sheets=sheets)
    assert [r.outcome for r in p2.run(30)] == ["registered", "registered"]
    assert [r[COL_MESSAGE_ID] for r in sheets.rows] == ["m1", "m2"]


def test_process_single_message_not_found(config):
    p, _, _, _, _ = make_pipeline(config, [])
    assert p.process_message("nope").outcome == "error"


def test_ids_continue_from_existing_rows(config):
    existing = [[41] + [""] * 23]
    p, _, _, sheets, _ = make_pipeline(config, [make_message(attachments=[pdf_attachment()])],
                                       sheets=FakeSheets(existing))
    p.run(30)
    assert sheets.rows[-1][0] == 42
