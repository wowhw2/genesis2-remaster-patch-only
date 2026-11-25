/* ★★★★★ 유닛 GPU 층 (정본 456 · 03_분석/전투3D_유닛GPU_전환계획.md)
 *
 *   사장님 11-24 「지금 솔직히 결과물 화면에 비해 사양을 과하게 잡아먹는 느낌이야」 → 「구체적인 계획 세워봐. 이제 너는 이부분만 전담으로 할거야.」
 *   3D 전투에서 유닛 그림 판(spriteLayer)을 웹 요소 대신 WebGL 로 그려, 카메라가 움직일 때마다 브라우저가 요소 140개 남짓의
 *   3D 변환을 다시 계산하던 몫(한 장 «표시»의 약 60% · 휴대폰 흉내 상한)을 없앤다.
 *
 *   ── 1단계: 행렬 계산기 ──────────────────────────────────────────────────────────
 *   spriteLayer 안 요소 하나가 화면(R.host 안 CSS px)의 어디에 그려지는지를 «브라우저와 같은 식»으로 낸다 — 배치를 다시 계산시키는 읽기
 *   (getBoundingClientRect·offsetWidth·getComputedStyle)를 하나도 쓰지 않고 인라인 스타일 값만 읽는다.
 *     · 평면 대열(render.js _판평면켜기 6669~): spriteLayer 는 host 가운데(left/top 50%) 0×0 판 · transform-style flat · perspective = host 값
 *       직계 자식 변환 = 고정 틀 «translate(-pl,-pt) var(--w) translate(pl,pt) translate(ox,oy) var(--loc) translate(-ox,-oy)» · 원점 0 0 (render.js 6762)
 *     · 유닛 상자는 preserve-3d(render.js:7442) — 자식(그림자·몸 층·턴 마커 translateZ(1px) 등)이 같은 3D 공간 · 평면(flat) 부모 아래 3D 는 z 를 버린다
 *     · 원근은 perspective 를 가진 부모가 자식에게 건다: T(원점) · persp(d) · T(−원점)
 *   스타일시트는 이 판들의 변환·원점·원근을 안 정한다(battle_stage.css 는 image-rendering 뿐 · 리마스터3D.js:69 는 3D 에서 맵 조각 숨김) — 인라인만으로 된다.
 *   못 푸는 값(%·calc·em·auto·정적 배치가 겹친 형제 등)이면 { 없음: 까닭 } — GPU 층은 그 장을 옛 길(웹 요소)로 그린다(계획서 원칙 3).
 *
 *   쓰기: G2유닛GPU층.행렬(요소) → { m: DOMMatrix(요소 안 점 → host 안 CSS px · 동차 좌표 · 원근 나눔 전), w, h } | { 없음 }
 *         G2유닛GPU층.꼭짓점(요소) → [[x,y]…4] | null   (원근 나눔 뒤 host 안 CSS px)
 */
