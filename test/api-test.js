#!/usr/bin/env node
/**
 * LocalRouter API Test Script
 *
 * Usage:
 *   node test/api-test.js --token=sk-rt-<your-project-token> [options]
 *
 * Options:
 *   --token=<project-token>   Project token for /v1/* LLM proxy routes (required)
 *   --admin-email=<email>     Admin email (enables /api/* dashboard API tests)
 *   --admin-password=<pass>   Admin password (required if --admin-email is set)
 *   --base-url=<url>          Base URL of the service (default: http://localhost:3000)
 *   --concurrency=<n>         Number of parallel requests in concurrency test (default: 5)
 *   --help                    Show this help message
 *
 * Examples:
 *   node test/api-test.js --token=sk-rt-abc123
 *   node test/api-test.js --token=sk-rt-abc123 --admin-email=admin@example.com --admin-password=secret
 *   node test/api-test.js --token=sk-rt-abc123 --base-url=http://localhost:4000 --concurrency=10
 *
 * Environment variables:
 *   LOCALROUTER_TOKEN          Alternative to --token
 *   LOCALROUTER_ADMIN_EMAIL    Alternative to --admin-email
 *   LOCALROUTER_ADMIN_PASSWORD Alternative to --admin-password
 *   LOCALROUTER_BASE_URL       Alternative to --base-url
 */

// ─── ANSI colors ──────────────────────────────────────────────────────────────
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  green:  '\x1b[32m',
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  gray:   '\x1b[90m',
  blue:   '\x1b[34m',
  magenta:'\x1b[35m',
};

// ─── Parse CLI args ───────────────────────────────────────────────────────────
function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (const arg of args) {
    if (arg === '--help' || arg === '-h') {
      console.log(process.argv[1].split('/').pop() + ' usage:');
      console.log('  --token=<project-token>   Project token for /v1/* routes (required)');
      console.log('  --admin-email=<email>     Admin email for /api/* tests');
      console.log('  --admin-password=<pass>   Admin password');
      console.log('  --base-url=<url>          Base URL (default: http://localhost:3000)');
      console.log('  --concurrency=<n>         Parallel requests in concurrency test (default: 5)');
      process.exit(0);
    }
    const match = arg.match(/^--([a-z-]+)=(.+)$/);
    if (match) {
      result[match[1]] = match[2];
    }
  }
  return result;
}

const cliArgs = parseArgs();

const BASE_URL       = cliArgs['base-url']        ?? process.env['LOCALROUTER_BASE_URL']       ?? 'http://localhost:3000';
const PROJECT_TOKEN  = cliArgs['token']            ?? process.env['LOCALROUTER_TOKEN']          ?? '';
const ADMIN_EMAIL    = cliArgs['admin-email']      ?? process.env['LOCALROUTER_ADMIN_EMAIL']    ?? '';
const ADMIN_PASSWORD = cliArgs['admin-password']   ?? process.env['LOCALROUTER_ADMIN_PASSWORD'] ?? '';
const CONCURRENCY    = parseInt(cliArgs['concurrency'] ?? process.env['LOCALROUTER_CONCURRENCY'] ?? '5', 10);

if (!PROJECT_TOKEN) {
  console.error(`${C.red}${C.bold}Error:${C.reset} --token is required.\n`);
  console.error('Usage: node test/api-test.js --token=sk-rt-<your-project-token>');
  console.error('       node test/api-test.js --help');
  process.exit(1);
}

// ─── Test runner ──────────────────────────────────────────────────────────────
let passed = 0;
let failed = 0;
let skipped = 0;

function header(title) {
  console.log(`\n${C.bold}${C.blue}━━━ ${title} ━━━${C.reset}`);
}

async function test(name, fn) {
  process.stdout.write(`  ${C.gray}▶${C.reset} ${name} ... `);
  try {
    const result = await fn();
    passed++;
    console.log(`${C.green}✓ PASS${C.reset}${result ? ` ${C.gray}(${result})${C.reset}` : ''}`);
  } catch (err) {
    failed++;
    console.log(`${C.red}✗ FAIL${C.reset}`);
    console.log(`      ${C.red}${err.message}${C.reset}`);
  }
}

