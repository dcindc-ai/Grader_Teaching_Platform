const test = require('node:test');
const assert = require('node:assert');
const { selectBalanced } = require('../lib/calibration');

let seq = 0;
const mk = (n, quality) => Array.from({ length: n }, () => ({ id: `e${++seq}`, quality }));
const countBy = (arr, k) => arr.reduce((m, e) => (m[e[k]] = (m[e[k]] || 0) + 1, m), {});

test('round-robins across tiers rather than taking the newest', () => {
  const pool = [...mk(10, 'good'), ...mk(5, 'weak'), ...mk(3, 'borderline')];
  const got = selectBalanced(pool, 6);
  assert.strictEqual(got.length, 6);
  assert.deepStrictEqual(countBy(got, 'quality'), { good: 2, borderline: 2, weak: 2 });
});

test('falls back to the tiers that exist', () => {
  const got = selectBalanced(mk(10, 'good'), 6);
  assert.strictEqual(got.length, 6);
});

test('returns everything when the pool is smaller than the cap', () => {
  assert.strictEqual(selectBalanced(mk(2, 'good'), 6).length, 2);
});

test('empty pool returns empty', () => {
  assert.deepStrictEqual(selectBalanced([], 6), []);
});

// Review Focus 2
test('keeps examples whose quality is null or unrecognised', () => {
  const pool = [...mk(1, 'good'), { id: 'x', quality: null }, { id: 'y', quality: 'excellent' }];
  const got = selectBalanced(pool, 6);
  assert.strictEqual(got.length, 3);
  assert.ok(got.some(e => e.id === 'x') && got.some(e => e.id === 'y'));
});

test('preserves input order within a tier', () => {
  const pool = mk(3, 'good');
  const got = selectBalanced(pool, 3);
  assert.deepStrictEqual(got.map(e => e.id), pool.map(e => e.id));
});

test('drains a short tier and keeps filling from the others', () => {
  // 1 weak, 5 good, cap 4 -> the single weak comes early, the rest are good
  const weak = mk(1, 'weak');
  const good = mk(5, 'good');
  const got = selectBalanced([...good, ...weak], 4);
  assert.strictEqual(got.length, 4);
  assert.deepStrictEqual(countBy(got, 'quality'), { good: 3, weak: 1 });
});

test('a cap of zero selects nothing', () => {
  assert.deepStrictEqual(selectBalanced(mk(5, 'good'), 0), []);
});

test('does not mutate the caller\'s array', () => {
  const pool = [...mk(3, 'good'), ...mk(3, 'weak')];
  const before = pool.map(e => e.id);
  selectBalanced(pool, 4);
  assert.deepStrictEqual(pool.map(e => e.id), before);
});
