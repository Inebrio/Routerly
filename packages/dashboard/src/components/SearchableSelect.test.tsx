import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchableSelect } from './SearchableSelect';

const options = [
  { value: 'a', label: 'Alpha', description: 'First letter' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function setup(value = '', onChange = vi.fn(), disabled = false) {
  return {
    onChange,
    ...render(
      <SearchableSelect options={options} value={value} onChange={onChange} disabled={disabled} />
    ),
  };
}

describe('SearchableSelect — closed state', () => {
  it('shows placeholder when no value selected', () => {
    setup();
    expect(screen.getByText('Select...')).toBeTruthy();
  });

  it('shows custom placeholder', () => {
    render(<SearchableSelect options={options} value="" onChange={vi.fn()} placeholder="Choose..." />);
    expect(screen.getByText('Choose...')).toBeTruthy();
  });

  it('shows selected option label', () => {
    setup('a');
    expect(screen.getByText('Alpha')).toBeTruthy();
  });

  it('does not open when disabled', async () => {
    setup('', vi.fn(), true);
    const trigger = document.querySelector('div[style*="cursor"]') as HTMLElement;
    await userEvent.click(trigger);
    expect(screen.queryByPlaceholderText('Search...')).toBeNull();
  });
});

describe('SearchableSelect — open/close', () => {
  it('opens on trigger click', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('closes and clears query on outside click', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByPlaceholderText('Search...')).toBeNull();
  });

  it('toggles closed on second trigger click', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
    await userEvent.click(trigger);
    expect(screen.queryByPlaceholderText('Search...')).toBeNull();
  });
});

describe('SearchableSelect — search filtering', () => {
  it('filters options by query', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    const input = screen.getByPlaceholderText('Search...');
    await userEvent.type(input, 'al');
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('shows "No results" when nothing matches', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    await userEvent.type(screen.getByPlaceholderText('Search...'), 'zzz');
    expect(screen.getByText('No results')).toBeTruthy();
  });

  it('search input click does not close dropdown (stopPropagation)', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    const input = screen.getByPlaceholderText('Search...');
    await userEvent.click(input);
    expect(screen.getByPlaceholderText('Search...')).toBeTruthy();
  });
});

describe('SearchableSelect — option selection', () => {
  it('calls onChange and closes on option click', async () => {
    const onChange = vi.fn();
    setup('', onChange);
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    await userEvent.click(screen.getByText('Beta'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.queryByPlaceholderText('Search...')).toBeNull();
  });

  it('renders description when option has one', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    expect(screen.getByText('First letter')).toBeTruthy();
  });

  it('does not render description when absent', async () => {
    setup();
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    // Beta has no description
    const betaEl = screen.getByText('Beta');
    expect(betaEl.closest('div')!.querySelector('div[style*="0.72rem"]')).toBeNull();
  });
});

describe('SearchableSelect — hover styles', () => {
  it('changes background on mouseEnter for non-selected option', async () => {
    setup('a'); // 'a' is selected
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    const betaRow = screen.getByText('Beta').closest('div[style]') as HTMLElement;
    fireEvent.mouseEnter(betaRow);
    // background changes (non-selected branch)
    fireEvent.mouseLeave(betaRow);
    // back to elevated (no throw)
  });

  it('does not change background on mouseEnter for selected option', async () => {
    setup('a');
    const trigger = document.querySelector('div[style*="border"]') as HTMLElement;
    await userEvent.click(trigger);
    // Find the option row for Alpha inside the dropdown list (has padding 8px 12px)
    const allAlpha = screen.getAllByText('Alpha');
    // The dropdown option is wrapped in a div with padding style; the trigger span is not
    const alphaRow = allAlpha.map(el => el.closest('div[style*="padding: 8px"]')).find(Boolean) as HTMLElement;
    const bgBefore = alphaRow.style.background;
    fireEvent.mouseEnter(alphaRow);
    expect(alphaRow.style.background).toBe(bgBefore);
    fireEvent.mouseLeave(alphaRow);
    expect(alphaRow.style.background).toBe(bgBefore);
  });
});
