import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CallConfigEditor, callConfigError } from './CallConfigEditor';

const on = { enabled: true, tiers: { low: { effort: 'low' as const } } };

describe('callConfigError', () => {
  it('accepts undefined and a valid config', () => {
    expect(callConfigError(undefined)).toBeNull();
    expect(callConfigError(on)).toBeNull();
  });
  it('rejects out-of-range max tokens and inverted thresholds', () => {
    expect(callConfigError({ enabled: true, tiers: { low: { maxOutputTokens: 5 } } })).toBe('callConfig.invalidMax');
    expect(callConfigError({ enabled: true, tiers: {}, thresholds: { mediumFromTokens: 20000 } })).toBe('callConfig.invalidThresholds');
  });
});

describe('CallConfigEditor', () => {
  it('shows the disabled empty state when untouched and emits enabled:true on toggle', () => {
    const onChange = vi.fn();
    render(<CallConfigEditor value={undefined} onChange={onChange} />);
    expect(screen.getByTestId('call-config-editor')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith({ enabled: true, tiers: {} });
  });

  it('disabling keeps the tier data', () => {
    const onChange = vi.fn();
    render(<CallConfigEditor value={on} onChange={onChange} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith({ ...on, enabled: false });
  });

  it('edits max output tokens and shows the validation error', () => {
    const onChange = vi.fn();
    const { rerender } = render(<CallConfigEditor value={on} onChange={onChange} />);
    const inputs = screen.getAllByRole('spinbutton') as HTMLElement[];
    fireEvent.change(inputs[0]!, { target: { value: '4096' } });
    expect(onChange).toHaveBeenCalledWith({ enabled: true, tiers: { low: { effort: 'low', maxOutputTokens: 4096 } } });
    rerender(<CallConfigEditor value={{ enabled: true, tiers: { low: { maxOutputTokens: 3 } } }} onChange={onChange} />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('read-only disables every control and never emits', () => {
    const onChange = vi.fn();
    render(<CallConfigEditor value={on} onChange={onChange} readOnly source="profile" />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    screen.getAllByRole('spinbutton').forEach(i => expect(i).toBeDisabled());
    screen.getAllByRole('combobox').forEach(c => expect(c).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(screen.getAllByRole('combobox')[0]!);
    expect(onChange).not.toHaveBeenCalled();
  });
});
