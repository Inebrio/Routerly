// Kept apart from loader.ts so a cache can subscribe without importing the loader.
type WriteListener = () => void | Promise<void>

const writeListeners = new Map<string, WriteListener[]>()

/** Run `listener` (awaited) after every successful write of config `key`. For caches derived from a config file. */
export function onConfigWrite(key: string, listener: WriteListener): void {
  writeListeners.set(key, [...(writeListeners.get(key) ?? []), listener])
}

export async function notifyWrite(key: string): Promise<void> {
  for (const l of writeListeners.get(key) ?? []) await Promise.resolve(l()).catch(() => {})
}
