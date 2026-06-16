#!/usr/bin/env node
// Seed a new term's calibration examples by copying them forward from a prior term.
//
// Why: calibration `examples` are keyed by assignment_id, and each term is a
// separate assignment record (different id). So prior-term examples do NOT reach
// the new term's grader automatically — they must be copied into the new
// assignment's id. This script does that, matching assignments across the two
// courses and copying their examples.
//
// Usage (run from the backend/ directory):
//   node --experimental-sqlite scripts/seed-term-calibration.js --from <fromCourseId> --to <toCourseId>           # dry run (default)
//   node --experimental-sqlite scripts/seed-term-calibration.js --from <fromCourseId> --to <toCourseId> --apply   # actually copy
//
// Example:
//   node --experimental-sqlite scripts/seed-term-calibration.js --from ain714 --to ain714-summer26 --apply
//
// Safe to re-run: examples already present in the target (same student + score +
// content) are skipped, so it will not create duplicates.

const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { v4: uuidv4 } = require('uuid');

// ── Renamed-counterpart overrides ───────────────────────────────────────────
// When an assignment was renamed between terms, base-name matching can't pair
// them. List [priorTermBaseName, newTermBaseName] pairs here (case-insensitive,
// without the "(Spring 2026)" / "(Summer 2026)" term suffix). Edit as needed.
const OVERRIDES = [
  ['Discussion 1', 'Discussion 1- Defining the Emerging Technology Field'],
  ['Discussion 2', 'The Stochastic Parrot'],
];

// ── Args ─────────────────────────────────────────────────────────────────────
function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}
const fromCourse = arg('--from');
const toCourse = arg('--to');
const apply = process.argv.includes('--apply');

if (!fromCourse || !toCourse) {
  console.error('Usage: node --experimental-sqlite scripts/seed-term-calibration.js --from <courseId> --to <courseId> [--apply]');
  process.exit(1);
}

const DB_PATH = path.join(__dirname, '..', 'data', 'platform.db');
const db = new DatabaseSync(DB_PATH);

// Strip a trailing "(Spring 2026)" / "(Summer 2026)" suffix and any loose
// "- Summer"/"- Spring" marker, then lowercase, to get a comparable base name.
function baseName(n) {
  return (n || '')
    .replace(/\s*\((?:Spring|Summer|Fall|Winter)\s*20\d\d\)\s*$/i, '')
    .replace(/[\s-]+(?:Summer|Spring|Fall|Winter)(?:\s*20\d\d)?\s*$/i, '')
    .trim()
    .toLowerCase();
}

const overrideTo = new Map(OVERRIDES.map(([a, b]) => [a.toLowerCase(), b.toLowerCase()]));

const fromAsgs = db.prepare('SELECT id, name, display_order FROM assignments WHERE course_id=? ORDER BY display_order').all(fromCourse);
const toAsgs = db.prepare('SELECT id, name, display_order FROM assignments WHERE course_id=? ORDER BY display_order').all(toCourse);

if (!fromAsgs.length) { console.error(`No assignments in --from course "${fromCourse}"`); process.exit(1); }
if (!toAsgs.length) { console.error(`No assignments in --to course "${toCourse}"`); process.exit(1); }

// Index target assignments by base name.
const toByBase = new Map();
for (const a of toAsgs) toByBase.set(baseName(a.name), a);

function findTarget(fromName) {
  const fb = baseName(fromName);
  const ov = overrideTo.get(fb);
  if (ov && toByBase.has(ov)) return toByBase.get(ov);
  return toByBase.get(fb) || null;
}

const countExamples = db.prepare('SELECT COUNT(*) n FROM examples WHERE assignment_id=?');
const getExamples = db.prepare('SELECT * FROM examples WHERE assignment_id=?');
const existsInTarget = db.prepare(
  'SELECT 1 FROM examples WHERE assignment_id=? AND student_name IS ? AND score IS ? AND substr(COALESCE(content,\'\'),1,200)=substr(COALESCE(?,\'\'),1,200) LIMIT 1'
);
const insertExample = db.prepare(
  'INSERT INTO examples (id, assignment_id, course_id, student_name, score, quality, notes, content) VALUES (?,?,?,?,?,?,?,?)'
);

let totalToCopy = 0, totalSkipped = 0, matched = 0;
const unmatched = [];
const plan = [];

for (const fa of fromAsgs) {
  const srcCount = countExamples.get(fa.id).n;
  if (srcCount === 0) continue; // nothing to carry forward
  const ta = findTarget(fa.name);
  if (!ta) { unmatched.push(fa.name); continue; }
  matched++;

  const src = getExamples.all(fa.id);
  let willCopy = 0, willSkip = 0;
  for (const e of src) {
    const dup = existsInTarget.get(ta.id, e.student_name, e.score, e.content);
    if (dup) { willSkip++; continue; }
    willCopy++;
  }
  totalToCopy += willCopy;
  totalSkipped += willSkip;
  plan.push({ fa, ta, srcCount, willCopy, willSkip });
}

console.log(`\nSeeding calibration: ${fromCourse}  ->  ${toCourse}   (${apply ? 'APPLY' : 'DRY RUN'})\n`);
for (const p of plan) {
  console.log(`  "${p.fa.name}"  ->  "${p.ta.name}"`);
  console.log(`      ${p.srcCount} source examples | copy ${p.willCopy} | skip ${p.willSkip} (already present)`);
}
if (unmatched.length) {
  console.log('\n  UNMATCHED (no counterpart in target — add to OVERRIDES if these were renamed):');
  for (const n of unmatched) console.log('      - ' + n);
}
console.log(`\n  Matched assignments: ${matched} | examples to copy: ${totalToCopy} | already present: ${totalSkipped}`);

if (!apply) {
  console.log('\nDry run only. Re-run with --apply to copy.\n');
  process.exit(0);
}

db.exec('BEGIN');
try {
  let copied = 0;
  for (const p of plan) {
    const src = getExamples.all(p.fa.id);
    for (const e of src) {
      if (existsInTarget.get(p.ta.id, e.student_name, e.score, e.content)) continue;
      insertExample.run(uuidv4(), p.ta.id, toCourse, e.student_name, e.score, e.quality, e.notes, e.content);
      copied++;
    }
  }
  db.exec('COMMIT');
  console.log(`\nDone. Copied ${copied} examples into ${toCourse}.\n`);
} catch (e) {
  db.exec('ROLLBACK');
  console.error('\nROLLBACK — no changes made:', e.message, '\n');
  process.exit(1);
}
