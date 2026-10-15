'use strict';
/**
 * 多人联机所需的引擎能力测试（不涉及网络，只测引擎）。
 * 关键点：引擎必须支持「一张桌上多个真人同时待决」，以及任意人数排队轮换。
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('(function (root, factory) {');
const end = html.indexOf('</script>', start);
assert.ok(start >= 0 && end > start, 'inline core must be present');
const sandbox = { module: { exports: {} } };
vm.runInNewContext(html.slice(start, end), sandbox, { filename: 'mahjong-core.js' });
const ZMJ = sandbox.module.exports;

/** 按服务器给的名单建局：前 4 个上桌，其余排队 */
function makeRoster(n, humanCount) {
  const r = [];
  for (let i = 0; i < n; i++) {
    r.push({ id: 'p' + i, name: '玩家' + i, isHuman: i < humanCount });
  }
  return r;
}

function firstDiscardable(G, seat) {
  const c = G.hand.players[seat].concealed;
  for (let k = 0; k < c.length; k++) if (c[k] > 0) return k;
  return null;
}

/** 驱动一局：所有真人都自己做决定，AI 交给 aiStep */
function driveHand(G, stats, maxSteps) {
  let steps = 0;
  while (!G.hand.over && steps++ < (maxSteps || 4000)) {
    const waits = G.pendingAwaits();
    if (waits.length) {
      const claimSeats = waits.filter((w) => w.type === 'claim').map((w) => w.seat);
      if (claimSeats.length >= 2) {
        stats.multiClaimBatches++;
        // 关键不变量：决定其中一位后，其他真人的待决必须还在，牌局不能推进
        const first = waits.find((w) => w.type === 'claim');
        const others = claimSeats.filter((s) => s !== first.seat);
        const act = first.options.hu ? 'hu' : (first.options.peng ? 'peng' : 'pass');
        G.humanClaim(act, first.options.kind, first.seat);
        const left = G.pendingAwaits().filter((w) => w.type === 'claim').map((w) => w.seat);
        for (const s of others) assert.ok(left.indexOf(s) >= 0, '另一位真人的待决被吞掉了：座位 ' + s);
        if (act !== 'hu') assert.ok(!G.hand.over, '还有真人没决定就结算了');
        stats.multiClaimHandled++;
        continue;
      }
      for (const w of waits) {
        if (w.type === 'turn') {
          if (w.options.canZimo) G.humanZimo(w.seat);
          else {
            const k = firstDiscardable(G, w.seat);
            assert.ok(k != null, '该出牌却没有牌可出');
            G.humanDiscard(k, w.seat);
          }
        } else {
          const act = w.options.hu ? 'hu' : (w.options.peng ? 'peng' : 'pass');
          G.humanClaim(act, w.options.kind, w.seat);
        }
      }
      continue;
    }
    if (G.hasPendingResolve()) { G.resolvePending(); continue; }
    if (!G.aiStep()) break;
  }
  assert.ok(steps < (maxSteps || 4000), '牌局没有终止');
}

test('服务器名单建局：前 4 上桌，其余进等待区，身份/名字/分数保留', () => {
  const roster = [
    { id: 'a', name: '甲方', isHuman: true },
    { id: 'b', name: '乙方', isHuman: true },
    { id: 'c', name: '电脑一', isHuman: false },
    { id: 'd', name: '丁方', isHuman: true, score: 120 },
    { id: 'e', name: '候补一', isHuman: true },
    { id: 'f', name: '电脑二', isHuman: false },
    { id: 'g', name: '候补三', isHuman: true }
  ];
  const G = ZMJ.createGame({ seed: 7, roster: roster });
  assert.equal(G.seats.length, 4, '桌上就是 4 个座位');
  // 注意：引擎跑在 vm 沙箱里，map 出来的是另一个 realm 的数组，
  // deepStrictEqual 会因为原型不同而失败（即使内容完全一样），所以先转成本 realm 的数组
  const ids = (arr) => Array.from(arr, (p) => p.id);
  assert.deepEqual(ids(G.seats), ['a', 'b', 'c', 'd'], '上桌的人不对');
  assert.deepEqual(Array.from(G.seats, (p) => p.name), ['甲方', '乙方', '电脑一', '丁方']);
  assert.equal(G.seats[3].score, 120, '带入分数丢了');
  assert.deepEqual(ids(G.queue), ['e', 'f', 'g'], '等待区不对');
  assert.deepEqual(Array.from(G.seats, (p) => p.isHuman), [true, true, false, true], '真/电脑身份搞错了');
  assert.equal(G.queue[0].isHuman, true, '候补真人的身份要保留');
  assert.equal(G.queue[1].isHuman, false);
});

test('四个人同桌：全部由真人决策，牌局能打完且分数零和', () => {
  const G = ZMJ.createGame({ seed: 20260416, roster: makeRoster(4, 4) });
  const stats = { multiClaimBatches: 0, multiClaimHandled: 0 };
  let hands = 0;
  for (let h = 0; h < 25; h++) {
    G.startHand();
    driveHand(G, stats);
    assert.ok(G.hand.over, '第 ' + (h + 1) + ' 局没结束');
    const d = G.lastResult.deltas;
    const sum = d[0] + d[1] + d[2] + d[3];
    assert.equal(sum, 0, '第 ' + (h + 1) + ' 局分数不零和：' + JSON.stringify(d));
    hands++;
  }
  assert.equal(hands, 25);
  assert.ok(stats.multiClaimHandled > 0,
    '25 局都没出现「多位真人同时待决」，这个测试没验证到目标行为');
});

test('转转轮换：胡牌者下桌，等待区玩家上桌（任意人数）', () => {
  const roster = makeRoster(6, 6);
  const G = ZMJ.createGame({ seed: 99, roster: roster });
  const qIds = G.queue.map((p) => p.id);
  let rotated = 0;
  for (let h = 0; h < 40; h++) {
    const before = G.seats.map((p) => p.id);
    const queueBefore = G.queue.map((p) => p.id);
    G.startHand();
    driveHand(G, { multiClaimBatches: 0, multiClaimHandled: 0 });
    const res = G.lastResult;
    const winners = res.winners || [];
    if (!winners.length) continue;
    G.dealer = G.dealer;              // nextHand 内部处理庄家
    // 手动走一遍 nextHand 的轮换（不重开一局）
    const seatIds = before;
    for (const w of winners) {
      assert.ok(queueBefore.length > 0, '等待区空的时候不该轮换');
      rotated++;
    }
    // 直接验证 nextHand 的行为
    const seatsBefore = G.seats.map((p) => p.id);
    G.nextHand();
    const seatsAfter = G.seats.map((p) => p.id);
    winners.forEach((w) => {
      if (queueBefore.length === 0) return;
      assert.equal(seatsAfter[w], queueBefore[0], '胡牌者的座位应由等待区第一位接替');
      assert.ok(G.queue.some((p) => p.id === seatsBefore[w]), '下桌的胡牌者应进等待区');
    });
    assert.equal(G.seats.length, 4, '桌上永远 4 个座位');
    h++;                              // nextHand 已经开了一局，计数对齐
  }
  assert.ok(rotated > 0, '40 局里一次轮换都没发生');
  assert.equal(G.seats.length + G.queue.length, 6, '总人数必须守恒');
});
