const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db, parseGrade } = require('../db');
const router = express.Router();

// ─── Analyze grades with Claude ──────────────────────────────────────────

async function analyzeClass(grades, assignment, course) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const gradeData = grades.map(g => ({
    student: g.studentName,
    total: g.total,
    maxScore: g.maxScore,
    scores: g.scores,
    key_strength: g.key_strength,
    key_improvement: g.key_improvement,
    summary: g.summary,
    comments: g.comments
  }));

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 3000,
    system: `You are ${course?.name || 'an instructor'} analyzing class performance on ${assignment?.name || 'an assignment'}.
Provide honest, specific, actionable analysis. Be direct. Use the actual student data.`,
    messages: [{
      role: 'user',
      content: `Here are all grades for ${assignment?.name} (${grades.length} students, max ${assignment?.max_score || 6} pts):

${JSON.stringify(gradeData, null, 2)}

Analyze this data and return ONLY valid JSON, no markdown fences:
{
  "overview": "2-3 sentence honest assessment of how the class performed overall",
  "scoreDistribution": {
    "excellent": 0,
    "good": 0,
    "satisfactory": 0,
    "needsWork": 0,
    "description": "one sentence on the distribution"
  },
  "topStrengths": [
    { "title": "What students did well", "detail": "specific detail with examples", "count": 0 }
  ],
  "topWeaknesses": [
    { "title": "Most common problem", "detail": "specific detail with student examples (use first names only)", "count": 0, "slideContent": "What to tell the class about this on a slide — 2-3 sentences of teaching content" }
  ],
  "componentBreakdown": {
    "annotated_product": { "avg": 0, "max": 2, "commonIssue": "most common problem in this section" },
    "narrative": { "avg": 0, "max": 2, "commonIssue": "most common problem" },
    "context": { "avg": 0, "max": 1, "commonIssue": "most common problem" },
    "overall_quality": { "avg": 0, "max": 1, "commonIssue": "most common problem" }
  },
  "instructorActions": [
    "Specific thing you should address in the next class session",
    "Another specific action item"
  ],
  "classMessage": "A 2-3 sentence message you could read to the class. Acknowledge their effort. Note the main theme to improve on. Encourage them forward. Warm but direct.
- No sentence may exceed 18 words. Break long sentences into two.
- Avoid colons, semicolons, and em dashes. Use periods instead.
- Write in plain, direct prose."
}`
    }]
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '{}';
  return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
}

// ─── Generate Instructor PDF ──────────────────────────────────────────────

