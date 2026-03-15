import { useState } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

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

export default function ReviewPanel({ grade: initialGrade, password, onDelete, onClose, onUpdate }) {
  const [grade, setGrade] = useState(initialGrade);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [resource, setResource] = useState({ title: '', url: '', why: '' });
  const [showResourceForm, setShowResourceForm] = useState(false);

  const s = grade.scores || {};
  const total = parseFloat(grade.total) || 0;
  const max = parseFloat(grade.maxScore) || 6;

  function updateGrade(field, value) {
    setGrade(g => ({ ...g, [field]: value }));
    setSaved(false);
  }

  function updateScore(key, value) {
    const newScores = { ...s, [key]: value };
    const newTotal = Object.entries(newScores)
      .filter(([k]) => k !== 'total')
      .reduce((a, [, v]) => a + (parseFloat(v) || 0), 0);
    setGrade(g => ({ ...g, scores: newScores, total: newTotal.toFixed(1) }));
    setSaved(false);
  }

  function updateComment(section, idx, field, value) {
    const comments = { ...(grade.comments || {}) };
    if (!comments[section]) comments[section] = [];
    comments[section] = comments[section].map((c, i) =>
      i === idx ? { ...c, [field]: value } : c
    );
    setGrade(g => ({ ...g, comments }));
    setSaved(false);
  }

  async function saveChanges() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/grade/${grade.id}`, {
        method: 'PUT',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentName: grade.studentName,
          total: grade.total,
          scores: grade.scores,
          comments: grade.comments,
          instructor_paragraph: grade.instructor_paragraph,
          key_strength: grade.key_strength,
          key_improvement: grade.key_improvement,
          summary: grade.summary,
          resources: grade.resources
        })
      });
      const updated = await r.json();
      if (updated.id) {
        setGrade(g => ({ ...g, ...updated }));
        setSaved(true);
        onUpdate?.(updated);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) { alert('Save error: ' + e.message); }
    setSaving(false);
  }

  async function regenerate() {
    setRegenerating(true);
    try {
      const r = await fetch(`${BASE}/api/feedback/regenerate/${grade.id}`, {
        method: 'POST', headers: { 'x-admin-password': password }
      });
      const d = await r.json();
      if (d.paragraph) updateGrade('instructor_paragraph', d.paragraph);
    } catch (e) { alert('Error: ' + e.message); }
    setRegenerating(false);
  }

  function addResource() {
    if (!resource.url) return;
    const resources = [...(grade.resources || []), { ...resource }];
    updateGrade('resources', resources);
    setResource({ title: '', url: '', why: '' });
    setShowResourceForm(false);
  }

  function removeResource(idx) {
    updateGrade('resources', (grade.resources || []).filter((_, i) => i !== idx));
  }

  function downloadDocx() {
    window.open(`${BASE}/api/feedback/docx/${grade.id}?password=${encodeURIComponent(password)}`, '_blank');
  }

  function downloadRedlinedPDF() {
    window.open(`${BASE}/api/feedback/redlined-pdf/${grade.id}?password=${encodeURIComponent(password)}`, '_blank');
  }

  function copyParagraph() {
    navigator.clipboard.writeText(grade.instructor_paragraph || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sectionEntries = Object.entries(SECTION_LABELS);

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.45)', zIndex: 1000,
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '40px 20px', overflowY: 'auto'
    }} onClick={onClose}>
      <div style={{
        background: '#fff', borderRadius: 14, width: '100%', maxWidth: 780,
        boxShadow: '0 8px 48px rgba(0,0,0,0.2)', overflow: 'hidden'
      }} onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div style={{ padding: '18px 24px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div style={{ flex: 1 }}>
            {editingName ? (
              <input type="text" value={grade.studentName || ''} autoFocus
                onChange={e => updateGrade('studentName', e.target.value)}
                onBlur={() => setEditingName(false)}
                onKeyDown={e => e.key === 'Enter' && setEditingName(false)}
                style={{ fontSize: 20, fontWeight: 700, border: 'none', borderBottom: '2px solid var(--accent)', outline: 'none', width: '100%', padding: '2px 0' }} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 20, fontWeight: 700 }}>{grade.studentName || 'Unknown'}</div>
                <button className="ghost" style={{ fontSize: 11, padding: '2px 6px', color: 'var(--text3)' }}
                  onClick={() => setEditingName(true)}>✏ edit</button>
              </div>
            )}
            <div style={{ fontSize: 13, color: 'var(--text2)', marginTop: 2 }}>
              {grade.assignmentName} · {grade.fileName}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 28, fontWeight: 700, color: scoreColor(total, max) }}>
              {grade.total}<span style={{ fontSize: 16, fontWeight: 400, color: 'var(--text2)' }}>/{max}</span>
            </span>
            <button className="ghost" onClick={onClose} style={{ fontSize: 20, padding: '2px 8px', lineHeight: 1 }}>×</button>
          </div>
        </div>

        <div style={{ padding: '18px 24px', maxHeight: 'calc(100vh - 160px)', overflowY: 'auto' }}>

          {/* Instructor paragraph */}
          <div style={{ marginBottom: 18, padding: '14px 16px', background: 'rgba(37,99,235,0.04)', border: '2px solid rgba(37,99,235,0.2)', borderRadius: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--accent)' }}>
                Instructor feedback
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={regenerate} disabled={regenerating} style={{ fontSize: 11, padding: '3px 8px', color: 'var(--text2)' }}>
                  {regenerating ? '…' : '↻ Regenerate'}
                </button>
                <button onClick={copyParagraph} style={{ fontSize: 12, padding: '4px 12px', fontWeight: 500,
                  background: copied ? 'var(--accent)' : 'transparent',
                  color: copied ? '#fff' : 'var(--accent)', border: `1px solid var(--accent)` }}>
                  {copied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
            </div>
            <textarea
              value={grade.instructor_paragraph || ''}
              onChange={e => updateGrade('instructor_paragraph', e.target.value)}
              rows={4}
              style={{ width: '100%', fontSize: 14, lineHeight: 1.8, fontStyle: 'italic',
                border: 'none', background: 'transparent', resize: 'vertical', outline: 'none', padding: 0 }}
              placeholder="No feedback paragraph yet. Click Regenerate." />
          </div>

          {/* Score breakdown — editable */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 16 }}>
            {sectionEntries.map(([key, label]) => {
              const mx = SECTION_MAX[key] || 1;
              const val = parseFloat(s[key]) || 0;
              return (
                <div key={key} style={{ padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" value={val} min={0} max={mx} step={0.5}
                      onChange={e => updateScore(key, parseFloat(e.target.value) || 0)}
                      style={{ width: 46, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18,
                        color: scoreColor(val, mx), border: 'none', background: 'transparent',
                        outline: 'none', textAlign: 'center', padding: 0 }} />
                    <span style={{ fontSize: 12, color: 'var(--text2)' }}>/{mx}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Key strength / improvement — editable */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
            <div>
              <label>Key strength</label>
              <input type="text" value={grade.key_strength || ''}
                onChange={e => updateGrade('key_strength', e.target.value)}
                style={{ fontSize: 13 }} />
            </div>
            <div>
              <label>Key improvement</label>
              <input type="text" value={grade.key_improvement || ''}
                onChange={e => updateGrade('key_improvement', e.target.value)}
                style={{ fontSize: 13 }} />
            </div>
          </div>

          {/* Summary — editable */}
          {(grade.summary !== undefined) && (
            <div style={{ marginBottom: 16 }}>
              <label>Summary</label>
              <textarea rows={2} value={grade.summary || ''}
                onChange={e => updateGrade('summary', e.target.value)}
                style={{ fontSize: 13, lineHeight: 1.6 }} />
            </div>
          )}

          {/* Section comments — editable */}
          {sectionEntries.map(([key, label]) => {
            const comments = grade.comments?.[key] || [];
            if (!comments.length) return null;
            return (
              <div key={key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text3)', padding: '6px 0', borderBottom: '1px solid var(--border)', marginBottom: 8 }}>
                  {label}
                </div>
                {comments.map((c, i) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', gap: 6, marginBottom: 4, alignItems: 'center' }}>
                      <select value={c.type || 'negative'}
                        onChange={e => updateComment(key, i, 'type', e.target.value)}
                        style={{ fontSize: 11, width: 90, padding: '2px 4px' }}>
                        <option value="positive">+ Positive</option>
                        <option value="negative">✗ Issue</option>
                      </select>
                      <input type="text" value={c.text || ''}
                        onChange={e => updateComment(key, i, 'text', e.target.value)}
                        style={{ flex: 1, fontSize: 12 }} />
                    </div>
                    {c.type !== 'positive' && (
                      <input type="text" value={c.rewrite || ''}
                        onChange={e => updateComment(key, i, 'rewrite', e.target.value)}
                        placeholder="Suggested rewrite (optional)…"
                        style={{ fontSize: 11, color: 'var(--accent)', fontStyle: 'italic', marginLeft: 96 }} />
                    )}
                  </div>
                ))}
              </div>
            );
          })}

          {/* Resources */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <label style={{ margin: 0 }}>Recommended resources</label>
              <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => setShowResourceForm(s => !s)}>
                + Add resource
              </button>
            </div>

            {showResourceForm && (
              <div style={{ padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, marginBottom: 8, border: '1px solid var(--border)' }}>
                <div className="field">
                  <label>Title</label>
                  <input type="text" value={resource.title} onChange={e => setResource(r => ({ ...r, title: e.target.value }))}
                    placeholder="e.g. Jane's All the World's Aircraft" />
                </div>
                <div className="field">
                  <label>URL</label>
                  <input type="url" value={resource.url} onChange={e => setResource(r => ({ ...r, url: e.target.value }))}
                    placeholder="https://…" />
                </div>
                <div className="field" style={{ marginBottom: 8 }}>
                  <label>Why this helps</label>
                  <input type="text" value={resource.why} onChange={e => setResource(r => ({ ...r, why: e.target.value }))}
                    placeholder="e.g. Better reference for vehicle identification" />
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="primary" style={{ fontSize: 12 }} onClick={addResource}>Add</button>
                  <button style={{ fontSize: 12 }} onClick={() => setShowResourceForm(false)}>Cancel</button>
                </div>
              </div>
            )}

            {(grade.resources || []).map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                padding: '8px 10px', background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.15)',
                borderRadius: 6, marginBottom: 4 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--accent)' }}>
                    <a href={r.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{r.title || r.url}</a>
                  </div>
                  {r.why && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 2 }}>{r.why}</div>}
                </div>
                <button className="danger" style={{ fontSize: 11, padding: '1px 6px' }} onClick={() => removeResource(i)}>×</button>
              </div>
            ))}
          </div>

          {/* Actions */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <button className="primary" style={{ flex: 1, fontSize: 13 }} onClick={saveChanges} disabled={saving}>
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save changes'}
              </button>
              <button style={{ fontSize: 13 }} onClick={downloadDocx}>↓ Word doc</button>
              <button style={{ fontSize: 13 }} onClick={downloadRedlinedPDF}>📋 Redlined PDF</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                Graded {new Date(grade.gradedAt).toLocaleDateString()}
              </span>
              <button className="danger" style={{ fontSize: 12 }} onClick={onDelete}>Delete grade</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
