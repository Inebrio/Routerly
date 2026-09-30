import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const lang = vi.hoisted(() => ({ language: 'en', saving: false, setLanguage: vi.fn() }));
vi.mock('../LanguageContext', () => ({ useLanguage: () => lang }));

import { ProfilePreferencesTab } from './ProfilePreferencesTab';

afterEach(() => { cleanup(); vi.clearAllMocks(); lang.saving = false; });

async function pick(name: RegExp) {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox', { name: 'Language' }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('ProfilePreferencesTab', () => {
  it('AC2 saving a language calls setLanguage and shows the success message', async () => {
    lang.setLanguage.mockResolvedValue(undefined);
    render(<ProfilePreferencesTab />);
    await pick(/Deutsch/);
    expect(lang.setLanguage).toHaveBeenCalledWith('de');
    await screen.findByText('Language preference saved.');
  });

  it('EC1 a rejected save shows an error and no success message', async () => {
    lang.setLanguage.mockRejectedValue(new Error('x'));
    render(<ProfilePreferencesTab />);
    await pick(/Deutsch/);
    await screen.findByRole('alert');
    expect(screen.queryByText('Language preference saved.')).toBeNull();
  });

  it('EC3 the control is disabled while saving', () => {
    lang.saving = true;
    render(<ProfilePreferencesTab />);
    const box = screen.getByRole('combobox', { name: 'Language' });
    expect(box).toHaveAttribute('aria-disabled', 'true');
    return userEvent.setup().click(box).then(() => expect(screen.queryByRole('option')).toBeNull());
  });

  it('AC9 marks the current language', async () => {
    render(<ProfilePreferencesTab />);
    await userEvent.setup().click(screen.getByRole('combobox', { name: 'Language' }));
    const selected = (await screen.findAllByRole('option')).filter(o => o.getAttribute('aria-selected') === 'true');
    expect(selected).toHaveLength(1);
  });
});
