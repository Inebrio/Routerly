import { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Send, Square, Paperclip, AlertCircle, Eye, EyeOff, CheckCircle2,
  ChevronLeft, ChevronRight, Code, Trash2, Save, BookOpen,
  SplitSquareHorizontal, MessageSquare,
} from 'lucide-react';
import { getProjects, getPlaygroundPresets, createPlaygroundPreset, deletePlaygroundPreset, getTrace, type Project, type PlaygroundPreset, type TraceEntry } from '../api.js';
import { TraceEntryRenderer } from '../components/TraceEntryRenderer.js';
import { MessageStatsCard } from '../components/MessageStatsCard.js';
import { extractMessageStats } from '../utils/traceUtils.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GuardrailBlock {
  rule: string;
  target: string;
  action: string;
  fallbackMessage?: string;
}

interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string | ContentPart[];
  thinking?: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs?: number;
  rawJson?: string;
  blocked?: GuardrailBlock;
}

interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

type Mode = 'single' | 'compare';

// ── Helpers ───────────────────────────────────────────────────────────────────

function costEstimate(input: number, output: number): string {
  // ponytail: generic pricing; no per-model lookup needed here
  return `~$${((input * 0.000005) + (output * 0.000015)).toFixed(4)}`;
}

function MdContent({ children }: { children: string }) {
  return (
    <div className="md-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{children}</ReactMarkdown>
    </div>
  );
}

function ParamSlider({ label, value, min, max, step, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
      {label}
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(parseFloat(e.target.value))}
        style={{ width: 80, accentColor: 'var(--primary)' }}
      />
      <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', minWidth: 36 }}>{value}</span>
    </label>
  );
}

// ── Compare panel ─────────────────────────────────────────────────────────────

