# Course clone, guarded delete, and full-band calibration

**Date:** 2026-10-22
**Status:** awaiting approval

## Intent

Dave teaches the same Wake Forest course across consecutive terms. The content
does not change between terms; only the roster and the Canvas assignment IDs do.
Today a new term means re-entering all 13 assignments by hand — name, type, max
score, rubric, rubric criteria, grading guidance, target average, strictness,
score cap. That is slow enough that he started a Fall 2 course shell
(`258d1f09-d995-4994-9217-ad68114615a7`, "AIN 715- Fall 2") and abandoned it
empty rather than fill it in.

Two things follow from that:

1. **Clone a course.** Stand up the new term from an existing one, keeping every
   assignment and its grading configuration, with no students. Then he enters the
   new Canvas assignment IDs and starts grading.
2. **Delete a course.** Remove the abandoned shell. There is currently no way to
   do this from the UI, so mistakes are permanent.

Separately, and raised in the same conversation: the grader should weigh new work
against the **entire** calibration band, strong and weak, rather than a thin or
lopsided slice of it. The bank holds 311 examples (209 good, 70 weak, 32
borderline) and two of the three graders underuse it.

## Why now

Fall 2 2026 starts and the shell is empty. The manual path is the blocker.

## Goals

- Clone a course and its full assignment configuration in one action.
- Delete an **empty** course from the UI — one row, nothing else.
- Make every grading surface draw on a balanced spread of calibration examples.

## Non-goals

- Deleting anything other than an empty `courses` row. No cascade, in any form.
  A course holding data of any kind is not deletable through this feature.
- Merging two prior terms' calibration banks during clone. The existing
  `/examples/library` picker and `scripts/seed-term-calibration.js` already cover
  this, and clone makes them work better by preserving assignment names exactly.

  One small fix is in scope to keep that true: the picker's query
  (`assignments.js:138-150`) returns `course_name` and `course_full_name` but not
  `term`, and both AIN 714 courses are named "AIN 714". A clone makes a third,
  with verbatim-identical assignment names, so the picker becomes unusable
  exactly when it is most needed. Add `c.term` (and the source course id) to that
  SELECT and show the term in the picker. Two lines of SQL and a label.
- Canvas-side provisioning. Dave enters the new Canvas assignment IDs himself.
- Changing how examples are authored, scored, or curated.

## Anti-goals

These would make the feature a failure even if it technically worked:

- **Silent data loss.** A delete that strands or removes student records. Dave's
  words: "I could make a mistake and then never be able to delete it. I would
  have all these students that I can't use."
- **A clone that points at the wrong Canvas records.** If
  `canvas_assignment_id` carried over, Fall 2 would silently read and write
  Summer's Canvas data. This is the single most dangerous field in the copy and
  the hardest mistake to notice.
- **A clone that looks complete but grades differently from its source**, because
  some grading-relevant column was missed.

## Current state

### Schema

Ten tables. Nine carry a `course_id`. There are no foreign-key constraints, so
nothing in the database prevents orphans.

| Table | Rows | Links |
|---|---|---|
| `courses` | 4 | — |
| `assignments` | 33 | `course_id` |
| `students` | 158 | `course_id` |
| `grades` | 1545 | `course_id`, `assignment_id`, `student_id` |
| `examples` | 311 | `course_id`, `assignment_id` |
| `discussions` | 156 | `course_id` |
| `materials` | 4 | `course_id`, `assignment_id` |
| `always_on` | 30 | `course_id`, `assignment_id`, `student_id` |
| `grading_flags` | 10 | `course_id`, `assignment_id` |
| `batch_grades` | 0 | `course_id`, `assignment_id` |

Per course today:

| Course | students | grades | assignments | examples | discussions |
|---|---|---|---|---|---|
| AIN 714 Spring 2026 (`ain714`) | 65 | 746 | 13 | 134 | 151 |
| AIN 714 Summer 2026 (`ain714-summer26`) | 71 | 778 | 13 | 151 | 2 |
| GEOG 661 Spring 2026 (`geog661`) | 21 | 21 | 7 | 26 | 3 |
| AIN 715- Fall 2 (`258d1f09…`) | 0 | 0 | 0 | 0 | 0 |

No course has grades without students.

