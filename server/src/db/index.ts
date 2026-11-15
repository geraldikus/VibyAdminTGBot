import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { DEFAULT_SETTINGS } from '@school/shared';
import { config } from '../config.js';

/**
 * Single SQLite database. The process is the only writer, and better-sqlite3 is
 * synchronous, so `tx()` is a real atomic transaction: no other request can run
 * between its statements. Never `await` inside a transaction callback.
 */
fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');
db.pragma('foreign_keys = ON');

const MIGRATIONS: string[] = [
  // v1: initial schema
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE teachers (
    teacher_id  TEXT PRIMARY KEY,
    telegram_id TEXT NOT NULL DEFAULT '',
    name        TEXT NOT NULL,
    username    TEXT NOT NULL DEFAULT '',
    active      INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT NOT NULL
  );
  CREATE UNIQUE INDEX teachers_telegram_id ON teachers(telegram_id) WHERE telegram_id <> '';

  CREATE TABLE students (
    student_id   TEXT PRIMARY KEY,
    name         TEXT NOT NULL,
    contact      TEXT NOT NULL DEFAULT '',
    teacher_id   TEXT NOT NULL DEFAULT '',
    teacher_name TEXT NOT NULL DEFAULT '',
    type         TEXT NOT NULL CHECK (type IN ('subscription', 'business')),
    status       TEXT NOT NULL CHECK (status IN ('green', 'yellow', 'red', 'blue')),
    balance      REAL NOT NULL DEFAULT 0,
    notes        TEXT NOT NULL DEFAULT '',
    active       INTEGER NOT NULL DEFAULT 1,
    created_at   TEXT NOT NULL,
    updated_at   TEXT NOT NULL
  );
  CREATE INDEX students_teacher ON students(teacher_id);

  CREATE TABLE lessons (
    lesson_id        TEXT PRIMARY KEY,
    created_at       TEXT NOT NULL,
    lesson_date      TEXT NOT NULL,
    student_id       TEXT NOT NULL REFERENCES students(student_id),
    student_name     TEXT NOT NULL,
    teacher_id       TEXT NOT NULL,
    teacher_name     TEXT NOT NULL,
    duration_min     INTEGER NOT NULL,
    student_type     TEXT NOT NULL,
    status_at_lesson TEXT NOT NULL,
    state            TEXT NOT NULL CHECK (state IN ('pending_photo', 'done', 'cancelled')),
    photo_link       TEXT NOT NULL DEFAULT '',
    photo_file_id    TEXT NOT NULL DEFAULT '',
    photo_message_id TEXT NOT NULL DEFAULT '',
    balance_after    TEXT NOT NULL DEFAULT '',
    comment          TEXT NOT NULL DEFAULT '',
    confirmed_at     TEXT NOT NULL DEFAULT '',
    reminder_sent    TEXT NOT NULL DEFAULT '',
    admin_alerted    TEXT NOT NULL DEFAULT '',
    cancelled_at     TEXT NOT NULL DEFAULT '',
    cancelled_by     TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX lessons_teacher_date ON lessons(teacher_id, lesson_date);
  CREATE INDEX lessons_student ON lessons(student_id);
  CREATE INDEX lessons_state ON lessons(state);
  CREATE INDEX lessons_date ON lessons(lesson_date);

  CREATE TABLE balance_log (
    entry_id      TEXT PRIMARY KEY,
    created_at    TEXT NOT NULL,
    student_id    TEXT NOT NULL REFERENCES students(student_id),
    student_name  TEXT NOT NULL,
    change        REAL NOT NULL,
    balance_after REAL NOT NULL,
    reason        TEXT NOT NULL,
    lesson_id     TEXT NOT NULL DEFAULT '',
    "by"          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX balance_log_student ON balance_log(student_id, created_at);

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    entity     TEXT NOT NULL,
    entity_id  TEXT NOT NULL,
    field      TEXT NOT NULL,
    old_value  TEXT NOT NULL DEFAULT '',
    new_value  TEXT NOT NULL DEFAULT '',
    "by"       TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX audit_log_entity ON audit_log(entity, entity_id);

  CREATE TABLE business_reports (
    month         TEXT NOT NULL,
    student_id    TEXT NOT NULL,
    student_name  TEXT NOT NULL,
    teacher_name  TEXT NOT NULL,
    lessons_count INTEGER NOT NULL,
    total_minutes INTEGER NOT NULL,
    generated_at  TEXT NOT NULL,
    "trigger"     TEXT NOT NULL,
    PRIMARY KEY (month, student_id)
  );

  -- Short-lived bot conversation state (photo choice, photo replace). Survives restarts.
  CREATE TABLE bot_state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
  `,
];

function migrate() {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
    console.log(`DB migrated to v${v + 1}`);
  }
  const insert = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    insert.run(key, String(value));
  }
}

migrate();

export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export function optimize() {
  db.pragma('optimize');
}
