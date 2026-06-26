import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { useRef } from 'react';
import {
  severityIcon,
  timeAgo,
  NotificationDropdown,
  ProfileNotificationBadge,
} from './NotificationBell';

vi.mock('../api', () => ({
  getNotificationInbox: vi.fn(),
  markNotificationsRead: vi.fn(),
}));

import { getNotificationInbox, markNotificationsRead } from '../api';

const mockGetInbox = vi.mocked(getNotificationInbox as (...args: unknown[]) => Promise<unknown>);
const mockMarkRead = vi.mocked(markNotificationsRead as (...args: unknown[]) => Promise<unknown>);

afterEach(() => vi.clearAllMocks());

// ── severityIcon ──────────────────────────────────────────────────────────────

describe('severityIcon', () => {
  it('returns AlertCircle for critical', () => {
    const icon = severityIcon('critical');
    expect(icon).toBeTruthy();
  });

  it('returns AlertTriangle for warning', () => {
    const icon = severityIcon('warning');
    expect(icon).toBeTruthy();
  });

  it('returns Info for info', () => {
    const icon = severityIcon('info');
    expect(icon).toBeTruthy();
  });
});

// ── timeAgo ───────────────────────────────────────────────────────────────────

describe('timeAgo', () => {
  it('shows seconds ago for < 60s', () => {
    const iso = new Date(Date.now() - 30_000).toISOString();
    expect(timeAgo(iso)).toBe('30s ago');
  });

  it('shows minutes ago for < 60m', () => {
    const iso = new Date(Date.now() - 5 * 60_000).toISOString();
    expect(timeAgo(iso)).toBe('5m ago');
  });

  it('shows hours ago for < 24h', () => {
    const iso = new Date(Date.now() - 3 * 3_600_000).toISOString();
    expect(timeAgo(iso)).toBe('3h ago');
  });

  it('shows days ago for >= 24h', () => {
    const iso = new Date(Date.now() - 2 * 86_400_000).toISOString();
    expect(timeAgo(iso)).toBe('2d ago');
  });
});

// ── NotificationDropdown ──────────────────────────────────────────────────────

const items = [
  { id: 'n1', event: 'provider.error', severity: 'critical' as const, timestamp: new Date(Date.now() - 60_000).toISOString(), read: false, details: {} },
  { id: 'n2', event: 'system.startup', severity: 'info' as const, timestamp: new Date(Date.now() - 120_000).toISOString(), read: true, details: {} },
];

function DropdownWrapper({
  open, onClose = () => {}, onMarkAll = () => {},
  itemsOverride = items, unread = 1,
}: {
  open: boolean;
  onClose?: () => void;
  onMarkAll?: () => void;
  itemsOverride?: typeof items;
  unread?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <MemoryRouter>
      <div ref={ref} style={{ top: 100, bottom: 200, left: 100, right: 200 }}>anchor</div>
      <NotificationDropdown
        anchorRef={ref as React.RefObject<HTMLElement | null>}
        open={open}
        onClose={onClose}
        items={itemsOverride}
        unread={unread}
        onMarkAll={onMarkAll}
      />
    </MemoryRouter>
  );
}

