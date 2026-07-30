import { api } from '../api.js';

export interface AcquireOpts {
  projectId: string;
  explicitToken?: string;
}

/** Returns explicitToken verbatim if provided; otherwise mints a new project token. */
export async function acquireToken(opts: AcquireOpts): Promise<string> {
  if (opts.explicitToken) return opts.explicitToken;
  const res = await api<{ token: string }>('POST', `/api/projects/${opts.projectId}/tokens`, {
    labels: ['client:configurator'],
  });
  return res.token;
}
