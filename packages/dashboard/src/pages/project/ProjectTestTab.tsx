import { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Paperclip, AlertCircle, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { useProject } from './ProjectLayout';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | any[];
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

  const [debugReqHistory, setDebugReqHistory] = useState<any[]>([]);
  const [debugTraceHistory, setDebugTraceHistory] = useState<(any[] | null)[]>([]);
  const [debugResHistory, setDebugResHistory] = useState<(any | null)[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const reqPanelEndRef = useRef<HTMLDivElement>(null);
  const routerReqPanelEndRef = useRef<HTMLDivElement>(null);
  const routerResPanelEndRef = useRef<HTMLDivElement>(null);
  const resPanelEndRef = useRef<HTMLDivElement>(null);

  // Router Request: the entry that describes what was sent TO the routing model
  const routerRequestHistory = useMemo(() =>
    debugTraceHistory.map(trace => {
      if (!trace) return null;
      // Structural match: the "query" entry always has details.systemPrompt
      const reqLog = trace.find((t: any) => t.policy === 'llm' && t.details?.systemPrompt);
      return reqLog?.details ?? null;
    }), [debugTraceHistory]);

  // Router Response: all 'llm' entries that are NOT the query entry, in order
  const routerResponseHistory = useMemo(() =>
    debugTraceHistory.map(trace => {
      if (!trace) return null;
      // Exclude the "query" entries (they have systemPrompt in details)
      const resLogs = trace.filter((t: any) => t.policy === 'llm' && !t.details?.systemPrompt);
      if (resLogs.length === 0) return null;
      // Prefer the success entry (has parsedWeights), otherwise collect all outcomes
      const successLog = resLogs.find((t: any) => t.details?.parsedWeights);
      return successLog
        ? { outcome: 'success', ...successLog.details }
        : { outcome: 'failed', events: resLogs.map((t: any) => ({ message: t.message, details: t.details })) };
    }), [debugTraceHistory]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    reqPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugReqHistory]);

  useEffect(() => {
    routerReqPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [routerRequestHistory]);

  useEffect(() => {
    routerResPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [routerResponseHistory]);

  useEffect(() => {
    resPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [debugResHistory]);

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

    const payload = {
      model: project?.routingModelId || 'gpt-4o',
      messages: newMessages,
      stream: true,
    };

    const turnIndex = debugReqHistory.length;
    setDebugReqHistory(prev => [...prev, payload]);
    setDebugTraceHistory(prev => [...prev, null]);
    setDebugResHistory(prev => [...prev, null]);

    try {
      const t0 = performance.now();

      // Clean the API key from accidental whitespace and smart quotes that break HTTP headers
      const cleanKey = apiKey.trim().replace(/[\u2018\u2019\u201C\u201D"']/g, '');

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanKey}`
        },
        body: JSON.stringify(payload)
      });

      const contentType = res.headers.get('content-type') || '';
      const traceId = res.headers.get('x-localrouter-trace-id');

      if (traceId) {
        // Fetch the out-of-band trace using the admin JWT (project token is not valid for /api/ routes)
        const adminJwt = localStorage.getItem('lr_token');
        fetch(`/api/traces/${traceId}`, {
          headers: adminJwt ? { 'Authorization': `Bearer ${adminJwt}` } : {}
        })
          .then(r => r.json())
          .then(td => {
            if (td.trace) setDebugTraceHistory(prev => {
              const updated = [...prev];
              updated[turnIndex] = td.trace;
              return updated;
            });
          })
          .catch(e => console.warn('Failed to fetch trace:', e));
      }

      if (contentType.includes('application/json')) {
        // Fallback or non-streaming error
        const data = await res.json();
        const t1 = performance.now();
        setDebugResHistory(prev => {
          const updated = [...prev];
          updated[turnIndex] = { status: res.status, latencyMs: Math.round(t1 - t0), data };
          return updated;
        });

        if (!res.ok) {
          throw new Error(data.error?.message || data.error || `HTTP ${res.status}`);
        }

        const assistantMessage = data.choices?.[0]?.message;
        if (assistantMessage) {
          setMessages(prev => [...prev, assistantMessage]);
        } else {
          throw new Error('No message returned from API');
        }
      } else {
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const errData = await res.json();
            msg = errData.error?.message || msg;
          } catch { }
          throw new Error(msg);
        }

        // Prepare an empty assistant message slot
        const initialAssistantMessage: Message = { role: 'assistant', content: '' };
        setMessages(prev => [...prev, initialAssistantMessage]);

        if (!res.body) throw new Error('Response body is missing');

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let done = false;
        let finalContent = '';
        let usageInfo: any = null;

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
                    if (data.error) {
                      throw new Error(data.error);
                    }

                    // (Out-of-band trace fetching is handled before stream parsing)

                    // Extract delta
                    const deltaContent = data.choices?.[0]?.delta?.content || '';
                    if (deltaContent) {
                      finalContent += deltaContent;
                      // Update the last message
                      setMessages(prev => {
                        const updated = [...prev];
                        updated[updated.length - 1] = { role: 'assistant', content: finalContent };
                        return updated;
                      });
                    }

                    // Capture usage if present
                    if (data.usage && Object.keys(data.usage).length > 0) {
                      usageInfo = data.usage;
                    }
                  } catch (e) {
                    if (e instanceof Error && e.message !== "Unexpected end of JSON input") {
                      throw e; // re-throw actual errors parsed from SSE
                    }
                    console.warn('Failed to parse SSE line', line, e);
                  }
                }
              }
            }
          }
        }

        const t1 = performance.now();
        setDebugResHistory(prev => {
          const updated = [...prev];
          updated[turnIndex] = {
            status: res.status,
            latencyMs: Math.round(t1 - t0),
            data: { streamed: true, content_length: finalContent.length, usage: usageInfo, content: finalContent }
          };
          return updated;
        });
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error occurred');
    } finally {
      setLoading(false);
    }
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
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4, textTransform: 'capitalize' }}>
                  {msg.role}
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
            <button className="btn btn-primary" title="Send (Enter)" onClick={handleSend} disabled={loading || !input.trim() || !apiKey}>
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Right Column: Debug Sidebar ── */}
      <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>

        {/* Debug Header */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Debug Log</h3>
          {debugReqHistory.length > 0 && (
            <button
              onClick={() => { setDebugReqHistory([]); setDebugTraceHistory([]); setDebugResHistory([]); }}
              style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
            >
              Clear
            </button>
          )}
        </div>

        {/* 4 scrollable panels */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Panel: Request */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Request</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {debugReqHistory.length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>No request sent yet.</span>
              ) : debugReqHistory.map((req, i) => (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1}</div>
                  <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(req, null, 2)}
                  </pre>
                </div>
              ))}
              <div ref={reqPanelEndRef} />
            </div>
          </div>

          {/* Panel: Router Request */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border)' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Router Request</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {routerRequestHistory.filter(Boolean).length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {debugReqHistory.length === 0 ? 'No request sent yet.' : 'Awaiting routing...'}
                </span>
              ) : routerRequestHistory.map((req, i) => req && (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1}</div>
                  <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(req, null, 2)}
                  </pre>
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
              {routerResponseHistory.filter(Boolean).length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {debugReqHistory.length === 0 ? 'No request sent yet.' : 'Awaiting routing response...'}
                </span>
              ) : routerResponseHistory.map((res, i) => res && (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3 }}>#{i + 1}</div>
                  <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(res, null, 2)}
                  </pre>
                </div>
              ))}
              <div ref={routerResPanelEndRef} />
            </div>
          </div>

          {/* Panel: Response */}
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '5px 12px', background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600, letterSpacing: '0.05em' }}>Response</span>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 12px', background: 'var(--bg-base)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {debugResHistory.filter(Boolean).length === 0 ? (
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  {debugReqHistory.length === 0 ? 'No request sent yet.' : 'Awaiting response...'}
                </span>
              ) : debugResHistory.map((res, i) => res && (
                <div key={i}>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginBottom: 3, display: 'flex', justifyContent: 'space-between' }}>
                    <span>#{i + 1}</span>
                    {res.latencyMs && <span>{res.latencyMs}ms</span>}
                  </div>
                  <pre style={{ margin: 0, padding: 10, background: 'var(--bg-surface)', border: res.status >= 400 ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', overflowX: 'auto', color: res.status >= 400 ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                    {JSON.stringify(res.data, null, 2)}
                  </pre>
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
