#!/usr/bin/env node
// Theme: dashboard default is ThemeContext's 'auto' (no data-theme attribute).
// index.css only overrides to light colors inside `@media (prefers-color-scheme: light)`;
// the unqualified :root rules (the base, applied when no light preference matches) are
// dark. Forcing the Playwright context to `colorScheme: 'dark'` reproduces that default
// deterministically without touching dashboard code or localStorage.
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readdir, copyFile, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const manifestPath = path.join(repoRoot, 'scripts', 'screenshots', 'manifest.json');
const fixturesDir = path.join(repoRoot, 'scripts', 'screenshots', 'fixtures');
const catalogFixturesDir = path.join(repoRoot, 'scripts', 'screenshots', 'catalog-fixtures');
const assetsDir = path.join(repoRoot, 'docs', 'assets');
const servicePath = path.join(repoRoot, 'packages', 'service', 'dist', 'index.js');

const ADMIN_EMAIL = 'capture@routerly.local';
const ADMIN_PASSWORD = 'Capture-Fixture-Pass-1!';

const VIEWPORT = { width: 1800, height: 987 };
const HEALTH_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
// How long the page must stay free of in-flight requests and loading spinners
// before it counts as settled, and how often that is sampled. See waitForQuiet.
const QUIET_WINDOW_MS = 500;
const POLL_INTERVAL_MS = 50;
const DISABLE_MOTION_CSS = '* { animation: none !important; transition: none !important; }';
// Fixed so the port never shows up as a moving value in a screenshot; override with
// ROUTERLY_SCREENSHOT_PORT if 47816 is taken locally.
const DEFAULT_CAPTURE_PORT = 47816;
// Same reasoning as DEFAULT_CAPTURE_PORT above: this port is written into the fixture
// connection's endpoint (see patchConnectionsEndpoint) and shown on the Models page's
// connection list, so it must not vary between runs either.
const DEFAULT_MOCK_LLM_PORT = 47817;
// Every URL the script navigates to carries this query parameter, read by
// packages/dashboard/src/utils/captureMode.ts to suppress values that are true but
// non-deterministic (an uptime counter, a "last updated" clock, measured request timings).
// No real user ever sets it, so it can never affect a real user's UI.
const CAPTURE_MODE_QUERY = 'routerlyCapture=1';

function withCaptureFlag(path) {
  return path.includes('?') ? `${path}&${CAPTURE_MODE_QUERY}` : `${path}?${CAPTURE_MODE_QUERY}`;
}
// Fixed TOTP secret baked into every 2FA-setup screenshot so the QR code is identical
// across runs. Not a real secret: capture-only fixture, see the 2FA route handler below.
const FIXED_TOTP_SECRET = 'JBSWY3DPEHPK3PXP';
// screenshot-profile-2fa's captured step (right after "Enable Two-Factor Authentication")
// also renders the backup codes list, so it needs a fixed list for the same reason as the
// secret above. Not real codes: capture-only fixture.
const FIXED_BACKUP_CODES = [
  'A1B2C3D4', 'E5F6A7B8', 'C9D0E1F2', 'A3B4C5D6',
  'E7F8A9B0', 'C1D2E3F4', 'A5B6C7D8', 'E9F0A1B2',
];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function parseArgs(argv) {
  const args = { list: false, only: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--list') {
      args.list = true;
    } else if (arg === '--only') {
      args.only = argv[++i] ?? '';
    } else if (arg.startsWith('--only=')) {
      args.only = arg.slice('--only='.length);
    }
  }
  return args;
}

async function loadManifest() {
  const raw = await readFile(manifestPath, 'utf8');
  return JSON.parse(raw);
}

