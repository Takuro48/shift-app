from gmail_service import EmailMessage


class FakeGmail:
    def __init__(self, messages: list[EmailMessage]):
        self.messages = {m.id: m for m in messages}
        self.downloads = 0

    def search_candidates(self, days):
        return list(self.messages)

    def get_message(self, mid):
        if mid not in self.messages:
            raise KeyError(f"message not found: {mid}")
        return self.messages[mid]

    def download_attachment(self, msg, att):
        self.downloads += 1
        return att.data


class FakeDrive:
    def __init__(self):
        self.uploads = []  # (filename, date)

    def upload_pdf(self, data, filename, d):
        names = [n for n, _ in self.uploads]
        name, n = filename, 1
        while name in names:
            n += 1
            name = filename.replace(".pdf", f"_{n}.pdf")
        self.uploads.append((name, d))
        return f"id{len(self.uploads)}", f"https://drive.google.com/file/d/id{len(self.uploads)}/view", name


class FakeSheets:
    def __init__(self, rows=None, fail=False):
        self.rows = list(rows or [])
        self.fail = fail

    def read_rows(self):
        return [list(r) for r in self.rows]

    def append_rows(self, rows):
        if self.fail:
            raise RuntimeError("Sheets API error")
        self.rows.extend(rows)


VALID = {
    "is_invoice": True, "confidence": 0.95, "vendor_name": "株式会社サンプル",
    "invoice_number": "INV-1234", "invoice_date": "2026-09-25", "due_date": "2026-10-31",
    "amount_total": 110000, "tax_amount": 10000, "currency": "JPY", "bank_name": "みずほ銀行",
    "bank_branch": "渋谷支店", "account_type": "普通", "account_number": "0123456",
    "account_holder": "カ）サンプル", "description": "9月分業務委託費", "payment_method": "振込",
    "needs_review": False, "review_reasons": [],
}


class FakeExtractor:
    def __init__(self, result=None, error=None):
        self.result = dict(VALID if result is None else result)
        self.error = error
        self.calls = []

    def extract(self, **kwargs):
        self.calls.append(kwargs)
        if self.error:
            raise self.error
        return dict(self.result)
