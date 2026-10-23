const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const BACKEND = path.join(__dirname, '..');

// Load db.js in a child process, since it opens a database at import time.
function loadDb(env) {
  return spawnSync(
    process.execPath,
    ['--experimental-sqlite', '-e', "require('./db'); console.log('LOADED')"],
    { cwd: BACKEND, env: { ...process.env, ...env }, encoding: 'utf8' }
  );
}

function tempPath(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'dbpath-')), name);
}

// A DB_PATH left in .env or exported in a shell would otherwise redirect the
// whole app silently: node:sqlite creates the missing file, applySchema builds
// the tables, and db.js seeds the default courses. The app then looks normal
// while a term's grading goes into a throwaway file.
test('refuses to create a new database at a non-default DB_PATH', () => {
  const missing = tempPath('does-not-exist.db');
  const r = loadDb({ DB_PATH: missing });
  assert.notStrictEqual(r.status, 0, 'should have exited non-zero');
  assert.match(r.stderr, /DB_ALLOW_CREATE/, 'the error should say how to proceed deliberately');
  assert.strictEqual(fs.existsSync(missing), false, 'must not have created the file');
});

test('DB_ALLOW_CREATE permits it deliberately', () => {
  const fresh = tempPath('fresh.db');
  const r = loadDb({ DB_PATH: fresh, DB_ALLOW_CREATE: '1' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(fresh), 'should have created the database');
});

test('an existing database at a non-default DB_PATH loads without the flag', () => {
  const copy = tempPath('existing.db');
  const r1 = loadDb({ DB_PATH: copy, DB_ALLOW_CREATE: '1' });
  assert.strictEqual(r1.status, 0, r1.stderr);
  const r2 = loadDb({ DB_PATH: copy });
  assert.strictEqual(r2.status, 0, r2.stderr);
});

test('always says which database it opened', () => {
  const copy = tempPath('logged.db');
  const r = loadDb({ DB_PATH: copy, DB_ALLOW_CREATE: '1' });
  assert.match(r.stdout, /\[db\] using /, 'startup must name the database in use');
  assert.ok(r.stdout.includes(copy), 'and it must be the path actually opened');
});
