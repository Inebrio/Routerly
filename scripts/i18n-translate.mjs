#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────────
// Routerly — dashboard translation drift check and generator
//   npm run i18n:translate -- --check        offline drift report (exit 1 on drift)
//   npm run i18n:translate                   translate only missing/bad keys with an LLM
// Run with --help for every option and the environment variables it reads.
// Writes only inside the locales directory. Nothing is stored in the repo:
// the LLM provider and credentials come from the caller's environment.
// ────────────────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_LOCALES_DIR = path.resolve(SCRIPT_DIR, '../packages/dashboard/src/locales');
const LOCK_NAME = '.i18n-translate.lock';
const BATCH_SIZE = 40;
const REQUEST_TIMEOUT_MS = 120_000;

// Terms that must survive translation unchanged (product terms, provider and
// model identifiers). Final list comes from the string audit (S4).
export const DO_NOT_TRANSLATE = [
  'Routerly', 'Router', 'Passthrough', 'MCP', 'OAuth', 'API', 'JSON', 'SSE', 'TOTP',
  'OpenAI', 'Anthropic', 'Ollama', 'Gemini', 'Mistral',
  /\b(?:x|anthropic|openai)-[a-z0-9-]+/gi,        // header names
  /\b(?:gpt|claude|gemini|llama|mistral)-[\w.-]+/gi, // model ids
];

// Explicit language and variant per code, so the model never guesses one.
export const LANGUAGES = {
  ar: 'Arabic', az: 'Azerbaijani', bg: 'Bulgarian', bn: 'Bengali', cs: 'Czech', da: 'Danish',
  de: 'German', es: 'Spanish', fa: 'Persian (Farsi)', fi: 'Finnish', fil: 'Filipino', fr: 'French',
  gu: 'Gujarati', he: 'Hebrew', hi: 'Hindi', hu: 'Hungarian', id: 'Indonesian', it: 'Italian',
  ja: 'Japanese', ko: 'Korean', mr: 'Marathi', ms: 'Malay', nl: 'Dutch', no: 'Norwegian Bokmal',
  pl: 'Polish', pt: 'European Portuguese (Portugal)', 'pt-BR': 'Brazilian Portuguese (Brazil)',
  ro: 'Romanian', ru: 'Russian', sk: 'Slovak', sv: 'Swedish', sw: 'Swahili', ta: 'Tamil',
  te: 'Telugu', th: 'Thai', tr: 'Turkish', uk: 'Ukrainian', ur: 'Urdu', vi: 'Vietnamese',
  zh: 'Simplified Chinese',
};

const HELP = `Usage: npm run i18n:translate -- [options]

Compares every dashboard catalog (packages/dashboard/src/locales/<code>.json)
with en.json. Without --check it fills the gaps with an LLM.

Modes
  --check           Offline drift report. Prints "<locale> <kind> <key>" lines and
                    exits 1 on drift, or "No translation drift." and exits 0.
                    Kinds: missing, obsolete, empty, english-copy, placeholder-mismatch.
  (default)         Generate: translate missing, empty, English-copy and
                    placeholder-mismatch keys; remove obsolete keys; keep key
                    order equal to en.json. Other translations are never touched.
                    Exit 0 only when every target key was written.
  --dry-run         Print what generate would change. No LLM call, no writes,
                    no credentials needed.

Options
  --force           Re-translate every key, including reviewed translations.
                    Combine with --locale to cover English strings that changed
                    wording but kept their key (drift the script cannot detect).
  --locale <code>   Limit to one language (e.g. de, pt-BR).
  --locales-dir <d> Catalog directory (default: packages/dashboard/src/locales).
  -h, --help        Show this help.

Environment (generate mode only)
  I18N_LLM_API_KEY    API key of an OpenAI-compatible chat completions endpoint (required)
  I18N_LLM_MODEL      Model id to use (required, no default)
  I18N_LLM_BASE_URL   Endpoint base URL (default https://api.openai.com/v1)
`;

// ── pure helpers ────────────────────────────────────────────────────────────

