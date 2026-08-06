#!/usr/bin/env node
// Story harness: worktree, branch, ports, isolated runtime, shared registry.
//
//   story.mjs claim <story-id> --feature <name> --base <branch> [--owner <id>]
//   story.mjs state <story-id> <planned|in-progress|validating|merging|blocked|done>
//   story.mjs list [--json]
//   story.mjs release <story-id> [--force]
//
// Everything application-specific lives in .claude/story.config.json.
// The registry and the spec artifacts live in the main checkout and are
// shared by every worktree, so two sessions cannot take the same story or
// the same ports.

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';

// `merging` is the state a story reaches when its implementation has passed
// validation and only the merge is left. It exists because CLAUDE.md frees a
// story's slot at that moment, while its qa and docs agents keep running, and
// until this state existed the registry had no way to say so: such a story sat
// at `in-progress` and capacity.sh counted it against the machine's slots. A
// story parked on a human gate is `blocked`, not `in-progress`, for the same
// reason. Both were over-counting the load and refusing dispatches the machine
// could have carried.
const STATES = ['planned', 'in-progress', 'validating', 'merging', 'blocked', 'done'];
const LOCK_STALE_MS = 60_000;

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

// Throws rather than exits: exiting inside withLock() would skip the release
// and leave the registry locked for every other session.
const die = (msg) => {
  throw new Error(msg);
};

// ─── locations ───────────────────────────────────────────────────────────
// The common dir is shared by every worktree, so it always resolves to the
// main checkout no matter where this runs from.
const commonDir = resolve(git(['rev-parse', '--git-common-dir']));
const MAIN = dirname(commonDir);
const CONFIG = JSON.parse(readFileSync(join(MAIN, '.claude/story.config.json'), 'utf8'));
const REGISTRY = join(MAIN, '.claude/registry.json');
const LOCK = join(MAIN, '.claude/registry.lock');

const fill = (str, vars) =>
  str.replace(/\{\{(\w+)\}\}/g, (m, key) => (key in vars ? String(vars[key]) : m));

// ─── registry, with a lock so parallel sessions cannot collide ───────────
const readRegistry = () =>
  existsSync(REGISTRY) ? JSON.parse(readFileSync(REGISTRY, 'utf8')) : { stories: {} };

