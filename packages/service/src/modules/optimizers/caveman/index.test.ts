import { describe, it, expect, vi } from 'vitest'
import { ServiceContainer, EventBus, ProcessorRegistry } from '../../../core/index.js'
import { OPTIMIZER_REGISTRY, PROXY_PIPELINE } from '../../../core/tokens.js'
import type { ChatCompletionRequest, Message } from '@routerly/shared'
import type { ProxyContext } from '../../reverse-proxy/context.js'
import { readMessages } from '../messages.js'
import { passesSafetyGate } from '../gate.js'
import { optimizerCoreModule } from '../core.js'
import { cavemanModule, cavemanOptimizer } from './index.js'
import { PRODUCT_VERSION } from '../../../core/version.js'

function ctxWith(messages: Message[]): ProxyContext {
  const request = { model: 'gpt', messages } as ChatCompletionRequest
  return {
    protocol: 'openai',
    req: { headers: {} } as any,
    reply: {} as any,
    log: { warn: vi.fn(), error: vi.fn() } as any,
    project: { id: 'p1', optimizers: { steps: [{ id: 'caveman', enabled: true }] } } as any,
    projectId: 'p1',
    traceId: 't1',
    original: request,
    request,
    stream: false,
    passthrough: false,
  } as ProxyContext
}

function textOf(m: Message): string {
  return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
}

