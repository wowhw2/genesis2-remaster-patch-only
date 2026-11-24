/* ============================================================================
 * 창세기전 2 — 연출 엔진 (이펙트 · 효과음 · 날씨 · 맵 타일 애니메이션)
 *
 * 자산은 04_도구/g2_export_fx.py 가 만듭니다 (자산/fx.json · 자산/fx_assets.js).
 * 근거는 전부 COMBATII.EXE 디스어셈블입니다 — 03_분석/COMBATII/연출대역_분석.md ·
 * 이펙트_배정표.md · 연출_필살기.md · 이펙트_연출엔진.md · 전투UI_사양.md.
 *
 * ── 시간 ────────────────────────────────────────────────────────────────
 * 게임 틱 175.47 Hz (0x101F4 : 1,193,182/1700 = 701.87 Hz ÷ [0x755B8]=4).
 * 1틱 = 5.6987 ms.  `0x1033B(ax = n)` 이 [0x70004] = n 으로 **프레임 간격**을 놓습니다.
 * 그래서 이펙트마다 "몇 틱에 한 장"이 정해져 있고, fx.json 의 `간격틱` 이 그 값입니다.
 *
 * ── 좌표 ────────────────────────────────────────────────────────────────
 * 타일 24×16.  render.js 와 같은 약속을 씁니다.
 *     유닛 기준점 = (타일x×24 + 12, 타일y×16 − 2)          (0x12F2A)
 *     그림 좌상단 = 기준점 + 프레임 앵커                    (0x30D90)
 * 앵커는 NSP 프레임 헤더에 들어 있고 대체로 (−w/2, −h/2) 입니다 — 가운데 정렬 보정.
 *
 * ── 그리는 방식 두 가지 ─────────────────────────────────────────────────
 *   attach(renderer)  render.js 의 `선택위` 층에 빌보드 DOM 으로 세웁니다 (본 게임용).
 *                     원본은 기본 갈래에서 `0x12BEE` 뒤에 연출을 그립니다.
 *   draw(ctx)         320×200 논리 화면 캔버스에 직접 그립니다 (시험 페이지·2D 모드).
 * 어느 쪽이든 프레임 진행은 update(dtMs) 하나가 맡습니다.
 * 날씨·플래시·페이드는 화면 전체를 덮으므로 **언제나 draw(ctx)** 쪽입니다.
 * ==========================================================================*/
