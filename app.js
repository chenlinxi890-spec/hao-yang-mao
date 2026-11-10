'use strict';

/* 薅羊毛：线报汇总、我的资源、每日签到。静态站，无后端，个人数据只存本机 localStorage。 */

const LS = {
  favorites: 'hym_favorites',
  resources: 'hym_resources',
  checkins: 'hym_checkins',
  dealsOverride: 'hym_deals_override',
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
      + '<button class="fav-btn' + (fav ? ' on' : '') + '" data-fav="' + escapeHtml(d.url) + '">' + (fav ? '★ 已收藏' : '☆ 收藏') + '</button>'
      + '</div></article>';
  }).join('');
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
})();
