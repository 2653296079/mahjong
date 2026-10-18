"""Build editable, meter-scale mahjong assets with Blender 4.5; no paid services.
Run: blender --background --factory-startup --python build-assets.py
The SVG faces come from the project's reviewed artwork, not the AI product shots.
"""
import bpy
import json
import math
import re
import random
import xml.etree.ElementTree as ET
from pathlib import Path
from mathutils import Vector

ET.register_namespace('', 'http://www.w3.org/2000/svg')

SOURCE = Path(__file__).resolve().parent
OUT = SOURCE.parent
GLB = OUT / 'glb'
PREVIEWS = OUT / 'previews'
for directory in (GLB / 'tiles', PREVIEWS, OUT / 'textures', SOURCE / 'prepared-svg'):
    directory.mkdir(parents=True, exist_ok=True)
FACES = json.loads((SOURCE / 'faces.json').read_text(encoding='utf-8'))
FONT_FILE = Path('C:/Windows/Fonts/simkai.ttf')
if not FONT_FILE.exists():
    raise RuntimeError('Set FONT_FILE to a Chinese regular-script TTF before building.')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.preferences.addon_enable(module='io_curve_svg')
SCENE = bpy.context.scene
SCENE.unit_settings.system = 'METRIC'
SCENE.unit_settings.scale_length = 1.0
SCENE.render.engine = 'CYCLES'
SCENE.cycles.device = 'CPU'
SCENE.cycles.samples = 32
SCENE.cycles.use_denoising = True
SCENE.render.threads_mode = 'FIXED'
SCENE.render.threads = 6
SCENE.render.image_settings.file_format = 'PNG'
SCENE.render.resolution_percentage = 100
SCENE.view_settings.view_transform = 'AgX'
SCENE.view_settings.look = 'AgX - Medium High Contrast'
SCENE.world = bpy.data.worlds.new('Studio world')
SCENE.world.use_nodes = True
SCENE.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.78, 0.82, 0.84, 1)
SCENE.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.65

def linear(v):
    return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4

def rgba(hex_color):
    s = hex_color.lstrip('#')
    if len(s) == 3:
        s = ''.join(c * 2 for c in s)
    return tuple(linear(int(s[i:i+2], 16) / 255) for i in (0, 2, 4)) + (1,)

def material(name, color, roughness=0.32, metallic=0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = rgba(color)
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = rgba(color)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metallic
    return m

IVORY = material('Ivory resin', '#f8f2e2', 0.24)
JADE = material('Jade green resin', '#185445', 0.25)
GREEN = material('Green ink', '#166149', 0.35)
RED = material('Cinnabar red ink', '#b62f38', 0.35)
BLACK = material('Black ink', '#242725', 0.35)
BRASS = material('Satin brass', '#b69753', 0.27, 0.78)
PAD = material('Forest green padded rail', '#263f36', 0.44)
FELT = material('Green playing felt', '#185b45', 0.91)
WOOD = material('Walnut', '#513022', 0.38)
FLOOR = material('Studio floor', '#e9e8e1', 0.9)
INKS = {'#f8f2e2': IVORY, '#166149': GREEN, '#b62f38': RED, '#242725': BLACK,
        '#071e18': GREEN, '#082e22': GREEN, '#fff8d8': IVORY}
FONT = bpy.data.fonts.load(str(FONT_FILE))

def parent_to(obj, root):
    obj.parent = root
    return obj

def root_object(name):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.empty_display_size = 0.03
    root['asset_id'] = name
    root['units'] = 'meters'
    return root

def activate(obj):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj

def finish_mesh(obj, bevel=0, segments=3):
    activate(obj)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Soft physical edge', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        bpy.ops.object.modifier_apply(modifier=mod.name)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    mod = obj.modifiers.new('Weighted corner normals', 'WEIGHTED_NORMAL')
    mod.keep_sharp = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    if WOOD in list(obj.data.materials):
        uv = obj.data.uv_layers.active or obj.data.uv_layers.new(name='Wood UV')
        for poly in obj.data.polygons:
            for loop in poly.loop_indices:
                co = obj.data.vertices[obj.data.loops[loop].vertex_index].co
                if abs(poly.normal.z) > 0.7:
                    uv.data[loop].uv = (co.x*3,co.y*3)
                else:
                    uv.data[loop].uv = ((co.x if abs(poly.normal.y)>0.7 else co.y)*8,co.z*2)
    return obj

def cube(name, dims, pos, mat, root=None, bevel=0.001):
    bpy.ops.mesh.primitive_cube_add(size=1, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dims
    obj.data.materials.append(mat)
    finish_mesh(obj, bevel)
    if root:
        parent_to(obj, root)
    return obj

def cylinder(name, radius, depth, pos, mat, root=None, bevel=0.0003):
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=radius, depth=depth, location=pos)
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    finish_mesh(obj, bevel)
    if root:
        parent_to(obj, root)
    return obj

def text_mesh(name, body, size, center, mat, root):
    data = bpy.data.curves.new(name, 'FONT')
    data.body = body
    data.font = FONT
    data.align_x = 'CENTER'
    data.size = size
    data.resolution_u = 5
    data.extrude = 0.000004
    data.bevel_depth = 0.000002
    data.bevel_resolution = 1
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    activate(obj)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.object
    bounds = [Vector(c) for c in obj.bound_box]
    mid = Vector(((min(v.x for v in bounds)+max(v.x for v in bounds))/2,
                  (min(v.y for v in bounds)+max(v.y for v in bounds))/2, 0))
    for vertex in obj.data.vertices:
        vertex.co -= mid
    obj.location = center
    parent_to(obj, root)
    return obj

def descendants(root):
    return [root] + list(root.children_recursive)

def join_art(objects, root, name):
    meshes = []
    for obj in objects:
        activate(obj)
        if obj.type == 'CURVE':
            bpy.ops.object.convert(target='MESH')
        if obj.type == 'MESH' and len(obj.data.polygons):
            meshes.append(obj)
        elif obj.type == 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)
    if not meshes:
        raise RuntimeError('No front artwork for '+name)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    obj = bpy.context.object
    obj.name = name + '_face_inlays'
    parent_to(obj, root)
    return obj

