import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { RouterFormRouter } from './RouterFormRouter';
import { RouterFormOrchestrator } from './RouterFormOrchestrator';
import { RouterFormPassthrough } from './RouterFormPassthrough';

const captured: Array<Record<string, any>> = [];
vi.mock('./RouterFormShared', () => ({
  RouterCreateForm: (props: Record<string, any>) => {
    captured.push(props);
    return null;
  },
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

describe('router create form wrappers', () => {
  it.each([
    [RouterFormRouter, 'router', 'general', 'createRouter'],
    [RouterFormOrchestrator, 'orchestrator', 'orchestrator', 'createOrchestrator'],
    [RouterFormPassthrough, 'passthrough', 'general', 'createPassthrough'],
  ] as const)('%o passes kind, payload, redirect and label', (Comp, kind, tab, label) => {
    captured.length = 0;
    render(<Comp />);
    const p = captured[0]!;
    expect(p.kind).toBe(kind);
    expect(p.buildExtraPayload()).toEqual({});
    expect(p.afterCreatePath('r1')).toBe(`/dashboard/routers/r1/${tab}`);
    expect(p.submitLabel).toBe(`routers.general.form.${label}`);
  });
});
