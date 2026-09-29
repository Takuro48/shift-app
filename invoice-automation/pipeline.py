"""メール1通ごとの処理: 判定 → PDF取得 → 解析 → Drive保存 → Sheet登録 → 処理済み記録。"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from zoneinfo import ZoneInfo

from config import Config
from detector import (
    AUTO_SCORE, CANDIDATE_SCORE, excluded_document_type, has_correction_words,
    score_email, score_filename, score_pdf_text,
)
from drive_service import build_invoice_filename
from gmail_service import Attachment, EmailMessage, gmail_thread_link
from invoice_parser import InvoiceExtractor, extract_pdf_text, parse_invoice
from logger import get_logger
from models import InvoiceExtraction, InvoiceRecord, Status
from processed_store import ProcessedStore
from sheets_service import SheetIndex


@dataclass
class MessageResult:
    message_id: str
    outcome: str  # registered / not_invoice / already_processed / error
    subject: str = ""
    records: list[InvoiceRecord] = field(default_factory=list)
    detail: str = ""


def review_reasons(ext: InvoiceExtraction, *, threshold: float, score: int, texts: list[str]) -> list[str]:
    """要確認とする理由（仕様書 §11 のうちPhase 1で判定できるもの）。"""
    reasons = list(ext.review_reasons)
    if ext.needs_review and not reasons:
        reasons.append("AIが要確認と判定")
    if ext.confidence < threshold:
        reasons.append(f"AI確信度が低い({ext.confidence:.2f})")
    if not ext.amount_total:
        reasons.append("金額が取得できない")
    if ext.due_date is None:
        reasons.append("支払期限が取得できない")
    if score < AUTO_SCORE:
        reasons.append(f"請求書判定スコアが低い({score}点)")
    if has_correction_words(*texts):
        reasons.append("再発行・訂正・差替の可能性")
    return list(dict.fromkeys(reasons))


class InvoicePipeline:
    def __init__(self, *, config: Config, gmail, drive, sheets, extractor: InvoiceExtractor,
                 store: ProcessedStore, dry_run: bool = False):
        self.config = config
        self.gmail = gmail
        self.drive = drive
        self.sheets = sheets
        self.extractor = extractor
        self.store = store
        self.dry_run = dry_run
        self.tz = ZoneInfo(config.timezone)
        self.log = get_logger()
        self.index = SheetIndex(sheets.read_rows() if sheets else [])

    # ---- 実行単位 -------------------------------------------------------

    def run(self, days: int) -> list[MessageResult]:
        self.log.info("START" + (" (dry-run)" if self.dry_run else ""))
        ids = self.gmail.search_candidates(days)
        self.log.info(f"Gmail search: {len(ids)} messages (last {days} days)")
        results = [self.process_message(mid) for mid in ids]
        counts: dict[str, int] = {}
        for r in results:
            counts[r.outcome] = counts.get(r.outcome, 0) + 1
        self.log.info("Summary " + " ".join(f"{k}={v}" for k, v in sorted(counts.items())))
        self.log.info("DONE")
        return results

    def process_message(self, message_id: str, force: bool = False) -> MessageResult:
        """1通を処理する。例外はここで止め、全体処理は継続させる（仕様書 §19）。"""
        try:
            if message_id in self.index.message_ids:
                # Sheetに登録済み（ローカル記録が消えた場合の二重登録防止）
                if message_id not in self.store and not self.dry_run:
                    self.store.mark(message_id, "registered", self._now_str(), "sheet")
                return MessageResult(message_id, "already_processed", detail="支払い一覧に登録済み")
            if message_id in self.store and not force:
                return MessageResult(message_id, "already_processed")

            msg = self.gmail.get_message(message_id)
            self.log.info(f"Gmail message detected {message_id} subject=\"{msg.subject}\"")
            records = self._build_records(msg)

            if records:
                if not self.dry_run:
                    self.sheets.append_rows([r.to_row() for r in records])
                    self.log.info(f"Added Sheet {len(records)} row(s) message_id={message_id}")
                self.index.message_ids.add(message_id)
            outcome = "registered" if records else "not_invoice"
            if not self.dry_run:
                self.store.mark(message_id, outcome, self._now_str())
            return MessageResult(message_id, outcome, msg.subject, records)
        except Exception as e:
            self.log.error(f'message_id={message_id} reason="{e}"', exc_info=self.log.isEnabledFor(10))
            return MessageResult(message_id, "error", detail=str(e))

    # ---- 1通の中身 -----------------------------------------------------

    def _build_records(self, msg: EmailMessage) -> list[InvoiceRecord]:
        email_score = score_email(msg.subject, msg.body_text)
        pdfs = msg.pdf_attachments
        if not pdfs:
            if email_score < CANDIDATE_SCORE:
                self.log.info(f"Skipped not invoice (score={email_score}) {msg.id}")
                return []
            note = "ZIP添付（Version 1では未対応）" if msg.zip_attachments else "添付PDFなし"
            self.log.info(f"Invoice email without PDF {msg.id}: {note}")
            return [self._base_record(msg, notes=[note])]

        records = []
        for att in pdfs:
            rec = self._process_pdf(msg, att, email_score)
            if rec:
                records.append(rec)
        if not records:
            self.log.info(f"Skipped not invoice {msg.id}")
        return records

    def _process_pdf(self, msg: EmailMessage, att: Attachment, email_score: int) -> InvoiceRecord | None:
        data = self.gmail.download_attachment(msg, att)
        self.log.info(f"PDF downloaded {att.filename} ({len(data)} bytes)")
        pdf = extract_pdf_text(data)
        base_score = email_score + score_filename(att.filename)

        if pdf.encrypted:
            if base_score < CANDIDATE_SCORE:
                self.log.info(f"Skipped password PDF (score={base_score}) {att.filename}")
                return None
            rec = self._base_record(msg, att, notes=["パスワード付きPDF"])
            self._upload(rec, data, msg.received_at.date())
            return rec

        score = base_score + score_pdf_text(pdf.text)
        if score < CANDIDATE_SCORE:
            self.log.info(f"Skipped not invoice PDF (score={score}) {att.filename}")
            return None
        excluded = excluded_document_type(att.filename, pdf.text)
        if excluded:
            self.log.info(f"Skipped {excluded} {att.filename}")
            return None

        try:
            ext = parse_invoice(
                self.extractor,
                email_subject=msg.subject, email_sender=msg.sender, email_body=msg.body_text,
                received_date=msg.received_at.date(), pdf_filename=att.filename,
                pdf_text=pdf.text, pdf_bytes=data,
            )
        except Exception as e:
            self.log.error(f'message_id={msg.id} reason="PDF parse failed: {e}" file={att.filename}')
            rec = self._base_record(msg, att, notes=[f"処理エラー: 解析失敗 ({e})"])
            self._upload(rec, data, msg.received_at.date())
            return rec

        if not ext.is_invoice:
            self.log.info(f"Skipped not invoice by AI (confidence={ext.confidence:.2f}) {att.filename}")
            return None

        reasons = review_reasons(ext, threshold=self.config.confidence_threshold, score=score,
                                 texts=[msg.subject, pdf.text])
        notes = []
        if pdf.error:
            notes.append(f"PDFテキスト抽出エラー: {pdf.error}")
        if not pdf.text:
            notes.append("PDFテキストなし（AIで画像読取）")
        rec = self._base_record(msg, att, reasons=reasons, notes=notes)
        rec.confidence = ext.confidence
        rec.due_date = ext.due_date.isoformat() if ext.due_date else ""
        rec.invoice_date = ext.invoice_date.isoformat() if ext.invoice_date else ""
        rec.vendor_name = ext.vendor_name or rec.vendor_name
        rec.amount_total = ext.amount_total
        rec.tax_amount = ext.tax_amount
        rec.description = ext.description
        rec.invoice_number = ext.invoice_number
        rec.bank_name = ext.bank_name
        rec.bank_branch = ext.bank_branch
        rec.account_type = ext.account_type
        rec.account_number = ext.account_number
        rec.account_holder = ext.account_holder
        self.log.info(f"Invoice parsed {rec.vendor_name} {rec.amount_total} status={rec.status.value}")

        self._upload(rec, data, ext.invoice_date or msg.received_at.date())
        return rec

    # ---- 補助 ---------------------------------------------------------

    def _base_record(self, msg: EmailMessage, att: Attachment | None = None, *,
                     reasons: list[str] | None = None, notes: list[str] | None = None) -> InvoiceRecord:
        """reasons が None のとき（PDFなし・パスワード付き・エラー）は必ず要確認・未確認にする。"""
        needs_review = True if reasons is None else bool(reasons)
        all_notes = []
        if reasons:
            all_notes.append("要確認: " + "、".join(reasons))
        all_notes.extend(notes or [])
        if att:
            all_notes.append(f"元ファイル: {att.filename}")
        return InvoiceRecord(
            id=self.index.next_id(),
            status=Status.UNCONFIRMED if needs_review else Status.UNPAID,
            needs_review=needs_review,
            message_id=msg.id,
            thread_id=msg.thread_id,
            registered_at=self._now_str(),
            vendor_name=msg.sender_name,
            gmail_link=gmail_thread_link(msg.thread_id),
            notes=all_notes,
            source_filename=att.filename if att else "",
        )

    def _upload(self, rec: InvoiceRecord, data: bytes, d: date) -> None:
        filename = build_invoice_filename(d, rec.vendor_name, rec.amount_total, rec.invoice_number)
        if self.dry_run:
            rec.drive_filename = f"{d.year:04d}/{d.month:02d}/{filename}"
            rec.drive_link = "(dry-run: 未保存)"
            return
        _, link, name = self.drive.upload_pdf(data, filename, d)
        rec.drive_filename = f"{d.year:04d}/{d.month:02d}/{name}"
        rec.drive_link = link
        self.log.info(f"Uploaded Drive {rec.drive_filename}")

    def _now_str(self) -> str:
        return datetime.now(self.tz).strftime("%Y-%m-%d %H:%M:%S")
