"""Create the CMOS equipment collection with shared Blender manufacturing details.

Animated seats, lids, carriers, probes and process effects are driven by fab-view.js.
These assets contain the surrounding static hardware in the same coordinates.
"""
import sys
import math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
import build_icp_chamber as B
from build_icp_chamber import box,cylinder,torus,pipe,label,bolts
import bpy

white,steel,bright,dark,black,ceramic,copper,green,orange,glass = (
    B.white,B.steel,B.bright,B.dark,B.black,B.ceramic,B.copper,B.green,B.orange,B.glass)


def cabinet(tool,w=3.6,h=1.4,d=2.6):
    box('Precision cabinet',0,h/2,0,w,h,d,white,.04)
    box('Satin service deck',0,h+.04,0,w+.08,.1,d+.08,bright,.02)
    box('Base shadow reveal',0,.16,d/2+.01,w-.18,.22,.025,dark,.007)
    for side in [-1,1]:
        x=side*w*.245
        box('Door perimeter seam',x,h*.56,d/2+.01,w*.47,h*.67,.024,dark,.012)
        box('Service door',x,h*.56,d/2+.029,w*.455,h*.64,.028,white,.012)
        box('Recessed pull handle',side*w*.42,h*.76,d/2+.05,.032,.22,.027,dark,.009)
        for j in range(6):box('Vent slot',x,h*.32+j*.04,d/2+.047,w*.23,.012,.009,dark,.003)
        for z in [-d*.4,d*.4]:
            cylinder('Leveling pad',side*w*.4,.025,z,.1,.1,black,vertices=24)
            cylinder('Leveling thread',side*w*.4,.09,z,.046,.13,steel,vertices=16)
        cylinder('Door latch',x,h*.41,d/2+.058,.022,.013,steel,'z',vertices=16)
    label('WAFERFLOW',-w*.36,h*.77,d/2+.049,.105)
    label(tool.upper(),-w*.36,h*.67,d/2+.049,.05)
    box('Equipment index',w*.25,h*.73,d/2+.052,.4,.14,.008,orange,.002)
    label('WF / '+tool[:3].upper(),w*.2,h*.71,d/2+.06,.04,ceramic)


def fittings(x,y,z):
    for j in range(3):
        cylinder('Compression fitting',x+j*.12,y,z,.037,.07,bright,vertices=6,bevel=.004)
        pipe('Instrument tubing',[[x+j*.12,y-.04,z],[x+j*.12,y-.22,z-.08],[x+j*.12,y-.46,z-.17]],.014,steel)


def wet(tool):
    cabinet(tool,5.8 if tool=='wetetch' else 4.1,1.1,3.2 if tool=='wetetch' else 2.8)
    for x in [-.93,.93]:
        box('PTFE bath base',x,1.24,0,1.82,.1,2.1,ceramic,.025)
        for side in [-1,1]:
            box('Transparent bath wall',x+side*.87,2.16,0,.06,1.84,2.05,glass,.01)
            box('Bath rim side',x+side*.88,3.11,0,.07,.075,2.16,ceramic,.014)
        for z in [-1,1]:
            box('Bath front inspection',x,2.16,z,1.74,1.84,.055,glass,.012)
            box('Bath upper frame',x,3.11,z,1.76,.075,.07,ceramic,.012)
        box('Liquid illustration',x,2.09,0,1.67,1.65,1.92,glass,0)
        for k in range(6):pipe('Bottom rinse manifold',[[x-.65+k*.26,1.31,-.8],[x-.65+k*.26,1.31,.8]],.013,white)
        pipe('Process liquid inlet',[[x,1.19,-1.13],[x,2.87,-1.13],[x,2.87,-.85]],.035,steel)
        fittings(x-.22,1.52,-1.18)
        label('CHEMICAL' if x<0 else 'DI WATER',x-.43,1.57,1.04,.073)
    for x in [-1.88,1.88]:
        box('Transfer gantry upright',x,3.16,-.93,.14,4.05,.16,steel,.02)
        cylinder('Gantry guide rod',x-.1,3.16,-.82,.025,4,bright,vertices=20)
    box('Gantry crosshead',0,5.25,-.93,3.95,.16,.23,steel,.018)
    for x in [-1.65,1.65]:box('Axis drive enclosure',x,5.2,-1.04,.42,.29,.29,dark,.025)
    pipe('N2 drying line',[[1.85,5.25,-.85],[1.85,4.25,.35],[.93,4.25,.35],[.93,3.8,.35]],.035,steel)


