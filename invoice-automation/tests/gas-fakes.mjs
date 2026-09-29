// Code.gs を Node の vm で動かすための、Google Apps Script サービスの最小限の偽物
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CODE = fs.readFileSync(path.join(here, '../apps-script/Code.gs'), 'utf8');

let seq = 0;
export class FakeFile {
  constructor(name, mime, size = 1000, created = new Date('2026-09-28T01:00:00Z')) {
    this.id = `f${++seq}`; this.name = name; this.mime = mime; this.size = size; this.created = created; this.parent = null;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  setName(n) { this.name = n; return this; }
  getMimeType() { return this.mime; }
  getSize() { return this.size; }
  getDateCreated() { return this.created; }
  getUrl() { return `https://drive.google.com/file/d/${this.id}/view`; }
  getBlob() { const f = this; return { getContentType: () => f.mime, getBytes: () => [1, 2, 3] }; }
  moveTo(folder) { this.parent?.files.delete(this); folder.files.add(this); this.parent = folder; }
}

const iter = (arr) => { let i = 0; return { hasNext: () => i < arr.length, next: () => arr[i++] }; };

export class FakeFolder {
  constructor(name) { this.id = `d${++seq}`; this.name = name; this.files = new Set(); this.children = new Map(); }
  getId() { return this.id; }
  getUrl() { return `https://drive.google.com/drive/folders/${this.id}`; }
  getFiles() { return iter([...this.files]); }
  getFilesByName(n) { return iter([...this.files].filter((f) => f.name === n)); }
  getFoldersByName(n) { return iter(this.children.has(n) ? [this.children.get(n)] : []); }
  createFolder(n) { const f = new FakeFolder(n); this.children.set(n, f); return f; }
  add(file) { file.moveTo(this); return file; }
  path(...names) { return names.reduce((f, n) => f?.children.get(n), this); }
}

class FakeRange {
  constructor(sheet, row, col, rows, cols) { Object.assign(this, { sheet, row, col, rows, cols }); }
  getRow() { return this.row; } getColumn() { return this.col; }
  getLastRow() { return this.row + this.rows - 1; } getLastColumn() { return this.col + this.cols - 1; }
  getNumRows() { return this.rows; } getNumColumns() { return this.cols; }
  getSheet() { return this.sheet; }
  getValues() {
    return Array.from({ length: this.rows }, (_, r) => Array.from({ length: this.cols }, (_, c) => this.sheet.cell(this.row + r, this.col + c)));
  }
  setValues(vals) { vals.forEach((rv, r) => rv.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v))); return this; }
  setValue(v) { this.sheet.set(this.row, this.col, v); return this; }
  setFontWeight() { return this; }
  insertCheckboxes() { this.sheet.calls.push(['checkbox', this.col]); return this; }
  setDataValidation(v) { this.sheet.calls.push(['validation', this.col, v]); return this; }
  setNumberFormat(f) { this.sheet.calls.push(['format', this.col, f]); return this; }
  setWrapStrategy() { return this; }
  setBackground() { return this; }
}

export class FakeSheet {
  constructor(name) { this.name = name; this.data = []; this.calls = []; this.rules = []; this.hidden = []; }
  getName() { return this.name; }
  setFrozenRows() {}
  hideColumns(c) { this.hidden.push(c); }
  setConditionalFormatRules(r) { this.rules = r; }
  cell(r, c) { return this.data[r - 1]?.[c - 1] ?? ''; }
  set(r, c, v) { while (this.data.length < r) this.data.push([]); this.data[r - 1][c - 1] = v; }
  getLastRow() { return this.data.length; }
  getRange(r, c, rows = 1, cols = 1) {
    if (typeof r === 'string') { // 'E2:E' 形式
      const m = r.match(/^([A-Z]+)(\d+):([A-Z]+)$/);
      const n = (x) => [...x].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
      return new FakeRange(this, Number(m[2]), n(m[1]), 1000, n(m[3]) - n(m[1]) + 1);
    }
    return new FakeRange(this, r, c, rows, cols);
  }
  appendRow(v) { this.data.push(v); }
  row(r) { return this.data[r - 1]; }
}

