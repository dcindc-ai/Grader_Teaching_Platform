const express = require('express');
const router = express.Router();
const { db, parseCourse, parseAssignment } = require('../db');

// POST /api/canvasimport/assignment
// Fetches rubric + description from Canvas for a given assignment
router.post('/assignment', async (req, res) => {
  const { courseId, assignmentId, overrideCanvasId } = req.body;
  if (!courseId || !assignmentId) return res.status(400).json({ error: 'courseId and assignmentId required' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!course || !assignment) return res.status(404).json({ error: 'Not found' });

  const canvasUrl = (course.canvas_url || '').replace(/\/$/, '');
  const canvasToken = course.canvas_token;
  const canvasAssignmentId = overrideCanvasId || assignment.canvas_assignment_id;

  if (!canvasUrl || !canvasToken) return res.status(400).json({ error: 'Canvas URL and token not set in Course Settings' });
  if (!canvasAssignmentId) return res.status(400).json({ error: 'Canvas Assignment ID not set on this assignment' });

  const urlMatch = canvasUrl.match(/courses\/(\d+)/);
  const canvasCourseId = urlMatch?.[1];
  const baseUrl = canvasUrl.replace(/\/courses\/.*/, '');
  if (!canvasCourseId) return res.status(400).json({ error: 'Canvas URL must include /courses/ID path' });

  const headers = { 'Authorization': `Bearer ${canvasToken}` };

  try {
    // Fetch assignment from Canvas
    const r = await fetch(`${baseUrl}/api/v1/courses/${canvasCourseId}/assignments/${canvasAssignmentId}?include[]=rubric_assessment`, { headers });
    if (!r.ok) throw new Error(`Canvas API error: ${r.status} — check token and assignment ID`);
    const data = await r.json();

    // Strip HTML from description
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

    const description = stripHtml(data.description);
    const maxScore = data.points_possible || assignment.max_score;

    // Parse rubric if present
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

    res.json({
      description,
      rubricCriteria,
      rubricText,
      maxScore,
      name: data.name,
      haRubric: !!rubricCriteria
    });

  } catch(e) {
    console.error('Canvas import error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
