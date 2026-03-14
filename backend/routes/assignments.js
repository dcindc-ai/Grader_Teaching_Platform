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
  db.prepare('UPDATE assignments SET name=?,type=?,max_score=?,display_order=?,description=?,rubric=? WHERE id=?')
    .run(b.name, b.type, b.maxScore, b.order, b.description, b.rubric, req.params.id);
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
