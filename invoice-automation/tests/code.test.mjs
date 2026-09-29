import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeFile, loadGas, claudeOk, VALID } from './gas-fakes.mjs';

const PDF = 'application/pdf';
const plain = (v) => JSON.parse(JSON.stringify(v));
const col = (env, name) => env.gas.COL[name] - 1;
const rowOf = (env, r) => env.main.row(r);
const lastLog = (env) => env.sheets.get('処理ログ')?.data.at(-1);

// ---- 取り込みの流れ ---------------------------------------------------------

test('請求書を読み取って1行登録し、処理済/YYYY/MM へ移動・改名する', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  const file = env.inbox.add(new FakeFile('scan001.pdf', PDF));
  const r = env.gas.processInbox();
  assert.equal(r.registered, 1);

  const row = rowOf(env, 2);
  assert.equal(row[col(env, 'ID')], 1);
  assert.equal(row[col(env, 'ステータス')], '未払い');
  assert.equal(row[col(env, '要確認')], false);
  assert.equal(row[col(env, '支払期限')], '2026-10-31');
  assert.equal(row[col(env, '取引先')], '株式会社サンプル');
  assert.equal(row[col(env, '請求金額')], 110000);
  assert.equal(row[col(env, '口座番号')], '0123456');
  assert.equal(row[col(env, 'ファイルID')], file.id);
  assert.match(row[col(env, '請求書ファイル')], /^=HYPERLINK\(".*","2026-09-25_株式会社サンプル_110000_INV-1234\.pdf"\)$/);
  assert.match(row[col(env, '備考')], /元ファイル名: scan001\.pdf/);

  assert.equal(env.inbox.files.size, 0);
  assert.equal(file.parent, env.root.path('処理済', '2026', '09'));
  assert.equal(file.name, '2026-09-25_株式会社サンプル_110000_INV-1234.pdf');
});

test('Claude API へのリクエスト内容（PDF・出力形式・フォールバック）', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.processInbox();
  const { url, opts, body } = env.requests[0];
  assert.equal(url, 'https://api.anthropic.com/v1/messages');
  assert.equal(opts.headers['x-api-key'], 'sk-ant-test');
  assert.equal(opts.headers['anthropic-version'], '2023-06-01');
  assert.equal(opts.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(body.model, 'claude-opus-5-5');
  assert.equal(body.fallbacks, 'default');
  assert.equal(body.output_config.format.type, 'json_schema');
  assert.equal(body.output_config.format.schema.additionalProperties, false);
  assert.deepEqual(body.messages[0].content[0], { type: 'document', source: { type: 'base64', media_type: PDF, data: 'QUJD' } });
  assert.equal(body.messages[0].content[1].type, 'text');
});

test('画像ファイルは image ブロックで送る', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  env.inbox.add(new FakeFile('photo.JPG', 'image/jpeg'));
  env.gas.processInbox();
  assert.equal(env.requests[0].body.messages[0].content[0].type, 'image');
  assert.match(rowOf(env, 2)[col(env, '請求書ファイル')], /\.jpg"\)$/);
});

test('再実行しても二重登録しない（受付から移動済み）', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.processInbox();
  const r = env.gas.processInbox();
  assert.equal(r.registered, 0);
  assert.equal(env.main.getLastRow(), 2);
  assert.equal(env.requests.length, 1);
});

test('登録後に移動できていなかったファイルは、再登録せず移動だけやり直す', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  const file = env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.processInbox();
  env.inbox.add(file); // 移動前に止まった状態を再現
  env.gas.processInbox();
  assert.equal(env.main.getLastRow(), 2);
  assert.equal(env.requests.length, 1);
  assert.equal(env.inbox.files.size, 0);
});

test('ID は既存の最大値の続きから振る。同名ファイルは _2 を付ける', () => {
  const env = loadGas({ responses: [claudeOk(VALID), claudeOk(VALID)] });
  env.main.appendRow([41]);
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.inbox.add(new FakeFile('b.pdf', PDF));
  env.gas.processInbox();
  assert.deepEqual([rowOf(env, 3)[0], rowOf(env, 4)[0]], [42, 43]);
  const names = [...env.root.path('処理済', '2026', '09').files].map((f) => f.name).sort();
  assert.deepEqual(names, ['2026-09-25_株式会社サンプル_110000_INV-1234.pdf', '2026-09-25_株式会社サンプル_110000_INV-1234_2.pdf']);
});

