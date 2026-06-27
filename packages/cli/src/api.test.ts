import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock store before importing api so requireAccount is controlled
vi.mock('./store.js', () => ({
  requireAccount: vi.fn(),
  saveAccount: vi.fn(),
}));

import { api, apiWith } from './api.js';
import { requireAccount, saveAccount } from './store.js';

const mockRequireAccount = vi.mocked(requireAccount);
const mockSaveAccount = vi.mocked(saveAccount);

const ACCOUNT = {
  alias: 'test',
  serverUrl: 'http://localhost:3000',
  email: 'x@x.com',
  token: 'tok',
  expiresAt: Date.now() + 3_600_000,
  // exactOptionalPropertyTypes: omit optional key rather than set to undefined
};

beforeEach(() => {
  mockRequireAccount.mockResolvedValue(ACCOUNT);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('apiWith()', () => {
  it('sends request using an explicit account', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, ok: true,
      json: vi.fn().mockResolvedValue({ result: 'ok' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const explicitAccount = { ...ACCOUNT, token: 'explicit-tok' };
    const result = await apiWith(explicitAccount, 'GET', '/api/models');
    expect(result).toMatchObject({ result: 'ok' });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer explicit-tok');
  });
});

describe('api() Content-Type header', () => {
  it('omits Content-Type on no-body requests (e.g. DELETE)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 204,
      ok: true,
      json: vi.fn(),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api('DELETE', '/api/notifications/channels/abc');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['Authorization']).toBe('Bearer tok');
    // Root cause of the 400: a bodyless request must send NO body at all (not '' / 'undefined'),
    // otherwise Fastify rejects the empty JSON body. (#fix-3)
    expect(init.body).toBeUndefined();
  });

  it('returns success for a bodyless DELETE that the server accepts (200)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, ok: true,
      json: vi.fn().mockResolvedValue({ deleted: true }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await api<{ deleted: boolean }>('DELETE', '/api/models/abc');
    expect(result).toMatchObject({ deleted: true });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('sets Content-Type: application/json when body is present (e.g. POST)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: vi.fn().mockResolvedValue({ id: '1' }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api('POST', '/api/notifications/channels', { provider: 'dashboard', name: 'x' });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });
});

describe('api() error handling', () => {
  it('throws ApiError when response is not ok', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 403,
      ok: false,
      statusText: 'Forbidden',
      json: vi.fn().mockResolvedValue({ error: 'Forbidden access' }),
    } as unknown as Response));

    const { ApiError } = await import('./api.js');
    await expect(api('GET', '/api/models')).rejects.toBeInstanceOf(ApiError);
  });

  it('falls back to statusText when error response has no error field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 500,
      ok: false,
      statusText: 'Internal Server Error',
      json: vi.fn().mockResolvedValue({}),
    } as unknown as Response));

    await expect(api('GET', '/api/models')).rejects.toThrow('Internal Server Error');
  });

  it('handles non-JSON error response gracefully', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 502,
      ok: false,
      statusText: 'Bad Gateway',
      json: vi.fn().mockRejectedValue(new SyntaxError('invalid json')),
    } as unknown as Response));

    await expect(api('GET', '/api/models')).rejects.toThrow('Bad Gateway');
  });
});

describe('api() expired token after silent refresh', () => {
  it('exits 1 when token is expired and no refresh token is available', async () => {
    const expiredAccount = { ...ACCOUNT, expiresAt: Date.now() - 1000 };
    mockRequireAccount.mockResolvedValue(expiredAccount);

    const errLines: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((...a) => { errLines.push(a.map(String).join(' ')); });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    await expect(api('GET', '/api/models')).rejects.toThrow('exit');
    expect(errLines.join(' ')).toContain('expired');
    exitSpy.mockRestore();
  });
});

