// Whether the grader writes a per-criterion comment when the criterion scored
// full marks.
//
// The instructor picks this from a "Comments" dropdown: all criteria, only
// imperfect ones, or none. The Canvas panel applies its choice AFTER the
// response comes back, and it can only clear comment text — it has no way to
// write a comment the model never produced. So the server's default has to be
// generous: generate for every criterion and let the client subtract.
//
// The bug this replaces: the discussion grader ended its prompt with "Only
// include if score is not perfect" unconditionally, so "All criteria" could
// never work. It appeared to work intermittently only when the model wrote a
// comment in spite of the instruction.

const SENTENCES = {
  all:
    'Write a studentComment for EVERY criterion, including any you award full marks. ' +
    'On a perfect criterion, say specifically what made the work strong there rather than ' +
    'inventing a shortcoming.',
  imperfect:
    'Only include a studentComment if the score is not perfect. ' +
    'Leave it empty when the criterion earns full marks.',
  none:
    'Leave studentComment empty for every criterion.',
};

/**
 * The sentence to append to the per-criterion comment instruction.
 *
 * Anything unrecognised — including a missing mode — falls back to 'all',
 * deliberately: a comment that was generated and then discarded costs a few
 * tokens, while one that was never generated cannot be recovered downstream.
 */
function commentPolicySentence(commentMode) {
  const mode = String(commentMode ?? '').trim().toLowerCase();
  return SENTENCES[mode] || SENTENCES.all;
}

module.exports = { commentPolicySentence, COMMENT_MODES: Object.keys(SENTENCES) };
