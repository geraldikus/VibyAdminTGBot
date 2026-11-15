import fs from 'node:fs';
import path from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { InputFile } from 'grammy';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { todayYmd } from '../time.js';
import { getApiOrNull } from './notify.js';

/**
 * Online SQLite backup (safe while the bot is running), gzipped, kept for
 * BACKUP_KEEP_DAYS days. If BACKUP_TELEGRAM_CHAT_ID is set, the file is also
 * sent there so a copy lives outside the server.
 */
export async function runBackup(): Promise<string> {
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
  if (chatId && api) {
    try {
      await api.sendDocument(chatId, new InputFile(gz), { caption: `DB backup ${stamp}` });
    } catch (error) {
      console.error('Failed to send backup to Telegram', error);
    }
  }
  return gz;
}