test('確信度が低い・金額や期限が読めない → 未確認・要確認', () => {
  const env = loadGas({ responses: [claudeOk({ ...VALID, confidence: 0.6, amount_total: null, due_date: '' })] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  const r = env.gas.processInbox();
  assert.equal(r.review, 1);
  const row = rowOf(env, 2);
  assert.equal(row[col(env, 'ステータス')], '未確認');
  assert.equal(row[col(env, '要確認')], true);
  for (const s of ['AI確信度が低い', '金額が読み取れない', '支払期限が読み取れない']) assert.match(row[col(env, '備考')], new RegExp(s));
});

test('請求日が無ければファイル作成日で分類する', () => {
  const env = loadGas({ responses: [claudeOk({ ...VALID, invoice_date: '', invoice_number: '' })] });
  const f = env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.processInbox();
  assert.equal(f.name, '2026-09-28_株式会社サンプル_110000.pdf');
});

test('請求書でない書類は登録せず「対象外」へ移動', () => {
  const env = loadGas({ responses: [claudeOk({ ...VALID, is_invoice: false })] });
  const f = env.inbox.add(new FakeFile('見積書.pdf', PDF));
  const r = env.gas.processInbox();
  assert.equal(r.notInvoice, 1);
  assert.equal(env.main.getLastRow(), 1);
  assert.equal(f.parent, env.root.path('対象外'));
});

test('未対応の形式は未確認の行を残して「読取エラー」へ', () => {
  const env = loadGas();
  const f = env.inbox.add(new FakeFile('請求書.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'));
  const r = env.gas.processInbox();
  assert.equal(r.errors, 1);
  assert.equal(env.requests.length, 0);
  assert.equal(rowOf(env, 2)[col(env, 'ステータス')], '未確認');
  assert.match(rowOf(env, 2)[col(env, '備考')], /未対応のファイル形式/);
  assert.equal(f.parent, env.root.path('読取エラー'));
});

test('大きすぎるファイルは送らずにエラー行', () => {
  const env = loadGas();
  env.inbox.add(new FakeFile('big.jpg', 'image/jpeg', 6 * 1024 * 1024));
  env.gas.processInbox();
  assert.equal(env.requests.length, 0);
  assert.match(rowOf(env, 2)[col(env, '備考')], /大きすぎ/);
});

test('APIが400（パスワード付きPDFなど）→ エラー行を残して次のファイルへ進む', () => {
  const env = loadGas({ responses: [
    { code: 400, body: { error: { message: 'The PDF is encrypted' } } },
    claudeOk(VALID),
  ] });
  env.inbox.add(new FakeFile('locked.pdf', PDF));
  env.inbox.add(new FakeFile('ok.pdf', PDF));
  const r = env.gas.processInbox();
  assert.equal(r.errors, 1);
  assert.equal(r.registered, 1);
  assert.match(rowOf(env, 2)[col(env, '備考')], /パスワード付きPDFの可能性/);
});

test('混雑(529)・通信エラーは受付に残し、次に押したとき再挑戦、3回目でエラー行', () => {
  const env = loadGas({ responses: [{ code: 529, body: '{}' }, { throw: 'timeout' }, { code: 500, body: '' }] });
  const f = env.inbox.add(new FakeFile('a.pdf', PDF));
  assert.equal(env.gas.processInbox().retry, 1);
  assert.equal(env.gas.processInbox().retry, 1);
  assert.equal(f.parent, env.inbox);
  assert.equal(env.main.getLastRow(), 1);
  assert.equal(env.gas.processInbox().errors, 1);
  assert.equal(f.parent, env.root.path('読取エラー'));
  assert.equal(env.scriptProps.has(`retry_${f.id}`), false);
});

test('APIキーが違う(401)なら全体を中止し、ファイルは受付に残す', () => {
  const env = loadGas({ responses: [{ code: 401, body: { error: { message: 'invalid x-api-key' } } }] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.inbox.add(new FakeFile('b.pdf', PDF));
  assert.throws(() => env.gas.processInbox(), /APIキーが正しくない/);
  assert.equal(env.inbox.files.size, 2);
  assert.equal(env.requests.length, 1);
});

test('APIキー未設定なら分かるエラー', () => {
  const env = loadGas({ apiKey: null });
  assert.throws(() => env.gas.processInbox(), /APIキーが未設定/);
});

test('処理ログに記録する', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.processInbox();
  const log = lastLog(env);
  assert.equal(log[1], '登録');
  assert.match(log[3], /株式会社サンプル 110000円 → 未払い/);
});

// ---- 支払済にしたとき --------------------------------------------------------

function paidEnv(checker) {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.processInbox();
  env.main.set(2, env.gas.COL['確認者'], checker);
  env.main.set(2, env.gas.COL['ステータス'], '支払済');
  env.gas.onEdit({ range: env.main.getRange(2, env.gas.COL['ステータス']), oldValue: '未払い' });
  return env;
}

test('支払済にすると支払日と連絡メール文が入る', () => {
  const env = paidEnv('山田');
  const row = rowOf(env, 2);
  assert.match(row[col(env, '支払日')], /^\d{4}-\d{2}-\d{2}$/);
  const mail = row[col(env, '連絡メール文')];
  assert.match(mail, /^件名：お振込み完了のご連絡（請求書番号 INV-1234）/);
  assert.match(mail, /株式会社サンプル\nご担当者様/);
  assert.match(mail, /本日（\d{4}年\d{1,2}月\d{1,2}日）、請求書記載の金額をお振込みいたしました。/);
  assert.match(mail, /お振込金額：110,000円/);
  assert.match(mail, /ワールドダイブ株式会社$/);
});

test('確認者が空欄だと支払済にできず元に戻る', () => {
  const env = paidEnv('');
  const row = rowOf(env, 2);
  assert.equal(row[col(env, 'ステータス')], '未払い');
  assert.equal(row[col(env, '支払日')], '');
  assert.equal(env.toasts.length, 1);
});

test('他のシート・他の列の編集では何もしない', () => {
  const env = loadGas();
  env.main.appendRow(['1', '支払済']);
  env.gas.onEdit({ range: env.main.getRange(2, env.gas.COL['取引先']) });
  assert.equal(rowOf(env, 2)[col(env, '支払日')], undefined);
});

// ---- 純粋関数 ----------------------------------------------------------------

test('AI出力の正規化', () => {
  const { normalizeExtraction } = loadGas().gas;
  const e = normalizeExtraction({
    confidence: '0.9', vendor_name: null, invoice_date: '2026/9/5', due_date: '2026年10月31日',
    amount_total: '¥110,000', tax_amount: '１０，０００円', is_invoice: 'true',
  });
  assert.equal(e.invoice_date, '2026-09-05');
  assert.equal(e.due_date, '2026-10-31');
  assert.equal(e.amount_total, 110000);
  assert.equal(e.tax_amount, 10000);
  assert.equal(e.vendor_name, '');
  assert.equal(e.is_invoice, true);
  assert.equal(e.currency, 'JPY');

  const bad = normalizeExtraction({ due_date: '来月末', invoice_date: '2026-02-30', amount_total: '約10万円', confidence: 5 });
  assert.equal(bad.due_date, '');
  assert.equal(bad.invoice_date, '');
  assert.equal(bad.amount_total, null);
  assert.equal(bad.confidence, 1);
  assert.equal(bad.review_reasons.length, 3);
  assert.throws(() => normalizeExtraction([1]));
});

test('外貨建ては要確認', () => {
  const { normalizeExtraction, reviewReasons } = loadGas().gas;
  assert.deepEqual(plain(reviewReasons(normalizeExtraction({ ...VALID, currency: 'USD' }), 0.8)), ['外貨建て(USD)']);
  assert.deepEqual(plain(reviewReasons(normalizeExtraction(VALID), 0.8)), []);
});

test('ファイル名', () => {
  const { buildFileName, withSuffixNumber } = loadGas().gas;
  assert.equal(buildFileName('2026-09-29', '株式会社サンプル', 110000, 'INV-1234', 'x.pdf'), '2026-09-29_株式会社サンプル_110000_INV-1234.pdf');
  assert.equal(buildFileName('2026-09-29', 'A/B:C*D?"E<F>G|H\\', null, 'No/1', 'x.PDF'), '2026-09-29_ABCDEFGH_No1.pdf');
  assert.equal(buildFileName('2026-09-29', '', null, '', 'noext'), '2026-09-29_取引先不明.pdf');
  assert.equal(withSuffixNumber('a.pdf', 3), 'a_3.pdf');
});

test('メール文: 支払日が今日でなければ日付で書く・番号なしでも崩れない', () => {
  const { buildMailText } = loadGas().gas;
  const t = buildMailText({ vendor: '', amount: '', invoiceNumber: '', payDate: '2026-09-25' }, '2026-09-29');
  assert.match(t, /^件名：お振込み完了のご連絡\n\nご担当者様\n/);
  assert.match(t, /\n2026年9月25日、請求書記載の金額をお振込みいたしました。\nご確認のほど/);
});

test('APIレスポンスの解釈', () => {
  const { parseClaudeResponse } = loadGas().gas;
  assert.deepEqual(plain(parseClaudeResponse(200, JSON.stringify(claudeOk({ a: 1 }).body))), { a: 1 });
  assert.throws(() => parseClaudeResponse(200, JSON.stringify({ stop_reason: 'refusal', content: [] })), /拒否/);
  assert.throws(() => parseClaudeResponse(200, JSON.stringify({ stop_reason: 'max_tokens', content: [] })), /途中で切れ/);
  assert.throws(() => parseClaudeResponse(200, JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'x' }] })), /JSONではありません/);
  assert.equal((() => { try { parseClaudeResponse(429, '{}'); } catch (e) { return e.transient; } })(), true);
  assert.equal((() => { try { parseClaudeResponse(401, '{}'); } catch (e) { return e.fatal; } })(), true);
});

