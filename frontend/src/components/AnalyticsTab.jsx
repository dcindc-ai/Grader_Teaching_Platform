import { useState, useEffect } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';
function h(pw) { return { 'x-admin-password': pw }; }

export default function AnalyticsTab({ course, password }) {
  const [activeView, setActiveView] = useState('distribution');
  const [assignments, setAssignments] = useState([]);
  const [selectedAssignment, setSelectedAssignment] = useState('');

  useEffect(() => {
    fetch(`${BASE}/api/assignments?courseId=${course.id}`, { headers: h(password) })
      .then(r => r.json()).then(a => { setAssignments(a); });
  }, [course.id]);

  const views = [
    { key: 'distribution', label: 'Score Distribution' },
    { key: 'trajectory', label: 'Student Trajectory' },
    { key: 'drift', label: 'Calibration Drift' },
    { key: 'patterns', label: 'Keyword Patterns' },
    { key: 'effectiveness', label: 'Always-On Impact' },
  ];

  return (
    <div>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Analytics</div>
          <div className="page-sub">Data science insights from your grading history</div>
        </div>
        <select value={selectedAssignment} onChange={e => setSelectedAssignment(e.target.value)}
          style={{ fontSize: 13 }}>
          <option value="">All assignments</option>
          {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
      </div>

      {/* Sub-nav */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 20, flexWrap: 'wrap' }}>
        {views.map(v => (
          <button key={v.key} onClick={() => setActiveView(v.key)} style={{
            padding: '7px 14px', fontSize: 12, borderRadius: 6,
            background: activeView === v.key ? course.color : 'var(--bg)',
            color: activeView === v.key ? '#fff' : 'var(--text2)',
            border: `1px solid ${activeView === v.key ? course.color : 'var(--border2)'}`,
            fontWeight: activeView === v.key ? 600 : 400
          }}>{v.label}</button>
        ))}
      </div>

      {activeView === 'distribution' && <DistributionView course={course} password={password} assignmentId={selectedAssignment} />}
      {activeView === 'trajectory' && <TrajectoryView course={course} password={password} />}
      {activeView === 'drift' && <DriftView course={course} password={password} assignmentId={selectedAssignment} />}
      {activeView === 'patterns' && <PatternsView course={course} password={password} assignmentId={selectedAssignment} />}
      {activeView === 'effectiveness' && <EffectivenessView course={course} password={password} />}
    </div>
  );
}

// ── 1. Score Distribution ────────────────────────────────────────────────

