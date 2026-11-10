'use strict';

/*
 * 京东登录（纯 HTTP 程序实现，流程来自公开项目 JdApis / JD-simulator / JdBuyer / jdCake）：
 *
 * 扫码：
 *   1. GET passport.jd.com/new/login.aspx（取登录页前置 cookie）
 *   2. GET qr.m.jd.com/show?appid=133&size=147&t=… → 二维码 PNG + Set-Cookie wlfstk_smdl（即 token）
 *   3. GET qr.m.jd.com/check?callback=…&appid=133&token=<wlfstk_smdl>&_=
 *      JSONP：200 成功（带 ticket）、201 未扫码、202 已扫码待确认、203 过期、205/257 无效
 *   4. GET passport.jd.com/uc/qrCodeTicketValidation?t=<ticket> → Set-Cookie pt_key/pt_pin 或 thor
 *
 * 短信：
 *   1. 初始化：登录页解析隐藏域（uuid/eid/fp/_t/sa_token 等）+ seq.jd.com/jseqf.html
 *      + GET passport.jd.com/uc/graphic/sessionId/refresh（图形验证码状态）
 *   2. GET passport.jd.com/uc/mobile/sendMessage 发送短信
 *   3. POST passport.jd.com/uc/mobile/loginService 校验短信码，成功后跟随 success/transfer 跳转取票据
 *
 * 限制（已在 README 如实说明）：京东网页登录的 aks 加密（SM2/SM4）、h5st 签名、设备指纹、
 * 图形验证码属于平台反机器人握手，Node 内置模块无法复现；短信接口按真实地址和参数发起请求，
 * 平台返回什么就原样报告什么，不伪造成功。
 */

const { Jar, DESKTOP_UA, nowMs, randomJqueryCallback, parseJsonp, fetchFollow, request, requestBytes, maskPhone, maskId } = require('../lib/http');

const PASSPORT = 'https://passport.jd.com';
const LOGIN_PAGE = 'https://passport.jd.com/new/login.aspx?ReturnUrl=https://home.jd.com/index.html';
const QR_SHOW = 'https://qr.m.jd.com/show';
const QR_CHECK = 'https://qr.m.jd.com/check';
const QR_VALIDATE = 'https://passport.jd.com/uc/qrCodeTicketValidation';
const APPID = 133;
const PAGE_SOURCE = 'login2025';
const PAGE_LOCATION = '';
const FIRST_SHOW_ACCOUNT_LOGIN_PAGE = 'f';
const SMS_CAPTCHA_APP_ID = '1000802';

function docHeaders(referer) {
  return {
    'user-agent': DESKTOP_UA,
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'zh-CN,zh;q=0.9',
    referer: referer || LOGIN_PAGE,
  };
}
function ajaxHeaders(referer) {
  return {
    'user-agent': DESKTOP_UA,
    accept: 'application/json, text/javascript, */*; q=0.01',
    'accept-language': 'zh-CN,zh;q=0.9',
    'x-requested-with': 'XMLHttpRequest',
    referer: referer || LOGIN_PAGE,
  };
}

/* 解析登录页隐藏域 input。 */
function parseHiddenInputs(html) {
  const fields = {};
  const re = /<input[^>]*type=["']hidden["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html || '')) !== null) {
    const tag = m[0];
    const name = /name=["']([^"']+)["']/i.exec(tag);
    const value = /value=["']([^"']*)["']/i.exec(tag);
    if (name) fields[name[1]] = value ? value[1] : '';
  }
  return fields;
}

async function loadLoginPage(jar) {
  // passport.jd.com 在本机出口偶发 socket 中断：重试 3 次；仍失败则抛错，由调用方决定是否继续。
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await request(LOGIN_PAGE, { headers: docHeaders() }, jar);
      if (r.status !== 200) throw new Error('登录页加载失败 HTTP ' + r.status);
      return parseHiddenInputs(r.text);
    } catch (e) {
      lastErr = e;
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
  }
  throw lastErr;
}

/* ---------- 扫码 ---------- */

