/* ============================================================================
 * 창세기전 2 — 링 커맨드
 *
 * 원본 COMBATII.EXE 를 그대로 옮겼습니다. 근거 문서는
 *   03_분석/COMBATII/링커맨드_원본동작.md      — 전수 해독
 *   03_분석/COMBATII/링각도_규명.md            — 안식 각도 · 버림 · 타이머 주파수
 *   03_분석/COMBATII/필살기번호_버그.md        — 아이콘/슬롯 번호 체계
 *
 * 좌표계
 *   링은 원본과 같은 **320×200 논리 화면**에서 계산합니다. 화면에 얹을 때만 배율을
 *   곱합니다. 그래야 R=36 · 세로눌림 0.83 · 히트박스 ±12 가 전부 원본 픽셀로 맞습니다.
 *
 * 원본과 일부러 다르게 한 곳 (두 군데뿐입니다)
 *   (가) 화면 가장자리 처리
 *        원본 0x4AA42 는 아이콘마다 x 16~280 · y 4~172 로 **개별 클램프**를 겁니다.
 *        그래서 맵 끝에서는 링이 한쪽으로 찌그러집니다. 원본이 맵 배경에 테두리를
 *        넣어 둔 것도 카메라가 끝까지 가도 캐릭터가 화면 가장자리에 안 붙게 하려던
 *        것으로 보입니다(맵 데이터도 좌우 2칸·상하 4칸엔 유닛을 못 둡니다 — 0x11F8C).
 *        여기서는 클램프를 **쓰지 않고**, 링이 안 들어가면
 *          ① onCamera(dx,dy) 로 카메라를 그만큼 밀고
 *          ② 그래도 모자라면 링 **전체**를 평행이동
 *        합니다. 원형이 절대 안 찌그러집니다.  → Calc.safeCenter
 *
 *   (나) 필살기 번호 체계
 *        원본 0x4D39B 은 아이콘 번호를 슬롯로 바꾸지 않고 [+0x82] 에 그대로 넣어
 *        +1 어긋납니다. 여기서는 **아이콘 번호와 슬롯 번호를 다른 타입으로** 다룹니다.
 *          아이콘 : SPECIAL.ICO 항목 번호 0~25 (0 = 초필살기)
 *          슬롯   : 실행계 전역 슬롯 0~24 (0x753C4 TP표 · 0xF1474 실행표의 첨자)
 *        [+0x82](unit.ai.special) 의 정의는 **전역 슬롯 0~24, 0xFF = 자동**으로 확정.
 *        표시도 같은 기준에서 파생시킵니다. → SpecialPick · aiSpecial*
 * ==========================================================================*/
