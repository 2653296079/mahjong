'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { deflateSync } = require('node:zlib');
const test = require('node:test');

const root = path.join(__dirname, '..');
const blender = process.env.BLENDER_BIN;
const sourcePack = process.env.ROOM_PACK_FIXTURE;
const options = { skip: (!blender || !sourcePack) && 'Set BLENDER_BIN and ROOM_PACK_FIXTURE to run Blender integration tests' };
const blenderOptions = { skip: !blender && 'Set BLENDER_BIN to run Blender validation tests' };
const animals = ['cat', 'fox', 'panda', 'rabbit'];
const roomFile = 'room/afternoon-room.glb';

function makeSandbox(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mahjong-room-pack-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const scripts = path.join(sandbox, 'scripts');
  const pack = path.join(sandbox, 'input');
  const output = path.join(sandbox, 'assets/mahjong-3d/glb');
  fs.mkdirSync(scripts);
  fs.mkdirSync(path.join(pack, '角色'), { recursive: true });
  const script = path.join(scripts, 'import-room-pack.py');
  fs.copyFileSync(path.join(root, 'scripts/import-room-pack.py'), script);
  fs.copyFileSync(path.join(sourcePack, '午后牌室.blend'), path.join(pack, '午后牌室.blend'));
  for (const animal of animals) {
    fs.copyFileSync(path.join(sourcePack, '角色', animal + '.glb'), path.join(pack, '角色', animal + '.glb'));
  }
  return { sandbox, pack, output, script, scripts: path.dirname(script) };
}

function makeModuleSandbox(t) {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mahjong-room-pack-unit-'));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));
  const scripts = path.join(sandbox, 'scripts');
  fs.mkdirSync(scripts);
  const script = path.join(scripts, 'import-room-pack.py');
  fs.copyFileSync(path.join(root, 'scripts/import-room-pack.py'), script);
  return { sandbox, scripts, script };
}

function runBlender(args) {
  const result = spawnSync(blender, [
    '-b', '--factory-startup', '--disable-autoexec', '--python-exit-code', '1', ...args,
  ], { encoding: 'utf8', timeout: 480_000 });
  if (result.error) throw result.error;
  return result;
}

function runImporter(fixture, output = fixture.output) {
  return runBlender(['--python', fixture.script, '--', fixture.pack, '--output-dir', output]);
}

function runModule(fixture, body) {
  const driver = path.join(fixture.scripts, 'test-driver.py');
  fs.writeFileSync(driver, `import importlib.util\nimport os\nimport sys\nimport struct\nimport json\nfrom pathlib import Path\nspec = importlib.util.spec_from_file_location("room_importer", ${JSON.stringify(fixture.script)})\nroom_importer = importlib.util.module_from_spec(spec)\nspec.loader.exec_module(room_importer)\n${body}\n`);
  return runBlender(['--python', driver]);
}

function glbJson(glb) {
  assert.equal(glb.toString('ascii', 0, 4), 'glTF');
  return JSON.parse(glb.toString('utf8', 20, 20 + glb.readUInt32LE(12)));
}

function editGlb(file, edit) {
  const original = fs.readFileSync(file);
  const model = glbJson(original);
  edit(model);
  const json = Buffer.from(JSON.stringify(model));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const changed = Buffer.concat([original.subarray(0, 20), padded, original.subarray(20 + original.readUInt32LE(12))]);
  changed.writeUInt32LE(changed.length, 8);
  changed.writeUInt32LE(padded.length, 12);
  fs.writeFileSync(file, changed);
}

function clearFirstSkinWeight(file) {
  const original = fs.readFileSync(file);
  const model = glbJson(original);
  const node = model.nodes.find(candidate => candidate.name === path.basename(file, '.glb')) || model.nodes.find(candidate => candidate.name === 'cat');
  const primitive = model.meshes[node.mesh].primitives[0];
  const accessor = model.accessors[primitive.attributes.WEIGHTS_0];
  const view = model.bufferViews[accessor.bufferView];
  const vertexOffset = 28 + original.readUInt32LE(12) + (view.byteOffset || 0) + (accessor.byteOffset || 0);
  for (let component = 0; component < 4; component++) original.writeFloatLE(0, vertexOffset + component * 4);
  fs.writeFileSync(file, original);
}