test('その他の補助関数', () => {
  const { extractDriveId, columnLetter, hyperlinkFormula, OUTPUT_SCHEMA } = loadGas().gas;
  assert.equal(extractDriveId('https://drive.google.com/drive/folders/1AbC_dEf-123?usp=sharing'), '1AbC_dEf-123');
  assert.throws(() => extractDriveId('not a url'));
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(22), 'V');
  assert.equal(columnLetter(28), 'AB');
  assert.equal(hyperlinkFormula('u', 'a"b'), '=HYPERLINK("u","a""b")');
  assert.deepEqual(plain(OUTPUT_SCHEMA.required.slice().sort()), Object.keys(OUTPUT_SCHEMA.properties).sort());
});

// ---- 初期設定・メニュー --------------------------------------------------------

test('初期設定: ヘッダー・入力規則・期限アラートの条件付き書式・フォルダ作成', () => {
  const env = loadGas();
  env.gas.menuSetup();
  const sheet = env.main;
  assert.deepEqual(plain(sheet.row(1)), plain(env.gas.COLUMNS));
  const c = env.gas.COL;
  assert.ok(sheet.calls.some(([k, col, v]) => k === 'validation' && col === c['ステータス'] && v.list.includes('支払済')));
  assert.ok(sheet.calls.some(([k, col, f]) => k === 'format' && col === c['口座番号'] && f === '@'));
  assert.ok(sheet.calls.some(([k, col, f]) => k === 'format' && col === c['支払期限'] && f === 'yyyy-mm-dd'));
  assert.deepEqual(sheet.hidden, [c['ファイルID']]);
  const formulas = sheet.rules.map((r) => r.formula);
  assert.deepEqual(plain(formulas), [
    '=$B2="支払済"',
    '=AND($E2<>"",$E2<TODAY(),OR($B2="未払い",$B2="未確認",$B2="保留"))',
    '=AND($E2<>"",$E2-TODAY()<=3,OR($B2="未払い",$B2="未確認",$B2="保留"))',
    '=AND($E2<>"",$E2-TODAY()<=7,OR($B2="未払い",$B2="未確認",$B2="保留"))',
  ]);
  for (const n of ['受付', '処理済', '読取エラー', '対象外']) assert.ok(env.root.path(n), n);
  assert.ok(env.sheets.get('処理ログ'));
  assert.match(env.alerts[0][1], /受付フォルダ/);
});

test('取り込みボタン: 結果をダイアログで表示', () => {
  const env = loadGas({ responses: [claudeOk(VALID)] });
  env.inbox.add(new FakeFile('a.pdf', PDF));
  env.gas.menuImport();
  assert.match(env.alerts[0][1], /登録（未払い）: 1件/);
});
