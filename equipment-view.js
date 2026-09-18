/* Original equipment principle drawing. Not an OEM model or dimensional reconstruction. */
(function(root) {
  'use strict';
  const PARTS = Object.freeze({
    source: Object.freeze({title: '이온 소스 · Ion source', body: '이온을 생성하고 가속해 웨이퍼 표면으로 보냅니다. 여기서는 빔 전압과 전류를 표시합니다. 전압·전류만으로 제거 깊이를 확정할 수는 없으며, 재료별 수율과 장비 보정 데이터가 필요합니다.'}),
    shutter: Object.freeze({title: '빔 셔터 · Beam shutter', body: '이온 소스와 웨이퍼 사이의 빔 경로를 여닫는 차폐 부품입니다. 화면의 빔은 빔 활성 신호와 셔터 열림 신호가 모두 확인될 때만 표시됩니다. 실제 장비의 셔터 위치와 응답 속도는 장비별 데이터가 필요합니다.'}),
    stage: Object.freeze({title: '웨이퍼 스테이지 · Wafer stage', body: '웨이퍼를 지지하고 회전·기울기를 조절합니다. 회전은 조사 방향을 분산하며 기울기는 이온 입사 방향을 바꿉니다. 화면의 높이·직경·기구 배치는 원리 설명용이며 실제 충돌 검증용 형상이 아닙니다.'}),
    vacuum: Object.freeze({title: '진공 배기 · Vacuum system', body: '챔버 내부를 배기하고 공정에 필요한 압력 상태를 만듭니다. 압력 측정값과 펌프 신호는 서로 별개입니다. 펌프 신호가 누락된 로그에서는 압력 수치만으로 펌프의 작동 여부를 추정하지 않습니다.'}),
    cooling: Object.freeze({title: '웨이퍼 냉각 · Helium cooling', body: '웨이퍼 후면의 헬륨과 냉각 구조는 공정 중 열 전달에 관여합니다. 화면은 헬륨 압력만 표시하며, 이 값으로 실제 웨이퍼 온도나 열 손상을 검증하지 않습니다. 유량·온도·누설 및 접촉 상태 데이터가 추가로 필요합니다.'}),
    transfer: Object.freeze({title: '웨이퍼 이송 · Wafer transfer', body: '진공 게이트와 이송 기구가 웨이퍼를 챔버에 넣고 꺼냅니다. 이 화면의 로봇 위치는 0–1로 정규화된 이송 신호를 표현합니다. 실제 로봇 축 좌표나 안전 궤적을 재현한 것이 아니며, 신호가 없으면 이송 동작을 표시하지 않습니다.'})
  });
  const STAGES = Object.freeze({load: '웨이퍼 투입', pump: '진공 배기', stabilize: '조건 안정화', process: '이온 밀링', cooldown: '빔 정지 · 냉각', vent: '벤트', unload: '웨이퍼 회수', unknown: '단계 미확인', complete: '구동 완료', aborted: '구동 중단'});
  let nextId = 0;
  function create(container, {onSelect = function() {}} = {}) {
    if (!container || typeof container.appendChild !== 'function') throw new TypeError('장비 화면 컨테이너가 필요합니다.');
    const doc = container.ownerDocument || root.document, id = 'eq-scene-' + (++nextId);
    const host = doc.createElement('div');
    host.className = 'equipment-cutaway';
    host.style.cssText = 'width:100%;min-width:0;position:relative;';
    const ref = name => id + '-' + name;
    const bolts = Array.from({length:20}, (_, i) => { const a = i * Math.PI / 10; return '<circle cx="' + (496 + 185*Math.cos(a)).toFixed(2) + '" cy="' + (263 + 185*Math.sin(a)).toFixed(2) + '" r="4" fill="#182a3a" stroke="#8196a7" stroke-width="1.4"/><path d="M' + (493 + 185*Math.cos(a)).toFixed(2) + ' ' + (263 + 185*Math.sin(a)).toFixed(2) + 'h6" stroke="#9dacb7" stroke-width=".8"/>'; }).join('');
    const rays = Array.from({length:11}, (_, i) => '<line data-ray="' + i + '" x1="' + (463+i*6.6) + '" y1="183" x2="' + (419+i*15.4) + '" y2="327" stroke="#a8f5ee" stroke-width="1.3" stroke-dasharray="4 13" opacity=".45"/>').join('');
    const grille = Array.from({length:9}, (_, i) => '<path d="M458 ' + (122+i*5) + 'h76" stroke="' + (i%2 ? '#93aab7' : '#3a596c') + '" stroke-width="2"/>').join('');
    const stageMarks = Array.from({length:7}, (_,i)=>'<path d="M'+(440+i*18)+' 355v8" stroke="#607d8f" stroke-width="1"/>').join('');
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 960 520" width="960" height="520" role="group" aria-label="이온 밀링 장비 원리 절개 화면. 부품을 선택하면 설명이 열립니다." style="display:block;width:100%;height:auto;max-height:none;font-family:Inter,Pretendard,Arial,sans-serif">
      <defs>
        <linearGradient id="${ref('bg')}" x2="1" y2="1"><stop stop-color="#0a1623"/><stop offset="1" stop-color="#12283a"/></linearGradient>
        <radialGradient id="${ref('cavity')}"><stop stop-color="#1c3b4c"/><stop offset=".7" stop-color="#112735"/><stop offset="1" stop-color="#08131e"/></radialGradient>
        <linearGradient id="${ref('metal')}" x1="0" y1="0" x2=".85" y2="1"><stop stop-color="#c3d0d7"/><stop offset=".18" stop-color="#61798b"/><stop offset=".45" stop-color="#d2dde2"/><stop offset=".57" stop-color="#607587"/><stop offset="1" stop-color="#253e50"/></linearGradient>
        <linearGradient id="${ref('dark-metal')}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#6a8799"/><stop offset=".35" stop-color="#314d61"/><stop offset=".8" stop-color="#142a3b"/><stop offset="1" stop-color="#7895a5"/></linearGradient>
        <linearGradient id="${ref('wafer')}" x2="1" y2=".35"><stop stop-color="#38c5c9"/><stop offset=".3" stop-color="#82d0dd"/><stop offset=".54" stop-color="#566cb1"/><stop offset=".75" stop-color="#b3a1dd"/><stop offset="1" stop-color="#57c7c8"/></linearGradient>
        <linearGradient id="${ref('beam')}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#a8fff0" stop-opacity=".48"/><stop offset=".55" stop-color="#69edda" stop-opacity=".17"/><stop offset="1" stop-color="#68dbc4" stop-opacity=".04"/></linearGradient>
        <linearGradient id="${ref('glass')}" x2="0" y2="1"><stop stop-color="#b4e7ee" stop-opacity=".14"/><stop offset="1" stop-color="#b4e7ee" stop-opacity=".025"/></linearGradient>
        <pattern id="${ref('grid')}" width="32" height="32" patternUnits="userSpaceOnUse"><path d="M32 0H0V32" fill="none" stroke="#57778d" stroke-opacity=".08" stroke-width="1"/></pattern>
        <pattern id="${ref('die')}" width="13" height="9" patternUnits="userSpaceOnUse"><path d="M13 0H0V9" fill="none" stroke="#d0eff7" stroke-opacity=".33" stroke-width=".6"/></pattern>
        <filter id="${ref('soft')}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="7"/></filter>
        <clipPath id="${ref('chamber-clip')}"><circle cx="496" cy="263" r="167"/></clipPath>
      </defs>
      <style>
        #${id} .eq-label{font-size:10px;letter-spacing:1.3px;fill:#8ba6ba;font-weight:600}
        #${id} .eq-value{font-size:12px;fill:#d7e7ef;font-variant-numeric:tabular-nums}
        #${id} .eq-part{cursor:pointer;outline:none}
        #${id} .eq-highlight{fill:none;stroke:#72e5d1;stroke-width:2;opacity:0;pointer-events:none}
        #${id} .eq-part:hover .eq-highlight,#${id} .eq-part:focus .eq-highlight{opacity:1}
        #${id} .eq-part:hover .eq-part-title,#${id} .eq-part:focus .eq-part-title{fill:#8af1df}
        #${id} .eq-part-title{fill:#bfd0dc;font-size:11px;font-weight:600}
      </style>
      <g id="${id}">
        <rect width="960" height="520" rx="16" fill="url(#${ref('bg')})"/>
        <rect width="960" height="520" rx="16" fill="url(#${ref('grid')})"/>
        <path d="M33 63H927M33 456H927" stroke="#31485b" stroke-opacity=".65"/>
        <circle cx="39" cy="32" r="4" fill="#66dfc4" data-node="state-dot"/>
        <text x="53" y="36" fill="#e0edf4" font-size="12" font-weight="600" data-node="stage-title">장비 상태 대기</text>
        <text x="33" y="53" fill="#718da4" font-size="9" letter-spacing="1.3">ION MILLING / EQUIPMENT OBSERVER</text>
        <rect x="694" y="21" width="233" height="25" rx="12.5" fill="#1d3445" stroke="#365365"/>
        <text x="810.5" y="37" fill="#a5becd" text-anchor="middle" font-size="10" data-node="provenance">원리 기반 절개 모형 · 치수 미보정</text>

        <ellipse cx="499" cy="442" rx="220" ry="13" fill="#020b12" opacity=".4"/>
        <path d="M366 385l-16 56h60l10-39M573 402l10 39h60l-18-62" fill="url(#${ref('dark-metal')})" stroke="#496476"/>
        <circle cx="496" cy="263" r="194" fill="url(#${ref('metal')})" stroke="#b5c9d4" stroke-width="1.2"/>
        <circle cx="496" cy="263" r="176" fill="#1b3243" stroke="#b1c2cb" stroke-width="2"/>
        <circle cx="496" cy="263" r="168" fill="url(#${ref('cavity')})" stroke="#49657a" stroke-width="2"/>
        <path d="M377 145a167 167 0 0 1 237 0" fill="none" stroke="#a0c8d7" stroke-width="2" opacity=".2"/>
        <path d="M374 377a167 167 0 0 0 243-1" fill="none" stroke="#080f18" stroke-width="4"/>
        ${bolts}

        <g class="eq-part" data-part="transfer" role="button" tabindex="0" aria-label="웨이퍼 이송 기구 설명 열기">
          <path class="eq-highlight" d="M51 250h285v141H51z"/>
          <rect x="71" y="278" width="241" height="97" rx="13" fill="url(#${ref('dark-metal')})" stroke="#6b8497"/>
          <path d="M79 289h224v63H79z" fill="#101e2c" stroke="#486278"/>
          <path d="M85 294h204v41H85z" fill="url(#${ref('glass')})"/>
          <path d="M82 364h216" stroke="#99acb9" opacity=".35"/>
          <rect x="294" y="290" width="48" height="65" rx="4" fill="url(#${ref('metal')})" stroke="#8398a6"/>
          <path d="M305 297h25v50h-25" fill="#0b1926"/>
          <rect x="306" y="298" width="21" height="48" rx="2" fill="#6a8798" data-node="gate"/>
          <path d="M315 283v-30h12v31" fill="#233b4d" stroke="#6b869b"/>
          <rect x="311" y="241" width="18" height="25" rx="3" fill="url(#${ref('dark-metal')})" stroke="#718da1"/>
          <g data-node="robot" opacity=".35">
            <ellipse cx="135" cy="341" rx="31" ry="10" fill="#060e17"/>
            <path d="M119 314h32v23h-32z" fill="url(#${ref('metal')})" stroke="#96abb7"/>
            <ellipse cx="135" cy="314" rx="16" ry="7" fill="#728c9d"/>
            <path data-node="arm-back" d="M135 312L191 326" fill="none" stroke="#283f51" stroke-width="13" stroke-linecap="round"/>
            <path data-node="arm" d="M135 309L191 323L231 316" fill="none" stroke="#97aebc" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
            <circle data-node="elbow" cx="191" cy="323" r="6" fill="#3d5e73" stroke="#b9d0db"/>
            <path data-node="fork" d="M219 314h25m-4-5h20m-20 10h20" fill="none" stroke="#9cb4c2" stroke-width="2" stroke-linecap="round"/>
          </g>
          <text x="73" y="396" class="eq-part-title">01 / 웨이퍼 이송</text>
          <text x="73" y="413" class="eq-label" data-node="transfer-status">TRANSFER · UNKNOWN</text>
        </g>

        <g class="eq-part" data-part="source" role="button" tabindex="0" aria-label="이온 소스 설명 열기">
          <rect class="eq-highlight" x="435" y="75" width="122" height="111" rx="8"/>
          <path d="M444 82h104v37H444z" fill="url(#${ref('dark-metal')})" stroke="#8ca4b3"/>
          <path d="M454 88h84v26h-84z" fill="#263e50" stroke="#708c9d"/>
          <path d="M461 95h70M461 103h70" stroke="#92a9b9" stroke-width="1" opacity=".4"/>
          <rect x="448" y="117" width="96" height="47" rx="4" fill="url(#${ref('metal')})" stroke="#9eb4c0"/>
          ${grille}
          <path d="M450 165h92l-8 17h-76z" fill="#8da4b0" stroke="#cad8df"/>
          <path d="M462 179h67" stroke="#92f3df" stroke-width="2" data-node="source-glow" opacity="0"/>
          <path d="M451 100H402l-22-13H276" fill="none" stroke="#587489"/>
          <circle cx="276" cy="87" r="2.5" fill="#7e9aab"/>
          <text x="151" y="84" class="eq-part-title">02 / 이온 소스</text>
          <text x="151" y="102" class="eq-value" data-node="beam-readout">— V · — mA</text>
        </g>

        <g data-node="beam" opacity="0" clip-path="url(#${ref('chamber-clip')})" pointer-events="none">
          <path d="M460 183h72l67 147H393z" fill="url(#${ref('beam')})"/>
          ${rays}
          <ellipse cx="496" cy="328" rx="80" ry="12" fill="#75efd9" opacity=".2" filter="url(#${ref('soft')})"/>
        </g>

        <g class="eq-part" data-part="shutter" role="button" tabindex="0" aria-label="빔 셔터 설명 열기">
          <rect class="eq-highlight" x="431" y="185" width="190" height="42" rx="8"/>
          <path d="M596 201h25v13h-25z" fill="#58788d" stroke="#a7bdc9"/>
          <path d="M612 205h42" stroke="#4b6c84" stroke-width="5"/>
          <g data-node="shutter">
            <path d="M445 204h103v8H445z" fill="url(#${ref('metal')})" stroke="#a2b6c2"/>
            <path d="M548 207h47" stroke="#97b0be" stroke-width="3"/>
          </g>
          <path d="M569 194l36-28h103" fill="none" stroke="#526e83"/>
          <text x="710" y="164" class="eq-part-title">03 / 빔 셔터</text>
          <text x="710" y="182" class="eq-label" data-node="shutter-status">UNKNOWN</text>
        </g>

        <g class="eq-part" data-part="stage" role="button" tabindex="0" aria-label="웨이퍼 스테이지 설명 열기">
          <path class="eq-highlight" d="M388 297h220v115H388z"/>
          <path d="M480 351h32v57h-32z" fill="url(#${ref('metal')})" stroke="#7693a4"/>
          <ellipse cx="496" cy="407" rx="39" ry="9" fill="url(#${ref('dark-metal')})" stroke="#7792a3"/>
          <path d="M462 406v10a34 8 0 0 0 68 0v-10" fill="#233d51" stroke="#638094"/>
          <g data-node="platen" transform="rotate(0 496 342)">
            <path d="M419 337v17a77 16 0 0 0 154 0v-17" fill="url(#${ref('dark-metal')})" stroke="#7897aa"/>
            <ellipse cx="496" cy="337" rx="77" ry="17" fill="url(#${ref('metal')})" stroke="#bfd2dd"/>
            <ellipse cx="496" cy="337" rx="70" ry="13" fill="#294656" stroke="#7795a6"/>
            <path d="M435 357q60 15 122 0" stroke="#67b7c4" fill="none" opacity=".7"/>
            ${stageMarks}
            <g data-node="stage-wafer" opacity="0">
              <ellipse cx="496" cy="331" rx="68" ry="12" fill="url(#${ref('wafer')})" stroke="#d0e4ea" stroke-width="1.2"/>
              <ellipse cx="496" cy="331" rx="66" ry="10.5" fill="url(#${ref('die')})"/>
              <path data-node="rotation" d="M558 332l5 0" stroke="#e6ffec" stroke-width="3"/>
            </g>
          </g>
          <path d="M493 414v13h-96" fill="none" stroke="#5f7c92"/>
          <text x="227" y="431" class="eq-part-title">04 / 회전 · 틸트 스테이지</text>
          <text x="227" y="447" class="eq-label" data-node="stage-readout">— RPM · —°</text>
        </g>

        <g data-node="transfer-wafer" opacity="0" pointer-events="none">
          <ellipse cx="242" cy="308" rx="47" ry="8" fill="url(#${ref('wafer')})" stroke="#c7e0e7" stroke-width="1.1"/>
          <ellipse cx="242" cy="308" rx="45" ry="6.7" fill="url(#${ref('die')})"/>
        </g>

        <g class="eq-part" data-part="vacuum" role="button" tabindex="0" aria-label="진공 배기 시스템 설명 열기">
          <rect class="eq-highlight" x="663" y="219" width="239" height="114" rx="12"/>
          <path d="M656 260H735V296H806" fill="none" stroke="#213849" stroke-width="22" stroke-linejoin="round"/>
          <path d="M656 260H735V296H806" fill="none" stroke="#829eae" stroke-width="17" stroke-linejoin="round"/>
          <path d="M656 257H738V293H806" fill="none" stroke="#c1d1d9" stroke-opacity=".4" stroke-width="5" stroke-linejoin="round"/>
          <path data-node="pump-flow" d="M670 260H735V296H805" fill="none" stroke="#88ecd8" stroke-width="2" stroke-dasharray="5 12" opacity="0"/>
          <path d="M697 248v24M705 248v24" stroke="#b7c8d0" stroke-width="3"/>
          <path d="M712 237v11M692 237h40" stroke="#7796a9" stroke-width="5"/>
          <rect x="803" y="270" width="67" height="53" rx="8" fill="url(#${ref('dark-metal')})" stroke="#96aebb"/>
          <circle cx="829" cy="296" r="19" fill="#1c3749" stroke="#9bb1bd"/>
          <g data-node="turbine" transform="rotate(0 829 296)"><path d="M829 280l5 12 12 4-12 4-5 12-5-12-12-4 12-4z" fill="#7e9eaf"/><circle cx="829" cy="296" r="5" fill="#c1d6df"/></g>
          <path d="M870 296h28" stroke="#5b7b90" stroke-width="10"/>
          <text x="715" y="225" class="eq-part-title">05 / 진공 배기</text>
          <text x="715" y="243" class="eq-value" data-node="pressure-readout">— Pa</text>
          <text x="806" y="344" class="eq-label" data-node="pump-status">UNKNOWN</text>
        </g>

        <g class="eq-part" data-part="cooling" role="button" tabindex="0" aria-label="웨이퍼 냉각과 헬륨 공급 설명 열기">
          <path class="eq-highlight" d="M526 366h359v72H526z"/>
          <path d="M527 368v32h185v9h91" fill="none" stroke="#30596c" stroke-width="8" stroke-linejoin="round"/>
          <path d="M527 368v32h185v9h91" fill="none" stroke="#71aaba" stroke-width="3" stroke-linejoin="round"/>
          <path d="M555 389v22M562 389v22" stroke="#9ab9c7" stroke-width="2"/>
          <rect x="804" y="386" width="42" height="43" rx="7" fill="url(#${ref('dark-metal')})" stroke="#7b9bad"/>
          <text x="825" y="411" fill="#bbdce9" text-anchor="middle" font-size="14" font-weight="600">He</text>
          <text x="688" y="378" class="eq-part-title">06 / 후면 냉각</text>
          <text x="687" y="436" class="eq-value" data-node="cooling-readout">— Pa</text>
        </g>

        <g data-node="unknown-banner">
          <rect x="371" y="236" width="250" height="35" rx="7" fill="#162a39" stroke="#987b40" stroke-opacity=".7"/>
          <circle cx="389" cy="253.5" r="3" fill="#d7b26a"/>
          <text x="401" y="257" fill="#e0c58d" font-size="10" data-node="unknown-text">동작 신호 미확인 · 동작 재현 제한</text>
        </g>
        <text x="34" y="480" fill="#8da8bb" font-size="10" data-node="digital-summary">BEAM — / SHUTTER — / GATE — / WAFER —</text>
        <text x="926" y="480" text-anchor="end" fill="#a7c0cf" font-size="10" data-node="time-readout">t = 0.0 s</text>
        <text x="34" y="501" fill="#627f96" font-size="9.5">부품을 클릭하거나 Tab → Enter로 작용 원리를 확인하세요.</text>
        <text x="926" y="501" text-anchor="end" fill="#69859a" font-size="9.5" data-node="motion-note">동작 신호를 기다리는 중</text>
      </g>
    </svg>`;
    container.appendChild(host);
    const nodes = {};
    host.querySelectorAll('[data-node]').forEach(node => {nodes[node.getAttribute('data-node')] = node;});
    const rayNodes = Array.from(host.querySelectorAll('[data-ray]'));
    let disposed = false;
    function activate(event) {
      const part = event.target.closest && event.target.closest('[data-part]');
      if (part && host.contains(part)) onSelect(part.getAttribute('data-part'));
    }
    function keyboard(event) {
      if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); activate(event);}
    }
    host.addEventListener('click', activate);
    host.addEventListener('keydown', keyboard);
    const set = (key, attr, val) => nodes[key].setAttribute(attr, String(val));
    const write = (key, val) => {nodes[key].textContent = val;};
    const finite = value => typeof value === 'number' && Number.isFinite(value);
    const fmt = (value, decimals = 1) => !finite(value) ? '—' : Math.abs(value) >= 100000 || (value !== 0 && Math.abs(value) < .01) ? value.toExponential(2) : value.toLocaleString('en-US', {maximumFractionDigits:decimals,minimumFractionDigits:0});
    const known = (d, key) => typeof d[key] === 'boolean';
    const stateText = (d, key, yes = 'ON', no = 'OFF') => known(d, key) ? d[key] ? yes : no : 'UNKNOWN';
    function render(sample = {}, {time = sample.t, playing = false, imported = false, rotationDeg} = {}) {
      if (disposed) return;
      const v = sample.values || {}, d = sample.digital || {}, t = finite(time) ? time : 0;
      const stage = Object.prototype.hasOwnProperty.call(STAGES, sample.stage) ? sample.stage : 'unknown';
      const robotKnown = finite(d.robot) && d.robot >= 0 && d.robot <= 1;
      const missing = ['beam', 'shutter', 'pump', 'gate', 'wafer'].filter(key => !known(d, key));
      if (!robotKnown) missing.push('robot');
      const beam = d.beam === true && d.shutter === true;
      const transfer = robotKnown && (stage === 'load' || stage === 'unload');
      const extension = robotKnown ? d.robot : 0;
      const tilt = finite(v.tiltDeg) ? Math.max(-75, Math.min(75, v.tiltDeg)) : 0;
      const angle = finite(rotationDeg) ? rotationDeg : finite(v.rotationRpm) ? t * v.rotationRpm * 6 : 0;
      const radians = angle * Math.PI / 180;
      const end = {x:242 + 254*extension, y:308 + 23*extension};
      const elbow = {x:191 + 140*extension,y:323-42*Math.sin(extension*Math.PI*.7)};
      write('stage-title', STAGES[stage] + (playing ? ' · 재생 중' : ' · 일시 정지'));
      set('state-dot', 'fill', stage === 'aborted' ? '#f2a37d' : playing ? '#66dfc4' : '#698da4');
      write('provenance', '원리 기반 절개 모형 · 치수 미보정');
      write('beam-readout', fmt(v.beamVoltageV, 0) + ' V · ' + fmt(v.beamCurrentMa) + ' mA');
      write('pressure-readout', fmt(v.pressurePa, 3) + ' Pa');
      write('cooling-readout', fmt(v.heliumPressurePa, 2) + ' Pa · 냉각 온도 미모델링');
      write('stage-readout', fmt(v.rotationRpm) + ' RPM · ' + fmt(v.tiltDeg) + '°');
      write('time-readout', 't = ' + fmt(t, 2) + ' s');
      write('shutter-status', stateText(d, 'shutter', 'OPEN / 경로 열림', 'CLOSED / 경로 닫힘'));
      write('pump-status', stateText(d, 'pump', 'PUMP ON', 'PUMP OFF'));
      write('transfer-status', robotKnown ? 'TRANSFER · ' + Math.round(extension*100) + '% / GATE ' + stateText(d, 'gate', 'OPEN', 'CLOSED') : 'TRANSFER · UNKNOWN');
      write('digital-summary', 'BEAM ' + stateText(d, 'beam') + ' / SHUTTER ' + stateText(d, 'shutter', 'OPEN', 'CLOSED') + ' / GATE ' + stateText(d, 'gate', 'OPEN', 'CLOSED') + ' / WAFER ' + stateText(d, 'wafer', 'PRESENT', 'ABSENT'));
      set('unknown-banner', 'opacity', missing.length ? 1 : 0);
      write('unknown-text', missing.length ? '미확인 신호 ' + missing.length + '개 · 해당 동작 재현 제한' : '');
      write('motion-note', imported ? '로그 관측값 표시 · 누락 신호는 추정하지 않음' : '예시 동작 · 실제 장비의 구동 이력 아님');
      set('source-glow', 'opacity', d.beam === true ? 1 : 0);
      set('beam', 'opacity', beam ? 1 : 0);
      rayNodes.forEach((node, index) => node.setAttribute('stroke-dashoffset', String(-(t*32 + index*3)%17)));
      set('shutter', 'transform', d.shutter === true ? 'translate(116 0)' : 'translate(0 0)');
      set('shutter', 'opacity', known(d, 'shutter') ? 1 : .3);
      set('gate', 'transform', d.gate === true ? 'translate(0 -53)' : 'translate(0 0)');
      set('gate', 'opacity', known(d, 'gate') ? 1 : .3);
      set('robot', 'opacity', robotKnown ? 1 : .22);
      set('arm-back', 'd', 'M135 312L' + elbow.x + ' ' + (elbow.y+3));
      set('arm', 'd', 'M135 309L' + elbow.x + ' ' + elbow.y + 'L' + (end.x-11) + ' ' + (end.y+8));
      set('elbow', 'cx', elbow.x); set('elbow', 'cy', elbow.y);
      set('fork', 'd', 'M' + (end.x-23) + ' ' + (end.y+6) + 'h25m-4-5h20m-20 10h20');
      set('platen', 'transform', 'rotate(' + (-tilt) + ' 496 342)');
      // wafer is stage occupancy, not overall wafer presence. Deposit/pickup happens at the arm's midpoint.
      set('stage-wafer', 'opacity', d.wafer === true && stage !== 'unknown' ? 1 : 0);
      set('transfer-wafer', 'opacity', transfer && d.wafer === false && (stage === 'load' || extension > 0.00001) ? 1 : 0);
      const scaleX = 1 + (68/47 - 1) * extension, scaleY = 1 + .5 * extension;
      set('transfer-wafer', 'transform', 'translate(' + end.x + ' ' + end.y + ') scale(' + scaleX + ' ' + scaleY + ') translate(-242 -308)');
      set('rotation', 'd', 'M' + (496+60*Math.cos(radians)).toFixed(2) + ' ' + (331+9*Math.sin(radians)).toFixed(2) + 'l' + (5*Math.cos(radians)).toFixed(2) + ' ' + (1.2*Math.sin(radians)).toFixed(2));
      set('rotation', 'opacity', finite(v.rotationRpm) ? 1 : 0);
      set('pump-flow', 'opacity', d.pump === true ? .9 : 0);
      set('pump-flow', 'stroke-dashoffset', -(t*22)%17);
      set('turbine', 'transform', 'rotate(' + (d.pump === true ? (t*110)%360 : 0) + ' 829 296)');
      set('turbine', 'opacity', known(d, 'pump') ? 1 : .3);
      host.setAttribute('data-signal-coverage', missing.length ? 'partial' : 'complete');
      host.setAttribute('data-stage', stage);
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      host.removeEventListener('click', activate);
      host.removeEventListener('keydown', keyboard);
      host.remove();
    }
    render();
    return Object.freeze({render, dispose});
  }
  root.EquipmentView = Object.freeze({create, PARTS});
})(typeof window !== 'undefined' ? window : globalThis);
