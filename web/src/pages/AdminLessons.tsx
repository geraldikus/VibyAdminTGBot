import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { Student } from '@school/shared';
import { api } from '../api';
import { confirmAction, notifyError, notifySuccess } from '../feedback';
import { Cell, EmptyState, ErrorBox, MonthPicker, PageHeader, Section, Segmented, SkeletonList, currentMonth } from '../ui';
import {
  LessonEditSheet, LessonStateIcon, PendingBanner, groupByDay, type LessonEditValues, type LessonView,
} from '../lessonUi';

type StateFilter = '' | 'pending_photo' | 'done' | 'cancelled';

export function AdminLessons() {
  const [params, setParams] = useSearchParams();
  const state = (params.get('state') ?? '') as StateFilter;
  const [lessons, setLessons] = useState<LessonView[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  // Pending lessons are shown across all months, others default to the current month.
  const [month, setMonth] = useState(state === 'pending_photo' ? '' : currentMonth());
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<LessonView | null>(null);
  const [busy, setBusy] = useState(false);

  function setState(next: StateFilter) {
    const p = new URLSearchParams(params);
    if (next) p.set('state', next); else p.delete('state');
    setParams(p, { replace: true });
  }

  function lessonsUrl(before?: string) {
    const qs = new URLSearchParams();
    if (state) qs.set('state', state);
    if (month) qs.set('month', month);
    if (before) qs.set('before', before);
    return `/api/admin/lessons?${qs}`;
  }

  async function load() {
    const [l, s] = await Promise.all([
      api.get<{ lessons: LessonView[]; next_cursor: string | null }>(lessonsUrl()),
      api.get<{ students: Student[] }>('/api/admin/students'),
    ]);
    setLessons(l.lessons);
    setCursor(l.next_cursor);
    setStudents(s.students);
  }

  async function loadMore() {
    if (!cursor) return;
    try {
      const l = await api.get<{ lessons: LessonView[]; next_cursor: string | null }>(lessonsUrl(cursor));
      setLessons((prev) => [...(prev ?? []), ...l.lessons]);
      setCursor(l.next_cursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    }
  }

  useEffect(() => {
    setLessons(null);
    load().catch((e: Error) => setError(e.message));
  }, [state, month]);

  async function save(values: LessonEditValues) {
    if (!editing || busy) return;
    setBusy(true);
    try {
      await api.patch(`/api/admin/lessons/${editing.lesson_id}`, values);
      setEditing(null);
      await load();
      notifySuccess('Lesson saved');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  async function cancelLesson(lesson: LessonView) {
    if (busy) return;
    const ok = await confirmAction('Cancel this lesson? The balance will be restored.');
    if (!ok) return;
    setBusy(true);
    try {
      await api.post(`/api/admin/lessons/${lesson.lesson_id}/cancel`);
      setEditing(null);
      await load();
      notifySuccess('Lesson cancelled');
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed';
      setError(message);
      notifyError(message);
    } finally {
      setBusy(false);
    }
  }

  const pending = state === 'pending_photo' ? 0 : (lessons ?? []).filter((l) => l.state === 'pending_photo').length;

  return (
    <>
      <PageHeader title="Lessons" />
      <ErrorBox error={error} />
      <Segmented<StateFilter>
        value={state}
        options={[['', 'All'], ['pending_photo', 'No photo'], ['done', 'Done'], ['cancelled', 'Cancelled']]}
        onChange={setState}
      />
      <MonthPicker month={month} onChange={setMonth} />
      <PendingBanner count={pending} />
      {!lessons && !error && <SkeletonList rows={5} />}
      {lessons && groupByDay(lessons).map(([day, items]) => (
        <Section key={day} title={day} after={`${items.length}`}>
          {items.map((l) => (
            <Cell
              key={l.lesson_id}
              before={<LessonStateIcon state={l.state} />}
              title={l.student_name}
              subtitle={[l.teacher_name, `${l.duration_min} min`, l.comment].filter(Boolean).join(' · ')}
              after={l.photo_link
                ? <a href={l.photo_link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Photo</a>
                : undefined}
              dimmed={l.state === 'cancelled'}
              chevron={l.state !== 'cancelled'}
              onClick={l.state !== 'cancelled' ? () => setEditing(l) : undefined}
            />
          ))}
        </Section>
      ))}
      {cursor && <button className="btn plain" onClick={() => void loadMore()}>Load more</button>}
      {lessons && !lessons.length && <EmptyState emoji="📅" title="No lessons" text="Nothing for this filter." />}

      <LessonEditSheet
        lesson={editing}
        students={students.filter((s) => s.active || s.student_id === editing?.student_id)}
        busy={busy}
        onClose={() => setEditing(null)}
        onSave={(v) => void save(v)}
        onCancelLesson={() => editing && void cancelLesson(editing)}
      />
    </>
  );
}
