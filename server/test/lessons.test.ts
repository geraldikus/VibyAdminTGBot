import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { setSetting } from '../src/db/rows.js';
import {
  cancelLesson, confirmLessonWithPhoto, createLesson, editLesson, getLesson, listLessonsPage, processPhotoReminders,
} from '../src/services/lessons.js';
import { getStudent } from '../src/services/students.js';
import { todayYmd } from '../src/time.js';
import {
  admin, balanceLogCount, balanceMatchesLog, doneLesson, fakeTelegram, makeStudent, makeTeacher, setupPhotoChannel,
} from './helpers.js';

let tg: ReturnType<typeof fakeTelegram>;

beforeEach(async () => {
  tg = fakeTelegram();
  await setupPhotoChannel();
});

describe('createLesson', () => {
  it('is idempotent per client_id (retry after a lost response)', async () => {
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 5 });
    const input = { client_id: 'same-client-id-1', student_id: student.student_id, duration_min: 60, lesson_date: todayYmd(), comment: '' };

    const [a, b] = await Promise.all([createLesson(input, user), createLesson(input, user)]);
    await createLesson(input, user);

    expect(a.lesson_id).toBe(b.lesson_id);
    expect((db.prepare('SELECT COUNT(*) AS n FROM lessons WHERE lesson_id = ?').get(input.client_id) as { n: number }).n).toBe(1);
    expect(tg.calls.filter((c) => c.method === 'sendMessage' && c.text?.startsWith('Send a photo')).length).toBe(1);
  });

  it('does not charge the balance before the photo', async () => {
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 5 });
    await createLesson({ client_id: 'no-charge-yet', student_id: student.student_id, duration_min: 45, lesson_date: todayYmd(), comment: '' }, user);
    expect((await getStudent(student.student_id)).balance).toBe(5);
  });

  it('rejects other teachers’ students and future dates', async () => {
    const { teacher } = await makeTeacher();
    const other = await makeTeacher('Other');
    const student = await makeStudent(teacher.teacher_id);
    const base = { student_id: student.student_id, duration_min: 60, comment: '' };
    await expect(createLesson({ ...base, client_id: 'foreign-1', lesson_date: todayYmd() }, other.user))
      .rejects.toMatchObject({ statusCode: 403 });
    await expect(createLesson({ ...base, client_id: 'future-01', lesson_date: '2999-01-01' }, other.user))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('confirmLessonWithPhoto', () => {
  it('charges once and deletes the duplicate channel post when confirmed twice at the same time', async () => {
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 1 });
    const lesson = await createLesson({ client_id: 'double-photo', student_id: student.student_id, duration_min: 60, lesson_date: todayYmd(), comment: '' }, user);

    await Promise.all([
      confirmLessonWithPhoto({ lesson, fileId: 'a' }),
      confirmLessonWithPhoto({ lesson, fileId: 'b' }),
    ]);

    const after = await getStudent(student.student_id);
    expect(after.balance).toBe(0);
    expect(after.status).toBe('red');
    expect(balanceLogCount(student.student_id, 'lesson')).toBe(1);
    expect(tg.count('sendPhoto')).toBe(2);
    expect(tg.count('deleteMessage')).toBe(1);
    expect((await getLesson(lesson.lesson_id)).state).toBe('done');
  });

  it('does not touch the balance of business clients', async () => {
    const { teacher, user } = await makeTeacher();
    const biz = await makeStudent(teacher.teacher_id, { type: 'business', status: 'blue' });
    const lesson = await doneLesson(user, biz.student_id);
    expect(lesson.state).toBe('done');
    expect(lesson.balance_after).toBe('');
    expect((await getStudent(biz.student_id)).balance).toBe(0);
  });
});

describe('cancelLesson', () => {
  it('refunds a done lesson exactly once, even when cancelled repeatedly', async () => {
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 1 });
    const lesson = await doneLesson(user, student.student_id);

    await Promise.all([cancelLesson(lesson.lesson_id, admin), cancelLesson(lesson.lesson_id, admin)]);
    await cancelLesson(lesson.lesson_id, admin);

    const after = await getStudent(student.student_id);
    expect(after.balance).toBe(1);
    expect(after.status).toBe('green');
    expect(balanceLogCount(student.student_id, 'lesson_cancel')).toBe(1);
    expect((await getLesson(lesson.lesson_id)).state).toBe('cancelled');
    expect(balanceMatchesLog(student.student_id)).toBe(true);
  });

  it('cancels a pending lesson without any balance change', async () => {
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 3 });
    const lesson = await createLesson({ client_id: 'pending-cancel', student_id: student.student_id, duration_min: 60, lesson_date: todayYmd(), comment: '' }, user);
    await cancelLesson(lesson.lesson_id, user);
    expect((await getStudent(student.student_id)).balance).toBe(3);
    expect(balanceLogCount(student.student_id, 'lesson_cancel')).toBe(0);
  });

  it('lets a teacher cancel only within the edit window', async () => {
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { balance: 3 });
    const lesson = await doneLesson(user, student.student_id);
    db.prepare("UPDATE lessons SET confirmed_at = '2020-01-01 10:00:00' WHERE lesson_id = ?").run(lesson.lesson_id);
    await expect(cancelLesson(lesson.lesson_id, user)).rejects.toMatchObject({ statusCode: 403 });
    expect((await getStudent(student.student_id)).balance).toBe(2);
  });
});

