const test = require('node:test');
const assert = require('node:assert');
const { makeTestDb } = require('./helpers/tempdb');
const { cloneCourse, CourseNotFound } = require('../lib/courseLifecycle');

const BLOCKED = ['id', 'name', 'term', 'created_at'];

// A source course with two assignments, examples on both, one active and one
// archived material, and a full set of rows that must NOT be copied.
function seedSource(db) {
  db.prepare(`INSERT INTO courses (id,name,full_name,institution,term,color,instructor_bio,voice_guidelines,discussion_default_question,sliders,canvas_url,canvas_token,do_not_penalize)
    VALUES ('src','AIN 714','Emerging AI','Wake Forest','Summer 2026','#abc','BIO','VOICE','Q','{"clarity":5}','https://canvas.test','tok','none')`).run();

  db.prepare(`INSERT INTO assignments (id,course_id,name,type,max_score,display_order,description,rubric,rubric_criteria,target_avg,grading_strictness,grading_guidance,canvas_assignment_id,score_cap)
    VALUES ('a1','src','T&E Report','report',75,1,'DESC','RUBRIC','[{"id":"c1"}]',4.5,'strict','GUIDE','1284471',70)`).run();
  // Second assignment leaves the nullable grading fields NULL on purpose.
  db.prepare(`INSERT INTO assignments (id,course_id,name,canvas_assignment_id) VALUES ('a2','src','No Cap','999')`).run();

  const ex = db.prepare('INSERT INTO examples (id,assignment_id,course_id,student_name,score,quality,notes,content) VALUES (?,?,?,?,?,?,?,?)');
  ex.run('e1', 'a1', 'src', 'Ann', 70, 'good', 'N1', 'C1');
  ex.run('e2', 'a1', 'src', 'Bob', 40, 'weak', 'N2', 'C2');
  ex.run('e3', 'a2', 'src', 'Cal', 60, 'good', 'N3', 'C3');

  db.prepare("INSERT INTO materials (id,course_id,assignment_id,name,type,status) VALUES ('m1','src','a1','Lecture','pdf','active')").run();
  db.prepare("INSERT INTO materials (id,course_id,name,type,status) VALUES ('m2','src','Old','pdf','archived')").run();

  // None of these may be copied.
  db.prepare("INSERT INTO students (id,course_id,name) VALUES ('s1','src','Student')").run();
  db.prepare("INSERT INTO grades (id,course_id,assignment_id) VALUES ('g1','src','a1')").run();
  db.prepare("INSERT INTO discussions (id,course_id) VALUES ('d1','src')").run();
  db.prepare("INSERT INTO always_on (id,course_id) VALUES ('ao1','src')").run();
  db.prepare("INSERT INTO grading_flags (id,course_id,assignment_id,student_name,flag_type,message) VALUES ('f1','src','a1','S','t','m')").run();
  db.prepare("INSERT INTO batch_grades (id,course_id,assignment_id,student_name) VALUES ('b1','src','a1','S')").run();
  return db;
}

const clone = db => cloneCourse(db, 'src', { name: 'AIN 714', term: 'Fall 2 2026' });

test('copies every course column except the blocklist', () => {
  const db = seedSource(makeTestDb());
  const { course } = clone(db);
  const src = db.prepare('SELECT * FROM courses WHERE id=?').get('src');

  assert.notStrictEqual(course.id, 'src');
  assert.strictEqual(course.name, 'AIN 714');
  assert.strictEqual(course.term, 'Fall 2 2026');

  const cols = db.prepare('PRAGMA table_info(courses)').all().map(c => c.name);
  for (const col of cols) {
    if (BLOCKED.includes(col)) continue;
    assert.strictEqual(course[col], src[col], `column ${col} should have been copied`);
  }
});

test('copies assignments with their grading configuration', () => {
  const db = seedSource(makeTestDb());
  const { course } = clone(db);
  const a = db.prepare('SELECT * FROM assignments WHERE course_id=? AND name=?').get(course.id, 'T&E Report');
  assert.strictEqual(a.type, 'report');
  assert.strictEqual(a.max_score, 75);
  assert.strictEqual(a.display_order, 1);
  assert.strictEqual(a.description, 'DESC');
  assert.strictEqual(a.rubric, 'RUBRIC');
  assert.strictEqual(a.rubric_criteria, '[{"id":"c1"}]');
  assert.strictEqual(a.target_avg, 4.5);
  assert.strictEqual(a.grading_strictness, 'strict');
  assert.strictEqual(a.grading_guidance, 'GUIDE');
  assert.strictEqual(a.score_cap, 70);
  assert.notStrictEqual(a.id, 'a1');
});

