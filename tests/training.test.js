const test = require('node:test');
const assert = require('node:assert/strict');
const Z = require('../server/rooms').loadCore();

test('quad counts as two pairs under this table rule, including the last winning tile', () => {
  const c = Z.newCounts();
  [0,0,0,0,3,3,7,7,10,10,15,15,23,23].forEach(k => c[k]++);
  assert.equal(Z.isWin(c, 0), true);
  assert.equal(Z.shantenSevenPairs(c), -1);
  assert.equal(Z.shanten(c, 0), -1);
  c[0]--;
  assert.equal(Z.shanten(c, 0), 0);
  assert.ok(Z.ukeire(c, 0).kinds.includes(0));
  const old = Z.RULES.sevenPairsAllowQuad;
  try {
    Z.RULES.sevenPairsAllowQuad = false;
    assert.ok(Z.shanten(c, 0) > 0, 'cache respects the rule flag');
  } finally { Z.RULES.sevenPairsAllowQuad = old; }
});

test('drawing without replacement agrees with exact combinations and boundaries', () => {
  // 2 useful among 10: 1 - C(8,2)/C(10,2) = 17/45.
  assert.ok(Math.abs(Z.drawChance(2, 10, 2) - 17 / 45) < 1e-12);
  assert.equal(Z.drawChance(0, 10, 4), 0);
  assert.equal(Z.drawChance(3, 10, 0), 0);
  assert.equal(Z.drawChance(3, 10, 10), 1);
  assert.equal(Z.drawChance(3, 0, 1), 0);
  assert.ok(Math.abs(Z.drawChance(7, 94, 1) - 7 / 94) < 1e-12);
});

test('every lesson has legal concealed tiles, a real task, and exact candidate counts', () => {
  assert.equal(new Set(Z.practiceCases.map(q => q.id)).size, Z.practiceCases.length);
  for (const q of Z.practiceCases) {
    const H = Z.practiceHand(q.id), c = H.players[0].concealed;
    const mc = H.players[0].melds.length;
    assert.equal(Z.sumCounts(c), (q.action === 'peng' ? 13 : 14) - 3 * mc, q.id);
    assert.ok(c.every(n => n >= 0 && n <= 4), q.id);
    assert.equal(Z.isWin(c, mc), false, q.id + ' must not ask to discard an already winning hand');
    const before = JSON.stringify(H), opts = Z.practiceChoices(q.id);
    assert.ok(opts.length >= 2, q.id + ' needs at least two choices');
    if (q.action === 'peng') {
      c[q.claim]++; assert.equal(Z.isWin(c, mc), false, 'do not train giving up an available win'); c[q.claim]--;
      const result = Z.pengAdvice(H,0,q.claim,1);
      assert.deepEqual(opts.find(o=>o.kind==='pass'), {kind:'pass',...result.before});
      assert.equal(opts.find(o=>o.kind==='peng').discard, result.after.kind);
      continue;
    }
    assert.ok(opts.some(o => !Z.sameEfficiency(o, opts[0])), q.id + ' needs a meaningful alternative');
    for (const o of opts) {
      const g = Z.trainingGuide(H, 0, o.kind, false);
      assert.equal(o.ukeire, g.total, q.id + ': count even the worse-shanten candidates');
      assert.equal(o.shanten, g.shanten);
    }
    assert.equal(JSON.stringify(H), before, 'evaluation cannot mutate the hand');
  }
});

test('equivalent discards are both accepted and wider-wait routes conserve tiles', () => {
  const H = Z.practiceHand('wide-3'), opts = Z.evaluateDiscards(H, 0);
  assert.ok(Z.sameEfficiency(opts[0], opts[1]));
  const hand = Z.practiceHand('shape-1');
  const best = Z.evaluateDiscards(hand, 0)[0];
  const guide = Z.trainingGuide(hand, 0, best.kind, true);
  assert.equal(guide.shanten, 1);
  assert.ok(guide.paths.length > 0);
  let weighted = 0;
  for (const p of guide.paths) {
    const c = hand.players[0].concealed.slice();
    c[best.kind]--; c[p.draw]++; c[p.discard]--;
    assert.equal(Z.sumCounts(c), 13);
    assert.equal(Z.shanten(c, 0), 0);
    for (const k of p.waits) { c[k]++; assert.equal(Z.isWin(c, 0), true); c[k]--; }
    assert.equal(p.waitTotal, p.waitCounts.reduce((a,b) => a+b, 0));
    weighted += p.drawCount * p.waitTotal;
  }
  assert.equal(guide.averageWait, weighted / guide.total);
  assert.equal(guide.twoDrawWin, weighted / (guide.unknown * (guide.unknown - 1)));
});

test('pung advice evaluates the mandatory discard and does not access opponents concealed tiles', () => {
  const H = Z.practiceHand('shape-2');
  H.players[0].concealed[0]--; // waiting with 13 tiles
  H.players[1].discards.push(26);
  const before = JSON.stringify(H);
  const result = Z.pengAdvice(H, 0, 26, 1);
  assert.ok(result && result.after);
  const after = structuredClone(H);
  after.players[0].concealed[26] -= 2;
  after.players[0].melds.push({ type: 'peng', kind: 26, from: 1 });
  after.players[0].concealed[result.after.kind]--;
  assert.equal(Z.sumCounts(after.players[0].concealed), 10);
  assert.equal(result.after.shanten, Z.shanten(after.players[0].concealed, 1));
  assert.equal(result.after.ukeire, Z.ukeire(after.players[0].concealed, 1, Z.visiblePool(H, 0)).total);
  assert.equal(JSON.stringify(H), before);
  H.players[2].concealed[5] = 4;
  assert.deepEqual(Z.pengAdvice(H, 0, 26, 1), result);
});

test('winning and ready status agree with independent win enumeration over valid random hands', () => {
  const rng = Z.mulberry32(7788);
  for (let i = 0; i < 300; i++) {
    const c = Z.newCounts();
    Z.buildWall(rng).slice(0, 13).forEach(k => c[k]++);
    let ready = false;
    for (let k = 0; k < 27; k++) {
      if (c[k] === 4) continue;
      c[k]++; if (Z.isWin(c, 0)) ready = true; c[k]--;
    }
    assert.equal(Z.shanten(c, 0) === 0, ready, c.join(','));
  }
});

test('generated complete standard hands and every one-tile removal have consistent shanten', () => {
  const rng = Z.mulberry32(9123);
  for (let i = 0; i < 180; i++) {
    const c = Z.newCounts();
    for (let m = 0; m < 4; m++) {
      const k = Math.floor(rng() * 27);
      if (rng() < 0.5) c[k] += 3;
      else { const start = Math.floor(k / 9) * 9 + k % 7; c[start]++; c[start + 1]++; c[start + 2]++; }
    }
    c[Math.floor(rng() * 27)] += 2;
    if (c.some(n => n > 4)) { i--; continue; }
    assert.equal(Z.isWin(c, 0), true);
    assert.equal(Z.shanten(c, 0), -1, c.join(','));
    for (let k = 0; k < 27; k++) if (c[k]) {
      c[k]--; assert.equal(Z.shanten(c, 0), 0, c.join(',')); c[k]++;
    }
  }
});
