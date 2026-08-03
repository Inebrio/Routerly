import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_LLMLINGUA_CHECKPOINT,
  LLMLINGUA_CHECKPOINTS,
  llmLinguaCheckpoint,
  type LlmLinguaCheckpoint,
} from '@routerly/shared'
import { CONFIG_PATHS } from '../../../lib/paths.js'

/**
 * Where transformers.js caches the checkpoints. It lays files out as
 * <cache>/<repo>/<file>, with the ONNX graphs under <repo>/onnx/.
 *
 *   <ROUTERLY_HOME>/models/<repo>/onnx/model_quantized.onnx
 *
 * One cache for the whole host: the checkpoint a step names is a per-project
 * choice, but the bytes are downloaded once and shared by every project that
 * names the same one.
 */
export const MODEL_CACHE_DIR = join(CONFIG_PATHS.base, 'models')

/**
 * transformers.js resolves a dtype to a filename suffix
 * (utils/dtypes.js, DEFAULT_DTYPE_SUFFIX_MAPPING). Knowing the exact file is
 * what lets two dtypes of the same repo be told apart on disk: they share a
 * cache directory, so "is there any .onnx here" would report the full-precision
 * checkpoint as installed the moment the quantized one arrived.
 */
const DTYPE_SUFFIX: Record<string, string> = {
  fp32: '',
  fp16: '_fp16',
  int8: '_int8',
  uint8: '_uint8',
  q8: '_quantized',
  q4: '_q4',
  q4f16: '_q4f16',
  bnb4: '_bnb4',
}

/** ONNX filename a dtype selects inside a repo's `onnx/` directory. */
function onnxFile(dtype: string): string {
  return `model${DTYPE_SUFFIX[dtype] ?? ''}.onnx`
}

/**
 * Escape hatch for a checkpoint the curated list does not carry. Deployment
 * configuration, so it stays env-only and out of the dashboard: it names files
 * that get written to the service host's disk, which is not a per-project
 * decision. When set, it becomes the default the pipeline falls back to.
 */
function envCheckpoint(): LlmLinguaCheckpoint | undefined {
  const repo = process.env.ROUTERLY_LLMLINGUA_MODEL?.trim()
  if (!repo) return undefined
  return {
    key: 'custom',
    label: 'Custom (ROUTERLY_LLMLINGUA_MODEL)',
    repo,
    dtype: process.env.ROUTERLY_LLMLINGUA_DTYPE?.trim() || 'q8',
    sizeMb: 0,
    license: 'Set by the operator; Routerly makes no claim about it.',
    note: 'Configured through the environment on this host.',
  }
}

/** Every checkpoint this host can install: the curated list, plus the env one. */
export function checkpoints(): LlmLinguaCheckpoint[] {
  const env = envCheckpoint()
  return env ? [...LLMLINGUA_CHECKPOINTS, env] : [...LLMLINGUA_CHECKPOINTS]
}

/**
 * Resolve the checkpoint a step runs on. An unknown key falls back to the
 * default rather than throwing: a project keeps working when an operator
 * removes the env override or the build stops publishing a checkpoint.
 */
export function checkpointFor(key?: string): LlmLinguaCheckpoint {
  const all = checkpoints()
  const named = key ? all.find((c) => c.key === key) : undefined
  if (named) return named
  return (
    envCheckpoint() ??
    llmLinguaCheckpoint(DEFAULT_LLMLINGUA_CHECKPOINT) ??
    LLMLINGUA_CHECKPOINTS[0]!
  )
}

// `string` (not a literal) so tsc never tries to statically resolve the optional
// module's types: the dependency may not be installed at build time.
const RUNTIME_MODULE: string = '@huggingface/transformers'

const req = createRequire(import.meta.url)

/**
 * Synchronous best-effort probe: is the optional `@huggingface/transformers`
 * dependency installed? Resolves the module path WITHOUT importing or executing
 * it, so it is safe to call from the optimizer's synchronous `supports()`.
 */
export function isRuntimeInstalled(): boolean {
  try {
    req.resolve(RUNTIME_MODULE)
    return true
  } catch {
    return false
  }
}

/**
 * Is this checkpoint's tokenizer and ONNX graph on disk? Sync, cheap, and safe
 * from `supports()`.
 */
