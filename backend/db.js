const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'platform.db');

// Ensure data dir exists
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// ─── Schema ────────────────────────────────────────────────────────────────

db.exec(`
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
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT DEFAULT 'lab',
  max_score REAL DEFAULT 6,
  display_order INTEGER DEFAULT 99,
  description TEXT,
  rubric TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS examples (
  id TEXT PRIMARY KEY,
  assignment_id TEXT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
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
  course_id TEXT REFERENCES courses(id),
  assignment_id TEXT REFERENCES assignments(id),
  student_id TEXT REFERENCES students(id),
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
  graded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discussions (
  id TEXT PRIMARY KEY,
  course_id TEXT REFERENCES courses(id),
  question TEXT,
  student_name TEXT,
  student_response TEXT,
  instructor_reply TEXT,
  sentence_count INTEGER,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materials (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  week_number INTEGER,
  assignment_id TEXT REFERENCES assignments(id),
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
  grade_id TEXT REFERENCES grades(id) ON DELETE CASCADE,
  student_id TEXT REFERENCES students(id),
  student_name TEXT,
  course_id TEXT REFERENCES courses(id),
  assignment_id TEXT REFERENCES assignments(id),
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
CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id);
CREATE INDEX IF NOT EXISTS idx_always_on_status ON always_on(status);
CREATE INDEX IF NOT EXISTS idx_always_on_course ON always_on(course_id);
CREATE INDEX IF NOT EXISTS idx_materials_course ON materials(course_id);
CREATE INDEX IF NOT EXISTS idx_examples_assignment ON examples(assignment_id);
`);

// ─── Seed default courses if empty ────────────────────────────────────────

const courseCount = db.prepare('SELECT COUNT(*) as n FROM courses').get();
if (courseCount.n === 0) {
  const insert = db.prepare(`
    INSERT INTO courses (id, name, full_name, institution, term, color, color_dark, color_faint, instructor_bio, voice_guidelines, discussion_default_question, sliders)
    VALUES (@id, @name, @full_name, @institution, @term, @color, @color_dark, @color_faint, @instructor_bio, @voice_guidelines, @discussion_default_question, @sliders)
  `);

  insert.run({
    id: 'geog661',
    name: 'GEOG 661',
    full_name: 'Fundamentals of Geospatial Intelligence',
    institution: 'University of Maryland',
    term: 'Spring 2026',
    color: '#E21833',
    color_dark: '#b8001f',
    color_faint: 'rgba(226,24,51,0.12)',
    instructor_bio: 'Graduate-level instructor teaching Fundamentals of Geospatial Intelligence at the University of Maryland.',
    voice_guidelines: 'Casual, direct, warm, and real. Not stiff or academic. Sharp mentor who genuinely enjoys their students. Conversational, encouraging, occasionally playful, and always specific.',
    discussion_default_question: `Hi folks!\n\nI hope everyone is excited about the upcoming class this Monday. I wanted to kick off our first discussion with three questions.\n\n(1) What are your top two goals for this class?\n(2) Why are you interested in GEOINT?\n(3) What is the most interesting, recent application of GEOINT you have seen?\n\nAs I mentioned in the syllabus, there are no wrong answers here. I'm interested in what and how you think.`,
    sliders: JSON.stringify({ clarity: 3, logic: 3, structure: 3, tone: 3, style: 3 })
  });

  insert.run({
    id: 'ain714',
    name: 'AIN 714',
    full_name: 'AI Strategy & Innovation',
    institution: 'Wake Forest University',
    term: 'Spring 2026',
    color: '#CFB53B',
    color_dark: '#a08a1a',
    color_faint: 'rgba(207,181,59,0.12)',
    instructor_bio: `Dave Cook is a technology leader with over 30 years of experience in data, advanced analytics, and artificial intelligence. He currently supports AI/ML programs across the U.S. Intelligence Community and the Department of Defense and teaches AI at the University of Maryland and Wake Forest University. He is the Chief Innovation Officer for Cornerstone Defense and co-founded the Training Data Project (TDP) in 2023 to advance AI Value Science. A 19-time Marine Corps Marathon finisher, he views AI as a marathon, not a sprint. Dave serves on DC Mayor Muriel Bowser's AI Advisory Group and holds degrees from Northwestern University, Carnegie Mellon University, and the University of Maryland.`,
    voice_guidelines: 'Casual, direct, warm, and real. Sharp, experienced mentor with real-world practitioner credibility. Conversational, encouraging, occasionally playful, always specific. Connect student ideas to real-world AI practice and strategy.',
    discussion_default_question: `Welcome to AIN 714! Please introduce yourself and share your thoughts on the following:\n\n(1) What are your top two goals for this course?\n(2) Why are you interested in AI Strategy and Innovation?\n(3) What is the most interesting recent application of AI you have seen in your field or industry?\n\nThere are no wrong answers. I am interested in what and how you think.`,
    sliders: JSON.stringify({ clarity: 3, logic: 3, structure: 3, tone: 3, style: 3 })
  });

  // Seed GEOG 661 labs
  const insertAssign = db.prepare(`
    INSERT INTO assignments (id, course_id, name, type, max_score, display_order, description, rubric)
    VALUES (@id, @course_id, @name, @type, @max_score, @display_order, @description, @rubric)
  `);

  const lab1Rubric = `ANNOTATED PRODUCT (2 pts):
2 = Key features identified and labeled. Legend present. Neatline present. Color choices logical and accessible. Decision-maker understands in 30 seconds.
1 = Some features labeled but incomplete. Legend missing. Colors unexplained or decorative.
0 = No meaningful annotation or product missing.

NARRATIVE (2 pts):
2 = All 5 Ws addressed. Factual third-person. BLUF opening with explicit significance. Each sentence one idea. 6-8 sentences. Significance stated not implied.
1 = 3-4 Ws addressed. Minor first-person use. Significance implied or buried. Some verbose sentences.
0 = Fewer than 3 Ws. Consistently informal. Narrative essentially absent.

CONTEXT (1 pt):
1 = Research adds genuine insight beyond caption. Two or more credible sources cited.
0.5 = Superficial, Wikipedia-only, or sources missing.
0 = No context or no citations.

OVERALL QUALITY (1 pt):
1 = Professional, no spelling/grammar errors, complete, well-organized.
0.5 = Minor errors that do not impede understanding.
0 = Multiple errors, disorganized, or rushed.`;

  const lab1Desc = `GEOG 661 Lab 1: Observing and Communicating Geospatial Intelligence\nTotal Points: 6\n\nStudents choose one of six provided images, create an annotated product highlighting key observations, and write a short narrative explaining findings to a decision-maker.\n\nParts:\n1. Study image (answer: What, Where, When, Who, Why it matters)\n2. Create annotated product (single slide with shapes, labels, overlays, legend)\n3. Write narrative (6-8 sentences, factual, professional, third-person)\n4. Provide context with citations (1-2 paragraphs)`;

  for (let n = 1; n <= 6; n++) {
    insertAssign.run({
      id: `geog661-lab${n}`,
      course_id: 'geog661',
      name: `Lab ${n}`,
      type: 'lab',
      max_score: 6,
      display_order: n,
      description: n === 1 ? lab1Desc : '',
      rubric: n === 1 ? lab1Rubric : ''
    });
  }

  insertAssign.run({
    id: 'ain714-disc1',
    course_id: 'ain714',
    name: 'Discussion 1',
    type: 'discussion',
    max_score: 10,
    display_order: 1,
    description: '',
    rubric: ''
  });
}