def import_face(asset, root):
    """Use native SVG curves; turn SVG strokes into thin, flattened mesh inlays.
    The importer supports fills but omits stroke materials, so restore those here.
    """
    svg = ET.fromstring((SOURCE / 'svg' / (asset['id']+'.svg')).read_text(encoding='utf-8'))
    svg.set('width', '48mm')
    svg.set('height', '64mm')
    styles = {}
    sequence = [0]
    bg = ET.Element('{http://www.w3.org/2000/svg}rect',
                    {'id':'extent_marker', 'x':'0','y':'0','width':'48','height':'64','fill':'#f8f2e2'})
    svg.insert(0, bg)
    def annotate(node, inherited):
        style = inherited.copy()
        for key in ('fill','stroke','stroke-width','stroke-opacity'):
            if key in node.attrib:
                style[key] = node.attrib[key]
        if node.tag.split('}')[-1] in ('path','circle','rect','ellipse','polygon','polyline'):
            sequence[0] += 1
            ident = 'face_%03d' % sequence[0]
            if node is bg:
                ident = 'extent_marker'
            node.set('id', ident)
            styles[ident] = dict(style, order=sequence[0])
        for child in node:
            annotate(child, style)
    annotate(svg, {'fill':'#000000','stroke':'none','stroke-width':'1','stroke-opacity':'1'})
    prepared = SOURCE / 'prepared-svg' / (asset['id']+'.svg')
    ET.ElementTree(svg).write(prepared, encoding='utf-8', xml_declaration=True)
    before = set(bpy.data.objects)
    bpy.ops.import_curve.svg(filepath=str(prepared))
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == 'CURVE']
    marker = next(obj for obj in imported if obj.name.split('.')[0] == 'extent_marker')
    corners = [marker.matrix_world @ Vector(c) for c in marker.bound_box]
    xmin,xmax = min(c.x for c in corners),max(c.x for c in corners)
    ymin,ymax = min(c.y for c in corners),max(c.y for c in corners)
    scale = 0.023 / (xmax - xmin)
    center = Vector(((xmin+xmax)/2, (ymin+ymax)/2, 0))
    objects = []
    for obj in imported:
        ident = obj.name.split('.')[0]
        if ident == 'extent_marker':
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        style = styles[ident]
        fill, stroke = style.get('fill','none'), style.get('stroke','none')
        has_fill = fill != 'none'
        opacity = float(style.get('stroke-opacity',1))
        has_stroke = stroke != 'none' and opacity >= 0.4
        variants = []
        if has_fill:
            obj.data.dimensions = '2D'
            obj.data.fill_mode = 'BOTH'
            obj.data.extrude = 0
            obj.data.bevel_depth = 0
            obj.data.materials.clear()
            obj.data.materials.append(INKS.get(fill, GREEN))
            variants.append(obj)
        if has_stroke:
            line = obj.copy()
            line.data = obj.data.copy()
            bpy.context.collection.objects.link(line)
            line.name = ident + '_stroke'
            line.data.dimensions = '3D'
            line.data.fill_mode = 'FULL'
            # Input SVG uses mm; scaling to the physical tile happens after conversion.
            line.data.bevel_depth = float(style.get('stroke-width',1)) * 0.001 / 2
            line.data.bevel_resolution = 1
            line.data.resolution_u = 5
            line.data.use_fill_caps = True
            line.data.materials.clear()
            line.data.materials.append(INKS.get(stroke, GREEN))
            variants.append(line)
        if not has_fill:
            bpy.data.objects.remove(obj, do_unlink=True)
        for index, part in enumerate(variants):
            activate(part)
            bpy.ops.object.convert(target='MESH')
            part = bpy.context.object
            transform = part.matrix_world.copy()
            for vertex in part.data.vertices:
                world = transform @ vertex.co
                vertex.co = ((world.x-center.x)*scale,
                             (world.y-center.y)*scale,
                             0.018015 + style['order']*0.00000025 + index*0.0000001 + world.z*scale*0.018)
            part.matrix_world.identity()
            objects.append(part)
    return join_art(objects, root, asset['id'])

