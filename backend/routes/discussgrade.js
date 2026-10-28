const { getModel, gradingParams, SCORING_RUBRIC_FIDELITY_RULE, SCORING_CONSISTENCY_RULE_BANDED } = require('../config');
const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { toFile } = Anthropic;
// Large PDFs can't be inlined as base64 (request exceeds the API's max size → 413).
// Upload them via the Files API and reference by file_id instead — keeps the request small.
const FILES_BETA = ['files-api-2025-04-14'];
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const { parseRubricCsv } = require('../parseRubricCsv');
const { scrubAiTells, scrubFields } = require('../lib/textVoice');
const { loadExamplesFor } = require('../lib/calibration');
const { parseGradingJson } = require('../lib/gradingResponse');
const { commentPolicySentence } = require('../lib/commentPolicy');
const { refetchAndStoreRubricCriteria } = require('./canvasimport');
const router = express.Router();

// Assignment instructions / rubric text often bake a presentation requirement into the
// wording (e.g. "Format your prompt in a code block"). The instructor never grades
// format, so we annotate those directives inline as not-graded before injecting the
// text into the grading prompt. Non-destructive: only the model's copy is affected.
function neutralizeFormatDirectives(text) {
  if (!text) return text;
  const PATTERN = /(code block|in a code block|using code blocks|format your (?:prompt|response|answer|post)|properly formatted|poorly formatted|formatting is (?:unclear|clear)|present(?:ed|ing)? .*\b(?:as a screenshot|as an image|in a table))/i;
  return text.split(/\r?\n/).map(line =>
    PATTERN.test(line)
      ? line + '  [⚠ FORMATTING INSTRUCTION — NOT GRADED. Ignore this completely. Never lower any criterion or call anything missing because of it.]'
      : line
  ).join('\n');
}

