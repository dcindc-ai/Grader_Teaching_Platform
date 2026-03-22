const express = require('express');
const router = express.Router();
const { db, parseGrade } = require('../db');
const { v4: uuidv4 } = require('uuid');

// Ensure flags table exists
db.prepare(`CREATE TABLE IF NOT EXISTS grading_flags (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  grade_id TEXT,
  flag_type TEXT NOT NULL,
  criterion_name TEXT,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now'))
)`).run();

// GET /api/flags?courseId=X&assignmentId=Y
router.get('/', (req, res) => {
  const { courseId, assignmentId, status } = req.query;
  let q = 'SELECT * FROM grading_flags WHERE 1=1';
  const params = [];
  if (courseId) { q += ' AND course_id=?'; params.push(courseId); }
  if (assignmentId) { q += ' AND assignment_id=?'; params.push(assignmentId); }
  if (status) { q += ' AND status=?'; params.push(status); }
  q += ' ORDER BY created_at DESC';
  res.json(db.prepare(q).all(...params));
});

// POST /api/flags — create a flag
router.post('/', (req, res) => {
  const { courseId, assignmentId, studentName, gradeId, flagType, criterionName, message } = req.body;
  const id = uuidv4();
  db.prepare(`INSERT OR IGNORE INTO grading_flags (id,course_id,assignment_id,student_name,grade_id,flag_type,criterion_name,message)
    VALUES (?,?,?,?,?,?,?,?)`).run(id, courseId, assignmentId, studentName, gradeId||'', flagType, criterionName||'', message);
  res.json({ id, created: true });
});

// PUT /api/flags/:id — resolve or dismiss
router.put('/:id', (req, res) => {
  db.prepare('UPDATE grading_flags SET status=? WHERE id=?').run(req.body.status || 'resolved', req.params.id);
  res.json({ ok: true });
});

// POST /api/flags/check-correction
// When a grade is manually edited, find other students who may have the same issue
router.post('/check-correction', (req, res) => {
  const { courseId, assignmentId, studentName, criterionName, oldScore, newScore, gradeId } = req.body;
  if (!courseId || !assignmentId || !criterionName) return res.json({ flagged: [] });

  const scoreDiff = (newScore || 0) - (oldScore || 0);
  if (Math.abs(scoreDiff) < 0.5) return res.json({ flagged: [] }); // not a meaningful change

  // Find all other grades for this assignment
  const allGrades = db.prepare('SELECT * FROM grades WHERE assignment_id=? AND course_id=? AND student_name!=?')
    .all(assignmentId, courseId, studentName);

  const flagged = [];
  for (const grade of allGrades) {
    let scores = {};
    try { scores = typeof grade.scores === 'string' ? JSON.parse(grade.scores) : (grade.scores || {}); } catch(e) {}

    const theirScore = scores[criterionName];
    if (theirScore === undefined || theirScore === null) continue;

    // Flag if they have the same or similar low score on the same criterion
    if (theirScore <= (oldScore + 0.5) && theirScore >= (oldScore - 0.5)) {
      const id = uuidv4();
      const message = `You raised ${studentName}'s "${criterionName}" from ${oldScore} to ${newScore}. ${grade.student_name} has the same score (${theirScore}) on this criterion — may need the same correction.`;

      // Only insert if not already flagged for same student+criterion
      const exists = db.prepare(`SELECT id FROM grading_flags WHERE assignment_id=? AND student_name=? AND criterion_name=? AND status='open'`)
        .get(assignmentId, grade.student_name, criterionName);

      if (!exists) {
        db.prepare(`INSERT INTO grading_flags (id,course_id,assignment_id,student_name,grade_id,flag_type,criterion_name,message)
          VALUES (?,?,?,?,?,?,?,?)`)
          .run(id, courseId, assignmentId, grade.student_name, grade.id, 'correction-propagation', criterionName, message);
        flagged.push({ id, studentName: grade.student_name, score: theirScore, message });
      }
    }
  }

  res.json({ flagged, scoreDiff, criterionName });
});

// POST /api/flags/check-dnp
// Check if a grade penalizes something in the DO NOT PENALIZE list
router.post('/check-dnp', (req, res) => {
  const { courseId, assignmentId, studentName, gradeId, criteriaGrades, gradingGuidance } = req.body;
  if (!gradingGuidance || !criteriaGrades?.length) return res.json({ flags: [] });

  const flags = [];
  const guidance = gradingGuidance.toLowerCase();

  for (const cg of criteriaGrades) {
    if (!cg.studentComment && !cg.scoringRationale) continue;
    const comment = ((cg.studentComment || '') + ' ' + (cg.scoringRationale || '')).toLowerCase();

    // Check if comment mentions something that's in the DO NOT PENALIZE list
    const dnpTerms = gradingGuidance.split(/[.,\n]/).map(s => s.trim()).filter(s => s.length > 8);
    for (const term of dnpTerms) {
      const termLower = term.toLowerCase().replace(/^(do not penalize|don't penalize|no penalty|ignore)[\s:]+/i, '').trim();
      if (termLower.length < 6) continue;
      if (comment.includes(termLower.slice(0, 20).toLowerCase()) && cg.suggestedPoints < cg.maxPoints) {
        const id = uuidv4();
        const message = `"${cg.criterionName}" may have penalized "${termLower.slice(0,40)}" which is in your DO NOT PENALIZE list.`;

        const exists = db.prepare(`SELECT id FROM grading_flags WHERE assignment_id=? AND student_name=? AND criterion_name=? AND flag_type='dnp-violation' AND status='open'`)
          .get(assignmentId, studentName, cg.criterionName);

        if (!exists) {
          db.prepare(`INSERT INTO grading_flags (id,course_id,assignment_id,student_name,grade_id,flag_type,criterion_name,message)
            VALUES (?,?,?,?,?,?,?,?)`)
            .run(id, courseId, assignmentId, studentName, gradeId||'', 'dnp-violation', cg.criterionName, message);
          flags.push({ id, criterionName: cg.criterionName, message });
        }
      }
    }
  }

  res.json({ flags });
});

module.exports = router;