async function buildReportPDF(analysis, grades, assignment, course) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

  const W = 612, H = 792, M = 54, CW = W - M * 2, LH = 16;
  const BLUE = rgb(0.15, 0.39, 0.92);
  const RED = rgb(0.86, 0.15, 0.15);
  const GREEN = rgb(0.09, 0.64, 0.29);
  const AMBER = rgb(0.85, 0.47, 0.04);
  const BLACK = rgb(0, 0, 0);
  const GRAY = rgb(0.4, 0.4, 0.4);
  const LIGHT = rgb(0.95, 0.95, 0.95);
  const BLUE_LIGHT = rgb(0.94, 0.97, 1);

  let page = doc.addPage([W, H]);
  let y = H - M;

  function np() { page = doc.addPage([W, H]); y = H - M; }
  function chk(n = 40) { if (y < M + n) np(); }
  function wrap(text, opts = {}) {
    const { x = M, size = 10, color = BLACK, f = font, maxW = CW } = opts;
    const words = String(text || '').split(' ');
    let line = '';
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (f.widthOfTextAtSize(t, size) > maxW && line) {
        chk(); page.drawText(line, { x, y, size, font: f, color }); y -= LH; line = w;
      } else line = t;
    }
    if (line) { chk(); page.drawText(line, { x, y, size, font: f, color }); y -= LH; }
  }
  function rule() { chk(8); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: GRAY }); y -= 8; }
  function secBox(label, color = BLUE) {
    y -= 6; chk(28);
    page.drawRectangle({ x: M, y: y - 4, width: CW, height: 20, color: LIGHT });
    page.drawRectangle({ x: M, y: y - 4, width: 4, height: 20, color });
    page.drawText(label.toUpperCase(), { x: M + 10, y, size: 9, font: bold, color: GRAY });
    y -= 20;
  }

  // Title
  page.drawText(`${course?.name || 'Class'} — ${assignment?.name || 'Assignment'} Report`, { x: M, y, size: 18, font: bold, color: BLACK }); y -= 22;
  page.drawText(`INSTRUCTOR ONLY · ${grades.length} submissions · Generated ${new Date().toLocaleDateString()}`, { x: M, y, size: 9, font, color: GRAY }); y -= 20;
  rule();

  // Overview
  wrap(analysis.overview, { size: 11, f: italic, color: rgb(0.15, 0.15, 0.15) }); y -= 8;

  // Score distribution
  const s = analysis.scoreDistribution;
  const dist = [
    { label: 'Excellent (90%+)', count: s.excellent, color: GREEN },
    { label: 'Good (75–89%)', count: s.good, color: BLUE },
    { label: 'Satisfactory (60–74%)', count: s.satisfactory, color: AMBER },
    { label: 'Needs work (<60%)', count: s.needsWork, color: RED }
  ];

  const avg = grades.length ? (grades.reduce((a, g) => a + (parseFloat(g.total) || 0), 0) / grades.length).toFixed(2) : 0;
  const hi = Math.max(...grades.map(g => parseFloat(g.total) || 0));
  const lo = Math.min(...grades.map(g => parseFloat(g.total) || 0));

  secBox('Score Summary');
  const statW = (CW - 30) / 4;
  [['Average', avg], ['High', hi], ['Low', lo], ['Count', grades.length]].forEach(([l, v], i) => {
    const sx = M + i * (statW + 10);
    chk(50);
    page.drawRectangle({ x: sx, y: y - 28, width: statW, height: 36, color: LIGHT });
    page.drawText(l, { x: sx + 4, y, size: 8, font, color: GRAY });
    page.drawText(String(v), { x: sx + 4, y: y - 16, size: 16, font: bold, color: BLACK });
  });
  y -= 44;

  // Bar chart for distribution
  y -= 8;
  dist.forEach(d => {
    if (!d.count) return;
    const barW = Math.max(10, (d.count / grades.length) * (CW - 120));
    chk(18);
    page.drawText(d.label, { x: M, y, size: 9, font, color: BLACK });
    page.drawRectangle({ x: M + 120, y: y - 2, width: barW, height: 12, color: d.color });
    page.drawText(`${d.count}`, { x: M + 124 + barW, y, size: 9, font: bold, color: d.color });
    y -= LH;
  });
  y -= 8;

  // Component breakdown
  secBox('Component Breakdown');
  const components = [
    { key: 'annotated_product', label: 'Annotated Product', max: 2 },
    { key: 'narrative', label: 'Narrative', max: 2 },
    { key: 'context', label: 'Context', max: 1 },
    { key: 'overall_quality', label: 'Overall Quality', max: 1 }
  ];

  for (const comp of components) {
    const info = analysis.componentBreakdown?.[comp.key];
    if (!info) continue;
    chk(36);
    const avg2 = parseFloat(info.avg) || 0;
    const pct = avg2 / comp.max;
    const barColor = pct >= 0.85 ? GREEN : pct >= 0.6 ? AMBER : RED;
    page.drawText(comp.label, { x: M, y, size: 10, font: bold, color: BLACK }); 
    page.drawText(`${avg2.toFixed(2)} / ${comp.max}`, { x: W - M - 50, y, size: 10, font: bold, color: barColor });
    y -= 14;
    const barW2 = Math.max(4, pct * (CW - 60));
    page.drawRectangle({ x: M, y: y - 2, width: CW - 60, height: 8, color: LIGHT });
    page.drawRectangle({ x: M, y: y - 2, width: barW2, height: 8, color: barColor });
    y -= 14;
    if (info.commonIssue) {
      wrap(`→ ${info.commonIssue}`, { size: 9, color: GRAY, x: M + 8 });
    }
    y -= 4;
  }

  // Top weaknesses
  secBox('What to Address', RED);
  for (const w of (analysis.topWeaknesses || [])) {
    chk(50);
    page.drawText(`✗ ${w.title}`, { x: M, y, size: 11, font: bold, color: RED }); 
    if (w.count) page.drawText(`(${w.count} students)`, { x: W - M - 70, y, size: 9, font, color: GRAY });
    y -= 16;
    wrap(w.detail, { size: 9, color: rgb(0.2, 0.2, 0.2), x: M + 8 });
    y -= 4;
  }

  // Top strengths
  secBox('What Worked', GREEN);
  for (const s of (analysis.topStrengths || [])) {
    chk(36);
    page.drawText(`+ ${s.title}`, { x: M, y, size: 11, font: bold, color: GREEN }); y -= 16;
    wrap(s.detail, { size: 9, color: rgb(0.2, 0.2, 0.2), x: M + 8 });
    y -= 4;
  }

  // Instructor actions
  secBox('Your Action Items');
  for (const action of (analysis.instructorActions || [])) {
    chk(20);
    wrap(`→ ${action}`, { size: 10, color: BLUE });
  }
  y -= 8;

  // Class message
  secBox('Message to the Class');
  page.drawRectangle({ x: M, y: y - 8, width: CW, height: 2, color: BLUE });
  y -= 16;
  wrap(analysis.classMessage, { size: 11, f: italic, color: rgb(0.15, 0.15, 0.4) });
  y -= 12;

  // Individual grades table
  np();
  page.drawText('All Grades', { x: M, y, size: 14, font: bold, color: BLACK }); y -= 20;
  const colW = [180, 50, 55, 55, 50, 55, CW - 445];
  const headers = ['Student', 'Total', 'Ann.Prod', 'Narrative', 'Context', 'Quality', 'Key Issue'];
  headers.forEach((h, i) => {
    const x = M + colW.slice(0, i).reduce((a, b) => a + b, 0);
    page.drawText(h, { x, y, size: 8, font: bold, color: GRAY });
  });
  y -= 4;
  rule();

  for (const g of [...grades].sort((a, b) => (parseFloat(b.total) || 0) - (parseFloat(a.total) || 0))) {
    chk(16);
    const vals = [
      g.studentName || 'Unknown',
      `${g.total}/${g.maxScore}`,
      String(g.scores?.annotated_product || '-'),
      String(g.scores?.narrative || '-'),
      String(g.scores?.context || '-'),
      String(g.scores?.overall_quality || '-'),
      (g.key_improvement || '').slice(0, 50)
    ];
    vals.forEach((v, i) => {
      const x = M + colW.slice(0, i).reduce((a, b) => a + b, 0);
      const color = i === 1 ? scoreRGB(parseFloat(g.total), parseFloat(g.maxScore)) : BLACK;
      page.drawText(v, { x, y, size: 8, font: i === 1 ? bold : font, color, maxWidth: colW[i] - 4 });
    });
    y -= LH;
  }

  // Footer
  chk(20); rule();
  page.drawText('INSTRUCTOR ONLY — Teaching Platform', { x: M, y, size: 8, font, color: GRAY });

  return doc.save();
}

