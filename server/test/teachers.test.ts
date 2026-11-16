import { describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { approveTeacher, findTeacherByTelegramId, upsertPendingTeacher } from '../src/services/teachers.js';

describe('teacher sign-up', () => {
  it('creates exactly one row when /start is pressed twice at the same time', async () => {
    const input = { telegramId: '777', name: 'Anna', username: 'anna' };
    const results = await Promise.all([upsertPendingTeacher(input), upsertPendingTeacher(input)]);

    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(results[0].teacher.teacher_id).toBe(results[1].teacher.teacher_id);
    expect((db.prepare("SELECT COUNT(*) AS n FROM teachers WHERE telegram_id = '777'").get() as { n: number }).n).toBe(1);
  });

  it('activates the teacher on approval, and approval is idempotent', async () => {
    const { teacher } = await upsertPendingTeacher({ telegramId: '888', name: 'Boris', username: '' });
    expect(teacher.active).toBe(false);
    await approveTeacher(teacher.teacher_id, 'Admin');
    await approveTeacher(teacher.teacher_id, 'Admin');
    expect((await findTeacherByTelegramId('888'))?.active).toBe(true);
  });
});
