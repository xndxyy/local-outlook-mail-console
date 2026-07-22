import { simpleParser } from 'mailparser';
import { clampLimit, filterEmails, sortEmailsByDateDesc } from '../shared/emailUtils.js';
import { exchangeRefreshToken } from './msAuth.js';
import { explainImapError } from './errorMessages.js';
import { fetchImapRawMessages } from './imapXoauth2.js';
import { fetchOutlookRestMessages } from './outlookRest.js';

const IMAP_SCOPE = 'offline_access https://outlook.office.com/IMAP.AccessAsUser.All';
const IMAP_RESOURCE = 'https://outlook.office.com/';
const LEGACY_LIVE_IMAP_SCOPES = 'wl.imap wl.offline_access';

export async function fetchImapMessages(payload, {
  exchangeToken = exchangeRefreshToken,
  fetchRaw = fetchImapRawMessages,
  fetchRest = fetchOutlookRestMessages,
} = {}) {
  validateMailPayload(payload);
  const limit = clampLimit(payload.limit, 5, 10);
  const tokenResult = await exchangeToken({
    clientId: payload.clientId,
    refreshToken: payload.refreshToken,
    scope: IMAP_SCOPE,
    resource: IMAP_RESOURCE,
    legacyLiveScopes: LEGACY_LIVE_IMAP_SCOPES,
    includeDetails: true,
  });

  const attempts = [];

  for (const host of getImapHostCandidates(payload, tokenResult)) {
    const emails = [];

    try {
      const result = await fetchRaw({
        email: payload.email,
        accessToken: tokenResult.accessToken,
        host,
        limit,
      });

      for (const message of result.records) {
        const parsed = message.source ? await simpleParser(message.source) : null;
        emails.push(toEmailRecord(message, parsed));
      }

      const filtered = sortEmailsByDateDesc(filterEmails(emails, payload)).slice(0, limit);
      return {
        success: true,
        protocol: 'imap',
        count: filtered.length,
        emails: filtered,
        diagnostics: {
          tokenSource: tokenResult.candidateLabel,
          host: result.diagnostics.host,
          authMechanism: result.diagnostics.authMechanism,
        },
      };
    } catch (error) {
      attempts.push({ host, error });
    }
  }

  if (canUseOutlookRestFallback(attempts, tokenResult)) {
    try {
      const result = await fetchRest({
        accessToken: tokenResult.accessToken,
        payload,
        limit,
      });
      const emails = result.emails || [];
      return {
        success: true,
        protocol: 'imap',
        count: emails.length,
        emails,
        diagnostics: {
          tokenSource: tokenResult.candidateLabel,
          host: 'outlook-rest-v2',
          authMechanism: 'Bearer REST',
          fallback: 'outlook-rest-v2',
        },
      };
    } catch (error) {
      const imapError = formatImapAttemptErrors(attempts, tokenResult);
      throw new Error(`${imapError} | Outlook REST fallback: ${error.message}`);
    }
  }

  throw new Error(formatImapAttemptErrors(attempts, tokenResult));
}

export function getImapHostCandidates(payload = {}, tokenResult = {}) {
  const preferred = String(payload.imapHost || '').trim();
  const defaults = tokenResult.candidateLabel === 'legacy-live'
    ? ['imap-mail.outlook.com', 'outlook.office365.com']
    : ['outlook.office365.com', 'imap-mail.outlook.com'];
  return [...new Set([preferred, ...defaults].filter(Boolean))];
}

export function formatImapAttemptErrors(attempts, tokenResult = {}) {
  const tokenSource = tokenResult.candidateLabel || 'unknown-token-source';
  const details = attempts.map(({ host, error }) => {
    return `${host} / ${tokenSource} / XOAUTH2: ${explainImapError(error)}`;
  });

  return [
    'IMAP 全部主机尝试失败。',
    '程序已经固定使用 Thunderbird/Outlook 常见的 XOAUTH2 认证格式，并自动尝试 Office365 与 Outlook.com 两个 IMAP 主机。',
    '如果仍然失败，通常是账号未开放 IMAP、refresh token 与邮箱主机不匹配，或需要重新交互授权。',
    `详情：${details.join(' | ')}`,
  ].join(' ');
}

function canUseOutlookRestFallback(attempts, tokenResult) {
  const scope = String(tokenResult?.scope || '');
  const hasMailScope = /(?:^|\s)(?:https:\/\/outlook\.office\.com\/)?Mail\.Read(?:Write)?(?:\s|$)/i.test(scope);
  return hasMailScope
    && attempts.length >= 2
    && attempts.every(({ error }) => isAuthenticatedNotConnected(error));
}

function isAuthenticatedNotConnected(error) {
  return [error?.message, error?.responseStatus, error?.responseText]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes('user is authenticated but not connected');
}

function toEmailRecord(message, parsed) {
  const from = parsed?.from?.value?.[0];
  return {
    id: String(message.uid || parsed?.messageId || `${parsed?.subject || ''}-${message.internalDate || ''}`),
    messageId: parsed?.messageId || '',
    protocol: 'imap',
    folder: 'inbox',
    from: from?.address || '',
    fromName: from?.name || '',
    subject: parsed?.subject || '(无主题)',
    date: parsed?.date?.toISOString?.() || message.internalDate?.toISOString?.() || new Date().toISOString(),
    bodyPreview: createPreview(parsed?.text || parsed?.html || ''),
    bodyText: parsed?.text || '',
    bodyHtml: parsed?.html || '',
  };
}

function createPreview(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 240);
}

function validateMailPayload(payload) {
  if (!payload?.email || !payload.email.includes('@')) throw new Error('Invalid email');
  if (!payload?.clientId) throw new Error('Missing client id');
  if (!payload?.refreshToken) throw new Error('Missing refresh token');
}
