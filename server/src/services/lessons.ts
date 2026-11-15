import { InputFile } from 'grammy';
import type { AuthUser, CreateLessonInput, EditLessonInput, Lesson } from '@school/shared';
import { daysBetweenYmd, minutesAgo, monthBounds, nowIso, prettyDate, todayYmd } from '../time.js';
import { db, tx } from '../db/index.js';
import { findLessonRow, findStudentRow, findTeacherRow, readSettings } from '../db/rows.js';
import { httpError } from '../errors.js';
import { getStudent } from './students.js';
import { applyBalanceChangeSync, statusAfterBalance } from './balance.js';
import { writeAudit } from './audit.js';
import {
  channelLink,
  getApi,
  getPhotoChannelId,
  lessonCaption,
  notifyAdmins,
  requestLessonPhoto,
  sendLessonAlerts,
} from './notify.js';

export const PAGE_SIZE = 50;

export interface LessonFilter {
  teacherId?: string;
  studentId?: string;
  state?: string;
  /** YYYY-MM, filters by lesson_date */
  month?: string;
  limit?: number;
  /** Cursor from a previous page: `${created_at}|${lesson_id}` */
  before?: string;
}

export function listLessonsPage(filter: LessonFilter = {}): { lessons: Lesson[]; next_cursor: string | null } {
  const where: string[] = [];
  const params: Record<string, string | number> = {};
  if (filter.teacherId) {
    where.push('teacher_id = @teacherId');
    params.teacherId = filter.teacherId;
  }
  if (filter.studentId) {
    where.push('student_id = @studentId');
    params.studentId = filter.studentId;
  }
  if (filter.state) {
    where.push('state = @state');
    params.state = filter.state;
  }
  if (filter.month && /^\d{4}-\d{2}$/.test(filter.month)) {
    const { start, end } = monthBounds(filter.month);
    where.push('lesson_date BETWEEN @start AND @end');
    params.start = start;
    params.end = end;
  }
  if (filter.before) {
    const [createdAt, lessonId = ''] = filter.before.split('|');
    where.push('(created_at < @bc OR (created_at = @bc AND lesson_id < @bl))');
    params.bc = createdAt;
    params.bl = lessonId;
  }
  const limit = Math.min(Math.max(filter.limit ?? PAGE_SIZE, 1), 200);
  params.limit = limit + 1;
  const sql = `SELECT * FROM lessons ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY created_at DESC, lesson_id DESC LIMIT @limit`;
  const rows = db.prepare(sql).all(params) as Lesson[];
  const hasMore = rows.length > limit;
  const lessons = hasMore ? rows.slice(0, limit) : rows;
  const last = lessons.at(-1);
  return { lessons, next_cursor: hasMore && last ? `${last.created_at}|${last.lesson_id}` : null };
}

export async function getLesson(lessonId: string): Promise<Lesson> {
  const lesson = findLessonRow(lessonId);
  if (!lesson) throw httpError('Lesson not found', 404);
  return lesson;
}

const insertLessonStmt = db.prepare(
  `INSERT INTO lessons (lesson_id, created_at, lesson_date, student_id, student_name, teacher_id, teacher_name,
     duration_min, student_type, status_at_lesson, state, comment)
   VALUES (@lesson_id, @created_at, @lesson_date, @student_id, @student_name, @teacher_id, @teacher_name,
     @duration_min, @student_type, @status_at_lesson, 'pending_photo', @comment)
   ON CONFLICT (lesson_id) DO NOTHING`,
);

const LESSON_COLUMNS = new Set<keyof Lesson>([
  'lesson_date', 'student_id', 'student_name', 'duration_min', 'student_type', 'status_at_lesson', 'state',
  'photo_link', 'photo_file_id', 'photo_message_id', 'balance_after', 'comment', 'confirmed_at',
  'reminder_sent', 'admin_alerted', 'cancelled_at', 'cancelled_by',
]);

