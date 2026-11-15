"""Build the editable complete afternoon mahjong room and game-ready exports.
Blender 4.5: --background --factory-startup --python scripts/build-afternoon-room.py
"""
import bpy, math, os, random
from mathutils import Vector
ROOT=os.path.abspath(os.path.join(os.path.dirname(__file__),'..'))
ASSETS=os.path.join(ROOT,'assets/mahjong-3d/glb')
OUT=os.path.join(ASSETS,'room');os.makedirs(OUT,exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
def xyz(p):return (p[0],-p[2],p[1])
def mat(name,c,rough=.8,metal=0):
    m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True
    p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if p is None:
        p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled');o=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs[0],o.inputs['Surface'])
    p.inputs['Base Color'].default_value=(*c,1);p.inputs['Roughness'].default_value=rough;p.inputs['Metallic'].default_value=metal
    return m
def box(name,p,s,m,bevel=.004):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.name=name;o.scale=(s[0],s[2],s[1]);o.data.materials.append(m)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    if bevel:
        b=o.modifiers.new('Soft edges','BEVEL');b.width=bevel;b.segments=2;o.modifiers.new('Normals','WEIGHTED_NORMAL')
    return o
def ball(name,p,s,m):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20,ring_count=12,location=xyz(p));o=bpy.context.object;o.name=name;o.scale=(s[0],s[2],s[1]);o.data.materials.append(m)
    for f in o.data.polygons:f.use_smooth=True
    return o
def rod(name,a,b,r,m):
    a,b=Vector(xyz(a)),Vector(xyz(b));d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=r,depth=d.length,location=(a+b)/2);o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m)
    for f in o.data.polygons:f.use_smooth=True
    return o
def import_glb(file):
    before=set(bpy.data.objects);bpy.ops.import_scene.gltf(filepath=file);return list(set(bpy.data.objects)-before)
def group(name,objects):
    bpy.ops.object.empty_add();g=bpy.context.object;g.name=name
    for o in objects:
        if not o.parent:o.parent=g
    return g
def select_export(file,objects):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.ops.export_scene.gltf(filepath=file,export_format='GLB',use_selection=True,export_yup=True,export_apply=True)
wood=mat('warm walnut',(.23,.12,.060),.62);darkwood=mat('walnut shadow',(.12,.065,.035),.75)
wall=mat('sage plaster',(.16,.24,.18));ivory=mat('warm ivory',(.87,.79,.62),.45)
jade=mat('machine jade polymer',(.035,.105,.075),.55);brass=mat('brushed brass',(.43,.31,.14),.38,.65)
glass=mat('dice well clear glass',(.83,.90,.86),.12)
gp=next(n for n in glass.node_tree.nodes if n.type=='BSDF_PRINCIPLED');gp.inputs['Transmission Weight'].default_value=.85;gp.inputs['IOR'].default_value=1.46
sky=mat('sunlit window',(.70,.78,.55));leaf=mat('leaf green',(.10,.21,.075));pot=mat('terracotta',(.35,.17,.09))
# Authored color and roughness maps remain embedded in GLB and the editable master.
# Fine material variation is independent of coarse modeled edges and seams.
def walnut_maps(material):
    n=256;rng=random.Random(618033);color=[];rough=[]
    for y in range(n):
        for x in range(n):
            vein=math.sin(y*.28+2*math.sin(x*.018)+.6*math.sin(y*.075))
            pores=(rng.random()-.5)*.045
            value=.91+vein*.09+pores
            color.extend((.30*value,.145*value,.062*value,1))
            r=.63+vein*.018+pores;rough.extend((r,r,r,1))
    nodes=material.node_tree.nodes;p=next(a for a in nodes if a.type=='BSDF_PRINCIPLED')
    for name,pixels,socket in [('Walnut grain',color,'Base Color'),('Walnut roughness',rough,'Roughness')]:
        image=bpy.data.images.new(name,width=n,height=n);image.colorspace_settings.name='Non-Color';image.pixels[:]=pixels;image.pack()
        tex=nodes.new('ShaderNodeTexImage');tex.image=image;material.node_tree.links.new(tex.outputs['Color'],p.inputs[socket])
