/* ============================================================================
 * 창세기전 2 — 픽셀 스케일러
 *
 * ★ [원본없음 · 파일전체] — 원본에는 확대 알고리즘이 **아예 없다**
 *   (320x200 고정 화면을 그대로 찍는다). 이 파일의 수치는 전부
 *   확대 알고리즘의 가중치·문턱값이라 원본 EXE 에 대응물이 없다.
 * 원본 재현이 아니라 **리마스터 전용** 기능입니다 (리마스터_로드맵.md 61행).
 * 원본 픽셀을 확대할 때 계단을 줄입니다. 원본 데이터는 건드리지 않고,
 * 화면에 그릴 이미지만 키웁니다.
 *
 * 쓰는 법
 *   G2Scaler.list()                     → ['none','epx2','epx3']
 *   G2Scaler.apply('epx3', imageData)   → 새 ImageData (3배)
 *   G2Scaler.factor('epx3')             → 3
 *
 * ── EPX / Scale2x ──────────────────────────────────────────────────────
 * 상하좌우 네 이웃만 봅니다. **원본에 없는 색을 만들지 않아** 도트 느낌이
 * 그대로 남습니다. 팔레트 게임에 잘 맞습니다.
 *
 *      A            1 2
 *    C P B   →      3 4
 *      D
 *
 *   1 = (C==A && C!=D && A!=B) ? A : P
 *   2 = (A==B && A!=C && B!=D) ? B : P
 *   3 = (D==C && D!=B && C!=A) ? C : P
 *   4 = (B==D && B!=A && D!=C) ? D : P
 *
 * Scale3x 는 같은 규칙을 3×3 으로 넓힌 것입니다(모서리 4 + 변 4 + 중앙 1).
 *
 * ※ HQ3x · xBRZ 는 여기 같은 자리에 끼우면 됩니다 — 입출력이 ImageData 로
 *   같습니다. 둘은 색을 섞어 새 색을 만들고 구현이 길어 나중에 붙입니다.
 * ==========================================================================*/
(function (root) {
'use strict';

/** 픽셀 하나를 32비트 정수로 (비교용). 완전투명은 전부 같은 값으로 봅니다. */
function px(d, i) { return d[i + 3] === 0 ? 0 : ((d[i] << 24) | (d[i + 1] << 16) | (d[i + 2] << 8) | d[i + 3]) >>> 0; }
function cp(s, si, t, ti) { t[ti] = s[si]; t[ti + 1] = s[si + 1]; t[ti + 2] = s[si + 2]; t[ti + 3] = s[si + 3]; }

/** EPX 2배 — 위 주석의 네 규칙 그대로. */
function epx2(img) {
  var w = img.width, h = img.height, s = img.data;
  var W = w * 2, out = new Uint8ClampedArray(W * h * 2 * 4);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      var P = px(s, i);
      var A = y > 0     ? px(s, i - w * 4) : P;
      var D = y < h - 1 ? px(s, i + w * 4) : P;
      var C = x > 0     ? px(s, i - 4)     : P;
      var B = x < w - 1 ? px(s, i + 4)     : P;
      var o = ((y * 2) * W + x * 2) * 4;
      /* 네 모서리 — 조건에 안 맞으면 가운데 색 P 를 그대로 */
      cp(s, (C === A && C !== D && A !== B) ? (y > 0 ? i - w * 4 : i) : i, out, o);
      cp(s, (A === B && A !== C && B !== D) ? (x < w - 1 ? i + 4 : i) : i, out, o + 4);
      cp(s, (D === C && D !== B && C !== A) ? (x > 0 ? i - 4 : i) : i, out, o + W * 4);
      cp(s, (B === D && B !== A && D !== C) ? (y < h - 1 ? i + w * 4 : i) : i, out, o + W * 4 + 4);
    }
  }
  return { width: W, height: h * 2, data: out };
}

/** Scale3x — 같은 규칙을 3×3 으로. 가운데는 늘 원래 색입니다. */
function epx3(img) {
  var w = img.width, h = img.height, s = img.data;
  var W = w * 3, out = new Uint8ClampedArray(W * h * 3 * 4);
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var i = (y * w + x) * 4;
      var iA = y > 0 ? i - w * 4 : i, iD = y < h - 1 ? i + w * 4 : i;
      var iC = x > 0 ? i - 4 : i,     iB = x < w - 1 ? i + 4 : i;
      var P = px(s, i), A = px(s, iA), B = px(s, iB), C = px(s, iC), D = px(s, iD);
      var o = ((y * 3) * W + x * 3) * 4, r = W * 4;
      var eq = (C === A && C !== D && A !== B);       // 좌상
      var e2 = (A === B && A !== C && B !== D);       // 우상
      var e3 = (D === C && D !== B && C !== A);       // 좌하
      var e4 = (B === D && B !== A && D !== C);       // 우하
      cp(s, eq ? iA : i, out, o);                     // 0,0
      cp(s, (eq || e2) ? (eq ? iA : iB) : i, out, o + 4);   // 1,0 (변)
      cp(s, e2 ? iB : i, out, o + 8);                 // 2,0
      cp(s, (eq || e3) ? iC : i, out, o + r);         // 0,1 (변)
      cp(s, i, out, o + r + 4);                       // 1,1 — 늘 원래 색
      cp(s, (e2 || e4) ? iB : i, out, o + r + 8);     // 2,1 (변)
      cp(s, e3 ? iD : i, out, o + r * 2);             // 0,2
      cp(s, (e3 || e4) ? iD : i, out, o + r * 2 + 4); // 1,2 (변)
      cp(s, e4 ? iD : i, out, o + r * 2 + 8);         // 2,2
    }
  }
  return { width: W, height: h * 3, data: out };
}

/* ══════════════════════════════════════════════════════════════════════
 * xBRZ (Zenju) — 2·3·4배
 *
 * EPX 와 달리 **색을 섞어 새 색을 만듭니다**. 계단이 훨씬 매끈해지지만
 * 팔레트에 없던 중간색이 생깁니다. 원본 재현이 아닌 리마스터 전용입니다.
 *
 * 흐름 (원 구현과 동일한 2단계)
 *   1. preProcessCorners — 4×4 이웃으로 픽셀 오른쪽아래 네 귀퉁이의
 *      블렌딩 방향(없음/보통/우세)을 정한다.
 *   2. blendPixel        — 3×3 이웃 + 위 판정으로 네 귀퉁이를 0°·90°·
 *      180°·270° 회전 적용해 각각 칠한다.
 *
 * 색거리는 YCbCr(BT.709) + 알파 가중. 임계값은 원 구현 기본값을 그대로 씀.
 * ════════════════════════════════════════════════════════════════════ */

var CFG = {
  luminanceWeight: 1,
  equalColorTolerance: 30,
  dominantDirectionThreshold: 3.6,
  steepDirectionThreshold: 2.2
};

/* 픽셀 = (a<<24)|(r<<16)|(g<<8)|b — 엔디안 무관하게 직접 조립 */
function pA(p) { return (p >>> 24) & 0xFF; }
function pR(p) { return (p >>> 16) & 0xFF; }
function pG(p) { return (p >>> 8) & 0xFF; }
function pB(p) { return p & 0xFF; }
function mk(a, r, g, b) { return (((a & 0xFF) << 24) | ((r & 0xFF) << 16) | ((g & 0xFF) << 8) | (b & 0xFF)) >>> 0; }

var K_B = 0.0722, K_R = 0.2126, K_G = 1 - K_B - K_R;   // BT.709
var SC_B = 0.5 / (1 - K_B), SC_R = 0.5 / (1 - K_R);

function distYCbCr(p1, p2) {
  var rd = pR(p1) - pR(p2), gd = pG(p1) - pG(p2), bd = pB(p1) - pB(p2);
  var y = K_R * rd + K_G * gd + K_B * bd;
  var cb = SC_B * (bd - y), cr = SC_R * (rd - y);
  var ly = CFG.luminanceWeight * y;
  return Math.sqrt(ly * ly + cb * cb + cr * cr);
}
/** 알파까지 반영한 색거리. 완전투명↔불투명은 최대 거리(255)에 가깝게 나온다. */
function dist(p1, p2) {
  if (p1 === p2) return 0;
  var a1 = pA(p1) / 255, a2 = pA(p2) / 255, d = distYCbCr(p1, p2);
  return a1 < a2 ? a1 * d + 255 * (a2 - a1) : a2 * d + 255 * (a1 - a2);
}
function eqc(p1, p2) { return dist(p1, p2) < CFG.equalColorTolerance; }

/** 배경 위에 앞색을 M/N 불투명도로 올린 결과 (알파 합성). */
function grad(back, front, M, N) {
  var wF = pA(front) * M, wB = pA(back) * (N - M), ws = wF + wB;
  if (ws === 0) return 0;
  return mk((ws / N) | 0,
            (pR(front) * wF + pR(back) * wB) / ws,
            (pG(front) * wF + pG(back) * wB) / ws,
            (pB(front) * wF + pB(back) * wB) / ws);
}

/* 블렌딩 판정 2비트 × 4귀퉁이 — 0:없음 1:보통 2:우세
 *    비트  0-1 좌상 · 2-3 우상 · 4-5 우하 · 6-7 좌하 */
function topL(b) { return b & 3; }
function topR(b) { return (b >> 2) & 3; }
function botR(b) { return (b >> 4) & 3; }
function botL(b) { return (b >> 6) & 3; }
function setTopL(b, v) { return (b & ~3) | v; }
function setTopR(b, v) { return (b & ~(3 << 2)) | (v << 2); }
function setBotR(b, v) { return (b & ~(3 << 4)) | (v << 4); }
function setBotL(b, v) { return (b & ~(3 << 6)) | (v << 6); }
/* 회전은 2비트씩 돌리기 */
function rotBlend(b, rot) { var s = rot * 2; return ((b << s) | (b >> (8 - s))) & 0xFF; }

/* 3×3 커널 인덱스 a..i = 0..8 를 회전시킨 참조표 */
var KROT = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8],   // 0°
  [6, 3, 0, 7, 4, 1, 8, 5, 2],   // 90°
  [8, 7, 6, 5, 4, 3, 2, 1, 0],   // 180°
  [2, 5, 8, 1, 4, 7, 0, 3, 6]    // 270°
];

/** scale×scale 출력 블록 안의 (i,j) 를 rot 만큼 되돌린 실제 좌표표. */
function makeOutRot(n) {
  var t = [[], [], [], []];
  for (var rot = 0; rot < 4; rot++) {
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++) {
      var ii = i, jj = j;
      for (var k = 0; k < rot; k++) { var ni = n - 1 - jj; jj = ii; ii = ni; }
      t[rot][i * n + j] = ii * n + jj;
    }
  }
  return t;
}

