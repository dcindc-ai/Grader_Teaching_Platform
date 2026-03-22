import { useState, useEffect, useCallback } from 'react';
import { getAssignments } from '../api.js';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

const FLAG_CONFIG = {
  'dnp-violation':          { label: 'DO NOT PENALIZE violation', color: '#dc2626', bg: 'rgba(220,38,38,0.07)', icon: '⚠' },
  'correction-propagation': { label: 'Needs same correction',     color: '#d97706', bg: 'rgba(217,119,6,0.07)',  icon: '↻' },
};

export default function FlagsTab({ course, password }) {
  const [assignments, setAssignments] = useState([]);
  const [assignmentId, setAssignmentId] = useState('');
  const [flags, setFlags] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('open');

  useEffect(() => {
    getAssignments(course.id, password).then(a => {
      setAssignments(a);
      if (a.length) setAssignmentId(a[0].id);
    });
  }, [course.id]);

  const loadFlags = useCallback(async (aId) => {
    if (!aId) return;
    setLoading(true);
    const r = await fetch(`${BASE}/api/flags?courseId=${course.id}&assignmentId=${aId}&status=${filter}`);
    if (r.ok) setFlags(await r.json());
    setLoading(false);
  }, [course.id, filter]);

  useEffect(() => { loadFlags(assignmentId); }, [assignmentId, filter, loadFlags]);

  async function resolve(id, status) {
    await fetch(`${BASE}/api/flags/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });
    setFlags(f => f.filter(x => x.id !== id));
  }

  const openCount = flags.filter(f => f.status === 'open').length;
  const accent = course.color || '#1a4fbf';

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px' }}>
      <div style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div className="page-title">Grading Flags</div>
          <div className="page-sub">Issues detected during grading that need your review</div>
        </div>
        {openCount > 0 && (
          <div style={{ padding: '6px 14px', background: 'rgba(220,38,38,0.1)', borderRadius: 20,
            fontSize: 13, fontWeight: 700, color: '#dc2626' }}>
            {openCount} open
          </div>
        )}
      </div>

      {/* Controls */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, alignItems: 'center' }}>
        <select value={assignmentId} onChange={e => setAssignmentId(e.target.value)}
          style={{ fontSize: 13, padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', flex: 1, maxWidth: 280 }}>
          {assignments.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <div style={{ display: 'flex', gap: 4 }}>
          {['open', 'resolved', 'dismissed'].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              style={{ fontSize: 12, padding: '5px 12px', borderRadius: 6,
                background: filter === s ? accent : 'var(--bg2)',
                color: filter === s ? '#fff' : 'var(--text2)',
                border: `1px solid ${filter === s ? accent : 'var(--border)'}`,
                cursor: 'pointer', textTransform: 'capitalize', fontWeight: filter === s ? 600 : 400 }}>
              {s}
            </button>
          ))}
        </div>
        <button onClick={() => loadFlags(assignmentId)} style={{ fontSize: 12, padding: '5px 10px' }}>↻ Refresh</button>
      </div>

      {loading && <div style={{ color: 'var(--text3)', fontSize: 13 }}>Loading…</div>}

      {!loading && flags.length === 0 && (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--text3)', fontSize: 14,
          border: '1.5px dashed var(--border2)', borderRadius: 10 }}>
          {filter === 'open' ? '✓ No open flags — grading looks consistent' : `No ${filter} flags`}
        </div>
      )}

      {flags.map(flag => {
        const cfg = FLAG_CONFIG[flag.flag_type] || { label: flag.flag_type, color: '#6b7280', bg: 'var(--bg2)', icon: '!' };
        return (
          <div key={flag.id} style={{ padding: '14px 16px', marginBottom: 10, borderRadius: 8,
            background: cfg.bg, border: `1px solid ${cfg.color}30` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.icon} {flag.student_name}</span>
                  <span style={{ fontSize: 11, color: cfg.color, background: cfg.color + '15',
                    padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>{cfg.label}</span>
                  {flag.criterion_name && (
                    <span style={{ fontSize: 11, color: 'var(--text3)' }}>{flag.criterion_name}</span>
                  )}
                </div>
                <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>{flag.message}</p>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                  {new Date(flag.created_at).toLocaleString()}
                </div>
              </div>
              {filter === 'open' && (
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button onClick={() => resolve(flag.id, 'resolved')}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--green)',
                      color: 'var(--green)', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                    ✓ Resolved
                  </button>
                  <button onClick={() => resolve(flag.id, 'dismissed')}
                    style={{ fontSize: 11, padding: '4px 10px', borderRadius: 5, border: '1px solid var(--border)',
                      color: 'var(--text3)', background: '#fff', cursor: 'pointer' }}>
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
