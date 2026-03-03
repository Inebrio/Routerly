import type { ChatCompletionRequest, BudgetThresholds, ModelConfig } from '@localrouter/shared';
import type { TraceEntry } from '../traceStore.js';

/** Rappresenta un modello candidato con il peso accumulato durante la pipeline */
export interface CandidateModel {
  model: ModelConfig;
  /** Prompt specifico del progetto per questo modello (opzionale) */
  prompt?: string;
  /** Soglie di budget per-progetto (opzionale) */
  thresholds?: BudgetThresholds;
}

/** Singola voce nel risultato standard di una policy */
export interface PolicyRoutingEntry {
  model: string;   // model ID
  point: number;   // punteggio assegnato da questa policy (0.0 – 1.0)
  [key: string]: any; // campi extra opzionali specifici della policy
}

type Logger = { info: (obj: object, msg?: string) => void };

/** Input ricevuto da ogni policy */
export interface PolicyInput {
  /** Payload originale della richiesta del client */
  request: ChatCompletionRequest;
  /** Lista dei modelli candidati */
  candidates: CandidateModel[];
  /** Configurazione specifica della policy (da ProjectConfig.policies[n].config) */
  config?: any;
  /** Logger opzionale (da Fastify request.log) */
  log?: Logger;
  /** Emette una entry di trace in real-time sullo stream SSE */
  emit?: (entry: TraceEntry) => void;
  /** ID del progetto che ha originato la richiesta (per tracciare le chiamate di routing) */
  projectId?: string;
}

/** Output standard restituito da ogni policy */
export interface PolicyOutput {
  routing: PolicyRoutingEntry[];
}

/** Interfaccia che ogni policy deve implementare */
export type PolicyFn = (input: PolicyInput) => Promise<PolicyOutput>;
