const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { db, parseGrade } = require('../db');
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
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: `You are ${course?.instructor_bio ? 'Dave Cook, ' + course.instructor_bio : 'an instructor'} giving personalized feedback to a student.

Write a 3-4 sentence feedback paragraph in your voice:
1. Start with the student's first name and a genuine, specific compliment about something they did well
2. Give 1-2 sentences of honest critical feedback with concrete suggestions
3. End with a forward-looking, encouraging close

Tone: warm, direct, like a real mentor — not generic praise. Sound like you know this student's work specifically.
Never use em dashes. Keep it under 80 words.`,
      const firstName = (grade.studentName || 'Student').split(' ')[0];
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
