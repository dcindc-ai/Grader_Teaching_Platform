// Canvas SpeedGrader content script
// Detects quiz vs standard assignment mode and scrapes quiz essay questions

(function () {
  'use strict';

  // Avoid double-injection
  if (window.__canvasGraderInjected) return;
  window.__canvasGraderInjected = true;

  // ─── Quiz detection ───────────────────────────────────────────────────

  function isQuizPage() {
    return !!(
      document.querySelector('.quiz-submission') ||
      document.querySelector('#quiz-submission-version-table') ||
      document.querySelector('.quiz_score') ||
      document.querySelector('.quiz-header') ||
      document.querySelector('#questions.question_list') ||
      document.querySelector('.question_holder') ||
      // Quiz.Next / New Quizzes in iframe
      document.querySelector('iframe[src*="quizzes"]')
    );
  }

  // ─── Essay question scraping ──────────────────────────────────────────

  function scrapeEssayQuestions() {
    const questions = [];
    // Classic quizzes: .question_holder or .question elements
    const holders = document.querySelectorAll(
      '.question_holder, .question, .display_question'
    );

    holders.forEach((holder, idx) => {
      // Check if this is an essay/short-answer type
      const isEssay =
        holder.classList.contains('essay_question') ||
        holder.classList.contains('short_answer_question') ||
        holder.querySelector('.essay_question') ||
        holder.querySelector('.question_text') && holder.querySelector('.answer_text, .quiz_response_text, .text_answer');

      if (!isEssay && !hasTextResponse(holder)) return;

      // Question text
      const questionTextEl = holder.querySelector('.question_text');
      const questionText = questionTextEl
        ? questionTextEl.innerText.trim()
        : `Question ${idx + 1}`;

      // Student response
      const responseEl =
        holder.querySelector('.quiz_response_text') ||
        holder.querySelector('.answer_text') ||
        holder.querySelector('.text_answer') ||
        holder.querySelector('.answer') ||
        holder.querySelector('.response_text');
      const studentResponse = responseEl ? responseEl.innerText.trim() : '';

      // Point value
      const pointsEl =
        holder.querySelector('.question_points_holder .points') ||
        holder.querySelector('.points_possible') ||
        holder.querySelector('.question_points') ||
        holder.querySelector('[class*="points"]');
      let maxPoints = 0;
      if (pointsEl) {
        const match = pointsEl.innerText.match(/([\d.]+)/);
        if (match) maxPoints = parseFloat(match[1]);
      }

      // Current score (if already graded)
      const scoreInput = holder.querySelector(
        'input[type="text"].question_input, input.question_score, input[name*="score"]'
      );
      const currentScore = scoreInput ? scoreInput.value.trim() : '';
      const isGraded = currentScore !== '' && currentScore !== '0';

      // Scoring comments: "General answer comments" or "Wrong answer comments"
      const commentEls = holder.querySelectorAll(
        '.answer_comment, .general_answer_comment, .correct_answer_comment, .wrong_answer_comment, .neutral_comments'
      );
      const scoringComments = Array.from(commentEls)
        .map((el) => el.innerText.trim())
        .filter(Boolean)
        .join('\n');

      // Question ID for targeting the score input later
      const qId =
        holder.getAttribute('id') ||
        holder.dataset.questionId ||
        `q_${idx}`;

      questions.push({
        id: qId,
        index: idx,
        questionText,
        studentResponse,
        maxPoints,
        currentScore,
        isGraded,
        scoringComments,
        scoreInputSelector: scoreInput
          ? buildSelector(scoreInput)
          : null,
      });
    });

    return questions;
  }

  function hasTextResponse(holder) {
    const response =
      holder.querySelector('.quiz_response_text') ||
      holder.querySelector('.answer_text') ||
      holder.querySelector('.text_answer');
    return response && response.innerText.trim().length > 0;
  }

  // Build a CSS selector we can use to find the score input later
  function buildSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    if (el.name) return `input[name="${CSS.escape(el.name)}"]`;
    // Walk up to find a parent with ID
    let parent = el.parentElement;
    while (parent) {
      if (parent.id) {
        const tag = el.tagName.toLowerCase();
        const type = el.type ? `[type="${el.type}"]` : '';
        return `#${CSS.escape(parent.id)} ${tag}${type}`;
      }
      parent = parent.parentElement;
    }
    return null;
  }

  // ─── Standard assignment: get submission text ─────────────────────────

  function getAssignmentSubmissionText() {
    // SpeedGrader shows submission in an iframe or directly
    const iframe = document.querySelector('#speedgrader_iframe');
    if (iframe) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow.document;
        const body = doc.querySelector('.user_content, .submission_body, body');
        return body ? body.innerText.trim() : '';
      } catch (e) {
        // Cross-origin — can't read
        return '';
      }
    }
    const sub = document.querySelector('.submission_body, .user_content');
    return sub ? sub.innerText.trim() : '';
  }

  // ─── Fill score into SpeedGrader ──────────────────────────────────────

  function fillQuizScore(selectorOrId, score) {
    let input;
    if (selectorOrId.startsWith('#') || selectorOrId.startsWith('input')) {
      input = document.querySelector(selectorOrId);
    } else {
      // Try finding by question holder ID
      const holder = document.getElementById(selectorOrId);
      if (holder) {
        input = holder.querySelector(
          'input.question_input, input.question_score, input[name*="score"]'
        );
      }
    }
    if (!input) return false;

    // Set value and dispatch events so Canvas picks it up
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value'
    ).set;
    nativeInputValueSetter.call(input, String(score));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ─── Add a comment to SpeedGrader ─────────────────────────────────────

  function addSpeedGraderComment(text) {
    const commentBox = document.querySelector(
      '#speedgrader_comment_textarea, #speed_grader_comment_textarea, textarea[name="comment"]'
    );
    if (!commentBox) return false;
    commentBox.value = text;
    commentBox.dispatchEvent(new Event('input', { bubbles: true }));
    commentBox.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // ─── Message handler for popup communication ─────────────────────────

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    switch (msg.type) {
      case 'DETECT_MODE': {
        const quiz = isQuizPage();
        sendResponse({ quiz });
        break;
      }

      case 'SCRAPE_QUIZ': {
        const questions = scrapeEssayQuestions();
        sendResponse({ questions });
        break;
      }

      case 'GET_SUBMISSION_TEXT': {
        const text = getAssignmentSubmissionText();
        sendResponse({ text });
        break;
      }

      case 'FILL_SCORE': {
        const ok = fillQuizScore(msg.selector, msg.score);
        sendResponse({ ok });
        break;
      }

      case 'ADD_COMMENT': {
        const ok = addSpeedGraderComment(msg.text);
        sendResponse({ ok });
        break;
      }

      default:
        sendResponse({ error: 'unknown message type' });
    }
    return true; // keep channel open for async
  });
})();