def furnace(tool):
    cabinet(tool,5.2 if tool=='lpcvd' else 3.2,1.1,2.9 if tool=='lpcvd' else 2.6)
    for x in [-1.4,1.4]:
        box('Tower structure',x,3.45,-.8,.15,4.65,.18,steel,.016)
        if tool=='oxidation':box('Removable thermal insulation',x,4.26,0,.14,2.95,2.5,white,.024,shell=True)
        pipe('Cooling loop',[[x,1.24,-1.17],[x,5.48,-1.17],[x*.8,5.48,-.7]],.032,steel)
    box('Source upper bridge',0,5.77,0,3.1,.2,2.6,white,.04)
    cylinder('Quartz process tube',0,4.25,0,1.12,2.8,glass)
    for j in range(19):torus('Heater winding',0,2.93+j*.145,0,1.15,.024,copper if j%5 else ceramic)
    for y in [2.85,5.69]:
        cylinder('Quartz flange',0,y,0,1.22,.105,bright)
        bolts(1.13,y+.07,16)
    cylinder('Upper gas distributor',0,5.85,0,.27,.18,steel)
    pipe('Process feed',[[0,5.96,0],[0,6.11,-.8],[-1.62,6.11,-1.0],[-1.62,1.4,-1]],.045,steel)
    for y in [3.2,4.2,5.2]:
        box('Heater terminal',1.39,y,.72,.23,.21,.28,ceramic,.016)
        pipe('Thermocouple',[[1.52,y,.72],[1.66,y,-.7],[1.66,1.5,-1.1]],.012,dark)
    label('THERMAL ZONES',-.66,5.735,1.311,.073)


def spin(tool):
    cabinet(tool,5.8 if tool=='developer' else 3.5,1.45,3.1 if tool=='developer' else 2.8)
    cylinder('Drain cup base',0,1.6,0,1.12,.2,dark)
    # A shallow annular splash cup preserves the exposed spinning wafer.
    for r in [1.04,1.13,1.22]:torus('Splash cup lip',0,1.94,0,r,.032,ceramic)
    for r in [.84,.93,1.02,1.11]:torus('Drainage step',0,1.72+(r-.84)*.54,0,r,.042,ceramic)
    cylinder('Vacuum chuck pedestal',0,1.8,0,.47,.13,dark)
    for x in [-1.62,1.62]:box('Service frame',x,2.28,-1.28,.075,1.65,.09,steel,.01)
    box('Track rear housing',0,2.3,-1.33,3.4,1.6,.07,dark,.018)
    box('Track top cover',0,3.1,0,3.45,.08,2.7,white,.025,shell=True)
    for x in [-1.3,1.3]:
        cylinder('Dispense reservoir',x,2.25,-1.08,.16,.48,white,vertices=32)
        cylinder('Reservoir cap',x,2.52,-1.08,.18,.07,green,vertices=32)
        fittings(x-.1,1.9,-1.13)
    pipe('Drain outlet',[[1,1.6,.6],[1.42,1.4,.9],[1.42,.7,1]],.065,dark)
    label('DEVELOP / RINSE' if tool=='developer' else 'RESIST / SPIN',-.83,2.95,-1.285,.07,ceramic)


def thermal(tool):
    cabinet(tool,3.35,1.45,2.6)
    cylinder('Thermal module base',0,1.61,0,1,.18,dark)
    cylinder('Ceramic heating plate',0,1.77,0,.88,.12,ceramic)
    for r in [.87,.96,1.04]:torus('Plate isolation lip',0,1.76,0,r,.012,bright)
    for x in [-1.25,1.25]:
        box('Linear guide column',x,2.5,-.64,.13,2.08,.17,dark,.016)
        cylinder('Precision guide rod',x,2.54,-.49,.045,2.02,bright,vertices=32)
        box('Guide support block',x,3.47,-.49,.23,.18,.23,steel,.015)
    box('Cover support crosshead',0,3.57,-.57,2.7,.16,.34,white,.025)
    pipe('Fixed exhaust',[[0,3.69,-.8],[0,3.69,-1.2],[1.42,3.69,-1.2],[1.42,1.5,-1.2]],.055,steel)
    box('Pyrometer electronics',-1.28,1.84,.69,.3,.38,.34,dark,.022)
    cylinder('Temperature optical port',-.99,1.88,.69,.056,.19,steel,'x',vertices=24)
    fittings(1.0,1.68,-.99)


