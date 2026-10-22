# Course Clone, Guarded Delete, and Full-Band Calibration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the instructor clone a course into a new term, delete a course that holds no student work, and have every grading surface draw on a balanced spread of calibration examples.

**Architecture:** Three pure-ish modules under `backend/lib/` that take a `db` handle as their first argument, so they are unit-testable against an in-memory database; thin Express routes that wire them up; small React changes. The project has no test runner today, so Task 1 stands one up using Node's built-in `node:test` — no new dependencies.

**Tech Stack:** Node 24, Express, `node:sqlite` (`--experimental-sqlite`), React. `node:test` for tests.

**Spec:** [docs/superpowers/specs/2026-10-22-course-clone-delete-design.md](../specs/2026-10-22-course-clone-delete-design.md)

## Global Constraints

- No new runtime or dev dependencies. `node:test` and `node:sqlite` are built in.
- Every command needs `--experimental-sqlite`.
- Every multi-table write runs in one transaction. `node:sqlite` has no `.transaction()` helper — use `db.exec('BEGIN')` / `COMMIT` / `ROLLBACK` with try/catch.
- Library functions take `db` as their first parameter. Never import the `db` singleton from `db.js` inside `backend/lib/`.
- `backend/lib/` is **untracked in git** and is already required by six files. Task 1 adds it.
- **Delete removes one `courses` row, only from a course that is already empty in all nine linked tables.** No cascade, no file deletion, no exceptions. The only `DELETE` statement this plan adds targets `courses`. Anything else is a bug — see Task 4.
- `canvas_assignment_id` is always blank on a cloned assignment.

## Review Focus

Five things the spec implies that no task's happy path would exercise. Each has a test in the task that owns the code.

1. **Empty `canvas_assignment_id` must never trigger the duplicate warning.** Every one of the 13 assignments a clone produces starts blank, so a check that treats `''` as a value would warn on every save. (Task 7)
2. **An example whose `quality` is NULL or an unrecognised value must still be selectable.** The round-robin indexes a fixed tier list; an unknown tier must not be dropped silently or throw. (Task 2)
3. **Cloning a course with zero assignments must succeed** and produce an empty course. The Fall 2 shell is exactly this, and it is a plausible clone source. (Task 5)
4. **Deleting a course id that does not exist must 404**, not report `{ok: true}` for a no-op. The current endpoint reports success for any id. (Task 6)
5. **NULL `score_cap` and NULL `rubric_criteria` must survive a clone as NULL**, not as `"null"` or `''`. `parseAssignment` branches on null for both, and a stringified null would silently enable a score cap of zero. (Task 5)

---

### Task 1: Test harness and `backend/lib/` in git

**Files:**
- Create: `backend/schema.js`
- Modify: `backend/db.js:17-136` (replace the inline schema block)
- Create: `backend/test/helpers/tempdb.js`
- Create: `backend/test/helpers/tempdb.test.js`
- Modify: `backend/package.json` (add `test` script)

**Interfaces:**
- Produces: `applySchema(db)` from `backend/schema.js`; `makeTestDb()` from `backend/test/helpers/tempdb.js`, returning a `DatabaseSync` with the full schema plus all migrations applied.

- [ ] **Step 1: Track `backend/lib/` in git**

```bash
git add backend/lib/
git commit -m "chore: track backend/lib (required by six modules, never committed)"
```

- [ ] **Step 2: Extract the schema**

Move the template literal currently passed to `db.exec` at `backend/db.js:17-136` into `backend/schema.js` as `const SCHEMA_SQL`. Export `applySchema(db)`, which runs `db.exec(SCHEMA_SQL)`. In `db.js`, require it and call `applySchema(db)` in place of the removed block. The SQL itself is unchanged.

- [ ] **Step 3: Write the fixture**

`makeTestDb()` in `backend/test/helpers/tempdb.js`: open `new DatabaseSync(':memory:')`, call `applySchema(db)`, then `migrate(db)` from `backend/migrate.js` (which exports `{ migrate }`). Return the handle. Migrations must run — `score_cap`, `target_avg`, `grading_strictness`, and `grading_guidance` are all `ALTER TABLE` columns, and the clone depends on them.

- [ ] **Step 4: Write the fixture's own test**

```js
test('makeTestDb has the migrated assignments schema', () => {
  const db = makeTestDb();
  const cols = db.prepare('PRAGMA table_info(assignments)').all().map(c => c.name);
  for (const c of ['score_cap', 'target_avg', 'grading_strictness', 'grading_guidance', 'canvas_assignment_id']) {
    assert.ok(cols.includes(c), `missing ${c}`);
  }
});
```

