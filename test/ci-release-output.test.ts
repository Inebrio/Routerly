/**
 * RC-2 — CI release output mapping (`scripts/ci-release-output.mjs`).
 *
 * Runs the real script as a subprocess, both with and without
 * `$GITHUB_OUTPUT` set, against a throwaway file under the OS temp
 * directory — never against any file in the repository.
 *
 * Story: .claude/specs/release-channels/01-stories/RC-2.md
 * Blueprint: .claude/specs/release-channels/02-blueprint/RC-2.md (C1, C2, task 2)
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'ci-release-output.mjs')

const outputFiles: string[] = []

function tmpOutputFile(): string {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc2-ci-output-')), 'github_output')
  outputFiles.push(f)
  return f
}

afterEach(() => {
  while (outputFiles.length > 0) {
    const f = outputFiles.pop()!
    fs.rmSync(path.dirname(f), { recursive: true, force: true })
  }
})

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf-8',
    env: { ...process.env, ...env },
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('RC-2 — ci-release-output.mjs happy paths', () => {
  it('publish on main maps to channel current / docker tag latest, appends to $GITHUB_OUTPUT', () => {
    const outFile = tmpOutputFile()
    const result = run(['publish', '1.5.3', 'v1.5.3', 'main'], { GITHUB_OUTPUT: outFile })

    expect(result.status).toBe(0)
    const expected = [
      'released=true',
      'action=publish',
      'version=1.5.3',
      'git_tag=v1.5.3',
      'channel=current',
      'docker_channel_tag=latest',
    ].join('\n') + '\n'

    expect(result.stdout).toBe(expected)
    expect(fs.readFileSync(outFile, 'utf-8')).toBe(expected)
  })

  it('addChannel on develop maps to channel next / docker tag next', () => {
    const outFile = tmpOutputFile()
    const result = run(['addChannel', '2.0.0', 'v2.0.0', 'develop'], { GITHUB_OUTPUT: outFile })

    expect(result.status).toBe(0)
    const expected = [
      'released=true',
      'action=addChannel',
      'version=2.0.0',
      'git_tag=v2.0.0',
      'channel=next',
      'docker_channel_tag=next',
    ].join('\n') + '\n'

    expect(result.stdout).toBe(expected)
    expect(fs.readFileSync(outFile, 'utf-8')).toBe(expected)
  })

  it('appends rather than overwriting an existing $GITHUB_OUTPUT', () => {
    const outFile = tmpOutputFile()
    fs.writeFileSync(outFile, 'preexisting=true\n')
    const result = run(['publish', '1.0.0', 'v1.0.0', 'main'], { GITHUB_OUTPUT: outFile })

    expect(result.status).toBe(0)
    const content = fs.readFileSync(outFile, 'utf-8')
    expect(content.startsWith('preexisting=true\n')).toBe(true)
    expect(content).toContain('released=true')
  })

  it('writes only to stdout and exits 0 when $GITHUB_OUTPUT is unset (local dry run)', () => {
    const env = { ...process.env, publish: '1.0.0' }
    delete (env as Record<string, string | undefined>).GITHUB_OUTPUT
    const result = spawnSync(process.execPath, [SCRIPT, 'publish', '1.0.0', 'v1.0.0', 'main'], {
      encoding: 'utf-8',
      env,
    })

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('released=true')
  })
})

describe('RC-2 — ci-release-output.mjs rejection paths', () => {
  it('rejects an invalid action', () => {
    const result = run(['bogus', '1.0.0', 'v1.0.0', 'main'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid action "bogus"')
    expect(result.stdout).toBe('')
  })

  it('rejects a malformed version', () => {
    const result = run(['publish', '1.0', 'v1.0', 'main'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid version "1.0"')
  })

  it('rejects a gitTag that does not match v<version>', () => {
    const result = run(['publish', '1.0.0', 'v1.0.1', 'main'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid gitTag "v1.0.1"')
  })

  it('rejects an unknown branch', () => {
    const result = run(['publish', '1.0.0', 'v1.0.0', 'staging'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid branch "staging"')
  })
})