describe('trySilentRefresh', () => {
  it('refreshes token when near expiry and saves new account', async () => {
    const nearExpiry = { ...ACCOUNT, refreshToken: 'rt-1', expiresAt: Date.now() + 60_000 }; // within 5 min
    mockRequireAccount.mockResolvedValue(nearExpiry);
    mockSaveAccount.mockResolvedValue(undefined);

    const newToken = 'new-tok';
    const fetchMock = vi.fn()
      // First call: refresh
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({ token: newToken }),
      } as unknown as Response)
      // Second call: actual API
      .mockResolvedValueOnce({
        status: 200,
        ok: true,
        json: vi.fn().mockResolvedValue({ models: [] }),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api('GET', '/api/models');

    expect(mockSaveAccount).toHaveBeenCalled();
    const saved = mockSaveAccount.mock.calls[0]![0];
    expect(saved.token).toBe(newToken);
  });

  it('proceeds with old token when refresh endpoint returns non-ok', async () => {
    const nearExpiry = { ...ACCOUNT, refreshToken: 'rt-1', expiresAt: Date.now() + 60_000 };
    mockRequireAccount.mockResolvedValue(nearExpiry);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 401 } as unknown as Response) // refresh fails
      .mockResolvedValueOnce({
        status: 200, ok: true,
        json: vi.fn().mockResolvedValue({ ok: true }),
      } as unknown as Response); // api call succeeds
    vi.stubGlobal('fetch', fetchMock);

    const result = await api('GET', '/api/models');
    expect(result).toMatchObject({ ok: true });
    expect(mockSaveAccount).not.toHaveBeenCalled();
  });

  it('proceeds silently when refresh fetch throws', async () => {
    const nearExpiry = { ...ACCOUNT, refreshToken: 'rt-1', expiresAt: Date.now() + 60_000 };
    mockRequireAccount.mockResolvedValue(nearExpiry);

    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network'))   // refresh throws
      .mockResolvedValueOnce({
        status: 200, ok: true,
        json: vi.fn().mockResolvedValue({ ok: true }),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('GET', '/api/models')).resolves.toMatchObject({ ok: true });
  });

  it('does not refresh when account has no refreshToken', async () => {
    // ACCOUNT has no refreshToken — standard setup
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api('GET', '/api/models');
    // Only one fetch call (the actual API, no refresh)
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not refresh when token is not near expiry', async () => {
    const freshAccount = { ...ACCOUNT, refreshToken: 'rt-1', expiresAt: Date.now() + 3_600_000 };
    mockRequireAccount.mockResolvedValue(freshAccount);

    const fetchMock = vi.fn().mockResolvedValue({
      status: 200, ok: true,
      json: vi.fn().mockResolvedValue({ ok: true }),
    } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api('GET', '/api/models');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('includes new refreshToken in saved account when returned', async () => {
    const nearExpiry = { ...ACCOUNT, refreshToken: 'rt-old', expiresAt: Date.now() + 60_000 };
    mockRequireAccount.mockResolvedValue(nearExpiry);
    mockSaveAccount.mockResolvedValue(undefined);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: vi.fn().mockResolvedValue({ token: 'new-tok', refreshToken: 'rt-new' }),
      } as unknown as Response)
      .mockResolvedValueOnce({
        status: 200, ok: true,
        json: vi.fn().mockResolvedValue({}),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await api('GET', '/api/models');
    const saved = mockSaveAccount.mock.calls[0]![0];
    expect(saved.refreshToken).toBe('rt-new');
  });

  it('parses exp from token header and uses it as expiresAt', async () => {
    const nearExpiry = { ...ACCOUNT, refreshToken: 'rt-1', expiresAt: Date.now() + 60_000 };
    mockRequireAccount.mockResolvedValue(nearExpiry);
    mockSaveAccount.mockResolvedValue(undefined);

    const exp = 9999999999; // seconds epoch (large value)
    const header = Buffer.from(JSON.stringify({ exp })).toString('base64url');
    const fakeToken = `${header}.payload.sig`;

    // process.exit will be called because exp (seconds) < Date.now() (ms); mock it
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => { throw new Error('exit'); }) as never);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: vi.fn().mockResolvedValue({ token: fakeToken }),
      } as unknown as Response);
    vi.stubGlobal('fetch', fetchMock);

    await expect(api('GET', '/api/models')).rejects.toThrow('exit');
    // saveAccount was called with the exp value from the header
    expect(mockSaveAccount).toHaveBeenCalled();
    const saved = mockSaveAccount.mock.calls[0]![0];
    expect(saved.expiresAt).toBe(exp);
    exitSpy.mockRestore();
  });
});
