import type { SupportState } from '@routerly/shared';

export interface DetectResult {
  installed: boolean;
  configPath: string | null;
  configExists: boolean;
  version?: string;
}

export interface InspectResult {
  configPath: string;
  exists: boolean;
  routerlyConfigured: boolean;
  currentBaseUrl?: string;
  stale: boolean;
}

export interface ConfigTarget {
  baseUrl: string;
  token: string;
  wireFormat: 'openai' | 'anthropic';
}

export interface ConfigPlan {
  clientId: string;
  filePath: string;
  before: string;
  after: string;
  backupId: string;
}

export interface ApplyResult {
  backupId: string;
  filePath: string;
  ok: true;
}

export interface ValidateResult {
  ok: boolean;
  reachable: boolean;
  message: string;
}

export interface ClientIntegration {
  id: string;
  label: string;
  supportState: SupportState;
  detect(): Promise<DetectResult>;
  inspect(): Promise<InspectResult>;
  plan(target: ConfigTarget): Promise<ConfigPlan>;
  apply(plan: ConfigPlan): Promise<ApplyResult>;
  validate(): Promise<ValidateResult>;
  rollback(backupId: string): Promise<void>;
  launch?(): Promise<void>;
}
