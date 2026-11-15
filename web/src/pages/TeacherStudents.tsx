import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Student } from '@school/shared';
import { STATUS_LABEL } from '@school/shared';
import { api } from '../api';
import {
  Avatar, BalancePill, Cell, EmptyState, ErrorBox, PageHeader, SearchInput, Section, SkeletonList, StatusDot, urgency,
} from '../ui';

export function TeacherStudents() {
  const [students, setStudents] = useState<Student[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ students: Student[] }>('/api/teacher/students')
      .then((d) => setStudents(d.students))
      .catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(
    () => (students ?? [])
      .filter((s) => s.name.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => urgency(a) - urgency(b) || a.name.localeCompare(b.name)),
    [students, q],
  );

  return (
    <>
      <PageHeader title="My students" />
      <ErrorBox error={error} />
      {students && students.length > 5 && <SearchInput value={q} onChange={setQ} />}
      {!students && !error && <SkeletonList />}
      {students && !!filtered.length && (
        <Section title={`${filtered.length} ${filtered.length === 1 ? 'student' : 'students'}`} footer="Tap a student to mark a lesson.">
          {filtered.map((s) => (
            <Cell
              key={s.student_id}
              before={<Avatar name={s.name} seed={s.student_id} />}
              title={s.name}
              subtitle={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><StatusDot status={s.status} />{STATUS_LABEL[s.status]}</span>}
              after={<BalancePill student={s} />}
              chevron
              onClick={() => navigate(`/students/${s.student_id}`)}
            />
          ))}
        </Section>
      )}
      {students && !filtered.length && (
        q
          ? <EmptyState emoji="🔍" title="Nothing found" text={`No students match “${q}”.`} />
          : <EmptyState emoji="🎓" title="No students yet" text="The admin will assign students to you." />
      )}
    </>
  );
}
