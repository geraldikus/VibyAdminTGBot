import { db } from '../db/index.js';

/** Short-lived conversation state stored in SQLite, so it survives restarts and expires. */
const TTL_MS = 10 * 60_000;

const putStmt = db.prepare(
  `INSERT INTO bot_state (key, value, expires_at) VALUES (?, ?, ?)
   ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`,
);
const takeStmt = db.prepare<[string, number], { value: string }>(
  'DELETE FROM bot_state WHERE key = ? AND expires_at > ? RETURNING value',
);
const cleanupStmt = db.prepare<[number]>('DELETE FROM bot_state WHERE expires_at <= ?');

export function putState(key: string, value: string, ttlMs = TTL_MS) {
  putStmt.run(key, value, Date.now() + ttlMs);
}

/** Reads and deletes in one statement: a value can be consumed only once. */
export function takeState(key: string): string | undefined {
  return takeStmt.get(key, Date.now())?.value;
}

export function cleanupState() {
  cleanupStmt.run(Date.now());
}
