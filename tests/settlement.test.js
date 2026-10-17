'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { Room, loadCore } = require('../server/rooms');
const Z = loadCore();

function finish(G) {
  for (let n = 0; !G.hand.over && n < 3000; n++) {
    if (G.hasPendingResolve()) G.resolvePending();
    else if (G.pendingAwaits().length) G.autoPlaySeat(G.pendingAwaits()[0].seat);
    else assert.ok(G.aiStep(), 'game must keep progressing');
  }
  assert.ok(G.hand.over);
}
function makeRoom(seed) {
  const room = new Room('5432');
  for (const name of ['甲', '乙', '丙', '丁', '等候者']) {
    const m = room.join(name); m.conn = { send() {} };
  }
  room.game = Z.createGame({ seed, rotate: false,
    roster: room.members.map(m => ({ id: m.pid, name: m.name, isHuman: true })) });
  room.game.startHand();
  return room;
}

test('final hand snapshots are unavailable while playing and deeply copy concealed tiles and melds', () => {
  assert.equal(Z.settlementHands(null), null);
  const H = { over: false, get players() { throw new Error('active hand must not be read'); } };
  assert.equal(Z.settlementHands(H), null);
  const G = Z.createGame({ seed: 17 }); G.startHand(); finish(G);
  G.hand.players[2].melds.push({ type: 'gang', kind: 8, from: -1, ming: false, bu: false });
  const snapshot = Z.settlementHands(G.hand);
  assert.equal(snapshot.length, 4);
  snapshot.forEach((p, s) => {
    assert.equal(p.seat, s);
    assert.deepEqual(p.concealed, G.hand.players[s].concealed);
  });
  snapshot[2].concealed[0] = 99;
  snapshot[2].melds.at(-1).kind = 0;
  assert.notEqual(G.hand.players[2].concealed[0], 99);
  assert.equal(G.hand.players[2].melds.at(-1).kind, 8);
});

test('online terminal reveal is exact for players and queued spectators, then disappears next round', () => {
  for (const seed of [1, 13, 20261016]) {
    const room = makeRoom(seed), G = room.game;
    for (const m of room.members) {
      const v = room.viewFor(m);
      assert.equal(v.hand.revealed, undefined);
      v.hand.players.forEach(p => assert.equal(p.concealed, undefined));
    }
    finish(G);
    const expected = Z.settlementHands(G.hand);
    for (const m of room.members) {
      const v = room.viewFor(m);
      assert.deepEqual(v.hand.revealed, expected);
      assert.equal(v.hand.revealed.length, 4);
    }
    const queued = room.viewFor(room.members[4]);
    assert.equal(queued.you.seat, -1);
    assert.equal(queued.hand.mine, null);
    const saved = JSON.stringify(queued.hand.revealed);
    room.next();
    assert.equal(room.viewFor(room.members[4]).hand.revealed, undefined);
    assert.equal(JSON.stringify(queued.hand.revealed), saved);
  }
});

test('an exhausted wall still reveals all four remaining hands without adding winning tiles', () => {
  const room = makeRoom(71), G = room.game;
  G.hand.wall.length = 0;
  finish(G);
  assert.equal(G.lastResult.type, 'draw');
  const view = room.viewFor(room.members[0]);
  view.hand.revealed.forEach((p, s) => assert.deepEqual(p.concealed, G.hand.players[s].concealed));
  assert.equal(view.result.type, 'draw');
});
