import { useState, useEffect } from 'react';
import AssignmentsTab from './AssignmentsTab.jsx';
import GradeTab from './GradeTab.jsx';
import DiscussTab from './DiscussTab.jsx';
import StudentsTab from './StudentsTab.jsx';
import MaterialsTab from './MaterialsTab.jsx';
import AlwaysOnTab from './AlwaysOnTab.jsx';
import CourseSettingsTab from './CourseSettingsTab.jsx';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const TABS = [
  { key: 'assignments', label: 'Assignments' },
  { key: 'grade', label: 'Grade' },
  { key: 'alwayson', label: 'Always-On' },
  { key: 'discuss', label: 'Discuss' },
  { key: 'students', label: 'Students' },
  { key: 'materials', label: 'Materials' },
  { key: 'settings', label: 'Settings' },
];

export default function CourseShell({ course, password, onUpdateCourse, onDeleteCourse }) {
  const [tab, setTab] = useState('assignments');
  const [aoPending, setAoPending] = useState(0);

  useEffect(() => {
    fetch(`${BASE}/api/alwayson/counts?courseId=${course.id}`, {
      headers: { 'x-admin-password': password }
    }).then(r => r.json()).then(d => setAoPending(d.pending || 0)).catch(() => {});
  }, [course.id, tab]);

  return (
    <div className="course-shell">
      <aside className="course-sidebar">
        <div className="course-sidebar-header">
          <div className="course-sidebar-name" style={{ color: course.color }}>{course.name}</div>
          <div className="course-sidebar-inst">{course.institution}</div>
          <div className="course-sidebar-term">{course.term}</div>
        </div>
        <nav>
          {TABS.map(t => (
            <button
              key={t.key}
              className={`side-nav-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              {t.label}
              {t.key === 'alwayson' && aoPending > 0 && (
                <span className="badge" style={{ background: 'rgba(224,160,48,0.2)', color: 'var(--amber)' }}>{aoPending}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>
      <div className="course-main">
        {tab === 'assignments' && <AssignmentsTab course={course} password={password} />}
        {tab === 'grade' && <GradeTab course={course} password={password} />}
        {tab === 'alwayson' && <AlwaysOnTab course={course} password={password} />}
        {tab === 'discuss' && <DiscussTab course={course} password={password} />}
        {tab === 'students' && <StudentsTab course={course} password={password} />}
        {tab === 'materials' && <MaterialsTab course={course} password={password} />}
        {tab === 'settings' && (
          <CourseSettingsTab
            course={course}
            password={password}
            onUpdate={onUpdateCourse}
            onDelete={onDeleteCourse}
          />
        )}
      </div>
    </div>
  );
}
