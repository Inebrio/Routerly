import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const getModules = vi.fn();
const disableModule = vi.fn();
const enableModule = vi.fn();
vi.mock('../api', () => ({
  getModules: () => getModules(),
  disableModule: (id: string) => disableModule(id),
  enableModule: (id: string) => enableModule(id),
}));

import { SettingsModulesTab } from './SettingsModulesTab';

describe('SettingsModulesTab', () => {
  beforeEach(() => {
    getModules.mockReset();
    disableModule.mockReset();
    enableModule.mockReset();
  });

  it('renders modules and locks always-on ones', async () => {
    getModules.mockResolvedValue([
      { id: 'config', version: '0.4.0', enabled: true, alwaysOn: true, dependsOn: [] },
      { id: 'guardrails', version: '0.4.0', enabled: true, alwaysOn: false, dependsOn: ['reverse-proxy'] },
    ]);
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByText('guardrails')).toBeInTheDocument());
    expect(screen.getByText('Locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument();
  });

  it('disables a module and shows the restart banner', async () => {
    getModules
      .mockResolvedValueOnce([
        { id: 'guardrails', version: '0.4.0', enabled: true, alwaysOn: false, dependsOn: [] },
      ])
      .mockResolvedValueOnce([
        { id: 'guardrails', version: '0.4.0', enabled: false, alwaysOn: false, dependsOn: [] },
      ]);
    disableModule.mockResolvedValue({ id: 'guardrails', enabled: false, restartRequired: true });
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(disableModule).toHaveBeenCalledWith('guardrails'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('shows an error when loading fails', async () => {
    getModules.mockRejectedValue(new Error('boom'));
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByText(/boom/)).toBeInTheDocument());
  });
});
