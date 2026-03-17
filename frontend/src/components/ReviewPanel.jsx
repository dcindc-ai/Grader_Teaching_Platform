import { useState, useEffect } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const SECTION_LABELS = {
  annotated_product: 'Annotated Product',
  narrative: 'Narrative',
  context: 'Context',
  overall_quality: 'Overall Quality'
};
const SECTION_MAX = { annotated_product: 2, narrative: 2, context: 1, overall_quality: 1 };

// Derive display sections from actual keys in the grade record
function getSections(grade) {
  const scores = grade.scores || {};
  const comments = grade.comments || {};
  const isNumeric = k => /^\d+$/.test(k);
  const keys = [...new Set([
    ...Object.keys(scores).filter(k => k !== 'total' && !isNumeric(k)),
    ...Object.keys(comments).filter(k => !isNumeric(k))
  ])];
  if (!keys.length) return [];
  const count = keys.length;
  return keys.map(key => ({
    key,
    label: SECTION_LABELS[key] || key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    max: SECTION_MAX[key] || (parseFloat(grade.maxScore) / count) || 1
  }));
}

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

  function deleteComment(section, idx) {
    const comments = { ...(grade.comments || {}) };
    if (!comments[section]) return;
    comments[section] = comments[section].filter((_, i) => i !== idx);
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

  const [annotating, setAnnotating] = useState(false);
  const [annotateMsg, setAnnotateMsg] = useState('');
  const [showRegrade, setShowRegrade] = useState(false);
  const [regradeStrictness, setRegradeStrictness] = useState('standard');
  const [regrading, setRegrading] = useState(false);
  const [alwaysOn, setAlwaysOn] = useState(initialGrade.alwaysOn || null);
  const [aoActing, setAoActing] = useState(false);

  async function annotateAndDownload(force = false) {
    setAnnotating(true);
    setAnnotateMsg('Sending to Claude for annotation…');
    try {
      const url = `${BASE}/api/annotate/${grade.id}${force ? '?force=true' : ''}`;
      const r = await fetch(url, { method: 'POST', headers: { 'x-admin-password': password } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Annotation failed');
      setAnnotateMsg(d.cached ? 'Opening cached version…' : 'Done! Downloading…');
      window.open(`${BASE}/api/annotate/${grade.id}/download`, '_blank');
    } catch (e) {
      setAnnotateMsg('Error: ' + e.message);
    }
    setAnnotating(false);
    setTimeout(() => setAnnotateMsg(''), 4000);
  }

  // Load Always-On for this grade if not already present
  useEffect(() => {
    if (!alwaysOn && grade.id) {
      fetch(`${BASE}/api/grade/${grade.id}`, { headers: { 'x-admin-password': password } })
        .then(r => r.json())
        .then(d => { if (d.alwaysOn) setAlwaysOn(d.alwaysOn); })
        .catch(() => {});
    }
  }, [grade.id]);

  async function aoAct(status) {
    if (!alwaysOn) return;
    setAoActing(true);
    try {
      const links = Array.isArray(alwaysOn.links)
        ? alwaysOn.links
        : (() => { try { return JSON.parse(alwaysOn.links || '[]'); } catch(e) { return []; } })();
      await fetch(`${BASE}/api/alwayson/${alwaysOn.id}`, {
        method: 'PUT',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, feedbackSentences: alwaysOn.feedbackSentences, links: JSON.stringify(links) })
      });
      setAlwaysOn(a => ({ ...a, status, links }));
    } catch (e) { alert('Error: ' + e.message); }
    setAoActing(false);
  }

  async function regrade() {
    setRegrading(true);
    try {
      const r = await fetch(`${BASE}/api/grade/${grade.id}/regrade`, {
        method: 'POST',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ strictness: regradeStrictness })
      });
      const updated = await r.json();
      if (updated.error) throw new Error(updated.error);
      setGrade(g => ({ ...g, ...updated }));
      onUpdate?.(updated);
      setShowRegrade(false);
    } catch (e) { alert('Regrade error: ' + e.message); }
    setRegrading(false);
  }

  function copyParagraph() {
    navigator.clipboard.writeText(grade.instructor_paragraph || '');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const sections = getSections(grade);

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
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(sections.length, 4)}, 1fr)`, gap: 8, marginBottom: 16 }}>
            {sections.map(({ key, label, max: mx }) => {
              const val = parseFloat(s[key]) || 0;
              return (
                <div key={key} style={{ padding: '10px 12px', background: 'var(--bg2)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{label}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="number" value={val} min={0} max={mx} step={0.1}
                      onChange={e => updateScore(key, parseFloat(e.target.value) || 0)}
                      style={{ width: 62, fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 18,
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
          {sections.map(({ key, label }) => {
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
                      <button
                        onClick={() => deleteComment(key, i)}
                        title="Remove this comment"
                        style={{ fontSize: 11, padding: '2px 6px', color: 'var(--text3)',
                          border: '1px solid var(--border)', borderRadius: 4, flexShrink: 0,
                          background: 'transparent', cursor: 'pointer' }}>
                        ✕
                      </button>
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

          {/* Recommended Resources (Always-On) */}
          {alwaysOn && (() => {
            const links = Array.isArray(alwaysOn.links)
              ? alwaysOn.links
              : (() => { try { return JSON.parse(alwaysOn.links || '[]'); } catch(e) { return []; } })();
            const validLinks = links.filter(l => l && l.url);
            const isApproved = alwaysOn.status === 'approved';
            const isRejected = alwaysOn.status === 'rejected';
            return (
              <div style={{ marginBottom: 16, padding: '12px 14px', borderRadius: 8,
                border: `2px solid ${isApproved ? 'var(--green)' : isRejected ? 'var(--border)' : 'var(--accent)'}`,
                background: isApproved ? 'rgba(22,163,74,0.05)' : isRejected ? 'var(--bg2)' : 'rgba(37,99,235,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.08em', color: 'var(--text3)' }}>Recommended Resources</div>
                  <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, fontWeight: 600,
                    background: isApproved ? 'rgba(22,163,74,0.12)' : isRejected ? 'var(--bg3)' : 'rgba(37,99,235,0.1)',
                    color: isApproved ? 'var(--green)' : isRejected ? 'var(--text3)' : 'var(--accent)' }}>
                    {alwaysOn.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--text)', marginBottom: validLinks.length ? 8 : 0 }}>
                  {alwaysOn.feedbackSentences}
                </div>
                {validLinks.map((lk, i) => (
                  <div key={i} style={{ marginBottom: 6, padding: '6px 10px',
                    background: '#fff', borderRadius: 5, border: '1px solid var(--border)' }}>
                    <a href={lk.url} target="_blank" rel="noopener noreferrer"
                      style={{ fontWeight: 600, color: 'var(--accent)', fontSize: 12,
                        textDecoration: 'none', display: 'block', marginBottom: 2 }}>
                      {lk.title || lk.url} ↗
                    </a>
                    {lk.why && <div style={{ color: 'var(--text3)', fontSize: 11 }}>{lk.why}</div>}
                  </div>
                ))}
                {alwaysOn.status === 'pending' && (
                  <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                    <button className="primary" style={{ flex: 1, fontSize: 12 }}
                      onClick={() => aoAct('approved')} disabled={aoActing}>
                      ✓ Accept — include in feedback
                    </button>
                    <button style={{ flex: 1, fontSize: 12, color: 'var(--red)' }}
                      onClick={() => aoAct('rejected')} disabled={aoActing}>
                      ✕ Reject
                    </button>
                  </div>
                )}
                {alwaysOn.status === 'approved' && (
                  <button style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6 }}
                    onClick={() => aoAct('rejected')} disabled={aoActing}>
                    Undo approval
                  </button>
                )}
              </div>
            );
          })()}

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
              <button
                style={{ fontSize: 13, background: annotating ? 'var(--amber)' : 'var(--blue)', color: '#fff', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: annotating ? 'wait' : 'pointer' }}
                onClick={() => annotateAndDownload(false)}
                disabled={annotating}
                title="Claude analyzes the submission and places annotations directly on the PDF"
              >
                {annotating ? '⏳ Annotating…' : '✏️ Annotate PDF'}
              </button>
            </div>
            {annotateMsg && (
              <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, fontStyle: 'italic' }}>
                {annotateMsg}{' '}
                {!annotating && annotateMsg.includes('Downloading') && (
                  <span
                    style={{ color: 'var(--blue)', cursor: 'pointer', textDecoration: 'underline' }}
                    onClick={() => annotateAndDownload(true)}
                  >Re-annotate</span>
                )}
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                Graded {new Date(grade.gradedAt).toLocaleDateString()}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={{ fontSize: 12, color: 'var(--text2)' }}
                  onClick={() => setShowRegrade(r => !r)}>
                  {showRegrade ? 'Cancel regrade' : '↻ Regrade'}
                </button>
                <button className="danger" style={{ fontSize: 12 }} onClick={onDelete}>Delete grade</button>
              </div>
            </div>

            {showRegrade && (
              <div style={{ marginTop: 10, padding: '12px 14px', background: 'var(--bg2)',
                borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
                  Regrade with different strictness
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  {[
                    { val: 'lenient', label: 'More lax', desc: 'Generous with partial credit' },
                    { val: 'standard', label: 'Standard', desc: 'Grade as written' },
                    { val: 'strict', label: 'More strict', desc: 'Higher bar for full credit' },
                  ].map(({ val, label, desc }) => (
                    <div key={val}
                      onClick={() => setRegradeStrictness(val)}
                      style={{
                        flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                        border: `2px solid ${regradeStrictness === val ? 'var(--accent)' : 'var(--border)'}`,
                        background: regradeStrictness === val ? 'var(--accent-faint, rgba(0,100,200,0.06))' : '#fff'
                      }}>
                      <div style={{ fontSize: 12, fontWeight: 700,
                        color: regradeStrictness === val ? 'var(--accent)' : 'var(--text)' }}>{label}</div>
                      <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2 }}>{desc}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginBottom: 10 }}>
                  Claude will re-read the original submission and grade it fresh. Current scores and comments will be replaced.
                </div>
                <button className="primary" style={{ width: '100%', fontSize: 13 }}
                  onClick={regrade} disabled={regrading}>
                  {regrading ? '⏳ Regrading…' : `Regrade as ${regradeStrictness}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
