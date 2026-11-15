import { randomUUID } from 'node:crypto';
import type { BalanceReason, Status, Student } from '@school/shared';
import { nowIso } from '../time.js';
import { db, tx } from '../db/index.js';
import { findStudentRow } from '../db/rows.js';
import { httpError } from '../errors.js';
import { writeAudit } from './audit.js';

/**
 * Subscription students go red when the balance runs out and back to green
 * when a positive change (top-up, refund) brings it above zero.
 */
export function statusAfterBalance(student: Student, balanceAfter: number, change = 0): Status {
  if (student.type !== 'subscription') return student.status;
  if (balanceAfter <= 0) return 'red';
  if (student.status === 'red' && change > 0) return 'green';
  return student.status;
}

const updateBalanceStmt = db.prepare(
  'UPDATE students SET balance = @balance, status = @status, updated_at = @updated_at WHERE student_id = @student_id',
);
const insertLogStmt = db.prepare(
  `INSERT INTO balance_log (entry_id, created_at, student_id, student_name, change, balance_after, reason, lesson_id, "by")
   VALUES (@entry_id, @created_at, @student_id, @student_name, @change, @balance_after, @reason, @lesson_id, @by)`,
);

/**
 * Must be called inside `tx()`. Re-reads the student so the change is applied to
 * the current balance, writes the balance log entry and the status audit.
 */
export function applyBalanceChangeSync(input: {
  studentId: string;
  change: number;
  reason: BalanceReason;
  lessonId?: string;
  by: string;
}): { student: Student; balanceAfter: number } {
  const student = findStudentRow(input.studentId);
  if (!student) throw httpError('Student not found', 404);
  if (student.type === 'business' && input.reason !== 'top_up' && input.reason !== 'manual') {
    return { student, balanceAfter: student.balance };
  }
  const balanceAfter = student.balance + input.change;
  const now = nowIso();
  const nextStatus = statusAfterBalance(student, balanceAfter, input.change);
  updateBalanceStmt.run({
    balance: balanceAfter,
    status: nextStatus,
    updated_at: now,
    student_id: student.student_id,
  });
  insertLogStmt.run({
    entry_id: randomUUID(),
    created_at: now,
    student_id: student.student_id,
    student_name: student.name,
    change: input.change,
    balance_after: balanceAfter,
    reason: input.reason,
    lesson_id: input.lessonId ?? '',
    by: input.by,
  });
  if (nextStatus !== student.status) {
    writeAudit({
      entity: 'student',
      entity_id: student.student_id,
      field: 'status',
      old_value: student.status,
      new_value: nextStatus,
      by: input.by,
    });
  }
  return {
    student: { ...student, balance: balanceAfter, status: nextStatus, updated_at: now },
    balanceAfter,
  };
}

export async function topUpBalance(studentId: string, amount: number, by: string): Promise<Student> {
  return tx(() => {
    const before = findStudentRow(studentId);
    if (!before) throw httpError('Student not found', 404);
    const { student } = applyBalanceChangeSync({ studentId, change: amount, reason: 'top_up', by });
    writeAudit({
      entity: 'student',
      entity_id: studentId,
      field: 'balance',
      old_value: String(before.balance),
      new_value: String(student.balance),
      by,
    });
    return student;
  });
}
