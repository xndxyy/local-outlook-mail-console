import { clampLimit, filterEmails, sortEmailsByDateDesc } from '../shared/emailUtils.js';
import { exchangeRefreshToken } from './msAuth.js';
import { redactSensitive } from './security.js';
import { explainGraphAuthError } from './errorMessages.js';

const GRAPH_SCOPE = 'offline_access https://graph.microsoft.com/Mail.Read';
const GRAPH_RESOURCE = 'https://graph.microsoft.com/';
const GRAPH_ROOT = 'https://graph.microsoft.com/v1.0';
const GRAPH_FOLDERS = ['inbox', 'junkemail'];

export async function fetchGraphMessages(payload) {
  validateMailPayload(payload);
  const limit = clampLimit(payload.limit, 10, 30);
  let accessToken;
  try {
    accessToken = await exchangeRefreshToken({
      clientId: payload.clientId,
      refreshToken: payload.refreshToken,
      scope: GRAPH_SCOPE,
      resource: GRAPH_RESOURCE,
    });
  } catch (error) {
    throw new Error(explainGraphAuthError(error));
  }

  const fetched = [];
  const perFolderLimit = Math.min(Math.max(limit * 2, limit), 30);

  for (const folder of GRAPH_FOLDERS) {
    const messages = await fetchGraphFolder({ accessToken, folder, perFolderLimit });
    fetched.push(...messages);
  }

  const filtered = sortEmailsByDateDesc(filterEmails(fetched, payload)).slice(0, limit);
  return {
    success: true,
    protocol: 'graph',
    count: filtered.length,
    emails: filtered,
  };
}

async function fetchGraphFolder({ accessToken, folder, perFolderLimit }) {
  const url = new URL(`${GRAPH_ROOT}/me/mailFolders/${folder}/messages`);
  url.searchParams.set('$top', String(perFolderLimit));
  url.searchParams.set('$orderby', 'receivedDateTime desc');
  url.searchParams.set('$select', [
    'id',
    'internetMessageId',
    'subject',
    'from',
    'receivedDateTime',
    'bodyPreview',
    'body',
  ].join(','));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: { message: text } };
  }

  if (response.status === 404 && folder === 'junkemail') return [];

  if (!response.ok) {
    const message = data?.error?.message || data?.error || `Graph API returned HTTP ${response.status}`;
    throw new Error(redactSensitive(message));
  }

  return (data.value || []).map((message) => ({
    id: message.id,
    messageId: message.internetMessageId || message.id,
    protocol: 'graph',
    folder,
    from: message.from?.emailAddress?.address || '',
    fromName: message.from?.emailAddress?.name || '',
    subject: message.subject || '(无主题)',
    date: message.receivedDateTime,
    bodyPreview: message.bodyPreview || '',
    bodyHtml: message.body?.contentType === 'html' ? message.body.content || '' : '',
    bodyText: message.body?.contentType !== 'html' ? message.body?.content || '' : '',
  }));
}

function validateMailPayload(payload) {
  if (!payload?.email || !payload.email.includes('@')) throw new Error('Invalid email');
  if (!payload?.clientId) throw new Error('Missing client id');
  if (!payload?.refreshToken) throw new Error('Missing refresh token');
}
