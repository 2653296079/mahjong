import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';

const MODEL_ROOT = new URL('../mahjong-3d/glb/', import.meta.url);
const TOP = 0.759;
const SUITS = ['wan', 'suo', 'tong'];
const INKS = [0x6bb9d6, 0xd8af63, 0xd88982, 0xb89ad9];
const clamp = THREE.MathUtils.clamp;
const modelId = kind => SUITS[Math.floor(kind / 9)] + '-' + String(kind % 9 + 1).padStart(2, '0');
const turn = (pos, x, z, y = TOP) => {
  const a = pos * Math.PI / 2;
  return new THREE.Vector3(x * Math.cos(a) + z * Math.sin(a), y, z * Math.cos(a) - x * Math.sin(a));
};
const rotation = (pos, tilt = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(0, pos * Math.PI / 2, 0))
  .multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)));

export async function createTable3D(host, callbacks = {}) {
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 700 ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '可交互的三维麻将牌桌');
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#102722');
  scene.fog = new THREE.Fog('#102722', 3, 8);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.04, 12);
  const generator = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = generator.fromScene(room, 0.035);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.55;
  room.dispose();
  generator.dispose();
  scene.add(new THREE.HemisphereLight(0xf4f1dc, 0x173a2a, 0.75));
  const keyLight = new THREE.DirectionalLight(0xfff0d3, 2.4);
  keyLight.position.set(-0.6, 2.5, 0.8);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.setScalar(innerWidth < 700 ? 512 : 1024);
  Object.assign(keyLight.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.1, far: 4 });
  keyLight.shadow.bias = -0.00008;
  keyLight.shadow.normalBias = 0.00035;
  scene.add(keyLight);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshBasicMaterial({ color: '#101f1b' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  scene.add(floor);

  const loader = new GLTFLoader(), templates = new Map();
  const requests = Array.from({ length: 27 }, (_, kind) => [modelId(kind), 'tiles/' + modelId(kind) + '.glb']);
  requests.push(['mahjong-table', 'mahjong-table.glb'], ['tile-back', 'tile-back.glb'], ['dice', 'dice.glb'], ['dealer-marker', 'dealer-marker.glb']);
  let loaded = 0;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    await Promise.all(requests.map(async ([id, file]) => {
      const response = await fetch(new URL(file, MODEL_ROOT), { signal: controller.signal });
      if (!response.ok) throw Error('模型读取失败：' + id);
      const gltf = await loader.parseAsync(await response.arrayBuffer(), MODEL_ROOT.href);
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(obj => {
        if (obj.isMesh) {
          obj.castShadow = !/face|rank|character|pip/i.test(obj.name);
          obj.receiveShadow = true;
        }
      });
      templates.set(id, gltf.scene);
      callbacks.onProgress?.(++loaded, requests.length);
    }));
  } catch (error) {
    controller.abort();
    renderer.dispose();
    env.dispose();
    renderer.domElement.remove();
    throw error;
  } finally { clearTimeout(timeout); }

  const table = templates.get('mahjong-table').clone(true);
  scene.add(table);
  // 麻将机中央升降骰盘和四方升牌槽，沿用桌体的真实米制尺寸。
  const machine = new THREE.Group(), lid = new THREE.Group();
  machine.position.y = TOP;
  scene.add(machine);
  const metal = new THREE.MeshStandardMaterial({ color: '#273d38', metalness: 0.65, roughness: 0.28 });
  const dark = new THREE.MeshStandardMaterial({ color: '#081714', roughness: 0.82 });
  const trim = new THREE.MeshStandardMaterial({ color: '#bca26b', metalness: 0.7, roughness: 0.28 });
  const light = new THREE.MeshStandardMaterial({ color: '#85cfaa', emissive: '#2d9663', emissiveIntensity: 0.7 });
  function cylinder(radius, height, material, parent, y = 0) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 64), material);
    mesh.position.y = y; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  cylinder(0.084, 0.006, trim, machine, 0.001);
  cylinder(0.080, 0.008, dark, machine, 0.003);
  machine.add(lid);
  cylinder(0.075, 0.010, metal, lid, 0.008);
  cylinder(0.069, 0.002, dark, lid, 0.014);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.073, 0.0012, 8, 64), light);
  ring.rotation.x = Math.PI / 2; ring.position.y = 0.014; lid.add(ring);
  const rails = [];
  for (let pos = 0; pos < 4; pos++) {
    const slot = new THREE.Mesh(new THREE.BoxGeometry(0.43, 0.003, 0.045), dark);
    slot.position.copy(turn(pos, 0, 0.264, 0.001)); slot.quaternion.copy(rotation(pos)); machine.add(slot);
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.419, 0.003, 0.039), metal);
    rail.position.copy(slot.position); rail.position.y += 0.002; rail.quaternion.copy(slot.quaternion);
    machine.add(rail); rails.push(rail);
    const button = cylinder(0.0045, 0.002, light, lid, 0.015);
    button.position.x = Math.sin(pos * Math.PI / 2) * 0.059;
    button.position.z = Math.cos(pos * Math.PI / 2) * 0.059;
  }
  const takeMarker = new THREE.Group();
  const markerBorder = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.033, 0.044, 0.041)),
    new THREE.LineBasicMaterial({ color: '#edcd77' }));
  markerBorder.position.y = 0.022; takeMarker.add(markerBorder);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.020, 4), trim);
  arrow.rotation.z = Math.PI; arrow.position.y = 0.064; takeMarker.add(arrow);
  takeMarker.visible = false; scene.add(takeMarker);
  const tiles = new THREE.Group();
  scene.add(tiles);
  const rimGeometry = new THREE.BoxGeometry(1, 1, 1);
  const rimMaterials = INKS.map(color => new THREE.MeshStandardMaterial({ color, roughness: 0.5 }));
  const backParts = [];
  templates.get('tile-back').traverse(obj => {
    if (!obj.isMesh) return;
    const batch = new THREE.InstancedMesh(obj.geometry, obj.material, 160);
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    batch.castShadow = true;
    batch.receiveShadow = true;
    batch.frustumCulled = false;
    scene.add(batch);
    backParts.push({ batch, base: obj.matrixWorld.clone() });
  });
  const entries = new Map(), dummy = new THREE.Object3D(), matrix = new THREE.Matrix4();
  let machineRun = null, lastBacks = [], recycling = null;
  let snapshot = null, round = null, active = false, disposed = false, overview = false;
  let hovered = null, dirty = true, request = 0, animatedUntil = 0, lastFrame = 0, discardHint = null;
  let yaw = 0, pitch = 0.67, drag = null, width = 0, height = 0;
  const projected = new Map();
  const bounds = new THREE.Box3(), corners = Array.from({ length: 8 }, () => new THREE.Vector3());

  function cameraPose() {
    const aspect = width / Math.max(1, height);
    const distance = aspect < 1 ? 1.48 / Math.max(0.56, aspect) : 1.45;
    const angle = overview ? 1.30 : pitch;
    camera.position.set(Math.sin(yaw) * Math.cos(angle) * distance, TOP + Math.sin(angle) * distance,
      0.025 + Math.cos(yaw) * Math.cos(angle) * distance);
    camera.lookAt(0, TOP, 0.025);
    camera.updateMatrixWorld();
  }
  function resize() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width; height = rect.height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    cameraPose();
    dirty = true;
    if (active) schedule();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  function animate(entry, target, quaternion, duration = 180, arc = 0) {
    const now = performance.now();
    if (reduceMotion || duration === 0) {
      entry.object.position.copy(target); entry.object.quaternion.copy(quaternion); entry.tween = null;
    } else {
      entry.tween = { start: now, duration, from: entry.object.position.clone(), to: target.clone(),
        q0: entry.object.quaternion.clone(), q1: quaternion.clone(), arc };
      animatedUntil = Math.max(animatedUntil, now + duration + 40);
    }
    dirty = true;
  }
  function piece(key, id, position, quaternion, scale, type, extra, initial) {
    let entry = entries.get(key);
    if (!entry) {
      let object = templates.get(id).clone(true);
      if (id === 'dice') {
        const pivot = new THREE.Group(); object.position.y -= 0.008; pivot.add(object); object = pivot;
      }
      object.scale.setScalar(scale);
      object.position.copy(position);
      object.quaternion.copy(quaternion);
      tiles.add(object);
      entry = { object, type, ...extra, base: position.clone(), q: quaternion.clone(), liftTarget: position.clone() };
      entries.set(key, entry);
      if (!initial && type === 'river') {
        const hint = discardHint && discardHint.kind === extra.kind && extra.pos === 0 && performance.now() - discardHint.time < 2500;
        object.position.copy(hint ? discardHint.position : turn(extra.pos, 0, 0.35, TOP + 0.055));
        object.quaternion.copy(hint ? discardHint.quaternion : rotation(extra.pos, 1.15));
        animate(entry, position, quaternion, 420, 0.07);
        if (hint) discardHint = null;
      } else if (!initial && type === 'hand') {
        const draws = snapshot?.wallDraws, wall = snapshot ? physicalWall(snapshot) : null;
        const slot = wall && draws ? wall[clamp(snapshot.gangDraw ? 102 - draws.tail : draws.head - 1, 0, 107)] : null;
        object.position.copy(slot ? slot.position : turn(0, 0.17, 0.26, TOP + 0.045));
        object.quaternion.copy(slot ? slot.rotation : rotation(0));
        animate(entry, position, quaternion, 330, 0.045);
      }
    } else if (entry.base.distanceToSquared(position) > 1e-10 || entry.q.angleTo(quaternion) > 0.001) {
      animate(entry, position, quaternion);
    }
    entry.base.copy(position); entry.q.copy(quaternion);
    Object.assign(entry, extra);
    return entry;
  }

  function paintBacks(transforms) {
    lastBacks = transforms;
    backParts.forEach(({ batch, base }) => {
      batch.count = Math.min(transforms.length, 160);
      transforms.slice(0, 160).forEach((pose, i) => {
        dummy.position.copy(pose.position); dummy.quaternion.copy(pose.rotation); dummy.scale.setScalar(pose.scale);
        dummy.updateMatrix();
        matrix.copy(dummy.matrix).multiply(base);
        batch.setMatrixAt(i, matrix);
      });
      batch.instanceMatrix.needsUpdate = true;
    });
  }
  function updateHover() {
    if (machineRun) return;
    for (const entry of entries.values()) {
      if (entry.type !== 'hand') continue;
      const lifted = entry.chosen || entry.id === hovered;
      const next = entry.base.clone();
      if (lifted) { next.y += entry.chosen ? 0.016 : 0.009; next.z -= entry.chosen ? 0.015 : 0.006; }
      if (!entry.liftTarget || entry.liftTarget.distanceToSquared(next) > 1e-10) {
        entry.liftTarget = next;
        animate(entry, next, entry.q, 150);
      }
    }
    schedule();
  }

  function diceQuaternion(number, yaw = 0) {
    const normals = [null, [0, 1, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [0, -1, 0]];
    return rotation(0).setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normals[number || 1]), new THREE.Vector3(0, 1, 0)));
  }
  function physicalWall(next) {
    const result = [], opening = next.opening;
    for (const seat of [0, 3, 2, 1]) {
      const pos = (seat + (opening?.seatOffset || 0)) % 4, count = seat % 2 ? 13 : 14;
      for (let column = 0; column < count; column++) for (let layer = 0; layer < 2; layer++) result.push({
        // 每家从右向左数墩；每墩先上后下。
        position: turn(pos, ((count - 1) / 2 - column) * 0.027, 0.264, TOP + (1 - layer) * 0.018),
        rotation: rotation(pos), scale: 0.98
      });
    }
    const start = opening?.startSlot || 0;
    return result.slice(start).concat(result.slice(0, start));
  }
  function wallRemainder(next) {
    const wall = physicalWall(next), draws = next.wallDraws;
    const head = draws ? draws.head : 102 - Math.max(0, next.wallCount || 0);
    const tail = draws ? draws.tail : 0;
    return wall.slice(head, 102 - tail).concat(next.over ? [] : wall.slice(102));
  }
  function riverPosition(index) {
    // 中间给骰盘留出空位，弃牌仍按先后顺序逐格累积。
    let cell = -1;
    for (let row = 0; row < 8; row++) for (let col = 0; col < 12; col++) {
      if (row >= 2 && row <= 5 && col >= 3 && col <= 8) continue;
      if (++cell === index) return new THREE.Vector3((col - 5.5) * 0.032, TOP + 0.0016, (row - 3.5) * 0.041);
    }
    return new THREE.Vector3((index % 12 - 5.5) * 0.032, TOP + 0.0016, 0.185 + Math.floor((index - 72) / 12) * 0.041);
  }
  function update(next) {
    if (disposed) return;
    const changed = round !== next.round, hadRound = round !== null;
    if (changed && machineRun) finishMachine();
    if (changed && !reduceMotion && next.opening && (hadRound || next.turnCount <= 1 || next.openingAgeMs < 12000)) {
      beginMachine(next, hadRound); return;
    }
    if (machineRun) { snapshot = next; return; }
    applySnapshot(next);
  }
  function applySnapshot(next) {
    snapshot = next;
    const initial = round !== next.round;
    if (initial) {
      for (const entry of entries.values()) tiles.remove(entry.object);
      entries.clear(); projected.clear(); hovered = null; discardHint = null; round = next.round;
    }
    const wanted = new Set(), hidden = [];
    const own = next.seats.find(seat => seat.isMe);
    for (const seat of next.seats) {
      if (seat.isMe) {
        const scale = 1.85, step = 0.050, tilt = overview ? 0.20 : 1.15;
        const gap = seat.hand.some(t => t.drawn) ? 0.014 : 0;
        const span = (seat.hand.length - 1) * step + gap;
        seat.hand.forEach((tile, index) => {
          const x = index * step - span / 2 + (tile.drawn ? gap : 0);
          const z = 0.357 + Math.pow(x / 0.38, 2) * 0.011;
          const position = new THREE.Vector3(x, TOP + 0.034 * scale / 2 * Math.sin(tilt), z);
          const key = 'hand:' + tile.id;
          piece(key, modelId(tile.kind), position, rotation(0, tilt), scale, 'hand',
            { id: tile.id, kind: tile.kind, chosen: tile.chosen }, initial);
          wanted.add(key);
        });
      } else {
        for (let i = 0; i < Math.min(seat.count, 14); i++) hidden.push({
          position: turn(seat.pos, (i - (seat.count - 1) / 2) * 0.030, 0.364, TOP + 0.020),
          rotation: rotation(seat.pos, -1.35), scale: 1.16
        });
      }
      seat.melds.forEach((meld, m) => {
        for (let n = 0; n < (meld.type === 'gang' ? 4 : 3); n++) {
          const stacked = n === 3, x = -0.365 + m * 0.110 + (stacked ? 1 : n) * 0.031;
          const key = 'meld:' + seat.pos + ':' + m + ':' + n;
          piece(key, modelId(meld.kind), turn(seat.pos, x, 0.294, TOP + (stacked ? 0.020 : 0)),
            rotation(seat.pos), 1.12, 'meld', {}, initial);
          wanted.add(key);
        }
      });
    }
    hidden.push(...wallRemainder(next));
    paintBacks(hidden);
    next.river.forEach((tile, index) => {
      const key = 'river:' + tile.order, scale = 1.08;
      const position = riverPosition(index);
      const entry = piece(key, modelId(tile.kind), position, rotation(0), scale, 'river', { kind: tile.kind, pos: tile.pos }, initial);
      if (next.sources && !entry.rim) {
        entry.rim = new THREE.Mesh(rimGeometry, rimMaterials[tile.pos]);
        entry.rim.scale.set(0.0283, 0.0013, 0.0363);
        entry.rim.position.set(0, -0.0004, 0);
        entry.object.add(entry.rim);
      }
      if (entry.rim) entry.rim.visible = !!next.sources;
      wanted.add(key);
    });
    piece('dealer', 'dealer-marker', turn(next.dealer, 0.29, 0.322), rotation(0), 0.65, 'prop', {}, true);
    wanted.add('dealer');
    for (let i = 0; i < 2; i++) {
      const key = 'dice:' + i;
      piece(key, 'dice', new THREE.Vector3(i ? 0.019 : -0.019, TOP + 0.027, i ? 0.008 : -0.008),
        diceQuaternion(next.opening?.dice[i] || 1, i ? 0.3 : -0.25), 1.4, 'prop', {}, true);
      wanted.add(key);
    }
    for (const [key, entry] of entries) if (!wanted.has(key)) { tiles.remove(entry.object); entries.delete(key); }
    if (!own?.hand.some(t => t.id === hovered)) hovered = null;
    host.dataset.handCount = String(own?.hand.length || 0);
    host.dataset.riverCount = String(next.river.length);
    host.dataset.hiddenCount = String(next.seats.filter(s => !s.isMe).reduce((n, s) => n + s.count, 0));
    host.dataset.round = String(next.round);
    host.dataset.dice = (next.opening?.dice || []).join(',');
    host.dataset.wallTiles = String(wallRemainder(next).length);
    if (!machineRun) { host.dataset.machinePhase = 'ready'; callbacks.onMachine?.('ready', next.opening); }
    updateHover(); dirty = true; schedule();
  }

  function beginMachine(next, collect) {
    const old = [], backs = lastBacks.map(p => ({ ...p, position: p.position.clone(), rotation: p.rotation.clone() }));
    recycling = new THREE.Group(); scene.add(recycling);
    if (collect) for (const entry of entries.values()) if (entry.type !== 'prop') {
      const clone = entry.object.clone(true); recycling.add(clone);
      old.push({ object: clone, position: clone.position.clone(), quaternion: clone.quaternion.clone() });
    }
    applySnapshot(next);
    const packets = [], order = Array.from({ length: 4 }, (_, i) => (next.dealer + i) % 4);
    for (let r = 0; r < 3; r++) for (const pos of order) packets.push({ pos, count: 4, duration: 240 });
    for (const pos of order) packets.push({ pos, count: 1, duration: 170 });
    packets.push({ pos: next.dealer, count: 1, duration: 170 });
    machineRun = { elapsed: 0, lastTime: null, collect: collect ? 950 : 0, old, backs, packets,
      wall: physicalWall(next), opening: next.opening, phase: '', counts: [0, 0, 0, 0] };
    for (const entry of entries.values()) if (entry.type !== 'prop') entry.object.visible = false;
    host.dataset.machineBusy = '1';
    host.dataset.dealCounts = '0,0,0,0';
    callbacks.onProject?.([]); callbacks.onBusy?.(true);
    dirty = true; schedule();
  }
  function finishMachine(notify = true) {
    if (!machineRun) return;
    machineRun = null;
    if (recycling) { scene.remove(recycling); recycling = null; }
    lid.position.y = 0; takeMarker.visible = false;
    rails.forEach(r => { r.position.y = 0.003; });
    for (const entry of entries.values()) entry.object.visible = true;
    host.dataset.machineBusy = '0'; host.dataset.machinePhase = 'ready';
    // 重新应用最新服务端局面，演出期间不倒放已经收到的行动。
    if (snapshot) applySnapshot(snapshot);
    if (notify) callbacks.onBusy?.(false);
  }
  function frameMachine(now) {
    const run = machineRun;
    if (!run) return;
    // 首次 shader 编译或后台恢复不能吞掉整段升墙／掷骰动画。
    if (run.lastTime !== null) run.elapsed += Math.min(64, Math.max(0, now - run.lastTime));
    run.lastTime = now;
    let t = run.elapsed, phase, p;
    const ease = n => 1 - Math.pow(1 - clamp(n, 0, 1), 3);
    if (t < run.collect) { phase = 'collect'; p = t / run.collect; }
    else if ((t -= run.collect) < 550) { phase = 'shuffle'; p = t / 550; }
    else if ((t -= 550) < 850) { phase = 'lift'; p = t / 850; }
    else if ((t -= 850) < 1250) { phase = 'dice'; p = t / 1250; }
    else { t -= 1250; phase = 'deal'; p = t; }
    if (phase !== run.phase) {
      run.phase = phase; host.dataset.machinePhase = phase;
      callbacks.onMachine?.(phase, run.opening, [0, 0, 0, 0]);
    }
    lid.position.y = phase === 'collect' ? 0.105 * Math.sin(Math.min(p * 2, 1) * Math.PI / 2)
      : phase === 'shuffle' ? 0.105 : phase === 'lift' ? 0.105 * (1 - ease(p)) : 0;
    const diceEntries = [entries.get('dice:0'), entries.get('dice:1')];
    diceEntries.forEach((entry, i) => {
      if (!entry) return;
      entry.tween = null;
      const target = diceQuaternion(run.opening.dice[i], i ? 0.3 : -0.25);
      entry.object.position.copy(entry.base); entry.object.position.y += lid.position.y;
      if (phase === 'dice' && p < 0.83) {
        const f = p / 0.83, spin = new THREE.Quaternion().setFromEuler(new THREE.Euler(8 + i * 3, 11, 6));
        spin.slerp(target, ease(f)); entry.object.quaternion.copy(spin);
        entry.object.position.y += Math.abs(Math.sin(f * Math.PI * 3)) * 0.042 * (1 - f);
      } else entry.object.quaternion.copy(target);
    });
    takeMarker.visible = phase === 'dice' || phase === 'deal';
    if (phase === 'collect') {
      const move = (origin, index) => {
        const f = ease((p - (index % 11) * 0.018) / 0.80), a = index * 2.4;
        const dest = new THREE.Vector3(Math.cos(a) * 0.014, TOP - 0.09, Math.sin(a) * 0.014);
        const point = origin.clone().lerp(dest, f); point.y += Math.sin(f * Math.PI) * 0.085;
        return point;
      };
      run.old.forEach((entry, i) => { entry.object.position.copy(move(entry.position, i)); entry.object.rotateY(0.045); });
      paintBacks(run.backs.map((pose, i) => ({ ...pose, position: move(pose.position, i + run.old.length) })));
    } else {
      if (recycling) recycling.visible = false;
      if (phase === 'shuffle') {
        paintBacks(Array.from({ length: 14 }, (_, i) => ({
          position: new THREE.Vector3(Math.sin(now * 0.003 + i * 1.6) * 0.042, TOP - 0.006 + (i % 2) * 0.009, Math.cos(now * 0.003 + i * 1.6) * 0.042),
          rotation: rotation(0, i * 0.12), scale: 0.85
        })));
      } else if (phase === 'lift' || phase === 'dice') {
        const f = phase === 'lift' ? ease(p) : 1;
        rails.forEach(r => { r.position.y = 0.003 - 0.04 * (1 - f); });
        paintBacks(run.wall.map(pose => ({ ...pose, position: pose.position.clone().add(new THREE.Vector3(0, -0.055 * (1 - f), 0)) })));
        takeMarker.position.copy(run.wall[0].position); takeMarker.position.y = TOP;
        takeMarker.quaternion.copy(run.wall[0].rotation);
      } else {
        let elapsed = p, taken = 0, flight = null;
        const counts = [0, 0, 0, 0];
        for (const packet of run.packets) {
          if (elapsed < packet.duration) { flight = { ...packet, f: elapsed / packet.duration }; break; }
          elapsed -= packet.duration; counts[packet.pos] += packet.count; taken += packet.count;
        }
        const backs = run.wall.slice(taken + (flight ? flight.count : 0));
        for (let pos = 0; pos < 4; pos++) for (let i = 0; i < counts[pos]; i++) {
          const me = pos === 0, scale = me ? 1.85 : 1.16;
          backs.push({ position: turn(pos, (i - 6) * (me ? 0.050 : 0.030), 0.357, TOP + (me ? 0.030 : 0.020)),
            rotation: rotation(pos, me ? 1.15 : -1.35), scale });
        }
        if (flight) for (let i = 0; i < flight.count; i++) {
          const src = run.wall[taken + i], me = flight.pos === 0, f = ease(flight.f);
          const dest = turn(flight.pos, (counts[flight.pos] + i - 6) * (me ? 0.050 : 0.030), 0.357, TOP + (me ? 0.030 : 0.020));
          const position = src.position.clone().lerp(dest, f); position.y += Math.sin(Math.PI * f) * 0.060;
          backs.push({ position, rotation: src.rotation.clone().slerp(rotation(flight.pos, me ? 1.15 : -1.35), f), scale: 0.98 + ((me ? 1.85 : 1.16) - 0.98) * f });
        }
        paintBacks(backs);
        takeMarker.position.copy(run.wall[Math.min(taken, 107)].position);
        takeMarker.position.y = TOP;
        takeMarker.quaternion.copy(run.wall[Math.min(taken, 107)].rotation);
        if (counts.join(',') !== run.counts.join(',')) {
          run.counts = counts; host.dataset.dealCounts = counts.join(',');
          callbacks.onMachine?.('deal', run.opening, counts);
        }
        if (!flight && elapsed > 320) { finishMachine(); return; }
      }
    }
    dirty = true;
  }

  function projectHand() {
    if (machineRun) { callbacks.onProject?.([]); return; }
    const result = [];
    for (const entry of entries.values()) {
      if (entry.type !== 'hand') continue;
      bounds.setFromObject(entry.object);
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (let i = 0; i < 8; i++) {
        const point = corners[i].set(i & 1 ? bounds.max.x : bounds.min.x,
          i & 2 ? bounds.max.y : bounds.min.y, i & 4 ? bounds.max.z : bounds.min.z).project(camera);
        const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      result.push({ id: entry.id, x: minX, y: minY, width: maxX - minX, height: maxY - minY });
    }
    callbacks.onProject?.(result);
  }
  function frame(now) {
    request = 0;
    if (!active || disposed || document.hidden) return;
    if (now - lastFrame >= 15 && (dirty || machineRun || now < animatedUntil)) {
      frameMachine(now);
      for (const entry of entries.values()) if (entry.tween) {
        const t = entry.tween, f = clamp((now - t.start) / t.duration, 0, 1), eased = 1 - Math.pow(1 - f, 3);
        entry.object.position.lerpVectors(t.from, t.to, eased);
        entry.object.position.y += Math.sin(Math.PI * f) * t.arc;
        entry.object.quaternion.slerpQuaternions(t.q0, t.q1, eased);
        if (f === 1) entry.tween = null;
      }
      scene.updateMatrixWorld();
      renderer.render(scene, camera);
      projectHand();
      host.dataset.viewport = Math.round(width) + 'x' + Math.round(height);
      host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.triangles = String(renderer.info.render.triangles);
      lastFrame = now; dirty = false;
    }
    if (dirty || machineRun || now < animatedUntil) schedule();
  }
  function schedule() { if (active && !disposed && !document.hidden && !request) request = requestAnimationFrame(frame); }
  function setActive(value) {
    active = !!value;
    if (!active && request) { cancelAnimationFrame(request); request = 0; }
    if (active) { resize(); dirty = true; schedule(); }
  }
  function setView(value) {
    overview = value === 'overhead'; yaw = 0; pitch = 0.67;
    host.dataset.view = overview ? 'overhead' : 'seated';
    cameraPose();
    if (snapshot) update(snapshot);
    dirty = true; schedule();
  }
  function pointerDown(event) {
    if (!active || event.target !== renderer.domElement || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, yaw, pitch };
    renderer.domElement.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!drag || overview) return;
    yaw = clamp(drag.yaw - (event.clientX - drag.x) * 0.0025, -0.32, 0.32);
    pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.002, 0.53, 0.92);
    cameraPose(); dirty = true; schedule();
  }
  function pointerUp() { drag = null; }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('pointercancel', pointerUp);
  renderer.domElement.addEventListener('webglcontextlost', event => {
    event.preventDefault(); setActive(false); callbacks.onError?.(Error('图形上下文已中断'));
  });
  function visibility() { if (!document.hidden) { dirty = true; schedule(); } }
  document.addEventListener('visibilitychange', visibility);
  resize();
  host.dataset.phase = 'ready';
  host.dataset.view = 'seated';
  return {
    update, setActive, setView, skipOpening: finishMachine,
    hover(id) { if (hovered !== id) { hovered = id; updateHover(); } },
    noteDiscard(id) {
      const entry = entries.get('hand:' + id);
      if (entry) discardHint = { kind: entry.kind, position: entry.object.position.clone(), quaternion: entry.object.quaternion.clone(), time: performance.now() };
    },
    dispose() {
      disposed = true; setActive(false); observer.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(obj => { if (obj.geometry) geometries.add(obj.geometry); if (obj.material) (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach(m => materials.add(m)); });
      materials.forEach(m => { for (const value of Object.values(m)) if (value?.isTexture) textures.add(value); m.dispose(); });
      geometries.forEach(g => g.dispose()); textures.forEach(t => t.dispose());
      env.dispose(); renderer.dispose(); renderer.domElement.remove(); entries.clear();
    }
  };
}
