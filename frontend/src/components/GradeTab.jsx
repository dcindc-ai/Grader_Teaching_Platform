import { useState, useEffect, useRef } from 'react';
import { getAssignments, getGrades, deleteGrade, downloadGrades, gradeBatch } from '../api.js';
import ReviewPanel from './ReviewPanel.jsx';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

function scoreColor(val, max) {
  const p = parseFloat(val) / max;
  return p >= 0.85 ? 'var(--green)' : p >= 0.6 ? 'var(--amber)' : 'var(--red)';
}

export default function GradeTab({ course, password, activeAssignmentId, queue, onQueue, results, onResults }) {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [grading, setGrading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [dbGrades, setDbGrades] = useState([]);
  const [reviewing, setReviewing] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (activeAssignmentId) setSelectedId(activeAssignmentId);
      else if (a.length) setSelectedId(a[0].id);
    });
  }, [course.id]);

  useEffect(() => {
    if (activeAssignmentId) setSelectedId(activeAssignmentId);
  }, [activeAssignmentId]);

  useEffect(() => {
    if (selectedId) getGrades(course.id, selectedId, password).then(setDbGrades);
  }, [selectedId]);

  const assignment = assignments.find(a => a.id === selectedId);

  // Merge DB grades with in-session results (in-session take priority, avoid dupes)
  const sessionGrades = (results || []).filter(g => g.assignmentId === selectedId);
  const sessionIds = new Set(sessionGrades.map(g => g.id));
  const allGrades = [...sessionGrades, ...dbGrades.filter(g => !sessionIds.has(g.id))];

  function addFiles(files) {
    const pdfs = Array.from(files).filter(f => f.name.endsWith('.pdf'));
    if (!pdfs.length) return;
    onQueue(q => {
      const existing = new Set(q.map(x => x.name));
      return [...q, ...pdfs.filter(f => !existing.has(f.name)).map(f => ({
        file: f, name: f.name, status: 'pending'
      }))];
    });
  }

  async function runGrading() {
    const pending = queue.filter(x => x.status === 'pending');
    if (!pending.length || grading || !selectedId) return;
    setGrading(true);
    setProgress({ done: 0, total: pending.length });
    pending.forEach(x => onQueue(q => q.map(i => i.name === x.name ? { ...i, status: 'grading' } : i)));

    try {
      await gradeBatch(pending.map(x => x.file), selectedId, course.id, password, (evt) => {
        if (evt.type === 'result' || evt.type === 'error') {
          onQueue(q => q.map(i => i.name === evt.file ? { ...i, status: evt.type === 'result' ? 'done' : 'error' } : i));
          setProgress(p => ({ ...p, done: evt.index + 1 }));
          if (evt.grade) onResults(r => [evt.grade, ...r]);
        }
      });
    } catch (e) { alert('Error: ' + e.message); }
    setGrading(false);
  }

  const pending = queue.filter(x => x.status === 'pending');
  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
  const avg = allGrades.length
    ? (allGrades.reduce((a, g) => a + parseFloat(g.total || 0), 0) / allGrades.length).toFixed(2) : null;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Grade</div>
          <div className="page-sub">Upload submissions · Review feedback · Copy to Canvas</div>
        </div>
        <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
          style={{ fontSize: 13, fontWeight: 500, width: 160 }}>
          {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="two-col">
        {/* Upload panel */}
        <div>
          <div className={`drop-zone${drag ? ' drag' : ''}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}>
            <p>Drop student PDFs here or click to browse</p>
            <small>Multiple files · Max 25MB each</small>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
            onChange={e => addFiles(e.target.files)} />

          {queue.length > 0 && (
            <div style={{ marginBottom: 10, marginTop: 8 }}>
              {queue.map((q, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '5px 10px', background: '#fff', border: '1px solid var(--border)',
                  borderRadius: 6, marginBottom: 3, fontSize: 12
                }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{q.name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge status-${q.status}`} style={{ fontSize: 11 }}>
                      {q.status === 'grading' ? 'grading…' : q.status}
                    </span>
                    {q.status === 'pending' && (
                      <button style={{ padding: '1px 6px', fontSize: 11 }}
                        onClick={() => onQueue(q2 => q2.filter((_, j) => j !== i))}>×</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <>
              <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600 }}
                onClick={runGrading} disabled={grading || !selectedId}>
                {grading ? `Grading ${progress.done} / ${progress.total}…` : `Grade ${pending.length} submission${pending.length !== 1 ? 's' : ''}`}
              </button>
              {grading && <div className="progress-bar" style={{ marginTop: 8 }}><div className="progress-fill" style={{ width: `${pct}%` }} /></div>}
            </>
          )}

          {queue.some(x => x.status !== 'pending') && (
            <button className="ghost" style={{ width: '100%', marginTop: 6, fontSize: 12 }}
              onClick={() => onQueue(q => q.filter(x => x.status === 'pending'))}>
              Clear completed
            </button>
          )}
        </div>

        {/* Results panel */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>
              {assignment?.name || 'Results'}
              {allGrades.length > 0 && <span className="badge" style={{ marginLeft: 8 }}>{allGrades.length}</span>}
            </div>
            {allGrades.length > 0 && (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button style={{ fontSize: 12 }} onClick={() => downloadGrades(course.id, selectedId, password)}>↓ ZIP</button>
                <button style={{ fontSize: 12 }} onClick={() => {
                  window.open(`${BASE}/api/grade/canvas-csv?courseId=${course.id}&assignmentId=${selectedId}&password=${encodeURIComponent(password)}`, '_blank');
                }}>↓ Canvas CSV</button>
                <button style={{ fontSize: 12, fontWeight: 500, background: 'rgba(37,99,235,0.08)', color: 'var(--accent)', borderColor: 'rgba(37,99,235,0.2)' }}
                  onClick={() => window.open(`${BASE}/api/classreport/${selectedId}/pdf?password=${encodeURIComponent(password)}`, '_blank')}>
                  📋 Class Report
                </button>
                <button style={{ fontSize: 12, fontWeight: 500, background: 'rgba(22,163,74,0.08)', color: 'var(--green)', borderColor: 'rgba(22,163,74,0.2)' }}
                  onClick={() => window.open(`${BASE}/api/classreport/${selectedId}/pptx?password=${encodeURIComponent(password)}`, '_blank')}>
                  📊 Class Slides
                </button>
                <button className="danger" style={{ fontSize: 12 }} onClick={async () => {
                  if (!confirm('Clear all results for this assignment?')) return;
                  for (const g of allGrades) await deleteGrade(g.id, password);
                  onResults(r => r.filter(x => x.assignmentId !== selectedId));
                  setDbGrades([]);
                }}>Clear</button>
              </div>
            )}
          </div>

          {avg && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6, marginBottom: 12 }}>
              {[
                ['Avg', `${avg}/${assignment?.maxScore || 6}`],
                ['High', Math.max(...allGrades.map(g => parseFloat(g.total)))],
                ['Low', Math.min(...allGrades.map(g => parseFloat(g.total)))],
                ['Count', allGrades.length]
              ].map(([l, v]) => (
                <div key={l} style={{ padding: '8px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{l}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16 }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {allGrades.length === 0 && (
            <div style={{ fontSize: 13, color: 'var(--text3)', padding: '24px 0', textAlign: 'center' }}>
              No results yet for {assignment?.name || 'this assignment'}.
            </div>
          )}

          {allGrades.map(g => (
            <div key={g.id} className="card card-hover" style={{ marginBottom: 6, padding: '12px 14px' }}
              onClick={() => setReviewing(g)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{g.studentName || 'Unknown'}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{g.fileName}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {g.instructor_paragraph && <span style={{ fontSize: 11, color: 'var(--accent)' }}>✓ feedback ready</span>}
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 700, color: scoreColor(parseFloat(g.total), parseFloat(g.maxScore) || 6) }}>
                    {g.total}<span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text2)' }}>/{g.maxScore}</span>
                  </span>
                </div>
              </div>
              {g.key_improvement && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  → {g.key_improvement}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--accent)' }}>Click to review and copy feedback →</span>
                <button className="danger" style={{ fontSize: 11, padding: '1px 8px' }}
                  onClick={async e => {
                    e.stopPropagation();
                    if (!confirm(`Delete grade for ${g.studentName || 'this student'}?`)) return;
                    await deleteGrade(g.id, password);
                    onResults(r => r.filter(x => x.id !== g.id));
                    setDbGrades(dg => dg.filter(x => x.id !== g.id));
                  }}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {reviewing && (
        <ReviewPanel
          grade={reviewing}
          password={password}
          onClose={() => setReviewing(null)}
          onDelete={async () => {
            await deleteGrade(reviewing.id, password);
            onResults(r => r.filter(x => x.id !== reviewing.id));
            setDbGrades(g => g.filter(x => x.id !== reviewing.id));
            setReviewing(null);
          }}
        />
      )}
    </div>
  );
}