function scoreRGB(val, max) {
  const { rgb } = require('pdf-lib');
  const p = val / max;
  return p >= 0.85 ? rgb(0.09, 0.64, 0.29) : p >= 0.6 ? rgb(0.85, 0.47, 0.04) : rgb(0.86, 0.15, 0.15);
}

// ─── Generate Class PPTX ──────────────────────────────────────────────────

async function buildClassPPTX(analysis, grades, assignment, course) {
  const pptxgen = require('pptxgenjs');
  const pres = new pptxgen();
  pres.layout = 'LAYOUT_16x9';
  pres.title = `${course?.name} — ${assignment?.name} Debrief`;

  const NAVY = '1E3A5F';
  const WHITE = 'FFFFFF';
  const BLUE = '2563EB';
  const RED = 'DC2626';
  const GREEN = '16A34A';
  const AMBER = 'D97706';
  const LIGHT = 'F1F5F9';
  const SLATE = '64748B';

  const avg = grades.length
    ? (grades.reduce((a, g) => a + (parseFloat(g.total) || 0), 0) / grades.length).toFixed(1)
    : 0;

  // ── Slide 1: Title ──────────────────────────────────────────────────────
  let slide = pres.addSlide();
  slide.background = { color: NAVY };
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 4.5, w: 10, h: 1.125, fill: { color: BLUE }, line: { color: BLUE } });
  slide.addText(`${course?.name || 'Class'} · ${assignment?.name || 'Assignment'}`, {
    x: 0.6, y: 1.2, w: 8.8, h: 0.7, fontSize: 18, color: '93C5FD', fontFace: 'Calibri', bold: false
  });
  slide.addText('Assignment Debrief', {
    x: 0.6, y: 1.9, w: 8.8, h: 1.2, fontSize: 44, color: WHITE, fontFace: 'Calibri', bold: true
  });
  slide.addText(analysis.classMessage || '', {
    x: 0.6, y: 3.3, w: 8.8, h: 1.0, fontSize: 14, color: 'CBD5E1', fontFace: 'Calibri', italic: true
  });
  slide.addText(new Date().toLocaleDateString(), {
    x: 0.6, y: 4.6, w: 8, h: 0.4, fontSize: 12, color: WHITE, fontFace: 'Calibri'
  });

  // ── Slide 2: How the Class Did ──────────────────────────────────────────
  slide = pres.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.1, fill: { color: NAVY }, line: { color: NAVY } });
  slide.addText('How the Class Did', { x: 0.5, y: 0.15, w: 9, h: 0.8, fontSize: 32, color: WHITE, fontFace: 'Calibri', bold: true });

  // Big stat
  slide.addShape(pres.shapes.RECTANGLE, { x: 0.5, y: 1.3, w: 2.2, h: 1.8, fill: { color: LIGHT }, line: { color: 'E2E8F0' } });
  slide.addText('Class Average', { x: 0.5, y: 1.4, w: 2.2, h: 0.4, fontSize: 11, color: SLATE, fontFace: 'Calibri', align: 'center' });
  slide.addText(`${avg}`, { x: 0.5, y: 1.75, w: 2.2, h: 0.8, fontSize: 48, color: NAVY, fontFace: 'Calibri', bold: true, align: 'center' });
  slide.addText(`out of ${assignment?.max_score || 6}`, { x: 0.5, y: 2.5, w: 2.2, h: 0.4, fontSize: 12, color: SLATE, fontFace: 'Calibri', align: 'center' });

  // Component bars
  const comps = [
    { label: 'Annotated Product', key: 'annotated_product', max: 2 },
    { label: 'Narrative', key: 'narrative', max: 2 },
    { label: 'Context', key: 'context', max: 1 },
    { label: 'Overall Quality', key: 'overall_quality', max: 1 }
  ];

  const startY = 1.3;
  comps.forEach((c, i) => {
    const info = analysis.componentBreakdown?.[c.key] || {};
    const avg2 = parseFloat(info.avg) || 0;
    const pct = avg2 / c.max;
    const barColor = pct >= 0.85 ? GREEN : pct >= 0.6 ? AMBER : RED;
    const x = 3.2;
    const y = startY + i * 0.95;
    const maxBarW = 6.2;
    const barW = Math.max(0.1, pct * maxBarW);

    slide.addText(c.label, { x, y, w: 2.5, h: 0.35, fontSize: 12, color: NAVY, fontFace: 'Calibri', bold: true });
    slide.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.38, w: maxBarW, h: 0.3, fill: { color: 'E2E8F0' }, line: { color: 'E2E8F0' } });
    slide.addShape(pres.shapes.RECTANGLE, { x, y: y + 0.38, w: barW, h: 0.3, fill: { color: barColor }, line: { color: barColor } });
    slide.addText(`${avg2.toFixed(1)}/${c.max}`, { x: x + maxBarW + 0.1, y: y + 0.3, w: 0.8, h: 0.4, fontSize: 12, color: barColor, fontFace: 'Calibri', bold: true });
  });

  // ── Slides 3+: One per major weakness ──────────────────────────────────
  for (const weakness of (analysis.topWeaknesses || []).slice(0, 4)) {
    slide = pres.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.1, fill: { color: RED }, line: { color: RED } });
    slide.addText('Area to Improve', { x: 0.5, y: 0.05, w: 6, h: 0.45, fontSize: 13, color: 'FCA5A5', fontFace: 'Calibri' });
    slide.addText(weakness.title, { x: 0.5, y: 0.45, w: 9, h: 0.55, fontSize: 26, color: WHITE, fontFace: 'Calibri', bold: true });

    // How many students
    if (weakness.count) {
      slide.addText(`${weakness.count} of ${grades.length} students`, {
        x: 7.5, y: 0.1, w: 2.2, h: 0.8, fontSize: 22, color: WHITE, fontFace: 'Calibri', bold: true, align: 'right'
      });
    }

    // Main content
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.25, w: 5.8, h: 3.8, fill: { color: 'FEF2F2' }, line: { color: 'FECACA' } });
    slide.addText('What we saw', { x: 0.6, y: 1.35, w: 5.4, h: 0.4, fontSize: 12, color: RED, fontFace: 'Calibri', bold: true });
    slide.addText(weakness.detail, { x: 0.6, y: 1.8, w: 5.4, h: 3.0, fontSize: 13, color: '1E293B', fontFace: 'Calibri', valign: 'top' });

    // Teaching content
    slide.addShape(pres.shapes.RECTANGLE, { x: 6.4, y: 1.25, w: 3.2, h: 3.8, fill: { color: 'EFF6FF' }, line: { color: 'BFDBFE' } });
    slide.addText('What to do', { x: 6.5, y: 1.35, w: 3.0, h: 0.4, fontSize: 12, color: BLUE, fontFace: 'Calibri', bold: true });
    slide.addText(weakness.slideContent || '', { x: 6.5, y: 1.8, w: 3.0, h: 3.0, fontSize: 12, color: '1E293B', fontFace: 'Calibri', valign: 'top' });
  }

  // ── Slide: What Worked ──────────────────────────────────────────────────
  slide = pres.addSlide();
  slide.background = { color: 'FFFFFF' };
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 1.1, fill: { color: GREEN }, line: { color: GREEN } });
  slide.addText('What Worked Well', { x: 0.5, y: 0.15, w: 9, h: 0.8, fontSize: 32, color: WHITE, fontFace: 'Calibri', bold: true });

  const strengths = analysis.topStrengths || [];
  const cardW = strengths.length > 2 ? 2.8 : 4.2;
  strengths.slice(0, 3).forEach((s, i) => {
    const x = 0.4 + i * (cardW + 0.3);
    slide.addShape(pres.shapes.RECTANGLE, { x, y: 1.3, w: cardW, h: 3.8, fill: { color: 'F0FDF4' }, line: { color: 'BBF7D0' } });
    slide.addText('+', { x: x + 0.15, y: 1.4, w: 0.5, h: 0.6, fontSize: 28, color: GREEN, fontFace: 'Calibri', bold: true });
    slide.addText(s.title, { x: x + 0.1, y: 2.0, w: cardW - 0.2, h: 0.6, fontSize: 14, color: NAVY, fontFace: 'Calibri', bold: true });
    slide.addText(s.detail, { x: x + 0.1, y: 2.65, w: cardW - 0.2, h: 2.2, fontSize: 11, color: '1E293B', fontFace: 'Calibri', valign: 'top' });
  });

  // ── Final Slide: Next Steps ─────────────────────────────────────────────
  slide = pres.addSlide();
  slide.background = { color: NAVY };
  slide.addShape(pres.shapes.RECTANGLE, { x: 0, y: 4.5, w: 10, h: 1.125, fill: { color: BLUE }, line: { color: BLUE } });
  slide.addText('Moving Forward', { x: 0.6, y: 0.8, w: 8.8, h: 0.8, fontSize: 36, color: WHITE, fontFace: 'Calibri', bold: true });

  const actions = analysis.instructorActions || [];
  const displayActions = actions.slice(0, 4);
  displayActions.forEach((action, i) => {
    slide.addShape(pres.shapes.RECTANGLE, { x: 0.4, y: 1.8 + i * 0.68, w: 0.4, h: 0.4, fill: { color: BLUE }, line: { color: BLUE } });
    slide.addText(String(i + 1), { x: 0.4, y: 1.82 + i * 0.68, w: 0.4, h: 0.38, fontSize: 14, color: WHITE, fontFace: 'Calibri', bold: true, align: 'center' });
    slide.addText(action, { x: 1.0, y: 1.8 + i * 0.68, w: 8.5, h: 0.5, fontSize: 14, color: 'E2E8F0', fontFace: 'Calibri' });
  });

  slide.addText(`${course?.name} · ${assignment?.name}`, { x: 0.6, y: 4.6, w: 8, h: 0.4, fontSize: 11, color: WHITE, fontFace: 'Calibri' });

  return pres.write({ outputType: 'nodebuffer' });
}

