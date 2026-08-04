#!/usr/bin/env node
// Where the time and the tokens actually went.
//
// Every agent run leaves a complete record, and nothing ever read it, so every
// retrospective so far was written from impressions. This reads all of it and
// attributes each run to a story and to a point in the process, so "which part
// is expensive" has an answer with numbers behind it.
//
//   node .claude/scripts/agent-cost.mjs                     # this feature
//   node .claude/scripts/agent-cost.mjs --feature <name>    # another one
//   node .claude/scripts/agent-cost.mjs --runs              # every run listed
//   node .claude/scripts/agent-cost.mjs --json              # machine readable
//
// ## Why this reads four things and not one
//
// The obvious source is the session transcript, and on its own it is wrong by
// an order of magnitude. Three separate gaps, each of which hides cost:
//
// 1. A FOREGROUND agent writes a full `toolUseResult`: agentType, duration,
//    tokens, tool stats. This is the only shape that is self-describing, and
//    almost nothing uses it.
//
// 2. A BACKGROUND agent writes a `toolUseResult` with no usage at all, just
//    `{agentId, description, prompt, outputFile, isAsync}`. Its cost arrives
//    later as TEXT, inside the `<task-notification>` block. Miss that and every
//    background agent looks free.
//
// 3. A NESTED agent, one an orchestrator dispatched, appears in the parent
//    transcript NOWHERE. In this project that is 104 runs out of 133: the
//    engineers, which is to say the part that writes the code. Reading only the
//    parent transcript accounts for a fifth of the agents and none of the
//    implementation.
//
// So the real unit is the per-agent transcript on tmp, one `<agentId>.output`
// file each, which is also the only place the input/output split exists. Those
// files are walked directly. The parent transcript is still read, for two
// things it alone knows: which role each agent was dispatched as, and the
// notification totals for agents whose tmp file has already been reaped.
//
// ## Why IN is split three ways
//
// Fresh input, cache writes and cache reads do not cost the same. Collapsing
// them into one "tokens" number makes a run that re-read a large cached context
// look identical to one that built it. At this volume that difference is most
// of the bill.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const PROJECT_SLUG = '-Users-carlosatta-Documents-lavoro-inebrio-routerly-ai-code';
const TRANSCRIPTS = join(homedir(), '.claude', 'projects', PROJECT_SLUG);
const SIDECHAINS = join('/private/tmp/claude-501', PROJECT_SLUG);

// The pipeline in the order it runs, so the expensive stage reads as a stage.
const PHASE_ORDER = [
  'analyst',
  'story-writer',
  'project-manager',
  'orchestrator',
  'backend-engineer',
  'frontend-engineer',
  'validator',
  'qa-engineer',
  'docs-writer',
];

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n, d) => {
  const i = argv.indexOf(n);
  return i === -1 || i === argv.length - 1 ? d : argv[i + 1];
};

const FEATURE = opt('--feature', 'release-automation');
const AS_JSON = flag('--json');
const SHOW_RUNS = flag('--runs');

const STORY_RE = /\bRA-\d{2}\b/;
const TASKID_RE = /<task-id>\s*([a-z0-9]+)\s*<\/task-id>/;
const TOKENS_RE = /<subagent_tokens>\s*(\d+)\s*<\/subagent_tokens>/;
const TOOLS_RE = /<tool_uses>\s*(\d+)\s*<\/tool_uses>/;
const MS_RE = /<duration_ms>\s*(\d+)\s*<\/duration_ms>/;
const RESULT_RE = /<result>([\s\S]*?)<\/result>/;

/** agentId -> run */
const byAgent = new Map();
/** sessionId -> the main session's own consumption */
const mainSessions = new Map();

const blank = (agentId) => ({
  agentId,
  story: null,
  role: null,
  description: null,
  model: null,
  session: null,
  at: null,
  parent: null,
  nested: false,
  stints: 0,
  ms: 0,
  notifTokens: 0,
  tools: 0,
  resultChars: 0,
  input: 0,
  out: 0,
  cacheWrite: 0,
  cacheRead: 0,
  messages: 0,
  edits: 0,
  hasSidechain: false,
  fg: { input: 0, out: 0, cacheWrite: 0, cacheRead: 0 },
});

