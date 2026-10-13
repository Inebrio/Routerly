import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const script = path.resolve(__dirname, '../scripts/link-worktree-modules.mjs')

describe('link-worktree-modules', () => {
  it('points @routerly/* at the worktree packages and is idempotent', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rtr-linknm-'))
    const main = path.join(tmp, 'main')
    const wt = path.join(tmp, 'wt')
    fs.mkdirSync(path.join(main, 'node_modules/@routerly'), { recursive: true })
    fs.mkdirSync(path.join(main, 'node_modules/lodash'))
    fs.mkdirSync(path.join(wt, 'packages/shared'), { recursive: true })
    fs.mkdirSync(path.join(wt, 'scripts'))
    fs.copyFileSync(script, path.join(wt, 'scripts/link-worktree-modules.mjs'))
    fs.symlinkSync(path.join(main, 'node_modules'), path.join(wt, 'node_modules'))

    const run = () => execFileSync('node', ['scripts/link-worktree-modules.mjs'], { cwd: wt }).toString()
    expect(run()).toContain('now resolves')
    expect(fs.realpathSync(path.join(wt, 'node_modules/@routerly/shared'))).toBe(fs.realpathSync(path.join(wt, 'packages/shared')))
    expect(fs.existsSync(path.join(wt, 'node_modules/lodash'))).toBe(true)
    expect(run()).toBe('')
    fs.rmSync(tmp, { recursive: true, force: true })
  })
})
