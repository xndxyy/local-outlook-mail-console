import {
  formatImportErrors,
  normalizeEmail,
  parseImportText,
} from '/shared/importParser.js';
import { deduplicateEmails, sortEmailsByDateDesc } from '/shared/emailUtils.js';

const state = {
  accounts: [],
  selectedIds: new Set(),
  emails: [],
  busy: false,
  authAttempt: 0,
  authSession: null,
  appSession: null,
};

const $ = (selector) => document.querySelector(selector);

const elements = {
  accountCount: $('#accountCount'),
  accountList: $('#accountList'),
  accountSearch: $('#accountSearch'),
  importModal: $('#importModal'),
  importTextarea: $('#importTextarea'),
  importPreview: $('#importPreview'),
  statusBadge: $('#statusBadge'),
  progressPanel: $('#progressPanel'),
  progressText: $('#progressText'),
  progressPercent: $('#progressPercent'),
  progressFill: $('#progressFill'),
  resultsHead: $('#resultsHead'),
  issues: $('#issues'),
  emailList: $('#emailList'),
  graphCount: $('#graphCount'),
  imapCount: $('#imapCount'),
  totalCount: $('#totalCount'),
  detailModal: $('#detailModal'),
  detailTitle: $('#detailTitle'),
  detailMeta: $('#detailMeta'),
  detailBody: $('#detailBody'),
  toastStack: $('#toastStack'),
  deviceAuthModal: $('#deviceAuthModal'),
  authSetup: $('#authSetup'),
  authChallenge: $('#authChallenge'),
  deviceUserCode: $('#deviceUserCode'),
  authStatusText: $('#authStatusText'),
};

document.addEventListener('DOMContentLoaded', async () => {
  connectAppSession();
  bindEvents();
  renderAccounts();
  renderEmptyEmails();
  await Promise.all([checkHealth(), loadAccounts()]);
});

window.addEventListener('beforeunload', () => state.appSession?.close());

function connectAppSession() {
  state.appSession?.close();
  state.appSession = new EventSource('/api/app-session');
  state.appSession.addEventListener('error', () => {
    if (state.appSession?.readyState === EventSource.CLOSED) {
      setStatus('error', '本地服务异常');
    }
  });
}

function bindEvents() {
  $('#btnOpenImport').addEventListener('click', openImportModal);
  $('#btnMicrosoftLogin').addEventListener('click', openDeviceAuthModal);
  $('#btnCloseDeviceAuth').addEventListener('click', closeDeviceAuthModal);
  $('#btnCancelDeviceAuth').addEventListener('click', closeDeviceAuthModal);
  $('#btnStartDeviceAuth').addEventListener('click', startDeviceAuth);
  $('#btnOpenMicrosoftLink').addEventListener('click', openMicrosoftLink);
  $('#btnCopyDeviceCode').addEventListener('click', copyDeviceCode);
  $('#btnCloseImport').addEventListener('click', closeImportModal);
  $('#btnCancelImport').addEventListener('click', closeImportModal);
  $('#btnConfirmImport').addEventListener('click', () => runAction(confirmImport, '导入失败'));
  $('#btnClearAll').addEventListener('click', () => runAction(clearAccounts, '清空失败'));
  $('#btnExportAccounts').addEventListener('click', exportAccountList);
  $('#btnFetchSelected').addEventListener('click', () => startFetch(getSelectedAccounts()));
  $('#btnFetchAll').addEventListener('click', () => startFetch(state.accounts));
  $('#btnCloseDetail').addEventListener('click', closeDetail);

  elements.accountSearch.addEventListener('input', renderAccounts);
  elements.importTextarea.addEventListener('input', updateImportPreview);

  elements.importModal.addEventListener('click', (event) => {
    if (event.target === elements.importModal) closeImportModal();
  });

  elements.detailModal.addEventListener('click', (event) => {
    if (event.target === elements.detailModal) closeDetail();
  });

  elements.deviceAuthModal.addEventListener('click', (event) => {
    if (event.target === elements.deviceAuthModal) closeDeviceAuthModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeImportModal();
      closeDetail();
      closeDeviceAuthModal();
    }
  });
}

