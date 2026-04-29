const express = require('express');
const router = express.Router();
const { db, parseCourse, parseAssignment } = require('../db');

function stripHtml(html) {
  return (html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Fetch assignment data (description + rubric) from Canvas.
// Returns { description, rubricCriteria, rubricText, maxScore, name } or throws.
async function fetchCanvasAssignment(course, assignment, overrideCanvasId) {
  const canvasUrl = (course.canvas_url || '').replace(/\/$/, '');
  const canvasToken = course.canvas_token;
  const canvasAssignmentId = overrideCanvasId || assignment.canvas_assignment_id;

  if (!canvasUrl || !canvasToken) throw new Error('Canvas URL and token not set in Course Settings');
  if (!canvasAssignmentId) throw new Error('Canvas Assignment ID not set on this assignment');

  const urlMatch = canvasUrl.match(/courses\/(\d+)/);
  const canvasCourseId = urlMatch?.[1];
  const baseUrl = canvasUrl.replace(/\/courses\/.*/, '');
  if (!canvasCourseId) throw new Error('Canvas URL must include /courses/ID path');

  const headers = { 'Authorization': `Bearer ${canvasToken}` };
  const r = await fetch(`${baseUrl}/api/v1/courses/${canvasCourseId}/assignments/${canvasAssignmentId}?include[]=rubric_assessment`, { headers });
  if (!r.ok) throw new Error(`Canvas API error: ${r.status} — check token and assignment ID`);
  const data = await r.json();

  let rubricCriteria = null;
  let rubricText = '';

  if (data.rubric && data.rubric.length > 0) {
    rubricCriteria = data.rubric.map(criterion => ({
      id: criterion.id,
      name: criterion.description,
      maxPoints: criterion.points,
      ratings: (criterion.ratings || []).map(r => ({
        id: r.id,
        name: r.description,
        points: r.points,
        description: r.long_description || r.description
      }))
    }));

    rubricText = rubricCriteria.map((c, i) =>
      `CRITERION ${i+1}: ${c.name} (${c.maxPoints} pts)\n` +
      c.ratings.map(r => `- ${r.name} (${r.points} pts): ${r.description}`).join('\n')
    ).join('\n\n');
  }

  return {
    description: stripHtml(data.description),
    rubricCriteria,
    rubricText,
    maxScore: data.points_possible || assignment.max_score,
    name: data.name,
  };
}

// Re-fetch rubric criteria from Canvas and persist to the assignment row.
// Returns the criteria array, or null if Canvas isn't configured / no rubric attached.
async function refetchAndStoreRubricCriteria(assignmentId) {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!assignment) return null;
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(assignment.course_id);
  if (!course) return null;
  if (!course.canvas_url || !course.canvas_token || !assignment.canvas_assignment_id) return null;

  try {
    const result = await fetchCanvasAssignment(course, assignment);
    if (result.rubricCriteria && result.rubricCriteria.length > 0) {
      db.prepare('UPDATE assignments SET rubric_criteria=?, rubric=COALESCE(NULLIF(rubric, \'\'), ?) WHERE id=?')
        .run(JSON.stringify(result.rubricCriteria), result.rubricText, assignmentId);
      return result.rubricCriteria;
    }
  } catch(e) {
    console.error('[canvasimport] auto-refetch failed:', e.message);
  }
  return null;
}

// POST /api/canvasimport/assignment
// Fetches rubric + description from Canvas for a given assignment
router.post('/assignment', async (req, res) => {
  const { courseId, assignmentId, overrideCanvasId } = req.body;
  if (!courseId || !assignmentId) return res.status(400).json({ error: 'courseId and assignmentId required' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!course || !assignment) return res.status(404).json({ error: 'Not found' });

  try {
    const result = await fetchCanvasAssignment(course, assignment, overrideCanvasId);
    res.json({ ...result, haRubric: !!result.rubricCriteria });
  } catch(e) {
    console.error('Canvas import error:', e.message);
    const status = /not set|must include/i.test(e.message) ? 400 : 500;
    res.status(status).json({ error: e.message });
  }
});

module.exports = router;
module.exports.fetchCanvasAssignment = fetchCanvasAssignment;
module.exports.refetchAndStoreRubricCriteria = refetchAndStoreRubricCriteria;
