import { afterEach, describe, it, expect, vi } from 'vitest'
import { mkdir, writeFile } from 'node:fs/promises'
import { MODEL_PATH, isModelAvailable, isRuntimeInstalled, loadRuntime, downloadModel } from './model.js'

// onnxruntime-node is an OPTIONAL dependency. Whether it is physically installed
// in node_modules depends on the platform (it is a native optionalDependency), so
// the tests must NOT rely on ambient host state. We deterministically simulate the
// "not installed" default state the optimizer must survive:
//   - req.resolve('onnxruntime-node') -> throws  (mock node:module's createRequire)
//   - import('onnxruntime-node')       -> rejects (mock the module itself)
// so everything below asserts the no-model / no-runtime path hermetically.
vi.mock('node:fs/promises', () => ({ mkdir: vi.fn(), writeFile: vi.fn() }))

vi.mock('onnxruntime-node', () => {
  throw new Error("Cannot find module 'onnxruntime-node'")
})

vi.mock('node:module', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:module')>()
  return {
    ...actual,
    default: actual,
    createRequire: (...args: Parameters<typeof actual.createRequire>) => {
      const real = actual.createRequire(...args)
      return new Proxy(real, {
        get(target, prop, receiver) {
          if (prop === 'resolve') {
            return (id: string, ...rest: unknown[]) => {
              if (id === 'onnxruntime-node') {
                throw new Error("Cannot find module 'onnxruntime-node'")
              }
              return (target.resolve as (id: string, ...r: unknown[]) => string)(id, ...rest)
            }
          }
          return Reflect.get(target, prop, receiver)
        },
      })
    },
  }
})

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
