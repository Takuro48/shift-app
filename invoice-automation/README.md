# 請求書処理自動化（Phase 1）

Gmailで受け取った請求書PDFを **Google Driveに保存** し、Googleスプレッドシート **「支払い一覧」に自動登録** するツールです。

```
Gmail → 請求書メール検出 → PDF取得 → AI解析 → Google Drive → 支払い一覧（Sheet）
```

- 銀行振込は自動化しません（人が行います）
- メールは自動送信しません（Phase 2 で「返信下書き」だけ作ります）
- AIの読み取り結果は間違うことがあるため、怪しいものは「要確認」になります

> このフォルダは Next.js アプリ（shift-app）とは独立した Python プログラムです。

---

## できること（Phase 1）

| 機能 | 内容 |
| --- | --- |
| 請求書メール検出 | 過去30日の「PDF添付メール」と「請求・invoice を含むメール」を検索し、件名・本文・ファイル名・PDF本文からスコア判定（4点以上を候補、6点未満は要確認）。自分が送ったメールは対象外 |
| PDF取得 | 1通に複数PDFがあれば全部取得。見積書・納品書・発注書・契約書・パンフレットは除外 |
| PDF解析 | PDFをそのまま Claude（Anthropic API）に渡して請求情報をJSON抽出（スキャンPDFもOCR不要で読める）。出力形式はAPI側で固定し、受け取った値もスキーマ検証 |
| Drive保存 | `請求書/2026/09/2026-09-25_株式会社サンプル_110000_INV-1234.pdf` の形で保存（請求日で分類、同名は `_2`, `_3`） |
| Sheet登録 | 「支払い一覧」シートにA〜X列の形式で1行追加（シートやヘッダーが無ければ自動作成） |
| 二重処理防止 | 処理済みの Gmail message_id を `data/processed_message_ids.json` に記録。さらにシートR列のmessage_idも確認するので、記録ファイルが消えても二重登録しません |
| dry-run | Drive保存・Sheet書込み・処理済み記録をせず、結果だけ画面に表示 |
| エラー処理 | 1通でエラーが起きても残りの処理は続行。AI解析に失敗したPDFは「未確認」の行として残します |
| ログ | 画面と `data/logs/invoice.log` に日本時間で記録 |

### ステータスと要確認

- AI確信度 0.8以上 かつ 要確認の理由なし → **未払い**
- それ以外 → **未確認**（C列「要確認」= TRUE、X列「備考」に理由）

要確認になる主な理由: AI確信度が低い / 金額が取れない / 支払期限が取れない / 振込先が複数（AI判定）/ 「再発行・訂正・差替」を含む / 判定スコアが低い / 添付PDFなし / ZIP添付 / パスワード付きPDF / 解析エラー

---

## 初回セットアップ

所要時間の目安: 30〜40分。Python 3.11 以上が必要です（`python3 --version` で確認）。

### 1. Google Cloud プロジェクトを作成

1. <https://console.cloud.google.com/> を開き、会社のGoogleアカウントでログイン
2. 画面上部のプロジェクト選択 → 「新しいプロジェクト」→ 名前（例: `invoice-automation`）→ 作成

### 2〜4. API を有効化

「APIとサービス」→「ライブラリ」で次の3つを検索し、それぞれ「有効にする」を押します。

- Gmail API
- Google Drive API
- Google Sheets API

### 5. OAuth クライアントを作成

1. 「APIとサービス」→「OAuth 同意画面」
   - Google Workspace（会社ドメイン）の場合は **ユーザーの種類「内部」** を選択（おすすめ。トークンの期限切れが起きにくい）
   - 個人のGmailの場合は「外部」を選び、「テストユーザー」に自分のメールアドレスを追加
   - アプリ名・メールアドレスを入力して保存
2. 「APIとサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
   - アプリケーションの種類: **デスクトップ アプリ**
   - 作成後「JSONをダウンロード」

### 6. credentials.json を配置

ダウンロードしたJSONを、このフォルダ（`invoice-automation/`）に **`credentials.json`** という名前で置きます。

> `credentials.json` / `token.json` / `.env` は秘密情報です。`.gitignore` 済みなので Git にはコミットされませんが、他人に渡さないでください。

### 7. ライブラリをインストール

```bash
cd invoice-automation
python3 -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### 8. .env を作成

```bash
cp .env.example .env
```

`.env` をテキストエディタで開き、`ANTHROPIC_API_KEY=` に Anthropic のAPIキーを入れます。

APIキーの発行方法:

1. <https://console.anthropic.com/> にログイン（アカウントが無ければ作成）
2. 「Billing」で支払い方法を登録し、クレジットを購入
3. 「API Keys」→「Create Key」でキーを作成し、表示された `sk-ant-...` をコピー

> Claude のチャット（claude.ai）の契約とは別に、APIの利用料（従量課金）がかかります。

### 9. Google Drive の「請求書」フォルダを設定

最小権限（`drive.file`）で動かすため、フォルダは **このツールに作らせます**。

```bash
python main.py --init-drive
```

初回はブラウザが開くので、Googleアカウントでログインして権限を許可してください（`token.json` が作られます）。
表示された `DRIVE_ROOT_FOLDER_ID=...` の行を `.env` に貼り付けます。

> すでに手動で作った「請求書」フォルダを使いたい場合は、`.env` の `DRIVE_SCOPE=full` にし、`token.json` を削除してから、
> フォルダURL `https://drive.google.com/drive/folders/XXXXXXXX` の `XXXXXXXX` を `DRIVE_ROOT_FOLDER_ID` に設定します。

### 10. スプレッドシートを設定