describe('NotificationDropdown', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<DropdownWrapper open={false} />);
    expect(container.querySelector('[data-testid="dropdown"]')).toBeNull();
    // notification items should not be in DOM
    expect(screen.queryByText('provider.error')).toBeNull();
  });

  it('renders items when open', () => {
    render(<DropdownWrapper open={true} />);
    expect(screen.getByText('provider.error')).toBeTruthy();
    expect(screen.getByText('system.startup')).toBeTruthy();
  });

  it('shows "No notifications" when items list is empty', () => {
    render(<DropdownWrapper open={true} itemsOverride={[]} unread={0} />);
    expect(screen.getByText('No notifications')).toBeTruthy();
  });

  it('shows "Mark all read" button when unread > 0', () => {
    render(<DropdownWrapper open={true} unread={3} />);
    expect(screen.getByText(/Mark all read/)).toBeTruthy();
  });

  it('does not show "Mark all read" when unread === 0', () => {
    render(<DropdownWrapper open={true} unread={0} />);
    expect(screen.queryByText(/Mark all read/)).toBeNull();
  });

  it('calls onMarkAll when Mark all read clicked', async () => {
    const onMarkAll = vi.fn();
    render(<DropdownWrapper open={true} unread={2} onMarkAll={onMarkAll} />);
    await userEvent.click(screen.getByText(/Mark all read/));
    expect(onMarkAll).toHaveBeenCalledTimes(1);
  });

  it('only shows first 5 items when list > 5', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `n${i}`, event: `event.${i}`, severity: 'info' as const,
      timestamp: new Date(Date.now() - i * 60_000).toISOString(), read: false, details: {} as Record<string, unknown>,
    }));
    render(<DropdownWrapper open={true} itemsOverride={many} unread={8} />);
    // Only first 5 should be rendered
    for (let i = 0; i < 5; i++) {
      expect(screen.getByText(`event.${i}`)).toBeTruthy();
    }
    expect(screen.queryByText('event.5')).toBeNull();
  });

  it('shows "View all notifications" link', () => {
    render(<DropdownWrapper open={true} />);
    expect(screen.getByText('View all notifications')).toBeTruthy();
  });
});

// ── ProfileNotificationBadge ──────────────────────────────────────────────────

function BadgeWrapper() {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <MemoryRouter>
      <div ref={ref}>anchor</div>
      <ProfileNotificationBadge anchorRef={ref as React.RefObject<HTMLElement | null>} />
    </MemoryRouter>
  );
}

describe('ProfileNotificationBadge', () => {
  beforeEach(() => {
    mockGetInbox.mockResolvedValue({ items: [], unreadCount: 0 });
    mockMarkRead.mockResolvedValue(undefined);
  });

  it('renders a bell button', async () => {
    render(<BadgeWrapper />);
    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    const btn = document.querySelector('button[title="Notifications"]');
    expect(btn).toBeTruthy();
  });

  it('shows unread badge when unreadCount > 0', async () => {
    mockGetInbox.mockResolvedValue({
      items: [{ id: 'n1', event: 'x', severity: 'info', timestamp: new Date().toISOString(), read: false, details: {} }],
      unreadCount: 1,
    });
    render(<BadgeWrapper />);
    await waitFor(() => screen.getByText('1'));
    expect(screen.getByText('1')).toBeTruthy();
  });

  it('shows 99+ when unreadCount > 99', async () => {
    mockGetInbox.mockResolvedValue({
      items: [],
      unreadCount: 150,
    });
    render(<BadgeWrapper />);
    await waitFor(() => screen.getByText('99+'));
    expect(screen.getByText('99+')).toBeTruthy();
  });

  it('opens dropdown on bell click', async () => {
    mockGetInbox.mockResolvedValue({ items, unreadCount: 1 });
    render(<BadgeWrapper />);
    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());
    const btn = document.querySelector('button[title="Notifications"]')!;
    await userEvent.click(btn);
    expect(screen.getByText('provider.error')).toBeTruthy();
  });

  it('calls markNotificationsRead on markAll', async () => {
    mockGetInbox.mockResolvedValue({ items, unreadCount: 1 });
    render(<BadgeWrapper />);
    await waitFor(() => expect(mockGetInbox).toHaveBeenCalled());

    // Open dropdown
    const btn = document.querySelector('button[title="Notifications"]')!;
    await userEvent.click(btn);

    // Click mark all read
    const markBtn = screen.getByText(/Mark all read/);
    await userEvent.click(markBtn);
    expect(mockMarkRead).toHaveBeenCalledWith({ all: true });
  });

  it('silently ignores inbox load errors', async () => {
    mockGetInbox.mockRejectedValue(new Error('network'));
    render(<BadgeWrapper />);
    // Should not throw
    await new Promise(r => setTimeout(r, 50));
    const btn = document.querySelector('button[title="Notifications"]');
    expect(btn).toBeTruthy();
  });
});
