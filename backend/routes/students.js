const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

function parseStudent(r) {
  if (!r) return null;
  const firstName = r.first_name || (r.name || '').split(' ').slice(0, -1).join(' ') || r.name || '';
  const lastName = r.last_name || (r.name || '').split(' ').pop() || '';
  return {
    id: r.id, courseId: r.course_id,
    firstName, lastName,
    name: r.name || `${firstName} ${lastName}`.trim(),
    preferredName: r.preferred_name || firstName,
    nickname: r.nickname || '',
    email: r.email || '',
    notes: r.notes || '',
    createdAt: r.created_at
  };
}

// GET students for a course

router.get('/', (req, res) => {
  const { courseId } = req.query;
  const rows = courseId
    ? db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY last_name ASC, first_name ASC').all(courseId)
    : db.prepare('SELECT * FROM students ORDER BY last_name ASC').all();
  res.json(rows.map(parseStudent));
});



router.post('/roster', (req, res) => {
  console.log('ROSTER endpoint hit, courseId:', req.body?.courseId, 'students:', req.body?.students?.length);
  const { courseId, students } = req.body;
  if (!courseId || !Array.isArray(students)) {
    return res.status(400).json({ error: 'courseId and students array required' });
  }

  let added = 0, skipped = 0, matched = 0;

  const checkEmail = db.prepare('SELECT id FROM students WHERE course_id=? AND email=?');
  const checkName = db.prepare('SELECT id FROM students WHERE course_id=? AND (name=? OR (first_name=? AND last_name=?))');
  const insertSt = db.prepare(`
    INSERT INTO students (id,course_id,name,first_name,last_name,email)
    VALUES (?,?,?,?,?,?)
  `);
  const updateSt = db.prepare(`
    UPDATE students SET first_name=?, last_name=?, name=?, email=?
    WHERE id=?
  `);

  for (const s of students) {
    const fullName = (s.name || s.Name || '').trim();
    const email = (s.email || s.Email || '').trim().toLowerCase();
    if (!fullName) continue;

    // Handle "Last, First" format (Canvas export) — convert to "First Last"
    let firstName, lastName, displayName;
    if (fullName.includes(',')) {
      const [last, ...firstParts] = fullName.split(',').map(p => p.trim());
      firstName = firstParts.join(' ').trim();
      lastName = last;
      displayName = firstName ? `${firstName} ${lastName}` : lastName;
    } else {
      const parts = fullName.split(' ');
      lastName = parts.pop() || '';
      firstName = parts.join(' ') || lastName;
      displayName = fullName;
    }

    const existingEmail = email ? checkEmail.get(courseId, email) : null;
    const existingName = checkName.get(courseId, displayName, firstName, lastName);

    if (existingEmail || existingName) {
      const existing = existingEmail || existingName;
      updateSt.run(firstName, lastName, displayName, email, existing.id);
      skipped++;
      continue;
    }

    insertSt.run(uuidv4(), courseId, displayName, firstName, lastName, email);
    added++;
  }

  // Match existing grades to roster by last name / filename
  const allStudents = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const unmatchedGrades = db.prepare(
    "SELECT id, student_name, file_name FROM grades WHERE course_id=? AND (student_id IS NULL OR student_id='')"
  ).all(courseId);

  for (const grade of unmatchedGrades) {
    const student = findStudentMatch(allStudents, grade.student_name, grade.file_name);
    if (student) {
      const parsed = parseStudent(student);
      db.prepare('UPDATE grades SET student_id=?, student_name=? WHERE id=?')
        .run(student.id, parsed.name, grade.id);
      matched++;
    }
  }

  res.json({ added, skipped, matched, total: students.length });
});



router.get('/match', (req, res) => {
  const { courseId, studentName, fileName } = req.query;
  const students = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const match = findStudentMatch(students, studentName, fileName);
  res.json({ match: match ? parseStudent(match) : null });
});



