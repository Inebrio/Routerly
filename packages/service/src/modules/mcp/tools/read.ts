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
 * // ponytail: ModelConfig has no per-model disable flag, so `enabled` is always
 * // true; wire it to a real flag if one is ever added.
 */
export const listModelsTool: McpToolEntry = {
  name: 'list_models',
  description:
    'List the models configured on this Routerly gateway (id, provider, enabled, context window). No secrets are returned.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  scope: 'read',
  requires: CATALOG,
  async handler() {
    const models = await readConfig('models')
    const list = models.map((m) => ({
      id: m.id,
      provider: m.provider,
      enabled: true,
      contextWindow: m.contextWindow,
    }))
    return { content: [{ type: 'text', text: JSON.stringify(list, null, 2) }] }
  },
}