export function isModelAvailable(key?: string): boolean {
  const c = checkpointFor(key)
  const base = join(MODEL_CACHE_DIR, c.repo)
  try {
    return existsSync(join(base, 'tokenizer.json')) && existsSync(join(base, 'onnx', onnxFile(c.dtype)))
  } catch {
    return false
  }
}

interface Tokenizer {
  (
    text: string,
    opts: Record<string, unknown>,
  ): Promise<{
    input_ids: { tolist(): number[][] }
    attention_mask: { tolist(): number[][] }
  }>
  decode(ids: number[], opts: { skip_special_tokens: boolean }): string
}
type Classifier = (feeds: Record<string, unknown>) => Promise<{ logits: { tolist(): number[][][] } }>

interface Lib {
  AutoTokenizer: { from_pretrained(id: string, o: Record<string, unknown>): Promise<Tokenizer> }
  AutoModelForTokenClassification: {
    from_pretrained(id: string, o: Record<string, unknown>): Promise<Classifier>
  }
}

// ponytail: one entry per checkpoint actually used, never evicted. A host runs
// one or two; add an LRU only if someone is genuinely cycling through more than
// fits in memory.
const loaded = new Map<string, { tok: Tokenizer; model: Classifier }>()

async function importRuntime(): Promise<Lib> {
  try {
    return (await import(RUNTIME_MODULE)) as never as Lib
  } catch (err) {
    throw new Error(
      '@huggingface/transformers is not installed; the llmlingua-2 optimizer is unavailable. ' +
        'Install the optional dependency to enable it.',
      { cause: err },
    )
  }
}

/**
 * Load tokenizer and model from the local cache only. `local_files_only: true`
 * is load-bearing: a proxied request must never trigger a download of hundreds
 * of megabytes. Downloads happen once, explicitly, through startDownload().
 */
async function load(key?: string): Promise<{ tok: Tokenizer; model: Classifier }> {
  const c = checkpointFor(key)
  const cached = loaded.get(c.key)
  if (cached) return cached
  const lib = await importRuntime()
  const opts = { cache_dir: MODEL_CACHE_DIR, local_files_only: true }
  const tok = await lib.AutoTokenizer.from_pretrained(c.repo, opts)
  const model = await lib.AutoModelForTokenClassification.from_pretrained(c.repo, {
    ...opts,
    dtype: c.dtype,
  })
  const entry = { tok, model }
  loaded.set(c.key, entry)
  return entry
}

/** Live byte counters of one in-flight download, keyed by checkpoint key. */
interface Download {
  /** Bytes seen per file, so a progress event replaces rather than accumulates. */
  files: Map<string, { loaded: number; total: number }>
  error?: string
}

const downloads = new Map<string, Download>()

/** What a surface needs to render one checkpoint's row. */
export interface CheckpointState extends LlmLinguaCheckpoint {
  state: 'absent' | 'downloading' | 'ready'
  /**
   * The one a step with no `model` runs on. Reported rather than left for each
   * surface to re-derive, because an env override changes it and only this host
   * knows about that.
   */
  isDefault: boolean
  /** 0-100 while downloading, absent otherwise. */
  progress?: number
  /** Bytes fetched so far, while downloading. */
  loadedBytes?: number
  /** Bytes the files seen so far declare, while downloading. */
  totalBytes?: number
  error?: string
}

/**
 * Progress across the files fetched so far, 0-100.
 *
 * ponytail: the denominator is the total of the files transformers.js has
 * STARTED, not of the whole repo, because only a started file has declared its
 * size. The ONNX graph dwarfs the tokenizer and config, so the number is honest
 * within a few points once the graph starts, and never overshoots 100.
 */
function progressOf(d: Download): { progress: number; loadedBytes: number; totalBytes: number } {
  let loadedBytes = 0
  let totalBytes = 0
  for (const f of d.files.values()) {
    loadedBytes += f.loaded
    totalBytes += f.total
  }
  const progress = totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0
  return { progress, loadedBytes, totalBytes }
}

/**
 * State of every installable checkpoint, for the management route, the CLI and
 * the dashboard. `ready` comes from the filesystem, never from an in-process
 * flag: the files outlive the process, and a restart must report what is
 * actually on disk.
 */
