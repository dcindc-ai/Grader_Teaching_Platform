const { getModel } = require('../config');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

// Assignment/question text frequently bakes a presentation requirement right into the
// instructions (e.g. "Format your prompt in a code block"). The instructor never grades
// format, so we defuse those directives INLINE — annotating them as not-graded right
// where the model reads them — before the text is ever injected into a prompt. This is
// non-destructive: it only affects the copy sent to the model, never the stored record.
function neutralizeFormatDirectives(text) {
  if (!text) return text;
  const PATTERN = /(code block|in a code block|using code blocks|format your (?:prompt|response|answer|post)|properly formatted|poorly formatted|formatting is (?:unclear|clear)|present(?:ed|ing)? .*\b(?:as a screenshot|as an image|in a table))/i;
  return text.split(/\r?\n/).map(line =>
    PATTERN.test(line)
      ? line + '  [⚠ FORMATTING INSTRUCTION — NOT GRADED. Ignore this completely. Never tell the student to do it and never treat skipping it as missing, required, or a weakness.]'
      : line
  ).join('\n');
}

// Deterministic backstop. Even with the formatting policy, the model sometimes
// volunteers code-block / formatting advice on its own ("share it in a code block for
// reproducibility" is a generic trope). This strips any sentence that does so — plus a
// trailing follow-on sentence that refers back to it — so the final feedback NEVER
// contains formatting critique, no matter what the model returns.
function scrubFormatMentions(text) {
  if (!text) return text;
  const FORMAT = /(code[- ]?block|\bformatting\b|format your|properly formatted|poorly formatted|\bmarkdown\b|in a code block|use a code block|structure your (?:prompt|response)s? more cleanly)/i;
  const FOLLOWON = /^\s*(this|that|these|it|doing so)\b/i;
  // Split only at real sentence boundaries — terminal punctuation followed by
  // whitespace and a capital/quote. Avoids breaking on periods inside URLs like
  // "artificialanalysis.ai", which would otherwise leave dangling fragments.
  const sentences = text.split(/(?<=[.!?])\s+(?=["“A-Z])/);
  let prevDropped = false;
  const kept = [];
  for (const s of sentences) {
    if (FORMAT.test(s) || (prevDropped && FOLLOWON.test(s))) { prevDropped = true; continue; }
    prevDropped = false;
    kept.push(s);
  }
  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return out || text; // never return empty
}

function buildReplyPrompt({ course, question, tone, sentenceCount, wordsPerSentence, structure, voiceRules, gradingGuidance }) {
  const bio = course.instructor_bio ? `About you:\n${course.instructor_bio}\n\n` : '';

  // GLOBAL formatting policy — applies to EVERY assignment, whether or not it has
  // its own instructor exceptions. The instructor never deducts for how something is
  // presented, so the feedback writer must never raise it.
  const formatPolicy = `FORMATTING POLICY — ABSOLUTE, HIGHEST PRIORITY. This applies to every submission no matter what:
Never mention formatting, presentation, or how anything is displayed as a weakness, a gap, a missing element, a "required" element, or something to improve. This covers code blocks, plain text, tables, screenshots, images, and how a prompt or code is shown. Never tell the student to put a prompt "in a code block", and never say a particular format is required or expected. Never claim that presentation affects rigor, methodology, reproducibility, or how easy something is to verify. This holds even if the question or rubric appears to ask for a specific format.

`;

  const exceptions = gradingGuidance ? `INSTRUCTOR EXCEPTIONS — ABSOLUTE, HIGHEST PRIORITY. These override everything else below:
${gradingGuidance}
Never describe anything covered by these exceptions as a weakness, a gap, or "missing". If unsure whether an exception applies, assume it does and do not raise it.

` : '';

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
${bio}${formatPolicy}${exceptions}Tone: ${toneDesc}
Structure: ${structureDesc}
Sentence count: exactly ${sentenceCount} sentences
Max words per sentence: ${wordsPerSentence} words — strictly enforced, break any longer sentence into two
No colons, semicolons, or em dashes — use periods only
Address the student directly as "you". Never use the student's name, first or full.

The discussion question was:
---
${neutralizeFormatDirectives(question)}
---
The task text above may include presentation instructions such as "Format your prompt in a code block". Those are NOT graded. Ignore every such instruction completely. Do not mention code blocks, formatting, or how anything is displayed, and never say a format was required or missing.

Write a feedback paragraph that:
1. Addresses what the student did specifically well, quoting or paraphrasing their actual words
2. Names the 1-2 weakest areas explicitly and directly, and says concretely how to improve each
3. If a required element is genuinely missing (e.g. a citation, a peer response, a direct answer to the prompt question), call it out by name. NEVER count formatting, presentation, or how a prompt or code is displayed as a missing or required element — per the formatting policy above, that is never a valid weakness, even if it seems required. Also never raise anything the instructor exceptions tell you to ignore
4. Notes any peer responses specifically if they are strong or weak
5. Closes with a concrete forward-looking instruction

Do NOT restate or summarize the prompt. Do NOT be generic. Quote or reference specific things from their post.
${voiceRules ? '\nAdditional voice rules (always follow these):\n' + voiceRules : ''}

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
    model: getModel(), max_tokens: 800, system,
    messages: [{ role: 'user', content: userMessage }]
  });
  return resp.content.find(b => b.type === 'text')?.text?.trim() || '';
}

router.post('/reply', async (req, res) => {
  const {
    courseId, assignmentId, question, studentName, studentResponse,
    tone = 'warm', sentenceCount = 6, wordsPerSentence = 18, structure = 'organized',
    refinement = '', previousResponse = '', voiceRules = ''
  } = req.body;

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!course) return res.status(400).json({ error: 'Course not found' });

  // Pull the assignment's DO-NOT-PENALIZE / instructor exceptions so the feedback
  // writer honors them too (not just the rubric scorer). Merge in the COURSE-LEVEL
  // universal do-not-penalize, which applies to every assignment in the course.
  const assignmentGuidance = assignmentId
    ? (db.prepare('SELECT grading_guidance FROM assignments WHERE id=?').get(assignmentId)?.grading_guidance || '')
    : '';
  const courseGuidance = course.do_not_penalize || '';
  const gradingGuidance = [courseGuidance, assignmentGuidance].filter(Boolean).join('\n');

  try {
    let userMessage;
    if (refinement && previousResponse) {
      userMessage = `Student submission:\n${studentResponse}\n\nYour previous response was:\n${previousResponse}\n\nRevision instruction: ${refinement}\n\nRewrite the response applying this instruction. Keep what works, change what the instruction specifies.`;
    } else {
      userMessage = `Student submission:\n${studentResponse}\n\nWrite your instructor feedback paragraph.`;
    }
    const rawReply = await callClaude(
      buildReplyPrompt({ course, question, tone, sentenceCount, wordsPerSentence, structure, voiceRules, gradingGuidance }),
      userMessage
    );
    const reply = scrubFormatMentions(rawReply);
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

// GET /api/discuss/students — all students with discussion history for a course
router.get('/students', (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  const rows = db.prepare(`
    SELECT student_name,
      COUNT(*) as response_count,
      MAX(created_at) as last_seen,
      MIN(created_at) as first_seen
    FROM discussions
    WHERE course_id=?
    GROUP BY LOWER(student_name)
    ORDER BY student_name ASC
  `).all(courseId);

  res.json(rows);
});

// GET /api/discuss/student — all entries for one student
router.get('/student', (req, res) => {
  const { courseId, studentName } = req.query;
  if (!courseId || !studentName) return res.status(400).json({ error: 'courseId and studentName required' });

  const rows = db.prepare(`
    SELECT * FROM discussions
    WHERE course_id=? AND LOWER(student_name) LIKE LOWER(?)
    ORDER BY created_at DESC
  `).all(courseId, `%${studentName.split(' ')[0]}%`);

  res.json(rows);
});
