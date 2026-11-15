import { randomBytes } from 'node:crypto';
import type { Context } from 'grammy';
import { InlineKeyboard } from 'grammy';
import {
  confirmLessonWithPhoto,
  pendingPhotosForTeacher,
  replaceLessonPhoto,
} from '../services/lessons.js';
import { findTeacherByTelegramId } from '../services/teachers.js';
import { isAdmin } from '../config.js';
import { prettyDate } from '../time.js';
import { putState, takeState } from '../services/botState.js';

/** Photo waiting for "which lesson?" choice. Stored in DB, expires in 10 minutes. */
function rememberFile(fileId: string): string {
  const token = randomBytes(6).toString('base64url');
  putState(`photo:${token}`, fileId);
  return token;
}

/** "Replace photo" mode: only the next photo within 10 minutes goes to the lesson. */
export function setAwaitingPhotoReplace(telegramId: string, lessonId: string) {
  putState(`replace:${telegramId}`, lessonId);
}

export async function handleIncomingPhoto(ctx: Context) {
  const from = ctx.from;
  if (!from) return;
  const fileId = ctx.message?.photo?.at(-1)?.file_id ?? ctx.message?.document?.file_id;
  const isImageDoc = ctx.message?.document?.mime_type?.startsWith('image/');
  if (!fileId || (ctx.message?.document && !isImageDoc && !ctx.message.photo)) {
    return;
  }
  if (ctx.message?.document && !isImageDoc) return;

  const replaceId = takeState(`replace:${from.id}`);
  if (replaceId) {
    const teacher = await findTeacherByTelegramId(String(from.id));
    const user = isAdmin(from.id)
      ? {
          telegramId: String(from.id),
          name: [from.first_name, from.last_name].filter(Boolean).join(' '),
          username: from.username ?? '',
          role: 'admin' as const,
        }
      : teacher
        ? {
            telegramId: String(from.id),
            name: teacher.name,
            username: teacher.username,
            role: 'teacher' as const,
            teacherId: teacher.teacher_id,
          }
        : null;
    if (!user) {
      await ctx.reply('Access denied.');
      return;
    }
    try {
      const lesson = await replaceLessonPhoto(replaceId, fileId, user);
      await ctx.reply(`Photo updated for ${lesson.student_name}.`);
    } catch (error) {
      await ctx.reply(`Could not replace the photo: ${error instanceof Error ? error.message : 'error'}`);
    }
    return;
  }

  const teacher = await findTeacherByTelegramId(String(from.id));
  if (!teacher?.active && !isAdmin(from.id)) {
    await ctx.reply('You are not an approved teacher yet.');
    return;
  }

  const teacherId = teacher?.teacher_id;
  const pending = teacherId ? await pendingPhotosForTeacher(teacherId) : [];
  if (!pending.length) {
    await ctx.reply('There is no lesson waiting for a photo. Open the Mini App to mark a lesson first.');
    return;
  }

  if (pending.length === 1) {
    try {
      const lesson = await confirmLessonWithPhoto({ lesson: pending[0], fileId });
      await ctx.reply(`Lesson saved: ${lesson.student_name}, ${lesson.duration_min} min, ${prettyDate(lesson.lesson_date)}.`);
    } catch (error) {
      console.error('Photo confirm failed', error);
      await ctx.reply('Could not save the lesson, please send the photo again.');
    }
    return;
  }

  const keyboard = new InlineKeyboard();
  const token = rememberFile(fileId);
  for (const lesson of pending.slice(0, 10)) {
    keyboard
      .text(
        `${lesson.student_name} · ${lesson.duration_min}m · ${prettyDate(lesson.lesson_date)}`,
        `photo:${lesson.lesson_id}:${token}`,
      )
      .row();
  }
  await ctx.reply('Which lesson is this photo for?', { reply_markup: keyboard });
}

export async function handlePhotoChoice(ctx: Context, lessonId: string, token: string) {
  const fileId = takeState(`photo:${token}`);
  if (!fileId) {
    await ctx.answerCallbackQuery({ text: 'Photo expired, send it again' });
    return;
  }
  const pending = await pendingPhotosForTeacher(
    (await findTeacherByTelegramId(String(ctx.from?.id)))?.teacher_id ?? '',
  );
  const lesson = pending.find((l) => l.lesson_id === lessonId);
  if (!lesson) {
    await ctx.answerCallbackQuery({ text: 'Lesson is no longer waiting for a photo' });
    return;
  }
  let confirmed;
  try {
    confirmed = await confirmLessonWithPhoto({ lesson, fileId });
  } catch (error) {
    console.error('Photo confirm failed', error);
    await ctx.answerCallbackQuery({ text: 'Could not save, send the photo again', show_alert: true });
    return;
  }
  await ctx.answerCallbackQuery({ text: 'Saved' });
  await ctx.editMessageText(`Lesson saved: ${confirmed.student_name}, ${confirmed.duration_min} min.`);
}
