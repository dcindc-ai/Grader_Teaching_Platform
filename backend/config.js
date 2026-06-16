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

module.exports = { getModel, resolveModel, FALLBACK };
