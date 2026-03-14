import { useState, useEffect } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
function h(pw) { return { 'x-admin-password': pw }; }

async function getItems(courseId, status, pw) {
  const q = new URLSearchParams({ courseId });
  if (status) q.set('status', status);
  const r = await fetch(`${BASE}/api/alwayson?${q}`, { headers: h(pw) });
  return r.json();
}
async function updateItem(id, data, pw) {
  const r = await fetch(`${BASE}/api/alwayson/${id}`, {
    method: 'PUT', headers: { ...h(pw), 'Content-Type': 'application/json' }, body: JSON.stringify(data)
  });
  return r.json();
}
async function deleteItem(id, pw) {
  await fetch(`${BASE}/api/alwayson/${id}`, { method: 'DELETE', headers: h(pw) });
}
async function generateClassSummary(courseId, assignmentId, pw) {
  const r = await fetch(`${BASE}/api/alwayson/class-summary`, {
    method: 'POST', headers: { ...h(pw), 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, assignmentId })
  });
  return r.json();
}
function downloadDocx(id, pw) {
  window.open(`${BASE}/api/alwayson/docx/${id}?password=${encodeURIComponent(pw)}`, '_blank');
}
function downloadAllDocx(courseId, pw) {
  window.open(`${BASE}/api/alwayson/download?courseId=${courseId}&password=${encodeURIComponent(pw)}`, '_blank');
}

async function generateAlwaysOn(courseId, assignmentId, mode, studentName, pw) {
  const r = await fetch(`${BASE}/api/alwayson/generate`, {
    method: 'POST',
    headers: { ...h(pw), 'Content-Type': 'application/json' },
    body: JSON.stringify({ courseId, assignmentId, mode, studentName })
  });
  return r.json();
}

function firstName(name) {
  if (!name || name === 'Unknown' || name === 'Class') return name || 'Unknown';
  return name.trim().split(' ')[0];
}

