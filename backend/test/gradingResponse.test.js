const test = require('node:test');
const assert = require('node:assert');
const { parseGradingJson, GradingResponseTruncated } = require('../lib/gradingResponse');

const resp = (text, stop_reason = 'end_turn', extra = {}) => ({
  stop_reason,
  content: [{ type: 'text', text }],
  usage: { output_tokens: 3999, output_tokens_details: { thinking_tokens: 1900 } },
  ...extra,
});

test('parses a clean JSON response', () => {
  assert.deepStrictEqual(parseGradingJson(resp('{"totalPoints":68}'), 'grade'), { totalPoints: 68 });
});

test('strips markdown fences the model sometimes adds', () => {
  assert.deepStrictEqual(parseGradingJson(resp('```json\n{"a":1}\n```'), 'grade'), { a: 1 });
});

// The actual failure: a response cut off at max_tokens leaves a half-written
// string, and JSON.parse reports "Unterminated string in JSON at position N"
// — which says nothing about the real cause.
test('a truncated response throws GradingResponseTruncated, not a SyntaxError', () => {
  const cut = '{"criteriaGrades":[{"studentComment":"You did well on the';
  assert.throws(
    () => parseGradingJson(resp(cut, 'max_tokens'), 'discussgrade'),
    GradingResponseTruncated
  );
});

test('the truncation error explains the cause and the remedy', () => {
  try {
    parseGradingJson(resp('{"a":', 'max_tokens'), 'discussgrade');
    assert.fail('should have thrown');
  } catch (e) {
    assert.match(e.message, /truncated/i);
    assert.match(e.message, /max_tokens/);
    assert.match(e.message, /discussgrade/);
    assert.strictEqual(e.surface, 'discussgrade');
    assert.strictEqual(e.thinkingTokens, 1900);
  }
});

test('truncation is reported even when the partial text happens to parse', () => {
  // A response cut after a complete object is still missing the rest of the
  // grades; silently accepting it would under-report criteria.
  assert.throws(
    () => parseGradingJson(resp('{"criteriaGrades":[]}', 'max_tokens'), 'grade'),
    GradingResponseTruncated
  );
});

test('a refusal is reported as a refusal, not as bad JSON', () => {
  const r = resp('', 'refusal');
  r.stop_details = { type: 'refusal', category: 'bio' };
  assert.throws(() => parseGradingJson(r, 'grade'), /refus/i);
});

test('malformed JSON that was NOT truncated says so plainly', () => {
  assert.throws(
    () => parseGradingJson(resp('not json at all'), 'quizgrade'),
    /quizgrade.*valid JSON/s
  );
});

test('an empty response is reported rather than parsed as {}', () => {
  assert.throws(() => parseGradingJson(resp(''), 'grade'), /empty|no text/i);
});

test('ignores non-text blocks such as thinking', () => {
  const r = {
    stop_reason: 'end_turn',
    content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }],
    usage: { output_tokens: 10 },
  };
  assert.deepStrictEqual(parseGradingJson(r, 'grade'), { ok: true });
});
