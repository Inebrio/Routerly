import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Send, Square, Paperclip, AlertCircle, Eye, EyeOff, CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';
import { getProjects, type Project } from '../api';
import { TraceEntryRenderer } from '../components/TraceEntryRenderer';
import { MessageStatsCard } from '../components/MessageStatsCard';
import { extractMessageStats } from '../utils/traceUtils';

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | any[];
  thinking?: string;
  model?: string;
}

export function TestPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [input, setInput] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'You are a helpful AI assistant.' },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [showKey, setShowKey] = useState(false);
  const [debugTraceHistory, setDebugTraceHistory] = useState<(any[] | null)[]>([]);
  const [showDebugSidebar, setShowDebugSidebar] = useState(true);
  const abortControllerRef = useRef<AbortController | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const debugPanelEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getProjects().then(setProjects).catch(console.error);
  }, []);

  const { matchedProject, matchedToken } = useMemo(() => {
    if (!apiKey || apiKey.length < 10) return { matchedProject: null, matchedToken: null };
    const snippet = apiKey.trim().substring(0, 10);
    for (const p of projects) {
      const t = p.tokens?.find(tk => tk.tokenSnippet === snippet);
      if (t) return { matchedProject: p, matchedToken: t };
    }
    return { matchedProject: null, matchedToken: null };
  }, [apiKey, projects]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { debugPanelEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [debugTraceHistory]);

  async function handleSend() {
    if ((!input.trim() && !attachedImage) || !apiKey || loading) return;

    let userContent: any = input.trim();
    if (attachedImage) {
      userContent = [
        { type: 'text', text: input.trim() },
        { type: 'image_url', image_url: { url: attachedImage } },
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
      model: matchedProject?.routingModelId || matchedProject?.models?.[0]?.modelId || '',
      messages: newMessages,
      stream: true,
    };

    const turnIndex = debugTraceHistory.length;
    setDebugTraceHistory(prev => [...prev, []]);

    try {
      const cleanKey = apiKey.trim().replace(/[\u2018\u2019\u201C\u201D"']/g, '');

      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${cleanKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!res.ok && !res.body) throw new Error(`HTTP ${res.status}`);
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

                  if (data.type === 'trace') {
                    setDebugTraceHistory(prev => {
                      const updated = [...prev];
                      const current = (updated[turnIndex] as any[]) ?? [];
                      updated[turnIndex] = [...current, data.entry];
                      return updated;
                    });
                    continue;
                  }

                  if (data.type === 'result') continue;

                  if (data.type === 'error' || data.error) {
                    throw new Error(data.message || data.error?.message || data.error || 'Service error');
                  }

                  if (data.model && !modelName) modelName = data.model as string;

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
                  if (e instanceof Error && e.message !== 'Unexpected end of JSON input') throw e;
                  console.warn('Failed to parse SSE line', line, e);
                }
              }
            }
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        // Stop richiesto dall'utente
      } else {
        setError(e instanceof Error ? e.message : 'Unknown error occurred');
      }
    } finally {
      abortControllerRef.current = null;
      setLoading(false);
    }
  }

  function handleStop() { abortControllerRef.current?.abort(); }

  function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Only image attachments are supported for vision models currently.');
      return;
    }
    const reader = new FileReader();
    reader.onload = (event) => { setAttachedImage(event.target?.result as string); };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', animation: 'fade-in 0.2s ease' }}>

      {/* ── Page Header ── */}
      <div className="page-header" style={{ paddingBottom: 20, flexShrink: 0 }}>
        <h1 style={{ margin: 0 }}>Test</h1>
        <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
          Invia richieste di test attraverso il gateway di routing.
        </p>
      </div>

      {/* ── Body ── */}
      <div style={{ display: 'flex', gap: 24, flex: 1, minHeight: 0, padding: '0 32px 24px' }}>

          {/* ── Left Column: Chat Area ── */}
          <div className="card" style={{ flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>

            {/* Chat Header */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Test Chat</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Invia query di test attraverso il gateway.</p>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Project Token:</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="form-input"
                    style={{ width: 270, padding: '6px 36px 6px 10px', fontSize: '0.85rem', fontFamily: 'monospace' }}
                    placeholder="sk-rt-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{ position: 'absolute', right: 8, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', padding: 4 }}
                    title={showKey ? 'Hide Token' : 'Show Token'}
                  >
                    {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
                </div>
                {/* Token feedback */}
                {apiKey.length >= 10 && (
                  matchedProject ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: '#10b981' }}>
                      <CheckCircle2 size={13} />
                      <span>
                        <strong>{matchedProject.name}</strong>
                        {matchedToken?.labels && matchedToken.labels.length > 0 && (
                          <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>({matchedToken.labels.join(', ')})</span>
                        )}
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.78rem', color: '#f59e0b' }}>
                      <AlertCircle size={13} />
                      Token non riconosciuto
                    </div>
                  )
                )}
              </div>
            </div>

            {/* Chat History */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
              {messages.length === 1 && messages[0]?.role === 'system' ? (
                <div className="empty-state" style={{ padding: '40px 0', margin: 'auto' }}>
                  <p style={{ margin: 0 }}>No messages yet.</p>
                  {!apiKey ? (
                    <p style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--text-secondary)' }}>ℹ Please enter a Project Token above to send a message.</p>
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
                      ...(msg.role === 'user' ? { whiteSpace: 'pre-wrap' as const, display: 'flex' as const, flexDirection: 'column' as const, gap: 8 } : {}),
                    }}>
                      {msg.role === 'assistant' ? (
                        typeof msg.content === 'string'
                          ? <div className="md-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown></div>
                          : <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                              {(msg.content as any[]).map((c, idx) => {
                                if (c.type === 'text') return <div key={idx} className="md-content"><ReactMarkdown remarkPlugins={[remarkGfm]}>{c.text}</ReactMarkdown></div>;
                                if (c.type === 'image_url') return <img key={idx} src={c.image_url.url} alt="Attached" style={{ maxWidth: 200, borderRadius: 8 }} />;
                                return null;
                              })}
                            </div>
                      ) : (
                        typeof msg.content === 'string' ? msg.content : (
                          <>
                            {(msg.content as any[]).map((c, idx) => {
                              if (c.type === 'text') return <span key={idx}>{c.text}</span>;
                              if (c.type === 'image_url') return <img key={idx} src={c.image_url.url} alt="Attached" style={{ maxWidth: 200, borderRadius: 8 }} />;
                              return null;
                            })}
                          </>
                        )
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
                <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileAttach} />
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
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
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
          {showDebugSidebar && (
            <div className="card" style={{ width: 420, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Debug</h3>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  {debugTraceHistory.length > 0 && (
                    <button
                      onClick={() => setDebugTraceHistory([])}
                      style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => setShowDebugSidebar(false)}
                    className="btn-icon"
                    style={{ padding: 4 }}
                    title="Hide debug sidebar"
                  >
                    <ChevronRight size={16} />
                  </button>
                </div>
              </div>

              <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: 'var(--bg-base)' }}>
                {debugTraceHistory.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)' }}>
                    <p style={{ margin: 0, fontSize: '0.85rem' }}>No debug data yet.</p>
                    <p style={{ margin: '8px 0 0', fontSize: '0.75rem' }}>Send a message to see routing and model details.</p>
                  </div>
                ) : (
                  debugTraceHistory.map((traces, i) => {
                    if (!traces) return null;
                    const stats = extractMessageStats(traces);
                    return (
                      <div key={i} style={{ marginBottom: 16 }}>
                        <MessageStatsCard stats={stats} turnNumber={i + 1} />
                        
                        {/* Technical Details - Collapsible */}
                        <details style={{ marginTop: 8 }}>
                          <summary style={{
                            cursor: 'pointer',
                            fontSize: '0.8rem',
                            color: 'var(--text-muted)',
                            padding: '8px 12px',
                            background: 'var(--bg-elevated)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            userSelect: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                          }}>
                            🔧 Technical Details
                          </summary>
                          <div style={{
                            marginTop: 8,
                            padding: 12,
                            background: 'var(--bg-surface)',
                            border: '1px solid var(--border)',
                            borderRadius: 6,
                            fontSize: '0.85rem',
                          }}>
                            {traces.map((entry, j) => (
                              <div key={j} style={{ marginBottom: j < traces.length - 1 ? 12 : 0 }}>
                                <TraceEntryRenderer entry={entry} />
                              </div>
                            ))}
                          </div>
                        </details>
                      </div>
                    );
                  })
                )}
                <div ref={debugPanelEndRef} />
              </div>
            </div>
          )}

          {/* Toggle button when sidebar is collapsed */}
          {!showDebugSidebar && (
            <button
              onClick={() => setShowDebugSidebar(true)}
              className="btn-icon"
              style={{
                position: 'fixed',
                right: 24,
                top: '50%',
                transform: 'translateY(-50%)',
                padding: 8,
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
              }}
              title="Show debug sidebar"
            >
              <ChevronLeft size={20} />
            </button>
          )}

      </div>
    </div>
  );
}
