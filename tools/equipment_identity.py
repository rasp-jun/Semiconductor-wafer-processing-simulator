"""AXIS edition 03: eighteen deliberately different industrial architectures.

Original educational interpretations of public equipment families. Dimensions,
service openings and visible mechanisms are illustrative, never vendor CAD.
The process seat stays at the live simulator's existing coordinates.
"""
import math
import build_icp_chamber as B
from build_icp_chamber import box,cylinder,torus,pipe,label
import equipment_enclosures as P

ivory=P.porcelain
carbon=P.graphite
navy=B.material('Ceramic navy','294559',.25,.35)
teal=B.material('Wet process teal','33776f',.25,.38)
cobalt=B.material('Optics cobalt','355c96',.3,.32)
ochre=B.material('Thermal enamel ochre','a86e36',.2,.37)
violet=B.material('Metrology plum','67567d',.22,.35)
sage=B.material('Track sage','728476',.18,.4)
champagne=B.material('PVD titanium champagne','ae9573',.62,.3)
acid=B.material('Chemical guard amber','b46c21',.1,.28,.38)
clear=B.material('Observation glazing','79a5b3',.05,.16,.2)
foup=B.material('Amber pod polymer','a76525',.05,.3)

IDENTITIES={
 'clean':('glazed-gantry-wet-station',['Overhead transfer gantry','Three fluid service columns','Teal framed observation bay']),
 'wetetch':('linear-acid-bench',['Extended amber chemical hood','Segmented acid distribution deck','Independent fume exhaust stack']),
 'oxidation':('single-vertical-thermal-tower',['Single tall insulated furnace','Recessed boat elevator bay','Three thermal zone bands']),
 'lpcvd':('twin-tube-vacuum-furnace',['Twin vertical tube housings','Side vacuum manifold','Offset gas delivery tower']),
 'coat':('radial-spin-track',['Circular spin cup canopy','Stepped resist supply bank','Single pod input tower']),
 'developer':('linear-develop-track',['Long stacked develop modules','Three rinse service lanes','Continuous amber inspection strip']),
 'bake':('stacked-hotplate-library',['Six thermal drawers','Offset chill plate deck','Insulated vertical heat stack']),
 'scanner':('isolated-optical-bridge',['Tall blue optical bridge','Stepped reticle enclosure','Wide isolated stage base']),
 'etch':('radial-icp-cluster',['Faceted transfer core','Three radial process vessels','Tall copper induction crown']),
 'strip':('twin-remote-plasma-platform',['Twin remote plasma source towers','Compact low process body','Rear radical delivery arches']),
 'pecvd':('quad-station-deposition',['Four station reaction lid','Wide deposition drum','Paired RF power racks']),
 'ald':('precursor-pulse-platform',['Paired precursor ampoules','Heated manifold spine','Offset vertical valve cabinet']),
 'implant':('segmented-beamline',['Extended horizontal ion beamline','Exposed analyzing magnet housing','Cylindrical end station']),
 'rtp':('lamp-crown-thermal-chamber',['Circular lamp crown','Reflector housing and pyrometer mast','Compact twin load locks']),
 'cmp':('three-platen-carousel',['Three circular polishing stations','Raised carrier carousel','Separate brush clean tower']),
 'pvd':('hexagonal-vacuum-cluster',['Hexagonal central transfer chamber','Radial target process vessels','Visible turbopump service ring']),
 'metrology':('optical-c-frame',['Precision C shaped metrology frame','Granite isolation plinth','Offset optical electronics tower']),
 'probe':('cantilever-test-head',['Large cantilevered test head','Circular probe card access','Separate tester cabinet'])
}

def part(name,x,y,z,w,h,d,mat=ivory,bevel=.035):
    return box(name,x,y,z,w,h,d,mat,bevel)

def skid(x,z,w,d,accent=carbon):
    part('Segmented service plinth',x,.31,z,w,.46,d,accent,.09)
    part('Raised deck edge',x,.57,z,w-.04,.075,d-.04,B.steel,.02)
    for sx in [-1,1]:
        for sz in [-1,1]:
            cylinder('Adjustable isolation foot',x+sx*(w/2-.3),.09,z+sz*(d/2-.3),.14,.17,carbon,vertices=16)

