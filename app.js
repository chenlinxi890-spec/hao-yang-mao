'use strict';

/* 薅羊毛：线报汇总、我的资源、每日签到。静态站，无后端，个人数据只存本机 localStorage。 */

const LS = {
  favorites: 'hym_favorites',
  resources: 'hym_resources',
  checkins: 'hym_checkins',
  dealsOverride: 'hym_deals_override',
  accounts: 'hym_accounts',
  dealAccounts: 'hym_deal_accounts',
};

const PLATFORM_LABELS = {
  jd: '京东', taobao: '淘宝', pdd: '拼多多', douyin: '抖音',
  meituan: '美团', cloud: '云资源', other: '其他',
};
const PLATFORM_FILTERS = ['全部', '京东', '淘宝', '拼多多', '抖音', '美团', '云资源', '银行App', '其他'];
const TYPE_FILTERS = ['全部', '红包', '优惠券', '服务器', '云电脑', 'AI额度', '其他'];
const KNOWN_TYPES = ['红包', '优惠券', '服务器', '云电脑', 'AI额度'];
const RESOURCE_TYPES = ['云电脑', '服务器', 'AI额度', '其他'];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loadJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}
function todayStr(offsetDays) {
  const d = new Date();
  if (offsetDays) d.setDate(d.getDate() + offsetDays);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

/* ---------- 状态 ---------- */
let deals = [];
let dealsFromOverride = false;
let favorites = new Set(loadJson(LS.favorites, []));
let resources = loadJson(LS.resources, []);
let checkins = loadJson(LS.checkins, []);
let platformFilter = '全部';
let typeFilter = '全部';
let searchQuery = '';
let favOnly = false;
const expandedSummaries = new Set();

/* ---------- 标签页 ---------- */
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    $$('.tab').forEach((b) => b.classList.remove('active'));
    $$('.panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('#tab-' + btn.dataset.tab).classList.add('active');
  });
});