const writeRegistry = (reg) =>
  writeFileSync(REGISTRY, `${JSON.stringify(reg, null, 2)}\n`);

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const acquireLock = () => {
  const deadline = Date.now() + 10_000;
  for (;;) {
    try {
      // mkdir is atomic across processes: whoever creates it holds the lock.
      mkdirSync(LOCK);
      return;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      // A session that died mid-write must not block the harness forever.
      if (Date.now() - statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
        rmSync(LOCK, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) die('registry is locked by another session; retry shortly');
      sleep(100);
    }
  }
};

const releaseLock = () => rmSync(LOCK, { recursive: true, force: true });

const withLock = (fn) => {
  acquireLock();
  try {
    return fn();
  } finally {
    releaseLock();
  }
};

// ─── commands ────────────────────────────────────────────────────────────
const claim = (storyId, opts) => {
  const feature = opts.feature ?? die('--feature is required');
  const base = opts.base ?? die('--base is required (the feature integration branch)');
  const owner = opts.owner ?? process.env.CLAUDE_SESSION_ID ?? `pid-${process.pid}`;

  return withLock(() => {
    const reg = readRegistry();
    const existing = reg.stories[storyId];
    if (existing && existing.state !== 'done' && existing.owner !== owner) {
      die(
        `story ${storyId} is owned by session ${existing.owner} (state: ${existing.state}). ` +
          `Pick another story or wait for it to be released.`,
      );
    }

    // Lowest free port slot, so released stories recycle their ports.
    const taken = new Set(
      Object.values(reg.stories)
        .filter((s) => s.state !== 'done' && s.id !== storyId)
        .map((s) => s.slot),
    );
    let slot = 0;
    while (taken.has(slot)) slot += 1;

    const ports = Array.from(
      { length: CONFIG.ports.perStory },
      (_, i) => CONFIG.ports.base + slot * CONFIG.ports.perStory + i,
    );

    const worktree = join(MAIN, CONFIG.worktreeRoot, storyId);
    const vars = { worktree, storyId, feature, home: homedir() };
    ports.forEach((p, i) => (vars[`port${i}`] = p));
    const branch = fill(CONFIG.branchPattern, vars);

    // Worktree and branch.
    if (!existsSync(worktree)) {
      const branchExists = (() => {
        try {
          // stderr silenced: a missing branch is the normal case, not an error.
          execFileSync('git', ['rev-parse', '--verify', `refs/heads/${branch}`], {
            cwd: MAIN,
            stdio: ['ignore', 'ignore', 'ignore'],
          });
          return true;
        } catch {
          return false;
        }
      })();
      git(
        branchExists
          ? ['worktree', 'add', worktree, branch]
          : ['worktree', 'add', '-b', branch, worktree, base],
        MAIN,
      );
    }

    // Spec artifacts live once, in the main checkout; the worktree points at
    // them. They are gitignored, so a fresh checkout would not carry them.
    const specsSource = join(MAIN, CONFIG.specsRoot);
    mkdirSync(specsSource, { recursive: true });
    const specsLink = join(worktree, CONFIG.specsRoot);
    if (!existsSync(specsLink)) {
      mkdirSync(dirname(specsLink), { recursive: true });
      symlinkSync(specsSource, specsLink, 'dir');
    }

    // Gitignored files the agents need but git will not check out.
    for (const file of CONFIG.carry ?? []) {
      const from = join(MAIN, file);
      if (existsSync(from)) cpSync(from, join(worktree, file), { recursive: true });
    }

    // Isolated runtime state, seeded from the developer's own.
    for (const { from, to } of CONFIG.seed ?? []) {
      const src = fill(from, vars);
      const dest = fill(to, vars);
      if (existsSync(src) && !existsSync(dest)) {
        mkdirSync(dirname(dest), { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    }

    // Point the seeded runtime at this story's ports.
    for (const { file, set } of CONFIG.patch ?? []) {
      const target = fill(file, vars);
      if (!existsSync(target)) continue;
      const json = JSON.parse(readFileSync(target, 'utf8'));
      for (const [key, value] of Object.entries(set)) {
        const filled = fill(String(value), vars);
        json[key] = /^\d+$/.test(filled) ? Number(filled) : filled;
      }
      writeFileSync(target, `${JSON.stringify(json, null, 2)}\n`);
    }

    // The env every agent in this story sources before running anything.
    const env = Object.entries(CONFIG.env ?? {})
      .map(([key, value]) => `${key}=${fill(String(value), vars)}`)
      .join('\n');
    writeFileSync(join(worktree, '.claude-story.env'), `${env}\n`);

    reg.stories[storyId] = {
      id: storyId,
      feature,
      state: 'in-progress',
      worktree,
      branch,
      base,
      slot,
      ports,
      owner,
      updatedAt: new Date().toISOString(),
    };
    writeRegistry(reg);

    return {
      ...reg.stories[storyId],
      specs: join(specsSource, feature),
      startCommand: CONFIG.startCommand,
    };
  });
};

const setState = (storyId, state) => {
  if (!STATES.includes(state)) die(`state must be one of: ${STATES.join(', ')}`);
  return withLock(() => {
    const reg = readRegistry();
    const story = reg.stories[storyId] ?? die(`unknown story: ${storyId}`);
    story.state = state;
    story.updatedAt = new Date().toISOString();
    writeRegistry(reg);
    return story;
  });
};

const release = (storyId, opts) =>
  withLock(() => {
    const reg = readRegistry();
    const story = reg.stories[storyId] ?? die(`unknown story: ${storyId}`);
    try {
      git(['worktree', 'remove', ...(opts.force ? ['--force'] : []), story.worktree], MAIN);
    } catch (err) {
      die(
        `worktree still holds work: ${err.message.trim()}\n` +
          `Merge it first, or re-run with --force to discard it.`,
      );
    }
    delete reg.stories[storyId];
    writeRegistry(reg);
    return { released: storyId };
  });

const list = (opts) => {
  const reg = readRegistry();
  const stories = Object.values(reg.stories);
  if (opts.json) return stories;
  if (!stories.length) return 'no active stories';
  return stories
    .map(
      (s) =>
        `${s.id.padEnd(24)} ${s.state.padEnd(12)} ${String(s.ports.join(',')).padEnd(12)} ` +
        `${s.branch.padEnd(40)} ${s.owner}`,
    )
    .join('\n');
};

// ─── entry point ─────────────────────────────────────────────────────────
const [command, ...rest] = process.argv.slice(2);
const positional = rest.filter((a) => !a.startsWith('--'));
const opts = {};
for (let i = 0; i < rest.length; i += 1) {
  if (!rest[i].startsWith('--')) continue;
  const key = rest[i].slice(2);
  const next = rest[i + 1];
  opts[key] = next && !next.startsWith('--') ? next : true;
}

const commands = {
  claim: () => claim(positional[0] ?? die('story id is required'), opts),
  state: () => setState(positional[0] ?? die('story id is required'), positional[1]),
  release: () => release(positional[0] ?? die('story id is required'), opts),
  list: () => list(opts),
};

try {
  const run = commands[command] ?? die('usage: story.mjs <claim|state|list|release> [...]');
  const result = run();
  process.stdout.write(
    typeof result === 'string' ? `${result}\n` : `${JSON.stringify(result, null, 2)}\n`,
  );
} catch (err) {
  process.stderr.write(`${err.message}\n`);
  process.exit(1);
}
