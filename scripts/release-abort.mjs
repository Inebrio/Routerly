#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — release abort
// Deletes the prerelease container tags (v<X.Y.Z>-rc.<N>) an abandoned
// release branch published to inebrio/routerly on Docker Hub. Refuses if the
// version has already been promoted (git tag v<X.Y.Z> exists) and never
// touches latest, develop or stable.
//
// Invocation:
//   node scripts/release-abort.mjs --version <X.Y.Z|vX.Y.Z> [--dry-run] [--tags-file <path>]
//
// Exit codes: 0 success, including nothing to remove; 1 operational failure
// (bad args, network/auth error); 2 refusal, version already promoted.
//
// The contract (flags, exit codes, tag shape, registry) is frozen by the
// RA-13 blueprint — do not change it without updating
// .github/workflows/release-abort.yml and the story.
// ────────────────────────────────────────────────────────────────────────────

import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';

const REGISTRY_NAMESPACE = 'inebrio';
const REGISTRY_REPO = 'routerly';
const REGISTRY_BASE = `https://hub.docker.com/v2/repositories/${REGISTRY_NAMESPACE}/${REGISTRY_REPO}`;
const PROTECTED_TAGS = ['latest', 'develop', 'stable'];
const USAGE = 'Usage: node scripts/release-abort.mjs --version <X.Y.Z|vX.Y.Z> [--dry-run] [--tags-file <path>]';

const die = (message, code = 1) => {
  process.stderr.write(`${message}\n`);
  process.exit(code);
};

// ─── 1. Parse arguments ────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { version: null, dryRun: false, tagsFile: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--version') {
      args.version = argv[++i];
    } else if (arg === '--dry-run') {
      args.dryRun = true;
    } else if (arg === '--tags-file') {
      args.tagsFile = argv[++i];
    } else {
      die(`Unknown argument "${arg}". ${USAGE}`);
    }
  }
  return args;
}

const VERSION_RE = /^v?(\d+\.\d+\.\d+)$/;

function normaliseVersion(raw) {
  if (!raw) return null;
  const match = VERSION_RE.exec(raw);
  if (!match) return null;
  return match[1];
}

