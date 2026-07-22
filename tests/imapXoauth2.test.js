import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildXoauth2InitialResponse,
  buildXoauth2Sasl,
  prioritizeAddressRecords,
  parseFetchRecords,
} from '../src/server/imapXoauth2.js';

test('buildXoauth2Sasl matches the Thunderbird-style XOAUTH2 payload', () => {
  const payload = buildXoauth2Sasl('user@example.com', 'access-token');

  assert.equal(payload, 'user=user@example.com\x01auth=Bearer access-token\x01\x01');
  assert.equal(Buffer.from(buildXoauth2InitialResponse('user@example.com', 'access-token'), 'base64').toString('utf8'), payload);
});

test('parseFetchRecords extracts UID, internal date and RFC822 source literal', () => {
  const source = Buffer.from([
    'From: Sender <sender@example.com>',
    'Subject: Hello',
    'Date: Wed, 08 Jul 2026 18:30:00 +0000',
    '',
    'Body',
  ].join('\r\n'));

  const records = parseFetchRecords([
    { type: 'line', text: `* 42 FETCH (UID 9001 INTERNALDATE "08-Jul-2026 18:30:00 +0000" BODY[] {${source.length}}` },
    { type: 'literal', data: source },
    { type: 'line', text: ')' },
    { type: 'line', text: 'A0004 OK FETCH completed' },
  ]);

  assert.equal(records.length, 1);
  assert.equal(records[0].uid, 9001);
  assert.equal(records[0].internalDate.toISOString(), '2026-07-08T18:30:00.000Z');
  assert.equal(records[0].source.toString('utf8'), source.toString('utf8'));
});

test('prioritizeAddressRecords prefers IPv4 before IPv6', () => {
  const ordered = prioritizeAddressRecords([
    { address: '2603:1046:c10:807::2', family: 6 },
    { address: '40.104.21.82', family: 4 },
    { address: '40.104.20.18', family: 4 },
  ], true);

  assert.deepEqual(ordered.map((item) => item.family), [4, 4, 6]);
});