(function (root) {
'use strict';

function usesSpecialDeath(u) { var Ru = root.Rules; if (!Ru && typeof require === 'function') { try { Ru = require('./rules.js').Rules; } catch (e) {} } if (!Ru || !Ru.usesSpecialDeath) throw new Error('Rules.usesSpecialDeath가 필요하다'); return Ru.usesSpecialDeath(u); }

var TICK_HZ = 175.47;                 // 0x101F4
var TICK_MS = 1000 / TICK_HZ;         // 5.6987 ms
var 좌표상수 = root.G2Projection;
if (!좌표상수 && typeof require === 'function') 좌표상수 = require('./projection.js');
if (!좌표상수) throw new Error('G2Fx: G2Projection이 먼저 필요하다');
var 연출명령계약 = root.G2EffectCommand;
if (!연출명령계약 && typeof require === 'function') 연출명령계약 = require('./effect_command.js');
if (!연출명령계약) throw new Error('G2Fx: G2EffectCommand가 먼저 필요하다');
var TW = 좌표상수.타일가로, TH = 좌표상수.타일세로;

/*  날씨 진행 · 타일 애니메이션 진행은 둘 다 게임 틱 ISR 이 30틱마다 부릅니다
 *  ([0x7899E] == 30 → 0x10A30 · 0x450F9).
 *  ★ 30틱 = **171 ms** — 게임 틱은 **175.47 Hz(5.7 ms)** 다 (DOSBox 실측).
 *    실측으로 확정했다 — 맵 애니(30틱)를 재니 163~167 ms 였다. 예전 DOS4GW divisor
 *    해석(18.2 Hz)은 틀렸다 ( §13). */
var STEP_TICKS = 30;
/**
 * ★★★★★ **날씨만 15 틱이다** — 타이머 ISR `0x101F4` (2026-09-03)
 *
 * 위 주석이 「날씨 진행·타일 애니메이션 진행은 **둘 다** 30 틱마다」라 했는데
 * **틀렸다.** ISR 을 읽으니 날씨 카운터(`0x450F9`)를 **두 군데서** 부른다:
 *
 * ```asm
 * 0x10204  dx = [0x899E] ; inc dx ; [0x899E] = dx      ; 매 틱 +1
 * 0x10213  cmp dx,0x0F(15) / jne                       ; ★ 15 틱째
 * 0x10222    call 0x450F9                              ;   날씨 카운터 +1
 * 0x1022E  cmp [0x899E],0x1E(30) / jne                 ; ★ 30 틱째
 * 0x10241    call 0x10A30                              ;   맵 타일 애니
 * 0x10246    call 0x12065
 * 0x1024B    call 0x450F9                              ; ★ 날씨 카운터 +1 (또)
 * ```
 *
 * ⇒ 30 틱 한 주기에 날씨는 **두 번** 오른다 = **실효 15 틱(85 ms)**.
 *   맵 타일 애니는 30 틱 그대로다.
 * ☠ 우리는 날씨도 30 틱으로 돌려 **두 배 느렸다.** 사용자 지적
 *   「날씨가 적용될 때 **부수적인 적용 효과**가 제대로 안 된 것 같다」의 한 조각이다.
 *
 * ★ 카운터 자체는 `0x450FB` `edx = [0x8A8AE]>>16 · inc · idiv 9` 로
 *   **`(그것 + 1) mod 9`** 다. 프레임 색인은 `0x4513D add eax,eax` 로 **× 2**,
 *   날씨별 오프셋은 `0`(비) · `0x12`(눈) · `0x24`(모래) · `0x36`(안개) —
 *   점프표 `0x4511E` 넷(`0x45166`·`0x45160`·`0x451C8`·`0x451D0`).
 *   그림은 **`WEATHER.SYB` 72 장 = 날씨 4 × 18 장** (`0x44BA4` `0x7D12`).
 */
var WEATHER_TICKS = 15;                                    // 0x10213 · 0x1024B

function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

/* ══════════════════════════════════════════════════════════════════════ */

function Fx() {
  this.assets = null;
  this.base = '자산/';
  this.images = {};          // png 경로 · data-URL → Image·Canvas
  this.sounds = {};          // 이름/번호 → {url, audio}
  this.volume = 1;
  this.native = {};          // 원본 직독으로 채운 이펙트 → 프레임 수 (할일 19)
  this.nativeOnly = false;   // true 면 추출 PNG 를 아예 안 읽습니다

  this.active = [];          // 재생 중인 이펙트
  this.screenActive = [];    // 화면 고정 원본 연출(빙룡소환 0x22D18 등)
  this.renderer = null;      // attach() 하면 DOM 모드

  this.view = { w: 320, h: 200 };
  this.cam = { x: 0, y: 0 }; // 화면 좌상단 타일 (0x10971 의 [0xBA83A]/[0xBA83C])

  /* 날씨 — 0x4512E */
  this.wKind = 0;            // 0 없음 1 비 2 눈 3 모래바람 4 안개
  this.wStep = 0;            // [0xFA8B0] : 0…8
  this.wMs = 0;

  /* 화면 흔들림 — 0x2C863 */
  this.shakeLeft = 0;        // 남은 프레임 수
  this.shakeMs = 0;
  this.shakeOff = { x: 0, y: 0 };

  /* 흰 플래시 0x2D48A · 붉은 페이드 0x1E565 */
  this.flashLeft = 0; this.flashColor = '#fff';
  this.fadeMs = 0; this.fadeTotal = 0; this.fadeColor = '#000';
  this.fadeUp = null; this.fadeDown = 0;   /* 0x1E565 — 오름 20 · 내림 10 프레임 */

  /* 맵 타일 애니메이션 — 0x10A30 */
  this.tileMs = 0;
  this.tileIdx = null;       // 그룹마다 현재 프레임 인덱스
  this.tileFirst = true;
}

/* ── 자산 ─────────────────────────────────────────────────────────────── */

Fx.prototype.setAssets = function (json, base) {
  this.assets = json;
  this.base = base || this.base;
  this._미리읽기();
  return this;
};

/**
 * 자산 읽기. ring.js · hud.js 와 같은 방식입니다.
 * file:// 에서는 fetch 가 막히므로 <script src="자산/fx_assets.js"> 를 먼저 읽어 두면
 * 전역 G2FX_ASSETS 를 씁니다.
 */
Fx.prototype.load = function (base, cb) {
  var self = this;
  base = base || '자산/';
  this.base = base;
  function done(j) { self.setAssets(j, base); if (cb) cb(null, j); }
  if (root.G2FX_ASSETS) { done(root.G2FX_ASSETS); return this; }
  var url = base + 'fx.json';
  if (typeof fetch === 'function' && location.protocol !== 'file:') {
    fetch(url).then(function (r) { return r.json(); }).then(done)
      .catch(function (e) { if (cb) cb(e); });
  } else {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.onload = function () { try { done(JSON.parse(x.responseText)); } catch (e) { if (cb) cb(e); } };
      x.onerror = function () { if (cb) cb(new Error('fx.json 을 못 읽었습니다')); };
      x.send();
    } catch (e) { if (cb) cb(e); }
  }
  return this;
};

/** 효과 그림 URL의 캐시된 이미지 요소를 얻고 없으면 적재를 시작한다. */
Fx.prototype._그림정보 = function (png) {
  if (!png) return null;
  var im = this.images[png];
  if (!im && typeof Image !== 'undefined') {
    im = new Image();
    im.src = this.base + png;
    this.images[png] = im;
  }
  return im;
};

/* ── 원본 직독 (할일 19) ────────────────────────────────────────────────
 *
 * 이펙트 그림은 `MAGICSPR/*.NSP` 다. 추출 시트(`자산/fx/*.png`)를 굽지 않고
 * 런타임에 디코드해 시트 한 장으로 묶는다.
 *
 * ★ **표에 없는 것도 이름만 주면 읽는다.** 아직 이식 안 한 마법·필살기 연출도
 *   나중에 `ensureNative('asura2', 'ASURA2.NSP')` 한 줄이면 원본에서 바로 온다 —
 *   새 추출 자산을 만들 이유가 없어야 한다.
 *
 * NSP 는 두 갈래다 (`native.js decodeNSP`).
 *   무압축 : 값 `0xFF` 가 투명   ← 이펙트 55종은 전부 이쪽이라 추출본도 정확했다
 *   RLE    : 기록 안 된 픽셀만 투명 (색 0 은 **불투명 검정**)
 * 추출기는 뒤쪽을 못 살리므로, 새로 붙는 연출이 RLE 이면 추출본은 뚫린다.
 */
var SHEET_MAX_W = 2048;     // 한 줄이 이보다 길어지면 다음 줄로 넘긴다

/**
 * 프레임들을 시트 한 장으로 묶는다. 배치는 우리가 정하므로 좌표도 함께 낸다.
 * @param {Array} [cell] `[w,h]` 를 주면 프레임마다 **그 크기의 칸**을 잡는다.
 *   날씨가 그렇다 — 원본은 144×96 짜리 한 칸을 이어 까는데(`0x4512E`), RLE 가
 *   오른쪽·아래 빈 줄에서 일찍 끝나는 프레임이 4장 있어(143×95 등) 그냥 붙이면
 *   이어 깔 때 눈금이 어긋난다. 칸을 고정하면 원본과 같은 격자가 된다.
 */
function packFrames(frames, palette, cell) {
  var pad = 1, x = 0, y = 0, rowH = 0, W = 0, rects = [], i, f, cw, ch;
  for (i = 0; i < frames.length; i++) {
    f = frames[i];
    cw = cell ? cell[0] : f.w; ch = cell ? cell[1] : f.h;
    if (x && x + cw > SHEET_MAX_W) { x = 0; y += rowH + pad; rowH = 0; }
    rects.push({ x: x, y: y, w: cw, h: ch, ax: f.ax, ay: f.ay });
    x += cw + pad; if (x > W) W = x;
    if (ch > rowH) rowH = ch;
  }
  var H = y + rowH;
  var cv = document.createElement('canvas');
  cv.width = Math.max(1, W); cv.height = Math.max(1, H);
  var g = cv.getContext('2d');
  for (i = 0; i < frames.length; i++) {
    g.putImageData(root.G2Native.frameToImageData(g, frames[i], palette),
                   rects[i].x, rects[i].y);
  }
  var 논리 = [cv.width, cv.height];
  /* ★★ **스케일러를 태운다** — 사용자 지적 2026-08-14
   *   「스케일러도 이상하네… **초필살기 이펙트** 이런 건 적용 안 되고」.
   *   여기가 `putImageData` 로 1배 그대로 굽고 있어서 이펙트만 계단이 보였다.
   *
   *   시트를 통째로 N배로 굽고 **`rects`·`sheet` 는 논리 크기 그대로** 둔다.
   *   · 캔버스 갈래 — `drawImage` 몽키패치(`scaler.js`)가 `논리w` 를 보고
   *     9인자 소스 사각형을 N배로 되돌려 준다.
   *   · DOM 갈래(`background-image`) — `render.js fxSprite` 가 `background-size`
   *     를 논리 크기로 눌러 담는다. */
  if (root.G2Scaler && root.G2Scaler.N() > 1) {
    var up = root.G2Scaler.toCanvas(g.getImageData(0, 0, cv.width, cv.height));
    up.논리w = 논리[0]; up.논리h = 논리[1];
    cv = up;
  } else { cv.논리w = 논리[0]; cv.논리h = 논리[1]; }
  return { canvas: cv, rects: rects, sheet: 논리 };
}

/**
 * 디코드해 둔 프레임으로 이펙트 하나를 세운다.
 * 이미 표에 있으면 **간격틱·소리·구간·근거는 그대로 두고** 그림만 바꾼다
 * (그 값들은 EXE 주소를 근거로 뽑은 것이라 그림과 별개다).
 *
 * @param {string} key   `G2Fx.play(key, …)` 로 부를 이름
 * @param {Array} frames `G2Native.decodeNSP(...).frames`
 * @param {Uint8Array} palette GENESIS.PAL 768바이트
 * @param {object} [meta] 표에 없던 것을 새로 세울 때 `{이름, 원본, 간격틱, 소리, 구간, 근거}`
 * @returns {number} 프레임 수
 */
Fx.prototype.setNativeFrames = function (key, frames, palette, meta) {
  if (!root.G2Native || !frames || !frames.length) return 0;
  if (typeof document === 'undefined') return 0;
  var a = this.assets || (this.assets = {});
  var tbl = a['이펙트'] || (a['이펙트'] = {});
  var def = tbl[key];
  if (!def) {
    def = tbl[key] = {};
    /* ★★★★★ **여기는 닿지 않는다 — 그래도 값을 지어내지 않는다** (2026-08-30)
     *
     *   `battle_assets.js:219` 가 `Object.keys(a['이펙트'])` 만 돌므로
     *   **표에 없는 키로 이 함수가 불릴 일이 없다.** 곧 이 갈래는 죽은 경로다.
     *
     *   ☠ 그런데 예전엔 여기 `|| 5` 가 **조용한 기본값**으로 남아
     *     「간격틱을 못 받으면 5」가 되어 있었다. 값을 지어내는 자리였다.
     *     (`00_연출타이밍_전면점검_계획.md` 가 그것을 지적했다.)
     *
     *   ⇒ **기본값을 없앤다.** 못 받으면 `간격틱` 을 **안 넣고**, 무엇이 없는지
     *     로그로 알린다. 표에 있는 이펙트 55개는 전부 EXE 근거가 있다
     *     (`g2_export_fx.py` · 실사용 TODO 0). */
    if (meta && meta['간격틱'] != null) def['간격틱'] = meta['간격틱'];
    else if (root.console && console.warn)
      console.warn('[G2Fx] 표에 없는 이펙트 ' + key + ' — 간격틱을 못 받았다 (EXE 근거 필요)');
  }
  if (meta) {
    ['이름', '원본', '소리', '구간', '근거', '틱근거'].forEach(function (k) {
      if (meta[k] != null) def[k] = meta[k];
    });
    if (meta['간격틱'] != null) def['간격틱'] = meta['간격틱'];
  }
  var p = packFrames(frames, palette);
  def['프레임'] = p.rects;
  def['시트'] = p.sheet;
  def['프레임수'] = p.rects.length;
  def.url = p.canvas.toDataURL();          // DOM 갈래(background-image)용
  delete def.png;                          // 추출 시트는 더 안 씁니다
  this.images[def.url] = p.canvas;         // 캔버스 갈래용 (drawImage 가 캔버스도 받습니다)
  /* ★ 스케일러를 **도중에** 바꿔도 다시 구울 수 있게 원본 프레임을 쥐고 있는다.
   *   인덱스 버퍼라 크지 않다. `rebuildForScaler()` 가 쓴다. */
  def._frames = frames; def._palette = palette;
  this.native[key] = p.rects.length;
  return p.rects.length;
};

/**
 * 스케일러가 바뀌었을 때 — **구워 둔 이펙트 시트를 새 배율로 다시 만든다.**
 *
 * 사용자 지적 2026-08-14: 「스케일러도 이상하네… **초필살기 이펙트** 이런 건
 * 적용 안 되고」. 처음 켠 배율로 한 번 굽고 끝이라, 도중에 바꾸면 옛 배율이
 * 그대로 남아 있었다.
 */
Fx.prototype.rebuildForScaler = function () {
  var a = this.assets, self = this, n = 0;
  var tbl = a && a['이펙트'];
  if (!tbl) return 0;
  Object.keys(tbl).forEach(function (key) {
    var def = tbl[key];
    if (!def || !def._frames) return;
    var old = def.url;
    var p = packFrames(def._frames, def._palette);
    def['프레임'] = p.rects; def['시트'] = p.sheet;
    def.url = p.canvas.toDataURL();
    if (old) delete self.images[old];
    self.images[def.url] = p.canvas;
    n++;
  });
  return n;
};

/** 날씨(`WEATHER.SYB` 72프레임)도 같은 방식으로. 프레임 좌표를 새로 냅니다. */
Fx.prototype.setNativeWeather = function (frames, palette) {
  if (!this.assets || !this.assets['날씨'] || !frames || !frames.length) return 0;
  if (typeof document === 'undefined') return 0;
  /* 칸은 원본 타일 크기(144×96) 로 고정 — 위 packFrames 주석 참고 */
  var w = this.assets['날씨'];
  /* ★ 날씨가 걸리면 **다시 구워야** 한다 — 인덱스 프레임을 쥐고 있는다 (2026-09-10) */
  w._frames = frames; w._palette = palette; delete w.png;
  this.native['날씨'] = frames.length;
  /* 정본 400 — 시트는 처음 날씨를 그릴 때 굽는다(날씨굽기 · 날씨칠하기): 날씨가 없는 전투도 늘 구워 쥐고 있었다
   *   (측정 크롬 2-3 · 시트 4060×1162 — 4배 스케일러면 8120×2324 = 72MB · 2배 18MB · 거기에 PNG 글자열까지 · 휴대폰 튕김 LOW_MEMORY · 앱 RSS 1.3GB)
   *   날씨가 바뀌면 지금도 그 자리에서 다시 굽는다 — 처음 그릴 때 굽는 것도 같은 일 · 끄기 window.__날씨시트미리 (예전처럼 곧바로) */
  if (root.__날씨시트미리) this.날씨굽기();
  else { w.url = null; w['프레임'] = null; w['시트'] = null; }
  return frames.length;
};
/** 정본 400 — 날씨 시트를 지금 팔레트(w._palette)로 굽는다 (setNativeWeather · 날씨적용 · 날씨칠하기 가 부름) */
Fx.prototype.날씨굽기 = function () {
  var w = this.assets && this.assets['날씨'];
  if (!w || !w._frames || typeof document === 'undefined') return false;
  var old = w.url;
  var p = packFrames(w._frames, w._palette, w['타일'] || [144, 96]);
  w['프레임'] = p.rects; w['시트'] = p.sheet;
  w.url = p.canvas.toDataURL();
  if (old) delete this.images[old];
  this.images[w.url] = p.canvas;
  return true;
};

/** 그림 주소 — 원본 직독이면 data-URL, 아니면 예전 추출 경로.
 *
 * ★★★ `섞을색`·`반투명` 을 주면 **그 색 픽셀만** 섞은 시트를 대신 낸다 (2026-08-25).
 *   원본 `0x5F29D` 는 `0x61147(색, 강도)` 로 만든 리맵표를 **소스 픽셀로 골라**
 *   그 색만 섞고 나머지는 불투명하게 찍는다 — 요소 전체 `opacity` 와는 다르다.
 *   시트 통째로 구워도 `background-position` 프레임 좌표는 그대로다.
 *   근거: `03_분석/COMBATII/반투명_리맵_원본확정.md` §5-3 ①.
 */
Fx.prototype._효과그림URL = function (def, 섞을색, 반투명) {
  if (!def) return '';
  var _cv = def.url && this.images ? this.images[def.url] : null;   /* 시트 캔버스 */
  if (섞을색 != null && 반투명 && _cv && root.G2MagicFx && root.G2MagicFx.섞은url) {
    var u = root.G2MagicFx.섞은url({ canvas: _cv }, 섞을색 | 0, +반투명);
    if (u) return u;
  }
  return def.url || (this.base + def.png);
};

/**
 * 캔버스 갈래에서 쓸 시트. 원본 직독이면 `<canvas>`, 아니면 `<img>` 입니다.
 * 아직 안 그려진 것은 null 을 내서 그 프레임을 건너뛰게 합니다.
 */
Fx.prototype._시트정보 = function (def) {
  if (!def) return null;
  if (def.url) {
    var cv = this.images[def.url];
    return (cv && cv.width) ? cv : null;
  }
  var im = this._그림정보(def.png);
  return (im && im.complete && im.naturalWidth) ? im : null;
};

/**
 * 브라우저에서 원본 파일 하나를 읽어 이펙트로 세웁니다.
 * @param {string} key  부를 이름
 * @param {string} file `MAGICSPR/ASURA2.NSP` 처럼 `/원본/` 아래 경로
 * @returns {Promise<number>} 프레임 수 (실패하면 0)
 */
Fx.prototype.ensureNative = function (key, file, meta) {
  var self = this;
  if (this.native[key]) return Promise.resolve(this.native[key]);
  if (typeof fetch !== 'function') return Promise.resolve(0);
  return fetch(G2URL(file))
    .then(function (r) { if (!r.ok) throw new Error(file + ' ' + r.status); return r.arrayBuffer(); })
    .then(function (b) {
      var u8 = new Uint8Array(b);
      /* ★ **확장자로 가른다.** 예전엔 `decodeNSP` 를 먼저 시도했는데,
       *   `.SYB`(= NC2 코덱)를 넣으면 NSP 로 **1프레임만** 읽고 성공한 척한다.
       *   `BATTLE.SYB`(투사체 133프레임)가 그래서 통째로 안 나왔다
       *   (사용자 지적 2026-08-13 「투사체 발사 안 돼」).
       *   `.SYB`/`.SYF` 는 `decodeSYB`, `.NC2` 계열은 `decodeNC2`, `.NSP` 는 `decodeNSP`.
       *
       *   ★★★ **`.SYB` 는 `decodeSYB` 여야 한다** (2026-08-20 사용자: 「내부 UI 관련된
       *     게 추출 안 되었어. 대표적인 게 TP 구체」). `.SYB` 는 **프레임마다 압축/무압축이
       *     다른데** 여기서 `decodeNC2`(= 항상 RLE)를 부르고 있었다.
       *     `TIME_GRA.SYB` 는 13프레임이 **전부 무압축**이라 통째로 깨졌다
       *     (프레임 5~12 시간대 하늘은 칠 0 = 완전히 빔).
       *     `BATTLE.SYB` 도 133 중 2프레임이 무압축이다. */
      /* ★ `.SPR` 은 NC2 와 NSP 가 섞여 있다 → `decodeSPR` 이 구조로 가른다
       *   (`MEGATHUN.SPR` · `PROMINAN.SPR` 이 NSP 인데 NC2 로 읽혀 안 보였다) */
      var d = /\.(SYB|SYF)$/i.test(file)
        ? (root.G2Native.decodeSYB ? root.G2Native.decodeSYB(u8) : root.G2Native.decodeNC2(u8))
        : /\.SPR$/i.test(file) && root.G2Native.decodeSPR
          ? root.G2Native.decodeSPR(u8)
          : /\.(NC2|BCR|MAR|WCR|RCR)$/i.test(file)
            ? root.G2Native.decodeNC2(u8)
            : (root.G2Native.decodeNSP(u8) || root.G2Native.decodeNC2(u8));
      if (!d || !d.frames || !d.frames.length) throw new Error(file + ' 디코드 실패');
      /* ★★★★★ **팔레트가 없으면 `setNativeFrames` 가 터진다** (2026-08-22)
       *   `Cannot read properties of undefined (reading '72')` — 실물 시험이 잡았다.
       *
       *   `setPalette` 는 부팅의 「이펙트 직독」 블록에서 **한 번만** 불린다.
       *   그보다 먼저 부르는 호출부(퇴장 페이드의 `EVENT.SYB` 등)는 통째로 실패한다.
       *   ★ 렌더러의 팔레트 창구 이름은 **`_유닛팔레트`** 다 — `paletteOf` 는 없다.
       *     그래서 아래 갈래는 **한 번도 참이 된 적이 없다.**
       *   ⇒ 여기서 확보한다. 세 호출부(`투사체`·`마법투사체`·`소멸링`)가 계약을 공유한다. */
      var R2 = self.renderer;
      var pal = self.palette ||
                (R2 && R2.paletteOf && R2.paletteOf()) ||
                (R2 && R2._유닛팔레트 && R2._유닛팔레트()) || null;
      if (!pal) {
        /* ★ **실패를 캐시하지 않는다** — 다음에 다시 시도해야 한다 */
        delete self.native[key];
        throw new Error(file + ' — 팔레트가 아직 없다 (setPalette·attach 전)');
      }
      if (!self.palette) self.palette = pal;      /* 다음 호출부가 다시 찾지 않게 */
      return self.setNativeFrames(key, d.frames, pal, meta);
    })
    .catch(function (e) {
      console.warn('이펙트 직독 실패:', file, e && e.message);
      /* ★ 실패한 키는 **비워 둔다** — 다음 호출이 다시 시도할 수 있게 */
      try { delete self.native[key]; } catch (x) {}
      return 0;
    });
};

/**
 * **소리도 원본에서 바로 읽습니다** — `.VSP` / `.SSP` / `.BSP`.
 *
 * 헤더 `0x40` 을 건너뛴 8비트 무부호 PCM 22000Hz 를 WAV 로 감싸
 * blob URL 로 만들어 `this.sounds[key]` 에 등록합니다
 * (`native.js decodeSound` — 근거 `0x5C665 eax = 0x55F0`).
 *
 * 이렇게 두면 `playSound(key)` 가 추출본과 똑같이 동작합니다. 추출 wav
 * (`자산/snd/*.wav`)를 **새로 참조하지 않기 위한** 창구입니다 — `CLAUDE.md`
 * 「새로 만드는 것도 전부 직독으로」.
 *
 * @param {string} key   `playSound` 로 부를 이름
 * @param {string} file  `MAGICSPR/F-BALL.SSP` 처럼 `/원본/` 아래 경로
 * @returns {Promise<boolean>}
 */
Fx.prototype.ensureNativeSound = function (key, file) {
  var self = this;
  if (this.sounds[String(key)]) return Promise.resolve(true);
  if (typeof fetch !== 'function') return Promise.resolve(false);
  this.sounds[String(key)] = { url: null, pending: true };   // 중복 요청 막기
  /* ★ `G2URL` 은 모드(원본/리마스터)를 타는 창구다. 없으면 기본 경로로 —
   *   `native.js` 와 같은 규약이다 (Node 시험에는 창구가 없다). */
  var 주소 = (typeof root.G2URL === 'function') ? root.G2URL(file) : ('/원본/' + file);
  return fetch(주소)
    .then(function (r) { if (!r.ok) throw new Error(file + ' ' + r.status); return r.arrayBuffer(); })
    .then(function (b) {
      var d = root.G2Native.decodeSound(new Uint8Array(b));
      if (!d) throw new Error(file + ' 디코드 실패');
      var url = URL.createObjectURL(new Blob([d.wav], { type: 'audio/wav' }));
      /* pcm 은 환경음의 틈 없는 반복(웹 오디오 버퍼)에 쓴다 — ambient 주석 */
      self.sounds[String(key)] = { url: url, native: true, samples: d.samples, pcm: d.wav.subarray(44), rate: d.sampleRate };
      return true;
    })
    .catch(function (e) {
      delete self.sounds[String(key)];
      console.warn('소리 직독 실패:', file, e && e.message);
      return false;
    });
};

/** 팔레트를 쥐여 줍니다 (`GENESIS.PAL` 768바이트). */
Fx.prototype.setPalette = function (pal) {
  this.palette = pal;
  if (pal && !this.기본팔레트) this.기본팔레트 = pal;   /* 처음 것 = 날씨 안 걸린 바탕 */
  return this;
};

/** ★★★★★ **전투 날씨에 맞춰 이펙트 그림을 다시 굽는다** — 원본 `0x1077A` (2026-09-10)
 *
 *   > 사장님: 「원본에서 그 글자 색이 동일한지 확인하고 **더 꼼꼼히 찾아봐.**」
 *
 *   원본은 팔레트 **256색 전부**를 DAC 에 쓰므로, 날씨가 걸린 전투(비·눈·모래바람·
 *   안개 — 시나리오 327개 중 **27개**)에서는 **이펙트와 눈·비 알갱이도 같이 물든다.**
 *
 *   ☠ 우리는 부팅 때 팔레트를 한 번 받아 그림을 구워 두고 끝이었다. 그때는
 *     **시나리오가 아직 없어 날씨가 0** 이라, 27개 전투에서 이펙트 색이 원본과 달랐다.
 *     실측(1-1 눈) — 눈송이가 보정 안 된 (227,243,227) 로 떴다. 원본은 (178,195,178).
 *
 *   ★ 다시 **읽지는 않는다.** `setNativeFrames` 가 인덱스 프레임(`_frames`)을
 *     쥐고 있으므로 **다시 굽기만** 한다 (`rebuildForScaler` 와 같은 길).
 */
Fx.prototype.날씨적용 = function () {
  var N = root.G2Native, self = this;
  if (!this.기본팔레트 || !N || !N.전투팔레트) return 0;
  /* ★ 같은 날씨로 또 부르면 다시 굽지 않는다 — 57장을 `toDataURL` 하는 일이다 */
  var w = (root.G2 && root.G2.scene) ? (root.G2.scene['날씨'] | 0) : 0;
  if (this._건날씨 === w && this.palette) return 0;
  var pal = N.전투팔레트(this.기본팔레트);
  this._건날씨 = w;
  if (pal === this.palette) return 0;                  /* 날씨 0 이고 이미 바탕이면 할 일 없다 */
  this.palette = pal;
  var tbl = this.assets && this.assets['이펙트'], n = 0;
  if (tbl) Object.keys(tbl).forEach(function (key) {
    var def = tbl[key];
    if (!def || !def._frames) return;
    var old = def.url;
    var q = packFrames(def._frames, pal);
    def['프레임'] = q.rects; def['시트'] = q.sheet; def._palette = pal;
    def.url = q.canvas.toDataURL();
    if (old) delete self.images[old];
    self.images[def.url] = q.canvas;
    n++;
  });
  /* 눈·비 알갱이(`WEATHER.SYB`)도 같은 팔레트를 탄다 — 1-1 실측으로 잡았다 */
  var w = this.assets && this.assets['날씨'];
  if (w && w._frames) {
    w._palette = pal;
    if (w.url) { this.날씨굽기(); n++; }   /* 정본 400 — 아직 안 구웠으면 팔레트만 바꿔 두고 처음 그릴 때 굽는다 */
  }
  return n;
};

/** 효과 자산표가 지정한 그림과 소리를 초기 캐시에 요청한다. */
Fx.prototype._미리읽기 = function () {
  var a = this.assets;
  if (!a) return;
  var self = this;
  /* ★ nativeOnly 면 그림은 한 장도 안 읽습니다 — 원본에서 옵니다 */
  if (!this.nativeOnly) {
    Object.keys(a['이펙트'] || {}).forEach(function (k) {
      if (!self.native[k]) self._그림정보(a['이펙트'][k].png);
    });
    if (a['날씨'] && !self.native['날씨']) self._그림정보(a['날씨'].png);
  }
  /* TODO(할일 19-d) 타일 애니메이션 시트는 아직 추출본입니다. 원본은 지금 띄운
   * `.MAP` 의 블록이라(render.js `_blkCache` 가 이미 직독으로 굽고 있습니다)
   * 맵 블록 캔버스를 그대로 쓰도록 바꿔야 합니다. */
  /* ☠★★★★★ **타일 애니메이션 추출 시트는 더 안 쓴다** (2026-09-10)
   *   > 사장님: 「그 외에 **별도 추출본 사용하지 않도록** 확인해줘.」
   *   `_맵애니칸()`(§1268) 이 **맵 파일의 열 메타**로 바뀐 뒤로 이 PNG 는
   *   그리는 자리가 한 군데도 없다. 받기만 하고 안 쓰던 것이라 뺀다.
   *   (`fx.json` 의 항목은 남겨 둔다 — 표에 근거가 붙어 있다) */

  /* ★★★★★ **소리도 원본 직독으로** (2026-08-27 · 사용자 지적)
   *
   *   > 「지금 전체적으로 **효과음이 잘 적용이 안돼.** … 효과음을 불러오는데
   *   >  **두가지 이상의 루트**를 타는 것으로 보이고 **그 중 한가지가 막힌** 것으로 보여.」
   *
   *   맞다. 루트가 둘이었다 —
   *     ① `ensureNativeSound(키, 파일)`  원본 `.VSP`/`.SSP`/`.BSP` 직독 (마법사 볼트 하나만)
   *     ② 여기 `put()`                    **추출 번들** `자산/snd/*.wav`  ← 99개가 이쪽
   *
   *   그런데 `base` 가 `'자산/'` 상대경로라, 셸(`/게임/게임.html`)에서는
   *   `/게임/자산/snd/…` 를 찾아 **전부 404** 였다.
   *   실측(1-5): 등록 100키 중 native 1 · url 99, 표본 40개 **전부 404**.
   *   `playSound` 는 `new Audio(url)` 이 조용히 실패하므로 **소리만 안 났다.**
   *
   *   ⇒ `fx.json` 이 이미 각 소리의 **원본 파일 이름**(`원본`)을 들고 있다.
   *     그것으로 `MAGICSPR/` 아래를 직독한다. 추출 wav 는 **더 안 본다** —
   *     `CLAUDE.md` §6 「모든 수치·자산은 원본에서 나와야 한다」.
   *
   *   ★ 번호(`29`)와 이름(`turn`) 두 키가 **같은 blob** 을 가리킨다 — 한 번만 받는다.
   *   ★ 실패하면 그 키만 비고 나머지는 산다 (`ensureNativeSound` 가 그렇게 한다). */
  var s = a['소리'] || {};
  /* ★ 브라우저가 아니면 소리를 안 받는다 — Node 시험은 `fetch` 는 있어도
   *   서버·`G2URL`·`Audio` 가 없다. 그림 계약만 검사하고 지나간다. */
  if (typeof document === 'undefined') return;
  function 직독(키들, 원본) {
    if (!원본) return;
    var 첫 = String(키들[0]);
    var p = self.ensureNativeSound ? self.ensureNativeSound(첫, 'MAGICSPR/' + 원본) : null;
    if (!p || 키들.length < 2) return;
    Promise.resolve(p).then(function (ok) {
      if (!ok) return;
      var rec = self.sounds[첫];
      for (var i = 1; i < 키들.length; i++) self.sounds[String(키들[i])] = rec;   /* 같은 blob */
    });
  }
  Object.keys(s['효과음'] || {}).forEach(function (n) {
    var r = s['효과음'][n];
    /* 번호 '29' 와 이름 'turn' 둘 다 — `soundPlan` 은 번호로, 연출은 이름으로 부른다 */
    직독([n, String(r['원본'] || '').replace(/\.VSP$/i, '').toLowerCase()], r['원본']);
  });
  Object.keys(s['환경음'] || {}).forEach(function (n) { 직독([n], s['환경음'][n]['원본']); });
  Object.keys(s['연출음'] || {}).forEach(function (n) { 직독([n], s['연출음'][n]['원본']); });
};

/* ── 붙이기 ───────────────────────────────────────────────────────────── */

/** render.js 의 Renderer 를 붙이면 이펙트가 맵 위 빌보드로 그려집니다. */
Fx.prototype.attach = function (renderer) {
  /* ★★★ 렌더러가 **바뀌면 캐시를 버린다** (2026-08-24) — 아래 `_렌더러확인` 참고 */
  var 옛 = this.renderer;
  if (renderer && 옛 && renderer !== 옛) this._애니캐시버리기();
  if (옛 && 옛 !== renderer && 옛.이펙트시트정보포트) 옛.이펙트시트정보포트(null);
  this.renderer = renderer || null;
  if (this.renderer && this.renderer.이펙트시트정보포트) {
    var self = this;
    this.renderer.이펙트시트정보포트(function (url) { return self.imageInfo(url); });
  }
  return this;
};

/** 타일·오브젝트 애니 캐시를 버린다 (맵 표·위상·요소 목록) */
Fx.prototype._애니캐시버리기 = function () {
  this._애니키 = null; this._애니칸 = null; this._애니원본맵 = null;
  this.tileIdx = null; this.tileFirst = true; this.tileMs = 0;
  this.objIdx = null; this._objAnimMap = null; this.objMs = 0;
};
/** SCE op 0x10 이 같은 MAP 의 layerA 한 칸을 바꾼 뒤 기존 타일 애니만 갱신한다. */
Fx.prototype.맵타일애니무효화 = function (map, x, y) {
  var R = this.renderer;
  if (!R || R.nmap !== map) return false;
  this._애니키 = null; this._애니칸 = null; this._애니원본맵 = null;
  this.tileIdx = null; this.tileFirst = true; this.tileMs = 0;
  R._애니칸키 = null; R._애니칸집합 = null;
  /* 타일이 정적으로 바뀌면 다음 애니 걸음이 없어도 옛 덧칠 한 칸은 즉시 걷는다. */
  var 판 = R._애니판, N = 판 && 판._N || 1;
  if (판 && 판.getContext) 판.getContext('2d').clearRect(x * TW * N, y * TH * N, TW * N, TH * N);
  R._애니판목록 = null; R._애니판타일 = {};
  var key = x + ',' + y, e = R.tileEls && R.tileEls[key];
  if (e) { if (e.parentNode) e.parentNode.removeChild(e); delete R.tileEls[key]; }
  return true;
};

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **렌더러가 바뀌었으면 따라간다** — 체인(op 0x12) 대응 (2026-08-24)
 *
 *  > 사용자 지적: 「폭포 애니메이션이 **게임.html 에서** 잘 적용이 안돼」
 *  > 「더웃긴건, **같은 맵인데 2-4 시나리오에서는 애니메이션이 적용이 돼.**
 *  >  그런데 **2-4a**(2-4에서 자동으로 연결되는 시나리오)**에서는 적용이 안돼**」
 *
 *  ★ 실측으로 잡았다 — 체인으로 넘어간 뒤:
 *  ```
 *  R바뀜 true · Fx바뀜 false · Fx렌더러가옛R **true** · 애니타일 **0**
 *  ```
 *  셸의 체인(`screens.js` op 0x12)은 BATTLE 을 **새 인스턴스**로 다시 세운다
 *  (`전투통합_계획.md` §2-b — 「재진입은 새 인스턴스로」). 그래서 **렌더러가
 *  새로 만들어지는데**, `G2Fx.attach(R)` 는 `battle_main.js 420` 의
 *  **`G2Fx.load()` 콜백 안**에 있어 **다시 불리지 않았다.**
 *  ⇒ Fx 가 **죽은 렌더러의 `tileEls`** 에 칸을 만들고 있었다 — 새 화면엔 안 붙는다.
 *
 *  ★★ **왜 같은 맵에서만 터지나** — `_맵애니칸` 의 캐시 키가
 *    `폭 × 높이 : tileAnim 길이` 라 **같은 맵이면 키가 같다**(FR08 `57x53:560`).
 *    다른 맵으로 체인되면 키가 달라져 캐시가 새로 잡히면서 **우연히** 되살아났다.
 *    사용자가 말한 「같은 맵인데」가 정확히 이 자리다.
 *
 *  ★ 여기서 **매 프레임 스스로 확인**하므로, 어느 경로로 렌더러가 바뀌든 따라간다
 *    (맵마다·시나리오마다 손볼 필요가 없다).
 * ══════════════════════════════════════════════════════════════════════ */
Fx.prototype._렌더러확인 = function () {
  var 현재 = root.G2BattleRuntime && root.G2BattleRuntime.렌더러
    ? root.G2BattleRuntime.렌더러() : null;
  if (현재 && 현재 !== this.renderer) {
    var 옛 = this.renderer;
    this.attach(현재);
    if (root.console && console.info)
      console.info('[FX] 렌더러가 바뀌어 따라붙었다 (애니 캐시 버림)' + (옛 ? '' : ' — 첫 연결'));
  }
  return this.renderer;
};

/** 논리 화면 크기 (원본은 320×200). */
Fx.prototype.setView = function (w, h) { this.view.w = w; this.view.h = h; return this; };

/** 화면 좌상단 타일. 캔버스 모드에서만 씁니다 (0x10971 의 카메라). */
Fx.prototype.setCamera = function (tx, ty) { this.cam.x = tx; this.cam.y = ty; return this; };

/** 화면 한가운데에 그 칸이 오도록 카메라를 잡습니다. */
Fx.prototype.centerCamera = function (tx, ty) {
  this.cam.x = tx - (this.view.w / 2) / TW;
  this.cam.y = ty - (this.view.h / 2) / TH;
  return this;
};

/* ── 이펙트 재생 ──────────────────────────────────────────────────────── */

/**
 * @param {string} name  fx.json 의 이펙트 키 (예: 'f_arrow')
 * @param {object} opts
 *   x, y       맵 타일 좌표 (필수)
 *   dx, dy     맵 픽셀 미세 보정 (기본 0)
 *   to         {x, y}  주면 대상까지 직선 보간해 날아갑니다 (화염1 계열)
 *   구간       fx.json 의 `구간` 이름 (예: '명중') 또는 [처음, 끝]
 *   scale      배율 (기본 1)
 *   speed      배속 (1 = 원본 틱, 2 = 두 배 빠르게)
 *   loop       참이면 되풀이
 *   sound      false 면 소리를 안 냅니다 (기본은 fx.json 의 `소리` 첫 장을 냅니다)
 *   onDone     끝났을 때
 * @return {object} 핸들 (stop 에 넘길 수 있습니다)
 */
Fx.prototype.play = function (name, opts) {
  opts = opts || {};
  var def = this.assets && this.assets['이펙트'] && this.assets['이펙트'][name];
  if (!def) return null;

  var range = [0, def['프레임수']];
  var r = opts['구간'];
  if (typeof r === 'string' && def['구간'] && def['구간'][r]) range = def['구간'][r].slice();
  else if (Object.prototype.toString.call(r) === '[object Array]') range = [r[0], r[1]];

  var inst = {
    def: def, name: name,
    from: range[0], to: range[1],
    frame: range[0],
    ms: 0,
    /* ★★★ **필살기는 프레임 간격이 슬롯마다 다르다** (2026-08-25 · 도막 재조사)
     *   원본 `0x1033B(eax = 틱)` 이 그 연출의 틱을 세운다 —
     *   검 파 8 · 부 회 5 · 부 광 7 · 활 살 7 · 활 뇌 32 · 권 기 9 · 부 격 16 …
     *   자산 정의의 `간격틱` 은 기본값이고, `opts.틱` 이 오면 **그것이 이긴다.**
     *   근거: `03_분석/COMBATII/필살기_자산표.md` §「도막 단위 재조사」 */
    step: ((opts['틱'] != null ? (opts['틱'] | 0) : def['간격틱']) || 1) * TICK_MS / (opts.speed || 1),
    x: opts.x || 0, y: opts.y || 0,
    dx: opts.dx || 0, dy: opts.dy || 0,
    tx: opts.to ? opts.to.x : null, ty: opts.to ? opts.to.y : null,
    t: 0,
    scale: opts.scale || 1,
    loop: !!opts.loop,
    onDone: opts.onDone || null,
    /* ★★★★★ **프레임마다 픽셀만큼 움직이는 연출** — 「살」 계열 1단계 (2026-09-03)
     *
     *   ```asm
     *   0x2D68F  lea ebx,[esp+0x8] · 0x2D693 mov edx,esp
     *   0x2D695  call 0x135EB(eax = 시전자)      ; ★ 기준은 **시전자** 화면 좌표
     *   0x2D70E  eax = [esp+0x8] − 0x46 + esi    ;   0x2D72E  esi += 7
     *   0x2D71A  eax = [esp]     + 0x32 − edi    ;   0x2D734  edi += 5
     *   0x2D746  cmp cx,0xA                      ; ★ 10 프레임
     *   ```
     *   ⇒ 시전자 자리에서 **(+50, −70)** 떨어진 데서 시작해 프레임마다
     *     **(−5, +7)** 씩 다가온다. 10 프레임이면 정확히 시전자 자리에 닿는다.
     *   ★ 2단계(`0x2D781`)는 **보정이 없다** — 시전자 자리에 11 프레임 고정이다.
     *   ☠ 우리는 `to`(목표)를 늘 넘겨서 **비행 5스텝**으로 끝나 버렸다.
     *     그래서 `구간` 이 통째로 무시됐다 — `제자리` 로 그 갈래를 끈다. */
    걸음: opts['걸음'] || null,
    /* ★ 구간을 몇 바퀴 도나 — 검 제 3 바퀴(`0x2D591`) · 검 반 2 바퀴(`0x2D659`) */
    남은바퀴: (opts['반복'] | 0) || 1,
    /* ★★★★★ **어떤 장에서 흰 플래시가 터지는 연출이 있다** — 검 반 (2026-09-03)
     *   ```asm
     *   0x2D63A  cmp esi,4            ; ★ **넷째 장**(0-base 4)일 때만
     *   0x2D644  call 0x4F4CD(0x32)   ;   소리
     *   0x2D649  eax = 0xA · 0x2D64E call 0x2D48A ; ★ 흰 플래시 **10 틱**
     *   ```
     *   `구간` 을 도는 **도중**이라 단계로는 못 나눈다 — 프레임을 보고 끼운다. */
    장플래시: opts['장플래시'] || null,      /* {장: 4, 틱: 10} */
    el: null, dead: false
  };
  if (opts['제자리']) { inst.tx = null; inst.ty = null; }      /* 비행 갈래를 끈다 */
  if (opts['시작보정']) {                                        /* 0x2D70E · 0x2D71A */
    inst.dx += (opts['시작보정'].x | 0);
    inst.dy += (opts['시작보정'].y | 0);
  }
  /* ★ 반투명(한 색만 섞기) — 스킬·마법이 `extra` 로 넘긴다 (2026-08-25) */
  if (this.renderer) inst.el = this.renderer.fxSprite(
    this._효과그림URL(def, opts['섞을색'], opts['반투명']), 'top');
  this.active.push(inst);
  this._인스턴스동기화(inst);

  /* ★★★ **필살기는 소리도 슬롯마다 다르다** (2026-08-25 · 도막 재조사)
   *   원본 `0x4F460(eax = 파일, edx = 슬롯)` 이 읽고 `0x4F4CD(eax = 슬롯)` 이 낸다.
   *   자산 정의의 `소리` 는 기본값이고, `opts.소리파일` 이 오면 **그것이 이긴다.**
   *   실측: 검제/창제 `bolt1` · 검반 `i-shoot` · 살 계열 `i-star2` · 검파 `f-blast` ·
   *        직선(3·9·21) `f-fall` · 부회 `f-fall` · 부광 `i-fist` · 활뇌 `bolt2`.
   *   근거: `03_분석/COMBATII/필살기_자산표.md` §「도막 단위 재조사」 */
  if (opts.sound !== false) {
    if (opts['소리파일']) this.playSound(opts['소리파일']);
    else if (def['소리'] && def['소리'].length) this.playSound(def['소리'][0]);
    /* ★ **소리를 둘 싣는 것도 있다** — 혼(슬롯 5·10) (2026-08-30 · 지적 B-1)
     *   `0x2E42F` death.ssp 슬롯 50 · `0x2E439` bomb.ssp 슬롯 51 — 둘 다 올린다. */
    if (opts['소리파일2']) this.playSound(opts['소리파일2']);
  }
  return inst;
};

/**
 * 빙룡소환 화면 연출 `0x22D18`.
 *
 * 일반 `play()`는 맵 칸에 한 스프라이트를 놓는 창구라서, 화면 좌표로 용을 올린 뒤
 * 5개 방출원×5개 조각을 동시에 굴리는 이 함수에는 맞지 않는다. 원본에서 확인된
 * 값만 그대로 고정한다. `STARTEAR.NSP`는 별도 함수 `0x23074`의 자산이며
 * 이 경로에서 호출되지 않는다.
 *
 * @param {Array} frames `ICEDRAGO.NSP`의 `{canvas,ax,ay}` 7장
 * @param {object} opts  `{rng, shake}` (`rng(n)`은 0..n-1)
 * @return {Promise} `0x2306F ret`에 해당하는 정리까지 끝났을 때 완료
 */
Fx.prototype.playIceDragon = function (frames, opts) {
  opts = opts || {};
  if (!frames || frames.length < 7) return Promise.resolve(false);
  var self = this;
  return new Promise(function (done) {
    var rng = typeof opts.rng === 'function' ? opts.rng : function (n) {
      return Math.floor(Math.random() * n);
    };
    /* 원본은 y(rand 0x82) 를 먼저, x(rand 0x118) 를 뒤에 굴린다 (0x22DAB·0x22DC5 · 0x22E86·0x22E9D) */
    function emitter() { var y = -(rng(130) | 0) - 50; return { x: (rng(280) | 0) + 20, y: y, age: 0 }; }
    var s = {
      kind: 'ice-dragon-22D18', frames: frames,
      /* ★ 0x22D54 ecx = 0xC7 — 용(0번 장)은 y 199(화면 아래)에서 시작해 장마다 15 씩 오른다 (2026-09-26 사장님 「빙룡소환도 용이 날아가는 효과 시작점이 이상해」 · ☠ 예전 y 1) */
      phase: 'rise', x: 45, y: 199, ms: 0, step: 5 * TICK_MS,
      emitters: [], shards: [], budget: 40, shake: 0, dead: false,
      rng: rng,
      shakeFn: typeof opts.shake === 'function' ? opts.shake : null,
      /* [리마스터] 소리 — 창2 원본 0x22D18 은 무음이다. 창1 바하무트(CHRSYS 1a8c:6c07)를 따른다 (Z-91 · 2026-09-26 사장님
       *   「창1에 해당 마법이 바하무트와 드래곤 봄버 마법이 있고 거기에서 사용하는 소리가 있었던 것 같은데 참고해서 결정하는게 좋겠어」) */
      soundFn: typeof opts.playSound === 'function' ? opts.playSound : null, 옛남은: -1,
      done: function () { if (s.dead) return; s.dead = true; if (s.shakeFn) s.shakeFn(0); done(true); }
    };
    if (s.soundFn) { try { s.soundFn('시작'); } catch (e소) {} }   /* 창1 0x2151E push 5 → dragon.ssp */
    self.screenActive.push(s);
  });
};

/** 효과 인스턴스 하나를 종료 표시하고 즉시 회수한다. */
Fx.prototype.stop = function (inst) {
  if (!inst) return;
  inst.dead = true;
  this._끝난효과거두기();
};

/** 활성 효과 전부를 종료 표시하고 DOM·완료 콜백을 회수한다. */
Fx.prototype.stopAll = function () {
  for (var i = 0; i < this.active.length; i++) this.active[i].dead = true;
  this._끝난효과거두기();
  this.screenActive.slice().forEach(function (s) { if (s && s.done) s.done(); });
  this.screenActive = [];
};

/** 종료된 효과의 요소를 제거하고 완료 콜백을 실행해 활성 목록을 압축한다. */
Fx.prototype._끝난효과거두기 = function () {
  var keep = [], self = this;
  this.active.forEach(function (a) {
    if (a.dead) {
      if (a.el && self.renderer) self.renderer.dropFxSprite(a.el);
      if (a.onDone) a.onDone();
    } else keep.push(a);
  });
  this.active = keep;
};

/** 이펙트가 놓일 맵 픽셀 좌표 (그림 좌상단). */
Fx.prototype._현재프레임 = function (inst) {
  var fr = inst.def['프레임'][clamp(inst.frame, 0, inst.def['프레임수'] - 1)];
  var bx = inst.x * TW + 12 + inst.dx;
  var by = inst.y * TH - 2 + inst.dy;
  if (inst.tx !== null) {                      // 0x2016A : 목표까지 5스텝 직선 보간
    var ex = inst.tx * TW + 12, ey = inst.ty * TH - 2;
    bx += (ex - bx) * inst.t;
    by += (ey - by) * inst.t;
  }
  return { 기준x: bx, 기준y: by,
           x: Math.round(bx + fr.ax * inst.scale),
           y: Math.round(by + fr.ay * inst.scale), fr: fr };
};

/** 비행이 끝났을 때 — 목표 칸에 앉히고 '명중' 구간이 있으면 그리로 (0x2016A ②). */
Fx.prototype._비행도착 = function (inst) {
  inst.x = inst.tx; inst.y = inst.ty;
  inst.tx = inst.ty = null; inst.t = 0;
  var seg = inst.def['구간'] && inst.def['구간']['명중'];
  if (seg) { inst.from = seg[0]; inst.to = seg[1]; inst.frame = seg[0]; }
  else if (!inst.loop) { inst.frame = inst.to - 1; inst.dead = true; }
};

/** 효과 인스턴스의 현재 프레임·자리·투명도를 렌더러 표시에 동기화한다. */
Fx.prototype._인스턴스동기화 = function (inst) {
  if (!inst.el || !this.renderer) return;
  var p = this._현재프레임(inst), fr = p.fr;
  var w = Math.round(fr.w * inst.scale), h = Math.round(fr.h * inst.scale);
  inst.el.style.backgroundPosition = (-fr.x * inst.scale) + 'px ' + (-fr.y * inst.scale) + 'px';
  if (inst.scale !== 1) {
    inst.el.style.backgroundSize =
      (inst.def['시트'][0] * inst.scale) + 'px ' + (inst.def['시트'][1] * inst.scale) + 'px';
  }
  /* 원본 논리 기준점과 NSP 그림 기준점을 분리해 정본 §3~§4의 두 축으로 넘긴다. */
  var 명령 = 연출명령계약.명령만들기({
    공간: '맵', 자리: { x: p.기준x, y: p.기준y }, 앵커: '발밑',
    y의뜻: '깊이', 자세: '세움', 아래위: '선택위'
  });
  this.renderer.연출프레임명령놓기(inst.el, 명령, fr, inst.scale, w, h);
};

/* ── 소리 ─────────────────────────────────────────────────────────────── */

/**
 * @param {string|number} name  효과음 번호(1~34) · 파일이름('turn') · 연출음('i-shoot') ·
 *                              환경음('wind')
 * @param {number} vol  0~1 (기본 1)
 */
/** 효과음 슬롯 수 — 원본 `0x5CBB8`(2 부터) ~ `0x5CC17`(8 미만) = **여섯** */
var 슬롯수 = 6;

/** 이름으로 적재된 효과음을 사용 가능한 채널에 지정 음량으로 재생한다. */
Fx.prototype.playSound = function (name, vol) {
  var key = String(name);
  var s = this.sounds[key];
  /* 0x4F460의 파일명(.SSP) 호출과 직독 캐시의 확장자 없는 키를 연결한다.
   * 파일 자체는 _미리읽기의 MAGICSPR 직독 경로만 사용한다. */
  if (!s && /\.ssp$/i.test(key)) s = this.sounds[key.replace(/\.ssp$/i, '').toLowerCase()];
  /* ★ `ensureNativeSound` 가 받는 중이면 `url` 이 아직 없다(`pending`).
   *   그대로 `new Audio(null)` 을 만들면 조용히 실패하거나 콘솔이 시끄러워진다. */
  if (s && !s.url) return null;
  if (!s || typeof Audio === 'undefined') return null;
  /* ★★★★★ **효과음 채널은 여섯이다 — 슬롯 2부터 7까지 빈 곳을 찾는다** (2026-08-28)
   *
   *   > 사용자: 「효과음 안됐다고」 · 「걸음 소리도 안됐다고」
   *   > 「첫번째 피격음 나고 **두번째 피격음(죽을때) 안나**」
   *
   *   ☠☠☠ **내가 `jne` 한 줄에서 끊어 읽었다.** 이 파일에 「효과음 채널은 하나」
   *     라고 적어 두었던 것이 **모든 소리 문제의 뿌리**였다.
   *
   *   원본 `0x5CB97` 을 **`ret` 까지** 읽으면 —
   *   ```asm
   *   0x5CBB3  cmp ecx, 0x50 / jge 0x5CC1C   ;   번호 범위
   *   0x5CBB8  mov edx, 2                    ;   ★ **시작** 슬롯 2
   *   0x5CBBD  eax = ((edx<<3) − edx) << 2   ;   슬롯 칸 = 28바이트
   *   0x5CBC7  cmp [eax + 0xA273C], 0        ;   그 슬롯이 쓰는 중인가
   *   0x5CBCE  jne 0x5CC16                   ;   차 있으면 —
   *   0x5CC16    inc edx                     ;   ★★★ **다음 슬롯으로**
   *   0x5CC17    cmp edx, 8                  ;   ★★★ **7까지** 훑는다
   *   0x5CC1A    jl 0x5CBBD                  ;   다시 시도
   *   0x5CC1C  ret                           ;   여섯 다 차 있을 때만 버린다
   *   ```
   *   ⇒ 효과음은 **한 번에 여섯까지** 겹쳐 난다. 여섯이 다 차야 버린다.
   *     사용자가 말한 「**여럿이 뒤섞인것처럼**」이 이것이다.
   *
   *   ★ 슬롯이 풀리는 때는 `0x5C447` — **끝나기 `0x400` 샘플 앞**이다.
   *   ```asm
   *   0x5C447  eax = [슬롯.길이] − 0x400
   *   0x5C451  cmp eax, [슬롯.위치] ; jge     ;   아직 남았으면 그대로
   *   0x5C459  ebx = [슬롯.반복] − 1
   *   0x5C466  cmp ebx,1 / jl → [슬롯.쓰는중] = 0   ; ★ 비운다
   *   ```
   *   (슬롯 칸 폭 0x1C · 슬롯2 밑 0xA2764 · 길이 +0x04 · 반복 +0x08 ·
   *    쓰는중 +0x10 · 주소 +0x14 · 위치 +0x18)
   *
   *   ★ 환경음(`ambient`)·BGM 은 **다른 창구**(`0x5CC20`)라 이 제한을 안 받는다.
   *   ★ 되돌리는 스위치: `window.__효과음겹치기 = true` (제한 없이 겹쳐 낸다) */
  try {
    var 겹침허용 = (typeof root !== 'undefined' && root.__효과음겹치기);
    if (!겹침허용) {
      /* 막는 길이 = (샘플수 − 0x400) / 22000. 모르면 한 프레임(0.05초). */
      var _표본 = s.samples ? Math.max(0, s.samples - 0x400) : 0;   /* 0x5C44C */
      var _len = (_표본 ? (_표본 / 22000) : 0.05) * 1000;
      if (this.효과음채널잡기(_len) < 0) return null;          /* 0x5CC1C — 여섯 다 참 */
    }
    var a = new Audio(s.url);
    a.volume = clamp((vol === undefined ? 1 : vol) * this.volume, 0, 1);
    재생시도(a, name);            /* ★ 자동재생 차단을 넘는다 (아래 §) */
    if (!겹침허용) this._효과음채널 = a;
    return a;
  } catch (e) { return null; }
};

/* ★ 효과음 채널 2~7 은 «한 묶음»이다 — 일반 번호(1~34) · 초필살 .SSP(50~53) ·
 *   링 31 이 모두 0x4F4CD → 0x5CB97 로 같은 여섯 칸을 나눠 쓴다.
 *   원본 실측(2026-09-29 화염인 방향2 · 채널표 0x11272C): 3→3 · 22→2 · 50→2 · 51·52→2~7 · 31→2.
 *   ultimate.js playSlot · ring.js playSound 도 이 창구로 칸을 잡는다.
 *   @param {number} ms 칸을 막을 길이(끝나기 0x400 샘플 앞 · 0x5C447) @returns 칸 0..5 · 없으면 −1 */
Fx.prototype.효과음채널잡기 = function (ms) {
  var 이제 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  if (!this._슬롯끝) this._슬롯끝 = [0, 0, 0, 0, 0, 0];        /* 슬롯 2…7 */
  for (var q = 0; q < 슬롯수; q++) {                           /* 0x5CC16 inc edx */
    if (!(this._슬롯끝[q] > 이제)) {                            /* 0x5CBC7 == 0 */
      this._슬롯끝[q] = 이제 + Math.max(0, ms || 0);           /* 0x5C477 이 비운다 */
      return q;
    }
  }
  return -1;
};
/** 지금 차 있는 효과음 칸 수 (진단용). */
Fx.prototype.효과음채널사용 = function () {
  var 이제 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now(), n = 0;
  (this._슬롯끝 || []).forEach(function (t) { if (t > 이제) n++; });
  return n;
};
/** 전투 세션을 닫을 때 칸을 모두 비운다. */
Fx.prototype.효과음채널비우기 = function () { this._슬롯끝 = [0, 0, 0, 0, 0, 0]; };

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **환경음은 「번호」가 상태다** — `[0xFF0B8]` (2026-08-28)
 *
 *  > 사용자: 「지금 물소리도 나오기는 하는데, **나오지 않아야 할 곳에서도 나와서**
 *  >  … **언제 켜지고 언제 멈추는지** 확인한 뒤 제대로 수정해야해.」
 *
 *  ── 원본이 정한 규칙 (전수로 확인) ────────────────────────────────
 *
 *  **켜기**
 *  · `op 0x77` 값 1~5 → `0x52DA4`
 *      0x52DB0  call 0x5CD0D        ; ① 지금 나는 것을 끈다
 *      0x52DBD  call 0x500C9        ; ② 값을 [0xFF0B8] 에 넣는다
 *      0x52DC2  call 0x4F3BD        ; ③ .BSP 를 읽는다
 *      0x52DC7  call 0x4F427        ; ④ 켠다
 *  · **전투 시작** `0x55EAD → 0x4F427` — **저장된 번호**로 다시 켠다
 *      0x4F429  cmp [0xFF0B8], 0
 *      0x4F430  jle 끝              ; ★ 0 이하면 안 켠다
 *      0x4F43C  ebx = 0x3E7         ;   반복 999회 ≈ 무한
 *      0x4F446  edx = 0             ; ★ **슬롯 0** — 효과음(2~7)과 다른 자리
 *
 *  **끄기**
 *  · `op 0x77` 값 0 — 같은 핸들러가 ①에서 끄고 ④는 `jle` 로 안 켠다
 *  · 게임 불러오기 `0x4FD2C` · 소리 옵션 끔 `0x4F45B`
 *  · ★★★ **COMBATII 가 끝날 때** — **명령이 없다.** 프로세스가 죽으면 소리도 죽는다
 *    (`0x5CD0D` 호출 9곳 전수 — 전투 종료 자리가 없다)
 *
 *  ── 우리가 틀린 자리 ──────────────────────────────────────────────
 *  ☠ 번호를 **기억하지 않았고**, 끄는 자리가 `op 0x77` 값 0 **하나뿐**이었다.
 *    원본의 「끄기」는 **프로세스 종료**가 맡는데, 우리는 한 페이지로 돌아
 *    그 자리가 비어 있다. 실측: 2-1 에서 켠 뒤 시나리오를 바꿔도 `_amb` 가
 *    **같은 객체 그대로** 남고 `ambient` 끄기 호출은 **0회**였다.
 *  ⇒ 번호를 상태로 들고, 전투에 **들어갈 때 다시 켜고**(0x55EAD)
 *    **나갈 때 끈다**(원본의 프로세스 종료 자리).
 * ══════════════════════════════════════════════════════════════════════ */

/** `MAGICSPR/*.BSP` — `[0xFF0B8]` 값 0~5 (`0x4F3BD` 가 이 표를 색인한다) */
var 환경음표 = [null, 'rain-out', 'stream', 'wat-fall', 'wind', 'sea'];

/**
 * `op 0x77` — 번호를 바꾸고 즉시 반영한다 (`0x52DA4`).
 * @param {number} v 0 = 끔 · 1~5 = `.BSP`
 */
Fx.prototype.환경음설정 = function (v) {
  v = v | 0;
  this.환경음번호 = (v >= 0 && v < 환경음표.length) ? v : 0;   /* [0xFF0B8] */
  return this.환경음다시켜기();
};

/**
 * 저장된 번호로 다시 켠다 — **전투 시작** `0x55EAD → 0x4F427`.
 * 번호가 0 이하면 켜지 않는다 (`0x4F430 jle`).
 */
Fx.prototype.환경음다시켜기 = function () {
  var 이름 = 환경음표[this.환경음번호 | 0] || null;
  if (!이름) return this.ambient(null, false);                 /* 0x5CD0D */
  return this.ambient(이름, true);                             /* 0x4F427 */
};

/**
 * 소리만 멈춘다 — **번호는 그대로 둔다.**
 * 원본에서 이 자리는 **COMBATII 프로세스 종료**다.
 */
Fx.prototype._환경음대기취소 = function () {
  if (!this._amb대기) return false;
  clearInterval(this._amb대기);
  this._amb대기 = null;
  return true;
};
/** 예약된 환경음 전환을 취소하고 현재 반복 환경음을 멈춘다. */
Fx.prototype.환경음멈추기 = function () {
  this._환경음대기취소();
  return this.ambient(null, false);
};

/**
 * ★★★★★ **전투가 시작될 때 — 번호를 되돌리고 끈다** (2026-08-28)
 *
 * > 사용자 정정: 「2-4 에서 처음 **대사창 없는 문구**가 나올때는 물소리 안나고,
 * >  **카메라 이동할때부터 2-4 끝날때까지** 물소리가 나. 이벤트 진행되어
 * >  **2-4a 로 넘어가면 안나야해.**」
 *
 * ☠ 처음에는 「번호가 세이브에 남으니 다음 전투로 **이어받는다**」고 읽었다.
 *   그런데 **2-4A 에는 `op 0x77` 이 아예 없다**(SCE 294개 전수). 이어받는다면
 *   2-4A 에서도 물소리가 나야 하는데 **안 난다.** ⇒ 그 읽기가 틀렸다.
 *
 * 원본에서 `[0xFF0B8]` 은 **세이브 파일에서 읽어 오는 값**이고
 * (`0x4EEB5`·`0x4FCAB` 가 `int 21h/3F` 로 1바이트 읽는다), `op 0x77` 은
 * **메모리에서만** 바꾼다(`0x52DBD`). 저장(`0x4F830`)을 하지 않는 한 그 변경은
 * 남지 않으므로, **다음 전투는 다시 세이브에 적힌 값으로 시작**한다.
 * 전투 중에는 저장할 수 없으니 사실상 **매 전투 처음은 「꺼짐」**이다 —
 * 사용자가 본 2-4 → 2-4A 가 정확히 그것이다.
 *
 * ⇒ 시나리오가 시작될 때 번호를 **0 으로 되돌리고** 소리를 끈다.
 *   그 뒤 그 시나리오의 `op 0x77` 이 켜면 그때부터 난다.
 * ★ 2-4 의 `op 0x77` 은 문구(`0x73`) **뒤**, 카메라(`0x0F 0x0F`) **다음**이라
 *   「문구 때는 안 나고 카메라 이동부터 난다」가 저절로 맞는다
 *   (`04_도구/SCE_환경음_전수.js` — 2-4 `§0[0] #3 값 2 앞[0xf 0xf]`).
 */
Fx.prototype.환경음초기화 = function () {
  this._환경음대기취소();
  this.환경음번호 = 0;                     /* 세이브 값 — 우리는 저장하지 않으므로 0 */
  return this.ambient(null, false);        /* 0x5CD0D */
};

/**
 * 환경음 루프 (0x4F427 이 반복 0x3E7 = 사실상 무한).
 * ★ 번호를 다루는 창구는 위의 `환경음설정`·`환경음다시켜기`·`환경음멈추기` 다.
 *   이 함수는 **소리만** 다룬다.
 * @param {string} name  'rain-out' 'stream' 'wat-fall' 'wind' 'sea'
 * @param {boolean} on
 */
Fx.prototype.ambient = function (name, on) {
  if (this._amb) { try { this._amb.__꺼짐 = true; this._amb.pause(); } catch (e) { /* 무시 */ } this._amb = null; }   /* __꺼짐 — 숨김이 풀릴 때 다시 틀지 않게 (정본 385) */
  if (!on) return null;
  var s = this.sounds[String(name)];
  if (!s || s.pending) this._환경음대기(name);   /* ★ 아직 안 실렸으면 준비되면 켠다 — 아래 § */
  if (!s || s.pending || typeof Audio === 'undefined') return null;
  /* ★★★ 2026-09-24 (사장님: 「빗소리 효과음 자연스럽지 않은 문제, 중간에 뚝뚝 끊기면서 반복되어서 이상해」)
   *   원본 0x4F427 → 0x5CC20(eax=슬롯 10, ebx=0x3E7 반복 999) — 사운드카드가 **소리 전체를 틈 없이** 이어 튼다.
   *   HTML `Audio.loop` 는 한 바퀴마다 틈이 생겨(RAIN-OUT.BSP ≈ 2초마다) 뚝뚝 끊겼다.
   *   ⇒ 웹 오디오 버퍼 반복(AudioBufferSourceNode.loop)으로 튼다. 없으면 옛 길로 물러난다. */
  var 웹 = 환경음웹재생(this, s, name);
  if (웹) { this._amb = 웹; return 웹; }
  try {
    var a = new Audio(s.url);
    a.loop = true; a.volume = clamp(0.6 * this.volume, 0, 1);
    this._amb = a;
    _환경음엘리먼트.push(a);   /* 숨김 때 멈추게 (아래 화면숨김 · 정본 385) */
    재생시도(a, name);            /* ★ 자동재생이 막히면 첫 조작 때 다시 (아래 §) */
    return a;
  } catch (e) { return null; }
};

/**
 * ★★★★★ **소리가 아직 안 실렸으면 준비될 때까지 기다렸다 다시 켠다** (2026-09-01)
 *
 * ☠ 실측 — `.SCE` 헤더 환경음(`0x18A`)을 **파싱 직후** 켜면 그때 `this.sounds` 가
 *   **아직 비어 있어** `ambient()` 가 조용히 `null` 로 끝났다. 번호(`환경음번호`)만
 *   4 로 남고 소리는 안 났다 — `_amb` 가 **한 번도 안 잡혔다**(setter 감시로 확인).
 *
 * ⇒ 「없으면 포기」를 **「준비되면 그때 켠다」**로 바꾼다.
 *   원본에는 없는 사정이다 — 우리는 소리를 **비동기로** 받기 때문이다
 *   (`ensureNativeSound` 가 `fetch` → blob). `리마스터_적용현황.md` 에 적는다.
 * ★ 번호는 이미 `환경음번호` 에 있으므로 **다시 켜기만** 하면 된다.
 * ★ 10 초까지만 기다린다 — 그 뒤엔 포기한다(파일이 없을 수도 있다).
 */
Fx.prototype._환경음대기 = function (name) {
  if (typeof setTimeout !== 'function' || this._amb대기) return;
  var 자신 = this, 남은 = 40;                       /* 40 × 250ms = 10 초 */
  this._amb대기 = setInterval(function () {
    var t = 자신.sounds[String(name)];
    if (t && !t.pending && t.url) {
      clearInterval(자신._amb대기); 자신._amb대기 = null;
      if ((자신.환경음번호 | 0) > 0) 자신.환경음다시켜기();
    } else if (--남은 <= 0) { clearInterval(자신._amb대기); 자신._amb대기 = null; }
  }, 250);
};

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **브라우저 자동재생 차단을 넘는다** — 원본에 없는 제약 (2026-08-28)
 *
 *  > 사용자 ②: 「2-1에도 **물소리같은 배경음**이 있어야해.」
 *  > 「1-1과 1-1a처럼 날씨효과 있는경우 **효과음**이 있어야하는데 … 안나와.」
 *  > 「마크와 하밀 맞았을때 **피격 효과음도 안들려**(비명)」
 *
 *  ☠ 실측(2026-08-28) — `a.play()` 가 **`NotAllowedError`** 로 거부된다:
 *    「play() failed because the user didn't interact with the document first」
 *    그런데 **거부를 잡지 않아** 그대로 끝났다. 환경음은 `op 0x77` 때 **한 번만**
 *    불리므로 그 한 번이 막히면 **그 전투 내내 소리가 없다.**
 *    실측값: `_amb readyState=4 paused=true` — 다 받아 놓고 재생만 안 됐다.
 *
 *  ⇒ 거부되면 **대기열에 넣고, 첫 진짜 조작에서 다시 튼다.**
 *  ★ 원본에 없는 장치다 — `리마스터_적용현황.md` 에 적는다.
 * ══════════════════════════════════════════════════════════════════════ */
var _막힘대기 = [];
var _잠금품 = false;
var _리스너붙임 = false;

/** 환경음을 웹 오디오 버퍼로 틈 없이 되풀이한다 (ambient 주석). 반환 = pause() 를 가진 손잡이 */
var _환경음문맥 = null;
/* ★ 정본 385 — 앱을 뒤로 넘기거나 폰이 대기 모드여도 비 소리(환경음)가 계속 났다
 *   (사장님 11-22 「백그라운드 넘겼을때 소리나는 문제도 있어(모바일) 비오는 소리래. 심지어 폰 대기모드여도 난대.」)
 *   배경음악은 audio.js 가 화면 숨김(visibilitychange)에 멈추는데, 환경음은 따로 웹 오디오 문맥으로 되풀이해 아무도 안 멈췄다
 *   ⇒ 숨으면 문맥을 재우고(suspend) 옛 길(HTML Audio) 환경음도 멈춘다 · 다시 보이면 깨운다 · 숨은 동안엔 새로 켜도 안 깨운다 */
var _환경음엘리먼트 = [], _숨김멈춤 = [];
function 화면숨음() { return typeof document !== 'undefined' && !!document.hidden; }
if (typeof document !== 'undefined' && document.addEventListener) {
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      if (_환경음문맥 && _환경음문맥.state === 'running') { try { _환경음문맥.suspend(); } catch (e) { } }
      _환경음엘리먼트.forEach(function (a) { if (a && !a.paused) { try { a.pause(); } catch (e) { } _숨김멈춤.push(a); } });
      _환경음엘리먼트 = [];   /* 멈춘 것은 _숨김멈춤 이 쥔다 — 끝난 것이 쌓이지 않게 비운다 */
    } else {
      if (_환경음문맥 && _환경음문맥.state === 'suspended') { try { _환경음문맥.resume(); } catch (e) { } }
      var 목 = _숨김멈춤; _숨김멈춤 = [];
      목.forEach(function (a) { if (a.__꺼짐) return; _환경음엘리먼트.push(a); try { var p = a.play(); if (p && p['catch']) p['catch'](function () { }); } catch (e) { } });
    }
  });
}
function 환경음웹재생(fx, s, name) {
  var AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
  if (!AC || !s || !s.pcm || !s.pcm.length) return null;
  try {
    if (!_환경음문맥) _환경음문맥 = new AC();
    var ctx = _환경음문맥;
    if (!s.buf) {
      var n = s.pcm.length, buf = ctx.createBuffer(1, n, s.rate || 11025), ch = buf.getChannelData(0);
      for (var i = 0; i < n; i++) ch[i] = (s.pcm[i] - 128) / 128;     /* 8비트 무부호 → 부동소수 */
      s.buf = buf;
    }
    var src = ctx.createBufferSource(), g = ctx.createGain();
    src.buffer = s.buf; src.loop = true;
    g.gain.value = clamp(0.6 * fx.volume, 0, 1);
    src.connect(g); g.connect(ctx.destination);
    src.start(0);
    if (화면숨음()) { if (ctx.state === 'running') { try { ctx.suspend(); } catch (e3) {} } }   /* 숨은 동안 켜지면 재운 채로 — 보일 때 깨운다 (정본 385) */
    else if (ctx.state === 'suspended') { 리스너붙이기(); try { ctx.resume(); } catch (e0) {} }
    return { _gain: g, _src: src, 이름: name, pause: function () { try { src.stop(); } catch (e1) {} try { src.disconnect(); } catch (e2) {} } };
  } catch (e) { return null; }
}

