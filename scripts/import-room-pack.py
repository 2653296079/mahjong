"""Validate and stage the approved afternoon room pack before publishing assets.

Run with Blender 4.5.2 or newer:
  blender -b --factory-startup --disable-autoexec --python-exit-code 1 \\
    --python scripts/import-room-pack.py -- <pack directory> --output-dir <new glb directory>
"""
import argparse
import binascii
import json
import math
import os
from pathlib import Path
import shutil
import struct
import sys
import tempfile
import zlib

import bpy
from mathutils import Vector

ANIMALS = ("cat", "fox", "panda", "rabbit")
REQUIRED_BONES = {"Head", "Chest", "UpperArm.L", "Forearm.L", "Paw.L",
                  "UpperArm.R", "Forearm.R", "Paw.R"}
RUNTIME_BONE_PARENTS = {
    "Chest": "Pelvis", "Head": "Chest",
    "UpperArm.L": "Chest", "Forearm.L": "UpperArm.L", "Paw.L": "Forearm.L",
    "UpperArm.R": "Chest", "Forearm.R": "UpperArm.R", "Paw.R": "Forearm.R",
}
ROOM_PREFIXES = ("Garden", "Window", "Back wall", "Wall base", "Rear wood", "Oak floor",
                 "Right wall", "Left wall", "Shelf", "Side cabinet", "Book spine", "Clay plant",
                 "Plant stem", "Plant leaf", "Pendant", "Paper pendant", "Chair", "Brass foot",
                 "Brass frame", "Empty green felt", "Padded perimeter", "Tapered walnut",
                 "Walnut apron", "Walnut tabletop")
ROOM_RUNTIME_PROPS = ("Recessed dice well", "Thick blown glass dice cup")
ROOM_REQUIRED_MATERIALS = {"Green playing felt", "Walnut", "sage plaster"}
ROOM_REQUIRED_OBJECTS = ("Left wall", "Empty green felt", "Walnut tabletop", "Chair", "Side cabinet",
                         "Shelf", "Paper pendant", "Plant stem")
