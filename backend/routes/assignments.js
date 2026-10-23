const { getModel } = require('../config');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, parseAssignment } = require('../db');
const { findCanvasIdConflict } = require('../lib/courseLifecycle');
const router = express.Router();

router.get('/', (req, res) => {
  const { courseId, canvas_assignment_id } = req.query;

  // Lookup by Canvas assignment ID (used by Chrome extension for quiz detection)
  if (canvas_assignment_id) {
    const rows = db.prepare('SELECT * FROM assignments WHERE canvas_assignment_id=? ORDER BY display_order ASC').all(canvas_assignment_id);
    return res.json(rows.map(parseAssignment));
  }

  const rows = courseId
    ? db.prepare('SELECT * FROM assignments WHERE course_id=? ORDER BY display_order ASC').all(courseId)
    : db.prepare('SELECT * FROM assignments ORDER BY display_order ASC').all();
  res.json(rows.map(parseAssignment));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseAssignment(row));
});

router.post('/', (req, res) => {
  const b = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO assignments (id,course_id,name,type,max_score,display_order,description,rubric) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, b.courseId, b.name||'New Assignment', b.type||'lab', b.maxScore||6, b.order||99, b.description||'', b.rubric||'');
  res.json(parseAssignment(db.prepare('SELECT * FROM assignments WHERE id=?').get(id)));
});

router.put('/:id', (req, res) => {
  const b = req.body;
  // Only update rubric_criteria if rubricCriteria was explicitly sent in the request
  // If absent (e.g. saving just strictness), preserve whatever is stored
  // Decoupled from rubric text: criteria can exist without text and vice versa
  const rubricCriteriaValue = 'rubricCriteria' in b
    ? (Array.isArray(b.rubricCriteria) && b.rubricCriteria.length > 0 ? JSON.stringify(b.rubricCriteria) : null)
    : undefined; // undefined = don't touch it

  // Per-assignment score cap: a number sets the hard ceiling; empty/null clears it.
  const scoreCapValue = (b.scoreCap === '' || b.scoreCap === null || b.scoreCap === undefined || Number.isNaN(Number(b.scoreCap)))
    ? null : Number(b.scoreCap);

  if (rubricCriteriaValue !== undefined) {
    db.prepare('UPDATE assignments SET name=?,type=?,max_score=?,display_order=?,description=?,rubric=?,rubric_criteria=?,grading_guidance=?,canvas_assignment_id=?,target_avg=?,grading_strictness=?,score_cap=? WHERE id=?')
      .run(b.name, b.type, b.maxScore, b.order, b.description, b.rubric,
        rubricCriteriaValue,
        b.gradingGuidance || '', b.canvasAssignmentId || '',
        b.targetAvg ?? 4.5, b.gradingStrictness || 'standard', scoreCapValue,
        req.params.id);
  } else {
    db.prepare('UPDATE assignments SET name=?,type=?,max_score=?,display_order=?,description=?,rubric=?,grading_guidance=?,canvas_assignment_id=?,target_avg=?,grading_strictness=?,score_cap=? WHERE id=?')
      .run(b.name, b.type, b.maxScore, b.order, b.description, b.rubric,
        b.gradingGuidance || '', b.canvasAssignmentId || '',
        b.targetAvg ?? 4.5, b.gradingStrictness || 'standard', scoreCapValue,
        req.params.id);
  }
  // Advisory only: the save above has already happened. A clone leaves 13
  // identically named assignments with blank Canvas ids, and a duplicate typed
  // into one of them would silently point this term at the other term's
  // Canvas record.
  const saved = parseAssignment(db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id));
  const conflict = findCanvasIdConflict(db, req.params.id, b.canvasAssignmentId);
  if (conflict) saved.canvasIdWarning = conflict;
  res.json(saved);
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Examples
router.get('/:id/examples', (req, res) => {
  res.json(db.prepare('SELECT * FROM examples WHERE assignment_id=? ORDER BY created_at DESC').all(req.params.id));
});

router.post('/:id/examples', (req, res) => {
  const b = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO examples (id,assignment_id,course_id,student_name,score,quality,notes,content) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.params.id, b.courseId||'', b.studentName||'', b.score||0, b.quality||'good', b.notes||'', b.content||'');
  res.json(db.prepare('SELECT * FROM examples WHERE id=?').get(id));
});

// POST /api/assignments/:id/examples/import — bulk import JSONL calibration pack
router.post('/:id/examples/import', (req, res) => {
  const { jsonl, courseId } = req.body;
  if (!jsonl) return res.status(400).json({ error: 'jsonl required' });

  const lines = jsonl.trim().split('\n').filter(l => l.trim());
  let imported = 0, errors = 0;

  for (const line of lines) {
    try {
      const rec = JSON.parse(line);

      // Map JSONL fields to examples table
      const studentName = rec.student || 'Unknown';
      const score = rec.score_summary?.total_points || 0;
      const maxPts = rec.score_summary?.max_points || 75;
      const overallRating = rec.score_summary?.overall_rating || '';

      // Determine quality from calibration_note or overall_rating
      const note = (rec.calibration_note || '').toLowerCase();
      const rating = overallRating.toLowerCase();
      let quality = 'good';
      if (note.includes('low') || rating.includes('needs improvement') || score / maxPts < 0.75) quality = 'weak';
      else if (note.includes('borderline')) quality = 'borderline';

      // Build content from criteria feedback
      const criteriaText = (rec.criteria || []).map(c =>
        `[${c.criterion}] ${c.rating} (${c.points}/${c.max_points}): ${c.comment}`
      ).join('\n');

      const content = [
        rec.overall_feedback || '',
        criteriaText ? '\nCRITERIA:\n' + criteriaText : '',
        rec.calibration_note ? '\nCALIBRATION NOTE: ' + rec.calibration_note : ''
      ].filter(Boolean).join('\n');

      const notes = `${overallRating} — ${rec.calibration_note || ''}`;

      db.prepare('INSERT OR REPLACE INTO examples (id,assignment_id,course_id,student_name,score,quality,notes,content) VALUES (?,?,?,?,?,?,?,?)')
        .run(uuidv4(), req.params.id, courseId || '', studentName, score, quality, notes, content);
      imported++;
    } catch(e) {
      console.warn('[import] Failed to parse line:', e.message);
      errors++;
    }
  }

  res.json({ imported, errors, total: lines.length });
});

