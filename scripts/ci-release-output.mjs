#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — CI release decision
// The maintainer types the version when dispatching release.yml; this script
// turns (version, branch) into the outputs the workflow's jobs key off of:
// the channel, the docker tag, and whether this is a first publish or a
// promotion of an already-published tag to another channel. Nothing is
// computed from commit history.
//
// Invocation (run from a checkout with tags fetched, HEAD = dispatched ref):
//   node scripts/ci-release-output.mjs <version> <branch>
//     version bare semver chosen by the maintainer, e.g. 0.6.1
//     branch  main | next | develop
//
// Decision:
//   tag v<version> absent  → publish; the version must be greater than the
//                            highest v* tag reachable from HEAD (typo guard)
//   tag v<version> present → addChannel (promotion); the tag must be an
//                            ancestor of HEAD
//
// On any violation: one line to stderr, exit 1. On success: appends the
// output block to $GITHUB_OUTPUT (stdout only when unset) and exits 0.
// ────────────────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const VERSION_RE = /^\d+\.\d+\.\d+$/;

const BRANCH_MAP = {
  main: { channel: 'current', docker_channel_tag: 'latest' },
  next: { channel: 'next', docker_channel_tag: 'next' },
  develop: { channel: 'develop', docker_channel_tag: 'develop' },
};

const git = (...args) => spawnSync('git', args, { encoding: 'utf-8' });

const parts = (v) => v.split('.').map(Number);
function greater(a, b) {
  const [x, y] = [parts(a), parts(b)];
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function main() {
  const [version, branch] = process.argv.slice(2);

  if (!version || !VERSION_RE.test(version)) {
    die(`Invalid version "${version}". Expected bare semver in the form X.Y.Z.`);
  }
  if (!Object.hasOwn(BRANCH_MAP, branch)) {
    die(`Invalid branch "${branch}". Expected "main", "next" or "develop".`);
  }

  const gitTag = `v${version}`;
  let action;
  if (git('rev-parse', '--verify', '--quiet', `refs/tags/${gitTag}`).status === 0) {
    action = 'addChannel';
    if (git('merge-base', '--is-ancestor', gitTag, 'HEAD').status !== 0) {
      die(`Tag ${gitTag} exists but is not an ancestor of ${branch}. Merge the branch that published it into ${branch} first.`);
    }
  } else {
    action = 'publish';
    const reachable = git('tag', '--merged', 'HEAD', '--list', 'v*').stdout
      .split('\n')
      .map((t) => t.trim().replace(/^v/, ''))
      .filter((t) => VERSION_RE.test(t));
    const highest = reachable.reduce((a, b) => (a && greater(a, b) ? a : b), '');
    if (highest && !greater(version, highest)) {
      die(`Version ${version} must be greater than the latest release reachable from ${branch} (v${highest}).`);
    }
  }

  const { channel, docker_channel_tag } = BRANCH_MAP[branch];
  const block = [
    'released=true',
    `action=${action}`,
    `version=${version}`,
    `git_tag=${gitTag}`,
    `channel=${channel}`,
    `docker_channel_tag=${docker_channel_tag}`,
  ].join('\n') + '\n';

  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, block);
  process.stdout.write(block);
}

main();
