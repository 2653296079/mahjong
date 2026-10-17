'use strict';
const { DatabaseSync } = require('node:sqlite');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { Worker } = require('node:worker_threads');
const scrypt = promisify(crypto.scrypt);
const SESSION_MS = 30 * 86400000;
const hashToken = t => crypto.createHash('sha256').update(t).digest('hex');
function problem(status, message) { return Object.assign(new Error(message), { status }); }
function username(value) {
  if (typeof value !== 'string') throw problem(400, '请填写用户名');
  const name = value.normalize('NFKC').trim();
  if (!/^[\p{L}\p{N}_]{2,16}$/u.test(name)) throw problem(400, '用户名限 2–16 个汉字、字母、数字或下划线');
  return { name, key: name.toLowerCase() };
}
function password(value) {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) throw problem(400, '密码请使用 10–128 个字符');
  return value;
}
class AccountStore {
  constructor(file) {
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS accounts(id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS session_expiry ON sessions(expires_at);
      CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, source TEXT NOT NULL, mode TEXT NOT NULL, status TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, record TEXT NOT NULL, metadata TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS participants(match_id TEXT NOT NULL REFERENCES matches(id), account_id TEXT NOT NULL REFERENCES accounts(id), seat INTEGER NOT NULL, metrics TEXT, PRIMARY KEY(match_id, account_id));
      CREATE INDEX IF NOT EXISTS participant_account ON participants(account_id, match_id);
      CREATE TABLE IF NOT EXISTS instances(id TEXT PRIMARY KEY,pid INTEGER NOT NULL,host TEXT NOT NULL);
      PRAGMA user_version=1;`);
    // 同一数据库可被本机不同端口使用，不能把另一个仍在运行的牌局误判为中断并公开暗牌。
    for (const run of this.db.prepare('SELECT * FROM instances').all()) {
      let alive = true;
      if (run.host === os.hostname()) { try { process.kill(run.pid,0); } catch(e) { alive = e.code !== 'ESRCH'; } }
      if (!alive) {
        this.db.prepare("UPDATE matches SET status='interrupted',ended_at=? WHERE source='server' AND status='playing' AND json_extract(metadata,'$.instanceId')=?").run(Date.now(),run.id);
        this.db.prepare('DELETE FROM instances WHERE id=?').run(run.id);
      }
    }
    this.instanceId = crypto.randomUUID();
    this.db.prepare('INSERT INTO instances VALUES(?,?,?)').run(this.instanceId,process.pid,os.hostname());
    this.hashing = 0; this.jobs = []; this.busy = false; this.worker = null; this.closed = false;
    for (const row of this.db.prepare("SELECT DISTINCT m.id FROM matches m JOIN participants p ON m.id=p.match_id WHERE m.status='completed' AND p.metrics IS NULL").all()) this.queueAnalysis(row.id);
  }
  async derive(pass, salt) {
    if (this.hashing >= 2) throw problem(503, '登录服务繁忙，请稍后重试');
    this.hashing++;
    try { return await scrypt(pass, salt, 64, { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }); }
    finally { this.hashing--; }
  }
  async register(name, pass) {
    const u = username(name); password(pass);
    if (this.db.prepare('SELECT id FROM accounts WHERE name_key=?').get(u.key)) throw problem(409, '这个用户名已被使用，请换一个');
    const salt = crypto.randomBytes(16).toString('hex'), digest = await this.derive(pass, salt);
    const user = { id: crypto.randomUUID(), name: u.name, createdAt: Date.now() };
    try { this.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?)').run(user.id, user.name, u.key, salt, digest.toString('hex'), user.createdAt); }
    catch (e) { if (e.errcode === 2067 || e.errcode === 1555 || e.code && e.code.includes('CONSTRAINT')) throw problem(409, '这个用户名已被使用，请换一个'); throw e; }
    return user;
  }
  async login(name, pass) {
    const u = username(name); password(pass);
    const row = this.db.prepare('SELECT * FROM accounts WHERE name_key=?').get(u.key);
    // 不存在的账户也进行相同成本的散列，避免快速探测。
    const digest = await this.derive(pass, row ? row.salt : '00000000000000000000000000000000');
    if (!row || !crypto.timingSafeEqual(digest, Buffer.from(row.password_hash, 'hex'))) throw problem(401, '用户名或密码不正确');
    return { id: row.id, name: row.name, createdAt: row.created_at };
  }
  createSession(user) {
    const token = crypto.randomBytes(32).toString('hex');
    this.db.prepare('DELETE FROM sessions WHERE expires_at<=?').run(Date.now());
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hashToken(token), user.id, Date.now() + SESSION_MS);
    return token;
  }
  userForToken(token) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const r = this.db.prepare('SELECT a.id,a.name,a.created_at FROM accounts a JOIN sessions s ON a.id=s.account_id WHERE s.token_hash=? AND s.expires_at>?').get(hashToken(token), Date.now());
    return r ? { id: r.id, name: r.name, createdAt: r.created_at } : null;
  }
  logout(token) { if (typeof token === 'string') this.db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token)); }
  async changePassword(user, old, next) {
    await this.login(user.name, old); password(next);
    const salt = crypto.randomBytes(16).toString('hex'), digest = await this.derive(next, salt);
    this.db.prepare('UPDATE accounts SET salt=?,password_hash=? WHERE id=?').run(salt, digest.toString('hex'), user.id);
    this.db.prepare('DELETE FROM sessions WHERE account_id=?').run(user.id);
  }
  writeMatch(data, players) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare(`INSERT INTO matches VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,ended_at=excluded.ended_at,record=excluded.record,metadata=excluded.metadata
        WHERE matches.status NOT IN ('completed','interrupted')`).run(data.id, data.source, data.mode, data.status, data.startedAt, data.endedAt || null, JSON.stringify(data.record), JSON.stringify(data.metadata));
      for (const p of players) this.db.prepare('INSERT OR IGNORE INTO participants(match_id,account_id,seat) VALUES(?,?,?)').run(data.id, p.accountId, p.seat);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
    if (data.status === 'completed' && players.length && !this.jobs.some(j => j.id === data.id)) this.queueAnalysis(data.id);
  }
  syncRoom(room) {
    const G = room.game; if (!G || !G.hand) return;
    const H = G.hand;
    if (!room.archiveHand || room.archiveHand.no !== G.handNo) {
      const participants = G.seats.map((p, seat) => ({ seat, name: p.name, human: !!p.isHuman, accountId: (room.memberByPid(p.id) || {}).accountId || null }));
      room.archiveHand = { id: crypto.randomUUID(), no: G.handNo, startedAt: Date.now(), participants, last: '' };
    }
    const a = room.archiveHand, players = a.participants.filter(p => p.accountId);
    if (!players.length) return;
    const sig = H.record.events.length + ':' + !!H.over + ':' + (room.accountActions || []).length;
    if (sig === a.last) return;
    const record = JSON.parse(JSON.stringify(H.record));
    record.no = G.handNo; record.names = a.participants.map(p => p.name);
    record.result = H.over ? JSON.parse(JSON.stringify(G.lastResult)) : null;
    record.birds = H.over ? H.birds.slice() : null;
    this.writeMatch({ id: a.id, source: 'server', mode: a.participants.filter(p => p.human).length > 1 ? 'human' : 'ai', status: H.over ? 'completed' : 'playing', startedAt: a.startedAt, endedAt: H.over ? Date.now() : null, record,
      metadata: { instanceId: this.instanceId, room: room.id, participants: a.participants.map(p => ({ seat: p.seat, name: p.name, human: p.human })), actions: room.accountActions || [], remainingWall: H.wall, birds: H.birds, finalHands: H.over ? H.players : null } }, players);
    a.last = sig;
  }
  interruptRoom(room) {
    if (room.archiveHand) this.db.prepare("UPDATE matches SET status='interrupted',ended_at=? WHERE id=? AND status='playing'").run(Date.now(), room.archiveHand.id);
  }
  saveSolo(user, input) {
    const rec = input.record;
    if (typeof input.id !== 'string' || !/^[a-zA-Z0-9_-]{10,80}$/.test(input.id)) throw problem(400, '对局编号不正确');
    if (!rec || !Array.isArray(rec.initial) || rec.initial.length !== 4 || !rec.initial.every(h => Array.isArray(h) && h.length === 27 && h.every(n => Number.isInteger(n) && n >= 0 && n <= 4) && h.reduce((a,b) => a+b,0) === 13)) throw problem(400, '起手牌格式不正确');
    if (rec.initial[0].some((_,k) => rec.initial.reduce((sum,h) => sum+h[k],0) > 4)) throw problem(400, '同一种牌不能超过四张');
    const tile = n => Number.isInteger(n) && n >= 0 && n < 27;
    if (!Array.isArray(rec.events) || rec.events.length > 500 || !rec.events.every(e => e && ['d','x','p','g'].includes(e.t) && Number.isInteger(e.s) && e.s >= 0 && e.s < 4 && tile(e.k) && (e.t !== 'g' || ['an','bu','ming'].includes(e.y)))) throw problem(400, '牌谱事件格式不正确');
    if (!Array.isArray(rec.names) || rec.names.length !== 4 || !rec.names.every(n => typeof n === 'string' && n.length <= 40)) throw problem(400, '座位信息不正确');
    if (!Number.isInteger(rec.humanSeat) || rec.humanSeat < 0 || rec.humanSeat > 3) throw problem(400, '自己的座位不正确');
    if (!['completed','unfinished'].includes(input.status)) throw problem(400, '对局状态不正确');
    const completed = input.status === 'completed';
    if (completed && (!rec.result || !['draw','zimo','discard'].includes(rec.result.type) || !Array.isArray(rec.result.deltas) || rec.result.deltas.length !== 4 || !rec.result.deltas.every(n => Number.isSafeInteger(n) && Math.abs(n) <= 10000) || rec.result.deltas.reduce((a,b) => a+b,0) !== 0 || !Array.isArray(rec.result.winners) || !rec.result.winners.every(s => Number.isInteger(s) && s>=0 && s<4))) throw problem(400, '结算信息不正确');
    // 检查摸打事件不能制造负数手牌或超过四张；单机来源仍明确标记为本机上传。
    let states; try { states = require('./rooms').loadCore().replayStates(rec, rec.humanSeat); } catch(e) { throw problem(400, '牌谱不能回放'); }
    if (states.some(st => st.hands.some(h => h.some(n => n < 0 || n > 4)))) throw problem(400, '牌谱中的手牌数量不合法');
    const id = 'solo_' + user.id + '_' + input.id;
    const old = this.db.prepare('SELECT status,record FROM matches WHERE id=?').get(id);
    if (old && (old.status === 'completed' || JSON.parse(old.record).events.length > rec.events.length)) return { id };
    const own = JSON.parse(JSON.stringify(rec)); own.names[rec.humanSeat] = user.name;
    if (!completed) own.result = null;
    const turns = new Set(Array.isArray(input.manualTurns) ? input.manualTurns.filter(Number.isSafeInteger) : []);
    let actions = own.events.flatMap((e, i) => e.t === 'x' && e.s === own.humanSeat && turns.has(e.n) ? [{ seat: e.s, act: 'discard', eventIndex: i }] : []);
    if (input.actions !== undefined) {
      const acts = ['discard','hu','peng','gang','pass','zimo','angang','bugang','auto'];
      if (!Array.isArray(input.actions) || input.actions.length > 600 || !input.actions.every(a => a && a.seat === own.humanSeat && acts.includes(a.act) && Number.isInteger(a.eventIndex) && a.eventIndex >= 0 && a.eventIndex <= own.events.length)) throw problem(400, '操作记录不正确');
      actions = input.actions.map(a => ({ seat:a.seat,act:a.act,eventIndex:a.eventIndex,kind:tile(a.kind)?a.kind:null,at:Number.isSafeInteger(a.at)?a.at:null }));
    }
    this.writeMatch({ id, source: 'local', mode: 'ai', status: completed ? 'completed' : 'unfinished', startedAt: Number.isSafeInteger(input.startedAt) && input.startedAt > 0 && input.startedAt <= Date.now() ? input.startedAt : Date.now(), endedAt: completed ? Date.now() : null, record: own, metadata: { actions, learningMode: ['guided','feedback','exam'].includes(input.learningMode) ? input.learningMode : 'guided' } }, [{ accountId: user.id, seat: rec.humanSeat }]);
    return { id };
  }
  queueAnalysis(id) {
    const row = this.db.prepare('SELECT record,metadata FROM matches WHERE id=?').get(id);
    const players = this.db.prepare('SELECT seat FROM participants WHERE match_id=? AND metrics IS NULL').all(id);
    if (!row || !players.length) return;
    this.jobs.push({ id, record: JSON.parse(row.record), actions: JSON.parse(row.metadata).actions || [], players });
    this.pumpAnalysis();
  }
  pumpAnalysis() {
    if (this.busy || this.closed || !this.jobs.length) return;
    if (!this.worker) {
      this.worker = new Worker(path.join(__dirname, 'account-analysis.js'));
      this.worker.on('message', message => {
        if (this.closed) return;
        if (message.metrics) for (const m of message.metrics) this.db.prepare('UPDATE participants SET metrics=? WHERE match_id=? AND seat=?').run(JSON.stringify(m.value), message.id, m.seat);
        this.jobs.shift(); this.busy = false; this.pumpAnalysis();
      });
      this.worker.on('error', () => { this.worker = null; this.jobs.shift(); this.busy = false; this.pumpAnalysis(); });
      this.worker.unref();
    }
    this.busy = true; this.worker.postMessage(this.jobs[0]);
  }
  rows(user, mode) {
    // 列表与面板只读取摘要，完整事件流仅在请求自己的单局详情时读取。
    return this.db.prepare(`SELECT m.id,m.source,m.mode,m.status,m.started_at,m.ended_at,json_extract(m.record,'$.result') AS result,json_extract(m.record,'$.names') AS names,json_array_length(m.record,'$.events') AS events,p.seat,p.metrics FROM matches m JOIN participants p ON p.match_id=m.id WHERE p.account_id=? ${mode === 'ai' || mode === 'human' ? 'AND m.mode=?' : ''} ORDER BY m.started_at DESC,m.id DESC`).all(...([user.id].concat(mode === 'ai' || mode === 'human' ? [mode] : [])));
  }
  dashboard(user, mode) {
    const rows = this.rows(user, mode), done = rows.filter(r => r.status === 'completed');
    const s = { hands: done.length, wins: 0, zimo: 0, dealIn: 0, draws: 0, net: 0, discards: 0, same: 0, shantenLoss: 0, outsLoss: 0, gangs: 0, auto: 0, tenpaiN: 0, tenpaiTurnSum: 0, tenpaiOutsSum: 0, pendingAnalysis: 0 };
    const recent = [];
    for (const row of done) {
      const r = JSON.parse(row.result), seat = row.seat, delta = r.deltas[seat] || 0;
      s.net += delta; if ((r.winners || []).includes(seat)) { s.wins++; if (r.type === 'zimo') s.zimo++; }
      if (r.type === 'discard' && r.loser === seat) s.dealIn++;
      if (r.type === 'draw') s.draws++;
      if (recent.length < 30) recent.push({ at: row.ended_at, delta });
      if (!row.metrics) { s.pendingAnalysis++; continue; }
      const m = JSON.parse(row.metrics);
      for (const k of ['discards','same','shantenLoss','outsLoss','gangs','auto']) s[k] += m[k] || 0;
      if (m.tenpaiTurn != null) { s.tenpaiN++; s.tenpaiTurnSum += m.tenpaiTurn; s.tenpaiOutsSum += m.tenpaiOuts; }
    }
    return { user, mode: mode || 'all', summary: s, unfinished: rows.length - done.length, recent: recent.reverse(), groups: { ai: this.db.prepare("SELECT COUNT(*) AS n FROM participants p JOIN matches m ON p.match_id=m.id WHERE p.account_id=? AND m.status='completed' AND m.mode='ai'").get(user.id).n, human: this.db.prepare("SELECT COUNT(*) AS n FROM participants p JOIN matches m ON p.match_id=m.id WHERE p.account_id=? AND m.status='completed' AND m.mode='human'").get(user.id).n } };
  }
  history(user, mode, offset) {
    const rows = this.rows(user, mode);
    return { total: rows.length, offset, items: rows.slice(offset, offset + 20).map(row => ({ id: row.id, source: row.source, mode: row.mode, status: row.status, startedAt: row.started_at, endedAt: row.ended_at, seat: row.seat, names: JSON.parse(row.names), events: row.events, result: row.result ? JSON.parse(row.result) : null, metrics: row.metrics ? JSON.parse(row.metrics) : null })) };
  }
  detail(user, id) {
    const row = this.db.prepare('SELECT m.*,p.seat,p.metrics FROM matches m JOIN participants p ON m.id=p.match_id WHERE m.id=? AND p.account_id=?').get(id, user.id);
    if (!row) throw problem(404, '找不到这局对局');
    if (row.status === 'playing') throw problem(409, '联机对局尚未结束，结束后可查看完整牌谱');
    const record = JSON.parse(row.record); record.humanSeat = row.seat;
    return { id: row.id, source: row.source, mode: row.mode, status: row.status, startedAt: row.started_at, endedAt: row.ended_at, record, metadata: JSON.parse(row.metadata), metrics: row.metrics ? JSON.parse(row.metrics) : null };
  }
  close() {
    if (this.closed) return; this.closed = true;
    if (this.worker) this.worker.terminate();
    this.db.prepare("UPDATE matches SET status='interrupted',ended_at=? WHERE source='server' AND status='playing' AND json_extract(metadata,'$.instanceId')=?").run(Date.now(),this.instanceId);
    this.db.prepare('DELETE FROM instances WHERE id=?').run(this.instanceId); this.db.close();
  }
}
module.exports = { AccountStore, username, problem, SESSION_MS };
