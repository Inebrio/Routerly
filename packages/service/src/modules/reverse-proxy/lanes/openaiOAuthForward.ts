import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import type { FastifyBaseLogger } from 'fastify';
import type { ServerResponse } from 'node:http';
import type {
  ChatCompletionResponse, ChoiceDelta, ModelConfig, PiiConfig, StreamChoice, StreamChunk,
} from '@routerly/shared';
import { mergePolicies, StreamingScrubber } from '../../pii/piiScrubber.js';
import { trackUsage } from '../../usage/tracker.js';

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

/** Renders chat message content (plain string or OpenAI part list) as text. */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (typeof (p as { text?: unknown })?.text === 'string' ? (p as { text: string }).text : ''))
    .filter(Boolean)
    .join('');
}

/**
 * Chat-completions messages → Responses `input` items.
 *
 * The Codex backend speaks the Responses API only and rejects chat shapes.
 * Verified against the live endpoint:
 *   assistant `tool_calls` message → 400 "Invalid type for 'input[1].content'"
 *   assistant part `input_text`    → 400 "Supported values are: 'output_text'"
 * So: user parts become `input_text`/`input_image`, assistant parts `output_text`,
 * tool calls and their results become their own top-level items.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toResponsesInput(messages: Array<Record<string, any>>): Array<Record<string, unknown>> {
  const items: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    const role = m.role as string;
    if (role === 'system') continue;
    if (role === 'tool') {
      items.push({ type: 'function_call_output', call_id: String(m.tool_call_id ?? ''), output: contentText(m.content) });
      continue;
    }
    const content = m.content;
    if (Array.isArray(content)) {
      const parts = content.map((p) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const part = p as any;
        if (part?.type === 'image_url') return { type: 'input_image', image_url: part.image_url?.url ?? '' };
        return {
          type: role === 'assistant' ? 'output_text' : 'input_text',
          text: typeof part?.text === 'string' ? part.text : '',
        };
      });
      if (parts.length > 0) items.push({ type: 'message', role, content: parts });
    } else if (typeof content === 'string' && content) {
      items.push({ type: 'message', role, content });
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const call of (m.tool_calls as Array<Record<string, any>> | undefined) ?? []) {
      items.push({
        type: 'function_call',
        call_id: String(call?.id ?? ''),
        name: call?.function?.name ?? '',
        arguments: call?.function?.arguments ?? '{}',
      });
    }
  }
  return items;
}

/** Chat tool definitions → Responses tools (flat `name`, not nested under `function`). */
function toResponsesTools(tools: unknown): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  return tools.map((t) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = t as any;
    const fn = raw?.function ?? raw ?? {};
    return {
      type: 'function',
      name: fn.name ?? '',
      description: fn.description ?? '',
      parameters: fn.parameters ?? { type: 'object', properties: {} },
      // Client schemas (Claude Code ships 25 of them) are not strict-mode compliant.
      strict: false,
    };
  });
}

/** Chat tool_choice → Responses tool_choice (`{ type: 'function', name }`, no nesting). */
function toResponsesToolChoice(choice: unknown): unknown {
  if (typeof choice === 'string') return choice;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const c = choice as any;
  if (c?.type === 'function') return { type: 'function', name: c.function?.name ?? c.name ?? '' };
  return undefined;
}

