"""Original companion models for 午后牌室. Run with Blender --background --python.
No APK models, textures or animation data are used.
"""
import bpy, math, os
from mathutils import Vector

OUT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../assets/mahjong-3d/glb/companions'))
os.makedirs(OUT, exist_ok=True)
os.makedirs(os.path.join(OUT,'portraits'),exist_ok=True)
def mat(name, rgb, rough=.8):
    m=bpy.data.materials.new(name); m.diffuse_color=(*rgb,1); m.use_nodes=True
    p=next((n for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if p is None:
        p=m.node_tree.nodes.new('ShaderNodeBsdfPrincipled')
        output=m.node_tree.nodes.new('ShaderNodeOutputMaterial');m.node_tree.links.new(p.outputs['BSDF'],output.inputs['Surface'])
    p.inputs['Base Color'].default_value=(*rgb,1); p.inputs['Roughness'].default_value=rough
    return m
def xyz(p): return (p[0],-p[2],p[1])
def ball(name,p,s,m,parent=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=16,location=xyz(p))
    o=bpy.context.object; o.name=name; o.scale=(s[0],s[2],s[1]);o.data.materials.append(m)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    for f in o.data.polygons:f.use_smooth=True
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    return o
def box(name,p,s,m,bevel=.012):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(p));o=bpy.context.object;o.name=name;o.scale=(s[0],s[2],s[1]);o.data.materials.append(m)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    b=o.modifiers.new('Soft manufactured edges','BEVEL');b.width=bevel;b.segments=3
    o.modifiers.new('Weighted normals','WEIGHTED_NORMAL');return o
def rod(name,a,b,r,m):
    a,b=Vector(xyz(a)),Vector(xyz(b));d=b-a
    bpy.ops.mesh.primitive_cylinder_add(vertices=16,radius=r,depth=d.length,location=(a+b)/2)
    o=bpy.context.object;o.name=name;o.rotation_euler=d.to_track_quat('Z','Y').to_euler();o.data.materials.append(m)
    for f in o.data.polygons:f.use_smooth=True
    return o
def line(name,points,r,m,parent=None):
    c=bpy.data.curves.new(name,'CURVE');c.dimensions='3D';c.resolution_u=12;c.bevel_depth=r;c.bevel_resolution=3
    spline=c.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for b,p in zip(spline.bezier_points,points):b.co=xyz(p);b.handle_left_type=b.handle_right_type='AUTO'
    o=bpy.data.objects.new(name,c);bpy.context.collection.objects.link(o);o.data.materials.append(m)
    bpy.ops.object.select_all(action='DESELECT');o.select_set(True);bpy.context.view_layer.objects.active=o;bpy.ops.object.convert(target='MESH')
    if parent:o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted()
    return o
def ear(name,x,material,parent,inset=False):
    w=.026 if inset else .050;bottom=1.084 if inset else 1.06;top=1.150 if inset else 1.178
    front=-.040 if inset else -.033;back=front+.012 if inset else .027
    verts=[xyz(p) for p in [(x-w,bottom,front),(x+w,bottom,front),(x,top,front+.006),
        (x-w,bottom,back),(x+w,bottom,back),(x,top,back)]]
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],[(0,2,1),(3,4,5),(0,1,4,3),(1,2,5,4),(2,0,3,5)]);mesh.update()
    o=bpy.data.objects.new(name,mesh);bpy.context.collection.objects.link(o);o.data.materials.append(material)
    b=o.modifiers.new('Soft ear edge','BEVEL');b.width=.005 if inset else .012;b.segments=4
    o.modifiers.new('Ear normals','WEIGHTED_NORMAL')
    for p in mesh.polygons:p.use_smooth=True
    o.parent=parent;o.matrix_parent_inverse=parent.matrix_world.inverted();return o