def cabinet(x,z,w,d,h,accent=ivory):
    P.body(x,z,w,d,h)
    part('Service identity rail',x,h+.31,z+d/2+.065,w,.18,.06,accent)

def ribbed_drum(name,x,y,z,r,h,mat=ivory,facets=48):
    cylinder(name,x,y,z,r,h,mat,vertices=facets,bevel=.035)
    for yy in [y-h/2+.05,y+h/2-.05]:torus(name+' flange',x,yy,z,r+.015,.038,B.steel)
    cylinder(name+' top cap',x,y+h/2+.045,z,r*.94,.1,carbon,vertices=facets)

def glazing(x,z,w,d,base,top,accent=carbon,tint=clear,roof=True):
    h=top-base
    for sx in [-1,1]:
        for sz in [-1,1]:part('Glazed bay mullion',x+sx*w/2,(top+base)/2,z+sz*d/2,.1,h,.1,accent,.015)
    for yy in [base,top]:
        for zz in [-d/2,d/2]:part('Glazing cross member',x,yy,z+zz,w,.1,.1,accent,.015)
    for sx in [-1,1]:part('Side observation window',x+sx*w/2,(top+base)/2,z,.045,h-.12,d-.12,tint,.005)
    part('Front observation window',x,(top+base)/2,z+d/2,w-.12,h-.12,.045,tint,.005)
    if roof:part('Bay filtered canopy',x,top+.11,z,w+.16,.18,d+.16,ivory)

def pod(x,z,accent=ivory):
    part('Independent load port base',x,.97,z,1.15,1.7,.5,accent)
    part('Pod docking bulkhead',x,2.07,z,1.18,1.34,.22,carbon)
    part('Pod docking shelf',x,1.56,z+.48,1.28,.12,1.03,B.steel)
    part('Amber wafer transport pod',x,2.03,z+.47,1.04,.9,.86,foup,.1)
    part('Pod door seal',x,2.03,z+.015,.98,.84,.035,carbon,.07)
    for j in range(6):
        for side in [-1,1]:part('Pod side reinforcement',x+side*.52,1.72+j*.12,z+.48,.027,.035,.66,champagne,.009)
    part('Pod handle',x,2.55,z+.47,.45,.1,.18,carbon)

def console(x,y,z,accent=ivory):
    part('Console support arm',x,y-.45,z-.13,.12,.95,.14,B.steel)
    part('Console shell',x,y,z,.73,.66,.14,accent)
    part('Operator screen',x,y+.04,z+.078,.61,.42,.013,P.screen,.012)
    for j,w in enumerate([.45,.28,.39]):part('Console display trace',x-.01,y+.16-j*.105,z+.087,w,.018,.004,B.green,0)
    cylinder('Emergency stop',x+.42,y-.22,z+.1,.052,.06,P.red,'z',vertices=16)

def badge(text,x,y,z,accent):
    part('Instrument engraved nameplate',x,y,z,2.05,.42,.034,accent,.012)
    label(text,x-.88,y-.045,z+.022,.115,B.ceramic)

def clean():
    skid(0,.1,5.5,4.0,teal)
    glazing(0,0,4.5,2.9,1.2,5.53,teal)
    part('Deep wet bench lower fascia',0,.97,1.56,4.65,.7,.16,teal)
    for x in [-1.5,0,1.5]:P.seam_door(x,.95,1.66,1.42,.55)
    for i,x in enumerate([-1.7,0,1.7]):
        ribbed_drum('Filtered rinse exhaust',x,5.9,-.74,.36,.5,ivory)
        pipe('Exhaust riser',[[x,5.9,-.74],[x,6.25,-.74],[x,6.25,-1.7]],.12,B.steel)
    cabinet(3.15,-.4,1.05,2.7,4.7,teal)
    pod(-2.2,2.45,teal);pod(-.8,2.45)
    console(2.22,3.0,1.65);badge('WET / CLEAN',0,5.3,1.53,teal);P.tower(2.24,5.65,-1.25)