/* ── 배율별 칠하기 규칙 ────────────────────────────────────────────────
 * ref(i,j) = 출력 블록 안 좌표. 원 구현 Scaler2x/3x/4x 와 같은 가중치. */
var RULES = {
  2: {
    shallow:  [[1, 0, 1, 4], [1, 1, 3, 4]],
    steep:    [[0, 1, 1, 4], [1, 1, 3, 4]],
    both:     [[1, 0, 1, 4], [0, 1, 1, 4], [1, 1, 5, 6]],
    diagonal: [[1, 1, 1, 2]],
    corner:   [[1, 1, 21, 100]]
  },
  3: {
    shallow:  [[2, 0, 1, 4], [1, 2, 1, 4], [2, 1, 3, 4], [2, 2, 0, 0]],
    steep:    [[0, 2, 1, 4], [2, 1, 1, 4], [1, 2, 3, 4], [2, 2, 0, 0]],
    both:     [[2, 0, 1, 4], [0, 2, 1, 4], [2, 1, 3, 4], [1, 2, 3, 4], [2, 2, 0, 0]],
    diagonal: [[1, 2, 1, 8], [2, 1, 1, 8], [2, 2, 7, 8]],
    corner:   [[2, 2, 45, 100], [2, 1, 7, 100], [1, 2, 7, 100]]
  },
  4: {
    shallow:  [[3, 0, 1, 4], [2, 2, 1, 4], [3, 1, 3, 4], [2, 3, 3, 4], [3, 2, 0, 0], [3, 3, 0, 0]],
    steep:    [[0, 3, 1, 4], [2, 2, 1, 4], [1, 3, 3, 4], [3, 2, 3, 4], [2, 3, 0, 0], [3, 3, 0, 0]],
    both:     [[3, 1, 3, 4], [1, 3, 3, 4], [3, 0, 1, 4], [0, 3, 1, 4], [2, 2, 1, 3],
               [3, 3, 0, 0], [3, 2, 0, 0], [2, 3, 0, 0]],
    diagonal: [[3, 2, 1, 2], [2, 3, 1, 2], [3, 3, 0, 0]],
    corner:   [[3, 3, 68, 100], [3, 2, 9, 100], [2, 3, 9, 100]]
  }
};

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **좁힌 xBRZ** — 색이 덜 번지게 (2026-09-17 사장님 지시)
 *
 *  > 「기본 xbrz 스케일러가 **근처의 셀 색을 모아 섞는** 알고리즘이 있는데,
 *  >  이 **범위를 줄이고** 싶어. 해당칸의 **바로 인접한 셀 색만** 섞도록 하면
 *  >  xbrz 특유의 **색번지는 효과가 완화**되는 느낌이 살더라고.」
 *  > 「**기존 xbrz는 그대로 두고** 수정옵션 또는 옵션 토글로」
 *
 *  ── 어디서 번지나 ──────────────────────────────────────────────────────
 *  위 `RULES` 의 한 항목은 `[출력i, 출력j, M, N]` 이고
 *  `paint()` 가 `dst = grad(dst, col, M, N)` 으로 **이웃 색 `col` 을 M/N 만큼**
 *  칠한다. 그런데 `shallow`·`steep`·`both` 는 블록의 **먼 쪽 칸**까지 칠한다 —
 *  3배의 `[2,0]`·`[0,2]`, 4배의 `[3,0]`·`[0,3]` 이 그것이다.
 *  그 먼 칸이 **다음 픽셀 자리까지 이웃 색을 끌고 가** 번지게 보인다.
 *
 *  ── 어떻게 좁히나 ──────────────────────────────────────────────────────
 *  블록의 **귀퉁이 칸 `(n-1, n-1)` 에서 체비셰프 거리 `반경` 이내**만 남긴다.
 *  `반경 1` 이면 「귀퉁이와 **바로 인접한** 칸」뿐이다 — 사장님 말씀 그대로다.
 *
 *    3배 shallow : `[2,0]`(거리 2) **빠짐** · `[2,1]`·`[1,2]`·`[2,2]` 남음
 *    4배 shallow : `[3,0]`·`[3,1]`(거리 3·2) **빠짐** · `[2,2]`·`[2,3]`·`[3,2]`·`[3,3]` 남음
 *
 *  ☠ **기존 `RULES` 는 한 글자도 안 건드린다.** 좁힌 표를 따로 굽는다 —
 *    `xbrz2`·`xbrz3`·`xbrz4` 는 지금까지와 **똑같이** 돈다.
 *  ★ 판정(`preCorners`)은 그대로다. 바꾸는 것은 **칠하는 범위**뿐이라
 *    선을 잇는 방향은 원래와 같고 색만 덜 퍼진다.
 * ══════════════════════════════════════════════════════════════════════ */

/* ── 손잡이 둘 — 개발 패널에서 값을 넣어 최적값을 찾는다 (2026-09-17 사장님 지시)
 *   > 「**섞는 값을 개발토글에서 입력해서 적용**되게 할 수 있을까? **최적값을
 *   >  찾아보고** 싶어」 · 「**0을 기준으로 +-100 으로 표시**하면 어때?」
 *
 *   `반경` 0~3   — 귀퉁이에서 이 거리 안의 칸만 칠한다. **작을수록 덜 번진다**
 *                  (1 = 「바로 인접한 셀만」 · 3 이면 사실상 원래 xBRZ)
 *   `세기` 0~200 — 섞는 비율(M/N)에 곱하는 **백분율**. 안에서는 이 값으로 센다.
 *
 *   ★★★ **화면에는 «0 기준 ±100» 으로 보인다** (사장님 지정) —
 *        `기울기 = 세기 − 100` 이다. 곧 —
 *          **−100** 아예 안 섞음 (원래 픽셀 그대로)
 *          **   0** 원래 xBRZ 비율  ← 기준
 *          **+100** 더 세게 — 이웃색으로 덮는다 (`M` 이 `N` 에서 포화)
 *        ☠ 0 → −100 사이의 **중간(−50 언저리)이 오히려 가장 흐리다.**
 *          두 색의 한가운데 색이 되기 때문이다. U자 곡선이라 눈으로 골라야 한다.
 *   ☠ 기본값은 **반경 1 · 기울기 0**(세기 100) — 「바로 인접한 셀만」이다. */
/* ★★★★★ **기준점은 «기본 xBRZ» 다** — 사장님 지정 2026-09-17
 *   > 「**0을 기준으로 +-100 으로 표시**하면 어때?」 · 「**기준점을 기본 xbrz로 잡고**」
 *
 *   그래서 두 손잡이 모두 **0 = 기본 xBRZ 와 똑같은 그림**이다.
 *
 *   | 손잡이 | 범위 | 0 일 때 | 내려가면 |
 *   |---|---|---|---|
 *   | **좁힘** | 0 ~ −3 | 제한 없음 (= 기본 xBRZ) | 칠하는 칸이 줄어 **덜 번진다** |
 *   | **섞기** | −100 ~ +100 | 원래 비율 (= 기본 xBRZ) | 이웃색을 덜 섞는다 (+는 더 세게) |
 *
 *   ☠ **배율마다 «제한 없음» 의 거리가 다르다** (2배는 1 · 3배는 2 · 4배는 3).
 *     그래서 «절대 반경» 이 아니라 **단계**로 센다 — `반경 = (n−1) + 좁힘단계`.
 *     그래야 어느 배율에서든 **0 이면 기본 xBRZ** 가 된다.
 *   ☠ 기본값은 **좁힘 −1**(= 「바로 인접한 셀만」, 사장님이 처음 말씀하신 것) ·
 *     **섞기 0**(원래 비율). */
var 좁힘 = { 단계: -1, 기울기: 0 };

/** 단계(0~−3) → 그 배율에서의 실제 체비셰프 반경. 0 이면 제한 없음(n−1). */
function 반경환산(n, 단계) {
  var r = (n - 1) + (단계 | 0);
  return r < 0 ? 0 : r;
}
/** 기울기(−100~+100) → 섞기 백분율. 0 → 100 %. */
function 세기환산(기울기) { return 100 + (기울기 | 0); }

/** 귀퉁이 `(n-1,n-1)` 에서 체비셰프 거리 `반경` 이내인 항목만, 세기를 곱해서. */
function 규칙좁히기(rule, n, 반경, 세기) {
  var 남 = [];
  for (var r = 0; r < rule.length; r++) {
    var e = rule[r];
    var di = (n - 1) - e[0], dj = (n - 1) - e[1];
    if ((di > dj ? di : dj) > 반경) continue;
    if (세기 === 100 || e[3] === 0) { 남.push(e); continue; }
    /* ★ 세기를 곱한다 — `N===0`(덮어쓰기)은 **비율이 없으므로 그대로 둔다.**
     *   그 칸은 「이 색으로 칠한다」는 뜻이라 섞기 비율의 대상이 아니다.
     *   ☠ `M` 은 **`N` 을 넘을 수 없다** — 넘으면 `grad()` 의 `N-M` 이 음수가 되어
     *     배경 가중치가 뒤집히고 색이 깨진다. 포화시키면 「완전히 이웃색」이다. */
    var M = Math.round(e[2] * 세기 / 100);
    if (M > e[3]) M = e[3];
    if (M < 0) M = 0;
    남.push([e[0], e[1], M, e[3]]);
  }
  /* ☠ 하나도 안 남으면 **원래 규칙을 쓴다** — 빈 규칙은 그 칸을 아예 안 칠해
   *   구멍이 난다. 좁히는 것이 목적이지 지우는 것이 아니다. */
  return 남.length ? 남 : rule;
}

/**
 * 배율별 «좁힌» 규칙 한 벌.
 * @param 단계   0 ~ −3 (0 = 기본 xBRZ). 안 주면 지금 값
 * @param 기울기 −100 ~ +100 (0 = 기본 xBRZ). 안 주면 지금 값
 */
function 좁힌규칙(n, 단계, 기울기) {
  var 밑 = RULES[n], 낸것 = {};
  if (단계 == null) 단계 = 좁힘.단계;
  if (기울기 == null) 기울기 = 좁힘.기울기;
  var 반경 = 반경환산(n, 단계), 세기 = 세기환산(기울기);
  for (var k in 밑) if (Object.prototype.hasOwnProperty.call(밑, k))
    낸것[k] = 규칙좁히기(밑[k], n, 반경, 세기);
  return 낸것;
}

/** 규칙 하나를 출력 버퍼에 적용. N=0 이면 덮어쓰기, 아니면 M/N 합성. */
function paint(dst, base, W, n, orot, rot, rule, col) {
  for (var r = 0; r < rule.length; r++) {
    var e = rule[r], off = orot[rot][e[0] * n + e[1]];
    var idx = base + ((off / n) | 0) * W + (off % n);
    dst[idx] = e[3] === 0 ? col : grad(dst[idx], col, e[2], e[3]);
  }
}

