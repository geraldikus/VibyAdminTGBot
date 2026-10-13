export const SHEET_NAMES = [
  'Settings',
  'Teachers',
  'Students',
  'Lessons_Log',
  'Balance_Log',
  'Audit_Log',
  'Business_Reports',
] as const;

export type SheetName = (typeof SHEET_NAMES)[number];

export const COLUMNS: Record<SheetName, readonly string[]> = {
  Settings: ['key', 'value'],
  Teachers: ['teacher_id', 'telegram_id', 'name', 'username', 'active', 'created_at'],
  Students: [
    'student_id',
    'name',
    'contact',
    'teacher_id',
    'teacher_name',
    'type',
    'status',
    'balance',
    'notes',
    'active',
    'created_at',
    'updated_at',
  ],
  Lessons_Log: [
    'lesson_id',
    'created_at',
    'lesson_date',
    'student_id',
    'student_name',
    'teacher_id',
    'teacher_name',
    'duration_min',
    'student_type',
    'status_at_lesson',
    'state',
    'photo_link',
    'photo_file_id',
    'photo_message_id',
    'balance_after',
    'comment',
    'confirmed_at',
    'reminder_sent',
    'admin_alerted',
    'cancelled_at',
    'cancelled_by',
  ],
  Balance_Log: [
    'entry_id',
    'created_at',
    'student_id',
    'student_name',
    'change',
    'balance_after',
    'reason',
    'lesson_id',
    'by',
  ],
  Audit_Log: ['created_at', 'entity', 'entity_id', 'field', 'old_value', 'new_value', 'by'],
  Business_Reports: [
    'month',
    'student_id',
    'student_name',
    'teacher_name',
    'lessons_count',
    'total_minutes',
    'generated_at',
    'trigger',
  ],
};

export const ID_COLUMNS: Partial<Record<SheetName, string>> = {
  Teachers: 'teacher_id',
  Students: 'student_id',
  Lessons_Log: 'lesson_id',
  Balance_Log: 'entry_id',
};

export const DROPDOWNS: Partial<Record<SheetName, Record<string, string[]>>> = {
  Teachers: { active: ['TRUE', 'FALSE'] },
  Students: {
    type: ['subscription', 'business'],
    status: ['green', 'yellow', 'red', 'blue'],
    active: ['TRUE', 'FALSE'],
  },
  Lessons_Log: {
    student_type: ['subscription', 'business'],
    status_at_lesson: ['green', 'yellow', 'red', 'blue'],
    state: ['pending_photo', 'done', 'cancelled'],
  },
};
