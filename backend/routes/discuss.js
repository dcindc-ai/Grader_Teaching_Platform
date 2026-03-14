const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { readJSON, writeJSON, uuid, now } = require('../data/helpers');

const router = express.Router();
const DISCUSS_PATH = './data/discussions.json';

function buildReplyPrompt(course, question, sentenceCount) {
  const isFour = sentenceCount === 4;
  const questionPos = isFour ? 'THIRD' : 'FOURTH';
  const closePos = isFour ? 'FOURTH' : 'FIFTH';
  const countWord = isFour ? 'FOUR' : 'FIVE';
  const countLower = isFour ? 'four' : 'five';

  const bioSection = course.instructorBio
    ? `About you:\n${course.instructorBio}\n\n`
    : '';

  return `You are the instructor for ${course.fullName} (${course.name}) at ${course.institution}.

${bioSection}Your voice: ${course.voiceGuidelines || 'Casual, direct, warm, and real. Not stiff or academic. Sharp mentor who genuinely enjoys their students. Plain language, keep it tight.'}

The discussion question you asked the class was:
---
${question}
---

When given a student's name and their discussion post, generate ONLY your instructor reply with EXACTLY these rules:
1. Exactly ${countWord} sentences. No more, no fewer.
2. The FIRST sentence must be a short warm direct address to the student. Example: "Hey Maria, really strong intro here." Never restate or quote the student's post in the first sentence.
3. Each sentence must be no more than 15 words.
4. The ${questionPos} sentence must be a genuine curious question sparked by something specific they wrote.
5. The ${closePos} sentence must close warmly, commending the student for a thoughtful response.
6. Use casual openers, contractions, and plain English. No formal or flowery language.
7. Never use em dashes. Use commas, periods, or conjunctions instead.
8. Use the student's first name EXACTLY ONCE, in the first sentence only.
9. Never restate, summarize, or quote the student's content anywhere. React to it instead.
10. Engage with one specific interesting thing they wrote. No generic praise.
11. Make the closing feel warm and encouraging but not over the top. Sound real.

Return ONLY the ${countLower} sentences. No preamble, no labels, no extra content.`;
}

function buildSummaryPrompt(course, question) {
  const bioSection = course.instructorBio ? `About you:\n${course.instructorBio}\n\n` : '';

  return `You are the instructor for ${course.fullName} (${course.name}) at ${course.institution}.

${bioSection}You have collected discussion post responses from your students. The discussion question was:
---
${question}
---

Analyze all the student responses and write a warm, engaging class summary that:
1. Highlights the most common themes and goals across students
2. Notes interesting patterns in how students approached the question
3. Calls out 2-3 of the most compelling or creative ideas students mentioned
4. Ends with an encouraging note about the class as a whole

Write in a casual, direct, mentor tone. Plain English, no jargon, no bullet points. Flowing paragraphs. Under 200 words. This will be shared back with the students.`;
}

async function callClaude(system, userMessage) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    system,
    messages: [{ role: 'user', content: userMessage }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() || '';
}

// POST /api/discuss/reply
router.post('/reply', async (req, res) => {
  const { courseId, question, studentName, studentResponse } = req.body;
  const courses = readJSON('./data/courses.json', []);
  const course = courses.find(c => c.id === courseId);
  if (!course) return res.status(400).json({ error: 'Course not found' });

  const sentenceCount = Math.random() < 0.5 ? 4 : 5;
  try {
    const text = await callClaude(
      buildReplyPrompt(course, question, sentenceCount),
      `Student name: ${studentName}\n\nStudent's answer:\n${studentResponse}\n\nWrite only your instructor reply.`
    );

    // Log to discussion history
    const discussions = readJSON(DISCUSS_PATH, []);
    const entry = {
      id: uuid(),
      courseId,
      question,
      studentName,
      studentResponse,
      instructorReply: text,
      sentenceCount,
      createdAt: now()
    };
    discussions.unshift(entry);
    writeJSON(DISCUSS_PATH, discussions);

    res.json({ reply: text, id: entry.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/discuss/summary
router.post('/summary', async (req, res) => {
  const { courseId, question, submissions } = req.body;
  const courses = readJSON('./data/courses.json', []);
  const course = courses.find(c => c.id === courseId);
  if (!course) return res.status(400).json({ error: 'Course not found' });

  const allResponses = submissions.map((s, i) =>
    `Student ${i + 1} (${s.name}):\n${s.answer}`
  ).join('\n\n===\n\n');

  try {
    const text = await callClaude(
      buildSummaryPrompt(course, question),
      `Here are the student responses:\n\n${allResponses}`
    );
    res.json({ summary: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discuss/history?courseId=
router.get('/history', (req, res) => {
  let history = readJSON(DISCUSS_PATH, []);
  if (req.query.courseId) history = history.filter(d => d.courseId === req.query.courseId);
  res.json(history);
});

module.exports = router;
