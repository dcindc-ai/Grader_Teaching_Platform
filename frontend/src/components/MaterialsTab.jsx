import { useState, useEffect, useRef } from 'react';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

function h(pw) { return { 'x-admin-password': pw }; }

async function getMaterials(courseId, pw) {
  try {
    const r = await fetch(`${BASE}/api/materials?courseId=${courseId}`, { headers: h(pw) });
    if (!r.ok) throw new Error('Status ' + r.status);
    const data = await r.json();
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('getMaterials error:', e);
    return [];
  }
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
  const [uploadProgress, setUploadProgress] = useState(null); // {file, step, steps}
  const [preview, setPreview] = useState(null);
  const [showLink, setShowLink] = useState(false);
  const [linkForm, setLinkForm] = useState({ name: '', url: '', weekNumber: '', assignmentId: '', materialType: 'lecture' });
  const [uploadForm, setUploadForm] = useState({ name: '', weekNumber: '', assignmentId: '', materialType: 'lecture' });
  const fileRef = useRef();

  useEffect(() => {
    getMaterials(course.id, password).then(m => {
      console.log('Materials loaded:', m.length);
      setMaterials(m);
    });
    getAssignments(course.id, password).then(setAssignments);
  }, [course.id]);

  async function handleUpload(files) {
    const fileList = Array.from(files);
    setUploading(true);

    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = file.name.split('.').pop().toLowerCase();
      const isVisual = ['pdf', 'pptx', 'ppt'].includes(ext);

      const steps = [
        { key: 'upload', label: 'Uploading file…' },
        { key: 'text', label: 'Extracting text…' },
        isVisual ? { key: 'image', label: 'Analyzing images and slides…' } : null,
        { key: 'index', label: 'Indexing for grading…' },
      ].filter(Boolean);

      setUploadProgress({ file: file.name, step: 0, steps, total: fileList.length, current: i + 1 });

      const fd = new FormData();
      fd.append('file', file);
      fd.append('courseId', course.id);
      fd.append('name', uploadForm.name || file.name.replace(/\.[^.]+$/, ''));
      if (uploadForm.weekNumber) fd.append('weekNumber', uploadForm.weekNumber);
      if (uploadForm.assignmentId) fd.append('assignmentId', uploadForm.assignmentId);
      fd.append('materialType', uploadForm.materialType || 'lecture');

      try {
        // Simulate step progression while upload happens
        let stepIdx = 0;
        const stepTimer = setInterval(() => {
          stepIdx = Math.min(stepIdx + 1, steps.length - 1);
          setUploadProgress(p => p ? { ...p, step: stepIdx } : null);
        }, 800);

        const r = await fetch(`${BASE}/api/materials/upload`, {
          method: 'POST', headers: h(password), body: fd
        });
        clearInterval(stepTimer);

        if (r.ok) {
          const mat = await r.json();
          setUploadProgress(p => p ? { ...p, step: steps.length, done: true } : null);
          setMaterials(m => [mat, ...m.filter(x => x.id !== mat.id)]);
        } else {
          const err = await r.json();
          setUploadProgress(p => p ? { ...p, error: err.error || 'Upload failed' } : null);
        }
      } catch (e) {
        setUploadProgress(p => p ? { ...p, error: e.message } : null);
      }
    }

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
          <div className="page-sub">Upload lectures, readings, and links. Lecture type = pulled into grading automatically.</div>
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

      {/* Upload progress */}
      {uploadProgress && (
        <div className="card" style={{ marginBottom: 14, borderColor: uploadProgress.error ? 'var(--red)' : uploadProgress.done ? 'var(--green)' : 'var(--accent)', borderWidth: 2 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 600, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 300 }}>
              {uploadProgress.file}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
              {uploadProgress.total > 1 && (
                <span style={{ fontSize: 12, color: 'var(--text3)' }}>
                  {uploadProgress.current} of {uploadProgress.total}
                </span>
              )}
              {(uploadProgress.done || uploadProgress.error) && !uploading && (
                <button onClick={() => {
                  setUploadProgress(null);
                  setUploadForm({ name: '', weekNumber: '', assignmentId: '', materialType: 'lecture' });
                }} style={{ fontSize: 11, padding: '2px 10px' }}>
                  Dismiss
                </button>
              )}
            </div>
          </div>

          {/* Step indicators */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {uploadProgress.steps.map((s, i) => {
              const isDone = i < uploadProgress.step || uploadProgress.done;
              const isActive = i === uploadProgress.step && !uploadProgress.done && !uploadProgress.error;
              return (
                <div key={s.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: uploadProgress.error && isActive ? 'var(--red)' :
                                isDone ? 'var(--green)' :
                                isActive ? 'var(--accent)' : 'var(--bg3)',
                    border: `2px solid ${uploadProgress.error && isActive ? 'var(--red)' : isDone ? 'var(--green)' : isActive ? 'var(--accent)' : 'var(--border)'}`,
                    transition: 'all 0.3s'
                  }}>
                    {isDone ? (
                      <span style={{ color: '#fff', fontSize: 13 }}>✓</span>
                    ) : isActive ? (
                      <span style={{ color: '#fff', fontSize: 10, animation: 'spin 1s linear infinite' }}>⟳</span>
                    ) : (
                      <span style={{ color: 'var(--text3)', fontSize: 11 }}>{i + 1}</span>
                    )}
                  </div>
                  <span style={{ fontSize: 10, color: isDone ? 'var(--green)' : isActive ? 'var(--accent)' : 'var(--text3)', textAlign: 'center', lineHeight: 1.3 }}>
                    {s.label.replace('…', '')}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Progress bar */}
          <div style={{ height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 2,
              background: uploadProgress.error ? 'var(--red)' : uploadProgress.done ? 'var(--green)' : 'var(--accent)',
              width: uploadProgress.error ? '100%' :
                     uploadProgress.done ? '100%' :
                     `${(uploadProgress.step / uploadProgress.steps.length) * 100}%`,
              transition: 'width 0.4s ease, background 0.3s'
            }} />
          </div>

          {/* Status text */}
          <div style={{ marginTop: 8, fontSize: 12,
            color: uploadProgress.error ? 'var(--red)' : uploadProgress.done ? 'var(--green)' : 'var(--text2)' }}>
            {uploadProgress.error ? '✗ ' + uploadProgress.error :
             uploadProgress.done ? '✓ Uploaded and indexed successfully' :
             uploadProgress.steps[uploadProgress.step]?.label || 'Processing…'}
          </div>
        </div>
      )}

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
                    {mat.material_type && (
                      <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                        background: mat.material_type === 'lecture' ? 'rgba(37,99,235,0.1)' : mat.material_type === 'reference' ? 'rgba(217,119,6,0.1)' : 'rgba(22,163,74,0.1)',
                        color: mat.material_type === 'lecture' ? 'var(--accent)' : mat.material_type === 'reference' ? 'var(--amber)' : 'var(--green)' }}>
                        {mat.material_type}
                      </span>
                    )}
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
