#!/usr/bin/env node
// Mechanical selector for RA-16: reads a git diff, applies scripts/screenshots/impact.json,
// and prints the manifest shot names the diff plausibly invalidated. Deterministic, no
// Claude, no browser, no service. Never invokes scripts/capture-screenshots.mjs itself:
// this script only prints names, so it keeps working even if capture is broken (AC4).
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const impactPath = path.join(repoRoot, 'scripts', 'screenshots', 'impact.json');
const manifestPath = path.join(repoRoot, 'scripts', 'screenshots', 'manifest.json');

const DEFAULT_RANGE = 'HEAD~1..HEAD';

function parseArgs(argv) {
  const args = { range: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--range') {
      args.range = argv[++i] ?? '';
    } else if (arg.startsWith('--range=')) {
      args.range = arg.slice('--range='.length);
    }
  }
  return args;
}

// Hand-rolled glob-to-regex translator. Supports the three patterns impact.json needs:
// an exact path, a `Prefix*` glob within one path segment, and a `dir/**` recursive glob.
// No minimatch/picomatch dependency for three shapes.
function globToRegExp(glob) {
  let pattern = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        pattern += '.*';
        i++; // consume the second '*'
      } else {
        pattern += '[^/]*';
      }
    } else if ('.+^${}()|[]\\'.includes(c)) {
      pattern += '\\' + c;
    } else {
      pattern += c;
    }
  }
  return new RegExp(`^${pattern}$`);
}

function matchesAny(filePath, globs) {
  return globs.some((glob) => globToRegExp(glob).test(filePath));
}

function getChangedPaths(range) {
  try {
    const output = execFileSync('git', ['diff', '--name-only', range], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return output.split('\n').map((line) => line.trim()).filter(Boolean);
  } catch (err) {
    const detail = (err.stderr || err.message || '').toString().trim();
    process.stderr.write(`screenshots-affected: invalid git range "${range}"${detail ? `: ${detail}` : ''}\n`);
    process.exit(1);
  }
}

async function loadJson(filePath) {
  const raw = await readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const range = args.range || DEFAULT_RANGE;

  const changedPaths = getChangedPaths(range);

  const [impact, manifest] = await Promise.all([loadJson(impactPath), loadJson(manifestPath)]);
  const manifestNames = new Set(manifest.map((entry) => entry.name));
  const allShotNames = manifest.map((entry) => entry.name);

  // Fail loudly on every invocation if impact.json drifts from the manifest, rather than
  // only when a drifted rule happens to be triggered by the current diff.
  for (const rule of impact.rules ?? []) {
    if (rule.shots === '*') continue;
    for (const shot of rule.shots ?? []) {
      if (!manifestNames.has(shot)) {
        process.stderr.write(
          `screenshots-affected: impact.json rule "${rule.match}" names unknown shot "${shot}"\n`,
        );
        process.exit(1);
      }
    }
  }

  const ignore = impact.ignore ?? [];
  const rules = impact.rules ?? [];
  const selected = new Set();

  for (const changedPath of changedPaths) {
    if (matchesAny(changedPath, ignore)) continue;

    let matched = false;
    for (const rule of rules) {
      if (!globToRegExp(rule.match).test(changedPath)) continue;
      matched = true;
      if (rule.shots === '*') {
        for (const name of allShotNames) selected.add(name);
      } else {
        for (const name of rule.shots) selected.add(name);
      }
    }

    // Erring toward more (EC1): an unmatched, non-ignored path invalidates every shot
    // rather than none, since we cannot prove it is safe to skip.
    if (!matched) {
      for (const name of allShotNames) selected.add(name);
    }
  }

  const sorted = [...selected].sort();
  if (sorted.length > 0) {
    process.stdout.write(sorted.join('\n') + '\n');
  }
  process.exit(0);
}

main();
