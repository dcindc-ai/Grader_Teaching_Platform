const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

// GET students for a course
router.get('/', (req, res) => {
  const { courseId } = req.query;
  const rows = courseId
    ? db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY name ASC').all(courseId)
    : db.prepare('SELECT * FROM students ORDER BY name ASC').all();
  res.json(rows);
});

// POST /api/students/roster — upload CSV roster
router.post('/roster', (req, res) => {
  const { courseId, students } = req.body;
  if (!courseId || !Array.isArray(students)) {
    return res.status(400).json({ error: 'courseId and students array required' });
  }

  let added = 0, skipped = 0;
  const insertSt = db.prepare('INSERT INTO students (id,course_id,name,email) VALUES (?,?,?,?)');
  const checkEmail = db.prepare('SELECT id FROM students WHERE course_id=? AND email=?');
  const checkName = db.prepare('SELECT id FROM students WHERE course_id=? AND name=?');

  const addMany = db.transaction((list) => {
    for (const s of list) {
      const name = (s.name || s.Name || '').trim();
      const email = (s.email || s.Email || '').trim().toLowerCase();
      if (!name) continue;
      // Skip if already exists by email or exact name
      if (email && checkEmail.get(courseId, email)) { skipped++; continue; }
      if (checkName.get(courseId, name)) { skipped++; continue; }
      insertSt.run(uuidv4(), courseId, name, email);
      added++;
    }
  });

  addMany(students);

  // After uploading roster, try to match existing grades to students
  const allStudents = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const unmatchedGrades = db.prepare("SELECT id, student_name, file_name FROM grades WHERE course_id=? AND (student_id IS NULL OR student_id='')").all(courseId);

  let matched = 0;
  for (const grade of unmatchedGrades) {
    const student = findStudentMatch(allStudents, grade.student_name, grade.file_name);
    if (student) {
      db.prepare('UPDATE grades SET student_id=?, student_name=? WHERE id=?')
        .run(student.id, student.name, grade.id);
      matched++;
    }
  }

  res.json({ added, skipped, matched });
});

// Find best student match by name or filename
function findStudentMatch(students, studentName, fileName) {
  if (!students.length) return null;

  // Extract last name from filename (e.g. Appel_lab1.pdf -> Appel)
  const fileLastName = (fileName || '').split('_')[0].split('.')[0].toLowerCase();

  // Try exact name match first
  if (studentName && studentName !== 'Unknown') {
    const exact = students.find(s => s.name.toLowerCase() === studentName.toLowerCase());
    if (exact) return exact;

    // Try last name match
    const nameParts = studentName.toLowerCase().split(' ');
    const lastName = nameParts[nameParts.length - 1];
    const byLastName = students.find(s => {
      const sLast = s.name.toLowerCase().split(' ').pop();
      return sLast === lastName;
    });
    if (byLastName) return byLastName;
  }

  // Try matching from filename
  if (fileLastName) {
    const byFile = students.find(s => {
      const sLast = s.name.toLowerCase().split(' ').pop();
      return sLast === fileLastName || s.name.toLowerCase().replace(/\s+/g,'').includes(fileLastName);
    });
    if (byFile) return byFile;
  }

  return null;
}

// POST single student
router.post('/', (req, res) => {
  const { courseId, name, email } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO students (id,course_id,name,email) VALUES (?,?,?,?)')
    .run(id, courseId, name, email || '');
  res.json(db.prepare('SELECT * FROM students WHERE id=?').get(id));
});

// DELETE student
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET progress for a course
router.get('/progress/:courseId', (req, res) => {
  const students = db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY name ASC').all(req.params.courseId);
  const progress = students.map(s => {
    const grades = db.prepare('SELECT * FROM grades WHERE student_id=? ORDER BY graded_at DESC').all(s.id);
    const avg = grades.length
      ? (grades.reduce((a, g) => a + (g.total || 0), 0) / grades.length).toFixed(2) : null;
    return {
      ...s,
      assignmentsGraded: grades.length,
      averageScore: avg,
      grades: grades.map(g => ({
        id: g.id, assignmentName: g.assignment_name, total: g.total,
        maxScore: g.max_score, gradedAt: g.graded_at, key_improvement: g.key_improvement
      }))
    };
  });
  res.json(progress);
});

// GET /api/students/match — try to match a student name/filename to roster
router.get('/match', (req, res) => {
  const { courseId, studentName, fileName } = req.query;
  const students = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const match = findStudentMatch(students, studentName, fileName);
  res.json({ match: match || null });
});

module.exports = router;