/** Must run inside tx(). */
function updateLessonSync(lessonId: string, patch: Partial<Lesson>, onlyIfState?: Lesson['state']): boolean {
  const entries = Object.entries(patch).filter(([k, v]) => v !== undefined && LESSON_COLUMNS.has(k as keyof Lesson));
  if (!entries.length) return true;
  const sets = entries.map(([k]) => `${k} = @${k}`).join(', ');
  const params: Record<string, unknown> = Object.fromEntries(entries.map(([k, v]) => [k, v === null ? '' : v]));
  params.lesson_id = lessonId;
  let sql = `UPDATE lessons SET ${sets} WHERE lesson_id = @lesson_id`;
  if (onlyIfState) {
    sql += ' AND state = @only_state';
    params.only_state = onlyIfState;
  }
  return db.prepare(sql).run(params).changes === 1;
}

export async function createLesson(input: CreateLessonInput, user: AuthUser): Promise<Lesson> {
  const settings = readSettings();
  const today = todayYmd(settings.timezone);
  if (input.lesson_date > today) throw httpError('Lesson date cannot be in the future', 400);
  if (daysBetweenYmd(input.lesson_date, today) > settings.backdate_days) {
    throw httpError(`Lesson date cannot be older than ${settings.backdate_days} days`, 400);
  }

  const result = tx(() => {
    // Idempotent: a retried request with the same client_id returns the same lesson.
    const existing = findLessonRow(input.client_id);
    if (existing) return { lesson: existing, created: false };

    const student = findStudentRow(input.student_id);
    if (!student) throw httpError('Student not found', 404);
    if (!student.active) throw httpError('Student is archived', 400);
    if (user.role === 'teacher' && student.teacher_id !== user.teacherId) {
      throw httpError('You can only mark lessons for your students', 403);
    }
    const teacherId = user.role === 'teacher' ? user.teacherId! : student.teacher_id;
    const teacherName = user.role === 'teacher' ? user.name : student.teacher_name;
    insertLessonStmt.run({
      lesson_id: input.client_id,
      created_at: nowIso(settings.timezone),
      lesson_date: input.lesson_date,
      student_id: student.student_id,
      student_name: student.name,
      teacher_id: teacherId,
      teacher_name: teacherName,
      duration_min: input.duration_min,
      student_type: student.type,
      status_at_lesson: student.status,
      comment: input.comment ?? '',
    });
    return { lesson: findLessonRow(input.client_id)!, created: true };
  });

  if (result.created) {
    const teacherTelegramId = user.role === 'teacher'
      ? user.telegramId
      : findTeacherRow(result.lesson.teacher_id)?.telegram_id;
    if (teacherTelegramId) await requestLessonPhoto(teacherTelegramId, result.lesson);
  }
  return result.lesson;
}

export async function pendingPhotosForTeacher(teacherId: string): Promise<Lesson[]> {
  if (!teacherId) return [];
  return db
    .prepare("SELECT * FROM lessons WHERE teacher_id = ? AND state = 'pending_photo' ORDER BY created_at")
    .all(teacherId) as Lesson[];
}

async function deleteChannelPost(messageId: number) {
  const channelId = getPhotoChannelId();
  if (!channelId) return;
  try {
    await getApi().deleteMessage(channelId, messageId);
  } catch (error) {
    console.error('Failed to delete orphan channel post', messageId, error);
  }
}

