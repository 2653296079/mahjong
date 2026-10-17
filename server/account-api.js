'use strict';
const { problem, SESSION_MS, username } = require('./account-store');
function cookieToken(req) {
  const m = /(?:^|;\s*)zmj_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '');
  return m ? m[1] : '';
}
function sameOrigin(req) {
  if (!req.headers.origin) return true; // 非浏览器客户端；浏览器写请求还必须携带自定义头。
  try { const u = new URL(req.headers.origin); return /^https?:$/.test(u.protocol) && u.host.toLowerCase() === String(req.headers.host || '').toLowerCase(); }
  catch (e) { return false; }
}
function sessionCookie(req, token, clear) {
  // frp 在边缘终止 TLS；同源 HTTPS Origin 也应设置 Secure，不依赖可伪造的转发头。
  const secure = !!req.socket.encrypted || (sameOrigin(req) && String(req.headers.origin || '').startsWith('https://'));
  return 'zmj_session=' + (clear ? '' : token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + (clear ? 0 : SESSION_MS / 1000) + (secure ? '; Secure' : '');
}
function readJSON(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) throw problem(415, '请使用 JSON 请求');
  return new Promise((resolve, reject) => {
    let length = 0, chunks = [], done = false;
    const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(problem(408, '请求超时')), 10000); timer.unref();
    req.on('data', chunk => { length += chunk.length; if (length > 128 * 1024) { chunks = []; finish(problem(413, '请求内容过大')); } else if (!done) chunks.push(chunk); });
    req.on('error', () => finish(problem(400, '读取请求失败')));
    req.on('end', () => { try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error(); finish(null, value); } catch (e) { finish(problem(400, '请求内容不是合法 JSON')); } });
  });
}
function createAccountAPI(store) {
  const budgets = new Map();
  function limit(key, max, period) {
    const now = Date.now(); let b = budgets.get(key);
    if (!b || b.until <= now) { b = { n: 0, until: now + period }; budgets.set(key, b); }
    if (++b.n > max) throw problem(429, '操作太频繁，请稍后重试');
    if (budgets.size > 10000) { for (const [k,v] of budgets) if (v.until <= now) budgets.delete(k); if (budgets.size > 10000) budgets.delete(budgets.keys().next().value); }
  }
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    const reply = (status, value, cookie) => {
      const body = JSON.stringify(value);
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Length': Buffer.byteLength(body), ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end(body);
    };
    try {
      const ip = req.socket.remoteAddress || 'unknown';
      limit('all:' + ip, 600, 60000);
      if (!sameOrigin(req) || (req.method !== 'GET' && req.headers['x-zmj-request'] !== '1')) throw problem(403, '请从游戏页面操作账号');
      const token = cookieToken(req), user = store.userForToken(token);
      const route = url.pathname;
      if (route === '/api/account/me' && req.method === 'GET') { reply(200, { user, accounts: true }); return true; }
      if (['/api/account/register','/api/account/login'].includes(route) && req.method === 'POST') {
        limit('auth:' + ip, 40, 10 * 60000);
        const data = await readJSON(req), key = username(data.name).key;
        limit('name:' + key, 12, 10 * 60000);
        if (route.endsWith('/register')) limit('register:' + ip, 12, 3600000);
        const account = route.endsWith('/register') ? await store.register(data.name, data.password) : await store.login(data.name, data.password);
        if (token) store.logout(token);
        reply(200, { user: account }, sessionCookie(req, store.createSession(account))); return true;
      }
      if (!user) throw problem(401, '请先登录账号');
      if (route === '/api/account/logout' && req.method === 'POST') { store.logout(token); reply(200, { ok: true }, sessionCookie(req, '', true)); return true; }
      if (route === '/api/account/password' && req.method === 'POST') {
        limit('password:' + user.id, 5, 10 * 60000); const data = await readJSON(req);
        await store.changePassword(user, data.oldPassword, data.password);
        reply(200, { ok: true }, sessionCookie(req, store.createSession(user))); return true;
      }
      const mode = url.searchParams.get('mode') || 'all';
      if (!['all','ai','human'].includes(mode)) throw problem(400, '对局分类不正确');
      if (route === '/api/account/dashboard' && req.method === 'GET') { reply(200, store.dashboard(user, mode)); return true; }
      if (route === '/api/account/matches' && req.method === 'GET') {
        const offset = Number(url.searchParams.get('offset') || 0);
        if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) throw problem(400, '页码不正确');
        reply(200, store.history(user, mode, offset)); return true;
      }
      if (route.startsWith('/api/account/matches/') && req.method === 'GET') { reply(200, store.detail(user, decodeURIComponent(route.slice('/api/account/matches/'.length)))); return true; }
      if (route === '/api/account/solo' && req.method === 'POST') {
        limit('save:' + user.id, 240, 60000); const data=await readJSON(req);
        if(data.owner!==user.id)throw problem(409, '待传牌谱属于另一账号，请登录开局时的账号');
        reply(200, store.saveSolo(user, data)); return true;
      }
      throw problem(404, '找不到这个功能');
    } catch (e) { if (!e.status) console.error('[account] request failed:', e.code || e.name); reply(e.status || 500, { error: e.status ? e.message : '账号服务暂时不可用，请稍后重试' }); return true; }
  };
}
module.exports = { createAccountAPI, cookieToken, sameOrigin };
