#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — CI release output mapping
// Called by release.config.mjs's @semantic-release/exec publishCmd and
// addChannelCmd hooks. Single source of the branch → channel → docker-tag
// mapping the release-pipeline.yml workflow's downstream jobs (docker, docs,
// next-pointer) key off of. That hook — and nothing else — is what
// distinguishes a build from a re-tag; there is no commit heuristic, no diff
// inspection, no "did the tag already exist" probe.
//
// Invocation:
//   node scripts/ci-release-output.mjs <action> <version> <gitTag> <branch>
//     action  publish | addChannel   (exact strings, case-sensitive)
//     version bare semver, e.g. 1.5.3
//     gitTag  v<version>, e.g. v1.5.3
//     branch  main | develop
//
// On any violation: one line to stderr, exit 1 — fails the release run
// loudly rather than publishing an image under a wrong tag.
// On success: appends the output block to the file named by $GITHUB_OUTPUT
// (skipped, stdout-only, when unset — local dry run) and echoes the same
// lines to stdout. Exit 0.
//
// Contract frozen by the RC-2 blueprint (C1/C2) — do not change without
// updating release-pipeline.yml and the story.
// ────────────────────────────────────────────────────────────────────────────

import * as fs from 'node:fs';

const die = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

const VERSION_RE = /^\d+\.\d+\.\d+$/;

// branch → { channel, docker_channel_tag }, frozen mapping (blueprint C1)
const BRANCH_MAP = {
  main: { channel: 'current', docker_channel_tag: 'latest' },
  develop: { channel: 'next', docker_channel_tag: 'next' },
};

function main() {
  const [action, version, gitTag, branch] = process.argv.slice(2);

  if (action !== 'publish' && action !== 'addChannel') {
    die(`Invalid action "${action}". Expected "publish" or "addChannel".`);
  }
  if (!version || !VERSION_RE.test(version)) {
    die(`Invalid version "${version}". Expected bare semver in the form X.Y.Z.`);
  }
  if (gitTag !== `v${version}`) {
    die(`Invalid gitTag "${gitTag}". Expected "v${version}".`);
  }
  if (!Object.hasOwn(BRANCH_MAP, branch)) {
    die(`Invalid branch "${branch}". Expected "main" or "develop".`);
  }

  const { channel, docker_channel_tag } = BRANCH_MAP[branch];

  const lines = [
    'released=true',
    `action=${action}`,
    `version=${version}`,
    `git_tag=${gitTag}`,
    `channel=${channel}`,
    `docker_channel_tag=${docker_channel_tag}`,
  ];
  const block = `${lines.join('\n')}\n`;

  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, block);
  }
  process.stdout.write(block);
  process.exit(0);
}

main();
