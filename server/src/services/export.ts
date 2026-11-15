import ExcelJS from 'exceljs';
import { InputFile } from 'grammy';
import { db, tx } from '../db/index.js';
import { COLUMNS, type SheetName } from '../sheets/schema.js';
import { todayYmd } from '../time.js';
import { httpError } from '../errors.js';
import { getApiOrNull } from './notify.js';

/** Sheet title in the file -> source table, columns as in the Google Sheets mirror. */
const TABLES: Array<{ title: string; sheet: SheetName; sql: string }> = [
  { title: 'Students', sheet: 'Students', sql: 'SELECT * FROM students ORDER BY name' },
  { title: 'Teachers', sheet: 'Teachers', sql: 'SELECT * FROM teachers ORDER BY name' },
  { title: 'Lessons', sheet: 'Lessons_Log', sql: 'SELECT * FROM lessons ORDER BY lesson_date DESC, created_at DESC' },
  { title: 'Balance history', sheet: 'Balance_Log', sql: 'SELECT * FROM balance_log ORDER BY created_at DESC' },
  { title: 'Business reports', sheet: 'Business_Reports', sql: 'SELECT * FROM business_reports ORDER BY month DESC, student_name' },
  { title: 'Audit log', sheet: 'Audit_Log', sql: 'SELECT * FROM audit_log ORDER BY id DESC' },
  { title: 'Settings', sheet: 'Settings', sql: 'SELECT key, value FROM settings ORDER BY key' },
];

const BOOL_COLUMNS = new Set(['active']);

/** Whole database as an .xlsx workbook, one sheet per table, from one consistent snapshot. */
export async function buildExcelBackup(): Promise<{ buffer: Buffer; filename: string; rows: number }> {
  const data = tx(() => TABLES.map((t) => db.prepare(t.sql).all() as Record<string, unknown>[]));

  const wb = new ExcelJS.Workbook();
  wb.created = new Date();
  let rows = 0;
  TABLES.forEach((t, i) => {
    const columns = COLUMNS[t.sheet];
    const ws = wb.addWorksheet(t.title, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = columns.map((key) => ({ header: key, key, width: Math.min(Math.max(key.length + 2, 12), 40) }));
    for (const record of data[i]) {
      const row: Record<string, unknown> = {};
      for (const col of columns) {
        const v = record[col];
        row[col] = BOOL_COLUMNS.has(col) ? (v ? 'TRUE' : 'FALSE') : v ?? '';
      }
      ws.addRow(row);
    }
    rows += data[i].length;
    const header = ws.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF293D5C' } };
    if (columns.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columns.length } };
  });

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return { buffer, filename: `school-backup-${todayYmd()}.xlsx`, rows };
}

/** Builds the workbook and sends it to the admin's private chat with the bot. */
export async function sendExcelBackup(telegramId: string): Promise<{ filename: string; bytes: number; rows: number }> {
  const api = getApiOrNull();
  if (!api) throw httpError('Bot is not running, cannot send the file', 503);
  const { buffer, filename, rows } = await buildExcelBackup();
  await api.sendDocument(telegramId, new InputFile(buffer, filename), {
    caption: `Database backup · ${rows} rows · ${(buffer.length / 1024).toFixed(0)} KB`,
  });
  return { filename, bytes: buffer.length, rows };
}
