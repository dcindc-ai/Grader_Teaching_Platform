import { useState, useRef } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const RATING_COLORS = {
  'Accomplished': 'var(--green)',
  'Proficient': 'var(--accent)',
  'Needs Improvement': 'var(--amber)',
  'Unacceptable': 'var(--red)'
};

const RATING_BG = {
  'Accomplished': 'rgba(22,163,74,0.08)',
  'Proficient': 'rgba(37,99,235,0.08)',
  'Needs Improvement': 'rgba(217,119,6,0.08)',
  'Unacceptable': 'rgba(220,38,38,0.08)'
};

export default function DiscussGrader({ course, password, assignments }) {
  const [step, setStep] = useState('setup'); // setup | grading | review
  const [discussionQuestion, setDiscussionQuestion] = useState(course.discussionDefaultQuestion || '');
  const [rubricCriteria, setRubricCriteria] = useState([]);
  const [totalMax, setTotalMax] = useState(75);
  const [assignmentId, setAssignmentId] = useState(assignments?.[0]?.id || '');
  const [studentName, setStudentName] = useState('');
  const [submission, setSubmission] = useState('');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState(null);
  const [overrides, setOverrides] = useState({}); // criterionId -> {points, comment}
  const [copied, setCopied] = useState('');
  const [csvError, setCsvError] = useState('');
  const csvRef = useRef();

  async function importRubric(csvText) {
    setCsvError('');
    try {
      const r = await fetch(`${BASE}/api/discussgrade/parse-rubric`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText })
      });
      const d = await r.json();
      if (d.error) { setCsvError(d.error); return; }
      setRubricCriteria(d.criteria);
      setTotalMax(d.totalMax);
    } catch (e) {
      setCsvError(e.message);
    }
  }

  async function gradeSubmission() {
    if (!submission.trim()) return;
    setGrading(true);
    setResult(null);
    try {
      const r = await fetch(`${BASE}/api/discussgrade/grade`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id,
          assignmentId,
          studentName,
          discussionQuestion,
          submission,
          rubricCriteria,
          instructorBio: course.instructorBio
        })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
      // Initialize overrides from result
      const init = {};
      d.criteriaGrades?.forEach(cg => {
        init[cg.criterionName] = { points: cg.suggestedPoints, comment: cg.comment };
      });
      setOverrides(init);
      setStep('review');
    } catch (e) {
      alert('Error: ' + e.message);
    }
    setGrading(false);
  }

  function updateOverride(criterionName, field, value) {
    setOverrides(o => ({ ...o, [criterionName]: { ...o[criterionName], [field]: value } }));
  }

  function getFinalTotal() {
    if (!result) return 0;
    return result.criteriaGrades?.reduce((sum, cg) => {
      const pts = parseFloat(overrides[cg.criterionName]?.points ?? cg.suggestedPoints) || 0;
      return sum + pts;
    }, 0).toFixed(1);
  }

  function buildCanvasText() {
    if (!result) return '';
    const lines = [];
    lines.push(`Student: ${studentName}`);
    lines.push(`Total: ${getFinalTotal()} / ${totalMax}`);
    lines.push('');
    result.criteriaGrades?.forEach(cg => {
      const pts = overrides[cg.criterionName]?.points ?? cg.suggestedPoints;
      const comment = overrides[cg.criterionName]?.comment ?? cg.comment;
      lines.push(`${cg.criterionName}: ${pts} / ${cg.maxPoints || 15} pts`);
      if (comment) lines.push(`Comment: ${comment}`);
      lines.push('');
    });
    if (result.instructorParagraph) {
      lines.push('--- Instructor Feedback ---');
      lines.push(result.instructorParagraph);
    }
    return lines.join('\n');
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2000);
  }

  function reset() {
    setStep('setup');
    setStudentName('');
    setSubmission('');
    setResult(null);
    setOverrides({});
  }

  return (
    <div style={{ maxWidth: 800 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Discussion Grader</div>
          <div className="page-sub">Rubric-based grading for discussion posts · Copy results to Canvas</div>
        </div>
        {step === 'review' && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={reset} style={{ fontSize: 12 }}>← New student</button>
          </div>
        )}
      </div>

      {/* ── Step 1: Setup ─────────────────────────────────────────── */}
      {step === 'setup' && (
        <div>
          {/* Rubric import */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 600 }}>
                Grading Rubric
                {rubricCriteria.length > 0 && (
                  <span className="pill-green" style={{ marginLeft: 10, fontSize: 11 }}>
                    {rubricCriteria.length} criteria · {totalMax} pts total
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }}
                  onChange={async e => {
                    const file = e.target.files[0];
                    if (!file) return;
                    const text = await file.text();
                    importRubric(text);
                  }} />
                <button style={{ fontSize: 12 }} onClick={() => csvRef.current.click()}>
                  ↑ Import from Canvas CSV
                </button>
              </div>
            </div>

            {csvError && <div style={{ fontSize: 12, color: 'var(--red)', marginBottom: 8 }}>{csvError}</div>}

            {rubricCriteria.length === 0 ? (
              <div style={{ fontSize: 13, color: 'var(--text3)', padding: '16px 0', textAlign: 'center' }}>
                Import your rubric CSV from Canvas (Rubrics → Export) or add criteria manually below.
              </div>
            ) : (
              <div>
                {rubricCriteria.map((c, i) => (
                  <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: i < rubricCriteria.length - 1 ? '1px solid var(--border)' : 'none' }}>
                    <span style={{ fontSize: 13 }}>{c.name}</span>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {c.ratings.map(r => (
                        <span key={r.name} style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: RATING_BG[r.name] || 'var(--bg3)', color: RATING_COLORS[r.name] || 'var(--text2)' }}>
                          {r.name} ({r.points})
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Discussion question */}
          <div className="card" style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Discussion Question</div>
            <textarea rows={5} value={discussionQuestion} onChange={e => setDiscussionQuestion(e.target.value)}
              placeholder="Paste the discussion question here…" style={{ fontSize: 13, lineHeight: 1.6 }} />
          </div>

          {/* Assignment selector */}
          {assignments?.length > 0 && (
            <div className="field" style={{ marginBottom: 14 }}>
              <label>Save grades to assignment</label>
              <select value={assignmentId} onChange={e => setAssignmentId(e.target.value)}>
                <option value="">Don't save</option>
                {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          )}

          <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14 }}
            onClick={() => setStep('grading')}
            disabled={rubricCriteria.length === 0}>
            Continue to Grade Student →
          </button>
          {rubricCriteria.length === 0 && (
            <div style={{ fontSize: 12, color: 'var(--text3)', textAlign: 'center', marginTop: 6 }}>Import a rubric first</div>
          )}
        </div>
      )}

      {/* ── Step 2: Enter submission ──────────────────────────────── */}
      {step === 'grading' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, alignItems: 'center' }}>
            <button className="ghost" style={{ fontSize: 12 }} onClick={() => setStep('setup')}>← Back to setup</button>
            <span style={{ fontSize: 12, color: 'var(--text2)' }}>Rubric: {rubricCriteria.length} criteria · {totalMax} pts</span>
          </div>

          <div className="card" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Student name</label>
              <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
                placeholder="First and last name" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Student submission (initial post + peer responses)</label>
              <textarea rows={16} value={submission} onChange={e => setSubmission(e.target.value)}
                placeholder="Paste the student's full discussion submission here — initial post and any peer responses…"
                style={{ fontSize: 13, lineHeight: 1.65 }} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button className="primary" style={{ flex: 1, padding: 12, fontSize: 14, fontWeight: 600 }}
              onClick={gradeSubmission} disabled={grading || !submission.trim()}>
              {grading ? 'Grading…' : 'Grade this submission →'}
            </button>
          </div>
          {grading && (
            <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--accent)' }}>
              Analyzing submission against {rubricCriteria.length} rubric criteria…
            </div>
          )}
        </div>
      )}

      {/* ── Step 3: Review & edit grades ─────────────────────────── */}
      {step === 'review' && result && (
        <div>
          {/* Score header */}
          <div className="card" style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 18 }}>{studentName || 'Student'}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{result.overallSummary}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 32, fontWeight: 700, color: parseFloat(getFinalTotal()) / totalMax >= 0.9 ? 'var(--green)' : parseFloat(getFinalTotal()) / totalMax >= 0.8 ? 'var(--accent)' : 'var(--amber)' }}>
                {getFinalTotal()}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text2)' }}>out of {totalMax}</div>
            </div>
          </div>

          {/* Instructor paragraph */}
          <div style={{ marginBottom: 16, padding: '14px 16px', background: 'rgba(37,99,235,0.04)', border: '2px solid rgba(37,99,235,0.2)', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)' }}>
                Instructor feedback
              </div>
              <button onClick={() => copy(result.instructorParagraph, 'para')} style={{
                fontSize: 12, padding: '4px 12px', fontWeight: 500,
                background: copied === 'para' ? 'var(--accent)' : 'transparent',
                color: copied === 'para' ? '#fff' : 'var(--accent)',
                border: '1px solid var(--accent)'
              }}>
                {copied === 'para' ? '✓ Copied' : 'Copy'}
              </button>
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.8, fontStyle: 'italic', margin: 0 }}>
              {result.instructorParagraph}
            </p>
          </div>

          {/* Per-criterion grades */}
          {result.criteriaGrades?.map((cg, i) => {
            const pts = overrides[cg.criterionName]?.points ?? cg.suggestedPoints;
            const comment = overrides[cg.criterionName]?.comment ?? cg.comment;
            const criterion = rubricCriteria.find(c => c.name === cg.criterionName);
            const maxPts = criterion?.maxPoints || 15;

            return (
              <div key={i} className="card" style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{cg.criterionName}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {criterion?.ratings.map(r => (
                        <button key={r.name} onClick={() => updateOverride(cg.criterionName, 'points', r.points)}
                          style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 4,
                            background: parseFloat(pts) === r.points ? (RATING_BG[r.name] || 'var(--bg3)') : 'var(--bg)',
                            color: parseFloat(pts) === r.points ? (RATING_COLORS[r.name] || 'var(--text)') : 'var(--text2)',
                            border: `1px solid ${parseFloat(pts) === r.points ? (RATING_COLORS[r.name] || 'var(--border2)') : 'var(--border2)'}`,
                            fontWeight: parseFloat(pts) === r.points ? 600 : 400
                          }}>
                          {r.name} ({r.points})
                        </button>
                      ))}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 16, flexShrink: 0 }}>
                    <input type="number" value={pts} min="0" max={maxPts} step="0.5"
                      onChange={e => updateOverride(cg.criterionName, 'points', e.target.value)}
                      style={{ width: 60, fontSize: 16, fontWeight: 700, fontFamily: 'var(--mono)', textAlign: 'center', padding: '4px 6px' }} />
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}>/ {maxPts}</span>
                  </div>
                </div>

                {/* Evidence */}
                {cg.evidence && (
                  <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', padding: '6px 10px', background: 'var(--bg2)', borderRadius: 6, marginBottom: 8, borderLeft: '2px solid var(--border2)' }}>
                    "{cg.evidence}"
                  </div>
                )}

                {/* Comment */}
                <div>
                  <label>Comment</label>
                  <textarea rows={2} value={comment}
                    onChange={e => updateOverride(cg.criterionName, 'comment', e.target.value)}
                    style={{ fontSize: 12, lineHeight: 1.6 }} />
                </div>
              </div>
            );
          })}

          {/* Copy all for Canvas */}
          <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
            <button className="primary" style={{ flex: 1, padding: 12, fontSize: 14, fontWeight: 600 }}
              onClick={() => copy(buildCanvasText(), 'all')}>
              {copied === 'all' ? '✓ Copied — paste into Canvas SpeedGrader' : '📋 Copy all grades + comments for Canvas'}
            </button>
            <button style={{ fontSize: 13, padding: '12px 16px' }} onClick={reset}>
              Next student
            </button>
          </div>

          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
            Paste into Canvas SpeedGrader rubric comment box
          </div>
        </div>
      )}
    </div>
  );
}
