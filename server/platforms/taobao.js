'use strict';

/*
 * 淘宝登录（纯 HTTP 程序实现，流程来自公开文章与项目：cnblogs 淘宝扫码登录、
 * CSDN 扫码登录原理、taobao_mcp 等）：
 *
 * 扫码：
 *   1. GET qrlogin.taobao.com/qrcodelogin/generateQRCode4Login.do?_ksTS=…&from=taobao
 *      → JSON {success, lgToken, url}；二维码图片地址为 https: + url（阿里云 CDN）
 *   2. GET qrlogin.taobao.com/qrcodelogin/qrcodeLoginCheck.do?lgToken=…&defaulturl=…&_ksTS=…&callback=…
 *      JSONP：10000 等待扫码、10001 已扫码待确认、10004 过期、10006 成功（带 url）
 *   3. 跟随成功返回的 url（loginByIm.do），收集登录 cookie；uid 参数用作脱敏后的账号标识
 *
 * 短信：淘宝网页短信登录没有可直接调用的公开接口，登录页流程需要滑块验证，
 * 公开项目里也没有稳定的程序化实现，因此短信方式明确标记为不支持，不编造接口地址。
 */

const { Jar, DESKTOP_UA, nowMs, randomDigits, randomJqueryCallback, parseJsonp, fetchFollow, request, maskId } = require('../lib/http');

const QR_GENERATE = 'https://qrlogin.taobao.com/qrcodelogin/generateQRCode4Login.do';
const QR_CHECK = 'https://qrlogin.taobao.com/qrcodelogin/qrcodeLoginCheck.do';
const DEFAULT_URL = 'https://www.taobao.com/';

function headers() {
  return {
    'user-agent': DESKTOP_UA,
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9',
    referer: 'https://login.taobao.com/member/login.jhtml',
  };
}

async function qrStart(jar) {
  const ts = nowMs() + '_' + randomDigits(4);
  const url = QR_GENERATE + '?_ksTS=' + ts + '&from=taobao';
  const r = await request(url, { headers: headers() }, jar);
  const payload = r.json || parseJsonp(r.text);
  if (!payload || payload.success !== true || !payload.lgToken || !payload.url) {
    throw new Error('二维码获取失败' + (payload && payload.message ? '：' + payload.message : ' HTTP ' + r.status));
  }
  return {
    qrImageUrl: 'https:' + payload.url,
    lgToken: payload.lgToken,
    expiresInSec: 180,
  };
}

async function qrStatus(jar, lgToken) {
  let r;
  try {
    const ts = nowMs() + '_' + randomDigits(4);
    const cb = 'jsonp' + randomDigits(4);
    const url = QR_CHECK + '?lgToken=' + encodeURIComponent(lgToken)
      + '&defaulturl=' + encodeURIComponent(DEFAULT_URL)
      + '&_ksTS=' + ts + '&callback=' + cb;
    r = await request(url, { headers: headers() }, jar);
  } catch (e) {
    // 出口网络偶发中断：返回可重试状态，不删除尝试，前端继续轮询。
    return { status: 'retry', message: '网络波动，正在重试' };
  }
  const payload = parseJsonp(r.text) || r.json;
  if (!payload || payload.code == null) {
    return { status: 'error', message: '轮询响应无法解析' };
  }
  const code = String(payload.code);
  if (code === '10006' && payload.url) return { status: 'success', successUrl: payload.url };
  if (code === '10000') return { status: 'waiting', message: '二维码未扫描' };
  if (code === '10001') return { status: 'scanned', message: '已扫码，请在手机上确认登录' };
  if (code === '10004') return { status: 'expired', message: '二维码已过期，请重新获取' };
  return { status: 'error', message: payload.message || ('未知状态 code=' + code) };
}

async function qrComplete(jar, successUrl) {
  const { res } = await fetchFollow(successUrl, { headers: headers() }, jar, 10);
  const cookies = jar.all().filter((c) => ['cookie2', '_tb_token_', 'sg', 'cna', 'tk', 't'].includes(c.name));
  let uid = '';
  try { uid = new URL(successUrl).searchParams.get('uid') || ''; } catch (e) { /* 忽略 */ }
  if (cookies.length > 0 || uid) {
    const displayId = uid || '淘宝账号';
    return {
      session: { cookies },
      displayId: maskId(displayId),
      rawDisplayId: displayId,
    };
  }
  throw new Error('登录跳转完成，但未取得会话 cookie（HTTP ' + res.status + '）');
}

async function smsSend() {
  return {
    ok: false,
    error: 'unsupported',
    message: '淘宝网页短信登录没有可直接调用的公开接口，登录页流程需要滑块验证；请使用扫码登录',
    platform: null,
  };
}

async function smsVerify() {
  return {
    ok: false,
    error: 'unsupported',
    message: '淘宝网页短信登录没有可直接调用的公开接口，登录页流程需要滑块验证；请使用扫码登录',
    platform: null,
  };
}

module.exports = {
  id: 'taobao',
  name: '淘宝',
  methods: [
    { id: 'qr', label: '扫码登录' },
    { id: 'sms', label: '短信登录', unsupported: true, note: '淘宝网页短信登录无公开可直接调用的接口，请使用扫码登录' },
  ],
  qrStart, qrStatus, qrComplete,
  smsSend, smsVerify,
  maskId,
  newJar: () => new Jar(),
};
