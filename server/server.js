'use strict';

/*
 * 薅羊毛 · 本地后端（无状态中转）
 *
 * 只做两件事：
 *   1. 托管静态站（index.html 等）；
 *   2. 把账号绑定过程中的登录请求转发到平台自己的登录接口，并把结果返回给浏览器。
 *
 * 不落地任何东西：没有数据库，没有会话文件，不写盘，不记日志文件。
 * 登录尝试的临时状态（cookie jar、二维码 token）只存在内存里，5 分钟过期自动清除，
 * 成功、失败或过期后立即丢弃。手机号、验证码、会话 cookie 只在当次请求的内存里出现，
 * 不打印完整值、不保存、不发给除平台登录接口以外的任何地方。
 *
 * 登录成功后，会话直接返回给前端，由前端存在本机浏览器 localStorage 里；
 * 解绑就是前端清除本机存储的会话，后端无须也不持有任何东西。
 *
 * 启动：node server.js（或 npm start），默认只监听 127.0.0.1:3000。
 * 依赖：无，只用 Node 内置模块。
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const platforms = require('./platforms');
const attempts = require('./lib/attempts');
const { maskPhone } = require('./lib/http');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const ROOT = path.join(__dirname, '..');
const BODY_LIMIT = 64 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/* ---------- 限流（内存） ---------- */
const rateBuckets = new Map(); // key -> [timestamps]
function rateAllow(key, max, windowMs) {
  const now = Date.now();
  const arr = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return false;
  arr.push(now);
  rateBuckets.set(key, arr);
  return true;
}
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of rateBuckets) {
    const kept = arr.filter((t) => now - t < 60 * 60 * 1000);
    if (kept.length) rateBuckets.set(k, kept); else rateBuckets.delete(k);
  }
}, 5 * 60 * 1000).unref();

/* ---------- 小工具 ---------- */
function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('请求体不是有效 JSON')); }
    });
    req.on('error', reject);
  });
}
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}
function needConsent(body) {
  return body && body.consent === true;
}
function validPhone(phone) {
  return typeof phone === 'string' && /^1[3-9]\d{9}$/.test(phone);
}

