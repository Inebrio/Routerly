import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExperimentConfig, ProjectConfig } from '@routerly/shared';

vi.mock('../config/loader.js', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn().mockResolvedValue(undefined),
}));

import { resolveExperimentByToken, resolveExperimentRequest } from './resolve.js';
import { resetRotationState } from './rotation.js';
import { readConfig, writeConfig } from '../config/loader.js';

const mockReadConfig = vi.mocked(readConfig);
const mockWriteConfig = vi.mocked(writeConfig);

const projects: ProjectConfig[] = [
  { id: 'proj-a', name: 'A', tokens: [], members: [], models: [] },
  { id: 'proj-b', name: 'B', tokens: [], members: [], models: [] },
];

function experiment(over: Partial<ExperimentConfig> = {}): ExperimentConfig {
  return {
    id: 'exp-1',
    name: 'Prompt A vs B',
    rotation: 'round-robin',
    variants: [
      { id: 'v-a', projectId: 'proj-a' },
      { id: 'v-b', projectId: 'proj-b' },
    ],
    tokens: [{ id: 'tok-1', token: 'sk-rt-exp', createdAt: '2026-08-01T00:00:00.000Z' }],
    createdAt: '2026-08-01T00:00:00.000Z',
    ...over,
  };
}

function stub(experiments: ExperimentConfig[], allProjects: ProjectConfig[] = projects): void {
  mockReadConfig.mockImplementation(((key: string) =>
    Promise.resolve(key === 'experiments' ? experiments : allProjects)) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetRotationState();
});

describe('resolveExperimentByToken', () => {
  it('finds the experiment owning the bearer', async () => {
    stub([experiment()]);
    const found = await resolveExperimentByToken('sk-rt-exp');
    expect(found?.experiment.id).toBe('exp-1');
    expect(found?.token.id).toBe('tok-1');
  });

  it('returns null for a token nobody owns', async () => {
    stub([experiment()]);
    expect(await resolveExperimentByToken('sk-rt-other')).toBeNull();
  });
});

describe('resolveExperimentRequest', () => {
  it('returns null for a token that belongs to no experiment', async () => {
    stub([experiment()]);
    expect(await resolveExperimentRequest('sk-rt-other', {})).toBeNull();
  });

  it('picks a variant and its project on a running experiment', async () => {
    stub([experiment()]);
    const res = await resolveExperimentRequest('sk-rt-exp', {});
    expect(res).toMatchObject({ status: 'ok' });
    if (res?.status !== 'ok') throw new Error('unreachable');
    expect(res.variant.id).toBe('v-a');
    expect(res.project.id).toBe('proj-a');
    expect(res.experiment.id).toBe('exp-1');
  });

  it('refuses an expired token', async () => {
    stub([experiment({ tokens: [{ id: 'tok-1', token: 'sk-rt-exp', createdAt: '2026-08-01T00:00:00.000Z', expiresAt: '2020-01-01T00:00:00.000Z' }] })]);
    expect(await resolveExperimentRequest('sk-rt-exp', {})).toMatchObject({ status: 'expired' });
  });

  it('reports misconfigured when no variant points at an existing project', async () => {
    stub([experiment()], []);
    expect(await resolveExperimentRequest('sk-rt-exp', {})).toMatchObject({ status: 'misconfigured' });
  });

  it('skips a variant whose project was deleted instead of failing the call', async () => {
    stub([experiment()], [projects[1]!]);
    const res = await resolveExperimentRequest('sk-rt-exp', {});
    if (res?.status !== 'ok') throw new Error('expected ok');
    expect(res.variant.id).toBe('v-b');
  });

  it('records lastUsedAt on the experiment token', async () => {
    stub([experiment()]);
    await resolveExperimentRequest('sk-rt-exp', {});
    await vi.waitFor(() => expect(mockWriteConfig).toHaveBeenCalled());
    const [key, value] = mockWriteConfig.mock.calls[0] as [string, ExperimentConfig[]];
    expect(key).toBe('experiments');
    expect(value[0]!.tokens[0]!.lastUsedAt).toBeTruthy();
  });

  it('never fails the request when the lastUsedAt write throws', async () => {
    stub([experiment()]);
    mockWriteConfig.mockRejectedValueOnce(new Error('disk full'));
    const res = await resolveExperimentRequest('sk-rt-exp', {});
    expect(res).toMatchObject({ status: 'ok' });
  });
});
