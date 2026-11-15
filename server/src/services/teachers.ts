import { randomUUID } from 'node:crypto';
import type { Teacher } from '@school/shared';
import { nowIso } from '../time.js';
import { db, tx } from '../db/index.js';
import { findTeacherByTelegramRow, findTeacherRow, toTeacher } from '../db/rows.js';
import { httpError } from '../errors.js';
import { writeAudit } from './audit.js';

const listStmt = db.prepare('SELECT * FROM teachers ORDER BY name');

export async function listTeachers(includeInactive = true): Promise<Teacher[]> {
  const rows = (listStmt.all() as Parameters<typeof toTeacher>[0][]).map(toTeacher);
  return includeInactive ? rows : rows.filter((t) => t.active);
}

export async function findTeacherByTelegramId(telegramId: string): Promise<Teacher | undefined> {
  return findTeacherByTelegramRow(String(telegramId));
}

export async function findTeacherById(teacherId: string): Promise<Teacher | undefined> {
  return findTeacherRow(teacherId);
}

const insertPendingStmt = db.prepare(
  `INSERT INTO teachers (teacher_id, telegram_id, name, username, active, created_at)
   VALUES (@teacher_id, @telegram_id, @name, @username, 0, @created_at)
   ON CONFLICT (telegram_id) WHERE telegram_id <> '' DO NOTHING`,
);

/** Atomic: two concurrent /start calls create exactly one row (unique telegram_id). */
export async function upsertPendingTeacher(input: {
  telegramId: string;
  name: string;
  username: string;
}): Promise<{ teacher: Teacher; created: boolean }> {
  const telegramId = String(input.telegramId);
  return tx(() => {
    const info = insertPendingStmt.run({
      teacher_id: randomUUID(),
      telegram_id: telegramId,
      name: input.name || `Teacher ${telegramId}`,
      username: input.username,
      created_at: nowIso(),
    });
    const teacher = findTeacherByTelegramRow(telegramId)!;
    return { teacher, created: info.changes === 1 };
  });
}

export async function approveTeacher(teacherId: string, by: string): Promise<Teacher> {
  return tx(() => {
    const teacher = findTeacherRow(teacherId);
    if (!teacher) throw httpError('Teacher not found', 404);
    if (teacher.active) return teacher;
    db.prepare('UPDATE teachers SET active = 1 WHERE teacher_id = ?').run(teacherId);
    writeAudit({ entity: 'teacher', entity_id: teacherId, field: 'active', old_value: 'FALSE', new_value: 'TRUE', by });
    return { ...teacher, active: true };
  });
}

export async function updateTeacher(
  teacherId: string,
  patch: { name?: string; active?: boolean },
  by: string,
): Promise<Teacher> {
  return tx(() => {
    const teacher = findTeacherRow(teacherId);
    if (!teacher) throw httpError('Teacher not found', 404);
    if (patch.name !== undefined && patch.name !== teacher.name) {
      db.prepare('UPDATE teachers SET name = ? WHERE teacher_id = ?').run(patch.name, teacherId);
      db.prepare('UPDATE students SET teacher_name = ? WHERE teacher_id = ?').run(patch.name, teacherId);
      writeAudit({ entity: 'teacher', entity_id: teacherId, field: 'name', old_value: teacher.name, new_value: patch.name, by });
    }
    if (patch.active !== undefined && patch.active !== teacher.active) {
      db.prepare('UPDATE teachers SET active = ? WHERE teacher_id = ?').run(patch.active ? 1 : 0, teacherId);
      writeAudit({
        entity: 'teacher',
        entity_id: teacherId,
        field: 'active',
        old_value: String(teacher.active),
        new_value: String(patch.active),
        by,
      });
    }
    return findTeacherRow(teacherId)!;
  });
}