function ComparePanel({
  apiKey, apiKeyB, systemPrompt, temperature, maxTokens, topP, availableModels,
  compareModelA, compareModelB, setCompareModelA, setCompareModelB,
}: {
  apiKey: string; apiKeyB: string; systemPrompt: string; temperature: number; maxTokens: number; topP: number;
  availableModels: Array<{ modelId: string }>;
  compareModelA: string; compareModelB: string;
  setCompareModelA: (v: string) => void; setCompareModelB: (v: string) => void;
}) {
  const [messagesA, setMessagesA] = useState<Message[]>([]);
  const [messagesB, setMessagesB] = useState<Message[]>([]);
  const [loadingA, setLoadingA] = useState(false);
  const [loadingB, setLoadingB] = useState(false);
  const [errorA, setErrorA] = useState<string | null>(null);
  const [errorB, setErrorB] = useState<string | null>(null);
  const [compareInput, setCompareInput] = useState('');
  const abortARef = useRef<AbortController | null>(null);
  const abortBRef = useRef<AbortController | null>(null);

  async function sendToModel(
    modelId: string,
    content: string,
    prevMsgs: Message[],
    setMsgs: React.Dispatch<React.SetStateAction<Message[]>>,
    setLoading: (v: boolean) => void,
    setError: (v: string | null) => void,
    abortRef: React.MutableRefObject<AbortController | null>,
    key: string,
  ) {
    if (!key) return;
    setLoading(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const startMs = Date.now();
    let finalContent = '';
    let modelName = '';
    let assistantAdded = false;
    let inputTokens = 0;
    let outputTokens = 0;

    const sysMsgs = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : [];
    const payload = {
      model: modelId,
      messages: [...sysMsgs, ...prevMsgs.filter(m => m.role !== 'system'), { role: 'user' as const, content }],
      stream: true, temperature, max_tokens: maxTokens, top_p: topP,
    };

    try {
      const cleanKey = key.trim().replace(/[''"""']/g, '');
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cleanKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.text();
        let msg = `HTTP ${res.status}`;
        try { const json = JSON.parse(body) as { error?: { message?: string } }; if (json.error?.message) msg = json.error.message; } catch {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // ponytail: buffer incomplete SSE lines across TCP reads (cross-chunk fix)
      let buffer = '';
      function processLine(line: string) {
        if (!line.startsWith('data: ')) return;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]' || !dataStr) return;
        try {
          const data = JSON.parse(dataStr);
          if (data.type === 'trace' || data.type === 'result') return;
          if (data.type === 'error' || data.error) throw new Error(data.message || 'Service error');
          if (data.model && !modelName) modelName = data.model as string;
          if (data.usage) {
            inputTokens = data.usage.prompt_tokens ?? inputTokens;
            outputTokens = data.usage.completion_tokens ?? outputTokens;
          }
          const delta: string = data.choices?.[0]?.delta?.content || '';
          if (delta) {
            if (!assistantAdded) {
              setMsgs(prev => [...prev, { role: 'assistant', content: '', model: modelName }]);
              assistantAdded = true;
            }
            finalContent += delta;
            setMsgs(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1]!, content: finalContent }; return u; });
          }
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(line);
      }
      // flush any complete trailing line after stream close
      const tail = buffer.trim();
      if (tail) processLine(tail);
      const latencyMs = Date.now() - startMs;
      setMsgs(prev => { const u = [...prev]; if (assistantAdded) u[u.length - 1] = { ...u[u.length - 1]!, inputTokens, outputTokens, latencyMs }; return u; });
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message);
        setMsgs(prev => prev.slice(0, -1));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function handleSend() {
    if (!compareInput.trim() || !apiKey) return;
    const content = compareInput.trim();
    setCompareInput('');
    const userMsg: Message = { role: 'user', content };
    setMessagesA(prev => [...prev, userMsg]);
    setMessagesB(prev => [...prev, userMsg]);
    const keyB = apiKeyB.trim() || apiKey; // ponytail: fall back to apiKey if apiKeyB empty
    sendToModel(compareModelA, content, messagesA, setMessagesA, setLoadingA, setErrorA, abortARef, apiKey);
    sendToModel(compareModelB, content, messagesB, setMessagesB, setLoadingB, setErrorB, abortBRef, keyB);
  }

  const cols = [
    { label: 'A', model: compareModelA, setModel: setCompareModelA, msgs: messagesA, loading: loadingA, error: errorA, abortRef: abortARef },
    { label: 'B', model: compareModelB, setModel: setCompareModelB, msgs: messagesB, loading: loadingB, error: errorB, abortRef: abortBRef },
  ];

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div style={{ display: 'flex', gap: 12, minHeight: 0, flex: 1 }}>
        {cols.map(({ label, model, setModel, msgs, loading: colLoading, error: colError, abortRef }) => {
          const display = msgs.filter(m => m.role !== 'system');
          return (
            <div key={label} className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
              <div style={{ padding: '8px 14px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-secondary)' }}>Model {label}:</span>
                <select className="form-input" style={{ flex: 1, padding: '4px 8px', fontSize: '0.78rem' }} value={model} onChange={e => setModel(e.target.value)}>
                  <option value="">Select model...</option>
                  {availableModels.map(m => <option key={m.modelId} value={m.modelId}>{m.modelId}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                {display.length === 0 ? (
                  <p style={{ margin: 'auto', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>No messages yet.</p>
                ) : (
                  display.map((msg, i) => {
                    const isAssistant = msg.role === 'assistant';
                    return (
                      <div key={i} style={{ alignSelf: isAssistant ? 'flex-start' : 'flex-end', maxWidth: '90%', display: 'flex', flexDirection: 'column', alignItems: isAssistant ? 'flex-start' : 'flex-end' }}>
                        <div style={{
                          background: isAssistant ? 'var(--bg-elevated)' : 'var(--primary)',
                          color: isAssistant ? 'var(--text-primary)' : '#fff',
                          padding: '8px 12px',
                          borderRadius: isAssistant ? '14px 14px 14px 4px' : '14px 14px 4px 14px',
                          border: isAssistant ? '1px solid var(--border)' : 'none',
                          fontSize: '0.88rem', lineHeight: 1.5,
                        }}>
                          {isAssistant
                            ? <MdContent>{typeof msg.content === 'string' ? msg.content : ''}</MdContent>
                            : <span style={{ whiteSpace: 'pre-wrap' }}>{typeof msg.content === 'string' ? msg.content : ''}</span>
                          }
                        </div>
                        {isAssistant && (
                          <div style={{ display: 'flex', gap: 6, marginTop: 3, fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                            {msg.latencyMs ? <span>{msg.latencyMs}ms</span> : null}
                            {(msg.inputTokens || msg.outputTokens) ? (
                              <span style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px', fontFamily: 'monospace' }}>
                                {(msg.inputTokens ?? 0) + (msg.outputTokens ?? 0)} tok | {costEstimate(msg.inputTokens ?? 0, msg.outputTokens ?? 0)}
                              </span>
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
                {colLoading && (
                  <div style={{ alignSelf: 'flex-start', padding: '8px 12px', background: 'var(--bg-elevated)', borderRadius: '14px 14px 14px 4px', border: '1px solid var(--border)' }}>
                    <span className="spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />
                  </div>
                )}
                {colError && (
                  <div style={{ fontSize: '0.78rem', color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <AlertCircle size={12} /> {colError}
                  </div>
                )}
              </div>
              {colLoading && (
                <div style={{ padding: '6px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'center' }}>
                  <button className="btn btn-danger" style={{ fontSize: '0.75rem', padding: '3px 8px', display: 'flex', gap: 4, alignItems: 'center' }} onClick={() => abortRef.current?.abort()}>
                    <Square size={11} /> Stop
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
        <textarea
          className="form-input"
          rows={2}
          placeholder="Send the same message to both models..."
          style={{ flex: 1, resize: 'none', fontFamily: 'inherit' }}
          value={compareInput}
          onChange={e => setCompareInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
        />
        <button className="btn btn-primary" onClick={handleSend} disabled={!compareInput.trim() || !apiKey || loadingA || loadingB}>
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function TestPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [mode, setMode] = useState<Mode>('single');

  // Single mode
  const [systemPromptOpen, setSystemPromptOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState('You are a helpful AI assistant.');
  const [selectedModelId, setSelectedModelId] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [topP, setTopP] = useState(1);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState<Record<number, boolean>>({});
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const debugEndRef = useRef<HTMLDivElement>(null);
  const [debugTraceHistory, setDebugTraceHistory] = useState<(unknown[] | null)[]>([]);
  const [showDebugSidebar, setShowDebugSidebar] = useState(true);

  // Compare mode
  const [compareModelA, setCompareModelA] = useState('');
  const [compareModelB, setCompareModelB] = useState('');
  const [apiKeyB, setApiKeyB] = useState('');
  const [showKeyB, setShowKeyB] = useState(false);

  // Presets
  const [showPresetsPanel, setShowPresetsPanel] = useState(false);
  const [presets, setPresets] = useState<PlaygroundPreset[]>([]);
  const [presetsLoading, setPresetsLoading] = useState(false);
  const [savePresetName, setSavePresetName] = useState('');
  const [showSaveForm, setShowSaveForm] = useState(false);

  const { matchedProject, matchedToken } = useMemo(() => {
    if (!apiKey || apiKey.length < 10) return { matchedProject: null, matchedToken: null };
    const snippet = apiKey.trim().substring(0, 10);
    for (const p of projects) {
      const t = p.tokens?.find(tk => tk.tokenSnippet === snippet);
      if (t) return { matchedProject: p, matchedToken: t };
    }
    return { matchedProject: null, matchedToken: null };
  }, [apiKey, projects]);

  const availableModels = useMemo(() => matchedProject?.models ?? [], [matchedProject]);

  useEffect(() => { getProjects().then(setProjects).catch(console.error); }, []);

  useEffect(() => {
    if (!matchedProject) { setPresets([]); return; }
    setPresetsLoading(true);
    getPlaygroundPresets(matchedProject.id)
      .then(setPresets)
      .catch(() => setPresets([]))
      .finally(() => setPresetsLoading(false));
  }, [matchedProject?.id]);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, loading]);
  useEffect(() => { debugEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [debugTraceHistory]);

  // ── Send ───────────────────────────────────────────────────────────────────

  async function handleSend() {
    if ((!input.trim() && !attachedImage) || !apiKey || loading) return;

    let userContent: string | ContentPart[] = input.trim();
    if (attachedImage) {
      userContent = [
        { type: 'text', text: input.trim() },
        { type: 'image_url', image_url: { url: attachedImage } },
      ];
    }

    const newMessages = [...messages, { role: 'user' as const, content: userContent }];
    setMessages(newMessages);
    setInput('');
    setAttachedImage(null);
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    abortRef.current = controller;
    const turnIndex = debugTraceHistory.length;
    setDebugTraceHistory(prev => [...prev, []]);

    const sysMsgs = systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : [];
    const modelToUse = selectedModelId || matchedProject?.routingModelId || matchedProject?.models?.[0]?.modelId || '';

    const payload = {
      model: modelToUse,
      messages: [...sysMsgs, ...newMessages],
      stream: true, temperature, max_tokens: maxTokens, top_p: topP,
    };

    let finalContent = '';
    let thinkingAccum = '';
    let modelName = '';
    let assistantAdded = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let finishReason = '';
    let stopReason = '';
    const rawChunks: string[] = [];
    const startMs = Date.now();

    try {
      const cleanKey = apiKey.trim().replace(/[''"""']/g, '');
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cleanKey}` },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      // Capture trace ID for post-stream trace fetch
      const traceId = res.headers.get('x-routerly-trace-id');

      if (!res.ok || !res.body) {
        const body = await res.text();
        let msg = `HTTP ${res.status}`;
        try { const json = JSON.parse(body) as { error?: { message?: string } }; if (json.error?.message) msg = json.error.message; } catch {}
        throw new Error(msg);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      // ponytail: buffer incomplete SSE lines across TCP reads (cross-chunk fix)
      let buffer = '';
      function processLine(line: string) {
        if (!line.startsWith('data: ')) return;
        const dataStr = line.slice(6).trim();
        if (dataStr === '[DONE]' || !dataStr) return;
        try {
          const data = JSON.parse(dataStr);
          if (data.type === 'trace') {
            setDebugTraceHistory(prev => {
              const u = [...prev];
              const cur = (u[turnIndex] as unknown[]) ?? [];
              u[turnIndex] = [...cur, data.entry];
              return u;
            });
            return;
          }
          if (data.type === 'result') return;
          if (data.type === 'error' || data.error) throw new Error(data.message || data.error?.message || 'Service error');
          if (data.model && !modelName) modelName = data.model as string;
          if (data.usage) {
            inputTokens = data.usage.prompt_tokens ?? inputTokens;
            outputTokens = data.usage.completion_tokens ?? outputTokens;
          }
          rawChunks.push(dataStr);

          // Track finish/stop reason for block detection
          const fr: string | undefined = data.choices?.[0]?.finish_reason;
          if (fr) finishReason = fr;
          const sr: string | undefined = data.stop_reason;
          if (sr) stopReason = sr;

          const thinking: string | undefined = data.choices?.[0]?.delta?.thinking;
          if (thinking) {
            if (!assistantAdded) { setMessages(prev => [...prev, { role: 'assistant', content: '', thinking: '', model: modelName }]); assistantAdded = true; }
            thinkingAccum += thinking;
            setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1]!, thinking: thinkingAccum }; return u; });
            return;
          }
          const delta: string = data.choices?.[0]?.delta?.content || '';
          if (delta) {
            if (!assistantAdded) { setMessages(prev => [...prev, { role: 'assistant', content: '', model: modelName }]); assistantAdded = true; }
            finalContent += delta;
            setMessages(prev => { const u = [...prev]; u[u.length - 1] = { ...u[u.length - 1]!, content: finalContent }; return u; });
          }
        } catch (e) {
          if (!(e instanceof SyntaxError)) throw e;
        }
      }
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) processLine(line);
      }
      // flush any complete trailing line after stream close
      const tail = buffer.trim();
      if (tail) processLine(tail);

      const latencyMs = Date.now() - startMs;
      const isBlocked = finishReason === 'content_filter' || stopReason === 'refusal';

      // Fetch full trace from API (SSE trace events may be incomplete; the stored trace is authoritative)
      let traceEntries: TraceEntry[] = [];
      if (traceId) {
        try {
          const traceData = await getTrace(traceId);
          traceEntries = traceData.trace;
          // Merge trace entries into debug sidebar (replace SSE-collected entries with full trace)
          setDebugTraceHistory(prev => {
            const u = [...prev];
            u[turnIndex] = traceEntries;
            return u;
          });
        } catch {
          // Trace fetch failed — keep SSE-collected entries
        }
      }

      // Extract guardrail block info from trace
      let blocked: GuardrailBlock | undefined;
      if (isBlocked) {
        const guardEntry = traceEntries.find(e => e.message === 'guardrail:triggered' || e.message === 'guardrail:response-triggered');
        if (guardEntry?.details) {
          const fm = guardEntry.details.fallbackMessage ? String(guardEntry.details.fallbackMessage) : undefined;
          blocked = {
            rule: String(guardEntry.details.rule ?? '—'),
            target: String(guardEntry.details.target ?? '—'),
            action: String(guardEntry.details.action ?? 'block'),
            ...(fm ? { fallbackMessage: fm } : {}),
          };
        } else {
          // No trace entry found — still mark as blocked with minimal info
          blocked = { rule: '—', target: '—', action: 'block' };
        }
      }

      const fullMsg: Message = {
        role: 'assistant', content: finalContent, model: modelName,
        inputTokens, outputTokens, latencyMs,
        rawJson: rawChunks.join('\n'),
        ...(thinkingAccum ? { thinking: thinkingAccum } : {}),
        ...(blocked ? { blocked } : {}),
      };
      setMessages(prev => { const u = [...prev]; if (assistantAdded) u[u.length - 1] = fullMsg; else u.push(fullMsg); return u; });
    } catch (e) {
      if (e instanceof Error && e.name !== 'AbortError') {
        setError(e.message);
        setMessages(prev => prev.slice(0, -1));
      }
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  function handleStop() { abortRef.current?.abort(); }

  function handleFileAttach(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError('Only image attachments are supported.'); return; }
    const reader = new FileReader();
    reader.onload = ev => setAttachedImage(ev.target?.result as string);
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  // ── Presets ────────────────────────────────────────────────────────────────

  function loadPreset(preset: PlaygroundPreset) {
    setSystemPrompt(preset.systemPrompt);
    setSystemPromptOpen(true);
    if (preset.messages) {
      setMessages(preset.messages.map(m => ({ role: m.role, content: m.content })));
    } else {
      setMessages([]);
    }
    setShowPresetsPanel(false);
  }

  async function savePreset() {
    if (!matchedProject || !savePresetName.trim()) return;
    const convoMsgs = messages
      .filter(m => m.role !== 'system' && typeof m.content === 'string')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content as string }));
    try {
      const presetData: { name: string; systemPrompt: string; messages?: Array<{ role: 'user' | 'assistant'; content: string }> } = {
        name: savePresetName.trim(),
        systemPrompt,
      };
      if (convoMsgs.length > 0) presetData.messages = convoMsgs;
      const created = await createPlaygroundPreset(matchedProject.id, presetData);
      setPresets(prev => [...prev, created]);
      setSavePresetName('');
      setShowSaveForm(false);
    } catch (e) { console.error('Failed to save preset', e); }
  }

  async function deletePreset(presetId: string) {
    if (!matchedProject) return;
    try {
      await deletePlaygroundPreset(matchedProject.id, presetId);
      setPresets(prev => prev.filter(p => p.id !== presetId));
    } catch (e) { console.error('Failed to delete preset', e); }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const displayMessages = messages.filter(m => m.role !== 'system');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 48px)', animation: 'fade-in 0.2s ease' }}>

      {/* Header */}
      <div className="page-header" style={{ paddingBottom: 16, flexShrink: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ margin: 0 }}>Playground</h1>
            <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
              Test models, compare responses, and save prompt presets.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {/* Mode toggle */}
            <div style={{ display: 'flex', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {(['single', 'compare'] as Mode[]).map(m => (
                <button key={m} onClick={() => setMode(m)} style={{
                  padding: '6px 14px', border: 'none', cursor: 'pointer', fontSize: '0.8rem',
                  background: mode === m ? 'var(--primary)' : 'var(--bg-surface)',
                  color: mode === m ? '#fff' : 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', gap: 5,
                }}>
                  {m === 'single' ? <MessageSquare size={13} /> : <SplitSquareHorizontal size={13} />}
                  {m === 'single' ? 'Single' : 'Compare'}
                </button>
              ))}
            </div>

            {/* Token input(s) */}
            {mode === 'compare' ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                {([
                  { label: 'Token A', value: apiKey, set: setApiKey, show: showKey, setShow: setShowKey },
                  { label: 'Token B', value: apiKeyB, set: setApiKeyB, show: showKeyB, setShow: setShowKeyB },
                ] as const).map(({ label, value, set, show, setShow }) => (
                  <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{label}:</span>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type={show ? 'text' : 'password'}
                        className="form-input"
                        style={{ width: 180, padding: '5px 32px 5px 10px', fontSize: '0.82rem', fontFamily: 'monospace' }}
                        placeholder={label === 'Token B' ? 'same as A' : 'sk-rt-...'}
                        value={value}
                        onChange={e => set(e.target.value)}
                        autoComplete="new-password"
                      />
                      <button type="button" onClick={() => setShow(!show)}
                        style={{ position: 'absolute', right: 6, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
                        {show ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                    </div>
                  </div>
                ))}
                {apiKey.length >= 10 && (
                  matchedProject ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#10b981' }}>
                      <CheckCircle2 size={12} /> {matchedProject.name}
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#f59e0b' }}>
                      <AlertCircle size={12} /> Unknown token
                    </span>
                  )
                )}
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Token:</span>
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                  <input
                    type={showKey ? 'text' : 'password'}
                    className="form-input"
                    style={{ width: 220, padding: '5px 32px 5px 10px', fontSize: '0.82rem', fontFamily: 'monospace' }}
                    placeholder="sk-rt-..."
                    value={apiKey}
                    onChange={e => setApiKey(e.target.value)}
                    autoComplete="new-password"
                  />
                  <button type="button" onClick={() => setShowKey(!showKey)}
                    style={{ position: 'absolute', right: 6, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2 }}>
                    {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                  </button>
                </div>
                {apiKey.length >= 10 && (
                  matchedProject ? (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#10b981' }}>
                      <CheckCircle2 size={12} />
                      {matchedProject.name}
                      {matchedToken?.labels?.length ? <span style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>({matchedToken.labels.join(', ')})</span> : null}
                    </span>
                  ) : (
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: '#f59e0b' }}>
                      <AlertCircle size={12} /> Unknown token
                    </span>
                  )
                )}
              </div>
            )}

            {/* Presets button */}
            {matchedProject && (
              <button
                className={`btn${showPresetsPanel ? ' btn-primary' : ''}`}
                onClick={() => setShowPresetsPanel(!showPresetsPanel)}
                style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <BookOpen size={13} /> Presets {presets.length > 0 ? `(${presets.length})` : ''}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0, padding: '0 32px 24px' }}>

        {/* Presets sidebar */}
        {showPresetsPanel && matchedProject && (
          <div className="card" style={{ width: 250, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, flexShrink: 0 }}>
            <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.84rem', fontWeight: 600 }}>Presets</span>
              <button
                onClick={() => setShowSaveForm(!showSaveForm)}
                className="btn"
                style={{ fontSize: '0.72rem', padding: '3px 8px', display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Save size={11} /> Save current
              </button>
            </div>
            {showSaveForm && (
              <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', gap: 6 }}>
                <input
                  className="form-input"
                  style={{ flex: 1, padding: '4px 8px', fontSize: '0.78rem' }}
                  placeholder="Preset name..."
                  value={savePresetName}
                  onChange={e => setSavePresetName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') savePreset(); }}
                  autoFocus
                />
                <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.72rem' }} onClick={savePreset} disabled={!savePresetName.trim()}>Save</button>
              </div>
            )}
            <div style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
              {presetsLoading ? (
                <div style={{ textAlign: 'center', padding: 20 }}><span className="spinner" style={{ width: 14, height: 14 }} /></div>
              ) : presets.length === 0 ? (
                <p style={{ margin: 0, padding: '20px 8px', textAlign: 'center', fontSize: '0.78rem', color: 'var(--text-muted)' }}>No presets yet.</p>
              ) : (
                presets.map(p => (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 6px', borderRadius: 5, marginBottom: 2 }}
                    onMouseEnter={e => (e.currentTarget as HTMLDivElement).style.background = 'var(--bg-elevated)'}
                    onMouseLeave={e => (e.currentTarget as HTMLDivElement).style.background = 'transparent'}
                  >
                    <button onClick={() => loadPreset(p)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, fontSize: '0.8rem', color: 'var(--text-primary)', padding: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {p.name}
                    </button>
                    <button onClick={() => deletePreset(p.id)} className="btn-icon danger" style={{ padding: 3, flexShrink: 0 }} title="Delete preset">
                      <Trash2 size={11} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        )}

        {/* Main area */}
        {mode === 'single' ? (
          <>
            {/* Chat card */}
            <div className="card" style={{ flex: 2, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
              {/* Controls */}
              <div style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 }}>
                <button onClick={() => setSystemPromptOpen(!systemPromptOpen)}
                  style={{ width: '100%', padding: '8px 16px', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                  <span style={{ fontWeight: 600 }}>System prompt</span>
                  <span style={{ transform: systemPromptOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', display: 'inline-block', fontSize: '0.65rem' }}>▶</span>
                </button>
                {systemPromptOpen && (
                  <div style={{ padding: '0 16px 10px' }}>
                    <textarea className="form-input" rows={3}
                      style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit', fontSize: '0.85rem', boxSizing: 'border-box' }}
                      value={systemPrompt} onChange={e => setSystemPrompt(e.target.value)} />
                  </div>
                )}
                <div style={{ padding: '6px 16px 10px', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>Model</label>
                    <select className="form-input" style={{ padding: '4px 8px', fontSize: '0.78rem' }}
                      value={selectedModelId} onChange={e => setSelectedModelId(e.target.value)}>
                      <option value="">Auto (project default)</option>
                      {availableModels.map(m => <option key={m.modelId} value={m.modelId}>{m.modelId}</option>)}
                    </select>
                  </div>
                  <ParamSlider label="Temp" value={temperature} min={0} max={2} step={0.1} onChange={setTemperature} />
                  <ParamSlider label="Max tokens" value={maxTokens} min={64} max={8192} step={64} onChange={setMaxTokens} />
                  <ParamSlider label="Top-p" value={topP} min={0} max={1} step={0.05} onChange={setTopP} />
                  {messages.length > 0 && (
                    <button className="btn" style={{ fontSize: '0.73rem', marginLeft: 'auto' }} onClick={() => { setMessages([]); setShowRaw({}); setDebugTraceHistory([]); }}>Clear</button>
                  )}
                </div>
              </div>

              {/* Messages */}
              <div style={{ flex: 1, overflowY: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {displayMessages.length === 0 ? (
                  <div className="empty-state" style={{ margin: 'auto' }}>
                    <p style={{ margin: 0 }}>No messages yet.</p>
                    {!apiKey && <p style={{ fontSize: '0.8rem', marginTop: 4, color: 'var(--text-secondary)' }}>Enter a Project Token above to start.</p>}
                  </div>
                ) : (
                  displayMessages.map((msg, i) => {
                    const isAssistant = msg.role === 'assistant';
                    const showRawThis = showRaw[i] ?? false;
                    return (
                      <div key={i} style={{ alignSelf: isAssistant ? 'flex-start' : 'flex-end', maxWidth: '85%', display: 'flex', flexDirection: 'column', alignItems: isAssistant ? 'flex-start' : 'flex-end' }}>
                        {isAssistant && msg.thinking && (
                          <details style={{ marginBottom: 5, width: '100%' }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.72rem', color: 'var(--text-muted)', padding: '3px 10px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, display: 'inline-flex', alignItems: 'center', gap: 4, userSelect: 'none' }}>
                              Reasoning {loading && i === displayMessages.length - 1 && <span className="spinner" style={{ width: 10, height: 10, borderWidth: 1.5 }} />}
                            </summary>
                            <div style={{ marginTop: 4, padding: '10px 14px', background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>
                              {msg.thinking}
                            </div>
                          </details>
                        )}
                        {/* Blocked guardrail box — shown above the bubble */}
                        {isAssistant && msg.blocked && (
                          <div style={{
                            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.5)',
                            borderRadius: '12px 12px 4px 12px', padding: '10px 14px',
                            display: 'flex', flexDirection: 'column', gap: 4, width: '100%', boxSizing: 'border-box',
                          }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 700, color: '#ef4444', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              <AlertCircle size={13} /> {msg.blocked.target === 'request' ? 'Request' : 'Response'} blocked by guardrail
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 6, marginTop: 2 }}>
                              <div>
                                <div style={{ fontSize: '0.62rem', color: 'rgba(239,68,68,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Rule</div>
                                <div style={{ fontSize: '0.8rem', color: '#fca5a5', fontFamily: 'monospace', fontWeight: 600 }}>{msg.blocked.rule}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '0.62rem', color: 'rgba(239,68,68,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Target</div>
                                <div style={{ fontSize: '0.8rem', color: '#fca5a5' }}>{msg.blocked.target}</div>
                              </div>
                              <div>
                                <div style={{ fontSize: '0.62rem', color: 'rgba(239,68,68,0.7)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Action</div>
                                <div style={{ fontSize: '0.8rem', color: '#fca5a5' }}>{msg.blocked.action}</div>
                              </div>
                            </div>
                            {msg.blocked.fallbackMessage && (
                              <div style={{ fontSize: '0.8rem', color: '#fca5a5', fontStyle: 'italic', paddingTop: 4, borderTop: '1px solid rgba(239,68,68,0.25)', marginTop: 2 }}>
                                {msg.blocked.fallbackMessage}
                              </div>
                            )}
                          </div>
                        )}
                        <div style={{
                          background: isAssistant ? (msg.blocked ? 'rgba(239,68,68,0.05)' : 'var(--bg-elevated)') : 'var(--primary)',
                          color: isAssistant ? 'var(--text-primary)' : '#fff',
                          padding: '10px 14px',
                          borderRadius: isAssistant ? '16px 16px 16px 4px' : '16px 16px 4px 16px',
                          border: isAssistant ? (msg.blocked ? '1px solid rgba(239,68,68,0.3)' : '1px solid var(--border)') : 'none',
                          fontSize: '0.9rem', lineHeight: 1.5,
                          display: isAssistant && msg.blocked && !msg.content ? 'none' : undefined,
                        }}>
                          {isAssistant ? (
                            typeof msg.content === 'string'
                              ? (showRawThis
                                  ? <pre style={{ margin: 0, fontSize: '0.75rem', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{msg.rawJson ?? msg.content}</pre>
                                  : <MdContent>{msg.content}</MdContent>)
                              : <MdContent>{(msg.content as ContentPart[]).filter(c => c.type === 'text').map(c => c.text).join('')}</MdContent>
                          ) : (
                            typeof msg.content === 'string'
                              ? <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
                              : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                  {(msg.content as ContentPart[]).map((c, idx) => (
                                    c.type === 'text' ? <span key={idx}>{c.text}</span> :
                                    c.type === 'image_url' ? <img key={idx} src={c.image_url!.url} alt="Attached" style={{ maxWidth: 200, borderRadius: 8 }} /> : null
                                  ))}
                                </div>
                              )
                          )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4, fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          <span style={{ textTransform: 'capitalize' }}>{isAssistant && msg.model ? msg.model : msg.role}</span>
                          {isAssistant && (msg.inputTokens || msg.outputTokens) && (
                            <span style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', fontFamily: 'monospace' }}>
                              tokens: {(msg.inputTokens ?? 0) + (msg.outputTokens ?? 0)} | {costEstimate(msg.inputTokens ?? 0, msg.outputTokens ?? 0)}
                            </span>
                          )}
                          {isAssistant && msg.latencyMs ? <span>{msg.latencyMs}ms</span> : null}
                          {isAssistant && msg.rawJson && (
                            <button
                              onClick={() => setShowRaw(prev => ({ ...prev, [i]: !prev[i] }))}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, padding: 0, fontSize: '0.7rem' }}
                            >
                              <Code size={11} /> {showRawThis ? 'rendered' : 'raw'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })
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
                <div ref={endRef} />
              </div>

              {/* Input */}
              <div style={{ padding: 16, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                {attachedImage && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ position: 'relative', display: 'inline-block' }}>
                      <img src={attachedImage} alt="Attachment" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)' }} />
                      <button className="btn-icon danger" style={{ position: 'absolute', top: -5, right: -5, padding: 2, background: 'var(--bg-elevated)' }} onClick={() => setAttachedImage(null)}>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold' }}>×</span>
                      </button>
                    </div>
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                  <input type="file" accept="image/*" style={{ display: 'none' }} ref={fileInputRef} onChange={handleFileAttach} />
                  <button className="btn-icon" title="Attach image" onClick={() => fileInputRef.current?.click()}><Paperclip size={17} /></button>
                  <textarea
                    className="form-input"
                    rows={2}
                    placeholder="Type a message..."
                    style={{ flex: 1, resize: 'none', fontFamily: 'inherit' }}
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                  />
                  {loading
                    ? <button className="btn btn-danger" onClick={handleStop}><Square size={15} /></button>
                    : <button className="btn btn-primary" onClick={handleSend} disabled={!input.trim() || !apiKey}><Send size={15} /></button>
                  }
                </div>
              </div>
            </div>

            {/* Debug sidebar */}
            {showDebugSidebar && (
              <div className="card" style={{ width: 380, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 600 }}>Debug</h3>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {debugTraceHistory.length > 0 && (
                      <button onClick={() => setDebugTraceHistory([])} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Clear</button>
                    )}
                    <button onClick={() => setShowDebugSidebar(false)} className="btn-icon" style={{ padding: 4 }} title="Hide debug"><ChevronRight size={15} /></button>
                  </div>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12, background: 'var(--bg-base)' }}>
                  {debugTraceHistory.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '30px 10px', color: 'var(--text-muted)' }}>
                      <p style={{ margin: 0, fontSize: '0.82rem' }}>No debug data yet.</p>
                      <p style={{ margin: '6px 0 0', fontSize: '0.75rem' }}>Send a message to see routing details.</p>
                    </div>
                  ) : (
                    debugTraceHistory.map((traces, i) => {
                      if (!traces) return null;
                      const stats = extractMessageStats(traces as any[]);
                      return (
                        <div key={i} style={{ marginBottom: 14 }}>
                          <MessageStatsCard stats={stats} turnNumber={i + 1} />
                          <details style={{ marginTop: 6 }}>
                            <summary style={{ cursor: 'pointer', fontSize: '0.78rem', color: 'var(--text-muted)', padding: '6px 10px', background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 5 }}>
                              Technical Details
                            </summary>
                            <div style={{ marginTop: 6, padding: 10, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, fontSize: '0.83rem' }}>
                              {(traces as any[]).map((entry, j) => (
                                <div key={j} style={{ marginBottom: j < traces.length - 1 ? 10 : 0 }}>
                                  <TraceEntryRenderer entry={entry} />
                                </div>
                              ))}
                            </div>
                          </details>
                        </div>
                      );
                    })
                  )}
                  <div ref={debugEndRef} />
                </div>
              </div>
            )}
            {!showDebugSidebar && (
              <button onClick={() => setShowDebugSidebar(true)} className="btn-icon"
                style={{ position: 'fixed', right: 24, top: '50%', transform: 'translateY(-50%)', padding: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}
                title="Show debug">
                <ChevronLeft size={18} />
              </button>
            )}
          </>
        ) : (
          <ComparePanel
            apiKey={apiKey}
            apiKeyB={apiKeyB}
            systemPrompt={systemPrompt}
            temperature={temperature}
            maxTokens={maxTokens}
            topP={topP}
            availableModels={availableModels}
            compareModelA={compareModelA}
            compareModelB={compareModelB}
            setCompareModelA={setCompareModelA}
            setCompareModelB={setCompareModelB}
          />
        )}
      </div>
    </div>
  );
}
