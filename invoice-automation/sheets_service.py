"""Google Sheets: 支払い一覧への読み書き（仕様書 §9）。"""
from __future__ import annotations

from typing import Any

from models import COL_ID, COL_MESSAGE_ID, SHEET_HEADERS

LAST_COL = "X"


class SheetsService:
    def __init__(self, service, spreadsheet_id: str, sheet_name: str):
        self.service = service
        self.spreadsheet_id = spreadsheet_id
        self.sheet_name = sheet_name

    def _range(self, a1: str) -> str:
        return f"'{self.sheet_name}'!{a1}"

    def _values(self):
        return self.service.spreadsheets().values()

    def ensure_sheet(self) -> None:
        """シートが無ければ作成し、1行目が空ならヘッダーを書き込む。"""
        meta = self.service.spreadsheets().get(spreadsheetId=self.spreadsheet_id, fields="sheets.properties.title").execute()
        titles = [s["properties"]["title"] for s in meta.get("sheets", [])]
        if self.sheet_name not in titles:
            self.service.spreadsheets().batchUpdate(
                spreadsheetId=self.spreadsheet_id,
                body={"requests": [{"addSheet": {"properties": {"title": self.sheet_name}}}]},
            ).execute()
        header = self._values().get(spreadsheetId=self.spreadsheet_id, range=self._range(f"A1:{LAST_COL}1")).execute()
        if not header.get("values"):
            self._values().update(
                spreadsheetId=self.spreadsheet_id, range=self._range("A1"),
                valueInputOption="RAW", body={"values": [SHEET_HEADERS]},
            ).execute()

    def read_rows(self) -> list[list[Any]]:
        """ヘッダーを除く全行。"""
        resp = self._values().get(
            spreadsheetId=self.spreadsheet_id, range=self._range(f"A2:{LAST_COL}"),
            valueRenderOption="UNFORMATTED_VALUE",
        ).execute()
        return resp.get("values", [])

    def append_rows(self, rows: list[list[Any]]) -> None:
        if not rows:
            return
        # RAW: 口座番号の先頭0や日付文字列が勝手に変換されないようにする
        self._values().append(
            spreadsheetId=self.spreadsheet_id, range=self._range("A1"),
            valueInputOption="RAW", insertDataOption="INSERT_ROWS", body={"values": rows},
        ).execute()


class SheetIndex:
    """実行中に参照する支払い一覧の索引（登録済みmessage_id・次のID）。"""

    def __init__(self, rows: list[list[Any]]):
        self.message_ids: set[str] = set()
        self._max_id = 0
        for row in rows:
            if len(row) > COL_MESSAGE_ID and row[COL_MESSAGE_ID]:
                self.message_ids.add(str(row[COL_MESSAGE_ID]))
            if row:
                try:
                    self._max_id = max(self._max_id, int(row[COL_ID]))
                except (TypeError, ValueError):
                    pass

    def next_id(self) -> int:
        self._max_id += 1
        return self._max_id
