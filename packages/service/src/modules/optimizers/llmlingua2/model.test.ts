import { afterEach, describe, it, expect, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { MODEL_PATH, isModelAvailable, isRuntimeInstalled, loadRuntime, downloadModel } from './model.js'

// onnxruntime-node is an OPTIONAL dependency and is NOT installed in the test
// environment; the checkpoint file is absent too. That is the default state the
// optimizer must survive: everything below asserts the no-model / no-runtime path.
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('llmlingua-2 model loader', () => {
  it('MODEL_PATH points under the routerly models directory', () => {
    expect(MODEL_PATH.replace(/\\/g, '/')).toMatch(/\/models\/llmlingua-2\/model\.onnx$/)
  })

  it('isModelAvailable returns false when the checkpoint is absent from disk', () => {
    expect(isModelAvailable()).toBe(false)
  })

  it('isRuntimeInstalled returns false when onnxruntime-node is not installed', () => {
    expect(isRuntimeInstalled()).toBe(false)
  })

  it('loadRuntime throws a clear, caught error when onnxruntime-node is missing', async () => {
    await expect(loadRuntime()).rejects.toThrow(/onnxruntime-node is not installed/)
  })

  it('downloadModel is a no-op (no network) unless opt-in is explicitly true', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(downloadModel(false)).resolves.toBeUndefined()
    // @ts-expect-error narrowing off the boolean contract on purpose
    await expect(downloadModel(undefined)).resolves.toBeUndefined()
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('downloadModel fetches and writes the checkpoint only when opted in', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(8),
    })
    vi.stubGlobal('fetch', fetchSpy)
    await downloadModel(true)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy.mock.calls[0]![0]).toContain('huggingface.co')
    expect(mkdir).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledTimes(1)
    expect(writeFile).toHaveBeenCalledWith(MODEL_PATH, expect.any(Buffer))
  })

  it('downloadModel throws on a non-ok download response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(downloadModel(true)).rejects.toThrow(/HTTP 404/)
    expect(writeFile).not.toHaveBeenCalled()
  })
})
