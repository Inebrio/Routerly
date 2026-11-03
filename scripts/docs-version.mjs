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

// ─── 3. Install website dependencies if needed ─────────────────────────────
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

// ─── 4. Run the actual version cut ─────────────────────────────────────────
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

// ─── 4b. Copy docs/assets alongside the versioned snapshot ────────────────
// The Docusaurus versioning CLI only copies markdown pages, not the assets/
// folder docs pages reference by relative path. Without this, every image
// in a versioned snapshot 404s.
const sourceAssets = path.join(REPO_ROOT, 'docs', 'assets');
const versionedAssets = path.join(WEBSITE_DIR, 'versioned_docs', `version-${version}`, 'assets');
if (fs.existsSync(sourceAssets)) {
  fs.cpSync(sourceAssets, versionedAssets, { recursive: true });
}

// ─── 5. Report success ──────────────────────────────────────────────────────
const newVersionsContent = fs.readFileSync(VERSIONS_PATH, 'utf-8');
process.stdout.write(`Cut documentation version ${version}\n\n`);
process.stdout.write(`website/versions.json:\n${newVersionsContent}\n`);

process.exit(0);
