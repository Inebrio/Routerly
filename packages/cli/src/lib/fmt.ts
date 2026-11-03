/** USD amount for CLI output; `-` when the value is missing (e.g. models without pricing). */
export function fmtUsd(n: number | null | undefined, digits?: number): string {
  if (n == null) return '-';
  return `$${digits === undefined ? n : n.toFixed(digits)}`;
}
