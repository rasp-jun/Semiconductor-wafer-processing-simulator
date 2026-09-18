/* Original SVG process illustrations; diagrams are deliberately not to physical scale. */
(function (root) {
  'use strict';
  const svgStart = (label, viewBox = '0 0 600 350') => `<svg class="scene-svg" viewBox="${viewBox}" role="img" aria-label="${label}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="silicon" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#678999"/><stop offset=".5" stop-color="#3b6376"/><stop offset="1" stop-color="#203b51"/></linearGradient><linearGradient id="waferTop" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#4c7b88"/><stop offset=".5" stop-color="#284c5b"/><stop offset="1" stop-color="#172f40"/></linearGradient><linearGradient id="prTop" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#c299b0"/><stop offset=".45" stop-color="#90697f"/><stop offset="1" stop-color="#6b586f"/></linearGradient><linearGradient id="lightCone" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d3df9b" stop-opacity=".06"/><stop offset="1" stop-color="#d1ea98" stop-opacity=".28"/></linearGradient><radialGradient id="plasma"><stop stop-color="#b497d3" stop-opacity=".2"/><stop offset="1" stop-color="#8b78a7" stop-opacity="0"/></radialGradient><pattern id="waferGrid" width="19" height="15" patternUnits="userSpaceOnUse"><rect x="1" y="1" width="15" height="11" rx="1" fill="none" stroke="#a2d9c7" stroke-opacity=".35" stroke-width=".6"/></pattern><clipPath id="waferClip"><ellipse cx="300" cy="245" rx="152" ry="51"/></clipPath></defs>`;
  const label = (x, y, main, sub = '', color = '') => `<text x="${x}" y="${y}"${color ? ` style="fill:${color}"` : ''}>${main}</text>${sub ? `<text class="label-en" x="${x}" y="${y + 13}">${sub}</text>` : ''}`;
  const leader = (points, color = '#527785') => `<polyline points="${points}" fill="none" stroke="${color}" stroke-width=".8"/><circle cx="${points.split(' ')[0].split(',')[0]}" cy="${points.split(' ')[0].split(',')[1]}" r="2" fill="${color}"/>`;
  const isoBox = (x,y,w,d,h,top,side) => `<polygon points="${x},${y} ${x+w},${y} ${x+w+d*.7},${y-d*.45} ${x+d*.7},${y-d*.45}" fill="${top}" stroke="${side}" stroke-width=".7"/><polygon points="${x},${y} ${x+w},${y} ${x+w},${y+h} ${x},${y+h}" fill="${side}"/><polygon points="${x+w},${y} ${x+w+d*.7},${y-d*.45} ${x+w+d*.7},${y-d*.45+h} ${x+w},${y+h}" fill="${side}" opacity=".72"/>`;
  function section(result, stageIndex, progress = 1) {
    const stage = WaferEngine.stages[stageIndex].id;
    const oxideH = Math.max(10, Math.min(48, result.oxide * .25));
    const resistH = Math.max(25, Math.min(80, result.pr * .062));
    const remaining = Math.max(0, result.oxide - result.depth * progress) / result.oxide;
    const oxideY = 236 - oxideH;
    const width = Math.max(25, Math.min(76, (result.cd / 500) * 54));
    const opened = ['develop','etch','strip'].includes(stage);
    const hasPR = !['oxidation','strip'].includes(stage);
    let out = svgStart('현재 단계의 실리콘·산화막·감광막 단면');
    out += `<line x1="62" y1="282" x2="544" y2="282" stroke="#314a56" stroke-dasharray="3 4"/>`;
    out += isoBox(85,236,390,60,48,'url(#silicon)','#354d5d');
    if (stage === 'etch' || stage === 'strip') {
      for (let i=0;i<5;i++) {
        const x=85+i*78;
        out += isoBox(x,oxideY,78-width,60,oxideH,'#76c4b2','#428d81');
        const h = Math.max(1,oxideH * remaining);
        if(h>1.2) out += isoBox(x+78-width,236-h,width,60,h,'#d9aa7c','#976d50');
      }
    } else out += isoBox(85,oxideY,390,60,oxideH,'#73c7b7','#439184');
    if (hasPR) {
      if(opened) {
        for(let i=0;i<5;i++) out += isoBox(85+i*78,oxideY-resistH,78-width,60,resistH,'#c19bb5','#85637e');
        const residueHeight = Math.min(15,result.residue*.18);
        if(residueHeight>1) for(let i=0;i<5;i++) out+=isoBox(85+i*78+78-width,oxideY-residueHeight,width,60,residueHeight,'#edaa77','#b8754b');
      } else {
        out += isoBox(85,oxideY-resistH,390,60,resistH,'url(#prTop)','#866680');
        if(['exposure','peb'].includes(stage)) {
          for(let i=0;i<5;i++) out += isoBox(85+i*78+78-width,oxideY-resistH-.3,width,60,resistH,'#b5c392','#8e997b');
          out += label(100,85,'빛을 받은 PR · 아직 제거되지 않음','EXPOSED POSITIVE RESIST','#c8dfa5');
          if(stage==='exposure') for(let i=0;i<5;i++) out += `<path d="M${126+i*78} 107 v42" stroke="#d5ec8e" stroke-width="1.2" stroke-dasharray="4 6" class="beam"/>`;
        }
      }
    }
    if(stage==='develop') out += label(95,87,result.residue>10?'현상 부족 · 개구부에 PR 잔사':'노광된 PR 제거 · 식각 창 형성','DEVELOPMENT',result.residue>10?'#edaa77':'#d0ec90');
    if(stage==='etch'||stage==='strip') out += label(95,85,result.depth<result.oxide?'산화막 잔류 · 식각량 부족':'열린 영역의 산화막 제거','PATTERN TRANSFER',result.depth<result.oxide?'#edaa77':'#d0ec90');
    if(stage==='oxidation') out += label(95,100,'실리콘 표면의 산화막 성장','Si + O₂ → SiO₂','#9bdbbd');
    if(stage==='coat'||stage==='softbake') out += label(95,90,stage==='coat'?'양성 감광막의 균일 도포':'감광막 내 용매 감소','POSITIVE PHOTORESIST','#cfacc0');
    out += leader('470,264 524,264 540,251') + label(506,245,'Si');
    out += label(90,315,`산화막 ${result.oxide.toFixed(1)} nm · PR ${hasPR?result.pr.toFixed(0):'0'} nm`,'LAYER HEIGHTS EXAGGERATED FOR VISIBILITY');
    if(opened) out += label(350,315,`모델 개구 CD ${result.cd.toFixed(1)} nm`,'TARGET CD 500 nm');
    return out+'</svg>';
  }
  function scene(result, stageIndex, progress = 1) {
    const stage = WaferEngine.stages[stageIndex].id;
    let out = svgStart(`${WaferEngine.stages[stageIndex].name} 공정 장면. ${WaferEngine.stages[stageIndex].description}`);
    out += `<ellipse cx="302" cy="294" rx="202" ry="43" fill="#071116" opacity=".55"/><ellipse cx="300" cy="270" rx="176" ry="60" fill="#172a35" stroke="#395561"/><path d="M124 267v13c0 80 352 80 352 0v-13" fill="#192c36" stroke="#395561"/><ellipse cx="300" cy="267" rx="176" ry="60" fill="#203642" stroke="#4a6672"/><path d="M148 245v10c0 69 304 69 304 0v-10" fill="url(#silicon)" stroke="#75969b" stroke-width=".7"/>`;
    const hasPR = !['oxidation','strip'].includes(stage);
    out += `<ellipse cx="300" cy="245" rx="152" ry="51" fill="${hasPR?'url(#prTop)':'url(#waferTop)'}" stroke="${hasPR?'#c39aaf':'#79bead'}" stroke-width="1"/>`;
    if(stage==='oxidation') out += `<ellipse cx="300" cy="244" rx="151" ry="50" fill="#70cbb6" opacity="${.12+progress*.38}" stroke="#87d4bb"/>`;
    if(['exposure','peb'].includes(stage)) out += `<g clip-path="url(#waferClip)" opacity="${.3+progress*.6}">${Array.from({length:7},(_,i)=>`<path d="M${152+i*46} 187l-65 122h21l65-122z" fill="#c7d39e" opacity=".74"/>`).join('')}</g>`;
    if(['develop','etch','strip'].includes(stage)) {
      out+=`<g clip-path="url(#waferClip)">${Array.from({length:8},(_,i)=>`<path d="M${150+i*45} 185l-67 124h24l67-124z" fill="${stage==='develop'?'#76c7b5':'#254b5d'}" stroke="#7fbaa7" stroke-width=".5"/>`).join('')}<rect x="140" y="193" width="320" height="105" fill="url(#waferGrid)" opacity=".35"/></g>`;
      if(result.residue>12&&stage==='develop') out += `<ellipse cx="290" cy="246" rx="40" ry="13" fill="#e6a577" opacity=".55"/>`;
      if(result.dominant==='과식각'&&result.yield<90&&stage==='etch') out+=`<ellipse cx="300" cy="245" rx="145" ry="47" fill="none" stroke="#eba477" stroke-width="4" opacity=".7" stroke-dasharray="7 5"/>`;
    }
    out += `<path d="M295 295l5-5 5 5" fill="#203642" stroke="#a6c0b2" stroke-width=".8"/>`;
    if(stage==='exposure') {
      out += `<path d="M228 52h144l72 194c-90 54-198 48-289 0z" fill="url(#lightCone)" class="beam"/>`;
      out += isoBox(232,48,136,25,12,'#526465','#293d48');
      out += `<rect x="248" y="62" width="106" height="5" rx="2" fill="#dfedb4"/><path d="M171 129l205 0 54-33H225z" fill="#b2c7c7" fill-opacity=".11" stroke="#91b2ab"/>`;
      for(let i=0;i<6;i++) out += `<path d="M${179+i*35} 129h20l54-33h-20z" fill="#708c92" opacity=".9"/>`;
      out += `<path d="M171 129v7h205v-7M376 129l54-33v7l-54 33" fill="#354d56" stroke="#66877f" stroke-width=".6"/>`;
      for(let i=0;i<5;i++) out+=`<path d="M${222+i*30} 146l${(i-2)*7} 64" fill="none" stroke="#cfe78c" stroke-width="1.1" stroke-dasharray="4 5" opacity="${Math.min(.85,result.params.dose/170)}" class="beam"/>`;
      out += leader('352,50 424,36 446,36')+label(451,39,'UV 광원','365 nm · i-line');
      out += leader('393,116 450,98 482,98')+label(480,86,'포토마스크','CHROME / QUARTZ');
      out += leader('245,200 105,167 61,167')+label(40,149,'노광 영역','LATENT IMAGE','#d0ec90');
      out += label(205,327,`노광량 ${result.params.dose} mJ/cm² · 초점 ${result.params.focus.toFixed(2)} µm`,'LIGHT CHANGES SOLUBILITY — DEVELOPMENT REMOVES PR');
    } else if(stage==='coat') {
      out += `<path d="M306 48v43h-12v-43h-67v-13h88v13" fill="#57727c" stroke="#9ab8bc" stroke-width="1"/><path d="M294 91h12l-4 14h-4z" fill="#9eaab0"/><path d="M300 106v105" stroke="#c89db7" stroke-width="3" stroke-dasharray="10 7" class="beam"/><ellipse cx="300" cy="245" rx="${30+progress*116}" ry="${10+progress*36}" fill="#cba5bc" opacity=".35"/><ellipse cx="300" cy="245" rx="120" ry="34" fill="none" stroke="#dbc0d0" stroke-opacity=".7" stroke-dasharray="100 60"/><path d="M440 253l14-2-3 10" fill="none" stroke="#d0ec90" stroke-width="1.3"/>`;
      out += leader('306,79 380,63 431,63')+label(436,65,'PR 공급 노즐','POSITIVE RESIST');
      out += leader('154,248 111,219 53,219')+label(35,200,'스핀 코팅',`${result.params.rpm} rpm`,'#d0ec90');
      out += label(220,328,`감광막 두께 ${result.pr.toFixed(0)} nm`,'THICKNESS ∝ 1 / √SPIN SPEED');
    } else if(['softbake','peb','oxidation'].includes(stage)) {
      const oxidation=stage==='oxidation';
      out += `<ellipse cx="300" cy="271" rx="163" ry="53" fill="none" stroke="#d8a16a" stroke-width="2" opacity=".6"/><path d="M210 157q-12-15 0-29t0-29M260 163q-12-15 0-29t0-29M310 158q-12-15 0-29t0-29M360 156q-12-15 0-29t0-29" fill="none" stroke="${oxidation?'#e3b474':'#b8cc9c'}" stroke-width="1.5" class="heat"/>`;
      if(oxidation) out += `<path d="M120 211v-117q180-58 360 0v117" fill="none" stroke="#715c4c" stroke-width="9"/><path d="M136 207v-102q165-50 330 0v102" fill="none" stroke="#b88b5f" stroke-width="2" stroke-dasharray="3 9"/>`;
      out += leader('405,274 460,290 486,290')+label(483,279,oxidation?'산화로':'핫플레이트',oxidation?'THERMAL OXIDATION':'CONTROLLED HEATING');
      out += label(45,107,oxidation?'O₂ 반응 분위기':stage==='softbake'?'용매 증발':'패턴 안정화',oxidation?'Si → SiO₂':'THERMAL TREATMENT','#d0ec90');
      out += label(229,327,`${oxidation?result.params.temperature:stage==='softbake'?result.params.bakeTemp:result.params.pebTemp} °C · ${oxidation?result.params.oxidationTime+' min':stage==='softbake'?result.params.bakeTime+' s':'60 s'}`,'RECIPE-DEPENDENT THERMAL STEP');
    } else if(stage==='develop') {
      out += `<path d="M286 42h28v65h-28z" fill="#4c6976" stroke="#8eaeb7"/><path d="M284 106h32l-12 20h-8z" fill="#8ca6b1"/><path d="M300 126l-72 111q73 23 144 0z" fill="#91c8dd" opacity=".09"/>`;
      for(let i=0;i<14;i++) out+=`<circle class="ion" cx="${247+(i*31)%111}" cy="${145+(i*13)%64}" r="${1+i%2}" fill="#87c8d7" style="animation-delay:-${i*.13}s"/>`;
      out += leader('315,75 405,70 440,70')+label(445,72,'현상액 공급','DEVELOPER DISPENSE');
      out += leader('258,243 128,174 65,174')+label(40,153,'노광된 PR 제거','POSITIVE-TONE DEVELOPMENT','#d0ec90');
      out += label(198,327,`현상 ${result.params.developTime} s · 잔사 ${result.residue.toFixed(1)} nm`,'EXPOSED AREAS DISSOLVE, PATTERN OPENS');
    } else if(stage==='etch') {
      out += `<path d="M111 231V106q187-70 378 0v125" fill="none" stroke="#526f7b" stroke-width="1.2"/><path d="M126 222V115q173-60 347 0v107" fill="none" stroke="#2b4a59" stroke-dasharray="4 6"/><ellipse cx="300" cy="96" rx="159" ry="33" fill="#233b49" stroke="#678591"/><ellipse cx="300" cy="98" rx="137" ry="22" fill="#1d303b" stroke="#415966"/><ellipse cx="300" cy="176" rx="150" ry="83" fill="url(#plasma)"/>`;
      for(let i=0;i<30;i++) out+=`<circle class="ion" cx="${185+(i*43)%225}" cy="${123+(i*31)%90}" r="${1+i%3*.35}" fill="${i%3?'#aab7d0':'#d6b7ee'}" style="animation-delay:-${i*.09}s"/>`;
      out += leader('447,98 478,64 498,64')+label(468,50,'상부 전극','RF PLASMA');
      out += leader('245,176 131,145 65,145')+label(30,125,'이온 · 반응종',`${result.params.power} W / ${result.params.pressure} mTorr`,'#d0ec90');
      out += label(195,328,`식각 ${result.params.etchTime} s · 제거 깊이 ${result.depth.toFixed(1)} nm`,'PATTERN TRANSFER INTO THE OXIDE');
    } else {
      out += `<ellipse cx="300" cy="245" rx="152" ry="51" fill="url(#waferGrid)" opacity=".42"/><path d="M300 47v30m-15-15h30" stroke="#afcca1" opacity=".6"/><circle cx="300" cy="62" r="27" fill="none" stroke="#456044"/>`;
      out += leader('374,248 430,174 486,174')+label(460,157,'남은 산화막 패턴','PR REMOVED','#d0ec90');
      out += label(202,327,'감광막 제거 후 패턴 전사 확인','INSPECT OXIDE OPENINGS & RESIDUES');
    }
    out += leader('422,264 467,237 510,237')+label(494,223,'Si 웨이퍼','300 mm');
    return out+'</svg>';
  }
  function map(result, interactive = true) {
    let out = svgStart(`합성 웨이퍼 맵. 전체 ${result.total}개 중 ${result.bad}개 불량. 수율 ${result.yield}%.`, '0 0 360 340');
    out += `<circle cx="180" cy="165" r="140" fill="#162b2d" stroke="#617f7b"/><circle cx="180" cy="165" r="149" fill="none" stroke="#37525b" stroke-dasharray="2 5"/><path d="M174 305l6-7 6 7" fill="#111b22" stroke="#617f7b"/><line x1="24" y1="165" x2="336" y2="165" stroke="#365460" stroke-dasharray="2 5"/><line x1="180" y1="14" x2="180" y2="314" stroke="#365460" stroke-dasharray="2 5"/>`;
    result.dies.forEach((d,i)=> {
      const alpha=.64+(d.x+d.y+30)%4*.07;
      out += `<rect class="die" x="${180+d.x*10-4.1}" y="${165+d.y*10-4.1}" width="8.2" height="8.2" rx=".6" fill="${d.failed?'#e6a176':'#6ab6a3'}" opacity="${d.failed?.95:alpha}" ${interactive?`data-die="${i}"`:''}><title>다이 (${d.x}, ${d.y}) · ${d.kind} · 식각 ${d.depth} nm</title></rect>`;
    });
    out += `<text x="180" y="330" text-anchor="middle" class="dimension">${result.total} DIES · GOOD ${result.good} · FAIL ${result.bad}</text>`;
    return out+'</svg>';
  }
  root.WaferVisuals = { scene, section, map };
})(globalThis);