- [ ] **Step 5: Add the test script**

In `backend/package.json`: `"test": "node --experimental-sqlite --test test/"`.

- [ ] **Step 6: Run it**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 7: Verify the real server still boots**

Run: `cd backend && node --experimental-sqlite -e "require('./db'); console.log('db ok')"`
Expected: `db ok`, and `backend/data/platform.db` unchanged in `git status`.

- [ ] **Step 8: Commit**

```bash
git add backend/schema.js backend/db.js backend/test backend/package.json
git commit -m "test: add node:test harness with in-memory db fixture"
```

---

### Task 2: Balanced calibration selection

**Files:**
- Create: `backend/lib/calibration.js`
- Create: `backend/test/calibration.test.js`

**Interfaces:**
- Produces: `selectBalanced(examples, cap)` → array of at most `cap` examples, round-robining across quality tiers in the order `good`, `borderline`, `weak`, then any other tier present. Input order within a tier is preserved. Pure; no database access.

- [ ] **Step 1: Write the failing tests**

```js
test('round-robins across tiers rather than taking the newest', () => {
  const pool = [
    ...mk(10, 'good'), ...mk(5, 'weak'), ...mk(3, 'borderline'),
  ];
  const got = selectBalanced(pool, 6);
  assert.strictEqual(got.length, 6);
  assert.deepStrictEqual(countBy(got, 'quality'), { good: 2, borderline: 2, weak: 2 });
});

test('falls back to the tiers that exist', () => {
  const got = selectBalanced(mk(10, 'good'), 6);
  assert.strictEqual(got.length, 6);
});

test('returns everything when the pool is smaller than the cap', () => {
  assert.strictEqual(selectBalanced(mk(2, 'good'), 6).length, 2);
});

test('empty pool returns empty', () => {
  assert.deepStrictEqual(selectBalanced([], 6), []);
});

// Review Focus 2
test('keeps examples whose quality is null or unrecognised', () => {
  const pool = [...mk(1, 'good'), { id: 'x', quality: null }, { id: 'y', quality: 'excellent' }];
  const got = selectBalanced(pool, 6);
  assert.strictEqual(got.length, 3);
  assert.ok(got.some(e => e.id === 'x') && got.some(e => e.id === 'y'));
});
```

`mk(n, quality)` and `countBy` are local helpers in the test file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — cannot find module `../lib/calibration`.

- [ ] **Step 3: Implement `selectBalanced(examples, cap)` in `backend/lib/calibration.js`**

Group by `quality`. Order the tiers `good`, `borderline`, `weak` first, then any remaining distinct values in first-seen order, so an unknown or null tier is a tier of its own rather than a dropped row. Round-robin until `cap` is reached or every tier is exhausted. This generalises the logic currently inline at `backend/routes/discussgrade.js:183-191`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/calibration.js backend/test/calibration.test.js
git commit -m "feat: add balanced calibration example selection"
```

---

### Task 3: Use balanced selection on all three graders

**Files:**
- Modify: `backend/routes/discussgrade.js:183-191`
- Modify: `backend/routes/grade.js:471`
- Modify: `backend/routes/batchgrade.js` (example loading; remove dead scrub at `:233`)

**Interfaces:**
- Consumes: `selectBalanced(examples, cap)` from Task 2.

- [ ] **Step 1: Replace the inline round-robin in `discussgrade.js`**

Swap the hand-rolled tier loop for `selectBalanced(pool, 6)`. Behaviour must not change; the existing `[discussgrade] calibration examples injected: N of M` log stays.

- [ ] **Step 2: Fix `grade.js`**

Replace `ORDER BY created_at DESC LIMIT 3` at `:471` with the unlimited pool for the assignment, then `selectBalanced(pool, 6)`. Add the same diagnostic log, prefixed `[grade]`.

- [ ] **Step 3: Give `batchgrade.js` examples**

Load the assignment's examples, select with `selectBalanced(pool, 3)` — cap 3, because batch runs once per student. Inject them into the system prompt built at `:185`, following the labelled format `discussgrade.js` uses (`[Instructor score: N — STRONG example]`). Add a `[batchgrade]` diagnostic log.

- [ ] **Step 4: Remove the dead scrub**

Delete `consistencyNote` from the `scrubFields` call at `backend/routes/batchgrade.js:233`. Nothing in this prompt asks the model to produce it. Full consistency-rule parity for batch grading is explicitly out of scope (see spec).

- [ ] **Step 5: Verify all three surfaces still load**

Run: `cd backend && node --experimental-sqlite -e "require('dotenv').config({path:'../.env'}); for (const r of ['grade','discussgrade','batchgrade']) require('./routes/'+r); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/grade.js backend/routes/discussgrade.js backend/routes/batchgrade.js
git commit -m "feat: use full calibration band on all three grading surfaces"
```

---

### Task 4: Delete blockers and cascade

**Files:**
- Create: `backend/lib/courseLifecycle.js`
- Create: `backend/test/courseLifecycle.delete.test.js`

**Interfaces:**
- Consumes: `makeTestDb()` from Task 1.
- Produces, from `backend/lib/courseLifecycle.js`:
  - `LINKED_TABLES` — the nine table names that carry a `course_id`.
  - `deleteBlockers(db, courseId)` → `{ [table]: count }` for every table in `LINKED_TABLES` with a non-zero count; `{}` when the course is empty.
  - `deleteCourse(db, courseId)` → `{ deleted: true }`, or throws `CourseDeleteBlocked` carrying `.counts`, or throws `CourseNotFound`.
  - Both error classes are exported.

**This task deletes one row and nothing else.** A course that passes the guard
has no rows anywhere to cascade to. Any `DELETE` statement here against a table
other than `courses` is a bug.

- [ ] **Step 1: Write the failing tests**

```js
test('deleteBlockers is empty for a course with nothing in it', () => {
  assert.deepStrictEqual(deleteBlockers(db, 'empty'), {});
});

