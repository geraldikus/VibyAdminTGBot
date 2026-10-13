import { google, type sheets_v4 } from 'googleapis';
import { loadGoogleCredentials } from '../config.js';

let sheetsClient: sheets_v4.Sheets | null = null;

export async function getSheets(): Promise<sheets_v4.Sheets> {
  if (sheetsClient) return sheetsClient;
  const credentials = loadGoogleCredentials();
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  sheetsClient = google.sheets({ version: 'v4', auth });
  return sheetsClient;
}

export async function withRetry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = (error as { code?: number; status?: number }).code
        ?? (error as { code?: number; status?: number }).status;
      const message = error instanceof Error ? error.message : String(error);
      const retryable = status === 429 || status === 503 || /quota|rate/i.test(message);
      if (!retryable || i === attempts - 1) throw error;
      const delay = Math.min(1000 * 2 ** i, 16_000) + Math.floor(Math.random() * 250);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}
