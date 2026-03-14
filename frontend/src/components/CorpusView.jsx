import { useState } from 'react';
import { queryCorpus } from '../api.js';

const SUGGESTED = [
  'How are students trending across the semester?',
  'Which assignment has the lowest average score?',
  'What are the most common weaknesses in student writing?',
  'Which students are struggling and may need attention?',
  'Compare performance across my two courses.',
  'What topics do students most frequently misunderstand?',
  'Who are my strongest students this semester?',
  'What is the average score for Lab 1?',
];

export default function CorpusView({ password, stats, onRefreshStats }) {
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState([]);

  async function ask(q) {
    const query = q || question;
    if (!query.trim()) return;
    setLoading(true);
    setAnswer('');
    try {
      const { answer: a } = await queryCorpus(query, password);
      setAnswer(a);
      setHistory(h => [{ q: query, a }, ...h.slice(0, 9)]);
      setQuestion('');
    } catch (e) { setAnswer('Error: ' + e.message); }
    setLoading(false);
  }

  return (
    <div style={{ padding: '24px 28px', maxWidth: 860 }}>
      <div className="page-header">
        <div className="page-title">Teaching Corpus</div>
        <div className="page-sub">Ask questions about your students, grades, and teaching patterns across all courses.</div>
      </div>

      {/* Stats */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 24 }}>
          {[['Total grades', stats.totalGrades], ['Students', stats.totalStudents], ['Discussions', stats.totalDiscussions]].map(([l,v]) => (
            <div key={l} style={{ padding: '12px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div className="sec-label" style={{ margin: 0, marginBottom: 4 }}>{l}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 22, fontWeight: 600 }}>{v}</div>
            </div>
          ))}
        </div>
      )}

      {stats?.courses && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 24 }}>
          {stats.courses.map(c => (
            <div key={c.id} style={{ padding: '12px 14px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div style={{ fontWeight: 500, marginBottom: 2 }}>{c.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{c.institution}</div>
              <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                <div><div className="sec-label" style={{ margin: 0 }}>Students</div><div style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{c.studentCount}</div></div>
                <div><div className="sec-label" style={{ margin: 0 }}>Graded</div><div style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{c.gradesCount}</div></div>
                {c.averageScore && <div><div className="sec-label" style={{ margin: 0 }}>Avg</div><div style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{c.averageScore}</div></div>}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Query */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 500, marginBottom: 10 }}>Ask a question</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            value={question}
            onChange={e => setQuestion(e.target.value)}
            placeholder="e.g. Which students are struggling with narrative writing?"
            onKeyDown={e => e.key === 'Enter' && ask()}
            style={{ flex: 1 }}
          />
          <button className="primary" onClick={() => ask()} disabled={loading || !question.trim()} style={{ flexShrink: 0 }}>
            {loading ? 'Thinking…' : 'Ask'}
          </button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {SUGGESTED.map(s => (
            <button key={s} className="ghost" style={{ fontSize: 11, padding: '4px 10px', border: '1px solid var(--border2)' }} onClick={() => ask(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Current answer */}
      {loading && (
        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--text2)', fontStyle: 'italic' }}>Analyzing your teaching corpus…</div>
        </div>
      )}
      {answer && !loading && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--border2)' }}>
          <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--text)', whiteSpace: 'pre-wrap' }}>{answer}</div>
        </div>
      )}

      {/* History */}
      {history.length > 1 && (
        <>
          <div className="sec-label">Previous queries</div>
          {history.slice(1).map((h, i) => (
            <div key={i} className="card card-hover" style={{ marginBottom: 6 }} onClick={() => { setQuestion(h.q); setAnswer(h.a); }}>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)', marginBottom: 4 }}>{h.q}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', overflow: 'hidden', maxHeight: 40, WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)' }}>{h.a}</div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
