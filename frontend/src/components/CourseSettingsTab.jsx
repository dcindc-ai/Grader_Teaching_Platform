import { useState, useEffect } from 'react';
import { updateCourse, deleteCourse, getCourseDeleteBlockers, cloneCourse } from '../api.js';

// "13 assignments, 151 examples"
function describeCounts(counts) {
  return Object.entries(counts || {})
    .map(([table, n]) => `${n} ${table.replace(/_/g, ' ')}`)
    .join(', ');
}

const DIMS = [
  { key: 'clarity', label: 'Clarity', lo: 'Accept buried BLUF', hi: 'BLUF must be sentence 1' },
  { key: 'logic', label: 'Logic', lo: 'Allow unsupported claims', hi: 'Every claim needs evidence' },
  { key: 'structure', label: 'Structure', lo: 'Allow missing elements', hi: 'All elements required' },
  { key: 'tone', label: 'Tone', lo: 'Allow minor informality', hi: 'Zero tolerance for first-person' },
  { key: 'style', label: 'Style', lo: 'Overlook unexplained color', hi: 'All colors must be in legend' }
];

const COLORS = ['#E21833','#CFB53B','#4f8ef7','#4caf72','#e07830','#9b59b6','#e05252','#16a085'];

export default function CourseSettingsTab({ course, password, onUpdate, onDelete, onCloned }) {
  const [form, setForm] = useState({ ...course });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [blockers, setBlockers] = useState(null);
  const [deleteError, setDeleteError] = useState('');
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneName, setCloneName] = useState(course.name || '');
  const [cloneTerm, setCloneTerm] = useState('');
  const [cloning, setCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState(null);

  function upd(k, v) { setForm(f => ({ ...f, [k]: v })); }
  function updSlider(k, v) { setForm(f => ({ ...f, sliders: { ...f.sliders, [k]: parseInt(v) } })); }

  async function save() {
    setSaving(true);
    const updated = await updateCourse(course.id, form, password);
    onUpdate(updated);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  // What, if anything, stops this course being deleted. Refreshed per course.
  useEffect(() => {
    let live = true;
    setBlockers(null);
    getCourseDeleteBlockers(course.id, password)
      .then(b => { if (live) setBlockers(b); })
      .catch(() => { if (live) setBlockers({ counts: {}, deletable: false }); });
    return () => { live = false; };
  }, [course.id, password]);

  async function handleDelete() {
    // Only an empty course can be deleted, so there is nothing to warn about
    // losing — the confirm just guards against a misclick.
    if (!confirm(`Delete ${course.name}? It is empty, so nothing else is removed.`)) return;
    setDeleteError('');
    try {
      await deleteCourse(course.id, password);
      onDelete();
    } catch (e) {
      setDeleteError(e.blocked
        ? `Cannot delete: this course still has ${describeCounts(e.counts)}.`
        : e.message);
      getCourseDeleteBlockers(course.id, password).then(setBlockers).catch(() => {});
    }
  }

  async function handleClone() {
    if (!cloneName.trim()) return;
    setCloning(true);
    setCloneResult(null);
    try {
      const { course: created, counts } = await cloneCourse(
        course.id, { name: cloneName.trim(), term: cloneTerm.trim() }, password);
      setCloneResult({ ok: true, counts, name: created.name });
      onCloned?.(created);
    } catch (e) {
      setCloneResult({ ok: false, message: e.message });
    }
    setCloning(false);
  }

  const avg = form.sliders ? (Object.values(form.sliders).reduce((a,b)=>a+b,0)/5).toFixed(1) : '3.0';

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between' }}>
        <div>
          <div className="page-title">Course Settings</div>
          <div className="page-sub">Configure {course.name}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}</button>
          <button onClick={() => setCloneOpen(o => !o)}>Clone course</button>
          <button
            className="danger"
            onClick={handleDelete}
            disabled={!blockers || !blockers.deletable}
            title={
              !blockers ? 'Checking…'
                : blockers.deletable ? 'This course is empty and can be deleted'
                : `Cannot delete: still has ${describeCounts(blockers.counts)}`
            }>
            Delete course
          </button>
        </div>
      </div>

      {blockers && !blockers.deletable && (
        <div className="card" style={{ marginBottom: 14, fontSize: 12, color: 'var(--text3)' }}>
          This course cannot be deleted: it still has {describeCounts(blockers.counts)}.
          Only an empty course can be removed, so nothing with student work in it is ever deleted.
        </div>
      )}
      {deleteError && (
        <div className="card" style={{ marginBottom: 14, fontSize: 12 }}>{deleteError}</div>
      )}

      {cloneOpen && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 500, marginBottom: 6 }}>Clone this course into a new term</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginBottom: 10 }}>
            Copies every assignment with its rubric, guidance, target average, strictness and score cap,
            plus the calibration examples and active materials. No students, no grades.
            Canvas assignment IDs are left blank for you to fill in.
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ margin: 0 }}>
              <label>New course name</label>
              <input value={cloneName} onChange={e => setCloneName(e.target.value)} placeholder="AIN 714" />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label>Term</label>
              <input value={cloneTerm} onChange={e => setCloneTerm(e.target.value)} placeholder="Fall 2 2026" />
            </div>
            <button className="primary" onClick={handleClone} disabled={cloning || !cloneName.trim()}>
              {cloning ? 'Cloning…' : 'Create clone'}
            </button>
          </div>
          {cloneResult && (
            <div style={{ marginTop: 10, fontSize: 12 }}>
              {cloneResult.ok
                ? `Created ${cloneResult.name}: ${cloneResult.counts.assignments} assignments, ${cloneResult.counts.examples} calibration examples, ${cloneResult.counts.materials} materials. It is in the sidebar now — add the new Canvas assignment IDs before grading.`
                : `Clone failed: ${cloneResult.message}`}
            </div>
          )}
        </div>
      )}

      {/* Basic info */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 12 }}>Basic Information</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field"><label>Short name</label><input type="text" value={form.name||''} onChange={e=>upd('name',e.target.value)} placeholder="e.g. GEOG 661" /></div>
          <div className="field"><label>Full name</label><input type="text" value={form.fullName||''} onChange={e=>upd('fullName',e.target.value)} placeholder="e.g. Fundamentals of Geospatial Intelligence" /></div>
          <div className="field"><label>Institution</label><input type="text" value={form.institution||''} onChange={e=>upd('institution',e.target.value)} placeholder="University name" /></div>
          <div className="field"><label>Term</label><input type="text" value={form.term||''} onChange={e=>upd('term',e.target.value)} placeholder="e.g. Spring 2026" /></div>
        </div>
        <div className="field">
          <label>Course color</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {COLORS.map(c => (
              <div key={c} onClick={() => upd('color', c)} style={{
                width: 28, height: 28, borderRadius: 6, background: c, cursor: 'pointer',
                border: form.color === c ? '3px solid white' : '2px solid transparent',
                boxShadow: form.color === c ? `0 0 0 2px ${c}` : 'none'
              }} />
            ))}
            <input type="text" value={form.color||''} onChange={e=>upd('color',e.target.value)} placeholder="#hex" style={{ width: 80 }} />
          </div>
        </div>
      </div>

      {/* Grading model */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 500, marginBottom: 6 }}>Discussion Grading Model</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          Controls how discussions are graded. Set once per course — applies to all discussions.
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {[
            { value: 'rubric', label: 'Rubric-based', desc: 'Each criterion scored separately. Total adds up to a grade. Use for WFU AIN 714.' },
            { value: 'completion', label: 'Completion / pass-fail', desc: 'Students get full points for participating. No rubric. Use for UMD GEOG 661.' }
          ].map(opt => (
            <div key={opt.value}
              onClick={() => upd('gradingModel', opt.value)}
              style={{
                flex: 1, padding: '12px 14px', borderRadius: 8, cursor: 'pointer',
                border: `2px solid ${form.gradingModel === opt.value ? course.color : 'var(--border)'}`,
                background: form.gradingModel === opt.value ? `${course.color}10` : 'var(--bg)'
              }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4,
                color: form.gradingModel === opt.value ? course.color : 'var(--text)' }}>
                {form.gradingModel === opt.value ? '● ' : '○ '}{opt.label}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text2)', lineHeight: 1.5 }}>{opt.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Universal do-not-penalize */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Universal Do-Not-Penalize</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          Applies to <strong>every</strong> assignment in this course, on top of any per-assignment exceptions.
          List things the grader and feedback writer must never treat as a weakness, gap, or missing element.
          One per line works well.
        </div>
        <div className="field" style={{ marginBottom: 0 }}>
          <textarea rows={4} value={form.doNotPenalize||''} onChange={e=>upd('doNotPenalize',e.target.value)}
            placeholder={'e.g. Do not penalize at all for code block references or how a prompt is formatted.\nDo not penalize for presenting a prompt as an image or screenshot.'}
            style={{ fontSize: 12, lineHeight: 1.6 }} />
        </div>
      </div>

      {/* Voice & Response Style */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>Voice and Response Style</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 12 }}>
          These defaults apply to every response and feedback paragraph generated for this course. You can override them per session.
        </div>

        <div className="field">
          <label>Instructor bio (sets your voice in all responses)</label>
          <textarea rows={4} value={form.instructorBio||''} onChange={e=>upd('instructorBio',e.target.value)}
            placeholder="e.g. Former intelligence officer, now teaching AI strategy. Direct, no-nonsense, high standards. I push students to be specific and cite their sources properly."
            style={{ fontSize: 12, lineHeight: 1.6 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label>Default tone</label>
            <select value={form.responseDefaults?.tone || 'warm'}
              onChange={e => upd('responseDefaults', { ...form.responseDefaults, tone: e.target.value })}
              style={{ fontSize: 13 }}>
              <option value="warm">Warm mentor</option>
              <option value="direct">Plain and direct</option>
              <option value="formal">Formal academic</option>
              <option value="encouraging">Encouraging</option>
              <option value="socratic">Socratic</option>
              <option value="dave">Dave Cook Voice</option>
              <option value="dave-plain">Dave + Direct</option>
              <option value="dave-warm">Dave + Warm</option>
            </select>
          </div>
          <div>
            <label>Default structure</label>
            <select value={form.responseDefaults?.structure || 'organized'}
              onChange={e => upd('responseDefaults', { ...form.responseDefaults, structure: e.target.value })}
              style={{ fontSize: 13 }}>
              <option value="organized">Strengths → gaps → forward</option>
              <option value="flowing">Weave together</option>
              <option value="critical">Gaps first → strengths</option>
              <option value="question">End with a question</option>
            </select>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
          <div>
            <label>Default sentences per response: <strong>{form.responseDefaults?.sentences || 5}</strong></label>
            <input type="range" min={2} max={10}
              value={form.responseDefaults?.sentences || 5}
              onChange={e => upd('responseDefaults', { ...form.responseDefaults, sentences: Number(e.target.value) })} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
              <span>2 (brief)</span><span>5</span><span>10 (detailed)</span>
            </div>
          </div>
          <div>
            <label>Max words per sentence: <strong>{form.responseDefaults?.wordsPerSentence || 18}</strong></label>
            <input type="range" min={10} max={25}
              value={form.responseDefaults?.wordsPerSentence || 18}
              onChange={e => upd('responseDefaults', { ...form.responseDefaults, wordsPerSentence: Number(e.target.value) })} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)' }}>
              <span>10</span><span>18</span><span>25</span>
            </div>
          </div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>Voice rules (specific things to always / never do)</label>
          <textarea rows={3} value={form.responseDefaults?.voiceRules || ''}
            onChange={e => upd('responseDefaults', { ...form.responseDefaults, voiceRules: e.target.value })}
            placeholder="e.g. Always use first name only. Never use 'great job'. Always cite specific lines from the student's post. Never use passive voice."
            style={{ fontSize: 12, lineHeight: 1.6 }} />
        </div>
      </div>

      {/* Legacy voice guidelines */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="field">
          <label>Voice guidelines (legacy)</label>
          <textarea rows={3} value={form.voiceGuidelines||''} onChange={e=>upd('voiceGuidelines',e.target.value)} placeholder="e.g. Casual, direct, warm. Not stiff or academic. Sharp mentor tone." style={{ fontSize: 12 }} />
        </div>
        <div className="field">
          <label>Default discussion question</label>
          <textarea rows={5} value={form.discussionDefaultQuestion||''} onChange={e=>upd('discussionDefaultQuestion',e.target.value)} placeholder="Default opening question for the course" style={{ fontSize: 12 }} />
        </div>
      </div>

      {/* Canvas Integration */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="sec-label" style={{ marginBottom: 10 }}>Canvas Integration</div>
        <div className="field">
          <label>Canvas course URL <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 11 }}>— e.g. https://wakeforest.instructure.com/courses/81230</span></label>
          <input type="text" value={form.canvasUrl||''} onChange={e=>upd('canvasUrl',e.target.value)}
            placeholder="https://yourschool.instructure.com/courses/12345"
            style={{ fontSize: 12 }} />
        </div>
        <div className="field">
          <label>Canvas access token <span style={{ fontWeight: 400, color: 'var(--text3)', fontSize: 11 }}>— Canvas → Account → Settings → New Access Token</span></label>
          <input type="password" value={form.canvasToken||''} onChange={e=>upd('canvasToken',e.target.value)}
            placeholder="Paste your Canvas token here"
            style={{ fontSize: 12 }} />
        </div>
      </div>
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ fontWeight: 500 }}>Grading Strictness</div>
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>avg {avg}/5</span>
        </div>
        {DIMS.map(d => (
          <div key={d.key} style={{ marginBottom: 18 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <span style={{ fontWeight: 500 }}>{d.label}</span>
              <span style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{form.sliders?.[d.key] || 3}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 11, color: 'var(--text3)', width: 140 }}>{d.lo}</span>
              <input type="range" min="1" max="5" step="1" value={form.sliders?.[d.key] || 3} onChange={e => updSlider(d.key, e.target.value)} style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text3)', width: 140, textAlign: 'right' }}>{d.hi}</span>
            </div>
          </div>
        ))}
        <div style={{ padding: '10px 12px', background: 'var(--bg3)', borderRadius: 6, fontSize: 12, color: 'var(--text2)' }}>
          {parseFloat(avg) <= 2 ? 'Lenient — rewarding effort, flagging critical errors only.' :
           parseFloat(avg) >= 4 ? 'Strict — professional analyst standards.' :
           'Moderate — rubric-based with learning-curve allowance.'}
        </div>
      </div>
    </div>
  );
}
