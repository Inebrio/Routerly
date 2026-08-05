/**
 * RC-1: the release engine's prepare step (`release.config.mjs`'s
 * `@semantic-release/exec` `prepareCmd`).
 *
 * Runs the real config's real `prepareCmd` against a throwaway git + npm
 * workspace under the OS temp directory (see release-engine-fixture.ts),
 * never against the worktree's own history or its own manifests. Each test
 * builds and tears down its own fixture.
 *
 * Story: .claude/specs/release-channels/01-stories/RC-1.md
 * Blueprint: .claude/specs/release-channels/02-blueprint/RC-1.md (AC7)
 */
import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { spawnSync } from 'node:child_process'
import { generateNotes } from '@semantic-release/release-notes-generator'
import {
  buildFixture,
  cleanupFixture,
  expandNextReleaseVersion,
  loadReleaseConfig,
  REAL_RELEASE_CONFIG,
  runInFixture,
  type Fixture,
} from './release-engine-fixture.js'

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

async function realPrepareCmd(): Promise<string> {
  const config = await loadReleaseConfig()
  const execEntry = config.plugins.find(
    (entry: unknown) => Array.isArray(entry) && entry[0] === '@semantic-release/exec',
  )
  if (!execEntry) {
    throw new Error('release.config.mjs has no @semantic-release/exec entry')
  }
  const [, options] = execEntry as [string, { prepareCmd: string }]
  return options.prepareCmd
}

