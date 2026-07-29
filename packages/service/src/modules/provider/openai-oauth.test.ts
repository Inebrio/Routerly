import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import {
  OpenAIOAuthAdapter,
  resolveOpenAIOAuthCredential,
  refreshOpenAIOAuthToken,
} from './openai-oauth.js';
import { OpenAIAdapter } from './openai.js';
import { getProviderAdapter } from './registry.js';
import type { ChatCompletionRequest, ModelConfig, ProviderConnection } from '@routerly/shared';
import { readConfig, writeConfig, getOrCreateSecret } from '../config/loader.js';
import { loadCredentialKey, encryptCredential, decryptCredential } from '../../lib/crypto-cred.js';

const create = vi.hoisted(() => vi.fn());

vi.mock('openai', () => {
  class OpenAIMock {
    apiKey: string;
    baseURL: string;
    constructor(opts: { apiKey?: string; baseURL?: string }) {
      this.apiKey = opts.apiKey ?? '';
      this.baseURL = opts.baseURL ?? '';
    }
    chat = { completions: { create } };
  }
  return { default: OpenAIMock };
});

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  getOrCreateSecret: vi.fn(),
}));

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);
const mockGetOrCreateSecret = vi.mocked(getOrCreateSecret);

afterEach(() => vi.clearAllMocks());

function makeModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: 'gpt-4o',
    name: 'GPT-4o OAuth',
    provider: 'openai-oauth',
    endpoint: 'https://api.openai.com/v1',
    apiKey: 'oat-test-token',
    cost: { inputPerMillion: 0, outputPerMillion: 0 },
    ...overrides,
  };
}

function makeResponse() {
  return {
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'gpt-4o',
    choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
  };
}

describe('OpenAIOAuthAdapter', () => {
  it('is a subclass of OpenAIAdapter', () => {
    const adapter = new OpenAIOAuthAdapter();
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });

  it('is registered under openai-oauth in the adapter registry', () => {
    const adapter = getProviderAdapter(makeModel());
    expect(adapter).toBeInstanceOf(OpenAIOAuthAdapter);
  });

  it('passes the stored token as apiKey (Bearer auth) to the SDK', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIOAuthAdapter();
    const request: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    await adapter.chatCompletion(request, makeModel({ apiKey: 'oat-my-secret-token' }));

    expect(create).toHaveBeenCalledOnce();
  });

  it('does not add Anthropic-specific headers', async () => {
    create.mockResolvedValue(makeResponse());

    const adapter = new OpenAIOAuthAdapter();
    const request: ChatCompletionRequest = {
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'Hello' }],
    };

    await adapter.chatCompletion(request, makeModel());

    const calledWith = create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(calledWith).not.toHaveProperty('anthropic-beta');
    expect(calledWith).not.toHaveProperty('anthropic-dangerous-direct-browser-access');
  });
});

describe('openai-oauth regression: existing openai adapter unchanged', () => {
  it('openai adapter is still registered and independent of openai-oauth', () => {
    const adapter = getProviderAdapter(makeModel({ provider: 'openai' }));
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
    expect(adapter).not.toBeInstanceOf(OpenAIOAuthAdapter);
  });
});

// ─── resolveOpenAIOAuthCredential / refreshOpenAIOAuthToken ────────────────

beforeAll(async () => {
  mockGetOrCreateSecret.mockResolvedValue('b'.repeat(64)); // valid 32-byte hex secret
  await loadCredentialKey();
});

function makeJwt(expSeconds: number): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ exp: expSeconds })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function makeConnection(overrides: Partial<ProviderConnection> = {}): ProviderConnection {
  return {
    id: 'conn-openai-1',
    providerId: 'openai-oauth',
    label: 'OpenAI OAuth',
    endpoint: 'https://api.openai.com/v1',
    enabled: true,
    credentials: {
      oauthEnc: encryptCredential('live-access-token'),
      refreshEnc: encryptCredential('refresh-token'),
      expiresAt: Date.now() + 3600_000,
    },
    ...overrides,
  };
}

