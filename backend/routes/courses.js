const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, parseCourse } = require('../db');
const router = express.Router();

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM courses ORDER BY created_at ASC').all();
  res.json(rows.map(parseCourse));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM courses WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json(parseCourse(row));
});

router.post('/', (req, res) => {
  const b = req.body;
  const id = uuidv4();
  db.prepare(`INSERT INTO courses (id,name,full_name,institution,term,color,color_dark,color_faint,instructor_bio,voice_guidelines,discussion_default_question,sliders)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, b.name||'New Course', b.fullName||'', b.institution||'', b.term||'',
      b.color||'#4f8ef7', b.colorDark||'#3d7ce8', b.colorFaint||'rgba(79,142,247,0.12)',
      b.instructorBio||'', b.voiceGuidelines||'', b.discussionDefaultQuestion||'',
      JSON.stringify(b.sliders||{clarity:3,logic:3,structure:3,tone:3,style:3}));
  res.json(parseCourse(db.prepare('SELECT * FROM courses WHERE id=?').get(id)));
});

router.put('/:id', (req, res) => {
  const b = req.body;
  db.prepare(`UPDATE courses SET name=?,full_name=?,institution=?,term=?,color=?,color_dark=?,color_faint=?,
    instructor_bio=?,voice_guidelines=?,discussion_default_question=?,sliders=? WHERE id=?`)
    .run(b.name, b.fullName, b.institution, b.term, b.color, b.colorDark||b.color,
      b.colorFaint||`${b.color}22`, b.instructorBio, b.voiceGuidelines,
      b.discussionDefaultQuestion, JSON.stringify(b.sliders), req.params.id);
  res.json(parseCourse(db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id)));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM courses WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
