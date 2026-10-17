'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadCore, Room } = require('../server/rooms');
const Z = loadCore();

test('central river follows public discard chronology and marks only tiles taken by calls', () => {
  const h = { record: { events: [
    { t:'d', s:0, k:5 }, { t:'x', s:0, k:2 }, { t:'p', s:1, f:0, k:2 },
    { t:'x', s:1, k:7 }, { t:'g', s:2, f:1, k:7, y:'ming' },
    { t:'g', s:2, k:10, y:'an' }, { t:'g', s:1, k:2, y:'bu' },
    { t:'x', s:2, k:11 }, { t:'x', s:3, k:11 }
  ] } };
  assert.deepEqual(Z.publicDiscards(h), [
    {seat:0,kind:2,order:1,claimedBy:1}, {seat:1,kind:7,order:2,claimedBy:2},
    {seat:2,kind:11,order:3,claimedBy:null}, {seat:3,kind:11,order:4,claimedBy:null}
  ]);
  assert.deepEqual(Z.publicDiscards({}), []);
});

test('online central river contains only public fields and survives hidden information changes', () => {
  const room = new Room('1888', { seed:20261017 });
  const m = room.join('公开牌河'); m.conn = {send(){}}; room.start();
  const H = room.game.hand;
  H.record.events.push({t:'x',s:1,k:5}, {t:'x',s:2,k:8});
  const before = room.viewFor(m).hand.river;
  assert.deepEqual(before, Z.publicDiscards(H));
  for (const p of before) assert.deepEqual(Object.keys(p).sort(), ['claimedBy','kind','order','seat']);
  H.players[1].concealed.reverse(); H.wall.reverse(); H.birds = [26,25];
  assert.deepEqual(room.viewFor(m).hand.river, before);
  assert.equal(room.viewFor(m).hand.revealed, undefined);
});
