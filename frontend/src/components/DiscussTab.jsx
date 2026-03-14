const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

import DiscussGrader from './DiscussGrader.jsx';
import { useState } from 'react';
import { generateReply, generateSummary } from '../api.js';

export default function DiscussTab({ course, password, session, onSession, assignments }) {
  const submissions = session?.submissions || [];
  const savedQuestion = session?.question || '';
  const [question, setQuestion] = useState(savedQuestion || course.discussionDefaultQuestion || '');
  const [editingQ, setEditingQ] = useState(false);
  const [name, setName] = useState('');
  const [studentAnswer, setStudentAnswer] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [view, setView] = useState('respond');

  // Response controls
  const [tone, setTone] = useState('warm');
  const [sentences, setSentences] = useState(6);
  const [wordsPerSentence, setWordsPerSentence] = useState(18);
  const [structure, setStructure] = useState('organized');
  const [refinement, setRefinement] = useState('');
  const [students, setStudents] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [studentHistory, setStudentHistory] = useState([]);
  const [studentSearch, setStudentSearch] = useState('');
  const [loadingStudents, setLoadingStudents] = useState(false);

  async function loadStudents() {
    setLoadingStudents(true);
    try {
      const r = await fetch(`${BASE}/api/discuss/students?courseId=${course.id}`, {
        headers: { 'x-admin-password': password }
      });
      setStudents(await r.json());
    } catch (e) {}
    setLoadingStudents(false);
  }

  async function loadStudentHistory(name) {
    try {
      const r = await fetch(`${BASE}/api/discuss/student?courseId=${course.id}&studentName=${encodeURIComponent(name)}`, {
        headers: { 'x-admin-password': password }
      });
      setStudentHistory(await r.json());
      setSelectedStudent(name);
    } catch (e) {}
  }

  async function handleGenerate() {
    if (!name.trim() || !studentAnswer.trim() || !question.trim()) return;
    setLoading(true);
    setResponse('');
    setCopied(false);
    try {
      const { reply } = await generateReply({
        courseId: course.id,
        question,
        studentName: name,
        studentResponse: studentAnswer,
        tone,
        sentenceCount: sentences,
        wordsPerSentence,
        structure
      }, password);
      setResponse(reply);
      onSession(s => ({ ...s, submissions: [...(s.submissions||[]), { name: name.trim(), answer: studentAnswer.trim() }], question }));
    } catch (e) { setResponse('Error: ' + e.message); }
    setLoading(false);
  }

  async function handleRegenerate() {
    if (!name.trim() || !studentAnswer.trim()) return;
    setLoading(true);
    setCopied(false);
    try {
      const { reply } = await generateReply({
        courseId: course.id, question,
        studentName: name, studentResponse: studentAnswer,
        tone, sentenceCount: sentences, wordsPerSentence, structure,
        refinement, previousResponse: response
      }, password);
      setResponse(reply);
      setRefinement('');
    } catch (e) { setResponse('Error: ' + e.message); }
    setLoading(false);
  }

  async function handleSummary() {
    if (submissions.length < 2) return;
    setSummaryLoading(true);
    setSummary('');
    try {
      const { summary: s } = await generateSummary({ courseId: course.id, question, submissions }, password);
      setSummary(s);
    } catch (e) { setSummary('Error: ' + e.message); }
    setSummaryLoading(false);
  }

  function nextStudent() {
    setName('');
    setStudentAnswer('');
    setResponse('');
    setCopied(false);
  }

  function handleNewDiscussion() {
    setQuestion('');
    onSession(() => ({ submissions: [], question: '' }));
    setSummary('');
    setResponse('');
    setName('');
    setStudentAnswer('');
    setEditingQ(true);
    setView('respond');
  }

  const color = course.color || '#4f8ef7';

  return (
    <div style={{ maxWidth: 760 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Discussion</div>
          <div className="page-sub">Respond to students · Grade with rubric · Class summary</div>
        </div>
        <button style={{ fontSize: 12 }} onClick={handleNewDiscussion}>+ New discussion</button>
      </div>

      {/* Discussion question */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <label style={{ margin: 0 }}>Discussion question</label>
          <button className="ghost" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => setEditingQ(e => !e)}>
            {editingQ ? 'Done' : 'Edit'}
          </button>
        </div>
        {editingQ
          ? <textarea rows={6} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Paste your discussion question here…" />
          : <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 80, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)', margin: 0, fontStyle: 'italic' }}>
              {question || 'No question set. Click Edit to add one.'}
            </p>
        }
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['respond', 'summary', 'grade', 'students'].map(t => (
          <button key={t} onClick={() => setView(t)} style={{
            flex: 1, padding: 10, fontSize: 12,
            background: view === t ? color : 'var(--bg)',
            color: view === t ? '#fff' : 'var(--text2)',
            border: `1px solid ${view === t ? color : 'var(--border2)'}`,
            fontWeight: view === t ? 600 : 400
          }}>
            {t === 'respond' ? 'Respond to Student'
              : t === 'summary' ? `Class Summary${submissions.length > 0 ? ` (${submissions.length})` : ''}`
              : t === 'grade' ? '🎯 Grade Discussion'
              : '👥 Students'}
          </button>
        ))}
      </div>

      {/* ── Respond to Student ─────────────────────────────────────────── */}
      {view === 'respond' && (
        <div>
          <div className="two-col" style={{ gap: 14, alignItems: 'start' }}>
            {/* Left: input + controls */}
            <div>
              <div className="field">
                <label>Student name</label>
                <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" />
              </div>
              <div className="field">
                <label>Student submission (paste full post + peer responses)</label>
                <textarea rows={12} value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)}
                  placeholder="Paste the student's complete discussion submission here…"
                  style={{ fontSize: 13, lineHeight: 1.65, resize: 'vertical' }} />
              </div>

              {/* Controls */}
              <div className="card" style={{ marginBottom: 10, background: 'var(--bg2)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text3)', marginBottom: 12 }}>Response controls</div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                  <div>
                    <label>Tone</label>
                    <select value={tone} onChange={e => setTone(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="warm">Warm mentor</option>
                      <option value="direct">Plain and direct</option>
                      <option value="formal">Formal academic</option>
                    </select>
                  </div>
                  <div>
                    <label>Structure</label>
                    <select value={structure} onChange={e => setStructure(e.target.value)} style={{ fontSize: 12 }}>
                      <option value="organized">Strengths → gaps → forward</option>
                      <option value="flowing">Weave together</option>
                      <option value="critical">Gaps first → strengths</option>
                    </select>
                  </div>
                </div>

                <div style={{ marginBottom: 10 }}>
                  <label>Sentences: <strong>{sentences}</strong></label>
                  <input type="range" min={3} max={10} value={sentences} onChange={e => setSentences(Number(e.target.value))} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
                    <span>3 (short)</span><span>6 (standard)</span><span>10 (detailed)</span>
                  </div>
                </div>

                <div>
                  <label>Max words per sentence: <strong>{wordsPerSentence}</strong></label>
                  <input type="range" min={10} max={25} value={wordsPerSentence} onChange={e => setWordsPerSentence(Number(e.target.value))} />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
                    <span>10 (punchy)</span><span>18 (standard)</span><span>25 (flowing)</span>
                  </div>
                </div>
              </div>

              <button className="primary" style={{ width: '100%', padding: 12, fontSize: 14, fontWeight: 600 }}
                onClick={handleGenerate} disabled={loading || !name.trim() || !studentAnswer.trim() || !question.trim()}>
                {loading ? 'Generating…' : 'Generate response →'}
              </button>
            </div>

            {/* Right: output */}
            <div>
              {response ? (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <label style={{ margin: 0 }}>Instructor response</label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={handleRegenerate} disabled={loading} style={{ fontSize: 11, padding: '3px 10px' }}>
                        {loading ? '…' : '↻ Regenerate'}
                      </button>
                      <button onClick={() => { navigator.clipboard.writeText(response); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                        style={{ fontSize: 11, padding: '3px 10px', background: copied ? 'var(--accent)' : 'transparent', color: copied ? '#fff' : 'var(--accent)', border: '1px solid var(--accent)' }}>
                        {copied ? '✓ Copied' : 'Copy'}
                      </button>
                    </div>
                  </div>

                  {/* Editable response */}
                  <textarea
                    value={response}
                    onChange={e => setResponse(e.target.value)}
                    style={{ width: '100%', minHeight: 220, fontSize: 14, lineHeight: 1.8, padding: '12px 14px', fontStyle: 'italic', border: '2px solid rgba(37,99,235,0.25)', borderRadius: 8, background: 'rgba(37,99,235,0.03)', resize: 'vertical' }}
                  />

                  <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4, marginBottom: 10 }}>
                    Edit directly above, or give specific instructions below and regenerate.
                  </div>

                  {/* Refinement instruction box */}
                  <div style={{ marginBottom: 10 }}>
                    <label>Specific instruction for next regeneration</label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input type="text" value={refinement} onChange={e => setRefinement(e.target.value)}
                        placeholder="e.g. Don't mention word count. Focus on the missing Sambasivan citation instead."
                        onKeyDown={e => e.key === 'Enter' && handleRegenerate()}
                        style={{ flex: 1, fontSize: 13 }} />
                      <button onClick={handleRegenerate} disabled={loading || !refinement.trim()}
                        className="primary" style={{ fontSize: 12, padding: '0 14px', flexShrink: 0 }}>
                        {loading ? '…' : '↻ Apply'}
                      </button>
                    </div>
                  </div>

                  {/* Word / sentence stats */}
                  <div style={{ display: 'flex', gap: 12, fontSize: 11, color: 'var(--text3)', marginBottom: 12 }}>
                    <span>{response.split(/\s+/).filter(Boolean).length} words</span>
                    <span>{response.split(/[.!?]+/).filter(s => s.trim()).length} sentences</span>
                    <span>avg {Math.round(response.split(/\s+/).filter(Boolean).length / Math.max(1, response.split(/[.!?]+/).filter(s => s.trim()).length))} words/sentence</span>
                  </div>

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="primary" style={{ flex: 1, fontSize: 13 }}
                      onClick={() => { navigator.clipboard.writeText(response); setCopied(true); setTimeout(() => setCopied(false), 2000); }}>
                      {copied ? '✓ Copied' : '📋 Copy to Canvas'}
                    </button>
                    <button style={{ fontSize: 13 }} onClick={nextStudent}>Next student →</button>
                  </div>
                </>
              ) : (
                <div style={{ padding: '60px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>✏️</div>
                  Paste the student's post and click Generate.<br />
                  Edit the result directly or adjust the controls<br />and regenerate.
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Class Summary ──────────────────────────────────────────────── */}
      {view === 'summary' && (
        <div>
          {submissions.length < 2
            ? <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                Add at least 2 student responses on the Respond tab to generate a class summary.
              </div>
            : <>
                <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text2)' }}>
                  {submissions.length} student responses collected.
                </div>
                <button className="primary" style={{ width: '100%', padding: 12, marginBottom: 12 }}
                  onClick={handleSummary} disabled={summaryLoading}>
                  {summaryLoading ? 'Generating summary…' : 'Generate class summary'}
                </button>
                {summary && (
                  <>
                    <textarea value={summary} onChange={e => setSummary(e.target.value)}
                      style={{ width: '100%', minHeight: 180, fontSize: 14, lineHeight: 1.8, padding: '12px 14px', border: '2px solid rgba(37,99,235,0.25)', borderRadius: 8, background: 'rgba(37,99,235,0.03)', resize: 'vertical' }} />
                    <button style={{ marginTop: 8, fontSize: 13 }}
                      onClick={() => { navigator.clipboard.writeText(summary); setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }}>
                      {summaryCopied ? '✓ Copied' : '📋 Copy'}
                    </button>
                  </>
                )}
              </>
          }
        </div>
      )}

      {/* ── Students ─────────────────────────────────────────────────────── */}
      {view === 'students' && (
        <div>
          {!selectedStudent ? (
            <>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <input type="text" value={studentSearch} onChange={e => setStudentSearch(e.target.value)}
                  placeholder="Search by name…" style={{ flex: 1, fontSize: 13 }} />
                <button onClick={loadStudents} disabled={loadingStudents} style={{ fontSize: 12 }}>
                  {loadingStudents ? 'Loading…' : '↻ Refresh'}
                </button>
              </div>
              {students.length === 0 && !loadingStudents && (
                <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
                  <div style={{ fontSize: 28, marginBottom: 10 }}>👥</div>
                  No discussion history yet.<br/>Students appear here after you generate responses.
                  <div style={{ marginTop: 12 }}>
                    <button onClick={loadStudents} className="primary" style={{ fontSize: 12 }}>Load students</button>
                  </div>
                </div>
              )}
              {students
                .filter(s => !studentSearch || s.student_name?.toLowerCase().includes(studentSearch.toLowerCase()))
                .map((s, i) => (
                  <div key={i} className="card card-hover" style={{ marginBottom: 6, padding: '10px 14px' }}
                    onClick={() => loadStudentHistory(s.student_name)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div>
                        <div style={{ fontWeight: 600, fontSize: 14 }}>{s.student_name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                          First seen {new Date(s.first_seen).toLocaleDateString()} · Last {new Date(s.last_seen).toLocaleDateString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span className="badge">{s.response_count} discussion{s.response_count !== 1 ? 's' : ''}</span>
                        <span style={{ fontSize: 12, color: 'var(--accent)' }}>View →</span>
                      </div>
                    </div>
                  </div>
                ))}
            </>
          ) : (
            <div>
              <button className="ghost" style={{ fontSize: 12, marginBottom: 14 }}
                onClick={() => { setSelectedStudent(null); setStudentHistory([]); }}>
                ← Back to all students
              </button>
              <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{selectedStudent}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
                {studentHistory.length} discussion response{studentHistory.length !== 1 ? 's' : ''} on record
              </div>
              {studentHistory.map((d, i) => (
                <div key={i} className="card" style={{ marginBottom: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)' }}>
                      {new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6, fontStyle: 'italic', lineHeight: 1.5, borderLeft: '2px solid var(--border2)', paddingLeft: 8 }}>
                    Q: {(d.question || '').slice(0, 120)}{(d.question || '').length > 120 ? '…' : ''}
                  </div>
                  <div style={{ fontSize: 13, lineHeight: 1.75, color: 'var(--text)', fontStyle: 'italic',
                    padding: '10px 12px', background: 'rgba(37,99,235,0.04)',
                    border: '1px solid rgba(37,99,235,0.15)', borderRadius: 6 }}>
                    {d.instructor_reply}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Grade Discussion ───────────────────────────────────────────── */}
      {view === 'grade' && (
        <DiscussGrader course={course} password={password} assignments={assignments || []} />
      )}
    </div>
  );
}