function 잠금풀기() {
  if (_환경음문맥 && _환경음문맥.state === 'suspended' && !화면숨음()) { try { _환경음문맥.resume(); } catch (e) {} }
  _잠금품 = true;
  var 목 = _막힘대기; _막힘대기 = [];
  목.forEach(function (a) { try { a.play(); } catch (e) { /* 무시 */ } });
}

function 리스너붙이기() {
  if (_리스너붙임 || typeof document === 'undefined') return;
  _리스너붙임 = true;
  ['pointerdown', 'mousedown', 'keydown', 'touchstart'].forEach(function (t) {
    document.addEventListener(t, 잠금풀기, true);
  });
}

/** `play()` 를 걸고, **자동재생 차단이면 대기열에 넣는다.** */
function 재생시도(a, 이름) {
  리스너붙이기();
  var p;
  try { p = a.play(); } catch (e) { p = null; }
  if (p && p['catch']) {
    p['catch'](function (e) {
      if (e && e.name === 'NotAllowedError' && !_잠금품) {
        if (_막힘대기.indexOf(a) < 0) _막힘대기.push(a);
        if (typeof console !== 'undefined' && console.info)
          console.info('[소리] 자동재생이 막혔다 — 첫 조작 때 다시 튼다: ' + (이름 || ''));
      }
    });
  }
  return a;
}

