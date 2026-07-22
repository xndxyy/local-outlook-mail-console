const STRONG_SEPARATORS = ['----', '---', '--'];

export function parseImportText(text, existingEmails = []) {
  const accounts = [];
  const errors = [];
  const seen = new Set(existingEmails.map(normalizeEmail).filter(Boolean));
  const lines = String(text || '').split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const trimmed = rawLine.trim();
    if (!trimmed) return;

    const parsed = splitImportLine(trimmed);
    if (!parsed.ok) {
      errors.push({ line: lineNumber, message: parsed.message });
      return;
    }

    const [email, _discardedPassword, clientId, refreshToken] = parsed.parts;
    const normalizedEmail = normalizeEmail(email);

    if (!isValidEmail(email)) {
      errors.push({ line: lineNumber, message: `Invalid email: ${email}` });
      return;
    }

    if (!clientId || clientId.length < 8) {
      errors.push({ line: lineNumber, message: `Client id is too short for ${email}` });
      return;
    }

    if (!refreshToken || refreshToken.length < 12) {
      errors.push({ line: lineNumber, message: `Refresh token is too short for ${email}` });
      return;
    }

    if (seen.has(normalizedEmail)) {
      errors.push({ line: lineNumber, message: `Duplicate account skipped: ${email}` });
      return;
    }

    seen.add(normalizedEmail);
    accounts.push({
      id: createId(),
      email: email.trim(),
      clientId: clientId.trim(),
      refreshToken: refreshToken.trim(),
      passwordDiscarded: true,
      importIndex: index,
      addedAt: new Date().toISOString(),
    });
  });

  return { accounts, errors };
}

export function formatImportErrors(errors) {
  return errors
    .map((error) => `Line ${error.line}: ${error.message}`)
    .join('\n');
}

export function maskClientId(clientId) {
  const value = String(clientId || '');
  if (value.length <= 10) return '***';
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function splitImportLine(line) {
  for (const separator of STRONG_SEPARATORS) {
    if (!line.includes(separator)) continue;

    const parts = splitFirstSeparators(line, separator, 3).map((part) => part.trim());
    if (parts.length === 4 && parts.every(Boolean)) {
      return { ok: true, parts };
    }
  }

  const singleDashParts = line.split('-').map((part) => part.trim());
  if (singleDashParts.length === 4 && singleDashParts.every(Boolean)) {
    return { ok: true, parts: singleDashParts };
  }

  return {
    ok: false,
    message: 'Ambiguous import format; use --, ---, or ---- between email, password, client id, and refresh token.',
  };
}

function splitFirstSeparators(value, separator, separatorCount) {
  const parts = [];
  let remaining = value;

  for (let i = 0; i < separatorCount; i += 1) {
    const index = remaining.indexOf(separator);
    if (index === -1) return [];
    parts.push(remaining.slice(0, index));
    remaining = remaining.slice(index + separator.length);
  }

  parts.push(remaining);
  return parts;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
