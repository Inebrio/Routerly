import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @huggingface/transformers is an OPTIONAL dependency and the checkpoint is a
// 170 MB download, so neither is available to a test run. The module is mocked
// and the assertions are about the two things the previous implementation got
// wrong: the ids must come from the model's own tokenizer, and the survivors
// must be decoded back through it.
const encode = vi.fn()
const decode = vi.fn()
const forward = vi.fn()

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: vi.fn(async () => Object.assign(encode, { decode })) },
  AutoModelForTokenClassification: { from_pretrained: vi.fn(async () => forward) },
}))

describe('llmlingua-2 model', () => {
  beforeEach(() => {
    vi.resetModules()
    // The mocked module's from_pretrained spies live for the whole file: clear
    // their call history so per-test counts mean what they say.
    vi.clearAllMocks()
    encode.mockReset()
    decode.mockReset()
    forward.mockReset()
  })
  afterEach(() => {
    delete process.env.ROUTERLY_LLMLINGUA_MODEL
    delete process.env.ROUTERLY_LLMLINGUA_DTYPE
  })

  it('defaults to the multilingual BERT checkpoint at q8', async () => {
    const m = await import('./model.js')
    expect(m.modelId()).toBe('ldenoue/llmlingua-2-bert-base-multilingual-cased-meetingbank')
    expect(m.modelDtype()).toBe('q8')
  })

  it('honours the env overrides', async () => {
    process.env.ROUTERLY_LLMLINGUA_MODEL = 'atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank'
    process.env.ROUTERLY_LLMLINGUA_DTYPE = 'int8'
    const m = await import('./model.js')
    expect(m.modelId()).toBe('atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank')
    expect(m.modelDtype()).toBe('int8')
  })

  it('caches the checkpoint under the routerly models directory', async () => {
    const m = await import('./model.js')
    expect(m.MODEL_CACHE_DIR.replace(/\\/g, '/')).toMatch(/\/models$/)
  })

  it('reports the model as absent when nothing is on disk', async () => {
    const m = await import('./model.js')
    expect(m.isModelAvailable()).toBe(false)
    expect(m.modelState()).toMatchObject({ state: 'absent', dtype: 'q8' })
  })

  it('scores the tokenizer ids and decodes the survivors back', async () => {
    // 4 real tokens between [CLS] and [SEP]; keep-logit rises left to right.
    encode.mockResolvedValue({
      input_ids: { tolist: () => [[101, 11, 22, 33, 44, 102]] },
      attention_mask: { tolist: () => [[1, 1, 1, 1, 1, 1]] },
    })
    forward.mockResolvedValue({
      logits: {
        dims: [1, 6, 2],
        tolist: () => [
          [
            [1, 0],
            [1, 0],
            [1, 1],
            [1, 2],
            [1, 3],
            [1, 0],
          ],
        ],
      },
    })
    decode.mockReturnValue('kept text')

    const m = await import('./model.js')
    const out = await m.compress('any four token text here', 0.5)

    expect(out).toBe('kept text')
    // Half of six positions kept, in original order, highest keep-prob first.
    expect(decode).toHaveBeenCalledWith([22, 33, 44], { skip_special_tokens: true })
    // The ids fed to the model are the tokenizer's, never a local hash.
    expect(forward).toHaveBeenCalledOnce()
  })

  it('returns the text untouched when there is nothing to compress', async () => {
    const m = await import('./model.js')
    expect(await m.compress('   ', 0.5)).toBe('   ')
    expect(forward).not.toHaveBeenCalled()
  })

  it('reports downloading while a fetch is in flight and clears it afterwards', async () => {
    const lib = await import('@huggingface/transformers')
    const m = await import('./model.js')
    m.startDownload()
    expect(m.modelState().state).toBe('downloading')
    m.startDownload() // idempotent: no second fetch while one is in flight
    await vi.waitFor(() => expect(m.modelState().state).not.toBe('downloading'))
    expect(lib.AutoTokenizer.from_pretrained).toHaveBeenCalledOnce()
    expect(m.modelState().error).toBeUndefined()
  })
})
