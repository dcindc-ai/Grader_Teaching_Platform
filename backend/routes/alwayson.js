const express = require('express');
const { db, parseAlwaysOn } = require('../db');
const router = express.Router();

// GET pending/all always-on items
router.get('/', (req, res) => {
  const { courseId, assignmentId, status } = req.query;
  let query = 'SELECT * FROM always_on WHERE 1=1';
  const params = [];
  if (courseId) { query += ' AND course_id=?'; params.push(courseId); }
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }
  if (status) { query += ' AND status=?'; params.push(status); }
  else { query += " AND status IN ('pending','approved')"; }
  query += ' ORDER BY created_at DESC';
  res.json(db.prepare(query).all(...params).map(parseAlwaysOn));
});

// GET counts by status for a course
router.get('/counts', (req, res) => {
  const { courseId } = req.query;
  const where = courseId ? 'WHERE course_id=?' : '';
  const params = courseId ? [courseId] : [];
  const pending = db.prepare(`SELECT COUNT(*) as n FROM always_on ${where} AND status='pending'`.replace('WHERE  AND', 'WHERE')).get(...params).n;
  const approved = db.prepare(`SELECT COUNT(*) as n FROM always_on ${where} AND status='approved'`.replace('WHERE  AND', 'WHERE')).get(...params).n;
  const rejected = db.prepare(`SELECT COUNT(*) as n FROM always_on ${where} AND status='rejected'`.replace('WHERE  AND', 'WHERE')).get(...params).n;
  res.json({ pending, approved, rejected });
});

// PUT update status (approve / reject / edit)
router.put('/:id', (req, res) => {
  const { status, feedbackSentences, links, reviewNotes } = req.body;
  db.prepare(`
    UPDATE always_on SET status=?, feedback_sentences=?, links=?, review_notes=?, reviewed_at=datetime('now')
    WHERE id=?
  `).run(
    status,
    feedbackSentences,
    JSON.stringify(links || []),
    reviewNotes || '',
    req.params.id
  );
  res.json(parseAlwaysOn(db.prepare('SELECT * FROM always_on WHERE id=?').get(req.params.id)));
});

// DELETE
router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM always_on WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// GET download approved always-on as ZIP of per-student PDFs
router.get('/download', async (req, res) => {
  const archiver = require('archiver');
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const { courseId, assignmentId } = req.query;

  let query = "SELECT * FROM always_on WHERE status='approved'";
  const params = [];
  if (courseId) { query += ' AND course_id=?'; params.push(courseId); }
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }

  const items = db.prepare(query).all(...params).map(parseAlwaysOn);
  if (!items.length) return res.status(404).json({ error: 'No approved items' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="always_on_${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  for (const item of items) {
    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
      const BLACK=rgb(0,0,0),GRAY=rgb(0.4,0.4,0.4),BLUE=rgb(0.1,0.3,0.7),LIGHT=rgb(0.95,0.95,0.95),ACCENT=rgb(0.2,0.5,0.9);
      const W=612,H=792,M=54,LH=17,CW=W-M*2;
      const page=doc.addPage([W,H]);let y=H-M;

      function wrap(text,opts={}){
        const{x=M,size=11,color=BLACK,f=font,maxW=CW}=opts;
        const words=String(text||'').split(' ');let line='';
        for(const w of words){const t=line?line+' '+w:w;if(f.widthOfTextAtSize(t,size)>maxW&&line){page.drawText(line,{x,y,size,font:f,color});y-=LH;line=w;}else line=t;}
        if(line){page.drawText(line,{x,y,size,font:f,color});y-=LH;}
      }

      // Header
      page.drawRectangle({x:0,y:H-80,width:W,height:80,color:ACCENT});
      page.drawText('Always-On Learning',{x:M,y:H-36,size:20,font:bold,color:rgb(1,1,1)});
      page.drawText(`${item.studentName} · ${item.assignmentName} · ${new Date(item.createdAt).toLocaleDateString()}`,{x:M,y:H-58,size:10,font,color:rgb(0.85,0.9,1)});
      y=H-100;

      // Focus area
      y-=8;
      page.drawRectangle({x:M,y:y-6,width:CW,height:20,color:LIGHT});
      page.drawText('FOCUS AREA',{x:M+4,y,size:9,font:bold,color:GRAY});
      y-=20;
      wrap(item.weakArea,{f:bold,size:13,color:BLACK});
      y-=8;

      // Feedback
      page.drawText('WHAT TO THINK ABOUT NEXT',{x:M,y,size:9,font:bold,color:GRAY});y-=16;
      wrap(item.feedbackSentences,{f:italic,size:11,color:rgb(0.15,0.15,0.15)});
      y-=16;

      // Links
      if(item.links?.length){
        page.drawText('RESOURCES TO EXPLORE',{x:M,y,size:9,font:bold,color:GRAY});y-=16;
        for(const lk of item.links){
          page.drawRectangle({x:M,y:y-10,width:CW,height:48,color:rgb(0.97,0.97,1)});
          page.drawText(lk.title||lk.url,{x:M+10,y,size:11,font:bold,color:BLUE});y-=15;
          if(lk.why) wrap(lk.why,{x:M+10,size:10,color:GRAY,maxW:CW-20});
          wrap(lk.url,{x:M+10,size:9,color:BLUE,maxW:CW-20});
          y-=14;
        }
      }

      y-=20;
      page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:0.5,color:GRAY});y-=12;
      page.drawText('Generated by Teaching Platform · Always-On Learning',{x:M,y,size:8,font,color:GRAY});

      const bytes=await doc.save();
      const safe=(item.studentName||'unknown').replace(/[^a-z0-9_]/gi,'_').toLowerCase();
      archive.append(Buffer.from(bytes),{name:`${safe}_always_on.pdf`});
    } catch(e){console.error('AO PDF error',e.message);}
  }
  archive.finalize();
});

