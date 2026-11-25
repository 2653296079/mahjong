import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/GLTFLoader.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { createCompanions } from './companions.js?build=v64';

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
const HAND_SCALE = 2.25, HAND_STEP = 0.060, HAND_Z = 0.357, HAND_TILT = 1.46;
const DICE_SCALE = 2.4, DICE_TIME = 2300;
function isRiverDragTarget(drag, insert) {
  if (!drag || insert) return false;
  const { x, z } = drag.hit;
  return Math.abs(x) <= 0.24 && z >= -0.22 && z < 0.25;
}
// 前 80% 完成飞行，触桌后以毫米级回弹收尾。
function tileMotion(f, landing) {
  const p = Math.min(1, f / (landing ? 0.8 : 1));
  return { travel: p * p * (3 - 2 * p),
    lift: landing && f >= 0.8 ? Math.sin((f - 0.8) / 0.2 * Math.PI) * 0.0025 : 0 };
}
function handPose(index, count, drawn, overhead = false) {
  const tilt = overhead ? 0.20 : HAND_TILT, gap = drawn >= 0 ? 0.014 : 0;
  return { position: new THREE.Vector3(index * HAND_STEP - ((count - 1) * HAND_STEP + gap) / 2 + (index === drawn ? gap : 0),
    TOP + 0.017 * HAND_SCALE * Math.sin(tilt), HAND_Z), rotation: rotation(0, tilt), scale: HAND_SCALE };
}
function surfaceTexture(document, type) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
  const context = canvas.getContext('2d'), pixels = context.createImageData(256, 256);
  let seed = 618033;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const grain = type === 'rail' ? 13 * Math.sin(y * 0.48 + 1.8 * Math.sin(x / 51)) : 0;
    const shade = clamp(Math.round(135 + grain + ((seed >>> 24) - 128) * (type === 'felt' ? 0.14 : 0.24)), 0, 255), i = (y * 256 + x) * 4;
    if (type === 'walnut') {
      const vein = Math.sin(y * 0.59 + 2.3 * Math.sin(x * Math.PI / 128) + 1.2 * Math.sin(y * 0.12));
      const value = shade * 0.14 + vein * 8;
      pixels.data[i] = 79 + value; pixels.data[i + 1] = 53 + value; pixels.data[i + 2] = 35 + value;
    } else {
      pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = shade;
    }
    pixels.data[i + 3] = 255;
  }
  context.putImageData(pixels, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(4, 4);
  return texture;
}

async function downloadModel(url, id, controller) {
  const { signal } = controller;
  let timer;
  function expectProgress() {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const error = Error('三维模型下载停滞：' + id);
      error.code = 'MODEL_TIMEOUT';
      controller.abort(error);
    }, 25000);
  }
  try {
    expectProgress();
    const response = await fetch(url, { signal });
    if (!response.ok) throw Error('模型读取失败：' + id + ' (HTTP ' + response.status + ')');
    expectProgress();
    if (!response.body) return await response.arrayBuffer();
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value.byteLength) continue;
        expectProgress();
        chunks.push(value);
        size += value.byteLength;
      }
    } finally { reader.releaseLock(); }
    const data = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { data.set(chunk, offset); offset += chunk.byteLength; }
    return data.buffer;
  } catch (error) {
    throw signal.aborted ? signal.reason : error;
  } finally { clearTimeout(timer); }
}

function collectSceneResources(root, resources) {
  root.traverse(obj => {
    if (obj.geometry) resources.add(obj.geometry);
    if (obj.material) for (const material of [obj.material].flat()) resources.add(material);
    if (obj.isInstancedMesh) resources.add(obj);
    if (obj.skeleton) resources.add(obj.skeleton);
    if (obj.shadow) resources.add(obj.shadow);
  });
}

function safelyDispose(dispose) {
  try { dispose(); } catch (error) { console.warn('三维资源清理失败', error); }
}
function disposeSceneResources(roots, resources) {
  const materials = new Set(), images = new Set();
  for (const root of roots) collectSceneResources(root, resources);
  for (const resource of resources) if (resource.isMaterial) materials.add(resource);
  for (const material of materials) {
    for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    resources.add(material);
  }
  for (const resource of resources) {
    if (resource.isTexture && resource.image?.close) images.add(resource.image);
    if (typeof resource.dispose === 'function') safelyDispose(() => resource.dispose());
  }
  for (const image of images) safelyDispose(() => image.close());
}

export async function createTable3D(host, callbacks = {}) {
  const controller = new AbortController();
  const cleanup = [];
  const roots = new Set(), resources = new Set();
  let disposed = false;
  const originalState = ['companions', 'cast', 'phase', 'view'].map(key => [key, host.dataset[key]]);
  function release(restoreState = false) {
    if (disposed) return;
    disposed = true;
    controller.abort();
    while (cleanup.length) safelyDispose(cleanup.pop());
    if (restoreState) for (const [key, value] of originalState) {
      if (value === undefined) delete host.dataset[key];
      else host.dataset[key] = value;
    }
  }
  try {
    const api = await initializeTable3D(host, callbacks, { controller, roots, resources, cleanup, release });
    if (disposed || controller.signal.aborted) throw controller.signal.reason || Error('3D startup was cancelled');
    return api;
  } catch (error) {
    release(true);
    throw error;
  }
}