const ensure = (agentId) => {
  let r = byAgent.get(agentId);
  if (!r) byAgent.set(agentId, (r = blank(agentId)));
  return r;
};

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (typeof c === 'string' ? c : typeof c?.text === 'string' ? c.text : ''))
      .join('');
  }
  if (content && typeof content === 'object') return JSON.stringify(content);
  return '';
};

const readLines = (path) => {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      if (parsed && typeof parsed === 'object') out.push(parsed);
    } catch {
      // a half-written tail line while a session is still live
    }
  }
  return { text, entries: out };
};

// ---------------------------------------------------------------------------
// Pass 1 — every transcript, parent and sidechain alike, for identity and role.
//
// Roles come from the Agent tool_use that dispatched the agent, which lives in
// whichever transcript did the dispatching: the parent for a story's
// orchestrator, the orchestrator's own sidechain for the engineers under it.
// Walking them all with the same code is what makes nested agents visible.
// ---------------------------------------------------------------------------

const sources = [];
for (const name of readdirSync(TRANSCRIPTS)) {
  if (!name.endsWith('.jsonl')) continue;
  const path = join(TRANSCRIPTS, name);
  if (statSync(path).size === 0) continue;
  sources.push({ path, kind: 'parent', agentId: null });
}
if (existsSync(SIDECHAINS)) {
  for (const session of readdirSync(SIDECHAINS)) {
    const dir = join(SIDECHAINS, session, 'tasks');
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.output')) continue;
      sources.push({ path: join(dir, file), kind: 'sidechain', agentId: file.slice(0, -'.output'.length) });
    }
  }
}

/** tool_use id -> {role, description} */
const dispatchedAs = new Map();
/** agentId -> the agentId of whoever dispatched it */
const parentOf = new Map();
// A nested agent is not linked to its dispatcher by any id that both sides
// record. What both sides do hold, verbatim, is the prompt: the orchestrator's
// `Agent` call input, and the first user message of the child's own transcript.
// Keying on a prefix of that text is what recovers the role for the engineers,
// who are 67 of the 95 runs and all of the code.
/** prompt prefix -> {role, description, parent} */
const dispatchedByPrompt = new Map();
const promptKey = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 240);

const loaded = [];
for (const src of sources) {
  const file = readLines(src.path);
  if (!file) continue;
  // Sidechain files are kept regardless: a nested engineer's prompt names its
  // story, and its parent chain is what ties it to the feature.
  if (src.kind === 'parent' && !file.text.includes(FEATURE) && !STORY_RE.test(file.text)) continue;
  loaded.push({ ...src, entries: file.entries });

  for (const o of file.entries) {
    if (o.type === 'assistant' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c?.type === 'tool_use' && c.name === 'Agent') {
          const entry = {
            role: c.input?.subagent_type || 'claude',
            description: c.input?.description || '',
            prompt: typeof c.input?.prompt === 'string' ? c.input.prompt : '',
            parent: src.agentId,
          };
          dispatchedAs.set(c.id, entry);
          if (entry.prompt) dispatchedByPrompt.set(promptKey(entry.prompt), entry);
        }
      }
    }
    const r = o.toolUseResult;
    if (r && typeof r === 'object' && r.agentId && src.agentId) parentOf.set(r.agentId, src.agentId);
  }
}

// ---------------------------------------------------------------------------
// Pass 2 — the three result shapes.
// ---------------------------------------------------------------------------

