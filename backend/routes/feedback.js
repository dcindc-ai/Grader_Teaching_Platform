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
    , ExternalHyperlink} = require('docx');

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

    // Always-On Learning section
    const ao = db.prepare('SELECT * FROM always_on WHERE grade_id=? ORDER BY created_at DESC LIMIT 1').get(grade.id);
    if (ao && ao.status === 'approved') {
      const GREEN_AO = '166534';
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Recommended Resources', bold: true, size: 22, color: GREEN_AO, font: 'Arial' })],
        spacing: { before: 200, after: 120 }
      }));
      if (ao.weak_area) {
        children.push(new Paragraph({
          children: [
            new TextRun({ text: 'Focus area: ', bold: true, size: 20, color: '374151', font: 'Arial' }),
            new TextRun({ text: ao.weak_area, size: 20, color: '374151', font: 'Arial' })
          ],
          spacing: { after: 80 }
        }));
      }
      if (ao.feedback_sentences) {
        children.push(new Paragraph({
          children: [new TextRun({ text: ao.feedback_sentences, size: 20, color: '111827', font: 'Arial' })],
          spacing: { after: 120 }
        }));
      }
      const aoLinks = (() => { try { const l = JSON.parse(ao.links || '[]'); return Array.isArray(l) ? l.filter(x => x && x.url) : []; } catch(e) { return []; } })();
      for (const lk of aoLinks.slice(0, 3)) {
        if (lk.why) {
          children.push(new Paragraph({
            children: [new TextRun({ text: lk.why, size: 18, color: '374151', font: 'Arial', italics: true })],
            spacing: { after: 40 }
          }));
        }
        children.push(new Paragraph({
          children: [new ExternalHyperlink({
            link: lk.url || '',
            children: [new TextRun({ text: lk.title || lk.url || '', size: 18, color: '2563EB', font: 'Arial', underline: {} })]
          })],
          spacing: { after: 80 }
        }));
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
  const fs = require('fs');

  try {
    const { PDFDocument, rgb, StandardFonts, degrees } = require('pdf-lib');

    const BLUE = rgb(0.15, 0.39, 0.92);
    const RED = rgb(0.86, 0.15, 0.15);
    const GREEN = rgb(0.09, 0.64, 0.29);
    const AMBER = rgb(0.85, 0.47, 0.04);
    const BLACK = rgb(0, 0, 0);
    const GRAY = rgb(0.45, 0.45, 0.45);
    const WHITE = rgb(1, 1, 1);

    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const italic = await doc.embedFont(StandardFonts.HelveticaOblique);

    // ── Page 1: If we have the original PDF, embed its pages ──────────
    let originalPageCount = 0;
    if (grade.originalFilePath && fs.existsSync(grade.originalFilePath)) {
      try {
        const originalBytes = fs.readFileSync(grade.originalFilePath);
        const originalDoc = await PDFDocument.load(originalBytes);
        const pageCount = originalDoc.getPageCount();
        const pages = await doc.copyPages(originalDoc, [...Array(pageCount).keys()]);
        
        // Embed pages and add comment overlays on page 2 (annotated product)
        for (let i = 0; i < pages.length; i++) {
          const embeddedPage = doc.addPage(pages[i]);
          const { width, height } = embeddedPage.getSize();
          
          if (i === 1) {
            // Page 2 = annotated product — overlay comments as callout boxes
            const comments = grade.comments?.annotated_product || [];
            let commentY = height - 40;
            let commentNum = 1;

            // Draw semi-transparent header bar
            embeddedPage.drawRectangle({
              x: 0, y: height - 28, width, height: 28,
              color: rgb(0.12, 0.25, 0.58), opacity: 0.9
            });
            embeddedPage.drawText(`INSTRUCTOR COMMENTS — ${grade.studentName || 'Student'}  |  Score: ${grade.total}/${grade.maxScore}`, {
              x: 10, y: height - 18, size: 9, font: bold, color: WHITE, opacity: 1
            });

            // Place comment callout boxes on the right side
            const boxX = width - 200;
            for (const c of comments.slice(0, 6)) {
              const isPos = c.type === 'positive';
              const boxColor = isPos ? rgb(0.9, 1, 0.9) : rgb(1, 0.93, 0.93);
              const borderColor = isPos ? GREEN : RED;
              const textColor = isPos ? rgb(0, 0.4, 0) : rgb(0.6, 0, 0);
              const prefix = isPos ? '+' : 'X';
              const text = `${commentNum}. ${prefix} ${(c.text || '').slice(0, 80)}`;
              const boxH = Math.max(32, Math.ceil(text.length / 32) * 11 + 10);

              if (commentY - boxH < 30) break;

              embeddedPage.drawRectangle({
                x: boxX - 2, y: commentY - boxH, width: 198, height: boxH,
                color: boxColor, opacity: 0.92,
                borderColor, borderWidth: 1.5
              });
              embeddedPage.drawText(String(commentNum), {
                x: boxX + 3, y: commentY - 11, size: 8, font: bold, color: borderColor
              });

              // Wrap text manually
              const words = text.slice(3).split(' ');
              let line = `${prefix} `;
              let lineY = commentY - 11;
              for (const w of words) {
                const test = line + w + ' ';
                if (font.widthOfTextAtSize(test, 7.5) > 180 && line.trim()) {
                  embeddedPage.drawText(line.trim(), { x: boxX + 14, y: lineY, size: 7.5, font, color: textColor });
                  lineY -= 10;
                  line = w + ' ';
                } else line = test;
              }
              if (line.trim()) embeddedPage.drawText(line.trim(), { x: boxX + 14, y: lineY, size: 7.5, font, color: textColor });

              commentY -= boxH + 4;
              commentNum++;
            }
          }
          originalPageCount++;
        }
      } catch (e) {
        console.error('Could not embed original PDF:', e.message);
      }
    }

    // ── Summary feedback page ─────────────────────────────────────────
    const W = 612, H = 792, M = 48, CW = W - M * 2, LH = 16;
    let page = doc.addPage([W, H]);
    let y = H - M;

    function np() { page = doc.addPage([W, H]); y = H - M; }
    function chk(n = 40) { if (y < M + n) np(); }
    function wrap(text, opts = {}) {
      const { x = M, size = 10, color = BLACK, f = font, maxW = CW } = opts;
      const words = String(text || '').replace(/[^ -ÿ]/g, '?').split(' ');
      let line = '';
      for (const w of words) {
        const t = line ? line + ' ' + w : w;
        if (f.widthOfTextAtSize(t, size) > maxW && line) {
          chk(); page.drawText(line, { x, y, size, font: f, color }); y -= LH; line = w;
        } else line = t;
      }
      if (line) { chk(); page.drawText(line, { x, y, size, font: f, color }); y -= LH; }
    }
    function rule(c = GRAY) {
      chk(8); page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: c }); y -= 8;
    }
    function sanitize(text) { return String(text || '').replace(/[\r\n\t]+/g, ' ').replace(/[^\x00-\xff]/g, '-'); }

    // Header
    page.drawRectangle({ x: 0, y: H - 90, width: W, height: 90, color: rgb(0.12, 0.25, 0.58) });
    page.drawText('GRADED FEEDBACK', { x: M, y: H - 36, size: 20, font: bold, color: WHITE });
    page.drawText(`${course?.name || 'GEOG 661'} — ${sanitize(grade.assignmentName)}`, { x: M, y: H - 56, size: 11, font, color: rgb(0.8, 0.88, 1) });
    page.drawText(`Student: ${sanitize(grade.studentName)}    Date: ${new Date(grade.gradedAt).toLocaleDateString()}`, { x: M, y: H - 74, size: 9, font, color: rgb(0.8, 0.88, 1) });
    y = H - 108;

    // Score grid
    const s = grade.scores || {};
    const sections = [['Annotated Product','annotated_product',2],['Narrative','narrative',2],['Context','context',1],['Quality','overall_quality',1]];
    const cellW = (CW - 12) / 4;
    sections.forEach(([label, key, mx], i) => {
      const val = parseFloat(s[key]) || 0;
      const pct = val / mx;
      const barColor = pct >= 0.85 ? GREEN : pct >= 0.6 ? AMBER : RED;
      const cx = M + i * (cellW + 4);
      page.drawRectangle({ x: cx, y: y - 36, width: cellW, height: 44, color: rgb(0.96,0.96,0.96) });
      page.drawText(label.toUpperCase(), { x: cx + 4, y, size: 7, font: bold, color: GRAY });
      page.drawText(`${val}/${mx}`, { x: cx + 4, y: y - 18, size: 18, font: bold, color: barColor });
    });
    y -= 52;

    const totalPct = parseFloat(grade.total) / parseFloat(grade.maxScore);
    const totalColor = totalPct >= 0.85 ? GREEN : totalPct >= 0.7 ? AMBER : RED;
    page.drawRectangle({ x: M, y: y - 8, width: CW, height: 26, color: rgb(0.92, 0.95, 1) });
    page.drawText(`TOTAL: ${grade.total} / ${grade.maxScore}  (${Math.round(totalPct * 100)}%)`, { x: M + 8, y: y + 2, size: 13, font: bold, color: totalColor });
    y -= 36;
    rule(BLUE);

    // Strength / improvement
    if (grade.key_strength) {
      page.drawRectangle({ x: M, y: y - 8, width: CW, height: LH + 8, color: rgb(0.92, 1, 0.92) });
      page.drawText('+ ' + sanitize(grade.key_strength), { x: M + 8, y, size: 10, font: bold, color: GREEN });
      y -= LH + 12;
    }
    if (grade.key_improvement) {
      page.drawRectangle({ x: M, y: y - 8, width: CW, height: LH + 8, color: rgb(1, 0.93, 0.93) });
      page.drawText('> ' + sanitize(grade.key_improvement), { x: M + 8, y, size: 10, font: bold, color: RED });
      y -= LH + 12;
    }
    y -= 4; rule();

    // Instructor paragraph
    page.drawText('INSTRUCTOR FEEDBACK', { x: M, y, size: 9, font: bold, color: BLUE }); y -= LH + 2;
    page.drawRectangle({ x: M, y: y - 60, width: 4, height: 68, color: BLUE });
    wrap(sanitize(grade.instructor_paragraph || 'No feedback generated.'), { x: M + 12, size: 11, f: italic, color: rgb(0.1,0.1,0.3), maxW: CW - 12 });
    y -= 8; rule();

    // Comments per section
    for (const [key, label] of Object.entries({ annotated_product:'Annotated Product', narrative:'Narrative', context:'Context', overall_quality:'Overall Quality' })) {
      const comments = grade.comments?.[key] || [];
      if (!comments.length) continue;
      chk(30);
      const secVal = parseFloat(s[key]) || 0;
      const secMax = { annotated_product:2, narrative:2, context:1, overall_quality:1 }[key] || 1;
      page.drawText(label.toUpperCase(), { x: M, y, size: 9, font: bold, color: GRAY });
      page.drawText(`${secVal}/${secMax}`, { x: W-M-25, y, size: 10, font: bold, color: secVal/secMax >= 0.85 ? GREEN : secVal/secMax >= 0.6 ? AMBER : RED });
      y -= LH;
      page.drawLine({ start:{x:M,y}, end:{x:W-M,y}, thickness:0.3, color:rgb(0.8,0.8,0.8) }); y -= 6;

      for (const c of comments) {
        const isPos = c.type === 'positive';
        const boxBg = isPos ? rgb(0.92,1,0.92) : rgb(1,0.94,0.94);
        const boxBorder = isPos ? GREEN : RED;
        const approxH = Math.max(20, Math.ceil((sanitize(c.text||'').length * 6) / (CW-20)) + 14);
        chk(approxH + 16);
        page.drawRectangle({ x:M, y:y-approxH+LH, width:CW, height:approxH, color:boxBg });
        page.drawRectangle({ x:M, y:y-approxH+LH, width:3, height:approxH, color:boxBorder });
        wrap((isPos ? '+ ' : 'X ') + sanitize(c.text || ''), { x:M+8, size:10, color:BLACK, maxW:CW-16 });
        if (c.rewrite && c.type !== 'positive') {
          wrap('>> ' + sanitize(c.rewrite.replace(/^Suggested rewrite:\s*/i,'')), { x:M+16, size:9, f:italic, color:BLUE, maxW:CW-16 });
        }
        y -= 4;
      }
      y -= 8;
    }

    // Resources
    if (grade.resources?.length) {
      chk(40); rule(BLUE);
      page.drawText('RECOMMENDED RESOURCES', { x:M, y, size:9, font:bold, color:BLUE }); y -= LH + 2;
      for (const r of grade.resources) {
        chk(36);
        page.drawRectangle({ x:M, y:y-28, width:CW, height:36, color:rgb(0.92,0.96,1) });
        page.drawText(sanitize(r.title || r.url), { x:M+8, y, size:11, font:bold, color:BLUE }); y -= LH;
        if (r.why) { page.drawText(sanitize(r.why), { x:M+8, y, size:9, font, color:GRAY }); y -= LH; }
        page.drawText(sanitize(r.url), { x:M+8, y, size:8, font, color:BLUE }); y -= LH + 8;
      }
    }

    // Always-On Learning
    const aoR = db.prepare('SELECT * FROM always_on WHERE grade_id=? AND status=? ORDER BY created_at DESC LIMIT 1').get(grade.id, 'approved');
    if (aoR) {
      y -= 8; chk(20);
      page.drawLine({ start:{x:M,y}, end:{x:W-M,y}, thickness:0.5, color:GREEN }); y -= 12;
      page.drawText('RECOMMENDED RESOURCES', { x:M, y, size:9, font:bold, color:GREEN }); y -= 14;
      if (aoR.feedback_sentences) { wrap(aoR.feedback_sentences, {size:10, color:BLACK}); y -= 6; }
      const aoLinks = (() => { try { const l = JSON.parse(aoR.links || '[]'); return Array.isArray(l) ? l.filter(x => x && x.url) : []; } catch(e) { return []; } })();
      if (aoLinks.length > 0) {
        const lk = aoLinks[0];
        chk(20);
        wrap((lk.title || lk.url), {size:10, color:BLUE, f:bold});
        if (lk.url && lk.url !== lk.title) wrap(lk.url, {size:9, color:BLUE});
      }
      y -= 6;
    }

    chk(20); rule();

    const pdfBytes = await doc.save();
    const safeName = sanitize(grade.studentName || 'unknown').replace(/\s+/g,'_').toLowerCase();
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_graded.pdf"`);
    res.send(Buffer.from(pdfBytes));
  } catch (e) {
    console.error('Redlined PDF error:', e);
    res.status(500).json({ error: e.message });
  }
});

