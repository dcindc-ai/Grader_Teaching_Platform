// Creating and removing whole courses.
//
// Delete is deliberately the narrowest operation in this file: it removes one
// `courses` row, and only from a course that already holds nothing. It never
// cascades and never touches the filesystem.
//
// The reasoning, from the design: a guard that permits a delete only when
// there is nothing to delete makes the destructive case unreachable by
// construction, rather than by careful bookkeeping that a later change could
// get wrong. The cost is that a clone you want to discard is not deletable
// until its assignments are gone. That trade was made on purpose.

const { randomUUID } = require('node:crypto');

// Every table carrying a course_id. All nine are guarded; none is cascaded.
// There is a test asserting this list matches the schema, so a table added
// later cannot quietly fall outside the guard.
const LINKED_TABLES = [
  'assignments',
  'students',
  'grades',
  'examples',
  'discussions',
  'materials',
  'always_on',
  'grading_flags',
  'batch_grades',
];

class CourseNotFound extends Error {
  constructor(courseId) {
    super(`Course not found: ${courseId}`);
    this.name = 'CourseNotFound';
    this.courseId = courseId;
  }
}

class CourseDeleteBlocked extends Error {
  constructor(courseId, counts) {
    const summary = Object.entries(counts).map(([t, n]) => `${n} ${t}`).join(', ');
    super(`Course ${courseId} still holds ${summary}`);
    this.name = 'CourseDeleteBlocked';
    this.courseId = courseId;
    this.counts = counts;
  }
}

function requireCourse(db, courseId) {
  const row = db.prepare('SELECT id FROM courses WHERE id=?').get(courseId);
  if (!row) throw new CourseNotFound(courseId);
  return row;
}

/**
 * Count what a course still holds, per table. Returns only the non-empty ones,
 * so `{}` means the course is empty and safe to delete.
 */
function deleteBlockers(db, courseId) {
  requireCourse(db, courseId);
  const counts = {};
  for (const table of LINKED_TABLES) {
    const { n } = db.prepare(`SELECT COUNT(*) n FROM ${table} WHERE course_id=?`).get(courseId);
    if (n > 0) counts[table] = n;
  }
  return counts;
}

/**
 * Delete an empty course. Throws CourseNotFound for an unknown id, or
 * CourseDeleteBlocked (carrying the per-table counts) when the course holds
 * anything at all.
 *
 * One statement, one table. No transaction is needed and no cascade exists:
 * if this function ever deletes from a table other than `courses`, that is a
 * bug, not a feature.
 */
function deleteCourse(db, courseId) {
  requireCourse(db, courseId);
  const counts = deleteBlockers(db, courseId);
  if (Object.keys(counts).length > 0) throw new CourseDeleteBlocked(courseId, counts);

  db.prepare('DELETE FROM courses WHERE id=?').run(courseId);
  return { deleted: true };
}

// Course columns the clone must NOT carry over. Everything else is copied by
// reading PRAGMA table_info at run time, rather than from a hard-coded list:
// the design's anti-goal is "a clone that grades differently because some
// grading-relevant column was missed", and an enumeration silently drops
// whatever column migrate.js adds next.
const COURSE_BLOCKLIST = new Set(['id', 'name', 'term', 'created_at']);

// Assignment columns handled explicitly rather than copied.
//   canvas_assignment_id — always blanked. Carrying it would point the new
//   term at the old term's Canvas records, which is the most dangerous
//   mistake available here and the hardest to notice.
const ASSIGNMENT_BLOCKLIST = new Set(['id', 'course_id', 'created_at', 'canvas_assignment_id']);

