/**
 * 請求書取り込み（Google Apps Script）
 *
 * Googleドライブの「請求書/受付」フォルダに入れた請求書（PDF・画像）を、
 * 「📥 請求書を取り込む」ボタンで Claude に読み取らせ、このスプレッドシートの「支払い一覧」に登録する。
 * ステータスを「支払済」にすると、支払日と「お振込みしました」の連絡メール文を自動で入れる。
 *
 * - 銀行振込・メール送信は行わない（メール文はテキストで出力するだけ）
 * - Claude の読み取り結果は誤りうるため、怪しいものは「未確認」「要確認」にする
 */

// ===== 設定（必要に応じて変更） =================================================

const CONFIG = {
  COMPANY_NAME: 'ワールドダイブ株式会社', // 連絡メール文の署名
  SHEET_NAME: '支払い一覧',
  LOG_SHEET_NAME: '処理ログ',
  ROOT_FOLDER_NAME: '請求書',
  INBOX_FOLDER_NAME: '受付',               // ここに請求書を入れる
  DONE_FOLDER_NAME: '処理済',              // 読み取り後に 処理済/YYYY/MM/ へ移動
  ERROR_FOLDER_NAME: '読取エラー',         // 読み取れなかったファイル
  NOT_INVOICE_FOLDER_NAME: '対象外',       // 見積書など請求書でないファイル
  MODEL: 'claude-opus-5-5',
  EFFORT: 'low',                          // 読み取りの丁寧さ: low / medium / high
  CONFIDENCE_THRESHOLD: 0.8,              // これ未満のAI確信度は「未確認」
  REQUIRE_CHECKER: true,                  // true: 確認者が空欄だと「支払済」にできない
  MAX_PDF_BYTES: 20 * 1024 * 1024,
  MAX_IMAGE_BYTES: 5 * 1024 * 1024,
  MAX_RETRIES: 3,                          // 通信エラー時、取り込みボタンを押すたびに再挑戦する回数
  MAX_RUN_MS: 4.5 * 60 * 1000,             // 1回の実行で処理に使う最大時間（上限6分）
  TIMEZONE: 'Asia/Tokyo',
};

const COLUMNS = [
  'ID', 'ステータス', '要確認', '確認者', '支払期限', '請求日', '取引先', '請求金額', '税額',
  '内容', '請求書番号', '銀行名', '支店名', '口座種別', '口座番号', '口座名義', '請求書ファイル',
  '支払日', '連絡メール文', '登録日時', '備考', 'ファイルID',
];
const COL = {};
COLUMNS.forEach(function (name, i) { COL[name] = i + 1; });
const TEXT_COLUMNS = ['確認者', '取引先', '内容', '請求書番号', '銀行名', '支店名', '口座種別', '口座番号', '口座名義', '連絡メール文', '備考', 'ファイルID'];

const STATUS = { UNCONFIRMED: '未確認', UNPAID: '未払い', PAID: '支払済', ON_HOLD: '保留', EXCLUDED: '対象外' };
const STATUS_LIST = [STATUS.UNCONFIRMED, STATUS.UNPAID, STATUS.PAID, STATUS.ON_HOLD, STATUS.EXCLUDED];

const SUPPORTED_TYPES = {
  'application/pdf': 'document',
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/gif': 'image',
  'image/webp': 'image',
};

// ===== Claude への指示 ==========================================================

const SYSTEM_PROMPT = [
  'あなたは日本企業向けの請求書解析AIです。',
  '添付された書類（請求書PDFまたは画像）から、支払いに必要な情報をJSONで抽出してください。',
  '',
  'ルール：',
  '- 書いていない情報は推測しない。不明な文字項目は空文字、不明な金額は null にする',
  '- 曖昧な場合は needs_review=true とし、理由を review_reasons に日本語で短く書く',
  '- 金額は整数（カンマ・円記号なし）。税込の請求総額を amount_total に設定',
  '- 日付は YYYY-MM-DD。和暦は西暦に直す',
  '- 支払期限が「翌月末」などの相対表現なら invoice_date から計算してよい',
  '- 日本円は currency="JPY"',
  '- 振込先口座が複数ある場合は needs_review=true',
  '- 「再発行」「訂正」「差替」などの記載がある場合は needs_review=true とし、その旨を理由に書く',
  '- 見積書・納品書・発注書・契約書・領収書・パンフレットの場合は is_invoice=false',
  '- confidence は「これが支払うべき請求書であり、抽出値が正しい」ことへの確信度（0.0〜1.0）',
].join('\n');

