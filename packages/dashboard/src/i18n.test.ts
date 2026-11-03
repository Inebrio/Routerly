import { describe, it, expect, afterEach } from 'vitest';
import i18n from './i18n';

const en = 'Hello {{name}}';
describe('i18n English fallback', () => {
  afterEach(() => { i18n.changeLanguage('en'); });
  it('AC1 missing key, AC2 empty, AC3 null fall back to English; EC4 interpolation kept', async () => {
    i18n.addResourceBundle('en', 'translation', { t: { greet: en } }, true, true);
    i18n.addResourceBundle('de', 'translation', { t: { empty: '', nul: null, greetEmpty: '', greetNull: null } }, true, true);
    i18n.addResourceBundle('en', 'translation', { t: { empty: 'E', nul: 'N', missing: 'M', greetEmpty: en, greetNull: en } }, true, true);
    await i18n.changeLanguage('de');
    expect(i18n.t('t.missing')).toBe('M');
    expect(i18n.t('t.empty')).toBe('E');
    expect(i18n.t('t.nul')).toBe('N');
    expect(i18n.t('t.greetEmpty', { name: 'Ann' })).toBe('Hello Ann');
    expect(i18n.t('t.greetNull', { name: 'Bob' })).toBe('Hello Bob');
  });
});
