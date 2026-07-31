import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConnectionForm, emptyForm, credentialsToRecord } from './ConnectionForm';
import type { ProviderDescriptor } from '../api';

vi.mock('./SearchableSelect', () => ({
  SearchableSelect: ({
    options, value, onChange, placeholder, disabled,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <select
      data-testid={`searchable-${placeholder ?? 'select'}`}
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
    >
      <option value="">—</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  ),
}));

const providers: ProviderDescriptor[] = [
  { id: 'openai', label: 'OpenAI', protocol: 'openai', supportLevel: 'native', nativeCapabilities: {} as never },
  { id: 'anthropic', label: 'Anthropic', protocol: 'anthropic', supportLevel: 'native', nativeCapabilities: {} as never },
];

describe('ConnectionForm', () => {
  it('renders provider select, label input, endpoint input, add-credential-row, and disables Save when label is empty', async () => {
    const form = emptyForm('openai');
    render(
      <ConnectionForm
        form={form}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        saving={false}
        providers={providers}
        isNew
      />
    );

    const providerSelect = screen.getByTestId('searchable-select') as HTMLSelectElement;
    expect(providerSelect).toBeTruthy();
    expect(screen.getByRole('option', { name: 'OpenAI' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Anthropic' })).toBeTruthy();

    expect(screen.getByLabelText('Label')).toBeTruthy();
    expect(screen.getByLabelText('Endpoint (optional)')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Add credential field/ })).toBeTruthy();

    const saveButton = screen.getByRole('button', { name: /Create/ });
    expect(saveButton).toBeDisabled();
  });

  it('enables Save once label is non-empty', () => {
    const form = { ...emptyForm('openai'), label: 'My connection' };
    render(
      <ConnectionForm
        form={form}
        onChange={vi.fn()}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        saving={false}
        providers={providers}
        isNew
      />
    );
    expect(screen.getByRole('button', { name: /Create/ })).not.toBeDisabled();
  });

  it('calls onChange when add-credential-row is clicked', async () => {
    const onChange = vi.fn();
    const form = emptyForm('openai');
    render(
      <ConnectionForm
        form={form}
        onChange={onChange}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        saving={false}
        providers={providers}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /Add credential field/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('emptyForm', () => {
  it('returns a blank form with the given provider id', () => {
    expect(emptyForm('openai')).toEqual({
      providerId: 'openai', label: '', endpoint: '', enabled: true, credentials: [],
    });
  });
});

describe('credentialsToRecord', () => {
  it('converts rows to a record, dropping rows with empty keys', () => {
    expect(credentialsToRecord([
      { key: 'apiKey', value: '123' },
      { key: '  ', value: 'ignored' },
      { key: ' orgId ', value: 'org-1' },
    ])).toEqual({ apiKey: '123', orgId: 'org-1' });
  });
});
