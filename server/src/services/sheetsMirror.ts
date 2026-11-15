import type { sheets_v4 } from 'googleapis';
import { config, hasGoogleCredentials } from '../config.js';
import { db, tx } from '../db/index.js';
import { getSheets, withRetry } from '../sheets/client.js';
import { COLUMNS, SHEET_NAMES, type SheetName } from '../sheets/schema.js';
import { nowIso } from '../time.js';

/**
 * One-way, read-only mirror: SQLite -> Google Sheets. The bot never reads the
 * sheet back, so manual edits there have no effect and are overwritten.
 */
const SOURCES: Record<SheetName, string> = {
  Settings: 'SELECT key, value FROM settings ORDER BY key',
  Teachers: 'SELECT * FROM teachers ORDER BY created_at',
  Students: 'SELECT * FROM students ORDER BY created_at',
  Lessons_Log: 'SELECT * FROM lessons ORDER BY created_at',
  Balance_Log: 'SELECT * FROM balance_log ORDER BY created_at',
  Audit_Log: 'SELECT * FROM audit_log ORDER BY id',
  Business_Reports: 'SELECT * FROM business_reports ORDER BY month, student_name',
};

const BOOL_COLUMNS = new Set(['active']);

export function mirrorEnabled(): boolean {
  return config.mirrorEnabled && Boolean(config.spreadsheetId) && hasGoogleCredentials();
}

function cell(column: string, value: unknown): string | number {
  if (value === null || value === undefined) return '';
  if (BOOL_COLUMNS.has(column)) return value ? 'TRUE' : 'FALSE';
  if (typeof value === 'number') return value;
  return String(value);
}

let running = false;

export async function mirrorToSheets(): Promise<{ rows: number } | null> {
  if (!mirrorEnabled() || running) return null;
  running = true;
  try {
    const sheets = await getSheets();
    await ensureSheets(sheets);

    // One read transaction = one consistent snapshot of every table.
    const data = tx(() =>
      Object.fromEntries(
        SHEET_NAMES.map((name) => [name, db.prepare(SOURCES[name]).all() as Record<string, unknown>[]]),
      ) as Record<SheetName, Record<string, unknown>[]>,
    );

    const updates: sheets_v4.Schema$ValueRange[] = [];
    const tails: string[] = [];
    let total = 0;
    for (const name of SHEET_NAMES) {
      const columns = COLUMNS[name];
      const rows = data[name].map((row) => columns.map((col) => cell(col, row[col])));
      total += rows.length;
      updates.push({ range: `${name}!A1`, values: [columns as string[], ...rows] });
      tails.push(`${name}!A${rows.length + 2}:ZZ`);
    }
    updates.push({ range: 'Settings!D1:D2', values: [['Read-only mirror of the bot database'], [`Updated ${nowIso()}`]] });

    await withRetry(() =>
      sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: { valueInputOption: 'RAW', data: updates },
      }),
    );
    await withRetry(() =>
      sheets.spreadsheets.values.batchClear({
        spreadsheetId: config.spreadsheetId,
        requestBody: { ranges: tails },
      }),
    );
    return { rows: total };
  } finally {
    running = false;
  }
}

let ensured = false;

async function ensureSheets(sheets: sheets_v4.Sheets) {
  if (ensured) return;
  const spreadsheet = await withRetry(() => sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId }));
  const existing = new Map(
    (spreadsheet.data.sheets ?? []).map((s) => [s.properties?.title ?? '', s.properties?.sheetId ?? 0]),
  );
  const missing = SHEET_NAMES.filter((name) => !existing.has(name));
  if (missing.length) {
    const res = await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: { requests: missing.map((title) => ({ addSheet: { properties: { title } } })) },
      }),
    );
    for (const reply of res.data.replies ?? []) {
      const props = reply.addSheet?.properties;
      if (props?.title && props.sheetId != null) existing.set(props.title, props.sheetId);
    }
  }
  // Drop the old dropdown validation (it would reject mirrored values) and freeze headers.
  const requests: sheets_v4.Schema$Request[] = SHEET_NAMES.flatMap((name) => {
    const sheetId = existing.get(name) ?? 0;
    return [
      { setDataValidation: { range: { sheetId, startRowIndex: 1 } } },
      {
        updateSheetProperties: {
          properties: { sheetId, gridProperties: { frozenRowCount: 1 } },
          fields: 'gridProperties.frozenRowCount',
        },
      },
      {
        repeatCell: {
          range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
          cell: {
            userEnteredFormat: {
              backgroundColor: { red: 0.16, green: 0.24, blue: 0.36 },
              textFormat: { foregroundColor: { red: 1, green: 1, blue: 1 }, bold: true },
            },
          },
          fields: 'userEnteredFormat(backgroundColor,textFormat)',
        },
      },
    ];
  });
  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({ spreadsheetId: config.spreadsheetId, requestBody: { requests } }),
  );
  ensured = true;
}
