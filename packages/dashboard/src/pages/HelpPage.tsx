import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { BookOpen, Bug, ExternalLink, Mail, ChevronDown, ChevronRight, MessageSquarePlus } from 'lucide-react';

function getFaqItems(t: TFunction): Array<{ q: string; a: string }> {
  return [
    { q: t('help.faq.items.connect.q'), a: t('help.faq.items.connect.a') },
    { q: t('help.faq.items.openaiCompat.q'), a: t('help.faq.items.openaiCompat.a') },
    { q: t('help.faq.items.routing.q'), a: t('help.faq.items.routing.a') },
    { q: t('help.faq.items.addModel.q'), a: t('help.faq.items.addModel.a') },
    { q: t('help.faq.items.dataStored.q'), a: t('help.faq.items.dataStored.a') },
    { q: t('help.faq.items.routerToken.q'), a: t('help.faq.items.routerToken.a') },
  ];
}

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

function getIssueTemplate(t: TFunction): string {
  return `**${t('help.issueTemplate.whatHappened')}**
(${t('help.issueTemplate.whatHappenedHint')})

**${t('help.issueTemplate.stepsToReproduce')}**
1.
2.

**${t('help.issueTemplate.expectedBehaviour')}**
(${t('help.issueTemplate.expectedBehaviourHint')})

**${t('help.issueTemplate.version')}**
(${t('help.issueTemplate.versionHint')})`;
}

export function HelpPage() {
  const { t } = useTranslation();
  const [templateVisible, setTemplateVisible] = useState(false);
  const faqItems = getFaqItems(t);
  const issueTemplate = getIssueTemplate(t);

  const issueUrl = `https://github.com/Inebrio/Routerly/issues/new?labels=bug&template=bug_report.md`;
  const featureUrl = `https://github.com/Inebrio/Routerly/issues/new?labels=enhancement&template=feature_request.md`;

  return (
    <>
      <div className="page-header">
        <h1>{t('help.title')}</h1>
        <p>{t('help.subtitle')}</p>
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
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{t('help.docs.title')}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>{t('help.docs.subtitle')}</div>
            </div>
          </div>
          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            {t('help.docs.body')}
          </p>
          <a
            href="https://doc.routerly.ai/next/"
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-secondary btn-sm"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <ExternalLink size={13} /> {t('help.docs.openLink')}
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
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{t('help.issues.title')}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>{t('help.issues.subtitle')}</div>
            </div>
          </div>

          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            {t('help.issues.body')}
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
              {t('help.issues.showTemplate')}
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
                {issueTemplate}
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
              <ExternalLink size={13} /> {t('help.issues.reportBug')}
            </a>
            <a
              href={featureUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-secondary btn-sm"
              style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <MessageSquarePlus size={13} /> {t('help.issues.requestFeature')}
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
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{t('help.email.title')}</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>{t('help.email.subtitle')}</div>
            </div>
          </div>

          <p style={{ fontSize: '0.84rem', color: 'var(--text-secondary)', lineHeight: 1.6, margin: '0 0 14px' }}>
            {t('help.email.body')}
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
            {t('help.faq.title')}
          </div>
          <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 16 }}>
            {t('help.faq.subtitle')}
          </div>
          <div>
            {faqItems.map(item => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </Card>

      </div>
    </>
  );
}
