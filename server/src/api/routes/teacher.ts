import type { FastifyInstance } from 'fastify';
import { STATUS_LABEL, createLessonSchema, editLessonSchema, teacherCreateStudentSchema } from '@school/shared';
import { createStudent, listStudents, getStudent } from '../../services/students.js';
import { notifyAdmins } from '../../services/notify.js';
import {
  createLesson,
  editLesson,
  cancelLesson,
  listLessonsPage,
  remainingEditSeconds,
} from '../../services/lessons.js';
import { getSettings } from '../../services/settings.js';
import { requireRole } from '../auth.js';

export async function registerTeacherRoutes(app: FastifyInstance) {
  app.get('/api/teacher/students', { preHandler: requireRole('teacher', 'admin') }, async (request) => {
    const teacherId = request.authUser.role === 'admin'
      ? (request.query as { teacher_id?: string }).teacher_id
      : request.authUser.teacherId;
    const students = await listStudents({
      teacherId: teacherId || request.authUser.teacherId,
      activeOnly: true,
    });
    return { students };
  });

  // Teacher adds a student for themself. No approval: admins are notified.
  app.post('/api/teacher/students', { preHandler: requireRole('teacher') }, async (request) => {
    const input = teacherCreateStudentSchema.parse(request.body);
    const user = request.authUser;
    const student = await createStudent({ ...input, teacher_id: user.teacherId! }, user.name);
    const lines = [
      `Teacher ${user.name} added a student`,
      [
        student.name,
        student.type === 'business' ? 'Business' : 'Subscription',
        STATUS_LABEL[student.status],
        student.type === 'subscription' ? `balance ${student.balance}` : '',
      ].filter(Boolean).join(' · '),
      student.contact ? `Contact: ${student.contact}` : '',
      student.type === 'subscription' && student.balance > 0 ? 'Check the payment: balance was set by the teacher' : '',
    ];
    await notifyAdmins(lines.filter(Boolean).join('\n'), { studentId: student.student_id });
    return { student };
  });

  app.get('/api/teacher/students/:id', { preHandler: requireRole('teacher', 'admin') }, async (request) => {
    const { id } = request.params as { id: string };
    const student = await getStudent(id);
    if (request.authUser.role === 'teacher' && student.teacher_id !== request.authUser.teacherId) {
      throw Object.assign(new Error('Forbidden'), { statusCode: 403 });
    }
    return { student };
  });

  app.get('/api/teacher/lessons', { preHandler: requireRole('teacher', 'admin') }, async (request) => {
    const settings = await getSettings();
    const teacherId = request.authUser.role === 'teacher' ? request.authUser.teacherId : undefined;
    const query = request.query as { month?: string; before?: string };
    const { lessons, next_cursor } = listLessonsPage({ teacherId, month: query.month, before: query.before });
    return {
      next_cursor,
      lessons: lessons.map((lesson) => ({
        ...lesson,
        edit_seconds_left: remainingEditSeconds(lesson, settings.edit_window_min),
      })),
    };
  });

  app.post('/api/teacher/lessons', { preHandler: requireRole('teacher', 'admin') }, async (request) => {
    const input = createLessonSchema.parse(request.body);
    const lesson = await createLesson(input, request.authUser);
    return { lesson };
  });

  app.patch('/api/teacher/lessons/:id', { preHandler: requireRole('teacher', 'admin') }, async (request) => {
    const { id } = request.params as { id: string };
    const input = editLessonSchema.parse(request.body);
    const lesson = await editLesson(id, input, request.authUser);
    return { lesson };
  });

  app.post('/api/teacher/lessons/:id/cancel', { preHandler: requireRole('teacher', 'admin') }, async (request) => {
    const { id } = request.params as { id: string };
    const lesson = await cancelLesson(id, request.authUser);
    return { lesson };
  });
}
