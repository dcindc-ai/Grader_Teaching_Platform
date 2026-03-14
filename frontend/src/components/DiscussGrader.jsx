import { useState, useRef, useEffect } from 'react';
import { updateAssignment } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const RATING_ORDER = ['Accomplished', 'Proficient', 'Needs Improvement', 'Unacceptable'];
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
  const [comments, setComments] = useState({});
  const [feedback, setFeedback] = useState('');
  const [copied, setCopied] = useState('');
  const [importingRubric, setImportingRubric] = useState(false);
  const csvRef = useRef();

  // When assignment changes, load its saved rubric
  useEffect(() => {
    if (selectedAssignment?.rubricCriteria) {
      setRubricCriteria(selectedAssignment.rubricCriteria);
      setTotalMax(selectedAssignment.rubricCriteria.reduce((s, c) => s + c.maxPoints, 0));
    }
  }, [selectedAssignment?.id]);

  // Default to first discussion assignment
  useEffect(() => {
    const disc = assignments?.find(a => a.type === 'discussion') || assignments?.[0];
    if (disc) setSelectedAssignment(disc);
  }, [assignments?.length]);

  async function importRubricCSV(csvText) {
    setImportingRubric(true);
    try {
      const r = await fetch(`${BASE}/api/discussgrade/parse-rubric`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv: csvText })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setRubricCriteria(d.criteria);
      setTotalMax(d.totalMax);

      // Save rubric to assignment so it loads automatically next time
      if (selectedAssignment) {
        await updateAssignment(selectedAssignment.id, {
          ...selectedAssignment,
          rubricCriteria: d.criteria,
          maxScore: d.totalMax
        }, password);
        setSelectedAssignment(a => ({ ...a, rubricCriteria: d.criteria, maxScore: d.totalMax }));
      }
    } catch (e) {
      alert('Rubric import error: ' + e.message);
    }
    setImportingRubric(false);
  }

  async function gradeSubmission() {
    if (!submission.trim() || !rubricCriteria.length) return;
    setGrading(true);
    setResult(null);
    try {
      const r = await fetch(`${BASE}/api/discussgrade/grade`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courseId: course.id,
          assignmentId: selectedAssignment?.id,
          studentName,
          discussionQuestion: selectedAssignment?.description || course.discussionDefaultQuestion || '',
          submission,
          rubricCriteria,
          instructorBio: course.instructorBio
        })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);

      setResult(d);
      setFeedback(d.instructorParagraph || '');

      // Initialize scores and comments from AI suggestions
      const initScores = {}, initComments = {};
      d.criteriaGrades?.forEach(cg => {
        initScores[cg.criterionName] = cg.suggestedPoints;
        initComments[cg.criterionName] = cg.comment;
      });
      setScores(initScores);
      setComments(initComments);
    } catch (e) {
      alert('Grading error: ' + e.message);
    }
    setGrading(false);
  }

  function getTotal() {
    return Object.values(scores).reduce((s, v) => s + (parseFloat(v) || 0), 0);
  }

  function getPct() {
    return totalMax > 0 ? Math.round(getTotal() / totalMax * 100) : 0;
  }

  function totalColor() {
    const p = getPct();
    return p >= 90 ? '#16A34A' : p >= 80 ? '#2563EB' : p >= 70 ? '#D97706' : '#DC2626';
  }

  function buildCanvasOutput() {
    const lines = [];
    rubricCriteria.forEach(c => {
      const pts = scores[c.name] || 0;
      const comment = comments[c.name] || '';
      lines.push(`${c.name}: ${pts}/${c.maxPoints} pts`);
      if (comment) lines.push(comment);
      lines.push('');
    });
    lines.push(`Total: ${getTotal().toFixed(1)} / ${totalMax} pts`);
    lines.push('');
    if (feedback) {
      lines.push(feedback);
    }
    return lines.join('\n');
  }

  function copy(text, key) {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(''), 2500);
  }

  function nextStudent() {
    setStudentName('');
    setSubmission('');
    setResult(null);
    setScores({});
    setComments({});
    setFeedback('');
  }

  const hasRubric = rubricCriteria.length > 0;
  const hasResult = result !== null;

  return (
    <div style={{ maxWidth: 820 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 19, fontWeight: 700 }}>Grade Discussion</div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>Rubric grading · Canvas-ready output</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Assignment selector */}
          <select value={selectedAssignment?.id || ''} style={{ fontSize: 13 }}
            onChange={e => {
              const a = assignments?.find(x => x.id === e.target.value);
              setSelectedAssignment(a || null);
            }}>
            {assignments?.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          {/* Rubric import */}
          <input ref={csvRef} type="file" accept=".csv" style={{ display: 'none' }}
            onChange={async e => {
              const file = e.target.files[0];
              if (!file) return;
              const text = await file.text();
              importRubricCSV(text);
              e.target.value = '';
            }} />
          <button onClick={() => csvRef.current.click()} disabled={importingRubric} style={{ fontSize: 12 }}>
            {importingRubric ? 'Importing…' : hasRubric ? '↺ Update rubric' : '↑ Import rubric CSV'}
          </button>
        </div>
      </div>

      {/* Rubric status */}
      {hasRubric && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {rubricCriteria.map(c => (
            <span key={c.id} style={{ fontSize: 11, padding: '3px 10px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text2)' }}>
              {c.name.split(':').pop().trim()} · {c.maxPoints}pts
            </span>
          ))}
          <span style={{ fontSize: 11, padding: '3px 10px', background: 'rgba(37,99,235,0.08)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 20, color: 'var(--accent)', fontWeight: 600 }}>
            Total: {totalMax} pts
          </span>
        </div>
      )}

      {!hasRubric && (
        <div style={{ padding: '20px', textAlign: 'center', border: '1.5px dashed var(--border2)', borderRadius: 8, marginBottom: 16, color: 'var(--text3)', fontSize: 13 }}>
          Import a rubric CSV to get started. The rubric saves automatically and loads next time.
        </div>
      )}

      {/* Student + submission */}
      <div className="two-col" style={{ gap: 14, alignItems: 'start' }}>
        <div>
          <div className="field">
            <label>Student name</label>
            <input type="text" value={studentName} onChange={e => setStudentName(e.target.value)}
              placeholder="First and last name" />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>Paste student submission</label>
            <textarea rows={14} value={submission} onChange={e => setSubmission(e.target.value)}
              placeholder="Paste the student's full post here — initial post plus any peer responses they wrote…"
              style={{ fontSize: 13, lineHeight: 1.65, resize: 'vertical' }} />
          </div>
          <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600, marginTop: 10 }}
            onClick={gradeSubmission}
            disabled={grading || !submission.trim() || !hasRubric}>
            {grading ? 'Grading…' : 'Grade this submission →'}
          </button>
          {grading && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--accent)', textAlign: 'center' }}>
              Analyzing against {rubricCriteria.length} rubric criteria…
            </div>
          )}
        </div>

        {/* Results */}
        <div>
          {!hasResult && !grading && (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📋</div>
              Paste the student's post and click Grade.<br />
              Results appear here ready to copy into Canvas.
            </div>
          )}

          {hasResult && (
            <>
              {/* Final grade banner */}
              <div style={{
                padding: '14px 16px', marginBottom: 12,
                background: `${totalColor()}12`,
                border: `2px solid ${totalColor()}40`,
                borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center'
              }}>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', color: totalColor() }}>Final Grade</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{studentName || 'Student'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 36, fontWeight: 700, color: totalColor() }}>
                    {getTotal().toFixed(1)}
                  </span>
                  <span style={{ fontSize: 16, color: 'var(--text2)' }}> / {totalMax}</span>
                  <div style={{ fontSize: 12, color: totalColor(), fontWeight: 500 }}>{getPct()}%</div>
                </div>
              </div>

              {/* Criterion scores */}
              {rubricCriteria.map(c => {
                const pts = scores[c.name] ?? 0;
                const comment = comments[c.name] ?? '';
                const cg = result.criteriaGrades?.find(x => x.criterionName === c.name);
                return (
                  <div key={c.id} className="card" style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>
                      {c.name.includes(':') ? c.name.split(':').pop().trim() : c.name}
                    </div>

                    {/* Rating buttons */}
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
                      {c.ratings.sort((a,b) => b.points - a.points).map(r => (
                        <button key={r.name}
                          onClick={() => setScores(s => ({ ...s, [c.name]: r.points }))}
                          style={{
                            fontSize: 11, padding: '4px 10px', borderRadius: 4,
                            background: parseFloat(pts) === r.points ? `${RATING_COLORS[r.name]}18` : 'var(--bg)',
                            color: parseFloat(pts) === r.points ? RATING_COLORS[r.name] : 'var(--text2)',
                            border: `1px solid ${parseFloat(pts) === r.points ? RATING_COLORS[r.name] : 'var(--border2)'}`,
                            fontWeight: parseFloat(pts) === r.points ? 700 : 400
                          }}>
                          {r.name} · {r.points}
                        </button>
                      ))}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 'auto' }}>
                        <input type="number" value={pts} min="0" max={c.maxPoints} step="0.5"
                          onChange={e => setScores(s => ({ ...s, [c.name]: parseFloat(e.target.value) || 0 }))}
                          style={{ width: 52, fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', textAlign: 'center', padding: '3px 4px' }} />
                        <span style={{ fontSize: 12, color: 'var(--text3)' }}>/ {c.maxPoints}</span>
                      </div>
                    </div>

                    {/* Evidence */}
                    {cg?.evidence && (
                      <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 6, padding: '5px 8px', background: 'var(--bg2)', borderRadius: 4, borderLeft: '2px solid var(--border2)' }}>
                        "{cg.evidence}"
                      </div>
                    )}

                    {/* Comment */}
                    <textarea rows={2} value={comment}
                      onChange={e => setComments(c2 => ({ ...c2, [c.name]: e.target.value }))}
                      placeholder="Add a comment for this criterion…"
                      style={{ fontSize: 12, lineHeight: 1.5, marginBottom: 0 }} />
                  </div>
                );
              })}

              {/* Instructor feedback paragraph */}
              <div style={{ marginBottom: 12 }}>
                <label>Instructor feedback (3-4 sentences)</label>
                <textarea rows={4} value={feedback} onChange={e => setFeedback(e.target.value)}
                  style={{ fontSize: 13, lineHeight: 1.7 }} />
              </div>

              {/* Copy outputs */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button className="primary" style={{ padding: '11px', fontSize: 13, fontWeight: 600 }}
                  onClick={() => copy(buildCanvasOutput(), 'all')}>
                  {copied === 'all' ? '✓ Copied! Paste into Canvas SpeedGrader' : '📋 Copy all grades + feedback for Canvas'}
                </button>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button style={{ flex: 1, fontSize: 12 }}
                    onClick={() => copy(feedback, 'fb')}>
                    {copied === 'fb' ? '✓ Copied' : 'Copy feedback only'}
                  </button>
                  <button style={{ flex: 1, fontSize: 12 }}
                    onClick={() => copy(`${getTotal().toFixed(1)} / ${totalMax}`, 'grade')}>
                    {copied === 'grade' ? '✓ Copied' : 'Copy final grade'}
                  </button>
                  <button style={{ fontSize: 12 }} onClick={nextStudent}>
                    Next student →
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
