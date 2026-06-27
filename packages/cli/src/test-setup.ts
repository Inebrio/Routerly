import { mkdtempSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

// Data-safety: store.ts resolves its base from process.env.ROUTERLY_HOME at
// IMPORT time. Vitest loads this setupFile before any test module imports
// store.ts, so forcing an isolated home here guarantees tests never read or
// write the real ~/.routerly (cli/config.json, config/cli.json, ...).
//
// Always overwrite, even if ROUTERLY_HOME is already set: the dev shell may
// export ROUTERLY_HOME=~/.routerly (see CLAUDE.local.md). Honoring a
// pre-existing value would point tests straight back at real data.
const isolated = mkdtempSync(join(tmpdir(), 'routerly-cli-test-'));

// Belt-and-suspenders: if the isolated path ever resolves to (or under) the
// real home, fail loudly rather than silently mutating real data.
const realHome = join(homedir(), '.routerly');
if (isolated === realHome || isolated.startsWith(realHome + '/')) {
  throw new Error(`test-setup: isolated home "${isolated}" overlaps real ~/.routerly — aborting to protect real data`);
}

process.env.ROUTERLY_HOME = isolated;
