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

test('larger die chooses wall and smaller die chooses its one-based stack', () => {
  const offsets = [0, 82, 54, 28];
  for (let dealer = 0; dealer < 4; dealer++) for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) {
    const big = Math.max(a,b), small = Math.min(a,b), seat = (dealer + big - 1) % 4;
    const o = ZMJ.openingBreak([a,b],dealer), swapped = ZMJ.openingBreak([b,a],dealer);
    assert.equal(o.rule, 'high-die-wall-low-die-stack-v3');
    assert.equal(o.wallDie,big); assert.equal(o.stackDie,small);
    assert.equal(o.breakSeat,seat); assert.equal(o.breakStack,small);
    assert.equal(o.startSlot,offsets[seat]+2*(small-1));
    assert.equal(swapped.startSlot,o.startSlot);
    if(big===1||big===5) assert.equal(seat,dealer);
    if(big===3) assert.equal(seat,(dealer+2)%4);
  }
});

test('dice opening, four-tile packets and physical wall agree for every dealer', () => {
  for (let seed = 1; seed <= 12; seed++) for (let dealer = 0; dealer < 4; dealer++) {
    const rng = ZMJ.mulberry32(seed), raw = Array.from(ZMJ.buildWall(rng));
    const dice = [1 + (rng() * 6 | 0), 1 + (rng() * 6 | 0)];
    const G = ZMJ.createGame({ seed, rotate: false }); G.dealer = dealer; G.startHand();
    const H = G.hand, o = H.opening, big = Math.max(...dice), small = Math.min(...dice);
    assert.deepEqual(Array.from(o.dice), dice);
    assert.equal(o.breakSeat, (dealer + big - 1) % 4);
    assert.equal(o.breakStack, small);
    const wallOffsets = [0, 82, 54, 28];
    const cut = (wallOffsets[o.breakSeat] + 2 * (small-1)) % 108;
    assert.equal(o.startSlot, cut);
    const deck = raw.slice(cut).concat(raw.slice(0, cut));
    const packets = Array.from(ZMJ.openingPackets(dealer));
    assert.deepEqual(Array.from(packets[12].slots), [48]);
    assert.deepEqual(Array.from(packets[13].slots), [52]);
    assert.equal(packets[12].seat, dealer); assert.equal(packets[13].seat, dealer); assert.equal(packets[13].jump, true);
    assert.deepEqual(packets.slice(14).map(p => Array.from(p.slots)), [[49], [50], [51]]);
    assert.deepEqual(packets.flatMap(p => Array.from(p.slots)).sort((a,b)=>a-b), Array.from({length:53},(_,i)=>i));
    for(let seat=0;seat<4;seat++) assert.deepEqual(Array.from(H.dealtHands[seat]), packets.filter(p=>p.seat===seat).flatMap(p=>Array.from(p.slots,slot=>deck[slot])));
    for (let relative = 0; relative < 4; relative++) {
      const expected = Array(27).fill(0), indices = [0, 1, 2, 3, 16, 17, 18, 19, 32, 33, 34, 35];
      indices.forEach(i => expected[deck[i + 4 * relative]]++);
      expected[deck[48 + relative]]++;
      assert.deepEqual(Array.from(H.record.initial[(dealer + relative) % 4]), expected);
    }
    assert.equal(H.lastDraw, deck[52]);
    assert.deepEqual(Array.from(H.wall), deck.slice(53, 102));
    assert.deepEqual(Array.from(H.birds), deck.slice(102));
    assert.equal(H.wallDraws.head, 53); assert.equal(H.wallDraws.tail, 0);
    assert.deepEqual(Object.keys(o).sort(), ['breakSeat','breakStack','dice','rule','stackDie','startSlot','total','wallDie']);
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

test('training guide counts exact waits and next-draw probability after a discard', () => {
  const hand = { players: [player(), player(), player(), player()] };
  [0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 14, 14, 26].forEach(k => hand.players[0].concealed[k]++);
  const guide = ZMJ.trainingGuide(hand, 0, 26, true);
  assert.equal(guide.shanten, 0);
  assert.deepEqual(Array.from(guide.draws, x => [x.kind, x.count]), [[2, 3], [5, 4]]);
  assert.equal(guide.total, 7);
  assert.equal(guide.unknown, 94);
  assert.equal(guide.chanceNext, 7 / 94);
});

test('one-shanten guide shows a valid route to a wider wait without seeing opponents', () => {
  const hand = { players: [player(), player(), player(), player()] };
  [0, 1, 2, 9, 10, 11, 18, 19, 20, 3, 4, 14, 25, 26].forEach(k => hand.players[0].concealed[k]++);
  const guide = ZMJ.trainingGuide(hand, 0, 25, true);
  assert.equal(guide.shanten, 1);
  const route = guide.paths.find(x => x.draw === 14);
  assert.ok(route, 'drawing 6-dot should make a tenpai route');
  assert.ok(route.waitTotal >= 7);
  const hiddenBefore = hand.players[1].concealed[5];
  hand.players[1].concealed[5] = 3;
  assert.deepEqual(ZMJ.trainingGuide(hand, 0, 25, true), guide);
  hand.players[1].concealed[5] = hiddenBefore;
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
      assert.equal(game.hand.wallDraws.head + game.hand.wallDraws.tail + game.hand.wall.length, 102,
        'front and replacement draws must remove the same number of physical wall tiles');
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
