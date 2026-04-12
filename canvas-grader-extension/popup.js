// Canvas Grader Extension — Popup Logic

(function () {
  'use strict';

  const DEFAULT_BACKEND = 'http://localhost:3001';

  // ─── DOM refs ─────────────────────────────────────────────────────────

  const modeBadge = document.getElementById('mode-badge');
  const toneSelect = document.getElementById('tone');
  const backendInput = document.getElementById('backend-url');
  const standardPanel = document.getElementById('standard-mode');
  const quizPanel = document.getElementById('quiz-mode');
  const noPagePanel = document.getElementById('no-page');
  const statusBar = document.getElementById('status-bar');

  // Standard mode
  const submissionText = document.getElementById('submission-text');
  const assignmentDesc = document.getElementById('assignment-desc');
  const gradeStandardBtn = document.getElementById('grade-standard-btn');
  const standardResult = document.getElementById('standard-result');

  // Quiz mode
  const quizQuestionsDiv = document.getElementById('quiz-questions');
  const gradeAllBtn = document.getElementById('grade-all-btn');
  const quizEmpty = document.getElementById('quiz-empty');

  // ─── State ────────────────────────────────────────────────────────────

  let currentQuestions = [];
  let activeTabId = null;

  // ─── Helpers ──────────────────────────────────────────────────────────

  function backendUrl() {
    return (backendInput.value || DEFAULT_BACKEND).replace(/\/+$/, '');
  }

  function setStatus(msg, isError) {
    statusBar.textContent = msg;
    statusBar.className = isError ? 'error' : '';
  }

  function sendToTab(msg) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTabId, msg, (resp) => {
        if (chrome.runtime.lastError) {
          resolve({ error: chrome.runtime.lastError.message });
        } else {
          resolve(resp || {});
        }
      });
    });
  }

  // ─── Persist settings ─────────────────────────────────────────────────

  function loadSettings() {
    chrome.storage.local.get(['tone', 'backendUrl'], (data) => {
      if (data.tone) toneSelect.value = data.tone;
      if (data.backendUrl) backendInput.value = data.backendUrl;
    });
  }

  function saveSettings() {
    chrome.storage.local.set({
      tone: toneSelect.value,
      backendUrl: backendInput.value,
    });
  }

  toneSelect.addEventListener('change', saveSettings);
  backendInput.addEventListener('change', saveSettings);

  // ─── Init: detect mode ────────────────────────────────────────────────

  async function init() {
    loadSettings();

    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (!tab || !tab.url || !tab.url.includes('speed_grader')) {
      noPagePanel.style.display = '';
      modeBadge.textContent = 'no SpeedGrader';
      return;
    }

    activeTabId = tab.id;
    const resp = await sendToTab({ type: 'DETECT_MODE' });

    if (resp.error) {
      noPagePanel.style.display = '';
      modeBadge.textContent = 'error';
      setStatus('Could not connect to page. Reload SpeedGrader and try again.', true);
      return;
    }

    if (resp.quiz) {
      enterQuizMode();
    } else {
      enterStandardMode();
    }
  }

  // ─── Standard assignment mode ─────────────────────────────────────────

  async function enterStandardMode() {
    modeBadge.textContent = 'Assignment';
    modeBadge.className = 'standard';
    standardPanel.style.display = '';

    // Try to auto-detect submission text
    const resp = await sendToTab({ type: 'GET_SUBMISSION_TEXT' });
    if (resp.text) submissionText.value = resp.text;
  }

  gradeStandardBtn.addEventListener('click', async () => {
    const sub = submissionText.value.trim();
    const desc = assignmentDesc.value.trim();
    if (!sub) { setStatus('Paste the student submission first.', true); return; }

    gradeStandardBtn.disabled = true;
    setStatus('Grading...');

    try {
      const res = await fetch(`${backendUrl()}/api/quizgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: [
            {
              questionText: desc || 'Assignment submission',
              studentResponse: sub,
              maxPoints: 100,
              scoringComments: '',
            },
          ],
          tone: toneSelect.value,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const r = data.results[0];

      standardResult.style.display = '';
      standardResult.innerHTML = `
        <div class="score-line">Score: ${r.score} / ${r.maxPoints}</div>
        <div class="feedback-line">${escapeHtml(r.feedback)}</div>
      `;
      setStatus('Done.');
    } catch (e) {
      setStatus('Grading failed: ' + e.message, true);
    } finally {
      gradeStandardBtn.disabled = false;
    }
  });

  // ─── Quiz mode ────────────────────────────────────────────────────────

  async function enterQuizMode() {
    modeBadge.textContent = 'Quiz';
    modeBadge.className = 'quiz';
    quizPanel.style.display = '';

    const resp = await sendToTab({ type: 'SCRAPE_QUIZ' });
    if (resp.error) {
      setStatus('Failed to scrape quiz: ' + resp.error, true);
      return;
    }

    currentQuestions = (resp.questions || []);
    const ungraded = currentQuestions.filter((q) => !q.isGraded);

    if (ungraded.length === 0 && currentQuestions.length === 0) {
      quizEmpty.style.display = '';
      return;
    }

    renderQuizQuestions();

    if (ungraded.length > 0) {
      gradeAllBtn.style.display = '';
      gradeAllBtn.textContent = `Grade All (${ungraded.length})`;
    }
  }

  function renderQuizQuestions() {
    quizQuestionsDiv.innerHTML = '';

    currentQuestions.forEach((q, i) => {
      const card = document.createElement('div');
      card.className = 'quiz-question' + (q.isGraded ? ' graded-card' : '');
      card.dataset.index = i;

      const truncatedQ =
        q.questionText.length > 120
          ? q.questionText.slice(0, 120) + '...'
          : q.questionText;

      card.innerHTML = `
        <div class="qq-header">
          <div class="qq-title">${escapeHtml(truncatedQ)}</div>
          <div class="qq-points">${q.maxPoints} pts</div>
        </div>
        <button class="qq-toggle" data-i="${i}">Show response</button>
        <div class="qq-response" id="resp-${i}">${escapeHtml(q.studentResponse || '(no response)')}</div>
        <div class="qq-actions">
          ${
            q.isGraded
              ? `<span style="color:#2e7d32;font-size:11px">Scored: ${q.currentScore}/${q.maxPoints}</span>`
              : `<button class="btn primary small grade-one-btn" data-i="${i}">Grade</button>`
          }
        </div>
        <div class="qq-result" id="result-${i}" style="display:none"></div>
      `;

      quizQuestionsDiv.appendChild(card);
    });

    // Toggle response visibility
    quizQuestionsDiv.addEventListener('click', (e) => {
      if (e.target.classList.contains('qq-toggle')) {
        const idx = e.target.dataset.i;
        const resp = document.getElementById('resp-' + idx);
        const expanded = resp.classList.toggle('expanded');
        e.target.textContent = expanded ? 'Hide response' : 'Show response';
      }
    });

    // Individual grade buttons
    quizQuestionsDiv.addEventListener('click', (e) => {
      if (e.target.classList.contains('grade-one-btn')) {
        const idx = parseInt(e.target.dataset.i, 10);
        gradeQuestion(idx, e.target);
      }
    });

    // Approve buttons (added dynamically after grading)
    quizQuestionsDiv.addEventListener('click', (e) => {
      if (e.target.classList.contains('approve-btn')) {
        const idx = parseInt(e.target.dataset.i, 10);
        approveQuestion(idx);
      }
    });
  }

  // ─── Grade a single question ──────────────────────────────────────────

  async function gradeQuestion(idx, btn) {
    const q = currentQuestions[idx];
    if (!q) return;

    if (btn) btn.disabled = true;
    setStatus(`Grading question ${idx + 1}...`);

    try {
      const res = await fetch(`${backendUrl()}/api/quizgrade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          questions: [
            {
              questionText: q.questionText,
              studentResponse: q.studentResponse,
              maxPoints: q.maxPoints,
              scoringComments: q.scoringComments,
            },
          ],
          tone: toneSelect.value,
        }),
      });

      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const data = await res.json();
      const r = data.results[0];

      // Store result on the question object
      q._result = r;

      // Show result card
      const resultDiv = document.getElementById('result-' + idx);
      resultDiv.style.display = '';
      resultDiv.innerHTML = `
        <div class="score-line">Suggested: ${r.score} / ${r.maxPoints}</div>
        <div class="feedback-line">${escapeHtml(r.feedback)}</div>
        <div style="margin-top:6px">
          <button class="btn approve small approve-btn" data-i="${idx}">Approve &amp; Fill Score</button>
        </div>
      `;

      if (btn) {
        btn.textContent = 'Re-grade';
        btn.disabled = false;
      }
      setStatus('');
    } catch (e) {
      setStatus('Grading failed: ' + e.message, true);
      if (btn) btn.disabled = false;
    }
  }

  // ─── Grade All ────────────────────────────────────────────────────────

  gradeAllBtn.addEventListener('click', async () => {
    gradeAllBtn.disabled = true;
    const ungraded = currentQuestions
      .map((q, i) => ({ q, i }))
      .filter(({ q }) => !q.isGraded);

    for (const { i } of ungraded) {
      const btn = quizQuestionsDiv.querySelector(
        `.grade-one-btn[data-i="${i}"]`
      );
      await gradeQuestion(i, btn);
    }

    gradeAllBtn.disabled = false;
    setStatus(`Graded ${ungraded.length} questions.`);
  });

  // ─── Approve: fill score into Canvas ──────────────────────────────────

  async function approveQuestion(idx) {
    const q = currentQuestions[idx];
    if (!q || !q._result) return;

    const r = q._result;

    // Fill the score
    if (q.scoreInputSelector) {
      const resp = await sendToTab({
        type: 'FILL_SCORE',
        selector: q.scoreInputSelector,
        score: r.score,
      });
      if (!resp.ok) {
        setStatus('Could not fill score field. Fill manually: ' + r.score, true);
      }
    } else {
      // Try by question holder ID
      const resp = await sendToTab({
        type: 'FILL_SCORE',
        selector: q.id,
        score: r.score,
      });
      if (!resp.ok) {
        setStatus('Score input not found. Enter manually: ' + r.score, true);
      }
    }

    // Add feedback as a comment
    await sendToTab({
      type: 'ADD_COMMENT',
      text: `Q${idx + 1}: ${r.feedback}`,
    });

    // Update UI
    const resultDiv = document.getElementById('result-' + idx);
    const approveBtn = resultDiv.querySelector('.approve-btn');
    if (approveBtn) {
      approveBtn.textContent = 'Approved';
      approveBtn.disabled = true;
      approveBtn.style.background = '#81c784';
    }

    setStatus(`Question ${idx + 1} approved.`);
  }

  // ─── Utility ──────────────────────────────────────────────────────────

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Boot ─────────────────────────────────────────────────────────────

  init();
})();
