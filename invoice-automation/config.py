"""環境変数 (.env) から設定を読み込む。"""
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent


def _path(value: str, default: str) -> Path:
    p = Path(value or default)
    return p if p.is_absolute() else BASE_DIR / p


@dataclass(frozen=True)
class Config:
    anthropic_api_key: str
    anthropic_model: str
    drive_root_folder_id: str
    spreadsheet_id: str
    sheet_name: str
    gmail_account: str
    drive_scope: str
    credentials_path: Path
    token_path: Path
    timezone: str
    confidence_threshold: float
    scan_days: int
    data_dir: Path

    @property
    def processed_path(self) -> Path:
        return self.data_dir / "processed_message_ids.json"

    @property
    def log_dir(self) -> Path:
        return self.data_dir / "logs"

    def missing_for_run(self) -> list[str]:
        """通常実行に必要だが未設定の項目名を返す。"""
        missing = []
        if not self.anthropic_api_key:
            missing.append("ANTHROPIC_API_KEY")
        if not self.drive_root_folder_id:
            missing.append("DRIVE_ROOT_FOLDER_ID")
        if not self.spreadsheet_id:
            missing.append("SPREADSHEET_ID")
        return missing


def load_config(env_file: Path | None = None) -> Config:
    load_dotenv(env_file or BASE_DIR / ".env")
    env = os.environ.get
    drive_scope = (env("DRIVE_SCOPE") or "file").strip().lower()
    if drive_scope not in ("file", "full"):
        raise ValueError("DRIVE_SCOPE は file または full を指定してください")
    return Config(
        anthropic_api_key=env("ANTHROPIC_API_KEY", "").strip(),
        anthropic_model=env("ANTHROPIC_MODEL", "").strip() or "claude-opus-5-5",
        drive_root_folder_id=env("DRIVE_ROOT_FOLDER_ID", "").strip(),
        spreadsheet_id=env("SPREADSHEET_ID", "").strip(),
        sheet_name=env("SHEET_NAME", "").strip() or "支払い一覧",
        gmail_account=env("GMAIL_ACCOUNT", "").strip(),
        drive_scope=drive_scope,
        credentials_path=_path(env("GOOGLE_CREDENTIALS_PATH", ""), "credentials.json"),
        token_path=_path(env("GOOGLE_TOKEN_PATH", ""), "token.json"),
        timezone=env("TIMEZONE", "").strip() or "Asia/Tokyo",
        confidence_threshold=float(env("INVOICE_CONFIDENCE_THRESHOLD", "") or 0.80),
        scan_days=int(env("SCAN_DAYS", "") or 30),
        data_dir=_path(env("DATA_DIR", ""), "data"),
    )
