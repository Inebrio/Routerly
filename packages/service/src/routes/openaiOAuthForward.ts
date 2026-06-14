import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerResponse } from 'node:http';
import type { ModelConfig } from '@routerly/shared';
import { trackUsage } from '../cost/tracker.js';

const CHATGPT_BASE = 'https://chatgpt.com';
const CODEX_PATH = '/backend-api/codex/responses';
const DEFAULT_AUTH_PATH = '~/.codex/auth.json';
const OAUTH_ENDPOINT = 'https://auth.openai.com/oauth/token';
const CODEX_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const REFRESH_BUFFER_SECONDS = 300;

interface CodexTokens {
  access_token: string;
  refresh_token: string;
  account_id: string;
  id_token?: string | undefined;
}

interface CodexAuth {
  auth_mode?: string;
  tokens: CodexTokens;
  last_refresh?: string;
  [key: string]: unknown;
}

function resolvePath(p: string): string {
  return p.startsWith('~/') ? homedir() + p.slice(1) : p;
}

function jwtExp(token: string): number {
  try {
    const raw = Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf-8');
    const exp = (JSON.parse(raw) as Record<string, unknown>)['exp'];
    return typeof exp === 'number' ? exp : 0;
  } catch {
    return 0;
  }
}

async function refreshTokens(tokens: CodexTokens): Promise<CodexTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: CODEX_CLIENT_ID,
  });
  const res = await fetch(OAUTH_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`token refresh failed: HTTP ${res.status}`);
  }
  const data = (await res.json()) as Record<string, unknown>;
  return {
    access_token: (data['access_token'] as string) ?? tokens.access_token,
    refresh_token: (data['refresh_token'] as string) ?? tokens.refresh_token,
    account_id: tokens.account_id,
    id_token: (data['id_token'] as string | undefined) ?? tokens.id_token,
  };
}

export async function resolveCodexToken(
  authFilePath: string,
  log: FastifyBaseLogger,
): Promise<{ accessToken: string; accountId: string }> {
  const resolved = resolvePath(authFilePath);
  const raw = await readFile(resolved, 'utf-8');
  const auth = JSON.parse(raw) as CodexAuth;
  let tokens = auth.tokens;

  const exp = jwtExp(tokens.access_token);
  const nowSec = Math.floor(Date.now() / 1000);
  if (exp > 0 && exp - nowSec < REFRESH_BUFFER_SECONDS) {
    log.info({ expires_in: exp - nowSec }, 'openai-oauth token expiring, refreshing');
    try {
      tokens = await refreshTokens(tokens);
      const updated: CodexAuth = { ...auth, tokens, last_refresh: new Date().toISOString() };
      await writeFile(resolved, JSON.stringify(updated, null, 2), 'utf-8');
      log.info('openai-oauth token refreshed and saved');
    } catch (err) {
      log.warn({ err }, 'openai-oauth token refresh failed, using existing token');
    }
  }

  return { accessToken: tokens.access_token, accountId: tokens.account_id };
}

function sanitizeMessage(m: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.name !== undefined) out.name = m.name;
  if (m.tool_calls !== undefined) out.tool_calls = m.tool_calls;
  if (m.tool_call_id !== undefined) out.tool_call_id = m.tool_call_id;
  return out;
}

function buildCodexPayload(
  body: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  const messages = (body.messages as Array<Record<string, unknown>> | undefined) ?? [];
  const systemMsg = messages.find((m) => m.role === 'system');
  const inputMsgs = messages.filter((m) => m.role !== 'system').map(sanitizeMessage);

  const payload: Record<string, unknown> = {
    model: modelId,
    input: inputMsgs,
    instructions: typeof systemMsg?.content === 'string' ? systemMsg.content : '',
    stream: true,
    store: false,
  };
  if (body.tools) payload.tools = body.tools;
  return payload;
}

const DROP_REQUEST = new Set([
  'host', 'content-length', 'connection', 'transfer-encoding', 'authorization',
]);

