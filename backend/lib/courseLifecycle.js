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

module.exports = {
  LINKED_TABLES,
  deleteBlockers,
  deleteCourse,
  CourseNotFound,
  CourseDeleteBlocked,
};
