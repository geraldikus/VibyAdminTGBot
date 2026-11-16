import type { AuthUser, Student, StudentType, Status } from '@school/shared';
import { setBotApi, setPhotoChannelId } from '../src/services/notify.js';
import { approveTeacher, upsertPendingTeacher } from '../src/services/teachers.js';
import { createStudent } from '../src/services/students.js';
import { createLesson, confirmLessonWithPhoto, getLesson } from '../src/services/lessons.js';
import { db } from '../src/db/index.js';
import { todayYmd } from '../src/time.js';

export interface Call {
  method: string;
  chatId: string;
  text?: string;
  messageId?: number;
}

/** Fake Telegram Bot API that records calls instead of hitting the network. */
export function fakeTelegram() {
  const calls: Call[] = [];
  let nextMessageId = 100;
  const api = {
    sendPhoto: async (chatId: string) => {
      await new Promise((r) => setTimeout(r, 5)); // let concurrent requests interleave
      const message_id = ++nextMessageId;
      calls.push({ method: 'sendPhoto', chatId: String(chatId), messageId: message_id });
      return { message_id, photo: [{ file_id: `file-${message_id}` }] };
    },
    deleteMessage: async (chatId: string, messageId: number) => {
      calls.push({ method: 'deleteMessage', chatId: String(chatId), messageId });
      return true;
    },
    sendMessage: async (chatId: string, text: string) => {
      calls.push({ method: 'sendMessage', chatId: String(chatId), text });
      return { message_id: ++nextMessageId };
    },
    editMessageCaption: async (chatId: string) => {
      calls.push({ method: 'editMessageCaption', chatId: String(chatId) });
      return true;
    },
    sendDocument: async (chatId: string) => {
      calls.push({ method: 'sendDocument', chatId: String(chatId) });
      return { message_id: ++nextMessageId };
    },
  };
  setBotApi(api as never);
  return {
    calls,
    count: (method: string) => calls.filter((c) => c.method === method).length,
    clear: () => { calls.length = 0; },
  };
}

export async function setupPhotoChannel() {
  await setPhotoChannelId('-1001234567890');
}

let seq = 0;

export async function makeTeacher(name = 'Teacher') {
  seq++;
  const { teacher } = await upsertPendingTeacher({ telegramId: String(5000 + seq), name, username: '' });
  const approved = await approveTeacher(teacher.teacher_id, 'Admin');
  const user: AuthUser = {
    telegramId: approved.telegram_id,
    name,
    username: '',
    role: 'teacher',
    teacherId: approved.teacher_id,
  };
  return { teacher: approved, user };
}

export const admin: AuthUser = { telegramId: '1', name: 'Admin', username: 'admin', role: 'admin' };

export async function makeStudent(teacherId: string, opts: {
  name?: string;
  balance?: number;
  type?: StudentType;
  status?: Status;
} = {}): Promise<Student> {
  seq++;
  return createStudent({
    name: opts.name ?? `Student ${seq}`,
    contact: '',
    teacher_id: teacherId,
    type: opts.type ?? 'subscription',
    status: opts.status ?? 'green',
    balance: opts.balance ?? 0,
    notes: '',
  }, 'Admin');
}

/** Creates a lesson and confirms it with a photo (state: done). */
export async function doneLesson(user: AuthUser, studentId: string, lessonDate = todayYmd()) {
  seq++;
  const lesson = await createLesson({
    client_id: `client-${seq}-${Date.now()}`,
    student_id: studentId,
    duration_min: 60,
    lesson_date: lessonDate,
    comment: '',
  }, user);
  await confirmLessonWithPhoto({ lesson, fileId: 'photo' });
  return getLesson(lesson.lesson_id);
}

/** Invariant: a subscription student's balance equals the sum of their balance log. */
export function balanceMatchesLog(studentId: string): boolean {
  const row = db.prepare(`
    SELECT s.balance AS balance, COALESCE(SUM(b.change), 0) AS logged
    FROM students s LEFT JOIN balance_log b ON b.student_id = s.student_id
    WHERE s.student_id = ? GROUP BY s.student_id
  `).get(studentId) as { balance: number; logged: number };
  return Math.abs(row.balance - row.logged) < 1e-9;
}

export function balanceLogCount(studentId: string, reason: string): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM balance_log WHERE student_id = ? AND reason = ?')
    .get(studentId, reason) as { n: number }).n;
}
