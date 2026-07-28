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

  it('shows the empty state when no modules are registered', async () => {
    getModules.mockResolvedValue([]);
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByText('No modules registered.')).toBeInTheDocument());
  });

  it('enables a disabled module and shows the restart banner', async () => {
    getModules
      .mockResolvedValueOnce([
        { id: 'guardrails', version: '0.4.0', enabled: false, alwaysOn: false, dependsOn: [] },
      ])
      .mockResolvedValueOnce([
        { id: 'guardrails', version: '0.4.0', enabled: true, alwaysOn: false, dependsOn: [] },
      ]);
    enableModule.mockResolvedValue({ id: 'guardrails', enabled: true, restartRequired: true });
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await waitFor(() => expect(enableModule).toHaveBeenCalledWith('guardrails'));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('does not show the restart banner when restartRequired is false', async () => {
    getModules
      .mockResolvedValueOnce([
        { id: 'guardrails', version: '0.4.0', enabled: true, alwaysOn: false, dependsOn: [] },
      ])
      .mockResolvedValueOnce([
        { id: 'guardrails', version: '0.4.0', enabled: false, alwaysOn: false, dependsOn: [] },
      ]);
    disableModule.mockResolvedValue({ id: 'guardrails', enabled: false, restartRequired: false });
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(disableModule).toHaveBeenCalledWith('guardrails'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Enable' })).toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error and clears busy state when toggling fails', async () => {
    getModules.mockResolvedValue([
      { id: 'guardrails', version: '0.4.0', enabled: true, alwaysOn: false, dependsOn: [] },
    ]);
    disableModule.mockRejectedValue(new Error('cannot disable'));
    render(<SettingsModulesTab />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Disable' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    await waitFor(() => expect(screen.getByText('cannot disable')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Disable' })).not.toBeDisabled();
  });
});
