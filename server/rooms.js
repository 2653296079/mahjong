'use strict';
/**
 * rooms.js —— 联机房间：把单机引擎包装成「服务端权威」的房间。
 *
 * 这一层不碰任何网络，是纯逻辑，所以能直接写测试（防作弊、掉线托管、转转轮换）。
 * 网络部分交给 mjs-server.js。
 *
 * 设计要点：
 *  1. 引擎从 ../index.html 里现取，服务端与浏览器共用同一份代码，永远不会出现两份实现走偏
 *  2. 服务端权威：牌局状态只在服务器上跑，客户端只能提交「操作」，拿不到别人的暗牌
 *  3. 每个座位都可能是真人，引擎已经支持多座位待决（见 tests/multi.test.js）
 *  4. 掉线不炸局：掉线玩家的待决由服务器按电脑思路代打，重连后无缝接回
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let _core = null;
/** 从 index.html 里取出内联引擎（零构建，不维护第二份源码） */
function loadCore() {
  if (_core) return _core;
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const m = /<script\b[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m || m[1].length < 20000) throw new Error('index.html 里找不到内联的引擎代码');
  const mod = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', m[1])(
    mod, mod.exports, require, path.join(__dirname, 'core.js'), __dirname);
  _core = mod.exports;
  return _core;
}

const BOT_NAMES = ['阿湘', '老陈', '小满', '胖哥', '梅姨', '铁头', '阿莲', '老周', '小郭', '大刘', '阿珍', '老冯'];

let seq = 0;
function newId(prefix) {
  seq++;
  return prefix + seq.toString(36) + Math.random().toString(36).slice(2, 6);
}

const DEFAULTS = {
  turnTimeout: 60000,   // 一个座位挂机多久后由电脑代打一手（毫秒）
  nextHandDelay: 30000, // 留出查看其他三家手牌的时间；也可手动开始下一局
  queuedBots: 2,        // 等待区里放几个电脑，保证转转轮换有人上桌
  botStyle: 'v2',       // 电脑用哪个强度（v2 = 按期望值打）
  maxMembers: 12
};

class Room {
  constructor(id, opts) {
    this.id = id;
    this.opts = Object.assign({}, DEFAULTS, opts || {});
    this.members = [];      // 真人（含已掉线的），按加入顺序
    this.game = null;
    this.rev = 0;
    this.awaitSince = 0;
    this.nextAt = 0;
    this.createdAt = Date.now();
    this.lastActive = Date.now();
    this.chat = [];
  }

  // ---------- 查询 ----------
  memberByPid(pid) { return this.members.find((x) => x.pid === pid) || null; }
  memberByToken(t) { return t ? this.members.find((x) => x.token === t) || null : null; }
  onlineOf(pid) { const m = this.memberByPid(pid); return !!(m && m.conn); }
  humanCount() { return this.members.length; }
  onlineCount() { return this.members.filter((m) => m.conn).length; }

  info() {
    const G = this.game;
    const seats = [];
    for (let i = 0; i < 4; i++) {
      const p = G && G.seats[i];
      if (!p) { seats.push(null); continue; }
      seats.push({
        seat: i, name: p.name, score: p.score, isHuman: !!p.isHuman,
        online: p.isHuman ? this.onlineOf(p.id) : true,
        zimoCount: p.zimoCount, paoCount: p.paoCount,
        handsWon: p.handsWon, handsPlayed: p.handsPlayed
      });
    }
    const queue = G ? G.queue.map((p) => ({ name: p.name, isHuman: !!p.isHuman })) : [];
    return {
      id: this.id,
      phase: G ? 'playing' : 'waiting',
      handNo: G ? G.handNo : 0,
      seats: seats,
      queue: queue,
      humans: this.members.length,
      online: this.onlineCount(),
      maxMembers: this.opts.maxMembers
    };
  }

  // ---------- 进出 ----------
  /** 带 token 回来 = 重连；否则是新玩家 */
  join(name, token) {
    const back = this.memberByToken(token);
    if (back) {
      back.conn = null;
      back.reconnect = true;
      if (name) back.name = String(name).slice(0, 12);
      this.lastActive = Date.now();
      return back;
    }
    if (this.members.length >= this.opts.maxMembers) throw new Error('房间满了（最多 ' + this.opts.maxMembers + ' 人）');
    const m = {
      pid: newId('p'),
      token: crypto.randomBytes(24).toString('hex'),
      name: (String(name || '').trim().slice(0, 12)) || ('玩家' + (this.members.length + 1)),
      conn: null, joinedAt: Date.now(), gone: false
    };
    this.members.push(m);
    this.lastActive = Date.now();
    return m;
  }

