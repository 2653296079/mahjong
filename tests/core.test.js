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

function player() {
  return { concealed: ZMJ.newCounts(), discards: [], melds: [], passedWin: false };
}

test('wall has four copies of every suited tile', () => {
  const wall = ZMJ.buildWall(ZMJ.mulberry32(42));
  assert.equal(wall.length, 108);
  for (let kind = 0; kind < 27; kind++) {
    assert.equal(wall.filter(tile => tile === kind).length, 4);
  }
});

test('unknown pool excludes hidden opponents and counts called discard once', () => {
  const hand = { players: [player(), player(), player(), player()] };
  hand.players[0].concealed[0] = 1;
  hand.players[1].concealed[1] = 2;
  hand.players[1].melds.push({ type: 'peng', kind: 2, from: 2 });
  hand.players[2].discards.push(2);
  const pool = ZMJ.visiblePool(hand, 0);
  assert.equal(pool[0], 3);
  assert.equal(pool[1], 4, 'opponent concealed tiles are unknown');
  assert.equal(pool[2], 1, 'the called tile exists in both UI records but is one physical tile');
});

test('discard advice does not read hidden opponent hands', () => {
  const game = ZMJ.createGame({ seed: 2026, rotate: false });
  game.startHand();
  const hand = game.hand;
  const before = Array.from(ZMJ.evaluateDiscards(hand, 0), x => [x.kind, x.shanten, x.ukeire]);
  hand.players[1].concealed[0] += 2;
  hand.players[1].concealed[8] = 0;
  const after = Array.from(ZMJ.evaluateDiscards(hand, 0), x => [x.kind, x.shanten, x.ukeire]);
  assert.deepEqual(after, before);
});

test('kong options include four existing tiles and a held fourth tile after a pung', () => {
  const game = ZMJ.createGame({ seed: 8, rotate: false });
  game.startHand();
  const p = game.hand.players[0];
  game.hand.lastDraw = 26;
  p.concealed[3] = 4;
  p.concealed[4] = 1;
  p.melds.push({ type: 'peng', kind: 4, from: 1 });
  const options = game.turnOptionsFor(0);
  assert.ok(options.anGang.includes(3));
  assert.ok(options.buGang.includes(4));
});

test('replay upgrades a pung to one kong without changing earlier frames', () => {
  const initial = Array.from({ length: 4 }, () => ZMJ.newCounts());
  initial[0][4] = 2;
  initial[1][4] = 1;
  const states = ZMJ.replayStates({ initial, events: [
    { t: 'x', s: 1, k: 4 },
    { t: 'p', s: 0, k: 4, f: 1 },
    { t: 'd', s: 0, k: 4 },
    { t: 'g', s: 0, k: 4, y: 'bu', f: -1 }
  ] }, 0);
  assert.equal(states[2].melds[0].length, 1);
  assert.equal(states[2].melds[0][0].type, 'peng');
  assert.equal(states[4].melds[0].length, 1);
  assert.equal(states[4].melds[0][0].type, 'gang');
});

test('AI rounds terminate with zero-sum scores', () => {
  const game = ZMJ.createGame({ seed: 101, rotate: false });
  game.fastForward = true;
  for (let round = 0; round < 12; round++) {
    game.startHand();
    let steps = 0;
    while (!game.hand.over && steps++ < 500) {
      if (game.hasPendingResolve()) game.resolvePending();
      else assert.equal(game.aiStep(), true);
      const visible = Array.from(ZMJ.visiblePool(game.hand, 0));
      const hidden = ZMJ.newCounts();
      for (const tile of game.hand.wall.concat(game.hand.birds)) hidden[tile]++;
      for (let seat = 1; seat < 4; seat++) {
        for (let kind = 0; kind < 27; kind++) hidden[kind] += game.hand.players[seat].concealed[kind];
      }
      assert.deepEqual(visible, Array.from(hidden), 'unseen pool must match physical hidden tiles');
    }
    assert.ok(game.hand.over, `round ${round + 1} did not terminate`);
    assert.equal(game.seats.reduce((sum, p) => sum + p.score, 0), 0);
  }
});
