export interface SupportedLanguage {
  code: string;
  name: string;
  rtl: boolean;
}

// ponytail: only catalogs that actually exist under src/locales/*.json get an entry here.
// Remaining ~40-language coverage lands incrementally, each with its own .json file.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', rtl: false },
  { code: 'es', name: 'Español', rtl: false },
  { code: 'ar', name: 'العربية', rtl: true },
];
