/**
 * One-time import: Google Sheets -> SQLite.
 *
 *   npm run migrate:sheets -- --dry-run   # read + validate + report, writes nothing
 *   npm run migrate:sheets                # import into an empty DB
 *   npm run migrate:sheets -- --force     # wipe DB tables first, then import
 *
 * Stop the old (Render) bot before the final run so no new rows appear meanwhile.
 */
import { config } from './config.js';
import { db } from './db/index.js';
import { getSheets, withRetry } from './sheets/client.js';
import { normDate as normDateRaw, normDateTime as normDateTimeRaw } from './sheets/dates.js';
import { COLUMNS, type SheetName } from './sheets/schema.js';
import {
  mapAudit,
  mapBalance,
  mapLesson,
  mapReport,
  mapStudent,
  mapTeacher,
} from './sheets/mappers.js';

const args = new Set(process.argv.slice(2));
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');

const warnings: string[] = [];
const warn = (msg: string) => warnings.push(msg);

const normDate = (raw: unknown, ctx: string) => normDateRaw(raw, ctx, warn);
const normDateTime = (raw: unknown, ctx: string) => normDateTimeRaw(raw, ctx, warn);

// ---------- read sheets ----------
type RawRow = Record<string, unknown>;

async function readSheet(name: SheetName): Promise<RawRow[]> {
  const sheets = await getSheets();
  const res = await withRetry(() =>
    sheets.spreadsheets.values.get({
      spreadsheetId: config.spreadsheetId,
      range: name,
      valueRenderOption: 'UNFORMATTED_VALUE',
      dateTimeRenderOption: 'SERIAL_NUMBER',
    }),
  );
  const values = res.data.values ?? [];
  if (!values.length) return [];
  const headers = values[0].map(String);
  return values.slice(1)
    .filter((row) => row.some((c) => c !== '' && c != null))
    .map((row) => Object.fromEntries(COLUMNS[name].map((col) => {
      const i = headers.indexOf(col);
      return [col, i >= 0 ? row[i] ?? '' : ''];
    })));
}

const str = (r: RawRow) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v == null ? '' : String(v)]));