/* ── 날씨 ─────────────────────────────────────────────────────────────── */

/**
 * @param {number} kind 0 없음 · 1 비 · 2 눈 · 3 모래바람 · 4 안개
 *                      (0x4512E 의 점프표 0x4511E 순서 그대로)
 * @param {boolean} on  생략하면 kind 로만 판단합니다
 */
Fx.prototype.weather = function (kind, on, 서서히ms) {
  var 옛 = this.wKind | 0;
  this.wKind = (on === false) ? 0 : (kind | 0);
  if (!this.wKind) { this.wStep = 0; this.wMs = 0; }
  /* [리마스터] 전투 도중 날씨가 바뀌면 알갱이를 서서히 진하게 — 원본은 다음 장면에 한 번에 꽉 찬다(0x4512E)
   *   사장님 11-09 「비 전환 어색한거 자연스럽게 비 연출이 들어오도록 수정해. 갑자기 나타나서 그랬을거야」 */
  this.wIntroTotal = (서서히ms > 0 && this.wKind && this.wKind !== 옛) ? 서서히ms : 0;
  this.wIntroMs = 0;
  return this;
};

/** 현재 날씨 종류에 대응하는 원본 날씨 프레임 시작 번호를 조회한다. */
Fx.prototype._날씨시작프레임 = function () {
  var ks = (this.assets && this.assets['날씨'] && this.assets['날씨']['종류']) || [];
  for (var i = 0; i < ks.length; i++) if (ks[i]['값'] === this.wKind) return ks[i]['시작'];
  return null;
};