const PLACEHOLDER_RE = /\{\{[^}]*\}\}/g;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const termRe = (t) =>
  typeof t === 'string'
    ? new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'gu')
    : new RegExp(t.source, t.flags.includes('g') ? t.flags : `${t.flags}g`);

/** Nested catalog -> { 'a.b.c': leaf } in document order. */
export function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

/** Flat map back to a nested catalog, inserting keys in the order given. */
export function unflatten(flat) {
  const root = {};
  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let node = root;
    for (const p of parts.slice(0, -1)) node = node[p] ??= {};
    node[parts.at(-1)] = value;
  }
  return root;
}

export const placeholders = (s) => (s.match(PLACEHOLDER_RE) ?? []).sort().join('|');

/** Do-not-translate terms that occur in an English string. */
export const dntIn = (s) => DO_NOT_TRANSLATE.flatMap((t) => s.match(termRe(t)) ?? []);

/** English text that may legitimately stay identical in every language. */
export function isExempt(en) {
  let rest = en.replace(PLACEHOLDER_RE, ' ');
  for (const t of DO_NOT_TRANSLATE) rest = rest.replace(termRe(t), ' ');
  return !/\p{L}/u.test(rest) || rest.trim().split(/\s+/).length === 1;
}

/** Findings for one locale: [{ kind, key }] */
export function diffCatalog(enFlat, locFlat) {
  const out = [];
  for (const [key, en] of Object.entries(enFlat)) {
    if (!(key in locFlat)) { out.push({ kind: 'missing', key }); continue; }
    const v = locFlat[key];
    if (typeof v !== 'string' || v.trim() === '') out.push({ kind: 'empty', key });
    else if (placeholders(v) !== placeholders(en)) out.push({ kind: 'placeholder-mismatch', key });
    else if (v === en && !isExempt(en)) out.push({ kind: 'english-copy', key });
  }
  for (const key of Object.keys(locFlat)) if (!(key in enFlat)) out.push({ kind: 'obsolete', key });
  return out;
}

/** Why a translated value is unusable, or null when it is fine. */
export function rejectReason(en, value) {
  if (typeof value !== 'string' || value.trim() === '') return 'empty or non-text value';
  if (placeholders(value) !== placeholders(en)) return 'placeholder mismatch';
  const missing = dntIn(en).find((t) => !value.includes(t));
  return missing ? `do-not-translate term altered: ${missing}` : null;
}

const serialize = (flat) => `${JSON.stringify(unflatten(flat), null, 2)}\n`;

export function buildPrompt(code) {
  const name = LANGUAGES[code] ?? code;
  return [
    `You translate user interface strings of Routerly, a self-hosted LLM API gateway dashboard, from English into ${name} (locale code "${code}"). Use exactly this language and regional variant.`,
    'The user message is a JSON object mapping keys to English strings. Reply with a JSON object with exactly the same keys and the translated strings as values. No other text.',
    'Rules: keep every {{placeholder}} exactly as written (same names, same count); keep punctuation and any markup; keep labels concise; never translate these terms, copy them verbatim: '
      + `${DO_NOT_TRANSLATE.filter((t) => typeof t === 'string').join(', ')}, HTTP header names and model or provider identifiers.`,
  ].join('\n');
}

