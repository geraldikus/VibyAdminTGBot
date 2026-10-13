import { randomUUID } from 'node:crypto';
import type { CreateStudentInput, Student, UpdateStudentInput } from '@school/shared';
import { nowIso } from '../time.js';
import { repo } from '../sheets/repo.js';
import { mapBalance, mapLesson, mapStudent } from '../sheets/mappers.js';
import { findTeacherById } from './teachers.js';
import { writeAudit } from './audit.js';

export async function listStudents(filter?: { teacherId?: string; activeOnly?: boolean }): Promise<Student[]> {
  const rows = await repo.getAll('Students');
  return rows
    .map(mapStudent)
    .filter((s) => (filter?.teacherId ? s.teacher_id === filter.teacherId : true))
    .filter((s) => (filter?.activeOnly === false ? true : s.active));
}

export async function getStudent(studentId: string): Promise<Student> {
  const row = await repo.findById('Students', studentId);
  if (!row) throw Object.assign(new Error('Student not found'), { statusCode: 404 });
  return mapStudent(row);
}

export async function createStudent(input: CreateStudentInput, by: string): Promise<Student> {
  const teacher = await findTeacherById(input.teacher_id);
  if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 400 });
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
  await repo.write(async () => {
    const ops: Parameters<typeof repo.batchAtomic>[0] = [
      { kind: 'append', sheet: 'Students', records: [student] },
    ];
    if (student.type === 'subscription' && student.balance !== 0) {
      ops.push({
        kind: 'append',
        sheet: 'Balance_Log',
        records: [{
          entry_id: randomUUID(),
          created_at: now,
          student_id: student.student_id,
          student_name: student.name,
          change: student.balance,
          balance_after: student.balance,
          reason: 'top_up',
          lesson_id: '',
          by,
        }],
      });
    }
    await repo.batchAtomic(ops);
  });
  return student;
}

export async function updateStudent(
  studentId: string,
  patch: UpdateStudentInput,
  by: string,
): Promise<Student> {
  const current = await getStudent(studentId);
  const nextPatch: Record<string, unknown> = { updated_at: nowIso() };
  if (patch.teacher_id && patch.teacher_id !== current.teacher_id) {
    const teacher = await findTeacherById(patch.teacher_id);
    if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 400 });
    nextPatch.teacher_id = teacher.teacher_id;
    nextPatch.teacher_name = teacher.name;
  }
  if (patch.name !== undefined) nextPatch.name = patch.name.trim();
  if (patch.contact !== undefined) nextPatch.contact = patch.contact;
  if (patch.type !== undefined) nextPatch.type = patch.type;
  if (patch.status !== undefined) nextPatch.status = patch.status;
  if (patch.notes !== undefined) nextPatch.notes = patch.notes;
  if (patch.active !== undefined) nextPatch.active = patch.active;

  return repo.write(async () => {
    const row = await repo.updateById('Students', studentId, nextPatch);
    for (const [field, value] of Object.entries(nextPatch)) {
      if (field === 'updated_at') continue;
      const oldValue = String((current as unknown as Record<string, unknown>)[field] ?? '');
      const newValue = String(value);
      if (oldValue !== newValue) {
        await writeAudit({
          entity: 'student',
          entity_id: studentId,
          field,
          old_value: oldValue,
          new_value: newValue,
          by,
        });
      }
    }
    return mapStudent(row);
  });
}

export async function getStudentHistory(studentId: string) {
  const student = await getStudent(studentId);
  const lessons = (await repo.getAll('Lessons_Log')).map(mapLesson)
    .filter((l) => l.student_id === studentId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const balance = (await repo.getAll('Balance_Log')).map(mapBalance)
    .filter((e) => e.student_id === studentId)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  return { student, lessons, balance };
}