// usage.template.json stores each record's timestamp as `hoursAgo` instead of an
// absolute date, so the fixture never ages out of the dashboard's "This month" default
// filter no matter what day the script runs on. Resolve it to an absolute usage.json
// right before the service reads it; clamp to the first of the current month so a
// record that would otherwise land last month (e.g. hoursAgo near 300 captured on the
// 1st or 2nd of the month) still falls inside "This month".
async function resolveUsageFixture(dataDir) {
  const templatePath = path.join(fixturesDir, 'data', 'usage.template.json');
  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  const now = new Date();
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
  const resolved = template.map(({ hoursAgo, ...rest }) => {
    let ts = new Date(now.getTime() - hoursAgo * 3600000);
    if (ts < firstOfMonth) ts = firstOfMonth;
    return { ...rest, timestamp: ts.toISOString() };
  });
  await writeFile(path.join(dataDir, 'usage.json'), JSON.stringify(resolved, null, 2));
}

async function copyFixtures(tmpDir) {
  const configDir = path.join(tmpDir, 'config');
  const dataDir = path.join(tmpDir, 'data');
  await mkdir(configDir, { recursive: true });
  await mkdir(dataDir, { recursive: true });

  const entries = await readdir(fixturesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) continue; // skip data/, handled below
    await copyFile(path.join(fixturesDir, entry.name), path.join(configDir, entry.name));
  }
  await resolveUsageFixture(dataDir);
  return { configDir };
}