(function (root) {
'use strict';

function isCommandRestricted(u) { var Ru = root.Rules; if (!Ru && typeof require === 'function') { try { Ru = require('./rules.js').Rules; } catch (e) {} } if (!Ru || !Ru.isCommandRestricted) throw new Error('Rules.isCommandRestricted가 필요하다'); return Ru.isCommandRestricted(u); }

/* ═══════════════════════════════════════════════ 1. 원본 상수 */

var DEG     = Math.PI / 180;
var TWO_PI  = 6.28318530717959;   // [0x77E40] — 원본 상수 그대로
var SQUASH  = 0.83;               // [0x77E48]  세로 눌림
var R_REST  = 36;                 // 0x24  안식 반지름
var R_FAR   = 276;                // 0x114 화면 밖
var DSTEP   = 10 * DEG;           // [0xFD5F0] = 0x3FC657184AE74489 = 0.174533

var HIT_HALF  = 12;               // 0x4AC8A  아이콘 중심 ±12
var SELF_HALF = 0x18;             // 0x4BA7F  중심 ±0x18 = 자기 자신(−2)

/* 0x101F4 게임 틱 175.47Hz (링각도_규명.md §4) */
var TICK_HZ  = 175.47;
/* ☠ 틱 수 × 틱 길이(1000/175.47)로 둔다 — 2/175.47×1000 은 틱 두 번 더한 값보다 1e-14 커서 모으기 9 장이 18 틱이 아니라 19 틱에 끝났다 (2026-09-27 설화) */
var MS_ANIM  = 2  * (1000 / TICK_HZ);   // 11.40 ms — 링 애니 한 프레임 ([0x70004]=2)
var MS_ICON  = 30 * (1000 / TICK_HZ);   // 170.97 ms — 아이콘 4프레임 한 칸

/* 그리기 생략 판정 (0x4AA42). 클램프는 (가) 때문에 안 씁니다. */
var CLIP = { xMax: 303, yMax: 195 };
var ORIG_CLAMP = { x0: 16, x1: 280, y0: 4, y1: 172 };   // 참고용 — 쓰지 않습니다

var VIEW = { w: 320, h: 200 };

/* 아이콘 한 개당 프레임 수. `.ICO` 안에 항목 순서대로 4장씩 이어져 있고,
 * 마우스가 얹히면 0→3 으로 넘긴다 (0x4AC8A, 0x4AB72 의 `f > 3` 되감기). */
var FRAMES_PER_ICON = 4;

/* 애니메이션 4종 — 0x4B767 · 0x4B842 · 0x4B9D7 · 0x4B8EB */
var ANIM = {
  open:   { at: '0x4B767', theta0: 300 * DEG, R0: R_FAR,  dR: -16, frames: 15 },
  close:  { at: '0x4B842', theta0:  90 * DEG, R0: R_REST, dR:  16, frames: 15 },
  gather: { at: '0x4B9D7', theta0:  90 * DEG, R0: R_REST, dR:  -4, frames:  9 },
  spread: { at: '0x4B8EB', theta0: 360 * DEG, R0: 0,      dR:   4, frames:  9 }
};

/* ═══════════════════════════════════════════════ 2. 순수 계산 (Node 검증용) */

/** 0x61E96 — RC=truncate 로 맞춘 뒤 fistp. 반올림이 아니라 0 방향 버림입니다. */
function trunc(v) { return v < 0 ? Math.ceil(v) : Math.floor(v); }

/**
 * 0x4AEE5 를 N 번 돈 결과 (호출부 0x4B0FB).
 *   x = trunc(R·cos θ)
 *   y = −trunc(R·sin θ × 0.83)        ← 화면 y 는 아래가 +
 *   θ += 2π/N,  θ > 2π 면 −2π
 * @returns {{dx:number, dy:number, theta:number}[]} 중심 기준 오프셋
 */
function points(n, R, theta0) {
  var out = [], th = theta0, d = TWO_PI / n, i;      // dθ 는 0x4AE50
  for (i = 0; i < n; i++) {
    out.push({ dx: trunc(R * Math.cos(th)),
               dy: -trunc(R * Math.sin(th) * SQUASH),
               theta: th });
    th += d;
    if (th > TWO_PI) th -= TWO_PI;                   // 0x4AF3F
  }
  return out;
}

/**
 * 0x4AEB4 를 k 번 돌린 상태. k=0 은 첫 프레임을 그리기 **전**입니다.
 * 원본 루프는 `0x4AEB4(밀기) → 0x4B0FB(그리기)` 순서라 화면에 처음 나오는 것은 k=1 입니다.
 */
function animAt(kind, k) {
  var a = ANIM[kind];
  return { R: a.R0 + a.dR * k, theta0: a.theta0 + DSTEP * k, k: k, frames: a.frames };
}

/** 안식 상태 = 열기 15프레임 뒤. θ₀ = 300° + 150° = 450° ≡ 90°(12시), R = 36. */
function rest() { return animAt('open', ANIM.open.frames); }

/** 안식 배치 — 항목 0 이 12시, 반시계. */
function restPoints(n) { var s = rest(); return points(n, s.R, s.theta0); }

/**
 * 0x4AC8A — 히트 테스트. 아이콘 중심 ±12 의 24×24 정사각형입니다.
 * 원본은 `x−12 < mx < x+12` 이므로 **경계는 안 맞습니다**(열린 구간).
 * @returns {number} 배치 인덱스 · −2 = 자기 자신(중심 ±0x18) · −1 = 없음
 */
function hitTest(pts, cx, cy, mx, my) {
  for (var i = 0; i < pts.length; i++) {
    if (pts[i].off) continue;                        // 화면 밖이라 안 그린 것
    var x = cx + pts[i].dx, y = cy + pts[i].dy;
    if (mx > x - HIT_HALF && mx < x + HIT_HALF &&
        my > y - HIT_HALF && my < y + HIT_HALF) return i;
  }
  if (mx > cx - SELF_HALF && mx < cx + SELF_HALF &&
      my > cy - SELF_HALF && my < cy + SELF_HALF) return -2;   // 0x4BA7F
  return -1;
}

/** 0x4AA42 — 화면 밖이면 그 아이콘만 생략. (x,y) 는 앵커까지 더한 그리기 좌표. */
function visible(x, y, w, h) {
  return !(x + w < 0 || x > CLIP.xMax || y + h < 0 || y > CLIP.yMax);
}

/**
 * (가) 링이 온전히 보이는 중심 좌표.
 *
 * 링의 최대 반경은 x = R, y = R×0.83 이고 아이콘은 그 위에 중심 ±12 를 더 먹습니다.
 * 원본처럼 아이콘을 개별 클램프하면 원이 찌그러지므로, **중심을 통째로** 옮깁니다.
 *
 * @param {number} cx,cy  바라는 중심 (논리 320×200)
 * @param {object} view   {w,h} 논리 화면 크기. 기본 320×200
 * @param {number} R      반지름. 기본 36
 * @returns {{x,y,dx,dy}} 옮긴 중심과 그 이동량. dx/dy 만큼 카메라를 반대로 밀면 됩니다.
 */
function safeCenter(cx, cy, view, R) {
  view = view || VIEW;
  R = (R == null ? R_REST : R);
  var mx = R + HIT_HALF;                    // 좌우 여백
  var my = Math.round(R * SQUASH) + HIT_HALF + 1;
  var lo = mx, hi = view.w - mx;
  var x = (lo > hi) ? Math.round(view.w / 2) : Math.max(lo, Math.min(hi, cx));
  lo = my; hi = view.h - my;
  var y = (lo > hi) ? Math.round(view.h / 2) : Math.max(lo, Math.min(hi, cy));
  return { x: x, y: y, dx: x - cx, dy: y - cy };
}

var Calc = {
  DEG: DEG, TWO_PI: TWO_PI, SQUASH: SQUASH, R_REST: R_REST, R_FAR: R_FAR,
  DSTEP: DSTEP, HIT_HALF: HIT_HALF, SELF_HALF: SELF_HALF,
  MS_ANIM: MS_ANIM, MS_ICON: MS_ICON, TICK_HZ: TICK_HZ,
  ANIM: ANIM, VIEW: VIEW, CLIP: CLIP, ORIG_CLAMP: ORIG_CLAMP,
  trunc: trunc, points: points, animAt: animAt, rest: rest, restPoints: restPoints,
  hitTest: hitTest, visible: visible, safeCenter: safeCenter
};

/* ═══════════════════════════════════════════════ 3. 번호 체계 (나) */

/**
 * 무기 종류(0x174CF = 직업표 0x72793) → 필살기 무기군.
 * 근거: 본 링 점프표 0x4BD0E · 필살기 목록 점프표 0x4C026 · AI 선택 0x3F9AD.
 *   icon      MAINRING.ICO 에서 이 무기군을 나타내는 아이콘 번호
 *   mastery   필살기 숙련 칸 [+0x38 + n] (= unit.skillExp[n])
 *   base/len  전역 슬롯 범위 (0x753C4 TP표 · 0xF1474 실행표의 첨자)
 */
var WEAPON_GROUP = {
  0: { icon: 5, mastery: 4, base: 19, len: 6, name: '권/특수' },
  1: { icon: 1, mastery: 0, base:  0, len: 7, name: '검' },
  2: null,                                                  // 0x4C160 직행 — 필살기 없음
  3: { icon: 2, mastery: 1, base:  7, len: 4, name: '창' },
  4: { icon: 3, mastery: 2, base: 11, len: 4, name: '도끼(문서에 따라 활)' },
  5: { icon: 4, mastery: 3, base: 15, len: 4, name: '활(문서에 따라 광역)' }
};

/** 아이콘 번호(SPECIAL.ICO) → 고른 것. 변환은 **여기 한 곳에서만** 합니다. */
function specialPick(icon) {
  if (icon < 0) return { kind: 'cancel', slot: -1, icon: icon };
  if (icon === 0) return { kind: 'ultimate', slot: -1, icon: 0 };   // 0x4C0EE
  return { kind: 'slot', slot: icon - 1, icon: icon };              // 0x4CA23 dec esi
}
/** 슬롯 → 아이콘. 표시(정보창 그림)는 반드시 이걸 통과시킵니다. */
function specialIcon(slot) { return slot + 1; }

var AI_SPECIAL_AUTO = 0xFF;
/* [리마스터] AI 지정 «초필살기» — 원작 [+0x82] 에는 없는 값(슬롯은 0~24). ai.js 필살시도 가 초필살조준 으로 쓴다
 *   (사장님 11-07 「ai에서 필살기 초를 선택할 수 없어. 원작에서는 1번이 초로 되어있어서 초를 선택하면 1단계 필살기가 나가고, 마지막 단계 필살기를 쓰면 다음 단계로 넘어가는 문제가 있어서 이걸 개선했는데, 실제 초필살기가 있는경우 ai에 지정이 가능하고 이걸 실제로 ai 상태에서 사용할 수 있으면 좋겠어.」) */
var AI_SPECIAL_ULT = 0xFE;

/**
 * AI 필살기 지정 필드 [+0x82] 에 넣을 값.
 * **전역 슬롯 0~24, 0xFF = 자동**. 초필살기는 AI 실행 경로가 없어(0x3F9AD·0xF1474에
 * 분기 없음) 자동으로 떨어뜨립니다 — 원본 패치안 6-A 와 같은 결론입니다.
 */
function aiSpecialFromPick(pick) {
  if (!pick || pick.kind === 'cancel') return null;          // 저장하지 않음
  if (pick.kind === 'ultimate') return AI_SPECIAL_ULT;   /* [리마스터] 예전엔 자동(0xFF)으로 떨어뜨렸다 — 이제 AI 가 초필살기를 실제로 쓴다 (ai.js 초필살조준) */
  return pick.slot & 0xFF;
}
/** 정보창 필살기 그림 (0x4B731 자리) — 슬롯에서 파생시킵니다. */
function aiSpecialIconOf(v) {
  if (v === AI_SPECIAL_ULT) return 0;   /* [리마스터] 초필살기 그림(SPECIAL.ICO 0) */
  return (v == null || v === AI_SPECIAL_AUTO) ? -1 : specialIcon(v);
}
/** 정보창 무기군 그림 (0x4B6DB 자리) — 같은 슬롯 기준. */
function aiSpecialGroupOf(v) {
  if (v == null || v === AI_SPECIAL_AUTO) return -1;
  for (var wt in WEAPON_GROUP) {
    var g = WEAPON_GROUP[wt];
    if (g && v >= g.base && v < g.base + g.len) return g.icon;
  }
  return -1;
}

/* ═══════════════════════════════════════════════ 4. 메뉴 구성 */

/* MAINRING.ICO 14항목 — 0x4BC2C 가 넣는 번호가 곧 항목 번호입니다. */
var MAIN = {
  ATTACK: 0, SP_SWORD: 1, SP_SPEAR: 2, SP_AXE: 3, SP_BOW: 4, SP_FIST: 5,
  MAGIC: 6, SKILL: 7, ITEM: 8, DEFEND: 9, FOCUS: 10, STATUS: 11, GUARD: 12, AI: 13
};
var MAIN_NAME = ['공격', '검 필살기', '창 필살기', '도끼 필살기', '활 필살기', '권 필살기',
                 '마법', '스킬', '아이템', '방어', '정신집중', '스테이터스', '호위', 'AI'];

function tpOf(u)    { return u.tp | 0; }                       // 0x1A0E9
/** 최대 TP `[+0x54]` — **정본은 `state.js maxTpOf`** (4단계 ③).
 *   ★ **부르는 순간** 찾는다 — 로드 순서에 안 기댄다 (2-7 원칙). 없으면 던진다. */
function maxTpOf(u) {
  var S = root.G2State || (typeof require === 'function' ? (function () {
    try { return require('./state.js').G2State || require('./state.js'); } catch (e) { return null; }
  })() : null);
  if (!S || typeof S.maxTpOf !== 'function') {
    throw new Error('ring.maxTpOf: G2State.maxTpOf 가 없다 — state.js 를 먼저 실어야 한다');
  }
  return S.maxTpOf(u);
}
function jobRow(battle, u) { return battle && battle.jobOf ? battle.jobOf(u) : null; }
function passive(battle, u, col) {                             // 0x73B57 + 직업×9
  var j = jobRow(battle, u); var a = j && j['패시브특성'];
  return a ? (a[col] | 0) : 0;
}
function active(battle, u, col) {                              // 0x731AC + 직업×15
  var j = jobRow(battle, u); var a = j && j['액티브스킬'];
  return a ? (a[col] | 0) : 0;
}
function weaponTypeOf(battle, u) {
  if (u.eff && u.eff.weaponType != null) return u.eff.weaponType | 0;
  var j = jobRow(battle, u);
  return j ? (j['무기종류'] | 0) : 0;
}

/**
 * ★ 0x28429 — 「이 유닛이 이 마법 계열을 몇 클래스까지 쓰는가」.
 *
 * ```asm
 * 0x2842F  cl = 유닛[+0x11]              ; 직업
 * 0x28434  ecx = 직업 × 7                ; shl 3 − 1
 * 0x2843E  al = (byte[0x72310 + 직업×7 + 계열] != 0) ? 1 : 0   ; 직업 클래스 상승
 * 0x28450  dl = byte[유닛 + 0x2E + 계열]                        ; 문장(마법 레벨)
 * 0x28454  ax = al + dl ; if ax > 3 : ax = 3
 * 0x28461  return ax − 1
 * ```
 *
 * 곧 **문장이 하나라도 있으면(레벨 ≥ 1) 직업에 클래스 상승이 없어도 0 이상**이 되어
 * 쓸 수 있고, **직업표에 그 계열이 있으면 한 클래스 위**가 나옵니다.
 * 플레이어가 말한 규칙이 원본 그대로임을 여기서 확인했습니다.
 *
 * @returns {number} −1 = 못 씀 · 0/1/2 = 쓸 수 있는 클래스(= 마법 단계)
 */
/* ★ [리마스터] **속성 로드 = 그 속성 마법 클래스 +1** (2026-11-13 · 사장님 「속성 로드의 경우 장착시 해당 마법의 클래스를 1단계 올려주면 좋겠어.」 · 정본 147)
 *   원작 ITEM.DAT 의 화이어 로드 74·아이스 로드 75·썬더 로드 76·다크 로드 77 은 능력치 보정 외에 숨은 효과가 없다(MP 50 뿐 · 00_능력치와_아이템_처리.md §2-B).
 *   토글 «속성로드클래스»(기본 켬): 그 로드를 든 유닛이 **이미 쓸 수 있는**(0 이상) 같은 계열 마법 클래스를 하나 올린다 — 상한은 원작과 같은 3(0x28456).
 *   계열 = 화이어 0 화염 · 아이스 1 빙한 · 썬더 2 전격 · 다크 6 암흑. 마법 선택창·AI·HUD·시전이 전부 이 함수를 지나므로 번호(계열×21+레벨×3+클래스)·위력·MP 가 따라온다 */
var 속성로드계열 = { 74: 0, 75: 1, 76: 2, 77: 6 };
function 속성로드보너스(u, series) {
  var O = root.Opt && root.Opt.cfg;
  if (!O || O['속성로드클래스'] === '원작') return 0;
  var w = (u.gear && u.gear.weapon) || (u.equip && u.equip.weapon) || 0;
  return (속성로드계열[w | 0] === series) ? 1 : 0;
}
function magicClassOf(battle, u, series) {
  var lv = ((u.magicLv && u.magicLv[series]) | 0);
  var T = battle && battle.T;
  var cap = T && T['마법최대클래스'];
  var row = cap && cap[u.job | 0];
  var bonus = (row && (row[series] | 0) !== 0) ? 1 : 0;         // 0x2843E setne
  var v = bonus + lv;
  if (v >= 1) v += 속성로드보너스(u, series);                   // [리마스터] 속성 로드 — 못 쓰는 계열(0)은 안 올린다
  if (v > 3) v = 3;                                             // 0x28456
  return v - 1;                                                 // 0x28461
}

/** 공격 가능한 적 존재 — 원본 링 `0x4BD9C → 0x1D124`.
 *
 * 공격 아이콘은 단순 4방향 인접 검사가 아니라 **통상 공격과 같은 0x1D124 범위**를
 * 사용한다. 따라서 창 2칸, 도끼 범위, 활 부채꼴, 브레스/대형 공격도 실제 공격
 * 가능 범위와 링 표시가 같아야 한다. `ring.js`가 `combat.js`보다 먼저 로드되므로
 * 모듈 참조는 호출 시점에 구한다. 독립 harness처럼 G2Combat이 없는 경우에만
 * 과거 4방향 검사를 호환 fallback으로 남긴다. */
function adjacentEnemy(battle, u) {
  if (!battle || !battle.at) return false;

  var Cb = root.G2Combat;
  if (!Cb && typeof require === 'function') {
    try { Cb = require('./combat.js').G2Combat; } catch (e) {}
  }
  if (Cb && typeof Cb.attackCells === 'function') {
    var cells = Cb.attackCells(battle, u) || [];
    /* ★ 무기 0x11(포병) 공격 아이콘
     *   원작: 0x4BD80 call 0x1D124 — 포병 갈래 0x1D4B4 는 폭 3(0x1D4C2 ecx=3) · 0x1A452 가 한쪽으로만 센다
     *     ⇒ «고르는 직선 열 + 한쪽 옆 두 열»에 적이 있으면 아이콘이 뜬다 — 옆 두 번째 열 적은 아이콘만 뜨고 한 줄 십자로는 못 맞힌다(원작 허점)
     *     (2026-11-08 x86미니에뮬로 원본 0x1A452 를 돌려 확인: 북쪽 · 폭 3 → 옆 걸음 x−1 · 줄바꿈 x+2,y−1 · 줄 칸 3 · 줄 수 7)
     *   리마스터 대포십자조준 켬: 아이콘도 «고를 수 있는 한 줄»(rangeOf 'attack' = 0x1CC09 화면 범위) 위 적 + 그 칸 십자(아래) — 아이콘이 뜨면 반드시 맞힐 수 있다
     *   (사장님 11-08 「한줄인데 왼쪽 두칸에 적이 있어도 공격이 뜬다고? … 아이콘은 뜨는데 아무도 못때린다는 소리야!」·「또 근거없이 그냥 이말대로 한다고?」) */
    var _O포 = root.Opt || root.G2Opt;
    if (Cb.weaponTypeOf && (Cb.weaponTypeOf(battle, u) | 0) === 0x11 && typeof Cb.rangeOf === 'function' &&
        _O포 && _O포.cfg && _O포.cfg['대포십자조준'] === '리마스터') cells = Cb.rangeOf(battle, u, 'attack') || cells;
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var t = battle.at(c.x | 0, c.y | 0);
      if (!t || !t.alive || t === u) continue;
      if (typeof Cb.비행막음 === 'function' && Cb.비행막음(battle, u, t)) continue;   /* 0x1A25F 비행 대상은 비행 공격자만 (2026-09-25) */
      var hostile = (typeof Cb.hostile === 'function')
        ? Cb.hostile(u.side, t.side, battle.confuse)
        : (root.G2State && root.G2State.hostile
          ? root.G2State.hostile(u.side, t.side, battle.confuse) : u.side !== t.side);
      if (hostile) return true;
    }
    /* [리마스터 대포십자조준] 무기 0x11·0x12 — 범위 칸 위에 적이 없어도 «어느 범위 칸의 십자»에 적이 들면 공격 아이콘을 켠다 (2026-10-10)
     *   원본 0x4BD80 은 0x1D124 의 «범위 칸 위 적 수»만 본다 — 그래서 원작 플레이어는 십자로만 닿는 적을 못 쐈다(AI 0x409AD 는 쏜다)
     *   (사장님 「타겟 지정영역에(직선 영역) 적이 없더라도 효과 범위에 적이 들어올 수 있으면 맞춰야 하는거 아닌가?」 · 「2번으로 토글 넣어줘」) */
    var _O대 = root.Opt || root.G2Opt, _wt대 = Cb.weaponTypeOf ? (Cb.weaponTypeOf(battle, u) | 0) : -1;
    if ((_wt대 === 0x11 || _wt대 === 0x12) && _O대 && _O대.cfg && _O대.cfg['대포십자조준'] === '리마스터' && Cb.diamond) {
      /* 십자를 펼칠 칸 = 플레이어가 실제로 고를 수 있는 칸(화면 범위 0x1CC09 = rangeOf 'attack') — 무기 0x11 은 한 줄이라
       *   «칠 적 판정»(0x1D124 폭 3) 칸으로 펴면 아이콘은 켜지는데 고를 칸 십자엔 적이 없을 수 있다 (2026-11-08 포병 화면 범위 한 줄로 바꾼 뒤 맞춤) */
      var 고를칸 = (typeof Cb.rangeOf === 'function') ? (Cb.rangeOf(battle, u, 'attack') || cells) : cells;
      for (var k = 0; k < 고를칸.length; k++) {
        var 십 = Cb.diamond(battle, 고를칸[k].x | 0, 고를칸[k].y | 0, 1, true);
        for (var m = 0; m < 십.length; m++) {
          var t2 = battle.at(십[m].x | 0, 십[m].y | 0);
          if (t2 && t2.alive && t2 !== u && Cb.hostile && Cb.hostile(u.side, t2.side, battle.confuse)) return true;
        }
      }
    }
    return false;
  }

  /* 호환 fallback — 통합 제품에서는 위 0x1D124 공용 경로가 사용된다. */
  var d = [[0, -1], [-1, 0], [1, 0], [0, 1]];
  for (var j = 0; j < 4; j++) {
    var ft = battle.at(u.x + d[j][0], u.y + d[j][1]);
    if (ft && ft.alive && root.G2State &&
        root.G2State.hostile(u.side, ft.side, battle.confuse)) return true;
  }
  return false;
}

/**
 * 0x4BD26 — 본 링 항목 구성. 반환은 **배치 순서대로의 아이콘 번호 배열**입니다.
 * @param {object} env {phase, hasTarget}
 */
function buildMain(battle, u, env) {
  env = env || {};
  var out = [];
  var phase = env.phase | 0;                      // [0xBA84E]
  if (env.special === 1) return [MAIN.AI, MAIN.STATUS];      // [0xFDAF2]==1 → 0x4BD4D

  var tp = tpOf(u), wt = weaponTypeOf(battle, u);
  var hp = u.hp | 0, maxHp = u.maxHp | 0;

  /* 0 공격 — 현재 정면 0x1D124 범위의 적 · TP ≥ 40 */
  var hasTarget = (env.hasTarget != null) ? !!env.hasTarget : adjacentEnemy(battle, u);
  if (hasTarget && tp >= 0x28) out.push(MAIN.ATTACK);

  /* 1~5 무기 필살기 — 하나만. TP≥70 · 탈것0 · 스프라이트<300 · HP>500 · 페이즈<4 */
  if (tp >= 0x46 && !(u.gear && u.gear.mount) && !isCommandRestricted(u) &&
      hp > 0x1F4 && phase < 4 && wt <= 5) {
    var g = WEAPON_GROUP[wt];
    if (g) {
      /* [리마스터 B-01] 테이머(0x33)도 권 — 원본 0x4BE68 은 47·48 만 (2026-10-10 사장님 「테이머 권계열 사용하고 획득 가능하게 하라고 했었는데 지금 안되네」) */
      /* ★ 테이머는 권 필살기를 하나라도 익혔을 때만 — 투사·무술가(원본 0x4BE68)는 처음부터 권 필살기를 가진 직업이라 숙련을 안 보지만,
       *   테이머를 같은 줄에 덧붙여 하나도 안 익혀도 아이콘이 떴다(누르면 빈 하위 메뉴 · buildSpecial 은 익힌 수만큼만) (2026-11-14 사장님 「테이머 권계열 필살기가 없는 상태에서도 필살기 아이콘이표시되는 문제가 있어」 · 정본 206) */
      var 익힘 = (u.skillExp && u.skillExp[g.mastery] | 0) > 0;
      var ok = (wt === 0) ? (u.job === 0x2F || u.job === 0x30 || (u.job === 0x33 && 익힘))   // 0x4BE68 · [리마스터 B-01] 테이머
                          : 익힘;
      if (ok) out.push(g.icon);
    }
  }

  /* 6 마법 — MP>0 · TP≥50 · 사일런스([+0x1E]&8) 아님 · 페이즈<4 · 익힌 계열 있음 */
  if ((u.mp | 0) > 0 && tp >= 0x32 && !((u.ailment | 0) & 8) && phase < 4) {
    /* ★ 0x4BE7C — 계열 0~6 을 돌며 `0x28429 >= 0` 인 것이 하나라도 있으면 올립니다.
     *   문장만 있어도(직업 상승 없이) 되고, 반대로 문장이 없어도 **직업표에 그 계열이
     *   있으면** 클래스 0 이 되어 쓸 수 있습니다. 예전 코드는 `magicLv > 0` 만 봐서
     *   뒤쪽 경우를 통째로 놓쳤습니다 — 마법 아이콘 자체가 안 뜨던 원인입니다. */
    var has = false;
    for (var s = 0; s < 7; s++) if (magicClassOf(battle, u, s) >= 0) { has = true; break; }
    if (has) out.push(MAIN.MAGIC);                                       // 0x28429
  }

  /* 7 스킬 — TP≥60 · [+0x12]==0(소환수 아님) · 페이즈<4 · HP > 최대/10 · 탈것 조건 */
  if (tp >= 0x3C && !(u.summonerTag | 0) && phase < 4 && Math.floor(maxHp / 10) < hp) {
    var mnt = (u.gear && u.gear.mount) | 0;
    if (!isCommandRestricted(u) || (mnt > 0 && mnt <= 4) || (mnt >= 0x0F && mnt <= 0x16))
      out.push(MAIN.SKILL);
  }

  /* 9 방어 — TP≥40 · 페이즈<4 */
  if (tp >= 0x28 && phase < 4) out.push(MAIN.DEFEND);

  /* 12 호위 — TP≥60 · 페이즈<4 · 무기<5 · 패시브[2](자동반격)==0 */
  if (tp >= 0x3C && phase < 4 && wt < 5 && passive(battle, u, 2) === 0) out.push(MAIN.GUARD);

  /* 10 정신집중 — TP == 최대TP · 스프라이트<300 · 페이즈<4 */
  if (tp === maxTpOf(u) && !isCommandRestricted(u) && phase < 4) out.push(MAIN.FOCUS);

  /* 11 스테이터스 — 무조건 */
  out.push(MAIN.STATUS);

  /* 8 아이템 — TP > 20 */
  if (tp > 0x14) out.push(MAIN.ITEM);

  /* 13 AI — 무조건 · 맨 마지막 */
  out.push(MAIN.AI);
  return out;
}

/**
 * 0x4C03E — 필살기 하위 메뉴.
 * 아이콘 0 = 초필살기(조건 충족 시), 그 뒤로 무기군 기준슬롯+1 부터 습득 수만큼.
 */
function buildSpecial(battle, u) {
  var wt = weaponTypeOf(battle, u), g = WEAPON_GROUP[wt];
  var out = [];
  if (!g) return out;                                          // 무기 2 = 필살기 없음
  var R = root.Rules;
  var ult = R && R.ultimateAvailable
    ? R.ultimateAvailable(u.charCode, u.gear && u.gear.weapon, u.gear && u.gear.charm)  // 0x4C070 쌍 비교 · [리마스터] 장신구 짝(순옥살)
    : false;
  if (ult) out.push(0);
  var learned = (u.skillExp && u.skillExp[g.mastery] | 0);
  var n = Math.min(learned, g.len);
  for (var i = 0; i < n; i++) out.push(g.base + i + 1);         // 0x4C167 아이콘 = 슬롯 + 1
  return out;
}

/**
 * 0x4BFCA — 마법 하위 메뉴. 3단을 같은 함수로 돕니다 (0x4C749 의 [esp+0x14] 가 단계).
 * depth > 0 이면 앞에 아이콘 0, 그 뒤 depth×7+1 … +7.
 * 아이콘 0 은 "뒤로"가 아니라 표 첨자 7 에 해당하는 **여덟 번째 칸**입니다
 * (0x4C8F2 `아이콘 0 → 7`, 표 0x74FA8 의 그 자리에 실제 마법이 있습니다).
 */
function buildMagic(depth) {
  var out = [], i;
  if (depth > 0) out.push(0);
  for (i = 1; i <= 7; i++) out.push(depth * 7 + i);
  return out;
}

/**
 * ★ [리마스터 I-08] **그 유닛이 지금 쓸 수 있는 마법 목록** — 이름으로 고르는 「이지」 모드.
 *
 * 원작은 룬워드 **3단 조합**(`buildMagic` → `magicPicks` → `magicNumber`)이다.
 * 이지 모드는 **조작만** 바꾼다 — 고를 수 있는 집합·MP·TP·판정은 클래식과 **같다**.
 * 그래서 여기서도 원본과 같은 창구를 쓴다:
 *   · 계열별 클래스 `magicClassOf`(`0x28429`) — 그 유닛이 그 계열에서 쓰는 **랭크**
 *   · 사용 가능 판정 `magicGate`(`0x4C605` 의 1~3단계) — Wrong Spell / No TP / No MP
 *
 * 마법 번호 규약은 원본 그대로 `계열×21 + 단계×3 + 랭크` 다(`magicnames.js` 머리말).
 *
 * @returns {Array<{spell,series,level,rank,name,mp,gate}>}  `gate` 가 null 이면 지금 쓸 수 있다.
 */
function spellList(battle, u, T) {
  T = T || (battle && battle.T);
  var N = root.G2MagicNames;
  var out = [];
  for (var s = 0; s < 7; s++) {
    var rank = magicClassOf(battle, u, s);
    if (rank < 0) continue;                       // 그 계열을 아예 못 쓴다
    for (var row = 0; row < 7; row++) {
      var n = s * 21 + row * 3 + rank;
      out.push({
        spell: n, series: s, level: row, rank: rank,
        name: (N && N.NAMES[n]) || ('#' + n),
        mp: (N && N.MP_TIER[row]) | 0,
        gate: magicGate(battle, u, n, T)          // null 이면 사용 가능
      });
    }
  }
  return out;
}

/**
 * 0x4C926 — 세 번의 선택을 표 0x74FA8 로 **실제로 쓸 마법 번호**로 바꿉니다.
 *
 * ```asm
 * 0x4C943  cx = word[0x74FA8 + 계열×128 + 레벨칸×16 + 랭크칸×2]
 * 0x4C94B  dec ecx                       ; n = 표값 − 1  (표값 0 → −1)
 * 0x4C95B  idiv 3 ; if 나머지 != 0 → return −1        ; ★ 랭크 0 자리만 유효
 * 0x4C974  idiv 0x15 → 계열 ; eax = 0x28429(유닛, 계열)
 * 0x4C980  return eax + n                ; ★ 마법 번호 = 기준번호 + 유닛의 마법 클래스
 * ```
 *
 * 곧 **플레이어는 랭크 0 자리만 고르고, 실제 단계는 유닛의 클래스가 정합니다.**
 * 클래스가 −1(못 씀)이면 n−1 이 나오고, 그 값은 `0x4C605` 의 1단계에서
 * `0x28429 != 번호%3` 에 걸려 **"Wrong Spell!"** 이 뜹니다 — 취소가 아니라 메시지입니다.
 *
 * @param {object} battle,unit 없으면 클래스 보정을 못 하므로 기준번호 그대로 냅니다
 */
function magicNumber(assets, p0, p1, p2, battle, unit) {
  var t = assets && assets['마법선택표'];
  if (!t) return -1;
  var i1 = (p1 === 0) ? 7 : p1 - 8;              // 0x4C8F2
  var i2 = (p2 === 0) ? 7 : p2 - 15;             // 0x4C90E
  if (p0 < 1 || p0 > 7 || i1 < 0 || i1 > 7 || i2 < 0 || i2 > 7) return -1;
  var v = t[p0] && t[p0][i1] && t[p0][i1][i2];
  var n = (v | 0) - 1;                           // 0x4C94B dec ecx (0 = 없음 → −1)
  if (n < 0 || (n % 3) !== 0) return -1;         // 0x4C95D  나머지 != 0 → −1
  if (!unit) return n;
  return n + magicClassOf(battle, unit, Math.floor(n / 21));   // 0x4C980
}

/**
 * 0x4C605 의 1~3 단계 — **비용을 쓰기 전** 판정. 반환은 실패 사유 문자열 또는 null.
 * 원본 메시지 그대로: 0x77ED3 · 0x77EE0 · 0x77EE7.
 */
/* ★ 세 문구는 **원본 그대로**다 — `le_fixup` 으로 직접 읽어 확인했다
 *   (2026-09-09 · 오류 msgID 는 `주소맵/ring.md:798`):
 *     0x77ED3  "Wrong Spell!"   ← 0x4C67B
 *     0x77EE0  "No TP!"         ← 0x4C6AA
 *     0x77EE7  "No MP!"         ← 0x4C6C6
 *   ☠ 우리말로 바꾸는 것은 **일부러 원본과 다르게 하는 것**이라
 *     사장님 승인이 필요하고 `리마스터_적용현황.md` 에 적어야 한다(§6). */
var MAGIC_MSG = { spell: 'Wrong Spell!', tp: 'No TP!', mp: 'No MP!' };   /* 0x77ED3 · 0x77EE0 · 0x77EE7 */

function magicGate(battle, u, idx, T) {
  T = T || (battle && battle.T);
  idx = idx | 0;
  var rank = idx % 3, series = Math.floor(idx / 21);
  /* 0x4C66C — 유닛의 클래스가 단계와 정확히 같아야 합니다. idx == −1 도 여기서 걸립니다 */
  if (idx < 0 || magicClassOf(battle, u, series) !== rank) return MAGIC_MSG.spell;
  var Ru = root.Rules;
  var lv = Math.floor(idx / 3) % 7;                              // 0x4C62C 의 edi
  var needTp = Ru && Ru.spellTp ? Ru.spellTp(lv, T, weaponTypeOf(battle, u)) : 0;  // 0x28480
  var needMp = Ru && Ru.spellMp ? Ru.spellMp(lv, T) : 0;         // [0x753B6 + 속성×2]
  if (((u.chargeTp | 0) + (u.tp | 0)) < needTp) return MAGIC_MSG.tp;   // 0x4C6A0
  if ((u.mp | 0) < needMp) return MAGIC_MSG.mp;                        // 0x4C6B7
  return null;
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **필살기·초필살기도 「대상 고르기 전에」 TP 를 본다** — `0x4C9BD` (2026-09-10)
 *
 *  > 사장님: 「필살기 커맨드에서 초필살기 선택시 tp체크 관련해서 문제가 있어.
 *  >  **tp가 부족하면 no tp 문구가 잠시 뜨고 초필살기는 발동이 안되고 tp소모 없이
 *  >  메인 링커맨드로 복귀**해야하는데, 지금은 **턴이 종료**되어버리는 문제가 있어.」
 *
 *  ☠ 두 가지가 겹쳐 있었다 —
 *    ① **게이트가 마법에만 있었다.** 필살기는 대상을 다 고른 «뒤» `combat.special()`
 *      안에서야 TP 를 봐서, 실패해도 이미 흐름이 진행된 뒤였다.
 *    ② `combat.special()` 이 모자랄 때 **차징**으로 빠져 `u.tp = 0` 을 만들고
 *      `{ok:true, kind:'charge'}` 를 냈다. 그래서 «턴을 썼다».
 *      ★ 차징 `0x4007B` 는 **`0x3FFD4`(AI 필살기) 안쪽**이다 — 플레이어 경로가 아니다.
 *        (`AI대역_분석.md:778`)
 *
 *  ★ 원본은 대상 선택보다 «먼저» 본다 —
 *  ```asm
 *  0x4C99B  call 0x4BC3C              ; 캐릭터 → 초필살기 번호
 *  0x4C9A6  call 0x1A0E9              ; 현재 TP
 *  0x4C9B2  add  eax, edx             ; + 집중 게이지 [+0x57]
 *  0x4C9B4  mov  edx, [esi + 0x75426] ; 필요 TP (일반은 0x753C2)
 *  0x4C9BD  cmp  eax, edx
 *  0x4C9BF  jge  실행                  ; 모자라면 "No TP!" 후 return — **비용 0**
 *  ```
 *  그리고 `0x4D442` 는 시전 후 **언제나 −2** 를 돌려주므로 `0x4D582` 재계산 뒤
 *  **링이 다시 열린다**(`상태전이_원본확정.md` §2-C). 턴은 끝나지 않는다.
 * ══════════════════════════════════════════════════════════════════════ */
function specialGate(battle, u, cmd, T) {
  T = T || (battle && battle.T);
  if (!u || !cmd) return null;
  var Ru = root.Rules, Cb = root.G2Combat, need = 0;
  if (cmd.ultimate) {
    var n = (Cb && Cb.ultimateIndexOf) ? Cb.ultimateIndexOf(battle, u) : -1;
    if (n < 0) return MAGIC_MSG.spell;                       /* 0x4BC3C 가 못 고른다 */
    need = (Ru && Ru.ultimateTp) ? Ru.ultimateTp(n, T) : 0;  /* 0x75426 */
  } else {
    var s = cmd.slot | 0;
    if (s < 0 || s > 24) return MAGIC_MSG.spell;
    need = (Ru && Ru.specialTp) ? Ru.specialTp(s, T) : 0;    /* 0x753C2 */
  }
  /* 0x4C9B2 — 집중 게이지 [+0x57] 를 «더해서» 본다 */
  if (((u.chargeTp | 0) + (u.tp | 0)) < need) return MAGIC_MSG.tp;   /* 0x4C9BD */
  return null;
}

/**
 * 스펠의 **대상 관계** — 원소(계열)별. 마법마다 대상이 다르므로 이동/타게팅 relation 을 정한다.
 *   0 화염 · 1 빙한 · 2 전격 : 데미지 → 적('hostile')
 *   3 회복 : 회복 → 아군/자신('friendly')  (단 언데드 대상 Turn Undead 는 예외 — 효과에서 처리)
 *   4 보조 : 강화(파워업·스피드업·매직아머·배리어) → 아군/자신('friendly').
 *            사일런스·커스 등 약화는 적 대상이지만, 우선 계열 기준으로 두고 예외는 효과단에서 재판정.
 *   5 소환 : 빈 칸에 소환('empty')
 *   6 암흑 : 데미지·즉사·약화 → 적('hostile')
 */
function magicRelation(idx) {
  var series = Math.floor((idx | 0) / 21);
  var row = Math.floor((idx | 0) / 3) % 7;
  if (series === 3) return (row === 3) ? 'hostile' : 'friendly';   // 회복: Turn Undead(row3)만 적
  if (series === 4) return (row === 4 || row === 6) ? 'hostile' : 'friendly';  // 보조: Silence(4)·Curse(6)만 적, 나머지 버프는 아군
  if (series === 5) return 'empty';                                 // 소환 → 빈 칸
  return 'hostile';                                                 // 화염·빙한·전격·암흑
}
/** 회복 계열(효과가 HP 회복)인지 — cast 에 heal 의도 전달용. */
function magicIsHeal(idx) {
  var series = Math.floor((idx | 0) / 21), row = Math.floor((idx | 0) / 3) % 7;
  return series === 3 && row !== 3;    // 회복 계열, Turn Undead 제외
}

/**
 * 0x4C1A2 — 스킬 하위 메뉴. 직업표 액티브스킬 15칸이 그대로 아이콘으로 바뀝니다.
 * 열 → SKILL.ICO 아이콘 :  0→5 · 1→1 · 2→3 · 3→6 · 4→4 · 5→2 · 6→7 · 7→8 ·
 *                          8→9 · 9→0xA · 10→0xB · 11→0xC · 12→0xD · 13→0xE · 14→0xF
 */
var SKILL_ICON = [5, 1, 3, 6, 4, 2, 7, 8, 9, 0xA, 0xB, 0xC, 0xD, 0xE, 0xF];

/* 메뉴 그림 번호와 0x731AC 실행 열 번호는 서로 다릅니다. */
var SKILL_NO_BY_ICON = {};
SKILL_ICON.forEach(function (icon, no) { SKILL_NO_BY_ICON[icon] = no; });
/* 직업표 15칸 밖의 원본 고정 명령: 돌진 · 마장기 소환 · 사기업. */
SKILL_NO_BY_ICON[0] = 15;
SKILL_NO_BY_ICON[0x10] = 16;
SKILL_NO_BY_ICON[0x11] = 17;
/* ★ [리마스터] 화룡소환 (Z-91 · 2026-09-26 사장님 「스킬 링커맨드의 아이콘은 빙룡소환과 동일한데 팔레트만 붉은 색 계통으로 …
 *   해당 커맨드는 데스로드와 드래곤슬레이어에 우선 넣어줘」) — 원본 SKILL.ICO 에 없는 번호 0x12 를 두고
 *   그림은 빙룡(0xE)을 붉게 다시 굽는다(setNativeIcons) · 직업 2 Death lord · 5 Dragon slayer */
var FIRE_DRAGON_ICON = 0x12, FIRE_DRAGON_JOBS = { 2: true, 5: true };
SKILL_NO_BY_ICON[FIRE_DRAGON_ICON] = 18;
/** 빙룡 아이콘 팔레트를 붉게 — 푸른 계통(파랑 > 빨강)만 빨강·파랑을 맞바꾼다(금빛 테두리·회색은 그대로) */
function 붉은팔레트(pal) {
  var out = new Uint8Array(pal.length);
  out.set(pal);
  for (var i = 0; i + 2 < pal.length; i += 3) if (pal[i + 2] > pal[i]) { out[i] = pal[i + 2]; out[i + 2] = pal[i]; }
  return out;
}

function skillNoFromIcon(icon) {
  icon = icon | 0;
  return SKILL_NO_BY_ICON.hasOwnProperty(icon) ? SKILL_NO_BY_ICON[icon] : -1;
}

function buildSkill(battle, u, env) {
  env = env || {};
  var out = [], mnt = (u.gear && u.gear.mount) | 0;
  if (mnt > 0 && mnt <= 4) return [5];                      // 0x4C1C1 탈것 1~4 → 승마 해제만
  /* [리마스터] 3급 마장기(베샤르 7·8 · 페리튼 9·10 · 로퍼 11·12 · Aero 13·14)도 승마 스킬로 내린다 — 원작은 말만
   *   (2026-10-03 사장님 「3급마장기는 승마 스킬로 내리거나 탈 수 있게 해줘.」 · 실행부 combat.js 스킬 0 은 탈것 종류를 안 가린다) */
  if (mnt >= 7 && mnt <= 0x0E) return [5];
  if (mnt >= 0x0F && mnt <= 0x16) return [0x10];            // 0x4C1D8

  if (Math.floor((u.maxHp | 0) / 10) < (u.hp | 0)) out.push(0);   // 0x4C1F6
  if (active(battle, u, 0) === 1) out.push(5);                    // 승마
  /* 0x4C226 — 전투 종류 0(필드)이고 고유 캐릭터·무기 조합이면 1급 마장기 소환.
   * 장비 코드는 1 기준(rules.js `T['아이템'][code-1]`) — 원본 알시온 값 0x1D 는 표 0x1C
   * **멸살지옥검**이다(버그 아님). [리마스터] 사장님 지시(2026-09-24 「멸살지옥검이 아니라
   * 듀랜달로」)로 **듀렌달 0x21** 을 쓴다. 카심 0x73 → 카오스소드 0x18 은 리마스터 추가(Z-28). */
  var mechaWeapon = { 0x02: 0x20, 0x16: 0x3B, 0x1D: 0x21, 0x73: 0x18, 143: 0x20 }[u.charCode | 0];   /* 143 아이스 → 바리사다 [리마스터 2026-10-03] */
  /* 0x4C23B/0x4C251/0x4C268 — 그 캐릭터의 1회 깃발이 0일 때만 (combat.js case 16 주석) */
  var mechaUsed = !!(battle && battle.마장기소환깃발 && battle.마장기소환깃발[u.charCode | 0]);
  /* ☠ 원본은 «0 일 때만»이다 — 0x4C226 cmp [0xBA84E],0 / jne 0x4C281 (0 필드 · 1 마장기불가 · 2 날리기불가 …). 예전 «< 2» 는 마장기불가(1)에서도 소환을 냈다 (2026-09-26) */
  /* [리마스터] 2급 마장기 — combat.js 마장기소환찾기(아이템 조건 자리 포함) · 1급이 없는 캐릭터만 */
  var C2 = (typeof root !== 'undefined' && root && root.G2Combat) || null;
  var 이급 = mechaWeapon == null && C2 && C2.마장기소환찾기 && C2.마장기소환찾기(battle, u);
  if ((env.phase | 0) === 0 && !mechaUsed &&
      ((mechaWeapon != null && ((u.gear || {}).weapon | 0) === mechaWeapon) || 이급))
    out.push(0x10);
  if (active(battle, u, 1) === 1 && (env.phase | 0) < 2) out.push(1);   // 비행
  if (active(battle, u, 2) === 1) out.push(3);                    // 중독
  if (active(battle, u, 3) === 1) out.push(6);                    // 탐색
  if (active(battle, u, 4) === 1) out.push(4);                    // 조련
  if (active(battle, u, 5) === 1 && env.onWater) out.push(2);     // 소용돌이 — 물 위에서만
  if (active(battle, u, 6) === 1) out.push(7);                    // 버서커
  if (active(battle, u, 7) === 1) out.push(8);                    // 기도
  if (active(battle, u, 8) !== 0) out.push(9);                    // 워프
  /* ★★★★★ **[+0x84] = 「이번 전투에 이미 썼다」 비트 — 2026-08-29 확정.**
   *
   *   `+0x84` 는 8비트 오프셋 범위를 넘어 **disp32** 로 인코딩된다
   *   (`84 00 00 00`). 그 꼴로 전수하니 **14곳**이고, 그중 쓰는 자리는 셋이다:
   *   ```asm
   *   0x11440  mov  [edx+0x84], 0      ; ★ 유닛을 세울 때 **0 으로 지운다**
   *   0x4CC5C  or   [eax+0x84], 0x2    ; ★ **분신**을 쓰면 비트 2
   *   0x4CC9F  or   [eax+0x84], 0x4    ; ★ **빙룡소환**을 쓰면 비트 4
   *   ```
   *   ⇒ 아래 `usedOnce & 2`(분신) · `& 4`(빙룡소환)와 **정확히 같다.**
   *     `.SCE` 에 없는 것도 당연하다 — **전투 중에 세우는 값**이다.
   *   ☐ 나머지 11곳(`0x0F` 7 · `0xF6` 2 · `0x80` 2 중 남은 것)은 읽기·시험이다.
   *     다른 비트(1 · 8 …)를 세우는 자리는 **없다** — 두 기술뿐이다. */
  if (active(battle, u, 9) === 1 && !((u.usedOnce | 0) & 2)) out.push(0xA);   // 분신
  if (active(battle, u, 10) === 1) out.push(0xB);                 // 일갈
  if (active(battle, u, 11) === 1) out.push(0xC);                 // 희생
  if (active(battle, u, 12) === 1) out.push(0xD);                 // 저주
  /* [리마스터] 라시드(0x02)는 킹(직업 4)이 되어도 빙룡소환을 쓴다 — 다른 킹(크로우·아이스 등)은 원작대로 못 쓴다 (2026-11-13)
   *   사장님 11-12 「라시드의 경우 킹이 되어도 빙룡소환 할 수 있어야해. 크로우나 아이스같은 다른 킹은 사용할 수 없어야하고. 이부분은 리마스터 사양으로 넣어야해.」
   *   원작 0x731AC 직업×15 액티브 스킬 표에서 킹(4)은 13(빙룡소환)이 0 — 캐릭터 코드로만 연다 · 설정 '빙룡소환유지' 가 '원작' 이면 안 연다 */
  var 라시드킹빙룡 = (u.charCode | 0) === 0x02 && (u.job | 0) === 4 &&
    !((typeof root !== 'undefined' && root.Opt && root.Opt.cfg) && root.Opt.cfg['빙룡소환유지'] === '원작');
  if ((active(battle, u, 13) === 1 || 라시드킹빙룡) && !((u.usedOnce | 0) & 4)) out.push(0xE); // 빙룡소환
  if (FIRE_DRAGON_JOBS[u.job | 0] && !((u.usedOnce | 0) & 8)) out.push(FIRE_DRAGON_ICON);   // [리마스터] 화룡소환
  if (active(battle, u, 14) === 1) out.push(0xF);                 // 배리어
  if (((u.base && u.base.cha) | 0) > 0x32) out.push(0x11);        // 0x4C4E0 권위 > 50
  return out;
}

/** 0x4C4FB — AI 하위 메뉴. AI_CTRL.ICO 14항목. */
function buildAi(battle, u) {
  var out = [];
  var ai = u.ai || {};
  out.push((ai.mode | 0) === 3 ? 1 : 0);                          // [+0x6C]
  var wt = weaponTypeOf(battle, u);
  if (wt !== 2) {
    /* [리마스터] 정본 446 — 아군의 공격 성향이 4(«공격 안 함» · 시나리오가 실은 값 — 합류 NPC 등)면 링에는 «가까운 적»(아이콘 3)으로 보이는데
     *   실제로는 공격을 안 해 AI 를 켜도 아무것도 안 했다 (사장님 11-24 「라이어(스카우트) ai시 아무것도 안하고」 · 측정 창 7-3 아군 G.스케빈져 계획 «[+0x6D] == 4 (공격 안 함 · 이동만)»)
     *   ⇒ 플레이어가 링을 여는 아군은 보이는 대로 «가까운 적»(0)으로 맞춘다 · 원본 0x4C4F9 도 4 를 아이콘 3 으로 보인다 */
    if ((ai.atkTend | 0) === 4 && (u.side | 0) === 1) ai.atkTend = 0;
    var a = ai.atkTend | 0;
    out.push(a === 1 ? 4 : a === 2 ? 5 : 3);                      // [+0x6D]
  }
  var f = ai.fleeTend | 0;
  out.push(f === 1 ? 7 : f === 4 ? 8 : 6);                        // [+0x6E]
  var 마법지정 = !(ai.magic == null || ai.magic === 0xFF);
  /* [리마스터] 정본 446 — MP 가 0 이어도 마법이 지정돼 있으면 아이콘을 남긴다 — 사라지면 지정을 «자동»으로 되돌릴 길이 없었다
   *   (사장님 11-24 「mp를 모두 사용하면 아무행동도 안해. 마법 취소도 안되고」) · 원본 0x4C4F9 는 MP > 0 일 때만 올린다 */
  if ((u.mp | 0) > 0 || 마법지정) out.push(마법지정 ? 10 : 9);  // [+0x80]
  if (wt < 6 && wt !== 2) {
    var sp = ai.special;
    out.push((sp == null || sp === AI_SPECIAL_AUTO) ? 0x0B : 0x0C);   // [+0x82]
  }
  if ((ai.flag | 0) !== 2) out.push(0x0D);                        // [+0x83]
  return out;
}

/* ── AI 하위 메뉴는 **두 겹**입니다 — 0x4D06E ─────────────────────────────
 *
 * `0x4C4F9`(= buildAi) 가 만드는 본 AI 링은 **지금 값**을 나타내는 아이콘만 올립니다.
 * 거기서 하나를 고르면 `0x4D163`~`0x4D208` 이 **그 아이콘이 속한 무리 전체**를 다시
 * 링에 올리고(`0x4AD69(edx = 고른 아이콘)` 로 그 항목을 중심에 둡니다), 두 번째 선택이
 * 점프표 `0x4D03A` 로 실제 동작이 됩니다.
 *
 * ```
 * 첫 선택 0‥2 → 무리 [0,1,2]      3‥5 → [3,4,5]     6‥8 → [6,7,8]
 *         9‥10 → [9,10]          11‥12 → [11,12]
 *         13   → ★ AI 확정 (0x4D217 : [+0x83]=0, [+0x56]==0xFF 면 0x196D0) → 반환 1
 *         < 0  → 취소 (0x4D3A6 : 0x19718) → 반환 −1
 * ```
 * 예전 구현은 본 링에서 곧장 값을 토글해서 **좌표 설정(2)·필살기 지정(12)·
 * AI 확정(13)** 이 통째로 닿지 않았습니다.
 * -------------------------------------------------------------------------- */
var AI_GROUP = [[0, 1, 2], [0, 1, 2], [0, 1, 2],
                [3, 4, 5], [3, 4, 5], [3, 4, 5],
                [6, 7, 8], [6, 7, 8], [6, 7, 8],
                [9, 0xA], [9, 0xA],
                [0xB, 0xC], [0xB, 0xC]];

/** 첫 선택 → 두 번째 링의 아이콘 목록. 13(사람) 이나 범위 밖이면 null. */
function buildAiGroup(icon) {
  var g = AI_GROUP[icon | 0];
  return g ? g.slice() : null;
}

/**
 * 두 번째 선택을 유닛에 적용합니다 — 점프표 `0x4D03A`.
 * @returns {{kind:string, done?:boolean}}
 *   'set'          값을 바꿨습니다 → AI 링을 다시 그립니다
 *   'coord'        좌표 설정 UI 로 (0x4CE1F)
 *   'magicPick'    마법 선택 하위 메뉴로 (0x4C72A) — 결과/3 을 `ai.magic` 에
 *   'specialPick'  필살기 선택 하위 메뉴로 (0x4CAA3) — 결과를 `ai.special` 에
 *   'none'         아무 일도 없음
 */
function aiApply(battle, u, icon) {
  u.ai = u.ai || {};
  var ai = u.ai, wt = weaponTypeOf(battle, u);
  switch (icon | 0) {
    case 0: case 1:                                   // 0x4D2C0
      if ((ai.mode | 0) === 5) return { kind: 'none' };
      ai.mode = (icon | 0) * 3;                       // 아이콘 0 → 0 · 아이콘 1 → 3
      return { kind: 'set' };
    case 2:                                           // 0x4D2DA → 0x4CE1F
      return { kind: 'coord' };
    case 3: case 4: case 5:                           // 0x4D2E6
      if (wt === 5 && (icon | 0) > 4) ai.mode = 5;
      if (wt >= 6) return { kind: 'none' };
      ai.atkTend = (icon | 0) - 3;
      return { kind: 'set' };
    case 6: ai.fleeTend = 0; return { kind: 'set' };  // 0x4D310
    case 7: ai.fleeTend = 1; return { kind: 'set' };  // 0x4D319
    case 8: ai.fleeTend = 4; return { kind: 'set' };  // 0x4D322
    case 9: ai.magic = AI_SPECIAL_AUTO; return { kind: 'set' };   // 0x4D32B
    case 0xA: return { kind: 'magicPick' };                        // 0x4D337
    case 0xB: ai.special = AI_SPECIAL_AUTO; return { kind: 'set' };// 0x4D36F
    case 0xC: return { kind: 'specialPick' };                      // 0x4D37B
    default: return { kind: 'none' };
  }
}

/* AI 설정 화면 위쪽 전용 UI 의 내용 — 원본은 링 회차마다 `0x44DC5(1, ebx=2)` 로
 * 정보 표시를 **모드 2** 로 바꿔 놓습니다(word[0xFA8BA]). 어떤 그림을 쓰는지는
 * 아직 못 밝혔으므로 값만 글자로 내놓고 그리기는 hud.js 가 합니다.
 * ★★★★★ **2026-08-29 — 모드 2 의 그리기 경로를 찾았다.**
 *   ☠ 먼저 주소 — 적용본에서 그 전역은 **`0xFA8BA`** 다(코드 즉값 `0x8A8BA` 는
 *     fixup 전 값이라 `0x8A8BA` 로 찾으면 **0곳**이 나온다).
 *   참조는 **두 곳**뿐이다:
 *   ```asm
 *   0x44DC7  66 a3 …    mov [0xFA8BA], ax        ; 쓰기 (링 회차마다)
 *   0x45520  66 83 3d … cmp [0xFA8BA], 0 · je    ; ★ **읽는 유일한 자리**
 *   0x45527  call 0x13546                         ;   0 이 아니면 이 함수를 부른다
 *   ```
 *   `0x13546` 이 하는 일 (머리 부분):
 *   ```asm
 *   0x1354F  ax = [0x4A83C] · si = [0x4A83E]      ; 카메라 좌표
 *   0x13562  eax = [0x4A842] sar 16 · imul        ; × 맵 폭
 *   0x13579  ebp = 0x5C998 + (칸)×4               ; ★ **유닛 배열**
 *   0x13585  eax = esi + 0x0B(11)                 ; ★ 세로 **+11**
 *   0x13591  eax = [esp+4] + 0x0D(13)             ; ★ 가로 **+13**
 *   ```
 *   ⇒ **화면에 보이는 11×13 타일을 훑어** 유닛마다 무언가를 그린다.
 *     (한 화면 ≈ 13×12 타일이라는 기존 확정과 맞물린다.)
 *   ☐ **무엇을 그리는지**(그림·색·글자)는 아직 — 루프 안을 더 봐야 한다.
 *     그때까지 값만 글자로 내놓고 그리기는 `hud.js` 가 한다. **값을 지어내지 않는다.** */
var AI_MODE_NAME  = { 0: '자유 행동', 3: '제자리 대기', 5: '지정 좌표' };
var AI_ATK_NAME   = ['가까운 적', '약한 적', '강한 적'];
var AI_FLEE_NAME  = { 0: '후퇴 안 함', 1: '위험하면 후퇴', 4: '적극 후퇴' };

/** 0x44DC5(ebx = 2) 전용 UI 에 띄울 내용. */
function aiSummary(battle, u) {
  var ai = (u && u.ai) || {};
  var sp = ai.special, mg = ai.magic;
  return {
    unit: u ? u.name : '',
    mode: AI_MODE_NAME[ai.mode | 0] || ('모드 ' + (ai.mode | 0)),
    attack: AI_ATK_NAME[ai.atkTend | 0] || ('성향 ' + (ai.atkTend | 0)),
    flee: AI_FLEE_NAME[ai.fleeTend | 0] || ('도주 ' + (ai.fleeTend | 0)),
    magic: (mg == null || mg === AI_SPECIAL_AUTO) ? '자동' : ('마법 #' + (mg | 0)),
    special: (sp == null || sp === AI_SPECIAL_AUTO) ? '자동' : (sp === AI_SPECIAL_ULT) ? '초필살기' : ('필살기 #' + (sp | 0)),
    coord: (ai.target && ai.target.x != null)
             ? ('(' + ai.target.x + ', ' + ai.target.y + ')') : '없음',
    icons: { special: aiSpecialIconOf(sp), group: aiSpecialGroupOf(sp) }
  };
}

/* ═══════════════════════════════════════════════ 5. 선택 결과 — 0x4D40A */

/** 아이콘 번호 → 무슨 명령인가. 1~5 가 전부 같은 칸(0x4D490)을 가리킵니다. */
function mainCommand(icon) {
  switch (icon) {
    case MAIN.ATTACK: return { kind: 'attack', tp: 0x28 };            // 0x4D45C
    case MAIN.SP_SWORD: case MAIN.SP_SPEAR: case MAIN.SP_AXE:
    case MAIN.SP_BOW:   case MAIN.SP_FIST:  return { kind: 'special' };   // 0x4D490
    case MAIN.MAGIC:  return { kind: 'magic' };                       // 0x4D4B1
    case MAIN.SKILL:  return { kind: 'skill' };                       // 0x4D4CF
    case MAIN.ITEM:   return { kind: 'item' };                        // 0x4D4EB
    case MAIN.DEFEND: return { kind: 'defend', tp: 0x28, ret: 1 };    // 0x4D504
    case MAIN.FOCUS:  return { kind: 'focus', tpGain: 20, cap: 500 }; // 0x4D517
    case MAIN.STATUS: return { kind: 'status', ret: 0 };              // 0x4D53B
    case MAIN.GUARD:  return { kind: 'guard', tp: 0x3C, ret: 2 };     // 0x4D546
    case MAIN.AI:     return { kind: 'ai' };                          // 0x4D559
    default:          return { kind: 'none' };
  }
}

/* ═══════════════════════════════════════════════ 6. 링 인스턴스 */

function Ring() {
  this.assets = null;
  this.images = {};
  this.native = {};             // 메뉴별 원본 `.ICO` 직독 프레임 수 (할일 19)
  this.nativeOnly = false;      // true 면 추출 PNG 를 아예 안 읽습니다
  this.opened = false;
  this.phase = 'closed';        // closed·opening·idle·gather·spread·closing
  this.menu = 'mainring';
  this.icons = [];              // 배치 순서의 아이콘 번호
  this.pts = [];                // 배치 순서의 {dx,dy,off}
  this.frames = [];             // 아이콘별 현재 프레임 0~3 (배치 인덱스 기준)
  this.hover = -1;              // 0x4AC8A 가 기억하는 [메뉴+5]
  this.center = { x: 160, y: 100 };
  this.wanted = { x: 160, y: 100 };
  this.R = R_FAR; this.theta0 = ANIM.open.theta0;
  this.animKind = null; this.animK = 0;
  this.accAnim = 0; this.accIcon = 0;
  this.stack = [];              // 하위 메뉴 되돌아가기용
  this.opts = {};
  this.battle = null; this.unit = null;
  this.pending = null;          // 애니메이션이 끝나면 할 일
  this.magicPicks = [];         // 마법 3단 선택
  this.sound = null;
  this.view = { w: VIEW.w, h: VIEW.h };
}

/* ── 자산 ─────────────────────────────────────────────────────────────── */

Ring.prototype.setAssets = function (json, base) {
  this.assets = json;
  this.base = base || '자산/';
  return this;
};

/** 브라우저 전용 — ring.json 과 아이콘 PNG 를 읽어 옵니다. */
Ring.prototype.load = function (base, cb) {
  var self = this;
  base = base || '자산/';
  this.base = base;
  var url = base + 'ring.json';
  function done(j) {
    self.assets = j;
    /* 먼저 도착해 쟁여 둔 원본 아이콘부터 넣습니다 (할일 19) */
    var q = self._nativePend; self._nativePend = null;
    if (q) q.forEach(function (n) { self.setNativeIcons(n.menu, n.frames, n.palette); });
    self._미리읽기();
    self._소리초기화();
    if (cb) cb(null, j);
  }
  /* 자산/ring_assets.js 를 <script src> 로 먼저 읽었으면 그걸 씁니다 (file:// 대비) */
  if (root.G2RING_ASSETS) { done(root.G2RING_ASSETS); return this; }
  if (typeof fetch === 'function' && location.protocol !== 'file:') {
    fetch(url).then(function (r) { return r.json(); }).then(done)
      .catch(function (e) { if (cb) cb(e); });
  } else {
    /* file:// 에서는 fetch 가 막히므로 XHR → 그것도 막히면 전역 G2Ring.ASSETS 사용 */
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.onload = function () { try { done(JSON.parse(x.responseText)); } catch (e) { if (cb) cb(e); } };
      x.onerror = function () { if (cb) cb(new Error('ring.json 을 못 읽었습니다')); };
      x.send();
    } catch (e) { if (cb) cb(e); }
  }
  return this;
};

/** PNG 호환 모드에서만 링 자산 URL을 미리 읽고 원본 직독 모드에서는 건너뛴다. */
Ring.prototype._미리읽기 = function () {
  /* ★ `nativeOnly` 면 추출 PNG 를 아예 건드리지 않습니다 — 그림은 원본 `.ICO` 직독. */
  if (this.nativeOnly) return;
  if (typeof Image === 'undefined' || !this.assets) return;
  var m = this.assets['메뉴'], self = this;
  Object.keys(m).forEach(function (k) {
    if (self.native[k]) return;
    m[k]['항목'].forEach(function (fr, it) {
      fr.forEach(function (f, i) {
        if (!f || !f.png) return;
        var im = new Image();
        im.src = self.base + f.png;
        self.images[k + '/' + it + '/' + i] = im;
      });
    });
  });
};

/**
 * 원본 `.ICO` 직독 아이콘 — 할일 19 (그림은 추출본을 쓰지 않는다).
 *
 * 한 메뉴의 아이콘은 `<메뉴파일>` 한 개에 **항목 × 4프레임** 순서로 들어 있다.
 * `frameMeta` 가 쓰던 `w·h·ax·ay` 도 원본 프레임 헤더 그대로다 — 추출본 JSON 의
 * 값과 5개 파일 전 프레임(376개)이 **완전히 일치**함을 확인했으므로, 메타는
 * 그대로 두고 **픽셀만** 바뀐다.
 *
 * ★ 왜 바꿔야 하는가: 추출기 `04_도구/g2_export_ring.py` 는 `m = a != 0` 으로
 *   **색 0 을 투명**으로 굽는다. 원본 RLE 는 「기록 안 된 픽셀만 투명」이라
 *   검정으로 칠한 부분이 통째로 뚫린다(`native.js decodeRLE`). 실측 색 0 픽셀:
 *
 *     AI_CTRL.ICO  1533개 · 56/56 프레임      ← 할일 8 「주황 아이콘 깨짐」
 *     SKILL.ICO    1583개 · 72/72 프레임
 *     SPECIAL.ICO  2385개 · 104/104 프레임
 *     MAINRING.ICO  710개 · 32/56 프레임
 *     MAGIC.ICO       0개                     ← 유일하게 멀쩡했다
 *
 * @param {string} menu 'mainring'|'magic'|'ai_ctrl'|'skill'|'special'
 * @param {Array} frames `G2Native.decodeNC2(...).frames` (항목수 × 4)
 * @param {Uint8Array} palette GENESIS.PAL 768바이트
 * @returns {number} 실제로 갈아 끼운 프레임 수
 */
Ring.prototype.setNativeIcons = function (menu, frames, palette) {
  var N = root.G2Native;
  if (!N || !N.frameToCanvas || !frames || !frames.length) return 0;
  var m = this.assets && this.assets['메뉴'] && this.assets['메뉴'][menu];
  /* ring.json 이 아직 안 왔으면 쟁여 뒀다가 `load()` 가 끝날 때 넣습니다.
   * (아이콘 fetch 와 ring.json fetch 는 순서가 정해져 있지 않습니다) */
  if (!m) {
    (this._nativePend || (this._nativePend = []))
      .push({ menu: menu, frames: frames, palette: palette });
    return 0;
  }
  /* ★ 2026-09-24 (Z-44 계측에서 드러남) — 아이콘은 **구울 때의 필터**로 굳었다.
   *   전투를 불러온 뒤 필터를 바꾸면 링 아이콘만 옛 배율(1배)로 남았다(실측 — 링 아이콘 9종 1배).
   *   ⇒ 원본 프레임을 기억해 두고 필터가 바뀌면 같은 함수로 다시 굽는다. */
  (this._아이콘원본 || (this._아이콘원본 = {}))[menu] = { frames: frames, palette: palette };
  var S = root.G2Scaler, self = this;
  if (!this._필터듣는중 && S && typeof S.onChange === 'function') {
    this._필터듣는중 = true;
    S.onChange(function () {
      var 원 = self._아이콘원본 || {};
      Object.keys(원).forEach(function (k) { self.setNativeIcons(k, 원[k].frames, 원[k].palette); });
    });
  }
  var n = m['항목수'] | 0, cnt = 0;
  if (!n) n = Math.floor(frames.length / FRAMES_PER_ICON);
  for (var it = 0; it < n; it++) {
    var row = m['항목'][it] || (m['항목'][it] = []);
    for (var f = 0; f < FRAMES_PER_ICON; f++) {
      var fr = frames[it * FRAMES_PER_ICON + f];
      if (!fr) continue;
      var cv = N.frameToCanvas(fr, palette);
      this.images[menu + '/' + it + '/' + f] = cv;
      /* 메타는 원본 프레임 헤더 그대로 — png 경로는 지웁니다(더는 안 씁니다) */
      row[f] = { w: fr.w, h: fr.h, ax: fr.ax, ay: fr.ay, canvas: cv };
      cnt++;
    }
  }
  /* [리마스터] 화룡소환 아이콘 0x12 — 빙룡(0xE) 프레임을 붉은 팔레트로 한 벌 더 굽는다 */
  if (menu === 'skill' && palette) {
    var 붉 = 붉은팔레트(palette), rowF = m['항목'][FIRE_DRAGON_ICON] || (m['항목'][FIRE_DRAGON_ICON] = []);
    for (var ff = 0; ff < FRAMES_PER_ICON; ff++) {
      var frF = frames[0xE * FRAMES_PER_ICON + ff];
      if (!frF) continue;
      var cvF = N.frameToCanvas(frF, 붉);
      this.images[menu + '/' + FIRE_DRAGON_ICON + '/' + ff] = cvF;
      rowF[ff] = { w: frF.w, h: frF.h, ax: frF.ax, ay: frF.ay, canvas: cvF };
    }
  }
  this.native[menu] = cnt;
  if (this._아이콘밀림) delete this._아이콘밀림[menu];   /* 정본 400 — 미뤄 둔 같은 메뉴는 방금 다 구웠다 */
  return cnt;
};

/* ★ 정본 400 — 전투 도중 날씨가 바뀔 때(__G2자산_날씨적용) 링 아이콘 다시 굽기를 미룬다
 *   ☠ 다섯 파일 아이콘 수백 장을 그 자리에서 다 구워 날씨 전환 첫 장이 멈췄다(측정 크롬 2-4A · PC 123ms 중 링 아이콘이 가장 큼 · CPU×4 617ms)
 *   링이 닫혀 있으면 아이콘은 안 보인다 ⇒ 한가할 때 항목 단위로 나눠 굽고, 그 전에 링을 열거나 그리거나 아이콘을 꺼내면 그 자리에서 남은 것을 다 굽는다
 *   (보이는 아이콘은 늘 새 날씨 색 · 구운 결과는 setNativeIcons 와 같다) · 끄기 window.__링아이콘바로 */
Ring.prototype.아이콘미루기 = function (menu, frames, palette) {
  var N = root.G2Native, m = this.assets && this.assets['메뉴'] && this.assets['메뉴'][menu];
  if (root.__링아이콘바로 || !m || !N || !N.frameToCanvas || !frames || !frames.length) return this.setNativeIcons(menu, frames, palette);
  (this._아이콘원본 || (this._아이콘원본 = {}))[menu] = { frames: frames, palette: palette };
  var n = m['항목수'] | 0;
  if (!n) n = Math.floor(frames.length / FRAMES_PER_ICON);
  (this._아이콘밀림 || (this._아이콘밀림 = {}))[menu] = { m: m, frames: frames, palette: palette, it: 0, n: n, cnt: 0 };
  this._아이콘한가예약();
  return 0;
};
/** 미뤄 둔 아이콘을 굽는다 — 기한(requestIdleCallback)이 있으면 한 항목은 꼭 굽고 남은 시간 안에서만 · 다 끝나면 true */
Ring.prototype._아이콘밀린것굽기 = function (기한) {
  var 밀 = this._아이콘밀림;
  if (!밀) return true;
  var N = root.G2Native, 한개 = false;
  for (var menu in 밀) {
    if (!Object.prototype.hasOwnProperty.call(밀, menu)) continue;
    var q = 밀[menu];
    while (q.it <= q.n) {                                   /* q.n 번째 = 화룡소환 덧그림 */
      if (기한 && 한개 && !(기한.timeRemaining() > 3)) return false;
      한개 = true;
      if (q.it < q.n) {
        var row = q.m['항목'][q.it] || (q.m['항목'][q.it] = []);
        for (var f = 0; f < FRAMES_PER_ICON; f++) {
          var fr = q.frames[q.it * FRAMES_PER_ICON + f];
          if (!fr) continue;
          var cv = N.frameToCanvas(fr, q.palette);
          this.images[menu + '/' + q.it + '/' + f] = cv;
          row[f] = { w: fr.w, h: fr.h, ax: fr.ax, ay: fr.ay, canvas: cv };
          q.cnt++;
        }
      } else if (menu === 'skill' && q.palette) {             /* setNativeIcons 의 화룡소환 갈래와 같다 */
        var 붉 = 붉은팔레트(q.palette), rowF = q.m['항목'][FIRE_DRAGON_ICON] || (q.m['항목'][FIRE_DRAGON_ICON] = []);
        for (var ff = 0; ff < FRAMES_PER_ICON; ff++) {
          var frF = q.frames[0xE * FRAMES_PER_ICON + ff];
          if (!frF) continue;
          var cvF = N.frameToCanvas(frF, 붉);
          this.images[menu + '/' + FIRE_DRAGON_ICON + '/' + ff] = cvF;
          rowF[ff] = { w: frF.w, h: frF.h, ax: frF.ax, ay: frF.ay, canvas: cvF };
        }
      }
      q.it++;
    }
    this.native[menu] = q.cnt;
    delete 밀[menu];
  }
  this._아이콘밀림 = null;
  return true;
};
Ring.prototype._아이콘한가예약 = function () {
  if (this._아이콘한가중) return;
  this._아이콘한가중 = true;
  var self = this, 돌 = function (기한) {
    self._아이콘한가중 = false;
    if (!self._아이콘밀린것굽기(기한)) self._아이콘한가예약();
  };
  if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(돌, { timeout: 1000 });
  else setTimeout(function () { 돌(null); }, 300);
};

/** ★★★★★ **링 소리도 원본에서 직독한다** — `0x4F4CD(0x1F)` → `MAGICSPR/COMMAND.VSP`
 *
 *   > 사장님 (2026-09-10): 「그 외에 **별도 추출본 사용하지 않도록** 확인해줘.」
 *
 *   ☠ 전에는 추출본 `자산/snd/command.wav` 를 받았다. `ring.json` 의 `소리.근거` 에
 *     **원본 파일 이름이 이미 적혀 있었다** — `MAGICSPR/COMMAND.VSP` (헤더 0x40 · 22000Hz).
 *   ⇒ `G2URL`(적용폴더 → 원본)로 받아 `G2Native.decodeSound` 로 푼다.
 *     직독이 안 되는 환경에서만 예전 추출본으로 떨어진다. */
Ring.prototype.SOUND_FILE = 'MAGICSPR/COMMAND.VSP';   /* 0x4F4CD(0x1F) */
Ring.prototype._소리초기화 = function () {
  if (typeof Audio === 'undefined') return;
  var self = this;
  var s = this.assets && this.assets['소리'];
  function 추출본으로(까닭) {
    if (self.sound) return;
    if (까닭) console.warn('링 소리 직독 실패 — 추출본으로 떨어진다:', 까닭);
    try { self.sound = new Audio(self.base + (s ? s['파일'] : 'snd/command.wav')); }
    catch (e) { self.sound = null; }
    self._잠금풀기();
  }
  var N = root.G2Native;
  if (!N || !N.decodeSound || typeof fetch !== 'function') { 추출본으로(null); return; }
  var 주소 = (typeof root.G2URL === 'function') ? root.G2URL(this.SOUND_FILE) : ('/원본/' + this.SOUND_FILE);
  fetch(주소)
    .then(function (r) { if (!r.ok) throw new Error(self.SOUND_FILE + ' ' + r.status); return r.arrayBuffer(); })
    .then(function (b) {
      var d = N.decodeSound(new Uint8Array(b));
      if (!d || !d.wav) throw new Error(self.SOUND_FILE + ' 디코드 실패');
      self.sound = new Audio(URL.createObjectURL(new Blob([d.wav], { type: 'audio/wav' })));
      self._잠금풀기();
    })
    .catch(function (e) { 추출본으로(e && e.message); });
};

/**
 * ★★★★★ **자동재생 잠금을 처음 제스쳐에 푸다** (2026-08-31 · 지적 B-9 · 4차)
 *
 *   브라우저에서 직접 재어 원인을 잡았다 —
 *     `NotAllowedError — play() failed because the user didn't interact with the document first.`
 *   소리 파일도 배선도 다 정상이고(readyState 4 · duration 0.1767 · volume 1),
 *   오직 **자동재생 정책**에 막혔다. 예전에는 `catch (e) {}` 가 이 오류를
 *   삼켜서 **네 번이나** 원인이 안 보였다.
 *
 *   첫 제스처(`pointerdown`·`keydown`·`touchstart`)에서 **무음으로 한 번**
 *   틀어 잠금을 푸다. 그 뒤로는 언제 불려도 난다.
 *   ★ 원본 동작은 하나도 안 바꿈 — `0x4F4CD(0x1F)` 슬롯 31 그대로다.
 *     이것은 **브라우저 환경 대응**이지 리마스터가 아니다.
 */
Ring.prototype._잠금풀기 = function () {
  if (!this.sound || this._잠금풀긴 || typeof document === 'undefined') return;
  var self = this;
  function 풀기() {
    if (self._잠금풀긴) return;
    self._잠금풀긴 = true;
    var a = self.sound;
    var 전 = a.volume;
    try {
      a.volume = 0;
      var p = a.play();
      var 되돌리기 = function () { try { a.pause(); a.currentTime = 0; a.volume = 전; } catch (e1) {} };
      if (p && typeof p.then === 'function') p.then(되돌리기, 되돌리기);
      else 되돌리기();
    } catch (e) { try { a.volume = 전; } catch (e2) {} }
    ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) {
      try { document.removeEventListener(n, 풀기, true); } catch (e3) {}
    });
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach(function (n) {
    try { document.addEventListener(n, 풀기, true); } catch (e) {}
  });
};

