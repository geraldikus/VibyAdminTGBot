import { useEffect, useState } from 'react';
import type { Lesson, Student } from '@school/shared';
import { BottomSheet, IconTile, dayLabel, groupBy } from './ui';

export type LessonView = Lesson & { edit_seconds_left: number };

const STATE_META: Record<Lesson['state'], { icon: 'camera' | 'check' | 'x'; color: string; label: string; badge: string }> = {
  pending_photo: { icon: 'camera', color: 'var(--c-orange)', label: 'Waiting for photo', badge: 'warn' },
  done: { icon: 'check', color: 'var(--c-green)', label: 'Done', badge: 'green' },
  cancelled: { icon: 'x', color: '#8e8e93', label: 'Cancelled', badge: '' },
};

export function LessonStateIcon({ state }: { state: Lesson['state'] }) {
  const meta = STATE_META[state];
  return <IconTile name={meta.icon} color={meta.color} />;
}

export function lessonStateLabel(state: Lesson['state']) {
  return STATE_META[state].label;
}

export function lessonStateBadge(state: Lesson['state']) {
  return <span className={`badge ${STATE_META[state].badge}`}>{STATE_META[state].label}</span>;
}

/** Lessons grouped by lesson_date, newest day first (list is already sorted by created_at). */
export function groupByDay<T extends Lesson>(lessons: T[]): Array<[string, T[]]> {
  const sorted = [...lessons].sort((a, b) => b.lesson_date.localeCompare(a.lesson_date) || b.created_at.localeCompare(a.created_at));
  return groupBy(sorted, (l) => l.lesson_date).map(([day, items]) => [dayLabel(day), items]);
}

export function PendingBanner({ count }: { count: number }) {
  if (!count) return null;
  return (
    <div className="banner">
      📸 {count} {count === 1 ? 'lesson is' : 'lessons are'} waiting for a photo
    </div>
  );
}

export interface LessonEditValues {
  duration_min?: number;
  lesson_date?: string;
  comment: string;
  student_id?: string;
}

/** Edit form in a bottom sheet. Admins also get the student picker. */
export function LessonEditSheet({ lesson, students, busy, onClose, onSave, onCancelLesson }: {
  lesson: LessonView | null;
  students?: Student[];
  busy?: boolean;
  onClose: () => void;
  onSave: (values: LessonEditValues) => void;
  onCancelLesson: () => void;
}) {
  const [form, setForm] = useState({ duration_min: '', lesson_date: '', comment: '', student_id: '' });

  useEffect(() => {
    if (lesson) {
      setForm({
        duration_min: String(lesson.duration_min),
        lesson_date: lesson.lesson_date,
        comment: lesson.comment,
        student_id: lesson.student_id,
      });
    }
  }, [lesson]);

  return (
    <BottomSheet open={!!lesson} title={lesson ? lesson.student_name : ''} onClose={onClose}>
      <div className="form-fields">
        {students && (
          <>
            <label>Student</label>
            <select value={form.student_id} onChange={(e) => setForm({ ...form, student_id: e.target.value })}>
              {students.map((s) => <option key={s.student_id} value={s.student_id}>{s.name}</option>)}
            </select>
          </>
        )}
        <label>Duration, min</label>
        <input inputMode="numeric" value={form.duration_min} onChange={(e) => setForm({ ...form, duration_min: e.target.value })} />
        <label>Date</label>
        <input type="date" value={form.lesson_date} onChange={(e) => setForm({ ...form, lesson_date: e.target.value })} />
        <label>Comment</label>
        <textarea value={form.comment} placeholder="Optional" onChange={(e) => setForm({ ...form, comment: e.target.value })} />
      </div>
      <button className="btn mt" disabled={busy} onClick={() => onSave({
        duration_min: form.duration_min ? Number(form.duration_min) : undefined,
        lesson_date: form.lesson_date || undefined,
        comment: form.comment,
        student_id: students && form.student_id ? form.student_id : undefined,
      })}>
        Save
      </button>
      <button className="btn danger mt" disabled={busy} onClick={onCancelLesson}>Cancel lesson</button>
    </BottomSheet>
  );
}