// Review Focus 1 — every cloned assignment starts blank, or the duplicate
// Canvas-id warning in Task 7 would fire on all of them at once.
test('blanks canvas_assignment_id on every cloned assignment', () => {
  const db = seedSource(makeTestDb());
  const { course } = clone(db);
  const rows = db.prepare('SELECT canvas_assignment_id FROM assignments WHERE course_id=?').all(course.id);
  assert.strictEqual(rows.length, 2);
  for (const r of rows) assert.strictEqual(r.canvas_assignment_id, '');
});

// Review Focus 5 — a stringified null would read as a score cap of zero.
test('NULL score_cap and rubric_criteria survive as NULL', () => {
  const db = seedSource(makeTestDb());
  const { course } = clone(db);
  const a = db.prepare('SELECT * FROM assignments WHERE course_id=? AND name=?').get(course.id, 'No Cap');
  assert.strictEqual(a.score_cap, null);
  assert.strictEqual(a.rubric_criteria, null);
});

test('carries examples onto the matching new assignment', () => {
  const db = seedSource(makeTestDb());
  const { course, counts } = clone(db);
  assert.strictEqual(counts.examples, 3);

  const newA1 = db.prepare('SELECT id FROM assignments WHERE course_id=? AND name=?').get(course.id, 'T&E Report');
  const carried = db.prepare('SELECT * FROM examples WHERE assignment_id=? ORDER BY student_name').all(newA1.id);
  assert.deepStrictEqual(carried.map(e => e.student_name), ['Ann', 'Bob']);
  assert.deepStrictEqual(carried.map(e => e.quality), ['good', 'weak']);
  assert.strictEqual(carried[0].content, 'C1');
  for (const e of carried) {
    assert.strictEqual(e.course_id, course.id);
    assert.notStrictEqual(e.id, 'e1');
  }
});

test('leaves the source course\'s examples untouched', () => {
  const db = seedSource(makeTestDb());
  clone(db);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM examples WHERE course_id=?').get('src').n, 3);
});

test('copies only active materials', () => {
  const db = seedSource(makeTestDb());
  const { course, counts } = clone(db);
  const mats = db.prepare('SELECT * FROM materials WHERE course_id=?').all(course.id);
  assert.strictEqual(counts.materials, 1);
  assert.deepStrictEqual(mats.map(m => m.name), ['Lecture']);
});

test('treats a NULL material status as active rather than dropping it', () => {
  const db = seedSource(makeTestDb());
  db.prepare("INSERT INTO materials (id,course_id,name,type,status) VALUES ('m3','src','NullStatus','pdf',NULL)").run();
  const { course } = clone(db);
  const names = db.prepare('SELECT name FROM materials WHERE course_id=?').all(course.id).map(m => m.name).sort();
  assert.deepStrictEqual(names, ['Lecture', 'NullStatus']);
});

test('remaps a material onto the cloned assignment', () => {
  const db = seedSource(makeTestDb());
  const { course } = clone(db);
  const newA1 = db.prepare('SELECT id FROM assignments WHERE course_id=? AND name=?').get(course.id, 'T&E Report');
  const m = db.prepare('SELECT * FROM materials WHERE course_id=?').get(course.id);
  assert.strictEqual(m.assignment_id, newA1.id);
});

test('does not copy students, grades, discussions, always_on, grading_flags or batch_grades', () => {
  const db = seedSource(makeTestDb());
  const { course } = clone(db);
  for (const t of ['students', 'grades', 'discussions', 'always_on', 'grading_flags', 'batch_grades']) {
    assert.strictEqual(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE course_id=?`).get(course.id).n, 0, t);
  }
});

// Review Focus 3 — the Fall 2 shell is exactly this, and is a plausible source.
test('clones a course with zero assignments', () => {
  const db = makeTestDb();
  db.prepare("INSERT INTO courses (id,name) VALUES ('empty','Shell')").run();
  const { course, counts } = cloneCourse(db, 'empty', { name: 'X', term: 'Y' });
  assert.ok(course.id);
  assert.deepStrictEqual(counts, { assignments: 0, materials: 0, examples: 0 });
});

test('reports the counts it created', () => {
  const { counts } = clone(seedSource(makeTestDb()));
  assert.deepStrictEqual(counts, { assignments: 2, materials: 1, examples: 3 });
});

test('two clones of the same source do not collide', () => {
  const db = seedSource(makeTestDb());
  const first = clone(db).course;
  const second = clone(db).course;
  assert.notStrictEqual(first.id, second.id);
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM assignments').get().n, 6);
});

test('unknown source throws CourseNotFound', () => {
  assert.throws(() => cloneCourse(makeTestDb(), 'nope', { name: 'X', term: 'Y' }), CourseNotFound);
});
