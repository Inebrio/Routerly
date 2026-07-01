import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { makeIntegrationsCommand } from './integrations.js';

vi.mock('../api.js', () => ({
  api: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.status = status;
      this.name = 'ApiError';
    }
  },
}));

import { api, ApiError } from '../api.js';

const mockApi = vi.mocked(api);

afterEach(() => vi.clearAllMocks());

// ── list ──────────────────────────────────────────────────────────────────────

describe('integrations list', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints table with integrations', async () => {
    mockApi.mockResolvedValueOnce([
      { id: 'abc12345-0000-0000-0000-000000000000', type: 'prometheus', enabled: true },
      { id: 'def67890-0000-0000-0000-000000000000', type: 'otel', enabled: false, endpoint: 'http://otel:4318' },
    ]);
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(mockApi).toHaveBeenCalledWith('GET', '/api/integrations');
    expect(console.log).toHaveBeenCalled();
  });

  it('prints message when no integrations', async () => {
    mockApi.mockResolvedValueOnce([]);
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('No integrations'));
  });

  it('outputs JSON with --json flag', async () => {
    const data = [{ id: 'abc12345-0000-0000-0000-000000000000', type: 'prometheus', enabled: true }];
    mockApi.mockResolvedValueOnce(data);
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list', '--json']);
    expect(console.log).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('Network error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'list'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── add ───────────────────────────────────────────────────────────────────────

describe('integrations add', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('add --type prometheus creates integration', async () => {
    mockApi.mockResolvedValueOnce({ id: 'prom-1', type: 'prometheus', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'prometheus']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({ type: 'prometheus' }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('prom-1'));
  });

  it('add --type otel --endpoint http://otel:4318 creates integration', async () => {
    mockApi.mockResolvedValueOnce({ id: 'otel-1', type: 'otel', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'otel', '--endpoint', 'http://otel:4318']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      type: 'otel',
      endpoint: 'http://otel:4318',
      protocol: 'http',
    }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('otel-1'));
  });

  it('add --type datadog --api-key xxx creates integration', async () => {
    mockApi.mockResolvedValueOnce({ id: 'dd-1', type: 'datadog', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'datadog', '--api-key', 'xxx']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      type: 'datadog',
      apiKey: 'xxx',
      site: 'datadoghq.com',
    }));
  });

  it('add --type otel missing --endpoint exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'otel'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--endpoint'));
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe('integrations remove', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls DELETE and prints success', async () => {
    mockApi.mockResolvedValueOnce(undefined);
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'remove', 'integ-abc']);
    expect(mockApi).toHaveBeenCalledWith('DELETE', '/api/integrations/integ-abc');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('integ-abc'));
  });

  it('exits 1 on 404', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'remove', 'missing-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

// ── test ──────────────────────────────────────────────────────────────────────

describe('integrations test', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints success when ok=true', async () => {
    mockApi.mockResolvedValueOnce({ ok: true, message: 'connection ok' });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'test', 'integ-abc']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations/integ-abc/test');
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('ok: connection ok'));
  });

  it('exits 1 when ok=false', async () => {
    mockApi.mockResolvedValueOnce({ ok: false, message: 'connection refused' });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'test', 'integ-abc'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('failed: connection refused'));
  });
});

// ── enable / disable ──────────────────────────────────────────────────────────

describe('integrations enable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls PATCH with enabled:true', async () => {
    mockApi.mockResolvedValueOnce({ id: 'integ-abc', type: 'prometheus', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'enable', 'integ-abc']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/integrations/integ-abc', { enabled: true });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('enabled'));
  });
});

describe('integrations disable', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('calls PATCH with enabled:false', async () => {
    mockApi.mockResolvedValueOnce({ id: 'integ-abc', type: 'prometheus', enabled: false });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'disable', 'integ-abc']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/integrations/integ-abc', { enabled: false });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });
});
