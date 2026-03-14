import { useState, useEffect } from 'react';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment, getExamples, addExample, deleteExample } from '../api.js';

const SCORES_6 = [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5,5.5,6];
const SCORES_10 = [1,2,3,4,5,6,7,8,9,10];

export default function AssignmentsTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [selected, setSelected] = useState(null);
  const [examples, setExamples] = useState([]);
  const [editMode, setEditMode] = useState(false);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAddEx, setShowAddEx] = useState(false);
  const [exForm, setExForm] = useState({ studentName: '', score: '4', quality: 'good', notes: '', content: '' });

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) { setSelected(a[0]); setForm(a[0]); }
    });
  }, [course.id]);

  useEffect(() => {
    if (selected) {
      getExamples(selected.id, password).then(setExamples);
    }
  }, [selected?.id]);

  function selectAssignment(a) {
    setSelected(a);
    setForm(a);
    setEditMode(false);
    setSaved(false);
  }

  async function saveAssignment() {
    setSaving(true);
    const updated = await updateAssignment(selected.id, form, password);
    setAssignments(as => as.map(a => a.id === updated.id ? updated : a));
    setSelected(updated);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setEditMode(false);
  }

  async function handleAddAssignment() {
    const name = prompt('Assignment name (e.g. Lab 2):');
    if (!name) return;
    const a = await createAssignment({ courseId: course.id, name, type: 'lab', maxScore: 6, order: assignments.length + 1 }, password);
    setAssignments(as => [...as, a]);
    selectAssignment(a);
    setEditMode(true);
  }

  async function handleDelete() {
    if (!confirm(`Delete ${selected.name}? This cannot be undone.`)) return;
    await deleteAssignment(selected.id, password);
    const remaining = assignments.filter(a => a.id !== selected.id);
    setAssignments(remaining);
    if (remaining.length) selectAssignment(remaining[0]);
    else setSelected(null);
  }

  async function saveExample() {
    if (!exForm.studentName || !exForm.content) { alert('Name and content required.'); return; }
    const ex = await addExample(selected.id, { ...exForm, courseId: course.id }, password);
    setExamples(e => [...e, ex]);
    setExForm({ studentName: '', score: '4', quality: 'good', notes: '', content: '' });
    setShowAddEx(false);
  }

  async function removeExample(exId) {
    await deleteExample(selected.id, exId, password);
    setExamples(e => e.filter(x => x.id !== exId));
  }

  const scoreOptions = (selected?.maxScore || 6) <= 6 ? SCORES_6 : SCORES_10;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20, height: '100%' }}>
      {/* Assignment list */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 500 }}>Assignments</span>
          <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={handleAddAssignment}>+ Add</button>
        </div>
        {assignments.sort((a,b) => a.order-b.order).map(a => (
          <div key={a.id} onClick={() => selectAssignment(a)} className="card card-hover"
            style={{ marginBottom: 4, padding: '9px 12px', borderColor: selected?.id === a.id ? course.color : undefined }}>
            <div style={{ fontSize: 13, fontWeight: selected?.id === a.id ? 500 : 400 }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
              {a.type} · {a.maxScore}pts · {examples.filter(e => e.assignmentId === a.id).length || ''} ex
            </div>
          </div>
        ))}
      </div>

      {/* Assignment detail */}
      {selected ? (
        <div style={{ maxWidth: 680 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 600 }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{selected.type} · {selected.maxScore} pts</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {editMode
                ? <><button className="primary" onClick={saveAssignment} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
                    <button onClick={() => { setEditMode(false); setForm(selected); }}>Cancel</button></>
                : <><button onClick={() => setEditMode(true)}>Edit</button>
                    <button className="danger" onClick={handleDelete}>Delete</button></>}
            </div>
          </div>

          {editMode ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px', gap: 8, marginBottom: 12 }}>
                <div className="field">
                  <label>Name</label>
                  <input type="text" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Max pts</label>
                  <input type="text" value={form.maxScore || ''} onChange={e => setForm(f => ({ ...f, maxScore: e.target.value }))} />
                </div>
                <div className="field">
                  <label>Type</label>
                  <select value={form.type || 'lab'} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                    <option value="lab">Lab</option>
                    <option value="discussion">Discussion</option>
                    <option value="paper">Paper</option>
                    <option value="project">Project</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Description</label>
                <textarea rows={8} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
              </div>
              <div className="field">
                <label>Rubric</label>
                <textarea rows={12} value={form.rubric || ''} onChange={e => setForm(f => ({ ...f, rubric: e.target.value }))} style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
              </div>
            </>
          ) : (
            <>
              {selected.description && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="sec-label">Description</div>
                  <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selected.description}</pre>
                </div>
              )}
              {selected.rubric && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="sec-label">Rubric</div>
                  <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{selected.rubric}</pre>
                </div>
              )}
            </>
          )}

          {/* Calibration examples */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div style={{ fontWeight: 500 }}>Calibration Examples <span className="badge">{examples.length}</span></div>
            <button style={{ fontSize: 12 }} onClick={() => setShowAddEx(!showAddEx)}>
              {showAddEx ? 'Cancel' : '+ Add example'}
            </button>
          </div>

          {showAddEx && (
            <div className="card" style={{ marginBottom: 12, borderColor: course.color }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 110px', gap: 8, marginBottom: 8 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Student name</label>
                  <input type="text" value={exForm.studentName} onChange={e => setExForm(f => ({ ...f, studentName: e.target.value }))} placeholder="Last name" />
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Score</label>
                  <select value={exForm.score} onChange={e => setExForm(f => ({ ...f, score: e.target.value }))}>
                    {scoreOptions.map(v => <option key={v} value={v}>{v}/{selected.maxScore}</option>)}
                  </select>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Quality</label>
                  <select value={exForm.quality} onChange={e => setExForm(f => ({ ...f, quality: e.target.value }))}>
                    <option value="good">Good example</option>
                    <option value="weak">Weak example</option>
                  </select>
                </div>
              </div>
              <div className="field">
                <label>Notes (what makes this good or weak)</label>
                <input type="text" value={exForm.notes} onChange={e => setExForm(f => ({ ...f, notes: e.target.value }))} placeholder="e.g. Strong BLUF, legend present, good quantification" />
              </div>
              <div className="field">
                <label>Key student text</label>
                <textarea rows={5} value={exForm.content} onChange={e => setExForm(f => ({ ...f, content: e.target.value }))} placeholder="Paste the student's narrative, key passages, or observations" />
              </div>
              <button className="primary" onClick={saveExample}>Save example</button>
            </div>
          )}

          {examples.length === 0 && !showAddEx && (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text3)', fontSize: 12, border: '1px dashed var(--border2)', borderRadius: 8 }}>
              No examples yet. Add calibration examples to improve grading accuracy.
            </div>
          )}

          {['good','weak'].map(tier => {
            const tierEx = examples.filter(e => e.quality === tier || (!e.quality && tier === 'good'));
            if (!tierEx.length) return null;
            return (
              <div key={tier}>
                <div className="sec-label">{tier === 'good' ? 'Good examples' : 'Weak examples'} ({tierEx.length})</div>
                {tierEx.map(ex => <ExampleCard key={ex.id} ex={ex} maxScore={selected.maxScore} onRemove={() => removeExample(ex.id)} />)}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{ padding: '40px', color: 'var(--text3)', fontSize: 13 }}>Select an assignment or add one.</div>
      )}
    </div>
  );
}

function ExampleCard({ ex, maxScore, onRemove }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card card-hover" style={{ marginBottom: 5 }} onClick={() => setOpen(o => !o)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ fontWeight: 500 }}>{ex.studentName}</span>
          <span className={ex.quality === 'weak' ? 'pill-red' : 'pill-green'} style={{ fontSize: 11, padding: '1px 8px' }}>{ex.score}/{maxScore}</span>
        </div>
        <button className="danger" style={{ fontSize: 11, padding: '2px 8px' }} onClick={e => { e.stopPropagation(); onRemove(); }}>Remove</button>
      </div>
      {ex.notes && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>{ex.notes}</div>}
      {open && ex.content && (
        <pre style={{ marginTop: 8, padding: '8px', background: 'var(--bg3)', borderRadius: 5, fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{ex.content}</pre>
      )}
      {!open && ex.content && <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 3 }}>{ex.content.slice(0,100)}{ex.content.length>100?'…':''}</div>}
    </div>
  );
}
