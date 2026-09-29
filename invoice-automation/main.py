"""請求書処理自動化 CLI。

    python main.py                          通常実行
    python main.py --dry-run                Drive保存・Sheet書込みをせず結果だけ表示
    python main.py --scan-days 30           過去30日分を検索
    python main.py --process-message ID     指定メールのみ処理
    python main.py --parse-pdf FILE.pdf     手元のPDFをAI解析して表示（Google不要）
    python main.py --init-drive             Driveに「請求書」フォルダを作成
    python main.py --test                   設定と接続を確認
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from config import Config, load_config
from logger import setup_logger


def _print_records(results) -> None:
    for r in results:
        if r.outcome == "already_processed":
            continue
        print(f"\n[{r.outcome}] message_id={r.message_id} {r.subject}" + (f" ({r.detail})" if r.detail else ""))
        for rec in r.records:
            print(json.dumps({
                "ID": rec.id, "ステータス": rec.status.value, "要確認": rec.needs_review,
                "取引先": rec.vendor_name, "請求金額": rec.amount_total, "税額": rec.tax_amount,
                "請求日": rec.invoice_date, "支払期限": rec.due_date, "請求書番号": rec.invoice_number,
                "振込先": " ".join(filter(None, [rec.bank_name, rec.bank_branch, rec.account_type,
                                                 rec.account_number, rec.account_holder])),
                "AI確信度": rec.confidence, "Driveファイル": rec.drive_filename, "備考": " / ".join(rec.notes),
            }, ensure_ascii=False, indent=2))


def cmd_parse_pdf(config: Config, path: Path) -> int:
    from detector import score_filename, score_pdf_text
    from invoice_parser import ClaudeInvoiceExtractor, extract_pdf_text, parse_invoice

    data = path.read_bytes()
    pdf = extract_pdf_text(data)
    print(f"テキスト抽出: {len(pdf.text)}文字 / パスワード付き: {pdf.encrypted} / エラー: {pdf.error}")
    print(f"スコア(ファイル名+PDF本文): {score_filename(path.name) + score_pdf_text(pdf.text)}")
    if pdf.encrypted:
        return 1
    if not config.anthropic_api_key:
        print("ANTHROPIC_API_KEY が未設定のためAI解析はスキップしました")
        return 1
    ext = parse_invoice(
        ClaudeInvoiceExtractor(config.anthropic_api_key, config.anthropic_model),
        email_subject="", email_sender="", email_body="",
        received_date=datetime.now(ZoneInfo(config.timezone)).date(),
        pdf_filename=path.name, pdf_text=pdf.text, pdf_bytes=data,
    )
    print(ext.model_dump_json(indent=2))
    return 0


def cmd_test(config: Config) -> int:
    """設定・Google認証・Drive・Sheet・Claude APIへの接続を順に確認する。"""
    ok = True

    def check(label: str, fn):
        nonlocal ok
        try:
            detail = fn()
            print(f"  OK  {label}" + (f": {detail}" if detail else ""))
            return True
        except Exception as e:
            ok = False
            print(f"  NG  {label}: {e}")
            return False

    print("設定")
    for name in config.missing_for_run():
        ok = False
        print(f"  NG  {name} が未設定です（.env を確認）")
    print(f"  --  SHEET_NAME={config.sheet_name} / TIMEZONE={config.timezone} / "
          f"しきい値={config.confidence_threshold} / DRIVE_SCOPE={config.drive_scope}")

    print("Google")
    from drive_service import DriveService
    from gmail_service import GmailService
    from google_auth import build_google_services
    from sheets_service import SheetsService

    services = {}

    def auth():
        services["g"], services["d"], services["s"] = build_google_services(config)
    if check("OAuth認証 (token.json)", auth):
        check("Gmail", lambda: GmailService(services["g"], config.timezone).profile_email())
        if config.drive_root_folder_id:
            check("Drive ルートフォルダ", lambda: DriveService(services["d"], config.drive_root_folder_id)
                  .folder_name(config.drive_root_folder_id))
        if config.spreadsheet_id:
            sheets = SheetsService(services["s"], config.spreadsheet_id, config.sheet_name)

            def sheet():
                sheets.ensure_sheet()
                return f"「{config.sheet_name}」 登録済み {len(sheets.read_rows())} 行"
            check("Sheet（無ければシート・ヘッダーを作成）", sheet)

    print("Claude API")
    if config.anthropic_api_key:
        def claude_check():
            import anthropic
            return anthropic.Anthropic(api_key=config.anthropic_api_key).models.retrieve(config.anthropic_model).display_name
        check(f"APIキー・モデル {config.anthropic_model}", claude_check)

    print("\n結果: " + ("すべてOK" if ok else "NG があります。READMEのセットアップ手順を確認してください"))
    return 0 if ok else 1


def cmd_init_drive(config: Config) -> int:
    from drive_service import DriveService
    from google_auth import build_google_services

    _, drive, _ = build_google_services(config)
    folder_id = DriveService(drive, "").create_folder("請求書")
    print(f"Google Driveに「請求書」フォルダを作成しました。\n.env に次の行を設定してください:\n\n"
          f"DRIVE_ROOT_FOLDER_ID={folder_id}\n")
    return 0


def cmd_run(config: Config, args) -> int:
    from drive_service import DriveService
    from gmail_service import GmailService
    from google_auth import build_google_services
    from invoice_parser import ClaudeInvoiceExtractor
    from pipeline import InvoicePipeline
    from processed_store import ProcessedStore
    from sheets_service import SheetsService

    missing = config.missing_for_run()
    if args.dry_run:  # dry-run は書き込み先が無くても動かせる
        missing = [m for m in missing if m == "ANTHROPIC_API_KEY"]
    if missing:
        print(f"未設定の項目があります: {', '.join(missing)}（.env を確認）")
        return 2

    gmail_api, drive_api, sheets_api = build_google_services(config, interactive=sys.stdin.isatty())
    sheets = SheetsService(sheets_api, config.spreadsheet_id, config.sheet_name) if config.spreadsheet_id else None
    if sheets and not args.dry_run:
        sheets.ensure_sheet()
    pipeline = InvoicePipeline(
        config=config,
        gmail=GmailService(gmail_api, config.timezone),
        drive=DriveService(drive_api, config.drive_root_folder_id),
        sheets=sheets,
        extractor=ClaudeInvoiceExtractor(config.anthropic_api_key, config.anthropic_model),
        store=ProcessedStore(config.processed_path),
        dry_run=args.dry_run,
    )
    if args.process_message:
        pipeline.log.info("START" + (" (dry-run)" if args.dry_run else ""))
        results = [pipeline.process_message(args.process_message, force=args.force)]
        pipeline.log.info("DONE")
    else:
        results = pipeline.run(args.scan_days or config.scan_days)
    if args.dry_run or args.process_message:
        _print_records(results)
    return 1 if any(r.outcome == "error" for r in results) else 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Gmailの請求書PDFをDrive保存・支払い一覧へ登録する")
    p.add_argument("--dry-run", action="store_true", help="Drive保存・Sheet書込み・処理済み記録をしない")
    p.add_argument("--scan-days", type=int, help="過去N日分を検索（既定: SCAN_DAYS=30）")
    p.add_argument("--process-message", metavar="MESSAGE_ID", help="指定メールのみ処理")
    p.add_argument("--force", action="store_true", help="--process-message で処理済み記録を無視（Sheet登録済みは常にスキップ）")
    p.add_argument("--create-drafts", action="store_true", help="支払済み行から返信下書きを作成（Phase 2）")
    p.add_argument("--parse-pdf", type=Path, metavar="FILE", help="手元のPDFをAI解析して表示")
    p.add_argument("--init-drive", action="store_true", help="Driveに「請求書」フォルダを作成")
    p.add_argument("--test", action="store_true", help="設定と接続を確認")
    p.add_argument("--verbose", action="store_true", help="詳細ログ")
    args = p.parse_args(argv)

    config = load_config()
    setup_logger(config.log_dir, config.timezone, args.verbose)

    if args.test:
        return cmd_test(config)
    if args.init_drive:
        return cmd_init_drive(config)
    if args.parse_pdf:
        return cmd_parse_pdf(config, args.parse_pdf)
    if args.create_drafts:
        print("--create-drafts は Phase 2 で実装予定です")
        return 2
    return cmd_run(config, args)


if __name__ == "__main__":
    sys.exit(main())
