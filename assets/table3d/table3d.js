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
const HAND_SCALE = 1.85, HAND_STEP = 0.050, HAND_Z = 0.357, HAND_TILT = 1.46;
const DICE_SCALE = 2.4, DICE_TIME = 2300;
function handPose(index, count, drawn, overhead = false) {
  const tilt = overhead ? 0.20 : HAND_TILT, gap = drawn >= 0 ? 0.014 : 0;
  return { position: new THREE.Vector3(index * HAND_STEP - ((count - 1) * HAND_STEP + gap) / 2 + (index === drawn ? gap : 0),
    TOP + 0.017 * HAND_SCALE * Math.sin(tilt), HAND_Z), rotation: rotation(0, tilt), scale: HAND_SCALE };
}
function surfaceTexture(type) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), pixels = context.createImageData(256, 256);
  let seed = 618033;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const shade = clamp(Math.round(135 + ((seed >>> 24) - 128) * (type === 'felt' ? 0.14 : 0.24)), 0, 255), i = (y * 256 + x) * 4;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade; pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 4);
  return texture;
}

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
  scene.environmentIntensity = 0.38;
  room.dispose();
  generator.dispose();
  scene.add(new THREE.HemisphereLight(0xe6e9e1, 0x17241d, 0.32));
  const keyLight = new THREE.DirectionalLight(0xffeed7, 2.7);
  keyLight.position.set(-0.85, 2.2, 0.65);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.setScalar(innerWidth < 700 ? 512 : 1024);
  Object.assign(keyLight.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.1, far: 4 });
  keyLight.shadow.bias = -0.00008;
  keyLight.shadow.normalBias = 0.00035;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xb9cfdf, 0.55); fillLight.position.set(1.3, 1.2, -0.9); scene.add(fillLight);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#101b16', roughness: 0.96 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  scene.add(floor);

  const loader = new GLTFLoader(), templates = new Map(), materialCache = new Map();
  const feltBump = surfaceTexture('felt'), railBump = surfaceTexture('rail');
  feltBump.anisotropy = railBump.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  function finishMaterial(source) {
    if (materialCache.has(source)) return materialCache.get(source);
    let material = source;
    if (/ivory resin|jade green resin/i.test(source.name)) {
      material = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(material, source);
      material.roughness = /ivory/i.test(source.name) ? 0.30 : 0.26;
      material.clearcoat = 0.18; material.clearcoatRoughness = 0.32; material.ior = 1.49;
      material.envMapIntensity = 0.7;
    } else if (/playing felt/i.test(source.name)) {
      material.color.set('#145440'); material.bumpMap = feltBump; material.bumpScale = 0.00006; material.roughness = 0.96;
    } else if (/padded rail/i.test(source.name)) {
      material.color.set('#263b32'); material.bumpMap = railBump; material.bumpScale = 0.00012; material.roughness = 0.65;
    } else if (/ink/i.test(source.name)) { material.roughness = 0.58; material.envMapIntensity = 0.25; }
    materialCache.set(source, material); return material;
  }
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
          obj.material = Array.isArray(obj.material) ? obj.material.map(finishMaterial) : finishMaterial(obj.material);
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
  const contactCanvas = document.createElement('canvas'); contactCanvas.width = contactCanvas.height = 64;
  const contactContext = contactCanvas.getContext('2d'), contactGradient = contactContext.createRadialGradient(32, 32, 3, 32, 32, 31);
  contactGradient.addColorStop(0, 'rgba(0,0,0,.72)'); contactGradient.addColorStop(1, 'rgba(0,0,0,0)');
  contactContext.fillStyle = contactGradient; contactContext.fillRect(0, 0, 64, 64);
  const contactTexture = new THREE.CanvasTexture(contactCanvas);
  const contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), 14);
  contact.count = 0; contact.frustumCulled = false; scene.add(contact);
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

  function cameraPose(focus = 0) {
    const aspect = width / Math.max(1, height);
    const normalDistance = aspect < 1 ? 1.48 / Math.max(0.56, aspect) : 1.45;
    const distance = THREE.MathUtils.lerp(normalDistance, 0.65 / Math.min(1, Math.max(0.7, aspect)), focus);
    const angle = THREE.MathUtils.lerp(overview ? 1.30 : pitch, 1.08, focus), heading = yaw * (1 - focus);
    camera.position.set(Math.sin(heading) * Math.cos(angle) * distance, TOP + Math.sin(angle) * distance,
      0.025 * (1 - focus) + Math.cos(heading) * Math.cos(angle) * distance);
    camera.lookAt(0, TOP + 0.022 * focus, 0.025 * (1 - focus));
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
  function paintContacts(poses) {
    contact.count = Math.min(poses.length, 14);
    poses.slice(0, 14).forEach((pose, i) => {
      dummy.position.set(pose.position.x, TOP + 0.0006, pose.position.z);
      dummy.quaternion.identity(); dummy.scale.set(0.058, 1, overview ? 0.078 : 0.042);
      dummy.updateMatrix(); contact.setMatrixAt(i, dummy.matrix);
    });
    contact.instanceMatrix.needsUpdate = true;
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
    contact.count = 0;
    const own = next.seats.find(seat => seat.isMe);
    for (const seat of next.seats) {
      if (seat.isMe) {
        const drawn = seat.hand.findIndex(t => t.drawn), contacts = [];
        seat.hand.forEach((tile, index) => {
          const pose = handPose(index, seat.hand.length, drawn, overview);
          const key = 'hand:' + tile.id;
          piece(key, modelId(tile.kind), pose.position, pose.rotation, pose.scale, 'hand',
            { id: tile.id, kind: tile.kind, chosen: tile.chosen }, initial);
          contacts.push(pose);
          wanted.add(key);
        });
        paintContacts(contacts);
      } else {
        for (let i = 0; i < Math.min(seat.count, 14); i++) hidden.push({
          position: turn(seat.pos, (i - (seat.count - 1) / 2) * 0.030, 0.364, TOP + 0.020),
          rotation: rotation(seat.pos, -HAND_TILT), scale: 1.16
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
      piece(key, 'dice', new THREE.Vector3(i ? 0.025 : -0.025, TOP + 0.0345, i ? 0.006 : -0.006),
        diceQuaternion(next.opening?.dice[i] || 1, i ? 0.3 : -0.25), DICE_SCALE, 'prop', {}, true);
      wanted.add(key);
    }
    for (const [key, entry] of entries) if (!wanted.has(key)) { tiles.remove(entry.object); entries.delete(key); }
    if (!own?.hand.some(t => t.id === hovered)) hovered = null;
    host.dataset.handCount = String(own?.hand.length || 0);
    host.dataset.riverCount = String(next.river.length);
    host.dataset.hiddenCount = String(next.seats.filter(s => !s.isMe).reduce((n, s) => n + s.count, 0));
    host.dataset.round = String(next.round);
    host.dataset.dice = (next.opening?.dice || []).join(',');
    host.dataset.diceScale = String(DICE_SCALE);
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
    let packets;
    if (next.dealPlan) packets = next.dealPlan.map(p => ({ ...p, count: p.slots.length, duration: p.slots.length === 4 ? 360 : 340 }));
    else {
      packets = []; let cursor = 0;
      const order = Array.from({ length: 4 }, (_, i) => (next.dealer + i) % 4);
      for (let r = 0; r < 3; r++) for (const pos of order) { packets.push({ pos, count: 4, slots: [cursor, cursor + 1, cursor + 2, cursor + 3], duration: 360 }); cursor += 4; }
      for (const pos of order) packets.push({ pos, count: 1, slots: [cursor++], duration: 340 });
      packets.push({ pos: next.dealer, count: 1, slots: [cursor], duration: 340 });
    }
    const faceGroup = new THREE.Group(), faces = [], ownSlots = packets.filter(p => p.pos === 0).flatMap(p => p.slots);
    const ownSeat = next.seats.find(s => s.isMe), kinds = next.dealtKinds?.length ? next.dealtKinds : (ownSeat?.hand || []).map(t => t.kind);
    scene.add(faceGroup);
    ownSlots.forEach((slot, index) => {
      if (!Number.isInteger(kinds[index])) return;
      const object = templates.get(modelId(kinds[index])).clone(true);
      object.visible = false; faceGroup.add(object); faces.push({ slot, index, kind: kinds[index], object });
    });
    machineRun = { elapsed: 0, lastTime: null, collect: collect ? 950 : 0, old, backs, packets,
      wall: physicalWall(next), opening: next.opening, phase: '', counts: [0, 0, 0, 0],
      faceGroup, faces, bySlot: new Map(faces.map(f => [f.slot, f])), lastPacket: -1, focus: 0, settled: null };
    contact.count = 0;
    for (const entry of entries.values()) if (entry.type !== 'prop') entry.object.visible = false;
    host.dataset.machineBusy = '1';
    host.dataset.dealCounts = '0,0,0,0';
    host.dataset.dealFaceCount = '0';
    callbacks.onProject?.([]); callbacks.onBusy?.(true);
    dirty = true; schedule();
  }
  function finishMachine(notify = true) {
    if (!machineRun) return;
    const run = machineRun;
    machineRun = null;
    if (recycling) { scene.remove(recycling); recycling = null; }
    lid.position.y = 0; takeMarker.visible = false;
    cameraPose(); callbacks.onDice?.(false, true, run.opening.dice);
    rails.forEach(r => { r.position.y = 0.003; });
    for (const entry of entries.values()) entry.object.visible = true;
    host.dataset.machineBusy = '0'; host.dataset.machinePhase = 'ready';
    // 重新应用最新服务端局面，演出期间不倒放已经收到的行动。
    if (snapshot) applySnapshot(snapshot);
    if (run.faces.some(f => f.object.visible)) {
      const queues = new Map();
      run.faces.filter(f => f.object.visible).forEach(f => { if (!queues.has(f.kind)) queues.set(f.kind, []); queues.get(f.kind).push(f); });
      for (const entry of entries.values()) if (entry.type === 'hand') {
        const face = queues.get(entry.kind)?.shift();
        if (face?.object.visible) {
          entry.object.position.copy(face.object.position); entry.object.quaternion.copy(face.object.quaternion);
          animate(entry, entry.base, entry.q, 300);
        }
      }
    }
    scene.remove(run.faceGroup);
    if (notify) callbacks.onBusy?.(false);
  }
  function frameMachine(now) {
    const run = machineRun;
    if (!run) return;
    // 首次 shader 编译或后台恢复不能吞掉整段升墙／掷骰动画。
    if (run.lastTime !== null) run.elapsed += Math.min(100, Math.max(0, now - run.lastTime));
    run.lastTime = now;
    let t = run.elapsed, phase, p;
    const ease = n => 1 - Math.pow(1 - clamp(n, 0, 1), 3);
    if (t < run.collect) { phase = 'collect'; p = t / run.collect; }
    else if ((t -= run.collect) < 550) { phase = 'shuffle'; p = t / 550; }
    else if ((t -= 550) < 850) { phase = 'lift'; p = t / 850; }
    else if ((t -= 850) < DICE_TIME) { phase = 'dice'; p = t / DICE_TIME; }
    else { t -= DICE_TIME; phase = 'deal'; p = t; }
    if (phase !== run.phase) {
      run.phase = phase; host.dataset.machinePhase = phase;
      callbacks.onMachine?.(phase, run.opening, [0, 0, 0, 0]);
    }
    const smooth = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
    const focus = phase === 'dice' ? smooth(p / 0.18) * (1 - smooth((p - 0.82) / 0.18)) : 0;
    if (focus !== run.focus) { run.focus = focus; cameraPose(focus); }
    host.dataset.diceFocus = focus.toFixed(2);
    const settled = phase !== 'dice' || p >= 0.62, diceState = (phase === 'dice') + ':' + settled;
    if (diceState !== run.settled) { run.settled = diceState; callbacks.onDice?.(phase === 'dice', settled, run.opening.dice); }
    run.faces.forEach(f => { f.object.visible = false; });
    lid.position.y = phase === 'collect' ? 0.105 * Math.sin(Math.min(p * 2, 1) * Math.PI / 2)
      : phase === 'shuffle' ? 0.105 : phase === 'lift' ? 0.105 * (1 - ease(p)) : 0;
    const diceEntries = [entries.get('dice:0'), entries.get('dice:1')];
    diceEntries.forEach((entry, i) => {
      if (!entry) return;
      entry.tween = null;
      const target = diceQuaternion(run.opening.dice[i], i ? 0.3 : -0.25);
      entry.object.position.copy(entry.base); entry.object.position.y += lid.position.y;
      if (phase === 'dice' && p < 0.62) {
        const f = p / 0.62, motion = Math.pow(1 - f, 2);
        const spin = new THREE.Quaternion().setFromEuler(new THREE.Euler((10 * Math.PI + i) * motion, 8 * Math.PI * motion, 6 * Math.PI * motion));
        entry.object.quaternion.copy(spin.multiply(target));
        entry.object.position.x += Math.cos(f * Math.PI * 6 + i) * 0.006 * (1 - f);
        entry.object.position.z += Math.sin(f * Math.PI * 4 + i) * 0.009 * (1 - f);
        entry.object.position.y += Math.abs(Math.sin(f * Math.PI * 4)) * 0.032 * (1 - f);
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
        let elapsed = p, flight = null, packetIndex = 0;
        const counts = [0, 0, 0, 0], taken = new Set(), arrived = new Set();
        for (const packet of run.packets) {
          if (elapsed < packet.duration) { flight = { ...packet, f: elapsed / packet.duration }; break; }
          elapsed -= packet.duration; counts[packet.pos] += packet.count;
          packet.slots.forEach(slot => { taken.add(slot); arrived.add(slot); }); packetIndex++;
        }
        flight?.slots.forEach(slot => taken.add(slot));
        const backs = run.wall.filter((pose, index) => !taken.has(index)), ownContacts = [];
        for (let pos = 1; pos < 4; pos++) for (let i = 0; i < counts[pos]; i++) {
          const targetCount = 13 + (pos === snapshot.dealer ? 1 : 0);
          backs.push({ position: turn(pos, (i - (targetCount - 1) / 2) * 0.030, HAND_Z, TOP + 0.020),
            rotation: rotation(pos, -HAND_TILT), scale: 1.16 });
        }
        for (const face of run.faces) if (arrived.has(face.slot)) {
          const pose = handPose(face.index, run.faces.length, run.faces.length === 14 ? 13 : -1, overview);
          face.object.visible = true; face.object.position.copy(pose.position);
          face.object.quaternion.copy(pose.rotation); face.object.scale.setScalar(pose.scale); ownContacts.push(pose);
        }
        if (flight) for (let i = 0; i < flight.count; i++) {
          const slot = flight.slots[i], src = run.wall[slot], me = flight.pos === 0, f = ease(flight.f);
          if (me && run.bySlot.has(slot)) {
            const face = run.bySlot.get(slot), dest = handPose(face.index, run.faces.length, run.faces.length === 14 ? 13 : -1, overview);
            const scale = THREE.MathUtils.lerp(0.98, HAND_SCALE, f);
            const faceDown = src.rotation.clone().multiply(rotation(0, Math.PI));
            const quaternion = faceDown.slerp(dest.rotation, ease(clamp((flight.f - 0.05) / 0.50, 0, 1)));
            const sourceCenter = src.position.clone().add(new THREE.Vector3(0, 0.009 * 0.98, 0));
            const destCenter = dest.position.clone().add(new THREE.Vector3(0, 0.009 * HAND_SCALE, 0).applyQuaternion(dest.rotation));
            const center = sourceCenter.lerp(destCenter, f); center.y += Math.sin(Math.PI * f) * 0.060;
            face.object.position.copy(center.sub(new THREE.Vector3(0, 0.009 * scale, 0).applyQuaternion(quaternion)));
            face.object.quaternion.copy(quaternion); face.object.scale.setScalar(scale); face.object.visible = true;
          } else {
            const targetCount = 13 + (flight.pos === snapshot.dealer ? 1 : 0);
            const dest = turn(flight.pos, (counts[flight.pos] + i - (targetCount - 1) / 2) * 0.030, HAND_Z, TOP + 0.020);
            const position = src.position.clone().lerp(dest, f); position.y += Math.sin(Math.PI * f) * 0.060;
            backs.push({ position, rotation: src.rotation.clone().slerp(rotation(flight.pos, -HAND_TILT), f), scale: THREE.MathUtils.lerp(0.98, 1.16, f) });
          }
        }
        paintBacks(backs); paintContacts(ownContacts);
        host.dataset.dealFaceCount = String(run.faces.filter(f => f.object.visible).length);
        const nextSlot = flight?.slots[0] ?? run.wall.findIndex((pose, index) => !taken.has(index));
        takeMarker.position.copy(run.wall[Math.max(0, nextSlot)].position);
        takeMarker.position.y = TOP;
        takeMarker.quaternion.copy(run.wall[Math.max(0, nextSlot)].rotation);
        if (counts.join(',') !== run.counts.join(',')) {
          run.counts = counts; host.dataset.dealCounts = counts.join(',');
          callbacks.onMachine?.('deal', run.opening, counts);
        }
        if (flight && packetIndex !== run.lastPacket) {
          run.lastPacket = packetIndex; host.dataset.dealSlots = flight.slots.join(','); host.dataset.dealJump = flight.jump ? '1' : '0';
          callbacks.onPacket?.(flight.pos, !!flight.jump, flight.slots);
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
      result.push({ id: entry.id, x: minX, y: minY, width: maxX - minX, height: maxY - minY,
        worldX: entry.base.x, worldZ: entry.base.z });
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