async function patchSettingsPort(configDir, port) {
  const settingsPath = path.join(configDir, 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  settings.port = port;
  settings.publicUrl = `http://127.0.0.1:${port}`;
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// Points the throwaway service at the local catalog fixture server (see
// startCatalogServer) instead of the live GitHub provider catalog, so
// screenshot-models-discover renders a deterministic, non-empty set of rows.
async function patchSettingsProviderRepos(configDir, catalogPort) {
  const settingsPath = path.join(configDir, 'settings.json');
  const settings = JSON.parse(await readFile(settingsPath, 'utf8'));
  settings.providerRepos = [{ url: `http://127.0.0.1:${catalogPort}/`, enabled: true }];
  await writeFile(settingsPath, JSON.stringify(settings, null, 2));
}

// Tiny static-file server standing in for the live GitHub provider catalog. Serves the
// two files catalogFetcher.get() requests (index.json, providers.json) from
// scripts/screenshots/catalog-fixtures/ so screenshot-models-discover never hits the network.
async function startCatalogServer(port) {
  const files = {
    '/index.json': await readFile(path.join(catalogFixturesDir, 'index.json')),
    '/providers.json': await readFile(path.join(catalogFixturesDir, 'providers.json')),
  };
  const server = createHttpServer((req, res) => {
    const body = files[req.url];
    if (!body) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function stopCatalogServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

// screenshot-playground-trace drives a real send through the real pipeline so the debug
// trace panel has real content, but must stay offline (no live provider). conn-local-demo
// (a fixture `custom`-provider connection, see fixtures/connections.json) is repointed at
// this mock instead. custom providers are handled by CustomAdapter
// (packages/service/src/modules/provider/custom.ts), which POSTs
// `${endpoint}/chat/completions` with `stream: false|true` and expects back a
// ChatCompletionResponse or an SSE stream of StreamChunk frames respectively. This mock
// implements exactly that contract, nothing more.
const MOCK_LLM_REPLY = 'This is a fixed local response used only to populate the debug trace for documentation screenshots.';
// Fixed, not Date.now(): nothing in the mock's response should vary run to run.
const MOCK_LLM_CREATED = 1735689600;

async function startMockLlmServer(port) {
  const server = createHttpServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(raw || '{}');
      } catch {
        body = {};
      }
      const model = body.model;

      if (body.stream === true) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        const frame = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
        frame({
          id: 'chatcmpl-mock-trace', object: 'chat.completion.chunk', created: MOCK_LLM_CREATED, model,
          choices: [{ index: 0, delta: { role: 'assistant' }, finish_reason: null }],
        });
        frame({
          id: 'chatcmpl-mock-trace', object: 'chat.completion.chunk', created: MOCK_LLM_CREATED, model,
          choices: [{ index: 0, delta: { content: MOCK_LLM_REPLY }, finish_reason: null }],
        });
        frame({
          id: 'chatcmpl-mock-trace', object: 'chat.completion.chunk', created: MOCK_LLM_CREATED, model,
          choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
          usage: { prompt_tokens: 24, completion_tokens: 22, total_tokens: 46 },
        });
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        id: 'chatcmpl-mock-trace', object: 'chat.completion', created: MOCK_LLM_CREATED, model,
        choices: [{ index: 0, message: { role: 'assistant', content: MOCK_LLM_REPLY }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 24, completion_tokens: 22, total_tokens: 46 },
      }));
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return server;
}

async function stopMockLlmServer(server) {
  if (!server) return;
  await new Promise((resolve) => server.close(resolve));
}

// Repoints the fixture connection conn-local-demo (copied into the tmp config dir by
// copyFixtures) at the mock LLM server, mirroring patchSettingsPort's read-modify-write.
async function patchConnectionsEndpoint(configDir, mockPort) {
  const connectionsPath = path.join(configDir, 'connections.json');
  const connections = JSON.parse(await readFile(connectionsPath, 'utf8'));
  const localDemo = connections.find((c) => c.id === 'conn-local-demo');
  if (localDemo) {
    localDemo.endpoint = `http://127.0.0.1:${mockPort}/v1`;
  }
  await writeFile(connectionsPath, JSON.stringify(connections, null, 2));
}

async function startService(tmpDir, port) {
  const child = spawn(process.execPath, [servicePath], {
    env: { ...process.env, ROUTERLY_HOME: tmpDir, ROUTERLY_DISABLE_UPDATE_CHECK: 'true' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stderrOutput = '';
  child.stderr.on('data', (chunk) => {
    stderrOutput += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  const start = Date.now();
  while (Date.now() - start < HEALTH_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`service process exited early (code ${child.exitCode}): ${stderrOutput.trim().slice(-500)}`);
    }
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return { child, baseUrl };
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  child.kill('SIGKILL');
  throw new Error(`service did not become healthy within ${HEALTH_TIMEOUT_MS}ms: ${stderrOutput.trim().slice(-500)}`);
}

async function stopService(child) {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  const start = Date.now();
  while (child.exitCode === null && Date.now() - start < 5000) {
    await sleep(100);
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}

async function createFirstAdmin(baseUrl) {
  const res = await fetch(`${baseUrl}/api/setup/first-admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`first-admin setup failed with status ${res.status}: ${await res.text().catch(() => '')}`);
  }
}

async function login(page, baseUrl) {
  await page.goto(withCaptureFlag(`${baseUrl}/dashboard/login`), { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: DISABLE_MOTION_CSS });
  await page.fill('input#email', ADMIN_EMAIL, { timeout: ACTION_TIMEOUT_MS });
  await page.fill('input#password', ADMIN_PASSWORD, { timeout: ACTION_TIMEOUT_MS });
  await page.click('button[type=submit]', { timeout: ACTION_TIMEOUT_MS });
  await page.waitForURL((url) => !url.pathname.endsWith('/dashboard/login'), { timeout: ACTION_TIMEOUT_MS });
}

async function runStep(page, step) {
  if ('click' in step) {
    await page.click(step.click, { timeout: ACTION_TIMEOUT_MS });
  } else if ('fill' in step) {
    await page.fill(step.fill, step.value, { timeout: ACTION_TIMEOUT_MS });
  }
}

// Waits until the dashboard says it has finished loading, and keeps saying so
// for QUIET_WINDOW_MS. `.spinner` is the single class every page uses for its
// loading indicator (index.css), and every page raises it the same way: the
// effect that fetches sets `loading` before the request and clears it after, so
// the spinner is up for exactly as long as the data is missing. The periodic
// refresh those pages also run does not raise it, so a settled page stays
// settled.
//
// Playwright's own `networkidle` cannot do this job. It is a property of the
// last *navigation*: once it has fired it stays fired, so awaiting it again
// after an in-page click returns at once and proves nothing. That is how two
// runs of the same shot disagreed, one catching the usage table and the other
// the spinner that had replaced it while the filtered query was in flight.
//
// Counting requests instead was tried and abandoned: a request the browser
// cancels because a navigation superseded it does not reliably emit
// `requestfinished` or `requestfailed`, so the count leaks upward and every
// later shot times out waiting for a page that is in fact idle. The spinner is
// the page's own statement and cannot leak.
//
// The window matters as much as the check. Sampling once would pass on the
// frame between a click and React mounting the spinner; requiring the page to
// be clear for QUIET_WINDOW_MS means a spinner raised at any point inside it
// resets the clock.
async function waitForQuiet(page) {
  const deadline = Date.now() + ACTION_TIMEOUT_MS;
  let quietSince = null;
  for (;;) {
    if ((await page.$('.spinner')) !== null) {
      quietSince = null;
    } else if (quietSince === null) {
      quietSince = Date.now();
    } else if (Date.now() - quietSince >= QUIET_WINDOW_MS) {
      return;
    }
    if (Date.now() > deadline) {
      throw new Error(`page never went quiet: a loading spinner was still on screen after ${ACTION_TIMEOUT_MS}ms`);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

async function captureShot(page, baseUrl, shot) {
  await page.goto(withCaptureFlag(`${baseUrl}${shot.path}`), { waitUntil: 'domcontentloaded' });
  await page.addStyleTag({ content: DISABLE_MOTION_CSS });

  // A route with no match falls through to the client-side catch-all redirect
  // (`{ path: '*', element: <Navigate to="overview" replace /> }` in App.tsx),
  // which fires from a post-mount effect, not synchronously during navigation.
  // Right after goto() the browser can still be sitting on the stale/bad URL;
  // give React Router's effect a chance to run before reading page.url(), or
  // this check races the redirect and silently passes on a bad path.
  //
  // Checked here, before the steps, and not after them: `path` is the URL this
  // shot navigates to, and the only failure it can describe is a manifest entry
  // pointing at a route that no longer exists. A step is free to navigate
  // somewhere else on purpose (opening a channel pushes a detail route), and
  // running this check afterwards flagged those shots as broken while they were
  // behaving exactly as the manifest asked.
  await page.waitForLoadState('networkidle', { timeout: ACTION_TIMEOUT_MS }).catch(() => {});

  const expectedPathname = new URL(shot.path, baseUrl).pathname;
  const actualPathname = new URL(page.url()).pathname;
  if (actualPathname !== expectedPathname) {
    throw new Error(`shot "${shot.name}" expected path "${expectedPathname}" but the page is at "${actualPathname}": the manifest entry may point at a route that no longer exists`);
  }

  for (const step of shot.steps ?? []) {
    await runStep(page, step);
  }

  await waitForQuiet(page);

  if (shot.waitFor) {
    await page.waitForSelector(shot.waitFor, { state: 'visible', timeout: ACTION_TIMEOUT_MS });
  } else {
    // Authenticated routes render inside <main>; standalone routes (e.g. login) mount
    // straight into #root without a <main> landmark. Either satisfies "the page's main
    // landmark is attached".
    await page.waitForSelector('main, #root', { state: 'attached', timeout: ACTION_TIMEOUT_MS });
  }

  const buffer = await page.screenshot({ fullPage: shot.clip === 'full' });
  await mkdir(assetsDir, { recursive: true });
  await writeFile(path.join(assetsDir, `${shot.name}.png`), buffer);
}

function explainBrowserLaunchError(err) {
  const msg = String(err?.message ?? err);
  if (msg.includes("Executable doesn't exist") || msg.includes('playwright install')) {
    process.stderr.write('Chromium is not installed for Playwright. Run:\n');
    process.stderr.write('npx playwright install chromium\n');
    return true;
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = await loadManifest();

  if (args.list) {
    for (const shot of manifest) process.stdout.write(`${shot.name}\n`);
    process.exitCode = 0;
    return;
  }

  let selected = manifest;
  if (args.only !== null) {
    const requested = args.only.split(',').map((s) => s.trim()).filter(Boolean);
    const byName = new Map(manifest.map((s) => [s.name, s]));
    const unknown = requested.filter((name) => !byName.has(name));
    if (unknown.length > 0) {
      process.stderr.write(`unknown screenshot name(s): ${unknown.join(', ')}\n`);
      process.exitCode = 1;
      return;
    }
    selected = requested.map((name) => byName.get(name));
  }

  let browser;
  try {
    browser = await chromium.launch({
      // Two runs of the same shot differed in exactly twenty pixels, every one
      // of them the antialiasing of a single card's two rounded corners and by
      // one to three units on near-black. That is the rasterizer, not the page:
      // tiled GPU raster may reuse a partially rastered tile and redraw an edge
      // slightly differently. Force the software path and forbid partial raster
      // so identical layout always produces identical bytes.
      args: ['--disable-gpu', '--disable-partial-raster'],
    });
  } catch (err) {
    if (!explainBrowserLaunchError(err)) {
      process.stderr.write(`failed to launch chromium: ${err.message}\n`);
    }
    process.exitCode = 1;
    return;
  }

  let tmpDir;
  let child;
  let catalogServer;
  let mockLlmServer;
  let hadFailure = false;

  try {
    tmpDir = await mkdtemp(path.join(tmpdir(), 'routerly-screenshots-'));
    const { configDir } = await copyFixtures(tmpDir);

    const port = process.env.ROUTERLY_SCREENSHOT_PORT
      ? Number(process.env.ROUTERLY_SCREENSHOT_PORT)
      : DEFAULT_CAPTURE_PORT;
    await patchSettingsPort(configDir, port);

    const mockLlmPort = DEFAULT_MOCK_LLM_PORT;
    mockLlmServer = await startMockLlmServer(mockLlmPort);
    await patchConnectionsEndpoint(configDir, mockLlmPort);

    const catalogPort = await getFreePort();
    catalogServer = await startCatalogServer(catalogPort);
    await patchSettingsProviderRepos(configDir, catalogPort);

    const started = await startService(tmpDir, port);
    child = started.child;
    const baseUrl = started.baseUrl;

    await createFirstAdmin(baseUrl);

    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
      colorScheme: 'dark',
      reducedMotion: 'reduce',
    });

    // Defense-in-depth, browser-side network block: only the throwaway service and the
    // catalog fixture server (both on 127.0.0.1) may be reached. Everything else, Google
    // Fonts included, is aborted so a capture run needs no network access.
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
        await route.continue();
      } else {
        await route.abort();
      }
    });

    // Fixed TOTP secret so the 2FA-setup QR code is byte-identical across runs.
    await context.route('**/api/auth/2fa/setup', async (route) => {
      const response = await route.fetch();
      const json = await response.json();
      json.secret = FIXED_TOTP_SECRET;
      json.qrUrl = `otpauth://totp/Routerly:capture@routerly.local?secret=${FIXED_TOTP_SECRET}&issuer=Routerly`;
      json.backupCodes = FIXED_BACKUP_CODES;
      await route.fulfill({ response, json });
    });

    const page = await context.newPage();

    // Capture unauthenticated routes (e.g. the login page itself) before signing in:
    // once authenticated, /dashboard/login redirects away, so it must not be
    // captured post-login or it would render as the post-login destination instead.
    const preLoginShots = selected.filter((shot) => shot.path === '/dashboard/login');
    const postLoginShots = selected.filter((shot) => shot.path !== '/dashboard/login');

    for (const shot of preLoginShots) {
      try {
        await captureShot(page, baseUrl, shot);
      } catch (err) {
        hadFailure = true;
        process.stderr.write(`shot "${shot.name}" failed: ${err.message}\n`);
      }
    }

    await login(page, baseUrl);

    for (const shot of postLoginShots) {
      try {
        await captureShot(page, baseUrl, shot);
      } catch (err) {
        hadFailure = true;
        process.stderr.write(`shot "${shot.name}" failed: ${err.message}\n`);
      }
    }

    await context.close();
  } catch (err) {
    process.stderr.write(`fatal: ${err.message}\n`);
    process.exitCode = 1;
    return;
  } finally {
    await stopService(child);
    await stopCatalogServer(catalogServer);
    await stopMockLlmServer(mockLlmServer);
    await browser.close();
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  }

  process.exitCode = hadFailure ? 1 : 0;
}

main();