def scanner(tool):
    cabinet(tool,4.4,1.45,3.3)
    for x in [-1.65,1.65]:
        box('Optical bridge pillar',x,2.6,-.65,.3,2.25,.35,white,.025)
        box('Column reference rail',x,2.65,-.43,.07,1.9,.03,steel,.007)
    box('Lens bridge',0,3.73,-.5,3.65,.3,.85,white,.04)
    cylinder('Projection lens housing',0,3.37,0,.56,.8,white)
    for y in [3.04,3.16,3.28,3.4,3.52]:
        torus('Objective adjustment collar',0,y,0,.575,.035,dark)
        for a in [0,math.pi/2,math.pi,math.pi*1.5]:
            cylinder('Lens calibration lock',math.cos(a)*.595,y,math.sin(a)*.595,.026,.06,steel,vertices=12)
    cylinder('Objective end element',0,2.83,0,.35,.2,dark)
    torus('Objective front bezel',0,2.73,0,.34,.022,bright)
    box('Reticle glass',0,4.4,0,1.65,.05,1.65,glass,.015)
    for x in [-.9,.9]:
        box('Reticle support',x,4.12,-.7,.1,.55,.1,steel,.008)
        box('Reticle guide',x,4.4,0,.12,.13,1.9,steel,.009)
    for z in [-.9,.9]:box('Reticle cross rail',0,4.4,z,1.75,.13,.12,steel,.009)
    for j in range(8):box('Illustrative reticle line',-.7+j*.2,4.436,0,.07,.006,1.4,dark,.001)
    for z in [-1,1]:box('XY guide bed',0,1.57,z,3.1,.1,.12,steel,.01)
    box('Alignment sensor',1.35,1.85,.3,.24,.37,.33,dark,.02)
    pipe('Objective coolant',[[.52,3.51,-.1],[.93,3.6,-.72],[1.65,3.6,-.89],[1.65,1.5,-1.25]],.025,steel)


def chamber(tool):
    cabinet(tool)
    cylinder('Vacuum pedestal',0,1.53,0,1.14,.15,dark)
    cylinder('Chuck support',0,1.7,0,.85,.14,steel)
    for y in [1.61,2.96]:
        cylinder('Vacuum flange',0,y,0,1.16,.11,bright)
        bolts(1.075,y+.074,20)
    cylinder('Process envelope',0,2.25,0,1.08,1.14,glass)
    cylinder('Upper electrode',0,2.77,0,.89,.08,ceramic if tool=='pvd' else dark)
    for j in range(6):torus('Gas distributor channel',0,2.719,0,.14+j*.13,.007,steel)
    if tool=='pvd':
        cylinder('Target backing plate',0,3.075,0,.9,.11,dark)
        for r in [.24,.49,.75]:torus('Magnetron source',0,3.15,0,r,.045,copper)
    elif tool=='strip':
        cylinder('Remote plasma source',0,3.34,0,.48,.59,ceramic)
        for j in range(4):torus('Remote source coil',0,3.16+j*.11,0,.49,.025,copper)
    else:
        for x in [-2.05,2.05]:
            cylinder('Auxiliary reaction module',x,.8,-.8,.77,1.5,dark)
            cylinder('Reaction lid',x,1.75,-.8,.76,.36,white)
            torus('Reaction module flange',x,1.96,-.8,.76,.035,steel)
            pipe('Vacuum transfer connection',[[x*.62,1.75,-.35],[x,1.75,-.8]],.22,steel)
            fittings(x-.15,2.13,-.8)
        if tool=='ald':
            for x in [-.4,.4]:
                cylinder('Precursor valve',x,3.22,-.55,.14,.29,steel,vertices=32)
                box('Fast valve actuator',x,3.42,-.55,.23,.16,.23,green,.015)
    pipe('Gas feed',[[0,3.15,0],[0,3.48,-.6],[1.35,3.48,-.83],[1.35,1.5,-.83]],.045,steel)
    pipe('Exhaust elbow',[[.94,1.85,0],[1.5,1.85,0],[1.65,1.45,-.7]],.11,steel)
    cylinder('Vacuum pump',1.65,1.5,-.73,.27,.5,dark)
    for j in range(7):torus('Pump fin',1.65,1.28+j*.065,-.73,.28,.016,steel)
    for x in [-.94,.94]:box('Gate guide',x,2.26,1.1,.08,1.06,.12,dark,.01)


