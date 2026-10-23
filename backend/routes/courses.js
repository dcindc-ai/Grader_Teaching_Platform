const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db, parseCourse } = require('../db');
const {
  cloneCourse,
  deleteCourse,
  deleteBlockers,
  CourseNotFound,
  CourseDeleteBlocked,
} = require('../lib/courseLifecycle');
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
    instructor_bio=?,voice_guidelines=?,discussion_default_question=?,sliders=?,
    canvas_url=?,canvas_token=?,do_not_penalize=? WHERE id=?`)
    .run(b.name, b.fullName, b.institution, b.term, b.color, b.colorDark||b.color,
      b.colorFaint||`${b.color}22`, b.instructorBio, b.voiceGuidelines,
      b.discussionDefaultQuestion, JSON.stringify(b.sliders),
      b.canvasUrl||'', b.canvasToken||'', b.doNotPenalize||'',
      req.params.id);
  res.json(parseCourse(db.prepare('SELECT * FROM courses WHERE id=?').get(req.params.id)));
});

// POST /api/courses/:id/clone — stand up a new term from an existing course.
// Carries the assignments and their grading configuration, the active
// materials, and the calibration examples. Never carries students, grades, or
// Canvas assignment ids.
router.post('/:id/clone', (req, res) => {
  const { name, term } = req.body || {};
  if (!name || !String(name).trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  try {
    const { course, counts } = cloneCourse(db, req.params.id, {
      name: String(name).trim(),
      term: term ? String(term).trim() : '',
    });
    res.json({ course: parseCourse(course), counts });
  } catch (e) {
    if (e instanceof CourseNotFound) return res.status(404).json({ error: 'Course not found' });
    console.error('[courses] clone failed:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/courses/:id/delete-blockers — what, if anything, stops this course
// being deleted. Lets the UI disable the control and say why, instead of
// offering a button that always refuses.
router.get('/:id/delete-blockers', (req, res) => {
  try {
    const counts = deleteBlockers(db, req.params.id);
    res.json({ counts, deletable: Object.keys(counts).length === 0 });
  } catch (e) {
    if (e instanceof CourseNotFound) return res.status(404).json({ error: 'Course not found' });
    res.status(500).json({ error: e.message });
  }
});

// DELETE /api/courses/:id — remove an EMPTY course, and nothing else.
// Refused with 409 and the per-table counts if the course holds anything at
// all. This never deletes student data; see lib/courseLifecycle.js.
router.delete('/:id', (req, res) => {
  try {
    res.json(deleteCourse(db, req.params.id));
  } catch (e) {
    if (e instanceof CourseNotFound) return res.status(404).json({ error: 'Course not found' });
    if (e instanceof CourseDeleteBlocked) {
      return res.status(409).json({
        error: 'This course still has data in it, so it cannot be deleted.',
        counts: e.counts,
      });
    }
    console.error('[courses] delete failed:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
