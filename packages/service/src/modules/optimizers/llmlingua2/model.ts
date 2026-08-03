import { createRequire } from 'node:module'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CONFIG_PATHS } from '../../../lib/paths.js'

/**
 * Where transformers.js caches the checkpoint. It lays files out as
 * <cache>/<model-id>/<file>, with the ONNX graphs under <model-id>/onnx/.
 *
 *   <ROUTERLY_HOME>/models/<model-id>/onnx/model_quantized.onnx
 */
export const MODEL_CACHE_DIR = join(CONFIG_PATHS.base, 'models')

/**
 * LLMLingua-2 is multilingual because its encoder is: this checkpoint is
 * multilingual BERT (104 languages), so the same weights score Italian, German
 * or Japanese without any per-language configuration. Quantized to 8 bit it is
 * 170 MB on disk, which is what makes it viable on a small self-hosted box.
 *
 * Provenance: an ONNX export of the Apache-2.0
 * `microsoft/llmlingua-2-bert-base-multilingual-cased-meetingbank`. The export
 * repo declares no license of its own; operators who need a declared license
 * can set ROUTERLY_LLMLINGUA_MODEL to the MIT-licensed
 * `atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank` with dtype `int8`
 * (536 MB, higher quality, heavier). See ../README.md#llmlingua-2.
 */
export const DEFAULT_MODEL_ID = 'ldenoue/llmlingua-2-bert-base-multilingual-cased-meetingbank'

/** transformers.js resolves `q8` to `onnx/model_quantized.onnx`. */
export const DEFAULT_DTYPE = 'q8'

/**
 * Operator-level knobs, deliberately env-only: they pick which files land on the
 * service host's disk, which is deployment configuration, not per-project
 * behaviour.
 */
export function modelId(): string {
  return process.env.ROUTERLY_LLMLINGUA_MODEL?.trim() || DEFAULT_MODEL_ID
}
export function modelDtype(): string {
  return process.env.ROUTERLY_LLMLINGUA_DTYPE?.trim() || DEFAULT_DTYPE
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
 * Is the checkpoint on disk? Checks for the tokenizer plus at least one ONNX
 * graph rather than a specific filename, so a change of dtype does not need a
 * dtype-to-filename table here. Sync, cheap, and safe from `supports()`.
 */
export function isModelAvailable(): boolean {
  const base = join(MODEL_CACHE_DIR, modelId())
  try {
    if (!existsSync(join(base, 'tokenizer.json'))) return false
    return readdirSync(join(base, 'onnx')).some((f) => f.endsWith('.onnx'))
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

let tokenizer: Tokenizer | undefined
let classifier: Classifier | undefined

/**
 * Load tokenizer and model from the local cache only. `local_files_only: true`
 * is load-bearing: a proxied request must never trigger a 170 MB download. The
 * download happens once, explicitly, through startDownload().
 */
async function load(): Promise<{ tok: Tokenizer; model: Classifier }> {
  if (tokenizer && classifier) return { tok: tokenizer, model: classifier }
  let lib: {
    AutoTokenizer: { from_pretrained(id: string, o: Record<string, unknown>): Promise<Tokenizer> }
    AutoModelForTokenClassification: {
      from_pretrained(id: string, o: Record<string, unknown>): Promise<Classifier>
    }
  }
  try {
    lib = (await import(RUNTIME_MODULE)) as never
  } catch (err) {
    throw new Error(
      '@huggingface/transformers is not installed; the llmlingua-2 optimizer is unavailable. ' +
        'Install the optional dependency to enable it.',
      { cause: err },
    )
  }
  const id = modelId()
  const opts = { cache_dir: MODEL_CACHE_DIR, local_files_only: true }
  tokenizer = await lib.AutoTokenizer.from_pretrained(id, opts)
  classifier = await lib.AutoModelForTokenClassification.from_pretrained(id, {
    ...opts,
    dtype: modelDtype(),
  })
  return { tok: tokenizer, model: classifier }
}

let downloading = false
let downloadError: string | undefined

/**
 * Status for the management route, the CLI and the dashboard. `ready` comes from
 * the filesystem, never from an in-process flag: the checkpoint outlives the
 * process, and a restart must report what is actually on disk.
 */
export function modelState(): {
  state: 'absent' | 'downloading' | 'ready'
  modelId: string
  dtype: string
  error?: string
} {
  const state = isModelAvailable() ? 'ready' : downloading ? 'downloading' : 'absent'
  return {
    state,
    modelId: modelId(),
    dtype: modelDtype(),
    ...(downloadError ? { error: downloadError } : {}),
  }
}

/**
 * Fetch the checkpoint into MODEL_CACHE_DIR. Returns immediately: the download
 * is hundreds of megabytes and the caller is an HTTP request. Progress is read
 * back through modelState(). Idempotent while one is in flight, and never
 * called automatically anywhere.
 */
export function startDownload(): void {
  if (downloading || isModelAvailable()) return
  downloading = true
  downloadError = undefined
  void (async () => {
    try {
      const lib = (await import(RUNTIME_MODULE)) as never as {
        AutoTokenizer: { from_pretrained(id: string, o: Record<string, unknown>): Promise<unknown> }
        AutoModelForTokenClassification: {
          from_pretrained(id: string, o: Record<string, unknown>): Promise<unknown>
        }
      }
      const id = modelId()
      const opts = { cache_dir: MODEL_CACHE_DIR, local_files_only: false }
      await lib.AutoTokenizer.from_pretrained(id, opts)
      await lib.AutoModelForTokenClassification.from_pretrained(id, { ...opts, dtype: modelDtype() })
    } catch (err) {
      downloadError = err instanceof Error ? err.message : String(err)
    } finally {
      downloading = false
    }
  })()
}

/**
 * Compress one text blob to approximately `keepRatio` of its tokens.
 *
 * This is LLMLingua-2 as published: the text is tokenized with the model's OWN
 * tokenizer, the token-classification head emits [1, seq, 2] logits (discard,
 * keep), the softmax over those two labels is the keep-probability, the
 * top-scoring `keepRatio` fraction of positions survive in original order, and
 * the surviving ids are decoded back through the same tokenizer.
 *
 * Nothing here is language-specific. The encoder is multilingual, so the same
 * code path compresses any language its vocabulary covers.
 */
export async function compress(text: string, keepRatio: number): Promise<string> {
  if (text.trim() === '') return text
  const { tok, model } = await load()
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