export function loadGas({ responses = [], apiKey = 'sk-ant-test' } = {}) {
  const root = new FakeFolder('請求書');
  const sheets = new Map();
  const scriptProps = new Map(apiKey ? [['ANTHROPIC_API_KEY', apiKey]] : []);
  const docProps = new Map([['ROOT_FOLDER_ID', root.id]]);
  const requests = [];
  const toasts = [];
  const alerts = [];
  const props = (m) => ({ getProperty: (k) => m.get(k) ?? null, setProperty: (k, v) => m.set(k, v), deleteProperty: (k) => m.delete(k) });
  const ss = {
    getSheetByName: (n) => sheets.get(n) ?? null,
    insertSheet: (n) => { const s = new FakeSheet(n); sheets.set(n, s); return s; },
    toast: (...a) => toasts.push(a),
  };
  const main = ss.insertSheet('支払い一覧');
  main.appendRow([]); // ヘッダー行（内容はテストでは不要）

  const ctx = {
    console: { log() {}, error() {} },
    Utilities: {
      base64Encode: () => 'QUJD',
      formatDate: (d, tz, p) => {
        const s = new Date(d.getTime() + 9 * 3600e3).toISOString();
        return p.replace('yyyy', s.slice(0, 4)).replace('MM', s.slice(5, 7)).replace('dd', s.slice(8, 10))
          .replace('HH', s.slice(11, 13)).replace('mm', s.slice(14, 16)).replace('ss', s.slice(17, 19));
      },
    },
    PropertiesService: { getScriptProperties: () => props(scriptProps), getDocumentProperties: () => props(docProps) },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock() {} }) },
    DriveApp: { getFolderById: (id) => { if (id !== root.id) throw new Error('not found'); return root; } },
    SpreadsheetApp: {
      getActive: () => ss,
      WrapStrategy: { CLIP: 'CLIP' },
      newDataValidation: () => { const v = {}; const b = { requireValueInList: (l) => { v.list = l; return b; }, build: () => v }; return b; },
      newConditionalFormatRule: () => { const v = {}; const b = {
        whenFormulaSatisfied: (f) => { v.formula = f; return b; }, setRanges: (r) => { v.ranges = r; return b; },
        setBackground: (c) => { v.bg = c; return b; }, setFontColor: (c) => { v.font = c; return b; }, build: () => v }; return b; },
      getUi: () => ({ alert: (...a) => alerts.push(a), prompt: () => ({ getSelectedButton: () => 'OK', getResponseText: () => '' }),
        Button: { OK: 'OK' }, ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' } }),
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        requests.push({ url, opts, body: JSON.parse(opts.payload) });
        const r = responses.shift();
        if (!r) throw new Error('no fake response');
        if (r.throw) throw new Error(r.throw);
        return { getResponseCode: () => r.code ?? 200, getContentText: () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)) };
      },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\n;globalThis.__exports = { CONFIG, COL, COLUMNS, processInbox, onEdit, setupSheet, menuSetup, menuImport, normalizeExtraction, normalizeDate, normalizeAmount, reviewReasons, buildRecord, buildFileName, withSuffixNumber, buildMailText, mailTextForRow, parseClaudeResponse, hyperlinkFormula, extractDriveId, columnLetter, OUTPUT_SCHEMA };', ctx);
  const inbox = root.createFolder('受付');
  return { alerts, gas: ctx.__exports, root, inbox, main, sheets, requests, toasts, scriptProps, responses };
}

export function claudeOk(obj) {
  return { code: 200, body: { stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(obj) }] } };
}

export const VALID = {
  is_invoice: true, confidence: 0.95, vendor_name: '株式会社サンプル', invoice_number: 'INV-1234',
  invoice_date: '2026-09-25', due_date: '2026-10-31', amount_total: 110000, tax_amount: 10000, currency: 'JPY',
  bank_name: 'みずほ銀行', bank_branch: '渋谷支店', account_type: '普通', account_number: '0123456',
  account_holder: 'カ）サンプル', description: '9月分業務委託費', payment_method: '振込', needs_review: false, review_reasons: [],
};
