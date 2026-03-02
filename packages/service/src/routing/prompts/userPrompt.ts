import type { ChatCompletionRequest } from '@localrouter/shared';

const MAX_MESSAGE_LENGTH = 1200;

type MsgPart = { type: string; text?: string };
type Msg     = { role: string; content: string | MsgPart[] };
type ReqShape = { model: string; stream?: boolean; messages: Msg[] };

export type RoutingOption = { modelId: string; prompt?: string };

function extractText(content: string | MsgPart[]): string {
  if (typeof content === 'string') return content;
  return content.filter((p) => p.type === 'text').map((p) => p.text ?? '').join(' ');
}

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '...' : text;
}

export function buildDefaultRoutingUserPrompt(
  request: ChatCompletionRequest,
  routingOptions: RoutingOption[],
): string {
  const req = request as unknown as ReqShape;
  const messages = req.messages;

  // Last user message is the main input to route
  const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user');
  const lastUserText = lastUserMsg
    ? truncate(extractText(lastUserMsg.content), MAX_MESSAGE_LENGTH)
    : '(no user message)';

  // System prompt (if any)
  const systemMsg = messages.find((m) => m.role === 'system');
  const systemText = systemMsg ? extractText(systemMsg.content) : null;

  // Build routing options block
  const optionsBlock = routingOptions
    .map((o) => {
      const label = o.prompt ? `${o.modelId}: ${o.prompt}` : o.modelId;
      return ` - ${label}`;
    })
    .join('\n');

  const parts: string[] = [];

  if (systemText) {
    parts.push(`## System prompt\n${systemText}`);
  }

  parts.push(`## Message\n${lastUserText}`);

  parts.push(`## Routing options\n${optionsBlock}`);

  return parts.join('\n\n');
}
