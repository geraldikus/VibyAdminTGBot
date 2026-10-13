import type { sheets_v4 } from 'googleapis';
import { config } from '../config.js';
import { getSheets, withRetry } from './client.js';
import { bootstrapSheets } from './bootstrap.js';
import { COLUMNS, ID_COLUMNS, type SheetName } from './schema.js';

const CACHE_TTL_MS = 90_000;

type Row = Record<string, string>;

interface SheetCache {
  rows: Row[];
  fetchedAt: number;
}

class Mutex {
  private queue: Promise<void> = Promise.resolve();

  run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const prev = this.queue;
    this.queue = next;
    return prev.then(fn, fn).finally(release);
  }
}

export class SheetsRepo {
  private sheets!: sheets_v4.Sheets;
  private sheetIds: Record<SheetName, number> = {} as Record<SheetName, number>;
  private cache = new Map<SheetName, SheetCache>();
  private mutex = new Mutex();

  async init() {
    this.sheets = await getSheets();
    this.sheetIds = await bootstrapSheets();
  }

  async getAll(name: SheetName, force = false): Promise<Row[]> {
    const cached = this.cache.get(name);
    if (!force && cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return cached.rows;
    }
    const rows = await this.fetchSheet(name);
    this.cache.set(name, { rows, fetchedAt: Date.now() });
    return rows;
  }

  async findById(name: SheetName, id: string): Promise<Row | undefined> {
    const idCol = ID_COLUMNS[name];
    if (!idCol) return undefined;
    const rows = await this.getAll(name);
    return rows.find((row) => row[idCol] === id);
  }