module.exports = router;

// GET /api/alwayson/docx/:id — download single Always-On as Word doc
router.get('/docx/:id', async (req, res) => {
  const item = parseAlwaysOn(db.prepare('SELECT * FROM always_on WHERE id=?').get(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });

  try {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      BorderStyle, WidthType, ShadingType
    } = require('docx');

    const BLUE = '2563EB';
    const AMBER = 'D97706';
    const GRAY = '6B7280';
    const noBorders = {
      top: { style: BorderStyle.NONE, size: 0 },
      bottom: { style: BorderStyle.NONE, size: 0 },
      left: { style: BorderStyle.NONE, size: 0 },
      right: { style: BorderStyle.NONE, size: 0 }
    };

    const firstName = (item.studentName || 'Student').split(' ')[0];
    const children = [];

    // Header accent bar
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 24, color: BLUE, space: 1 } },
      spacing: { after: 0 },
      children: []
    }));

    children.push(new Paragraph({ spacing: { after: 80 } }));

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Always-On Learning', bold: true, size: 32, color: BLUE, font: 'Arial' })],
      spacing: { after: 60 }
    }));

    children.push(new Paragraph({
      children: [
        new TextRun({ text: `For: `, bold: true, size: 22, font: 'Arial' }),
        new TextRun({ text: firstName, size: 22, font: 'Arial' }),
        new TextRun({ text: `   |   `, size: 22, color: 'D1D5DB', font: 'Arial' }),
        new TextRun({ text: `Assignment: `, bold: true, size: 22, font: 'Arial' }),
        new TextRun({ text: item.assignmentName || '', size: 22, font: 'Arial' }),
      ],
      spacing: { after: 200 }
    }));

    // Focus area
    children.push(new Paragraph({
      children: [new TextRun({ text: 'FOCUS AREA', bold: true, size: 18, color: GRAY, font: 'Arial' })],
      spacing: { after: 80 }
    }));

    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 16, color: AMBER } },
          width: { size: 9360, type: WidthType.DXA },
          shading: { fill: 'FFFBEB', type: ShadingType.CLEAR },
          margins: { top: 100, bottom: 100, left: 160, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: item.weakArea || '', bold: true, size: 24, color: '92400E', font: 'Arial' })]
          })]
        })]
      })]
    }));

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Feedback
    children.push(new Paragraph({
      children: [new TextRun({ text: 'WHAT TO THINK ABOUT NEXT', bold: true, size: 18, color: GRAY, font: 'Arial' })],
      spacing: { after: 80 }
    }));

    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [9360],
      rows: [new TableRow({
        children: [new TableCell({
          borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 16, color: BLUE } },
          width: { size: 9360, type: WidthType.DXA },
          shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
          margins: { top: 120, bottom: 120, left: 160, right: 120 },
          children: [new Paragraph({
            children: [new TextRun({ text: item.feedbackSentences || '', size: 22, italics: true, color: '1E3A5F', font: 'Arial' })]
          })]
        })]
      })]
    }));

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Resources
    if (item.links?.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'RESOURCES TO EXPLORE', bold: true, size: 18, color: GRAY, font: 'Arial' })],
        spacing: { after: 100 }
      }));

      for (const lk of item.links) {
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA },
          columnWidths: [9360],
          rows: [new TableRow({
            children: [new TableCell({
              borders: { top: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' }, bottom: { style: BorderStyle.SINGLE, size: 1, color: 'E5E7EB' }, left: { style: BorderStyle.NONE, size: 0 }, right: { style: BorderStyle.NONE, size: 0 } },
              width: { size: 9360, type: WidthType.DXA },
              shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
              margins: { top: 100, bottom: 100, left: 120, right: 120 },
              children: [
                new Paragraph({ children: [new TextRun({ text: lk.title || lk.url, bold: true, size: 20, color: BLUE, font: 'Arial' })], spacing: { after: 40 } }),
                lk.why ? new Paragraph({ children: [new TextRun({ text: lk.why, size: 18, color: GRAY, font: 'Arial' })], spacing: { after: 40 } }) : null,
                new Paragraph({ children: [new TextRun({ text: lk.url, size: 16, color: '60A5FA', font: 'Arial' })] })
              ].filter(Boolean)
            })]
          })]
        }));
        children.push(new Paragraph({ spacing: { after: 80 } }));
      }
    }

    // Footer
    children.push(new Paragraph({ spacing: { after: 80 } }));
    children.push(new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB', space: 1 } },
      spacing: { before: 120 },
      children: [new TextRun({ text: 'Teaching Platform — Always-On Learning', size: 16, color: '9CA3AF', font: 'Arial' })]
    }));

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
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
    const safe = firstName.toLowerCase().replace(/[^a-z0-9]/g, '_');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}_always_on.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('Always-On DOCX error:', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/alwayson/docx/:id — Word doc for a single approved Always-On
router.get('/docx/:id', async (req, res) => {
  const item = parseAlwaysOn(db.prepare('SELECT * FROM always_on WHERE id=?').get(req.params.id));
  if (!item) return res.status(404).json({ error: 'Not found' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(item.courseId);
  const { firstName } = require('../db');

  try {
    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      BorderStyle, WidthType, ShadingType, AlignmentType
    } = require('docx');

    const BLUE = '2563EB'; const AMBER = 'D97706'; const GRAY = '6B7280';
    const noBorders = { top:{style:BorderStyle.NONE,size:0}, bottom:{style:BorderStyle.NONE,size:0}, left:{style:BorderStyle.NONE,size:0}, right:{style:BorderStyle.NONE,size:0} };

    const children = [];

    // Header bar
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Always-On Learning', bold: true, size: 32, color: BLUE, font: 'Arial' })],
      spacing: { after: 60 }
    }));
    children.push(new Paragraph({
      children: [
        new TextRun({ text: `${firstName(item.studentName)} · `, size: 22, font: 'Arial', color: GRAY }),
        new TextRun({ text: `${item.assignmentName} · `, size: 22, font: 'Arial', color: GRAY }),
        new TextRun({ text: new Date(item.createdAt).toLocaleDateString(), size: 22, font: 'Arial', color: GRAY })
      ],
      spacing: { after: 120 }
    }));
    children.push(new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 1 } },
      spacing: { after: 200 }
    }));

    // Focus area
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Focus Area', bold: true, size: 20, color: GRAY, font: 'Arial', allCaps: true })],
      spacing: { after: 80 }
    }));
    children.push(new Paragraph({
      children: [new TextRun({ text: item.weakArea || '', bold: true, size: 26, color: AMBER, font: 'Arial' })],
      spacing: { after: 200 }
    }));

    // Feedback
    children.push(new Paragraph({
      children: [new TextRun({ text: 'What to Think About Next', bold: true, size: 20, color: GRAY, font: 'Arial', allCaps: true })],
      spacing: { after: 80 }
    }));
    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
      rows: [new TableRow({ children: [new TableCell({
        borders: { ...noBorders, left: { style: BorderStyle.SINGLE, size: 12, color: BLUE, space: 0 } },
        width: { size: 9360, type: WidthType.DXA },
        shading: { fill: 'EFF6FF', type: ShadingType.CLEAR },
        margins: { top: 120, bottom: 120, left: 180, right: 120 },
        children: [new Paragraph({ children: [new TextRun({ text: item.feedbackSentences || '', size: 22, italics: true, color: '1E3A5F', font: 'Arial' })] })]
      })] })]
    }));
    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Resources
    if (item.links?.length) {
      children.push(new Paragraph({
        children: [new TextRun({ text: 'Resources to Explore', bold: true, size: 20, color: GRAY, font: 'Arial', allCaps: true })],
        spacing: { after: 100 }
      }));
      for (const lk of item.links) {
        children.push(new Table({
          width: { size: 9360, type: WidthType.DXA }, columnWidths: [9360],
          rows: [new TableRow({ children: [new TableCell({
            borders: { top:{style:BorderStyle.SINGLE,size:1,color:'E5E7EB'}, bottom:{style:BorderStyle.SINGLE,size:1,color:'E5E7EB'}, left:{style:BorderStyle.SINGLE,size:1,color:'E5E7EB'}, right:{style:BorderStyle.SINGLE,size:1,color:'E5E7EB'} },
            width: { size: 9360, type: WidthType.DXA },
            shading: { fill: 'F8FAFC', type: ShadingType.CLEAR },
            margins: { top: 100, bottom: 100, left: 140, right: 140 },
            children: [
              new Paragraph({ children: [new TextRun({ text: lk.title || lk.url, bold: true, size: 20, color: BLUE, font: 'Arial' })], spacing: { after: 40 } }),
              lk.why ? new Paragraph({ children: [new TextRun({ text: lk.why, size: 18, color: GRAY, font: 'Arial' })], spacing: { after: 40 } }) : new Paragraph({}),
              new Paragraph({ children: [new TextRun({ text: lk.url, size: 16, color: '9CA3AF', font: 'Arial' })] })
            ]
          })] })]
        }));
        children.push(new Paragraph({ spacing: { after: 80 } }));
      }
    }

    children.push(new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB', space: 1 } },
      spacing: { before: 240 },
      children: [new TextRun({ text: `${course?.name || ''} · Generated by Teaching Platform`, size: 16, color: '9CA3AF', font: 'Arial' })]
    }));

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Arial', size: 22 } } } },
      sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } } }, children }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safeName = firstName(item.studentName).toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}_always_on.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('AO docx error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/alwayson/class-summary — generate class-level summary
router.post('/class-summary', async (req, res) => {
  const { courseId, assignmentId } = req.body;
  if (!courseId) return res.status(400).json({ error: 'courseId required' });

  let query = "SELECT * FROM always_on WHERE status='approved' AND course_id=?";
  const params = [courseId];
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }

  const items = db.prepare(query).all(...params).map(parseAlwaysOn);
  if (!items.length) return res.status(400).json({ error: 'No approved Always-On items to summarize' });

  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  const { firstName } = require('../db');
  const Anthropic = require('@anthropic-ai/sdk');

  const itemSummary = items.map(i =>
    `${firstName(i.studentName)}: Focus area = ${i.weakArea}. Feedback = ${i.feedbackSentences}`
  ).join('\n');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `You are ${course?.name || 'an instructor'} summarizing patterns across student Always-On learning recommendations.`,
      messages: [{
        role: 'user',
        content: `Here are the individual student focus areas and feedback from this assignment:

${itemSummary}

Generate a class-level summary with:
1. A 2-3 sentence overview of the most common gaps across the class
2. Exactly 2-3 actionable recommendations for the whole class

Return ONLY valid JSON, no fences:
{
  "overview": "2-3 sentence summary of common patterns across the class",
  "recommendations": [
    "First class-wide recommendation — specific and actionable",
    "Second class-wide recommendation",
    "Third class-wide recommendation (optional)"
  ]
}`
      }]
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim());

    // Store class summary
    const { v4: uuidv4 } = require('uuid');
    db.prepare(`
      INSERT OR REPLACE INTO always_on (id, course_id, assignment_id, assignment_name, student_name, weak_area, feedback_sentences, links, status)
      VALUES (?, ?, ?, 'Class Summary', 'Class', 'class_summary', ?, '[]', 'approved')
    `).run(
      uuidv4(), courseId, assignmentId || null,
      JSON.stringify(parsed)
    );

    res.json(parsed);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