async function loadAccounts() {
  try {
    const data = await apiRequest('/api/accounts');
    state.accounts = data.accounts || [];
    const knownIds = new Set(state.accounts.map((account) => account.id));
    state.selectedIds = new Set([...state.selectedIds].filter((id) => knownIds.has(id)));
    renderAccounts();
  } catch (error) {
    showToast(`账号库读取失败：${error.message}`, 'warning', 6000);
  }
}

async function checkHealth() {
  try {
    const response = await fetch('/api/health', { cache: 'no-store' });
    const data = await response.json();
    if (data.success) {
      $('#localMode').textContent = data.host;
      setStatus('ready', '就绪');
    }
  } catch {
    setStatus('error', '本地服务异常');
  }
}

function openImportModal() {
  elements.importModal.hidden = false;
  elements.importTextarea.focus();
  updateImportPreview();
}

function closeImportModal() {
  elements.importModal.hidden = true;
}

async function confirmImport() {
  const text = elements.importTextarea.value;
  if (!text.trim()) {
    showToast('请输入导入内容', 'warning');
    elements.importTextarea.focus();
    return;
  }

  const preview = parseImportText(text, state.accounts.map((account) => account.email));

  if (preview.accounts.length > 0) {
    const result = await apiRequest('/api/accounts/import', {
      method: 'POST',
      body: { text },
    });
    state.accounts = result.accounts || state.accounts;
    elements.importTextarea.value = '';
    closeImportModal();
    renderAccounts();
    showToast(`已导入 ${result.imported} 个邮箱，凭据已在本机加密保存`, 'success');

    if (result.errors?.length > 0) {
      showToast(formatImportErrors(result.errors), 'warning', 7000);
    }
    return;
  }

  if (preview.errors.length > 0) {
    showToast(formatImportErrors(preview.errors), 'warning', 7000);
  }

  if (preview.accounts.length === 0 && preview.errors.length === 0) {
    showToast('没有识别到有效邮箱', 'warning');
  }

  updateImportPreview();
}

function updateImportPreview() {
  const text = elements.importTextarea.value;
  if (!text.trim()) {
    elements.importPreview.textContent = '等待导入内容';
    return;
  }

  const result = parseImportText(text, state.accounts.map((account) => account.email));
  const lineCount = text.split(/\r?\n/).filter((line) => line.trim()).length;
  elements.importPreview.textContent = `${lineCount} 行 / ${result.accounts.length} 个有效 / ${result.errors.length} 个跳过`;
}

function renderAccounts() {
  const keyword = normalizeEmail(elements.accountSearch.value);
  const accounts = keyword
    ? state.accounts.filter((account) => normalizeEmail(account.email).includes(keyword))
    : state.accounts;

  elements.accountCount.textContent = keyword ? `${accounts.length}/${state.accounts.length}` : String(state.accounts.length);

  if (state.accounts.length === 0) {
    elements.accountList.innerHTML = emptyMarkup('暂无邮箱', '批量导入后开始取件');
    return;
  }

  if (accounts.length === 0) {
    elements.accountList.innerHTML = emptyMarkup('未找到邮箱', '调整搜索条件');
    return;
  }

  elements.accountList.innerHTML = [
    `<label class="select-all-row">
      <input type="checkbox" id="selectAllAccounts" ${accounts.every((account) => state.selectedIds.has(account.id)) ? 'checked' : ''} />
      <span>全选当前列表</span>
    </label>`,
    ...accounts.map((account) => accountMarkup(account)),
  ].join('');

  $('#selectAllAccounts')?.addEventListener('change', (event) => {
    accounts.forEach((account) => {
      if (event.target.checked) state.selectedIds.add(account.id);
      else state.selectedIds.delete(account.id);
    });
    renderAccounts();
  });

  document.querySelectorAll('.account-row').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button') || event.target.closest('input')) return;
      toggleAccountSelection(row.dataset.id);
    });
  });

  document.querySelectorAll('.account-check').forEach((input) => {
    input.addEventListener('change', () => toggleAccountSelection(input.dataset.id, input.checked));
  });

  document.querySelectorAll('.account-remove').forEach((button) => {
    button.addEventListener('click', () => runAction(
      () => removeAccount(button.dataset.id),
      '删除失败'
    ));
  });

  document.querySelectorAll('.account-copy').forEach((button) => {
    button.addEventListener('click', () => copyText(button.dataset.email, '邮箱已复制'));
  });
}

