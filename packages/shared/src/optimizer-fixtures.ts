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
 *
 * Each fixture is built to make specific optimizers fire, because a fixture
 * that nothing touches teaches nothing:
 *  - `support-chat-en`   session-dedup, ccr, rtk, relevance, caveman
 *  - `brief-en`          caveman and llmlingua-2 only, everything else stays inert
 *  - `agent-tools-en`    json-table, session-dedup, rtk, ccr
 *  - `long-context-en`   headroom, against a model with a small context window
 *
 * `service/src/modules/optimizers/fixtures.test.ts` asserts those claims by
 * running the optimizers, so a fixture edit that makes a step inert fails there.
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

/**
 * Verbatim hold message the support bot emits while it waits on the carrier.
 * Repeated four times below: session-dedup keeps the first and the last and
 * drops the two in between, which is the only thing that makes that optimizer
 * visible on a preview.
 */
const HOLD =
  'Thanks for staying with me. I am still waiting for the carrier system to answer, and on their side this usually takes a couple of minutes.';

/**
 * Agent signature, pasted twice inside the same message the way a copied reply
 * template actually arrives. Over 40 characters, so rtk drops the repeat.
 */
const SIGNATURE =
  'Ada Moreau, Customer Care, Northwind Supply.\nTicket portal: https://support.example.com/tickets\nOpening hours 08:00 to 18:00 CET, Monday to Friday.';

/**
 * Verbatim status line the coding agent prints before every test run. Same
 * reason as HOLD: three identical occurrences give session-dedup one to drop.
 */
const RUNNING_TESTS =
  'Running the full test suite now. This takes about ninety seconds on this machine, so I will report back as soon as it finishes.';

/**
 * One slice of gateway log, deterministic and different on every turn.
 *
 * Generated rather than pasted: `long-context-en` has to be tens of thousands of
 * tokens for the headroom optimizer to have anything to trim, and ten thousand
 * hand-written log lines in a source file would be unreadable and unreviewable.
 * The shape is a real Routerly access line; the values are arithmetic on the
 * turn index, so the fixture is byte-identical on every install.
 */
function logSlice(turn: number, lines: number): string {
  const out: string[] = [];
  for (let i = 0; i < lines; i++) {
    const seq = turn * 100 + i;
    const latency = 120 + ((seq * 37) % 1900);
    const status = latency > 1800 ? 504 : latency > 1500 ? 502 : 200;
    const minute = String((12 + turn) % 60).padStart(2, '0');
    const second = String((seq * 7) % 60).padStart(2, '0');
    const req = (seq * 2654435761).toString(16).slice(-8);
    out.push(
      `2026-07-14T09:${minute}:${second}.${String(seq % 1000).padStart(3, '0')}Z ` +
        `gw-edge-${(seq % 4) + 1} req=${req} route=chat.completions ` +
        `upstream=${seq % 3 === 0 ? 'eu-west-1/pool-b' : 'eu-central-1/pool-a'} ` +
        `model=openai/gpt-4.1-mini status=${status} latency_ms=${latency} ` +
        `tokens_in=${900 + ((seq * 13) % 2100)} tokens_out=${60 + ((seq * 29) % 700)} ` +
        `retry=${seq % 11 === 0 ? 1 : 0} project=checkout-api`,
    );
  }
  return out.join('\n');
}

/** The 45 log-review turns of `long-context-en`. */
function incidentTurns(): Message[] {
  const messages: Message[] = [];
  for (let turn = 0; turn < 45; turn++) {
    messages.push({
      role: 'user',
      content:
        `Slice ${turn + 1} of the edge log, still inside the incident window. ` +
        `Tell me whether the 502s and 504s in here are the same failure as the previous slice, ` +
        `and whether the retry column moves with them.\n\n` +
        logSlice(turn, 12),
    });
    messages.push({
      role: 'assistant',
      content:
        `Slice ${turn + 1}: the failures are still concentrated on the ${turn % 3 === 0 ? 'eu-west-1/pool-b' : 'eu-central-1/pool-a'} upstream, ` +
        `and every request over 1500 ms in this window ends as a 502 or a 504 rather than as a slow success. ` +
        `The retry column only moves on one request in eleven, so the gateway is not amplifying the load: ` +
        `what you are seeing is the upstream taking longer than the read timeout under a load level the pool was sized below. ` +
        `Nothing in this slice contradicts the reading of the previous one.`,
    });
  }
  return messages;
}

