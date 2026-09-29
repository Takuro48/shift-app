"""処理済みGmail message_idの保存（二重処理防止, 仕様書 §5）。

形式:
    {"processed": ["18fxxx", ...], "details": {"18fxxx": {"outcome": "registered", "at": "..."}}}
"""
from __future__ import annotations

import json
import os
from pathlib import Path


class ProcessedStore:
    def __init__(self, path: Path):
        self.path = path
        self._ids: list[str] = []
        self._details: dict[str, dict] = {}
        if path.exists():
            data = json.loads(path.read_text(encoding="utf-8") or "{}")
            self._ids = list(data.get("processed", []))
            self._details = dict(data.get("details", {}))
        self._set = set(self._ids)

    def __contains__(self, message_id: str) -> bool:
        return message_id in self._set

    def __len__(self) -> int:
        return len(self._ids)

    def mark(self, message_id: str, outcome: str, at: str, note: str = "") -> None:
        if message_id not in self._set:
            self._ids.append(message_id)
            self._set.add(message_id)
        self._details[message_id] = {"outcome": outcome, "at": at, **({"note": note} if note else {})}
        self._save()

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(
            json.dumps({"processed": self._ids, "details": self._details}, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        os.replace(tmp, self.path)