test('deleteBlockers reports every non-empty linked table', () => {
  // seed 2 students, 3 grades, 1 assignment on 'c1'
  assert.deepStrictEqual(deleteBlockers(db, 'c1'), { students: 2, grades: 3, assignments: 1 });
});

test('deleteCourse removes the empty course row', () => {
  assert.deepStrictEqual(deleteCourse(db, 'empty'), { deleted: true });
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM courses WHERE id=?').get('empty').n, 0);
});

// one per linked table: each alone must block the delete
for (const t of ['students','grades','discussions','batch_grades','assignments','materials','examples','always_on','grading_flags']) {
  test(`refuses when only ${t} is non-empty`, () => {
    // seed exactly one row in t for course 'c1', nothing else
    assert.throws(() => deleteCourse(db, 'c1'), CourseDeleteBlocked);
  });
}

test('a blocked delete removes nothing at all', () => {
  // seed students + grades + assignments + examples on 'c1'
  try { deleteCourse(db, 'c1'); } catch {}
  assert.strictEqual(db.prepare('SELECT COUNT(*) n FROM courses WHERE id=?').get('c1').n, 1);
  for (const t of ['students','grades','assignments','examples']) {
    assert.ok(db.prepare(`SELECT COUNT(*) n FROM ${t} WHERE course_id=?`).get('c1').n > 0, t);
  }
});

test('a populated clone is refused on its assignments and examples', () => {
  // the realistic case: 13 assignments, carried examples, zero student work
  const err = assert.throws(() => deleteCourse(db, 'clone'), CourseDeleteBlocked);
  assert.ok(err.counts.assignments > 0 && err.counts.examples > 0);
});

test('deleting an empty course leaves other courses untouched', () => {});

