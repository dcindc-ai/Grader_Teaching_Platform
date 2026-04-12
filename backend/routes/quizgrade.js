const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');

const router = express.Router();

const TONE_MAP = {
  'plain-warm':    'Conversational and warm. Like a professor who has actually read the work.',
  'plain':         'Direct and plain. Short sentences. No filler.',
  'conversational':'Talk to them like a person. Informal but substantive.',
  'encouraging':   'Lead with a specific strength. Be genuine, not generic.',
  'coach':         'Forward-looking and direct. Tell them what to do differently.',
  'formal':        'Professional but still human. No jargon.',
  'dave':          "Write in the instructor's voice. Warm but direct. Short sentences -- if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' Structure: (1) specific strength -- name what worked and why, not generic praise; (2) state the gap directly -- 'What's missing is...' or 'The problem is...' or 'Where this falls apart is...'; (3) one concrete next step; (4) forward momentum closing -- 'Keep pushing on this.' or 'You're on the right track.' or 'Start there.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
  'dave-plain':    "Write in the instructor's voice. Direct and compressed. Military-cadence delivery. Short sentences -- if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' No warmth -- strip all softening. Structure: (1) specific strength; (2) state the gap directly; (3) one concrete next step; (4) forward momentum closing. Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
  'dave-warm':     "Write in the instructor's voice. Warm and encouraging but still direct. Short sentences. Use 'you' and 'I' throughout, never passive voice. Contractions by default. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' Acknowledge effort before naming the gap. Structure: (1) specific strength; (2) acknowledge effort; (3) state gap gently; (4) one concrete next step; (5) forward momentum closing. Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
};

const VOICE_RULES = "VOICE RULES: No em-dashes. No filler phrases (it's worth noting, importantly, overall, that said). No AI tells (delves into, showcases, robust, testament to, commendable). No comparisons to other students. Short sentences. Plain words.";

// POST /api/quizgrade
// Body: { questions: [{ questionText, studentResponse, maxPoints, scoringComments }], tone }
router.post('/', async (req, res) => {
  try {
    const { questions, tone } = req.body;

    if (!questions || !Array.isArray(questions) || questions.length === 0) {
      return res.status(400).json({ error: 'questions array is required' });
    }

    const toneInstruction = TONE_MAP[tone] || TONE_MAP['plain-warm'];
    const client = new Anthropic();
    const results = [];

    for (const q of questions) {
      const { questionText, studentResponse, maxPoints, scoringComments } = q;

      if (!studentResponse || !studentResponse.trim()) {
        results.push({
          score: 0,
          maxPoints: maxPoints || 0,
          feedback: 'No response provided.',
        });
        continue;
      }

      const systemPrompt = `You are an expert instructor grading a quiz essay question.

QUESTION:
${questionText}

POINT VALUE: ${maxPoints} points

${scoringComments ? `SCORING GUIDE (answer comments from the instructor — use these to determine what a correct answer looks like):
${scoringComments}` : 'No specific scoring guide provided. Grade based on the quality and completeness of the response relative to the question.'}

FEEDBACK VOICE:
${toneInstruction}
${VOICE_RULES}

INSTRUCTIONS:
1. Read the student's response carefully.
2. Compare it against the question requirements and the scoring guide (if provided).
3. Assign a score out of ${maxPoints} points. Use decimals if appropriate (e.g. 6.5).
4. Write exactly ONE sentence of feedback. Be specific about what the student did well or what they missed.

Return ONLY valid JSON, no markdown fences:
{"score": <number>, "feedback": "<one sentence>"}`;

      const message = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        messages: [
          { role: 'user', content: `STUDENT RESPONSE:\n${studentResponse}` },
        ],
        system: systemPrompt,
      });

      const text = message.content[0].text.trim();
      let parsed;
      try {
        // Strip markdown fences if present
        const clean = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
        parsed = JSON.parse(clean);
      } catch (e) {
        // Fallback: try to extract score and feedback from text
        const scoreMatch = text.match(/"score"\s*:\s*([\d.]+)/);
        const fbMatch = text.match(/"feedback"\s*:\s*"([^"]+)"/);
        parsed = {
          score: scoreMatch ? parseFloat(scoreMatch[1]) : 0,
          feedback: fbMatch ? fbMatch[1] : text.slice(0, 200),
        };
      }

      results.push({
        score: Math.min(parsed.score, maxPoints),
        maxPoints,
        feedback: parsed.feedback || '',
      });
    }

    res.json({ results });
  } catch (e) {
    console.error('Quiz grade error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
