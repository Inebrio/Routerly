export type EventListener = (topic: string, payload: unknown) => void

const segments = (s: string): string[] => s.split('/').filter((p) => p.length > 0)

export function topicMatches(pattern: string, topic: string): boolean {
  const p = segments(pattern)
  const t = segments(topic)
  // dp over (pattern index, topic index)
  const match = (pi: number, ti: number): boolean => {
    if (pi === p.length) return ti === t.length
    const seg = p[pi]
    if (seg === undefined) return ti === t.length
    if (seg === '**') {
      // consume zero or more topic segments
      for (let k = ti; k <= t.length; k++) {
        if (match(pi + 1, k)) return true
      }
      return false
    }
    if (ti === t.length) return false
    if (seg === '*' || seg === t[ti]) return match(pi + 1, ti + 1)
    return false
  }
  return match(0, 0)
}

interface Subscription {
  pattern: string
  listener: EventListener
}

export class EventBus {
  private readonly subs = new Set<Subscription>()
  private readonly onListenerError?: (err: unknown, topic: string) => void

  constructor(opts?: { onListenerError?: (err: unknown, topic: string) => void }) {
    if (opts?.onListenerError) this.onListenerError = opts.onListenerError
  }

  subscribe(pattern: string, listener: EventListener): () => void {
    const sub: Subscription = { pattern, listener }
    this.subs.add(sub)
    return () => {
      this.subs.delete(sub)
    }
  }

  publish(topic: string, payload?: unknown): void {
    for (const sub of this.subs) {
      if (!topicMatches(sub.pattern, topic)) continue
      try {
        sub.listener(topic, payload)
      } catch (err) {
        this.onListenerError?.(err, topic)
      }
    }
  }
}
