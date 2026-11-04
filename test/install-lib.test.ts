/** ROUT-579 — install.mjs must never delete files it did not install, and must parse `--flag value`. */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
// @ts-expect-error plain ESM helper without types
import { argValue, isRouterlyInstall, listSourceFiles, staleFiles, uninstallPaths, MANIFEST } from '../scripts/install-lib.mjs'

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
    expect(p).toContain('packages/cli/a.ts'); expect(p).toContain('packages/cli/dist'); expect(p).toContain('node_modules')
    expect(p.some((x: string) => x.startsWith('datiutente'))).toBe(false)
  })
  it('listSourceFiles skips node_modules and .git', () => {
    const d = tmp(); write(d, 'a/b.ts'); write(d, 'node_modules/x/y.js'); write(d, '.git/HEAD')
    expect(listSourceFiles(d)).toEqual(['a/b.ts'])
  })
})
