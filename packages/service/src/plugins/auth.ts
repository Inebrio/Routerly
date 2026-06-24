import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { fastifyPlugin as fp } from 'fastify-plugin';
import type { ProjectConfig, ProjectToken } from '@routerly/shared';
import { readConfig, writeConfig } from '../config/loader.js';

// Augment FastifyRequest to carry the resolved project and token
declare module 'fastify' {
  interface FastifyRequest {
    project: ProjectConfig;
    token: ProjectToken;
  }
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

    const projects = await readConfig('projects');
    for (let pi = 0; pi < projects.length; pi++) {
      const project = projects[pi]!;
      const tokens = project.tokens || [];
      for (let ti = 0; ti < tokens.length; ti++) {
        const token = tokens[ti]!;
        if (token.token === incomingToken) {
          // Check expiry
          if (token.expiresAt && new Date(token.expiresAt) < new Date()) {
            return reply.status(401).send({ error: 'unauthorized', message: 'Project token has expired.' });
          }
          request.project = project;
          request.token = token;
          // Update lastUsedAt (fire-and-forget)
          const now = new Date().toISOString();
          projects[pi]!.tokens![ti] = { ...token, lastUsedAt: now };
          void writeConfig('projects', projects);
          return;
        }
      }
    }

    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Invalid project token.',
    });
  });
};

export default fp(authPlugin, { name: 'auth' });
