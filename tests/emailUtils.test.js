import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateEmails, filterEmails } from '../src/shared/emailUtils.js';

test('deduplicateEmails prefers Graph records when IMAP and Graph share a message id', () => {
  const emails = deduplicateEmails([
    {
      messageId: '<same@example.com>',
      protocol: 'imap',
      subject: 'Hello',
      bodyPreview: 'short',
    },
    {
      messageId: '<same@example.com>',
      protocol: 'graph',
      subject: 'Hello',
      bodyPreview: 'richer',
    },
  ]);

  assert.equal(emails.length, 1);
  assert.equal(emails[0].protocol, 'graph');
  assert.equal(emails[0].bodyPreview, 'richer');
});

test('filterEmails matches keyword and sender case-insensitively', () => {
  const emails = [
    { subject: 'Invoice Ready', bodyPreview: 'Quarterly report', from: 'billing@example.com' },
    { subject: 'Welcome', bodyPreview: 'hello', from: 'team@example.com' },
  ];

  assert.deepEqual(filterEmails(emails, { keyword: 'invoice', sender: 'billing' }), [emails[0]]);
  assert.deepEqual(filterEmails(emails, { keyword: 'missing' }), []);
});
