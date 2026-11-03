import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '../../../../..')
const read = (p: string): string => readFileSync(join(root, p), 'utf8')

// A policy is one file in policies/ that is not a helper or a test.
const policies = readdirSync(join(here, 'policies'))
  .filter(f => f.endsWith('.ts') && !f.endsWith('.test.ts') && !['scoring.ts', 'types.ts'].includes(f))
  .map(f => f.replace(/\.ts$/, ''))
  .sort()

describe('README and docs intro stay aligned with the product', () => {
  const readme = read('README.md')
  const intro = read('docs/intro.md')

  it('README policy table lists exactly the available policies', () => {
    const section = readme.slice(readme.indexOf('### Routing policies'))
    const rows = [...section.matchAll(/^\| `([a-z-]+)` \|/gm)].map(m => m[1]!)
    expect([...rows].sort()).toEqual(policies)
  })

  it.each([['README.md', readme], ['docs/intro.md', intro]])('%s states the policy count and names every policy', (_name, text) => {
    expect(text).toContain(`${policies.length} routing policies`)
    for (const p of policies) expect(text).toContain(`\`${p}\``)
  })

  it('docs/concepts/routing.md documents every policy', () => {
    const routing = read('docs/concepts/routing.md')
    for (const p of policies) expect(routing).toContain(`\`${p}\``)
  })

  it.each([['README.md', readme], ['docs/intro.md', intro]])('%s has no removed commands or channels', (_name, text) => {
    expect(text).not.toMatch(/routerly project /)
    expect(text).not.toMatch(/--channel stable|Channels: `stable`/)
  })

  it('both comparison tables carry the same last-verified date', () => {
    const date = /Last verified: (\d{4}-\d{2}-\d{2})/
    expect(readme.match(date)?.[1]).toBeTruthy()
    expect(readme.match(date)?.[1]).toBe(intro.match(date)?.[1])
  })

  it.each([['README.md', readme], ['docs/intro.md', intro]])('%s pins the installer to a 0.5.x version', (_name, text) => {
    const pins = [...text.matchAll(/(?:--version|-Version) (v\d+\.\d+\.\d+)/g)].map(m => m[1]!)
    expect(pins.length).toBeGreaterThanOrEqual(2)
    for (const v of pins) expect(v).toMatch(/^v0\.5\./)
  })

  it('Docker examples use a pinned 0.5.x image tag, never :latest', () => {
    for (const f of ['README.md', 'docs/getting-started/installation.md', 'docs/guides/self-hosting.md']) {
      const text = read(f)
      expect(text).not.toMatch(/inebrio\/routerly:latest/)
      expect(text).toMatch(/inebrio\/routerly:v0\.5\.\d+/)
    }
  })
  it('README names every hosted provider and the CLI help lists every registered provider id', () => {
    const registry = read('packages/service/src/modules/provider/registry.ts')
    const hosted = /for \(const id of \[([^\]]+)\]/.exec(registry)![1].match(/'([a-z0-9-]+)'/g)!.map(s => s.slice(1, -1))
    const ids = [...registry.matchAll(/contribute\(\{ id: '([a-z0-9-]+)'/g)].map(m => m[1]).filter(id => !id.endsWith('-web'))
    const providersSection = /## Supported Providers([\s\S]*?)\n---/.exec(readme)![1].toLowerCase()
    for (const id of hosted) expect(providersSection, id).toContain(id)
    const help = /'Provider: ([^']+)'/.exec(read('packages/cli/src/commands/model.ts'))![1]
    for (const id of [...ids, ...hosted]) expect(help, id).toContain(id)
  })
})
