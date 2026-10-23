# SDD ledger — plan: docs/superpowers/plans/2026-10-22-course-clone-delete.md

Spec: docs/superpowers/specs/2026-10-22-course-clone-delete-design.md (read)
Executor: inline (executing-plans), native execution chosen by Dave.

## Setup

Ruling: working on existing feature branch `scoring-consistency-rule`, not a new
worktree — `backend/data/` is git-ignored, so a worktree would have no database,
and Task 6 verifies against the real one. Not main, so the skill's consent bar is
met. Cost if wrong: the branch mixes this work with the five already-committed
in-flight commits; all of this work's commits are separable by path.

Database backed up to backend/data/platform.db.bak-20261022-195935 before Task 1.

## Pre-flight: shared interfaces

- T1 produces makeTestDb() -> T4, T5, T7 consume it for fixtures. Match.
- T2 produces selectBalanced(examples, cap) -> T3 consumes. Match; T2 is pure, no db.
- T4 produces deleteCourse/deleteBlockers/CourseDeleteBlocked/CourseNotFound
  -> T6 consumes all four. Match. T6's 409 body reads .counts, which T4 sets.
- T5 produces cloneCourse(db, sourceId, {name, term}) -> T6 consumes. Match.
- T7 produces findCanvasIdConflict -> T8 consumes via the PUT response's
  canvasIdWarning field. Match.
- Ruling: T7's Files block lists routes/assignments.js and the new test but omits
  lib/courseLifecycle.js, where its Interfaces block puts findCanvasIdConflict.
  Implementing per the Interfaces block (the function lives in the lib, the route
  calls it) — testable without Express. Cost if wrong: one file move.

## Tasks

Task 1: Ruling: brief ordered extract -> fixture -> test; reordered to test-first
  (RED on missing module confirmed) per test-driven-development. Cost if wrong: none.
Task 1: Ruling: brief's test script `--test test/` fails on Node 24/Windows
  ("Cannot find module ...\backend\test"). Using the glob `--test "test/**/*.test.js"`.
  Cost if wrong: a different discovery pattern; tests themselves unaffected.
Task 1: Ruling: grading_flags and batch_grades had no schema entry — they were
  created by side effect of requiring routes/flags.js and routes/batchgrade.js.
  Moved both CREATE TABLE statements into schema.js and removed them from the
  routes. Required because Task 4's guard counts those two tables and must work
  on any database. Cost if wrong: both are IF NOT EXISTS, so no data risk; the
  routes now depend on applySchema having run, which db.js does at import.
Task 1: extra verification beyond the brief — fresh fixture vs live platform.db:
  same 10 tables, 0 column mismatches.
Task 1: complete (commits 2c96a1c..e830309, tests: npm test --prefix backend → ℹ duration_ms 899.0107)
Task 2: complete (commits e830309..5f27fac, tests: npm test --prefix backend → ℹ duration_ms 1291.592)
Task 3: Ruling: plan left "helper formats or only selects" to the builder. Chose
  select-only, plus loadExamplesFor(db, assignmentId, cap) so the query+selection
  step is unit-testable. Formatting stays per-surface because grade.js and
  discussgrade.js word their example blocks differently, and changing the wording
  changes the prompt, hence the grades. Cost if wrong: three call sites to unify.
Task 3: measured on live data - grade.js on "Mental Model (Spring 2026)" went
  from {good:3} (no weak anchor at all) to {good:5, weak:1}.
Task 3: Note: first commit attempt nested heredocs and took the shell text as its
  message; amended to 97031f5. Code was unaffected.
Task 3: complete (commits 5f27fac..97031f5, tests: npm test --prefix backend → ℹ duration_ms 2259.2549)
Task 4: complete (commits 97031f5..027511f, tests: npm test --prefix backend → ℹ duration_ms 2802.278)
Task 5: complete (commits 027511f..72529d4, tests: npm test --prefix backend → ℹ duration_ms 2907.7364)
Task 6: Ruling: brief's step 3 verified endpoints by curling the running server,
  which writes to the real platform.db - a clone created that way is undeletable
  under the new guard, so it would leave junk Dave cannot remove. Added a DB_PATH
  env override to db.js (defaults to the real path, no behaviour change) and ran
  the server against a copy instead. Real database verified unchanged afterwards;
  the Fall 2 shell is still there for Dave to delete himself. Cost if wrong: one
  extra env var on a line that already had a hard-coded path.
Task 6: complete (commits 72529d4..e888101, tests: npm test --prefix backend → ℹ duration_ms 2921.1607)
Task 7: complete (commits e888101..96a5c62, tests: npm test --prefix backend → ℹ duration_ms 3369.9421)
Task 8: complete (commits 96a5c62..939a56d, tests: npm test --prefix backend → ℹ duration_ms 3357.9345)

## Final review (fresh reviewer, opus) — verdict: ready with fixes

Final: fixed grade.js labelling borderline examples GOOD — qualityTag tests
  (3) RED->GREEN, suite 65/65. Measured: 10 assignments / 20 slots corrected.
Final: fixed unguarded DB_PATH — dbPath.test.js (4) RED->GREEN, suite 65/65.
Final: fixed clone counts never rendered (remount unmounted the panel) —
  re-verified in the browser against a db copy; panel now visible, clone joins
  the sidebar without stealing focus. No automated test: no frontend runner.
Final: Ruling: Important 4 (a botched clone cannot be discarded — the spec's
  "delete its assignments first" workaround is false; assignment delete leaves
  the examples behind) — corrected the spec to say so and wrote up three
  options, but did NOT build options 2 or 3. Both delete rows, which is the one
  thing Dave explicitly said not to do without asking. Cost if wrong: he is
  stuck renaming a bad clone instead of removing it, until he decides.
Final: minor (deferred): findCanvasIdConflict checks the sent value, not the
  stored one (equivalent today — both UPDATE branches write it unconditionally).
Final: minor (deferred): the conflict query LIMIT 1 reports one collision when
  there may be several; Canvas ID 81230 is on five Spring assignments.
Final: minor (deferred): copyRow splices override keys into the INSERT column
  list; no injection today (only {name, term}), but the signature invites it.
Final: minor (deferred): canvas_url/canvas_token do carry to a clone; the plan
  asked for this to be called out in the PR and it is only in the commit body.
Final: minor (deferred): no test covers cloneCourse's ROLLBACK path (reviewer
  verified it by hand with a forced constraint failure; it works).
Final: minor (deferred): ORDER BY created_at DESC has no tiebreak and 236 of
  311 examples share a timestamp, so "newest of each tier" is unspecified
  among ties. Add ", id" to make it a contract.
Final: minor (deferred): a failed clone renders the raw JSON error body.
Final: minor (deferred): delete blockers are fetched once per mount and can go
  stale; the server still refuses, so this is cosmetic.
Final: minor (deferred): scripts/seed-term-calibration.js hardcodes the real
  DB path and ignores DB_PATH.
Final: minor (deferred): findCanvasIdConflict is assignment-scoped but lives in
  courseLifecycle.js.
Final: data finding (not a code defect): Canvas ID 81230 is on 5 Spring
  assignments and 665915 is on one Spring + one Summer assignment. Anti-goal 2
  is already live in the real data, independent of any clone.
