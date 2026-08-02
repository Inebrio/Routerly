// ─── Anthropic-compatible types ───────────────────────────────────────────────

export type AnthropicRole = 'user' | 'assistant';

export interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

export interface AnthropicImageSource {
  type: 'base64' | 'url';
  media_type?: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
  data?: string;
  url?: string;
}

export interface AnthropicImageBlock {
  type: 'image';
  source: AnthropicImageSource;
}

/** Assistant-side tool invocation. `input` is the fully-formed tool argument object. */
export interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** User-side reply to a tool_use, carrying the tool's output. */
export interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  is_error?: boolean;
}

export type AnthropicContentBlock =
  | AnthropicTextBlock
  | AnthropicImageBlock
  | AnthropicToolUseBlock
  | AnthropicToolResultBlock;

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
}

/** Tool definition as sent by Anthropic clients (Claude Code included). */
export interface AnthropicTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  [key: string]: unknown;
}

export type AnthropicToolChoice =
  | { type: 'auto' | 'any' | 'none' }
  | { type: 'tool'; name: string };

/** A system prompt is either plain text or a list of text blocks (optionally cache-controlled). */
export type AnthropicSystem = string | Array<{ type: string; text?: string; [key: string]: unknown }>;

export interface MessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: AnthropicSystem;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  tools?: AnthropicTool[];
  tool_choice?: AnthropicToolChoice;
  [key: string]: unknown;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  /** Tokens read from prompt cache (charged at reduced rate) */
  cache_read_input_tokens?: number;
  /** Tokens written to prompt cache (charged at slightly higher rate) */
  cache_creation_input_tokens?: number;
}

export type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | 'refusal'
  | null;

/** Detail for a refusal stop, surfaced when a guardrail blocks the response (#77). */
export interface AnthropicStopDetails {
  type: 'refusal';
  category?: string;
  explanation?: string;
}

export interface MessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: AnthropicStopReason;
  /** Present on refusal stops (guardrail block, #77). */
  stop_details?: AnthropicStopDetails;
  stop_sequence?: string | null;
  usage: AnthropicUsage;
}