describe('caveman optimizer', () => {
  it('is lossy with the caveman id', () => {
    expect(cavemanOptimizer.id).toBe('caveman')
    expect(cavemanOptimizer.klass).toBe('lossy')
  })

  it('drops filler/stopwords and function words while keeping content words', () => {
    const ctx = ctxWith([{ role: 'user', content: 'Could you please just tell me about the database schema and the indexes' }])
    expect(cavemanOptimizer.supports(ctx)).toBe(true)
    const result = cavemanOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    const out = textOf(readMessages(ctx.request)[0]!)
    // stopwords/filler removed
    for (const w of ['please', 'just', 'me', 'about', 'the', 'you']) {
      expect(out.split(/\W+/)).not.toContain(w)
    }
    // content words kept
    for (const w of ['tell', 'database', 'schema', 'indexes']) {
      expect(out).toContain(w)
    }
    // compression actually happened
    expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore)
    expect(cavemanOptimizer.validate(ctx, result)).toBe(true)
    expect(ctx.request).toBe(ctx.original)
  })

  it('preserves a fenced code block byte-for-byte even when it contains filler words', () => {
    const code = '```js\n// the of a is are\nconst x = the + of\n```'
    const original = `Here is the code you asked for:\n\n${code}\n\nplease run it`
    const ctx = ctxWith([{ role: 'user', content: original }])
    const result = cavemanOptimizer.optimize(ctx)
    const out = textOf(readMessages(ctx.request)[0]!)
    // whole fenced block, including its filler-looking words, survives verbatim
    expect(out).toContain(code)
    // but prose around it was stripped ("please" gone)
    expect(out).not.toContain('please')
    expect(cavemanOptimizer.validate(ctx, result)).toBe(true)
  })

  it('preserves inline code spans verbatim', () => {
    const ctx = ctxWith([{ role: 'user', content: 'call the function `the_of_a()` and it is done' }])
    cavemanOptimizer.optimize(ctx)
    const out = textOf(readMessages(ctx.request)[0]!)
    expect(out).toContain('`the_of_a()`')
    // separator not glued away
    expect(out).toContain('call function `the_of_a()`')
  })

  it('keeps unquoted file paths byte-identical', () => {
    const ctx = ctxWith([
      { role: 'user', content: 'Open docs/concepts/on-call.md and src/a/index.ts, then run scripts/for-each/do-it.sh.' },
    ])
    cavemanOptimizer.optimize(ctx)
    const out = textOf(readMessages(ctx.request)[0]!)
    expect(out).toContain('docs/concepts/on-call.md')
    expect(out).toContain('src/a/index.ts')
    expect(out).toContain('scripts/for-each/do-it.sh')
  })

  it('keeps dotted identifiers byte-identical', () => {
    const ctx = ctxWith([
      { role: 'user', content: 'The failing assertion is in config.is.enabled and it should be true.' },
    ])
    cavemanOptimizer.optimize(ctx)
    expect(textOf(readMessages(ctx.request)[0]!)).toContain('config.is.enabled')
  })

  it('a path made of stopword segments survives, and validate agrees', () => {
    const ctx = ctxWith([{ role: 'user', content: 'Read src/on/index.ts now.' }])
    const result = cavemanOptimizer.optimize(ctx)
    expect(cavemanOptimizer.validate(ctx, result)).toBe(true)
    expect(textOf(readMessages(ctx.request)[0]!)).toContain('src/on/index.ts')
  })

  it('preserves URLs verbatim', () => {
    const url = 'https://example.com/the/of/a?x=the&y=of'
    const ctx = ctxWith([{ role: 'user', content: `see the docs at ${url} for the details` }])
    cavemanOptimizer.optimize(ctx)
    const out = textOf(readMessages(ctx.request)[0]!)
    expect(out).toContain(url)
  })

  it('preserves digit sequences byte-for-byte', () => {
    const ctx = ctxWith([{ role: 'user', content: 'the order 42 has 007 items and the code is v2' }])
    cavemanOptimizer.optimize(ctx)
    const out = textOf(readMessages(ctx.request)[0]!)
    expect(out).toContain('42')
    expect(out).toContain('007')
    expect(out).toContain('v2') // digit-adjacent token untouched
  })

  it('produces valid UTF-8 string content (no mojibake / no dropped multibyte)', () => {
    const ctx = ctxWith([{ role: 'user', content: 'please tell me about the café and the naïve résumé 日本語' }])
    cavemanOptimizer.optimize(ctx)
    const out = readMessages(ctx.request)[0]!.content as string
    expect(typeof out).toBe('string')
    expect(out).toContain('café')
    expect(out).toContain('naïve')
    expect(out).toContain('résumé')
    expect(out).toContain('日本語')
  })

  it('leaves non-text content parts byte-identical, strips only text parts', () => {
    const image = { type: 'image_url', image_url: { url: 'https://img/x.png' } }
    const msg = {
      role: 'user',
      content: [
        { type: 'text', text: 'please describe the image for me' },
        image,
      ],
    } as unknown as Message
    const ctx = ctxWith([msg])
    const result = cavemanOptimizer.optimize(ctx)
    const out = readMessages(ctx.request)[0]! as any
    expect(out.content[1]).toEqual(image) // untouched
    expect(out.content[0].text).not.toContain('please')
    expect(out.content[0].text).toContain('describe')
    expect(out.content[0].text).toContain('image')
    expect(cavemanOptimizer.validate(ctx, result)).toBe(true)
  })

  it('is a no-op when there is nothing to strip', () => {
    const ctx = ctxWith([{ role: 'user', content: 'database schema indexes' }])
    expect(cavemanOptimizer.supports(ctx)).toBe(false)
    const before = readMessages(ctx.request).slice()
    const result = cavemanOptimizer.optimize(ctx)
    expect(result.changed).toBe(false)
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('estimate previews the reduction without mutating', () => {
    const original: Message[] = [{ role: 'user', content: 'please just tell me about the schema' }]
    const ctx = ctxWith(original.map((m) => ({ ...m })))
    const est = cavemanOptimizer.estimate(ctx)
    expect(est.estimatedTokensAfter).toBeLessThan(est.estimatedTokensBefore)
    expect(readMessages(ctx.request)).toEqual(original) // untouched
  })

  it('a too-aggressive strip (message is almost all stopwords) is rejected by the core safety gate', () => {
    // Nearly every word is a stopword/filler -> after-ratio falls below the 0.2 floor.
    const ctx = ctxWith([
      { role: 'user', content: 'the of a is are and to in on at for with from by it was were be x' },
    ])
    const result = cavemanOptimizer.optimize(ctx)
    expect(result.changed).toBe(true)
    expect(passesSafetyGate(result)).toBe(false)
  })

  it('validate fails when a protected span was lost after optimize', () => {
    const ctx = ctxWith([{ role: 'user', content: 'see https://example.com/keep for the details' }])
    const result = cavemanOptimizer.optimize(ctx)
    ctx.request.messages = [{ role: 'user', content: 'the details' }] // URL gone
    expect(cavemanOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate fails when the message count changed after optimize', () => {
    const ctx = ctxWith([
      { role: 'user', content: 'please tell me about the schema' },
      { role: 'assistant', content: 'the schema has tables' },
    ])
    const result = cavemanOptimizer.optimize(ctx)
    ctx.request.messages = readMessages(ctx.request).slice(0, 1)
    expect(cavemanOptimizer.validate(ctx, result)).toBe(false)
  })

  it('validate passes when there is no captured pre-optimize state', () => {
    const ctx = ctxWith([{ role: 'user', content: 'please tell me about the schema' }])
    expect(
      cavemanOptimizer.validate(ctx, { changed: false, estimatedTokensBefore: 1, estimatedTokensAfter: 1 }),
    ).toBe(true)
  })

  it('recover restores the original messages when explicitly invoked', () => {
    const ctx = ctxWith([{ role: 'user', content: 'please just tell me about the schema' }])
    const original = readMessages(ctx.request).slice()
    cavemanOptimizer.optimize(ctx)
    expect(textOf(readMessages(ctx.request)[0]!)).not.toEqual(textOf(original[0]!))
    ctx.request.messages = [{ role: 'user', content: 'garbage' }]
    cavemanOptimizer.recover!(ctx, { changed: true, estimatedTokensBefore: 0, estimatedTokensAfter: 0 })
    expect(readMessages(ctx.request)).toEqual(original)
    expect(ctx.request).toBe(ctx.original)
  })

  it('recover is a safe no-op when nothing was stashed', () => {
    const ctx = ctxWith([{ role: 'user', content: 'please tell me about the schema' }])
    const before = readMessages(ctx.request).slice()
    expect(() =>
      cavemanOptimizer.recover!(ctx, { changed: false, estimatedTokensBefore: 0, estimatedTokensAfter: 0 }),
    ).not.toThrow()
    expect(readMessages(ctx.request)).toEqual(before)
  })

  it('registers into OPTIMIZER_REGISTRY via its module', async () => {
    const container = new ServiceContainer()
    const events = new EventBus()
    container.register(PROXY_PIPELINE, new ProcessorRegistry<ProxyContext>())
    await optimizerCoreModule.register({ container, events })
    await cavemanModule.register({ container, events })
    const registry = container.resolve(OPTIMIZER_REGISTRY)
    expect(registry.get('caveman')).toBe(cavemanOptimizer)
  })

  it('module manifest depends on optimizer-core', () => {
    expect(cavemanModule.manifest.id).toBe('optimizer-caveman')
    expect(cavemanModule.manifest.dependsOn).toEqual({ 'optimizer-core': `^${PRODUCT_VERSION}` })
  })
})

describe('caveman language gate', () => {
  const IT = [
    'Sei un consulente strategico e devi produrre una serie di raccomandazioni',
    'per il consiglio di amministrazione di una azienda manifatturiera che ha',
    'trecentocinquanta dipendenti e tre stabilimenti. La relazione non deve',
    'superare le duemilacinquecento parole nel corpo principale e deve contenere',
    'una analisi comparativa di almeno tre scenari alternativi di investimento.',
  ].join(' ')
  const EN = [
    'You are a senior strategy consultant and you have to produce a set of',
    'recommendations for the board of a manufacturing company that has three',
    'hundred and fifty employees and three plants. The report should not exceed',
    'two thousand five hundred words in the main body and it must contain a',
    'comparative analysis of at least three alternative investment scenarios.',
  ].join(' ')
  const ctxOf = (text: string) => ctxWith([{ role: 'user', content: text }])

  it('stays inert on text that is not English', () => {
    expect(cavemanOptimizer.supports(ctxOf(IT))).toBe(false)
  })

  it('still fires on English', () => {
    expect(cavemanOptimizer.supports(ctxOf(EN))).toBe(true)
  })

  it('does not gate short messages, where the ratio is not a signal', () => {
    expect(cavemanOptimizer.supports(ctxOf('Please fix the bug in the parser.'))).toBe(true)
  })
})

describe('caveman content gate', () => {
  it('leaves a bare JSON tool result byte-identical', () => {
    const payload =
      '[{"path":"src/a/index.ts","is":true,"for":"build"},{"path":"src/b/index.ts","is":false,"for":"test"}]'
    const ctx = ctxWith([
      { role: 'user', content: 'Here are the build targets, tell me which ones are stale.' },
      { role: 'user', content: payload },
    ])
    cavemanOptimizer.optimize(ctx)
    const after = readMessages(ctx.request)
    expect(textOf(after[1]!)).toBe(payload)
    // The prose message next to it is still compressed: the gate is per message.
    expect(textOf(after[0]!)).not.toBe('Here are the build targets, tell me which ones are stale.')
  })

  it('leaves a message that is mostly a fenced code block alone', () => {
    const code = '```ts\nconst a = 1\nexport function f() { return a }\n```\nok'
    const ctx = ctxWith([{ role: 'user', content: code }])
    cavemanOptimizer.optimize(ctx)
    expect(textOf(readMessages(ctx.request)[0]!)).toBe(code)
  })
})
