import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n from './i18n';
import { SUPPORTED_LANGUAGES, isSupportedLanguage, matchBrowserLanguage } from './locales/languages';
import { useAuth } from './AuthContext';
import { getMe, getSettings, updateMyLanguage } from './api';

interface LanguageContextValue {
  language: string;
  saving: boolean;
  setLanguage: (code: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  saving: false,
  /* v8 ignore next */
  setLanguage: async () => {},
});

/** Browser locale, narrowed to a code we actually ship a catalog for. Null when no match. */
function detectBrowserLanguage(): string | null {
  return matchBrowserLanguage(navigator.languages?.length ? navigator.languages : [navigator.language]);
}

/** A saved language no longer shipped is treated as absent (EC3). */
function savedLanguage(code: string | null | undefined): string | null {
  return code && isSupportedLanguage(code) ? code : null;
}

function applyDirection(code: string) {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
  document.documentElement.dir = lang?.rtl ? 'rtl' : 'ltr';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  const [language, setLanguageState] = useState<string>(() => savedLanguage(user?.language) ?? detectBrowserLanguage() ?? 'en');
  const [saving, setSaving] = useState(false);

  // Session restore (reload with an existing token but no in-memory user yet): AuthContext
  // seeds `user` from localStorage synchronously, so this only hits the network when that
  // cache is missing/stale, avoiding a duplicate fetch on the common path.
  useEffect(() => {
    if (user) return;
    const token = localStorage.getItem('lr_token');
    if (!token) return;
    getMe()
      .then(me => {
        const saved = savedLanguage(me.language);
        if (saved) setLanguageState(saved);
      })
      .catch(/* v8 ignore next */ () => { /* not logged in / unreachable — fall back stays */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback tier: no personal pick and the browser locale isn't one we ship a
  // catalog for → ask the instance-wide default before settling on English.
  // Best-effort only: a viewer without settings:read (custom role) just keeps 'en'.
  useEffect(() => {
    if (savedLanguage(user?.language) || detectBrowserLanguage()) return;
    const token = localStorage.getItem('lr_token');
    if (!token) return;
    getSettings()
      .then(settings => {
        const code = settings.defaultLanguage;
        if (code && isSupportedLanguage(code)) {
          setLanguageState(current => (current === 'en' ? code : current));
        }
      })
      .catch(/* v8 ignore next */ () => { /* no settings:read or unreachable — 'en' stays */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const saved = savedLanguage(user?.language);
    if (saved && saved !== language) setLanguageState(saved);
  }, [user?.language]);

  useEffect(() => {
    i18n.changeLanguage(language);
    applyDirection(language);
  }, [language]);

  /** Switches immediately; on a failed save reverts to the previous language and rethrows. */
  async function setLanguage(code: string) {
    if (code === language || saving) return;
    const previous = language;
    const previousUser = user?.language ?? previous;
    const apply = async (c: string, persisted: string) => {
      setLanguageState(c);
      await i18n.changeLanguage(c);
      applyDirection(c);
      updateUser({ language: persisted });
    };
    setSaving(true);
    try {
      await apply(code, code);
      await updateMyLanguage(code);
    } catch (e) {
      await apply(previous, previousUser);
      throw e;
    } finally {
      setSaving(false);
    }
  }

  return (
    <LanguageContext.Provider value={{ language, saving, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
