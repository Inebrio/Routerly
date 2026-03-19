#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — Node.js installer (zero external dependencies)
// Called by install.sh / install.ps1 after extracting the source tarball.
// Requires Node.js >= 20.
// ────────────────────────────────────────────────────────────────────────────

import { createRequire }  from 'node:module';
import { createInterface } from 'node:readline';
import { ReadStream as TTYReadStream } from 'node:tty';
import { randomBytes }    from 'node:crypto';
import { promisify }      from 'node:util';
import { exec as execCb } from 'node:child_process';
import * as fs            from 'node:fs';
import * as fsp           from 'node:fs/promises';
import * as path          from 'node:path';
import * as os            from 'node:os';
import * as http          from 'node:http';

const exec = promisify(execCb);

// ─── Colors ───────────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = {
  bold:    s => isTTY ? `\x1b[1m${s}\x1b[0m`  : s,
  dim:     s => isTTY ? `\x1b[2m${s}\x1b[0m`  : s,
  green:   s => isTTY ? `\x1b[32m${s}\x1b[0m` : s,
  yellow:  s => isTTY ? `\x1b[33m${s}\x1b[0m` : s,
  red:     s => isTTY ? `\x1b[31m${s}\x1b[0m` : s,
  cyan:    s => isTTY ? `\x1b[36m${s}\x1b[0m` : s,
  magenta: s => isTTY ? `\x1b[35m${s}\x1b[0m` : s,
};

const info    = (...a) => console.log(c.cyan(c.bold('→')) + ' ' + a.join(' '));
const success = (...a) => console.log(c.green(c.bold('✓')) + ' ' + a.join(' '));
const warn    = (...a) => console.log(c.yellow(c.bold('!')) + ' ' + a.join(' '));
const step    = (n, t, ...a) => console.log(`\n${c.bold(c.cyan(`[${n}]`))} ${c.bold(t)}`, ...a);
const die     = (...a) => { console.error(c.red(c.bold('✗')) + ' ' + a.join(' ')); process.exit(1); };

