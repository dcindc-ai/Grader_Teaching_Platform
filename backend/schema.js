// Database schema, extracted from db.js so tests can build an in-memory
// database with the same tables the real one has. The SQL is unchanged.
//
// Column ADDITIONS live in migrate.js, not here: applySchema() creates the
// original tables, migrate() brings them up to date. Anything building a
// database from scratch must run both, in that order.

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS courses (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  full_name TEXT,
  institution TEXT,
  term TEXT,
  color TEXT DEFAULT '#4f8ef7',
  color_dark TEXT,
  color_faint TEXT,
  instructor_bio TEXT,
  voice_guidelines TEXT,
  discussion_default_question TEXT,
  sliders TEXT DEFAULT '{"clarity":3,"logic":3,"structure":3,"tone":3,"style":3}',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'lab',
  max_score REAL DEFAULT 6,
  display_order INTEGER DEFAULT 99,
  description TEXT,
  rubric TEXT,
  rubric_criteria TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS examples (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL,
  course_id TEXT,
  student_name TEXT,
  score REAL,
  quality TEXT DEFAULT 'good',
  notes TEXT,
  content TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grades (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  assignment_id TEXT,
  student_id TEXT,
  student_name TEXT,
  assignment_name TEXT,
  file_name TEXT,
  total REAL,
  max_score REAL DEFAULT 6,
  scores TEXT,
  comments TEXT,
  summary TEXT,
  key_strength TEXT,
  key_improvement TEXT,
  instructor_paragraph TEXT,
  graded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  course_id TEXT,
  question TEXT,
  student_name TEXT,
  student_response TEXT,
  instructor_reply TEXT,
  sentence_count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  week_number INTEGER,
  assignment_id TEXT,
  file_path TEXT,
  url TEXT,
  extracted_text TEXT,
  file_size INTEGER,
  status TEXT DEFAULT 'active',
  version INTEGER DEFAULT 1,
  uploaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS always_on (
  id TEXT PRIMARY KEY,
  grade_id TEXT,
  student_id TEXT,
  student_name TEXT,
  course_id TEXT,
  assignment_id TEXT,
  assignment_name TEXT,
  weak_area TEXT,
  feedback_sentences TEXT,
  links TEXT,
  status TEXT DEFAULT 'pending',
  reviewed_at TEXT,
  review_notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_grades_course ON grades(course_id);
CREATE INDEX IF NOT EXISTS idx_grades_assignment ON grades(assignment_id);
CREATE INDEX IF NOT EXISTS idx_always_on_status ON always_on(status);
CREATE INDEX IF NOT EXISTS idx_always_on_course ON always_on(course_id);
CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);
CREATE INDEX IF NOT EXISTS idx_examples_assignment ON examples(assignment_id);

CREATE TABLE IF NOT EXISTS grading_flags (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade_id TEXT,
  flag_type TEXT NOT NULL,
  criterion_name TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS batch_grades (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  canvas_user_id TEXT,
  status TEXT DEFAULT 'pending',
  submission_text TEXT,
  criteria_grades TEXT,
  instructor_paragraph TEXT,
  total_points REAL,
  max_score REAL,
  error TEXT,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);
`;

function applySchema(db) {
  db.exec(SCHEMA_SQL);
}

module.exports = { SCHEMA_SQL, applySchema };