def wetetch():
    skid(.4,0,7.3,3.8,carbon)
    part('Acid resistant work deck',.35,1.2,0,7.05,.25,3.6,B.ceramic)
    glazing(-.05,0,4.65,2.7,1.3,5.5,ochre,acid)
    part('Extended chemical service trough',2.75,2.04,0,1.05,1.55,2.7,ivory)
    for x in [-2.6,-1.3,0,1.3,2.6]:
        P.seam_door(x,.85,1.85,1.19,.64)
        cylinder('Acid circuit selector',x,1.31,1.86,.055,.045,teal,'z',vertices=16)
    cabinet(-3.16,-.62,.8,2.4,5.8,ochre)
    pipe('Independent fume exhaust',[[2.8,2.8,-1],[2.8,5.85,-1],[1.8,5.85,-1]],.23,ivory)
    part('Chemical hood top eyebrow',0,5.63,1.5,4.9,.3,.5,ochre)
    pod(-3,2.5);console(2.9,3.34,1.38,ochre);badge('WET / ETCH',.55,5.57,1.77,ochre)

def oxidation():
    skid(0,0,4.5,4.1,ochre)
    cabinet(0,-.35,3.62,3.3,6.5,ochre)
    part('Insulated vertical furnace crown',0,6.83,-.35,3.18,.55,2.93,ivory,.18)
    for y in [3.3,4.45,5.6]:
        part('Thermal zone band',0,y,1.34,3.4,.15,.06,ochre)
        P.vent(0,y-.36,1.38,2.55)
    part('Boat elevator dark recess',0,1.84,1.4,2.93,2.38,.1,carbon)
    part('Boat service window',0,1.91,1.48,2.5,1.8,.06,clear)
    for x in [-1.53,1.53]:part('Boat bay vertical reveal',x,1.76,1.58,.14,2.52,.16,ochre)
    pod(-2.45,1.28,ochre);console(2.4,3.03,.9);badge('OX / THERMAL',0,6.37,1.4,ochre);P.tower(1.6,6.7,-1.4)

def lpcvd():
    skid(.7,-.15,6.5,4.1,navy)
    for x in [0,2.8]:
        ribbed_drum('Vertical low pressure tube shield',x,4.4,-.35,1.52 if x==0 else 1.13,3.85,clear if x==0 else ivory)
        for y in [3.05,4.38,5.72]:part('Tube service ring label',x,y,.92,1.05,.1,.05,navy)
        cabinet(x,-.35,2.32,2.65,2.18,navy)
    cabinet(-2.55,-.47,1.15,3.35,5.6,navy)
    for y in [2.95,4.07,5.2]:
        pipe('Twin tube vacuum header',[[-2.45,y,-1.62],[-1.3,y,-1.62],[.05,y,-1.62]],.12,B.steel)
    pod(-1.2,2.17,navy);pod(.3,2.17)
    console(3.65,2.84,1.2,navy);badge('LP / DEPOSITION',-.2,2.32,1.1,navy)

def coat():
    skid(.2,0,5.3,3.7,sage)
    cabinet(0,0,3.6,2.9,1.48,sage)
    ribbed_drum('Spin bowl cylindrical canopy',0,2.62,0,1.56,1.6,ivory)
    part('Spin coat front inspection opening',0,2.6,1.54,1.6,.76,.045,acid)
    for j,x in enumerate([2.05,2.62,3.19]):
        cabinet(x,-.55,.48,1.65,2.4+j*.48,sage)
        cylinder('Resist reservoir service cap',x,2.65+j*.48,-.53,.13,.14,carbon,vertices=24)
    pod(-2.35,1.4,sage);console(2.42,3.96,1.05)
    badge('SPIN / COAT',0,3.29,1.24,sage);P.tower(1.03,3.6,-.62)