/** 4×4 이웃 a..p → 오른쪽아래 네 귀퉁이(f·g·j·k)의 블렌딩 방향. */
function preCorners(k, out4) {
  out4[0] = out4[1] = out4[2] = out4[3] = 0;          // f, g, j, k
  var f = k[5], g = k[6], j = k[9], kk = k[10];
  if ((f === g && j === kk) || (f === j && g === kk)) return;
  var W = 4;
  var jg = dist(k[8], f) + dist(f, k[2]) + dist(k[13], kk) + dist(kk, k[7]) + W * dist(j, g);
  var fk = dist(k[4], j) + dist(j, k[14]) + dist(k[1], g) + dist(g, k[11]) + W * dist(f, kk);
  if (jg < fk) {
    var dom = CFG.dominantDirectionThreshold * jg < fk ? 2 : 1;
    if (f !== g && f !== j) out4[0] = dom;
    if (kk !== j && kk !== g) out4[3] = dom;
  } else if (fk < jg) {
    var dom2 = CFG.dominantDirectionThreshold * fk < jg ? 2 : 1;
    if (j !== f && j !== kk) out4[2] = dom2;
    if (g !== f && g !== kk) out4[1] = dom2;
  }
}

/** 3×3 이웃 + 블렌딩 판정 → 출력 블록의 한 귀퉁이를 칠한다. */
function blendPixel(k3, dst, base, W, n, R, orot, rot, blendXY) {
  var blend = rotBlend(blendXY, rot);
  if (botR(blend) === 0) return;
  var p = KROT[rot];
  var b = k3[p[1]], c = k3[p[2]], d = k3[p[3]], e = k3[p[4]],
      f = k3[p[5]], g = k3[p[6]], h = k3[p[7]], i = k3[p[8]];

  var line = true;
  if (botR(blend) < 2) {
    /* 인접 회전에서 또 블렌딩되는 픽셀은 귀퉁이만 (섬 픽셀·눈동자 보호) */
    if (topR(blend) !== 0 && !eqc(e, g)) line = false;
    else if (botL(blend) !== 0 && !eqc(e, c)) line = false;
    /* L자 모양은 선으로 잇지 않는다 */
    else if (!eqc(e, i) && eqc(g, h) && eqc(h, i) && eqc(i, f) && eqc(f, c)) line = false;
  }

  var col = dist(e, f) <= dist(e, h) ? f : h;

  if (!line) { paint(dst, base, W, n, orot, rot, R.corner, col); return; }

  var fg = dist(f, g), hc = dist(h, c);
  var shallow = CFG.steepDirectionThreshold * fg <= hc && e !== g && d !== g;
  var steep   = CFG.steepDirectionThreshold * hc <= fg && e !== c && b !== c;
  var rule = shallow ? (steep ? R.both : R.shallow) : (steep ? R.steep : R.diagonal);
  paint(dst, base, W, n, orot, rot, rule, col);
}

/** ImageData → Uint32Array(ARGB). 완전투명은 0 으로 눕혀 비교를 단순화. */
function toU32(img) {
  var s = img.data, N = img.width * img.height, u = new Uint32Array(N);
  for (var i = 0; i < N; i++) {
    var a = s[i * 4 + 3];
    u[i] = a === 0 ? 0 : mk(a, s[i * 4], s[i * 4 + 1], s[i * 4 + 2]);
  }
  return u;
}
function fromU32(u, w, h) {
  var out = new Uint8ClampedArray(w * h * 4);
  for (var i = 0; i < w * h; i++) {
    var p = u[i];
    out[i * 4] = pR(p); out[i * 4 + 1] = pG(p); out[i * 4 + 2] = pB(p); out[i * 4 + 3] = pA(p);
  }
  return { width: w, height: h, data: out };
}

/**
 * @param n   배율 2·3·4
 * @param 규칙 칠하기 규칙 한 벌. **안 주면 지금까지와 똑같이** `RULES[n]` 을 쓴다
 *            (좁힌 변형만 따로 넘긴다 — 기존 동작은 한 글자도 안 바뀐다)
 */
function xbrz(n, 규칙) {
  var orot = makeOutRot(n), R = 규칙 || RULES[n];
  return function (img) {
    var w = img.width, h = img.height, src = toU32(img);
    var W = w * n, dst = new Uint32Array(W * h * n);
    var pre = new Uint8Array(w);            // 윗줄에서 넘어온 판정
    var res = [0, 0, 0, 0], k4 = new Uint32Array(16), k3 = new Uint32Array(9);
    var cl = function (v, m) { return v < 0 ? 0 : (v > m ? m : v); };

    for (var y = 0; y < h; y++) {
      var r0 = cl(y - 1, h - 1) * w, r1 = y * w, r2 = cl(y + 1, h - 1) * w, r3 = cl(y + 2, h - 1) * w;
      var carry = 0;                        // 다음 칸 (x, y+1) 좌상 판정
      for (var x = 0; x < w; x++) {
        var xm = cl(x - 1, w - 1), xp = cl(x + 1, w - 1), xq = cl(x + 2, w - 1);
        k4[0] = src[r0 + xm]; k4[1] = src[r0 + x]; k4[2] = src[r0 + xp]; k4[3] = src[r0 + xq];
        k4[4] = src[r1 + xm]; k4[5] = src[r1 + x]; k4[6] = src[r1 + xp]; k4[7] = src[r1 + xq];
        k4[8] = src[r2 + xm]; k4[9] = src[r2 + x]; k4[10] = src[r2 + xp]; k4[11] = src[r2 + xq];
        k4[12] = src[r3 + xm]; k4[13] = src[r3 + x]; k4[14] = src[r3 + xp]; k4[15] = src[r3 + xq];

        preCorners(k4, res);
        var blendXY = setBotR(pre[x], res[0]);        // 이 픽셀의 네 귀퉁이가 여기서 확정
        pre[x] = setTopR(carry, res[2]);              // 다음 줄용으로 저장
        carry = setTopL(0, res[3]);
        if (x + 1 < w) pre[x + 1] = setBotL(pre[x + 1], res[1]);

        /* 블록을 원래 색으로 채운 뒤 귀퉁이를 덧칠한다 */
        var base = (y * n) * W + x * n, c0 = k4[5], yy, xx;
        for (yy = 0; yy < n; yy++) for (xx = 0; xx < n; xx++) dst[base + yy * W + xx] = c0;

        if (blendXY !== 0) {
          k3[0] = k4[0]; k3[1] = k4[1]; k3[2] = k4[2];
          k3[3] = k4[4]; k3[4] = k4[5]; k3[5] = k4[6];
          k3[6] = k4[8]; k3[7] = k4[9]; k3[8] = k4[10];
          blendPixel(k3, dst, base, W, n, R, orot, 0, blendXY);
          blendPixel(k3, dst, base, W, n, R, orot, 1, blendXY);
          blendPixel(k3, dst, base, W, n, R, orot, 2, blendXY);
          blendPixel(k3, dst, base, W, n, R, orot, 3, blendXY);
        }
      }
    }
    return fromU32(dst, W, h * n);
  };
}

/* ══════════════════════════════════════════════════════════════════════
 *  **HQx** — hq2x · hq3x · hq4x (2026-09-17 · 사장님 요청)
 *
 *  > 사장님: 「다른 **전통 스케일러 알고리즘**(hqx였나) 이것도 추가할 수 있어?」
 *  > 「**hq2x** 이런느낌인것 같은데 이름이 확실치 않아」
 *
 *  ── 무엇인가 ─────────────────────────────────────────────────────────
 *  Maxim Stepin 이 2003년에 낸 픽셀아트 확대기다. xBRZ 보다 **먼저** 나왔고
 *  에뮬레이터에서 오래 쓰였다. 원리는 위 xBRZ 와 비슷하되 **판정이 다르다** —
 *
 *    ① 가운데 픽셀과 **둘레 여덟 칸**을 YUV 로 견주어 「다르다/같다」 를 매긴다
 *    ② 그 여덟 개를 모아 **8비트 무늬**(0~255)를 만든다
 *    ③ 무늬마다 정해진 **섞기 규칙**으로 n×n 칸을 칠한다
 *
 *  xBRZ 는 「이어지는 선」을 찾아 귀퉁이만 깎는 쪽이고, HQx 는 **무늬표**를 따른다.
 *  그래서 **선이 더 또렷하고 색 번짐이 적은 대신, 곡선은 xBRZ 가 더 부드럽다.**
 *  두 가지를 나란히 두고 사장님이 눈으로 고르시면 된다.
 *
 *  ── 근거 ─────────────────────────────────────────────────────────────
 *  무늬 256가지를 그대로 늘어놓으면 원본 참조 구현이 12,000줄이다. 여기 옮긴 것은
 *  그것을 **조건 규칙으로 간추린 판**(560줄)이며, 출처와 라이선스는 이렇다 —
 *
 *    FFmpeg `libavfilter/vf_hqx.c` — Copyright (c) 2014 Clément Bœsch
 *    ISC 라이선스: 저작권 고지와 허가 문구를 남기면 목적을 가리지 않고
 *    쓰기·복사·고치기·배포가 허용된다.
 *      "Permission to use, copy, modify, and/or distribute this software for any
 *       purpose with or without fee is hereby granted, provided that the above
 *       copyright notice and this permission notice appear in all copies.
 *       THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES …"
 *    원 알고리즘: Maxim Stepin (hiend3d.com/hq3x.html)
 *    간추린 과정: https://blog.pkh.me/p/19-butchering-hqx-scaling-filters.html
 *
 *  ★ 규칙의 숫자(무늬 마스크·섞기 가중치)는 **한 자도 바꾸지 않았다.** 바꾸면
 *    그것은 더 이상 HQx 가 아니다. 우리 쪽 사정으로 손댄 것은 **담는 꼴뿐**이다 —
 *    C 의 `0xAARRGGBB` 한 덩이 셈을 JS 에서는 **채널을 갈라** 센다(아래 `ip2` 설명).
 * ══════════════════════════════════════════════════════════════════════ */

/** RGB → YUV (원본 `init()` 의 표 만드는 식 그대로. 표 대신 그 자리에서 센다) */
function hqYuv(p) {
  var r = (p >>> 16) & 0xFF, g = (p >>> 8) & 0xFF, b = p & 0xFF;
  var rg = r - g, bg = b - g;
  /* ☠ C 의 정수 나눗셈은 **0 쪽으로** 자른다 — `Math.trunc` 가 그것이다.
   *   `Math.floor` 를 쓰면 음수에서 1 이 어긋나 판정이 달라진다. */
  var y = Math.trunc((299 * rg + 1000 * g + 114 * bg) / 1000);
  var u = Math.trunc((-169 * rg + 500 * bg) / 1000) + 128;
  var v = Math.trunc((500 * rg - 81 * bg) / 1000) + 128;
  /* 원본은 `uint32_t` 로 감싸 **아래 8비트만** 뜻이 있다 — `& 0xFF` 가 그 자리다 */
  return ((y & 0xFF) << 16) | ((u & 0xFF) << 8) | (v & 0xFF);
}

