/**
 * RA-09 — documentation version cut (`scripts/docs-version.mjs`).
 *
 * Runs the real script against a throwaway fixture tree under the OS temp
 * directory (see docs-version-fixture.ts) — never against the worktree's
 * own `website/`. Each test builds and tears down its own fixture, so
 * failures leave no debris in the repo and tests never depend on each
 * other's state.
 *
 * Story: .claude/specs/release-automation/01-stories/RA-09.md
 * Validation (round 2, PASS): .claude/specs/release-automation/03-validation/RA-09.md
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  buildFixture,
  cleanupFixture,
  runDocsCut,
  readVersionsRaw,
  readConfigRaw,
  listVersionedDocsDirs,
  listFilesRecursive,
  type Fixture,
} from './docs-version-fixture.js'
import * as path from 'node:path'
import * as fs from 'node:fs'

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

describe('RA-09 — rejection paths leave the tree untouched', () => {
  it('EC1 baseline / AC-preconditions — missing argument exits 1 and mutates nothing', () => {
    const f = fixture()
    const versionsBefore = readVersionsRaw(f)
    const configBefore = readConfigRaw(f)

    const result = runDocsCut(f)

    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Missing version argument. Usage: npm run docs:cut -- <X.Y.Z>')
    expect(result.stdout).toBe('')
    expect(readVersionsRaw(f)).toBe(versionsBefore)
    expect(readConfigRaw(f)).toBe(configBefore)
    expect(listVersionedDocsDirs(f)).toEqual(['version-0.1.0'])
  })

  it('rejects a "v"-prefixed version, exits 1, mutates nothing', () => {
    const f = fixture()
    const versionsBefore = readVersionsRaw(f)
    const configBefore = readConfigRaw(f)

    const result = runDocsCut(f, 'v0.9.9')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Version must not have a "v" prefix. Use "0.9.9" instead of "v0.9.9".',
    )
    expect(readVersionsRaw(f)).toBe(versionsBefore)
    expect(readConfigRaw(f)).toBe(configBefore)
    expect(listVersionedDocsDirs(f)).toEqual(['version-0.1.0'])
  })

  it('rejects a malformed version, exits 1, mutates nothing', () => {
    const f = fixture()
    const versionsBefore = readVersionsRaw(f)
    const configBefore = readConfigRaw(f)

    const result = runDocsCut(f, '1.2')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Malformed version "1.2". Expected bare semver in the form X.Y.Z (e.g. 1.2.3).',
    )
    expect(readVersionsRaw(f)).toBe(versionsBefore)
    expect(readConfigRaw(f)).toBe(configBefore)
    expect(listVersionedDocsDirs(f)).toEqual(['version-0.1.0'])
  })

  it('EC1 — refuses a version already present in versions.json, exits 1, mutates nothing', () => {
    const f = fixture({ initialVersions: ['0.1.0'] })
    const versionsBefore = readVersionsRaw(f)
    const configBefore = readConfigRaw(f)

    const result = runDocsCut(f, '0.1.0')

    expect(result.status).toBe(1)
    expect(result.stderr).toContain(
      'Version 0.1.0 is already cut (present in website/versions.json).',
    )
    expect(readVersionsRaw(f)).toBe(versionsBefore)
    expect(readConfigRaw(f)).toBe(configBefore)
    expect(listVersionedDocsDirs(f)).toEqual(['version-0.1.0'])
  })

  it(
    'B1 regression — zero "lastVersion" matches refuses before the Docusaurus CLI runs, mutates nothing',
    () => {
      const f = fixture({ corrupt: 'zero' })
      const versionsBefore = readVersionsRaw(f)
      const configBefore = readConfigRaw(f)

      const result = runDocsCut(f, '0.9.7')

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Could not find a single "lastVersion: \'...\'" line in website/docusaurus.config.ts (found 0)',
      )
      // No "[SUCCESS] [docs]: version ... created!" — the CLI was never invoked.
      expect(result.stdout).not.toContain('created!')
      expect(readVersionsRaw(f)).toBe(versionsBefore)
      expect(readConfigRaw(f)).toBe(configBefore)
      expect(listVersionedDocsDirs(f)).toEqual(['version-0.1.0'])
    },
    30_000,
  )

  it(
    'B1 regression — two "lastVersion" matches refuses before the Docusaurus CLI runs, mutates nothing',
    () => {
      const f = fixture({ corrupt: 'two' })
      const versionsBefore = readVersionsRaw(f)
      const configBefore = readConfigRaw(f)

      const result = runDocsCut(f, '0.9.6')

      expect(result.status).toBe(1)
      expect(result.stderr).toContain(
        'Could not find a single "lastVersion: \'...\'" line in website/docusaurus.config.ts (found 2)',
      )
      expect(result.stdout).not.toContain('created!')
      expect(readVersionsRaw(f)).toBe(versionsBefore)
      expect(readConfigRaw(f)).toBe(configBefore)
      expect(listVersionedDocsDirs(f)).toEqual(['version-0.1.0'])
    },
    30_000,
  )
})

describe('RA-09 — happy path', () => {
  it(
    'AC1/AC2 — cuts a full copy of docs/, puts the new version first, changes exactly one config line',
    () => {
      const f = fixture({ initialVersions: ['0.1.0'] })
      const configBefore = readConfigRaw(f)

      const result = runDocsCut(f, '0.2.0')

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('Cut documentation version 0.2.0')

      // AC2 — new version first, bare form, no prefix.
      const versions = JSON.parse(readVersionsRaw(f)) as string[]
      expect(versions[0]).toBe('0.2.0')
      expect(versions).toContain('0.1.0')

      // AC1 — the versioned copy mirrors docs/ exactly.
      const versionedDocsDir = path.join(f.websiteDir, 'versioned_docs', 'version-0.2.0')
      expect(fs.existsSync(versionedDocsDir)).toBe(true)
      expect(listFilesRecursive(versionedDocsDir)).toEqual(listFilesRecursive(f.docsDir))

      // Exactly one changed line in the config: lastVersion moved to the new version.
      const configAfter = readConfigRaw(f)
      const beforeLines = configBefore.split('\n')
      const afterLines = configAfter.split('\n')
      expect(afterLines.length).toBe(beforeLines.length)
      const changedLines = afterLines.filter((line, i) => line !== beforeLines[i])
      expect(changedLines).toEqual(["          lastVersion: '0.2.0',"])
      expect(configBefore).toContain("lastVersion: '0.1.0',")
    },
    30_000,
  )

  it(
    'AC4 — two consecutive cuts both land, in cut order, neither overwrites the other',
    () => {
      const f = fixture({ initialVersions: ['0.1.0'] })

      const first = runDocsCut(f, '0.2.0')
      expect(first.status).toBe(0)

      const versionedDocsFirstCut = path.join(f.websiteDir, 'versioned_docs', 'version-0.2.0')
      const firstCutContentSnapshot = listFilesRecursive(versionedDocsFirstCut)

      const second = runDocsCut(f, '0.3.0')
      expect(second.status).toBe(0)

      const versions = JSON.parse(readVersionsRaw(f)) as string[]
      // Newest-cut-first: 0.3.0 (cut second) precedes 0.2.0 (cut first).
      expect(versions.indexOf('0.3.0')).toBeLessThan(versions.indexOf('0.2.0'))
      expect(versions).toEqual(expect.arrayContaining(['0.3.0', '0.2.0', '0.1.0']))

      expect(listVersionedDocsDirs(f)).toEqual(
        ['version-0.1.0', 'version-0.2.0', 'version-0.3.0'].sort(),
      )

      // The first cut's content was not touched by the second cut.
      expect(listFilesRecursive(versionedDocsFirstCut)).toEqual(firstCutContentSnapshot)
      expect(listFilesRecursive(versionedDocsFirstCut)).toEqual(listFilesRecursive(f.docsDir))
      const versionedDocsSecondCut = path.join(f.websiteDir, 'versioned_docs', 'version-0.3.0')
      expect(listFilesRecursive(versionedDocsSecondCut)).toEqual(listFilesRecursive(f.docsDir))

      // lastVersion ends on the last cut, not the first.
      expect(readConfigRaw(f)).toContain("lastVersion: '0.3.0',")
    },
    30_000,
  )
})
