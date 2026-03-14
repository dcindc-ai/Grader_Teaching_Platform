const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { readJSON } = require('../data/helpers');
const router = express.Router();

// GET /api/corpus/query — natural language query over all teaching data
router.post('/query', async (req, res) => {
  const { question } = req.body;
  if (!question) return res.status(400).json({ error: 'Question required' });

  const grades = readJSON('./data/grades.json', []);
  const students = readJSON('./data/students.json', []);
  const courses = readJSON('./data/courses.json', []);
  const assignments = readJSON('./data/assignments.json', []);
  const discussions = readJSON('./data/discussions.json', []);

  // Build a compact summary of the corpus
  const gradeSummary = grades.map(g => ({
    student: g.studentName,
    course: g.courseId,
    assignment: g.assignmentName,
    total: g.total,
    max: g.maxScore,
    gradedAt: g.gradedAt,
    key_strength: g.key_strength,
    key_improvement: g.key_improvement,
    summary: g.summary
  }));

  const studentSummary = students.map(s => ({
    name: s.name,
    course: s.courseId,
    email: s.email
  }));

  const corpusContext = `
TEACHING CORPUS SUMMARY:
Courses: ${courses.map(c => `${c.name} (${c.institution}, ${c.term})`).join(', ')}
Total graded submissions: ${grades.length}
Total students: ${students.length}
Total discussion responses: ${discussions.length}

GRADE DATA:
${JSON.stringify(gradeSummary, null, 2)}

STUDENT ROSTER:
${JSON.stringify(studentSummary, null, 2)}
`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are a teaching analytics assistant for Professor Dave Cook. You have access to his complete teaching corpus — all graded submissions, student rosters, and discussion history across all his courses. Answer questions about student performance, trends, and teaching insights. Be specific and cite actual student names and scores when relevant. Be concise and direct.`,
      messages: [{
        role: 'user',
        content: `Here is the teaching corpus:\n${corpusContext}\n\nQuestion: ${question}`
      }]
    });
    const text = resp.content.find(b => b.type === 'text')?.text || '';
    res.json({ answer: text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/corpus/stats
router.get('/stats', (req, res) => {
  const grades = readJSON('./data/grades.json', []);
  const students = readJSON('./data/students.json', []);
  const courses = readJSON('./data/courses.json', []);
  const discussions = readJSON('./data/discussions.json', []);

  const byCourse = {};
  for (const g of grades) {
    if (!byCourse[g.courseId]) byCourse[g.courseId] = { count: 0, total: 0 };
    byCourse[g.courseId].count++;
    byCourse[g.courseId].total += parseFloat(g.total) || 0;
  }

  const courseStats = courses.map(c => ({
    id: c.id,
    name: c.name,
    institution: c.institution,
    gradesCount: byCourse[c.id]?.count || 0,
    averageScore: byCourse[c.id]?.count
      ? (byCourse[c.id].total / byCourse[c.id].count).toFixed(2)
      : null,
    studentCount: students.filter(s => s.courseId === c.id).length
  }));

  res.json({
    totalGrades: grades.length,
    totalStudents: students.length,
    totalDiscussions: discussions.length,
    courses: courseStats
  });
});

module.exports = router;