### Delete, as it exists

`DELETE /api/courses/:id` ([backend/routes/courses.js:42](../../../backend/routes/courses.js)) drops only the
`courses` row:

```js
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM courses WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});
```

Called on `ain714` it would strand 65 students, 746 grades, 151 discussions, and
134 examples as unreachable orphans.

**It is also never called.** A "Delete course" button already exists in
`CourseSettingsTab.jsx:46`, behind a `confirm()` reading *"All assignments and
grades for this course will be lost."* It calls `onDelete` →
`CourseShell.jsx:183` → `App.jsx:215` → `removeCourse(id)`, which is:

```js
function removeCourse(id) {
  setCourses(c => c.filter(x => x.id !== id));
  setActiveCourse(courses.find(c => c.id !== id)?.id || null);
}
```

React state only. No HTTP request. The course vanishes from the sidebar and
returns on the next reload. So the current state is a button that warns about
destruction it does not perform, in front of an endpoint that would perform the
wrong destruction if it were ever wired up. This work must fix both halves, and
the existing `confirm()` copy must stop promising to delete grades — under the
new guard, a course with grades can never be deleted at all.

### Calibration selection, as it exists

| Surface | File | Selection |
|---|---|---|
| Discussion grader (Canvas panel) | `routes/discussgrade.js:183` | Round-robin across good → borderline → weak, cap 6 |
| Main grader | `routes/grade.js:471` | `ORDER BY created_at DESC LIMIT 3` |
| Batch grader | `routes/batchgrade.js` | None — examples are never loaded |

`discussgrade.js` carries a comment explaining the round-robin: recency-only
selection "anchors the model high and undoes strict grading." The main grader
never received that fix.

The bank is skewed per assignment, so this matters concretely. *The Prompt
Engineer's Workflow (Summer 2026)* is 1 good / 19 other; *My "Emerging AI" Mental
Model (Spring 2026)* is 19 good / 1 other. Three-newest on either one hands the
model a one-sided anchor.

Examples are keyed by `assignment_id`, so a freshly created assignment has none.

## Design

### 1. Clone a course

A new endpoint, `POST /api/courses/:id/clone`, taking the new course's `name`,
`term`, and any other course-level fields the form collects. It runs in a single
transaction.

**Copies:**

- The `courses` row, as **copy-all-minus-a-blocklist**, not as an enumeration.
  Block `id`, `name`, `term`, `created_at`; copy every other column whatever it
  is. Today that means `full_name`, `institution`, `color`, `color_dark`,
  `color_faint`, `instructor_bio`, `voice_guidelines`,
  `discussion_default_question`, `sliders`, `do_not_penalize`, `grading_model`,
  and `response_defaults`. New `id`; `name` and `term` come from the request.

  The blocklist shape is deliberate: anti-goal 3 is a clone that grades
  differently because a column was missed, and an enumeration silently drops the
  next column `migrate.js` adds. Note that `PUT /api/courses/:id` does not
  currently persist `grading_model` or `response_defaults`, so copying them is a
  no-op today — that save bug is **out of scope here**, but the blocklist means
  the clone starts working correctly the day it is fixed.
- Every `assignments` row: `name`, `type`, `max_score`, `display_order`,
  `description`, `rubric`, `rubric_criteria`, `target_avg`,
  `grading_strictness`, `grading_guidance`, `score_cap`. New `id` per row.
- Every **active** `materials` row, remapped to the new course and, where set,
  the new assignment ID. `materials.js:133` soft-deletes by setting
  `status='archived'` rather than removing the row, so an unfiltered copy would
  resurrect material Dave had already thrown away. The DB currently holds 2
  active and 2 archived rows; a clone should carry 2.

  The copied row reuses the source's `file_path` — the file on disk is shared,
  not duplicated. This matters for delete (below).
- Every `examples` row, remapped to the new course and new assignment ID.

**Blanks:**

- `canvas_assignment_id` on every cloned assignment. Always empty, never copied.
  See anti-goals.
- `canvas_url` / `canvas_token` on the course are a judgment call for the
  builder; they are course-level credentials rather than per-term records, so
  copying them is defensible. Flag the choice in the PR.

**Skips entirely:** `students`, `grades`, `discussions`, `always_on`,
`grading_flags`, `batch_grades`.

