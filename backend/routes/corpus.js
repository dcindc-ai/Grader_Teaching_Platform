const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db } = require('../db');
const router = express.Router();

router.get('/stats', (req, res) => {
  const courses = db.prepare('SELECT * FROM courses').all();
  const totalGrades = db.prepare('SELECT COUNT(*) as n FROM grades').get().n;
  const totalStudents = db.prepare('SELECT COUNT(*) as n FROM students').get().n;
  const totalDiscussions = db.prepare('SELECT COUNT(*) as n FROM discussions').get().n;
  const courseStats = courses.map(c => {
    const g = db.prepare('SELECT COUNT(*) as n, AVG(total) as avg FROM grades WHERE course_id=?').get(c.id);
    const s = db.prepare('SELECT COUNT(*) as n FROM students WHERE course_id=?').get(c.id).n;
    return { id: c.id, name: c.name, institution: c.institution, gradesCount: g.n,
      averageScore: g.avg ? g.avg.toFixed(2) : null, studentCount: s };
  });
  res.json({ totalGrades, totalStudents, totalDiscussions, courses: courseStats });
});

router.post('/query', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question required' });

  const courses = db.prepare('SELECT id, name, institution, term FROM courses').all();
  const grades = db.prepare(`
    SELECT g.student_name, g.course_id, g.assignment_name, g.total, g.max_score,
           g.graded_at, g.key_strength, g.key_improvement, g.summary
    FROM grades g ORDER BY g.graded_at DESC LIMIT 500
  `).all();
  const students = db.prepare('SELECT name, course_id, email FROM students').all();
  const pending = db.prepare('SELECT COUNT(*) as n FROM always_on WHERE status=?').get('pending').n;

  const corpus = `COURSES: ${courses.map(c=>`${c.name} (${c.institution}, ${c.term})`).join(', ')}
TOTAL GRADES: ${grades.length} | STUDENTS: ${students.length} | PENDING ALWAYS-ON REVIEWS: ${pending}

GRADE DATA (most recent 500):
${JSON.stringify(grades, null, 2)}

STUDENTS:
${JSON.stringify(students, null, 2)}`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514', max_tokens: 1000,
      system: `You are a teaching analytics assistant for Professor Dave Cook (UMD / Wake Forest). You have access to his complete grading history. Answer questions about student performance, trends, and teaching insights. Be specific, cite names and scores when relevant. Be concise and direct.`,
      messages: [{ role: 'user', content: `Corpus:\n${corpus}\n\nQuestion: ${question}` }]
    });
    res.json({ answer: resp.content.find(b=>b.type==='text')?.text || '' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
