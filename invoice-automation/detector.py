"""請求書候補のスコア判定（仕様書 §4, §6）。AI呼び出し前の安価な一次判定。"""
from __future__ import annotations

import unicodedata

CANDIDATE_SCORE = 4  # 以上 → 請求書候補
AUTO_SCORE = 6       # 以上 → 原則自動登録（未満は要確認）

SUBJECT_WORDS = ("請求書", "御請求", "ご請求", "invoice")
FILENAME_WORDS = ("請求", "invoice")
BODY_WORDS = ("お支払", "振込", "振り込", "請求金額")
PDF_INVOICE_WORDS = ("請求書", "請求金額", "invoice")
PDF_BANK_WORDS = ("振込先", "口座")

EXCLUDED_DOC_WORDS = ("見積書", "御見積", "納品書", "発注書", "注文書", "契約書", "パンフレット", "quotation", "estimate")
CORRECTION_WORDS = ("再発行", "訂正", "差替", "差し替え")


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKC", s or "").lower()


def _has_any(text: str, words: tuple[str, ...]) -> bool:
    t = _norm(text)
    return any(_norm(w) in t for w in words)


def score_email(subject: str, body: str) -> int:
    score = 0
    if _has_any(subject, SUBJECT_WORDS):
        score += 3
    if _has_any(body, BODY_WORDS):
        score += 2
    return score


def score_filename(filename: str) -> int:
    return 3 if _has_any(filename, FILENAME_WORDS) else 0


def score_pdf_text(text: str) -> int:
    score = 0
    if _has_any(text, PDF_INVOICE_WORDS):
        score += 2
    if _has_any(text, PDF_BANK_WORDS):
        score += 1
    return score


def excluded_document_type(filename: str, pdf_text: str) -> str | None:
    """見積書・納品書などの請求書以外の書類なら、その種類名を返す。

    ファイル名、またはPDF冒頭（タイトル部分）に除外ワードがあり、
    かつ請求書を示す語が無い場合のみ除外する。判断が難しいものはAIに任せる。
    """
    name = _norm(filename)
    head = _norm(pdf_text[:300])
    for word in EXCLUDED_DOC_WORDS:
        w = _norm(word)
        if w in name and not _has_any(filename, FILENAME_WORDS):
            return word
        if w in head and not _has_any(pdf_text[:300], ("請求書", "invoice")):
            return word
    return None


def has_correction_words(*texts: str) -> bool:
    return any(_has_any(t, CORRECTION_WORDS) for t in texts)
