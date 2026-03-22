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
// Generates a PDF handout from analysis results
router.post('/pdf', async (req, res) => {
  const { analysis, meta } = req.body;
  if (!analysis || !meta) return res.status(400).json({ error: 'analysis and meta required' });

  const { execSync } = require('child_process');
  const fs = require('fs');
  const path = require('path');
  const tmpFile = path.join('./uploads', `insights_${Date.now()}.pdf`);

  // Hex to RGB
  function hexToRgb(hex) {
    const h = (hex || '#1a4fbf').replace('#', '');
    return [parseInt(h.slice(0,2),16)/255, parseInt(h.slice(2,4),16)/255, parseInt(h.slice(4,6),16)/255];
  }

  const [r, g, b] = hexToRgb(meta.courseColor);
  const lightR = r * 0.15 + 0.85;
  const lightG = g * 0.15 + 0.85;
  const lightB = b * 0.15 + 0.85;

  const script = `
import sys
sys.stdout.reconfigure(encoding='utf-8')
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.colors import Color, HexColor, white, black
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
from reportlab.lib.enums import TA_LEFT, TA_CENTER
import json, textwrap

data = json.loads(sys.argv[1])
analysis = data['analysis']
meta = data['meta']

ACCENT = Color(${r}, ${g}, ${b})
LIGHT = Color(${lightR}, ${lightG}, ${lightB})
DARK = Color(${r*0.7}, ${g*0.7}, ${b*0.7})

doc = SimpleDocTemplate('${tmpFile}', pagesize=letter,
  leftMargin=0.75*inch, rightMargin=0.75*inch,
  topMargin=0.75*inch, bottomMargin=0.75*inch)

styles = getSampleStyleSheet()
W = letter[0] - 1.5*inch

def style(name, **kw):
  s = styles[name].clone(name + str(id(kw)))
  for k,v in kw.items(): setattr(s, k, v)
  return s

title_s = style('Normal', fontSize=22, fontName='Helvetica-Bold', textColor=white, leading=28)
sub_s = style('Normal', fontSize=11, fontName='Helvetica', textColor=white, leading=16)
section_s = style('Normal', fontSize=13, fontName='Helvetica-Bold', textColor=ACCENT, leading=18, spaceAfter=4)
body_s = style('Normal', fontSize=10, fontName='Helvetica', textColor=black, leading=15, spaceAfter=4)
small_s = style('Normal', fontSize=9, fontName='Helvetica', textColor=Color(0.35,0.35,0.35), leading=13)
concept_title_s = style('Normal', fontSize=11, fontName='Helvetica-Bold', textColor=DARK, leading=15)
label_s = style('Normal', fontSize=8, fontName='Helvetica-Bold', textColor=ACCENT, leading=12, spaceAfter=1)

story = []

# Header block
header_table = Table([[
  Paragraph(meta['courseName'], title_s),
  Paragraph(meta['institution'], sub_s)
]], colWidths=[W*0.65, W*0.35])
header_table.setStyle(TableStyle([
  ('BACKGROUND', (0,0), (-1,-1), ACCENT),
  ('TOPPADDING', (0,0), (-1,-1), 16),
  ('BOTTOMPADDING', (0,0), (-1,-1), 16),
  ('LEFTPADDING', (0,0), (0,-1), 16),
  ('RIGHTPADDING', (-1,0), (-1,-1), 16),
  ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
  ('ALIGN', (-1,0), (-1,-1), 'RIGHT'),
]))
story.append(header_table)
story.append(Spacer(1, 8))

# Assignment + stats bar
stats_bar = Table([[
  Paragraph('<b>' + meta['assignmentName'] + '</b>', style('Normal', fontSize=12, fontName='Helvetica-Bold', textColor=DARK)),
  Paragraph('Class avg: <b>' + str(meta['avgScore']) + ' / ' + str(meta['maxScore']) + '</b>  |  Students graded: <b>' + str(meta['totalStudents']) + '</b>', 
    style('Normal', fontSize=10, textColor=Color(0.3,0.3,0.3))),
]], colWidths=[W*0.55, W*0.45])
stats_bar.setStyle(TableStyle([
  ('BACKGROUND', (0,0), (-1,-1), LIGHT),
  ('TOPPADDING', (0,0), (-1,-1), 10),
  ('BOTTOMPADDING', (0,0), (-1,-1), 10),
  ('LEFTPADDING', (0,0), (-1,-1), 14),
  ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
  ('ALIGN', (-1,0), (-1,-1), 'RIGHT'),
]))
story.append(stats_bar)
story.append(Spacer(1, 16))

# Class snapshot
story.append(Paragraph('CLASS OVERVIEW', section_s))
story.append(HRFlowable(width=W, thickness=1.5, color=ACCENT, spaceAfter=8))
story.append(Paragraph(analysis.get('classSnapshot',''), body_s))
story.append(Spacer(1, 6))

# Instructor note
if analysis.get('instructorNote'):
  note_table = Table([[Paragraph('"' + analysis['instructorNote'] + '"', style('Normal', fontSize=10, fontName='Helvetica-Oblique', textColor=DARK, leading=15))]], colWidths=[W])
  note_table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,-1), LIGHT),
    ('LEFTPADDING', (0,0), (-1,-1), 14),
    ('RIGHTPADDING', (0,0), (-1,-1), 14),
    ('TOPPADDING', (0,0), (-1,-1), 10),
    ('BOTTOMPADDING', (0,0), (-1,-1), 10),
    ('LINECOLOR', (0,0), (0,-1), ACCENT),
    ('LINEBEFORE', (0,0), (0,-1), 3, ACCENT),
  ]))
  story.append(note_table)
  story.append(Spacer(1, 16))

# Concepts students missed
missed = analysis.get('missedConcepts', [])
if missed:
  story.append(Paragraph('CONCEPTS TO REVISIT', section_s))
  story.append(HRFlowable(width=W, thickness=1.5, color=ACCENT, spaceAfter=8))
  for c in missed:
    n = c.get('howManyStudents', '')
    count_str = (' (' + str(n) + ' of ' + str(meta['totalStudents']) + ' students)') if n else ''
    story.append(Paragraph(c.get('concept','') + count_str, concept_title_s))
    story.append(Paragraph(c.get('explanation',''), body_s))
    if c.get('whatStudentsDid'):
      story.append(Paragraph('<i>What students did instead:</i> ' + c['whatStudentsDid'], small_s))
    story.append(Spacer(1, 8))
  story.append(Spacer(1, 8))

# Topic list
topics = analysis.get('topicList', [])
if topics:
  story.append(Paragraph('TOPICS FOR FURTHER STUDY', section_s))
  story.append(HRFlowable(width=W, thickness=1.5, color=ACCENT, spaceAfter=8))
  rows = []
  for t in topics:
    rows.append([
      Paragraph(t.get('topic',''), concept_title_s),
      Paragraph(t.get('explanation',''), small_s)
    ])
  topic_table = Table(rows, colWidths=[W*0.28, W*0.72])
  topic_table.setStyle(TableStyle([
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('TOPPADDING', (0,0), (-1,-1), 6),
    ('BOTTOMPADDING', (0,0), (-1,-1), 6),
    ('LEFTPADDING', (0,0), (-1,-1), 6),
    ('LINEBELOW', (0,0), (-1,-2), 0.5, Color(0.85,0.85,0.85)),
    ('ROWBACKGROUNDS', (0,0), (-1,-1), [white, LIGHT]),
  ]))
  story.append(topic_table)
  story.append(Spacer(1, 16))

# Resources
resources = analysis.get('resources', [])
if resources:
  story.append(Paragraph('RECOMMENDED RESOURCES', section_s))
  story.append(HRFlowable(width=W, thickness=1.5, color=ACCENT, spaceAfter=8))
  for res in resources:
    rtype = res.get('type','').upper()
    title_line = '<b>' + res.get('title','') + '</b>'
    if rtype: title_line += '  <font color="#888888" size="8">[' + rtype + ']</font>'
    story.append(Paragraph(title_line, style('Normal', fontSize=11, fontName='Helvetica', leading=15)))
    story.append(Paragraph(res.get('description',''), small_s))
    url = res.get('url','')
    if url:
      story.append(Paragraph('<link href="' + url + '"><font color="#2563eb">' + url + '</font></link>', 
        style('Normal', fontSize=8, fontName='Helvetica', leading=12)))
    story.append(Spacer(1, 8))

# Footer
story.append(Spacer(1, 12))
story.append(HRFlowable(width=W, thickness=0.5, color=Color(0.8,0.8,0.8), spaceAfter=6))
story.append(Paragraph('Generated by Always On Learning  |  ' + meta['courseName'] + '  |  ' + meta['institution'], 
  style('Normal', fontSize=8, textColor=Color(0.6,0.6,0.6), alignment=1)))

doc.build(story)
print('OK')
`;

  const pyScript = '/tmp/insights_pdf.py';
  fs.writeFileSync(pyScript, script);

  try {
    const jsonArg = JSON.stringify(JSON.stringify({ analysis, meta }));
    execSync(`python3 ${pyScript} ${jsonArg}`, { timeout: 30000 });
    const pdfBuffer = fs.readFileSync(tmpFile);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="class-insights-${meta.assignmentName.replace(/[^a-z0-9]/gi,'_')}.pdf"`);
    res.send(pdfBuffer);
  } catch(e) {
    console.error('PDF generation error:', e.message);
    res.status(500).json({ error: e.message });
  } finally {
    try { fs.unlinkSync(tmpFile); } catch(_) {}
    try { fs.unlinkSync(pyScript); } catch(_) {}
  }
});

module.exports = router;
