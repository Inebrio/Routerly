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

  const [debugReq, setDebugReq] = useState<any>(null);
  const [debugRes, setDebugRes] = useState<any>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      model: project?.routingModelId || 'gpt-4o', // Gateway will route it
      messages: newMessages,
      stream: false,
    };

    setDebugReq(payload);
    setDebugRes(null);

    try {
      const t0 = performance.now();
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify(payload)
      });
      const t1 = performance.now();

      const data = await res.json();
      setDebugRes({ status: res.status, latencyMs: Math.round(t1 - t0), data });

      if (!res.ok) {
        throw new Error(data.error?.message || `HTTP ${res.status}`);
      }

      const assistantMessage = data.choices?.[0]?.message;
      if (assistantMessage) {
        setMessages(prev => [...prev, assistantMessage]);
      } else {
        throw new Error('No message returned from API');
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
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Debug Log</h3>
        </div>

        {/* Debug Content */}
        <div style={{ flex: 1, overflowY: 'auto', padding: 20, background: 'var(--bg-base)' }}>
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                Latest Request
              </div>
            </div>
            <pre style={{ margin: 0, padding: 12, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', overflowX: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {debugReq ? JSON.stringify(debugReq, null, 2) : 'No request sent yet.'}
            </pre>
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', fontWeight: 600 }}>
                Latest Response
              </div>
              {debugRes?.latencyMs && (
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {debugRes.latencyMs}ms
                </div>
              )}
            </div>
            <pre style={{ margin: 0, padding: 12, background: 'var(--bg-surface)', border: debugRes?.status >= 400 ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)', borderRadius: 'var(--radius-sm)', fontSize: '0.75rem', overflowX: 'auto', color: debugRes?.status >= 400 ? 'var(--danger)' : 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
              {debugRes ? JSON.stringify(debugRes.data, null, 2) : 'Awaiting response...'}
            </pre>
          </div>
        </div>
      </div>

    </div>
  );
}