// ─── 2. Selection (pure) ────────────────────────────────────────────────────
// Every registry tag matching ^v<escaped X.Y.Z>-rc\.[0-9]+$, anchored.
export function selectPrereleaseTags(tags, version) {
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^v${escaped}-rc\\.[0-9]+$`);
  return tags.filter((tag) => re.test(tag));
}

// ─── 3. Promoted-version refusal, before any network call ─────────────────
// Reads local git tags rather than origin directly; correct only because the
// workflow's checkout step (.github/workflows/release-abort.yml) uses
// fetch-depth: 0 and fetch-tags: true.
function isPromoted(version) {
  let out;
  try {
    out = execFileSync('git', ['tag', '-l', `v${version}`], { encoding: 'utf-8' }).trim();
  } catch (err) {
    die(`Could not check git tags for promoted version v${version}: ${err.message}`);
  }
  return out === `v${version}`;
}

// ─── 4. Registry client ─────────────────────────────────────────────────────
async function authenticate(username, password) {
  let response;
  try {
    response = await fetch('https://hub.docker.com/v2/users/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  } catch (err) {
    die(`Network error calling POST /v2/users/login (authentication): ${err.message}`);
  }
  if (!response.ok) {
    die(`Authentication failed: POST /v2/users/login returned ${response.status}`);
  }
  const body = await response.json();
  if (!body.token) {
    die('Authentication failed: POST /v2/users/login did not return a token');
  }
  return body.token;
}

async function listAllTags(token) {
  const tags = [];
  let url = `${REGISTRY_BASE}/tags?page_size=100`;
  while (url) {
    let response;
    try {
      response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    } catch (err) {
      die(`Network error calling GET ${url} (list tags): ${err.message}`);
    }
    if (!response.ok) {
      die(`Listing tags failed: GET ${url} returned ${response.status}`);
    }
    const body = await response.json();
    for (const result of body.results ?? []) {
      tags.push({ name: result.name, digest: result.digest ?? null });
    }
    url = body.next ?? null;
  }
  return tags;
}

// Builds the exact DELETE request without sending it. Callers that actually
// want to delete pass send=true; the RA-13 story never exercises that path
// against the live registry (see the blueprint's hard constraints).
function buildDeleteRequest(token, tag) {
  return {
    method: 'DELETE',
    url: `${REGISTRY_BASE}/tags/${tag}/`,
    headers: { Authorization: `Bearer ${token}` },
  };
}

async function deleteTag(token, tag) {
  const request = buildDeleteRequest(token, tag);
  let response;
  try {
    response = await fetch(request.url, { method: request.method, headers: request.headers });
  } catch (err) {
    die(`Network error calling DELETE ${request.url} (delete tag ${tag}): ${err.message}`);
  }
  if (!response.ok) {
    die(`Deleting tag ${tag} failed: DELETE ${request.url} returned ${response.status}`);
  }
}

// ─── 5. Report ──────────────────────────────────────────────────────────────
function digestOf(tags, name) {
  const found = tags.find((tag) => tag.name === name);
  return found ? found.digest : '(not present)';
}

function printProtectedReport(label, tags) {
  process.stdout.write(`${label}:\n`);
  for (const name of PROTECTED_TAGS) {
    process.stdout.write(`  ${name}: ${digestOf(tags, name)}\n`);
  }
}

// ─── 6. Main ────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));

  const version = normaliseVersion(args.version);
  if (!version) {
    die(`Missing or malformed --version. ${USAGE}`);
  }

  if (isPromoted(version)) {
    die(`Refusing: v${version} is already promoted (git tag v${version} exists). Nothing deleted.`, 2);
  }

  let allTags;
  let token = null;

  if (args.tagsFile) {
    let raw;
    try {
      raw = fs.readFileSync(args.tagsFile, 'utf-8');
    } catch (err) {
      die(`Could not read --tags-file ${args.tagsFile}: ${err.message}`);
    }
    let names;
    try {
      names = JSON.parse(raw);
    } catch (err) {
      die(`Could not parse --tags-file ${args.tagsFile} as JSON: ${err.message}`);
    }
    allTags = names.map((name) => ({ name, digest: `fixture:${name}` }));
  } else {
    const username = process.env.DOCKERHUB_USERNAME;
    const password = process.env.DOCKERHUB_TOKEN;
    if (!username || !password) {
      die('Missing DOCKERHUB_USERNAME or DOCKERHUB_TOKEN environment variable.');
    }
    token = await authenticate(username, password);
    allTags = await listAllTags(token);
  }

  const tagNames = allTags.map((tag) => tag.name);
  const toDelete = selectPrereleaseTags(tagNames, version);

  printProtectedReport('Protected tags before', allTags);

  if (toDelete.length === 0) {
    process.stdout.write(`no prerelease tags found for v${version}\n`);
    if (args.dryRun) {
      process.stdout.write('dry run: nothing deleted (nothing to remove).\n');
    }
    printProtectedReport('Protected tags after', allTags);
    process.exit(0);
  }

  process.stdout.write(`prerelease tags for v${version}: ${toDelete.join(', ')}\n`);

  if (args.dryRun) {
    process.stdout.write('dry run: nothing deleted.\n');
    for (const tag of toDelete) {
      const request = buildDeleteRequest(token ?? '<token>', tag);
      process.stdout.write(`  would issue: ${request.method} ${request.url} (Authorization: Bearer <redacted>)\n`);
    }
    printProtectedReport('Protected tags after', allTags);
    process.exit(0);
  }

  if (!token) {
    die('Cannot delete tags read from --tags-file: no registry session available. Use --dry-run to preview.');
  }

  for (const tag of toDelete) {
    await deleteTag(token, tag);
  }

  const afterTags = await listAllTags(token);
  printProtectedReport('Protected tags after', afterTags);
  process.stdout.write(`deleted: ${toDelete.join(', ')}\n`);
  process.exit(0);
}

main();
