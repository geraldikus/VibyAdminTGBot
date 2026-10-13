import { randomUUID } from 'node:crypto';
import { InputFile } from 'grammy';
import type { AuthUser, CreateLessonInput, EditLessonInput, Lesson, Student } from '@school/shared';
import { daysBetweenYmd, minutesAgo, nowIso, prettyDate, todayYmd } from '../time.js';
import { repo } from '../sheets/repo.js';
import { mapLesson, mapStudent } from '../sheets/mappers.js';
import { getSettings } from './settings.js';
import { getStudent } from './students.js';
import { applyBalanceChange, statusAfterBalance } from './balance.js';
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

function httpError(message: string, statusCode: number) {
  return Object.assign(new Error(message), { statusCode });
}

export async function listLessons(filter?: {
  teacherId?: string;
  studentId?: string;
  state?: string;
}): Promise<Lesson[]> {
  return (await repo.getAll('Lessons_Log'))
    .map(mapLesson)
    .filter((l) => (filter?.teacherId ? l.teacher_id === filter.teacherId : true))
    .filter((l) => (filter?.studentId ? l.student_id === filter.studentId : true))
    .filter((l) => (filter?.state ? l.state === filter.state : true))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function getLesson(lessonId: string): Promise<Lesson> {
  const row = await repo.findById('Lessons_Log', lessonId);
  if (!row) throw httpError('Lesson not found', 404);
  return mapLesson(row);
}

export async function createLesson(input: CreateLessonInput, user: AuthUser): Promise<Lesson> {
  const settings = await getSettings();
  const today = todayYmd(settings.timezone);
  if (input.lesson_date > today) throw httpError('Lesson date cannot be in the future', 400);
  if (daysBetweenYmd(input.lesson_date, today) > settings.backdate_days) {
    throw httpError(`Lesson date cannot be older than ${settings.backdate_days} days`, 400);
  }

  const existing = await repo.findById('Lessons_Log', input.client_id);
  if (existing) return mapLesson(existing);

  const student = await getStudent(input.student_id);
  if (!student.active) throw httpError('Student is archived', 400);
  if (user.role === 'teacher' && student.teacher_id !== user.teacherId) {
    throw httpError('You can only mark lessons for your students', 403);
  }

  const teacherId = user.role === 'teacher' ? user.teacherId! : student.teacher_id;
  const teacherName = user.role === 'teacher' ? user.name : student.teacher_name;

  const lesson: Lesson = {
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
    state: 'pending_photo',
    photo_link: '',
    photo_file_id: '',
    photo_message_id: '',
    balance_after: '',
    comment: input.comment ?? '',
    confirmed_at: '',
    reminder_sent: '',
    admin_alerted: '',
    cancelled_at: '',
    cancelled_by: '',
  };

  await repo.write(async () => {
    const again = await repo.findById('Lessons_Log', input.client_id);
    if (again) return;
    await repo.appendRows('Lessons_Log', [lesson]);
  });

  const teacherTelegramId = user.role === 'teacher'
    ? user.telegramId
    : (await repo.findById('Teachers', teacherId))?.telegram_id;
  if (teacherTelegramId) {
    await requestLessonPhoto(teacherTelegramId, lesson);
  }
  return lesson;
}

export async function pendingPhotosForTeacher(teacherId: string): Promise<Lesson[]> {
  return (await listLessons({ teacherId, state: 'pending_photo' }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
}

export async function confirmLessonWithPhoto(input: {
  lesson: Lesson;
  fileId: string;
  fileUrl?: string;
  buffer?: Buffer;
}): Promise<Lesson> {
  const channelId = getPhotoChannelId();
  if (!channelId) throw httpError('Photo channel is not configured yet', 500);

  const current = await getLesson(input.lesson.lesson_id);
  if (current.state !== 'pending_photo') return current;
  const studentBefore = await getStudent(current.student_id);
  const predictedBalance = studentBefore.type === 'subscription' ? studentBefore.balance - 1 : studentBefore.balance;
  const predictedStatus = statusAfterBalance(studentBefore, predictedBalance);

  const api = getApi();
  const caption = lessonCaption(current, '', {
    status: predictedStatus,
    balanceAfter: studentBefore.type === 'subscription' ? predictedBalance : undefined,
  });
  const sent = input.buffer
    ? await api.sendPhoto(channelId, new InputFile(input.buffer, 'lesson.jpg'), { caption })
    : await api.sendPhoto(channelId, input.fileId, { caption });

  const photoFileId = sent.photo?.at(-1)?.file_id ?? input.fileId;
  const messageId = String(sent.message_id);
  const link = channelLink(messageId);
  const settings = await getSettings();
  const confirmedAt = nowIso(settings.timezone);

  const confirmed = await repo.write(async () => {
    const latest = mapLesson((await repo.findById('Lessons_Log', input.lesson.lesson_id))!);
    if (latest.state !== 'pending_photo') return latest;
    const student = mapStudent((await repo.findById('Students', latest.student_id))!);
    let balanceAfter = student.balance;
    const ops: Parameters<typeof repo.batchAtomic>[0] = [];
    let nextStatus = student.status;
    if (student.type === 'subscription') {
      balanceAfter = student.balance - 1;
      nextStatus = statusAfterBalance(student, balanceAfter);
      const now = confirmedAt;
      const patch: Record<string, unknown> = { balance: balanceAfter, updated_at: now };
      if (nextStatus !== student.status) patch.status = nextStatus;
      ops.push({
        kind: 'update',
        sheet: 'Students',
        id: student.student_id,
        patch,
      });
      ops.push({
        kind: 'append',
        sheet: 'Balance_Log',
        records: [{
          entry_id: randomUUID(),
          created_at: now,
          student_id: student.student_id,
          student_name: student.name,
          change: -1,
          balance_after: balanceAfter,
          reason: 'lesson',
          lesson_id: latest.lesson_id,
          by: latest.teacher_name,
        }],
      });
    }
    ops.push({
      kind: 'update',
      sheet: 'Lessons_Log',
      id: latest.lesson_id,
      patch: {
        state: 'done',
        photo_link: link,
        photo_file_id: photoFileId,
        photo_message_id: messageId,
        balance_after: student.type === 'subscription' ? balanceAfter : '',
        confirmed_at: confirmedAt,
      },
    });
    await repo.batchAtomic(ops);
    if (nextStatus !== student.status) {
      await writeAudit({
        entity: 'student',
        entity_id: student.student_id,
        field: 'status',
        old_value: student.status,
        new_value: nextStatus,
        by: latest.teacher_name,
      });
    }
    return {
      ...latest,
      state: 'done' as const,
      photo_link: link,
      photo_file_id: photoFileId,
      photo_message_id: messageId,
      balance_after: student.type === 'subscription' ? String(balanceAfter) : '',
      confirmed_at: confirmedAt,
    };
  });

  const student = await getStudent(confirmed.student_id);
  await sendLessonAlerts(
    confirmed,
    student,
    student.type === 'subscription' ? Number(confirmed.balance_after) : undefined,
  );
  return confirmed;
}

function canEdit(lesson: Lesson, user: AuthUser, editWindowMin: number) {
  if (lesson.state !== 'done') return false;
  if (user.role === 'admin') return true;
  if (user.role === 'teacher' && lesson.teacher_id !== user.teacherId) return false;
  return minutesAgo(lesson.confirmed_at) <= editWindowMin;
}

export async function cancelLesson(lessonId: string, user: AuthUser): Promise<Lesson> {
  const settings = await getSettings();
  const lesson = await getLesson(lessonId);
  if (lesson.state === 'cancelled') return lesson;
  if (lesson.state === 'pending_photo') {
    if (user.role === 'teacher' && lesson.teacher_id !== user.teacherId) {
      throw httpError('Forbidden', 403);
    }
    const cancelled = await repo.write(async () => {
      const row = await repo.updateById('Lessons_Log', lessonId, {
        state: 'cancelled',
        cancelled_at: nowIso(settings.timezone),
        cancelled_by: user.name,
      });
      return mapLesson(row);
    });
    if (user.role === 'teacher') {
      await notifyAdmins(`Teacher cancelled a pending lesson\n${lessonCaption(cancelled)}`);
    }
    return cancelled;
  }
  if (!canEdit(lesson, user, settings.edit_window_min)) {
    throw httpError('Edit window has expired', 403);
  }

  const cancelled = await repo.write(async () => {
    const current = mapLesson((await repo.findById('Lessons_Log', lessonId))!);
    const student = mapStudent((await repo.findById('Students', current.student_id))!);
    const ops: Parameters<typeof repo.batchAtomic>[0] = [{
      kind: 'update',
      sheet: 'Lessons_Log',
      id: lessonId,
      patch: {
        state: 'cancelled',
        cancelled_at: nowIso(settings.timezone),
        cancelled_by: user.name,
      },
    }];
    if (student.type === 'subscription' && current.state === 'done') {
      const { student: next } = await applyBalanceChange({
        student,
        change: 1,
        reason: 'lesson_cancel',
        lessonId,
        by: user.name,
      });
      void next;
      // applyBalanceChange already wrote; do not duplicate
    }
    if (student.type !== 'subscription' || current.state !== 'done') {
      await repo.batchAtomic(ops);
    } else {
      await repo.updateById('Lessons_Log', lessonId, {
        state: 'cancelled',
        cancelled_at: nowIso(settings.timezone),
        cancelled_by: user.name,
      });
    }
    await writeAudit({
      entity: 'lesson',
      entity_id: lessonId,
      field: 'state',
      old_value: current.state,
      new_value: 'cancelled',
      by: user.name,
    });
    return mapLesson((await repo.findById('Lessons_Log', lessonId))!);
  });

  await markChannelCancelled(cancelled);
  if (user.role === 'teacher') {
    await notifyAdmins(`Teacher cancelled a lesson\n${lessonCaption(cancelled)}`);
  }
  return cancelled;
}

export async function editLesson(
  lessonId: string,
  patch: EditLessonInput,
  user: AuthUser,
): Promise<Lesson> {
  const settings = await getSettings();
  const lesson = await getLesson(lessonId);
  if (lesson.state === 'cancelled') throw httpError('Cancelled lessons cannot be edited', 400);
  if (lesson.state === 'pending_photo') {
    if (user.role === 'teacher' && lesson.teacher_id !== user.teacherId) throw httpError('Forbidden', 403);
    if (user.role === 'teacher' && patch.student_id) throw httpError('Teachers cannot change the student', 403);
    return applyPendingEdits(lesson, patch, user);
  }
  if (!canEdit(lesson, user, settings.edit_window_min)) {
    throw httpError('Edit window has expired', 403);
  }
  if (user.role === 'teacher' && patch.student_id) {
    throw httpError('Teachers cannot change the student', 403);
  }
  if (patch.lesson_date) {
    const today = todayYmd(settings.timezone);
    if (user.role === 'teacher') {
      if (patch.lesson_date > today) throw httpError('Lesson date cannot be in the future', 400);
      if (daysBetweenYmd(patch.lesson_date, today) > settings.backdate_days) {
        throw httpError(`Lesson date cannot be older than ${settings.backdate_days} days`, 400);
      }
    }
  }

  const updated = await repo.write(async () => {
    const current = mapLesson((await repo.findById('Lessons_Log', lessonId))!);
    const nextPatch: Record<string, unknown> = {};
    if (patch.duration_min !== undefined) nextPatch.duration_min = patch.duration_min;
    if (patch.lesson_date !== undefined) nextPatch.lesson_date = patch.lesson_date;
    if (patch.comment !== undefined) nextPatch.comment = patch.comment;

    if (patch.student_id && patch.student_id !== current.student_id && current.state === 'done') {
      const from = mapStudent((await repo.findById('Students', current.student_id))!);
      const to = mapStudent((await repo.findById('Students', patch.student_id))!);
      nextPatch.student_id = to.student_id;
      nextPatch.student_name = to.name;
      nextPatch.student_type = to.type;
      nextPatch.status_at_lesson = to.status;
      if (from.type === 'subscription') {
        await applyBalanceChange({
          student: from,
          change: 1,
          reason: 'lesson_moved',
          lessonId,
          by: user.name,
        });
      }
      const refreshedTo = mapStudent((await repo.findById('Students', to.student_id))!);
      if (refreshedTo.type === 'subscription') {
        const { balanceAfter } = await applyBalanceChange({
          student: refreshedTo,
          change: -1,
          reason: 'lesson_moved',
          lessonId,
          by: user.name,
        });
        nextPatch.balance_after = balanceAfter;
      } else {
        nextPatch.balance_after = '';
      }
    }

    const row = await repo.updateById('Lessons_Log', lessonId, nextPatch);
    for (const [field, value] of Object.entries(nextPatch)) {
      await writeAudit({
        entity: 'lesson',
        entity_id: lessonId,
        field,
        old_value: String((current as unknown as Record<string, unknown>)[field] ?? ''),
        new_value: String(value),
        by: user.name,
      });
    }
    return mapLesson(row);
  });

  await refreshChannelCaption(updated);
  if (user.role === 'teacher') {
    await notifyAdmins(`Teacher edited a lesson\n${lessonCaption(updated)}`);
  }
  return updated;
}

async function applyPendingEdits(lesson: Lesson, patch: EditLessonInput, user: AuthUser): Promise<Lesson> {
  return repo.write(async () => {
    const nextPatch: Record<string, unknown> = {};
    if (patch.duration_min !== undefined) nextPatch.duration_min = patch.duration_min;
    if (patch.lesson_date !== undefined) nextPatch.lesson_date = patch.lesson_date;
    if (patch.comment !== undefined) nextPatch.comment = patch.comment;
    if (patch.student_id && patch.student_id !== lesson.student_id) {
      const student = await getStudent(patch.student_id);
      nextPatch.student_id = student.student_id;
      nextPatch.student_name = student.name;
      nextPatch.student_type = student.type;
      nextPatch.status_at_lesson = student.status;
    }
    const row = await repo.updateById('Lessons_Log', lesson.lesson_id, nextPatch);
    for (const [field, value] of Object.entries(nextPatch)) {
      await writeAudit({
        entity: 'lesson',
        entity_id: lesson.lesson_id,
        field,
        old_value: String((lesson as unknown as Record<string, unknown>)[field] ?? ''),
        new_value: String(value),
        by: user.name,
      });
    }
    return mapLesson(row);
  });
}

export async function replaceLessonPhoto(lessonId: string, fileId: string, user: AuthUser): Promise<Lesson> {
  const settings = await getSettings();
  const lesson = await getLesson(lessonId);
  if (lesson.state === 'pending_photo') {
    return confirmLessonWithPhoto({ lesson, fileId });
  }
  if (!canEdit(lesson, user, settings.edit_window_min)) {
    throw httpError('Edit window has expired', 403);
  }
  const channelId = getPhotoChannelId();
  if (!channelId) throw httpError('Photo channel is not configured yet', 500);
  const sent = await getApi().sendPhoto(channelId, fileId, {
    caption: lessonCaption(lesson, 'UPDATED PHOTO'),
  });
  const updated = await repo.write(async () => {
    const row = await repo.updateById('Lessons_Log', lessonId, {
      photo_file_id: sent.photo?.at(-1)?.file_id ?? fileId,
      photo_message_id: String(sent.message_id),
      photo_link: channelLink(sent.message_id),
    });
    await writeAudit({
      entity: 'lesson',
      entity_id: lessonId,
      field: 'photo',
      old_value: lesson.photo_link,
      new_value: channelLink(sent.message_id),
      by: user.name,
    });
    return mapLesson(row);
  });
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

export async function processPhotoReminders() {
  const settings = await getSettings();
  const pending = (await listLessons({ state: 'pending_photo' }));
  for (const lesson of pending) {
    const age = minutesAgo(lesson.created_at, settings.timezone);
    if (!lesson.reminder_sent && age >= settings.photo_reminder_min) {
      const teacher = await repo.findById('Teachers', lesson.teacher_id);
      if (teacher?.telegram_id) {
        await requestLessonPhoto(teacher.telegram_id, lesson);
      }
      await repo.write(async () => {
        await repo.updateById('Lessons_Log', lesson.lesson_id, { reminder_sent: nowIso(settings.timezone) });
      });
    }
    if (!lesson.admin_alerted && age >= settings.photo_admin_alert_min) {
      await notifyAdmins(
        `No photo for ${lesson.teacher_name} / ${lesson.student_name} (${prettyDate(lesson.lesson_date)}, ${lesson.duration_min} min)`,
      );
      await repo.write(async () => {
        await repo.updateById('Lessons_Log', lesson.lesson_id, { admin_alerted: nowIso(settings.timezone) });
      });
    }
  }
}

export function remainingEditSeconds(lesson: Lesson, editWindowMin: number): number {
  if (lesson.state !== 'done' || !lesson.confirmed_at) return 0;
  const used = minutesAgo(lesson.confirmed_at) * 60;
  return Math.max(0, Math.floor(editWindowMin * 60 - used));
}
