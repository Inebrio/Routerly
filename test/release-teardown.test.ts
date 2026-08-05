/**
 * RC-5 — Changesets/legacy-pipeline teardown, pinned as a repeatable check.
 *
 * The validator proved AC1, AC2, AC3 and AC6 by hand with `ls`/`grep`
 * commands (see .claude/specs/release-channels/03-validation/RC-5.md). This
 * file turns that manual proof into a suite so a later change cannot
 * silently reintroduce Changesets or the superseded workflows.
 *
 * Story: .claude/specs/release-channels/01-stories/RC-5.md
 * Blueprint: .claude/specs/release-channels/02-blueprint/RC-5.md
 */
import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

describe('RC-5, AC1: Changesets is fully removed', () => {
  it('.changeset/ does not exist', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, '.changeset'))).toBe(false)
  })

  it('root package.json has no changeset/version/release scripts and no @changesets/cli dependency', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
    expect(pkg.scripts).not.toHaveProperty('changeset')
    expect(pkg.scripts).not.toHaveProperty('version')
    expect(pkg.scripts).not.toHaveProperty('release')
    expect(pkg.devDependencies ?? {}).not.toHaveProperty('@changesets/cli')
  })

  it('js-yaml is an explicit direct devDependency (no longer only transitive via @changesets/cli)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf-8'))
    expect(pkg.devDependencies ?? {}).toHaveProperty('js-yaml')
  })
})

describe('RC-5, AC2: only the four surviving workflows remain', () => {
  it('.github/workflows contains exactly ci.yml, docker-rebuild.yml, docs-deploy.yml, release.yml', () => {
    const files = fs
      .readdirSync(path.join(REPO_ROOT, '.github/workflows'))
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .sort()
    expect(files).toEqual(['ci.yml', 'docker-rebuild.yml', 'docs-deploy.yml', 'release.yml'].sort())
  })

  it('the superseded workflow files are gone', () => {
    const superseded = [
      'release-version.yml',
      'release-abort.yml',
      'promote-stable.yml',
      'promote-develop.yml',
      'release-docker.yml',
    ]
    for (const name of superseded) {
      expect(
        fs.existsSync(path.join(REPO_ROOT, '.github/workflows', name)),
        `${name} should not exist`,
      ).toBe(false)
    }
  })

  it('scripts/release-abort.mjs is gone', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'scripts/release-abort.mjs'))).toBe(false)
  })
})

describe('RC-5, AC3: ci.yml no longer triggers on release/**', () => {
  it('the raw workflow text contains no release/** trigger pattern', () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, '.github/workflows/ci.yml'), 'utf-8')
    expect(raw).not.toContain('release/**')
  })
})

describe('RC-5, AC6: no Changesets reference survives in the contributor-facing surfaces this story owns', () => {
  it('README.md does not mention changesets', () => {
    const raw = fs.readFileSync(path.join(REPO_ROOT, 'README.md'), 'utf-8')
    expect(raw.toLowerCase()).not.toContain('changeset')
  })

  it('.claude/commands/changeset.md is deleted', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, '.claude/commands/changeset.md'))).toBe(false)
  })

  it('.claude/agents/backend-engineer.md does not reference changesets/action', () => {
    const raw = fs.readFileSync(
      path.join(REPO_ROOT, '.claude/agents/backend-engineer.md'),
      'utf-8',
    )
    expect(raw).not.toContain('changesets/action')
  })
})
