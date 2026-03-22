import { useState, useEffect, useCallback } from 'react';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const STATUS_COLORS = {
  pending:  { color: 'var(--text3)', bg: 'var(--bg2)', label: 'Pending' },
  grading:  { color: '#d97706',      bg: 'rgba(217,119,6,0.08)', label: '⏳ Grading…' },
  graded:   { color: '#2563eb',      bg: 'rgba(37,99,235,0.08)', label: 'Ready to review' },
  approved: { color: 'var(--green)', bg: 'rgba(22,163,74,0.08)', label: '✓ Approved' },
  error:    { color: 'var(--red)',   bg: 'rgba(220,38,38,0.08)', label: '✗ Error' },
};

export default function BatchGradeTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [starting, setStarting] = useState(false);
  const [selected, setSelected] = useState(null);
  const [adjustedGrades, setAdjustedGrades] = useState({});
  const [message, setMessage] = useState('');
  const [gradingAll, setGradingAll] = useState(false);
  const [gradingProgress, setGradingProgress] = useState(0);

  // Grading presets
  const [tone, setTone] = useState('plain-warm');
  const [sentences, setSentences] = useState(3);
  const [commentMode, setCommentMode] = useState('imperfect');
  const [feedbackStyle, setFeedbackStyle] = useState('balanced');
  const [showPresets, setShowPresets] = useState(false);

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setAssignmentId(a[0].id);
    });
  }, [course.id]);

  const loadRecords = useCallback(async (aId) => {
    if (!aId) return;
    setLoading(true);
    const r = await fetch(`${BASE}/api/batchgrade?courseId=${course.id}&assignmentId=${aId}`);
    if (r.ok) setRecords(await r.json());
    setLoading(false);
  }, [course.id]);

  useEffect(() => { loadRecords(assignmentId); }, [assignmentId, loadRecords]);

  async function pullSubmissions() {
    setStarting(true); setMessage('');
    const r = await fetch(`${BASE}/api/batchgrade/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId: course.id, assignmentId })
    });
    const d = await r.json();
    if (!r.ok) { setMessage('Error: ' + d.error); setStarting(false); return; }
    setMessage(d.message);
    setStarting(false);
    loadRecords(assignmentId);
  }

  async function gradeOne(record) {
    setRecords(rs => rs.map(r => r.id === record.id ? { ...r, status: 'grading' } : r));
    const resp = await fetch(`${BASE}/api/batchgrade/grade-one`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: record.id, tone, sentences, commentMode, feedbackStyle })
    });
    const data = await resp.json();
    setRecords(rs => rs.map(r => r.id === record.id
      ? { ...r, status: data.error ? 'error' : 'graded', criteriaGrades: data.criteriaGrades || r.criteriaGrades,
          instructor_paragraph: data.instructorParagraph || r.instructor_paragraph,
          total_points: data.totalPoints || r.total_points, error: data.error }
      : r));
  }

  async function gradeAll() {
    const pending = records.filter(r => r.status === 'pending' || r.status === 'error');
    if (!pending.length) return;
    setGradingAll(true);
    setGradingProgress(0);
    for (let i = 0; i < pending.length; i++) {
      await gradeOne(pending[i]);
      setGradingProgress(Math.round(((i + 1) / pending.length) * 100));
      // Small delay to avoid rate limits
      if (i < pending.length - 1) await new Promise(r => setTimeout(r, 1000));
    }
    setGradingAll(false);
    loadRecords(assignmentId);
  }

  async function approveGrade(record) {
    const grades = record.criteriaGrades?.map(cg => ({
      ...cg,
      suggestedPoints: adjustedGrades[record.id]?.[cg.criterionName] ?? cg.suggestedPoints
    }));
    const r = await fetch(`${BASE}/api/batchgrade/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: record.id, adjustedGrades: grades })
    });
    if (r.ok) {
      setRecords(rs => rs.map(x => x.id === record.id ? { ...x, status: 'approved' } : x));
      if (selected?.id === record.id) setSelected({ ...record, status: 'approved' });
    }
  }

  async function deleteRecord(id) {
    await fetch(`${BASE}/api/batchgrade/${id}`, { method: 'DELETE' });
    setRecords(rs => rs.filter(r => r.id !== id));
    if (selected?.id === id) setSelected(null);
  }

  const accent = course.color || '#1a4fbf';
  const pending = records.filter(r => r.status === 'pending').length;
  const graded = records.filter(r => r.status === 'graded').length;
  const approved = records.filter(r => r.status === 'approved').length;
  const assignment = assignments.find(a => a.id === assignmentId);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 0, height: 'calc(100vh - 120px)' }}>

      {/* Left — student list */}
      <div style={{ borderRight: '1px solid var(--border)', overflowY: 'auto', padding: '16px 12px' }}>
        <div style={{ marginBottom: 12 }}>
          <select value={assignmentId} onChange={e => { setAssignmentId(e.target.value); setSelected(null); }}
            style={{ width: '100%', fontSize: 12, padding: '6px 8px', borderRadius: 6, border: '1px solid var(--border)', marginBottom: 8 }}>
            {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>

          {/* Preset settings toggle */}
          <button onClick={() => setShowPresets(p => !p)}
            style={{ width: '100%', fontSize: 11, padding: '4px 8px', marginBottom: 6, background: showPresets ? accent + '15' : 'var(--bg2)',
              border: `1px solid ${showPresets ? accent : 'var(--border)'}`, borderRadius: 6, cursor: 'pointer',
              color: showPresets ? accent : 'var(--text2)', fontWeight: showPresets ? 600 : 400, textAlign: 'left' }}>
            ⚙ Grading presets {showPresets ? '▲' : '▼'}
          </button>

          {showPresets && (
            <div style={{ padding: '10px 10px', background: 'var(--bg2)', borderRadius: 8, marginBottom: 8, fontSize: 11 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                <div>
                  <div style={{ color: 'var(--text3)', marginBottom: 3 }}>Tone</div>
                  <select value={tone} onChange={e => setTone(e.target.value)}
                    style={{ width: '100%', fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <option value="plain-warm">Plain + warm</option>
                    <option value="plain">Plain English</option>
                    <option value="conversational">Conversational</option>
                    <option value="encouraging">Encouraging</option>
                    <option value="coach">Coach</option>
                    <option value="formal">Formal</option>
                  </select>
                </div>
                <div>
                  <div style={{ color: 'var(--text3)', marginBottom: 3 }}>Style</div>
                  <select value={feedbackStyle} onChange={e => setFeedbackStyle(e.target.value)}
                    style={{ width: '100%', fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <option value="balanced">Balanced</option>
                    <option value="strength-first">Lead with strength</option>
                    <option value="gap-first">Lead with gap</option>
                    <option value="growth">Growth focused</option>
                    <option value="direct">Direct only</option>
                  </select>
                </div>
                <div>
                  <div style={{ color: 'var(--text3)', marginBottom: 3 }}>Sentences</div>
                  <select value={sentences} onChange={e => setSentences(parseInt(e.target.value))}
                    style={{ width: '100%', fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    {[2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                <div>
                  <div style={{ color: 'var(--text3)', marginBottom: 3 }}>Criterion comments</div>
                  <select value={commentMode} onChange={e => setCommentMode(e.target.value)}
                    style={{ width: '100%', fontSize: 11, padding: '3px 5px', borderRadius: 4, border: '1px solid var(--border)' }}>
                    <option value="imperfect">Only if not perfect</option>
                    <option value="all">All criteria</option>
                    <option value="none">None</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--text3)' }}>{records.length} total</span>
            {graded > 0 && <span style={{ color: '#2563eb', fontWeight: 600 }}>· {graded} ready</span>}
            {approved > 0 && <span style={{ color: 'var(--green)', fontWeight: 600 }}>· {approved} approved</span>}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button onClick={pullSubmissions} disabled={starting || !assignment?.canvasAssignmentId}
              style={{ fontSize: 11, padding: '4px 8px', flex: 1 }}
              title={!assignment?.canvasAssignmentId ? 'Set Canvas Assignment ID first' : ''}>
              {starting ? 'Pulling…' : '⬇ Pull submissions'}
            </button>
            <button onClick={gradeAll} disabled={gradingAll || pending === 0}
              style={{ fontSize: 11, padding: '4px 8px', flex: 1, background: accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600 }}>
              {gradingAll ? `Grading… ${gradingProgress}%` : `▶ Grade all (${pending})`}
            </button>
          </div>

          {gradingAll && (
            <div style={{ marginTop: 6, height: 4, background: 'var(--bg2)', borderRadius: 2 }}>
              <div style={{ height: '100%', width: gradingProgress + '%', background: accent, borderRadius: 2, transition: 'width 0.3s' }} />
            </div>
          )}

          {message && <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 6 }}>{message}</div>}
        </div>

        {loading && <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 4px' }}>Loading…</div>}

        {records.map(record => {
          const sc = STATUS_COLORS[record.status] || STATUS_COLORS.pending;
          const isSelected = selected?.id === record.id;
          return (
            <div key={record.id} onClick={() => { setSelected(record); setAdjustedGrades(ag => ({ ...ag })); }}
              style={{ padding: '10px 10px', marginBottom: 4, borderRadius: 8, cursor: 'pointer',
                background: isSelected ? accent + '15' : '#fff',
                border: `1px solid ${isSelected ? accent : 'var(--border)'}` }}>
              <div style={{ fontSize: 13, fontWeight: isSelected ? 700 : 500, color: 'var(--text)' }}>
                {record.student_name}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
                <span style={{ fontSize: 11, color: sc.color, fontWeight: 600 }}>{sc.label}</span>
                {record.total_points > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{record.total_points}/{record.max_score || 75}</span>
                )}
              </div>
            </div>
          );
        })}

        {!loading && records.length === 0 && (
          <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', padding: '24px 8px' }}>
            No submissions yet. Pull from Canvas to start.
          </div>
        )}
      </div>

      {/* Right — grade review */}
      <div style={{ overflowY: 'auto', padding: '20px 24px' }}>
        {!selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            height: '100%', color: 'var(--text3)', gap: 12 }}>
            <div style={{ fontSize: 32 }}>📋</div>
            <div style={{ fontSize: 14 }}>Select a student to review their grade</div>
            {graded > 0 && (
              <div style={{ fontSize: 13, color: '#2563eb', fontWeight: 600 }}>{graded} student{graded > 1 ? 's' : ''} ready for review</div>
            )}
          </div>
        ) : (
          <div>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
              <div>
                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text)' }}>{selected.student_name}</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>
                  {selected.status === 'graded' ? 'Ready for review — adjust scores then approve' :
                   selected.status === 'approved' ? '✓ Approved and saved' :
                   selected.status === 'pending' ? 'Not yet graded' :
                   selected.status === 'grading' ? '⏳ Grading in progress…' : ''}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {selected.status === 'pending' && (
                  <button onClick={() => gradeOne(selected)} style={{ fontSize: 12, padding: '6px 12px', background: accent, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>
                    ▶ Grade this student
                  </button>
                )}
                {selected.status === 'graded' && (
                  <>
                    <button onClick={() => gradeOne(selected)} style={{ fontSize: 12, padding: '6px 12px' }}>↻ Regrade</button>
                    <button onClick={() => approveGrade(selected)}
                      style={{ fontSize: 12, padding: '6px 14px', background: 'var(--green)', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 700 }}>
                      ✓ Approve grade
                    </button>
                  </>
                )}
                {selected.status === 'approved' && (
                  <button onClick={() => gradeOne(selected)} style={{ fontSize: 12, padding: '6px 12px' }}>↻ Regrade</button>
                )}
                <button onClick={() => deleteRecord(selected.id)}
                  style={{ fontSize: 11, padding: '6px 10px', color: 'var(--red)', border: '1px solid var(--red)', background: 'transparent', borderRadius: 6, cursor: 'pointer' }}>
                  🗑
                </button>
              </div>
            </div>

            {selected.error && (
              <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.08)', border: '1px solid var(--red)', borderRadius: 8, fontSize: 12, color: 'var(--red)', marginBottom: 16 }}>
                {selected.error}
              </div>
            )}

            {/* Criteria grades */}
            {selected.criteriaGrades?.length > 0 && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: accent, marginBottom: 10 }}>
                  Rubric Scores
                </div>
                {selected.criteriaGrades.map((cg, i) => {
                  const adjusted = adjustedGrades[selected.id]?.[cg.criterionName] ?? cg.suggestedPoints;
                  return (
                    <div key={i} style={{ padding: '12px 14px', marginBottom: 8, border: '1px solid var(--border)', borderRadius: 8, background: '#fff' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{cg.criterionName}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 11, color: accent, background: accent + '12', padding: '2px 8px', borderRadius: 4 }}>
                            {cg.suggestedRating}
                          </span>
                          <input type="number" value={adjusted} min="0" step="0.5"
                            onChange={e => setAdjustedGrades(ag => ({
                              ...ag,
                              [selected.id]: { ...(ag[selected.id] || {}), [cg.criterionName]: parseFloat(e.target.value) || 0 }
                            }))}
                            style={{ width: 56, fontSize: 14, fontWeight: 700, textAlign: 'center', padding: '3px 4px',
                              border: adjusted !== cg.suggestedPoints ? `2px solid ${accent}` : '1px solid var(--border)',
                              borderRadius: 6 }} />
                          <span style={{ fontSize: 12, color: 'var(--text3)' }}>/ {cg.maxPoints || 15}</span>
                        </div>
                      </div>
                      {cg.scoringRationale && (
                        <p style={{ margin: '0 0 4px', fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', lineHeight: 1.4 }}>
                          {cg.scoringRationale}
                        </p>
                      )}
                      {cg.studentComment && (
                        <p style={{ margin: 0, fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>
                          💬 {cg.studentComment}
                        </p>
                      )}
                    </div>
                  );
                })}

                {/* Total */}
                <div style={{ padding: '10px 14px', background: accent + '10', borderRadius: 8, border: `1px solid ${accent}25`,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 13, fontWeight: 700 }}>Total</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: accent }}>
                    {Object.keys(adjustedGrades[selected.id] || {}).length > 0
                      ? Object.values({ ...Object.fromEntries(selected.criteriaGrades.map(c => [c.criterionName, c.suggestedPoints])), ...(adjustedGrades[selected.id] || {}) }).reduce((s, v) => s + v, 0).toFixed(1)
                      : selected.total_points} / {selected.max_score || 75}
                  </span>
                </div>
              </div>
            )}

            {/* Instructor paragraph */}
            {selected.instructor_paragraph && (
              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: accent, marginBottom: 8 }}>
                  Instructor Feedback
                </div>
                <div style={{ padding: '14px 16px', background: accent + '08', borderLeft: `4px solid ${accent}`,
                  borderRadius: '0 8px 8px 0', fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
                  {selected.instructor_paragraph}
                </div>
              </div>
            )}

            {/* Submission preview */}
            {selected.submission_text && (
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)', marginBottom: 8 }}>
                  Submission
                </div>
                <div style={{ padding: '12px 14px', background: 'var(--bg2)', borderRadius: 8, fontSize: 12,
                  color: 'var(--text2)', lineHeight: 1.6, maxHeight: 300, overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
                  {selected.submission_text}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