/* ---------- 线报 ---------- */
function platformOf(deal) {
  return PLATFORM_LABELS[deal.platform] || '其他';
}
function typeOf(deal) {
  return KNOWN_TYPES.includes(deal.deal_type) ? deal.deal_type : '其他';
}
function matchPlatform(deal) {
  if (platformFilter === '全部') return true;
  if (platformFilter === '银行App') return deal.deal_type === '银行活动';
  return platformOf(deal) === platformFilter;
}
function matchType(deal) {
  if (typeFilter === '全部') return true;
  return typeOf(deal) === typeFilter;
}
function filteredDeals() {
  const q = searchQuery.trim().toLowerCase();
  return deals.filter((d) => {
    if (!matchPlatform(d) || !matchType(d)) return false;
    if (favOnly && !favorites.has(d.url)) return false;
    if (accountFilter && dealAccounts[d.url] !== accountFilter) return false;
    if (q) {
      const hay = ((d.title || '') + ' ' + (d.summary || '') + ' ' + (d.source_domain || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderFilters() {
  const pf = $('#platformFilters');
  pf.innerHTML = PLATFORM_FILTERS.map((p) =>
    '<button class="chip' + (platformFilter === p ? ' active' : '') + '" data-p="' + p + '">' + escapeHtml(p) + '</button>'
  ).join('');
  pf.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    platformFilter = c.dataset.p;
    renderFilters();
    renderDeals();
  }));
  const tf = $('#typeFilters');
  tf.innerHTML = TYPE_FILTERS.map((t) =>
    '<button class="chip' + (typeFilter === t ? ' active' : '') + '" data-t="' + t + '">' + escapeHtml(t) + '</button>'
  ).join('');
  tf.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => {
    typeFilter = c.dataset.t;
    renderFilters();
    renderDeals();
  }));
}

function summaryHtml(deal) {
  const text = (deal.summary || '').trim();
  if (!text) return '';
  const key = deal.url;
  const LIMIT = 220;
  if (text.length <= LIMIT || expandedSummaries.has(key)) {
    const toggle = text.length > LIMIT
      ? ' <button class="more-btn" data-collapse="' + escapeHtml(key) + '">收起</button>' : '';
    return '<p class="summary">' + escapeHtml(text) + toggle + '</p>';
  }
  return '<p class="summary">' + escapeHtml(text.slice(0, LIMIT)) + '… <button class="more-btn" data-expand="' + escapeHtml(key) + '">展开</button></p>';
}

function renderDeals() {
  const list = filteredDeals();
  $('#dealCount').textContent = '共 ' + list.length + ' 条 / 全部 ' + deals.length + ' 条';
  $('#dealEmpty').classList.toggle('hidden', list.length > 0);
  const el = $('#dealList');
  el.innerHTML = list.map((d) => {
    const fav = favorites.has(d.url);
    return '<article class="deal">'
      + '<div class="badges"><span class="badge">' + escapeHtml(platformOf(d)) + '</span>'
      + '<span class="badge type">' + escapeHtml(d.deal_type || '其他') + '</span></div>'
      + '<h3><a href="' + escapeHtml(d.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(d.title || '(无标题)') + '</a></h3>'
      + summaryHtml(d)
      + '<div class="meta"><span>来源：' + escapeHtml(d.source_domain || '') + '</span>'
      + '<span>抓取：' + escapeHtml(d.fetched_date || '') + '</span>'
      + '<a href="' + escapeHtml(d.url) + '" target="_blank" rel="noopener noreferrer">打开链接 ↗</a>'
      + '<label class="assign">归属 <select data-assign="' + escapeHtml(d.url) + '">' + accountOptions(dealAccounts[d.url] || '') + '</select></label>'
      + '<button class="fav-btn' + (fav ? ' on' : '') + '" data-fav="' + escapeHtml(d.url) + '">' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>'
      + '</div></article>';
  }).join('');
  el.querySelectorAll('[data-assign]').forEach((s) => s.addEventListener('change', () => {
    const url = s.dataset.assign;
    if (s.value) dealAccounts[url] = s.value; else delete dealAccounts[url];
    saveJson(LS.dealAccounts, dealAccounts);
  }));
  el.querySelectorAll('[data-fav]').forEach((b) => b.addEventListener('click', () => {
    const url = b.dataset.fav;
    if (favorites.has(url)) favorites.delete(url); else favorites.add(url);
    saveJson(LS.favorites, Array.from(favorites));
    renderDeals();
  }));
  el.querySelectorAll('[data-expand]').forEach((b) => b.addEventListener('click', () => {
    expandedSummaries.add(b.dataset.expand);
    renderDeals();
  }));
  el.querySelectorAll('[data-collapse]').forEach((b) => b.addEventListener('click', () => {
    expandedSummaries.delete(b.dataset.collapse);
    renderDeals();
  }));
}

$('#search').addEventListener('input', (e) => { searchQuery = e.target.value; renderDeals(); });
$('#favOnly').addEventListener('change', (e) => { favOnly = e.target.checked; renderDeals(); });

$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const arr = Array.isArray(parsed) ? parsed : parsed.deals;
      if (!Array.isArray(arr)) throw new Error('格式不正确');
      const clean = arr.filter((d) => d && d.title && d.url).map((d) => ({
        title: d.title, url: d.url, platform: d.platform || 'other',
        deal_type: d.deal_type || '其他', summary: d.summary || '',
        source_domain: d.source_domain || '', fetched_date: d.fetched_date || todayStr(),
      }));
      saveJson(LS.dealsOverride, clean);
      deals = clean;
      dealsFromOverride = true;
      updateDataNote();
      renderDeals();
    } catch (err) {
      alert('导入失败：文件不是有效的线报 JSON。');
    }
  };
  reader.readAsText(file);
  e.target.value = '';
});
$('#resetDealsBtn').addEventListener('click', () => {
  localStorage.removeItem(LS.dealsOverride);
  loadBundledDeals();
});
function updateDataNote() {
  $('#dataSourceNote').textContent = dealsFromOverride
    ? '当前使用手动导入的线报数据'
    : '当前使用内置样例数据（data/deals.json）';
}

