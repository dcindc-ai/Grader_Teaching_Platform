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
function downloadApproved(courseId, pw) {
  window.open(`${BASE}/api/alwayson/download?courseId=${courseId}&password=${encodeURIComponent(pw)}`, '_blank');
}
function downloadDocx(id, pw) {
  window.open(`${BASE}/api/alwayson/docx/${id}?password=${encodeURIComponent(pw)}`, '_blank');
}

export default function AlwaysOnTab({ course, password }) {
  const [items, setItems] = useState([]);
  const [filter, setFilter] = useState('pending');
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getItems(course.id, filter, password).then(setItems);
  }, [course.id, filter]);

  const pending = items.filter(x => x.status === 'pending').length;
  const approved = items.filter(x => x.status === 'approved').length;

  async function approve(item) {
    const updated = await updateItem(item.id, {
      status: 'approved',
      feedbackSentences: item.feedbackSentences,
      links: item.links,
      reviewNotes: ''
    }, password);
    setItems(its => its.map(x => x.id === updated.id ? updated : x));
  }

  async function reject(item) {
    const updated = await updateItem(item.id, {
      status: 'rejected',
      feedbackSentences: item.feedbackSentences,
      links: item.links,
      reviewNotes: 'Rejected'
    }, password);
    setItems(its => its.map(x => x.id === updated.id ? updated : x));
  }

  function startEdit(item) {
    setEditing(item.id);
    setEditForm({
      feedbackSentences: item.feedbackSentences || '',
      links: item.links ? JSON.parse(JSON.stringify(item.links)) : [],
      reviewNotes: item.reviewNotes || ''
    });
  }

  async function saveEdit(item) {
    setSaving(true);
    const updated = await updateItem(item.id, {
      status: 'approved',
      feedbackSentences: editForm.feedbackSentences,
      links: editForm.links,
      reviewNotes: editForm.reviewNotes
    }, password);
    setItems(its => its.map(x => x.id === updated.id ? updated : x));
    setEditing(null);
    setSaving(false);
  }

  async function handleDelete(id) {
    await deleteItem(id, password);
    setItems(its => its.filter(x => x.id !== id));
  }

  function updLink(i, field, value) {
    setEditForm(f => {
      const links = [...f.links];
      links[i] = { ...links[i], [field]: value };
      return { ...f, links };
    });
  }

  function removeLink(i) {
    setEditForm(f => ({ ...f, links: f.links.filter((_, idx) => idx !== i) }));
  }

  function addLink() {
    setEditForm(f => ({ ...f, links: [...f.links, { url: '', title: '', why: '' }] }));
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Always-On Learning</div>
          <div className="page-sub">Review AI-generated recommendations before they go to students</div>
        </div>
        <button onClick={() => downloadApproved(course.id, password)} style={{ fontSize: 12 }} disabled={approved === 0}>
          ↓ Download approved ({approved})
        </button>
      </div>

      {/* Filter tabs */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        {[['pending', `Pending review (${pending})`], ['approved', 'Approved'], ['rejected', 'Rejected']].map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            padding: '7px 14px', fontSize: 12,
            background: filter === k ? 'var(--bg4)' : 'var(--bg3)',
            color: filter === k ? 'var(--text)' : 'var(--text2)',
            border: `1px solid ${filter === k ? 'var(--border2)' : 'var(--border)'}`,
            fontWeight: filter === k ? 500 : 400
          }}>{l}</button>
        ))}
        <button className="ghost" style={{ fontSize: 12, marginLeft: 'auto' }}
          onClick={() => getItems(course.id, filter, password).then(setItems)}>
          ↻ Refresh
        </button>
      </div>

      {items.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 8 }}>
          {filter === 'pending'
            ? 'No items pending review. Grade submissions to generate Always-On recommendations.'
            : `No ${filter} items.`}
        </div>
      )}

      {items.map(item => (
        <div key={item.id} className="card" style={{ marginBottom: 10 }}>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{item.studentName}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{item.assignmentName} · {new Date(item.createdAt).toLocaleDateString()}</div>
            </div>
            <span style={{
              fontSize: 11, padding: '3px 10px', borderRadius: 10,
              background: item.status === 'approved' ? 'rgba(76,175,114,0.12)' : item.status === 'rejected' ? 'rgba(224,82,82,0.1)' : 'rgba(79,142,247,0.12)',
              color: item.status === 'approved' ? 'var(--green)' : item.status === 'rejected' ? 'var(--red)' : 'var(--accent)'
            }}>{item.status}</span>
          </div>

          {/* Weak area */}
          <div style={{ marginBottom: 10 }}>
            <div className="sec-label">Focus area</div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--amber)' }}>{item.weakArea}</div>
          </div>

          {editing === item.id ? (
            /* Edit mode */
            <div>
              <div className="field">
                <label>Feedback sentences</label>
                <textarea rows={3} value={editForm.feedbackSentences}
                  onChange={e => setEditForm(f => ({ ...f, feedbackSentences: e.target.value }))}
                  style={{ fontSize: 13 }} />
              </div>

              <div style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <label style={{ margin: 0 }}>Links</label>
                  <button style={{ fontSize: 11 }} onClick={addLink}>+ Add link</button>
                </div>
                {editForm.links.map((lk, i) => (
                  <div key={i} style={{ padding: '10px', background: 'var(--bg3)', borderRadius: 6, marginBottom: 6 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                      <input type="text" value={lk.url} onChange={e => updLink(i, 'url', e.target.value)} placeholder="https://…" style={{ fontSize: 12 }} />
                      <input type="text" value={lk.title} onChange={e => updLink(i, 'title', e.target.value)} placeholder="Title" style={{ fontSize: 12 }} />
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input type="text" value={lk.why} onChange={e => updLink(i, 'why', e.target.value)} placeholder="Why this is relevant" style={{ flex: 1, fontSize: 12 }} />
                      <button className="danger" style={{ fontSize: 11 }} onClick={() => removeLink(i)}>×</button>
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
            /* View mode */
            <div>
              <div style={{ marginBottom: 10 }}>
                <div className="sec-label">Feedback</div>
                <p style={{ fontSize: 13, lineHeight: 1.7, fontStyle: 'italic', color: 'var(--text)' }}>{item.feedbackSentences}</p>
              </div>

              {item.links?.length > 0 && (
                <div style={{ marginBottom: 10 }}>
                  <div className="sec-label">Resources</div>
                  {item.links.map((lk, i) => (
                    <div key={i} style={{ padding: '8px 10px', background: 'var(--bg3)', borderRadius: 6, marginBottom: 4 }}>
                      <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--accent)', marginBottom: 2 }}>
                        {lk.title || lk.url}
                      </div>
                      {lk.why && <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 3 }}>{lk.why}</div>}
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
                  {item.status === 'approved' && (
                    <button style={{ fontSize: 12 }} onClick={() => downloadDocx(item.id, password)}>↓ Word doc</button>
                  )}
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