/** 0x4F4CD(0x1F) — 4종 동작 모두 같은 소리입니다. */
Ring.prototype.playSound = function () {
  /* ★★★★★ **왜 안 나는지를 드러낸다** (2026-08-30 · 지적 B-9 · 4차)
   *   사용자가 **네 번** 「링커맨드 효과음이 사라졌다」고 했는데
   *   배선은 정적으로 다 정상이다(`00_지금조사.md` 의 표).
   *   ☠ 예전에는 실패를 `catch (e) {}` 로 **통째로 삼켜서**
   *     왜 안 나는지가 영영 안 보였다 — 그것부터 고친다.
   *   ★ 원본은 `0x4F4CD(0x1F)` — 슬롯 31 하나를 4종 동작에 다 쓴다. */
  if (!this.sound) {
    if (!this._소리없음경고) {
      this._소리없음경고 = true;
      try { console.warn('[링] 효과음 객체가 없다 — _소리초기화()가 안 불렸거나 Audio가 안 만들어졌다'); } catch (e0) {}
    }
    return;
  }
  var self = this;
  /* ★ 링 31 도 0x4F4CD → 0x5CB97 채널 2~7 을 일반·초필살 효과음과 함께 쓴다 — 여섯 다 차면 안 난다
   *   (2026-09-29 원본 실측: 화염인 끝 링 31 → 채널 2). 막는 길이는 끝나기 0x400 샘플 앞(0x5C447). */
  var 공용 = root.G2Fx && typeof root.G2Fx.효과음채널잡기 === 'function' ? root.G2Fx : null;
  if (공용) {
    var 길 = this.sound.duration;
    var 막는ms = (isFinite(길) && 길 > 0) ? Math.max(0, 길 * 1000 - 0x400 / 22) : 0;
    if (공용.효과음채널잡기(막는ms) < 0) return;
  }
  try {
    this.sound.currentTime = 0;
    var p = this.sound.play();
    /* 최신 브라우저는 Promise 를 돌려준다 — 거부를 삼키지 않는다 */
    if (p && typeof p.catch === 'function') {
      p.catch(function (e1) {
        if (self._재생거부경고) return;
        self._재생거부경고 = true;
        try { console.warn('[링] 효과음 재생이 거부됐다:', e1 && e1.message); } catch (e2) {}
      });
    }
  } catch (e) {
    if (!this._재생예외경고) {
      this._재생예외경고 = true;
      try { console.warn('[링] 효과음 재생에서 예외:', e && e.message); } catch (e3) {}
    }
  }
};