  /** 离开：开局前直接移除；开局后保留座位由电脑代打，避免牌局塌掉 */
  leave(m) {
    const i = this.members.indexOf(m);
    if (i < 0) return false;
    if (!this.game) { this.members.splice(i, 1); return true; }
    m.gone = true; m.conn = null;
    this.pump();
    return true;
  }

  /** 座位上的人还是不是「有连接的真人」 */
  isLiveHuman(seat) {
    const G = this.game;
    if (!G) return false;
    const p = G.seats[seat];
    if (!p || !p.isHuman) return false;
    const m = this.memberByPid(p.id);
    return !!(m && m.conn && !m.gone);
  }

  // ---------- 开局 ----------
  botName(i) {
    const base = BOT_NAMES[i % BOT_NAMES.length];
    const round = Math.floor(i / BOT_NAMES.length);
    return round ? base + (round + 1) : base;
  }

  start() {
    if (this.game) throw new Error('这一桌已经开局了');
    if (!this.members.length) throw new Error('房间里还没有人');
    const core = loadCore();
    // 名单顺序决定谁上桌：真人按加入顺序优先坐满 4 个座位，剩下的进等待区
    const roster = this.members.map((m) => ({ id: m.pid, name: m.name, isHuman: true }));
    const need = Math.max(0, 4 - roster.length) + Math.max(0, this.opts.queuedBots);
    for (let i = 0; i < need; i++) {
      roster.push({ id: newId('b'), name: this.botName(i), isHuman: false, style: this.opts.botStyle });
    }
    this.game = core.createGame({ roster: roster, rotate: true });
    this.game.startHand();
    this.rev++;
    this.pump();
    return this.game;
  }

  // ---------- 推进牌局 ----------
  /**
   * 把牌局推到「只能等真人操作」为止。
   * 顺序：结算挂起的碰杠胡 → 替掉线的真人代打 → 让电脑走一步。
   */
  pump() {
    const G = this.game;
    if (!G || !G.hand) return;
    this.syncLateJoiners();
    let guard = 0;
    while (guard++ < 4000) {
      if (G.hand.over) break;
      if (G.hasPendingResolve()) { G.resolvePending(); continue; }
      const awaits = G.pendingAwaits();
      if (awaits.length) {
        // 掉线/已离开的真人：服务器按电脑思路替他打完这一手，牌局不会卡死
        let took = false;
        for (const a of awaits) {
          if (!this.isLiveHuman(a.seat)) { G.autoPlaySeat(a.seat); took = true; break; }
        }
        if (took) continue;
        break;                    // 剩下的都在线，等他们自己操作
      }
      if (!G.aiStep()) break;
    }
    this.rev++;
  }

  /**
   * 牌局开打之后才进房间的真人，要真的补进等待区。
   * 不做这一步的话，他会一直看到「你在等待区」，却永远轮不到上桌 —— 因为开局时的名单里没有他。
   */
  syncLateJoiners() {
    const G = this.game;
    if (!G || typeof G.addPlayer !== 'function') return 0;
    let added = 0;
    for (const m of this.members) {
      if (m.gone) continue;
      if (G.seatOfId(m.pid) >= 0) continue;
      if (G.isInQueue(m.pid)) continue;
      if (G.addPlayer({ id: m.pid, name: m.name, isHuman: true })) added++;
    }
    return added;
  }

  /**
   * 座位上的真人退房走了：把座位让给等待区的真人。
   * 只能在两局之间做 —— 牌局中途换人，他手上的牌就没人认了。
   */
  releaseAbandonedSeats() {
    const G = this.game;
    if (!G || typeof G.seatVacated !== 'function') return 0;
    let moved = 0;
    for (let seat = 0; seat < 4; seat++) {
      const p = G.seats[seat];
      if (!p || !p.isHuman) continue;
      const m = this.memberByPid(p.id);
      if (m && !m.gone) continue;                       // 人还在，别动他的座位
      if (!this.members.some((x) => !x.gone && G.isInQueue(x.pid))) continue;  // 没真人候补就先留着
      if (G.seatVacated(seat)) moved++;
    }
    return moved;
  }

