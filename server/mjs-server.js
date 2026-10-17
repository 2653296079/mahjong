'use strict';
/**
 * mjs-server.js —— 把联机房间接到 HTTP 服务器上。
 *
 * 用法（在 server.js 里）：
 *   const online = require('./server/mjs-server');
 *   const hub = online.attach(server);      // 自动处理 /ws 的升级请求
 *
 * 协议（客户端 ⇄ 服务器都是 JSON 文本帧）：
 *   客户端 → 服务器
 *     {t:'rooms'}                              要房间列表
 *     {t:'join', room?, name, token?, create?} 进房间（给 token = 重连；不给 room = 新开一间）
 *     {t:'start'}                              开局（空座位自动补电脑）
 *     {t:'next'}                               下一局
 *     {t:'act', act, kind, rev, requestId}      基于 rev 操作，requestId 防重复
 *     {t:'chat', text}                         聊天
 *     {t:'ping'}                               保活
 *   服务器 → 客户端
 *     {t:'welcome', rooms}                     连上了
 *     {t:'joined', room, pid, token, you}      进房间成功（token 要存下来，用来重连）
 *     {t:'state', ...房间视图}                  每次变化都推一份完整状态
 *     {t:'chat', from, text, at}
 *     {t:'err', msg}
 */
const { upgrade } = require('./ws-lite');
const { RoomStore } = require('./rooms');
const { readLimits, TokenBucket } = require('./limits');
const { performance } = require('node:perf_hooks');
const { cookieToken, sameOrigin } = require('./account-api');
const { identity, publicIdentity } = require('./identity');
const crypto = require('node:crypto');

const HEARTBEAT_MS = 25000;
const TICK_MS = 500;
const SWEEP_MS = 30000;

