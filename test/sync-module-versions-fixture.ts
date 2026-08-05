/**
 * Fixture builder for scripts/sync-module-versions.mjs (story RA-04).
 *
 * The script derives every path (`packages/service/package.json`,
 * `packages/service/src`) from its own file location
 * (`REPO_ROOT = path.resolve(SCRIPT_DIR, '..')`), so exercising it against a
 * throwaway tree means building a miniature repo layout under the OS temp
 * directory with a *copy* of the real script inside it.
 *
 * This never touches `packages/service/` in the worktree. Every fixture
 * lives under `os.tmpdir()` and is removed after each test.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..')
export const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'sync-module-versions.mjs')

export interface Fixture {
  root: string
  scriptPath: string
  servicePkgPath: string
  srcDir: string
}

/**
 * Builds a throwaway `<root>/scripts/sync-module-versions.mjs` +
 * `<root>/packages/service/package.json` + `<root>/packages/service/src/**`
 * layout mirroring the real repo, with a copy of the real script.
 */
export function buildFixture(
  opts: {
    canonicalVersion?: string
    files?: Record<string, string>
  } = {},
): Fixture {
  const canonicalVersion = opts.canonicalVersion ?? '1.2.3'
  const files = opts.files ?? {}

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra04-sync-module-versions-'))
  const scriptsDir = path.join(root, 'scripts')
  const serviceDir = path.join(root, 'packages', 'service')
  const srcDir = path.join(serviceDir, 'src')

  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.mkdirSync(srcDir, { recursive: true })

  const scriptPath = path.join(scriptsDir, 'sync-module-versions.mjs')
  fs.copyFileSync(REAL_SCRIPT, scriptPath)

  const servicePkgPath = path.join(serviceDir, 'package.json')
  fs.writeFileSync(
    servicePkgPath,
    JSON.stringify({ name: '@routerly/service', version: canonicalVersion }, null, 2),
  )

  for (const [relFile, content] of Object.entries(files)) {
    const abs = path.join(srcDir, relFile)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }

  return { root, scriptPath, servicePkgPath, srcDir }
}

export function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

export interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Runs the fixture's copy of the script exactly the way `npm run version` does. */
export function runSync(fixture: Fixture, ...extraArgs: string[]): RunResult {
  const result = spawnSync(process.execPath, [fixture.scriptPath, ...extraArgs], {
    cwd: fixture.root,
    encoding: 'utf-8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export function readSrcFile(fixture: Fixture, relFile: string): string {
  return fs.readFileSync(path.join(fixture.srcDir, relFile), 'utf-8')
}

export function writeSrcFile(fixture: Fixture, relFile: string, content: string): void {
  const abs = path.join(fixture.srcDir, relFile)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
}

export function writeServicePkg(fixture: Fixture, content: string): void {
  fs.writeFileSync(fixture.servicePkgPath, content)
}
