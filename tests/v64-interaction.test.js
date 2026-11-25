const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function section(start, end) {
  const from = html.indexOf(start);
  assert.notEqual(from, -1);
  const to = html.indexOf(end, from + start.length);
  assert.notEqual(to, -1);
  return html.slice(from, to);
}

test('the 3D river drop is classified in world space, not by rotated screen bounds', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'assets/table3d/table3d.js'), 'utf8');
  const match = /function isRiverDragTarget\(drag, insert\) \{[\s\S]*?\n\}/.exec(source);
  assert.ok(match, 'production world-space river predicate exists');
  const isRiverDragTarget = vm.runInNewContext('(' + match[0] + ')');
  assert.equal(isRiverDragTarget({ hit: { x: 0, z: .311 } }, { targetId: 'tile:4' }), false);
  assert.equal(isRiverDragTarget({ hit: { x: 0, z: .311 } }, null), false);
  assert.equal(isRiverDragTarget({ hit: { x: 0, z: .10 } }, null), true);
  assert.equal(isRiverDragTarget({ hit: { x: 0, z: .10 } }, { targetId: 'tile:4' }), false);
  assert.equal(isRiverDragTarget({ hit: { x: .4, z: .10 } }, null), false);
  assert.equal(isRiverDragTarget({ hit: { x: 0, z: -.5 } }, null), false);
});

test('a new online snapshot for the same draw preserves receipt and arrangement', () => {
  const context = vm.createContext({ ZMJ: { KINDS: 3 } });
  vm.runInContext(section('  var handArrange =', '  function drawPending2D'), context);
  assert.deepEqual(Array.from(vm.runInContext(`
    var game = {online: true, handNo: 7};
    var first = handArrangeState({turnCount: 9}, 0, [1,2,1], 1);
    first.received = first.revealed = true;
    first.order.reverse();
    var next = handArrangeState({turnCount: 9}, 0, [1,2,1], 1);
    var repeatedDraw = [next === first, next.order.join(','), next.received, next.revealed];
    var later = handArrangeState({turnCount: 10}, 0, [1,2,1], 1);
    repeatedDraw.concat(later.received)
  `, context)), [true, '2:0,1:1,1:0,0:0', true, true, false]);
  assert.equal(vm.runInContext(`
    handArrangeState({turnCount:10}, 0, [1,2,1], 1).received = true;
    game.handNo++;
    handArrangeState({turnCount:10}, 0, [1,2,1], 1).received
  `, context), false);
});

test('timed solo play pauses while the 3D table is unavailable', () => {
  for (const [loading, blocked] of [[true, false], [false, true]]) {
    const timers = [];
    const context = vm.createContext({
      game: { hand: {}, awaiting: { type: 'turn' } },
      table3D: { busy: false, loading },
      document: { body: { classList: { contains: name => blocked && name === 'threeBlocked' } } },
      $: () => ({ classList: { contains: name => name === 'hidden' } }),
      pauseStarted: 0, timer: null, selectedTile: null, lastAwaiting: null, turnDeadline: 1,
      cfg: { turnTime: 15 }, clearTimeout() {}, render() {}, renderTimer() {},
      autoAct() { throw Error('the blocked hand advanced'); },
      setTimeout(fn, ms) { timers.push([fn.name, ms]); },
    });
    vm.runInContext(section('  function tick() {', '  // 超时自动操作') + '\n\n    lastAwaiting = game.awaiting; tick();', context);
    assert.ok(context.pauseStarted > 0);
    assert.deepEqual(timers, [['tick', 150]]);
  }
});

test('mounting 3D rebuilds every seat and the full opening hand before syncing the scene', () => {
  let count = 13;
  const seats = [];
  const context = {
    api: { setActive() {} }, game: { hand: {} }, table3D: { wanted: true },
    document: { body: { classList: { add() {} } } }, $: () => ({ classList: { remove() {} } }),
    renderActions() {}, renderCenter() {}, renderSeat(position) { seats.push(position); if (position === 0) count = 14; },
    syncTable3D() { assert.equal(count, 14); assert.deepEqual(seats, [0, 1, 2, 3]); },
  };
  vm.runInNewContext(section('      table3D.api=api;', '\n    }).catch(failTable3D)'), context);
});

test('3D hand dragging starts only on the tile hit by the ray', () => {
  let picked = null;
  const domTile = { dataset: { tileId: '0:0' }, setPointerCapture() {} };
  const visibleTile = { dataset: { tileId: '1:0' }, setPointerCapture() {} };
  const seat = { dataset: {} };
  const row = { querySelector: () => visibleTile };
  let pointerDown;
  row.addEventListener = (type, listener) => { if (type === 'pointerdown') pointerDown = listener; };
  vm.runInNewContext(section("        row.addEventListener('pointerdown',function(e)", "        row.addEventListener('pointermove'"), {
    row, table3D: { api: { pickHandTile: () => picked } },
    document: { body: { classList: { contains: () => true } } }, $: () => seat,
    game: { online: false }, drawPending2D: () => false,
  });
  const event = { target: { closest: () => domTile }, button: 0, pointerId: 1, clientX: 12, clientY: 16 };
  pointerDown(event);
  assert.equal(row._reorder, undefined, 'a transparent projected rectangle cannot start an occluded drag');
  picked = visibleTile.dataset.tileId;
  pointerDown(event);
  assert.equal(row._reorder.id, visibleTile.dataset.tileId);
});

test('a second wall tile still accepts a click after the previous tile was dragged', () => {
  const listeners = {};
  let accepted = 0;
  const ghost = { style: {}, parentNode: { removeChild() {} } };
  const classes = { add() {}, remove() {} };
  const wall = { dataset: {}, classList: classes, addEventListener: (key, fn) => { listeners[key] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  const row = { classList: { ...classes, toggle() {} }, getBoundingClientRect: () => ({ left: 50, right: 150, top: 50, bottom: 150 }) };
  const context = { $: () => wall, document: { querySelector: () => row, body: { appendChild() {} } },
    wallDrawable2D: () => true, isTouch: false, backEl: () => ghost, acceptWallDraw: () => ++accepted };
  vm.runInNewContext(section("  (function(){\n    var wi=$('drawWall2D')", "  $('btnTileArt').onclick"), context);
  const event = (target, x, y, pointerId = 1) => ({ target, clientX:x, clientY:y, pointerId, button:0, preventDefault() {} });
  const first = { id: 'wallDrawTile' };
  listeners.pointerdown(event(first, 0, 0));
  listeners.pointermove(event(first, 75, 75));
  listeners.pointerup(event(first, 75, 75));
  assert.equal(accepted, 1);
  const second = { id: 'wallDrawTile' };
  listeners.pointerdown(event(second, 0, 0, 2));
  listeners.pointerup(event(second, 0, 0, 2));
  listeners.click(event(second, 0, 0, 2));
  assert.equal(accepted, 2);
});
