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

// Banded version — used by the rubric-criteria grader (web app + Canvas panel).
// FLAG-ONLY: this check must never change a score. It grades exactly as before
// (same generosity, same distribution) and only surfaces comment/score
// disagreements for the instructor to confirm — never silently adjusts.
const SCORING_CONSISTENCY_RULE_BANDED = `SCORING CONSISTENCY CHECK — this is a FLAG-ONLY check. It must NOT change how you score.
Grade every criterion exactly as you normally would, with your normal generosity. Do NOT lower (or raise) any score because of this check. It never shifts the score distribution and never makes grading harsher.
After you have assigned each criterion's score AND written its comment/rationale, compare the two for agreement — do not change either; only decide whether to flag:
- If the comment describes only minor, cosmetic, or stylistic issues (typos, a missing cross-reference, small clarity gaps), a top-band score is consistent with it. Do NOT flag.
- If the comment describes a SUBSTANTIVE flaw — a required element is missing, or the work contradicts itself internally (for example, one section analyzes components that another section never defined) — while the score still sits at the top band, that is the only case to flag. Leave the score exactly as you assigned it and leave the comment exactly as written. Do NOT lower the score to "fix" it. Set "consistencyFlag": true, write a one-sentence "consistencyNote" naming the disagreement, and set "suggestedBand" to the lower band the comment would support so the instructor can decide.
Substantive vs. cosmetic test: a flaw is substantive when fixing it requires reworking content, not just relabeling or correcting surface errors.
Benefit of the doubt still applies to ambiguity, interpretation, and minor omissions — never flag those. Only flag a missing required element or an internal contradiction.
When the comment and score already agree, set "consistencyFlag": false. The instructor, not you, decides whether any flagged score actually changes.`;

// Points-only version — used by the quiz/essay grader (browser extension popup).
// FLAG-ONLY: same principle, adapted to a single score + one feedback sentence.
const SCORING_CONSISTENCY_RULE_POINTS = `SCORING CONSISTENCY CHECK — this is a FLAG-ONLY check. It must NOT change how you score.
Score the answer exactly as you normally would, with your normal generosity. Do NOT lower the score because of this check.
After scoring and writing your one-sentence feedback, compare them — do not change either; only decide whether to flag:
- If your feedback notes only cosmetic issues (a typo, slightly unclear phrasing), do NOT flag.
- If your feedback says a required part of the answer is missing or wrong while your score is full or near-full, that is the case to flag. Leave the score and the feedback exactly as written — do NOT lower the score to "fix" it. Set "consistencyFlag": true and write a one-sentence "consistencyNote" naming the disagreement.
A flaw is substantive when fixing it requires reworking the answer's content, not surface wording. Benefit of the doubt still applies to ambiguity and minor omissions — never flag those.
When the score and feedback already agree, set "consistencyFlag": false. The instructor, not you, decides whether any flagged score actually changes.`;

module.exports = {
  getModel,
  resolveModel,
  FALLBACK,
  SCORING_CONSISTENCY_RULE_BANDED,
  SCORING_CONSISTENCY_RULE_POINTS,
};