/** 두 YUV 가 «다른가» — 문턱 Y 48 · U 7 · V 6 (원본 `yuv_diff`) */
function hqDiff(a, b) {
  return (Math.abs(((a >> 16) & 0xFF) - ((b >> 16) & 0xFF)) > 48) ||
         (Math.abs(((a >> 8) & 0xFF) - ((b >> 8) & 0xFF)) > 7) ||
         (Math.abs((a & 0xFF) - (b & 0xFF)) > 6);
}

/* ☠☠ **채널을 갈라 센다** — C 원본은 `(c & 0xff00ff00)` 으로 A·G 를, `0x00ff00ff`
 *   로 R·B 를 한꺼번에 곱한다. JS 의 비트 연산은 **32비트 부호 있는 수**라
 *   그 수법을 그대로 쓰면 `0xff000000` 이 음수가 되어 부호가 번진다.
 *   ⇒ 네 채널을 따로 센다. **나오는 값은 같다** (같은 가중합을 `2^s` 로 나눈다).
 *   ★ 가중치 합이 언제나 `2^s` 다 — 아래 규칙을 전수로 검산했다. */
/** (c1·w1 + c2·w2) >> s */
function hqIp2(c1, w1, c2, w2, s) {
  return mk((((c1 >>> 24) & 255) * w1 + ((c2 >>> 24) & 255) * w2) >> s,
            (((c1 >>> 16) & 255) * w1 + ((c2 >>> 16) & 255) * w2) >> s,
            (((c1 >>> 8) & 255) * w1 + ((c2 >>> 8) & 255) * w2) >> s,
            ((c1 & 255) * w1 + (c2 & 255) * w2) >> s);
}
/** (c1·w1 + c2·w2 + c3·w3) >> s */
function hqIp3(c1, w1, c2, w2, c3, w3, s) {
  return mk((((c1 >>> 24) & 255) * w1 + ((c2 >>> 24) & 255) * w2 + ((c3 >>> 24) & 255) * w3) >> s,
            (((c1 >>> 16) & 255) * w1 + ((c2 >>> 16) & 255) * w2 + ((c3 >>> 16) & 255) * w3) >> s,
            (((c1 >>> 8) & 255) * w1 + ((c2 >>> 8) & 255) * w2 + ((c3 >>> 8) & 255) * w3) >> s,
            ((c1 & 255) * w1 + (c2 & 255) * w2 + (c3 & 255) * w3) >> s);
}

/** 0~8 자리를 «가운데(4)를 뺀» 0~7 비트 자리로 옮긴다 (원본 `DROP4`) */
function hqDrop4(z) { return z > 4 ? z - 1 : z; }

/**
 * 무늬를 **자리 바꿔** 다시 짠다 (원본 `INTERP_BOOTSTRAP` 의 `k_shuffled`).
 *
 * 같은 규칙 한 벌로 네 귀퉁이를 다 칠하려고, 칸 번호를 **뒤집거나 돌려** 넘긴다.
 * 그러면 무늬 비트도 같이 옮겨야 규칙이 맞는다.
 * @param rot 돌리기(3배의 좌·우 90°)면 1 — 비트를 **거꾸로** 읽는다
 */
function hqShuffle(k, rot, p) {
  var r = 0;
  for (var n = 0; n < 9; n++) {
    if (n === 4) continue;                       /* 가운데는 자기 자신 — 무늬에 없다 */
    var from = rot ? (7 - hqDrop4(n)) : hqDrop4(n);
    r |= ((k >> from) & 1) << hqDrop4(p[n]);
  }
  return r;
}

/* ── hq2x — 2×2 중 한 칸 (원본 `hq2x_interp_1x1`) ──────────────────────
 * `P(m,r)` = 「무늬에서 **m 이 가리키는 비트만** 봤을 때 r 과 같은가」 */
function hq2x1(k, w, yuv, p) {
  var ks = hqShuffle(k, 0, p);
  var w0 = w[p[0]], w1 = w[p[1]], w3 = w[p[3]], w4 = w[p[4]], w5 = w[p[5]], w7 = w[p[7]];
  var y1 = yuv[p[1]], y3 = yuv[p[3]], y5 = yuv[p[5]], y7 = yuv[p[7]];
  function P(m, r) { return (ks & m) === r; }

  if ((P(0xbf, 0x37) || P(0xdb, 0x13)) && hqDiff(y1, y5)) return hqIp2(w4, 3, w3, 1, 2);
  if ((P(0xdb, 0x49) || P(0xef, 0x6d)) && hqDiff(y7, y3)) return hqIp2(w4, 3, w1, 1, 2);
  if ((P(0x0b, 0x0b) || P(0xfe, 0x4a) || P(0xfe, 0x1a)) && hqDiff(y3, y1)) return w4;
  if ((P(0x6f, 0x2a) || P(0x5b, 0x0a) || P(0xbf, 0x3a) || P(0xdf, 0x5a) ||
       P(0x9f, 0x8a) || P(0xcf, 0x8a) || P(0xef, 0x4e) || P(0x3f, 0x0e) ||
       P(0xfb, 0x5a) || P(0xbb, 0x8a) || P(0x7f, 0x5a) || P(0xaf, 0x8a) ||
       P(0xeb, 0x8a)) && hqDiff(y3, y1)) return hqIp2(w4, 3, w0, 1, 2);
  if (P(0x0b, 0x08)) return hqIp3(w4, 2, w0, 1, w1, 1, 2);
  if (P(0x0b, 0x02)) return hqIp3(w4, 2, w0, 1, w3, 1, 2);
  if (P(0x2f, 0x2f)) return hqIp3(w4, 14, w3, 1, w1, 1, 4);
  if (P(0xbf, 0x37) || P(0xdb, 0x13)) return hqIp3(w4, 5, w1, 2, w3, 1, 3);
  if (P(0xdb, 0x49) || P(0xef, 0x6d)) return hqIp3(w4, 5, w3, 2, w1, 1, 3);
  if (P(0x1b, 0x03) || P(0x4f, 0x43) || P(0x8b, 0x83) || P(0x6b, 0x43)) return hqIp2(w4, 3, w3, 1, 2);
  if (P(0x4b, 0x09) || P(0x8b, 0x89) || P(0x1f, 0x19) || P(0x3b, 0x19)) return hqIp2(w4, 3, w1, 1, 2);
  if (P(0x7e, 0x2a) || P(0xef, 0xab) || P(0xbf, 0x8f) || P(0x7e, 0x0e)) return hqIp3(w4, 2, w3, 3, w1, 3, 3);
  if (P(0xfb, 0x6a) || P(0x6f, 0x6e) || P(0x3f, 0x3e) || P(0xfb, 0xfa) ||
      P(0xdf, 0xde) || P(0xdf, 0x1e)) return hqIp2(w4, 3, w0, 1, 2);
  if (P(0x0a, 0x00) || P(0x4f, 0x4b) || P(0x9f, 0x1b) || P(0x2f, 0x0b) ||
      P(0xbe, 0x0a) || P(0xee, 0x0a) || P(0x7e, 0x0a) || P(0xeb, 0x4b) ||
      P(0x3b, 0x1b)) return hqIp3(w4, 2, w3, 1, w1, 1, 2);
  return hqIp3(w4, 6, w3, 1, w1, 1, 3);
}

/* ── hq3x — 바깥 테두리 두 칸씩 (원본 `hq3x_interp_2x1`) ───────────────
 * 3×3 의 **한가운데는 원래 색 그대로**라 여기서 다루지 않는다. */
function hq3x21(dst, ls, base, k, w, yuv, pos00, pos01, p, rot) {
  var ks = hqShuffle(k, rot, p);
  var w0 = w[p[0]], w1 = w[p[1]], w3 = w[p[3]], w4 = w[p[4]], w5 = w[p[5]], w7 = w[p[7]];
  var y1 = yuv[p[1]], y3 = yuv[p[3]], y5 = yuv[p[5]], y7 = yuv[p[7]];
  function P(m, r) { return (ks & m) === r; }
  var i00 = base + ls * (pos00 >> 1) + (pos00 & 1);
  var i01 = base + ls * (pos01 >> 1) + (pos01 & 1);

  if ((P(0xdb, 0x49) || P(0xef, 0x6d)) && hqDiff(y7, y3)) dst[i00] = hqIp2(w4, 3, w1, 1, 2);
  else if ((P(0xbf, 0x37) || P(0xdb, 0x13)) && hqDiff(y1, y5)) dst[i00] = hqIp2(w4, 3, w3, 1, 2);
  else if ((P(0x0b, 0x0b) || P(0xfe, 0x4a) || P(0xfe, 0x1a)) && hqDiff(y3, y1)) dst[i00] = w4;
  else if ((P(0x6f, 0x2a) || P(0x5b, 0x0a) || P(0xbf, 0x3a) || P(0xdf, 0x5a) ||
            P(0x9f, 0x8a) || P(0xcf, 0x8a) || P(0xef, 0x4e) || P(0x3f, 0x0e) ||
            P(0xfb, 0x5a) || P(0xbb, 0x8a) || P(0x7f, 0x5a) || P(0xaf, 0x8a) ||
            P(0xeb, 0x8a)) && hqDiff(y3, y1)) dst[i00] = hqIp2(w4, 3, w0, 1, 2);
  else if (P(0x4b, 0x09) || P(0x8b, 0x89) || P(0x1f, 0x19) || P(0x3b, 0x19)) dst[i00] = hqIp2(w4, 3, w1, 1, 2);
  else if (P(0x1b, 0x03) || P(0x4f, 0x43) || P(0x8b, 0x83) || P(0x6b, 0x43)) dst[i00] = hqIp2(w4, 3, w3, 1, 2);
  else if (P(0x7e, 0x2a) || P(0xef, 0xab) || P(0xbf, 0x8f) || P(0x7e, 0x0e)) dst[i00] = hqIp2(w3, 1, w1, 1, 1);
  else if (P(0x4f, 0x4b) || P(0x9f, 0x1b) || P(0x2f, 0x0b) || P(0xbe, 0x0a) ||
           P(0xee, 0x0a) || P(0x7e, 0x0a) || P(0xeb, 0x4b) || P(0x3b, 0x1b)) dst[i00] = hqIp3(w4, 2, w3, 7, w1, 7, 4);
  else if (P(0x0b, 0x08) || P(0xf9, 0x68) || P(0xf3, 0x62) || P(0x6d, 0x6c) ||
           P(0x67, 0x66) || P(0x3d, 0x3c) || P(0x37, 0x36) || P(0xf9, 0xf8) ||
           P(0xdd, 0xdc) || P(0xf3, 0xf2) || P(0xd7, 0xd6) || P(0xdd, 0x1c) ||
           P(0xd7, 0x16) || P(0x0b, 0x02)) dst[i00] = hqIp2(w4, 3, w0, 1, 2);
  else dst[i00] = hqIp3(w4, 2, w3, 1, w1, 1, 2);

  if ((P(0xfe, 0xde) || P(0x9e, 0x16) || P(0xda, 0x12) || P(0x17, 0x16) ||
       P(0x5b, 0x12) || P(0xbb, 0x12)) && hqDiff(y1, y5)) dst[i01] = w4;
  else if ((P(0x0f, 0x0b) || P(0x5e, 0x0a) || P(0xfb, 0x7b) || P(0x3b, 0x0b) ||
            P(0xbe, 0x0a) || P(0x7a, 0x0a)) && hqDiff(y3, y1)) dst[i01] = w4;
  else if (P(0xbf, 0x8f) || P(0x7e, 0x0e) || P(0xbf, 0x37) || P(0xdb, 0x13)) dst[i01] = hqIp2(w1, 3, w4, 1, 2);
  else if (P(0x02, 0x00) || P(0x7c, 0x28) || P(0xed, 0xa9) || P(0xf5, 0xb4) ||
           P(0xd9, 0x90)) dst[i01] = hqIp2(w4, 3, w1, 1, 2);
  else if (P(0x4f, 0x4b) || P(0xfb, 0x7b) || P(0xfe, 0x7e) || P(0x9f, 0x1b) ||
           P(0x2f, 0x0b) || P(0xbe, 0x0a) || P(0x7e, 0x0a) || P(0xfb, 0x4b) ||
           P(0xfb, 0xdb) || P(0xfe, 0xde) || P(0xfe, 0x56) || P(0x57, 0x56) ||
           P(0x97, 0x16) || P(0x3f, 0x1e) || P(0xdb, 0x12) || P(0xbb, 0x12)) dst[i01] = hqIp2(w4, 7, w1, 1, 3);
  else dst[i01] = w4;
}

