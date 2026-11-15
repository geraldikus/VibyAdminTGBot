import { randomUUID } from 'node:crypto';
import type { BalanceEntry, CreateStudentInput, Lesson, Student, UpdateStudentInput } from '@school/shared';
import { nowIso } from '../time.js';
import { db, tx } from '../db/index.js';
import { findStudentRow, findTeacherRow, toStudent } from '../db/rows.js';
import { httpError } from '../errors.js';
import { writeAudit } from './audit.js';

export async function listStudents(filter?: {
  teacherId?: string;
  activeOnly?: boolean;
  status?: string;
  type?: string;
}): Promise<Student[]> {
  const where: string[] = [];
  const params: Record<string, string> = {};
  if (filter?.teacherId) {
    where.push('teacher_id = @teacherId');
    params.teacherId = filter.teacherId;
  }
  if (filter?.activeOnly !== false) where.push('active = 1');
  if (filter?.status) {
    where.push('status = @status');
    params.status = filter.status;
  }
  if (filter?.type) {
    where.push('type = @type');
    params.type = filter.type;
  }
  const sql = `SELECT * FROM students ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY name`;
  return (db.prepare(sql).all(params) as Parameters<typeof toStudent>[0][]).map(toStudent);
}

export async function getStudent(studentId: string): Promise<Student> {
  const student = findStudentRow(studentId);
  if (!student) throw httpError('Student not found', 404);
  return student;
}

const insertStudentStmt = db.prepare(
  `INSERT INTO students (student_id, name, contact, teacher_id, teacher_name, type, status, balance, notes, active, created_at, updated_at)
   VALUES (@student_id, @name, @contact, @teacher_id, @teacher_name, @type, @status, @balance, @notes, 1, @created_at, @updated_at)`,
);

export async function createStudent(input: CreateStudentInput, by: string): Promise<Student> {
  return tx(() => {
    const teacher = findTeacherRow(input.teacher_id);
    if (!teacher) throw httpError('Teacher not found', 400);
    const now = nowIso();
    const student: Student = {
      student_id: randomUUID(),
      name: input.name.trim(),
      contact: input.contact ?? '',
      teacher_id: teacher.teacher_id,
      teacher_name: teacher.name,
      type: input.type,
      status: input.status,
      balance: input.type === 'business' ? 0 : input.balance ?? 0,
      notes: input.notes ?? '',
      active: true,
      created_at: now,
      updated_at: now,
    };
    const { active: _active, ...columns } = student;
    insertStudentStmt.run(columns);
    if (student.type === 'subscription' && student.balance !== 0) {
      db.prepare(
        `INSERT INTO balance_log (entry_id, created_at, student_id, student_name, change, balance_after, reason, lesson_id, "by")
         VALUES (?, ?, ?, ?, ?, ?, 'top_up', '', ?)`,
      ).run(randomUUID(), now, student.student_id, student.name, student.balance, student.balance, by);
    }
    writeAudit({ entity: 'student', entity_id: student.student_id, field: 'created', old_value: '', new_value: student.name, by });
    return student;
  });
}

const EDITABLE: Array<keyof UpdateStudentInput> = ['name', 'contact', 'type', 'status', 'notes', 'active'];

export async function updateStudent(
  studentId: string,
  patch: UpdateStudentInput,
  by: string,
): Promise<Student> {
  return tx(() => {
    const current = findStudentRow(studentId);
    if (!current) throw httpError('Student not found', 404);
    const next: Record<string, unknown> = {};
    if (patch.teacher_id && patch.teacher_id !== current.teacher_id) {
      const teacher = findTeacherRow(patch.teacher_id);
      if (!teacher) throw httpError('Teacher not found', 400);
      next.teacher_id = teacher.teacher_id;
      next.teacher_name = teacher.name;
    }
    for (const key of EDITABLE) {
      if (patch[key] === undefined) continue;
      next[key] = key === 'name' ? String(patch.name).trim() : patch[key];
    }
    const changed = Object.entries(next).filter(
      ([field, value]) => String((current as unknown as Record<string, unknown>)[field]) !== String(value),
    );
    if (!changed.length) return current;
    const sets = changed.map(([field]) => `${field} = @${field}`).join(', ');
    const params: Record<string, unknown> = { student_id: studentId, updated_at: nowIso() };
    for (const [field, value] of changed) params[field] = typeof value === 'boolean' ? (value ? 1 : 0) : value;
    db.prepare(`UPDATE students SET ${sets}, updated_at = @updated_at WHERE student_id = @student_id`).run(params);
    for (const [field, value] of changed) {
      writeAudit({
        entity: 'student',
        entity_id: studentId,
        field,
        old_value: String((current as unknown as Record<string, unknown>)[field] ?? ''),
        new_value: String(value),
        by,
      });
    }
    return findStudentRow(studentId)!;
  });
}

const HISTORY_LIMIT = 200;

export async function getStudentHistory(studentId: string) {
  const student = await getStudent(studentId);
  const lessons = db
    .prepare('SELECT * FROM lessons WHERE student_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(studentId, HISTORY_LIMIT) as Lesson[];
  const balance = db
    .prepare('SELECT * FROM balance_log WHERE student_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(studentId, HISTORY_LIMIT) as BalanceEntry[];
  return { student, lessons, balance };
}
