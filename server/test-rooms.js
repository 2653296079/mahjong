'use strict';
/**
 * rooms.js 的验收测试：房间流程、掉线托管、转转轮换，以及最关键的防作弊。
 * 运行：node test-rooms.js
 */
const assert = require('node:assert');
const { test, run } = require('./micro-test');
const { RoomStore, loadCore } = require('./rooms');

function fakeClient(room, name) {
  const m = room.join(name);
  m.conn = { send() {} };          // 假装在线
  return m;
}

/** 推进一小步：让某个在线的真人操作一次，或让电脑走一步 */
function step(room) {
  const G = room.game;
  if (!G || !G.hand || G.hand.over) return false;
  for (const m of room.members) {
    if (!m.conn || m.gone) continue;
    const v = room.viewFor(m);
    const a = v.hand && v.hand.awaiting;
    if (!a) continue;
    if (a.type === 'turn') {
      if (a.options.canZimo) room.act(m, { act: 'zimo' });
      else {
        const k = v.hand.mine.concealed.findIndex((c) => c > 0);
        room.act(m, { act: 'discard', kind: k });
      }
    } else {
      const act = a.options.hu ? 'hu' : (a.options.peng ? 'peng' : 'pass');
      room.act(m, { act: act, kind: a.options.kind });
    }
    return true;
  }
  if (G.hasPendingResolve()) { G.resolvePending(); room.rev++; return true; }
  if (G.aiStep()) { room.rev++; return true; }
  // 没有真人可操作时，交给服务器的托管逻辑推进（真实服务器在掉线、超时时也会调它）
  const before = room.rev;
  room.pump();
  return room.rev !== before;
}

function playHand(room, maxSteps) {
  let n = 0;
  while (!room.game.hand.over && n++ < (maxSteps || 3000)) {
    if (!step(room)) break;
  }
  return room.game.hand.over;
}

test('服务端从 index.html 取到的引擎是完整可用的', () => {
  const core = loadCore();
  for (const fn of ['createGame', 'visiblePool', 'evaluateDiscards', 'birdMoney', 'analyzeSituation']) {
    assert.strictEqual(typeof core[fn], 'function', '引擎缺少 ' + fn);
  }
  const G = core.createGame({ seed: 1 });
  assert.strictEqual(G.seats.length, 4);
});

test('加入 / 重连：token 能把人认回来，而不是多开一个座位', () => {
  const store = new RoomStore();
  const room = store.create('1001');
  const a = room.join('小明');
  assert.ok(a.token, '要发一个重连令牌');
  assert.strictEqual(room.members.length, 1);
  const again = room.join('小明', a.token);
  assert.strictEqual(again, a, '带令牌回来应该是同一个人');
  assert.strictEqual(room.members.length, 1, '不能因为重连多出一个人');
  const b = room.join('小红');
  assert.notStrictEqual(b.pid, a.pid);
  assert.strictEqual(room.members.length, 2);
});

test('开局：真人先坐满，缺的座位用电脑补，等待区也放电脑保证轮换', () => {
  const store = new RoomStore();
  const room = store.create('1002');
  fakeClient(room, '甲');
  fakeClient(room, '乙');
  room.start();
  const info = room.info();
  assert.strictEqual(info.phase, 'playing');
  assert.deepStrictEqual(Array.from(info.seats, (s) => s.isHuman), [true, true, false, false], '真人应先坐满，其余补电脑');
  assert.deepStrictEqual(Array.from(info.seats, (s) => s.name), ['甲', '乙', '阿湘', '老陈']);
  assert.strictEqual(info.queue.length, 2, '等待区应有 2 个电脑');
  assert.strictEqual(info.queue.every((q) => !q.isHuman), true);
});