def implant(tool):
    cabinet(tool,5.6,1.35,2.55)
    box('Ion source chamber',-2.05,2.4,0,.9,1.45,1.1,dark,.06)
    cylinder('Source extraction head',-2.05,3.2,0,.2,.3,ceramic)
    for j in range(6):torus('Source cooling fin',-2.05,3.0+j*.045,0,.235,.015,steel)
    pipe('Beamline vacuum tube',[[-1.6,2.35,0],[-.8,2.35,0],[0,2.35,-.65],[.8,2.35,-.65],[1.5,2.35,0]],.22,steel)
    for x in [-1.35,-.85]:
        torus('Beamline flange',x,2.35,0,.29,.033,bright,'x')
        cylinder('Beamline insulator',x,2.35,0,.258,.09,ceramic,'x',vertices=40)
    box('Mass analysis magnet',.05,2.35,-.65,.9,.9,.9,dark,.045)
    for j in range(8):
        box('Magnet winding',.05,2.04+j*.08,-.16,.83,.04,.045,copper,.01)
    cylinder('Scan station vessel',1.62,2.35,0,.97,.65,glass,'x')
    cylinder('Scan vessel end flange',2.02,2.35,0,.97,.13,bright,'x')
    torus('Scan vessel entrance flange',1.25,2.35,0,1,.04,steel,'x')
    cylinder('Tilt chuck',1.72,2.35,0,.72,.2,dark,'x')
    cylinder('Chuck shaft',1.9,2.35,0,.16,.24,steel,'x')
    for x in [.35,2.1]:box('Transfer door column',x,2.31,1.08,.07,1.86,.08,dark,.009)
    box('Door slide',1.2,3.26,1.08,1.82,.09,.12,steel,.012)
    fittings(-2.37,1.7,-.61)
    pipe('Source coolant',[[-2.44,2.75,-.35],[-2.66,2.75,-.65],[-2.66,1.47,-.8]],.024,green)


def cmp(tool):
    cabinet(tool,4.5,1.2,3.3)
    box('Polish gantry',1.56,2.32,-.72,.25,2.2,.27,white,.035)
    box('Carrier support',.75,3.48,-.5,1.9,.18,.24,steel,.022)
    box('Carrier crosshead',.35,3.48,-.2,.25,.18,.95,steel,.02)
    for y in [1.55,2.45,3.28]:box('Gantry linear bearing',1.56,y,-.535,.29,.18,.1,dark,.013)
    pipe('Slurry feed',[[-1.65,1.26,-.4],[-1.65,2.25,-.4],[-.55,2.25,-.15]],.04,steel)
    cylinder('Slurry nozzle',-.55,2.21,-.15,.055,.12,ceramic,vertices=24)
    box('Slurry flow meter',-1.88,1.76,-.75,.29,.49,.27,dark,.018)
    fittings(-2.0,1.53,-.75)
    for z in [-1.54,1.54]:box('Splash channel',0,1.3,z,4.25,.1,.11,ceramic,.02)


def inspect(tool):
    cabinet(tool,3.55,1.45,2.75)
    box('Metrology reference column',0,2.9,-.93,.28,2.8,.3,white,.035)
    box('Optical support bridge',0,4.22,-.4,2.3,.24,1.05,white,.045)
    cylinder('Optical column',0,3.62,0,.4,.85,dark)
    cylinder('Objective nose',0,3.12,0,.24,.16,ceramic)
    for y in [3.22,3.5,3.85]:torus('Objective collar',0,y,0,.414,.03,bright)
    box('Camera body',0,4.47,-.15,.58,.31,.6,dark,.025)
    box('Instrument connection plate',.62,4.24,.14,.23,.26,.15,steel,.012)
    for x in [-.6,.6]:
        cylinder('Calibration adjuster',x,4.26,.22,.065,.09,dark,'z',vertices=24)
    pipe('Camera signal cable',[[.23,4.47,-.35],[.56,4.6,-.82],[.36,3.45,-1.13],[.28,1.5,-1.13]],.025,black)
    label('PROBE / ALIGN' if tool=='probe' else 'OPTICAL / CD',-.72,4.2,.131,.07)
    if tool=='probe':
        box('Probe electronics',.83,3.1,-.77,.44,.57,.3,dark,.025)
        pipe('Probe signal loom',[[.8,3.35,-.74],[1.0,3.7,-.6],[1.1,4.0,-.2]],.028,steel)


BUILDERS={'etch':lambda tool:B.build_icp_model(),'clean':wet,'wetetch':wet,'oxidation':furnace,'lpcvd':furnace,'coat':spin,'developer':spin,
          'bake':thermal,'rtp':thermal,'scanner':scanner,'strip':chamber,'pecvd':chamber,'ald':chamber,
          'pvd':chamber,'implant':implant,'cmp':cmp,'metrology':inspect,'probe':inspect}


