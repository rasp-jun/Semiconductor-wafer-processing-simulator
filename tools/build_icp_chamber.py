"""Build an original educational ICP chamber in Blender, plus web assets.

Run: blender --background --factory-startup --python tools/build_icp_chamber.py
Coordinates in helpers match the simulator: x, vertical y, front-facing z.
The wafer seat and transfer opening remain aligned with the existing motion model.
"""
import bpy
import json
import math
import struct
import uuid
import sys
import hashlib
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'cmos'
PREVIEW = ROOT / '.test-tools' / 'blender'
OUT.mkdir(parents=True, exist_ok=True)
PREVIEW.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)


def linear(c):
    return c/12.92 if c <= .04045 else ((c+.055)/1.055)**2.4


def material(name, color, metal=0, rough=.4, alpha=1):
    rgb = [int(color[i:i+2],16)/255 for i in (0,2,4)]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*[linear(c) for c in rgb], alpha)
    p.inputs['Metallic'].default_value = metal
    p.inputs['Roughness'].default_value = rough
    p.inputs['Alpha'].default_value = alpha
    m.diffuse_color = (*rgb,alpha)
    m['web_color'] = int(color,16)
    m['web_metal'] = metal
    m['web_rough'] = rough
    m['web_alpha'] = alpha
    return m


steel = material('Precision stainless / satin', 'a8b7ba', .84, .25)
bright = material('Machined flange / polished', 'dae1dd', .88, .19)
white = material('Ceramic white powder coat', 'e0e4dc', .23, .32)
dark = material('Graphite anodized aluminum', '23383d', .67, .31)
black = material('Elastomer and shadow gaps', '162626', .1, .5)
copper = material('RF induction coil / copper', 'bc7847', .9, .24)
ceramic = material('Alumina dielectric', 'e9e0ca', .08, .24)
green = material('Instrument identification', '709d89', .38, .34)
orange = material('Safety marking', 'cf6332', .15, .4)
ink = material('Silkscreen lettering', '203c39', 0, .55)
glass = material('Inspection glass', '96c6c8', .05, .18, .22)
model_objects = []


def xyz(x,y,z):
    return (x,-z,y)


def finish(obj, name, mat, bevel=0, shell=False):
    obj.name = name
    obj.data.materials.append(mat)
    obj['web_shell'] = shell
    if bevel:
        modifier = obj.modifiers.new('Manufactured edge radius','BEVEL')
        modifier.width = bevel
        modifier.segments = 2
    if obj.type == 'MESH':
        for poly in obj.data.polygons:
            poly.use_smooth = len(poly.vertices) == 4 and 'cylinder' in name.lower()
    model_objects.append(obj)
    return obj


def box(name, x,y,z, w,h,d, mat=white, bevel=.018, shell=False):
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(x,y,z))
    obj=bpy.context.object
    obj.scale=(w,d,h)
    bpy.ops.object.transform_apply(location=False,rotation=False,scale=True)
    return finish(obj,name,mat,bevel,shell)


def cylinder(name,x,y,z,r,h,mat=steel,axis='y',vertices=48,bevel=.01,shell=False):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=r,depth=h,location=xyz(x,y,z))
    obj=bpy.context.object
    if axis=='z': obj.rotation_euler[0]=math.pi/2
    if axis=='x': obj.rotation_euler[1]=math.pi/2
    return finish(obj,name,mat,bevel,shell)


def torus(name,x,y,z,r,t=.025,mat=bright,axis='y',shell=False):
    bpy.ops.mesh.primitive_torus_add(major_segments=48 if r>.25 else 16,minor_segments=6,
        location=xyz(x,y,z),major_radius=r,minor_radius=t)
    obj=bpy.context.object
    if axis=='z':obj.rotation_euler[0]=math.pi/2
    if axis=='x':obj.rotation_euler[1]=math.pi/2
    for p in obj.data.polygons:p.use_smooth=True
    return finish(obj,name,mat,0,shell)


def pipe(name,points,r=.03,mat=steel):
    curve=bpy.data.curves.new(name,'CURVE');curve.dimensions='3D'
    curve.resolution_u=8;curve.bevel_depth=r;curve.bevel_resolution=2
    spline=curve.splines.new('BEZIER');spline.bezier_points.add(len(points)-1)
    for bp,point in zip(spline.bezier_points,points):
        bp.co=xyz(*point);bp.handle_left_type='AUTO';bp.handle_right_type='AUTO'
    obj=bpy.data.objects.new(name,curve);bpy.context.collection.objects.link(obj)
    return finish(obj,name,mat)