function columnsOf(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

// Copy one row into `table` under a new id, overriding whatever `overrides`
// names and skipping `blocklist`. Returns the new id.
function copyRow(db, table, row, blocklist, overrides) {
  const cols = columnsOf(db, table).filter(c => !blocklist.has(c));
  const names = ['id', ...cols, ...Object.keys(overrides).filter(k => !cols.includes(k))];
  const id = randomUUID();
  const values = names.map(n => (n === 'id' ? id : (n in overrides ? overrides[n] : row[n])));
  db.prepare(
    `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`
  ).run(...values);
  return id;
}

/**
 * Clone a course into a new term.
 *
 * Copies the course row, its assignments and their grading configuration, its
 * active materials, and its calibration examples. Deliberately does not copy
 * students, grades, discussions, always-on items, flags, or batch grades: the
 * new term starts with an empty roster.
 *
 * Because the clone holds the exact old-id -> new-id mapping, examples and
 * materials are remapped precisely. The name-matching heuristic in
 * scripts/seed-term-calibration.js exists only because terms used to be
 * created by hand; it is not needed for a course made this way.
 *
 * Returns { course, counts: { assignments, materials, examples } }.
 */
function cloneCourse(db, sourceCourseId, { name, term, ...overrides } = {}) {
  const source = db.prepare('SELECT * FROM courses WHERE id=?').get(sourceCourseId);
  if (!source) throw new CourseNotFound(sourceCourseId);

  const counts = { assignments: 0, materials: 0, examples: 0 };
  db.exec('BEGIN');
  try {
    const courseId = copyRow(db, 'courses', source, COURSE_BLOCKLIST, {
      name: name ?? source.name,
      term: term ?? '',
      ...overrides,
    });

    // old assignment id -> new assignment id, so examples and materials land
    // on the right counterpart without matching on names.
    const assignmentMap = new Map();
    for (const a of db.prepare('SELECT * FROM assignments WHERE course_id=? ORDER BY display_order').all(sourceCourseId)) {
      const newId = copyRow(db, 'assignments', a, ASSIGNMENT_BLOCKLIST, {
        course_id: courseId,
        canvas_assignment_id: '',
      });
      assignmentMap.set(a.id, newId);
      counts.assignments++;
    }

    // COALESCE, not `status != 'archived'`: a NULL status would make that
    // comparison NULL and silently drop the row. The column defaults to
    // 'active', so NULL means active here too.
    const materials = db
      .prepare("SELECT * FROM materials WHERE course_id=? AND COALESCE(status,'active') != 'archived'")
      .all(sourceCourseId);
    for (const m of materials) {
      copyRow(db, 'materials', m, new Set(['id', 'course_id', 'assignment_id', 'uploaded_at']), {
        course_id: courseId,
        assignment_id: m.assignment_id ? (assignmentMap.get(m.assignment_id) ?? null) : m.assignment_id,
      });
      counts.materials++;
    }

    for (const [oldId, newId] of assignmentMap) {
      for (const e of db.prepare('SELECT * FROM examples WHERE assignment_id=?').all(oldId)) {
        copyRow(db, 'examples', e, new Set(['id', 'assignment_id', 'course_id', 'created_at']), {
          assignment_id: newId,
          course_id: courseId,
        });
        counts.examples++;
      }
    }

    db.exec('COMMIT');
    return { course: db.prepare('SELECT * FROM courses WHERE id=?').get(courseId), counts };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * Find another assignment already using this Canvas assignment id.
 *
 * Blanking canvas_assignment_id on clone stops the id being copied, but not a
 * duplicate typed in by hand afterwards — and a clone leaves thirteen
 * identically named assignments waiting for ids. A duplicate is not harmless:
 * the Canvas extension resolves by id and takes the first row, ordered only by
 * display_order, so the new term would silently grade against the old term's
 * Canvas record.
 *
 * Returns the conflicting assignment with its course name and term, or null.
 * This is advisory — the caller warns and still saves. A hard refusal would
 * also block legitimate cases, and the realistic failure here is a typo worth
 * pointing out, not an invariant the database needs to enforce.
 */
function findCanvasIdConflict(db, assignmentId, canvasAssignmentId) {
  // Every cloned assignment starts blank. Short-circuit before the query, or
  // the first save after a clone reports a conflict with all its siblings.
  const id = canvasAssignmentId == null ? '' : String(canvasAssignmentId).trim();
  if (id === '') return null;

  return db.prepare(`
    SELECT a.id, a.name, a.canvas_assignment_id,
           c.name AS course_name, c.term AS term
    FROM assignments a
    LEFT JOIN courses c ON c.id = a.course_id
    WHERE TRIM(a.canvas_assignment_id) = ? AND a.id != ?
    LIMIT 1
  `).get(id, assignmentId) || null;
}

module.exports = {
  LINKED_TABLES,
  deleteBlockers,
  deleteCourse,
  cloneCourse,
  findCanvasIdConflict,
  CourseNotFound,
  CourseDeleteBlocked,
};