def preview_mechanisms(tool):
    """Complete the rendered study; corresponding live mechanisms remain in JavaScript."""
    if tool in ['clean','wetetch']:
        x=-.93
        box('Carrier lift crossbar',x,4.91,-.85,1.65,.1,.12,steel,.01)
        cylinder('Carrier lift rod',x,5.08,-.85,.04,.35,steel,vertices=24)
        for offset in [-.79,.79]:
            box('Carrier arm',x+offset,4.45,-.85,.075,.92,.09,steel,.008)
            box('Carrier support fork',x+offset,4,-.4,.075,.09,.88,steel,.008)
        torus('Tilting wafer cradle',x,3.9,0,.79,.018,ceramic)
        cylinder('Carrier wafer',x,4,0,.75,.025,dark)
    elif tool in ['oxidation','lpcvd']:
        for x in [-.88,.88]:
            box('Boat guide',x,1.92,-.91,.055,1.48,.055,steel,.008)
            cylinder('Quartz boat upright',x*.86,1.99,0,.045,1.55,ceramic,vertices=24)
        for j in range(11):
            cylinder('Boat wafer',0,1.45+j*.12,0,.75,.025,dark)
        box('Boat platform',0,1.18,0,2.1,.15,1.85,white,.03)
    elif tool in ['coat','developer']:
        pipe('Dispense arm',[[.98,1.5,-.64],[.98,2.7,-.64],[0,2.7,0]],.05,steel)
        cylinder('Dispense nozzle',0,2.58,0,.06,.2,ceramic,vertices=24)
        cylinder('Process wafer',0,1.895,0,.75,.03,dark)
    elif tool in ['bake','rtp']:
        cylinder('Thermal cover',0,2.75,0,1.04,.15,white)
        torus('Cover sealing rim',0,2.645,0,1,.04,steel)
        box('Driven cover crosshead',0,2.87,-.5,2.64,.15,.26,steel,.015)
        for x in [-1.1,1.1]:cylinder('Cover drive piston',x,3.22,-.5,.04,.6,steel,vertices=24)
        cylinder('Exhaust sleeve',0,3.22,-.8,.055,.76,steel,vertices=24)
        cylinder('Process wafer',0,1.845,0,.75,.03,dark)
        if tool=='rtp':
            for j in range(-3,4):
                cylinder('Radiant heating lamp',j*.23,2.63,0,.04,1.65,ceramic,'z',vertices=16)
    elif tool in ['scanner','metrology','probe']:
        box('XY wafer stage',0,1.65,0,2.2,.15,1.9,dark,.025)
        cylinder('Wafer chuck',0,1.78,0,.84,.12,steel)
        cylinder('Process wafer',0,1.855,0,.75,.03,dark)
        if tool=='probe':
            torus('Probe card',0,2.8,0,.95,.05,steel)
            for x in [-.45,.45]:
                for z in [-.3,.3]:pipe('Probe contact',[[x*2,2.8,z*2],[x,2.15,z],[x*.7,1.891,z*.7]],.018,steel)
    elif tool=='cmp':
        cylinder('Rotating platen',0,1.32,0,1.48,.15,dark)
        cylinder('Polishing pad',0,1.414,0,1.42,.028,ceramic)
        for j in range(11):torus('Pad slurry groove',0,1.435,0,.15+j*.12,.004,dark)
        cylinder('Carrier housing',.35,2.39,.1,.82,.79,glass)
        cylinder('Carrier back plate',.35,2.80,.1,.83,.08,steel)
        cylinder('Head drive spindle',.35,2.92,.1,.13,.3,steel)
        cylinder('Head piston',.35,3.16,.1,.09,.62,steel)
        cylinder('Wafer backing plate',.35,2.005,.1,.72,.05,dark)
        torus('Retaining ring',.35,1.99,.1,.82,.04,steel)
        cylinder('Process wafer',.35,1.965,.1,.75,.025,dark)
    elif tool=='implant':
        cylinder('Tilted process wafer',1.6,2.35,0,.75,.025,dark,'x')
    else:
        cylinder('Process wafer',0,1.79,0,.75,.025,dark)
        box('Transfer gate',0,2.54,1.1,1.78,.38,.08,steel,.016)

if __name__=='__main__':
    requested=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else list(BUILDERS)
    for tool in requested:
        bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
        B.model_objects.clear()
        BUILDERS[tool](tool)
        import equipment_identity
        equipment_identity.mechanism_details(tool)
        import equipment_enclosures
        equipment_enclosures.build(tool)
        print('BUILDING_CMOS',tool,flush=True)
        frame=8.0 if tool in ['oxidation','lpcvd'] else 7.5 if tool in ['clean','wetetch','implant','pecvd','ald'] else 6.2
        B.export_model('icp-chamber' if tool=='etch' else 'equipment-'+tool,resolution=950,samples=16,frame_size=frame,
                       render_extras=lambda:preview_mechanisms(tool))
