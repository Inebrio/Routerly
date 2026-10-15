import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

describe('web provider instructions (ROUT-289)', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  it.each(files)('%s has current sessionKey hints and no stale sid01', (f) => {
    const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).common.connectionFields.webProvider;
    expect(w.anthropicInstructions).toContain('sk-ant-sid');
    expect(w.anthropicInstructions).toContain('Storage');
    expect(w.sessionTokenPlaceholder).toContain('sk-ant-sid');
    expect(JSON.stringify(w)).not.toContain('sid01');
  });
});