// ─── Helper to parse course row ────────────────────────────────────────────

function parseCourse(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    fullName: row.full_name,
    institution: row.institution,
    term: row.term,
    color: row.color,
    colorDark: row.color_dark,
    colorFaint: row.color_faint,
    instructorBio: row.instructor_bio,
    voiceGuidelines: row.voice_guidelines,
    discussionDefaultQuestion: row.discussion_default_question,
    sliders: JSON.parse(row.sliders || '{"clarity":3,"logic":3,"structure":3,"tone":3,"style":3}'),
    createdAt: row.created_at
  };
}

function parseAssignment(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    name: row.name,
    type: row.type,
    maxScore: row.max_score,
    order: row.display_order,
    description: row.description,
    rubric: row.rubric,
    createdAt: row.created_at
  };
}

function parseGrade(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    assignmentId: row.assignment_id,
    studentId: row.student_id,
    studentName: row.student_name,
    assignmentName: row.assignment_name,
    fileName: row.file_name,
    total: row.total,
    maxScore: row.max_score,
    scores: JSON.parse(row.scores || '{}'),
    comments: JSON.parse(row.comments || '{}'),
    summary: row.summary,
    key_strength: row.key_strength,
    key_improvement: row.key_improvement,
    gradedAt: row.graded_at
  };
}

function parseMaterial(row) {
  if (!row) return null;
  return {
    id: row.id,
    courseId: row.course_id,
    name: row.name,
    type: row.type,
    weekNumber: row.week_number,
    assignmentId: row.assignment_id,
    filePath: row.file_path,
    url: row.url,
    extractedText: row.extracted_text,
    fileSize: row.file_size,
    status: row.status,
    version: row.version,
    uploadedAt: row.uploaded_at
  };
}

function parseAlwaysOn(row) {
  if (!row) return null;
  return {
    id: row.id,
    gradeId: row.grade_id,
    studentId: row.student_id,
    studentName: row.student_name,
    courseId: row.course_id,
    assignmentId: row.assignment_id,
    assignmentName: row.assignment_name,
    weakArea: row.weak_area,
    feedbackSentences: row.feedback_sentences,
    links: JSON.parse(row.links || '[]'),
    status: row.status,
    reviewedAt: row.reviewed_at,
    reviewNotes: row.review_notes,
    createdAt: row.created_at
  };
}

module.exports = { db, parseCourse, parseAssignment, parseGrade, parseMaterial, parseAlwaysOn };
