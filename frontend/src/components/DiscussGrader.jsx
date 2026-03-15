import { useState, useRef, useEffect } from 'react';
import { updateAssignment } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const RATING_COLORS = {
  'Accomplished': '#16A34A',
  'Proficient': '#2563EB',
  'Needs Improvement': '#D97706',
  'Unacceptable': '#DC2626'
};

export default function DiscussGrader({ course, password, assignments }) {
  const [selectedAssignment, setSelectedAssignment] = useState(null);
  const [rubricCriteria, setRubricCriteria] = useState([]);
  const [totalMax, setTotalMax] = useState(0);
  const [studentName, setStudentName] = useState('');
  const [submission, setSubmission] = useState('');
  const [grading, setGrading] = useState(false);
  const [result, setResult] = useState(null);
  const [scores, setScores] = useState({});
  const [ratings, setRatings] = useState({});
  const [rationale, setRationale] = useState({});
  const [feedback, setFeedback] = useState('');
  const [copied, setCopied] = useState('');
  const [importingRubric, setImportingRubric] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [savedAsExample, setSavedAsExample] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistory, setShowHistory] = useState(false);
  const [viewingHistory, setViewingHistory] = useState(null);
  // Regenerate controls
  const [tone, setTone] = useState('warm');
  const [length, setLength] = useState('medium');
  const [directness, setDirectness] = useState('balanced');
  const csvRef = useRef();

  useEffect(() => {
    const disc = assignments?.find(a => a.type === 'discussion') || assignments?.[0];
    if (disc) setSelectedAssignment(disc);
  }, [assignments?.length]);

  useEffect(() => {
    if (selectedAssignment?.rubricCriteria?.length) {
      setRubricCriteria(selectedAssignment.rubricCriteria);
      setTotalMax(selectedAssignment.rubricCriteria.reduce((s, c) => s + c.maxPoints, 0));
    }
    if (selectedAssignment) loadHistory();
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

  async function loadHistory() {
    if (!selectedAssignment) return;
    try {
      const r = await fetch(`${BASE}/api/grade?courseId=${course.id}&assignmentId=${selectedAssignment.id}`, {
        headers: { 'x-admin-password': password }
      });
      const grades = await r.json();
      setHistory(grades.filter(g => g.comments && Array.isArray(g.comments)));
    } catch (e) {}
  }

  async function loadHistory() {
    if (!selectedAssignment) return;
    try {
      const r = await fetch(`${BASE}/api/grade?courseId=${course.id}&assignmentId=${selectedAssignment.id}`, {
        headers: { 'x-admin-password': password }
      });
      const grades = await r.json();
      setHistory(grades || []);
    } catch (e) {}
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
          assignmentId: selectedAssignment.id,
          courseId: course.id,
          studentName,
          submission,
          criteriaGrades,
          totalPoints: getTotal(),
          totalMax,
          instructorParagraph: feedback,
          scores
        })
      });
      const d = await r.json();
      if (d.ok) setSavedAsExample(true);
    } catch (e) { alert('Error saving: ' + e.message); }
  }

  async function gradeSubmission() {
    if (!submission.trim() || !rubricCriteria.length) return;
    setGrading(true); setResult(null);
    try {
      const r = await fetch(`${BASE}/api/discussgrade/grade`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id, assignmentId: selectedAssignment?.id,
          studentName, discussionQuestion: selectedAssignment?.description || course.discussionDefaultQuestion || '',
          submission, rubricCriteria, instructorBio: course.instructorBio
        })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setResult(d);
      setFeedback(d.instructorParagraph || '');
      const initScores = {}, initRatings = {}, initRationale = {};
      d.criteriaGrades?.forEach(cg => {
        initScores[cg.criterionName] = cg.suggestedPoints;
        initRatings[cg.criterionName] = cg.suggestedRating;
        initRationale[cg.criterionName] = { scoring: cg.scoringRationale || '', student: cg.studentComment || '' };
      });
      setScores(initScores); setRatings(initRatings); setRationale(initRationale);
    } catch (e) { alert('Error: ' + e.message); }
    setGrading(false);
    loadHistory();
  }

  async function regenerateFeedback() {
    if (!result) return;
    setRegenerating(true);
    try {
      const criteriaGrades = result.criteriaGrades?.map(cg => ({
        ...cg, finalPoints: scores[cg.criterionName], suggestedRating: ratings[cg.criterionName]
      }));
      const r = await fetch(`${BASE}/api/discussgrade/regenerate-feedback`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentName, overallSummary: result.overallSummary, criteriaGrades, rubricCriteria, tone, length, directness, instructorBio: course.instructorBio })
      });
      const d = await r.json();
      if (d.paragraph) setFeedback(d.paragraph);
    } catch (e) { alert('Error: ' + e.message); }
    setRegenerating(false);
  }

  function getTotal() {
    return Object.values(scores).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }

  function getPct() { return totalMax > 0 ? Math.round(getTotal() / totalMax * 100) : 0; }

  function totalColor() {
    const p = getPct();
    return p >= 90 ? '#16A34A' : p >= 80 ? '#2563EB' : p >= 70 ? '#D97706' : '#DC2626';
  }

  function buildCanvasText() {
    const lines = [];
    rubricCriteria.forEach(c => {
      const pts = scores[c.name] ?? 0;
      const rat = rationale[c.name]?.student || '';
      const rating = ratings[c.name] || '';
      const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
      lines.push(`${shortName}`);
      lines.push(`Score: ${pts} / ${c.maxPoints} pts — ${rating}`);
      if (rat) lines.push(`Comment: ${rat}`);
      lines.push('');
    });
    lines.push(`TOTAL: ${getTotal().toFixed(0)} / ${totalMax} pts`);
    if (feedback) { lines.push(''); lines.push('---'); lines.push(feedback); }
    return lines.join('\n');
  }

  function buildCriterionText(c) {
    const pts = scores[c.name] ?? 0;
    const rat = rationale[c.name]?.student || '';
    const rating = ratings[c.name] || '';
    return `${pts} / ${c.maxPoints} pts — ${rating}${rat ? '\n' + rat : ''}`;
  }

  function downloadDocx() {
    const criteriaGrades = result?.criteriaGrades?.map(cg => ({
      ...cg,
      finalPoints: scores[cg.criterionName] ?? cg.suggestedPoints,
      suggestedRating: ratings[cg.criterionName] ?? cg.suggestedRating,
      scoringRationale: rationale[cg.criterionName]?.scoring ?? cg.scoringRationale,
      studentComment: rationale[cg.criterionName]?.student ?? cg.studentComment,
      maxPoints: rubricCriteria.find(c => c.name === cg.criterionName)?.maxPoints || 15
    })) || [];

    const data = {
      courseName: `${course.name} — ${course.fullName || ''}`,
      assignmentName: selectedAssignment?.name || '',
      studentName, date: new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
      criteriaGrades, instructorParagraph: feedback
    };

    window.open(`${BASE}/api/discussgrade/docx?password=${encodeURIComponent(password)}&data=${encodeURIComponent(JSON.stringify(data))}`, '_blank');
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2500);
  }

  function nextStudent() {
    setStudentName(''); setSubmission(''); setResult(null);
    setScores({}); setRatings({}); setRationale({}); setFeedback('');
    setSavedAsExample(false);
  }

  const hasRubric = rubricCriteria.length > 0;
  const hasResult = result !== null;

  const isCompletion = course.gradingModel === 'completion';

  if (isCompletion) {
    return <CompletionGrader course={course} password={password} assignments={assignments} />;
  }

  return (
    <div style={{ maxWidth: 860 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Grade Discussion</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>Rubric grading · 3 outputs for Canvas</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={selectedAssignment?.id || ''} style={{ fontSize: 13 }}
            onChange={e => setSelectedAssignment(assignments?.find(x => x.id === e.target.value) || null)}>
            {assignments?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={async e => { const f = e.target.files[0]; if (f) { importRubricCSV(await f.text()); e.target.value=''; } }} />
          <button onClick={() => csvRef.current.click()} disabled={importingRubric} style={{ fontSize: 12 }}>
            {importingRubric ? 'Importing…' : hasRubric ? '↺ Update rubric' : '↑ Import rubric CSV'}
          </button>
          {history.length > 0 && (
            <button onClick={() => { setShowHistory(h => !h); setViewingHistory(null); }}
              style={{ fontSize: 12, fontWeight: showHistory ? 600 : 400,
                background: showHistory ? 'var(--bg3)' : 'var(--bg)',
                borderColor: showHistory ? 'var(--border2)' : 'var(--border)' }}>
              📚 History ({history.length})
            </button>
          )}
        </div>
      </div>

      {/* Rubric pills */}
      {hasRubric && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 14 }}>
          {rubricCriteria.map(c => (
            <span key={c.id} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text2)' }}>
              {c.name.split(':').pop().trim()} · {c.maxPoints}pts
            </span>
          ))}
          <span style={{ fontSize: 11, padding: '3px 10px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 20, color: 'var(--accent)', fontWeight: 600 }}>
            {totalMax} pts total
          </span>
        </div>
      )}

      {!hasRubric && (
        <div style={{ padding: 20, textAlign: 'center', border: '1.5px dashed var(--border2)', borderRadius: 8, marginBottom: 14, color: 'var(--text3)', fontSize: 13 }}>
          Import your Canvas rubric CSV once — it saves automatically and loads every time.
        </div>
      )}

      <div className="two-col" style={{ gap: 14, alignItems: 'start' }}>
        {/* Left: input */}
        <div>
          <div className="field">
            <label>Student name</label>
            <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)} placeholder="First and last name" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Student submission (initial post + peer responses)</label>
            <textarea rows={14} value={submission} onChange={e => setSubmission(e.target.value)}
              placeholder="Paste the student's full discussion post here…"
              style={{ fontSize: 13, lineHeight: 1.65, resize: 'vertical' }} />
          </div>
          <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600, marginTop: 10 }}
            onClick={gradeSubmission} disabled={grading || !submission.trim() || !hasRubric}>
            {grading ? 'Grading…' : 'Grade this submission →'}
          </button>
          {grading && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)', textAlign: 'center' }}>Analyzing against {rubricCriteria.length} criteria…</div>}
        </div>

        {/* Right: results */}
        <div>
          {!hasResult && !grading && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
              Results appear here.<br/>Three outputs ready to copy into Canvas.
            </div>
          )}

          {hasResult && (
            <>
              {/* Grade banner */}
              <div style={{ padding: '12px 16px', marginBottom: 12, background: `${totalColor()}12`, border: `2px solid ${totalColor()}40`, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: totalColor() }}>Final Grade</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginTop: 2 }}>{studentName}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 34, fontWeight: 700, color: totalColor() }}>{getTotal().toFixed(0)}</span>
                  <span style={{ fontSize: 15, color: 'var(--text2)' }}> / {totalMax}</span>
                  <div style={{ fontSize: 12, color: totalColor(), fontWeight: 500 }}>{getPct()}%</div>
                </div>
              </div>

              {/* Quick summary table */}
              <div className="card" style={{ marginBottom: 10, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)', marginBottom: 8 }}>Score summary</div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <tbody>
                    {rubricCriteria.map(c => {
                      const pts = scores[c.name] ?? 0;
                      const pct = pts / c.maxPoints;
                      const color = pct >= 0.9 ? 'var(--green)' : pct >= 0.8 ? 'var(--accent)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
                      const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
                      return (
                        <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '5px 0', color: 'var(--text2)' }}>{shortName}</td>
                          <td style={{ padding: '5px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 11 }}>{ratings[c.name] || ''}</td>
                          <td style={{ padding: '5px 0', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color }}>{pts}/{c.maxPoints}</td>
                        </tr>
                      );
                    })}
                    <tr>
                      <td style={{ padding: '6px 0', fontWeight: 700 }} colSpan={2}>Total</td>
                      <td style={{ padding: '6px 0', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 700, color: totalColor(), fontSize: 15 }}>{getTotal().toFixed(0)}/{totalMax}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Scoring Rationale block — instructor reference */}
              <div className="card" style={{ marginBottom: 10, background: 'var(--bg2)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text3)' }}>
                    Scoring Rationale (Instructor Reference)
                  </div>
                  <button
                    onClick={() => {
                      const lines = rubricCriteria.map(c => {
                        const pts = scores[c.name] ?? 0;
                        const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
                        const rat = rationale[c.name]?.scoring || '';
                        return `${shortName} (${pts}/${c.maxPoints}): ${rat}`;
                      }).join('\n');
                      navigator.clipboard.writeText('Scoring Rationale (Instructor Reference)\n\n' + lines);
                      setCopied('rationale-block');
                      setTimeout(() => setCopied(''), 2000);
                    }}
                    style={{ fontSize: 10, padding: '2px 8px',
                      background: copied === 'rationale-block' ? 'var(--accent)' : 'transparent',
                      color: copied === 'rationale-block' ? '#fff' : 'var(--text3)',
                      border: `1px solid ${copied === 'rationale-block' ? 'var(--accent)' : 'var(--border)'}` }}>
                    {copied === 'rationale-block' ? '✓ Copied' : 'Copy all rationale'}
                  </button>
                </div>
                {rubricCriteria.map(c => {
                  const pts = scores[c.name] ?? 0;
                  const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;
                  const rat = rationale[c.name]?.scoring || '';
                  return (
                    <div key={c.id} style={{ marginBottom: 8, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                      <span style={{ fontWeight: 700, fontSize: 12 }}>{shortName} ({pts}/{c.maxPoints}): </span>
                      <span style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.65 }}>{rat || <em style={{ color: 'var(--text3)' }}>No rationale recorded</em>}</span>
                    </div>
                  );
                })}
              </div>

              {/* Criterion scores */}
              {rubricCriteria.map(c => {
                const pts = scores[c.name] ?? 0;
                const rat = ratings[c.name] || '';
                const ratText = rationale[c.name] || {};
                const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;

                return (
                  <div key={c.id} className="card" style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{shortName}</div>
                    <button
                      onClick={() => {
                        const rat = rationale[c.name]?.student || '';
                        const rating = ratings[c.name] || '';
                        const pts = scores[c.name] ?? 0;
                        navigator.clipboard.writeText(`${pts} / ${c.maxPoints} pts — ${rating}${rat ? '\n' + rat : ''}`);
                        setCopied(`crit-${c.id}`);
                        setTimeout(() => setCopied(''), 2000);
                      }}
                      style={{ fontSize: 10, padding: '2px 8px',
                        background: copied === `crit-${c.id}` ? 'var(--accent)' : 'transparent',
                        color: copied === `crit-${c.id}` ? '#fff' : 'var(--text3)',
                        border: `1px solid ${copied === `crit-${c.id}` ? 'var(--accent)' : 'var(--border)'}` }}>
                      {copied === `crit-${c.id}` ? '✓ Copied' : 'Copy score + comment'}
                    </button>
                  </div>

                    {/* Rating buttons */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                      {c.ratings.sort((a,b) => b.points - a.points).map(r => (
                        <button key={r.name}
                          onClick={() => { setRatings(rv => ({...rv, [c.name]: r.name})); setScores(s => ({...s, [c.name]: r.points})); }}
                          style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 4,
                            background: rat === r.name ? `${RATING_COLORS[r.name]}18` : 'var(--bg)',
                            color: rat === r.name ? RATING_COLORS[r.name] : 'var(--text2)',
                            border: `1px solid ${rat === r.name ? RATING_COLORS[r.name] : 'var(--border2)'}`,
                            fontWeight: rat === r.name ? 700 : 400
                          }}>{r.name} · {r.points}</button>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                        <input type="number" value={pts} min="0" max={c.maxPoints} step="0.5"
                          onChange={e => setScores(s => ({...s, [c.name]: parseFloat(e.target.value)||0}))}
                          style={{ width: 50, fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', textAlign: 'center', padding: '3px 4px' }} />
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>/ {c.maxPoints}</span>
                      </div>
                    </div>

                    {/* Scoring rationale (instructor only) */}
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 3 }}>Scoring rationale (instructor only)</div>
                      <textarea rows={2} value={ratText.scoring || ''}
                        onChange={e => setRationale(r => ({...r, [c.name]: {...r[c.name], scoring: e.target.value}}))}
                        style={{ fontSize: 12, lineHeight: 1.5, background: 'var(--bg2)' }} />
                    </div>

                    {/* Student comment */}
                    <div>
                      <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 3 }}>Comment to student</div>
                      <textarea rows={2} value={ratText.student || ''}
                        onChange={e => setRationale(r => ({...r, [c.name]: {...r[c.name], student: e.target.value}}))}
                        style={{ fontSize: 12, lineHeight: 1.5 }} />
                    </div>
                  </div>
                );
              })}

              {/* Instructor feedback */}
              <div className="card" style={{ marginBottom: 10, borderColor: 'rgba(37,99,235,0.3)', borderWidth: 2 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)' }}>
                    Instructor Feedback to Student
                  </div>
                  <button onClick={() => copy(feedback, 'fb')} style={{ fontSize: 11, padding: '3px 10px', color: copied === 'fb' ? '#fff' : 'var(--accent)', background: copied === 'fb' ? 'var(--accent)' : 'transparent', border: '1px solid var(--accent)' }}>
                    {copied === 'fb' ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
                <textarea rows={5} value={feedback} onChange={e => setFeedback(e.target.value)}
                  style={{ fontSize: 13, lineHeight: 1.75, fontStyle: 'italic', marginBottom: 10 }} />

                {/* Regenerate controls */}
                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Regenerate with different parameters</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 10 }}>
                    <div>
                      <label>Tone</label>
                      <select value={tone} onChange={e => setTone(e.target.value)} style={{ fontSize: 12 }}>
                        <option value="warm">Warm mentor</option>
                        <option value="plain">Plain and direct</option>
                        <option value="formal">Formal academic</option>
                      </select>
                    </div>
                    <div>
                      <label>Length</label>
                      <select value={length} onChange={e => setLength(e.target.value)} style={{ fontSize: 12 }}>
                        <option value="short">Short (2-3 sentences)</option>
                        <option value="medium">Medium (3-4 sentences)</option>
                        <option value="long">Detailed (4-5 sentences)</option>
                      </select>
                    </div>
                    <div>
                      <label>Directness</label>
                      <select value={directness} onChange={e => setDirectness(e.target.value)} style={{ fontSize: 12 }}>
                        <option value="soft">Gentle</option>
                        <option value="balanced">Balanced</option>
                        <option value="direct">Direct</option>
                      </select>
                    </div>
                  </div>
                  <button onClick={regenerateFeedback} disabled={regenerating} style={{ width: '100%', fontSize: 12 }}>
                    {regenerating ? 'Regenerating…' : '↻ Regenerate feedback'}
                  </button>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="primary" style={{ padding: 12, fontSize: 14, fontWeight: 600 }}
                  onClick={() => copy(buildCanvasText(), 'all')}>
                  {copied === 'all' ? '✓ Copied — paste into Canvas SpeedGrader' : '📋 Copy all for Canvas SpeedGrader'}
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ flex: 1, fontSize: 12 }} onClick={downloadDocx}>
                    ↓ Download Word doc
                  </button>
                  <button style={{ flex: 1, fontSize: 12 }}
                    onClick={() => copy(`${getTotal().toFixed(0)} / ${totalMax}`, 'grade')}>
                    {copied === 'grade' ? '✓ Copied' : 'Copy final grade'}
                  </button>
                  <button style={{ fontSize: 12 }} onClick={nextStudent}>Next →</button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      {/* History panel */}
      {showHistory && (
        <div style={{ marginTop: 20, borderTop: '2px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 12 }}>
            Grading History — {selectedAssignment?.name}
          </div>
          {viewingHistory ? (
            <div>
              <button className="ghost" style={{ fontSize: 12, marginBottom: 12 }}
                onClick={() => setViewingHistory(null)}>← Back to list</button>
              <HistoryDetail grade={viewingHistory} rubricCriteria={rubricCriteria} />
            </div>
          ) : (
            <div>
              {history.map(g => (
                <div key={g.id} className="card card-hover" style={{ marginBottom: 6, padding: '10px 14px' }}
                  onClick={() => setViewingHistory(g)}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>{g.studentName || 'Unknown'}</div>
                      <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                        Graded {new Date(g.gradedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontFamily: 'var(--mono)', fontSize: 20, fontWeight: 700,
                        color: parseFloat(g.total)/parseFloat(g.maxScore) >= 0.9 ? 'var(--green)' :
                               parseFloat(g.total)/parseFloat(g.maxScore) >= 0.8 ? 'var(--accent)' : 'var(--amber)' }}>
                        {g.total}/{g.maxScore}
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--accent)' }}>View rationale →</span>
                    </div>
                  </div>
                  {g.key_improvement && (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>→ {g.key_improvement}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function HistoryDetail({ grade, rubricCriteria }) {
  const criteriaGrades = Array.isArray(grade.comments) ? grade.comments : [];
  const [copiedRationale, setCopiedRationale] = useState(false);

  function buildRationaleText() {
    const lines = [`${grade.studentName} — ${grade.assignmentName}`, `Total: ${grade.total}/${grade.maxScore}`, '', 'Scoring Rationale (Instructor Reference)', ''];
    criteriaGrades.forEach(cg => {
      const shortName = (cg.criterionName || '').split(':').pop().trim();
      lines.push(`${shortName} (${cg.finalPoints || cg.suggestedPoints}/${cg.maxPoints || 15}):`);
      lines.push(cg.scoringRationale || cg.studentComment || '');
      lines.push('');
    });
    if (grade.instructor_paragraph) {
      lines.push('Instructor Feedback:');
      lines.push(grade.instructor_paragraph);
    }
    return lines.join('\n');
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopiedRationale(true);
    setTimeout(() => setCopiedRationale(false), 2000);
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 17 }}>{grade.studentName}</div>
          <div style={{ fontSize: 12, color: 'var(--text2)' }}>
            {grade.assignmentName} · Graded {new Date(grade.gradedAt).toLocaleDateString()}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700,
            color: parseFloat(grade.total)/parseFloat(grade.maxScore) >= 0.9 ? 'var(--green)' :
                   parseFloat(grade.total)/parseFloat(grade.maxScore) >= 0.8 ? 'var(--accent)' : 'var(--amber)' }}>
            {grade.total}/{grade.maxScore}
          </span>
          <button onClick={() => copy(buildRationaleText())} style={{ fontSize: 12 }}>
            {copiedRationale ? '✓ Copied' : 'Copy rationale'}
          </button>
        </div>
      </div>

      {criteriaGrades.length > 0 ? (
        criteriaGrades.map((cg, i) => {
          const shortName = (cg.criterionName || '').split(':').pop().trim();
          const pts = cg.finalPoints || cg.suggestedPoints || 0;
          const maxPts = cg.maxPoints || 15;
          return (
            <div key={i} className="card" style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{shortName}</span>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {cg.suggestedRating && (
                    <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4,
                      color: {'Accomplished':'#16A34A','Proficient':'#2563EB','Needs Improvement':'#D97706','Unacceptable':'#DC2626'}[cg.suggestedRating] || 'var(--text2)',
                      background: {'Accomplished':'rgba(22,163,74,0.1)','Proficient':'rgba(37,99,235,0.1)','Needs Improvement':'rgba(217,119,6,0.1)','Unacceptable':'rgba(220,38,38,0.1)'}[cg.suggestedRating] || 'var(--bg3)',
                      border: '1px solid currentColor' }}>
                      {cg.suggestedRating}
                    </span>
                  )}
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16 }}>
                    {pts}/{maxPts}
                  </span>
                </div>
              </div>
              {cg.scoringRationale && (
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 3 }}>Scoring rationale</div>
                  <div style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text)', padding: '8px 10px', background: 'var(--bg2)', borderRadius: 5, borderLeft: '3px solid var(--border2)' }}>
                    {cg.scoringRationale}
                  </div>
                </div>
              )}
              {cg.studentComment && (
                <div>
                  <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 3 }}>Comment to student</div>
                  <div style={{ fontSize: 12, lineHeight: 1.65, color: 'var(--text2)', fontStyle: 'italic' }}>{cg.studentComment}</div>
                </div>
              )}
            </div>
          );
        })
      ) : (
        <div style={{ fontSize: 13, color: 'var(--text3)', padding: '20px 0', textAlign: 'center' }}>
          No per-criterion rationale stored for this grade.<br/>
          Grades from the new grader will have full rationale.
        </div>
      )}

      {grade.instructor_paragraph && (
        <div style={{ marginTop: 10, padding: '12px 16px', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)', marginBottom: 6 }}>Instructor Feedback</div>
          <p style={{ fontSize: 13, lineHeight: 1.75, fontStyle: 'italic', margin: 0 }}>{grade.instructor_paragraph}</p>
        </div>
      )}
    </div>
  );
}


