/**
 * Fixture builder for scripts/docs-version.mjs (story RA-09).
 *
 * The script derives every path (`website/`, `docs/`) from its own file
 * location, so exercising it against a throwaway tree means building a
 * miniature repo layout under the OS temp directory and dropping a *copy*
 * of the real script inside it. Real `website/node_modules` and
 * `website/static` are large (>600MB) and slow to install, so the fixture
 * symlinks them in read-only rather than copying — `fs.rmSync` on a
 * symlink removes only the link, never the target, so cleanup can never
 * reach back into the real tree.
 *
 * This never touches `website/` or `docs/` in the worktree. Every fixture
 * lives under `os.tmpdir()` and is removed after each test.
 */
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..')
export const REAL_SCRIPT = path.join(REPO_ROOT, 'scripts', 'docs-version.mjs')
export const REAL_WEBSITE = path.join(REPO_ROOT, 'website')

export interface Fixture {
  root: string
  scriptPath: string
  websiteDir: string
  docsDir: string
  versionsPath: string
  configPath: string
}

function configSource(lastVersion: string, versions: string[], corrupt?: 'zero' | 'two'): string {
  const versionsMap = versions
    .map((v) => `            '${v}': { label: '${v}', badge: true },`)
    .join('\n')

  const lastVersionLine =
    corrupt === 'zero'
      ? `          lastVersionXXX: '${lastVersion}',`
      : corrupt === 'two'
        ? `          lastVersion: '${lastVersion}',\n          lastVersion: '${lastVersion}',`
        : `          lastVersion: '${lastVersion}',`

  return `import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

const config: Config = {
  title: 'Fixture',
  url: 'https://example.test',
  baseUrl: '/',
  organizationName: 'test',
  projectName: 'test',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  i18n: { defaultLocale: 'en', locales: ['en'] },
  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
${lastVersionLine}
          versions: {
            current: { label: 'next', badge: true },
${versionsMap}
          },
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],
  themeConfig: {},
};

export default config;
`
}

/**
 * Builds a throwaway repo layout with a working (or deliberately corrupted)
 * `website/docusaurus.config.ts`, seeded `website/versions.json` and a small
 * `docs/` tree. `website/node_modules` and `website/static` are symlinked
 * from the real worktree so the Docusaurus CLI can actually run without a
 * fresh `npm ci`.
 */
export function buildFixture(
  opts: {
    initialVersions?: string[]
    corrupt?: 'zero' | 'two'
    docsFiles?: string[]
  } = {},
): Fixture {
  const initialVersions = opts.initialVersions ?? ['0.1.0']
  const docsFiles = opts.docsFiles ?? ['intro.md', 'guide/page.md']

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ra09-docs-version-'))
  const scriptsDir = path.join(root, 'scripts')
  const docsDir = path.join(root, 'docs')
  const websiteDir = path.join(root, 'website')

  fs.mkdirSync(scriptsDir, { recursive: true })
  fs.mkdirSync(docsDir, { recursive: true })
  fs.mkdirSync(path.join(websiteDir, 'src', 'css'), { recursive: true })
  fs.mkdirSync(path.join(websiteDir, 'versioned_docs'), { recursive: true })
  fs.mkdirSync(path.join(websiteDir, 'versioned_sidebars'), { recursive: true })

  const scriptPath = path.join(scriptsDir, 'docs-version.mjs')
  fs.copyFileSync(REAL_SCRIPT, scriptPath)

  for (const relFile of docsFiles) {
    const abs = path.join(docsDir, relFile)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, `# ${relFile}\n`)
  }

  fs.copyFileSync(path.join(REAL_WEBSITE, 'package.json'), path.join(websiteDir, 'package.json'))
  fs.copyFileSync(path.join(REAL_WEBSITE, 'sidebars.ts'), path.join(websiteDir, 'sidebars.ts'))
  fs.writeFileSync(path.join(websiteDir, 'src', 'css', 'custom.css'), '')
  fs.symlinkSync(path.join(REAL_WEBSITE, 'static'), path.join(websiteDir, 'static'))
  fs.symlinkSync(path.join(REAL_WEBSITE, 'node_modules'), path.join(websiteDir, 'node_modules'))

  const versionsPath = path.join(websiteDir, 'versions.json')
  fs.writeFileSync(versionsPath, JSON.stringify(initialVersions))

  const configPath = path.join(websiteDir, 'docusaurus.config.ts')
  const lastVersion = initialVersions[0] ?? '0.1.0'
  fs.writeFileSync(configPath, configSource(lastVersion, initialVersions, opts.corrupt))

  for (const v of initialVersions) {
    const versionDocsDir = path.join(websiteDir, 'versioned_docs', `version-${v}`)
    fs.mkdirSync(versionDocsDir, { recursive: true })
    for (const relFile of docsFiles) {
      const abs = path.join(versionDocsDir, relFile)
      fs.mkdirSync(path.dirname(abs), { recursive: true })
      fs.writeFileSync(abs, `# ${relFile} (v${v})\n`)
    }
    fs.writeFileSync(
      path.join(websiteDir, 'versioned_sidebars', `version-${v}-sidebars.json`),
      JSON.stringify({ [`version-${v}/sidebar`]: [] }),
    )
  }

  return { root, scriptPath, websiteDir, docsDir, versionsPath, configPath }
}

export function cleanupFixture(fixture: Fixture): void {
  fs.rmSync(fixture.root, { recursive: true, force: true })
}

export interface RunResult {
  status: number | null
  stdout: string
  stderr: string
}

/** Runs the fixture's copy of the script exactly the way `npm run docs:cut -- <arg>` does. */
export function runDocsCut(fixture: Fixture, arg?: string): RunResult {
  const result = spawnSync(process.execPath, [fixture.scriptPath, ...(arg !== undefined ? [arg] : [])], {
    cwd: fixture.root,
    encoding: 'utf-8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

export function readVersionsRaw(fixture: Fixture): string {
  return fs.readFileSync(fixture.versionsPath, 'utf-8')
}

export function readConfigRaw(fixture: Fixture): string {
  return fs.readFileSync(fixture.configPath, 'utf-8')
}

export function listVersionedDocsDirs(fixture: Fixture): string[] {
  return fs
    .readdirSync(path.join(fixture.websiteDir, 'versioned_docs'))
    .sort()
}

/** Recursively lists relative file paths under a directory, sorted, for content-mirroring comparisons. */
export function listFilesRecursive(dir: string): string[] {
  const out: string[] = []
  const walk = (current: string, prefix: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const abs = path.join(current, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(abs, rel)
      } else {
        out.push(rel)
      }
    }
  }
  walk(dir, '')
  return out.sort()
}
