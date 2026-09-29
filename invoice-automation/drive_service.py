"""Google Drive: 請求書PDFを 請求書/YYYY/MM/ に保存する（仕様書 §7）。"""
from __future__ import annotations

import io
import re
from datetime import date

from googleapiclient.http import MediaIoBaseUpload

FOLDER_MIME = "application/vnd.google-apps.folder"
_FORBIDDEN = re.compile(r'[/\\:*?"<>|\r\n\t]')


def sanitize_filename_part(s: str) -> str:
    s = _FORBIDDEN.sub("", s or "")
    return re.sub(r"\s+", " ", s).strip().strip(".")


def build_invoice_filename(d: date, vendor: str, amount: int | None, invoice_number: str) -> str:
    """YYYY-MM-DD_取引先名_金額_請求書番号.pdf（不明な項目は省略）"""
    parts = [d.isoformat(), sanitize_filename_part(vendor) or "取引先不明"]
    if amount is not None:
        parts.append(str(amount))
    number = sanitize_filename_part(invoice_number)
    if number:
        parts.append(number)
    return "_".join(parts) + ".pdf"


def with_suffix_number(filename: str, n: int) -> str:
    stem, dot, ext = filename.rpartition(".")
    return f"{stem}_{n}.{ext}" if dot else f"{filename}_{n}"


def _q(s: str) -> str:
    return s.replace("\\", "\\\\").replace("'", "\\'")


class DriveService:
    def __init__(self, service, root_folder_id: str):
        self.service = service
        self.root_folder_id = root_folder_id
        self._folder_cache: dict[tuple[str, str], str] = {}

    def _files(self):
        return self.service.files()

    def _find(self, name: str, parent_id: str, folder: bool) -> str | None:
        mime = f"mimeType = '{FOLDER_MIME}'" if folder else f"mimeType != '{FOLDER_MIME}'"
        resp = self._files().list(
            q=f"name = '{_q(name)}' and '{_q(parent_id)}' in parents and {mime} and trashed = false",
            fields="files(id, name)", pageSize=1,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        files = resp.get("files", [])
        return files[0]["id"] if files else None

    def create_folder(self, name: str, parent_id: str | None = None) -> str:
        body = {"name": name, "mimeType": FOLDER_MIME}
        if parent_id:
            body["parents"] = [parent_id]
        return self._files().create(body=body, fields="id", supportsAllDrives=True).execute()["id"]

    def find_or_create_folder(self, name: str, parent_id: str) -> str:
        key = (parent_id, name)
        if key not in self._folder_cache:
            self._folder_cache[key] = self._find(name, parent_id, folder=True) or self.create_folder(name, parent_id)
        return self._folder_cache[key]

    def month_folder(self, d: date) -> str:
        year_id = self.find_or_create_folder(f"{d.year:04d}", self.root_folder_id)
        return self.find_or_create_folder(f"{d.month:02d}", year_id)

    def unique_name(self, folder_id: str, filename: str) -> str:
        name, n = filename, 1
        while self._find(name, folder_id, folder=False):
            n += 1
            name = with_suffix_number(filename, n)
        return name

    def upload_pdf(self, data: bytes, filename: str, d: date) -> tuple[str, str, str]:
        """(file_id, webViewLink, 実際のファイル名) を返す。"""
        folder_id = self.month_folder(d)
        name = self.unique_name(folder_id, filename)
        media = MediaIoBaseUpload(io.BytesIO(data), mimetype="application/pdf", resumable=False)
        f = self._files().create(
            body={"name": name, "parents": [folder_id]}, media_body=media,
            fields="id, webViewLink", supportsAllDrives=True,
        ).execute()
        return f["id"], f.get("webViewLink", f"https://drive.google.com/file/d/{f['id']}/view"), name

    def folder_name(self, folder_id: str) -> str:
        return self._files().get(fileId=folder_id, fields="name", supportsAllDrives=True).execute()["name"]
