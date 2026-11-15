import type { FastifyInstance } from 'fastify';
import { createLessonSchema, editLessonSchema } from '@school/shared';
import { listStudents, getStudent } from '../../services/students.js';
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
