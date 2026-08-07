import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n from './i18n';
import { SUPPORTED_LANGUAGES } from './locales/languages';
import { useAuth } from './AuthContext';
import { getMe, getSettings, updateMyLanguage } from './api';

interface LanguageContextValue {
  language: string;
  setLanguage: (code: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  /* v8 ignore next */
  setLanguage: async () => {},
});

/** Browser locale, narrowed to a code we actually ship a catalog for. Null when no match. */
function detectBrowserLanguage(): string | null {
  const browserCode = navigator.language?.split('-')[0];
  const match = SUPPORTED_LANGUAGES.find(l => l.code === browserCode);
  return match?.code ?? null;
}

function applyDirection(code: string) {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
  document.documentElement.dir = lang?.rtl ? 'rtl' : 'ltr';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  const [language, setLanguageState] = useState<string>(() => user?.language ?? detectBrowserLanguage() ?? 'en');

  // Session restore (reload with an existing token but no in-memory user yet): AuthContext
  // seeds `user` from localStorage synchronously, so this only hits the network when that
  // cache is missing/stale, avoiding a duplicate fetch on the common path.
  useEffect(() => {
    if (user?.language) return;
    if (user) return;
    const token = localStorage.getItem('lr_token');
    if (!token) return;
    getMe()
      .then(me => {
        if (me.language) setLanguageState(me.language);
      })
      .catch(/* v8 ignore next */ () => { /* not logged in / unreachable — fall back stays */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fallback tier: no personal pick and the browser locale isn't one we ship a
  // catalog for → ask the instance-wide default before settling on English.
  // Best-effort only: a viewer without settings:read (custom role) just keeps 'en'.
  useEffect(() => {
    if (user?.language || detectBrowserLanguage()) return;
    const token = localStorage.getItem('lr_token');
    if (!token) return;
    getSettings()
      .then(settings => {
        const code = settings.defaultLanguage;
        if (code && SUPPORTED_LANGUAGES.some(l => l.code === code)) {
          setLanguageState(current => (current === 'en' ? code : current));
        }
      })
      .catch(/* v8 ignore next */ () => { /* no settings:read or unreachable — 'en' stays */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (user?.language && user.language !== language) {
      setLanguageState(user.language);
    }
  }, [user?.language]);

  useEffect(() => {
    i18n.changeLanguage(language);
    applyDirection(language);
  }, [language]);

  async function setLanguage(code: string) {
    setLanguageState(code);
    await i18n.changeLanguage(code);
    applyDirection(code);
    updateUser({ language: code });
    await updateMyLanguage(code).catch(/* v8 ignore next */ () => { /* best-effort: local UI already switched */ });
  }

  return (
    <LanguageContext.Provider value={{ language, setLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