function pngChunk(type, payload) {
  const name = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(payload.length + 12);
  chunk.writeUInt32BE(payload.length, 0);
  name.copy(chunk, 4);
  payload.copy(chunk, 8);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([name, payload])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, payload.length + 8);
  return chunk;
}

function pngWithRaw(raw, width = 192, height = 192) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function validPng() {
  return pngWithRaw(Buffer.alloc(192 * (192 * 4 + 1)));
}

function seedAssets(fixture, files = [roomFile, 'companions/cat.glb', 'companions/portraits/cat.png']) {
  for (const file of files) {
    const target = path.join(fixture.output, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'existing asset');
  }
  return () => {
    for (const file of files) assert.ok(fs.readFileSync(path.join(fixture.output, file)).equals(Buffer.from('existing asset')), file);
  };
}

test('main stages every companion before validating or rendering it', options, t => {
  const fixture = makeSandbox(t);
  const output = path.join(fixture.sandbox, 'isolated');
  const result = runModule(fixture, `
pack = Path(${JSON.stringify(fixture.pack)})
output = Path(${JSON.stringify(output)})
original_validate = room_importer.validate_companion
validated = {}

def validate_staged(model, animal):
    stage = model.parent.parent.parent
    assert model.parent.name == "companions"
    assert stage.parent == output.parent and stage.name.startswith(".room-pack-stage-")
    assert all((model.parent / (name + ".glb")).is_file() for name in room_importer.ANIMALS)
    original_validate(model, animal)
    validated[animal] = model

source_validated = []
def validate_source_stub(blend):
    assert set(validated) == set(room_importer.ANIMALS)
    assert blend.is_file() and pack not in blend.parents
    assert blend.parent.parent == next(iter(validated.values())).parent.parent.parent
    source_validated.append(blend)

def export_stub(blend, destination):
    assert source_validated == [blend]
    destination.write_bytes(b"room")

def render_stub(model, destination, animal):
    assert model == validated[animal]
    destination.write_bytes(b"portrait")

room_importer.validate_companion = validate_staged
room_importer.validate_room_source = validate_source_stub
room_importer.export_room = export_stub
room_importer.validate_room = lambda path: path
room_importer.render_portrait = render_stub
room_importer.validate_png = lambda path: path
sys.argv = ["import-room-pack.py", "--", str(pack), "--output-dir", str(output)]
room_importer.main()
`);

  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});

test('companion validation rejects compression, disconnected bones, and zero weights', options, t => {
  const fixture = makeSandbox(t);
  const directory = path.join(fixture.pack, '角色');
  for (const name of ['compressed', 'disconnected', 'zero-weights']) {
    fs.copyFileSync(path.join(directory, 'cat.glb'), path.join(directory, name + '.glb'));
  }
  editGlb(path.join(directory, 'compressed.glb'), gltf => {
    gltf.extensionsUsed = [...(gltf.extensionsUsed || []), 'KHR_draco_mesh_compression'];
  });
  editGlb(path.join(directory, 'disconnected.glb'), gltf => {
    const chest = gltf.nodes.find(node => node.name === 'Chest');
    const forearm = gltf.nodes.find(node => node.name === 'Forearm.L');
    const pawIndex = gltf.nodes.findIndex(node => node.name === 'Paw.L');
    forearm.children = forearm.children.filter(index => index !== pawIndex);
    chest.children.push(pawIndex);
  });
  clearFirstSkinWeight(path.join(directory, 'zero-weights.glb'));
  const result = runModule(fixture, `
for name, expected in [("compressed.glb", "compression"), ("disconnected.glb", "parent"), ("zero-weights.glb", "skin weights")]:
    try:
        room_importer.validate_companion(Path(${JSON.stringify(directory)}) / name, "cat")
    except ValueError as error:
        assert expected in str(error), str(error)
    else:
        raise AssertionError("accepted invalid companion: " + name)
`);

  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});

