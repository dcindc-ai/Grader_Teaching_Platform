import { useState, useEffect, useCallback } from 'react';
import { getCourses, getCorpusStats } from './api.js';
import CourseShell from './components/CourseShell.jsx';
import CorpusView from './components/CorpusView.jsx';
import DevTab from './components/DevTab.jsx';
import HomeDashboard from './components/HomeDashboard.jsx';
import './App.css';

export default function App() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('tp_pw') || '');
  const [authed, setAuthed] = useState(true);
  const [authErr, setAuthErr] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState([]);
  const [activeCourse, setActiveCourse] = useState(null);
  const [view, setView] = useState('home');
  const [stats, setStats] = useState(null);

  // ── Persisted cross-tab state ──────────────────────────────────────────
  // Grade queues per course — survives tab switching
  const [gradeQueues, setGradeQueues] = useState({});
  // Grade results per course (in addition to DB — for instant UI)
  const [gradeResults, setGradeResults] = useState({});
  // Discussion sessions per course
  const [discussSessions, setDiscussSessions] = useState({});
  // Label queues per course
  const [labelQueues, setLabelQueues] = useState({});
  // Always-On pending counts per course
  const [aoCounts, setAoCounts] = useState({});

  const loadAll = useCallback(async (password) => {
    setLoading(true);
    try {
      const [cs, st] = await Promise.all([getCourses(''), getCorpusStats('')]);
      setCourses(cs);
      setStats(st);
      setActiveCourse(null);
      setView('home');
      setAuthed(true);
    } catch (e) {
      console.error('Load error:', e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadAll('').catch(() => {});
  }, []); // eslint-disable-line

  function handleLogin(e) {
    e.preventDefault();
    setAuthErr('');
    loadAll(pw);
  }

  function signOut() {
    sessionStorage.removeItem('tp_pw');
    setAuthed(false);
    setPw('');
    setCourses([]);
  }

  function addCourse(course) {
    setCourses(c => [...c, course]);
    setActiveCourse(course.id);
    setView('course');
  }

  function updateCourse(updated) {
    setCourses(c => c.map(x => x.id === updated.id ? updated : x));
  }

  function removeCourse(id) {
    setCourses(c => c.filter(x => x.id !== id));
    setActiveCourse(courses.find(c => c.id !== id)?.id || null);
  }

  // Helpers to update per-course queues
  function updateGradeQueue(courseId, updater) {
    setGradeQueues(q => ({ ...q, [courseId]: updater(q[courseId] || []) }));
  }
  function updateGradeResults(courseId, updater) {
    setGradeResults(r => ({ ...r, [courseId]: updater(r[courseId] || []) }));
  }
  function updateDiscussSession(courseId, updater) {
    setDiscussSessions(s => ({ ...s, [courseId]: updater(s[courseId] || { submissions: [], question: '' }) }));
  }
  function updateLabelQueue(courseId, updater) {
    setLabelQueues(q => ({ ...q, [courseId]: updater(q[courseId] || []) }));
  }
  function updateAoCount(courseId, count) {
    setAoCounts(c => ({ ...c, [courseId]: count }));
  }

  if (!authed) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-mark">AO</div>
          <div className="login-title">Always On Learning</div>
          <div className="login-sub">Teaching Platform · Dave Cook</div>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--text2)', fontSize: 13, padding: '20px 0' }}>
              Loading…
            </div>
          ) : (
            <form onSubmit={handleLogin}>
              <div className="field">
                <label>Password</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    onChange={e => setPw(e.target.value)}
                    autoFocus
                    placeholder="Admin password"
                    style={{ paddingRight: 44 }}
                  />
                  <button type="button" onClick={() => setShowPw(s => !s)} style={{
                    position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer', fontSize: 16,
                    color: 'var(--text2)', padding: '2px 4px'
                  }}>
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>
              {authErr && <div className="auth-err">{authErr}</div>}
              <button type="submit" className="primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    );
  }

  const course = courses.find(c => c.id === activeCourse);

  return (
    <div className="app-shell" style={{ '--course-color': course?.color || '#4f8ef7' }}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-mark">AO</span>
          <span className="topbar-name">Always On Learning</span>
        </div>
        <nav className="topbar-nav">
          <button
            className={`course-tab${view === 'home' ? ' active' : ''}`}
            onClick={() => setView('home')}
          >
            ⌂ Home
          </button>
          {courses.map(c => (
            <button
              key={c.id}
              className={`course-tab${activeCourse === c.id && view === 'course' ? ' active' : ''}`}
              style={{ '--c': c.color }}
              onClick={() => { setActiveCourse(c.id); setView('course'); }}
            >
              <span className="course-dot" style={{ background: c.color }} />
              {c.name}
              <span style={{ fontSize: 10, color: 'var(--text3)', marginLeft: 4 }}>
                {c.institution?.split(' ').map(w => w[0]).join('')}
              </span>
              {/* Show grading-in-progress indicator */}
              {(gradeQueues[c.id] || []).some(q => q.status === 'grading') && (
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)', marginLeft: 4, flexShrink: 0 }} />
              )}
            </button>
          ))}
          <button
            className={`course-tab${view === 'corpus' ? ' active' : ''}`}
            onClick={() => setView('corpus')}
          >
            Corpus
            {stats && <span className="badge" style={{ marginLeft: 6 }}>{stats.totalGrades}</span>}
          </button>
          <button
            className={`course-tab${view === 'dev' ? ' active' : ''}`}
            style={{ color: view === 'dev' ? 'var(--amber)' : undefined }}
            onClick={() => setView('dev')}
          >
            🔧 Dev
          </button>
          <button className="course-tab add-course" onClick={async () => {
            const name = prompt('Course short name (e.g. GEOG 662):');
            if (!name) return;
            const { createCourse } = await import('./api.js');
            const c = await createCourse({ name, fullName: name, institution: '', term: '', color: '#4f8ef7' }, pw);
            addCourse(c);
          }}>+ Course</button>
        </nav>
        <div className="topbar-right">
          <button className="ghost" style={{ fontSize: 12 }} onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="app-body">
        {view === 'home' && (
          <HomeDashboard
            courses={courses}
            stats={stats}
            onSelectCourse={id => { setActiveCourse(id); setView('course'); }}
          />
        )}
        {view === 'course' && course && (
          <CourseShell
            key={course.id}
            course={course}
            password={pw}
            onUpdateCourse={updateCourse}
            onDeleteCourse={() => removeCourse(course.id)}
            // Persisted state passed down
            gradeQueue={gradeQueues[course.id] || []}
            onGradeQueue={(updater) => updateGradeQueue(course.id, updater)}
            gradeResults={gradeResults[course.id] || []}
            onGradeResults={(updater) => updateGradeResults(course.id, updater)}
            discussSession={discussSessions[course.id] || { submissions: [], question: '' }}
            onDiscussSession={(updater) => updateDiscussSession(course.id, updater)}
            labelQueue={labelQueues[course.id] || []}
            onLabelQueue={(updater) => updateLabelQueue(course.id, updater)}
            aoCount={aoCounts[course.id] || 0}
            onAoCount={(count) => updateAoCount(course.id, count)}
          />
        )}
        {view === 'corpus' && (
          <CorpusView
            password={pw}
            stats={stats}
            onRefreshStats={() => getCorpusStats(pw).then(setStats)}
          />
        )}
        {view === 'dev' && (
          <div style={{ padding: '24px 28px', height: '100%', overflow: 'hidden' }}>
            <DevTab password={pw} />
          </div>
        )}
      </div>
    </div>
  );
}
