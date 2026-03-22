import { useState, useEffect } from 'react';
import AssignmentsTab from './AssignmentsTab.jsx';
import GradeTab from './GradeTab.jsx';
import DiscussTab from './DiscussTab.jsx';
import StudentsTab from './StudentsTab.jsx';
import MaterialsTab from './MaterialsTab.jsx';
import AlwaysOnTab from './AlwaysOnTab.jsx';
import LabelTab from './LabelTab.jsx';
import AnalyticsTab from './AnalyticsTab.jsx';
import CourseSettingsTab from './CourseSettingsTab.jsx';
import SyncTab from './SyncTab.jsx';
import InsightsTab from './InsightsTab.jsx';
import FlagsTab from './FlagsTab.jsx';
import BatchGradeTab from './BatchGradeTab.jsx';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const TABS = [
  { key: 'assignments', label: 'Assignments' },
  { key: 'grade', label: 'Grade' },
  { key: 'alwayson', label: 'Always-On' },
  { key: 'discuss', label: 'Discuss' },
  { key: 'students', label: 'Students' },
  { key: 'materials', label: 'Materials' },
  { key: 'analytics', label: '📊 Analytics' },
  { key: 'label', label: 'Label Data' },
  { key: 'sync', label: '⇄ Sync Check' },
  { key: 'insights', label: '💡 Insights' },
  { key: 'flags', label: '⚑ Flags' },
  { key: 'batch', label: '⚡ Batch Grade' },
  { key: 'settings', label: 'Settings' },
];

export default function CourseShell({
  course, password, onUpdateCourse, onDeleteCourse,
  gradeQueue, onGradeQueue, gradeResults, onGradeResults,
  discussSession, onDiscussSession,
  labelQueue, onLabelQueue,
  aoCount, onAoCount
}) {
  const [tab, setTab] = useState('assignments');
  const [assignments, setAssignments] = useState([]);
  const [activeAssignmentId, setActiveAssignmentId] = useState(
    () => localStorage.getItem(`active_assign_${course.id}`) || ''
  );

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (!activeAssignmentId && a.length) setActiveAssignmentId(a[0].id);
    });
  }, [course.id]);

  const [flagCount, setFlagCount] = useState(0);

  // Refresh AO count and flags count whenever we switch tabs
  useEffect(() => {
    fetch(`${BASE}/api/alwayson/counts?courseId=${course.id}`, {
      headers: { 'x-admin-password': password }
    }).then(r => r.json()).then(d => onAoCount(d.pending || 0)).catch(() => {});
    fetch(`${BASE}/api/flags?courseId=${course.id}&status=open`)
      .then(r => r.json()).then(d => setFlagCount(Array.isArray(d) ? d.length : 0)).catch(() => {});
  }, [course.id, tab]);

  function setActiveAssignment(id) {
    setActiveAssignmentId(id);
    localStorage.setItem(`active_assign_${course.id}`, id);
  }

  const activeAssignment = assignments.find(a => a.id === activeAssignmentId);
  const gradingInProgress = gradeQueue.some(q => q.status === 'grading');
  const pendingGrades = gradeQueue.filter(q => q.status === 'pending').length;

  return (
    <div className="course-shell">
      <aside className="course-sidebar">
        <div className="course-sidebar-header">
          <div className="course-sidebar-name" style={{ color: course.color }}>{course.name}</div>
          <div className="course-sidebar-inst">{course.institution}</div>
          <div className="course-sidebar-term">{course.term}</div>
        </div>

        {/* Active assignment selector */}
        <div style={{ padding: '10px 14px 12px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
          <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 5 }}>Grading</div>
          <select value={activeAssignmentId} onChange={e => setActiveAssignment(e.target.value)}
            style={{ width: '100%', fontSize: 12, padding: '5px 8px', fontWeight: 500 }}>
            {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {activeAssignment && (
            <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
              {activeAssignment.type} · {activeAssignment.maxScore} pts
            </div>
          )}
        </div>

        <nav>
          {TABS.map(t => (
            <button key={t.key}
              className={`side-nav-btn${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}>
              {t.label}
              {t.key === 'alwayson' && aoCount > 0 && (
                <span className="badge" style={{ background: 'rgba(217,119,6,0.1)', color: 'var(--amber)', borderColor: 'rgba(217,119,6,0.2)' }}>{aoCount}</span>
              )}
              {t.key === 'flags' && flagCount > 0 && (
                <span className="badge" style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626', borderColor: 'rgba(220,38,38,0.2)' }}>{flagCount}</span>
              )}
              {t.key === 'grade' && gradingInProgress && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', flexShrink: 0 }} title="Grading in progress" />
              )}
              {t.key === 'grade' && !gradingInProgress && pendingGrades > 0 && (
                <span className="badge">{pendingGrades}</span>
              )}
            </button>
          ))}
        </nav>
      </aside>

      <div className="course-main">
        {/* Active assignment banner on grade/alwayson tabs */}
        {activeAssignment && (tab === 'grade' || tab === 'alwayson') && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px',
            background: `${course.color}10`, border: `1px solid ${course.color}30`,
            borderRadius: 8, marginBottom: 16, fontSize: 13
          }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: course.color, flexShrink: 0 }} />
            <span>Currently grading: <strong>{activeAssignment.name}</strong></span>
            <span style={{ color: 'var(--text3)', fontSize: 11 }}>{activeAssignment.maxScore} pts max</span>
            {gradingInProgress && (
              <span style={{ fontSize: 11, color: 'var(--amber)', fontWeight: 500, marginLeft: 4 }}>
                ● Grading in progress
              </span>
            )}
            <button className="ghost" style={{ fontSize: 11, marginLeft: 'auto', padding: '2px 8px' }}
              onClick={() => setTab('assignments')}>Change</button>
          </div>
        )}

        {tab === 'assignments' && (
          <AssignmentsTab course={course} password={password}
            activeAssignmentId={activeAssignmentId} onSetActive={setActiveAssignment} />
        )}
        {tab === 'grade' && (
          <GradeTab
            course={course} password={password}
            activeAssignmentId={activeAssignmentId}
            queue={gradeQueue} onQueue={onGradeQueue}
            results={gradeResults} onResults={onGradeResults}
          />
        )}
        {tab === 'alwayson' && <AlwaysOnTab course={course} password={password} />}
        {tab === 'discuss' && (
          <DiscussTab course={course} password={password}
            session={discussSession} onSession={onDiscussSession}
            assignments={assignments} />
        )}
        {tab === 'students' && <StudentsTab course={course} password={password} />}
        {tab === 'materials' && <MaterialsTab course={course} password={password} />}
        {tab === 'label' && (
          <LabelTab course={course} password={password}
            queue={labelQueue} onQueue={onLabelQueue} />
        )}
        {tab === 'analytics' && (
          <AnalyticsTab course={course} password={password} />
        )}
        {tab === 'sync' && (
          <SyncTab course={course} password={password} />
        )}
        {tab === 'insights' && (
          <InsightsTab course={course} password={password} />
        )}
        {tab === 'flags' && (
          <FlagsTab course={course} password={password} />
        )}
        {tab === 'batch' && (
          <BatchGradeTab course={course} password={password} />
        )}
        {tab === 'settings' && (
          <CourseSettingsTab course={course} password={password}
            onUpdate={onUpdateCourse} onDelete={onDeleteCourse} />
        )}
      </div>
    </div>
  );
}