def label(text,x,y,z,size=.08,mat=ink):
    curve=bpy.data.curves.new('Engraved '+text,'FONT');curve.body=text
    curve.size=size;curve.extrude=.0005;curve.resolution_u=2
    obj=bpy.data.objects.new('Label '+text,curve);bpy.context.collection.objects.link(obj)
    obj.location=xyz(x,y,z);obj.rotation_euler=(math.pi/2,0,0)
    return finish(obj,obj.name,mat)


def bolts(r,y,count=24,z=0):
    for i in range(count):
        a=i*math.tau/count
        cylinder('M8 flange fastener',math.cos(a)*r,y,math.sin(a)*r+z,.027,.032,dark,vertices=6,bevel=.002)
        torus('Fastener washer',math.cos(a)*r,y-.018,math.sin(a)*r+z,.032,.006,bright)


def build_icp_model():
    # Structural cabinet with separate access doors, seams, ventilation and service labels.
    box('Cabinet chassis',0,.69,0,3.6,1.38,2.6,white,.04)
    box('Recessed kick plate',0,.15,1.305,3.38,.22,.04,dark,.008)
    box('Machined top deck',0,1.43,0,3.7,.1,2.7,bright,.025)
    box('Top deck shadow seam',0,1.365,0,3.64,.025,2.64,black,.005)
    for x in [-1.38,1.38]:
        for z in [-.99,.99]:
            cylinder('Leveling foot',x,.018,z,.115,.12,black,vertices=24)
            cylinder('Foot adjustment',x,.1,z,.055,.14,steel,vertices=20)
    for side in [-1,1]:
        x=side*.86
        box('Service door shadow gap',x,.82,1.307,1.68,.92,.025,dark,.02)
        box('Removable service door',x,.825,1.327,1.635,.875,.03,white,.012)
        box('Recessed door handle',x+side*.58,1.08,1.351,.038,.23,.025,dark,.012)
        cylinder('Quarter turn latch',x+side*.58,.61,1.357,.028,.017,steel,'z',vertices=20,bevel=.004)
        for row in range(7):
            box('Ventilation slot',x,.52+row*.043,1.346,.66,.013,.006,dark,.004)
    label('WAFERFLOW',-1.28,1.08,1.354,.125)
    label('ICP / REACTIVE ION ETCH',-1.28,.96,1.354,.055)
    box('Orange equipment index',1.27,.82,1.352,.21,.14,.008,orange,.003)
    label('E-01',1.19,.79,1.36,.052,ceramic)
    label('SERVICE ACCESS',.56,.38,1.355,.048)

    # Vacuum envelope. Its front cover disappears in the simulator's cutaway mode.
    cylinder('Lower vessel support',0,1.53,0,1.14,.15,dark)
    cylinder('Lower vacuum flange',0,1.63,0,1.18,.095,bright)
    torus('Lower flange seal',0,1.69,0,1.09,.018,black)
    bolts(1.085,1.695)
    vessel=cylinder('Chamber shell cylinder',0,2.265,0,1.075,1.10,steel,shell=True,bevel=.016)
    # Hollow vacuum wall and the real transfer opening stay visible with cutaway off.
    bpy.ops.mesh.primitive_cylinder_add(vertices=64,radius=1.022,depth=1.3,location=xyz(0,2.265,0))
    cavity=bpy.context.object
    bpy.ops.mesh.primitive_cube_add(size=1,location=xyz(0,2.04,1.0))
    port=bpy.context.object;port.scale=(1.78,.65,.42)
    for cutter in [cavity,port]:
        modifier=vessel.modifiers.new('Vacuum wall opening','BOOLEAN')
        modifier.operation='DIFFERENCE';modifier.object=cutter
        bpy.context.view_layer.objects.active=vessel
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        bpy.data.objects.remove(cutter,do_unlink=True)
    torus('Upper chamber gasket',0,2.827,0,1.07,.018,black)
    cylinder('Upper vacuum flange',0,2.895,0,1.18,.11,bright)
    bolts(1.085,2.97)
    cylinder('Ceramic chamber liner',0,1.74,0,.95,.085,ceramic)
    cylinder('Electrostatic chuck',0,1.725,0,.84,.08,dark)
    torus('Chuck edge isolation',0,1.77,0,.84,.012,ceramic)

    # ICP source: copper coil around a dielectric top window, independent of the RF-biased chuck.
    cylinder('Dielectric source window',0,3.005,0,.92,.1,ceramic)
    cylinder('Source rear backing',0,3.085,0,.99,.055,dark)
    for j in range(4):torus('Copper RF induction winding',0,3.16+j*.095,0,.83,.026,copper)
    for a in [0,math.pi*.5,math.pi,math.pi*1.5]:
        x,z=math.cos(a)*.97,math.sin(a)*.97
        cylinder('RF ceramic stand-off',x,3.27,z,.055,.4,ceramic,vertices=24)
        cylinder('RF stand-off nut',x,3.49,z,.047,.035,dark,vertices=6)
    pipe('Induction coil supply',[[.83,3.44,0],[1.15,3.46,-.25],[1.3,3.26,-.46]],.034,copper)
    pipe('Induction coil return',[[.83,3.16,0],[1.18,3.15,-.3],[1.3,3.12,-.46]],.034,copper)
    box('RF match network',1.38,3.15,-.71,.53,.72,.62,dark,.035)
    box('RF network front face',1.38,3.16,-.392,.45,.61,.012,steel,.015)
    label('RF MATCH',1.19,3.32,-.382,.048)
    for i in range(5):box('RF cooling fin',1.38,2.93+i*.065,-.379,.31,.02,.014,dark,.003)

    # Lower side exhaust, isolation flange and a realistically finned pump body.
    pipe('Vacuum elbow',[[.95,1.88,-.05],[1.36,1.88,-.12],[1.63,1.71,-.58]],.12,steel)
    cylinder('Vacuum isolation flange',1.57,1.74,-.47,.22,.09,bright,'z',vertices=48)
    for i in range(8):
        a=i*math.tau/8
        cylinder('Vacuum flange bolt',1.57+math.cos(a)*.174,1.74+math.sin(a)*.174,-.405,.022,.025,dark,'z',vertices=6,bevel=.002)
    cylinder('Turbomolecular pump cylinder',1.62,1.42,-.73,.285,.6,dark)
    for i in range(9):torus('Pump cooling fin',1.62,1.15+i*.065,-.73,.295,.019,steel)
    cylinder('Pump motor housing',1.62,1.04,-.73,.22,.15,black)
    pipe('Backing vacuum line',[[1.62,.99,-.73],[1.71,.91,-1.04],[1.55,.63,-1.28]],.055,dark)

    # Gas manifold, coolant plumbing and service gauge.
    pipe('Process gas inlet',[[0,3.59,0],[0,3.76,-.25],[.7,3.76,-.76],[.96,3.66,-1.02]],.025,steel)
    cylinder('Gas inlet flange',0,3.58,0,.13,.035,bright,vertices=32)
    box('Gas manifold block',.96,3.43,-1.02,.29,.32,.25,steel,.016)
    for x in [.87,1.04]:
        pipe('Gas delivery line',[[x,3.28,-1.02],[x,2.77,-1.07],[x,1.57,-1.19]],.018,steel)
        cylinder('Gas compression fitting',x,3.2,-1.02,.04,.07,bright,vertices=6,bevel=.003)
    pipe('Cooling supply',[[.75,1.56,-.85],[.93,1.72,-.98],[1.07,2.18,-1.08]],.021,green)
    pipe('Cooling return',[[.62,1.56,-.87],[.78,1.85,-1.1],[.93,2.18,-1.13]],.021,green)
    cylinder('Pressure gauge body',-1.12,2.40,.22,.17,.09,dark,'z',vertices=40)
    cylinder('Pressure gauge dial',-1.12,2.40,.272,.146,.006,ceramic,'z',vertices=40,bevel=0)
    for i in range(9):
        a=(i/8*1.5+.25)*math.pi
        box('Gauge scale tick',-1.12+math.cos(a)*.113,2.40+math.sin(a)*.113,.28,.012,.016,.003,ink,0)
    pipe('Gauge indicator',[[ -1.12,2.4,.286],[-1.17,2.46,.286]],.005,orange)
    pipe('Gauge vacuum port',[[-1.12,2.40,.14],[-1.12,2.4,-.1],[-.94,2.4,-.28]],.025,steel)
    for x in [-.95,.95]:box('Transfer gate guide rail',x,2.18,1.105,.065,.76,.10,dark,.009)
    box('Transfer port upper lip',0,2.39,1.104,1.86,.05,.12,bright,.007)
    box('Transfer port lower lip',0,1.795,1.104,1.86,.04,.13,bright,.007)
    box('Caution label',-.51,1.48,1.354,.32,.085,.005,orange,.002)
    label('RF / HV',-.63,1.454,1.36,.044,ceramic)


