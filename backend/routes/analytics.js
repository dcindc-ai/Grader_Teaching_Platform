const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db');
const router = express.Router();

// ─── 1. Score distribution per criterion ─────────────────────────────────

router.get('/criterion-distribution', (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  let query = 'SELECT scores, total, max_score, assignment_name FROM grades WHERE course_id=?';
  const params = [courseId];
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }

  const grades = db.prepare(query).all(...params);
  if (!grades.length) return res.json({ criteria: [], assignments: [] });

  // Collect all criteria keys
  const criteriaMap = {};
  const assignmentMap = {};

  grades.forEach(g => {
    const scores = JSON.parse(g.scores || '{}');
    const aName = g.assignment_name;
    if (!assignmentMap[aName]) assignmentMap[aName] = { name: aName, scores: [], total: [], maxScore: parseFloat(g.max_score) };
    assignmentMap[aName].total.push(parseFloat(g.total || 0));

    Object.entries(scores).forEach(([key, val]) => {
      if (key === 'total') return;
      if (!criteriaMap[key]) criteriaMap[key] = { key, values: [], byAssignment: {} };
      criteriaMap[key].values.push(parseFloat(val) || 0);
      if (!criteriaMap[key].byAssignment[aName]) criteriaMap[key].byAssignment[aName] = [];
      criteriaMap[key].byAssignment[aName].push(parseFloat(val) || 0);
    });
  });

  const criteria = Object.values(criteriaMap).map(c => ({
    key: c.key,
    label: c.key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    avg: avg(c.values),
    min: Math.min(...c.values),
    max: Math.max(...c.values),
    distribution: distribution(c.values),
    byAssignment: Object.entries(c.byAssignment).map(([name, vals]) => ({
      name, avg: avg(vals), count: vals.length
    }))
  }));

  const assignments = Object.values(assignmentMap).map(a => ({
    name: a.name,
    avg: avg(a.total),
    maxScore: a.maxScore,
    count: a.total.length,
    distribution: distribution(a.total.map(t => t / a.maxScore * 100))
  }));

  res.json({ criteria, assignments, totalGrades: grades.length });
});

// ─── 2. Student trajectory ───────────────────────────────────────────────

router.get('/trajectory', (req, res) => {
  const { courseId, studentId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  let query = `
    SELECT g.student_name, g.assignment_name, g.total, g.max_score, g.graded_at,
           s.id as student_id
    FROM grades g
    LEFT JOIN students s ON s.course_id=g.course_id AND LOWER(s.name)=LOWER(g.student_name)
    WHERE g.course_id=?
    ORDER BY g.student_name, g.graded_at ASC`;

  const grades = db.prepare(query).all(courseId);

  // Group by student
  const studentMap = {};
  grades.forEach(g => {
    const name = g.student_name || 'Unknown';
    if (!studentMap[name]) studentMap[name] = { name, grades: [] };
    studentMap[name].grades.push({
      assignment: g.assignment_name,
      score: parseFloat(g.total || 0),
      maxScore: parseFloat(g.max_score || 6),
      pct: Math.round(parseFloat(g.total || 0) / parseFloat(g.max_score || 6) * 100),
      date: g.graded_at
    });
  });

  const students = Object.values(studentMap).map(s => {
    const pcts = s.grades.map(g => g.pct);
    const trend = pcts.length >= 2 ? pcts[pcts.length-1] - pcts[0] : 0;
    return {
      name: s.name,
      grades: s.grades,
      avg: avg(pcts),
      trend, // positive = improving, negative = declining
      status: trend > 10 ? 'improving' : trend < -10 ? 'declining' : 'stable'
    };
  }).sort((a, b) => a.avg - b.avg); // lowest first

  res.json({ students, assignmentNames: [...new Set(grades.map(g => g.assignment_name))] });
});

// ─── 3. Calibration drift ────────────────────────────────────────────────

router.get('/calibration-drift', (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  let query = 'SELECT * FROM examples WHERE course_id=?';
  const params = [courseId];
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }
  query += ' ORDER BY created_at ASC';

  const examples = db.prepare(query).all(...params);
  if (examples.length < 3) return res.json({ drift: [], message: 'Need at least 3 calibration examples to detect drift' });

  // Split into thirds and compare average scores
  const third = Math.floor(examples.length / 3);
  const early = examples.slice(0, third);
  const middle = examples.slice(third, third * 2);
  const late = examples.slice(third * 2);

  const earlyAvg = avg(early.map(e => parseFloat(e.score || 0)));
  const middleAvg = avg(middle.map(e => parseFloat(e.score || 0)));
  const lateAvg = avg(late.map(e => parseFloat(e.score || 0)));

  const drift = lateAvg - earlyAvg;
  const driftDirection = drift > 0.3 ? 'scoring higher over time (grade inflation)' :
                         drift < -0.3 ? 'scoring lower over time (grade deflation)' :
                         'consistent scoring — no significant drift detected';

  // Find score buckets and count examples in each
  const buckets = {};
  examples.forEach(e => {
    const bucket = Math.floor(parseFloat(e.score || 0) * 2) / 2; // round to nearest 0.5
    if (!buckets[bucket]) buckets[bucket] = { score: bucket, count: 0, examples: [] };
    buckets[bucket].count++;
    buckets[bucket].examples.push(e.student_name);
  });

  res.json({
    totalExamples: examples.length,
    earlyAvg: earlyAvg.toFixed(2),
    middleAvg: middleAvg.toFixed(2),
    lateAvg: lateAvg.toFixed(2),
    drift: drift.toFixed(2),
    driftDirection,
    buckets: Object.values(buckets).sort((a, b) => a.score - b.score),
    timeline: examples.map((e, i) => ({
      index: i + 1,
      student: e.student_name,
      score: parseFloat(e.score || 0),
      date: e.created_at
    }))
  });
});

