import { useState, useEffect, useRef } from 'react';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

function h(pw) { return { 'x-admin-password': pw }; }

async function getMaterials(courseId, pw) {
  const r = await fetch(`${BASE}/api/materials?courseId=${courseId}`, { headers: h(pw) });
  return r.json();
}
async function deleteMaterial(id, pw) {
  await fetch(`${BASE}/api/materials/${id}`, { method: 'DELETE', headers: h(pw) });
}
async function getTextPreview(id, pw) {
  const r = await fetch(`${BASE}/api/materials/${id}/text`, { headers: h(pw) });
  return r.json();
}
async function addLink(data, pw) {
  const r = await fetch(`${BASE}/api/materials/link`, { method: 'POST', headers: { ...h(pw), 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return r.json();
}

const TYPE_ICONS = { pdf: '📄', pptx: '📊', docx: '📝', link: '🔗', other: '📎' };
const TYPE_COLORS = { pdf: 'var(--red)', pptx: 'var(--amber)', docx: 'var(--accent)', link: 'var(--green)', other: 'var(--text2)' };

export default function MaterialsTab({ course, password }) {
  const [materials, setMaterials] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [showLink, setShowLink] = useState(false);
  const [linkForm, setLinkForm] = useState({ name: '', url: '', weekNumber: '', assignmentId: '', materialType: 'lecture' });
  const [uploadForm, setUploadForm] = useState({ name: '', weekNumber: '', assignmentId: '', materialType: 'lecture' });
  const fileRef = useRef();

  useEffect(() => {
    getMaterials(course.id, password).then(setMaterials);
    getAssignments(course.id, password).then(setAssignments);
  }, [course.id]);

  async function handleUpload(files) {
    setUploading(true);
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('courseId', course.id);
      fd.append('name', uploadForm.name || file.name.replace(/\.[^.]+$/, ''));
      if (uploadForm.weekNumber) fd.append('weekNumber', uploadForm.weekNumber);
      if (uploadForm.assignmentId) fd.append('assignmentId', uploadForm.assignmentId);
      fd.append('materialType', uploadForm.materialType || 'lecture');
      try {
        const r = await fetch(`${BASE}/api/materials/upload`, {
          method: 'POST', headers: h(password), body: fd
        });
        const mat = await r.json();
        setMaterials(m => [mat, ...m.filter(x => x.id !== mat.id)]);
      } catch (e) { console.error(e); }
    }
    setUploadForm({ name: '', weekNumber: '', assignmentId: '', materialType: 'lecture' });
    setUploading(false);
  }

  async function handleAddLink() {
    if (!linkForm.url) return;
    const mat = await addLink({ ...linkForm, courseId: course.id }, password);
    setMaterials(m => [mat, ...m]);
    setLinkForm({ name: '', url: '', weekNumber: '', assignmentId: '' });
    setShowLink(false);
  }

  async function handleDelete(id) {
    await deleteMaterial(id, password);
    setMaterials(m => m.filter(x => x.id !== id));
    if (preview?.id === id) setPreview(null);
  }

  async function handlePreview(mat) {
    if (preview?.id === mat.id) { setPreview(null); return; }
    const data = await getTextPreview(mat.id, password);
    setPreview({ id: mat.id, ...data });
  }

  const grouped = {};
  for (const m of materials) {
    const key = m.weekNumber ? `Week ${m.weekNumber}` : 'Unassigned';
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Course Materials</div>
          <div className="page-sub">Upload lectures, readings, and links. Linked to grading for context-aware feedback.</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setShowLink(l => !l)} style={{ fontSize: 12 }}>
            {showLink ? 'Cancel' : '+ Add link'}
          </button>
          <button className="primary" onClick={() => fileRef.current.click()} disabled={uploading} style={{ fontSize: 12 }}>
            {uploading ? 'Uploading…' : '↑ Upload file'}
          </button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".pdf,.ppt,.pptx,.doc,.docx" multiple style={{ display: 'none' }}
        onChange={e => handleUpload(e.target.files)} />

      {/* Upload options */}
      <div className="card" style={{ marginBottom: 14, borderColor: uploadForm.materialType === 'lecture' ? 'var(--accent)' : 'var(--border)', borderWidth: uploadForm.materialType === 'lecture' ? 2 : 1 }}>
        <div style={{ fontWeight: 600, marginBottom: 12, fontSize: 13 }}>Upload settings</div>

        {/* Material type — most important choice */}
        <div className="field">
          <label>Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              ['lecture', '🎓 Lecture', 'Students graded against this — concepts should appear in their work'],
              ['reference', '📚 Reference', 'Background material, not directly assessed'],
              ['example', '✨ Example', 'Good example for students to study']
            ].map(([val, label, desc]) => (
              <div key={val} onClick={() => setUploadForm(f => ({ ...f, materialType: val }))}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 6, cursor: 'pointer',
                  border: `2px solid ${uploadForm.materialType === val ? 'var(--accent)' : 'var(--border)'}`,
                  background: uploadForm.materialType === val ? 'rgba(37,99,235,0.05)' : 'var(--bg)' }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: uploadForm.materialType === val ? 'var(--accent)' : 'var(--text)' }}>{label}</div>
                <div style={{ fontSize: 10, color: 'var(--text3)', marginTop: 2, lineHeight: 1.4 }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>

        {uploadForm.materialType === 'lecture' && (
          <div style={{ padding: '8px 10px', background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.2)', borderRadius: 6, fontSize: 12, color: 'var(--accent)', marginBottom: 10 }}>
            Lecture materials are pulled into the grading prompt. Students will be evaluated on whether they demonstrate understanding of concepts covered.
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 1fr', gap: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Name (leave blank to use filename)</label>
            <input type="text" value={uploadForm.name} onChange={e => setUploadForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Module 2 Lecture" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Week</label>
            <input type="number" min="1" value={uploadForm.weekNumber} onChange={e => setUploadForm(f => ({ ...f, weekNumber: e.target.value }))} placeholder="#" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Link to assignment</label>
            <select value={uploadForm.assignmentId} onChange={e => setUploadForm(f => ({ ...f, assignmentId: e.target.value }))}>
              <option value="">All assignments</option>
              {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Add link form */}
      {showLink && (
        <div className="card" style={{ marginBottom: 14, borderColor: course.color }}>
          <div style={{ fontWeight: 500, marginBottom: 10 }}>Add link</div>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>URL</label>
              <input type="text" value={linkForm.url} onChange={e => setLinkForm(f => ({ ...f, url: e.target.value }))} placeholder="https://…" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Display name</label>
              <input type="text" value={linkForm.name} onChange={e => setLinkForm(f => ({ ...f, name: e.target.value }))} placeholder="Article title" />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 8, marginBottom: 10 }}>
            <div className="field" style={{ margin: 0 }}>
              <label>Week</label>
              <input type="number" value={linkForm.weekNumber} onChange={e => setLinkForm(f => ({ ...f, weekNumber: e.target.value }))} placeholder="#" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Link to assignment</label>
              <select value={linkForm.assignmentId} onChange={e => setLinkForm(f => ({ ...f, assignmentId: e.target.value }))}>
                <option value="">All assignments</option>
                {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
          </div>
          <button className="primary" onClick={handleAddLink} style={{ fontSize: 12 }}>Add link</button>
        </div>
      )}

      {materials.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 13, border: '1px dashed var(--border2)', borderRadius: 8 }}>
          No materials uploaded yet. Upload PDFs, PowerPoints, Word docs, or add links.
        </div>
      )}

      {Object.entries(grouped).sort(([a],[b]) => {
        if (a === 'Unassigned') return 1;
        if (b === 'Unassigned') return -1;
        return parseInt(a.split(' ')[1]) - parseInt(b.split(' ')[1]);
      }).map(([week, items]) => (
        <div key={week} style={{ marginBottom: 16 }}>
          <div className="sec-label">{week}</div>
          {items.map(mat => (
            <div key={mat.id}>
              <div className="card card-hover" style={{ marginBottom: 4, display: 'flex', alignItems: 'center', gap: 12 }}
                onClick={() => handlePreview(mat)}>
                <span style={{ fontSize: 18 }}>{TYPE_ICONS[mat.type] || '📎'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{mat.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 8 }}>
                    <span style={{ color: TYPE_COLORS[mat.type] }}>{mat.type?.toUpperCase()}</span>
                    {mat.fileSize && <span>{Math.round(mat.fileSize/1024)}KB</span>}
                    {mat.extractedText && <span>{Math.round(mat.extractedText.length/1000)}K chars extracted</span>}
                    {mat.url && <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 200 }}>{mat.url}</span>}
                    <span>{new Date(mat.uploadedAt).toLocaleDateString()}</span>
                  </div>
                </div>
                {mat.assignmentId && (
                  <span className="badge">{assignments.find(a => a.id === mat.assignmentId)?.name || 'linked'}</span>
                )}
                <button className="danger" style={{ fontSize: 11, padding: '2px 8px', flexShrink: 0 }}
                  onClick={e => { e.stopPropagation(); handleDelete(mat.id); }}>Remove</button>
              </div>
              {preview?.id === mat.id && (
                <div className="card" style={{ marginBottom: 8, marginTop: -2, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                  <div className="sec-label">Extracted text preview ({preview.length?.toLocaleString()} chars)</div>
                  <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.5, maxHeight: 200, overflow: 'auto' }}>
                    {preview.text?.slice(0, 1500) || 'No text extracted.'}{preview.text?.length > 1500 ? '\n…' : ''}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
