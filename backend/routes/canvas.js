const express = require('express');
const router = express.Router();
const { db, parseCourse } = require('../db');

// GET /api/canvas/submissions?courseId=X&assignmentId=Y
// Fetches discussion submissions from Canvas for a given assignment
router.get('/submissions', async (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (!courseId || !assignmentId) return res.status(400).json({ error: 'courseId and assignmentId required' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!course) return res.status(404).json({ error: 'Course not found' });

  const canvasUrl = course.canvas_url?.replace(/\/$/, '');
  const canvasToken = course.canvas_token;
  if (!canvasUrl || !canvasToken) {
    return res.status(400).json({ error: 'Canvas URL and token not configured. Add them in Course Settings.' });
  }

  // Get the Canvas assignment ID from our assignment record
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

  const canvasAssignmentId = assignment.canvas_assignment_id;
  if (!canvasAssignmentId) {
    return res.status(400).json({ error: 'Canvas assignment ID not set. Edit the assignment and add the Canvas assignment ID.' });
  }

  const headers = {
    'Authorization': `Bearer ${canvasToken}`,
    'Content-Type': 'application/json'
  };

  try {
    // Get Canvas course ID from canvasUrl — stored as part of the URL or separately
    // Extract from canvas_url pattern like https://institution.instructure.com/courses/12345
    const courseIdMatch = canvasUrl.match(/courses\/(\d+)/);
    const canvasCourseId = courseIdMatch ? courseIdMatch[1] : null;
    const baseUrl = canvasUrl.replace(/\/courses\/.*/, '');

    if (!canvasCourseId) {
      return res.status(400).json({ error: 'Canvas URL should include the course path, e.g. https://wakeforest.instructure.com/courses/81230' });
    }

    // Get discussion topic ID from assignment
    const assnResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/assignments/${canvasAssignmentId}`,
      { headers }
    );
    if (!assnResp.ok) throw new Error(`Canvas API error ${assnResp.status} — check your token`);
    const canvasAssignment = await assnResp.json();
    const topicId = canvasAssignment.discussion_topic?.id;
    if (!topicId) return res.status(400).json({ error: 'Assignment is not a discussion topic in Canvas' });

    // Get enrolled students
    const studentsResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/students?per_page=100`,
      { headers }
    );
    const students = studentsResp.ok ? await studentsResp.json() : [];
    const studentMap = {};
    students.forEach(s => { studentMap[s.id] = s.name || s.short_name || String(s.id); });

    // Get discussion entries
    const entriesResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/discussion_topics/${topicId}/entries?per_page=100`,
      { headers }
    );
    if (!entriesResp.ok) throw new Error(`Could not fetch entries: ${entriesResp.status}`);
    const entries = await entriesResp.json();

    // Get full thread for replies
    const viewResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/discussion_topics/${topicId}/view`,
      { headers }
    );
    const fullThread = viewResp.ok ? await viewResp.json() : { view: [] };

    // Build per-student submission map
    const submissions = {};

    // Initial posts
    for (const entry of entries) {
      const uid = entry.user_id;
      if (!submissions[uid]) submissions[uid] = { studentId: uid, studentName: studentMap[uid] || String(uid), posts: [] };
      const text = stripHtml(entry.message || '');
      if (text) submissions[uid].posts.push({ type: 'initial', text });
    }

    // Replies from full thread
    function collectReplies(items) {
      for (const item of items || []) {
        const uid = item.user_id;
        if (!submissions[uid]) submissions[uid] = { studentId: uid, studentName: studentMap[uid] || String(uid), posts: [] };
        const text = stripHtml(item.message || '');
        if (text && item.parent_id) {
          submissions[uid].posts.push({ type: 'reply', text });
        }
        collectReplies(item.replies);
      }
    }
    collectReplies(fullThread.view);

    // Format final list
    const result = Object.values(submissions)
      .filter(s => s.posts.length > 0)
      .map(s => ({
        studentId: s.studentId,
        studentName: s.studentName,
        submissionText: s.posts.map((p, i) =>
          p.type === 'initial' ? p.text : `[Peer Response ${i}] ${p.text}`
        ).join('\n\n---\n\n')
      }));

    res.json({ submissions: result, assignmentName: canvasAssignment.name, topicId });
  } catch (e) {
    console.error('Canvas fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = router;