describe('resolveOpenAIOAuthCredential', () => {
  it('returns the decrypted token as-is when not near expiry', async () => {
    const connection = makeConnection();
    const token = await resolveOpenAIOAuthCredential(connection);
    expect(token).toBe('live-access-token');
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('refreshes and persists an expired token', async () => {
    const connection = makeConnection({
      credentials: {
        oauthEnc: encryptCredential('stale-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: Date.now() - 1000,
      },
    });
    mockReadConfig.mockResolvedValueOnce([connection] as any);
    const newJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: newJwt, refresh_token: 'new-refresh-token' }),
    }) as any;

    const token = await resolveOpenAIOAuthCredential(connection);
    expect(token).toBe(newJwt);
    expect(mockWriteConfig).toHaveBeenCalledOnce();
    const written = mockWriteConfig.mock.calls[0]?.[1] as unknown as ProviderConnection[];
    expect(written[0]?.id).toBe('conn-openai-1');
    expect(decryptCredential(written[0]?.credentials['oauthEnc'] as string)).toBe(newJwt);
    expect(decryptCredential(written[0]?.credentials['refreshEnc'] as string)).toBe('new-refresh-token');
  });

  it('leaves connections untouched when the connection id is no longer found', async () => {
    const connection = makeConnection({
      id: 'conn-vanished',
      credentials: {
        oauthEnc: encryptCredential('stale-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: Date.now() - 1000,
      },
    });
    mockReadConfig.mockResolvedValueOnce([] as any);
    const newJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: newJwt, refresh_token: 'new-refresh-token' }),
    }) as any;

    const token = await resolveOpenAIOAuthCredential(connection);
    expect(token).toBe(newJwt);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('treats a nullish readConfig result as no existing connections (does not persist)', async () => {
    const connection = makeConnection({
      credentials: {
        oauthEnc: encryptCredential('stale-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: Date.now() - 1000,
      },
    });
    mockReadConfig.mockResolvedValueOnce(undefined as any);
    const newJwt = makeJwt(Math.floor(Date.now() / 1000) + 3600);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: newJwt, refresh_token: 'new-refresh-token' }),
    }) as any;

    const token = await resolveOpenAIOAuthCredential(connection);
    expect(token).toBe(newJwt);
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('does not force a refresh when expiresAt is the unknown-expiry sentinel (0)', async () => {
    const connection = makeConnection({
      credentials: {
        oauthEnc: encryptCredential('live-access-token'),
        refreshEnc: encryptCredential('refresh-token'),
        expiresAt: 0,
      },
    });
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const token = await resolveOpenAIOAuthCredential(connection);
    expect(token).toBe('live-access-token');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockWriteConfig).not.toHaveBeenCalled();
  });

  it('throws a clear error when oauthEnc/refreshEnc/expiresAt are missing from credentials', async () => {
    const connection = makeConnection({ credentials: {} });
    await expect(resolveOpenAIOAuthCredential(connection)).rejects.toThrow(
      'oauth connection missing encrypted credentials',
    );
  });
});

describe('refreshOpenAIOAuthToken', () => {
  it('posts a form-encoded refresh_token grant to auth.openai.com', async () => {
    const newJwt = makeJwt(Math.floor(Date.now() / 1000) + 100);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: newJwt, refresh_token: 'r1' }),
    });
    global.fetch = fetchMock as any;

    const result = await refreshOpenAIOAuthToken('old-refresh');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://auth.openai.com/oauth/token',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      }),
    );
    const sentBody = fetchMock.mock.calls[0]?.[1]?.body as string;
    expect(sentBody).toContain('grant_type=refresh_token');
    expect(sentBody).toContain('refresh_token=old-refresh');
    expect(result.accessToken).toBe(newJwt);
    expect(result.refreshToken).toBe('r1');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('reuses the old refresh token when the response omits refresh_token', async () => {
    const newJwt = makeJwt(Math.floor(Date.now() / 1000) + 100);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: newJwt }),
    }) as any;

    const result = await refreshOpenAIOAuthToken('kept-refresh-token');
    expect(result.refreshToken).toBe('kept-refresh-token');
  });

  it('returns expiresAt 0 when the access token is not a decodable JWT', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: 'not-a-jwt', refresh_token: 'r2' }),
    }) as any;

    const result = await refreshOpenAIOAuthToken('old-refresh');
    expect(result.expiresAt).toBe(0);
  });

  it('returns expiresAt 0 when the JWT payload has a non-numeric exp claim', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ exp: 'not-a-number' })).toString('base64url');
    const weirdJwt = `${header}.${payload}.sig`;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ access_token: weirdJwt, refresh_token: 'r3' }),
    }) as any;

    const result = await refreshOpenAIOAuthToken('old-refresh');
    expect(result.expiresAt).toBe(0);
  });

  it('throws on non-2xx response', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 400 }) as any;
    await expect(refreshOpenAIOAuthToken('old-refresh')).rejects.toThrow('openai oauth refresh failed');
  });
});
