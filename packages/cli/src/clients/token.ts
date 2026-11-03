import { api } from '../api.js';

export interface AcquireOpts {
  routerId: string;
  explicitToken?: string;
  scopes?: string[];
}

/** Returns explicitToken verbatim if provided; otherwise mints a new router token. */
export async function acquireToken(opts: AcquireOpts): Promise<string> {
  if (opts.explicitToken) return opts.explicitToken;
  const res = await api<{ token: string }>('POST', `/api/routers/${opts.routerId}/tokens`, {
    labels: ['client:configurator'],
    ...(opts.scopes ? { scopes: opts.scopes } : {}),
  });
  return res.token;
}
