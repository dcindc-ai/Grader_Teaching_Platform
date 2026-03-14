const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

function parseCourseRow(row) {
  if (!row) return null;
  return { ...row, sliders: JSON.parse(row.sliders||'{}') };
}

function buildReplyPrompt(course, question, count) {
  const isFour = count === 4;
  const qPos = isFour ? 'THIRD' : 'FOURTH';
  const cPos = isFour ? 'FOURTH' : 'FIFTH';
  const cWord = isFour ? 'FOUR' : 'FIVE';
  const cLow = isFour ? 'four' : 'five';
  const bio = course.instructor_bio ? `About you:\n${course.instructor_bio}\n\n` : '';
  const voice = course.voice_guidelines || 'Casual, direct, warm, real. Sharp mentor. Plain language.';

  return `You are the instructor for ${course.full_name} (${course.name}) at ${course.institution}.

${bio}Your voice: ${voice}

The discussion question was:
---
${question}
---

Generate your instructor reply with EXACTLY these rules:
1. Exactly ${cWord} sentences. No more, no fewer.
2. First sentence: short warm direct address. Example: "Hey Maria, really strong intro here." Never restate or quote the student's post.
3. Each sentence max 15 words.
4. The ${qPos} sentence must be a genuine curious question sparked by something specific they wrote.
5. The ${cPos} sentence closes warmly — commending but not over the top. Sound real.
6. Casual openers, contractions, plain English. No em dashes.
7. Student's first name EXACTLY ONCE, first sentence only.
8. Never restate, summarize, or quote student content. React to it.
9. Engage with one specific interesting thing they wrote. No generic praise.

Return ONLY the ${cLow} sentences. Nothing else.`;
}

function buildSummaryPrompt(course, question) {
  const bio = course.instructor_bio ? `About you:\n${course.instructor_bio}\n\n` : '';
  return `You are the instructor for ${course.full_name} at ${course.institution}.
${bio}
The discussion question was:
---
${question}
---
Write a warm class summary: highlight common themes, interesting patterns, 2-3 compelling ideas, and end with encouragement. Casual, direct tone. No bullet points. Under 200 words. Will be shared with students.`;
}

async function callClaude(system, userMessage) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 500, system,
    messages: [{ role: 'user', content: userMessage }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() || '';
}

router.post('/reply', async (req, res) => {
  const { courseId, question, studentName, studentResponse } = req.body;
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!course) return res.status(400).json({ error: 'Course not found' });
  const count = Math.random() < 0.5 ? 4 : 5;
  try {
    const reply = await callClaude(
      buildReplyPrompt(course, question, count),
      `Student name: ${studentName}\n\nStudent answer:\n${studentResponse}\n\nWrite only your instructor reply.`
    );
    const id = uuidv4();
    db.prepare('INSERT INTO discussions (id,course_id,question,student_name,student_response,instructor_reply,sentence_count) VALUES (?,?,?,?,?,?,?)')
      .run(id, courseId, question, studentName, studentResponse, reply, count);
    res.json({ reply, id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/summary', async (req, res) => {
  const { courseId, question, submissions } = req.body;
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!course) return res.status(400).json({ error: 'Course not found' });
  const allResponses = submissions.map((s,i) => `Student ${i+1} (${s.name}):\n${s.answer}`).join('\n\n===\n\n');
  try {
    const summary = await callClaude(buildSummaryPrompt(course, question), `Here are the student responses:\n\n${allResponses}`);
    res.json({ summary });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/history', (req, res) => {
  const { courseId } = req.query;
  const rows = courseId
    ? db.prepare('SELECT * FROM discussions WHERE course_id=? ORDER BY created_at DESC LIMIT 200').all(courseId)
    : db.prepare('SELECT * FROM discussions ORDER BY created_at DESC LIMIT 200').all();
  res.json(rows);
});

module.exports = router;