/* ── 화면 효과 ────────────────────────────────────────────────────────── */

/**
 * 화면 흔들림 — 0x2C863.
 * 원본은 0x1033B(3) 으로 3틱 간격을 놓고 64번 돌며 매번 [0xBA838] = rand(5)−2 로
 * 세로를 −2~+2 흔든 뒤 0 으로 되돌립니다.
 * @param {number} frames  기본 64
 */
Fx.prototype.shake = function (frames) {
  this.shakeLeft = frames || 64;
  this.shakeMs = 0;
  return this;
};

/**
 * ★★★★★ **세로 흔들기를 값으로 직접 세운다** — `[0xBA838] = n` (2026-09-03)
 *
 * `shake()` 는 「64 번 무작위로 흔들기」이고, 이쪽은 **한 프레임의 값을 못박는** 것이다.
 * 투사체 착탄(종류 9)이 그렇게 쓴다 —
 * ```asm
 * 0x472C7  test di,1 / je              ; 홀수 프레임
 * 0x472CE    [0xBA838] = 0             ;   흔들기 0
 * 0x472D9    edx = 6 − i ; sar 1 ; neg ; ★ 짝수 — −(6−i)/2  (3 → 0 으로 잦아든다)
 * 0x472E9    [0xBA838] = ax
 * ```
 * @param {number} n  세로 오프셋(픽셀). 0 이면 원위치.
 */
Fx.prototype.shakeY = function (n) {
  this.shakeLeft = 0;                  /* 무작위 흔들기와 섞이지 않게 끈다 */
  this.shakeOff.y = n | 0;
  return this;
};

/**
 * 화면 전체 단색 덮기 — 흰 플래시 0x2D48A (팔레트 256칸을 0x3F 로 채웠다 되돌림).
 * @param {string} color  기본 '#fff'.  붉은 페이드(0x1E565)는 '#f00'
 * @param {number} frames 유지할 게임 프레임(=틱) 수. 기본 3
 */
Fx.prototype.flash = function (color, frames) {
  this.flashColor = color || '#fff';
  this.flashLeft = (frames === undefined ? 3 : frames) * TICK_MS;
  return this;
};

/**
 * 서서히 덮었다 걷히는 페이드.
 *
 * ★★★★★ **원본은 오르는 시간과 내리는 시간이 다르다** — `0x1E565` (2026-09-03)
 *
 *   ```asm
 *   0x1E570  mov edx,eax · 0x1E572 test ax,ax · je 끝      ; ★ 인자 0 이면 아무것도 안 한다
 *   0x1E57B  ah = 0x3F · bl = 0                            ;   색 = (63, 0, 0) — 붉은색
 *   0x1E5B0  cmp dx,2 · jne 0x1E5E4                        ; ★ **인자가 2 일 때만**
 *   0x1E5B6    push 0x32(50) → 0x49A3E                     ;     50 프레임 붉게
 *   0x1E5CD    push 0x19(25) → 0x49A3E                     ;     25 프레임 복귀
 *   0x1E5E4  push 0x14(20) → 0x49A3E                       ;   20 프레임 붉게
 *   0x1E5FB  push 0x0A(10) → 0x49A3E                       ;   10 프레임 복귀
 *   ```
 *   ⇒ 인자 **2**(일격필살) 는 `50+25` 를 하고 **이어서** `20+10` 을 또 한다.
 *     그 밖(0 이 아닌 값) 은 `20+10` 만.
 *
 * @param {string} color  기본 '#000'. 붉은 페이드(`0x1E565`)는 '#f00'
 * @param {number} ms     오르는 시간(ms). 뒤 인자가 없으면 예전처럼 **절반씩** 나눠 쓴다
 * @param {number} [내림ms] 걷히는 시간(ms). 주면 오름/내림이 갈린다
 */
Fx.prototype.fade = function (color, ms, 내림ms) {
  this.fadeColor = color || '#000';
  this.fadeUp = (내림ms != null) ? (ms || 0) : null;      /* null 이면 옛 대칭 방식 */
  this.fadeDown = (내림ms != null) ? (내림ms || 0) : 0;
  this.fadeTotal = this.fadeMs = (내림ms != null) ? ((ms || 0) + (내림ms || 0)) : (ms || 600);
  return this;
};

/* ── 진행 ─────────────────────────────────────────────────────────────── */

