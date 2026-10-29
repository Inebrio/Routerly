import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const script = path.join(repo, 'scripts/link-worktree-modules.mjs')

describe('link-worktree-modules', () => {
  it('points @routerly/* at the worktree packages when node_modules is a symlink', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-link-'))
    try {
      const main = path.join(tmp, 'main')
      const wt = path.join(tmp, 'wt')
      fs.mkdirSync(path.join(main, 'node_modules/@routerly/shared'), { recursive: true })
      fs.mkdirSync(path.join(main, 'node_modules/left-pad'))
      fs.mkdirSync(path.join(wt, 'scripts'), { recursive: true })
      fs.mkdirSync(path.join(wt, 'packages/shared'), { recursive: true })
      fs.copyFileSync(script, path.join(wt, 'scripts/link-worktree-modules.mjs'))
      fs.symlinkSync(path.join(main, 'node_modules'), path.join(wt, 'node_modules'))

      execFileSync('node', [path.join(wt, 'scripts/link-worktree-modules.mjs')])

      expect(fs.realpathSync(path.join(wt, 'node_modules/@routerly/shared'))).toBe(
        fs.realpathSync(path.join(wt, 'packages/shared')),
      )
      expect(fs.existsSync(path.join(wt, 'node_modules/left-pad'))).toBe(true)
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })

  it.each(['service', 'cli', 'dashboard'])('%s runs the link script before build and typecheck', (pkg) => {
    const { scripts } = JSON.parse(fs.readFileSync(path.join(repo, 'packages', pkg, 'package.json'), 'utf8'))
    expect(scripts.prebuild).toContain('link-worktree-modules.mjs')
    expect(scripts.pretypecheck).toContain('link-worktree-modules.mjs')
  })
})
