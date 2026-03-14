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
      lines.push(`${c.name.split(':').pop().trim()}: ${pts}/${c.maxPoints} pts — ${ratings[c.name] || ''}`);
      if (rat) lines.push(rat);
      lines.push('');
    });
    lines.push(`Total: ${getTotal().toFixed(0)} / ${totalMax} pts`);
    if (feedback) { lines.push(''); lines.push(feedback); }
    return lines.join('\n');
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
  }

  const hasRubric = rubricCriteria.length > 0;
  const hasResult = result !== null;

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

              {/* Criterion scores */}
              {rubricCriteria.map(c => {
                const pts = scores[c.name] ?? 0;
                const rat = ratings[c.name] || '';
                const ratText = rationale[c.name] || {};
                const shortName = c.name.includes(':') ? c.name.split(':').pop().trim() : c.name;

                return (
                  <div key={c.id} className="card" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>{shortName}</div>

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
    </div>
  );
}