Fx.prototype.update = function (dtMs) {
  var i, a;

  /* ★★★ **맵 애니메이션은 둘 다 여기서 돌린다** (2026-08-16)
   *
   *   바닥(`0x7EBAC`)·오브젝트(`0x7D824`) 모두 원본은 **같은 진행기 `0x10A30`**
   *   으로 굴린다. 그런데 `tileAnim()` 은 바깥에서 부르게 돼 있는데 **실제로는
   *   안 닿는다** — 손으로 부르면 정상으로 도는데(바닥 9종·오브젝트 50개)
   *   화면에는 0개였다. `update()` 는 rAF 마다 확실히 불리므로 여기로 모은다. */
  try { this.오브젝트애니(dtMs); } catch (e) { }
  try { this.tileAnim(null, dtMs); } catch (e) { }

  /* 이펙트 프레임 진행 — 0x1033B 이 놓은 간격만큼 지날 때마다 한 장 */
  for (i = 0; i < this.active.length; i++) {
    a = this.active[i];
    if (a.dead) continue;
    a.ms += dtMs;
    while (a.ms >= a.step) {
      a.ms -= a.step;
      if (a.tx !== null) {
        /* 비행 — 목표까지 5스텝 직선 보간 (0x201ED `mov ebx,5` + idiv).
         * 그동안 지금 구간을 되풀이하고, 도착하면 '명중' 구간으로 넘어갑니다. */
        a.t = clamp(a.t + 1 / 5, 0, 1);
        a.frame++;
        if (a.frame >= a.to) a.frame = a.from;
        if (a.t >= 1) this._비행도착(a);
        continue;
      }
      a.frame++;
      /* ★ 프레임마다 픽셀만큼 움직인다 — 「살」 1단계 `0x2D72E esi+=7` · `0x2D734 edi+=5` */
      if (a.걸음) { a.dx += (a.걸음.x | 0); a.dy += (a.걸음.y | 0); }
      /* ★ 그 장에 닿으면 흰 플래시 — 검 반 `0x2D63A cmp esi,4` → `0x2D649 eax=0xA` */
      if (a.장플래시 && (a.frame - a.from) === (a.장플래시.장 | 0)) {
        this.flash('#fff', (a.장플래시.틱 | 0) || 10);       /* 0x2D48A */
      }
      if (a.frame >= a.to) {
        /* ★★★★★ **한 바퀴가 아니라 여러 바퀴 도는 연출이 있다** (2026-09-03)
         *   검 제 `0x2D527` : 프레임 = `cx mod 8`(`0x2D53F ebx=8` · `idiv`) 을
         *                     `0x2D591 cmp cx,0x18` **24 회** → **8 장 × 3 바퀴**
         *   검 반 `0x2D5A3` : `cx mod 5`(`0x2D5ED ebx=5`) 를
         *                     `0x2D659 cmp cx,0xA` **10 회** → **5 장 × 2 바퀴**
         *   ☠ 우리는 한 바퀴만 돌고 끝냈다. */
        if (a.남은바퀴 > 1) { a.남은바퀴--; a.frame = a.from; }
        else if (a.loop) a.frame = a.from;
        else { a.frame = a.to - 1; a.dead = true; break; }
      }
    }
    if (!a.dead) this._인스턴스동기화(a);
  }
  this._끝난효과거두기();

  /* 빙룡소환 `0x22D18`: 상승은 5틱, 조각장은 3틱이다. */
  /* [리마스터] 발사점 x — 원본 rand(0x118)+20(320 폭 안) · 넓은 캔버스가 켜져 있으면 보이는 폭 전체에서 (11-09 「…아이스드래곤도 뷰포트 전역으로」) */
  var self넓 = this, 넓은x = function (sc, rr) { var 넓 = self넓.날씨넓게 && self넓.넓은화면; if (!넓 || !(넓.w > 320)) return (rr(280) | 0) + 20; return Math.round(넓.x0) + (rr(Math.round(넓.w) - 40) | 0) + 20; };
  for (i = 0; i < this.screenActive.length; i++) {
    var sc = this.screenActive[i];
    if (!sc || sc.dead) continue;
    sc.ms += dtMs;
    while (!sc.dead && sc.ms >= sc.step) {
      sc.ms -= sc.step;
      if (sc.phase === 'rise') {
        sc.y -= 15;                                             // 0x22D95
        if (sc.y <= -100) {                                    // 0x22D70
          sc.phase = 'shards'; sc.step = 3 * TICK_MS;           // 0x22DE3
          /* ★ 발사점 다섯의 나이 처음값 = 표 0x1FD9A 5·10·15·20·8 (0x22D35 esi → [esp+0x9c]) — 한 번에 다 떨어지지 않고 어긋나 떨어진다
           *   (2026-09-26 · ☠ 예전 모두 0) · 난수는 y 먼저 (0x22DAB rand(0x82) → 0x22DC5 rand(0x118)) */
          var 첫나이 = [5, 10, 15, 20, 8];
          for (var ei = 0; ei < 5; ei++) sc.emitters.push((function (나이) {
            var rr = sc.rng, y = -(rr(130) | 0) - 50;
            return { x: 넓은x(sc, rr), y: y, age: 나이 };
          })(첫나이[ei]));
          for (var si = 0; si < 25; si++) sc.shards.push({ active: false, x: 0, y: 0, frame: (si % 5) + 2 });
        }
        continue;
      }

      if (sc.budget <= 0) { sc.done(); break; }                 // 0x22E13
      for (ei = 0; ei < 5; ei++) {
        var em = sc.emitters[ei];
        if (em.age === 20) {                                    // 0x22E2F — 남은 수는 루프 머리(0x22DF2)에서만 본다
          for (var sj = 0; sj < 5; sj++) {
            var sh = sc.shards[ei * 5 + sj];
            sh.active = true; sh.x = em.x + 10; sh.y = em.y + 10;
          }
          em.y = -(sc.rng(130) | 0) - 50;                        // 0x22E86 rand(0x82) 먼저
          em.x = 넓은x(sc, sc.rng);                              // 0x22E9D rand(0x118) · [리마스터] 넓은 화면이면 보이는 폭 전체
          em.age = 0; sc.budget--;
        }
        em.age++; em.y += 10;
      }
      for (si = 0; si < 25; si++) {
        sh = sc.shards[si]; if (!sh.active) continue;
        if ((si % 5) === 0) sh.y -= 10;
        else if ((si % 5) === 1) { sh.x -= 10; sh.y -= 10; }
        else if ((si % 5) === 2) { sh.x += 10; sh.y -= 10; }
        else if ((si % 5) === 3) { sh.x -= 10; sh.y += 10; }
        else { sh.x += 10; sh.y += 10; }
      }
      sc.shake = sc.shake ? 0 : -6;                             // 0x22F02
      if (sc.shakeFn) sc.shakeFn(sc.shake);
      /* [리마스터] 창1 바하무트 0x217BB~0x217CA — 장 끝에 남은 수가 4 의 배수면 슬롯 6 b-ice.ssp.
       *   창1 은 장마다 부르는데 소리 구동부가 다시 트는지 못 가렸다 — 끊겨 들리지 않게 «그 값이 되는 장에 한 번» */
      if (sc.soundFn && (sc.budget % 4) === 0 && sc.budget !== sc.옛남은) { sc.옛남은 = sc.budget; try { sc.soundFn('얼음'); } catch (e소2) {} }
    }
  }
  this.screenActive = this.screenActive.filter(function (s) { return s && !s.dead; });

  /* 화면 흔들림 — 3틱마다 한 번, y 를 −2~+2 로 */
  if (this.shakeLeft > 0) {
    this.shakeMs += dtMs;
    while (this.shakeMs >= 3 * TICK_MS && this.shakeLeft > 0) {
      this.shakeMs -= 3 * TICK_MS;
      this.shakeLeft--;
      /* ★ 원본을 직접 뜯어 검산했다 (2026-09-09) — 값 셋이 한 자리도 안 틀린다:
       *   0x2C864 mov eax,3   → 0x2C869 call 0x1033B   ; 간격 **3틱**
       *   0x2C870 mov eax,5   → 0x2C875 call 0x499BD   ; rand(5) → 0~4
       *   0x2C87A sub eax,2                            ; ★ −2 → **−2~+2**
       *   0x2C88E cmp dx,0x40 → jl                     ; **64회**
       *   0x2C896 [0xBA838] = 0                        ; 끝나면 되돌림
       *   ☠ `0x472C5` 는 **다른 흔들림**이다 — 6회 · `−3,0,−2,0,−1,0` · 간격 16.
       *     그쪽은 매 회 `0x454B3`(맵 다시 그리기)를 부른다. 섞지 않는다. */
      this.shakeOff.y = (Math.random() * 5 | 0) - 2;      /* 0x2C870 rand(5) · 0x2C87A −2 */
    }
    if (this.shakeLeft <= 0) { this.shakeOff.x = 0; this.shakeOff.y = 0; }
    if (this.renderer) {
      this.renderer.shake.x = this.shakeOff.x;
      this.renderer.shake.y = this.shakeOff.y;
      this.renderer.apply();
    }
  }

  if (this.flashLeft > 0) this.flashLeft -= dtMs;
  if (this.fadeMs > 0) this.fadeMs -= dtMs;

  if (this.wIntroTotal > 0) { this.wIntroMs += dtMs; if (this.wIntroMs >= this.wIntroTotal) this.wIntroTotal = 0; }   /* [리마스터] 날씨 서서히 */
  /* 날씨 — [0xFA8B0] = (직전+1) mod 9, 30틱마다 (0x450F9) */
  if (this.wKind) {
    this.wMs += dtMs;
    while (this.wMs >= WEATHER_TICKS * TICK_MS) {          /* 0x10213 15틱 · 0x1024B 30틱 */
      this.wMs -= WEATHER_TICKS * TICK_MS;
      this.wStep = (this.wStep + 1) % 9;                   /* 0x4510F idiv 9 */
    }
  }
  return this;
};

/* ── 맵 타일 애니메이션 ───────────────────────────────────────────────── */

/**
 * 진행기 0x10A30 을 그대로 옮긴 것입니다.
 *   다음 = 프레임[인덱스+1];  다음 == −1 이거나 인덱스 ≥ 8 이면 인덱스 = 0, 아니면 인덱스++
 * (프레임 배열은 이미 −1 앞에서 끊어 두었으므로 여기서는 길이로 판단합니다)
 *
 * 원본은 바닥(0x7EBAC)과 오브젝트(0x7D824) 두 표를 같은 방식으로 굴립니다.
 * 지금 맵(FR08)은 오브젝트 표가 비어 있어 fx.json 의 `오브젝트그룹` 도 빈 배열입니다.
 *
 * @param {object} battle  G2State.Battle (없어도 됩니다 — 칸 목록은 fx.json 에 있습니다)
 * @param {number} dtMs
 * @return {Array} 바뀐 칸 [{x, y, 타일, 시트칸}] — 첫 호출은 전부 돌려 줍니다
 */
/* ★★★ **애니 칸을 지금 맵에서 뽑는다** (2026-08-16)
 *
 *   사용자 지적 둘:
 *   ① 「계속 따라다니는 저 2-4a용 폭포 (…) **그 맵에 한정**해야해」
 *   ② 「다만 여기에는 필드에 **풀들이 움직이는 효과**가 있던걸로 기억해」(P01)
 *
 *   전에는 `fx.json` 의 `타일애니메이션.그룹`(= **FR08 기준 추출본**)을 썼다.
 *   칸 좌표가 그 맵 폭포 자리에 박혀 있어 **어느 맵을 열어도 폭포가 따라다녔고**,
 *   그걸 「FR08 에서만 돌린다」로 막았더니 이번엔 **P01 의 풀이 안 움직였다.**
 *   둘 다 같은 원인이다 — **표를 추출본에서 가져온 것.**
 *
 *   ★ 원본은 **맵 파일 안에 표를 갖고 있다** (`전투데이터_추출.md` §2):
 *     「맵 파일 끝의 `w × 20바이트` 열 메타가 곧 EXE 의 `0x7EBAC`(레이어1
 *      프레임표)이고, `N × 20바이트` 블록 메타가 `0x7D824`」.
 *     `native.js` 가 이미 `map.tileAnim`(타일당 u16×10, `0xFFFF` 종료)으로
 *     읽어 두고 있었다 — **쓰기만 하면 됐다.**
 *
 *   그래서 이제 맵을 훑어 **길이 ≥ 2 인 프레임표를 가진 칸**을 애니 칸으로 모은다.
 *   맵이 바뀌면 저절로 따라간다 — 맵 이름을 검사할 필요가 없다.
 *   진행기는 원본 `0x10A30` 그대로(30틱마다 한 걸음). */
Fx.prototype._맵애니칸 = function () {
  this._렌더러확인();
  var R = this.renderer, m = R && R.nmap;
  if (!m || !m.tileAnim) return null;
  /* 맵이 바뀌면 다시 모은다 */
  var W = m.W | 0, H = m.H | 0;
  var 키 = W + 'x' + H + ':' + (m.tileAnim.length | 0);
  if (this._애니원본맵 === m && this._애니키 === 키 && this._애니칸) return this._애니칸;
  if (!m.layerA || !W || !H) return null;
  /* `layerA` 는 **1-based** 타일값이다 (`native.js mapGround`: `ti = layerA − 1`) */
  var 묶음 = {};                                    // 타일값 → { 프레임[], 칸[] }
  for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
    var ti = m.layerA[y * W + x] - 1;
    if (ti < 0 || ti >= m.tileAnim.length) continue;
    var an = m.tileAnim[ti];
    if (!an || an.length < 2) continue;
    var g = 묶음[ti] || (묶음[ti] = { 프레임: an, 칸: [] });
    g.칸.push([x, y]);
  }
  var 목록 = Object.keys(묶음).map(function (k) { return 묶음[k]; });
  this._애니키 = 키; this._애니칸 = 목록; this._애니원본맵 = m;
  this.tileIdx = null; this.tileFirst = true; this.tileMs = 0; // 맵이 바뀌었으니 위상·잔여 틱도 초기화
  if (목록.length) {
    var 칸수 = 목록.reduce(function (a, g2) { return a + g2.칸.length; }, 0);
    console.log('[타일애니] 맵에서 ' + 목록.length + '종 · ' + 칸수 + '칸 (원본 열메타)');
  }
  return 목록;
};

/* ★★★ **오브젝트 애니메이션** — 원본 블록 표 `0x7D824` (2026-08-16)
 *
 *   바닥(`0x7EBAC`)과 **같은 진행기 `0x10A30`** 을 쓴다(30틱마다 한 걸음).
 *   `render.js _buildObjectsNative` 가 애니 블록으로 그린 조각을
 *   `R.animObjEls[블록번호]` 에 모아 두므로, 여기서는 **배경만 갈아 끼운다.**
 *
 *   맵마다 어느 표를 쓰는지가 다르다 — `FR08` 은 바닥(폭포), `P01`·`AST`·`PAN`
 *   은 오브젝트(풀). 그래서 **둘 다 돌려야** 한다. */
Fx.prototype.오브젝트애니 = function (dtMs) {
  this._렌더러확인();          /* ★ 체인으로 렌더러가 바뀌었으면 따라간다 */
  var R = this.renderer, m = R && R.nmap;
  if (!R || !m || !m.blockAnim || !R.animObjEls) return 0;
  /* 같은 Renderer 에 다른 MAP 을 직접 설치할 수도 있다. 블록 번호가 같아도
   * 이전 MAP 의 프레임 번호·잔여 틱을 새 표에 넘기지 않는다. */
  if (this._objAnimMap !== m) {
    this._objAnimMap = m; this.objIdx = null; this.objMs = 0;
  }
  var 키들 = Object.keys(R.animObjEls);
  if (!키들.length) return 0;

  if (!this.objIdx) { this.objIdx = {}; this.objFirst = true; }
  this.objMs = (this.objMs || 0) + (dtMs || 0);
  var steps = 0;
  while (this.objMs >= STEP_TICKS * TICK_MS) { this.objMs -= STEP_TICKS * TICK_MS; steps++; }
  if (!steps && !this.objFirst) return 0;

  var 바뀜 = 0;
  for (var i = 0; i < 키들.length; i++) {
    var bi = 키들[i] | 0, an = m.blockAnim[bi];
    if (!an || an.length < 2) continue;
    var k = this.objIdx[bi] || 0, 이전k = k;
    if (steps) {
      /* 원본 진행기와 같은 규칙: 다음이 없거나 8 을 넘으면 0 으로 (`0x10A30`) */
      for (var s2 = 0; s2 < steps; s2++) k = (k + 1 >= an.length || k + 1 > 8) ? 0 : k + 1;
      this.objIdx[bi] = k;
    }
    /* 프레임 URL 적용이 실패해도 진단의 현재 프레임 증거는 달라진다. */
    if (k !== 이전k && root.G2Map3DUAuthoringDraft &&
        typeof root.G2Map3DUAuthoringDraft.onObjectAnimationChanged === 'function') {
      try { root.G2Map3DUAuthoringDraft.onObjectAnimationChanged(R, bi); } catch (_) {}
    }
    var 새블록 = an[k];
    if (새블록 == null || 새블록 < 0) continue;
    var url = R.blockUrl ? R.blockUrl(새블록) : null;
    if (!url) continue;
    var 목록 = R.animObjEls[bi];
    var 묶음바뀜 = 0;
    var 크기필요 = 목록.some(function (it) { return it.bottom != null; });
    var 프레임 = 크기필요 && m.decodeBlock ? m.decodeBlock(새블록) : null;
    for (var j = 0; j < 목록.length; j++) {
      var it = 목록[j];
      if (it.el._animUrl === url) continue;
      it.el._animUrl = url;
      it.el.style.backgroundImage = 'url(' + url + ')';
      /* 공통 묶음의 평면 조각과 기울임 판 자식은 같은 논리 밑변에 붙인다.
       * 프레임 크기만 바뀌어도 부모의 원본 행 정렬값은 건드리지 않는다. */
      if (it.bottom != null && 프레임 && 프레임.w > 0 && 프레임.h > 0) {
        it.el.style.width = (프레임.w + it.seam) + 'px';
        it.el.style.height = 프레임.h + 'px';
        it.el.style.top = (it.bottom - 프레임.h) + 'px';
        if (root.G2Scaler && root.G2Scaler.N() > 1)
          it.el.style.backgroundSize = 프레임.w + 'px ' + 프레임.h + 'px';
      }
      it.el._블록memo = null;           /* render.js _오브젝트색칠하기 가 기억한 블록 번호를 버린다 */
      /* 팔레트 색칠 캔버스(render.js _오브젝트색칠하기)가 덮고 있으면 옛 장이 남는다 — 걷는다. url 은 지금 팔레트로 구운 것이다 */
      if (it.el._블록캔버스) { if (it.el._블록캔버스.parentNode) it.el._블록캔버스.parentNode.removeChild(it.el._블록캔버스); it.el._블록캔버스 = null; it.el._블록원url = null; }
      바뀜++;
      묶음바뀜++;
    }
    if (묶음바뀜 && root.G2Map3DUAuthoringDraft &&
        typeof root.G2Map3DUAuthoringDraft.onObjectAnimationChanged === 'function') {
      try { root.G2Map3DUAuthoringDraft.onObjectAnimationChanged(R, bi); } catch (_) {}
    }
  }
  this.objFirst = false;
  return 바뀜;
};

