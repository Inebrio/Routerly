/**
 * TF bag-of-words vector for semantic similarity.
 * Uses a fixed 512-bucket hash space so vectors from different texts are comparable.
 * Splits on non-word chars, lowercases, skips tokens < 2 chars.
 * Returns a unit-normalized float array of length 512.
 */

const DIM = 512;

/** djb2 hash → bucket index in [0, DIM) */
function bucket(word: string): number {
  let h = 5381;
  for (let i = 0; i < word.length; i++) {
    h = ((h << 5) + h + word.charCodeAt(i)) >>> 0; // uint32
  }
  return h % DIM;
}

export function textToVector(text: string): number[] {
  const tokens = text.toLowerCase().split(/\W+/).filter(w => w.length >= 2);
  if (tokens.length === 0) return [];

  const vec = new Array<number>(DIM).fill(0);
  for (const t of tokens) {
    vec[bucket(t)]! += 1;
  }

  // Normalize to unit vector
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (norm === 0) return vec;
  return vec.map(v => v / norm);
}