/* ---------- 我的资源 ---------- */
function renderResources() {
  const el = $('#resourceList');
  $('#resourceEmpty').classList.toggle('hidden', resources.length > 0);
  const today = todayStr();
  el.innerHTML = resources.map((r) => {
    const expired = r.expires_date && r.expires_date < today;
    return '<article class="card resource">'
      + '<div class="info"><h3>' + (r.url
        ? '<a href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(r.title) + '</a>'
        : escapeHtml(r.title)) + '</h3>'
      + '<p>类型：' + escapeHtml(r.resource_type || '其他') + '　注册方式：' + escapeHtml(r.auth_method || '其他') + '</p>'
      + '<p>领取：' + escapeHtml(r.claimed_date || '—') + '　到期：' + (r.expires_date
        ? '<span class="' + (expired ? 'expired' : '') + '">' + escapeHtml(r.expires_date) + (expired ? '（已到期）' : '') + '</span>'
        : '—') + '</p>'
      + (r.note ? '<p>备注：' + escapeHtml(r.note) + '</p>' : '')
      + (r.accountId ? '<p>归属账号：' + escapeHtml(accountLabel(r.accountId)) + '</p>' : '')
      + '</div><div class="actions">'
      + '<button class="mini-btn" data-edit-res="' + r.id + '">编辑</button>'
      + '<button class="mini-btn danger" data-del-res="' + r.id + '">删除</button>'
      + '</div></article>';
  }).join('');
  el.querySelectorAll('[data-edit-res]').forEach((b) => b.addEventListener('click', () => {
    const r = resources.find((x) => x.id === b.dataset.editRes);
    if (!r) return;
    $('#resId').value = r.id;
    $('#resTitle').value = r.title || '';
    $('#resUrl').value = r.url || '';
    $('#resType').value = RESOURCE_TYPES.includes(r.resource_type) ? r.resource_type : '其他';
    $('#resAuth').value = r.auth_method || '其他';
    $('#resClaimed').value = r.claimed_date || '';
    $('#resExpires').value = r.expires_date || '';
    $('#resNote').value = r.note || '';
    $('#resAccount').value = r.accountId || '';
    $('#resourceFormTitle').textContent = '编辑资源';
    $('#resCancel').classList.remove('hidden');
    if (typeof $('#resourceForm').scrollIntoView === 'function') {
      $('#resourceForm').scrollIntoView({ behavior: 'smooth' });
    }
  }));
  el.querySelectorAll('[data-del-res]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('确定删除这条资源吗？')) return;
    resources = resources.filter((x) => x.id !== b.dataset.delRes);
    saveJson(LS.resources, resources);
    renderResources();
  }));
}
$('#resourceForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: $('#resTitle').value.trim(),
    url: $('#resUrl').value.trim(),
    resource_type: $('#resType').value,
    auth_method: $('#resAuth').value,
    claimed_date: $('#resClaimed').value || '',
    expires_date: $('#resExpires').value || '',
    note: $('#resNote').value.trim(),
    accountId: $('#resAccount').value || '',
  };
  if (!data.title) return;
  const id = $('#resId').value;
  if (id) {
    const r = resources.find((x) => x.id === id);
    if (r) Object.assign(r, data);
  } else {
    resources.push(Object.assign({ id: uid() }, data));
  }
  saveJson(LS.resources, resources);
  e.target.reset();
  $('#resId').value = '';
  $('#resourceFormTitle').textContent = '添加资源';
  $('#resCancel').classList.add('hidden');
  renderResources();
});
$('#resCancel').addEventListener('click', () => {
  $('#resourceForm').reset();
  $('#resId').value = '';
  $('#resourceFormTitle').textContent = '添加资源';
  $('#resCancel').classList.add('hidden');
});

