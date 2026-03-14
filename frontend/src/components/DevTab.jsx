import { useState, useRef, useEffect } from 'react';

const BASE = import.meta.env.PROD ? '' : 'http://localhost:3001';

function h(pw) { return { 'x-admin-password': pw }; }

export default function DevTab({ password }) {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('dev_enabled') === 'true');
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [gitStatus, setGitStatus] = useState(null);
  const [pushing, setPushing] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState(null);
  const [showGit, setShowGit] = useState(false);
  const bottomRef = useRef();
  const fileRef = useRef();
  const textareaRef = useRef();

  useEffect(() => {
    localStorage.setItem('dev_enabled', enabled);
  }, [enabled]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function toggleEnabled() {
    setEnabled(e => !e);
  }

  async function loadGitStatus() {
    const r = await fetch(`${BASE}/api/dev/git/status`, { headers: h(password) });
    const d = await r.json();
    setGitStatus(d);
  }

  async function handlePush() {
    setPushing(true);
    try {
      const r = await fetch(`${BASE}/api/dev/git/push`, {
        method: 'POST',
        headers: { ...h(password), 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMsg || `Update from Teaching Platform — ${new Date().toLocaleString()}` })
      });
      const d = await r.json();
      if (d.ok) {
        setGitStatus(g => ({ ...g, log: d.log, status: '' }));
        setCommitMsg('');
        addSystemMessage('✓ Pushed to GitHub successfully.');
      } else {
        addSystemMessage('Push error: ' + d.error);
      }
    } catch (e) {
      addSystemMessage('Push failed: ' + e.message);
    }
    setPushing(false);
  }

  function addSystemMessage(text) {
    setMessages(m => [...m, { role: 'system', content: text }]);
  }

  // Parse code blocks from assistant response
  function parseChanges(text) {
    const regex = /```file:([^\n]+)\n([\s\S]*?)```/g;
    const changes = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      changes.push({ path: match[1].trim(), content: match[2] });
    }
    return changes;
  }

  async function applyChanges(changes) {
    setApplying(true);
    setApplyResult(null);
    try {
      const r = await fetch(`${BASE}/api/dev/apply`, {
        method: 'POST',
        headers: { ...h(password), 'Content-Type': 'application/json' },
        body: JSON.stringify({ changes })
      });
      const d = await r.json();
      setApplyResult(d);
      if (d.applied?.length) {
        addSystemMessage(`✓ Applied changes to: ${d.applied.join(', ')}\n⚠️ Restart the backend to see changes take effect.`);
      }
      if (d.errors?.length) {
        addSystemMessage('Errors: ' + d.errors.join(', '));
      }
    } catch (e) {
      addSystemMessage('Apply failed: ' + e.message);
    }
    setApplying(false);
  }

  async function sendMessage() {
    if (!input.trim() && !files.length) return;
    const userMsg = { role: 'user', content: input };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const fd = new FormData();
    fd.append('messages', JSON.stringify(newMessages));
    files.forEach(f => fd.append('files', f));
    setFiles([]);

    try {
      const resp = await fetch(`${BASE}/api/dev/chat`, {
        method: 'POST',
        headers: h(password),
        body: fd
      });

      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let assistantText = '';
      const assistantMsgIndex = newMessages.length;

      setMessages(m => [...m, { role: 'assistant', content: '' }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const evt = JSON.parse(data);
              if (evt.text) {
                assistantText += evt.text;
                setMessages(m => m.map((msg, i) =>
                  i === assistantMsgIndex ? { ...msg, content: assistantText } : msg
                ));
              }
            } catch (e) {}
          }
        }
      }

      // Check for code changes in response
      const changes = parseChanges(assistantText);
      if (changes.length) {
        setMessages(m => [...m, {
          role: 'action',
          content: `Found ${changes.length} file change${changes.length > 1 ? 's' : ''}`,
          changes
        }]);
      }

    } catch (e) {
      addSystemMessage('Error: ' + e.message);
    }
    setLoading(false);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  function renderMessage(msg, i) {
    if (msg.role === 'system') {
      return (
        <div key={i} style={{ padding: '8px 12px', background: 'rgba(76,175,114,0.08)', border: '1px solid rgba(76,175,114,0.2)', borderRadius: 6, fontSize: 12, color: 'var(--green)', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
          {msg.content}
        </div>
      );
    }

    if (msg.role === 'action') {
      return (
        <div key={i} style={{ padding: '10px 12px', background: 'rgba(224,160,48,0.08)', border: '1px solid rgba(224,160,48,0.3)', borderRadius: 6, marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--amber)', marginBottom: 8, fontWeight: 500 }}>
            {msg.content}
          </div>
          {msg.changes.map((c, j) => (
            <div key={j} style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--text2)', marginBottom: 4 }}>
              📄 {c.path}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              className="primary"
              style={{ fontSize: 12 }}
              onClick={() => applyChanges(msg.changes)}
              disabled={applying}
            >
              {applying ? 'Applying…' : '⚡ Apply changes locally'}
            </button>
            <button
              style={{ fontSize: 12 }}
              onClick={() => {
                applyChanges(msg.changes).then(() => {
                  setShowGit(true);
                  loadGitStatus();
                });
              }}
              disabled={applying}
            >
              Apply + open Git panel
            </button>
          </div>
        </div>
      );
    }

    const isUser = msg.role === 'user';

    // Render assistant message with code block formatting
    function renderContent(text) {
      const parts = text.split(/(```[\s\S]*?```)/g);
      return parts.map((part, idx) => {
        if (part.startsWith('```')) {
          const lines = part.slice(3, -3).split('\n');
          const lang = lines[0];
          const code = lines.slice(1).join('\n');
          const isFileBlock = lang.startsWith('file:');
          return (
            <pre key={idx} style={{
              background: isFileBlock ? 'rgba(79,142,247,0.08)' : 'var(--bg3)',
              border: isFileBlock ? '1px solid rgba(79,142,247,0.3)' : '1px solid var(--border)',
              borderRadius: 6, padding: '10px 12px', fontSize: 11,
              fontFamily: 'var(--mono)', overflowX: 'auto', margin: '8px 0',
              color: 'var(--text)'
            }}>
              {isFileBlock && <div style={{ fontSize: 10, color: 'var(--accent)', marginBottom: 6, fontWeight: 600 }}>📄 {lang.replace('file:', '')}</div>}
              {code}
            </pre>
          );
        }
        return <span key={idx} style={{ whiteSpace: 'pre-wrap' }}>{part}</span>;
      });
    }

    return (
      <div key={i} style={{
        display: 'flex',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        marginBottom: 12
      }}>
        <div style={{
          maxWidth: '85%',
          padding: '10px 14px',
          borderRadius: 10,
          background: isUser ? 'var(--accent)' : 'var(--bg2)',
          border: isUser ? 'none' : '1px solid var(--border)',
          color: isUser ? '#fff' : 'var(--text)',
          fontSize: 13, lineHeight: 1.65
        }}>
          {isUser ? msg.content : renderContent(msg.content)}
          {!msg.content && loading && i === messages.length - 1 && (
            <span style={{ color: 'var(--text3)' }}>Thinking…</span>
          )}
        </div>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div style={{ maxWidth: 520 }}>
        <div className="page-header">
          <div className="page-title">Dev Console</div>
          <div className="page-sub">Enable to modify app code, apply changes, and push to GitHub</div>
        </div>
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 32, marginBottom: 16 }}>🔧</div>
          <div style={{ fontWeight: 500, marginBottom: 8 }}>Dev Console is disabled</div>
          <div style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
            Enable this to chat with Claude about code changes, apply them directly to your files, and push to GitHub — all without leaving the app.
          </div>
          <button className="primary" onClick={toggleEnabled}>Enable Dev Console</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 100px)', maxWidth: 900 }}>
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
        <div>
          <div className="page-title">Dev Console</div>
          <div className="page-sub">Chat with Claude to modify the app · Apply changes · Push to GitHub</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button style={{ fontSize: 12 }} onClick={() => { setShowGit(g => !g); if (!gitStatus) loadGitStatus(); }}>
            {showGit ? 'Hide Git' : 'Git panel'}
          </button>
          <button style={{ fontSize: 12 }} onClick={() => setMessages([])}>Clear chat</button>
          <button className="danger" style={{ fontSize: 12 }} onClick={toggleEnabled}>Disable</button>
        </div>
      </div>

      {/* Git panel */}
      {showGit && (
        <div className="card" style={{ marginBottom: 12, flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <span style={{ fontWeight: 500, fontSize: 13 }}>Git</span>
            <button style={{ fontSize: 11 }} onClick={loadGitStatus}>↻ Refresh</button>
          </div>
          {gitStatus && (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text2)', marginBottom: 8, whiteSpace: 'pre-wrap' }}>
                {gitStatus.status || 'Working tree clean'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text3)', marginBottom: 10, whiteSpace: 'pre-wrap' }}>
                {gitStatus.log}
              </div>
            </>
          )}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="Commit message (optional)"
              style={{ flex: 1, fontSize: 12 }}
            />
            <button className="primary" onClick={handlePush} disabled={pushing} style={{ fontSize: 12, flexShrink: 0 }}>
              {pushing ? 'Pushing…' : '↑ Push to GitHub'}
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0', marginBottom: 12 }}>
        {messages.length === 0 && (
          <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text3)', fontSize: 13 }}>
            <div style={{ fontSize: 24, marginBottom: 12 }}>💬</div>
            Describe a change you want to make to the app.<br />
            Claude will write the code and you can apply it with one click.<br /><br />
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 12 }}>
              {[
                'Add a new rubric component to Lab 1',
                'Change the narrative max score to 3 points',
                'Add a dark mode toggle',
                'Show word count on narrative feedback',
                'Add export to CSV for discussion grades'
              ].map(s => (
                <button key={s} className="ghost" style={{ fontSize: 11, border: '1px solid var(--border2)' }}
                  onClick={() => { setInput(s); textareaRef.current?.focus(); }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((msg, i) => renderMessage(msg, i))}
        <div ref={bottomRef} />
      </div>

      {/* File previews */}
      {files.length > 0 && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', flexShrink: 0 }}>
          {files.map((f, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 6, fontSize: 11 }}>
              📎 {f.name}
              <button className="ghost" style={{ padding: '0 2px', fontSize: 12 }} onClick={() => setFiles(fs => fs.filter((_, j) => j !== i))}>×</button>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <input ref={fileRef} type="file" multiple style={{ display: 'none' }}
          onChange={e => setFiles(f => [...f, ...Array.from(e.target.files)])} />
        <button className="ghost" style={{ flexShrink: 0, height: 40, width: 40, fontSize: 18, padding: 0 }}
          onClick={() => fileRef.current.click()} title="Attach file">
          📎
        </button>
        <textarea
          ref={textareaRef}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe a change… (Enter to send, Shift+Enter for new line)"
          rows={2}
          style={{ flex: 1, resize: 'none', fontSize: 13, lineHeight: 1.5 }}
        />
        <button className="primary" onClick={sendMessage} disabled={loading || (!input.trim() && !files.length)}
          style={{ flexShrink: 0, height: 40, padding: '0 16px' }}>
          {loading ? '…' : 'Send'}
        </button>
      </div>
    </div>
  );
}
