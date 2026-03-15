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
          { type: 'text', text: `This document contains a student GEOG/intelligence lab submission. It typically has two parts:
1. The student's annotated map or imagery product (page 1) — a visual product with annotations, symbols, labels
2. A Summary of Comments from the instructor (later pages) — numbered comments the instructor left

Extract ALL of the following and return ONLY valid JSON, no markdown fences:
{
  "studentName": "student last name or full name found in the document or filename",
  "comments": "all instructor comments verbatim, one per line with comment number. e.g. '1. Nice context map.\n2. Would recommend an arrow.'",
  "visualDescription": "detailed description of what you see in the annotated product image. Specifically note: (1) is there a legend box? what does it explain? (2) what colors and symbols are used — are they colorblind accessible? (3) is there a north arrow or direction indicator? (4) is there a neatline/border? (5) what are the floating labels or annotations on the image? (6) what is the main subject of the image? (7) are there any context maps or inset maps? Be specific and concrete.",
  "rubricObservations": {
    "hasLegend": true or false,
    "hasNorthArrow": true or false,
    "hasNeatline": true or false,
    "colorblindConcerns": "describe any red/green or problematic color combinations",
    "blufPresent": "does the narrative start with a significance statement or does it bury the lead",
    "quantification": "does the student use specific numbers and measurements or vague language",
    "firstPersonUsed": true or false,
    "citationQuality": "describe the sources cited"
  },
  "pageCount": 2
}

If you cannot find a student name, use "Unknown".
If there is no visual product, leave visualDescription as empty string.` }
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
