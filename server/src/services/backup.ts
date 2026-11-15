import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { InputFile } from 'grammy';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { todayYmd } from '../time.js';
import { getApiOrNull } from './notify.js';
import { buildExcelBackup } from './export.js';

/**
 * Online SQLite backup (safe while the bot is running), gzipped, kept on the
 * server for BACKUP_KEEP_DAYS days. With `sendToTelegram` (the scheduler does
 * this on the 1st of each month) the .db.gz and an Excel copy are also sent to
 * BACKUP_TELEGRAM_CHAT_ID, so a copy lives outside the server.
 */
export async function runBackup(opts: { sendToTelegram?: boolean } = {}): Promise<string> {
  fs.mkdirSync(config.backupDir, { recursive: true });
  const stamp = todayYmd();
  const raw = path.join(config.backupDir, `school-${stamp}.db`);
  const gz = `${raw}.gz`;
  await db.backup(raw);
  await pipeline(fs.createReadStream(raw), createGzip(), fs.createWriteStream(gz));
  fs.rmSync(raw, { force: true });

  const cutoff = Date.now() - config.backupKeepDays * 86_400_000;
  for (const name of fs.readdirSync(config.backupDir)) {
    if (!/^school-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(name)) continue;
    const file = path.join(config.backupDir, name);
    if (fs.statSync(file).mtimeMs < cutoff) fs.rmSync(file, { force: true });
  }

  const chatId = process.env.BACKUP_TELEGRAM_CHAT_ID?.trim();
  const api = getApiOrNull();
  if (opts.sendToTelegram && chatId && api) {
    try {
      const excel = await buildExcelBackup();
      await api.sendDocument(chatId, new InputFile(excel.buffer, excel.filename), {
        caption: `Monthly backup ${stamp} · Excel (${excel.rows} rows)`,
      });
      await api.sendDocument(chatId, new InputFile(gz), {
        caption: `Monthly backup ${stamp} · database file for restore`,
      });
    } catch (error) {
      console.error('Failed to send backup to Telegram', error);
    }
  }
  return gz;
}
