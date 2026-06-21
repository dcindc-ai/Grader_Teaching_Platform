// Central configuration shared across backend routes.
//
// Model selection, single source of truth:
//   - If ANTHROPIC_MODEL is set in .env, that exact model is pinned (escape hatch).
//   - Otherwise, on startup we query Anthropic's Models API and auto-select the
//     newest claude-opus-* model (today: claude-opus-4-8; auto-upgrades to the
//     next Opus when released).
//   - If that lookup fails (offline, API down), we fall back to FALLBACK so the
//     grader still boots and grades instead of hard-failing.
//
// Routes must call getModel() at request time (not capture it at import), because
// the auto-selected value is filled in asynchronously during startup.
const Anthropic = require('@anthropic-ai/sdk');

const FALLBACK = 'claude-opus-4-8';

// Current effective model. Starts as the pin (if any) or the fallback, then gets
// overwritten by resolveModel() once the API lookup completes.
let resolved = process.env.ANTHROPIC_MODEL || FALLBACK;

function getModel() {
  return resolved;
}

// Resolve the model to use. Called once at server startup. Safe to await; never throws.
async function resolveModel() {
  // Explicit pin always wins — skip the network call entirely.
  if (process.env.ANTHROPIC_MODEL) {
    resolved = process.env.ANTHROPIC_MODEL;
    return resolved;
  }
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.models.list({ limit: 100 });
    const latestOpus = res.data
      .filter(m => typeof m.id === 'string' && m.id.startsWith('claude-opus'))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (latestOpus) resolved = latestOpus.id;
  } catch (e) {
    console.warn(`[config] Could not auto-select latest Opus model (${e.message}); using ${resolved}`);
  }
  return resolved;
}

// ─── Scoring-consistency rule ────────────────────────────────────────────
// Application-level grading behavior (not assignment-specific). Each numeric
// score must match the severity of the issues described in that score's own
// comment. Injected into the grading prompts only when the per-request
// flagConsistency switch is on, so it is fully reversible. Two phrasings:
// one for rubric-criteria grading (rating bands), one for points-only grading.

// Banded version — used by the rubric-criteria grader (web app).
const SCORING_CONSISTENCY_RULE_BANDED = `SCORING CONSISTENCY CHECK (apply to every criterion before finalizing its score):
A criterion's numeric score must match the severity of the issues described in that same criterion's own comment.
- If the comment describes only minor, cosmetic, or stylistic issues (typos, a missing cross-reference, small clarity gaps), the top rating band is fine.
- If the comment describes a substantive flaw, the score should drop at least one band below the top. Substantive means a required element is missing, or the work contradicts itself internally (for example, one section analyzes components that were never defined in the section that was supposed to define them).
- The test for substantive vs. cosmetic: a flaw is substantive when fixing it requires reworking content, not just relabeling or correcting surface errors.
Do NOT change the overall grading generosity or shift the score distribution up or down across the board. Benefit of the doubt still applies to ambiguity, interpretation, and minor omissions. It does NOT apply to missing required elements or internal contradictions.
Do NOT silently reconcile a mismatch by softening the comment or nudging the score. If, after this check, a criterion's comment and score still appear to disagree, leave BOTH exactly as written and flag it: set "consistencyFlag": true, write a one-sentence "consistencyNote" naming the disagreement, and set "suggestedBand" to the band the comment actually supports. When the comment and score agree, set "consistencyFlag": false.`;

// Points-only version — used by the quiz/essay grader (browser extension).
const SCORING_CONSISTENCY_RULE_POINTS = `SCORING CONSISTENCY CHECK:
The points you assign must match the severity of what you say in your feedback sentence.
- If your feedback notes that a required part of the answer is missing or wrong, the score must NOT be full or near-full — a substantive gap costs real points.
- Cosmetic issues alone (a typo, slightly unclear phrasing) do not require a deduction.
- A flaw is substantive when fixing it requires reworking the answer's content, not just surface wording.
Do NOT change overall generosity or shift scores up or down across the board. Benefit of the doubt still applies to ambiguity and minor omissions, never to a missing required element.
Do NOT silently reconcile a mismatch. If your sentence describes a substantive gap but your score is high, leave both as written and flag it: set "consistencyFlag": true and write a one-sentence "consistencyNote" naming the disagreement. Otherwise set "consistencyFlag": false.`;

module.exports = {
  getModel,
  resolveModel,
  FALLBACK,
  SCORING_CONSISTENCY_RULE_BANDED,
  SCORING_CONSISTENCY_RULE_POINTS,
};
