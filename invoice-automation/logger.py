"""ログ出力（コンソール + ファイル、時刻は日本時間）。

出力例:
    2026-09-29 20:01:00 START
    2026-09-29 20:01:02 ERROR message_id=xxx reason="PDF parse failed"
"""
from __future__ import annotations

import logging
import sys
from datetime import datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from zoneinfo import ZoneInfo

LOGGER_NAME = "invoice"


class _Formatter(logging.Formatter):
    def __init__(self, tz: ZoneInfo):
        super().__init__()
        self.tz = tz

    def format(self, record: logging.LogRecord) -> str:
        ts = datetime.fromtimestamp(record.created, self.tz).strftime("%Y-%m-%d %H:%M:%S")
        level = f"{record.levelname} " if record.levelno >= logging.WARNING else ""
        msg = f"{ts} {level}{record.getMessage()}"
        if record.exc_info:
            msg += "\n" + self.formatException(record.exc_info)
        return msg


def setup_logger(log_dir: Path | None, timezone: str = "Asia/Tokyo", verbose: bool = False) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.handlers.clear()
    logger.setLevel(logging.DEBUG if verbose else logging.INFO)
    logger.propagate = False
    fmt = _Formatter(ZoneInfo(timezone))

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)
    logger.addHandler(console)

    if log_dir is not None:
        log_dir.mkdir(parents=True, exist_ok=True)
        fh = RotatingFileHandler(log_dir / "invoice.log", maxBytes=5_000_000, backupCount=5, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    return logger


def get_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)
