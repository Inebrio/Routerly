#!/usr/bin/env node
/**
 * Official provider mocks for UAT and automated tests (ROUT-401).
 *
 * One HTTP server, path-routed, imitating the upstream endpoints Routerly's adapters call:
 *   claude.ai (anthropic-web), chatgpt.com (openai-web), Azure OpenAI, AWS Bedrock Converse, Vertex AI (OpenAI-compatible).
 * Point a connection at it with `--endpoint http://127.0.0.1:4010` and a credential starting with `mock-`.
 *
 * The behaviour is picked by the credential, so each connection selects its own mode:
 *   mock-*        success          mock-429  rate limit (Retry-After: 30)
 *   mock-403      forbidden (Cloudflare challenge page for chatgpt.com)   mock-401  unauthorized
 *   mock-500      server error     mock-cut  stream interrupted after the first chunk
 * Any credential not starting with `mock-` gets 401, so a real key can never be mistaken for a pass.
 *
 * Limits: replies are canned; real credentials, sessions and anti-bot defences are NOT validated.
 * `GET /__mock/requests` lists the recorded requests (secrets masked), `DELETE` clears them.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const REPLY = ['Hello', ' from', ' the', ' provider', ' mock'];
const TEXT = REPLY.join('');
const CLOUDFLARE_HTML =
  '<!DOCTYPE html><html><head><title>Just a moment...</title></head><body>Enable JavaScript and cookies to continue (Cloudflare challenge, provider-mock)</body></html>';

// ── helpers ────────────────────────────────────────────────────────────────

const mode = (cred) => {
  if (!cred.startsWith('mock-')) return 'unauthorized';
  for (const m of ['429', '403', '401', '500', 'cut']) if (cred.includes(`mock-${m}`)) return m;
  return 'ok';
};

const mask = (v) => (typeof v === 'string' && v.length > 8 ? `${v.slice(0, 9)}***` : v);
const SECRET_HEADERS = new Set(['authorization', 'cookie', 'api-key', 'x-amz-security-token']);

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  try { return raw ? JSON.parse(raw) : undefined; } catch { return raw; }
}

function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

function sseStart(res) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
}

/** Write one chunk, then (mock-cut) drop the connection so the client sees an interrupted stream. */
function cut(res) {
  setTimeout(() => res.destroy(), 30);
}

// ── CRC32 + Amazon event-stream frames (Bedrock ConverseStream) ───────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function eventFrame(eventType, payload) {
  const hdr = (name, value) => {
    const n = Buffer.from(name), v = Buffer.from(value);
    const len = Buffer.alloc(2); len.writeUInt16BE(v.length);
    return Buffer.concat([Buffer.from([n.length]), n, Buffer.from([7]), len, v]);
  };
  const headers = Buffer.concat([
    hdr(':event-type', eventType), hdr(':content-type', 'application/json'), hdr(':message-type', 'event'),
  ]);
  const body = Buffer.from(JSON.stringify(payload));
  const total = 12 + headers.length + body.length + 4;
  const prelude = Buffer.alloc(8);
  prelude.writeUInt32BE(total, 0); prelude.writeUInt32BE(headers.length, 4);
  const preludeCrc = Buffer.alloc(4); preludeCrc.writeUInt32BE(crc32(prelude));
  const msg = Buffer.concat([prelude, preludeCrc, headers, body]);
  const msgCrc = Buffer.alloc(4); msgCrc.writeUInt32BE(crc32(msg));
  return Buffer.concat([msg, msgCrc]);
}

// ── per-provider handlers ─────────────────────────────────────────────────

