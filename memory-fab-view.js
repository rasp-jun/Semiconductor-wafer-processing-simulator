/* Code-native functional illustrations. Not manufacturer CAD or machine control. */
(function(root){
  'use strict';
  const smooth=v=>{v=Math.max(0,Math.min(1,v));return v*v*v*(v*(v*6-15)+10);};
  function svg(type,p=0){
    const t=root.MemoryFab.tools[type],active=p>0&&p<1,m=smooth(p/.18)*(1-smooth((p-.83)/.17)),y=8*(1-m),a=p*720;
    const rect=(x,y,w,h,fill='#8ba3ad',extra='')=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${fill}" ${extra}/>`;
    const line=(x1,y1,x2,y2,c='#80a7b5',w=2)=>`<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${c}" stroke-width="${w}" fill="none"/>`;
    const wafer=(x=145,y=133,rx=43)=>`<g><ellipse cx="${x}" cy="${y+3}" rx="${rx}" ry="${rx*.26}" fill="#294b66"/><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${rx*.26}" fill="#72a9b4" stroke="#c0d8d9" stroke-width=".8"/>${[-2,-1,0,1,2].map(n=>line(x+n*rx/4,y-rx*.19,x+n*rx/4,y+rx*.19,'#478496',.6)).join('')}</g>`;
    const pipe=`<path d="M180 38V27H235V135" fill="none" stroke="#87a8b8" stroke-width="5"/><path d="M180 38V27H235V135" fill="none" stroke="#cee1e6" stroke-width="1"/>`;
    const base=rect(75,139,153,36,'#6d8795')+rect(81,146,65,23,'#344f60')+rect(153,146,68,23,'#466071')+rect(86,152,4,10,'#9eb5bf')+rect(158,152,4,10,'#b5c5ca')+line(79,176,226,176,'#142b3b',4);
    let shape='';
    if(['har','etch','ald','cvd','pvd'].includes(type)){
      shape=pipe+rect(90,66,113,69,'#507180','stroke="#7997a6" fill-opacity=".3"')+`<ellipse cx="146" cy="67" rx="57" ry="15" fill="#97aeb6" stroke="#b7c8ce"/><ellipse cx="146" cy="73" rx="50" ry="10" fill="#547482"/><ellipse cx="146" cy="132" rx="56" ry="14" fill="#345768"/><ellipse cx="146" cy="129" rx="47" ry="11" fill="#96afba"/>`+wafer(146,123)+`<ellipse cx="146" cy="100" rx="44" ry="17" fill="${type==='pvd'?'#75dbd6':'#ac8bf0'}" opacity="${.10+.3*m}"/>`+Array.from({length:11},(_,i)=>`<circle cx="${108+i*7}" cy="${87+((p*50+i*7)%29)}" r="1.3" fill="#a5e8e1" opacity="${.25+.7*m}"/>`).join('')+rect(216,130,22,10,'#72949f');
    }else if(['coat','develop','cmp','grind'].includes(type)){
      shape=`<ellipse cx="146" cy="132" rx="69" ry="19" fill="#405d6b" stroke="#8ba8b3"/><ellipse cx="146" cy="126" rx="59" ry="16" fill="#8baab1"/>`+wafer(146,119)+`<g transform="rotate(${a} 146 119)"><ellipse cx="146" cy="119" rx="32" ry="8" fill="none" stroke="#b3d7d5" stroke-dasharray="4 8"/></g>`;
      if(['grind','cmp'].includes(type))shape+=rect(199,56,12,76,'#658594')+rect(141,54,70,10,'#a1b6be')+rect(140,64,12,26+y,'#b6c9cf')+`<ellipse cx="146" cy="${105-y}" rx="${type==='grind'?21:37}" ry="12" fill="#b7c7cc" stroke="#d6e1e2"/>`+rect(109,91-y,74,type==='grind'?0:14,'#7896a3');
      else shape+=`<path d="M209 127V70H150V91" fill="none" stroke="#abc3c9" stroke-width="6"/>`+line(150,92,150,118,'#78d5d4',1+m*2);
    }else if(['scanner','metro','inspect','probe','final'].includes(type)){
      shape=rect(203,39,12,99,'#88a4b1')+rect(119,37,97,13,'#adc1c8')+rect(134,50,28,30,'#90abb7')+rect(139,80,18,12,'#293f54')+wafer(145+Math.sin(p*12)*m*7,125)+`<path d="M141 93L107 122H184L156 93Z" fill="${type==='scanner'?'#a493ed':'#78dfe4'}" opacity="${.10+.15*m}"/>`;
      if(type==='scanner')shape+=rect(115,19,62,7,'#455972')+Array.from({length:8},(_,i)=>rect(119+i*7,19,2,7,'#c4dfd9')).join('');
      if(['probe','final'].includes(type))shape+=`<path d="M108 87L119 117M186 87L173 117" stroke="#b0c5ca" stroke-width="2"/>`;
    }else if(type==='clean'||type==='plate'){
      shape=rect(86,78,123,53,'#76a3ae','fill-opacity=".28" stroke="#adc9cf"')+rect(86,101,123,30,'#55b4c3','fill-opacity=".35"')+`<ellipse cx="146" cy="111" rx="29" ry="18" fill="#6593ae" stroke="#accbd5"/>`+`<path d="M97 74V46H210V77" stroke="#a5bcc5" stroke-width="5" fill="none"/>`+line(146,48,146,92,'#9fb9c5',4);
      if(type==='plate')shape+=rect(88,91,10,30,'#c1a57b')+rect(197,91,10,30,'#c1a57b')+Array.from({length:8},(_,i)=>`<circle cx="${105+i*11}" cy="${123-((p*30+i*5)%23)}" r="1.5" fill="#85eadc"/>`).join('');
    }else if(type==='furnace'){
      shape=rect(105,26,84,113,'#597485','stroke="#a0bac4" fill-opacity=".35"')+Array.from({length:10},(_,i)=>`<ellipse cx="147" cy="${47+i*8}" rx="34" ry="6" fill="none" stroke="#ba936d" stroke-width="2"/>`).join('')+Array.from({length:7},(_,i)=>wafer(147,60+i*9,22)).join('')+rect(113,34,68,92,'#f4b367',`opacity="${.06+m*.15}"`)+rect(102,25,90,9,'#93aebc');
    }else if(type==='implant'){
      shape=rect(76,70,35,54,'#608298')+`<path d="M111 95H134L158 71H181L202 97" stroke="#9bb7c4" stroke-width="14" fill="none"/>`+rect(141,62,31,29,'#94ad97')+`<ellipse cx="200" cy="107" rx="20" ry="31" fill="#769ead" stroke="#bdced7"/><ellipse cx="199" cy="107" rx="13" ry="23" fill="#416b87"/><path d="M102 95H134L158 71H181L202 97" stroke="#9edbff" stroke-width="${1+m*2}" fill="none" opacity=".8"/>`;
    }else if(type==='dice'){
      shape=wafer(146,124)+rect(80,59,9,76,'#7196a9')+rect(83,51,128,12,'#a1bbc7')+rect(120+m*44,63,8,31,'#90aab7')+`<circle cx="${124+m*44}" cy="103" r="19" fill="#a9c0c9" stroke="#e1ebed"/><path d="M${124+m*44} 87V119" stroke="#6b8d9e" transform="rotate(${a} ${124+m*44} 103)"/>`;
    }else if(type==='bond'){
      shape=rect(195,35,12,104,'#658ba1')+rect(125,30,82,13,'#a5bfca')+rect(130,43,10,33+30*m,'#c0d3dc')+rect(120,75+30*m,30,7,'#82a2b3')+Array.from({length:5},(_,i)=>rect(118,134-i*6,43,5,i%2?'#92c6bd':'#7394b9')).join('')+line(90,127,109,127,'#64d6c7',1)+line(170,127,190,127,'#64d6c7',1);
    }else if(type==='mold'){
      shape=rect(84,50,126,84,'#7293a3','fill-opacity=".4" stroke="#9eb6c0"')+rect(93,91,108,38,'#deac78',`fill-opacity="${.1+.15*m}"`)+rect(115,117,56,13,'#3e596e')+rect(113,110,60,6,'#8baab0')+Array.from({length:5},(_,i)=>`<path d="M${110+i*18} 76q-6 -8 0 -17" fill="none" stroke="#d7a97e" stroke-width="2"/>`).join('')+rect(80,43,135,9,'#bacad1');
    }
    const lines=Array.from({length:8},(_,i)=>`<path d="M${30+i*35} 172L${85+i*35} 207M20 ${177+i*4}H285" stroke="#406573" stroke-width=".5" opacity=".35"/>`).join('');
    return `<svg viewBox="0 0 300 205" role="img" aria-label="${t.name} 기능 모형"><ellipse cx="155" cy="177" rx="104" ry="16" fill="#071e2b" opacity=".5"/>${lines}${base}${shape}${rect(36,115,28,49,'#507488')}${rect(33,102,34,14,'#95b3c1')}${Array.from({length:6},(_,i)=>line(39,121+i*6,61,121+i*6,'#9cbdc9',1)).join('')}${line(63,142,76,142,'#7f9fac',5)}<circle cx="211" cy="141" r="2" fill="${active?'#7de8bb':'#96bac6'}"/><text x="20" y="24" fill="#7ea9b7" font-size="7" font-family="monospace" letter-spacing="1">${t.en}</text><text x="280" y="191" fill="#557e90" font-size="6" text-anchor="end" font-family="monospace">PRINCIPLE MODEL</text></svg>`;
  }
  function mount(host,type){
    const t=root.MemoryFab.tools[type];let view=null,wafer=null;
    if(t.view&&root.FabViewport&&root.FabEngine){view=root.FabViewport.mount(host);if(view.renderer){wafer=root.FabEngine.createWafer();view.select({tool:t.view,recipe:root.FabEngine.tools[t.view].defaults||{}});view.cutaway(true);view.renderer.domElement.setAttribute('aria-label','장비 작동 원리 3D 모형. 드래그로 회전, 휠로 확대.');view.renderer.domElement.removeAttribute('aria-haspopup');view.renderer.domElement.removeAttribute('aria-controls');}else view=null;}
    if(!view)host.innerHTML=svg(type);
    return{is3D:!!view,update(progress,running){const p=Math.max(0,Math.min(1,progress));if(view){const phase=p<.22?'load':p<.34?'condition':p<.82?'process':'unload',value=phase==='load'?p/.22:phase==='condition'?(p-.22)/.12:phase==='process'?(p-.34)/.48:(p-.82)/.18;view.update({phase,progress:value,running,speed:1,wafer,recipe:{}});}else host.innerHTML=svg(type,p);},camera:mode=>view?.camera(mode),dispose(){view?.dispose?.();host.innerHTML='';}};
  }
  root.MemoryFabView=Object.freeze({svg,mount});
})(window);
