import { useState, useEffect, useRef } from 'react';
import { getAssignments, createAssignment, updateAssignment, deleteAssignment, getExamples, addExample, deleteExample } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
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
  const [parsing, setParsing] = useState(false);
  const pdfRef = useRef();

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) { setSelected(a[0]); setForm(a[0]); }
    });
  }, [course.id]);

  useEffect(() => {
    if (selected) getExamples(selected.id, password).then(setExamples);
  }, [selected?.id]);

  function selectAssignment(a) {
    setSelected(a); setForm(a); setEditMode(false); setSaved(false);
  }

  async function saveAssignment() {
    setSaving(true);
    const updated = await updateAssignment(selected.id, form, password);
    setAssignments(as => as.map(a => a.id === updated.id ? updated : a));
    setSelected(updated);
    setSaving(false); setSaved(true);
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
    if (!confirm(`Delete ${selected.name}?`)) return;
    await deleteAssignment(selected.id, password);
    const remaining = assignments.filter(a => a.id !== selected.id);
    setAssignments(remaining);
    if (remaining.length) selectAssignment(remaining[0]);
    else setSelected(null);
  }

  async function handleParsePDF(file) {
    setParsing(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const r = await fetch(`${BASE}/api/assignments/parse-pdf`, {
        method: 'POST',
        headers: { 'x-admin-password': password },
        body: fd
      });
      const parsed = await r.json();
      if (parsed.error) { alert('Parse error: ' + parsed.error); return; }

      // If no assignment selected or selected is empty, create new one
      if (!selected || (!selected.description && !selected.rubric)) {
        const name = parsed.name || 'New Assignment';
        const a = await createAssignment({
          courseId: course.id, name, type: parsed.type || 'lab',
          maxScore: parsed.maxScore || 6, order: assignments.length + 1,
          description: parsed.description || '', rubric: parsed.rubric || ''
        }, password);
        setAssignments(as => [...as, a]);
        selectAssignment(a);
        setForm(a);
      } else {
        // Fill into current form
        const updated = {
          ...form,
          name: parsed.name || form.name,
          maxScore: parsed.maxScore || form.maxScore,
          description: parsed.description || form.description,
          rubric: parsed.rubric || form.rubric,
        };
        setForm(updated);
        setEditMode(true);
      }
    } catch (e) {
      alert('Error: ' + e.message);
    }
    setParsing(false);
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
    <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 20 }}>
      {/* Assignment list */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12, color: 'var(--text2)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Assignments</span>
          <button style={{ fontSize: 11, padding: '3px 8px' }} onClick={handleAddAssignment}>+ Add</button>
        </div>
        {assignments.sort((a,b) => a.order-b.order).map(a => (
          <div key={a.id} onClick={() => selectAssignment(a)} className="card card-hover"
            style={{ marginBottom: 5, padding: '9px 12px', borderColor: selected?.id === a.id ? course.color : undefined, borderWidth: selected?.id === a.id ? 2 : 1 }}>
            <div style={{ fontSize: 13, fontWeight: selected?.id === a.id ? 600 : 400 }}>{a.name}</div>
            <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>{a.type} · {a.maxScore}pts</div>
          </div>
        ))}
      </div>

      {/* Assignment detail */}
      {selected ? (
        <div style={{ maxWidth: 680 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
              <div style={{ fontSize: 12, color: 'var(--text2)' }}>{selected.type} · {selected.maxScore} pts max</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {/* PDF upload button */}
              <input ref={pdfRef} type="file" accept=".pdf" style={{ display: 'none' }}
                onChange={e => e.target.files[0] && handleParsePDF(e.target.files[0])} />
              <button onClick={() => pdfRef.current.click()} disabled={parsing}
                style={{ fontSize: 12 }} title="Upload assignment PDF to auto-fill fields">
                {parsing ? 'Reading PDF…' : '📄 Import from PDF'}
              </button>
              {editMode
                ? <><button className="primary" onClick={saveAssignment} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}</button>
                    <button onClick={() => { setEditMode(false); setForm(selected); }}>Cancel</button></>
                : <><button onClick={() => setEditMode(true)}>Edit</button>
                    <button className="danger" onClick={handleDelete}>Delete</button></>
              }
            </div>
          </div>

          {editMode ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 120px', gap: 8, marginBottom: 12 }}>
                <div className="field"><label>Name</label>
                  <input type="text" value={form.name||''} onChange={e => setForm(f=>({...f,name:e.target.value}))} /></div>
                <div className="field"><label>Max pts</label>
                  <input type="number" value={form.maxScore||''} onChange={e => setForm(f=>({...f,maxScore:e.target.value}))} /></div>
                <div className="field"><label>Type</label>
                  <select value={form.type||'lab'} onChange={e => setForm(f=>({...f,type:e.target.value}))}>
                    <option value="lab">Lab</option>
                    <option value="discussion">Discussion</option>
                    <option value="paper">Paper</option>
                    <option value="project">Project</option>
                    <option value="other">Other</option>
                  </select></div>
              </div>

              {/* Grading target */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div className="field" style={{ margin: 0 }}>
                  <label>Target avg: <strong>{form.targetAvg ?? 4.5}</strong> / {form.maxScore || 6} pts ({Math.round(((form.targetAvg??4.5)/(form.maxScore||6))*100)}%)</label>
                  <input type="range" min={0} max={parseFloat(form.maxScore||6)} step={0.5}
                    value={form.targetAvg ?? 4.5}
                    onChange={e => setForm(f => ({...f, targetAvg: parseFloat(e.target.value)}))} />
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text3)' }}>
                    <span>Easy</span><span>Standard</span><span>Strict</span>
                  </div>
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label>Strictness</label>
                  <div style={{ display:'flex', gap:6 }}>
                    {[['lenient','Lenient'],['standard','Standard'],['strict','Strict']].map(([val,label]) => (
                      <button key={val}
                        onClick={() => setForm(f => ({...f, gradingStrictness: val}))}
                        style={{ flex:1, fontSize:11, padding:'5px 4px', fontWeight:600,
                          background: (form.gradingStrictness||'standard')===val ? 'var(--accent)' : 'var(--bg)',
                          color: (form.gradingStrictness||'standard')===val ? '#fff' : 'var(--text2)',
                          border: `1px solid ${(form.gradingStrictness||'standard')===val ? 'var(--accent)' : 'var(--border2)'}` }}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div className="field"><label>Description</label>
                <textarea rows={8} value={form.description||''} onChange={e => setForm(f=>({...f,description:e.target.value}))} style={{ fontFamily:'var(--mono)',fontSize:12 }} /></div>
              <div className="field"><label>Rubric</label>
                <textarea rows={12} value={form.rubric||''} onChange={e => setForm(f=>({...f,rubric:e.target.value}))} style={{ fontFamily:'var(--mono)',fontSize:12 }} /></div>
              <div className="field">
                <label>Grading guidance <span style={{ fontWeight:400, color:'var(--text3)', fontSize:11 }}>— instructor overrides injected into every grade for this assignment</span></label>
                <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:8 }}>
                  {[
                    "Don't penalize for bullet point format — narrative structure is covered later",
                    "Don't deduct for missing north arrow — not yet taught",
                    "Don't deduct for missing legend — not yet covered",
                    "Be lenient on source citations — first intelligence product",
                    "Don't penalize colorblind accessibility issues — not yet taught",
                  ].map(t => (
                    <button key={t} style={{ fontSize:11, padding:'3px 8px', borderRadius:4,
                      background: (form.gradingGuidance||'').includes(t) ? 'rgba(37,99,235,0.1)' : 'var(--bg2)',
                      color: (form.gradingGuidance||'').includes(t) ? 'var(--accent)' : 'var(--text3)',
                      border: `1px solid ${(form.gradingGuidance||'').includes(t) ? 'var(--accent)' : 'var(--border)'}` }}
                      onClick={() => {
                        const cur = form.gradingGuidance || '';
                        if (cur.includes(t)) {
                          setForm(f => ({...f, gradingGuidance: cur.replace('\n- ' + t, '').replace('- ' + t, '').trim()}));
                        } else {
                          setForm(f => ({...f, gradingGuidance: cur ? cur + '\n- ' + t : '- ' + t}));
                        }
                      }}>
                      {(form.gradingGuidance||'').includes(t) ? '✓ ' : '+ '}{t}
                    </button>
                  ))}
                </div>
                <textarea rows={4} value={form.gradingGuidance||''} onChange={e => setForm(f=>({...f,gradingGuidance:e.target.value}))}
                  placeholder="Add any specific guidance for Claude when grading this assignment. These override default rubric behavior."
                  style={{ fontSize:12, lineHeight:1.6 }} />
              </div>
            </>
          ) : (
            <>
              {selected.description && (
                <div className="card" style={{ marginBottom: 12 }}>
                  <div className="sec-label">Description</div>
                  <pre style={{ fontFamily:'var(--mono)',fontSize:11,color:'var(--text2)',whiteSpace:'pre-wrap',lineHeight:1.6 }}>{selected.description}</pre>
                </div>
              )}
              {!selected.description && !selected.rubric && (
                <div style={{ padding:32,textAlign:'center',color:'var(--text3)',fontSize:13,border:'1.5px dashed var(--border2)',borderRadius:10 }}>
                  <div style={{ fontSize:24,marginBottom:10 }}>📄</div>
                  No content yet. Click <strong>Edit</strong> to type it in, or click <strong>Import from PDF</strong> to upload the assignment instructions and auto-fill everything.
                </div>
              )}
              {selected.rubric && (
                <div className="card" style={{ marginBottom: 16 }}>
                  <div className="sec-label">Rubric</div>
                  <pre style={{ fontFamily:'var(--mono)',fontSize:11,color:'var(--text2)',whiteSpace:'pre-wrap',lineHeight:1.6 }}>{selected.rubric}</pre>
                </div>
              )}
            </>
          )}

          {/* Calibration examples */}
          <div style={{ display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10 }}>
            <div style={{ fontWeight:600 }}>Calibration Examples <span className="badge">{examples.length}</span></div>
            <button style={{ fontSize:12 }} onClick={() => setShowAddEx(!showAddEx)}>{showAddEx?'Cancel':'+ Add example'}</button>
          </div>

          {showAddEx && (
            <div className="card" style={{ marginBottom:12,borderColor:course.color,borderWidth:2 }}>
              <div style={{ display:'grid',gridTemplateColumns:'1fr 100px 110px',gap:8,marginBottom:8 }}>
                <div className="field" style={{margin:0}}><label>Student name</label>
                  <input type="text" value={exForm.studentName} onChange={e=>setExForm(f=>({...f,studentName:e.target.value}))} placeholder="Last name" /></div>
                <div className="field" style={{margin:0}}><label>Score</label>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      type="number"
                      value={exForm.score}
                      min="0"
                      max={selected.maxScore}
                      step="0.1"
                      onChange={e => setExForm(f => ({...f, score: e.target.value}))}
                      style={{ width: 70, fontSize: 15, fontWeight: 700, fontFamily: 'var(--mono)', textAlign: 'center', padding: '4px 6px' }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text3)' }}>/ {selected.maxScore}</span>
                  </div>
                </div>
                <div className="field" style={{margin:0}}><label>Quality</label>
                  <select value={exForm.quality} onChange={e=>setExForm(f=>({...f,quality:e.target.value}))}>
                    <option value="good">Good example</option>
                    <option value="weak">Weak example</option>
                  </select></div>
              </div>
              <div className="field"><label>Notes</label>
                <input type="text" value={exForm.notes} onChange={e=>setExForm(f=>({...f,notes:e.target.value}))} placeholder="What makes this good or weak" /></div>
              <div className="field"><label>Key student text</label>
                <textarea rows={5} value={exForm.content} onChange={e=>setExForm(f=>({...f,content:e.target.value}))} placeholder="Paste student narrative or key passages" /></div>
              <button className="primary" onClick={saveExample}>Save example</button>
            </div>
          )}

          {examples.length===0&&!showAddEx&&(
            <div style={{padding:'20px',textAlign:'center',color:'var(--text3)',fontSize:12,border:'1px dashed var(--border2)',borderRadius:8}}>
              No examples yet. Add calibration examples to improve grading accuracy.
            </div>
          )}

          {['good','weak'].map(tier => {
            const tierEx = examples.filter(e=>e.quality===tier||(e.quality===undefined&&tier==='good'));
            if(!tierEx.length) return null;
            return (
              <div key={tier}>
                <div className="sec-label">{tier==='good'?'Good examples':'Weak examples'} ({tierEx.length})</div>
                {tierEx.map(ex=><ExampleCard key={ex.id} ex={ex} maxScore={selected.maxScore} onRemove={()=>removeExample(ex.id)} />)}
              </div>
            );
          })}
        </div>
      ) : (
        <div style={{padding:'40px',color:'var(--text3)',fontSize:13}}>Select an assignment or add one.</div>
      )}
    </div>
  );
}