walnut_maps(wood)
# Room envelope and plank floor. Back wall window is a real opening, not a texture.
for i in range(22):box('Oak floor plank %02d'%i,(0,-.024,-2.1+i*.2),(4.4,.04,.197),wood if i%3 else darkwood,.002)
box('Back wall left',(-1.94,1.4,-1.85),(.52,2.8,.10),wall)
box('Back wall right',(1.29,1.4,-1.85),(1.82,2.8,.10),wall)
box('Window sill wall',(-.64,.36,-1.85),(2.08,.72,.10),wall)
box('Window header',(-.64,2.30,-1.85),(2.08,1,.10),wall)
box('Right wall',(2.18,1.4,0),(.10,2.8,3.8),wall)
box('Left wall',(-2.18,1.4,0),(.10,2.8,3.8),wall)
for x in [-2.1,2.1]:box('Wall base trim',(x,.14,0),(.045,.28,3.8),darkwood)
box('Rear wood wainscot',(0,.20,-1.78),(4.3,.40,.035),darkwood)
for x in [-1.70,-1.18,-.66,-.14,.38]:box('Window mullion',(x,1.28,-1.80),(.045,1.16,.09),wood)
for y in [.72,1.28,1.86]:box('Window transom',(-.66,y,-1.80),(2.12,.045,.09),wood)
box('Window sill',(-.66,.70,-1.72),(2.20,.065,.23),wood)
backdrop=box('Garden light beyond window',(-.66,1.35,-3.0),(4.0,2.5,.01),sky)
backdrop.visible_shadow=False
garden_rng=random.Random(7219)
leaf_light=mat('sunlit leaf',(.25,.36,.10));leaf_dark=mat('leaf shadow',(.065,.14,.045))
for bush in range(5):
    cx=-1.65+bush*.48;cy=.9+(bush%2)*.25;cz=-2.35-(bush%3)*.08
    rod('Garden branch',(cx,.55,cz),(cx+.06,cy+.28,cz),.013,darkwood)
    for i in range(45):
        a=garden_rng.random()*math.tau;rr=math.sqrt(garden_rng.random())*.28
        x=cx+math.cos(a)*rr;y=cy+math.sin(a)*rr;z=cz+(garden_rng.random()-.5)*.22
        o=ball('Garden leaf',(x,y,z),(.040,.010,.018),[leaf,leaf_light,leaf_dark][i%3])
        o.rotation_euler=(garden_rng.random()*.6,garden_rng.random()*.6,a)
# Side cabinet, books, plant and pendant anchor the room without covering the table.
box('Side cabinet',(1.68,.46,-1.18),(.68,.92,.36),wood)
for y in [.10,.48,.89]:box('Shelf',(1.68,y,-1.17),(.62,.035,.34),darkwood)
for i in range(7):box('Book spine',(1.42+i*.065,.66,-1.26),(.047,.25+(i%3)*.02,.16),ivory if i%2 else jade)
rod('Clay plant pot',(-1.57,.71,-1.60),(-1.57,.87,-1.60),.09,pot)
for i in range(14):
    a=i*2.4;x=-1.57+math.sin(a)*.13;z=-1.60+math.cos(a)*.12;y=.90+(i%4)*.07
    rod('Plant stem',(-1.57,.86,-1.60),(x,y,z),.003,leaf)
    o=ball('Plant leaf',(x,y,z),(.063,.018,.028),leaf);o.rotation_euler.z=a
rod('Pendant cord',(.15,2.45,-.1),(.15,2.02,-.1),.006,darkwood)
ball('Paper pendant',(.15,2.01,-.1),(.20,.10,.20),ivory)
environment=list(bpy.data.objects)
table=import_glb(os.path.join(ASSETS,'mahjong-table.glb'));environment+=table
for o in table:
    if o.type=='MESH':
        for slot in o.material_slots:
            if slot.material and 'padded rail' in slot.material.name.lower():slot.material=wood
