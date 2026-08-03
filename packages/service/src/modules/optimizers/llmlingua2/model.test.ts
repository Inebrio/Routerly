import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// @huggingface/transformers is an OPTIONAL dependency and the checkpoints are
// hundreds of megabytes, so neither is available to a test run. The module is
// mocked and the assertions are about the two things the previous
// implementation got wrong: the ids must come from the model's own tokenizer,
// and the survivors must be decoded back through it.
const encode = vi.fn()
const decode = vi.fn()
const forward = vi.fn()

vi.mock('@huggingface/transformers', () => ({
  AutoTokenizer: { from_pretrained: vi.fn(async () => Object.assign(encode, { decode })) },
  AutoModelForTokenClassification: { from_pretrained: vi.fn(async () => forward) },
  Tensor: class {
    constructor(
      public type: string,
      public data: BigInt64Array,
      public dims: number[],
    ) {}
  },
}))

/** State of one checkpoint by key, out of the full list. */
function stateOf<T extends { key: string }>(states: T[], key: string): T | undefined {
  return states.find((s) => s.key === key)
}

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
    expect(m.checkpointFor()).toMatchObject({
      key: 'bert-multilingual-q8',
      repo: 'ldenoue/llmlingua-2-bert-base-multilingual-cased-meetingbank',
      dtype: 'q8',
    })
  })

  it('resolves a step-selected checkpoint by key', async () => {
    const m = await import('./model.js')
    expect(m.checkpointFor('xlm-roberta-large-int8')).toMatchObject({
      repo: 'atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank',
      dtype: 'int8',
    })
  })

  it('falls back to the default for a key this build does not publish', async () => {
    const m = await import('./model.js')
    expect(m.checkpointFor('deleted-checkpoint').key).toBe('bert-multilingual-q8')
  })

  it('publishes the env override as an extra checkpoint and makes it the default', async () => {
    process.env.ROUTERLY_LLMLINGUA_MODEL = 'someone/their-own-export'
    process.env.ROUTERLY_LLMLINGUA_DTYPE = 'int8'
    const m = await import('./model.js')
    expect(m.checkpoints().map((c) => c.key)).toContain('custom')
    expect(m.checkpointFor()).toMatchObject({ repo: 'someone/their-own-export', dtype: 'int8' })
    // A step naming a curated checkpoint still gets that one.
    expect(m.checkpointFor('bert-multilingual-q8').dtype).toBe('q8')
  })

  it('caches the checkpoints under the routerly models directory', async () => {
    const m = await import('./model.js')
    expect(m.MODEL_CACHE_DIR.replace(/\\/g, '/')).toMatch(/\/models$/)
  })

  it('reports every checkpoint as absent when nothing is on disk', async () => {
    const m = await import('./model.js')
    const states = m.checkpointStates()
    expect(states).toHaveLength(3)
    expect(states.every((s) => s.state === 'absent')).toBe(true)
    expect(m.isModelAvailable()).toBe(false)
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

  it('scores a text longer than the encoder window in windows, not in one throwing pass', async () => {
    // 700 ids: one full 512 window plus a 188 remainder. A single pass over them
    // throws inside the ONNX embedding graph, which used to silently no-op the
    // step on exactly the long prompts it exists to compress.
    const ids = [101, ...Array.from({ length: 698 }, (_, i) => 1000 + i), 102]
    encode.mockResolvedValue({
      input_ids: { tolist: () => [ids] },
      attention_mask: { tolist: () => [ids.map(() => 1)] },
    })
    forward.mockImplementation(async (feeds: { input_ids: { dims: number[] } }) => {
      const len = feeds.input_ids.dims[1]!
      return { logits: { tolist: () => [Array.from({ length: len }, () => [1, 0])] } }
    })
    decode.mockReturnValue('kept')

    const m = await import('./model.js')
    await m.compress('a very long text', 0.5)

    expect(forward).toHaveBeenCalledTimes(2)
    expect(forward.mock.calls[0]![0].input_ids.dims).toEqual([1, 512])
    expect(forward.mock.calls[1]![0].input_ids.dims).toEqual([1, 188])
    // Every position was scored, so the keep count is a fraction of all 700.
    expect(decode.mock.calls[0]![0]).toHaveLength(350)
  })

  it('loads the checkpoint the caller named, at its own dtype', async () => {
    encode.mockResolvedValue({
      input_ids: { tolist: () => [[101, 11, 102]] },
      attention_mask: { tolist: () => [[1, 1, 1]] },
    })
    forward.mockResolvedValue({ logits: { tolist: () => [[[1, 0], [1, 2], [1, 0]]] } })
    decode.mockReturnValue('out')

    const lib = await import('@huggingface/transformers')
    const m = await import('./model.js')
    await m.compress('some text', 0.5, 'xlm-roberta-large-int8')

    expect(lib.AutoModelForTokenClassification.from_pretrained).toHaveBeenCalledWith(
      'atjsh/llmlingua-2-js-xlm-roberta-large-meetingbank',
      expect.objectContaining({ dtype: 'int8', local_files_only: true }),
    )
  })

  it('returns the text untouched when there is nothing to compress', async () => {
    const m = await import('./model.js')
    expect(await m.compress('   ', 0.5)).toBe('   ')
    expect(forward).not.toHaveBeenCalled()
  })

  it('reports downloading with progress while a fetch is in flight', async () => {
    const lib = await import('@huggingface/transformers')
    // Hold the fetch open: the assertion is about the state DURING a download,
    // which a mock that resolves immediately never lets anyone observe.
    let finish: () => void = () => {}
    const inFlight = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.mocked(lib.AutoTokenizer.from_pretrained).mockImplementation((async (
      _repo: string,
      o: Record<string, unknown>,
    ) => {
      const report = o.progress_callback as (e: Record<string, unknown>) => void
      report({ status: 'progress', file: 'onnx/model_quantized.onnx', loaded: 50, total: 200 })
      // Events that are not byte progress must not move the bar.
      report({ status: 'initiate', file: 'config.json' })
      await inFlight
      return Object.assign(encode, { decode })
    }) as never)

    const m = await import('./model.js')
    m.startDownload('bert-multilingual-q8')
    await vi.waitFor(() =>
      expect(stateOf(m.checkpointStates(), 'bert-multilingual-q8')).toMatchObject({
        state: 'downloading',
        progress: 25,
        loadedBytes: 50,
        totalBytes: 200,
      }),
    )
    // Only the checkpoint asked for is touched.
    expect(stateOf(m.checkpointStates(), 'xlm-roberta-large-int8')!.state).toBe('absent')
    finish()
  })

  it('clears the download once it finishes and refuses an unknown checkpoint', async () => {
    const lib = await import('@huggingface/transformers')
    const m = await import('./model.js')
    m.startDownload('bert-multilingual-q8')
    m.startDownload('bert-multilingual-q8') // idempotent: no second fetch in flight
    await vi.waitFor(() =>
      expect(stateOf(m.checkpointStates(), 'bert-multilingual-q8')!.state).not.toBe('downloading'),
    )
    expect(lib.AutoTokenizer.from_pretrained).toHaveBeenCalledOnce()

    expect(m.startDownload('not-a-checkpoint')).toEqual({
      ok: false,
      error: 'Unknown checkpoint not-a-checkpoint',
    })
  })

  it('surfaces a failed download as an error on that checkpoint', async () => {
    const lib = await import('@huggingface/transformers')
    vi.mocked(lib.AutoTokenizer.from_pretrained).mockRejectedValueOnce(new Error('network down'))

    const m = await import('./model.js')
    m.startDownload('bert-multilingual-q8')
    await vi.waitFor(() =>
      expect(stateOf(m.checkpointStates(), 'bert-multilingual-q8')).toMatchObject({
        state: 'absent',
        error: 'network down',
      }),
    )
  })
})