PORTRAIT_SIZE = 192
MAX_PNG_BYTES = 16 * 1024 * 1024


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pack", type=Path, help="approved pack containing 午后牌室.blend and 角色/*.glb")
    parser.add_argument("--output-dir", type=Path, required=True,
                        help="new GLB asset root; must not already exist")
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    return parser.parse_args(values)


def read_glb(path):
    data = path.read_bytes()
    if len(data) < 20:
        raise ValueError(f"{path.name}: truncated GLB header")
    magic, version, length = struct.unpack_from("<4sII", data)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError(f"{path.name}: invalid GLB 2.0 header or length")
    json_length, chunk_type = struct.unpack_from("<I4s", data, 12)
    if chunk_type != b"JSON" or json_length < 2 or 20 + json_length > len(data):
        raise ValueError(f"{path.name}: missing GLB JSON chunk")
    json_end = 20 + json_length
    try:
        model = json.loads(data[20:json_end])
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError(f"{path.name}: invalid GLB JSON: {error}") from error
    binary = None
    if json_end < len(data):
        if json_end + 8 > len(data):
            raise ValueError(f"{path.name}: truncated GLB binary chunk header")
        binary_length, binary_type = struct.unpack_from("<I4s", data, json_end)
        if binary_type != b"BIN\x00" or json_end + 8 + binary_length != len(data):
            raise ValueError(f"{path.name}: invalid GLB binary chunk")
        binary = data[json_end + 8:]
    return model, binary


def accessor_values(model, binary, accessor_index):
    accessor = model["accessors"][accessor_index]
    if accessor.get("componentType") != 5126 or accessor.get("type") != "VEC4":
        raise ValueError("skin weights must be float VEC4 accessors")
    view = model["bufferViews"][accessor["bufferView"]]
    if view.get("buffer", 0) != 0 or binary is None:
        raise ValueError("skin weights must be in the embedded binary buffer")
    component_size = 4
    element_size = component_size * 4
    stride = view.get("byteStride", element_size)
    if stride < element_size:
        raise ValueError("skin weights have an invalid vertex stride")
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    end = start + stride * (accessor["count"] - 1) + element_size
    if start < 0 or end > len(binary):
        raise ValueError("skin weights exceed the embedded binary buffer")
    for index in range(accessor["count"]):
        offset = start + index * stride
        yield struct.unpack_from("<4f", binary, offset)


def accessor_indices(model, binary, accessor_index, count):
    accessor = model["accessors"][accessor_index]
    if accessor.get("componentType") not in (5121, 5123, 5125) or accessor.get("type") != "VEC4":
        raise ValueError("skin joints must be integer VEC4 accessors")
    view = model["bufferViews"][accessor["bufferView"]]
    size = {5121: 1, 5123: 2, 5125: 4}[accessor["componentType"]]
    element_size = size * 4
    stride = view.get("byteStride", element_size)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    if start + stride * (count - 1) + element_size > len(binary):
        raise ValueError("skin joints exceed the embedded binary buffer")
    for index in range(count):
        offset = start + index * stride
        if size == 1:
            yield struct.unpack_from("<4B", binary, offset)
        elif size == 2:
            yield struct.unpack_from("<4H", binary, offset)
        else:
            yield struct.unpack_from("<4I", binary, offset)


def scene_nodes(model):
    nodes = model["nodes"]
    pending = list(model["scenes"][model.get("scene", 0)].get("nodes", []))
    visited = set()
    while pending:
        index = pending.pop()
        if index not in visited:
            visited.add(index)
            pending.extend(nodes[index].get("children", []))
    return visited


def validate_companion(path, animal):
    model, binary = read_glb(path)
    try:
        if "KHR_draco_mesh_compression" in model.get("extensionsUsed", []):
            raise ValueError("unsupported compression KHR_draco_mesh_compression")
        active = scene_nodes(model)
        nodes = model["nodes"]
        meshes = model.get("meshes", [])
        skins = model.get("skins", [])
        mesh = next((nodes[index] for index in active if nodes[index].get("name") == animal), {})
        if "skin" not in mesh or "mesh" not in mesh:
            raise ValueError("missing a skinned companion mesh in the default scene")
        primitives = meshes[mesh["mesh"]]["primitives"]
        if not primitives or not all({"POSITION", "JOINTS_0", "WEIGHTS_0"} <= primitive["attributes"].keys()
                                     for primitive in primitives):
            raise ValueError("companion mesh is missing skinned vertex attributes")
        skin = skins[mesh["skin"]]
        joints = set(skin["joints"])
        if not joints <= active or not REQUIRED_BONES <= {nodes[index].get("name") for index in joints}:
            raise ValueError("missing the runtime companion skeleton")
        parents = {child: index for index, node in enumerate(nodes) for child in node.get("children", [])}
        joint_names = {nodes[index].get("name") for index in joints}
        if "Pelvis" not in joint_names:
            raise ValueError("runtime skeleton is missing the Pelvis joint")
        for name, expected_parent in RUNTIME_BONE_PARENTS.items():
            joint = next((index for index in joints if nodes[index].get("name") == name), None)
            parent = parents.get(joint)
            if joint is None or parent is None or nodes[parent].get("name") != expected_parent:
                raise ValueError(f"runtime skeleton has an invalid {name} parent link")
        for joint in joints:
            current = joint
            for _ in range(len(nodes) + 1):
                if nodes[current].get("name") == "Pelvis":
                    break
                current = parents.get(current)
                if current is None:
                    break
            else:
                raise ValueError("runtime skeleton parent traversal exceeded node bound")
            if current is None or nodes[current].get("name") != "Pelvis":
                raise ValueError("runtime skeleton has a broken parent chain")
        for primitive in primitives:
            joint_accessor = primitive["attributes"]["JOINTS_0"]
            weight_accessor = primitive["attributes"]["WEIGHTS_0"]
            weights = list(accessor_values(model, binary, weight_accessor))
            if not weights or any(not all(math.isfinite(value) and value >= 0 for value in row) or
                                  sum(row) <= 0.99 or sum(row) >= 1.01 for row in weights):
                raise ValueError("companion mesh has invalid skin weights")
            for row in accessor_indices(model, binary, joint_accessor, len(weights)):
                if any(index >= len(skin["joints"]) for index in row):
                    raise ValueError("companion mesh references an invalid skin joint")
        clips = model.get("animations", [])
        if not clips or clips[0].get("name") != "Seated tile reach" or not any(
            channel["target"].get("node") in joints for channel in clips[0].get("channels", [])
        ):
            raise ValueError("the first clip must be Seated tile reach and animate the companion skeleton")
        if any("uri" in entry for key in ("buffers", "images") for entry in model.get(key, [])):
            raise ValueError("expected embedded buffers and textures")
    except (IndexError, KeyError, TypeError, ValueError) as error:
        raise ValueError(f"{path.name}: {error}") from error


def room_name_matches(name, prefix):
    return name == prefix or name.startswith((prefix + " ", prefix + "."))


def missing_room_objects(names):
    return [prefix for prefix in ROOM_REQUIRED_OBJECTS
            if not any(room_name_matches(name, prefix) for name in names)]


def validate_room(path):
    model, _ = read_glb(path)
    nodes = model["nodes"]
    runtime_props = sorted({node.get("name", "") for node in nodes
                            if any(room_name_matches(node.get("name", ""), prefix)
                                   for prefix in ROOM_RUNTIME_PROPS)})
    if runtime_props:
        raise ValueError(f"{path.name}: static room contains separately loaded props: " +
                         ", ".join(runtime_props))
    meshes = model.get("meshes", [])
    mesh_nodes = {}
    for index in scene_nodes(model):
        node = nodes[index]
        mesh = node.get("mesh")
        if mesh is not None and 0 <= mesh < len(meshes) and meshes[mesh].get("primitives"):
            mesh_nodes[node.get("name", "")] = node
    if "Empty green felt" not in mesh_nodes or "Walnut tabletop" not in mesh_nodes:
        raise ValueError("afternoon-room.glb: missing the distinct felt or walnut tabletop mesh")
    missing = missing_room_objects(mesh_nodes)
    if missing:
        raise ValueError("afternoon-room.glb: missing active room geometry: " + ", ".join(missing))
    materials = model.get("materials", [])
    material_names = {material.get("name") for material in materials}
    if not ROOM_REQUIRED_MATERIALS <= material_names:
        missing = ", ".join(sorted(ROOM_REQUIRED_MATERIALS - material_names))
        raise ValueError(f"afternoon-room.glb: missing authored room materials: {missing}")
    felt = mesh_nodes["Empty green felt"]
    felt_mesh = model.get("meshes", [])[felt["mesh"]]
    felt_materials = {materials[primitive.get("material", -1)].get("name")
                      for primitive in felt_mesh.get("primitives", [])
                      if 0 <= primitive.get("material", -1) < len(materials)}
    if "Green playing felt" not in felt_materials:
        raise ValueError("afternoon-room.glb: the felt mesh is missing Green playing felt")
    tabletop = mesh_nodes["Walnut tabletop"]
    tabletop_mesh = model["meshes"][tabletop["mesh"]]
    tabletop_materials = {materials[primitive.get("material", -1)].get("name")
                          for primitive in tabletop_mesh.get("primitives", [])
                          if 0 <= primitive.get("material", -1) < len(materials)}
    if "Walnut" not in tabletop_materials:
        raise ValueError("afternoon-room.glb: the walnut tabletop is missing Walnut")
    return path


def png_chunks(path):
    if path.stat().st_size > MAX_PNG_BYTES:
        raise ValueError(f"{path.name}: PNG exceeds the {MAX_PNG_BYTES}-byte limit")
    data = path.read_bytes()
    if len(data) < 8 or data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path.name}: invalid PNG signature")
    offset = 8
    seen_header = False
    seen_data = False
    seen_end = False
    width = height = None
    compressed = bytearray()
    while offset < len(data):
        if offset + 12 > len(data):
            raise ValueError(f"{path.name}: truncated PNG chunk")
        length = struct.unpack_from(">I", data, offset)[0]
        end = offset + 12 + length
        if end > len(data):
            raise ValueError(f"{path.name}: PNG chunk exceeds file")
        chunk = data[offset + 4:offset + 8]
        payload = data[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack_from(">I", data, offset + 8 + length)[0]
        actual_crc = binascii.crc32(chunk + payload) & 0xffffffff
        if actual_crc != expected_crc:
            raise ValueError(f"{path.name}: PNG chunk CRC mismatch")
        if chunk == b"IHDR":
            if seen_header or length != 13:
                raise ValueError(f"{path.name}: invalid PNG header chunk")
            width, height, depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            if width != PORTRAIT_SIZE or height != PORTRAIT_SIZE or depth != 8 or color_type != 6 or compression != 0 or filtering != 0 or interlace != 0:
                raise ValueError(f"{path.name}: unsupported portrait PNG format or dimensions")
            seen_header = True
        elif chunk == b"IDAT":
            if not seen_header or seen_end:
                raise ValueError(f"{path.name}: misplaced PNG image data")
            compressed.extend(payload)
            seen_data = True
        elif chunk == b"IEND":
            if length != 0 or not seen_header or not seen_data:
                raise ValueError(f"{path.name}: incomplete PNG")
            seen_end = True
            if end != len(data):
                raise ValueError(f"{path.name}: trailing data after PNG")
            break
        offset = end
    if not seen_end:
        raise ValueError(f"{path.name}: missing PNG end chunk")
    expected = height * (1 + width * 4)
    try:
        decoder = zlib.decompressobj()
        raw = decoder.decompress(bytes(compressed), expected + 1)
    except zlib.error as error:
        raise ValueError(f"{path.name}: invalid PNG image data") from error
    if len(raw) != expected or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail:
        raise ValueError(f"{path.name}: decompressed scanlines are incomplete or exceed {expected} bytes")
    for row in range(height):
        if raw[row * (width * 4 + 1)] > 4:
            raise ValueError(f"{path.name}: unsupported PNG scanline filter")
    return width, height


def validate_png(path):
    png_chunks(path)
    return path


def has_room_object(objects, prefix):
    return any(obj.name == prefix or obj.name.startswith(prefix + " ") or obj.name.startswith(prefix + ".")
               for obj in objects)


def validate_room_source(blend):
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    missing = [prefix for prefix in ROOM_REQUIRED_OBJECTS if not has_room_object(objects, prefix)]
    if missing:
        raise ValueError("approved Blender scene is missing required room geometry: " + ", ".join(missing))
    by_name = {obj.name: obj for obj in objects}
    for object_name, material_name in (("Empty green felt", "Green playing felt"),
                                       ("Walnut tabletop", "Walnut")):
        obj = by_name.get(object_name)
        if obj is None or not any(slot.material and slot.material.name == material_name for slot in obj.material_slots):
            raise ValueError(f"approved Blender scene is missing {material_name} on {object_name}")


def export_room(blend, destination):
    bpy.ops.wm.open_mainfile(filepath=str(blend))
    objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    batches = {}
    for obj in objects:
        if obj.type == "MESH" and (obj.name.startswith(ROOM_PREFIXES) or obj.name.startswith("Chair ")):
            obj.hide_set(False)
            obj.hide_viewport = False
            obj.hide_render = False
            obj.hide_select = False
            material = tuple(slot.material for slot in obj.material_slots)
            category = next((prefix for prefix in ROOM_PREFIXES if obj.name.startswith(prefix)), "other")
            batches.setdefault((material, category), []).append(obj)
    room = []
    for (_, category), objects in batches.items():
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
            bpy.context.view_layer.objects.active = obj
            if obj.modifiers:
                bpy.ops.object.convert(target="MESH")
            obj.select_set(False)
        for obj in objects:
            obj.select_set(True)
        if len(objects) > 1:
            bpy.ops.object.join()
        room.append(bpy.context.view_layer.objects.active)
    if not any(obj.name.startswith("Empty green felt") for obj in room):
        raise ValueError("approved Blender scene is missing the Empty green felt mesh")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in room:
        obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format="GLB",
                              use_selection=True, export_apply=True)


def render_portrait(model, destination, animal):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(model))
    scene = bpy.context.scene
    armature = next((obj for obj in scene.objects if obj.type == "ARMATURE"), None)
    if armature is None:
        raise ValueError(f"{model.name}: missing companion armature")
    scene.frame_set(1)
    chin = armature.matrix_world @ armature.pose.bones["Head"].head
    target = chin + Vector((0, 0, .14))
    bpy.ops.object.camera_add(location=target + Vector((.11, -.89, .09)))
    camera = bpy.context.object
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = .49 if animal in ("panda", "rabbit") else .43
    scene.camera = camera
    for position, energy in [((-.6, -.8, 1.5), 25), ((.6, -.5, 1), 12)]:
        bpy.ops.object.light_add(type="AREA", location=position)
        light = bpy.context.object
        light.data.energy = energy
        light.data.size = .8
        light.rotation_euler = (target - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 12
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 192
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.filepath = str(destination.with_suffix(""))
    bpy.ops.render.render(write_still=True)


def publish(staged_assets, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        raise ValueError(f"refusing to replace existing output directory: {destination}")
    # On Windows rename refuses even a destination created after the check.
    os.rename(staged_assets, destination)


def main():
    args = arguments()
    pack = args.pack.expanduser().resolve()
    blend = pack / "午后牌室.blend"
    models = {animal: pack / "角色" / f"{animal}.glb" for animal in ANIMALS}
    missing = [str(path) for path in (blend, *models.values()) if not path.is_file()]
    if missing:
        raise ValueError("room pack is missing required inputs: " + ", ".join(missing))
    output = args.output_dir.expanduser().absolute()
    destination = output.parent.resolve() / output.name
    if destination.exists() or destination.is_symlink():
        raise ValueError(f"refusing to replace existing output directory: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".room-pack-stage-", dir=destination.parent) as temporary:
        stage_root = Path(temporary)
        approved = stage_root / "approved"
        staged_assets = stage_root / "assets"
        companions = staged_assets / "companions"
        portraits = companions / "portraits"
        room = staged_assets / "room/afternoon-room.glb"
        approved.mkdir()
        portraits.mkdir(parents=True)
        room.parent.mkdir()
        staged_blend = approved / blend.name
        shutil.copyfile(blend, staged_blend)
        staged_models = {animal: companions / model.name for animal, model in models.items()}
        for animal, model in models.items():
            shutil.copyfile(model, staged_models[animal])

        for animal, model in staged_models.items():
            validate_companion(model, animal)
        validate_room_source(staged_blend)
        export_room(staged_blend, room)
        validate_room(room)
        for animal, model in staged_models.items():
            portrait = portraits / f"{animal}.png"
            render_portrait(model, portrait, animal)
            validate_png(portrait)
        publish(staged_assets, destination)
    print(f"ROOM_PACK_PUBLISHED {destination}")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"ROOM_PACK_FAILED: {error}", file=sys.stderr)
        raise
