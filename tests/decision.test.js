const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../server/rooms').loadCore();

// 独立参照：将牌单独选择，搭子只占剩余面子槽位，不复用生产版 bestBlocks。
function referenceStandard(input, melds) {
  const c = input.slice(), need = 4 - melds;
  let best = 8;
  function walk(m, t, head) {
    let k = c.findIndex(n => n > 0);
    if (k < 0) { best = Math.min(best, 2 * need - 2 * m - Math.min(t, need - m) - head); return; }
    if (m < need && c[k] >= 3) { c[k] -= 3; walk(m + 1, t, head); c[k] += 3; }
    if (m < need && k % 9 < 7 && c[k + 1] && c[k + 2]) {
      c[k]--; c[k + 1]--; c[k + 2]--; walk(m + 1, t, head); c[k]++; c[k + 1]++; c[k + 2]++;
    }
    if (c[k] >= 2) {
      c[k] -= 2;
      if (!head) walk(m, t, 1);
      walk(m, t + 1, head); c[k] += 2;
    }
    for (const gap of [1, 2]) if (k % 9 + gap < 9 && c[k + gap]) {
      c[k]--; c[k + gap]--; walk(m, t + 1, head); c[k]++; c[k + gap]++;
    }
    c[k]--; walk(m, t, head); c[k]++;
  }
  walk(0, 0, 0);
  return best;
}

test('standard shanten agrees with a separate head-and-meld reference in every meld count', () => {
  const rng = Z.mulberry32(20261016);
  for (let melds = 0; melds <= 4; melds++) for (let i = 0; i < 500; i++) {
    const c = Z.newCounts();
    Z.buildWall(rng).slice(0, 13 - melds * 3 + i % 2).forEach(k => c[k]++);
    assert.equal(Z.shantenStandard(c, melds), referenceStandard(c, melds), JSON.stringify({ melds, c }));
  }
});

test('decision identity changes with public information but never hidden opponent tiles', () => {
  const H = Z.practiceHand('shape-1');
  const first = Z.decisionReport(H, 0);
  assert.equal(first.rulesVersion, 'zhuanzhuan-108-v1');
  H.players[1].concealed[0] = 4;
  assert.deepEqual(Z.decisionReport(H, 0), first);
  H.players[1].discards.push(1);
  assert.notEqual(Z.decisionReport(H, 0).stateKey, first.stateKey);
  assert.ok(first.equivalentKinds.length);
});

test('a structural wait with all four winning tiles visible is labelled dead', () => {
  const H = Z.practiceHand('wide-2');
  // 6/7 万搭子等 5/8 万；两种和牌张全部公开。
  H.players[1].discards = [4, 4, 4, 4, 7, 7, 7, 7];
  const g = Z.trainingGuide(H, 0, 26, true);
  assert.equal(g.shanten, 0);
  assert.deepEqual(g.structuralWaits, [4, 7]);
  assert.equal(g.total, 0);
  assert.equal(g.deadWait, true);
  assert.equal(g.chanceNext, 0);
});

test('kong analysis accounts for losing seven pairs and enumerates replacement draws without mutation', () => {
  const H = Z.practiceHand('pairs-1'); H.wall = new Array(40);
  const before = JSON.stringify(H), result = Z.kongAdvice(H, 0, 0, 'an');
  assert.ok(result);
  assert.equal(result.gain, 30);
  assert.equal(result.losesSevenPairs, true);
  assert.ok(result.keepChance < 1, 'kong is not automatically harmless to a ready seven-pairs hand');
  assert.ok(result.readyChance >= 0 && result.readyChance <= 1);
  assert.equal(JSON.stringify(H), before);
  H.players[2].concealed[17] = 4;
  assert.deepEqual(Z.kongAdvice(H, 0, 0, 'an'), result);
  H.wall = [];
  assert.equal(Z.kongAdvice(H, 0, 0, 'an'), null);
});
