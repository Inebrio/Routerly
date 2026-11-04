/** ROUT-602 — release gate (`scripts/release-proof.mjs`) against a throwaway git repo. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const script = path.resolve(__dirname, '../scripts/release-proof.mjs')
let dir: string
let a: string
let b: string
const g = (...x: string[]) => execFileSync('git', x, { cwd: dir, encoding: 'utf8' }).trim()
const run = (...x: string[]) => spawnSync('node', [script, ...x], { cwd: dir, encoding: 'utf8' })

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rproof-'))
  g('init', '-q')
  g('config', 'user.email', 't@t')
  g('config', 'user.name', 't')
  g('commit', '-q', '--allow-empty', '-m', 'a')
  a = g('rev-parse', 'HEAD')
  g('commit', '-q', '--allow-empty', '-m', 'b')
  b = g('rev-parse', 'HEAD')
})
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('release gate', () => {
  it('AC1 refuses without proof', () => {
    const r = run('check', '0.6.0', '--commit', a)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('no real-test proof recorded for 0.6.0')
  })
  it('refuses record without evidence', () => {
    expect(run('record', '0.6.0', '--commit', a).status).toBe(1)
  })
  it('AC2 passes with a recorded proof', () => {
    expect(run('record', '0.6.0', '--commit', a, '--evidence', 'npm package installed in clean LXC').status).toBe(0)
    expect(run('check', '0.6.0', '--commit', a).status).toBe(0)
  })
  it('AC3 refuses another commit and another version', () => {
    const r = run('check', '0.6.0', '--commit', b)
    expect(r.status).toBe(1)
    expect(r.stderr).toContain(`other commits: ${a.slice(0, 12)}`)
    expect(run('check', '0.6.1', '--commit', a).status).toBe(1)
  })
  it('refuses an expired proof', () => {
    const r = run('check', '0.6.0', '--commit', a, '--max-age-days', '-1')
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('expired')
  })
})