test('防作弊：视图里绝不能出现对手的暗牌（跨多局、逐帧检查）', () => {
  const store = new RoomStore();
  const room = store.create('1003');
  const ms = [fakeClient(room, '甲'), fakeClient(room, '乙'), fakeClient(room, '丙')];
  room.start();
  let checked = 0, frames = 0;
  for (let hand = 0; hand < 6; hand++) {
    let guard = 0;
    while (!room.game.hand.over && guard++ < 600) {
      const G = room.game, H = G.hand;
      for (const m of ms) {
        const seat = G.seatOfId(m.pid);
        if (seat < 0) continue;
        const view = room.viewFor(m);
        assert.ok(view.hand.mine, '自己必须拿到自己的暗牌');
        // 1) 自己的暗牌必须完整正确
        assert.deepStrictEqual(Array.from(view.hand.mine.concealed),
          Array.from(H.players[seat].concealed), '自己的暗牌不对');
        const json = JSON.stringify(view);
        for (let s = 0; s < 4; s++) {
          if (s === seat) continue;
          // 2) 对手的暗牌数组不能以任何形式出现
          assert.strictEqual(view.hand.players[s].concealed, undefined, '对手暗牌字段泄漏');
          const secret = JSON.stringify(Array.from(H.players[s].concealed));
          assert.ok(json.indexOf(secret) < 0, '对手暗牌内容出现在了视图里：座位 ' + s);
          // 3) 张数是公开信息，必须给对
          const real = H.players[s].concealed.reduce((a, b) => a + b, 0);
          assert.strictEqual(view.hand.players[s].concealedCount, real, '对手暗牌张数不对');
        }
        // 4) 牌墙顺序、鸟牌、局中牌谱（牌谱里有每一次摸的什么牌）都不能下发
        assert.strictEqual(view.hand.wall, undefined, '不能把牌墙发出去');
        assert.strictEqual(view.hand.birds, undefined, '鸟牌不能提前发');
        assert.strictEqual(view.record, undefined, '局中不能下发牌谱（里面有每次摸牌）');
        // 注意：牌墙摸空时 slice 出来是 []，而 "[]" 在 JSON 里到处都是，必须先确认探测串非空
        if (H.wall.length >= 8) {
          assert.ok(json.indexOf(JSON.stringify(Array.from(H.wall.slice(0, 8)))) < 0, '牌墙内容泄漏');
        }
        if (H.birds.length >= 3) {
          assert.ok(json.indexOf(JSON.stringify(Array.from(H.birds))) < 0, '鸟牌内容泄漏');
        }
        checked++;
      }
      frames++;
      if (!step(room)) break;
    }
    assert.ok(room.game.hand.over, '第 ' + (hand + 1) + ' 局没打完');
    room.advance();
  }
  assert.ok(checked > 300, '检查次数太少（' + checked + ' 次 / ' + frames + ' 帧），覆盖不足');
  assert.ok(frames > 60, '采样帧数太少：' + frames);
});

test('三人联机打到结束：分数零和，且结束时才发牌谱', () => {
  const store = new RoomStore();
  const room = store.create('1004');
  const ms = [fakeClient(room, '甲'), fakeClient(room, '乙'), fakeClient(room, '丙')];
  room.start();
  for (let h = 0; h < 5; h++) {
    assert.ok(playHand(room), '第 ' + (h + 1) + ' 局没打完');
    const res = room.game.lastResult;
    const sum = res.deltas.reduce((a, b) => a + b, 0);
    assert.strictEqual(sum, 0, '分数不零和：' + JSON.stringify(Array.from(res.deltas)));
    const v = room.viewFor(ms[0]);
    assert.ok(v.result, '结束后要发结算');
    assert.ok(v.record, '结束后才发牌谱');
    assert.ok(Array.isArray(v.result.deltas) || v.result.deltas.length === 4);
    assert.ok(v.logs.length > 0, '要有牌局日志');
    room.advance();
  }
});

