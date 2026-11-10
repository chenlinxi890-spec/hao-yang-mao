'use strict';

/* 通用小工具：带 cookie  jar 的请求、手动跟随跳转、JSONP 解析、脱敏。只用 Node 内置模块。 */

const { Jar } = require('./cookies');

const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

function nowMs() { return Date.now(); }

function randomDigits(n) {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

function randomJqueryCallback() {
  return 'jQuery' + randomDigits(7);
}

/* 解析 jQuery JSONP：jQuery123({...}) / jsonp123({...}) -> 对象；解析失败返回 null。
 * 淘宝返回的是 (function(){jsonp123({...});})(); 这种包了一层 function 的形式，
 * 贪婪正则会越过 JSON 的右花括号，所以用花括号配对扫描取出 JSON 对象。 */
function parseJsonp(text) {
  if (!text) return null;
  const s = String(text).trim();
  const lower = s.toLowerCase();
  let at = lower.indexOf('jsonp');
  if (at < 0) at = lower.indexOf('jquery');
  if (at >= 0) {
    const paren = s.indexOf('(', at);
    const open = paren >= 0 ? s.indexOf('{', paren) : -1;
    if (open >= 0) {
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = open; i < s.length; i++) {
        const ch = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
        } else if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}') {
          depth--;
          if (depth === 0) {
            try { return JSON.parse(s.slice(open, i + 1)); } catch (e) { return null; }
          }
        }
      }
    }
  }
  try { return JSON.parse(s); } catch (e) { return null; }
}

/* 手动跟随跳转（最多 10 跳），每跳都把 Set-Cookie 收进 jar。返回最终响应。
 * 单次请求默认 20 秒超时，避免出口挂起时把接口调用无限拖住。 */
async function fetchFollow(url, opts, jar, maxRedirects) {
  const limit = maxRedirects == null ? 10 : maxRedirects;
  let current = url;
  let last = null;
  const signal = opts.signal || AbortSignal.timeout(20000);
  for (let i = 0; i <= limit; i++) {
    const headers = Object.assign({}, opts.headers || {});
    const ck = jar.header();
    if (ck) headers.cookie = ck;
    const res = await fetch(current, Object.assign({}, opts, { headers, redirect: 'manual', signal }));
    if (typeof res.headers.getSetCookie === 'function') {
      jar.absorb(res.headers.getSetCookie(), new URL(current).hostname);
    }
    last = res;
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return { res, url: current };
  }
  return { res: last, url: current };
}

/* 一次请求：发 cookie、收 Set-Cookie 进 jar。返回 {status, text, json}。 */
async function request(url, opts, jar) {
  const headers = Object.assign({}, opts.headers || {});
  const ck = jar.header();
  if (ck) headers.cookie = ck;
  const signal = opts.signal || AbortSignal.timeout(20000);
  const res = await fetch(url, Object.assign({}, opts, { headers, signal }));
  if (typeof res.headers.getSetCookie === 'function') {
    jar.absorb(res.headers.getSetCookie(), new URL(url).hostname);
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (e) { /* 非 JSON 响应 */ }
  return { status: res.status, headers: res.headers, text, json };
}

async function requestBytes(url, opts, jar) {
  const headers = Object.assign({}, opts.headers || {});
  const ck = jar.header();
  if (ck) headers.cookie = ck;
  const signal = opts.signal || AbortSignal.timeout(20000);
  const res = await fetch(url, Object.assign({}, opts, { headers, signal }));
  if (typeof res.headers.getSetCookie === 'function') {
    jar.absorb(res.headers.getSetCookie(), new URL(url).hostname);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  return { status: res.status, headers: res.headers, buf };
}

/* 脱敏：手机号中间打码；一般标识只留首尾。 */
function maskPhone(phone) {
  const p = String(phone || '');
  if (p.length < 7) return '***';
  return p.slice(0, 3) + '****' + p.slice(-4);
}
function maskId(id) {
  const s = String(id || '');
  if (!s) return '—';
  if (s.length <= 4) return s.slice(0, 1) + '***';
  return s.slice(0, 2) + '***' + s.slice(-2);
}

module.exports = {
  Jar, DESKTOP_UA, nowMs, randomDigits, randomJqueryCallback,
  parseJsonp, fetchFollow, request, requestBytes, maskPhone, maskId,
};
