/**
 * RMT-1/RMT-2 regression — `scripts/install.sh` channel → GitHub tag resolution.
 *
 * The retrospective (`.claude/specs/release-manual-trigger/04-retrospective.md`,
 * "What was rework" #3) flagged that the `next`/`develop` rolling-pointer tags
 * collide with the long-lived branches of the same name, and that the fix
 * (renaming the tags to `channel-next`/`channel-develop`) had to be applied to
 * `install.sh`, `install.ps1` and the service's `update-checker.ts` — the first
 * two had zero automated coverage before this test. `update-checker.ts`'s half
 * of the mapping is already covered by
 * `packages/service/src/modules/update-checker/update-checker.test.ts`.
 *
 * Runs the real `install.sh` as a subprocess with a stub `curl` prepended to
 * PATH that only logs the URL it was asked to fetch and returns an empty body
 * (no network, no download, no install). Each explicit `--channel` makes the
 * script `die` right after resolving the URL (empty body ⇒ "could not fetch"),
 * which is enough to observe the exact URL it attempted — the same technique
 * the validator used by hand (`03-validation/RMT-2.md`'s "empty url.log").
 *
 * `install.ps1` is not covered here: no `pwsh`/`powershell` runtime exists on
 * this machine (confirmed `which pwsh powershell` → not found), the same
 * pre-existing gap `03-validation/RMT-2.md` already records for that file.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'install.sh')

const scratchDirs: string[] = []

function makeStubCurlBin(): { binDir: string; logFile: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rmt-install-sh-'))
  scratchDirs.push(dir)
  const binDir = path.join(dir, 'bin')
  fs.mkdirSync(binDir)
  const logFile = path.join(dir, 'curl.log')
  // Logs every arg it was called with, then succeeds with an empty body —
  // install.sh treats that exactly like "network/API unreachable".
  fs.writeFileSync(
    path.join(binDir, 'curl'),
    `#!/usr/bin/env bash\necho "$@" >> "${logFile}"\nexit 0\n`,
    { mode: 0o755 },
  )
  return { binDir, logFile }
}

afterEach(() => {
  while (scratchDirs.length > 0) {
    fs.rmSync(scratchDirs.pop()!, { recursive: true, force: true })
  }
})

function runInstallSh(channel: string, binDir: string) {
  const result = spawnSync('bash', [SCRIPT, '--yes', `--channel=${channel}`], {
    encoding: 'utf-8',
    env: { ...process.env, PATH: `${binDir}:${process.env['PATH']}` },
    timeout: 15_000,
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('install.sh — rolling-channel tag resolution (RMT-1 tag/branch collision fix)', () => {
  it('--channel=next requests the renamed "channel-next" tag, not the "next" branch name', () => {
    const { binDir, logFile } = makeStubCurlBin()
    const result = runInstallSh('next', binDir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Could not fetch channel 'next'")
    const log = fs.readFileSync(logFile, 'utf-8')
    expect(log).toContain('/releases/tags/channel-next')
    expect(log).not.toContain('/releases/tags/next\n')
  })

  it('--channel=develop requests the renamed "channel-develop" tag, not the "develop" branch name', () => {
    const { binDir, logFile } = makeStubCurlBin()
    const result = runInstallSh('develop', binDir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Could not fetch channel 'develop'")
    const log = fs.readFileSync(logFile, 'utf-8')
    expect(log).toContain('/releases/tags/channel-develop')
    expect(log).not.toContain('/releases/tags/develop\n')
  })

  it('--channel=current resolves to /releases/latest (unaffected by the rename)', () => {
    const { binDir, logFile } = makeStubCurlBin()
    const result = runInstallSh('current', binDir)

    expect(result.status).toBe(1)
    const log = fs.readFileSync(logFile, 'utf-8')
    expect(log).toContain('/releases/latest')
    expect(log).not.toContain('/tags/')
  })

  it('--channel=latest resolves to /releases/latest (unaffected by the rename)', () => {
    const { binDir, logFile } = makeStubCurlBin()
    const result = runInstallSh('latest', binDir)

    expect(result.status).toBe(1)
    const log = fs.readFileSync(logFile, 'utf-8')
    expect(log).toContain('/releases/latest')
  })
})

describe('install.sh — channel validation (RMT-2 AC2/EC1/EC4)', () => {
  it('rejects the retired "stable" alias before ever calling curl, exit 1', () => {
    const { binDir, logFile } = makeStubCurlBin()
    const result = runInstallSh('stable', binDir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unknown channel: 'stable'. Valid values: latest, current, next, develop")
    expect(fs.existsSync(logFile)).toBe(false)
  })

  it('rejects an arbitrary unknown channel the same way, message lists "develop" (RMT-2 EC4)', () => {
    const { binDir, logFile } = makeStubCurlBin()
    const result = runInstallSh('bogus-channel', binDir)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Unknown channel: 'bogus-channel'. Valid values: latest, current, next, develop")
    expect(fs.existsSync(logFile)).toBe(false)
  })
})