function accountMarkup(account) {
  const selected = state.selectedIds.has(account.id);
  return `<article class="account-row ${selected ? 'selected' : ''}" data-id="${escapeAttr(account.id)}">
    <input class="account-check" data-id="${escapeAttr(account.id)}" type="checkbox" ${selected ? 'checked' : ''} aria-label="选择 ${escapeAttr(account.email)}" />
    <div class="account-main">
      <strong>${escapeHtml(account.email)}</strong>
      <span>${escapeHtml(formatProtocols(account.protocols))}</span>
    </div>
    <button class="icon-action account-copy" data-email="${escapeAttr(account.email)}" type="button" title="复制邮箱" aria-label="复制邮箱">
      <svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
    </button>
    <button class="icon-action account-remove danger" data-id="${escapeAttr(account.id)}" type="button" title="删除" aria-label="删除邮箱">
      <svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"></path></svg>
    </button>
  </article>`;
}

function toggleAccountSelection(id, forceValue = null) {
  if (!id) return;
  const shouldSelect = forceValue ?? !state.selectedIds.has(id);
  if (shouldSelect) state.selectedIds.add(id);
  else state.selectedIds.delete(id);
  renderAccounts();
}

async function removeAccount(id) {
  await apiRequest(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  state.accounts = state.accounts.filter((account) => account.id !== id);
  state.selectedIds.delete(id);
  renderAccounts();
  showToast('已删除邮箱', 'info');
}

async function clearAccounts() {
  if (state.accounts.length === 0) {
    showToast('没有可清空的邮箱', 'info');
    return;
  }

  await apiRequest('/api/accounts', { method: 'DELETE' });
  state.accounts = [];
  state.selectedIds.clear();
  renderAccounts();
  showToast('已清空本机账号库', 'info');
}

function getSelectedAccounts() {
  return state.accounts.filter((account) => state.selectedIds.has(account.id));
}

function exportAccountList() {
  const accounts = getSelectedAccounts().length > 0 ? getSelectedAccounts() : state.accounts;
  if (accounts.length === 0) {
    showToast('没有可导出的邮箱', 'warning');
    return;
  }

  const content = accounts
    .map((account) => `${account.email}, protocols=${formatProtocols(account.protocols)}, credentials=[not exported]`)
    .join('\n');
  downloadText(`local-outlook-accounts-${new Date().toISOString().slice(0, 10)}.txt`, content);
  showToast(`已导出 ${accounts.length} 个邮箱清单`, 'success');
}

async function startFetch(accounts) {
  if (state.busy) return;
  if (accounts.length === 0) {
    showToast('请先选择或导入邮箱', 'warning');
    return;
  }

  const protocols = getSelectedProtocols();
  if (protocols.length === 0) {
    showToast('请至少选择一种协议', 'warning');
    return;
  }

  state.busy = true;
  setButtonsDisabled(true);
  setStatus('loading', '取件中');
  showProgress(true);
  elements.emailList.innerHTML = skeletonMarkup(4);
  elements.issues.hidden = true;

  const options = {
    keyword: $('#searchKeyword').value.trim(),
    sender: $('#searchSender').value.trim(),
    limit: Number.parseInt($('#fetchLimit').value, 10),
  };

  const allEmails = [];
  const issues = [];
  let completed = 0;
  const total = accounts.length * protocols.length;

  try {
    for (const account of accounts) {
      const supportedProtocols = protocols.filter((protocol) => account.protocols?.includes(protocol));
      const missingProtocols = protocols.filter((protocol) => !supportedProtocols.includes(protocol));
      missingProtocols.forEach((protocol) => {
        issues.push({
          email: account.email,
          protocol,
          message: `尚未授权 ${protocol.toUpperCase()}，请用 Microsoft 登录补充授权`,
        });
        completed += 1;
      });

      const results = await Promise.all(supportedProtocols.map(async (protocol) => {
        updateProgress(Math.round((completed / total) * 95), `${account.email} / ${protocol.toUpperCase()}`);
        try {
          const result = await fetchProtocol(protocol, account, options);
          completed += 1;
          updateProgress(Math.round((completed / total) * 95), `${account.email} / ${protocol.toUpperCase()} 完成`);
          return result;
        } catch (error) {
          completed += 1;
          issues.push({
            email: account.email,
            protocol,
            message: error.message || String(error),
          });
          updateProgress(Math.round((completed / total) * 95), `${account.email} / ${protocol.toUpperCase()} 失败`);
          return { emails: [] };
        }
      }));

      results.forEach((result) => {
        (result.emails || []).forEach((email) => {
          allEmails.push({ ...email, account: account.email });
        });
      });
    }

    updateProgress(100, '整理结果');
    state.emails = sortEmailsByDateDesc(deduplicateEmails(allEmails));
    renderEmails(state.emails);
    renderIssues(issues);
    setStatus(issues.length > 0 ? 'warning' : 'ready', issues.length > 0 ? '部分失败' : '就绪');
    showToast(`取件完成：${state.emails.length} 封，${issues.length} 个问题`, issues.length > 0 ? 'warning' : 'success');
  } finally {
    state.busy = false;
    setButtonsDisabled(false);
    setTimeout(() => showProgress(false), 1200);
  }
}

function getSelectedProtocols() {
  const protocols = [];
  if ($('#toggleGraph').checked) protocols.push('graph');
  if ($('#toggleImap').checked) protocols.push('imap');
  return protocols;
}

async function fetchProtocol(protocol, account, options) {
  const response = await fetch(`/api/fetch-${protocol}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: account.email,
      accountId: account.id,
      keyword: options.keyword,
      sender: options.sender,
      limit: options.limit,
    }),
  });

  const data = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || data.success === false) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({ success: false, error: `HTTP ${response.status}` }));
  if (!response.ok || data.success === false) {
    throw new Error(data.detail || data.error || `HTTP ${response.status}`);
  }
  return data;
}

function openDeviceAuthModal() {
  state.authAttempt += 1;
  state.authSession = null;
  elements.deviceAuthModal.hidden = false;
  elements.authSetup.hidden = false;
  elements.authChallenge.hidden = true;
  $('#btnStartDeviceAuth').hidden = false;
  $('#btnOpenMicrosoftLink').hidden = true;
  $('#btnStartDeviceAuth').disabled = false;
  $('#authEmailHint').focus();
}

function closeDeviceAuthModal() {
  state.authAttempt += 1;
  state.authSession = null;
  elements.deviceAuthModal.hidden = true;
}

async function startDeviceAuth() {
  const attempt = ++state.authAttempt;
  const protocol = $('#authProtocol').value;
  const email = $('#authEmailHint').value.trim();
  $('#btnStartDeviceAuth').disabled = true;

  try {
    const data = await apiRequest('/api/auth/device/start', {
      method: 'POST',
      body: { protocol, email },
    });
    if (attempt !== state.authAttempt) return;
    state.authSession = data;
    elements.authSetup.hidden = true;
    elements.authChallenge.hidden = false;
    elements.deviceUserCode.textContent = data.userCode;
    elements.authStatusText.textContent = `等待 ${protocol.toUpperCase()} 授权完成…`;
    $('#btnStartDeviceAuth').hidden = true;
    $('#btnOpenMicrosoftLink').hidden = false;
    openMicrosoftLink();
    await pollDeviceAuth(attempt, data.interval || 5);
  } catch (error) {
    if (attempt !== state.authAttempt) return;
    $('#btnStartDeviceAuth').disabled = false;
    showToast(`授权启动失败：${error.message}`, 'warning', 7000);
  }
}

async function pollDeviceAuth(attempt, intervalSeconds) {
  await delay(Math.max(1, intervalSeconds) * 1000);
  if (attempt !== state.authAttempt || !state.authSession) return;

  try {
    const result = await apiRequest('/api/auth/device/poll', {
      method: 'POST',
      body: { sessionId: state.authSession.sessionId },
    });
    if (attempt !== state.authAttempt) return;

    if (result.status === 'complete') {
      elements.authStatusText.textContent = '授权完成，账号已保存';
      await loadAccounts();
      showToast(`${result.account.email} 授权完成`, 'success');
      window.setTimeout(closeDeviceAuthModal, 900);
      return;
    }

    if (result.status === 'declined' || result.status === 'expired') {
      elements.authStatusText.textContent = result.status === 'declined' ? '授权已拒绝' : '设备码已过期';
      showToast(elements.authStatusText.textContent, 'warning');
      return;
    }

    elements.authStatusText.textContent = '等待 Microsoft 授权完成…';
    await pollDeviceAuth(attempt, result.interval || intervalSeconds);
  } catch (error) {
    if (attempt !== state.authAttempt) return;
    elements.authStatusText.textContent = `授权检查失败：${error.message}`;
    showToast(elements.authStatusText.textContent, 'warning', 7000);
  }
}

function openMicrosoftLink() {
  const url = state.authSession?.verificationUri;
  if (!url) return;
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyDeviceCode() {
  const code = elements.deviceUserCode.textContent.trim();
  if (code && code !== '—') await copyText(code, '设备码已复制');
}

function renderEmails(emails) {
  elements.resultsHead.hidden = false;
  const graphCount = emails.filter((email) => email.protocol === 'graph').length;
  const imapCount = emails.filter((email) => email.protocol === 'imap').length;
  elements.graphCount.textContent = `Graph ${graphCount}`;
  elements.imapCount.textContent = `IMAP ${imapCount}`;
  elements.totalCount.textContent = `共 ${emails.length}`;

  if (emails.length === 0) {
    renderEmptyEmails('未获取到邮件', '调整关键词、发件人或协议后重试');
    return;
  }

  elements.emailList.innerHTML = emails.map((email, index) => emailMarkup(email, index)).join('');
  document.querySelectorAll('.email-card').forEach((card) => {
    card.addEventListener('click', () => openDetail(Number.parseInt(card.dataset.index, 10)));
  });
}

function emailMarkup(email, index) {
  const sender = email.fromName || email.from || '(未知发件人)';
  const preview = email.bodyPreview || email.bodyText || '';
  const protocolClass = email.protocol === 'imap' ? 'imap' : 'graph';
  return `<article class="email-card" data-index="${index}">
    <div class="email-topline">
      <span class="sender">${escapeHtml(sender)}</span>
      <span class="protocol ${protocolClass}">${escapeHtml(email.protocol || '')}</span>
      <time>${escapeHtml(formatDate(email.date))}</time>
    </div>
    <h3>${escapeHtml(email.subject || '(无主题)')}</h3>
    <p>${escapeHtml(preview.slice(0, 180))}</p>
    <footer>${escapeHtml(email.account || '')}${email.folder ? ` · ${escapeHtml(formatFolder(email.folder))}` : ''}</footer>
  </article>`;
}

function renderIssues(issues) {
  if (!issues.length) {
    elements.issues.hidden = true;
    elements.issues.innerHTML = '';
    return;
  }

  elements.issues.hidden = false;
  elements.issues.innerHTML = `<div class="issues-title">协议问题 <span>${issues.length}</span></div>
    ${issues.map((issue) => `<details>
      <summary><strong>${escapeHtml(issue.protocol.toUpperCase())}</strong> ${escapeHtml(issue.email)} <span>${escapeHtml(issue.message)}</span></summary>
    </details>`).join('')}`;
}

function openDetail(index) {
  const email = state.emails[index];
  if (!email) return;

  elements.detailTitle.textContent = email.subject || '(无主题)';
  elements.detailMeta.innerHTML = [
    ['发件人', email.fromName ? `${email.fromName} <${email.from}>` : email.from],
    ['时间', formatDate(email.date, true)],
    ['协议', String(email.protocol || '').toUpperCase()],
    ['账号', email.account],
    ['文件夹', formatFolder(email.folder)],
  ].filter(([, value]) => value).map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('');

  elements.detailBody.innerHTML = '';
  if (email.bodyHtml) {
    const iframe = document.createElement('iframe');
    iframe.setAttribute('sandbox', '');
    iframe.srcdoc = email.bodyHtml;
    elements.detailBody.appendChild(iframe);
  } else {
    const pre = document.createElement('pre');
    pre.textContent = email.bodyText || email.bodyPreview || '(无内容)';
    elements.detailBody.appendChild(pre);
  }

  elements.detailModal.hidden = false;
}

function closeDetail() {
  elements.detailModal.hidden = true;
  elements.detailBody.innerHTML = '';
}

function renderEmptyEmails(title = '导入邮箱后开始取件', subtitle = '结果会显示在这里') {
  elements.emailList.innerHTML = emptyMarkup(title, subtitle, 'large');
}

function emptyMarkup(title, subtitle, size = '') {
  return `<div class="empty ${size}">
    <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 8 8 5 8-5"></path></svg>
    <strong>${escapeHtml(title)}</strong>
    <span>${escapeHtml(subtitle)}</span>
  </div>`;
}

function skeletonMarkup(count) {
  return Array.from({ length: count }, () => '<div class="skeleton-card"></div>').join('');
}

function showProgress(show) {
  elements.progressPanel.hidden = !show;
}

function updateProgress(percent, text) {
  elements.progressText.textContent = text;
  elements.progressPercent.textContent = `${percent}%`;
  elements.progressFill.style.width = `${percent}%`;
}

function setStatus(type, text) {
  elements.statusBadge.className = `status-chip ${type}`;
  elements.statusBadge.textContent = text;
}

function setButtonsDisabled(disabled) {
  ['#btnFetchSelected', '#btnFetchAll', '#btnMicrosoftLogin', '#btnOpenImport', '#btnClearAll'].forEach((selector) => {
    $(selector).disabled = disabled;
  });
}

function showToast(message, type = 'info', duration = 3600) {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  elements.toastStack.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add('leaving');
    window.setTimeout(() => toast.remove(), 180);
  }, duration);
}

async function runAction(action, label) {
  try {
    await action();
  } catch (error) {
    showToast(`${label}：${error.message}`, 'warning', 7000);
  }
}

async function copyText(text, successMessage) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMessage, 'success', 1600);
  } catch {
    showToast('复制失败', 'warning');
  }
}

function downloadText(filename, content) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatDate(value, full = false) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return full
    ? date.toLocaleString('zh-CN')
    : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatFolder(folder) {
  const value = String(folder || '').toLowerCase();
  if (!value) return '';
  if (value === 'inbox') return '收件箱';
  if (value.includes('junk') || value.includes('spam')) return '垃圾邮件';
  return folder;
}

function formatProtocols(protocols) {
  const values = (protocols || []).map((protocol) => String(protocol).toUpperCase());
  return values.length > 0 ? values.join(' + ') : '未授权';
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(value);
}
