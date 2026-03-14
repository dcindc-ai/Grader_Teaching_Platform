import { useState, useRef } from 'react';
import { getAssignments, addExample } from '../api.js';
import { useEffect } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const SCORES = [3, 3.5, 4, 4.5, 5, 5.5, 6];

export default function LabelTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [queue, setQueue] = useState([]); // {file, name, status, preview}
  const [current, setCurrent] = useState(0);
  const [score, setScore] = useState('4');
  const [quality, setQuality] = useState('good');
  const [notes, setNotes] = useState('');
  const [additionalComments, setAdditionalComments] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(0);
  const [parsing, setParsing] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setAssignmentId(a[0].id);
    });
  }, [course.id]);

  async function parsePDF(file) {
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`${BASE}/api/label/parse`, {
        method: 'POST',
        headers: { 'x-admin-password': password },
        body: fd
      });
      return await r.json();
    } catch (e) {
      return { studentName: file.name.replace(/\.[^.]+$/, ''), comments: '', error: e.message };
    }
  }

  async function handleFiles(files) {
    const pdfs = Array.from(files).filter(f => f.name.endsWith('.pdf'));
    if (!pdfs.length) return;
    setParsing(true);

    const items = [];
    for (const file of pdfs) {
      const parsed = await parsePDF(file);
      items.push({
        file,
        name: file.name,
        studentName: parsed.studentName || file.name.replace('.pdf',''),
        extractedComments: parsed.comments || '',
        pageCount: parsed.pageCount || 1,
        status: 'pending'
      });
    }

    setQueue(q => [...q, ...items]);
    setParsing(false);
    if (queue.length === 0) setCurrent(0);
  }

  async function saveAndNext() {
    if (!queue[current] || !assignmentId) return;
    setSaving(true);
    const item = queue[current];

    const content = [
      item.extractedComments,
      additionalComments ? `\nAdditional instructor notes:\n${additionalComments}` : ''
    ].filter(Boolean).join('\n');

    try {
      await addExample(assignmentId, {
        courseId: course.id,
        studentName: item.studentName,
        score: parseFloat(score),
        quality,
        notes: notes || `Historical calibration example — score ${score}`,
        content
      }, password);

      setQueue(q => q.map((x, i) => i === current ? { ...x, status: 'saved', savedScore: score } : x));
      setSaved(s => s + 1);

      // Move to next pending
      const nextIdx = queue.findIndex((x, i) => i > current && x.status === 'pending');
      if (nextIdx >= 0) {
        setCurrent(nextIdx);
      } else {
        const anyPending = queue.findIndex((x, i) => i !== current && x.status === 'pending');
        if (anyPending >= 0) setCurrent(anyPending);
      }

      // Reset fields
      setScore('4');
      setQuality('good');
      setNotes('');
      setAdditionalComments('');
    } catch (e) {
      alert('Save error: ' + e.message);
    }
    setSaving(false);
  }

  async function skipCurrent() {
    setQueue(q => q.map((x, i) => i === current ? { ...x, status: 'skipped' } : x));
    const nextIdx = queue.findIndex((x, i) => i > current && x.status === 'pending');
    if (nextIdx >= 0) setCurrent(nextIdx);
    setScore('4'); setNotes(''); setAdditionalComments('');
  }

  function removeFromQueue(idx) {
    setQueue(q => q.filter((_, i) => i !== idx));
    if (current >= idx && current > 0) setCurrent(c => c - 1);
  }

  const item = queue[current];
  const pending = queue.filter(x => x.status === 'pending').length;
  const assignment = assignments.find(a => a.id === assignmentId);

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Label Historical Data</div>
          <div className="page-sub">Upload content summary PDFs, set scores, build your calibration bank</div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {saved > 0 && (
            <span style={{ fontSize: 12, color: 'var(--green)', fontWeight: 500 }}>
              ✓ {saved} saved
            </span>
          )}
          <select value={assignmentId} onChange={e => setAssignmentId(e.target.value)} style={{ fontSize: 13, fontWeight: 500 }}>
            {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      </div>

      <div className="two-col" style={{ alignItems: 'start' }}>
        {/* Left — upload + queue */}
        <div>
          <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: 'none' }}
            onChange={e => handleFiles(e.target.files)} />

          {queue.length === 0 ? (
            <div className="drop-zone" style={{ marginBottom: 12 }}
              onClick={() => fileRef.current.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleFiles(e.dataTransfer.files); }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>📂</div>
              <p>Drop content summary PDFs here</p>
              <small>Upload as many as you have — they'll queue up one at a time</small>
            </div>
          ) : (
            <button style={{ width: '100%', marginBottom: 10, fontSize: 12 }}
              onClick={() => fileRef.current.click()} disabled={parsing}>
              {parsing ? 'Reading PDFs…' : '+ Add more PDFs'}
            </button>
          )}

          {parsing && (
            <div style={{ padding: '10px 12px', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 8, fontSize: 12, color: 'var(--accent)', marginBottom: 10 }}>
              Reading PDFs and extracting comments…
            </div>
          )}

          {/* Queue list */}
          {queue.map((q, idx) => (
            <div key={idx}
              onClick={() => { if (q.status === 'pending') { setCurrent(idx); setScore('4'); setNotes(''); setAdditionalComments(''); } }}
              className="card card-hover"
              style={{
                marginBottom: 4, padding: '8px 12px',
                borderColor: idx === current ? 'var(--accent)' : q.status === 'saved' ? 'var(--green)' : undefined,
                borderWidth: idx === current ? 2 : 1,
                opacity: q.status === 'skipped' ? 0.4 : 1
              }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: idx === current ? 600 : 400 }}>
                    {q.studentName}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text3)' }}>{q.name}</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {q.status === 'saved' && (
                    <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>✓ {q.savedScore}/6</span>
                  )}
                  {q.status === 'skipped' && (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>skipped</span>
                  )}
                  {q.status === 'pending' && idx === current && (
                    <span style={{ fontSize: 11, color: 'var(--accent)' }}>editing</span>
                  )}
                  <button className="danger" style={{ fontSize: 10, padding: '1px 6px' }}
                    onClick={e => { e.stopPropagation(); removeFromQueue(idx); }}>×</button>
                </div>
              </div>
            </div>
          ))}

          {queue.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text3)' }}>
              {pending} pending · {saved} saved · {queue.filter(x => x.status === 'skipped').length} skipped
            </div>
          )}
        </div>

        {/* Right — scoring panel */}
        {item ? (
          <div>
            <div className="card" style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{item.studentName}</div>
                  <div style={{ fontSize: 12, color: 'var(--text2)' }}>{assignment?.name} · {item.name}</div>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)' }}>
                  {current + 1} of {queue.length}
                </div>
              </div>

              {/* Extracted comments */}
              {item.extractedComments && (
                <div style={{ marginBottom: 14 }}>
                  <div className="sec-label">Extracted instructor comments</div>
                  <div style={{
                    padding: '10px 12px', background: 'var(--bg2)', borderRadius: 6,
                    fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
                    maxHeight: 200, overflowY: 'auto', whiteSpace: 'pre-wrap'
                  }}>
                    {item.extractedComments}
                  </div>
                </div>
              )}

              {/* Additional comments */}
              <div className="field">
                <label>Additional comments (optional)</label>
                <textarea
                  rows={3}
                  value={additionalComments}
                  onChange={e => setAdditionalComments(e.target.value)}
                  placeholder="Any extra notes about this submission beyond what's in the PDF…"
                  style={{ fontSize: 13 }}
                />
              </div>

              {/* Score */}
              <div style={{ marginBottom: 14 }}>
                <label>Score</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {SCORES.map(s => (
                    <button
                      key={s}
                      onClick={() => setScore(String(s))}
                      style={{
                        padding: '8px 14px', fontSize: 14, fontWeight: 600,
                        background: score === String(s) ? 'var(--accent)' : 'var(--bg3)',
                        color: score === String(s) ? '#fff' : 'var(--text)',
                        border: `1px solid ${score === String(s) ? 'var(--accent)' : 'var(--border2)'}`,
                        minWidth: 52
                      }}>
                      {s}
                    </button>
                  ))}
                  <span style={{ fontSize: 12, color: 'var(--text3)', alignSelf: 'center', marginLeft: 4 }}>
                    / {assignment?.maxScore || 6}
                  </span>
                </div>
              </div>

              {/* Quality tier */}
              <div className="field">
                <label>Use as</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[['good','Good example'],['weak','Weak example']].map(([k,l]) => (
                    <button key={k} onClick={() => setQuality(k)} style={{
                      flex: 1, padding: '7px', fontSize: 13,
                      background: quality === k ? (k === 'good' ? 'rgba(22,163,74,0.1)' : 'rgba(220,38,38,0.08)') : 'var(--bg)',
                      color: quality === k ? (k === 'good' ? 'var(--green)' : 'var(--red)') : 'var(--text2)',
                      border: `1px solid ${quality === k ? (k === 'good' ? 'var(--green)' : 'var(--red)') : 'var(--border2)'}`,
                      fontWeight: quality === k ? 600 : 400
                    }}>{l}</button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div className="field" style={{ marginBottom: 0 }}>
                <label>Calibration note (optional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder={`e.g. Strong BLUF, missing legend, good quantification`} />
              </div>
            </div>

            {/* Action buttons */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="primary"
                style={{ flex: 1, padding: 12, fontSize: 15, fontWeight: 600 }}
                onClick={saveAndNext}
                disabled={saving || !assignmentId}
              >
                {saving ? 'Saving…' : `Save ${score}/6 → Next`}
              </button>
              <button onClick={skipCurrent} style={{ fontSize: 13, padding: '12px 16px' }}>
                Skip
              </button>
            </div>

            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text3)', textAlign: 'center' }}>
              Enter to save and move to the next submission
            </div>
          </div>
        ) : queue.length === 0 ? (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
            Upload PDFs on the left to start labeling.<br />
            Each submission takes about 10 seconds to score.
          </div>
        ) : (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--green)', fontSize: 14, fontWeight: 500 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>✓</div>
            All done! {saved} example{saved !== 1 ? 's' : ''} saved to the calibration bank.
          </div>
        )}
      </div>
    </div>
  );
}
