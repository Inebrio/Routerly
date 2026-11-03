// ── SSRF guard ────────────────────────────────────────────────────────────────────────
function isPrivateHostname(hostname: string): boolean {
  // Strip IPv6 brackets added by URL.hostname (e.g. "[::1]" → "::1")
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  // IPv4 unspecified
  if (h === '0.0.0.0') return true;
  // IPv6 unspecified (compressed and full forms)
  if (h === '::' || h === '0:0:0:0:0:0:0:0') return true;
  // IPv4 loopback
  if (/^127\./.test(h)) return true;
  // RFC-1918 private ranges
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  // Link-local / APIPA
  if (/^169\.254\./.test(h)) return true;
  // IPv6 ULA, link-local
  if (/^(fc|fd|fe80)/i.test(h)) return true;
  // Cloud metadata services
  if (h === '100.100.100.200' || h === '169.254.170.2') return true;
  return false;
}

export function validateWebhookUrl(urlStr: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('Invalid webhook URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use http or https');
  }
  if (isPrivateHostname(parsed.hostname)) {
    throw new Error('Webhook URL must not target a private or loopback address');
  }
}