/* ---------- API ---------- */
async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/api/platforms') {
    return sendJson(res, 200, { ok: true, platforms: platforms.list() });
  }

  if (req.method === 'POST' && pathname === '/api/accounts/qr/start') {
    const body = await readBody(req);
    if (!needConsent(body)) {
      return sendJson(res, 400, { ok: false, error: 'consent_required', message: '绑定前需要明确同意：仅在本机浏览器保存登录会话' });
    }
    const platform = platforms.get(body.platform);
    if (!platform) return sendJson(res, 400, { ok: false, error: 'bad_platform', message: '不支持的平台' });
    if (!rateAllow('qr:' + clientIp(req), 10, 10 * 60 * 1000)) {
      return sendJson(res, 429, { ok: false, error: 'rate_limited', message: '请求过于频繁，请稍后再试' });
    }
    try {
      const jar = platform.newJar();
      const started = await platform.qrStart(jar);
      const attemptId = attempts.create(platform.id, 'qr', jar, { token: started.token || null, lgToken: started.lgToken || null });
      log('[qr/start]', platform.id, 'attempt', attemptId.slice(0, 8));
      return sendJson(res, 200, {
        ok: true,
        attemptId,
        qrImage: started.qrImage || null,
        qrImageUrl: started.qrImageUrl || null,
        expiresInSec: started.expiresInSec || 120,
      });
    } catch (e) {
      log('[qr/start]', platform.id, 'error', String(e.message || e).slice(0, 120));
      return sendJson(res, 502, { ok: false, error: 'platform_error', message: '二维码获取失败：' + (e.message || '平台无响应') });
    }
  }

  if (req.method === 'GET' && pathname === '/api/accounts/qr/status') {
    const attemptId = url.searchParams.get('attemptId') || '';
    const attempt = attempts.get(attemptId);
    if (!attempt) {
      return sendJson(res, 404, { ok: false, error: 'attempt_expired', message: '登录尝试已过期或不存在，请重新获取二维码' });
    }
    const platform = platforms.get(attempt.platform);
    try {
      let result;
      if (attempt.method !== 'qr') throw new Error('尝试类型不匹配');
      if (platform.id === 'jd') {
        result = await platform.qrStatus(attempt.jar, attempt.data.token);
      } else {
        result = await platform.qrStatus(attempt.jar, attempt.data.lgToken);
      }
      if (result.status === 'success') {
        let completed;
        if (platform.id === 'jd') {
          completed = await platform.qrComplete(attempt.jar, result.ticket);
        } else {
          completed = await platform.qrComplete(attempt.jar, result.successUrl);
        }
        attempts.remove(attemptId);
        log('[qr/status]', platform.id, 'success', completed.displayId);
        return sendJson(res, 200, {
          ok: true,
          status: 'success',
          account: {
            platform: platform.id,
            displayId: completed.displayId,
            method: 'qr',
            boundAt: new Date().toISOString(),
          },
          session: completed.session,
        });
      }
      if (result.status === 'expired' || result.status === 'error') {
        attempts.remove(attemptId);
      }
      return sendJson(res, 200, { ok: true, status: result.status, message: result.message || '' });
    } catch (e) {
      attempts.remove(attemptId);
      log('[qr/status]', platform.id, 'error', String(e.message || e).slice(0, 120));
      return sendJson(res, 200, { ok: true, status: 'error', message: String(e.message || '登录失败') });
    }
  }

  if (req.method === 'POST' && pathname === '/api/accounts/sms/send') {
    const body = await readBody(req);
    if (!needConsent(body)) {
      return sendJson(res, 400, { ok: false, error: 'consent_required', message: '绑定前需要明确同意：仅在本机浏览器保存登录会话' });
    }
    const platform = platforms.get(body.platform);
    if (!platform) return sendJson(res, 400, { ok: false, error: 'bad_platform', message: '不支持的平台' });
    if (!validPhone(body.phone)) {
      return sendJson(res, 400, { ok: false, error: 'bad_phone', message: '手机号格式不正确' });
    }
    if (!rateAllow('sms:' + platform.id + ':' + body.phone, 1, 60 * 1000)
      || !rateAllow('sms-ip:' + clientIp(req), 5, 60 * 60 * 1000)) {
      return sendJson(res, 429, { ok: false, error: 'rate_limited', message: '短信发送过于频繁，请 60 秒后再试' });
    }
    try {
      if (platform.id === 'taobao') {
        const r = await platform.smsSend();
        return sendJson(res, 200, { ok: false, error: r.error, message: r.message });
      }
      const jar = platform.newJar();
      const init = await platform.smsInit(jar);
      const sent = await platform.smsSend(jar, init, body.phone);
      if (!sent.ok) {
        return sendJson(res, 200, { ok: false, error: sent.error || 'platform_rejected', message: sent.message, platform: sent.platform || null });
      }
      const attemptId = attempts.create(platform.id, 'sms', jar, { init, phone: body.phone });
      log('[sms/send]', platform.id, maskPhone(body.phone), 'attempt', attemptId.slice(0, 8));
      return sendJson(res, 200, { ok: true, attemptId, message: sent.message });
    } catch (e) {
      log('[sms/send]', platform.id, 'error', String(e.message || e).slice(0, 120));
      return sendJson(res, 502, { ok: false, error: 'platform_error', message: '短信发送失败：' + (e.message || '平台无响应') });
    }
  }

  if (req.method === 'POST' && pathname === '/api/accounts/sms/verify') {
    const body = await readBody(req);
    const attemptId = body.attemptId || '';
    const attempt = attempts.get(attemptId);
    if (!attempt || attempt.method !== 'sms') {
      return sendJson(res, 404, { ok: false, error: 'attempt_expired', message: '登录尝试已过期或不存在，请重新发送验证码' });
    }
    const code = String(body.code || '');
    if (!/^\d{6}$/.test(code)) {
      return sendJson(res, 400, { ok: false, error: 'bad_code', message: '短信验证码必须是六位数字' });
    }
    const platform = platforms.get(attempt.platform);
    try {
      if (platform.id === 'taobao') {
        const r = await platform.smsVerify();
        attempts.remove(attemptId);
        return sendJson(res, 200, { ok: false, error: r.error, message: r.message });
      }
      const result = await platform.smsVerify(attempt.jar, attempt.data.init, attempt.data.phone, code);
      attempts.remove(attemptId);
      if (!result.ok) {
        return sendJson(res, 200, { ok: false, error: result.error || 'platform_rejected', message: result.message, platform: result.platform || null });
      }
      log('[sms/verify]', platform.id, 'success', result.displayId);
      return sendJson(res, 200, {
        ok: true,
        account: {
          platform: platform.id,
          displayId: result.displayId,
          method: 'sms',
          boundAt: new Date().toISOString(),
        },
        session: result.session,
      });
    } catch (e) {
      attempts.remove(attemptId);
      log('[sms/verify]', platform.id, 'error', String(e.message || e).slice(0, 120));
      return sendJson(res, 502, { ok: false, error: 'platform_error', message: '校验失败：' + (e.message || '平台无响应') });
    }
  }

  return sendJson(res, 404, { ok: false, error: 'not_found', message: '接口不存在' });
}

/* ---------- 静态文件 ---------- */
function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname || '/');
  if (pathname === '/') pathname = '/index.html';
  // 不提供 server/ 目录本身，也不提供隐藏文件。
  if (pathname.startsWith('/server/') || pathname.split('/').some((s) => s.startsWith('.') && s !== '.')) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  const filePath = path.join(ROOT, pathname);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end('Forbidden');
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end('Not Found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------- 入口 ---------- */
const server = http.createServer((req, res) => {
  (async () => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
    } else if (req.method === 'GET') {
      serveStatic(req, res, url);
    } else {
      res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
    }
  })().catch((e) => {
    log('unhandled', String((e && e.message) || e).slice(0, 200));
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'internal', message: '服务端内部错误' });
  });
});

server.listen(PORT, HOST, () => {
  log('薅羊毛本地后端已启动：http://' + HOST + ':' + PORT);
  log('无状态中转：不保存会话、不写盘，登录会话只存在本机浏览器 localStorage。');
});
