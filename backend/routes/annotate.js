/**
 * annotate.js
 * POST /api/annotate/:gradeId
 *
 * 1. Load grade record + original submission file
 * 2. Normalize submission to PDF (if not already)
 * 3. Convert each PDF page to an image, send to Claude with rubric + grade scores
 * 4. Claude returns structured annotation JSON (page, x_pct, y_pct, color, text)
 * 5. PyMuPDF applies annotations to the PDF
 * 6. Annotated PDF saved to uploads/annotated/{gradeId}_annotated.pdf
 * 7. Returns download URL
 *
 * GET /api/annotate/:gradeId/download
 * Returns the stored annotated PDF (if it exists)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const Anthropic = require('@anthropic-ai/sdk');
const { db, parseGrade } = require('../db');

const execFileAsync = promisify(execFile);

// On Windows python3 may not exist — fall back to python
const PYTHON = (() => {
  const { execSync } = require('child_process');
  try { execSync('python3 --version', { stdio: 'ignore' }); return 'python3'; } catch(e) {}
  try { execSync('python --version', { stdio: 'ignore' }); return 'python'; } catch(e) {}
  return 'python3'; // fallback, will error with a clear message
})();
console.log('[annotate] Using Python command:', PYTHON);

const SCRIPTS_DIR = path.join(__dirname, '../scripts');
const UPLOADS_DIR = path.join(__dirname, '../uploads');
const ANNOTATED_DIR = path.join(UPLOADS_DIR, 'annotated');
const NORMALIZED_DIR = path.join(UPLOADS_DIR, 'normalized');

// Ensure directories exist
[ANNOTATED_DIR, NORMALIZED_DIR].forEach(d => {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
});

// ─── Normalize any format to PDF ─────────────────────────────────────────────

async function normalizeSubmission(inputPath, gradeId) {
  const ext = path.extname(inputPath).toLowerCase();
  const normalizedPath = path.join(NORMALIZED_DIR, `${gradeId}_normalized.pdf`);

  if (fs.existsSync(normalizedPath)) return normalizedPath; // already done

  await execFileAsync(PYTHON, [
    path.join(SCRIPTS_DIR, 'normalize_to_pdf.py'),
    inputPath,
    normalizedPath,
  ], { timeout: 60000 });

  if (!fs.existsSync(normalizedPath)) {
    throw new Error(`Normalization failed for ${path.basename(inputPath)}`);
  }
  return normalizedPath;
}

// ─── Convert PDF pages to base64 images for Claude ───────────────────────────

async function pdfPagesToBase64(pdfPath) {
  // Use PyMuPDF via a quick inline Python script
  const script = `
import fitz, base64, json, sys
doc = fitz.open(sys.argv[1])
pages = []
for i, page in enumerate(doc):
    mat = fitz.Matrix(2.0, 2.0)  # 2x zoom for clarity
    pix = page.get_pixmap(matrix=mat)
    b64 = base64.b64encode(pix.tobytes('png')).decode()
    pages.append({'page': i+1, 'b64': b64, 'w': pix.width, 'h': pix.height})
print(json.dumps(pages))
`;

  const tmpScript = path.join(NORMALIZED_DIR, `pages_${Date.now()}.py`);
  fs.writeFileSync(tmpScript, script);

  try {
    const { stdout } = await execFileAsync(PYTHON, [tmpScript, pdfPath], {
      maxBuffer: 50 * 1024 * 1024, // 50MB — pages can be large
      timeout: 60000,
    });
    return JSON.parse(stdout);
  } finally {
    try { fs.unlinkSync(tmpScript); } catch (e) {}
  }
}

// ─── Ask Claude to annotate ───────────────────────────────────────────────────

async function getAnnotationsFromClaude(pages, grade, assignment, course) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const gradeJson = JSON.stringify({
    scores: grade.scores,
    total: grade.total,
    maxScore: grade.maxScore,
    summary: grade.summary,
    key_strength: grade.key_strength,
    key_improvement: grade.key_improvement,
    comments: grade.comments,
  }, null, 2);

  const rubric = assignment?.rubric || 'No rubric available.';

  // Build content array: one image per page, then the grade context
  const content = [];

  for (const pg of pages) {
    content.push({
      type: 'text',
      text: `--- Page ${pg.page} ---`,
    });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: pg.b64 },
    });
  }

  content.push({
    type: 'text',
    text: `
You are reviewing a student submission for ${assignment?.name || 'an assignment'} in ${course?.full_name || 'a course'}.

RUBRIC:
${rubric}

GRADE ALREADY ASSIGNED (use this to anchor your annotations):
${gradeJson}

Your job: examine the page images above and decide WHERE to place feedback annotations on the PDF.
Place annotations that directly point to the relevant visual area.

Return ONLY valid JSON — no markdown, no explanation:
{
  "annotations": [
    {
      "page": 1,
      "x_pct": 0.05,
      "y_pct": 0.10,
      "color": "green",
      "style": "sticky",
      "text": "Strength: clear declarative opening that immediately establishes significance."
    }
  ]
}

RULES:
- page: 1-indexed page number
- x_pct: 0.0 to 1.0 (left to right). Place annotations near the content they reference. Use 0.03–0.08 for left-margin notes, or near the actual feature.
- y_pct: 0.0 to 1.0 (top to bottom). Match the vertical position of the content you are annotating.
- color: "red" (gap/deduction), "green" (strength), "orange" (suggestion), "blue" (score summary)
- style: "sticky" for inline comments, "box" for score summaries
- Place ONE blue "box" annotation on the last page summarizing the total score and key takeaway
- Place 3–8 sticky annotations spread across the pages pointing to specific visual elements
- Keep annotation text under 40 words. Direct and specific.
- Red/green colorblind issue (affects ~8% of males): flag if student used red+green without shape differentiation
- Avoid annotating the same spot twice. Spread y_pct values so annotations don't overlap.
`,
  });

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    messages: [{ role: 'user', content }],
  });

  const text = resp.content.find(b => b.type === 'text')?.text || '{}';
  const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
  return Array.isArray(parsed) ? parsed : (parsed.annotations || []);
}

// ─── Apply annotations via Python ────────────────────────────────────────────

async function applyAnnotations(normalizedPdfPath, annotations, outputPath) {
  const annJson = JSON.stringify(annotations);
  const tmpJson = path.join(ANNOTATED_DIR, `ann_${Date.now()}.json`);
  fs.writeFileSync(tmpJson, annJson);

  try {
    await execFileAsync(PYTHON, [
      path.join(SCRIPTS_DIR, 'annotate_pdf.py'),
      normalizedPdfPath,
      tmpJson,
      outputPath,
    ], { timeout: 60000 });
  } finally {
    try { fs.unlinkSync(tmpJson); } catch (e) {}
  }
}

// ─── Routes ──────────────────────────────────────────────────────────────────

// POST /api/annotate/:gradeId — generate and store annotated PDF
router.post('/:gradeId', async (req, res) => {
  const { gradeId } = req.params;
  try {

  const gradeRow = db.prepare('SELECT * FROM grades WHERE id=?').get(gradeId);
  if (!gradeRow) return res.status(404).json({ error: 'Grade not found' });

  const grade = parseGrade(gradeRow);
  const assignment = db.prepare('SELECT * FROM assignments WHERE id=?').get(gradeRow.assignment_id);
  const course = db.prepare('SELECT * FROM courses WHERE id=?').get(gradeRow.course_id);

  // Check for existing annotated file
  const annotatedPath = path.join(ANNOTATED_DIR, `${gradeId}_annotated.pdf`);
  const forceRegen = req.query.force === 'true';
  if (fs.existsSync(annotatedPath) && !forceRegen) {
    return res.json({ ok: true, url: `/api/annotate/${gradeId}/download`, cached: true });
  }

  // Find original submission file
  const originalFilePath = gradeRow.original_file_path;
  if (!originalFilePath || !fs.existsSync(originalFilePath)) {
    return res.status(400).json({
      error: 'Original submission file not found. This grade may have been created before file storage was added.',
    });
  }

  try {
    // Step 1: Normalize to PDF
    const normalizedPath = await normalizeSubmission(originalFilePath, gradeId);

    // Step 2: Convert pages to images for Claude
    const pages = await pdfPagesToBase64(normalizedPath);

    // Step 3: Get annotations from Claude
    const annotations = await getAnnotationsFromClaude(pages, grade, assignment, course);

    // Step 4: Apply annotations
    await applyAnnotations(normalizedPath, annotations, annotatedPath);

    if (!fs.existsSync(annotatedPath)) {
      return res.status(500).json({ error: 'Annotation failed — output file not created' });
    }

    // Store reference in DB
    db.prepare('UPDATE grades SET annotated_file_path=? WHERE id=?').run(annotatedPath, gradeId);

    res.json({ ok: true, url: `/api/annotate/${gradeId}/download`, cached: false });
  } catch (err) {
    console.error(`Annotate error [${gradeId}]:`, err.message);
    res.status(500).json({ error: err.message });
  }
  } catch(outerErr) {
    console.error(`[annotate] Unhandled error for ${gradeId}:`, outerErr.message);
    if (!res.headersSent) res.status(500).json({ error: outerErr.message });
  }
});

// GET /api/annotate/:gradeId/download — serve the annotated PDF
router.get('/:gradeId/download', (req, res) => {
  const { gradeId } = req.params;

  const annotatedPath = path.join(ANNOTATED_DIR, `${gradeId}_annotated.pdf`);
  if (!fs.existsSync(annotatedPath)) {
    return res.status(404).json({ error: 'Annotated PDF not yet generated. Run POST first.' });
  }

  const gradeRow = db.prepare('SELECT student_name, assignment_name FROM grades WHERE id=?').get(gradeId);
  const studentSlug = (gradeRow?.student_name || 'student').replace(/[^a-z0-9]/gi, '_').toLowerCase();
  const assignSlug  = (gradeRow?.assignment_name || 'assignment').replace(/[^a-z0-9]/gi, '_').toLowerCase();

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${studentSlug}_${assignSlug}_annotated.pdf"`);
  fs.createReadStream(annotatedPath).pipe(res);
});

// DELETE /api/annotate/:gradeId — remove stored annotated PDF (force regen on next request)
router.delete('/:gradeId', (req, res) => {
  const annotatedPath = path.join(ANNOTATED_DIR, `${req.params.gradeId}_annotated.pdf`);
  if (fs.existsSync(annotatedPath)) fs.unlinkSync(annotatedPath);
  db.prepare('UPDATE grades SET annotated_file_path=NULL WHERE id=?').run(req.params.gradeId);
  res.json({ ok: true });
});

module.exports = router;