// ─── Parse CLI args ────────────────────────────────────────────────────────────
const args   = process.argv.slice(2);
const getArg = (name) => {
  const prefix = `--${name}=`;
  const entry  = args.find(a => a.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : null;
};
const hasFlag = (name) => args.includes(`--${name}`);

const SOURCE_DIR     = getArg('source-dir') ?? path.resolve(path.dirname(process.argv[1]), '..');
const YES            = hasFlag('yes') || process.env.ROUTERLY_YES === '1';
const FLAG_NO_SVC    = hasFlag('no-service');
const FLAG_NO_CLI    = hasFlag('no-cli');
const FLAG_NO_DASH   = hasFlag('no-dashboard');
const FLAG_NO_DAEMON = hasFlag('no-daemon');
const FLAG_SCOPE     = getArg('scope')       ?? process.env.ROUTERLY_SCOPE       ?? '';
const FLAG_PORT      = getArg('port')        ?? process.env.ROUTERLY_PORT        ?? '';
const FLAG_URL       = getArg('public-url')  ?? process.env.ROUTERLY_PUBLIC_URL  ?? '';

// From env vars (--yes mode)
const ENV_INSTALL_SVC  = process.env.ROUTERLY_INSTALL_SERVICE;
const ENV_INSTALL_CLI  = process.env.ROUTERLY_INSTALL_CLI;
const ENV_INSTALL_DASH = process.env.ROUTERLY_INSTALL_DASHBOARD;
const ENV_DAEMON       = process.env.ROUTERLY_DAEMON;

// ─── Platform ─────────────────────────────────────────────────────────────────
const PLATFORM = process.platform; // 'linux' | 'darwin' | 'win32'
const HOME     = os.homedir();

// ─── Interactive readline ─────────────────────────────────────────────────────
// When launched via pipe (curl | bash) stdin is the pipe, not the terminal.
// Open /dev/tty directly so prompts block waiting for real keyboard input.
let _rlInput = process.stdin;
let _ttyStream = null;
if (!process.stdin.isTTY && process.platform !== 'win32') {
  try {
    const ttyFd  = fs.openSync('/dev/tty', 'r+');
    _ttyStream   = new TTYReadStream(ttyFd);
    _rlInput     = _ttyStream;
  } catch { /* no /dev/tty (CI/container) — fall back to stdin; use --yes */ }
}
const rl = createInterface({ input: _rlInput, output: process.stdout });
const question = (q) => new Promise(resolve => rl.question(q, resolve));

async function ask(prompt, defaultValue, { hint = '' } = {}) {
  if (YES) return defaultValue;
  const hintStr = hint  ? c.dim(` (${hint})`) : '';
  const defStr  = defaultValue !== ''
    ? ` ${c.dim('[' + defaultValue + ']')}`
    : '';
  const answer  = (await question(`  ${prompt}${hintStr}${defStr}: `)).trim();
  return answer === '' ? defaultValue : answer;
}

async function askSecret(prompt) {
  if (YES) return '';
  return new Promise((resolve) => {
    process.stdout.write(`  ${prompt}${c.dim(' (hidden)')}: `);
    const origWrite = rl._writeToOutput.bind(rl);
    rl._writeToOutput = () => {};
    rl.question('', (answer) => {
      rl._writeToOutput = origWrite;
      process.stdout.write('\n');
      resolve(answer.trim());
    });
  });
}

async function confirm(prompt, defaultYes = true) {
  if (YES) return defaultYes;
  const choices = defaultYes ? c.dim('[Y/n]') : c.dim('[y/N]');
  const answer  = (await question(`  ${prompt} ${choices} `)).trim().toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

// ─── Banner ───────────────────────────────────────────────────────────────────
console.log('\n' + c.bold(c.cyan('  Routerly')) + c.dim('  Installer') + '\n');
console.log(c.dim('  Self-hosted LLM gateway — https://github.com/routerly/routerly\n'));

// ─── Data directories ────────────────────────────────────────────────────────
// cliHome  : always per-user — each user that runs the CLI gets their own
//            config/data here, regardless of install scope.
// serviceHome: computed after scope is chosen (Phase 1); may be system-wide.
const cliHome = path.join(HOME, '.routerly');

// ─── Detect existing install ──────────────────────────────────────────────────
// settings.json is written to serviceHome, which differs by scope:
//   user scope  → ~/.routerly/config/settings.json  (same as cliHome)
//   system scope (Windows) → C:\ProgramData\Routerly\config\settings.json
//   system scope (macOS)   → /Library/Application Support/Routerly/config/settings.json
//   system scope (Linux)   → /var/lib/routerly/config/settings.json
const _systemServiceHome =
  PLATFORM === 'win32'   ? path.join('C:\\ProgramData', 'Routerly') :
  PLATFORM === 'darwin'  ? '/Library/Application Support/Routerly' :
                           '/var/lib/routerly';
const _candidateSettingsPaths = [
  path.join(cliHome, 'config', 'settings.json'),
  path.join(_systemServiceHome, 'config', 'settings.json'),
];
// Pick the first path that actually exists; fall back to the user-scope path
// so that isExistingInstall is false on a fresh machine.
const existingSettingsPath =
  _candidateSettingsPaths.find(p => fs.existsSync(p)) ?? _candidateSettingsPaths[0];
const isExistingInstall = fs.existsSync(existingSettingsPath);

// Read existing config to reuse in update/reinstall flows
let existingSettings = {};
if (isExistingInstall) {
  try { existingSettings = JSON.parse(fs.readFileSync(existingSettingsPath, 'utf-8')); } catch { /* ignore */ }
}

// Read existing CLI remote URL config
const existingCliConfigPath = path.join(cliHome, 'config', 'cli.json');
let existingCliConfig = {};
if (fs.existsSync(existingCliConfigPath)) {
  try { existingCliConfig = JSON.parse(fs.readFileSync(existingCliConfigPath, 'utf-8')); } catch { /* ignore */ }
}

/** Remove a path recursively, using sudo on POSIX if needed */
async function removeDir(dir, needsSudo) {
  if (!fs.existsSync(dir)) return;
  if (needsSudo && PLATFORM !== 'win32') {
    await exec(`sudo rm -rf "${dir}"`).catch(() => {});
  } else {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Stop and remove the Routerly system daemon */
async function removeDaemon(scope) {
  if (PLATFORM === 'linux') {
    const unit = scope === 'system' ? 'routerly.service' : 'routerly.service';
    const sudo = scope === 'system' ? 'sudo ' : '';
    const ctl  = scope === 'system' ? 'systemctl' : 'systemctl --user';
    await exec(`${sudo}${ctl} stop ${unit} 2>/dev/null`).catch(() => {});
    await exec(`${sudo}${ctl} disable ${unit} 2>/dev/null`).catch(() => {});
    const unitPath = scope === 'system'
      ? `/etc/systemd/system/${unit}`
      : path.join(HOME, `.config/systemd/user/${unit}`);
    await exec(`${sudo}rm -f "${unitPath}"`).catch(() => {});
    await exec(`${sudo}${ctl} daemon-reload 2>/dev/null`).catch(() => {});
  } else if (PLATFORM === 'darwin') {
    const label    = 'ai.routerly.service';
    const plistDir = scope === 'system' ? '/Library/LaunchDaemons' : path.join(HOME, 'Library/LaunchAgents');
    const plistPath = path.join(plistDir, `${label}.plist`);
    const sudo = scope === 'system' ? 'sudo ' : '';
    await exec(`${sudo}launchctl unload -w "${plistPath}" 2>/dev/null`).catch(() => {});
    await exec(`${sudo}rm -f "${plistPath}"`).catch(() => {});
  } else if (PLATFORM === 'win32') {
    await exec(`sc stop routerly 2>nul`).catch(() => {});
    await exec(`sc delete routerly 2>nul`).catch(() => {});
  }
}

// Read existing install scope from APP_DIR symlink/path heuristic
function detectExistingScope() {
  // Check for system-level paths
  const systemPaths = ['/opt/routerly', 'C:\\Routerly', '/usr/local/lib/routerly'];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) return 'system';
  }
  return 'user';
}

function detectExistingAppDir() {
  const systemPaths = ['/opt/routerly', 'C:\\Routerly', '/usr/local/lib/routerly'];
  for (const p of systemPaths) {
    if (fs.existsSync(p)) return p;
  }
  return path.join(HOME, '.routerly', 'app');
}

let installMode = 'fresh'; // 'fresh' | 'update' | 'reinstall' | 'uninstall'

if (isExistingInstall && !YES) {
  console.log('\n' + c.yellow(c.bold('  Existing installation detected')) + '\n');

  console.log(`  What would you like to do?\n`);
  console.log(`    ${c.bold('1')}  ${c.cyan('Update')}      — download & rebuild latest code, keep all settings`);
  console.log(`    ${c.bold('2')}  ${c.cyan('Reinstall')}   — change components or settings (user data preserved)`);
  console.log(`    ${c.bold('3')}  ${c.cyan('Uninstall')}   — remove Routerly from this machine`);
  console.log(`    ${c.bold('0')}  ${c.cyan('Cancel')}\n`);

  const choice = (await question('  Choose [1]: ')).trim();

  if (choice === '0' || choice.toLowerCase() === 'c') {
    rl.close(); process.exit(0);
  } else if (choice === '3') {
    installMode = 'uninstall';
  } else if (choice === '2') {
    installMode = 'reinstall';
    warn('User data (accounts, budgets, usage history) will NOT be modified.');
  } else {
    installMode = 'update';
  }

  if (installMode === 'uninstall') {
    const confirm_uninstall = await confirm(
      c.red('This will remove Routerly and all its files. Are you sure?'), false
    );
    if (!confirm_uninstall) { rl.close(); process.exit(0); }

    info('Stopping and removing daemon...');
    const detectedScope = detectExistingScope();
    await removeDaemon(detectedScope);

    const needsSudo = detectedScope === 'system' && PLATFORM !== 'win32';

    // Remove app dir
    const systemAppDirs = ['/opt/routerly', 'C:\\Routerly', '/usr/local/lib/routerly'];
    for (const d of systemAppDirs) {
      if (fs.existsSync(d)) { await removeDir(d, needsSudo); success(`Removed ${d}`); }
    }
    const userAppDir = path.join(HOME, '.routerly', 'app');
    if (fs.existsSync(userAppDir)) { await removeDir(userAppDir, false); success(`Removed ${userAppDir}`); }

    // Remove CLI wrapper
    const binPaths = [
      '/usr/local/bin/routerly',
      path.join(HOME, '.local/bin/routerly'),
      path.join(HOME, 'bin/routerly'),
      'C:\\Routerly\\bin\\routerly.cmd',
      path.join(HOME, '.routerly', 'bin', 'routerly'),
      path.join(HOME, '.routerly', 'bin', 'routerly.cmd'),
    ];
    for (const b of binPaths) {
      if (fs.existsSync(b)) { try { fs.unlinkSync(b); success(`Removed ${b}`); } catch { /* skip */ } }
    }

    // Remove data dir (ask)
    const removeData = await confirm(
      `  Also remove all user data at ${c.bold(cliHome)}? (accounts, settings, history)`, false
    );
    if (removeData) {
      await removeDir(cliHome, false);
      success(`Removed ${cliHome}`);
    } else {
      info(`User data kept at ${c.dim(cliHome)}`);
    }

    console.log('\n' + c.green(c.bold('  Routerly uninstalled successfully.')) + '\n');
    rl.close(); process.exit(0);
  }
}

// For update mode we skip the config wizard and reuse existing settings
const isUpdate = installMode === 'update';

// ════════════════════════════════════════════════════════════════════════════
// PHASE 1: Configuration
// ════════════════════════════════════════════════════════════════════════════
step('1', 'Configuration');

// ── Scope ─────────────────────────────────────────────────────────────────────
let scope;
if (FLAG_SCOPE) {
  scope = FLAG_SCOPE;
} else if (YES || isUpdate) {
  scope = detectExistingScope();
} else {
  console.log();
  console.log('  Installation scope:');
  console.log(`    ${c.bold('1')}  ${c.cyan('User')}    — installs in your home directory (no sudo needed)`);
  console.log(`    ${c.bold('2')}  ${c.cyan('System')}  — installs system-wide (requires sudo / admin)`);
  console.log();
  const choice = (await question('  Choose scope [1]: ')).trim();
  scope = choice === '2' ? 'system' : 'user';
}
if (scope !== 'user' && scope !== 'system') {
  die(`Invalid scope "${scope}". Must be "user" or "system".`);
}
success(`Scope: ${c.bold(scope)}`);

// ── Windows admin check ───────────────────────────────────────────────────────
// On Windows, system-scope installation requires elevated privileges but we
// can't use sudo. Check if running as Administrator and fail early if not.
if (scope === 'system' && PLATFORM === 'win32') {
  info('Checking for Administrator privileges...');
  try {
    // This command succeeds only when running as Administrator
    await exec('net session >nul 2>&1', { shell: 'cmd.exe' });
    success('Running with Administrator privileges');
  } catch {
    console.error('\n' + c.red(c.bold('✗ Administrator privileges required')));
    console.error('\n  System-scope installation on Windows requires Administrator rights.');
    console.error('  Please close this window and run PowerShell as Administrator, then try again:\n');
    console.error(c.dim('    1. Right-click PowerShell'));
    console.error(c.dim('    2. Select "Run as Administrator"'));
    console.error(c.dim('    3. Re-run the installation command\n'));
    console.error('  Or install in user scope instead (does not require admin).\n');
    rl.close();
    process.exit(1);
  }
}

// ── Service data directory ───────────────────────────────────────────────────
// The service reads/writes its config here. For system scope this is a shared
// system directory; for user scope it coincides with cliHome.
let serviceHome;
if (scope === 'system') {
  if (PLATFORM === 'win32') {
    serviceHome = path.join('C:\\ProgramData', 'Routerly');
  } else if (PLATFORM === 'darwin') {
    serviceHome = '/Library/Application Support/Routerly';
  } else {
    serviceHome = '/var/lib/routerly';
  }
} else {
  serviceHome = cliHome;
}

// ── Components ────────────────────────────────────────────────────────────────
let installService, installCli, installDashboard;

if (isUpdate) {
  // Reuse the same components as the existing install
  installService   = existingSettings.dashboardEnabled !== undefined || fs.existsSync(
    path.join(detectExistingAppDir(), 'packages', 'service', 'dist', 'index.js')
  );
  installCli       = fs.existsSync(detectExistingAppDir() + (PLATFORM === 'win32' ? '\\packages\\cli\\dist\\index.js' : '/packages/cli/dist/index.js'));
  installDashboard = existingSettings.dashboardEnabled === true;
  info(`Updating with existing config: service=${installService}, cli=${installCli}, dashboard=${installDashboard}`);
} else if (YES) {
  installService   = ENV_INSTALL_SVC  !== '0' && !FLAG_NO_SVC;
  installCli       = ENV_INSTALL_CLI  !== '0' && !FLAG_NO_CLI;
  installDashboard = ENV_INSTALL_DASH !== '0' && !FLAG_NO_DASH;
} else {
  console.log('\n  Which components do you want to install?\n');
  installService   = !FLAG_NO_SVC  && await confirm('  Install the Routerly service (API gateway)?', true);
  installCli       = !FLAG_NO_CLI  && await confirm('  Install the Routerly CLI?', true);
  installDashboard = !FLAG_NO_DASH && installService && await confirm('  Install the web dashboard?', true);
}

if (!installService && !installCli && !installDashboard) {
  die('Nothing to install. Select at least one component.');
}

// ── Remote service URL (when service not installed) ───────────────────────────
let remoteServiceUrl = '';
if (isUpdate) {
  remoteServiceUrl = existingCliConfig.serviceUrl ?? '';
} else if (!installService && installCli) {
  remoteServiceUrl = await ask(
    'Remote Routerly service URL',
    'http://localhost:3000',
    { hint: 'used by the CLI to reach the service' }
  );
}

// ── Port & URL ────────────────────────────────────────────────────────────────
let port = 3000;
let publicUrl = '';
if (installService) {
  if (isUpdate) {
    port      = existingSettings.port      ?? 3000;
    publicUrl = existingSettings.publicUrl ?? `http://localhost:${port}`;
    info(`Keeping existing config: port=${port}, publicUrl=${publicUrl}`);
  } else {
    port = parseInt(
      FLAG_PORT || await ask('Service port', '3000'),
      10
    );
    if (isNaN(port) || port < 1 || port > 65535) die(`Invalid port: ${port}`);
    publicUrl = FLAG_URL || await ask('Public URL', `http://localhost:${port}`);
  }
}

// ── Daemon ────────────────────────────────────────────────────────────────────
let setupDaemon = false;
if (installService) {
  if (FLAG_NO_DAEMON) {
    setupDaemon = false;
  } else if (YES || isUpdate) {
    setupDaemon = ENV_DAEMON !== '0';
  } else {
    setupDaemon = await confirm(
      `  Configure Routerly to start automatically at boot?`,
      true
    );
  }
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('\n' + c.bold('  Summary:'));
console.log(`    Scope:       ${c.cyan(scope)}`);
console.log(`    Service:     ${installService   ? c.green('yes') : c.dim('no')}`);
if (installService) {
  console.log(`    Port:        ${port}`);
  console.log(`    Public URL:  ${publicUrl}`);
  console.log(`    Dashboard:   ${installDashboard ? c.green('yes') : c.dim('no')}`);
  console.log(`    Auto-start:  ${setupDaemon      ? c.green('yes') : c.dim('no')}`);
}
console.log(`    CLI:         ${installCli ? c.green('yes') : c.dim('no')}`);
if (!installService && remoteServiceUrl) {
  console.log(`    Service URL: ${remoteServiceUrl}`);
}
console.log();

if (!YES && !isUpdate) {
  const go = await confirm('Proceed with installation?', true);
  if (!go) { rl.close(); process.exit(0); }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 2: Directories
// ════════════════════════════════════════════════════════════════════════════
step('2', 'Preparing directories');

// Where the app files live
// On Windows, use C:\Routerly instead of C:\Program Files\Routerly to avoid
// permission issues with npm install/build (Program Files has strict ACLs).
const APP_DIR = scope === 'user'
  ? path.join(HOME, '.routerly', 'app')
  : (PLATFORM === 'win32' ? 'C:\\Routerly' : '/opt/routerly');

// Where the bin wrapper lives
const BIN_DIR = scope === 'user'
  ? (PLATFORM === 'win32'
      ? path.join(HOME, 'AppData', 'Local', 'Microsoft', 'WindowsApps')
      : path.join(HOME, '.local', 'bin'))
  : (PLATFORM === 'win32' ? 'C:\\Windows\\System32' : '/usr/local/bin');

// System directories require elevated privileges on Unix.
const needsSudo = scope === 'system' && PLATFORM !== 'win32';

await mkdirP(APP_DIR, needsSudo);
await mkdirP(BIN_DIR, needsSudo);
// Service data dir — may be a system path
await mkdirP(path.join(serviceHome, 'config'), needsSudo);
await mkdirP(path.join(serviceHome, 'data'),   needsSudo);
// CLI data dir — always per-user, no sudo needed
await fsp.mkdir(path.join(cliHome, 'config'), { recursive: true });
await fsp.mkdir(path.join(cliHome, 'data'),   { recursive: true });

success(`App directory:  ${c.dim(APP_DIR)}`);
success(`Bin directory:  ${c.dim(BIN_DIR)}`);
success(`Service data:   ${c.dim(serviceHome)}`);
if (scope === 'system') {
  success(`CLI data:       ${c.dim(cliHome)} ${c.dim('(per-user)')}`);
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 3: Copy source & install dependencies
// ════════════════════════════════════════════════════════════════════════════
step('3', 'Copying files & installing dependencies');

// Copy source tree to APP_DIR
info(`Copying source from ${c.dim(SOURCE_DIR)} to ${c.dim(APP_DIR)}...`);
await copyDir(SOURCE_DIR, APP_DIR, needsSudo);
success('Source files copied');

// For system installs the directory was created/populated with sudo.
// Transfer ownership to the current user so npm install and build commands
// can run without sudo (and avoid creating root-owned node_modules).
if (needsSudo) {
  const currentUser = os.userInfo().username;
  await runCmd(`sudo chown -R ${currentUser} "${APP_DIR}"`, '/');
}

// npm install --ignore-scripts
// (skip lifecycle scripts to avoid "husky: not found" error)
// Note: We need devDependencies (TypeScript, etc.) to build packages
info('Installing dependencies...');
await runCmd('npm install --ignore-scripts', APP_DIR);
success('Dependencies installed');

// ── Build packages ─────────────────────────────────────────────────────────
step('4', 'Building packages');

// Always build shared (everything depends on it)
info('Building @routerly/shared...');
await runCmd('npm run build --workspace=packages/shared', APP_DIR);
success('@routerly/shared built');

if (installService) {
  info('Building @routerly/service...');
  await runCmd('npm run build --workspace=packages/service', APP_DIR);
  success('@routerly/service built');
}

if (installDashboard) {
  info('Building @routerly/dashboard...');
  await runCmd('npm run build --workspace=packages/dashboard', APP_DIR);
  success('@routerly/dashboard built');
}

if (installCli) {
  info('Building @routerly/cli...');
  await runCmd('npm run build --workspace=packages/cli', APP_DIR);
  success('@routerly/cli built');
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 5: Generate secret key & write settings
// ════════════════════════════════════════════════════════════════════════════
step('5', 'Writing configuration');

// Write settings.json only on fresh install (don't overwrite existing config)
// Service config lives in serviceHome (may be a system-wide path).
const settingsPath = path.join(serviceHome, 'config', 'settings.json');
if (!fs.existsSync(settingsPath)) {
  const settings = {
    port,
    host: '0.0.0.0',
    dashboardEnabled: installDashboard,
    defaultTimeoutMs: 30000,
    logLevel: 'info',
    publicUrl,
  };
  await writeFileP(settingsPath, JSON.stringify(settings, null, 2), needsSudo);
  success('settings.json written');
} else {
  info('Existing settings.json kept (upgrade mode)');
}

// ── Persist ROUTERLY_HOME to shell profile (user scope only) ─────────────────
// For system scope the service daemon has ROUTERLY_HOME set in its own unit.
// The CLI resolves its per-user data dir dynamically via its wrapper script,
// so no global env var needs to be exported for system installations.
if (scope === 'user') {
  const envLine = `\n# Routerly\nexport ROUTERLY_HOME="${cliHome}"\n`;
  if (PLATFORM !== 'win32') {
    const profiles = [
      path.join(HOME, '.zshrc'),
      path.join(HOME, '.bashrc'),
      path.join(HOME, '.profile'),
    ];
    const profilePath = profiles.find(p => fs.existsSync(p)) ?? profiles[2];
    const existing = fs.existsSync(profilePath)
      ? await fsp.readFile(profilePath, 'utf-8')
      : '';
    if (!existing.includes('ROUTERLY_HOME')) {
      await fsp.appendFile(profilePath, envLine);
      success(`ROUTERLY_HOME added to ${c.dim(profilePath)}`);
    } else {
      info('ROUTERLY_HOME already in shell profile, skipping');
    }
  } else {
    try {
      await runCmd(`setx ROUTERLY_HOME "${cliHome}"`, APP_DIR);
      success('ROUTERLY_HOME set via setx');
    } catch {
      warn('Could not set ROUTERLY_HOME via setx. Set it manually.');
    }
  }
}

// ── Export serviceHome for the remainder of this process (wizard etc.) ────────
process.env.ROUTERLY_HOME = serviceHome;

// ════════════════════════════════════════════════════════════════════════════
// PHASE 6: Install CLI wrapper
// ════════════════════════════════════════════════════════════════════════════
if (installCli) {
  step('6', 'Installing CLI');

  const cliEntry = path.join(APP_DIR, 'packages', 'cli', 'dist', 'index.js');

  if (PLATFORM === 'win32') {
    // .cmd wrapper for Windows
    // System scope: use %USERPROFILE% so each user gets their own config dir.
    // User scope: hardcode the current user's cliHome.
    const cliHomeExpr = scope === 'system' ? '%USERPROFILE%\\.routerly' : cliHome;
    const binPath = path.join(BIN_DIR, 'routerly.cmd');
    const wrapper = `@echo off\nset ROUTERLY_HOME=${cliHomeExpr}\nnode "${cliEntry}" %*\n`;
    await fsp.writeFile(binPath, wrapper);
    success(`CLI wrapper installed at ${c.dim(binPath)}`);
  } else {
    // Shell wrapper for Unix
    // System scope: resolve $HOME at runtime so each user gets their own config.
    // User scope: hardcode the current user's cliHome.
    const cliHomeExpr = scope === 'system' ? '$HOME/.routerly' : cliHome;
    const binPath = path.join(BIN_DIR, 'routerly');
    const wrapper = `#!/bin/sh\nexport ROUTERLY_HOME="${cliHomeExpr}"\nexec node "${cliEntry}" "$@"\n`;
    await writeFileP(binPath, wrapper, needsSudo, 0o755);
    success(`CLI wrapper installed at ${c.dim(binPath)}`);

    // Ensure BIN_DIR is on PATH (add to shell profile if not already there)
    if (!process.env.PATH?.split(':').includes(BIN_DIR)) {
      const pathLine = `\nexport PATH="${BIN_DIR}:$PATH"\n`;
      const profiles = [
        path.join(HOME, '.zshrc'),
        path.join(HOME, '.bashrc'),
        path.join(HOME, '.profile'),
      ];
      const profilePath = profiles.find(p => fs.existsSync(p)) ?? profiles[2];
      const existing    = fs.existsSync(profilePath)
        ? await fsp.readFile(profilePath, 'utf-8')
        : '';
      if (!existing.includes(BIN_DIR)) {
        await fsp.appendFile(profilePath, pathLine);
        info(`Added ${c.dim(BIN_DIR)} to PATH in ${c.dim(profilePath)}`);
      }
    }
  }

  // Remote URL config for CLI-only installs
  if (!installService && remoteServiceUrl) {
    const cliConfigPath = path.join(cliHome, 'config', 'cli.json');
    await fsp.writeFile(
      cliConfigPath,
      JSON.stringify({ serviceUrl: remoteServiceUrl }, null, 2)
    );
    success(`CLI remote URL saved to ${c.dim(cliConfigPath)}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 7: Daemon / auto-start
// ════════════════════════════════════════════════════════════════════════════
if (installService && setupDaemon) {
  step('7', 'Configuring auto-start daemon');

  const serviceEntry = path.join(APP_DIR, 'packages', 'service', 'dist', 'index.js');
  const nodeExe      = process.execPath;

  if (PLATFORM === 'linux') {
    await setupSystemdService({ scope, serviceEntry, nodeExe, routerlyHome: serviceHome, port });
  } else if (PLATFORM === 'darwin') {
    await setupLaunchdService({ scope, serviceEntry, nodeExe, routerlyHome: serviceHome, port });
  } else if (PLATFORM === 'win32') {
    await setupWindowsService({ serviceEntry, nodeExe, routerlyHome: serviceHome, port });
  } else {
    warn('Auto-start not supported on this platform. Start the service manually with:');
    console.log(`  node ${serviceEntry}`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// PHASE 8: Post-install setup wizard (optional)
// ════════════════════════════════════════════════════════════════════════════
if (installService && !isUpdate) {
  console.log('\n' + '─'.repeat(60));
  info(c.bold('Optional: Initial Setup Wizard'));
  console.log(c.dim('  Create an admin user, configure a model, and set up a project to get started quickly.'));
  console.log(c.dim('  You can always do this later with the `routerly` CLI.\n'));

  const doWizard = await confirm('  Run the setup wizard now?', !YES);
  if (doWizard) {
    await setupWizard({ port, routerlyHome: serviceHome, APP_DIR, installCli });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// Done
// ════════════════════════════════════════════════════════════════════════════
console.log('\n' + '─'.repeat(60));
console.log(c.green(c.bold('\n  Routerly installed successfully!\n')));

if (installService) {
  if (setupDaemon) {
    console.log(`  The service will start automatically at boot.`);
  } else {
    console.log(c.bold('  To start the service manually:'));
    if (PLATFORM === 'win32') {
      console.log(`    node ${path.join(APP_DIR, 'packages', 'service', 'dist', 'index.js')}`);
    } else {
      console.log(`    source ~/.zshrc   ${c.dim('# or restart your terminal')}`);
      console.log(`    node ${path.join(APP_DIR, 'packages', 'service', 'dist', 'index.js')}`);
    }
    console.log();
  }
  console.log(`  Service URL:   ${c.cyan(publicUrl)}`);
  if (installDashboard) {
    console.log(`  Dashboard:     ${c.cyan(publicUrl + '/dashboard/')}`);
  }
  console.log(`  Health check:  ${c.dim('curl ' + publicUrl + '/health')}`);
}

if (installCli) {
  console.log();
  console.log(`  CLI:           ${c.cyan('routerly --help')}  ${c.dim('(restart terminal to use)')}`);
}

console.log('\n' + c.dim('  Docs: https://github.com/routerly/routerly/tree/main/docs') + '\n');

rl.close();
process.exit(0);

// ════════════════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════════════════

/** Create a directory, using sudo for system paths on non-Windows. */
async function mkdirP(dir, useSudo = false) {
  if (useSudo) {
    await runCmd(`sudo mkdir -p "${dir}"`, '/');
  } else {
    await fsp.mkdir(dir, { recursive: true });
  }
}

/**
 * Write a file, using sudo for system paths on non-Windows.
 * For sudo writes: writes to a temp file then sudo-moves it into place.
 */
async function writeFileP(filePath, content, useSudo = false, mode = 0o644) {
  if (useSudo) {
    const tmp = path.join(os.tmpdir(), `routerly-${randomBytes(4).toString('hex')}`);
    await fsp.writeFile(tmp, content, { mode });
    await runCmd(`sudo mv "${tmp}" "${filePath}"`, '/');
    await runCmd(`sudo chmod ${mode.toString(8)} "${filePath}"`, '/');
  } else {
    await fsp.writeFile(filePath, content, { mode });
  }
}

/** Run a shell command, piping output to console. */
async function runCmd(cmd, cwd) {
  try {
    const { stdout, stderr } = await exec(cmd, { cwd });
    if (stdout) process.stdout.write(c.dim(stdout));
    if (stderr) process.stderr.write(c.dim(stderr));
  } catch (err) {
    // Show stdout/stderr from the failed command so the user can see the actual errors
    if (err.stdout) process.stdout.write(err.stdout);
    if (err.stderr) process.stderr.write(err.stderr);
    die(`Command failed: ${cmd}`);
  }
}

/** Recursively copy a directory, optionally using sudo for system paths. */
async function copyDir(src, dest, useSudo = false) {
  await mkdirP(dest, useSudo);
  const entries = await fsp.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    // Skip heavy dirs that aren't needed in the install target
    if (entry.isDirectory() && ['node_modules', '.git', '.github', '.vscode', 'spec'].includes(entry.name)) {
      continue;
    }
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath, useSudo);
    } else if (useSudo) {
      await runCmd(`sudo cp "${srcPath}" "${destPath}"`, '/');
    } else {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

// ── systemd (Linux) ───────────────────────────────────────────────────────────
async function setupSystemdService({ scope, serviceEntry, nodeExe, routerlyHome, port }) {
  const isSystem = scope === 'system';
  const unitName = 'routerly.service';

  const unitContent = [
    '[Unit]',
    'Description=Routerly LLM API Gateway',
    'After=network.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart=${nodeExe} ${serviceEntry}`,
    `Environment=ROUTERLY_HOME=${routerlyHome}`,
    `Environment=NODE_ENV=production`,
    `WorkingDirectory=${path.dirname(serviceEntry)}`,
    'Restart=on-failure',
    'RestartSec=5s',
    '',
    '[Install]',
    `WantedBy=${isSystem ? 'multi-user.target' : 'default.target'}`,
  ].join('\n');

  let unitPath;
  if (isSystem) {
    unitPath = path.join('/etc/systemd/system', unitName);
    // Write to temp file first, then move with sudo
    const tempFile = path.join('/tmp', unitName);
    await fsp.writeFile(tempFile, unitContent);
    info('Installing systemd service (requires sudo)...');
    await runCmd(`sudo mv ${tempFile} ${unitPath}`, '/');
    await runCmd(`sudo systemctl daemon-reload`, '/');
    await runCmd(`sudo systemctl enable --now ${unitName}`, '/');
  } else {
    const systemdUserDir = path.join(HOME, '.config', 'systemd', 'user');
    await fsp.mkdir(systemdUserDir, { recursive: true });
    unitPath = path.join(systemdUserDir, unitName);
    await fsp.writeFile(unitPath, unitContent);
    info('Enabling and starting user systemd service...');
    try {
      await runCmd(`systemctl --user daemon-reload`, '/');
      await runCmd(`systemctl --user enable --now ${unitName}`, '/');
    } catch {
      warn('Could not auto-start via systemctl. Run manually:');
      console.log(`  systemctl --user enable --now ${unitName}`);
    }
  }
  success(`systemd unit written to ${c.dim(unitPath)}`);
}

// ── launchd (macOS) ───────────────────────────────────────────────────────────
async function setupLaunchdService({ scope, serviceEntry, nodeExe, routerlyHome, port }) {
  const isSystem = scope === 'system';
  const label    = 'ai.routerly.service';
  const plistContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodeExe}</string>
    <string>${serviceEntry}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>ROUTERLY_HOME</key>
    <string>${routerlyHome}</string>
    <key>NODE_ENV</key>
    <string>production</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>${routerlyHome}/service.log</string>
  <key>StandardErrorPath</key>
  <string>${routerlyHome}/service-error.log</string>
</dict>
</plist>`;

  let plistDir, plistPath;
  if (isSystem) {
    plistDir  = '/Library/LaunchDaemons';
    plistPath = path.join(plistDir, `${label}.plist`);
    // Write to temp file first, then move with sudo
    const tempFile = path.join('/tmp', `${label}.plist`);
    await fsp.writeFile(tempFile, plistContent);
    info('Installing launchd daemon (requires sudo)...');
    await runCmd(`sudo mv ${tempFile} ${plistPath}`, '/');
    await runCmd(`sudo chmod 644 ${plistPath}`, '/');
    try {
      await runCmd(`sudo launchctl load -w "${plistPath}"`, '/');
    } catch {
      warn('Could not load daemon automatically. Run: sudo launchctl load -w ' + plistPath);
    }
  } else {
    plistDir  = path.join(HOME, 'Library', 'LaunchAgents');
    plistPath = path.join(plistDir, `${label}.plist`);
    await fsp.mkdir(plistDir, { recursive: true });
    await fsp.writeFile(plistPath, plistContent);
    info('Loading launchd agent...');
    try {
      await runCmd(`launchctl load -w "${plistPath}"`, '/');
    } catch {
      warn('Could not load agent automatically. Run: launchctl load -w ' + plistPath);
    }
  }
  success(`launchd plist written to ${c.dim(plistPath)}`);
}

// ── Windows SCM ───────────────────────────────────────────────────────────────
async function setupWindowsService({ serviceEntry, nodeExe, routerlyHome, port }) {
  const svcName = 'routerly';
  const binPath = `"${nodeExe}" "${serviceEntry}"`;
  info('Registering Windows Service via sc.exe...');
  try {
    // Try to delete an existing service first (ignore error if not found)
    await exec(`sc.exe delete ${svcName}`).catch(() => {});
    await runCmd(
      `sc.exe create ${svcName} binPath= "${binPath}" start= auto DisplayName= "Routerly LLM Gateway"`,
      '/'
    );
    // Set environment variables via the registry
    const regPath = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\${svcName}`;
    const envLine  = `ROUTERLY_HOME=${routerlyHome}\0NODE_ENV=production\0`;
    await runCmd(`reg add "${regPath}" /v Environment /t REG_MULTI_SZ /d "${envLine}" /f`, '/');
    await runCmd(`sc.exe start ${svcName}`, '/');
    success(`Windows Service "${svcName}" created and started`);
  } catch {
    warn('Could not create Windows Service automatically (may need admin privileges).');
    warn('To start manually, run in an elevated prompt:');
    console.log(`  set ROUTERLY_HOME=${routerlyHome}`);
    console.log(`  node "${serviceEntry}"`);
  }
}

// ── Setup wizard ──────────────────────────────────────────────────────────────
async function setupWizard({ port, routerlyHome, APP_DIR, installCli }) {
  const baseUrl = `http://localhost:${port}`;

  // Give the service a moment to boot if the daemon was just started
  info('Waiting for service to be ready...');
  const ready = await waitForService(baseUrl + '/health', 15, 1000);
  if (!ready) {
    warn('Service is not responding yet. The wizard requires the service to be running.');
    warn('Start it manually with: routerly start');
    warn('Then run: routerly model add --id <id> --provider openai --api-key <key>');
    return;
  }
  success('Service is up');

  // ── Create admin user ──
  console.log('\n' + c.bold('  Step 1: Create a dashboard admin user') + '\n');
  const addUser = await confirm('  Create an admin user now?', true);
  if (addUser) {
    const email    = await ask('  Email', 'admin@localhost');
    let password = '';
    while (true) {
      password = await askSecret('  Password (min 8 characters)');
      if (!password || password.length < 8) {
        warn('Password too short, try again.');
        continue;
      }
      const confirm2 = await askSecret('  Confirm password');
      if (password !== confirm2) {
        warn('Passwords do not match, try again.');
        continue;
      }
      break;
    }
    const cliArgs = `--email "${email}" --password "${password}" --role admin`;
    try {
      await runCliOrApi('user', 'add', cliArgs, { baseUrl, routerlyHome, APP_DIR, installCli });
      success(`Admin user ${c.bold(email)} created`);
    } catch {
      warn('Could not create user via CLI. Run manually: routerly user add ' + cliArgs);
    }
  }

  // ── Add a model ──
  console.log('\n' + c.bold('  Step 2: Add an LLM model') + '\n');
  console.log('  Supported providers: openai, anthropic, gemini, ollama, custom\n');
  const addModel = await confirm('  Add a model now?', true);
  if (addModel) {
    const modelId   = await ask('  Model ID', 'gpt-4o', { hint: 'e.g. gpt-4o, claude-3-5-sonnet-20241022' });
    const provider  = await ask('  Provider', 'openai', { hint: 'openai | anthropic | gemini | ollama | custom' });
    const needsKey  = provider !== 'ollama';
    const apiKey    = needsKey
      ? await ask(`  API key for ${provider}`, '', { hint: 'will be stored encrypted' })
      : '';
    const endpoint  = await ask('  Custom endpoint (leave blank for default)', '');

    const cliArgs = [
      `--id "${modelId}"`,
      `--provider ${provider}`,
      apiKey    ? `--api-key "${apiKey}"` : '',
      endpoint  ? `--endpoint "${endpoint}"` : '',
    ].filter(Boolean).join(' ');

    try {
      await runCliOrApi('model', 'add', cliArgs, { baseUrl, routerlyHome, APP_DIR, installCli });
      success(`Model ${c.bold(modelId)} registered`);
    } catch {
      warn('Could not add model via CLI. Run manually: routerly model add ' + cliArgs);
    }
  }

  // ── Create a project ──
  console.log('\n' + c.bold('  Step 3: Create a project') + '\n');
  const addProject = await confirm('  Create a project now?', true);
  if (addProject) {
    const projName = await ask('  Project name', 'My App');
    const projSlug = await ask('  Project slug', projName.toLowerCase().replace(/\s+/g, '-'));

    const cliArgs = `--name "${projName}" --slug "${projSlug}"`;
    try {
      await runCliOrApi('project', 'add', cliArgs, { baseUrl, routerlyHome, APP_DIR, installCli });
      success(`Project ${c.bold(projName)} created`);
    } catch {
      warn('Could not create project via CLI. Run manually: routerly project add ' + cliArgs);
    }
  }
}

/** Tries to run a CLI command, falling back to direct API call. */
async function runCliOrApi(resource, action, args, { baseUrl, routerlyHome, APP_DIR, installCli }) {
  if (installCli) {
    const cliEntry = path.join(APP_DIR, 'packages', 'cli', 'dist', 'index.js');
    await exec(
      `ROUTERLY_HOME="${routerlyHome}" ROUTERLY_BASE_URL="${baseUrl}" node "${cliEntry}" ${resource} ${action} ${args}`,
    );
  } else {
    throw new Error('CLI not installed');
  }
}

/** Poll a URL until it responds 200 or timeout. */
async function waitForService(url, maxAttempts, delayMs) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      await new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = http.get({
          hostname: parsed.hostname,
          port:     parseInt(parsed.port) || 3000,
          path:     parsed.pathname || '/health',
        }, res => {
          if (res.statusCode === 200) resolve(true);
          else reject(new Error(`Status ${res.statusCode}`));
        });
        req.on('error', reject);
        req.end();
      });
      return true;
    } catch {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  return false;
}
