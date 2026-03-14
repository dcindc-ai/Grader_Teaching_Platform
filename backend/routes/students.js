const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const { courseId } = req.query;
  const rows = courseId
    ? db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY name ASC').all(courseId)
    : db.prepare('SELECT * FROM students ORDER BY name ASC').all();
  res.json(rows);
});

router.post('/roster', (req, res) => {
  const { courseId, students } = req.body;
  if (!courseId || !Array.isArray(students)) return res.status(400).json({ error: 'courseId and students required' });
  let added = 0, skipped = 0;
  const insertSt = db.prepare('INSERT INTO students (id,course_id,name,email) VALUES (?,?,?,?)');
  const checkSt = db.prepare('SELECT id FROM students WHERE course_id=? AND (email=? OR name=?)');
  const addMany = db.transaction((list) => {
    for (const s of list) {
      const name = (s.name||s.Name||'').trim();
      const email = (s.email||s.Email||'').trim().toLowerCase();
      if (!name) continue;
      if (checkSt.get(courseId, email||'__none__', name)) { skipped++; continue; }
      insertSt.run(uuidv4(), courseId, name, email);
      added++;
    }
  });
  addMany(students);
  res.json({ added, skipped });
});

router.post('/', (req, res) => {
  const { courseId, name, email } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO students (id,course_id,name,email) VALUES (?,?,?,?)').run(id, courseId, name, email||'');
  res.json(db.prepare('SELECT * FROM students WHERE id=?').get(id));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.get('/progress/:courseId', (req, res) => {
  const students = db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY name ASC').all(req.params.courseId);
  const progress = students.map(s => {
    const grades = db.prepare('SELECT * FROM grades WHERE student_id=? ORDER BY graded_at DESC').all(s.id);
    const avg = grades.length
      ? (grades.reduce((a,g) => a + (g.total||0), 0) / grades.length).toFixed(2) : null;
    return { ...s, assignmentsGraded: grades.length, averageScore: avg, grades: grades.map(g => ({
      id: g.id, assignmentName: g.assignment_name, total: g.total, maxScore: g.max_score,
      gradedAt: g.graded_at, key_improvement: g.key_improvement
    })) };
  });
  res.json(progress);
});

module.exports = router;