// ── Completion / Pass-Fail Grader (UMD style) ──────────────────────────────

function CompletionGrader({ course, password, assignments }) {
  const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
  const [selectedAssignment, setSelectedAssignment] = useState(assignments?.[0] || null);
  const [studentName, setStudentName] = useState('');
  const [submission, setSubmission] = useState('');
  const [comment, setComment] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [history, setHistory] = useState([]);

  const maxPts = selectedAssignment?.maxScore || 10;

  async function markComplete() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/discussgrade/grade`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id,
          assignmentId: selectedAssignment?.id,
          studentName,
          discussionQuestion: '',
          submission,
          rubricCriteria: [{ id: 'completion', name: 'Completion', maxPoints: maxPts, ratings: [
            { name: 'Complete', points: maxPts, description: 'Post submitted' },
            { name: 'Incomplete', points: 0, description: 'No post submitted' }
          ]}],
          instructorBio: course.instructorBio
        })
      });
      setHistory(h => [{ studentName, comment, pts: maxPts, date: new Date() }, ...h]);
      setSaved(true);
      setStudentName('');
      setSubmission('');
      setComment('');
      setTimeout(() => setSaved(false), 2000);
    } catch (e) { alert(e.message); }
    setSaving(false);
  }

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Grade Discussion</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>Completion grading · {maxPts} pts for participating</div>
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
          <label>Student post (optional — paste to keep a record)</label>
          <textarea rows={6} value={submission} onChange={e => setSubmission(e.target.value)}
            placeholder="Paste student's post here to keep it on record…"
            style={{ fontSize: 13, lineHeight: 1.6 }} />
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <label>Comment to student (optional)</label>
          <textarea rows={2} value={comment} onChange={e => setComment(e.target.value)}
            placeholder="Any feedback you want to leave…" style={{ fontSize: 13 }} />
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="primary" style={{ flex: 1, padding: 12, fontSize: 14, fontWeight: 600 }}
          onClick={markComplete} disabled={saving || !studentName.trim()}>
          {saving ? 'Saving…' : saved ? `✓ Marked complete — ${maxPts}/${maxPts} pts` : `Mark complete — ${maxPts}/${maxPts} pts`}
        </button>
        <button style={{ fontSize: 13, padding: '12px 16px' }}
          onClick={() => { setStudentName(''); setSubmission(''); setComment(''); }}>
          Clear
        </button>
      </div>

      {history.length > 0 && (
        <div style={{ marginTop: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 10 }}>
            Marked complete this session ({history.length})
          </div>
          {history.map((h, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 12px',
              background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4, fontSize: 13 }}>
              <span style={{ fontWeight: 500 }}>{h.studentName}</span>
              <span style={{ color: 'var(--green)', fontWeight: 600 }}>{h.pts}/{maxPts} pts</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