/** 메뉴·아이콘·애니메이션 번호에 해당하는 링 프레임 메타를 조회한다. */
/* ☠★★★★★ **하위 링은 «같은 `.ICO` 를 돌려 쓴다»** — `0x4B0F5` (2026-09-22 사장님 지적)
 *
 *   > 사장님: 「ai 모드시 … **하위 링커맨드도 작동하지 않고 아무것도 뜨지 않아.**」
 *
 *   `링커맨드_원본동작.md` §「하위 메뉴는 같은 링을 다시 씁니다」 —
 *   원본은 **메뉴 구조체 포인터만 갈아 끼우고**(`0x4CAA8 eax = 0xFDA12` → `0x4B0F5`)
 *   좌표·애니메이션·입력·그림은 전부 공유한다. 그래서 `.ICO` 는 **다섯 벌**뿐이다.
 *
 *   ☠ 우리는 세션이 만드는 메뉴 이름(`ai_group`·`ai_magic`·`ai_special`)으로
 *     그림을 찾는데, 그 이름은 `ICON_FILE` 에 **없다** ⇒ 아이콘이 하나도 안 그려져
 *     **빈 링**이 됐다(실측 — AI 링에서 한 칸 더 들어가면 링이 통째로 사라진다).
 *   ⇒ 원본이 돌려 쓰는 대로 **별명**을 둔다:
 *       `ai_group`   → `ai_ctrl` 그림 (AI 두 링은 같은 `ai_ctrl.ico` · `0xFD8D4`)
 *       `ai_magic`   → `magic`   그림 (`0x4C72A` 마법 하위 메뉴와 같은 자리)
 *       `ai_special` → `special` 그림 (`0x4CAA3` 필살기 하위 메뉴와 같은 자리) */