async function initializeTable3D(host, callbacks, { controller, roots, resources, cleanup, release }) {
  const document = host.ownerDocument, viewport = document.defaultView;
  const reduceMotion = viewport.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
  cleanup.push(() => {
    renderer.domElement.remove();
    safelyDispose(() => renderer.dispose());
    safelyDispose(() => renderer.forceContextLoss());
  });
  cleanup.push(() => disposeSceneResources(roots, resources));
  let mounted = false;
  function failStage(error) {
    if (disposed) return;
    if (request) { viewport.cancelAnimationFrame(request); request = 0; }
    disposed = true;
    setActive(false);
    release();
    callbacks.onError?.(error);
  }
  function onContextLost(event) {
    event.preventDefault();
    if (controller.signal.aborted) return;
    const error = Error('图形上下文已中断');
    if (!mounted) controller.abort(error);
    else failStage(error);
  }
  renderer.domElement.addEventListener('webglcontextlost', onContextLost);
  cleanup.push(() => renderer.domElement.removeEventListener('webglcontextlost', onContextLost));
  const gl = renderer.getContext();
  const rendererInfo = gl.getExtension('WEBGL_debug_renderer_info');
  const softwareRendering = rendererInfo && /swiftshader|llvmpipe|software rasterizer/i.test(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL));
  renderer.setPixelRatio(softwareRendering ? 0.55 : Math.min(viewport.devicePixelRatio || 1, viewport.innerWidth < 700 ? 1.25 : 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !softwareRendering;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('role', 'img');
  renderer.domElement.setAttribute('aria-label', '可交互的三维麻将牌桌');
  const scene = new THREE.Scene();
  roots.add(scene);
  scene.background = new THREE.Color('#102722');
  scene.fog = new THREE.Fog('#102722', 3, 8);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.04, 12);
  const generator = new THREE.PMREMGenerator(renderer);
  try {
    const room = new RoomEnvironment();
    try {
      const env = generator.fromScene(room, 0.035);
      resources.add(env);
      scene.environment = env.texture;
      scene.environmentIntensity = 0.38;
    } finally { safelyDispose(() => room.dispose()); }
  } finally { safelyDispose(() => generator.dispose()); }
  const oldEnvironment = renderer.environment;
  scene.environment = scene.environment || oldEnvironment;
  cleanup.push(() => { scene.environment = null; renderer.environment = oldEnvironment; });
  scene.add(new THREE.HemisphereLight(0xffeed7, 0x28372c, 0.42));
  const keyLight = new THREE.DirectionalLight(0xffe7c6, 2.55);
  keyLight.position.set(-0.85, 2.2, 0.65);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.setScalar(viewport.innerWidth < 700 ? 512 : 1024);
  Object.assign(keyLight.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.1, far: 4 });
  keyLight.shadow.bias = -0.00008;
  keyLight.shadow.normalBias = 0.00035;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0xd9dfce, 0.56); fillLight.position.set(1.3, 1.2, -0.9); scene.add(fillLight);
  const floorWood = surfaceTexture(document, 'walnut');
  floorWood.colorSpace = THREE.SRGBColorSpace;
  floorWood.repeat.set(140, 140);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: '#807c6f', map: floorWood, roughness: 0.89 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  scene.add(floor);

  const templates = new Map(), materialCache = new Map();
  const stageWatchdog = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  const loader = new GLTFLoader();
  function awaitResource(promise, label, disposeLate) {
    const { signal } = controller;
    let timer, abort;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = Error('三维资源处理停滞：' + label);
        error.code = 'MODEL_TIMEOUT';
        controller.abort(error);
        reject(error);
      }, 25000);
      abort = () => reject(signal.reason);
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
    return Promise.race([Promise.resolve(promise), timeout]).finally(() => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }).catch(error => {
      Promise.resolve(promise).then(value => safelyDispose(() => disposeLate(value)), () => {});
      throw error;
    });
  }
  const feltBump = surfaceTexture(document, 'felt'), railBump = surfaceTexture(document, 'rail');
  feltBump.anisotropy = railBump.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const clothUrl = viewport.getComputedStyle(host).getPropertyValue('--room-table').trim().match(/^url\(["']?(data:image\/webp;base64,[A-Za-z0-9+/=]+)["']?\)$/);
    const clothMap = clothUrl ? await Promise.race([
      awaitResource(new THREE.TextureLoader().loadAsync(clothUrl[1]), '桌布解码', texture => texture.dispose()),
      stageWatchdog
    ]) : null;
  if (clothMap) { resources.add(clothMap); clothMap.colorSpace = THREE.SRGBColorSpace; }
  const railWood = surfaceTexture(document, 'walnut');
  resources.add(feltBump); resources.add(railBump); resources.add(railWood);
  railWood.colorSpace = THREE.SRGBColorSpace;
  railWood.repeat.set(2, 2);
  function finishMaterial(source) {
    if (materialCache.has(source)) return materialCache.get(source);
    let material = source;
    if (/ivory resin|jade green resin/i.test(source.name)) {
      material = new THREE.MeshPhysicalMaterial();
      THREE.MeshStandardMaterial.prototype.copy.call(material, source);
      material.roughness = /ivory/i.test(source.name) ? 0.36 : 0.32;
      material.clearcoat = 0.12; material.clearcoatRoughness = 0.32; material.ior = 1.49;
      material.envMapIntensity = 0.7;
    } else if (/playing felt/i.test(source.name)) {
      material.color.set(clothMap ? '#ffffff' : '#275449'); material.map = clothMap; material.bumpMap = feltBump; material.bumpScale = 0.00006; material.roughness = 0.96;
    } else if (/padded rail/i.test(source.name)) {
      material.color.set('#f1e5d5'); material.map = railWood; material.bumpMap = railBump; material.bumpScale = 0.00012; material.roughness = 0.65;
    } else if (/ink/i.test(source.name)) { material.roughness = 0.58; material.envMapIntensity = 0.25; }
    if (/linen/i.test(source.name)) { material.bumpMap = feltBump; material.bumpScale = 0.00018; material.roughness = 0.96; }
    else if (/fur|paw/i.test(source.name)) { material.bumpMap = feltBump; material.bumpScale = 0.00007; material.roughness = 0.88; }
    materialCache.set(source, material); return material;
  }
  const requests = Array.from({ length: 27 }, (_, kind) => [modelId(kind), 'tiles/' + modelId(kind) + '.glb']);
  requests.push(['mahjong-table', 'room/afternoon-room.glb'], ['tile-back', 'tile-back.glb'], ['dice', 'dice.glb'], ['glass-dice-cup', 'glass-dice-cup.glb'], ['dealer-marker', 'dealer-marker.glb']);
  requests.push(['machine-console', 'room/machine-console.glb']);
  const companionRequests = ['cat', 'fox', 'panda', 'rabbit'].map(animal => ['companion-' + animal, 'companions/' + animal + '.glb']);
  const essentialRequests = requests.map(([id, file]) => [id, file, new URL(file, MODEL_ROOT)]);
  essentialRequests.find(([id]) => id === 'mahjong-table')[2].searchParams.set('build', 'v64');
  const completed = new Set();
  async function load([id, file, url]) {
      const data = await downloadModel(url, id, controller);
      if (controller.signal.aborted) throw controller.signal.reason;
      const parsing = loader.parseAsync(data, MODEL_ROOT.href);
    const gltf = await awaitResource(parsing, id + ' GLB 解析', result => {
      disposeSceneResources(new Set(result.scenes || [result.scene]), new Set());
    });
    if (controller.signal.aborted) {
      disposeSceneResources(new Set(gltf.scenes || [gltf.scene]), new Set());
      throw controller.signal.reason;
    }
    for (const root of gltf.scenes || [gltf.scene]) {
      roots.add(root);
      collectSceneResources(root, resources);
    }
    try {
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(obj => {
        if (obj.isMesh) {
          obj.material = Array.isArray(obj.material) ? obj.material.map(finishMaterial) : finishMaterial(obj.material);
          if ((clothMap && obj.material.map === clothMap) || obj.material.map === railWood) {
            const geometry = obj.geometry;
            geometry.computeBoundingBox();
            const bounds = geometry.boundingBox, size = bounds.getSize(new THREE.Vector3());
            const [u,v] = ['x','y','z'].sort((a,b) => size[b] - size[a]);
            const pos = geometry.getAttribute('position'), uv = new Float32Array(pos.count * 2);
            const point = new THREE.Vector3();
            for (let i = 0; i < pos.count; i++) {
              point.fromBufferAttribute(pos,i);
              uv[2*i] = (point[u] - bounds.min[u]) / size[u];
              uv[2*i+1] = (point[v] - bounds.min[v]) / size[v];
            }
            geometry.setAttribute('uv', new THREE.BufferAttribute(uv,2));
          }
          obj.castShadow = !/face|rank|character|pip/i.test(obj.name);
          obj.receiveShadow = true;
        }
      });
      gltf.scene.animations = gltf.animations;
      templates.set(id, gltf.scene);
      completed.add(id);
      callbacks.onProgress?.(completed.size, essentialRequests.length + companionRequests.length);
    } catch (error) {
      for (const root of gltf.scenes || [gltf.scene]) roots.delete(root);
      disposeSceneResources(new Set(gltf.scenes || [gltf.scene]), resources);
      throw error;
    }
  }
  await Promise.race([Promise.all(essentialRequests.map(load)), stageWatchdog]);
  await Promise.race([Promise.all(companionRequests.map(([id, file]) => {
    const url = new URL(file, MODEL_ROOT);
    url.searchParams.set('build', 'v64');
    return load([id, file, url]);
  })) , stageWatchdog]);
  const table = templates.get('mahjong-table').clone(true);
  // The export batches the lamp with other furniture by material. Clip only
  // the ceiling-height parts of those batches so shelves and trim remain visible.
  const ceilingCut = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.76)];
  const ceilingMaterials = [];
  const roomMeshes = [], roomMaterials = new Set();
  const foregroundCut = new THREE.Plane(new THREE.Vector3(), 1.72);
  const roomCut = [foregroundCut], roomAndCeilingCut = [foregroundCut, ...ceilingCut];
  renderer.localClippingEnabled = true;
  table.traverse(object => {
    if (!object.isMesh) return;
    roomMeshes.push(object);
    if (/^(Paper[ _]pendant|Pendant[ _]cord)$/.test(object.name)) {
      const clipped = material => {
        const copy = material.clone();
        copy.clipShadows = true;
        ceilingMaterials.push(copy);
        resources.add(copy);
        return copy;
      };
      object.material = Array.isArray(object.material) ? object.material.map(clipped) : clipped(object.material);
    }
    for (const material of [object.material].flat()) roomMaterials.add(material);
  });
  scene.add(table); floor.visible = false;
  const companions = createCompanions(scene, templates, { reduced: reduceMotion });
  const companionModels = companionRequests.map(([id]) => templates.get(id));
  host.dataset.companions = String(companions.count);
  host.dataset.cast = companions.cast.join(',');
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
  const glassCup = templates.get('glass-dice-cup').clone(true);
  glassCup.position.set(0, TOP + 0.018, 0);
  glassCup.visible = false;
  glassCup.traverse(obj => { obj.castShadow = false; });
  scene.add(glassCup);
  let cupShake = { x: 0, z: 0, spin: 0 };
  const wallFocus = document.createElement('button');
  wallFocus.type = 'button';
  wallFocus.className = 'wallTileFocus';
  wallFocus.hidden = true;
  wallFocus.setAttribute('aria-label','摸金边标出的牌墙牌');
  wallFocus.onclick = event => {
    if (!canPickWall()) return;
    const pick = event.detail === 0 ? { instanceId: drawInstance, legal: true }
      : pickWallSlot(event.clientX, event.clientY, event.pointerType === 'touch');
    if (pick?.legal) callbacks.onWallPick?.(pick);
  };
  cleanup.push(() => wallFocus.remove());
  const takeMarker = new THREE.Group();
  const markerBorder = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(0.033, 0.044, 0.041)),
    new THREE.LineBasicMaterial({ color: '#edcd77' }));
  markerBorder.position.y = 0.022; takeMarker.add(markerBorder);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.020, 4), trim);
  arrow.rotation.z = Math.PI; arrow.position.y = 0.064; takeMarker.add(arrow);
  takeMarker.visible = false; scene.add(takeMarker);
  // The authored Blender console replaces the old procedural coaster.
  for (const child of lid.children) child.visible = false;
  lid.add(templates.get('machine-console').clone(true));
  const tiles = new THREE.Group();
  scene.add(tiles);
  const contactCanvas = document.createElement('canvas'); contactCanvas.width = contactCanvas.height = 64;
  const contactContext = contactCanvas.getContext('2d'), contactGradient = contactContext.createRadialGradient(32, 32, 3, 32, 32, 31);
  contactGradient.addColorStop(0, 'rgba(0,0,0,.72)'); contactGradient.addColorStop(1, 'rgba(0,0,0,0)');
  contactContext.fillStyle = contactGradient; contactContext.fillRect(0, 0, 64, 64);
  const contactTexture = new THREE.CanvasTexture(contactCanvas);
  const contact = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, opacity: 0.28, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1 }), 128);
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
  let drawInstance = -1;
  let machineRun = null, lastBacks = [], recycling = null;
  let snapshot = null, round = null, active = false, disposed = false, overview = false;
  let hovered = null, dirty = true, request = 0, animatedUntil = 0, lastFrame = 0, discardHint = null, dragTile = null, dragInsert = null;
  let yaw = 0, pitch = 1.00, drag = null, width = 0, height = 0;
  const bounds = new THREE.Box3(), corners = Array.from({ length: 8 }, () => new THREE.Vector3());
  const aim = new THREE.Vector3(), outward = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const fitPoint = new THREE.Vector3();
  // Envelope for a 14-tile hand, including drawn-tile gap, tilt and selection lift.
  const handHalf = 6.5 * HAND_STEP + 0.007 + 0.014 * HAND_SCALE;
  const handCorners = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(
    i & 1 ? handHalf : -handHalf, TOP + (i & 2 ? 0.13 : 0), HAND_Z + (i & 4 ? 0.055 : -0.065)));

  function cameraPose(focus = 0) {
    const aspect = Math.max(0.01, camera.aspect);
    const angle = THREE.MathUtils.lerp(pitch, 1.08, focus), heading = yaw * (1 - focus);
    aim.set(0, TOP + 0.022 * focus, 0.025 * (1 - focus));
    outward.set(Math.sin(heading) * Math.cos(angle), Math.sin(angle), Math.cos(heading) * Math.cos(angle));
    right.set(Math.cos(heading), 0, -Math.sin(heading));
    up.crossVectors(outward, right);
    const tanV = Math.tan(camera.fov * Math.PI / 360) * 0.95;
    let orbitDistance = aspect < 1 ? 1.75 / Math.max(0.56, aspect) : 1.85;
    for (const corner of handCorners) {
      fitPoint.copy(corner).sub(aim);
      // Perspective depth is distance minus the corner's offset toward the camera.
      orbitDistance = Math.max(orbitDistance, fitPoint.dot(outward) + Math.max(
        Math.abs(fitPoint.dot(right)) / (tanV * aspect), Math.abs(fitPoint.dot(up)) / tanV));
    }
    const distance = THREE.MathUtils.lerp(orbitDistance, 0.65 / Math.min(1, Math.max(0.7, aspect)), focus);
    camera.position.copy(aim).addScaledVector(outward, distance);
    // A narrow viewport may place the eye outside the room. Cut foreground
    // architecture on the camera side while retaining the far walls.
    foregroundCut.normal.set(-Math.sin(heading), 0, -Math.cos(heading));
    camera.lookAt(aim);
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
  const observer = new viewport.ResizeObserver(resize);
  observer.observe(host);
  cleanup.push(() => observer.disconnect());

  function animate(entry, target, quaternion, duration = 180, arc = 0, landing = false) {
    const now = viewport.performance.now();
    if (reduceMotion || duration === 0) {
      entry.object.position.copy(target); entry.object.quaternion.copy(quaternion); entry.object.scale.setScalar(entry.scale); entry.tween = null;
    } else {
      entry.tween = { start: now, duration, from: entry.object.position.clone(), to: target.clone(),
        q0: entry.object.quaternion.clone(), q1: quaternion.clone(), arc, landing, landed: false, grab: (entry.type === 'hand' || entry.type === 'river') && arc > 0, lead: arc > 0 ? 180 : 0,
        scale0: entry.object.scale.x, scale1: entry.scale };
      animatedUntil = Math.max(animatedUntil, now + duration + (arc > 0 ? 180 : 0) + 40);
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
      entry = { object, type, scale, ...extra, base: position.clone(), q: quaternion.clone(), liftTarget: position.clone() };
      entries.set(key, entry);
      if (!initial && type === 'river') {
        const hint = discardHint && discardHint.kind === extra.kind && extra.pos === 0 && viewport.performance.now() - discardHint.time < 2500;
        object.position.copy(hint ? discardHint.position : turn(extra.pos, 0, 0.35, TOP + 0.055));
        object.quaternion.copy(hint ? discardHint.quaternion : rotation(extra.pos, 1.15));
        object.scale.setScalar(hint ? discardHint.scale : 1.16);
        animate(entry, position, quaternion, hint ? 360 : 400, hint ? 0.035 : 0.045, true);
        if (hint) { if(entry.tween) entry.tween.lead=0; discardHint = null; }
      } else if (!initial && type === 'hand') {
        const draws = snapshot?.wallDraws, wall = snapshot ? physicalWall(snapshot) : null;
        const slot = wall && draws ? wall[clamp(snapshot.gangDraw ? 102 - draws.tail : draws.head - 1, 0, 107)] : null;
        object.position.copy(slot ? slot.position : turn(0, 0.17, 0.26, TOP + 0.045));
        object.quaternion.copy(slot ? slot.rotation : rotation(0));
        object.scale.setScalar(slot ? 0.98 : 1.16);
        animate(entry, position, quaternion, 380, 0.045);
      }
    } else if (entry.base.distanceToSquared(position) > 1e-10 || entry.q.angleTo(quaternion) > 0.001) {
      animate(entry, position, quaternion);
    }
    entry.scale = scale;
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
      batch.boundingSphere = null;
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
  function paintLiveContacts() {
    let i = 0;
    for (const entry of entries.values()) {
      if (entry.type === 'prop' || !entry.object.visible || i >= 128) continue;
      const object = entry.object, elevation = Math.max(0, object.position.y - entry.base.y);
      const spread = 1 + Math.min(0.8, elevation * 5);
      const size = object.scale.x;
      dummy.position.set(object.position.x, TOP + 0.0006, object.position.z);
      dummy.quaternion.identity();
      dummy.scale.set(0.026 * size * spread, 1, (entry.type === 'hand' && !overview ? 0.019 : 0.035) * size * spread);
      dummy.updateMatrix(); contact.setMatrixAt(i++, dummy.matrix);
    }
    contact.count = i; contact.instanceMatrix.needsUpdate = true;
    host.dataset.contactCount = String(i);
  }
  function updateHover() {
    if (machineRun) return;
    const gapX = dragInsert ? dragInsert.gapX : null;
    for (const entry of entries.values()) {
      if (entry.type !== 'hand') continue;
      // 三维拖拽：被拖的牌直接放在指针抬起的平面上，不走抬牌补间，手指和模型同步。
      if (dragTile && entry.id === dragTile.id) {
        entry.tween = null;
        entry.object.position.copy(dragTile.target);
        entry.liftTarget = dragTile.target;
        continue;
      }
      const lifted = entry.chosen || entry.id === hovered;
      const next = entry.base.clone();
      // 理牌让位：插入槽之后的牌整体右移一格，给被拖的牌腾出空位。
      if (gapX != null && Math.abs(next.z - HAND_Z) < 0.05 && next.x >= gapX - 1e-3) next.x += HAND_STEP;
      if (lifted) { next.y += entry.chosen ? 0.016 : 0.009; next.z -= entry.chosen ? 0.015 : 0.006; }
      if (!entry.liftTarget || entry.liftTarget.distanceToSquared(next) > 1e-10) {
        entry.liftTarget = next;
        animate(entry, next, entry.q, gapX != null ? 130 : 150);
      }
    }
    if (dragTile) dirty = true;
    schedule();
  }
  // 指针在「牌桌上方一个虚拟平面」上反投影，得到被拖牌的落点；松手后模型回到原位或由弃牌动画接管。
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TOP + 0.115));
  const dragHit = new THREE.Vector3();
  const handGapPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(TOP + 0.06));
  const gapHit = new THREE.Vector3();
  function setTileDrag(id, clientX, clientY) {
    if (id == null) {
      if (dragTile || dragInsert) { dragTile = null; dragInsert = null; host.dataset.tileInsert = ''; host.dataset.tileDrag = ''; updateHover(); }
      return;
    }
    if (dragTile?.id === id && dragTile.clientX === clientX && dragTile.clientY === clientY) return;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!setPickRay(clientX, clientY, rect)) { setTileDrag(null); return; }
    const handHit = nearestHandHit(true, id);
    if (!pickRay.ray.intersectPlane(dragPlane, dragHit)) { setTileDrag(null); return; }
    const hit = dragHit.clone();
    const target = dragHit.clone();
    target.x = clamp(target.x, -0.42, 0.42);
    target.z = clamp(target.z, -0.22, 0.40);
    dragTile = { id, hit, target, clientX, clientY };
    // 靠近自己手牌时找插入槽：左侧第一张比落点靠右的牌就是插入点，找不到就插到最后。
    dragInsert = null;
    const others = [...entries.values()].filter(e => e.type === 'hand' && e.id !== id).sort((a, b) => a.base.x - b.base.x);
    const anchor = handHit && handHit.id !== id ? others.find(e => e.id === handHit.id) : null;
    if (anchor) {
      const before = handHit.point.x < anchor.object.position.x;
      dragInsert = { gapX: anchor.base.x + (before ? 0 : HAND_STEP), targetId: anchor.id, before };
    } else if (others.length && pickRay.ray.intersectPlane(handGapPlane, gapHit) &&
        Math.abs(gapHit.z - HAND_Z) < 0.06 && Math.abs(gapHit.x) < handHalf) {
      // Use the resting tile height in gaps. The higher drag plane can project
      // a point between two tiles into the river when viewed from behind.
      const after = others.find(e => gapHit.x < e.base.x - 0.004);
      dragInsert = after
        ? { gapX: after.base.x, targetId: after.id, before: true }
        : { gapX: others[others.length - 1].base.x + HAND_STEP, targetId: others[others.length - 1].id, before: false };
    }
    host.dataset.tileDrag = id;
    host.dataset.tileInsert = dragInsert ? dragInsert.targetId + ':' + (dragInsert.before ? 'b' : 'a') : '';
    dirty = true; updateHover(); schedule();
  }

  function diceQuaternion(number, yaw = 0) {
    const normals = [null, [0, 1, 0], [1, 0, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [0, -1, 0]];
    return rotation(0).setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw)
      .multiply(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(...normals[number || 1]), new THREE.Vector3(0, 1, 0)));
  }
  // 槽位契约（对外只读查询，供二维 wallSlotMap 对接与对照测试）：
  // 槽空间 0..107 = 108 槽 / 54 墩。四家顺序 [0,3,2,1]；0、2 号位各 14 墩(28 槽)，1、3 号位各 13 墩(26 槽)。
  // 每家内先列后层：column 0..count-1 从右向左数墩，每墩先上层 layer=0(y=TOP+0.018) 后下层 layer=1(y=TOP)。
  // 槽号 = 家偏移 + column*2 + layer，家偏移依次 0 / 28 / 54 / 82。
  // physicalWall() 随后按 startSlot 旋转，故可视下标 i 对应原始槽 ((i+startSlot)%108)。
  // 本函数纯算术、不读写渲染状态、不触发 schedule()，返回结构不含牌种。
  const WALL_SLOTS = 108;
  function wallSlotInfo(index, opening) {
    const start = opening?.startSlot || 0;
    const raw = ((index % WALL_SLOTS) + WALL_SLOTS) % WALL_SLOTS;
    const physical = (raw + start) % WALL_SLOTS;
    let base = 0, seat = 0, column = 0, layer = 0;
    for (const s of [0, 3, 2, 1]) {
      const count = s % 2 ? 13 : 14, span = count * 2;
      if (physical < base + span) { seat = s; column = Math.floor((physical - base) / 2); layer = (physical - base) % 2; break; }
      base += span;
    }
    return { physical, seat, pos: (seat + (opening?.seatOffset || 0)) % 4, column, layer, upper: layer === 0 };
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
    return wall.slice(head - (next.wallReceipt && !next.fromTail ? 1 : 0), 102 - tail + (next.wallReceipt && next.fromTail ? 1 : 0)).concat(next.over ? [] : wall.slice(102));
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
    if (machineRun) {
      snapshot = next;
      if (!next.waitForRoll && !machineRun.rolled) { machineRun.rolled = true; machineRun.lastTime = null; dirty = true; schedule(); }
      return;
    }
    applySnapshot(next);
  }
  function applySnapshot(next) {
    snapshot = next;
    const initial = round !== next.round;
    if (initial) {
      for (const entry of entries.values()) tiles.remove(entry.object);
      entries.clear(); hovered = null; discardHint = null; dragTile = null; dragInsert = null; round = next.round;
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
    const wallInstanceStart = hidden.length;
    const wall = wallRemainder(next);
    const mainCount = wall.length - (next.over ? 0 : 6);
    drawInstance = next.wallPick && mainCount > 0 ? wallInstanceStart + (next.fromTail ? mainCount-1 : 0) : -1;
    if (drawInstance >= 0) {
      const pose = wall[drawInstance-wallInstanceStart];
      // Separate the marked tile from its stack, including lower-layer replacements.
      pose.position.add(new THREE.Vector3(0, .018, .048).applyQuaternion(pose.rotation));
      takeMarker.position.copy(pose.position);
      takeMarker.quaternion.copy(pose.rotation);
    }
    takeMarker.visible = drawInstance >= 0;
    hidden.push(...wall);
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
      faceGroup, faces, bySlot: new Map(faces.map(f => [f.slot, f])), lastPacket: -1, focus: 0, settled: null,
      rolled: !next.waitForRoll };
    contact.count = 0;
    for (const entry of entries.values()) if (entry.type !== 'prop') entry.object.visible = false;
    host.dataset.machineBusy = '1';
    host.dataset.dealCounts = '0,0,0,0';
    host.dataset.dealFaceCount = '0';
    callbacks.onProject?.([]); callbacks.onBusy?.(true);
    dirty = true; schedule();
  }
  function finishMachine(notify = true) {
    glassCup.visible = false;
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
    if (!run) { glassCup.visible = false; return; }
    // 首次 shader 编译或后台恢复不能吞掉整段升墙／掷骰动画。
    if (run.lastTime !== null) run.elapsed += Math.min(run.phase === 'deal' ? 140 : 300, Math.max(0, now - run.lastTime));
    if (!run.rolled) run.elapsed = Math.min(run.elapsed, run.collect + 1400);
    run.lastTime = now;
    let t = run.elapsed, phase, p;
    const ease = n => 1 - Math.pow(1 - clamp(n, 0, 1), 3);
    if (t < run.collect) { phase = 'collect'; p = t / run.collect; }
    else if ((t -= run.collect) < 550) { phase = 'shuffle'; p = t / 550; }
    else if ((t -= 550) < 850) { phase = 'lift'; p = t / 850; }
    else if (!run.rolled) { phase = 'await-roll'; p = 0; }
    else if ((t -= 850) < DICE_TIME) { phase = 'dice'; p = t / DICE_TIME; }
    else { t -= DICE_TIME; phase = 'deal'; p = t; }
    if (phase !== run.phase) {
      run.phase = phase; host.dataset.machinePhase = phase;
      callbacks.onMachine?.(phase, run.opening, [0, 0, 0, 0]);
    }
    const smooth = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };
    const focus = phase === 'await-roll' ? 0.55 : phase === 'dice' ? (0.55 + 0.45 * smooth(p / 0.18)) * (1 - smooth((p - 0.82) / 0.18)) : 0;
    if (focus !== run.focus) { run.focus = focus; cameraPose(focus); }
    host.dataset.diceFocus = focus.toFixed(2);
    const settled = phase !== 'dice' || p >= 0.62, diceState = (phase === 'dice') + ':' + settled;
    if ((phase === 'dice' || phase === 'deal') && diceState !== run.settled) { run.settled = diceState; callbacks.onDice?.(phase === 'dice', settled, run.opening.dice); }
    run.faces.forEach(f => { f.object.visible = false; });
    lid.position.y = phase === 'collect' ? 0.105 * Math.sin(Math.min(p * 2, 1) * Math.PI / 2)
      : phase === 'shuffle' ? 0.105 : phase === 'lift' ? 0.105 * (1 - ease(p)) : 0;
    glassCup.visible = phase === 'await-roll' || phase === 'dice' && p < 0.96;
    const handShaking = phase === 'await-roll';
    const rolling = phase === 'dice' && p < 0.62;
    const shakeFade = rolling ? Math.pow(1 - p / 0.62, 2) : 0;
    glassCup.position.set(handShaking ? cupShake.x : Math.sin(p * 35) * 0.018 * shakeFade,
      TOP + 0.018 + (phase === 'dice' ? smooth((p - 0.65) / 0.3) * 0.17 : 0),
      handShaking ? cupShake.z : Math.cos(p * 29) * 0.012 * shakeFade);
    glassCup.rotation.set(handShaking ? cupShake.z * 2 : 0, 0,
      handShaking ? -cupShake.x * 2.5 : Math.sin(p * 35) * 0.12 * shakeFade);
    host.dataset.cupModel = glassCup.visible ? 'glass-dice-cup.glb' : '';
    host.dataset.cupShake = cupShake.spin.toFixed(2);
    const diceEntries = [entries.get('dice:0'), entries.get('dice:1')];
    diceEntries.forEach((entry, i) => {
      if (!entry) return;
      entry.object.visible = phase === 'await-roll' || phase === 'dice' || phase === 'deal';
      entry.tween = null;
      const target = diceQuaternion(run.opening.dice[i], i ? 0.3 : -0.25);
      entry.object.position.copy(entry.base); entry.object.position.y += lid.position.y;
      if (handShaking) {
        entry.object.position.x += cupShake.x + Math.sin(cupShake.spin + i * 3) * 0.009;
        entry.object.position.z += cupShake.z + Math.cos(cupShake.spin + i * 3) * 0.009;
        entry.object.position.y += Math.abs(Math.sin(cupShake.spin * 1.7 + i)) * 0.022;
        entry.object.quaternion.setFromEuler(new THREE.Euler(cupShake.spin * 1.3, cupShake.spin + i, cupShake.spin * 0.8));
      } else if (phase === 'dice' && p < 0.62) {
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
      } else if (phase === 'lift' || phase === 'dice' || phase === 'await-roll') {
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
      // 点击区域固定在牌的落手位置，视觉抬牌不能把鼠标移出区域再触发落牌。
      bounds.translate(entry.base.clone().sub(entry.object.position));
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
    try {
      renderFrame(now);
    } catch (error) { failStage(error); }
  }
  function renderFrame(now) {
    if (now - lastFrame >= (softwareRendering ? 50 : 30) && (dirty || machineRun || now < animatedUntil || !reduceMotion)) {
      frameMachine(now);
      const holds = [];
      for (const entry of entries.values()) if (entry.tween) {
        const t = entry.tween, f = clamp((now - t.start - t.lead) / t.duration, 0, 1);
        const motion = tileMotion(f, t.landing), eased = motion.travel;
        entry.object.position.lerpVectors(t.from, t.to, eased);
        entry.object.position.y += Math.sin(Math.PI * Math.min(1, f / (t.landing ? 0.8 : 1))) * t.arc + motion.lift;
        entry.object.scale.setScalar(THREE.MathUtils.lerp(t.scale0, t.scale1, eased));
        if (t.landing && !t.landed && f >= 0.8) {
          t.landed = true;
          host.dataset.tileLandings = String(Number(host.dataset.tileLandings || 0) + 1);
          callbacks.onTileLand?.();
        }
        entry.object.quaternion.slerpQuaternions(t.q0, t.q1, eased);
        if (t.grab && f < (t.landing ? 0.8 : 1)) {
          const grip = clamp((now - t.start) / Math.max(1,t.lead), 0, 1);
          const point = entry.object.position.clone().add(new THREE.Vector3(0,0.018*entry.object.scale.x+0.016,0));
          holds.push({pos:entry.type==='hand'?0:entry.pos,point,grip});
        }
        if (f === 1) entry.tween = null;
      }
      if (!machineRun) {
        const held = dragTile ? entries.get('hand:'+dragTile.id) : [...entries.values()].find(e=>e.type==='hand' && e.chosen);
        if (held) holds.push({pos:0,point:held.object.position.clone().add(new THREE.Vector3(0,0.018*held.object.scale.x+0.016,0)),grip:1});
        paintLiveContacts();
      }
      companions.update(now, machineRun ? [] : holds);
      const gripState=companions.inspect();
      host.dataset.gripping = gripState.filter(r=>r.holding&&r.grip>=1).map(r=>r.pos).join(',');
      host.dataset.gripError = String(Math.max(0,...gripState.filter(r=>r.holding&&r.grip>=1).map(r=>r.error)));
      scene.updateMatrixWorld();
      const cutCeiling = camera.position.y > 1.76;
      for (const material of roomMaterials) material.clippingPlanes = roomCut;
      if (cutCeiling) for (const material of ceilingMaterials) material.clippingPlanes = roomAndCeilingCut;
      renderer.render(scene, camera);
      projectHand();
      wallFocus.hidden = !canPickWall();
      if (!wallFocus.hidden) {
        const { x, y } = projectWallTarget(width, height);
        wallFocus.style.left = x + 'px';
        wallFocus.style.top = y + 'px';
      }
      if (glassCup.visible) {
        const box = new THREE.Box3().setFromObject(glassCup);
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (let i = 0; i < 8; i++) {
          const point = new THREE.Vector3(i & 1 ? box.max.x : box.min.x,
            i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).project(camera);
          const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
          minX = Math.min(minX,x); maxX = Math.max(maxX,x);
          minY = Math.min(minY,y); maxY = Math.max(maxY,y);
        }
        callbacks.onCupProject?.({x:minX,y:minY,width:maxX-minX,height:maxY-minY});
      }
      host.dataset.viewport = Math.round(width) + 'x' + Math.round(height);
      host.dataset.drawCalls = String(renderer.info.render.calls);
      host.dataset.triangles = String(renderer.info.render.triangles);
      lastFrame = now; dirty = false;
    }
    if (dirty || machineRun && (machineRun.phase !== 'await-roll' || machineRun.rolled) || now < animatedUntil || !reduceMotion) schedule();
  }
  function schedule() { if (active && !disposed && !document.hidden && !request) request = viewport.requestAnimationFrame(frame); }
  function setActive(value) {
    active = !!value;
    if (!active && request) { viewport.cancelAnimationFrame(request); request = 0; }
    if (active) { resize(); dirty = true; schedule(); }
  }
  function setView(value) {
    overview = value === 'overhead'; yaw = 0; pitch = overview ? 1.30 : 1.00;
    companions.setView(overview);
    host.dataset.view = overview ? 'overhead' : 'seated';
    cameraPose();
    if (snapshot) update(snapshot);
    dirty = true; schedule();
  }
  // 背面实例按“对手手牌、剩余牌墙、鸟牌”的顺序绘制；仅开放当前取牌槽。
  const pickRay = new THREE.Raycaster(), pickNdc = new THREE.Vector2();
  const wallPoint = new THREE.Vector3();
  function canPickWall() { return active && !disposed && !machineRun && drawInstance >= 0; }
  function projectWallTarget(w, h) {
    wallPoint.copy(lastBacks[drawInstance].position);
    wallPoint.y += .012;
    wallPoint.project(camera);
    return { x: (1 + wallPoint.x) * w / 2, y: (1 - wallPoint.y) * h / 2 };
  }
  function setPickRay(clientX, clientY, rect) {
    if (!rect.width || !rect.height || clientX < rect.left || clientX > rect.right ||
        clientY < rect.top || clientY > rect.bottom) return false;
    pickNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    pickRay.setFromCamera(pickNdc, camera);
    return true;
  }
  function nearestHandHit(allowOccluded = false, excludedId = null) {
    const hits = [];
    for (const entry of entries.values()) {
      if (entry.type !== 'hand' || !entry.object.visible) continue;
      const hit = pickRay.intersectObject(entry.object, true)[0];
      if (hit) hits.push({ id: entry.id, distance: hit.distance, point: hit.point });
    }
    hits.sort((a, b) => a.distance - b.distance);
    const firstHand = hits[0];
    if (!firstHand) return null;
    if (!allowOccluded) {
      const worldHit = nearestWorldHit();
      if (worldHit && worldHit.distance < firstHand.distance - 0.001) return null;
      return firstHand;
    }
    return hits.find(hit => hit.id !== excludedId && hit.distance <= firstHand.distance + 0.15) || firstHand;
  }
  function nearestWorldHit() {
    const interactive = [...entries.values()].filter(e => e.type !== 'prop' && e.object.visible).map(e => e.object);
    interactive.push(...backParts.map(part => part.batch).filter(batch => batch.count));
    interactive.push(...companionModels.filter(model => model.visible));
    let best = pickRay.intersectObjects(interactive, true)[0];
    if (best) best.interactive = true;
    for (const mesh of roomMeshes) {
      const hit = pickRay.intersectObject(mesh, false).find(candidate => {
        const material = Array.isArray(mesh.material) ? mesh.material[candidate.face?.materialIndex] : mesh.material;
        return !material?.clippingPlanes?.some(plane => plane.distanceToPoint(candidate.point) < 0);
      });
      if (hit && (!best || hit.distance < best.distance)) best = hit;
    }
    return best || null;
  }
  function pickHandTile(clientX, clientY) {
    if (!active || disposed || machineRun) return null;
    if (!setPickRay(clientX, clientY, renderer.domElement.getBoundingClientRect())) return null;
    return nearestHandHit()?.id ?? null;
  }
  function pickWallSlot(clientX, clientY, touch) {
    if (!canPickWall()) return null;
    const rect = renderer.domElement.getBoundingClientRect();
    if (!setPickRay(clientX, clientY, rect)) return null;
    const surface = nearestWorldHit();
    if (surface?.instanceId != null) return { instanceId: surface.instanceId, legal: surface.instanceId === drawInstance };
    // Touch tolerance only fills gaps. A hit on another tile or a companion
    // must not be redirected to the marked tile.
    if (surface?.interactive) return null;
    if (touch) {
      const p = projectWallTarget(rect.width, rect.height);
      if (Math.abs(clientX - rect.left - p.x) <= 22 && Math.abs(clientY - rect.top - p.y) <= 22 &&
          setPickRay(rect.left + p.x, rect.top + p.y, rect) && nearestWorldHit()?.instanceId === drawInstance) {
        return { instanceId: drawInstance, legal: true };
      }
    }
    return null;
  }
  function pointerDown(event) {
    if (drag || !active || event.target !== renderer.domElement || event.button !== 0) return;
    drag = { x: event.clientX, y: event.clientY, yaw, pitch, moved: 0, id: event.pointerId };
    if (renderer.domElement.hasPointerCapture(event.pointerId) || event.isTrusted) renderer.domElement.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!drag || event.pointerId !== drag.id) return;
    // 记录累计位移：<8px 判为“点一下”（交给 pointerUp 做牌墙拾取），否则才是拖视角。
    drag.moved = Math.max(drag.moved, Math.hypot(event.clientX - drag.x, event.clientY - drag.y));
    if (drag.moved < 8) return;
    yaw = drag.yaw - (event.clientX - drag.x) * 2*Math.PI/Math.max(width,500);
    pitch = clamp(drag.pitch + (event.clientY - drag.y) * 0.0035, 0.48, 1.48);
    cameraPose(); dirty = true; schedule();
  }
  function pointerUp(event) {
    // 位移 <8px 视为点击：尝试拾取牌墙槽位并通知上层（只报槽号，不决定拿哪张）。
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved < 8 && Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<8) {
      const slot = pickWallSlot(event.clientX, event.clientY, event.pointerType === 'touch');
      if (slot) callbacks.onWallPick?.(slot);
    }
    drag = null;
  }
  renderer.domElement.addEventListener('pointerdown', pointerDown);
  renderer.domElement.addEventListener('pointermove', pointerMove);
  renderer.domElement.addEventListener('pointerup', pointerUp);
  renderer.domElement.addEventListener('lostpointercapture', cancelOrbit);
  renderer.domElement.addEventListener('pointercancel', cancelOrbit);
  function cancelOrbit(event) { if (drag?.id === event.pointerId) drag=null; }
  cleanup.push(() => {
    renderer.domElement.removeEventListener('pointerdown', pointerDown);
    renderer.domElement.removeEventListener('pointermove', pointerMove);
    renderer.domElement.removeEventListener('pointerup', pointerUp);
    renderer.domElement.removeEventListener('pointercancel', cancelOrbit);
    renderer.domElement.removeEventListener('lostpointercapture', cancelOrbit);
  });
  function visibility() {
    if (machineRun) machineRun.lastTime = null;
    if (!document.hidden) { dirty = true; schedule(); }
  }
  document.addEventListener('visibilitychange', visibility);
  cleanup.push(() => document.removeEventListener('visibilitychange', visibility));
  if (controller.signal.aborted) throw controller.signal.reason;
  if (gl.isContextLost?.()) throw Error('图形上下文已中断');
  resize();
  host.appendChild(renderer.domElement);
  host.appendChild(wallFocus);
  mounted = true;
  host.dataset.phase = 'ready';
  host.dataset.view = 'seated';
  return {
    update, setActive, setView, skipOpening(force = false) {
      if (machineRun && !machineRun.rolled && !force) return false;
      finishMachine(); return true;
    },
    shakeDice(x,z,spin) {
      if (!machineRun || machineRun.phase !== 'await-roll') return;
      cupShake = { x: clamp(x,-0.03,0.03), z: clamp(z,-0.02,0.02), spin };
      dirty = true; schedule();
    },
    rollDice() { if (machineRun) { machineRun.rolled = true; machineRun.lastTime = null; dirty = true; schedule(); } },
    hover(id) { if (hovered !== id) { hovered = id; updateHover(); } },
    setTileDrag, pickHandTile,
    tileDragTarget() { return dragInsert ? { targetId: dragInsert.targetId, before: dragInsert.before } : null; },
    tileDragInRiver() { return isRiverDragTarget(dragTile, dragInsert); },
    // 只读槽位查询：index 为可视槽下标 0..107，返回 { physical, seat, pos, column, layer, upper }，不含牌种。
    wallSlotAt(index) { return wallSlotInfo(index, snapshot?.opening); },
    wallSlotCount() { return WALL_SLOTS; },
    companionState() { return companions.inspect(); },
    noteDiscard(id) {
      const entry = entries.get('hand:' + id);
      if (entry) discardHint = { kind: entry.kind, position: entry.object.position.clone(), quaternion: entry.object.quaternion.clone(), scale: entry.object.scale.x, time: viewport.performance.now() };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      setActive(false);
      release();
      entries.clear();
    }
  };
}
