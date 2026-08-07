import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import ar from './locales/ar.json';

// ponytail: catalogs are static-imported one by one; later tasks add each new
// locale's json here as it lands, no dynamic-import machinery for ~40 files.
const resources = {
  en: { translation: en },
  es: { translation: es },
  ar: { translation: ar },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en', // AC4: a missing key falls back to the English resource, never a raw key
    interpolation: { escapeValue: false },
  });

export default i18n;
