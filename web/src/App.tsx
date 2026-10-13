import { useEffect, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { AppSettings, AuthUser } from '@school/shared';
import { api } from './api';
import { tg } from './telegram';
import { TeacherStudents } from './pages/TeacherStudents';
import { TeacherStudent } from './pages/TeacherStudent';
import { TeacherLessons } from './pages/TeacherLessons';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminStudents } from './pages/AdminStudents';
import { AdminStudent } from './pages/AdminStudent';
import { AdminTeachers } from './pages/AdminTeachers';
import { AdminLessons } from './pages/AdminLessons';
import { AdminReports } from './pages/AdminReports';
import { FeedbackHost } from './ui';

export function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ user: AuthUser; settings: AppSettings }>('/api/me')
      .then((data) => {
        setUser(data.user);
        setSettings(data.settings);
      })
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    const app = tg();
    if (!app) return;
    const nested = location.pathname.split('/').filter(Boolean).length > 1
      || /\/(students|lessons|teachers|reports)\//.test(location.pathname);
    const onBack = () => navigate(-1);
    if (nested) {
      app.BackButton.show();
      app.BackButton.onClick(onBack);
    } else {
      app.BackButton.hide();
    }
    return () => app.BackButton.offClick(onBack);
  }, [location.pathname, navigate]);

  if (error) {
    return (
      <div className="app">
        <div className="error">{error}</div>
        <p className="muted">Open this Mini App from the Telegram bot. If you are developing locally, set a X-Dev-User header via localStorage.devUser.</p>
      </div>
    );
  }
  if (!user || !settings) return <div className="app muted">Loading…</div>;

  const isAdmin = user.role === 'admin';

  return (
    <div className="app">
      <Routes>
        {isAdmin ? (
          <>
            <Route path="/" element={<Navigate to="/admin" replace />} />
            <Route path="/admin" element={<AdminDashboard />} />
            <Route path="/admin/students" element={<AdminStudents />} />
            <Route path="/admin/students/:id" element={<AdminStudent />} />
            <Route path="/admin/teachers" element={<AdminTeachers />} />
            <Route path="/admin/lessons" element={<AdminLessons />} />
            <Route path="/admin/reports" element={<AdminReports />} />
            <Route path="*" element={<Navigate to="/admin" replace />} />
          </>
        ) : (
          <>
            <Route path="/" element={<TeacherStudents />} />
            <Route path="/students/:id" element={<TeacherStudent settings={settings} />} />
            <Route path="/lessons" element={<TeacherLessons />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </>
        )}
      </Routes>
      <FeedbackHost />
      <nav className="nav">
        {isAdmin ? (
          <>
            <NavLink to="/admin" end>Home</NavLink>
            <NavLink to="/admin/students">Students</NavLink>
            <NavLink to="/admin/teachers">Teachers</NavLink>
            <NavLink to="/admin/lessons">Lessons</NavLink>
            <NavLink to="/admin/reports">Reports</NavLink>
          </>
        ) : (
          <>
            <NavLink to="/" end>Students</NavLink>
            <NavLink to="/lessons">Lessons</NavLink>
          </>
        )}
      </nav>
    </div>
  );
}
