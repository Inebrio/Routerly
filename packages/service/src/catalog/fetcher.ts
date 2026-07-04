import { createHash } from 'node:crypto';
import semver from 'semver';
import type { ProviderRepo } from '@routerly/shared';

interface IndexJson {
  schemaVersion: number;
  default?: string;
  channels?: Record<string, string>;
  versions?: Record<string, string>; // keys are semver ranges
  providers?: Record<string, {
    createdAt?: string;
    updatedAt?: string;
    checksum?: { sha256?: string };
  }>;
}

export type ProviderCatalog = Record<string, {
  endpoint: string;
  models: Array<{
    id: string;
    input: number;
    output: number;
    cache?: number;
    cacheWrite?: number;
    contextWindow?: number;
    notes?: string;
    deprecated?: boolean;
    capabilities?: { embedding?: boolean };
    pricingTiers?: Array<{
      metric: string;
      above: number;
      input: number;
      output: number;
      cache?: number;
    }>;
  }>;
}>;

const DEFAULT_REPO: ProviderRepo = {
  url: 'https://raw.githubusercontent.com/Inebrio/Routerly-Providers/main/',
  enabled: true,
};

const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface RepoStatus {
  url: string;
  enabled: boolean;
  resolvedFile: string | null;
  updatedAt: string | null;
  lastChecked: string | null;
  error: string | null;
}

interface RepoMeta {
  upstreamUpdatedAt: string | null;
  resolvedFile: string;
}

interface FetchResult {
  catalog: ProviderCatalog | null; // null = no change, use cached
  resolvedFile: string;
  changed: boolean;
  upstreamMeta: RepoMeta | null;
}

class CatalogFetcher {
  private cache: { data: ProviderCatalog; expiresAt: number; checkedAt: string } | null = null;
  private repos: ProviderRepo[] = [DEFAULT_REPO];
  private repoStatus: Map<string, RepoStatus> = new Map();
  private repoMeta: Map<string, RepoMeta> = new Map();
  private repoCatalog: Map<string, ProviderCatalog> = new Map();

  setRepos(repos: ProviderRepo[]): void {
    this.repos = repos.length ? repos : [DEFAULT_REPO];
    this.cache = null;
    this.repoStatus.clear();
    this.repoMeta.clear();
    this.repoCatalog.clear();
  }

  invalidate(): void {
    this.cache = null;
    this.repoStatus.clear();
    this.repoMeta.clear();
    this.repoCatalog.clear();
  }

  getStatus(): RepoStatus[] {
    return this.repos.map(r => this.repoStatus.get(r.url) ?? {
      url: r.url,
      enabled: r.enabled,
      resolvedFile: null,
      updatedAt: null,
      lastChecked: null,
      error: null,
    });
  }

  async get(routerlyVersion: string): Promise<ProviderCatalog> {
    const now = Date.now();
    if (this.cache && now < this.cache.expiresAt) return this.cache.data;

    const checkedAt = new Date().toISOString();

    for (const repo of this.repos) {
      if (!repo.enabled) {
        this.repoStatus.set(repo.url, { url: repo.url, enabled: false, resolvedFile: null, updatedAt: null, lastChecked: checkedAt, error: null });
        this.repoCatalog.delete(repo.url);
        continue;
      }
      try {
        const prev = this.repoStatus.get(repo.url);
        const result = await this.fetchRepo(repo, routerlyVersion, this.repoMeta.get(repo.url) ?? null);
        if (result.changed && result.catalog) {
          this.repoCatalog.set(repo.url, result.catalog);
          if (result.upstreamMeta) this.repoMeta.set(repo.url, result.upstreamMeta);
        }
        this.repoStatus.set(repo.url, {
          url: repo.url, enabled: true, resolvedFile: result.resolvedFile,
          updatedAt: result.changed ? checkedAt : (prev?.updatedAt ?? checkedAt),
          lastChecked: checkedAt, error: null,
        });
      } catch (err) {
        const prev = this.repoStatus.get(repo.url);
        this.repoStatus.set(repo.url, { url: repo.url, enabled: true, resolvedFile: prev?.resolvedFile ?? null, updatedAt: prev?.updatedAt ?? null, lastChecked: checkedAt, error: (err as Error).message });
      }
    }

    // Merge in reverse order so first repo wins
    const merged: ProviderCatalog = {};
    for (const repo of [...this.repos].reverse()) {
      const cat = this.repoCatalog.get(repo.url);
      if (cat && repo.enabled) Object.assign(merged, cat);
    }
    this.cache = { data: merged, expiresAt: now + CACHE_TTL_MS, checkedAt };
    return merged;
  }

  private async fetchRepo(repo: ProviderRepo, routerlyVersion: string, prevMeta: RepoMeta | null): Promise<FetchResult> {
    const base = repo.url.endsWith('/') ? repo.url : repo.url + '/';

    let filePath: string | null = null;
    let checksumExpected: string | null = null;
    let upstreamUpdatedAt: string | null = null;

    try {
      const indexRes = await fetch(base + 'index.json');
      if (indexRes.ok) {
        const index = await indexRes.json() as IndexJson;
        filePath = this.resolveFile(index, routerlyVersion, repo.channel);
        if (filePath) {
          const meta = index.providers?.[filePath];
          checksumExpected = meta?.checksum?.sha256 ?? null;
          upstreamUpdatedAt = meta?.updatedAt ?? null;
        }
      }
    } catch {
      // index.json unavailable, fall through to direct file
    }

    if (!filePath) filePath = 'providers.json';

    // Skip download if upstream signals no change
    if (
      upstreamUpdatedAt &&
      prevMeta?.upstreamUpdatedAt === upstreamUpdatedAt &&
      prevMeta?.resolvedFile === filePath &&
      this.repoCatalog.has(repo.url)
    ) {
      return { catalog: null, resolvedFile: filePath, changed: false, upstreamMeta: null };
    }

    const fileRes = await fetch(base + filePath);
    if (!fileRes.ok) throw new Error(`Failed to fetch ${base + filePath}: ${fileRes.status}`);

    const text = await fileRes.text();

    if (checksumExpected) {
      const actual = createHash('sha256').update(text).digest('hex');
      if (actual !== checksumExpected) {
        throw new Error(`Checksum mismatch for ${filePath}: expected ${checksumExpected}, got ${actual}`);
      }
    }

    return {
      catalog: JSON.parse(text) as ProviderCatalog,
      resolvedFile: filePath,
      changed: true,
      upstreamMeta: { upstreamUpdatedAt, resolvedFile: filePath },
    };
  }

  private resolveFile(index: IndexJson, routerlyVersion: string, channelOverride?: string): string | null {
    const ch = channelOverride ?? index.default;
    if (ch && index.channels?.[ch]) return index.channels[ch] ?? null;

    for (const [range, file] of Object.entries(index.versions ?? {})) {
      if (semver.satisfies(routerlyVersion, range)) return file;
    }

    if (index.default && index.channels?.[index.default]) return index.channels[index.default] ?? null;

    return null;
  }
}

export const catalogFetcher = new CatalogFetcher();
