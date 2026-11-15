import type {
  AppSettings,
  BalanceEntry,
  BusinessReportRow,
  Lesson,
  Student,
  Teacher,
} from '@school/shared';
import { DEFAULT_SETTINGS } from '@school/shared';
import { db } from './index.js';

type DbTeacher = Omit<Teacher, 'active'> & { active: number };
type DbStudent = Omit<Student, 'active'> & { active: number };

export function toTeacher(row: DbTeacher): Teacher {
  return { ...row, active: Boolean(row.active) };
}

export function toStudent(row: DbStudent): Student {
  return { ...row, active: Boolean(row.active) };
}

const stmts = {
  teacherById: db.prepare<[string], DbTeacher>('SELECT * FROM teachers WHERE teacher_id = ?'),
  teacherByTg: db.prepare<[string], DbTeacher>('SELECT * FROM teachers WHERE telegram_id = ?'),
  studentById: db.prepare<[string], DbStudent>('SELECT * FROM students WHERE student_id = ?'),
  lessonById: db.prepare<[string], Lesson>('SELECT * FROM lessons WHERE lesson_id = ?'),
  settings: db.prepare<[], { key: string; value: string }>('SELECT key, value FROM settings'),
  setSetting: db.prepare<[string, string]>(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
  ),
  audit: db.prepare(
    `INSERT INTO audit_log (created_at, entity, entity_id, field, old_value, new_value, "by")
     VALUES (@created_at, @entity, @entity_id, @field, @old_value, @new_value, @by)`,
  ),
};

export function findTeacherRow(teacherId: string): Teacher | undefined {
  const row = stmts.teacherById.get(teacherId);
  return row ? toTeacher(row) : undefined;
}

export function findTeacherByTelegramRow(telegramId: string): Teacher | undefined {
  const row = stmts.teacherByTg.get(String(telegramId));
  return row ? toTeacher(row) : undefined;
}

export function findStudentRow(studentId: string): Student | undefined {
  const row = stmts.studentById.get(studentId);
  return row ? toStudent(row) : undefined;
}

export function findLessonRow(lessonId: string): Lesson | undefined {
  return stmts.lessonById.get(lessonId);
}

export function readSettingsMap(): Map<string, string> {
  return new Map(stmts.settings.all().map((r) => [r.key, r.value]));
}

export function readSettings(): AppSettings {
  const map = readSettingsMap();
  const numOr = (key: keyof AppSettings, fallback: number) => {
    const raw = map.get(key);
    const n = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(n) ? n : fallback;
  };
  return {
    backdate_days: numOr('backdate_days', DEFAULT_SETTINGS.backdate_days),
    edit_window_min: numOr('edit_window_min', DEFAULT_SETTINGS.edit_window_min),
    photo_reminder_min: numOr('photo_reminder_min', DEFAULT_SETTINGS.photo_reminder_min),
    photo_admin_alert_min: numOr('photo_admin_alert_min', DEFAULT_SETTINGS.photo_admin_alert_min),
    timezone: map.get('timezone') || DEFAULT_SETTINGS.timezone,
    last_business_report: map.get('last_business_report') ?? DEFAULT_SETTINGS.last_business_report,
  };
}

export function setSetting(key: string, value: string | number) {
  stmts.setSetting.run(key, String(value));
}

export function insertAudit(entry: {
  created_at: string;
  entity: string;
  entity_id: string;
  field: string;
  old_value: string;
  new_value: string;
  by: string;
}) {
  stmts.audit.run(entry);
}

export type { BalanceEntry, BusinessReportRow };
