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

  /* ══ 3단계: GPU 그리기 (스위치 window.__유닛GPU그림 · 기본 꺼짐 · 재기 스위치 __유닛GPU재기 도 켜져야) ══════════════════════
   *   spriteLayer 자리(같은 차례)에 WebGL 캔버스 한 장 — 판 안 «그리는 요소»(캔버스·그림·배경 그림 div)를 브라우저와 같은 차례로 그린다:
   *     · 판 직속끼리: 쌓임 차례(z-index → DOM) — 평면 대열(flat)이라 깊이로 섞지 않는다
   *     · 유닛 상자(preserve-3d) 안: 깊이(화면 w — 먼 것 먼저) → 같은 깊이면 쌓임 차례(z-index → DOM)
   *       (11-25 상자 안 차례 시험: translateZ(1px) 는 z-index −1 이어도 z5 앞 · 같은 평면은 z-index → DOM)
   *   못 그리는 것(filter·opacity<1·clip-path·mask·blend · 배경 자리 지정 · 글자·테두리·배경색 · 못 푼 행렬 · 적재 안 된 그림)이 보이면 그 장은 통째로 옛 길(웹 요소)
   *   이 단계는 «맞게 그리기» — 캔버스 그림은 장마다 다시 올린다(바뀜 알림·판번은 6단계) */
  var 숨김꼴 = null;   /* 3D 에서 CSS 가 숨기는 class (리마스터3D.js 규칙넣기 의 <style id="g2-3d맵-규칙">) — 거기서 읽어 늘 맞춘다 */
  function 숨김꼴들() {
    if (숨김꼴) return 숨김꼴;
    var st = root.document && root.document.getElementById('g2-3d맵-규칙');
    if (!st) return [];
    var 글 = st.textContent || '', 목 = [], re = /\.g2-3d맵 \.([\w가-힣-]+)\s*[,{]/g, m;
    while ((m = re.exec(글))) 목.push(m[1]);
    숨김꼴 = 목; return 목;
  }
  function 그려지나(e, L) {
    var 꼴 = 숨김꼴들();
    for (var n = e; n && n !== L; n = n.parentElement) {
      var st = n.style;
      if (st.display === 'none' || st.visibility === 'hidden') return false;
      for (var i = 0; i < 꼴.length; i++) if (n.classList.contains(꼴[i])) return false;
    }
    return true;
  }
  /* clip-path 'inset(t r b l)' (px · 1~4 값 · round 없음) → [t, r, b, l] · 못 풀면 null */
  function 자름꼴(글) {
    var m = /^inset\(([^)]*)\)$/.exec(String(글).trim()); if (!m || /round|%/.test(m[1])) return null;
    var v = m[1].trim().split(/\s+/).map(function (x) { return 길이(x, NaN); });
    if (!v.length || v.some(function (x) { return !isFinite(x); })) return null;
    var t = v[0], r = v.length > 1 ? v[1] : t, b = v.length > 2 ? v[2] : t, l = v.length > 3 ? v[3] : r;
    return [t, r, b, l];
  }
  /* 요소 e 를 자르는 사각(e 판 단위 [x0,y0,x1,y1]) — e 와 조상(상자 c 까지)의 clip-path inset 을 e 좌표로 옮겨 겹침 · 없으면 null · 옮길 수 없으면(사이에 이동 아닌 변환) false */
  function 자름구하기(e, c, R) {
    var 사 = null;
    for (var A = e; A; A = A.parentElement) {
      var 꼴 = A.style.clipPath && A.style.clipPath !== 'none' ? 자름꼴(A.style.clipPath) : null;
      if (꼴) {
        var 크 = 크기(A, R), x = 0, y = 0;
        for (var n = e; n !== A; n = n.parentElement) {   /* A 좌표 → e 좌표: e 부터 A 아래까지 자리만 빼고 변환은 없어야 */
          var 국 = 국소(n, n.parentElement, 크기(n, R), R); if (국.없음 || !국.m.isIdentity) return false;
          var 자 = 자리(n, n.parentElement, R); if (자.없음) return false;
          x += 자.x; y += 자.y;
        }
        var r0 = [꼴[3] - x, 꼴[0] - y, 크.w - 꼴[1] - x, 크.h - 꼴[2] - y];
        사 = 사 ? [Math.max(사[0], r0[0]), Math.max(사[1], r0[1]), Math.min(사[2], r0[2]), Math.min(사[3], r0[3])] : r0;
      }
      if (A === c) break;
    }
    return 사;
  }
  /* filter 가 brightness(k) 만으로 됐으면 곱한 k · 다른 filter 면 null · 없으면 1 (정본 456 4단계)
   *   11-25 1-7 측정: spriteLayer 에 걸리는 filter 는 판 직속 brightness 둘뿐 — 맵 아이템 0.26 · 유닛 상자 0.4(어둡게) · 이 때문에 평상시에도 통째로 옛 길이었다 */
  function 밝기(st) {
    var f = st.filter; if (!f || f === 'none') return 1;
    /* ☠ 함수 하나라도 1 넘으면 옛 길 — 크롬은 함수마다 색을 0~1 로 자르고 상자 전체를 합친 뒤 걸어, 판마다 곱하면 겹친 자리·여러 함수에서 달라진다 (Codex 4단계 «꼭» 1) */
    var k = 1, 넘 = false, 남 = f.replace(/brightness\(\s*([0-9.]+)(%?)\s*\)/g, function (m0, v, 퍼) { var q = 퍼 ? +v / 100 : +v; if (q > 1) 넘 = true; k *= q; return ''; });
    return (!넘 && /^\s*$/.test(남) && isFinite(k) && k >= 0) ? k : null;
  }
  function 밝기곱(e, L) { var k = 1; for (var n = e; n && n !== L; n = n.parentElement) k *= 밝기(n.style); return k; }
  function 묶음속성(st) {   /* GPU 가 아직 못 그리는 속성 */
    if (밝기(st) === null) return 'filter';
    if (st.translate || st.rotate || st.scale) return '독립 변환';   /* translate·rotate·scale 속성은 행렬이 안 읽는다(1단계 범위 밖 · Codex) */
    if (st.opacity !== '' && +st.opacity < 1) return 'opacity';
    if (st.clipPath && st.clipPath !== 'none' && !자름꼴(st.clipPath)) return 'clip-path';   /* inset(…px) 만 그린다(잠김·솟음 — render.js:7625·7655) */
    if ((st.webkitMaskImage && st.webkitMaskImage !== 'none') || (st.maskImage && st.maskImage !== 'none')) return 'mask';
    if (st.mixBlendMode && st.mixBlendMode !== 'normal') return 'blend';
    return '';
  }
  var 층 = null, 그림보관 = null;
  /* 4-C 수명 — 전투가 바뀌거나(R 다름·캔버스 떨어짐) 문맥이 돌아오면 옛 층을 통째로 버리고(텍스처 지움·문맥 놓음·캔버스 뗌) 새로 만든다 */
  function 층버리기(x) {
    if (!x) return;
    var gl = x.gl;
    if (gl && !gl.isContextLost()) {
      if (x.판텍) x.판텍.forEach(function (v) { gl.deleteTexture(v.t); });
      var 놓기 = gl.getExtension('WEBGL_lose_context'); if (놓기) 놓기.loseContext();
    }
    if (x.cv && x.cv.parentNode) x.cv.parentNode.removeChild(x.cv);
  }
  function 층만들기(R) {
    if (층 && 층.R === R && !층.다시 && (층.cv.isConnected || !층.그린적)) return 층;
    /* 적재된 배경 그림은 문맥과 무관 — 같은 전투(R)면 새 층으로 넘겨 다시 받는 동안 옛 길로 가지 않게 · 전투가 바뀌면 버린다(Codex 3단계 «꼭» 2) */
    var 옛그림 = 그림보관 && 그림보관.R === R ? 그림보관.표 : null;
    층버리기(층); 층 = null;
    var d = root.document, cv = d.createElement('canvas');
    cv.className = 'g2-유닛GPU층';
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none;';
    var gl = cv.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, preserveDrawingBuffer: true });
    if (!gl) { 층 = { R: R, cv: cv, 실패: 'webgl2 없음' }; return 층; }
    function 셰(t, 글) { var s = gl.createShader(t); gl.shaderSource(s, 글); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
    /* 셰이더 이름은 영문만(GLSL 이 한글을 못 받음) — S 판 크기 · V host 크기 · T 무늬(배경 그림) 크기 · Rep 반복(0 없음 · 1 있음 · 2 판 가득(테두리는 가장자리 색)) ·
     *   E 테두리 부드럽게 하려고 판을 넓히는 양(판 단위) · K0~K3 화면(장치 px · 아래가 0) 네 변의 안쪽 거리식 · AA 테두리 섞기 켬 · C 잘라내기 사각(판 단위) · CL 잘라내기 켬
     *   테두리 섞기 = 크롬 합성기처럼 판을 반 픽셀 넘게 넓혀 그리고 픽셀마다 «판이 걸친 만큼»(변까지 거리 + 0.5)만 칠한다 (사장님 11-25 고르심 «크롬과 같게 맞춤») */
    var 꼭 = '#version 300 es\nin vec2 a;uniform mat4 M;uniform vec2 S;uniform vec2 V;uniform vec2 T;uniform vec2 E;uniform vec2 P;out vec2 uv;out vec2 lp;\n' +
            'void main(){vec2 l=vec2(mix(-E.x,S.x+E.x,a.x),mix(-E.y,S.y+E.y,a.y));vec4 p=M*vec4(l,0.,1.);lp=l;uv=(l-P)/T;gl_Position=vec4(p.x*2./V.x-p.w,p.w-p.y*2./V.y,0.,p.w);}';
    var 면 = '#version 300 es\nprecision highp float;in vec2 uv;in vec2 lp;uniform sampler2D t;uniform int Rep;uniform vec3 K0;uniform vec3 K1;uniform vec3 K2;uniform vec3 K3;uniform int AA;uniform vec4 C;uniform int CL;uniform float BR;out vec4 o;\n' +
            'void main(){if(CL==1&&(lp.x<C.x||lp.y<C.y||lp.x>C.z||lp.y>C.w))discard;float cv=1.;' +
            'if(AA==1){vec3 f=vec3(gl_FragCoord.xy,1.);float d=min(min(dot(K0,f),dot(K1,f)),min(dot(K2,f),dot(K3,f)));cv=clamp(d+.5,0.,1.);if(cv<=0.)discard;}' +
            'vec2 q=uv;if(Rep==0&&(q.x<0.||q.y<0.||q.x>1.||q.y>1.))discard;if(Rep==1)q=fract(q);if(Rep==2)q=clamp(q,0.,1.);o=texture(t,q)*cv;o.rgb=min(o.rgb*BR,vec3(o.a));}';
    var pr = gl.createProgram();
    try { gl.attachShader(pr, 셰(gl.VERTEX_SHADER, 꼭)); gl.attachShader(pr, 셰(gl.FRAGMENT_SHADER, 면)); gl.linkProgram(pr); } catch (e셰) { 층 = { R: R, cv: cv, gl: gl, 실패: String(e셰.message || e셰) }; return 층; }
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { 층 = { R: R, cv: cv, gl: gl, 실패: gl.getProgramInfoLog(pr) }; return 층; }
    var buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    var vao = gl.createVertexArray(); gl.bindVertexArray(vao); var la = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
    var 위치 = function (n) { return gl.getUniformLocation(pr, n); };
    층 = { R: R, cv: cv, gl: gl, pr: pr, vao: vao, 위: { M: 위치('M'), 크: 위치('S'), 호: 위치('V'), 무늬: 위치('T'), 반복: 위치('Rep'), 넓힘: 위치('E'), 변: [위치('K0'), 위치('K1'), 위치('K2'), 위치('K3')], 섞기: 위치('AA'), 밝기: 위치('BR'), 무늬자리: 위치('P'), 자름: 위치('C'), 자름켬: 위치('CL') },
          그림: 옛그림 || new Map(), 판텍: new Map(), 장: 0, 잃음: false };
    그림보관 = { R: R, 표: 층.그림 };
    cv.addEventListener('webglcontextlost', function (ev) { ev.preventDefault(); if (층 && 층.cv === cv) 층.잃음 = true; });
    /* 돌아오면 다음 장에 새 층을 만든 뒤에만 넘긴다(그 전까지는 옛 길) */
    cv.addEventListener('webglcontextrestored', function () { if (층 && 층.cv === cv) 층.다시 = true; });
    return 층;
  }
  /* 배경 그림 주소 → 적재된 그림(없으면 적재 시작하고 null) */
  function 배경그림(주소) {
    var 표 = 층.그림, x = 표.get(주소);
    if (x) return x.다 ? x : null;
    x = { 다: false, im: new root.Image() }; 표.set(주소, x);
    x.im.onload = function () { x.다 = true; }; x.im.onerror = function () { x.다 = false; x.실패 = true; };
    x.im.src = 주소;
    return null;
  }
  function 텍스처(원천, 부드럽게, 반복) {
    var gl = 층.gl, 키 = 원천, v = 층.판텍.get(키), t = v && v.t;
    if (!v) { t = gl.createTexture(); v = { t: t }; 층.판텍.set(키, v); }
    v.장 = 층.장;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, 원천);   /* 3단계: 장마다 올림(바뀜 알림은 6단계) */
    var f = 부드럽게 ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
    var w = 반복 ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, w); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, w);
    return t;
  }
  /* 단색 1×1 캔버스 — 색 글자마다 하나(사망 파편 조각 색) · 2048 넘으면 비운다 */
  var 색표 = new Map();
  function 색캔버스(색) {
    var c = 색표.get(색); if (c) return c;
    if (색표.size > 2048) 색표.clear();
    c = root.document.createElement('canvas'); c.width = c.height = 1;
    var g = c.getContext('2d'); if (!g) return null; g.fillStyle = 색; g.fillRect(0, 0, 1, 1);
    색표.set(색, c); return c;
  }
  function 쌓임(e) { var z = parseFloat(e.style.zIndex); return isFinite(z) ? z : 0; }
  /* 판 안 그릴 것 모으기 — [{ e, 원천, 부드럽게, 무늬w, 무늬h, 반복, 깊이, 차례 }] · 못 그리면 { 옛길: 까닭 } */
  function 그릴것(R) {
    var L = 판(R), 목 = [], 직속 = Array.prototype.slice.call(L.children);
    직속 = 직속.map(function (c, i) { return { c: c, z: 쌓임(c), i: i }; }).sort(function (a, b) { return (a.z - b.z) || (a.i - b.i); });
    for (var k = 0; k < 직속.length; k++) {
      var c = 직속[k].c;
      if (!그려지나(c, L)) continue;
      var 묶 = 묶음속성(c.style); if (묶) return { 옛길: 묶 + ' (' + c.className + ')' };
      var 안 = [c].concat(Array.prototype.slice.call(c.querySelectorAll('*'))), 판목 = [];
      for (var j = 0; j < 안.length; j++) {
        var e = 안[j];
        if (!그려지나(e, L)) continue;
        var st = e.style, 묶2 = 묶음속성(st); if (묶2) return { 옛길: 묶2 + ' (' + e.className + ')' };
        /* 배경색만 있는 판(사망 파편 1×1 조각 render.js 연출픽셀파편초기화)은 단색 텍스처로 그린다 · 배경색에 그림이 겹치거나 테두리·글자는 옛 길 (4단계) */
        var 색 = (st.backgroundColor && st.backgroundColor !== 'transparent' && st.backgroundColor !== 'rgba(0, 0, 0, 0)') ? st.backgroundColor : '';
        if ((색 && st.backgroundImage && st.backgroundImage !== 'none') || (st.border && st.borderStyle !== 'none' && st.borderStyle !== '') || (e.childNodes.length && Array.prototype.some.call(e.childNodes, function (n) { return n.nodeType === 3 && n.textContent.trim(); })))
          return { 옛길: '배경색·테두리·글자 (' + e.className + ')' };
        var 자리px = [0, 0];
        var 원천 = null, 부드럽게 = true, mw = 0, mh = 0, 반복 = 0;
        var 크 = 크기(e, R);
        if (e.tagName === 'CANVAS') { if (!e.width || !e.height) continue; 원천 = e; mw = 크.w; mh = 크.h; 부드럽게 = st.imageRendering !== 'pixelated'; }
        else if (e.tagName === 'IMG') { if (!e.complete || !e.naturalWidth) return { 옛길: '그림 적재 중' }; 원천 = e; mw = 크.w; mh = 크.h; 부드럽게 = st.imageRendering !== 'pixelated'; }
        else if (st.backgroundImage && st.backgroundImage !== 'none') {
          var mt = /^url\("?(.*?)"?\)$/.exec(st.backgroundImage); if (!mt) return { 옛길: '배경 그림 꼴 (' + e.className + ')' };
          /* 배경 자리 — px 두 값만(사망 파편 1픽셀 창 · -sx -sy) · % 등은 옛 길 */
          var bp = (st.backgroundPosition || '').trim(), bpm = /^(-?[0-9.]+)(px)? (-?[0-9.]+)(px)?$/.exec(bp);
          if (bp && !/^0(px|%)? 0(px|%)?$/.test(bp)) { if (!bpm || (bpm[1] !== '0' && !bpm[2]) || (bpm[3] !== '0' && !bpm[4])) return { 옛길: '배경 자리 (' + e.className + ')' }; 자리px = [+bpm[1], +bpm[3]]; }
          var x = 배경그림(mt[1]); if (!x) return { 옛길: '배경 그림 적재 중' };
          var bs = (st.backgroundSize || '').split(/\s+/); mw = 길이(bs[0], 크.w); mh = 길이(bs[1] || bs[0], 크.h);
          if (!(mw > 0 && mh > 0)) { mw = x.im.naturalWidth; mh = x.im.naturalHeight; if (st.backgroundSize && st.backgroundSize !== 'auto') return { 옛길: '배경 크기 꼴 (' + e.className + ')' }; }
          반복 = (st.backgroundRepeat === 'no-repeat') ? 0 : (st.backgroundRepeat === '' || st.backgroundRepeat === 'repeat') ? 1 : -1;
          if (반복 < 0) return { 옛길: '배경 반복 꼴 (' + e.className + ')' };
          원천 = x.im; 부드럽게 = st.imageRendering !== 'pixelated' && !(e.closest && e.closest('[style*="pixelated"]'));
        } else if (색) { 원천 = 색캔버스(색); if (!원천) return { 옛길: '배경색 꼴 (' + 색 + ')' }; mw = 크.w; mh = 크.h; 부드럽게 = false; }
        else continue;
        var 행 = 행렬(e, R); if (행.없음) return { 옛길: '행렬 ' + 행.없음 };
        /* 상자 안 앞뒤 = 상자 기준 판의 z(앞으로 띄운 양) — ☠ 처음엔 판 가운데 점 깊이로 갈라 틀렸다: 세운 판은 위쪽일수록 멀어 머리 위 턴 마커(translateZ 1px)가 몸 뒤로 갔다(11-25 1-7) */
        var 판z = 0;
        if (입체(c) && e !== c) { var 상대 = 상자기준(e, c, R); if (!상대) return { 옛길: '상자 안 판이 상자와 나란하지 않음 (' + e.className + ')' }; 판z = 상대.z; }
        var 자름 = 자름구하기(e, c, R); if (자름 === false) return { 옛길: '잘라내기를 판 좌표로 못 옮김 (' + e.className + ')' };
        /* 제 층 — 크롬은 변환이 걸린 판(또는 판 직속)만 따로 합성하고 그 층 바깥 테두리만 섞는다 · 변환 없이 상자 안에 든 캔버스는 상자 층에 함께 그려져 테두리 섞기 없음
         *   (11-25 2-4A: 모든 판 테두리를 섞자 말 몸 캔버스 이음매마다 줄이 생겨 차이 532 → 2,956) */
        var 국e = 국소(e, e.parentElement, 크, R), 제층 = e.parentElement === L || (국e.m && !국e.m.isIdentity);
        판목.push({ e: e, 원천: 원천, 부드럽게: 부드럽게, mw: mw, mh: mh, 반복: 반복, m: 행.m, w: 크.w, h: 크.h, 판z: 판z, 쌓: 판안쌓임(e, c), 차례: j, 자름: 자름, 제층: 제층, 밝: 밝기곱(e, L), 자리px: 자리px });
      }
      if (입체(c) && 판목.length > 1) {
        /* 상자의 +z 가 카메라 쪽인가 — 상자 원점에서 z 로 1 나간 점이 화면 w 가 작으면(가까우면) +z 가 앞 */
        var 상행 = 행렬(c, R); if (상행.없음) return { 옛길: '행렬 ' + 상행.없음 };
        var w0 = 상행.m.transformPoint(new root.DOMPoint(0, 0, 0, 1)).w, w1 = 상행.m.transformPoint(new root.DOMPoint(0, 0, 1, 1)).w, 앞쪽 = w1 < w0 ? 1 : -1;
        판목.sort(function (a, b) { var d = 앞쪽 * (a.판z - b.판z); if (Math.abs(d) > 1e-6) return d; return 쌓비교(a.쌓, b.쌓) || (a.차례 - b.차례); });
      } else 판목.sort(function (a, b) { return 쌓비교(a.쌓, b.쌓) || (a.차례 - b.차례); });
      for (var q = 0; q < 판목.length; q++) 목.push(판목[q]);
    }
    return { 목: 목 };
  }
  /* 상자 기준 판 — 상자 안 요소의 변환을 상자 좌표로 곱해(평면 부모 아래는 z 버림) 판이 상자와 나란하면 { z } · 아니면 null */
  function 상자기준(e, 상자, R) {
    var 길 = [];
    for (var n = e; n && n !== 상자; n = n.parentElement) 길.unshift(n);
    var M = new root.DOMMatrix(), 부모 = 상자;
    for (var i = 0; i < 길.length; i++) {
      var 나 = 길[i];
      if (부모 !== 상자 && !입체(부모)) M = M.multiply(평면화);
      var 자 = 자리(나, 부모, R), 크 = 크기(나, R);
      if (자.없음 || !(크.w >= 0 && 크.h >= 0)) return null;
      var 국 = 국소(나, 부모, 크, R); if (국.없음) return null;
      M = M.translate(자.x, 자.y).multiply(국.m);
      부모 = 나;
    }
    if (Math.abs(M.m13) > 1e-9 || Math.abs(M.m23) > 1e-9) return null;   /* 판의 x·y 축이 z 로 기울면 나란하지 않음 */
    return { z: M.m43 };
  }
  /* 상자 안 쌓임 열쇠 — 상자 바로 아래 조상부터 그 요소까지 z-index 줄 (같은 평면에서 z-index → DOM) */
  function 판안쌓임(e, 상자) { var 줄 = []; for (var n = e; n && n !== 상자; n = n.parentElement) 줄.unshift(쌓임(n)); return 줄; }
  function 쌓비교(a, b) { for (var i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] - b[i]; return 0; }

  /** 한 장 그리기 — 그렸으면 true(spriteLayer 는 감춤) · 옛 길이면 false(spriteLayer 보임 · GPU 캔버스 감춤) */
  /* 그리다가 오류가 나면 그 장부터 옛 길 — 이미 숨긴 spriteLayer 를 되살린다(Codex 3단계 «꼭» 1: 화면을 비운 뒤 텍스처 올리기에서 예외 → 유닛이 사라진 채 남음) */
  function 그리기(R) {
    try { return 그리기안(R); }
    catch (e오) {
      if (층) { 층.마지막 = '오류 ' + (e오 && e오.message); if (층.cv) 층.cv.style.display = 'none'; }
      var L오 = 판(R || root.R); if (L오 && L오._유닛GPU감춤) { L오.style.visibility = ''; L오._유닛GPU감춤 = false; }
      return false;
    }
  }
  function 그리기안(R) {
    R = R || root.R;
    var L = 판(R), 켬 = !!root.__유닛GPU그림 && 쓸까(R);
    /* 끄거나 3D 가 아니면 층을 버린다(텍스처 지움·문맥 놓음·캔버스 뗌) — 감추기만 하면 옛 전투의 렌더러·텍스처가 남았다(Codex 3단계 «꼭» 2) */
    if (!켬) { if (층) { 층버리기(층); 층 = null; } if (R && R !== (그림보관 && 그림보관.R)) 그림보관 = null; if (L && L.style.visibility === 'hidden' && L._유닛GPU감춤) { L.style.visibility = ''; L._유닛GPU감춤 = false; } return false; }
    층만들기(R);
    if (층.cv.parentNode !== R.host || 층.cv.nextSibling !== L) R.host.insertBefore(층.cv, L);   /* spriteLayer 바로 앞 = 같은 차례 */
    var 옛 = function (까닭) { 층.마지막 = 까닭; 층.cv.style.display = 'none'; if (L._유닛GPU감춤) { L.style.visibility = ''; L._유닛GPU감춤 = false; } return false; };
    if (층.실패) return 옛('GPU 준비 실패: ' + 층.실패);
    if (층.잃음 || 층.gl.isContextLost()) return 옛('GPU 문맥 잃음');
    var 결; 묶음시작();
    try { 결 = 그릴것(R); } finally { 묶음끝(); }
    if (결.옛길) return 옛(결.옛길);
    var 호 = R.호스트크기 ? R.호스트크기() : { w: R.host.clientWidth, h: R.host.clientHeight }, 배 = root.devicePixelRatio || 1;
    var W = Math.max(1, Math.round(호.w * 배)), H = Math.max(1, Math.round(호.h * 배)), cv = 층.cv, gl = 층.gl;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(층.pr); gl.bindVertexArray(층.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   /* 미리 곱한 알파 source-over */
    gl.uniform2f(층.위.호, 호.w, 호.h); gl.activeTexture(gl.TEXTURE0);
    var 섞기켬 = !root.__유닛GPU테두리끔;   /* 테두리 섞기 끄기(견줌·진단용) */
    층.장++; 층.그린적 = true;
    /* 텍스처 수명 — 300장(약 5초) 안 쓴 판(죽어 떨어진 몸 캔버스 등)의 텍스처를 지운다 · 60장마다 훑음 */
    if (층.장 % 60 === 0) 층.판텍.forEach(function (v, 키) { if (층.장 - v.장 > 300) { gl.deleteTexture(v.t); 층.판텍.delete(키); } });
    층.그린판 = 결.목.map(function (q) { return q.e; });   /* 진단 — 그린 차례대로 요소 */
    층.외곽 = [];   /* 진단 — 그린 판의 화면 네 꼭짓점(장치 px · 위가 0) · 관문이 «테두리 차이»를 가를 때 쓴다 */
    for (var i = 0; i < 결.목.length; i++) {
      var p = 결.목[i];
      /* 판 가득 무늬(배경 그림 크기 = 판 크기 · 캔버스·그림)면 Rep 2 — 넓힌 테두리 바깥은 가장자리 색으로 */
      var 가득 = p.반복 === 0 && Math.abs(p.mw - p.w) < 1e-6 && Math.abs(p.mh - p.h) < 1e-6;
      텍스처(p.원천, p.부드럽게, p.반복 === 1);
      gl.uniformMatrix4fv(층.위.M, false, p.m.toFloat32Array());
      gl.uniform2f(층.위.크, p.w, p.h); gl.uniform2f(층.위.무늬, p.mw, p.mh); gl.uniform1i(층.위.반복, 가득 ? 2 : p.반복);
      /* 테두리 섞기 — 화면(장치 px) 네 꼭짓점으로 변 거리식 · 넓히는 양 = 판 단위로 장치 2px 남짓(원근으로 줄어든 변 기준) */
      var 점 = [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]].map(function (q) { var r = p.m.transformPoint(new root.DOMPoint(q[0], q[1], 0, 1)); return [r.x / r.w * 배, H - r.y / r.w * 배]; });
      var 쓸섞기 = 섞기켬 && p.제층 && (가득 || p.반복 === 1) && 점.every(function (q) { return isFinite(q[0]) && isFinite(q[1]); });
      if (쓸섞기) {
        var 가x = (점[0][0] + 점[1][0] + 점[2][0] + 점[3][0]) / 4, 가y = (점[0][1] + 점[1][1] + 점[2][1] + 점[3][1]) / 4, 최가로 = Infinity, 최세로 = Infinity;   /* 짧은 변(원근으로 줄어든 쪽) 기준 — 넓힘이 모자라지 않게 */
        for (var k = 0; k < 4; k++) {
          var A = 점[k], B = 점[(k + 1) & 3], nx = A[1] - B[1], ny = B[0] - A[0], 길 = Math.sqrt(nx * nx + ny * ny) || 1; nx /= 길; ny /= 길;
          var c = -(nx * A[0] + ny * A[1]); if (nx * 가x + ny * 가y + c < 0) { nx = -nx; ny = -ny; c = -c; }
          gl.uniform3f(층.위.변[k], nx, ny, c);
          if (k === 0 || k === 2) 최가로 = Math.min(최가로, 길); else 최세로 = Math.min(최세로, 길);
        }
        gl.uniform2f(층.위.넓힘, Math.min(p.w, 2 * p.w / Math.max(1e-6, 최가로)), Math.min(p.h, 2 * p.h / Math.max(1e-6, 최세로)));
        gl.uniform1i(층.위.섞기, 1);
      } else { gl.uniform2f(층.위.넓힘, 0, 0); gl.uniform1i(층.위.섞기, 0); }
      if (p.자름) { gl.uniform4f(층.위.자름, p.자름[0], p.자름[1], p.자름[2], p.자름[3]); gl.uniform1i(층.위.자름켬, 1); } else gl.uniform1i(층.위.자름켬, 0);
      gl.uniform1f(층.위.밝기, p.밝); gl.uniform2f(층.위.무늬자리, p.자리px[0], p.자리px[1]);   /* brightness(k) — 미리 곱한 색에 k 를 곱하고 알파로 자른다(1 넘으면 흰색 쪽으로 · 4단계) */
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      층.외곽.push(점.map(function (q) { return [q[0], H - q[1]]; }));
    }
    층.마지막 = '그림 ' + 결.목.length;
    cv.style.display = '';
    if (L.style.visibility !== 'hidden') { L.style.visibility = 'hidden'; L._유닛GPU감춤 = true; }
    return true;
  }
  function 상태() { return 층 ? { 마지막: 층.마지막 || '', 실패: 층.실패 || '', 잃음: !!층.잃음, 텍스처: 층.판텍 ? 층.판텍.size : 0 } : null; }
  function 외곽() { return 층 && 층.외곽 ? 층.외곽 : []; }

  /* 장마다 다시 그림 — 캔버스 그림이 반영(apply) 없이 바뀌어도 따라가게 (3단계 · 끄면 한 번 되돌리고 멈춤) */
  var 고리돎 = false;
  function 매장() {
    if (!root.__유닛GPU그림) { 고리돎 = false; try { 그리기(root.R); } catch (e끔) {} return; }
    try { 그리기(root.R); } catch (e그) { if (층) 층.마지막 = '오류 ' + (e그 && e그.message); }
    root.requestAnimationFrame(매장);
  }
  function 고리시작() { if (고리돎 || !root.__유닛GPU그림) return; 고리돎 = true; root.requestAnimationFrame(매장); }

  root.G2유닛GPU층 = { 그리기: function (R) { 고리시작(); return 그리기(R); }, 상태: 상태, 외곽: 외곽, 그린판: function () { return 층 && 층.그린판 || []; }, 묶음시작: 묶음시작, 묶음끝: 묶음끝, 행렬: 행렬, 꼭짓점: 꼭짓점, 쓸까: 쓸까, 사각: 사각, 화면사각: 화면사각, 점들어감: 점들어감, 점유닛후보: 점유닛후보, _길이: 길이 };
})(typeof window !== 'undefined' ? window : this);
