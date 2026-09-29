"""Google OAuth 認証と APIクライアント生成（仕様書 §21）。"""
from __future__ import annotations

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

from config import Config
from logger import get_logger

GMAIL_SCOPES = [
    "https://www.googleapis.com/auth/gmail.readonly",
    "https://www.googleapis.com/auth/gmail.compose",  # Phase 2 の返信下書き作成用（送信はしない）
]
SHEETS_SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
DRIVE_SCOPES = {
    "file": ["https://www.googleapis.com/auth/drive.file"],
    "full": ["https://www.googleapis.com/auth/drive"],
}


def scopes_for(config: Config) -> list[str]:
    return GMAIL_SCOPES + SHEETS_SCOPES + DRIVE_SCOPES[config.drive_scope]


def get_credentials(config: Config, interactive: bool = True) -> Credentials:
    log = get_logger()
    scopes = scopes_for(config)
    creds: Credentials | None = None
    if config.token_path.exists():
        creds = Credentials.from_authorized_user_file(str(config.token_path), scopes)
        if not creds.has_scopes(scopes):
            log.info("token.json の権限が不足しているため再認証します")
            creds = None

    if creds and creds.valid:
        return creds
    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
    else:
        if not interactive:
            raise RuntimeError("Google認証が必要です。先に `python main.py --test` を手元で実行してください")
        if not config.credentials_path.exists():
            raise FileNotFoundError(
                f"{config.credentials_path} がありません。READMEの手順でOAuthクライアントを作成して配置してください"
            )
        flow = InstalledAppFlow.from_client_secrets_file(str(config.credentials_path), scopes)
        creds = flow.run_local_server(port=0, login_hint=config.gmail_account or None)

    config.token_path.write_text(creds.to_json(), encoding="utf-8")
    return creds


def build_google_services(config: Config, interactive: bool = True):
    """(gmail, drive, sheets) の googleapiclient リソースを返す。"""
    creds = get_credentials(config, interactive=interactive)
    return (
        build("gmail", "v1", credentials=creds, cache_discovery=False),
        build("drive", "v3", credentials=creds, cache_discovery=False),
        build("sheets", "v4", credentials=creds, cache_discovery=False),
    )