// GET /api/assignments/:id/examples/library — every example from OTHER assignments
// (any course / any term), so the instructor can browse and carry one forward as a
// calibration example for this assignment. Each row carries its source assignment
// name, course, term, and max_score so the term is identifiable in the picker.
//
// term matters more than it looks: both AIN 714 courses are named "AIN 714",
// and a clone adds a third with verbatim-identical assignment names. Without
// the term the picker cannot tell the source rows apart at all.
router.get('/:id/examples/library', (req, res) => {
  const rows = db.prepare(`
    SELECT e.id, e.assignment_id, e.course_id, e.student_name, e.score, e.quality, e.notes, e.content, e.created_at,
           a.name AS assignment_name, a.max_score AS assignment_max_score,
           a.course_id AS source_course_id,
           c.name AS course_name, c.full_name AS course_full_name, c.term AS course_term
    FROM examples e
    JOIN assignments a ON e.assignment_id = a.id
    LEFT JOIN courses c ON a.course_id = c.id
    WHERE e.assignment_id != ?
    ORDER BY a.name ASC, e.created_at DESC
  `).all(req.params.id);
  res.json(rows);
});

// POST /api/assignments/:id/examples/copy — carry one example forward into THIS
// assignment as a calibration example. Body: { sourceExampleId }. Copies under a new
// id with this assignment's course_id. Idempotent: skips if an equivalent example
// (same student + score + content prefix) is already present here.
router.post('/:id/examples/copy', (req, res) => {
  const { sourceExampleId } = req.body;
  if (!sourceExampleId) return res.status(400).json({ error: 'sourceExampleId required' });

  const src = db.prepare('SELECT * FROM examples WHERE id=?').get(sourceExampleId);
  if (!src) return res.status(404).json({ error: 'Source example not found' });

  const asg = db.prepare('SELECT id, course_id FROM assignments WHERE id=?').get(req.params.id);
  if (!asg) return res.status(404).json({ error: 'Assignment not found' });

  const dup = db.prepare(
    "SELECT id FROM examples WHERE assignment_id=? AND student_name IS ? AND score IS ? AND substr(COALESCE(content,''),1,200)=substr(COALESCE(?,''),1,200) LIMIT 1"
  ).get(asg.id, src.student_name, src.score, src.content);
  if (dup) {
    return res.json({ skipped: true, example: db.prepare('SELECT * FROM examples WHERE id=?').get(dup.id) });
  }

  const id = uuidv4();
  db.prepare('INSERT INTO examples (id,assignment_id,course_id,student_name,score,quality,notes,content) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, asg.id, asg.course_id || '', src.student_name, src.score, src.quality, src.notes, src.content);
  res.json({ skipped: false, example: db.prepare('SELECT * FROM examples WHERE id=?').get(id) });
});

router.delete('/:id/examples/:exId', (req, res) => {
  db.prepare('DELETE FROM examples WHERE id=?').run(req.params.exId);
  res.json({ ok: true });
});

module.exports = router;

// POST /api/assignments/parse-pdf — extract assignment info from uploaded PDF
const multer = require('multer');
const upload2 = multer({ dest: './uploads/', limits: { fileSize: 25 * 1024 * 1024 } });

router.post('/parse-pdf', upload2.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file uploaded' });

  const Anthropic = require('@anthropic-ai/sdk');
  const fs = require('fs');

  try {
    const base64 = fs.readFileSync(file.path).toString('base64');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const resp = await client.messages.create({
      model: getModel(),
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `Extract assignment information from this document and return ONLY valid JSON, no markdown fences:
{
  "name": "short assignment name e.g. Lab 1",
  "type": "lab or discussion or paper or project",
  "maxScore": 6,
  "description": "full assignment description and instructions",
  "rubric": "complete rubric text with point values",
  "components": [
    {"name": "Component name", "maxPoints": 2, "description": "what this component measures"}
  ]
}

Extract everything you can see. For maxScore, add up all the point values in the rubric. For components, identify each separately graded section.` }
        ]
      }]
    });

    try { fs.unlinkSync(file.path); } catch (e) {}

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

// PUT update example
router.put('/:id/examples/:exId', (req, res) => {
  const b = req.body;
  db.prepare('UPDATE examples SET student_name=?, score=?, quality=?, notes=?, content=? WHERE id=?')
    .run(b.student_name || b.studentName, b.score, b.quality, b.notes, b.content, req.params.exId);
  res.json(db.prepare('SELECT * FROM examples WHERE id=?').get(req.params.exId));
});
