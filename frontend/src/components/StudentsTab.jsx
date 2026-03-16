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

      // Parse header — handle quoted fields
      function parseCSVLine(line) {
        const cols = [];
        let cur = '', inQuote = false;
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === '"') { inQuote = !inQuote; continue; }
          if (ch === ',' && !inQuote) { cols.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        cols.push(cur.trim());
        return cols;
      }

      const header = parseCSVLine(lines[0]).map(h => h.toLowerCase().replace(/"/g, ''));
      const nameIdx  = header.findIndex(h => h.includes('student') || h === 'name');
      const emailIdx = header.findIndex(h => h.includes('email') || h.includes('login'));

      const parsed = lines.slice(1)
        .map(line => {
          const cols = parseCSVLine(line);
          let rawName = cols[nameIdx >= 0 ? nameIdx : 0] || '';

          // Canvas format: "Last, First" — flip to "First Last"
          let name = rawName;
          if (rawName.includes(',')) {
            const [last, ...firstParts] = rawName.split(',').map(s => s.trim());
            const first = firstParts.join(' ').trim();
            name = first ? `${first} ${last}` : last;
          }

          const email = cols[emailIdx >= 0 ? emailIdx : -1] || '';
          return { name, email };
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
  const [generatingInsight, setGeneratingInsight] = useState(false);

  const grades = student.grades || [];
  const avg = student.averageScore ? parseInt(student.averageScore) : null;
  const avgColor = avg >= 85 ? 'var(--green)' : avg >= 70 ? 'var(--amber)' : avg !== null ? 'var(--red)' : 'var(--text3)';

  const spi = student.spi;
  const spiColor = spi >= 75 ? 'var(--green)' : spi >= 60 ? 'var(--amber)' : spi !== null ? 'var(--red)' : 'var(--text3)';
  const spiLabel = spi >= 75 ? 'On track' : spi >= 60 ? 'Needs attention' : spi !== null ? 'At risk' : '';

  const trajColor = student.trajectory === 'improving' ? 'var(--green)' : student.trajectory === 'declining' ? 'var(--red)' : 'var(--text3)';
  const trajIcon = student.trajectory === 'improving' ? '↑' : student.trajectory === 'declining' ? '↓' : '→';

  async function saveRecord() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/students/${student.id}`, {
        method: 'PUT',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const updated = await r.json();
      setStudent(s => ({ ...s, ...updated }));
      setSaved(true); setEditing(false);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  async function generateInsight() {
    setGeneratingInsight(true);
    try {
      const r = await fetch(`${BASE}/api/students/${student.id}/insight`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id })
      });
      const d = await r.json();
      if (d.insight) setStudent(s => ({ ...s, notes: d.insight + (s.notes ? ['','','---',''].join('\n') + s.notes : '') }));
    } catch (e) { alert(e.message); }
    setGeneratingInsight(false);
  }

  return (
    <div style={{ maxWidth: 720 }}>
      {/* Nav */}
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

      {/* Header card */}
      <div className="card" style={{ marginBottom: 14 }}>
        {editing ? (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[['First name','firstName'],['Last name','lastName'],['Preferred name','preferredName'],['Nickname','nickname'],['Email','email']].map(([label, key]) => (
              <div key={key} className="field" style={{ margin: 0, gridColumn: key === 'email' ? '1 / -1' : undefined }}>
                <label>{label}</label>
                <input type={key === 'email' ? 'email' : 'text'} value={form[key] || ''}
                  onChange={e => setForm(f => ({...f, [key]: e.target.value}))} />
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 22, fontWeight: 700 }}>
                {student.firstName} {student.lastName}
                {student.nickname && <span style={{ fontSize: 13, color: 'var(--text3)', marginLeft: 8 }}>"{student.nickname}"</span>}
              </div>
              {student.preferredName && student.preferredName !== student.firstName && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>Goes by: {student.preferredName}</div>
              )}
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>{student.email}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              {avg !== null && (
                <div style={{ fontFamily: 'var(--mono)', fontSize: 30, fontWeight: 700, color: avgColor }}>{avg}%</div>
              )}
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{grades.length} assignment{grades.length !== 1 ? 's' : ''}</div>
            </div>
          </div>
        )}

        {/* SPI Dashboard */}
        {grades.length > 0 && (
          <div style={{ padding: '12px 14px', background: 'var(--bg2)', borderRadius: 8, marginBottom: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', marginBottom: 10 }}>
              Student Progress Index
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
              {/* SPI composite */}
              <div style={{ padding: '10px', background: '#fff', borderRadius: 8, border: `2px solid ${spiColor}`, textAlign: 'center', gridColumn: '1' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>SPI</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: spiColor }}>{spi ?? '—'}</div>
                <div style={{ fontSize: 10, color: spiColor, fontWeight: 600 }}>{spiLabel}</div>
              </div>
              {/* Weighted grade */}
              <div style={{ padding: '10px', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>Avg grade</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: avgColor }}>{avg ?? '—'}%</div>
                <div style={{ fontSize: 10, color: 'var(--text3)' }}>50% weight</div>
              </div>
              {/* Trajectory */}
              <div style={{ padding: '10px', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>Trajectory</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: trajColor }}>{trajIcon}</div>
                <div style={{ fontSize: 10, color: trajColor, fontWeight: 600 }}>{student.trajectory || 'n/a'}</div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>30% weight</div>
              </div>
              {/* Concept application */}
              <div style={{ padding: '10px', background: '#fff', borderRadius: 8, border: '1px solid var(--border)', textAlign: 'center' }}>
                <div style={{ fontSize: 9, color: 'var(--text3)', textTransform: 'uppercase', marginBottom: 4 }}>Concept rate</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700,
                  color: (student.conceptApplicationRate||0) >= 80 ? 'var(--green)' : (student.conceptApplicationRate||0) >= 65 ? 'var(--amber)' : 'var(--red)' }}>
                  {student.conceptApplicationRate ?? '—'}{student.conceptApplicationRate != null ? '%' : ''}
                </div>
                <div style={{ fontSize: 9, color: 'var(--text3)' }}>20% weight</div>
              </div>
            </div>

            {/* SPI explanation */}
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text3)', lineHeight: 1.6 }}>
              SPI combines weighted grade (50%), trajectory direction (30%), and concept application rate (20%).
              {spi >= 75 && ' This student is on track.'}
              {spi >= 60 && spi < 75 && ' Watch this student — consistent improvement needed.'}
              {spi !== null && spi < 60 && ' Consider reaching out. Pattern suggests intervention may help.'}
            </div>
          </div>
        )}

        {/* Notes + AI insight */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ margin: 0 }}>Instructor notes</label>
            <button style={{ fontSize: 11, padding: '2px 8px' }}
              onClick={generateInsight} disabled={generatingInsight || grades.length === 0}>
              {generatingInsight ? 'Generating…' : '✦ Generate AI insight'}
            </button>
          </div>
          {editing ? (
            <textarea rows={4} value={form.notes || ''}
              onChange={e => setForm(f => ({...f, notes: e.target.value}))}
              placeholder="Anything worth remembering about this student…"
              style={{ fontSize: 13, lineHeight: 1.6 }} />
          ) : student.notes ? (
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7, whiteSpace: 'pre-wrap',
              padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6 }}>
              {student.notes}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)', fontStyle: 'italic' }}>
              No notes yet. Click Edit record to add notes, or Generate AI insight to create one from grades.
            </div>
          )}
        </div>
      </div>

      {/* Grade history */}
      <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 10 }}>
        Grade History {grades.length > 0 && <span className="badge" style={{ marginLeft: 8 }}>{grades.length}</span>}
      </div>

      {grades.length === 0 ? (
        <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No grades yet for {student.firstName}.
        </div>
      ) : grades.map((g, i) => {
        const pct = parseFloat(g.total) / parseFloat(g.maxScore);
        const color = pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
        const scores = g.scores || {};
        return (
          <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
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
            {/* Per-criterion mini bars */}
            {Object.keys(scores).filter(k => k !== 'total').length > 0 && (
              <div style={{ display: 'flex', gap: 4, marginBottom: 6, flexWrap: 'wrap' }}>
                {Object.entries(scores).filter(([k]) => k !== 'total').map(([k, v]) => {
                  const sMax = 2; // default section max
                  const sp = parseFloat(v) / sMax;
                  const sc = sp >= 0.85 ? 'var(--green)' : sp >= 0.6 ? 'var(--amber)' : 'var(--red)';
                  return (
                    <div key={k} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 4,
                      background: `${sc}18`, color: sc, border: `1px solid ${sc}40`, fontWeight: 600 }}>
                      {k.replace(/_/g,' ')}: {v}
                    </div>
                  );
                })}
              </div>
            )}
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
  );
}
