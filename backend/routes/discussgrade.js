const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const { v4: uuidv4 } = require('uuid');
const { db } = require('../db');
const router = express.Router();

// ─── Parse Canvas rubric CSV ──────────────────────────────────────────────

router.post('/parse-rubric', (req, res) => {
  const { csv } = req.body;
  if (!csv) return res.status(400).json({ error: 'csv required' });

  try {
    const lines = csv.trim().split('\n');
    const criteria = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      // Parse CSV with quoted fields
      const fields = [];
      let field = '', inQuote = false;
      for (let c = 0; c < line.length; c++) {
        if (line[c] === '"') { inQuote = !inQuote; continue; }
        if (line[c] === ',' && !inQuote) { fields.push(field); field = ''; continue; }
        field += line[c];
      }
      fields.push(field);

      if (fields.length < 6) continue;
      const criteriaName = fields[1]?.trim();
      if (!criteriaName) continue;

      const ratings = [];
      // Ratings start at index 4, groups of 3 (name, description, points)
      for (let j = 4; j + 2 < fields.length; j += 3) {
        const name = fields[j]?.trim();
        const desc = fields[j + 1]?.trim();
        const pts = parseFloat(fields[j + 2]);
        if (name && !isNaN(pts)) ratings.push({ name, description: desc, points: pts });
      }

      if (ratings.length > 0) {
        criteria.push({
          id: uuidv4(),
          name: criteriaName,
          maxPoints: Math.max(...ratings.map(r => r.points)),
          ratings
        });
      }
    }

    const totalMax = criteria.reduce((a, c) => a + c.maxPoints, 0);
    res.json({ criteria, totalMax });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Grade a discussion submission against a rubric ───────────────────────

router.post('/grade', async (req, res) => {
  const { courseId, assignmentId, studentName, discussionQuestion, submission, rubricCriteria: clientRubric, instructorBio, tone, sentences, submissionType } = req.body;
  const sentenceCount = parseInt(sentences) || 3;
  const isSkillAssessment = submissionType === 'skill';

  if (!submission) {
    return res.status(400).json({ error: 'submission required' });
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Fetch assignment from DB — use stored rubric and guidance if available
  const assignmentRecord = assignmentId
    ? db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId)
    : null;
  const gradingGuidance = assignmentRecord?.grading_guidance || '';
  console.log('[discussgrade] assignmentId:', assignmentId);
  console.log('[discussgrade] assignment name:', assignmentRecord?.name || 'NOT FOUND');
  console.log('[discussgrade] grading_guidance:', gradingGuidance.slice(0, 100) || '(none)');
  console.log('[discussgrade] rubric_criteria stored:', !!assignmentRecord?.rubric_criteria);

  // Prefer stored rubricCriteria from DB over what client sent
  // BUT validate they match the assignment — reject stale criteria from other assignments
  let rubricCriteria = clientRubric;
  if (assignmentRecord?.rubric_criteria) {
    try {
      const stored = JSON.parse(assignmentRecord.rubric_criteria);
      if (Array.isArray(stored) && stored.length > 0) {
        // Validate: check stored criteria names match client rubric names
        // If they're completely different, the DB has stale data — use client rubric
        const storedNames = stored.map(c => (c.name || '').toLowerCase());
        const clientNames = (clientRubric || []).map(c => (c.name || '').toLowerCase());
        const overlap = storedNames.filter(n =>
          clientNames.some(cn => cn.includes(n.slice(0,15)) || n.includes(cn.slice(0,15)))
        );
        if (overlap.length >= Math.min(2, stored.length)) {
          rubricCriteria = stored;
          console.log('[discussgrade] Using stored criteria (validated match)');
        } else {
          console.log('[discussgrade] Stored criteria do not match Canvas rubric — using Canvas rubric');
          // Clear the stale stored criteria
          db.prepare('UPDATE assignments SET rubric_criteria=NULL WHERE id=?').run(assignmentId);
        }
      }
    } catch(e) {}
  }

  if (!rubricCriteria?.length) {
    return res.status(400).json({ error: 'No rubric criteria found. Add rubric criteria to the assignment in your app first.' });
  }

  const criteriaText = rubricCriteria.map((c, i) => `
Criterion ${i + 1}: ${c.name} (max ${c.maxPoints} pts)
Rating levels:
${c.ratings.map(r => `  - ${r.name} (${r.points} pts): ${r.description}`).join('\n')}`
  ).join('\n');

  // Load calibration examples for this assignment
  let exampleContext = '';
  if (assignmentId) {
    const examples = db.prepare('SELECT * FROM examples WHERE assignment_id=? ORDER BY created_at DESC LIMIT 5').all(assignmentId);
    if (examples.length) {
      exampleContext = '\n\nCALIBRATION EXAMPLES (previously graded by this instructor):\n' +
        examples.map(e => `Student: ${e.student_name}, Score: ${e.score}/${e.quality === 'good' ? 'strong' : 'weak'} example\n${(e.content || '').slice(0, 400)}`).join('\n---\n');
    }
  }

  const system = `You are ${instructorBio || 'an instructor'} grading a student discussion post.

CRITICAL: Grade ONLY against the ${rubricCriteria.length} criteria listed below. Do not reference any other rubric, assignment, or set of requirements. Do not penalize for anything not explicitly in these criteria.

The criteria for THIS assignment are:
${rubricCriteria.map((c,i) => `${i+1}. ${c.name}`).join('\n')}

Be fair, specific, and constructive. Grade based on what the student actually wrote.
Be direct — if something is missing say so clearly. Use the student's first name only.
${exampleContext ? 'Use the calibration examples to calibrate your scoring to this instructor\'s standards.' : ''}
${gradingGuidance ? `\nINSTRUCTOR EXCEPTIONS — DO NOT PENALIZE FOR THESE:\n${gradingGuidance}` : ''}`;

  const toneMap = {
    'plain-warm':    'Write in plain, conversational English. Be warm and encouraging but not stiff. Sound like a real person, not a form letter. Avoid academic or corporate language.',
    'plain':         'Write in plain, direct English. Short sentences. No filler words. Get to the point. Sound like a colleague giving honest feedback.',
    'encouraging':   'Be genuinely encouraging. Celebrate what they did well before addressing gaps. Use energy and enthusiasm. Make them want to do better.',
    'formal':        'Use professional, polished language appropriate for academic feedback.',
  };
  const toneInstructions = tone && !toneMap[tone]
    ? tone
    : (toneMap[tone] || toneMap['plain-warm']);

  // Skill assessment mode: deeper, more pointed per-criterion feedback
  const criterionCommentInstruction = isSkillAssessment
    ? \`2-4 sentences. ${toneInstructions} Be specific and direct — name the exact thing they did well or the exact gap. Reference something they actually wrote or did. Tell them what a stronger version would look like. Treat them like a capable adult who can handle real feedback.\`
    : \`1-2 sentences. ${toneInstructions} Be specific — reference something they actually wrote. Only include if score is not perfect.\`;

  // Skill assessment paragraph: deeper, more personal, like the instructor example
  const paragraphInstruction = isSkillAssessment
    ? \`${toneInstructions} Write ${sentenceCount} sentences. Start with first name. Lead with the most specific, impressive thing they did — not generic praise. Name the actual intellectual move they made. Compare it (briefly) to what most students do so they understand why it stands out. Be honest about gaps — name them directly and say what better looks like. End with something personal and forward-looking. Sound like a mentor who has read every word, not a grader running through a checklist. Max 20 words per sentence.\`
    : \`${toneInstructions} Start with the student's first name. ${sentenceCount} sentences total. Max 18 words per sentence. No jargon. Write it like you're talking to the student directly.\`;\`

  const prompt = `DISCUSSION QUESTION:
${discussionQuestion || 'No question provided'}

STUDENT: ${studentName}
SUBMISSION:
${submission}

RUBRIC CRITERIA:
${criteriaText}

Grade this submission. You MUST return a criteriaGrades entry for EVERY criterion below — no exceptions, including criteria where the student scores perfectly.

REQUIRED CRITERIA (you must include all ${rubricCriteria.length} in your response):
${rubricCriteria.map((c, i) => `${i+1}. ${c.name}`).join('\n')}

Return ONLY valid JSON, no markdown fences:
{
  "criteriaGrades": [
    {
      "criterionId": "criterion id here",
      "criterionName": "criterion name",
      "suggestedRating": "Accomplished | Proficient | Needs Improvement | Unacceptable",
      "suggestedPoints": 14.5,
      "scoringRationale": "2-3 sentences of instructor-only rationale in the style: 'Risk ID (14/15): The scenario is specific and... The deduction is because...'. Reference actual content from the post. Explain exactly why points were deducted if any. Be frank and specific. This is for your reference only.",
      "studentComment": "${criterionCommentInstruction}",
      "evidence": "brief quote or paraphrase from submission supporting this rating"
    }
  ],
  "totalPoints": 72.5,
  "totalMax": 75,
  "instructorParagraph": "${paragraphInstruction}",
  "overallSummary": "1-2 sentence overall assessment"
}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = resp.content.find(b => b.type === 'text')?.text || '{}';
    const result = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
    console.log(`[discussgrade] criteriaGrades returned: ${result.criteriaGrades?.length} items for ${rubricCriteria.length} criteria`);

    // Save to grades table if assignment provided
    if (assignmentId && courseId) {
      const gradeId = uuidv4();
      const scores = {};
      result.criteriaGrades?.forEach(cg => { scores[cg.criterionName] = cg.suggestedPoints; });

      try {
        db.prepare(`
          INSERT INTO grades (id,course_id,assignment_id,student_name,assignment_name,file_name,total,max_score,scores,comments,summary,key_strength,key_improvement,instructor_paragraph)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          gradeId, courseId, assignmentId, studentName || 'Unknown',
          'Discussion Grade', 'discussion', result.totalPoints || 0, result.totalMax || 75,
          JSON.stringify(scores), JSON.stringify(result.criteriaGrades || []),
          result.overallSummary || '', '', '', result.instructorParagraph || ''
        );

        // Match student record and set student_id
        if (studentName && studentName !== 'Unknown') {
          const students = db.prepare('SELECT * FROM students WHERE course_id=?').all(courseId);
          const nameLower = studentName.toLowerCase();
          const match = students.find(s => {
            const full = `${s.first_name} ${s.last_name}`.toLowerCase();
            const rev  = `${s.last_name} ${s.first_name}`.toLowerCase();
            return full === nameLower || rev === nameLower || (s.name || '').toLowerCase() === nameLower;
          }) || students.find(s => {
            const parts = nameLower.split(' ');
            const last = parts[parts.length - 1];
            const first = parts[0];
            return (s.last_name || '').toLowerCase() === last &&
                   (s.first_name || '').toLowerCase().startsWith(first[0]);
          });
          if (match) {
            db.prepare('UPDATE grades SET student_id=?, student_name=? WHERE id=?')
              .run(match.id, `${match.first_name} ${match.last_name}`.trim(), gradeId);
          }
        }

        result.gradeId = gradeId;
      } catch (e) {
        console.error('Grade save error:', e.message);
      }
    }

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

// POST /api/discussgrade/regenerate-feedback
router.post('/regenerate-feedback', async (req, res) => {
  const { studentName, overallSummary, criteriaGrades, rubricCriteria,
          tone, length, directness, instructorBio } = req.body;

  const toneDesc = {
    formal: 'formal, academic, professional',
    plain: 'plain, conversational, direct — like talking to the student in office hours',
    warm: 'warm, encouraging, mentor-like'
  }[tone] || 'warm, direct, mentor-like';

  const lengthDesc = {
    short: '2-3 sentences, tight and punchy',
    medium: '3-4 sentences, standard',
    long: '4-5 sentences, more detailed'
  }[length] || '3-4 sentences';

  const directnessDesc = {
    soft: 'gentle, softening critical feedback',
    balanced: 'balanced, honest but kind',
    direct: 'direct and frank, no sugar-coating'
  }[directness] || 'balanced';

  const summary = criteriaGrades?.map(cg =>
    `${cg.criterionName}: ${cg.suggestedRating || ''} (${cg.suggestedPoints || 0}pts) — ${cg.scoringRationale || cg.studentComment || ''}`
  ).join('\n');

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 400,
      system: `You are ${instructorBio || 'an instructor'} writing personalized feedback to a student.
Tone: ${toneDesc}
Length: ${lengthDesc}
Directness: ${directnessDesc}
Start with the student's first name.
Writing style rules (apply to all generated text):
- No sentence may exceed 18 words. Break long sentences into two.
- Avoid colons, semicolons, and em dashes. Use periods instead.
- Write in plain, direct prose.`,
      messages: [{
        role: 'user',
        content: `Student: ${studentName}
Overall: ${overallSummary || ''}
Criterion scores:
${summary}

Write the instructor feedback paragraph with the specified tone, length, and directness.
Return ONLY the paragraph text, nothing else.`
      }]
    });
    const paragraph = resp.content.find(b => b.type === 'text')?.text?.trim() || '';
    res.json({ paragraph });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/discussgrade/docx/:gradeId — download feedback as Word doc
router.get('/docx', async (req, res) => {
  const { studentName, courseName, assignmentName, date, criteria, feedback } = req.query;

  try {
    let gradeData;
    try {
      gradeData = JSON.parse(decodeURIComponent(req.query.data || '{}'));
    } catch (e) {
      return res.status(400).json({ error: 'Invalid data' });
    }

    const {
      Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
      AlignmentType, BorderStyle, WidthType, ShadingType, HeadingLevel
    } = require('docx');

    const border = { style: BorderStyle.SINGLE, size: 4, color: '999999' };
    const borders = { top: border, bottom: border, left: border, right: border };
    const headerBg = { fill: '1E3A5F', type: ShadingType.CLEAR };
    const altBg = { fill: 'F0F4F8', type: ShadingType.CLEAR };

    const children = [];

    // Title
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Discussion Grading Feedback', bold: true, size: 32, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 160 }
    }));

    // Course info
    [
      ['Course', gradeData.courseName || 'AIN 714 — AI Strategy and Innovation'],
      ['Assignment', gradeData.assignmentName || ''],
      ['Student', gradeData.studentName || ''],
      ['Date', gradeData.date || new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' })]
    ].forEach(([label, value]) => {
      children.push(new Paragraph({
        children: [
          new TextRun({ text: `${label}: `, bold: true, size: 22, font: 'Calibri' }),
          new TextRun({ text: value, size: 22, font: 'Calibri' })
        ],
        spacing: { after: 60 }
      }));
    });

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Section: Rubric Scores
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Rubric Scores', bold: true, size: 26, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 120 }
    }));

    // Rubric table
    const rubricRows = [
      // Header
      new TableRow({
        children: [
          new TableCell({
            borders, width: { size: 4500, type: WidthType.DXA },
            shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Criterion', bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
          }),
          new TableCell({
            borders, width: { size: 2500, type: WidthType.DXA },
            shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Rating', bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
          }),
          new TableCell({
            borders, width: { size: 2360, type: WidthType.DXA },
            shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: 'Score', bold: true, size: 20, font: 'Calibri', color: 'FFFFFF' })] })]
          })
        ]
      })
    ];

    const criteriaData = gradeData.criteriaGrades || [];
    let total = 0;
    let totalMax = 0;

    criteriaData.forEach((cg, i) => {
      const pts = parseFloat(cg.finalPoints || cg.suggestedPoints || 0);
      const maxPts = cg.maxPoints || 15;
      total += pts;
      totalMax += maxPts;
      const shading = i % 2 === 1 ? altBg : { fill: 'FFFFFF', type: ShadingType.CLEAR };

      rubricRows.push(new TableRow({
        children: [
          new TableCell({
            borders, width: { size: 4500, type: WidthType.DXA },
            shading, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: cg.criterionName || '', size: 20, font: 'Calibri' })] })]
          }),
          new TableCell({
            borders, width: { size: 2500, type: WidthType.DXA },
            shading, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: cg.suggestedRating || '', size: 20, font: 'Calibri' })] })]
          }),
          new TableCell({
            borders, width: { size: 2360, type: WidthType.DXA },
            shading, margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [new Paragraph({ children: [new TextRun({ text: `${pts}/${maxPts}`, bold: true, size: 20, font: 'Calibri' })] })]
          })
        ]
      }));
    });

    // Total row
    rubricRows.push(new TableRow({
      children: [
        new TableCell({
          borders, width: { size: 4500, type: WidthType.DXA },
          shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: 'TOTAL', bold: true, size: 22, font: 'Calibri', color: 'FFFFFF' })] })]
        }),
        new TableCell({
          borders, width: { size: 2500, type: WidthType.DXA },
          shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: '', size: 20, font: 'Calibri' })] })]
        }),
        new TableCell({
          borders, width: { size: 2360, type: WidthType.DXA },
          shading: headerBg, margins: { top: 80, bottom: 80, left: 120, right: 120 },
          children: [new Paragraph({ children: [new TextRun({ text: `${total.toFixed(0)}/${totalMax}`, bold: true, size: 22, font: 'Calibri', color: 'FFFFFF' })] })]
        })
      ]
    }));

    children.push(new Table({
      width: { size: 9360, type: WidthType.DXA },
      columnWidths: [4500, 2500, 2360],
      rows: rubricRows
    }));

    children.push(new Paragraph({ spacing: { after: 240 } }));

    // Section: Scoring Rationale
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Scoring Rationale (Instructor Reference)', bold: true, size: 26, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 120 }
    }));

    criteriaData.forEach(cg => {
      if (!cg.scoringRationale && !cg.studentComment) return;
      children.push(new Paragraph({
        children: [new TextRun({ text: `${cg.criterionName} (${cg.finalPoints || cg.suggestedPoints}/${cg.maxPoints || 15})`, bold: true, size: 22, font: 'Calibri' })],
        spacing: { before: 160, after: 60 }
      }));
      const rationale = cg.scoringRationale || cg.studentComment || '';
      children.push(new Paragraph({
        children: [new TextRun({ text: rationale, size: 20, font: 'Calibri' })],
        spacing: { after: 80 }
      }));
    });

    children.push(new Paragraph({ spacing: { after: 200 } }));

    // Section: Instructor Feedback
    children.push(new Paragraph({
      children: [new TextRun({ text: 'Instructor Feedback to Student', bold: true, size: 26, font: 'Calibri', color: '1E3A5F' })],
      spacing: { after: 120 }
    }));

    const feedbackText = gradeData.instructorParagraph || '';
    const sentences = feedbackText.split(/(?<=[.!?])\s+/).filter(Boolean);
    sentences.forEach(sentence => {
      children.push(new Paragraph({
        indent: { left: 720 },
        children: [new TextRun({ text: sentence, size: 22, font: 'Calibri', italics: true })],
        spacing: { after: 80 },
        border: { left: { style: BorderStyle.SINGLE, size: 12, color: '2563EB', space: 8 } }
      }));
    });

    const doc = new Document({
      styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
      sections: [{
        properties: {
          page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 } }
        },
        children
      }]
    });

    const buffer = await Packer.toBuffer(doc);
    const safe = (gradeData.studentName || 'student').replace(/[^a-z0-9]/gi, '_').toLowerCase();
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition', `attachment; filename="${safe}_discussion_feedback.docx"`);
    res.send(buffer);
  } catch (e) {
    console.error('DOCX error:', e);
    res.status(500).json({ error: e.message });
  }
});

// POST /api/discussgrade/save-as-example — promote a graded discussion to calibration bank
router.post('/save-as-example', async (req, res) => {
  const { assignmentId, courseId, studentName, submission, criteriaGrades, totalPoints, totalMax, instructorParagraph, scores } = req.body;
  if (!assignmentId || !courseId) return res.status(400).json({ error: 'assignmentId and courseId required' });

  const { v4: uuidv4 } = require('uuid');

  // Build content string from submission + scoring rationale
  const rationaleLines = (criteriaGrades || []).map(cg => {
    const shortName = (cg.criterionName || '').split(':').pop().trim();
    return `${shortName} (${cg.finalPoints || cg.suggestedPoints}/${cg.maxPoints || 15}): ${cg.scoringRationale || cg.studentComment || ''}`;
  }).join('\n');

  const content = [
    'SUBMISSION:\n' + (submission || '').slice(0, 1000),
    '\nSCORING RATIONALE:\n' + rationaleLines,
    instructorParagraph ? '\nINSTRUCTOR FEEDBACK:\n' + instructorParagraph : ''
  ].filter(Boolean).join('\n');

  const score = parseFloat(totalPoints) || 0;
  const max = parseFloat(totalMax) || 75;
  const quality = score / max >= 0.8 ? 'good' : 'weak';

  try {
    db.prepare(`
      INSERT INTO examples (id, assignment_id, course_id, student_name, score, quality, notes, content)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      uuidv4(), assignmentId, courseId, studentName,
      score, quality,
      `Discussion calibration example — ${score}/${max} pts`,
      content
    );
    res.json({ ok: true, quality, score });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