def developer():
    skid(.55,0,7,3.7,teal)
    cabinet(.4,-.12,5.8,3.1,1.65,teal)
    for x in [-1.55,.45,2.45]:
        glazing(x,-.12,1.87,2.85,1.85,3.6,carbon,acid)
        part('Upper develop drawer',x,4.04,-.12,1.83,.67,2.87,ivory)
        part('Develop slot reveal',x,4.04,1.34,1.53,.19,.04,carbon)
        part('Develop process rail',x,3.57,1.38,1.81,.1,.09,teal)
    pod(-3.23,.65,teal);console(3.64,3.02,1.2,teal)
    badge('RINSE / DEVELOP',.4,4.38,1.35,teal)

def bake():
    skid(.65,0,6.2,3.5,ochre)
    glazing(0,0,3.0,2.68,1.4,3.82,ochre)
    cabinet(2.63,-.12,1.62,2.85,4.9,ochre)
    for j in range(6):
        y=1.0+j*.61
        part('Thermal drawer seal',2.63,y,1.35,1.47,.5,.11,carbon)
        part('Insulated hotplate drawer',2.63,y,1.43,1.37,.39,.13,ivory)
        part('Thermal drawer pull',2.63,y+.03,1.53,.66,.055,.06,ochre)
        label(str(j+1).zfill(2),2.03,y-.08,1.508,.08,B.ink)
    ribbed_drum('Separate chill plate enclosure',-2.15,1.65,-.12,.73,.5,B.steel)
    pod(-2.53,1.87);console(1.22,4.25,1.25,ochre);badge('HEAT / CHILL',2.63,4.64,1.37,ochre)

def scanner():
    skid(0,-.2,6.7,5.0,cobalt)
    for x in [-2.58,2.58]:
        cabinet(x,-.55,1.1,3.65,5.83,cobalt)
        part('Optical bridge blue upright',x,3.75,1.36,1.11,4.2,.17,cobalt)
    part('Massive isolated optical bridge',0,5.91,-.52,6.48,.6,4.05,ivory,.09)
    part('Reticle handling crown',-.5,6.51,-1.02,3.4,.7,2.0,cobalt,.07)
    glazing(0,-.35,3.95,3.2,1.39,5.61,carbon,clear,False)
    part('Isolated stage sill',0,1.14,1.59,4.35,.54,.54,carbon)
    for x in [-1.7,1.7]:cylinder('Stage vibration isolator',x,.5,-.2,.37,.63,carbon,vertices=32)
    pod(-2.14,2.67);pod(-.67,2.67)
    console(3.08,3.18,1.33,cobalt);badge('DUV / PROJECTION',0,5.94,1.56,cobalt)

def etch():
    skid(0,-.55,7.35,5.6,navy)
    ribbed_drum('Faceted vacuum transfer core',0,1.7,0,1.8,2.18,ivory,8)
    for x,z in [(-2.65,-.75),(2.65,-.75),(0,-2.73)]:
        pipe('Radial vacuum slit connection',[[x*.45,1.76,z*.45],[x,1.76,z]],.31,B.steel)
        ribbed_drum('ICP chamber service shield',x,2.52,z,.95,2.0,ivory)
        cylinder('RF source dielectric crown',x,3.71,z,.68,.43,B.ceramic)
        for j in range(5):torus('Visible ICP source coil',x,3.57+j*.085,z,.69,.027,B.copper)
        part('RF matching pedestal',x,4.11,z,.92,.35,.84,navy)
    pod(-.8,2.25,navy);pod(.68,2.25)
    console(2.02,3.15,1.57,navy);badge('ICP / ETCH',0,2.81,1.69,navy)

def strip():
    skid(0,0,4.95,3.85,teal)
    cabinet(0,-.1,4.4,3.13,2.4,teal)
    for x in [-1.15,1.15]:
        ribbed_drum('Downstream radical process pod',x,3.01,-.18,.9,.98,ivory)
        cylinder('Remote plasma tower dielectric',x,4.01,-.58,.39,1.0,B.ceramic)
        for j in range(7):torus('Remote source winding',x,3.7+j*.105,-.58,.405,.028,B.copper)
        part('Remote source top housing',x,4.62,-.58,.91,.27,.9,teal)
        pipe('Radical delivery arch',[[x,4.63,-.58],[x,4.97,-.58],[x,4.97,.12],[x,3.62,.12]],.11,B.steel)
    pod(-2.12,1.84);console(2.3,2.92,1.3,teal);badge('REMOTE / STRIP',0,2.35,1.51,teal)