async function main() {
  if (!config.spreadsheetId) throw new Error('SPREADSHEET_ID is not set');
  const existing = (db.prepare('SELECT COUNT(*) AS n FROM lessons').get() as { n: number }).n
    + (db.prepare('SELECT COUNT(*) AS n FROM students').get() as { n: number }).n;
  if (existing && !FORCE && !DRY) {
    throw new Error(`DB ${config.dbPath} is not empty. Use --force to wipe it and re-import.`);
  }

  console.log(`Reading spreadsheet ${config.spreadsheetId}…`);
  const raw = Object.fromEntries(await Promise.all(
    (['Settings', 'Teachers', 'Students', 'Lessons_Log', 'Balance_Log', 'Audit_Log', 'Business_Reports'] as SheetName[])
      .map(async (n) => [n, await readSheet(n)] as const),
  )) as Record<SheetName, RawRow[]>;

  // ----- teachers: drop duplicate telegram_id rows (keep the active / oldest one) -----
  const teachers = raw.Teachers.map((r) => ({ ...mapTeacher(str(r)), created_at: normDateTime(r.created_at, 'teacher') }))
    .filter((t) => t.teacher_id);
  const teacherRemap = new Map<string, string>();
  const byTg = new Map<string, typeof teachers>();
  for (const t of teachers) {
    if (!t.telegram_id) continue;
    byTg.set(t.telegram_id, [...(byTg.get(t.telegram_id) ?? []), t]);
  }
  const keptTeachers = teachers.filter((t) => {
    const group = t.telegram_id ? byTg.get(t.telegram_id)! : [t];
    if (group.length === 1) return true;
    const keep = group.find((g) => g.active) ?? group[0];
    if (keep !== t) {
      teacherRemap.set(t.teacher_id, keep.teacher_id);
      warn(`Teacher duplicate telegram_id ${t.telegram_id}: row ${t.teacher_id} merged into ${keep.teacher_id}`);
      return false;
    }
    return true;
  });
  const tid = (id: string) => teacherRemap.get(id) ?? id;

  const students = raw.Students.map((r) => {
    const s = mapStudent(str(r));
    return {
      ...s,
      teacher_id: tid(s.teacher_id),
      created_at: normDateTime(r.created_at, `student ${s.student_id}`),
      updated_at: normDateTime(r.updated_at, `student ${s.student_id}`),
    };
  }).filter((s) => s.student_id);
  const studentIds = new Set(students.map((s) => s.student_id));

  const seenLessons = new Set<string>();
  const lessons = raw.Lessons_Log.map((r) => {
    const l = mapLesson(str(r));
    const ctx = `lesson ${l.lesson_id}`;
    return {
      ...l,
      teacher_id: tid(l.teacher_id),
      lesson_date: normDate(r.lesson_date, ctx),
      created_at: normDateTime(r.created_at, ctx),
      confirmed_at: normDateTime(r.confirmed_at, ctx),
      reminder_sent: normDateTime(r.reminder_sent, ctx),
      admin_alerted: normDateTime(r.admin_alerted, ctx),
      cancelled_at: normDateTime(r.cancelled_at, ctx),
    };
  }).filter((l) => {
    if (!l.lesson_id) return false;
    if (seenLessons.has(l.lesson_id)) {
      warn(`Lesson ${l.lesson_id} duplicated in sheet, keeping the first row`);
      return false;
    }
    seenLessons.add(l.lesson_id);
    if (!studentIds.has(l.student_id)) {
      warn(`Lesson ${l.lesson_id} points to unknown student ${l.student_id} — SKIPPED`);
      return false;
    }
    return true;
  });

  const balance = raw.Balance_Log.map((r) => ({
    ...mapBalance(str(r)),
    created_at: normDateTime(r.created_at, 'balance'),
  })).filter((b) => {
    if (!b.entry_id) return false;
    if (!studentIds.has(b.student_id)) {
      warn(`Balance entry ${b.entry_id} points to unknown student ${b.student_id} — SKIPPED`);
      return false;
    }
    return true;
  });

  const audit = raw.Audit_Log.map((r) => ({ ...mapAudit(str(r)), created_at: normDateTime(r.created_at, 'audit') }));

  const reports = new Map<string, ReturnType<typeof mapReport>>();
  for (const r of raw.Business_Reports) {
    const row = { ...mapReport(str(r)), generated_at: normDateTime(r.generated_at, 'report') };
    if (!row.month || !row.student_id) continue;
    const key = `${row.month}|${row.student_id}`;
    const prev = reports.get(key);
    if (prev) warn(`Business report ${key} duplicated, keeping the latest`);
    if (!prev || prev.generated_at <= row.generated_at) reports.set(key, row);
  }

  const settings = raw.Settings.map(str).filter((r) => r.key);

  // ----- write everything in one transaction -----
  const run = db.transaction(() => {
    if (FORCE || DRY) {
      for (const t of ['bot_state', 'business_reports', 'audit_log', 'balance_log', 'lessons', 'students', 'teachers']) {
        db.prepare(`DELETE FROM ${t}`).run();
      }
    }
    const setStmt = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    for (const s of settings) setStmt.run(s.key, s.value);

    const tStmt = db.prepare(`INSERT INTO teachers (teacher_id, telegram_id, name, username, active, created_at)
      VALUES (@teacher_id, @telegram_id, @name, @username, @active, @created_at)`);
    for (const t of keptTeachers) tStmt.run({ ...t, active: t.active ? 1 : 0 });

    const sStmt = db.prepare(`INSERT INTO students (student_id, name, contact, teacher_id, teacher_name, type, status,
      balance, notes, active, created_at, updated_at) VALUES (@student_id, @name, @contact, @teacher_id, @teacher_name,
      @type, @status, @balance, @notes, @active, @created_at, @updated_at)`);
    for (const s of students) sStmt.run({ ...s, active: s.active ? 1 : 0 });

    const cols = COLUMNS.Lessons_Log;
    const lStmt = db.prepare(`INSERT INTO lessons (${cols.join(', ')}) VALUES (${cols.map((c) => `@${c}`).join(', ')})`);
    for (const l of lessons) lStmt.run(l);

    const bStmt = db.prepare(`INSERT INTO balance_log (entry_id, created_at, student_id, student_name, change,
      balance_after, reason, lesson_id, "by") VALUES (@entry_id, @created_at, @student_id, @student_name, @change,
      @balance_after, @reason, @lesson_id, @by)`);
    for (const b of balance) bStmt.run(b);

    const aStmt = db.prepare(`INSERT INTO audit_log (created_at, entity, entity_id, field, old_value, new_value, "by")
      VALUES (@created_at, @entity, @entity_id, @field, @old_value, @new_value, @by)`);
    for (const a of audit) aStmt.run(a);

    const rStmt = db.prepare(`INSERT INTO business_reports (month, student_id, student_name, teacher_name,
      lessons_count, total_minutes, generated_at, "trigger") VALUES (@month, @student_id, @student_name,
      @teacher_name, @lessons_count, @total_minutes, @generated_at, @trigger)`);
    for (const r of reports.values()) rStmt.run(r);

    // ----- checks -----
    const mismatches = db.prepare(`
      SELECT s.name, s.balance, COALESCE(SUM(b.change), 0) AS logged
      FROM students s LEFT JOIN balance_log b ON b.student_id = s.student_id
      WHERE s.type = 'subscription'
      GROUP BY s.student_id
      HAVING ABS(s.balance - logged) > 0.0001
    `).all() as Array<{ name: string; balance: number; logged: number }>;
    for (const m of mismatches) {
      warn(`Balance mismatch: ${m.name} balance=${m.balance}, sum(balance_log)=${m.logged}`);
    }
    const doneWithoutCharge = db.prepare(`
      SELECT l.lesson_id, l.student_name FROM lessons l
      WHERE l.state = 'done' AND l.student_type = 'subscription'
        AND NOT EXISTS (SELECT 1 FROM balance_log b WHERE b.lesson_id = l.lesson_id AND b.reason IN ('lesson', 'lesson_moved'))
    `).all() as Array<{ lesson_id: string; student_name: string }>;
    for (const l of doneWithoutCharge) warn(`Done subscription lesson without a charge: ${l.student_name} ${l.lesson_id}`);

    if (DRY) throw new DryRun();
  });

  try {
    run();
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }

  console.log(`\n${DRY ? 'DRY RUN (nothing written)' : 'Imported'}:`);
  console.table({
    teachers: keptTeachers.length,
    students: students.length,
    lessons: lessons.length,
    balance_log: balance.length,
    audit_log: audit.length,
    business_reports: reports.size,
    settings: settings.length,
  });
  if (warnings.length) {
    console.log(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.log(`  - ${w}`);
  } else {
    console.log('No warnings.');
  }
}

class DryRun extends Error {}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