/** 경과 시간만큼 원본 타일·날씨 프레임을 진행해 현재 렌더러에 반영한다. */
Fx.prototype.tileAnim = function (battle, dtMs) {
  this._렌더러확인();          /* ★ 체인으로 렌더러가 바뀌었으면 따라간다 */
  /* ★★★ **추출본으로 물러나지 않는다** (2026-08-16 · 사용자 「폭포 또 나왔어」)
   *
   *   맵 표(`_맵애니칸`)가 아직 `null`(맵이 늦게 도착) 일 때 예전 `fx.json` 그룹으로
   *   물러나게 뒀더니, **P01 에 FR08 폭포가 또 떴다.** 추출본은 좌표가 FR08 에
   *   박혀 있어 **어느 맵에 놓아도 틀린다.** 맵 표가 없으면 **아무것도 안 그린다.**
   *
   *   ★ 이미 붙은 칸이 있으면 걷어낸다 — 맵을 갈아탔거나 늦게 준비된 경우. */
  var 맵그룹 = this._맵애니칸();
  if (!맵그룹 || !맵그룹.length) {
    var R0 = this.renderer;
    if (R0 && R0.tileEls && Object.keys(R0.tileEls).length) {
      Object.keys(R0.tileEls).forEach(function (k) {
        var e0 = R0.tileEls[k]; if (e0 && e0.parentNode) e0.parentNode.removeChild(e0);
        delete R0.tileEls[k];
      });
    }
    return [];
  }
  var groups = 맵그룹;
  if (!this.tileIdx) {
    this.tileIdx = [];
    for (var g = 0; g < groups.length; g++) this.tileIdx.push(0);
  }

  var steps = 0;
  this.tileMs += dtMs || 0;
  while (this.tileMs >= STEP_TICKS * TICK_MS) { this.tileMs -= STEP_TICKS * TICK_MS; steps++; }
  if (!steps && !this.tileFirst) return [];

  var out = [];
  for (var i = 0; i < groups.length; i++) {
    var gr = groups[i], len = gr['프레임'].length;
    if (steps) {
      var k = this.tileIdx[i];
      for (var s = 0; s < steps; s++) k = (k + 1 >= len || k + 1 > 8) ? 0 : k + 1;
      this.tileIdx[i] = k;
    }
    /* ★ 맵 표에서 뽑은 그룹은 `시트칸` 이 없다 — 추출 시트를 안 쓰기 때문이다.
     *   (그 자리를 그냥 읽어서 `Cannot read properties of undefined (reading '0')`
     *    로 터졌다 — 사용자 화면 오류 2026-08-16.) */
    var cell = gr['시트칸'] ? gr['시트칸'][this.tileIdx[i]] : null;
    for (var c = 0; c < gr['칸'].length; c++) {
      out.push({ x: gr['칸'][c][0], y: gr['칸'][c][1],
                 '타일': gr['프레임'][this.tileIdx[i]], '시트칸': cell });
    }
  }
  this.tileFirst = false;

  /* render.js 를 붙였으면 바로 반영합니다.
   *
   * ★ 그림은 **지금 띄운 `.MAP` 의 블록**입니다 (할일 19-d). `out[q]['타일']` 이
   *   곧 블록 번호라, 추출 시트(`fx/tiles.png`)의 칸을 골라 쓸 이유가 없습니다.
   *   `render.js _blockURL` 이 `decodeBlock` → 캔버스로 이미 굽고 있습니다.
   *   시트가 없어야 맵이 바뀌어도 자동으로 따라옵니다. */
  var R = this.renderer;
  if (R) {
    /* ★ 그림은 **지금 띄운 `.MAP` 의 블록**뿐이다 — 추출 시트로 물러나지 않는다.
     *   (예전엔 `ta.png` 시트 경로가 있었는데, 그 좌표가 FR08 에 박혀 있어
     *    다른 맵에서 폭포가 샜다. `ta` 참조도 함께 걷어냈다 — 남겨 뒀다가
     *    `ReferenceError: ta is not defined` 로 터졌다.) */
    /* ★ 그룹 변수 길 (2026-10-10 사장님 「19-1 해전인데 일단 너무 느리고」) — 칸은 처음 한 번 만들고 걸음마다 그룹 변수 하나만 바꾼다.
     *   ☠ 칸마다 tileCell 로 스타일 글을 고쳐 쓰면 바다 맵 3,600칸에서 한 장 255ms (render.js 애니그룹그림 주석) */
    /* ★★ 애니 판 길 (2026-10-10) — 칸 요소 없이 캔버스 한 장(render.js 애니판그룹 주석) */
    if (R.애니판그룹 && R.nmap) {
      for (var ai = 0; ai < groups.length; ai++)
        R.애니판그룹(ai, groups[ai]['프레임'][this.tileIdx[ai]], groups[ai]['칸']);
      return out;
    }
    if (R.애니그룹그림 && R.애니그룹칸 && R.tileUrl && R.nmap) {
      for (var gi = 0; gi < groups.length; gi++) {
        var gtile = groups[gi]['프레임'][this.tileIdx[gi]];
        var gurl = R.tileUrl(gtile);
        if (!gurl) continue;
        R.애니그룹그림(gi, gurl);
        var 칸목 = groups[gi]['칸'];
        for (var gc = 0; gc < 칸목.length; gc++) R.애니그룹칸(gi, 칸목[gc][0], 칸목[gc][1], gtile, gurl);
      }
      return out;
    }
    for (var q = 0; q < out.length; q++) {
      /* ★ 바닥 애니는 **레이어A 타일 번호**다 — `blockUrl`(레이어B) 이 아니라
       *   `tileUrl` 을 써야 한다. 섞어 쓰다가 폭포가 한 칸도 안 붙었다. */
      /* ★ 주소(PNG) 하나를 칸들이 나눠 쓴다 — 칸마다 캔버스로 칠하지 않는다 (2026-10-07 되돌림)
       *   사장님(원문) 「지금 전투가 더 느려졌어 … 심각하게 느려졌어」 · 「기울기 배율 스케일러 키고 와이번 섬 전투 진입했는데 심각하게 느려」
       *   ☠ 10-06 선라이트 끊김 때 여기도 R.tileCanvas(칸마다 캔버스)로 바꿨더니 7-3(바다) 물결 칸 966개가 저마다 캔버스·그래픽 층이 되고
       *     물결이 바뀔 때마다 966번 따로 칠했다(시험 탭 실측: 무대 캔버스 1,096 중 966 이 g2-anim-tile).
       *   같은 타일 번호는 그림이 같으므로 주소 하나면 된다 — 팔레트가 바뀌어도 다시 굽는 것은 «타일 종류 수»뿐이다. */
      var url = (R.tileUrl && R.nmap) ? R.tileUrl(out[q]['타일']) : null;
      if (!url) continue;
      var e = R.tileCell(url, out[q].x, out[q].y, out[q]['타일']);
      e.style.backgroundPosition = '0 0';
    }
  }
  return out;
};

/* ── 그리기 (320×200 논리 화면 캔버스) ────────────────────────────────── */

/** 날씨 타일 깔기 — 0x4512E 그대로 · (dx, dy) = 이 캔버스 안에서 #fx 원점이 놓인 자리(넓은 캔버스용 · #fx 는 0,0)
 *   첫 열 프레임+1 은 #fx 의 첫 열(경계를 무는 열) 기준 그대로 */
/** 화면 고정 원본 연출(빙룡소환 0x22D18) 칠하기 — (dx,dy) = #fx 원점의 그 캔버스 논리 자리 · 넓은 캔버스면 아래 끝도 그 캔버스 높이 (11-09) */
Fx.prototype.화면연출칠하기 = function (ctx, dx, dy) {
  dx = dx || 0; dy = dy || 0;
  var 넓 = this.날씨넓게 && this.넓은화면, 아래 = 넓 ? Math.max(200, (넓.y0 | 0) + (넓.h | 0)) : 200;
  for (var si = 0; si < this.screenActive.length; si++) {
    var sc = this.screenActive[si];
    if (!sc || sc.dead) continue;
    if (sc.phase === 'rise') {
      var rf = sc.frames[0];
      /* ★ 0x22D98 0x5F305 반투명 — 0x22D4A 0x61147(색 0x18 · 강도 50): 용 몸통(색 24 · 칠한 점의 96%)을 바탕과 반반 섞는다
       *   ☐ 가장자리 색(7·6·0…) 4% 는 원본이 불투명 — 우리는 그림 전체에 0.5 */
      var 옛알 = ctx.globalAlpha; ctx.globalAlpha = 0.5;
      ctx.drawImage(rf.canvas, (sc.x + (rf.ax | 0) + dx) | 0, (sc.y + (rf.ay | 0) + dy) | 0);
      ctx.globalAlpha = 옛알;
      continue;
    }
    var ef = sc.frames[1];
    for (var ei = 0; ei < sc.emitters.length; ei++) {
      var em = sc.emitters[ei];
      /* ★ 0x22EEF cmp y,−30 · 0x22EF4 cmp [esp+0xb4](= y),0xC8 — «세로로 화면 안»일 때만 (2026-09-26 사장님 「빙룡소환 떨어지는 얼음이 중앙을 기준으로 좌측에 쏠린 느낌이야」 · ☠ 둘째를 x 로 옮겨 x ≥ 200 오른쪽이 안 그려졌다) */
      if (em.y > -30 && em.y < 아래)
        ctx.drawImage(ef.canvas, (em.x + (ef.ax | 0) + dx) | 0, (em.y + (ef.ay | 0) + dy) | 0);
    }
    for (var pi = 0; pi < sc.shards.length; pi++) {
      var sh = sc.shards[pi]; if (!sh.active || !(sh.y > -30 && sh.y < 아래)) continue;   /* 0x23011·0x23016 — y 조건 (예전 x ≥ 200 을 뺐다) */
      var pf = sc.frames[sh.frame];
      ctx.drawImage(pf.canvas, (sh.x + (pf.ax | 0) + dx) | 0, (sh.y + (pf.ay | 0) + dy) | 0);
    }
  }
};

Fx.prototype.날씨칠하기 = function (ctx, W, H, dx, dy) {
  var start = this._날씨시작프레임();
  var wa = this.assets && this.assets['날씨'];
  if (!this.wKind || start === null || !wa) return;
  if (!wa.url && wa._frames) this.날씨굽기();   /* 정본 400 — 처음 그릴 때 굽는다 (setNativeWeather 주석) */
  var wi = this._시트정보(wa); if (!wi) return;
  var tw = wa['타일'][0], th = wa['타일'][1];
  var f0 = start + this.wStep * 2;
  var f1 = start + ((this.wStep * 2 + 1) % 18);
  var ox = -(((this.cam.x * TW) % tw) + tw) % tw + (dx || 0);   /* #fx 첫 열 자리 */
  var oy = -(((this.cam.y * TH) % th) + th) % th + (dy || 0);
  var k0 = Math.ceil(ox / tw), j0 = Math.ceil(oy / th);          /* 왼·위로 더 깔 칸 수 */
  var 옛알 = ctx.globalAlpha;
  if (this.wIntroTotal > 0) ctx.globalAlpha = 옛알 * Math.max(0, Math.min(1, this.wIntroMs / this.wIntroTotal));   /* [리마스터] 서서히 진하게 */
  for (var cx = -k0; ox + cx * tw < W; cx++) {
    for (var cy = -j0; oy + cy * th < H; cy++) {
      var f = wa['프레임'][cx === 0 ? f1 : f0];
      ctx.drawImage(wi, f.x, f.y, f.w, f.h, ox + cx * tw, oy + cy * th, tw, th);
    }
  }
  ctx.globalAlpha = 옛알;
};

Fx.prototype.draw = function (ctx) {
  if (!ctx) return this;
  var W = this.view.w, H = this.view.h;

  /* 이펙트 — DOM 모드가 아닐 때만. 맵 픽셀 → 화면 픽셀은 카메라 평행이동뿐입니다
   * (0x10971 : 화면x = (타일x − 카메라x)×24 + 흔들림x). */
  if (!this.renderer) {
    for (var i = 0; i < this.active.length; i++) {
      var a = this.active[i];
      var im = this._시트정보(a.def);
      if (!im) continue;                       // _시트정보 가 준비 여부까지 봅니다
      var p = this._현재프레임(a), fr = p.fr;
      var sx = p.x - this.cam.x * TW + this.shakeOff.x;
      var sy = p.y - this.cam.y * TH + this.shakeOff.y;
      ctx.drawImage(im, fr.x, fr.y, fr.w, fr.h,
                    Math.round(sx), Math.round(sy),
                    Math.round(fr.w * a.scale), Math.round(fr.h * a.scale));
    }
  }

  /* 화면 고정 빙룡소환 — 넓은 캔버스(battle_main 넓은비)가 켜져 있으면 그쪽이 화면 전체에 그린다 (11-09 사장님 「파이어드래곤, 아이스드래곤도 뷰포트 전역으로 해야해.」) */
  if (!this.날씨넓게) this.화면연출칠하기(ctx, 0, 0);

  /* 날씨 — 144×96 타일을 카메라 오프셋만큼 밀어 이어 깝니다 (0x4512E).
   * 화면 경계를 무는 첫 열은 프레임+1 을 씁니다 (0x45199 inc eax). */
  if (!this.날씨넓게) this.날씨칠하기(ctx, W, H, 0, 0);   /* [리마스터] 넓게(폭풍검 비)면 battle_main 넓은비 캔버스가 화면 전체에 깐다 */

  /* 흰 플래시 0x2D48A · 붉은 페이드 0x1E565
   *   ★ 화면 전체 한 색 공통 창구(render.js 화면한색)로 낸다 (2026-10-13 · 팔레트 정리 ①) — 원본은 DAC 전체라 HUD 까지 물든다.
   *     기록기(__우리기록)가 켜졌을 때만 예전처럼 이 캔버스에 칠한다(기록기가 캔버스를 읽는 길을 지킨다). */
  var 덮개R = (this.renderer && this.renderer.화면한색 && !(root.__우리기록 && root.__우리기록.켜짐)) ? this.renderer : null;
  if (덮개R) {
    if (this.flashLeft > 0) { 덮개R.화면한색('g2-fx-flash', this.flashColor, 1); this._번쩍덮개 = true; }
    else if (this._번쩍덮개) { 덮개R.화면한색('g2-fx-flash', null, 0); this._번쩍덮개 = false; }
  } else if (this.flashLeft > 0) {
    ctx.save(); ctx.globalAlpha = 1; ctx.fillStyle = this.flashColor;
    ctx.fillRect(0, 0, W, H); ctx.restore();
  }
  if (덮개R && !(this.fadeMs > 0 && this.fadeTotal > 0) && this._페이드덮개) { 덮개R.화면한색('g2-fx-fade', null, 0); this._페이드덮개 = false; }
  if (this.fadeMs > 0 && this.fadeTotal > 0) {
    var t = 1 - this.fadeMs / this.fadeTotal;           // 0 → 1
    var al;
    if (this.fadeUp != null && this.fadeTotal > 0) {
      /* ★ 오름·내림이 갈린 경우 — `0x1E565` 의 20/10 처럼 */
      var 지난 = this.fadeTotal - this.fadeMs;
      al = (지난 < this.fadeUp)
        ? (this.fadeUp > 0 ? 지난 / this.fadeUp : 1)
        : (this.fadeDown > 0 ? 1 - (지난 - this.fadeUp) / this.fadeDown : 0);
    } else {
      al = t < 0.5 ? t * 2 : (1 - t) * 2;
    }
    if (덮개R) { 덮개R.화면한색('g2-fx-fade', this.fadeColor, clamp(al, 0, 1)); this._페이드덮개 = true; }
    else { ctx.save(); ctx.globalAlpha = clamp(al, 0, 1); ctx.fillStyle = this.fadeColor;
    ctx.fillRect(0, 0, W, H); ctx.restore(); }
  }
  return this;
};

/* ── 발소리 — 0x16123 ────────────────────────────────────────────────────
 *
 * `0x1620A` 의 걷기 루프가 **칸마다 한 번** `0x16123(ebx=유닛, eax=x, dl=y)` 을 불러
 * `word[0xEDD7E]` 에 종류를 받고, `> −1` 이면 `0x4F4CD(종류 + 0x0B)` 로 냅니다.
 * (상태전이_원본확정.md (E-5))
 *
 *   우선순위 1  직업 0x4C·0x4D          → 0xFFFF (무음)
 *            2  전투 종류 [0xBA84E]==4  → 4
 *            3  전투 종류 == 6          → 6
 *            4  탈것 [+0x5C] 7–0xC·0x17 → 8
 *            5  [+0x14] & 1 (비행)      → 7
 *            6  타일 < 0x64             → 0
 *            7  t = (타일−0x64)&0xF == 0xB → 1
 *            8  t == 1 또는 4           → 2
 *            9  t == 2 또는 3           → 3
 *           10  그 밖                   → 0
 *   후처리    결과가 0 이고 탈것이 1–4  → 5
 *
 * 효과음 번호 = 값 + 0x0B → 11 dry-step · 12 sno-step · 13 gra-step · 14 wat-step ·
 *               15 walkmany · 16 horse-w · 17 fly-mech · 18 fly-dra · 19 wong
 * ---------------------------------------------------------------------- */

var FOOT_MUTE = -1;
var FOOT_BASE = 0x0B;           // 0x162E0  add eax, 0x0B

/**
 * @param {object} battle  `battleKind` 가 [0xBA84E], `tile(x,y)` 가 타일값을 냅니다
 * @param {object} unit    job · gear.mount · f14
 * @param {number} x,y     **딛는 칸** (원본도 목적지 칸을 넣습니다)
 * @returns {number} 0~8, 무음이면 −1
 */
function footstepKind(battle, unit, x, y) {
  if (!unit) return FOOT_MUTE;
  var job = unit.job | 0;
  if (job === 0x4C || job === 0x4D) return FOOT_MUTE;          // 0x1613A
  var phase = (battle && (battle.battleKind | 0)) || 0;
  if (phase === 4) return 4;                                   // 0x1614A
  if (phase === 6) return 6;                                   // 0x16157
  var mnt = (unit.gear && unit.gear.mount) | 0;
  if ((mnt >= 7 && mnt <= 0x0C) || mnt === 0x17) return 8;     // 0x16165
  if ((unit.f14 | 0) & 1) return 7;                            // 0x1617A  비행

  var cell = battle && battle.tile ? battle.tile(x, y) : null;
  var v = cell ? (cell['값'] | 0) : 0;
  var k;
  if (v < 0x64) k = 0;                                         // 0x16193
  else {
    var t = (v - 0x64) & 0x0F;
    k = (t === 0x0B) ? 1
      : (t === 1 || t === 4) ? 2
      : (t === 2 || t === 3) ? 3
      : 0;
  }
  if (k === 0 && mnt >= 1 && mnt <= 4) k = 5;                  // 0x161FA  말발굽
  return k;
}

/** 종류 → 효과음 번호. 무음이면 0 을 냅니다(fx.json 에 0번은 없습니다). */
function footstepSound(kind) { return kind < 0 ? 0 : kind + FOOT_BASE; }

/** 유닛과 목적 칸 지형에 맞는 원본 발소리 종류를 판정한다. */
Fx.prototype.footstepKind = function (battle, unit, x, y) {
  return footstepKind(battle, unit, x, y);
};

/** 한 칸 딛는 소리를 냅니다. 무음 조건이면 아무것도 안 합니다. */
Fx.prototype.footstep = function (battle, unit, x, y, vol) {
  var k = footstepKind(battle, unit, x, y);
  if (k < 0) return null;
  return this.playSound(footstepSound(k), vol == null ? 0.7 : vol);
};