function DistributionView({ course, password, assignmentId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ courseId: course.id });
    if (assignmentId) q.set('assignmentId', assignmentId);
    fetch(`${BASE}/api/analytics/criterion-distribution?${q}`, { headers: h(password) })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, [course.id, assignmentId]);

  if (loading) return <Loading />;
  if (!data?.criteria?.length) return <Empty message="No grades yet. Grade some submissions to see distribution." />;

  const maxBar = 200;

  return (
    <div>
      <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
        Based on {data.totalGrades} graded submission{data.totalGrades !== 1 ? 's' : ''}.
      </div>

      {/* Assignment totals */}
      {data.assignments?.length > 1 && (
        <div className="card" style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, marginBottom: 12 }}>Average Score by Assignment</div>
          {data.assignments.map(a => {
            const pct = a.maxScore ? a.avg / a.maxScore : 0;
            const color = pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
            return (
              <div key={a.name} style={{ marginBottom: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{a.name}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 700, color }}>
                    {a.avg.toFixed(2)}/{a.maxScore} ({Math.round(pct*100)}%)
                  </span>
                </div>
                <div style={{ height: 8, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct*100}%`, background: color, borderRadius: 4, transition: 'width 0.5s' }} />
                </div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>{a.count} students</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Per-criterion breakdown */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 14 }}>Performance by Rubric Criterion</div>
        <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
          Red = class is struggling here. Use this to decide what to address in the next session.
        </div>
        {data.criteria.map(c => {
          const pct = c.avg / (c.max || 1);
          const barColor = pct >= 0.85 ? 'var(--green)' : pct >= 0.7 ? 'var(--amber)' : 'var(--red)';
          return (
            <div key={c.key} style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{c.label}</span>
                <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text2)' }}>
                  <span>avg <strong style={{ color: barColor }}>{c.avg.toFixed(2)}</strong></span>
                  <span>low {c.min.toFixed(1)}</span>
                  <span>high {c.max.toFixed(1)}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 40 }}>
                {c.distribution.map((bucket, i) => {
                  const h = bucket.count ? Math.max(4, bucket.count / Math.max(...c.distribution.map(b => b.count)) * 36) : 0;
                  return (
                    <div key={i} title={`${bucket.range}: ${bucket.count} students`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                      <div style={{ width: '100%', height: h, background: i >= 8 ? 'var(--green)' : i >= 6 ? 'var(--accent)' : i >= 4 ? 'var(--amber)' : 'var(--red)', borderRadius: '2px 2px 0 0', transition: 'height 0.3s' }} />
                      {bucket.count > 0 && <span style={{ fontSize: 9, color: 'var(--text3)' }}>{bucket.count}</span>}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text3)', marginTop: 2 }}>
                <span>Low</span><span>High</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── 2. Student Trajectory ────────────────────────────────────────────────

function TrajectoryView({ course, password }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    fetch(`${BASE}/api/analytics/trajectory?courseId=${course.id}`, { headers: h(password) })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, [course.id]);

  if (loading) return <Loading />;
  if (!data?.students?.length) return <Empty message="No student grade history yet." />;

  const filtered = data.students.filter(s => {
    if (filter === 'declining') return s.status === 'declining';
    if (filter === 'improving') return s.status === 'improving';
    return true;
  });

  const declining = data.students.filter(s => s.status === 'declining');
  const improving = data.students.filter(s => s.status === 'improving');

  return (
    <div>
      {/* Alert for declining students */}
      {declining.length > 0 && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, color: 'var(--red)', marginBottom: 4 }}>
            ⚠ {declining.length} student{declining.length !== 1 ? 's' : ''} showing declining performance
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            {declining.map(s => s.name).join(', ')}
          </div>
        </div>
      )}

      {improving.length > 0 && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'rgba(22,163,74,0.06)', border: '1px solid rgba(22,163,74,0.2)', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, color: 'var(--green)', marginBottom: 4 }}>
            ↑ {improving.length} student{improving.length !== 1 ? 's' : ''} improving
          </div>
          <div style={{ fontSize: 13, color: 'var(--text2)' }}>
            {improving.map(s => s.name).join(', ')}
          </div>
        </div>
      )}

      {/* Filter */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[['all','All students'],['declining','Declining'],['improving','Improving']].map(([k,l]) => (
          <button key={k} onClick={() => setFilter(k)} style={{
            fontSize: 12, padding: '5px 12px',
            background: filter === k ? 'var(--bg3)' : 'var(--bg)',
            border: `1px solid ${filter === k ? 'var(--border2)' : 'var(--border)'}`,
            fontWeight: filter === k ? 600 : 400
          }}>{l}</button>
        ))}
      </div>

      {filtered.map(s => (
        <div key={s.name} className="card" style={{ marginBottom: 8, padding: '12px 14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{s.name}</span>
              <span style={{ marginLeft: 10, fontSize: 11, padding: '2px 8px', borderRadius: 10,
                background: s.status === 'declining' ? 'rgba(220,38,38,0.1)' : s.status === 'improving' ? 'rgba(22,163,74,0.1)' : 'var(--bg3)',
                color: s.status === 'declining' ? 'var(--red)' : s.status === 'improving' ? 'var(--green)' : 'var(--text3)',
                border: `1px solid ${s.status === 'declining' ? 'rgba(220,38,38,0.2)' : s.status === 'improving' ? 'rgba(22,163,74,0.2)' : 'var(--border)'}` }}>
                {s.status === 'declining' ? `↓ ${Math.abs(s.trend)}% drop` : s.status === 'improving' ? `↑ ${s.trend}% gain` : 'stable'}
              </span>
            </div>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 16,
              color: s.avg >= 85 ? 'var(--green)' : s.avg >= 70 ? 'var(--amber)' : 'var(--red)' }}>
              {s.avg.toFixed(0)}% avg
            </span>
          </div>
          {/* Mini sparkline */}
          <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 32 }}>
            {s.grades.map((g, i) => {
              const barH = Math.max(4, g.pct / 100 * 28);
              const color = g.pct >= 85 ? 'var(--green)' : g.pct >= 70 ? 'var(--amber)' : 'var(--red)';
              return (
                <div key={i} title={`${g.assignment}: ${g.pct}%`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <div style={{ width: '100%', height: barH, background: color, borderRadius: '2px 2px 0 0' }} />
                  <span style={{ fontSize: 9, color: 'var(--text3)', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: 40, textOverflow: 'ellipsis' }}>
                    {g.assignment.split(' ').pop()}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── 3. Calibration Drift ─────────────────────────────────────────────────

function DriftView({ course, password, assignmentId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const q = new URLSearchParams({ courseId: course.id });
    if (assignmentId) q.set('assignmentId', assignmentId);
    fetch(`${BASE}/api/analytics/calibration-drift?${q}`, { headers: h(password) })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, [course.id, assignmentId]);

  if (loading) return <Loading />;
  if (data?.message) return <Empty message={data.message} />;

  const driftColor = Math.abs(parseFloat(data.drift)) < 0.3 ? 'var(--green)' :
                     parseFloat(data.drift) > 0 ? 'var(--amber)' : 'var(--red)';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        {[
          ['Total examples', data.totalExamples],
          ['Early avg', data.earlyAvg],
          ['Middle avg', data.middleAvg],
          ['Late avg', data.lateAvg]
        ].map(([l, v]) => (
          <div key={l} style={{ padding: '12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{l}</div>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 20 }}>{v}</div>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700, color: driftColor }}>
            {parseFloat(data.drift) > 0 ? '+' : ''}{data.drift}
          </span>
          <div>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Score drift over time</div>
            <div style={{ fontSize: 13, color: 'var(--text2)' }}>{data.driftDirection}</div>
          </div>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text3)', padding: '8px 10px', background: 'var(--bg2)', borderRadius: 6 }}>
          Comparing your first {Math.floor(data.totalExamples/3)} examples to your most recent {Math.floor(data.totalExamples/3)}.
          A drift of more than ±0.3 points suggests your grading standards may be shifting.
        </div>
      </div>

      {/* Score distribution buckets */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Score Distribution in Calibration Bank</div>
        {data.buckets.map(b => (
          <div key={b.score} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, width: 32, fontSize: 13 }}>{b.score}</span>
            <div style={{ flex: 1, height: 20, background: 'var(--bg3)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${b.count / Math.max(...data.buckets.map(x => x.count)) * 100}%`,
                background: 'var(--accent)', borderRadius: 4, transition: 'width 0.4s' }} />
            </div>
            <span style={{ fontSize: 12, color: 'var(--text2)', width: 60 }}>{b.count} example{b.count !== 1 ? 's' : ''}</span>
          </div>
        ))}
      </div>

      {/* Timeline */}
      <div className="card">
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Scoring Timeline</div>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 60 }}>
          {data.timeline.map((t, i) => {
            const max = Math.max(...data.timeline.map(x => x.score));
            const h = Math.max(4, t.score / max * 56);
            const color = t.score >= max * 0.85 ? 'var(--green)' : t.score >= max * 0.7 ? 'var(--accent)' : 'var(--amber)';
            return (
              <div key={i} title={`${t.student}: ${t.score}`} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ width: '100%', height: h, background: color, borderRadius: '2px 2px 0 0' }} />
              </div>
            );
          })}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--text3)', marginTop: 4 }}>
          <span>First labeled</span><span>Most recent</span>
        </div>
      </div>
    </div>
  );
}

