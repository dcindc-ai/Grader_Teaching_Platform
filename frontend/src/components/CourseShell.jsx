import { useState } from 'react';
import AssignmentsTab from './AssignmentsTab.jsx';
import GradeTab from './GradeTab.jsx';
import DiscussTab from './DiscussTab.jsx';
import StudentsTab from './StudentsTab.jsx';
import CourseSettingsTab from './CourseSettingsTab.jsx';

const TABS = [
  { key: 'assignments', label: 'Assignments' },
  { key: 'grade', label: 'Grade' },
  { key: 'discuss', label: 'Discuss' },
  { key: 'students', label: 'Students' },
  { key: 'settings', label: 'Settings' },
];

export default function CourseShell({ course, password, onUpdateCourse, onDeleteCourse }) {
  const [tab, setTab] = useState('assignments');

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
            </button>
          ))}
        </nav>
      </aside>
      <div className="course-main">
        {tab === 'assignments' && <AssignmentsTab course={course} password={password} />}
        {tab === 'grade' && <GradeTab course={course} password={password} />}
        {tab === 'discuss' && <DiscussTab course={course} password={password} />}
        {tab === 'students' && <StudentsTab course={course} password={password} />}
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
