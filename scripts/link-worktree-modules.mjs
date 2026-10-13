#!/usr/bin/env node
// In a git worktree, node_modules is a symlink to the main checkout's install, so
// `@routerly/*` resolves to the main checkout's packages (possibly another branch).
// Replace that symlink with a real directory: every entry links to the shared install,
// except `@routerly`, which links to this worktree's own packages. Idempotent; no-op elsewhere.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = path.join(root, 'node_modules');

if (fs.lstatSync(nm, { throwIfNoEntry: false })?.isSymbolicLink()) {
  const target = fs.realpathSync(nm);
  fs.unlinkSync(nm);
  fs.mkdirSync(nm);
  for (const entry of fs.readdirSync(target)) {
    if (entry !== '@routerly') fs.symlinkSync(path.join(target, entry), path.join(nm, entry));
  }
  fs.mkdirSync(path.join(nm, '@routerly'));
  for (const pkg of fs.readdirSync(path.join(root, 'packages'))) {
    fs.symlinkSync(path.join('..', '..', 'packages', pkg), path.join(nm, '@routerly', pkg));
  }
  console.log(`node_modules: @routerly/* now resolves to ${root}/packages`);
}
