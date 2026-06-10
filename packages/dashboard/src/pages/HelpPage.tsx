import { useState } from 'react';
import { BookOpen, Bug, ExternalLink, Mail, ChevronDown, ChevronRight, MessageSquarePlus } from 'lucide-react';

const FAQ_ITEMS = [
  {
    q: 'How do I connect my app to Routerly?',
    a: `Point your OpenAI or Anthropic SDK to your Routerly instance. Replace the base URL with http://your-host:3000/v1 (OpenAI-compatible) or http://your-host:3000/anthropic (Anthropic-compatible), then use a project token as the API key. That's it — no other changes needed.`,
  },
  {
    q: 'Is Routerly compatible with tools that use the OpenAI SDK?',
    a: 'Yes. Routerly is a drop-in replacement: any tool that supports a custom base URL and API key (LangChain, LlamaIndex, Cursor, Continue, etc.) works out of the box. For Anthropic-format clients, use the /anthropic endpoint instead.',
  },
  {
    q: 'How does model routing work?',
    a: 'Each project has a routing policy that decides which model receives a request. Policies include round-robin, lowest cost, fastest response, fallback chains, and more. You configure them per project under Projects → Routing.',
  },
  {
    q: 'How do I add a new AI model?',
    a: 'Go to Models → Add model. You can add any OpenAI-compatible provider (Ollama, LM Studio, custom endpoints) or a native Anthropic endpoint. Fill in the base URL, API key, and model ID — Routerly will handle the rest.',
  },
  {
    q: 'Is my data stored? Are my prompts logged?',
    a: 'Routerly is self-hosted and stores data only on your machine (in ~/.routerly/ by default). Prompts and responses are never sent anywhere by Routerly. Request logs are stored locally and only if you enable them per-project.',
  },
  {
    q: 'What\'s a project token and how is it different from a provider API key?',
    a: 'A project token is a credential you give to your app or team members to authenticate with Routerly. It\'s separate from your provider API keys, which Routerly stores securely on the server side. Your apps never see the real provider keys.',
  },
];

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderBottom: '1px solid var(--border)',
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '14px 0',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          textAlign: 'left',
          color: 'var(--text-primary)',
          fontSize: '0.88rem',
          fontWeight: 500,
        }}
      >
        <span style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
        </span>
        {q}
      </button>
      {open && (
        <p style={{
          margin: '0 0 14px 25px',
          fontSize: '0.84rem',
          color: 'var(--text-secondary)',
          lineHeight: 1.6,
        }}>
          {a}
        </p>
      )}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: 'var(--bg-elevated)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '20px 24px',
      ...style,
    }}>
      {children}
    </div>
  );
}

const ISSUE_TEMPLATE = `**What happened?**
(Describe the problem in plain words)

**Steps to reproduce**
1.
2.

**Expected behaviour**
(What you expected to see)

**Routerly version**
(Run \`routerly --version\` or check Settings → About)`;

export function HelpPage() {
  const [templateVisible, setTemplateVisible] = useState(false);

  const issueUrl = `https://github.com/Inebrio/Routerly/issues/new?labels=bug&template=bug_report.md`;
  const featureUrl = `https://github.com/Inebrio/Routerly/issues/new?labels=enhancement&template=feature_request.md`;

  return (
    <>
      <div className="page-header">
        <h1>Help &amp; Support</h1>
        <p>We're here to help — find answers or reach out anytime.</p>
      </div>

      <div className="page-body" style={{ display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 640 }}>

        {/* ── Documentation ─────────────────────────────────────────────────── */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'rgba(139,92,246,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <BookOpen size={17} color="#8b5cf6" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Documentation</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>Guides, API reference, and configuration docs</div>
            </div>
          </div>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            The official docs cover everything from getting started to advanced routing policies, provider setup, budgets, and the full API reference.
          </p>
          <a
            href="https://doc.routerly.ai/next/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ExternalLink size={13} /> Open documentation
          </a>
        </Card>

        {/* ── GitHub Issues ──────────────────────────────────────────────────── */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'rgba(61,117,245,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Bug size={17} color="var(--accent)" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Report a bug or suggest a feature</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>Open a GitHub issue — it takes 2 minutes</div>
            </div>
          </div>

          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            GitHub issues are the best way to report bugs or propose improvements. To help us fix things faster, include: what you did, what you expected to happen, and what actually happened.
          </p>

          <div style={{ marginBottom: 14 }}>
            <button
              onClick={() => setTemplateVisible(v => !v)}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                fontSize: '0.8rem', color: 'var(--accent)', display: 'flex', alignItems: 'center', gap: 4,
              }}
            >
              {templateVisible ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              Show issue template
            </button>
            {templateVisible && (
              <pre style={{
                marginTop: 10,
                background: 'var(--bg-base)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                padding: '12px 14px',
                fontSize: '0.78rem',
                color: 'var(--text-secondary)',
                lineHeight: 1.6,
                whiteSpace: 'pre-wrap',
                fontFamily: 'var(--font-mono, monospace)',
              }}>
                {ISSUE_TEMPLATE}
              </pre>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href={issueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-primary btn-sm"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <ExternalLink size={13} /> Report a bug
            </a>
            <a
              href={featureUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <MessageSquarePlus size={13} /> Request a feature
            </a>
          </div>
        </Card>

        {/* ── Email support ──────────────────────────────────────────────────── */}
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 8,
              background: 'rgba(16,185,129,0.12)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Mail size={17} color="#10b981" />
            </div>
            <div>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>Contact support</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>We read every message and reply as soon as we can</div>
            </div>
          </div>

          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            For anything that doesn't fit a GitHub issue — billing questions, private concerns, or if you just want to say hi — drop us a line.
          </p>

          <a
            href="mailto:support@routerly.ai"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Mail size={13} /> support@routerly.ai
          </a>
        </Card>

        {/* ── FAQ ───────────────────────────────────────────────────────────── */}
        <Card>
          <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)', marginBottom: 4 }}>
            Frequently asked questions
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            Quick answers to the most common questions
          </div>
          <div>
            {FAQ_ITEMS.map(item => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </Card>

      </div>
    </>
  );
}