test('room and PNG validation reject incomplete generated assets', options, t => {
  const fixture = makeSandbox(t);
  const room = path.join(fixture.sandbox, 'authored-room.glb');
  const valid = path.join(fixture.sandbox, 'valid.png');
  const badCrc = path.join(fixture.sandbox, 'bad-crc.png');
  const truncated = path.join(fixture.sandbox, 'truncated.png');
  const validBytes = validPng();
  const corrupt = Buffer.from(validBytes);
  corrupt[corrupt.length - 5] ^= 0xff;
  fs.writeFileSync(valid, validBytes);
  fs.writeFileSync(badCrc, corrupt);
  fs.writeFileSync(truncated, validBytes.subarray(0, validBytes.length - 8));
  const result = runModule(fixture, `
room = Path(${JSON.stringify(room)})
room_importer.export_room(Path(${JSON.stringify(path.join(fixture.pack, '午后牌室.blend'))}), room)
room_importer.validate_room(room)
original = room.read_bytes()
bin_chunk = original[20 + struct.unpack_from("<I", original, 12)[0]:]

def reject_room(model, expected):
    json_chunk = json.dumps(model, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    room.write_bytes(struct.pack("<4sII", b"glTF", 2, 20 + len(json_chunk) + len(bin_chunk)) +
                     struct.pack("<I4s", len(json_chunk), b"JSON") + json_chunk + bin_chunk)
    try:
        room_importer.validate_room(room)
    except ValueError as error:
        assert expected in str(error), str(error)
    else:
        failures.append("accepted invalid room: " + expected)
    room.write_bytes(original)

failures = []

model, _ = room_importer.read_glb(room)
table = next(node for node in model["nodes"] if node.get("name") == "Walnut tabletop")
primitive = model["meshes"][table["mesh"]]["primitives"][0]
model["materials"][primitive["material"]]["name"] = "Incorrect tabletop"
reject_room(model, "Walnut")

model, _ = room_importer.read_glb(room)
chairs = {i for i, node in enumerate(model["nodes"]) if node.get("name", "").startswith("Chair ")}
assert chairs, "approved room must have chairs"
scene = model["scenes"][model.get("scene", 0)]
scene["nodes"] = [i for i in scene["nodes"] if i not in chairs]
for node in model["nodes"]:
    if "children" in node:
        node["children"] = [i for i in node["children"] if i not in chairs]
model["scenes"].append({"nodes": sorted(chairs)})
reject_room(model, "Chair")

for name in ["Recessed dice well", "Thick blown glass dice cup"]:
    model, _ = room_importer.read_glb(room)
    if any(node.get("name", "").startswith(name) for node in model["nodes"]):
        failures.append("static export includes " + name)
    tabletop = next(node for node in model["nodes"] if node.get("name") == "Walnut tabletop")
    model["scenes"][model.get("scene", 0)]["nodes"].append(len(model["nodes"]))
    model["nodes"].append({"name": name + ".001", "mesh": tabletop["mesh"]})
    reject_room(model, name)

assert not failures, failures

room_importer.validate_png(Path(${JSON.stringify(valid)}))
for invalid in [Path(${JSON.stringify(badCrc)}), Path(${JSON.stringify(truncated)})]:
    try:
        room_importer.validate_png(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("accepted incomplete PNG: " + invalid.name)
`);

  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});

test('PNG validation checks decompressed portrait scanlines and bounded dimensions', options, t => {
  const fixture = makeModuleSandbox(t);
  const valid = path.join(fixture.sandbox, 'valid.png');
  const shortScanlines = path.join(fixture.sandbox, 'short-scanlines.png');
  const oversized = path.join(fixture.sandbox, 'oversized.png');
  fs.writeFileSync(valid, validPng());
  fs.writeFileSync(shortScanlines, pngWithRaw(Buffer.from([0, 0, 0, 0, 0])));
  fs.writeFileSync(oversized, pngWithRaw(Buffer.alloc(192 * (192 * 4 + 1)), 4097, 192));
  const result = runModule(fixture, `
room_importer.validate_png(Path(${JSON.stringify(valid) }))
for invalid in [Path(${JSON.stringify(shortScanlines)}), Path(${JSON.stringify(oversized)})]:
    try:
        room_importer.validate_png(invalid)
    except ValueError:
        pass
    else:
        raise AssertionError("accepted invalid portrait PNG: " + invalid.name)
`);
  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});

test('publication uses an explicit output directory', options, t => {
  const fixture = makeSandbox(t);
  const result = runModule(fixture, `
sys.argv = ["import-room-pack.py", "--", str(Path(${JSON.stringify(fixture.pack)}))]
room_importer.main()
`);
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
});
test('publication refuses to replace an existing output directory', blenderOptions, t => {
  const fixture = makeModuleSandbox(t);
  const result = runModule(fixture, `
stage_root = Path(${JSON.stringify(path.join(fixture.sandbox, "stage"))})
destination = Path(${JSON.stringify(path.join(fixture.sandbox, "assets"))})
stage_root.mkdir()
destination.mkdir()
(stage_root / "room.glb").write_bytes(b"new")
(destination / "room.glb").write_bytes(b"old")
try:
    room_importer.publish(stage_root, destination)
except ValueError as error:
    assert "existing output directory" in str(error)
else:
    raise AssertionError("replaced an existing output directory")
assert (destination / "room.glb").read_bytes() == b"old"
assert (stage_root / "room.glb").read_bytes() == b"new"
`);

  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});

