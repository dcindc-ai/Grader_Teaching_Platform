const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'platform.db');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and foreign keys
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

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
`);

// ─── Seed default courses if empty ────────────────────────────────────────

const courseCount = db.prepare('SELECT COUNT(*) as n FROM courses').get();
if (courseCount.n === 0) {
  const insertCourse = db.prepare(`
    INSERT INTO courses (id,name,full_name,institution,term,color,color_dark,color_faint,instructor_bio,voice_guidelines,discussion_default_question,sliders)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `);

  insertCourse.run(
    'geog661','GEOG 661','Fundamentals of Geospatial Intelligence',
    'University of Maryland','Spring 2026','#E21833','#b8001f','rgba(226,24,51,0.12)',
    'Graduate-level instructor teaching Fundamentals of Geospatial Intelligence at the University of Maryland.',
    'Casual, direct, warm, and real. Not stiff or academic. Sharp mentor who genuinely enjoys their students. Conversational, encouraging, occasionally playful, and always specific.',
    'Hi folks!\n\nI hope everyone is excited about the upcoming class. I wanted to kick off our first discussion with three questions.\n\n(1) What are your top two goals for this class?\n(2) Why are you interested in GEOINT?\n(3) What is the most interesting, recent application of GEOINT you have seen?\n\nThere are no wrong answers here.',
    JSON.stringify({clarity:3,logic:3,structure:3,tone:3,style:3})
  );

  insertCourse.run(
    'ain714','AIN 714','AI Strategy & Innovation',
    'Wake Forest University','Spring 2026','#CFB53B','#a08a1a','rgba(207,181,59,0.12)',
    `Dave Cook is a technology leader with over 30 years of experience in data, advanced analytics, and artificial intelligence. He currently supports AI/ML programs across the U.S. Intelligence Community and the Department of Defense and teaches AI at the University of Maryland and Wake Forest University. He is the Chief Innovation Officer for Cornerstone Defense and co-founded the Training Data Project (TDP) in 2023 to advance AI Value Science. A 19-time Marine Corps Marathon finisher, he views AI as a marathon, not a sprint. Dave serves on DC Mayor Muriel Bowser's AI Advisory Group and holds degrees from Northwestern University, Carnegie Mellon University, and the University of Maryland.`,
    'Casual, direct, warm, and real. Sharp, experienced mentor with real-world practitioner credibility. Connect student ideas to real-world AI practice and strategy.',
    'Welcome to AIN 714! Please introduce yourself and share your thoughts on the following:\n\n(1) What are your top two goals for this course?\n(2) Why are you interested in AI Strategy and Innovation?\n(3) What is the most interesting recent application of AI you have seen in your field or industry?\n\nThere are no wrong answers.',
    JSON.stringify({clarity:3,logic:3,structure:3,tone:3,style:3})
  );

  const insertAssign = db.prepare(`
    INSERT INTO assignments (id,course_id,name,type,max_score,display_order,description,rubric)
    VALUES (?,?,?,?,?,?,?,?)
  `);

  const lab1Desc = `GEOG 661 Lab 1: Observing and Communicating Geospatial Intelligence\nTotal Points: 6\n\nStudents choose one of six provided images, create an annotated product highlighting key observations, and write a short narrative explaining findings to a decision-maker.\n\nParts:\n1. Study image (What, Where, When, Who, Why it matters)\n2. Create annotated product (single slide with shapes, labels, overlays, legend)\n3. Write narrative (6-8 sentences, factual, professional, third-person)\n4. Provide context with citations (1-2 paragraphs)`;
  const lab1Rubric = `ANNOTATED PRODUCT (2 pts):\n2 = Key features labeled. Legend present. Neatline present. Colorblind accessible. Decision-maker understands in 30 seconds.\n1 = Some labels, no legend, unexplained colors.\n0 = Missing.\n\nNARRATIVE (2 pts):\n2 = All 5 Ws. Third-person. BLUF opening. Significance explicit. 6-8 sentences.\n1 = 3-4 Ws. Significance buried. Some first-person.\n0 = Essentially absent.\n\nCONTEXT (1 pt):\n1 = Genuine insight. Two or more credible sources cited.\n0.5 = Superficial or Wikipedia-only.\n0 = None.\n\nOVERALL QUALITY (1 pt):\n1 = Professional, no errors, complete.\n0.5 = Minor errors.\n0 = Disorganized.`;

  for (let n = 1; n <= 6; n++) {
    insertAssign.run(
      `geog661-lab${n}`, 'geog661', `Lab ${n}`, 'lab', 6, n,
      n === 1 ? lab1Desc : '', n === 1 ? lab1Rubric : ''
    );
  }

  insertAssign.run('ain714-disc1','ain714','Discussion 1','discussion',10,1,'','');
}

// ─── Parse helpers ─────────────────────────────────────────────────────────

function parseCourse(r) {
  if (!r) return null;
  return { id:r.id, name:r.name, fullName:r.full_name, institution:r.institution, term:r.term,
    color:r.color, colorDark:r.color_dark, colorFaint:r.color_faint,
    instructorBio:r.instructor_bio, voiceGuidelines:r.voice_guidelines,
    discussionDefaultQuestion:r.discussion_default_question,
    sliders:JSON.parse(r.sliders||'{"clarity":3,"logic":3,"structure":3,"tone":3,"style":3}'),
    createdAt:r.created_at };
}

function parseAssignment(r) {
  if (!r) return null;
  return { id:r.id, courseId:r.course_id, name:r.name, type:r.type,
    maxScore:r.max_score, order:r.display_order, description:r.description,
    rubric:r.rubric, rubricCriteria:r.rubric_criteria ? JSON.parse(r.rubric_criteria) : null,
    createdAt:r.created_at };
}

function parseGrade(r) {
  if (!r) return null;
  return { id:r.id, courseId:r.course_id, assignmentId:r.assignment_id,
    studentId:r.student_id, studentName:r.student_name, assignmentName:r.assignment_name,
    fileName:r.file_name, total:r.total, maxScore:r.max_score,
    scores:JSON.parse(r.scores||'{}'), comments:JSON.parse(r.comments||'{}'),
    summary:r.summary, key_strength:r.key_strength, key_improvement:r.key_improvement,
    instructor_paragraph:r.instructor_paragraph, gradedAt:r.graded_at };
}

function parseMaterial(r) {
  if (!r) return null;
  return { id:r.id, courseId:r.course_id, name:r.name, type:r.type,
    weekNumber:r.week_number, assignmentId:r.assignment_id, filePath:r.file_path,
    url:r.url, extractedText:r.extracted_text, fileSize:r.file_size,
    status:r.status, version:r.version, uploadedAt:r.uploaded_at };
}

function parseAlwaysOn(r) {
  if (!r) return null;
  return { id:r.id, gradeId:r.grade_id, studentId:r.student_id, studentName:r.student_name,
    courseId:r.course_id, assignmentId:r.assignment_id, assignmentName:r.assignment_name,
    weakArea:r.weak_area, feedbackSentences:r.feedback_sentences,
    links:JSON.parse(r.links||'[]'), status:r.status,
    reviewedAt:r.reviewed_at, reviewNotes:r.review_notes, createdAt:r.created_at };
}

function firstName(name) {
  if (!name || name === 'Unknown') return name || 'Unknown';
  return name.trim().split(' ')[0];
}

module.exports = { db, parseCourse, parseAssignment, parseGrade, parseMaterial, parseAlwaysOn, firstName };
