import { useState, useEffect, useRef } from 'react';
import { generateSummary, getAssignments } from '../api.js';
import DiscussGrader from './DiscussGrader.jsx';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export default function DiscussTab({ course, password, session, onSession, assignments: propAssignments }) {
  const submissions = session?.submissions || [];
  const [question, setQuestion] = useState(session?.question || course.discussionDefaultQuestion || '');
  const [editingQ, setEditingQ] = useState(false);
  const [summary, setSummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryCopied, setSummaryCopied] = useState(false);
  const [view, setView] = useState('grade'); // 'grade' | 'summary' | 'students'
  const [assignments, setAssignments] = useState(propAssignments || []);

  const [students, setStudents] = useState([]);

  useEffect(() => {
    fetch(`${BASE}/api/students?courseId=${course.id}`)
      .then(r => r.json())
      .then(data => setStudents(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [course.id]);

  useEffect(() => {
    if (!propAssignments?.length) {
      getAssignments(course.id, password).then(setAssignments);
    }
  }, [course.id]);

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
    onSession(() => ({ submissions: [], question: '' }));
    setSummary('');
    setView('grade');
  }

  const color = course.color || '#4f8ef7';

  return (
    <div style={{ maxWidth: 900 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Discussion</div>
          <div className="page-sub">Grade students · Copy to Canvas · Class summary</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 12 }} onClick={() => setEditingQ(e => !e)}>
            {editingQ ? 'Done editing' : 'Edit question'}
          </button>
          <button style={{ fontSize: 12 }} onClick={handleNewDiscussion}>+ New discussion</button>
        </div>
      </div>

      {/* Discussion question — compact, always visible */}
      {editingQ ? (
        <div className="card" style={{ marginBottom: 14 }}>
          <label>Discussion question</label>
          <textarea rows={6} value={question} onChange={e => setQuestion(e.target.value)}
            placeholder="Paste the discussion question here…" style={{ marginBottom: 0 }} />
        </div>
      ) : question ? (
        <div style={{ fontSize: 12, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 14,
          padding: '8px 12px', background: 'var(--bg2)', borderRadius: 6, borderLeft: `3px solid ${color}`,
          maxHeight: 60, overflow: 'hidden', cursor: 'pointer' }}
          onClick={() => setEditingQ(true)}>
          {question.slice(0, 200)}{question.length > 200 ? '…' : ''}
        </div>
      ) : (
        <div onClick={() => setEditingQ(true)} style={{ fontSize: 13, color: 'var(--accent)', marginBottom: 14,
          padding: '8px 12px', border: '1.5px dashed var(--border2)', borderRadius: 6, cursor: 'pointer' }}>
          + Add discussion question
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[
          { key: 'grade', label: 'Grade Students' },
          { key: 'summary', label: `Class Summary${submissions.length > 0 ? ` (${submissions.length})` : ''}` },
          { key: 'students', label: '👥 History' }
        ].map(t => (
          <button key={t.key} onClick={() => setView(t.key)} style={{
            padding: '9px 16px', fontSize: 13,
            background: view === t.key ? color : 'var(--bg)',
            color: view === t.key ? '#fff' : 'var(--text2)',
            border: `1px solid ${view === t.key ? color : 'var(--border2)'}`,
            fontWeight: view === t.key ? 600 : 400,
            borderRadius: 6
          }}>{t.label}</button>
        ))}
      </div>

      {/* Grade Students — unified grade + respond */}
      {view === 'grade' && (
        <DiscussGrader
          course={course}
          password={password}
          assignments={assignments}
          question={question}
          students={students}
          onSubmissionGraded={(name, post) => {
            onSession(s => ({
              ...s,
              submissions: [...(s.submissions || []), { name, answer: post }],
              question
            }));
          }}
        />
      )}

      {/* Class Summary */}
      {view === 'summary' && (
        <div style={{ maxWidth: 660 }}>
          {submissions.length < 2 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
              Grade at least 2 students first.<br />
              Come back here after grading to generate the class summary.
            </div>
          ) : (
            <>
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--text2)' }}>
                {submissions.length} students graded this discussion.
              </div>
              <button className="primary" style={{ width: '100%', padding: 12, marginBottom: 12, fontSize: 14 }}
                onClick={handleSummary} disabled={summaryLoading}>
                {summaryLoading ? 'Generating summary…' : 'Generate class summary'}
              </button>
              {summary && (
                <>
                  <textarea value={summary} onChange={e => setSummary(e.target.value)}
                    style={{ width: '100%', minHeight: 180, fontSize: 14, lineHeight: 1.8,
                      padding: '12px 14px', border: '2px solid rgba(37,99,235,0.25)',
                      borderRadius: 8, background: 'rgba(37,99,235,0.03)', resize: 'vertical' }} />
                  <button style={{ marginTop: 8, fontSize: 13 }}
                    onClick={() => { navigator.clipboard.writeText(summary); setSummaryCopied(true); setTimeout(() => setSummaryCopied(false), 2000); }}>
                    {summaryCopied ? '✓ Copied' : '📋 Copy class summary'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}

      {/* Student History */}
      {view === 'students' && (
        <StudentHistory course={course} password={password} />
      )}
    </div>
  );
}

function StudentHistory({ course, password }) {
  const [students, setStudents] = useState([]);
  const [selected, setSelected] = useState(null);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${BASE}/api/discuss/students?courseId=${course.id}`, {
      headers: { 'x-admin-password': password }
    }).then(r => r.json()).then(d => { setStudents(d); setLoading(false); }).catch(() => setLoading(false));
  }, [course.id]);

  async function loadHistory(name) {
    const r = await fetch(`${BASE}/api/discuss/student?courseId=${course.id}&studentName=${encodeURIComponent(name)}`, {
      headers: { 'x-admin-password': password }
    });
    setHistory(await r.json());
    setSelected(name);
  }

  if (selected) {
    return (
      <div style={{ maxWidth: 660 }}>
        <button className="ghost" style={{ fontSize: 12, marginBottom: 14 }} onClick={() => { setSelected(null); setHistory([]); }}>
          ← All students
        </button>
        <div style={{ fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{selected}</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 16 }}>
          {history.length} discussion{history.length !== 1 ? 's' : ''} on record
        </div>
        {history.map((d, i) => (
          <div key={i} className="card" style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 6 }}>
              {new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 8,
              borderLeft: '2px solid var(--border2)', paddingLeft: 8, lineHeight: 1.5 }}>
              {(d.question || '').slice(0, 120)}{(d.question || '').length > 120 ? '…' : ''}
            </div>
            <div style={{ fontSize: 13, lineHeight: 1.75, fontStyle: 'italic',
              padding: '10px 12px', background: 'rgba(37,99,235,0.04)',
              border: '1px solid rgba(37,99,235,0.15)', borderRadius: 6 }}>
              {d.instructor_reply}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 660 }}>
      <input type="text" value={search} onChange={e => setSearch(e.target.value)}
        placeholder="Search students…" style={{ marginBottom: 12, fontSize: 13 }} />
      {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}
      {!loading && students.length === 0 && (
        <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
          No discussion history yet. Grade students first.
        </div>
      )}
      {students
        .filter(s => !search || s.student_name?.toLowerCase().includes(search.toLowerCase()))
        .map((s, i) => (
          <div key={i} className="card card-hover" style={{ marginBottom: 6, padding: '10px 14px' }}
            onClick={() => loadHistory(s.student_name)}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 600, fontSize: 14 }}>{s.student_name}</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                  Last: {new Date(s.last_seen).toLocaleDateString()}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="badge">{s.response_count} discussion{s.response_count !== 1 ? 's' : ''}</span>
                <span style={{ fontSize: 12, color: 'var(--accent)' }}>View →</span>
              </div>
            </div>
          </div>
        ))}
    </div>
  );
}
