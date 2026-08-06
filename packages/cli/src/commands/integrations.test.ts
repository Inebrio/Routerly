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

// ── add — missing type branches ───────────────────────────────────────────────

describe('integrations add — more types', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('add --type grafana with all required fields creates integration', async () => {
    mockApi.mockResolvedValueOnce({ id: 'gf-1', type: 'grafana', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'grafana',
      '--url', 'https://grafana.example.com/api/prom/push',
      '--username', '12345',
      '--api-key', 'eyJr...',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      type: 'grafana',
      url: 'https://grafana.example.com/api/prom/push',
      username: '12345',
      apiKey: 'eyJr...',
    }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('gf-1'));
  });

  it('add --type grafana missing --url exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'grafana', '--username', '1', '--api-key', 'k'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--url'));
  });

  it('add --type influxdb with all required fields creates integration', async () => {
    mockApi.mockResolvedValueOnce({ id: 'inf-1', type: 'influxdb', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'influxdb',
      '--url', 'http://influxdb:8086',
      '--token', 'mytoken',
      '--org', 'myorg',
      '--bucket', 'mybucket',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      type: 'influxdb', url: 'http://influxdb:8086', token: 'mytoken', org: 'myorg', bucket: 'mybucket',
    }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('inf-1'));
  });

  it('add --type influxdb missing --url exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'influxdb', '--token', 't', '--org', 'o', '--bucket', 'b'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--url'));
  });

  it('add --type webhook with url creates integration', async () => {
    mockApi.mockResolvedValueOnce({ id: 'wh-1', type: 'webhook', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'webhook', '--url', 'https://example.com/hook']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      type: 'webhook', url: 'https://example.com/hook',
    }));
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('wh-1'));
  });

  it('add --type webhook with --secret includes secret field', async () => {
    mockApi.mockResolvedValueOnce({ id: 'wh-2', type: 'webhook', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'webhook',
      '--url', 'https://example.com/hook',
      '--secret', 'hmac-secret',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      secret: 'hmac-secret',
    }));
  });

  it('add --type webhook missing --url exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'webhook'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--url'));
  });

  it('add --type unknown exits 1 with error message', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'badtype'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown type'));
  });

  it('add --type otel with --header parses headers into body', async () => {
    mockApi.mockResolvedValueOnce({ id: 'otel-2', type: 'otel', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'otel',
      '--endpoint', 'http://otel:4318',
      '--header', 'X-Custom=value1',
      '--header', 'X-Other=value2',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      headers: { 'X-Custom': 'value1', 'X-Other': 'value2' },
    }));
  });

  it('add --type webhook with --header parses headers', async () => {
    mockApi.mockResolvedValueOnce({ id: 'wh-3', type: 'webhook', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'webhook',
      '--url', 'https://x.com',
      '--header', 'Authorization=Bearer tok',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      headers: { Authorization: 'Bearer tok' },
    }));
  });

  it('add --type prometheus with --auth-token includes authToken', async () => {
    mockApi.mockResolvedValueOnce({ id: 'prom-2', type: 'prometheus', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'prometheus', '--auth-token', 'secret']);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({ authToken: 'secret' }));
  });

  it('add --type otel with --protocol grpc uses grpc', async () => {
    mockApi.mockResolvedValueOnce({ id: 'otel-3', type: 'otel', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'otel',
      '--endpoint', 'http://otel:4317',
      '--protocol', 'grpc',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({ protocol: 'grpc' }));
  });

  it('add --type datadog with --site overrides default site', async () => {
    mockApi.mockResolvedValueOnce({ id: 'dd-2', type: 'datadog', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'datadog',
      '--api-key', 'key123',
      '--site', 'datadoghq.eu',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({ site: 'datadoghq.eu' }));
  });

  it('add exits 1 with ApiError message on API failure', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(422, 'Unprocessable'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'prometheus'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('422'));
  });

  it('add exits 1 with generic error message on non-ApiError failure', async () => {
    mockApi.mockRejectedValueOnce(new Error('network failure'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'prometheus'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('network failure'));
  });
});