router.get('/progress/:courseId', (req, res) => {
  const students = db.prepare('SELECT * FROM students WHERE course_id=? ORDER BY last_name ASC, first_name ASC').all(req.params.courseId);
  const progress = students.map(s => {
    const grades = db.prepare('SELECT * FROM grades WHERE student_id=? ORDER BY graded_at DESC').all(s.id);
    const avg = grades.length
      ? (grades.reduce((a, g) => a + (parseFloat(g.total)||0) / (parseFloat(g.max_score)||1), 0) / grades.length * 100).toFixed(0)
      : null;
    // Trajectory: compare last two assignments
    let trajectoryScore = 50; // neutral baseline
    let trajectoryLabel = 'stable';
    if (grades.length >= 2) {
      const recent = parseFloat(grades[0].total) / parseFloat(grades[0].max_score);
      const prior = parseFloat(grades[1].total) / parseFloat(grades[1].max_score);
      const delta = recent - prior;
      if (delta > 0.08) { trajectoryScore = 80; trajectoryLabel = 'improving'; }
      else if (delta < -0.08) { trajectoryScore = 20; trajectoryLabel = 'declining'; }
      else { trajectoryScore = 50; trajectoryLabel = 'stable'; }
    }

    // Concept application rate: % of rubric criteria above 70% avg
    let conceptRate = null;
    if (grades.length > 0) {
      const allScores = [];
      for (const g of grades) {
        const scores = JSON.parse(g.scores || '{}');
        const maxScore = parseFloat(g.max_score) || 6;
        for (const [key, val] of Object.entries(scores)) {
          if (key === 'total') continue;
          // Estimate section max from known patterns
          const sectionMax = maxScore <= 6 ? 2 : maxScore / 4;
          allScores.push((parseFloat(val)||0) / sectionMax);
        }
      }
      const above70 = allScores.filter(s => s >= 0.7).length;
      conceptRate = allScores.length ? Math.round(above70 / allScores.length * 100) : null;
    }

    // Weighted running grade (% of max)
    const weightedGrade = avg ? parseFloat(avg) : null;

    // Composite SPI
    let spi = null;
    if (weightedGrade !== null) {
      const trajComponent = trajectoryScore;
      const conceptComponent = conceptRate ?? 70;
      spi = Math.round((weightedGrade * 0.5) + (trajComponent * 0.3) + (conceptComponent * 0.2));
    }

    return {
      ...parseStudent(s),
      assignmentsGraded: grades.length,
      averageScore: avg,
      trajectory: trajectoryLabel,
      trajectoryScore,
      conceptApplicationRate: conceptRate,
      spi,
      grades: grades.map(g => ({
        id: g.id, assignmentName: g.assignment_name,
        total: g.total, maxScore: g.max_score,
        gradedAt: g.graded_at, key_improvement: g.key_improvement,
        scores: JSON.parse(g.scores || '{}')
      }))
    };
  });
  res.json(progress);
});



router.post('/', (req, res) => {
  const { courseId, firstName, lastName, email, nickname, notes } = req.body;
  const id = uuidv4();
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  db.prepare('INSERT INTO students (id,course_id,name,first_name,last_name,email,nickname,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, courseId, fullName, firstName||'', lastName||'', email||'', nickname||'', notes||'');
  res.json(parseStudent(db.prepare('SELECT * FROM students WHERE id=?').get(id)));
});



router.put('/:id', (req, res) => {
  const { firstName, lastName, email, nickname, notes, preferredName } = req.body;
  const fullName = `${firstName || ''} ${lastName || ''}`.trim();
  db.prepare('UPDATE students SET name=?,first_name=?,last_name=?,email=?,nickname=?,notes=?,preferred_name=? WHERE id=?')
    .run(fullName, firstName||'', lastName||'', email||'', nickname||'', notes||'', preferredName||'', req.params.id);
  res.json(parseStudent(db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id)));
});



router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM students WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});



router.post('/:id/insight', async (req, res) => {
  const { courseId } = req.body;
  const student = db.prepare('SELECT * FROM students WHERE id=?').get(req.params.id);
  if (!student) return res.status(404).json({ error: 'Student not found' });

  const grades = db.prepare('SELECT * FROM grades WHERE student_id=? OR (course_id=? AND student_name LIKE ?) ORDER BY graded_at ASC')
    .all(req.params.id, courseId, `%${student.first_name || student.name.split(' ')[0]}%`);

  if (!grades.length) return res.json({ insight: 'No grades recorded yet for this student.' });

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const gradeContext = grades.map(g => {
    const scores = JSON.parse(g.scores || '{}');
    const scoreStr = Object.entries(scores)
      .filter(([k]) => k !== 'total')
      .map(([k, v]) => `${k.replace(/_/g,' ')}: ${v}`)
      .join(', ');
    return `${g.assignment_name}: ${g.total}/${g.max_score} (${scoreStr}). Key gap: ${g.key_improvement || 'none noted'}`;
  }).join('\n');

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: `You are an instructor writing a private insight note about a student's progress. Be honest, specific, and useful. No sentence over 18 words. No em dashes. Plain direct prose.`,
      messages: [{
        role: 'user',
        content: `Student: ${student.first_name || student.name}
Grade history:
${gradeContext}

Write a 3-4 sentence instructor insight covering:
1. What this student does consistently well
2. What pattern their gaps follow (not just listing them)
3. Whether they are on track, improving, or needs intervention
4. One specific thing to watch for or act on

Write in first person as the instructor. Be frank.`
      }]
    });

    const insight = resp.content.find(b => b.type === 'text')?.text || '';
    // Save to student record
    db.prepare('UPDATE students SET notes=? WHERE id=?')
      .run(insight + (student.notes ? '\n\n---\n' + student.notes : ''), req.params.id);
    res.json({ insight });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});



module.exports = router;
