// Central configuration shared across backend routes.
//
// Model selection, single source of truth:
//   - If ANTHROPIC_MODEL is set in .env, that exact model is pinned (escape hatch).
//   - Otherwise, on startup we query Anthropic's Models API and auto-select the
//     newest claude-opus-* model (today: claude-opus-5-5; auto-upgrades to the
//     next Opus when released).
//   - If that lookup fails (offline, API down), we fall back to FALLBACK so the
//     grader still boots and grades instead of hard-failing.
//
// Routes must call getModel() at request time (not capture it at import), because
// the auto-selected value is filled in asynchronously during startup.
const Anthropic = require('@anthropic-ai/sdk');

const FALLBACK = 'claude-opus-5-5';

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

// Rubric-fidelity rule (Rule 1) — used by the rubric-criteria graders.
// Application-level: score each criterion on its own rubric text, not on the
// assignment prose; credit evidence in any deliverable; flag (never silently
// keep) a deduction that rests on something the rubric doesn't actually score.
const SCORING_RUBRIC_FIDELITY_RULE = `RUBRIC FIDELITY CHECK — grade against the rubric, not the assignment prose.
The rubric criterion is the scoring contract. Score each criterion ONLY on what that criterion's own rubric text actually grades.
- When the assignment instructions require something this criterion does not actually score on, do NOT deduct for it here. You may note in the comment that the assignment also asked for it, but the number must be driven by the criterion's stated rubric language only.
- Before deducting on any criterion, confirm the thing being penalized is something that criterion's rubric text actually grades. If it is not, do not deduct on that criterion.
- Credit evidence found in ANY submitted deliverable, not just the narrative prose: a diagram, blueprint, table, appendix, screenshot, or attachment counts. Never mark a requirement missing only because it appears in a visual rather than in prose.
This is not a license to inflate: a rubric-required element that is genuinely absent from every deliverable still loses points on the criterion that measures it.
Do NOT silently keep a deduction that rests on something off-rubric. If a deduction would be based on something this criterion's rubric text does not actually score, score the criterion as the rubric supports and flag it for review: set "consistencyFlag": true and write a one-sentence "consistencyNote" naming what was almost penalized and why the rubric does not cover it. Leave "suggestedBand" empty in that case.`;

// ─── Reasoning effort ────────────────────────────────────────────────────
// Claude Opus 5.5 defaults to "medium" effort — one level below the "high"
// that Opus 5 and 4.8 used, so the auto-upgrade to 5.5 quietly reduced
// reasoning depth. Scoring calls weigh a comment against a score and apply
// the rubric-fidelity and consistency rules above, so they run at "high".
//
// ANTHROPIC_EFFORT in .env overrides the level (low|medium|high|xhigh|max).
// Set it to "off" to omit the parameter entirely — needed only if
// ANTHROPIC_MODEL pins a model that predates effort support.
const EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];
const DEFAULT_EFFORT = 'high';

function resolveEffort() {
  const v = (process.env.ANTHROPIC_EFFORT || '').trim().toLowerCase();
  if (!v) return DEFAULT_EFFORT;
  if (v === 'off' || v === 'none') return null;
  if (!EFFORT_LEVELS.includes(v)) {
    console.warn(`[config] Ignoring invalid ANTHROPIC_EFFORT="${v}"; using ${DEFAULT_EFFORT}.`);
    return DEFAULT_EFFORT;
  }
  return v;
}

const EFFORT = resolveEffort();

function getEffort() {
  return EFFORT;
}

// Spread into a messages.create() call that assigns a score, so every scoring
// surface reasons at the same depth:
//   await client.messages.create({ ...gradingParams(), max_tokens: 2000, ... });
// Feedback/recommendation prose calls deliberately do not use this.
function gradingParams() {
  return EFFORT
    ? { model: getModel(), output_config: { effort: EFFORT } }
    : { model: getModel() };
}

module.exports = {
  getModel,
  resolveModel,
  getEffort,
  gradingParams,
  FALLBACK,
  DEFAULT_EFFORT,
  SCORING_RUBRIC_FIDELITY_RULE,
  SCORING_CONSISTENCY_RULE_BANDED,
  SCORING_CONSISTENCY_RULE_POINTS,
};