export async function confirmLessonWithPhoto(input: {
  lesson: Lesson;
  fileId: string;
  buffer?: Buffer;
}): Promise<Lesson> {
  const channelId = getPhotoChannelId();
  if (!channelId) throw httpError('Photo channel is not configured yet', 500);

  const current = await getLesson(input.lesson.lesson_id);
  if (current.state !== 'pending_photo') return current;
  const studentBefore = await getStudent(current.student_id);
  const isSub = studentBefore.type === 'subscription';
  const predictedBalance = isSub ? studentBefore.balance - 1 : studentBefore.balance;

  const caption = lessonCaption(current, '', {
    status: statusAfterBalance(studentBefore, predictedBalance, -1),
    balanceAfter: isSub ? predictedBalance : undefined,
  });
  const api = getApi();
  const sent = input.buffer
    ? await api.sendPhoto(channelId, new InputFile(input.buffer, 'lesson.jpg'), { caption })
    : await api.sendPhoto(channelId, input.fileId, { caption });

  const photoFileId = sent.photo?.at(-1)?.file_id ?? input.fileId;
  const messageId = String(sent.message_id);
  const link = channelLink(messageId);
  const confirmedAt = nowIso(readSettings().timezone);

  let outcome: { lesson: Lesson; applied: boolean };
  try {
    outcome = tx(() => {
      const latest = findLessonRow(current.lesson_id)!;
      if (latest.state !== 'pending_photo') return { lesson: latest, applied: false };
      const student = findStudentRow(latest.student_id)!;
      let balanceAfter = '';
      if (student.type === 'subscription') {
        const res = applyBalanceChangeSync({
          studentId: student.student_id,
          change: -1,
          reason: 'lesson',
          lessonId: latest.lesson_id,
          by: latest.teacher_name,
        });
        balanceAfter = String(res.balanceAfter);
      }
      updateLessonSync(latest.lesson_id, {
        state: 'done',
        photo_link: link,
        photo_file_id: photoFileId,
        photo_message_id: messageId,
        balance_after: balanceAfter,
        confirmed_at: confirmedAt,
      }, 'pending_photo');
      return { lesson: findLessonRow(latest.lesson_id)!, applied: true };
    });
  } catch (error) {
    await deleteChannelPost(sent.message_id);
    throw error;
  }

  if (!outcome.applied) {
    // Another request confirmed this lesson while we were uploading: drop our duplicate post.
    await deleteChannelPost(sent.message_id);
    return outcome.lesson;
  }

  const student = await getStudent(outcome.lesson.student_id);
  await sendLessonAlerts(
    outcome.lesson,
    student,
    student.type === 'subscription' ? Number(outcome.lesson.balance_after) : undefined,
  );
  return outcome.lesson;
}

function canEdit(lesson: Lesson, user: AuthUser, editWindowMin: number) {
  if (lesson.state !== 'done') return false;
  if (user.role === 'admin') return true;
  if (user.role === 'teacher' && lesson.teacher_id !== user.teacherId) return false;
  return minutesAgo(lesson.confirmed_at) <= editWindowMin;
}

export async function cancelLesson(lessonId: string, user: AuthUser): Promise<Lesson> {
  const settings = readSettings();
  const lesson = await getLesson(lessonId);
  if (lesson.state === 'cancelled') return lesson;
  if (lesson.state === 'pending_photo' && user.role === 'teacher' && lesson.teacher_id !== user.teacherId) {
    throw httpError('Forbidden', 403);
  }
  if (lesson.state === 'done' && !canEdit(lesson, user, settings.edit_window_min)) {
    throw httpError('Edit window has expired', 403);
  }

  const { lesson: cancelled, changed } = tx(() => {
    const current = findLessonRow(lessonId)!;
    // Idempotent: re-check inside the transaction, a retry after success is a no-op.
    if (current.state === 'cancelled') return { lesson: current, changed: false };
    if (current.state === 'done') {
      const student = findStudentRow(current.student_id);
      if (student?.type === 'subscription') {
        applyBalanceChangeSync({
          studentId: current.student_id,
          change: 1,
          reason: 'lesson_cancel',
          lessonId,
          by: user.name,
        });
      }
    }
    updateLessonSync(lessonId, {
      state: 'cancelled',
      cancelled_at: nowIso(settings.timezone),
      cancelled_by: user.name,
    }, current.state);
    writeAudit({
      entity: 'lesson',
      entity_id: lessonId,
      field: 'state',
      old_value: current.state,
      new_value: 'cancelled',
      by: user.name,
    });
    return { lesson: findLessonRow(lessonId)!, changed: true };
  });

  if (!changed) return cancelled;
  await markChannelCancelled(cancelled);
  if (user.role === 'teacher') {
    const what = lesson.state === 'pending_photo' ? 'a pending lesson' : 'a lesson';
    await notifyAdmins(`Teacher cancelled ${what}\n${lessonCaption(cancelled)}`);
  }
  return cancelled;
}