// ─── Routes ───────────────────────────────────────────────────────────────

// GET /api/classreport/:assignmentId/pdf
router.get('/:assignmentId/pdf', async (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.assignmentId);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(assignment.course_id);

  const grades = db.prepare('SELECT * FROM grades WHERE assignment_id=? ORDER BY total DESC')
    .all(req.params.assignmentId)
    .map(g => ({
      ...g,
      scores: JSON.parse(g.scores || '{}'),
      comments: JSON.parse(g.comments || '{}')
    }));

  if (!grades.length) return res.status(400).json({ error: 'No grades found for this assignment' });

  try {
    const analysis = await analyzeClass(grades, assignment, course);
    const pdfBytes = await buildReportPDF(analysis, grades, assignment, course);

    const safeName = (assignment.name || 'report').replace(/\s+/g, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_class_report.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('Report error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/classreport/:assignmentId/pptx
router.get('/:assignmentId/pptx', async (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.assignmentId);
  if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(assignment.course_id);

  const grades = db.prepare('SELECT * FROM grades WHERE assignment_id=? ORDER BY total DESC')
    .all(req.params.assignmentId)
    .map(g => ({
      ...g,
      scores: JSON.parse(g.scores || '{}'),
      comments: JSON.parse(g.comments || '{}')
    }));

  if (!grades.length) return res.status(400).json({ error: 'No grades found' });

  try {
    const analysis = await analyzeClass(grades, assignment, course);
    const buffer = await buildClassPPTX(analysis, grades, assignment, course);

    const safeName = (assignment.name || 'debrief').replace(/\s+/g, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_class_debrief.pptx"`);
    res.send(buffer);
  } catch (e) {
    console.error('PPTX error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/classreport/:assignmentId/both — trigger both (returns JSON with download links)
router.get('/:assignmentId/analysis', async (req, res) => {
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.assignmentId);
  if (!assignment) return res.status(404).json({ error: 'Not found' });
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(assignment.course_id);

  const grades = db.prepare('SELECT * FROM grades WHERE assignment_id=?')
    .all(req.params.assignmentId)
    .map(g => ({ ...g, scores: JSON.parse(g.scores || '{}'), comments: JSON.parse(g.comments || '{}') }));

  if (!grades.length) return res.status(400).json({ error: 'No grades found' });

  try {
    const analysis = await analyzeClass(grades, assignment, course);
    res.json({ analysis, gradeCount: grades.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
