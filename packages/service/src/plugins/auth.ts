import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { fastifyPlugin as fp } from 'fastify-plugin';
import type { ProjectConfig, ProjectToken } from '@routerly/shared';
import { readConfig } from '../config/loader.js';

// Augment FastifyRequest to carry the resolved project and token
declare module 'fastify' {
  interface FastifyRequest {
    project: ProjectConfig;
    token: ProjectToken;
  }
}

/**
 * Resolve a raw bearer token to its owning project and token entry.
 * Returns null if no project owns the token. Shared by the auth preHandler
 * and the pass-through proxy handler so both authenticate identically.
 */
export async function resolveProjectByToken(
  incomingToken: string,
): Promise<{ project: ProjectConfig; token: ProjectToken } | null> {
  const projects = await readConfig('projects');
  for (const project of projects) {
    for (const token of project.tokens || []) {
      if (token.token === incomingToken) {
        return { project, token };
      }
    }
  }
  return null;
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('project', null as unknown as ProjectConfig);
  fastify.decorateRequest('token', null as unknown as ProjectToken);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
    // Skip auth for non-LLM-proxy routes (health check, dashboard UI, dashboard API)
    const url = request.url;
    if (url === '/' || url === '/health' || url.startsWith('/dashboard') || url.startsWith('/api/')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <project-token>',
      });
    }

    const incomingToken = authHeader.slice(7).trim();

    const resolved = await resolveProjectByToken(incomingToken);
    if (resolved) {
      request.project = resolved.project;
      request.token = resolved.token;
      return;
    }

    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Invalid project token.',
    });
  });
};

export default fp(authPlugin, { name: 'auth' });
