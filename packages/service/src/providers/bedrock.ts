import { createHmac, createHash } from 'node:crypto';
import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  ModelConfig,
  StreamChunk,
  MessagesRequest,
  MessagesResponse,
} from '@routerly/shared';
import type { ProviderAdapter } from './types.js';
import { openAIToAnthropicResponse } from './messages-compat.js';

// ── AWS Signature V4 ──────────────────────────────────────────────────────────

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function sha256hex(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function getSignatureKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate    = hmacSha256('AWS4' + secret, date);
  const kRegion  = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

export function signRequest(opts: {
  method: string;
  url: string;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
}): Record<string, string> {
  const url = new URL(opts.url);
  const now = new Date();
  const amzDate  = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256hex(opts.body);

  const headers: Record<string, string> = {
    'content-type':           'application/json',
    'host':                   url.host,
    'x-amz-date':             amzDate,
    'x-amz-content-sha256':   payloadHash,
  };
  if (opts.sessionToken) headers['x-amz-security-token'] = opts.sessionToken;

  const headerKeys        = Object.keys(headers).sort();
  const canonicalHeaders  = headerKeys.map(k => `${k}:${headers[k]}`).join('\n') + '\n';
  const signedHeaders     = headerKeys.join(';');
  const canonicalRequest  = [opts.method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');

  const credentialScope = `${dateStamp}/${opts.region}/bedrock/aws4_request`;
  const stringToSign    = ['AWS4-HMAC-SHA256', amzDate, credentialScope, sha256hex(canonicalRequest)].join('\n');
  const sigKey          = getSignatureKey(opts.secretAccessKey, dateStamp, opts.region, 'bedrock');
  const signature       = createHmac('sha256', sigKey).update(stringToSign).digest('hex');

  headers['authorization'] =
    `AWS4-HMAC-SHA256 Credential=${opts.accessKeyId}/${credentialScope},SignedHeaders=${signedHeaders},Signature=${signature}`;

  return headers;
}

// ── Message format conversion ─────────────────────────────────────────────────

interface BedrockMessage { role: string; content: Array<{ type: string; text: string }> }

function toBedrockMessages(messages: ChatCompletionRequest['messages']): {
  system: Array<{ text: string }> | undefined;
  messages: BedrockMessage[];
} {
  const systemParts = messages.filter(m => m.role === 'system');
  const system = systemParts.length
    ? systemParts.map(m => ({ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }))
    : undefined;

  const conv: BedrockMessage[] = messages
    .filter(m => m.role !== 'system')
    .map(m => ({
      role: m.role as string,
      content: [{ type: 'text', text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }],
    }));

  return { system, messages: conv };
}

function getUpstreamModelId(model: ModelConfig): string {
  // e.g. 'bedrock/anthropic.claude-3-5-sonnet-20241022-v2:0' → the part after first slash
  if (model.id.includes('/')) return model.id.split('/').slice(1).join('/');
  return model.id;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

export class BedrockAdapter implements ProviderAdapter {
  private buildUrl(model: ModelConfig, stream: boolean): string {
    const region  = model.awsRegion ?? 'us-east-1';
    const modelId = getUpstreamModelId(model);
    const suffix  = stream ? 'converse-stream' : 'converse';
    return `https://bedrock-runtime.${region}.amazonaws.com/model/${encodeURIComponent(modelId)}/${suffix}`;
  }

  private auth(model: ModelConfig, url: string, body: string): Record<string, string> {
    const sigOpts: Parameters<typeof signRequest>[0] = {
      method:          'POST',
      url,
      body,
      accessKeyId:     model.awsAccessKeyId     ?? '',
      secretAccessKey: model.awsSecretAccessKey  ?? '',
      region:          model.awsRegion           ?? 'us-east-1',
    };
    if (model.awsSessionToken) sigOpts.sessionToken = model.awsSessionToken;
    return signRequest(sigOpts);
  }

  async chatCompletion(request: ChatCompletionRequest, model: ModelConfig): Promise<ChatCompletionResponse> {
    const { system, messages } = toBedrockMessages(request.messages);
    const maxTokens = request.max_completion_tokens ?? request.max_tokens ?? 4096;
    const bedrockBody: Record<string, unknown> = { messages };
    if (system)     bedrockBody['system']    = system;
    if (maxTokens)  bedrockBody['inferenceConfig'] = { maxTokens };

    const bodyStr = JSON.stringify(bedrockBody);
    const url     = this.buildUrl(model, false);
    const headers = this.auth(model, url, bodyStr);

    const resp = await fetch(url, { method: 'POST', headers, body: bodyStr });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`Bedrock error ${resp.status}: ${text}`);
    }
    const data = await resp.json() as any;

    // Converse API response → OpenAI format
    const text = (data.output?.message?.content ?? [])
      .filter((b: any) => b.type === 'text' || b.text)
      .map((b: any) => b.text ?? '')
      .join('');

    const usage = data.usage ?? {};
    const modelId = getUpstreamModelId(model);
    return {
      id:      `chatcmpl-${Date.now()}`,
      object:  'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model:   modelId,
      choices: [{
        index:         0,
        message:       { role: 'assistant', content: text },
        finish_reason: data.stopReason === 'end_turn' ? 'stop' : 'length',
      }],
      usage: {
        prompt_tokens:     usage.inputTokens  ?? 0,
        completion_tokens: usage.outputTokens ?? 0,
        total_tokens:      (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0),
      },
    };
  }

  async *streamCompletion(request: ChatCompletionRequest, model: ModelConfig): AsyncIterable<StreamChunk> {
    // ponytail: Bedrock converse-stream uses multipart/mixed event chunks; complex to parse without a
    // binary framing lib. Fall back to non-streaming + emit a single chunk so callers still work.
    const response = await this.chatCompletion(request, model);
    const text = response.choices[0]?.message?.content ?? '';
    const id   = response.id;
    const created = response.created;
    yield {
      id, object: 'chat.completion.chunk', created, model: response.model,
      choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
    } as unknown as StreamChunk;
  }

  async messages(request: MessagesRequest, model: ModelConfig): Promise<MessagesResponse> {
    // Reuse chatCompletion path by converting to OpenAI format inline
    const messages = request.messages.map(m => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
    }));
    const req = {
      messages: request.system
        ? [{ role: 'system' as const, content: request.system }, ...messages]
        : messages,
      max_tokens: request.max_tokens,
    } as ChatCompletionRequest;

    const resp = await this.chatCompletion(req, model);
    return openAIToAnthropicResponse(resp, getUpstreamModelId(model));
  }
}
