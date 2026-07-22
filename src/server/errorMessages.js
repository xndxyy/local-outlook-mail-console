import { redactSensitive } from './security.js';

export function explainGraphAuthError(error) {
  const text = redactSensitive(error?.message || String(error || '未知错误'));

  if (/Thunderbird/i.test(text) && /AADSTS65001|has not consented|AADSTS70000/i.test(text)) {
    return [
      'Graph 授权失败：这个 refresh token 来自 Thunderbird client id，但该 client id 没有给当前账号授权 Graph 邮件读取权限。',
      '这类账号通常只能走 IMAP。请关闭 Graph，只勾选 IMAP 后重试。',
      `原始摘要：${compactMicrosoftTrace(text)}`,
    ].join(' ');
  }

  if (/AADSTS65001|has not consented/i.test(text)) {
    return `Graph 授权失败：该 client id 尚未获得 Graph Mail.Read 同意。需要重新进行交互授权，或关闭 Graph 改用 IMAP。${compactMicrosoftTrace(text)}`;
  }

  if (/AADSTS70000|unauthorized or expired/i.test(text)) {
    return `Graph 授权失败：请求的 Graph scope 未授权或已过期。请关闭 Graph 改用 IMAP，或换一个已授权 Mail.Read 的 refresh token。${compactMicrosoftTrace(text)}`;
  }

  return text;
}

export function explainImapError(error) {
  const parts = [];
  const message = redactSensitive(error?.message || String(error || '未知错误'));
  const responseText = redactSensitive(error?.responseText || error?.response || '');
  const serverCode = error?.serverResponseCode ? String(error.serverResponseCode) : '';
  const responseStatus = error?.responseStatus ? String(error.responseStatus) : '';
  const connectionFamily = String(error?.connectionFamily || error?.remoteFamily || '').toUpperCase();
  const oauthError = normalizeOauthError(error?.oauthError);

  if (error?.authenticationFailed || /AUTHENTICATE|Authentication|Command failed/i.test(message + responseText + serverCode)) {
    parts.push('IMAP 认证失败');
  } else {
    parts.push('IMAP 请求失败');
  }

  if (serverCode) parts.push(`服务器代码：${serverCode}`);
  if (responseStatus) parts.push(`响应状态：${responseStatus}`);
  if (responseText) parts.push(`服务器响应：${responseText}`);
  if (/User is authenticated but not connected/i.test(message + responseText)) {
    const familyHint = connectionFamily.includes('IPV6')
      ? '当前连接命中 IPv6，建议优先切换到 IPv4 或临时关闭 IPv6 后重试。'
      : '如果是新 Outlook 账号，还要检查网页端 Forwarding and IMAP 里的 “Let devices use IMAP” 是否已开启。';
    parts.push(`IMAP 已认证但未连接：这通常是 Outlook/Exchange 侧的连接状态问题。${familyHint}`);
  }
  if (oauthError) parts.push(`OAuth 细节：${oauthError}`);

  if (parts.length === 1) parts.push(message);

  return parts.join('。');
}

function normalizeOauthError(value) {
  if (!value) return '';
  if (typeof value === 'string') return redactSensitive(value);
  const entries = Object.entries(value)
    .filter(([, item]) => item !== undefined && item !== null && String(item) !== '')
    .map(([key, item]) => `${key}=${redactSensitive(String(item))}`);
  return entries.join(', ');
}

function compactMicrosoftTrace(value) {
  return redactSensitive(String(value || ''))
    .replace(/\s+/g, ' ')
    .replace(/Trace ID:[^|]+/gi, '')
    .replace(/Correlation ID:[^|]+/gi, '')
    .replace(/Timestamp:[^|]+/gi, '')
    .trim();
}
