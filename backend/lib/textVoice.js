// Deterministic voice cleanup for generated student-facing text.
//
// The grading prompts ASK the model to avoid em-dashes, colons, and semicolons,
// but a model instruction is not a guarantee — it slips. This scrubber runs on the
// generated text right before it is saved or returned, so the output is guaranteed
// clean regardless of what the model produced. Instructor preference (see VOICE_RULES
// in the grading routes) is to replace these with periods.
//
// Only apply to GENERATED PROSE (feedback paragraphs, rationales, comments, summaries).
// Do NOT apply to rubric criterion names or other instructor-authored data, which may
// legitimately contain colons.

// Spans we must NOT rewrite (URLs, clock times, ratios). They are stashed behind
// NUL-delimited tokens, the scrub runs, then they are restored verbatim.
const PROTECT = [
  /\bhttps?:\/\/[^\s)]+/gi,                        // URLs
  /\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:am|pm)?\b/gi,   // clock times: 3:30, 09:15:00, 5:00pm
  /\b\d+:\d+\b/g,                                  // ratios: 2:1
];

const NUL = String.fromCharCode(0);

function scrubAiTells(text) {
  if (text == null || typeof text !== 'string' || text === '') return text;

  // 1) Stash protected spans behind NUL-delimited tokens. NUL never appears in real
  //    text and matches none of the punctuation/space/letter regexes below, so the
  //    placeholder survives the scrub untouched and cannot collide with real digits.
  const stash = [];
  let out = text;
  for (const re of PROTECT) {
    out = out.replace(re, m => {
      stash.push(m);
      return NUL + (stash.length - 1) + NUL;
    });
  }

  // 2) Dash variants (em, en, horizontal bar) and spaced double-hyphen. Between digits,
  //    collapse to a plain hyphen so numeric ranges stay readable (a plain hyphen is not
  //    the "AI tell" the em-dash is). Elsewhere, break the sentence with a period.
  out = out.replace(/(\d)\s*[—–―]\s*(\d)/g, '$1-$2');
  out = out.replace(/\s*[—–―]\s*/g, '. ');
  out = out.replace(/\s+--\s+/g, '. ');

  // 3) Semicolons -> period.
  out = out.replace(/\s*;\s*/g, '. ');

  // 4) Colons -> period. (Protected times/ratios/URLs are already stashed.)
  out = out.replace(/\s*:\s*/g, '. ');
  out = out.replace(/:\s*$/g, '.');

  // 5) Tidy artifacts from the replacements.
  out = out.replace(/\.(\s*\.)+/g, '.');            // collapse runs of periods
  out = out.replace(/\s+([.,!?])/g, '$1');          // no space before punctuation
  out = out.replace(/([.!?])(?=[A-Za-z])/g, '$1 '); // ensure a space after a break
  out = out.replace(/[ \t]{2,}/g, ' ');             // collapse runs of spaces

  // 6) Capitalize the first letter of any clause a new period created.
  out = out.replace(/([.!?]\s+)([a-z])/g, (m, p, c) => p + c.toUpperCase());
  out = out.replace(/^(\s*)([a-z])/, (m, s, c) => s + c.toUpperCase());

  // 7) Restore protected spans.
  const restoreRe = new RegExp(NUL + '(\\d+)' + NUL, 'g');
  out = out.replace(restoreRe, (m, i) => stash[Number(i)]);

  return out.trim();
}

// Walk an object (or array of objects) and scrub only the named string fields.
// Returns the same reference (mutated in place) for convenience.
function scrubFields(obj, fields) {
  if (!obj || typeof obj !== 'object') return obj;
  const arr = Array.isArray(obj) ? obj : [obj];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    for (const f of fields) {
      if (typeof item[f] === 'string') item[f] = scrubAiTells(item[f]);
    }
  }
  return obj;
}

module.exports = { scrubAiTells, scrubFields };
