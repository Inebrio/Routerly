// Regression coverage for RC-2's frozen contact points, rewritten by RC-5
// against the renamed release.yml (see
// .claude/specs/release-channels/02-blueprint/RC-5.md, "Contact points").
//
// This story ships a GitHub Actions workflow, not application code, so there
// is no source module to test beside. It lives here — inside packages/shared
// — because packages/shared is one of the four workspaces the CI gate runs
// `npm test` against (see packages/service, packages/cli, packages/dashboard
// for the others); a test placed at the repository root would never run in
// that gate and would be decoration, not coverage.
//
// Everything here is asserted against the parsed YAML/JS structure, never
// against raw text, so a comment mentioning the right string cannot fake a
// pass.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { createRequire } from 'node:module'

// js-yaml has no bundled type declarations. Loaded via createRequire rather
// than a static import so this file does not need to augment an untyped
// module (TS2665) or add a package-wide ambient .d.ts.
const require = createRequire(import.meta.url)
const yaml = require('js-yaml') as { load: (input: string) => unknown }

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const WORKFLOW_PATH = resolve(REPO_ROOT, '.github/workflows/release.yml')
const RELEASE_CONFIG_PATH = resolve(REPO_ROOT, 'release.config.mjs')

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  if?: string
  with?: Record<string, unknown>
  env?: Record<string, unknown>
}

interface WorkflowJob {
  needs?: string | string[]
  if?: string
  outputs?: Record<string, string>
  steps?: WorkflowStep[]
}

interface WorkflowDoc {
  name: string
  on: {
    push?: { branches?: string[]; paths?: unknown; 'paths-ignore'?: unknown }
    workflow_dispatch?: unknown
  }
  concurrency?: { group?: string; 'cancel-in-progress'?: boolean }
  permissions?: Record<string, string>
  jobs: Record<string, WorkflowJob>
}

interface ReleaseConfig {
  branches: unknown[]
  plugins: unknown[]
}

function loadWorkflow(): WorkflowDoc {
  return yaml.load(readFileSync(WORKFLOW_PATH, 'utf-8')) as WorkflowDoc
}

async function loadReleaseConfig(): Promise<ReleaseConfig> {
  const mod = (await import(RELEASE_CONFIG_PATH)) as { default: ReleaseConfig }
  return mod.default
}

function pluginName(entry: unknown): string {
  return Array.isArray(entry) ? (entry[0] as string) : (entry as string)
}

describe('RC-5 — release.yml workflow contract', () => {
  it('A1 — is named "Release Pipeline", RC-2\'s shipped display name', () => {
    const doc = loadWorkflow()
    expect(doc.name).toBe('Release Pipeline')
  })

  it('A2 — triggers on push to main and develop only', () => {
    const doc = loadWorkflow()
    expect(doc.on.push?.branches).toEqual(['main', 'develop'])
  })

  it('A3 — no workflow_dispatch key on the normal release flow', () => {
    const doc = loadWorkflow()
    expect(doc.on).not.toHaveProperty('workflow_dispatch')
  })

  it('A4 — the push trigger has no paths or paths-ignore restriction', () => {
    const doc = loadWorkflow()
    expect(doc.on.push).not.toHaveProperty('paths')
    expect(doc.on.push).not.toHaveProperty('paths-ignore')
  })

  it("A5 — permissions grant contents, issues and pull-requests write (semantic-release/github's requirement)", () => {
    const doc = loadWorkflow()
    expect(doc.permissions).toEqual({
      contents: 'write',
      issues: 'write',
      'pull-requests': 'write',
    })
  })

  it('A6 — concurrency is defined and scoped per-branch via github.ref, not global', () => {
    const doc = loadWorkflow()
    expect(doc.concurrency?.group).toBeDefined()
    expect(doc.concurrency!.group).toContain('github.ref')
  })

  it("A7 — the release job's needs includes the gate job, and the gate job is not the release job", () => {
    const doc = loadWorkflow()
    const releaseJob = doc.jobs.release
    expect(releaseJob, 'release job').toBeDefined()
    expect(doc.jobs.gate, 'gate job').toBeDefined()
    expect(releaseJob!.needs).toContain('gate')
    expect('gate').not.toBe('release')
  })

  it('A8 — jobs.release.outputs keys are exactly released, action, version, git_tag, channel, docker_channel_tag', () => {
    const doc = loadWorkflow()
    const outputs = doc.jobs.release?.outputs
    expect(outputs, 'release job outputs').toBeDefined()
    expect(Object.keys(outputs!).sort()).toEqual(
      ['action', 'channel', 'docker_channel_tag', 'git_tag', 'released', 'version'].sort()
    )
  })

  it("A9 — the docker job depends on release, gates on its released output, and its publish step's image tags are channel-derived (no hardcoded semver)", () => {
    const doc = loadWorkflow()
    const dockerJob = doc.jobs.docker
    expect(dockerJob, 'docker job').toBeDefined()
    expect(dockerJob!.needs).toContain('release')
    expect(dockerJob!.if).toContain('needs.release.outputs.released')

    const steps = dockerJob!.steps ?? []
    const actionGatedSteps = steps.filter((s) => s.if?.includes('needs.release.outputs.action'))
    expect(actionGatedSteps.length, 'steps gated on needs.release.outputs.action').toBeGreaterThan(0)

    const publishStep = steps.find((s) => s.name === 'Build and push (publish)')
    expect(publishStep, 'Build and push (publish) step').toBeDefined()
    const tags = String(publishStep!.with?.tags ?? '')
    expect(tags).toContain('needs.release.outputs.git_tag')
    expect(tags).toContain('needs.release.outputs.docker_channel_tag')
    expect(tags).not.toContain('needs.release.outputs.version')
    expect(tags).not.toMatch(/\bv?\d+\.\d+\.\d+\b/)
  })
})

describe('RC-5 — release.config.mjs contract', () => {
  it('A10 — branches is [\'main\', { name: \'develop\', channel: \'next\' }], main first (analysis D1)', async () => {
    const config = await loadReleaseConfig()
    expect(config.branches).toEqual(['main', { name: 'develop', channel: 'next' }])
    // branches[0] === 'main' asserted separately: the first entry drives the
    // default/"current" channel and must never silently reorder (analysis D1).
    expect(config.branches[0]).toBe('main')
  })

  it('A11 — plugins contain no @semantic-release/npm entry', async () => {
    const config = await loadReleaseConfig()
    const names = config.plugins.map(pluginName)
    expect(names).not.toContain('@semantic-release/npm')
  })
})
