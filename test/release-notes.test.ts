/**
 * RA-08: release notes generator (`scripts/release-notes.sh` + `cliff.toml`).
 *
 * Runs the real script and the real `cliff.toml` against a throwaway git
 * repository under the OS temp directory (see release-notes-fixture.ts),
 * never against the worktree's own history or its own `cliff.toml`. Each
 * test builds and tears down its own fixture, so failures leave no debris
 * in the repo and tests never depend on each other's state or on wall-clock
 * time.
 *
 * Story: .claude/specs/release-automation/01-stories/RA-08.md
 * Validation (round 2, PASS): .claude/specs/release-automation/03-validation/RA-08.md
 */
import { describe, it, expect, afterEach } from 'vitest'
import {
  buildFixture,
  cleanupFixture,
  commit,
  headSha,
  runReleaseNotes,
  tag,
  writeCliffToml,
  type Fixture,
} from './release-notes-fixture.js'
import * as fs from 'node:fs'

const fixtures: Fixture[] = []

function fixture(): Fixture {
  const f = buildFixture()
  fixtures.push(f)
  return f
}

afterEach(() => {
  while (fixtures.length > 0) {
    cleanupFixture(fixtures.pop()!)
  }
})

describe('RA-08, AC1 and regression: conventional commits group correctly', () => {
  it('feat/fix/perf/docs/refactor land in their own sections, scoped and breaking forms included', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'feat(scope): scoped feature')
    commit(f, 'fix!: breaking fix no scope')
    commit(f, 'fix(scope)!: breaking fix with scope')
    commit(f, 'perf: speed up router')
    commit(f, 'docs: update readme')
    commit(f, 'refactor: extract helper')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('### Features')
    expect(result.stdout).toContain('**scope:** Scoped feature')
    expect(result.stdout).toContain('### Bug Fixes')
    expect(result.stdout).toContain('Breaking fix no scope')
    expect(result.stdout).toContain('**scope:** Breaking fix with scope')
    expect(result.stdout).toContain('### Performance')
    expect(result.stdout).toContain('Speed up router')
    expect(result.stdout).toContain('### Documentation')
    expect(result.stdout).toContain('Update readme')
    expect(result.stdout).toContain('### Refactor')
    expect(result.stdout).toContain('Extract helper')
  })
})

describe('RA-08, AC3 and regression: chore, ci, build, test, style are skipped', () => {
  it('none of the five skipped types produce output or a section, and generation does not error', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'chore: version packages')
    commit(f, 'ci: update workflow')
    commit(f, 'build: bump deps')
    commit(f, 'test: add coverage')
    commit(f, 'style: reformat')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stdout).not.toContain('version packages')
    expect(result.stdout).not.toContain('update workflow')
    expect(result.stdout).not.toContain('bump deps')
    expect(result.stdout).not.toContain('add coverage')
    expect(result.stdout).not.toContain('reformat')
    // No blank section produced for an all-skipped range (AC3).
    expect(result.stdout).not.toMatch(/^### .*\n\s*### /m)
  })
})

describe('RA-08, B1 regression: non-conventional subjects go to Other Changes, never dropped', () => {
  it('a subject that merely starts with "fix"/"fixing" is not miscategorised as a real fix', () => {
    // Lowercase, matching the real pre-v0.1.0 commit subjects the
    // validator reproduced this bug against ("fix model", "fixing model
    // form"). Conventional-commit types are lowercase, so a capitalised
    // "Fix model" would never match the buggy unanchored pattern either
    // and would not exercise the regression at all.
    const f = fixture()
    const from = headSha(f)
    commit(f, 'fix model')
    commit(f, 'fixing model form')
    commit(f, 'fix(scope): a genuine fix')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('### Other Changes')
    expect(result.stdout).toContain('Fix model')
    expect(result.stdout).toContain('Fixing model form')

    // Only the genuine conventional fix appears under Bug Fixes.
    const bugFixesSection = result.stdout.split('### Bug Fixes')[1]?.split('###')[0] ?? ''
    expect(bugFixesSection).toContain('A genuine fix')
    expect(bugFixesSection).not.toContain('Fix model')
    expect(bugFixesSection).not.toContain('Fixing model form')
  })

  it('"refactoring routing logic" is not miscategorised as a real refactor', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'refactoring routing logic')
    commit(f, 'refactor: extract real helper')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('### Other Changes')
    expect(result.stdout).toContain('Refactoring routing logic')

    const refactorSection = result.stdout.split('### Refactor')[1]?.split('###')[0] ?? ''
    expect(refactorSection).toContain('Extract real helper')
    expect(refactorSection).not.toContain('Refactoring routing logic')
  })

  it('EC2: a subject starting with "chore" that is not a chore: commit is not silently dropped', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'choreographed a smoother onboarding flow for new users')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('### Other Changes')
    expect(result.stdout).toContain('Choreographed a smoother onboarding flow for new users')
  })
})

