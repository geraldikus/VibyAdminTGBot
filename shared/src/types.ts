import { z } from 'zod';

export const STATUSES = ['green', 'yellow', 'red', 'blue'] as const;
export type Status = (typeof STATUSES)[number];

export const STUDENT_TYPES = ['subscription', 'business'] as const;
export type StudentType = (typeof STUDENT_TYPES)[number];

export const LESSON_STATES = ['pending_photo', 'done', 'cancelled'] as const;
export type LessonState = (typeof LESSON_STATES)[number];

export const ROLES = ['admin', 'teacher'] as const;
export type Role = (typeof ROLES)[number];

export const BALANCE_REASONS = [
  'top_up',
  'lesson',
  'lesson_cancel',
  'lesson_moved',
  'manual',
] as const;
export type BalanceReason = (typeof BALANCE_REASONS)[number];

export interface Teacher {
  teacher_id: string;
  telegram_id: string;
  name: string;
  username: string;
  active: boolean;
  created_at: string;
}

export interface Student {
  student_id: string;
  name: string;
  contact: string;
  teacher_id: string;
  teacher_name: string;
  type: StudentType;
  status: Status;
  balance: number;
  notes: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Lesson {
  lesson_id: string;
  created_at: string;
  lesson_date: string;
  student_id: string;
  student_name: string;
  teacher_id: string;
  teacher_name: string;
  duration_min: number;
  student_type: StudentType;
  status_at_lesson: Status;
  state: LessonState;
  photo_link: string;
  photo_file_id: string;
  photo_message_id: string;
  balance_after: string;
  comment: string;
  confirmed_at: string;
  reminder_sent: string;
  admin_alerted: string;
  cancelled_at: string;
  cancelled_by: string;
}

export interface BalanceEntry {
  entry_id: string;
  created_at: string;
  student_id: string;
  student_name: string;
  change: number;
  balance_after: number;
  reason: BalanceReason;
  lesson_id: string;
  by: string;
}

export interface AuditEntry {
  created_at: string;
  entity: string;
  entity_id: string;
  field: string;
  old_value: string;
  new_value: string;
  by: string;
}

export interface BusinessReportRow {
  month: string;
  student_id: string;
  student_name: string;
  teacher_name: string;
  lessons_count: number;
  total_minutes: number;
  generated_at: string;
  trigger: 'auto' | 'manual';
}

export interface AppSettings {
  backdate_days: number;
  edit_window_min: number;
  photo_reminder_min: number;
  photo_admin_alert_min: number;
  timezone: string;
  last_business_report: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  backdate_days: 7,
  edit_window_min: 5,
  photo_reminder_min: 10,
  photo_admin_alert_min: 60,
  timezone: 'Europe/Moscow',
  last_business_report: '',
};

export interface AuthUser {
  telegramId: string;
  name: string;
  username: string;
  role: Role;
  teacherId?: string;
}

export const createLessonSchema = z.object({
  client_id: z.string().min(8),
  student_id: z.string().min(1),
  duration_min: z.number().int().min(1).max(300),
  lesson_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  comment: z.string().max(500).optional().default(''),
});

export const editLessonSchema = z.object({
  duration_min: z.number().int().min(1).max(300).optional(),
  lesson_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  student_id: z.string().min(1).optional(),
  comment: z.string().max(500).optional(),
});

export const createStudentSchema = z.object({
  name: z.string().min(1).max(120),
  contact: z.string().max(200).optional().default(''),
  teacher_id: z.string().min(1),
  type: z.enum(STUDENT_TYPES),
  status: z.enum(STATUSES),
  balance: z.number().optional().default(0),
  notes: z.string().max(1000).optional().default(''),
});

export const updateStudentSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  contact: z.string().max(200).optional(),
  teacher_id: z.string().min(1).optional(),
  type: z.enum(STUDENT_TYPES).optional(),
  status: z.enum(STATUSES).optional(),
  notes: z.string().max(1000).optional(),
  active: z.boolean().optional(),
});

export const topUpSchema = z.object({
  amount: z.number().refine((n) => n !== 0, 'Amount cannot be 0'),
});

export const updateTeacherSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  active: z.boolean().optional(),
});

export const businessReportSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

export type CreateLessonInput = z.infer<typeof createLessonSchema>;
export type EditLessonInput = z.infer<typeof editLessonSchema>;
export type CreateStudentInput = z.infer<typeof createStudentSchema>;
export type UpdateStudentInput = z.infer<typeof updateStudentSchema>;

export const STATUS_LABEL: Record<Status, string> = {
  green: 'Paid',
  yellow: 'Waiting for payment',
  red: 'Not paid',
  blue: 'Business client',
};

export const STATUS_EMOJI: Record<Status, string> = {
  green: '🟢',
  yellow: '🟡',
  red: '🔴',
  blue: '🔵',
};