test('publication renames the complete staged asset tree', blenderOptions, t => {
  const fixture = makeModuleSandbox(t);
  const result = runModule(fixture, `
stage_root = Path(${JSON.stringify(path.join(fixture.sandbox, "stage"))})
destination = Path(${JSON.stringify(path.join(fixture.sandbox, "assets"))})
stage_root.mkdir()
(stage_root / "room").mkdir()
(stage_root / "room/afternoon-room.glb").write_bytes(b"room")
real_rename = os.rename
calls = []
def observe_rename(source, target):
    calls.append((Path(source), Path(target)))
    return real_rename(source, target)
os.rename = observe_rename
try:
    room_importer.publish(stage_root, destination)
finally:
    os.rename = real_rename
assert calls == [(stage_root, destination)], calls
assert (destination / "room/afternoon-room.glb").read_bytes() == b"room"
assert not stage_root.exists()
`);

  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});

test('publication leaves no partial destination when the directory rename fails', blenderOptions, t => {
  const fixture = makeModuleSandbox(t);
  const result = runModule(fixture, `
stage_root = Path(${JSON.stringify(path.join(fixture.sandbox, "stage"))})
destination = Path(${JSON.stringify(path.join(fixture.sandbox, "assets"))})
stage_root.mkdir()
(stage_root / "room").mkdir()
(stage_root / "room/afternoon-room.glb").write_bytes(b"complete")
real_rename = os.rename
def fail_rename(source, target):
    raise OSError("injected directory rename failure")
os.rename = fail_rename
try:
    room_importer.publish(stage_root, destination)
except OSError as error:
    assert "injected directory rename failure" in str(error)
else:
    raise AssertionError("ignored directory rename failure")
finally:
    os.rename = real_rename
assert not destination.exists()
assert (stage_root / "room/afternoon-room.glb").read_bytes() == b"complete"
`);

  assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
});
test('legacy rebuilds cannot overwrite the assets they read from', options, t => {
  const fixture = makeSandbox(t);
  const scripts = path.dirname(fixture.script);
  const existing = [roomFile, 'room/machine-console.glb', 'room/afternoon-room.blend',
    ...animals.flatMap(animal => [`companions/${animal}.glb`, `companions/portraits/${animal}.png`])];
  const preserve = seedAssets(fixture, existing);
  const sourceModels = ['mahjong-table.glb', 'tile-back.glb', 'dice.glb', 'glass-dice-cup.glb',
    ...Array.from({ length: 27 }, (_, index) => `tiles/${['wan', 'suo', 'tong'][Math.floor(index / 9)]}-${String(index % 9 + 1).padStart(2, '0')}.glb`)
  ];
  const sourceHashes = new Map();
  for (const file of sourceModels) {
    const original = path.join(root, 'assets/mahjong-3d/glb', file);
    assert.ok(fs.existsSync(original), `Missing source model for legacy room fixture: ${file}`);
    fs.mkdirSync(path.dirname(path.join(fixture.output, file)), { recursive: true });
    fs.copyFileSync(original, path.join(fixture.output, file));
    sourceHashes.set(file, createHash('sha256').update(fs.readFileSync(original)).digest('hex'));
  }
  for (const file of ['build-companions.py', 'build-afternoon-room.py']) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(scripts, file));
    const result = runBlender(['--python', path.join(scripts, file)]);
    assert.equal(result.status, 0, (result.stdout + result.stderr).slice(-3000));
    preserve();
    for (const [asset, hash] of sourceHashes) {
      const source = fs.readFileSync(path.join(fixture.output, asset));
      assert.equal(createHash('sha256').update(source).digest('hex'), hash, asset);
    }
  }
  const legacy = path.join(fixture.sandbox, 'out/legacy-room');
  assert.ok(fs.statSync(path.join(legacy, 'room/afternoon-room.glb')).size > 1000);
  assert.ok(fs.statSync(path.join(legacy, 'room/machine-console.glb')).size > 1000);
  assert.ok(fs.statSync(path.join(legacy, 'room/afternoon-room.blend')).size > 1000);
  for (const animal of animals) {
    assert.ok(fs.statSync(path.join(legacy, `companions/${animal}.glb`)).size > 1000);
    assert.ok(fs.statSync(path.join(legacy, `companions/portraits/${animal}.png`)).size > 1000);
  }
});