async function realPublishCmd(): Promise<string> {
  const config = await loadReleaseConfig()
  const execEntry = config.plugins.find(
    (entry: unknown) => Array.isArray(entry) && entry[0] === '@semantic-release/exec',
  )
  if (!execEntry) {
    throw new Error('release.config.mjs has no @semantic-release/exec entry')
  }
  const [, options] = execEntry as [string, { publishCmd: string }]
  return options.publishCmd
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf-8' })
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`)
  }
  return result.stdout
}

const MANIFEST_PATHS = [
  'package.json',
  'packages/cli/package.json',
  'packages/dashboard/package.json',
  'packages/shared/package.json',
  'packages/service/package.json',
]

describe('RC-1, AC7: the real prepareCmd rewrites every manifest and passes its own version check', () => {
  it('bumps all five package.json files, package-lock.json, and both in-source literals', async () => {
    const f = fixture()
    const prepareCmd = await realPrepareCmd()
    const expanded = expandNextReleaseVersion(prepareCmd, '1.2.3')

    const result = runInFixture(f, expanded)

    expect(result.status).toBe(0)

    for (const manifestPath of MANIFEST_PATHS) {
      const pkg = JSON.parse(fs.readFileSync(path.join(f.root, manifestPath), 'utf-8'))
      expect(pkg.version).toBe('1.2.3')
    }

    const lockfile = fs.readFileSync(path.join(f.root, 'package-lock.json'), 'utf-8')
    expect(lockfile).toContain('"1.2.3"')

    const indexTs = fs.readFileSync(
      path.join(f.root, 'packages/service/src/index.ts'),
      'utf-8',
    )
    expect(indexTs).toContain("version: '1.2.3'")
    expect(indexTs).toContain("dep = '^1.2.3'")
  })

  it('the trailing `sync-module-versions.mjs --check` makes the whole compound command exit 0', async () => {
    // The command is `A && B && C`; `&&` short-circuits on the first
    // non-zero segment, so asserting the overall exit code is 0 already
    // proves the trailing --check segment ran and passed — a version drift
    // between any manifest and packages/service/package.json would make
    // --check exit 1 and the whole command exit non-zero.
    const f = fixture()
    const prepareCmd = await realPrepareCmd()
    const expanded = expandNextReleaseVersion(prepareCmd, '4.5.6')

    const result = runInFixture(f, expanded)

    expect(result.status).toBe(0)
  })
})

describe('RC-1: prepareCmd must not invoke Changesets mid-release', () => {
  it('contains --ignore-scripts', async () => {
    // The root package.json's `version` script is still
    // `changeset version && node scripts/sync-module-versions.mjs` in this
    // story (RC-5 retires Changesets, not RC-1). `npm version` runs that
    // script by default; without --ignore-scripts, the release engine's own
    // prepare step would shell out to Changesets in the middle of a
    // semantic-release run.
    const prepareCmd = await realPrepareCmd()

    expect(prepareCmd).toContain('--ignore-scripts')
  })
})

describe('RC-1, AC8: the real publishCmd stamps a tarball with zero commits and zero ref changes', () => {
  it('creates no commit, moves no ref, and the archive built from git write-tree carries the new version', async () => {
    const f = fixture()
    const version = '7.8.9'

    const revListBefore = git(f.root, ['rev-list', '--count', 'HEAD']).trim()
    const headBefore = git(f.root, ['rev-parse', 'HEAD']).trim()

    const prepareCmd = expandNextReleaseVersion(await realPrepareCmd(), version)
    const prepareResult = runInFixture(f, prepareCmd)
    expect(prepareResult.status).toBe(0)

    const publishCmd = expandNextReleaseVersion(await realPublishCmd(), version)
    const publishResult = runInFixture(f, publishCmd)
    expect(publishResult.status).toBe(0)

    // (a) commit count unchanged
    const revListAfter = git(f.root, ['rev-list', '--count', 'HEAD']).trim()
    expect(revListAfter).toBe(revListBefore)

    // (b) HEAD sha unchanged
    const headAfter = git(f.root, ['rev-parse', 'HEAD']).trim()
    expect(headAfter).toBe(headBefore)

    // (c) the tarball built from git write-tree carries the new version
    const tarballPath = path.join(f.root, `routerly-${version}.tar.gz`)
    expect(fs.existsSync(tarballPath)).toBe(true)

    const extractDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc1-release-engine-extract-'))
    try {
      const extract = spawnSync('tar', ['-xzf', tarballPath, '-C', extractDir], { encoding: 'utf-8' })
      expect(extract.status).toBe(0)

      const prefix = `routerly-${version}`
      for (const manifestPath of MANIFEST_PATHS) {
        const pkg = JSON.parse(
          fs.readFileSync(path.join(extractDir, prefix, manifestPath), 'utf-8'),
        )
        expect(pkg.version).toBe(version)
      }
    } finally {
      fs.rmSync(extractDir, { recursive: true, force: true })
    }

    // (d) no stray untracked file leaked outside the explicit publishCmd path
    // list. The tarball itself is expected to be untracked — it is
    // publishCmd's own output artifact, never added to the index — so it is
    // excluded from the "nothing else leaked" assertion.
    const untracked = git(f.root, ['ls-files', '--others', '--exclude-standard'])
      .split('\n')
      .filter((line) => line.trim().length > 0 && line.trim() !== `routerly-${version}.tar.gz`)
    expect(untracked).toEqual([])
  })
})

describe('RC-1, AC5 (Task 7 fix): promoted releases are re-marked latest', () => {
  it('carries an addChannelCmd exec entry running `gh release edit <tag> --latest`', async () => {
    // Regression for the gap found live during Task 3 and fixed in Task 7:
    // @semantic-release/github's addChannel PATCH flips `prerelease` to
    // false on promotion but never touches `make_latest`, so GitHub's own
    // "latest" selection does not reliably land on the just-promoted
    // release. Losing this exec entry silently reintroduces that gap.
    const config = await loadReleaseConfig()
    const addChannelEntry = config.plugins.find(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry[0] === '@semantic-release/exec' &&
        typeof (entry[1] as Record<string, unknown>)?.addChannelCmd === 'string' &&
        ((entry[1] as Record<string, string>).addChannelCmd as string).includes('--latest'),
    )
    expect(addChannelEntry).toBeDefined()
    const [, options] = addChannelEntry as [string, { addChannelCmd: string }]
    expect(options.addChannelCmd).toContain('gh release edit')
    expect(options.addChannelCmd).toContain('${nextRelease.gitTag}')
    expect(options.addChannelCmd).toContain('--latest')
  })

  it('the make-latest exec entry is positioned after @semantic-release/github in the plugin array', async () => {
    // Order matters (blueprint task 7): the flag flip must run after
    // @semantic-release/github's own addChannel PATCH, not before it.
    const config = await loadReleaseConfig()
    const names = config.plugins.map((entry: unknown) =>
      Array.isArray(entry) ? (entry[0] as string) : (entry as string),
    )
    const githubIndex = names.indexOf('@semantic-release/github')
    const makeLatestIndex = config.plugins.findIndex(
      (entry: unknown) =>
        Array.isArray(entry) &&
        entry[0] === '@semantic-release/exec' &&
        typeof (entry[1] as Record<string, unknown>)?.addChannelCmd === 'string' &&
        ((entry[1] as Record<string, string>).addChannelCmd as string).includes('--latest'),
    )
    expect(githubIndex).toBeGreaterThanOrEqual(0)
    expect(makeLatestIndex).toBeGreaterThan(githubIndex)
  })
})

describe('RC-1: release.config.mjs cannot reintroduce a commit-back', () => {
  it('has no @semantic-release/git plugin entry', async () => {
    const config = await loadReleaseConfig()
    const gitPluginEntry = config.plugins.find(
      (entry: unknown) =>
        entry === '@semantic-release/git' ||
        (Array.isArray(entry) && entry[0] === '@semantic-release/git'),
    )
    expect(gitPluginEntry).toBeUndefined()
  })

  it('the raw config file text contains neither "[skip ci]" nor "chore(release)"', () => {
    // Standing regression guard: a future edit that reintroduces a
    // commit-creating step (whether via @semantic-release/git or a custom
    // prepareCmd/publishCmd) would almost certainly reintroduce one of these
    // two strings, since both are the conventional markers of a release
    // commit. Reading the raw file text, not the imported module, so a
    // string embedded in a value the import would otherwise evaluate away
    // (e.g. a template literal) is still caught.
    const raw = fs.readFileSync(REAL_RELEASE_CONFIG, 'utf-8')
    expect(raw).not.toContain('[skip ci]')
    expect(raw).not.toContain('chore(release)')
  })
})

async function realReleaseNotesGeneratorConfig(): Promise<Record<string, unknown>> {
  const config = await loadReleaseConfig()
  const notesEntry = config.plugins.find(
    (entry: unknown) =>
      Array.isArray(entry) && entry[0] === '@semantic-release/release-notes-generator',
  )
  if (!notesEntry) {
    throw new Error('release.config.mjs has no @semantic-release/release-notes-generator entry')
  }
  const [, pluginConfig] = notesEntry as [string, Record<string, unknown>]
  return pluginConfig
}

const VISIBLE_SECTIONS = ['Features', 'Bug Fixes', 'Performance', 'Documentation', 'Refactor']
const HIDDEN_TYPES = ['chore', 'ci', 'build', 'test', 'style', 'revert']

// One conventional commit per visible/hidden type, keyed by type so the
// hidden-type subjects below can be asserted absent from the rendered notes
// by their own distinctive wording.
const TYPE_SUBJECTS: Record<string, string> = {
  feat: 'feat: add widget',
  fix: 'fix: correct widget',
  perf: 'perf: speed up widget',
  docs: 'docs: document widget',
  refactor: 'refactor: restructure widget',
  chore: 'chore: bump widget deps',
  ci: 'ci: adjust widget pipeline',
  build: 'build: adjust widget bundler',
  test: 'test: add widget tests',
  style: 'style: format widget code',
  revert: 'revert: revert widget change',
}

const NON_CONVENTIONAL_SUBJECT = 'wip stuff'

interface RawCommit {
  hash: string
  message: string
}

/**
 * Seeds the given fixture with one commit per conventional type in
 * TYPE_SUBJECTS, one non-conventional commit, and a real `--no-ff` merge
 * commit, then returns every reachable commit as `{ hash, message }` in the
 * shape `generateNotes`'s `context.commits` expects (parsing only reads
 * `message`; `hash` only feeds the rendered short-sha link).
 */
function seedParityCommits(f: Fixture): RawCommit[] {
  for (const subject of Object.values(TYPE_SUBJECTS)) {
    git(f.root, ['commit', '--allow-empty', '-q', '-m', subject])
  }

  git(f.root, ['commit', '--allow-empty', '-q', '-m', NON_CONVENTIONAL_SUBJECT])

  git(f.root, ['checkout', '-q', '-b', 'feature-branch'])
  git(f.root, ['commit', '--allow-empty', '-q', '-m', 'chore: work in progress on branch'])
  git(f.root, ['checkout', '-q', 'main'])
  git(f.root, [
    'merge',
    '--no-ff',
    '-q',
    '-m',
    "Merge branch 'feature-branch'",
    'feature-branch',
  ])

  const log = git(f.root, ['log', '--reverse', '--pretty=format:%H%x01%s'])
  return log
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [hash, message] = line.split('\x01')
      return { hash, message }
    })
}

async function renderNotes(commits: RawCommit[], cwd: string): Promise<string> {
  const pluginConfig = await realReleaseNotesGeneratorConfig()
  return generateNotes(pluginConfig, {
    commits,
    lastRelease: {},
    nextRelease: { version: '1.0.0', gitTag: 'v1.0.0' },
    options: { repositoryUrl: 'https://github.com/routerly-test/rc1-fixture.git' },
    cwd,
    logger: { log: () => {}, error: () => {} },
    env: {},
  })
}

describe('RC-1, AC9: notes generator parity — the presetConfig.types section split', () => {
  it('renders exactly the five visible headings, hides the six hidden types, and omits the non-conventional and merge commits', async () => {
    const f = fixture()
    const commits = seedParityCommits(f)

    const notes = await renderNotes(commits, f.root)

    for (const heading of VISIBLE_SECTIONS) {
      expect(notes).toContain(`### ${heading}`)
    }

    for (const hiddenType of HIDDEN_TYPES) {
      expect(notes).not.toContain(`### ${hiddenType}`)
      // The hidden type's own commit subject (minus the "type: " prefix)
      // must not appear anywhere in the rendered notes either — proves the
      // commit was fully discarded, not merely un-headed.
      const [, subject] = TYPE_SUBJECTS[hiddenType].split(': ')
      expect(notes).not.toContain(subject)
    }

    expect(notes).not.toContain(NON_CONVENTIONAL_SUBJECT)
    expect(notes).not.toContain("Merge branch 'feature-branch'")
  })
})

describe('RC-1, EC4: rendering an empty or fully-hidden commit range does not throw', () => {
  it('an empty commit list produces a non-throwing, headingless result', async () => {
    const f = fixture()

    const notes = await renderNotes([], f.root)

    expect(typeof notes).toBe('string')
    for (const heading of VISIBLE_SECTIONS) {
      expect(notes).not.toContain(`### ${heading}`)
    }
  })

  it('a commit range where every commit maps to a hidden type produces no headings', async () => {
    const f = fixture()
    git(f.root, ['commit', '--allow-empty', '-q', '-m', 'chore: only a hidden-type commit'])

    const log = git(f.root, ['log', '-1', '--pretty=format:%H%x01%s'])
    const [hash, message] = log.trim().split('\x01')

    const notes = await renderNotes([{ hash, message }], f.root)

    expect(typeof notes).toBe('string')
    for (const heading of VISIBLE_SECTIONS) {
      expect(notes).not.toContain(`### ${heading}`)
    }
  })
})
