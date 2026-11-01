import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve(__dirname, '../../../scripts/setup-coding-agents-router.sh');

function run(deepseek: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'car-'));
  const stub = join(dir, 'stub.sh');
  const log = join(dir, 'calls.log');
  writeFileSync(stub, `#!/usr/bin/env bash\necho "$*" >> "${log}"\n[ "$1 $2" = "router token" ] && echo sk-rt-test\nexit 0\n`);
  chmodSync(stub, 0o755);
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH, ROUTERLY: stub, OPENAI_API_KEY: 'a', ANTHROPIC_API_KEY: 'b', OUT_DIR: join(dir, 'out'),
  };
  if (deepseek) env.DEEPSEEK_API_KEY = 'c';
  const r = spawnSync('bash', [script], { env, encoding: 'utf8' });
  return { r, dir, calls: readFileSync(log, 'utf8') };
}

describe('setup-coding-agents-router.sh', () => {
  it('completes without DEEPSEEK_API_KEY', () => {
    const { r, dir, calls } = run(false);
    expect(r.status).toBe(0);
    expect(calls.match(/policy enable/g)).toHaveLength(7);
    expect(existsSync(join(dir, 'out/codex.token'))).toBe(true);
    expect(existsSync(join(dir, 'out/opencode.token'))).toBe(true);
    expect(calls).not.toContain('deepseek/deepseek-chat');
  });

  it('adds the cheap model when DEEPSEEK_API_KEY is set', () => {
    const { r, calls } = run(true);
    expect(r.status).toBe(0);
    expect(calls.match(/policy enable/g)).toHaveLength(7);
    expect(calls).toContain('"deepseek/deepseek-chat"');
  });
});
