// Choosing which calibration examples the grader sees.
//
// Selecting by recency alone is what this exists to prevent. The bank is skewed
// per assignment — one assignment is 19 good / 1 weak, another is 1 good / 19
// weak — so "the N most recent" can hand the model an entirely one-sided set of
// reference points and quietly move the whole score distribution with it.
//
// Instead, round-robin across the quality tiers so the model always sees both
// ends of the band it is being asked to grade against.

// Tried in this order first, so a strong reference point and a weak one are
// both present as early as possible. Any other value found in the data becomes
// a tier of its own, after these.
const PREFERRED_TIERS = ['good', 'borderline', 'weak'];

/**
 * Pick at most `cap` examples, spread across quality tiers.
 *
 * Input order is preserved within each tier, so callers keep control of
 * precedence (ordering the pool by recency still means "newest of each tier").
 * An example whose quality is null, missing, or unrecognised is not dropped —
 * it forms its own tier, because a row the instructor saved is a row they
 * meant to keep.
 *
 * Pure: no database access, and the caller's array is never modified.
 */
function selectBalanced(examples, cap) {
  if (!Array.isArray(examples) || !(cap > 0)) return [];

  // Group by quality. Map preserves insertion order, which gives unrecognised
  // tiers a stable first-seen ordering.
  const groups = new Map();
  for (const e of examples) {
    const quality = e && e.quality;
    if (!groups.has(quality)) groups.set(quality, []);
    groups.get(quality).push(e);
  }

  const known = PREFERRED_TIERS.filter(t => groups.has(t));
  const rest = [...groups.keys()].filter(q => !PREFERRED_TIERS.includes(q));
  // These arrays are built above, so draining them leaves the input untouched.
  const tiers = [...known, ...rest].map(q => groups.get(q));

  const picked = [];
  for (let i = 0; picked.length < cap && tiers.some(t => t.length); i++) {
    const tier = tiers[i % tiers.length];
    if (tier.length) picked.push(tier.shift());
  }
  return picked;
}

module.exports = { selectBalanced };
