import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import i18n from './i18n';
import { SUPPORTED_LANGUAGES } from './locales/languages';
import { useAuth } from './AuthContext';
import { getMe, updateMyLanguage } from './api';

interface LanguageContextValue {
  language: string;
  setLanguage: (code: string) => Promise<void>;
}

const LanguageContext = createContext<LanguageContextValue>({
  language: 'en',
  /* v8 ignore next */
  setLanguage: async () => {},
});

/** Browser locale, narrowed to a code we actually ship a catalog for (EC2: no match → 'en'). */
function detectBrowserLanguage(): string {
  const browserCode = navigator.language?.split('-')[0];
  const match = SUPPORTED_LANGUAGES.find(l => l.code === browserCode);
  return match?.code ?? 'en';
}

function applyDirection(code: string) {
  const lang = SUPPORTED_LANGUAGES.find(l => l.code === code);
  document.documentElement.dir = lang?.rtl ? 'rtl' : 'ltr';
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, updateUser } = useAuth();
  const [language, setLanguageState] = useState<string>(() => user?.language ?? detectBrowserLanguage());

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
