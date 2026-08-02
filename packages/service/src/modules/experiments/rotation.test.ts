import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ExperimentConfig } from '@routerly/shared';
import { pickVariant, stickyKeyFor, conversationPrefix, resetRotationState } from './rotation.js';

function experiment(over: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    id: 'exp-1',
    name: 'Prompt A vs B',
    rotation: 'weighted',
    variants: [
      { id: 'v-a', projectId: 'proj-a' },
      { id: 'v-b', projectId: 'proj-b' },
    ],
    tokens: [],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => { resetRotationState(); });
afterEach(() => { vi.restoreAllMocks(); });

describe('pickVariant', () => {
  it('returns null when the experiment declares no variant', () => {
    expect(pickVariant(experiment({ variants: [] }), {})).toBeNull();
  });

  it('always returns the only variant, whatever the rotation', () => {
    const single = [{ id: 'v-a', projectId: 'proj-a' }];
    for (const rotation of ['sticky', 'weighted', 'round-robin'] as const) {
      expect(pickVariant(experiment({ rotation, variants: single }), {})!.id).toBe('v-a');
    }
  });

  it('round-robin alternates in declaration order and wraps', () => {
    const exp = experiment({ rotation: 'round-robin' });
    const seen = [0, 1, 2, 3].map(() => pickVariant(exp, {})!.id);
    expect(seen).toEqual(['v-a', 'v-b', 'v-a', 'v-b']);
  });

  it('round-robin keeps one cursor per experiment', () => {
    const a = experiment({ rotation: 'round-robin' });
    const b = experiment({ id: 'exp-2', rotation: 'round-robin' });
    expect(pickVariant(a, {})!.id).toBe('v-a');
    expect(pickVariant(b, {})!.id).toBe('v-a');
    expect(pickVariant(a, {})!.id).toBe('v-b');
  });

  it('weighted honours the declared shares', () => {
    const exp = experiment({
      rotation: 'weighted',
      variants: [
        { id: 'v-a', projectId: 'proj-a', weight: 90 },
        { id: 'v-b', projectId: 'proj-b', weight: 10 },
      ],
    });
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    expect(pickVariant(exp, {})!.id).toBe('v-a');
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    expect(pickVariant(exp, {})!.id).toBe('v-b');
  });

  it('sticky keeps the same caller on the same variant', () => {
    const exp = experiment({ rotation: 'sticky' });
    const first = pickVariant(exp, { endUserId: 'alice' })!.id;
    for (let i = 0; i < 20; i++) {
      expect(pickVariant(exp, { endUserId: 'alice' })!.id).toBe(first);
    }
  });

  it('sticky re-draws when the remembered variant left the experiment', () => {
    const exp = experiment({ rotation: 'sticky' });
    vi.spyOn(Math, 'random').mockReturnValue(0.9); // pins alice to v-b
    expect(pickVariant(exp, { endUserId: 'alice' })!.id).toBe('v-b');
    const shrunk = experiment({
      rotation: 'sticky',
      variants: [{ id: 'v-a', projectId: 'proj-a' }, { id: 'v-c', projectId: 'proj-c' }],
    });
    expect(pickVariant(shrunk, { endUserId: 'alice' })!.id).toBe('v-c');
  });

  it('sticky still serves a request that carries nothing stable to key on', () => {
    const exp = experiment({ rotation: 'sticky', stickyKey: 'end-user' });
    expect(pickVariant(exp, {})).not.toBeNull();
  });
});

describe('stickyKeyFor', () => {
  it('is stable for the same input and different across callers', () => {
    const exp = experiment({ rotation: 'sticky' });
    const alice = stickyKeyFor(exp, { endUserId: 'alice' });
    expect(alice).toBe(stickyKeyFor(exp, { endUserId: 'alice' }));
    expect(alice).not.toBe(stickyKeyFor(exp, { endUserId: 'bob' }));
    expect(alice).toHaveLength(32);
  });

  it('auto prefers the end-user id over the conversation and the client', () => {
    const exp = experiment({ rotation: 'sticky' });
    const withClient = stickyKeyFor(exp, { endUserId: 'alice', ip: '1.2.3.4', userAgent: 'curl' });
    expect(withClient).toBe(stickyKeyFor(exp, { endUserId: 'alice' }));
  });

  it('auto combines the conversation with the client when no end-user id is sent', () => {
    const exp = experiment({ rotation: 'sticky' });
    const base = { conversationPrefix: 'You are a bot', ip: '1.2.3.4', userAgent: 'curl' };
    expect(stickyKeyFor(exp, base)).not.toBe(stickyKeyFor(exp, { ...base, ip: '5.6.7.8' }));
    expect(stickyKeyFor(exp, base)).not.toBe(stickyKeyFor(exp, { ...base, conversationPrefix: 'other' }));
  });

  it('returns null when the chosen key is absent from the request', () => {
    expect(stickyKeyFor(experiment({ stickyKey: 'end-user' }), { ip: '1.2.3.4' })).toBeNull();
    expect(stickyKeyFor(experiment({ stickyKey: 'conversation' }), { endUserId: 'alice' })).toBeNull();
    expect(stickyKeyFor(experiment({ stickyKey: 'client' }), { endUserId: 'alice' })).toBeNull();
    expect(stickyKeyFor(experiment({ stickyKey: 'auto' }), {})).toBeNull();
  });

  it('two experiments do not share the same key space', () => {
    const key = stickyKeyFor(experiment({ stickyKey: 'client' }), { ip: '1.2.3.4' });
    expect(key).toBe(stickyKeyFor(experiment({ id: 'exp-2', stickyKey: 'client' }), { ip: '1.2.3.4' }));
    // same key, but pickVariant namespaces the assignment map by experiment id
    const a = pickVariant(experiment({ id: 'exp-1', rotation: 'sticky' }), { ip: '1.2.3.4' })!.id;
    vi.spyOn(Math, 'random').mockReturnValue(a === 'v-a' ? 0.9 : 0.1);
    const b = pickVariant(experiment({ id: 'exp-2', rotation: 'sticky' }), { ip: '1.2.3.4' })!.id;
    expect(b).not.toBe(a);
  });
});

describe('conversationPrefix', () => {
  it('reads the OpenAI shape: system message plus first user message', () => {
    expect(conversationPrefix({
      messages: [
        { role: 'system', content: 'You are a bot' },
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'Second turn' },
      ],
    })).toBe('You are a bot\nHello');
  });

  it('is stable as turns are appended', () => {
    const first = conversationPrefix({ messages: [{ role: 'user', content: 'Hello' }] });
    const later = conversationPrefix({
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' },
        { role: 'user', content: 'And now?' },
      ],
    });
    expect(later).toBe(first);
  });

  it('reads the Anthropic shape: top-level system plus content parts', () => {
    expect(conversationPrefix({
      system: [{ type: 'text', text: 'You are a bot' }],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }, { type: 'text', text: 'there' }] }],
    })).toBe('You are a bot\nHello there');
  });

  it('caps the prefix so a huge prompt is not kept in memory', () => {
    const long = conversationPrefix({ messages: [{ role: 'user', content: 'x'.repeat(5000) }] });
    expect(long).toHaveLength(2000);
  });

  it('returns undefined when there is nothing textual to key on', () => {
    expect(conversationPrefix(undefined)).toBeUndefined();
    expect(conversationPrefix('not an object')).toBeUndefined();
    expect(conversationPrefix({})).toBeUndefined();
    expect(conversationPrefix({ messages: [{ role: 'user', content: [{ type: 'image' }] }] })).toBeUndefined();
  });
});