def pecvd():
    skid(0,-.4,6.7,5.1,navy)
    ribbed_drum('Four station deposition drum',0,2.05,-.22,2.16,2.12,ivory)
    for x,z in [(-.95,-1.17),(.95,-1.17),(-.95,.73),(.95,.73)]:
        cylinder('Individual showerhead lid',x,3.24,z,.7,.3,B.steel)
        cylinder('RF showerhead feed',x,3.68,z,.24,.6,B.ceramic)
        part('RF lid bridge',x,4.02,z,.88,.14,.83,navy)
    for x in [-2.65,2.65]:
        cabinet(x,-.57,.85,2.8,3.98,navy)
        for y in [1.15,2.15,3.15]:P.vent(x,y,.86,.61)
    pod(-.78,2.67);pod(.7,2.67,navy);console(2.6,3.02,1.62)
    badge('PECVD / MULTI',0,2.08,1.97,navy)

def ald():
    skid(.35,-.15,6.65,4.55,sage)
    ribbed_drum('ALD pressure controlled reactor',0,2.26,0,1.41,1.79,ivory)
    cylinder('Heated chamber upper dome',0,3.34,0,1.17,.44,champagne)
    for x in [-2.5,-1.78]:
        ribbed_drum('Heated precursor ampoule',x,2.18,-.65,.3,2.65,B.steel)
        cylinder('Precursor isolation valve',x,3.69,-.65,.14,.25,teal,vertices=24)
        pipe('Heated ALD delivery line',[[x,3.81,-.65],[x,4.02,-1.1],[0,4.02,-1.1],[0,3.6,0]],.047,champagne)
    cabinet(2.53,-.25,1.27,3.0,5.05,sage)
    for j in range(8):
        part('Pulse valve rack slot',2.53,1.4+j*.39,1.3,.97,.19,.08,carbon)
        cylinder('Valve status port',2.92,1.4+j*.39,1.36,.025,.025,B.green,'z',vertices=12)
    pod(-1.03,2.25,sage);console(2.57,4.7,1.4);badge('ALD / PULSE',0,2.7,1.38,sage)

def implant():
    skid(-.48,-.25,9.15,4.0,carbon)
    cabinet(-3.8,-.24,1.3,3.12,4.51,ochre)
    part('Ion source high voltage cap',-3.8,4.87,-.24,1.52,.48,2.53,ochre)
    ribbed_drum('Analyzing magnet return yoke',-.64,2.32,-.41,1.27,2.44,navy,12)
    for x in [-2.83,-2.48,-2.13]:
        cylinder('Beamline acceleration electrode',x,2.35,-.05,.57,.19,B.ceramic,'x')
    pipe('Extended beam transport shield',[[-3.1,2.35,0],[-1.45,2.35,0],[-.64,2.35,-.74],[.54,2.35,-.74],[1.52,2.35,0]],.35,B.steel)
    cylinder('Cylindrical end station vessel',1.74,2.35,0,1.36,1.48,ivory,'x')
    cylinder('End station service door',2.51,2.35,0,1.28,.13,navy,'x')
    torus('End station flange',2.61,2.35,0,1.26,.07,B.steel,'x')
    for j in range(5):part('High voltage caution band',-3.8,4.01+j*.11,1.34,.92,.045,.025,carbon)
    pod(2.6,2.06,navy);console(3.47,3.2,1.11)
    badge('ION / BEAMLINE',-.82,3.66,.68,navy)