describe('RA-08, EC1: zero-commit range produces a well-formed, empty document', () => {
  it('exits 0 with a header and no entries, not an error', () => {
    const f = fixture()
    // git-cliff needs at least one tag matching --tag-pattern reachable in
    // history to establish a release boundary at all; the real repository
    // this story is validated against always has one. Out of scope note in
    // the story says generation must work from a range alone, not require a
    // tag to *exist for the range itself*, the script's own contract
    // (blueprint) is unaffected by this, and the real repository this ships
    // in always carries release tags.
    tag(f, 'v0.0.1')

    const result = runReleaseNotes(f, ['HEAD', 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stdout).toContain('## Release Notes')
    expect(result.stdout).not.toMatch(/^### /m)
    expect(result.stderr).toBe('')
  })
})

describe('RA-08, AC2: same range rendered twice is byte-identical', () => {
  it('two renders of the same range produce identical output', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'feat: add a thing')
    commit(f, 'fix: fix a thing')
    commit(f, 'chore: irrelevant')

    const a = runReleaseNotes(f, [from, 'HEAD'])
    const b = runReleaseNotes(f, [from, 'HEAD'])

    expect(a.status).toBe(0)
    expect(b.status).toBe(0)
    expect(a.stdout).toBe(b.stdout)
  })
})

describe('RA-08: error contract', () => {
  it('happy path exits 0 with notes on stdout and nothing on stderr', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'feat: something shippable')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('### Features')
  })

  it('wrong argument count exits 1 with exactly one usage line on stderr, nothing on stdout', () => {
    const f = fixture()

    const result = runReleaseNotes(f, [])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    const stderrLines = result.stderr.split('\n').filter((l) => l.length > 0)
    expect(stderrLines).toHaveLength(1)
    expect(stderrLines[0]).toContain('Usage: release-notes.sh')
  })

  it('an unresolvable ref exits 1 with exactly one line on stderr naming the ref', () => {
    const f = fixture()

    const result = runReleaseNotes(f, ['does-not-exist-ref', 'HEAD'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    const stderrLines = result.stderr.split('\n').filter((l) => l.length > 0)
    expect(stderrLines).toHaveLength(1)
    expect(stderrLines[0]).toContain('does-not-exist-ref')
  })

  it('neither git-cliff nor npx on PATH exits 1 with exactly one actionable line on stderr, stdout empty', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'feat: something shippable')

    // Only the directories holding git and bash's own builtins survive; no
    // node, no npm, no npx, no git-cliff.
    const result = runReleaseNotes(f, [from, 'HEAD'], { PATH: '/usr/bin:/bin' })

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    const stderrLines = result.stderr.split('\n').filter((l) => l.length > 0)
    expect(stderrLines).toHaveLength(1)
    expect(stderrLines[0]).toContain('git-cliff is not installed')
    expect(stderrLines[0]).toContain('npx')
  })

  it('a malformed cliff.toml exits 1 with exactly one line naming the real parse error, and the real repository cliff.toml is never touched', () => {
    const f = fixture()
    const from = headSha(f)
    commit(f, 'feat: something shippable')
    const originalCliffToml = fs.readFileSync(f.cliffTomlPath, 'utf-8')

    writeCliffToml(f, originalCliffToml + '\nthis is not valid toml [[[\n')

    const result = runReleaseNotes(f, [from, 'HEAD'])

    expect(result.status).toBe(1)
    expect(result.stdout).toBe('')
    const stderrLines = result.stderr.split('\n').filter((l) => l.length > 0)
    expect(stderrLines).toHaveLength(1)
    expect(stderrLines[0]).toContain('release-notes: git-cliff failed to render')
    expect(stderrLines[0].toLowerCase()).toMatch(/toml|parse/)
  })
})
