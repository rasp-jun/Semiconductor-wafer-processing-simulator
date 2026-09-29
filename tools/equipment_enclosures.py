"""Original industrial envelopes, informed by the public references manifest.

Dimensions are illustrative simulator coordinates, never vendor specifications.
Exterior objects disappear in mechanism view; animated internals stay in place.
"""
import math
import build_icp_chamber as B
from build_icp_chamber import box,cylinder,label,torus

porcelain=B.material('Industrial porcelain panels','d8dfe2',.18,.32)
graphite=B.material('Service frame graphite','313b48',.45,.31)
window=B.material('Smoked inspection panels','263b47',.3,.2)
blue=B.material('AXIS instrument blue','455d80',.48,.3)
amber=B.material('Amber status lens','eaaa45',.3,.27)
red=B.material('Emergency stop actuator','b93831',.08,.4)
screen=B.material('HMI display','142b38',.2,.19)

def panel(name,x,y,z,w,h,d,mat=porcelain):
    return box(name,x,y,z,w,h,d,mat,.025)

def seam_door(x,y,z,w,h,glass=False):
    panel('Panel gasket',x,y,z,w,h,.07,graphite)
    panel('Removable service door',x,y,z+.045,w-.035,h-.035,.045,window if glass else porcelain)
    panel('Recessed door pull',x+w*.37,y,z+.077,.028,.32,.025,graphite)
    for offset in [-.3,.3]:cylinder('Captive quarter turn fastener',x-w*.38,y+offset*h,z+.081,.022,.01,B.steel,'z',vertices=12)

def vent(x,y,z,w):
    for j in range(8):panel('Filtered air intake slot',x,y+j*.055,z,w,.018,.012,graphite)

def tower(x,y,z):
    cylinder('Signal tower mast',x,y,z,.034,.44,B.steel,vertices=16)
    for i,mat in enumerate([B.green,amber,red]):cylinder('Stack light segment',x,y+.25+i*.105,z,.075,.092,mat,vertices=24)
    cylinder('Signal tower cap',x,y+.575,z,.078,.035,graphite,vertices=24)

def hmi(x,y,z):
    panel('Operator console',x,y,z,.75,.62,.11,graphite)
    panel('HMI glass',x,y+.035,z+.066,.65,.43,.013,screen)
    for j,w in enumerate([.43,.31,.48]):panel('HMI status line',x-.03,y+.16-j*.11,z+.076,w,.014,.008,B.green)
    panel('Folded keyboard shelf',x,y-.5,z+.16,.82,.06,.4,porcelain)
    panel('Keyboard',x,y-.46,z+.18,.62,.025,.25,graphite)
    cylinder('Emergency stop collar',x+.55,y-.18,z+.05,.082,.025,amber,'z',vertices=24)
    cylinder('Emergency stop button',x+.55,y-.18,z+.085,.051,.075,red,'z',vertices=24)

def body(x,z,w,d,h,front=True):
    panel('Equipment plinth',x,.18,z,w+.08,.32,d+.08,graphite)
    for side in [-1,1]:
        panel('Side service skin',x+side*w/2,h/2+.2,z,.1,h,d)
        for rz in [-.34,.34]:cylinder('Cabinet levelling foot',x+side*(w/2-.18),.03,z+rz*d,.095,.08,graphite,vertices=16)
    panel('Rear utility enclosure',x,h/2+.2,z-d/2,w,h,.1)
    panel('Filtered ceiling',x,h+.2,z,w+.06,.18,d+.05)
    panel('Top ventilation reveal',x,h+.09,z+d/2+.03,w-.18,.13,.035,graphite)
    if front:
        count=max(2,round(w/1.3));dw=(w-.18)/count
        for j in range(count):seam_door(x-w/2+.09+(j+.5)*dw,h/2+.18,z+d/2,dw-.025,h-.2)
    vent(x+w*.28,h-.68,z+d/2+.062,w*.22)

def port(x,z):
    panel('Load port tower',x,1.17,z,.98,2.05,.3,porcelain)
    panel('FOUP docking seal',x,2.12,z+.19,1.03,1.11,.11,graphite)
    panel('Load port shelf',x,1.54,z+.54,1.21,.13,.9,B.steel)
    panel('Sealed FOUP',x,2.02,z+.59,1.04,.92,.84,window)
    panel('FOUP carry handle',x,2.51,z+.59,.44,.08,.22,graphite)
    for side in [-1,1]:
        panel('FOUP side grip',x+side*.52,2.12,z+.58,.065,.34,.2,porcelain)
        for j in range(5):panel('FOUP shell rib',x+side*.53,1.74+j*.13,z+.57,.026,.018,.64,B.steel)
    label('LOAD',x-.24,.95,z+.166,.068,B.ink)

def front_end(x,z,w,tool,ports=2,h=4):
    body(x,z,w,1.0,h)
    panel('EFEM dark fascia',x,2.08,z+.565,w-.16,1.24,.06,graphite)
    for j in range(ports):port(x+(j-(ports-1)/2)*1.35,z+.61)
    label('AXIS / '+tool.upper(),x-w*.43,h-.39,z+.563,.13,B.ink)
    panel('Instrument accent',x-w*.43,h-.6,z+.563,.36,.035,.01,blue)
    hmi(x+w*.34,3.1,z+.62)
    tower(x+w*.4,h+.5,z)

def build(tool):
    # Edition 03 owns distinct architecture; shared manufacturing details above.
    from equipment_identity import build as build_identity
    return build_identity(tool)
