export type ShortCircuit<R = unknown> = {
  readonly kind: 'short-circuit'
  readonly result: R
}

export function shortCircuit<R>(result: R): ShortCircuit<R> {
  return { kind: 'short-circuit', result }
}

export function isShortCircuit(value: unknown): value is ShortCircuit {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { kind?: unknown }).kind === 'short-circuit'
  )
}
