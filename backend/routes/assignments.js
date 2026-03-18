const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, parseAssignment } = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const { courseId } = req.query;
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
  db.prepare('UPDATE assignments SET name=?,type=?,max_score=?,display_order=?,description=?,rubric=?,rubric_criteria=?,grading_guidance=? WHERE id=?')
    .run(b.name, b.type, b.maxScore, b.order, b.description, b.rubric, b.rubricCriteria ? JSON.stringify(b.rubricCriteria) : null, b.gradingGuidance || '', req.params.id);
  res.json(parseAssignment(db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id)));
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
      model: 'claude-sonnet-4-20250514',
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
