import { describe, expect, it } from 'vitest';
import type { Student } from '@school/shared';
import { statusAfterBalance, topUpBalance } from '../src/services/balance.js';
import { getStudent } from '../src/services/students.js';
import { db } from '../src/db/index.js';
import { balanceMatchesLog, makeStudent, makeTeacher } from './helpers.js';

const sub = (status: Student['status']) => ({ type: 'subscription', status }) as Student;

describe('statusAfterBalance', () => {
  it('turns a subscription student red when the balance runs out', () => {
    expect(statusAfterBalance(sub('green'), 0, -1)).toBe('red');
    expect(statusAfterBalance(sub('yellow'), -2, -1)).toBe('red');
  });

  it('clears red when a positive change brings the balance above zero', () => {
    expect(statusAfterBalance(sub('red'), 8, 8)).toBe('green');
  });

  it('keeps a manually set status otherwise', () => {
    expect(statusAfterBalance(sub('yellow'), 5, 1)).toBe('yellow');
    expect(statusAfterBalance(sub('red'), 3, -1)).toBe('red');
  });

  it('never changes business clients', () => {
    expect(statusAfterBalance({ type: 'business', status: 'blue' } as Student, -5, -1)).toBe('blue');
  });
});

describe('topUpBalance', () => {
  it('adds lessons, clears red and logs the change', async () => {
    const { teacher } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 0 });
    db.prepare("UPDATE students SET status = 'red' WHERE student_id = ?").run(student.student_id);

    const updated = await topUpBalance(student.student_id, 8, 'Admin');

    expect(updated.balance).toBe(8);
    expect(updated.status).toBe('green');
    expect((await getStudent(student.student_id)).balance).toBe(8);
    expect(balanceMatchesLog(student.student_id)).toBe(true);
  });

  it('accepts negative corrections', async () => {
    const { teacher } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 5 });
    const updated = await topUpBalance(student.student_id, -2, 'Admin');
    expect(updated.balance).toBe(3);
    expect(balanceMatchesLog(student.student_id)).toBe(true);
  });

  it('fails for an unknown student', async () => {
    await expect(topUpBalance('missing', 1, 'Admin')).rejects.toMatchObject({ statusCode: 404 });
  });
});