export async function editLesson(lessonId: string, patch: EditLessonInput, user: AuthUser): Promise<Lesson> {
  const settings = readSettings();
  const lesson = await getLesson(lessonId);
  if (lesson.state === 'cancelled') throw httpError('Cancelled lessons cannot be edited', 400);
  if (user.role === 'teacher' && lesson.teacher_id !== user.teacherId) throw httpError('Forbidden', 403);
  if (user.role === 'teacher' && patch.student_id && patch.student_id !== lesson.student_id) {
    throw httpError('Teachers cannot change the student', 403);
  }
  if (lesson.state === 'done' && !canEdit(lesson, user, settings.edit_window_min)) {
    throw httpError('Edit window has expired', 403);
  }
  if (patch.lesson_date && user.role === 'teacher') {
    const today = todayYmd(settings.timezone);
    if (patch.lesson_date > today) throw httpError('Lesson date cannot be in the future', 400);
    if (daysBetweenYmd(patch.lesson_date, today) > settings.backdate_days) {
      throw httpError(`Lesson date cannot be older than ${settings.backdate_days} days`, 400);
    }
  }

  const updated = tx(() => {
    const current = findLessonRow(lessonId)!;
    if (current.state === 'cancelled') throw httpError('Cancelled lessons cannot be edited', 400);
    const next: Partial<Lesson> = {};
    if (patch.duration_min !== undefined) next.duration_min = patch.duration_min;
    if (patch.lesson_date !== undefined) next.lesson_date = patch.lesson_date;
    if (patch.comment !== undefined) next.comment = patch.comment;

    // Compared against the row read inside the transaction, so a retried move is a no-op.
    if (patch.student_id && patch.student_id !== current.student_id) {
      const to = findStudentRow(patch.student_id);
      if (!to) throw httpError('Student not found', 404);
      next.student_id = to.student_id;
      next.student_name = to.name;
      next.student_type = to.type;
      next.status_at_lesson = to.status;
      if (current.state === 'done') {
        const from = findStudentRow(current.student_id);
        if (from?.type === 'subscription') {
          applyBalanceChangeSync({ studentId: from.student_id, change: 1, reason: 'lesson_moved', lessonId, by: user.name });
        }
        if (to.type === 'subscription') {
          const { balanceAfter } = applyBalanceChangeSync({
            studentId: to.student_id,
            change: -1,
            reason: 'lesson_moved',
            lessonId,
            by: user.name,
          });
          next.balance_after = String(balanceAfter);
        } else {
          next.balance_after = '';
        }
      }
    }

    const changed = Object.entries(next).filter(
      ([field, value]) => String((current as unknown as Record<string, unknown>)[field] ?? '') !== String(value),
    );
    updateLessonSync(lessonId, Object.fromEntries(changed) as Partial<Lesson>);
    for (const [field, value] of changed) {
      writeAudit({
        entity: 'lesson',
        entity_id: lessonId,
        field,
        old_value: String((current as unknown as Record<string, unknown>)[field] ?? ''),
        new_value: String(value),
        by: user.name,
      });
    }
    return findLessonRow(lessonId)!;
  });

  await refreshChannelCaption(updated);
  if (user.role === 'teacher') {
    await notifyAdmins(`Teacher edited a lesson\n${lessonCaption(updated)}`);
  }
  return updated;
}