// Review Focus 4
test('unknown course id throws CourseNotFound', () => {
  assert.throws(() => deleteCourse(db, 'nope'), CourseNotFound);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — cannot find module `../lib/courseLifecycle`.

- [ ] **Step 3: Implement `deleteBlockers` and `deleteCourse`**

`deleteBlockers` counts `course_id = ?` across every name in `LINKED_TABLES` and returns only the non-zero ones. `deleteCourse` checks the course exists, calls `deleteBlockers`, throws `CourseDeleteBlocked` with those counts if any came back, and otherwise runs a single `DELETE FROM courses WHERE id=?`. No transaction is needed for one statement, and no other table is touched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/courseLifecycle.js backend/test/courseLifecycle.delete.test.js
git commit -m "feat: add guarded course delete"
```

---

### Task 5: Clone a course

**Files:**
- Modify: `backend/lib/courseLifecycle.js`
- Create: `backend/test/courseLifecycle.clone.test.js`

**Interfaces:**
- Produces: `cloneCourse(db, sourceCourseId, { name, term, ...overrides })` → `{ course, counts: { assignments, materials, examples } }`. Throws `CourseNotFound` for an unknown source.

- [ ] **Step 1: Write the failing tests**

```js
test('copies every course column except the blocklist', () => {
  // blocklist: id, name, term, created_at
  const { course } = cloneCourse(db, 'src', { name: 'Fall 2', term: 'Fall 2 2026' });
  assert.notStrictEqual(course.id, 'src');
  assert.strictEqual(course.name, 'Fall 2');
  assert.strictEqual(course.instructor_bio, 'BIO');
  assert.strictEqual(course.sliders, '{"clarity":5}');
});

test('copies assignments with their grading configuration', () => {
  // assert name, type, max_score, display_order, description, rubric,
  // rubric_criteria, target_avg, grading_strictness, grading_guidance, score_cap
});

// Review Focus 1
test('blanks canvas_assignment_id on every cloned assignment', () => {
  const rows = db.prepare('SELECT canvas_assignment_id FROM assignments WHERE course_id=?').all(course.id);
  assert.ok(rows.length > 0);
  for (const r of rows) assert.strictEqual(r.canvas_assignment_id, '');
});

// Review Focus 5
test('NULL score_cap and rubric_criteria survive as NULL', () => {
  const a = db.prepare('SELECT * FROM assignments WHERE course_id=? AND name=?').get(course.id, 'No Cap');
  assert.strictEqual(a.score_cap, null);
  assert.strictEqual(a.rubric_criteria, null);
});

test('carries examples onto the matching new assignment', () => {
  // seed 2 examples on the source assignment; assert both land on the clone's
  // counterpart, with the new course_id and new assignment_id
});

test('copies only active materials', () => {
  // seed one active + one status='archived'; assert exactly the active one is copied
});

test('does not copy students, grades, discussions, always_on, grading_flags, batch_grades', () => {});

// Review Focus 3
test('clones a course with zero assignments', () => {
  const { course, counts } = cloneCourse(db, 'empty', { name: 'X', term: 'Y' });
  assert.strictEqual(counts.assignments, 0);
  assert.ok(course.id);
});

test('unknown source throws CourseNotFound', () => {});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL — `cloneCourse is not a function`.

- [ ] **Step 3: Implement `cloneCourse`**

Read the source course row and copy every column except `id`, `name`, `term`, `created_at`, reading column names from `PRAGMA table_info(courses)` rather than a hard-coded list — the spec requires a blocklist so a future `migrate.js` column is carried automatically. Note that this means `canvas_url` and `canvas_token` carry across; the spec leaves that to the builder and considers it defensible, but call it out in the PR so it is a visible choice rather than a side effect. Insert assignments one at a time, keeping an old-ID → new-ID map; blank `canvas_assignment_id`. Copy `materials` where `status != 'archived'`, and `examples`, remapping both through that map. One transaction.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/lib/courseLifecycle.js backend/test/courseLifecycle.clone.test.js
git commit -m "feat: add course clone"
```

---

### Task 6: Course clone and delete endpoints

**Files:**
- Modify: `backend/routes/courses.js:42` (replace the delete route), add the clone route

**Interfaces:**
- Consumes: `cloneCourse`, `deleteCourse`, `CourseDeleteBlocked`, `CourseNotFound` from Task 5/4.
- Produces: `POST /api/courses/:id/clone` → `200 {course, counts}`; `DELETE /api/courses/:id` → `200 {deleted, removed}`, `409 {error, counts}`, or `404`.

- [ ] **Step 1: Replace the delete route**

Call `deleteCourse`. Map `CourseDeleteBlocked` → `409` with `{ error, counts }`, `CourseNotFound` → `404`. The current three-line body goes away entirely.

- [ ] **Step 2: Add the clone route**

`POST /:id/clone` reads `name` and `term` from the body, rejects a missing or blank `name` with `400`, calls `cloneCourse`, and returns the new course through `parseCourse` alongside the counts.

- [ ] **Step 3: Verify by hand against the real database**

```bash
cd backend && npm start
# in another shell:
curl -X POST localhost:3000/api/courses/ain714-summer26/clone -H 'Content-Type: application/json' -d '{"name":"AIN 714","term":"Fall 2 2026"}'
curl -X DELETE localhost:3000/api/courses/ain714                                   # expect 409, per-table counts
curl -X DELETE localhost:3000/api/courses/<new clone id>                           # expect 409 too — it has assignments
curl -X DELETE localhost:3000/api/courses/258d1f09-d995-4994-9217-ad68114615a7     # expect 200 — the empty shell
curl -X DELETE localhost:3000/api/courses/nope                                     # expect 404
```

Expected: the clone reports 13 assignments and 151 examples; `ain714` and the populated clone are both refused; only the empty shell deletes; the unknown id 404s. Before and after, compare row counts across all ten tables and confirm only the single `courses` row changed.

- [ ] **Step 4: Commit**

```bash
git add backend/routes/courses.js
git commit -m "feat: add clone endpoint and guard the delete endpoint"
```

---

### Task 7: Duplicate Canvas ID warning and term in the example picker

**Files:**
- Modify: `backend/routes/assignments.js:42-62` (the `PUT` handler), `:138-150` (the library query)
- Create: `backend/test/canvasIdConflict.test.js`

**Interfaces:**
- Produces: `findCanvasIdConflict(db, assignmentId, canvasAssignmentId)` → `{ id, name, course_name, term } | null`, exported from `backend/lib/courseLifecycle.js`. The `PUT` response gains an optional `canvasIdWarning` field carrying that object.

- [ ] **Step 1: Write the failing tests**

```js
// Review Focus 1 — the one that would fire on all 13 assignments of a fresh clone
test('empty canvas id never conflicts', () => {
  assert.strictEqual(findCanvasIdConflict(db, 'a2', ''), null);
  assert.strictEqual(findCanvasIdConflict(db, 'a2', null), null);
});

test('finds a conflict on another assignment and names its term', () => {
  const c = findCanvasIdConflict(db, 'a2', '1284471');
  assert.strictEqual(c.name, 'T&E Report');
  assert.strictEqual(c.term, 'Summer 2026');
});

test('an assignment does not conflict with itself', () => {
  assert.strictEqual(findCanvasIdConflict(db, 'a1', '1284471'), null);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npm test`
Expected: FAIL.

- [ ] **Step 3: Implement `findCanvasIdConflict`**

Return `null` immediately for a null, undefined, or empty-string id — this is the clone case and must short-circuit before the query. Otherwise select the first other assignment with that `canvas_assignment_id`, joined to `courses` for `name` and `term`.

- [ ] **Step 4: Call it from the PUT handler**

After the update succeeds, call it and attach the result to the response as `canvasIdWarning` when non-null. The save always goes through; this is a warning, not a guard.

- [ ] **Step 5: Add `term` to the library query**

Add `c.term AS course_term` and `a.course_id AS source_course_id` to the SELECT at `:138-150`. Both AIN 714 courses share a name, and a clone makes a third.

- [ ] **Step 6: Run tests**

Run: `cd backend && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add backend/lib/courseLifecycle.js backend/routes/assignments.js backend/test/canvasIdConflict.test.js
git commit -m "feat: warn on duplicate Canvas assignment ids, show term in example picker"
```

---

### Task 8: Frontend — clone, real delete, and the warning

**Files:**
- Modify: `frontend/src/App.jsx:74-77` (`removeCourse`), `:215`
- Modify: `frontend/src/components/CourseSettingsTab.jsx:31-34, 46`
- Modify: `frontend/src/components/AssignmentsTab.jsx` (save handler)

**Interfaces:**
- Consumes: the three endpoints from Tasks 6 and 7.

- [ ] **Step 1: Make delete actually delete**

`removeCourse` currently only filters React state and never calls the API. Change it to `await` `DELETE /api/courses/:id`, and on `409` show the per-table counts as the reason it was refused, leaving the course in the list. Only drop it from state on a `200`.

- [ ] **Step 2: Fix the confirm copy**

The dialog at `CourseSettingsTab.jsx:32` promises *"All assignments and grades for this course will be lost."* That is now false in both directions: a course with assignments or grades cannot be deleted at all, and one that can be deleted has nothing to lose. Replace it with a plain confirmation naming the course, and disable the button entirely — with the counts as the tooltip — whenever the course is not empty.

- [ ] **Step 3: Add the clone control**

A "Clone course" button in `CourseSettingsTab` collecting `name` and `term`, posting to `/api/courses/:id/clone`, then selecting the new course. Show the returned counts on success.

- [ ] **Step 4: Surface the Canvas ID warning**

In the assignment save handler, when the response carries `canvasIdWarning`, show a non-blocking notice naming the conflicting assignment, its course, and its term. The save has already happened.

- [ ] **Step 5: Verify in the browser**

Run the app. Clone `AIN 714 Summer 2026` into a Fall 2 course and confirm 13 assignments arrive with empty Canvas IDs. Give two assignments the same Canvas ID and confirm the warning names the other one with its term. Delete the empty `258d1f09…` shell and confirm it stays gone after a reload. Confirm the delete button is disabled on both `AIN 714` and the new clone, with the counts shown as the reason.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/CourseSettingsTab.jsx frontend/src/components/AssignmentsTab.jsx
git commit -m "feat: course clone UI, working delete, duplicate Canvas id warning"
```

---

## Final verification

Run the spec's verification list end to end against the real database, in order, including the two checks the unit tests cannot cover: that the shared material files are still on disk after deleting a clone, and that each of the three graders logs a mix spanning strong and weak.
