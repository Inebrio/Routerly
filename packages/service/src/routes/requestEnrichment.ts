/** Parse "key=val,key2=val2" tag header into a Record. Max 10 keys, 64 chars per value. */
export function parseRoutingTags(raw: string | undefined): Record<string, string> | undefined {
  if (!raw) return undefined;
  const tags: Record<string, string> = {};
  for (const pair of raw.split(',').slice(0, 10)) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const k = pair.slice(0, eq).trim();
    const v = pair.slice(eq + 1).trim().slice(0, 64);
    if (k) tags[k] = v;
  }
  return Object.keys(tags).length > 0 ? tags : undefined;
}
