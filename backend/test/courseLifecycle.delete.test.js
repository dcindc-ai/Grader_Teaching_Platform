const test = require('node:test');
const assert = require('node:assert');
const { makeTestDb } = require('./helpers/tempdb');
const {
  LINKED_TABLES,
  deleteBlockers,
  deleteCourse,
  CourseDeleteBlocked,
  CourseNotFound,
} = require('../lib/courseLifecycle');

// One row in each linked table, keyed to a course. Only the NOT NULL columns
// are filled; everything else is irrelevant to the guard.
const SEEDS = {
  students: (db, c) => db.prepare('INSERT INTO students (id,course_id,name) VALUES (?,?,?)').run('s1', c, 'Student'),
  grades: (db, c) => db.prepare('INSERT INTO grades (id,course_id) VALUES (?,?)').run('g1', c),
  discussions: (db, c) => db.prepare('INSERT INTO discussions (id,course_id) VALUES (?,?)').run('d1', c),
  batch_grades: (db, c) => db.prepare('INSERT INTO batch_grades (id,course_id,assignment_id,student_name) VALUES (?,?,?,?)').run('b1', c, 'a1', 'Student'),
  assignments: (db, c) => db.prepare('INSERT INTO assignments (id,course_id,name) VALUES (?,?,?)').run('a9', c, 'A'),
  materials: (db, c) => db.prepare('INSERT INTO materials (id,course_id,name,type) VALUES (?,?,?,?)').run('m1', c, 'M', 'pdf'),
  examples: (db, c) => db.prepare('INSERT INTO examples (id,assignment_id,course_id) VALUES (?,?,?)').run('e1', 'a1', c),
  always_on: (db, c) => db.prepare('INSERT INTO always_on (id,course_id) VALUES (?,?)').run('ao1', c),
  grading_flags: (db, c) => db.prepare('INSERT INTO grading_flags (id,course_id,assignment_id,student_name,flag_type,message) VALUES (?,?,?,?,?,?)').run('f1', c, 'a1', 'Student', 't', 'm'),
};

function withCourse(id = 'c1') {
  const db = makeTestDb();
  db.prepare('INSERT INTO courses (id,name) VALUES (?,?)').run(id, 'Course');
  return db;
}

function totals(db) {
  const out = {};
  for (const t of ['courses', ...LINKED_TABLES]) {
    out[t] = db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  }
  return out;
}

test('LINKED_TABLES covers every table that carries a course_id', () => {
  const db = makeTestDb();
  const withCourseId = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map(r => r.name)
    .filter(t => t !== 'courses')
    .filter(t => db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === 'course_id'));
  assert.deepStrictEqual([...LINKED_TABLES].sort(), withCourseId.sort());
});

test('deleteBlockers is empty for a course with nothing in it', () => {
  assert.deepStrictEqual(deleteBlockers(withCourse(), 'c1'), {});
});

test('deleteBlockers reports every non-empty linked table', () => {
  const db = withCourse();
  SEEDS.students(db, 'c1');
  db.prepare('INSERT INTO students (id,course_id,name) VALUES (?,?,?)').run('s2', 'c1', 'Other');
  SEEDS.grades(db, 'c1');
  SEEDS.assignments(db, 'c1');
  assert.deepStrictEqual(deleteBlockers(db, 'c1'), { students: 2, grades: 1, assignments: 1 });
});

test('deleteBlockers ignores rows belonging to another course', () => {
  const db = withCourse();
  db.prepare('INSERT INTO courses (id,name) VALUES (?,?)').run('other', 'Other');
  SEEDS.students(db, 'other');
  assert.deepStrictEqual(deleteBlockers(db, 'c1'), {});
});

test('deleteCourse removes the empty course row', () => {
  const db = withCourse();
  assert.deepStrictEqual(deleteCourse(db, 'c1'), { deleted: true });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM courses WHERE id=?').get('c1').n, 0);
});

// Each linked table, alone, must block the delete. This is the guard's contract.
for (const table of Object.keys(SEEDS)) {
  test(`refuses when only ${table} is non-empty`, () => {
    const db = withCourse();
    SEEDS[table](db, 'c1');
    assert.throws(() => deleteCourse(db, 'c1'), CourseDeleteBlocked);
    assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM courses WHERE id=?').get('c1').n, 1);
  });
}

test('the thrown error carries the counts', () => {
  const db = withCourse();
  SEEDS.assignments(db, 'c1');
  SEEDS.examples(db, 'c1');
  try {
    deleteCourse(db, 'c1');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof CourseDeleteBlocked);
    assert.deepStrictEqual(e.counts, { assignments: 1, examples: 1 });
  }
});

test('a blocked delete removes nothing at all', () => {
  const db = withCourse();
  for (const seed of Object.values(SEEDS)) seed(db, 'c1');
  const before = totals(db);
  assert.throws(() => deleteCourse(db, 'c1'), CourseDeleteBlocked);
  assert.deepStrictEqual(totals(db), before);
});

test('a populated clone is refused on its assignments and examples', () => {
  // The realistic case: a clone has assignments and carried examples, and no
  // student work at all. It must still be refused.
  const db = withCourse('clone');
  SEEDS.assignments(db, 'clone');
  SEEDS.examples(db, 'clone');
  try {
    deleteCourse(db, 'clone');
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e.counts.assignments > 0 && e.counts.examples > 0);
    assert.strictEqual(e.counts.students, undefined, 'no student rows to report');
  }
});

test('deleting an empty course leaves other courses untouched', () => {
  const db = withCourse('empty');
  db.prepare('INSERT INTO courses (id,name) VALUES (?,?)').run('keep', 'Keep');
  for (const seed of Object.values(SEEDS)) seed(db, 'keep');
  const before = totals(db);
  deleteCourse(db, 'empty');
  const after = totals(db);
  assert.strictEqual(after.courses, before.courses - 1);
  for (const t of LINKED_TABLES) assert.strictEqual(after[t], before[t], t);
});

// Review Focus 4
test('unknown course id throws CourseNotFound', () => {
  assert.throws(() => deleteCourse(makeTestDb(), 'nope'), CourseNotFound);
});

test('deleteBlockers on an unknown course id throws CourseNotFound', () => {
  assert.throws(() => deleteBlockers(makeTestDb(), 'nope'), CourseNotFound);
});