export function buildOpenAIOAuthHeaders(
  accessToken: string,
  accountId: string,
  incoming: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(incoming)) {
    if (value === undefined) continue;
    const lower = key.toLowerCase();
    if (DROP_REQUEST.has(lower)) continue;
    out[lower] = Array.isArray(value) ? value.join(', ') : value;
  }
  out['authorization'] = `Bearer ${accessToken}`;
  out['originator'] = 'codex_cli_rs';
  out['openai-beta'] = 'responses=experimental';
  out['content-type'] = 'application/json';
  if (accountId) out['chatgpt-account-id'] = accountId;
  return out;
}

export async function forwardOpenAIOAuthSSE(
  raw: ServerResponse,
  body: Record<string, unknown>,
  model: ModelConfig,
  log: FastifyBaseLogger,
  traceId: string,
  projectId: string,
): Promise<void> {
  const startMs = Date.now();
  const authFilePath = model.apiKey || DEFAULT_AUTH_PATH;
  let accessToken: string;
  let accountId: string;
  try {
    ({ accessToken, accountId } = await resolveCodexToken(authFilePath, log));
  } catch (err) {
    log.error({ err, traceId }, 'openai-oauth failed to load auth token');
    raw.write('data: [DONE]\n\n');
    void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: 'error', callType: 'completion', traceId }).catch(() => {});
    return;
  }

  const modelId = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;
  const endpoint = (model.endpoint?.replace(/\/$/, '') ?? CHATGPT_BASE) + CODEX_PATH;
  const payload = buildCodexPayload(body, modelId);
  const headers = buildOpenAIOAuthHeaders(accessToken, accountId, {});

  let upstream: Response;
  try {
    upstream = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(payload) });
  } catch (err) {
    log.error({ err, url: endpoint, traceId }, 'openai-oauth upstream fetch error');
    raw.write('data: [DONE]\n\n');
    void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: 'error', callType: 'completion', traceId }).catch(() => {});
    return;
  }

  log.info(
    { oauth: true, provider: 'openai-oauth', modelId: model.id, status: upstream.status, traceId },
    'openai-oauth pass-through',
  );

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => '');
    log.warn({ status: upstream.status, body: errBody }, 'openai-oauth upstream error response');
    raw.write('data: [DONE]\n\n');
    void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: 'error', callType: 'completion', traceId }).catch(() => {});
    return;
  }

  if (!upstream.body) {
    raw.write('data: [DONE]\n\n');
    void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: 'success', callType: 'completion', traceId }).catch(() => {});
    return;
  }

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const chatId = `chatcmpl-${traceId}`;
  const created = Math.floor(Date.now() / 1000);
  let buffer = '';

  function emitTextDelta(dataStr: string) {
    try {
      const parsed = JSON.parse(dataStr) as Record<string, unknown>;
      const delta = parsed['delta'];
      if (typeof delta !== 'string' || delta.length === 0) return;
      const chunk = {
        id: chatId,
        object: 'chat.completion.chunk',
        created,
        model: modelId,
        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }],
      };
      raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    } catch { /* ignore unparseable events */ }
  }

  function processBlock(block: string) {
    let eventType = '';
    let dataStr = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) eventType = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataStr = line.slice(6);
    }
    if (eventType === 'response.output_text.delta' && dataStr) emitTextDelta(dataStr);
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (block.trim()) processBlock(block);
      }
    }
    if (buffer.trim()) processBlock(buffer);
  } finally {
    reader.releaseLock();
  }

  const stopChunk = {
    id: chatId, object: 'chat.completion.chunk', created, model: modelId,
    choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
  };
  raw.write(`data: ${JSON.stringify(stopChunk)}\n\n`);
  raw.write('data: [DONE]\n\n');
  void trackUsage({ projectId, model, inputTokens: 0, outputTokens: 0, latencyMs: Date.now() - startMs, outcome: 'success', callType: 'completion', traceId }).catch(() => {});
}