/* ══════════════════════════════════════════════════════════════════════════
 * 전투 효과음 · 사망 연출 — 원본 확정 규칙
 *
 * 효과음 표      이름표 `0x78254` (13바이트 × 34), 적재 `0x55C96~` (`0x4F460`).
 * 재생           `0x4F4CD(ax = 번호)` — **표 인덱스 = 번호 − 1**.
 * 통상 공격 연출 `0x1E61D`
 * 피격 반응·소리 `0x45F29`
 * 사망 분기      `0x1DB1D` → `0x463FB` / `0x46A11` / `0x46B2C`
 *
 * ★ 결정적 발견 — `word[0xF0B8C]` 는 **이번 공격의 크리티컬 종류**입니다.
 *   `0x1DEA9  call 0x1D6B1` (크리티컬 셔플백) → `0x1DEAE  mov [0xF0B8C], ax`.
 *   그래서 `0x1E7C7  cmp word [0xF0B8C], 0 / je` 가 걸린 **기합(ha-m·ha-f 등)은
 *   크리티컬일 때만** 납니다. 평타에는 무기 휘두르는 소리만 납니다.
 * ======================================================================== */

/** 표 인덱스 + 1 = `0x4F4CD` 에 넣는 번호. */
var VSP = {
  SWORD: 1, FIST: 2, BOW: 3, WHIP: 4, CANNON: 5, BOW2: 6, BATTLER: 7, GUN: 8,
  SHOUT: 9, SHIELD: 10,
  HA_M: 20, HA_F: 21, DAMAGE_M: 22, DAMAGE_F: 23, DMG_MECH: 24,
  DEAD_M: 25, DEAD_F: 26, BURY: 27, DEAD_C: 28,
  TURN: 29, ITEM: 30, COMMAND: 31, SKELETON: 32, L_MON_A: 33, DRAGON: 34
};

/**
 * **성별 판정** — 원본은 유닛 레코드 `[+0x0D]` 한 바이트만 봅니다.
 *
 *   0x1E825  cmp byte ptr [esi + 0xD], 1 / jne → ha-m(20)   ; 같으면 ha-f(21)
 *   0x45F86  cmp byte ptr [ecx + 0xD], 1 / jne → damage-m(22); 같으면 damage-f(23)
 *
 * 실행 코드 전체에서 `[+0x0D]` 를 **1 과 비교하는 곳은 이 둘뿐**이고, 나머지
 * 17군데는 전부 `== 2`(언데드) 검사입니다(0x1D9CA·0x2AD04 …).
 * 즉 `[+0x0D]` 는 「0 남성 · 1 여성 · 2 언데드」로 쓰이며, **1 만 여성**이고
 * 0 과 2 는 똑같이 남성 계열 소리를 냅니다.
 *
 * 원본 .SCE 294개 전수 대조로도 확인됩니다 — 마을처녀 1 / 마을청년 0,
 * 사라·발키리·이올린·신디·사이렌·메이·클라리스·에리카 1, 스켈톤·좀비·리치 2.
 * (`데이터_스키마.md` §4 의 「종족」 표기는 이 한 바이트를 종족 쪽으로만 읽은 것입니다.)
 */
function isFemaleVoice(u) { return (((u && u.race) | 0) === 1); }

/**
 * 0x1E6D4~0x1E7BD — **무기 휘두르는 소리**와 「기합을 낼 자격이 있는가」.
 *
 * `dx`(= shout) 가 1 인 갈래에서만 기합을 검사합니다. 나머지는 무기음만 납니다.
 *
 *   wt 0x0E · 직업 0x7F · 0x80        → 34 dragon        기합 없음
 *   wt 1·3·4                          → 1 sword          기합 O   (전투종류 4 면 9 shout·기합 X)
 *   wt 5                              → 3 bow            기합 O   (전투종류 4 면 9 shout·기합 X)
 *   직업 0x33                         → 4 whip           기합 O
 *   wt 0                              → 2 fist           기합 O
 *   wt 0x0B·0x11·0x12                 → 5 cannon         기합 없음
 *   wt 0x0C                           → 6 bow2           기합 없음
 *   wt 0x0D                           → 7 battler        기합 없음
 *   wt 0x13                           → 8 gun            기합 없음
 *   그 밖(2·6·7·8·9·0x0F·0x10·0x14~)  → 0 (무음)         기합 없음
 *
 * @returns {{snd:number, shout:boolean}}
 */
function attackWeaponSound(wt, job, battleKind) {
  wt = wt | 0; job = job | 0; battleKind = battleKind | 0;
  if (wt === 0x0E || job === 0x7F || job === 0x80) return { snd: VSP.DRAGON, shout: false };
  if (wt === 1 || wt === 3 || wt === 4)
    return battleKind === 4 ? { snd: VSP.SHOUT, shout: false } : { snd: VSP.SWORD, shout: true };
  if (wt === 5)
    return battleKind === 4 ? { snd: VSP.SHOUT, shout: false } : { snd: VSP.BOW, shout: true };
  if (job === 0x33) return { snd: VSP.WHIP, shout: true };
  if (wt === 0) return { snd: VSP.FIST, shout: true };
  if (wt === 0x0B || wt === 0x11 || wt === 0x12) return { snd: VSP.CANNON, shout: false };
  if (wt === 0x0C) return { snd: VSP.BOW2, shout: false };
  if (wt === 0x0D) return { snd: VSP.BATTLER, shout: false };
  if (wt === 0x13) return { snd: VSP.GUN, shout: false };
  return { snd: 0, shout: false };
}

/**
 * 0x1E7D5~0x1E837 — **기합 소리**. 직업으로 먼저 가르고, 남으면 성별입니다.
 *
 *   직업 0x3F~0x44 · 0x52   → 33 l_mon-a
 *   직업 0x45~0x47 · 0x53~0x57 · 0x5F → 32 skeleton
 *   직업 0x5B               → 34 dragon
 *   그 밖                   → [+0x0D]==1 ? 21 ha-f : 20 ha-m
 *
 * ★ 원본 버그 — 0x1E816 은 `cmp al,0x5B / jne` 로 **0x5B 하나만** 통과시킨 뒤
 *   0x1E81A 에서 다시 `cmp al,0x5D / ja` 를 봅니다. 의도는 0x5B~0x5D 였겠지만
 *   실제로 dragon 이 나는 직업은 0x5B(폴라크라켄) 뿐입니다. 원본을 따릅니다.
 */
function attackShoutSound(u) {
  var j = (u && u.job) | 0;
  if ((j >= 0x3F && j <= 0x44) || j === 0x52) return VSP.L_MON_A;
  if ((j >= 0x45 && j <= 0x47) || (j >= 0x53 && j <= 0x57) || j === 0x5F) return VSP.SKELETON;
  if (j === 0x5B) return VSP.DRAGON;                     // 0x1E816 원본 버그 그대로
  return isFemaleVoice(u) ? VSP.HA_F : VSP.HA_M;
}

/**
 * 0x45F41~0x45F98 — **피격음**. 탈것 소리와 목소리가 겹쳐 날 수 있습니다.
 *
 *   탈것 [+0x5C] 7~0x1F · 0x33~0x41 → 24 dmg-mech
 *   직업 0x3F~0x44 · 0x52           → 33 l_mon-a
 *   직업 >= 0x3F 그 밖              → (없음)
 *   직업 < 0x3F                     → [+0x0D]==1 ? 23 damage-f : 22 damage-m
 *
 * 재생 조건 — `0x45F38 cmp bx, ax` 로 **명중(판정 −1)한 대상만** 냅니다.
 * 방어(1)는 0x1E86A 의 10 shield 로 대체되고, 회피(2)는 아무 소리도 안 납니다.
 */
function hitSounds(u) {
  var out = [], mount = (u && u.gear && u.gear.mount) | 0, j = (u && u.job) | 0;
  if ((mount >= 7 && mount <= 0x1F) || (mount >= 0x33 && mount <= 0x41)) out.push(VSP.DMG_MECH);
  if ((j >= 0x3F && j <= 0x44) || j === 0x52) out.push(VSP.L_MON_A);
  else if (j < 0x3F || j >= 201) out.push(isFemaleVoice(u) ? VSP.DAMAGE_F : VSP.DAMAGE_M);   /* ★ 201~ 추가 사람 직업 (extjob) */
  return out;
}

/**
 * 공격 한 번에 나는 소리의 **순서와 조건** — 0x1E61D 전체.
 *
 *   ① (크리티컬일 때만) 기합            0x1E7C7 `cmp [0xF0B8C],0 / je`
 *   ② 애니메이션 1단계 — 방어한 대상마다 10 shield        0x1E86A
 *   ③ 애니메이션 2단계 — 무기음 1회                        0x1E8C8
 *   ④ 같은 단계에서 명중한 대상마다 피격음                 0x1E9F2 → 0x45F29
 *
 * `crit` 은 `report.attackType`(0 일반 · 1 크리티컬 · 2 일격필살) 을 그대로 넣습니다.
 * @returns {{shout:number, weapon:number, shieldSnd:number, crit:boolean}}
 */
function attackSoundPlan(opts) {
  opts = opts || {};
  var u = opts.unit || {};
  var w = attackWeaponSound(opts.weaponType, u.job, opts.battleKind);
  var crit = (opts.crit | 0) !== 0;
  return {
    crit: crit,
    shout: (w.shout && crit) ? attackShoutSound(u) : 0,     // ★ 크리티컬 전용
    weapon: w.snd,
    shieldSnd: VSP.SHIELD
  };
}

/* ── 사망 연출 — 0x1DB1D 의 세 갈래 ────────────────────────────────────────
 *
 *   0x1DB97  스프라이트 [+0x61] < 300                → 0x463FB  normal
 *   0x1DBAB  >= 300 이고 직업 0x86~0x91 (마장기)     → 0x46B2C  mech
 *   0x1DBBE  >= 300 그 밖 (대형 몬스터)              → 0x46A11  large
 *
 * (1) normal 0x463FB
 *     0x46423  0x10194 로 스프라이트 픽셀을 최대 255개까지 뽑아 색만 보관
 *              (0x101BD `cmp dx,0x100` — 256에서 끊습니다)
 *     0x46490  파편마다  vx=rnd(6) · vy=rnd(12) ·
 *                        rnd(4)==0 → vx+=4, ==2 → vy+=8 ·
 *                        rnd(2)==0 → vx=−vx · 가속 1
 *              위치는 **원래 픽셀 자리가 아니라** 유닛 좌표 + rnd(24) × rnd(24)
 *     0x46549  0x1033B(5)  → 프레임 간격 5틱
 *     0x46568  16프레임 동안 **[+0x63] 방향을 매 프레임 +1** (4바퀴)
 *     0x46583  그중 ebx==12 프레임에 `0x4F4CD(0x1B)` = **BURY.VSP(27)**
 *     0x465A8  유닛을 맵에서 지우고 0x1033B(3) → 프레임 간격 3틱
 *     0x465C9  **30프레임** 동안 점을 찍고 지우며 px+=vx · py−=vy · vy−=1
 *              (알파 페이드 없음 · 화면 밖으로 나간 점은 그냥 안 그림)
 *
 * (2) mech 0x46B2C — 표 0x44A1C[직업−0x86] 로 조각 수를 얻고
 *     vx=rnd(4)+2 · vy=rnd(4)+8 · rnd(4)==0 → vx+=4, ==2 → vy+=4 · 가속 1.
 *     회전 16프레임(5틱) → 5틱 간격 30프레임 조각 비산. **소리 없음.**
 *
 * (3) large 0x46A11 — **회전이 없습니다.** 0x1033B(9) 뒤 16프레임 동안
 *     매 프레임 (전체픽셀/12)개를 무작위로 투명(0xFF)으로 지워 나갑니다. **소리 없음.**
 *
 * ★ dead-m(25) · dead-f(26) · dead-c(28) 은 `0x55C96` 에서 **적재는 되지만**
 *   COMBATII.EXE 안에 `0x4F4CD` 호출 지점이 하나도 없습니다(175개 호출 전수 확인).
 *   전투 중 사망에 나는 소리는 BURY.VSP(27) 하나뿐입니다.
 *
 * ★ 탑승 유닛 0x1DCF7 — [+0x77] 기수가 있고 전투 종류 [0xBA84E] < 4 면
 *   0x1808A 가 기수 레코드를 탈것 레코드에 덮어써 **기수는 그 칸에 내려서서 살아남습니다.**
 *   두 번째 사망 연출은 없습니다. (전투 종류 >= 4 면 함께 사라집니다.)
 * ---------------------------------------------------------------------- */

var DEATH = {
  normal: { kind: 'normal', spinFrames: 16, spinTicks: 5, burySpinFrame: 12,
            /* gapTicks 0 — 0x465B2 는 틱 3 을 «세우기만» 하고 기다리지 않는다(0x465AD 장면 전송 → 곧바로 파편 고리 0x4663E·0x46643).
             *   원본 기록 칸 133: 마지막 회전 대기(0x46583) 뒤 0x45575 전송 → 대기 없이 파편 첫 장 (2026-09-25 · 예전 3 은 3박이 남았다) */
            sound: VSP.BURY, gapTicks: 0, partFrames: 30, partTicks: 3,
            maxParts: 255, spread: 24, gravity: 1,
            vx: 6, vy: 12, vxBonus: 4, vyBonus: 8 },
  mech:   { kind: 'mech', spinFrames: 16, spinTicks: 5, burySpinFrame: -1,
            sound: 0, gapTicks: 5, partFrames: 30, partTicks: 5,
            maxParts: 255, spread: 24, gravity: 1,
            vx: 4, vy: 4, vxBase: 2, vyBase: 8, vxBonus: 4, vyBonus: 4 },
  large:  { kind: 'large', spinFrames: 0, spinTicks: 0, burySpinFrame: -1,
            sound: 0, gapTicks: 9, partFrames: 16, partTicks: 9,
            dissolveDiv: 12 }
};

/** 0x1DB97 의 세 갈래 중 이 유닛이 어느 쪽인지. */
function deathPlan(u) {
  var spr = (u && u.sprIndex) | 0, job = (u && u.job) | 0;
  if (!usesSpecialDeath(u)) return DEATH.normal;                    // 0x1DB97
  if (job >= 0x86 && job <= 0x91) return DEATH.mech;       // 0x1DBAB
  return DEATH.large;                                      // 0x1DBBE
}

/* ── 편의 ─────────────────────────────────────────────────────────────── */

/** fx.json 에 든 이펙트 키 목록. */
Fx.prototype.list = function (only24A) {
  var e = (this.assets && this.assets['이펙트']) || {};
  return Object.keys(e).filter(function (k) {
    return !only24A || e[k]['2-4A실사용'];
  });
};

/** 이름에 대응하는 효과 자산 메타를 조회한다. */
Fx.prototype.meta = function (name) {
  return (this.assets && this.assets['이펙트'] && this.assets['이펙트'][name]) || null;
};

/** 외부 적재기·렌더러가 내부 자산 저장소를 직접 읽지 않게 하는 공개 경계. */
Fx.prototype.assetsReady = function () {
  return !!(this.assets && this.assets['이펙트']);
};
/** 팔레트 효과 복원의 기준 팔레트를 교체한다. */
Fx.prototype.setBasePalette = function (pal) { this.기본팔레트 = pal || null; return this; };
/** 현재 효과 합성에 쓰는 팔레트를 반환한다. */
Fx.prototype.currentPalette = function () { return this.palette || null; };
/** 원본 직독 자산 종류별 등록 프레임 수를 반환한다. */
Fx.prototype.nativeCount = function (key) { return this.native[key] | 0; };
/** 렌더러에 제공할 효과 이미지의 동결 논리 크기 스냅샷을 반환한다. */
Fx.prototype.imageInfo = function (url) {
  var im = this.images && this.images[url];
  return im ? Object.freeze({ 논리w: im.논리w | 0, 논리h: im.논리h | 0 }) : null;
};
/** 이후 효과음에 적용할 전역 FX 음량을 설정한다. */
Fx.prototype.setVolume = function (v) {
  this.volume = +v || 0;
  /* 지금 울리는 환경음에도 곧바로 — 효과음 음소거(audio.js setSfxMuted)가 이 창구를 부른다 */
  var a = this._amb;
  try {
    if (a && a._gain) a._gain.gain.value = clamp(0.6 * this.volume, 0, 1);
    else if (a && a.volume != null) a.volume = clamp(0.6 * this.volume, 0, 1);
  } catch (e) {}
  return this;
};

/* ══════════════════════════════════════════════════════════════════════ */

var G2Fx = new Fx();
G2Fx.Fx = Fx;
G2Fx.TICK_HZ = TICK_HZ;
G2Fx.TICK_MS = TICK_MS;
/* 0x16123 — Node 에서도 표를 검증할 수 있게 순수 함수로 내놓습니다 */
G2Fx.footstepKindOf = footstepKind;
G2Fx.footstepSoundOf = footstepSound;
G2Fx.FOOT_MUTE = FOOT_MUTE;
G2Fx.FOOT_BASE = FOOT_BASE;
/* 0x1E61D · 0x45F29 · 0x1DB1D — 소리·사망 규칙도 Node 에서 검증할 수 있게 순수 함수로 */
G2Fx.VSP = VSP;
G2Fx.DEATH = DEATH;
G2Fx.isFemaleVoice = isFemaleVoice;
G2Fx.attackWeaponSound = attackWeaponSound;
G2Fx.attackShoutSound = attackShoutSound;
G2Fx.hitSoundsOf = hitSounds;
G2Fx.attackSoundPlan = attackSoundPlan;
G2Fx.deathPlan = deathPlan;
/* 할일 19 — 그림은 원본 직독. `load()` 전에 useNativeArt() 를 켜면 추출 시트를 안 읽습니다. */
G2Fx.useNativeArt = function (on) { G2Fx.nativeOnly = (on !== false); return G2Fx.nativeOnly; };

root.G2Fx = G2Fx;

if (typeof module !== 'undefined' && module.exports) module.exports = G2Fx;

})(typeof globalThis !== 'undefined' ? globalThis : window);
