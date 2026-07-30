import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { CONFIG_PATHS } from '../../../lib/paths.js'

/**
 * Fixed on-disk convention for the (optional, operator-provided) LLMLingua-2
 * ONNX checkpoint. There is deliberately no config surface: the model is either
 * present at this exact path or the optimizer stays a permanent no-op.
 *
 *   <ROUTERLY_HOME>/models/llmlingua-2/model.onnx
 */
export const MODEL_PATH = join(CONFIG_PATHS.base, 'models', 'llmlingua-2', 'model.onnx')

/**
 * MIT-licensed checkpoint. Downloaded ONLY on explicit operator opt-in via
 * downloadModel(true); never auto-fetched on install or at request time.
 * See ../README.md#llmlingua-2 for provenance and license.
 */
const MODEL_URL =
  'https://huggingface.co/microsoft/llmlingua-2-xlm-roberta-large-meetingbank/resolve/main/onnx/model.onnx'

// `string` (not a literal) so tsc never tries to statically resolve the optional
// module's types — the dependency may not be installed at build time.
const RUNTIME_MODULE: string = 'onnxruntime-node'

const req = createRequire(import.meta.url)

/** Narrow shape of onnxruntime-node this module relies on. */
export interface OnnxRuntime {
  InferenceSession: { create(path: string): Promise<OnnxSession> }
  Tensor: new (type: string, data: BigInt64Array, dims: number[]) => unknown
}
export interface OnnxSession {
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>
}

/** True only when the checkpoint file is present on disk. */
export function isModelAvailable(): boolean {
  return existsSync(MODEL_PATH)
}

/**
 * Synchronous best-effort probe: is the optional `onnxruntime-node` dependency
 * installed? Resolves the module path WITHOUT importing/executing it, so it is
 * safe to call from the optimizer's synchronous `supports()`. Returns false
 * cleanly when the optional dependency was never installed.
 */
export function isRuntimeInstalled(): boolean {
  try {
    req.resolve(RUNTIME_MODULE)
    return true
  } catch {
    return false
  }
}

let runtime: OnnxRuntime | undefined
let session: OnnxSession | undefined

/**
 * Dynamically import onnxruntime-node. The import is wrapped in try/catch so the
 * dependency's absence never crashes module load or the whole service; it throws
 * a clear, caught error instead. Cached after the first successful load.
 */
export async function loadRuntime(): Promise<OnnxRuntime> {
  if (runtime) return runtime
  try {
    runtime = (await import(RUNTIME_MODULE)) as unknown as OnnxRuntime
    return runtime
  } catch (err) {
    throw new Error(
      'onnxruntime-node is not installed; the llmlingua-2 optimizer is unavailable. ' +
        'Install the optional dependency to enable it.',
      { cause: err },
    )
  }
}

/**
 * Download the checkpoint to MODEL_PATH. Hard-gated: a no-op unless the operator
 * explicitly passes optIn === true. Never called automatically anywhere in the
 * codebase. Networking uses global fetch (mocked in tests — no real network).
 */
export async function downloadModel(optIn: boolean): Promise<void> {
  if (optIn !== true) return
  const res = await fetch(MODEL_URL)
  if (!res.ok) {
    throw new Error(`llmlingua-2 model download failed: HTTP ${res.status}`)
  }
  const buf = Buffer.from(await res.arrayBuffer())
  await mkdir(dirname(MODEL_PATH), { recursive: true })
  await writeFile(MODEL_PATH, buf)
}

async function getSession(): Promise<OnnxSession> {
  if (session) return session
  const rt = await loadRuntime()
  session = await rt.InferenceSession.create(MODEL_PATH)
  return session
}

function hashToken(t: string): number {
  let h = 0
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0
  return Math.abs(h)
}

/**
 * Per-token keep-probability from the LLMLingua-2 token-classification head:
 * logits are shape [1, seq, 2] (discard/keep); keep-prob = softmax over the two
 * labels, label index 1.
 *
 * ponytail: the id mapping below is a placeholder hash, NOT the model's native
 * XLM-RoBERTa SentencePiece vocabulary. A production-grade run must feed the
 * exact input_ids the checkpoint was trained on; wiring that requires shipping
 * the tokenizer, out of scope for an OFF-by-default optional feature. Upgrade
 * path: add the @huggingface/transformers tokenizer and replace `ids` here.
 */
async function scoreTokens(tokens: string[]): Promise<number[]> {
  const rt = await loadRuntime()
  const sess = await getSession()
  const n = tokens.length
  const ids = BigInt64Array.from(tokens.map((t) => BigInt(hashToken(t) % 250000)))
  const mask = BigInt64Array.from(tokens.map(() => 1n))
  const out = await sess.run({
    input_ids: new rt.Tensor('int64', ids, [1, n]),
    attention_mask: new rt.Tensor('int64', mask, [1, n]),
  })
  const logits = Object.values(out)[0]!.data
  const scores: number[] = []
  for (let i = 0; i < n; i++) {
    const ea = Math.exp(logits[i * 2] ?? 0)
    const eb = Math.exp(logits[i * 2 + 1] ?? 0)
    scores.push(eb / (ea + eb))
  }
  return scores
}

/**
 * Compress one text blob to approximately `keepRatio` of its whitespace tokens:
 * each token gets a keep-probability from the model, the top-scoring `keepRatio`
 * fraction survive, and they are re-joined in original order. Runtime + session
 * are loaded lazily and cached. See scoreTokens for the tokenizer caveat.
 */
export async function compress(text: string, keepRatio: number): Promise<string> {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length <= 1) return text
  const scores = await scoreTokens(tokens)
  const keep = Math.max(1, Math.round(tokens.length * keepRatio))
  const keepSet = new Set(
    scores
      .map((s, i) => [s, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, keep)
      .map(([, i]) => i),
  )
  return tokens.filter((_, i) => keepSet.has(i)).join(' ')
}
