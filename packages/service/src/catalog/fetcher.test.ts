import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createHash } from 'node:crypto';

// Fresh instance per test group — import after stubbing fetch
async function freshFetcher() {
  vi.resetModules();
  const mod = await import('./fetcher.js');
  return mod.catalogFetcher;
}

const CATALOG = JSON.stringify({ openai: { endpoint: 'https://api.openai.com/v1', models: [] } });

function sha256(s: string) {
  return createHash('sha256').update(s).digest('hex');
}

function mockFetch(responses: Record<string, { ok: boolean; body?: string; status?: number }>) {
  vi.stubGlobal('fetch', async (url: string) => {
    const key = Object.keys(responses).find((k) => url.endsWith(k));
    const r = key !== undefined ? responses[key] ?? { ok: false, status: 404 } : { ok: false, status: 404 };
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 404),
      json: async () => JSON.parse(r.body ?? '{}'),
      text: async () => r.body ?? '',
    };
  });
}

describe('CatalogFetcher', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  describe('resolveFile — channel override', () => {
    it('uses channelOverride from repo.channel when present', async () => {
      const index = JSON.stringify({
        schemaVersion: 1,
        channels: { stable: 'providers-stable.json', beta: 'providers-beta.json' },
        default: 'stable',
      });
      mockFetch({
        'index.json': { ok: true, body: index },
        'providers-beta.json': { ok: true, body: CATALOG },
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true, channel: 'beta' }]);
      const result = await fetcher.get('0.2.0');
      expect(result).toHaveProperty('openai');
    });
  });

  describe('resolveFile — semver range', () => {
    it('selects file by matching semver range', async () => {
      const index = JSON.stringify({
        schemaVersion: 1,
        versions: { '>=0.2.0': 'providers-v2.json', '<0.2.0': 'providers-v1.json' },
      });
      const catalog = JSON.stringify({ anthropic: { endpoint: 'https://api.anthropic.com', models: [] } });
      mockFetch({
        'index.json': { ok: true, body: index },
        'providers-v2.json': { ok: true, body: catalog },
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);
      const result = await fetcher.get('0.3.0');
      expect(result).toHaveProperty('anthropic');
    });

    it('falls back to default channel when no semver range matches', async () => {
      const index = JSON.stringify({
        schemaVersion: 1,
        default: 'stable',
        channels: { stable: 'providers-stable.json' },
        versions: { '>=1.0.0': 'providers-v2.json' },
      });
      mockFetch({
        'index.json': { ok: true, body: index },
        'providers-stable.json': { ok: true, body: CATALOG },
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);
      const result = await fetcher.get('0.2.0'); // does not satisfy >=1.0.0
      expect(result).toHaveProperty('openai');
    });
  });

  describe('resolveFile — providers.json fallback', () => {
    it('falls back to providers.json when index.json is unavailable', async () => {
      mockFetch({
        'index.json': { ok: false, status: 404 },
        'providers.json': { ok: true, body: CATALOG },
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);
      const result = await fetcher.get('0.2.0');
      expect(result).toHaveProperty('openai');
    });
  });

  describe('cache TTL', () => {
    it('returns cached data on second call within TTL without re-fetching', async () => {
      const fetchSpy = vi.fn(async (url: string) => {
        if (url.endsWith('index.json')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => JSON.parse(CATALOG), text: async () => CATALOG };
      });
      vi.stubGlobal('fetch', fetchSpy);
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);

      await fetcher.get('0.2.0');
      const callsAfterFirst = fetchSpy.mock.calls.length;

      await fetcher.get('0.2.0'); // within TTL
      expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst); // no new fetch calls
    });

    it('re-fetches after invalidate()', async () => {
      let callCount = 0;
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.endsWith('index.json')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        callCount++;
        return { ok: true, status: 200, json: async () => JSON.parse(CATALOG), text: async () => CATALOG };
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);

      await fetcher.get('0.2.0');
      const firstCount = callCount;

      fetcher.invalidate();
      await fetcher.get('0.2.0');
      expect(callCount).toBeGreaterThan(firstCount);
    });
  });

  describe('checksum verification', () => {
    it('throws on checksum mismatch', async () => {
      const index = JSON.stringify({
        schemaVersion: 1,
        channels: { stable: 'providers-stable.json' },
        default: 'stable',
        providers: {
          'providers-stable.json': { checksum: { sha256: 'deadbeef' } },
        },
      });
      mockFetch({
        'index.json': { ok: true, body: index },
        'providers-stable.json': { ok: true, body: CATALOG },
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);

      // fetchRepo throws, but get() swallows per-repo errors and returns empty merged
      // We need to call fetchRepo directly — access via get() returning empty
      const result = await fetcher.get('0.2.0');
      // The repo errored due to checksum mismatch, so merged is empty
      expect(Object.keys(result)).toHaveLength(0);
    });

    it('accepts a correct checksum', async () => {
      const checksum = sha256(CATALOG);
      const index = JSON.stringify({
        schemaVersion: 1,
        channels: { stable: 'providers-stable.json' },
        default: 'stable',
        providers: {
          'providers-stable.json': { checksum: { sha256: checksum } },
        },
      });
      mockFetch({
        'index.json': { ok: true, body: index },
        'providers-stable.json': { ok: true, body: CATALOG },
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([{ url: 'https://example.com/', enabled: true }]);
      const result = await fetcher.get('0.2.0');
      expect(result).toHaveProperty('openai');
    });
  });

  describe('multi-repo merging', () => {
    it('first repo wins when keys overlap', async () => {
      // Implementation reverses repos before iterating, then Object.assign — so repo[0] is applied last and wins
      const catalog1 = JSON.stringify({ openai: { endpoint: 'https://custom.example.com/v1', models: [] } });
      const catalog2 = JSON.stringify({ openai: { endpoint: 'https://api.openai.com/v1', models: [] } });

      vi.stubGlobal('fetch', async (url: string) => {
        if (url.endsWith('index.json')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        // Route by host
        const body = url.includes('repo1') ? catalog1 : catalog2;
        return { ok: true, status: 200, json: async () => JSON.parse(body), text: async () => body };
      });

      const fetcher = await freshFetcher();
      fetcher.setRepos([
        { url: 'https://repo1.example.com/', enabled: true },
        { url: 'https://repo2.example.com/', enabled: true },
      ]);
      const result = await fetcher.get('0.2.0');
      // First repo (index 0) wins because it is applied last (reversed iteration + Object.assign)
      expect((result as any).openai.endpoint).toBe('https://custom.example.com/v1');
    });

    it('skips disabled repos', async () => {
      const fetchSpy = vi.fn(async () => ({
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => '',
      }));
      vi.stubGlobal('fetch', fetchSpy);
      const fetcher = await freshFetcher();
      fetcher.setRepos([
        { url: 'https://disabled.example.com/', enabled: false },
      ]);
      await fetcher.get('0.2.0'); // should not fetch disabled repo
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('continues when one repo fails', async () => {
      const catalog = JSON.stringify({ anthropic: { endpoint: 'https://api.anthropic.com', models: [] } });
      vi.stubGlobal('fetch', async (url: string) => {
        if (url.endsWith('index.json')) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
        if (url.includes('bad')) return { ok: false, status: 500, json: async () => ({}), text: async () => '' };
        return { ok: true, status: 200, json: async () => JSON.parse(catalog), text: async () => catalog };
      });
      const fetcher = await freshFetcher();
      fetcher.setRepos([
        { url: 'https://bad.example.com/', enabled: true },
        { url: 'https://good.example.com/', enabled: true },
      ]);
      const result = await fetcher.get('0.2.0');
      expect(result).toHaveProperty('anthropic');
    });
  });

  describe('setRepos', () => {
    it('falls back to DEFAULT_REPO when given empty array', async () => {
      // DEFAULT_REPO points to github, which won't resolve in test — just verify no throw from logic
      vi.stubGlobal('fetch', async () => ({ ok: false, status: 404, json: async () => ({}), text: async () => '' }));
      const fetcher = await freshFetcher();
      fetcher.setRepos([]);
      // get() silently returns empty on all-failed repos
      const result = await fetcher.get('0.2.0');
      expect(result).toEqual({});
    });
  });
});