export const OPTIMIZER_FIXTURES: OptimizerFixture[] = [
  {
    id: 'support-chat-en',
    label: 'Support chat (English, 17 messages)',
    language: 'en',
    description:
      'A long support thread with a repeated hold message, pasted order details and a duplicated signature. Exercises session-dedup, ccr, rtk, relevance and caveman.',
    messages: [
      {
        role: 'system',
        content:
          'You are a customer care agent for Northwind Supply, an online store that sells workshop tools. ' +
          'Answer only from the order data the customer gives you, never invent a delivery date, and never promise a refund before the return has been received in the warehouse. ' +
          'If the carrier system does not answer, say so and keep the customer informed rather than guessing.',
      },
      {
        role: 'user',
        content:
          'Hello, I am writing about order 88421 which I placed on the 9th of July and which has still not arrived. ' +
          'The tracking page has been saying the same thing for four days now and I am starting to think the parcel is actually lost somewhere. ' +
          'I really need those parts before the end of next week because the workshop is booked for a job that depends on them, so I would like to know what is actually going on.',
      },
      {
        role: 'assistant',
        content: `I have opened order 88421 and this is what the carrier is reporting right now.

Order      88421
Status     In transit
Carrier    Northline Express
Shipped    12 July 2026
Last scan  Hub Lyon, 15 July 2026, 04:12
ETA        19 July 2026



The parcel is not lost: it left the Lyon hub and the scan history is continuous, which is what a lost parcel does not look like. The four days without an update are the road leg between Lyon and the local depot, where nothing is scanned until arrival.

${SIGNATURE}

${SIGNATURE}`,
      },
      {
        role: 'user',
        content:
          'Alright, but the 19th is honestly too late for me. Is there really no way at all to make it arrive before the 17th, ' +
          'even if I have to pay something extra for it? I would rather pay a surcharge than lose the booking.',
      },
      {
        role: 'assistant',
        content:
          'I cannot change the delivery date of a shipment that is already in transit, and no surcharge exists that would let me do it, ' +
          'because the parcel is physically on a road leg and the carrier does not accept a service upgrade after the first scan. ' +
          'What I can do is redirect it to a pickup point, which normally shortens the last leg by one working day because the parcel skips the delivery round.',
      },
      { role: 'assistant', content: HOLD },
      {
        role: 'user',
        content:
          'Fine, please do the redirect. There is a pickup point in the same street as the workshop, I have seen it on the tracking page but I do not know what its code is.',
      },
      { role: 'assistant', content: HOLD },
      {
        role: 'assistant',
        content:
          'I need the pickup point identifier before I can send the redirect request, and I cannot read the list from here. ' +
          'On the tracking page, under the map, every point near your postcode is listed with a code that starts with PP followed by four digits. ' +
          'Send me that code and the redirect goes out in the same minute.',
      },
      { role: 'user', content: 'The code is PP-4471.' },
      { role: 'assistant', content: HOLD },
      {
        role: 'assistant',
        content: `Redirect requested to PP-4471 and accepted by the carrier.    You will get a confirmation email within the hour, and a second message when the parcel is available for collection.

${SIGNATURE}

${SIGNATURE}`,
      },
      {
        role: 'user',
        content:
          'Thank you. While you are in there, I would also like to change the invoice address on this order, ' +
          'because the parts are going to the workshop but the invoice has to go to the company office, which is a different address entirely.',
      },
      {
        role: 'assistant',
        content:
          'The invoice address is frozen once the order is paid, so I cannot edit it on order 88421 itself. ' +
          'What I can do is issue a corrected invoice after delivery: send me the company name, the office address and the VAT number, ' +
          'and the corrected document replaces the original one in your account.',
      },
      { role: 'assistant', content: HOLD },
      {
        role: 'user',
        content:
          'Understood, I will send those later today. One more thing while I have you: what happened to the refund I asked for on order 88109? ' +
          'That is the one where two of the four clamps arrived bent, and I sent them back on the 2nd of July with the return label you gave me.',
      },
      {
        role: 'assistant',
        content:
          'Return 88109 was received in the warehouse on the 8th of July and the inspection is closed, with both clamps confirmed as damaged in transit. ' +
          'The refund of 64.00 EUR was issued to the original payment method on the 11th of July. ' +
          'Bank posting normally takes three to five working days from that date, so if nothing has appeared by the 18th, tell me and I will chase the payment provider with the transaction reference.',
      },
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
    label: 'Coding agent with tool results (English, 16 messages)',
    language: 'en',
    description:
      'A build-and-test session with two JSON tool results, a pasted install log and a repeated status line. Exercises json-table, session-dedup, rtk and ccr.',
    messages: [
      {
        role: 'system',
        content:
          'You are a coding agent working inside a checked out repository. Read a file before you edit it, never edit a file you were told not to touch, and run the test suite after every change you make.',
      },
      {
        role: 'user',
        content:
          'The build started failing on the release branch this morning and nobody changed the pipeline. ' +
          'Read docs/concepts/on-call.md and src/a/index.ts, then run scripts/for-each/do-it.sh and report exactly what it prints, without editing anything yet. ' +
          'Do not touch scripts/for-each/do-it.sh under any circumstance, it is generated and a manual edit there is overwritten on the next sync.',
      },
      {
        role: 'assistant',
        content:
          'Reading the two files first, then running the script. I am not editing anything on this pass, and I will leave scripts/for-each/do-it.sh alone.\n\n```bash\ncat docs/concepts/on-call.md\ncat src/a/index.ts\nbash scripts/for-each/do-it.sh\n```',
      },
      { role: 'user', content: 'Here is the directory listing you asked for.' },
      // The payload is its own message, the way a tool result actually arrives.
      // json-table only compacts a message that is nothing but a JSON array.
      {
        role: 'user',
        content:
          '[{"path":"src/a/index.ts","bytes":1420,"modified":"2026-07-01","owner":"platform"},{"path":"src/b/index.ts","bytes":880,"modified":"2026-07-02","owner":"platform"},{"path":"src/c/index.ts","bytes":2310,"modified":"2026-07-03","owner":"billing"},{"path":"src/d/index.ts","bytes":640,"modified":"2026-07-04","owner":"billing"},{"path":"src/e/index.ts","bytes":1190,"modified":"2026-07-05","owner":"platform"},{"path":"src/f/index.ts","bytes":2040,"modified":"2026-07-06","owner":"search"},{"path":"src/g/index.ts","bytes":760,"modified":"2026-07-07","owner":"search"},{"path":"src/h/index.ts","bytes":1530,"modified":"2026-07-08","owner":"platform"},{"path":"src/i/index.ts","bytes":990,"modified":"2026-07-09","owner":"billing"},{"path":"src/j/index.ts","bytes":1870,"modified":"2026-07-10","owner":"platform"},{"path":"src/k/index.ts","bytes":1240,"modified":"2026-07-11","owner":"search"},{"path":"src/l/index.ts","bytes":2610,"modified":"2026-07-12","owner":"platform"},{"path":"src/m/index.ts","bytes":430,"modified":"2026-07-13","owner":"billing"},{"path":"src/n/index.ts","bytes":1980,"modified":"2026-07-14","owner":"platform"}]',
      },
      {
        role: 'assistant',
        content:
          'Fourteen files, four owners. The largest is src/l/index.ts at 2610 bytes and the most recently modified is src/n/index.ts, which is also the one the failing job names in its stack trace. ' +
          'The on-call document says the release branch build runs the same script as the nightly job, so if the nightly is green the difference is in the environment and not in the code.',
      },
      { role: 'assistant', content: RUNNING_TESTS },
      { role: 'user', content: 'Here is what the install step printed before the tests started.' },
      {
        role: 'user',
        content: `npm  warn  deprecated  inflight@1.0.6: This module is not supported and leaks memory.

npm  warn  deprecated  glob@7.2.3: Glob versions prior to v9 are no longer supported.

npm  warn  deprecated  inflight@1.0.6: This module is not supported and leaks memory.

npm  warn  deprecated  glob@7.2.3: Glob versions prior to v9 are no longer supported.



added   412 packages in 21s
found     0 vulnerabilities

> checkout-api@2.4.0 build
> tsc -p tsconfig.json

src/n/index.ts(88,17): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.`,
      },
      { role: 'assistant', content: RUNNING_TESTS },
      {
        role: 'assistant',
        content:
          'The build fails before the tests even run: src/n/index.ts line 88 passes a possibly undefined value into a function that requires a string. ' +
          'That file was modified on the 14th, which is this morning, so the pipeline is not what changed. ' +
          'The nightly job is green because it still builds the commit from before that change.',
      },
      { role: 'user', content: 'Show me the test results from the last green run so I can see what that file was covered by.' },
      {
        role: 'user',
        content:
          '[{"suite":"checkout","tests":48,"failed":0,"skipped":1,"ms":3120},{"suite":"pricing","tests":33,"failed":0,"skipped":0,"ms":1870},{"suite":"tax","tests":27,"failed":0,"skipped":2,"ms":990},{"suite":"cart","tests":61,"failed":0,"skipped":0,"ms":4410},{"suite":"session","tests":19,"failed":0,"skipped":0,"ms":640},{"suite":"webhooks","tests":24,"failed":0,"skipped":3,"ms":2260},{"suite":"reporting","tests":15,"failed":0,"skipped":0,"ms":1180},{"suite":"admin","tests":38,"failed":0,"skipped":1,"ms":2740}]',
      },
      { role: 'assistant', content: RUNNING_TESTS },
      {
        role: 'assistant',
        content:
          'Eight suites, 265 tests, none failing on the last green run, and none of them is named after src/n/index.ts. ' +
          'The file that broke the build is the one file in the listing with no suite of its own, which is why the type error reached the release branch instead of being caught locally.',
      },
      {
        role: 'user',
        content:
          'Good. Fix the type error in src/n/index.ts, add a test for that path, and leave everything else exactly as it is. ' +
          'Remember that scripts/for-each/do-it.sh stays untouched.',
      },
    ],
  },
  {
    id: 'long-context-en',
    label: 'Incident log triage (English, very long)',
    language: 'en',
    description:
      'About 36k tokens of pasted gateway logs across 45 turns. Exercises headroom: preview it against a model whose context window is 32k or smaller, and put headroom above ccr, or ccr condenses the history first and headroom finds nothing left to trim.',
    messages: [
      {
        role: 'system',
        content:
          'You are an on-call engineer reviewing the edge gateway log of a payment platform during an incident. ' +
          'Read each slice against the previous ones, say plainly when a slice adds nothing new, and never claim a root cause the log does not support.',
      },
      ...incidentTurns(),
    ],
  },
];

/** One fixture by id, or undefined for an unknown id. */
export function optimizerFixture(id: string): OptimizerFixture | undefined {
  return OPTIMIZER_FIXTURES.find(f => f.id === id);
}
