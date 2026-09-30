import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import i18n from './i18n';

const auth = vi.hoisted(() => ({ user: null as { language?: string } | null, updateUser: vi.fn() }));
vi.mock('./AuthContext', () => ({ useAuth: () => auth }));
vi.mock('./api', () => ({ getMe: vi.fn(), getSettings: vi.fn(), updateMyLanguage: vi.fn().mockResolvedValue(undefined) }));

import { getMe, getSettings } from './api';
import { LanguageProvider, useLanguage } from './LanguageContext';
import { updateMyLanguage } from './api';

let setter: (c: string) => Promise<void>;
let saving = false;
function Probe() { const l = useLanguage(); setter = l.setLanguage; saving = l.saving; return null; }
const mount = () => render(<LanguageProvider><Probe /></LanguageProvider>);
const browser = (langs: string[], first = langs[0] ?? '') => {
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(langs);
  vi.spyOn(navigator, 'language', 'get').mockReturnValue(first);
};

beforeEach(() => {
  auth.user = null;
  localStorage.setItem('lr_token', 't');
  vi.mocked(getSettings).mockResolvedValue({ defaultLanguage: 'fr' } as never);
  vi.mocked(getMe).mockResolvedValue({} as never);
  browser(['en-US']);
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

describe('LanguageProvider resolution', () => {
  it('AC4 saved language wins over browser and instance default', async () => {
    auth.user = { language: 'ja' };
    browser(['de']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('ja'));
    expect(getSettings).not.toHaveBeenCalled();
  });
  it('AC5 browser language wins over instance default', async () => {
    browser(['de-DE']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('de'));
    expect(getSettings).not.toHaveBeenCalled();
  });
  it('AC6 unsupported browser -> instance default', async () => {
    browser(['xx']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('fr'));
  });
  it('AC7 unsupported browser and no default -> en', async () => {
    browser(['xx']);
    vi.mocked(getSettings).mockResolvedValue({} as never);
    mount();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    await waitFor(() => expect(i18n.language).toBe('en'));
  });
  it('unsupported instance default is ignored', async () => {
    browser(['xx']);
    vi.mocked(getSettings).mockResolvedValue({ defaultLanguage: 'zz' } as never);
    mount();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(i18n.language).toBe('en');
  });
  it('EC5 settings read failure continues silently', async () => {
    browser(['xx']);
    vi.mocked(getSettings).mockRejectedValue(new Error('403'));
    mount();
    await waitFor(() => expect(getSettings).toHaveBeenCalled());
    expect(i18n.language).toBe('en');
  });
  it('no token: no settings call', async () => {
    localStorage.removeItem('lr_token');
    browser(['xx']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('en'));
    expect(getSettings).not.toHaveBeenCalled();
    expect(getMe).not.toHaveBeenCalled();
  });
  it('AC8 pt-BR browser', async () => {
    browser(['pt-BR']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('pt-BR'));
  });
  it('AC9 zh-TW browser', async () => {
    browser(['zh-TW']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('zh'));
  });
  it('EC1 falls to navigator.language when languages is empty', async () => {
    browser([], 'es');
    mount();
    await waitFor(() => expect(i18n.language).toBe('es'));
  });
  it('EC3 unsupported saved language is treated as absent', async () => {
    auth.user = { language: 'klingon' };
    browser(['it']);
    mount();
    await waitFor(() => expect(i18n.language).toBe('it'));
  });
  it('session restore adopts /me language; unsupported ignored', async () => {
    vi.mocked(getMe).mockResolvedValue({ language: 'ko' } as never);
    mount();
    await waitFor(() => expect(i18n.language).toBe('ko'));
  });
  it('session restore ignores unsupported /me language', async () => {
    browser(['nl']);
    vi.mocked(getMe).mockResolvedValue({ language: 'zz' } as never);
    mount();
    await waitFor(() => expect(getMe).toHaveBeenCalled());
    await waitFor(() => expect(i18n.language).toBe('nl'));
  });
  it('user language change after mount is applied', async () => {
    const { rerender } = mount();
    auth.user = { language: 'sv' };
    rerender(<LanguageProvider><Probe /></LanguageProvider>);
    await waitFor(() => expect(i18n.language).toBe('sv'));
  });
});

describe('AC10 direction', () => {
  it('RTL language sets rtl, switching to LTR returns without reload', async () => {
    browser(['ar']);
    mount();
    await waitFor(() => expect(document.documentElement.dir).toBe('rtl'));
    for (const c of ['he', 'fa', 'ur']) {
      await act(async () => { await setter(c); });
      expect(document.documentElement.dir).toBe('rtl');
    }
    await act(async () => { await setter('en'); });
    expect(document.documentElement.dir).toBe('ltr');
    expect(auth.updateUser).toHaveBeenCalledWith({ language: 'en' });
  });
});

describe('setLanguage (S3)', () => {
  it('EC1 failed save reverts language, direction and user, and rethrows', async () => {
    auth.user = { language: 'de' };
    mount();
    await waitFor(() => expect(i18n.language).toBe('de'));
    vi.mocked(updateMyLanguage).mockRejectedValueOnce(new Error('down'));
    await act(async () => { await expect(setter('ar')).rejects.toThrow('down'); });
    expect(i18n.language).toBe('de');
    expect(document.documentElement.dir).toBe('ltr');
    expect(auth.updateUser).toHaveBeenLastCalledWith({ language: 'de' });
  });
  it('EC3 saving is true during the save', async () => {
    mount();
    let release!: () => void;
    vi.mocked(updateMyLanguage).mockReturnValueOnce(new Promise(r => { release = () => r(undefined as never); }));
    let p!: Promise<void>;
    await act(async () => { p = setter('fr'); });
    expect(saving).toBe(true);
    await act(async () => { release(); await p; });
    expect(saving).toBe(false);
  });
  it('EC7 selecting the active language is a no-op', async () => {
    auth.user = { language: 'de' };
    mount();
    await waitFor(() => expect(i18n.language).toBe('de'));
    await act(async () => { await setter('de'); });
    expect(updateMyLanguage).not.toHaveBeenCalled();
  });
});
