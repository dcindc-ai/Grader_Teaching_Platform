const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const multer = require('multer');
const router = express.Router();

const upload = multer({ dest: './uploads/dev/', limits: { fileSize: 25 * 1024 * 1024 } });

const ROOT = path.join(__dirname, '..', '..');

// ─── Chat with file support ───────────────────────────────────────────────

router.post('/chat', upload.array('files', 10), async (req, res) => {
  const { messages } = req.body;
  const files = req.files || [];

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Build message content
  const userContent = [];

  // Add uploaded files
  for (const file of files) {
    const data = fs.readFileSync(file.path).toString('base64');
    const isImage = file.mimetype?.startsWith('image/');
    if (isImage) {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: file.mimetype, data } });
    } else {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    }
    try { fs.unlinkSync(file.path); } catch (e) {}
  }

  // Parse message history
  const history = JSON.parse(messages || '[]');
  const lastUser = history[history.length - 1];
  if (lastUser?.content) userContent.push({ type: 'text', text: lastUser.content });

  const priorMessages = history.slice(0, -1).map(m => ({
    role: m.role,
    content: m.content
  }));

  // Get project structure for context
  function getProjectFiles(dir, prefix = '') {
    const items = [];
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (['node_modules', '.git', 'uploads', 'data', 'dist', '.env'].includes(entry)) continue;
        const fullPath = path.join(dir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          items.push(`${prefix}${entry}/`);
          items.push(...getProjectFiles(fullPath, prefix + '  '));
        } else {
          items.push(`${prefix}${entry}`);
        }
      }
    } catch (e) {}
    return items;
  }

  const projectFiles = getProjectFiles(ROOT).join('\n');

  const system = `You are an expert full-stack developer helping Dave Cook build and improve his Teaching Platform — a Node.js + React + SQLite app for grading student assignments at UMD and Wake Forest University.

PROJECT STRUCTURE:
${projectFiles}

ROOT PATH: ${ROOT}

You can read any file in the project and write code changes. When the user asks for a change:
1. Explain what you'll do briefly
2. Provide the complete updated file content in a code block with the file path as the first line
3. Format code blocks like this:

\`\`\`file:backend/routes/example.js
// complete file content here
\`\`\`

Use this exact format so changes can be applied automatically. Always provide COMPLETE file contents, never partial. You can suggest multiple file changes in one response.

When reading files, you can ask the user to share them or reference them by path. Be direct, practical, and focused on what Dave actually needs.`;

  try {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const stream = await client.messages.stream({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system,
      messages: [...priorMessages, { role: 'user', content: userContent.length > 1 || files.length ? userContent : lastUser?.content || '' }]
    });

    for await (const chunk of stream) {
      if (chunk.type === 'content_block_delta' && chunk.delta?.type === 'text_delta') {
        res.write(`data: ${JSON.stringify({ text: chunk.delta.text })}\n\n`);
      }
    }
    res.write('data: [DONE]\n\n');
    res.end();
  } catch (e) {
    res.write(`data: ${JSON.stringify({ error: e.message })}\n\n`);
    res.end();
  }
});

// ─── Read a file ──────────────────────────────────────────────────────────

router.get('/file', (req, res) => {
  const { path: filePath } = req.query;
  if (!filePath) return res.status(400).json({ error: 'path required' });
  const full = path.join(ROOT, filePath);
  if (!full.startsWith(ROOT)) return res.status(403).json({ error: 'Access denied' });
  try {
    const content = fs.readFileSync(full, 'utf8');
    res.json({ path: filePath, content });
  } catch (e) {
    res.status(404).json({ error: 'File not found' });
  }
});

// ─── Apply code changes ───────────────────────────────────────────────────

router.post('/apply', (req, res) => {
  const { changes } = req.body;
  // changes: [{ path: 'backend/routes/foo.js', content: '...' }]
  if (!Array.isArray(changes) || !changes.length) {
    return res.status(400).json({ error: 'changes array required' });
  }

  const applied = [];
  const errors = [];

  for (const change of changes) {
    try {
      const full = path.join(ROOT, change.path);
      if (!full.startsWith(ROOT)) { errors.push(`${change.path}: access denied`); continue; }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, change.content, 'utf8');
      applied.push(change.path);
    } catch (e) {
      errors.push(`${change.path}: ${e.message}`);
    }
  }

  res.json({ applied, errors });
});

// ─── Git status ───────────────────────────────────────────────────────────

router.get('/git/status', (req, res) => {
  try {
    const status = execSync('git status --short', { cwd: ROOT }).toString().trim();
    const log = execSync('git log --oneline -5', { cwd: ROOT }).toString().trim();
    res.json({ status, log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Git push ─────────────────────────────────────────────────────────────

router.post('/git/push', (req, res) => {
  const { message } = req.body;
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPO;

  if (!token || !repo) {
    return res.status(400).json({ error: 'GITHUB_TOKEN and GITHUB_REPO must be set in .env' });
  }

  try {
    execSync('git add .', { cwd: ROOT });
    const commitMsg = message || `Update from Teaching Platform — ${new Date().toLocaleString()}`;
    execSync(`git commit -m "${commitMsg.replace(/"/g, "'")}"`, { cwd: ROOT });
    const remoteUrl = `https://${token}@github.com/${repo}.git`;
    execSync(`git push ${remoteUrl} main`, { cwd: ROOT });
    const log = execSync('git log --oneline -3', { cwd: ROOT }).toString().trim();
    res.json({ ok: true, log });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── List project files ───────────────────────────────────────────────────

router.get('/files', (req, res) => {
  function walk(dir, prefix = '') {
    const items = [];
    try {
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        if (['node_modules', '.git', 'uploads', 'data', 'dist', '.env'].includes(entry)) continue;
        const full = path.join(dir, entry);
        const rel = path.join(prefix, entry);
        const stat = fs.statSync(full);
        if (stat.isDirectory()) {
          items.push({ type: 'dir', path: rel, name: entry });
          items.push(...walk(full, rel));
        } else {
          items.push({ type: 'file', path: rel, name: entry, size: stat.size });
        }
      }
    } catch (e) {}
    return items;
  }
  res.json(walk(ROOT));
});

module.exports = router;
