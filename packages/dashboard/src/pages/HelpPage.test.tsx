import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelpPage } from './HelpPage';

afterEach(() => vi.clearAllMocks());

function renderPage() {
  return render(
    <MemoryRouter>
      <HelpPage />
    </MemoryRouter>
  );
}

// ── Static content renders ─────────────────────────────────────────────────────

describe('HelpPage — static content', () => {
  it('renders page header', () => {
    renderPage();
    expect(screen.queryByText('Help & Support')).not.toBeNull();
  });

  it('renders Documentation card with link', () => {
    renderPage();
    expect(screen.queryByText('Documentation')).not.toBeNull();
    const link = screen.getByText('Open documentation').closest('a') as HTMLAnchorElement;
    expect(link.href).toContain('doc.routerly.ai');
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('renders GitHub Issues card with bug and feature links', () => {
    renderPage();
    expect(screen.queryByText('Report a bug or suggest a feature')).not.toBeNull();
    const bugLink = screen.getByText('Report a bug').closest('a') as HTMLAnchorElement;
    expect(bugLink.href).toContain('github.com');
    const featureLink = screen.getByText('Request a feature').closest('a') as HTMLAnchorElement;
    expect(featureLink.href).toContain('github.com');
  });

  it('renders Contact support card with email link', () => {
    renderPage();
    expect(screen.queryByText('Contact support')).not.toBeNull();
    const mailLink = screen.getByText('support@routerly.ai').closest('a') as HTMLAnchorElement;
    expect(mailLink.href).toBe('mailto:support@routerly.ai');
  });

  it('renders FAQ section heading', () => {
    renderPage();
    expect(screen.queryByText('Frequently asked questions')).not.toBeNull();
  });

  it('renders all 6 FAQ questions collapsed by default', () => {
    renderPage();
    expect(screen.queryByText('How do I connect my app to Routerly?')).not.toBeNull();
    expect(screen.queryByText('Is Routerly compatible with tools that use the OpenAI SDK?')).not.toBeNull();
    expect(screen.queryByText('How does model routing work?')).not.toBeNull();
    expect(screen.queryByText('How do I add a new AI model?')).not.toBeNull();
    expect(screen.queryByText('Is my data stored? Are my prompts logged?')).not.toBeNull();
    expect(screen.queryByText(/What's a project token/)).not.toBeNull();
  });

  it('FAQ answers are not visible by default', () => {
    renderPage();
    expect(screen.queryByText(/Point your OpenAI or Anthropic SDK/)).toBeNull();
  });
});

// ── Issue template toggle ──────────────────────────────────────────────────────

describe('HelpPage — issue template toggle', () => {
  it('shows template when "Show issue template" clicked', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Show issue template'));
    await waitFor(() =>
      expect(screen.queryByText(/What happened\?/)).not.toBeNull()
    );
  });

  it('hides template when clicked again (toggle)', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Show issue template'));
    await waitFor(() => screen.queryByText(/What happened\?/));
    await userEvent.click(screen.getByText('Show issue template'));
    await waitFor(() =>
      expect(screen.queryByText(/What happened\?/)).toBeNull()
    );
  });
});

// ── FAQ accordion ──────────────────────────────────────────────────────────────

describe('HelpPage — FAQ accordion', () => {
  it('expands first FAQ item on click and shows answer', async () => {
    renderPage();
    await userEvent.click(screen.getByText('How do I connect my app to Routerly?'));
    await waitFor(() =>
      expect(screen.queryByText(/Point your OpenAI or Anthropic SDK/)).not.toBeNull()
    );
  });

  it('collapses FAQ item when clicked again', async () => {
    renderPage();
    const btn = screen.getByText('How do I connect my app to Routerly?');
    await userEvent.click(btn);
    await waitFor(() => screen.queryByText(/Point your OpenAI or Anthropic SDK/));
    await userEvent.click(btn);
    await waitFor(() =>
      expect(screen.queryByText(/Point your OpenAI or Anthropic SDK/)).toBeNull()
    );
  });

  it('expands second FAQ item independently', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Is Routerly compatible with tools that use the OpenAI SDK?'));
    await waitFor(() =>
      expect(screen.queryByText(/drop-in replacement/)).not.toBeNull()
    );
  });

  it('expands third FAQ item independently', async () => {
    renderPage();
    await userEvent.click(screen.getByText('How does model routing work?'));
    await waitFor(() =>
      expect(screen.queryByText(/routing policy/)).not.toBeNull()
    );
  });

  it('expands fourth FAQ item independently', async () => {
    renderPage();
    await userEvent.click(screen.getByText('How do I add a new AI model?'));
    await waitFor(() =>
      expect(screen.queryByText(/Go to Models/)).not.toBeNull()
    );
  });

  it('expands fifth FAQ item independently', async () => {
    renderPage();
    await userEvent.click(screen.getByText('Is my data stored? Are my prompts logged?'));
    await waitFor(() =>
      expect(screen.queryByText(/self-hosted/)).not.toBeNull()
    );
  });

  it('expands sixth FAQ item independently', async () => {
    renderPage();
    await userEvent.click(screen.getByText(/What's a project token/));
    await waitFor(() =>
      expect(screen.queryByText(/credential you give to your app/)).not.toBeNull()
    );
  });

  it('multiple FAQ items can be open at the same time (independent state)', async () => {
    renderPage();
    await userEvent.click(screen.getByText('How do I connect my app to Routerly?'));
    await userEvent.click(screen.getByText('How does model routing work?'));
    await waitFor(() => {
      expect(screen.queryByText(/Point your OpenAI or Anthropic SDK/)).not.toBeNull();
      expect(screen.queryByText(/routing policy/)).not.toBeNull();
    });
  });
});
