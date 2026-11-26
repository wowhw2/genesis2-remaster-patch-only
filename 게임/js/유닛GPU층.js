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

  /* 6단계 — 캔버스 바뀜 번호: 2D 그리기(그림 옮김·픽셀 넣기·칠하기·지우기·글자)와 크기 바꾸기(내용이 지워진다)마다 canvas._gp판번 을 올린다
   *   GPU 층은 번호가 그대로인 캔버스를 다시 올리지 않는다(텍스처) · 2D·bitmaprenderer 밖 맥락(WebGL 등)으로 그리는 캔버스는 _gp맥락밖 — 장마다 올림
   *   스케일러(scaler.js)·팔레트 GPU(palettegpu.js:279 drawImage)가 drawImage 를 감싸도 어느 차례든 이 감쌈을 지난다 · 실패하면 조용히 — 번호가 없으면 장마다 올림 */
  var 캔번 = 0;
  (function 캔버스바뀜감시() {
    try {
      var 감싸 = function (P, 이름들) {
        if (!P) return;
        이름들.forEach(function (k) {
          var 원 = P[k]; if (typeof 원 !== 'function' || 원._gp감쌈) return;
          var 새 = function () { var c = this && this.canvas; if (c) c._gp판번 = ++캔번; return 원.apply(this, arguments); };
          새._gp감쌈 = true; P[k] = 새;
        });
      };
      감싸(root.CanvasRenderingContext2D && root.CanvasRenderingContext2D.prototype,
        ['drawImage', 'putImageData', 'fillRect', 'clearRect', 'strokeRect', 'fill', 'stroke', 'fillText', 'strokeText', 'reset']);
      감싸(root.ImageBitmapRenderingContext && root.ImageBitmapRenderingContext.prototype, ['transferFromImageBitmap']);
      var CP = root.HTMLCanvasElement && root.HTMLCanvasElement.prototype;
      if (!CP) return;
      ['width', 'height'].forEach(function (k) {
        var d = Object.getOwnPropertyDescriptor(CP, k); if (!d || !d.set || d.set._gp감쌈) return;
        var s = function (v) { this._gp판번 = ++캔번; return d.set.call(this, v); }; s._gp감쌈 = true;
        Object.defineProperty(CP, k, { configurable: true, enumerable: d.enumerable, get: d.get, set: s });
      });
      var 원gc = CP.getContext;
      if (원gc && !원gc._gp감쌈) {
        var gc = function (종류) { var r = 원gc.apply(this, arguments); if (r && 종류 !== '2d' && 종류 !== 'bitmaprenderer') this._gp맥락밖 = true; return r; };
        gc._gp감쌈 = true; CP.getContext = gc;
      }
    } catch (e감시) {}
  })();
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
  /* ★ 가벼운 4×4 행렬 «행» — DOMMatrix 와 같은 쓰임새(m11~m44 · multiply · translate · transformPoint · toFloat32Array · isIdentity)
   *   ☠ DOMMatrix 는 셈 한 번마다 브라우저 바깥 객체를 새로 만들어 무겁다 — 2-4A 스크롤 휴대폰 흉내에서 계산식 재기(A 33~41ms)가
   *     브라우저 강제 배치(A0 26~30ms)보다 무거웠다(11-26) · 글자 풀이만 DOMMatrix 로 한 번 하고 담는다
   *   m{열}{행} — DOMMatrix 와 같은 이름 · a[(열−1)×4 + (행−1)] (열 우선 · toFloat32Array 차례와 같음) */
  function 행(a) { this.a = a || new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  (function () {
    for (var c = 1; c <= 4; c++) for (var r = 1; r <= 4; r++) (function (i) {
      Object.defineProperty(행.prototype, 'm' + c + r, { get: function () { return this.a[i]; }, set: function (v) { this.a[i] = v; } });
    })((c - 1) * 4 + (r - 1));
  })();
  행.에서 = function (d) { return new 행(new Float64Array(d.toFloat64Array())); };
  행.prototype.multiply = function (B) {   /* this × B */
    var x = this.a, y = B.a, o = new Float64Array(16);
    for (var c = 0; c < 4; c++) { var y0 = y[c * 4], y1 = y[c * 4 + 1], y2 = y[c * 4 + 2], y3 = y[c * 4 + 3];
      o[c * 4] = x[0] * y0 + x[4] * y1 + x[8] * y2 + x[12] * y3; o[c * 4 + 1] = x[1] * y0 + x[5] * y1 + x[9] * y2 + x[13] * y3;
      o[c * 4 + 2] = x[2] * y0 + x[6] * y1 + x[10] * y2 + x[14] * y3; o[c * 4 + 3] = x[3] * y0 + x[7] * y1 + x[11] * y2 + x[15] * y3; }
    return new 행(o);
  };
  행.prototype.translate = function (tx, ty, tz) {   /* this × T(tx, ty, tz) */
    tx = tx || 0; ty = ty || 0; tz = tz || 0; var x = this.a, o = new Float64Array(x);
    for (var r = 0; r < 4; r++) o[12 + r] = x[r] * tx + x[4 + r] * ty + x[8 + r] * tz + x[12 + r];
    return new 행(o);
  };
  행.prototype.transformPoint = function (p) {
    var x = this.a, px = p.x || 0, py = p.y || 0, pz = p.z || 0, pw = p.w == null ? 1 : p.w;
    return { x: x[0] * px + x[4] * py + x[8] * pz + x[12] * pw, y: x[1] * px + x[5] * py + x[9] * pz + x[13] * pw,
             z: x[2] * px + x[6] * py + x[10] * pz + x[14] * pw, w: x[3] * px + x[7] * py + x[11] * pz + x[15] * pw };
  };
  행.prototype.toFloat32Array = function () { return new Float32Array(this.a); };
  Object.defineProperty(행.prototype, 'isIdentity', { get: function () { var x = this.a; for (var i = 0; i < 16; i++) if (x[i] !== (i % 5 === 0 ? 1 : 0)) return false; return true; } });
  /* 변환 문자열 → 행 (var 없는 것만 · DOMMatrix 가 % 를 못 받으면 모름) */
  /* 글자 → 행렬 풀이를 담아 둔다 — 카메라가 움직이면 같은 --w 글자를 판마다 수십 번 다시 풀었다(6단계 앞당김 · 풀어 낸 행렬은 아무도 제자리에서 안 바꾼다) */
  var 풀이표 = new Map(), 단위행렬 = null;
  function 변환(문) {
    if (!문 || 문 === 'none') return 단위행렬 || (단위행렬 = new 행());
    var m = 풀이표.get(문); if (m !== undefined) return m;
    try { m = 행.에서(new root.DOMMatrix(문)); } catch (e) { m = null; }
    if (풀이표.size > 4000) 풀이표.clear();
    풀이표.set(문, m); return m;
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
      return { m: new 행().translate(-pl, -pt).multiply(W).translate(pl, pt).translate(ox, oy).multiply(L).translate(-ox, -oy) };
    }
    var X = 변환(문);
    if (!X) return { 없음: '변환 풀이 못 함: ' + String(문).slice(0, 60) };
    if (X.isIdentity) return { m: X };
    var o = (st.transformOrigin || '50% 50%').split(/\s+/);
    var ox2 = 원점값(o[0], 크.w), oy2 = 원점값(o[1] == null ? '50%' : o[1], 크.h), oz = o[2] != null ? 길이(o[2], 0) : 0;
    if (!(isFinite(ox2) && isFinite(oy2) && isFinite(oz))) return { 없음: '변환 원점 모름: ' + st.transformOrigin };
    return { m: new 행().translate(ox2, oy2, oz).multiply(X).translate(-ox2, -oy2, -oz) };
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
    var P = new 행(); P.m34 = -1 / d;
    return { m: new 행().translate(px, py).multiply(P).translate(-px, -py) };
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
  var 평면화 = (function () { var F = new 행(); F.m33 = 0; return F; })();   /* z 를 버린다 — 평면(flat) 부모가 자식의 3D 를 제 판에 눕힐 때 */

  /* 묶음 — 쓰기가 끝난 «읽기 구간»에서만 요소별 행렬을 담아 다시 쓴다(부모 줄을 요소마다 처음부터 곱하지 않게 · 2단계 빠르기)
   *   묶음시작() 과 묶음끝() 사이에 스타일을 쓰면 안 된다 — 유닛띄우기 두 번째 고리·클릭 후보처럼 읽기만 하는 곳에서만 */
  var 묶음 = null;
  /* 변화 관찰 — 판 안 요소의 속성(스타일·크기)이 바뀌면 그 요소에 «바뀐 차례» 번호(_gp판)를 찍는다 · 몫 담기의 열쇠
   *   ☠ 처음엔 요소마다 cssText 전체를 글자로 엮어 열쇠로 썼다 — 브라우저가 매번 스타일을 글자로 풀어 행렬 함수가 스크롤 시간의 9% (11-26) */
  /* 세대 — 모듈을 다시 실어도(시험 도구가 부품을 새로 넣음) 요소에 남은 옛 몫과 열쇠가 겹치지 않게 모듈마다 다른 머리 */
  var 관찰 = null, 관찰판 = null, 판시각 = 0, 관찰세대 = 0, 세대머리 = Math.random().toString(36).slice(2) + '/';
  function 변화받기(L) {
    if (!L || !root.MutationObserver || root.__유닛GPU관찰끔) return;
    /* ☠ 콜백을 빈 함수로 두면 마이크로태스크마다 기록이 콜백으로 넘어가 버려진다 — takeRecords 는 그 뒤 것만 준다(11-26 밝기 관문: 바꾼 filter 를 못 보고 옛 몫을 씀) ⇒ 콜백에서도 찍는다 */
    if (관찰판 !== L) { if (관찰) 관찰.disconnect(); 관찰 = new root.MutationObserver(찍기); 관찰.observe(L, { attributes: true, childList: true, subtree: true }); 관찰판 = L; 관찰세대++; }
    찍기(관찰.takeRecords());
  }
  function 찍기(기록) {
    /* 속성이 바뀐 요소는 자기 번호(_gp판) · 그 조상(판 아래까지)과 자식이 바뀐 요소는 «아래 바뀜» 번호(_gp아래) — 상자 계획 담기의 열쇠 */
    for (var i = 0; i < 기록.length; i++) {
      var r = 기록[i], t = r.target, n = ++판시각;
      if (r.type === 'attributes') t._gp판 = n;
      for (var q = r.type === 'attributes' ? t.parentElement : t; q && q !== 관찰판; q = q.parentElement) q._gp아래 = n;
    }
  }
  /* 묶음 안에서는 장 단위 담기 조건(호스트 크기·장 시각·관찰 번호)을 묶음 시작 뒤 처음 한 번만 본다 — 행렬마다 다시 보느라 장담받기·호스트크기가 5%(11-26 18-1 프로파일) */
  var 묶음장담;
  function 묶음시작() { 변화받기(판(root.R)); 묶음 = new Map(); 묶음장담 = undefined; }
  function 묶음끝() { 묶음 = null; 묶음장담 = undefined; }

  /** 요소 → { m, w, h } — m 은 요소 안 (x, y, 0, 1) 을 host 안 CSS px 동차 좌표로 (원근 나눔 전) · 부모 행렬 × 자기 몫(같은 곱 · 순서만 묶음) */
  /* 6단계 — 장 단위 행렬 담기: 판 안에 바뀐 것이 없으면(변화 관찰 번호·세대 그대로 · 호스트 크기 같음 · 같은 장) 그 장에 센 행렬을 다시 쓴다
   *   한 장 안에서 유닛띄우기(가림 사각)·GPU 그리기·매 장 고리·재는 점이 같은 요소 행렬을 저마다 처음부터 셌다
   *   (11-26 18-1 휴대폰 흉내 GPU 켬 프로파일: 행렬 포함 28% · 자기 11.8% — 열쇠 글자 짓기·스타일 읽기) · 그림 자연 크기(img 적재)는 관찰 밖이라 «같은 장»으로 묶는다 · 끄기 __유닛GPU장담끔 */
  var 장담 = null, 장담판 = null, 장담시각 = -1, 장담세대 = -1, 장담호 = null, 장담w = -1, 장담h = -1, 장담장 = null;
  function 장담받기(R, L) {
    if (묶음 && 묶음장담 !== undefined && (묶음장담 === null || 장담판 === L)) return 묶음장담;
    var 답 = 장담받기속(R, L); if (묶음) 묶음장담 = 답; return 답;
  }
  function 장담받기속(R, L) {
    if (root.__유닛GPU장담끔 || !root.MutationObserver || root.__유닛GPU관찰끔) return null;
    if (!묶음) 변화받기(L);
    if (!관찰 || 관찰판 !== L) return null;
    var 호 = R.호스트크기 ? R.호스트크기() : null, 지금 = root.document && root.document.timeline ? root.document.timeline.currentTime : null;
    if (!장담 || 장담판 !== L || 장담시각 !== 판시각 || 장담세대 !== 관찰세대 || 장담호 !== 호 || (호 && (장담w !== 호.w || 장담h !== 호.h)) || 장담장 !== 지금) {
      셈.장담새로++; 장담 = new Map(); 장담판 = L; 장담시각 = 판시각; 장담세대 = 관찰세대; 장담호 = 호; 장담w = 호 ? 호.w : -1; 장담h = 호 ? 호.h : -1; 장담장 = 지금;
    }
    return 장담;
  }
  /* 판 직속 빠른 길의 앞(pre)·뒤(B) — 평면 대열 고정 틀(render.js:6762 · 원점 0 0)·절대 배치일 때만 · 아니면 { 일반: true } (보통 길로) */
  function 틀만들기(e, L, R) {
    var st = e.style, 문 = st.transform;
    if (!(st.position === 'absolute' || st.position === 'fixed')) return { 일반: true };
    if (!문 || 문.indexOf('var(') < 0 || st.transformOrigin !== '0px 0px' || 문.replace(/\s+/g, '') !== 고정틀) return { 일반: true };
    var 원 = 원근(L, R); if (원 && 원.없음) return { 일반: true };
    var 자 = 자리(e, L, R); if (자.없음) return { 일반: true };
    var 크 = 크기(e, R); if (!(크.w >= 0 && 크.h >= 0)) return { 일반: true };
    var 변 = function (k) { return st.getPropertyValue(k).trim(); };
    var pl = 길이(변('--pl'), NaN), pt = 길이(변('--pt'), NaN), ox = 길이(변('--ox'), NaN), oy = 길이(변('--oy'), NaN);
    if (!(isFinite(pl) && isFinite(pt) && isFinite(ox) && isFinite(oy))) return { 일반: true };
    var Lm = 변환(변('--loc') || 'none'); if (!Lm) return { 일반: true };
    var pre = (원 ? 원.m.translate(자.x, 자.y) : new 행().translate(자.x, 자.y)).translate(-pl, -pt);
    return { pre: pre, B: new 행().translate(pl + ox, pt + oy).multiply(Lm).translate(-ox, -oy), w: 크.w, h: 크.h };
  }
  /* 판의 --w(카메라) 행렬 — 판 변화 관찰 번호·세대가 같으면 다시 안 읽는다 */
  var W담 = { 판: null, 시각: -1, 세대: -1, W: null };
  function 판W(L) {
    if (W담.판 === L && W담.시각 === 판시각 && W담.세대 === 관찰세대) return W담.W;
    W담 = { 판: L, 시각: 판시각, 세대: 관찰세대, W: 변환(L.style.getPropertyValue('--w').trim()) };
    return W담.W;
  }
  function 행렬(e, R) {
    R = R || root.R;
    var L = 판(R), 장 = (L && e && e !== L) ? 장담받기(R, L) : null;
    if (장) { var 든 = 장.get(e); if (든) return 든; }
    var r = 행렬계산(e, R, L);
    if (장) 장.set(e, r);
    return r;
  }
  var 셈 = { 행렬계산: 0, 장담새로: 0 };   /* 진단 — 성능 재기용 셈 */
  function 행렬계산(e, R, L) {
    셈.행렬계산++;
    if (!L || !e) return { 없음: '판 없음' };
    if (e === L) return { 없음: '판 자체' };
    if (묶음 && 묶음.has(e)) return 묶음.get(e);
    var 부모 = e.parentElement, 앞;
    if (!부모) return { 없음: '판 밖 요소' };
    if (부모 === L) {
      var 판자리 = 자리(L, null, R);
      if (판자리.없음) return 판자리;
      if (L.style.transform && L.style.transform !== 'none') return { 없음: '판 자체 변환' };
      앞 = { m: new 행().translate(판자리.x, 판자리.y) };
    } else {
      앞 = 행렬(부모, R);
      if (앞.없음) return 앞;
    }
    var M = 앞.m;
    /* 6단계 — 판 직속(유닛 상자·맵 아이템) 빠른 길: 몫 = 앞몫·T(자리)·T(−pl,−pt) × W(판 --w · 카메라) × T(pl+ox, pt+oy)·loc·T(−ox,−oy)
     *   카메라가 움직이면 --w 만 바뀐다 — 앞(pre)·뒤(B)는 상자 자신의 인라인 스타일이 바뀔 때(_gp판)만 다시 세고, 장마다는 W 를 끼워 곱 두 번
     *   (11-26 18-1 재기만 프로파일: 판 직속 몫 열쇠에 --w 글자가 들어 장마다 몫을 처음부터 — 옮기기·곱 6번 + 변수 읽기 5번) · 끄기 __유닛GPU틀담끔 */
    if (부모 === L && !root.__유닛GPU틀담끔 && 관찰 && 관찰판 === L) {
      if (!묶음) 변화받기(L);   /* 판W 가 기대는 판시각을 최신으로 */
      var Ls = L.style, 틀열 = 세대머리 + 관찰세대 + ':' + (e._gp판 | 0) + ':' + Ls.width + ':' + Ls.height + ':' + Ls.perspective + ':' + Ls.perspectiveOrigin;
      var 틀 = e._gp틀;
      if (!(틀 && 틀.열쇠 === 틀열)) { 틀 = 틀만들기(e, L, R); 틀.열쇠 = 틀열; e._gp틀 = 틀; }
      if (틀.pre) {
        var W0 = 판W(L);
        if (W0) { var 결W = { m: M.multiply(틀.pre).multiply(W0).multiply(틀.B), w: 틀.w, h: 틀.h }; if (묶음) 묶음.set(e, 결W); return 결W; }
      }
    }
    /* ★ 6단계 앞당김 — «자기 몫»(부모 공간 → 자기 공간: 원근·평면화 × 자리 × 국소)을 요소에 담아 둔다
     *   열쇠 = 몫이 기대는 값 전부(자기 인라인 스타일 · 캔버스/그림 크기 · 부모 원근·원근 원점·크기·입체 · 판 바로 아래면 --w) — 같으면 곱셈 한 번
     *   (11-25 2-4A 스크롤 휴대폰 흉내 프로파일: 계산식 재기가 26% · 유닛 20 명이 매 장 움직이면 몫을 매번 처음부터 풀었다)
     *   정적 배치(형제에 기대는 자리)는 담지 않는다 · 끄기 __유닛GPU몫끔 */
    var 담을까 = !root.__유닛GPU몫끔 && (e.style.position === 'absolute' || e.style.position === 'fixed');
    if (!묶음) 변화받기(L);
    var 몫열쇠 = !담을까 ? null : (관찰 && 관찰판 === L) ? 세대머리 + 관찰세대 + ':' + (e._gp판 | 0) + ':' + (부모._gp판 | 0) + (e.tagName === 'IMG' ? ':' + e.naturalWidth + 'x' + e.naturalHeight : '') : [e.style.cssText, e.tagName === 'CANVAS' ? e.width + 'x' + e.height : e.tagName === 'IMG' ? (e.getAttribute('width') || '') + 'x' + (e.getAttribute('height') || '') + '/' + e.naturalWidth + 'x' + e.naturalHeight : '',
                부모.style.perspective, 부모.style.perspectiveOrigin, 부모 !== L && 입체(부모) ? 1 : 0, 부모.style.width, 부모.style.height, 부모 === L ? L.style.getPropertyValue('--w') : ''].join('|');
    var 담 = e._gp몫;
    if (담 && 담.열쇠 === 몫열쇠 && 몫열쇠 !== null) {
      if (담.없음) return 담.없음;
      var 결0 = { m: M.multiply(담.몫), w: 담.w, h: 담.h };
      if (묶음) 묶음.set(e, 결0);
      return 결0;
    }
    var 원 = 원근(부모, R);
    if (원 && 원.없음) return 원;
    if (원 && 부모 !== L && !입체(부모)) return { 없음: '원근과 평면화를 함께 가진 부모' };   /* 지금 구조엔 없음 — 들어오면 옛 길 (Codex 1단계) */
    var 앞몫 = 원 ? 원.m : (부모 !== L && !입체(부모)) ? 평면화 : null;
    var 자 = 자리(e, 부모, R);
    if (자.없음) return 자;
    var 크 = 크기(e, R);
    if (!(크.w >= 0 && 크.h >= 0)) return { 없음: '크기 모름: ' + e.tagName + ' ' + e.className };
    var 국 = 국소(e, 부모, 크, R);
    if (국.없음) return 국;
    var 몫 = (앞몫 ? 앞몫.translate(자.x, 자.y) : new 행().translate(자.x, 자.y)).multiply(국.m);
    if (몫열쇠 !== null) e._gp몫 = { 열쇠: 몫열쇠, 몫: 몫, w: 크.w, h: 크.h };
    var 결 = { m: M.multiply(몫), w: 크.w, h: 크.h };
    if (묶음) 묶음.set(e, 결);
    return 결;
  }
  /** 네 꼭짓점(왼위·오위·왼아래·오아래) — host 안 CSS px · 카메라 뒤(w≤0)면 null */
  function 꼭짓점(e, R) {
    var r = 행렬(e, R);
    if (r.없음) return r;
    var 점 = [[0, 0], [r.w, 0], [0, r.h], [r.w, r.h]].map(function (p) { var q = r.m.transformPoint({ x: p[0], y: p[1], z: 0, w: 1 }); return q.w > 1e-9 ? [q.x / q.w, q.y / q.w] : null; });
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
    /* 6단계 — 꼭짓점 배열·함수 없이 행렬 숫자에서 네 점을 바로 · 같은 장 같은 요소는 행렬 담기(결과 객체)에 얹은 답을 다시 쓴다(돌려줄 땐 새 객체)
     *   (11-26 18-1 GPU 켬+display:none 프로파일: 유닛띄우기 가림 사각 → 사각·꼭짓점 21%) · 셈은 꼭짓점 과 같다(원근 나눔 · w ≤ 1e-9 면 카메라 뒤 → null) */
    var M = 행렬(e, R);
    if (M.없음) return null;
    var q = M._사각;
    if (!q) {
      var x = M.m.a, w0 = M.w, h0 = M.h, l = Infinity, t = Infinity, r = -Infinity, b = -Infinity;
      for (var k = 0; k < 4; k++) {
        var px = (k & 1) ? w0 : 0, py = (k & 2) ? h0 : 0, W = x[3] * px + x[7] * py + x[15];
        if (!(W > 1e-9)) return null;
        var X = (x[0] * px + x[4] * py + x[12]) / W, Y = (x[1] * px + x[5] * py + x[13]) / W;
        if (X < l) l = X; if (X > r) r = X; if (Y < t) t = Y; if (Y > b) b = Y;
      }
      q = M._사각 = [l, t, r, b];
    }
    return { left: q[0], top: q[1], right: q[2], bottom: q[3], width: q[2] - q[0], height: q[3] - q[1] };
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
  /* 보이나 — 6단계 앞당김: 숨김 클래스를 Set 으로 · 요소가 가진 클래스만 대 본다 · 한 번 훑는 동안(보임표) 조상 판정을 다시 쓴다
   *   (11-25 프로파일: 새로 훑기의 27% 가 조상마다 숨김 클래스 목록 전체를 classList.contains 로 대 보던 것) */
  var 숨김집합 = null, 보임표 = null;
  function 제보임(n) {
    var st = n.style;
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    var 집 = 숨김집합; if (!집) { 집 = new Set(숨김꼴들()); if (숨김꼴) 숨김집합 = 집; }   /* 규칙 스타일을 실제로 읽었을 때만 담는다 */
    if (집.size) { var cl = n.classList; for (var i = 0; i < cl.length; i++) if (집.has(cl[i])) return false; }
    return true;
  }
  function 그려지나(e, L) {
    if (!e || e === L) return true;
    if (보임표) { var v = 보임표.get(e); if (v !== undefined) return v; }
    var r = 제보임(e) && (e.parentElement === L || 그려지나(e.parentElement, L));
    if (보임표) 보임표.set(e, r);
    return r;
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
    if (x.관) x.관.disconnect();
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
    /* 그림 파일(img·배경 그림)·단색 캔버스는 안 바뀐다 — 한 번만 올림
     *   게임 캔버스는 «캔버스 바뀜 번호»(_gp판번 · 아래 캔버스바뀜감시)가 지난번 올린 번호와 다를 때만 (6단계 · 11-26 18-1 휴대폰 흉내: 장마다 356장 4.2MB · 3.75ms)
     *   번호를 모르는 캔버스(2D 밖 맥락 · 감시 전에만 그려짐)는 장마다 · 끄기 __유닛GPU매장올림 */
    var 캔 = 원천.tagName === 'CANVAS', 번 = 캔 ? 원천._gp판번 : null;
    var 다시 = !v.올림 || (캔 && !원천._고정 && (root.__유닛GPU매장올림 || 원천._gp맥락밖 || 번 === undefined || 번 !== v.판번));
    if (다시) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, 원천);
      v.올림 = true; v.판번 = 번; 층.올림셈 = (층.올림셈 | 0) + 1;
    }
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
    var g = c.getContext('2d'); if (!g) return null; g.fillStyle = 색; g.fillRect(0, 0, 1, 1); c._고정 = true;
    색표.set(색, c); return c;
  }
  function 쌓임(e) { var z = parseFloat(e.style.zIndex); return isFinite(z) ? z : 0; }
  /* 판 안 그릴 것 모으기 — [{ e, 원천, 부드럽게, 무늬w, 무늬h, 반복, 깊이, 차례 }] · 못 그리면 { 옛길: 까닭 } */
  /* ★ 상자 계획 — 판 직속(유닛 상자·맵 아이템) 하나 안의 판들: 그림 원천·크기·반복·자름·밝기·쌓임(행렬 빼고) · 못 그리면 { 옛길 }
   *   변화 관찰 번호(자기 _gp판 · 아래 _gp아래)가 그대로면 지난 계획을 다시 쓴다 — 카메라가 움직여 판의 --w 가 바뀌어도 상자 안은 그대로라
   *   장마다 행렬과 상자 안 앞뒤 차례만 새로 센다 (11-26 2-4A 스크롤 휴대폰 흉내: 웹 요소를 숨기면 스타일 다시 계산 723→47ms 인데 장마다 처음부터 훑어 그 몫을 다 먹었다) */
  function 상자계획(c, L, R) {
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
                /* 상자 안 앞뒤 = 상자 기준 판의 z(앞으로 띄운 양) — ☠ 처음엔 판 가운데 점 깊이로 갈라 틀렸다: 세운 판은 위쪽일수록 멀어 머리 위 턴 마커(translateZ 1px)가 몸 뒤로 갔다(11-25 1-7) */
        var 판z = 0;
        if (입체(c) && e !== c) { var 상대 = 상자기준(e, c, R); if (!상대) return { 옛길: '상자 안 판이 상자와 나란하지 않음 (' + e.className + ')' }; 판z = 상대.z; }
        var 자름 = 자름구하기(e, c, R); if (자름 === false) return { 옛길: '잘라내기를 판 좌표로 못 옮김 (' + e.className + ')' };
        /* 제 층 — 크롬은 변환이 걸린 판(또는 판 직속)만 따로 합성하고 그 층 바깥 테두리만 섞는다 · 변환 없이 상자 안에 든 캔버스는 상자 층에 함께 그려져 테두리 섞기 없음
         *   (11-25 2-4A: 모든 판 테두리를 섞자 말 몸 캔버스 이음매마다 줄이 생겨 차이 532 → 2,956) */
        var 국e = 국소(e, e.parentElement, 크, R), 제층 = e.parentElement === L || (국e.m && !국e.m.isIdentity);
        판목.push({ e: e, 원천: 원천, 부드럽게: 부드럽게, mw: mw, mh: mh, 반복: 반복, w: 크.w, h: 크.h, 판z: 판z, 쌓: 판안쌓임(e, c), 차례: j, 자름: 자름, 제층: 제층, 밝: 밝기곱(e, L), 자리px: 자리px });
      }
      return { 판들: 판목, 입체: 입체(c) };
  }
  function 그릴것(R) {
    var L = 판(R), 목 = [], 직속 = Array.prototype.slice.call(L.children);
    var 담기 = !root.__유닛GPU계획끔 && 관찰 && 관찰판 === L, 세키 = 세대머리 + 관찰세대 + ':' + R.host.className + ':';   /* host 클래스(3D 숨김 규칙 .g2-3d맵 …)도 판 보임에 기댄다 — 관찰 밖이라 열쇠에 */
    직속 = 직속.map(function (c, i) { return { c: c, z: 쌓임(c), i: i }; }).sort(function (a, b) { return (a.z - b.z) || (a.i - b.i); });
    for (var k = 0; k < 직속.length; k++) {
      var c = 직속[k].c;
      var 열 = 담기 ? 세키 + (c._gp판 | 0) + ':' + (c._gp아래 | 0) : null, 계 = c._gp계;
      if (!(계 && 열 !== null && 계.열쇠 === 열)) {
        if (!그려지나(c, L)) { 계 = { 숨음: true }; }
        else { var 묶 = 묶음속성(c.style); if (묶) return { 옛길: 묶 + ' (' + c.className + ')' }; 계 = 상자계획(c, L, R); if (계.옛길) return 계; }
        계.열쇠 = 열; if (열 !== null) c._gp계 = 계;
      }
      if (계.숨음) continue;
      var 판목 = [];
      for (var j = 0; j < 계.판들.length; j++) { var d = 계.판들[j], 행 = 행렬(d.e, R); if (행.없음) return { 옛길: '행렬 ' + 행.없음 }; var p = Object.create(d); p.m = 행.m; 판목.push(p); }
      if (계.입체 && 판목.length > 1) {
        /* 상자의 +z 가 카메라 쪽인가 — 상자 원점에서 z 로 1 나간 점이 화면 w 가 작으면(가까우면) +z 가 앞 */
        var 상행 = 행렬(c, R); if (상행.없음) return { 옛길: '행렬 ' + 상행.없음 };
        var w0 = 상행.m.transformPoint({ x: 0, y: 0, z: 0, w: 1 }).w, w1 = 상행.m.transformPoint({ x: 0, y: 0, z: 1, w: 1 }).w, 앞쪽 = w1 < w0 ? 1 : -1;
        판목.sort(function (a, b) { var dd = 앞쪽 * (a.판z - b.판z); if (Math.abs(dd) > 1e-6) return dd; return 쌓비교(a.쌓, b.쌓) || (a.차례 - b.차례); });
      } else 판목.sort(function (a, b) { return 쌓비교(a.쌓, b.쌓) || (a.차례 - b.차례); });
      for (var q = 0; q < 판목.length; q++) 목.push(판목[q]);
    }
    return { 목: 목 };
  }
  /* 상자 기준 판 — 상자 안 요소의 변환을 상자 좌표로 곱해(평면 부모 아래는 z 버림) 판이 상자와 나란하면 { z } · 아니면 null */
  function 상자기준(e, 상자, R) {
    var 길 = [];
    for (var n = e; n && n !== 상자; n = n.parentElement) 길.unshift(n);
    var M = new 행(), 부모 = 상자;
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
  /* 이미 숨긴 판 위로 미리보기가 열리는 경우 — 핸들을 건 바로 다음 줄에서 syncOwner → 옆면 마스크 첫 sync 가 «동기로» 판 visibility 를 본다
   *   (map3d_mapx_building_transaction.js:1422 걸기 → 1426 syncOwner → map3d_building_preview.js:6202 sync · Codex 5단계 재검수 «꼭»)
   *   ⇒ 렌더러의 그 칸에 값이 들어오는 순간 판을 되살리고 GPU 캔버스를 감춘다(공유 모듈은 안 고침 · 값은 그대로 담고 돌려줌) */
  function 미리보기감시(R) {
    if (!R || R._gp미리보기감시 || R._gp미리보기감시실패) return;
    var 값 = R._map3dMapxBuildingPreview;
    try {
      Object.defineProperty(R, '_map3dMapxBuildingPreview', { configurable: true, enumerable: true,
        get: function () { return 값; },
        set: function (v) {
          값 = v;
          if (!v) return;
          var L = 판(R); if (L && L._유닛GPU감춤) { L.style.visibility = ''; L._유닛GPU감춤 = false; }
          if (층 && 층.cv) { 층.cv.style.display = 'none'; 층.마지막 = '건물 미리보기(mapx) 열림'; }
        } });
      R._gp미리보기감시 = true;
    } catch (e감시) { R._gp미리보기감시실패 = true; }   /* 걸지 못하면 숨기지 않는다 — 그리기안이 옛 길로 (Codex 5단계 3회차 권함) */
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
    /* 5단계 — mapx 건물 미리보기가 열려 있으면 숨기지 않는다: 그 옆면 마스크가 판 행판의 계산된 visibility 를 보고 hidden 이면 «행판이 사라졌다»며
     *   미리보기를 통째로 닫는다(map3d_building_preview.js:6132 sync → map3d_mapx_building_transaction.js:1173 close · Codex 5단계 «꼭» 1) — 공유 모듈은 안 고치고 그 동안 옛 길 */
    if (R._map3dMapxBuildingPreview) return 옛('건물 미리보기(mapx) 열림');
    미리보기감시(R); if (R._gp미리보기감시실패) return 옛('미리보기 감시를 못 걸음');
    /* ★ 6단계 앞당김 — 판(spriteLayer)·host 에 바뀐 것이 없으면 지난 장 판 목록·행렬을 그대로 쓴다(캔버스 그림만 다시 올림)
     *   (11-25 1-7 실측: 한 번 그리기 2.0ms 중 그림 올리기 0.23 · 나머지는 요소 훑기·스타일 읽기·행렬 · 휴대폰 흉내 1-1 이벤트 표시가 옛 길보다 1.5~2ms 길었다)
     *   바뀜 = 관찰자 기록(속성·자식·하위 전부 · takeRecords 로 그 자리에서) · host 크기 · 지난 장이 옛 길 · 끄기 __유닛GPU다시씀끔 */
    /* 콜백이 «바뀜» 표를 세운다 — 빈 콜백이면 마이크로태스크 때 기록이 버려져 바뀐 장을 옛 목록으로 그렸다(위 찍기와 같은 함정) */
    if (!층.관 && root.MutationObserver) { var 층0 = 층; 층.관 = new root.MutationObserver(function () { 층0.바뀜 = true; }); 층.관.observe(L, { attributes: true, childList: true, subtree: true }); 층.관.observe(R.host, { attributes: true }); 층.바뀜 = true; }
    var 호0 = R.호스트크기 ? R.호스트크기() : { w: R.host.clientWidth, h: R.host.clientHeight }, 크키 = 호0.w + 'x' + 호0.h + '@' + (root.devicePixelRatio || 1);
    var 기록 = 층.관 ? 층.관.takeRecords() : [1]; if (층.바뀜) { 기록 = 기록.length ? 기록 : [1]; 층.바뀜 = false; }
    /* 6단계 — 지난 그리기 뒤로 판·host 에 바뀐 것이 없고(관찰 기록 없음 · 크기 같음) 어떤 2D 캔버스도 안 그렸으면(캔번 같음) 그리지 않는다 —
     *   GPU 캔버스는 그린 그림을 그대로 보인다 · 반영 끝에 그린 장에 매 장 고리가 또 그렸다(11-26 18-1 프로파일 8%) · 끄기 __유닛GPU건너끔 */
    if (!root.__유닛GPU건너끔 && 층.목 && 층.목L === L && 층.크키 === 크키 && !기록.length && 층.그린캔번 === 캔번 && 층.cv.style.display !== 'none' && L._유닛GPU감춤) { 층.건너 = (층.건너 | 0) + 1; return true; }
    var 결;
    if (!root.__유닛GPU다시씀끔 && 층.목 && 층.목L === L && 층.크키 === 크키 && !기록.length) { 결 = { 목: 층.목 }; 층.다시씀 = (층.다시씀 | 0) + 1; }
    else {
      묶음시작(); 보임표 = new Map();
      try { 결 = 그릴것(R); } finally { 묶음끝(); 보임표 = null; }
      if (층.관) 층.관.takeRecords();   /* 훑는 동안 우리가 쓴 것(없어야 함)까지 비운다 */
      층.목 = 결.옛길 ? null : 결.목; 층.목L = L; 층.크키 = 크키; 층.새로씀 = (층.새로씀 | 0) + 1;
    }
    if (결.옛길) return 옛(결.옛길);
    var 호 = R.호스트크기 ? R.호스트크기() : { w: R.host.clientWidth, h: R.host.clientHeight }, 배 = root.devicePixelRatio || 1;
    var W = Math.max(1, Math.round(호.w * 배)), H = Math.max(1, Math.round(호.h * 배)), cv = 층.cv, gl = 층.gl;
    if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(층.pr); gl.bindVertexArray(층.vao);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);   /* 미리 곱한 알파 source-over */
    gl.uniform2f(층.위.호, 호.w, 호.h); gl.activeTexture(gl.TEXTURE0);
    var 섞기켬 = !root.__유닛GPU테두리끔;   /* 테두리 섞기 끄기(견줌·진단용) */
    층.장++; 층.그린적 = true; 층.그린캔번 = 캔번;
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
      var 점 = [[0, 0], [p.w, 0], [p.w, p.h], [0, p.h]].map(function (q) { var r = p.m.transformPoint({ x: q[0], y: q[1], z: 0, w: 1 }); return [r.x / r.w * 배, H - r.y / r.w * 배]; });
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
  function 상태() { return 층 ? { 마지막: 층.마지막 || '', 실패: 층.실패 || '', 잃음: !!층.잃음, 텍스처: 층.판텍 ? 층.판텍.size : 0, 다시씀: 층.다시씀 | 0, 새로씀: 층.새로씀 | 0, 올림: 층.올림셈 | 0, 건너: 층.건너 | 0 } : null; }
  function 외곽() { return 층 && 층.외곽 ? 층.외곽 : []; }

  /* 장마다 다시 그림 — 캔버스 그림이 반영(apply) 없이 바뀌어도 따라가게 (3단계 · 끄면 한 번 되돌리고 멈춤) */
  var 고리돎 = false;
  function 매장() {
    if (!root.__유닛GPU그림) { 고리돎 = false; try { 그리기(root.R); } catch (e끔) {} return; }
    try { 그리기(root.R); } catch (e그) { if (층) 층.마지막 = '오류 ' + (e그 && e그.message); }
    root.requestAnimationFrame(매장);
  }
  function 고리시작() { if (고리돎 || !root.__유닛GPU그림) return; 고리돎 = true; root.requestAnimationFrame(매장); }

  root.G2유닛GPU층 = { _셈: 셈, 그리기: function (R) { 고리시작(); return 그리기(R); }, 상태: 상태, 외곽: 외곽, 그린판: function () { return 층 && 층.그린판 || []; }, 묶음시작: 묶음시작, 묶음끝: 묶음끝, 행렬: 행렬, 꼭짓점: 꼭짓점, 쓸까: 쓸까, 사각: 사각, 화면사각: 화면사각, 점들어감: 점들어감, 점유닛후보: 점유닛후보, _길이: 길이 };
})(typeof window !== 'undefined' ? window : this);
