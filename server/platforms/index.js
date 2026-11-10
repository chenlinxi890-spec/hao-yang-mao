'use strict';

/*
 * 平台注册表：新增平台时，在 platforms/ 下加一个模块（导出 id、name、methods、
 * qrStart/qrStatus/qrComplete、smsSend/smsVerify、newJar），再在这里加一行。
 * 京东、淘宝先行；拼多多、抖音、美团后续按同样结构接入。
 */

const jd = require('./jd');
const taobao = require('./taobao');

const PLATFORMS = { jd, taobao };

function list() {
  return Object.values(PLATFORMS).map((p) => ({
    id: p.id,
    name: p.name,
    methods: p.methods,
  }));
}

function get(id) {
  return PLATFORMS[id] || null;
}

module.exports = { list, get, PLATFORMS };
