import type { FastifyInstance } from 'fastify';
import {
  businessReportSchema,
  createStudentSchema,
  editLessonSchema,
  topUpSchema,
  updateStudentSchema,
  updateTeacherSchema,
} from '@school/shared';
import { requireRole } from '../auth.js';
import { mirrorEnabled, mirrorToSheets } from '../../services/sheetsMirror.js';
import { sendExcelBackup } from '../../services/export.js';
import { getDashboard, generateBusinessReport, listBusinessReports } from '../../services/reports.js';
import { createStudent, getStudentHistory, listStudents, updateStudent } from '../../services/students.js';
import { approveTeacher, listTeachers, updateTeacher } from '../../services/teachers.js';
import { cancelLesson, editLesson, listLessonsPage, remainingEditSeconds } from '../../services/lessons.js';
import { topUpBalance } from '../../services/balance.js';
import { getSettings } from '../../services/settings.js';

export async function registerAdminRoutes(app: FastifyInstance) {
  const admin = { preHandler: requireRole('admin') };

  app.get('/api/admin/dashboard', admin, async () => ({ dashboard: await getDashboard() }));

  // Pushes the DB to the read-only Google Sheets mirror right now.
  app.post('/api/admin/refresh', admin, async () => {
    if (!mirrorEnabled()) return { ok: false, mirror: 'disabled' };
    const result = await mirrorToSheets();
    return { ok: true, mirror: result ?? 'already running' };
  });

  // Whole DB as .xlsx, delivered to the admin's chat (file downloads inside Mini Apps are unreliable).
  app.post('/api/admin/export', admin, async (request) => {
    const result = await sendExcelBackup(request.authUser.telegramId);
    return { ok: true, ...result };
  });

  app.get('/api/admin/students', admin, async (request) => {
    const query = request.query as { teacher_id?: string; status?: string; type?: string };
    const students = await listStudents({
      teacherId: query.teacher_id,
      activeOnly: false,
      status: query.status,
      type: query.type,
    });
    return { students };
  });

  app.post('/api/admin/students', admin, async (request) => {
    const input = createStudentSchema.parse(request.body);
    const student = await createStudent(input, request.authUser.name);
    return { student };
  });

  app.get('/api/admin/students/:id', admin, async (request) => {
    const { id } = request.params as { id: string };
    return getStudentHistory(id);
  });

  app.patch('/api/admin/students/:id', admin, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateStudentSchema.parse(request.body);
    const student = await updateStudent(id, input, request.authUser.name);
    return { student };
  });

  app.post('/api/admin/students/:id/balance', admin, async (request) => {
    const { id } = request.params as { id: string };
    const { amount } = topUpSchema.parse(request.body);
    const student = await topUpBalance(id, amount, request.authUser.name);
    return { student };
  });

  app.get('/api/admin/teachers', admin, async () => ({ teachers: await listTeachers(true) }));

  app.patch('/api/admin/teachers/:id', admin, async (request) => {
    const { id } = request.params as { id: string };
    const input = updateTeacherSchema.parse(request.body);
    const teacher = await updateTeacher(id, input, request.authUser.name);
    return { teacher };
  });

  app.post('/api/admin/teachers/:id/approve', admin, async (request) => {
    const { id } = request.params as { id: string };
    const teacher = await approveTeacher(id, request.authUser.name);
    return { teacher };
  });

  app.get('/api/admin/lessons', admin, async (request) => {
    const query = request.query as {
      teacher_id?: string;
      student_id?: string;
      state?: string;
      month?: string;
      before?: string;
      limit?: string;
    };
    const settings = await getSettings();
    const { lessons, next_cursor } = listLessonsPage({
      teacherId: query.teacher_id,
      studentId: query.student_id,
      state: query.state,
      month: query.month,
      before: query.before,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return {
      next_cursor,
      lessons: lessons.map((lesson) => ({
        ...lesson,
        edit_seconds_left: remainingEditSeconds(lesson, settings.edit_window_min),
      })),
    };
  });

  app.patch('/api/admin/lessons/:id', admin, async (request) => {
    const { id } = request.params as { id: string };
    const input = editLessonSchema.parse(request.body);
    const lesson = await editLesson(id, input, request.authUser);
    return { lesson };
  });

  app.post('/api/admin/lessons/:id/cancel', admin, async (request) => {
    const { id } = request.params as { id: string };
    const lesson = await cancelLesson(id, request.authUser);
    return { lesson };
  });

  app.get('/api/admin/reports/business', admin, async (request) => {
    const month = (request.query as { month?: string }).month;
    return { reports: await listBusinessReports(month) };
  });

  app.post('/api/admin/reports/business', admin, async (request) => {
    const { month } = businessReportSchema.parse(request.body ?? {});
    const reports = await generateBusinessReport(month, 'manual');
    return { reports };
  });
}
