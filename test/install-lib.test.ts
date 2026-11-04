/** ROUT-579 — install.mjs must never delete files it did not install, and must parse `--flag value`. */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
// @ts-expect-error plain ESM helper without types
import { argValue, isRouterlyInstall, listSourceFiles, staleFiles, uninstallPaths, MANIFEST, SANDBOX_MARKER, sandboxProblem, targetProblem } from '../scripts/install-lib.mjs'

const dirs: string[] = []
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'rout579-')); dirs.push(d); return d }
const write = (d: string, f: string, c = 'x') => { fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true }); fs.writeFileSync(path.join(d, f), c) }
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe('argValue', () => {
  it('reads --name=value and --name value alike', () => {
    expect(argValue(['--scope=user'], 'scope')).toBe('user')
    expect(argValue(['--yes', '--scope', 'user', '--port', '3942'], 'scope')).toBe('user')
    expect(argValue(['--yes', '--scope', 'user', '--port', '3942'], 'port')).toBe('3942')
  })
  it('returns null when absent or valueless', () => {
    expect(argValue(['--yes'], 'scope')).toBeNull()
    expect(argValue(['--scope', '--yes'], 'scope')).toBeNull()
    expect(argValue(['--scope-x=1'], 'scope')).toBeNull()
  })
})

describe('install detection', () => {
  it('an unrelated folder is not a Routerly install', () => {
    const d = tmp(); write(d, 'datiutente/file')
    expect(isRouterlyInstall(d)).toBe(false)
  })
  it('manifest or routerly package.json is', () => {
    const a = tmp(); write(a, MANIFEST, 'package.json\n')
    const b = tmp(); write(b, 'package.json', '{"name":"routerly"}')
    const c = tmp(); write(c, 'package.json', '{"name":"other"}')
    expect([isRouterlyInstall(a), isRouterlyInstall(b), isRouterlyInstall(c)]).toEqual([true, true, false])
  })
})

describe('stale and uninstall paths', () => {
  it('staleFiles lists only old manifest entries missing from the new source', () => {
    const d = tmp()
    write(d, MANIFEST, 'package.json\nold.txt\nsrc/a.ts\n'); write(d, 'datiutente/file')
    expect(staleFiles(d, ['package.json', 'src/a.ts'])).toEqual(['old.txt'])
  })
  it('staleFiles deletes nothing without a manifest', () => {
    const d = tmp(); write(d, 'package.json', '{"name":"routerly"}'); write(d, 'datiutente/file')
    expect(staleFiles(d, ['package.json'])).toEqual([])
  })
  it('uninstallPaths never includes foreign entries', () => {
    const d = tmp(); write(d, MANIFEST, 'package.json\npackages/cli/a.ts\n'); write(d, 'datiutente/file'); write(d, 'packages/cli/dist/x.js')
    const p = uninstallPaths(d, [])
    expect(p).toContain('packages/cli/a.ts'); expect(p).toContain('packages/cli/dist'); expect(p).toContain('packages/cli/tsconfig.tsbuildinfo'); expect(p).toContain('node_modules')
    expect(p.some((x: string) => x.startsWith('datiutente'))).toBe(false)
  })
  it('listSourceFiles skips node_modules and .git', () => {
    const d = tmp(); write(d, 'a/b.ts'); write(d, 'node_modules/x/y.js'); write(d, '.git/HEAD')
    expect(listSourceFiles(d)).toEqual(['a/b.ts'])
  })
})

describe('sandbox and target guards (ROUT-603)', () => {
  const home = os.homedir()
  it('sandbox refuses real locations, their parents and relative paths', () => {
    for (const d of ['/', '/opt', '/opt/routerly', '/var/lib/routerly', home, 'rel']) expect(sandboxProblem(d, home)).not.toBeNull()
  })
  it('sandbox accepts a missing/empty or marked folder, refuses a foreign non-empty one', () => {
    const e = tmp(); const m = tmp(); write(m, SANDBOX_MARKER, ''); write(m, 'home/x'); const f = tmp(); write(f, 'datiutente/file')
    expect([sandboxProblem(e, home), sandboxProblem(path.join(e, 'new'), home), sandboxProblem(m, home)]).toEqual([null, null, null])
    expect(sandboxProblem(f, home)).toMatch(/not empty/)
  })
  it('install target must be missing, empty or a Routerly install', () => {
    const e = tmp(); const i = tmp(); write(i, MANIFEST, 'a\n'); const f = tmp(); write(f, 'datiutente/file'); const g = tmp(); write(g, '.git/HEAD')
    expect([targetProblem(path.join(e, 'x')), targetProblem(e), targetProblem(i)]).toEqual([null, null, null])
    expect(targetProblem(f)).toMatch(/not empty/); expect(targetProblem(g)).toMatch(/git work tree/)
  })
  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('node', [path.resolve(__dirname, '../scripts/install.mjs'), '--yes', ...args], { env: { ...process.env, ...env }, encoding: 'utf-8', input: '' })
  it('installer with ROUTERLY_INSTALL_TEST=1 and no sandbox exits 1 before touching anything', () => {
    const r = run(['--scope=system'], { ROUTERLY_INSTALL_TEST: '1' })
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/requires --sandbox/)
  })
  it('installer refuses the real install folder as sandbox', () => {
    const r = run(['--sandbox', '/opt/routerly'])
    expect(r.status).toBe(1); expect(r.stderr).toMatch(/real location/)
  })
})

describe('backup and restore scripts (ROUT-603)', () => {
  const sh = (f: string, args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [path.resolve(__dirname, '../scripts', f), ...args], { env: { ...process.env, ...env }, encoding: 'utf-8' })
  it('backs up code and the uncommitted files of worktrees without node_modules, keeps KEEP copies, restores into an empty folder only', () => {
    const root = tmp(); write(root, 'code/a.ts', 'A'); write(root, 'code/node_modules/x/y.js'); write(root, 'worktrees/ROUT-1/b.ts', 'B'); spawnSync('git', ['init', '-q', path.join(root, 'worktrees/ROUT-1')])
    const dest = path.join(tmp(), 'bk')
    let last = ''
    for (let i = 0; i < 3; i++) { last = sh('backup-code.sh', [dest], { CODE_ROOT: root, KEEP: '2' }).stdout.trim(); fs.writeFileSync(path.join(root, 'code/a.ts'), 'A' + i); spawnSync('sleep', ['1']) }
    expect(fs.readdirSync(dest).filter(f => f.endsWith('.tgz'))).toHaveLength(2)
    const out = path.join(tmp(), 'r')
    expect(sh('restore-code.sh', [last, out]).status).toBe(0)
    expect(fs.readFileSync(path.join(out, 'worktrees/ROUT-1/b.ts'), 'utf-8')).toBe('B')
    expect(fs.existsSync(path.join(out, 'code/node_modules'))).toBe(false)
    expect(sh('restore-code.sh', [last, out]).status).toBe(1)
  })
})
