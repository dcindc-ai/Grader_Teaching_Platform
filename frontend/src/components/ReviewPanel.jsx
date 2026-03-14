import { useState } from 'react';

const SECTION_LABELS = {
  annotated_product: 'Annotated Product',
  narrative: 'Narrative',
  context: 'Context',
  overall_quality: 'Overall Quality'
};
const SECTION_MAX = { annotated_product: 2, narrative: 2, context: 1, overall_quality: 1 };

function scoreColor(val, max) {
  const p = parseFloat(val) / max;
  return p >= 0.85 ? 'var(--green)' : p >= 0.6 ? 'var(--amber)' : 'var(--red)';
}

export default function ReviewPanel({ grade, onDelete, onClose }) {
  const [copied, setCopied] = useState(false);
  const s = grade.scores || {};
  const total = parseFloat(grade.total) || 0;
  const max = parseFloat(grade.maxScore) || 6;

  function copyParagraph() {
    navigator.clipboard.writeText(grade.instructor_paragraph || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.4)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto'
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 720,
        boxShadow: '0 8px 40px rgba(0,0,0,0.18)', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{
          padding: '20px 24px 16px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start'
        }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{grade.studentName || 'Unknown'}</div>
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
              {grade.assignmentName} · {grade.fileName}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{
              fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700,
              color: scoreColor(total, max)
            }}>
              {grade.total}<span style={{ fontSize: 16, fontWeight: 400, color: 'var(--text2)' }}>/{max}</span>
            </span>
            <button className="ghost" onClick={onClose} style={{ fontSize: 18, padding: '2px 8px' }}>×</button>
          </div>
        </div>

        <div style={{ padding: '20px 24px', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>

          {/* Instructor paragraph — the main output for Canvas */}
          {grade.instructor_paragraph && (
            <div style={{
              marginBottom: 20, padding: '16px 18px',
              background: 'rgba(37,99,235,0.04)',
              border: '2px solid rgba(37,99,235,0.2)',
              borderRadius: 10
            }}>
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 10
              }}>
                <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)' }}>
                  Instructor feedback — copy to Canvas
                </div>
                <button
                  onClick={copyParagraph}
                  style={{
                    fontSize: 12, padding: '5px 14px',
                    background: copied ? 'var(--accent)' : 'transparent',
                    color: copied ? '#fff' : 'var(--accent)',
                    border: `1px solid var(--accent)`,
                    fontWeight: 500
                  }}>
                  {copied ? '✓ Copied' : 'Copy to clipboard'}
                </button>
              </div>
              <p style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--text)', fontStyle: 'italic' }}>
                {grade.instructor_paragraph}
              </p>
            </div>
          )}

          {/* Score breakdown */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {Object.entries(SECTION_MAX).map(([k, mx]) => (
              <div key={k} style={{ padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                  {SECTION_LABELS[k]}
                </div>
                <div style={{
                  fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18,
                  color: scoreColor(parseFloat(s[k]) || 0, mx)
                }}>
                  {s[k]}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--text2)' }}>/{mx}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Summary */}
          {grade.summary && (
            <div style={{ marginBottom: 16, fontSize: 13, color: 'var(--text2)', lineHeight: 1.7, fontStyle: 'italic', padding: '10px 14px', background: 'var(--bg2)', borderRadius: 8 }}>
              {grade.summary}
            </div>
          )}

          {/* Strength / improvement pills */}
          <div style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {grade.key_strength && (
              <div className="pill-green" style={{ display: 'block', padding: '6px 14px', fontSize: 13 }}>
                + {grade.key_strength}
              </div>
            )}
            {grade.key_improvement && (
              <div className="pill-red" style={{ display: 'block', padding: '6px 14px', fontSize: 13 }}>
                → {grade.key_improvement}
              </div>
            )}
          </div>

          {/* Section comments */}
          {Object.entries(SECTION_LABELS).map(([key, label]) => {
            const comments = grade.comments?.[key] || [];
            if (!comments.length) return null;
            return (
              <div key={key} style={{ marginBottom: 14 }}>
                <div style={{
                  fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                  letterSpacing: '0.08em', color: 'var(--text3)',
                  padding: '6px 0', borderBottom: '1px solid var(--border)', marginBottom: 8
                }}>
                  {label}
                </div>
                {comments.map((c, i) => (
                  <div key={i} style={{ marginBottom: 6 }}>
                    <div className={c.type === 'positive' ? 'comment-pos' : 'comment-neg'}>
                      {c.type === 'positive' ? '+ ' : '✗ '}{c.text}
                    </div>
                    {c.rewrite && (
                      <div className="comment-rewrite">
                        ↳ {c.rewrite.replace(/^Suggested rewrite:\s*/i, '')}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Footer actions */}
          <div style={{
            marginTop: 20, paddingTop: 16, borderTop: '1px solid var(--border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span style={{ fontSize: 12, color: 'var(--text3)' }}>
              Graded {new Date(grade.gradedAt).toLocaleDateString()}
            </span>
            <button className="danger" style={{ fontSize: 12 }} onClick={onDelete}>
              Delete grade
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
