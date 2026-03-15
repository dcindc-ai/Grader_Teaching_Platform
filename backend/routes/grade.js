const express = require('express');
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { db, parseGrade, firstName } = require('../db');

const router = express.Router();
const upload = multer({ dest: './uploads/', limits: { fileSize: 25 * 1024 * 1024 } });

const DIMS = ['clarity','logic','structure','tone','style'];

// ─── Build grading system prompt ─────────────────────────────────────────

function buildGradePrompt(assignment, course, examples, materials) {
  const sliders = JSON.parse(course.sliders || '{}');
  const sliderStr = DIMS.map(d => `${d}: ${sliders[d]||3}/5`).join(', ');
  const exStr = examples.length
    ? examples.map(e => `EXAMPLE — ${e.student_name} (${e.score}/${assignment.max_score}${e.quality==='weak'?' WEAK':' GOOD'}):\nNotes: ${e.notes || ''}\n${e.content || ''}`).join('\n\n---\n\n')
    : 'No calibration examples yet.';
  const matStr = materials.length
    ? `
LECTURE AND COURSE MATERIALS (what was taught this week/module):
${materials.map(m => `[${m.name}${m.week_number ? ' — Week ' + m.week_number : ''}]:
${(m.extracted_text||'').slice(0,2000)}`).join('\n\n')}

LECTURE CONCEPT EVALUATION RULES:
- Students are expected to apply concepts from these lectures in their work
- Do NOT penalize students for not parroting lecture language verbatim
- DO evaluate whether the student demonstrates understanding of the concepts taught
- If a student misses a key concept covered in the lecture that is directly relevant to what they are analyzing, note it as a gap
- If a student correctly applies a lecture concept without explicitly citing it, that is positive
- Example: if the lecture covered how to distinguish observation from inference, and the student conflates the two, that is a deduction
- Flag: "Concept from [material name] not applied: [specific concept]"
`
    : '';

  return `You are an expert instructor grading ${assignment.name} for ${course.full_name} (${course.name}) at ${course.institution}.

ASSIGNMENT:
${assignment.description}

RUBRIC:
${assignment.rubric}

STRICTNESS (1=lenient, 5=strict): ${sliderStr}
${matStr}

GRADING PHILOSOPHY (how this instructor actually grades):

WHAT A 6 LOOKS LIKE:
- Opens with a clear, declarative significance statement — the reader immediately knows what they are looking at and why it matters
- Annotated product contains all core elements: legend, north arrow, preferably a neatline
- Student does not just label objects — they explain what each labeled object tells them and how they drew that conclusion
- Provides a representative example or snapshot that drives clarity and supports a decision
- The work reads like it was made for a decision-maker, not a checklist

WHAT A 5 LOOKS LIKE:
- Draws enough conclusions to provide a window into significance but lacks ultimate clarity
- Makes the right points but does not fully close the loop on what a reader should do or think
- Midway between going through the motions and genuine analytical insight

WHAT A 4 LOOKS LIKE:
- Goes through the motions — labels objects, counts them, lists facts
- "There are 10 helicopters" with no follow-through on why that matters
- Does not answer the core question: why should I care about this?
- No synthesis, no decision-relevant conclusion, just inventory
- Bare minimum compliance with the assignment requirements

WHAT A 3 LOOKS LIKE:
- Fails to follow directions or omits basic required elements
- Makes no distinction between what matters and what does not
- Injects personal opinion that is not qualified, demonstrated, or grounded in evidence
- Shows no analytical judgment — wings it
- Ignores principles taught in course lectures
- Cannot articulate the problem being analyzed

THE CORE QUESTION every submission must answer: Why should I care? What am I looking at and why does it matter?

AUTOMATIC DEDUCTIONS (apply regardless of other quality):
- Missing legend on annotated product: -0.5 pts minimum
- Missing north arrow or direction indicator: -0.5 pts
- Spelling errors: -0.5 pts per instance
- Poor grammar that impedes clarity: -0.5 pts
- Conclusions drawn without supporting evidence from the imagery: -0.5 pts per instance
- First person language (I, we, my): flag and deduct

NEVER ACCEPTABLE (these indicate the student does not understand GEOINT):
- Over-the-top language or conclusions not supported by visible evidence
- Taking massive liberties with what is actually in the image
- Stating facts without analytical judgment (listing vs. envisioning)
- Inability to articulate the problem being analyzed
- Confusing observation (what is visible) with inference (what it means) without labeling which is which

GEOINT STANDARD: The student must demonstrate both empirical discipline (what the evidence shows) and logical argumentation (what conclusions follow). Both are required. Neither alone is sufficient.

LINKAGE TO COURSE CONCEPTS: If course materials are provided above, evaluate whether the student applied concepts from the lectures. Students are expected to connect what they see to frameworks taught in class.

COLORBLIND ACCESSIBILITY: Red/green color combinations affect ~8% of males. Flag if used. Recommend blue/yellow or shape differentiation instead.

REWRITE SUGGESTIONS: For every flagged narrative sentence, provide a concrete rewrite showing what the sentence should say.

CALIBRATION EXAMPLES:
${exStr}

Return ONLY valid JSON, no markdown fences:
{
  "studentName": "from header or Unknown",
  "scores": {"annotated_product":0,"narrative":0,"context":0,"overall_quality":0,"total":0},
  "comments": {
    "annotated_product":[{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":null}],
    "narrative":[{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":"Suggested rewrite: ..."}],
    "context":[{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":null}],
    "overall_quality":[{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":null}]
  },
  "summary":"2-3 sentence overall assessment",
  "key_strength":"single most notable strength",
  "key_improvement":"single most important area to improve",
  "weak_areas":["list","of","specific","weak","areas","for","always-on","targeting"],
  "instructor_paragraph":"A personalized 3-4 sentence paragraph in the instructor's voice. Use ONLY the student's FIRST NAME. Lead with genuine encouragement about something specific they did well. Give honest critical feedback with concrete suggestions. End with a forward-looking note. Warm and direct.
- No sentence may exceed 18 words. Break long sentences into two.
- Avoid colons, semicolons, and em dashes. Use periods instead.
- Write in plain, direct prose."
}`;
}

