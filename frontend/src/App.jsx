import { useState, useEffect, useCallback } from 'react';
import { getCourses, getCorpusStats } from './api.js';
import CourseShell from './components/CourseShell.jsx';
import CorpusView from './components/CorpusView.jsx';
import DevTab from './components/DevTab.jsx';
import './App.css';

export default function App() {
  const [pw, setPw] = useState(() => sessionStorage.getItem('tp_pw') || '');
  const [authed, setAuthed] = useState(false);
  const [authErr, setAuthErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [courses, setCourses] = useState([]);
  const [activeCourse, setActiveCourse] = useState(null);
  const [view, setView] = useState('course');
  const [stats, setStats] = useState(null);

  const loadAll = useCallback(async (password) => {
    setLoading(true);
    try {
      const [cs, st] = await Promise.all([getCourses(password), getCorpusStats(password)]);
      setCourses(cs);
      setStats(st);
      setActiveCourse(cs[0]?.id || null);
      setAuthed(true);
      sessionStorage.setItem('tp_pw', password);
    } catch (e) {
      setAuthErr('Incorrect password.');
      setAuthed(false);
    }
    setLoading(false);
  }, []);

  useEffect(() => { if (pw) loadAll(pw); }, []); // eslint-disable-line

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

  if (!authed) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <div className="login-mark">TP</div>
          <div className="login-title">Teaching Platform</div>
          <div className="login-sub">Dave Cook · UMD / Wake Forest</div>
          <form onSubmit={handleLogin}>
            <div className="field">
              <label>Password</label>
              <input type="password" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="Admin password" />
            </div>
            {authErr && <div className="auth-err">{authErr}</div>}
            <button type="submit" className="primary" style={{ width: '100%', marginTop: 8 }} disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const course = courses.find(c => c.id === activeCourse);

  return (
    <div className="app-shell" style={{ '--course-color': course?.color || '#4f8ef7' }}>
      <header className="topbar">
        <div className="topbar-left">
          <span className="topbar-mark">TP</span>
          <span className="topbar-name">Teaching Platform</span>
        </div>
        <nav className="topbar-nav">
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
            const course = await createCourse({ name, fullName: name, institution: '', term: '', color: '#4f8ef7' }, pw);
            addCourse(course);
          }}>+ Course</button>
        </nav>
        <div className="topbar-right">
          <button className="ghost" style={{ fontSize: 12 }} onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="app-body">
        {view === 'course' && course && (
          <CourseShell
            key={course.id}
            course={course}
            password={pw}
            onUpdateCourse={updateCourse}
            onDeleteCourse={() => removeCourse(course.id)}
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