var 그림별명 = { ai_group: 'ai_ctrl', ai_magic: 'magic', ai_special: 'special' };

/** 메뉴 이름 → **그림을 가진** 메뉴 이름 (없으면 그대로) */
function 그림메뉴(menu) { return 그림별명[menu] || menu; }

/** 정보 바(`0x4AC28`)가 쓰는 **아이콘 한 장** — 메뉴 그림에서 바로 꺼낸다.
 *
 *   AI 바는 링과 **같은 `.ICO`** 를 쓴다 —
 *     `0x4B715 eax = 0xFD9A8`(mainring.ico) · 색인 = 무기군 1~5
 *     `0x4B727 eax = 0xFDA12`(special.ico)  · 색인 = `[+0x82]`
 *   그림이 아직 안 왔으면 `null` 을 낸다 (그리는 쪽이 건너뛴다).
 */
Ring.prototype.아이콘그림 = function (menu, icon, frame) {
  if (icon == null || (icon | 0) < 0) return null;
  if (this._아이콘밀림) this._아이콘밀린것굽기();   /* 정본 400 — 미뤄 둔 날씨 색을 꺼내기 전에 */
  var im = this.images[그림메뉴(menu) + '/' + (icon | 0) + '/' + (frame | 0)];
  if (!im) return null;
  return (im.naturalWidth ? im.complete : im.width > 0) ? im : null;
};
Ring.prototype.frameMeta = function (menu, icon, f) {
  if (this._아이콘밀림) this._아이콘밀린것굽기();   /* 정본 400 — 미뤄 둔 날씨 색을 꺼내기 전에 */
  var m = this.assets && this.assets['메뉴'][그림메뉴(menu)];
  if (!m) return null;
  var it = m['항목'][icon];
  return it ? it[f] : null;
};

/* ── 열기 · 닫기 ──────────────────────────────────────────────────────── */

/**
 * 본 링 열기.
 * @param {object} battle  G2State.Battle
 * @param {object} unit
 * @param {object} opts
 *   center   {x,y}   논리 320×200 화면에서의 링 중심 (보통 그 유닛의 화면 좌표)
 *   view     {w,h}   논리 화면 크기. 기본 320×200
 *   onPick   fn(cmd) 결과
 *   onCamera fn(dx,dy)  (가) 링이 안 들어갈 때 카메라를 이만큼 밀어 달라는 요청
 *   onCursor fn(x,y)    0x5CF3E — 커서를 링 중심으로 순간이동
 *   phase / hasTarget / onWater  판정 보조값
 */
Ring.prototype.open = function (battle, unit, opts) {
  if (this._아이콘밀림) this._아이콘밀린것굽기();   /* 정본 400 — 열리는 링은 늘 새 날씨 색 */
  this.battle = battle; this.unit = unit; this.opts = opts || {};
  this.view = this.opts.view || { w: VIEW.w, h: VIEW.h };

  var c = this.opts.center || { x: this.view.w / 2, y: this.view.h / 2 };
  this.wanted = { x: Math.round(c.x), y: Math.round(c.y) };

  /* (가) — 클램프 대신 중심을 옮기고, 그만큼 카메라를 밀어 달라고 알립니다 */
  /* ★★★ 2026-09-24 (사장님: 「캐릭터가 맵 경계쪽에 있을때 링커맨드 뜰 때 위치 어긋나는 문제」)
   *   원본 0x4AA42 전문을 다시 읽었다 —
   *     0x4AB0A/0x4AB11  [0xFD5A0]/[0xFD5B8] = **붙이기 전** x·y (그리기 0x4AB72 · 판정이 쓰는 값)
   *     0x4AB18~0x4AB44  x 16~280 · y 4~172 로 붙인 값은 **0x5EECF 배경 저장 사각형에만** 쓴다
   *   ⇒ 원본 링은 **언제나 유닛 중심**에 뜨고, 화면 밖 아이콘은 잘리거나(완전히 나가면 0x4AABF·0x4AB04 생략) 안 보일 뿐이다.
   *   ☠ 제품은 링 전체를 안쪽으로 옮겨(safeCenter) 가장자리에서 링이 캐릭터에서 비껴 떴다. 옮기지 않는다. */
  this.center = { x: this.wanted.x, y: this.wanted.y };
  /* ☠☠☠★★★★★ **민 만큼 «되돌려 놓는다»** (2026-09-15 · 사장님 지적)
   *
   *   > 사장님: 「애초부터 **화면 비율이 미묘하게 달라.** 우리 화면이 가로로 약간 더
   *   >  길게 담는 것 같아」
   *
   *   위 (가) 대로 링이 화면 밖으로 나가면 **카메라를 밀어** 원형을 지킨다. 그런데
   *   **민 것을 되돌리지 않아** 링을 닫은 뒤에도 화면이 그만큼 어긋난 채 남았다.
   *   마법은 링을 연 자리에서 시전하므로 **연출 내내** 어긋난다 —
   *   실측: 원본 GIF 와 겹치면 147칸이 하나같이 `−14, −1`,
   *         살아 있는 카메라가 `205, 270` 인데 제자리는 `192, 272`(차 `+13, −2`).
   *   ⇒ 민 양을 적어 두었다가 **닫을 때 반대로 민다.** (가)의 「원형을 안 찌그러뜨린다」는
   *     그대로 지키면서, 링이 사라진 뒤의 화면은 원본과 같아진다. */
  /* ☠☠☠★★★★★ **카메라는 안 민다 — 링만 옮긴다** (2026-09-15 · 사장님 지적)
   *
   *   > 사장님: 「애초부터 **화면 비율이 미묘하게 달라.** 우리 화면이 가로로 약간 더
   *   >  길게 담는 것 같아」
   *
   *   머리말 (가) 는 원본(`0x4AA42` 아이콘 개별 클램프)과 일부러 다르게
   *     ① `onCamera` 로 **카메라를 밀고**
   *     ② 그래도 모자라면 링 **전체를 평행이동**
   *   한다고 적어 두었다. 그런데 ①이 **되돌아오지 않는다** — `isOpen()` 은 타겟 지정
   *   중에도 참이라 닫는 자리에 안 온다. 그래서 마법 연출 내내 화면이 밀린 채였다.
   *   실측 — 제자리 `192, 272` 인데 살아 있는 값이 `205, 270`(차 `+13, −2`),
   *          원본 GIF 와 겹치면 147칸이 하나같이 `−14, −1` 어긋났다.
   *
   *   ★ **②만으로도 원형은 안 찌그러진다** — `safeCenter` 가 이미 옮긴 중심(`s.x`,`s.y`)을
   *     돌려주고 아이콘은 그 중심을 기준으로 그려진다. ①은 「링을 유닛 바로 위에
   *     두려고」 곁들인 것일 뿐이다.
   *   ⇒ ①을 뺀다. 맵은 원본과 같은 자리에 서고, 링은 화면 가장자리에서 유닛에서
   *     조금 비껴 놓인다(원본은 그 자리에서 링이 찌그러진다 — 어느 쪽도 원본과
   *     완전히 같지는 않지만, **맵이 어긋나는 쪽이 훨씬 나쁘다**).
   *   ☐ 원본처럼 아이콘 개별 클램프로 갈지는 따로 정한다 (`00_이어가기_전투.md`). */
  this._민것 = null;

  /* ★ 여는 쪽이 메뉴 이름을 주면 그것으로 — AI 세션(ai_ctrl)으로 열거나 목표 지정 뒤 AI 링으로 돌아올 때
   *   (0x4D0D0 → 0x4B0F5 메뉴 구조체 = ai_ctrl.ico). ☠ 늘 'mainring' 이라 AI 아이콘 번호를 본 링 그림으로 그렸다 (2026-09-26 실측) */
  this.menu = this.opts.menu || 'mainring';
  this.stack = [];
  this.magicPicks = [];
  this.icons = buildMain(battle, unit, this.opts);
  this._프레임초기화();
  this.opened = true;
  this.pending = null;
  if (this.opts.onCursor) this.opts.onCursor(this.center.x, this.center.y);   // 0x5CF3E
  /* ★ 명령 뒤 링으로 돌아올 때는 «펼치기»(0x4B8EB · 반지름 0 에서 +4 · 9 장) — 원본 세션 고리 머리 0x4D7EA → 0x4D88A call 0x4B8EB (2026-09-27)
   *   처음 열 때만 0x4B767(반지름 276 에서 −16 · 15 장 · 0x4D7AC). ☠ 돌아올 때도 처음 열기라 첫 장 아이콘이 화면 밖이었다(원본 279 틱 8 개 ↔ 우리 0) */
  this._애니시작(this.opts.펼치기 ? 'spread' : 'open');
  return this;
};

