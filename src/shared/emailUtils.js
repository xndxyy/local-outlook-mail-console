export function deduplicateEmails(emails) {
  const seen = new Map();

  for (const email of emails || []) {
    const key = getEmailKey(email);
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, email);
      continue;
    }

    if (shouldReplaceEmail(existing, email)) {
      seen.set(key, email);
    }
  }

  return Array.from(seen.values());
}

export function filterEmails(emails, options = {}) {
  const keyword = normalizeSearch(options.keyword);
  const sender = normalizeSearch(options.sender);

  return (emails || []).filter((email) => {
    const searchableText = normalizeSearch([
      email.subject,
      email.bodyPreview,
      email.bodyText,
      email.from,
      email.fromName,
    ].filter(Boolean).join(' '));
    const senderText = normalizeSearch([email.from, email.fromName].filter(Boolean).join(' '));

    if (keyword && !searchableText.includes(keyword)) return false;
    if (sender && !senderText.includes(sender)) return false;
    return true;
  });
}

export function sortEmailsByDateDesc(emails) {
  return [...(emails || [])].sort((a, b) => {
    const left = new Date(a.date || 0).getTime();
    const right = new Date(b.date || 0).getTime();
    return right - left;
  });
}

export function clampLimit(limit, fallback = 10, max = 30) {
  const parsed = Number.parseInt(limit, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

function getEmailKey(email) {
  const messageId = String(email?.messageId || '').trim().toLowerCase();
  if (messageId) return `id:${messageId}`;
  return `fallback:${normalizeSearch(email?.subject)}:${new Date(email?.date || 0).toISOString()}`;
}

function shouldReplaceEmail(existing, candidate) {
  if (existing.protocol !== 'graph' && candidate.protocol === 'graph') return true;
  if (existing.protocol === 'graph' && candidate.protocol !== 'graph') return false;
  return getContentScore(candidate) > getContentScore(existing);
}

function getContentScore(email) {
  return String(email?.bodyHtml || email?.bodyText || email?.bodyPreview || '').length;
}

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}
