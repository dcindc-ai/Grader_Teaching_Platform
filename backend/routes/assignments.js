const express = require('express');
const router = express.Router();
const { readJSON, writeJSON, uuid, now } = require('../data/helpers');

const ASSIGN_PATH = './data/assignments.json';
const EXAMPLES_PATH = './data/examples.json';

const DEFAULT_ASSIGNMENTS = {
  geog661: [
    { id: 'geog661-lab1', courseId: 'geog661', name: 'Lab 1', type: 'lab', maxScore: 6, order: 1,
      description: `GEOG 661 Lab 1: Observing and Communicating Geospatial Intelligence\n\nStudents choose one of six provided images, create an annotated product highlighting key observations, and write a short narrative explaining findings to a decision-maker. Total: 6 points.\n\nParts:\n1. Study image (answer: What, Where, When, Who, Why it matters)\n2. Create annotated product (single slide with shapes, labels, overlays, legend)\n3. Write narrative (6-8 sentences, factual, professional, third-person)\n4. Provide context with citations (1-2 paragraphs)`,
      rubric: `ANNOTATED PRODUCT (2 pts):\n2 = Key features identified and labeled. Legend present. Neatline present. Color choices logical and accessible. Decision-maker understands in 30 seconds.\n1 = Some features labeled but incomplete. Legend missing. Colors unexplained or decorative.\n0 = No meaningful annotation or product missing.\n\nNARRATIVE (2 pts):\n2 = All 5 Ws addressed. Factual third-person. BLUF opening with explicit significance. Each sentence one idea. 6-8 sentences. Significance stated not implied.\n1 = 3-4 Ws addressed. Minor first-person use. Significance implied or buried. Some verbose sentences.\n0 = Fewer than 3 Ws. Consistently informal. Narrative essentially absent.\n\nCONTEXT (1 pt):\n1 = Research adds genuine insight beyond caption. Two or more credible sources cited.\n0.5 = Superficial, Wikipedia-only, or sources missing.\n0 = No context or no citations.\n\nOVERALL QUALITY (1 pt):\n1 = Professional, no spelling/grammar errors, complete, well-organized.\n0.5 = Minor errors that do not impede understanding.\n0 = Multiple errors, disorganized, or rushed.`,
      createdAt: new Date().toISOString() },
    ...([2,3,4,5,6].map(n => ({
      id: `geog661-lab${n}`, courseId: 'geog661', name: `Lab ${n}`, type: 'lab',
      maxScore: 6, order: n, description: '', rubric: '', createdAt: new Date().toISOString()
    })))
  ],
  ain714: [
    { id: 'ain714-disc1', courseId: 'ain714', name: 'Discussion 1', type: 'discussion',
      maxScore: 10, order: 1, description: '', rubric: '', createdAt: new Date().toISOString() }
  ]
};

function getAssignments(courseId) {
  const all = readJSON(ASSIGN_PATH, null);
  if (!all) {
    const flat = Object.values(DEFAULT_ASSIGNMENTS).flat();
    writeJSON(ASSIGN_PATH, flat);
    return courseId ? flat.filter(a => a.courseId === courseId) : flat;
  }
  return courseId ? all.filter(a => a.courseId === courseId) : all;
}

function saveAssignment(updated) {
  const all = readJSON(ASSIGN_PATH, []);
  const idx = all.findIndex(a => a.id === updated.id);
  if (idx === -1) all.push(updated);
  else all[idx] = updated;
  writeJSON(ASSIGN_PATH, all);
}

// GET assignments for course
router.get('/', (req, res) => {
  res.json(getAssignments(req.query.courseId));
});

// GET single assignment
router.get('/:id', (req, res) => {
  const a = getAssignments().find(a => a.id === req.params.id);
  if (!a) return res.status(404).json({ error: 'Not found' });
  res.json(a);
});

// POST create assignment
router.post('/', (req, res) => {
  const all = readJSON(ASSIGN_PATH, []);
  const a = { id: uuid(), type: 'lab', maxScore: 6, order: 99, description: '', rubric: '', createdAt: now(), ...req.body };
  all.push(a);
  writeJSON(ASSIGN_PATH, all);
  res.json(a);
});

// PUT update assignment
router.put('/:id', (req, res) => {
  const all = readJSON(ASSIGN_PATH, []);
  const idx = all.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  all[idx] = { ...all[idx], ...req.body, id: req.params.id };
  writeJSON(ASSIGN_PATH, all);
  res.json(all[idx]);
});

// DELETE assignment
router.delete('/:id', (req, res) => {
  writeJSON(ASSIGN_PATH, readJSON(ASSIGN_PATH, []).filter(a => a.id !== req.params.id));
  res.json({ ok: true });
});

// GET examples for assignment
router.get('/:id/examples', (req, res) => {
  res.json(readJSON(EXAMPLES_PATH, []).filter(e => e.assignmentId === req.params.id));
});

// POST add example
router.post('/:id/examples', (req, res) => {
  const examples = readJSON(EXAMPLES_PATH, []);
  const ex = { id: uuid(), assignmentId: req.params.id, createdAt: now(), ...req.body };
  examples.push(ex);
  writeJSON(EXAMPLES_PATH, examples);
  res.json(ex);
});

// DELETE example
router.delete('/:id/examples/:exId', (req, res) => {
  writeJSON(EXAMPLES_PATH, readJSON(EXAMPLES_PATH, []).filter(e => e.id !== req.params.exId));
  res.json({ ok: true });
});

module.exports = router;
