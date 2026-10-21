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
})