export function checkpointStates(): CheckpointState[] {
  const fallback = checkpointFor(undefined).key
  return checkpoints().map((c) => {
    const isDefault = c.key === fallback
    const ready = isModelAvailable(c.key)
    const d = downloads.get(c.key)
    if (ready) return { ...c, isDefault, state: 'ready' as const, ...(d?.error ? { error: d.error } : {}) }
    if (!d) return { ...c, isDefault, state: 'absent' as const }
    if (d.error) return { ...c, isDefault, state: 'absent' as const, error: d.error }
    return { ...c, isDefault, state: 'downloading' as const, ...progressOf(d) }
  })
}

/**
 * Fetch a checkpoint into MODEL_CACHE_DIR. Returns immediately: the download is
 * hundreds of megabytes and the caller is an HTTP request. Progress is read back
 * through checkpointStates(). Idempotent while one is in flight, and never
 * called automatically anywhere.
 *
 * A restart mid-download loses the in-memory counters and the checkpoint reads
 * as absent again; the partial files stay in the cache and transformers.js
 * skips whatever completed, so re-running this costs only what is missing.
 */
export function startDownload(key?: string): { ok: boolean; error?: string } {
  const c = checkpointFor(key)
  if (key && !checkpoints().some((x) => x.key === key)) {
    return { ok: false, error: `Unknown checkpoint ${key}` }
  }
  if (downloads.has(c.key) && !downloads.get(c.key)!.error) return { ok: true }
  if (isModelAvailable(c.key)) return { ok: true }

  const d: Download = { files: new Map() }
  downloads.set(c.key, d)
  void (async () => {
    try {
      const lib = await importRuntime()
      const opts = {
        cache_dir: MODEL_CACHE_DIR,
        local_files_only: false,
        progress_callback: (e: { status?: string; file?: string; loaded?: number; total?: number }) => {
          if (e.status !== 'progress' || !e.file) return
          d.files.set(e.file, { loaded: e.loaded ?? 0, total: e.total ?? 0 })
        },
      }
      await lib.AutoTokenizer.from_pretrained(c.repo, opts)
      await lib.AutoModelForTokenClassification.from_pretrained(c.repo, { ...opts, dtype: c.dtype })
      downloads.delete(c.key)
    } catch (err) {
      d.error = err instanceof Error ? err.message : String(err)
    }
  })()
  return { ok: true }
}

/** Test seam: forget every in-flight download and every loaded checkpoint. */
export function resetModelState(): void {
  downloads.clear()
  loaded.clear()
}

/**
 * Compress one text blob to approximately `keepRatio` of its tokens, using the
 * checkpoint `key` names (or the default).
 *
 * This is LLMLingua-2 as published: the text is tokenized with the model's OWN
 * tokenizer, the token-classification head emits [1, seq, 2] logits (discard,
 * keep), the softmax over those two labels is the keep-probability, the
 * top-scoring `keepRatio` fraction of positions survive in original order, and
 * the surviving ids are decoded back through the same tokenizer.
 *
 * Nothing here is language-specific. The encoders are multilingual, so the same
 * code path compresses any language their vocabulary covers.
 */
export async function compress(text: string, keepRatio: number, key?: string): Promise<string> {
  if (text.trim() === '') return text
  const { tok, model } = await load(key)
  const enc = await tok(text, { add_special_tokens: true })
  const ids = enc.input_ids.tolist()[0] ?? []
  if (ids.length <= 2) return text

  const out = await model({ input_ids: enc.input_ids, attention_mask: enc.attention_mask })
  const logits = out.logits.tolist()[0] ?? []
  const scores = logits.map((pair) => {
    const ea = Math.exp(pair[0] ?? 0)
    const eb = Math.exp(pair[1] ?? 0)
    return eb / (ea + eb)
  })

  const keep = Math.max(1, Math.round(ids.length * keepRatio))
  const keepSet = new Set(
    scores
      .map((s, i) => [s, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, keep)
      .map(([, i]) => i),
  )
  const kept = ids.filter((_, i) => keepSet.has(i))
  return tok.decode(kept, { skip_special_tokens: true })
}
