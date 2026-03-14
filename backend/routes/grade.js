const express = require('express');
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const { readJSON, writeJSON, uuid, now } = require('../data/helpers');

const router = express.Router();
const upload = multer({ dest: './uploads/', limits: { fileSize: 25 * 1024 * 1024 } });

const GRADES_PATH = './data/grades.json';
const EXAMPLES_PATH = './data/examples.json';

const DIMS = ['clarity','logic','structure','tone','style'];

function buildGradePrompt(assignment, course, sliders) {
  const examples = readJSON(EXAMPLES_PATH, []).filter(e => e.assignmentId === assignment.id);
  const sliderStr = DIMS.map(d => `${d}: ${(sliders||{})[d]||3}/5`).join(', ');
  const exStr = examples.length
    ? examples.map(e => `CALIBRATION EXAMPLE — ${e.studentName} (${e.score}/${assignment.maxScore||6}${e.quality==='weak'?' — WEAK EXAMPLE':' — GOOD EXAMPLE'}):\nInstructor notes: ${e.notes}\nStudent text:\n${e.content}`).join('\n\n---\n\n')
    : 'No calibration examples yet.';

  return `You are an expert instructor grading ${assignment.name} for ${course.fullName} (${course.name}) at ${course.institution}.

ASSIGNMENT:
${assignment.description}

RUBRIC:
${assignment.rubric}

STRICTNESS (1=lenient, 5=strict): ${sliderStr}

GRADING PRINCIPLES:
1. BLUF REQUIRED: First sentence must lead with significance. Model: "Imagery/analysis from [date] shows [what] at [where], indicating [so-what]." Flag if buried.
2. LEGEND REQUIRED on annotated products. Missing = deduction.
3. SIGNIFICANCE must be STATED explicitly, never implied.
4. QUANTIFICATION: Flag vague terms ("intense," "large," "significant"). Demand estimates.
5. NO FIRST PERSON: Flag any "I," "we," "my." Third person only.
6. OBSERVATION vs INFERENCE: Distinguish what is visible from what is inferred.
7. CONTEXT SOURCES: Wikipedia-only is insufficient. Flag it.
8. REWRITE SUGGESTIONS: For every flagged narrative sentence, provide a concrete rewrite.
9. COLORBLIND ACCESSIBILITY: Unexplained color choices in annotated products should be flagged.

STRICTNESS APPLICATION:
- Clarity ≥4: Flag any buried BLUF. Significance must be sentence 1 or 2.
- Logic ≥4: Flag every unsupported claim.
- Structure ≥4: Flag missing legend, neatline, missing W questions.
- Tone ≥4: Flag first-person, informal language, weak word choice.
- Style ≥4: Flag unexplained colors, missing north arrow, decorative-only annotations.

CALIBRATION EXAMPLES:
${exStr}

Return ONLY valid JSON, no markdown fences:
{
  "studentName": "from submission header or Unknown",
  "scores": {
    "annotated_product": 0.0,
    "narrative": 0.0,
    "context": 0.0,
    "overall_quality": 0.0,
    "total": 0.0
  },
  "comments": {
    "annotated_product": [{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":null}],
    "narrative": [{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":"Suggested rewrite: ..."}],
    "context": [{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":null}],
    "overall_quality": [{"type":"positive","text":"..."},{"type":"negative","text":"...","rewrite":null}]
  },
  "summary": "2-3 sentence overall assessment",
  "key_strength": "single most notable strength",
  "key_improvement": "single most important improvement"
}`;
}

async function gradeOne(filePath, assignment, course) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const base64 = fs.readFileSync(filePath).toString('base64');
  const sliders = course.sliders || {};

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: buildGradePrompt(assignment, course, sliders),
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
        { type: 'text', text: 'Grade this student submission. Return only the JSON.' }
      ]
    }]
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '{}';
  return JSON.parse(text.replace(/```json\n?|```/g, '').trim());
}