  /** 真人还在不在这个房间（在桌上或在等待区都算） */
  hasPlayer(pid) {
    const G = this.game;
    if (!G) return this.memberByPid(pid) != null;
    return G.seatOfId(pid) >= 0 || G.isInQueue(pid);
  }

  /** 真人的一次操作 */
  act(m, a, opts) {
    const G = this.game;
    if (!G || !G.hand) throw new Error('牌局还没开始');
    if (G.hand.over) throw new Error('本局已经结束了');
    const seat = G.seatOfId(m.pid);
    if (seat < 0) throw new Error('你在等待区，等这局结束轮到你上桌');
    if (!this.isLiveHuman(seat)) throw new Error('这个座位现在不由你操作');
    if (['discard', 'angang', 'bugang'].includes(a && a.act) &&
        (!Number.isInteger(a.kind) || a.kind < 0 || a.kind >= 27)) throw new Error('牌编号不合法');
    let ok = false;
    switch (a && a.act) {
      case 'discard': ok = G.humanDiscard(a.kind | 0, seat); break;
      case 'hu':   ok = G.humanClaim('hu', a.kind, seat); break;
      case 'peng': ok = G.humanClaim('peng', a.kind, seat); break;
      case 'gang': ok = G.humanClaim('gang', a.kind, seat); break;
      case 'pass': ok = G.humanClaim('pass', a.kind, seat); break;
      case 'zimo': ok = G.humanZimo(seat); break;
      case 'angang': ok = G.humanGang(a.kind | 0, 'an', seat); break;
      case 'bugang': ok = G.humanGang(a.kind | 0, 'bu', seat); break;
      default: throw new Error('未知操作');
    }
    if (!ok) throw new Error('这个操作现在不合法');
    this.awaitSince = 0;
    this.lastActive = Date.now();
    if (opts && opts.deferPump) this.rev++;
    else this.pump();
  }

  /** 下一局（任何人按都可以，重复按无效） */
  next() {
    const G = this.game;
    if (!G || !G.hand || !G.hand.over) throw new Error('本局还没结束');
    if (this.nextPending) return false;
    this.nextPending = true;
    this.advance();
    return true;
  }

  advance() {
    const G = this.game;
    if (!G) return;
    this.nextPending = false;
    this.nextAt = 0;
    this.awaitSince = 0;
    this.releaseAbandonedSeats();
    G.nextHand();
    this.pump();
    this.rev++;
  }

  /** 定时器：超时托管 + 自动开下一局。返回是否真的动了 */
  tick(now) {
    const G = this.game;
    if (!G || !G.hand) return false;
    if (G.hand.over) {
      if (!this.nextAt) this.nextAt = now + this.opts.nextHandDelay;
      else if (now >= this.nextAt) { this.advance(); return true; }
      return false;
    }
    const awaits = G.pendingAwaits();
    if (!awaits.length) { this.awaitSince = 0; return false; }
    if (!this.awaitSince) { this.awaitSince = now; return false; }
    if (now - this.awaitSince < this.opts.turnTimeout) return false;
    // 挂机太久：替所有待决座位打一手，别让一个人把整桌卡住
    for (const a of awaits) G.autoPlaySeat(a.seat);
    this.awaitSince = 0;
    this.pump();
    return true;
  }

