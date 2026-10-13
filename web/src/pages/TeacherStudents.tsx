import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Student } from '@school/shared';
import { api } from '../api';
import { StatusBadge, ErrorBox } from '../ui';

export function TeacherStudents() {
  const [students, setStudents] = useState<Student[]>([]);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ students: Student[] }>('/api/teacher/students')
      .then((d) => setStudents(d.students))
      .catch((e: Error) => setError(e.message));
  }, []);

  const filtered = useMemo(
    () => students.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())),
    [students, q],
  );

  return (
    <>
      <div className="header"><h1>My students</h1></div>
      <ErrorBox error={error} />
      <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ height: 10 }} />
      {filtered.map((student) => (
        <div key={student.student_id} className="card clickable" onClick={() => navigate(`/students/${student.student_id}`)}>
          <div className="row">
            <div>
              <div className="title">{student.name}</div>
              <div className="small">{student.type === 'business' ? 'Business' : `Balance: ${student.balance}`}</div>
            </div>
            <StatusBadge status={student.status} />
          </div>
        </div>
      ))}
      {!filtered.length && <p className="muted">No students yet.</p>}
    </>
  );
}
