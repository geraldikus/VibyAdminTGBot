import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi } from '../src/app.js';
import { config } from '../src/config.js';
import { db } from '../src/db/index.js';
import { fakeTelegram, makeTeacher } from './helpers.js';

let app: FastifyInstance;
let tg: ReturnType<typeof fakeTelegram>;

beforeAll(async () => { app = await buildApi(); });
afterAll(async () => { await app.close(); });
beforeEach(() => { tg = fakeTelegram(); });

/** Signs initData the way Telegram does for Mini Apps. */
function initData(user: { id: number; first_name: string }, authDate = Math.floor(Date.now() / 1000)) {
  const params = new URLSearchParams({ auth_date: String(authDate), user: JSON.stringify(user), query_id: 'q1' });
  const check = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
}

const asTeacher = (telegramId: string, teacherId: string) => ({ 'x-dev-user': `teacher:${telegramId}:${teacherId}` });
const asAdmin = { 'x-dev-user': 'admin:1' };

describe('Telegram initData auth', () => {
  it('accepts a correctly signed admin', async () => {
    const res = await app.inject({ url: '/api/me', headers: { 'x-telegram-init-data': initData({ id: 1, first_name: 'Boss' }) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({ role: 'admin', telegramId: '1' });
  });

  it('rejects a tampered payload', async () => {
    const tampered = initData({ id: 1, first_name: 'Boss' }).replace('Boss', 'Hacker');
    const res = await app.inject({ url: '/api/me', headers: { 'x-telegram-init-data': tampered } });
    expect(res.statusCode).toBe(401);
  });

  it('rejects initData older than 24 hours', async () => {
    const old = initData({ id: 1, first_name: 'Boss' }, Math.floor(Date.now() / 1000) - 2 * 86_400);
    const res = await app.inject({ url: '/api/me', headers: { 'x-telegram-init-data': old } });
    expect(res.statusCode).toBe(401);
  });

  it('denies unknown users and requests without initData', async () => {
    const stranger = await app.inject({ url: '/api/me', headers: { 'x-telegram-init-data': initData({ id: 999, first_name: 'X' }) } });
    expect(stranger.statusCode).toBe(403);
    const none = await app.inject({ url: '/api/me' });
    expect(none.statusCode).toBe(401);
  });

  it('serves /health without auth', async () => {
    expect((await app.inject({ url: '/health' })).json()).toEqual({ ok: true });
  });
});

describe('roles', () => {
  it('keeps teachers out of admin routes and admins out of teacher-only routes', async () => {
    const { teacher } = await makeTeacher();
    const t = asTeacher(teacher.telegram_id, teacher.teacher_id);
    expect((await app.inject({ url: '/api/admin/students', headers: t })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/admin/students/x/balance', headers: t, payload: { amount: 5 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'POST', url: '/api/teacher/students', headers: asAdmin, payload: { name: 'X', type: 'subscription', status: 'green' } })).statusCode).toBe(403);
  });
});

describe('POST /api/teacher/students', () => {
  it('creates the student for the calling teacher, logs the balance and notifies admins', async () => {
    const { teacher } = await makeTeacher('Alexandra');
    const res = await app.inject({
      method: 'POST',
      url: '/api/teacher/students',
      headers: asTeacher(teacher.telegram_id, teacher.teacher_id),
      payload: { name: 'Anna K', contact: '@anna', type: 'subscription', status: 'green', balance: 8, teacher_id: 'someone-else' },
    });
    expect(res.statusCode).toBe(200);
    const student = res.json().student;
    expect(student).toMatchObject({ teacher_id: teacher.teacher_id, balance: 8, status: 'green' });

    const log = db.prepare('SELECT change, reason FROM balance_log WHERE student_id = ?').all(student.student_id);
    expect(log).toEqual([{ change: 8, reason: 'top_up' }]);
    expect(db.prepare("SELECT 1 FROM audit_log WHERE entity_id = ? AND field = 'created'").get(student.student_id)).toBeTruthy();

    const notice = tg.calls.find((c) => c.chatId === '1' && c.text?.includes('added a student'));
    expect(notice?.text).toContain('Check the payment');
  });

  it('forces balance 0 for business clients', async () => {
    const { teacher } = await makeTeacher();
    const res = await app.inject({
      method: 'POST',
      url: '/api/teacher/students',
      headers: asTeacher(teacher.telegram_id, teacher.teacher_id),
      payload: { name: 'Corp', type: 'business', status: 'blue', balance: 5 },
    });
    expect(res.json().student.balance).toBe(0);
  });

  it.each([-1, 201, 2.5])('rejects a starting balance of %s', async (balance) => {
    const { teacher } = await makeTeacher();
    const res = await app.inject({
      method: 'POST',
      url: '/api/teacher/students',
      headers: asTeacher(teacher.telegram_id, teacher.teacher_id),
      payload: { name: 'X', type: 'subscription', status: 'green', balance },
    });
    expect(res.statusCode).toBe(400);
  });
});
