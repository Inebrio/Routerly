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
    const { system, messages } = toBedrockMessages(request.messages);
    const maxTokens = request.max_completion_tokens ?? request.max_tokens ?? 4096;
    const bedrockBody: Record<string, unknown> = { messages };
    if (system)    bedrockBody['system']          = system;
    if (maxTokens) bedrockBody['inferenceConfig'] = { maxTokens };

    const bodyStr = JSON.stringify(bedrockBody);
    const url     = this.buildUrl(model, true);
    const headers = this.auth(model, url, bodyStr);

    const resp = await fetch(url, { method: 'POST', headers, body: bodyStr });
    if (!resp.ok) {
      const text = await resp.text().catch(() => resp.statusText);
      throw new Error(`Bedrock error ${resp.status}: ${text}`);
    }
    if (!resp.body) throw new Error('Bedrock stream: response body is null');

    const id      = `chatcmpl-${Date.now()}`;
    const created = Math.floor(Date.now() / 1000);
    const modelId = getUpstreamModelId(model);
    const reader  = resp.body.getReader();
    let buf       = Buffer.alloc(0);

    // Parse Amazon Event Stream binary frames
    // Frame layout: totalLen(4) headersLen(4) preludeCRC(4) headers payload msgCRC(4)
    const parseHeaders = (raw: Buffer): Record<string, string> => {
      const out: Record<string, string> = {};
      let pos = 0;
      while (pos < raw.length) {
        const nameLen = raw[pos++]!;
        const name    = raw.subarray(pos, pos + nameLen).toString('utf-8'); pos += nameLen;
        const vtype   = raw[pos++]!;
        if (vtype === 7) { // string
          const vlen = raw.readUInt16BE(pos); pos += 2;
          out[name]  = raw.subarray(pos, pos + vlen).toString('utf-8'); pos += vlen;
        }
      }
      return out;
    };

    outer: while (true) {
      const { done, value } = await reader.read();
      if (value) buf = Buffer.concat([buf, Buffer.from(value)]);

      while (buf.length >= 12) {
        const totalLen = buf.readUInt32BE(0);
        if (buf.length < totalLen) break;

        const frame      = buf.subarray(0, totalLen);
        buf              = buf.subarray(totalLen);
        const headersLen = frame.readUInt32BE(4);
        // offset 8 = prelude CRC (skip verification)
        const msgHeaders = parseHeaders(frame.subarray(12, 12 + headersLen));
        const eventType  = msgHeaders[':event-type'];
        if (!eventType) continue;

        const payloadEnd = totalLen - 4; // last 4 bytes = message CRC
        const payload    = JSON.parse(frame.subarray(12 + headersLen, payloadEnd).toString('utf-8')) as Record<string, unknown>;

        if (eventType === 'contentBlockDelta') {
          const delta = payload['delta'] as Record<string, unknown> | undefined;
          const text  = (delta?.['text'] as string | undefined) ?? '';
          if (text) yield {
            id, object: 'chat.completion.chunk', created, model: modelId,
            choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
          } as unknown as StreamChunk;
        } else if (eventType === 'messageStop') {
          const reason = payload['stopReason'] === 'end_turn' ? 'stop' : 'length';
          yield {
            id, object: 'chat.completion.chunk', created, model: modelId,
            choices: [{ index: 0, delta: {}, finish_reason: reason }],
          } as unknown as StreamChunk;
        }
      }

      if (done) break outer;
    }
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
