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
    // Parse CSV properly handling quoted fields with embedded commas/newlines
    function parseCSV(text) {
      const rows = [];
      let row = [], field = '', inQuote = false;
      for (let i = 0; i < text.length; i++) {
        const ch = text[i], next = text[i+1];
        if (ch === '"') {
          if (inQuote && next === '"') { field += '"'; i++; }
          else inQuote = !inQuote;
        } else if (ch === ',' && !inQuote) {
          row.push(field.trim()); field = '';
        } else if ((ch === '\n' || ch === '\r') && !inQuote) {
          if (ch === '\r' && next === '\n') i++;
          row.push(field.trim()); field = '';
          if (row.some(f => f)) rows.push(row);
          row = [];
        } else {
          field += ch;
        }
      }
      if (field || row.length) { row.push(field.trim()); if (row.some(f => f)) rows.push(row); }
      return rows;
    }

    const rows = parseCSV(csv);
    if (rows.length < 2) return res.status(400).json({ error: 'CSV has no data rows' });

    // Expected columns: Criterion, Points, Accomplished, Accomplished Points,
    //                   Proficient, Proficient Points, Needs Improvement, Needs Improvement Points,
    //                   Unacceptable, Unacceptable Points
    const RATING_NAMES = ['Accomplished', 'Proficient', 'Needs Improvement', 'Unacceptable'];
    const criteria = [];

    for (let i = 1; i < rows.length; i++) {
      const f = rows[i];
      const criteriaName = f[0]?.trim();
      if (!criteriaName) continue;

      // Ratings at: [2,3], [4,5], [6,7], [8,9] = (description, points)
      const ratings = [];
      for (let r = 0; r < RATING_NAMES.length; r++) {
        const descIdx = 2 + r * 2;
        const ptsIdx = 3 + r * 2;
        const desc = f[descIdx]?.trim();
        const pts = parseFloat(f[ptsIdx]);
        if (desc && !isNaN(pts)) {
          ratings.push({ name: RATING_NAMES[r], description: desc, points: pts });
        }
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

    if (!criteria.length) return res.status(400).json({ error: 'No criteria found — check CSV format' });

    const totalMax = criteria.reduce((a, c) => a + c.maxPoints, 0);
    res.json({ criteria, totalMax });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Grade a discussion submission against a rubric ───────────────────────

router.post('/grade', async (req, res) => {
  const { courseId, assignmentId, studentName, discussionQuestion, submission, rubricCriteria: clientRubric, instructorBio, tone, sentences, submissionType, feedbackStyle, syncOnly, manualGrade, screenshotData, attachedFiles } = req.body;

  // Sync-only mode — save manual Canvas grades back to platform without re-grading
  if (syncOnly && manualGrade && assignmentId && courseId) {
    try {
      const { v4: uuidv4 } = require('uuid');
      const existing = db.prepare('SELECT id FROM grades WHERE assignment_id=? AND course_id=? AND student_name=?').get(assignmentId, courseId, studentName);
      const scores = {};
      manualGrade.criteriaGrades?.forEach(cg => { scores[cg.criterionName] = cg.suggestedPoints; });
      if (existing) {
        db.prepare('UPDATE grades SET total=?,scores=?,instructor_paragraph=? WHERE id=?')
          .run(manualGrade.totalPoints || 0, JSON.stringify(scores), manualGrade.instructorParagraph || '', existing.id);
        return res.json({ id: existing.id, synced: true });
      } else {
        const gradeId = uuidv4();
        db.prepare('INSERT INTO grades (id,course_id,assignment_id,student_name,assignment_name,file_name,total,max_score,scores,comments,summary,key_strength,key_improvement,instructor_paragraph) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
          .run(gradeId, courseId, assignmentId, studentName, 'Discussion', 'discussion', manualGrade.totalPoints || 0, 75, JSON.stringify(scores), JSON.stringify({}), '', '', '', manualGrade.instructorParagraph || '');
        return res.json({ id: gradeId, synced: true });
      }
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
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

  const system = `You are ${instructorBio || 'an expert instructor'} grading a student discussion post. Read carefully before scoring anything.

CRITICAL: Grade ONLY against the ${rubricCriteria.length} criteria listed below. Do not reference other assignments.

The criteria for THIS assignment:
${rubricCriteria.map((c,i) => `${i+1}. ${c.name}`).join('\n')}

GRADING STANDARDS:
- Half-point scores (12.5, 13.5 etc) are valid — use them when work falls between tiers
- Reference specific words or choices from the submission, not generic observations
- If the student almost makes a key connection but misses it, say exactly what they missed
- If a required deliverable is absent or failed to render, flag it explicitly
- If the student's own reasoning undercuts their argument, point that out
- Be honest about weak work — a 10-12 should feel clearly different from 13-15
${exampleContext ? "Use the calibration examples to anchor your scoring." : ""}
${gradingGuidance ? `\nINSTRUCTOR EXCEPTIONS — HARD RULES, OVERRIDE THE RUBRIC:\n${gradingGuidance}` : ""}`;
  const VOICE_RULES = `VOICE RULES — NON-NEGOTIABLE:
No em-dashes (— or --). Use periods or commas instead.
No filler: never write "it's worth noting", "importantly", "overall", "in conclusion", "to be fair", "that said", "having said that", "I hope this helps", "I wanted to".
No AI tells: no "delves into", "showcases", "demonstrates a nuanced", "commendable", "impressive grasp", "testament to", "robust", "leverages".
No comparisons to other students. Never say "most students", "other students", "the class", "compared to peers", "one of the best", "stronger than most", "unlike your classmates". Each student is evaluated on their own work only.
Short sentences. Plain words. One idea per sentence.
Start with the student's first name only.
Sound like a person talking, not a rubric being read.
If something is missing, say it plainly. If something is strong, name exactly what is strong.`;

  const toneMap = {
    'plain-warm':    'Conversational and warm. Like a professor who has actually read the work and respects the student.',
    'plain':         'Direct and plain. Short sentences. No filler. Get to the point.',
    'conversational':'Talk to them like a person. Informal but substantive.',
    'encouraging':   'Lead with a specific strength. Be genuine, not generic.',
    'coach':         'Forward-looking and direct. Tell them what to do differently next time.',
    'formal':        'Professional but still human. No jargon.',
    'dave':          "Write in the instructor's voice. Warm but direct. Short sentences — if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' Structure: (1) specific strength — name what worked and why, not generic praise; (2) state the gap directly — 'What\\'s missing is...' or 'The problem is...' or 'Where this falls apart is...'; (3) one concrete next step; (4) forward momentum closing — 'Keep pushing on this.' or 'You\\'re on the right track.' or 'Start there.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
    'dave-plain':    "Write in the instructor's voice. Direct and compressed. Military-cadence delivery. Short sentences — if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' No warmth — strip all softening. Structure: (1) specific strength — name what worked and why, not generic praise; (2) state the gap directly — 'What\\'s missing is...' or 'The problem is...' or 'Where this falls apart is...'; (3) one concrete next step; (4) forward momentum closing — 'Keep pushing on this.' or 'Start there.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
    'dave-warm':     "Write in the instructor's voice. Warm and encouraging but still direct. Short sentences — if a sentence has more than one comma, split it. Use 'you' and 'I' throughout, never passive voice. Contractions by default; use 'I am' or 'I do' only for emphasis. Dashes for asides and pivots. No exclamation marks. Never start with 'Overall.' Acknowledge effort before naming the gap. Structure: (1) specific strength — name what worked and why, not generic praise; (2) acknowledge the effort or thinking behind the work; (3) state the gap directly but gently — 'What\\'s missing is...' or 'The piece that needs work is...'; (4) one concrete next step; (5) forward momentum closing — 'Keep pushing on this.' or 'You\\'re on the right track.' Preferred phrases: 'This is strong work.' / 'Go deeper here.' / use 'So,' as a pivot. Never use: demonstrates proficiency, showcases understanding, effectively utilizes, great job, in conclusion. Treat students like colleagues-in-training.",
  };
  const toneInstructions = (tone && !toneMap[tone]
    ? tone
    : (toneMap[tone] || toneMap['plain-warm'])) + '\n\n' + VOICE_RULES;

  const styleMap = {
    'balanced':       'Acknowledge a specific strength first, then address the most important gap clearly.',
    'strength-first': 'Open with what they genuinely did well — be specific. Then transition to what needs work.',
    'gap-first':      'Lead with the most important thing to fix. Then acknowledge what worked.',
    'growth':         'Frame everything in terms of growth — where they are, what the next level looks like, how to get there.',
    'direct':         'Skip the praise. Just tell them exactly what the work shows and what needs to change.',
  };
  const styleInstruction = styleMap[feedbackStyle] || styleMap['balanced'];

  // Skill assessment mode: deeper, more pointed per-criterion feedback
  const criterionCommentInstruction = isSkillAssessment
    ? '2-4 sentences. ' + toneInstructions + ' Be specific and direct. Name the exact thing they did well or the exact gap. Reference something they actually wrote. Tell them what a stronger version would look like.'
    : '1-2 sentences. ' + toneInstructions + ' Be specific. Reference something they actually wrote. Only include if score is not perfect.';

  const paragraphInstruction = isSkillAssessment
    ? toneInstructions + ' ' + styleInstruction + ' Write EXACTLY ' + sentenceCount + ' sentences — no more, no fewer. Count them before finalizing. Start with first name only. Name the specific intellectual move they made. Be honest about gaps. End with something personal and forward-looking. Max 20 words per sentence. Address the student as "you" throughout.'
    : toneInstructions + ' ' + styleInstruction + ' Write EXACTLY ' + sentenceCount + ' sentences — count them. Start with first name only. Max 18 words per sentence. No jargon. Address the student as "you" throughout, not "the student".';

  // Include full assignment description if available — this is what students were asked to do
  const assignmentInstructions = assignmentRecord?.description || '';

  const prompt = `ASSIGNMENT INSTRUCTIONS (what students were explicitly asked to do):
${assignmentInstructions || discussionQuestion || 'No instructions provided'}

STUDENT: ${studentName}
SUBMISSION:
${submission}

RUBRIC CRITERIA:
${criteriaText}

Grade this submission. Check it against BOTH the assignment instructions AND the rubric criteria.
If the assignment instructions required something specific (a distinction, a format, a deliverable) that the student missed, that should affect the score even if the rubric description is vague about it.
You MUST return a criteriaGrades entry for EVERY criterion — no exceptions.

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
      "scoringRationale": "2-3 sentences. Reference the student's actual words or specific choices. Identify exactly what is strong or what is missing. If the student almost connects a key idea but misses it, say so. If a deliverable is absent or broken, call it out directly. Be a sharp reader, not a checklist.",
      "halfPointsOk": "scores like 12.5, 13.5 are valid — use them when the work is between tiers",
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
    // Build message content — include all attached files (images + PDFs) + screenshot
    let messageContent;
    const allFiles = attachedFiles || [];
    const hasScreenshot = screenshotData && screenshotData.startsWith('data:image/');
    const hasFiles = allFiles.length > 0;

    console.log('[discussgrade] screenshotData received:', screenshotData ? screenshotData.length + ' chars' : 'NONE');
    console.log('[discussgrade] attachedFiles received:', allFiles.length);

    if (hasFiles || hasScreenshot) {
      const parts = [];
      parts.push({ type: 'text', text: 'IMPORTANT: The attached files are part of the student submission. Examine ALL attached files BEFORE scoring any criterion. A table, image, or diagram showing original vs refined prompts counts as satisfying the before/after prompt requirement — even if the assignment says "code blocks". A screenshot of a prompt comparison table IS a valid before/after prompt submission. If a deliverable exists in any attached file in any format, do NOT penalize for it being missing. Only mark a deliverable missing if it is absent from both the text submission AND all attached files.' });

      // Add each attached file
      for (const file of allFiles) {
        if (!file.data) continue;
        const base64 = file.data.split(',')[1];
        const mediaType = file.data.split(';')[0].split(':')[1];

        if (mediaType === 'application/pdf') {
          parts.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } });
          console.log('[discussgrade] Including PDF:', file.name);
        } else if (mediaType && mediaType.startsWith('image/')) {
          parts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } });
          console.log('[discussgrade] Including image:', file.name);
        } else if (file.name && (file.name.endsWith('.pptx') || file.name.endsWith('.ppt'))) {
          // Extract text AND images from PowerPoint
          try {
            const JSZip = require('jszip');
            const buf = Buffer.from(base64, 'base64');
            const zip = await JSZip.loadAsync(buf);

            // Extract text from all slides
            const slideFiles = Object.keys(zip.files)
              .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
              .sort((a, b) => {
                const na = parseInt(a.match(/\d+/)?.[0] || 0);
                const nb = parseInt(b.match(/\d+/)?.[0] || 0);
                return na - nb;
              });

            // Get speaker notes files
            const notesFiles = Object.keys(zip.files)
              .filter(n => /^ppt\/notesSlides\/notesSlide\d+\.xml$/.test(n))
              .sort((a, b) => parseInt(a.match(/\d+/)?.[0]||0) - parseInt(b.match(/\d+/)?.[0]||0));

            let pptText = '';
            for (let idx = 0; idx < slideFiles.length; idx++) {
              const xml = await zip.files[slideFiles[idx]].async('string');
              const slideText = (xml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [])
                .map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
              let notesText = '';
              if (notesFiles[idx]) {
                const notesXml = await zip.files[notesFiles[idx]].async('string');
                notesText = (notesXml.match(/<a:t[^>]*>([^<]+)<\/a:t>/g) || [])
                  .map(t => t.replace(/<[^>]+>/g, '')).join(' ').trim();
              }
              if (slideText || notesText) {
                pptText += `[Slide ${idx+1}]`;
                if (slideText) pptText += `: ${slideText}`;
                if (notesText) pptText += `\n  [Speaker Notes]: ${notesText}`;
                pptText += '\n';
              }
            }
            if (pptText) {
              parts.push({ type: 'text', text: 'ATTACHED POWERPOINT (' + file.name + '):\n' + pptText });
              console.log('[discussgrade] Including PPTX text:', file.name, pptText.length, 'chars');
            }

            // Extract slide images/media
            const mediaFiles = Object.keys(zip.files).filter(n =>
              n.startsWith('ppt/media/') && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(n)
            );
            console.log('[discussgrade] PPTX images found:', mediaFiles.length);
            for (const imgPath of mediaFiles.slice(0, 8)) {
              const imgData = await zip.files[imgPath].async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const imgMediaType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
                                   ext === 'png' ? 'image/png' : 'image/jpeg';
              parts.push({ type: 'image', source: { type: 'base64', media_type: imgMediaType, data: imgData } });
              console.log('[discussgrade] Including PPTX image:', imgPath);
            }
          } catch(e) {
            console.warn('[discussgrade] PPTX extraction failed:', e.message);
            parts.push({ type: 'text', text: 'ATTACHED FILE: ' + file.name + ' (could not extract)' });
          }
        } else if (file.name && (file.name.endsWith('.docx') || file.name.endsWith('.doc'))) {
          // Extract text AND images from Word doc
          try {
            const mammoth = require('mammoth');
            const JSZip = require('jszip');
            const buf = Buffer.from(base64, 'base64');

            // Extract text
            const result = await mammoth.extractRawText({ buffer: buf });
            if (result.value) {
              parts.push({ type: 'text', text: 'ATTACHED WORD DOCUMENT (' + file.name + '):\n' + result.value });
              console.log('[discussgrade] Including Word doc text:', file.name, result.value.length, 'chars');
            }

            // Extract embedded images
            const zip = await JSZip.loadAsync(buf);
            const imageFiles = Object.keys(zip.files).filter(n =>
              n.startsWith('word/media/') && /\.(jpg|jpeg|png|gif|bmp|webp)$/i.test(n)
            );
            console.log('[discussgrade] Word doc images found:', imageFiles.length);
            for (const imgPath of imageFiles.slice(0, 5)) {
              const imgData = await zip.files[imgPath].async('base64');
              const ext = imgPath.split('.').pop().toLowerCase();
              const imgMediaType = (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg' :
                                   ext === 'png' ? 'image/png' : 'image/jpeg';
              parts.push({ type: 'image', source: { type: 'base64', media_type: imgMediaType, data: imgData } });
              console.log('[discussgrade] Including embedded image from Word doc:', imgPath);
            }
          } catch(e) {
            console.warn('[discussgrade] Word doc extraction failed:', e.message);
            parts.push({ type: 'text', text: 'ATTACHED FILE: ' + file.name + ' (could not extract text)' });
          }
        }
      }

      // Add auto-screenshot if no files attached
      if (!hasFiles && hasScreenshot) {
        const base64Data = screenshotData.split(',')[1];
        const mediaType = screenshotData.split(';')[0].split(':')[1];
        parts.push({ type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Data } });
        console.log('[discussgrade] Including auto-screenshot');
      }

      parts.push({ type: 'text', text: prompt });
      messageContent = parts;
    } else {
      messageContent = prompt;
    }

    const resp = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: messageContent }]
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

    // Auto-check for DO NOT PENALIZE violations
    if (gradingGuidance && result.criteriaGrades?.length && result.gradeId) {
      try {
        const { v4: uuidv4flag } = require('uuid');
        const dnpTerms = gradingGuidance.split(/[.,\n]/).map(s => s.trim()).filter(s => s.length > 8);
        for (const cg of result.criteriaGrades) {
          const comment = ((cg.studentComment || '') + ' ' + (cg.scoringRationale || '')).toLowerCase();
          for (const term of dnpTerms) {
            const termLower = term.toLowerCase().replace(/^(do not penalize|don't penalize|no penalty|ignore)[\s:]+/i, '').trim();
            if (termLower.length < 6) continue;
            if (comment.includes(termLower.slice(0, 20)) && (cg.suggestedPoints || 0) < (cg.maxPoints || 15)) {
              const exists = db.prepare(`SELECT id FROM grading_flags WHERE assignment_id=? AND student_name=? AND criterion_name=? AND flag_type='dnp-violation' AND status='open'`)
                .get(assignmentId, studentName, cg.criterionName);
              if (!exists) {
                db.prepare(`INSERT INTO grading_flags (id,course_id,assignment_id,student_name,grade_id,flag_type,criterion_name,message) VALUES (?,?,?,?,?,?,?,?)`)
                  .run(uuidv4flag(), courseId, assignmentId, studentName, result.gradeId, 'dnp-violation', cg.criterionName,
                    `"${cg.criterionName}" may have penalized "${termLower.slice(0,50)}" — this is in your DO NOT PENALIZE list.`);
                if (!result.flags) result.flags = [];
                result.flags.push({ type: 'dnp-violation', criterionName: cg.criterionName });
              }
            }
          }
        }
      } catch(e) { console.warn('Flag check error:', e.message); }
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