function skip(name, reason) {
  skipped++;
  console.log(`  ${C.yellow}⊘${C.reset} ${name} ${C.yellow}[skipped: ${reason}]${C.reset}`);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertStatus(res, expected) {
  assert(res.status === expected, `Expected HTTP ${expected}, got ${res.status}`);
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
async function get(path, headers = {}) {
  return fetch(`${BASE_URL}${path}`, { method: 'GET', headers });
}

async function post(path, body, headers = {}) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function put(path, body, headers = {}) {
  return fetch(`${BASE_URL}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

async function del(path, headers = {}) {
  return fetch(`${BASE_URL}${path}`, { method: 'DELETE', headers });
}

function bearerHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// ─── SSE stream consumer ──────────────────────────────────────────────────────
// Returns { events, traceId } — consumeSSE reads the full body text
async function consumeSSE(res) {
  const traceId = res.headers.get('x-routerly-trace-id') ?? null;
  const events = [];
  const text = await res.text();
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      try {
        events.push(JSON.parse(data));
      } catch {
        // ignore non-JSON data lines
      }
    }
  }
  return { events, traceId };
}

// ─── Inline prompt for a routing test call ────────────────────────────────────
function chatPayload(content = 'Ping.', maxTokens = 10) {
  return {
    model: 'auto',
    messages: [{ role: 'user', content }],
    max_tokens: maxTokens,
    stream: true,
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`${C.bold}LocalRouter API Test${C.reset}`);
  console.log(`${C.gray}Base URL    : ${BASE_URL}${C.reset}`);
  console.log(`${C.gray}Token       : ${PROJECT_TOKEN.substring(0, 14)}...${C.reset}`);
  console.log(`${C.gray}Concurrency : ${CONCURRENCY}${C.reset}`);
  if (ADMIN_EMAIL) {
    console.log(`${C.gray}Admin       : ${ADMIN_EMAIL}${C.reset}`);
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. HEALTH CHECK
  // ══════════════════════════════════════════════════════════════════════════════
  header('1 · Health Check');

  // Checks that the service is running and responds with { status: "ok" }.
  // Returns version and uptime for a quick visual sanity check.
  await test('GET /health → 200 with status:ok', async () => {
    const res = await get('/health');
    assertStatus(res, 200);
    const body = await res.json();
    assert(body.status === 'ok', `Expected status "ok", got "${body.status}"`);
    return `version: ${body.version}, uptime: ${body.uptimeSeconds ?? '?'}s`;
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. AUTH GUARD
  // ══════════════════════════════════════════════════════════════════════════════
  header('2 · Auth Guard');

  // Request with no Authorization header: must be rejected with 401.
  await test('POST /v1/chat/completions without token → 401', async () => {
    const res = await post('/v1/chat/completions', chatPayload());
    assertStatus(res, 401);
  });

  // Same guard on the Anthropic endpoint: no token → 401.
  await test('POST /v1/messages without token → 401', async () => {
    const res = await post('/v1/messages', { model: 'auto', messages: [], max_tokens: 10 });
    assertStatus(res, 401);
  });

  // Syntactically valid token that is not registered: must return 401.
  await test('POST /v1/chat/completions with wrong token → 401', async () => {
    const res = await post('/v1/chat/completions', chatPayload(), bearerHeader('sk-rt-bad-token-000'));
    assertStatus(res, 401);
  });

  // Ensures admin /api/* routes also require authentication.
  await test('GET /api/models without token → 401', async () => {
    const res = await get('/api/models');
    assertStatus(res, 401);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. LLM PROXY — ROUTING CORE (single request + SSE inspection)
  // ══════════════════════════════════════════════════════════════════════════════
  header('3 · LLM Proxy Core — SSE & Routing Trace (OpenAI format)');

  let capturedTraceId = null;

  // Checks that the response is HTTP 200 with Content-Type text/event-stream
  // and that the x-routerly-trace-id header is present for tracing.
  await test('POST /v1/chat/completions → HTTP 200, Content-Type: text/event-stream', async () => {
    const res = await post('/v1/chat/completions', chatPayload(), bearerHeader(PROJECT_TOKEN));
    assertStatus(res, 200);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/event-stream'), `Expected SSE content-type, got "${ct}"`);
    capturedTraceId = res.headers.get('x-routerly-trace-id');
    assert(capturedTraceId, 'Missing x-routerly-trace-id header');
    await res.body?.cancel(); // discard body — we captured traceId
    return `trace-id: ${capturedTraceId.substring(0, 8)}...`;
  });

  // Verifies the SSE stream contains at least one parseable JSON event
  // (e.g. trace, result, or text chunk produced by the model).
  await test('POST /v1/chat/completions → SSE stream contains events', async () => {
    const res = await post('/v1/chat/completions', chatPayload('Say hello.', 20), bearerHeader(PROJECT_TOKEN));
    assertStatus(res, 200);
    const { events, traceId } = await consumeSSE(res);
    assert(events.length > 0, 'Expected at least one SSE event, got none');
    capturedTraceId = capturedTraceId ?? traceId;
    const types = [...new Set(events.map(e => e.type ?? 'chunk'))];
    return `${events.length} events · types: [${types.join(', ')}]`;
  });

  // Verifies that the SSE stream contains type:"trace" events covering at least
  // one of the expected panels (router-request, router-response, request, response),
  // confirming that routing trace data is forwarded to the client.
  await test('POST /v1/chat/completions → SSE contains "trace" events with correct panels', async () => {
    const res = await post('/v1/chat/completions', chatPayload('Routing test.', 15), bearerHeader(PROJECT_TOKEN));
    assertStatus(res, 200);
    const { events, traceId } = await consumeSSE(res);
    capturedTraceId = traceId ?? capturedTraceId;

    const traceEvents = events.filter(e => e.type === 'trace');
    assert(traceEvents.length > 0, 'Expected at least one type:"trace" SSE event');

    const panels = new Set(traceEvents.map(e => e.entry?.panel));
    const knownPanels = ['router-request', 'router-response', 'request', 'response'];
    const foundKnown = knownPanels.filter(p => panels.has(p));
    assert(foundKnown.length > 0, `No known panels found. Got: ${[...panels].join(', ')}`);

    return `${traceEvents.length} trace events · panels: [${[...panels].join(', ')}]`;
  });

  // Verifies the stream contains a routing result event listing the selected candidates
  // (either a type:"result" event or a trace with message "router:result"),
  // including the model name and weight for each candidate.
  await test('POST /v1/chat/completions → routing "result" candidates present', async () => {
    const res = await post('/v1/chat/completions', chatPayload('What is 2+2?', 10), bearerHeader(PROJECT_TOKEN));
    assertStatus(res, 200);
    const { events, traceId } = await consumeSSE(res);
    capturedTraceId = traceId ?? capturedTraceId;

    // Either a 'result' type event (no-model-call path) OR trace events with router:result message
    const resultEvent = events.find(e => e.type === 'result');
    const routerResultTrace = events.find(
      e => e.type === 'trace' && e.entry?.message === 'router:result'
    );

    assert(resultEvent || routerResultTrace, 'No routing result found in SSE stream');

    const candidates = resultEvent?.candidates ?? routerResultTrace?.entry?.details?.final ?? [];
    if (candidates.length > 0) {
      const top = candidates[0];
      return `top model: ${top.model}, weight: ${top.weight}, ${candidates.length} candidate(s)`;
    }
    return 'routing result present';
  });

  // ── OpenAI Responses API ─────────────────────────────────────────────────
  header('4 · LLM Proxy — OpenAI /v1/responses');

  // Verifies the Responses API accepts the "input" field (instead of "messages")
  // and still replies with a valid SSE stream.
  await test('POST /v1/responses with input field → SSE stream', async () => {
    const res = await post(
      '/v1/responses',
      { model: 'auto', input: [{ role: 'user', content: 'Ping.' }], max_output_tokens: 10 },
      bearerHeader(PROJECT_TOKEN),
    );
    assertStatus(res, 200);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/event-stream'), `Expected SSE, got "${ct}"`);
    const { events } = await consumeSSE(res);
    assert(events.length > 0, 'Expected at least one SSE event');
    return `${events.length} event(s)`;
  });

  // Checks backwards compatibility: the service must accept the legacy "max_tokens"
  // field and normalise it internally to "max_output_tokens".
  await test('POST /v1/responses with max_tokens → normalized as max_output_tokens', async () => {
    // Server should accept max_tokens and internally map it
    const res = await post(
      '/v1/responses',
      { model: 'auto', input: [{ role: 'user', content: 'Ping.' }], max_tokens: 10 },
      bearerHeader(PROJECT_TOKEN),
    );
    assertStatus(res, 200);
    await res.body?.cancel();
  });

  // ── Anthropic format ─────────────────────────────────────────────────────
  header('5 · LLM Proxy — Anthropic /v1/messages');

  // Verifies the Anthropic endpoint returns SSE with the x-routerly-trace-id header
  // and that the stream contains at least one parseable event.
  await test('POST /v1/messages with valid token → SSE stream + trace-id', async () => {
    const res = await post(
      '/v1/messages',
      { model: 'auto', messages: [{ role: 'user', content: 'Say hello.' }], max_tokens: 20 },
      bearerHeader(PROJECT_TOKEN),
    );
    assertStatus(res, 200);
    const ct = res.headers.get('content-type') ?? '';
    assert(ct.includes('text/event-stream'), `Expected SSE, got "${ct}"`);
    const traceId = res.headers.get('x-routerly-trace-id');
    assert(traceId, 'Missing x-routerly-trace-id header');
    const { events } = await consumeSSE(res);
    assert(events.length > 0, 'Expected SSE events');
    return `trace-id: ${traceId.substring(0, 8)}... · ${events.length} event(s)`;
  });

  // Verifies the Anthropic stream also includes routing metadata
  // (type:"trace" or type:"result" events) in addition to response chunks.
  await test('POST /v1/messages → SSE contains routing trace or result', async () => {
    const res = await post(
      '/v1/messages',
      { model: 'auto', messages: [{ role: 'user', content: 'Routing test.' }], max_tokens: 10 },
      bearerHeader(PROJECT_TOKEN),
    );
    assertStatus(res, 200);
    const { events } = await consumeSSE(res);
    const hasTrace  = events.some(e => e.type === 'trace');
    const hasResult = events.some(e => e.type === 'result');
    assert(hasTrace || hasResult, 'Expected type:"trace" or type:"result" events');
    return `trace: ${hasTrace}, result: ${hasResult}`;
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. CONCURRENCY — parallel requests
  // ══════════════════════════════════════════════════════════════════════════════
  header(`6 · Concurrency — ${CONCURRENCY} parallel requests`);

  // Fires CONCURRENCY requests simultaneously: all must complete with HTTP 200.
  // Validates server stability under parallel load.
  await test(`POST /v1/chat/completions × ${CONCURRENCY} in parallel → all 200`, async () => {
    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        post(
          '/v1/chat/completions',
          chatPayload(`Parallel request ${i + 1}. Say "ok".`, 10),
          bearerHeader(PROJECT_TOKEN),
        )
      )
    );
    const elapsed = Date.now() - start;
    const statuses = results.map(r => r.status);
    const failures = statuses.filter(s => s !== 200);
    assert(failures.length === 0, `${failures.length}/${CONCURRENCY} requests failed: [${failures.join(', ')}]`);
    // drain bodies
    await Promise.all(results.map(r => r.body?.cancel()));
    return `all ${CONCURRENCY} returned 200 in ${elapsed}ms`;
  });

  // Each concurrent request must receive its own unique trace ID
  // in the x-routerly-trace-id header, with no collisions.
  await test(`${CONCURRENCY} parallel requests → all get unique trace IDs`, async () => {
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        post('/v1/chat/completions', chatPayload(`Unique trace ${i}.`, 5), bearerHeader(PROJECT_TOKEN))
      )
    );
    const traceIds = results.map(r => r.headers.get('x-routerly-trace-id'));
    await Promise.all(results.map(r => r.body?.cancel()));

    const nullCount = traceIds.filter(id => !id).length;
    assert(nullCount === 0, `${nullCount} requests missing x-routerly-trace-id`);

    const unique = new Set(traceIds);
    assert(unique.size === CONCURRENCY, `Expected ${CONCURRENCY} unique trace IDs, got ${unique.size}`);
    return `${unique.size} distinct trace IDs`;
  });

  // Mix of OpenAI and Anthropic requests in parallel: both formats must be
  // handled simultaneously without interfering with each other.
  await test(`${CONCURRENCY} parallel OpenAI + Anthropic mixed → all succeed`, async () => {
    const half = Math.floor(CONCURRENCY / 2);
    const openaiReqs = Array.from({ length: half }, () =>
      post('/v1/chat/completions', chatPayload('OpenAI mixed.', 5), bearerHeader(PROJECT_TOKEN))
    );
    const anthropicReqs = Array.from({ length: CONCURRENCY - half }, () =>
      post('/v1/messages', { model: 'auto', messages: [{ role: 'user', content: 'Anthropic mixed.' }], max_tokens: 5 }, bearerHeader(PROJECT_TOKEN))
    );
    const all = await Promise.all([...openaiReqs, ...anthropicReqs]);
    const failures = all.filter(r => r.status !== 200);
    await Promise.all(all.map(r => r.body?.cancel()));
    assert(failures.length === 0, `${failures.length} mixed requests failed`);
    return `${half} openai + ${CONCURRENCY - half} anthropic all 200`;
  });

  // Three SSE streams opened in parallel must be fully independent:
  // distinct trace IDs and no event leakage between streams.
  await test('Concurrent requests produce independent SSE streams (no cross-contamination)', async () => {
    const prompts = ['Alpha', 'Beta', 'Gamma'];
    const responses = await Promise.all(
      prompts.map(p => post('/v1/chat/completions', chatPayload(p, 5), bearerHeader(PROJECT_TOKEN)))
    );
    const streams = await Promise.all(responses.map(r => consumeSSE(r)));

    // Each stream must have its own unique traceId
    const traceIds = streams.map(s => s.traceId);
    const unique = new Set(traceIds.filter(Boolean));
    assert(unique.size === prompts.length, `Expected ${prompts.length} unique trace IDs, got ${unique.size}: ${traceIds.join(', ')}`);

    // Each stream must have at least one event
    for (let i = 0; i < streams.length; i++) {
      assert(streams[i].events.length > 0, `Stream ${i} ("${prompts[i]}") has no events`);
    }
    return `3 streams · trace IDs: ${[...unique].map(id => id.substring(0,6)).join(' | ')}`;
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. ADMIN API (requires --admin-email and --admin-password)
  // ══════════════════════════════════════════════════════════════════════════════
  header('7 · Admin Auth');

  let adminToken = null;

  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    const adminTests = [
      'POST /api/auth/login',
      'POST /api/auth/login wrong password → 401',
      'GET  /api/models → array',
      'GET  /api/models → no apiKey in response',
      'GET  /api/users → no passwordHash',
      'GET  /api/me',
      'GET  /api/usage summary',
      'GET  /api/system/info',
      'GET  /api/settings',
      'Project lifecycle: create → update → add token → use token → delete',
      'GET  /api/traces/:id (after routing call)',
      'GET  /api/usage/:id (single record)',
    ];
    for (const name of adminTests) skip(name, 'provide --admin-email and --admin-password');
  } else {
    // Login with valid credentials: must return a JWT and the user object.
    // The token is saved for subsequent admin tests.
    await test('POST /api/auth/login with valid credentials → JWT token', async () => {
      const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
      assertStatus(res, 200);
      const body = await res.json();
      assert(typeof body.token === 'string', 'Expected string token');
      assert(body.user?.email === ADMIN_EMAIL, `Expected email "${ADMIN_EMAIL}"`);
      adminToken = body.token;
      return `role: ${body.user.role}`;
    });

    // Wrong password: login must be rejected with 401.
    await test('POST /api/auth/login with wrong password → 401', async () => {
      const res = await post('/api/auth/login', { email: ADMIN_EMAIL, password: '__wrong__' });
      assertStatus(res, 401);
    });

    if (adminToken) {
      const adminHdr = bearerHeader(adminToken);

      // ── Models ──────────────────────────────────────────────────────────────
      header('8 · Admin API — Models');

      let availableModels = [];

      // Fetches the full list of configured models.
      // Stores the result in availableModels for use by later tests (e.g. section 10).
      await test('GET /api/models → array', async () => {
        const res = await get('/api/models', adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(Array.isArray(body), 'Expected array');
        availableModels = body;
        return `${body.length} model(s)`;
      });

      // Ensures provider API keys are never exposed in any model response.
      await test('GET /api/models → no apiKey in response', async () => {
        const res = await get('/api/models', adminHdr);
        const models = await res.json();
        const exposed = models.filter(m => m.apiKey !== undefined);
        assert(exposed.length === 0, `${exposed.length} model(s) leak apiKey`);
      });

      // ── Users ────────────────────────────────────────────────────────────────
      header('9 · Admin API — Users & Me');

      // User list: must be an array and must not include the passwordHash field.
      await test('GET /api/users → array without passwordHash', async () => {
        const res = await get('/api/users', adminHdr);
        assertStatus(res, 200);
        const users = await res.json();
        assert(Array.isArray(users), 'Expected array');
        const leaked = users.filter(u => u.passwordHash !== undefined);
        assert(leaked.length === 0, `${leaked.length} user(s) leak passwordHash`);
        return `${users.length} user(s)`;
      });

      // Authenticated user profile: the email must match the one used to log in.
      await test('GET /api/me → returns own email', async () => {
        const res = await get('/api/me', adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(body.email === ADMIN_EMAIL, `Expected ${ADMIN_EMAIL}, got ${body.email}`);
        return `id: ${body.id?.substring(0, 8)}...`;
      });

      // ── Projects lifecycle ───────────────────────────────────────────────────
      header('10 · Admin API — Project Lifecycle');

      let testProjectId   = null;
      let testProjectName = `__test_${Date.now()}__`;
      let testToken2      = null;  // second token created on the test project
      let testTokenId2    = null;

      // Creates a temporary project with a timestamp-based unique name.
      // The response must include an id, a default token, and the raw token value (returned only at creation time).
      await test('POST /api/projects → create test project', async () => {
        const res = await post('/api/projects', { name: testProjectName }, adminHdr);
        assertStatus(res, 201);
        const body = await res.json();
        assert(body.id,              'Expected project id');
        assert(body.name === testProjectName, `Expected name "${testProjectName}"`);
        assert(Array.isArray(body.tokens), 'Expected tokens array');
        assert(body.tokens.length === 1,   'Expected one default token');
        assert(typeof body.token === 'string', 'Expected raw token returned on creation');
        testProjectId = body.id;
        return `id: ${testProjectId.substring(0, 8)}...`;
      });

      // Verifies the newly created project appears in the list and that
      // raw token values are not exposed in the listing response.
      await test('GET /api/projects → new project present in list', async () => {
        const res = await get('/api/projects', adminHdr);
        assertStatus(res, 200);
        const projects = await res.json();
        const found = projects.find(p => p.id === testProjectId);
        assert(found, `Project ${testProjectId} not found in list`);
        // verify token is NOT leaked in list response
        for (const t of found.tokens ?? []) {
          assert(t.token === undefined, 'token should not be exposed in list');
        }
        return 'found in project list, no token leak';
      });

      // Renames the project and enables autoRouting with one assigned model.
      // The response body must reflect the new name.
      await test('PUT /api/projects/:id → rename project', async () => {
        if (!testProjectId) throw new Error('No project ID from previous step');
        const newName = testProjectName + '_renamed';
        const res = await put(
          `/api/projects/${testProjectId}`,
          { name: newName, autoRouting: true, models: availableModels.slice(0, 1).map(m => ({ modelId: m.id })) },
          adminHdr,
        );
        assertStatus(res, 200);
        const body = await res.json();
        assert(body.name === newName, `Expected name "${newName}", got "${body.name}"`);
        testProjectName = newName;
        return `renamed to "${newName}"`;
      });

      // Adds a second token to the project with a custom label.
      // The raw token value is saved for subsequent tests.
      await test('POST /api/projects/:id/tokens → add a second token', async () => {
        if (!testProjectId) throw new Error('No project ID');
        const res = await post(`/api/projects/${testProjectId}/tokens`, { labels: ['test-label'] }, adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(typeof body.token === 'string', 'Expected raw token string');
        assert(body.tokenInfo?.id, 'Expected tokenInfo.id');
        testToken2   = body.token;
        testTokenId2 = body.tokenInfo.id;
        return `token: ${testToken2.substring(0, 14)}... · id: ${testTokenId2.substring(0, 8)}...`;
      });

      // Uses the newly created second token to make a real LLM call:
      // it must succeed and return a valid SSE stream.
      await test('Use second project token → POST /v1/chat/completions → 200', async () => {
        if (!testToken2) throw new Error('No second token');
        const res = await post('/v1/chat/completions', chatPayload('Token test.', 5), bearerHeader(testToken2));
        assertStatus(res, 200);
        const ct = res.headers.get('content-type') ?? '';
        assert(ct.includes('text/event-stream'), `Expected SSE, got "${ct}"`);
        await res.body?.cancel();
      });

      // Revokes the second token: response must be 204 No Content.
      await test('DELETE /api/projects/:id/tokens/:tokenId → revoke second token', async () => {
        if (!testProjectId || !testTokenId2) throw new Error('Missing IDs');
        const res = await del(`/api/projects/${testProjectId}/tokens/${testTokenId2}`, adminHdr);
        assertStatus(res, 204);
      });

      // The just-revoked token must be immediately rejected with 401.
      await test('Use revoked token → POST /v1/chat/completions → 401', async () => {
        if (!testToken2) throw new Error('No revoked token');
        const res = await post('/v1/chat/completions', chatPayload('Revoked.', 5), bearerHeader(testToken2));
        assertStatus(res, 401);
      });

      // Deletes the test project: response must be 204 No Content.
      await test('DELETE /api/projects/:id → delete test project', async () => {
        if (!testProjectId) throw new Error('No project ID');
        const res = await del(`/api/projects/${testProjectId}`, adminHdr);
        assertStatus(res, 204);
      });

      // Verifies the deleted project no longer appears in the list.
      await test('GET /api/projects → test project no longer in list', async () => {
        const res = await get('/api/projects', adminHdr);
        assertStatus(res, 200);
        const projects = await res.json();
        const found = projects.find(p => p.id === testProjectId);
        assert(!found, `Deleted project ${testProjectId} still appears in list`);
      });

      // ── Trace lookup ─────────────────────────────────────────────────────────
      header('11 · Admin API — Trace & Usage');

      // Fires a real LLM request, then fetches its trace via the API:
      // must return a non-empty array with the expected panels.
      await test('GET /api/traces/:id → returns trace for recent request', async () => {
        // fire a fresh request to get a fresh trace ID
        const r = await post('/v1/chat/completions', chatPayload('trace lookup test', 10), bearerHeader(PROJECT_TOKEN));
        assertStatus(r, 200);
        const traceId = r.headers.get('x-routerly-trace-id');
        assert(traceId, 'Missing trace-id header');
        await consumeSSE(r); // drain stream so trace is fully written

        const res = await get(`/api/traces/${traceId}`, adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(Array.isArray(body.trace), 'Expected trace array');
        assert(body.trace.length > 0, 'Expected non-empty trace');
        const panels = [...new Set(body.trace.map(e => e.panel))];
        return `${body.trace.length} entries · panels: [${panels.join(', ')}]`;
      });

      // Non-existent trace ID: must return 404.
      await test('GET /api/traces/:id → 404 for unknown id', async () => {
        const res = await get('/api/traces/00000000-0000-0000-0000-000000000000', adminHdr);
        assertStatus(res, 404);
      });

      // Validates the /api/usage response structure:
      // must include summary (totalCost, totalCalls), records array, and timeline array.
      await test('GET /api/usage → summary object with correct fields', async () => {
        const res = await get('/api/usage', adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(typeof body.summary === 'object',          'Expected summary object');
        assert(typeof body.summary.totalCost === 'number','Expected summary.totalCost');
        assert(typeof body.summary.totalCalls === 'number','Expected summary.totalCalls');
        assert(Array.isArray(body.records),               'Expected records array');
        assert(Array.isArray(body.timeline),              'Expected timeline array');
        return `calls: ${body.summary.totalCalls} · cost: $${body.summary.totalCost.toFixed(6)}`;
      });

      // Usage records must not expose the "trace" field (internal routing data).
      await test('GET /api/usage → records have no trace field (stripped)', async () => {
        const res = await get('/api/usage', adminHdr);
        const body = await res.json();
        const withTrace = body.records.filter(r => r.trace !== undefined);
        assert(withTrace.length === 0, `${withTrace.length} usage records leak trace data`);
      });

      // A malformed JWT must be rejected with 401 on all admin endpoints.
      await test('GET /api/usage with invalid token → 401', async () => {
        const res = await get('/api/usage', bearerHeader('bad.token'));
        assertStatus(res, 401);
      });

      if (adminToken) {
        // Non-existent usage record ID: must return 404.
        await test('GET /api/usage/:id → 404 for unknown record', async () => {
          const res = await get('/api/usage/nonexistent-id-000', adminHdr);
          assertStatus(res, 404);
        });
      }

      // ── System info & settings ───────────────────────────────────────────────
      header('12 · Admin API — System Info & Settings');

      // Checks the system endpoint returns version, Node.js version, and uptime.
      await test('GET /api/system/info → version and platform info', async () => {
        const res = await get('/api/system/info', adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(body.version,           'Expected version field');
        assert(body.nodeVersion,        'Expected nodeVersion field');
        assert(typeof body.uptimeSeconds === 'number', 'Expected uptimeSeconds');
        return `node: ${body.nodeVersion} · uptime: ${body.uptimeSeconds}s`;
      });

      // Checks that runtime settings (port, log level, etc.) are exposed correctly.
      await test('GET /api/settings → settings object with port field', async () => {
        const res = await get('/api/settings', adminHdr);
        assertStatus(res, 200);
        const body = await res.json();
        assert(typeof body.port === 'number', `Expected port number, got ${typeof body.port}`);
        assert(typeof body.logLevel === 'string', 'Expected logLevel string');
        return `port: ${body.port} · logLevel: ${body.logLevel}`;
      });
    }
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 13. SETUP API
  // ══════════════════════════════════════════════════════════════════════════════
  header('13 · Setup API');

  // Checks whether the setup endpoint correctly reports if the service still
  // requires initial configuration (first run) or is already operational.
  await test('GET /api/setup/status → needsSetup boolean', async () => {
    const res = await get('/api/setup/status');
    assertStatus(res, 200);
    const body = await res.json();
    assert(typeof body.needsSetup === 'boolean', 'Expected needsSetup boolean');
    return `needsSetup: ${body.needsSetup}`;
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ══════════════════════════════════════════════════════════════════════════════
  const total  = passed + failed + skipped;
  const status = failed > 0 ? `${C.red}${C.bold}FAILED` : `${C.green}${C.bold}PASSED`;

  console.log(`\n${C.bold}━━━ Results ━━━${C.reset}`);
  console.log(`  ${C.green}✓ Passed ${C.reset}: ${passed}`);
  if (failed  > 0) console.log(`  ${C.red}✗ Failed ${C.reset}: ${failed}`);
  if (skipped > 0) console.log(`  ${C.yellow}⊘ Skipped${C.reset}: ${skipped}`);
  console.log(`  ${C.gray}  Total  ${C.reset}: ${total}`);
  console.log(`\n  ${status}${C.reset}\n`);

  process.exit(failed > 0 ? 1 : 0);
})();
