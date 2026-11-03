#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — module version sync
// Rewrites every module manifest `version:` literal and every `^X.Y.Z`
// dependency range under packages/service/src to the canonical product
// version (packages/service/package.json), unconditionally, on every bump.
// Chained into root package.json's `scripts.version` so it runs whenever
// `npm run version` runs.
//
//   node scripts/sync-module-versions.mjs           rewrite in place
//   node scripts/sync-module-versions.mjs --check    report drift, no writes
//
// The rewrite is absolute, not differential: every matching literal is
// replaced with the current canonical version regardless of its old value.
// It is therefore idempotent — a clean, synced tree produces zero changes.
//
// Scope is frozen: packages/service/src/**/*.ts, excluding **/*.test.ts.
// Recognised literal shapes are frozen to exactly two:
//   (a) `version:` + optional whitespace + a quoted X.Y.Z
//   (b) a quoted `^X.Y.Z` dependency range
// Widening either is a defect, not an improvement.
//
// Two-phase and atomic: every scoped file is read and transformed in memory
// first. Only if every file succeeds are any writes performed. A read or
// transform failure on any file aborts before touching disk.
// ────────────────────────────────────────────────────────────────────────────

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as path from 'node:path';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..');
const SERVICE_PKG_PATH = path.join(REPO_ROOT, 'packages/service/package.json');
const SCAN_ROOT = path.join(REPO_ROOT, 'packages/service/src');

const CHECK_MODE = process.argv.includes('--check');

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const relPath = (absPath) => path.relative(REPO_ROOT, absPath);

// ─── 1. Canonical version ───────────────────────────────────────────────────
let canonicalVersion;
try {
  const pkg = JSON.parse(readFileSync(SERVICE_PKG_PATH, 'utf-8'));
  canonicalVersion = pkg.version;
} catch (err) {
  die(`Could not read canonical version from ${relPath(SERVICE_PKG_PATH)}: ${err.message}`);
}

if (typeof canonicalVersion !== 'string' || !/^\d+\.\d+\.\d+$/.test(canonicalVersion)) {
  die(`Malformed canonical version "${canonicalVersion}" in ${relPath(SERVICE_PKG_PATH)}.`);
}

// ─── 2. Walk packages/service/src for scoped *.ts files ─────────────────────
function walk(dir) {
  let files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files = files.concat(walk(full));
    } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

let scopedFiles;
try {
  statSync(SCAN_ROOT);
  scopedFiles = walk(SCAN_ROOT).sort();
} catch (err) {
  die(`Could not walk ${relPath(SCAN_ROOT)}: ${err.message}`);
}

// ─── 3. Recognised literal shapes (frozen) ───────────────────────────────────
const MANIFEST_VERSION_RE = /(version:\s*)(['"])(\d+\.\d+\.\d+)\2/g;
const DEP_RANGE_RE = /(['"])\^(\d+\.\d+\.\d+)\1/g;

function lineAt(content, offset) {
  return content.slice(0, offset).split('\n').length;
}

// ─── 4. Phase one: read every scoped file and transform in memory ───────────
const results = [];

for (const filePath of scopedFiles) {
  let content;
  try {
    content = readFileSync(filePath, 'utf-8');
  } catch (err) {
    die(`Failed to read ${relPath(filePath)}: ${err.message}`);
  }

  const violations = [];

  let newContent;
  try {
    newContent = content.replace(MANIFEST_VERSION_RE, (match, prefix, quote, version, offset) => {
      if (version !== canonicalVersion) {
        violations.push({ line: lineAt(content, offset), found: version });
      }
      return `${prefix}${quote}${canonicalVersion}${quote}`;
    });
    newContent = newContent.replace(DEP_RANGE_RE, (match, quote, version, offset) => {
      if (version !== canonicalVersion) {
        violations.push({ line: lineAt(newContent, offset), found: `^${version}` });
      }
      return `${quote}^${canonicalVersion}${quote}`;
    });
  } catch (err) {
    die(`Failed to transform ${relPath(filePath)}: ${err.message}`);
  }

  results.push({
    path: filePath,
    original: content,
    next: newContent,
    changed: newContent !== content,
    violations,
  });
}

const changedFiles = results.filter((r) => r.changed);
const occurrencesRewritten = results.reduce((n, r) => n + r.violations.length, 0);

// ─── 5. --check mode: report drift, write nothing ────────────────────────────
if (CHECK_MODE) {
  if (occurrencesRewritten === 0) {
    process.stdout.write(
      `All module version literals in packages/service/src already match ${canonicalVersion}.\n`
    );
    process.exit(0);
  }

  for (const result of results) {
    for (const violation of result.violations) {
      process.stderr.write(
        `${relPath(result.path)}:${violation.line}: expected ${canonicalVersion}, found ${violation.found}\n`
      );
    }
  }
  process.exit(1);
}

// ─── 6. Phase two: every file read and transformed without error — write ────
for (const result of changedFiles) {
  try {
    writeFileSync(result.path, result.next);
  } catch (err) {
    die(`Failed to write ${relPath(result.path)}: ${err.message}`);
  }
}

process.stdout.write(
  `Synced module versions to ${canonicalVersion}: ${occurrencesRewritten} occurrence(s) rewritten across ${changedFiles.length} file(s).\n`
);
process.exit(0);
