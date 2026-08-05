// Regression coverage for RA-03's frozen contact points (see
// .claude/specs/release-automation/02-blueprint/RA-03.md, "Contact points").
//
// This story ships a GitHub Actions workflow, not application code, so there
// is no source module to test beside. It lives here — inside packages/shared
// — because packages/shared is one of the four workspaces the CI gate runs
// `npm test` against (see packages/service, packages/cli, packages/dashboard
// for the others); a test placed at the repository root would never run in
// that gate and would be decoration, not coverage.
//
// Everything here is asserted against the parsed YAML/JSON structure, never
// against raw text, so a comment mentioning the right string cannot fake a
// pass.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createRequire } from 'node:module'

// js-yaml has no bundled type declarations and is not a direct dependency of
// any workspace (it is pulled in transitively by @changesets/cli, which is a
// root devDependency and therefore always present after `npm ci`). Loaded via
// createRequire rather than a static import so this file does not need to
// augment an untyped module (TS2665) or add a package-wide ambient .d.ts.
const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (input: string) => unknown }

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/release-version.yml')
const CHANGESET_CONFIG_PATH = resolve(REPO_ROOT, '.changeset/config.json')

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
}

interface WorkflowDoc {
  name: string
  on: {
    push?: { branches?: string[]; paths?: unknown; 'paths-ignore'?: unknown }
  }
  concurrency?: unknown
  permissions?: Record<string, string>
  jobs: Record<string, { 'runs-on': string; steps: WorkflowStep[] }>
}

interface ChangesetConfig {
  baseBranch: string
  fixed: string[][]
}

function loadWorkflow(): WorkflowDoc {
  return yaml.load(readFileSync(WORKFLOW_PATH, 'utf-8')) as WorkflowDoc
}

function loadChangesetConfig(): ChangesetConfig {
  return JSON.parse(readFileSync(CHANGESET_CONFIG_PATH, 'utf-8')) as ChangesetConfig
}

function versionSteps(doc: WorkflowDoc): WorkflowStep[] {
  const job = doc.jobs.version
  expect(job, 'version job').toBeDefined()
  return job!.steps
}

function versionStep(doc: WorkflowDoc): WorkflowStep {
  const steps = versionSteps(doc)
  const step = steps.find((s) => s.uses?.startsWith('changesets/action@'))
  expect(step, 'changesets/action step').toBeDefined()
  return step!
}

describe('RA-03 — release-version.yml workflow contract', () => {
  it('AC1 — is named "Release Version", not "CI" (RA-05 matches workflow_run on CI by name)', () => {
    const doc = loadWorkflow()
    expect(doc.name).toBe('Release Version')
  })

  it('AC1 — triggers on push to release/** branches', () => {
    const doc = loadWorkflow()
    expect(doc.on.push?.branches).toContain('release/**')
  })

  it('neither trigger restricts by paths or paths-ignore', () => {
    const doc = loadWorkflow()
    expect(doc.on.push).not.toHaveProperty('paths')
    expect(doc.on.push).not.toHaveProperty('paths-ignore')
  })

  it('RA-04 contact point — the changesets/action step sets version: "npm run version" explicitly', () => {
    const doc = loadWorkflow()
    const step = versionStep(doc)
    expect(step.with?.version).toBe('npm run version')
  })

  it('the changesets/action step is pinned to the real published tag v1.9.0, and does not use pr-base-branch', () => {
    const doc = loadWorkflow()
    const step = versionStep(doc)
    expect(step.uses).toBe('changesets/action@v1.9.0')
    expect(step.with).not.toHaveProperty('pr-base-branch')
  })

  it('AC1 — branch input is the release branch itself, driving both PR base and derived head', () => {
    const doc = loadWorkflow()
    const step = versionStep(doc)
    expect(step.with?.branch).toBe('${{ github.ref_name }}')
  })

  it('the prerelease guard step exists and precedes the changesets/action step', () => {
    const doc = loadWorkflow()
    const steps = versionSteps(doc)
    const guardIndex = steps.findIndex((s) => /pre\.json/.test(s.run ?? ''))
    const actionIndex = steps.findIndex((s) => s.uses?.startsWith('changesets/action@'))
    expect(guardIndex, 'prerelease guard step').toBeGreaterThanOrEqual(0)
    expect(actionIndex, 'changesets/action step').toBeGreaterThanOrEqual(0)
    expect(guardIndex).toBeLessThan(actionIndex)
  })

  it('AC3 — the prerelease guard fails the run when .changeset/pre.json exists, and passes when it does not', () => {
    const doc = loadWorkflow()
    const steps = versionSteps(doc)
    const guard = steps.find((s) => /pre\.json/.test(s.run ?? ''))
    expect(guard?.run, 'guard step run block').toBeDefined()

    const scratch = mkdtempSync(resolve(tmpdir(), 'ra03-guard-'))
    try {
      mkdirSync(resolve(scratch, '.changeset'))
      writeFileSync(resolve(scratch, 'guard.sh'), guard!.run!)

      // Present: must fail with the ::error:: annotation.
      writeFileSync(resolve(scratch, '.changeset/pre.json'), '{}')
      let failure: unknown
      try {
        execFileSync('bash', ['guard.sh'], { cwd: scratch, stdio: 'pipe' })
      } catch (err) {
        failure = err
      }
      expect(failure, 'guard script must exit non-zero when pre.json exists').toBeDefined()
      const output = String((failure as { stdout?: Buffer }).stdout ?? '')
      expect(output).toContain('::error::')

      // Absent: must succeed.
      rmSync(resolve(scratch, '.changeset/pre.json'))
      expect(() =>
        execFileSync('bash', ['guard.sh'], { cwd: scratch, stdio: 'pipe' })
      ).not.toThrow()
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})

describe('RA-03 — .changeset/config.json contract', () => {
  it('AC1/AC4 — baseBranch is 0.4.0, the branch releases are actually cut from, not the stale main', () => {
    const config = loadChangesetConfig()
    expect(config.baseBranch).toBe('0.4.0')
  })

  it('AC2 — the fixed group still moves all four released packages together', () => {
    const config = loadChangesetConfig()
    expect(config.fixed).toHaveLength(1)
    expect(config.fixed[0]).toEqual(
      expect.arrayContaining([
        '@routerly/service',
        '@routerly/dashboard',
        '@routerly/cli',
        '@routerly/shared',
      ])
    )
    expect(config.fixed[0]).toHaveLength(4)
  })
})
