import { useState, useEffect, useRef } from 'react';
import { getStudents, getProgress, uploadRoster, addStudent, deleteStudent } from '../api.js';

export default function StudentsTab({ course, password }) {
  const [students, setStudents] = useState([]);
  const [progress, setProgress] = useState([]);
  const [view, setView] = useState('roster'); // 'roster' | 'progress'
  const [selected, setSelected] = useState(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    getStudents(course.id, password).then(setStudents);
    getProgress(course.id, password).then(setProgress);
  }, [course.id]);

  async function handleRosterCSV(file) {
    setUploading(true);
    setUploadResult(null);
    try {
      const text = await file.text();
      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
      const nameIdx = headers.findIndex(h => h.includes('name'));
      const emailIdx = headers.findIndex(h => h.includes('email'));
      if (nameIdx === -1) { alert('CSV must have a Name column.'); setUploading(false); return; }

      const parsed = lines.slice(1).map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
        return { name: cols[nameIdx] || '', email: emailIdx >= 0 ? cols[emailIdx] : '' };
      }).filter(s => s.name);

      const result = await uploadRoster(course.id, parsed, password);
      // Reload full student list after upload
      const updated = await getStudents(course.id, password);
      setStudents(updated);
      setUploadResult(result);
      getProgress(course.id, password).then(setProgress);
    } catch (e) { alert('Error reading CSV: ' + e.message); }
    setUploading(false);
  }

  async function handleAddSingle() {
    if (!newName.trim()) return;
    const s = await addStudent({ courseId: course.id, name: newName.trim(), email: newEmail.trim() }, password);
    setStudents(st => [...st, s]);
    setProgress(p => [...p, { ...s, assignmentsGraded: 0, averageScore: null, grades: [] }]);
    setNewName(''); setNewEmail(''); setAdding(false);
  }

  async function handleDelete(id) {
    await deleteStudent(id, password);
    setStudents(s => s.filter(x => x.id !== id));
    setProgress(p => p.filter(x => x.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const sel = selected ? progress.find(p => p.id === selected.id) : null;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="page-title">Students</div>
          <div className="page-sub">{students.length} students enrolled in {course.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={e => e.target.files[0] && handleRosterCSV(e.target.files[0])} />
          <button style={{ fontSize: 12 }} onClick={() => fileRef.current.click()} disabled={uploading}>
            {uploading ? 'Uploading…' : '↑ Upload roster CSV'}
          </button>
          <button style={{ fontSize: 12 }} onClick={() => setAdding(a => !a)}>{adding ? 'Cancel' : '+ Add student'}</button>
        </div>
      </div>

      {uploadResult && (
        <div style={{ marginBottom: 12, padding: '8px 12px', background: 'rgba(76,175,114,0.08)', border: '1px solid var(--green)', borderRadius: 8, fontSize: 12, color: 'var(--green)' }}>
          Added {uploadResult.added} students.{uploadResult.skipped > 0 ? ` ${uploadResult.skipped} skipped (already enrolled).` : ''}{uploadResult.matched > 0 ? ` Matched ${uploadResult.matched} existing grade${uploadResult.matched !== 1 ? 's' : ''} to roster.` : ''}
        </div>
      )}

      {adding && (
        <div className="card" style={{ marginBottom: 12, display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label>Name</label>
            <input type="text" value={newName} onChange={e => setNewName(e.target.value)} placeholder="Full name" onKeyDown={e => e.key === 'Enter' && handleAddSingle()} />
          </div>
          <div className="field" style={{ flex: 1, margin: 0 }}>
            <label>Email (optional)</label>
            <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="student@university.edu" />
          </div>
          <button className="primary" onClick={handleAddSingle} style={{ height: 36, flexShrink: 0 }}>Add</button>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['roster','Roster'],['progress','Progress']].map(([k,l]) => (
          <button key={k} onClick={() => setView(k)} style={{ padding: '7px 16px', fontSize: 13, background: view===k?'var(--bg4)':'var(--bg3)', color: view===k?'var(--text)':'var(--text2)', border: `1px solid ${view===k?'var(--border2)':'var(--border)'}`, fontWeight: view===k?500:400 }}>{l}</button>
        ))}
      </div>

      {view === 'roster' && (
        <div>
          {students.length === 0 && (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 8 }}>
              No students enrolled yet. Upload a roster CSV or add students individually.
            </div>
          )}
          {students.map(s => {
            const prog = progress.find(p => p.id === s.id);
            return (
              <div key={s.id} className="card card-hover" style={{ marginBottom: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onClick={() => { setSelected(s); setView('progress'); }}>
                <div>
                  <div style={{ fontWeight: 500 }}>{s.name}</div>
                  {s.email && <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.email}</div>}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {prog?.averageScore && (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500 }}>{prog.averageScore} avg</span>
                  )}
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{prog?.assignmentsGraded || 0} graded</span>
                  <button className="danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={e => { e.stopPropagation(); handleDelete(s.id); }}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'progress' && (
        <div className="two-col" style={{ alignItems: 'start' }}>
          {/* Student list */}
          <div>
            {progress.map(p => (
              <div key={p.id} className="card card-hover" style={{ marginBottom: 5, borderColor: selected?.id === p.id ? course.color : undefined }}
                onClick={() => setSelected(p)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: selected?.id === p.id ? 500 : 400 }}>{p.name}</span>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {p.averageScore && <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 500 }}>{p.averageScore}</span>}
                    <span className="badge">{p.assignmentsGraded}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Student detail */}
          {sel ? (
            <div>
              <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 4 }}>{sel.name}</div>
              {sel.email && <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 12 }}>{sel.email}</div>}

              <div className="three-col" style={{ marginBottom: 16 }}>
                {[['Assignments graded', sel.assignmentsGraded], ['Average score', sel.averageScore || '—'], ['Enrolled', new Date(sel.createdAt).toLocaleDateString()]].map(([l,v]) => (
                  <div key={l} style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6 }}>
                    <div className="sec-label" style={{ margin: 0, marginBottom: 2 }}>{l}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{v}</div>
                  </div>
                ))}
              </div>

              {sel.grades?.length > 0 && (
                <>
                  <div className="sec-label">Grade history</div>
                  {sel.grades.map(g => (
                    <div key={g.id} className="card" style={{ marginBottom: 5 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <div style={{ fontWeight: 500, fontSize: 13 }}>{g.assignmentName}</div>
                          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(g.gradedAt).toLocaleDateString()}</div>
                        </div>
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{g.total}/{g.maxScore}</span>
                      </div>
                      {g.key_improvement && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>→ {g.key_improvement}</div>}
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '20px 0' }}>Select a student to see their progress.</div>
          )}
        </div>
      )}
    </div>
  );
}
