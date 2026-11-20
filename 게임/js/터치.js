/* ============================================================
 *  터치 → 마우스 [리마스터 · 모바일판] (2026-11-19)
 *
 *  사장님 11-19 「모바일판도 알아서 만들고 테스트해서 잘 작동하는거 확인해줘.」
 *  원작은 마우스 게임이다 — 게임 코드는 mousedown·mouseup·mousemove·click 을 듣는다(우클릭 = 취소).
 *  주소에 «모바일=1» 이 있을 때만 켠다(모바일판 nodejs/main.js 가 붙인다) — 데스크톱·브라우저는 그대로.
 *
 *    짧게 누름        → 왼쪽 클릭 (그 자리로 커서를 옮긴 뒤 누름·뗌·클릭)
 *    길게 누름(0.45초) → 오른쪽 클릭 (원작 우클릭 = 취소 · 상태창)
 *    누른 채 끌기     → 왼쪽 누른 채 마우스 움직임
 *    두 손가락 톡     → 오른쪽 클릭 · 벌리기·오므리기 → 배율 · 위아래 끌기 → 기울기 (맥 터치패드와 같게 · 정본 328)
 *    화면 옆 빈 띠의 «ESC» 단추 → ESC
 *  손을 떼면 커서를 화면 가운데로 — 가장자리를 누르고 떼어도 맵이 계속 굴러가지 않게(원작 가장자리 스크롤)
 * ============================================================ */