/** 열린 링을 닫기 애니메이션으로 전환하고 최종 닫힘 처리는 완료 단계에 맡긴다. */
Ring.prototype.close = function () {
  /* ★ 되돌림 2026-08-26 — 닫기 시작점에서 `showUnitValues(false)+apply()` 를 부르면
   *   `apply()` 안에서 다른 것들이 재진입해 링 조작이 꼬일 수 있다.
   *   원본 근거(닫기 루프에 0x13498 이 없다)는 맞지만 **넣는 자리를 다시 정한다.** */
  /* ★ 열 때 민 카메라를 여기서 되돌린다 (위 `open` 의 `_민것` 주석 참조) */
  if (this._민것 && this.opts && this.opts.onCamera) {
    this.opts.onCamera(-this._민것.dx, -this._민것.dy);
    this._민것 = null;
  }
  this._애니시작('close');
  this.pending = { act: 'closed' };
  return this;
};

/** ★ 명령을 고르면 링을 «모은» 뒤 걷는다 — 원본 명령 처리기(0x4D989 필살·초필살 · 0x4D8BE 등 일곱 곳)가 0x4B9D7(모으기 9 장 · 장마다 2 틱)을
 *   부르고 끝난 뒤 명령을 돈다(0x4D98E TP 검사 → 실행). 닫기 0x4B842 를 부르는 곳은 0x4DABD 한 곳뿐이다.
 *   근거(2026-09-27 원본 기록 설화): 超 누름 → 링 소리 0 틱 · 2 틱 대기 9 번(0x499E4) · 링을 그림 → 18 틱에 연출 간격 설정
 *   ☠ 예전엔 닫기(15 장)를 걸어 놓고 안 그린 채 곧바로 연출을 시작해 18 틱이 빠졌다 · 비연참은 칸을 누를 때에야 링 소리가 났다
 *   @returns {Promise} 모으기가 끝나 링이 걷히면 풀린다 */
Ring.prototype.모으고닫기 = function () {
  var self = this;
  if (!this.opened) return Promise.resolve();
  /* 열 때 민 카메라를 되돌린다 — close 와 같다 */
  if (this._민것 && this.opts && this.opts.onCamera) {
    this.opts.onCamera(-this._민것.dx, -this._민것.dy);
    this._민것 = null;
  }
  return new Promise(function (끝) { self._애니시작('gather'); self.pending = { act: 'gatherClose', 끝: 끝 }; });
};

/** 링이 입력 가능한 열린 상태인지 반환한다. */
Ring.prototype.isOpen = function () { return this.opened; };

/** 현재 아이콘별 프레임과 가리킨 항목을 초기 상태로 되돌린다. */
Ring.prototype._프레임초기화 = function () {
  this.frames = this.icons.map(function () { return 0; });
  this.hover = -1;
};

/** 지정한 링 애니메이션의 첫 틱과 프레임 상태를 시작한다. */
Ring.prototype._애니시작 = function (kind) {
  var a = ANIM[kind];
  var firstSpreadStep = kind === 'spread';
  this.animKind = kind; this.animK = firstSpreadStep ? 1 : 0;
  this.R = a.R0 + (firstSpreadStep ? a.dR : 0);
  this.theta0 = a.theta0 + (firstSpreadStep ? DSTEP : 0);
  this.accAnim = 0;
  this.phase = (kind === 'open') ? 'opening'
             : (kind === 'close') ? 'closing'
             : (kind === 'gather') ? 'gather' : 'spread';
  this.playSound();
  this._배치갱신();
};

/** 0x4B0FB — 항목마다 좌표를 다시 잡습니다. */
Ring.prototype._배치갱신 = function () {
  var n = this.icons.length;
  if (!n) { this.pts = []; return; }
  var p = points(n, this.R, this.theta0);
  var self = this;
  this.pts = p.map(function (q, i) {
    var icon = self.icons[i];
    var f = self.frames[i] | 0;
    var meta = self.frameMeta(self.menu, icon, f);
    var ax = meta ? meta.ax : -12, ay = meta ? meta.ay : -12;
    var w = meta ? meta.w : 24, h = meta ? meta.h : 24;
    var dx = q.dx, dy = q.dy;
    var sx = self.center.x + dx + ax, sy = self.center.y + dy + ay;
    return { dx: dx, dy: dy, ax: ax, ay: ay, w: w, h: h,
             sx: sx, sy: sy, off: !visible(sx, sy, w, h) };   // 0x4AA42
  });
};

/* ── 진행 ─────────────────────────────────────────────────────────────── */

/** @param {number} dtMs 실시간 경과 */
Ring.prototype.update = function (dtMs) {
  if (!this.opened) return;

  /* 링 애니 — 2틱마다 한 프레임 (11.4ms) */
  if (this.animKind) {
    this.accAnim += dtMs;
    while (this.animKind && this.accAnim >= MS_ANIM - 1e-6) {
      this.accAnim -= MS_ANIM;
      this._애니한칸();
    }
  }

  /* 아이콘 프레임 — 30틱마다 한 칸 (171ms). 0x4AD6F 은 마우스가 올라간 것 하나만 돌립니다. */
  this.accIcon += dtMs;
  while (this.accIcon >= MS_ICON - 1e-6) {
    this.accIcon -= MS_ICON;
    if (this.phase === 'idle' && this.hover >= 0) {
      var f = (this.frames[this.hover] | 0) + 1;
      if (f > 3 || !this.frameMeta(this.menu, this.icons[this.hover], f)) f = 0;
      this.frames[this.hover] = f;
      this._배치갱신();
    }
  }
};

/** 현재 링 애니메이션을 한 틱 진행하고 끝이면 완료 전이를 수행한다. */
Ring.prototype._애니한칸 = function () {
  var kind = this.animKind;
  var a = ANIM[kind];
  /* spread 는 마지막 R36 장을 2틱 그린 뒤 다음 2틱 후 idle 로 바뀝니다. */
  if (kind === 'spread' && this.animK >= a.frames) { this._애니마무리(); return; }
  this.animK++;
  this.theta0 += DSTEP;                 // 0x4AEB5
  this.R += a.dR;                       // 0x4AEC1
  this._배치갱신();
  if (this.animK >= a.frames && kind !== 'spread') this._애니마무리();
};

/** 끝난 애니메이션 종류와 대기 작업에 맞춰 링 상태 전이를 확정한다. */
Ring.prototype._애니마무리 = function () {
  var kind = this.animKind;
  this.animKind = null;
  if (kind === 'open' || kind === 'spread') { this.phase = 'idle'; this._프레임초기화(); this._배치갱신(); return; }
  if (kind === 'close') {
    this.opened = false; this.phase = 'closed';
    var p = this.pending; this.pending = null;
    if (p && p.act === 'result' && this.opts.onPick) this.opts.onPick(p.cmd);
    else if (this.opts.onPick) this.opts.onPick({ kind: 'cancel' });
    return;
  }
  if (kind === 'gather') {              // 구조체만 갈아 끼우고 다시 펼칩니다 (0x4CAA3)
    var q = this.pending; this.pending = null;
    /* 명령을 골랐을 때 — 모은 채 링을 걷는다 (아래 모으고닫기) */
    if (q && q.act === 'gatherClose') { this.opened = false; this.phase = 'closed'; if (q.끝) q.끝(); return; }
    if (q && q.act === 'swap') { this.menu = q.menu; this.icons = q.icons; }
    this._프레임초기화();
    this._애니시작('spread');
  }
};

/* ── 입력 ─────────────────────────────────────────────────────────────── */

/** 0x4AC8A. mx,my 는 논리 320×200 좌표. @returns 배치 인덱스 · −1 · −2 */
Ring.prototype.hitTest = function (mx, my) {
  if (!this.opened) return -1;
  /* ★ [리마스터 I-08] 마법 링을 안 그리는 모드에서는 **판정도 없다.**
   *   안 보이는 아이콘이 눌리면 안 된다 (`_drawCanvas` 의 `목록만` 갈래와 한 쌍). */
  if (그림메뉴(this.menu) === 'magic' && this.목록만) return -1;   /* AI 마법 지정(ai_magic)도 «목록만»이면 링 판정 없음 — 꺼져 있으면 링·목록 둘 다 (2026-10-01 사장님 「목록만 옵션을 킬때에는 링커맨드도 사라져야지」) */
  var i = hitTest(this.pts, this.center.x, this.center.y, mx, my);
  /* 원본은 링이 서 있는 동안(0x4BA7F 의 입력 루프)에만 히트 테스트를 합니다 */
  if (this.phase !== 'idle') return i;
  if (i >= 0 && this.hover !== i) {                    // 프레임 리셋 (0x4AD1A)
    if (this.hover >= 0) this.frames[this.hover] = 0;
    this.frames[i] = 0;
    this.hover = i;
    this._배치갱신();
  }
  return i;
};

/** 마우스 이동 */
Ring.prototype.move = function (mx, my) { this.패드표시 = false; this.hitTest(mx, my); };

/** 왼쪽 클릭 (0x4BA7F 의 이벤트 2) */
Ring.prototype.click = function (mx, my) {
  if (!this.opened || this.phase !== 'idle') return;
  var i = this.hitTest(mx, my);
  if (i === -2) { this._결과내기({ kind: 'self', ret: -2 }); return; }
  if (i < 0) return;
  this._선택(i);
};

/** 오른쪽 클릭 · ESC (0x4BA7F 의 이벤트 3 / 0x1B) */
Ring.prototype.cancel = function () {
  if (!this.opened || this.phase !== 'idle') return;
  if (this.stack.length) { this._뒤로(); return; }
  this.pending = null;
  this._애니시작('close');
};

/** 명령 결과를 보류한 채 닫기 애니메이션을 시작한다. */
Ring.prototype._결과내기 = function (cmd) {
  this.pending = { act: 'result', cmd: cmd };
  this._애니시작('close');
};

/** 새 메뉴 교체를 보류하고 모으기 애니메이션을 시작한다. */
Ring.prototype._메뉴교체 = function (menu, icons) {
  this.pending = { act: 'swap', menu: menu, icons: icons };
  this._애니시작('gather');
};

/** 현재 링 메뉴를 스택에 저장한 뒤 하위 메뉴 교체를 예약한다. */
Ring.prototype._하위메뉴열기 = function (menu, icons, note) {
  this.stack.push({ menu: this.menu, icons: this.icons, note: note });
  this._메뉴교체(menu, icons);
};

/** 스택의 직전 메뉴를 꺼내고 마법 선택 단계도 함께 한 칸 되돌린다. */
Ring.prototype._뒤로 = function () {
  var s = this.stack.pop();
  if (this.menu === 'magic') this.magicPicks.pop();
  this._메뉴교체(s.menu, s.icons);
};

/** 현재 위치의 아이콘을 메뉴 문맥에 따라 하위 메뉴 또는 전투 명령으로 해석한다. */
Ring.prototype._선택 = function (pos) {
  var icon = this.icons[pos];
  var u = this.unit, b = this.battle;

  if (this.menu === 'mainring') {
    var cmd = mainCommand(icon);
    cmd.icon = icon; cmd.name = MAIN_NAME[icon];
    if (cmd.kind === 'special') {
      var list = buildSpecial(b, u);
      if (!list.length) { this.playSound(); return; }         // 0x4CAC8 거부음
      this._하위메뉴열기('special', list, 'special'); return;
    }
    if (cmd.kind === 'magic')  { this.magicPicks = []; this._하위메뉴열기('magic', buildMagic(0), 'magic'); return; }
    if (cmd.kind === 'skill')  {
      var sk = buildSkill(b, u, this.opts);
      if (!sk.length) { this.playSound(); return; }
      this._하위메뉴열기('skill', sk, 'skill'); return;
    }
    if (cmd.kind === 'ai')     { this._하위메뉴열기('ai_ctrl', buildAi(b, u), 'ai'); return; }
    this._결과내기(cmd);
    return;
  }

  if (this.menu === 'special') {
    var pick = specialPick(icon);                              // (나) 여기서만 변환
    var ctx = this.stack[this.stack.length - 1];
    if (ctx && ctx.aiAssign) {
      /* AI 지정 — [+0x82] 는 전역 슬롯 0~24 · 0xFF 자동 */
      var v = aiSpecialFromPick(pick);
      if (v != null) { u.ai = u.ai || {}; u.ai.special = v; }
      this.stack.pop();                                        // ai_ctrl 로 되돌아갑니다
      this._메뉴교체('ai_ctrl', buildAi(b, u));
      return;
    }
    this._결과내기({ kind: 'special', icon: icon, pick: pick,
                   slot: pick.kind === 'slot' ? pick.slot : -1,
                   ultimate: pick.kind === 'ultimate' });
    return;
  }

  if (this.menu === 'magic') {
    /* ※ 2·3단의 아이콘 0 은 "뒤로"가 아닙니다. 0x4C8F2 · 0x4C90E 가 `아이콘 0 → 첨자 7`
     *   로 접고, 표 0x74FA8 의 첨자 7 자리에도 실제 마법이 들어 있습니다
     *   (예: [계열1][7][5] = 18 → 마법 17). 뒤로 가려면 우클릭/ESC 입니다. */
    this.magicPicks.push(icon);
    if (this.magicPicks.length < 3) {
      this.stack.push({ menu: this.menu, icons: this.icons, note: 'magic' });
      this._메뉴교체('magic', buildMagic(this.magicPicks.length));
      return;
    }
    var n = magicNumber(this.assets, this.magicPicks[0], this.magicPicks[1], this.magicPicks[2]);
    var ctx2 = this.stack[0];
    if (ctx2 && ctx2.aiAssign) {
      if (n >= 0) { u.ai = u.ai || {}; u.ai.magic = Math.floor(n / 3); }  // 0x4D362 idiv 3
      this.magicPicks = [];
      this.stack = [];
      this._메뉴교체('ai_ctrl', buildAi(b, u));
      return;
    }
    if (n < 0) {                                     // 표가 0 = 그 자리엔 마법 없음
      this.playSound(); this.magicPicks = []; this.stack = [];
      this._메뉴교체('mainring', buildMain(b, u, this.opts));
      return;
    }
    this._결과내기({ kind: 'magic', spell: n, slot: Math.floor(n / 3),
                   series: Math.floor(n / 21), level: Math.floor(n / 3) % 7, rank: n % 3,
                   picks: this.magicPicks.slice() });
    return;
  }

  if (this.menu === 'skill') {
    this._결과내기({ kind: 'skill', icon: icon, skill: skillNoFromIcon(icon) });
    return;
  }

  if (this.menu === 'ai_ctrl') {
    /* 0x4D06E 의 12칸 분기 — 값 토글이 대부분이고, 마법·필살기만 하위 메뉴로 갑니다 */
    u.ai = u.ai || {};
    switch (icon) {
      case 0: u.ai.mode = 3; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 1: u.ai.mode = 0; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 3: u.ai.atkTend = 0; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 4: u.ai.atkTend = 1; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 5: u.ai.atkTend = 2; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 6: u.ai.fleeTend = 0; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 7: u.ai.fleeTend = 1; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 8: u.ai.fleeTend = 4; this._메뉴교체('ai_ctrl', buildAi(b, u)); return;
      case 9: case 10:                                    // 마법 지정 (0x4D337)
        this.magicPicks = [];
        this.stack.push({ menu: this.menu, icons: this.icons, aiAssign: true });
        this._메뉴교체('magic', buildMagic(0));
        return;
      case 11: case 12: {                                 // 필살기 지정 (0x4D37B) — (나)
        var l2 = buildSpecial(b, u);
        if (!l2.length) { this.playSound(); return; }
        this.stack.push({ menu: this.menu, icons: this.icons, aiAssign: true });
        this._메뉴교체('special', l2);
        return;
      }
      /* ★★★★★ **아이콘 13 은 「확정」이 아니라 「해제」다** — `0x4D217` (2026-08-30 · B-3)
       *   문서와 이 코드가 서로 다르게 적혀 있어 **바이트를 직접 풀었다**:
       *   ```asm
       *   0x4D217  mov  dl, [esi+0x56]
       *   0x4D21A  mov  byte [esi+0x83], **0**    ; AI 조종을 푸는다
       *   0x4D221  cmp  dl, 0xFF / jne
       *   0x4D226  call 0x196D0                   ; 0xFF 면 대기열에 되넣는다
       *   0x4D234  mov  eax, **1**                ; 반환 1
       *   ```
       *   ☠ 전에는 `flag = 2`(확정)로 올리고 `ret` 을 안 실어,
       *     `controller.js` 의 `ret === 1` → `releaseAi()` 갈래를 **못 타고 있었다**.
       *   ★ `flag = 2` 는 「원래 AI 인 유닛」 표시다(`combat.js` 소환수). */
      case 13:
        u.ai.flag = 0;                                    /* 0x4D21A */
        this._결과내기({ kind: 'ai', done: true, ret: 1 }); /* 0x4D234 */
        return;
      default: return;
    }
  }
};

/* ── 그리기 ───────────────────────────────────────────────────────────── */

/**
 * @param {CanvasRenderingContext2D|HTMLElement} target
 * 원본 0x4AB72 는 (x + 앵커x, y + 앵커y) 에 찍습니다. 화면 밖이면 그 아이콘만 생략.
 * 클램프는 (가) 때문에 걸지 않습니다.
 */
Ring.prototype.draw = function (target) {
  if (!this.opened) return;
  if (!target) return;
  if (this._아이콘밀림) this._아이콘밀린것굽기();   /* 정본 400 — 열린 채 날씨가 바뀌어도 그리기 전에 */
  if (typeof target.drawImage === 'function') return this._캔버스그리기(target);
  return this._DOM그리기(target);
};

