'use strict';

/*
 * 登录尝试的临时上下文：只存在内存里，5 分钟过期自动清除，永不写盘。
 * 保存的是完成一次登录流程必需的临时状态（cookie jar、二维码 token 等），
 * 登录成功、失败或过期后立即丢弃；服务端不保留任何会话。
 */

const TTL_MS = 5 * 60 * 1000;

const attempts = new Map(); // attemptId -> {platform, method, createdAt, jar, data}

function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

function create(platform, method, jar, data) {
  const id = newId();
  attempts.set(id, { platform, method, createdAt: Date.now(), jar, data: data || {} });
  return id;
}

function get(id) {
  const a = attempts.get(id);
  if (!a) return null;
  if (Date.now() - a.createdAt > TTL_MS) {
    attempts.delete(id);
    return null;
  }
  return a;
}

function remove(id) {
  attempts.delete(id);
}

setInterval(() => {
  const now = Date.now();
  for (const [id, a] of attempts) {
    if (now - a.createdAt > TTL_MS) attempts.delete(id);
  }
}, 60 * 1000).unref();

module.exports = { create, get, remove, TTL_MS };
