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
    ? examples.map(e => `EXAMPLE — ${e.student_name} (${e.score}/${assignment.max_score}${e.quality==='weak'?' WEAK':' GOOD'}):\nNotes: ${e.notes}\n${e.content}`).join('\n\n---\n\n')
    : 'No calibration examples yet.';
  const matStr = materials.length
    ? `\nRELEVANT COURSE MATERIALS (what was taught this week):\n${materials.map(m=>`[${m.name}]:\n${(m.extracted_text||'').slice(0,2000)}`).join('\n\n')}`
    : '';

  return `You are an expert instructor grading ${assignment.name} for ${course.full_name} (${course.name}) at ${course.institution}.

ASSIGNMENT:
${assignment.description}

RUBRIC:
${assignment.rubric}

STRICTNESS (1=lenient, 5=strict): ${sliderStr}
${matStr}

GRADING PRINCIPLES:
1. BLUF REQUIRED: First sentence must lead with significance. Flag if buried.
2. LEGEND REQUIRED on annotated products. Missing = deduction.
3. SIGNIFICANCE must be STATED explicitly, never implied.
4. QUANTIFICATION: Flag vague terms. Demand estimates and numbers.
5. NO FIRST PERSON: Flag any "I," "we," "my."
6. OBSERVATION vs INFERENCE: Distinguish what is visible from what is inferred.
7. CONTEXT SOURCES: Wikipedia-only is insufficient.
8. REWRITE SUGGESTIONS: For every flagged narrative sentence, provide a concrete rewrite.
9. If course materials are provided above, note whether the student applied concepts from the lesson.

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
  const materials = db.prepare(`
    SELECT * FROM materials
    WHERE course_id=? AND status='active'
    AND (assignment_id=? OR assignment_id IS NULL)
    ORDER BY week_number ASC
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
