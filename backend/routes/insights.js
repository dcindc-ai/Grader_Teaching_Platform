const express = require('express');
const router = express.Router();
const { db, parseGrade, parseAssignment } = require('../db');
const Anthropic = require('@anthropic-ai/sdk');

// POST /api/insights/analyze
// Analyzes all grades for an assignment and returns class-wide patterns
router.post('/analyze', async (req, res) => {
  const { courseId, assignmentId } = req.body;
  if (!courseId || !assignmentId) return res.status(400).json({ error: 'courseId and assignmentId required' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!course || !assignment) return res.status(404).json({ error: 'Not found' });

  const grades = db.prepare('SELECT * FROM grades WHERE assignment_id=? AND course_id=?').all(assignmentId, courseId).map(parseGrade);
  if (grades.length < 2) return res.status(400).json({ error: 'Need at least 2 graded students to analyze patterns' });

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build summary of all student grades
  const gradeSummaries = grades.map(g => {
    const scores = typeof g.scores === 'object' ? g.scores : {};
    return `Student: ${g.studentName}
Score: ${g.total}/${g.maxScore}
Key Strength: ${g.keyStrength || 'N/A'}
Key Improvement: ${g.keyImprovement || 'N/A'}
Criterion Scores: ${JSON.stringify(scores)}
Summary: ${g.summary || ''}`;
  }).join('\n\n---\n\n');

  const prompt = `You are analyzing grades for a class assignment to identify patterns, struggles, and teaching opportunities.

ASSIGNMENT: ${assignment.name}
COURSE: ${course.name} — ${course.full_name || ''}
TOTAL STUDENTS GRADED: ${grades.length}

ASSIGNMENT DESCRIPTION:
${assignment.description || 'No description available'}

STUDENT GRADE SUMMARIES:
${gradeSummaries}

Analyze these grades and return ONLY valid JSON (no markdown):
{
  "classSnapshot": "2-3 sentence summary of how the class performed overall — be honest and specific",
  "strengthPatterns": ["pattern 1", "pattern 2"],
  "strugglePatterns": ["pattern 1", "pattern 2", "pattern 3"],
  "missedConcepts": [
    {
      "concept": "concept name",
      "howManyStudents": 12,
      "explanation": "2-3 sentence plain-English explanation of what this concept is and why it matters",
      "whatStudentsDid": "what students did instead of demonstrating this concept"
    }
  ],
  "topicList": [
    {
      "topic": "topic name",
      "relevance": "why this topic matters for this assignment/course",
      "explanation": "2-3 sentence explanation suitable for students"
    }
  ],
  "resources": [
    {
      "title": "resource title",
      "type": "article | video | paper | book | tool",
      "url": "https://...",
      "description": "1-2 sentence description of what students will find here and why it helps",
      "topic": "which topic above this supports"
    }
  ],
  "instructorNote": "2-3 sentence note you might say to the class — plain language, honest, forward-looking"
}

Requirements:
- missedConcepts: 3-5 most significant gaps across the class
- topicList: 4-6 topics that would help students most right now
- resources: 5-8 high quality, real resources with actual URLs (use your knowledge of real URLs)
- Be specific to this assignment — not generic AI advice`;

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 3000,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const clean = text.replace(/```json\n?|```/g, '').trim();
    const analysis = JSON.parse(clean);

    res.json({
      analysis,
      meta: {
        assignmentName: assignment.name,
        courseName: course.name,
        courseColor: course.color || '#1a4fbf',
        institution: course.institution || '',
        totalStudents: grades.length,
        avgScore: (grades.reduce((s, g) => s + parseFloat(g.total || 0), 0) / grades.length).toFixed(1),
        maxScore: assignment.max_score || grades[0]?.maxScore || 100
      }
    });
  } catch(e) {
    console.error('Insights analysis error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/insights/pdf
// Generates a Word doc handout from analysis results
router.post('/pdf', async (req, res) => {
  const { analysis, meta } = req.body;
  if (!analysis || !meta) return res.status(400).json({ error: 'analysis and meta required' });

  try {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      BorderStyle, WidthType, ShadingType, AlignmentType, HeadingLevel
    } = require('docx');
    const fs = require('fs');

    function hexColor(hex) { return (hex || '#1a4fbf').replace('#', ''); }
    const accentHex = hexColor(meta.courseColor);
    const lightHex = 'F0F4FF';

    const border = { style: BorderStyle.SINGLE, size: 1, color: 'DDDDDD' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const noBorders = { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } };

    function para(text, opts = {}) {
      return new Paragraph({
        children: [new TextRun({ text: text || '', ...opts })],
        spacing: { after: opts.after || 120 }
      });
    }

    function section(label) {
      return new Paragraph({
        children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 20, color: accentHex, font: 'Arial' })],
        spacing: { before: 240, after: 80 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: accentHex, space: 4 } }
      });
    }

    const children = [];

    // Header
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [6500, 2860],
      rows: [new TableRow({ children: [
        new TableCell({
          borders: noBorders,
          width: { size: 6500, type: WidthType.DXA },
          shading: { fill: accentHex, type: ShadingType.CLEAR },
          margins: { top: 180, bottom: 180, left: 180, right: 180 },
          children: [
            new Paragraph({ children: [new TextRun({ text: meta.courseName, bold: true, size: 32, color: 'FFFFFF', font: 'Arial' })] }),
            new Paragraph({ children: [new TextRun({ text: meta.assignmentName, size: 20, color: 'DDDDFF', font: 'Arial' })] }),
          ]
        }),
        new TableCell({
          borders: noBorders,
          width: { size: 2860, type: WidthType.DXA },
          shading: { fill: accentHex, type: ShadingType.CLEAR },
          margins: { top: 180, bottom: 180, left: 120, right: 180 },
          children: [
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: meta.institution || '', size: 18, color: 'DDDDFF', font: 'Arial' })] }),
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `Avg: ${meta.avgScore} / ${meta.maxScore}`, bold: true, size: 22, color: 'FFFFFF', font: 'Arial' })] }),
            new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `${meta.totalStudents} students graded`, size: 16, color: 'DDDDFF', font: 'Arial' })] }),
          ]
        })
      ]})]
    }));

    children.push(para('', { after: 160 }));

    // Class overview
    if (analysis.classSnapshot) {
      children.push(section('Class Overview'));
      children.push(para(analysis.classSnapshot, { size: 22, font: 'Arial' }));
    }

    // Instructor note
    if (analysis.instructorNote) {
      children.push(para('', { after: 80 }));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({ children: [new TableCell({
          borders: { top: border, bottom: border, right: border, left: { style: BorderStyle.SINGLE, size: 12, color: accentHex } },
          shading: { fill: lightHex, type: ShadingType.CLEAR },
          margins: { top: 120, bottom: 120, left: 160, right: 160 },
          children: [para(analysis.instructorNote, { italics: true, size: 22, font: 'Arial', color: '444444' })]
        })]})],
      }));
    }

    // Missed concepts
    if (analysis.missedConcepts?.length > 0) {
      children.push(para('', { after: 80 }));
      children.push(section('Concepts to Revisit'));
      for (const c of analysis.missedConcepts) {
        const countStr = c.howManyStudents ? ` (${c.howManyStudents} of ${meta.totalStudents} students)` : '';
        children.push(new Paragraph({
          children: [new TextRun({ text: (c.concept || '') + countStr, bold: true, size: 22, color: accentHex, font: 'Arial' })],
          spacing: { before: 120, after: 40 }
        }));
        if (c.explanation) children.push(para(c.explanation, { size: 20, font: 'Arial' }));
        if (c.whatStudentsDid) children.push(para('What students did instead: ' + c.whatStudentsDid, { size: 18, italics: true, color: '666666', font: 'Arial' }));
      }
    }

    // Topic list
    if (analysis.topicList?.length > 0) {
      children.push(para('', { after: 80 }));
      children.push(section('Topics for Further Study'));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2500, 6860],
        rows: analysis.topicList.map((t, i) => new TableRow({ children: [
          new TableCell({
            borders, width: { size: 2500, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? lightHex : 'FFFFFF', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [para(t.topic || '', { bold: true, size: 20, color: accentHex, font: 'Arial', after: 0 })]
          }),
          new TableCell({
            borders, width: { size: 6860, type: WidthType.DXA },
            shading: { fill: i % 2 === 0 ? lightHex : 'FFFFFF', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [para(t.explanation || '', { size: 18, font: 'Arial', after: 0 })]
          })
        ]}))
      }));
    }

    // Resources
    if (analysis.resources?.length > 0) {
      children.push(para('', { after: 80 }));
      children.push(section('Recommended Resources'));
      for (const r of analysis.resources) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: (r.title || ''), bold: true, size: 22, font: 'Arial' }),
            r.type ? new TextRun({ text: '  [' + r.type.toUpperCase() + ']', size: 18, color: '888888', font: 'Arial' }) : new TextRun({ text: '' })
          ],
          spacing: { before: 120, after: 40 }
        }));
        if (r.description) children.push(para(r.description, { size: 18, font: 'Arial' }));
        if (r.url) children.push(para(r.url, { size: 16, color: '2563EB', font: 'Arial' }));
      }
    }

    // Footer line
    children.push(para('', { after: 80 }));
    children.push(new Paragraph({
      children: [new TextRun({ text: `Generated by Always On Learning  |  ${meta.courseName}  |  ${meta.institution || ''}`, size: 16, color: '999999', font: 'Arial' })],
      alignment: AlignmentType.CENTER,
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'DDDDDD', space: 4 } },
      spacing: { before: 160 }
    }));

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
      sections: [{
        properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = (meta.assignmentName || 'insights').replace(/[^a-z0-9]/gi, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="class-insights-${safeName}.docx"`);
    res.send(buffer);
  } catch(e) {
    console.error('Insights doc error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
