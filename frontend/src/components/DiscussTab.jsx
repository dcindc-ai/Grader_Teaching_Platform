import { useState } from 'react';
import { generateReply, generateSummary } from '../api.js';

export default function DiscussTab({ course, password }) {
  const [question, setQuestion] = useState(course.discussionDefaultQuestion || '');
  const [editingQ, setEditingQ] = useState(false);
  const [name, setName] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [submissions, setSubmissions] = useState([]);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [view, setView] = useState('respond');
  const [studentAnswer, setStudentAnswer] = useState('');

  async function handleGenerate() {
    if (!name.trim() || !studentAnswer.trim() || !question.trim()) return;
    setLoading(true);
    setResponse('');
    setError('');
    setCopied(false);
    try {
      const { reply } = await generateReply({
        courseId: course.id,
        question,
        studentName: name,
        studentResponse: studentAnswer
      }, password);
      setResponse(reply);
      setSubmissions(s => [...s, { name: name.trim(), answer: studentAnswer.trim() }]);
    } catch (e) { setError(e.message); }
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

  function handleNewDiscussion() {
    setQuestion('');
    setSubmissions([]);
    setSummary('');
    setResponse('');
    setName('');
    setStudentAnswer('');
    setEditingQ(true);
    setView('respond');
  }

  const color = course.color || '#4f8ef7';

  return (
    <div style={{ maxWidth: 660 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Discussion Responder</div>
          <div className="page-sub">Generate personalized replies in your instructor voice</div>
        </div>
        <button style={{ fontSize: 12 }} onClick={handleNewDiscussion}>+ New discussion</button>
      </div>

      {/* Discussion question */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <label style={{ margin: 0 }}>Discussion question</label>
          <button className="ghost" style={{ fontSize: 12, padding: '2px 8px' }} onClick={() => setEditingQ(e => !e)}>
            {editingQ ? 'Done' : 'Edit'}
          </button>
        </div>
        {editingQ
          ? <textarea rows={6} value={question} onChange={e => setQuestion(e.target.value)} placeholder="Paste your discussion question here…" />
          : <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, whiteSpace: 'pre-wrap', maxHeight: 100, overflow: 'hidden', WebkitMaskImage: 'linear-gradient(to bottom, black 60%, transparent 100%)', margin: 0, fontStyle: 'italic' }}>
              {question || 'No question set. Click Edit to add one.'}
            </p>
        }
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {['respond', 'summary'].map(t => (
          <button key={t} onClick={() => setView(t)} style={{
            flex: 1, padding: 10, fontSize: 12, letterSpacing: '0.05em',
            background: view === t ? color : 'var(--bg3)',
            color: view === t ? '#fff' : 'var(--text2)',
            border: `1px solid ${view === t ? color : 'var(--border2)'}`,
            fontWeight: view === t ? 500 : 400
          }}>
            {t === 'respond' ? 'Respond to Student' : `Class Summary${submissions.length > 0 ? ` (${submissions.length})` : ''}`}
          </button>
        ))}
      </div>

      {view === 'respond' && (
        <>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="field">
              <label>Student name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="First and last name" />
            </div>
            <div className="field" style={{ marginBottom: 0 }}>
              <label>Student's response</label>
              <textarea rows={7} value={studentAnswer} onChange={e => setStudentAnswer(e.target.value)} placeholder="Paste the student's discussion post here…" />
            </div>
          </div>
          <button
            className="primary"
            style={{ width: '100%', padding: 12, fontSize: 14 }}
            onClick={handleGenerate}
            disabled={loading || !name.trim() || !studentAnswer.trim() || !question.trim()}
          >
            {loading ? 'Generating…' : 'Generate Response'}
          </button>

          {error && <div style={{ marginTop: 12, padding: '12px 14px', background: 'rgba(224,82,82,0.08)', border: '1px solid var(--red)', borderRadius: 8, fontSize: 13, color: 'var(--red)' }}>{error}</div>}

          {response && (
            <div style={{ marginTop: 16, padding: '20px 22px', background: 'var(--bg2)', border: `2px solid ${color}`, borderRadius: 10, boxShadow: `0 4px 20px ${color}22` }}>
              <div style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: color, marginBottom: 12, fontWeight: 600 }}>Suggested Response</div>
              <p style={{ fontSize: 16, lineHeight: 1.85, fontStyle: 'italic', color: 'var(--text)', marginBottom: 16 }}>{response}</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => { navigator.clipboard.writeText(response); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
                  style={{ fontSize: 12, background: copied ? color : 'transparent', color: copied ? '#fff' : color, borderColor: color }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
                <button className="ghost" style={{ fontSize: 12 }} onClick={() => { setName(''); setStudentAnswer(''); setResponse(''); }}>Next student</button>
              </div>
            </div>
          )}
        </>
      )}

      {view === 'summary' && (
        <div className="card">
          {submissions.length < 2 ? (
            <p style={{ color: 'var(--text3)', fontStyle: 'italic', textAlign: 'center' }}>
              {submissions.length === 0
                ? 'No responses logged yet. Generate at least two replies to enable the class summary.'
                : 'One response logged. Add at least one more to generate a summary.'}
            </p>
          ) : (
            <>
              <div style={{ marginBottom: 16 }}>
                <div className="sec-label">Responses logged</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                  {submissions.map((s, i) => (
                    <span key={i} style={{ fontSize: 12, padding: '3px 10px', borderRadius: 20, background: `${color}22`, color: color, border: `1px solid ${color}44` }}>{s.name}</span>
                  ))}
                </div>
              </div>
              <button className="primary" style={{ width: '100%', padding: 10 }} onClick={handleSummary} disabled={summaryLoading}>
                {summaryLoading ? 'Generating…' : 'Generate Class Summary'}
              </button>
              {summary && (
                <div style={{ marginTop: 16 }}>
                  <div className="sec-label">Class highlights</div>
                  <p style={{ fontSize: 14, lineHeight: 1.85, color: 'var(--text)', marginBottom: 14 }}>{summary}</p>
                  <button onClick={() => { navigator.clipboard.writeText(summary); setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }}
                    style={{ fontSize: 12, background: summaryCopied ? color : 'transparent', color: summaryCopied ? '#fff' : color, borderColor: color }}>
                    {summaryCopied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