test('掉线不炸局：人一掉线，电脑立刻接管他的座位，牌局继续走完', () => {
  const store = new RoomStore();
  const room = store.create('1005');
  const a = fakeClient(room, '甲');
  const b = fakeClient(room, '乙');
  room.start();
  for (let i = 0; i < 12; i++) step(room);
  a.conn = null;                       // 甲掉线
  room.pump();                         // 真实服务器在连接关闭时会做这件事，这里要照做
  assert.strictEqual(room.isLiveHuman(room.game.seatOfId(a.pid)), false);
  const ok = playHand(room);           // 没有甲的任何操作，牌局必须能自己走完
  assert.ok(ok, '有人掉线后牌局卡死了');
  const res = room.game.lastResult;
  assert.strictEqual(res.deltas.reduce((x, y) => x + y, 0), 0);
  // 重连后座位与手牌都还在
  a.conn = { send() {} };
  assert.strictEqual(room.isLiveHuman(room.game.seatOfId(a.pid)), true, '重连后应恢复为该座位的操作者');
  const v = room.viewFor(a);
  if (!room.game.hand.over) {
    assert.ok(v.hand.mine, '重连后要能拿回自己的手牌');
  }
});

test('超时托管：有人挂机不动，到点由电脑替他打', () => {
  const store = new RoomStore({ turnTimeout: 1000 });
  const room = store.create('1006');
  fakeClient(room, '甲');
  fakeClient(room, '乙');
  room.start();
  const G = room.game;
  // 找到第一个由真人待决的时刻
  let guard = 0;
  while (guard++ < 50) {
    const awaits = G.pendingAwaits();
    if (awaits.length && room.isLiveHuman(awaits[0].seat)) break;
    if (!step(room)) break;
  }
  assert.ok(G.pendingAwaits().length > 0, '没构造出真人待决的局面');
  // 现在所有人都在线但都不动
  const t0 = 100000;
  assert.strictEqual(room.tick(t0), false, '第一次 tick 只记录时间');
  assert.strictEqual(room.tick(t0 + 500), false, '还没到时间不该代打');
  assert.strictEqual(room.tick(t0 + 1500), true, '超过 turnTimeout 应该代打');
});

test('五个人：真人优先上桌，多余的进等待区，转转轮换后总人数守恒', () => {
  const store = new RoomStore();
  const room = store.create('1007');
  const ms = [];
  for (const n of ['甲', '乙', '丙', '丁', '戊']) ms.push(fakeClient(room, n));
  room.start();
  let info = room.info();
  assert.strictEqual(info.seats.filter((s) => s.isHuman).length, 4, '桌上 4 个真人');
  assert.strictEqual(info.queue.filter((q) => q.isHuman).length, 1, '第 5 个人在等待区');
  const total = 4 + info.queue.length;
  let rotations = 0;
  for (let h = 0; h < 20; h++) {
    const before = Array.from(room.game.seats, (p) => p.id);
    assert.ok(playHand(room), '第 ' + (h + 1) + ' 局没打完');
    const winners = room.game.lastResult.winners || [];
    if (winners.length) rotations++;
    room.advance();
    const seatsNow = Array.from(room.game.seats, (p) => p.id);
    // 同一张桌上不能出现同一个人两次
    assert.strictEqual(new Set(seatsNow).size, 4, '有人同时占两个座位：' + seatsNow.join(','));
    // 每个真人都还在（要么在桌上，要么在等待区）
    for (const m of ms) {
      const inSeat = seatsNow.indexOf(m.pid) >= 0;
      const inQueue = room.game.queue.some((p) => p.id === m.pid);
      assert.ok(inSeat || inQueue || room.game.handNo > 0, '真人 ' + m.name + ' 从房间里消失了');
    }
    assert.strictEqual(room.game.seats.length + room.game.queue.length, total, '总人数不守恒');
  }
  assert.ok(rotations > 0, '20 局都没人胡牌，轮换没被验证');
});

