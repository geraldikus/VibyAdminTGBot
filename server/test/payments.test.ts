import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Student } from '@school/shared';
import { buildApi } from '../src/app.js';
import { db } from '../src/db/index.js';
import { findStudentRow, readSettings } from '../src/db/rows.js';
import { processPaymentReminders } from '../src/services/payments.js';
import { updateSettings } from '../src/services/settings.js';
import { updateStudent } from '../src/services/students.js';
import { fakeTelegram, makeStudent, makeTeacher } from './helpers.js';

/** 10:00 Moscow on the given day, when the daily job runs. */
const at = (ymd: string) => new Date(`${ymd}T10:00:00+03:00`);
const TODAY = at('2026-11-20');

let tg: ReturnType<typeof fakeTelegram>;
let teacherId: string;

beforeAll(async () => {
  teacherId = (await makeTeacher('Emma')).teacher.teacher_id;
});

beforeEach(() => {
  tg = fakeTelegram();
  // Each test starts with nobody waiting and the default 2 days.
  db.exec("UPDATE students SET status = 'green'");
  updateSettings({ payment_reminder_days: 2 }, 'test');
});

const reminders = () => tg.calls.filter((c) => c.method === 'sendMessage' && c.text?.startsWith('💰 Check payment'));
const row = (id: string) => findStudentRow(id) as Student;

async function waitingSince(since: string, name?: string) {
  const s = await makeStudent(teacherId, { status: 'yellow', name, balance: 1 });
  db.prepare('UPDATE students SET payment_wait_since = ? WHERE student_id = ?').run(since, s.student_id);
  return s;
}

describe('waiting-for-payment date', () => {
  it('is set when a student is created as waiting', async () => {
    const s = await makeStudent(teacherId, { status: 'yellow' });
    expect(row(s.student_id).payment_wait_since).not.toBe('');
    const paid = await makeStudent(teacherId, { status: 'green' });
    expect(row(paid.student_id).payment_wait_since).toBe('');
  });

  it('is set when the status changes to waiting and cleared when it changes away', async () => {
    const s = await makeStudent(teacherId, { status: 'green' });
    await updateStudent(s.student_id, { status: 'yellow' }, 'Admin');
    expect(row(s.student_id).payment_wait_since).not.toBe('');

    db.prepare("UPDATE students SET payment_reminded_at = '2026-11-19 10:00:00' WHERE student_id = ?").run(s.student_id);
    await updateStudent(s.student_id, { status: 'green' }, 'Admin');
    expect(row(s.student_id)).toMatchObject({ payment_wait_since: '', payment_reminded_at: '' });
  });

  it('is not reset by other edits while still waiting', async () => {
    const s = await waitingSince('2026-11-10 12:00:00');
    await updateStudent(s.student_id, { notes: 'called on Monday' }, 'Admin');
    expect(row(s.student_id).payment_wait_since).toBe('2026-11-10 12:00:00');
  });
});

