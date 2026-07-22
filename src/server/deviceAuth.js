import { randomUUID } from 'node:crypto';
import { redactSensitive } from './security.js';

export const MICROSOFT_THUNDERBIRD_CLIENT_ID = '9e5f94bc-e8a4-4e73-b8be-63364c29d753';

const AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0';
const SCOPES = {
  imap: 'offline_access openid profile email https://outlook.office.com/IMAP.AccessAsUser.All',
  graph: 'offline_access openid profile email https://graph.microsoft.com/Mail.Read',
};

export class DeviceAuthManager {
  constructor({
    accountStore,
    fetchImpl = fetch,
    idFactory = randomUUID,
    now = () => Date.now(),
  }) {
    this.accountStore = accountStore;
    this.fetchImpl = fetchImpl;
    this.idFactory = idFactory;
    this.now = now;
    this.sessions = new Map();
  }

  async start({ protocol = 'imap', email = '' } = {}) {
    const normalizedProtocol = normalizeProtocol(protocol);
    const response = await this.fetchImpl(`${AUTHORITY}/devicecode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: MICROSOFT_THUNDERBIRD_CLIENT_ID,
        scope: SCOPES[normalizedProtocol],
      }),
    });
    const data = await parseJsonResponse(response);
    if (!response.ok || !data.device_code || !data.user_code) {
      throw new Error(redactSensitive(data.error_description || data.error || `Microsoft device authorization returned HTTP ${response.status}`));
    }

    const sessionId = this.idFactory();
    const interval = Math.max(5, Number.parseInt(data.interval || '5', 10));
    this.sessions.set(sessionId, {
      deviceCode: data.device_code,
      protocol: normalizedProtocol,
      emailHint: String(email || '').trim(),
      interval,
      expiresAt: this.now() + Number.parseInt(data.expires_in || '900', 10) * 1000,
    });

    return {
      sessionId,
      status: 'pending',
      userCode: data.user_code,
      verificationUri: data.verification_uri || 'https://www.microsoft.com/link',
      expiresIn: Number.parseInt(data.expires_in || '900', 10),
      interval,
      message: data.message || '在 Microsoft 页面输入代码并完成授权。',
    };
  }

  async poll(sessionId) {
    const session = this.sessions.get(String(sessionId || ''));
    if (!session) throw new Error('Authorization session not found or already completed');
    if (this.now() >= session.expiresAt) {
      this.sessions.delete(sessionId);
      return { status: 'expired' };
    }

    const response = await this.fetchImpl(`${AUTHORITY}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: MICROSOFT_THUNDERBIRD_CLIENT_ID,
        device_code: session.deviceCode,
      }),
    });
    const data = await parseJsonResponse(response);

    if (!response.ok) {
      if (data.error === 'authorization_pending') {
        return { status: 'pending', interval: session.interval };
      }
      if (data.error === 'slow_down') {
        session.interval += 5;
        return { status: 'pending', interval: session.interval };
      }
      if (data.error === 'authorization_declined') {
        this.sessions.delete(sessionId);
        return { status: 'declined' };
      }
      if (data.error === 'expired_token' || data.error === 'bad_verification_code') {
        this.sessions.delete(sessionId);
        return { status: 'expired' };
      }
      throw new Error(redactSensitive(data.error_description || data.error || `Microsoft token endpoint returned HTTP ${response.status}`));
    }

    if (!data.refresh_token) throw new Error('Microsoft did not return a refresh token; authorize again');
    const claims = parseJwtPayload(data.id_token);
    const email = claims.preferred_username || claims.email || session.emailHint;
    if (!email || !String(email).includes('@')) throw new Error('Unable to identify the authorized Microsoft account');

    const account = await this.accountStore.upsertGrant({
      email,
      protocol: session.protocol,
      clientId: MICROSOFT_THUNDERBIRD_CLIENT_ID,
      refreshToken: data.refresh_token,
    });
    this.sessions.delete(sessionId);
    return { status: 'complete', account };
  }
}

function normalizeProtocol(protocol) {
  const value = String(protocol || '').toLowerCase();
  if (!SCOPES[value]) throw new Error('Authorization protocol must be IMAP or Graph');
  return value;
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error_description: text };
  }
}

function parseJwtPayload(token) {
  try {
    const payload = String(token || '').split('.')[1];
    return payload ? JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) : {};
  } catch {
    return {};
  }
}
