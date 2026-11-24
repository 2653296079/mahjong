'use strict';
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { before, test } = require('node:test');

let companions, models, Vector3;
const animals = ['cat', 'fox', 'panda', 'rabbit'];
before(async () => {
  const [{ Scene, Vector3: Vec3 }, { GLTFLoader }, { createCompanions }] = await Promise.all([
    import('../assets/vendor/three/three.module.js'),
    import('../assets/vendor/three/GLTFLoader.js'),
    import('../assets/table3d/companions.js')
  ]);
  Vector3 = Vec3;
  // Node has no image decoder. The GLTF loader still parses the actual meshes,
  // skin weights, bones and animations used by the live table.
  globalThis.self = globalThis;
  globalThis.createImageBitmap = async () => ({ width: 1, height: 1 });
  try {
    models = new Map(await Promise.all(animals.map(async animal => {
      const file = path.join(__dirname, '../assets/mahjong-3d/glb/companions', animal + '.glb');
      const data = await readFile(file);
      const { scene, animations } = await new GLTFLoader().parseAsync(
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), ''
      );
      scene.animations = animations;
      return ['companion-' + animal, scene];
    })));
  } finally {
    delete globalThis.self;
    delete globalThis.createImageBitmap;
  }
  companions = createCompanions(new Scene(), models);
});

function hold(pos, x, y, z, grip = 1) {
  return { pos, point: new Vector3(x, y, z), grip };
}

function catGripPosition() {
  return models.get('companion-cat').getObjectByName('PawR').children.at(-1).getWorldPosition(new Vector3());
}

test('uses the latest per-seat hold without Array.prototype.findLast', () => {
  const previous = Object.getOwnPropertyDescriptor(Array.prototype, 'findLast');
  delete Array.prototype.findLast;
  const latest = hold(0, .045, .9305, .3908);
  try {
    companions.update(1000, [hold(0, 0, .9305, .3908), latest, hold(1, .35, .855, .03)]);
  } finally {
    if (previous) Object.defineProperty(Array.prototype, 'findLast', previous);
  }
  assert.ok(catGripPosition().distanceTo(latest.point) < .001);
  assert.deepEqual(companions.inspect().filter(r => r.holding).map(r => r.pos), [0, 1]);
});

test('mid-row drag gives a sub-millimetre grip', () => {
  const midRow = hold(0, .045, .9305, .3908);
  companions.update(1000, [midRow]);
  const [cat] = companions.inspect();
  assert.equal(cat.holding, true);
  assert.equal(cat.grip, 1);
  assert.ok(cat.error < .001);
  assert.ok(catGripPosition().distanceTo(midRow.point) < .001);
});

test('dragging from mid-row to the table centre releases the grip and restores the idle pose', () => {
  companions.update(1000);
  const idlePaw = catGripPosition();
  const midRow = hold(0, .045, .9305, .3908);
  companions.update(1000, [midRow]);
  assert.equal(companions.inspect()[0].holding, true);
  companions.update(1000, [midRow, hold(0, .03, .9305, 0)]);
  assert.deepEqual(companions.inspect()[0], { pos: 0, animal: 'cat', holding: false, grip: 0, error: 0 });
  assert.ok(catGripPosition().distanceTo(idlePaw) < .001);
});

test('companions still animate in idle poses', () => {
  const panda = models.get('companion-panda');
  const paw = panda.getObjectByName('PawL');
  companions.update(0);
  const before = paw.getWorldPosition(new Vector3());
  companions.update(1963);
  assert.ok(paw.getWorldPosition(new Vector3()).distanceTo(before) > .03);
});

test('does not start a grip on an unreachable tile during the reach lead-in', () => {
  companions.update(1000, [hold(0, .03, .9305, 0, .25)]);
  assert.equal(companions.inspect()[0].holding, false);
});