/* ---------- 每日签到 ---------- */
function streakOf(task) {
  const days = new Set(task.history || []);
  let streak = 0;
  let cursor = days.has(todayStr()) ? 0 : -1;
  while (days.has(todayStr(cursor))) { streak++; cursor--; }
  return streak;
}
function renderCheckins() {
  const el = $('#checkinList');
  $('#checkinEmpty').classList.toggle('hidden', checkins.length > 0);
  const today = todayStr();
  el.innerHTML = checkins.map((t) => {
    const done = (t.history || []).includes(today);
    return '<article class="card checkin' + (done ? ' done' : '') + '">'
      + '<div class="info"><h3>' + escapeHtml(t.title) + '</h3>'
      + '<span class="streak">' + (done ? '今日已打卡 · ' : '今日未打卡 · ') + '连续 ' + streakOf(t) + ' 天</span></div>'
      + '<div class="actions">'
      + '<button class="btn small check-btn" data-check="' + t.id + '">' + (done ? '取消打卡' : '打卡') + '</button>'
      + '<button class="mini-btn danger" data-del-check="' + t.id + '">删除</button>'
      + '</div></article>';
  }).join('');
  el.querySelectorAll('[data-check]').forEach((b) => b.addEventListener('click', () => {
    const t = checkins.find((x) => x.id === b.dataset.check);
    if (!t) return;
    t.history = t.history || [];
    const i = t.history.indexOf(today);
    if (i >= 0) t.history.splice(i, 1); else t.history.push(today);
    saveJson(LS.checkins, checkins);
    renderCheckins();
  }));
  el.querySelectorAll('[data-del-check]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('确定删除这个签到任务吗？历史打卡记录会一起删除。')) return;
    checkins = checkins.filter((x) => x.id !== b.dataset.delCheck);
    saveJson(LS.checkins, checkins);
    renderCheckins();
  }));
}
$('#checkinForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const name = $('#checkinName').value.trim();
  if (!name) return;
  checkins.push({ id: uid(), title: name, history: [] });
  saveJson(LS.checkins, checkins);
  e.target.reset();
  renderCheckins();
});

/* ---------- 账号绑定 ----------
 * 会话只存在本机浏览器 localStorage（hym_accounts），后端是无状态中转，不保存任何会话。
 * 绑定流程：明确同意 → 选平台和方式 → 扫码（后端返回二维码，前端轮询状态）
 * 或短信（后端转发发码/校验请求）→ 成功后会话由前端存入本机。解绑即清除本机存储。 */
let backendAvailable = false;
let platformList = [];
let accounts = loadJson(LS.accounts, []);
let dealAccounts = loadJson(LS.dealAccounts, {});
let accountFilter = '';
let qrPollTimer = null;
let qrAttemptId = null;
let qrExpiresTimer = null;
let smsAttemptId = null;
let smsCooldownUntil = 0;

function platformName(id) {
  const p = platformList.find((x) => x.id === id);
  return p ? p.name : id;
}
function accountLabel(id) {
  const a = accounts.find((x) => x.id === id);
  return a ? (platformName(a.platform) + ' ' + a.displayId) : '（账号已解绑）';
}
function accountOptions(selectedId) {
  return '<option value="">不指定</option>' + accounts.map((a) =>
    '<option value="' + a.id + '"' + (a.id === selectedId ? ' selected' : '') + '>'
    + escapeHtml(platformName(a.platform) + ' ' + a.displayId) + '</option>').join('');
}
function refreshAccountSelects() {
  const resSel = $('#resAccount');
  if (resSel) resSel.innerHTML = accountOptions(resSel.value || '');
  const fSel = $('#accountFilter');
  if (fSel) {
    const cur = fSel.value || '';
    fSel.innerHTML = '<option value="">全部账号</option>' + accounts.map((a) =>
      '<option value="' + a.id + '"' + (a.id === cur ? ' selected' : '') + '>'
      + escapeHtml(platformName(a.platform) + ' ' + a.displayId) + '</option>').join('');
  }
}

async function checkBackend() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const r = await fetch('/api/platforms', { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) throw new Error('no api');
    const data = await r.json();
    platformList = data.platforms || [];
    backendAvailable = true;
    $('#backendNote').textContent = '本地后端已连接。绑定仅在明确同意后进行，会话只保存在本机浏览器。';
    $('#accountsMain').classList.remove('hidden');
    renderBindPlatforms();
    renderAccounts();
    refreshAccountSelects();
  } catch (e) {
    backendAvailable = false;
    $('#backendNote').textContent = '账号绑定需要先启动本地后端：进入 server 目录执行 node server.js（或 npm start），然后刷新本页。未启动后端时，线报、资源、签到功能不受影响。';
    $('#accountsMain').classList.add('hidden');
  }
}

function currentPlatform() {
  return platformList.find((p) => p.id === $('#bindPlatform').value) || null;
}
function renderBindPlatforms() {
  const sel = $('#bindPlatform');
  sel.innerHTML = platformList.map((p) =>
    '<option value="' + p.id + '">' + escapeHtml(p.name) + '</option>').join('');
  updateMethodNote();
}
function updateMethodNote() {
  const p = currentPlatform();
  const method = $('#bindMethod').value;
  const m = p && (p.methods || []).find((x) => x.id === method);
  $('#methodNote').textContent = m && m.note ? m.note : '';
  $('#qrBox').classList.toggle('hidden', method !== 'qr');
  $('#smsBox').classList.toggle('hidden', method !== 'sms');
}

