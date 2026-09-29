/* STRATUM app shell: the one navigation rail shared by every workspace.
 * Renders into the page at load; no simulation state or stored data is accessed
 * here beyond the rail's own collapsed preference. Layout space for the rail is
 * reserved by stratum-ui.css, so rendering it causes no layout shift. */
(() => {
  'use strict';
  const icon = {
    cmos: 'M12 3 21 8v8l-9 5-9-5V8Zm0 10 9-5M12 13 3 8m9 5v8',
    memory: 'M5 7h14v10H5zM8 7V4m4 3V4m4 3V4M8 20v-3m4 3v-3m4 3v-3M9 10h6v4H9z',
    equipment: 'M4 20h16M6 20V9l6-5 6 5v11M10 20v-5h4v5M9 11h6',
    photo: 'M12 3v4m0 10v4M3 12h4m10 0h4M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z',
    data: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3Zm0 0v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
    pilot: 'M4 19V5m0 14h16M8 15l3-4 3 2 5-6',
    evidence: 'M9 12l2 2 4-4M12 3l7 3v6c0 4.4-3 7.8-7 9-4-1.2-7-4.6-7-9V6Z',
    public: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-9-9h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z',
    review: 'M8 4h8l4 4v12H4V4h4m0 0v4h8M8 13h8m-8 4h5',
    collapse: 'M15 6l-6 6 6 6',
    menu: 'M4 7h16M4 12h16M4 17h16',
    close: 'M6 6l12 12M18 6 6 18'
  };
  const groups = [
    ['시뮬레이션', [
      ['cmos-lab.html', '공정 스튜디오', 'CMOS · 117 공정', 'cmos'],
      ['index.html', '메모리 팹', 'DRAM · NAND · HBM', 'memory'],
      ['equipment.html', '장비 운전', '운전 조건 · 응답', 'equipment'],
      ['photo-lab.html', '포토 실험', '패터닝 · 미션', 'photo']
    ]],
    ['데이터 · 검증', [
      ['fab-data.html', '데이터 연동', '로그 · 태그 매핑', 'data'],
      ['fab-pilot.html', '파일럿 검토', '운전 비교 · 조치', 'pilot'],
      ['evidence.html', '모델 검증', '보정 · 검증 오차', 'evidence'],
      ['public-study.html', '공개 데이터', '실측 근거 · 재현', 'public']
    ]],
    ['기록', [
      ['workbench.html', '검토 기록', '레시피 · 버전 · 팀', 'review']
    ]]
  ];
  const body = document.body;
  const isPublic = body.dataset.stratumEdition === 'public' || body.classList.contains('stratum-public');
  if (isPublic) groups[2][1][0] = ['workbench.html', '공개 버전 안내', '작업 공간 · 기록 보관', 'review'];
  const page = (location.pathname.split('/').pop() || 'index.html').replace('memory-fab.html', 'index.html');
  const current = groups.flatMap(group => group[1]).find(item => item[0] === page);
  // The rail preference lives in a cookie, not localStorage: workspaces coordinate their own
  // records through localStorage across tabs, and the shell stays out of that storage area.
  const cookieName = 'stratum-rail';
  const read = () => {
    const match = document.cookie.match(/(?:^|;\s*)stratum-rail=([01])/);
    if (match) return match[1] === '1';
    // Studio pages start with the compact rail to give the viewport room; an explicit choice wins.
    return body.dataset.railDefault === 'collapsed' && innerWidth < 1680;
  };
  const write = value => {
    document.cookie = `${cookieName}=${value ? 1 : 0}; path=/; max-age=31536000; SameSite=Lax`;
  };

  const svg = (path, className = 'st-icon') => {
    const ns = 'http://www.w3.org/2000/svg';
    const el = document.createElementNS(ns, 'svg');
    el.setAttribute('viewBox', '0 0 24 24');
    el.setAttribute('aria-hidden', 'true');
    el.setAttribute('class', className);
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    el.append(p);
    return el;
  };
  const make = (tag, className, text) => {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  };
  const brandMark = () => {
    const brand = make('a', 'st-brand');
    brand.href = 'cmos-lab.html';
    brand.setAttribute('aria-label', 'STRATUM 공정 스튜디오');
    brand.innerHTML = '<svg class="st-brand-mark" viewBox="0 0 40 44" aria-hidden="true"><path d="m2 12 18-9 18 9-18 9z" fill="currentColor"/><path d="m2 24 18 9 18-9v7l-18 9-18-9z" fill="var(--a-500)"/><path d="m2 17 18 9 18-9v4l-18 9-18-9z" fill="var(--s-400)"/></svg><span class="st-brand-word">STRATUM</span>';
    return brand;
  };

  // Rail
  const rail = make('nav', 'st-rail');
  rail.id = 'stratumRail';
  rail.setAttribute('aria-label', 'STRATUM 작업 공간');
  const head = make('div', 'st-rail-head');
  const closeButton = make('button', 'st-rail-close');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', '메뉴 닫기');
  closeButton.append(svg(icon.close));
  head.append(brandMark(), closeButton);
  rail.append(head);
  const scroller = make('div', 'st-rail-groups');
  groups.forEach(([title, items]) => {
    const group = make('div', 'st-rail-group');
    const label = make('p', 'st-rail-label', title);
    const list = make('ul');
    items.forEach(([href, name, note, key]) => {
      const li = make('li');
      const link = make('a', 'st-rail-link');
      link.href = href;
      link.dataset.tip = name;
      if (href === page) link.setAttribute('aria-current', 'page');
      const text = make('span', 'st-rail-text');
      text.append(make('b', null, name), make('small', null, note));
      link.append(svg(icon[key]), text);
      li.append(link);
      list.append(li);
    });
    group.append(label, list);
    scroller.append(group);
  });
  rail.append(scroller);
  const foot = make('div', 'st-rail-foot');
  const scope = make('p', 'st-rail-scope', isPublic ? '공개 교육 버전 · 합성 모델' : '교육 · 검토용 합성 모델');
  const collapse = make('button', 'st-rail-collapse');
  collapse.type = 'button';
  collapse.append(svg(icon.collapse), make('span', null, '메뉴 접기'));
  foot.append(scope, collapse);
  rail.append(foot);

  // Mobile bar + scrim
  const mobile = make('div', 'st-mobilebar');
  const menuButton = make('button', 'st-menu-button');
  menuButton.type = 'button';
  menuButton.setAttribute('aria-controls', rail.id);
  menuButton.setAttribute('aria-expanded', 'false');
  menuButton.setAttribute('aria-label', '작업 공간 메뉴 열기');
  menuButton.append(svg(icon.menu));
  mobile.append(menuButton, brandMark(), make('span', 'st-mobile-title', current ? current[1] : ''));
  const scrim = make('div', 'st-scrim');

  const skip = body.querySelector(':scope > .skip-link, :scope > .skip');
  (skip ? skip.after.bind(skip) : body.prepend.bind(body))(mobile, rail, scrim);
  body.classList.add('st-shell');
  document.querySelectorAll('[data-stratum-switcher]').forEach(slot => slot.remove());

  // Collapse (desktop)
  const setCollapsed = value => {
    document.documentElement.classList.toggle('st-rail-collapsed', value);
    collapse.setAttribute('aria-expanded', String(!value));
    collapse.setAttribute('aria-label', value ? '메뉴 펼치기' : '메뉴 접기');
    collapse.lastChild.textContent = value ? '메뉴 펼치기' : '메뉴 접기';
  };
  setCollapsed(read());
  collapse.addEventListener('click', () => {
    const next = !document.documentElement.classList.contains('st-rail-collapsed');
    setCollapsed(next);
    write(next);
    window.dispatchEvent(new Event('resize'));
  });

  // Drawer (mobile)
  const setOpen = open => {
    body.classList.toggle('st-rail-open', open);
    menuButton.setAttribute('aria-expanded', String(open));
    if (open) (rail.querySelector('[aria-current="page"]') || rail.querySelector('a')).focus();
    else menuButton.focus();
  };
  menuButton.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  scrim.addEventListener('click', () => setOpen(false));
  // Page "more" menus (<details class="st-more">): one open at a time, close on outside
  // click, on Escape, and after an item runs.
  const menus = () => document.querySelectorAll('details.st-more[open]');
  document.addEventListener('pointerdown', event => {
    menus().forEach(menu => { if (!menu.contains(event.target)) menu.open = false; });
  });
  document.addEventListener('click', event => {
    const item = event.target.closest('.st-more-panel :is(button, a)');
    if (item) item.closest('details').open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = [...menus()];
    if (open.length) {
      event.stopPropagation();
      open.forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
    }
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && body.classList.contains('st-rail-open')) {
      event.stopPropagation();
      setOpen(false);
    }
  }, true);
})();
