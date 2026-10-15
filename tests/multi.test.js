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

test('转转轮换：真人赢了不下桌，电脑赢了换人，等待区的真人优先上桌', () => {
  // 桌上 2 真人 + 2 电脑；等待区 2 真人 + 2 电脑
  const roster = [
    { id: 'h0', name: '真人0', isHuman: true },
    { id: 'h1', name: '真人1', isHuman: true },
    { id: 'b0', name: '电脑0', isHuman: false },
    { id: 'b1', name: '电脑1', isHuman: false },
    { id: 'h2', name: '候补真人', isHuman: true },
    { id: 'h3', name: '候补真人2', isHuman: true },
    { id: 'b2', name: '电脑2', isHuman: false },
    { id: 'b3', name: '电脑3', isHuman: false }
  ];
  const G = ZMJ.createGame({ seed: 99, roster: roster });
  const total = G.seats.length + G.queue.length;
  let humanWinStayed = 0, botWinRotated = 0, humanEnteredOverBot = 0;
  for (let h = 0; h < 40; h++) {
    const seatsBefore = Array.from(G.seats, (p) => p.id);
    const humansWaiting = G.queue.filter((p) => p.isHuman).map((p) => p.id);
    G.startHand();
    driveHand(G, { multiClaimBatches: 0, multiClaimHandled: 0 });
    const winners = (G.lastResult.winners || []).slice();
    const winnerWasHuman = winners.map((w) => G.seats[w].isHuman);
    G.nextHand();                       // 内部完成轮换并开下一局
    const seatsAfter = Array.from(G.seats, (p) => p.id);
    winners.forEach((w, i) => {
      if (winnerWasHuman[i]) {
        // 真人赢了必须原地不动
        assert.equal(seatsAfter[w], seatsBefore[w], '真人赢牌不该被换下桌');
        humanWinStayed++;
      } else {
        // 电脑赢了必须换人（只要等待区还有人）
        if (G.queue.length + 4 > total) return;
        assert.notEqual(seatsAfter[w], seatsBefore[w], '电脑赢牌应该换人上桌');
        assert.ok(G.queue.some((p) => p.id === seatsBefore[w]), '下桌的电脑应进等待区');
        botWinRotated++;
        // 只要等待区还有真人，上桌的就必须是真人（真人优先级最高）
        if (humansWaiting.length) {
          assert.ok(humansWaiting.indexOf(seatsAfter[w]) >= 0,
            '等待区有真人时，上桌的却是个电脑：' + seatsAfter[w]);
          humanEnteredOverBot++;
        }
      }
    });
    // 桌上不能出现同一个人两次
    assert.equal(new Set(seatsAfter).size, 4, '有人占了两个座位：' + seatsAfter.join(','));
    assert.equal(G.seats.length + G.queue.length, total, '总人数必须守恒');
  }
  assert.ok(humanWinStayed > 0, '40 局里没有真人胡过牌，没验证到「真人不下桌」');
  assert.ok(botWinRotated > 0, '40 局里电脑一次都没胡过，没验证到「电脑赢了换人」');
  assert.ok(humanEnteredOverBot > 0, '没出现「等待区真人优先于电脑上桌」的机会');
});

test('真人退房后，座位让给等待区的真人', () => {
  const roster = [
    { id: 'h0', name: '真人0', isHuman: true },
    { id: 'b0', name: '电脑0', isHuman: false },
    { id: 'b1', name: '电脑1', isHuman: false },
    { id: 'b2', name: '电脑2', isHuman: false },
    { id: 'h1', name: '候补真人', isHuman: true },
    { id: 'b3', name: '电脑3', isHuman: false }
  ];
  const G = ZMJ.createGame({ seed: 7, roster: roster });
  assert.equal(G.seatOfId('h1'), -1, '候补一开始在等待区');
  assert.equal(G.seatVacated(0), true, '座位 0 空出来后应由等待区的真人顶上');
  assert.equal(G.seatOfId('h1'), 0, '候补真人应该坐上 0 号位');
  assert.equal(G.isInQueue('h1'), false, '上桌之后不该还在等待区');
  // 等待区没有真人时，不让位（交给电脑代打）
  assert.equal(G.seatVacated(1), false, '等待区没真人时不该换人');
});
