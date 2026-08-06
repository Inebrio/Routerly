/**
 * Fixture builder for scripts/release-notes.sh and cliff.toml (story RA-08).
 *
 * The script derives its own repository root from its own file location
 * (`BASH_SOURCE`), so exercising it against a throwaway commit history means
 * building a real, tiny, throwaway git repository under the OS temp
 * directory with a *copy* of the real script and the real `cliff.toml`
 * inside it. This never touches the worktree's own git history or its own
 * `cliff.toml`: every fixture lives under `os.tmpdir()` and is removed
 * after each test.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..')
export const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'release-notes.sh')
export const REAL_CLIFF_TOML = path.join(REPO_ROOT, 'cliff.toml')

export interface Fixture {
  root: string
  scriptPath: string
  cliffTomlPath: string
}

/**
 * Builds a throwaway git repository with a copy of the real
 * `scripts/release-notes.sh` and `cliff.toml`, seeded with an initial
 * commit so ranges have a base to work from.
 */
export function buildFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra08-release-notes-'))
  const scriptsDir = path.join(root, 'scripts')
  fs.mkdirSync(scriptsDir, { recursive: true })

  const scriptPath = path.join(scriptsDir, 'release-notes.sh')
  fs.copyFileSync(REAL_SCRIPT, scriptPath)
  fs.chmodSync(scriptPath, 0o755)

  const cliffTomlPath = path.join(root, 'cliff.toml')
  fs.copyFileSync(REAL_CLIFF_TOML, cliffTomlPath)

  git(root, ['init', '-q', '-b', 'main'])
  git(root, ['config', 'user.name', 'RA-08 Fixture'])
  git(root, ['config', 'user.email', 'ra08-fixture@example.test'])
  git(root, ['config', 'commit.gpgsign', 'false'])
  fs.writeFileSync(path.join(root, 'README.md'), '# fixture\n')
  git(root, ['add', 'README.md'])
  git(root, ['commit', '-q', '-m', 'chore: seed fixture repository'])

  return { root, scriptPath, cliffTomlPath }
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

/** Commits an empty commit with the given subject, returning nothing observable but the history. */
export function commit(fixture: Fixture, subject: string): void {
  git(fixture.root, ['commit', '-q', '--allow-empty', '-m', subject])
}

/**
 * Tags the current HEAD. git-cliff needs at least one tag matching the
 * script's `--tag-pattern` reachable in the repository to establish a
 * release boundary; a fixture with zero tags at all renders nothing, even
 * for a well-formed empty range (observed directly against git-cliff
 * 2.13.1, not assumed).
 */
export function tag(fixture: Fixture, name: string): void {
  git(fixture.root, ['tag', name])
}

/** The current HEAD sha inside the fixture, used as a stable range start. */
export function headSha(fixture: Fixture): string {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: fixture.root, encoding: 'utf-8' })
  return result.stdout.trim()
}

/** Overwrites the fixture's own copy of cliff.toml, never the real one in the worktree. */
export function writeCliffToml(fixture: Fixture, content: string): void {
  fs.writeFileSync(fixture.cliffTomlPath, content)
}

export interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/**
 * Runs the fixture's own copy of the script exactly the way `release.yml`
 * and a contributor do: `scripts/release-notes.sh <from> <to> [--tag ...]`.
 *
 * `env` lets a test strip `git-cliff`/`npx` off `PATH` to prove the missing
 * dependency error path without touching the real developer environment.
 */
export function runReleaseNotes(
  fixture: Fixture,
  args: string[],
  env?: Record<string, string | undefined>,
): RunResult {
  const result = spawnSync('bash', [fixture.scriptPath, ...args], {
    cwd: fixture.root,
    encoding: 'utf-8',
    env: env ?? process.env,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}