  // ---------- 视图（防作弊的关键） ----------
  /**
   * 发给某个玩家的状态。
   * 只包含：他自己的暗牌 + 所有人公开的牌（副露、牌河）+ 别人的暗牌张数。
   * 局中不发别人的暗牌、牌墙顺序及鸟牌；终局才额外发送四家剩余手牌与完整牌谱。
   */
  viewFor(m) {
    const G = this.game;
    const out = { t: 'state', rev: this.rev, room: this.info() };
    if (!G || !G.hand) { out.you = { pid: m.pid, seat: -1, queued: false }; return out; }
    const H = G.hand;
    const seat = G.seatOfId(m.pid);
    const queued = seat < 0;
    out.you = { pid: m.pid, seat: seat, queued: queued };

    const players = [];
    for (let i = 0; i < 4; i++) {
      const p = H.players[i];
      let cnt = 0;
      for (let k = 0; k < p.concealed.length; k++) cnt += p.concealed[k];
      players.push({
        concealedCount: cnt,                       // 只有张数是公开信息
        melds: p.melds.map((x) => ({ type: x.type, kind: x.kind, from: x.from, ming: !!x.ming })),
        discards: p.discards.slice(),
        passedWin: i === seat ? !!p.passedWin : false
      });
    }
    const mine = seat >= 0 ? H.players[seat] : null;
    out.hand = {
      no: G.handNo, dealer: G.dealer, turn: H.turn, turnCount: H.turnCount,
      wallLeft: H.wall.length, over: !!H.over,
      lastDiscard: H.lastDiscard ? { seat: H.lastDiscard.seat, kind: H.lastDiscard.kind } : null,
      lastDraw: (seat >= 0 && H.turn === seat) ? H.lastDraw : null,
      players: players,
      mine: mine ? {
        seat: seat,
        concealed: mine.concealed.slice(),
        melds: mine.melds.map((x) => ({ type: x.type, kind: x.kind, from: x.from, ming: !!x.ming })),
        passedWin: !!mine.passedWin
      } : null,
      awaiting: null
    };
    if (seat >= 0) {
      const list = G.pendingAwaits();
      for (const a of list) {
        if (a.seat === seat) {
          out.hand.awaiting = { type: a.type, options: a.options, tile: a.tile == null ? null : a.tile };
          break;
        }
      }
    }
    out.result = (H.over && G.lastResult) ? publicResult(G.lastResult) : null;
    out.logs = G.logs.slice(-60);
    if (H.over) {
      out.hand.revealed = loadCore().settlementHands(H);
      const rec = G.records[G.records.length - 1];
      out.record = rec || null;                    // 牌谱只在本局结束后才发
    }
    return out;
  }

  pushChat(m, text) {
    const t = String(text || '').slice(0, 120);
    if (!t) return null;
    const msg = { from: m.name, text: t, at: Date.now() };
    this.chat.push(msg);
    if (this.chat.length > 50) this.chat.shift();
    return msg;
  }
}

/** 只把公开信息发出去（牌谱/结算面板用） */
function publicResult(res) {
  return {
    type: res.type, title: res.title,
    winners: (res.winners || []).slice(),
    loser: res.loser == null ? -1 : res.loser,
    kind: res.kind == null ? -1 : res.kind,
    birds: (res.birds || []).slice(),
    birdN: res.birdN, birdMoney: res.birdMoney, fan: res.fan,
    perPay: res.perPay == null ? 0 : res.perPay,
    deltas: (res.deltas || []).slice(),
    payments: (res.payments || []).map((p) => ({ from: p.from, to: p.to, amount: p.amount, why: p.why }))
  };
}

/** 房间集合：房间号是 4 位数字，好念好记 */
class RoomStore {
  constructor(opts) { this.opts = opts || {}; this.rooms = new Map(); }
  create(id, opts) {
    if(this.rooms.size >= (this.opts.maxRooms || 64))throw new Error('房间数量已达上限，请稍后重试');
    let rid = id;
    if (!rid) { do { rid = String(1000 + Math.floor(Math.random() * 9000)); } while (this.rooms.has(rid)); }
    if (this.rooms.has(rid)) throw new Error('房间号已被占用');
    const r = new Room(rid, Object.assign({}, this.opts, opts || {}));
    this.rooms.set(rid, r);
    return r;
  }
  get(id) { return this.rooms.get(String(id)) || null; }
  /** 没人在线的空房间直接回收 */
  sweep(now, idleMs) {
    const dead = [];
    for (const [id, r] of this.rooms) {
      // 没人在线超过两分钟就回收；以前是十分钟，废弃房会在列表里挂太久
      if (r.onlineCount() === 0 && now - Math.max(r.lastActive, r.createdAt) > (idleMs || 120000)) dead.push(id);
    }
    for (const id of dead) this.rooms.delete(id);
    return dead;
  }
  list() {
    const out = [];
    for (const r of this.rooms.values()) {
      // 没人在线的房间是废弃房：列出来只会让人点进去发现打不了
      if (r.onlineCount() === 0) continue;
      const i = r.info();
      out.push({ id: r.id, phase: i.phase, humans: i.humans, online: i.online, handNo: i.handNo });
    }
    return out.sort((a, b) => b.online - a.online || b.humans - a.humans);
  }
  /** 没人了就直接拆掉房间 */
  drop(id) { return this.rooms.delete(String(id)); }
}

module.exports = { Room, RoomStore, loadCore, publicResult, DEFAULTS };
