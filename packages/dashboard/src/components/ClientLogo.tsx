/**
 * Monogram mark for a client in the Connect section.
 *
 * Deliberately not the vendors' own logos: those are trademarked assets we
 * would have to vendor, keep in sync and license. A monogram is self-hosted,
 * renders identically in both themes and never goes stale.
 */

interface Mark {
  text: string;
  color: string;
}

const MARKS: Record<string, Mark> = {
  'claude-code': { text: 'CC', color: '#d97757' },
  'claude-desktop': { text: 'CD', color: '#b8562f' },
  codex: { text: 'CX', color: '#10a37f' },
  opencode: { text: 'OC', color: '#6366f1' },
  openclaw: { text: 'OW', color: '#f59e0b' },
  continue: { text: 'CN', color: '#8b5cf6' },
  cursor: { text: 'CU', color: '#475569' },
  cline: { text: 'CL', color: '#0ea5e9' },
  zed: { text: 'ZD', color: '#ef4444' },
  'generic-openai': { text: 'API', color: '#0f766e' },
  'generic-anthropic': { text: 'API', color: '#a3552f' },
};

const FALLBACK: Mark = { text: '?', color: '#64748b' };

export function ClientLogo({ id, label, size = 36 }: { id: string; label: string; size?: number }) {
  const mark = MARKS[id] ?? FALLBACK;
  // Three-character marks need to shrink to stay inside the tile.
  const fontSize = mark.text.length > 2 ? size * 0.3 : size * 0.38;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={`${label} logo`}
      style={{ flexShrink: 0, display: 'block' }}
    >
      <rect width="100" height="100" rx="22" fill={mark.color} />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fill="#ffffff"
        fontSize={(fontSize / size) * 100}
        fontWeight="600"
        fontFamily="system-ui, sans-serif"
        letterSpacing="1"
      >
        {mark.text}
      </text>
    </svg>
  );
}