(function (root) {
  'use strict';
  if (typeof root.DOMMatrix !== 'function') return;

  function 판(R) { return R && R.spriteLayer; }
  /* render.js:6762 평면틀 — 브라우저가 정규화한 꼴(공백 뺌)로 견준다 */
  var 고정틀 = 'translate(calc(-1*var(--pl)),calc(-1*var(--pt)))var(--w)translate(var(--pl),var(--pt))translate(var(--ox),var(--oy))var(--loc)translate(calc(-1*var(--ox)),calc(-1*var(--oy)))';

  /* 길이 하나 — px 와 % 만 · 나머지는 모름(NaN) */
  function 길이(v, 기준) {
    if (v == null || v === '' || v === 'auto') return NaN;
    v = String(v).trim();
    if (/^-?[\d.]+(e-?\d+)?px$/.test(v)) return parseFloat(v);
    if (v === '0') return 0;
    if (/^-?[\d.]+%$/.test(v)) return 기준 * parseFloat(v) / 100;
    return NaN;
  }
  function 원점값(v, 기준) {
    if (v === 'left' || v === 'top') return 0;
    if (v === 'right' || v === 'bottom') return 기준;
    if (v === 'center') return 기준 / 2;
    return 길이(v, 기준);
  }
  /* 상자 크기 — 인라인 width/height · 캔버스는 크기 속성(CSS 크기 없을 때) · 그림은 속성·본래 크기 */
  function 크기(e, R) {
    if (e === 판(R)) return { w: 0, h: 0 };
    var st = e.style, w = 길이(st.width, NaN), h = 길이(st.height, NaN);
    /* 인라인 크기가 있는데 못 풀면(% 등) 모름 — 캔버스·그림의 속성 크기로 바꿔치지 않는다 (Codex 1단계) */
    if (!(w >= 0)) w = st.width !== '' && st.width !== 'auto' ? NaN : e.tagName === 'CANVAS' ? e.width : e.tagName === 'IMG' ? (+e.getAttribute('width') || e.naturalWidth) : NaN;
    if (!(h >= 0)) h = st.height !== '' && st.height !== 'auto' ? NaN : e.tagName === 'CANVAS' ? e.height : e.tagName === 'IMG' ? (+e.getAttribute('height') || e.naturalHeight) : NaN;
    return { w: w, h: h };
  }
  /* 변환 문자열 → DOMMatrix (var 없는 것만 · DOMMatrix 가 % 를 못 받으면 모름) */
  function 변환(문) {
    if (!문 || 문 === 'none') return new root.DOMMatrix();
    try { return new root.DOMMatrix(문); } catch (e) { return null; }
  }
  /* 요소 자신의 국소 변환(원점 둘레) — 평면 대열 고정 틀이면 변수로 합친다 */
  function 국소(e, 부모, 크, R) {
    var st = e.style, 문 = st.transform;
    if (문 && 문.indexOf('var(') >= 0) {
      if (부모 !== 판(R)) return { 없음: '판 밖 var 변환' };
      if (st.transformOrigin !== '0px 0px' || 문.replace(/\s+/g, '') !== 고정틀) return { 없음: '평면 틀이 아닌 var 변환' };   /* render.js:6762 고정 틀과 글자째 같을 때만 */
      var 변 = function (k) { return st.getPropertyValue(k).trim(); };
      var pl = 길이(변('--pl'), NaN), pt = 길이(변('--pt'), NaN), ox = 길이(변('--ox'), NaN), oy = 길이(변('--oy'), NaN);
      if (!(isFinite(pl) && isFinite(pt) && isFinite(ox) && isFinite(oy))) return { 없음: '평면 틀 변수 모름' };
      var W = 변환(부모.style.getPropertyValue('--w').trim()), L = 변환(변('--loc') || 'none');
      if (!W || !L) return { 없음: '평면 틀 --w/--loc 풀이 못 함' };
      /* 고정 틀(render.js:6762) · 원점 0 0 */
      return { m: new root.DOMMatrix().translate(-pl, -pt).multiply(W).translate(pl, pt).translate(ox, oy).multiply(L).translate(-ox, -oy) };
    }
    var X = 변환(문);
    if (!X) return { 없음: '변환 풀이 못 함: ' + String(문).slice(0, 60) };
    if (X.isIdentity) return { m: X };
    var o = (st.transformOrigin || '50% 50%').split(/\s+/);
    var ox2 = 원점값(o[0], 크.w), oy2 = 원점값(o[1] == null ? '50%' : o[1], 크.h), oz = o[2] != null ? 길이(o[2], 0) : 0;
    if (!(isFinite(ox2) && isFinite(oy2) && isFinite(oz))) return { 없음: '변환 원점 모름: ' + st.transformOrigin };
    return { m: new root.DOMMatrix().translate(ox2, oy2, oz).multiply(X).translate(-ox2, -oy2, -oz) };
  }
  /* 부모 안 자리 — 절대 배치(left/top + margin) · 정적이면 (0,0) 이되 앞에 정적 형제가 있으면 모름 */
  function 자리(e, 부모, R) {
    var st = e.style;
    if (e === 판(R)) {
      var 호 = R.호스트크기 ? R.호스트크기() : null;
      if (!호) return { 없음: 'host 크기 모름' };
      var l0 = 길이(st.left, 호.w), t0 = 길이(st.top, 호.h);
      return (isFinite(l0) && isFinite(t0)) ? { x: l0, y: t0 } : { 없음: '판 자리 모름' };
    }
    var 위치 = st.position;
    if (위치 === 'absolute' || 위치 === 'fixed') {
      var 부크 = 크기(부모, R);
      var l = st.left === '' ? 0 : 길이(st.left, 부크.w), t = st.top === '' ? 0 : 길이(st.top, 부크.h);
      var ml = st.marginLeft === '' ? 0 : 길이(st.marginLeft, 부크.w), mt = st.marginTop === '' ? 0 : 길이(st.marginTop, 부크.w);
      if (!(isFinite(l) && isFinite(t) && isFinite(ml) && isFinite(mt))) return { 없음: '자리 모름: ' + st.left + ' ' + st.top };
      return { x: l + ml, y: t + mt };
    }
    for (var p = e.previousElementSibling; p; p = p.previousElementSibling) {
      var ps = p.style.position;
      if (ps !== 'absolute' && ps !== 'fixed' && p.style.display !== 'none') return { 없음: '정적 배치 형제' };
    }
    return { x: 0, y: 0 };
  }
  function 원근(부모, R) {
    var st = 부모.style, d = 길이(st.perspective, NaN);
    if (st.perspective === '' || st.perspective === 'none') return null;
    if (!(d > 0)) return { 없음: '원근 값 모름: ' + st.perspective };
    var 크 = 크기(부모, R), o = (st.perspectiveOrigin || '50% 50%').split(/\s+/);
    var px = 원점값(o[0], 크.w), py = 원점값(o[1] == null ? '50%' : o[1], 크.h);
    if (!(isFinite(px) && isFinite(py))) return { 없음: '원근 원점 모름' };
    var P = new root.DOMMatrix(); P.m34 = -1 / d;
    return { m: new root.DOMMatrix().translate(px, py).multiply(P).translate(-px, -py) };
  }
  /* preserve-3d 가 실제로 서나 — 묶음 속성(filter·opacity<1·clip-path·mask·overflow·isolation·mix-blend-mode)이 있으면 CSS 규칙상 평면으로 풀린다
   *   (11-25 1단계 시험: 필살 중 시전자 상자의 filter:brightness(연출밝은유닛 render.js:6603)로 턴 마커 translateZ(1px) 가 사라져 2px 어긋남) */
  function 입체(e) {
    var st = e.style;
    if (st.transformStyle !== 'preserve-3d') return false;
    if (st.filter && st.filter !== 'none') return false;
    if (st.opacity !== '' && +st.opacity < 1) return false;
    if (st.clipPath && st.clipPath !== 'none') return false;
    if ((st.webkitMaskImage && st.webkitMaskImage !== 'none') || (st.maskImage && st.maskImage !== 'none')) return false;
    if (st.overflow && st.overflow !== 'visible' && st.overflow !== 'clip') return false;   /* overflow:clip 은 평면화하지 않는다 */
    if (st.isolation === 'isolate') return false;
    if (st.mixBlendMode && st.mixBlendMode !== 'normal') return false;
    return true;
  }
  var 평면화 = (function () { var F = new root.DOMMatrix(); F.m33 = 0; return F; })();   /* z 를 버린다 — 평면(flat) 부모가 자식의 3D 를 제 판에 눕힐 때 */

  /* 묶음 — 쓰기가 끝난 «읽기 구간»에서만 요소별 행렬을 담아 다시 쓴다(부모 줄을 요소마다 처음부터 곱하지 않게 · 2단계 빠르기)
   *   묶음시작() 과 묶음끝() 사이에 스타일을 쓰면 안 된다 — 유닛띄우기 두 번째 고리·클릭 후보처럼 읽기만 하는 곳에서만 */
  var 묶음 = null;
  function 묶음시작() { 묶음 = new Map(); }
  function 묶음끝() { 묶음 = null; }

  /** 요소 → { m, w, h } — m 은 요소 안 (x, y, 0, 1) 을 host 안 CSS px 동차 좌표로 (원근 나눔 전) · 부모 행렬 × 자기 몫(같은 곱 · 순서만 묶음) */
  function 행렬(e, R) {
    R = R || root.R;
    var L = 판(R);
    if (!L || !e) return { 없음: '판 없음' };
    if (e === L) return { 없음: '판 자체' };
    if (묶음 && 묶음.has(e)) return 묶음.get(e);
    var 부모 = e.parentElement, 앞;
    if (!부모) return { 없음: '판 밖 요소' };
    if (부모 === L) {
      var 판자리 = 자리(L, null, R);
      if (판자리.없음) return 판자리;
      if (L.style.transform && L.style.transform !== 'none') return { 없음: '판 자체 변환' };
      앞 = { m: new root.DOMMatrix().translate(판자리.x, 판자리.y) };
    } else {
      앞 = 행렬(부모, R);
      if (앞.없음) return 앞;
    }
    var M = 앞.m;
    var 원 = 원근(부모, R);
    if (원 && 원.없음) return 원;
    if (원 && 부모 !== L && !입체(부모)) return { 없음: '원근과 평면화를 함께 가진 부모' };   /* 지금 구조엔 없음 — 들어오면 옛 길 (Codex 1단계) */
    if (원) M = M.multiply(원.m);
    else if (부모 !== L && !입체(부모)) M = M.multiply(평면화);
    var 자 = 자리(e, 부모, R);
    if (자.없음) return 자;
    var 크 = 크기(e, R);
    if (!(크.w >= 0 && 크.h >= 0)) return { 없음: '크기 모름: ' + e.tagName + ' ' + e.className };
    var 국 = 국소(e, 부모, 크, R);
    if (국.없음) return 국;
    var 결 = { m: M.translate(자.x, 자.y).multiply(국.m), w: 크.w, h: 크.h };
    if (묶음) 묶음.set(e, 결);
    return 결;
  }
  /** 네 꼭짓점(왼위·오위·왼아래·오아래) — host 안 CSS px · 카메라 뒤(w≤0)면 null */
  function 꼭짓점(e, R) {
    var r = 행렬(e, R);
    if (r.없음) return r;
    var 점 = [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]].map(function (p) { var q = r.m.transformPoint(new root.DOMPoint(p[0], p[1], 0, 1)); return q.w > 1e-9 ? [q.x / q.w, q.y / q.w] : null; });
    return 점.some(function (p) { return !p; }) ? { 없음: '카메라 뒤' } : 점;
  }

  /* ── 2단계: 재기를 계산식으로 (스위치 window.__유닛GPU재기 · 기본 꺼짐) ─────────────────────────────
   *   웹 요소는 보이는 채로 둔다 — 재는 곳만 getBoundingClientRect·elementsFromPoint 대신 위 행렬로. 못 풀면 그 요소만 옛 길(직접 잼).
   *   쓰는 곳: 리마스터3D.js 유닛띄우기·그림사각(가림 사각 — 반영마다 강제 배치 계산이 일던 자리) · render.js screenOfRendered(링·대화 타원·외침) ·
   *           유닛불투명픽셀인가·화면점유닛(클릭) · 리마스터3D.js 3D 화면점유닛(elementsFromPoint) · battle_main.js 패드링빛 */
  function 쓸까(R) {
    R = R || root.R;
    if (!root.__유닛GPU재기 || !R || !R.host) return false;
    var L = 판(R);
    return !!(L && L.parentNode === R.host && L._평면tf && R.host.classList.contains('g2-3d맵'));   /* 3D · 평면 대열일 때만 (2.5D 는 그대로) */
  }
  /** 요소의 둘러싸는 사각 — host 안 CSS px (getBoundingClientRect − host 왼위 와 같은 뜻) · 못 풀면 null */
  function 사각(e, R) {
    /* display:none 이 길에 있으면 크기 0 — getBoundingClientRect 와 같은 뜻(옛 길은 0×0 으로 재서 빼았다 · visibility:hidden 은 자리가 남으므로 그대로)
     *   ☠ 11-25 2단계 첫 시험: 꺼진 턴 마커·상태 아이콘까지 넣어 가림 사각이 8~11px 커졌다 */
    var L = 판(R || root.R);
    for (var n = e; n && n !== L; n = n.parentElement) if (n.style.display === 'none') return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    var p = 꼭짓점(e, R);
    if (!Array.isArray(p)) return null;
    var l = Math.min(p[0][0], p[1][0], p[2][0], p[3][0]), t = Math.min(p[0][1], p[1][1], p[2][1], p[3][1]);
    var r = Math.max(p[0][0], p[1][0], p[2][0], p[3][0]), b = Math.max(p[0][1], p[1][1], p[2][1], p[3][1]);
    return { left: l, top: t, right: r, bottom: b, width: r - l, height: b - t };
  }
  /** 화면(뷰포트) 사각 — getBoundingClientRect 와 같은 뜻 · host 자리 하나만 잰다(드문 길: 클릭·링·패드 빛) */
  function 화면사각(e, R, 호) {
    R = R || root.R;
    var r = 사각(e, R);
    if (!r) return null;
    호 = 호 || R.host.getBoundingClientRect();
    return { left: r.left + 호.left, top: r.top + 호.top, right: r.right + 호.left, bottom: r.bottom + 호.top, width: r.width, height: r.height };
  }
  /** host 안 점 (x, y) 이 요소의 네 꼭짓점 사각(볼록) 안인가 — 왼위·오위·오아래·왼아래 차례로 외적 부호 */
  /** host 안 화면 점 (x, y) → 요소 판 위 좌표 (u, v) — 원근 투영을 판(z=0)에서 거꾸로 풂 · 못 풀면 null */
  function 판좌표(e, x, y, R) {
    var r = 행렬(e, R);
    if (r.없음) return null;
    var m = r.m;
    var a11 = m.m11 - x * m.m14, a12 = m.m21 - x * m.m24, b1 = x * m.m44 - m.m41;
    var a21 = m.m12 - y * m.m14, a22 = m.m22 - y * m.m24, b2 = y * m.m44 - m.m42;
    var 행렬식 = a11 * a22 - a12 * a21;
    if (!(Math.abs(행렬식) > 1e-12)) return null;
    var u = (b1 * a22 - a12 * b2) / 행렬식, v = (a11 * b2 - b1 * a21) / 행렬식;
    if (m.m14 * u + m.m24 * v + m.m44 <= 1e-9) return null;   /* 카메라 뒤 */
    return { u: u, v: v, w: r.w, h: r.h };
  }
  /** host 안 점 (x, y) 이 요소 판 안인가 — 화면 점을 판 위 좌표로 되돌려 반열린 사각 [0,w)×[0,h) 로 본다 · 1/64 px 내림(크롬 배치 단위)
   *   (11-25 2단계 시험: 18-1·1-7 클릭 4만 점 남짓 중 브라우저와 다른 것은 원근으로 크게 투영된 상자 모서리 0.1px 바깥 점 몇 개뿐 —
   *    판 좌표·화면 여유 어느 방식으로도 브라우저 쪽 서브픽셀 오차와 다 맞출 수 없어 정확한 기하로 둔다 · 계획서 §4-D) */
  function 점들어감(e, x, y, R) {
    var q0 = 판좌표(e, x, y, R);
    if (!q0) return null;
    var u = Math.floor(q0.u * 64) / 64, v = Math.floor(q0.v * 64) / 64;
    return u >= 0 && v >= 0 && u < q0.w && v < q0.h;
  }
  function 보이나(e, L) {
    for (var n = e; n && n !== L; n = n.parentElement) { var st = n.style; if (st.display === 'none' || st.visibility === 'hidden') return false; }
    return true;
  }
  /** 3D 클릭 후보 — host 안 점에 «그려진» 유닛 상자들을 앞(화면에 위)에서부터: elementsFromPoint 대신
   *   평면 판 안 차례 = 쌓임(z-index 큰 것 위 · 같으면 DOM 뒤가 위) · 상자나 보이는 자식 하나라도 점을 품으면 후보 · 못 풀면 null(옛 길) */
  function 점유닛후보(units, x, y, R) {
    R = R || root.R;
    var 바깥묶음 = !!묶음; if (!바깥묶음) 묶음시작();
    try { return 점유닛후보속(units, x, y, R); } finally { if (!바깥묶음) 묶음끝(); }
  }
  function 점유닛후보속(units, x, y, R) {
    var L = 판(R), 후보 = [];
    /* 못 다루는 조건이 하나라도 있으면 질의 통째로 옛 길(null → elementsFromPoint) — 조용히 빼면 앞뒤 차례가 깨진다 (Codex 2단계)
     *   · 다른 층으로 옮겨 간 유닛(유닛위층 render.js:6919 · 건물 미리보기 frontSprite map3d_building_preview.js:5648)
     *   · 잘라내기·가리개(clip-path · mask — 구조물 상자 리마스터3D.js:571) · 상자 자체 pointer-events:none */
    for (var i0 = 0; i0 < (units || []).length; i0++) {
      var u0 = units[i0], b0 = u0 && u0.alive && R.unitEls && R.unitEls[u0.id];
      if (!b0) continue;
      if (b0.parentNode !== L || b0.style.pointerEvents === 'none') return null;
      var 잘린 = [b0].concat(Array.prototype.slice.call(b0.querySelectorAll('*')));
      for (var k0 = 0; k0 < 잘린.length; k0++) { var st0 = 잘린[k0].style; if ((st0.clipPath && st0.clipPath !== 'none') || (st0.webkitMaskImage && st0.webkitMaskImage !== 'none') || (st0.maskImage && st0.maskImage !== 'none')) return null; }
    }
    for (var i = 0; i < (units || []).length; i++) {
      var u = units[i], b = u && u.alive && R.unitEls && R.unitEls[u.id];
      if (!b || !보이나(b, L)) continue;
      var 품 = false, 요소들 = [b].concat(Array.prototype.slice.call(b.querySelectorAll('*')));
      for (var k = 0; k < 요소들.length && !품; k++) {
        var e = 요소들[k];
        if (!보이나(e, L) || e.style.pointerEvents === 'none') continue;
        var 든 = 점들어감(e, x, y, R);
        if (든 === null) return null;
        if (든) 품 = true;
      }
      if (품) 후보.push({ u: u, z: parseFloat(b.style.zIndex) || 0, 차례: Array.prototype.indexOf.call(L.children, b) });
    }
    후보.sort(function (a, c) { return (c.z - a.z) || (c.차례 - a.차례); });
    return 후보.map(function (h) { return h.u; });
  }

  root.G2유닛GPU층 = { 묶음시작: 묶음시작, 묶음끝: 묶음끝, 행렬: 행렬, 꼭짓점: 꼭짓점, 쓸까: 쓸까, 사각: 사각, 화면사각: 화면사각, 점들어감: 점들어감, 점유닛후보: 점유닛후보, _길이: 길이 };
})(typeof window !== 'undefined' ? window : this);