function stopQrPoll() {
  if (qrPollTimer) { clearInterval(qrPollTimer); qrPollTimer = null; }
  if (qrExpiresTimer) { clearTimeout(qrExpiresTimer); qrExpiresTimer = null; }
  qrAttemptId = null;
}

function saveAccount(account, session) {
  const rec = {
    id: uid(),
    platform: account.platform,
    displayId: account.displayId,
    method: account.method,
    boundAt: account.boundAt || new Date().toISOString(),
    session: session || null,
  };
  accounts = accounts.filter((a) => !(a.platform === rec.platform && a.displayId === rec.displayId));
  accounts.push(rec);
  saveJson(LS.accounts, accounts);
  renderAccounts();
  refreshAccountSelects();
  renderResources();
  renderDeals();
}

async function startQr() {
  if (!$('#consentBox').checked) { alert('请先勾选同意。'); return; }
  stopQrPoll();
  const platform = $('#bindPlatform').value;
  $('#qrStatus').textContent = '正在获取二维码…';
  $('#qrImg').classList.add('hidden');
  try {
    const r = await fetch('/api/accounts/qr/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform, consent: true }),
    });
    const data = await r.json();
    if (!data.ok) { $('#qrStatus').textContent = '获取失败：' + (data.message || ''); return; }
    qrAttemptId = data.attemptId;
    const img = $('#qrImg');
    img.src = data.qrImage || data.qrImageUrl || '';
    img.classList.remove('hidden');
    $('#qrStatus').textContent = '请用对应平台 App 扫码（' + (data.expiresInSec || 120) + ' 秒内有效）';
    $('#qrRefreshBtn').classList.remove('hidden');
    qrPollTimer = setInterval(pollQr, 3000);
    qrExpiresTimer = setTimeout(() => {
      if (qrAttemptId) {
        stopQrPoll();
        $('#qrStatus').textContent = '二维码已过期，请重新获取。';
      }
    }, (data.expiresInSec || 120) * 1000);
  } catch (e) {
    $('#qrStatus').textContent = '获取失败：网络错误。';
  }
}
async function pollQr() {
  if (!qrAttemptId) return;
  try {
    const r = await fetch('/api/accounts/qr/status?attemptId=' + encodeURIComponent(qrAttemptId));
    const data = await r.json();
    if (!data.ok) {
      stopQrPoll();
      $('#qrStatus').textContent = data.message || '登录尝试已过期，请重新获取二维码。';
      return;
    }
    if (data.status === 'success') {
      stopQrPoll();
      saveAccount(data.account, data.session);
      $('#qrStatus').textContent = '绑定成功：' + data.account.displayId;
      return;
    }
    if (data.status === 'expired' || data.status === 'error') {
      stopQrPoll();
      $('#qrStatus').textContent = data.message || '二维码已失效，请重新获取。';
      return;
    }
    $('#qrStatus').textContent = data.message || (data.status === 'scanned' ? '已扫码，请在手机上确认登录' : '等待扫码…');
  } catch (e) { /* 网络抖动时继续轮询 */ }
}

async function sendSms() {
  if (!$('#consentBox').checked) { alert('请先勾选同意。'); return; }
  const phone = $('#smsPhone').value.trim();
  if (!/^1[3-9]\d{9}$/.test(phone)) { $('#smsStatus').textContent = '手机号格式不正确。'; return; }
  if (Date.now() < smsCooldownUntil) { $('#smsStatus').textContent = '发送过于频繁，请稍后再试。'; return; }
  $('#smsStatus').textContent = '正在发送…';
  try {
    const r = await fetch('/api/accounts/sms/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ platform: $('#bindPlatform').value, phone, consent: true }),
    });
    const data = await r.json();
    if (!data.ok) { $('#smsStatus').textContent = data.message || '发送失败。'; return; }
    smsAttemptId = data.attemptId;
    smsCooldownUntil = Date.now() + 60000;
    $('#smsStatus').textContent = data.message || '短信已发送，请填写验证码。';
  } catch (e) {
    $('#smsStatus').textContent = '发送失败：网络错误。';
  }
}
async function verifySms() {
  const code = $('#smsCode').value.trim();
  if (!/^\d{6}$/.test(code)) { $('#smsStatus').textContent = '短信验证码必须是六位数字。'; return; }
  if (!smsAttemptId) { $('#smsStatus').textContent = '请先发送验证码。'; return; }
  $('#smsStatus').textContent = '正在校验…';
  try {
    const r = await fetch('/api/accounts/sms/verify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ attemptId: smsAttemptId, code }),
    });
    const data = await r.json();
    if (!data.ok) { $('#smsStatus').textContent = data.message || '校验失败。'; return; }
    saveAccount(data.account, data.session);
    smsAttemptId = null;
    $('#smsStatus').textContent = '绑定成功：' + data.account.displayId;
  } catch (e) {
    $('#smsStatus').textContent = '校验失败：网络错误。';
  }
}

