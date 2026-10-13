import { randomUUID } from 'node:crypto';
import type { Teacher } from '@school/shared';
import { nowIso } from '../time.js';
import { repo } from '../sheets/repo.js';
import { mapTeacher } from '../sheets/mappers.js';
import { writeAudit } from './audit.js';

export async function listTeachers(includeInactive = true): Promise<Teacher[]> {
  const rows = await repo.getAll('Teachers');
  return rows.map(mapTeacher).filter((t) => includeInactive || t.active);
}

export async function findTeacherByTelegramId(telegramId: string): Promise<Teacher | undefined> {
  const teachers = await listTeachers(true);
  return teachers.find((t) => t.telegram_id === String(telegramId));
}

export async function findTeacherById(teacherId: string): Promise<Teacher | undefined> {
  const row = await repo.findById('Teachers', teacherId);
  return row ? mapTeacher(row) : undefined;
}

export async function upsertPendingTeacher(input: {
  telegramId: string;
  name: string;
  username: string;
}): Promise<{ teacher: Teacher; created: boolean }> {
  const existing = await findTeacherByTelegramId(input.telegramId);
  if (existing) return { teacher: existing, created: false };
  const teacher: Teacher = {
    teacher_id: randomUUID(),
    telegram_id: String(input.telegramId),
    name: input.name || `Teacher ${input.telegramId}`,
    username: input.username,
    active: false,
    created_at: nowIso(),
  };
  await repo.write(async () => {
    await repo.appendRows('Teachers', [teacher]);
  });
  return { teacher, created: true };
}

export async function approveTeacher(teacherId: string, by: string): Promise<Teacher> {
  const teacher = await findTeacherById(teacherId);
  if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });
  if (teacher.active) return teacher;
  const updated = await repo.write(async () => {
    const row = await repo.updateById('Teachers', teacherId, { active: true });
    await writeAudit({
      entity: 'teacher',
      entity_id: teacherId,
      field: 'active',
      old_value: 'FALSE',
      new_value: 'TRUE',
      by,
    });
    return mapTeacher(row);
  });
  return updated;
}

export async function updateTeacher(
  teacherId: string,
  patch: { name?: string; active?: boolean },
  by: string,
): Promise<Teacher> {
  const teacher = await findTeacherById(teacherId);
  if (!teacher) throw Object.assign(new Error('Teacher not found'), { statusCode: 404 });
  return repo.write(async () => {
    const next = await repo.updateById('Teachers', teacherId, patch);
    for (const field of Object.keys(patch) as Array<keyof typeof patch>) {
      if (patch[field] === undefined) continue;
      await writeAudit({
        entity: 'teacher',
        entity_id: teacherId,
        field,
        old_value: String(teacher[field] ?? ''),
        new_value: String(patch[field]),
        by,
      });
    }
    if (patch.name && patch.name !== teacher.name) {
      const students = (await repo.getAll('Students')).filter((s) => s.teacher_id === teacherId);
      for (const student of students) {
        await repo.updateById('Students', student.student_id, { teacher_name: patch.name });
      }
    }
    return mapTeacher(next);
  });
}
