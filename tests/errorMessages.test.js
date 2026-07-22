import test from 'node:test';
import assert from 'node:assert/strict';
import {
  explainGraphAuthError,
  explainImapError,
} from '../src/server/errorMessages.js';

test('explainGraphAuthError maps Thunderbird consent failure to a clear action', () => {
  const message = explainGraphAuthError(
    "entra-v1-common: AADSTS65001: The user or administrator has not consented to use the application with ID '9e5f94bc-e8a4-4e73-b8be-63364c29d753' named 'Thunderbird'. Send an interactive authorization request"
  );

  assert.match(message, /Thunderbird/);
  assert.match(message, /Graph/);
  assert.match(message, /IMAP/);
  assert.match(message, /关闭 Graph/);
});

test('explainImapError includes server response details and IPv6 guidance for Outlook half-connected errors', () => {
  const error = new Error('Command failed');
  error.responseStatus = 'NO';
  error.serverResponseCode = 'AUTHENTICATIONFAILED';
  error.responseText = 'User is authenticated but not connected.';
  error.connectionFamily = 'IPv6';
  error.oauthError = {
    status: '401',
    schemes: 'bearer',
    scope: 'https://outlook.office.com/IMAP.AccessAsUser.All',
  };

  const message = explainImapError(error);

  assert.match(message, /IMAP 认证失败/);
  assert.match(message, /AUTHENTICATIONFAILED/);
  assert.match(message, /响应状态：NO/);
  assert.match(message, /User is authenticated but not connected/);
  assert.match(message, /IPv6/);
  assert.match(message, /OAuth 细节/);
});