def rtp():
    skid(0,0,4.65,4.1,ochre)
    cabinet(0,-.15,3.24,2.7,1.46,ochre)
    ribbed_drum('Radiant thermal reflector housing',0,2.36,0,1.52,1.57,ivory)
    cylinder('Circular lamp crown bezel',0,3.34,0,1.36,.27,champagne)
    for j in range(18):
        a=j*math.tau/18
        part('Lamp socket segment',math.cos(a)*1.17,3.57,math.sin(a)*1.17,.16,.19,.16,B.ceramic,.025)
    cylinder('Upper reflector window',0,3.51,0,.98,.045,acid)
    pipe('Optical pyrometer mast',[[1.78,1.6,-.77],[1.78,4.27,-.77],[.27,4.27,-.77]],.085,carbon)
    part('Pyrometer detector',.27,4.24,-.68,.43,.24,.6,carbon)
    for x in [-1.87,1.87]:part('RTP load lock enclosure',x,1.42,1.3,.87,.59,1.17,B.steel)
    pod(-1.67,2.3);console(2.12,2.73,1.63,ochre);badge('RTP / RADIANT',0,2.36,1.52,ochre)

def cmp():
    skid(.35,-.16,7.1,5.25,teal)
    cabinet(0,-.2,5.4,4.34,1.29,teal)
    for x,z in [(-1.58,-.55),(1.52,-.55),(0,1.13)]:
        cylinder('CMP polishing station guard',x,1.65,z,.91,.35,ivory)
        cylinder('CMP platen inspection lid',x,1.85,z,.85,.075,carbon)
        for radius in [.39,.69]:torus('Platen cover concentric detail',x,1.905,z,radius,.018,B.steel)
    cylinder('Carousel central column',0,2.27,-.43,.34,1.6,B.steel)
    cylinder('Raised carrier carousel',0,3.13,-.43,2.28,.22,teal,vertices=6)
    for x,z in [(-1.58,-.55),(1.52,-.55),(0,1.13)]:
        cylinder('Carousel carrier spindle',x,2.65,z,.13,.73,B.steel)
        cylinder('Polish carrier cover',x,2.23,z,.63,.34,ivory)
    cabinet(3.48,-.35,1.15,3.15,4.26,teal)
    for y in [1.25,2.38,3.51]:P.seam_door(3.48,y,1.24,.93,.92,True)
    pod(-2.56,2.58);console(2.65,3.02,1.9,teal);badge('CMP / PLANARIZE',0,1.12,2.04,teal)

def pvd():
    skid(0,-.4,7.6,6.0,champagne)
    ribbed_drum('Hexagonal vacuum transfer hub',0,1.66,-.1,1.67,1.68,carbon,6)
    for a in [0,math.pi/3,2*math.pi/3,math.pi]:
        x=math.cos(a)*2.57;z=-math.sin(a)*2.57-.1
        pipe('UHV gate valve neck',[[x*.47,1.7,z*.47],[x,1.7,z]],.32,B.steel)
        ribbed_drum('PVD target chamber vessel',x,2.16,z,.94,1.79,B.steel)
        cylinder('Magnetron target service cap',x,3.19,z,.79,.26,champagne)
        torus('Target cooling annulus',x,3.4,z,.63,.054,B.copper)
        part('Target magnet drive',x,3.58,z,.51,.29,.55,carbon)
        ribbed_drum('Turbomolecular service pump',x,.89,z-.45,.29,.67,carbon)
    pod(-.76,2.45,champagne);pod(.71,2.45)
    console(2.62,2.89,1.73,champagne);badge('PVD / VACUUM',0,2.5,1.45,champagne)

def metrology():
    skid(0,0,4.93,4.0,violet)
    part('Granite isolation block',0,.98,0,3.88,.69,3.2,carbon,.08)
    part('C frame rear optical column',0,3.15,-1.4,2.86,3.92,.53,ivory,.07)
    part('C frame optical bridge',0,4.94,-.25,3.57,.46,2.85,violet,.07)
    glazing(0,0,3.5,2.8,1.5,4.66,violet,clear,False)
    cabinet(2.81,-.35,1.15,2.92,3.52,violet)
    part('Optical electronics fin',2.82,4.0,-.35,.71,.9,1.32,ivory)
    pod(-2.54,1.59,violet);console(2.78,3.68,1.24)
    badge('OPTICAL / MEASURE',0,4.96,1.21,violet)