// ─── Generate Always-On recommendations ──────────────────────────────────

async function generateAlwaysOn(client, grade, course, assignment) {
  const weakAreas = grade.weak_areas || [];
  if (!weakAreas.length && !grade.key_improvement) return null;

  const targetArea = weakAreas[0] || grade.key_improvement;
  const courseContext = `${course.full_name} at ${course.institution}`;

  // Web search for current resources
  let searchResults = [];
  try {
    const searchResp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{
        role: 'user',
        content: `Search for 2-3 recent, high-quality articles or resources about "${targetArea}" relevant to a graduate student studying ${courseContext}. Find current examples, recent developments, or practical resources published in the last 12 months if possible. Return the URLs and brief descriptions.`
      }]
    });

    const textBlock = searchResp.content.find(b => b.type === 'text');
    if (textBlock) searchResults = textBlock.text;
  } catch (e) {
    console.error('Always-On search error:', e.message);
    searchResults = 'Web search unavailable.';
  }

  // Generate feedback sentences and extract links
  const feedbackResp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 600,
    system: `You are generating Always-On learning recommendations for a graduate student. Be specific, constructive, and forward-looking. Sound like a helpful mentor, not a critic.`,
    messages: [{
      role: 'user',
      content: `Student: ${grade.studentName}
Course: ${courseContext}
Assignment: ${assignment.name}
Key area to improve: ${targetArea}
Key improvement note: ${grade.key_improvement}
Search results: ${JSON.stringify(searchResults).slice(0, 2000)}

Generate:
1. Two sentences of constructive, forward-looking feedback specifically about "${targetArea}" - what should the student focus on, think about, or practice next?
2. Extract 2-3 actual URLs from the search results above that are genuinely useful. If no good URLs were found, suggest searching for specific terms instead.

Return ONLY valid JSON, no fences:
{
  "feedbackSentences": "Two sentences of constructive forward-looking feedback.",
  "links": [
    {"url": "https://...", "title": "Article title", "why": "One sentence on why this is relevant"},
    {"url": "https://...", "title": "Article title", "why": "One sentence on why this is relevant"}
  ]
}`
    }]
  });

  try {
    const text = feedbackResp.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
    return {
      weakArea: targetArea,
      feedbackSentences: parsed.feedbackSentences || '',
      links: parsed.links || []
    };
  } catch (e) {
    return { weakArea: targetArea, feedbackSentences: grade.key_improvement || '', links: [] };
  }
}

// ─── Grade a single submission ────────────────────────────────────────────

