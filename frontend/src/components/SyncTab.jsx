import { useState, useEffect } from 'react';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const STATUS_CONFIG = {
  ok:                  { label: '✓ In sync',             color: 'var(--green)',  bg: 'rgba(22,163,74,0.08)' },
  mismatch:            { label: '⚠ Score mismatch',      color: '#d97706',       bg: 'rgba(217,119,6,0.08)' },
  'missing-in-app':    { label: '✗ Not in app',          color: 'var(--red)',    bg: 'rgba(220,38,38,0.08)' },
  'missing-in-canvas': { label: '✗ Not in Canvas',       color: 'var(--red)',    bg: 'rgba(220,38,38,0.08)' },
  'not-graded-in-canvas': { label: '○ Ungraded in Canvas', color: 'var(--text3)', bg: 'var(--bg2)' },
  unknown:             { label: '? Unknown',              color: 'var(--text3)',  bg: 'var(--bg2)' },
};

export default function SyncTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [checking, setChecking] = useState(false);
  const [results, setResults] = useState(null);
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setAssignmentId(a[0].id);
    });
  }, [course.id]);

  async function runCheck() {
    if (!assignmentId) return;
    setChecking(true);
    setError('');
    setResults(null);
    setSummary(null);
    try {
      const r = await fetch(`${BASE}/api/canvassync/check?courseId=${course.id}&assignmentId=${assignmentId}`);
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'Check failed');
      setResults(data.results);
      setSummary(data.summary);
    } catch(e) {
      setError(e.message);
    }
    setChecking(false);
  }

  const filtered = results?.filter(r => filter === 'all' || r.status === filter) || [];
  const assignment = assignments.find(a => a.id === assignmentId);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '24px' }}>
      <div className="page-header" style={{ marginBottom: 20 }}>
        <div>
          <div className="page-title">Canvas Sync Check</div>
          <div className="page-sub">Compare your app grades against Canvas submitted grades</div>
        </div>
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 20 }}>
        <select value={assignmentId} onChange={e => { setAssignmentId(e.target.value); setResults(null); }}
          style={{ fontSize: 13, fontWeight: 500, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)' }}>
          {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <button className="primary" onClick={runCheck} disabled={checking} style={{ fontSize: 13 }}>
          {checking ? '⏳ Checking…' : '↻ Run sync check'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '12px 16px', background: 'rgba(220,38,38,0.08)', border: '1px solid var(--red)',
          borderRadius: 8, color: 'var(--red)', fontSize: 13, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
          {[
            { key: 'all', label: 'Total', value: summary.total, color: 'var(--text)' },
            { key: 'ok', label: 'In sync', value: summary.ok, color: 'var(--green)' },
            { key: 'mismatch', label: 'Mismatches', value: summary.mismatches, color: '#d97706' },
            { key: 'missing-in-app', label: 'Not in app', value: summary.missingInApp, color: 'var(--red)' },
            { key: 'missing-in-canvas', label: 'Not in Canvas', value: summary.missingInCanvas, color: 'var(--red)' },
            { key: 'not-graded-in-canvas', label: 'Ungraded', value: summary.notGraded, color: 'var(--text3)' },
          ].map(s => (
            <button key={s.key} onClick={() => setFilter(s.key)}
              style={{ padding: '10px 16px', borderRadius: 8, border: `2px solid ${filter === s.key ? s.color : 'var(--border)'}`,
                background: filter === s.key ? s.color + '15' : '#fff', cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 11, color: 'var(--text3)' }}>{s.label}</div>
            </button>
          ))}
        </div>
      )}

      {/* Results table */}
      {filtered.length > 0 && (
        <div style={{ border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--bg2)' }}>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Student</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>App Score</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Canvas Score</th>
                <th style={{ padding: '10px 14px', textAlign: 'center', fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Diff</th>
                <th style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700,
                  textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text3)' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const cfg = STATUS_CONFIG[r.status] || STATUS_CONFIG.unknown;
                return (
                  <tr key={i} style={{ borderTop: '1px solid var(--border)', background: cfg.bg }}>
                    <td style={{ padding: '10px 14px', fontSize: 13, fontWeight: 500 }}>{r.studentName}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13, fontFamily: 'var(--mono)' }}>
                      {r.appScore !== null ? r.appScore : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13, fontFamily: 'var(--mono)' }}>
                      {r.canvasScore !== null ? r.canvasScore : '—'}
                    </td>
                    <td style={{ padding: '10px 14px', textAlign: 'center', fontSize: 13, fontFamily: 'var(--mono)',
                      color: r.diff > 0 ? '#d97706' : 'var(--text3)', fontWeight: r.diff > 0 ? 700 : 400 }}>
                      {r.diff !== null ? (r.diff > 0 ? `+${r.diff.toFixed(1)}` : '0') : '—'}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color }}>{cfg.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {results && filtered.length === 0 && (
        <div style={{ padding: 32, textAlign: 'center', color: 'var(--text3)', fontSize: 14 }}>
          No results for this filter.
        </div>
      )}

      {!course.canvasUrl || !course.canvasToken ? (
        <div style={{ padding: '12px 16px', background: 'rgba(217,119,6,0.08)', border: '1px solid #d97706',
          borderRadius: 8, fontSize: 13, color: '#92400e', marginTop: 16 }}>
          Canvas URL and token not configured. Go to <strong>Course Settings → Canvas Integration</strong> to set them up.
        </div>
      ) : null}
    </div>
  );
}
