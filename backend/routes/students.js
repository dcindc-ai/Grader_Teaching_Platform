const express = require('express');
const router = express.Router();
const { readJSON, writeJSON, uuid, now } = require('../data/helpers');

const STUDENTS_PATH = './data/students.json';
const GRADES_PATH = './data/grades.json';

// GET students for a course
router.get('/', (req, res) => {
  const { courseId } = req.query;
  let students = readJSON(STUDENTS_PATH, []);
  if (courseId) students = students.filter(s => s.courseId === courseId);
  res.json(students);
});

// GET single student with full grade history
router.get('/:id', (req, res) => {
  const students = readJSON(STUDENTS_PATH, []);
  const student = students.find(s => s.id === req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const grades = readJSON(GRADES_PATH, []).filter(g => g.studentId === req.params.id);
  res.json({ ...student, grades });
});

// POST upload roster (CSV or JSON array)
router.post('/roster', (req, res) => {
  const { courseId, students: incoming } = req.body;
  if (!courseId || !Array.isArray(incoming)) {
    return res.status(400).json({ error: 'courseId and students array required' });
  }

  const existing = readJSON(STUDENTS_PATH, []);
  const added = [];
  const skipped = [];

  for (const s of incoming) {
    const name = (s.name || s.Name || '').trim();
    const email = (s.email || s.Email || '').trim().toLowerCase();
    if (!name) continue;

    const alreadyExists = existing.find(e =>
      e.courseId === courseId && (e.email === email || e.name === name)
    );
    if (alreadyExists) { skipped.push(name); continue; }

    const student = {
      id: uuid(),
      courseId,
      name,
      email,
      createdAt: now()
    };
    existing.push(student);
    added.push(student);
  }

  writeJSON(STUDENTS_PATH, existing);
  res.json({ added: added.length, skipped: skipped.length, students: added });
});

// POST add single student
router.post('/', (req, res) => {
  const students = readJSON(STUDENTS_PATH, []);
  const student = { id: uuid(), createdAt: now(), ...req.body };
  students.push(student);
  writeJSON(STUDENTS_PATH, students);
  res.json(student);
});

// DELETE student
router.delete('/:id', (req, res) => {
  const students = readJSON(STUDENTS_PATH, []).filter(s => s.id !== req.params.id);
  writeJSON(STUDENTS_PATH, students);
  res.json({ ok: true });
});

// GET student progress summary for a course
router.get('/progress/:courseId', (req, res) => {
  const students = readJSON(STUDENTS_PATH, []).filter(s => s.courseId === req.params.courseId);
  const grades = readJSON(GRADES_PATH, []);

  const progress = students.map(s => {
    const studentGrades = grades.filter(g => g.studentId === s.id);
    const avg = studentGrades.length
      ? (studentGrades.reduce((a, g) => a + (parseFloat(g.total) || 0), 0) / studentGrades.length).toFixed(2)
      : null;
    return {
      ...s,
      assignmentsGraded: studentGrades.length,
      averageScore: avg,
      grades: studentGrades
    };
  });

  res.json(progress);
});

module.exports = router;
