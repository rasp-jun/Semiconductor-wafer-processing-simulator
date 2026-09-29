/* STRATUM navigation; no simulation state or stored data is accessed here. */
(() => {
  'use strict';
  const spaces = [
    ['01', 'cmos-lab.html', '공정 스튜디오', 'CMOS · 장비 · 웨이퍼'],
    ['02', 'index.html', '메모리 팹', 'DRAM · NAND · HBM'],
    ['03', 'equipment.html', '장비 운전', '운전 조건 · 응답 분석'],
    ['04', 'photo-lab.html', '포토 실험', '패터닝 · 실험 기록'],
    ['05', 'fab-data.html', '데이터 연동', '로그 · 태그 매핑'],
    ['06', 'fab-pilot.html', '파일럿 검토', '운전 비교 · 후속 조치'],
    ['07', 'evidence.html', '모델 검증', '보정 · 검증 · 오차'],
    ['08', 'public-study.html', '공개 데이터', '실측 근거 · 재현'],
    ['09', 'workbench.html', '검토 기록', '레시피 · 버전 · 팀']
  ];
  const page = (location.pathname.split('/').pop() || 'index.html').replace('memory-fab.html', 'index.html');
  if (document.body.dataset.stratumEdition === 'public' || document.body.classList.contains('stratum-public')) {
    spaces[8][2] = '공개 버전 안내';
    spaces[8][3] = '작업 공간 · 기록 보관';
  }
  const current = spaces.find(space => space[1] === page);
  document.querySelectorAll('[data-stratum-switcher]').forEach((slot, index) => {
    const details = document.createElement('details');
    details.className = 'stratum-switcher';
    const summary = document.createElement('summary');
    summary.innerHTML = '<span class="stratum-switch-icon" aria-hidden="true">⌘</span><span></span><span class="stratum-switch-arrow" aria-hidden="true">⌄</span>';
    summary.children[1].textContent = current ? current[2] : '작업 공간';
    summary.setAttribute('aria-label', `작업 공간 선택${current ? ': ' + current[2] : ''}`);
    summary.setAttribute('aria-controls', `stratum-spaces-${index}`);
    const panel = document.createElement('div');
    panel.className = 'stratum-space-panel';
    panel.id = `stratum-spaces-${index}`;
    const heading = document.createElement('p');
    heading.className = 'stratum-space-heading';
    heading.textContent = 'STRATUM / WORKSPACES';
    const nav = document.createElement('nav');
    nav.setAttribute('aria-label', 'STRATUM 작업 공간');
    spaces.forEach(([number, href, label, description]) => {
      const link = document.createElement('a');
      link.href = href;
      if (href === page) link.setAttribute('aria-current', 'page');
      const code = document.createElement('span'); code.className = 'stratum-space-code'; code.textContent = number;
      const text = document.createElement('span');
      const title = document.createElement('b'); title.textContent = label;
      const note = document.createElement('small'); note.textContent = description;
      text.append(title, note);
      const arrow = document.createElement('span'); arrow.className = 'stratum-space-arrow';
      arrow.setAttribute('aria-hidden', 'true'); arrow.textContent = href === page ? '●' : '↗';
      link.append(code, text, arrow); nav.append(link);
    });
    panel.append(heading, nav); details.append(summary, panel); slot.replaceChildren(details);
    const positionPanel = () => {
      if (!details.open) return;
      const rect = summary.getBoundingClientRect();
      const below = innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const openAbove = below < 230 && above > below;
      const available = Math.min(670, Math.max(80, openAbove ? above : below));
      const top = openAbove ? rect.top - Math.min(panel.scrollHeight, available) - 8 : rect.bottom + 8;
      panel.style.setProperty('--stratum-menu-left', `${Math.max(12, Math.min(rect.left, innerWidth - 354))}px`);
      panel.style.setProperty('--stratum-menu-top', `${top}px`);
      panel.style.setProperty('--stratum-menu-height', `${available}px`);
    };
    details.addEventListener('toggle', () => {
      summary.setAttribute('aria-expanded', String(details.open));
      positionPanel();
      if (details.open) document.querySelectorAll('.stratum-switcher').forEach(other => {
        if (other !== details) other.open = false;
      });
    });
    summary.setAttribute('aria-expanded', 'false');
    window.addEventListener('resize', positionPanel, {passive:true});
    window.addEventListener('scroll', positionPanel, {passive:true});
    details.addEventListener('keydown', event => {
      if (event.key === 'Escape' && details.open) {
        event.stopPropagation(); details.open = false; summary.focus();
      }
    });
  });
  document.addEventListener('pointerdown', event => {
    document.querySelectorAll('.stratum-switcher[open]').forEach(details => {
      if (!details.contains(event.target)) details.open = false;
    });
  });
})();
