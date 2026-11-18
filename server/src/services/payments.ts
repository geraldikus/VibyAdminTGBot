import type { Student } from '@school/shared';
import { db, tx } from '../db/index.js';
import { readSettings } from '../db/rows.js';
import { daysBetweenYmd, formatDateTime, formatYmd, prettyDate, todayYmd } from '../time.js';
import { getApiOrNull, notifyAdmins } from './notify.js';

/**
 * "Check the payment" reminders.
 *
 * A student in "Waiting for payment" for `payment_reminder_days` calendar days is listed
 * in one message to the admins; the reminder repeats every `payment_reminder_days` days
 * while the status stays the same. Any status change resets both dates (DB trigger).
 * 0 days turns the reminders off.
 */

type Waiting = Pick<Student, 'student_id' | 'name' | 'teacher_name' | 'balance' | 'type'
  | 'payment_wait_since' | 'payment_reminded_at'>;

const waitingStmt = db.prepare(`
  SELECT student_id, name, teacher_name, balance, type, payment_wait_since, payment_reminded_at
  FROM students
  WHERE active = 1 AND status = 'yellow' AND payment_wait_since <> ''
  ORDER BY payment_wait_since, name`);

// Claim: succeeds only if nobody reminded about this student since we read the row.
const claimStmt = db.prepare(`
  UPDATE students SET payment_reminded_at = @now
  WHERE student_id = @student_id AND status = 'yellow' AND payment_reminded_at = @prev`);

export function waitingDays(student: Pick<Student, 'payment_wait_since'>, today = todayYmd()): number {
  if (!student.payment_wait_since) return 0;
  return daysBetweenYmd(student.payment_wait_since.slice(0, 10), today);
}

export function isPaymentReminderDue(student: Waiting, days: number, today = todayYmd()): boolean {
  if (days <= 0 || !student.payment_wait_since) return false;
  if (waitingDays(student, today) < days) return false;
  if (!student.payment_reminded_at) return true;
  return daysBetweenYmd(student.payment_reminded_at.slice(0, 10), today) >= days;
}

let running = false;

/** Returns the students the admins were reminded about. `now` is a parameter for tests. */
export async function processPaymentReminders(now = new Date()): Promise<Waiting[]> {
  // Without a bot (local demo) nothing can be sent, so nothing is marked as sent either.
  if (running || !getApiOrNull()) return [];
  running = true;
  try {
    const settings = readSettings();
    const days = settings.payment_reminder_days;
    if (days <= 0) return [];
    const today = formatYmd(now, settings.timezone);
    const stamp = formatDateTime(now, settings.timezone);
    const due = (waitingStmt.all() as Waiting[]).filter((s) => isPaymentReminderDue(s, days, today));
    const claimed = tx(() => due.filter((s) =>
      claimStmt.run({ now: stamp, student_id: s.student_id, prev: s.payment_reminded_at }).changes === 1));
    if (!claimed.length) return [];

    const lines = claimed.map((s) => {
      const waited = waitingDays(s, today);
      const balance = s.type === 'subscription' ? `, balance ${s.balance}` : '';
      return `• ${s.name} — ${s.teacher_name || 'no teacher'}, waiting since `
        + `${prettyDate(s.payment_wait_since.slice(0, 10))} (${waited} ${waited === 1 ? 'day' : 'days'})${balance}`;
    });
    const single = claimed.length === 1;
    await notifyAdmins(
      `💰 Check payment\n${lines.join('\n')}\n\nMark the student as Paid when the payment arrives.`,
      single
        ? { studentId: claimed[0].student_id, button: 'Open student' }
        : { path: '/admin/students?status=yellow', button: 'Open list' },
    );
    return claimed;
  } finally {
    running = false;
  }
}
