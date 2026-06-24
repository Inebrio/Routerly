import { createSign } from 'node:crypto';
import OpenAI from 'openai';
import type { ModelConfig } from '@routerly/shared';
import { OpenAIAdapter } from './openai.js';

// ── Google service-account JWT + token exchange ───────────────────────────────

interface TokenCache { token: string; expiresAt: number }
const tokenCache = new Map<string, TokenCache>();

async function getGoogleAccessToken(serviceAccountKeyJson: string): Promise<string> {
  const cached = tokenCache.get(serviceAccountKeyJson);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const key = JSON.parse(serviceAccountKeyJson) as {
    client_email: string;
    private_key: string;
  };
  const now     = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss:   key.client_email,
    sub:   key.client_email,
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
  })).toString('base64url');

  const toSign = `${header}.${payload}`;
  const sign   = createSign('RSA-SHA256');
  sign.update(toSign);
  const sig = sign.sign(key.private_key, 'base64url');
  const jwt = `${toSign}.${sig}`;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => resp.statusText);
    throw new Error(`Vertex token exchange failed ${resp.status}: ${text}`);
  }
  const data = await resp.json() as { access_token: string };
  // Cache for 55 min to avoid last-second expiry races
  tokenCache.set(serviceAccountKeyJson, { token: data.access_token, expiresAt: Date.now() + 55 * 60 * 1000 });
  return data.access_token;
}

// ── Adapter ───────────────────────────────────────────────────────────────────

/**
 * Google Vertex AI adapter using the OpenAI-compatible endpoint.
 * Auth is handled via service account JWT token exchange.
 */
export class VertexAdapter extends OpenAIAdapter {
  protected override getClient(model: ModelConfig): OpenAI {
    // Token is fetched async; getClient is synchronous here so we return a placeholder.
    // The actual token is injected via a custom fetch implementation in the OpenAI SDK.
    // We override chatCompletion/streamCompletion to await the token first.
    throw new Error('VertexAdapter: use chatCompletion/streamCompletion directly');
  }

  private async buildClient(model: ModelConfig): Promise<OpenAI> {
    const saKey    = model.vertexServiceAccountKey ?? '';
    const token    = saKey ? await getGoogleAccessToken(saKey) : (model.apiKey ?? '');
    const project  = model.vertexProjectId ?? '';
    const location = model.vertexLocation  ?? 'us-central1';
    const baseURL  = `https://${location}-aiplatform.googleapis.com/v1beta1/projects/${project}/locations/${location}/endpoints/openapi`;
    return new OpenAI({
      apiKey:   token,
      baseURL,
      timeout:  model.timeout ?? 60000,
      defaultHeaders: { Authorization: `Bearer ${token}` },
    });
  }

  override async chatCompletion(
    request: import('@routerly/shared').ChatCompletionRequest,
    model: ModelConfig,
  ): Promise<import('@routerly/shared').ChatCompletionResponse> {
    const client = await this.buildClient(model);
    const upstreamModel = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;
    const { stream: _stream, input: _input, ...rest } = request as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response = await (client as any).chat.completions.create({ ...rest, model: upstreamModel, stream: false });
    return response as import('@routerly/shared').ChatCompletionResponse;
  }

  override async *streamCompletion(
    request: import('@routerly/shared').ChatCompletionRequest,
    model: ModelConfig,
  ): AsyncIterable<import('@routerly/shared').StreamChunk> {
    const client = await this.buildClient(model);
    const upstreamModel = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;
    const { stream: _stream, input: _input, ...rest } = request as Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stream: any = await (client as any).chat.completions.create({ ...rest, model: upstreamModel, stream: true });
    for await (const chunk of stream) {
      yield chunk as import('@routerly/shared').StreamChunk;
    }
  }

  override async messages(
    request: import('@routerly/shared').MessagesRequest,
    model: ModelConfig,
  ): Promise<import('@routerly/shared').MessagesResponse> {
    const { anthropicToOpenAIMessages, openAIToAnthropicResponse } = await import('./messages-compat.js');
    const client = await this.buildClient(model);
    const upstreamModel = model.id.includes('/') ? model.id.split('/').slice(1).join('/') : model.id;
    const { messages, system } = anthropicToOpenAIMessages(request);
    const openAIMessages = system
      ? [{ role: 'system' as const, content: system }, ...messages]
      : messages;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const response: any = await (client as any).chat.completions.create({
      messages: openAIMessages,
      model: upstreamModel,
      max_tokens: request.max_tokens,
      stream: false,
    });
    return openAIToAnthropicResponse(response, upstreamModel);
  }
}
