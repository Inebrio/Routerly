#!/usr/bin/env node
// Checks the "first result" path of the README Quick Start (ROUT-733).
//   --check-help   every `routerly <cmd>` line of the Quick Start must exist (`<cmd> --help` exits 0)
//   --time <file>  runs the same `routerly` lines in order and writes per-step timings to <file> (JSON)
// Uses only the Node.js standard library. Commands run with the environment of the caller.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const readme = readFileSync(join(root, 'README.md'), 'utf8');
const start = readme.indexOf('## Quick Start');
const end = readme.indexOf('\n## ', start + 1);
const section = readme.slice(start, end === -1 ? undefined : end);

// Every ```bash block of the Quick Start, keeping only `routerly` invocations (no flags after `--help`).
const base = process.env.FR_URL; // optional: target instance, replaces the README URL
const commands = [];
for (const block of section.matchAll(/```bash\n([\s\S]*?)```/g)) {
  for (const raw of block[1].split('\n')) {
    let line = raw.replace(/#.*$/, '').trim().replaceAll('http://localhost:3000', base ?? 'http://localhost:3000');
    // --time only: the README placeholders are filled from the environment (values never written to output).
    line = line.replaceAll('sk-YOUR_KEY', '"$FR_OPENAI_KEY"');
    if (/^routerly auth login /.test(line)) line += ' --password "$FR_PASSWORD"';
    if (/^routerly\s/.test(line)) commands.push(line);
  }
}

const mode = process.argv[2];
if (mode === '--check-help') {
  let failed = 0;
  for (const cmd of commands) {
    const words = cmd.split(/\s+/);
    // Subcommand path: leading lowercase words only (stops at flags, quoted values, arguments).
    const sub = [];
    for (const w of words.slice(1)) {
      if (!/^[a-z][a-z-]*$/.test(w)) break;
      sub.push(w);
    }
    const res = spawnSync('routerly', [...sub, '--help'], { encoding: 'utf8' });
    const ok = res.status === 0;
    if (!ok) failed++;
    process.stdout.write(`${ok ? 'OK  ' : 'FAIL'} routerly ${sub.join(' ')} --help\n`);
  }
  process.exit(failed ? 1 : 0);
}

if (mode === '--time') {
  const out = process.argv[3];
  if (!out) { process.stderr.write('usage: first-result.mjs --time <out.json>\n'); process.exit(2); }
  const steps = [];
  const t0 = Date.now();
  for (const cmd of commands) {
    const s = Date.now();
    const res = spawnSync('bash', ['-c', cmd], { encoding: 'utf8', stdio: 'pipe' });
    const ms = Date.now() - s;
    steps.push({ command: cmd, exit: res.status, ms });
    process.stdout.write(`${res.status === 0 ? 'OK  ' : 'FAIL'} ${ms} ms  ${cmd}\n`);
    if (res.status !== 0) break;
  }
  const total = Date.now() - t0;
  writeFileSync(out, JSON.stringify({ total_ms: total, steps }, null, 2) + '\n');
  process.exit(steps.every(s => s.exit === 0) ? 0 : 1);
}

process.stderr.write('usage: first-result.mjs --check-help | --time <out.json>\n');
process.exit(2);
