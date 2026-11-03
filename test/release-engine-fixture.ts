/**
 * Fixture builder for `release.config.mjs`'s `@semantic-release/exec` plugin
 * (story RC-1, T4/T5/T6).
 *
 * The config's `prepareCmd`/`publishCmd` are plain shell commands run from a
 * repository root, so exercising them means building a real, throwaway npm
 * workspace + git repository under the OS temp directory: five stub
 * manifests (root + `packages/cli`, `packages/dashboard`, `packages/shared`,
 * `packages/service`), a stub `packages/service/src/index.ts` and a *copy*
 * of the real `scripts/sync-module-versions.mjs`. This never touches the
 * worktree's own git history, its own manifests or its own `node_modules`:
 * every fixture lives under `os.tmpdir()` and is removed after each test.
 *
 * No manifest declares a `dependencies` field, so `npm install
 * --package-lock-only` and `npm version --workspaces` both complete offline
 * in well under a second — measured ~425ms for the version step alone. If a
 * future edit adds a real dependency to any fixture manifest, the suite
 * starts touching the network and slows down by an order of magnitude; that
 * is a sign the manifest shape drifted from what this file is for.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..')
export const REAL_RELEASE_CONFIG = path.join(REPO_ROOT, 'release.config.mjs')
export const REAL_SYNC_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-module-versions.mjs')

const WORKSPACE_PACKAGES = ['cli', 'dashboard', 'shared', 'service'] as const

export interface Fixture {
  root: string
}

/**
 * Builds a throwaway npm workspace + git repository:
 *
 * - root `package.json`: `{"name": "routerly-fixture", "version": "0.0.0", "private": true, "workspaces": ["packages/*"]}`
 * - `packages/{cli,dashboard,shared,service}/package.json`: `{"name": "@routerly/<name>", "version": "0.0.0", "private": true}`
 * - `packages/service/src/index.ts`: a `version:` literal and a `^0.0.0` dependency range
 * - `scripts/sync-module-versions.mjs`: byte-for-byte copy of the real script
 * - an initial `package-lock.json` (via `npm install --package-lock-only`,
 *   offline since no manifest has a `dependencies` field) so the prepare
 *   step has a lockfile to rewrite, matching what a real checkout carries
 * - a git repository with one seed commit
 */
export function buildFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc1-release-engine-'))

  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      { name: 'routerly-fixture', version: '0.0.0', private: true, workspaces: ['packages/*'] },
      null,
      2,
    ) + '\n',
  )

  for (const name of WORKSPACE_PACKAGES) {
    const dir = path.join(root, 'packages', name)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: `@routerly/${name}`, version: '0.0.0', private: true }, null, 2) + '\n',
    )
  }

  const serviceSrcDir = path.join(root, 'packages', 'service', 'src')
  fs.mkdirSync(serviceSrcDir, { recursive: true })
  fs.writeFileSync(
    path.join(serviceSrcDir, 'index.ts'),
    "export const meta = {\n  version: '0.0.0',\n};\nexport const dep = '^0.0.0';\n",
  )

  const scriptsDir = path.join(root, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.copyFileSync(REAL_SYNC_SCRIPT, path.join(scriptsDir, 'sync-module-versions.mjs'))

  // Mirrors the real repository's own `.gitignore` (`node_modules/`). Without
  // it, `npm install --package-lock-only` on a workspace still materializes
  // `node_modules/@routerly/*` symlinks, which would otherwise show up as
  // stray untracked files under `git ls-files --others --exclude-standard`
  // (T5's publishCmd test asserts against exactly that list).
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n')

  npm(root, ['install', '--package-lock-only'])

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'RC-1 Fixture'])
  git(root, ['config', 'user.email', 'rc1-fixture@example.test'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  git(root, ['add', '-A'])
  git(root, ['commit', '-q', '-m', 'chore: seed fixture repository'])

  return { root }
}

export function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
}

function npm(cwd: string, args: string[]): void {
  const result = spawnSync('npm', args, { cwd, encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`npm ${args.join(' ')} failed: ${result.stderr}`)
  }
}

export interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Runs a shell command string inside the fixture's working tree. */
export function runInFixture(fixture: Fixture, command: string): RunResult {
  const result = spawnSync('bash', ['-c', command], { cwd: fixture.root, encoding: 'utf-8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}

/**
 * Loads the real `release.config.mjs`'s default export. A plain dynamic
 * `import()` of the worktree's own config file — never a copy — so every
 * test proves the config that actually ships.
 */
export async function loadReleaseConfig(): Promise<any> {
  const mod = await import(pathToFileURL(REAL_RELEASE_CONFIG).href)
  return mod.default
}

/**
 * Expands a semantic-release Lodash-template-style command string
 * (`${nextRelease.version}`) to a concrete version. semantic-release itself
 * expands these with `lodash-es`'s `template()`, but `lodash`/`lodash-es`
 * are not a direct dependency of this repository (only scoped
 * `lodash.<fn>` utility packages are, transitively), so this uses a plain
 * string replace instead of pulling in a new dependency for one
 * interpolation.
 */
export function expandNextReleaseVersion(command: string, version: string): string {
  return command.replace(/\$\{nextRelease\.version\}/g, version)
}

/**
 * Runs the real `commitlint.config.js` against a commit message string, the
 * way `.husky/commit-msg` does (`commitlint --edit`), but fed via stdin so
 * no throwaway file is needed. Not exercised by this task's own tests —
 * kept here because task 5/6 import this fixture module for their own
 * commit-message and notes-generator assertions.
 */
export function runCommitlint(message: string): RunResult {
  const result = spawnSync('npx', ['--no', '--', 'commitlint'], {
    cwd: REPO_ROOT,
    input: message,
    encoding: 'utf-8',
  })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
}
