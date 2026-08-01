/**
 * Copies text to the clipboard, falling back to a hidden textarea when the
 * Clipboard API is unavailable — self-hosted instances are often reached over
 * plain HTTP by IP, which is not a secure context.
 */
export function writeToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.appendChild(el);
    el.focus();
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    ok ? resolve() : reject(new Error('execCommand failed'));
  });
}
