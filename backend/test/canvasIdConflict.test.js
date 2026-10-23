const test = require('node:test');
const assert = require('node:assert');
const { makeTestDb } = require('./helpers/tempdb');
const { findCanvasIdConflict } = require('../lib/courseLifecycle');

function seed() {
  const db = makeTestDb();
  db.prepare("INSERT INTO courses (id,name,term) VALUES ('summer','AIN 714','Summer 2026')").run();
  db.prepare("INSERT INTO courses (id,name,term) VALUES ('fall','AIN 714','Fall 2 2026')").run();
  db.prepare("INSERT INTO assignments (id,course_id,name,canvas_assignment_id) VALUES ('a1','summer','T&E Report','1284471')").run();
  // The shape a clone produces: same name, blank Canvas id.
  db.prepare("INSERT INTO assignments (id,course_id,name,canvas_assignment_id) VALUES ('a2','fall','T&E Report','')").run();
  db.prepare("INSERT INTO assignments (id,course_id,name,canvas_assignment_id) VALUES ('a3','fall','Discussion 1','')").run();
  return db;
}

// Review Focus 1 — every assignment a clone produces starts blank. A check
// that treats '' as a value would warn on all 13 at once and make the
// feature useless the moment it shipped.
test('an empty canvas id never conflicts', () => {
  const db = seed();
  assert.strictEqual(findCanvasIdConflict(db, 'a2', ''), null);
  assert.strictEqual(findCanvasIdConflict(db, 'a2', null), null);
  assert.strictEqual(findCanvasIdConflict(db, 'a2', undefined), null);
  assert.strictEqual(findCanvasIdConflict(db, 'a2', '   '), null);
});

test('two blank assignments from the same clone do not conflict with each other', () => {
  const db = seed();
  assert.strictEqual(findCanvasIdConflict(db, 'a3', ''), null);
});

test('finds a conflict on another assignment and names its course and term', () => {
  const c = findCanvasIdConflict(seed(), 'a2', '1284471');
  assert.ok(c, 'expected a conflict');
  assert.strictEqual(c.id, 'a1');
  assert.strictEqual(c.name, 'T&E Report');
  assert.strictEqual(c.course_name, 'AIN 714');
  assert.strictEqual(c.term, 'Summer 2026');
});

test('an assignment does not conflict with itself', () => {
  assert.strictEqual(findCanvasIdConflict(seed(), 'a1', '1284471'), null);
});

test('a genuinely new canvas id does not conflict', () => {
  assert.strictEqual(findCanvasIdConflict(seed(), 'a2', '9999999'), null);
});

test('matches a numeric id passed as a number', () => {
  const c = findCanvasIdConflict(seed(), 'a2', 1284471);
  assert.ok(c, 'a number should match the stored string');
  assert.strictEqual(c.id, 'a1');
});

test('surrounding whitespace does not hide a conflict', () => {
  const c = findCanvasIdConflict(seed(), 'a2', '  1284471  ');
  assert.ok(c, 'expected the trimmed id to match');
  assert.strictEqual(c.id, 'a1');
});
