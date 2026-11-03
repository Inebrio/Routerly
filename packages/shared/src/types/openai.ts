// ─── OpenAI-compatible types ──────────────────────────────────────────────────

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ContentPart {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

/** Assistant tool invocation in the OpenAI chat-completions wire format. */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface Message {
  role: Role;
  content: string | ContentPart[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

/** Tool definition in the OpenAI chat-completions wire format. */
export interface ToolDefinition {
  type: 'function';
  function: { name: string; description?: string; parameters?: Record<string, unknown> };
}

export interface ChatCompletionRequest {
  model: string;
  messages: Message[];
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  n?: number;
  max_tokens?: number;
  max_completion_tokens?: number;
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

/** Streamed slice of a tool call: `index` identifies which call the fragment belongs to. */
export interface ToolCallDelta {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
}

export interface ChoiceDelta {
  role?: Role;
  content?: string | null;
  tool_calls?: ToolCallDelta[];
}

export interface StreamChoice {
  index: number;
  delta: ChoiceDelta;
  finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | null;
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