function renderAccounts() {
  const el = $('#accountList');
  $('#accountEmpty').classList.toggle('hidden', accounts.length > 0);
  el.innerHTML = accounts.map((a) =>
    '<article class="card account">'
    + '<div class="info"><h3>' + escapeHtml(platformName(a.platform)) + ' · ' + escapeHtml(a.displayId) + '</h3>'
    + '<p>方式：' + escapeHtml(a.method === 'qr' ? '扫码登录' : '短信登录')
    + '　绑定时间：' + escapeHtml(new Date(a.boundAt).toLocaleString()) + '</p>'
    + '<p>会话只保存在本机浏览器，不上传到任何服务器。</p></div>'
    + '<div class="actions"><button class="mini-btn danger" data-unbind="' + a.id + '">解绑</button></div>'
    + '</article>').join('');
  el.querySelectorAll('[data-unbind]').forEach((b) => b.addEventListener('click', () => {
    const a = accounts.find((x) => x.id === b.dataset.unbind);
    if (!a) return;
    if (!confirm('确定解绑 ' + platformName(a.platform) + ' ' + a.displayId + ' 吗？本机保存的该账号会话将立即清除。')) return;
    accounts = accounts.filter((x) => x.id !== a.id);
    saveJson(LS.accounts, accounts);
    resources = resources.map((r) => (r.accountId === a.id ? Object.assign({}, r, { accountId: '' }) : r));
    saveJson(LS.resources, resources);
    for (const k of Object.keys(dealAccounts)) {
      if (dealAccounts[k] === a.id) delete dealAccounts[k];
    }
    saveJson(LS.dealAccounts, dealAccounts);
    renderAccounts();
    refreshAccountSelects();
    renderResources();
    renderDeals();
  }));
}

$('#bindPlatform').addEventListener('change', updateMethodNote);
$('#bindMethod').addEventListener('change', updateMethodNote);
$('#qrStartBtn').addEventListener('click', startQr);
$('#qrRefreshBtn').addEventListener('click', startQr);
$('#smsSendBtn').addEventListener('click', sendSms);
$('#smsVerifyBtn').addEventListener('click', verifySms);
$('#accountFilter').addEventListener('change', (e) => {
  accountFilter = e.target.value;
  renderDeals();
});

/* ---------- 启动 ---------- */
function loadBundledDeals() {
  if (typeof fetch !== 'function') {
    deals = [];
    $('#dataSourceNote').textContent = '当前环境不支持加载内置数据，请使用「导入线报 JSON」。';
    renderDeals();
    return;
  }
  fetch('data/deals.json')
    .then((r) => { if (!r.ok) throw new Error('load failed'); return r.json(); })
    .then((arr) => {
      deals = Array.isArray(arr) ? arr : (arr.deals || []);
      dealsFromOverride = false;
      updateDataNote();
      renderDeals();
    })
    .catch(() => {
      deals = [];
      updateDataNote();
      $('#dataSourceNote').textContent = '内置数据加载失败：请用本地服务器打开本站，或使用「导入线报 JSON」。';
      renderDeals();
    });
}

(function init() {
  const override = loadJson(LS.dealsOverride, null);
  if (override && Array.isArray(override) && override.length) {
    deals = override;
    dealsFromOverride = true;
    updateDataNote();
  } else {
    loadBundledDeals();
  }
  renderFilters();
  renderDeals();
  renderResources();
  renderCheckins();
  checkBackend();
})();
