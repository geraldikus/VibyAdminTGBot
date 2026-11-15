import type { BusinessReportRow } from '@school/shared';
import { monthBounds, nowIso, previousMonth, todayYmd } from '../time.js';
import { db, tx } from '../db/index.js';
import { readSettings, setSetting } from '../db/rows.js';
import { notifyAdmins } from './notify.js';

const computeStmt = db.prepare<{ start: string; end: string }, {
  student_id: string;
  student_name: string;
  teacher_name: string;
  lessons_count: number;
  total_minutes: number;
}>(`
  SELECT s.student_id, s.name AS student_name, s.teacher_name,
         COUNT(l.lesson_id) AS lessons_count,
         COALESCE(SUM(l.duration_min), 0) AS total_minutes
  FROM students s
  LEFT JOIN lessons l
    ON l.student_id = s.student_id AND l.state = 'done' AND l.lesson_date BETWEEN @start AND @end
  WHERE s.type = 'business'
  GROUP BY s.student_id
  HAVING s.active = 1 OR COUNT(l.lesson_id) > 0
`);

const selectMonthStmt = db.prepare<[string], BusinessReportRow>(
  'SELECT * FROM business_reports WHERE month = ? ORDER BY lessons_count DESC, student_name',
);
const deleteMonthStmt = db.prepare<[string]>('DELETE FROM business_reports WHERE month = ?');
const insertRowStmt = db.prepare(
  `INSERT INTO business_reports (month, student_id, student_name, teacher_name, lessons_count, total_minutes, generated_at, "trigger")
   VALUES (@month, @student_id, @student_name, @teacher_name, @lessons_count, @total_minutes, @generated_at, @trigger)`,
);

function sameNumbers(a: BusinessReportRow[], b: BusinessReportRow[]): boolean {
  if (a.length !== b.length) return false;
  const key = (r: BusinessReportRow) => `${r.student_id}:${r.lessons_count}:${r.total_minutes}`;
  const set = new Set(a.map(key));
  return b.every((r) => set.has(key(r)));
}

/**
 * (Re)builds the report for a month. The month's rows are replaced in one
 * transaction, so re-running never duplicates. Counts lessons by lesson_date,
 * whenever their photo arrived.
 */
export async function generateBusinessReport(
  month: string | undefined,
  trigger: 'auto' | 'manual',
  opts: { notifyOnlyIfChanged?: boolean } = {},
): Promise<BusinessReportRow[]> {
  const settings = readSettings();
  const target = month ?? previousMonth(undefined, settings.timezone);
  const { start, end } = monthBounds(target);
  const generatedAt = nowIso(settings.timezone);

  const { rows, changed } = tx(() => {
    const before = selectMonthStmt.all(target);
    const fresh: BusinessReportRow[] = computeStmt.all({ start, end })
      .map((r) => ({ ...r, month: target, generated_at: generatedAt, trigger }))
      .sort((a, b) => b.lessons_count - a.lessons_count || a.student_name.localeCompare(b.student_name));
    deleteMonthStmt.run(target);
    for (const row of fresh) insertRowStmt.run(row);
    if (!settings.last_business_report || settings.last_business_report < target) {
      setSetting('last_business_report', target);
    }
    return { rows: fresh, changed: !before.length || !sameNumbers(before, fresh) };
  });

  if (!opts.notifyOnlyIfChanged || changed) {
    const lines = [
      opts.notifyOnlyIfChanged ? `Business report for ${target} UPDATED (late lessons)` : `Business report for ${target}`,
      '',
      ...rows.map((r) => `${r.student_name} — ${r.lessons_count} lessons / ${r.total_minutes} min (${r.teacher_name})`),
      '',
      rows.length ? `Total students: ${rows.length}` : 'No active business students.',
    ];
    await notifyAdmins(lines.join('\n'));
  }
  return rows;
}

export async function listBusinessReports(month?: string): Promise<BusinessReportRow[]> {
  if (month) return selectMonthStmt.all(month);
  return db
    .prepare('SELECT * FROM business_reports ORDER BY month DESC, student_name')
    .all() as BusinessReportRow[];
}

/** On startup: build last month's report if the scheduled run was missed. */
export async function catchUpBusinessReport() {
  const settings = readSettings();
  const lastMonth = previousMonth(undefined, settings.timezone);
  if (!settings.last_business_report || settings.last_business_report < lastMonth) {
    await generateBusinessReport(lastMonth, 'auto');
  }
}

/**
 * Daily at 09:00. Day 1: first report for last month. Day backdate_days + 2: rebuild,
 * because teachers may mark last month's lessons up to backdate_days late; admins
 * are notified only if the numbers changed.
 */
export async function dailyBusinessReportJob() {
  const settings = readSettings();
  const day = Number(todayYmd(settings.timezone).slice(8, 10));
  const lastMonth = previousMonth(undefined, settings.timezone);
  if (day === 1) {
    await generateBusinessReport(lastMonth, 'auto');
  } else if (day === Math.min(settings.backdate_days + 2, 28)) {
    await generateBusinessReport(lastMonth, 'auto', { notifyOnlyIfChanged: true });
  }
}

const dashboardStmt = db.prepare(`
  SELECT
    (SELECT COUNT(*) FROM students WHERE active = 1 AND status = 'red') AS red,
    (SELECT COUNT(*) FROM students WHERE active = 1 AND status = 'yellow') AS yellow,
    (SELECT COUNT(*) FROM students WHERE active = 1 AND type = 'subscription' AND balance <= 0) AS zeroOrNegative,
    (SELECT COUNT(*) FROM lessons WHERE state = 'pending_photo') AS pendingPhotos,
    (SELECT COUNT(*) FROM students WHERE active = 1) AS students,
    (SELECT COUNT(*) FROM teachers WHERE active = 1) AS teachers
`);

export async function getDashboard() {
  return dashboardStmt.get() as {
    red: number;
    yellow: number;
    zeroOrNegative: number;
    pendingPhotos: number;
    students: number;
    teachers: number;
  };
}