function attach(server, opts) {
  opts = opts || {};
  const wsPath = opts.path || '/ws';
  const limits = readLimits(opts.limits);
  const store = new RoomStore(Object.assign({},opts.room,{maxRooms:limits.maxRooms}, opts.accounts ? { archive: room => opts.accounts.syncRoom(room) } : {}));
  const sessions = new Set();
  const instance = crypto.randomUUID();
  let lobbyTask = null, lobbySignature = '';
  function presence() {
    const people = new Map();
    for (const s of sessions) if (s.present && !s.conn.closed) people.set(s.identity.key,s.identity.kind);
    const accounts = Array.from(people.values()).filter(k=>k==='account').length;
    return {online:people.size,accounts,visitors:people.size-accounts};
  }
  function notifyLobby() {
    if (lobbyTask) return;
    lobbyTask=setImmediate(()=>{
      lobbyTask=null;
      const message={t:'presence',...presence(),rooms:store.list()}, signature=JSON.stringify(message);
      if (signature!==lobbySignature) { lobbySignature=signature; for (const s of sessions) if (s.present) send(s,message); }
      if (opts.onStats) opts.onStats(stats());
    });
  }
  function stats() { return {rooms:store.rooms.size,sessions:sessions.size,players:Array.from(store.rooms.values()).reduce((n,r)=>n+r.onlineCount(),0),...presence()}; }
  const pumps = new Map();
  function needsPump(room) {
    const G = room.game;
    if (!G || !G.hand || G.hand.over) return false;
    const awaiting = G.pendingAwaits();
    return G.hasPendingResolve() || !awaiting.length || awaiting.some(a => !room.isLiveHuman(a.seat));
  }

  // 先发布真人操作的权威结果，再在下一轮事件循环推进电脑，避免确认等候整圈计算。
  function schedulePump(room) {
    if (pumps.has(room) || !needsPump(room)) return;
    pumps.set(room, setImmediate(() => {
      pumps.delete(room);
      if (store.get(room.id) !== room || !needsPump(room)) return;
      room.pump(); broadcast(room);
    }));
  }

  function send(session, msg) {
    if (!session || !session.conn || session.conn.closed) return;
    try { session.conn.send(msg); } catch (e) { /* 连接已经坏了，忽略 */ }
  }
  function sessionOf(member) { return member && member.conn ? member.conn : null; }

  function broadcast(room) {
    if (!room) return;
    for (const m of room.members) {
      const s = sessionOf(m);
      if (s) send(s, room.viewFor(m));
    }
    notifyLobby();
  }
  function broadcastChat(room, msg) {
    for (const m of room.members) {
      const s = sessionOf(m);
      if (s) send(s, { t: 'chat', from: msg.from, text: msg.text, at: msg.at });
    }
  }

  // ---------- 升级请求 ----------
  server.on('upgrade', (req, socket, head) => {
    // 静态站点仍可跨站以游客身份联机；携带账号 Cookie 的连接必须同源。
    if (opts.accounts && cookieToken(req) && !sameOrigin(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    let url = '/';
    try { url = decodeURIComponent(String(req.url || '/').split('?')[0]); } catch (e) { url = '/'; }
    if (url !== wsPath) {
      try { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); } catch (e) {}
      try { socket.destroy(); } catch (e) {}
      return;
    }
    if(sessions.size>=limits.maxSessions){
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nRetry-After: 5\r\nContent-Length: 0\r\n\r\n');return;
    }
    const conn = upgrade(req, socket, head, { path: wsPath, maxMessageBytes:limits.maxMessageBytes, maxPendingBytes:limits.maxPendingBytes });
    if (!conn) return;
    const session = { conn: conn, member: null, room: null, alive: true, joinedAt: Date.now() };
    session.accountToken = cookieToken(req);
    session.account = opts.accounts ? opts.accounts.userForToken(session.accountToken) : null;
    session.identity = identity(req,session.account); session.present = false;
    session.budget = new TokenBucket(limits.messageRate,limits.messageBurst,Date.now());
    sessions.add(session);
    conn.on('message', (raw) => onMessage(session, raw));
    conn.on('binary',()=>conn.close(1003,'text messages only'));
    conn.on('pong', () => { session.alive = true; });
    conn.on('close', () => { sessions.delete(session); onClose(session); notifyLobby(); });
    send(session, { t:'welcome', rooms:store.list(), server:'转转麻将联机', instance, identity:publicIdentity(session.identity), presence:presence() });
    notifyLobby();
  });

  function onClose(session) {
    const m = session.member;
    if (!m) return;
    if (m.conn === session) m.conn = null;   // 只有当前连接才有权清空，避免重连后被旧连接踢掉
    const room = session.room;
    if (room) { room.pump(); broadcast(room); }
  }

  function onMessage(session, raw) {
    if(!session.budget.take(Date.now())){session.conn.close(1008,'too many messages');return;}
    if(Buffer.byteLength(raw,'utf8')>limits.maxMessageBytes){session.conn.close(1009,'message too large');return;}
    let msg = null;
    try { msg = JSON.parse(raw); } catch (e) { return send(session, { t: 'err', msg: '消息不是合法 JSON' }); }
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return send(session,{t:'err',msg:'消息必须是一个指令对象'});
    try { handle(session, msg); }
    catch (e) { send(session, { t: 'err', msg: String((e && e.message) || e), code: e.code==='auth'?'auth':undefined, requestId: typeof msg.requestId === 'string' ? msg.requestId : undefined }); }
  }

  function needRoom(session) {
    if (!session.room) throw new Error('你还没有进房间');
    if (!session.member || session.member.conn !== session || session.member.gone) throw new Error('这个连接已失效，请重新进入房间');
    return session.room;
  }

  function handle(session, msg) {
    if (opts.accounts && session.account && !opts.accounts.userForToken(session.accountToken)) { send(session, { t: 'err', msg: '登录已过期，请重新登录', code: 'auth' }); session.conn.close(1008, 'account session expired'); return; }
    if (['rooms','join','hello'].includes(msg.t) && !session.present) { session.present=true; notifyLobby(); }
    switch (msg.t) {
      case 'hello': return send(session,{t:'presence',...presence(),rooms:store.list()});
      case 'ping': return send(session, { t: 'pong', at: Date.now(), probe: Number.isSafeInteger(msg.probe) ? msg.probe : undefined });
      case 'rooms': return send(session, { t: 'rooms', rooms: store.list() });
      case 'join': return doJoin(session, msg);
      case 'leave': {
        doLeave(session);
        return send(session, { t: 'left' });
      }
      case 'start': { const r = needRoom(session); r.start(); broadcast(r); return; }
      case 'next': { const r = needRoom(session); r.next(); broadcast(r); return; }
      case 'act': {
        const r = needRoom(session), member = session.member;
        if (!Number.isInteger(msg.rev) || typeof msg.requestId !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(msg.requestId)) {
          throw new Error('操作缺少局面版本或请求编号，请刷新页面后重试');
        }
        if (!member.actions) member.actions = new Map();
        const signature = JSON.stringify([msg.act, msg.kind]);
        if (member.actions.has(msg.requestId)) {
          if (member.actions.get(msg.requestId) !== signature) throw new Error('同一请求编号不能用于不同操作');
          send(session, { t: 'ack', requestId: msg.requestId, duplicate: true });
          send(session, r.viewFor(member)); return;
        }
        if (msg.rev !== r.rev) {
          send(session, { t: 'err', msg: '牌局已更新，请根据最新牌面重新确认操作', code: 'stale', requestId: msg.requestId });
          send(session, r.viewFor(member)); return;
        }
        const started = performance.now();
        r.act(member, msg, { deferPump: true });
        member.actions.set(msg.requestId, signature);
        if (member.actions.size > 64) member.actions.delete(member.actions.keys().next().value);
        send(session, { t: 'ack', requestId: msg.requestId, duplicate: false, serverMs: Math.round((performance.now() - started) * 10) / 10 });
        broadcast(r); schedulePump(r); return;
      }
      case 'chat': {
        const r = needRoom(session);
        const c = r.pushChat(session.member, msg.text);
        if (c) broadcastChat(r, c);
        return;
      }
      default: return send(session, { t: 'err', msg: '未知指令：' + msg.t });
    }
  }

  function doJoin(session, msg) {
    const wanted = msg.room == null ? '' : String(msg.room).trim();
    if(wanted&&!/^\d{4,8}$/.test(wanted))throw new Error('房间号应为 4–8 位数字');
    if(msg.name!=null&&typeof msg.name!=='string')throw new Error('名字必须是文字');
    if(msg.token&& (typeof msg.token!=='string'||!/^[a-f0-9]{48}$/.test(msg.token)))throw new Error('重连令牌格式不正确');
    let room = null;
    if (wanted) {
      room = store.get(wanted);
      if (!room) {
        if (msg.create === false) throw new Error('房间 ' + wanted + ' 不存在');
        room = store.create(wanted);
      }
    } else {
      room = store.create();          // 没指定房间号就新开一间
    }
    // 同一连接重复点击进房只刷新状态；重连后旧连接不再拥有该座位。
    const sameMember = session.room === room && session.member && session.member.conn === session && !session.member.gone;
    const accountMember = session.account && room.members.find(m => m.accountId === session.account.id);
    const previous = sameMember ? session.member : accountMember || msg.token && room.memberByToken(msg.token);
    if (previous && previous.accountId && (!session.account || previous.accountId !== session.account.id)) throw Object.assign(new Error('请登录此座位所属账号后重连'),{code:'auth'});
    const oldSession = previous && previous.conn;
    const name = session.identity.name;
    const member = sameMember ? session.member : room.join(name, previous ? previous.token : msg.token);
    if (session.account) member.accountId = session.account.id;
    if(room.game)room.game.seats.concat(room.game.queue).forEach(p=>{if(p.id===member.pid)p.name=member.name;});
    // 目标房间满员时保留原房间，不能先退房再发现加入失败。
    if (session.room && session.room !== room) doLeave(session);
    member.conn = session;
    member.gone = false;
    session.member = member;
    session.room = room;
    if (oldSession && oldSession !== session) {
      oldSession.member = null; oldSession.room = null;
      send(oldSession, { t: 'replaced', msg: '此座位已在另一个页面连接。你可以关闭当前页面。' });
      oldSession.conn.close(1000, 'seat reconnected');
    }
    send(session, { t: 'joined', room: room.id, pid: member.pid, token: member.token, you: member.name });
    room.pump();
    broadcast(room);
  }

  function doLeave(session) {
    const room = session.room, m = session.member;
    if (!room || !m) return;
    if (m.conn !== session) { session.member = null; session.room = null; return; }
    m.conn = null;
    room.leave(m);
    session.member = null;
    session.room = null;
    broadcast(room);
    // 走空了就把房间拆掉；还留着的人（掉线的）等 sweep 回收
    if (room.members.length === 0) store.drop(room.id);
  }

  // ---------- 定时器：心跳 / 推进 / 回收 ----------
  const heartbeat = setInterval(() => {
    for (const s of sessions) {
      if (!s.alive) { try { s.conn.close(1001, '心跳超时'); } catch (e) {} continue; }
      s.alive = false;
      try { s.conn.ping(); } catch (e) {}
    }
  }, HEARTBEAT_MS);

  const ticker = setInterval(() => {
    const now = Date.now();
    for (const room of store.rooms.values()) {
      if (room.tick(now)) broadcast(room);
      if (room.archiveError) room.archive();
    }
  }, TICK_MS);

  const sweeper = setInterval(() => {
    if (opts.accounts) for (const room of store.rooms.values()) if (room.onlineCount() === 0 && Date.now() - Math.max(room.lastActive, room.createdAt) > 120000) opts.accounts.interruptRoom(room);
    store.sweep(Date.now(), 2 * 60 * 1000);
    // 房间里一个人都不剩了，直接拆掉，别留在列表里
    for (const room of Array.from(store.rooms.values())) {
      if (room.members.length === 0) store.drop(room.id);
    }
  }, SWEEP_MS);

  for (const t of [heartbeat, ticker, sweeper]) if (t.unref) t.unref();

  return {
    limits: limits,
    store: store,
    sessions: sessions,
    broadcast: broadcast,
    presence, stats,
    close() {
      if (opts.accounts) for (const room of store.rooms.values()) { room.archive(); opts.accounts.interruptRoom(room); }
      clearInterval(heartbeat); clearInterval(ticker); clearInterval(sweeper);
      if (lobbyTask) clearImmediate(lobbyTask);
      for (const task of pumps.values()) clearImmediate(task);
      pumps.clear();
      for (const s of sessions) { try { s.conn.close(1001, '服务器关闭'); } catch (e) {} }
    }
  };
}

module.exports = { attach };