/** 현재 링과 마법 선택 목록을 논리 캔버스에 원본 크기로 그린다. */
Ring.prototype._캔버스그리기 = function (ctx) {
  ctx.imageSmoothingEnabled = false;
  /* ★ AI 마법 지정(ai_magic)도 같은 하위 메뉴 0x4C72A 다 (0x4D337 → 0x4C72A) — 목록도 함께 뜬다
   *   (2026-09-30 사장님 「ai 하위커맨드 마법 선택에서 보유한 마법이 안나오는 문제도 있어.」) ·
   *   ☠ `this.menu === 'magic'` 만 봐서 AI 쪽은 목록이 빠졌다. 목록 클릭 시전·링 숨김(목록만)은 'magic' 만 그대로 */
  if (그림메뉴(this.menu) === 'magic') this._마법목록그리기(ctx); // 마법 선택 중 상단 주문 목록
  else this.magicHit = [];   /* 정본 218 — 마법 메뉴를 나오면 목록 칸도 비운다: 옛 칸이 남아 패드 세모가 «마법 목록이 있다»로 보고 보이지 않는 목록으로 넘어가 링이 먹통이 됐다 (2026-11-15 사장님 「세모 버튼은 마법에만 사용되어야하는데(ai마법 포함) 다른데서 세모를 누르면 순간적으로 먹통」) · 마우스 magicHitAt 도 같은 칸을 본다 */
  /* ★★ [리마스터 I-08] **클릭 시전 모드에서는 마법 링을 아예 안 그린다.**
   *
   *   사용자 지정 2026-08-16: 「리마스터 사양이라면 **클릭으로 마법 사용 모드에서
   *   링커맨드를 띄우지 않고 목록만 띄우는 것도 방법**이고.」
   *
   *   이 모드에서는 룬을 조합하지 않고 이름을 직접 누르므로 링이 할 일이 없다.
   *   링을 안 띄우면 「목록 첫 줄이 링에 가려 안 눌린다」는 문제가 **원인부터**
   *   사라진다. 마법 하위메뉴(`menu === 'magic'`)에서만 감추고, 메인 링과 다른
   *   하위메뉴는 그대로 둔다 — 이동·공격·아이템은 여전히 링으로 고른다.
   *   우클릭·ESC 취소는 링 그림과 무관하게 그대로 동작한다. */
  var 룬안내 = this._룬안내준비();   /* [리마스터 룬안내] 1번 룬 속성 색 (목록 빛내기는 _마법목록본문그리기) */
  if (그림메뉴(this.menu) === 'magic' && this.목록만) return;   /* AI 마법 지정(ai_magic)도 «목록만»이면 링을 숨긴다 — 꺼져 있으면 링·목록 둘 다 (2026-10-01 사장님 「목록만 옵션을 킬때에는 링커맨드도 사라져야지」) */
  for (var i = 0; i < this.pts.length; i++) {
    var p = this.pts[i];
    if (p.off) continue;
    /* ★ 그림은 «그림을 가진 메뉴»에서 — ai_group·ai_magic·ai_special 은 별명(그림메뉴 · 0x4B0F5)으로 찾는다.
     *   ☠ 이 줄만 this.menu 를 그대로 써서 AI 하위 링이 빈 링으로 그려졌다 (2026-09-26 Z-54 실측 TESTWC) */
    var im = this.images[그림메뉴(this.menu) + '/' + this.icons[i] + '/' + (this.frames[i] | 0)];
    /* 원본 직독은 <canvas>(complete·naturalWidth 가 없다), 추출 PNG 는 <img> */
    if (!im) continue;
    if (!(im.naturalWidth ? im.complete : im.width > 0)) continue;
    if (i === this.hover) this._패드테두리(ctx, i, im, p);
    var 룬 = 룬안내 ? 룬안내(this.icons[i]) : null;
    if (룬 && 룬.색) ctx.drawImage(룬색그림(im, 룬.색), p.sx, p.sy, 그림논리크기(im)[0], 그림논리크기(im)[1]);
    else ctx.drawImage(im, p.sx, p.sy);
  }
  this._패드테두리(ctx);
};

/* ══ [리마스터 룬안내] 마법 룬 링 — 사장님 11-07 「1번룬은 속성을 색깔로 표시하면 좋을 것 같아 … 2번룬은 1번을 선택한 것에 따라서 룬워드 옆에 단계가 작은 숫자로 … 3번룬도 1, 2번에서 선택한것에 따라 해당되는 룬에 단계가 숫자로」·「물론 리마스터 사양으로 토글달고 옵션에서도 선택할 수 있어야하고」
 *   원작 «마법선택표»(0x4C8F2~0x4C980): 1번 룬(아이콘 1~7) = 속성(1 화염 · 2 빙한 · 3 전격 · 4 회복 · 5 보조 · 6 소환 · 7 암흑) · 2번 룬(8~14 · 0) · 3번 룬(15~21 · 0)
 *   ★ 사장님 11-07 「어차피 마법목록에 하이라이트되는걸 구현했으니 이걸 활용하는거야. 화염문장에 커서를 대면 사용할 수 있는 화염계열 마법 전체에 하이라이트가 되고, 두번째 룬선택에서 룬에 커서를 되면 해당되는 단계만 하이라이트가 되는거지. 이게 여러개면 여러개 되면 되고. 3단계도 동일한 방식으로」 → «목록 빛내기 + 1번 색» 고르심 (2·3번 숫자는 뺌)
 *   표에서 «커서 댄 룬을 고르면 될 수 있는 주문»의 (계열, 단계)를 모아 마법 목록의 그 이름을 빛낸다 — 1번 룬 = 그 계열 전부 · 2번 룬 = 3번 룬 전부를 훑은 단계들 · 3번 룬 = 완성되는 주문 하나
 *   설정 룬안내 = '원작'이면 아무것도 안 한다 (opt.js · 게임설정 «마법 룬 속성 색·목록 빛내기») */
var 룬속성색 = ['#ff5a3c', '#5ab4ff', '#ffe03c', '#5ae66e', '#f0f0f0', '#ffa03c', '#b46eff'];   /* 화염 빨강 · 빙한 하늘 · 전격 노랑 · 회복 초록 · 보조 흰색 · 소환 주황 · 암흑 보라 */
Ring.prototype._룬안내준비 = function () {
  if (그림메뉴(this.menu) !== 'magic') return null;
  var O = root.Opt; if (O && O.cfg && O.cfg['룬안내'] === '원작') return null;
  var t = this.assets && this.assets['마법선택표']; if (!t) return null;
  var 고 = (this.룬고름 ? this.룬고름() : []) || [], 깊 = 고.length;
  var 칸 = function (v, 밑) { return (v === 0) ? 7 : v - 밑; };   /* 0x4C8F2 · 0x4C90E — 0 번 아이콘은 일곱째 칸 */
  var 행 = function (p0, i1, i2) { var v = t[p0] && t[p0][i1] && t[p0][i1][i2], n = (v | 0) - 1; return (n < 0 || n % 3) ? -1 : (n % 21) / 3; };   /* 단계 − 1 = 목록의 행 */
  return function (icon) {
    icon = icon | 0;
    var 목 = [], 넣 = function (e, r) { if (r >= 0 && !목.some(function (q) { return q[0] === e && q[1] === r; })) 목.push([e, r]); };
    if (깊 === 0) { if (icon < 1 || icon > 7) return null; for (var r0 = 0; r0 < 7; r0++) 넣(icon - 1, r0); return { 색: 룬속성색[icon - 1], 목록: 목 }; }
    var p0 = 고[0] | 0; if (p0 < 1 || p0 > 7) return null;
    if (깊 === 1) { var i1 = 칸(icon, 8); if (i1 < 0 || i1 > 7) return null; for (var i2 = 0; i2 < 8; i2++) 넣(p0 - 1, 행(p0, i1, i2)); return { 목록: 목 }; }
    if (깊 === 2) { var j1 = 칸(고[1] | 0, 8), j2 = 칸(icon, 15); if (j1 < 0 || j1 > 7 || j2 < 0 || j2 > 7) return null; 넣(p0 - 1, 행(p0, j1, j2)); return { 목록: 목 }; }
    return null;
  };
};
var _룬색 = (typeof WeakMap === 'function') ? new WeakMap() : null;
function 룬색그림(im, 색) {   /* 아이콘을 그 속성 색으로 물들인다 — 명암은 남기고(multiply) 투명은 그대로 */
  if (!_룬색 || typeof document === 'undefined') return im;
  var 모 = _룬색.get(im) || {}; if (모[색]) return 모[색];
  var 원 = 그림원크기(im), c = document.createElement('canvas'); c.width = 원[0]; c.height = 원[1];
  var g = c.getContext('2d'); g.drawImage(im, 0, 0, 원[0], 원[1]);
  g.globalCompositeOperation = 'multiply'; g.fillStyle = 색; g.fillRect(0, 0, 원[0], 원[1]);
  g.globalCompositeOperation = 'destination-in'; g.drawImage(im, 0, 0, 원[0], 원[1]);
  모[색] = c; _룬색.set(im, 모); return c;
}
/* [리마스터] 패드로 가리킨 것 — 아이콘 둘레(가운데면 캐릭터 둘레)에 그라데이션 테두리 · 마우스로 다루면 안 그린다
 *   (사장님 11-06 「링커맨드 선택시 하이라이트 되어야해. 기존 아이콘 주변에 하이라이트가 표시되어야해. 좌스틱이 중립일때는 캐릭터에 하이라이트가 가야하고.」 · 설계서 6절 ② «하이라이트 꼴») */
Ring.prototype._패드테두리 = function (ctx, i, im, p) {
  if (!this.패드표시 || this.phase !== 'idle') return;
  var 빛 = 0.6 + 0.4 * Math.abs(Math.sin(Date.now() / 300));   /* 숨쉬듯 */
  ctx.save();
  if (i == null) {   /* 가운데(캐릭터) — 링 위가 아니라 캐릭터 그림 «뒤»로 빛이 번져야 한다 → battle_main.js 패드링빛 이 유닛 그림 층에 drop-shadow 를 건다 (사장님 11-07 「캐릭터 앞에서 빛나는게 아니라 선택된 캐릭터 뒤에서 빛나야 할 것 같아」) */
  } else {   /* 아이콘 — 그 그림 윤곽으로 금빛 실루엣을 바깥으로 한 겹씩 넓혀 깐다(안쪽 진하고 바깥 옅게) · 아이콘을 그리기 «전»에 불러 뒤에 깔린다 */
    var 실 = 금실루엣(im);
    if (실) [[3, 0.18], [2, 0.36], [1, 0.62]].forEach(function (k) {
      ctx.globalAlpha = k[1] * 빛;
      var 논 = 그림논리크기(im);
      for (var a = 0; a < 8; a++) ctx.drawImage(실, p.sx + Math.round(Math.cos(a * Math.PI / 4) * k[0]), p.sy + Math.round(Math.sin(a * Math.PI / 4) * k[0]), 논[0], 논[1]);
    });
  }
  ctx.restore();
};
var _실루엣 = (typeof WeakMap === 'function') ? new WeakMap() : null;
function 그림원크기(im) { return [im.width || im.naturalWidth, im.height || im.naturalHeight]; }   /* 실루엣 판 = 그림의 실제 픽셀 크기 (스케일러면 N배) */
function 그림논리크기(im) { return [im.논리w || im.naturalWidth || im.width, im.논리h || im.naturalHeight || im.height]; }   /* 화면에 그리는 크기 = 원래(논리) 크기 — 스케일러는 판을 N배로 굽고 논리w 에 원래 크기를 적는다 (실측: epx2 아이콘 36×38 · 논리w 18) */
function 금실루엣(im) {
  if (!_실루엣 || typeof document === 'undefined') return null;
  var c = _실루엣.get(im); if (c) return c;
  var 원 = 그림원크기(im), w = 원[0], h = 원[1]; if (!w || !h) return null;   /* 아이콘을 그릴 때(drawImage(im, x, y))와 같은 크기 — 이미지는 naturalWidth · 판(canvas)은 width. 둘을 섞어 읽어 «AI» 아이콘 테두리가 몇 배로 번졌다 (사장님 11-07 「이제 링커맨드에서 아이콘 테두리가 이상해」) */
  c = document.createElement('canvas'); c.width = w; c.height = h;
  var x = c.getContext('2d'); x.drawImage(im, 0, 0, w, h);   /* 크기를 꼭 준다 (hud.js 패드금빛 과 같은 까닭) */ x.globalCompositeOperation = 'source-in'; x.fillStyle = 'rgb(255,200,70)'; x.fillRect(0, 0, w, h);
  _실루엣.set(im, c); return c;
}

/* 마법 하위메뉴 상단 주문 목록 — 원본은 마법 선택 중 화면 상단에 원소별 주문명·MP 를
 * 띄운다. 데이터: 이름표 0x7423C(js/magicnames.js) · MP표 0x753B6(MP_TIER).
 * 표시 셀 주문 = 이름표[원소×21 + 행×3 + 유닛의 그 원소 마법클래스(0x28429)] (magicNumber와 동일).
 * 사용 가능(magicGate 통과)한 셀은 밝게, 아니면 어둡게.
 * ※ 좌표·색 팔레트는 원본 그리기 루틴 미확정 → 원본 스크린샷(320×200) 기준 근사값. */
Ring.prototype._마법목록그리기 = function (ctx) {
  this.magicHit = [];      // ★ [리마스터 I-08] 이번 프레임의 클릭 영역
  /* ★★ 주문 목록은 **첫 룬을 고르기 전에만** 뜬다 (2026-08-16)
   *
   *   사용자 지정: 「**첫번째 룬을 선택하면, 마법 리스트가 사라져.** 우클릭이나
   *   esc 빠져나가서 다시 첫번째 룬 선택으로 돌아가면 **리스트가 다시 나오고**.」
   *
   *   목록은 「원소 × 단계」 표라 첫 룬(= 원소)을 고르고 나면 보여 줄 이유가 없다.
   *   취소는 `magicPicks.pop()`(아래 `_back`)이라 되돌아오면 다시 비고, 목록도
   *   저절로 되살아난다.
   *
   *   ★ 조건을 이 함수 **안**에 둔다 — 그리기 갈래가 캔버스·DOM 둘이라 바깥에서
   *     막으면 한쪽을 빠뜨리고, 무엇보다 `magicHit`(클릭 과녁)이 **이전 프레임 값
   *     그대로 남아** 안 보이는 목록이 계속 눌리게 된다. 위에서 비운 뒤 나간다. */
  /* ★ 몇 단째인지는 **세션**이 안다 — `Ring.magicPicks` 는 링을 단독으로 굴릴 때만
   *   쓰이고, 실제 전투는 `controller.ringIcon` → `session.ringPick` 경로라
   *   그쪽 `magicPicks` 가 채워진다. 그래서 링만 보고 판단하면 **늘 0단**이라
   *   목록이 안 사라졌다 (사용자 2026-08-16: 「첫번째 룬 선택시 목록 사라지는거
   *   구현 안됐어」). 바깥에서 심어 준 `단계` 를 먼저 본다. */
  var 단 = (this.단계 != null) ? (this.단계 | 0)
                              : ((this.magicPicks && this.magicPicks.length) | 0);
  if (단 > 0) return;
  try { this._마법목록본문그리기(ctx); } catch (e) {} // 그리기 오류가 렌더 루프를 멈추지 않게
};

/**
 * ★ [리마스터 I-08] 원본 좌표(320×200)의 한 점이 어느 주문 이름 위인지.
 *
 * 사용자 지정(2026-08-15): 「별도 창을 여는 게 아니라 **기존 마법 목록을 직접
 * 클릭**해서 시전하게」 — 그래서 목록을 따로 만들지 않고, 원본이 이미 그리고
 * 있는 `_drawMagicListBody` 의 이름 자리를 그대로 과녁으로 쓴다.
 * 고른 뒤 흐름은 룬워드로 고른 것과 **완전히 같다**(`magicGate` → `runCommand`).
 */
Ring.prototype.magicHitAt = function (px, py) {
  var h = this.magicHit;
  if (!h || !h.length) return null;
  for (var i = 0; i < h.length; i++) {
    var r = h[i];
    if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return r;
  }
  return null;
};
/** [리마스터 · 정본 374] 마법 목록에서 빛나는 이름 한 줄 그림 — 이름·색·배율(필터)마다 한 번만 그린다.
 *   그리는 법은 예전 매 프레임 그리기와 같다: 양끝이 흐린 금빛 띠(0.55) + 번짐 그림자(blur 8)를 켠 외곽선·본문 세 겹 (깜빡임 세기 1 · 찍을 때 투명도로 곱한다)
 *   그림은 스케일러 규약대로 N배 백킹 + 논리w·논리h (shadowBlur 는 장치 픽셀이라 예전 N배 캔버스와 같은 번짐) */