const OUTPUT_SCHEMA = (function () {
  const str = { type: 'string' };
  const intOrNull = { anyOf: [{ type: 'integer' }, { type: 'null' }] };
  const props = {
    is_invoice: { type: 'boolean' },
    confidence: { type: 'number' },
    vendor_name: str,
    invoice_number: str,
    invoice_date: { type: 'string', description: 'YYYY-MM-DD。不明なら空文字' },
    due_date: { type: 'string', description: 'YYYY-MM-DD。不明なら空文字' },
    amount_total: intOrNull,
    tax_amount: intOrNull,
    currency: str,
    bank_name: str,
    bank_branch: str,
    account_type: str,
    account_number: str,
    account_holder: str,
    description: str,
    payment_method: str,
    needs_review: { type: 'boolean' },
    review_reasons: { type: 'array', items: str },
  };
  return { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false };
})();

// ===== メニュー ================================================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('請求書')
    .addItem('📥 請求書を取り込む', 'menuImport')
    .addItem('✉️ 選択行の連絡メール文を表示', 'menuShowMail')
    .addSeparator()
    .addItem('⚙️ 初期設定', 'menuSetup')
    .addItem('🔑 APIキーを設定', 'menuSetApiKey')
    .addToUi();
}

/** 「📥 請求書を取り込む」ボタン・メニュー */
function menuImport() {
  const ui = SpreadsheetApp.getUi();
  try {
    const r = processInbox();
    ui.alert('請求書の取り込み', summarize(r), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('取り込みを中止しました', String(e.message || e), ui.ButtonSet.OK);
  }
}

function menuSetApiKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('APIキーを設定', 'Anthropic の APIキー（sk-ant-...）を貼り付けてください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (!/^sk-ant-/.test(key)) {
    ui.alert('APIキーの形式が違うようです（sk-ant- で始まります）。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty('ANTHROPIC_API_KEY', key);
  ui.alert('APIキーを保存しました。');
}

function menuSetup() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getDocumentProperties();
  let root = folderById(props.getProperty('ROOT_FOLDER_ID'));
  if (!root) {
    const res = ui.prompt('初期設定',
      '請求書を管理するGoogleドライブのフォルダURLを貼り付けてください。\n空欄のままOKを押すと、マイドライブに「' +
      CONFIG.ROOT_FOLDER_NAME + '」フォルダを新しく作ります。', ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const url = res.getResponseText().trim();
    root = url ? DriveApp.getFolderById(extractDriveId(url)) : DriveApp.createFolder(CONFIG.ROOT_FOLDER_NAME);
    props.setProperty('ROOT_FOLDER_ID', root.getId());
  }
  const folders = ensureFolders(root);
  setupSheet();
  getLogSheet();
  ui.alert('初期設定が完了しました',
    '請求書の入れ先（受付フォルダ）:\n' + folders.inbox.getUrl() +
    '\n\n次に「🔑 APIキーを設定」を実行してください。', ui.ButtonSet.OK);
}

/** 選択中の行の連絡メール文を（最新の値で作り直して）表示する */
function menuShowMail() {
  const sheet = getSheet();
  const row = sheet.getActiveRange().getRow();
  if (row < 2) {
    SpreadsheetApp.getUi().alert('支払い一覧のデータ行を選択してから実行してください。');
    return;
  }
  const values = sheet.getRange(row, 1, 1, COLUMNS.length).getValues()[0];
  const text = mailTextForRow(values, todayJst());
  sheet.getRange(row, COL['連絡メール文']).setValue(text);
  const html = HtmlService.createHtmlOutput(
    '<textarea id="t" style="width:100%;height:330px;font-size:13px">' + escapeHtml(text) + '</textarea>' +
    '<button onclick="var t=document.getElementById(\'t\');t.select();document.execCommand(\'copy\');this.textContent=\'コピーしました\'">コピー</button>'
  ).setWidth(520).setHeight(400);
  SpreadsheetApp.getUi().showModalDialog(html, '連絡メール文（' + (values[COL['取引先'] - 1] || '取引先不明') + '）');
}

// ===== 取り込み処理 ============================================================

/**
 * 受付フォルダのファイルを順に処理する。
 * 1件失敗しても残りは続ける。処理済みのファイルは受付フォルダから移動するので二重登録しない。
 */
function processInbox() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return { busy: true };
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('ANTHROPIC_API_KEY');
    if (!apiKey) throw new Error('APIキーが未設定です。メニュー「請求書 > 🔑 APIキーを設定」を実行してください。');
    const folders = getFolders();
    const sheet = getSheet();
    const started = Date.now();
    const result = { registered: 0, review: 0, notInvoice: 0, errors: 0, retry: 0, remaining: 0 };
    const known = registeredFileIds(sheet);

    const files = [];
    const it = folders.inbox.getFiles();
    while (it.hasNext()) files.push(it.next());

    for (let i = 0; i < files.length; i++) {
      if (Date.now() - started > CONFIG.MAX_RUN_MS) {
        result.remaining = files.length - i;
        break;
      }
      const file = files[i];
      try {
        const outcome = processFile(file, apiKey, folders, sheet, known);
        result[outcome] = (result[outcome] || 0) + 1;
      } catch (e) {
        if (e.fatal) {
          result.remaining = files.length - i;
          appendLog('中止', file.getName(), e.message);
          throw e;
        }
        result.errors++;
        appendLog('エラー', file.getName(), String(e.message || e));
      }
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

/** 1ファイルを処理し、結果の種類（registered / review / notInvoice / errors / retry）を返す */
function processFile(file, apiKey, folders, sheet, known) {
  const name = file.getName();
  const fileId = file.getId();

  if (known[fileId]) {
    // 登録済み（前回、移動の直前で止まった）→ 移動だけやり直す
    moveToDone(file, folders, null, null);
    return 'registered';
  }

  const mime = file.getMimeType();
  const kind = SUPPORTED_TYPES[mime];
  if (!kind) {
    return registerError(file, folders, sheet, '未対応のファイル形式です（' + mime + '）。PDFか画像で入れてください');
  }
  const limit = kind === 'document' ? CONFIG.MAX_PDF_BYTES : CONFIG.MAX_IMAGE_BYTES;
  if (file.getSize() > limit) {
    return registerError(file, folders, sheet, 'ファイルが大きすぎます（上限 ' + Math.round(limit / 1024 / 1024) + 'MB）');
  }

  let raw;
  try {
    raw = callClaude(apiKey, file.getBlob(), kind, name);
  } catch (e) {
    if (e.fatal) throw e;
    if (e.transient) {
      const tries = bumpRetry(fileId);
      if (tries < CONFIG.MAX_RETRIES) {
        appendLog('再試行待ち', name, e.message + '（' + tries + '回目）');
        return 'retry';
      }
    }
    clearRetry(fileId);
    return registerError(file, folders, sheet, '読み取り失敗: ' + e.message);
  }
  clearRetry(fileId);

  const ext = normalizeExtraction(raw);
  if (!ext.is_invoice) {
    moveTo(file, folders.notInvoice);
    appendLog('対象外', name, '請求書ではないと判定（確信度 ' + ext.confidence.toFixed(2) + '）→「' + CONFIG.NOT_INVOICE_FOLDER_NAME + '」へ移動');
    return 'notInvoice';
  }

  const fileDate = ext.invoice_date || formatJst(file.getDateCreated(), 'yyyy-MM-dd');
  const newName = buildFileName(fileDate, ext.vendor_name, ext.amount_total, ext.invoice_number, name);
  const record = buildRecord(ext, {
    id: nextId(sheet),
    fileId: fileId,
    fileUrl: file.getUrl(),
    fileName: newName,
    originalName: name,
    now: formatJst(new Date(), 'yyyy-MM-dd HH:mm:ss'),
    threshold: CONFIG.CONFIDENCE_THRESHOLD,
  });
  appendRecord(sheet, record.row);
  known[fileId] = true;
  moveToDone(file, folders, fileDate, newName);
  appendLog('登録', name, (ext.vendor_name || '取引先不明') + ' ' + (ext.amount_total == null ? '金額不明' : ext.amount_total + '円') +
    ' → ' + record.status + (record.reasons.length ? '（' + record.reasons.join('、') + '）' : ''));
  return record.needsReview ? 'review' : 'registered';
}

/** 読み取れなかったファイルを「未確認」の行として残し、読取エラーフォルダへ移動する */
function registerError(file, folders, sheet, message) {
  const row = emptyRow();
  row[COL['ID'] - 1] = nextId(sheet);
  row[COL['ステータス'] - 1] = STATUS.UNCONFIRMED;
  row[COL['要確認'] - 1] = true;
  row[COL['請求書ファイル'] - 1] = hyperlinkFormula(file.getUrl(), file.getName());
  row[COL['登録日時'] - 1] = formatJst(new Date(), 'yyyy-MM-dd HH:mm:ss');
  row[COL['備考'] - 1] = message;
  row[COL['ファイルID'] - 1] = file.getId();
  appendRecord(sheet, row);
  moveTo(file, folders.error);
  appendLog('読取エラー', file.getName(), message + ' →「' + CONFIG.ERROR_FOLDER_NAME + '」へ移動');
  return 'errors';
}

// ===== Claude API ==============================================================

function callClaude(apiKey, blob, kind, fileName) {
  const source = { type: 'base64', media_type: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
  const payload = {
    model: CONFIG.MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [{
      role: 'user',
      content: [
        { type: kind, source: source },
        { type: 'text', text: 'ファイル名: ' + fileName + '\n今日の日付: ' + todayJst() + '\nこの書類から請求情報を抽出してください。' },
      ],
    }],
    output_config: { effort: CONFIG.EFFORT, format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    // 安全判定で断られた場合、サーバー側で別のモデルに自動で引き継ぐ
    fallbacks: 'default',
  };

  let res;
  try {
    res = UrlFetchApp.fetch('https://api.anthropic.com/v1/messages', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
      },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
  } catch (e) {
    throw transientError('通信エラー: ' + (e.message || e));
  }
  return parseClaudeResponse(res.getResponseCode(), res.getContentText());
}

/** Claude API のレスポンスを解釈する（テスト可能なように分離） */
function parseClaudeResponse(code, body) {
  let data = null;
  try { data = JSON.parse(body); } catch (e) { /* 下で扱う */ }
  const apiMessage = data && data.error ? data.error.message : String(body).slice(0, 200);

  if (code === 401 || code === 403) {
    const err = new Error('APIキーが正しくないか、権限がありません（' + code + '）。「🔑 APIキーを設定」を確認してください。');
    err.fatal = true;
    throw err;
  }
  if (code === 429 || code === 529 || code >= 500) throw transientError('Claude APIが混雑しています（' + code + '）');
  if (code !== 200) {
    const hint = /password|encrypt/i.test(apiMessage) ? '（パスワード付きPDFの可能性）' : '';
    throw new Error('Claude APIエラー ' + code + ': ' + apiMessage + hint);
  }
  if (!data) throw new Error('Claude APIの応答を読めません');
  if (data.stop_reason === 'refusal') throw new Error('AIが読み取りを拒否しました');
  if (data.stop_reason === 'max_tokens') throw new Error('AIの出力が途中で切れました');
  const block = (data.content || []).filter(function (b) { return b.type === 'text'; })[0];
  if (!block) throw new Error('AIの応答にデータがありません');
  try {
    return JSON.parse(block.text);
  } catch (e) {
    throw new Error('AIの出力がJSONではありません: ' + block.text.slice(0, 100));
  }
}

function transientError(message) {
  const err = new Error(message);
  err.transient = true;
  return err;
}

function bumpRetry(fileId) {
  const props = PropertiesService.getScriptProperties();
  const n = Number(props.getProperty('retry_' + fileId) || 0) + 1;
  props.setProperty('retry_' + fileId, String(n));
  return n;
}

function clearRetry(fileId) {
  PropertiesService.getScriptProperties().deleteProperty('retry_' + fileId);
}

// ===== 読み取り結果の整形（純粋関数） ===========================================

function toHalfWidth(s) {
  return String(s).replace(/[！-～]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  }).replace(/　/g, ' ');
}

/** '2026-09-29' / '2026/9/29' / '2026年9月29日' → '2026-09-29'。空なら ''、解釈不能なら null */
function normalizeDate(value) {
  if (value === null || value === undefined) return '';
  const s = toHalfWidth(value).trim();
  if (!s) return '';
  const m = s.match(/^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + pad2(mo) + '-' + pad2(d);
}

/** 110000 / '110,000' / '¥110,000' / '110,000円' → 110000。空なら null、解釈不能なら NaN */
function normalizeAmount(value) {
  if (value === null || value === undefined || typeof value === 'boolean') return null;
  if (typeof value === 'number') return isFinite(value) ? Math.round(value) : NaN;
  const s = toHalfWidth(value).replace(/[¥￥,\s円]|JPY/g, '');
  if (!s) return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return NaN;
  return Math.round(Number(s));
}

function toBool(v, dflt) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', '1', 'yes'].indexOf(v.trim().toLowerCase()) >= 0;
  if (v === null || v === undefined) return dflt;
  return Boolean(v);
}

/** AIの出力を検証・正規化する。形式が不正な値は review_reasons に理由を足して空にする */
function normalizeExtraction(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('AIの出力がJSONオブジェクトではありません');
  const reasons = (Array.isArray(raw.review_reasons) ? raw.review_reasons : raw.review_reasons ? [raw.review_reasons] : [])
    .map(String).filter(function (r) { return r.trim(); });
  const out = {};
  ['vendor_name', 'invoice_number', 'currency', 'bank_name', 'bank_branch', 'account_type',
    'account_number', 'account_holder', 'description', 'payment_method'].forEach(function (k) {
    out[k] = raw[k] === null || raw[k] === undefined ? '' : String(raw[k]).trim();
  });
  if (!out.currency) out.currency = 'JPY';
  ['invoice_date', 'due_date'].forEach(function (k) {
    const d = normalizeDate(raw[k]);
    if (d === null) { reasons.push(k + ' の形式が不正: ' + raw[k]); out[k] = ''; } else { out[k] = d; }
  });
  ['amount_total', 'tax_amount'].forEach(function (k) {
    const a = normalizeAmount(raw[k]);
    if (Number.isNaN(a)) { reasons.push(k + ' の形式が不正: ' + raw[k]); out[k] = null; } else { out[k] = a; }
  });
  const conf = Number(raw.confidence);
  out.confidence = isFinite(conf) ? Math.min(Math.max(conf, 0), 1) : 0;
  out.is_invoice = toBool(raw.is_invoice, true);
  out.needs_review = toBool(raw.needs_review, false);
  out.review_reasons = reasons;
  return out;
}

/** 要確認とする理由の一覧 */
function reviewReasons(ext, threshold) {
  const reasons = ext.review_reasons.slice();
  if (ext.needs_review && reasons.length === 0) reasons.push('AIが要確認と判定');
  if (ext.confidence < threshold) reasons.push('AI確信度が低い(' + ext.confidence.toFixed(2) + ')');
  if (!ext.amount_total) reasons.push('金額が読み取れない');
  if (!ext.due_date) reasons.push('支払期限が読み取れない');
  if (ext.currency && ext.currency !== 'JPY') reasons.push('外貨建て(' + ext.currency + ')');
  return reasons.filter(function (r, i) { return reasons.indexOf(r) === i; });
}

/** シートに書く1行と、ステータス等を作る */
function buildRecord(ext, meta) {
  const reasons = reviewReasons(ext, meta.threshold);
  const needsReview = reasons.length > 0;
  const status = needsReview ? STATUS.UNCONFIRMED : STATUS.UNPAID;
  const notes = [];
  if (reasons.length) notes.push('要確認: ' + reasons.join('、'));
  notes.push('AI確信度 ' + ext.confidence.toFixed(2));
  notes.push('元ファイル名: ' + meta.originalName);

  const row = emptyRow();
  const set = function (col, v) { row[COL[col] - 1] = v; };
  set('ID', meta.id);
  set('ステータス', status);
  set('要確認', needsReview);
  set('支払期限', ext.due_date);
  set('請求日', ext.invoice_date);
  set('取引先', ext.vendor_name);
  set('請求金額', ext.amount_total === null ? '' : ext.amount_total);
  set('税額', ext.tax_amount === null ? '' : ext.tax_amount);
  set('内容', ext.description);
  set('請求書番号', ext.invoice_number);
  set('銀行名', ext.bank_name);
  set('支店名', ext.bank_branch);
  set('口座種別', ext.account_type);
  set('口座番号', ext.account_number);
  set('口座名義', ext.account_holder);
  set('請求書ファイル', hyperlinkFormula(meta.fileUrl, meta.fileName));
  set('登録日時', meta.now);
  set('備考', notes.join(' / '));
  set('ファイルID', meta.fileId);
  return { row: row, status: status, needsReview: needsReview, reasons: reasons };
}

function emptyRow() {
  return COLUMNS.map(function () { return ''; });
}

function sanitizeFilePart(s) {
  return String(s || '').replace(/[\/\\:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim().replace(/^\.+|\.+$/g, '');
}

/** YYYY-MM-DD_取引先名_金額_請求書番号.拡張子（不明な項目は省略） */
function buildFileName(dateStr, vendor, amount, invoiceNumber, originalName) {
  const m = String(originalName || '').match(/\.([A-Za-z0-9]+)$/);
  const ext = m ? m[1].toLowerCase() : 'pdf';
  const parts = [dateStr, sanitizeFilePart(vendor) || '取引先不明'];
  if (amount !== null && amount !== undefined && amount !== '') parts.push(String(amount));
  const num = sanitizeFilePart(invoiceNumber);
  if (num) parts.push(num);
  return parts.join('_') + '.' + ext;
}

function withSuffixNumber(fileName, n) {
  const i = fileName.lastIndexOf('.');
  return i > 0 ? fileName.slice(0, i) + '_' + n + fileName.slice(i) : fileName + '_' + n;
}

function hyperlinkFormula(url, label) {
  return '=HYPERLINK("' + String(url).replace(/"/g, '""') + '","' + String(label).replace(/"/g, '""') + '")';
}

// ===== 連絡メール文（純粋関数） =================================================

function pad2(n) { return (n < 10 ? '0' : '') + n; }

/** 'YYYY-MM-DD' → '2026年9月29日' */
function japaneseDate(ymd) {
  const m = String(ymd).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? Number(m[1]) + '年' + Number(m[2]) + '月' + Number(m[3]) + '日' : String(ymd);
}

function formatYen(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '円';
}

/**
 * 「お振込みいたしました」の連絡メール文。
 * info: { vendor, amount, invoiceNumber, payDate: 'YYYY-MM-DD' }, today: 'YYYY-MM-DD'
 */
function buildMailText(info, today) {
  const payDate = info.payDate || today;
  const when = payDate === today ? '本日（' + japaneseDate(payDate) + '）' : japaneseDate(payDate);
  const details = [];
  if (info.invoiceNumber) details.push('請求書番号：' + info.invoiceNumber);
  if (info.amount !== '' && info.amount !== null && info.amount !== undefined) details.push('お振込金額：' + formatYen(info.amount));
  const subject = '件名：お振込み完了のご連絡' + (info.invoiceNumber ? '（請求書番号 ' + info.invoiceNumber + '）' : '');
  const lines = [
    subject,
    '',
    info.vendor ? info.vendor + '\nご担当者様' : 'ご担当者様',
    '',
    'お世話になっております。',
    '',
    when + '、請求書記載の金額をお振込みいたしました。',
  ];
  if (details.length) lines.push(details.join('／'));
  lines.push('ご確認のほどよろしくお願いいたします。', '', '引き続きよろしくお願いいたします。', '', CONFIG.COMPANY_NAME);
  return lines.join('\n');
}

/** シートの1行（値の配列）からメール文を作る */
function mailTextForRow(values, today) {
  const get = function (col) { return values[COL[col] - 1]; };
  return buildMailText({
    vendor: String(get('取引先') || ''),
    amount: get('請求金額'),
    invoiceNumber: String(get('請求書番号') || ''),
    payDate: toYmd(get('支払日')) || today,
  }, today);
}

/** セルの値（Date または文字列）→ 'YYYY-MM-DD' */
function toYmd(v) {
  if (!v) return '';
  if (Object.prototype.toString.call(v) === '[object Date]') return formatJst(v, 'yyyy-MM-dd');
  return normalizeDate(v) || '';
}

// ===== 支払済にしたとき（編集トリガー） =========================================

/** シートが編集されたときに自動で呼ばれる */
function onEdit(e) {
  if (!e || !e.range) return;
  const sheet = e.range.getSheet();
  if (sheet.getName() !== CONFIG.SHEET_NAME) return;
  const statusCol = COL['ステータス'];
  const r = e.range;
  if (r.getColumn() > statusCol || r.getLastColumn() < statusCol || r.getLastRow() < 2) return;

  const firstRow = Math.max(r.getRow(), 2);
  const n = r.getLastRow() - firstRow + 1;
  const data = sheet.getRange(firstRow, 1, n, COLUMNS.length).getValues();
  const today = todayJst();
  const blocked = [];

  data.forEach(function (values, i) {
    if (values[statusCol - 1] !== STATUS.PAID) return;
    const row = firstRow + i;
    if (CONFIG.REQUIRE_CHECKER && !String(values[COL['確認者'] - 1]).trim()) {
      const single = r.getNumRows() === 1 && r.getNumColumns() === 1;
      sheet.getRange(row, statusCol).setValue(single && e.oldValue ? e.oldValue : STATUS.UNPAID);
      blocked.push(row);
      return;
    }
    if (!values[COL['支払日'] - 1]) {
      sheet.getRange(row, COL['支払日']).setValue(today);
      values[COL['支払日'] - 1] = today;
    }
    if (!values[COL['連絡メール文'] - 1]) {
      sheet.getRange(row, COL['連絡メール文']).setValue(mailTextForRow(values, today));
    }
  });

  if (blocked.length) {
    SpreadsheetApp.getActive().toast('確認者を入力してから「支払済」にしてください（' + blocked.join(', ') + '行目）', '確認者が未入力です', 8);
  }
}

// ===== シート・フォルダ ==========================================================

function getSheet() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('「' + CONFIG.SHEET_NAME + '」シートがありません。メニュー「請求書 > ⚙️ 初期設定」を実行してください。');
  return sheet;
}

function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(CONFIG.SHEET_NAME, 0);
  sheet.getRange(1, 1, 1, COLUMNS.length).setValues([COLUMNS]).setFontWeight('bold').setBackground('#e8eaed');
  sheet.setFrozenRows(1);

  // 2行目〜最終行まで（行が増えても自動で広がる範囲）
  const col = function (name) { const c = columnLetter(COL[name]); return sheet.getRange(c + '2:' + c); };
  col('ステータス').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUS_LIST, true).build());
  col('要確認').insertCheckboxes();
  TEXT_COLUMNS.forEach(function (name) { col(name).setNumberFormat('@'); });
  ['支払期限', '請求日', '支払日'].forEach(function (name) { col(name).setNumberFormat('yyyy-mm-dd'); });
  ['請求金額', '税額'].forEach(function (name) { col(name).setNumberFormat('#,##0'); });
  col('連絡メール文').setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  sheet.hideColumns(COL['ファイルID']);

  // ⑤ 支払期限アラート（未払い・未確認・保留の行に色）＋ 支払済の行はグレー
  const all = sheet.getRange('A2:' + columnLetter(COLUMNS.length));
  const due = '$' + columnLetter(COL['支払期限']) + '2';
  const st = '$' + columnLetter(COL['ステータス']) + '2';
  const open = 'OR(' + st + '="未払い",' + st + '="未確認",' + st + '="保留")';
  const rule = function (formula, bg, font) {
    const b = SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied(formula).setRanges([all]);
    if (bg) b.setBackground(bg);
    if (font) b.setFontColor(font);
    return b.build();
  };
  sheet.setConditionalFormatRules([
    rule('=' + st + '="支払済"', null, '#9aa0a6'),
    rule('=AND(' + due + '<>"",' + due + '<TODAY(),' + open + ')', '#f4c7c3', null),
    rule('=AND(' + due + '<>"",' + due + '-TODAY()<=3,' + open + ')', '#fce8b2', null),
    rule('=AND(' + due + '<>"",' + due + '-TODAY()<=7,' + open + ')', '#fff9db', null),
  ]);
  return sheet;
}

function columnLetter(n) {
  let s = '';
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function appendRecord(sheet, row) {
  const r = sheet.getLastRow() + 1;
  sheet.getRange(r, COL['要確認']).insertCheckboxes();
  sheet.getRange(r, 1, 1, row.length).setValues([row]);
}

function registeredFileIds(sheet) {
  const last = sheet.getLastRow();
  const ids = {};
  if (last < 2) return ids;
  sheet.getRange(2, COL['ファイルID'], last - 1, 1).getValues().forEach(function (v) { if (v[0]) ids[v[0]] = true; });
  return ids;
}

function nextId(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return 1;
  const ids = sheet.getRange(2, COL['ID'], last - 1, 1).getValues().map(function (v) { return Number(v[0]) || 0; });
  return Math.max.apply(null, ids) + 1;
}

function getLogSheet() {
  const ss = SpreadsheetApp.getActive();
  let sheet = ss.getSheetByName(CONFIG.LOG_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.LOG_SHEET_NAME);
    sheet.getRange(1, 1, 1, 4).setValues([['日時', '種別', 'ファイル', '内容']]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function appendLog(kind, fileName, message) {
  console.log(kind + ' ' + fileName + ' ' + message);
  try {
    getLogSheet().appendRow([formatJst(new Date(), 'yyyy-MM-dd HH:mm:ss'), kind, fileName, message]);
  } catch (e) {
    console.error(e);
  }
}

function folderById(id) {
  if (!id) return null;
  try { return DriveApp.getFolderById(id); } catch (e) { return null; }
}

function childFolder(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function ensureFolders(root) {
  return {
    root: root,
    inbox: childFolder(root, CONFIG.INBOX_FOLDER_NAME),
    done: childFolder(root, CONFIG.DONE_FOLDER_NAME),
    error: childFolder(root, CONFIG.ERROR_FOLDER_NAME),
    notInvoice: childFolder(root, CONFIG.NOT_INVOICE_FOLDER_NAME),
  };
}

function getFolders() {
  const root = folderById(PropertiesService.getDocumentProperties().getProperty('ROOT_FOLDER_ID'));
  if (!root) throw new Error('請求書フォルダが未設定です。メニュー「請求書 > ⚙️ 初期設定」を実行してください。');
  return ensureFolders(root);
}

function moveTo(file, folder) {
  file.moveTo(folder);
}

/** 処理済/YYYY/MM/ へ移動し、名前を付け直す（同名があれば _2, _3 …） */
function moveToDone(file, folders, ymd, newName) {
  const d = ymd || formatJst(file.getDateCreated(), 'yyyy-MM-dd');
  const month = childFolder(childFolder(folders.done, d.slice(0, 4)), d.slice(5, 7));
  if (newName) {
    let name = newName;
    for (let n = 2; month.getFilesByName(name).hasNext(); n++) name = withSuffixNumber(newName, n);
    file.setName(name);
  }
  file.moveTo(month);
}

function extractDriveId(url) {
  const m = String(url).match(/folders\/([A-Za-z0-9_-]+)/) || String(url).match(/[?&]id=([A-Za-z0-9_-]+)/);
  if (m) return m[1];
  if (/^[A-Za-z0-9_-]{10,}$/.test(url)) return url;
  throw new Error('フォルダのURLを読み取れません: ' + url);
}

// ===== 共通 ====================================================================

function formatJst(date, pattern) {
  return Utilities.formatDate(date, CONFIG.TIMEZONE, pattern);
}

function todayJst() {
  return formatJst(new Date(), 'yyyy-MM-dd');
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function summarize(r) {
  if (r.busy) return '別の取り込みが実行中です。少し待ってからもう一度お試しください。';
  const lines = [
    '登録（未払い）: ' + (r.registered || 0) + '件',
    '登録（要確認）: ' + (r.review || 0) + '件',
    '対象外（請求書でない）: ' + (r.notInvoice || 0) + '件',
    '読み取りエラー: ' + (r.errors || 0) + '件',
  ];
  if (r.retry) lines.push('通信エラーのため受付に残しました（もう一度押すと再挑戦）: ' + r.retry + '件');
  if (r.remaining) lines.push('時間切れで未処理: ' + r.remaining + '件（もう一度実行してください）');
  lines.push('', '詳しくは「' + CONFIG.LOG_SHEET_NAME + '」シートを確認してください。');
  return lines.join('\n');
}