def tile(asset=None, back=False):
    ident = asset['id'] if asset else 'tile-back'
    root = root_object(ident)
    root['kind'] = asset['kind'] if asset else -1
    root['front'] = 'Blender +Z / glTF +Y'
    if back:
        cube(ident+'_ivory', (0.026,0.034,0.014), (0,0,0.007), IVORY, root, 0.0011)
        cube(ident+'_back', (0.026,0.034,0.004), (0,0,0.016), JADE, root, 0.0011)
    else:
        cube(ident+'_back', (0.026,0.034,0.004), (0,0,0.002), JADE, root, 0.0011)
        cube(ident+'_ivory', (0.026,0.034,0.014), (0,0,0.011), IVORY, root, 0.0011)
    if asset:
        if asset['suit'] == 'wan':
            numeral = ['一','二','三','四','伍','六','七','八','九'][asset['rank']-1]
            arts = [text_mesh(ident+'_rank', numeral, 0.017, (0,0.0078,0.01802), BLACK, root),
                    text_mesh(ident+'_wan', '萬', 0.0158, (0,-0.0074,0.01802), RED, root)]
            join_art(arts, root, ident)
        else:
            import_face(asset, root)
    return root

def rounded_loop(size, radius, steps=8):
    points = []
    h = size / 2
    for cx,cy,start in ((h-radius,h-radius,0),(-h+radius,h-radius,90),
                        (-h+radius,-h+radius,180),(h-radius,-h+radius,270)):
        for i in range(steps+1):
            theta = math.radians(start+i*90/steps)
            points.append((cx+radius*math.cos(theta), cy+radius*math.sin(theta)))
    return points

def rounded_ring(name, outer, inner, radius, height, z, mat, root):
    outside = rounded_loop(outer, radius)
    inside = rounded_loop(inner, max(0.008, radius-(outer-inner)/2))
    n = len(outside)
    verts = [(x,y,z+dz) for dz,loop in ((-height/2,outside),(-height/2,inside),
                                      (height/2,outside),(height/2,inside)) for x,y in loop]
    faces = []
    for i in range(n):
        j = (i+1)%n
        faces += [(i,j,2*n+j,2*n+i), (n+j,n+i,3*n+i,3*n+j),
                  (2*n+i,2*n+j,3*n+j,3*n+i), (j,i,n+i,n+j)]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(verts,[],faces)
    mesh.update()
    obj = bpy.data.objects.new(name,mesh)
    bpy.context.collection.objects.link(obj)
    mesh.materials.append(mat)
    finish_mesh(obj, min(height*0.2,0.005),3)
    parent_to(obj,root)
    return obj

