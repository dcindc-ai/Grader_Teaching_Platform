import { useState, useEffect } from 'react';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

export default function InsightsTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [meta, setMeta] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setAssignmentId(a[0].id);
    });
  }, [course.id]);

  async function runAnalysis() {
    setAnalyzing(true); setError(''); setAnalysis(null); setMeta(null);
    try {
      const r = await fetch(`${BASE}/api/insights/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courseId: course.id, assignmentId })
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Analysis failed');
      setAnalysis(data.analysis);
      setMeta(data.meta);
    } catch(e) { setError(e.message); }
    setAnalyzing(false);
  }

  async function downloadPDF() {
    setGenerating(true);
    try {
      const r = await fetch(`${BASE}/api/insights/pdf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis, meta })
      });
      if (!r.ok) throw new Error('PDF generation failed');
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `class-insights-${meta.assignmentName.replace(/[^a-z0-9]/gi,'_')}.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch(e) { setError(e.message); }
    setGenerating(false);
  }

  const accent = course.color || '#1a4fbf';

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px' }}>
      <div style={{ marginBottom: 20 }}>
        <div className="page-title">Class Insights</div>
        <div className="page-sub">Analyze patterns across all grades and generate a student handout</div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        <select value={assignmentId} onChange={e => { setAssignmentId(e.target.value); setAnalysis(null); }}
          style={{ fontSize: 13, fontWeight: 500, padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border)', flex: 1, maxWidth: 320 }}>
          {assignments.map(a => <option key={a.id} value={a.id}>{a.name} ({a.type})</option>)}
        </select>
        <button className="primary" onClick={runAnalysis} disabled={analyzing || !assignmentId}
          style={{ fontSize: 13, minWidth: 160 }}>
          {analyzing ? '⏳ Analyzing…' : '🔍 Analyze Class'}
        </button>
        {analysis && (
          <button onClick={downloadPDF} disabled={generating}
            style={{ fontSize: 13, padding: '7px 16px', borderRadius: 6, border: 'none',
              background: accent, color: '#fff', cursor: 'pointer', fontWeight: 600, minWidth: 160 }}>
            {generating ? '⏳ Generating…' : '⬇ Download Handout'}
          </button>
        )}
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(220,38,38,0.08)', border: '1px solid var(--red)',
          borderRadius: 8, color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {analysis && meta && (
        <div>
          {/* Stats bar */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 20, padding: '14px 18px',
            background: accent + '12', borderRadius: 10, border: `1px solid ${accent}30` }}>
            <div style={{ fontSize: 22, fontWeight: 800, color: accent }}>{meta.avgScore}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>avg / {meta.maxScore}</div>
            <div style={{ width: 1, background: 'var(--border)', margin: '0 4px' }} />
            <div style={{ fontSize: 22, fontWeight: 800, color: accent }}>{meta.totalStudents}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center' }}>students graded</div>
          </div>

          {/* Snapshot */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
              color: accent, marginBottom: 6 }}>Class Overview</div>
            <p style={{ fontSize: 14, color: 'var(--text)', lineHeight: 1.6, margin: 0 }}>{analysis.classSnapshot}</p>
          </div>

          {/* Instructor note */}
          {analysis.instructorNote && (
            <div style={{ padding: '12px 16px', borderLeft: `4px solid ${accent}`, background: accent + '08',
              borderRadius: '0 8px 8px 0', marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: accent, marginBottom: 4 }}>What to say to the class</div>
              <p style={{ fontSize: 13, fontStyle: 'italic', color: 'var(--text2)', margin: 0, lineHeight: 1.6 }}>"{analysis.instructorNote}"</p>
            </div>
          )}

          {/* Missed concepts */}
          {analysis.missedConcepts?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: accent, marginBottom: 10 }}>Concepts Students Missed</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {analysis.missedConcepts.map((c, i) => (
                  <div key={i} style={{ padding: '12px 16px', border: '1px solid var(--border)',
                    borderRadius: 8, background: '#fff' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{c.concept}</div>
                      {c.howManyStudents && (
                        <span style={{ fontSize: 11, color: accent, fontWeight: 600,
                          background: accent + '12', padding: '2px 8px', borderRadius: 12 }}>
                          {c.howManyStudents} of {meta.totalStudents} students
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text2)', margin: '0 0 4px', lineHeight: 1.5 }}>{c.explanation}</p>
                    {c.whatStudentsDid && (
                      <p style={{ fontSize: 12, color: 'var(--text3)', margin: 0, fontStyle: 'italic' }}>
                        What students did instead: {c.whatStudentsDid}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Topic list */}
          {analysis.topicList?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: accent, marginBottom: 10 }}>Topics for Further Study</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {analysis.topicList.map((t, i) => (
                  <div key={i} style={{ padding: '12px 14px', border: '1px solid var(--border)',
                    borderRadius: 8, background: '#fff' }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: accent, marginBottom: 4 }}>{t.topic}</div>
                    <p style={{ fontSize: 12, color: 'var(--text2)', margin: 0, lineHeight: 1.5 }}>{t.explanation}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resources */}
          {analysis.resources?.length > 0 && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: accent, marginBottom: 10 }}>Recommended Resources</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {analysis.resources.map((r, i) => (
                  <div key={i} style={{ padding: '12px 16px', border: '1px solid var(--border)',
                    borderRadius: 8, background: '#fff', display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: accent, background: accent + '12',
                      padding: '2px 6px', borderRadius: 4, flexShrink: 0, marginTop: 2 }}>
                      {(r.type || 'LINK').toUpperCase()}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{r.title}</div>
                      <p style={{ fontSize: 12, color: 'var(--text2)', margin: '0 0 4px', lineHeight: 1.4 }}>{r.description}</p>
                      {r.url && (
                        <a href={r.url} target="_blank" rel="noreferrer"
                          style={{ fontSize: 11, color: '#2563eb', wordBreak: 'break-all' }}>{r.url}</a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Download CTA */}
          <div style={{ padding: '16px 20px', background: accent + '10', borderRadius: 10,
            border: `1px solid ${accent}25`, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>Ready to share with students</div>
              <div style={{ fontSize: 12, color: 'var(--text3)' }}>Word doc handout in {course.name} colors with topics, concepts, and resources</div>
            </div>
            <button onClick={downloadPDF} disabled={generating}
              style={{ fontSize: 13, padding: '9px 20px', borderRadius: 8, border: 'none',
                background: accent, color: '#fff', cursor: 'pointer', fontWeight: 600 }}>
              {generating ? '⏳ Generating…' : '⬇ Download Handout'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