def probe():
    skid(.7,0,6.4,4.0,navy)
    cabinet(0,-.05,3.6,3.1,1.65,navy)
    part('Prober rear precision upright',0,3.06,-1.32,2.97,2.61,.41,ivory)
    part('Large cantilever test head',0,4.27,-.07,2.84,1.25,2.79,navy,.11)
    part('Probe head upper housing',0,4.99,-.3,2.45,.33,2.33,carbon,.07)
    torus('Probe card access bezel',0,3.61,.08,1.04,.075,B.steel)
    cylinder('Probe card access insert',0,3.55,.08,.97,.055,champagne)
    for x in [-1.58,1.58]:part('Test head docking arm',x,3.37,-.51,.23,1.59,.47,B.steel)
    cabinet(3.08,-.21,1.4,3.32,4.1,carbon)
    for y in [1.1,1.85,2.6,3.35]:P.vent(3.08,y,1.49,.96)
    pipe('Test head cable loom',[[1.32,4.52,-.73],[2.07,4.58,-1.07],[2.45,3.68,-1.18],[3.07,3.68,-1.18]],.17,carbon)
    pod(-2.48,1.43);console(-1.7,4.41,1.31);badge('PROBE / ELECTRICAL',0,4.37,1.35,navy)

BUILDERS={key:globals()[key] for key in IDENTITIES}

def build(tool):
    start=len(B.model_objects)
    BUILDERS[tool]()
    for obj in B.model_objects[start:]:obj['web_role']='exterior'
    B.equipment_identity={'tool':tool,'architecture':IDENTITIES[tool][0],'features':IDENTITIES[tool][1]}
    return len(B.model_objects)-start

