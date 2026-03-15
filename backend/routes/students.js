const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

function parseStudent(r) {
  if (!r) return null;
  const firstName = r.first_name || (r.name || '').split(' ').slice(0, -1).join(' ') || r.name || '';
  const lastName = r.last_name || (r.name || '').split(' ').pop() || '';
  return {
    id: r.id, courseId: r.course_id,
    firstName, lastName,
    name: r.name || `${firstName} ${lastName}`.trim(),
    preferredName: r.preferred_name || firstName,
    nickname: r.nickname || '',
    email: r.email || '',
    notes: r.notes || '',
    createdAt: r.created_at
  };
}

// GET students for a course
router.get('/', (req, res) => {
  const { courseId } = req.query;
  const rows = courseId
    ? db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY last_name ASC, first_name ASC').all(courseId)
    : db.prepare('SELECT * FROM students ORDER BY last_name ASC').all();
  res.json(rows.map(parseStudent));
});

// POST /api/students/roster — upload CSV roster with progress via SSE
router.post('/roster', (req, res) => {
  const { courseId, students } = req.body;
  if (!courseId || !Array.isArray(students)) {
    return res.status(400).json({ error: 'courseId and students array required' });
  }

  let added = 0, skipped = 0, matched = 0;

  const checkEmail = db.prepare('SELECT id FROM students WHERE course_id=? AND email=?');
  const checkName = db.prepare('SELECT id FROM students WHERE course_id=? AND (name=? OR (first_name=? AND last_name=?))');
  const insertSt = db.prepare(`
    INSERT INTO students (id,course_id,name,first_name,last_name,email)
    VALUES (?,?,?,?,?,?)
  `);
  const updateSt = db.prepare(`
    UPDATE students SET first_name=?, last_name=?, name=?, email=?
    WHERE id=?
  `);

  const addMany = db.transaction((list) => {
    for (const s of list) {
      const fullName = (s.name || s.Name || '').trim();
      const email = (s.email || s.Email || '').trim().toLowerCase();
      if (!fullName) continue;

      // Parse first/last from full name
      const parts = fullName.split(' ');
      const lastName = parts.pop() || '';
      const firstName = parts.join(' ') || lastName;

      // Check existing
      const existingEmail = email ? checkEmail.get(courseId, email) : null;
      const existingName = checkName.get(courseId, fullName, firstName, lastName);

      if (existingEmail || existingName) {
        const existing = existingEmail || existingName;
        // Update with parsed first/last if missing
        updateSt.run(firstName, lastName, fullName, email, existing.id);
        skipped++;
        continue;
      }

      insertSt.run(uuidv4(), courseId, fullName, firstName, lastName, email);
      added++;
    }
  });

  addMany(students);

  // Match existing grades to roster by last name / filename
  const allStudents = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const unmatchedGrades = db.prepare(
    "SELECT id, student_name, file_name FROM grades WHERE course_id=? AND (student_id IS NULL OR student_id='')"
  ).all(courseId);

  for (const grade of unmatchedGrades) {
    const student = findStudentMatch(allStudents, grade.student_name, grade.file_name);
    if (student) {
      const parsed = parseStudent(student);
      db.prepare('UPDATE grades SET student_id=?, student_name=? WHERE id=?')
        .run(student.id, parsed.name, grade.id);
      matched++;
    }
  }

  res.json({ added, skipped, matched, total: students.length });
});

function findStudentMatch(students, studentName, fileName) {
  if (!students.length) return null;
  const fileLastName = (fileName || '').split('_')[0].split('.')[0].toLowerCase();

  if (studentName && studentName !== 'Unknown') {
    const exact = students.find(s =>
      (s.name || '').toLowerCase() === studentName.toLowerCase()
    );
    if (exact) return exact;

    const nameParts = studentName.toLowerCase().split(' ');
    const lastName = nameParts[nameParts.length - 1];
    const byLast = students.find(s =>
      (s.last_name || (s.name||'').split(' ').pop() || '').toLowerCase() === lastName
    );
    if (byLast) return byLast;
  }

  if (fileLastName) {
    const byFile = students.find(s => {
      const sLast = (s.last_name || (s.name||'').split(' ').pop() || '').toLowerCase();
      return sLast === fileLastName;
    });
    if (byFile) return byFile;
  }

  return null;
}

// GET /api/students/match
router.get('/match', (req, res) => {
  const { courseId, studentName, fileName } = req.query;
  const students = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const match = findStudentMatch(students, studentName, fileName);
  res.json({ match: match ? parseStudent(match) : null });
});

// GET /api/students/progress/:courseId
router.get('/progress/:courseId', (req, res) => {
  const students = db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY last_name ASC, first_name ASC').all(req.params.courseId);
  const progress = students.map(s => {
    const grades = db.prepare('SELECT * FROM grades WHERE student_id=? ORDER BY graded_at DESC').all(s.id);
    const avg = grades.length
      ? (grades.reduce((a, g) => a + (parseFloat(g.total)||0) / (parseFloat(g.max_score)||1), 0) / grades.length * 100).toFixed(0)
      : null;
    return {
      ...parseStudent(s),
      assignmentsGraded: grades.length,
      averageScore: avg,
      grades: grades.map(g => ({
        id: g.id, assignmentName: g.assignment_name,
        total: g.total, maxScore: g.max_score,
        gradedAt: g.graded_at, key_improvement: g.key_improvement
      }))
    };
  });
  res.json(progress);
});

// POST single student
router.post('/', (req, res) => {
  const { courseId, firstName, lastName, email, nickname, notes } = req.body;
  const id = uuidv4();
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  db.prepare('INSERT INTO students (id,course_id,name,first_name,last_name,email,nickname,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, courseId, fullName, firstName||'', lastName||'', email||'', nickname||'', notes||'');
  res.json(parseStudent(db.prepare('SELECT * FROM students WHERE id=?').get(id)));
});

// PUT update student
router.put('/:id', (req, res) => {
  const { firstName, lastName, email, nickname, notes, preferredName } = req.body;
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  db.prepare('UPDATE students SET name=?,first_name=?,last_name=?,email=?,nickname=?,notes=?,preferred_name=? WHERE id=?')
    .run(fullName, firstName||'', lastName||'', email||'', nickname||'', notes||'', preferredName||'', req.params.id);
  res.json(parseStudent(db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id)));
});

// DELETE student
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
