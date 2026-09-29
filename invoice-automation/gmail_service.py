"""Gmail: 請求書候補メールの検索・本文/添付の取得（読み取りのみ）。"""
from __future__ import annotations

import base64
import html
import re
from dataclasses import dataclass, field
from datetime import datetime
from email.utils import parseaddr
from zoneinfo import ZoneInfo

INVOICE_QUERY_WORDS = "{請求書 御請求書 ご請求 請求 invoice}"
# 自分が送った請求書（売上側）を支払い対象にしないよう、自分発のメールは除外する
_COMMON = "-from:me -in:drafts -in:chats"


def build_search_queries(days: int) -> list[str]:
    return [
        f"has:attachment filename:pdf newer_than:{days}d {_COMMON}",
        # PDFなしの請求メール（本文のみ・ZIP添付など）も拾う
        f"{INVOICE_QUERY_WORDS} newer_than:{days}d {_COMMON}",
    ]


def gmail_thread_link(thread_id: str) -> str:
    return f"https://mail.google.com/mail/u/0/#inbox/{thread_id}"


@dataclass
class Attachment:
    filename: str
    mime_type: str
    size: int
    attachment_id: str | None = None
    data: bytes | None = None  # 小さい添付はメッセージ本体に含まれる

    @property
    def is_pdf(self) -> bool:
        return self.mime_type == "application/pdf" or self.filename.lower().endswith(".pdf")

    @property
    def is_zip(self) -> bool:
        return self.mime_type in ("application/zip", "application/x-zip-compressed") or self.filename.lower().endswith(".zip")


@dataclass
class EmailMessage:
    id: str
    thread_id: str
    subject: str
    sender: str
    received_at: datetime
    body_text: str
    attachments: list[Attachment] = field(default_factory=list)

    @property
    def sender_name(self) -> str:
        name, addr = parseaddr(self.sender)
        return name or addr

    @property
    def pdf_attachments(self) -> list[Attachment]:
        return [a for a in self.attachments if a.is_pdf]

    @property
    def zip_attachments(self) -> list[Attachment]:
        return [a for a in self.attachments if a.is_zip]


def _b64decode(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def html_to_text(s: str) -> str:
    s = re.sub(r"(?is)<(script|style).*?</\1>", "", s)
    s = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</tr>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    return re.sub(r"\n\s*\n+", "\n\n", s).strip()


def parse_message(raw: dict, tz: ZoneInfo) -> EmailMessage:
    """users.messages.get(format=full) のレスポンスを EmailMessage に変換する。"""
    payload = raw.get("payload", {})
    headers = {h["name"].lower(): h["value"] for h in payload.get("headers", [])}
    plain: list[str] = []
    htmls: list[str] = []
    attachments: list[Attachment] = []

    def walk(part: dict) -> None:
        mime = part.get("mimeType", "")
        body = part.get("body", {}) or {}
        filename = part.get("filename") or ""
        if filename:
            attachments.append(Attachment(
                filename=filename,
                mime_type=mime,
                size=int(body.get("size", 0) or 0),
                attachment_id=body.get("attachmentId"),
                data=_b64decode(body["data"]) if body.get("data") and not body.get("attachmentId") else None,
            ))
        elif mime == "text/plain" and body.get("data"):
            plain.append(_b64decode(body["data"]).decode("utf-8", errors="replace"))
        elif mime == "text/html" and body.get("data"):
            htmls.append(_b64decode(body["data"]).decode("utf-8", errors="replace"))
        for sub in part.get("parts", []) or []:
            walk(sub)

    walk(payload)
    body_text = "\n".join(plain).strip() or html_to_text("\n".join(htmls))
    received = datetime.fromtimestamp(int(raw.get("internalDate", "0")) / 1000, tz)
    return EmailMessage(
        id=raw["id"],
        thread_id=raw.get("threadId", ""),
        subject=headers.get("subject", ""),
        sender=headers.get("from", ""),
        received_at=received,
        body_text=body_text,
        attachments=attachments,
    )


class GmailService:
    def __init__(self, service, timezone: str = "Asia/Tokyo", user_id: str = "me"):
        self.service = service
        self.tz = ZoneInfo(timezone)
        self.user_id = user_id

    def search(self, query: str, max_results: int = 500) -> list[str]:
        ids: list[str] = []
        page_token = None
        while len(ids) < max_results:
            resp = self.service.users().messages().list(
                userId=self.user_id, q=query, pageToken=page_token, maxResults=min(100, max_results - len(ids)),
            ).execute()
            ids.extend(m["id"] for m in resp.get("messages", []))
            page_token = resp.get("nextPageToken")
            if not page_token:
                break
        return ids

    def search_candidates(self, days: int) -> list[str]:
        """全検索クエリの結果を重複なく返す（古い順）。"""
        seen: dict[str, None] = {}
        for q in build_search_queries(days):
            for mid in self.search(q):
                seen.setdefault(mid, None)
        return list(reversed(list(seen)))

    def get_message(self, message_id: str) -> EmailMessage:
        raw = self.service.users().messages().get(userId=self.user_id, id=message_id, format="full").execute()
        return parse_message(raw, self.tz)

    def download_attachment(self, message: EmailMessage, att: Attachment) -> bytes:
        if att.data is not None:
            return att.data
        resp = self.service.users().messages().attachments().get(
            userId=self.user_id, messageId=message.id, id=att.attachment_id,
        ).execute()
        att.data = _b64decode(resp["data"])
        return att.data

    def profile_email(self) -> str:
        return self.service.users().getProfile(userId=self.user_id).execute().get("emailAddress", "")