Ring.prototype._빛이름그림 = function (name, col, H, OUT, DY) {
  var Sc = root.G2Scaler, N = (Sc && Sc.N) ? Sc.N() : 1, 키 = name + '|' + col + '|' + ((Sc && Sc.cur) ? Sc.cur() : '') + '|' + N;
  var 저 = Ring._빛이름캐시 || (Ring._빛이름캐시 = {});
  if (저[키]) return 저[키];
  var 여 = 12, 띠w = name.length * 6 + 16, w = 띠w + 여 * 2, h = DY + 1 + 여 * 2;
  var c = document.createElement('canvas'), g;
  if (Sc && Sc.prepare) g = Sc.prepare(c, w, h); else { c.width = w; c.height = h; g = c.getContext('2d'); }
  var 띠 = g.createLinearGradient(여, 0, 여 + 띠w, 0);
  띠.addColorStop(0, 'rgba(255,190,50,0)'); 띠.addColorStop(0.2, 'rgba(255,190,50,0.55)'); 띠.addColorStop(0.8, 'rgba(255,190,50,0.55)'); 띠.addColorStop(1, 'rgba(255,190,50,0)');
  g.fillStyle = 띠; g.fillRect(여, 여, 띠w, DY + 1);
  g.shadowColor = 'rgba(255,215,90,1)'; g.shadowBlur = 8;
  var x = 여 + 8, y = 여 + 2;
  for (var 겹 = 0; 겹 < 3; 겹++) {
    H.text(g, name, x - 1, y, OUT, 1); H.text(g, name, x + 1, y, OUT, 1);
    H.text(g, name, x, y - 1, OUT, 1); H.text(g, name, x, y + 1, OUT, 1);
    H.text(g, name, x, y, col, 1);
  }
  c.논리w = w; c.논리h = h; c.여 = 여;
  if (Object.keys(저).length > 400) Ring._빛이름캐시 = 저 = {};   /* 필터를 자주 바꿔도 무한히 쌓이지 않게 */
  return (저[키] = c);
};
/** 선택 중인 룬과 완성 주문 이름을 마법 목록 본문에 그린다. */
Ring.prototype._마법목록본문그리기 = function (ctx) {
  var MN = root.G2MagicNames, H = root.G2Hud, b = this.battle, u = this.unit;
  if (!MN || !H || !H.text || !u) return;
  var T = b && b.T;
  /* 색 = 원본 GENESIS.PAL 인덱스(참조 hex와 dist=0 정확 일치). 테두리 공통 0x06(4방향).
   * 이름 = 클래스색 1노랑0x11·2연두0x31·3보라0x50 · TP/MP 부족 = 진한 보라 0x24 · 소모MP = 흰색 0x01. */
  var OUT = 0x06, WHITE = 0x01, LOCK = 0x24;
  var CLASS = [0x11, 0x31, 0x50];
  function outl(s, leftX, y, main) {                    // 원본 0x484F9 4방향 외곽선 + 본문
    H.text(ctx, s, leftX - 1, y, OUT, 1); H.text(ctx, s, leftX + 1, y, OUT, 1);
    H.text(ctx, s, leftX, y - 1, OUT, 1); H.text(ctx, s, leftX, y + 1, OUT, 1);
    H.text(ctx, s, leftX, y, main, 1);
  }
  function W(s) { return s.length * 6; }                // 글자 전진 = GLYPH.w(5)+자간(1)

  /* 원본 0x4B1C0(전체 그리드 경로, 직독 확정): 원소 e(0~6: 화염·빙한·전격·회복·보조·소환·암흑)는
   *   **고정 셀** (밴드 = e÷3, 열 = e%3)에 놓인다. magicClassOf(e)<0 인 원소는 그 셀을 비운다
   *   (원소 인덱스 = 셀 방문 인덱스로 항상 1:1 — 0x4b31c 가 셀마다 그 원소로 magicClassOf 호출,
   *    0x4b330 스킵도 셀·원소 카운터를 함께 증가). 회복(e3)→밴드1·열0=**좌하단**으로,
   *   사용자가 확인한 "회복=좌하단"과 일치한다(예전 '사용가능만 순서대로 패킹'은 틀렸음).
   *   좌표(원본 상수):
   *     밴드 Y  상단 9 (0x4b2dd ebx=9) · 하단 0x8c=140 (0x4b4a1 eax=0x8c)     — [esp+0xc]→행베이스
   *     열 피치 0x5c=92 (0x4b47b) · 중앙열 이름 X=0x98=152·MP X=0xc5=197 (단일열 경로 0x4b266/0x4b2a9)
   *     MP 우측 = 이름중앙 + 0x2d(45)  ·  행 DY=8 (0x4b459 add ..,0x8)
   *   이름 = 열 중앙정렬(0x48513: x = 중심 − 글자수×3), MP = 우측정렬, 둘 다 외곽선 폰트 0x484F9(동일 크기).
   *   ※ 암흑(e6)은 밴드2가 되어 이 루프(밴드<2, 0x4b4b8 cmp 2) 밖 → 원본도 이 경로에선 안 그림
   *     (마법 보유 유닛 확보 시 재확인 필요 — 별도 처리 가능성). */
  /* ★ 원소별 고정 셀 (밴드, 열). 원작 그리드는 화염·빙한·전격(상단) / 회복·보조·암흑(하단)이고
   *   소환은 빙한(상단중앙) 자리를 **오버라이드**했다. 리마스터에서는 소환을 비어있는
   *   **중단-오른쪽**으로 옮기고, 하단-오른쪽은 **암흑**으로 바로잡는다(사용자 지정). */
  var CELL = [
    { band: 0, col: 0 },   // 0 화염 → 상단좌
    { band: 0, col: 1 },   // 1 빙한 → 상단중
    { band: 0, col: 2 },   // 2 전격 → 상단우
    { band: 2, col: 0 },   // 3 회복 → 하단좌
    { band: 2, col: 1 },   // 4 보조 → 하단중
    { band: 1, col: 2 },   // 5 소환 → 중단우 (리마스터 이동)
    { band: 2, col: 2 }    // 6 암흑 → 하단우
  ];
  var NAMECX = [60, 152, 244];                  // 열 이름 중앙 X: 중앙 152 확정, 피치 92
  var MPCX   = [NAMECX[0] + 45, NAMECX[1] + 45, NAMECX[2] + 45];  // MP 중앙 X = 이름중앙 + 0x2d(45) (원본). 중앙정렬이라 우측정렬보다 살짝 오른쪽
  var BANDY  = [9, 75, 140];                     // 상단 9 · 중단 75 · 하단 0x8c=140
  var DY = 8;
  /* [리마스터 룬안내] 커서 댄 룬으로 될 수 있는 주문(계열, 단계) — 그 이름을 패드 가리킴과 같은 금빛으로 */
  var 룬안 = this._룬안내준비(), 룬빛 = (룬안 && this.hover >= 0 && this.phase === 'idle') ? ((룬안(this.icons[this.hover]) || {}).목록 || []) : [];
  for (var elem = 0; elem < MN.ELEMS; elem++) {
    var rank = magicClassOf(b, u, elem);
    if (rank < 0) continue;                     // 해당 원소 클래스 없음 → 셀 비움
    var cell = CELL[elem]; if (!cell) continue;
    var classCol = CLASS[Math.max(0, Math.min(2, rank))];
    var ncx = NAMECX[cell.col], mpcx = MPCX[cell.col], y0 = BANDY[cell.band];
    for (var row = 0; row < MN.ROWS; row++) {
      var name = (MN.nameAt(elem, row, rank) || '').toUpperCase();
      if (!name) continue;
      /* ★ 마법 번호 = **계열×21 + 단계×3 + 클래스** — 원본 규약이다
       *   (계열 7개 × 단계 7 × 클래스 3 = 147). `마법_일람표.md` */
      var idx = elem * 21 + row * 3 + rank;   /* 마법_일람표.md */
      var usable = (magicGate(b, u, idx, T) === null);   // TP/MP 부족 → 잠금색 0x24
      var y = y0 + row * DY;
      var nx = ncx - W(name) / 2;
      var 패빛 = (this.패드목록 >= 0 && this.패드목록 === this.magicHit.length) || 룬빛.some(function (q) { return q[0] === elem && q[1] === row; });   /* [리마스터] 패드로 가리킨 마법 — 이름 글자가 금빛으로 빛난다(상자 아님) (사장님 11-07 「이것도 상자말고 마법 이름이 빛나면 좋겠어」) */
      if (패빛) {   /* 더 진하게 — 이름 뒤 양끝이 흐린 금빛 띠 + 글자 둘레 넓은 금빛 번짐 세 겹 (사장님 11-07 「마법 글자 하이라이트 좀더 진해도 되겠어 지금 잘안보여. 특히 3클인데도(보라색) 잘 안보이는데, 1클 노란색이면 더 안보일 것 같아.」) */
        /* ★ 정본 374 — 빛나는 이름은 한 번 그려 둔 그림을 찍는다. 전에는 번짐 그림자(shadowBlur)를 켠 채 글자를 이름마다 15번씩
         *   (외곽선 4 + 본문 1 × 세 겹) 매 프레임 다시 그려, 1번 룬이 한 계열 7줄을 빛내면 한 프레임에 수백 번 블러를 계산했다
         *   (사장님 11-22 「미카엘 마법 돌릴떄 전격에 하이라이트 될때마다 프레임드랍이 발생한대」) · 깜빡임 세기(빛m)는 찍을 때 투명도로 */
        var 빛m = 0.7 + 0.3 * Math.abs(Math.sin(Date.now() / 300)), 빛 = this._빛이름그림(name, usable ? classCol : LOCK, H, OUT, DY);
        ctx.save(); ctx.globalAlpha = 빛m;
        ctx.drawImage(빛, nx - 8 - 빛.여, y - 2 - 빛.여, 빛.논리w, 빛.논리h);
        ctx.restore();
      }
      outl(name, nx, y, usable ? classCol : LOCK);   // 이름 중앙정렬(0x48513)
      var mp = String(MN.MP_TIER[row] | 0);
      outl(mp, mpcx - W(mp) / 2, y, usable ? WHITE : LOCK);   // MP 도 중앙정렬(원본 0x484F9 동일 폰트·정렬)
      /* ★ [리마스터 I-08] 이름 자리를 클릭 과녁으로 남긴다 — 글꼴 5×7 + 자간 1.
       *   위아래로 1px 씩 넓혀 행 간격(8) 을 꽉 채운다. */
      this.magicHit.push({ x: nx - 1, y: y - 1, w: W(name) + 2, h: DY,
                           spell: idx, elem: elem, row: row, rank: rank,
                           usable: usable, name: name });
    }
  }
  /* 유닛 현재 MP 총량 — 원본 0x4c7c3(마법 서브메뉴 그리기): 포맷 "MP %d" 를
   *   X = 유닛 화면X < 160 이면 194(오른쪽), 아니면 30(왼쪽) · Y = 0x60(96) 에
   *   **큰 글꼴 NEWASCII 8×16**(0x5E048→0x5dd5b, 스펠 이름/코스트의 작은 0x484F9 보다 큼)으로 그린다.
   *   유닛이 화면 왼쪽에 붙어 여백이 없으면 반대쪽(오른쪽)에 나온다. */
  var si = (this.center && this.center.x != null) ? this.center.x : 160;
  var mpStr = 'MP ' + (u.mp | 0), mpx = (si < 160) ? 194 : 30, mpy = 90;
  if (H.newhanLeft) H.newhanLeft(ctx, mpStr, mpx, mpy, 0x11, OUT);   // 큰 글꼴 + 외곽선(가독)
  else outl(mpStr, mpx, mpy + 6, CLASS[0]);                          // 폴백: 작은 글꼴
};

/** 현재 링 점 수에 맞춰 DOM 아이콘을 확보하고 프레임·자리·표시를 동기화한다. */
Ring.prototype._DOM그리기 = function (host) {
  var need = this.pts.length;
  while (host.childNodes.length < need) {
    var d = document.createElement('img');
    d.style.cssText = 'position:absolute;image-rendering:pixelated;';
    host.appendChild(d);
  }
  for (var i = 0; i < host.childNodes.length; i++) {
    var e = host.childNodes[i], p = this.pts[i];
    if (!p || p.off) { e.style.display = 'none'; continue; }
    var meta = this.frameMeta(this.menu, this.icons[i], this.frames[i] | 0);
    e.style.display = '';
    if (meta && meta.canvas) {                       // 원본 직독 — 한 번만 data-URL 로
      if (!meta.url) meta.url = meta.canvas.toDataURL();
      e.src = meta.url;
    } else e.src = this.base + (meta ? meta.png : '');
    e.style.left = p.sx + 'px';
    e.style.top = p.sy + 'px';
  }
};

/* ═══════════════════════════════════════════════ 7. 모듈 (단일 인스턴스) */

var THE = new Ring();

var G2Ring = {
  VERSION: '1.0 (COMBATII.EXE 대조)',
  Ring: Ring,
  Calc: Calc,
  /* 0x4BD80 공격 아이콘 판정 한 벌 — session._ringEnv 도 이것을 쓴다 (2026-10-11 · 두 벌이라 대포십자가 안 켜졌다) */
  adjacentEnemy: adjacentEnemy,

  /* 사양서에 적힌 6개 */
  open:     function (battle, unit, opts) { return THE.open(battle, unit, opts); },
  close:    function () { return THE.close(); },
  update:   function (dt) { return THE.update(dt); },
  draw:     function (t) { return THE.draw(t); },
  hitTest:  function (x, y) { return THE.hitTest(x, y); },
  /* AI 바(`0x4B71D`·`0x4B737`)가 링과 **같은 `.ICO`** 에서 아이콘을 꺼내 쓴다 */
  '아이콘그림': function (menu, icon, frame) { return THE['아이콘그림'](menu, icon, frame); },
  /* 0x4AC28 — 그 아이콘의 앵커(레코드 +0x0D = ax · +0x11 = ay) */
  '아이콘앵커': function (menu, icon, frame) {
    if (icon == null || (icon | 0) < 0) return null;
    var m = THE.frameMeta(menu, icon | 0, frame | 0);
    return m ? { ax: m.ax | 0, ay: m.ay | 0 } : null;
  },
  isOpen:   function () { return THE.isOpen(); },
  상태:     function () { return Object.freeze({
    열림: THE.isOpen(), 단계: THE.phase, 메뉴: THE.menu, 유닛: THE.unit || null,
    /* ★ 진단용 — 지금 링이 들고 있는 아이콘 번호들. 「빈 링」을 기계로 가른다 (2026-09-22) */
    아이콘: (THE.icons || []).slice(), 아이콘수: (THE.icons || []).length
  }); },
  자산:     function () { return THE.assets || null; },

  /* 부가 */
  load:     function (base, cb) { return THE.load(base, cb); },
  setAssets: function (j, base) { return THE.setAssets(j, base); },
  /* 할일 19 — 그림은 원본 `.ICO` 직독. `load()` **전에** useNativeIcons() 를 부르면
   * 추출 PNG 를 아예 읽지 않습니다. */
  useNativeIcons: function (on) { THE.nativeOnly = (on !== false); return THE.nativeOnly; },
  setNativeIcons: function (menu, frames, pal) { return THE.setNativeIcons(menu, frames, pal); },
  아이콘미루기: function (menu, frames, pal) { return THE.아이콘미루기(menu, frames, pal); },   /* 정본 400 — 날씨 바뀔 때 */
  nativeCount: function (menu) { return menu ? (THE.native[menu] | 0) : THE.native; },
  /* 아이콘 한 장 — `{w, h, ax, ay, canvas}`. 원본 `.ICO` 직독 결과 그대로라
   * 앵커(`ax`/`ay`)가 들어 있다. 링 밖에서도 쓴다 — 스테이터스 MORE 2페이지가
   * `0x4AC28` 과 같은 그림을 그려야 하기 때문이다(추출 PNG 를 쓰면 안 된다). */
  iconMeta: function (menu, icon, f) { return THE.frameMeta(menu, icon, f | 0); },
  ICON_FILE: { mainring: 'MAINRING.ICO', magic: 'MAGIC.ICO', skill: 'SKILL.ICO',
               special: 'SPECIAL.ICO', ai_ctrl: 'AI_CTRL.ICO' },
  move:     function (x, y) { return THE.move(x, y); },
  중심설정: function (x, y) { THE.center = { x: Math.round(x), y: Math.round(y) }; THE._배치갱신(); return THE; },
  항목설정: function (icons) { THE.icons = (icons || []).slice(); THE._프레임초기화(); THE._배치갱신(); return THE; },
  메뉴교체: function (menu, icons) { if (THE.isOpen()) THE._메뉴교체(menu, (icons || []).slice()); return THE; },
  모으고닫기: function () { return THE.모으고닫기(); },
  표시상태설정: function (목록만, 단계) { THE.목록만 = !!목록만; THE.단계 = 단계 | 0; return THE; },
  /* 링 캔버스 입력 경계 — 단일 인스턴스 `THE`를 바깥에 노출하지 않고 현재 항목만 읽는다. */
  아이콘: function (i) { return THE.icons[i | 0]; },
  /* 이지 마법 목록의 화면 좌표 판정도 링 소유 상태(`magicHit`) 안에서 수행한다. */
  마법목록누르기: function (x, y) { return THE.magicHitAt(x, y); },
  click:    function (x, y) { return THE.click(x, y); },
  /* [리마스터] 패드 — 아이콘 가운데 자리(논리)와 링 중심. 좌스틱 방향으로 가장 가까운 아이콘을 고르는 데 쓴다 (pad_input.js · 설계서 6절 ②) */
  패드자리: function () {
    return { 중심: { x: THE.center.x, y: THE.center.y }, 가리킴: THE.hover, 패드: !!THE.패드표시 && THE.phase === 'idle',
             아이콘: (THE.pts || []).map(function (p, i) { return { i: i, x: THE.center.x + p.dx, y: THE.center.y + p.dy, 숨음: !!p.off }; }) };
  },
  /* [리마스터] 패드 — 그 아이콘을 가리킨 것으로(마우스 hitTest 와 같은 프레임 리셋 0x4AD1A) · −1 = 가운데(아무 아이콘도 안 올림) */
  패드가리킴: function (i) {
    i = (i == null) ? -1 : (i | 0);
    THE.패드표시 = true;
    if (!THE.opened || THE.phase !== 'idle' || THE.hover === i) return;
    if (THE.hover >= 0) THE.frames[THE.hover] = 0;
    if (i >= 0) THE.frames[i] = 0;
    THE.hover = i; THE._배치갱신();
  },
  패드표시: function (on) { THE.패드표시 = !!on; },
  /* [리마스터 룬안내] 지금까지 고른 룬(세션 magicPicks)을 알려 주는 함수 — battle_main 이 건다 */
  룬고름공급: function (fn) { THE.룬고름 = fn; },
  /* [리마스터] 패드 — 마법 목록(이지 마법) 칸들 · 가리킨 칸 번호(−1 = 없음) · 링을 숨긴 «목록만»인가 */
  마법목록: function () { return (THE.magicHit || []).slice(); },
  패드목록: function (i) { THE.패드목록 = (i == null) ? -1 : (i | 0); },
  목록만: function () { return !!THE.목록만; },
  cancel:   function () { return THE.cancel(); },

  /* 메뉴 구성 (순수 함수 — Node 로 검증할 수 있습니다) */
  buildMain: buildMain, buildSpecial: buildSpecial, buildMagic: buildMagic,
  buildSkill: buildSkill, buildAi: buildAi, magicNumber: magicNumber,
  magicClassOf: magicClassOf, magicGate: magicGate, specialGate: specialGate, MAGIC_MSG: MAGIC_MSG,
  spellList: spellList,                       // ★ [리마스터 I-08] 이지 모드 목록
  magicRelation: magicRelation, magicIsHeal: magicIsHeal,
  buildAiGroup: buildAiGroup, aiApply: aiApply, aiSummary: aiSummary,
  AI_GROUP: AI_GROUP,
  mainCommand: mainCommand,
  MAIN: MAIN, MAIN_NAME: MAIN_NAME, SKILL_ICON: SKILL_ICON,
  skillNoFromIcon: skillNoFromIcon, WEAPON_GROUP: WEAPON_GROUP,

  /* (나) 번호 체계 */
  specialPick: specialPick, specialIcon: specialIcon,
  aiSpecialFromPick: aiSpecialFromPick,
  aiSpecialIconOf: aiSpecialIconOf, aiSpecialGroupOf: aiSpecialGroupOf,
  AI_SPECIAL_AUTO: AI_SPECIAL_AUTO,
  AI_SPECIAL_ULT: AI_SPECIAL_ULT
};

root.G2Ring = G2Ring;
if (typeof module !== 'undefined' && module.exports) module.exports = G2Ring;

})(typeof globalThis !== 'undefined' ? globalThis : this);
