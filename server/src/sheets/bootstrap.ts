import type { sheets_v4 } from 'googleapis';
import { DEFAULT_SETTINGS } from '@school/shared';
import { config } from '../config.js';
import { getSheets, withRetry } from './client.js';
import { COLUMNS, DROPDOWNS, SHEET_NAMES, type SheetName } from './schema.js';

const HEADER_BG = { red: 0.16, green: 0.24, blue: 0.36 };
const HEADER_FG = { red: 1, green: 1, blue: 1 };

export async function bootstrapSheets(): Promise<Record<SheetName, number>> {
  const sheets = await getSheets();
  const spreadsheet = await withRetry(() =>
    sheets.spreadsheets.get({ spreadsheetId: config.spreadsheetId }),
  );
  const existing = new Map(
    (spreadsheet.data.sheets ?? []).map((s) => [s.properties?.title ?? '', s.properties?.sheetId ?? 0]),
  );

  const requests: sheets_v4.Schema$Request[] = [];
  for (const name of SHEET_NAMES) {
    if (!existing.has(name)) {
      requests.push({ addSheet: { properties: { title: name } } });
    }
  }
  if (requests.length) {
    const added = await withRetry(() =>
      sheets.spreadsheets.batchUpdate({
        spreadsheetId: config.spreadsheetId,
        requestBody: { requests },
      }),
    );
    for (const reply of added.data.replies ?? []) {
      const props = reply.addSheet?.properties;
      if (props?.title && props.sheetId != null) {
        existing.set(props.title, props.sheetId);
      }
    }
  }

  const ids = {} as Record<SheetName, number>;
  for (const name of SHEET_NAMES) {
    ids[name] = existing.get(name) ?? 0;
  }

  await Promise.all(SHEET_NAMES.map((name) => ensureHeaders(sheets, name, ids[name])));
  await ensureSettingsDefaults(sheets);
  return ids;
}

async function ensureHeaders(sheets: sheets_v4.Sheets, name: SheetName, sheetId: number) {
  const columns = COLUMNS[name];
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: `${name}!1:1`,
    }),
  );
  const current = (res.data.values?.[0] ?? []).map(String);
  const missing = current.length === 0 || columns.some((col, i) => current[i] !== col);
  if (missing) {
    await withRetry(() =>
      sheets.spreadsheets.values.update({
        spreadsheetId: config.spreadsheetId,
        range: `${name}!A1`,
        valueInputOption: 'RAW',
        requestBody: { values: [columns as string[]] },
      }),
    );
  }

  const requests: sheets_v4.Schema$Request[] = [
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
            backgroundColor: HEADER_BG,
            textFormat: { foregroundColor: HEADER_FG, bold: true },
          },
        },
        fields: 'userEnteredFormat(backgroundColor,textFormat)',
      },
    },
  ];

  const dropdowns = DROPDOWNS[name] ?? {};
  for (const [column, values] of Object.entries(dropdowns)) {
    const colIndex = columns.indexOf(column);
    if (colIndex < 0) continue;
    requests.push({
      setDataValidation: {
        range: {
          sheetId,
          startRowIndex: 1,
          startColumnIndex: colIndex,
          endColumnIndex: colIndex + 1,
        },
        rule: {
          condition: {
            type: 'ONE_OF_LIST',
            values: values.map((v) => ({ userEnteredValue: v })),
          },
          showCustomUi: true,
          strict: true,
        },
      },
    });
  }

  await withRetry(() =>
    sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.spreadsheetId,
      requestBody: { requests },
    }),
  );
}

async function ensureSettingsDefaults(sheets: sheets_v4.Sheets) {
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: 'Settings!A:B',
      valueRenderOption: 'UNFORMATTED_VALUE',
    }),
  );
  const rows = res.data.values ?? [];
  const existing = new Set(rows.slice(1).map((r) => String(r[0] ?? '')));
  const defaults: Array<[string, string | number]> = [
    ['backdate_days', DEFAULT_SETTINGS.backdate_days],
    ['edit_window_min', DEFAULT_SETTINGS.edit_window_min],
    ['photo_reminder_min', DEFAULT_SETTINGS.photo_reminder_min],
    ['photo_admin_alert_min', DEFAULT_SETTINGS.photo_admin_alert_min],
    ['timezone', DEFAULT_SETTINGS.timezone],
    ['last_business_report', DEFAULT_SETTINGS.last_business_report],
  ];
  const missing = defaults.filter(([key]) => !existing.has(key));
  if (!missing.length) return;
  await withRetry(() =>
    sheets.spreadsheets.values.append({
      spreadsheetId: config.spreadsheetId,
      range: 'Settings!A:B',
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: missing },
    }),
  );
}