function openAIChat(res, body, m, model) {
  const id = `chatcmpl-${randomUUID()}`, created = Math.floor(Date.now() / 1000);
  if (!body?.stream) {
    return json(res, 200, {
      id, object: 'chat.completion', created, model,
      choices: [{ index: 0, message: { role: 'assistant', content: TEXT }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 7, completion_tokens: 5, total_tokens: 12 },
    });
  }
  sseStart(res);
  const chunk = (delta, finish) => `data: ${JSON.stringify({
    id, object: 'chat.completion.chunk', created, model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
  res.write(chunk({ role: 'assistant', content: REPLY[0] }, null));
  if (m === 'cut') return cut(res);
  for (const t of REPLY.slice(1)) res.write(chunk({ content: t }, null));
  res.write(chunk({}, 'stop'));
  res.end('data: [DONE]\n\n');
}

function openAIError(res, m) {
  const map = {
    '429': [429, 'rate_limit_exceeded', 'Rate limit reached. Retry later.', { 'retry-after': '30' }],
    '403': [403, 'permission_denied', 'Forbidden (provider-mock).', {}],
    '401': [401, 'invalid_api_key', 'Incorrect API key provided (provider-mock).', {}],
    '500': [500, 'server_error', 'The server had an error (provider-mock).', {}],
    unauthorized: [401, 'invalid_api_key', 'Incorrect API key provided: not a provider-mock credential.', {}],
  }[m];
  json(res, map[0], { error: { message: map[2], type: map[1], code: map[1] } }, map[3]);
}

const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');

function claudeWeb(req, res, url, body) {
  const cookie = /(?:^|;\s*)sessionKey=([^;]*)/.exec(req.headers.cookie ?? '')?.[1] ?? '';
  const m = mode(cookie);
  const err = (status, type, message, h = {}) => json(res, status, { type: 'error', error: { type, message } }, h);
  if (m === 'unauthorized' || m === '401') return err(401, 'authentication_error', 'Invalid authorization (provider-mock)');
  if (m === '403') return err(403, 'permission_error', 'Account blocked (provider-mock)');
  const p = url.pathname;
  if (req.method === 'GET' && p === '/api/organizations') return json(res, 200, [{ uuid: 'org-mock-0001', name: 'provider-mock' }]);
  const conv = /^\/api\/organizations\/([^/]+)\/chat_conversations(?:\/([^/]+)(\/completion)?)?$/.exec(p);
  if (!conv) return json(res, 404, { error: 'not found' });
  if (req.method === 'POST' && !conv[2]) return json(res, 201, { uuid: `conv-${randomUUID()}`, name: '' });
  if (req.method === 'DELETE' && conv[2] && !conv[3]) { res.writeHead(204); return res.end(); }
  if (req.method === 'POST' && conv[3]) {
    if (m === '429') return err(429, 'rate_limit_error', 'Rate limit exceeded (provider-mock)', { 'retry-after': '30' });
    if (m === '500') return err(500, 'api_error', 'Internal error (provider-mock)');
    sseStart(res);
    const ev = (d) => `event: completion\ndata: ${JSON.stringify({ type: 'completion', completion: d, stop_reason: null, model: body?.model ?? 'claude-mock', log_id: 'mock' })}\n\n`;
    res.write(ev(REPLY[0]));
    if (m === 'cut') return cut(res);
    for (const t of REPLY.slice(1)) res.write(ev(t));
    return res.end('event: message_stop\ndata: {"type":"message_stop"}\n\n');
  }
  json(res, 405, { error: 'method not allowed' });
}

function chatgptWeb(req, res, url, body) {
  const m = mode(bearer(req));
  const blocked = () => { res.writeHead(403, { 'content-type': 'text/html; charset=UTF-8', 'cf-mitigated': 'challenge' }); res.end(CLOUDFLARE_HTML); };
  if (m === '403') return blocked();
  if (m === 'unauthorized' || m === '401') return json(res, 401, { detail: 'Could not parse your authentication token. Please try signing in again.' });
  if (req.method === 'GET' && url.pathname === '/backend-api/sentinel/chat-requirements') {
    return json(res, 200, { token: 'mock-sentinel-token', persona: 'chatgpt-freeaccount', proofofwork: { required: false } });
  }
  if (req.method === 'POST' && url.pathname === '/backend-api/conversation') {
    if (m === '429') return json(res, 429, { detail: 'Too many requests (provider-mock)' }, { 'retry-after': '30' });
    if (m === '500') return json(res, 500, { detail: 'Internal server error (provider-mock)' });
    sseStart(res);
    const msgId = randomUUID();
    const ev = (text, status) => `data: ${JSON.stringify({
      message: { id: msgId, author: { role: 'assistant' }, status, content: { content_type: 'text', parts: [text] }, metadata: { model_slug: body?.model ?? 'gpt-mock' } },
      conversation_id: 'conv-mock',
    })}\n\n`;
    let acc = REPLY[0];
    res.write(ev(acc, 'in_progress'));
    if (m === 'cut') return cut(res);
    for (const t of REPLY.slice(1)) { acc += t; res.write(ev(acc, 'in_progress')); }
    res.write(ev(acc, 'finished_successfully'));
    return res.end('data: [DONE]\n\n');
  }
  json(res, 404, { detail: 'Not Found' });
}

function azure(req, res, url, body) {
  const dep = /^\/openai\/deployments\/([^/]+)\/chat\/completions$/.exec(url.pathname);
  if (req.method !== 'POST' || !dep) return json(res, 404, { error: { code: 'DeploymentNotFound', message: 'Not found (provider-mock)' } });
  if (!url.searchParams.get('api-version')) return json(res, 400, { error: { code: 'BadRequest', message: 'Missing required query parameter api-version' } });
  const m = mode(req.headers['api-key'] ?? '');
  if (m !== 'ok' && m !== 'cut') return openAIError(res, m);
  openAIChat(res, body, m, dep[1]);
}

function vertex(req, res, url, body) {
  if (req.method !== 'POST' || !/^\/v1beta1\/projects\/[^/]+\/locations\/[^/]+\/endpoints\/openapi\/chat\/completions$/.test(url.pathname)) {
    return json(res, 404, { error: { code: 404, message: 'Not found (provider-mock)', status: 'NOT_FOUND' } });
  }
  const m = mode(bearer(req));
  if (m !== 'ok' && m !== 'cut') return openAIError(res, m);
  openAIChat(res, body, m, body?.model ?? 'google/gemini-mock');
}

function bedrock(req, res, url, body) {
  const route = /^\/model\/([^/]+)\/(converse|converse-stream)$/.exec(url.pathname);
  if (req.method !== 'POST' || !route) return json(res, 404, { message: 'Not found (provider-mock)' });
  const akid = /Credential=([^/]+)\//.exec(req.headers.authorization ?? '')?.[1] ?? '';
  const m = mode(akid);
  const aws = (status, type, message, h = {}) => json(res, status, { message }, { 'x-amzn-errortype': type, ...h });
  if (m === 'unauthorized' || m === '401') return aws(403, 'UnrecognizedClientException', 'The security token included in the request is invalid.');
  if (m === '403') return aws(403, 'AccessDeniedException', 'You don\'t have access to the model with the specified model ID. (provider-mock)');
  if (m === '429') return aws(429, 'ThrottlingException', 'Too many requests, please wait before trying again. (provider-mock)', { 'retry-after': '30' });
  if (m === '500') return aws(500, 'InternalServerException', 'Internal server error (provider-mock)');
  if (!Array.isArray(body?.messages)) return aws(400, 'ValidationException', 'messages is required (provider-mock)');
  if (route[2] === 'converse') {
    return json(res, 200, {
      output: { message: { role: 'assistant', content: [{ text: TEXT }] } },
      stopReason: 'end_turn', usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 }, metrics: { latencyMs: 12 },
    });
  }
  res.writeHead(200, { 'content-type': 'application/vnd.amazon.eventstream', 'x-amzn-requestid': randomUUID() });
  res.write(eventFrame('messageStart', { role: 'assistant' }));
  res.write(eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: REPLY[0] } }));
  if (m === 'cut') {
    // half of a frame: the client sees a truncated event stream
    res.write(eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: REPLY[1] } }).subarray(0, 20));
    return cut(res);
  }
  for (const t of REPLY.slice(1)) res.write(eventFrame('contentBlockDelta', { contentBlockIndex: 0, delta: { text: t } }));
  res.write(eventFrame('contentBlockStop', { contentBlockIndex: 0 }));
  res.write(eventFrame('messageStop', { stopReason: 'end_turn' }));
  res.end(eventFrame('metadata', { usage: { inputTokens: 7, outputTokens: 5, totalTokens: 12 }, metrics: { latencyMs: 12 } }));
}

// ── server ────────────────────────────────────────────────────────────────

export async function startMocks({ port = 0, host = '127.0.0.1' } = {}) {
  const log = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://mock');
    if (url.pathname === '/__mock/requests') {
      if (req.method === 'DELETE') { log.length = 0; res.writeHead(204); return res.end(); }
      return json(res, 200, log);
    }
    const body = await readBody(req);
    log.push({
      method: req.method, path: url.pathname + url.search, body,
      headers: Object.fromEntries(Object.entries(req.headers).map(([k, v]) => [k, SECRET_HEADERS.has(k) ? mask(String(v)) : v])),
    });
    const p = url.pathname;
    try {
      if (p.startsWith('/api/organizations')) return claudeWeb(req, res, url, body);
      if (p.startsWith('/backend-api/')) return chatgptWeb(req, res, url, body);
      if (p.startsWith('/openai/deployments/')) return azure(req, res, url, body);
      if (p.startsWith('/model/')) return bedrock(req, res, url, body);
      if (p.startsWith('/v1beta1/projects/')) return vertex(req, res, url, body);
      json(res, 404, { error: 'unknown provider-mock route' });
    } catch (e) {
      json(res, 500, { error: String(e) });
    }
  });
  await new Promise((resolve) => server.listen(port, host, resolve));
  const addr = server.address();
  return {
    url: `http://${host}:${addr.port}`,
    requests: log,
    close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(() => resolve()); }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const h = process.argv.indexOf('--host');
  const mocks = await startMocks({
    port: i > 0 ? Number(process.argv[i + 1]) : 4010,
    host: h > 0 ? process.argv[h + 1] : '127.0.0.1',
  });
  process.stdout.write(`provider-mocks listening on ${mocks.url}\n` +
    '  claude.ai   anthropic-web  --endpoint <url>  --api-key mock-ok\n' +
    '  chatgpt.com openai-web     --endpoint <url>  --api-key mock-ok\n' +
    '  azure / bedrock / vertex   --endpoint <url>  (azure api-key, aws access key id, vertex api key = mock-ok)\n' +
    '  modes: mock-429 mock-403 mock-401 mock-500 mock-cut\n');
  process.on('SIGINT', () => mocks.close().then(() => process.exit(0)));
}
