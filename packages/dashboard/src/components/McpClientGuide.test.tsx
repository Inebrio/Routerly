import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { McpClientGuide } from './McpClientGuide';

vi.mock('../utils/clipboard', () => ({ writeToClipboard: vi.fn() }));

// ponytail: stub SearchableSelect as a plain <select> so selectOptions fires onChange
vi.mock('./SearchableSelect', () => ({
  SearchableSelect: ({ options, value, onChange, ariaLabel }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    ariaLabel?: string;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

afterEach(() => vi.clearAllMocks());

describe('McpClientGuide', () => {
  it('starts on the first MCP client, with the token already in the snippet', () => {
    render(<McpClientGuide token="sk-rt-mcp-live" />);

    expect(screen.getByText(/claude mcp add --transport http routerly/)).toBeTruthy();
    expect(screen.getByText(/Bearer sk-rt-mcp-live/)).toBeTruthy();
    expect(screen.getByText(/~\/\.claude\.json/)).toBeTruthy();
  });

  it('offers every client whose MCP config was verified, and no other', () => {
    render(<McpClientGuide token="sk-rt-mcp-live" />);

    const options = Array.from(
      (screen.getByLabelText('MCP client') as HTMLSelectElement).options,
      o => o.value
    );
    expect(options).toEqual([
      'claude-code', 'claude-desktop', 'codex', 'opencode', 'openclaw', 'cursor', 'cline', 'zed',
    ]);
  });

  it('swaps snippet and hint when another client is picked', async () => {
    render(<McpClientGuide token="sk-rt-mcp-live" />);

    await userEvent.selectOptions(screen.getByLabelText('MCP client'), 'zed');

    expect(screen.getByText(/context_servers/)).toBeTruthy();
    expect(screen.getByText(/alongside any other context server/)).toBeTruthy();
    expect(screen.queryByText(/claude mcp add/)).toBeNull();
  });
});