def mechanism_details(tool):
    """Distinct support systems, outside all animated wafer/robot travel spaces."""
    start=len(B.model_objects)
    if tool=='clean':
        for j in range(3):
            x=2.35+j*.28
            cylinder('DI purification cartridge',x,2.55,-.94,.105,1.65,B.ceramic,vertices=24)
            pipe('DI supply circuit',[[x,3.4,-.94],[x,3.8,-.94],[.94,3.8,-1.2]],.025,teal)
    elif tool=='wetetch':
        for j in range(3):
            z=-.7+j*.65
            ribbed_drum('Dedicated acid canister',2.55,1.46,z,.28,1.5,B.ceramic)
            pipe('Acid dosing line',[[2.55,2.3,z],[2.55,3.5,z],[-.93,3.5,-1.3]],.024,ochre)
    elif tool=='oxidation':
        for y in [3.2,4.2,5.2]:
            part('Thermal zone controller',1.92,y,-.78,.45,.63,.53,ochre)
            pipe('Zone thermocouple harness',[[1.3,y,-.85],[1.92,y,-.78]],.034,B.ceramic)
    elif tool=='lpcvd':
        for z in [-.58,.6]:
            ribbed_drum('LPCVD vacuum pump assembly',2.28,1.13,z,.4,1.8,carbon)
            pipe('Vacuum manifold elbow',[[1.08,2.87,0],[2.28,2.87,0],[2.28,1.92,z]],.11,B.steel)
        for x in [-.46,.46]:
            pipe('Dual reactant injector',[[x,5.93,-.05],[x,6.32,-.05],[x,6.32,-1.45],[x,2.0,-1.45]],.038,champagne)
    elif tool in ['coat','developer']:
        for j in range(3 if tool=='developer' else 2):
            x=1.98+j*.35
            ribbed_drum('Developer rinse manifold' if tool=='developer' else 'Filtered resist cartridge',x,2.1,-.86,.12,1.1,B.ceramic if tool=='developer' else foup)
            pipe('Dedicated liquid control line',[[x,2.72,-.86],[x,3.23,-1],[.6,3.23,-1]],.023,teal if tool=='developer' else sage)
        if tool=='developer':
            # A separate downstream rinse cup differentiates the linear track
            # without moving the active developer wafer or its dispense arm.
            cylinder('Downstream rinse cup support',2.13,1.59,.35,.67,.23,carbon)
            for r in [.55,.66,.77]:torus('Downstream rinse bowl',2.13,1.94,.35,r,.044,B.ceramic)
            for x in [1.59,2.68]:
                pipe('Downstream rinse nozzle',[[x,1.68,-.28],[x,2.53,-.28],[2.13,2.53,.35]],.028,B.steel)
            part('Develop module connecting deck',1.37,1.56,.14,1.61,.12,2.24,B.steel)
    elif tool=='bake':
        for j in range(6):
            part('Stacked thermal plate module',2.15,1.35+j*.58,-.35,1.12,.3,1.62,ivory)
            part('Stacked ceramic heater',2.15,1.52+j*.58,-.35,.89,.05,1.4,B.ceramic)
        for x in [1.58,2.72]:part('Thermal stack support upright',x,2.94,-1.03,.09,3.85,.11,B.steel)
    elif tool=='rtp':
        for j in range(12):
            a=j*math.tau/12
            cylinder('Lower radiant lamp socket',math.cos(a)*1.05,1.43,math.sin(a)*1.05,.05,.26,B.ceramic,vertices=16)
        part('Reflective lamp power cabinet',2.05,1.63,-.8,.74,2.13,1.0,ochre)
    elif tool=='scanner':
        part('Reticle exchange bank',-2.34,3.92,-.77,.69,1.26,1.34,cobalt)
        for j in range(5):part('Reticle cassette slot',-2.34,3.5+j*.21,-.07,.52,.05,.06,B.steel)
    elif tool=='etch':
        ribbed_drum('ICP RF matching network',-2.1,2.05,-1.1,.43,1.2,navy)
        pipe('RF matching feed',[[-2.1,2.7,-1.1],[-2.1,3.8,-1.1],[-.9,3.8,-.6]],.065,B.copper)
    elif tool=='strip':
        cylinder('Remote source isolation sleeve',0,3.97,0,.37,.62,B.ceramic)
        for j in range(4):torus('Remote radical coil extension',0,3.8+j*.105,0,.38,.026,B.copper)
        cabinet(-2.15,-.46,.64,1.56,2.7,teal)
    elif tool=='pecvd':
        for x in [-2.06,2.06]:
            cylinder('RF auxiliary showerhead',x,2.41,-.8,.67,.15,B.steel)
            cylinder('RF ceramic feedthrough',x,2.7,-.8,.16,.43,B.ceramic)
    elif tool=='ald':
        for j,x in enumerate([-2.45,-1.82]):
            ribbed_drum('Precursor A' if j==0 else 'Precursor B',x,2.45,-1.22,.21,1.16,B.steel)
            part('Fast pulse valve',x,3.15,-1.22,.34,.24,.35,teal)
            pipe('Heated precursor delivery',[[x,3.26,-1.22],[x,3.65,-1.22],[-.4+j*.8,3.65,-.55]],.026,champagne)
    elif tool=='pvd':
        for x in [-2.02,2.02]:
            ribbed_drum('UHV target preparation chamber',x,1.93,-.75,.58,1.5,B.steel)
            torus('Target cooling circuit',x,2.78,-.75,.48,.045,B.copper)
    elif tool=='implant':
        for j in range(5):
            part('Analyzing magnet copper pack',-.04,2.07+j*.14,-1.04,1.23,.07,.26,B.copper)
        ribbed_drum('Source high voltage insulator',-2.7,2.65,-.73,.22,.83,B.ceramic)
    elif tool=='cmp':
        for z in [-.64,.55]:
            cylinder('Post polish brush spindle',2.59,2.01,z,.18,1.23,teal,'y',vertices=24)
        part('Brush clean rinse tank',2.59,1.28,-.03,.91,.41,1.86,B.ceramic)
    elif tool=='metrology':
        part('Spectrometer housing',1.95,3.06,-.93,.75,1.19,.78,violet)
        pipe('Ellipsometry return path',[[.52,3.55,0],[1.06,3.55,-.6],[1.95,3.55,-.93]],.07,carbon)
    elif tool=='probe':
        part('Probe test head electronics',0,4.52,-.15,2.07,.83,1.53,navy)
        pipe('Tester signal bundle',[[.9,4.63,-.24],[1.85,4.72,-.53],[2.25,3.83,-.83]],.12,carbon)
        cabinet(2.3,-.8,.68,1.5,3.1,navy)
    for obj in B.model_objects[start:]:obj['web_role']='mechanism'
