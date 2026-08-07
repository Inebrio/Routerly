export interface SupportedLanguage {
  code: string;
  name: string;
  rtl: boolean;
}

// ponytail: only catalogs that actually exist under src/locales/*.json get an entry here.
// Task 6 populates the rest once their .json files land.
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', rtl: false },
];
