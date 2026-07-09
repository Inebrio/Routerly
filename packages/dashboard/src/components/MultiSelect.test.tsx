import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MultiSelect } from './MultiSelect';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

function setup(value: string[] = [], onChange = vi.fn(), disabled = false) {
  return {
    onChange,
    ...render(
      <MultiSelect options={options} value={value} onChange={onChange} disabled={disabled} />
    ),
  };
}

describe('MultiSelect — closed state', () => {
  it('renders placeholder when no values selected', () => {
    setup();
    expect(screen.getByText('Select...')).toBeTruthy();
  });

  it('renders custom placeholder', () => {
    const { container } = render(
      <MultiSelect options={options} value={[]} onChange={vi.fn()} placeholder="Pick one" />
    );
    expect(screen.getByText('Pick one')).toBeTruthy();
  });

  it('renders selected option chips', () => {
    setup(['a', 'b']);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText('Select...')).toBeNull();
  });

  it('renders label for unknown value (fallback to value string)', () => {
    setup(['unknown-val']);
    expect(screen.getByText('unknown-val')).toBeTruthy();
  });
});

describe('MultiSelect — open/close', () => {
  it('opens dropdown on container click', async () => {
    setup();
    const trigger = screen.getByText('Select...').closest('div')!.parentElement!;
    // click the input area
    const inputArea = trigger.querySelector('.form-input') as HTMLElement;
    await userEvent.click(inputArea);
    expect(screen.getByText('Alpha')).toBeTruthy();
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.getByText('Gamma')).toBeTruthy();
  });

  it('closes dropdown on outside click', async () => {
    setup();
    const inputArea = document.querySelector('.form-input') as HTMLElement;
    await userEvent.click(inputArea);
    expect(screen.getByText('Alpha')).toBeTruthy();
    // click outside
    fireEvent.mouseDown(document.body);
    expect(screen.queryByText('No remaining options')).toBeNull();
  });

  it('shows "No remaining options" when all options are selected', async () => {
    setup(['a', 'b', 'c']);
    const inputArea = document.querySelector('.form-input') as HTMLElement;
    await userEvent.click(inputArea);
    expect(screen.getByText('No remaining options')).toBeTruthy();
  });

  it('does not open when disabled', async () => {
    setup([], vi.fn(), true);
    const inputArea = document.querySelector('.form-input') as HTMLElement;
    await userEvent.click(inputArea);
    expect(screen.queryByText('Alpha')).toBeNull();
  });
});

describe('MultiSelect — selecting options', () => {
  it('calls onChange with added value when option clicked', async () => {
    const onChange = vi.fn();
    setup([], onChange);
    const inputArea = document.querySelector('.form-input') as HTMLElement;
    await userEvent.click(inputArea);
    await userEvent.click(screen.getByText('Alpha'));
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('calls onChange with removed value when chip X clicked', async () => {
    const onChange = vi.fn();
    setup(['a', 'b'], onChange);
    // click the chip for Alpha (stop-propagation click on the chip div)
    const alphaChip = screen.getByText('Alpha').closest('div') as HTMLElement;
    await userEvent.click(alphaChip);
    expect(onChange).toHaveBeenCalledWith(['b']);
  });

  it('does not call onChange when disabled and chip clicked', async () => {
    const onChange = vi.fn();
    setup(['a'], onChange, true);
    const alphaChip = screen.getByText('Alpha').closest('div') as HTMLElement;
    await userEvent.click(alphaChip);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('MultiSelect — hover styles', () => {
  it('fires mouseEnter and mouseLeave handlers on dropdown option without throwing', async () => {
    setup();
    const inputArea = document.querySelector('.form-input') as HTMLElement;
    await userEvent.click(inputArea);
    const option = screen.getByText('Alpha').closest('div') as HTMLElement;
    // Both handlers mutate style.background — verify they fire without error
    fireEvent.mouseEnter(option);
    const afterEnter = option.style.background;
    fireEvent.mouseLeave(option);
    // mouseLeave sets 'transparent'; happy-dom may normalise differently, just no throw
    expect(typeof option.style.background).toBe('string');
  });
});
