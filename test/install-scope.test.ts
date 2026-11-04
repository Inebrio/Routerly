/**
 * ROUT-581 — an explicit --scope user must install under HOME, in both the
 * `--scope=user` and `--scope user` forms, even when /opt/routerly exists
 * and the installer runs as root.
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'install.mjs')

describe('install.mjs --scope user', () => {
  for (const form of [['--scope=user'], ['--scope', 'user']]) {
    it(`honours ${form.join(' ')} and keeps the app dir under HOME`, () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-scope-'))
      const home = path.join(tmp, 'home')
      const src = path.join(tmp, 'src')
      fs.mkdirSync(home)
      fs.mkdirSync(src)
      try {
        const r = spawnSync('node', [SCRIPT, '--yes', ...form, `--source-dir=${src}`, '--no-service', '--no-daemon'],
          { env: { ...process.env, HOME: home }, encoding: 'utf-8', timeout: 20000 })
        expect(r.stdout).toContain('Scope: user')
        expect(r.stdout).toContain(path.join(home, '.routerly', 'app'))
        expect(r.stdout).not.toMatch(/App directory:\s+\/opt\/routerly/)
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true })
      }
    })
  }
})
