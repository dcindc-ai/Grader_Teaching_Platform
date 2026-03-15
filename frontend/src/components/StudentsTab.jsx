import { useState, useEffect, useRef } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
function h(pw) { return { 'x-admin-password': pw, 'Content-Type': 'application/json' }; }

export default function StudentsTab({ course, password }) {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState('');
  const [uploadState, setUploadState] = useState(null); // {status, progress, total, added, skipped, matched, error}
  const [uploading, setUploading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState({ firstName: '', lastName: '', email: '' });
  const fileRef = useRef();
  const uploadAbortRef = useRef(false);

  useEffect(() => { loadStudents(); }, [course.id]);

  async function loadStudents() {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/api/students/progress/${course.id}`, { headers: { 'x-admin-password': password } });
      const data = await r.json();
      setStudents(Array.isArray(data) ? data : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function handleCSV(file) {
    uploadAbortRef.current = false;
    setUploading(true);
    setUploadState({ status: 'reading', progress: 0, total: 0 });

    try {
      const text = await file.text();
      const lines = text.trim().split(/\r?\n/);
      const header = lines[0].toLowerCase().split(',').map(h => h.trim().replace(/"/g,''));
      const nameIdx = header.findIndex(h => h.includes('name'));
      const emailIdx = header.findIndex(h => h.includes('email'));

      const parsed = lines.slice(1)
        .map(line => {
          const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
          return { name: cols[nameIdx >= 0 ? nameIdx : 0], email: cols[emailIdx >= 0 ? emailIdx : 1] || '' };
        })
        .filter(s => s.name && s.name.length > 1);

      setUploadState({ status: 'uploading', progress: 0, total: parsed.length });

      if (uploadAbortRef.current) { setUploading(false); return; }

      const r = await fetch(`${BASE}/api/students/roster`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id, students: parsed })
      });
      const result = await r.json();

      if (result.error) throw new Error(result.error);

      setUploadState({
        status: 'done',
        total: parsed.length,
        added: result.added,
        skipped: result.skipped,
        matched: result.matched
      });
      await loadStudents();
    } catch (e) {
      setUploadState({ status: 'error', error: e.message });
    }
    setUploading(false);
  }

  async function addStudent() {
    if (!addForm.firstName && !addForm.lastName) return;
    await fetch(`${BASE}/api/students`, {
      method: 'POST',
      headers: h(password),
      body: JSON.stringify({ courseId: course.id, ...addForm })
    });
    setAddForm({ firstName: '', lastName: '', email: '' });
    setShowAddForm(false);
    loadStudents();
  }

  async function removeStudent(id, name) {
    if (!confirm(`Remove ${name} from the roster? Grades are kept.`)) return;
    await fetch(`${BASE}/api/students/${id}`, { method: 'DELETE', headers: { 'x-admin-password': password } });
    loadStudents();
  }

  const filtered = students.filter(s =>
    !search || `${s.firstName} ${s.lastName} ${s.nickname} ${s.email}`.toLowerCase().includes(search.toLowerCase())
  );

  if (selected) {
    return <StudentRecord
      student={selected}
      course={course}
      password={password}
      onBack={() => { setSelected(null); loadStudents(); }}
    />;
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Students</div>
          <div className="page-sub">{students.length} enrolled · Click any student to view their record</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 12 }} onClick={() => setShowAddForm(s => !s)}>+ Add student</button>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={e => e.target.files[0] && handleCSV(e.target.files[0])} />
          <button className="primary" style={{ fontSize: 12 }} onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '↑ Upload roster CSV'}
          </button>
        </div>
      </div>

      {/* Upload progress */}
      {uploadState && (
        <div className="card" style={{ marginBottom: 14,
          borderColor: uploadState.status === 'error' ? 'var(--red)' : uploadState.status === 'done' ? 'var(--green)' : 'var(--accent)',
          borderWidth: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13 }}>
              {uploadState.status === 'reading' && 'Reading CSV file…'}
              {uploadState.status === 'uploading' && `Uploading ${uploadState.total} students…`}
              {uploadState.status === 'done' && '✓ Roster uploaded successfully'}
              {uploadState.status === 'error' && '✗ Upload failed'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {uploading && (
                <button style={{ fontSize: 11, padding: '2px 8px', color: 'var(--red)' }}
                  onClick={() => { uploadAbortRef.current = true; setUploading(false); setUploadState(null); }}>
                  Cancel
                </button>
              )}
              {!uploading && (
                <button style={{ fontSize: 11, padding: '2px 8px' }} onClick={() => setUploadState(null)}>
                  Dismiss
                </button>
              )}
            </div>
          </div>

          {/* Progress bar */}
          <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden', marginBottom: 8 }}>
            <div style={{
              height: '100%', borderRadius: 3, transition: 'width 0.3s',
              background: uploadState.status === 'error' ? 'var(--red)' : uploadState.status === 'done' ? 'var(--green)' : 'var(--accent)',
              width: uploadState.status === 'done' ? '100%' : uploadState.status === 'error' ? '100%' :
                     uploadState.status === 'uploading' ? '60%' : '20%'
            }} />
          </div>

          {uploadState.status === 'done' && (
            <div style={{ fontSize: 12, color: 'var(--text2)' }}>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{uploadState.added} added</span>
              {uploadState.skipped > 0 && <span style={{ marginLeft: 12, color: 'var(--text3)' }}>{uploadState.skipped} already enrolled</span>}
              {uploadState.matched > 0 && <span style={{ marginLeft: 12, color: 'var(--accent)' }}>{uploadState.matched} grades matched</span>}
            </div>
          )}
          {uploadState.status === 'error' && (
            <div style={{ fontSize: 12, color: 'var(--red)' }}>{uploadState.error}</div>
          )}
        </div>
      )}

      {/* Add student form */}
      {showAddForm && (
        <div className="card" style={{ marginBottom: 14, borderColor: 'var(--accent)', borderWidth: 2 }}>
          <div style={{ fontWeight: 600, marginBottom: 10 }}>Add student manually</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>First name</label>
              <input type="text" value={addForm.firstName} onChange={e => setAddForm(f => ({...f, firstName: e.target.value}))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Last name</label>
              <input type="text" value={addForm.lastName} onChange={e => setAddForm(f => ({...f, lastName: e.target.value}))} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Email</label>
              <input type="email" value={addForm.email} onChange={e => setAddForm(f => ({...f, email: e.target.value}))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" style={{ fontSize: 12 }} onClick={addStudent}>Add</button>
            <button style={{ fontSize: 12 }} onClick={() => setShowAddForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {/* Search */}
      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search by name, nickname, or email…"
        style={{ marginBottom: 12, fontSize: 13 }} />

      {/* Summary stats */}
      {students.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
          {[
            ['Enrolled', students.length],
            ['Graded', students.filter(s => s.assignmentsGraded > 0).length],
            ['Avg score', (() => {
              const all = students.flatMap(s => s.grades || []);
              if (!all.length) return '—';
              return (all.reduce((a, g) => a + (parseFloat(g.total)||0)/(parseFloat(g.maxScore)||1), 0) / all.length * 100).toFixed(0) + '%';
            })()],
            ['Not yet graded', students.filter(s => s.assignmentsGraded === 0).length]
          ].map(([l, v]) => (
            <div key={l} style={{ padding: '10px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
              <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{l}</div>
              <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {loading && <div style={{ color: 'var(--text3)', fontSize: 13, padding: '20px 0' }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          <div style={{ fontSize: 28, marginBottom: 10 }}>👥</div>
          {students.length === 0 ? 'No students yet. Upload a roster CSV or add manually.' : 'No students match your search.'}
        </div>
      )}

      {filtered.map(s => {
        const avg = s.averageScore ? parseInt(s.averageScore) : null;
        const avgColor = avg >= 85 ? 'var(--green)' : avg >= 70 ? 'var(--amber)' : avg !== null ? 'var(--red)' : 'var(--text3)';
        return (
          <div key={s.id} className="card card-hover" style={{ marginBottom: 6, padding: '12px 14px' }}
            onClick={() => setSelected(s)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {s.firstName} {s.lastName}
                  {s.nickname && <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 8 }}>"{s.nickname}"</span>}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  {s.email || 'No email'} · {s.assignmentsGraded} grade{s.assignmentsGraded !== 1 ? 's' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {/* Grade dots */}
                <div style={{ display: 'flex', gap: 3 }}>
                  {(s.grades || []).slice(0, 6).map((g, i) => {
                    const pct = parseFloat(g.total) / parseFloat(g.maxScore);
                    return <div key={i} title={`${g.assignmentName}: ${g.total}/${g.maxScore}`}
                      style={{ width: 10, height: 10, borderRadius: '50%',
                        background: pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)' }} />;
                  })}
                </div>
                {avg !== null ? (
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16, color: avgColor }}>{avg}%</span>
                ) : (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>No grades</span>
                )}
                <button className="danger" style={{ fontSize: 11, padding: '2px 8px' }}
                  onClick={e => { e.stopPropagation(); removeStudent(s.id, `${s.firstName} ${s.lastName}`); }}>
                  Remove
                </button>
              </div>
            </div>
            {s.notes && (
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4, fontStyle: 'italic' }}>{s.notes.slice(0, 80)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Student Record Page ──────────────────────────────────────────────────────

function StudentRecord({ student: initialStudent, course, password, onBack }) {
  const [student, setStudent] = useState(initialStudent);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ ...initialStudent });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const grades = student.grades || [];
  const avg = grades.length
    ? (grades.reduce((a, g) => a + parseFloat(g.total||0)/parseFloat(g.maxScore||1), 0) / grades.length * 100).toFixed(0)
    : null;
  const avgColor = avg >= 85 ? 'var(--green)' : avg >= 70 ? 'var(--amber)' : avg !== null ? 'var(--red)' : 'var(--text3)';

  async function saveRecord() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/students/${student.id}`, {
        method: 'PUT',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const updated = await r.json();
      setStudent({ ...student, ...updated });
      setSaved(true);
      setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Back + actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <button className="ghost" style={{ fontSize: 12 }} onClick={onBack}>← All students</button>
        <div style={{ display: 'flex', gap: 8 }}>
          {editing ? (
            <>
              <button className="primary" style={{ fontSize: 12 }} onClick={saveRecord} disabled={saving}>
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save'}
              </button>
              <button style={{ fontSize: 12 }} onClick={() => { setEditing(false); setForm({...student}); }}>Cancel</button>
            </>
          ) : (
            <button style={{ fontSize: 12 }} onClick={() => setEditing(true)}>Edit record</button>
          )}
        </div>
      </div>

      {/* Header */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            {editing ? (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>First name</label>
                  <input type="text" value={form.firstName || ''} onChange={e => setForm(f => ({...f, firstName: e.target.value}))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Last name</label>
                  <input type="text" value={form.lastName || ''} onChange={e => setForm(f => ({...f, lastName: e.target.value}))} />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Preferred name</label>
                  <input type="text" value={form.preferredName || ''} onChange={e => setForm(f => ({...f, preferredName: e.target.value}))}
                    placeholder="What they go by" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Nickname</label>
                  <input type="text" value={form.nickname || ''} onChange={e => setForm(f => ({...f, nickname: e.target.value}))}
                    placeholder="e.g. Chris, Lizzy" />
                </div>
                <div className="field" style={{ margin: 0, gridColumn: '1 / -1' }}>
                  <label>Email</label>
                  <input type="email" value={form.email || ''} onChange={e => setForm(f => ({...f, email: e.target.value}))} />
                </div>
              </div>
            ) : (
              <>
                <div style={{ fontSize: 22, fontWeight: 700 }}>
                  {student.firstName} {student.lastName}
                  {student.nickname && <span style={{ fontSize: 14, color: 'var(--text3)', marginLeft: 10 }}>"{student.nickname}"</span>}
                </div>
                {student.preferredName && student.preferredName !== student.firstName && (
                  <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>Goes by: {student.preferredName}</div>
                )}
                <div style={{ fontSize: 13, color: 'var(--text3)', marginTop: 4 }}>{student.email}</div>
              </>
            )}
          </div>
          {avg !== null && (
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 700, color: avgColor }}>{avg}%</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{grades.length} assignment{grades.length !== 1 ? 's' : ''}</div>
            </div>
          )}
        </div>

        {/* Notes */}
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <label>Notes about this student</label>
          {editing ? (
            <textarea rows={3} value={form.notes || ''} onChange={e => setForm(f => ({...f, notes: e.target.value}))}
              placeholder="Anything worth remembering — participation, context, circumstances, strengths…"
              style={{ fontSize: 13, lineHeight: 1.6 }} />
          ) : (
            student.notes ? (
              <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>{student.notes}</div>
            ) : (
              <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>
                No notes yet. Click Edit record to add notes.
              </div>
            )
          )}
        </div>
      </div>

      {/* Grade history */}
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>
        Grade History
        {grades.length > 0 && <span className="badge" style={{ marginLeft: 8 }}>{grades.length}</span>}
      </div>

      {grades.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No grades yet for {student.firstName}.
        </div>
      ) : (
        grades.map((g, i) => {
          const pct = parseFloat(g.total) / parseFloat(g.maxScore);
          const color = pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
          return (
            <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: g.key_improvement ? 6 : 0 }}>
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
                <div style={{ fontSize: 12, color: 'var(--text2)', padding: '5px 8px', background: 'var(--bg2)', borderRadius: 5, borderLeft: '3px solid var(--amber)' }}>
                  → {g.key_improvement}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
