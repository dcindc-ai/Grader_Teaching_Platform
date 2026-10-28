const test = require('node:test');
const assert = require('node:assert');
const { commentPolicySentence } = require('../lib/commentPolicy');

const SUPPRESSES = /not perfect|only include|leave it empty|empty when/i;

// The reported bug: "All criteria" never produced comments on criteria that
// scored full marks, because the prompt always ended with "Only include if
// score is not perfect" no matter what the dropdown said.
test('"all" asks for a comment on every criterion, including full marks', () => {
  const s = commentPolicySentence('all');
  assert.match(s, /every criterion/i);
  assert.match(s, /full marks|perfect/i);
  assert.doesNotMatch(s, /only include if/i);
});

// The extension does not send the mode at all, and its own client-side filter
// can only clear comments, never add them. So the server must generate for
// every criterion by default and let the client subtract.
test('an absent mode behaves as "all", so the client filter has something to subtract from', () => {
  for (const missing of [undefined, null, '']) {
    const s = commentPolicySentence(missing);
    assert.match(s, /every criterion/i, `mode ${JSON.stringify(missing)}`);
    assert.doesNotMatch(s, /only include if/i, `mode ${JSON.stringify(missing)}`);
  }
});

test('"imperfect" suppresses comments on perfect criteria', () => {
  assert.match(commentPolicySentence('imperfect'), SUPPRESSES);
});

test('"none" asks for no comments at all', () => {
  const s = commentPolicySentence('none');
  assert.match(s, /empty/i);
  assert.match(s, /every criterion/i);
});

test('an unrecognised mode falls back to "all" rather than suppressing', () => {
  // Generating and discarding is recoverable; suppressing is not, because
  // nothing downstream can write the comment that was never produced.
  const s = commentPolicySentence('somethingElse');
  assert.match(s, /every criterion/i);
  assert.doesNotMatch(s, /only include if/i);
});

test('case and surrounding whitespace do not change the mode', () => {
  assert.strictEqual(commentPolicySentence('  IMPERFECT '), commentPolicySentence('imperfect'));
  assert.strictEqual(commentPolicySentence('None'), commentPolicySentence('none'));
});

test('every mode returns a non-empty sentence', () => {
  for (const m of ['all', 'imperfect', 'none', undefined]) {
    assert.ok(commentPolicySentence(m).trim().length > 10, String(m));
  }
});