// ── remove — non-404 error ────────────────────────────────────────────────────

describe('integrations remove — non-404 error', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('prints generic error on non-404 API failure', async () => {
    mockApi.mockRejectedValueOnce(new Error('internal error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'remove', 'integ-abc'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('internal error'));
  });
});

// ── test — non-404 error ──────────────────────────────────────────────────────

describe('integrations test — error paths', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits 1 on 404 not found', async () => {
    mockApi.mockRejectedValueOnce(new ApiError(404, 'Not found'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'test', 'missing-id'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('missing-id'));
  });

  it('exits 1 on non-404 error', async () => {
    mockApi.mockRejectedValueOnce(new Error('timeout'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'test', 'integ-abc'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('timeout'));
  });
});

// ── enable / disable — error paths ───────────────────────────────────────────

describe('integrations enable — error path', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'enable', 'integ-abc'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

describe('integrations disable — error path', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits 1 on API error', async () => {
    mockApi.mockRejectedValueOnce(new Error('server error'));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'disable', 'integ-abc'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('server error'));
  });
});

// ── endpointSummary for table ────────────────────────────────────────────────

describe('integrations list — endpointSummary variants', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('shows (pull) for prometheus type', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'prom-abc1234', type: 'prometheus', enabled: true }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(lines.join('\n')).toContain('(pull)');
  });

  it('shows datadog site in summary', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'dd-abcd1234', type: 'datadog', enabled: true, site: 'datadoghq.eu' }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(lines.join('\n')).toContain('datadoghq.eu');
  });

  it('shows datadog default site when site not set', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'dd-abcd5678', type: 'datadog', enabled: true }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(lines.join('\n')).toContain('datadoghq.com');
  });

  it('shows webhook url in summary', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'wh-abcd1234', type: 'webhook', enabled: true, url: 'https://hook.example.com' }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(lines.join('\n')).toContain('https://hook.example.com');
  });

  it('shows integration with a name', async () => {
    mockApi.mockResolvedValueOnce([{ id: 'otel-abcd123', type: 'otel', enabled: false, name: 'my-otel', endpoint: 'http://otel:4318' }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(lines.join('\n')).toContain('my-otel');
  });

  it('shows empty string for unknown integration type (default branch — no name)', async () => {
    // A type not in the switch statement with NO name hits the default: return '' branch
    // endpointSummary is only called when name is absent/empty (short-circuit)
    mockApi.mockResolvedValueOnce([{ id: 'unk-abcd123', type: 'custom-unknown-xyz', enabled: true }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    // Just verify it renders without crashing; default returns ''
    expect(lines.join('\n')).toContain('custom-unknown-xyz');
  });
});

describe('integrations add — datadog missing api-key', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('exits 1 when datadog is missing --api-key', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'datadog'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--api-key'));
  });

  it('add without --name does not include name in body', async () => {
    // Covers line 92 else branch: opts.name is undefined
    mockApi.mockResolvedValueOnce({ id: 'prom-3', type: 'prometheus', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'prometheus']);
    const call = mockApi.mock.calls.find(c => c[0] === 'POST');
    const body = call![2] as Record<string, unknown>;
    expect(body).not.toHaveProperty('name');
  });
});

describe('integrations list — endpointSummary url fallback branches', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('uses url as fallback when endpoint is absent (otel without endpoint, with url)', async () => {
    // Covers line 14: endpoint ?? url ?? '' — url branch taken
    mockApi.mockResolvedValueOnce([{ id: 'otel-url1', type: 'otel', enabled: true, url: 'http://alt:4318' }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    expect(lines.join('\n')).toContain('http://alt:4318');
  });

  it('returns empty string when neither endpoint nor url is present', async () => {
    // Covers line 14: endpoint ?? url ?? '' — '' branch taken
    mockApi.mockResolvedValueOnce([{ id: 'grafana-empty', type: 'grafana', enabled: true }]);
    const lines: string[] = [];
    vi.mocked(console.log).mockImplementation((...a) => lines.push(a.join(' ')));
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'list']);
    // No endpoint or url, should render without crashing
    expect(lines.join('\n')).toContain('grafana');
  });
});

