import type { Api } from 'grammy';
import { InlineKeyboard } from 'grammy';
import type { Lesson, Status, Student } from '@school/shared';
import { STATUS_EMOJI } from '@school/shared';
import { config, isAdmin } from '../config.js';
import { prettyDate } from '../time.js';
import { writeSetting } from './settings.js';
import { repo } from '../sheets/repo.js';

let api: Api | null = null;
let photoChannelId = config.photoChannelId;

export async function loadPhotoChannelId() {
  if (photoChannelId) return photoChannelId;
  const rows = await repo.getAll('Settings');
  const fromSheet = rows.find((r) => r.key === 'photo_channel_id')?.value;
  if (fromSheet) photoChannelId = fromSheet;
  return photoChannelId;
}

export function setBotApi(next: Api) {
  api = next;
}

export function setPhotoChannelId(id: string) {
  photoChannelId = id;
  void writeSetting('photo_channel_id', id).catch((error) => {
    console.error('Failed to persist PHOTO_CHANNEL_ID', error);
  });
}

export function getPhotoChannelId(): string {
  return photoChannelId;
}

export function getApi(): Api {
  if (!api) throw new Error('Bot API is not initialized');
  return api;
}

function webAppKeyboard() {
  return new InlineKeyboard().webApp('Open Mini App', config.webappUrl);
}

export async function notifyAdmins(text: string, extra?: { studentId?: string }) {
  if (!api) return;
  const keyboard = extra?.studentId
    ? new InlineKeyboard().webApp('Open Mini App', `${config.webappUrl}/admin/students/${extra.studentId}`)
    : webAppKeyboard();
  for (const adminId of config.adminIds) {
    try {
      await api.sendMessage(adminId, text, { reply_markup: keyboard });
    } catch (error) {
      console.error('Failed to notify admin', adminId, error);
    }
  }
}

export async function notifyTeacher(telegramId: string, text: string, keyboard?: InlineKeyboard) {
  if (!api) return;
  try {
    await api.sendMessage(telegramId, text, { reply_markup: keyboard ?? webAppKeyboard() });
  } catch (error) {
    console.error('Failed to notify teacher', telegramId, error);
  }
}

export function lessonCaption(
  lesson: Lesson,
  extra = '',
  opts?: { status?: Status; balanceAfter?: number | string },
): string {
  const status = opts?.status ?? lesson.status_at_lesson;
  return [
    extra,
    `Student: ${lesson.student_name}`,
    `Teacher: ${lesson.teacher_name}`,
    `Duration: ${lesson.duration_min} min`,
    `Date: ${prettyDate(lesson.lesson_date)}`,
    `Status: ${STATUS_EMOJI[status]} ${status}`,
    `Type: ${lesson.student_type}`,
    opts?.balanceAfter !== undefined && opts.balanceAfter !== '' ? `Balance after: ${opts.balanceAfter}` : '',
    lesson.comment ? `Comment: ${lesson.comment}` : '',
    `Lesson ID: ${lesson.lesson_id}`,
  ].filter(Boolean).join('\n');
}

export async function requestLessonPhoto(telegramId: string, lesson: Lesson) {
  await notifyTeacher(
    telegramId,
    `Send a photo for:\n${lesson.student_name}, ${lesson.duration_min} min, ${prettyDate(lesson.lesson_date)}\n\nThis is the last step. The lesson will be counted only after the photo is received.`,
  );
}

export async function sendLessonAlerts(lesson: Lesson, student: Student, balanceAfter?: number) {
  if (student.status === 'red') {
    await notifyAdmins(
      `RED student lesson marked\n${lessonCaption(lesson)}\nBalance after: ${balanceAfter ?? student.balance}`,
      { studentId: student.student_id },
    );
  }
  if (student.status === 'yellow') {
    await notifyAdmins(
      `YELLOW student lesson marked\n${lessonCaption(lesson)}\nBalance after: ${balanceAfter ?? student.balance}`,
      { studentId: student.student_id },
    );
  }
  if (student.type === 'subscription' && balanceAfter !== undefined && balanceAfter <= 0) {
    await notifyAdmins(
      `Balance reached ${balanceAfter} for ${student.name}\nTeacher: ${lesson.teacher_name}\nDate: ${prettyDate(lesson.lesson_date)}`,
      { studentId: student.student_id },
    );
  }
}

export function channelLink(messageId: string | number): string {
  const raw = String(photoChannelId);
  const numeric = raw.replace(/^-100/, '');
  return `https://t.me/c/${numeric}/${messageId}`;
}

export { isAdmin };
