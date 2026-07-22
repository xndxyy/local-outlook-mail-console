import { redactSensitive } from './security.js';

const V2_AUTHORITIES = ['consumers', 'common'];
const V1_AUTHORITIES = ['common'];
const LIVE_TOKEN_URL = 'https://login.live.com/oauth20_token.srf';

export function buildRefreshTokenCandidates({
  clientId,
  refreshToken,
  scope,
  resource,
  legacyLiveScopes,
}) {
  const candidates = [];

  if (scope) {
    for (const authority of V2_AUTHORITIES) {
      candidates.push({
        label: `entra-v2-${authority}`,
        url: `https://login.microsoftonline.com/${authority}/oauth2/v2.0/token`,
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          scope,
        }),
      });
    }
  }

  if (resource) {
    for (const authority of V1_AUTHORITIES) {
      candidates.push({
        label: `entra-v1-${authority}`,
        url: `https://login.microsoftonline.com/${authority}/oauth2/token`,
        body: new URLSearchParams({
          client_id: clientId,
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          resource,
        }),
      });
    }
  }

  if (legacyLiveScopes) {
    candidates.push({
      label: 'legacy-live',
      url: LIVE_TOKEN_URL,
      body: new URLSearchParams({
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        scope: legacyLiveScopes,
      }),
    });
  }

  return candidates;
}

export async function exchangeRefreshToken({
  clientId,
  refreshToken,
  scope,
  resource,
  legacyLiveScopes,
  includeDetails = false,
  fetchImpl = fetch,
}) {
  const candidates = buildRefreshTokenCandidates({
    clientId,
    refreshToken,
    scope,
    resource,
    legacyLiveScopes,
  });
  const errors = [];

  for (const candidate of candidates) {
    const response = await fetchImpl(candidate.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: candidate.body,
    });

    const data = await parseTokenResponse(response);
    if (response.ok && data.access_token) {
      if (!includeDetails) return data.access_token;
      return {
        accessToken: data.access_token,
        candidateLabel: candidate.label,
        tokenType: data.token_type || 'Bearer',
        expiresIn: data.expires_in || null,
        scope: data.scope || scope || legacyLiveScopes || '',
      };
    }

    const error = data.error_description || data.error || `Microsoft token endpoint returned HTTP ${response.status}`;
    errors.push(`${candidate.label}: ${redactSensitive(error)}`);
  }

  throw new Error(errors.join(' | ') || 'Unable to exchange refresh token');
}

async function parseTokenResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { error_description: text };
  }
}
