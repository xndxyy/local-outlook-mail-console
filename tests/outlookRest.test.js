import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchOutlookRestMessages } from '../src/server/outlookRest.js';

test('Outlook REST compatibility maps inbox and junk messages without exposing tokens', async () => {
  const requested = [];
  const result = await fetchOutlookRestMessages({
    accessToken: 'access-token',
    payload: { keyword: 'invoice' },
    limit: 10,
    fetchImpl: async (url, options) => {
      requested.push({ url: String(url), authorization: options.headers.Authorization });
      const folder = String(url).includes('/junkemail/') ? 'junkemail' : 'inbox';
      return jsonResponse(200, {
        value: [{
          Id: `${folder}-1`,
          InternetMessageId: `<${folder}@example.com>`,
          Subject: folder === 'inbox' ? 'Invoice ready' : 'Unrelated',
          From: { EmailAddress: { Address: 'sender@example.com', Name: 'Sender' } },
          ReceivedDateTime: '2026-07-19T01:00:00Z',
          BodyPreview: folder === 'inbox' ? 'Quarterly invoice' : 'No matching content',
          Body: {
            ContentType: 'HTML',
            Content: folder === 'inbox' ? '<p>Quarterly invoice</p>' : '<p>No matching content</p>',
          },
        }],
      });
    },
  });

  assert.equal(requested.length, 2);
  assert.equal(requested.every((item) => item.authorization === 'Bearer access-token'), true);
  assert.equal(
    requested.every((item) => decodeURIComponent(item.url).includes('$orderby=ReceivedDateTime+desc')),
    true
  );
  assert.equal(result.emails.length, 1);
  assert.equal(result.emails[0].id, 'inbox-1');
  assert.equal(result.emails[0].protocol, 'imap');
  assert.equal(result.emails[0].folder, 'inbox');
  assert.equal(result.emails[0].from, 'sender@example.com');
  assert.equal(result.emails[0].date, '2026-07-19T01:00:00Z');
  assert.equal(result.emails[0].bodyHtml, '<p>Quarterly invoice</p>');
});

function jsonResponse(status, payload) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  };
}