def grain_texture():
    random.seed(3207)
    size = 256
    img = bpy.data.images.new('Walnut grain', width=size, height=size)
    pixels = []
    for y in range(size):
        for x in range(size):
            phase = x*0.25 + 2.5*math.sin(y*0.022) + 0.7*math.sin(y*0.079)
            tone = 0.88 + 0.11*math.sin(phase) + 0.045*math.sin(phase*3.7) + random.random()*0.025
            # Image pixels are stored as sRGB samples; the texture node decodes them.
            pixels += [0.34*tone,0.19*tone,0.115*tone,1]
    img.pixels = pixels
    img.filepath_raw = str(OUT / 'textures' / 'walnut.png')
    img.file_format = 'PNG'
    img.save()
    tex = WOOD.node_tree.nodes.new('ShaderNodeTexImage')
    tex.image = img
    WOOD.node_tree.links.new(tex.outputs['Color'],WOOD.node_tree.nodes['Principled BSDF'].inputs['Base Color'])

def table():
    root = root_object('mahjong-table')
    root['playing_surface_z'] = 0.758
    cube('Walnut tabletop', (1.075,1.075,0.052), (0,0,0.714), WOOD, root, 0.025)
    cube('Walnut apron', (1.035,1.035,0.105), (0,0,0.647), WOOD, root, 0.020)
    cube('Empty green felt', (0.917,0.917,0.012), (0,0,0.752), FELT, root, 0.018)
    rounded_ring('Padded perimeter',1.10,0.90,0.065,0.038,0.757,PAD,root)
    rounded_ring('Brass frame accent',1.080,1.072,0.033,0.0035,0.719,BRASS,root)
    for x in (-0.455,0.455):
        for y in (-0.455,0.455):
            verts = [(x+dx*w/2,y+dy*w/2,z) for z,w in ((0.025,0.055),(0.665,0.078))
                     for dx,dy in ((-1,-1),(1,-1),(1,1),(-1,1))]
            mesh = bpy.data.meshes.new('Tapered walnut leg')
            mesh.from_pydata(verts,[],[(0,3,2,1),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)])
            mesh.update()
            obj = bpy.data.objects.new('Tapered walnut leg',mesh)
            bpy.context.collection.objects.link(obj)
            mesh.materials.append(WOOD)
            finish_mesh(obj,0.005,3)
            parent_to(obj,root)
            cube('Brass foot cap',(0.057,0.057,0.026),(x,y,0.013),BRASS,root,0.004)
    return root

def dealer():
    root = root_object('dealer-marker')
    cylinder('Green dealer rim',0.0225,0.008,(0,0,0.004),JADE,root)
    cylinder('Ivory dealer top',0.0217,0.0012,(0,0,0.0076),IVORY,root)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.0219,minor_radius=0.0004,
                                   major_segments=64,minor_segments=8,location=(0,0,0.008))
    obj = bpy.context.object
    obj.name = 'Brass dealer rim'
    obj.data.materials.append(BRASS)
    parent_to(obj,root)
    text_mesh('Dealer character','庄',0.030,(0,0,0.00823),RED,root)
    return root

