import { CATALOG } from '../../../core/tokens.js'
import { readConfig } from '../../config/loader.js'
import type { McpToolEntry } from '../registry.js'

/**
 * list_models: enumerate the models configured on this gateway for MCP clients.
 * Read scope, global (models are gateway-wide, not project-owned) so authCtx is
 * unused. The output whitelists only id/provider/enabled/contextWindow — a
 * strictly safer stance than api.ts's `apiKey: undefined, cfClearance: undefined`
 * blacklist, since a fresh object cannot carry any provider credential fields.
 * // ponytail: gated on CATALOG (the models feature's DI token); the handler
 * // reads config directly like api.ts rather than resolving a DI token, as the
 * // McpTool.handler signature carries no container.
 */
export const listModelsTool: McpToolEntry = {
  name: 'list_models',
  description:
    'List the models configured on this Routerly gateway (id, provider, context window). No secrets are returned.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requires: CATALOG,
  async handler() {
    const models = await readConfig('models')
    const list = models.map((m) => ({
      id: m.id,
      provider: m.provider,
      contextWindow: m.contextWindow,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
  },
}
