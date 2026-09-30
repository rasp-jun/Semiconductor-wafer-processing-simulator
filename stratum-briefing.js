/* Product brief only. Does not load or change any simulation or browser records. */
(() => {
  'use strict';
  const choices = {
    window: {
      image: 'assets/cmos/equipment-oxidation.jpg',
      alt: '수직 열처리 타워와 전면 웨이퍼 반입부를 갖춘 산화 장비의 자체 제작 모형',
      code: 'THERMAL / OXIDATION', name: '수직 산화 장비',
      href: 'cmos-lab.html#window-oxidation', action: '산화 공정 조건 맵 열기',
      context: '온도와 시간을 함께 바꾸며 모델의 산화막 변화를 비교합니다.'
    },
    observe: {
      image: 'assets/cmos/icp-chamber.jpg',
      alt: '방사형 공정 챔버와 전면 웨이퍼 반송부로 구성한 식각 장비의 자체 제작 모형',
      code: 'PLASMA / ICP ETCH', name: '플라즈마 식각 장비',
      href: 'cmos-lab.html', action: '장비 관찰 · 실험 비교 열기',
      context: '전체 장비의 반송부터 내부 기구와 웨이퍼 단면까지 관찰합니다.'
    },
    data: {
      image: 'assets/cmos/equipment-metrology.jpg',
      alt: '정밀 스테이지와 C자형 광학 프레임으로 구성한 계측 장비의 자체 제작 모형',
      code: 'OPTICAL / METROLOGY', name: '광학 계측 장비',
      href: 'fab-data.html', action: '운전 데이터 검토 열기',
      context: '입력 로그의 태그·단위·처리 구간을 확인하고 모델 계산과 구분합니다.'
    }
  };
  const image = document.getElementById('briefInstrumentImage');
  const action = document.getElementById('briefHeroAction');
  const status = document.getElementById('briefChoiceStatus');
  const buttons = [...document.querySelectorAll('[data-brief-choice]')];
  if (!image || !action || !status || !buttons.length) return;
  let active = 'window', request = 0;
  buttons.forEach(button => button.addEventListener('click', async () => {
    const key = button.dataset.briefChoice, next = choices[key];
    if (!next) return;
    const currentRequest = ++request;
    if (key === active) {
      status.textContent = next.action + '. 위의 시작 링크에서 해당 작업 공간으로 이동할 수 있습니다.';
      return;
    }
    status.textContent = '선택한 과제의 장비 모형을 불러옵니다.';
    try {
      const pending = new Image();
      pending.src = next.image;
      await pending.decode();
      if (currentRequest !== request) return;
      image.src = next.image;
      image.alt = next.alt;
      document.getElementById('briefInstrumentCode').textContent = next.code;
      document.getElementById('briefInstrumentName').textContent = next.name;
      document.getElementById('briefHeroContext').textContent = next.context;
      action.href = next.href;
      action.querySelector('span').textContent = next.action;
      buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
      active = key;
      status.textContent = next.action + '. 위의 시작 링크에서 해당 작업 공간으로 이동할 수 있습니다.';
    } catch {
      if (currentRequest === request) status.textContent = '장비 이미지를 불러오지 못했습니다. 아래 실험 흐름의 링크로 작업 공간을 열 수 있습니다.';
    }
  }));
  document.body.classList.add('has-brief-choices');
})();
