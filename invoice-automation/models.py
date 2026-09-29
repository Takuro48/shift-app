"""データモデル: AI抽出結果のスキーマ検証と、支払い一覧シートの1行。"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from datetime import date
from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Status(str, Enum):
    UNCONFIRMED = "未確認"
    UNPAID = "未払い"
    PAID = "支払済"
    ON_HOLD = "保留"
    EXCLUDED = "対象外"


# 仕様書 §9 の列定義 (A〜X)
SHEET_HEADERS = [
    "ID", "ステータス", "要確認", "支払期限", "請求日", "取引先", "請求金額", "税額",
    "内容", "請求書番号", "銀行名", "支店名", "口座種別", "口座番号", "口座名義",
    "Driveリンク", "Gmailリンク", "Gmail Message ID", "Gmail Thread ID", "支払日",
    "メール下書き作成", "Draft ID", "登録日時", "備考",
]
COL_ID = 0
COL_MESSAGE_ID = 17


_DATE_PATTERNS = [
    re.compile(r"^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})"),
    re.compile(r"^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日"),
]


def parse_date(value: Any) -> date | None:
    """'2026-09-29' / '2026/9/29' / '2026年9月29日' を date に。解釈できなければ ValueError。"""
    if value is None:
        return None
    if isinstance(value, date):
        return value
    s = unicodedata.normalize("NFKC", str(value)).strip()
    if not s:
        return None
    for pat in _DATE_PATTERNS:
        m = pat.match(s)
        if m:
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    raise ValueError(f"日付を解釈できません: {value!r}")


def parse_amount(value: Any) -> int | None:
    """110000 / '110,000' / '¥110,000' / '110,000円' を int に。空なら None。"""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value))
    s = unicodedata.normalize("NFKC", str(value)).strip()
    s = re.sub(r"[¥￥,\s円]|JPY", "", s)
    if not s:
        return None
    if not re.fullmatch(r"-?\d+(\.\d+)?", s):
        raise ValueError(f"金額を解釈できません: {value!r}")
    return int(round(float(s)))


_STR_FIELDS = (
    "vendor_name", "invoice_number", "currency", "bank_name", "bank_branch", "account_type",
    "account_number", "account_holder", "description", "payment_method",
)


class InvoiceExtraction(BaseModel):
    """AIが返すJSON（仕様書 §27）のスキーマ。値の正規化もここで行う。"""

    model_config = ConfigDict(extra="ignore")

    is_invoice: bool = True
    confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    vendor_name: str = ""
    invoice_number: str = ""
    invoice_date: date | None = None
    due_date: date | None = None
    amount_total: int | None = None
    tax_amount: int | None = None
    currency: str = "JPY"
    bank_name: str = ""
    bank_branch: str = ""
    account_type: str = ""
    account_number: str = ""
    account_holder: str = ""
    description: str = ""
    payment_method: str = ""
    needs_review: bool = False
    review_reasons: list[str] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _normalize(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            raise ValueError("AIの出力がJSONオブジェクトではありません")
        d = dict(data)
        reasons = d.get("review_reasons") or []
        if isinstance(reasons, str):
            reasons = [reasons]
        reasons = [str(r) for r in reasons if str(r).strip()]

        for key in _STR_FIELDS:
            v = d.get(key)
            d[key] = "" if v is None else str(v).strip()
        if not d["currency"]:
            d["currency"] = "JPY"

        for key in ("invoice_date", "due_date"):
            try:
                d[key] = parse_date(d.get(key))
            except ValueError:
                reasons.append(f"{key} の形式が不正: {d.get(key)}")
                d[key] = None
        for key in ("amount_total", "tax_amount"):
            try:
                d[key] = parse_amount(d.get(key))
            except ValueError:
                reasons.append(f"{key} の形式が不正: {d.get(key)}")
                d[key] = None

        try:
            conf = float(d.get("confidence") or 0.0)
        except (TypeError, ValueError):
            conf = 0.0
        d["confidence"] = min(max(conf, 0.0), 1.0)

        for key in ("is_invoice", "needs_review"):
            v = d.get(key)
            if isinstance(v, str):
                d[key] = v.strip().lower() in ("true", "1", "yes")
        if d.get("is_invoice") is None:
            d["is_invoice"] = True
        if d.get("needs_review") is None:
            d["needs_review"] = False

        d["review_reasons"] = reasons
        return d


@dataclass
class InvoiceRecord:
    """支払い一覧シートの1行。"""

    status: Status
    needs_review: bool
    message_id: str
    thread_id: str
    registered_at: str
    id: int | str = ""
    due_date: str = ""
    invoice_date: str = ""
    vendor_name: str = ""
    amount_total: int | None = None
    tax_amount: int | None = None
    description: str = ""
    invoice_number: str = ""
    bank_name: str = ""
    bank_branch: str = ""
    account_type: str = ""
    account_number: str = ""
    account_holder: str = ""
    drive_link: str = ""
    gmail_link: str = ""
    paid_date: str = ""
    draft_created: str = ""
    draft_id: str = ""
    notes: list[str] = field(default_factory=list)
    # シートには書かないが、ログ・dry-run表示に使う
    drive_filename: str = ""
    source_filename: str = ""
    confidence: float | None = None

    def to_row(self) -> list[Any]:
        def num(v: int | None) -> Any:
            return "" if v is None else v

        return [
            self.id, self.status.value, self.needs_review, self.due_date, self.invoice_date,
            self.vendor_name, num(self.amount_total), num(self.tax_amount), self.description,
            self.invoice_number, self.bank_name, self.bank_branch, self.account_type,
            self.account_number, self.account_holder, self.drive_link, self.gmail_link,
            self.message_id, self.thread_id, self.paid_date, self.draft_created, self.draft_id,
            self.registered_at, " / ".join(self.notes),
        ]