export async function replaceLessonPhoto(lessonId: string, fileId: string, user: AuthUser): Promise<Lesson> {
  const settings = readSettings();
  const lesson = await getLesson(lessonId);
  if (lesson.state === 'pending_photo') {
    return confirmLessonWithPhoto({ lesson, fileId });
  }
  if (user.role === 'teacher' && lesson.teacher_id !== user.teacherId) throw httpError('Forbidden', 403);
  if (!canEdit(lesson, user, settings.edit_window_min)) {
    throw httpError('Edit window has expired', 403);
  }
  const channelId = getPhotoChannelId();
  if (!channelId) throw httpError('Photo channel is not configured yet', 500);
  const sent = await getApi().sendPhoto(channelId, fileId, {
    caption: lessonCaption(lesson, 'UPDATED PHOTO'),
  });
  const link = channelLink(sent.message_id);
  let updated: Lesson;
  try {
    updated = tx(() => {
      updateLessonSync(lessonId, {
        photo_file_id: sent.photo?.at(-1)?.file_id ?? fileId,
        photo_message_id: String(sent.message_id),
        photo_link: link,
      }, 'done');
      writeAudit({
        entity: 'lesson',
        entity_id: lessonId,
        field: 'photo',
        old_value: lesson.photo_link,
        new_value: link,
        by: user.name,
      });
      return findLessonRow(lessonId)!;
    });
  } catch (error) {
    await deleteChannelPost(sent.message_id);
    throw error;
  }
  if (user.role === 'teacher') {
    await notifyAdmins(`Teacher replaced a lesson photo\n${lessonCaption(updated)}`);
  }
  return updated;
}

async function markChannelCancelled(lesson: Lesson) {
  const channelId = getPhotoChannelId();
  if (!channelId || !lesson.photo_message_id) return;
  try {
    await getApi().editMessageCaption(channelId, Number(lesson.photo_message_id), {
      caption: lessonCaption(lesson, 'CANCELLED'),
    });
  } catch (error) {
    console.error('Failed to mark cancelled caption', error);
  }
}

async function refreshChannelCaption(lesson: Lesson) {
  const channelId = getPhotoChannelId();
  if (!channelId || !lesson.photo_message_id) return;
  try {
    await getApi().editMessageCaption(channelId, Number(lesson.photo_message_id), {
      caption: lessonCaption(lesson, lesson.state === 'cancelled' ? 'CANCELLED' : 'UPDATED'),
    });
  } catch (error) {
    console.error('Failed to refresh caption', error);
  }
}

const claimReminderStmt = db.prepare(
  "UPDATE lessons SET reminder_sent = ? WHERE lesson_id = ? AND reminder_sent = '' AND state = 'pending_photo'",
);
const claimAdminAlertStmt = db.prepare(
  "UPDATE lessons SET admin_alerted = ? WHERE lesson_id = ? AND admin_alerted = '' AND state = 'pending_photo'",
);

let remindersRunning = false;

/**
 * Runs every minute. Overlapping runs are skipped, and each reminder is "claimed"
 * with a conditional UPDATE before it is sent, so a teacher never gets it twice.
 */
export async function processPhotoReminders() {
  if (remindersRunning) return;
  remindersRunning = true;
  try {
    const settings = readSettings();
    const pending = db
      .prepare("SELECT * FROM lessons WHERE state = 'pending_photo' AND (reminder_sent = '' OR admin_alerted = '')")
      .all() as Lesson[];
    for (const lesson of pending) {
      const age = minutesAgo(lesson.created_at, settings.timezone);
      const now = nowIso(settings.timezone);
      if (!lesson.reminder_sent && age >= settings.photo_reminder_min
        && claimReminderStmt.run(now, lesson.lesson_id).changes === 1) {
        const teacher = findTeacherRow(lesson.teacher_id);
        if (teacher?.telegram_id) await requestLessonPhoto(teacher.telegram_id, lesson);
      }
      if (!lesson.admin_alerted && age >= settings.photo_admin_alert_min
        && claimAdminAlertStmt.run(now, lesson.lesson_id).changes === 1) {
        await notifyAdmins(
          `No photo for ${lesson.teacher_name} / ${lesson.student_name} (${prettyDate(lesson.lesson_date)}, ${lesson.duration_min} min)`,
        );
      }
    }
  } finally {
    remindersRunning = false;
  }
}

export function remainingEditSeconds(lesson: Lesson, editWindowMin: number): number {
  if (lesson.state !== 'done' || !lesson.confirmed_at) return 0;
  const used = minutesAgo(lesson.confirmed_at) * 60;
  return Math.max(0, Math.floor(editWindowMin * 60 - used));
}
