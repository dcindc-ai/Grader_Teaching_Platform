const express = require('express');
const router = express.Router();
const { db, parseGrade } = require('../db');

// GET /api/canvassync/check?courseId=X&assignmentId=Y
// Compares app grades against Canvas submission scores
router.get('/check', async (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (!courseId || !assignmentId) return res.status(400).json({ error: 'courseId and assignmentId required' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!course || !assignment) return res.status(404).json({ error: 'Course or assignment not found' });

  const canvasUrl = (course.canvas_url || '').replace(/\/$/, '');
  const canvasToken = course.canvas_token;
  const canvasAssignmentId = assignment.canvas_assignment_id;

  if (!canvasUrl || !canvasToken) return res.status(400).json({ error: 'Canvas URL and token not configured in Course Settings' });
  if (!canvasAssignmentId) return res.status(400).json({ error: 'Canvas Assignment ID not set on this assignment' });

  const urlMatch = canvasUrl.match(/courses\/(\d+)/);
  const canvasCourseId = urlMatch?.[1];
  const baseUrl = canvasUrl.replace(/\/courses\/.*/, '');
  if (!canvasCourseId) return res.status(400).json({ error: 'Canvas URL must include course path' });

  const headers = { 'Authorization': `Bearer ${canvasToken}` };

  try {
    // Fetch Canvas submissions with grades
    const subsResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/assignments/${canvasAssignmentId}/submissions?per_page=100&include[]=user`,
      { headers }
    );
    if (!subsResp.ok) throw new Error(`Canvas API error: ${subsResp.status}`);
    const canvasSubs = await subsResp.json();

    // Fetch app grades for this assignment
    const appGrades = db.prepare('SELECT * FROM grades WHERE assignment_id=? AND course_id=?').all(assignmentId, courseId).map(parseGrade);

    // Build comparison
    const results = [];
    const appByName = {};
    appGrades.forEach(g => {
      const key = (g.studentName || '').toLowerCase().trim();
      appByName[key] = g;
    });

    for (const sub of canvasSubs) {
      if (!sub.user) continue;
      const canvasName = (sub.user.name || sub.user.short_name || '').trim();
      const canvasScore = sub.score;
      const canvasGraded = sub.workflow_state === 'graded';

      // Find matching app grade
      const appGrade = appByName[canvasName.toLowerCase()] ||
        appGrades.find(g => {
          const gName = (g.studentName || '').toLowerCase();
          const cName = canvasName.toLowerCase();
          return gName.includes(cName.split(' ')[0]) || cName.includes(gName.split(' ')[0]);
        });

      const appScore = appGrade ? parseFloat(appGrade.total) : null;
      const diff = (appScore !== null && canvasScore !== null) ? Math.abs(appScore - canvasScore) : null;

      let status = 'ok';
      if (!appGrade) status = 'missing-in-app';
      else if (!canvasGraded) status = 'not-graded-in-canvas';
      else if (diff === null) status = 'unknown';
      else if (diff > 0.5) status = 'mismatch';

      results.push({
        studentName: canvasName,
        studentId: sub.user_id,
        canvasScore,
        appScore,
        diff,
        status,
        canvasGraded,
        appGradeId: appGrade?.id || null
      });
    }

    // Also find app grades with no Canvas match
    for (const appGrade of appGrades) {
      const found = results.find(r => r.appGradeId === appGrade.id);
      if (!found) {
        results.push({
          studentName: appGrade.studentName,
          studentId: null,
          canvasScore: null,
          appScore: parseFloat(appGrade.total),
          diff: null,
          status: 'missing-in-canvas',
          canvasGraded: false,
          appGradeId: appGrade.id
        });
      }
    }

    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === 'ok').length,
      mismatches: results.filter(r => r.status === 'mismatch').length,
      missingInApp: results.filter(r => r.status === 'missing-in-app').length,
      missingInCanvas: results.filter(r => r.status === 'missing-in-canvas').length,
      notGraded: results.filter(r => r.status === 'not-graded-in-canvas').length,
    };

    res.json({ results, summary, assignmentName: assignment.name });
  } catch(e) {
    console.error('Canvas sync check error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