async function gradeOne(filePath, assignment, course) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const base64 = fs.readFileSync(filePath).toString('base64');

  const examples = db.prepare('SELECT * FROM examples WHERE assignment_id=?').all(assignment.id);
  // Pull lecture materials first, then other materials
  // Lecture = directly assessed. Reference/example = context only.
  const materials = db.prepare(`
    SELECT * FROM materials
    WHERE course_id=? AND status='active'
    AND (assignment_id=? OR assignment_id IS NULL)
    ORDER BY
      CASE WHEN material_type='lecture' THEN 0 ELSE 1 END,
      week_number ASC
    LIMIT 5
  `).all(course.id, assignment.id);

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: buildGradePrompt(assignment, course, examples, materials),
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Grade this student submission. Return only the JSON.' }
      ]
    }]
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '{}';
  const gradeResult = JSON.parse(text.replace(/```json\n?|```/g, '').trim());

  // Generate Always-On in parallel
  let alwaysOn = null;
  try {
    alwaysOn = await generateAlwaysOn(client, gradeResult, course, assignment);
  } catch (e) {
    console.error('Always-On generation error:', e.message);
  }

  return { gradeResult, alwaysOn };
}

// ─── Routes ───────────────────────────────────────────────────────────────

router.post('/batch', upload.array('files', 50), async (req, res) => {
  const { assignmentId, courseId } = req.body;
  const files = req.files;
  if (!files?.length) return res.status(400).json({ error: 'No files' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(courseId);
  if (!assignment || !course) return res.status(400).json({ error: 'Assignment or course not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const insertGrade = db.prepare(`
    INSERT INTO grades (id,course_id,assignment_id,student_name,assignment_name,file_name,total,max_score,scores,comments,summary,key_strength,key_improvement,instructor_paragraph)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  const insertAO = db.prepare(`
    INSERT INTO always_on (id,grade_id,student_name,course_id,assignment_id,assignment_name,weak_area,feedback_sentences,links)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const originalName = req.body[`name_${i}`] || file.originalname;
    res.write(`data: ${JSON.stringify({ type:'progress', file:originalName, index:i, total:files.length, status:'grading' })}\n\n`);

    try {
      const { gradeResult, alwaysOn } = await gradeOne(file.path, assignment, course);
      const gradeId = uuidv4();

      insertGrade.run(
        gradeId, courseId, assignmentId,
        gradeResult.studentName || 'Unknown', assignment.name, originalName,
        gradeResult.scores?.total || 0, assignment.max_score,
        JSON.stringify(gradeResult.scores || {}),
        JSON.stringify(gradeResult.comments || {}),
        gradeResult.summary || '', gradeResult.key_strength || '', gradeResult.key_improvement || '',
        gradeResult.instructor_paragraph || ''
      );

      if (alwaysOn) {
        insertAO.run(
          uuidv4(), gradeId, gradeResult.studentName || 'Unknown',
          courseId, assignmentId, assignment.name,
          alwaysOn.weakArea, alwaysOn.feedbackSentences,
          JSON.stringify(alwaysOn.links || [])
        );
      }

      const grade = parseGrade(db.prepare('SELECT * FROM grades WHERE id=?').get(gradeId));
      res.write(`data: ${JSON.stringify({ type:'result', file:originalName, index:i, total:files.length, grade, hasAlwaysOn:!!alwaysOn, status:'done' })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type:'error', file:originalName, index:i, total:files.length, error:err.message, status:'error' })}\n\n`);
    }
    try { fs.unlinkSync(file.path); } catch (e) {}
  }

  res.write(`data: ${JSON.stringify({ type:'complete', total:files.length })}\n\n`);
  res.end();
});

router.get('/', (req, res) => {
  const { courseId, assignmentId } = req.query;
  let query = 'SELECT * FROM grades WHERE 1=1';
  const params = [];
  if (courseId) { query += ' AND course_id=?'; params.push(courseId); }
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }
  query += ' ORDER BY graded_at DESC';
  res.json(db.prepare(query).all(...params).map(parseGrade));
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM grades WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

router.delete('/', (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (assignmentId) db.prepare('DELETE FROM grades WHERE assignment_id=?').run(assignmentId);
  else if (courseId) db.prepare('DELETE FROM grades WHERE course_id=?').run(courseId);
  res.json({ ok: true });
});

// Download ZIP
router.get('/download', async (req, res) => {
  const archiver = require('archiver');
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
  const { courseId, assignmentId } = req.query;

  let query = 'SELECT * FROM grades WHERE 1=1';
  const params = [];
  if (courseId) { query += ' AND course_id=?'; params.push(courseId); }
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }
  const grades = db.prepare(query).all(...params).map(parseGrade);
  if (!grades.length) return res.status(404).json({ error: 'No grades found' });

  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="grades_${assignmentId||courseId||'all'}_${Date.now()}.zip"`);
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  // CSV
  const csvRows = ['Student,File,Course,Assignment,Total,Max,Ann.Product,Narrative,Context,Quality,Graded,Strength,Improvement'];
  for (const g of grades) {
    const s = g.scores || {};
    csvRows.push([g.studentName,g.fileName,g.courseId,g.assignmentName,g.total,g.maxScore,
      s.annotated_product,s.narrative,s.context,s.overall_quality,g.gradedAt,
      g.key_strength||'',g.key_improvement||''].map(v=>`"${String(v||'').replace(/"/g,'""')}"`).join(','));
  }
  archive.append(csvRows.join('\n'), { name: 'grades.csv' });

  // Feedback PDFs
  for (const grade of grades) {
    try {
      const doc = await PDFDocument.create();
      const font = await doc.embedFont(StandardFonts.Helvetica);
      const bold = await doc.embedFont(StandardFonts.HelveticaBold);
      const italic = await doc.embedFont(StandardFonts.HelveticaOblique);
      const RED=rgb(0.8,0.1,0.1),GREEN=rgb(0.1,0.5,0.1),BLACK=rgb(0,0,0),GRAY=rgb(0.4,0.4,0.4),LIGHT=rgb(0.95,0.95,0.95),BLUE=rgb(0.1,0.3,0.7);
      const W=612,H=792,M=54,LH=16,CW=W-M*2;
      let page=doc.addPage([W,H]);let y=H-M;
      function np(){page=doc.addPage([W,H]);y=H-M;}
      function chk(n=40){if(y<M+n)np();}
      function wrap(text,opts={}){
        const{x=M,size=10,color=BLACK,f=font,maxW=CW}=opts;
        const words=String(text||'').split(' ');let line='';
        for(const w of words){const t=line?line+' '+w:w;if(f.widthOfTextAtSize(t,size)>maxW&&line){chk();page.drawText(line,{x,y,size,font:f,color});y-=LH;line=w;}else line=t;}
        if(line){chk();page.drawText(line,{x,y,size,font:f,color});y-=LH;}
      }
      function rule(){chk(10);page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:0.5,color:GRAY});y-=8;}
      function sec(lbl){y-=6;chk(30);page.drawRectangle({x:M,y:y-4,width:CW,height:18,color:LIGHT});page.drawText(lbl.toUpperCase(),{x:M+4,y,size:9,font:bold,color:GRAY});y-=18;}

      page.drawText('Teaching Platform — Grade Feedback',{x:M,y,size:16,font:bold,color:BLACK});y-=24;
      page.drawText(`Student: ${grade.studentName||'Unknown'}`,{x:M,y,size:11,font:bold,color:BLACK});y-=16;
      page.drawText(`${grade.courseId?.toUpperCase()} · ${grade.assignmentName} · ${new Date(grade.gradedAt).toLocaleDateString()}`,{x:M,y,size:9,font,color:GRAY});y-=20;
      rule();

      const tc=parseFloat(grade.total)||0,mx=parseFloat(grade.maxScore)||6;
      const sc=tc/mx>=0.83?GREEN:tc/mx>=0.6?rgb(0.6,0.4,0):RED;
      page.drawText(`TOTAL: ${grade.total} / ${grade.maxScore}`,{x:M,y,size:16,font:bold,color:sc});y-=20;
      const s=grade.scores||{};
      [`Annotated Product: ${s.annotated_product}/2`,`Narrative: ${s.narrative}/2`,`Context: ${s.context}/1`,`Overall Quality: ${s.overall_quality}/1`]
        .forEach(p=>{page.drawText(p,{x:M,y,size:10,font,color:BLACK});y-=LH;});y-=8;

      if(grade.summary){sec('Overall Assessment');wrap(grade.summary,{f:italic,color:rgb(0.15,0.15,0.15)});y-=4;}
      if(grade.key_strength){y-=4;chk();page.drawText('+ '+grade.key_strength,{x:M,y,size:10,font,color:GREEN});y-=LH;}
      if(grade.key_improvement){chk();page.drawText('→ '+grade.key_improvement,{x:M,y,size:10,font,color:RED});y-=LH;}

      const secs=[['annotated_product','Annotated Product'],['narrative','Narrative'],['context','Context'],['overall_quality','Overall Quality']];
      for(const[key,label]of secs){
        const comments=grade.comments?.[key]||[];
        if(!comments.length)continue;
        sec(label);
        for(const c of comments){
          const col=c.type==='positive'?GREEN:RED;
          wrap((c.type==='positive'?'+ ':'✗ ')+c.text,{size:10,color:col});
          if(c.rewrite){y-=2;wrap(c.rewrite.replace(/^Suggested rewrite:\s*/i,'↳ '),{x:M+12,size:9,color:BLUE,f:italic,maxW:CW-12});y-=4;}
        }
      }

      // Always-On section
      const ao = db.prepare('SELECT * FROM always_on WHERE grade_id=? AND status=?').get(grade.id, 'approved');
      if(ao){
        sec('Always-On Learning');
        wrap(ao.feedback_sentences,{size:10,color:BLACK});
        y-=6;
        const links=JSON.parse(ao.links||'[]');
        for(const lk of links){
          chk(32);
          wrap(`• ${lk.title||lk.url}`,{size:10,color:BLUE,f:bold});
          if(lk.why)wrap(`  ${lk.why}`,{size:9,color:GRAY});
          wrap(`  ${lk.url}`,{size:9,color:BLUE});
          y-=4;
        }
      }

      y-=8;rule();
      page.drawText('Generated by Teaching Platform',{x:M,y,size:8,font,color:GRAY});
      const bytes=await doc.save();
      const safe=(grade.studentName||'unknown').replace(/[^a-z0-9_]/gi,'_').toLowerCase();
      archive.append(Buffer.from(bytes),{name:`feedback/${safe}_feedback.pdf`});
    } catch(e){console.error('PDF error',e.message);}
  }
  archive.finalize();
});