export function buildCodexPayload(
  body: Record<string, unknown>,
  modelId: string,
): Record<string, unknown> {
  const messages = (body.messages as Array<Record<string, unknown>> | undefined) ?? [];
  const systemMsg = messages.find((m) => m.role === 'system');
  const tools = toResponsesTools(body.tools);
  const toolChoice = tools ? toResponsesToolChoice(body.tool_choice) : undefined;

  return {
    model: modelId,
    input: toResponsesInput(messages),
    instructions: contentText(systemMsg?.content),
    stream: true,
    store: false,
    ...(tools ? { tools } : {}),
    ...(toolChoice ? { tool_choice: toolChoice } : {}),
  };
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

/**
 * Runs a chat-completions request through the Codex Responses backend and yields
 * it back as OpenAI stream chunks — the one shape every lane already consumes
 * (`/v1/chat/completions` writes them as-is, `/v1/messages` runs them through
 * `openAIChunksToAnthropicSSE`). Tool calls included: the Responses function-call
 * events map onto `delta.tool_calls`, so a client that calls tools works on both
 * lanes without either of them knowing this provider is special.
 *
 * Throws on auth/upstream failure so the caller can fall back to another
 * candidate; usage is tracked once, whatever the outcome.
 */
export async function* streamOpenAIOAuthChunks(
  body: Record<string, unknown>,
  model: ModelConfig,
  log: FastifyBaseLogger,
  opts: { traceId: string; projectId: string; pii?: PiiConfig | undefined },
): AsyncGenerator<StreamChunk> {
  const startMs = Date.now();
  const modelId = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;
  const chatId = `chatcmpl-${opts.traceId}`;
  const created = Math.floor(Date.now() / 1000);
  // ponytail: null when PII scrubbing disabled, avoids per-chunk branch overhead
  const outPii = opts.pii?.policies?.length ? mergePolicies(opts.pii.policies, 'output') : null;
  const scrubber = (outPii && (outPii.entities?.length || outPii.customPatterns?.length)) ? new StreamingScrubber(outPii) : null;

  let outcome: 'success' | 'error' = 'error';
  let inputTokens = 0;
  let outputTokens = 0;

  const chunk = (
    delta: ChoiceDelta,
    finish: StreamChoice['finish_reason'] = null,
    usage?: { prompt_tokens: number; completion_tokens: number },
  ): StreamChunk => ({
    id: chatId,
    object: 'chat.completion.chunk',
    created,
    model: modelId,
    choices: [{ index: 0, delta, finish_reason: finish }],
    ...(usage ? { usage } : {}),
  }) as StreamChunk;

  try {
    const { accessToken, accountId } = await resolveCodexToken(model.apiKey || DEFAULT_AUTH_PATH, log);
    const endpoint = (model.endpoint?.replace(/\/$/, '') ?? CHATGPT_BASE) + CODEX_PATH;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: buildOpenAIOAuthHeaders(accessToken, accountId, {}),
      body: JSON.stringify(buildCodexPayload(body, modelId)),
    });

    log.info(
      { oauth: true, provider: 'openai-oauth', modelId: model.id, status: upstream.status, traceId: opts.traceId },
      'openai-oauth pass-through',
    );

    if (!upstream.ok) {
      const errBody = await upstream.text().catch(() => '');
      throw new Error(`openai-oauth upstream HTTP ${upstream.status}: ${errBody.slice(0, 300)}`);
    }
    if (!upstream.body) throw new Error('openai-oauth upstream returned no body');

    // Responses streams one item per output; `slotByItem` maps its id onto the
    // tool_call index OpenAI chunks are keyed by.
    const slotByItem = new Map<string, number>();
    const streamedArgs = new Set<string>();
    let nextSlot = 0;
    let sawTool = false;

    const handle = (block: string): StreamChunk[] => {
      let eventType = '';
      let dataStr = '';
      for (const line of block.split('\n')) {
        if (line.startsWith('event: ')) eventType = line.slice(7).trim();
        else if (line.startsWith('data: ')) dataStr = line.slice(6);
      }
      if (!dataStr) return [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let data: any;
      try { data = JSON.parse(dataStr); } catch { return []; }

      switch (eventType) {
        case 'response.output_text.delta': {
          const text = typeof data.delta === 'string' ? data.delta : '';
          if (!text) return [];
          const content = scrubber ? scrubber.push(text) : text;
          return content ? [chunk({ content })] : [];
        }
        case 'response.output_item.added': {
          const item = data.item ?? {};
          if (item.type !== 'function_call') return [];
          sawTool = true;
          const slot = nextSlot++;
          slotByItem.set(String(item.id ?? ''), slot);
          return [chunk({
            tool_calls: [{
              index: slot,
              id: String(item.call_id ?? item.id ?? ''),
              type: 'function',
              function: { name: item.name ?? '', arguments: '' },
            }],
          })];
        }
        case 'response.function_call_arguments.delta': {
          const itemId = String(data.item_id ?? '');
          const args = typeof data.delta === 'string' ? data.delta : '';
          if (!args) return [];
          streamedArgs.add(itemId);
          return [chunk({ tool_calls: [{ index: slotByItem.get(itemId) ?? 0, function: { arguments: args } }] })];
        }
        case 'response.output_item.done': {
          // Fallback for a call whose arguments never arrived as deltas.
          const item = data.item ?? {};
          const itemId = String(item.id ?? '');
          if (item.type !== 'function_call' || streamedArgs.has(itemId)) return [];
          const args = typeof item.arguments === 'string' ? item.arguments : '';
          if (!args) return [];
          return [chunk({ tool_calls: [{ index: slotByItem.get(itemId) ?? 0, function: { arguments: args } }] })];
        }
        case 'response.completed': {
          const usage = data.response?.usage ?? {};
          inputTokens = usage.input_tokens ?? 0;
          outputTokens = usage.output_tokens ?? 0;
          return [];
        }
        case 'response.failed':
        case 'error':
          throw new Error(String(data.response?.error?.message ?? data.error?.message ?? data.message ?? 'openai-oauth stream failed'));
        default:
          return [];
      }
    };

    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split('\n\n');
        buffer = blocks.pop()!; // ponytail: split always returns ≥1 element; pop() is never undefined
        for (const block of blocks) {
          if (block.trim()) yield* handle(block);
        }
      }
      if (buffer.trim()) yield* handle(buffer);
    } finally {
      reader.releaseLock();
    }

    if (scrubber) {
      const flushed = scrubber.flush();
      if (flushed.length > 0) yield chunk({ content: flushed });
    }
    yield chunk({}, sawTool ? 'tool_calls' : 'stop', { prompt_tokens: inputTokens, completion_tokens: outputTokens });
    outcome = 'success';
  } finally {
    if (opts.projectId) {
      void trackUsage({
        projectId: opts.projectId, model, inputTokens, outputTokens,
        latencyMs: Date.now() - startMs, outcome, callType: 'completion', traceId: opts.traceId,
      }).catch(() => {});
    }
  }
}

