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

export type AnthropicContentBlock = AnthropicTextBlock | AnthropicImageBlock;

export interface AnthropicMessage {
  role: AnthropicRole;
  content: string | AnthropicContentBlock[];
}

export interface MessagesRequest {
  model: string;
  messages: AnthropicMessage[];
  max_tokens: number;
  system?: string;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  top_k?: number;
  stop_sequences?: string[];
  [key: string]: unknown;
}

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
}

export type AnthropicStopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'stop_sequence'
  | 'tool_use'
  | null;

export interface MessagesResponse {
  id: string;
  type: 'message';
  role: 'assistant';
  content: AnthropicContentBlock[];
  model: string;
  stop_reason: AnthropicStopReason;
  stop_sequence: string | null;
  usage: AnthropicUsage;
}
