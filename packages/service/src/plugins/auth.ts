import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { fastifyPlugin as fp } from 'fastify-plugin';
import { decrypt } from '@localrouter/shared';
import type { ProjectConfig } from '@localrouter/shared';
import { readConfig } from '../config/loader.js';

// Augment FastifyRequest to carry the resolved project
declare module 'fastify' {
  interface FastifyRequest {
    project: ProjectConfig;
  }
}

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorateRequest('project', null);

  fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
    // Skip auth for non-LLM-proxy routes (health check, dashboard UI, dashboard API)
    const url = request.url;
    if (url === '/health' || url.startsWith('/dashboard') || url.startsWith('/api/')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({
        error: 'unauthorized',
        message: 'Missing or invalid Authorization header. Expected: Bearer <project-token>',
      });
    }

    const incomingToken = authHeader.slice(7).trim();

    const projects = await readConfig('projects');
    for (const project of projects) {
      let decryptedToken: string;
      try {
        decryptedToken = decrypt(project.encryptedToken);
      } catch {
        // Skip projects with unreadable tokens (wrong key, corruption)
        continue;
      }
      if (decryptedToken === incomingToken) {
        request.project = project;
        return;
      }
    }

    return reply.status(401).send({
      error: 'unauthorized',
      message: 'Invalid project token.',
    });
  });
};

export default fp(authPlugin, { name: 'auth' });
