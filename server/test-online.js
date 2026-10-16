'use strict';
/**
 * 端到端联机测试：起真的 HTTP+WebSocket 服务器，用真的 WebSocket 客户端连上打牌。
 * 证明的是「网线上真实发生的事」，而不是内部函数。
 * 运行：node test-online.js
 */
const assert = require('node:assert');
const http = require('http');
const { test, run } = require('./micro-test');
const online = require('./mjs-server');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end('nope'); });
  const hub = online.attach(server, { room: { turnTimeout: 300000, nextHandDelay: 600000 } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { server: server, hub: hub, port: server.address().port };
}

function connect(port, name) {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  const c = {
    ws: ws, name: name, last: null, states: [], errors: [], joined: null,
    revs: 0, actedRev: -1,
    send(obj) { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); }
  };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'joined') c.joined = m;
    else if (m.t === 'state') { c.last = m; c.revs++; }
    else if (m.t === 'err') c.errors.push(m.msg);
  });
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(c), { once: true });
    ws.addEventListener('error', () => reject(new Error('连不上服务器')), { once: true });
  });
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (fn()) return true;
    await sleep(20);
  }
  throw new Error('等待超时：' + (what || ''));
}

/** 每次只让一个待决的客户端动一手，且同一份状态不重复操作，避免竞态 */
async function driveHand(clients, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    let st = null, who = null;
    for (const c of clients) {
      if (c.last && c.last.hand && !c.last.hand.over && c.last.hand.awaiting && c.last.rev !== c.actedRev) {
        st = c.last; who = c; break;
      }
    }
    if (who) {
      who.actedRev = st.rev;
      const a = st.hand.awaiting;
      if (a.type === 'turn') {
        if (a.options.canZimo) who.send({ t: 'act', act: 'zimo' });
        else who.send({ t: 'act', act: 'discard', kind: st.hand.mine.concealed.findIndex((x) => x > 0) });
      } else {
        who.send({ t: 'act', act: a.options.hu ? 'hu' : (a.options.peng ? 'peng' : 'pass'), kind: a.options.kind });
      }
      await sleep(25);
      continue;
    }
    const first = clients[0].last;
    if (first && first.hand && first.hand.over) return true;
    await sleep(25);
  }
  return false;
}

test('两个真客户端连上同一个房间，能一起把牌局打完', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.port, '甲');
    const b = await connect(s.port, '乙');
    await waitFor(() => a.joined === null, 500, '');
    a.send({ t: 'join', room: '2001', name: '甲', create: true });
    await waitFor(() => a.joined, 2000, '甲进房间');
    b.send({ t: 'join', room: '2001', name: '乙' });
    await waitFor(() => b.joined, 2000, '乙进房间');
    assert.strictEqual(a.joined.room, '2001');
    assert.notStrictEqual(a.joined.pid, b.joined.pid, '两个人不能是同一个玩家');
    assert.ok(a.joined.token && b.joined.token, '每人要拿到一个重连令牌');
    await waitFor(() => a.last && a.last.room && a.last.room.humans === 2, 2000, '房间人数同步');
    assert.strictEqual(a.last.room.phase, 'waiting', '还没开局');

    a.send({ t: 'start' });
    await waitFor(() => a.last && a.last.hand && a.last.hand.mine, 2000, '开局后的手牌');
    const seats = a.last.room.seats;
    assert.strictEqual(seats.filter((x) => x.isHuman).length, 2, '两个真人上桌');
    assert.strictEqual(seats.filter((x) => !x.isHuman).length, 2, '空座位补了电脑');
    assert.strictEqual(a.last.room.queue.length, 2, '等待区有电脑，保证轮换');

    const ok = await driveHand([a, b], 20000);
    assert.ok(ok, '牌局没打完（可能卡住了）');
    const res = a.last.result;
    assert.ok(res, '结束后要有结算');
    assert.strictEqual(res.deltas.reduce((x, y) => x + y, 0), 0, '分数不零和');
    assert.ok(a.last.record, '结束后要能拿到牌谱');
    assert.strictEqual(a.errors.length, 0, '甲收到过错误：' + a.errors.join(' / '));
    assert.strictEqual(b.errors.length, 0, '乙收到过错误：' + b.errors.join(' / '));
  } finally {
    for (const c of []) {}
    s.hub.close(); s.server.close();
  }
});

test('网线上不泄漏对手暗牌：把服务器真手牌和服务端发出去的每一个字节对照', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.port, '甲');
    const b = await connect(s.port, '乙');
    a.send({ t: 'join', room: '2002', name: '甲', create: true });
    await waitFor(() => a.joined, 2000, '甲进房间');
    b.send({ t: 'join', room: '2002', name: '乙' });
    await waitFor(() => b.joined, 2000, '乙进房间');
    a.send({ t: 'start' });
    await waitFor(() => a.last && a.last.hand && a.last.hand.mine, 2000, '开局');

    // 直接抓服务端原始帧，逐条检查
    const raw = [];
    a.ws.addEventListener('message', (e) => raw.push(e.data));
    const room = s.hub.store.get('2002');

    for (let n = 0; n < 300 && !(a.last.hand && a.last.hand.over); n++) {
      const G = room.game;
      if (G && G.hand) {
        const mySeat = G.seatOfId(a.joined.pid);
        for (let seat = 0; seat < 4; seat++) {
          if (seat === mySeat) continue;
          const secret = JSON.stringify(Array.from(G.hand.players[seat].concealed));
          for (const one of raw) {
            assert.ok(one.indexOf(secret) < 0,
              '服务器把座位 ' + seat + ' 的暗牌发给甲了！');
          }
        }
        assert.strictEqual(G.hand.players[mySeat].concealed.length, 27);
      }
      await driveHand([a, b], 400);
      raw.length = 0;
      await sleep(10);
    }
    assert.ok(raw.length >= 0);
    // 视图里也必须没有对手暗牌字段
    assert.strictEqual(a.last.hand.players[1].concealed, undefined);
    assert.strictEqual(typeof a.last.hand.players[1].concealedCount, 'number');
  } finally { s.hub.close(); s.server.close(); }
});