def die():
    root = root_object('dice')
    body = cube('Rounded ivory die',(0.016,0.016,0.016),(0,0,0.008),IVORY,root,0.0014)
    layouts = {1:[(0,0)],2:[(-1,-1),(1,1)],3:[(-1,-1),(0,0),(1,1)],
               4:[(-1,-1),(1,-1),(-1,1),(1,1)],
               5:[(-1,-1),(1,-1),(0,0),(-1,1),(1,1)],
               6:[(-1,-1),(1,-1),(-1,0),(1,0),(-1,1),(1,1)]}
    specs = [(1,Vector((0,0,1)),Vector((1,0,0)),Vector((0,1,0))),
             (6,Vector((0,0,-1)),Vector((1,0,0)),Vector((0,-1,0))),
             (4,Vector((0,-1,0)),Vector((1,0,0)),Vector((0,0,1))),
             (3,Vector((0,1,0)),Vector((-1,0,0)),Vector((0,0,1))),
             (2,Vector((1,0,0)),Vector((0,1,0)),Vector((0,0,1))),
             (5,Vector((-1,0,0)),Vector((0,-1,0)),Vector((0,0,1)))]
    cutters = []
    center = Vector((0,0,0.008))
    radius, outside = 0.00108, 0.00047
    edge = math.sqrt(radius*radius-outside*outside)
    for number,normal,u,v in specs:
        mat = RED if number in (1,4) else BLACK
        for px,py in layouts[number]:
            face = center + normal*0.008 + u*(px*0.0038) + v*(py*0.0038)
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32,ring_count=20,radius=radius,
                                                location=face+normal*outside)
            cutters.append(bpy.context.object)
            # Keep paint just inside the faceted boolean cavity, so the die's
            # white surface cannot occlude it due to sphere tessellation error.
            paint_radius = radius-0.00005
            paint_edge = math.sqrt(paint_radius*paint_radius-outside*outside)
            vertices = [tuple(face+normal*(outside-paint_radius))]
            segments,rings = 24,5
            for ring in range(1,rings+1):
                rr = paint_edge*0.985*ring/rings
                depth = outside-math.sqrt(paint_radius*paint_radius-rr*rr)
                for s in range(segments):
                    a = 2*math.pi*s/segments
                    vertices.append(tuple(face+normal*depth+u*(rr*math.cos(a))+v*(rr*math.sin(a))))
            faces = [(0,1+s,1+(s+1)%segments) for s in range(segments)]
            for ring in range(rings-1):
                a,b = 1+ring*segments,1+(ring+1)*segments
                faces += [(a+s,a+(s+1)%segments,b+(s+1)%segments,b+s) for s in range(segments)]
            mesh = bpy.data.meshes.new('Recessed ink pip')
            mesh.from_pydata(vertices,[],faces)
            mesh.update()
            obj = bpy.data.objects.new('Red pip' if number in (1,4) else 'Black pip',mesh)
            bpy.context.collection.objects.link(obj)
            mesh.materials.append(mat)
            for poly in mesh.polygons:
                poly.use_smooth = True
            parent_to(obj,root)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in cutters:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]
    bpy.ops.object.join()
    cutter = bpy.context.object
    activate(body)
    modifier = body.modifiers.new('Twenty-one recessed pips','BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.solver = 'EXACT'
    modifier.object = cutter
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter,do_unlink=True)
    return root

def bounds(root):
    verts = [obj.matrix_world @ v.co for obj in descendants(root) if obj.type=='MESH' for v in obj.data.vertices]
    return {'min':[min(v[i] for v in verts) for i in range(3)],
            'max':[max(v[i] for v in verts) for i in range(3)]}

def export_asset(root, filename, chinese_name):
    bpy.context.view_layer.update()
    objects = descendants(root)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    destination = GLB / filename
    bpy.ops.export_scene.gltf(filepath=str(destination),export_format='GLB',use_selection=True,
                             export_yup=True,export_apply=True,export_extras=True,
                             export_materials='EXPORT',export_cameras=False,export_lights=False)
    triangles = 0
    for obj in objects:
        if obj.type == 'MESH':
            obj.data.calc_loop_triangles()
            triangles += len(obj.data.loop_triangles)
    return {'id':root.name,'name':chinese_name,'file':filename,'triangles':triangles,
            'bytes':destination.stat().st_size,'boundsBlenderMeters':bounds(root)}

