// Pure helpers of install.mjs (kept apart so tests can import them without running the installer).
import fs from 'node:fs';
import path from 'node:path';

/** File in APP_DIR listing every file the installer copied there; proves the folder is a Routerly install. */
export const MANIFEST = '.routerly-manifest';
/** Directories never copied from the source tree. */
export const SKIP_DIRS = ['node_modules', '.git', '.github', '.vscode', 'spec'];

/** Value of --name=value or --name value; null when absent. */
export function argValue(args, name) {
  const flag = `--${name}`;
  const i = args.findIndex(a => a === flag || a.startsWith(`${flag}=`));
  if (i < 0) return null;
  if (args[i] !== flag) return args[i].slice(flag.length + 1);
  const next = args[i + 1];
  return next !== undefined && !next.startsWith('--') ? next : null;
}

/** Relative paths (posix separators) of the files copyDir copies from src. */
export function listSourceFiles(src, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(src, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.includes(e.name)) out.push(...listSourceFiles(src, r));
    } else out.push(r);
  }
  return out;
}

/** Paths recorded by a previous install, or null when dir has no manifest. */
export function readManifest(dir) {
  try { return fs.readFileSync(path.join(dir, MANIFEST), 'utf-8').split('\n').filter(Boolean); }
  catch { return null; }
}

/** True when dir holds a Routerly install (manifest, or the root package.json of Routerly for pre-manifest installs). */
export function isRouterlyInstall(dir) {
  if (fs.existsSync(path.join(dir, MANIFEST))) return true;
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8')).name === 'routerly'; }
  catch { return false; }
}

/** Files to delete on update: in the old install (manifest) but not in the new source. Without a manifest nothing is deleted. */
export function staleFiles(dir, newFiles) {
  const old = readManifest(dir);
  if (!old) return [];
  const keep = new Set(newFiles);
  return old.filter(f => !keep.has(f) && f !== MANIFEST);
}

/** Files and directories to delete on uninstall. Unknown entries are never listed. */
export function uninstallPaths(dir, fallbackFiles) {
  const files = readManifest(dir) ?? fallbackFiles;
  const tops = new Set(['node_modules', MANIFEST]);
  for (const f of files) tops.add(f);
  const out = [...tops];
  const pk = path.join(dir, 'packages');
  if (fs.existsSync(pk)) {
    // tsbuildinfo too: left behind, tsc would skip re-emitting dist on a reinstall.
    for (const p of fs.readdirSync(pk)) for (const g of ['node_modules', 'dist', 'tsconfig.tsbuildinfo']) out.push(`packages/${p}/${g}`);
  }
  return out;
}

/** Marker file that makes a folder a valid sandbox for installer tests. */
export const SANDBOX_MARKER = '.routerly-sandbox';
/** Real locations an installer test must never use, nor contain. */
const PROTECTED = ['/', '/opt/routerly', '/var/lib/routerly', '/usr/local', '/usr', '/etc', '/root', '/home', 'C:\\Routerly', 'C:\\ProgramData\\Routerly'];

/** Error text when the sandbox is unusable, null when dir is safe: absolute, empty or marked, and neither a real location nor one of its parents. */
export function sandboxProblem(dir, realHome) {
  if (!dir || !path.isAbsolute(dir)) return `--sandbox needs an absolute path (got "${dir ?? ''}")`;
  const d = path.resolve(dir);
  for (const p of [...PROTECTED, realHome]) {
    const r = path.relative(d, path.resolve(p));
    if (r === '' || (!r.startsWith('..') && !path.isAbsolute(r))) return `${d} is, or contains, a real location (${p}): refusing to use it as a sandbox`;
  }
  if (fs.existsSync(d) && fs.readdirSync(d).length > 0 && !fs.existsSync(path.join(d, SANDBOX_MARKER))) return `${d} is not empty and is not a sandbox created by the installer`;
  return null;
}

/** Error text when dir must not receive an install: it holds files that are not a Routerly install, or a git work tree. */
export function targetProblem(dir) {
  if (!fs.existsSync(dir) || isRouterlyInstall(dir)) return null;
  if (fs.existsSync(path.join(dir, '.git'))) return `${dir} is a git work tree, not an install folder`;
  if (fs.readdirSync(dir).length > 0) return `${dir} is not empty and is not a Routerly install`;
  return null;
}
