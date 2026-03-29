const express = require('express');
const router = express.Router();
const { db, parseGrade } = require('../db');
const { v4: uuidv4 } = require('uuid');
const Anthropic = require('@anthropic-ai/sdk');

// Ensure batch_grades table
db.prepare(`CREATE TABLE IF NOT EXISTS batch_grades (
  id TEXT PRIMARY KEY,
  course_id TEXT NOT NULL,
  assignment_id TEXT NOT NULL,
  student_name TEXT NOT NULL,
  canvas_user_id TEXT,
  status TEXT DEFAULT 'pending',
  submission_text TEXT,
  criteria_grades TEXT,
  instructor_paragraph TEXT,
  total_points REAL,
  max_score REAL,
  error TEXT,
  approved_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
)`).run();

// GET /api/batchgrade?courseId=X&assignmentId=Y
router.get('/', (req, res) => {
  const { courseId, assignmentId } = req.query;
  const rows = db.prepare('SELECT * FROM batch_grades WHERE course_id=? AND assignment_id=? ORDER BY created_at DESC')
    .all(courseId, assignmentId);
  res.json(rows.map(r => ({
    ...r,
    criteriaGrades: r.criteria_grades ? JSON.parse(r.criteria_grades) : [],
  })));
});

// POST /api/batchgrade/start — kick off batch grading for all students
router.post('/start', async (req, res) => {
  const { courseId, assignmentId } = req.body;
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!course || !assignment) return res.status(404).json({ error: 'Not found' });

  const canvasUrl = (course.canvas_url || '').replace(/\/$/, '');
  const canvasToken = course.canvas_token;
  const canvasAssignmentId = assignment.canvas_assignment_id;
  console.log('[batchgrade] canvasUrl:', canvasUrl ? 'set' : 'MISSING');
  console.log('[batchgrade] canvasToken:', canvasToken ? 'set' : 'MISSING');
  console.log('[batchgrade] canvasAssignmentId:', canvasAssignmentId || 'MISSING');

  if (!canvasUrl || !canvasToken || !canvasAssignmentId)
    return res.status(400).json({ error: 
      !canvasUrl ? 'Canvas URL not set — go to Course Settings → Canvas Integration' :
      !canvasToken ? 'Canvas token not set — go to Course Settings → Canvas Integration' :
      'Canvas Assignment ID not set — go to Assignments → Edit → Canvas Assignment ID field'
    });

  const urlMatch = canvasUrl.match(/courses\/(\d+)/);
  const canvasCourseId = urlMatch?.[1];
  const baseUrl = canvasUrl.replace(/\/courses\/.*/, '');
  const headers = { 'Authorization': `Bearer ${canvasToken}` };

  // Fetch all discussion entries
  try {
    const topicResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/discussion_topics?assignment_id=${canvasAssignmentId}&per_page=50`,
      { headers }
    );
    if (!topicResp.ok) throw new Error(`Canvas topic fetch error: ${topicResp.status}`);
    const topics = await topicResp.json();
    const topic = topics[0];
    if (!topic) return res.status(400).json({ error: 'No discussion topic found for this assignment' });

    const entriesResp = await fetch(
      `${baseUrl}/api/v1/courses/${canvasCourseId}/discussion_topics/${topic.id}/entries?per_page=100&include[]=author`,
      { headers }
    );
    const entries = await entriesResp.json();

    // Get replies for each entry
    const studentSubmissions = {};
    for (const entry of entries) {
      const userId = String(entry.user_id);
      const name = entry.author?.display_name || entry.user?.display_name || `User ${userId}`;
      const div = require('node-html-parser') ? '' : '';
      const text = entry.message?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
      if (!studentSubmissions[userId]) studentSubmissions[userId] = { name, texts: [], userId };
      studentSubmissions[userId].texts.push(text);

      // Fetch replies
      const repliesResp = await fetch(
        `${baseUrl}/api/v1/courses/${canvasCourseId}/discussion_topics/${topic.id}/entries/${entry.id}/replies?per_page=50`,
        { headers }
      );
      if (repliesResp.ok) {
        const replies = await repliesResp.json();
        for (const reply of replies) {
          if (String(reply.user_id) === userId) {
            const replyText = reply.message?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || '';
            studentSubmissions[userId].texts.push('PEER RESPONSE: ' + replyText);
          }
        }
      }
    }

    // Create pending batch grade records
    const students = Object.values(studentSubmissions);
    let created = 0, updated = 0;
    for (const s of students) {
      const existing = db.prepare('SELECT id, status FROM batch_grades WHERE assignment_id=? AND canvas_user_id=?')
        .get(assignmentId, s.userId);
      if (!existing) {
        db.prepare(`INSERT INTO batch_grades (id,course_id,assignment_id,student_name,canvas_user_id,status,submission_text)
          VALUES (?,?,?,?,?,?,?)`)
          .run(uuidv4(), courseId, assignmentId, s.name, s.userId, 'pending', s.texts.join('\n\n'));
        created++;
      } else if (existing.status === 'error') {
        // Reset errored records so they can be regraded
        db.prepare('UPDATE batch_grades SET status=?, submission_text=?, error=NULL WHERE id=?')
          .run('pending', s.texts.join('\n\n'), existing.id);
        updated++;
      }
    }

    res.json({ created, updated, total: students.length, message: `${created} new, ${updated} reset from error — ${students.length} total` });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/batchgrade/grade-one — grade a single pending record
router.post('/grade-one', async (req, res) => {
  const { batchId, tone, sentences, commentMode, feedbackStyle } = req.body;
  const record = db.prepare('SELECT * FROM batch_grades WHERE id=?').get(batchId);
  if (!record) return res.status(404).json({ error: 'Record not found' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(record.course_id);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(record.assignment_id);
  if (!course || !assignment) return res.status(404).json({ error: 'Course/assignment not found' });

  // Get rubric criteria
  let rubricCriteria = [];
  if (assignment.rubric_criteria) {
    try { rubricCriteria = JSON.parse(assignment.rubric_criteria); } catch(e) {}
  }
  if (!rubricCriteria.length) return res.status(400).json({ error: 'No rubric criteria found for this assignment' });

  const gradingGuidance = assignment.grading_guidance || '';
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const criteriaText = rubricCriteria.map((c, i) => {
    const ratings = c.ratings?.map(r => `  - ${r.name} (${r.points}pts): ${r.description || r.name}`).join('\n') || '';
    return `${i+1}. ${c.name} (max ${c.maxPoints}pts)\n${ratings}`;
  }).join('\n\n');

  const sentenceCount = parseInt(sentences) || 3;
  const toneMap = {
    'plain-warm': 'Write in plain, conversational English. Be warm but not stiff.',
    'plain': 'Write in plain, direct English. Short sentences. No filler.',
    'conversational': 'Write like you are talking to the student directly.',
    'encouraging': 'Be genuinely encouraging. Lead with what they did well.',
    'coach': 'Sound like a coach. Be direct and forward-looking.',
    'formal': 'Use professional academic language.',
  };
  const styleMap = {
    'balanced': 'Acknowledge a specific strength, then address the most important gap.',
    'strength-first': 'Open with what they genuinely did well, then transition to gaps.',
    'gap-first': 'Lead with the most important thing to fix, then acknowledge strengths.',
    'growth': 'Frame everything in terms of growth and next level.',
    'direct': 'Skip praise. Tell them exactly what the work shows and what needs to change.',
  };
  const toneInstructions = toneMap[tone] || toneMap['plain-warm'];
  const styleInstructions = styleMap[feedbackStyle] || styleMap['balanced'];
  const commentInstruction = commentMode === 'none' ? 'Leave studentComment empty for all criteria.' :
    commentMode === 'all' ? 'Write a studentComment for every criterion.' :
    'Write a studentComment only for criteria that are not perfect.';

  const VOICE_RULES = `VOICE RULES: No em-dashes. No filler phrases (it's worth noting, importantly, overall, that said). No AI tells (delves into, showcases, robust, testament to, commendable). No comparisons to other students — never mention most students, the class, peers, or class performance. Each student is evaluated on their own work only. Short sentences. Plain words. Start with first name only. Sound like a person, not a rubric.`;

  const system = `You are grading a student discussion post for ${course.name}.
Grade ONLY against the ${rubricCriteria.length} criteria below.
Half-point scores are valid. Reference the student's actual words.
If a deliverable exists in any format (table, image reference, screenshot), count it as meeting the requirement.
${gradingGuidance ? `\nHARD RULES — DO NOT PENALIZE FOR:\n${gradingGuidance}` : ''}`;

  const prompt = `ASSIGNMENT: ${assignment.name}
${assignment.description ? `\nINSTRUCTIONS:\n${assignment.description}\n` : ''}
STUDENT: ${record.student_name}
SUBMISSION:
${record.submission_text}

RUBRIC:
${criteriaText}

Return ONLY valid JSON:
{
  "criteriaGrades": [
    {
      "criterionId": "id",
      "criterionName": "name",
      "suggestedRating": "Accomplished|Proficient|Needs Improvement|Unacceptable",
      "suggestedPoints": 14,
      "scoringRationale": "instructor-only rationale referencing actual student work",
      "studentComment": "${commentInstruction}"
    }
  ],
  "totalPoints": 68,
  "totalMax": 75,
  "instructorParagraph": "${toneInstructions} ${styleInstructions} ${VOICE_RULES} Start with first name. ${sentenceCount} sentences. Max 20 words per sentence.",
  "overallSummary": "1-2 sentence summary"
}`;

  try {
    db.prepare('UPDATE batch_grades SET status=? WHERE id=?').run('grading', batchId);

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const result = JSON.parse(text.replace(/```json\n?|```/g, '').trim());

    db.prepare(`UPDATE batch_grades SET status='graded', criteria_grades=?, instructor_paragraph=?,
      total_points=?, max_score=?, updated_at=datetime('now') WHERE id=?`)
      .run(JSON.stringify(result.criteriaGrades || []), result.instructorParagraph || '',
        result.totalPoints || 0, result.totalMax || assignment.max_score, batchId);

    res.json({ ...result, batchId, status: 'graded' });
  } catch(e) {
    db.prepare('UPDATE batch_grades SET status=?, error=? WHERE id=?').run('error', e.message, batchId);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/batchgrade/approve — approve a batch grade (save to grades table)
router.post('/approve', async (req, res) => {
  const { batchId, adjustedGrades } = req.body;
  const record = db.prepare('SELECT * FROM batch_grades WHERE id=?').get(batchId);
  if (!record) return res.status(404).json({ error: 'Not found' });

  const criteriaGrades = adjustedGrades || JSON.parse(record.criteria_grades || '[]');
  const total = criteriaGrades.reduce((s, c) => s + (c.suggestedPoints || 0), 0);
  const scores = {};
  criteriaGrades.forEach(cg => { scores[cg.criterionName] = cg.suggestedPoints; });

  const gradeId = uuidv4();
  try {
    db.prepare(`INSERT INTO grades (id,course_id,assignment_id,student_name,assignment_name,file_name,
      total,max_score,scores,comments,summary,instructor_paragraph)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(gradeId, record.course_id, record.assignment_id, record.student_name,
        'Discussion Grade', 'discussion', total, record.max_score || 75,
        JSON.stringify(scores), JSON.stringify(criteriaGrades),
        '', record.instructor_paragraph || '');

    db.prepare(`UPDATE batch_grades SET status='approved', approved_at=datetime('now') WHERE id=?`).run(batchId);
    res.json({ gradeId, approved: true });
  } catch(e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/batchgrade/pending-for-student — extension calls this to pre-fill rubric
router.get('/pending-for-student', (req, res) => {
  const { courseId, assignmentId, canvasUserId } = req.query;
  const record = db.prepare(`SELECT * FROM batch_grades WHERE course_id=? AND assignment_id=? 
    AND canvas_user_id=? AND status IN ('graded','approved') ORDER BY updated_at DESC LIMIT 1`)
    .get(courseId, assignmentId, canvasUserId);
  if (!record) return res.json(null);
  res.json({
    ...record,
    criteriaGrades: record.criteria_grades ? JSON.parse(record.criteria_grades) : []
  });
});

// DELETE /api/batchgrade/:id
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM batch_grades WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// POST /api/batchgrade/:id/reset — reset a graded/errored record back to pending
router.post('/:id/reset', (req, res) => {
  db.prepare('UPDATE batch_grades SET status=?, grade_json=NULL, error=NULL WHERE id=?')
    .run('pending', req.params.id);
  const record = db.prepare('SELECT * FROM batch_grades WHERE id=?').get(req.params.id);
  res.json(record || { ok: true });
});

module.exports = router;
