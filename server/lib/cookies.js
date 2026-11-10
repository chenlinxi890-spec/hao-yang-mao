'use strict';

/* Cookie jar：解析 Set-Cookie、拼装 Cookie 请求头。只存在内存里，不写盘。 */

function parseSetCookie(setCookieHeaders, defaultDomain) {
  const out = [];
  for (const raw of setCookieHeaders || []) {
    const parts = String(raw).split(';');
    const first = parts[0] || '';
    const eq = first.indexOf('=');
    if (eq <= 0) continue;
    const name = first.slice(0, eq).trim();
    const value = first.slice(eq + 1).trim();
    const attrs = {};
    for (const p of parts.slice(1)) {
      const kv = p.trim().split('=');
      attrs[kv[0].toLowerCase()] = kv[1] ? kv[1].trim() : true;
    }
    out.push({
      name,
      value,
      domain: attrs.domain || defaultDomain || '',
      path: attrs.path || '/',
      expires: attrs.expires || '',
    });
  }
  return out;
}

class Jar {
  constructor() {
    this.map = new Map(); // name -> {value, domain, path}
  }
  absorb(setCookieHeaders, defaultDomain) {
    for (const c of parseSetCookie(setCookieHeaders, defaultDomain)) {
      if (!c.name) continue;
      this.map.set(c.name, { value: c.value, domain: c.domain, path: c.path });
    }
  }
  get(name) {
    const e = this.map.get(name);
    return e ? e.value : '';
  }
  header() {
    const pairs = [];
    for (const [name, e] of this.map) {
      if (e.value !== '') pairs.push(name + '=' + e.value);
    }
    return pairs.join('; ');
  }
  all() {
    return Array.from(this.map, ([name, e]) => ({ name, value: e.value, domain: e.domain, path: e.path }));
  }
  size() { return this.map.size; }
}

module.exports = { Jar, parseSetCookie };
