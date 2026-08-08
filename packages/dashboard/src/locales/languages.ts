export interface SupportedLanguage {
  code: string;
  name: string;
  rtl: boolean;
  /** Representative flag emoji — language != country, picked by convention (most speakers / origin). */
  flag: string;
}

// Full target list per KB note "Multi lingua" (Evolutive/Next): ~40 languages
// (42 nominal entries; Portuguese and Indonesian counted as two variants each
// in the original note, though a single modern 'id' code covers Indonesian
// here — the "two variants" was a legacy ISO 639-1 alias, not a live locale).
export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: 'en', name: 'English', rtl: false, flag: '🇬🇧' },
  { code: 'ar', name: 'العربية', rtl: true, flag: '🇸🇦' },
  { code: 'az', name: 'Azərbaycan dili', rtl: false, flag: '🇦🇿' },
  { code: 'bg', name: 'Български', rtl: false, flag: '🇧🇬' },
  { code: 'bn', name: 'বাংলা', rtl: false, flag: '🇧🇩' },
  { code: 'cs', name: 'Čeština', rtl: false, flag: '🇨🇿' },
  { code: 'da', name: 'Dansk', rtl: false, flag: '🇩🇰' },
  { code: 'de', name: 'Deutsch', rtl: false, flag: '🇩🇪' },
  { code: 'es', name: 'Español', rtl: false, flag: '🇪🇸' },
  { code: 'fa', name: 'فارسی', rtl: true, flag: '🇮🇷' },
  { code: 'fi', name: 'Suomi', rtl: false, flag: '🇫🇮' },
  { code: 'fil', name: 'Filipino', rtl: false, flag: '🇵🇭' },
  { code: 'fr', name: 'Français', rtl: false, flag: '🇫🇷' },
  { code: 'gu', name: 'ગુજરાતી', rtl: false, flag: '🇮🇳' },
  { code: 'he', name: 'עברית', rtl: true, flag: '🇮🇱' },
  { code: 'hi', name: 'हिन्दी', rtl: false, flag: '🇮🇳' },
  { code: 'hu', name: 'Magyar', rtl: false, flag: '🇭🇺' },
  { code: 'id', name: 'Bahasa Indonesia', rtl: false, flag: '🇮🇩' },
  { code: 'it', name: 'Italiano', rtl: false, flag: '🇮🇹' },
  { code: 'ja', name: '日本語', rtl: false, flag: '🇯🇵' },
  { code: 'ko', name: '한국어', rtl: false, flag: '🇰🇷' },
  { code: 'mr', name: 'मराठी', rtl: false, flag: '🇮🇳' },
  { code: 'ms', name: 'Bahasa Melayu', rtl: false, flag: '🇲🇾' },
  { code: 'nl', name: 'Nederlands', rtl: false, flag: '🇳🇱' },
  { code: 'no', name: 'Norsk', rtl: false, flag: '🇳🇴' },
  { code: 'pl', name: 'Polski', rtl: false, flag: '🇵🇱' },
  { code: 'pt', name: 'Português', rtl: false, flag: '🇵🇹' },
  { code: 'pt-BR', name: 'Português (Brasil)', rtl: false, flag: '🇧🇷' },
  { code: 'ro', name: 'Română', rtl: false, flag: '🇷🇴' },
  { code: 'ru', name: 'Русский', rtl: false, flag: '🇷🇺' },
  { code: 'sk', name: 'Slovenčina', rtl: false, flag: '🇸🇰' },
  { code: 'sv', name: 'Svenska', rtl: false, flag: '🇸🇪' },
  { code: 'sw', name: 'Kiswahili', rtl: false, flag: '🇰🇪' },
  { code: 'ta', name: 'தமிழ்', rtl: false, flag: '🇮🇳' },
  { code: 'te', name: 'తెలుగు', rtl: false, flag: '🇮🇳' },
  { code: 'th', name: 'ไทย', rtl: false, flag: '🇹🇭' },
  { code: 'tr', name: 'Türkçe', rtl: false, flag: '🇹🇷' },
  { code: 'uk', name: 'Українська', rtl: false, flag: '🇺🇦' },
  { code: 'ur', name: 'اردو', rtl: true, flag: '🇵🇰' },
  { code: 'vi', name: 'Tiếng Việt', rtl: false, flag: '🇻🇳' },
  { code: 'zh', name: '简体中文', rtl: false, flag: '🇨🇳' },
];