def studio_camera(location, target, ortho):
    camera = next((o for o in bpy.data.objects if o.type=='CAMERA'),None)
    if camera is None:
        bpy.ops.object.camera_add()
        camera = bpy.context.object
        camera.name = 'Preview camera'
    camera.location = location
    camera.rotation_euler = (Vector(target)-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = ortho
    camera.data.clip_start = 0.001
    SCENE.camera = camera
    return camera

def area(name, position, power, size, target=(0,0,0)):
    data = bpy.data.lights.new(name,'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name,data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    return obj

def render(name, location, target, ortho, width, height):
    studio_camera(location,target,ortho)
    SCENE.render.resolution_x = width
    SCENE.render.resolution_y = height
    SCENE.render.filepath = str(PREVIEWS / name)
    bpy.ops.render.render(write_still=True)
    print('RENDERED',name,flush=True)

print('BUILDING_TILE_MESHES',flush=True)
catalog = []
tile_roots = []
for asset in FACES:
    root = tile(asset)
    catalog.append(export_asset(root,'tiles/'+asset['id']+'.glb',asset['name']))
    tile_roots.append(root)
    # Move completed assets away while constructing at the origin.
    root.location = (asset['kind']*0.04,2,0)
    print('BUILT',asset['id'],flush=True)
back = tile(back=True)
catalog.append(export_asset(back,'tile-back.glb','绿色牌背'))
back.location.y = 2.2
die_root = die()
catalog.append(export_asset(die_root,'dice.glb','中式骰子'))
die_root.location.y = 2.3
dealer_root = dealer()
catalog.append(export_asset(dealer_root,'dealer-marker.glb','庄家标'))
dealer_root.location.y = 2.4
grain_texture()
table_root = table()
catalog.append(export_asset(table_root,'mahjong-table.glb','麻将桌'))

for i,root in enumerate(tile_roots):
    root.location = ((i%9-4)*0.040,(1-i//9)*0.055,0.759)
back.location = (-0.10,-0.20,0.759)
die_root.location = (0,-0.20,0.759)
dealer_root.location = (0.08,-0.20,0.759)
cube('Studio floor',(200,200,0.02),(0,0,-0.011),FLOOR,bevel=0)
area('Large softbox',(-1.6,-2.0,3.0),160,2.4,target=(0,0,0.7))
area('Soft fill',(1.7,0.4,2.0),85,2.2,target=(0,0,0.7))
studio_camera((1.45,-1.65,1.7),(0,0,0.43),1.68)
SCENE.render.resolution_x = 1400
SCENE.render.resolution_y = 1200
for collection in list(bpy.data.collections):
    if collection.name != 'Collection' and not collection.objects and not collection.children:
        bpy.data.collections.remove(collection)
# Only the resulting glyph meshes are distributed, never the system font file.
for curve in list(bpy.data.curves):
    if curve.users == 0:
        bpy.data.curves.remove(curve)
for font in list(bpy.data.fonts):
    if font.users == 0 and font.filepath:
        bpy.data.fonts.remove(font)
bpy.ops.file.pack_all()
blend_file = OUT / 'mahjong-assets-v1.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend_file))
report = {'generator':'Blender '+bpy.app.version_string,'units':'meters','glTF_up_axis':'+Y',
          'tile_face_normal_glTF':'+Y','tile_dimensions_m':[0.026,0.018,0.034],
          'artwork':'Reviewed native SVGs from index.html; Chinese glyphs converted to meshes.',
          'tile_count':27,'asset_count':len(catalog),'assets':catalog}
(OUT / 'catalog.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('SAVED_SOURCE_AND_31_GLBS',flush=True)

# Verify real interchange files: reimport every GLB and render these imported meshes.
bpy.ops.object.select_all(action='DESELECT')
for root in tile_roots+[back,die_root,dealer_root,table_root]:
    for obj in descendants(root):
        obj.select_set(True)
bpy.ops.object.delete()
reimported = {}
for asset in catalog:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(GLB / asset['file']))
    objects = [o for o in bpy.data.objects if o not in before]
    top = [o for o in objects if o.parent is None]
    holder = root_object('verified_'+asset['id'])
    for obj in top:
        obj.parent = holder
    reimported[asset['id']] = holder
    if not any(o.type=='MESH' for o in objects):
        raise RuntimeError('Empty exported GLB: '+asset['id'])
print('REIMPORTED_ALL_31_GLBS',flush=True)

for i,asset in enumerate(FACES):
    reimported[asset['id']].location = ((i%9-4)*0.036,(1-i//9)*0.052,0)
for name in ('mahjong-table','dice','dealer-marker','tile-back'):
    for obj in descendants(reimported[name]):
        obj.hide_render = True
render('tiles-overview.png',(0,-0.28,0.69),(0,0,0.008),0.365,1800,1100)
for name,root in reimported.items():
    for obj in descendants(root):
        obj.hide_render = name != 'mahjong-table'
render('table-preview.png',(1.45,-1.65,1.7),(0,0,0.42),1.67,1300,1300)
for name,root in reimported.items():
    for obj in descendants(root):
        obj.hide_render = name not in ('dice','dealer-marker','tile-back')
reimported['tile-back'].location = (-0.043,0,0)
reimported['dice'].location = (0,0,0)
reimported['dealer-marker'].location = (0.045,0,0)
render('accessories-preview.png',(0,-0.13,0.22),(0,0,0.007),0.145,1400,850)
report['verification'] = {'glb_reimports':len(reimported),'previews_rendered_from_reimported_glb':True}
(OUT / 'catalog.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
print('BUILD_COMPLETE',flush=True)