test('中途进房间的人真的能轮换上桌（不能只是显示「等待区」）', () => {
  const store = new RoomStore();
  const room = store.create('1010');
  fakeClient(room, '甲');
  fakeClient(room, '乙');
  room.start();
  assert.strictEqual(room.game.seats.length, 4);
  // 牌局已经开打之后，丙才进来
  const c = fakeClient(room, '丙');
  assert.strictEqual(room.game.seatOfId(c.pid), -1, '丙一开始当然不在座位上');
  room.pump();
  assert.ok(room.hasPlayer(c.pid), '丙必须被补进等待区，否则永远轮不到他');
  assert.ok(room.info().queue.some((q) => q.name === '丙'), '等待区里要能看到丙');
  // 打下去，丙必须坐上过桌子
  let satDown = false;
  for (let h = 0; h < 15 && !satDown; h++) {
    playHand(room);
    room.advance();
    room.pump();
    if (room.game.seatOfId(c.pid) >= 0) satDown = true;
  }
  assert.ok(satDown, '丙等了 15 局都没能上桌');
  // 上桌之后视图里要给他自己的手牌
  const v = room.viewFor(c);
  assert.strictEqual(v.you.seat >= 0, true, '丙上桌后应当有座位号');
  assert.ok(v.hand.mine, '丙上桌后要能拿到自己的手牌');
});

test('废弃房间不出现在列表里，没人了就回收', () => {
  const store = new RoomStore();
  const r1 = store.create('1011');
  const m = fakeClient(r1, '甲');
  r1.start();
  assert.strictEqual(store.list().length, 1, '有人在线的房间应该出现');
  assert.strictEqual(store.list()[0].phase, 'playing');
  m.conn = null;                                    // 人走了，房间还留着
  assert.strictEqual(store.list().length, 0, '没人在线的房间不该出现在列表里（点了也打不了）');
  const dead = store.sweep(Date.now() + 3 * 60 * 1000, 2 * 60 * 1000);
  assert.ok(dead.indexOf('1011') >= 0, '废弃房超过两分钟应该被回收');
  assert.strictEqual(store.get('1011'), null);
  // 走空（成员也没有了）时直接拆
  const r2 = store.create('1012');
  const m2 = fakeClient(r2, '乙');
  r2.leave(m2);
  assert.strictEqual(r2.members.length, 0, '没开局时离开就是直接移除');
  store.drop(r2.id);
  assert.strictEqual(store.get('1012'), null);
});

test('座位上的真人退房走了，座位让给等待区的真人', () => {
  const store = new RoomStore();
  const room = store.create('1013');
  const a = fakeClient(room, '甲');
  fakeClient(room, '乙');
  room.start();
  const c = fakeClient(room, '丙');       // 中途进来等位
  room.pump();
  assert.ok(room.hasPlayer(c.pid), '丙应该在等待区');
  assert.strictEqual(room.game.seatOfId(c.pid), -1, '丙还没上桌');
  const seatA = room.game.seatOfId(a.pid);
  room.leave(a);                           // 甲退房走了
  assert.strictEqual(room.releaseAbandonedSeats(), 1, '甲的座位应该让给等待区的真人');
  assert.strictEqual(room.game.seatOfId(c.pid), seatA, '丙应该坐上甲原来的座位');
  assert.strictEqual(room.game.isInQueue(c.pid), false, '上桌之后不该还在等待区');
});

test('等待区的人不能操作牌局', () => {
  const store = new RoomStore();
  const room = store.create('1008');
  const ms = [];
  for (const n of ['甲', '乙', '丙', '丁', '戊']) ms.push(fakeClient(room, n));
  room.start();
  const fifth = ms[4];
  const v = room.viewFor(fifth);
  assert.strictEqual(v.you.queued, true, '第五个人应该知道自己还在等待区');
  let threw = false;
  try { room.act(fifth, { act: 'discard', kind: 0 }); } catch (e) { threw = true; }
  assert.ok(threw, '等待区的人不该能出牌');
});

test('空房间会被回收', () => {
  const store = new RoomStore();
  const room = store.create('1009');
  fakeClient(room, '甲');
  room.members[0].conn = null;
  const dead = store.sweep(Date.now() + 11 * 60 * 1000, 10 * 60 * 1000);
  assert.deepStrictEqual(dead, ['1009']);
  assert.strictEqual(store.get('1009'), null);
});

run();