describe('payment reminders', () => {
  it('reminds after N calendar days, not before', async () => {
    await waitingSince('2026-11-19 18:00:00', 'Too early');
    await waitingSince('2026-11-18 21:30:00', 'Ava Due');

    const sent = await processPaymentReminders(TODAY);
    expect(sent.map((s) => s.name)).toEqual(['Ava Due']);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0].text).toContain('Ava Due');
    expect(reminders()[0].text).toContain('2 days');
    expect(reminders()[0].text).not.toContain('Too early');
  });

  it('lists everyone due in one message', async () => {
    await waitingSince('2026-11-15 10:00:00', 'First');
    await waitingSince('2026-11-17 10:00:00', 'Second');
    await processPaymentReminders(TODAY);
    expect(reminders()).toHaveLength(1);
    expect(reminders()[0].text).toMatch(/First[\s\S]*Second/);
  });

  it('repeats every N days while the student keeps waiting', async () => {
    await waitingSince('2026-11-18 10:00:00');
    expect(await processPaymentReminders(at('2026-11-20'))).toHaveLength(1);
    expect(await processPaymentReminders(at('2026-11-20'))).toHaveLength(0);
    expect(await processPaymentReminders(at('2026-11-21'))).toHaveLength(0);
    expect(await processPaymentReminders(at('2026-11-22'))).toHaveLength(1);
    expect(await processPaymentReminders(at('2026-11-24'))).toHaveLength(1);
  });

  it('stops after the admin marks the student as paid', async () => {
    const s = await waitingSince('2026-11-10 10:00:00');
    await updateStudent(s.student_id, { status: 'green' }, 'Admin');
    expect(await processPaymentReminders(TODAY)).toHaveLength(0);
    expect(reminders()).toHaveLength(0);
  });

  it('starts counting again when the student is back in waiting', async () => {
    const s = await waitingSince('2026-11-01 10:00:00');
    await updateStudent(s.student_id, { status: 'green' }, 'Admin');
    await updateStudent(s.student_id, { status: 'yellow' }, 'Admin');
    // The new wait started today (real clock), so nothing is due for a while.
    expect(await processPaymentReminders(new Date())).toHaveLength(0);
  });

  it('skips archived students', async () => {
    const s = await waitingSince('2026-11-10 10:00:00');
    await updateStudent(s.student_id, { active: false }, 'Admin');
    expect(await processPaymentReminders(TODAY)).toHaveLength(0);
  });

  it('is off at 0 days', async () => {
    await waitingSince('2026-11-01 10:00:00');
    updateSettings({ payment_reminder_days: 0 }, 'Admin');
    expect(await processPaymentReminders(TODAY)).toHaveLength(0);
    expect(reminders()).toHaveLength(0);
  });

  it('follows a changed number of days', async () => {
    await waitingSince('2026-11-18 10:00:00');
    updateSettings({ payment_reminder_days: 3 }, 'Admin');
    expect(await processPaymentReminders(TODAY)).toHaveLength(0);
    expect(await processPaymentReminders(at('2026-11-21'))).toHaveLength(1);
  });

  it('sends one message when two runs overlap', async () => {
    await waitingSince('2026-11-10 10:00:00');
    await Promise.all([processPaymentReminders(TODAY), processPaymentReminders(TODAY)]);
    expect(reminders()).toHaveLength(1);
  });
});

describe('settings API', () => {
  let app: FastifyInstance;
  const asAdmin = { 'x-dev-user': 'admin:1' };

  beforeAll(async () => { app = await buildApi(); });
  afterAll(async () => { await app.close(); });

  it('lets the admin read and change settings, with an audit entry', async () => {
    const get = await app.inject({ url: '/api/admin/settings', headers: asAdmin });
    expect(get.statusCode).toBe(200);
    expect(get.json().settings.payment_reminder_days).toBe(2);

    const res = await app.inject({
      method: 'PATCH', url: '/api/admin/settings', headers: asAdmin,
      payload: { payment_reminder_days: 4, edit_window_min: 10 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().settings).toMatchObject({ payment_reminder_days: 4, edit_window_min: 10 });
    expect(readSettings().payment_reminder_days).toBe(4);

    const audit = db.prepare("SELECT * FROM audit_log WHERE entity = 'settings' AND field = 'payment_reminder_days' ORDER BY id DESC")
      .get() as { old_value: string; new_value: string; by: string };
    expect(audit).toMatchObject({ old_value: '2', new_value: '4' });
  });

  it('rejects out-of-range values and unknown keys', async () => {
    for (const payload of [{ payment_reminder_days: -1 }, { payment_reminder_days: 1000 }, { photo_reminder_min: 0 }, { timezone: 'UTC' }]) {
      const res = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers: asAdmin, payload });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(readSettings().timezone).toBe('Europe/Moscow');
  });

  it('is admin only', async () => {
    const { teacher, user } = await makeTeacher('Nosy');
    const headers = { 'x-dev-user': `teacher:${user.telegramId}:${teacher.teacher_id}` };
    expect((await app.inject({ url: '/api/admin/settings', headers })).statusCode).toBe(403);
    const res = await app.inject({ method: 'PATCH', url: '/api/admin/settings', headers, payload: { payment_reminder_days: 9 } });
    expect(res.statusCode).toBe(403);
  });
});
