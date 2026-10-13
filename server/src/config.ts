import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
dotenv.config({ path: path.join(rootDir, '.env') });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

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
  adminIds: optional('ADMIN_IDS', '298752342')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  spreadsheetId: required('SPREADSHEET_ID'),
  credentialsPath: path.resolve(rootDir, credentialsPath),
  credentialsJson,
  photoChannelId: optional('PHOTO_CHANNEL_ID'),
  webappUrl: optional('WEBAPP_URL', 'http://localhost:5173'),
  webhookSecret: optional('WEBHOOK_SECRET', 'change-me'),
  publicUrl: optional('PUBLIC_URL'),
};

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
