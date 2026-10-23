const test = require('node:test');
const assert = require('node:assert');
const { makeTestDb } = require('./helpers/tempdb');
const { loadExamplesFor } = require('../lib/calibration');

function seed(db) {
  db.prepare('INSERT INTO courses (id,name) VALUES (?,?)').run('c1', 'Course');
  db.prepare('INSERT INTO assignments (id,course_id,name) VALUES (?,?,?)').run('a1', 'c1', 'A1');
  db.prepare('INSERT INTO assignments (id,course_id,name) VALUES (?,?,?)').run('a2', 'c1', 'A2');
  const ins = db.prepare('INSERT INTO examples (id,assignment_id,course_id,quality,content) VALUES (?,?,?,?,?)');
  // a1 is lopsided: 8 good, 1 weak. Recency alone would show only good.
  for (let i = 0; i < 8; i++) ins.run(`g${i}`, 'a1', 'c1', 'good', `good ${i}`);
  ins.run('w0', 'a1', 'c1', 'weak', 'weak 0');
  ins.run('other', 'a2', 'c1', 'good', 'other assignment');
  return db;
}

test('loads only the given assignment\'s examples', () => {
  const got = loadExamplesFor(seed(makeTestDb()), 'a1', 6);
  assert.ok(got.every(e => e.assignment_id === 'a1'));
  assert.ok(!got.some(e => e.id === 'other'));
});

test('reaches past the newest to include the lone weak example', () => {
  const got = loadExamplesFor(seed(makeTestDb()), 'a1', 6);
  assert.strictEqual(got.length, 6);
  assert.ok(got.some(e => e.quality === 'weak'), 'the single weak example must be present');
});

test('honours the cap', () => {
  assert.strictEqual(loadExamplesFor(seed(makeTestDb()), 'a1', 3).length, 3);
});

test('an assignment with no examples returns empty', () => {
  assert.deepStrictEqual(loadExamplesFor(seed(makeTestDb()), 'nope', 6), []);
});

test('a null assignment id returns empty without querying', () => {
  assert.deepStrictEqual(loadExamplesFor(seed(makeTestDb()), null, 6), []);
});
