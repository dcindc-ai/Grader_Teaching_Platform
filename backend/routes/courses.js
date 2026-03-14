const express = require('express');
const router = express.Router();
const { readJSON, writeJSON, uuid, now } = require('../data/helpers');
const { DEFAULT_COURSES } = require('../data/seed');

const PATH = './data/courses.json';

function getCourses() {
  const saved = readJSON(PATH, null);
  if (!saved) {
    writeJSON(PATH, DEFAULT_COURSES);
    return DEFAULT_COURSES;
  }
  return saved;
}

function saveCourses(courses) {
  writeJSON(PATH, courses);
}

// GET all courses
router.get('/', (req, res) => {
  res.json(getCourses());
});

// GET single course
router.get('/:id', (req, res) => {
  const course = getCourses().find(c => c.id === req.params.id);
  if (!course) return res.status(404).json({ error: 'Course not found' });
  res.json(course);
});

// POST create course
router.post('/', (req, res) => {
  const courses = getCourses();
  const course = {
    id: uuid(),
    name: '',
    fullName: '',
    institution: '',
    term: '',
    color: '#4f8ef7',
    colorDark: '#3d7ce8',
    colorFaint: 'rgba(79,142,247,0.12)',
    instructorBio: '',
    voiceGuidelines: '',
    discussionDefaultQuestion: '',
    sliders: { clarity: 3, logic: 3, structure: 3, tone: 3, style: 3 },
    createdAt: now(),
    ...req.body
  };
  courses.push(course);
  saveCourses(courses);
  res.json(course);
});

// PUT update course
router.put('/:id', (req, res) => {
  const courses = getCourses();
  const idx = courses.findIndex(c => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Course not found' });
  courses[idx] = { ...courses[idx], ...req.body, id: req.params.id };
  saveCourses(courses);
  res.json(courses[idx]);
});

// DELETE course
router.delete('/:id', (req, res) => {
  const courses = getCourses().filter(c => c.id !== req.params.id);
  saveCourses(courses);
  res.json({ ok: true });
});

module.exports = router;
