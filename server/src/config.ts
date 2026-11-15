import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

function optional(name: string, fallback = ''): string {
  return process.env[name]?.trim() || fallback;
}

const credentialsPath = optional('GOOGLE_CREDENTIALS_PATH', './credentials.json');
const credentialsJson = optional('GOOGLE_CREDENTIALS_JSON');

export const config = {
  rootDir,
  port: Number(optional('PORT', '3000')),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProd: optional('NODE_ENV', 'development') === 'production',
  botToken: optional('BOT_TOKEN'),
  adminIds: optional('ADMIN_IDS')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  dbPath: path.resolve(rootDir, optional('DB_PATH', './data/school.db')),
  backupDir: path.resolve(rootDir, optional('BACKUP_DIR', './data/backups')),
  backupKeepDays: Number(optional('BACKUP_KEEP_DAYS', '14')),
  /** Optional: Google Sheet used only as a one-way read-only mirror (DB -> Sheets). */
  spreadsheetId: optional('SPREADSHEET_ID'),
  /** Must be explicitly enabled: the mirror OVERWRITES the whole spreadsheet. */
  mirrorEnabled: optional('SHEETS_MIRROR') === '1',
  mirrorEveryMin: Number(optional('SHEETS_MIRROR_EVERY_MIN', '15')),
  credentialsPath: path.resolve(rootDir, credentialsPath),
  credentialsJson,
  photoChannelId: optional('PHOTO_CHANNEL_ID'),
  webappUrl: optional('WEBAPP_URL', 'http://localhost:5173'),
  webhookSecret: optional('WEBHOOK_SECRET'),
  publicUrl: optional('PUBLIC_URL'),
};

export function assertProdConfig() {
  if (!config.isProd) return;
  if (!config.adminIds.length) throw new Error('ADMIN_IDS must be set in production');
  if (config.publicUrl && !/^[A-Za-z0-9_-]{32,256}$/.test(config.webhookSecret)) {
    throw new Error('WEBHOOK_SECRET must be 32-256 chars of [A-Za-z0-9_-] in production');
  }
}

export function hasGoogleCredentials(): boolean {
  return Boolean(config.credentialsJson) || fs.existsSync(config.credentialsPath);
}

export function loadGoogleCredentials(): object {
  if (config.credentialsJson) {
    return JSON.parse(config.credentialsJson);
  }
  if (!fs.existsSync(config.credentialsPath)) {
    throw new Error(`Google credentials file not found: ${config.credentialsPath}`);
  }
  return JSON.parse(fs.readFileSync(config.credentialsPath, 'utf8'));
}

export function isAdmin(telegramId: string | number): boolean {
  return config.adminIds.includes(String(telegramId));
}