// ── 4. Keyword Patterns ──────────────────────────────────────────────────

function PatternsView({ course, password, assignmentId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  function analyze() {
    setLoading(true);
    const q = new URLSearchParams({ courseId: course.id });
    if (assignmentId) q.set('assignmentId', assignmentId);
    fetch(`${BASE}/api/analytics/keyword-patterns?${q}`, { headers: h(password) })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }

  if (!data && !loading) return (
    <div style={{ textAlign: 'center', padding: '40px 0' }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>🔍</div>
      <div style={{ fontSize: 14, color: 'var(--text2)', marginBottom: 16 }}>
        Analyzes your calibration examples to find concrete patterns<br />
        that distinguish strong from weak submissions.
      </div>
      <button className="primary" style={{ padding: '10px 24px', fontSize: 14 }} onClick={analyze}>
        Analyze patterns
      </button>
    </div>
  );

  if (loading) return <Loading message="Analyzing calibration examples with Claude…" />;
  if (data?.message) return <Empty message={data.message} action={{ label: 'Try again', fn: analyze }} />;

  return (
    <div>
      {data.topInsight && (
        <div style={{ padding: '14px 16px', marginBottom: 16, background: 'rgba(37,99,235,0.06)', border: '2px solid rgba(37,99,235,0.2)', borderRadius: 10, fontSize: 15, fontWeight: 500, color: 'var(--text)' }}>
          💡 {data.topInsight}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--green)', marginBottom: 10 }}>
            ✓ What strong submissions do ({data.strongCount} examples)
          </div>
          {(data.strongPatterns || []).map((p, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, borderLeft: '3px solid var(--green)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.pattern}</div>
              {p.example && <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 6 }}>e.g. "{p.example}"</div>}
              {p.teachingNote && <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 8px', background: 'var(--bg2)', borderRadius: 4 }}>→ {p.teachingNote}</div>}
            </div>
          ))}
        </div>

        <div>
          <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--red)', marginBottom: 10 }}>
            ✗ What weak submissions do ({data.weakCount} examples)
          </div>
          {(data.weakPatterns || []).map((p, i) => (
            <div key={i} className="card" style={{ marginBottom: 8, borderLeft: '3px solid var(--red)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{p.pattern}</div>
              {p.example && <div style={{ fontSize: 11, color: 'var(--text3)', fontStyle: 'italic', marginBottom: 6 }}>e.g. "{p.example}"</div>}
              {p.teachingNote && <div style={{ fontSize: 12, color: 'var(--text2)', padding: '6px 8px', background: 'var(--bg2)', borderRadius: 4 }}>→ {p.teachingNote}</div>}
            </div>
          ))}
        </div>
      </div>

      <button style={{ marginTop: 16, fontSize: 12 }} onClick={analyze}>↻ Re-analyze</button>
    </div>
  );
}

// ── 5. Always-On Effectiveness ───────────────────────────────────────────

function EffectivenessView({ course, password }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${BASE}/api/analytics/alwayson-effectiveness?courseId=${course.id}`, { headers: h(password) })
      .then(r => r.json()).then(d => { setData(d); setLoading(false); });
  }, [course.id]);

  if (loading) return <Loading />;
  if (data?.message && !data?.results?.length) return <Empty message={data.message} />;

  const rate = data.effectivenessRate || 0;
  const rateColor = rate >= 70 ? 'var(--green)' : rate >= 40 ? 'var(--amber)' : 'var(--red)';

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 20 }}>
        {[
          ['Effectiveness rate', `${rate}%`, rateColor],
          ['Students improved', data.improved, 'var(--green)'],
          ['Total tracked', data.total, 'var(--text)']
        ].map(([l, v, color]) => (
          <div key={l} style={{ padding: '14px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--text3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{l}</div>
            <div style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 24, color }}>{v}</div>
          </div>
        ))}
      </div>

      {data.summary && (
        <div style={{ padding: '12px 16px', marginBottom: 16, background: 'var(--bg2)', borderRadius: 8, fontSize: 13, color: 'var(--text2)' }}>
          {data.summary}
        </div>
      )}

      {(data.results || []).map((r, i) => (
        <div key={i} className="card" style={{ marginBottom: 8, padding: '12px 14px',
          borderLeft: `3px solid ${r.improved ? 'var(--green)' : 'var(--red)'}` }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{r.student}</div>
              <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 2 }}>Focus: {r.weakArea}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 2 }}>
                {r.beforeAssignment} → {r.afterAssignment}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: 14, fontFamily: 'var(--mono)', color: 'var(--text2)' }}>{r.beforeScore}%</span>
                <span style={{ fontSize: 16 }}>{r.improved ? '→' : '→'}</span>
                <span style={{ fontSize: 14, fontFamily: 'var(--mono)', fontWeight: 700, color: r.improved ? 'var(--green)' : 'var(--red)' }}>{r.afterScore}%</span>
              </div>
              <div style={{ fontSize: 12, fontWeight: 600, color: r.improved ? 'var(--green)' : 'var(--red)', textAlign: 'right', marginTop: 2 }}>
                {r.improved ? `+${r.change}%` : `${r.change}%`}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Shared helpers ───────────────────────────────────────────────────────

function Loading({ message = 'Loading…' }) {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
      <div style={{ fontSize: 24, marginBottom: 10 }}>⟳</div>
      {message}
    </div>
  );
}

function Empty({ message, action }) {
  return (
    <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
      <div style={{ fontSize: 28, marginBottom: 10 }}>📊</div>
      {message}
      {action && (
        <div style={{ marginTop: 12 }}>
          <button onClick={action.fn} className="primary" style={{ fontSize: 12 }}>{action.label}</button>
        </div>
      )}
    </div>
  );
}