describe('integrations add — parseHeaders invalid header', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('ignores header without equals sign (line 226 else branch)', async () => {
    // Covers line 226: eq > 0 false when header has no '='
    mockApi.mockResolvedValueOnce({ id: 'otel-4', type: 'otel', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'otel',
      '--endpoint', 'http://otel:4318',
      '--header', 'InvalidHeaderNoEquals',
    ]);
    const call = mockApi.mock.calls.find(c => c[0] === 'POST');
    const body = call![2] as Record<string, unknown>;
    // headers parsed but the invalid header is skipped
    expect(body['headers']).toEqual({});
  });
});

// ── traces ────────────────────────────────────────────────────────────────────

describe('integrations traces', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('add --traces opts the integration in', async () => {
    mockApi.mockResolvedValueOnce({ id: 'otel-t', type: 'otel', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'otel',
      '--endpoint', 'http://otel:4318',
      '--traces', '--trace-sample-rate', '0.25',
    ]);
    expect(mockApi).toHaveBeenCalledWith('POST', '/api/integrations', expect.objectContaining({
      traces: { enabled: true, sampleRate: 0.25 },
    }));
  });

  it('add --traces defaults to every trace', async () => {
    mockApi.mockResolvedValueOnce({ id: 'hook-t', type: 'webhook', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'add', '--type', 'webhook', '--url', 'http://hook', '--traces']);
    const body = mockApi.mock.calls.find(c => c[0] === 'POST')![2] as Record<string, unknown>;
    expect(body['traces']).toEqual({ enabled: true });
  });

  it('add --traces on a metric-only integration exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'add', '--type', 'datadog', '--api-key', 'k', '--traces']))
      .rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('otel and webhook'));
  });

  it('add --traces with an out-of-range sample rate exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync([
      'node', 'routerly', 'add', '--type', 'otel', '--endpoint', 'http://otel:4318',
      '--traces', '--trace-sample-rate', '5',
    ])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('between 0 and 1'));
  });

  it('traces <id> on PATCHes the flag', async () => {
    mockApi.mockResolvedValueOnce({ id: 'otel-t', type: 'otel', enabled: true });
    mockApi.mockResolvedValueOnce({ id: 'otel-t', type: 'otel', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'traces', 'otel-t', 'on', '--sample-rate', '0.5']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/integrations/otel-t', { traces: { enabled: true, sampleRate: 0.5 } });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('enabled'));
  });

  it('traces <id> off PATCHes the flag without touching the sample rate', async () => {
    mockApi.mockResolvedValueOnce({ id: 'hook-t', type: 'webhook', enabled: true });
    mockApi.mockResolvedValueOnce({ id: 'hook-t', type: 'webhook', enabled: true });
    const cmd = makeIntegrationsCommand();
    await cmd.parseAsync(['node', 'routerly', 'traces', 'hook-t', 'off']);
    expect(mockApi).toHaveBeenCalledWith('PATCH', '/api/integrations/hook-t', { traces: { enabled: false } });
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining('disabled'));
  });

  it('traces <id> with an unknown state exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'traces', 'otel-t', 'maybe'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('Unknown state'));
  });

  it('traces <id> on an unknown integration reports not found', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    mockApi.mockRejectedValueOnce(new ApiError(404, 'not found'));
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'traces', 'nope', 'on'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('not found'));
  });

  it('traces <id> on a metric-only integration exits 1', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    mockApi.mockResolvedValueOnce({ id: 'dd-1', type: 'datadog', enabled: true });
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'traces', 'dd-1', 'on'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('otel and webhook'));
  });

  it('traces <id> reports a failing PATCH', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
    mockApi.mockResolvedValueOnce({ id: 'otel-t', type: 'otel', enabled: true });
    mockApi.mockRejectedValueOnce(new Error('service down'));
    const cmd = makeIntegrationsCommand();
    await expect(cmd.parseAsync(['node', 'routerly', 'traces', 'otel-t', 'on'])).rejects.toThrow('exit');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('service down'));
  });
});
