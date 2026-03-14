const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

function buildReplyPrompt({ course, question, tone, sentenceCount, wordsPerSentence, structure }) {
  const bio = course.instructor_bio ? `About you:\n${course.instructor_bio}\n\n` : '';

  const toneDesc = {
    warm: 'warm, mentor-like, encouraging but honest',
    direct: 'plain and direct — no softening, just clear honest feedback',
    formal: 'professional and academic in register'
  }[tone] || 'warm but direct';

  const structureDesc = {
    organized: 'organized — start with what worked, then name weaknesses explicitly, then close with forward direction',
    flowing: 'flowing prose — weave strengths and weaknesses together naturally',
    critical: 'lead with the gaps first, then acknowledge strengths, then close'
  }[structure] || 'organized';

  return `You are the instructor for ${course.full_name || course.name} at ${course.institution || 'Wake Forest University'}.
${bio}
Tone: ${toneDesc}
Structure: ${structureDesc}
Sentence count: exactly ${sentenceCount} sentences
Max words per sentence: ${wordsPerSentence} words — strictly enforced, break any longer sentence into two
No colons, semicolons, or em dashes — use periods only
Use the student's first name once, at the start

The discussion question was:
---
${question}
---

Write a feedback paragraph that:
1. Addresses what the student did specifically well (reference their actual content)
2. Names the 1-2 weakest areas explicitly and directly
3. If a required element is missing (e.g. a citation, a peer response, a direct answer to the prompt question), call it out by name
4. Notes any peer responses specifically if they are strong or weak
5. Closes with a concrete forward-looking instruction

Do NOT restate or summarize the prompt. Do NOT be generic. Reference specific things from their post.
Return ONLY the feedback paragraph. Nothing else.`;
}

function buildSummaryPrompt(course, question) {
  const bio = course.instructor_bio ? `About you:\n${course.instructor_bio}\n\n` : '';
  return `You are the instructor for ${course.full_name || course.name} at ${course.institution}.
${bio}
The discussion question was:
---
${question}
---
Write a warm class summary: highlight common themes, interesting patterns, 2-3 compelling ideas, and end with encouragement.
Casual, direct tone. No bullet points. Under 200 words. Will be shared with students.
No sentence over 18 words. No em dashes, colons, or semicolons.`;
}

async function callClaude(system, userMessage) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514', max_tokens: 800, system,
    messages: [{ role: 'user', content: userMessage }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() || '';
}

router.post('/reply', async (req, res) => {
  const {
    courseId, question, studentName, studentResponse,
    tone = 'warm', sentenceCount = 6, wordsPerSentence = 18, structure = 'organized'
  } = req.body;

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!course) return res.status(400).json({ error: 'Course not found' });

  try {
    const reply = await callClaude(
      buildReplyPrompt({ course, question, tone, sentenceCount, wordsPerSentence, structure }),
      `Student name: ${studentName}\n\nStudent submission:\n${studentResponse}\n\nWrite your instructor feedback paragraph.`
    );
    const id = uuidv4();
    db.prepare('INSERT INTO discussions (id,course_id,question,student_name,student_response,instructor_reply,sentence_count) VALUES (?,?,?,?,?,?,?)')
      .run(id, courseId, question, studentName, studentResponse, reply, sentenceCount);
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
