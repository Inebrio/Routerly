/**
 * Synthetic conversations used as optimizer preview material.
 *
 * These exist because real traffic must never be captured or served (see the
 * removal of the traffic-sample ring). They are versioned with the repo, so a
 * pipeline tuned against a fixture behaves the same on every install, and a
 * demo produces the same numbers everywhere.
 *
 * Every message here is written for this file. No real prompt, no customer
 * data, no third-party corpus.
 */

import type { Message } from './types/openai.js';

export interface OptimizerFixture {
  /** Stable id, referenced by the dashboard picker and the CLI --fixture flag. */
  id: string;
  label: string;
  /** ISO 639-1 code of the conversation language, or 'mixed'. */
  language: string;
  /** What this fixture is meant to exercise, one line. */
  description: string;
  messages: Message[];
}

export const OPTIMIZER_FIXTURES: OptimizerFixture[] = [
  {
    id: 'support-chat-en',
    label: 'Support chat (English, 6 turns)',
    language: 'en',
    description: 'A repetitive multi-turn support thread. Exercises ccr, session-dedup and relevance.',
    messages: [
      { role: 'system', content: 'You are a support agent for an online store. Be brief and factual.' },
      { role: 'user', content: 'Hi, I would just like to ask about my order 88421, it has not arrived yet.' },
      { role: 'assistant', content: 'Order 88421 shipped on the 12th and is in transit. Estimated delivery is the 19th.' },
      { role: 'user', content: 'Ok but I really need it before the 17th, is that possible at all?' },
      { role: 'assistant', content: 'I cannot change the delivery date of a shipment already in transit. You can request a redirect to a pickup point, which is usually one day faster.' },
      { role: 'user', content: 'Alright, please do the redirect then, to the pickup point near me.' },
      { role: 'assistant', content: 'I need the pickup point id. You can find the list of points near your postcode in the tracking page.' },
      { role: 'user', content: 'The point id is PP-4471.' },
      { role: 'assistant', content: 'Redirect requested to PP-4471. You will get a confirmation email within one hour.' },
      { role: 'user', content: 'Thank you. One more thing, can I also change the invoice address for this order?' },
      { role: 'assistant', content: 'The invoice address is fixed once the order is paid. I can issue a corrected invoice after delivery if you send me the new address.' },
      { role: 'user', content: 'Ok, and what about the refund I asked for on order 88109, is that done?' },
    ],
  },
  {
    id: 'brief-en',
    label: 'Long brief (English, single turn)',
    language: 'en',
    description: 'A long single-turn instruction, dense with filler. Exercises caveman and llmlingua-2.',
    messages: [
      {
        role: 'user',
        content: [
          'You are a senior strategy consultant and you have to produce a set of recommendations for the board of a manufacturing company that has three hundred and fifty employees and three plants.',
          'The report should not exceed two thousand five hundred words in the main body and it must contain a comparative analysis of at least three alternative investment scenarios, each one with a cost benefit analysis projected over three and five years.',
          'Every scenario must state the quantitative assumptions that were used, because the board has to be able to challenge each of them on its own without reading the whole document again.',
          'Do not use empty phrases such as leveraging synergies or enabling the transformation: every sentence that could be removed without loss of meaning has to be removed before delivery.',
          'The document must close with a clear recommendation, not with a neutral list of the available options.',
        ].join('\n\n'),
      },
    ],
  },
  {
    id: 'agent-tools-en',
    label: 'Coding agent with tool results (English)',
    language: 'en',
    description: 'File paths, fenced code and a JSON array tool result. Exercises path protection and json-table.',
    messages: [
      { role: 'system', content: 'You are a coding agent. Read files before editing them.' },
      { role: 'user', content: 'Open docs/concepts/on-call.md and src/a/index.ts, then run scripts/for-each/do-it.sh and report what it prints.' },
      {
        role: 'assistant',
        content: 'I will read the two files first.\n\n```bash\ncat docs/concepts/on-call.md\n```',
      },
      { role: 'user', content: 'Here is the directory listing you asked for.' },
      // The payload is its own message, the way a tool result actually arrives.
      // json-table only compacts a message that is nothing but a JSON array.
      {
        role: 'user',
        content: '[{"path":"src/a/index.ts","bytes":1420,"modified":"2026-07-01"},{"path":"src/b/index.ts","bytes":880,"modified":"2026-07-02"},{"path":"src/c/index.ts","bytes":2310,"modified":"2026-07-03"},{"path":"src/d/index.ts","bytes":640,"modified":"2026-07-04"},{"path":"src/e/index.ts","bytes":1190,"modified":"2026-07-05"},{"path":"src/f/index.ts","bytes":2040,"modified":"2026-07-06"},{"path":"src/g/index.ts","bytes":760,"modified":"2026-07-07"},{"path":"src/h/index.ts","bytes":1530,"modified":"2026-07-08"},{"path":"src/i/index.ts","bytes":990,"modified":"2026-07-09"},{"path":"src/j/index.ts","bytes":1870,"modified":"2026-07-10"}]',
      },
      { role: 'assistant', content: 'Ten files. The largest is src/c/index.ts at 2310 bytes. I will start there.' },
      { role: 'user', content: 'Yes, and please do not touch scripts/for-each/do-it.sh, it must stay exactly as it is.' },
    ],
  },
];

/** One fixture by id, or undefined for an unknown id. */
export function optimizerFixture(id: string): OptimizerFixture | undefined {
  return OPTIMIZER_FIXTURES.find(f => f.id === id);
}