def export_model(stem='icp-chamber',render=True,resolution=1500,samples=32,frame_size=6.1,render_extras=None):
    # Reproducible web export with Blender-evaluated bevels and normals.
    # Group by material/shell role to keep the live scene's draw-call count small.
    bpy.context.view_layer.update()
    graph=bpy.context.evaluated_depsgraph_get()
    buckets={}
    for obj in model_objects:
        evaluated=obj.evaluated_get(graph)
        mesh=evaluated.to_mesh()
        mesh.calc_loop_triangles()
        mat=obj.data.materials[0]
        key=(mat.name,bool(obj.get('web_shell')),obj.get('web_role','mechanism'))
        bucket=buckets.setdefault(key,{'positions':[],'normals':[],'indices':[],'vertices':{}})
        normal_matrix=evaluated.matrix_world.to_3x3().inverted().transposed()
        for tri in mesh.loop_triangles:
            for loop_index in tri.loops:
                loop=mesh.loops[loop_index]
                v=evaluated.matrix_world @ mesh.vertices[loop.vertex_index].co
                n=(normal_matrix @ mesh.corner_normals[loop_index].vector).normalized()
                values=tuple(round(float(k),5) for k in (v.x,v.z,-v.y,n.x,n.z,-n.y))
                if values not in bucket['vertices']:
                    bucket['vertices'][values]=len(bucket['positions'])//3
                    bucket['positions'].extend(values[:3]);bucket['normals'].extend(values[3:])
                bucket['indices'].append(bucket['vertices'][values])
        evaluated.to_mesh_clear()

    geometries=[];materials=[];children=[]
    for (name,shell,role),bucket in buckets.items():
        mat=bpy.data.materials[name];gid=str(uuid.uuid4());mid=str(uuid.uuid4())
        geometries.append({'uuid':gid,'type':'BufferGeometry','data':{
            'attributes':{'position':{'itemSize':3,'type':'Float32Array','array':bucket['positions'],'normalized':False},
                          'normal':{'itemSize':3,'type':'Float32Array','array':bucket['normals'],'normalized':False}},
            'index':{'type':'Uint32Array','array':bucket['indices']}}})
        materials.append({'uuid':mid,'type':'MeshStandardMaterial','name':name,
            'color':mat['web_color'],'metalness':mat['web_metal'],'roughness':mat['web_rough'],
            'side':2 if shell else 0,'transparent':shell or mat['web_alpha']<1,
            'opacity':mat['web_alpha'],'depthWrite':not (shell or mat['web_alpha']<1)})
        children.append({'uuid':str(uuid.uuid4()),'type':'Mesh','name':role+'-'+('shell-' if shell else 'detail-')+name,
            'geometry':gid,'material':mid,'castShadow':not shell,'receiveShadow':True,
            'userData':{'cutawayShell':shell,'equipmentRole':role},'matrix':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]})
    asset={'metadata':{'version':4.6,'type':'Object','generator':'WaferFlow / Blender evaluated meshes'},
        'geometries':geometries,'materials':materials,'object':{'uuid':str(uuid.uuid4()),'type':'Group',
        'name':'blender-'+stem,'userData':{'source':'Blender','model':stem,'revision':'axis-3','identity':globals().get('equipment_identity',{}),'scope':'Public-reference-informed original geometry; illustrative, not vendor CAD or specifications'},
        'matrix':[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],'children':children}}
    # Typed arrays live in one binary buffer; only the compact scene description is JSON.
    binary=bytearray()
    for geometry in geometries:
        arrays=[*geometry['data']['attributes'].values(),geometry['data']['index']]
        for attribute in arrays:
            values=attribute['array'];offset=len(binary)
            binary.extend(struct.pack('<'+('I' if attribute['type']=='Uint32Array' else 'f')*len(values),*values))
            attribute['array']={'byteOffset':offset,'length':len(values)}
    asset['metadata']['bufferFormat']='waferflow-three-buffer-v1'
    asset['metadata']['bufferByteLength']=len(binary)
    asset['metadata']['bufferSha256']=hashlib.sha256(binary).hexdigest()
    (OUT/(stem+'.bin')).write_bytes(binary)
    (OUT/(stem+'.json')).write_text(json.dumps(asset,separators=(',',':')),encoding='utf-8')

    # Preview-only mechanisms are included in the editable source and standard GLB.
    # The browser supplies these mechanisms separately to preserve live animation.
    if render_extras:render_extras()
    bpy.context.view_layer.update()
    corners=[obj.matrix_world @ Vector(corner) for obj in model_objects for corner in obj.bound_box]
    center=Vector(tuple((min(v[i] for v in corners)+max(v[i] for v in corners))/2 for i in range(3)))
    # Standard GLB remains available for editing and other engines.
    bpy.ops.object.select_all(action='DESELECT')
    for obj in model_objects:obj.select_set(True)
    bpy.context.view_layer.objects.active=model_objects[0]
    bpy.ops.export_scene.gltf(filepath=str(OUT/(stem+'.glb')),export_format='GLB',use_selection=True,
        export_apply=True,export_animations=False,export_cameras=False,export_lights=False)

    # The default catalogue study shows the production envelope.
    floor=box('Render floor',0,-.12,0,200,.1,200,material('Render ground','e4e4dc',.1,.6),.0)
    world=bpy.data.worlds.new('Soft studio environment')
    bpy.context.scene.world=world;world.use_nodes=True
    world.node_tree.nodes['Background'].inputs[0].default_value=(.45,.50,.50,1)
    world.node_tree.nodes['Background'].inputs[1].default_value=.5
    for name,location,power,size,color in [
        ('Large warm key',(-4,-5,8),1400,5,(1,.88,.72)),
        ('Cool rim',(4,2,6),1800,4,(.68,.83,1)),
        ('Front fill',(-1,-6,3),600,4,(.9,1,.97))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
        obj=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(obj);obj.location=location
        obj.rotation_euler=(Vector((0,0,1.7))-obj.location).to_track_quat('-Z','Y').to_euler()
    bpy.ops.object.camera_add(location=center+Vector((5.8,-7.8,4.6)))
    camera=bpy.context.object;camera.rotation_euler=(center-camera.location).to_track_quat('-Z','Y').to_euler()
    local=[camera.rotation_euler.to_quaternion().inverted() @ (v-center) for v in corners]
    span_x=max(v.x for v in local)-min(v.x for v in local)
    span_y=max(v.y for v in local)-min(v.y for v in local)
    camera.data.type='ORTHO';camera.data.ortho_scale=max(span_x,span_y/.93)*1.13;bpy.context.scene.camera=camera
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=samples
    scene.cycles.use_denoising=True
    scene.render.resolution_x=resolution;scene.render.resolution_y=round(resolution*.93);scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.filepath=str(PREVIEW/(stem+'.png'))
    scene.view_settings.view_transform='AgX'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/(stem+'.blend')))
    print('WAFERFLOW_ASSET',len(model_objects)-1,'parts',len(children),'draw calls',sum(len(b['indices'])//3 for b in buckets.values()),'triangles')
    if render:
        bpy.ops.render.render(write_still=True)
        scene.render.image_settings.file_format='JPEG'
        scene.render.image_settings.quality=88
        bpy.data.images['Render Result'].save_render(filepath=str(OUT/(stem+'.jpg')),scene=scene)
        # Matching mechanism view at the same camera and scale.
        for obj in model_objects:
            if obj.get('web_shell') or obj.get('web_role')=='exterior':obj.hide_render=True
        visible_corners=[obj.matrix_world @ Vector(corner) for obj in model_objects if not obj.hide_render and obj!=floor for corner in obj.bound_box]
        interior_center=Vector(tuple((min(v[i] for v in visible_corners)+max(v[i] for v in visible_corners))/2 for i in range(3)))
        camera.location=interior_center+Vector((5.8,-7.8,4.6))
        camera.rotation_euler=(interior_center-camera.location).to_track_quat('-Z','Y').to_euler()
        interior_local=[camera.rotation_euler.to_quaternion().inverted() @ (v-interior_center) for v in visible_corners]
        camera.data.ortho_scale=max(max(v.x for v in interior_local)-min(v.x for v in interior_local),(max(v.y for v in interior_local)-min(v.y for v in interior_local))/.93)*1.14
        scene.render.filepath=str(PREVIEW/(stem+'-section.png'))
        scene.render.image_settings.file_format='PNG'
        bpy.ops.render.render(write_still=True)
        scene.render.image_settings.file_format='JPEG'
        bpy.data.images['Render Result'].save_render(filepath=str(OUT/(stem+'-section.jpg')),scene=scene)


if __name__ == '__main__':
    sys.modules['build_icp_chamber']=sys.modules[__name__]
    sys.path.insert(0,str(Path(__file__).resolve().parent))
    build_icp_model()
    import equipment_identity
    equipment_identity.mechanism_details('etch')
    import equipment_enclosures
    equipment_enclosures.build('etch')
    export_model(resolution=1100,samples=20)