// ─── 4. Keyword patterns ─────────────────────────────────────────────────

router.get('/keyword-patterns', async (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  let query = 'SELECT * FROM examples WHERE course_id=? AND content IS NOT NULL AND content != ""';
  const params = [courseId];
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }

  const examples = db.prepare(query).all(...params);
  if (examples.length < 4) {
    return res.json({ patterns: [], message: 'Need at least 4 calibration examples to detect patterns' });
  }

  const maxScore = Math.max(...examples.map(e => parseFloat(e.score || 0)));
  const strong = examples.filter(e => parseFloat(e.score || 0) / maxScore >= 0.8);
  const weak = examples.filter(e => parseFloat(e.score || 0) / maxScore < 0.7);

  if (!strong.length || !weak.length) {
    return res.json({ patterns: [], message: 'Need both strong and weak examples to compare patterns' });
  }

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: 'You are analyzing patterns in student writing to help an instructor understand what distinguishes strong from weak submissions.',
      messages: [{
        role: 'user',
        content: `Analyze these calibration examples and identify concrete patterns that distinguish strong from weak submissions.

STRONG examples (scores ${strong.map(e => e.score).join(', ')}):
${strong.map(e => `[${e.student_name}]: ${(e.content || '').slice(0, 400)}`).join('\n\n')}

WEAK examples (scores ${weak.map(e => e.score).join(', ')}):
${weak.map(e => `[${e.student_name}]: ${(e.content || '').slice(0, 400)}`).join('\n\n')}

Return ONLY valid JSON:
{
  "strongPatterns": [
    {"pattern": "specific observable pattern", "example": "brief quote or example", "teachingNote": "what to tell students"}
  ],
  "weakPatterns": [
    {"pattern": "specific observable pattern", "example": "brief quote or example", "teachingNote": "what students should do instead"}
  ],
  "topInsight": "single most important finding in one sentence"
}`
      }]
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
    res.json({ ...parsed, strongCount: strong.length, weakCount: weak.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── 5. Always-On effectiveness ──────────────────────────────────────────

router.get('/alwayson-effectiveness', (req, res) => {
  const { courseId } = req.query;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  // Get all approved Always-On items
  const aoItems = db.prepare(`
    SELECT * FROM always_on WHERE course_id=? AND status='approved' ORDER BY created_at ASC
  `).all(courseId);

  if (!aoItems.length) return res.json({ results: [], message: 'No approved Always-On items yet' });

  // For each student who got an Always-On recommendation, check if their next grade improved
  const results = [];

  aoItems.forEach(ao => {
    const studentName = ao.student_name;
    if (!studentName || studentName === 'Class') return;

    // Get all grades for this student, sorted by date
    const grades = db.prepare(`
      SELECT * FROM grades WHERE course_id=? AND student_name LIKE ? ORDER BY graded_at ASC
    `).all(courseId, `%${studentName.split(' ')[0]}%`);

    if (grades.length < 2) return;

    // Find grades before and after the Always-On was created
    const aoDate = ao.created_at;
    const before = grades.filter(g => g.graded_at <= aoDate);
    const after = grades.filter(g => g.graded_at > aoDate);

    if (!before.length || !after.length) return;

    const beforePct = parseFloat(before[before.length-1].total) / parseFloat(before[before.length-1].max_score) * 100;
    const afterPct = parseFloat(after[0].total) / parseFloat(after[0].max_score) * 100;
    const change = afterPct - beforePct;

    results.push({
      student: studentName,
      weakArea: ao.weak_area,
      beforeScore: beforePct.toFixed(0),
      afterScore: afterPct.toFixed(0),
      change: change.toFixed(0),
      improved: change > 2,
      beforeAssignment: before[before.length-1].assignment_name,
      afterAssignment: after[0].assignment_name
    });
  });

  const improved = results.filter(r => r.improved).length;
  const effectivenessRate = results.length ? Math.round(improved / results.length * 100) : 0;

  res.json({
    results,
    improved,
    total: results.length,
    effectivenessRate,
    summary: results.length
      ? `${improved} of ${results.length} students (${effectivenessRate}%) improved on their next assignment after receiving an Always-On recommendation`
      : 'Not enough data yet — students need at least 2 graded assignments'
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function avg(arr) {
  if (!arr.length) return 0;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function distribution(values) {
  // Returns count in each 10% bucket (0-10, 10-20, ... 90-100)
  const buckets = Array(10).fill(0);
  values.forEach(v => {
    const idx = Math.min(9, Math.floor(v / 10));
    buckets[idx]++;
  });
  return buckets.map((count, i) => ({ range: `${i*10}-${i*10+10}%`, count }));
}

module.exports = router;