/* ── hq4x — 4×4 중 2×2 덩이 (원본 `hq4x_interp_2x2`) ───────────────── */
function hq4x22(dst, ls, base, k, w, yuv, pos00, pos01, pos10, pos11, p) {
  var ks = hqShuffle(k, 0, p);
  var w0 = w[p[0]], w1 = w[p[1]], w3 = w[p[3]], w4 = w[p[4]], w5 = w[p[5]], w7 = w[p[7]];
  var y1 = yuv[p[1]], y3 = yuv[p[3]], y5 = yuv[p[5]], y7 = yuv[p[7]];
  function P(m, r) { return (ks & m) === r; }
  var i00 = base + ls * (pos00 >> 1) + (pos00 & 1);
  var i01 = base + ls * (pos01 >> 1) + (pos01 & 1);
  var i10 = base + ls * (pos10 >> 1) + (pos10 & 1);
  var i11 = base + ls * (pos11 >> 1) + (pos11 & 1);

  var c00 = (P(0xbf, 0x37) || P(0xdb, 0x13)) && hqDiff(y1, y5);
  var c01 = (P(0xdb, 0x49) || P(0xef, 0x6d)) && hqDiff(y7, y3);
  var c02 = (P(0x6f, 0x2a) || P(0x5b, 0x0a) || P(0xbf, 0x3a) ||
             P(0xdf, 0x5a) || P(0x9f, 0x8a) || P(0xcf, 0x8a) ||
             P(0xef, 0x4e) || P(0x3f, 0x0e) || P(0xfb, 0x5a) ||
             P(0xbb, 0x8a) || P(0x7f, 0x5a) || P(0xaf, 0x8a) ||
             P(0xeb, 0x8a)) && hqDiff(y3, y1);
  var c03 = P(0xdb, 0x49) || P(0xef, 0x6d);
  var c04 = P(0xbf, 0x37) || P(0xdb, 0x13);
  var c05 = P(0x1b, 0x03) || P(0x4f, 0x43) || P(0x8b, 0x83) || P(0x6b, 0x43);
  var c06 = P(0x4b, 0x09) || P(0x8b, 0x89) || P(0x1f, 0x19) || P(0x3b, 0x19);
  var c07 = P(0x0b, 0x08) || P(0xf9, 0x68) || P(0xf3, 0x62) ||
            P(0x6d, 0x6c) || P(0x67, 0x66) || P(0x3d, 0x3c) ||
            P(0x37, 0x36) || P(0xf9, 0xf8) || P(0xdd, 0xdc) ||
            P(0xf3, 0xf2) || P(0xd7, 0xd6) || P(0xdd, 0x1c) ||
            P(0xd7, 0x16) || P(0x0b, 0x02);
  var c08 = (P(0x0f, 0x0b) || P(0x2b, 0x0b) || P(0xfe, 0x4a) ||
             P(0xfe, 0x1a)) && hqDiff(y3, y1);
  var c09 = P(0x2f, 0x2f);
  var c10 = P(0x0a, 0x00);
  var c11 = P(0x0b, 0x09);
  var c12 = P(0x7e, 0x2a) || P(0xef, 0xab);
  var c13 = P(0xbf, 0x8f) || P(0x7e, 0x0e);
  var c14 = P(0x4f, 0x4b) || P(0x9f, 0x1b) || P(0x2f, 0x0b) ||
            P(0xbe, 0x0a) || P(0xee, 0x0a) || P(0x7e, 0x0a) ||
            P(0xeb, 0x4b) || P(0x3b, 0x1b);
  var c15 = P(0x0b, 0x03);

  if (c00) dst[i00] = hqIp2(w4, 5, w3, 3, 3);
  else if (c01) dst[i00] = hqIp2(w4, 5, w1, 3, 3);
  else if ((P(0x0b, 0x0b) || P(0xfe, 0x4a) || P(0xfe, 0x1a)) && hqDiff(y3, y1)) dst[i00] = w4;
  else if (c02) dst[i00] = hqIp2(w4, 5, w0, 3, 3);
  else if (c03) dst[i00] = hqIp2(w4, 3, w3, 1, 2);
  else if (c04) dst[i00] = hqIp2(w4, 3, w1, 1, 2);
  else if (c05) dst[i00] = hqIp2(w4, 5, w3, 3, 3);
  else if (c06) dst[i00] = hqIp2(w4, 5, w1, 3, 3);
  else if (P(0x0f, 0x0b) || P(0x5e, 0x0a) || P(0x2b, 0x0b) || P(0xbe, 0x0a) ||
           P(0x7a, 0x0a) || P(0xee, 0x0a)) dst[i00] = hqIp2(w1, 1, w3, 1, 1);
  else if (c07) dst[i00] = hqIp2(w4, 5, w0, 3, 3);
  else dst[i00] = hqIp3(w4, 2, w1, 1, w3, 1, 2);

  if (c00) dst[i01] = hqIp2(w4, 7, w3, 1, 3);
  else if (c08) dst[i01] = w4;
  else if (c02) dst[i01] = hqIp2(w4, 3, w0, 1, 2);
  else if (c09) dst[i01] = w4;
  else if (c10) dst[i01] = hqIp3(w4, 5, w1, 2, w3, 1, 3);
  else if (P(0x0b, 0x08)) dst[i01] = hqIp3(w4, 5, w1, 2, w0, 1, 3);
  else if (c11) dst[i01] = hqIp2(w4, 5, w1, 3, 3);
  else if (c04) dst[i01] = hqIp2(w1, 3, w4, 1, 2);
  else if (c12) dst[i01] = hqIp3(w1, 2, w4, 1, w3, 1, 2);
  else if (c13) dst[i01] = hqIp2(w1, 5, w3, 3, 3);
  else if (c05) dst[i01] = hqIp2(w4, 7, w3, 1, 3);
  else if (P(0xf3, 0x62) || P(0x67, 0x66) || P(0x37, 0x36) || P(0xf3, 0xf2) ||
           P(0xd7, 0xd6) || P(0xd7, 0x16) || P(0x0b, 0x02)) dst[i01] = hqIp2(w4, 3, w0, 1, 2);
  else if (c14) dst[i01] = hqIp2(w1, 1, w4, 1, 1);
  else dst[i01] = hqIp2(w4, 3, w1, 1, 2);

  if (c01) dst[i10] = hqIp2(w4, 7, w1, 1, 3);
  else if (c08) dst[i10] = w4;
  else if (c02) dst[i10] = hqIp2(w4, 3, w0, 1, 2);
  else if (c09) dst[i10] = w4;
  else if (c10) dst[i10] = hqIp3(w4, 5, w3, 2, w1, 1, 3);
  else if (P(0x0b, 0x02)) dst[i10] = hqIp3(w4, 5, w3, 2, w0, 1, 3);
  else if (c15) dst[i10] = hqIp2(w4, 5, w3, 3, 3);
  else if (c03) dst[i10] = hqIp2(w3, 3, w4, 1, 2);
  else if (c13) dst[i10] = hqIp3(w3, 2, w4, 1, w1, 1, 2);
  else if (c12) dst[i10] = hqIp2(w3, 5, w1, 3, 3);
  else if (c06) dst[i10] = hqIp2(w4, 7, w1, 1, 3);
  else if (P(0x0b, 0x08) || P(0xf9, 0x68) || P(0x6d, 0x6c) || P(0x3d, 0x3c) ||
           P(0xf9, 0xf8) || P(0xdd, 0xdc) || P(0xdd, 0x1c)) dst[i10] = hqIp2(w4, 3, w0, 1, 2);
  else if (c14) dst[i10] = hqIp2(w3, 1, w4, 1, 1);
  else dst[i10] = hqIp2(w4, 3, w3, 1, 2);

  if ((P(0x7f, 0x2b) || P(0xef, 0xab) || P(0xbf, 0x8f) || P(0x7f, 0x0f)) &&
      hqDiff(y3, y1)) dst[i11] = w4;
  else if (c02) dst[i11] = hqIp2(w4, 7, w0, 1, 3);
  else if (c15) dst[i11] = hqIp2(w4, 7, w3, 1, 3);
  else if (c11) dst[i11] = hqIp2(w4, 7, w1, 1, 3);
  else if (P(0x0a, 0x00) || P(0x7e, 0x2a) || P(0xef, 0xab) || P(0xbf, 0x8f) ||
           P(0x7e, 0x0e)) dst[i11] = hqIp3(w4, 6, w3, 1, w1, 1, 3);
  else if (c07) dst[i11] = hqIp2(w4, 7, w0, 1, 3);
  else dst[i11] = w4;
}

