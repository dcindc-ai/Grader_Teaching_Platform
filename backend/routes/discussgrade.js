const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

// ─── Parse Canvas rubric CSV ──────────────────────────────────────────────

router.post('/parse-rubric', (req, res) => {
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'csv required' });

  try {
    const lines = csv.trim().split('\n');
    const criteria = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Parse CSV with quoted fields
      const fields = [];
      let field = '', inQuote = false;
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '"') { inQuote = !inQuote; continue; }
        if (line[c] === ',' && !inQuote) { fields.push(field); field = ''; continue; }
        field += line[c];
      }
      fields.push(field);

      if (fields.length < 6) continue;
      const criteriaName = fields[1]?.trim();
      if (!criteriaName) continue;

      const ratings = [];
      // Ratings start at index 4, groups of 3 (name, description, points)
      for (let j = 4; j + 2 < fields.length; j += 3) {
        const name = fields[j]?.trim();
        const desc = fields[j + 1]?.trim();
        const pts = parseFloat(fields[j + 2]);
        if (name && !isNaN(pts)) ratings.push({ name, description: desc, points: pts });
      }

      if (ratings.length > 0) {
        criteria.push({
          id: uuidv4(),
          name: criteriaName,
          maxPoints: Math.max(...ratings.map(r => r.points)),
          ratings
        });
      }
    }

    const totalMax = criteria.reduce((a, c) => a + c.maxPoints, 0);
    res.json({ criteria, totalMax });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Grade a discussion submission against a rubric ───────────────────────

router.post('/grade', async (req, res) => {
  const { courseId, assignmentId, studentName, discussionQuestion, submission, rubricCriteria, instructorBio } = req.body;

  if (!submission || !rubricCriteria?.length) {
    return res.status(400).json({ error: 'submission and rubricCriteria required' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const criteriaText = rubricCriteria.map((c, i) => `
Criterion ${i + 1}: ${c.name} (max ${c.maxPoints} pts)
Rating levels:
${c.ratings.map(r => `  - ${r.name} (${r.points} pts): ${r.description}`).join('\n')}`
  ).join('\n');

  const system = `You are ${instructorBio || 'an instructor'} grading a student discussion post.

Be fair, specific, and constructive. Grade based on what the student actually wrote, not what they could have written.
Be direct — if something is missing, say so clearly. Use the student's first name.`;

  const prompt = `DISCUSSION QUESTION:
${discussionQuestion || 'No question provided'}

STUDENT: ${studentName}
SUBMISSION:
${submission}

RUBRIC CRITERIA:
${criteriaText}

Grade this submission against each criterion. Return ONLY valid JSON, no markdown fences:
{
  "criteriaGrades": [
    {
      "criterionId": "criterion id here",
      "criterionName": "criterion name",
      "suggestedRating": "Accomplished | Proficient | Needs Improvement | Unacceptable",
      "suggestedPoints": 14.5,
      "comment": "2-3 sentence specific comment on this criterion. Be specific about what they did well or missed.",
      "evidence": "quote or paraphrase from their submission that supports this rating"
    }
  ],
  "totalPoints": 72.5,
  "totalMax": 75,
  "instructorParagraph": "3-4 sentence personalized feedback paragraph in instructor voice. Start with first name, acknowledge specific strengths, give honest critical feedback, forward-looking close. No em dashes.",
  "overallSummary": "1-2 sentence overall assessment"
}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const result = JSON.parse(text.replace(/```json\n?|```/g, '').trim());

    // Save to grades table if assignment provided
    if (assignmentId && courseId) {
      const gradeId = uuidv4();
      const scores = {};
      result.criteriaGrades?.forEach(cg => { scores[cg.criterionName] = cg.suggestedPoints; });

      try {
        db.prepare(`
          INSERT INTO grades (id,course_id,assignment_id,student_name,assignment_name,file_name,total,max_score,scores,comments,summary,key_strength,key_improvement,instructor_paragraph)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          gradeId, courseId, assignmentId, studentName || 'Unknown',
          'Discussion Grade', 'discussion', result.totalPoints || 0, result.totalMax || 75,
          JSON.stringify(scores), JSON.stringify(result.criteriaGrades || []),
          result.overallSummary || '', '', '', result.instructorParagraph || ''
        );
        result.gradeId = gradeId;
      } catch (e) {
        console.error('Grade save error:', e.message);
      }
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