// OpenAI-compatible chat completions. Contract checked against
// https://github.com/openai/openai-openapi (openapi.yaml, POST /chat/completions):
// Authorization: Bearer <key>; body { model, messages, response_format };
// reply text at choices[0].message.content.
export function createLlmClient(env) {
  const base = (env.I18N_LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  return async ({ system, user }) => {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.I18N_LLM_API_KEY}` },
      body: JSON.stringify({
        model: env.I18N_LLM_MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        response_format: { type: 'json_object' },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    // Never echo the response body: some providers repeat part of the key on 401.
    if (!res.ok) throw new Error(`LLM request failed: HTTP ${res.status} ${data?.error?.type ?? data?.error?.code ?? ''}`.trim());
    return data?.choices?.[0]?.message?.content;
  };
}

const parseJsonObject = (text) => {
  if (typeof text !== 'string') return null;
  const body = text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try {
    const v = JSON.parse(body);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch { return null; }
};

/**
 * Translate `targets` ({key: english}) for one locale in batches.
 * Calls onBatch(validValues) after each batch that produced any.
 * Returns { rejected: [{key, reason}], aborted: string|null }.
 * A thrown LLM error aborts the run (aborted = message); keys not reached are the caller's failed set.
 */
export async function translateMissing({ llm, code, targets, onBatch }) {
  const entries = Object.entries(targets);
  const rejected = [];
  const system = buildPrompt(code);
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = Object.fromEntries(entries.slice(i, i + BATCH_SIZE));
    let reply;
    try {
      reply = await llm({ system, user: JSON.stringify(batch), code });
    } catch (e) {
      return { rejected, aborted: e instanceof Error ? e.message : String(e) };
    }
    const parsed = parseJsonObject(reply);
    const valid = {};
    for (const [key, en] of Object.entries(batch)) {
      const reason = parsed ? rejectReason(en, parsed[key]) : 'reply is not a JSON object';
      if (reason) rejected.push({ key, reason });
      else valid[key] = parsed[key];
    }
    if (Object.keys(valid).length) await onBatch(valid);
  }
  return { rejected, aborted: null };
}

// ── io ──────────────────────────────────────────────────────────────────────

async function readCatalog(file, { optional = false } = {}) {
  let text;
  try { text = await fs.readFile(file, 'utf8'); } catch (e) {
    if (optional && e.code === 'ENOENT') return {};
    throw new Error(`${file}: cannot read (${e.message})`);
  }
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not a JSON object');
    return v;
  } catch (e) {
    throw new Error(`${file}: invalid JSON (${e.message})`);
  }
}

async function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    await fs.writeFile(tmp, text);
    await fs.rename(tmp, file);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    throw e;
  }
}

async function acquireLock(dir) {
  const file = path.join(dir, LOCK_NAME);
  const handle = await fs.open(file, 'wx');
  await handle.writeFile(String(process.pid));
  await handle.close();
  return file;
}

// ── main ────────────────────────────────────────────────────────────────────

/**
 * Returns the exit code. deps: { env, llm, stdout, stderr } (all optional).
 * `llm({system, user, code}) -> Promise<string>` replaces the HTTP client (tests).
 */
export async function main(argv, deps = {}) {
  const env = deps.env ?? process.env;
  const out = (s) => (deps.stdout ?? ((x) => process.stdout.write(x)))(`${s}\n`);
  const err = (s) => (deps.stderr ?? ((x) => process.stderr.write(x)))(`${s}\n`);

  let opts;
  try {
    ({ values: opts } = parseArgs({
      args: argv,
      options: {
        check: { type: 'boolean' }, 'dry-run': { type: 'boolean' }, force: { type: 'boolean' },
        locale: { type: 'string' }, 'locales-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' },
      },
    }));
  } catch (e) {
    err(`${e.message}\nRun with --help for usage.`);
    return 1;
  }
  if (opts.help) { out(HELP.trimEnd()); return 0; }

  const dir = path.resolve(opts['locales-dir'] ?? DEFAULT_LOCALES_DIR);
  const generate = !opts.check && !opts['dry-run'];

  try {
    const enFlat = flatten(await readCatalog(path.join(dir, 'en.json')));
    const existing = (await fs.readdir(dir))
      .filter((f) => f.endsWith('.json') && f !== 'en.json').map((f) => f.slice(0, -5)).sort();

    let codes = existing;
    if (opts.locale) {
      if (!existing.includes(opts.locale) && !(opts.locale in LANGUAGES)) {
        err(`Unknown language "${opts.locale}". Supported: ${[...new Set([...Object.keys(LANGUAGES), ...existing])].sort().join(', ')}`);
        return 1;
      }
      codes = [opts.locale];
    }

    // Read every catalog first: a malformed file aborts before anything is written.
    const catalogs = {};
    for (const code of codes) {
      catalogs[code] = flatten(await readCatalog(path.join(dir, `${code}.json`), { optional: true }));
    }

    if (opts.check) {
      let drift = 0;
      for (const code of codes) {
        for (const { kind, key } of diffCatalog(enFlat, catalogs[code])) { out(`${code} ${kind} ${key}`); drift++; }
      }
      if (!drift) out('No translation drift.');
      return drift ? 1 : 0;
    }

    // Targets per locale: gaps only, or everything with --force.
    const plan = {};
    for (const code of codes) {
      const findings = diffCatalog(enFlat, catalogs[code]);
      const keys = opts.force
        ? Object.keys(enFlat)
        : findings.filter((f) => f.kind !== 'obsolete').map((f) => f.key);
      plan[code] = { targets: Object.fromEntries(keys.map((k) => [k, enFlat[k]])), obsolete: findings.filter((f) => f.kind === 'obsolete').map((f) => f.key) };
    }

    if (opts['dry-run']) {
      let n = 0;
      for (const code of codes) {
        for (const key of Object.keys(plan[code].targets)) { out(`${code} translate ${key}`); n++; }
        for (const key of plan[code].obsolete) { out(`${code} remove ${key}`); n++; }
      }
      out(n ? `Dry run: ${n} change(s), nothing written.` : 'Dry run: nothing to change.');
      return 0;
    }

    // Generate.
    let llm = deps.llm;
    if (!llm) {
      if (!env.I18N_LLM_API_KEY || !env.I18N_LLM_MODEL) {
        err('Generate mode needs I18N_LLM_API_KEY and I18N_LLM_MODEL (optional I18N_LLM_BASE_URL). Nothing was written. Use --check or --dry-run to run offline.');
        return 1;
      }
      llm = createLlmClient(env);
    }

    let lockFile;
    try {
      lockFile = await acquireLock(dir);
    } catch (e) {
      if (e.code === 'EEXIST') {
        err(`Another run holds ${path.join(dir, LOCK_NAME)}. Wait for it, or delete the file if no run is active.`);
        return 1;
      }
      throw e;
    }
    const release = () => fs.rm(lockFile, { force: true });
    const onSignal = (sig) => () => { release().finally(() => process.exit(sig === 'SIGINT' ? 130 : 143)); };
    const handlers = ['SIGINT', 'SIGTERM'].map((s) => [s, onSignal(s)]);
    handlers.forEach(([s, h]) => process.once(s, h));

    let failed = 0;
    try {
      for (const code of codes) {
        const { targets, obsolete } = plan[code];
        const current = { ...catalogs[code] };
        for (const k of obsolete) delete current[k];
        const file = path.join(dir, `${code}.json`);
        let onDisk = await fs.readFile(file, 'utf8').catch(() => null);
        // Rebuild in English key order; unresolved keys stay absent (or keep their old value).
        const persist = async () => {
          const ordered = {};
          for (const k of Object.keys(enFlat)) if (k in current) ordered[k] = current[k];
          const text = serialize(ordered);
          if (text !== onDisk) { await writeAtomic(file, text); onDisk = text; }
        };

        const written = new Set();
        const { rejected, aborted } = await translateMissing({
          llm, code, targets,
          onBatch: async (valid) => { Object.assign(current, valid); Object.keys(valid).forEach((k) => written.add(k)); await persist(); },
        });
        await persist();

        for (const { key, reason } of rejected) { err(`${code} rejected ${key}: ${reason}`); failed++; }
        if (aborted) {
          err(`LLM call failed for ${code}: ${aborted}`);
          const rest = codes.slice(codes.indexOf(code) + 1);
          for (const k of Object.keys(targets)) if (!written.has(k) && !rejected.some((r) => r.key === k)) err(`${code} failed ${k}`);
          for (const c of rest) for (const k of Object.keys(plan[c].targets)) err(`${c} failed ${k}`);
          err('Aborted. Catalogs written so far are valid; re-run to resume with the remaining keys.');
          return 1;
        }
      }
    } finally {
      handlers.forEach(([s, h]) => process.removeListener(s, h));
      await release();
    }
    if (failed) { err(`${failed} key(s) rejected and not written. Re-run to retry them.`); return 1; }
    out('Translations up to date.');
    return 0;
  } catch (e) {
    err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = await main(process.argv.slice(2));
}
