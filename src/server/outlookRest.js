import { clampLimit, filterEmails, sortEmailsByDateDesc } from '../shared/emailUtils.js';
import { redactSensitive } from './security.js';

const OUTLOOK_REST_ROOT = 'https://outlook.office.com/api/v2.0';
const OUTLOOK_FOLDERS = ['inbox', 'junkemail'];

export async function fetchOutlookRestMessages({
  accessToken,
  payload = {},
  limit = 10,
  fetchImpl = fetch,
}) {
  if (!accessToken) throw new Error('Missing Outlook access token');

  const resolvedLimit = clampLimit(limit, 10, 30);
  const perFolderLimit = Math.min(Math.max(resolvedLimit * 2, resolvedLimit), 30);
  const fetched = [];

  for (const folder of OUTLOOK_FOLDERS) {
    fetched.push(...await fetchFolder({
      accessToken,
      folder,
      perFolderLimit,
      fetchImpl,
    }));
  }

  return {
    emails: sortEmailsByDateDesc(filterEmails(fetched, payload)).slice(0, resolvedLimit),
  };
}

async function fetchFolder({ accessToken, folder, perFolderLimit, fetchImpl }) {
  const url = new URL(`${OUTLOOK_REST_ROOT}/me/mailfolders/${folder}/messages`);
  url.searchParams.set('$top', String(perFolderLimit));
  url.searchParams.set('$orderby', 'ReceivedDateTime desc');
  url.searchParams.set('$select', [
    'Id',
    'InternetMessageId',
    'Subject',
    'From',
    'ReceivedDateTime',
    'BodyPreview',
    'Body',
  ].join(','));

  const response = await fetchImpl(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
    },
  });
  const data = await parseJsonResponse(response);

  if (response.status === 404 && folder === 'junkemail') return [];
  if (!response.ok) {
    const message = data?.error?.message
      || data?.error?.Message
      || data?.error
      || `Outlook REST returned HTTP ${response.status}`;
    throw new Error(redactSensitive(message));
  }

  return (data.value || []).map((message) => toEmailRecord(message, folder));
}

function toEmailRecord(message, folder) {
  const address = message.From?.EmailAddress || {};
  const contentType = String(message.Body?.ContentType || '').toLowerCase();
  const content = message.Body?.Content || '';

  return {
    id: message.Id,
    messageId: message.InternetMessageId || message.Id,
    protocol: 'imap',
    folder,
    from: address.Address || '',
    fromName: address.Name || '',
    subject: message.Subject || '(No subject)',
    date: message.ReceivedDateTime,
    bodyPreview: message.BodyPreview || '',
    bodyHtml: contentType === 'html' ? content : '',
    bodyText: contentType !== 'html' ? content : '',
  };
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error: text };
  }
}