describe('editLesson: moving a done lesson to another student', () => {
  it('moves the charge once, even when the request is repeated', async () => {
    const { teacher, user } = await makeTeacher();
    const ann = await makeStudent(teacher.teacher_id, { name: 'Ann', balance: 5 });
    const bob = await makeStudent(teacher.teacher_id, { name: 'Bob', balance: 5 });
    const lesson = await doneLesson(user, ann.student_id);

    await editLesson(lesson.lesson_id, { student_id: bob.student_id }, admin);
    await editLesson(lesson.lesson_id, { student_id: bob.student_id }, admin);

    expect((await getStudent(ann.student_id)).balance).toBe(5);
    expect((await getStudent(bob.student_id)).balance).toBe(4);
    const moved = await getLesson(lesson.lesson_id);
    expect(moved.student_id).toBe(bob.student_id);
    expect(moved.balance_after).toBe('4');
    expect(balanceMatchesLog(ann.student_id)).toBe(true);
    expect(balanceMatchesLog(bob.student_id)).toBe(true);
  });

  it('is not allowed for teachers', async () => {
    const { teacher, user } = await makeTeacher();
    const ann = await makeStudent(teacher.teacher_id, { balance: 5 });
    const bob = await makeStudent(teacher.teacher_id, { balance: 5 });
    const lesson = await doneLesson(user, ann.student_id);
    await expect(editLesson(lesson.lesson_id, { student_id: bob.student_id }, user)).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('processPhotoReminders', () => {
  it('reminds the teacher and alerts admins once, even when runs overlap', async () => {
    setSetting('photo_reminder_min', 0);
    setSetting('photo_admin_alert_min', 0);
    const { teacher, user } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id, { name: 'Reminder Student' });
    await createLesson({ client_id: 'needs-reminder', student_id: student.student_id, duration_min: 60, lesson_date: todayYmd(), comment: '' }, user);
    tg.clear();

    await Promise.all([processPhotoReminders(), processPhotoReminders(), processPhotoReminders()]);
    await processPhotoReminders();

    const toTeacher = tg.calls.filter((c) => c.chatId === teacher.telegram_id && c.text?.startsWith('Send a photo'));
    // Other pending lessons from earlier tests in this file get their own alerts; count only ours.
    const toAdmin = tg.calls.filter((c) => c.chatId === '1' && c.text?.startsWith('No photo') && c.text.includes('Reminder Student'));
    expect(toTeacher.length).toBe(1);
    expect(toAdmin.length).toBe(1);
  });
});

describe('listLessonsPage', () => {
  it('pages through a month without gaps or duplicates', async () => {
    const { teacher } = await makeTeacher();
    const student = await makeStudent(teacher.teacher_id);
    const insert = db.prepare(`INSERT INTO lessons (lesson_id, created_at, lesson_date, student_id, student_name, teacher_id,
      teacher_name, duration_min, student_type, status_at_lesson, state)
      VALUES (?, ?, '2025-01-15', ?, 'S', ?, 'T', 60, 'subscription', 'green', 'done')`);
    for (let i = 0; i < 60; i++) {
      // Same created_at for groups of 3 to exercise the tie-breaker on lesson_id.
      insert.run(`page-${String(i).padStart(3, '0')}`, `2025-01-15 10:00:${String(Math.floor(i / 3)).padStart(2, '0')}`, student.student_id, teacher.teacher_id);
    }
    const first = listLessonsPage({ month: '2025-01' });
    const second = listLessonsPage({ month: '2025-01', before: first.next_cursor! });

    expect(first.lessons).toHaveLength(50);
    expect(second.lessons).toHaveLength(10);
    expect(second.next_cursor).toBeNull();
    expect(new Set([...first.lessons, ...second.lessons].map((l) => l.lesson_id)).size).toBe(60);
    expect(listLessonsPage({ month: '2025-02' }).lessons).toHaveLength(0);
  });
});