test('invalid companion is rejected before any existing assets are replaced', options, t => {
  const fixture = makeSandbox(t);
  fs.writeFileSync(path.join(fixture.pack, '角色', 'cat.glb'), 'not a GLB');
  const preserve = seedAssets(fixture);
  const output = path.join(fixture.sandbox, 'isolated');

  const result = runImporter(fixture, output);

  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  preserve();
  assert.equal(fs.existsSync(output), false);
  assert.match(result.stdout + result.stderr, /cat\.glb/);
});

test('an unused skeleton or a different first clip does not satisfy the runtime contract', options, t => {
  const fixture = makeSandbox(t);
  const preserve = seedAssets(fixture);
  const output = path.join(fixture.sandbox, 'isolated');
  const model = path.join(fixture.pack, '角色', 'rabbit.glb');
  const original = fs.readFileSync(model);
  for (const [edit, expected] of [
    [gltf => {
      const mesh = gltf.nodes.find(node => node.name === 'rabbit');
      const primitive = gltf.meshes[mesh.mesh].primitives[0];
      delete mesh.skin;
      delete primitive.attributes.JOINTS_0;
      delete primitive.attributes.WEIGHTS_0;
      gltf.skins = [];
    }, /rabbit\.glb:.*skin/i],
    [gltf => gltf.animations[0].name = 'Wrong first clip', /rabbit\.glb:.*first clip/],
  ]) {
    fs.writeFileSync(model, original);
    editGlb(model, edit);
    const result = runImporter(fixture, output);
    assert.notEqual(result.status, 0, (result.stdout + result.stderr).slice(-3000));
    assert.match(result.stdout + result.stderr, expected);
    preserve();
    assert.equal(fs.existsSync(output), false);
  }
});

test('publish refuses to replace an existing output directory', options, t => {
  const fixture = makeSandbox(t);
  const output = path.join(fixture.sandbox, 'isolated');
  fs.mkdirSync(output);
  fs.writeFileSync(path.join(output, 'preserve.txt'), 'keep this');
  const result = runImporter(fixture, output);
  assert.notEqual(result.status, 0, (result.stdout + result.stderr).slice(-3000));
  assert.equal(fs.readFileSync(path.join(output, 'preserve.txt'), 'utf8'), 'keep this');
});

test('hidden felt remains in an isolated room export', options, t => {
  const fixture = makeSandbox(t);
  const master = path.join(fixture.pack, '午后牌室.blend');
  const prepare = runBlender([master, '--python-expr', `
import bpy
felt = bpy.context.scene.objects['Empty green felt']
felt.hide_set(True)
felt.hide_select = True
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
`]);
  assert.equal(prepare.status, 0, prepare.stdout + prepare.stderr);
  const output = path.join(fixture.sandbox, 'isolated');

  const result = runImporter(fixture, output);

  assert.equal(result.status, 0, result.stdout + result.stderr);
  const room = glbJson(fs.readFileSync(path.join(output, roomFile)));
  assert.equal(fs.existsSync(path.join(fixture.output, roomFile)), false);
  const felt = room.nodes.find(node => node.name === 'Empty green felt');
  assert.ok(felt, 'felt must be exported as a distinct mesh');
  assert.ok(room.meshes[felt.mesh].primitives.some(primitive => room.materials[primitive.material]?.name === 'Green playing felt'));
  assert.ok(room.nodes.some(node => node.name === 'Walnut tabletop' && node.mesh != null));
  for (const name of ['Recessed dice well', 'Thick blown glass dice cup']) {
    assert.ok(!room.nodes.some(node => node.name?.startsWith(name)), `${name} leaked into the static room`);
  }
  for (const animal of animals) {
    const model = path.join(output, 'companions', animal + '.glb');
    const portrait = path.join(output, 'companions', 'portraits', animal + '.png');
    assert.deepEqual(fs.readFileSync(model), fs.readFileSync(path.join(fixture.pack, '角色', animal + '.glb')));
    assert.deepEqual(fs.readFileSync(portrait).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  }
});
