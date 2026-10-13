import type { BusinessReportRow } from '@school/shared';
import { monthBounds, nowIso, previousMonth } from '../time.js';
import { repo } from '../sheets/repo.js';
import { mapLesson, mapReport, mapStudent, mapTeacher } from '../sheets/mappers.js';
import { getSettings, writeSetting } from './settings.js';
import { notifyAdmins } from './notify.js';

export async function generateBusinessReport(
  month: string | undefined,
  trigger: 'auto' | 'manual',
): Promise<BusinessReportRow[]> {
  const settings = await getSettings();
  const target = month ?? previousMonth(undefined, settings.timezone);
  const { start, end } = monthBounds(target);

  const students = (await repo.getAll('Students')).map(mapStudent)
    .filter((s) => s.type === 'business' && s.active);
  const lessons = (await repo.getAll('Lessons_Log')).map(mapLesson)
    .filter((l) => l.state === 'done')
    .filter((l) => l.lesson_date >= start && l.lesson_date <= end);

  const rows: BusinessReportRow[] = students.map((student) => {
    const studentLessons = lessons.filter((l) => l.student_id === student.student_id);
    return {
      month: target,
      student_id: student.student_id,
      student_name: student.name,
      teacher_name: student.teacher_name,
      lessons_count: studentLessons.length,
      total_minutes: studentLessons.reduce((sum, l) => sum + l.duration_min, 0),
      generated_at: nowIso(settings.timezone),
      trigger,
    };
  }).sort((a, b) => b.lessons_count - a.lessons_count || a.student_name.localeCompare(b.student_name));

  await repo.write(async () => {
    const existing = (await repo.getAll('Business_Reports', true))
      .filter((r) => r.month === target);
    if (existing.length && trigger === 'auto') {
      return;
    }
    if (rows.length) {
      await repo.appendRows('Business_Reports', rows);
    }
    if (trigger === 'auto' || !settings.last_business_report || settings.last_business_report < target) {
      await repo.updateSettingsKey('last_business_report', target);
    }
  });

  const lines = [
    `Business report for ${target}`,
    '',
    ...rows.map((r) => `${r.student_name} — ${r.lessons_count} lessons / ${r.total_minutes} min (${r.teacher_name})`),
    '',
    rows.length ? `Total students: ${rows.length}` : 'No active business students.',
  ];
  await notifyAdmins(lines.join('\n'));
  return rows;
}

export async function listBusinessReports(month?: string): Promise<BusinessReportRow[]> {
  return (await repo.getAll('Business_Reports'))
    .map(mapReport)
    .filter((r) => (month ? r.month === month : true))
    .sort((a, b) => b.month.localeCompare(a.month) || a.student_name.localeCompare(b.student_name));
}

export async function catchUpBusinessReport() {
  const settings = await getSettings();
  const lastMonth = previousMonth(undefined, settings.timezone);
  if (!settings.last_business_report || settings.last_business_report < lastMonth) {
    await generateBusinessReport(lastMonth, 'auto');
  }
}

export async function getDashboard() {
  const students = (await repo.getAll('Students')).map(mapStudent).filter((s) => s.active);
  const lessons = (await repo.getAll('Lessons_Log')).map(mapLesson);
  return {
    red: students.filter((s) => s.status === 'red').length,
    yellow: students.filter((s) => s.status === 'yellow').length,
    zeroOrNegative: students.filter((s) => s.type === 'subscription' && s.balance <= 0).length,
    pendingPhotos: lessons.filter((l) => l.state === 'pending_photo').length,
    students: students.length,
    teachers: (await repo.getAll('Teachers')).map(mapTeacher).filter((t) => t.active).length,
  };
}
