import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/index.js';
import { generateBusinessReport, listBusinessReports } from '../src/services/reports.js';
import { doneLesson, fakeTelegram, makeStudent, makeTeacher, setupPhotoChannel } from './helpers.js';

beforeEach(async () => {
  fakeTelegram();
  await setupPhotoChannel();
});

describe('business report', () => {
  it('replaces the month on re-run instead of appending a duplicate', async () => {
    const { teacher, user } = await makeTeacher();
    const corp = await makeStudent(teacher.teacher_id, { name: 'Corp', type: 'business', status: 'blue' });
    const lesson = await doneLesson(user, corp.student_id);
    const month = lesson.lesson_date.slice(0, 7);

    await generateBusinessReport(month, 'manual');
    await generateBusinessReport(month, 'manual');

    const rows = await listBusinessReports(month);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ student_name: 'Corp', lessons_count: 1, total_minutes: 60 });
  });

  it('counts a lesson by its date, even if the photo arrived in the next month', async () => {
    const { teacher, user } = await makeTeacher();
    const corp = await makeStudent(teacher.teacher_id, { name: 'Late Corp', type: 'business', status: 'blue' });
    const lesson = await doneLesson(user, corp.student_id);
    db.prepare("UPDATE lessons SET lesson_date = '2025-03-31', confirmed_at = '2025-04-02 12:00:00' WHERE lesson_id = ?")
      .run(lesson.lesson_id);

    await generateBusinessReport('2025-03', 'auto');
    expect((await listBusinessReports('2025-03')).find((r) => r.student_id === corp.student_id)?.lessons_count).toBe(1);

    await generateBusinessReport('2025-04', 'auto');
    expect((await listBusinessReports('2025-04')).find((r) => r.student_id === corp.student_id)?.lessons_count).toBe(0);
  });
});