/** Collapses a chunk stream into a single chat completion, for non-streaming callers. */
export async function chunksToChatResponse(
  chunks: AsyncIterable<StreamChunk>,
  modelId: string,
): Promise<ChatCompletionResponse> {
  let id = '';
  let content = '';
  let finish: string | null = null;
  let usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const calls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> = [];

  for await (const c of chunks) {
    id ||= c.id;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const u = (c as any).usage;
    if (u) usage = { prompt_tokens: u.prompt_tokens ?? 0, completion_tokens: u.completion_tokens ?? 0, total_tokens: (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0) };
    const choice = c.choices?.[0];
    if (choice?.delta?.content) content += choice.delta.content;
    for (const call of choice?.delta?.tool_calls ?? []) {
      const slot = (calls[call.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } });
      if (call.id) slot.id = call.id;
      if (call.function?.name) slot.function.name = call.function.name;
      if (call.function?.arguments) slot.function.arguments += call.function.arguments;
    }
    if (choice?.finish_reason) finish = choice.finish_reason;
  }

  return {
    id: id || `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: content || null, ...(calls.length ? { tool_calls: calls } : {}) },
      finish_reason: (finish ?? 'stop'),
    }],
    usage,
  } as ChatCompletionResponse;
}

/**
 * Pulls the first chunk eagerly and hands back an equivalent stream.
 *
 * A generator does no work until it is iterated, so without this an auth or upstream
 * failure would surface at egress — too late to try the next candidate — as a stream
 * that opens and turns out to be empty. Awaiting the first chunk here makes the
 * failure throw inside the candidate loop instead.
 */
export async function primeStream<T>(chunks: AsyncIterable<T>): Promise<AsyncGenerator<T>> {
  const iter = chunks[Symbol.asyncIterator]();
  const first = await iter.next();
  return (async function* () {
    if (!first.done) yield first.value;
    for (let next = await iter.next(); !next.done; next = await iter.next()) yield next.value;
  })();
}

/**
 * Writes the Codex stream back to the client as OpenAI SSE (the `/v1/chat/completions`
 * lane). Never throws: a failed upstream still terminates the stream cleanly.
 */
export async function forwardOpenAIOAuthSSE(
  raw: ServerResponse,
  body: Record<string, unknown>,
  model: ModelConfig,
  log: FastifyBaseLogger,
  traceId: string,
  projectId: string,
  piiConfig?: PiiConfig,
): Promise<void> {
  try {
    for await (const chunk of streamOpenAIOAuthChunks(body, model, log, { traceId, projectId, pii: piiConfig })) {
      raw.write(`data: ${JSON.stringify(chunk)}\n\n`);
    }
  } catch (err) {
    log.error({ err, traceId }, 'openai-oauth stream failed');
  }
  raw.write('data: [DONE]\n\n');
}