// Deterministic backstop for generated feedback text. The model sometimes volunteers
// code-block / formatting advice on its own even when nothing instructs it. Strip any
// sentence that does so (plus a trailing follow-on referring back to it) so feedback
// never critiques presentation, regardless of what the model returns.
function scrubFormatMentions(text) {
  if (!text) return text;
  const FORMAT = /(code[- ]?block|\bformatting\b|format your|properly formatted|poorly formatted|\bmarkdown\b|in a code block|use a code block|structure your (?:prompt|response)s? more cleanly)/i;
  const FOLLOWON = /^\s*(this|that|these|it|doing so)\b/i;
  // Split only at real sentence boundaries (punctuation + space + capital/quote) so
  // periods inside URLs like "artificialanalysis.ai" don't leave dangling fragments.
  const sentences = text.split(/(?<=[.!?])\s+(?=["“A-Z])/);
  let prevDropped = false;
  const kept = [];
  for (const s of sentences) {
    if (FORMAT.test(s) || (prevDropped && FOLLOWON.test(s))) { prevDropped = true; continue; }
    prevDropped = false;
    kept.push(s);
  }
  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return out || text;
}

// ─── Parse Canvas rubric CSV ──────────────────────────────────────────────

router.post('/parse-rubric', (req, res) => {
  const { csv } = req.body;
  try {
    // Header-driven parser (backend/parseRubricCsv.js) — robust to the differing
    // Canvas export column layouts. Throws Error with a user-readable message.
    const { criteria, totalMax } = parseRubricCsv(csv);
    res.json({ criteria, totalMax });
  } catch (e) {
    const userError = /required|no data rows|No criteria|No rating-points|check the CSV/i.test(e.message);
    res.status(userError ? 400 : 500).json({ error: e.message });
  }
});

// ─── Grade a discussion submission against a rubric ───────────────────────

router.post('/grade', async (req, res) => {
  // commentMode: 'all' | 'imperfect' | 'none'. The Canvas panel does not send
  // it today — it applies its dropdown client-side after the response, and can
  // only clear comments, never add them. So an absent mode means "generate for
  // every criterion" and let the client subtract; see lib/commentPolicy.js.
  const { courseId, assignmentId, studentName, discussionQuestion, submission, rubricCriteria: clientRubric, instructorBio, tone, sentences, submissionType, feedbackStyle, commentMode, syncOnly, manualGrade, screenshotData, attachedFiles } = req.body;

  // Sync-only mode — save manual Canvas grades back to platform without re-grading
  if (syncOnly && manualGrade && assignmentId && courseId) {
    try {
      const { v4: uuidv4 } = require('uuid');
      const existing = db.prepare('SELECT id FROM grades WHERE assignment_id=? AND course_id=? AND student_name=?').get(assignmentId, courseId, studentName);
      const scores = {};
      manualGrade.criteriaGrades?.forEach(cg => { scores[cg.criterionName] = cg.suggestedPoints; });
      if (existing) {
        db.prepare('UPDATE grades SET total=?,scores=?,instructor_paragraph=? WHERE id=?')
          .run(manualGrade.totalPoints || 0, JSON.stringify(scores), manualGrade.instructorParagraph || '', existing.id);
        return res.json({ id: existing.id, synced: true });
      } else {
        const gradeId = uuidv4();
        db.prepare('INSERT INTO grades (id,course_id,assignment_id,student_name,assignment_name,file_name,total,max_score,scores,comments,summary,key_strength,key_improvement,instructor_paragraph) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(gradeId, courseId, assignmentId, studentName, 'Discussion', 'discussion', manualGrade.totalPoints || 0, 75, JSON.stringify(scores), JSON.stringify({}), '', '', '', manualGrade.instructorParagraph || '');
        return res.json({ id: gradeId, synced: true });
      }
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
  const sentenceCount = parseInt(sentences) || 3;
  const isSkillAssessment = submissionType === 'skill';

  if (!submission) {
    return res.status(400).json({ error: 'submission required' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Fetch assignment from DB — use stored rubric and guidance if available
  const assignmentRecord = assignmentId
    ? db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId)
    : null;
  // Merge the assignment's grading_guidance with the COURSE-LEVEL universal
  // do-not-penalize, which applies to every assignment in the course.
  const assignmentGuidance = assignmentRecord?.grading_guidance || '';
  const courseGuidance = courseId
    ? (db.prepare('SELECT do_not_penalize FROM courses WHERE id=?').get(courseId)?.do_not_penalize || '')
    : '';
  const gradingGuidance = [courseGuidance, assignmentGuidance].filter(Boolean).join('\n');
  console.log('[discussgrade] assignmentId:', assignmentId);
  console.log('[discussgrade] assignment name:', assignmentRecord?.name || 'NOT FOUND');
  console.log('[discussgrade] grading_guidance:', gradingGuidance.slice(0, 100) || '(none)');
  console.log('[discussgrade] rubric_criteria stored:', !!assignmentRecord?.rubric_criteria);

  // Resolve rubric criteria. Priority order:
  //   1. Stored DB criteria (if present)
  //   2. Client-provided criteria
  //   3. Auto-fetch from Canvas as fallback
  // Only flag stored criteria as "stale" when the client ALSO sent a non-empty
  // rubric AND the names don't overlap. An empty client rubric means "I have
  // nothing to compare with" — never a reason to wipe stored data.
  let rubricCriteria = null;
  let stored = null;
  if (assignmentRecord?.rubric_criteria) {
    try {
      const parsed = JSON.parse(assignmentRecord.rubric_criteria);
      if (Array.isArray(parsed) && parsed.length > 0) stored = parsed;
    } catch(e) {}
  }

  if (stored && Array.isArray(clientRubric) && clientRubric.length > 0) {
    const storedNames = stored.map(c => (c.name || '').toLowerCase());
    const clientNames = clientRubric.map(c => (c.name || '').toLowerCase());
    const overlap = storedNames.filter(n =>
      clientNames.some(cn => cn.includes(n.slice(0,15)) || n.includes(cn.slice(0,15)))
    );
    if (overlap.length >= Math.min(2, stored.length)) {
      rubricCriteria = stored;
      console.log('[discussgrade] Using stored criteria (validated against client rubric)');
    } else {
      // Client clearly has a different rubric — trust the client and replace stored
      console.log('[discussgrade] Stored criteria differ from client rubric — using client and updating DB');
      rubricCriteria = clientRubric;
      db.prepare('UPDATE assignments SET rubric_criteria=? WHERE id=?')
        .run(JSON.stringify(clientRubric), assignmentId);
    }
  } else if (stored) {
    rubricCriteria = stored;
    console.log('[discussgrade] Using stored criteria (no client rubric to validate against)');
  } else if (Array.isArray(clientRubric) && clientRubric.length > 0) {
    rubricCriteria = clientRubric;
    console.log('[discussgrade] Using client criteria (nothing stored)');
  }

  // Fallback: auto-refetch from Canvas if we still have nothing
  if ((!rubricCriteria || rubricCriteria.length === 0) && assignmentId) {
    console.log('[discussgrade] No criteria found — attempting Canvas auto-refetch');
    const refetched = await refetchAndStoreRubricCriteria(assignmentId);
    if (refetched && refetched.length > 0) {
      rubricCriteria = refetched;
      console.log(`[discussgrade] Canvas auto-refetch succeeded — ${refetched.length} criteria restored`);
    }
  }

  if (!rubricCriteria?.length) {
    return res.status(400).json({ error: 'No rubric criteria found. Add rubric criteria to the assignment, or attach a rubric to it in Canvas and click Import from Canvas.' });
  }

  const criteriaText = rubricCriteria.map((c, i) => `
Criterion ${i + 1}: ${c.name} (max ${c.maxPoints} pts)
Rating levels:
${c.ratings.map(r => `  - ${r.name} (${r.points} pts): ${r.description}`).join('\n')}`
  ).join('\n');

  // Load calibration examples for this assignment. Pull a BALANCED spread across
  // quality tiers, not just the most recent — otherwise the newest examples (often
  // all "good") anchor the model high and undo strict grading. Round-robin across
  // good/borderline/weak so the model sees both strong and weak reference points.
  let exampleContext = '';
  if (assignmentId) {
    const poolSize = db.prepare('SELECT COUNT(*) n FROM examples WHERE assignment_id=?').get(assignmentId).n;
    const examples = loadExamplesFor(db, assignmentId, 6);
    if (examples.length) {
      const qLabel = q => ({ good: 'STRONG example', weak: 'WEAK example', borderline: 'BORDERLINE example' }[q] || `${q || 'unrated'} example`);
      exampleContext = '\n\nCALIBRATION EXAMPLES — real submissions this instructor already scored, spanning strong to weak. Use them to anchor your point values:\n' +
        examples.map(e => `[Instructor score: ${e.score} — ${qLabel(e.quality)}]\n${(e.content || '').slice(0, 500)}`).join('\n---\n');
    }
    const mix = examples.reduce((m, e) => (m[e.quality] = (m[e.quality] || 0) + 1, m), {});
    console.log(`[discussgrade] calibration examples injected: ${examples.length} of ${poolSize}`, mix);
  }

  // Scoring-consistency check. The Canvas "Always On Grader" panel is external
  // and can't send a per-request flag, so this surface is controlled by a backend
  // switch instead: on by default, set SCORING_CONSISTENCY=off in .env to disable.
  const consistencyOn = !['off', 'false', '0', 'no'].includes(String(process.env.SCORING_CONSISTENCY || '').toLowerCase());
  const consistencyRuleBlock = consistencyOn ? `\n\n${SCORING_RUBRIC_FIDELITY_RULE}\n\n${SCORING_CONSISTENCY_RULE_BANDED}` : '';
  // Diagnostic: confirms which rule version this running process actually loaded.
  // "flag-only loaded: true" means the non-harsh rewrite is active; "false" means
  // the process is running stale code and needs a restart.
  console.log('[discussgrade] scoring rules:', consistencyOn ? 'ON' : 'OFF',
    '| flag-only loaded:', SCORING_CONSISTENCY_RULE_BANDED.includes('FLAG-ONLY'),
    '| rubric-fidelity loaded:', typeof SCORING_RUBRIC_FIDELITY_RULE === 'string' && SCORING_RUBRIC_FIDELITY_RULE.includes('RUBRIC FIDELITY'));
  console.log('[discussgrade] comment mode:', commentMode || '(not sent - generating for every criterion)');

  // Honor the assignment's strictness dial and target average. Previously this
  // surface ignored both fields, so a "strict" assignment graded no differently
  // than a lenient one — every submission drifted to the top rating level. This
  // does NOT invent extra harshness: it just makes the rubric's own lower rating
  // levels get used when the work matches them, and aims for the instructor's target.
  const strictness = String(assignmentRecord?.grading_strictness || 'standard').toLowerCase();
  const targetAvg = Number(assignmentRecord?.target_avg) || null;
  const rubricMaxTotal = rubricCriteria.reduce((s, c) => s + (Number(c.maxPoints) || 0), 0) || Number(assignmentRecord?.max_score) || 0;
  const strictnessLine = {
    strict: "GRADING STRICTNESS: STRICT — apply the rubric to the letter. For each criterion, choose the rating level whose description the work ACTUALLY meets, and assign that level's points. Do not round up to a higher level for work that only partly meets it. When your own rationale names a genuine gap in a criterion, the score must sit at the lower rating level that gap corresponds to — a substantive gap you have named cannot also earn the top level. Reserve the top level for work that fully meets its description.",
    standard: "GRADING STRICTNESS: STANDARD — match each criterion to the rating level it earns. Award the top level only when the work meets that level's full description; use the lower defined levels when it does not.",
    lenient: "GRADING STRICTNESS: LENIENT — give the benefit of the doubt. Reward effort and correct direction even when execution is imperfect, while still selecting from the rubric's defined rating levels.",
  }[strictness] || null;
  const targetLine = (targetAvg && rubricMaxTotal)
    ? `\nTARGET AVERAGE: this instructor expects a class average near ${targetAvg} out of ${rubricMaxTotal} on this assignment. Score each submission on its actual quality against the rubric — strong work should still score high — but do not cluster every student at the ceiling. If your scores would put essentially everyone at or near full marks, re-read the rubric's middle rating levels and check you are not rounding partial work up.`
    : '';
  // Top-of-scale rule: the maximum means "exceptional, nothing left to improve" and
  // should be rare. Strong-but-improvable work tops out just under the ceiling. This
  // is proportional to the assignment max, so it works on any point scale. A perfect
  // score is allowed but never the default.
  const scoreCap = Number(assignmentRecord?.score_cap);
  const hasCap = Number.isFinite(scoreCap) && scoreCap > 0 && rubricMaxTotal && scoreCap < rubricMaxTotal;
  let topOfScaleLine = '';
  if (hasCap) {
    // Instructor set an explicit hard ceiling for this assignment.
    topOfScaleLine = `\nMAXIMUM SCORE — ABSOLUTE CAP: this instructor has set a hard ceiling of ${scoreCap} out of ${rubricMaxTotal} for this assignment. Do NOT award a total above ${scoreCap} to any submission, no matter how strong. ${scoreCap} is the maximum score possible here — treat it as if it were the top of the scale. Reserve ${scoreCap} itself for excellent work; strong work that still has room to grow should land below it. When you name a real area to improve, let the criterion it touches sit below its top value so the total stays at or under ${scoreCap}.`;
  } else if (rubricMaxTotal) {
    // No explicit cap: proportional "perfect is rare" default (~147.5 on a 150 scale).
    const normalCeiling = Math.round((rubricMaxTotal - rubricMaxTotal * 0.0167) * 2) / 2;
    topOfScaleLine = `\nTOP OF THE SCALE: almost every submission has a next level it could reach, so a perfect score is not a starting point. For strong, polished work that still has anywhere to grow, the top realistic total is ${normalCeiling} out of ${rubricMaxTotal}. Treat ${normalCeiling} as the normal ceiling and do not exceed it unless the work is genuinely exceptional. Totals between ${normalCeiling} and ${rubricMaxTotal} are reserved for exceptional work only, and the maximum (${rubricMaxTotal}) itself should be INCREDIBLY RARE — a submission with truly nothing left to improve. Never award ${rubricMaxTotal} by default and never park strong-but-improvable work at ${rubricMaxTotal}. Concretely: when you name a real area to improve, let the criterion it touches sit below its top value so the total lands at or under ${normalCeiling}.`;
  }
  // This block describes normal rubric application (choosing the earned rating
  // level). It is NOT the flag-only consistency check below — using a lower rating
  // level the work genuinely matches is correct grading, not a harshness adjustment.
  const strictnessBlock = strictnessLine ? `\n\n${strictnessLine}${targetLine}${topOfScaleLine}` : '';
  console.log('[discussgrade] strictness:', strictness, '| target:', targetAvg, '/', rubricMaxTotal, '| scoreCap:', hasCap ? scoreCap : 'none', '| topOfScale:', !!topOfScaleLine);

  const system = `You are ${instructorBio || 'an expert instructor'} grading a student discussion post. Read carefully before scoring anything.

═══════════════════════════════════════════════════════════
FORMATTING POLICY — ABSOLUTE, HIGHEST PRIORITY. Applies to EVERY assignment, always, whether or not instructor exceptions are listed below.
Never lower any criterion for formatting, presentation, or how anything is displayed. This includes code blocks, plain text, tables, screenshots, images, and how a prompt or code is shown. A rating level's description may require or reward a particular format (for example "using code blocks", or downgrading for "formatting is unclear" or "poorly formatted"). When it does, mentally cross out that part of the rating description and score the level the work earns on substance alone. Never drop a tier, pick a lower level, or call something missing because of how it is presented. This holds even if the rubric or assignment appears to require a specific format.
═══════════════════════════════════════════════════════════
${gradingGuidance ? `
═══════════════════════════════════════════════════════════
INSTRUCTOR EXCEPTIONS — ABSOLUTE, HIGHEST PRIORITY.
These override the rubric AND override any wording inside the rubric's own rating levels. Read them before you score anything.

${gradingGuidance}

How to apply them: a rating level's description may include wording that conflicts with an exception above (for example, requiring "code blocks", or downgrading for "formatting is unclear" or "poorly formatted"). When that happens, mentally cross out that part of the rating description and score the level the work earns on substance alone. Never drop a tier, and never pick a lower level, because of anything an exception above told you to ignore. If you are unsure whether an exception applies, assume it does and do NOT penalize.
═══════════════════════════════════════════════════════════
` : ''}
CRITICAL: Grade ONLY against the ${rubricCriteria.length} criteria listed below. Do not reference other assignments.

The criteria for THIS assignment:
${rubricCriteria.map((c,i) => `${i+1}. ${c.name}`).join('\n')}

GRADING STANDARDS:
- The rubric is the authority${gradingGuidance ? ', except where an instructor exception above overrides it (the exceptions always win)' : ''}. For each criterion, read EVERY rating level description below, decide which level the work actually matches, then assign that level's exact point value.
- The defined rating levels are the only valid scores. Use a half-point between two adjacent levels ONLY when the work genuinely sits between them. Do not invent a wider scale.
- Never score a criterion below its lowest defined rating level. That lowest level is the floor for that criterion.
- Quote or paraphrase the student's actual words as evidence for every score. No generic observations.
- If the student almost makes a key connection but misses it, say exactly what they missed.
- A missing required element affects only the one criterion that measures it. Never apply an across-the-board penalty.${strictnessBlock}
${exampleContext}${exampleContext ? "\nAnchor your scoring to these examples: match your point values to how this instructor scored comparable work above. If your score for a criterion would differ sharply from the pattern the examples establish, re-check it against the rubric." : ""}${consistencyRuleBlock}`;
  const VOICE_RULES = `VOICE RULES — NON-NEGOTIABLE:
No em-dashes (— or --). Use periods or commas instead.
No filler: never write "it's worth noting", "importantly", "overall", "in conclusion", "to be fair", "that said", "having said that", "I hope this helps", "I wanted to".
No AI tells: no "delves into", "showcases", "demonstrates a nuanced", "commendable", "impressive grasp", "testament to", "robust", "leverages".
No comparisons to other students. Never say "most students", "other students", "the class", "compared to peers", "one of the best", "stronger than most", "unlike your classmates". Each student is evaluated on their own work only.
Short sentences. Plain words. One idea per sentence.
Address the student directly as "you". Never use the student's name.
Sound like a person talking, not a rubric being read.
If something is missing, say it plainly. If something is strong, name exactly what is strong.`;

  const toneMap = {
    'plain-warm':    'Conversational and warm. Like a professor who has actually read the work and respects the student.',
    'plain':         'Direct and plain. Short sentences. No filler. Get to the point.',
    'conversational':'Talk to them like a person. Informal but substantive.',
    'encouraging':   'Lead with a specific strength. Be genuine, not generic.',
    'coach':         'Forward-looking and direct. Tell them what to do differently next time.',
    'formal':        'Professional but still human. No jargon.',
    'dave':          "Write in the instructor's voice. Warm but direct. Short sentences — if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' Structure: (1) specific strength — name what worked and why, not generic praise; (2) state the gap directly — 'What\\'s missing is...' or 'The problem is...' or 'Where this falls apart is...'; (3) one concrete next step; (4) forward momentum closing — 'Keep pushing on this.' or 'You\\'re on the right track.' or 'Start there.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
    'dave-plain':    "Write in the instructor's voice. Direct and compressed. Military-cadence delivery. Short sentences — if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' No warmth — strip all softening. Structure: (1) specific strength — name what worked and why, not generic praise; (2) state the gap directly — 'What\\'s missing is...' or 'The problem is...' or 'Where this falls apart is...'; (3) one concrete next step; (4) forward momentum closing — 'Keep pushing on this.' or 'Start there.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
    'dave-warm':     "Write in the instructor's voice. Warm and encouraging but still direct. Short sentences — if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' Acknowledge effort before naming the gap. Structure: (1) specific strength — name what worked and why, not generic praise; (2) acknowledge the effort or thinking behind the work; (3) state the gap directly but gently — 'What\\'s missing is...' or 'The piece that needs work is...'; (4) one concrete next step; (5) forward momentum closing — 'Keep pushing on this.' or 'You\\'re on the right track.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
  };
  const toneInstructions = (tone && !toneMap[tone]
    ? tone
    : (toneMap[tone] || toneMap['plain-warm'])) + '\n\n' + VOICE_RULES;

  const styleMap = {
    'balanced':       'Acknowledge a specific strength first, then address the most important gap clearly.',
    'strength-first': 'Open with what they genuinely did well — be specific. Then transition to what needs work.',
    'gap-first':      'Lead with the most important thing to fix. Then acknowledge what worked.',
    'growth':         'Frame everything in terms of growth — where they are, what the next level looks like, how to get there.',
    'direct':         'Skip the praise. Just tell them exactly what the work shows and what needs to change.',
  };
  const styleInstruction = styleMap[feedbackStyle] || styleMap['balanced'];

  // Per-criterion comments use the selected voice for TONE only. The voice's
  // paragraph-level scaffolding (its numbered 1-4 structure and its "preferred
  // phrases" openers) is written for the single overall summary paragraph — applying
  // it to every criterion makes them all open the same way (e.g. "This is strong work.").
  // This scope note keeps the voice tailorable while preventing that repetition.
  const COMMENT_SCOPE = ' These are short, standalone per-criterion notes — NOT the overall summary paragraph. Apply the voice above for TONE only; do NOT use its numbered paragraph structure or its "preferred phrases" here (those belong only to the summary paragraph). Each criterion\'s comment must open differently — never reuse the same opening sentence across criteria, and never lead with a stock phrase like "This is strong work." When it genuinely fits, quote or closely paraphrase the student\'s own words for THIS criterion so they can tell their specific work was read — but do not force a quote into every comment.';

  // Skill assessment mode: deeper, more pointed per-criterion feedback
  const criterionCommentInstruction = isSkillAssessment
    ? '2-4 sentences. ' + toneInstructions + COMMENT_SCOPE + ' Be specific and direct: name the exact gap, one concrete way to improve it, and what a stronger version would look like.'
    : '1-2 sentences. ' + toneInstructions + COMMENT_SCOPE + ' Name one concrete area to improve when there is one. ' + commentPolicySentence(commentMode);

  const paragraphInstruction = isSkillAssessment
    ? toneInstructions + ' ' + styleInstruction + ' Write EXACTLY ' + sentenceCount + ' sentences — no more, no fewer. Count them before finalizing. Quote or reference something the student actually wrote. Name the specific intellectual move they made. Be honest about gaps and give a concrete area to improve. End with something forward-looking. Max 20 words per sentence. Address the student as "you" throughout, never by name.'
    : toneInstructions + ' ' + styleInstruction + ' Write EXACTLY ' + sentenceCount + ' sentences — count them. Reference something the student actually wrote and name a concrete area to improve. Max 18 words per sentence. No jargon. Address the student as "you" throughout, never by name and never as "the student".';

  // Include full assignment description if available — this is what students were asked to do
  const assignmentInstructions = assignmentRecord?.description || '';

  const prompt = `ASSIGNMENT INSTRUCTIONS (what students were explicitly asked to do):
${neutralizeFormatDirectives(assignmentInstructions || discussionQuestion || 'No instructions provided')}

SUBMISSION:
${submission}

RUBRIC CRITERIA:
${criteriaText}

Grade this submission against the rubric criteria. The rubric is the authority, EXCEPT where the formatting policy or instructor exceptions at the top override it. Per the formatting policy, never let any rating level's wording about formatting, presentation, or how prompts or code are displayed pull the score down — this applies on every assignment, even with no instructor exceptions listed. Score each criterion using its own rating levels, matching the work to a level based on that level's description.
A missing required element should lower only the specific criterion that measures it. Do not invent requirements the rubric does not list, and do not lower other criteria for it.
If you cannot find evidence for a criterion, it may simply not be pasted here. Score what is present and say what you could not find. Do not assume failure or default a criterion to its floor just because content is absent from the text.
You MUST return a criteriaGrades entry for EVERY criterion — no exceptions.

REQUIRED CRITERIA (you must include all ${rubricCriteria.length} in your response):
${rubricCriteria.map((c, i) => `${i+1}. ${c.name}`).join('\n')}

Return ONLY valid JSON, no markdown fences:
{
  "criteriaGrades": [
    {
      "criterionId": "criterion id here",
      "criterionName": "criterion name",
      "suggestedRating": "Accomplished | Proficient | Needs Improvement | Unacceptable",
      "suggestedPoints": 14.5,
      "scoringRationale": "2-3 sentences. Reference the student's actual words or specific choices. Identify exactly what is strong or what is missing. If the student almost connects a key idea but misses it, say so. If a deliverable is absent or broken, call it out directly. Be a sharp reader, not a checklist.",
      "halfPointsOk": "scores like 12.5, 13.5 are valid — use them when the work is between tiers",
      "studentComment": "${criterionCommentInstruction}",
      "evidence": "brief quote or paraphrase from submission supporting this rating"${consistencyOn ? `,
      "consistencyFlag": false,
      "consistencyNote": "one sentence, ONLY when consistencyFlag is true — name how this criterion's score and its own comment/rationale disagree",
      "suggestedBand": "Accomplished | Proficient | Needs Improvement | Unacceptable — ONLY when consistencyFlag is true, the band the comment actually supports"` : ''}
    }
  ],
  "totalPoints": 72.5,
  "totalMax": 75,
  "instructorParagraph": "${paragraphInstruction}",
  "overallSummary": "1-2 sentence overall assessment"
}`;

  try {
    // Build message content — include all attached files (images + PDFs) + screenshot
    let messageContent;
    const uploadedFileIds = [];  // PDFs uploaded to Files API; cleaned up after grading
    const allFiles = attachedFiles || [];
    const hasScreenshot = screenshotData && screenshotData.startsWith('data:image/');
    const hasFiles = allFiles.length > 0;

    console.log('[discussgrade] screenshotData received:', screenshotData ? screenshotData.length + ' chars' : 'NONE');
    console.log('[discussgrade] attachedFiles received:', allFiles.length);

    // Add an image to the request. Small images inline as base64; large ones go through
    // the Files API (same fix used for large PDFs) so the request never blows the API's
    // size limit — the cause of the 500 on image-heavy PowerPoint submissions.
    const MAX_INLINE_IMAGE_BYTES = 3 * 1024 * 1024;      // one image over ~3MB -> Files API
    const MAX_TOTAL_INLINE_BYTES = 8 * 1024 * 1024;      // once inline total passes ~8MB, route the rest too
    let inlineImageBytes = 0;
    async function addImagePart(parts, base64Data, mediaType, label) {
      const approxBytes = Math.floor((base64Data || '').length * 0.75);
      if (approxBytes > MAX_INLINE_IMAGE_BYTES || inlineImageBytes + approxBytes > MAX_TOTAL_INLINE_BYTES) {
        try {
          const buf = Buffer.from(base64Data, 'base64');
          const ext = (mediaType.split('/')[1] || 'png').replace('jpeg', 'jpg');
          const uploaded = await client.beta.files.upload({
            file: await toFile(buf, `${(label || 'image').replace(/[^a-z0-9._-]/gi, '_')}.${ext}`, { type: mediaType }),
            betas: FILES_BETA,
          });
          uploadedFileIds.push(uploaded.id);
          parts.push({ type: 'image', source: { type: 'file', file_id: uploaded.id } });
          console.log('[discussgrade] Large image via Files API:', label, `${(approxBytes/1024/1024).toFixed(1)}MB ->`, uploaded.id);
          return;
        } catch (e) {
          console.warn('[discussgrade] Image Files API upload failed, inlining instead:', e.message);
        }
      }
      inlineImageBytes += approxBytes;
      parts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } });
    }

    if (hasFiles || hasScreenshot) {
      const parts = [];
      parts.push({ type: 'text', text: 'IMPORTANT: The attached files are part of the student submission. Examine ALL attached files BEFORE scoring any criterion. A table, image, or diagram showing original vs refined prompts counts as satisfying the before/after prompt requirement — even if the assignment says "code blocks". A screenshot of a prompt comparison table IS a valid before/after prompt submission. If a deliverable exists in any attached file in any format, do NOT penalize for it being missing. Only mark a deliverable missing if it is absent from both the text submission AND all attached files.' });

      // Add each attached file
      for (const file of allFiles) {
        if (!file.data) continue;
        const base64 = file.data.split(',')[1];
        const mediaType = file.data.split(';')[0].split(':')[1];

        if (mediaType === 'application/pdf') {
          // Upload via Files API (handles PDFs of any byte size); fall back to
          // inline base64 only if the upload itself fails.
          try {
            const pdfBuf = Buffer.from(base64, 'base64');
            const uploaded = await client.beta.files.upload({
              file: await toFile(pdfBuf, file.name || 'submission.pdf', { type: 'application/pdf' }),
              betas: FILES_BETA,
            });
            uploadedFileIds.push(uploaded.id);
            parts.push({ type: 'document', source: { type: 'file', file_id: uploaded.id } });
            console.log('[discussgrade] Uploaded PDF via Files API:', file.name, '->', uploaded.id);
          } catch (upErr) {
            console.warn('[discussgrade] Files API upload failed, inlining PDF instead:', upErr.message);
            parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
          }
        } else if (mediaType && mediaType.startsWith('image/')) {
          await addImagePart(parts, base64, mediaType, file.name);
          console.log('[discussgrade] Including image:', file.name);
        } else if (file.name && (file.name.endsWith('.pptx') || file.name.endsWith('.ppt'))) {
          // Extract text AND images from PowerPoint
          try {
            const JSZip = require('jszip');
            const buf = Buffer.from(base64, 'base64');
            const zip = await JSZip.loadAsync(buf);

            // Extract text from all slides
            const slideFiles = Object.keys(zip.files)
              .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
              .sort((a, b) => {
                const na = parseInt(a.match(/\d+/)?.[0] || 0);
                const nb = parseInt(b.match(/\d+/)?.[0] || 0);
                return na - nb;
              });

            // Get speaker notes files
            const notesFiles = Object.keys(zip.files)
              .filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
              .sort((a, b) => parseInt(a.match(/\d+/)?.[0]||0) - parseInt(b.match(/\d+/)?.[0]||0));

            let pptText = '';
            for (let idx = 0; idx < slideFiles.length; idx++) {
              const xml = await zip.files[slideFiles[idx]].async('string');
              const slideText = (xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [])
                .map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
              let notesText = '';
              if (notesFiles[idx]) {
                const notesXml = await zip.files[notesFiles[idx]].async('string');
                notesText = (notesXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [])
                  .map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
              }
              if (slideText || notesText) {
                pptText += `[Slide ${idx+1}]`;
                if (slideText) pptText += `: ${slideText}`;
                if (notesText) pptText += `\n  [Speaker Notes]: ${notesText}`;
                pptText += '\n';
              }
            }
            if (pptText) {
              parts.push({ type: 'text', text: 'ATTACHED POWERPOINT (' + file.name + '). Speaker notes are part of the submission — read them and count their content toward the rubric exactly like the slide content. If a required element or deliverable appears in a speaker note, treat that requirement as satisfied even if it is not on the slide itself:\n' + pptText });
              console.log('[discussgrade] Including PPTX text:', file.name, pptText.length, 'chars');
            }

            // Extract slide images/media
            const mediaFiles = Object.keys(zip.files).filter(n =>
              n.startsWith('ppt/media/') && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(n)
            );
            console.log('[discussgrade] PPTX images found:', mediaFiles.length);
            for (const imgPath of mediaFiles.slice(0, 8)) {
              const imgData = await zip.files[imgPath].async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const imgMediaType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
                                   ext === 'png' ? 'image/png' : 'image/jpeg';
              await addImagePart(parts, imgData, imgMediaType, imgPath.split('/').pop());
              console.log('[discussgrade] Including PPTX image:', imgPath);
            }
          } catch(e) {
            console.warn('[discussgrade] PPTX extraction failed:', e.message);
            parts.push({ type: 'text', text: 'ATTACHED FILE: ' + file.name + ' (could not extract)' });
          }
        } else if (file.name && (file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
          // Extract text AND images from Word doc
          try {
            const mammoth = require('mammoth');
            const JSZip = require('jszip');
            const buf = Buffer.from(base64, 'base64');

            // Extract text
            const result = await mammoth.extractRawText({ buffer: buf });
            if (result.value) {
              parts.push({ type: 'text', text: 'ATTACHED WORD DOCUMENT (' + file.name + '):\n' + result.value });
              console.log('[discussgrade] Including Word doc text:', file.name, result.value.length, 'chars');
            }

            // Extract embedded images
            const zip = await JSZip.loadAsync(buf);
            const imageFiles = Object.keys(zip.files).filter(n =>
              n.startsWith('word/media/') && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(n)
            );
            console.log('[discussgrade] Word doc images found:', imageFiles.length);
            for (const imgPath of imageFiles.slice(0, 5)) {
              const imgData = await zip.files[imgPath].async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const imgMediaType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
                                   ext === 'png' ? 'image/png' : 'image/jpeg';
              await addImagePart(parts, imgData, imgMediaType, imgPath.split('/').pop());
              console.log('[discussgrade] Including embedded image from Word doc:', imgPath);
            }
          } catch(e) {
            console.warn('[discussgrade] Word doc extraction failed:', e.message);
            parts.push({ type: 'text', text: 'ATTACHED FILE: ' + file.name + ' (could not extract text)' });
          }
        }
      }

      // Add auto-screenshot if no files attached
      if (!hasFiles && hasScreenshot) {
        const base64Data = screenshotData.split(',')[1];
        const mediaType = screenshotData.split(';')[0].split(':')[1];
        await addImagePart(parts, base64Data, mediaType, 'screenshot');
        console.log('[discussgrade] Including auto-screenshot');
      }

      parts.push({ type: 'text', text: prompt });
      messageContent = parts;
    } else {
      messageContent = prompt;
    }

    // Log approximate request size — the inlined portion is what risks the API size limit.
    if (Array.isArray(messageContent)) {
      const imgCount = messageContent.filter(p => p.type === 'image').length;
      console.log(`[discussgrade] request parts: ${messageContent.length} | images: ${imgCount} | inline image payload: ${(inlineImageBytes/1024/1024).toFixed(1)}MB | files via API: ${uploadedFileIds.length}`);
    }

    const createParams = {
      ...gradingParams(),
      // Thinking tokens count against this. At effort "high" the reasoning
      // alone runs ~2k, and the JSON for 5 criteria plus an 8-sentence
      // paragraph is another ~2k, so 4000 truncated mid-string. You are billed
      // for what is generated, not for the ceiling.
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content: messageContent }]
    };
    let resp;
    try {
      // File-referenced PDFs require the Files API beta; otherwise use the standard call.
      resp = uploadedFileIds.length
        ? await client.beta.messages.create({ ...createParams, betas: FILES_BETA })
        : await client.messages.create(createParams);
    } finally {
      // Best-effort cleanup so uploaded PDFs don't accumulate in the account.
      for (const fid of uploadedFileIds) {
        try { await client.beta.files.delete(fid, { betas: FILES_BETA }); }
        catch (delErr) { console.warn('[discussgrade] Could not delete uploaded file', fid, '-', delErr.message); }
      }
    }

    const result = parseGradingJson(resp, 'discussgrade');
    console.log(`[discussgrade] criteriaGrades returned: ${result.criteriaGrades?.length} items for ${rubricCriteria.length} criteria`);

    // Deterministic backstop: scrub any formatting/code-block critique the model
    // volunteered, from both the overall paragraph and each criterion comment.
    if (result.instructorParagraph) result.instructorParagraph = scrubFormatMentions(result.instructorParagraph);
    result.criteriaGrades?.forEach(cg => {
      if (cg.studentComment) cg.studentComment = scrubFormatMentions(cg.studentComment);
    });

    // Deterministic voice cleanup: guarantee no em-dashes, colons, or semicolons in any
    // generated prose the student sees, regardless of what the model returned. Leave
    // `evidence` alone — it may quote the student's own words verbatim.
    scrubFields(result, ['instructorParagraph', 'overallSummary']);
    scrubFields(result.criteriaGrades, ['studentComment', 'scoringRationale', 'consistencyNote']);

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

        // Match student record and set student_id
        if (studentName && studentName !== 'Unknown') {
          const students = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
          const nameLower = studentName.toLowerCase();
          const match = students.find(s => {
            const full = `${s.first_name} ${s.last_name}`.toLowerCase();
            const rev  = `${s.last_name} ${s.first_name}`.toLowerCase();
            return full === nameLower || rev === nameLower || (s.name || '').toLowerCase() === nameLower;
          }) || students.find(s => {
            const parts = nameLower.split(' ');
            const last = parts[parts.length - 1];
            const first = parts[0];
            return (s.last_name || '').toLowerCase() === last &&
                   (s.first_name || '').toLowerCase().startsWith(first[0]);
          });
          if (match) {
            db.prepare('UPDATE grades SET student_id=?, student_name=? WHERE id=?')
              .run(match.id, `${match.first_name} ${match.last_name}`.trim(), gradeId);
          }
        }

        result.gradeId = gradeId;
      } catch (e) {
        console.error('Grade save error:', e.message);
      }
    }

    // Auto-check for DO NOT PENALIZE violations
    if (gradingGuidance && result.criteriaGrades?.length && result.gradeId) {
      try {
        const { v4: uuidv4flag } = require('uuid');
        const dnpTerms = gradingGuidance.split(/[.,\n]/).map(s => s.trim()).filter(s => s.length > 8);
        for (const cg of result.criteriaGrades) {
          const comment = ((cg.studentComment || '') + ' ' + (cg.scoringRationale || '')).toLowerCase();
          for (const term of dnpTerms) {
            const termLower = term.toLowerCase().replace(/^(do not penalize|don't penalize|no penalty|ignore)[\s:]+/i, '').trim();
            if (termLower.length < 6) continue;
            if (comment.includes(termLower.slice(0, 20)) && (cg.suggestedPoints || 0) < (cg.maxPoints || 15)) {
              const exists = db.prepare(`SELECT id FROM grading_flags WHERE assignment_id=? AND student_name=? AND criterion_name=? AND flag_type='dnp-violation' AND status='open'`)
                .get(assignmentId, studentName, cg.criterionName);
              if (!exists) {
                db.prepare(`INSERT INTO grading_flags (id,course_id,assignment_id,student_name,grade_id,flag_type,criterion_name,message) VALUES (?,?,?,?,?,?,?,?)`)
                  .run(uuidv4flag(), courseId, assignmentId, studentName, result.gradeId, 'dnp-violation', cg.criterionName,
                    `"${cg.criterionName}" may have penalized "${termLower.slice(0,50)}" — this is in your DO NOT PENALIZE list.`);
                if (!result.flags) result.flags = [];
                result.flags.push({ type: 'dnp-violation', criterionName: cg.criterionName });
              }
            }
          }
        }
      } catch(e) { console.warn('Flag check error:', e.message); }
    }

    // Surface score/comment mismatches the model raised (scoring-consistency check).
    // The model keeps its score and comment as written and flags the disagreement;
    // these appear in the Flags tab so you can confirm before finalizing.
    if (consistencyOn && result.criteriaGrades?.length) {
      try {
        const { v4: uuidv4flag2 } = require('uuid');
        for (const cg of result.criteriaGrades) {
          if (!cg.consistencyFlag) continue;
          const msg = (cg.consistencyNote || 'This score may not match its comment.') +
            (cg.suggestedBand ? ` Suggested band: ${cg.suggestedBand}.` : '');
          if (!result.flags) result.flags = [];
          result.flags.push({ type: 'grading-review', criterionName: cg.criterionName, note: cg.consistencyNote || '', suggestedBand: cg.suggestedBand || '' });
          if (result.gradeId) {
            const exists = db.prepare(`SELECT id FROM grading_flags WHERE assignment_id=? AND student_name=? AND criterion_name=? AND flag_type='grading-review' AND status='open'`)
              .get(assignmentId, studentName, cg.criterionName);
            if (!exists) {
              db.prepare(`INSERT INTO grading_flags (id,course_id,assignment_id,student_name,grade_id,flag_type,criterion_name,message) VALUES (?,?,?,?,?,?,?,?)`)
                .run(uuidv4flag2(), courseId, assignmentId, studentName, result.gradeId, 'grading-review', cg.criterionName, msg);
            }
          }
        }
        if (result.flags?.some(f => f.type === 'grading-review')) {
          console.log(`[discussgrade] grading-review flags: ${result.flags.filter(f => f.type === 'grading-review').length}`);
        }
      } catch(e) { console.warn('[discussgrade] consistency flag error:', e.message); }
    }

    res.json(result);
  } catch (e) {
    // Surface the underlying Anthropic API status/type when present, so a bare "500"
    // in the UI becomes an actionable message (e.g. request_too_large, overloaded).
    const apiStatus = e.status || e.statusCode;
    const apiType = e.error?.error?.type || e.error?.type;
    console.error('[discussgrade] GRADING ERROR:', apiStatus || '', apiType || '', e.message, e.stack);
    const detail = [apiStatus && `HTTP ${apiStatus}`, apiType].filter(Boolean).join(' ');
    res.status(500).json({ error: detail ? `${detail}: ${e.message}` : e.message });
  }
});

module.exports = router;

// POST /api/discussgrade/regenerate-feedback
router.post('/regenerate-feedback', async (req, res) => {
  const { studentName, overallSummary, criteriaGrades, rubricCriteria,
          tone, length, directness, instructorBio } = req.body;

  const toneDesc = {
    formal: 'formal, academic, professional',
    plain: 'plain, conversational, direct — like talking to the student in office hours',
    warm: 'warm, encouraging, mentor-like'
  }[tone] || 'warm, direct, mentor-like';

  const lengthDesc = {
    short: '2-3 sentences, tight and punchy',
    medium: '3-4 sentences, standard',
    long: '4-5 sentences, more detailed'
  }[length] || '3-4 sentences';

  const directnessDesc = {
    soft: 'gentle, softening critical feedback',
    balanced: 'balanced, honest but kind',
    direct: 'direct and frank, no sugar-coating'
  }[directness] || 'balanced';

  const summary = criteriaGrades?.map(cg =>
    `${cg.criterionName}: ${cg.suggestedRating || ''} (${cg.suggestedPoints || 0}pts) — ${cg.scoringRationale || cg.studentComment || ''}`
  ).join('\n');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: getModel(),
      max_tokens: 400,
      system: `You are ${instructorBio || 'an instructor'} writing personalized feedback to a student.
Tone: ${toneDesc}
Length: ${lengthDesc}
Directness: ${directnessDesc}
Address the student as "you". Never use the student's name.
Cite something the student actually wrote, and name a concrete area to improve.
Writing style rules (apply to all generated text):
- No sentence may exceed 18 words. Break long sentences into two.
- Avoid colons, semicolons, and em dashes. Use periods instead.
- Write in plain, direct prose.`,
      messages: [{
        role: 'user',
        content: `Student: ${studentName}
Overall: ${overallSummary || ''}
Criterion scores:
${summary}

Write the instructor feedback paragraph with the specified tone, length, and directness.
Return ONLY the paragraph text, nothing else.`
      }]
    });
    const paragraph = scrubAiTells(resp.content.find(b => b.type === 'text')?.text?.trim() || '');
    res.json({ paragraph });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discussgrade/docx/:gradeId — download feedback as Word doc
router.get('/docx', async (req, res) => {
  const { studentName, courseName, assignmentName, date, criteria, feedback } = req.query;

  try {
    let gradeData;
    try {
      gradeData = JSON.parse(decodeURIComponent(req.query.data || '{}'));
    } catch (e) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel
    } = require('docx');

    const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const headerBg = { fill: '1E3A5F', type: ShadingType.CLEAR };
    const altBg = { fill: 'F0F4F8', type: ShadingType.CLEAR };

    const children = [];

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Discussion Grading Feedback', bold: true, size: 32, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 160 }
    }));

    // Course info
    [
      ['Course', gradeData.courseName || 'AIN 714 — AI Strategy and Innovation'],
      ['Assignment', gradeData.assignmentName || ''],
      ['Student', gradeData.studentName || ''],
      ['Date', gradeData.date || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })]
    ].forEach(([label, value]) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 22, font: 'Calibri' }),
          new TextRun({ text: value, size: 22, font: 'Calibri' })
        ],
        spacing: { after: 60 }
      }));
    });

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Section: Rubric Scores
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Rubric Scores', bold: true, size: 26, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 120 }
    }));

    // Rubric table
    const rubricRows = [
      // Header
      new TableRow({
        children: [
          new TableCell({
            borders, width: { size: 4500, type: WidthType.DXA },
            shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Criterion', bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
          }),
          new TableCell({
            borders, width: { size: 2500, type: WidthType.DXA },
            shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Rating', bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
          }),
          new TableCell({
            borders, width: { size: 2360, type: WidthType.DXA },
            shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Score', bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
          })
        ]
      })
    ];

    const criteriaData = gradeData.criteriaGrades || [];
    let total = 0;
    let totalMax = 0;

    criteriaData.forEach((cg, i) => {
      const pts = parseFloat(cg.finalPoints || cg.suggestedPoints || 0);
      const maxPts = cg.maxPoints || 15;
      total += pts;
      totalMax += maxPts;
      const shading = i % 2 === 1 ? altBg : { fill: 'FFFFFF', type: ShadingType.CLEAR };

      rubricRows.push(new TableRow({
        children: [
          new TableCell({
            borders, width: { size: 4500, type: WidthType.DXA },
            shading, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: cg.criterionName || '', size: 20, font: 'Calibri' })] })]
          }),
          new TableCell({
            borders, width: { size: 2500, type: WidthType.DXA },
            shading, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: cg.suggestedRating || '', size: 20, font: 'Calibri' })] })]
          }),
          new TableCell({
            borders, width: { size: 2360, type: WidthType.DXA },
            shading, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: `${pts}/${maxPts}`, bold: true, size: 20, font: 'Calibri' })] })]
          })
        ]
      }));
    });

    // Total row
    rubricRows.push(new TableRow({
      children: [
        new TableCell({
          borders, width: { size: 4500, type: WidthType.DXA },
          shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: 'TOTAL', bold: true, size: 22, font: 'Calibri', color: 'FFFFFF' })] })]
        }),
        new TableCell({
          borders, width: { size: 2500, type: WidthType.DXA },
          shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: '', size: 20, font: 'Calibri' })] })]
        }),
        new TableCell({
          borders, width: { size: 2360, type: WidthType.DXA },
          shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: `${total.toFixed(0)}/${totalMax}`, bold: true, size: 22, font: 'Calibri', color: 'FFFFFF' })] })]
        })
      ]
    }));

    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4500, 2500, 2360],
      rows: rubricRows
    }));

    children.push(new Paragraph({ spacing: { after: 240 } }));

    // Section: Scoring Rationale
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Scoring Rationale (Instructor Reference)', bold: true, size: 26, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 120 }
    }));

    criteriaData.forEach(cg => {
      if (!cg.scoringRationale && !cg.studentComment) return;
      children.push(new Paragraph({
        children: [new TextRun({ text: `${cg.criterionName} (${cg.finalPoints || cg.suggestedPoints}/${cg.maxPoints || 15})`, bold: true, size: 22, font: 'Calibri' })],
        spacing: { before: 160, after: 60 }
      }));
      const rationale = cg.scoringRationale || cg.studentComment || '';
      children.push(new Paragraph({
        children: [new TextRun({ text: rationale, size: 20, font: 'Calibri' })],
        spacing: { after: 80 }
      }));
    });

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Section: Instructor Feedback
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Instructor Feedback to Student', bold: true, size: 26, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 120 }
    }));

    const feedbackText = gradeData.instructorParagraph || '';
    const sentences = feedbackText.split(/(?<=[.!?])\s+/).filter(Boolean);
    sentences.forEach(sentence => {
      children.push(new Paragraph({
        indent: { left: 720 },
        children: [new TextRun({ text: sentence, size: 22, font: 'Calibri', italics: true })],
        spacing: { after: 80 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '2563EB', space: 8 } }
      }));
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      sections: [{
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safe = (gradeData.studentName || 'student').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}_discussion_feedback.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('DOCX error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/discussgrade/save-as-example — promote a graded discussion to calibration bank
router.post('/save-as-example', async (req, res) => {
  const { assignmentId, courseId, studentName, submission, criteriaGrades, totalPoints, totalMax, instructorParagraph, scores } = req.body;
  if (!assignmentId || !courseId) return res.status(400).json({ error: 'assignmentId and courseId required' });

  const { v4: uuidv4 } = require('uuid');

  // Build content string from submission + scoring rationale
  const rationaleLines = (criteriaGrades || []).map(cg => {
    const shortName = (cg.criterionName || '').split(':').pop().trim();
    return `${shortName} (${cg.finalPoints || cg.suggestedPoints}/${cg.maxPoints || 15}): ${cg.scoringRationale || cg.studentComment || ''}`;
  }).join('\n');

  const content = [
    'SUBMISSION:\n' + (submission || '').slice(0, 1000),
    '\nSCORING RATIONALE:\n' + rationaleLines,
    instructorParagraph ? '\nINSTRUCTOR FEEDBACK:\n' + instructorParagraph : ''
  ].filter(Boolean).join('\n');

  const score = parseFloat(totalPoints) || 0;
  const max = parseFloat(totalMax) || 75;
  const quality = score / max >= 0.8 ? 'good' : 'weak';

  try {
    db.prepare(`
      INSERT INTO examples (id, assignment_id, course_id, student_name, score, quality, notes, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), assignmentId, courseId, studentName,
      score, quality,
      `Discussion calibration example — ${score}/${max} pts`,
      content
    );
    res.json({ ok: true, quality, score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