**Calibration carry-forward.** Examples are copied at clone time, not read
through a lineage link at grade time. This was Dave's choice between the two
options. It matches what `scripts/seed-term-calibration.js` and
`POST /api/assignments/:id/examples/copy` already do, and because clone holds the
exact old-ID → new-ID mapping, the copy is precise — no base-name matching, no
`OVERRIDES` list. Cloning Summer gives Fall 2 all 151 of Summer's examples.

If Dave later wants Spring's examples in Fall 2 as well, the existing seed script
covers it (`--from ain714 --to <fall2-id> --apply`), and it will match more
reliably than before because clone preserved the assignment names verbatim.

The clone response should report what it created — counts of assignments,
materials, and examples — so the result is verifiable without opening the
database.

### 2. Guarded delete

Delete is **refused** when a course holds irreplaceable student data, rather than
cascading through it. Dave only needs to remove shells and botched clones;
protecting the real courses matters more than being able to delete them.

**Delete removes exactly one row, and only from a course that is already
empty. It never deletes data of any kind.**

**Precondition:** the course has zero rows in **every** table that links to it —
`students`, `grades`, `discussions`, `batch_grades`, `assignments`, `materials`,
`examples`, `always_on`, `grading_flags`. If any one of them is non-zero,
respond `409` with the per-table counts and change nothing.

**When the precondition holds,** delete the `courses` row. That is the entire
operation. There is no cascade, because a course that passes this check has
nothing to cascade to.

This is narrower than a cascade design and deliberately so. Dave's requirement:
*"literally all I want to do is have something that allows me to delete where I
added a course… there is no data in it. You should not delete anything with data
in it."* A guard that permits a delete only when there is nothing to delete makes
the destructive case unreachable by construction rather than by careful
bookkeeping, and it needs no transaction, no file handling, and no judgment about
which tables count as "real" data.

The `258d1f09…` Fall 2 shell is zero across all nine tables, so it qualifies.

**Known consequence — and the workaround does not currently exist.** A clone
that came out wrong is **not** deletable: it holds 13 assignments and ~151
carried examples.

An earlier draft of this document said to "delete its assignments first, which
empties `examples` with them." That is false. `DELETE /api/assignments/:id`
(`routes/assignments.js:74`) removes only the `assignments` row; the examples
keep their `course_id` and become unreachable rows that still block the
delete. The only working path today is removing examples one at a time through
`DELETE /:id/examples/:exId` — 151 clicks — or editing the database by hand.

So the honest position is: **a botched clone cannot be removed through the
app.** Clone makes bad clones cheap to create and the guard makes them
impossible to discard, which is a gap worth closing deliberately rather than
by accident. Three options, cheapest first:

1. Leave it. Rename the bad clone and reuse it instead of discarding. No code,
   no new destructive path.
2. Make `DELETE /api/assignments/:id` remove that assignment's examples. They
   are the assignment's own data, not student work — but it is a new
   destructive path and needs its own guard and tests.
3. A narrow "discard clone" permitted only when `students`, `grades`,
   `discussions`, `always_on`, `grading_flags` and `batch_grades` are all
   zero — i.e. a course that has never been used for anything real.

Options 2 and 3 both delete rows, which is the thing this feature was
explicitly built not to do. Neither is in scope without the instructor's
decision.

**Delete never touches files on disk.** It cannot: a course with materials has
a non-empty `materials` table and is therefore not deletable at all. Worth
stating because cloned `materials` rows reuse the source's `file_path`, so any
future change that did unlink files would destroy the source term's materials.

**UI:** a delete control on the course, disabled whenever any linked table is
non-empty, with the counts shown as the reason. When it is enabled there is
nothing to warn about — the course is empty — so a simple confirm naming the
course is enough. No typed confirmation: the destructive case is unreachable by
construction.

### 2b. Duplicate Canvas assignment ID warning

Blanking `canvas_assignment_id` on clone prevents the copy but not the
collision. Dave types 13 new Canvas IDs by hand into assignments whose names are
identical to the source term's, and nothing validates them. The extension
resolves via `GET /api/assignments?canvas_assignment_id=…` and takes
`assignments[0]` (`canvas-grader-extension/content.js:33-50`), while
`assignments.js:12` orders only by `display_order` — so a duplicate resolves
arbitrarily and Fall 2 silently grades against Summer's Canvas record. That is
anti-goal 2, reached by typo instead of by the clone.