async function qrStart(jar) {
  // 登录页预取只是为了拿前置 cookie；qr.m.jd.com/show 本身会下发 wlfstk_smdl，
  // 预取失败时继续走扫码流程，不因此整体失败。
  try {
    await loadLoginPage(jar);
  } catch (e) { /* 继续 */ }
  const url = QR_SHOW + '?appid=' + APPID + '&size=147&t=' + nowMs();
  const r = await requestBytes(url, { headers: docHeaders(LOGIN_PAGE) }, jar);
  if (r.status !== 200 || !r.buf || r.buf.length < 100) {
    throw new Error('二维码获取失败 HTTP ' + r.status);
  }
  const token = jar.get('wlfstk_smdl');
  if (!token) throw new Error('二维码获取失败：未返回 token');
  return {
    qrImage: 'data:image/png;base64,' + r.buf.toString('base64'),
    token,
    expiresInSec: 120,
  };
}

async function qrStatus(jar, token) {
  let r;
  try {
    const cb = randomJqueryCallback();
    const url = QR_CHECK + '?callback=' + cb + '&appid=' + APPID
      + '&token=' + encodeURIComponent(token) + '&_=' + nowMs();
    r = await request(url, { headers: ajaxHeaders(LOGIN_PAGE) }, jar);
  } catch (e) {
    // 出口网络偶发中断：返回可重试状态，不删除尝试，前端继续轮询。
    return { status: 'retry', message: '网络波动，正在重试' };
  }
  const payload = parseJsonp(r.text);
  if (!payload || payload.code == null) {
    return { status: 'error', message: '轮询响应无法解析' };
  }
  const code = Number(payload.code);
  if (code === 200 && payload.ticket) return { status: 'success', ticket: payload.ticket };
  if (code === 201) return { status: 'waiting', message: '二维码未扫描' };
  if (code === 202) return { status: 'scanned', message: '已扫码，请在手机上确认登录' };
  if (code === 203) return { status: 'expired', message: '二维码已过期，请重新获取' };
  if (code === 205 || code === 257) return { status: 'expired', message: payload.msg || '二维码无效，请重新获取' };
  return { status: 'error', message: payload.msg || ('未知状态 code=' + code) };
}

async function qrComplete(jar, ticket) {
  const url = QR_VALIDATE + '?t=' + encodeURIComponent(ticket);
  const r = await request(url, { headers: docHeaders('https://passport.jd.com/uc/login?ltype=logout') }, jar);
  const ptKey = jar.get('pt_key');
  const ptPin = jar.get('pt_pin');
  const thor = jar.get('thor');
  const cookies = jar.all().filter((c) => ['pt_key', 'pt_pin', 'thor'].includes(c.name));
  if ((ptKey && ptPin) || thor) {
    const displayId = ptPin ? decodeURIComponent(ptPin) : '京东账号';
    return {
      session: { cookies },
      displayId: maskId(displayId),
      rawDisplayId: displayId,
    };
  }
  const msg = (r.json && (r.json.msg || r.json.message)) || '';
  throw new Error('票据校验未返回登录会话' + (msg ? '：' + msg : '（平台可能要求加密握手，请在京东登录页重新扫码）'));
}

/* ---------- 短信 ---------- */

async function smsInit(jar) {
  const fields = await loadLoginPage(jar);
  // seq sid（设备序列号页，最佳努力：失败不中断）。
  try {
    await request('https://seq.jd.com/jseqf.html', { headers: docHeaders(LOGIN_PAGE) }, jar);
  } catch (e) { /* 忽略 */ }
  // 图形验证码状态：status==1 表示发送短信前需要先完成人机验证。
  let captcha = { status: 0, sessionId: '', jwtToken: '' };
  try {
    const r = await request(
      PASSPORT + '/uc/graphic/sessionId/refresh?aksParamsU=&appId=' + SMS_CAPTCHA_APP_ID,
      { headers: ajaxHeaders(LOGIN_PAGE) }, jar);
    if (r.json) {
      captcha = {
        status: Number(r.json.status || 0),
        sessionId: String(r.json.sessionId || ''),
        jwtToken: String(r.json.jwtToken || ''),
      };
    }
  } catch (e) { /* 忽略 */ }
  return { fields, captcha };
}

