// ─── OpenAI-compatible types ──────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface Message {
  role: Role;
  content: string | ContentPart[];
  name?: string;
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  input?: Message[]; // /v1/responses compatibility
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  n?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
  max_output_tokens?: number;
  stop?: string | string[];
  presence_penalty?: number;
  frequency_penalty?: number;
  user?: string;
  [key: string]: unknown;
}

export interface UsageInfo {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  /** Breakdown of prompt tokens (e.g. cached tokens for OpenAI prompt caching) */
  prompt_tokens_details?: { cached_tokens?: number };
}

export interface Choice {
  index: number;
  message: Message;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Choice[];
  usage: UsageInfo;
}

// ─── Streaming ────────────────────────────────────────────────────────────────

export interface ChoiceDelta {
  role?: Role;
  content?: string | null;
}

export interface StreamChoice {
  index: number;
  delta: ChoiceDelta;
  finish_reason: 'stop' | 'length' | null;
}

export interface StreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: StreamChoice[];
}

// ─── Models list ──────────────────────────────────────────────────────────────

export interface ModelObject {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface ModelsListResponse {
  object: 'list';
  data: ModelObject[];
}