// POST /api/grade/batch
router.post('/batch', upload.array('files', 50), async (req, res) => {
  const { assignmentId, courseId } = req.body;
  const files = req.files;
  if (!files?.length) return res.status(400).json({ error: 'No files' });

  const assignments = readJSON('./data/assignments.json', []);
  const courses = readJSON('./data/courses.json', []);
  const assignment = assignments.find(a => a.id === assignmentId);
  const course = courses.find(c => c.id === courseId);
  if (!assignment || !course) return res.status(400).json({ error: 'Assignment or course not found' });

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const allGrades = readJSON(GRADES_PATH, []);

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const originalName = req.body[`name_${i}`] || file.originalname;
    res.write(`data: ${JSON.stringify({ type: 'progress', file: originalName, index: i, total: files.length, status: 'grading' })}\n\n`);

    try {
      const result = await gradeOne(file.path, assignment, course);
      const grade = {
        id: uuid(),
        courseId,
        assignmentId,
        assignmentName: assignment.name,
        fileName: originalName,
        studentName: result.studentName || 'Unknown',
        gradedAt: now(),
        total: result.scores?.total || 0,
        maxScore: assignment.maxScore || 6,
        scores: result.scores,
        comments: result.comments,
        summary: result.summary,
        key_strength: result.key_strength,
        key_improvement: result.key_improvement
      };
      allGrades.unshift(grade);
      writeJSON(GRADES_PATH, allGrades);
      res.write(`data: ${JSON.stringify({ type: 'result', file: originalName, index: i, total: files.length, grade, status: 'done' })}\n\n`);
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: 'error', file: originalName, index: i, total: files.length, error: err.message, status: 'error' })}\n\n`);
    }
    try { fs.unlinkSync(file.path); } catch (e) {}
  }

  res.write(`data: ${JSON.stringify({ type: 'complete', total: files.length })}\n\n`);
  res.end();
});

// GET /api/grade?courseId=&assignmentId=
router.get('/', (req, res) => {
  let grades = readJSON(GRADES_PATH, []);
  if (req.query.courseId) grades = grades.filter(g => g.courseId === req.query.courseId);
  if (req.query.assignmentId) grades = grades.filter(g => g.assignmentId === req.query.assignmentId);
  res.json(grades);
});

// DELETE /api/grade/:id
router.delete('/:id', (req, res) => {
  writeJSON(GRADES_PATH, readJSON(GRADES_PATH, []).filter(g => g.id !== req.params.id));
  res.json({ ok: true });
});

// GET /api/grade/download?courseId=&assignmentId=
router.get('/download', async (req, res) => {
  const archiver = require('archiver');
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  let grades = readJSON(GRADES_PATH, []);
  if (req.query.courseId) grades = grades.filter(g => g.courseId === req.query.courseId);
  if (req.query.assignmentId) grades = grades.filter(g => g.assignmentId === req.query.assignmentId);
  if (!grades.length) return res.status(404).json({ error: 'No grades found' });

  const label = req.query.assignmentId || req.query.courseId || 'all';
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="grades_${label}_${Date.now()}.zip"`);

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.pipe(res);

  // CSV
  const csvRows = ['Student,File,Course,Assignment,Total,Max,Annotated Product,Narrative,Context,Overall Quality,Graded At,Key Strength,Key Improvement'];
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
      const RED = rgb(0.8,0.1,0.1), GREEN = rgb(0.1,0.5,0.1), BLACK = rgb(0,0,0), GRAY = rgb(0.4,0.4,0.4), LIGHT = rgb(0.95,0.95,0.95), BLUE = rgb(0.1,0.3,0.7);
      const W=612, H=792, M=54, LH=16, CW=W-M*2;
      let page = doc.addPage([W,H]); let y = H-M;

      function np() { page=doc.addPage([W,H]); y=H-M; }
      function chk(n=40) { if(y<M+n) np(); }
      function wrap(text, opts={}) {
        const {x=M,size=10,color=BLACK,f=font,maxW=CW}=opts;
        const words=String(text||'').split(' '); let line='';
        for(const w of words){
          const t=line?line+' '+w:w;
          if(f.widthOfTextAtSize(t,size)>maxW&&line){chk();page.drawText(line,{x,y,size,font:f,color});y-=LH;line=w;}
          else line=t;
        }
        if(line){chk();page.drawText(line,{x,y,size,font:f,color});y-=LH;}
      }
      function rule(){chk(10);page.drawLine({start:{x:M,y},end:{x:W-M,y},thickness:0.5,color:GRAY});y-=8;}
      function sec(lbl){y-=6;chk(30);page.drawRectangle({x:M,y:y-4,width:CW,height:18,color:LIGHT});page.drawText(lbl.toUpperCase(),{x:M+4,y,size:9,font:bold,color:GRAY});y-=18;}

      page.drawText('Teaching Platform — Grade Feedback',{x:M,y,size:16,font:bold,color:BLACK});y-=24;
      page.drawText(`Student: ${grade.studentName||'Unknown'}`,{x:M,y,size:11,font:bold,color:BLACK});y-=16;
      page.drawText(`${grade.courseId?.toUpperCase()} · ${grade.assignmentName} · ${new Date(grade.gradedAt).toLocaleDateString()}`,{x:M,y,size:9,font,color:GRAY});y-=20;
      rule();

      const tc=parseFloat(grade.total)||0, mx=parseFloat(grade.maxScore)||6;
      const sc=tc/mx>=0.83?GREEN:tc/mx>=0.6?rgb(0.6,0.4,0):RED;
      page.drawText(`TOTAL: ${grade.total} / ${grade.maxScore}`,{x:M,y,size:16,font:bold,color:sc});y-=20;
      const s=grade.scores||{};
      [`Annotated Product: ${s.annotated_product}/2`,`Narrative: ${s.narrative}/2`,`Context: ${s.context}/1`,`Overall Quality: ${s.overall_quality}/1`]
        .forEach(p=>{page.drawText(p,{x:M,y,size:10,font,color:BLACK});y-=LH;});
      y-=8;

      if(grade.summary){sec('Overall Assessment');wrap(grade.summary,{f:italic,color:rgb(0.15,0.15,0.15)});y-=4;}
      if(grade.key_strength){y-=4;chk();page.drawText('+ '+grade.key_strength,{x:M,y,size:10,font,color:GREEN});y-=LH;}
      if(grade.key_improvement){chk();page.drawText('→ '+grade.key_improvement,{x:M,y,size:10,font,color:RED});y-=LH;}

      const secs=[['annotated_product','Annotated Product'],['narrative','Narrative'],['context','Context'],['overall_quality','Overall Quality']];
      for(const[key,label] of secs){
        const comments=grade.comments?.[key]||[];
        if(!comments.length) continue;
        sec(label);
        for(const c of comments){
          const col=c.type==='positive'?GREEN:RED;
          wrap((c.type==='positive'?'+ ':'✗ ')+c.text,{size:10,color:col});
          if(c.rewrite){y-=2;wrap(c.rewrite.replace(/^Suggested rewrite:\s*/i,'↳ '),{x:M+12,size:9,color:BLUE,f:italic,maxW:CW-12});y-=4;}
        }
      }
      y-=8;rule();
      page.drawText('Generated by Teaching Platform',{x:M,y,size:8,font,color:GRAY});

      const bytes=await doc.save();
      const safe=(grade.studentName||'unknown').replace(/[^a-z0-9_]/gi,'_').toLowerCase();
      archive.append(Buffer.from(bytes),{name:`feedback/${safe}_feedback.pdf`});
    } catch(e){ console.error('PDF error',e.message); }
  }

  archive.finalize();
});

module.exports = router;
