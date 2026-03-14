const express = require('express');
const multer = require('multer');
const fs = require('fs');
const Anthropic = require('@anthropic-ai/sdk');
const router = express.Router();

const upload = multer({ dest: './uploads/', limits: { fileSize: 25 * 1024 * 1024 } });

// POST /api/label/parse — extract student name and comments from a content summary PDF
router.post('/parse', upload.single('file'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'No file' });

  try {
    const base64 = fs.readFileSync(file.path).toString('base64');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1500,
      messages: [{
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: `This is a student lab submission or a Canvas "Summary of Comments" export from a graded student lab.

Extract the following and return ONLY valid JSON, no markdown fences:
{
  "studentName": "student last name or full name found in the document header or filename",
  "comments": "all instructor comments found in this document, formatted as a readable list. Include the comment text and any page/location info. If this is a Summary of Comments export, list each numbered comment on its own line.",
  "pageCount": 2
}

If you cannot find a student name, use "Unknown".
If there are no comments, return an empty string for comments.` }
        ]
      }]
    });

    try { fs.unlinkSync(file.path); } catch (e) {}

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const parsed = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
    res.json(parsed);
  } catch (e) {
    try { fs.unlinkSync(file.path); } catch (_) {}
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
