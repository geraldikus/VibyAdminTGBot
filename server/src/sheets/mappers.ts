import type {
  AppSettings,
  AuditEntry,
  BalanceEntry,
  BalanceReason,
  BusinessReportRow,
  Lesson,
  LessonState,
  Status,
  Student,
  StudentType,
  Teacher,
} from '@school/shared';
import { DEFAULT_SETTINGS } from '@school/shared';

function bool(value: string): boolean {
  return /^(true|1|yes)$/i.test(value.trim());
}

function num(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function mapTeacher(row: Record<string, string>): Teacher {
  return {
    teacher_id: row.teacher_id,
    telegram_id: String(row.telegram_id),
    name: row.name,
    username: row.username,
    active: bool(row.active),
    created_at: row.created_at,
  };
}

export function mapStudent(row: Record<string, string>): Student {
  return {
    student_id: row.student_id,
    name: row.name,
    contact: row.contact,
    teacher_id: row.teacher_id,
    teacher_name: row.teacher_name,
    type: (row.type || 'subscription') as StudentType,
    status: (row.status || 'green') as Status,
    balance: num(row.balance),
    notes: row.notes,
    active: row.active === '' ? true : bool(row.active),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function mapLesson(row: Record<string, string>): Lesson {
  return {
    lesson_id: row.lesson_id,
    created_at: row.created_at,
    lesson_date: row.lesson_date,
    student_id: row.student_id,
    student_name: row.student_name,
    teacher_id: row.teacher_id,
    teacher_name: row.teacher_name,
    duration_min: num(row.duration_min),
    student_type: (row.student_type || 'subscription') as StudentType,
    status_at_lesson: (row.status_at_lesson || 'green') as Status,
    state: (row.state || 'pending_photo') as LessonState,
    photo_link: row.photo_link,
    photo_file_id: row.photo_file_id,
    photo_message_id: row.photo_message_id,
    balance_after: row.balance_after,
    comment: row.comment,
    confirmed_at: row.confirmed_at,
    reminder_sent: row.reminder_sent,
    admin_alerted: row.admin_alerted,
    cancelled_at: row.cancelled_at,
    cancelled_by: row.cancelled_by,
  };
}

export function mapBalance(row: Record<string, string>): BalanceEntry {
  return {
    entry_id: row.entry_id,
    created_at: row.created_at,
    student_id: row.student_id,
    student_name: row.student_name,
    change: num(row.change),
    balance_after: num(row.balance_after),
    reason: (row.reason || 'manual') as BalanceReason,
    lesson_id: row.lesson_id,
    by: row.by,
  };
}

export function mapAudit(row: Record<string, string>): AuditEntry {
  return {
    created_at: row.created_at,
    entity: row.entity,
    entity_id: row.entity_id,
    field: row.field,
    old_value: row.old_value,
    new_value: row.new_value,
    by: row.by,
  };
}

export function mapReport(row: Record<string, string>): BusinessReportRow {
  return {
    month: row.month,
    student_id: row.student_id,
    student_name: row.student_name,
    teacher_name: row.teacher_name,
    lessons_count: num(row.lessons_count),
    total_minutes: num(row.total_minutes),
    generated_at: row.generated_at,
    trigger: row.trigger === 'manual' ? 'manual' : 'auto',
  };
}

export function mapSettings(rows: Record<string, string>[]): AppSettings {
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const numOr = (key: keyof AppSettings, fallback: number) => {
    const n = Number(map.get(key));
    return Number.isFinite(n) ? n : fallback;
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
