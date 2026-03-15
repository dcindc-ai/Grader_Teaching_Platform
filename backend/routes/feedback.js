const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db, parseGrade, firstName } = require('../db');
const router = express.Router();

const SECTION_LABELS = {
  annotated_product: 'Annotated Product',
  narrative: 'Narrative',
  context: 'Context',
  overall_quality: 'Overall Quality'
};
const SECTION_MAX = { annotated_product: 2, narrative: 2, context: 1, overall_quality: 1 };

// POST /api/feedback/regenerate/:gradeId — regenerate instructor paragraph
router.post('/regenerate/:gradeId', async (req, res) => {
  const grade = parseGrade(db.prepare('SELECT * FROM grades WHERE id=?').get(req.params.gradeId));
  if (!grade) return res.status(404).json({ error: 'Grade not found' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(grade.courseId);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(grade.assignmentId);

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const firstName = (grade.studentName || 'Student').split(' ')[0];
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: `You are ${course?.instructor_bio ? 'Dave Cook, ' + course.instructor_bio : 'an instructor'} giving personalized feedback to a student.

Write a 3-4 sentence feedback paragraph in your voice:
1. Start with the student's FIRST NAME ONLY (not full name) and a genuine, specific compliment about something they did well
2. Give 1-2 sentences of honest critical feedback with concrete suggestions
3. End with a forward-looking, encouraging close

Tone: warm, direct, like a real mentor. Not generic praise. Sound like you know this student's work specifically.
Keep it under 80 words.
Writing style rules (apply to all generated text):
- No sentence may exceed 18 words. Break long sentences into two.
- Avoid colons, semicolons, and em dashes. Use periods instead.
- Write in plain, direct prose.`,
      messages: [{
        role: 'user',
        content: `Student first name: ${firstName}
Assignment: ${assignment?.name || grade.assignmentName}
Score: ${grade.total}/${grade.maxScore}
Key strength: ${grade.key_strength || 'good analytical effort'}
Key improvement: ${grade.key_improvement || 'needs clearer significance statement'}
Summary: ${grade.summary || ''}

Write the instructor paragraph.`
      }]
    });

    const paragraph = resp.content.find(b => b.type === 'text')?.text?.trim() || '';
    db.prepare('UPDATE grades SET instructor_paragraph=? WHERE id=?').run(paragraph, grade.id);
    res.json({ paragraph });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/feedback/docx/:gradeId — download feedback as Word doc
router.get('/docx/:gradeId', async (req, res) => {
  const grade = parseGrade(db.prepare('SELECT * FROM grades WHERE id=?').get(req.params.gradeId));
  if (!grade) return res.status(404).json({ error: 'Grade not found' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(grade.courseId);

  try {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, HeadingLevel, BorderStyle, WidthType, ShadingType,
      LevelFormat
    } = require('docx');

    const BLUE = '2563EB';
    const GREEN = '16A34A';
    const RED = 'DC2626';
    const GRAY = '6B7280';
    const LIGHT_BLUE = 'EFF6FF';
    const LIGHT_GREEN = 'F0FDF4';
    const LIGHT_RED = 'FEF2F2';
    const LIGHT_GRAY = 'F9FAFB';

    const border = { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const noBorders = {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 }
    };

    const children = [];

    // Header
    children.push(new Paragraph({
      children: [new TextRun({ text: `${course?.name || 'GEOG 661'} — Lab Feedback`, bold: true, size: 28, color: BLUE, font: 'Arial' })],
      spacing: { after: 80 }
    }));

    children.push(new Paragraph({
      children: [
        new TextRun({ text: `Student: `, bold: true, size: 22, font: 'Arial' }),
        new TextRun({ text: grade.studentName || 'Unknown', size: 22, font: 'Arial' }),
        new TextRun({ text: `   |   Assignment: `, bold: true, size: 22, font: 'Arial' }),
        new TextRun({ text: grade.assignmentName || '', size: 22, font: 'Arial' }),
        new TextRun({ text: `   |   Date: `, bold: true, size: 22, font: 'Arial' }),
        new TextRun({ text: new Date(grade.gradedAt).toLocaleDateString(), size: 22, font: 'Arial' })
      ],
      spacing: { after: 80 }
    }));

    // Divider
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 1 } },
      spacing: { after: 200 }
    }));

    // Score box
    const s = grade.scores || {};
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [2340, 2340, 2340, 2340],
      rows: [
        new TableRow({
          children: [
            ...['Annotated Product', 'Narrative', 'Context', 'Overall Quality'].map((label, i) => {
              const keys = ['annotated_product', 'narrative', 'context', 'overall_quality'];
              const maxes = [2, 2, 1, 1];
              const val = s[keys[i]] || 0;
              const max = maxes[i];
              const color = val/max >= 0.85 ? GREEN : val/max >= 0.6 ? 'D97706' : RED;
              return new TableCell({
                borders,
                width: { size: 2340, type: WidthType.DXA },
                shading: { fill: 'F9FAFB', type: ShadingType.CLEAR },
                margins: { top: 120, bottom: 120, left: 120, right: 120 },
                children: [
                  new Paragraph({ children: [new TextRun({ text: label, size: 16, color: '9CA3AF', font: 'Arial' })], spacing: { after: 40 } }),
                  new Paragraph({ children: [new TextRun({ text: `${val}/${max}`, bold: true, size: 28, color, font: 'Arial' })] })
                ]
              });
            })
          ]
        }),
        new TableRow({
          children: [
            new TableCell({
              borders,
              columnSpan: 4,
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [new Paragraph({
                children: [
                  new TextRun({ text: 'TOTAL: ', bold: true, size: 22, color: BLUE, font: 'Arial' }),
                  new TextRun({ text: `${grade.total} / ${grade.maxScore}`, bold: true, size: 28, color: BLUE, font: 'Arial' })
                ]
              })]
            })
          ]
        })
      ]
    }));

    children.push(new Paragraph({ spacing: { after: 240 } }));

    // Instructor paragraph
    if (grade.instructor_paragraph) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Instructor Feedback', bold: true, size: 22, color: BLUE, font: 'Arial' })],
        spacing: { after: 100 }
      }));
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({
          children: [new TableCell({
            borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 0 } },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
            margins: { top: 120, bottom: 120, left: 180, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: grade.instructor_paragraph, size: 22, italics: true, font: 'Arial', color: '1E3A5F' })]
            })]
          })]
        })]
      }));
      children.push(new Paragraph({ spacing: { after: 240 } }));
    }

    // Strength / improvement
    if (grade.key_strength) {
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({
          children: [new TableCell({
            borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 12, color: GREEN, space: 0 } },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: 'F0FDF4', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: '+ ' + grade.key_strength, size: 20, color: '166534', font: 'Arial' })]
            })]
          })]
        })]
      }));
      children.push(new Paragraph({ spacing: { after: 60 } }));
    }

    if (grade.key_improvement) {
      children.push(new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [9360],
        rows: [new TableRow({
          children: [new TableCell({
            borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 12, color: RED, space: 0 } },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: 'FEF2F2', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({
              children: [new TextRun({ text: '→ ' + grade.key_improvement, size: 20, color: '991B1B', font: 'Arial' })]
            })]
          })]
        })]
      }));
      children.push(new Paragraph({ spacing: { after: 200 } }));
    }

    // Section comments
    for (const [key, label] of Object.entries(SECTION_LABELS)) {
      const comments = grade.comments?.[key] || [];
      if (!comments.length) continue;

      children.push(new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB', space: 1 } },
        spacing: { before: 160, after: 100 },
        children: [new TextRun({ text: label.toUpperCase(), bold: true, size: 18, color: '6B7280', font: 'Arial' })]
      }));

      for (const c of comments) {
        const isPos = c.type === 'positive';
        const color = isPos ? '166534' : '111827';
        const prefix = isPos ? '+ ' : '✗ ';
        const bgFill = isPos ? 'F0FDF4' : 'FFFFFF';
        const borderColor = isPos ? GREEN : RED;

        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [9360],
          rows: [new TableRow({
            children: [new TableCell({
              borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 8, color: borderColor, space: 0 } },
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: bgFill, type: ShadingType.CLEAR },
              margins: { top: 60, bottom: 60, left: 120, right: 120 },
              children: [new Paragraph({
                children: [new TextRun({ text: prefix + c.text, size: 20, color, font: 'Arial' })]
              })]
            })]
          })]
        }));

        if (c.rewrite) {
          children.push(new Table({
            width: { size: 9000, type: WidthType.DXA },
            columnWidths: [9000],
            rows: [new TableRow({
              children: [new TableCell({
                borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 8, color: BLUE, space: 0 } },
                width: { size: 9000, type: WidthType.DXA },
                shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
                margins: { top: 60, bottom: 60, left: 120, right: 120 },
                children: [new Paragraph({
                  children: [new TextRun({
                    text: '↳ ' + c.rewrite.replace(/^Suggested rewrite:\s*/i, ''),
                    size: 18, italics: true, color: '1D4ED8', font: 'Arial'
                  })]
                })]
              })]
            })]
          }));
        }
        children.push(new Paragraph({ spacing: { after: 40 } }));
      }
    }

    // Resources
    const gradeResources = grade.resources || [];
    if (gradeResources.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Recommended Resources', bold: true, size: 22, color: BLUE, font: 'Arial' })],
        spacing: { before: 200, after: 120 }
      }));

      for (const r of gradeResources) {
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
          rows: [new TableRow({ children: [new TableCell({
            borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 0 } },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
            margins: { top: 80, bottom: 80, left: 160, right: 120 },
            children: [
              new Paragraph({ children: [new TextRun({ text: r.title || r.url, bold: true, size: 20, color: BLUE, font: 'Arial' })], spacing: { after: 40 } }),
              r.why ? new Paragraph({ children: [new TextRun({ text: r.why, size: 18, color: '6B7280', font: 'Arial' })], spacing: { after: 40 } }) : new Paragraph({}),
              new Paragraph({ children: [new TextRun({ text: r.url, size: 16, color: '60A5FA', font: 'Arial' })] })
            ]
          })] })]
        }));
        children.push(new Paragraph({ spacing: { after: 80 } }));
      }
    }

    // Footer
    children.push(new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB', space: 1 } },
      spacing: { before: 200 },
      children: [new TextRun({ text: 'Generated by Teaching Platform', size: 16, color: '9CA3AF', font: 'Arial' })]
    }));

    const doc = new Document({
      styles: {
        default: { document: { run: { font: 'Arial', size: 22 } } }
      },
      sections: [{
        properties: {
          page: {
            size: { width: 12240, height: 15840 },
            margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 }
          }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = (grade.studentName || 'unknown').replace(/[^a-z0-9_]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_feedback.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('DOCX error:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// GET /api/feedback/redlined-pdf/:gradeId
router.get('/redlined-pdf/:gradeId', async (req, res) => {
  const grade = parseGrade(db.prepare('SELECT * FROM grades WHERE id=?').get(req.params.gradeId));
  if (!grade) return res.status(404).json({ error: 'Grade not found' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(grade.courseId);

  try {
    const { PDFDocument, rgb, StandardFonts, PDFName } = require('pdf-lib');

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

    const W = 612, H = 792, M = 48, CW = W - M * 2, LH = 16;
    const BLUE = rgb(0.15, 0.39, 0.92);
    const RED = rgb(0.86, 0.15, 0.15);
    const GREEN = rgb(0.09, 0.64, 0.29);
    const AMBER = rgb(0.85, 0.47, 0.04);
    const BLACK = rgb(0, 0, 0);
    const GRAY = rgb(0.45, 0.45, 0.45);
    const LIGHT_RED = rgb(1, 0.95, 0.95);
    const LIGHT_GREEN = rgb(0.94, 1, 0.94);
    const LIGHT_BLUE = rgb(0.93, 0.96, 1);

    let page = doc.addPage([W, H]);
    let y = H - M;

    function np() { page = doc.addPage([W, H]); y = H - M; }
    function chk(n = 40) { if (y < M + n) np(); }
    function wrap(text, opts = {}) {
      const { x = M, size = 10, color = BLACK, f = font, maxW = CW, indent = 0 } = opts;
      const words = String(text || '').split(' ');
      let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) > maxW - indent && line) {
          chk();
          page.drawText(line, { x: x + (line === words[0] ? 0 : indent), y, size, font: f, color });
          y -= LH;
          line = w;
        } else line = t;
      }
      if (line) {
        chk();
        page.drawText(line, { x, y, size, font: f, color });
        y -= LH;
      }
    }
    function rule(color = GRAY) {
      chk(8);
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color });
      y -= 8;
    }
    function badge(label, color, bgColor, bx, by) {
      const w = font.widthOfTextAtSize(label, 9) + 12;
      page.drawRectangle({ x: bx, y: by - 4, width: w, height: 14, color: bgColor, borderColor: color, borderWidth: 0.5 });
      page.drawText(label, { x: bx + 6, y: by, size: 9, font: bold, color });
      return w;
    }

    // ── Cover page ────────────────────────────────────────────────────────
    page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: rgb(0.12, 0.25, 0.58) });
    page.drawText('GRADED FEEDBACK', { x: M, y: H - 36, size: 22, font: bold, color: rgb(1,1,1) });
    page.drawText(`${course?.name || 'GEOG 661'} — ${grade.assignmentName || 'Lab'}`, { x: M, y: H - 58, size: 12, font, color: rgb(0.8, 0.88, 1) });
    page.drawText(`Student: ${grade.studentName || 'Unknown'} · ${new Date(grade.gradedAt).toLocaleDateString()}`, { x: M, y: H - 76, size: 10, font, color: rgb(0.8, 0.88, 1) });
    y = H - 110;

    // Score overview
    const s = grade.scores || {};
    const sections = [
      ['Annotated Product', 'annotated_product', 2],
      ['Narrative', 'narrative', 2],
      ['Context', 'context', 1],
      ['Overall Quality', 'overall_quality', 1]
    ];

    y -= 8;
    const cellW = (CW - 12) / 4;
    sections.forEach(([label, key, mx], i) => {
      const val = parseFloat(s[key]) || 0;
      const pct = val / mx;
      const barColor = pct >= 0.85 ? GREEN : pct >= 0.6 ? AMBER : RED;
      const cellX = M + i * (cellW + 4);
      page.drawRectangle({ x: cellX, y: y - 36, width: cellW, height: 44, color: rgb(0.97, 0.97, 0.97) });
      page.drawText(label.toUpperCase(), { x: cellX + 4, y, size: 7, font: bold, color: GRAY });
      page.drawText(`${val}/${mx}`, { x: cellX + 4, y: y - 18, size: 18, font: bold, color: barColor });
    });
    y -= 52;

    // Total
    const totalVal = parseFloat(grade.total) || 0;
    const totalMax = parseFloat(grade.maxScore) || 6;
    const totalPct = totalVal / totalMax;
    const totalColor = totalPct >= 0.85 ? GREEN : totalPct >= 0.7 ? AMBER : RED;
    page.drawRectangle({ x: M, y: y - 8, width: CW, height: 28, color: rgb(0.93, 0.96, 1) });
    page.drawText('TOTAL', { x: M + 8, y: y + 4, size: 10, font: bold, color: BLUE });
    page.drawText(`${grade.total} / ${grade.maxScore}  (${Math.round(totalPct * 100)}%)`, { x: M + 80, y: y + 4, size: 14, font: bold, color: totalColor });
    y -= 36;
    rule(BLUE);

    // Key strength / improvement
    if (grade.key_strength) {
      page.drawRectangle({ x: M, y: y - 8, width: CW, height: LH + 8, color: LIGHT_GREEN });
      page.drawText('+ ' + grade.key_strength, { x: M + 8, y, size: 10, font: bold, color: GREEN });
      y -= LH + 12;
    }
    if (grade.key_improvement) {
      page.drawRectangle({ x: M, y: y - 8, width: CW, height: LH + 8, color: LIGHT_RED });
      page.drawText('→ ' + grade.key_improvement, { x: M + 8, y, size: 10, font: bold, color: RED });
      y -= LH + 12;
    }
    y -= 4;
    rule();

    // Instructor paragraph
    page.drawText('INSTRUCTOR FEEDBACK', { x: M, y, size: 9, font: bold, color: BLUE });
    y -= LH + 2;
    page.drawRectangle({ x: M, y: y - 8, width: 4, height: 80, color: BLUE });
    wrap(grade.instructor_paragraph || 'No feedback paragraph generated.', { x: M + 12, size: 11, f: italic, color: rgb(0.1, 0.1, 0.3), maxW: CW - 12 });
    y -= 8;
    rule();

    // Section comments
    for (const [key, label] of Object.entries({ annotated_product: 'Annotated Product', narrative: 'Narrative', context: 'Context', overall_quality: 'Overall Quality' })) {
      const comments = grade.comments?.[key] || [];
      if (!comments.length) continue;

      chk(30);
      page.drawText(label.toUpperCase(), { x: M, y, size: 9, font: bold, color: GRAY });
      const secVal = parseFloat(s[key]) || 0;
      const secMax = { annotated_product: 2, narrative: 2, context: 1, overall_quality: 1 }[key] || 1;
      page.drawText(`${secVal}/${secMax}`, { x: W - M - 25, y, size: 10, font: bold, color: secVal/secMax >= 0.85 ? GREEN : secVal/secMax >= 0.6 ? AMBER : RED });
      y -= LH;
      page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.3, color: rgb(0.8, 0.8, 0.8) });
      y -= 6;

      for (const c of comments) {
        const isPos = c.type === 'positive';
        const commentColor = isPos ? GREEN : RED;
        const bgColor = isPos ? LIGHT_GREEN : LIGHT_RED;
        const prefix = isPos ? '+ ' : '✗ ';

        chk(24);
        const textW = CW - 20;
        const approxH = Math.ceil(font.widthOfTextAtSize((c.text || ''), 10) / textW) * LH + 12;
        page.drawRectangle({ x: M, y: y - approxH + LH, width: CW, height: approxH, color: bgColor });
        page.drawRectangle({ x: M, y: y - approxH + LH, width: 3, height: approxH, color: commentColor });
        wrap(prefix + (c.text || ''), { x: M + 8, size: 10, color: BLACK, maxW: textW });

        if (c.rewrite && c.type !== 'positive') {
          chk(20);
          wrap('↳ ' + c.rewrite.replace(/^Suggested rewrite:\s*/i, ''), { x: M + 16, size: 9, f: italic, color: BLUE, maxW: CW - 16 });
        }
        y -= 4;
      }
      y -= 8;
    }

    // Resources
    if (grade.resources?.length) {
      chk(40);
      rule(BLUE);
      page.drawText('RECOMMENDED RESOURCES', { x: M, y, size: 9, font: bold, color: BLUE });
      y -= LH + 2;

      for (const r of grade.resources) {
        chk(36);
        page.drawRectangle({ x: M, y: y - 28, width: CW, height: 36, color: LIGHT_BLUE });
        page.drawText(r.title || r.url, { x: M + 8, y, size: 11, font: bold, color: BLUE });
        y -= LH;
        if (r.why) {
          page.drawText(r.why, { x: M + 8, y, size: 9, font, color: GRAY });
          y -= LH;
        }
        page.drawText(r.url, { x: M + 8, y, size: 8, font, color: BLUE });
        y -= LH + 8;
      }
    }

    // Footer
    chk(20);
    rule();
    page.drawText(`${course?.name || 'GEOG 661'} · Teaching Platform · INSTRUCTOR ONLY`, { x: M, y, size: 8, font, color: GRAY });

    const pdfBytes = await doc.save();
    const safeName = (grade.studentName || 'unknown').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_graded_feedback.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('Redlined PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});