select_export(os.path.join(OUT,'afternoon-room.glb'),environment)
# Central machine console: modeled in Blender, exported separately for lift animation.
before=set(bpy.data.objects)
rod('Console perimeter seam',(0,.760,0),(0,.766,0),.116,darkwood)
rod('Console brass rim',(0,.765,0),(0,.770,0),.112,brass)
rod('Console jade lid',(0,.770,0),(0,.775,0),.108,jade)
rod('Recessed dice well',(0,.775,0),(0,.777,0),.055,darkwood)
for i in range(4):
    a=i*math.pi/2;x=math.sin(a)*.084;z=math.cos(a)*.084
    box('Dice key %s'%i,(x,.781,z),(.024,.009,.019),ivory,.005)
    for j in range(i+1):ball('Engraved dice pip',(x+(j%2-.5)*.007,.786,z+(j//2-.5)*.006),(.002,.001,.002),darkwood)
for x in [-.040,.040]:box('Lift control',(x,.781,.055),(.020,.008,.015),jade,.004)
ball('Amber indicator',(0,.781,.075),(.003,.002,.003),brass)
console=list(set(bpy.data.objects)-before)
# Export lid in local coordinates; preserve its assembled height in the .blend.
for o in console:o.location.z-=.759
select_export(os.path.join(OUT,'machine-console.glb'),console)
for o in console:o.location.z+=.759
# Complete assembled cast for the editable master and render.
cast=['cat','fox','panda','rabbit'];fur_colors=[(.60,.32,.12),(.52,.19,.075),(.05,.05,.04),(.88,.81,.68)]
cloth_colors=[(.10,.22,.17),(.29,.18,.10),(.12,.20,.14),(.48,.36,.22)]
def world(pos,x,y,z):
    a=pos*math.pi/2;return (x*math.cos(a)+z*math.sin(a),y,z*math.cos(a)-x*math.sin(a))
for pos,animal in enumerate(cast):
    g=group('Companion '+animal,import_glb(os.path.join(ASSETS,'companions',animal+'.glb')))
    g.location=xyz(world(pos,0,0,.68));g.rotation_euler.z=pos*math.pi/2
    f=mat(animal+' paw',fur_colors[pos]);c=mat(animal+' sleeve',cloth_colors[pos])
    for side in [-1,1]:
        a=world(pos,side*.105,.855,.635);b=world(pos,side*.16,.79,.56);d=world(pos,side*.12,.795,.49)
        rod(animal+' sleeve',a,b,.026,c);rod(animal+' forearm',b,d,.019,f);ball(animal+' paw',d,(.025,.018,.025),f)
# Staged tiles are excluded from runtime environment export; game owns identities.
tile_cache={}
def template(name):
    if name not in tile_cache:
        obs=import_glb(os.path.join(ASSETS,name+'.glb'));g=group('Template '+name,obs);tile_cache[name]=g
        g.hide_render=True;g.hide_viewport=True
    return tile_cache[name]
def instance(name,p,scale,rotation=0,tilt=0):
    src=template(name);g=bpy.data.objects.new('Staged '+name,None);bpy.context.collection.objects.link(g)
    # Clone hierarchy with independent objects, shared mesh data.
    def copy_tree(o,parent):
        n=o.copy();bpy.context.collection.objects.link(n);n.parent=parent;n.hide_render=False;n.hide_viewport=False
        for child in o.children:copy_tree(child,n)
    for child in src.children:copy_tree(child,g)
    g.location=xyz(p);g.scale=(scale,)*3;g.rotation_euler=(tilt,0,-rotation)
    return g
for pos in range(4):
    for i in range(14):
        x=(i-6.5)*.030
        instance('tile-back',world(pos,x,.779,.364),1.16,pos*math.pi/2,-1.46)
    for i in range(14 if pos%2==0 else 13):
        for level in range(2):instance('tile-back',world(pos,(i-6.5)*.027,.759+level*.018,.264),.98,pos*math.pi/2)
for i in range(2):instance('dice',(i*.035-.017,.79,0),1.5)
instance('glass-dice-cup',(0,.785,0),1)
# Render camera and authored lighting are retained in the master file.
bpy.ops.object.camera_add(location=xyz((.05,2.0,2.35)));camera=bpy.context.object;camera.name='Player review camera'
target=Vector(xyz((0,.82,0)));camera.rotation_euler=(target-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.lens=43;bpy.context.scene.camera=camera
def area(name,p,power,size,color):
    bpy.ops.object.light_add(type='AREA',location=xyz(p));o=bpy.context.object;o.name=name;o.data.energy=power;o.data.shape='DISK';o.data.size=size;o.data.color=color;o.rotation_euler=(Vector(xyz((0,.7,0)))-o.location).to_track_quat('-Z','Y').to_euler()
area('Afternoon window',(-1.3,2.1,-1.3),170,2,(1,.82,.59));area('Soft room fill',(1,2,1),80,2,(.82,.89,1))
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=24;scene.cycles.use_denoising=True
scene.world.color=(.18,.18,.18);scene.render.resolution_x=1440;scene.render.resolution_y=960;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=os.path.join(ROOT,'reports','afternoon-room-blender-v62.png')
bpy.context.preferences.filepaths.save_version=0
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT,'afternoon-room.blend'))
bpy.ops.render.render(write_still=True)
print('AFTERNOON_ROOM_COMPLETE')
