/**
 * ci-release-output.mjs: the maintainer-typed version + dispatched branch
 * become the release workflow's outputs. Runs the real script against a
 * throwaway git repository under the OS temp directory.
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'ci-release-output.mjs')
const dirs: string[] = []

// Commit identity for the throwaway repo only, via env (no git config).
const IDENT = {
  GIT_AUTHOR_NAME: 'fixture',
  GIT_AUTHOR_EMAIL: 'fixture@example.test',
  GIT_COMMITTER_NAME: 'fixture',
  GIT_COMMITTER_EMAIL: 'fixture@example.test',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_SYSTEM: '/dev/null',
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true })
})

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf-8', env: { ...process.env, ...IDENT } })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
}

/** Repo with one commit per entry in `tags` (each tagged), HEAD on the last. */
function repo(tags: string[] = []): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-release-'))
  dirs.push(dir)
  git(dir, 'init', '-q', '-b', 'main')
  for (const t of ['seed', ...tags]) {
    git(dir, 'commit', '-q', '--allow-empty', '-m', `chore: ${t}`)
    if (t !== 'seed') git(dir, 'tag', t)
  }
  return dir
}

function run(cwd: string, args: string[], env: Record<string, string> = {}) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf-8', env: { ...process.env, ...env } })
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

const block = (action: string, version: string, channel: string, docker: string) =>
  `released=true\naction=${action}\nversion=${version}\ngit_tag=v${version}\nchannel=${channel}\ndocker_channel_tag=${docker}\n`

describe('ci-release-output', () => {
  it('new version on main publishes on channel current / docker latest', () => {
    const r = run(repo(['v0.6.0']), ['0.6.1', 'main'])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe(block('publish', '0.6.1', 'current', 'latest'))
  })

  it.each([
    ['next', 'next', 'next'],
    ['develop', 'develop', 'develop'],
  ])('new version on %s maps to channel %s / docker %s', (branch, channel, docker) => {
    expect(run(repo(), ['0.6.1', branch]).stdout).toBe(block('publish', '0.6.1', channel, docker))
  })

  it('existing tag reachable from HEAD is a promotion (addChannel)', () => {
    const r = run(repo(['v0.6.1']), ['0.6.1', 'next'])
    expect(r.status).toBe(0)
    expect(r.stdout).toBe(block('addChannel', '0.6.1', 'next', 'next'))
  })

  it('appends to $GITHUB_OUTPUT when set', () => {
    const cwd = repo()
    const out = path.join(os.tmpdir(), `gh_out_${path.basename(cwd)}`)
    dirs.push(out)
    fs.writeFileSync(out, 'pre=1\n')
    run(cwd, ['0.6.1', 'main'], { GITHUB_OUTPUT: out })
    expect(fs.readFileSync(out, 'utf-8')).toBe('pre=1\n' + block('publish', '0.6.1', 'current', 'latest'))
  })

  it('refuses a version not greater than the latest reachable tag', () => {
    for (const v of ['0.5.9', '0.4.0']) {
      const r = run(repo(['v0.5.3', 'v0.6.0']), [v, 'develop'])
      expect(r.status).toBe(1)
      expect(r.stderr).toMatch(/must be greater than .*v0\.6\.0/)
    }
  })

  it('compares versions numerically, not lexically (0.10.0 > 0.9.0)', () => {
    expect(run(repo(['v0.9.0']), ['0.10.0', 'main']).status).toBe(0)
  })

  it('refuses an existing tag that is not an ancestor of HEAD', () => {
    const cwd = repo()
    git(cwd, 'checkout', '-q', '-b', 'other')
    git(cwd, 'commit', '-q', '--allow-empty', '-m', 'chore: x')
    git(cwd, 'tag', 'v0.7.0')
    git(cwd, 'checkout', '-q', 'main')
    const r = run(cwd, ['0.7.0', 'main'])
    expect(r.status).toBe(1)
    expect(r.stderr).toMatch(/not an ancestor/)
  })

  it('rejects a malformed version and an unknown branch', () => {
    const cwd = repo()
    expect(run(cwd, ['1.2', 'main']).stderr).toMatch(/Invalid version/)
    expect(run(cwd, ['v1.2.3', 'main']).status).toBe(1)
    expect(run(cwd, ['1.2.3', 'feature/x']).stderr).toMatch(/Invalid branch/)
    expect(run(cwd, []).status).toBe(1)
  })
})