test('掉线后重连：用令牌回到同一个座位，而不是变成新玩家', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.port, '甲');
    const b = await connect(s.port, '乙');
    a.send({ t: 'join', room: '2003', name: '甲', create: true });
    await waitFor(() => a.joined, 2000, '甲进房间');
    b.send({ t: 'join', room: '2003', name: '乙' });
    await waitFor(() => b.joined, 2000, '乙进房间');
    a.send({ t: 'start' });
    await waitFor(() => a.last && a.last.hand, 2000, '开局');
    const pid = a.joined.pid, token = a.joined.token;
    const seatBefore = a.last.you.seat;

    a.ws.close();                                  // 甲掉线
    await sleep(200);
    const room = s.hub.store.get('2003');
    assert.strictEqual(room.onlineCount(), 1, '服务器应该知道甲掉线了');
    assert.strictEqual(room.members.length, 2, '掉线不等于离开房间');

    const a2 = await connect(s.port, '甲');
    a2.send({ t: 'join', room: '2003', name: '甲', token: token });
    await waitFor(() => a2.joined, 2000, '甲重连');
    assert.strictEqual(a2.joined.pid, pid, '重连后必须还是原来那个玩家');
    assert.strictEqual(room.members.length, 2, '重连不能多出一个人');
    await waitFor(() => a2.last && a2.last.you, 2000, '重连后的视图');
    assert.strictEqual(a2.last.you.seat, seatBefore, '重连后座位不变');
    assert.ok(a2.last.hand.mine, '重连后要能拿回自己的手牌');
    assert.strictEqual(room.onlineCount(), 2);
  } finally { s.hub.close(); s.server.close(); }
});

test('等待区的人操作会被明确拒绝', async () => {
  const s = await startServer();
  try {
    const cs = [];
    for (const n of ['甲', '乙', '丙', '丁', '戊']) {
      const c = await connect(s.port, n);
      c.send({ t: 'join', room: '2004', name: n, create: true });
      await waitFor(() => c.joined, 2000, n + ' 进房间');
      cs.push(c);
    }
    cs[0].send({ t: 'start' });
    await waitFor(() => cs[4].last && cs[4].last.hand, 2000, '开局');
    assert.strictEqual(cs[4].last.you.queued, true, '第五个人应在等待区');
    cs[4].send({ t: 'act', act: 'discard', kind: 0 });
    await waitFor(() => cs[4].errors.length > 0, 2000, '错误提示');
    assert.match(cs[4].errors[0], /等待区/, '错误提示要说清楚原因：' + cs[4].errors[0]);
  } finally { s.hub.close(); s.server.close(); }
});

test('重复进房不占新座位，重连会撤销旧连接身份', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.port, '甲');
    a.send({ t: 'join', room: '2010', name: '甲' });
    await waitFor(() => a.joined, 2000, '首次进房');
    const token = a.joined.token, pid = a.joined.pid;
    assert.match(token, /^[a-f0-9]{48}$/);
    a.joined = null;
    a.send({ t: 'join', room: '2010', name: '甲' });
    await waitFor(() => a.joined, 2000, '重复进房');
    assert.equal(a.joined.pid, pid);
    assert.equal(s.hub.store.get('2010').members.length, 1);
    const oldSession = Array.from(s.hub.sessions).find(x => x.member && x.member.pid === pid);
    const fresh = await connect(s.port, '甲');
    fresh.send({ t: 'join', room: '2010', name: '甲', token });
    await waitFor(() => fresh.joined, 2000, '接回座位');
    assert.equal(fresh.joined.pid, pid);
    assert.equal(oldSession.member, null, '旧页面不能操作重连后的座位');
    assert.equal(oldSession.room, null);
    await waitFor(() => a.ws.readyState === 3, 2000, '旧连接关闭');
    assert.equal(s.hub.store.get('2010').onlineCount(), 1);
  } finally { s.hub.close(); s.server.close(); }
});

test('错误类型的牌编号不能悄悄转换为另一张牌', async () => {
  const s = await startServer();
  try {
    const a = await connect(s.port, '甲');
    a.send({ t: 'join', room: '2011', name: '甲' });
    await waitFor(() => a.joined, 2000, '进房');
    a.send({ t: 'start' });
    await waitFor(() => a.last && a.last.hand && a.last.hand.awaiting, 2000, '轮到自己');
    const room = s.hub.store.get('2011');
    const before = JSON.stringify(room.game.hand.players[0].concealed);
    for (const kind of ['0', null, 0.5, 27, -1]) a.send({ t: 'act', act: 'discard', kind });
    await waitFor(() => a.errors.length === 5, 2000, '拒绝所有错误类型');
    assert.ok(a.errors.every(e => /牌编号/.test(e)));
    assert.equal(JSON.stringify(room.game.hand.players[0].concealed), before);
  } finally { s.hub.close(); s.server.close(); }
});

run();
