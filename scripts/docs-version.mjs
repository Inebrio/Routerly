#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — documentation version cut
// Wraps the Docusaurus versioning CLI in a single, script-friendly command:
//   npm run docs:cut -- <X.Y.Z>
// Called directly by maintainers and, as an opaque black box, by the release
// workflow. The contract (arguments, exit codes, stderr messages) is frozen —
// do not change it without updating every caller.
// ────────────────────────────────────────────────────────────────────────────

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as fs from 'node:fs';
import * as path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT  = path.resolve(SCRIPT_DIR, '..');
const WEBSITE_DIR = path.join(REPO_ROOT, 'website');
const VERSIONS_PATH = path.join(WEBSITE_DIR, 'versions.json');
const CONFIG_PATH   = path.join(WEBSITE_DIR, 'docusaurus.config.ts');

const LAST_VERSION_LINE_RE = /^(\s*lastVersion:\s*)'[^']*'(,?)\s*$/gm;

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

// ─── 1. Parse and validate the argument ────────────────────────────────────
const rawArg = process.argv[2];

if (!rawArg) {
  die('Missing version argument. Usage: npm run docs:cut -- <X.Y.Z>');
}

const BARE_SEMVER_RE = /^\d+\.\d+\.\d+$/;
const V_PREFIXED_RE  = /^v\d+\.\d+\.\d+$/;

if (V_PREFIXED_RE.test(rawArg)) {
  die(`Version must not have a "v" prefix. Use "${rawArg.slice(1)}" instead of "${rawArg}".`);
}

if (!BARE_SEMVER_RE.test(rawArg)) {
  die(`Malformed version "${rawArg}". Expected bare semver in the form X.Y.Z (e.g. 1.2.3).`);
}

const version = rawArg;

// ─── 2. Refuse if the version is already cut ───────────────────────────────
let versions;
try {
  versions = JSON.parse(fs.readFileSync(VERSIONS_PATH, 'utf-8'));
} catch (err) {
  die(`Could not read ${VERSIONS_PATH}: ${err.message}`);
}

if (versions.includes(version)) {
  die(`Version ${version} is already cut (present in website/versions.json).`);
}

// ─── 3. Pre-flight: confirm docusaurus.config.ts has a rewritable line ─────
// Nothing has been mutated yet at this point, so refusing here leaves the
// tree untouched. This does not replace the post-cut check below — it only
// predicts it will succeed before steps 4-5 run.
let preflightConfigContent;
try {
  preflightConfigContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
} catch (err) {
  die(`Could not read ${CONFIG_PATH}: ${err.message}`);
}

const preflightMatches = preflightConfigContent.match(LAST_VERSION_LINE_RE);

if (!preflightMatches || preflightMatches.length !== 1) {
  die(
    `Could not find a single "lastVersion: '...'" line in website/docusaurus.config.ts ` +
    `(found ${preflightMatches ? preflightMatches.length : 0}). Refusing to write — update the script's regex ` +
    `to match the current config shape.`
  );
}

// ─── 4. Install website dependencies if needed ─────────────────────────────
const websiteNodeModules = path.join(WEBSITE_DIR, 'node_modules');
if (!fs.existsSync(websiteNodeModules)) {
  const install = spawnSync('npm', ['ci', '--prefix', 'website'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (install.status !== 0) {
    die('Failed to install website dependencies (npm ci --prefix website).');
  }
}

// ─── 5. Run the actual version cut ─────────────────────────────────────────
const cut = spawnSync(
  'npm',
  ['run', 'docusaurus', '--prefix', 'website', '--', 'docs:version', version],
  {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }
);
if (cut.status !== 0) {
  die(`Docusaurus CLI failed to cut version ${version}.`);
}

// ─── 6. Rewrite lastVersion in docusaurus.config.ts ────────────────────────
let configContent;
try {
  configContent = fs.readFileSync(CONFIG_PATH, 'utf-8');
} catch (err) {
  die(`Could not read ${CONFIG_PATH}: ${err.message}`);
}

const matches = configContent.match(LAST_VERSION_LINE_RE);

if (!matches || matches.length !== 1) {
  die(
    `Could not find a single "lastVersion: '...'" line in website/docusaurus.config.ts ` +
    `(found ${matches ? matches.length : 0}). Refusing to write — update the script's regex ` +
    `to match the current config shape.`
  );
}

const newConfigContent = configContent.replace(
  LAST_VERSION_LINE_RE,
  `$1'${version}'$2`
);

try {
  fs.writeFileSync(CONFIG_PATH, newConfigContent);
} catch (err) {
  die(`Could not write ${CONFIG_PATH}: ${err.message}`);
}

// ─── 7. Report success ──────────────────────────────────────────────────────
const newVersionsContent = fs.readFileSync(VERSIONS_PATH, 'utf-8');
process.stdout.write(`Cut documentation version ${version}\n\n`);
process.stdout.write(`website/versions.json:\n${newVersionsContent}\n`);

process.exit(0);