for animal in ['cat','fox','panda','rabbit']:
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    cream=mat('warm ivory',(0.88,.80,.64));black=mat('ink',(0.045,.045,.035),.48)
    pink=mat('soft ear pink',(.66,.37,.30));wood=mat('walnut',(.20,.105,.052),.5)
    green=mat('chair upholstery',(.055,.12,.085));gold=mat('button brass',(.42,.32,.16),.4)
    colors={'cat':(.60,.32,.12),'fox':(.52,.19,.075),'panda':(.9,.85,.73),'rabbit':(.88,.81,.68)}
    fabrics={'cat':(.10,.22,.17),'fox':(.29,.18,.10),'panda':(.12,.20,.14),'rabbit':(.48,.36,.22)}
    fur=mat(animal+' fur',colors[animal]);cloth=mat(animal+' linen',fabrics[animal]);white=mat('eye light',(.97,.94,.85),.25)
    # Compact upholstered chair and visible seated legs.
    box('Chair seat',(0,.48,.035),(.30,.055,.27),wood)
    box('Chair cushion',(0,.515,.02),(.26,.045,.23),green)
    box('Chair back',(0,.73,.15),(.30,.35,.04),wood,.026)
    box('Chair back inset',(0,.74,.123),(.25,.28,.026),green,.025)
    for x in [-.105,.105]:
        for z in [-.06,.13]:rod('Chair leg',(x,.015,z),(x,.48,z),.014,wood)
        ball('Trouser leg',(x*.65,.48,-.06),(.055,.12,.06),cloth)
        ball('Foot',(x*.65,.365,-.09),(.055,.032,.085),fur)
    ball('Body',(0,.715,0),(.128,.185,.09),cloth)
    for side in [-1,1]:
        lapel=box('Linen collar',(side*.027,.856,-.064),(.043,.046,.012),cream,.007)
        lapel.rotation_euler.y=side*.35
    # A shirt front and quiet tactile buttons.
    box('Shirt placket',(0,.735,-.087),(.021,.20,.01),cloth,.004)
    for y in [.67,.735,.80]:ball('Button',(0,y,-.095),(.006,.006,.004),gold)
    bpy.ops.object.empty_add(type='PLAIN_AXES',location=xyz((0,.995,0)))
    head=bpy.context.object;head.name='Head';bpy.context.view_layer.update()
    ball('Head sculpt',(0,.995,-.005),(.143,.13,.115),fur,head)
    if animal=='rabbit':
        for x in [-.065,.065]:
            ball('Long ear',(x,1.155,.008),(.034,.13,.024),fur,head)
            ball('Ear inset',(x,1.16,-.014),(.020,.102,.006),pink,head)
    elif animal in ['cat','fox']:
        for x in [-.10,.10]:
            ear('Sculpted ear',x,fur,head)
            ear('Ear inset',x,pink,head,True)
    else:
        for x in [-.105,.105]:ball('Round ear',(x,1.087,.0),(.050,.05,.025),black,head)
    for x in [-.052,.052]:
        if animal=='panda':ball('Eye patch',(x,1.005,-.103),(.039,.047,.012),black,head)
        elif animal=='fox':ball('Ivory cheek',(x,.963,-.091),(.061,.048,.035),cream,head)
        bpy.ops.object.empty_add(type='PLAIN_AXES',location=xyz((x,1.008,-.109)))
        eye=bpy.context.object;eye.name='EyeL' if x<0 else 'EyeR';eye.parent=head;eye.matrix_parent_inverse=head.matrix_world.inverted();bpy.context.view_layer.update()
        ball('Eye white',(x,1.008,-.109),(.022,.024,.007),cream,eye)
        ball('Pupil',(x,1.006,-.115),(.012,.017,.004),black,eye)
        ball('Eye glint',(x-.0035,1.013,-.119),(.003,.004,.0015),white,eye)
        ball('Upper eyelid',(x,1.030,-.105),(.026,.007,.010),fur,eye)
        line('Brow',[(x-.018,1.043,-.097),(x,1.047,-.102),(x+.017,1.043,-.097)],.0025,fur,head)
        ball('Muzzle',(x*.46,.955,-.108),(.037,.027,.026),cream,head)
    ball('Nose',(0,.972,-.137),(.014,.010,.009),pink if animal in ['cat','rabbit'] else black,head)
    line('Gentle smile',[(-.019,.943,-.123),(0,.938,-.127),(.019,.943,-.123)],.002,black,head)
    if animal=='panda':
        for x in [-.052,.052]:
            bpy.ops.mesh.primitive_torus_add(major_radius=.032,minor_radius=.0018,major_segments=32,minor_segments=8,location=xyz((x,1.008,-.126)),rotation=(math.pi/2,0,0))
            o=bpy.context.object;o.name='Round spectacles';o.data.materials.append(gold);o.parent=head;o.matrix_parent_inverse=head.matrix_world.inverted()
        line('Spectacle bridge',[(-.020,1.012,-.126),(0,1.017,-.130),(.020,1.012,-.126)],.0018,gold,head)
    if animal=='cat':
        stripe=mat('tabby stripes',(.29,.12,.04))
        for x in [-.055,0,.055]:ball('Forehead stripe',(x,1.07,-.08),(.008,.026,.008),stripe,head)
        for side in [-1,1]:
            for y in [.979,1.0]:ball('Cheek stripe',(side*.116,y,-.071),(.019,.004,.008),stripe,head)
    if animal=='fox':ball('Tail',(0,.60,.14),(.065,.13,.09),fur)
    if animal=='rabbit':ball('Tail',(0,.60,.12),(.047,.045,.045),cream)
    bpy.ops.export_scene.gltf(filepath=os.path.join(OUT,animal+'.glb'),export_format='GLB',export_yup=True,export_apply=True)
    # Portraits are rendered from the same models used at the table.
    portrait_y=1.075 if animal=='rabbit' else 1.025
    bpy.ops.object.camera_add(location=xyz((.04,portrait_y,-.65)))
    camera=bpy.context.object;camera.rotation_euler=(Vector(xyz((0,portrait_y,0)))-camera.location).to_track_quat('-Z','Y').to_euler()
    camera.data.type='ORTHO';camera.data.ortho_scale=.46 if animal=='rabbit' else .33
    for p,power,size in [((-.35,1.5,-.45),35,.7),((.4,1.2,-.1),12,.5)]:
        bpy.ops.object.light_add(type='AREA',location=xyz(p));light=bpy.context.object;light.data.energy=power;light.data.size=size
        light.rotation_euler=(Vector(xyz((0,1,0)))-light.location).to_track_quat('-Z','Y').to_euler()
    scene=bpy.context.scene;scene.camera=camera;scene.render.engine='CYCLES';scene.cycles.samples=12;scene.cycles.use_denoising=True
    scene.render.resolution_x=160;scene.render.resolution_y=160;scene.render.resolution_percentage=100;scene.render.film_transparent=True
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.filepath=os.path.join(OUT,'portraits',animal+'.png');bpy.ops.render.render(write_still=True)
    print('COMPANION_EXPORTED',animal)
