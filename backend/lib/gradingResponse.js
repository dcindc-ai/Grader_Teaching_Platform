// Turning a model response into a grade object, safely.
//
// Every grading surface used to do this:
//
//   const text = resp.content.find(b => b.type === 'text')?.text || '{}';
//   const result = JSON.parse(text.replace(/```json\n?|```/g, '').trim());
//
// which has two problems. It never asks whether the response finished. When
// the model hits max_tokens the JSON stops mid-string, and the instructor sees
// "Unterminated string in JSON at position 2883" — a message that points at the
// parser instead of the cause. And `|| '{}'` turns an empty response into an
// empty grade rather than an error.
//
// Thinking tokens count against max_tokens, so a budget that was comfortable
// before adaptive thinking can truncate now. The fix is a bigger budget; this
// module makes the failure legible when the budget is still wrong.

class GradingResponseTruncated extends Error {
  constructor(surface, usage) {
    const thinking = usage?.output_tokens_details?.thinking_tokens ?? 0;
    const output = usage?.output_tokens ?? 0;
    super(
      `${surface}: the model's response was truncated — it hit max_tokens before finishing the JSON ` +
      `(${output} output tokens, ${thinking} of them thinking). ` +
      `Raise max_tokens for this call, or lower the reasoning effort or the amount of feedback requested.`
    );
    this.name = 'GradingResponseTruncated';
    this.surface = surface;
    this.outputTokens = output;
    this.thinkingTokens = thinking;
  }
}

/**
 * Extract and parse the JSON grade from a Messages API response.
 *
 * `surface` names the caller ('discussgrade', 'grade', ...) so an error in the
 * log says which grader produced it.
 *
 * Throws GradingResponseTruncated when the response hit max_tokens — checked
 * before parsing, because a truncated response can still parse when the cut
 * happens to land after a closing brace, and silently accepting that would
 * drop criteria from the grade.
 */
function parseGradingJson(resp, surface = 'grader') {
  if (resp?.stop_reason === 'max_tokens') {
    throw new GradingResponseTruncated(surface, resp.usage);
  }
  if (resp?.stop_reason === 'refusal') {
    const category = resp.stop_details?.category || 'unspecified';
    throw new Error(`${surface}: the model refused this request (category: ${category}).`);
  }

  const text = resp?.content?.find(b => b.type === 'text')?.text ?? '';
  const clean = text.replace(/```json\n?|```/g, '').trim();
  if (!clean) {
    throw new Error(`${surface}: the model returned no text (stop_reason: ${resp?.stop_reason ?? 'unknown'}).`);
  }

  try {
    return JSON.parse(clean);
  } catch (e) {
    throw new Error(`${surface}: the model did not return valid JSON — ${e.message}`);
  }
}

module.exports = { parseGradingJson, GradingResponseTruncated };
