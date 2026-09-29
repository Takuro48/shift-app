"""PDFテキスト抽出とClaude（Anthropic API）による請求情報抽出（仕様書 §8, §27）。"""
from __future__ import annotations

import base64
import io
import json
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from pypdf import PdfReader

from models import InvoiceExtraction

MAX_TEXT_CHARS = 30_000
MAX_PDF_BYTES_FOR_AI = 20 * 1024 * 1024  # base64化しても1リクエスト32MBの上限に収まるサイズ

SYSTEM_PROMPT = """あなたは日本企業向けの請求書解析AIです。
入力されたメール本文および請求書PDFの内容から、請求情報をJSONで抽出してください。

ルール：
- 書いていない情報は推測しない。不明な項目は null または空文字にする
- 曖昧な場合は needs_review=true とし、理由を review_reasons に日本語で書く
- 金額は整数（カンマ・円記号なし）。税込総額を amount_total に設定
- 日付は YYYY-MM-DD
- 支払期限が「翌月末」などの相対表現なら invoice_date から計算してよい
- 日本円は currency="JPY"
- 複数の振込口座が存在する場合は needs_review=true
- 振込先口座がPDFではなくメール本文にある場合もメール本文から取得する
- 見積書・納品書・発注書・契約書・パンフレットの場合は is_invoice=false
- confidence は「これが支払うべき請求書であり、抽出値が正しい」ことへの確信度（0.0〜1.0）
"""


@dataclass
class PdfText:
    text: str
    encrypted: bool = False
    error: str | None = None


def extract_pdf_text(data: bytes) -> PdfText:
    """PDFからテキストを直接取得する。パスワード付きなら encrypted=True。"""
    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            try:
                # 閲覧パスワード無し（権限パスワードのみ）のPDFは空パスワードで開ける
                if not reader.decrypt(""):
                    return PdfText("", encrypted=True)
            except Exception:
                return PdfText("", encrypted=True)
        text = "\n".join((page.extract_text() or "") for page in reader.pages)
        return PdfText(text.strip())
    except Exception as e:  # 壊れたPDFなど
        return PdfText("", error=f"{type(e).__name__}: {e}")


class InvoiceExtractor(Protocol):
    def extract(self, *, email_subject: str, email_sender: str, email_body: str, received_date: date,
                pdf_filename: str, pdf_text: str, pdf_bytes: bytes | None) -> dict: ...


def build_user_prompt(*, email_subject: str, email_sender: str, email_body: str, received_date: date,
                      pdf_filename: str, pdf_text: str, pdf_attached: bool) -> str:
    if not pdf_filename:
        pdf_part = "（PDF添付なし）"
    elif pdf_attached:
        pdf_part = "（添付のPDFドキュメントを参照）"
    else:
        pdf_part = pdf_text[:MAX_TEXT_CHARS] or "（PDFを読み取れませんでした）"
    return (
        f"メール受信日: {received_date.isoformat()}\n"
        f"差出人: {email_sender}\n"
        f"件名: {email_subject}\n"
        f"--- メール本文 ---\n{email_body[:MAX_TEXT_CHARS // 3]}\n"
        f"--- 添付PDF: {pdf_filename} ---\n{pdf_part}\n"
    )


_STR = {"type": "string"}
_INT_OR_NULL = {"anyOf": [{"type": "integer"}, {"type": "null"}]}
_FIELDS = {
    "is_invoice": {"type": "boolean"},
    "confidence": {"type": "number"},
    "vendor_name": _STR,
    "invoice_number": _STR,
    "invoice_date": {"type": "string", "description": "YYYY-MM-DD。不明なら空文字"},
    "due_date": {"type": "string", "description": "YYYY-MM-DD。不明なら空文字"},
    "amount_total": _INT_OR_NULL,
    "tax_amount": _INT_OR_NULL,
    "currency": _STR,
    "bank_name": _STR,
    "bank_branch": _STR,
    "account_type": _STR,
    "account_number": _STR,
    "account_holder": _STR,
    "description": _STR,
    "payment_method": _STR,
    "needs_review": {"type": "boolean"},
    "review_reasons": {"type": "array", "items": _STR},
}
# 仕様書 §27 の出力形式。structured outputs でこの形のJSONだけが返る
OUTPUT_SCHEMA = {
    "type": "object",
    "properties": _FIELDS,
    "required": list(_FIELDS),
    "additionalProperties": False,
}


class ClaudeInvoiceExtractor:
    def __init__(self, api_key: str, model: str, client=None):
        if client is None:
            import anthropic
            client = anthropic.Anthropic(api_key=api_key, max_retries=3, timeout=300)
        self.client = client
        self.model = model

    def extract(self, *, email_subject, email_sender, email_body, received_date,
                pdf_filename, pdf_text, pdf_bytes) -> dict:
        # PDFはドキュメントとして渡す（表のレイアウトやスキャン画像もClaudeが直接読む。OCR不要）
        attach = bool(pdf_bytes) and len(pdf_bytes) <= MAX_PDF_BYTES_FOR_AI
        content: list[dict] = []
        if attach:
            content.append({"type": "document", "source": {
                "type": "base64", "media_type": "application/pdf",
                "data": base64.b64encode(pdf_bytes).decode("ascii"),
            }})
        content.append({"type": "text", "text": build_user_prompt(
            email_subject=email_subject, email_sender=email_sender, email_body=email_body,
            received_date=received_date, pdf_filename=pdf_filename, pdf_text=pdf_text, pdf_attached=attach,
        )})
        resp = self.client.beta.messages.create(
            model=self.model,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": content}],
            output_config={"effort": "medium", "format": {"type": "json_schema", "schema": OUTPUT_SCHEMA}},
            # 安全判定で断られた場合はサーバー側で別モデルに自動で引き継ぐ
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
        if resp.stop_reason == "refusal":
            raise ValueError("AIが解析を拒否しました")
        if resp.stop_reason == "max_tokens":
            raise ValueError("AIの出力が途中で切れました")
        raw = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            return json.loads(raw)
        except json.JSONDecodeError as e:
            raise ValueError(f"AIの出力がJSONではありません: {raw[:200]}") from e


def parse_invoice(extractor: InvoiceExtractor, **kwargs) -> InvoiceExtraction:
    """AIで抽出し、スキーマ検証済みの結果を返す（検証失敗は例外）。"""
    return InvoiceExtraction.model_validate(extractor.extract(**kwargs))