  async updateSettingsKey(key: string, value: string | number) {
    const rows = await this.getAll('Settings', true);
    const index = rows.findIndex((row) => row.key === key);
    if (index < 0) {
      await this.appendRows('Settings', [{ key, value }]);
      return;
    }
    await withRetry(() =>
      this.sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `Settings!B${index + 2}`,
        valueInputOption: 'RAW',
        requestBody: { values: [[String(value)]] },
      }),
    );
    rows[index].value = String(value);
    this.cache.set('Settings', { rows, fetchedAt: Date.now() });
  }

  async refresh(name?: SheetName) {
    if (name) {
      this.cache.delete(name);
      await this.getAll(name, true);
      return;
    }
    this.cache.clear();
    await Promise.all(Object.keys(this.sheetIds).map((n) => this.getAll(n as SheetName, true)));
  }

  async write<T>(fn: () => Promise<T>): Promise<T> {
    return this.mutex.run(fn);
  }

  async appendRows(name: SheetName, records: Array<object>) {
    const columns = COLUMNS[name];
    const values = records.map((record) => columns.map((col) => stringify((record as Record<string, unknown>)[col])));
    await withRetry(() =>
      this.sheets.spreadsheets.values.append({
        spreadsheetId: config.spreadsheetId,
        range: `${name}!A:A`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values },
      }),
    );
    const cached = this.cache.get(name);
    const asRows = records.map((record) => toRow(record as Record<string, unknown>, columns));
    if (cached) {
      cached.rows.push(...asRows);
      cached.fetchedAt = Date.now();
    }
  }

  async updateById(name: SheetName, id: string, patch: Record<string, unknown>): Promise<Row> {
    const idCol = ID_COLUMNS[name];
    if (!idCol) throw new Error(`Sheet ${name} has no id column`);
    const rows = await this.getAll(name, true);
    const index = rows.findIndex((row) => row[idCol] === id);
    if (index < 0) throw new Error(`${name} row ${id} not found`);
    const next = { ...rows[index], ...Object.fromEntries(
      Object.entries(patch).map(([k, v]) => [k, stringify(v)]),
    ) };
    const columns = COLUMNS[name];
    const sheetRow = index + 2;
    await withRetry(() =>
      this.sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${name}!A${sheetRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [columns.map((col) => next[col] ?? '')] },
      }),
    );
    rows[index] = next;
    this.cache.set(name, { rows, fetchedAt: Date.now() });
    return next;
  }

  async batchAtomic(ops: AtomicOp[]) {
    const requests: sheets_v4.Schema$Request[] = [];
    const localApplies: Array<() => void> = [];

    for (const op of ops) {
      const columns = COLUMNS[op.sheet];
      const sheetId = this.sheetIds[op.sheet];
      if (op.kind === 'append') {
        const rows = await this.getAll(op.sheet);
        const startRow = rows.length + 1;
        const values = op.records.map((record) =>
          columns.map((col) => ({ userEnteredValue: cellValue((record as Record<string, unknown>)[col]) })),
        );
        requests.push({
          updateCells: {
            start: { sheetId, rowIndex: startRow, columnIndex: 0 },
            rows: values.map((valuesRow) => ({ values: valuesRow })),
            fields: 'userEnteredValue',
          },
        });
        localApplies.push(() => {
          const cached = this.cache.get(op.sheet);
          if (!cached) return;
          cached.rows.push(...op.records.map((record) => toRow(record as Record<string, unknown>, columns)));
          cached.fetchedAt = Date.now();
        });
      } else {
        const rows = await this.getAll(op.sheet);
        const idCol = ID_COLUMNS[op.sheet];
        if (!idCol) throw new Error(`Sheet ${op.sheet} has no id column`);
        const index = rows.findIndex((row) => row[idCol] === op.id);
        if (index < 0) throw new Error(`${op.sheet} row ${op.id} not found`);
        const next = {
          ...rows[index],
          ...Object.fromEntries(Object.entries(op.patch).map(([k, v]) => [k, stringify(v)])),
        };
        requests.push({
          updateCells: {
            start: { sheetId, rowIndex: index + 1, columnIndex: 0 },
            rows: [{
              values: columns.map((col) => ({ userEnteredValue: cellValue(next[col]) })),
            }],
            fields: 'userEnteredValue',
          },
        });
        localApplies.push(() => {
          const cached = this.cache.get(op.sheet);
          if (!cached) return;
          cached.rows[index] = next;
          cached.fetchedAt = Date.now();
        });
      }
    }

    await withRetry(() =>
      this.sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: { requests },
      }),
    );
    for (const apply of localApplies) apply();
  }

  private async fetchSheet(name: SheetName): Promise<Row[]> {
    const res = await withRetry(() =>
      this.sheets.spreadsheets.values.get({
        spreadsheetId: config.spreadsheetId,
        range: name,
        valueRenderOption: 'UNFORMATTED_VALUE',
        dateTimeRenderOption: 'FORMATTED_STRING',
      }),
    );
    const values = res.data.values ?? [];
    if (!values.length) return [];
    const headers = values[0].map((h) => String(h));
    return values.slice(1).filter((row) => row.some((cell) => cell !== '' && cell != null)).map((row) => {
      const record: Row = {};
      for (const col of COLUMNS[name]) {
        const idx = headers.indexOf(col);
        record[col] = idx >= 0 ? stringify(row[idx]) : '';
      }
      return record;
    });
  }
}

type AtomicOp =
  | { kind: 'append'; sheet: SheetName; records: Array<object> }
  | { kind: 'update'; sheet: SheetName; id: string; patch: Record<string, unknown> };

function stringify(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
  return String(value);
}

function toRow(record: Record<string, unknown>, columns: readonly string[]): Row {
  const row: Row = {};
  for (const col of columns) row[col] = stringify(record[col]);
  return row;
}

function cellValue(value: unknown): sheets_v4.Schema$ExtendedValue {
  if (value === undefined || value === null || value === '') return { stringValue: '' };
  if (typeof value === 'number' && Number.isFinite(value)) return { numberValue: value };
  if (typeof value === 'boolean') return { boolValue: value };
  const asString = stringify(value);
  if (asString === 'TRUE') return { boolValue: true };
  if (asString === 'FALSE') return { boolValue: false };
  const asNumber = Number(asString);
  if (asString !== '' && Number.isFinite(asNumber) && /^-?\d+(\.\d+)?$/.test(asString)) {
    return { numberValue: asNumber };
  }
  return { stringValue: asString };
}

export const repo = new SheetsRepo();