(function (root) {
  'use strict';
  var 물음 = location.search || ''; try { 물음 = decodeURIComponent(물음); } catch (e) { }
  if (!/[?&]모바일=1/.test(물음)) return;

  var 길게 = 450, 한도 = 14;
  var 지금 = null;           /* { x, y, 움직임, 오른쪽, 타이머 } */
  /* [리마스터] 두 손가락 — 맥 터치패드와 같게 (정본 328 · 사장님 11-20 「모바일 기반은 터치를 통한 확대 축소나 이런거 적용해야하지 않아? 맥 터치패드처럼?」 → 고르심 «맥 터치패드와 같게»)
   *   벌리기·오므리기 = 배율(G2공유시점 zoom 10~120 · 30 = 원작 · 패드 우스틱 좌우와 같은 값) · 위아래 끌기 = 3D 기울기(tilt 0~80 · 위로 끌면 커짐 — 우클릭 끌기와 같은 0.25°/px)
   *   안 움직이고 짧게(0.35초 안) 떼면 = 우클릭(맥 터치패드 두 손가락 톡) · ESC 는 화면 ESC 단추 · 18px 넘게 움직여야 배율/기울기 — 그 전엔 톡 후보 */
  var 두손 = null;           /* { d0, y0, 가운데, 시작, 모드: null|'배율'|'기울기'|'끝', z0, t0 } */
  function 손거리(L) { return L.length < 2 ? 0 : Math.hypot(L[0].clientX - L[1].clientX, L[0].clientY - L[1].clientY); }
  function 손가운데(L) { return L.length < 2 ? { x: 0, y: 0 } : { x: (L[0].clientX + L[1].clientX) / 2, y: (L[0].clientY + L[1].clientY) / 2 }; }
  function 시점쓰기(k, v) {
    if (!root.G2공유시점) return;
    if (v !== (+root.G2공유시점.읽기(k) || 0)) { root.G2공유시점.쓰기(k, v); if (typeof root.G2시점다시적용 === 'function') try { root.G2시점다시적용(); } catch (e) { } }
  }

  function 쏘기(종류, x, y, 단추) {
    var el = document.elementFromPoint(x, y) || document.body;
    var 눌림 = (종류 === 'mouseup' || 종류 === 'click' || 종류 === 'mousemove' && !(지금 && 지금.움직임)) ? 0 : (단추 === 2 ? 2 : 1);
    el.dispatchEvent(new MouseEvent(종류, { bubbles: true, cancelable: true, view: root, clientX: x, clientY: y, screenX: x, screenY: y, button: 단추 || 0, buttons: 눌림 }));
  }
  function 키(이름) {
    ['keydown', 'keyup'].forEach(function (t) {
      var ev = new KeyboardEvent(t, { key: 이름, code: 이름, keyCode: 이름 === 'Escape' ? 27 : 0, which: 이름 === 'Escape' ? 27 : 0, bubbles: true, cancelable: true });
      (document.activeElement || document.body).dispatchEvent(ev);
    });
  }
  function 가운데로() { 쏘기('mousemove', innerWidth / 2, innerHeight / 2, 0); }

  var 판위 = function (el) { return !!(el && el.closest && el.closest('.g2판')); };   /* ESC 단추·가상 패드 — 클릭으로 바꾸지 않는다 */
  /* 정본 342 — 글칸(버그 신고 설명 등)은 손대지 않는다: 눌러 글쇠판·길게 눌러 복사·붙여넣기 (사장님 11-20 신고 「버그리포트에 복사 붙여넣기 가능했으면 합니다」) */
  var 글칸위 = function (el) { return !!(el && el.closest && el.closest('textarea,input,[contenteditable="true"]')); };
  document.addEventListener('touchstart', function (e) {
    if (판위(e.target) || 글칸위(e.target)) return;                   /* 우리 단추는 그대로 누른다 · 글칸은 그대로 */
    e.preventDefault();
    var 게임손 = [].filter.call(e.touches, function (t) { return !판위(t.target); }).length;   /* 가상 패드를 누른 손가락은 두 손가락 셈에서 뺀다 */
    if (게임손 >= 2) {                                              /* 두 손가락 — 맥 터치패드처럼 (정본 328) · 첫 손가락의 누름은 버린다 */
      if (지금) { clearTimeout(지금.타이머); 지금.버림 = true; }
      var 손둘 = [].filter.call(e.touches, function (t) { return !판위(t.target); }).slice(0, 2);
      두손 = { d0: 손거리(손둘), y0: 손가운데(손둘).y, 가운데: 손가운데(손둘), 시작: Date.now(), 모드: null,
               z0: root.G2공유시점 ? (+root.G2공유시점.읽기('zoom') || 30) : 30, t0: root.G2공유시점 ? (+root.G2공유시점.읽기('tilt') || 0) : 0 };
      return;
    }
    root.__터치때 = Date.now();   /* 정본 361 — 게임 화면을 손가락으로 누른 때 · MORE 처럼 «누르는 동안만» 단추를 손가락일 땐 켜고 끄게 (screens.js 터치누름) */
    root.__패드커서숨김 = true;   /* 손가락에는 커서 그림이 없다 — 패드와 같은 숨김(진짜 마우스를 움직이면 pad_input 이 다시 켠다) */
    var t = e.changedTouches[0];
    지금 = { x: t.clientX, y: t.clientY, 움직임: false, 오른쪽: false, 버림: false, 시작: Date.now() };
    쏘기('mousemove', t.clientX, t.clientY, 0);
    지금.타이머 = setTimeout(function () {
      if (!지금 || 지금.움직임 || 지금.버림) return;
      지금.오른쪽 = true;
      쏘기('mousedown', 지금.x, 지금.y, 2); 쏘기('mouseup', 지금.x, 지금.y, 2); 쏘기('contextmenu', 지금.x, 지금.y, 2);
      try { if (navigator.vibrate) navigator.vibrate(20); } catch (e진) { }
    }, 길게);
  }, { passive: false });

  document.addEventListener('touchmove', function (e) {
    if (!두손 && 글칸위(e.target)) return;                          /* 정본 342 — 글칸 안 고르기 끌기 */
    if (두손) {                                                     /* 두 손가락 — 배율·기울기 (정본 328) */
      e.preventDefault();
      var L = [].filter.call(e.touches, function (t) { return !판위(t.target); }).slice(0, 2);
      if (L.length < 2 || 두손.모드 === '끝') return;
      var d = 손거리(L), my = 손가운데(L).y;
      if (!두손.모드) { if (Math.abs(d - 두손.d0) > 18) 두손.모드 = '배율'; else if (Math.abs(my - 두손.y0) > 18) 두손.모드 = '기울기'; else return; }
      if (두손.모드 === '배율' && 두손.d0 > 0) 시점쓰기('zoom', Math.max(10, Math.min(120, Math.round(두손.z0 * d / 두손.d0))));
      if (두손.모드 === '기울기') 시점쓰기('tilt', Math.max(0, Math.min(80, Math.round(두손.t0 - (my - 두손.y0) * 0.25))));
      return;
    }
    if (!지금 || 지금.버림) return;
    e.preventDefault();
    var t = e.changedTouches[0];
    if (!지금.움직임 && Math.hypot(t.clientX - 지금.x, t.clientY - 지금.y) > 한도 && !지금.오른쪽) {
      지금.움직임 = true; clearTimeout(지금.타이머);
      쏘기('mousedown', 지금.x, 지금.y, 0);
    }
    지금.x = t.clientX; 지금.y = t.clientY;
    쏘기('mousemove', t.clientX, t.clientY, 0);
  }, { passive: false });

  function 끝(e) {
    if (!두손 && 글칸위(e.target)) return;                          /* 정본 342 — 글칸 톡·길게 누르기 메뉴 */
    if (두손) {                                                     /* 두 손가락을 떼는 중 — 첫 손가락이 떨어질 때 톡이면 우클릭 · 다 떨어지면 정리 (정본 328) */
      e.preventDefault();
      if (!두손.모드 && Date.now() - 두손.시작 < 350) {
        var c = 두손.가운데; 두손.모드 = '끝';
        쏘기('mousemove', c.x, c.y, 0); 쏘기('mousedown', c.x, c.y, 2); 쏘기('mouseup', c.x, c.y, 2); 쏘기('contextmenu', c.x, c.y, 2);
      } else 두손.모드 = '끝';
      if (![].some.call(e.touches || [], function (t) { return !판위(t.target); })) { 두손 = null; 지금 = null; setTimeout(가운데로, 250); }
      return;
    }
    if (!지금) return;
    e.preventDefault();
    clearTimeout(지금.타이머);
    var s = 지금; 지금 = null;
    if (s.버림 || s.오른쪽) { setTimeout(가운데로, 250); return; }
    /* 게임은 «올려 둔 자리»(월드 지점 누를것 등)를 한 장 그릴 때 잰다 — 짧은 터치는 그 전에 눌러 버린다(11-19 에뮬레이터 실측: 월드 지점이 안 눌림)
     *   올린 뒤 160ms 는 지나서 누르고, 누름·뗌도 60ms 떼어 다른 장에 들어가게 */
    var 기다림 = Math.max(0, 160 - (Date.now() - s.시작));
    setTimeout(function () {
      if (!s.움직임) 쏘기('mousedown', s.x, s.y, 0);
      setTimeout(function () { 쏘기('mouseup', s.x, s.y, 0); 쏘기('click', s.x, s.y, 0); setTimeout(가운데로, 250); }, 60);
    }, 기다림);
  }
  document.addEventListener('touchend', 끝, { passive: false });
  document.addEventListener('touchcancel', 끝, { passive: false });

  /* 확대·당겨서 새로고침·글자 고르기를 막는다 */
  var 꼴 = document.createElement('style');
  꼴.textContent = 'html,body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}' +
    'textarea,input{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default;touch-action:auto}' +   /* 정본 342 — 글칸은 고르기·복사·붙여넣기 */
    '.g2판 button{font:bold 13px sans-serif;color:#f8e890;background:rgba(40,48,40,0.55);border:1px solid rgba(248,232,144,0.4);border-radius:8px;padding:0;touch-action:none}' +
    '.g2판 button.눌림{background:rgba(200,168,72,0.75);color:#201808}' +
    '#터치단추{position:fixed;right:6px;top:8px;z-index:2147483000;display:flex;flex-direction:row;gap:8px}' +   /* 정본 345 — 가로로 나란히(높이 46) · 세로로 쌓으면 92 까지 내려와 낮은 화면에서 오른쪽 패드 R2 와 겹쳤다 */
    '#터치단추 button{width:52px;height:38px}' +
    '#가상왼,#가상오{position:fixed;bottom:10px;z-index:2147482999;display:none;opacity:0.85}' +
    /* 아이폰 카메라 구멍·둥근 모서리(안전 영역)를 피한다 — 11-20 아이폰 시뮬레이터 실측: 왼쪽 가장자리 L2·◀ 가 가려짐 (아래 viewport-fit=cover 가 있어야 env 값이 나온다) */
    '#가상왼{left:max(8px,env(safe-area-inset-left))}#가상오{right:max(8px,env(safe-area-inset-right))}' +
    '#터치단추{right:max(6px,env(safe-area-inset-right))}' +
    'body.가상켬 #가상왼,body.가상켬 #가상오{display:grid}' +
    '.가상크기모름 #가상왼,.가상크기모름 #가상오{visibility:hidden}' +   /* 정본 338 — 판 크기를 잴 때까지 숨김 */
    /* 데드존 — 패드 둘레 보이지 않는 띠(칸의 0.4배 · 48px 칸이면 19px). 눌러도 아무 일 없다(판위 → 땅 누름으로 안 바꿈)
     *   (정본 317 · 사장님 11-20 「십자키를 누르다가 옆에 지면이 터치되어서 타일이 이동하는 문제도 있어. 십자키나 버튼 주변은 약간의 데드존이 필요해보여」) */
    '#가상왼::before,#가상오::before{content:"";position:absolute;inset:calc(var(--g2칸,48px)*-0.4);z-index:-1}' +
    '#가상왼{grid-template-columns:repeat(3,var(--g2칸,48px));grid-template-rows:calc(var(--g2칸,48px)*0.8) 8px repeat(3,var(--g2칸,48px)) 6px calc(var(--g2칸,48px)*2.2);gap:4px}' +
    '#가상오{grid-template-columns:repeat(3,var(--g2칸,48px));grid-template-rows:calc(var(--g2칸,48px)*0.8) 8px repeat(3,var(--g2칸,48px)) 6px calc(var(--g2칸,48px)*2.2);gap:4px}' +
    '.g2판 button.둥근{border-radius:24px;font-size:18px}' +
    /* 아날로그 스틱 — 손가락으로 끌기 · 가볍게 톡 = L3·R3 (11-20 사장님 「그리고 가상 패드관련 l,r 스틱이 없는데?」 · 정본 303) */
    '.g2판 .스틱{grid-column:1/4;justify-self:center;width:calc(var(--g2칸,48px)*2.2);height:calc(var(--g2칸,48px)*2.2);border-radius:50%;background:rgba(40,48,40,0.45);border:1px solid rgba(248,232,144,0.4);position:relative;touch-action:none}' +
    '.g2판 .스틱알{position:absolute;left:30%;top:30%;width:40%;height:40%;border-radius:50%;background:rgba(248,232,144,0.45);pointer-events:none}' +
    '.g2판 .스틱.눌림 .스틱알{background:rgba(200,168,72,0.85)}' +
    /* L3·R3 — 스틱 안쪽 옆(화면 쪽) 둥근 단추 · 데드존 띠(0.4칸) 바깥 (정본 318) */
    '.g2판 button.L3R3{position:absolute;bottom:calc(var(--g2칸,48px)*0.65);width:calc(var(--g2칸,48px)*0.9);height:calc(var(--g2칸,48px)*0.9);border-radius:50%;font-size:12px}' +
    '#가상왼 button.L3R3{left:calc(100% + var(--g2칸,48px)*0.55)}#가상오 button.L3R3{right:calc(100% + var(--g2칸,48px)*0.55)}';
  document.head.appendChild(꼴);
  /* 안전 영역 값(env(safe-area-inset-*))을 받으려면 viewport-fit=cover 가 있어야 한다 — 휴대폰판에서만 붙인다(게임.html 은 그대로 · 다른 칸은 안 바꿈) */
  (function () { var v = document.querySelector('meta[name="viewport"]');
    if (!v) { v = document.createElement('meta'); v.name = 'viewport'; v.content = 'viewport-fit=cover'; document.head.appendChild(v); }
    else if (!/viewport-fit/.test(v.content)) v.content += ', viewport-fit=cover'; })();

  /* ── 가상 패드 [리마스터 · 모바일] (사장님 11-19 「모바일은 가상 패드를 만들어야할 것 같은데」 → «켜고 끄는 단추» 고르심)
   *   화면 위 단추를 «진짜 패드»처럼 게임에 보인다 — navigator.getGamepads 맨 앞에 표준 배치(standard) 패드 하나를 끼운다
   *   ⇒ 패드 연결 부품(pad_input.js · gamepad.js)이 진짜 패드와 똑같이 읽는다(버튼 다시 지정·십자 반복·R1 가속 그대로)
   *   켬/끔은 «패드» 단추 · 이 기기에만 기억(localStorage g2.vpad) */
  var 가상켬 = false; try { 가상켬 = localStorage.getItem('g2.vpad') === '1'; } catch (e저) { }
  var 가상패드 = { id: '가상 패드 (화면)', index: 0, connected: true, mapping: 'standard', axes: [0, 0, 0, 0], buttons: [], timestamp: 0, vibrationActuator: null };
  for (var bi = 0; bi < 17; bi++) 가상패드.buttons.push({ pressed: false, touched: false, value: 0 });
  var 원래패드 = (navigator.getGamepads && navigator.getGamepads.bind(navigator)) || function () { return []; };
  try {
    navigator.getGamepads = function () {
      var 목 = [].slice.call(원래패드() || []);
      if (가상켬) 목.unshift(가상패드);                               /* 첫 패드로 — gamepad.js 첫패드() 는 표준 배치의 첫째를 읽는다 */
      return 목;
    };
  } catch (e갈) { }
  function 버튼(번호, 눌림) { var b = 가상패드.buttons[번호]; b.pressed = b.touched = 눌림; b.value = 눌림 ? 1 : 0; 가상패드.timestamp = performance.now(); }
  /* 표준 배치 번호 — 0 엑스 · 1 동그라미 · 2 네모 · 3 세모 · 4 L1 · 5 R1 · 6 L2 · 7 R2 · 8 셀렉트 · 9 스타트 · 10 L3 · 11 R3 · 12~15 십자 */
  function 패드단추(글, 번호, 꼴이름) {
    var b = document.createElement('button'); b.textContent = 글; if (꼴이름) b.className = 꼴이름;
    var 손 = {}, 누른때 = 0;
    /* 눌림은 최소 80ms — 게임은 패드를 한 장마다 읽어서 아주 짧은 «톡»은 그 사이에 끝나 버린다 (11-19 에뮬레이터: 짧게 누르면 안 먹음) */
    var 놓 = function (e) { if (e && e.pointerId != null) delete 손[e.pointerId]; if (Object.keys(손).length) return;
      setTimeout(function () { if (!Object.keys(손).length) { 버튼(번호, false); b.classList.remove('눌림'); } }, Math.max(0, 80 - (Date.now() - 누른때))); };
    b.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); 손[e.pointerId] = 1; 누른때 = Date.now(); try { b.setPointerCapture(e.pointerId); } catch (e잡) { } 버튼(번호, true); b.classList.add('눌림');
      try { if (navigator.vibrate) navigator.vibrate(8); } catch (e진) { } });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { b.addEventListener(t, 놓); });
    b.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return b;
  }
  /* 아날로그 스틱 — 쪽 0 왼쪽(축 0·1 · L3 = 10) · 1 오른쪽(축 2·3 · R3 = 11) (11-20 사장님 「그리고 가상 패드관련 l,r 스틱이 없는데?」 · 정본 303)
   *   끌면 원 안 자리를 −1~1 축으로 · 놓으면 0 · 가볍게 톡(250ms 안 · 반지름 35% 안)은 L3·R3 한 번
   *   왼쪽 = 가상 마우스·이동 · 오른쪽 = 3D 기울기·배율·월드 밀기 · R3 = 처음 값 — 게임 쪽은 진짜 패드와 같이 읽는다(gamepad.js 데드존 그대로) */
  function 패드스틱(쪽) {
    var 판 = document.createElement('div'); 판.className = '스틱';
    var 알 = document.createElement('div'); 알.className = '스틱알'; 판.appendChild(알);
    var 손 = null, 시작 = 0, 멀리 = 0;
    var 축쓰기 = function (x, y) { 가상패드.axes[쪽 * 2] = x; 가상패드.axes[쪽 * 2 + 1] = y; 가상패드.timestamp = performance.now(); };
    var 옮김 = function (e) {
      var r = 판.getBoundingClientRect(), 반 = r.width / 2 || 1;
      var dx = (e.clientX - r.left - 반) / 반, dy = (e.clientY - r.top - 반) / 반, 길 = Math.sqrt(dx * dx + dy * dy);
      if (길 > 1) { dx /= 길; dy /= 길; 길 = 1; }
      멀리 = Math.max(멀리, 길); 축쓰기(dx, dy);
      알.style.transform = 'translate(' + (dx * 반 * 0.6) + 'px,' + (dy * 반 * 0.6) + 'px)';
    };
    판.addEventListener('pointerdown', function (e) { e.preventDefault(); e.stopPropagation(); 손 = e.pointerId; 시작 = Date.now(); 멀리 = 0;
      try { 판.setPointerCapture(e.pointerId); } catch (e잡) { } 판.classList.add('눌림'); 옮김(e); });
    판.addEventListener('pointermove', function (e) { if (e.pointerId !== 손) return; e.preventDefault(); 옮김(e); });
    /* 스틱 톡 = L3·R3 는 뺐다 — ✕ 를 누르다 스틱 위쪽을 스치면 카메라가 초기화됐다(정본 318) · L3·R3 는 따로 단추로만 */
    var 놓 = function (e) { if (e.pointerId !== 손) return; 손 = null; 축쓰기(0, 0); 알.style.transform = ''; 판.classList.remove('눌림'); };
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(function (t) { 판.addEventListener(t, 놓); });
    판.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    return 판;
  }
  /* 패드 크기 — 게임 화면 양옆 빈 띠에 들어가게(게임을 가리지 않게) · 띠가 좁으면 최소 34px 로 겹친다 */
  function 크기맞추기() {
    /* 게임 화면 너비 = 셸 판(#판)이 화면에서 실제로 차지하는 너비 — 화면비 설정·전투 캔버스(창 전체)로 재면 틀린다(11-19 실측: 설정 4:3 인데 판은 636×398) */
    var 판el = document.getElementById('판'), 게임w = 판el ? 판el.getBoundingClientRect().width : 0;
    /* 정본 338 — 처음엔 게임 판이 아직 자리를 안 잡아 너비가 0 → 짐작한 값으로 큰 패드가 나왔다가 2초 뒤 작아졌다
     *   (사장님 11-20 「처음 시작시 가상패드가 크게 나왔다가 작아지는 문제가 있어」) ⇒ 잴 수 있을 때까지(최대 1.5초) 패드를 숨겨 둔다 */
    var 루트 = document.documentElement;
    if (!게임w && Date.now() - 크기시작 < 1500) { if (루트.classList) 루트.classList.add('가상크기모름'); return; }
    if (루트.classList) 루트.classList.remove('가상크기모름');
    if (!게임w) 게임w = Math.min(innerWidth, innerHeight * 16 / 10);
    var 띠 = (innerWidth - 게임w) / 2;
    /* 안전 영역(카메라 구멍 쪽)만큼 띠가 좁아진다 — 패드가 그만큼 안쪽에 선다 */
    var 왼판 = document.getElementById('가상왼'), 여백 = 왼판 ? (parseFloat(getComputedStyle(왼판).left) || 8) - 8 : 0;
    띠 -= Math.max(0, 여백);
    var 칸w = Math.max(34, Math.min(56, Math.floor((띠 - 12 - 8) / 3)));
    /* 정본 340 — 아이패드처럼 4:3 에 가까운 화면은 옆 띠가 거의 없어 늘 가장 작은 34px 가 됐다(아이패드 미니 흉내: 창 1133×744 → 칸 34 · 사장님 신고 «2초정도뒤에 매우 작아짐»)
     *   ⇒ 띠로 잰 칸이 44px(손가락 최소) 보다 작으면 게임 화면 가장자리에 겹쳐 큰 칸(56)을 쓴다 — 아래 세로 제한은 그대로 · 휴대폰(옆 띠 넓음)은 그대로 */
    if (Math.floor((띠 - 12 - 8) / 3) < 44) 칸w = 56;
    /* 세로도 — 단추 줄(0.8 + 3칸) + 스틱(2.2칸) + 틈이 화면 높이에 들어가게 (정본 303 스틱 더함) */
    칸w = Math.max(30, Math.min(칸w, Math.floor((innerHeight - 20 - 14 - 24) / 6)));
    document.documentElement.style.setProperty('--g2칸', 칸w + 'px');
    /* 정본 345 — 오른쪽 패드 위끝이 ESC·패드 단추 아래(+6)보다 올라오면 그만큼 칸을 줄인다 (사장님 11-20 「지금은 esc랑 r2가 겹쳐」 · 844×390 에서 패드 위 12 / 단추 아래 92)
     *   패드 높이는 칸에 비례(약 6.9칸) — 모자란 높이 ÷ 6.9 만큼 줄이고 한 번 더 잰다 */
    var 오판 = document.getElementById('가상오'), 단추판 = document.getElementById('터치단추');
    if (오판 && 단추판 && 오판.getBoundingClientRect().height > 0) {   /* 고정 위치라 offsetParent 는 늘 null — 크기로 본다(패드 꺼짐 = 0) */
      for (var 번 = 0; 번 < 3; 번++) {
        var 모자람 = 단추판.getBoundingClientRect().bottom + 6 - 오판.getBoundingClientRect().top;
        if (모자람 <= 0 || 칸w <= 30) break;
        칸w = Math.max(30, 칸w - Math.ceil(모자람 / 6.9));
        document.documentElement.style.setProperty('--g2칸', 칸w + 'px');
      }
    }
  }
  var 크기시작 = Date.now();
  addEventListener('resize', 크기맞추기); setInterval(크기맞추기, 2000);
  /* 정본 338 — 판 크기가 바뀌는 순간 다시 잰다 · 처음 3초는 화면마다 (2초 간격만으로는 처음 큰 패드가 보였다) */
  (function 처음재기() {
    var 끝 = Date.now() + 3000, 판관찰 = false;
    (function 한장() {
      크기맞추기();
      if (!판관찰 && typeof ResizeObserver === 'function') { var 판el = document.getElementById('판'); if (판el) { 판관찰 = true; try { new ResizeObserver(function () { 크기맞추기(); }).observe(판el); } catch (e) { } } }
      if (Date.now() < 끝 && typeof requestAnimationFrame === 'function') requestAnimationFrame(한장);
    })();
  })();
  function 칸(판, 단추, 열, 행) { if (단추) { 단추.style.gridColumn = 열; 단추.style.gridRow = 행; 판.appendChild(단추); } }
  function 가상그리기() {
    if (document.body) document.body.classList.toggle('가상켬', 가상켬);
    var t = document.getElementById('패드켬단추'); if (t) t.classList.toggle('눌림', 가상켬);
    if (!가상켬) for (var i = 0; i < 17; i++) 버튼(i, false);   /* 끄면 눌린 채 남지 않게 */
  }

  function 단추달기() {
    if (document.getElementById('터치단추')) return;
    var 판 = document.createElement('div'); 판.id = '터치단추'; 판.className = 'g2판';
    var b = document.createElement('button'); b.textContent = 'ESC';
    b.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); 키('Escape'); });
    var p = document.createElement('button'); p.id = '패드켬단추'; p.textContent = '패드';
    p.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); 가상켬 = !가상켬; try { localStorage.setItem('g2.vpad', 가상켬 ? '1' : '0'); } catch (e저2) { } 가상그리기(); });
    판.appendChild(b); 판.appendChild(p); document.body.appendChild(판);
    /* 왼쪽 — L1·L2 · 십자 / 오른쪽 — R1·R2 · 세모·네모·동그라미·엑스 · 셀렉트·스타트 */
    var 왼 = document.createElement('div'); 왼.id = '가상왼'; 왼.className = 'g2판';
    칸(왼, 패드단추('L2', 6), '1', '1'); 칸(왼, 패드단추('L1', 4), '3', '1');
    칸(왼, 패드단추('▲', 12), '2', '3'); 칸(왼, 패드단추('◀', 14), '1', '4'); 칸(왼, 패드단추('▶', 15), '3', '4'); 칸(왼, 패드단추('▼', 13), '2', '5');
    칸(왼, 패드단추('SEL', 8), '2', '4');
    왼.appendChild(패드단추('L3', 10, 'L3R3'));   /* L3·R3 단추 (사장님 11-20 「패드 l3, r3 버튼도 빠졌어(l3는 안쓰기는 하지만... 매핑이 있으니 넣어야 할 것 같아.)」 · 정본 303)
     *   ✕·○ 옆 칸에 있어 누르다 R3(카메라 초기화)가 눌렸다 → 스틱 안쪽 옆(화면 쪽)으로 뗀다 (정본 318 · 사장님 11-20 「l3 r3 위치도 불편해. 버튼 누르다가 자꾸 카메라 초기화 돼」·「화면 안쪽으로 조금 들어오더라도 다른곳으로 옮기는게 낫겠어」) */
    var 오 = document.createElement('div'); 오.id = '가상오'; 오.className = 'g2판';
    칸(오, 패드단추('R1', 5), '1', '1'); 칸(오, 패드단추('R2', 7), '3', '1');
    칸(오, 패드단추('△', 3, '둥근'), '2', '3'); 칸(오, 패드단추('□', 2, '둥근'), '1', '4'); 칸(오, 패드단추('○', 1, '둥근'), '3', '4'); 칸(오, 패드단추('✕', 0, '둥근'), '2', '5');
    칸(오, 패드단추('ST', 9), '2', '4');
    오.appendChild(패드단추('R3', 11, 'L3R3'));   /* 위 L3 와 같다 — 스틱 안쪽 옆 (정본 318) */
    var 왼스틱 = 패드스틱(0); 왼스틱.style.gridRow = '7'; 왼.appendChild(왼스틱);   /* 아래 — 왼쪽·오른쪽 아날로그 스틱 (정본 303) */
    var 오스틱 = 패드스틱(1); 오스틱.style.gridRow = '7'; 오.appendChild(오스틱);
    document.body.appendChild(왼); document.body.appendChild(오);
    가상그리기(); 크기맞추기();
  }
  if (document.body) 단추달기(); else document.addEventListener('DOMContentLoaded', 단추달기);
  /* 게임 «종료»(EXIT) — 모바일 앱은 특별 주소로 앱 본체(MainActivity 의 G2앱창구)에 알려 앱을 닫는다 (데스크톱 G2앱.종료 와 같은 자리) */
  /* 정본 343 — 아이폰 본체는 g2app://exit 를 가로채지 않아 «종료하기»에서 멈췄다(아이패드 신고 11-20 · 사장님 「실행기 첫화면으로 돌아가면 안돼 종료되어야지」)
   *   ⇒ 아이폰 본체(아이폰_시작.swift G2ExitGate)가 단 메시지 창구 «g2exit» 가 있으면 거기로 알려 앱을 끝낸다 · 없으면(안드로이드) 그대로 g2app://exit */
  if (!root.G2앱) root.G2앱 = { 종료: function () {
    var 창구 = root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.g2exit;
    /* 정본 343 — 창구가 없는 아이폰·아이패드(라이브 컨테이너 등 · 신고 130617 종료창구 false)는 앱 안 Node 창구 /exit 로 — Node 가 끝나면 같은 프로세스인 앱이 꺼진다 */
    var 애플 = /iP(hone|ad|od)/.test(navigator.userAgent || '') || (/Macintosh/.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);
    if (창구) 창구.postMessage('exit'); else if (애플) location.href = 'http://127.0.0.1:47861/exit'; else location.href = 'g2app://exit';
  } };
  root.G2터치 = { 켜짐: true, ESC: function () { 키('Escape'); } };   /* ESC — 안드로이드 «뒤로»도 이것을 부른다(MainActivity) */
})(typeof window !== 'undefined' ? window : this);
