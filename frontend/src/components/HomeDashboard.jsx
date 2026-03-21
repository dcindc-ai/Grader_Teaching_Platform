export default function HomeDashboard({ courses, onSelectCourse, stats }) {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '48px 24px' }}>
      <div style={{ marginBottom: 40 }}>
        <div style={{ fontSize: 28, fontWeight: 800, color: 'var(--text)', marginBottom: 6 }}>
          Always On Learning
        </div>
        <div style={{ fontSize: 15, color: 'var(--text3)' }}>
          Select a course to get started
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
        {courses.map(course => (
          <button
            key={course.id}
            onClick={() => onSelectCourse(course.id)}
            style={{
              textAlign: 'left', padding: 0, border: 'none', background: 'none',
              cursor: 'pointer', borderRadius: 12, overflow: 'hidden',
              boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
              transition: 'transform 0.15s, box-shadow 0.15s'
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.13)'; }}
            onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 2px 8px rgba(0,0,0,0.08)'; }}
          >
            {/* Color bar */}
            <div style={{ height: 6, background: course.color || '#4f8ef7' }} />
            <div style={{ padding: '20px 22px', background: '#fff' }}>
              <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text)', marginBottom: 4 }}>
                {course.name}
              </div>
              <div style={{ fontSize: 13, color: 'var(--text3)', marginBottom: 12 }}>
                {course.fullName || course.name}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', display: 'flex', gap: 12 }}>
                <span>{course.institution}</span>
                {course.term && <span>· {course.term}</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {stats && (
        <div style={{ marginTop: 48, padding: '20px 24px', background: 'var(--bg2)', borderRadius: 10, display: 'flex', gap: 40 }}>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--accent)' }}>{stats.totalGrades || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Total grades</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--green)' }}>{stats.approvedAlwaysOn || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Approved recommendations</div>
          </div>
          <div>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--amber)' }}>{stats.pendingAlwaysOn || 0}</div>
            <div style={{ fontSize: 12, color: 'var(--text3)' }}>Pending review</div>
          </div>
        </div>
      )}
    </div>
  );
}