function smsSendParams(fields, phone, captcha) {
  const p = new URLSearchParams();
  p.set('source', fields.source || '');
  p.set('eid', fields.eid || '');
  p.set('uuid', fields.uuid || '');
  p.set('mobile', phone);
  p.set('imageAuthCodeToken', '');
  p.set('firstShowAccountLoginPage', fields.firstShowAccountLoginPage || FIRST_SHOW_ACCOUNT_LOGIN_PAGE);
  p.set('pageSource', fields.pageSource || PAGE_SOURCE);
  p.set('pageLocation', fields.pageLocation || PAGE_LOCATION);
  if (captcha.sessionId) p.set('graphicCaptchaSessionId', captcha.sessionId);
  if (captcha.jwtToken) p.set('graphicCaptchaJwtToken', captcha.jwtToken);
  p.set('_', String(nowMs()));
  return p;
}

async function smsSend(jar, init, phone) {
  const { fields, captcha } = init;
  if (captcha.status === 1) {
    return {
      ok: false,
      error: 'captcha_required',
      message: '发送短信前需要先完成图形验证（平台人机校验），本工具无法代为完成，请使用扫码登录',
      platform: null,
    };
  }
  const params = smsSendParams(fields, phone, captcha);
  const url = PASSPORT + '/uc/mobile/sendMessage?' + params.toString();
  const r = await request(url, { headers: ajaxHeaders(LOGIN_PAGE) }, jar);
  const payload = r.json || null;
  const ok = r.status === 200 && payload && (payload.code === 1 || payload.code === '1');
  return {
    ok,
    error: ok ? null : 'platform_rejected',
    message: ok ? '短信已发送' : ('平台未发送短信：' + ((payload && (payload.msg || payload.message)) || ('HTTP ' + r.status))),
    platform: payload,
  };
}

async function smsVerify(jar, init, phone, code) {
  const { fields } = init;
  const body = new URLSearchParams();
  body.set('uuid', fields.uuid || '');
  body.set('eid', fields.eid || '');
  body.set('eid2', fields.eid2 || '');
  body.set('fp', fields.fp || '');
  body.set('_t', fields._t || '_t');
  body.set('mobile', phone);
  body.set('mobileCode', code);
  body.set('pageSource', fields.pageSource || PAGE_SOURCE);
  body.set('pageLocation', fields.pageLocation || PAGE_LOCATION);
  body.set('loginType', fields.loginType || 'f');
  body.set('sa_token', fields.sa_token || '');
  body.set('seqSid', fields.seqSid || '');
  body.set('useSlideAuthCode', fields.useRandomSlideAuthCode || '');
  body.set('authcode', '');
  body.set('ssoDomains', fields.ssoDomains || '');
  const url = PASSPORT + '/uc/mobile/loginService?r=' + Math.random() + '&version=2015';
  const r = await request(url, {
    method: 'POST',
    headers: Object.assign(ajaxHeaders(LOGIN_PAGE), { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }),
    body: body.toString(),
  }, jar);
  const payload = r.json || null;
  const target = payload && (payload.success || payload.transfer);
  if (target) {
    const resolved = new URL(String(target), LOGIN_PAGE).toString();
    await fetchFollow(resolved, { headers: docHeaders(LOGIN_PAGE) }, jar, 10);
    const ptKey = jar.get('pt_key');
    const ptPin = jar.get('pt_pin');
    const thor = jar.get('thor');
    const cookies = jar.all().filter((c) => ['pt_key', 'pt_pin', 'thor'].includes(c.name));
    if ((ptKey && ptPin) || thor) {
      const displayId = ptPin ? decodeURIComponent(ptPin) : maskPhone(phone);
      return {
        ok: true,
        session: { cookies },
        displayId: maskId(displayId),
        rawDisplayId: displayId,
      };
    }
    return { ok: false, error: 'no_session', message: '登录跳转完成，但未取得会话票据', platform: payload };
  }
  const msg = payload && (payload.msg || payload.username || payload.authcode2 || payload.message);
  return {
    ok: false,
    error: 'platform_rejected',
    message: msg ? String(msg) : ('短信校验失败 HTTP ' + r.status + '（平台可能要求图形验证或加密握手）'),
    platform: payload,
  };
}

module.exports = {
  id: 'jd',
  name: '京东',
  methods: [
    { id: 'qr', label: '扫码登录' },
    { id: 'sms', label: '短信登录', note: '平台可能要求图形验证或加密握手，失败时返回平台原样提示' },
  ],
  qrStart, qrStatus, qrComplete,
  smsInit, smsSend, smsVerify,
  maskPhone, maskId,
  newJar: () => new Jar(),
};
