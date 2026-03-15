import { useState, useRef, useEffect } from 'react';
import { getAssignments, addExample, getExamples, deleteExample } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
const SCORES = [3, 3.5, 4, 4.5, 5, 5.5, 6];

export default function LabelTab({ course, password, queue: externalQueue, onQueue: onExternalQueue }) {
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  // Use external (lifted) queue if provided, otherwise local with localStorage persistence
  const storageKey = `label_queue_${course.id}`;
  const [localQueue, setLocalQueueRaw] = useState(() => {
    try {
      // Restore metadata but not file objects (can't serialize File objects)
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      // Mark file-backed items as needing re-upload
      return saved.map(q => q.file ? { ...q, file: null, status: q.status === 'pending' ? 'needs-reupload' : q.status } : q);
    } catch (e) { return []; }
  });

  function setLocalQueue(updater) {
    setLocalQueueRaw(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      try {
        // Save without file objects
        localStorage.setItem(storageKey, JSON.stringify(next.map(q => ({ ...q, file: undefined }))));
      } catch (e) {}
      return next;
    });
  }

  const queue = externalQueue || localQueue;
  const setQueue = onExternalQueue || setLocalQueue;
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [saving, setSaving] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [savedExamples, setSavedExamples] = useState([]);
  const [view, setView] = useState('queue'); // 'queue' | 'saved'
  const fileRef = useRef();

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setAssignmentId(a[0].id);
    });
  }, [course.id]);

  useEffect(() => {
    if (assignmentId) {
      getExamples(assignmentId, password).then(setSavedExamples);
    }
  }, [assignmentId]);

  const assignment = assignments.find(a => a.id === assignmentId);
  const pending = queue.filter(x => x.status === 'pending').length;
  const done = queue.filter(x => x.status === 'saved').length;
  const allDone = queue.length > 0 && pending === 0;

  async function parsePDF(file) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`${BASE}/api/label/parse`, {
        method: 'POST', headers: { 'x-admin-password': password }, body: fd
      });
      return await r.json();
    } catch (e) {
      return { studentName: file.name.replace(/\.[^.]+$/, ''), comments: '' };
    }
  }

  async function handleFiles(files) {
    const pdfs = Array.from(files).filter(f => f.name.endsWith('.pdf'));
    if (!pdfs.length) return;
    setParsing(true);

    const newItems = [];
    for (const file of pdfs) {
      const existing = queue.find(q => q.name === file.name);
      if (existing) continue;
      const parsed = await parsePDF(file);
      newItems.push({
        id: `q-${Date.now()}-${Math.random()}`,
        file,
        name: file.name,
        studentName: parsed.studentName || file.name.replace('.pdf', ''),
        extractedComments: parsed.comments || '',
        additionalContext: '',
        score: '4',
        quality: 'good',
        notes: '',
        status: 'pending'
      });
    }

    setQueue(q => [...q, ...newItems]);
    if (newItems.length > 0 && selectedIdx === null) setSelectedIdx(0);
    setParsing(false);
  }

  function updateItem(id, updates) {
    setQueue(q => q.map(x => x.id === id ? { ...x, ...updates } : x));
  }

  function removeFromQueue(id) {
    const idx = queue.findIndex(x => x.id === id);
    setQueue(q => q.filter(x => x.id !== id));
    if (selectedIdx !== null) {
      const newQueue = queue.filter(x => x.id !== id);
      if (newQueue.length === 0) setSelectedIdx(null);
      else setSelectedIdx(Math.min(selectedIdx, newQueue.length - 1));
    }
  }

  async function saveItem(item) {
    if (!item || !assignmentId) return;
    setSaving(true);
    const content = [
      item.extractedComments,
      item.additionalContext ? `\nAdditional context:\n${item.additionalContext}` : ''
    ].filter(Boolean).join('\n');

    try {
      const ex = await addExample(assignmentId, {
        courseId: course.id,
        studentName: item.studentName,
        score: parseFloat(item.score),
        quality: item.quality,
        notes: item.notes || `Historical example — ${item.score}/${assignment?.maxScore || 6}`,
        content
      }, password);
      updateItem(item.id, { status: 'saved', exampleId: ex.id });
      setSavedExamples(s => [...s, ex]);
      // Auto-advance to next pending
      const nextIdx = queue.findIndex((x, i) => i > selectedIdx && x.status === 'pending');
      if (nextIdx >= 0) setSelectedIdx(nextIdx);
    } catch (e) {
      alert('Save error: ' + e.message);
    }
    setSaving(false);
  }

  async function removeSaved(exId) {
    if (!confirm('Remove this example from the calibration bank?')) return;
    await deleteExample(assignmentId, exId, password);
    setSavedExamples(s => s.filter(x => x.id !== exId));
    setQueue(q => q.map(x => x.exampleId === exId ? { ...x, status: 'pending' } : x));
  }

  const item = selectedIdx !== null ? queue[selectedIdx] : null;

  return (
    <div>
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Label Historical Data</div>
          <div className="page-sub">Score past submissions to build your calibration bank</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select value={assignmentId} onChange={e => setAssignmentId(e.target.value)} style={{ fontSize: 13, fontWeight: 500 }}>
            {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)} />
          <button className="primary" onClick={() => fileRef.current.click()} disabled={parsing} style={{ fontSize: 12 }}>
            {parsing ? 'Reading…' : '+ Upload PDFs'}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      {queue.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>
              {allDone
                ? <span style={{ color: 'var(--green)', fontWeight: 600 }}>✓ All {done} submissions labeled and saved to calibration bank</span>
                : <span>{done} of {queue.length} labeled</span>
              }
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text2)' }}>
              <span style={{ color: 'var(--text3)' }}>{pending} pending</span>
              <span style={{ color: 'var(--green)' }}>{done} saved</span>
              <span style={{ color: 'var(--text3)' }}>{queue.filter(x => x.status === 'skipped').length} skipped</span>
            </div>
          </div>
          <div style={{ height: 6, background: 'var(--bg3)', borderRadius: 3, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3,
              background: allDone ? 'var(--green)' : 'var(--accent)',
              width: `${queue.length ? (done / queue.length * 100) : 0}%`,
              transition: 'width 0.3s'
            }} />
          </div>
        </div>
      )}

      {/* Tabs */}
      {(queue.length > 0 || savedExamples.length > 0) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[
            ['queue', `Labeling queue (${queue.length})`],
            ['saved', `Calibration bank (${savedExamples.length})`]
          ].map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} style={{
              padding: '7px 14px', fontSize: 13,
              background: view === k ? 'var(--bg3)' : 'var(--bg)',
              color: view === k ? 'var(--text)' : 'var(--text2)',
              border: `1px solid ${view === k ? 'var(--border2)' : 'var(--border)'}`,
              fontWeight: view === k ? 500 : 400
            }}>{l}</button>
          ))}
        </div>
      )}

      {/* Empty state */}
      {queue.length === 0 && savedExamples.length === 0 && (
        <div className="drop-zone"
          onClick={() => fileRef.current.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
          <div style={{ fontSize: 32, marginBottom: 10 }}>📂</div>
          <p>Drop content summary PDFs here to start labeling</p>
          <small>Upload as many as you have — they queue up and you score them one at a time</small>
        </div>
      )}

      {/* Queue view */}
      {view === 'queue' && queue.length > 0 && (
        <div className="two-col" style={{ alignItems: 'start' }}>
          {/* Left: queue list */}
          <div>
            {queue.map((q, idx) => (
              <div key={q.id}
                className="card card-hover"
                onClick={() => setSelectedIdx(idx)}
                style={{
                  marginBottom: 4, padding: '10px 12px',
                  borderColor: selectedIdx === idx ? 'var(--accent)' : q.status === 'saved' ? 'var(--green)' : undefined,
                  borderWidth: selectedIdx === idx ? 2 : 1,
                  opacity: q.status === 'skipped' ? 0.45 : 1
                }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: selectedIdx === idx ? 600 : 400, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {q.studentName}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{q.name}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0, marginLeft: 8 }}>
                    {q.status === 'saved' && <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ {q.score}</span>}
                    {q.status === 'pending' && selectedIdx === idx && <span style={{ fontSize: 11, color: 'var(--accent)' }}>editing</span>}
                    <button className="danger" style={{ fontSize: 10, padding: '1px 6px' }}
                      onClick={e => { e.stopPropagation(); removeFromQueue(q.id); }}>×</button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Right: scoring panel */}
          {item ? (
            <div>
              <div className="card" style={{ marginBottom: 10 }}>
                {/* Student name + file */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <input type="text" value={item.studentName}
                      onChange={e => updateItem(item.id, { studentName: e.target.value })}
                      style={{ fontSize: 16, fontWeight: 700, border: 'none', padding: 0, background: 'transparent', color: 'var(--text)', outline: 'none', width: '100%' }} />
                    <div style={{ fontSize: 11, color: 'var(--text3)' }}>{item.name}</div>
                  </div>
                  <span style={{ fontSize: 11, color: 'var(--text3)' }}>{selectedIdx + 1} of {queue.length}</span>
                </div>

                {/* Extracted comments */}
                {item.extractedComments && (
                  <div style={{ marginBottom: 14 }}>
                    <label>Extracted instructor comments</label>
                    <div style={{
                      padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6,
                      fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
                      maxHeight: 160, overflowY: 'auto', whiteSpace: 'pre-wrap',
                      border: '1px solid var(--border)'
                    }}>
                      {item.extractedComments}
                    </div>
                  </div>
                )}

                {/* Additional context — free window */}
                <div style={{ marginBottom: 14 }}>
                  <label>Additional context</label>
                  <textarea
                    rows={4}
                    value={item.additionalContext}
                    onChange={e => updateItem(item.id, { additionalContext: e.target.value })}
                    placeholder="Add anything else — what you told the student verbally, general class notes for this period, what you were emphasizing that week, things you noticed that aren't in the PDF comments…"
                    style={{ fontSize: 13, lineHeight: 1.6 }}
                  />
                </div>

                {/* Score */}
                <div style={{ marginBottom: 14 }}>
                  <label>Score</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {SCORES.map(s => (
                      <button key={s} onClick={() => updateItem(item.id, { score: String(s) })} style={{
                        padding: '8px 12px', fontSize: 14, fontWeight: 600, minWidth: 48,
                        background: item.score === String(s) ? 'var(--accent)' : 'var(--bg2)',
                        color: item.score === String(s) ? '#fff' : 'var(--text)',
                        border: `1px solid ${item.score === String(s) ? 'var(--accent)' : 'var(--border2)'}`,
                      }}>{s}</button>
                    ))}
                    <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center', marginLeft: 4 }}>/ {assignment?.maxScore || 6}</span>
                  </div>
                </div>

                {/* Quality */}
                <div style={{ marginBottom: 14 }}>
                  <label>Use as</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[['good', 'Good example'], ['weak', 'Weak example']].map(([k, l]) => (
                      <button key={k} onClick={() => updateItem(item.id, { quality: k })} style={{
                        flex: 1, padding: 8, fontSize: 13,
                        background: item.quality === k ? (k === 'good' ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.08)') : 'var(--bg)',
                        color: item.quality === k ? (k === 'good' ? 'var(--green)' : 'var(--red)') : 'var(--text2)',
                        border: `1px solid ${item.quality === k ? (k === 'good' ? 'var(--green)' : 'var(--red)') : 'var(--border2)'}`,
                        fontWeight: item.quality === k ? 600 : 400
                      }}>{l}</button>
                    ))}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label>Calibration note (optional)</label>
                  <input type="text" value={item.notes}
                    onChange={e => updateItem(item.id, { notes: e.target.value })}
                    placeholder="e.g. Strong BLUF, missing legend, good quantification"
                    style={{ fontSize: 13 }} />
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary" style={{ flex: 1, padding: 12, fontSize: 15, fontWeight: 600 }}
                  onClick={() => saveItem(item)} disabled={saving || !assignmentId}>
                  {saving ? 'Saving…' : item.status === 'saved' ? `Update ${item.score}/6` : `Save ${item.score}/6 → Next`}
                </button>
                {item.status !== 'saved' && (
                  <button onClick={() => { updateItem(item.id, { status: 'skipped' }); const next = queue.findIndex((x, i) => i > selectedIdx && x.status === 'pending'); if (next >= 0) setSelectedIdx(next); }}
                    style={{ fontSize: 13, padding: '12px 16px' }}>Skip</button>
                )}
                {item.status === 'saved' && (
                  <button className="danger" style={{ fontSize: 12 }}
                    onClick={() => { if (item.exampleId) removeSaved(item.exampleId); }}>
                    Remove
                  </button>
                )}
              </div>
              {item.status !== 'saved' && (
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
                  Changes save automatically as you type
                </div>
              )}
            </div>
          ) : (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              Select a submission from the list to score it.
            </div>
          )}
        </div>
      )}

      {/* Saved examples view */}
      {view === 'saved' && (
        <div>
          {savedExamples.length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
              No examples saved yet for {assignment?.name || 'this assignment'}.
            </div>
          ) : (
            <>
              <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 12 }}>
                {savedExamples.length} example{savedExamples.length !== 1 ? 's' : ''} in calibration bank for {assignment?.name}
              </div>
              {savedExamples.map(ex => (
                <SavedExampleCard
                  key={ex.id}
                  ex={ex}
                  maxScore={assignment?.maxScore || 6}
                  password={password}
                  assignmentId={assignmentId}
                  onRemove={() => removeSaved(ex.id)}
                  onUpdate={(updated) => setSavedExamples(s => s.map(x => x.id === updated.id ? updated : x))}
                />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function SavedExampleCard({ ex, maxScore, password, assignmentId, onRemove, onUpdate }) {
  const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [context, setContext] = useState(ex.content || '');
  const [notes, setNotes] = useState(ex.notes || '');
  const [saving, setSaving] = useState(false);

  async function saveContext() {
    setSaving(true);
    try {
      const r = await fetch(`${BASE}/api/assignments/${assignmentId}/examples/${ex.id}`, {
        method: 'PUT',
        headers: { 'x-admin-password': password, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...ex, content: context, notes })
      });
      if (r.ok) {
        const updated = await r.json();
        onUpdate(updated);
        setEditing(false);
      }
    } catch (e) { alert('Save error: ' + e.message); }
    setSaving(false);
  }

  const name = ex.student_name || ex.studentName;
  const score = ex.score;
  const quality = ex.quality;

  return (
    <div className="card" style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setOpen(o => !o)}>
          <span style={{ fontWeight: 600, fontSize: 14 }}>{name}</span>
          <span className={quality === 'weak' ? 'pill-red' : 'pill-green'} style={{ fontSize: 11, padding: '2px 8px' }}>
            {score}/{maxScore}
          </span>
          {quality === 'weak' && <span style={{ fontSize: 11, color: 'var(--text3)' }}>weak example</span>}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={() => { setOpen(true); setEditing(true); }}>
            Edit
          </button>
          <button className="danger" style={{ fontSize: 11, padding: '3px 8px' }} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>

      {ex.notes && !open && (
        <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{ex.notes}</div>
      )}

      {open && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
          {editing ? (
            <>
              <div className="field">
                <label>Calibration note</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)} />
              </div>
              <div className="field">
                <label>Content and context</label>
                <textarea rows={8} value={context} onChange={e => setContext(e.target.value)}
                  style={{ fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }} />
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary" onClick={saveContext} disabled={saving} style={{ fontSize: 12 }}>
                  {saving ? 'Saving…' : 'Save changes'}
                </button>
                <button onClick={() => setEditing(false)} style={{ fontSize: 12 }}>Cancel</button>
              </div>
            </>
          ) : (
            <>
              {notes && <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8, fontStyle: 'italic' }}>{notes}</div>}
              <pre style={{
                fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)',
                whiteSpace: 'pre-wrap', lineHeight: 1.6, background: 'var(--bg2)',
                padding: '10px 12px', borderRadius: 6, border: '1px solid var(--border)',
                maxHeight: 200, overflowY: 'auto'
              }}>{context || 'No content'}</pre>
            </>
          )}
        </div>
      )}
    </div>
  );
}