module.exports = router;

// GET /api/grade/canvas-csv — export grades in Canvas gradebook import format
router.get('/canvas-csv', (req, res) => {
  const { courseId, assignmentId } = req.query;
  if (!courseId || !assignmentId) return res.status(400).json({ error: 'courseId and assignmentId required' });

  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  const students = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
  const grades = db.prepare('SELECT * FROM grades WHERE course_id=? AND assignment_id=?').all(courseId, assignmentId);

  const gradeMap = {};
  grades.forEach(g => {
    const key = (g.student_name || '').toLowerCase();
    gradeMap[key] = g.total;
  });

  const rows = ['Student,ID,SIS User ID,SIS Login ID,Section,' + (assignment?.name || 'Assignment')];

  if (students.length) {
    students.forEach(s => {
      const key = (s.name || '').toLowerCase();
      const score = gradeMap[key] ?? '';
      const parts = s.name.split(' ');
      const last = parts[parts.length - 1];
      const first = parts.slice(0, -1).join(' ') || s.name;
      rows.push(`"${last}, ${first}",${s.id},,${s.email || ''},,${score}`);
    });
  } else {
    grades.forEach(g => {
      rows.push(`"${g.student_name}",,,,, ${g.total}`);
    });
  }

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="canvas_grades_${assignment?.name?.replace(/\s+/g,'_') || 'export'}.csv"`);
  res.send(rows.join('\n'));
});

// PUT /api/grade/:id — update grade fields
router.put('/:id', (req, res) => {
  const { studentName, total, scores, comments, instructor_paragraph, key_strength, key_improvement, summary, resources } = req.body;
  db.prepare(`
    UPDATE grades SET
      student_name=?, total=?, scores=?, comments=?,
      instructor_paragraph=?, key_strength=?, key_improvement=?, summary=?, resources=?
    WHERE id=?
  `).run(
    studentName, total,
    JSON.stringify(scores || {}),
    JSON.stringify(comments || {}),
    instructor_paragraph || '', key_strength || '', key_improvement || '', summary || '',
    JSON.stringify(resources || []),
    req.params.id
  );
  res.json(parseGrade(db.prepare('SELECT * FROM grades WHERE id=?').get(req.params.id)));
});
