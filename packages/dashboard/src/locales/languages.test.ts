import { describe, it, expect } from 'vitest';
import { matchBrowserLanguage, isSupportedLanguage } from './languages';

describe('matchBrowserLanguage', () => {
  it('AC5 supported primary subtag', () => {
    expect(matchBrowserLanguage(['de-AT'])).toBe('de');
    expect(matchBrowserLanguage(['en-US'])).toBe('en');
  });
  it('AC8 pt-BR vs other Portuguese', () => {
    expect(matchBrowserLanguage(['pt-BR'])).toBe('pt-BR');
    expect(matchBrowserLanguage(['pt-PT'])).toBe('pt');
    expect(matchBrowserLanguage(['pt'])).toBe('pt');
    expect(matchBrowserLanguage(['pt-AO'])).toBe('pt');
  });
  it('AC9 every Chinese variant maps to zh', () => {
    for (const t of ['zh', 'zh-CN', 'zh-TW', 'zh-HK', 'zh-Hant', 'zh-Hans-CN']) expect(matchBrowserLanguage([t])).toBe('zh');
  });
  it('EC1 first supported tag wins', () => {
    expect(matchBrowserLanguage(['xx-YY', 'fr-CA', 'de'])).toBe('fr');
  });
  it('EC2 casing and underscore', () => {
    expect(matchBrowserLanguage(['pt_br'])).toBe('pt-BR');
    expect(matchBrowserLanguage(['PT-br'])).toBe('pt-BR');
    expect(matchBrowserLanguage(['ZH_tw'])).toBe('zh');
  });
  it('null when nothing matches or list empty', () => {
    expect(matchBrowserLanguage(['xx'])).toBeNull();
    expect(matchBrowserLanguage([])).toBeNull();
  });
  it('isSupportedLanguage', () => {
    expect(isSupportedLanguage('pt-BR')).toBe(true);
    expect(isSupportedLanguage('xx')).toBe(false);
  });
});
