import { randomUUID } from 'node:crypto';
import type { BalanceReason, Student } from '@school/shared';
import { nowIso } from '../time.js';
import { repo } from '../sheets/repo.js';
import { mapStudent } from '../sheets/mappers.js';
import { writeAudit } from './audit.js';

export async function applyBalanceChange(input: {
  student: Student;
  change: number;
  reason: BalanceReason;
  lessonId?: string;
  by: string;
}): Promise<{ student: Student; balanceAfter: number }> {
  if (input.student.type === 'business' && input.reason === 'lesson') {
    return { student: input.student, balanceAfter: input.student.balance };
  }
  const balanceAfter = input.student.balance + input.change;
  const now = nowIso();
  await repo.batchAtomic([
    {
      kind: 'update',
      sheet: 'Students',
      id: input.student.student_id,
      patch: { balance: balanceAfter, updated_at: now },
    },
    {
      kind: 'append',
      sheet: 'Balance_Log',
      records: [{
        entry_id: randomUUID(),
        created_at: now,
        student_id: input.student.student_id,
        student_name: input.student.name,
        change: input.change,
        balance_after: balanceAfter,
        reason: input.reason,
        lesson_id: input.lessonId ?? '',
        by: input.by,
      }],
    },
  ]);
  return {
    student: { ...input.student, balance: balanceAfter, updated_at: now },
    balanceAfter,
  };
}

export async function topUpBalance(studentId: string, amount: number, by: string): Promise<Student> {
  return repo.write(async () => {
    const row = await repo.findById('Students', studentId);
    if (!row) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
    const student = mapStudent(row);
    const { student: next } = await applyBalanceChange({
      student,
      change: amount,
      reason: 'top_up',
      by,
    });
    await writeAudit({
      entity: 'student',
      entity_id: studentId,
      field: 'balance',
      old_value: String(student.balance),
      new_value: String(next.balance),
      by,
    });
    return next;
  });
}
