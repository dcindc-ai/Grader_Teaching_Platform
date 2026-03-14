const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { db, parseMaterial } = require('../db');

const router = express.Router();
const upload = multer({
  dest: './uploads/materials/',
  limits: { fileSize: 50 * 1024 * 1024 }
});

async function extractText(filePath, type) {
  try {
    if (type === 'pdf') {
      const pdfParse = require('pdf-parse');
      const data = await pdfParse(fs.readFileSync(filePath));
      return data.text?.slice(0, 50000) || '';
    }
    if (type === 'pptx' || type === 'docx') {
      const officeparser = require('officeparser');
      return await new Promise((resolve, reject) => {
        officeparser.parseOffice(filePath, (data, err) => {
          if (err) reject(err);
          else resolve((data || '').slice(0, 50000));
        });
      });
    }
    return '';
  } catch (e) {
    console.error(`Text extraction error (${type}):`, e.message);
    return '';
  }
}

async function extractFromUrl(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(10000)
    });
    const html = await res.text();
    // Strip HTML tags for basic text extraction
    const text = html
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50000);
    return text;
  } catch (e) {
    console.error('URL extraction error:', e.message);
    return '';
  }
}

function getFileType(filename) {
  const ext = path.extname(filename).toLowerCase().slice(1);
  if (ext === 'pdf') return 'pdf';
  if (['ppt', 'pptx'].includes(ext)) return 'pptx';
  if (['doc', 'docx'].includes(ext)) return 'docx';
  return 'other';
}

// GET materials for course
router.get('/', (req, res) => {
  const { courseId, assignmentId } = req.query;
  let query = "SELECT * FROM materials WHERE status='active'";
  const params = [];
  if (courseId) { query += ' AND course_id=?'; params.push(courseId); }
  if (assignmentId) { query += ' AND assignment_id=?'; params.push(assignmentId); }
  query += ' ORDER BY week_number ASC, uploaded_at DESC';
  res.json(db.prepare(query).all(...params).map(parseMaterial));
});

// POST upload file
router.post('/upload', upload.single('file'), async (req, res) => {
  const { courseId, name, weekNumber, assignmentId } = req.body;
  const file = req.file;
  if (!file || !courseId) return res.status(400).json({ error: 'File and courseId required' });

  const type = getFileType(file.originalname);
  const extractedText = await extractText(file.path, type);
  const id = uuidv4();

  // Archive previous versions of same name
  if (name) {
    db.prepare("UPDATE materials SET status='archived' WHERE course_id=? AND name=? AND status='active'")
      .run(courseId, name);
  }

  const version = db.prepare("SELECT MAX(version) as v FROM materials WHERE course_id=? AND name=?")
    .get(courseId, name || file.originalname)?.v || 0;

  db.prepare(`
    INSERT INTO materials (id,course_id,name,type,week_number,assignment_id,file_path,extracted_text,file_size,version)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `).run(
    id, courseId, name || file.originalname, type,
    weekNumber ? parseInt(weekNumber) : null,
    assignmentId || null,
    file.path, extractedText, file.size, version + 1
  );

  res.json(parseMaterial(db.prepare('SELECT * FROM materials WHERE id=?').get(id)));
});

// POST add link
router.post('/link', async (req, res) => {
  const { courseId, name, url, weekNumber, assignmentId } = req.body;
  if (!courseId || !url) return res.status(400).json({ error: 'courseId and url required' });

  const extractedText = await extractFromUrl(url);
  const id = uuidv4();

  db.prepare(`
    INSERT INTO materials (id,course_id,name,type,week_number,assignment_id,url,extracted_text,version)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, courseId, name || url, 'link',
    weekNumber ? parseInt(weekNumber) : null,
    assignmentId || null,
    url, extractedText, 1
  );

  res.json(parseMaterial(db.prepare('SELECT * FROM materials WHERE id=?').get(id)));
});

// DELETE (archive) material
router.delete('/:id', (req, res) => {
  db.prepare("UPDATE materials SET status='archived' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// GET extracted text preview
router.get('/:id/text', (req, res) => {
  const row = db.prepare('SELECT extracted_text, name FROM materials WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Not found' });
  res.json({ name: row.name, text: row.extracted_text || '', length: (row.extracted_text || '').length });
});

module.exports = router;