export default function AlwaysOnTab({ course, password }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [classSummary, setClassSummary] = useState(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showGenerate, setShowGenerate] = useState(false);
  const [assignments, setAssignments] = useState([]);
  const [genAssignmentId, setGenAssignmentId] = useState('');
  const [genMode, setGenMode] = useState('per-student');
  const [genStudent, setGenStudent] = useState('');
  const [generating, setGenerating] = useState(false);
  const [genResult, setGenResult] = useState(null);

  useEffect(() => {
    fetch(`${BASE}/api/assignments?courseId=${course.id}`, { headers: h(password) })
      .then(r => r.json()).then(setAssignments).catch(() => {});
  }, [course.id]);

  useEffect(() => {
    getItems(course.id, filter, password).then(setItems);
  }, [course.id, filter]);

  const pending = items.filter(x => x.status === 'pending').length;
  const approved = items.filter(x => x.status === 'approved' && x.studentName !== 'Class').length;

  async function approve(item) {
    const updated = await updateItem(item.id, {
      status: 'approved', feedbackSentences: item.feedbackSentences,
      links: item.links, reviewNotes: ''
    }, password);
    setItems(its => its.map(x => x.id === updated.id ? updated : x));
  }

  async function reject(item) {
    const updated = await updateItem(item.id, {
      status: 'rejected', feedbackSentences: item.feedbackSentences,
      links: item.links, reviewNotes: 'Rejected'
    }, password);
    setItems(its => its.map(x => x.id === updated.id ? updated : x));
  }

  function startEdit(item) {
    setEditing(item.id);
    setEditForm({ feedbackSentences: item.feedbackSentences || '', links: JSON.parse(JSON.stringify(item.links || [])), reviewNotes: '' });
  }

  async function saveEdit(item) {
    setSaving(true);
    const updated = await updateItem(item.id, { status: 'approved', ...editForm }, password);
    setItems(its => its.map(x => x.id === updated.id ? updated : x));
    setEditing(null);
    setSaving(false);
  }

  async function handleDelete(id) {
    await deleteItem(id, password);
    setItems(its => its.filter(x => x.id !== id));
  }

  async function handleClassSummary() {
    setGeneratingSummary(true);
    try {
      const result = await generateClassSummary(course.id, null, password);
      setClassSummary(result);
      setShowSummary(true);
    } catch (e) { alert('Error: ' + e.message); }
    setGeneratingSummary(false);
  }

  function updLink(i, field, value) {
    setEditForm(f => { const links = [...f.links]; links[i] = { ...links[i], [field]: value }; return { ...f, links }; });
  }

  const studentItems = items.filter(x => x.studentName !== 'Class');

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Always-On Learning</div>
          <div className="page-sub">Review recommendations before they go to students</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={handleClassSummary} disabled={generatingSummary || approved === 0}
            style={{ fontSize: 12 }}>
            {generatingSummary ? 'Generating…' : '✦ Class summary'}
          </button>
          <button onClick={() => downloadAllDocx(course.id, password)} disabled={approved === 0}
            style={{ fontSize: 12 }}>
            ↓ Download all ({approved})
          </button>
        </div>
      </div>

      {/* Class summary panel */}
      {showSummary && classSummary && (
        <div className="card" style={{ marginBottom: 16, borderColor: 'var(--accent)', borderWidth: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 15 }}>Class Summary</div>
            <button className="ghost" style={{ fontSize: 12 }} onClick={() => setShowSummary(false)}>Hide</button>
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)', marginBottom: 14 }}>{classSummary.overview}</p>
          {classSummary.recommendations?.map((r, i) => (
            <div key={i} style={{
              padding: '8px 12px', background: 'rgba(37,99,235,0.05)',
              border: '1px solid rgba(37,99,235,0.15)', borderRadius: 6,
              marginBottom: 6, fontSize: 13
            }}>
              <span style={{ fontWeight: 600, color: 'var(--accent)', marginRight: 8 }}>{i + 1}.</span>
              {r}
            </div>
          ))}
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--text3)' }}>
            Post this to Canvas as a class announcement or discussion summary.
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['pending', `Pending (${pending})`], ['approved', `Approved (${approved})`], ['rejected', 'Rejected']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '7px 14px', fontSize: 12,
            background: filter === k ? 'var(--bg4)' : 'var(--bg3)',
            color: filter === k ? 'var(--text)' : 'var(--text2)',
            border: `1px solid ${filter === k ? 'var(--border2)' : 'var(--border)'}`,
            fontWeight: filter === k ? 500 : 400
          }}>{l}</button>
        ))}
        <button className="ghost" style={{ fontSize: 12, marginLeft: 'auto' }}
          onClick={() => getItems(course.id, filter, password).then(setItems)}>↻ Refresh</button>
      </div>

      {studentItems.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 8 }}>
          {filter === 'pending'
            ? 'No items pending review. Grade submissions to generate Always-On recommendations.'
            : `No ${filter} items.`}
        </div>
      )}

      {studentItems.map(item => (
        <div key={item.id} className="card" style={{ marginBottom: 10 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{firstName(item.studentName)}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{item.assignmentName} · {new Date(item.createdAt).toLocaleDateString()}</div>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {item.status === 'approved' && (
                <button style={{ fontSize: 11, padding: '4px 10px' }}
                  onClick={() => downloadDocx(item.id, password)}>
                  ↓ Word doc
                </button>
              )}
              <span style={{
                fontSize: 11, padding: '3px 10px', borderRadius: 10,
                background: item.status === 'approved' ? 'rgba(22,163,74,0.08)' : item.status === 'rejected' ? 'rgba(220,38,38,0.08)' : 'rgba(37,99,235,0.08)',
                color: item.status === 'approved' ? 'var(--green)' : item.status === 'rejected' ? 'var(--red)' : 'var(--accent)',
                border: `1px solid ${item.status === 'approved' ? 'rgba(22,163,74,0.2)' : item.status === 'rejected' ? 'rgba(220,38,38,0.2)' : 'rgba(37,99,235,0.2)'}`
              }}>{item.status}</span>
            </div>
          </div>

          {/* Focus area */}
          <div style={{ marginBottom: 10 }}>
            <div className="sec-label">Focus area</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--amber)' }}>{item.weakArea}</div>
          </div>

          {editing === item.id ? (
            <div>
              <div className="field">
                <label>Feedback</label>
                <textarea rows={3} value={editForm.feedbackSentences}
                  onChange={e => setEditForm(f => ({ ...f, feedbackSentences: e.target.value }))}
                  style={{ fontSize: 13 }} />
              </div>
              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Links</label>
                  <button style={{ fontSize: 11 }} onClick={() => setEditForm(f => ({ ...f, links: [...f.links, { url: '', title: '', why: '' }] }))}>+ Add</button>
                </div>
                {editForm.links.map((lk, i) => (
                  <div key={i} style={{ padding: 8, background: 'var(--bg3)', borderRadius: 6, marginBottom: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 4 }}>
                      <input type="text" value={lk.url} onChange={e => updLink(i, 'url', e.target.value)} placeholder="https://…" style={{ fontSize: 12 }} />
                      <input type="text" value={lk.title} onChange={e => updLink(i, 'title', e.target.value)} placeholder="Title" style={{ fontSize: 12 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="text" value={lk.why} onChange={e => updLink(i, 'why', e.target.value)} placeholder="Why relevant" style={{ flex: 1, fontSize: 12 }} />
                      <button className="danger" style={{ fontSize: 11 }} onClick={() => setEditForm(f => ({ ...f, links: f.links.filter((_, j) => j !== i) }))}>×</button>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="primary" onClick={() => saveEdit(item)} disabled={saving}>{saving ? 'Saving…' : 'Approve & save'}</button>
                <button onClick={() => setEditing(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <div>
              <div style={{ marginBottom: 10 }}>
                <div className="sec-label">Feedback for {firstName(item.studentName)}</div>
                <p style={{ fontSize: 13, lineHeight: 1.7, fontStyle: 'italic', color: 'var(--text)' }}>{item.feedbackSentences}</p>
              </div>
              {item.links?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div className="sec-label">Resources</div>
                  {item.links.map((lk, i) => (
                    <div key={i} style={{ padding: '7px 10px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 6, marginBottom: 4 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--accent)', marginBottom: 2 }}>{lk.title || lk.url}</div>
                      {lk.why && <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 2 }}>{lk.why}</div>}
                      <div style={{ fontSize: 11, color: 'var(--text3)', wordBreak: 'break-all' }}>{lk.url}</div>
                    </div>
                  ))}
                </div>
              )}
              {item.status === 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <button className="primary" style={{ fontSize: 12 }} onClick={() => approve(item)}>✓ Approve</button>
                  <button style={{ fontSize: 12 }} onClick={() => startEdit(item)}>Edit & approve</button>
                  <button className="danger" style={{ fontSize: 12 }} onClick={() => reject(item)}>Reject</button>
                </div>
              )}
              {item.status !== 'pending' && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                  <button style={{ fontSize: 12 }} onClick={() => startEdit(item)}>Edit</button>
                  <button className="danger" style={{ fontSize: 12 }} onClick={() => handleDelete(item.id)}>Delete</button>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
