/**
 * Update checker — polls GitHub Releases API to compare the running version
 * against the configured channel (latest, stable, develop, or a specific tag).
 *
 * Design:
 *  - Singleton instance, started once after server boot.
 *  - Checks at startup and every CHECK_INTERVAL_MS afterwards.
 *  - Result cached in-memory; callers read `getLastResult()`.
 *  - No external dependencies beyond Node.js built-in `https`.
 */

import { request as httpsRequest } from 'node:https';
import type { UpdateInfo, AvailableReleases } from '@routerly/shared';

const GITHUB_OWNER = 'Inebrio';
const GITHUB_REPO  = 'Routerly';
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

// ─── Semver comparison (no external deps) ─────────────────────────────────────

/** Parse "v1.2.3" or "1.2.3" into [major, minor, patch]. Returns null for non-semver tags. */
function parseSemver(tag: string): [number, number, number] | null {
  const clean = tag.startsWith('v') ? tag.slice(1) : tag;
  const parts = clean.split('.').map(Number);
  if (parts.length !== 3 || parts.some(n => !Number.isFinite(n))) return null;
  return parts as [number, number, number];
}

/** Returns true if `candidate` is strictly newer than `current`. */
function isNewer(candidate: string, current: string): boolean {
  const a = parseSemver(candidate);
  const b = parseSemver(current);
  if (!a || !b) return false;
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

// ─── GitHub Releases API ──────────────────────────────────────────────────────

interface GithubRelease {
  tag_name: string;
  html_url: string;
  prerelease: boolean;
  draft: boolean;
}

function fetchAllReleases(): Promise<GithubRelease[]> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases?per_page=100`,
      method: 'GET',
      headers: {
        'User-Agent': `routerly-update-checker/${GITHUB_OWNER}`,
        'Accept': 'application/vnd.github+json',
      },
      timeout: 10_000,
    };

    const req = httpsRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as GithubRelease[]);
          } catch (e) { reject(e); }
        } else {
          reject(new Error(`GitHub API returned ${res.statusCode}`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API request timed out')); });
    req.end();
  });
}

function fetchRelease(channel: string): Promise<GithubRelease> {
  return new Promise((resolve, reject) => {
    const path = channel === 'latest'
      ? `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/latest`
      : `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/releases/tags/${channel}`;

    const options = {
      hostname: 'api.github.com',
      path,
      method: 'GET',
      headers: {
        'User-Agent': `routerly-update-checker/${GITHUB_OWNER}`,
        'Accept': 'application/vnd.github+json',
      },
      timeout: 10_000,
    };

    const req = httpsRequest(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf-8')) as GithubRelease);
          } catch (e) {
            reject(e);
          }
        } else {
          reject(new Error(`GitHub API returned ${res.statusCode} for channel "${channel}"`));
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('GitHub API request timed out')); });
    req.end();
  });
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export class UpdateChecker {
  private _result: UpdateInfo | null = null;
  private _timer: ReturnType<typeof setInterval> | null = null;
  private _currentVersion = '';
  private _channel = 'latest';

  /** Start periodic checking. Safe to call multiple times (idempotent). */
  start(currentVersion: string, channel: string): void {
    this._currentVersion = currentVersion;
    this._channel = channel || 'latest';

    // Initial check (fire-and-forget, errors are swallowed)
    void this.check();

    if (!this._timer) {
      this._timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
      // Allow the process to exit without waiting for the timer
      if (this._timer.unref) this._timer.unref();
    }
  }

  /** Update the channel used for future checks (e.g. after settings change). */
  updateChannel(channel: string): void {
    this._channel = channel || 'latest';
  }

  /** Force an immediate check and return the result. */
  async check(): Promise<UpdateInfo> {
    const channel = this._channel;
    try {
      const release = await fetchRelease(channel);
      const latestVersion = release.tag_name.startsWith('v')
        ? release.tag_name.slice(1)
        : release.tag_name;

      const result: UpdateInfo = {
        available: isNewer(latestVersion, this._currentVersion),
        currentVersion: this._currentVersion,
        latestVersion,
        channel,
        releaseUrl: release.html_url,
        checkedAt: new Date().toISOString(),
      };
      this._result = result;
      return result;
    } catch {
      // Network errors, rate limits, etc. — return a safe fallback
      const fallback: UpdateInfo = {
        available: false,
        currentVersion: this._currentVersion,
        latestVersion: this._currentVersion,
        channel,
        checkedAt: new Date().toISOString(),
      };
      // Only overwrite cached result if we have none yet
      if (!this._result) this._result = fallback;
      return this._result;
    }
  }

  /** Fetch available channels and version tags from GitHub Releases. Falls back to defaults on error. */
  async getAvailableReleases(): Promise<AvailableReleases> {
    try {
      const releases = await fetchAllReleases();
      const channels: string[] = ['latest'];
      const versions: string[] = [];
      for (const r of releases) {
        if (r.draft) continue;
        const tag = r.tag_name;
        if (parseSemver(tag)) {
          versions.push(tag);
        } else if (!channels.includes(tag)) {
          channels.push(tag);
        }
      }
      return { channels, versions };
    } catch {
      return { channels: ['latest', 'stable', 'develop'], versions: [] };
    }
  }

  /** Return the last cached result, or null if no check has completed yet. */
  getLastResult(): UpdateInfo | null {
    return this._result;
  }

  /** Stop the background interval (used in tests). */
  stop(): void {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }
}

export const updateChecker = new UpdateChecker();
