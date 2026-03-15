import { useState, useEffect, useRef } from 'react';
import { updateAssignment } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const RATING_COLORS = {
  'Accomplished': '#16A34A',
  'Proficient': '#2563EB',
  'Needs Improvement': '#D97706',
  'Unacceptable': '#DC2626'
};

// ── Unified Discussion Grader ────────────────────────────────────────────────
// This is the main view. One student at a time.
// Grade rubric + write instructor response in one place.
// Copy everything to Canvas when done.

export default function DiscussGrader({ course, password, assignments, question, onSubmissionGraded }) {
  const isCompletion = course.gradingModel === 'completion';

  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [rubricCriteria, setRubricCriteria] = useState([]);
  const [totalMax, setTotalMax] = useState(0);

  // Student input
  const [studentName, setStudentName] = useState('');
  const [submission, setSubmission] = useState('');

  // Grading state
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState(null);
  const [scores, setScores] = useState({});
  const [ratings, setRatings] = useState({});
  const [rationale, setRationale] = useState({});

  // Response state
  const [response, setResponse] = useState('');
  const [regenerating, setRegenerating] = useState(false);
  const [tone, setTone] = useState('warm');
  const [sentences, setSentences] = useState(5);
  const [wordsPerSentence, setWordsPerSentence] = useState(18);
  const [structure, setStructure] = useState('organized');
  const [refinement, setRefinement] = useState('');

  // UI state
  const [copied, setCopied] = useState('');
  const [savedAsExample, setSavedAsExample] = useState(false);
  const [importingRubric, setImportingRubric] = useState(false);
  const [showRationale, setShowRationale] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const csvRef = useRef();

  useEffect(() => {
    const disc = assignments?.find(a => a.type === 'discussion') || assignments?.[0];
    if (disc) setSelectedAssignment(disc);
  }, [assignments?.length]);

  useEffect(() => {
    if (selectedAssignment?.rubricCriteria?.length) {
      setRubricCriteria(selectedAssignment.rubricCriteria);
      setTotalMax(selectedAssignment.rubricCriteria.reduce((s, c) => s + c.maxPoints, 0));
    } else {
      setRubricCriteria([]);
      setTotalMax(0);
    }
    setResult(null); setScores({}); setRatings({}); setRationale({});
    setResponse(''); setSavedAsExample(false);
  }, [selectedAssignment?.id]);

  async function importRubricCSV(text) {
    setImportingRubric(true);
    try {
      const r = await fetch(`${BASE}/api/discussgrade/parse-rubric`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: text })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setRubricCriteria(d.criteria);
      setTotalMax(d.totalMax);
      if (selectedAssignment) {
        await updateAssignment(selectedAssignment.id, {
          ...selectedAssignment, rubricCriteria: d.criteria, maxScore: d.totalMax
        }, password);
      }
    } catch (e) { alert('Import error: ' + e.message); }
    setImportingRubric(false);
  }

  // Grade rubric + generate response in one call
  async function gradeAndRespond() {
    if (!submission.trim() || !studentName.trim()) return;
    setGrading(true); setResult(null); setResponse('');

    try {
      // 1. Grade rubric (if rubric mode)
      let gradeResult = null;
      if (!isCompletion && rubricCriteria.length) {
        const r = await fetch(`${BASE}/api/discussgrade/grade`, {
          method: 'POST',
          headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            courseId: course.id, assignmentId: selectedAssignment?.id,
            studentName, discussionQuestion: question || selectedAssignment?.description || '',
            submission, rubricCriteria, instructorBio: course.instructorBio
          })
        });
        gradeResult = await r.json();
        if (gradeResult.error) throw new Error(gradeResult.error);
        setResult(gradeResult);
        const initScores = {}, initRatings = {}, initRationale = {};
        gradeResult.criteriaGrades?.forEach(cg => {
          initScores[cg.criterionName] = cg.suggestedPoints;
          initRatings[cg.criterionName] = cg.suggestedRating;
          initRationale[cg.criterionName] = { scoring: cg.scoringRationale || '', student: cg.studentComment || '' };
        });
        setScores(initScores); setRatings(initRatings); setRationale(initRationale);
      }

      // 2. Generate instructor response
      const resp2 = await fetch(`${BASE}/api/discuss/reply`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id, question: question || selectedAssignment?.description || '',
          studentName, studentResponse: submission,
          tone, sentenceCount: sentences, wordsPerSentence, structure
        })
      });
      const d2 = await resp2.json();
      setResponse(d2.reply || '');

      onSubmissionGraded?.(studentName, submission);
    } catch (e) { alert('Error: ' + e.message); }
    setGrading(false);
  }

  async function regenerateResponse() {
    if (!studentName || !submission) return;
    setRegenerating(true);
    try {
      const resp = await fetch(`${BASE}/api/discuss/reply`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id, question: question || selectedAssignment?.description || '',
          studentName, studentResponse: submission,
          tone, sentenceCount: sentences, wordsPerSentence, structure,
          refinement, previousResponse: response
        })
      });
      const d = await resp.json();
      setResponse(d.reply || '');
      setRefinement('');
    } catch (e) { alert('Error: ' + e.message); }
    setRegenerating(false);
  }

  async function saveAsExample() {
    if (!result || !selectedAssignment) return;
    const criteriaGrades = result.criteriaGrades?.map(cg => ({
      ...cg,
      finalPoints: scores[cg.criterionName] ?? cg.suggestedPoints,
      scoringRationale: rationale[cg.criterionName]?.scoring ?? cg.scoringRationale,
      maxPoints: rubricCriteria.find(c => c.name === cg.criterionName)?.maxPoints || 15
    })) || [];
    try {
      const r = await fetch(`${BASE}/api/discussgrade/save-as-example`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignmentId: selectedAssignment.id, courseId: course.id,
          studentName, submission, criteriaGrades,
          totalPoints: getTotal(), totalMax, instructorParagraph: response
        })
      });
      const d = await r.json();
      if (d.ok) setSavedAsExample(true);
    } catch (e) { alert(e.message); }
  }

  function getTotal() {
    return Object.values(scores).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }

  function totalColor() {
    const p = totalMax ? getTotal() / totalMax : 0;
    return p >= 0.9 ? '#16A34A' : p >= 0.8 ? '#2563EB' : p >= 0.7 ? '#D97706' : '#DC2626';
  }

  function buildCanvasOutput() {
    const lines = [];
    if (!isCompletion && rubricCriteria.length) {
      rubricCriteria.forEach(c => {
        const pts = scores[c.name] ?? 0;
        const rat = rationale[c.name]?.student || '';
        const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
        lines.push(`${shortName}: ${pts} / ${c.maxPoints} pts — ${ratings[c.name] || ''}`);
        if (rat) lines.push(rat);
        lines.push('');
      });
      lines.push(`Total: ${getTotal().toFixed(0)} / ${totalMax} pts`);
      lines.push('');
    }
    if (response) lines.push(response);
    return lines.join('\n');
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2500);
  }

  function nextStudent() {
    setStudentName(''); setSubmission(''); setResult(null);
    setScores({}); setRatings({}); setRationale({});
    setResponse(''); setSavedAsExample(false); setRefinement('');
  }

  const hasResult = result !== null || (isCompletion && response);
  const hasRubric = !isCompletion && rubricCriteria.length > 0;

  // Completion mode
  if (isCompletion) {
    return <CompletionGrader course={course} password={password} assignments={assignments} />;
  }

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={selectedAssignment?.id || ''} style={{ fontSize: 13, fontWeight: 500 }}
            onChange={e => setSelectedAssignment(assignments?.find(a => a.id === e.target.value) || null)}>
            {assignments?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {hasRubric && (
            <span style={{ fontSize: 11, color: 'var(--green)', padding: '2px 8px', background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 10 }}>
              ✓ Rubric loaded · {totalMax} pts
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={async e => { const f = e.target.files[0]; if (f) { importRubricCSV(await f.text()); e.target.value = ''; } }} />
          {!hasRubric && (
            <button onClick={() => csvRef.current.click()} disabled={importingRubric} style={{ fontSize: 12 }}>
              {importingRubric ? 'Importing…' : '↑ Import rubric CSV'}
            </button>
          )}
          {hasRubric && (
            <button onClick={() => csvRef.current.click()} disabled={importingRubric} style={{ fontSize: 11, color: 'var(--text3)' }}>
              ↺ Update rubric
            </button>
          )}
        </div>
      </div>

      {!hasRubric && (
        <div style={{ padding: '12px 14px', marginBottom: 12, background: 'rgba(217,119,6,0.06)', border: '1px solid rgba(217,119,6,0.2)', borderRadius: 8, fontSize: 13, color: 'var(--amber)' }}>
          Import your Canvas rubric CSV to enable rubric grading. Import once — saves permanently.
        </div>
      )}

      <div className="two-col" style={{ gap: 16, alignItems: 'start' }}>
        {/* Left: student input */}
        <div>
          <div className="field">
            <label>Student name</label>
            <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
              placeholder="First and last name" />
          </div>
          <div className="field" style={{ marginBottom: 10 }}>
            <label>Student submission (initial post + peer responses)</label>
            <textarea rows={14} value={submission} onChange={e => setSubmission(e.target.value)}
              placeholder="Paste the full submission here…"
              style={{ fontSize: 13, lineHeight: 1.65, resize: 'vertical' }} />
          </div>

          {/* Response style controls — collapsed by default */}
          <div style={{ marginBottom: 10 }}>
            <button className="ghost" style={{ fontSize: 12, width: '100%', textAlign: 'left', padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
              onClick={() => setShowControls(s => !s)}>
              {showControls ? '▾' : '▸'} Response style controls
              <span style={{ fontSize: 11, color: 'var(--text3)', marginLeft: 8 }}>
                {tone} · {sentences} sentences · {wordsPerSentence} words max
              </span>
            </button>
            {showControls && (
              <div style={{ padding: '12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', marginTop: -1 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label>Tone</label>
                    <select value={tone} onChange={e => setTone(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="warm">Warm mentor</option>
                      <option value="direct">Plain and direct</option>
                      <option value="formal">Formal academic</option>
                      <option value="encouraging">Encouraging</option>
                      <option value="socratic">Socratic — ask questions</option>
                    </select>
                  </div>
                  <div>
                    <label>Structure</label>
                    <select value={structure} onChange={e => setStructure(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="organized">Strengths → gaps → forward</option>
                      <option value="flowing">Weave together naturally</option>
                      <option value="critical">Gaps first → strengths</option>
                      <option value="question">End with a question</option>
                    </select>
                  </div>
                </div>
                <div style={{ marginBottom: 8 }}>
                  <label>Sentences: <strong>{sentences}</strong></label>
                  <input type="range" min={2} max={10} value={sentences} onChange={e => setSentences(Number(e.target.value))} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
                    <span>2</span><span>5 (standard)</span><span>10</span>
                  </div>
                </div>
                <div>
                  <label>Max words per sentence: <strong>{wordsPerSentence}</strong></label>
                  <input type="range" min={10} max={25} value={wordsPerSentence} onChange={e => setWordsPerSentence(Number(e.target.value))} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
                    <span>10 (punchy)</span><span>18 (standard)</span><span>25</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600 }}
            onClick={gradeAndRespond}
            disabled={grading || !submission.trim() || !studentName.trim()}>
            {grading ? 'Grading and generating response…' : hasRubric ? 'Grade + generate response →' : 'Generate response →'}
          </button>
        </div>

        {/* Right: output */}
        <div>
          {!hasResult && !grading && (
            <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>✏️</div>
              Paste the student's submission and click Generate.<br />
              {hasRubric ? 'Rubric scores and response generated together.' : 'Import a rubric CSV to also get per-criterion scores.'}
            </div>
          )}

          {hasResult && (
            <>
              {/* Score summary — compact */}
              {hasRubric && (
                <div style={{ padding: '10px 14px', marginBottom: 12,
                  background: `${totalColor()}10`, border: `2px solid ${totalColor()}30`,
                  borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{studentName}</div>
                  <div>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 26, fontWeight: 700, color: totalColor() }}>
                      {getTotal().toFixed(0)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}> / {totalMax}</span>
                  </div>
                </div>
              )}

              {/* Rubric criteria — compact cards */}
              {hasRubric && rubricCriteria.map(c => {
                const pts = scores[c.name] ?? 0;
                const rat = ratings[c.name] || '';
                const ratText = rationale[c.name] || {};
                const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;

                return (
                  <div key={c.id} className="card" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <span style={{ fontWeight: 600, fontSize: 12 }}>{shortName}</span>
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                        <button onClick={() => {
                          const comment = ratText.student || '';
                          copy(`${pts} / ${c.maxPoints} pts — ${rat}${comment ? '\n' + comment : ''}`, `c-${c.id}`);
                        }} style={{ fontSize: 10, padding: '2px 7px',
                          background: copied === `c-${c.id}` ? 'var(--accent)' : 'transparent',
                          color: copied === `c-${c.id}` ? '#fff' : 'var(--text3)',
                          border: `1px solid ${copied === `c-${c.id}` ? 'var(--accent)' : 'var(--border)'}` }}>
                          {copied === `c-${c.id}` ? '✓' : 'Copy'}
                        </button>
                        <input type="number" value={pts} min="0" max={c.maxPoints} step="0.5"
                          onChange={e => setScores(s => ({ ...s, [c.name]: parseFloat(e.target.value) || 0 }))}
                          style={{ width: 46, fontSize: 14, fontWeight: 700, fontFamily: 'var(--mono)', textAlign: 'center', padding: '2px 4px' }} />
                        <span style={{ fontSize: 11, color: 'var(--text3)' }}>/ {c.maxPoints}</span>
                      </div>
                    </div>
                    {/* Rating buttons */}
                    <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 6 }}>
                      {c.ratings.sort((a,b) => b.points - a.points).map(r => (
                        <button key={r.name}
                          onClick={() => { setRatings(rv => ({...rv, [c.name]: r.name})); setScores(s => ({...s, [c.name]: r.points})); }}
                          style={{
                            fontSize: 10, padding: '3px 8px', borderRadius: 4,
                            background: rat === r.name ? `${RATING_COLORS[r.name]}18` : 'var(--bg)',
                            color: rat === r.name ? RATING_COLORS[r.name] : 'var(--text2)',
                            border: `1px solid ${rat === r.name ? RATING_COLORS[r.name] : 'var(--border2)'}`,
                            fontWeight: rat === r.name ? 700 : 400
                          }}>{r.name}</button>
                      ))}
                    </div>
                    <textarea rows={2} value={ratText.student || ''}
                      onChange={e => setRationale(r => ({...r, [c.name]: {...r[c.name], student: e.target.value}}))}
                      placeholder="Comment to student…"
                      style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 0 }} />
                  </div>
                );
              })}

              {/* Scoring rationale — collapsed */}
              {hasRubric && (
                <div style={{ marginBottom: 10 }}>
                  <button className="ghost" style={{ fontSize: 11, width: '100%', textAlign: 'left', padding: '6px 10px', border: '1px solid var(--border)', borderRadius: 6 }}
                    onClick={() => setShowRationale(s => !s)}>
                    {showRationale ? '▾' : '▸'} Scoring rationale (instructor reference)
                    <button onClick={(e) => {
                      e.stopPropagation();
                      const lines = ['Scoring Rationale (Instructor Reference)', ''];
                      rubricCriteria.forEach(c => {
                        const pts = scores[c.name] ?? 0;
                        const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
                        const rat = rationale[c.name]?.scoring || '';
                        lines.push(`${shortName} (${pts}/${c.maxPoints}): ${rat}`);
                      });
                      copy(lines.join('\n'), 'rationale');
                    }} style={{ float: 'right', fontSize: 10, padding: '1px 7px', marginLeft: 8,
                      background: copied === 'rationale' ? 'var(--accent)' : 'transparent',
                      color: copied === 'rationale' ? '#fff' : 'var(--text3)',
                      border: `1px solid ${copied === 'rationale' ? 'var(--accent)' : 'var(--border)'}` }}>
                      {copied === 'rationale' ? '✓ Copied' : 'Copy all'}
                    </button>
                  </button>
                  {showRationale && (
                    <div style={{ padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: '0 0 6px 6px', marginTop: -1 }}>
                      {rubricCriteria.map(c => {
                        const pts = scores[c.name] ?? 0;
                        const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
                        return (
                          <div key={c.id} style={{ marginBottom: 8 }}>
                            <span style={{ fontWeight: 700, fontSize: 12 }}>{shortName} ({pts}/{c.maxPoints}): </span>
                            <textarea rows={2} value={rationale[c.name]?.scoring || ''}
                              onChange={e => setRationale(r => ({...r, [c.name]: {...r[c.name], scoring: e.target.value}}))}
                              style={{ fontSize: 11, lineHeight: 1.5, display: 'block', width: '100%', marginTop: 2 }} />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Instructor response */}
              <div style={{ marginBottom: 10, padding: '12px 14px', border: '2px solid rgba(37,99,235,0.2)', borderRadius: 8, background: 'rgba(37,99,235,0.02)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--accent)' }}>
                    Instructor response
                  </span>
                  <div style={{ display: 'flex', gap: 6, fontSize: 11, color: 'var(--text3)' }}>
                    <span>{response.split(/\s+/).filter(Boolean).length}w</span>
                    <span>{response.split(/[.!?]+/).filter(s => s.trim()).length}s</span>
                  </div>
                </div>
                <textarea value={response} onChange={e => setResponse(e.target.value)}
                  style={{ width: '100%', minHeight: 140, fontSize: 13, lineHeight: 1.8,
                    fontStyle: 'italic', border: 'none', background: 'transparent',
                    resize: 'vertical', outline: 'none', padding: 0 }} />

                {/* Refinement */}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border)' }}>
                  <input type="text" value={refinement} onChange={e => setRefinement(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && refinement.trim() && regenerateResponse()}
                    placeholder="Adjust: e.g. 'be more direct about the citation gap'"
                    style={{ flex: 1, fontSize: 12 }} />
                  <button onClick={regenerateResponse} disabled={regenerating || !refinement.trim()}
                    style={{ fontSize: 12, flexShrink: 0 }}>
                    {regenerating ? '…' : '↻ Apply'}
                  </button>
                  <button onClick={() => { setRefinement(''); regenerateResponse(); }} disabled={regenerating}
                    style={{ fontSize: 12, flexShrink: 0, color: 'var(--text3)' }}>
                    ↻ Regenerate
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <button className="primary" style={{ width: '100%', padding: 11, fontSize: 14, fontWeight: 600, marginBottom: 6 }}
                onClick={() => copy(buildCanvasOutput(), 'all')}>
                {copied === 'all' ? '✓ Copied — paste into Canvas SpeedGrader' : '📋 Copy all to Canvas'}
              </button>
              <div style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                <button style={{ flex: 1, fontSize: 12 }} onClick={() => copy(response, 'resp')}>
                  {copied === 'resp' ? '✓' : 'Copy response only'}
                </button>
                {hasRubric && (
                  <button style={{ flex: 1, fontSize: 12 }} onClick={() => copy(`${getTotal().toFixed(0)} / ${totalMax}`, 'grade')}>
                    {copied === 'grade' ? '✓' : 'Copy grade'}
                  </button>
                )}
                <button style={{ fontSize: 12 }} onClick={nextStudent}>Next →</button>
              </div>
              <button onClick={saveAsExample} disabled={savedAsExample || !result}
                style={{ width: '100%', fontSize: 12, padding: '7px',
                  background: savedAsExample ? 'rgba(22,163,74,0.08)' : 'var(--bg)',
                  color: savedAsExample ? 'var(--green)' : 'var(--text3)',
                  border: `1px solid ${savedAsExample ? 'var(--green)' : 'var(--border)'}` }}>
                {savedAsExample ? '✓ Saved as calibration example' : '📌 Save as calibration example'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Completion / Pass-Fail Grader (UMD style) ────────────────────────────────

function CompletionGrader({ course, password, assignments }) {
  const [selectedAssignment, setSelectedAssignment] = useState(assignments?.[0] || null);
  const [studentName, setStudentName] = useState('');
  const [submission, setSubmission] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [history, setHistory] = useState([]);
  const maxPts = selectedAssignment?.maxScore || 10;

  async function markComplete() {
    setSaving(true);
    try {
      await fetch(`${BASE}/api/discussgrade/grade`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id, assignmentId: selectedAssignment?.id,
          studentName, discussionQuestion: '',
          submission: submission || '(no text recorded)',
          rubricCriteria: [{ id: 'completion', name: 'Completion', maxPoints: maxPts,
            ratings: [{ name: 'Complete', points: maxPts, description: 'Submitted' }] }],
          instructorBio: course.instructorBio
        })
      });
      setHistory(h => [{ studentName, comment, pts: maxPts, date: new Date() }, ...h]);
      setStudentName(''); setSubmission(''); setComment('');
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div style={{ maxWidth: 600 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>Completion Grading</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>{maxPts} pts for participating</div>
        </div>
        <select value={selectedAssignment?.id || ''} style={{ fontSize: 13 }}
          onChange={e => setSelectedAssignment(assignments?.find(a => a.id === e.target.value))}>
          {assignments?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      <div className="card" style={{ marginBottom: 12 }}>
        <div className="field">
          <label>Student name</label>
          <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="First and last name" />
        </div>
        <div className="field">
          <label>Student post (optional)</label>
          <textarea rows={5} value={submission} onChange={e => setSubmission(e.target.value)}
            placeholder="Paste to keep a record…" style={{ fontSize: 13 }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Comment (optional)</label>
          <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)}
            style={{ fontSize: 13 }} />
        </div>
      </div>

      <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600 }}
        onClick={markComplete} disabled={saving || !studentName.trim()}>
        {saving ? 'Saving…' : `✓ Mark complete — ${maxPts}/${maxPts} pts`}
      </button>

      {history.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Marked complete this session</div>
          {history.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 12px',
              background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>{h.studentName}</span>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{h.pts}/{maxPts}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
