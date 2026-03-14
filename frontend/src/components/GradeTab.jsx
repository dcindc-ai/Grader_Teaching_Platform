import { useState, useEffect, useRef } from 'react';
import { getAssignments, getGrades, deleteGrade, downloadGrades, gradeBatch } from '../api.js';

const SECTION_LABELS = { annotated_product:'Annotated Product', narrative:'Narrative', context:'Context', overall_quality:'Overall Quality' };
const SECTION_MAX = { annotated_product:2, narrative:2, context:1, overall_quality:1 };

function scoreColor(val, max) {
  const p = val / max;
  return p >= 0.85 ? 'var(--green)' : p >= 0.6 ? 'var(--amber)' : 'var(--red)';
}

export default function GradeTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [queue, setQueue] = useState([]);
  const [grading, setGrading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [grades, setGrades] = useState([]);
  const [expanded, setExpanded] = useState(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setSelectedId(a[0].id);
    });
  }, [course.id]);

  useEffect(() => {
    if (selectedId) getGrades(course.id, selectedId, password).then(setGrades);
  }, [selectedId]);

  const assignment = assignments.find(a => a.id === selectedId);

  function addFiles(files) {
    const pdfs = Array.from(files).filter(f => f.name.endsWith('.pdf'));
    if (!pdfs.length) return;
    setQueue(q => {
      const existing = new Set(q.map(x => x.name));
      return [...q, ...pdfs.filter(f => !existing.has(f.name)).map(f => ({ file: f, name: f.name, status: 'pending' }))];
    });
  }

  async function runGrading() {
    const pending = queue.filter(x => x.status === 'pending');
    if (!pending.length || grading || !selectedId) return;
    setGrading(true);
    setProgress({ done: 0, total: pending.length });
    pending.forEach(x => setQueue(q => q.map(i => i.name === x.name ? { ...i, status: 'grading' } : i)));

    try {
      await gradeBatch(pending.map(x => x.file), selectedId, course.id, password, (evt) => {
        if (evt.type === 'result' || evt.type === 'error') {
          setQueue(q => q.map(i => i.name === evt.file ? { ...i, status: evt.type === 'result' ? 'done' : 'error' } : i));
          setProgress(p => ({ ...p, done: evt.index + 1 }));
          if (evt.grade) setGrades(g => [evt.grade, ...g]);
        }
      });
    } catch (e) { alert('Error: ' + e.message); }
    setGrading(false);
  }

  const pending = queue.filter(x => x.status === 'pending');
  const pct = progress.total ? Math.round(progress.done / progress.total * 100) : 0;
  const assignGrades = grades.filter(g => g.assignmentId === selectedId);

  const avg = assignGrades.length
    ? (assignGrades.reduce((a,g) => a + parseFloat(g.total||0), 0) / assignGrades.length).toFixed(2)
    : null;

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Grade</div>
          <div className="page-sub">Bulk upload and grade student submissions</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)} style={{ width: 160 }}>
            {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="two-col">
        {/* Upload panel */}
        <div>
          <div
            className={`drop-zone${drag ? ' drag' : ''}`}
            onClick={() => fileRef.current.click()}
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
          >
            <p>Drop PDFs here or click to browse</p>
            <small>Multiple files accepted · Max 25MB each</small>
          </div>
          <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }} onChange={e => addFiles(e.target.files)} />

          {queue.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              {queue.map(q => (
                <div key={q.name} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 3, fontSize: 12 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>{q.name}</span>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <span className={`badge status-${q.status}`}>{q.status === 'grading' ? 'grading…' : q.status}</span>
                    {q.status === 'pending' && <button style={{ padding: '1px 6px', fontSize: 11 }} onClick={() => setQueue(q2 => q2.filter(x => x.name !== q.name))}>×</button>}
                  </div>
                </div>
              ))}
            </div>
          )}

          {pending.length > 0 && (
            <>
              <button className="primary" style={{ width: '100%', padding: 10, fontSize: 14 }} onClick={runGrading} disabled={grading || !selectedId}>
                {grading ? `Grading ${progress.done} / ${progress.total}…` : `Grade ${pending.length} submission${pending.length !== 1 ? 's' : ''}`}
              </button>
              {grading && <div className="progress-bar" style={{ marginTop: 8 }}><div className="progress-fill" style={{ width: `${pct}%` }} /></div>}
            </>
          )}

          {queue.some(x => x.status !== 'pending') && (
            <button className="ghost" style={{ marginTop: 8, fontSize: 12, width: '100%' }} onClick={() => setQueue(q => q.filter(x => x.status === 'pending'))}>
              Clear completed
            </button>
          )}
        </div>

        {/* Results panel */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 500 }}>
              {assignment?.name || 'Results'}
              {assignGrades.length > 0 && <span className="badge" style={{ marginLeft: 8 }}>{assignGrades.length}</span>}
            </div>
            {assignGrades.length > 0 && (
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ fontSize: 12 }} onClick={() => downloadGrades(course.id, selectedId, password)}>↓ ZIP</button>
                <button className="danger" style={{ fontSize: 12 }} onClick={async () => {
                  if (!confirm('Clear all results for this assignment?')) return;
                  for (const g of assignGrades) await deleteGrade(g.id, password);
                  setGrades(g => g.filter(x => x.assignmentId !== selectedId));
                }}>Clear</button>
              </div>
            )}
          </div>

          {avg && (
            <div className="four-col" style={{ marginBottom: 12 }}>
              {[['Avg', `${avg}/${assignment?.maxScore||6}`], ['High', `${Math.max(...assignGrades.map(g=>parseFloat(g.total)))}/${assignment?.maxScore||6}`], ['Low', `${Math.min(...assignGrades.map(g=>parseFloat(g.total)))}/${assignment?.maxScore||6}`], ['Count', assignGrades.length]].map(([l,v]) => (
                <div key={l} style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6 }}>
                  <div className="sec-label" style={{ margin: 0, marginBottom: 2 }}>{l}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{v}</div>
                </div>
              ))}
            </div>
          )}

          {assignGrades.length === 0 && <div style={{ fontSize: 13, color: 'var(--text3)', padding: '20px 0' }}>No results yet.</div>}

          {assignGrades.map(g => (
            <GradeCard
              key={g.id}
              grade={g}
              expanded={expanded === g.id}
              onToggle={() => setExpanded(expanded === g.id ? null : g.id)}
              onDelete={async () => { await deleteGrade(g.id, password); setGrades(gs => gs.filter(x => x.id !== g.id)); }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function GradeCard({ grade, expanded, onToggle, onDelete }) {
  const s = grade.scores || {};
  const total = parseFloat(grade.total) || 0;
  const max = parseFloat(grade.maxScore) || 6;
  return (
    <div className="card card-hover" style={{ marginBottom: 6 }} onClick={onToggle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontWeight: 500 }}>{grade.studentName || 'Unknown'}</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>{grade.fileName}</div>
        </div>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 600, color: scoreColor(total, max) }}>
          {grade.total}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text2)' }}>/{max}</span>
        </span>
      </div>

      {expanded && (
        <div onClick={e => e.stopPropagation()} style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          <div className="four-col" style={{ marginBottom: 10 }}>
            {Object.entries(SECTION_MAX).map(([k, mx]) => (
              <div key={k} style={{ padding: '6px 8px', background: 'var(--bg3)', borderRadius: 6 }}>
                <div className="sec-label" style={{ margin: 0, marginBottom: 2 }}>{SECTION_LABELS[k]}</div>
                <div style={{ fontFamily: 'var(--mono)', fontWeight: 500, color: scoreColor(parseFloat(s[k])||0, mx) }}>
                  {s[k]}<span style={{ fontSize: 11, color: 'var(--text2)' }}>/{mx}</span>
                </div>
              </div>
            ))}
          </div>

          {grade.summary && <div style={{ fontSize: 13, color: 'var(--text2)', fontStyle: 'italic', lineHeight: 1.6, marginBottom: 10 }}>{grade.summary}</div>}
          {grade.key_strength && <div className="pill-green" style={{ display: 'block', marginBottom: 4, padding: '4px 12px' }}>+ {grade.key_strength}</div>}
          {grade.key_improvement && <div className="pill-red" style={{ display: 'block', marginBottom: 10, padding: '4px 12px' }}>→ {grade.key_improvement}</div>}

          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const comments = grade.comments?.[key] || [];
            if (!comments.length) return null;
            return (
              <div key={key} style={{ marginBottom: 8 }}>
                <div className="sec-label">{label}</div>
                {comments.map((c, i) => (
                  <div key={i}>
                    <div className={c.type === 'positive' ? 'comment-pos' : 'comment-neg'}>
                      {c.type === 'positive' ? '+ ' : '✗ '}{c.text}
                    </div>
                    {c.rewrite && <div className="comment-rewrite">↳ {c.rewrite.replace(/^Suggested rewrite:\s*/i,'')}</div>}
                  </div>
                ))}
              </div>
            );
          })}

          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="danger" style={{ fontSize: 12 }} onClick={onDelete}>Delete</button>
            <span style={{ fontSize: 11, color: 'var(--text3)' }}>{new Date(grade.gradedAt).toLocaleDateString()}</span>
          </div>
        </div>
      )}
    </div>
  );
}