1. Googleスプレッドシートを新規作成（名前は自由）
2. URL `https://docs.google.com/spreadsheets/d/XXXXXXXX/edit` の `XXXXXXXX` を `.env` の `SPREADSHEET_ID` に設定
3. 「支払い一覧」シートとヘッダー行は次の手順で自動作成されます

### 11. 接続テスト

```bash
python main.py --test
```

すべて `OK` になれば準備完了です。`NG` の行に原因が表示されます。

### 12. 実行

まずは書き込みなしで結果を確認:

```bash
python main.py --dry-run
```

問題なければ本番実行:

```bash
python main.py
```

---

## コマンド一覧

| コマンド | 内容 |
| --- | --- |
| `python main.py` | 通常実行（過去30日） |
| `python main.py --dry-run` | Drive保存・Sheet書込み・処理済み記録をしない |
| `python main.py --scan-days 7` | 過去7日分を検索 |
| `python main.py --process-message MESSAGE_ID` | 指定メールだけ処理（`--dry-run` と併用可） |
| `python main.py --process-message MESSAGE_ID --force` | 「請求書ではない」と判定済みのメールを再処理（Sheet登録済みのものは二重登録しません） |
| `python main.py --parse-pdf 請求書.pdf` | 手元のPDFをAI解析して結果を表示（Google設定不要） |
| `python main.py --init-drive` | Driveに「請求書」フォルダを作成 |
| `python main.py --test` | 設定と接続を確認 |
| `python main.py --verbose` | 詳細ログ（エラーのスタックトレースも出力） |
| `python main.py --create-drafts` | Phase 2 で実装予定 |

MESSAGE_ID は、Gmailでメールを開いた状態のURL末尾（`#inbox/` の後ろ）や、ログの `Gmail message detected` の後ろに出ている値です。

## 定期実行（30分ごと）

Mac / Linux の cron の例（`crontab -e` で追記）:

```cron
*/30 * * * * cd /path/to/invoice-automation && .venv/bin/python main.py >> data/logs/cron.log 2>&1
```

Windows はタスクスケジューラで `.venv\Scripts\python.exe main.py`（開始フォルダ: `invoice-automation`）を30分ごとに実行します。

> 定期実行の前に、一度手動で `python main.py --test` を実行して `token.json` を作っておいてください。
> 画面の無い環境ではブラウザ認証ができないため、`token.json` が無いとエラーになります。

## 設定項目（.env）

| 項目 | 説明 | 既定値 |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic（Claude）APIキー | （必須） |
| `ANTHROPIC_MODEL` | 使用するClaudeモデル | `claude-opus-5-5` |
| `DRIVE_ROOT_FOLDER_ID` | 「請求書」フォルダのID | （必須） |
| `SPREADSHEET_ID` | 支払い一覧スプレッドシートのID | （必須） |
| `SHEET_NAME` | シート名 | `支払い一覧` |
| `GMAIL_ACCOUNT` | 認証時に使うアカウント（任意） | |
| `DRIVE_SCOPE` | `file`（最小権限）/ `full` | `file` |
| `TIMEZONE` | タイムゾーン | `Asia/Tokyo` |
| `INVOICE_CONFIDENCE_THRESHOLD` | これ未満のAI確信度は要確認 | `0.80` |
| `SCAN_DAYS` | 検索する日数 | `30` |

## 使用する Google 権限

| 権限 | 用途 |
| --- | --- |
| `gmail.readonly` | メール・添付の読み取り |
| `gmail.compose` | Phase 2 の返信「下書き」作成用（送信はしません） |
| `drive.file` | このツールが作ったフォルダ・ファイルのみ操作 |
| `spreadsheets` | 支払い一覧の読み書き |

## 困ったとき

| 症状 | 対処 |
| --- | --- |
| `credentials.json がありません` | 手順5〜6をやり直す |
| `invalid_grant` / 認証エラー | `token.json` を削除して `python main.py --test` で再認証 |
| Driveフォルダが見つからない (404) | `DRIVE_SCOPE=file` の場合、手動作成のフォルダは見えません。`--init-drive` で作り直すか `DRIVE_SCOPE=full` に |
| 請求書なのに登録されない | `python main.py --process-message ID --dry-run --force` で判定結果を確認 |
| もう一度処理させたい | シートの該当行を削除し、`data/processed_message_ids.json` から該当IDを削除 |

## ファイル構成

```
invoice-automation/
  main.py              CLI
  config.py            .env 読み込み
  logger.py            ログ（日本時間）
  models.py            AI出力スキーマ・シート行
  detector.py          請求書スコア判定・除外判定
  gmail_service.py     Gmail 検索・本文/添付取得
  drive_service.py     Drive 保存
  sheets_service.py    支払い一覧 読み書き
  invoice_parser.py    PDFテキスト抽出・Claudeによる抽出
  pipeline.py          1通ごとの処理の流れ
  google_auth.py       Google OAuth
  processed_store.py   処理済み message_id の記録
  tests/               自動テスト（pytest）
  data/                実行時に作成（処理済み記録・ログ。Git管理外）
```

## テスト

```bash
pip install -r requirements-dev.txt
python -m pytest
```

Gmail / Drive / Sheets / Claude API は偽物に差し替えてテストするため、APIキーなしで実行できます。

## 今後（Phase 2 / 3）

- Phase 2: シートB列が「支払済」の行を検知 → 元メールへの「お振込みいたしました」返信 **下書き** を作成、支払日の自動入力
- Phase 3: 重複請求の検知（請求書番号・取引先＋金額＋請求日）、PDFとメール本文の金額不一致チェック、通知
