import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Square, Paperclip, AlertCircle, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useProject } from './ProjectLayout';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | any[];
  thinking?: string;
  model?: string;
}

export function ProjectTestTab() {
  const { project } = useProject();
  const [apiKey, setApiKey] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are a helpful AI assistant.' }
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showKey, setShowKey] = useState(false);

  const [debugTraceHistory, setDebugTraceHistory] = useState<(any[] | null)[]>([]);

  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const routerReqPanelEndRef = useRef<HTMLDivElement>(null);
  const routerResPanelEndRef = useRef<HTMLDivElement>(null);
  const reqPanelEndRef = useRef<HTMLDivElement>(null);
  const resPanelEndRef = useRef<HTMLDivElement>(null);

  // Ogni pannello filtra le entry del trace per panel field
  const routerRequestHistory = useMemo(() =>
    debugTraceHistory.map(trace =>
      trace ? (trace as any[]).filter(t => t.panel === 'router-request') : null
    ), [debugTraceHistory]);

  const routerResponseHistory = useMemo(() =>
    debugTraceHistory.map(trace =>
      trace ? (trace as any[]).filter(t => t.panel === 'router-response') : null
    ), [debugTraceHistory]);

  const requestHistory = useMemo(() =>
    debugTraceHistory.map(trace =>
      trace ? (trace as any[]).filter(t => t.panel === 'request') : null
    ), [debugTraceHistory]);

  const responseHistory = useMemo(() =>
    debugTraceHistory.map(trace =>
      trace ? (trace as any[]).filter(t => t.panel === 'response') : null
    ), [debugTraceHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    routerReqPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [routerRequestHistory]);

  useEffect(() => {
    routerResPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [routerResponseHistory]);

  useEffect(() => {
    reqPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [requestHistory]);

  useEffect(() => {
    resPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [responseHistory]);

  // We no longer persist the API key per user request

  const matchedToken = useMemo(() => {
    if (!apiKey || !project?.tokens) return null;
    const snippet = apiKey.substring(0, 10);
    return project.tokens.find(t => t.tokenSnippet === snippet);
  }, [apiKey, project?.tokens]);

  async function handleSend() {
    if ((!input.trim() && !attachedImage) || !apiKey || loading) return;

    // Build user content array if there's an image, else string
    let userContent: any = input.trim();
    if (attachedImage) {
      userContent = [
        { type: 'text', text: input.trim() },
        { type: 'image_url', image_url: { url: attachedImage } }
      ];
    }

    const newMsg: Message = { role: 'user', content: userContent };
    const newMessages = [...messages, newMsg];
    setMessages(newMessages);
    setInput('');
    setAttachedImage(null);
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const payload = {
      model: project?.routingModelId || 'gpt-4o',
      messages: newMessages,
      stream: true,
    };

    const turnIndex = debugTraceHistory.length;
    // Inizializza il slot con array vuoto — si popola in real-time via SSE
    setDebugTraceHistory(prev => [...prev, []]);

    try {
      const t0 = performance.now();
      void t0;

      // Clean the API key from accidental whitespace and smart quotes that break HTTP headers
      const cleanKey = apiKey.trim().replace(/[\u2018\u2019\u201C\u201D"']/g, '');

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      if (!res.ok && !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }

      if (!res.body) throw new Error('Response body is missing');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      let finalContent = '';
      let thinkingAccum = '';
      let modelName = '';
      let assistantMessageAdded = false;

      while (!done) {
        const { value, done: readerDone } = await reader.read();
        done = readerDone;
        if (value) {
          const chunkStr = decoder.decode(value, { stream: true });
          const lines = chunkStr.split('\n');
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6).trim();
              if (dataStr === '[DONE]') continue;
              if (dataStr) {
                try {
                  const data = JSON.parse(dataStr);

                  // ── Evento trace in real-time ─────────────────────────────
                  if (data.type === 'trace') {
                    setDebugTraceHistory(prev => {
                      const updated = [...prev];
                      const current = (updated[turnIndex] as any[]) ?? [];
                      updated[turnIndex] = [...current, data.entry];
                      return updated;
                    });
                    continue;
                  }

                  // ── Routing completato (routing-only mode) ────────────────
                  if (data.type === 'result') {
                    continue;
                  }

                  // ── Errore dal service ────────────────────────────────────
                  if (data.type === 'error' || data.error) {
                    throw new Error(data.message || data.error?.message || data.error || 'Service error');
                  }

                  // ── Cattura modello ───────────────────────────────────────
                  if (data.model && !modelName) modelName = data.model as string;

                  // ── Thinking delta (extended thinking Anthropic) ──────────
                  const thinkingDelta: string | undefined = data.choices?.[0]?.delta?.thinking;
                  if (thinkingDelta) {
                    if (!assistantMessageAdded) {
                      setMessages(prev => [...prev, { role: 'assistant', content: '', thinking: '', model: modelName }]);
                      assistantMessageAdded = true;
                    }
                    thinkingAccum += thinkingDelta;
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1] as Message;
                      updated[updated.length - 1] = { ...last, thinking: thinkingAccum };
                      return updated;
                    });
                    continue;
                  }

                  // ── Delta model streaming (contenuto testo) ───────────────
                  const deltaContent = data.choices?.[0]?.delta?.content || '';
                  if (deltaContent) {
                    if (!assistantMessageAdded) {
                      setMessages(prev => [...prev, { role: 'assistant', content: '', ...(thinkingAccum ? { thinking: thinkingAccum } : {}), model: modelName }]);
                      assistantMessageAdded = true;
                    }
                    finalContent += deltaContent;
                    setMessages(prev => {
                      const updated = [...prev];
                      const last = updated[updated.length - 1] as Message;
                      updated[updated.length - 1] = { ...last, content: finalContent };
                      return updated;
                    });
                  }
                } catch (e) {
                  if (e instanceof Error && e.message !== 'Unexpected end of JSON input') {
                    throw e;
                  }
                  console.warn('Failed to parse SSE line', line, e);
                }
              }
            }
          }
        }
      }

    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Stop requested by user — not an error
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error occurred');
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  function handleStop() {
    abortControllerRef.current?.abort();
  }

  function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setError('Only image attachments are supported for vision models currently.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      setAttachedImage(event.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Reset input
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  if (!project) return null;

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 180px)', animation: 'fade-in 0.2s ease' }}>

      {/* ── Left Column: Chat Area ── */}
      <div className="card" style={{ flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>

        {/* Chat Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Test Chat</h3>
            <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Send test queries through the routing gateway.</p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Project Token:</span>
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <input
                  type={showKey ? "text" : "password"}
                  className="form-input"
                  style={{ width: 250, padding: '6px 36px 6px 10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                  placeholder="sk-lr-..."
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="new-password"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  style={{
                    position: 'absolute', right: 8, background: 'none', border: 'none',
                    color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4
                  }}
                  title={showKey ? "Hide Token" : "Show Token"}
                >
                  {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {/* Validation Feedback */}
            {apiKey && (
              matchedToken ? (
                <div style={{ fontSize: '0.75rem', color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <CheckCircle2 size={12} />
                  Recognized Token {matchedToken.labels?.length && matchedToken.labels.length > 0 ? `(${matchedToken.labels.join(', ')})` : ''}
                </div>
              ) : apiKey.length >= 10 ? (
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <AlertCircle size={12} />
                  Unrecognized Token
                </div>
              ) : null
            )}
          </div>
        </div>

        {/* Chat History */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {messages.length === 1 && messages[0]?.role === 'system' ? (
            <div className="empty-state" style={{ padding: '40px 0', margin: 'auto' }}>
              <p style={{ margin: 0 }}>No messages yet.</p>
              {!apiKey ? (
                <p style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--danger)' }}>Please enter a Project Token above to send a message.</p>
              ) : (
                <p style={{ fontSize: '0.8rem', marginTop: 4 }}>Type a message below to start testing.</p>
              )}
            </div>
          ) : (
            messages.filter(m => m.role !== 'system').map((msg, i) => (
              <div key={i} style={{
                alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                maxWidth: '85%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: msg.role === 'user' ? 'flex-end' : 'flex-start',
              }}>
                {/* Thinking block — only for assistant with thinking content */}
                {msg.role === 'assistant' && msg.thinking && (
                  <details style={{ marginBottom: 6, width: '100%' }}>
                    <summary style={{
                      cursor: 'pointer', fontSize: '0.75rem', color: 'var(--text-muted)',
                      userSelect: 'none', padding: '4px 10px',
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 5,
                    }}>
                      💭 Reasoning {loading && i === messages.filter(m => m.role !== 'system').length - 1 && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                    </summary>
                    <div style={{
                      marginTop: 4, padding: '10px 14px',
                      background: 'var(--bg-surface)', border: '1px solid var(--border)',
                      borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)',
                      fontStyle: 'italic', whiteSpace: 'pre-wrap', lineHeight: 1.55,
                    }}>
                      {msg.thinking}
                    </div>
                  </details>
                )}
                <div style={{
                  background: msg.role === 'user' ? 'var(--primary)' : 'var(--bg-elevated)',
                  color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                  padding: '10px 14px',
                  borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                  fontSize: '0.9rem',
                  lineHeight: 1.5,
                  whiteSpace: 'pre-wrap',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8
                }}>
                  {typeof msg.content === 'string' ? msg.content : (
                    <>
                      {msg.content.map((c, idx) => {
                        if (c.type === 'text') return <span key={idx}>{c.text}</span>;
                        if (c.type === 'image_url') return <img key={idx} src={c.image_url.url} alt="Attached" style={{ maxWidth: 200, borderRadius: 8 }} />;
                        return null;
                      })}
                    </>
                  )}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: 6 }}>
                  {msg.role}
                  {msg.role === 'assistant' && msg.model && (
                    <span style={{ textTransform: 'none', fontFamily: 'monospace', fontSize: '0.68rem', color: 'var(--text-muted)', opacity: 0.8 }}>
                      — {msg.model}
                    </span>
                  )}
                </div>
              </div>
            ))
          )}

          {loading && (
            <div style={{ alignSelf: 'flex-start', padding: '10px 14px', background: 'var(--bg-elevated)', borderRadius: '16px 16px 16px 4px', border: '1px solid var(--border)' }}>
              <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
            </div>
          )}

          {error && (
            <div style={{ alignSelf: 'center', background: 'rgba(239,68,68,0.1)', color: 'var(--danger)', padding: '8px 12px', borderRadius: 8, fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>
              <AlertCircle size={14} /> {error}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Chat Input */}
        <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
          {attachedImage && (
            <div style={{ marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div style={{ position: 'relative', display: 'inline-block' }}>
                <img src={attachedImage} alt="Attachment" style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }} />
                <button
                  className="btn-icon danger"
                  style={{ position: 'absolute', top: -6, right: -6, padding: 2, background: 'var(--bg-elevated)' }}
                  onClick={() => setAttachedImage(null)}
                >
                  <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>×</span>
                </button>
              </div>
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
            <input
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              ref={fileInputRef}
              onChange={handleFileAttach}
            />
            <button className="btn-icon" title="Attach image" onClick={() => fileInputRef.current?.click()}>
              <Paperclip size={18} />
            </button>
            <textarea
              className="form-input"
              rows={2}
              placeholder="Type a message..."
              style={{ flex: 1, resize: 'none', fontFamily: 'inherit' }}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
            />
            {loading ? (
              <button className="btn btn-danger" title="Stop generation" onClick={handleStop}>
                <Square size={16} />
              </button>
            ) : (
              <button className="btn btn-primary" title="Send (Enter)" onClick={handleSend} disabled={!input.trim() || !apiKey}>
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Right Column: Debug Sidebar ── */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>

        {/* Debug Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Debug Log</h3>
          {debugTraceHistory.length > 0 && (
            <button
              onClick={() => { setDebugTraceHistory([]); }}
              style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* 4 scrollable panels */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Panel: Router Request */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Router Request</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {debugTraceHistory.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No request sent yet.</span>
              ) : routerRequestHistory.map((entries, i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1} {loading && i === debugTraceHistory.length - 1 && '⏳'}</div>
                  {entries?.map((e: any, j: number) => (
                    <div key={j} style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--accent)', marginBottom: 2, fontWeight: 600 }}>{e.message}</div>
                      <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={routerReqPanelEndRef} />
            </div>
          </div>

          {/* Panel: Router Response */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Router Response</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {debugTraceHistory.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No request sent yet.</span>
              ) : routerResponseHistory.map((entries, i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1} {loading && i === debugTraceHistory.length - 1 && '⏳'}</div>
                  {entries?.map((e: any, j: number) => (
                    <div key={j} style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--accent)', marginBottom: 2, fontWeight: 600 }}>{e.message}</div>
                      <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={routerResPanelEndRef} />
            </div>
          </div>

          {/* Panel: Request */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Request</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {debugTraceHistory.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No request sent yet.</span>
              ) : requestHistory.map((entries, i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1} {loading && i === debugTraceHistory.length - 1 && '⏳'}</div>
                  {entries?.length === 0 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No model calls (routing only)</span>}
                  {entries?.map((e: any, j: number) => (
                    <div key={j} style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: '0.6rem', color: 'var(--accent)', marginBottom: 2, fontWeight: 600 }}>{e.message}</div>
                      <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                        {JSON.stringify(e.details, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ))}
              <div ref={reqPanelEndRef} />
            </div>
          </div>

          {/* Panel: Response */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Response</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {debugTraceHistory.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No request sent yet.</span>
              ) : responseHistory.map((entries, i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1} {loading && i === debugTraceHistory.length - 1 && '⏳'}</div>
                  {entries?.length === 0 && <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No model calls (routing only)</span>}
                  {entries?.map((e: any, j: number) => {
                    const isError = e.message === 'model:error';
                    const isThinking = e.message === 'model:thinking';
                    const labelColor = isError ? 'var(--danger)' : isThinking ? '#a78bfa' : 'var(--accent)';
                    return (
                      <div key={j} style={{ marginBottom: 4 }}>
                        <div style={{ fontSize: '0.6rem', color: labelColor, marginBottom: 2, fontWeight: 600 }}>{e.message}</div>
                        {isThinking ? (
                          <details>
                            <summary style={{ fontSize: '0.68rem', color: 'var(--text-muted)', cursor: 'pointer', userSelect: 'none' }}>
                              {String(e.details?.text ?? '').substring(0, 80)}{String(e.details?.text ?? '').length > 80 ? '…' : ''}
                            </summary>
                            <pre style={{ margin: '4px 0 0', padding: 10, background: 'var(--bg-surface)', border: '1px solid rgba(167,139,250,0.3)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                              {String(e.details?.text ?? '')}
                            </pre>
                          </details>
                        ) : (
                          <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: isError ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: isError ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                            {JSON.stringify(e.details, null, 2)}
                          </pre>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
              <div ref={resPanelEndRef} />
            </div>
          </div>

        </div>
      </div>

    </div>
  );
}