/**
 * HQx 한 벌 — `xbrz(n)` 과 **같은 모양**의 함수를 돌려준다(`img → img`).
 * @param n 배율 2·3·4
 */
function hqx(n) {
  return function (img) {
    var w = img.width, h = img.height, src = toU32(img);
    var W = w * n, dst = new Uint32Array(W * h * n);
    /* YUV 는 픽셀마다 한 번만 센다 — 이웃 판정에서 아홉 번씩 다시 세지 않게 */
    var yv = new Int32Array(w * h);
    for (var i = 0; i < w * h; i++) yv[i] = hqYuv(src[i]);

    var c = new Array(9), cy = new Array(9);
    for (var y = 0; y < h; y++) {
      /* 가장자리는 **자기 줄/칸을 되쓴다** (원본 `prevline`·`nextcol` 과 같다) */
      var up = y > 0 ? -w : 0, dn = y < h - 1 ? w : 0;
      for (var x = 0; x < w; x++) {
        var o = y * w + x;
        var lf = x > 0 ? -1 : 0, rt = x < w - 1 ? 1 : 0;
        var idx = [o + up + lf, o + up, o + up + rt,
                   o + lf, o, o + rt,
                   o + dn + lf, o + dn, o + dn + rt];
        for (var t = 0; t < 9; t++) { c[t] = src[idx[t]]; cy[t] = yv[idx[t]]; }

        /* 무늬 — 가운데(4)와 여덟 이웃을 견준다. **색이 똑같으면 곧바로 0** */
        var k = 0;
        var 자리 = [0, 1, 2, 3, -1, 4, 5, 6, 7];   /* 칸 번호 → 비트 자리 */
        for (var t2 = 0; t2 < 9; t2++) {
          if (t2 === 4) continue;
          if (c[4] !== c[t2] && hqDiff(cy[4], cy[t2])) k |= 1 << 자리[t2];
        }

        var b = (y * n) * W + (x * n);
        if (n === 2) {
          dst[b] = hq2x1(k, c, cy, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
          dst[b + 1] = hq2x1(k, c, cy, [2, 1, 0, 5, 4, 3, 8, 7, 6]);      /* 좌우 뒤집기 */
          dst[b + W] = hq2x1(k, c, cy, [6, 7, 8, 3, 4, 5, 0, 1, 2]);      /* 위아래 뒤집기 */
          dst[b + W + 1] = hq2x1(k, c, cy, [8, 7, 6, 5, 4, 3, 2, 1, 0]);  /* 가운데 뒤집기 */
        } else if (n === 3) {
          hq3x21(dst, W, b, k, c, cy, 0, 1, [0, 1, 2, 3, 4, 5, 6, 7, 8], 0);
          hq3x21(dst, W, b + 1, k, c, cy, 1, 3, [2, 5, 8, 1, 4, 7, 0, 3, 6], 1);   /* 오른쪽 90° */
          hq3x21(dst, W, b + W, k, c, cy, 2, 0, [6, 3, 0, 7, 4, 1, 8, 5, 2], 1);   /* 왼쪽 90° */
          hq3x21(dst, W, b + W + 1, k, c, cy, 3, 2, [8, 7, 6, 5, 4, 3, 2, 1, 0], 0);
          dst[b + W + 1] = c[4];                    /* ★ 한가운데는 **원래 색 그대로** */
        } else {
          hq4x22(dst, W, b, k, c, cy, 0, 1, 2, 3, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
          hq4x22(dst, W, b + 2, k, c, cy, 1, 0, 3, 2, [2, 1, 0, 5, 4, 3, 8, 7, 6]);
          hq4x22(dst, W, b + 2 * W, k, c, cy, 2, 3, 0, 1, [6, 7, 8, 3, 4, 5, 0, 1, 2]);
          hq4x22(dst, W, b + 2 * W + 2, k, c, cy, 3, 2, 1, 0, [8, 7, 6, 5, 4, 3, 2, 1, 0]);
        }
      }
    }
    return fromU32(dst, W, h * n);
  };
}

var TABLE = {
  none:  { factor: 1, fn: null,     name: '없음 (원본 픽셀)' },
  epx2:  { factor: 2, fn: epx2,     name: 'EPX 2배' },
  epx3:  { factor: 3, fn: epx3,     name: 'Scale3x 3배' },
  xbrz2: { factor: 2, fn: xbrz(2),  name: 'xBRZ 2배' },
  xbrz3: { factor: 3, fn: xbrz(3),  name: 'xBRZ 3배' },
  xbrz4: { factor: 4, fn: xbrz(4),  name: 'xBRZ 4배' },
  /* ★★★ **좁힌 xBRZ** — 귀퉁이에 «바로 인접한» 칸만 섞는다 (2026-09-17).
   *   기존 셋은 위에 그대로 있다. 사장님이 눈으로 견주어 고르시면 된다.
   *
   *   ☠ 여기 **단계를 손으로 박지 않는다** — 전에는 `좁힌규칙(n, 1)` 로 **`+1`** 이
   *     들어가 있었다. 단계는 `0 ~ −3`(0 = 기본 xBRZ)이므로 `+1` 은 **기본보다
   *     오히려 넓은** 반경이고, 개발 패널 슬라이더가 보여 주는 기본값 `−1` 과도
   *     달랐다 (패널에서 값을 한 번 넣으면 `좁힘설정()` 이 다시 구워 덮었으므로
   *     눈에 잘 안 띄었다).
   *   ⇒ 인자를 **생략해** 위 `좁힘` 의 지금 값을 그대로 쓴다. 그러면 표·모듈·
   *     슬라이더 셋이 **언제나 한 값**이다. */
  xbrz2n: { factor: 2, fn: xbrz(2, 좁힌규칙(2)), name: 'xBRZ 2배 (좁힘)', 좁힘: 좁힘.단계 },
  xbrz3n: { factor: 3, fn: xbrz(3, 좁힌규칙(3)), name: 'xBRZ 3배 (좁힘)', 좁힘: 좁힘.단계 },
  xbrz4n: { factor: 4, fn: xbrz(4, 좁힌규칙(4)), name: 'xBRZ 4배 (좁힘)', 좁힘: 좁힘.단계 },

  /* ★★★ **HQx** — xBRZ 이전의 전통 확대기 (2026-09-17 · 사장님 요청).
   *   xBRZ 와 **판정 방식이 다르다** — 여덟 이웃의 «다름» 무늬표를 따른다.
   *   선이 더 또렷하고 색 번짐이 적은 대신, 곡선은 xBRZ 쪽이 더 부드럽다.
   *   근거·라이선스는 위 `hqx()` 머리 주석에 적어 두었다. */
  hq2x: { factor: 2, fn: hqx(2), name: 'HQ2x 2배' },
  hq3x: { factor: 3, fn: hqx(3), name: 'HQ3x 3배' },
  hq4x: { factor: 4, fn: hqx(4), name: 'HQ4x 4배' }
};

/* ══════════════════════════════════════════════════════════════════════
 * 실행기 배선용 — 전역 현재 필터
 *
 * 규칙 하나만 지키면 됩니다:
 *   **배치·좌표는 언제나 논리(원본 1배) 픽셀. 그림만 N배로 채운다.**
 *
 *   - 캔버스   : 백킹스토어 N배 + ctx 를 N배 변환 → 그리는 코드는 논리 좌표 그대로
 *   - 배경이미지: N배 그림 + `background-size: <논리w>px <논리h>px`
 *   - 확대 보간 : none 이면 `pixelated`, 그 외엔 `auto`(부드럽게 축소)
 *
 * 이렇게 하면 원본 좌표계(320×200)를 건드리지 않으므로 EXE 근거 좌표가 그대로
 * 유지됩니다 — 스케일러는 순수하게 표시 계층에만 얹힙니다.
 * ════════════════════════════════════════════════════════════════════ */
var CUR = 'none', N = 1, LISTENERS = [];

/* ★ [리마스터] **고른 스케일러를 기억한다** (2026-10-05 · 사장님 「그리고 개발툴에서 스케일러 종료하더라도 이전에 사용하던걸로 이어서 하게 해줘.」)
 *   `set()` · `좁힘설정()` 이 바뀔 때마다 브라우저 저장소에 남기고, 셸이 뜰 때 `되살리기()` 로 다시 건다.
 *   ★ 저장소를 못 쓰면(시험·사생활 창) 조용히 넘어간다 — 그때는 예전처럼 «없음» 에서 시작한다. */
var 스케일러저장키 = 'g2.scaler', 좁힘저장키 = 'g2.scaler.narrow';
function 설정쓰기(키, 값) { try { if (root.localStorage) root.localStorage.setItem(키, String(값)); } catch (e) { } }
function 설정읽기(키) { try { return root.localStorage ? root.localStorage.getItem(키) : null; } catch (e) { return null; } }

/** 스케일러 결과({width,height,data})를 진짜 ImageData 로. 이미 ImageData 면 그대로. */
function asImageData(o) {
  if (typeof ImageData === 'undefined') return o;                 // Node
  return (o instanceof ImageData) ? o : new ImageData(o.data, o.width, o.height);
}

/* ★ 정본 406 — 그래픽 장치(GPU)가 멈춘 것을 알아챈다: 화면에 붙은 WebGL 판이 «문맥 잃음»을 받았는데 우리 코드가 일부러 버린 것(WEBGL_lose_context)이 아니면 기록
 *   (GPU 프로세스가 죽으면 그 화면의 WebGL 판이 모두 문맥을 잃는다 · 앱 본체를 안 고치고 패치로 · PC·휴대폰 모두) */
var 일부러버린때 = 0;
function 그래픽잃음적기(ev) {
  try {
    var c = ev && ev.target;
    if (!c || !c.isConnected) return;                              /* 버리는 중인 판(문서에서 뗀 것) */
    if (Date.now() - 일부러버린때 < 1500) return;                   /* 우리 코드가 일부러 버림(마을 3D 정리 · 진단 등) */
    설정쓰기('g2.그래픽잃음', JSON.stringify({ 때: Date.now(), 스케일러: CUR }));
    try { console.warn('[스케일러] 그래픽 장치 문맥 잃음 — 스케일러 ' + CUR + ' (다음에 켤 때 3·4배면 2배로 낮춤)'); } catch (e2) { }
  } catch (e) { }
}
function 일부러버림표시() {
  [root.WebGLRenderingContext, root.WebGL2RenderingContext].forEach(function (C) {
    var P = C && C.prototype; if (!P || !P.getExtension || P.getExtension.__잃음표시) return;
    var 원 = P.getExtension;
    P.getExtension = function (이름) {
      var x = 원.apply(this, arguments);
      if (x && 이름 === 'WEBGL_lose_context' && x.loseContext && !x.loseContext.__잃음표시) {
        var 원잃 = x.loseContext; x.loseContext = function () { 일부러버린때 = Date.now(); return 원잃.apply(this, arguments); }; x.loseContext.__잃음표시 = true;
      }
      return x;
    };
    P.getExtension.__잃음표시 = true;
  });
}
if (typeof root.addEventListener === 'function') { 일부러버림표시(); root.addEventListener('webglcontextlost', 그래픽잃음적기, true); }
/* 화면 위 알림 한 줄(8초) — 게임 화면과 상관없이 늘 같은 자리 */
function 알림띄우기(글) {
  try {
    var 띄움 = function () {
      var d = root.document.createElement('div');
      d.textContent = 글;
      d.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:2147483600;max-width:90%;padding:10px 16px;white-space:pre-line;' +
        'background:rgba(20,24,32,.92);color:#ffe9a0;border:1px solid #887;border-radius:6px;font:14px/1.5 sans-serif;pointer-events:none';
      root.document.body.appendChild(d);
      setTimeout(function () { if (d.parentNode) d.parentNode.removeChild(d); }, 8000);
    };
    if (root.document && root.document.body) 띄움(); else if (root.document) root.document.addEventListener('DOMContentLoaded', 띄움);
  } catch (e) { }
}
var API = {
  list:   function () { return Object.keys(TABLE); },
  /* ☠☠ **`name`·`factor` 는 「키」를 받는 조회 함수다** — **지금 상태가 아니다** (2026-09-02)
   *   인자 없이 부르면 `TABLE[undefined] || TABLE.none` 이라 **언제나 「없음·1」**이 나온다.
   *   ☠ 실측에서 `xbrz2` 가 잘 걸려 있는데도 `factor()` 가 1 을 줘서
   *     잠깐 **버그로 오해**했다(캔버스는 이미 640×400 이었다).
   *   ⇒ **지금 배율은 `N()`**, 지금 키는 `cur()` 다. 굳이 이 둘을 쓰려면 `factor(cur())`. */
  name:   function (k) { return (TABLE[k] || TABLE.none).name; },
  factor: function (k) { return (TABLE[k] || TABLE.none).factor; },
  /** @param {ImageData|{width,height,data}} img @returns 같은 모양 (none 이면 그대로) */
  apply:  function (k, img) {
    var e = TABLE[k];
    return (e && e.fn) ? e.fn(img) : img;
  },

  /* ── 전역 상태 ─────────────────────────────────────────────────── */
  cur: function () { return CUR; },
  /** 현재 배율 (1·2·3·4) */
  N: function () { return N; },
  /** 인라인 style 에 넣을 확대 보간 방식 */
  rendering: function () { return N > 1 ? 'auto' : 'pixelated'; },
  /** 바뀌면 fn() 호출 — 실행기는 여기서 자산을 다시 굽습니다. */
  onChange: function (fn) { LISTENERS.push(fn); },

  /* ══════════════════════════════════════════════════════════════════
   *  ★★★ **좁힌 xBRZ 손잡이** — 개발 패널이 값을 넣어 최적값을 찾는다
   *      (2026-09-17 사장님 지시)
   * ══════════════════════════════════════════════════════════════════ */
  /**
   * 지금 값 `{단계, 기울기}` — **둘 다 0 이면 기본 xBRZ 와 같은 그림**이다.
   * `반경(배율)` 로 그 배율의 실제 체비셰프 반경도 물어볼 수 있다.
   */
  /** 마지막에 쓰던 스케일러(와 xBRZ 좁힘·섞기)를 다시 건다 — 셸 부팅이 부른다. @returns {string|null} 건 키 */
  되살리기: function () {
    var p = 설정읽기(좁힘저장키);
    if (p && /^-?\d+,-?\d+$/.test(p)) { var ab = p.split(','); API.좁힘설정(ab[0] | 0, ab[1] | 0); }
    var k = 설정읽기(스케일러저장키);
    /* [리마스터] 휴대폰(주소 «모바일=1» — 모바일판 본체가 붙인다)은 처음 값 xBRZ 2배(좁힘) — xBRZ 는 CPU 자바스크립트로 그림마다 늘려 4배는 휴대폰에 무겁다
     *   (사장님 11-20 아이폰 「메탈로 안그리고 cpu로 그리고 있는것 같다고 하네. 많이 느린가봐」 → 고르심 «휴대폰은 xBRZ 2배» · 정본 335)
     *   이미 저장된 값이 처음 기본(4배 좁힘) 그대로면 한 번만 2배로 옮긴다(표지 g2.scaler.모바일2배) · 직접 고른 다른 값은 그대로 */
    var 모바일 = false; try { var 물 = String(root.location && root.location.search || ''); try { 물 = decodeURIComponent(물); } catch (e1) { } 모바일 = /[?&]모바일=1/.test(물); } catch (e2) { }
    /* ★ 정본 406 — 지난번에 그래픽 장치(GPU)가 멈췄으면(아래 그래픽잃음적기) 3·4배를 같은 갈래 2배로 한 번 낮춘다 (사장님 11-23 고르심 «꺼진 뒤 다시 켜면 2배로 낮춤»)
     *   신고(11-22 PC · 앱 0.1.55 · xbrz4n): «GPU 프로세스 죽음 crashed 34» 로 꺼짐 · 측정 크롬 그래픽 메모리 — 끔 285MB · 2배 473MB · 4배 1,364MB */
    var 잃음 = null; try { 잃음 = JSON.parse(설정읽기('g2.그래픽잃음') || 'null'); } catch (e3) { 잃음 = null; }
    if (잃음) {
      try { root.localStorage.removeItem('g2.그래픽잃음'); } catch (e4) { }
      var 낮출 = k && TABLE[k] && TABLE[k].factor >= 3 ? k.replace(/[34](?=n?$|x$)/, '2') : null;
      if (낮출 && TABLE[낮출] && Date.now() - (+잃음.때 || 0) < 7 * 864e5) {
        API.set(낮출); API.낮춘까닭 = { 전: k, 후: 낮출, 때: 잃음.때 };
        try { console.warn('[스케일러] 지난번에 그래픽 장치가 멈춰(' + new Date(+잃음.때).toISOString() + ') ' + k + ' → ' + 낮출 + ' 로 낮췄습니다'); } catch (e5) { }
        알림띄우기('지난번에 그래픽 장치가 멈춰 화면 확대(스케일러)를 2배로 낮췄습니다.\n게임 설정 › 화면 › 스케일러에서 다시 바꿀 수 있습니다.');
        return 낮출;
      }
    }
    if (모바일 && TABLE.xbrz2n && (!k || (k === 'xbrz4n' && !설정읽기('g2.scaler.모바일2배')))) { 설정쓰기('g2.scaler.모바일2배', '1'); API.set('xbrz2n'); return 'xbrz2n'; }
    if (k && TABLE[k]) { API.set(k); return k; }
    /* 저장된 값이 없으면(처음 켬) xBRZ 4배 좁힘 — 사장님 11-09 「스케일러는 기본 xbrzx4 좁힘으로 하면 좋겠어.」 · 원본 픽셀은 «없음»을 고르거나 ?scaler=none */
    if (TABLE.xbrz4n) { API.set('xbrz4n'); return 'xbrz4n'; }
    return null;
  },
  좁힘값: function () {
    return { 단계: 좁힘.단계, 기울기: 좁힘.기울기,
             반경: function (n) { return 반경환산(n || N || 3, 좁힘.단계); },
             세기: 세기환산(좁힘.기울기) };
  },
  /**
   * 값을 바꾸고 `xbrz*n` 셋을 **다시 굽는다**.
   * ★ 지금 쓰는 것이 좁힘 계열이면 `onChange` 를 쏴 화면이 다시 굽히게 한다.
   * @param 단계   0 ~ −3   (0 = 기본 xBRZ · 내릴수록 좁다)
   * @param 기울기 −100~+100 (0 = 기본 xBRZ · 내리면 덜 섞고 올리면 더 섞는다)
   * @returns {boolean} 값이 실제로 바뀌었나
   */
  좁힘설정: function (단계, 기울기) {
    var s = 단계 == null ? 좁힘.단계 : Math.max(-3, Math.min(0, 단계 | 0));
    var g = 기울기 == null ? 좁힘.기울기 : Math.max(-100, Math.min(100, 기울기 | 0));
    if (s === 좁힘.단계 && g === 좁힘.기울기) return false;
    좁힘.단계 = s; 좁힘.기울기 = g;
    설정쓰기(좁힘저장키, s + ',' + g);                  /* [리마스터] 다음에 켤 때 이어 쓴다 */
    /* 좁힌 표를 새로 구워 끼운다 — 기존 `xbrz2·3·4` 는 안 건드린다 */
    [2, 3, 4].forEach(function (n) {
      var 키 = 'xbrz' + n + 'n';
      if (!TABLE[키]) return;
      TABLE[키].fn = xbrz(n, 좁힌규칙(n, s, g));
      TABLE[키].단계 = s; TABLE[키].기울기 = g;
      /* 이름에 지금 값을 박는다 — 둘 다 0 이면 «기본과 같음» 이라고 말한다 */
      TABLE[키].name = 'xBRZ ' + n + '배 ' +
        (s === 0 && g === 0 ? '(좁힘 0 · 기본과 같음)'
                            : '(좁힘 ' + s + ' · 섞기 ' + (g > 0 ? '+' : '') + g + ')');
    });
    /* ☠ 지금 그 필터를 쓰고 있으면 **화면을 다시 구워야** 값이 보인다.
     *   `set()` 은 같은 키면 무시하므로 듣는이를 **직접** 부른다. */
    if (/^xbrz\dn$/.test(CUR)) {
      /* ★ 2026-09-24 — 시트 캐시 키는 필터 이름(CUR)인데 좁힘은 이름을 안 바꾼다 ⇒ 그 필터 몫을 비운다 */
      Object.keys(API._sheet).forEach(function (k) { if (k.indexOf(CUR + '|') === 0) delete API._sheet[k]; });
      for (var i = 0; i < LISTENERS.length; i++) LISTENERS[i](CUR, N);
    }
    return true;
  },
  /* ★ 정본 454 — 휴대폰 앱이 통째로 꺼진 튕김(네이티브 충돌·메모리 부족)은 위 «문맥 잃음»을 적을 틈이 없다 → 다음에 켤 때 튕김 기록을 읽은
   *   bug_report.js 가 그때 스케일러(마지막 상태)를 넘겨 부른다 · 그 값이 지금 그대로이고 3·4배면 같은 갈래 2배로 낮춘다(정본 406 과 같은 식·같은 알림)
   *   (신고 튕김기록_휴대폰_20261124_202342·202437 — xbrz4 로 전투 1-1 시작 직후 연달아 네이티브 충돌 · 두 번째도 xbrz4 그대로) */
  튕김낮추기: function (전) {
    if (!전 || 전 !== CUR || !TABLE[CUR] || TABLE[CUR].factor < 3) return null;
    var 낮출 = CUR.replace(/[34](?=n?$|x$)/, '2');
    if (!TABLE[낮출]) return null;
    var 원 = CUR; API.set(낮출); API.낮춘까닭 = { 전: 원, 후: 낮출, 때: Date.now(), 까닭: '튕김' };
    try { console.warn('[스케일러] 지난번에 게임이 꺼져(튕김) ' + 원 + ' → ' + 낮출 + ' 로 낮췄습니다'); } catch (e) { }
    알림띄우기('지난번에 게임이 꺼져 화면 확대(스케일러)를 2배로 낮췄습니다.\n게임 설정 › 화면 › 스케일러에서 다시 바꿀 수 있습니다.');
    return 낮출;
  },
  set: function (k) {
    if (!TABLE[k] || k === CUR) return false;
    CUR = k; N = TABLE[k].factor;
    설정쓰기(스케일러저장키, k);                        /* [리마스터] 다음에 켤 때 이어 쓴다 */
    for (var i = 0; i < LISTENERS.length; i++) LISTENERS[i](k, N);
    return true;
  },
  /** 현재 필터로 확대 */
  up: function (img) { return API.apply(CUR, img); },

  /* ── 배선 도우미 ───────────────────────────────────────────────── */
  /**
   * 논리 w×h 캔버스 준비 — 백킹스토어는 N배, 그리기 좌표는 논리 그대로.
   * ※ canvas.width 대입은 컨텍스트 상태를 초기화하므로 **그리기 전에** 부른다.
   * @returns {CanvasRenderingContext2D}
   */
  prepare: function (canvas, w, h) {
    canvas.width = w * N; canvas.height = h * N;
    canvas.style.width = w + 'px'; canvas.style.height = h + 'px';
    var g = canvas.getContext('2d');
    g.setTransform(N, 0, 0, N, 0, 0);
    /* ★ 반드시 false. N배 그림은 1:1 로 떨어지고, 아직 1배인 그림(폰트 등)은
     *   지금까지와 똑같이 최근접 확대돼 흐려지지 않는다. */
    g.imageSmoothingEnabled = false;
    return g;
  },
  /**
   * 논리 w×h 그림 → 확대 캔버스. `.논리w`/`.논리h` 에 원래 크기를 달아 둔다.
   * @param {ImageData|{width,height,data}} img
   */
  toCanvas: function (img) {
    var s = asImageData(API.up(img));
    var c = document.createElement('canvas');
    c.width = s.width; c.height = s.height;
    c.getContext('2d', { willReadFrequently: true }).putImageData(s, 0, 0);   /* CPU 캔버스 — PNG 되읽기가 싸다 (2026-09-25 Z-47 · native frameToCanvas 와 같은 까닭) */
    c.논리w = img.width; c.논리h = img.height;
    c.style.width = img.width + 'px'; c.style.height = img.height + 'px';
    return c;
  },
  /** 배경이미지용 CSS 조각 — 논리 크기에 맞춰 N배 그림을 눌러 담는다. */
  bg: function (url, w, h) {
    return 'background-image:url(' + url + ');background-repeat:no-repeat;' +
           (N > 1 ? 'background-size:' + w + 'px ' + h + 'px;' : '');
  },

  /* ── 시트 PNG (자산/units·ui·fx 등) 확대 캐시 ────────────────────
   * 원본 직독이 아직 안 된 추출 시트도 같은 필터를 태운다. 비동기라
   * 준비되면 onReady 로 알린다(그 전에는 원본 URL 을 그대로 쓴다). */
  _sheet: {},
  sheet: function (url, onReady) {
    if (N === 1) return url;
    var key = CUR + '|' + url, hit = API._sheet[key];   /* ★ 2026-09-24 필터 이름으로 — 같은 배율 다른 필터(xbrz2↔hq2x)가 옛 그림을 쓰던 것 */
    if (hit) return hit.url;
    API._sheet[key] = { url: url };                       // 준비 전엔 원본
    var im = new Image();
    im.onload = function () {
      try {
        var c = document.createElement('canvas');
        c.width = im.width; c.height = im.height;
        var g = c.getContext('2d');
        g.drawImage(im, 0, 0);
        var out = asImageData(API.up(g.getImageData(0, 0, im.width, im.height)));
        var c2 = document.createElement('canvas');
        c2.width = out.width; c2.height = out.height;
        c2.getContext('2d').putImageData(out, 0, 0);
        /* ★ 논리 크기를 달아 둔다 — `drawImage` 몽키패치가 이걸 보고 되돌린다.
         *   캔버스도 함께 캐시해 두면 URL 을 다시 로드할 필요가 없다. */
        c2.논리w = im.width; c2.논리h = im.height;
        API._sheet[key].canvas = c2;
        API._sheet[key].url = c2.toDataURL();
      } catch (e) { /* tainted canvas — 원본 URL 유지 */ }
      if (onReady) onReady(API._sheet[key].url, API._sheet[key].canvas);
    };
    im.src = url;
    return url;
  },

  /**
   * 추출 PNG 한 장을 **N배 캔버스로** 돌려준다 (`논리w`/`논리h` 포함).
   *
   * 사용자 지적 2026-08-14: 「**TP 구체**(내부 게이지만 적용됨)도 적용 안 되고」.
   * TP 구체 **틀**은 `TIME_GRA.SYB` 인데 아직 직독으로 안 올라와 있어
   * `Assets.image` 의 **추출 PNG 갈래**를 탄다. 그 갈래가 `new Image()` 로
   * 원본을 그대로 받고 있어 스케일러 밖이었다.
   * (게이지는 `fillRect` 도형이라 N배 컨텍스트에 바로 그려져 매끄러웠다.)
   *
   * 준비 전에는 `null` 을 돌려주고, 준비되면 `onReady(canvas)` 로 알린다.
   * @returns {HTMLCanvasElement|null}
   */
  sheetCanvas: function (url, onReady) {
    if (N === 1) return null;
    var key = CUR + '|' + url, hit = API._sheet[key];   /* ★ 2026-09-24 필터 이름으로 — 같은 배율 다른 필터(xbrz2↔hq2x)가 옛 그림을 쓰던 것 */
    if (hit && hit.canvas) return hit.canvas;
    if (hit) return null;                                 // 받는 중
    API.sheet(url, function (u2, cv) { if (cv && onReady) onReady(cv); });
    return null;
  }
};

/* ══════════════════════════════════════════════════════════════════════
 * drawImage 보정 — 스케일러의 유일한 침습 지점
 *
 * 스케일러가 켜지면 스프라이트 캔버스는 N배가 됩니다. 그런데 실행기 곳곳의
 * `ctx.drawImage(im, x, y)` 는 **자연 크기**로 그리므로 그대로 두면 N배로
 * 커져 배치가 전부 어긋납니다. 호출부를 수십 군데 고치는 대신 여기 한 곳에서
 * 논리 크기로 되돌립니다. 판별 기준은 우리가 구운 캔버스에만 달아 둔 `논리w`.
 *
 *   3인자 drawImage(im,x,y)                 → 목적지 크기를 논리 크기로 지정
 *   5인자 drawImage(im,x,y,w,h)             → 이미 논리 크기 — 그대로
 *   9인자 drawImage(im,sx,sy,sw,sh,…)       → 잘라내는 원본 사각형만 N배
 *
 * 원본 좌표(EXE 근거)는 언제나 논리값 그대로 유지됩니다.
 * ════════════════════════════════════════════════════════════════════ */
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.__g2scaler) {
  var _di = CanvasRenderingContext2D.prototype.drawImage;
  /** 스케일러가 구운 자산의 원본 사각형만 배율 환산하고 목적지 논리 좌표는 보존한다. */
  CanvasRenderingContext2D.prototype.drawImage = function (im) {
    var lw = im && im.논리w;
    if (!lw || im.width === lw) return _di.apply(this, arguments);
    var n = im.width / lw, a = arguments;
    if (a.length === 3) return _di.call(this, im, a[1], a[2], lw, im.논리h);
    if (a.length === 9) {
      /* ☠☠☠★★★ **소스 사각형이 «논리» 좌표인가 «실제» 좌표인가** — 2026-09-17 실측
       *
       *   이 자리는 「9인자는 호출부가 **논리** 소스를 준다」고 보고 무조건 `n` 을 곱했다.
       *   그런데 `hud.js:3802 조각()` 같은 호출부는 **이미 실제 캔버스 크기**를 준다 —
       *     `ctx.drawImage(c, 0, 0, c.width, c.height, x, y, 논리w, 논리h)`
       *   그러면 여기서 또 곱해 소스가 `(0,0,2880,2224)` 처럼 **캔버스 밖으로** 나가고,
       *   실제로 찍히는 것은 그림의 **왼쪽 위 1/n** 뿐이라 「그림이 1/n 로 줄어든」
       *   것처럼 보인다. 실측 — 4배에서 불꽃 창틀·AUTO 단추·대사창 테두리가
       *   정확히 1/4 로 나왔다 (사기바·기둥처럼 직접 그리는 것은 멀쩡).
       *
       *   ☠ 이 어긋남은 오래 숨어 있었다 — `hud.js` 의 `THE._prepare` 오타 때문에
       *     `rebuildForScaler()` 가 **아예 안 돌아** HUD 가 옛 배율로 남아 있었다.
       *     그 오타를 고치자 비로소 드러났다.
       *
       *   ★ 두 규약을 **둘 다 받는다** — 이 몽키패치의 뜻이 「호출부 수십 군데를
       *     안 고치고 한 곳에서 되돌린다」이기 때문이다.
       *       소스 사각형이 **논리 크기 안에 들어가면** 논리 좌표로 보고 `n` 을 곱하고,
       *       **그보다 크면** 이미 실제 좌표이므로 그대로 둔다.
       *   ★ 경계값(`sw === 논리w`)은 **논리**로 읽는다 — 「전체를 논리로 준 것」이라
       *     `n` 을 곱해야 시트 전체가 된다. */
      var lh = im.논리h || Math.round(im.height / n);
      var 논리소스 = (a[1] + a[3] <= lw) && (a[2] + a[4] <= lh);
      if (!논리소스) return _di.apply(this, arguments);
      return _di.call(this, im, a[1] * n, a[2] * n, a[3] * n, a[4] * n, a[5], a[6], a[7], a[8]);
    }
    return _di.apply(this, arguments);
  };
  CanvasRenderingContext2D.prototype.__g2scaler = true;
}

if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.G2Scaler = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