function ExampleCard({ ex, maxScore, onRemove }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card card-hover" style={{marginBottom:5}} onClick={()=>setOpen(o=>!o)}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
        <div style={{display:'flex',gap:8,alignItems:'center'}}>
          <span style={{fontWeight:500}}>{ex.student_name||ex.studentName}</span>
          <span className={ex.quality==='weak'?'pill-red':'pill-green'} style={{fontSize:11,padding:'1px 8px'}}>{ex.score}/{maxScore}</span>
        </div>
        <button className="danger" style={{fontSize:11,padding:'2px 8px'}} onClick={e=>{e.stopPropagation();onRemove();}}>Remove</button>
      </div>
      {ex.notes&&<div style={{fontSize:12,color:'var(--text2)',marginTop:4}}>{ex.notes}</div>}
      {open&&ex.content&&<pre style={{marginTop:8,padding:'8px',background:'var(--bg3)',borderRadius:5,fontSize:11,fontFamily:'var(--mono)',color:'var(--text2)',whiteSpace:'pre-wrap',lineHeight:1.5}}>{ex.content}</pre>}
      {!open&&ex.content&&<div style={{fontSize:11,color:'var(--text3)',marginTop:3}}>{ex.content.slice(0,100)}{ex.content.length>100?'…':''}</div>}
    </div>
  );
}
