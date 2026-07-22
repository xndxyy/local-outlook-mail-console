const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);

export function isAllowedLocalHost(hostHeader) {
  const host = normalizeHost(hostHeader);
  return LOOPBACK_HOSTS.has(host) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

export function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase();
  return (
    value === '::1' ||
    value === '127.0.0.1' ||
    value === '::ffff:127.0.0.1' ||
    value.startsWith('127.')
  );
}

export function redactSensitive(input) {
  return String(input || '')
    .replace(/(refresh_token=)[^&\s]+/gi, '$1[redacted-refresh-token]')
    .replace(/("refreshToken"\s*:\s*")[^"]+(")/gi, '$1[redacted-refresh-token]$2')
    .replace(/(client_secret=)[^&\s]+/gi, '$1[redacted-client-secret]')
    .replace(/("clientSecret"\s*:\s*")[^"]+(")/gi, '$1[redacted-client-secret]$2')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted-access-token]')
    .replace(/\b0\.[A-Za-z0-9._-]{20,}\b/g, '[redacted-refresh-token]');
}

export function getSecurityHeaders(contentType = 'application/json; charset=utf-8') {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data:",
      "connect-src 'self'",
      "frame-src 'self' data:",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

function normalizeHost(hostHeader) {
  const value = String(hostHeader || '').trim().toLowerCase();
  if (!value) return '';
  if (value.startsWith('[::1]')) return '::1';
  return value.split(':')[0];
}
