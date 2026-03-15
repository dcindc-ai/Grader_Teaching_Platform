import { useState, useEffect, useRef } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
function h(pw) { return { 'x-admin-password': pw }; }

export default function StudentsTab({ course, password }) {
  const [students, setStudents] = useState([]);
  const [progress, setProgress] = useState([]);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();

  useEffect(() => { loadStudents(); }, [course.id]);

  async function loadStudents() {
    const [s, p] = await Promise.all([
      fetch(`${BASE}/api/students?courseId=${course.id}`, { headers: h(password) }).then(r => r.json()),
      fetch(`${BASE}/api/students/progress/${course.id}`, { headers: h(password) }).then(r => r.json())
    ]);
    setStudents(Array.isArray(s) ? s : []);
    setProgress(Array.isArray(p) ? p : []);
  }

  async function handleCSV(file) {
    setUploading(true);
    setUploadResult(null);
    const text = await file.text();
    const lines = text.trim().split('\n');
    const header = lines[0].toLowerCase();
    const nameIdx = header.split(',').findIndex(h => h.includes('name'));
    const emailIdx = header.split(',').findIndex(h => h.includes('email'));
    const parsed = lines.slice(1).map(line => {
      const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
      return { name: cols[nameIdx] || cols[0], email: cols[emailIdx] || cols[1] || '' };
    }).filter(s => s.name);

    const r = await fetch(`${BASE}/api/students/roster`, {
      method: 'POST',
      headers: { ...h(password), 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: course.id, students: parsed })
    });
    const result = await r.json();
    setUploadResult(result);
    setUploading(false);
    loadStudents();
  }

  const filtered = progress.filter(s =>
    !search || s.name?.toLowerCase().includes(search.toLowerCase())
  );

  if (selected) {
    return <StudentDetail
      student={selected}
      course={course}
      password={password}
      onBack={() => setSelected(null)}
    />;
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Students</div>
          <div className="page-sub">{students.length} enrolled · Click any student to see their grade history</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => e.target.files[0] && handleCSV(e.target.files[0])} />
          <button onClick={() => fileRef.current.click()} disabled={uploading} style={{ fontSize: 12 }}>
            {uploading ? 'Uploading…' : '↑ Upload roster CSV'}
          </button>
        </div>
      </div>

      {uploadResult && (
        <div style={{ padding: '8px 12px', marginBottom: 12, background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 8, fontSize: 13, color: 'var(--green)' }}>
          ✓ Added {uploadResult.added} students.
          {uploadResult.skipped > 0 && ` ${uploadResult.skipped} skipped (already enrolled).`}
          {uploadResult.matched > 0 && ` Matched ${uploadResult.matched} existing grades.`}
        </div>
      )}

      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search students…" style={{ marginBottom: 12, fontSize: 13 }} />

      {filtered.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>👥</div>
          No students yet. Upload a roster CSV to get started.
        </div>
      ) : (
        <div>
          {/* Summary stats */}
          {progress.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
              {[
                ['Enrolled', students.length],
                ['Graded at least once', progress.filter(s => s.assignmentsGraded > 0).length],
                ['Avg assignments graded', progress.length ? (progress.reduce((a,s) => a + s.assignmentsGraded, 0) / progress.length).toFixed(1) : 0],
                ['Class avg score', (() => {
                  const all = progress.flatMap(s => s.grades || []);
                  if (!all.length) return '—';
                  return (all.reduce((a, g) => a + (parseFloat(g.total)||0) / (parseFloat(g.maxScore)||1), 0) / all.length * 100).toFixed(0) + '%';
                })()]
              ].map(([l, v]) => (
                <div key={l} style={{ padding: '10px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{l}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18 }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {filtered.map(s => {
            const avg = s.averageScore ? parseFloat(s.averageScore) : null;
            const grades = s.grades || [];
            return (
              <div key={s.id} className="card card-hover" style={{ marginBottom: 6, padding: '12px 14px' }}
                onClick={() => setSelected(s)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                      {s.email || 'No email'} · {s.assignmentsGraded} assignment{s.assignmentsGraded !== 1 ? 's' : ''} graded
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    {/* Mini grade history dots */}
                    <div style={{ display: 'flex', gap: 3 }}>
                      {grades.slice(0, 6).map((g, i) => {
                        const pct = parseFloat(g.total) / parseFloat(g.maxScore);
                        const color = pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
                        return <div key={i} title={`${g.assignmentName}: ${g.total}/${g.maxScore}`}
                          style={{ width: 10, height: 10, borderRadius: '50%', background: color }} />;
                      })}
                    </div>
                    {avg !== null ? (
                      <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16,
                        color: avg/6 >= 0.85 ? 'var(--green)' : avg/6 >= 0.7 ? 'var(--amber)' : 'var(--red)' }}>
                        {avg}
                      </span>
                    ) : (
                      <span style={{ fontSize: 12, color: 'var(--text3)' }}>No grades</span>
                    )}
                    <span style={{ fontSize: 12, color: 'var(--accent)' }}>View →</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StudentDetail({ student, course, password, onBack }) {
  const grades = student.grades || [];
  const avg = grades.length
    ? (grades.reduce((a, g) => a + parseFloat(g.total||0) / parseFloat(g.maxScore||1), 0) / grades.length * 100).toFixed(0)
    : null;

  return (
    <div>
      <button className="ghost" style={{ fontSize: 12, marginBottom: 14 }} onClick={onBack}>
        ← All students
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700 }}>{student.name}</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>{student.email}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          {avg && <div style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700,
            color: parseInt(avg) >= 85 ? 'var(--green)' : parseInt(avg) >= 70 ? 'var(--amber)' : 'var(--red)' }}>
            {avg}%
          </div>}
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{grades.length} assignment{grades.length !== 1 ? 's' : ''} graded</div>
        </div>
      </div>

      {grades.length === 0 ? (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No grades recorded yet for {student.name.split(' ')[0]}.
        </div>
      ) : (
        <div>
          {grades.map((g, i) => {
            const pct = parseFloat(g.total) / parseFloat(g.maxScore);
            const color = pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
            return (
              <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{g.assignmentName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                      {new Date(g.gradedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color }}>
                    {g.total}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text2)' }}>/{g.maxScore}</span>
                  </span>
                </div>
                {g.key_improvement && (
                  <div style={{ fontSize: 12, color: 'var(--text2)', padding: '5px 8px',
                    background: 'var(--bg2)', borderRadius: 5, borderLeft: '3px solid var(--amber)' }}>
                    → {g.key_improvement}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