On saving an assignment whose `canvas_assignment_id` already exists on another
assignment, **warn and allow the save**. The warning names the conflicting
assignment and its course and term. Non-blocking by choice: a hard refusal would
also block legitimate cases, and the realistic failure here is a typo Dave wants
pointed out, not an invariant the database needs to enforce.

### 3. Full-band calibration selection

Lift the balanced selection out of `discussgrade.js` into one shared helper —
`backend/lib/` already exists for this kind of thing, alongside `textVoice.js` —
and use it on all three grading surfaces.

The helper takes a pool of examples and a cap, groups by `quality`, and
round-robins across the tiers present so the model always sees both ends of the
band. `discussgrade.js` keeps its current behaviour; it just calls the shared
version.

- **`grade.js:471`** — replace `ORDER BY created_at DESC LIMIT 3` with the full
  pool plus the helper. Cap 6, matching the discussion grader.
- **`batchgrade.js`** — load examples for the assignment and inject them. This
  surface currently sends none. Cap **3**, not 6: batch runs once per student,
  so a 71-student class multiplies the example block 71 times. Three still spans
  strong and weak via the round-robin; six doubles that cost for a second
  reference point per tier.

  Also delete the dead `consistencyNote` scrub at `batchgrade.js:233` — the
  prompt scrubs a field it never asks the model to produce, because the rule
  blocks that generate it (`SCORING_RUBRIC_FIDELITY_RULE`,
  `SCORING_CONSISTENCY_RULE_BANDED`) were wired into `grade.js` and
  `discussgrade.js` but not here.

  **Bringing batch grading to full rule parity is out of scope for this
  document.** It is a behaviour change — batch grades would start carrying
  review flags, and the batch UI has no equivalent of the `result.flags` channel
  `discussgrade.js:672-675` uses to surface them. It is already tracked as a
  separate piece of work alongside the score-cap and strictness gaps on the same
  surface. Here, batch gets examples and loses the dead scrub; nothing else.

Keep the existing `[discussgrade] calibration examples injected: N of M`
diagnostic log and add the equivalent on the other two surfaces, so a skewed or
empty bank is visible without a debugger.

## Constraints

- Node + Express + `node:sqlite` (`--experimental-sqlite`), React frontend. No
  new dependencies for this work.
- No foreign keys in the schema; referential integrity is the application's job.
  Every multi-table write here runs in a transaction.
- The backend has no test script. Verification is manual plus a dry-run mode
  where practical.
- `backend/lib/` is currently **untracked in git** and is required by six files.
  It must be `git add`-ed before any of this ships, or the shared helper will be
  missing on a fresh clone. This is a pre-existing problem, not one this work
  introduces, but this work makes it worse.

## Left to the builder

- Endpoint and payload shapes beyond what is specified above.
- Where the clone and delete controls live in the UI, and what the clone form
  collects beyond name and term.
- Whether `canvas_url` / `canvas_token` carry across a clone.
- Whether the shared selection helper also handles the string-building, or only
  picks the examples and lets each caller format them. The three surfaces format
  differently today.
- How the clone reports its result to the UI.

## Verification

Manual, in this order:

1. Clone `ain714-summer26` to a new Fall 2 course. Confirm 13 assignments, every
   grading field matching the source, **every `canvas_assignment_id` empty**, 151
   examples carried, and zero students and grades.
2. Delete the abandoned `258d1f09…` shell. Confirm it disappears and stays gone
   after a reload.
3. Attempt to delete `ain714`. Confirm it is refused with the per-table counts,
   and that **every row count in the database is unchanged** — students, grades,
   assignments, examples, discussions, materials.
4. Attempt to delete the test clone from step 1. Confirm it is **also refused**,
   on its assignment and example counts, and that nothing is removed.
5. Give two assignments the same Canvas ID. Confirm the warning names the other
   assignment with its course and term, and that the save still goes through.
6. Grade one submission on each of the three surfaces. Confirm from the
   diagnostic logs that each injected a mix spanning strong and weak.
