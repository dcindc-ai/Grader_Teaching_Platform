const test = require('node:test');
const assert = require('node:assert');
const { makeTestDb } = require('./tempdb');

test('makeTestDb has the migrated assignments schema', () => {
  const db = makeTestDb();
  const cols = db.prepare('PRAGMA table_info(assignments)').all().map(c => c.name);
  for (const c of ['score_cap', 'target_avg', 'grading_strictness', 'grading_guidance', 'canvas_assignment_id']) {
    assert.ok(cols.includes(c), `missing ${c}`);
  }
});

test('makeTestDb has every table the schema declares', () => {
  const db = makeTestDb();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map(r => r.name);
  for (const t of ['courses', 'assignments', 'students', 'grades', 'examples', 'discussions', 'materials', 'always_on', 'grading_flags', 'batch_grades']) {
    assert.ok(tables.includes(t), `missing table ${t}`);
  }
});

test('each makeTestDb is isolated from the last', () => {
  const a = makeTestDb();
  a.prepare('INSERT INTO courses (id, name) VALUES (?, ?)').run('c1', 'X');
  const b = makeTestDb();
  assert.strictEqual(b.prepare('SELECT COUNT(*) n FROM courses').get().n, 0);
});
