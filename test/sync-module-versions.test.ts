/**
 * RA-04 — module version sync (`scripts/sync-module-versions.mjs`).
 *
 * Runs the real script against a throwaway fixture tree under the OS temp
 * directory (see sync-module-versions-fixture.ts) — never against the
 * worktree's own `packages/service/`. Each test builds and tears down its
 * own fixture, so failures leave no debris in the repo and tests never
 * depend on each other's state.
 *
 * Story: .claude/specs/release-automation/01-stories/RA-04.md
 * Validation (PASS, zero blocking): .claude/specs/release-automation/03-validation/RA-04.md
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  buildFixture,
  cleanupFixture,
  runSync,
  readSrcFile,
  writeSrcFile,
  writeServicePkg,
  type Fixture,
} from './sync-module-versions-fixture.js'

const fixtures: Fixture[] = []

function fixture(opts?: Parameters<typeof buildFixture>[0]): Fixture {
  const f = buildFixture(opts)
  fixtures.push(f)
  return f
}

afterEach(() => {
  while (fixtures.length > 0) {
    cleanupFixture(fixtures.pop()!)
  }
})

describe('RA-04 — idempotence and drift', () => {
  it('AC3 — a synced tree run twice rewrites zero occurrences both times', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        'modules/a.ts': `version: '1.2.3', dependsOn: { x: '^1.2.3' }`,
        'modules/b.ts': `version: "1.2.3"`,
      },
    })

    const first = runSync(f)
    expect(first.status).toBe(0)
    expect(first.stdout).toContain('Synced module versions to 1.2.3: 0 occurrence(s) rewritten across 0 file(s).')

    const contentAfterFirst = {
      a: readSrcFile(f, 'modules/a.ts'),
      b: readSrcFile(f, 'modules/b.ts'),
    }

    const second = runSync(f)
    expect(second.status).toBe(0)
    expect(second.stdout).toContain('Synced module versions to 1.2.3: 0 occurrence(s) rewritten across 0 file(s).')
    expect(readSrcFile(f, 'modules/a.ts')).toBe(contentAfterFirst.a)
    expect(readSrcFile(f, 'modules/b.ts')).toBe(contentAfterFirst.b)
  })

  it('rewrite is absolute, not differential — a literal ABOVE canonical is rewritten down', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        'modules/ahead.ts': `version: '9.9.9', dependsOn: { x: '^9.9.9' }`,
      },
    })

    const result = runSync(f)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Synced module versions to 1.2.3: 2 occurrence(s) rewritten across 1 file(s).')
    expect(readSrcFile(f, 'modules/ahead.ts')).toBe(`version: '1.2.3', dependsOn: { x: '^1.2.3' }`)
  })

  it('AC4 — a patch-level canonical bump still rewrites unconditionally, same as a major bump', () => {
    const f = fixture({
      canonicalVersion: '1.2.4',
      files: {
        'modules/a.ts': `version: '1.2.3', dependsOn: { x: '^1.2.3' }`,
      },
    })

    const result = runSync(f)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Synced module versions to 1.2.4: 2 occurrence(s) rewritten across 1 file(s).')
    expect(readSrcFile(f, 'modules/a.ts')).toBe(`version: '1.2.4', dependsOn: { x: '^1.2.4' }`)
  })
})

describe('RA-04 — --check mode', () => {
  it('AC3/EC — --check exits 0 on a synced tree', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: { 'modules/a.ts': `version: '1.2.3'` },
    })

    const result = runSync(f, '--check')
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('All module version literals in packages/service/src already match 1.2.3.')
    expect(result.stderr).toBe('')
  })

  it('--check exits 1 on drift, names file and line on stderr, and writes nothing', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        'modules/drifted.ts': `\nversion: '9.9.9'`,
      },
    })

    const before = readSrcFile(f, 'modules/drifted.ts')
    const result = runSync(f, '--check')

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('modules/drifted.ts:2: expected 1.2.3, found 9.9.9')
    // Writes nothing.
    expect(readSrcFile(f, 'modules/drifted.ts')).toBe(before)
  })
})

describe('RA-04 — scope is frozen', () => {
  it('*.test.ts files under packages/service/src are not touched', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        'modules/a.test.ts': `version: '9.9.9'`,
      },
    })

    const before = readSrcFile(f, 'modules/a.test.ts')
    const result = runSync(f)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('0 occurrence(s) rewritten across 0 file(s)')
    expect(readSrcFile(f, 'modules/a.test.ts')).toBe(before)
  })

  it('files outside packages/service/src are not touched', () => {
    const f = fixture({ canonicalVersion: '1.2.3' })
    const outsidePath = path.join(f.root, 'packages', 'service', 'README.md')
    const outsideContent = `version: '9.9.9'`
    fs.writeFileSync(outsidePath, outsideContent)

    const result = runSync(f)

    expect(result.status).toBe(0)
    expect(fs.readFileSync(outsidePath, 'utf-8')).toBe(outsideContent)
  })

  it('only the two frozen literal shapes are rewritten — a bare unrelated string survives untouched', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        // Neither `version:` prefixed nor `^`-ranged — must survive untouched.
        'modules/bare.ts': `export const SOME_STRING = "9.9.9";`,
      },
    })

    const before = readSrcFile(f, 'modules/bare.ts')
    const result = runSync(f)

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('0 occurrence(s) rewritten across 0 file(s)')
    expect(readSrcFile(f, 'modules/bare.ts')).toBe(before)
  })

  it('EC1 — a hand-authored comment / unusual spacing around the literal is still rewritten', () => {
    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        'modules/unusual.ts': `version:    '9.9.9', // hand-authored comment, unusual spacing\ndependsOn: { x: '^9.9.9' },`,
      },
    })

    const result = runSync(f)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('2 occurrence(s) rewritten across 1 file(s).')
    expect(readSrcFile(f, 'modules/unusual.ts')).toBe(
      `version:    '1.2.3', // hand-authored comment, unusual spacing\ndependsOn: { x: '^1.2.3' },`,
    )
  })
})

describe('RA-04 — atomicity (EC2)', () => {
  it('EC2 — if one file cannot be read, nothing is written at all', () => {
    if (process.getuid && process.getuid() === 0) {
      // chmod-based unreadability has no effect for root; skip rather than
      // produce a false pass/fail unrelated to the behaviour under test.
      return
    }

    const f = fixture({
      canonicalVersion: '1.2.3',
      files: {
        // alphabetically first — must not be written even though it
        // successfully transforms in memory before the walk reaches the
        // unreadable file.
        'aaa-first.ts': `version: '9.9.9'`,
        'zzz-unreadable.ts': `version: '9.9.9'`,
      },
    })

    const unreadablePath = path.join(f.srcDir, 'zzz-unreadable.ts')
    const beforeFirst = readSrcFile(f, 'aaa-first.ts')
    const beforeUnreadable = readSrcFile(f, 'zzz-unreadable.ts')

    fs.chmodSync(unreadablePath, 0o000)
    try {
      const result = runSync(f)

      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Failed to read')
      expect(result.stderr).toContain('zzz-unreadable.ts')
    } finally {
      fs.chmodSync(unreadablePath, 0o644)
    }

    // Nothing was written — not even the file that transformed cleanly.
    expect(readSrcFile(f, 'aaa-first.ts')).toBe(beforeFirst)
    expect(readSrcFile(f, 'zzz-unreadable.ts')).toBe(beforeUnreadable)
  })
})

describe('RA-04 — malformed canonical version', () => {
  it('a malformed canonical version exits 1 with a clear message', () => {
    const f = fixture({ canonicalVersion: '1.2.3' })
    writeServicePkg(f, JSON.stringify({ name: '@routerly/service', version: 'not-a-semver' }))

    const result = runSync(f)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Malformed canonical version "not-a-semver"')
  })

  it('a missing canonical version exits 1 with a clear message', () => {
    const f = fixture({ canonicalVersion: '1.2.3' })
    writeServicePkg(f, JSON.stringify({ name: '@routerly/service' }))

    const result = runSync(f)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Malformed canonical version "undefined"')
  })

  it('an unreadable/absent package.json exits 1 with a clear message', () => {
    const f = fixture({ canonicalVersion: '1.2.3' })
    fs.rmSync(f.servicePkgPath)

    const result = runSync(f)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Could not read canonical version from')
  })
})
