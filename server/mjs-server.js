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
 *     {t:'act', act, kind}                     出牌/碰/杠/胡/过
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

const HEARTBEAT_MS = 25000;
const TICK_MS = 500;
const SWEEP_MS = 30000;

function attach(server, opts) {
  opts = opts || {};
  const wsPath = opts.path || '/ws';
  const store = new RoomStore(opts.room);
  const sessions = new Set();

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
  }
  function broadcastChat(room, msg) {
    for (const m of room.members) {
      const s = sessionOf(m);
      if (s) send(s, { t: 'chat', from: msg.from, text: msg.text, at: msg.at });
    }
  }

  // ---------- 升级请求 ----------
  server.on('upgrade', (req, socket, head) => {
    let url = '/';
    try { url = decodeURIComponent(String(req.url || '/').split('?')[0]); } catch (e) { url = '/'; }
    if (url !== wsPath) {
      try { socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n'); } catch (e) {}
      try { socket.destroy(); } catch (e) {}
      return;
    }
    const conn = upgrade(req, socket, head, { path: wsPath });
    if (!conn) return;
    const session = { conn: conn, member: null, room: null, alive: true, joinedAt: Date.now() };
    sessions.add(session);
    conn.on('message', (raw) => onMessage(session, raw));
    conn.on('pong', () => { session.alive = true; });
    conn.on('close', () => { sessions.delete(session); onClose(session); });
    send(session, { t: 'welcome', rooms: store.list(), server: '转转麻将联机' });
  });

  function onClose(session) {
    const m = session.member;
    if (!m) return;
    if (m.conn === session) m.conn = null;   // 只有当前连接才有权清空，避免重连后被旧连接踢掉
    const room = session.room;
    if (room) { room.pump(); broadcast(room); }
  }

  function onMessage(session, raw) {
    let msg = null;
    try { msg = JSON.parse(raw); } catch (e) { return send(session, { t: 'err', msg: '消息不是合法 JSON' }); }
    if (!msg || typeof msg !== 'object') return;
    try { handle(session, msg); }
    catch (e) { send(session, { t: 'err', msg: String((e && e.message) || e) }); }
  }

  function needRoom(session) {
    if (!session.room) throw new Error('你还没有进房间');
    if (!session.member || session.member.conn !== session || session.member.gone) throw new Error('这个连接已失效，请重新进入房间');
    return session.room;
  }

  function handle(session, msg) {
    switch (msg.t) {
      case 'ping': return send(session, { t: 'pong', at: Date.now() });
      case 'rooms': return send(session, { t: 'rooms', rooms: store.list() });
      case 'join': return doJoin(session, msg);
      case 'leave': {
        doLeave(session);
        return send(session, { t: 'left' });
      }
      case 'start': { const r = needRoom(session); r.start(); broadcast(r); return; }
      case 'next': { const r = needRoom(session); r.next(); broadcast(r); return; }
      case 'act': { const r = needRoom(session); r.act(session.member, msg); broadcast(r); return; }
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
    const previous = msg.token && room.memberByToken(msg.token);
    const oldSession = previous && previous.conn;
    if (session.room && session.room !== room) doLeave(session);
    const member = sameMember ? session.member : room.join(msg.name, msg.token);
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
    }
  }, TICK_MS);

  const sweeper = setInterval(() => {
    store.sweep(Date.now(), 2 * 60 * 1000);
    // 房间里一个人都不剩了，直接拆掉，别留在列表里
    for (const room of Array.from(store.rooms.values())) {
      if (room.members.length === 0) store.drop(room.id);
    }
  }, SWEEP_MS);

  for (const t of [heartbeat, ticker, sweeper]) if (t.unref) t.unref();

  return {
    store: store,
    sessions: sessions,
    broadcast: broadcast,
    stats() {
      return {
        rooms: store.rooms.size,
        sessions: sessions.size,
        players: Array.from(store.rooms.values()).reduce((a, r) => a + r.onlineCount(), 0)
      };
    },
    close() {
      clearInterval(heartbeat); clearInterval(ticker); clearInterval(sweeper);
      for (const s of sessions) { try { s.conn.close(1001, '服务器关闭'); } catch (e) {} }
    }
  };
}

module.exports = { attach };