for (const src of loaded) {
  for (const o of src.entries) {
    // The main session's own consumption. It never appears in any
    // toolUseResult, and on a feature run by agents it is not a rounding error:
    // the main session reads every report, every worktree and every artifact.
    if (src.kind === 'parent' && o.type === 'assistant' && !o.isSidechain && o.message?.usage) {
      const u = o.message.usage;
      const acc = mainSessions.get(o.sessionId) || { input: 0, out: 0, cacheWrite: 0, cacheRead: 0, turns: 0 };
      acc.input += u.input_tokens || 0;
      acc.out += u.output_tokens || 0;
      acc.cacheWrite += u.cache_creation_input_tokens || 0;
      acc.cacheRead += u.cache_read_input_tokens || 0;
      acc.turns += 1;
      mainSessions.set(o.sessionId, acc);
    }

    const r = o.toolUseResult;
    const toolUseId = Array.isArray(o.message?.content) ? o.message.content[0]?.tool_use_id : null;
    const meta = toolUseId ? dispatchedAs.get(toolUseId) : null;

    // shape 1 — foreground agent, self-describing
    if (r && typeof r === 'object' && r.agentType && r.agentId) {
      const rec = ensure(r.agentId);
      const prompt = typeof r.prompt === 'string' ? r.prompt : meta?.prompt || '';
      rec.story = rec.story || (prompt.match(STORY_RE) || [null])[0];
      rec.role = rec.role || r.agentType;
      rec.model = rec.model || r.resolvedModel;
      rec.session = rec.session || o.sessionId;
      rec.at = rec.at || o.timestamp;
      rec.description = rec.description || meta?.description || null;
      rec.stints += 1;
      rec.ms += r.totalDurationMs || 0;
      rec.notifTokens += r.totalTokens || 0;
      rec.tools += r.totalToolUseCount || 0;
      rec.edits += r.toolStats?.editFileCount || 0;
      // Held aside: the sidechain file, if it survives, is the better source.
      rec.fg.input += r.usage?.input_tokens || 0;
      rec.fg.out += r.usage?.output_tokens || 0;
      rec.fg.cacheWrite += r.usage?.cache_creation_input_tokens || 0;
      rec.fg.cacheRead += r.usage?.cache_read_input_tokens || 0;
      rec.resultChars = Math.max(rec.resultChars, textOf(r.content).length);
      rec.reported = true;
      continue;
    }

    // shape 2 — background agent, identity only, cost arrives later
    if (r && typeof r === 'object' && r.agentId && r.isAsync) {
      const rec = ensure(r.agentId);
      const prompt = typeof r.prompt === 'string' ? r.prompt : '';
      rec.story = rec.story || (prompt.match(STORY_RE) || [null])[0];
      rec.description = rec.description || r.description || meta?.description || null;
      rec.role = rec.role || meta?.role || null;
      rec.model = rec.model || r.resolvedModel;
      rec.session = rec.session || o.sessionId;
      rec.at = rec.at || o.timestamp;
      continue;
    }

    // shape 3 — the notification block that carries a background run's cost
    if (o.message?.content) {
      const body = textOf(o.message.content);
      if (!body.includes('<subagent_tokens>')) continue;
      const id = body.match(TASKID_RE);
      const tok = body.match(TOKENS_RE);
      if (!id || !tok) continue;
      const rec = ensure(id[1]);
      rec.stints += 1;
      rec.notifTokens += Number(tok[1]);
      rec.tools += Number((body.match(TOOLS_RE) || [0, 0])[1]);
      rec.ms += Number((body.match(MS_RE) || [0, 0])[1]);
      rec.session = rec.session || o.sessionId;
      rec.at = rec.at || o.timestamp;
      const res = body.match(RESULT_RE);
      rec.resultChars = Math.max(rec.resultChars, res ? res[1].trim().length : 0);
      rec.reported = true;
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 3 — the per-agent transcripts. One file per agent; this is where the
// input/output split lives, and where the nested engineers live at all.
// ---------------------------------------------------------------------------

for (const src of loaded) {
  if (src.kind !== 'sidechain') continue;
  const rec = ensure(src.agentId);
  rec.hasSidechain = true;
  rec.parent = rec.parent || parentOf.get(src.agentId) || null;

  let first = null;
  let last = null;
  let firstPrompt = '';
  for (const o of src.entries) {
    if (o.timestamp) {
      first = first || o.timestamp;
      last = o.timestamp;
    }
    if (!firstPrompt && o.type === 'user') firstPrompt = textOf(o.message?.content);
    rec.session = rec.session || o.sessionId;
    const u = o.type === 'assistant' ? o.message?.usage : null;
    if (!u) continue;
    rec.input += u.input_tokens || 0;
    rec.out += u.output_tokens || 0;
    rec.cacheWrite += u.cache_creation_input_tokens || 0;
    rec.cacheRead += u.cache_read_input_tokens || 0;
    rec.messages += 1;
  }
  if (first && last && !rec.ms) rec.ms = Date.parse(last) - Date.parse(first);
  rec.at = rec.at || first;

  // Recover role, description and dispatcher from the prompt the parent used.
  const dispatch = dispatchedByPrompt.get(promptKey(firstPrompt));
  if (dispatch) {
    rec.role = rec.role || dispatch.role;
    rec.description = rec.description || dispatch.description;
    rec.parent = rec.parent || dispatch.parent;
    rec.nested = rec.nested || Boolean(dispatch.parent);
    if (!rec.story) rec.story = (dispatch.prompt.match(STORY_RE) || [null])[0];
  }

  if (!rec.story) rec.story = (firstPrompt.match(STORY_RE) || [null])[0];
  if (!rec.story && !firstPrompt.includes(FEATURE)) rec.foreign = true;
  // A sidechain file is one stint by definition; the notification path already
  // counted its own, so only fill in when nothing else did.
  if (!rec.stints) rec.stints = 1;
}

// An agent inherits its story from whoever dispatched it. An engineer's prompt
// usually names the story anyway, but a follow-up task inside one run may not.
for (let i = 0; i < 4; i++) {
  for (const rec of byAgent.values()) {
    if (rec.story || !rec.parent) continue;
    const p = byAgent.get(rec.parent);
    if (p?.story) rec.story = p.story;
  }
}
// Same for role: an unlabelled nested agent under an orchestrator is an
// engineer, and calling it "nested" rather than guessing which kind keeps the
// phase table honest.
for (const rec of byAgent.values()) {
  if (!rec.role && rec.parent) rec.role = 'nested (engineer)';
}

// The analyst and the story-writer run before any story exists, so they name
// none. Dropping them for that would hide the whole front of the pipeline,
// which is exactly the part nobody has numbers for.
for (const rec of byAgent.values()) {
  if (rec.story || rec.foreign) continue;
  if (['analyst', 'story-writer'].includes(rec.role)) rec.story = '(feature)';
}

const runs = [...byAgent.values()].filter((r) => r.story && !r.foreign && (r.messages > 0 || r.notifTokens > 0));
runs.sort((a, b) => (String(a.at) < String(b.at) ? -1 : 1));
for (const r of runs) {
  r.role = r.role || 'unknown';
  if (!r.hasSidechain) {
    r.input = r.fg.input;
    r.out = r.fg.out;
    r.cacheWrite = r.fg.cacheWrite;
    r.cacheRead = r.fg.cacheRead;
  }
  r.readTotal = r.input + r.cacheWrite + r.cacheRead;
}

const sum = (list, key) => list.reduce((n, r) => n + (r[key] || 0), 0);

const groupBy = (key) => {
  const m = new Map();
  for (const r of runs) {
    const g = m.get(r[key]) || {
      runs: 0, ms: 0, tools: 0, stints: 0,
      input: 0, out: 0, cacheWrite: 0, cacheRead: 0, readTotal: 0, messages: 0,
    };
    g.runs += 1;
    for (const f of ['ms', 'tools', 'stints', 'input', 'out', 'cacheWrite', 'cacheRead', 'readTotal', 'messages']) {
      g[f] += r[f] || 0;
    }
    m.set(r[key], g);
  }
  return m;
};

// Rework, two kinds, kept apart because they mean different things.
//   resumed — one agent woken up again after ending with nothing. Always waste.
//   repeats — the same role dispatched twice on one story. A second validator
//             round is designed behaviour; a second orchestrator is not.
const resumed = runs.filter((r) => r.stints > 1);
const repeats = new Map();
for (const r of runs) {
  const key = `${r.story} ${r.role}`;
  repeats.set(key, (repeats.get(key) || []).concat([r]));
}
// Only runs whose result text was actually captured can be judged this way. A
// nested engineer's answer is never quoted anywhere, so an empty `resultChars`
// on one of those means "not recorded", not "returned nothing", and counting it
// as a stall would turn every engineer in the project into a failure.
const stalls = runs.filter((r) => r.reported && r.ms > 240_000 && r.resultChars < 400);

const mins = (ms) => (ms / 60000).toFixed(0);
const k = (n) => (n >= 1_000_000 ? `${(n / 1e6).toFixed(1)}M` : n >= 1000 ? `${(n / 1000).toFixed(0)}k` : String(n));
const pad = (s, n) => String(s).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);
const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(0)}%` : '-');

const mainTotals = [...mainSessions.values()].reduce(
  (a, s) => ({
    input: a.input + s.input,
    out: a.out + s.out,
    cacheWrite: a.cacheWrite + s.cacheWrite,
    cacheRead: a.cacheRead + s.cacheRead,
    turns: a.turns + s.turns,
  }),
  { input: 0, out: 0, cacheWrite: 0, cacheRead: 0, turns: 0 },
);
const mainRead = mainTotals.input + mainTotals.cacheWrite + mainTotals.cacheRead;

if (AS_JSON) {
  console.log(JSON.stringify({
    feature: FEATURE,
    runs,
    byStory: Object.fromEntries(groupBy('story')),
    byPhase: Object.fromEntries(groupBy('role')),
    mainSessions: Object.fromEntries(mainSessions),
    mainTotals,
    resumed: resumed.map((r) => ({ story: r.story, role: r.role, stints: r.stints, ms: r.ms, out: r.out })),
    stalls: stalls.map((r) => ({ story: r.story, role: r.role, ms: r.ms, out: r.out, resultChars: r.resultChars })),
  }, null, 2));
  process.exit(0);
}

const agentRead = sum(runs, 'readTotal');
const agentOut = sum(runs, 'out');
const totalRead = agentRead + mainRead;
const totalOut = agentOut + mainTotals.out;
const missing = runs.filter((r) => !r.hasSidechain).length;

console.log(`\n=== ${FEATURE} — ${runs.length} agent runs, ${new Set(runs.map((r) => r.session)).size} sessions ===\n`);
console.log(`${pad('', 16)}${lpad('IN (read)', 12)}${lpad('OUT', 10)}${lpad('minutes', 10)}${lpad('tool calls', 12)}`);
console.log(`${pad('agents', 16)}${lpad(k(agentRead), 12)}${lpad(k(agentOut), 10)}${lpad(mins(sum(runs, 'ms')), 10)}${lpad(sum(runs, 'tools'), 12)}`);
console.log(`${pad('main session', 16)}${lpad(k(mainRead), 12)}${lpad(k(mainTotals.out), 10)}${lpad('-', 10)}${lpad(`${mainTotals.turns} turns`, 12)}`);
console.log(`${pad('TOTAL', 16)}${lpad(k(totalRead), 12)}${lpad(k(totalOut), 10)}`);
console.log(`\nIN breaks down as: fresh ${k(sum(runs, 'input') + mainTotals.input)}, cache-write ${k(sum(runs, 'cacheWrite') + mainTotals.cacheWrite)}, cache-read ${k(sum(runs, 'cacheRead') + mainTotals.cacheRead)}.`);
console.log(`The three do not cost the same, which is why one "tokens" number would mislead:`);
console.log(`cache reads are the discounted bulk, writes are paid once per prefix, OUT is dear.`);
console.log(`Agent minutes overlap, so real elapsed time is well under the sum.`);
if (missing) console.log(`\n${missing}/${runs.length} runs kept only a notification total: their tmp transcript was reaped.`);

console.log('\n--- by point in the process --------------------------------------------------');
console.log(`${pad('phase', 20)}${lpad('runs', 5)}${lpad('min', 7)}${lpad('avg min', 9)}${lpad('IN', 9)}${lpad('OUT', 8)}${lpad('avg OUT', 9)}${lpad('% of IN', 9)}${lpad('tools', 7)}`);
const phaseRank = (r) => {
  const i = PHASE_ORDER.indexOf(r);
  return i === -1 ? PHASE_ORDER.length : i;
};
for (const [role, g] of [...groupBy('role')].sort((a, b) => phaseRank(a[0]) - phaseRank(b[0]) || b[1].readTotal - a[1].readTotal)) {
  console.log(
    `${pad(role, 20)}${lpad(g.runs, 5)}${lpad(mins(g.ms), 7)}${lpad((g.ms / g.runs / 60000).toFixed(1), 9)}` +
    `${lpad(k(g.readTotal), 9)}${lpad(k(g.out), 8)}${lpad(k(Math.round(g.out / g.runs)), 9)}${lpad(pct(g.readTotal, totalRead), 9)}${lpad(g.tools, 7)}`,
  );
}
console.log(
  `${pad('main session', 20)}${lpad('-', 5)}${lpad('-', 7)}${lpad('-', 9)}` +
  `${lpad(k(mainRead), 9)}${lpad(k(mainTotals.out), 8)}${lpad('-', 9)}${lpad(pct(mainRead, totalRead), 9)}${lpad('-', 7)}`,
);

console.log('\n--- by story -----------------------------------------------------------------');
console.log(`${pad('story', 12)}${lpad('runs', 5)}${lpad('min', 7)}${lpad('IN', 9)}${lpad('OUT', 8)}${lpad('% of IN', 9)}${lpad('tools', 7)}${lpad('resumes', 9)}`);
for (const [story, g] of [...groupBy('story')].sort((a, b) => b[1].readTotal - a[1].readTotal)) {
  console.log(`${pad(story, 12)}${lpad(g.runs, 5)}${lpad(mins(g.ms), 7)}${lpad(k(g.readTotal), 9)}${lpad(k(g.out), 8)}${lpad(pct(g.readTotal, agentRead), 9)}${lpad(g.tools, 7)}${lpad(g.stints - g.runs, 9)}`);
}

if (resumed.length) {
  console.log('\n--- agents that had to be resumed --------------------------------------------');
  console.log('(each extra stint is a run that ended without producing its deliverable)');
  console.log(`${pad('story', 10)}${pad('role', 22)}${lpad('stints', 8)}${lpad('min', 7)}${lpad('IN', 9)}${lpad('OUT', 8)}`);
  for (const r of [...resumed].sort((a, b) => b.readTotal - a.readTotal)) {
    console.log(`${pad(r.story, 10)}${pad(r.role, 22)}${lpad(r.stints, 8)}${lpad(mins(r.ms), 7)}${lpad(k(r.readTotal), 9)}${lpad(k(r.out), 8)}`);
  }
  console.log(`\nin resumed runs: ${mins(sum(resumed, 'ms'))} min, IN ${k(sum(resumed, 'readTotal'))}, OUT ${k(sum(resumed, 'out'))}, over ${sum(resumed, 'stints')} stints for ${resumed.length} agents`);
}

const multi = [...repeats.entries()].filter(([, list]) => list.length > 1);
if (multi.length) {
  console.log('\n--- same role dispatched more than once on one story --------------------------');
  console.log(`${pad('story', 10)}${pad('role', 22)}${lpad('runs', 6)}${lpad('min', 7)}${lpad('IN', 9)}${lpad('OUT', 8)}`);
  for (const [key, list] of multi.sort((a, b) => sum(b[1], 'readTotal') - sum(a[1], 'readTotal'))) {
    const [story, ...rest] = key.split(' ');
    console.log(`${pad(story, 10)}${pad(rest.join(' '), 22)}${lpad(list.length, 6)}${lpad(mins(sum(list, 'ms')), 7)}${lpad(k(sum(list, 'readTotal')), 9)}${lpad(k(sum(list, 'out')), 8)}`);
  }
}

if (stalls.length) {
  console.log('\n--- runs that burned time and returned almost nothing -------------------------');
  console.log(`${pad('story', 10)}${pad('role', 22)}${lpad('min', 6)}${lpad('IN', 9)}${lpad('OUT', 8)}${lpad('result', 9)}`);
  for (const r of stalls) {
    console.log(`${pad(r.story, 10)}${pad(r.role, 22)}${lpad(mins(r.ms), 6)}${lpad(k(r.readTotal), 9)}${lpad(k(r.out), 8)}${lpad(`${r.resultChars}ch`, 9)}`);
  }
  console.log(`\nlost to these: ${mins(sum(stalls, 'ms'))} min, IN ${k(sum(stalls, 'readTotal'))}, OUT ${k(sum(stalls, 'out'))}`);
}

if (SHOW_RUNS) {
  console.log('\n--- every run, most read first -------------------------------------------------');
  console.log(`${pad('story', 8)}${pad('role', 22)}${lpad('min', 5)}${lpad('IN', 8)}${lpad('OUT', 7)}${lpad('msgs', 6)}${lpad('tools', 6)}  description`);
  for (const r of [...runs].sort((a, b) => b.readTotal - a.readTotal)) {
    console.log(`${pad(r.story, 8)}${pad(r.role, 22)}${lpad(mins(r.ms), 5)}${lpad(k(r.readTotal), 8)}${lpad(k(r.out), 7)}${lpad(r.messages, 6)}${lpad(r.tools, 6)}  ${r.description || ''}`);
  }
}

console.log('');
