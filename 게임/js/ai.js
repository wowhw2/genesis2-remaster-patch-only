/* ============================================================================
 * 창세기전 2 — 적 AI (COMBATII.EXE 0x3B000 ~ 0x44999 대조)
 *
 *   0x44913  유닛 한 기의 턴 전체
 *   0x41515  도주·회복 판단      (성향표 0x3C97B)
 *   0x3F321  이번 행동은 통상 / 필살기 / 마법 중 무엇인가   ← **20주기 셔플백**
 *   0x40295  일반 유닛 행동 루프 · 0x4016A 근접 1스텝
 *   0x40279  목표 선정 모드 점프표 ([+0x6C] 0~6)
 *   0x3CA3C  공격 위치·방향 탐색
 *   0x3D3E5  모드 3 의 위치 점수  ← 3000 − (300 − 유효방어력) × 상성 − 남은이동력/2
 *   0x3EF12  도주 칸 찾기 (모드 5)
 *   0x3E739  안전 접근 (모드 1)
 *   0x3EE2B  제자리에서 방향만 (모드 6)
 *   0x3FFD4  필살기 (차징 [+0x57]·[+0x81])   ·  0x432A0 마법 (차징 [+0x7F])
 *   0x3F415  턴 마무리 — 남은 TP 로 방어(60)·회피(40) 자세
 *
 * ── 원본과 일부러 다르게 한 곳 ─────────────────────────────────────────
 *
 * ① **AI 필살기 지정은 슬롯 번호**로 다룹니다.
 *    원본은 `0x4D39B` 이 링 메뉴의 **아이콘 번호**를 변환 없이 `[+0x82]` 에 넣어
 *    소비 쪽(`0x3F9AD`, 슬롯 기준)과 한 칸 어긋났습니다(필살기번호_버그.md).
 *    소비·표시·SCE 로더 셋이 전부 슬롯 기준이므로 이 엔진은 슬롯으로 통일합니다.
 *    (변환은 `G2Ring.aiSpecialFromPick()` 한 곳에서만 합니다.)
 *
 * ② **확률 판정을 20주기 셔플백으로 통일**했습니다.
 *    원본은 행동 종류(`0x3F321`)만 순열표 `0x74144` 를 쓰고, 필살기 조건 함수
 *    (`0x3F516`·`0x3F6C1`·`0x3F797`·`0x3F7F3`)는 `rand(100)`·`rand(3)` 을 씁니다.
 *    과제 요구가 "확률은 난수가 아니라 20주기 셔플백" 이므로 조건 함수들도 같은
 *    셔플백을 쓰게 했습니다. 원본 그대로 굴리려면 `act(…, {useRand: true})`.
 *
 * ── 아직 못 옮긴 것 ────────────────────────────────────────────────────
 *   ☐ `0x3D7B2`(1929B, 접근 비용) **내부** — 과제 지시대로 지금은
 *      **맨해튼 거리 + 궁수(wt 5) 는 `+= 90 − 거리`** 로 대신합니다(0x3CD…).
 *      ★ 2026-08-29 — 뼈대만 읽었습니다(내부가 커서 전부는 아직):
 *      ```asm
 *      0x3D7C6  call 0x1A31D
 *      0x3D7CD  edx = [esi+1] · eax = [esi] · call 0x11EE4   ; 타일 좌표
 *      0x3D7DB  call 0x174CF · bl = al                        ; 유닛 갈래
 *      0x3D80C  cmp bl, 3                                     ; 갈래 3 을 가른다
 *      0x3DAA7  cmp [esp+0x14], 4
 *      0x3DAC6  cmp di, 0x7FFF                                ; ★ **도달 불가**
 *      0x3DACD  cmp [esp+0x28], 5
 *      ```
 *      ⇒ `0x7FFF` 를 「갈 수 없음」으로 쓰는 구조입니다(우리 무한대와 같은 자리).
 *      ☐ 점수식 전체는 아직 — 값을 옮기지 않습니다.
 *   ★★★ **2026-08-29 — 분기표는 확정했다** (`0x3F995` 여섯 칸 · 아래 §chooseSpecial).
 *      무기마다 다른 플래그 칸 `+0x38`~`+0x3C` 를 본다.
 *      ☐ 남은 것은 **각 갈래 안의 조건 순서**뿐이다(검 계열은 확정).
 *   ★★★ **2026-08-29** — `0x3CA3C`~`0x3D200` 에는 wt `0x0B` 을 견주는 명령이
 *      **하나도 없다**(`83 f8/f9/fa 0b`·`3c 0b`·`80 f8/fa 0b` 전수).
 *      사거리 모양은 AI 가 아니라 **`combat.js` 의 `attackCells` 쪽**에 있다 —
 *      `0x1D385 cmp bl, 0x0B / jne` → `0x1D387 mov cl, 9` · 아니면 `mov cl, 7`.
 *      곧 **`wt == 0x0B` 이면 반경 9, 그 밖은 7** 이다.
 *      ☐ 어떤 wt 가 이 갈래로 오는지는 `0x1D327` 앞 분기를 더 봐야 한다.
 *   ★★★★★ **2026-08-29 확정** — `[+0x43]` 은 **매력**이다.
 *      `state.js` §능력치에 `0x182C4 [+0x43]` 매력 · `0x182BB [+0x42]` 민첩으로
 *      이미 적혀 있었다. 「권위 칸으로 봅니다」는 추측이었고 맞지 않았다.
 *
 * 쓰는 법
 *   <script src="rules.js"></script> <script src="state.js"></script>
 *   <script src="move.js"></script>  <script src="combat.js"></script>
 *   <script src="ai.js"></script>                     →  window.G2AI
 * ==========================================================================*/
(function (root) {
'use strict';

function isCommandRestricted(u) { var Ru = root.Rules; if (!Ru && typeof require === 'function') { try { Ru = require('./rules.js').Rules; } catch (e) {} } if (!Ru || !Ru.isCommandRestricted) throw new Error('Rules.isCommandRestricted가 필요하다'); return Ru.isCommandRestricted(u); }

function R() { return root.Rules; }
function C() { return root.G2Combat; }
function M() { return root.G2Move; }
function idiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

var DIR = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }];
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/* ══════════════════════════════════════════ 0. 20주기 셔플백 (0x74144) */

/**
 * 0x3F3A3 — 유닛마다 순열표 `0x74144` 의 행 하나를 뽑아 열을 순환합니다.
 * 각 행이 1~20 의 서로 다른 순열이라 "20번에 정확히 이 비율" 이 보장됩니다.
 * 원본 레코드의 [+0x29](행) · [+0x2A](열) 자리입니다.
 */
function bag(battle, u) {
  if (!battle.aiBags) battle.aiBags = {};
  var k = (u.id != null ? u.id : u.name);
  return battle.aiBags[k] || (battle.aiBags[k] = { row: 0, pos: 0 });
}
/** 1~20 을 하나 뽑습니다. */
function draw(battle, u, rng) {
  var b = bag(battle, u), T = battle.T;
  if (b.pos === 0) b.row = (rng ? rng(12) : 0);            // 0x3F3A3  if [+0x2A]==0
  /* ★ 순번을 «먼저» 올리고 그 칸을 읽는다 — 0x3F3B2 inc · 0x3F3C2 [+0x2A]=새 값 · 0x3F3D3 dl=[+0x2A] · 0x3F3D6 읽기
   *   ☠ 전에는 올리기 전 칸을 읽어 원본보다 한 칸씩 앞섰다 (2026-09-29) */
  b.pos = (b.pos + 1) % 20;                                // 0x3F3B0
  var v = T['크리티컬순열표'][b.row][b.pos] | 0;           // 0x74144
  return v;
}
/** 백분율 확률을 셔플백으로 판정 (1~20 → 5 % 단위). opts.useRand 면 원본 rand(100). */
function chance(battle, u, pct, opts) {
  if (opts && opts.useRand) return (opts.rng ? opts.rng(100) : 0) < pct;
  return draw(battle, u, opts && opts.rng) * 5 <= pct;
}

/* ══════════════════════════════════════════ 1. 성향 · 상태 조회 */

function ai(u) { return u.ai || (u.ai = { mode: 0, atkTend: 0, fleeTend: 0, special: 0xFF, magic: 0xFF }); }

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **AI 목표** `[+0x6F ~ +0x73]` — 창구 하나 (2026-08-27 · 사용자 ③)
 *
 *   > 사용자 ②결과피드백: 「**1-5 이벤트도 순서 잘못되었어.** …
 *   >  **AI상태에서 마크가 이동하고** 그 이후 이벤트 대사 뜨고 적군 등장」
 *
 *   ── 무엇이 없었나 ────────────────────────────────────────────────
 *   `ai.js` 에 **AI 목표 좌표가 통째로 없었다.** `sceapply.js` 가 `op 0x6F` 로
 *   목표를 **설정**만 하고, AI 는 그것을 **한 번도 읽지 않았다.**
 *   그래서 `1-5` 의 마크(목표 `[57,52,255,0,0]`)가 §0 이벤트 이동이 끝난 자리에
 *   **가만히 서 있었고**, §2 구역 (55,49)~(60,54) 안으로 걸어 들어가는 일이
 *   없어 암흑살수 등장이 **영영 안 걸리거나**, 반대로 이벤트 이동 직후
 *   `wait` 스텝에서 S2 가 돌아 **너무 일찍** 걸렸다.
 *
 *   ── 표현이 둘로 갈라져 있었다 (창구 일원화) ──────────────────────
 *     · `.SCE` 배치에서 온 것 → `u.AI목표` **배열** `[+0x6F..+0x73]` (`sce.js:128`)
 *     · `op 0x6F` 로 설정한 것 → `u.AI목표x` / `u.AI목표y` / `u.AI목표유닛` (`sceapply.js:675`)
 *   ⇒ **읽는 창구를 하나로 둔다.** 쓰는 쪽은 어느 모양이어도 된다.
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * ★ AI 목표를 **한 모양으로** 읽는다 — `[+0x6F]`·`[+0x70]`·`[+0x71]`·`[+0x73]`
 * @returns {{x:number, y:number, 유닛:object|null}} `x` 가 `0xFF` 면 좌표 목표 없음
 */
function AI목표읽기(u) {
  if (!u) return { x: 0xFF, y: 0xFF, 유닛: null, 유닛id: 0xFF, 유닛코드: 0 };
  var a = u.ai || {};
  /* ① `op 0x6F`(`sceapply.js AI목표()`)가 덮어쓴 값이 **가장 최신**이다 */
  if (u.AI목표유닛) return { x: 0xFF, y: 0xFF, 유닛: u.AI목표유닛, 유닛id: 0xFF, 유닛코드: 0 };
  if (u.AI목표x != null && u.AI목표y != null)
    return { x: u.AI목표x & 0xFF, y: u.AI목표y & 0xFF, 유닛: null, 유닛id: 0xFF, 유닛코드: 0 };
  /* ② `.SCE` 배치에서 온 것 — `state.js` 가 `ai.목표x/목표y/목표유닛id` 로 옮겨 둔다 */
  return { x: (a.목표x == null) ? 0xFF : (a.목표x & 0xFF),
           y: (a.목표y == null) ? 0xFF : (a.목표y & 0xFF),
           유닛: null,
           유닛id: (a.목표유닛id == null) ? 0xFF : (a.목표유닛id & 0xFF),
           유닛코드: (a._목표raw && a._목표raw.length > 3) ? (a._목표raw[3] & 0xFF) : 0 };   /* [+0x72] 캐릭터 코드 */
}

/**
 * ★★★ **목표 상태** — 원본 `0x3E18B` 를 **그대로** 옮겼다
 *   (`AI대역_분석.md` §「`0x3E18B` — 목표 상태」):
 *
 *   ```
 *   [+0x71] != 0xFF  → 0x1379A 로 유닛 찾음; 거리 > 1 이면 1(추격), 아니면 -1
 *   [+0x71] == 0xFF 이고 [+0x73] != 0 → 같은 판정
 *   그 밖: [+0x6F] == 0xFF                    → 0  (목표 없음)
 *          내 x == [+0x6F] 또는 내 y == [+0x70] → -1
 *          그 밖                               → 2  (좌표 목표로 이동)
 *   ```
 *
 *   ★ 「x 또는 y **한 축만** 같아도 −1(도착)」은 **원본 그대로다.**
 *     문서도 「좌표 목표를 세운 유닛이 같은 행·열에만 들어서면 멈추는 원인」이라
 *     적어 뒀다. 편의로 고치지 않는다.
 *
 * @returns {number} 1 유닛 추격 · 2 좌표 목표 · -1 도착 · 0 목표 없음
 */
/** `0x1379A` — **진영 목록 `[+0x71]`** 안에서 **캐릭터 코드 `[+0x72]`** 인 유닛. 없으면 `null`.
 *   0x1379B eax = [목록번호×8 + 0xCC960] (진영 목록 머리) → 0x137A6 cmp dl,[유닛+0x0F] → 0x137AB [+0x7B] 다음
 *   ☠ 전에는 «코드 == 목록번호 또는 순번 == 목록번호»로 찾아 엉뚱한 유닛을 잡았다 — 원본 .SCE 49 유닛이 [1, 18] = «아군 목록의 GS» 꼴
 *     (2026-10-08 · 원본 TESTWW 메모리 실측: 목록 1 = 아군 · 2·3·4 = 진영 2·3·4 · 목록 0 은 빔)
 *   ★ 목록에는 살아 있는 것만 있다(죽으면 빠진다). */
function AI목표유닛찾기(battle, id, 코드) {
  if (id == null || (id | 0) === 0xFF) return null;
  var us = (battle && battle.units) || [];
  for (var i = 0; i < us.length; i++) {
    var t = us[i];
    if (t && t.alive && (t.side | 0) === (id | 0) && (t.charCode | 0) === ((코드 | 0) & 0xFF)) return t;
  }
  return null;
}
function 목표상태(battle, u) {
  var g = AI목표읽기(u);
  /* `0x3E190` — `[+0x71]`(유닛 식별자)이 `0xFF` 가 아니거나 `[+0x73]`(포인터)이 있으면 유닛 목표 */
  /* ★ 0x3E196 — [+0x71] != 0xFF 면 0x1379A 로 찾고 **못 찾으면 −1**(0x3E1A9 je 0x3E1C8) · 좌표 판정으로 안 내려간다 (2026-10-08) */
  if ((g.유닛id | 0) !== 0xFF && !g.유닛) {
    var tf = AI목표유닛찾기(battle, g.유닛id, g.유닛코드);
    return (tf && dist(u, tf) > 1) ? 1 : -1;
  }
  var t = g.유닛;
  if (t) {
    if (!t.alive) return 0;
    return (dist(u, t) > 1) ? 1 : -1;          /* 거리 > 1 이면 추격, 아니면 도착 */
  }
  if ((g.x | 0) === 0xFF) return 0;            /* 0x3E1EE — 목표 없음 */
  /* ★ 「x 또는 y **한 축만** 같아도 −1(도착)」 — 원본 그대로다 */
  if ((u.x | 0) === (g.x | 0) || (u.y | 0) === (g.y | 0)) return -1;
  return 2;                                    /* 좌표 목표로 이동 */
}

function wtOf(battle, u) { return C().weaponTypeOf(battle, u); }
function effOf(battle, u) { return C().eff(battle, u); }
/** 최대 TP `[+0x54]` — **정본은 `state.js maxTpOf`** (4단계 ③).
 *   ★ **부르는 순간** 찾는다 — 로드 순서에 안 기댄다 (2-7 원칙). 없으면 던진다. */
function maxTpOf(u) {
  var S = root.G2State || (typeof require === 'function' ? (function () {
    try { return require('./state.js').G2State || require('./state.js'); } catch (e) { return null; }
  })() : null);
  if (!S || typeof S.maxTpOf !== 'function') {
    throw new Error('ai.maxTpOf: G2State.maxTpOf 가 없다 — state.js 를 먼저 실어야 한다');
  }
  return S.maxTpOf(u);
}
function hostile(battle, a, b) { return C().hostile(a.side, b.side, battle.confuse); }

function enemiesOf(battle, u) {
  return battle.units.filter(function (t) { return t.alive && t !== u && hostile(battle, u, t); });
}
function alliesOf(battle, u) {
  return battle.units.filter(function (t) { return t.alive && t !== u && !hostile(battle, u, t); });
}

/** 이동 칸 수 — 0x402FC `n = (TP − 10) / 10`. */
function moveSteps(u) { return idiv((u.tp | 0) - 10, 10); }

/** 통상 공격이 닿는 최대 거리(칸). 0x1D124 의 모양에서 뽑아 씁니다. */
/**
 * ★★★★★ **실제 사거리를 쓴다** — `combat.js` 와 갈라지면 AI 가 못 치는 자리에 선다
 *   (2026-08-26 · 사용자 「데미지가 제대로 안들어가」)
 *
 *   전에는 `wt 5` 를 **원작식(`0x15`·`0x16` 만 5, 그 밖 7)** 으로 **고정**해
 *   리마스터 궁사거리 토글을 안 봤다. 그래서 —
 *     `ai.js attackReach`  킬러 → **7**
 *     `combat.js bowRange` 킬러 → **5** (리마스터 `BOW_R`)
 *   AI 는 「거리 7 까지 닿는다」고 믿는데 실제 `attackCells` 는 5 까지뿐이라
 *   **공격이 「사거리 밖」으로 실패**했다.
 *   전문: `03_분석/COMBATII/AI_원거리_사거리불일치.md`
 */
function attackReach(battle, u) {
  var wt = wtOf(battle, u), j = u.job | 0;
  if (wt <= 2) return 1;
  if (wt === 3) return 2;
  if (wt === 4) return 1;
  /* ★ `combat.js` 의 실제 값을 그대로 쓴다 — 토글이 자동 반영된다 */
  if (wt === 5) {
    var Cb2 = C();
    if (Cb2 && Cb2.bowRange) return Cb2.bowRange(j) | 0;
    return (j === 0x15 || j === 0x16) ? 5 : 7;          /* 0x1AF01 / 0x1AF08 */
  }
  if (wt === 0xB) return 9;
  if (wt === 0xC) return 7;
  if (wt === 8 || wt === 0xD) return 3;
  return 2;
}

/* ══════════════════════════════════════════ 2. 행동 종류 (0x3F321) */

/**
 * 0 통상 · 1 필살기 · 2 마법 · −1 아무것도 안 함.
 * ```
 * [0xBA84E] >= 4            → 0
 * [+0x81] != 0 (필살기 차징) → 1        [+0x7F] != 0 (마법 차징) → 2
 * [+0x82] != 0xFF, HP>1000  → 1        [+0x80] != 0xFF          → 2
 * [+0x6D] == 4 → −1   ·  == 0 → 0   ·  스프라이트>=300·탈것 → 0
 * r = 셔플백(1~20)
 *   [+0x6D]==1 : r <= 11 → 0, 아니면 1
 *   [+0x6D]==2 : r <= 5 → 1, r <= 13 → 2, 아니면 0
 * ```
 */
function decideAction(battle, u, opts) {
  opts = opts || {};
  var a = ai(u);
  if ((battle.battleKind | 0) >= 4) return 0;                       // 0x3F326
  if ((u.reserveSpecial | 0) !== 0) return 1;                       // 0x3F333
  if ((u.reserveSpell | 0) !== 0) return 2;                         // 0x3F345
  if ((a.special & 0xFF) !== 0xFF && (u.hp | 0) > 1000) return 1;    // 0x3F354
  /* [리마스터] 정본 446 — 지정 마법이 MP 가 모자라면 «마법»을 고르지 않고 아래 성향대로 — 원본은 늘 2 → 9번 시도 실패 → −1(이동만)이라
   *   MP 를 다 쓴 뒤로는 공격도 안 하고 걷기만 했다 (사장님 11-24 «어절트발탄으로 마법 사용 ai지정한 상태에서 mp를 모두 사용하면 아무행동도 안해»)
   *   자동 고르기(chooseSpell 0x42DFD)는 원래 MP 를 본다 */
  var 지정MP부족 = false;
  if ((a.magic & 0xFF) !== 0xFF) { try { 지정MP부족 = (u.mp | 0) < (R().spellMp(C().spellParts((a.magic & 0xFF) * 3).level, battle.T) | 0); } catch (e) { } }
  if ((a.magic & 0xFF) !== 0xFF && !지정MP부족) return 2;                          // 0x3F366
  if ((a.atkTend | 0) === 4) return -1;                             // 0x3F36F
  if ((a.atkTend | 0) === 0) return 0;                              // 0x3F37F
  if (isCommandRestricted(u) || ((u.gear || {}).mount | 0) > 0) return 0;   // 0x3F387
  var r = draw(battle, u, opts.rng);
  if ((a.atkTend | 0) === 1) return (r <= 11) ? 0 : 1;
  if ((a.atkTend | 0) === 2) return (r <= 5) ? 1 : (r <= 13 ? 2 : 0);
  return 0;
}

/* ══════════════════════════════════════════ 3. 도주 (0x41515 · 0x3EF12) */

/** 0x3C97B — 후퇴 성향표 (검토 시작선, 강제 도주선). 4 = 도주 안 함. */
var FLEE_TABLE = [[50, 30], [80, 50], [30, 30], [100, 80]];

/** 0x167C9 — 위험도 = 10 + 30 × (반경 1 안의 적 수). */
function danger(battle, u, x, y) {
  var n = 0;
  for (var d = 0; d < 4; d++) {
    var t = battle.at((x != null ? x : u.x) + DIR[d].dx, (y != null ? y : u.y) + DIR[d].dy);
    if (t && t.alive && hostile(battle, u, t)) n++;
  }
  return 10 + 30 * n;
}

/**
 * 0x41515 — 도주·회복 판단.
 * @returns {null|{mode:'forced'|'maybe', hpPct, cell, danger}}  null = 도주 안 함
 */
function flee(battle, u, opts) {
  opts = opts || {};
  var a = ai(u);
  if (isCommandRestricted(u)) return null;                       // 0x4152B
  if ((a.fleeTend | 0) === 4) return null;                          // 0x4153A
  var row = FLEE_TABLE[clamp(a.fleeTend | 0, 0, 3)];
  var pct = idiv(u.hp | 0, Math.max(1, idiv(u.maxHp | 0, 100)));    // 0x41540
  if (pct > row[0]) return null;                                    // 0x41568
  var mode = (pct <= row[1]) ? 'forced' : 'maybe';                  // 0x41581
  var cell = fleeCell(battle, u, opts);
  return { mode: mode, hpPct: pct, cell: cell, danger: danger(battle, u) };
}

/**
 * 0x3EF12 — 도주할 칸.
 *   ① 반경 max(이동칸수, 3) 안의 적을 모읍니다. 없으면 −1
 *   ② 적 중심 반경 4 를 이동배열에서 막습니다
 *   ③ 자기 이동 범위에서 이동배열 값(= 남은 이동력)이 가장 큰 칸
 *   ④ 0x165C2 로 설 수 있는지 확인
 */
function fleeCell(battle, u, opts) {
  var Mv = M(); if (!Mv) return null;
  var reach = Math.max(moveSteps(u), 3);
  var foes = enemiesOf(battle, u).filter(function (t) { return dist(t, u) <= reach + 4; });
  if (!foes.length) return null;                                    // 0x3E3BF → −1
  var Rg = (opts && opts.range) || Mv.range(battle, u, { tp: u.tp | 0 });
  var best = null;
  for (var i = 0; i < Rg.cells.length; i++) {
    var c = Rg.cells[i];
    if (!c.stop) continue;                                          // 0x165C2
    var near = 99;
    for (var k = 0; k < foes.length; k++) near = Math.min(near, dist(c, foes[k]));
    if (near <= 4) continue;                                        // ② 반경 4 차단
    if (!best || c.left > best.left || (c.left === best.left && near > best.near))
      best = { x: c.x, y: c.y, left: c.left, near: near, cost: c.cost, tp: c.tp };
  }
  return best;
}

/* ══════════════════════════════════════════ 4. 위치·방향 점수 (0x3CA3C · 0x3D3E5) */

/**
 * 0x3D4C5~0x3D52A — **유효 방어력**.
 *   접근 방향 == 대상이 보는 방향  → 방어력 × 1     (정면)
 *   두 방향의 합이 홀수            → 방어력 × 3/4   (측면)
 *   그 밖(정반대)                  → 방어력 × 1/2   (배후)
 */
function effectiveDef(defRaw, approachDir, targetDir) {
  if (approachDir === targetDir) return defRaw | 0;                 // 0x3D4D5
  if (((approachDir + targetDir) & 1) !== 0)                        // 0x3D4F4  test al,1
    return (defRaw | 0) - idiv(defRaw | 0, 4);                      // × 3/4
  return (defRaw | 0) >> 1;                                         // 0x3D514  sar 1
}

/**
 * 0x3D517~0x3D5C1 — 위치 점수.
 * ```
 * 점수 = 3000 − (300 − 유효방어력) × 상성(×10) − 그칸_남은이동력 / 2
 * ```
 * 모드 3 은 이 값을 **최소화**합니다(= 때리기 좋은 자리).
 */
function positionScore(effDef, affinity10, cellLeft) {
  var s = 3000 - (300 - (effDef | 0)) * (affinity10 | 0);           // 0x3D517 · 0x3D525
  s -= (cellLeft | 0) >> 1;                                         // 0x3D5BF  sar eax,1 / sub
  return s;
}

/** 접근 비용 — 맨해튼 거리. 궁수(wt 5)는 `+= 90 − 거리` (0x3CDD4). */
function approachCost(battle, u, fromX, fromY, target) {
  var d = Math.abs(fromX - target.x) + Math.abs(fromY - target.y);
  var cost = d;
  if (wtOf(battle, u) === 5) cost += 90 - d;                        // 0x3CDD4
  return cost;
}

/** 대상에 대한 상성(×10). 무속성 공격이면 10(= 100 %). */
function affinityTo(battle, u, target) {
  var Ru = R(), Cb = C();
  var attr = Cb.attackAttr(battle, u);                              // 0x17531 + 0x1DA3F
  if (attr < 0) return 10;
  return Ru.affinity(Cb.view(battle, target), attr, battle.T) | 0;  // 0x1762C
}

/**
 * 0x3D3E5 — **모드 3 설 자리** (2026-10-02 어셈블리 한 줄씩 · 0x3D3E5~0x3D7AD)
 *   부르는 곳: 0x3E5AB(유닛 목표 · 무기 < 6 이고 모드 [+0x6C] == 3 일 때만 · 0x3E5D6~0x3E5E0) · 0x3EBB4(모드 3 · 무기 < 6)
 *   ① 0x11EE4 나를 맵에서 빼고 0x13D02 제 칸 = 예산 + 1 · 0x1A2D7 대상 칸 높이층을 기준으로
 *   ② 저항 = 0x1762C(대상, 0x17531 내 공격 속성) · 속성 없으면 10 (0x3D45A)
 *   ③ 대상의 네 방향 d(0~3)마다 0x49ABC 로 대상 옆 칸을 잡고
 *      유효방어력 = [+0x46] — 대상이 d 쪽을 보면 그대로(0x3D4D5) · (d + 대상방향) 홀수면 ×3/4 · 그 밖 ×1/2
 *      바탕 = 3000 − (300 − 유효방어력) × 저항 (0x3D517~0x3D52A)
 *      무기 0~3 (0x3D549): 0x1A452 줄(그 칸에서 d 쪽으로 · 창(3)이면 2칸 아니면 1칸)
 *         같은 높이층이 아니면 «그 방향을 그만둔다»(0x3D59D je 0x3D681) · 0x13CBD < 0 이면 다음 칸
 *         점수 = 바탕 − 이동값/2 · 엄격히 작을 때만(0x3D5C8 jge) · 0x165C2(칸, 방향 d) 로 설 수 있어야
 *      무기 4 (0x3D613): 옆 칸 하나 · 이동값 < 0 이면 다음 방향 · 엄격히 작을 때만 · 0x11DB2 그 칸에 유닛이 없어야
 *      무기 5 (0x3D6E8): 방향마다 부채꼴 고르기(활자리 '방향마다') · 값 −1 이면 없음 · 점수 = 바탕 − 값/2 · 엄격히 작을 때만
 *      무기 6 이상: 갈래 없음(0x3D536 ja → 다음 방향)
 *   ④ 찾았으면 방향 = (d + 2) % 4 (0x3D6C0~0x3D6D3) · 못 찾으면 0x7FFF → null
 *   ☠ 원본은 대상이 d 를 «보고 있으면» 정면이다 — choosePosition 의 score3 는 내가 보는 방향을 넘겨 앞뒤가 뒤집힌다(그 갈래는 따로 적어 둠).
 * @returns {null|{x,y,dir,score}}
 */
function 모드3자리(battle, u, target, Rg) {
  var Mv = M(); if (!Mv || !target) return null;
  var wt = wtOf(battle, u);
  if (wt > 5) return null;                                            /* 0x3D536 ja */
  var 저항 = affinityTo(battle, u, target);                           /* 0x17531 · 0x1762C · 없으면 10 */
  var defRaw = effOf(battle, target).def | 0;                         /* [+0x46] */
  var tdir = target.dir | 0;                                          /* [+0x63] */
  var 바탕들 = [0, 1, 2, 3].map(function (d) {
    var 유효 = (tdir === d) ? defRaw : ((((d + tdir) & 1) !== 0) ? defRaw - idiv(defRaw, 4) : (defRaw >> 1));
    return 3000 - (300 - 유효) * 저항;
  });
  var best = 0x7FFF, 고른 = null;
  if (wt === 5) {
    var 방들 = 활자리(battle, u, target, Rg, '방향마다') || [];
    방들.forEach(function (r) {
      if (r.값 === -1) return;                                         /* 0x3D779 */
      var sc = 바탕들[r.d] - (r.값 >> 1);                              /* 0x3D782 sar 1 */
      if (sc >= best) return;                                          /* 0x3D790 jge */
      best = sc; 고른 = { x: r.x, y: r.y, d: r.d };
    });
  } else {
    var W = battle.W | 0, H = battle.H | 0;
    var 배 = new Int16Array(W * H);
    for (var k0 = 0; k0 < 배.length; k0++) 배[k0] = -1;
    (Rg.cells || []).forEach(function (c) { if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) 배[c.y * W + c.x] = c.left | 0; });
    battle.units.forEach(function (t) {                                /* 0x1419C 적대 유닛 칸 −(진영+1) */
      if (!t.alive || t === u || !hostile(battle, u, t)) return;
      var cs = battle.cellsOf ? battle.cellsOf(t, t.x, t.y, t.dir) : [[t.x, t.y]];
      cs.forEach(function (c) { if (c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H) 배[c[1] * W + c[0]] = -((t.side | 0) + 1); });
    });
    var ox = u.x | 0, oy = u.y | 0, od = u.dir | 0;
    if (ox >= 0 && oy >= 0 && ox < W && oy < H) 배[oy * W + ox] = (Rg.budget | 0) + 1;   /* 0x3D412~0x3D422 */
    var 읽 = function (x, y) { return (x >= 0 && y >= 0 && x < W && y < H) ? 배[y * W + x] : -128; };   /* 0x13CBD */
    var R배 = { W: W, H: H, left: 배 };
    var 격자 = !!(battle.unplace && battle.place && battle.at && battle.at(ox, oy) === u);
    if (격자) battle.unplace(u);                                       /* 0x3D40D 0x11EE4 */
    try {
      for (var d = 0; d < 4; d++) {                                    /* 0x3D681~0x3D68F */
        var sx = (target.x | 0) + DIR[d].dx, sy = (target.y | 0) + DIR[d].dy;   /* 0x3D4C0 0x49ABC */
        var 바탕 = 바탕들[d];
        if (wt === 4) {                                                /* 0x3D613 */
          var l4 = 읽(sx, sy);
          if (l4 < 0) continue;
          var s4 = 바탕 - (l4 >> 1);
          if (s4 >= best) continue;
          if (battle.at && battle.at(sx, sy)) continue;                /* 0x3D652 0x11DB2 */
          best = s4; 고른 = { x: sx, y: sy, d: d };
          continue;
        }
        var 길이 = (wt === 3) ? 2 : 1;                                 /* 0x3D49A sete · 0x3D557 inc */
        for (var st = 0; st < 길이; st++) {                            /* 0x3D56C 0x1A452 · 0x3D579 0x1A552 */
          var x = sx + DIR[d].dx * st, y = sy + DIR[d].dy * st;
          if (!같은층(battle, x, y, target.x | 0, target.y | 0)) break;   /* 0x3D59D je 0x3D681 */
          var lv = 읽(x, y);
          if (lv < 0) continue;                                        /* 0x3D5B9 jl */
          var sc2 = 바탕 - (lv >> 1);
          if (sc2 >= best) continue;                                   /* 0x3D5C8 jge */
          if (Mv.canStand && !Mv.canStand(battle, u, x, y, d, R배)) continue;   /* 0x3D5E1 0x165C2(방향 d) */
          best = sc2; 고른 = { x: x, y: y, d: d };
        }
      }
    } finally { if (격자) battle.place(u, ox, oy, od); }               /* 0x3D69E 0x11E04 */
  }
  if (!고른 || best === 0x7FFF) return null;                           /* 0x3D6B7 */
  return { x: 고른.x, y: 고른.y, dir: (고른.d + 2) & 3, score: best };   /* 0x3D6C0~0x3D6D3 */
}

/**
 * 0x3CA3C — **설 자리와 방향**.
 *   ① 자기를 맵에서 잠깐 빼고, 자기 칸에도 (예산 + 1) 을 넣어 "제자리"를 후보로 둡니다
 *   ② 근접(wt <= 4)은 대상에 붙는 네 칸, 원거리(wt 5·0xB·0xC)는 사거리 안의 모든 칸
 *   ③ 방향 = 대상을 바라보는 쪽 ((찾은 방향 + 2) % 4)
 *   ④ 이미 그 방향을 보고 있으면 점수 −4 (원본은 +4 지만 여기 점수는 작을수록 좋음)
 * @returns {null|{x,y,dir,score,cost,left,reachable}}
 */
function choosePosition(battle, u, target, opts) {
  opts = opts || {};
  var Mv = M(); if (!Mv || !target) return null;
  var Rg = opts.range || Mv.range(battle, u, { tp: u.tp | 0 });
  var reach = attackReach(battle, u);
  var wt = wtOf(battle, u);
  var defRaw = effOf(battle, target).def;
  var aff = affinityTo(battle, u, target);

  /* ★ 무기 5(활)는 0x3CA3C 활 갈래 — 지형 높이 가림(0x1C685)까지 원본대로 (2026-09-29) */
  if (wt === 5 && !opts.옛활) {
    var hb = 활자리(battle, u, target, Rg);
    if (!hb) return null;
    var hc = Rg.map[hb.x + ',' + hb.y] || { x: hb.x, y: hb.y, left: hb.값, cost: 0, tp: 0 };
    return { x: hb.x, y: hb.y, dir: hb.dir, score: hb.점수,
             score3: positionScore(effectiveDef(defRaw, hb.dir, target.dir | 0), aff, hb.값),
             cost: approachCost(battle, u, hb.x, hb.y, target) + (hc.cost | 0), left: hb.값,
             effDef: effectiveDef(defRaw, hb.dir, target.dir | 0), affinity: aff, reachable: true,
             tp: hc.tp | 0, samePlace: (hb.x === (u.x | 0) && hb.y === (u.y | 0)) };
  }
  /* ★ 무기 0xA 는 0x3CA3C 에 갈래가 없다(0x3CB68 → 후보 없음) · 0xB·0xC·0xF~0x13 은 0x3CF86~ 갈래 (2026-09-29) */
  if (wt === 0xA) return null;
  if (wt === 0xB || wt === 0xC || (wt >= 0xF && wt <= 0x13)) {
    var gb = 기타자리(battle, u, target, Rg, wt);
    if (!gb) return null;
    var gc = Rg.map[gb.x + ',' + gb.y] || { x: gb.x, y: gb.y, left: gb.값, cost: 0, tp: 0 };
    return { x: gb.x, y: gb.y, dir: gb.dir, score: gb.점수,
             score3: positionScore(effectiveDef(defRaw, gb.dir, target.dir | 0), aff, gb.값),
             cost: approachCost(battle, u, gb.x, gb.y, target) + (gc.cost | 0), left: gb.값,
             effDef: effectiveDef(defRaw, gb.dir, target.dir | 0), affinity: aff, reachable: true,
             tp: gc.tp | 0, samePlace: (gb.x === (u.x | 0) && gb.y === (u.y | 0)) };
  }
  /* ★ 무기 6~9·0xD·0xE(큰 몸집)는 0x3CA3C 0x3CE03~ 갈래 (2026-09-29) */
  if ((wt >= 6 && wt <= 9) || wt === 0xD || wt === 0xE) {
    var kb = 큰자리(battle, u, target, Rg, wt);
    if (!kb) return null;
    var kc = Rg.map[kb.x + ',' + kb.y] || { x: kb.x, y: kb.y, left: kb.값, cost: 0, tp: 0 };
    return { x: kb.x, y: kb.y, dir: kb.dir, score: kb.점수,
             score3: positionScore(effectiveDef(defRaw, kb.dir, target.dir | 0), aff, kb.값),
             cost: approachCost(battle, u, kb.x, kb.y, target) + (kc.cost | 0), left: kb.값,
             effDef: effectiveDef(defRaw, kb.dir, target.dir | 0), affinity: aff, reachable: true,
             tp: kc.tp | 0, samePlace: (kb.x === (u.x | 0) && kb.y === (u.y | 0)) };
  }
  /* ★★★★★ 무기 0~4 — 0x3CA3C 근접 갈래를 줄 그대로 (2026-10-02 · 2-4A 말 탄 암흑기사가 원본 (18,25) 대신 (16,24) 로 갔다)
   *   ☠ 옛 근사: Rg 의 stop(«지금 방향» 발자국)으로 설 수 있나를 봤고 · 높이층을 안 봤고 · «이미 그 방향 +4» 를 고르기 «전에» 더했다.
   *   0x3CA6E 나를 빼고 · 0x3CA8B 제 칸 = 예산+1 · 0x3CAB2 대상 칸 높이층 기준 · edi = −1
   *   d = 0~3 (0x3CD6A) · 0x3CAF3 0x49ABC 대상 옆 칸
   *   무기 0~3 (0x3CB7D): 0x1A452 줄(창 2칸 · 그 밖 1칸) — 0x3CBC9 높이층 다르면 그 방향 끝 · 0x13CBD 값 ≤ 최고면 다음 칸(0x3CBEE jge)
   *                        · 0x3CC0C 0x165C2(칸, 방향 d) 로 설 수 있어야
   *   무기 4 (0x3CC3A): 옆 칸 하나 · 값 ≤ 최고면 다음 방향(0x3CC52 jle) · 0x11DB2 빈 칸이어야
   *   끝: −1 이면 없음(0x3CDB5) · 방향 = (d+2)%4 · 점수 = 값, 이미 그 방향이면 +4 (0x3D3B8 — 고른 «뒤»)
   */
  if (wt <= 4 && !opts.옛근접) {
    var W0 = battle.W | 0, H0 = battle.H | 0, 배0 = new Int16Array(W0 * H0);
    for (var k0 = 0; k0 < 배0.length; k0++) 배0[k0] = -1;
    (Rg.cells || []).forEach(function (c) { if (c.x >= 0 && c.y >= 0 && c.x < W0 && c.y < H0) 배0[c.y * W0 + c.x] = c.left | 0; });
    battle.units.forEach(function (t) {                                /* 0x1419C 적대 유닛 칸 −(진영+1) */
      if (!t.alive || t === u || !hostile(battle, u, t)) return;
      (battle.cellsOf ? battle.cellsOf(t, t.x, t.y, t.dir) : [[t.x, t.y]]).forEach(function (c) {
        if (c[0] >= 0 && c[1] >= 0 && c[0] < W0 && c[1] < H0) 배0[c[1] * W0 + c[0]] = -((t.side | 0) + 1); });
    });
    var ox0 = u.x | 0, oy0 = u.y | 0, od0 = u.dir | 0;
    if (ox0 >= 0 && oy0 >= 0 && ox0 < W0 && oy0 < H0) 배0[oy0 * W0 + ox0] = (Rg.budget | 0) + 1;   /* 0x3CA8B */
    var 읽0 = function (x, y) { return (x >= 0 && y >= 0 && x < W0 && y < H0) ? 배0[y * W0 + x] : -128; };
    var R0 = { W: W0, H: H0, left: 배0 };
    var 최0 = -1, 고0 = null;
    var 격0 = !!(battle.unplace && battle.place && battle.at && battle.at(ox0, oy0) === u);
    if (격0) battle.unplace(u);                                         /* 0x3CA6E */
    try {
      for (var d0 = 0; d0 < 4; d0++) {
        var sx0 = (target.x | 0) + DIR[d0].dx, sy0 = (target.y | 0) + DIR[d0].dy;
        if (wt === 4) {
          var l4 = 읽0(sx0, sy0);
          if (l4 <= 최0) continue;                                       /* 0x3CC52 jle */
          if (battle.at && battle.at(sx0, sy0)) continue;               /* 0x3CC66 0x11DB2 */
          최0 = l4; 고0 = { x: sx0, y: sy0, d: d0 };
          continue;
        }
        var 길0 = (wt === 3) ? 2 : 1;                                   /* 0x3CAC6 sete · 0x3CB8B inc */
        for (var st0 = 0; st0 < 길0; st0++) {
          var x0 = sx0 + DIR[d0].dx * st0, y0 = sy0 + DIR[d0].dy * st0;
          if (!같은층(battle, x0, y0, target.x | 0, target.y | 0)) break;   /* 0x3CBD1 je 0x3CD6A */
          var lv0 = 읽0(x0, y0);
          if (최0 >= lv0) continue;                                      /* 0x3CBF1 jge */
          if (Mv.canStand && !Mv.canStand(battle, u, x0, y0, d0, R0)) continue;   /* 0x3CC0C 0x165C2(방향 d) */
          최0 = lv0; 고0 = { x: x0, y: y0, d: d0 };
        }
      }
    } finally { if (격0) battle.place(u, ox0, oy0, od0); }
    if (!고0) return null;                                              /* 0x3CDB5 −1 */
    var dir0 = (고0.d + 2) & 3;
    var sc0 = 최0 + (((u.dir | 0) === dir0) ? 4 : 0);                   /* 0x3D3B8 */
    var c0 = Rg.map[고0.x + ',' + 고0.y] || { x: 고0.x, y: 고0.y, left: 최0, cost: 0, tp: 0 };
    var 자기0 = (고0.x === ox0 && 고0.y === oy0);
    return { x: 고0.x, y: 고0.y, dir: dir0, score: sc0,
             score3: positionScore(effectiveDef(defRaw, dir0, target.dir | 0), aff, 최0),
             cost: approachCost(battle, u, 고0.x, 고0.y, target) + (자기0 ? 0 : (c0.cost | 0)), left: 최0,
             effDef: effectiveDef(defRaw, dir0, target.dir | 0), affinity: aff, reachable: true,
             tp: 자기0 ? 0 : (c0.tp | 0), samePlace: 자기0 };
  }
  /* ② 후보 칸 */
  var cands = [];
  if (wt >= 5) {                                                    // 원거리 — 사거리 안 아무 칸
    /* ★★★★★ **실제로 칠 수 있는 칸만 후보로 삼는다** (2026-08-26)
     *
     *   사용자: 「공격모션은 나오는데 **투사체가 안나오고 데미지 안들어가고**」
     *
     *   전에는 `d < 1 || d > reach` 로 **거리만** 걸러 **거리 1(인접)도 후보**였다.
     *   그런데 무기 5 의 사거리는 **한 칸 띄운 부채꼴**이라(`combat.js fanCells` ·
     *   사용자 확인 「바로 앞 칸은 공격 못 하고 두 번째 칸부터」) **인접은 못 친다.**
     *   ⇒ AI 가 붙어 놓고 `attack` 을 내면 `attack계획` 이 `false` 를 돌려
     *     **아무 일도 안 일어나고**, 다음 턴에 또 같은 자리에 서서 **루프**가 된다.
     *
     *   ⇒ 거리로 **먼저 추린 뒤**(후보 수를 줄인다) 그 칸에 서서 표적을 볼 때
     *     `attackCells` 에 표적이 실제로 들어오는지 본다.
     *   전문: `03_분석/COMBATII/AI_원거리_사거리불일치.md`
     */
    var Cb5 = C();
    var 닿는칸 = function (cx, cy) {
      if (!Cb5 || !Cb5.attackCells) return true;                     /* 못 재면 예전대로 */
      var ox = u.x, oy = u.y, od = u.dir;
      u.x = cx | 0; u.y = cy | 0; u.dir = faceDir({ x: cx, y: cy }, target) & 3;
      var ok = false;
      try {
        var cs = Cb5.attackCells(battle, u) || [];
        for (var q = 0; q < cs.length; q++)
          if (cs[q].x === (target.x | 0) && cs[q].y === (target.y | 0)) { ok = !(Cb5.비행막음 && Cb5.비행막음(battle, u, target)); break; }   /* 0x1A25F 비행 (2026-09-25) */
      } catch (e칸) { ok = true; }
      u.x = ox; u.y = oy; u.dir = od;
      return ok;
    };
    /* ★★★★★ **공격 TP 를 못 남기는 칸은 후보에서 뺀다** (2026-08-26)
     *
     *   실측(1-9 · 킬러) — **제자리에서 이미 닿는데** AI 가 `(65,38)` 로
     *   **90 TP** 를 써서 가려 했다. 남는 TP 가 10 이라 공격(40)을 못 하고
     *   `approach` 로 떨어져 **그 턴에 아무것도 못 한다.**
     *
     *   원본 `0x4016A` 도 **`TP < 40` 이면 행동을 −1** 로 접는다.
     *   공격하러 가면서 공격 못 할 자리로 가는 것은 앞뒤가 안 맞는다.
     *   ⇒ `남은 TP = 지금 TP − 이동 TP` 가 **40 미만**인 칸은 뺀다.
     *   ★ 그런 칸밖에 없으면(아래 `cands` 가 비면) `null` 이 되어
     *     `act()` 가 접근 갈래로 넘어간다 — 예전 동작 그대로다. */
    var 공격TP = 0x28;                                               /* 0x4016A */
    var 지금TP = u.tp | 0;
    for (var i = 0; i < Rg.cells.length; i++) {
      var c = Rg.cells[i];
      if (!c.stop) continue;
      var d = dist(c, target);
      if (d < 1 || d > reach) continue;
      if (지금TP - (c.tp | 0) < 공격TP) continue;                     /* ★ TP 여유 */
      if (!닿는칸(c.x, c.y)) continue;                                /* ★ 실제 판정 */
      cands.push(c);
    }
    /* 제자리도 후보 — 0x3CA73. ★ 여기도 실제로 닿을 때만. */
    if (dist(u, target) <= reach && 닿는칸(u.x, u.y))
      cands.push({ x: u.x, y: u.y, left: Rg.budget + 1, cost: 0, tp: 0, stop: true });
  } else {
    /* ★★★★★ **근접 사거리는 창(wt 3)만 2** — `0x3CAC2` (2026-08-26)
     *
     *   ```asm
     *   0x3CAC2  cmp bx, 3 ; sete [esp+0x54]     ; wt == 3 이면 1
     *   0x3CB7D  eax = [esp+0x54] + 1            ; ★ 사거리 상한 = 2(창) / 1(그 밖)
     *   0x3CB8C  ecx = 1                         ;   하한은 언제나 1
     *   0x3CBA0  call 0x1A452(대상칸, 1..상한)
     *   ```
     *   `attackReach` 를 그대로 쓰면 무기에 따라 더 넓게 잡혀 **원작과 다른 칸**에 선다.
     *   ★ 여기서 재는 것은 「어디에 설까」다 — 실제 명중 판정(`attackCells`)과는 다르다. */
    var 근접상한 = (wt === 3) ? 2 : 1;                              // 0x3CAC2 / 0x3CB7D
    for (var dd = 0; dd < 4; dd++) {                                // 0x3CAD0  대상 기준 네 방향
      for (var step = 1; step <= 근접상한; step++) {
        var x = target.x + DIR[dd].dx * step, y = target.y + DIR[dd].dy * step;
        var cell = Rg.map[x + ',' + y];
        if (x === u.x && y === u.y) { cands.push({ x: x, y: y, left: Rg.budget + 1, cost: 0, tp: 0, stop: true, dirFrom: dd }); continue; }
        if (!cell || !cell.stop) continue;
        cell.dirFrom = dd;
        cands.push(cell);
      }
    }
  }
  if (!cands.length) return null;

  /* ★★★★★ **점수는 「그 칸의 남은 이동력」이다** — `0x3CC2E` (2026-08-26)
   *
   *   사용자: 「**원작과 동일한 ai를 사용한다면 실제 같은 위치로 움직이고 같은
   *   공격을 해야해.** … **위치선정이나 공격 등도 원작과 다르게 작동하는건
   *   ai자체 로직이 뭔가 다른거야.**」
   *
   *   ```asm
   *   0x3CA94  mov edi, -1              ; 점수 누산기 초기값
   *   0x3CBE5  call 0x13CBD(칸x, 칸y)   ; ★ 그 칸의 남은 이동력
   *   0x3CBEE  cmp di, ax / jge         ; ★ **더 클 때만** 갱신 (동점이면 먼저 나온 칸)
   *   0x3CC2E  edi = [esp+0x4C]         ; ★★★ 점수 := 남은 이동력
   *   0x3D3B8  add edi, 4               ; ★ 이미 그 방향을 보고 있으면 +4
   *   0x3D3C0  mov eax, edi ; ret 8     ;   반환
   *   ```
   *   **방어력·상성·HP 를 하나도 안 본다.** 우리가 쓰던 `positionScore` 는
   *   `0x3D3E5` 이고 그것은 **모드 3 전용**이다(`0x3EBB4`). 모드 0(기본)에 그것을
   *   쓰면 「때리기 좋은 적」쪽으로 끌려가 **원작과 다른 칸에 선다.**
   *
   *   ★ 점수 방향이 **뒤집힌다** — 원본은 **클수록 좋다**. 그래서
   *     같은 방향 보정도 `−4` 가 아니라 **`+4`** 다.
   *   전문: `03_분석/COMBATII/AI_위치점수_원본확정.md`
   *
   *   ★ `positionScore` 는 지웠나? — 아니다. 모드 3(`chooseTarget`)이 아직 쓴다.
   *     그래서 두 값을 **둘 다** 담아 돌려준다(`score` = 원본 점수 · `score3` = 모드3 점수).
   */
  var best = null;
  for (var k = 0; k < cands.length; k++) {
    var cc = cands[k];
    /* 대상을 바라보는 방향 — 0x3CDBB */
    var dir = faceDir(cc, target);
    var eDef = effectiveDef(defRaw, dir, target.dir | 0);
    /* ★ 원본 점수 — 그 칸의 남은 이동력 (0x3CC2E) */
    var sc = cc.left | 0;                                              // 0x13CBD
    if ((u.dir | 0) === dir) sc += 4;                                  // 0x3D3B8  ★ +4
    /* 모드 3 이 쓰는 옛 점수는 따로 담는다 (0x3D3E5) */
    var sc3 = positionScore(eDef, aff, cc.left | 0);
    var cost = approachCost(battle, u, cc.x, cc.y, target) + (cc.cost | 0);
    var cand = { x: cc.x, y: cc.y, dir: dir, score: sc, score3: sc3, cost: cost,
                 left: cc.left | 0, effDef: eDef, affinity: aff,
                 reachable: true, tp: cc.tp | 0, samePlace: (cc.x === u.x && cc.y === u.y) };
    /* ★ `cmp di,ax / jge` — **엄격한 초과**라 동점이면 먼저 나온 칸이 이긴다 */
    if (!best || cand.score > best.score) best = cand;
  }
  return best;
}

/** 그 칸에서 대상을 바라보는 방향 0~3. */
function faceDir(from, to) {
  var dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 3 : 1;
  if (dy !== 0) return dy > 0 ? 0 : 2;
  return dx > 0 ? 3 : (dx < 0 ? 1 : 0);
}

/* ══════════════════════════════════════════ 5. 목표 선정 (0x40279 모드 0~6) */

/**
 * [+0x6C] 모드별 목표 선정.
 *   0 `0x3E65E` 점수 최대 · 1 `0x3E739` 안전 접근 · 2 `0x3EADD` HP 최소
 *   3 `0x3EBB4` 점수 최소(무기<6) / 방어력 최소(무기>=6) · 4 `0x3ED51` 권위 최대
 *   5 `0x3EF12` 도주 · 6 `0x3EE2B` 제자리에서 방향만
 * @returns {null|{unit, x, y, dir, score, cost, mode}}
 */
/**
 * ★ **좌표 목표에 가장 가까운 이동 가능 칸** — 원본 `0x3E5AB` → `0x3CA3C` 근사
 *
 *   원본은 목표 좌표를 `0x3CA3C`(공격 위치·방향 탐색 + 점수)에 넘겨 그 근처의
 *   최적 위치를 찾는다. 적을 낀 점수 계산이 들어가는데, **좌표 목표만 있고 적이
 *   없는 경우**에는 결국 「목표에 가까운 칸」으로 수렴한다.
 *   ☐ `0x3CA3C` 의 점수식 전체를 옮기는 것은 별도 과제다.
 *   ★★★ **2026-08-29 — 뼈대를 훑었더니 「범위 칠하기」와 얽혀 있다.**
 *     ```asm
 *     0x3CA56  call 0x1A31D
 *     0x3CA6E  call 0x11EE4              ; 타일 좌표
 *     0x3CA73  call 0x14307
 *     0x3CA8B  call 0x13D02              ; ★ **배치마스크 배열에 쓴다**
 *     0x3CA99  call 0x174CF              ;   유닛 갈래
 *     0x3CAC2  cmp bx, 3                 ;   무기 갈래
 *     0x3CD8E  call 0x11E04 · 0x3CD93 call 0x14307
 *     0x3CDAA  call 0x13D02              ; ★ **두 번째로 또 칠한다**
 *     0x3CDB2  cmp eax, -1 · 0x3CDD4 cmp ax,5 · 0x3D374 cmp ax,7 · 0x3D37A cmp ax,8
 *     ```
 *     `0x13D02` 는 `mov [ebx*2 + 0x78F48], cx` 로 **배치마스크 배열**에 쓰는 함수다
 *     (`controller.js` §원거리 스캔 · `state.js` §배치마스크).
 *     ⇒ AI 점수식은 **범위를 칠하면서** 점수를 낸다 — 둘이 같은 배열을 쓴다.
 *   ☐ 점수 자체를 만드는 식은 아직 — **값을 옮기지 않는다.**
 *     남기고, 지금은 거리만 본다. 문서 `AI_위치점수_원본확정.md` 참고.
 *
 * @returns {{x,y,dir,tp}|null}
 */
function 목표로가까운칸(battle, u, gx, gy, Rg) {
  var Mv = M(); if (!Mv) return null;
  var cells = (Rg && Rg.cells) || [];
  var 지금 = Math.abs((u.x | 0) - (gx | 0)) + Math.abs((u.y | 0) - (gy | 0));
  var 최선 = null, 최선d = 지금;
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i];
    var d = Math.abs((c.x | 0) - (gx | 0)) + Math.abs((c.y | 0) - (gy | 0));
    if (d >= 최선d) continue;
    최선d = d; 최선 = c;
  }
  if (!최선) return null;
  /* ★ 목표 쪽을 바라본다 — 원본도 `0x3CA3C` 가 방향을 함께 돌려준다 */
  var dx = (gx | 0) - (최선.x | 0), dy = (gy | 0) - (최선.y | 0);
  var dir = (Math.abs(dx) >= Math.abs(dy)) ? (dx > 0 ? 3 : 1) : (dy > 0 ? 0 : 2);
  return { x: 최선.x | 0, y: 최선.y | 0, dir: dir, tp: 최선.tp | 0 };
}

/**
 * ★ 0x3E251 — 지정 목표 «쪽으로» 갈 목적지 (2026-10-01 사장님 「아군 ai지정시 원본과 다르게 행동하던데.
 *   캐릭터를 지정했을때랑, 타일을 지정했을때 행동 방식이 다를거야.」)
 *   0x40639 0x3E18B > 0 → 0x4065D 0x3E251 → 0x40662 jmp 0x406B6(먼 적 접근과 같은 걷기 · 목적지로걷기)
 *   ① 목표 자리 — [+0x73] 유닛(0x3E262) · [+0x71] 유닛(0x3E27D 0x1379A) · 아니면 좌표 [+0x6F],[+0x70](0x3E299)
 *   ② 유닛 목표면 0x3E2C9 0x3D7B2(그 유닛을 칠 칸 · 나에게서 맨해튼 최소) — 0x7FFF 아니면 그 칸
 *   ③ 아니면(좌표 목표 · ② 실패) 0x1AC08(목표, 반경 9 · 0x3E2DF ebx=9) 마름모(위→아래 · 왼→오른)를 훑어
 *      방향 0·1 중 하나로 설 수 있고(0x3E336 0x16699 — 유닛은 맵에 둔 채) 점수 = 맨해튼(나, 칸)(0x3E35E 0x49ADF) + 18 − 2 × (9 − 맨해튼(칸, 목표))
 *      (0x1AD2E = 줄 가장자리까지 = 반경 − 목표까지 거리) · «엄격히 작을 때만»(0x3E379 jae) — 곧 나 거리 + 2 × 목표 거리 최소
 *   ④ 그래도 없으면(0x3E396 == 0x7FFF) 목표 자리 그대로(0x3E39F~0x3E3B4)
 *   ☠ 예전: 좌표 목표·유닛 목표 실패 모두 «이번 턴 범위 안 맨해튼 최소 칸»(목표로가까운칸) — 벽·물을 돌아가는 길을 안 보고, 반경 9 점수도 없었다.
 * @returns {{x, y, 목: {x, y}, 유닛}|null}
 */
function 목표쪽목적지(battle, u) {
  var Mv = M(), Cb = C();
  var 읽 = AI목표읽기(u);
  var 유닛 = 읽.유닛 || ((읽.x | 0) === 0xFF ? AI목표유닛찾기(battle, 읽.유닛id, 읽.유닛코드) : null);
  var tx, ty;
  if (유닛) { tx = 유닛.x | 0; ty = 유닛.y | 0; }
  else if ((읽.x | 0) !== 0xFF) { tx = 읽.x | 0; ty = 읽.y | 0; }
  else return null;
  if (유닛) {                                                     /* ② 0x3E2C9 0x3D7B2 */
    var 격자 = !!(battle && battle.unplace && battle.place), ox = u.x | 0, oy = u.y | 0, od = u.dir | 0, r = null;
    if (격자) battle.unplace(u);                                  /* 0x3D7D4 0x11EE4 — 0x3D7B2 가 제 발자국을 뺀다 */
    try { r = 접근칸비용(battle, u, 유닛); } finally { if (격자) battle.place(u, ox, oy, od); }
    if (r && (r.cost | 0) !== 0x7FFF) return { x: r.x | 0, y: r.y | 0, 목: { x: tx, y: ty }, 유닛: 유닛 };
  }
  var 둘레 = (Cb && Cb.diamond) ? Cb.diamond(battle, tx, ty, 9, true) : [];   /* ③ 0x1AC08 반경 9 */
  var 최선 = null, 최점 = 0x7FFF;
  for (var i = 0; i < 둘레.length; i++) {
    var x = 둘레[i].x, y = 둘레[i].y, 섬 = false;
    for (var d = 0; d < 2 && !섬; d++) 섬 = !Mv || !Mv.canPlace || Mv.canPlace(battle, u, x, y, d);   /* 0x3E323~0x3E34C */
    if (!섬) continue;
    var 점 = (Math.abs((u.x | 0) - x) + Math.abs((u.y | 0) - y)) + 18 - 2 * (9 - (Math.abs(x - tx) + Math.abs(y - ty)));
    if (점 >= 최점) continue;                                     /* 0x3E379 jae */
    최점 = 점; 최선 = { x: x, y: y };
  }
  if (!최선) 최선 = { x: tx, y: ty };                             /* ④ 0x3E39F */
  return { x: 최선.x, y: 최선.y, 목: { x: tx, y: ty }, 유닛: 유닛 };
}

function chooseTarget(battle, u, opts) {
  opts = opts || {};
  var Mv = M(); if (!Mv) return null;
  var mode = (opts.mode != null) ? (opts.mode | 0) : (ai(u).mode | 0);
  var Rg = opts.range || Mv.range(battle, u, { tp: u.tp | 0 });
  var reach = attackReach(battle, u);
  var steps = moveSteps(u);
  var foes = enemiesOf(battle, u);

  /* ★★★★★ **지정 목표가 있으면 모드보다 먼저다** — 원본 `0x4016A` (2026-08-27)
   *
   *   > `AI대역_분석.md` §`0x4016A`: 「목표가 이미 지정돼 있으면 (`0x3E18B` > 0)
   *   >  **모드와 무관하게** `0x3E5AB` 로 갑니다」
   *
   *   ★★★ **적이 없어도 간다.** 전에는 바로 위에서 `if (!foes.length) return null`
   *     로 끊어, 적이 아직 등장하지 않은 `1-5` 에서 마크가 **한 발짝도 안 움직였다.**
   *     그 때문에 §2 구역으로 걸어 들어가는 일이 없어 암흑살수 등장이 안 걸렸다.
   *
   *   `0x3E5AB` 는 목표 좌표를 `0x3CA3C`(위치 점수)에 넘겨 **그 근처의 최적
   *   위치**를 찾는다. 우리는 이동 범위 안에서 **목표에 가장 가까운 칸**을 고른다
   *   — `0x3E18B` 가 「x 또는 y 한 축만 같아도 도착(−1)」이라 정확히 닿을 필요가 없다. */
  /* opts.모드만 — 목표 상태·먼 적 접근 없이 모드 함수만(활 루프 0x4106B~0x4119E 가 그렇게 부른다) */
  var 모드만 = !!opts.모드만;
  var 상태 = 모드만 ? 0 : 목표상태(battle, u);
  if (상태 === 2) {
    /* 좌표 목표 — 0x3E5AB 는 0x3E21B 가 유닛을 못 내 0(후보 없음) → 0x40639 0x3E251 목적지 → 0x406B6 걷기 (2026-10-01) */
    var 목 = AI목표읽기(u);
    var 쪽 = 목표쪽목적지(battle, u);
    var 걸음 = 쪽 ? 목적지로걷기(battle, u, Rg, 쪽.x, 쪽.y, 쪽.목, null, '좌표목표', 0) : null;
    if (걸음) { 걸음.목표 = 목; return 걸음; }
    return null;                                                   /* 목적지가 제자리거나 못 가면 이동 없음(0x406D1 −2) */
  }
  /* ★ 유닛 목표(상태 1 — [+0x71]/[+0x73]) — 0x40443 test ax,ax / jle 는 1·2 둘 다 0x3E5AB 로 보낸다.
   *   0x3E5AB → 0x3E21B(목표 자리) → 0x3CA3C(그 자리 · 우리 choosePosition) · 실패하면 0x40639 → 0x3E251(목표 쪽으로).
   *   ☠ 전에는 상태 1 을 안 봐서 목표 유닛을 두고 모드대로 다른 적을 골랐다 (2026-09-29). */
  if (상태 === 1) {
    var 목유 = AI목표읽기(u).유닛 || AI목표유닛찾기(battle, AI목표읽기(u).유닛id, AI목표읽기(u).유닛코드);
    if (목유) {
      var wt목 = wtOf(battle, u);                                    /* 0x3E5BE 0x174CF */
      /* 0x3E5D6~0x3E5E0 — 무기 < 6 이고 모드 3 이면 0x3D3E5(모드3자리 · 0x7FFF 아니면 성공) · 그 밖은 0x3CA3C(0 이상이면 성공) (2026-10-02) */
      var 목자리 = (wt목 < 6 && (ai(u).mode | 0) === 3) ? 모드3자리(battle, u, 목유, Rg) : choosePosition(battle, u, 목유, { range: Rg });
      if (목자리) return { unit: hostile(battle, u, 목유) ? 목유 : null, x: 목자리.x, y: 목자리.y, dir: 목자리.dir,
                            score: 목자리.score, cost: 목자리.cost, mode: '유닛목표' };
      /* 칠 자리를 못 찾으면 0x40639 0x3E251 목적지(그 유닛 칠 칸 0x3D7B2 · 아니면 반경 9 점수) → 0x406B6 걷기 (2026-10-01)
       *   ☠ 예전: 이번 턴 범위 안 맨해튼 최소 칸(목표로가까운칸) — 길을 안 봤다 */
      var 쪽1 = 목표쪽목적지(battle, u);
      return 쪽1 ? 목적지로걷기(battle, u, Rg, 쪽1.x, 쪽1.y, 쪽1.목, hostile(battle, u, 목유) ? 목유 : null, '유닛목표접근', 0) : null;
    }
  }

  if (!foes.length) return null;

  /* 모드 5 — 도주 */
  if (mode === 5) {
    var fc = 물러설칸(battle, u, Rg, 3);                               /* 0x4054C push 3 · 0x3EF12 */
    return fc ? { unit: null, x: fc.x, y: fc.y, dir: fc.dir, score: 0, cost: 0, mode: 5 } : null;
  }

  /* 모드 6 — 제자리에서 방향만 바꿔 **실제 통상공격 범위**의 적 중 HP 최소 (0x3EE2B)
   *
   *   원본은 방향 0~3마다 `0x165C2`(그 방향으로 설 수 있나) 뒤 **`0x1D124`**를
   *   그대로 호출한다. `0x1D124`는 검/창만의 직선 검사가 아니라 궁 부채꼴·도끼·
   *   브레스·대형 유닛까지 포함한 **통상 공격 공용 판정**이다.
   *
   *   예전 구현은 `DIR[d] * 1..reach` 직선만 훑어서, 모드6 궁수나 도끼/대형 유닛이
   *   실제로는 칠 수 있는 적을 못 보는 경우가 있었다. 여기서는 플레이어/일반 AI가
   *   이미 쓰는 `combat.attackCells()`를 그대로 공유한다. 원본도 같은 `0x1D124`를
   *   공유하므로 별도 AI 사거리표를 만들면 안 된다.
   */
  if (mode === 6) {
    var bestD = null, Cb6 = C(), Mv6 = M();
    var ox6 = u.x | 0, oy6 = u.y | 0, od6 = u.dir | 0;
    var 격자내림 = !!(battle && battle.unplace && battle.place);

    /* 원본 `0x3EE2B`도 자기를 맵에서 잠깐 뺀 뒤 방향을 시험한다.
     * 큰 유닛은 방향에 따라 footprint가 달라질 수 있어 자기 점유를 남겨 두면
     * `canPlace`가 자기 자신을 장애물로 오판한다. */
    if (격자내림) battle.unplace(u);
    try {
      for (var d = 0; d < 4; d++) {
        if (Mv6 && typeof Mv6.canPlace === 'function' && 격자내림 &&
            !Mv6.canPlace(battle, u, ox6, oy6, d)) continue;          /* 0x165C2 */

        u.dir = d;
        var cells6 = (Cb6 && typeof Cb6.attackCells === 'function')
          ? (Cb6.attackCells(battle, u) || []) : [];                  /* 0x1D124 */

        /* `0x1D124`가 만든 순서에서 첫 적을 현재 대상으로 삼는다.
         * 그 한 명의 HP를 방향끼리 비교해 최소인 방향을 고른다. */
        var t6 = null;
        for (var c6 = 0; c6 < cells6.length; c6++) {
          var cell6 = cells6[c6];
          var q6 = battle.at(cell6.x | 0, cell6.y | 0);
          if (!q6 || !q6.alive || !hostile(battle, u, q6)) continue;
          if (Cb6.비행막음 && Cb6.비행막음(battle, u, q6)) continue;   /* 0x1A25F 비행 대상은 비행 공격자만 (2026-09-25) */
          t6 = q6;
          break;
        }
        if (t6 && (!bestD || (t6.hp | 0) < (bestD.unit.hp | 0)))
          bestD = { unit: t6, dir: d };
      }
    } finally {
      u.dir = od6;
      if (격자내림) battle.place(u, ox6, oy6, od6);
    }

    return bestD ? { unit: bestD.unit, x: ox6, y: oy6, dir: bestD.dir,
                     score: 0, cost: 0, mode: 6 } : null;
  }

  /* 모드 1 — 안전 접근 (0x3E739). 위협이 낮고 적 무리에 가까운 칸으로. */
  if (mode === 1) {
    /* 0x404AA — 0x3E3BF 없이 0x3E739(n, 2). 적 목록은 루프 머리 0x4016A 의 0x1D124(지금 칠 수 있는 적)가 남긴 것.
     *   ☐ 목록이 비면 원본은 초기화 안 된 스택 값을 돌려준다 — 확정 못 해 먼 적 접근으로 넘긴다 */
    var Cb1 = C(), 칠적 = [], 본1 = {};
    ((Cb1 && Cb1.attackCells) ? Cb1.attackCells(battle, u) : []).forEach(function (c) {
      var t = battle.at(c.x, c.y); if (t && t.alive && hostile(battle, u, t) && !본1[t.id]) { 본1[t.id] = 1; 칠적.push(t); }
    });
    var pick = 칠적.length ? 안전접근(battle, u, Rg, steps, 2, 칠적) : null;
    if (pick) return pick;
  }

  /* 나머지 모드 — 후보 적마다 설 자리를 뽑고 모드별 기준으로 하나 고릅니다 */
  /* ★ 0x4048D push [esp+0x18](n) — 모드 함수(0x3E65E·0x3EADD·0x3EBB4·0x3ED51)는 내 둘레 마름모 «반경 n»(이번 턴 걸음 수) 안의 적만 본다
   *   (활 루프 0x410D0 는 n + 사거리). ☠ 전에는 걸음 + 사거리 + 1 로 더 넓게 봤다 (2026-09-29) */
  var searchR = (opts.탐색반경 != null) ? (opts.탐색반경 | 0) : steps;
  var cand = [];
  for (var i = 0; i < foes.length; i++) {
    var f = foes[i];
    if (dist(u, f) > searchR) continue;
    var pos = choosePosition(battle, u, f, { range: Rg });
    if (!pos) continue;                                             // 이번 턴에 못 닿는 적은 뺍니다
    cand.push({ unit: f, pos: pos, d: dist(u, f) });
  }
  if (!cand.length) {
    /* ★★★★★ **목표 자리에 이미 와 있으면(0x3E18B = −1) 그 자리를 지킨다** (2026-09-29)
     *   0x40639 call 0x3E18B → 0x40664 cmp eax,−1 → je 0x40876(턴 마무리 · 이동 없음).
     *   SCE 는 «지키는 적»을 목표 좌표 = 제 자리로 둔다(전수 7339기 중 1206기 — 10-11 로열가드 등).
     *   이번 턴에 칠 적이 모드 탐색에 안 걸리면 아래 0x3DF3B 로 먼 적에게 가지 않는다.
     *   ☠ 전에는 이 갈래가 없어 지켜야 할 적이 반경 30 안의 적에게 걸어갔다. */
    if (상태 === -1) return null;
    if (모드만) return null;
    /* 근접(무기 종류 ≤ 4)은 원본 0x3DF3B → 0x1499C → 0x15523 → 0x14FA4 를 따른다 (2026-09-29) */
    /* 0x3DF3B 는 무기 종류와 상관없이 같은 길 — 무기별 차이는 0x3D7B2 안에서 갈린다 (2026-09-29) */
    return 근접접근(battle, u, Rg, mode);
    /* 0x3DF3B — 이번 턴에 닿는 적이 없으면 **반경 30 안에서 제일 접근하기 쉬운 적**을
     * 목표로 잡고 그쪽으로 다가갑니다 (0x40295 의 마지막 갈래). */
    var near = null;
    for (var q = 0; q < foes.length; q++) {
      if (dist(u, foes[q]) > 30) continue;                          // 0x3DF3B  dx = 30
      var cst = approachCost(battle, u, u.x, u.y, foes[q]);
      if (!near || cst < near.cost) near = { unit: foes[q], cost: cst };
    }
    if (!near) return null;
    var step = approachCell(battle, u, near.unit, Rg);
    return { unit: near.unit, x: step.x, y: step.y, dir: faceDir(step, near.unit),
             score: 0, cost: near.cost, mode: mode, approach: true,
             reachable: false, samePlace: (step.x === u.x && step.y === u.y) };
  }

  var wt = wtOf(battle, u);
  var best = null, keyOf;
  /* ★★★★★ **모드마다 점수가 다르다** (2026-08-26 · 0x40279 점프표)
   *
   *   모드 0 은 `0x3CA3C` 가 돌려준 점수를 **최대화**한다 (0x3E6FF `cmp` / 0x3E704 `jle`).
   *   그 점수는 **그 칸의 남은 이동력**이지 방어력·상성이 아니다.
   *   `positionScore`(= `0x3D3E5`)는 **모드 3 전용**이라 `pos.score3` 에 따로 담았다.
   *   여기 `keyOf` 는 **작을수록 좋다**는 규약이므로 최대화하려면 부호를 뒤집는다. */
  if (mode === 0) keyOf = function (c) { return -(c.pos ? c.pos.score : -1e9); };       // 0x3E704  점수 최대
  else if (mode === 2) keyOf = function (c) { return c.unit.hp | 0; };                  // 0x3EADD  HP 최소
  else if (mode === 3 && wt >= 6) keyOf = function (c) { return effOf(battle, c.unit).def; };  // 0x3EBB4
  else if (mode === 4) keyOf = function (c) { return -(effOf(battle, c.unit).cha | 0); };// 0x3ED51  권위 최대
  else keyOf = function (c) { return c.pos ? c.pos.score3 : 1e9; };                     // 0x3D3E5  모드 3 점수 최소

  for (var m = 0; m < cand.length; m++) {
    var c2 = cand[m], k2 = keyOf(c2);
    if (!best || k2 < best.key || (k2 === best.key && c2.d < best.c.d))
      best = { key: k2, c: c2 };
  }
  var w = best.c;
  var p = w.pos || { x: u.x, y: u.y, dir: faceDir(u, w.unit), score: 0, cost: w.d, reachable: false };
  return { unit: w.unit, x: p.x, y: p.y, dir: p.dir, score: p.score, cost: p.cost, key: best.key,
           left: p.left, mode: mode, reachable: !!w.pos, samePlace: !!p.samePlace };
}

/**
 * 0x1499C + 0x15523 — **목표 지향 이동 한 걸음**.
 * 이동 범위 안에서 목표에 가장 가까워지는 칸을 고릅니다(같으면 남은 이동력이 큰 쪽).
 * 원본은 ZOC 가중치를 얹은 확산으로 같은 답을 냅니다(move.js 의 `zoc:'cost'`).
 */
/**
 * ★★★★★ **원거리는 「칠 수 있는 칸」에 선다 — 붙지 않는다** (2026-08-26)
 *
 *   사용자: 「제대로 공격이 되지않고 **루프가 도는 문제**가 있으니」
 *
 *   전에는 `dist(c, target)` 를 **최소화**해 **표적 바로 옆**에 섰다.
 *   그런데 무기 5 의 사거리는 **한 칸 띄운 부채꼴**이라(`combat.js fanCells` ·
 *   사용자 확인 「바로 앞 칸은 공격 못 하고 두 번째 칸부터」) **인접은 못 친다.**
 *   ⇒ 붙는다 → 못 친다 → 다음 턴에 또 붙는다 = **루프**.
 *
 *   그래서 **실제로 칠 수 있는 칸**(`attackCells` 에 표적이 들어오는 칸)을 먼저 찾고,
 *   그런 칸이 없을 때만 예전처럼 가까이 간다.
 *   전문: `03_분석/COMBATII/AI_원거리_사거리불일치.md`
 */
/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **근접 유닛이 먼 적에게 다가가는 길** — 원본 그대로 (2026-09-29)
 *
 *   > 사장님: 「이동하는 방식도 달라. 원본은 재시작해도 저 위치로 이동하는데
 *   >  우리 실행기는 오른쪽 처럼 계속 이동해.」
 *
 *   0x40683  0x3DF3B(반경 30)  → 적 · 설 칸
 *   0x406DB  0x14300(0xD2) · 0x1419C · 0x1499C(칸)  → 큰 예산으로 그 칸까지 확산
 *            실패하면 0x15342(칸 근처)
 *   0x4072E  0x15523(칸)  → 경로
 *   0x4074D  0x14FA4(예산 = 이동칸수×4)  → 경로를 내 쪽부터 따라가며 이번 턴 범위 안인 칸을
 *            쌓다가 처음 벗어나는 칸에서 멈추고, 가장 멀리 간 칸을 꺼낸다
 *   ☠ 전에는 「이동 범위에서 맨해튼으로 적에게 가장 가까운 칸」이라 숲·언덕을 돌아가는 길에서 갈렸다.
 * ══════════════════════════════════════════════════════════════════════ */

/** 0x1A2D7 / 0x1A2FE — 지형값(100 이상이면 −100)의 윗 니블이 같은가(같은 높이 층). */
function 같은층(battle, x, y, gx, gy) {
  function 층(ax, ay) { var t = battle.tile(ax, ay); var v = t ? (t['값'] | 0) : 0; if (v >= 100) v -= 100; return v; }
  var base = 층(gx, gy) & 0xF0, v = 층(x, y);
  return ((v - base) & 0xFF) < 0x10;                          /* 0x1A30F sub · 0x1A315 cmp al,0x10 / setb */
}

/** 0x3D7B2 (wt ≤ 4) — 그 적을 칠 수 있는 칸 중 나에게서 맨해튼 거리가 최소인 칸. 없으면 null(0x7FFF). */
function 접근칸비용(battle, u, foe) {
  var Mv = M(), wt = wtOf(battle, u);
  if (wt >= 5) return 원거리접근칸(battle, u, foe);                         /* 0x3D892~ 무기 5 이상 갈래 */
  var 길이 = (wt === 3) ? 2 : 1;                                 /* 0x3D80C sete — 창만 2 */
  var best = null, bestC = 0x7FFF;
  for (var d = 0; d < 4; d++) {                                  /* 0x3D807 방향 0~3 */
    var sx = (foe.x | 0) + DIR[d].dx, sy = (foe.y | 0) + DIR[d].dy;   /* 0x3D83C 0x49ABC(d) */
    for (var s = 0; s < (wt === 4 ? 1 : 길이); s++) {            /* 0x3D8E3 0x1A452(형태1) · wt 4 는 인접 1칸(0x3D976) */
      var x = sx + DIR[d].dx * s, y = sy + DIR[d].dy * s;
      if (x < 0 || y < 0 || x >= battle.W || y >= battle.H) break;
      if (wt !== 4 && !같은층(battle, x, y, foe.x | 0, foe.y | 0)) continue;   /* 0x3D90C */
      var c = Math.abs((u.x | 0) - x) + Math.abs((u.y | 0) - y);           /* 0x3D92A 0x49ADF */
      if (bestC <= c) continue;                                  /* 0x3D933 */
      if (Mv && typeof Mv.canPlace === 'function' && !Mv.canPlace(battle, u, x, y, (d + 2) & 3)) continue;   /* 0x16699 */
      bestC = c; best = { x: x, y: y, cost: c };
    }
  }
  return best;
}

/**
 * 0x15523 — 이동배열을 목표 칸에서 내 쪽으로 **가장 크게 오르는 이웃**을 따라 되짚는다.
 *   차례표(0x155D9~0x1564E)는 한 번 정한다: 칸0 = 가로(±1) · 칸1 = 세로(±맵폭) — 목표가 나와 같은 열이면 맞바꾼다.
 *   각 칸의 앞은 «내 쪽» 방향. 재는 차례 [칸0 앞, 칸1 앞, 칸0 뒤, 칸1 뒤](0x1571D).
 *   0x1574D cmp best,차이 / jge — 엄격히 클 때만(동점은 앞 차례). 0x15673 값 == 예산이면 내 칸.
 * @returns {Array|null} 내 칸부터 목표 칸까지 [{x,y}]
 */
function 원본되짚기(R, u, tx, ty) {
  if (M() && M().되짚기) return M().되짚기(R, u, tx, ty);          /* 정본은 move.js (2026-09-30) */
  var W = R.W, H = R.H, L = R.left;
  if (tx < 0 || ty < 0 || tx >= W || ty >= H || L[ty * W + tx] < 0) return null;
  var ux = u.x | 0, uy = u.y | 0;
  var 가 = (tx > ux) ? [-1, 1] : [1, -1];                        /* 0x15604 cmp cx,bx / jle */
  var 세 = (uy < ty) ? [-1, 1] : [1, -1];                        /* 0x15637 cmp dx,bx / jge */
  var 칸0 = 가, 칸1 = 세, 칸0가로 = true;
  if (tx === ux) { 칸0 = 세; 칸1 = 가; 칸0가로 = false; }        /* 0x155E2 같은 열이면 맞바꿈 */
  var 차례 = [[칸0가로, 칸0[0]], [!칸0가로, 칸1[0]], [칸0가로, 칸0[1]], [!칸0가로, 칸1[1]]];
  var x = tx, y = ty, 길 = [{ x: x, y: y }], guard = W * H;
  while (L[y * W + x] !== R.budget && guard-- > 0) {             /* 0x15673 */
    var cur = L[y * W + x], best = 0, bi = 0;
    for (var i = 0; i < 4; i++) {
      var nx = x + (차례[i][0] ? 차례[i][1] : 0), ny = y + (차례[i][0] ? 0 : 차례[i][1]);
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;      /* 0x157AC */
      var 차 = L[ny * W + nx] - cur;
      if (best >= 차) continue;                                   /* 0x1574D jge */
      best = 차; bi = i;
    }
    if (best <= 0) return null;
    x += 차례[bi][0] ? 차례[bi][1] : 0; y += 차례[bi][0] ? 0 : 차례[bi][1];
    길.push({ x: x, y: y });
  }
  길.reverse();
  return (길[0].x === ux && 길[0].y === uy) ? 길 : null;
}

/**
 * ★ AI 걸음 경로 — 0x15523 을 이번 턴 이동배열(0x143F3)에 돌린다 (2026-09-29)
 *   원본은 도착 칸을 정한 뒤 길 목록 [0xE8CC0] 을 0x15523(이웃 중 가장 크게 오르는 칸 · 가로/세로 차례 0x155E2~)으로 되짚는다.
 *   G2Move.path 는 확산 때 적어 둔 «앞 칸»을 따라가 갈래가 달라질 수 있다 —
 *   2-3 26,12 고블린(원본 메모리 [0xE8CC0] 실측): 원본 26,13 → 26,14 → 25,14 · 옛 우리 25,12 → 25,13 → 25,14 (도착 칸은 같음)
 *   ☐ 대형 유닛(발자국 칸이 여럿인 씨앗)은 되짚기가 내 칸에 안 닿을 수 있어 옛 길을 쓴다
 */
function AI경로(battle, u, Rg, x, y) {
  var p = M().path(battle, u, x, y, { range: Rg });
  if (!p || !Rg || !Rg.left) return p;
  var 길 = 원본되짚기({ W: Rg.W, H: Rg.H, left: Rg.left, budget: Rg.budget }, u, x, y);
  if (!길 || !길.length) return p;
  var 새 = 길.map(function (q) { var k = q.y * Rg.W + q.x; return { x: q.x, y: q.y, left: Rg.left[k], cost: Rg.budget - Rg.left[k] }; });
  for (var key in p) if (Object.prototype.hasOwnProperty.call(p, key) && isNaN(+key)) 새[key] = p[key];
  return 새;
}

/**
 * 0x1499C — **목표 쪽 우선 확산**. 목표 칸에 값이 생기면 곧바로 멈춘다(0x14AE8 → 0x14F46).
 *   큐는 우선순위 칸 넷 × 칸마다 160 스택(0x13B51 넣기 · 가득이면 그 하나를 버림 / 0x13B9A 낮은 칸부터 · 칸 안은 나중 것부터).
 *   꺼낸 칸이 목표 기준 어디냐로 이웃의 칸 번호가 정해진다(0x14B05~0x14BF4):
 *     목표 쪽으로 가는 방향 0 · 비껴가는 방향 1 · 목표와 한 줄일 때 정반대 2.
 *   이웃 차례 아래(y+1, eax) → 왼(x−1, ecx) → 위(y−1, ebx) → 오른(x+1, esi).
 *   값 = 꺼낸 항목이 들고 온 값 − 지형비용 (+ ZOC 보조 0x14C87) · 더 좋을 때만 · 테두리 2..W−3.
 *   ZOC·막힘은 0x1419C = G2Move.zocMap(…, 'cost').
 * @returns {{W,H,left:Int16Array,budget:number}}
 */
function 목표확산(battle, u, tx, ty, budget) {
  var Mv = M(), W = battle.W, H = battle.H, N = W * H;
  var mtype = Mv.moveTypeOf(battle, u);
  var z = Mv.zocMap(battle, u, 'cost');
  var left = new Int16Array(N); for (var i = 0; i < N; i++) left[i] = -1;
  var 칸 = [[], [], [], []];
  function 넣기(b, x, y, v) { if (칸[b].length >= 0xA0) return; 칸[b].push([x, y, v]); }   /* 0x13B5C */
  function 꺼내기() { for (var b = 0; b < 4; b++) if (칸[b].length) return 칸[b].pop(); return null; }
  (battle.cellsOf ? battle.cellsOf(u, u.x, u.y, u.dir) : [[u.x, u.y]]).forEach(function (c) {   /* 0x147BB 씨앗 */
    if (c[0] < 0 || c[1] < 0 || c[0] >= W || c[1] >= H) return;
    left[c[1] * W + c[0]] = budget; 넣기(0, c[0], c[1], budget);
  });
  var 목k = ty * W + tx;
  for (var guard = 0; guard < 200000; guard++) {
    var e = 꺼내기(); if (!e) break;                           /* 0x13C13 */
    if (left[목k] >= 0) break;                                   /* 0x14AE8 0x13CBD(목표) ≥ 0 */
    var cx = e[0], cy = e[1], cur = e[2];
    var 아래, 왼, 위, 오른;                                      /* eax · ecx · ebx · esi */
    if (cy < ty) { 아래 = 0;
      if (cx < tx) { 왼 = 1; 위 = 1; 오른 = 0; } else if (cx > tx) { 왼 = 0; 위 = 1; 오른 = 1; } else { 왼 = 1; 위 = 2; 오른 = 1; } }
    else if (cy > ty) { 위 = 0;
      if (cx < tx) { 아래 = 1; 왼 = 1; 오른 = 0; } else if (cx > tx) { 아래 = 1; 왼 = 0; 오른 = 1; } else { 아래 = 2; 왼 = 1; 오른 = 1; } }
    else { 아래 = 1; 위 = 1;
      if (cx < tx) { 왼 = 2; 오른 = 0; } else { 왼 = 0; 오른 = 2; } }
    var 이웃 = [[cx, cy + 1, 아래], [cx - 1, cy, 왼], [cx, cy - 1, 위], [cx + 1, cy, 오른]];
    /* ★ 원본 버그 그대로 — ZOC 보조값은 네 이웃 모두 «지금 칸의 아래 칸»(cur + W)을 읽는다 (2026-10-07)
     *   아래 0x14C7A [esp+4]+W · 왼 0x14D44 · 위 0x14E22 · 오른 0x14EE8 — 셋 다 [esp+0x36]>>16(=W)를 더한다.
     *   ☠ 전에는 이웃 제 칸의 값을 써서 2-4A 넘김 3 캐빈(15,26)이 원본(동쪽 16,26)과 달리 서쪽으로 돌았다. */
    var 보k = (cy + 1) * W + cx;
    for (var d = 0; d < 4; d++) {
      var nx = 이웃[d][0], ny = 이웃[d][1];
      if (nx < 2 || ny < 2 || nx > W - 3 || ny > H - 3) continue;   /* 0x14C11 · 0x14CE3 */
      var k = ny * W + nx;
      if (z.blocked[k]) continue;                                /* 0x14C3E 적이 선 칸 */
      var cost = battle.moveCost(nx, ny, mtype);
      if (cost <= 0) continue;                                   /* 0x14C75 */
      var nv = cur - cost;
      if (z.aux[보k] !== -1) nv += z.aux[보k];                   /* 0x14C87 · 0x14D51 · 0x14E31 · 0x14EF4 */
      if (left[k] >= nv) continue;                               /* 0x14C9E */
      if (nv < 0) continue;
      left[k] = nv;
      if (nv > 0) 넣기(이웃[d][2], nx, ny, nv);                  /* 0x14CBD */
    }
  }
  return { W: W, H: H, left: left, budget: budget };
}

function 근접접근(battle, u, Rg, mode) {
  var Mv = M(), Cb = C();
  var 격자 = !!(battle && battle.unplace && battle.place);
  var ox = u.x | 0, oy = u.y | 0, od = u.dir | 0;
  /* ① 0x3DF3B — 반경 30 마름모(위→아래·왼→오른) · 엄격히 작을 때만 바꾼다(0x3DFD4 jge) */
  var 적 = null, 칸 = null, 최소 = 0x7FFF, 본 = {};
  if (격자) battle.unplace(u);                                   /* 0x3D7D4 0x11EE4 자기 발자국 뺌 */
  try {
    var 둘레 = (Cb && Cb.diamond) ? Cb.diamond(battle, ox, oy, 30, false) : [];
    for (var i = 0; i < 둘레.length; i++) {
      var t = battle.at(둘레[i].x, 둘레[i].y);
      if (!t || !t.alive || !hostile(battle, u, t) || 본[t.id]) continue;
      본[t.id] = 1;
      var r = 접근칸비용(battle, u, t);
      if (!r || r.cost >= 최소) continue;
      최소 = r.cost; 적 = t; 칸 = r;
    }
  } finally { if (격자) battle.place(u, ox, oy, od); }
  if (!적 || (칸.x === ox && 칸.y === oy)) return null;         /* 0x3DFF5 — 제자리면 0 */
  return 목적지로걷기(battle, u, Rg, 칸.x, 칸.y, 적, 적, mode, 최소);
}

/**
 * 0x406B6~0x4076A — 목적지 칸으로 걷는다 (먼 적 접근 0x3DF3B 와 목표 쪽 0x3E251 이 같이 탄다 · 0x40662 jmp 0x406B6)
 *   목적지 = (목x, 목y) · 바라볼 = 방향을 잡을 기준 자리({x,y}) · 대상 = 돌려줄 unit(없으면 null)
 *   ② 0x14300(0xD2) · 0x1499C 큰 예산 확산 → 못 닿으면 0x15342 → ③ 0x15523 되짚기 · 0x14FA4 이번 턴 범위 안 가장 먼 칸
 *   (2026-10-01 근접접근에서 떼어 냄 — 동작 그대로)
 */
function 목적지로걷기(battle, u, Rg, 목x, 목y, 바라볼, 대상, mode, 최소) {
  var Mv = M(), Cb = C();
  var 격자 = !!(battle && battle.unplace && battle.place);
  var ox = u.x | 0, oy = u.y | 0, od = u.dir | 0;
  var 적 = 바라볼;
  var 칸 = { x: 목x | 0, y: 목y | 0 };
  if (칸.x === ox && 칸.y === oy) return null;                   /* 0x406C1~0x406D1 — 목적지가 제자리면 −2 (이동 없음) */

  /* ② 0x14300(0xD2) · 0x1499C — 큰 예산 확산으로 그 칸까지의 경로 */
  var 큰 = 목표확산(battle, u, 칸.x, 칸.y, 0xD2);                /* 0x14300(0xD2) · 0x1499C */
  큰.map = {};
  for (var mi = 0; mi < 큰.left.length; mi++) if (큰.left[mi] >= 0) {
    var mx = mi % 큰.W, my = (mi - mx) / 큰.W; 큰.map[mx + ',' + my] = { x: mx, y: my };
  }
  var 목 = { x: 칸.x, y: 칸.y };
  if (!큰.map[목.x + ',' + 목.y]) {
    /* ★ 0x15342 — 줄 단위로 옮겼다 (2026-09-29)
     *   중심 = 목표 + (나 − 목표) >> 1 (0x15357 sar 1) · 반경 = (나~목표 거리 >> 1) + 7 (0x15390)
     *   마름모 칸마다 확산값 v ≥ 0 (0x153D9) · 점수 = v + 4 × 목표까지 거리(0x153F6 0x49B01 · shl 2)
     *   «엄격히 작을 때만»(0x15407 jge) · 방향 0·1 중 하나로 설 수 있어야(0x15421 0x165C2 · 유닛은 제자리에 둔 채)
     *   ☠ 전에는 목표 둘레 반경 30 에서 거리만 봤다 — 8,20 고블린(2-3)이 원본 9,22 대신 8,23 에 섰다 */
    var tx0 = 칸.x, ty0 = 칸.y;
    var 중x = tx0 + ((ox - tx0) >> 1), 중y = ty0 + ((oy - ty0) >> 1);
    var 반 = ((Math.abs(ox - tx0) + Math.abs(oy - ty0)) >> 1) + 7;
    var 근처 = (Cb && Cb.diamond) ? Cb.diamond(battle, 중x, 중y, 반, true) : [], 근최 = null, 근점 = 0x7FFF;
    for (var j = 0; j < 근처.length; j++) {
      var jx = 근처[j].x, jy = 근처[j].y;
      if (jx < 0 || jy < 0 || jx >= 큰.W || jy >= 큰.H) continue;
      var v = 큰.left[jy * 큰.W + jx];
      if (v < 0) continue;
      var 점 = v + 4 * (Math.abs(jx - tx0) + Math.abs(jy - ty0));
      if (점 >= 근점) continue;
      var 섬 = false;
      /* ☠ (2026-10-02) 0x15421 은 0x165C2(빈 칸 · 지금 이동배열 = 큰 확산 ≥ 0)다 — canPlace(0x16699 테두리·지형)가 아니다 */
      for (var dj = 0; dj < 2 && !섬; dj++) 섬 = Mv.canStand ? Mv.canStand(battle, u, jx, jy, dj, 큰) : (!Mv.canPlace || Mv.canPlace(battle, u, jx, jy, dj));
      if (!섬) continue;
      근점 = 점; 근최 = { x: jx, y: jy };
    }
    if (!근최) return null;                                      /* 0x40718 je 0x40876 */
    목 = { x: 근최.x, y: 근최.y };
  }
  var 길 = 원본되짚기(큰, u, 목.x, 목.y);                        /* 0x15523 */
  if (!길 || 길.length < 2) return null;

  /* ③ 0x14FA4 — 내 쪽부터 따라가며 이번 턴 범위(0x14032·0x143F3) 안인 칸을 스택에 쌓고, 처음 벗어나면 멈춘다 */
  var 스택 = [];
  for (var k = 1; k < 길.length; k++) {
    if (!Rg.map[길[k].x + ',' + 길[k].y]) break;                /* 0x1503E jl 0x1504C */
    스택.push({ x: 길[k].x, y: 길[k].y });                       /* 0x15045 0x13B51 */
  }
  if (!스택.length) return null;
  /* 0x14FBF 자기 발자국을 빼고 잰다(0x165C2) */
  /* ★★★ 0x15065·0x1518B·0x15214 는 0x165C2 — 빈 칸(자기 빼고) 이고 «이번 턴 이동배열» 값 ≥ 0 (2026-10-02)
   *   ☠ canPlace(0x16699)로 재서 이번 턴에 못 가는 칸을 반경 3 후보로 골랐다 → 「못 닿는 칸이면 안 움직임」으로 서 버렸다
   *   (2-4A 씨앗 12345: (23,22) 제국병 — 원본 (20,21) · 우리 제자리. 길 끝 (19,22)에 같은 편 암흑기사 · 후보 (19,21)는 이번 턴 밖) */
  function 설(x, y, d) { return Mv.canStand ? Mv.canStand(battle, u, x, y, d, Rg) : (!Mv.canPlace || Mv.canPlace(battle, u, x, y, d)); }
  function 설방(x, y) {                                          /* 0x15065~ 방향 0·1 중 먼저 되는 것 · 없으면 2 */
    for (var d = 0; d < 2; d++) if (설(x, y, d)) return d;
    return 2;
  }
  function 방향잡기(x, y, 첫방) {                                /* 0x14F52 · 0x1518B · 0x15195~ */
    var d = faceDir({ x: x, y: y }, 적);
    if (설(x, y, d)) return d;                                    /* 0x1518B 0x165C2 */
    if (!(첫방 & 1)) return (y > (적.y | 0)) ? 2 : 첫방;               /* 0x1519C cmp y,적y / jle */
    return (x < (적.x | 0)) ? 3 : 첫방;                               /* 0x151B7 cmp x,적x / jge */
  }
  var 끝 = null, 끝방 = 0;
  if (격자) battle.unplace(u);
  try {
    var P = 스택.pop(), pd = 설방(P.x, P.y);                    /* 0x15056 0x13B9A */
    if (pd < 2) { 끝 = P; 끝방 = pd; }                          /* 0x15097 jne 0x15240 */
    else {
      /* 0x1509D~ — P 둘레 반경 3(마름모 차례) · 값 = 3 − 거리(0x1AD2E) 가 «엄격히 클 때만» · 설 수 있는 칸 */
      var 최고 = -1, 후보 = null, 후보방 = 0;
      var 둘3 = (Cb && Cb.diamond) ? Cb.diamond(battle, P.x, P.y, 3, true) : [];
      for (var q3 = 0; q3 < 둘3.length; q3++) {
        var 값 = 3 - (Math.abs(둘3[q3].x - P.x) + Math.abs(둘3[q3].y - P.y));
        if (값 <= 최고) continue;                                 /* 0x150D8 jle */
        var dd = 설방(둘3[q3].x, 둘3[q3].y);
        if (dd === 2) continue;
        최고 = 값; 후보 = 둘3[q3]; 후보방 = dd;
      }
      if (후보) {
        /* 0x15164 0x15523(후보) — 이번 턴 이동배열로 다시 되짚는다. ☐ 후보가 이번 턴에 못 닿는 칸이면 원본 동작 미확인 → 안 움직임 */
        if (!Rg.map[후보.x + ',' + 후보.y]) return null;
        return { unit: 대상, x: 후보.x, y: 후보.y, dir: 방향잡기(후보.x, 후보.y, 후보방), score: 0, cost: 최소,
                 mode: mode, approach: true, reachable: false, samePlace: (후보.x === ox && 후보.y === oy) };
      }
      /* 0x151E0 — 반경 3 에도 없으면 스택을 거슬러 설 수 있는 칸 */
      while (스택.length) {
        var Q = 스택.pop(), qd = 설방(Q.x, Q.y);
        if (qd < 2) { 끝 = Q; 끝방 = qd; break; }
      }
    }
  } finally { if (격자) battle.place(u, ox, oy, od); }
  if (!끝) return null;                                          /* 0x1524A 스택 빔 → −1 */
  return { unit: 대상, x: 끝.x, y: 끝.y, dir: 방향잡기(끝.x, 끝.y, 끝방), score: 0, cost: 최소, mode: mode,
           approach: true, reachable: false, samePlace: (끝.x === ox && 끝.y === oy) };
}

function approachCell(battle, u, target, Rg) {
  var best = { x: u.x, y: u.y, left: Rg.budget, d: dist(u, target) };

  /* ★ 원거리(무기 5)면 **칠 수 있는 칸**을 먼저 찾는다 */
  var Cb4 = C();
  if (Cb4 && Cb4.attackCells && wtOf(battle, u) === 5) {
    var 옛x = u.x, 옛y = u.y, 옛d = u.dir;
    var 칠수있는 = null;
    for (var k = 0; k < Rg.cells.length; k++) {
      var cc = Rg.cells[k];
      if (!cc.stop) continue;
      /* 그 칸에 서서 표적을 바라볼 때 닿는가 */
      u.x = cc.x | 0; u.y = cc.y | 0; u.dir = faceDir(cc, target) & 3;
      var 닿나 = false;
      try {
        var cs = Cb4.attackCells(battle, u) || [];
        for (var ci = 0; ci < cs.length; ci++)
          if (cs[ci].x === (target.x | 0) && cs[ci].y === (target.y | 0)) { 닿나 = !(Cb4.비행막음 && Cb4.비행막음(battle, u, target)); break; }   /* 0x1A25F */
      } catch (e접) { 닿나 = false; }
      if (!닿나) continue;
      var dd = dist(cc, target);
      /* 닿는 칸 중에서는 **이동력이 많이 남는 쪽**을 고른다(원본 `0x3E739` 취지).
       *   같으면 가까운 쪽 — 굳이 멀리 갈 이유가 없다. */
      if (!칠수있는 || (cc.left | 0) > (칠수있는.left | 0) ||
          ((cc.left | 0) === (칠수있는.left | 0) && dd < 칠수있는.d))
        칠수있는 = { x: cc.x, y: cc.y, left: cc.left | 0, d: dd, cost: cc.cost, tp: cc.tp };
    }
    u.x = 옛x; u.y = 옛y; u.dir = 옛d;
    if (칠수있는) return 칠수있는;
    /* 닿는 칸이 하나도 없으면 아래 예전 방식으로 **가까이만** 간다 */
  }

  for (var i = 0; i < Rg.cells.length; i++) {
    var c = Rg.cells[i];
    if (!c.stop) continue;
    var d = dist(c, target);
    if (d < best.d || (d === best.d && (c.left | 0) > (best.left | 0)))
      best = { x: c.x, y: c.y, left: c.left | 0, d: d, cost: c.cost, tp: c.tp };
  }
  return best;
}

/**
 * 0x3E739 — 모드 1 "안전 접근".
 *   원본은 각 적 반경을 −1 로 막고 위협 지도(링번호×16, 같은 행·열이면 +0x10)를
 *   이동배열에 얹은 뒤 값이 가장 큰 칸을 고릅니다. 여기서는 같은 뜻으로
 *   `점수 = 남은이동력 + (가장 가까운 적까지의 거리 × 16) − 인접 적 수 × 48` 을 씁니다.
 *   ★★★★★ **채우는 규칙을 읽었다 (2026-08-29)** — **더 큰 값만 남긴다.**
 *     ```asm
 *     0x3E826  movsx dx, byte [eax + 0xE65B0]   ; 그 칸의 지금 값
 *     0x3E82E  cmp dx, bx / **jge 건너뜀**       ; ★ 이미 크면 안 덮는다
 *     0x3E833  mov dl, [esp+0x18] · mov [eax + 0xE65B0], dl
 *     0x3E840  call · **shl eax, 4**             ; ★ ×16 (문서의 「링번호×16」)
 *     ```
 *     ⇒ 지도는 **max 누적**이다 — 여러 적의 값이 겹치면 **가장 큰 것**이 남는다.
 *     (`0xE65B0` 은 `0x14067` 이 `0xFF` 로 밀어 두는 그 배열이다.)
 *   ☐ `[esp+0x18]` 이 링 번호 그대로인지는 아직.
 */
function safeApproach(battle, u, Rg, foes) {
  var best = null;
  for (var i = 0; i < Rg.cells.length; i++) {
    var c = Rg.cells[i];
    if (!c.stop) continue;
    var near = 99, nearUnit = null;
    for (var k = 0; k < foes.length; k++) {
      var d = dist(c, foes[k]);
      if (d < near) { near = d; nearUnit = foes[k]; }
    }
    if (!nearUnit) continue;
    var adj = 0;
    for (var q = 0; q < foes.length; q++) if (dist(c, foes[q]) <= 1) adj++;
    var sc = (c.left | 0) + near * 16 - adj * 48;
    if (!best || sc > best.sc) best = { sc: sc, cell: c, unit: nearUnit };
  }
  if (!best) return null;
  return { unit: best.unit, x: best.cell.x, y: best.cell.y,
           dir: faceDir(best.cell, best.unit), score: -best.sc,
           cost: dist(best.cell, best.unit), mode: 1, reachable: true };
}

/* ══════════════════════════════════════════ 6. 필살기 · 마법 고르기 */

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **0x3FFD4 · 0x3F9AD — 필살기 시도 · 고르기** — 줄 단위로 옮겼다 (2026-09-29)
 *   근거: 03_분석/COMBATII/AI대역_분석.md 「0x3F9AD 전문」
 *   ☠ 전에는 ① 마스크로 먼저 걸러 조건 함수(=난수)를 건너뛰었고 ② 확률을 셔플백으로 굴렸고
 *     ③ 0x3F7F3 기준을 «맞은 대상 수»로 ④ 0x3F797 을 100−(TP−150) 으로 ⑤ 0x3F516 반경을 3 으로
 *     ⑥ 0x3F83C·0x3F8A7·0x3F8F6 을 빼먹고 ⑦ 「칠 수 있는 적(0x1D124)」을 거리로 쟀다
 *     ⑧ 등급 추첨(0x2CA40)을 고르기 «뒤»(실행 때)에 했다 — 원본은 고르기 «앞»이고 그 등급이 0x3F516 반경에 들어간다.
 *   ★ 지정 필살기([+0x82])는 **슬롯 번호**로 받는다 — 원본은 링 아이콘 번호라 한 칸 밀리는 버그(필살기번호_버그.md).
 *     사장님 지정(2026-09-29): 「원본대로 한다고 복구하면 안된다」 — 고친 번호를 그대로 쓴다.
 * ══════════════════════════════════════════════════════════════════════ */

/* 연출 대상 목록 [0xF0648] · 개수 [0xF0B9E] — 조건 함수들이 같은 목록을 이어 쓴다(중복 거르기 0x1A221) */
var 대상목록 = [];
function 목록비움() { 대상목록 = []; }
function 칸유닛(battle, x, y) { var t = battle.at ? battle.at(x, y) : null; return (t && t.alive) ? t : null; }   /* 0x11DB2 */
/** 0x1A1F8 — 칸의 유닛이 side 와 적대이고 목록에 없으면 넣고 1 */
function 목록넣기_1A1F8(battle, x, y, side) {
  var t = 칸유닛(battle, x, y);
  if (!t || !C().hostile(side, t.side, battle.confuse)) return 0;              /* 0x1A213 0x1201D */
  if (대상목록.indexOf(t) >= 0) return 0;                                     /* 0x1A224 */
  대상목록.push(t); return 1;
}
/** 0x1A25F — 위와 같되 비행 대상([+0x14]&1)은 비행 시전자만 */
function 목록넣기_1A25F(battle, x, y, u) {
  var t = 칸유닛(battle, x, y);
  if (!t) return 0;
  if (((t.f14 | 0) & 1) && !((u.f14 | 0) & 1)) return 0;                      /* 0x1A270 · 0x1A275 */
  if (!C().hostile(u.side, t.side, battle.confuse)) return 0;                  /* 0x1A28B */
  if (대상목록.indexOf(t) >= 0) return 0;
  대상목록.push(t); return 1;
}
/** 0x1D124 — 지금 자리·방향에서 칠 수 있는 적 수. 목록을 비우고(0x1D136) 채운다 */
function 정면적수(battle, u) {
  목록비움();
  var Cb = C(); if (!Cb || !Cb.attackCells) return 0;
  /* ☠ attackCells 는 무기 ≤ 3(직선)이면 {x,y} 만 준다 — unit·hostile 을 칸마다 직접 가린다 */
  (Cb.attackCells(battle, u) || []).forEach(function (c) {
    var t = (c.unit !== undefined) ? c.unit : 칸유닛(battle, c.x, c.y);
    if (!t || !t.alive) return;
    var 적 = (c.hostile !== undefined) ? c.hostile
           : (Cb.hostile(u.side, t.side, battle.confuse) && !(Cb.비행막음 && Cb.비행막음(battle, u, t)));   /* 0x1A25F */
    if (적 && 대상목록.indexOf(t) < 0) 대상목록.push(t);
  });
  return 대상목록.length;
}
/** 0x1A452(폭 1) — 제 칸부터 바라보는 방향으로 길이 칸 */
function 앞줄(battle, u, 길이) {
  var d = DIR[(u.dir | 0) & 3], out = [];
  for (var i = 0; i < 길이; i++) {
    var x = (u.x | 0) + d.dx * i, y = (u.y | 0) + d.dy * i;
    if (x >= 0 && y >= 0 && x < battle.W && y < battle.H) out.push({ x: x, y: y });
  }
  return out;
}
function 마름모(battle, u, r) { return C().diamond(battle, u.x | 0, u.y | 0, r, true); }          /* 0x1AC08 · 0x1AC59 */
/** [적+0x56] ≥ 직업표 0x71B6E(재행동대기한계) / 2  (0x3F593 sar 0x11) */
function 대기찼나(battle, t) {
  var j = battle.jobOf ? battle.jobOf(t) : null;
  return (t.waitCount | 0) >= (((j && j['재행동대기한계']) | 0) >> 1);
}

/** 0x3F516 — 반경 = 0x2CBFB(필살기사거리 + 등급) 안의 대기 찬 적(칸마다) n → rand(100) < 100n/16 */
function cond3F516(battle, u, 등급, opts) {
  if ((u.stance | 0) & 0x1C) return false;                                    /* 0x3F51E */
  목록비움();                                                                  /* 0x3F52F [0xF0B9E]=0 */
  var n = 0;
  마름모(battle, u, C().specialRadius(battle, u, 등급)).forEach(function (c) {
    var t = 칸유닛(battle, c.x, c.y);
    if (t && C().hostile(u.side, t.side, battle.confuse) && 대기찼나(battle, t)) n++;   /* 0x3F586 cmp ax,1 */
  });
  return 랜(opts, 100) < idiv(100 * n, 16);
}
/** 0x3F5E8 — 반경 5 안의 대기 찬 근접 적(무기 2 아님 · 5 미만) n → s = 3n (100 넘으면 50) · rand(100) < s */
function cond3F5E8(battle, u, opts) {
  if ((u.stance | 0) & 0x1C) return false;                                    /* 0x3F5F1 */
  var n = 0;
  마름모(battle, u, 5).forEach(function (c) {
    var t = 칸유닛(battle, c.x, c.y);
    if (!t || !C().hostile(u.side, t.side, battle.confuse)) return;
    var w = wtOf(battle, t);
    if (w !== 2 && w < 5 && 대기찼나(battle, t)) n++;
  });
  var s = 3 * n; if (s > 100) s = 50;                                          /* 0x3F680 */
  return 랜(opts, 100) < s;
}
/** 0x3F6C1 — 앞줄(필살기사거리 + 무기별 0→10·1→6·3→7·4→5)에 적이 있으면 rand(3) != 0 */
function cond3F6C1(battle, u, opts) {
  var wt = wtOf(battle, u), 표 = { 0: 10, 1: 6, 3: 7, 4: 5 };                 /* 점프표 0x3F6AD */
  var cs = 앞줄(battle, u, C().specialRadius(battle, u, 표[wt] | 0));
  if (wt < 4) cs = cs.slice(1);                                               /* 0x3F724 제 칸 건너뜀 */
  목록비움();                                                                  /* 0x3F737 */
  for (var i = 0; i < cs.length; i++) if (목록넣기_1A1F8(battle, cs[i].x, cs[i].y, u.side) === 1) break;
  return 대상목록.length > 0 && 랜(opts, 3) !== 0;                           /* 0x3F76D · 0x3F77C */
}
/** 0x3F797 — [+0x13]&0x60 실패 · &0x1C 성공 · 칠 수 있는 적이 있으면 rand(100) < TP − 150 */
function cond3F797(battle, u, opts) {
  var st = u.stance | 0;
  if (st & 0x60) return false;
  if (st & 0x1C) return true;
  if (정면적수(battle, u) <= 0) return false;                                  /* 0x3F7C3 */
  return 랜(opts, 100) < (u.tp | 0) - 150;                                    /* 0x3F7E2 */
}
/** 0x3F7F3 — rand(100) < 170 − 사기 (진영 ≤ 2 → [0xF0BA0] 아군 · 그 밖 → [0xF0BA2] 적군) */
function cond3F7F3(battle, u, opts) {
  var m = battle.morale || {};
  var base = ((u.side | 0) <= 2) ? (m.ally | 0) : (m.enemy | 0);
  return 랜(opts, 100) < 170 - base;
}
/** 0x3F83C — 앞줄(필살기사거리 + 5, 제 칸 건너뜀)에 칠 수 있는 적(0x1A25F)이 있나 */
function cond3F83C(battle, u) {
  var cs = 앞줄(battle, u, C().specialRadius(battle, u, 5)).slice(1);
  for (var i = 0; i < cs.length; i++) if (목록넣기_1A25F(battle, cs[i].x, cs[i].y, u) === 1) return true;
  return false;
}
/** 0x3F8A7 — 반경 5 안에 (목록에 없는) 적이 있나. 목록을 비우지 않는다 */
function cond3F8A7(battle, u) {
  var cs = 마름모(battle, u, 5);
  for (var i = 0; i < cs.length; i++) if (목록넣기_1A1F8(battle, cs[i].x, cs[i].y, u.side) === 1) return true;
  return false;
}
/** 0x3F8F6 — 반경 1 안의 적 n → rand(100) < 100n/4 */
function cond3F8F6(battle, u, opts) {
  목록비움();                                                                  /* 0x3F911 */
  마름모(battle, u, 1).forEach(function (c) { 목록넣기_1A1F8(battle, c.x, c.y, u.side); });
  var n = 대상목록.length;
  if (!n) return false;
  return 랜(opts, 100) < idiv(100 * n, 4);                                    /* 0x3F94D */
}

/** 무기별 배운 개수 칸 [+0x38 ~ +0x3C] 와 슬롯 묶음 (0x3F995 점프표 · 필요 TP 표 0x753C4) */
var 필살묶음 = { 1: { m: 0, base: 0, len: 7 }, 3: { m: 1, base: 7, len: 4 }, 4: { m: 2, base: 11, len: 4 },
                 5: { m: 3, base: 15, len: 4 }, 0: { m: 4, base: 19, len: 6 } };

/** 유닛이 배운 슬롯 목록 — 무기 계열 기준 (0x4C03E). */
function learnedSlots(battle, u) {
  var g = 필살묶음[wtOf(battle, u)];
  if (!g) return [];
  var n = Math.min((u.skillExp && u.skillExp[g.m]) | 0, g.len);
  var out = [];
  for (var i = 0; i < n; i++) out.push(g.base + i);
  return out;
}

/**
 * 0x3F9AD — 어떤 필살기를 쓸까.  등급 = 0x2CA40 이 낸 1~3, 지정 = 슬롯 번호 또는 0xFF.
 *   마스크: 지정이면 그 칸만(TP 모자라고 TP ≠ 최대면 −1 · 무기 5 는 곧바로 그 슬롯)
 *           자동이면 TP == 최대 → 배운 것 전부 · 아니면 지금 TP 로 되는 것만
 *   조건 함수는 마스크와 상관없이 **먼저 부른다**(0x3FA71 call → cmp 마스크) — 난수 소비가 원본과 같다.
 */
function chooseSpecial(battle, u, opts, 등급, 지정) {
  opts = opts || {};
  if (등급 == null) 등급 = 1;
  if (지정 == null) 지정 = ai(u).special & 0xFF;
  var Ru = R(), T = battle.T, wt = wtOf(battle, u), g = 필살묶음[wt];
  if (!g) return -1;                                                           /* 0x3F9DD ja · 무기 2 → 0x3FFC7 */
  var cnt = Math.min((u.skillExp && u.skillExp[g.m]) | 0, 7);                  /* [+0x38 + m] */
  if (!cnt) return -1;
  var tp = u.tp | 0, full = (tp === maxTpOf(u));                               /* 0x3F9C9 sete */
  var 마스크 = {};
  if (지정 !== 0xFF) {
    마스크[지정 - g.base] = 1;
    if (tp < Ru.specialTp(지정, T) && !full) return -1;
    if (wt === 5) return 지정;                                                  /* 0x3FDD0 */
  } else {
    for (var k = 0; k < cnt; k++) if (full || tp >= Ru.specialTp(g.base + k, T)) 마스크[k] = 1;
  }
  function M(i) { return 마스크[i] === 1; }

  if (wt === 1) {                                                               /* 0x3F9F0 */
    if (cond3F5E8(battle, u, opts) && M(2)) return 2;
    if (cond3F516(battle, u, 등급, opts) && M(1)) return 1;
    if (cond3F797(battle, u, opts) && M(4)) return 4;
    if (cond3F7F3(battle, u, opts)) {
      if (랜(opts, 3) !== 0 && M(5)) { if (cond3F83C(battle, u)) return 5; }   /* 실패면 0x3FB22 로 */
      else if (M(6) && cond3F8A7(battle, u)) return 6;
    }
    if (cond3F6C1(battle, u, opts) && M(3)) return 3;
    if (정면적수(battle, u) && M(0)) return 0;
    return -1;
  }
  if (wt === 3) {                                                               /* 0x3FB71 */
    if (cond3F516(battle, u, 등급, opts) && M(0)) return 7;
    if (cond3F7F3(battle, u, opts)) {
      if (랜(opts, 3) !== 0 && M(2)) return 9;
      if (M(3) && cond3F83C(battle, u)) return 10;
    }
    if (정면적수(battle, u) && M(1)) return 8;
    return -1;
  }
  if (wt === 4) {                                                               /* 0x3FC97 */
    if (cond3F797(battle, u, opts) && M(1)) return 12;
    if (cond3F8F6(battle, u, opts) && M(3)) return 14;
    if (cond3F6C1(battle, u, opts) && M(2)) return 13;
    if (정면적수(battle, u) && M(0)) return 11;
    return -1;
  }
  if (wt === 5) {                                                               /* 0x3FDA4 */
    if (cond3F7F3(battle, u, opts) && M(2)) return 17;
    if (!정면적수(battle, u)) return -1;
    if (랜(opts, 3) !== 0 && M(0)) return 15;
    return M(1) ? 16 : -1;
  }
  /* wt 0 — 0x3FE94 */
  if (cond3F797(battle, u, opts) && M(1)) return 20;
  if (cond3F7F3(battle, u, opts) && 정면적수(battle, u)) {
    var s = 랜(opts, 2) + 4;                                                    /* 0x3FF62 → 23·24 */
    if (M(s)) return s + 19;
  }
  if (cond3F6C1(battle, u, opts) && M(2)) return 21;
  if (정면적수(battle, u) && M(0)) return 19;
  return -1;
}

/** 0x2CA40 — 필살기 등급 추첨(1~3). 유닛 셔플백 [+0x36][+0x37] 을 진행시킨다 */
function 등급추첨(battle, u, opts) {
  var Cb = C(), Ru = R();
  var v = Cb.view(battle, u);
  var g = Ru.specialClassRoll(v, battle.T, (opts && opts.rng) || Ru.makeRng());
  Cb.commit(battle, u, v);
  return g;
}

/**
 * 0x3FFD4 — AI 필살기 시도.
 *   결과 −1: HP < 2.00 이고 최대 TP < 50 (0x3FFDE) · 0: 못 씀(→ 통상 0x401C0)
 *        1: 쓴다(slot·등급) · 2: 차징 — ☠ 원본 버그: 0x400B4~0x400BD 로 [+0x57]·[+0x81] 을 올린 직후
 *           0x400CD 0x3C993 이 둘 다 0 으로 지우고 TP 를 전부 쓴다. 남는 것은 «TP 0 · 턴 끝»뿐이다.
 */
function 필살시도(battle, u, opts) {
  if ((u.hp | 0) < 200 && maxTpOf(u) < 50) return { 결과: -1 };
  var 등급 = 등급추첨(battle, u, opts);                                         /* 0x3FFFA — 고르기 «앞» */
  var slot, a = ai(u);
  if (u.reserveSpecial | 0) slot = (u.reserveSpecial | 0) - 1;                  /* 0x40009 [+0x81] */
  else if ((a.special & 0xFF) === 0xFE) {
    /* [리마스터] AI 지정 «초필살기»(ring.js AI_SPECIAL_ULT) — 쓸 수 있고 맞을 적이 있으면 쓴다 · 아니면 자동 필살기로 */
    var 초 = 초필살조준(battle, u);
    if (초) return { 결과: 1, slot: -1, 초: 초.번호, 초칸: 초.칸, 초대상들: 초.대상들, 등급: 1 };
    slot = chooseSpecial(battle, u, opts, 등급, 0xFF);
  }
  else if ((a.special & 0xFF) !== 0xFF) {
    slot = chooseSpecial(battle, u, opts, 등급, a.special & 0xFF);
    if (slot === -1 && (a.mode === 1 || a.mode === 2)) slot = chooseSpecial(battle, u, opts, 등급, 0xFF);   /* 0x40035 */
  } else slot = chooseSpecial(battle, u, opts, 등급, 0xFF);
  if (slot === -1) return { 결과: 0, 등급: 등급 };
  /* ★ 무기 계열이 다른 슬롯이면 통상으로 (2026-10-05)
   *   활(무기 5)은 AI 지정값(+0x82)을 그대로 돌려준다(0x3FD7E). 2-5 궁수 23기는 그 칸이 0 → 슬롯 0(검 연)을 골랐고,
   *   우리 실행(combat special)이 «무기 계열이 다릅니다»로 거절 → TP 그대로 → AI 고리가 공격 자세만 되풀이했다.
   *   원본은 필살기가 못 쓰이면 0x400C8 → 0x4010E 로 0 을 내 통상 공격으로 간다 — 그 갈래로 보낸다.
   *   (사장님 「활공격 무한루프도 발생해」 · 「원본에선 안그런다고」) */
  var Cg = C();
  if (Cg && Cg.slotGroup && Cg.slotGroup(slot) !== wtOf(battle, u)) return { 결과: 0, 등급: 등급 };
  var need = R().specialTp(slot, battle.T), tp = u.tp | 0;
  if ((u.chargeTp | 0) + tp < need) {                                          /* 0x40093 */
    if (tp !== maxTpOf(u)) return { 결과: 0, 등급: 등급 };                     /* 0x400A0 */
    return { 결과: 2, slot: slot, 등급: 등급 };
  }
  return { 결과: 1, slot: slot, 등급: 등급 };
}

/**
 * [리마스터] AI 지정 «초필살기» — 지금 자리·방향에서 초필살기를 쓰면 맞는 적을 찾는다.
 *   사장님 11-07 「ai에서 필살기 초를 선택할 수 없어. 원작에서는 1번이 초로 되어있어서 초를 선택하면 1단계 필살기가 나가고, 마지막 단계 필살기를 쓰면 다음 단계로 넘어가는 문제가 있어서 이걸 개선했는데, 실제 초필살기가 있는경우 ai에 지정이 가능하고 이걸 실제로 ai 상태에서 사용할 수 있으면 좋겠어.」
 *   쓸 수 있나 = 초필살 번호(combat.ultimateIndexOf · 0x4BC3C) · 캐릭터↔무기 짝(Rules.ultimateAvailable · 0x4C070) · TP(+집중) ≥ 필요 TP(0x75426) — 링 specialGate 와 같다
 *   고르는 초필살 셋(0 비연참 · 6 풍아열공참 · 11 화염인)은 원작 AI 도 스스로 칸을 고른다(0x2E0F0 · 0x2EA0C · 0x398F3 — 연출_필살기.md)
 *     → 고르는 범위(ultimatePickCells)의 칸마다 닿는 범위(ultimateCells at)에 든 적을 세어 가장 많은 칸 · 비연참은 빈 칸·거리 2 이상(0x30A58·0x30A6C) · 풍아는 적 있는 칸(0x35814)
 *   그 밖은 닿는 범위에 적이 하나라도 있으면 쓴다(원본 함수도 0 명이면 −1).
 * @returns {{번호, 칸, 대상들}|null}
 */
function 초필살조준(battle, u) {
  var Cb = C(), Ru = R();
  if (!Cb || !Ru || !Cb.ultimateIndexOf || !Cb.ultimateCells) return null;
  var n = Cb.ultimateIndexOf(battle, u);
  if (n < 0) return null;
  var ve = Cb.view ? Cb.view(battle, u).equip : null;
  if (ve && Ru.ultimateAvailable && !Ru.ultimateAvailable(u.charCode | 0, ve.weapon, ve.accessory)) return null;
  if ((u.tp | 0) + (u.chargeTp | 0) < (Ru.ultimateTp ? Ru.ultimateTp(n, battle.T) : 0)) return null;
  var 적 = enemiesOf(battle, u);
  function 맞는(cells) {
    var 모 = [];
    (cells || []).forEach(function (c) { var t = battle.at(c.x, c.y); if (t && t.alive && 적.indexOf(t) >= 0 && 모.indexOf(t) < 0) 모.push(t); });
    return 모;
  }
  if (n === 0 || n === 6 || n === 11) {
    var 최 = null;
    (Cb.ultimatePickCells ? Cb.ultimatePickCells(battle, u, n) : []).forEach(function (c) {
      var 선 = battle.at(c.x, c.y);
      if (n === 0 && (선 || (Math.abs((c.x | 0) - (u.x | 0)) + Math.abs((c.y | 0) - (u.y | 0))) < 2)) return;
      if (n === 6 && !(선 && 선.alive && 적.indexOf(선) >= 0)) return;
      var 맞 = (n === 6) ? [선] : 맞는(Cb.ultimateCells(battle, u, n, { at: c }));
      if (!맞.length) return;
      if (!최 || 맞.length > 최.대상들.length || (n === 0 && 맞.length === 최.대상들.length)) 최 = { 번호: n, 칸: { x: c.x | 0, y: c.y | 0 }, 대상들: 맞 };
    });
    if (최 && n === 0) 최.대상들 = null;   /* 비연참 — 대상은 combat.special 이 모은다(플레이어가 빈 칸을 고를 때와 같다 · controller commitAction) */
    return 최;
  }
  var 맞2 = 맞는(Cb.ultimateCells(battle, u, n, null));
  return 맞2.length ? { 번호: n, 칸: null, 대상들: 맞2 } : null;
}

/**
 * 그 필살기가 닿는 최대 거리. 연·격·붕·극·궁 계열은 통상 사거리(0x1D124),
 * 제·파·광은 나선 반경(ITEM +0x38 + 등급), 심(18)은 맵 전체입니다(§4.6).
 */
function specialReach(battle, u, slot) {
  var Cb = C();
  if (slot === 18) return battle.W + battle.H;                      // 궁 '심' — 사거리 무시
  if (slot === 1 || slot === 7) return Math.max(1, Cb.specialRadius(battle, u, 1));
  if (slot === 6) return 2;
  if (slot === 14) return 1;
  if (slot === 3 || slot === 9) return 4;
  if (slot === 5 || slot === 10) return 5;
  if (slot === 13) return Math.max(1, Cb.specialRadius(battle, u, 1));
  if (slot === 21) return 3;
  if (slot === 2 || slot === 4 || slot === 12 || slot === 20 || slot === 22) return 99;  // 자기 자신
  return attackReach(battle, u);
}

/**
 * 0x2E0F0 — AI 가 쓰는 혼(검 5 · 창 10)의 착지 칸 (실행본 COMBATII.EXE 직독 · 2026-11-18)
 *   원본 혼 0x2E25B 는 AI 일 때(0x2E291 [0xF14D8]==1) 칸 고르기 대신 0x2E2A8 call 0x2E0F0 으로 착지 칸을 받는다 · 0 이면 0x2E2B6 −1(필살기 실패 → 0x40114 통상)
 *   ① 0x2E116~0x2E12D 시전자 방향으로 사거리(di)만큼 나간 끝 칸에서 시작 · ② 0x2E150 그 칸에 유닛이 있으면 한 칸 되돌아온다(cx=1)
 *   ③ 0x2E181~0x2E205 시전자 쪽으로 한 칸씩 되돌아오며 — 빈 칸(0x11DB2==0 · 0x13CBD==−1)이면 착지 칸으로 적고(덮어씀)
 *      착지 칸을 적은 뒤 처음 만난 적(0x1201D==1)에서 멈춘다 · ④ 0x2E20B 끝까지 멈추지 않았으면 0(적이 사이에 없음)
 *   사거리 di = 0x2E271 무기종류+5 → 0x2CBFB(ITEM+0x38 + 인자) — combat 혼 칸 범위와 같은 값
 *   [리마스터] 맵 밖 칸은 착지 칸으로 안 잡는다(원본은 맵 밖을 따로 안 본다 · 맵 밖으로 옮기지 않게)
 * @returns {{x,y}|null}
 */
function 혼착지(battle, u, slot, 자리) {
  var Cb = C(); if (!Cb || !Cb.DIR || !Cb.specialRadius) return null;
  var dir = ((자리 && 자리.dir != null) ? 자리.dir : u.dir) & 3, d = Cb.DIR[dir];
  var di = Math.max(1, Cb.specialRadius(battle, u, (slot === 10) ? 6 : 5));
  var x = ((자리 && 자리.x != null) ? 자리.x : u.x) | 0, y = ((자리 && 자리.y != null) ? 자리.y : u.y) | 0;
  x += d.dx * di; y += d.dy * di;                                             /* 0x2E116 di 칸 앞 */
  var 안 = function (cx, cy) { return cx >= 0 && cy >= 0 && cx < (battle.W | 0) && cy < (battle.H | 0); };
  var 섬 = function (cx, cy) { var t = battle.at(cx, cy); return (t && t !== u && t.alive !== false) ? t : null; };
  var cx = 0;
  if (섬(x, y)) { x -= d.dx; y -= d.dy; cx = 1; }                              /* 0x2E150 → 0x2E16D 한 칸 되돌아옴 */
  var 착 = null;
  for (; cx < di; cx++) {                                                     /* 0x2E202 cmp cx, di */
    var t = 섬(x, y);
    if (t) { if (hostile(battle, u, t) && 착) return 착; }                      /* 0x2E1A4 0x1201D == 1 · 착지 칸 있으면 끝(0x2E20B) */
    else if (안(x, y)) 착 = { x: x, y: y };                                     /* 0x2E1D2 착지 칸 적기 */
    x -= d.dx; y -= d.dy;                                                     /* 0x2E1FD 시전자 쪽으로 */
  }
  return null;                                                                /* 0x2E210 — 사이에 적이 없다 */
}

function hasEnemyWithin(battle, u, r) {
  var f = enemiesOf(battle, u);
  for (var i = 0; i < f.length; i++) if (dist(u, f[i]) <= r) return true;
  return false;
}

/**
 * 0x42DC1 — 어떤 마법을 쓸까 (요약본).
 *   레벨 후보를 6 부터 내리면서 MP·TP 가 되는 첫 레벨을 잡고,
 *   대상 상황으로 계열을 고릅니다.
 *     아군 HP 가 70 % 밑인 유닛이 30 % 이상 → 회복(3)
 *     반경 안에 언데드가 있으면 → 회복(3, 언데드에겐 2배 피해)
 *     그 밖 → 공격 계열(화염 0)
 *   ☐ 회차 1~3 (속성 rand(3) · 6 · 4) 분기와 `0x42B77` 의 세부는 아직입니다.
 *     ★ 2026-08-29 — `0x42B77` 을 열어 **회차로 갈리는 것은 확인**했습니다:
 *     ```asm
 *     0x42BD4  cmp di, 0x1        ; ★ **회차(di) 로 갈린다**
 *     0x42BDC  cmp di, 0x2
 *     0x42C03  cmp [ebx+0x1E], 0
 *     0x42C29  cmp [ebx+0x0D], 2   ; 0x42C5C 에서 한 번 더
 *     0x42C33  cmp [ebx+0x61], 0x12C(300)   ; `+0x61` = 직업 번호
 *     0x42C51  cmp eax, [ebx+0x48]          ; HP
 *     0x42C8B  eax = -1                     ;   「없음」
 *     ```
 *     ⇒ 회차 1 · 2 · 그 밖 **세 갈래**라는 읽기가 맞습니다.
 *     ☐ 각 갈래가 **어떤 마법을 고르는지**는 아직 — 값을 옮기지 않습니다.
 */
/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **0x42DC1 — 어떤 마법을 쓸까 (회차 0~3)** — 줄 단위로 옮겼다 (2026-09-29)
 *   근거: 03_분석/COMBATII/AI대역_분석.md 끝 절 「0x42DC1 전문」
 *   반환: 마법번호(속성×21 + 레벨×3 + 랭크) · −1 이번 회차 없음 · −2 레벨 후보 없음(0x432A0 가 곧바로 끝냄)
 * ══════════════════════════════════════════════════════════════════════ */
function 랜(opts, n) { return (opts && opts.rng) ? (opts.rng(n) | 0) : 0; }          /* 0x499BD rand(n) */
function 계열랭크(battle, u, s) {                                                     /* 0x28429 */
  var Rg = root.G2Ring;
  if (Rg && Rg.magicClassOf) return Rg.magicClassOf(battle, u, s);
  var lv = ((u.magicLv && u.magicLv[s]) | 0), cap = battle.T && battle.T['마법최대클래스'], row = cap && cap[u.job | 0];
  var v = ((row && (row[s] | 0) !== 0) ? 1 : 0) + lv; if (v > 3) v = 3; return v - 1;
}
/** 0x42B77(모드, 사거리) — 자기 정면 원본 부채꼴(0x1AF22·자기 칸 소비 0x1B00D)을 훑는다. 있으면 true. */
function 부채꼴대상(battle, u, 모드, 사거리) {
  var Cb = C(); if (!Cb || !Cb.fanCells) return false;
  var F = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }][(u.dir | 0) & 3];
  /* combat.fanCells 는 한 칸 밀어 둔 리마스터 모양이라 시작을 한 칸 당겨 원본 모양으로 */
  var cs = Cb.fanCells(battle, (u.x | 0) - F.dx, (u.y | 0) - F.dy, u.dir | 0, 사거리 | 0, false) || [];
  for (var i = 0; i < cs.length; i++) {
    var t = battle.at(cs[i].x, cs[i].y);
    if (!t || !t.alive) continue;
    var 적 = hostile(battle, u, t);
    if (모드 === 0) { if (!적 && (t.ailment | 0) !== 0) return true; }                              /* 0x42BE8 */
    else if (모드 === 1) {
      if (!적) { if ((t.race | 0) !== 2 && !특수본체(t) && idiv(t.maxHp | 0, 100) * 70 > (t.hp | 0)) return true; }   /* 0x42C13 */
      else if ((t.race | 0) === 2) return true;                                                  /* 0x42C5C */
    } else if (모드 === 2) { if (!적 && ((t.ailment | 0) & 7)) return true; }                     /* 0x42C68 */
  }
  return false;
}
/** 0x42C97 — 진영 명부에서 «전체×100 / 다친 수 < 30» (원본 그대로 — 참이 될 수 없는 식이다) */
function 다친편(battle, side) {
  var 전 = 0, 다 = 0;
  battle.units.forEach(function (t) {
    if (!t.alive) return;
    var s = t.side | 0, 맞 = (side <= 2) ? (s === 1 || s === 2) : (s === side);   /* 0x42CAF 명부 0·1 / 0x42CBC 2 / 0x42CCC 3 */
    if (!맞) return;
    전++; if (idiv(t.maxHp | 0, 10) * 7 > (t.hp | 0)) 다++;
  });
  if (!다) return false;
  return idiv(전 * 100, 다) < 30;
}
/** 0x42D51 — 내가 부른 소환수([+0x12] = 코드+10)가 없거나, 하나이고 HP 절반 미만이면 true */
function 소환필요(battle, u) {
  var 짝 = battle.units.filter(function (t) { return t.alive && (t.side | 0) === (u.side | 0) && (t.summonerTag | 0) === ((u.charCode | 0) + 10); });
  if (!짝.length) return true;
  if (짝.length === 1) return idiv(짝[0].maxHp | 0, 2) > (짝[0].hp | 0);
  return false;
}
/* [리마스터] 소환사AI (정본 479) — 기본 켬 · '원작' 이면 0x43CA9 → 2 그대로(가만히) */
function 소환사AI켬() {
  var O = root.Opt || root.G2Opt, c = O && O.cfg;
  return !(c && c['소환사AI'] === '원작');
}
/** [리마스터] 소환사AI 를 쓸 유닛인가 — 무기 2 · 0x43CA9 → 2 · 소환 계열을 씀 · 토글 켬 (controller runAi 가 무기 2 마법 고리 대신 일반 고리로 보낸다) */
function 소환사AI길(battle, u) {
  return !!(u && 소환사AI켬() && wtOf(battle, u) === 2 && 무기2갈래(u) === 2 && 계열랭크(battle, u, 5) >= 0);
}
/** [리마스터] 소환사AI — 소환이 필요하면(0x42D51) 링 문턱(magicGate)을 넘는 가장 높은 단계의 소환 마법 · 대상은 원본 소환 전용(시전자 둘레) · 못 하면 null */
function 소환시도(battle, u) {
  if (!u || u._마법금지 || ((u.ailment | 0) & 8)) return null;                       /* 마법시도 0x432CA 와 같은 막힘 */
  var 랭 = 계열랭크(battle, u, 5);
  if (랭 < 0 || !소환필요(battle, u)) return null;
  var Rg = root.G2Ring, T = battle.T;
  for (var 레 = 6; 레 >= 0; 레--) {
    var sp = 5 * 21 + 레 * 3 + 랭;
    if (Rg && Rg.magicGate && Rg.magicGate(battle, u, sp, T)) continue;              /* 링과 같은 문턱(클래스·TP·MP) */
    var 대상 = 마법AI대상(battle, u, sp);
    if (!대상) continue;
    return { 결과: 1, spell: sp, 대상: 대상 };
  }
  return null;
}
function 사기(battle, u) { var m = battle.morale || {}; return ((u.side | 0) === 3) ? (m.enemy | 0) : (m.ally | 0); }   /* 0xF0BA2 / 0xF0BA0 */

function 마법고르기(battle, u, 회차, opts) {
  var Ru = R(), T = battle.T, wt = wtOf(battle, u);
  if (회차 === 1 && 랜(opts, 3) === 0) return -1;                                   /* 0x42DD5 */
  if ((u.mp | 0) < 0) return -1;                                                    /* 0x42DE8 */
  var 보정 = Ru ? (Ru.itemFieldS(T, (u.gear || {}).weapon | 0, '마법사거리') | 0) : 0;   /* 0x42E02 ITEM +0x36 */
  var si = 6;
  if ((회차 === 1 || 회차 === 2) && 랜(opts, 3) !== 0) si = 3;                      /* 0x42E1D */
  if ((u.tp | 0) === (maxTpOf(u) | 0) && wt === 2) {                                /* 0x42E31 */
    while (si >= 0 && (u.mp | 0) < Ru.spellMp(si, T)) si--;                         /* MP 만 */
  } else {
    while (si >= 0 && ((u.mp | 0) < Ru.spellMp(si, T) || (u.tp | 0) < Ru.spellTp(si, T, wt))) si--;
  }
  if (si < 0) return -2;                                                            /* 0x42E91 */
  var 속 = -1, 랭 = -1, 레 = -1, f1e = u.ailment | 0;
  if (회차 === 0) {
    if (si > 2 && (f1e & 0x10)) si = 2;
    속 = 3; 랭 = 계열랭크(battle, u, 3); if (랭 < 0) return -1;
    if ((u.side | 0) !== 4 && si === 6 && 사기(battle, u) < 0x50 && (u.mp | 0) > 0x64) 레 = 6;
    else {
      if (si >= 3) {                                                                /* 0x42F2E 반경 랭크×2+3+보정 언데드 적 */
        var 둘 = C().diamond(battle, u.x | 0, u.y | 0, 랭 * 2 + 3 + 보정, false);
        for (var i = 0; i < 둘.length; i++) { var t = battle.at(둘[i].x, 둘[i].y); if (t && t.alive && hostile(battle, u, t) && (t.race | 0) === 2) { 레 = 3; break; } }
      }
      if (레 === -1) {
        if (si >= 2 && 부채꼴대상(battle, u, 0, 보정 + 5)) 레 = 2;
        else if (부채꼴대상(battle, u, 1, 보정 + 5)) 레 = 랜(opts, 2);              /* 0x42FF8 → 0x4325F */
        else {
          var 보조됨 = false;
          if (si >= 3 && 부채꼴대상(battle, u, 2, 보정 + 5)) {
            var 랭4 = 계열랭크(battle, u, 4);
            if (랭4 >= 0) { 속 = 4; 랭 = 랭4; 레 = (si >= 5 && 랜(opts, 3) === 0) ? 5 : 3; 보조됨 = true; }
          }
          if (!보조됨 && (u.mp | 0) > 0x50 && si >= 4 && 다친편(battle, u.side | 0)) 레 = 4;
        }
      }
    }
  } else if (회차 === 1) {
    if (si > 3 && (f1e & 0x10)) si = 3;
    for (var k = 0; k < 3; k++) { 속 = 랜(opts, 3); 랭 = 계열랭크(battle, u, 속); if (랭 >= 0) break; }
    if (랭 < 0) return -1;                                                          /* 0x430EA */
    if (idiv(u.maxHp | 0, 100) * 70 > (u.hp | 0) && (u.mp | 0) > 0x32 && si >= 4 && 소환필요(battle, u)) 레 = 4;   /* 0x430F0 */
    else if ((u.side | 0) !== 4 && si === 6 && 사기(battle, u) < 0x50 && (u.mp | 0) > 0x64) 레 = 6;
    else { 레 = 랜(opts, (si >= 5) ? 5 : si + 1); if (레 === 4) 레 = 5; }           /* 0x4316B · 0x43183 */
  } else if (회차 === 2) {
    if (f1e & 0x10) return -1;                                                      /* 0x43192 */
    속 = 6; 랭 = 계열랭크(battle, u, 6); if (랭 < 0) return -1;
    var 명부 = battle.units.some(function (t) { return !t.alive && !t.명부밖; });   /* [0xD6620] 사망자 명부 · 0x113DD 첫 인자 그대로 */
    if ((u.side | 0) !== 4 && si >= 3 && 소환필요(battle, u) && 사기(battle, u) < 0x50 && (u.mp | 0) > 0x32 && 명부) 레 = 3;
    else { 레 = 랜(opts, si + 1); if (레 === 3) 레 = 0; }                              /* 0x43218 */
  } else if (회차 === 3) {
    if (si > 4 && (f1e & 0x10)) si = 4;
    속 = 4; 랭 = 계열랭크(battle, u, 4); if (랭 < 0) return -1;
    레 = 랜(opts, si + 1);                                                          /* 0x4325B */
  } else return -1;
  if (레 === -1 || 속 > 6 || 레 > 6 || 랭 > 2 || 랭 < 0) return -1;                /* 0x43266 */
  return 속 * 21 + 레 * 3 + 랭;                                                     /* 0x43287 */
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **마법 AI 대상 함수 11개** (0x41715~0x42A1D) — 원본 그대로 (2026-09-29)
 *   마법 함수가 AI 차례([0x74492]==1)면 이 함수로 대상·중심을 찾고, 0 이면 −1(다음 회차).
 *   근거: 03_분석/COMBATII/AI대역_분석.md 끝 절 「마법 AI 대상 함수」
 * ══════════════════════════════════════════════════════════════════════ */
var 앞칸 = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }];
function 무기n(battle, u, n0) {                                      /* 0x28465 = ITEM[무기]+0x36 + n */
  var Ru = R(); return (Ru ? (Ru.itemFieldS(battle.T, (u.gear || {}).weapon | 0, '마법사거리') | 0) : 0) + (n0 | 0);
}
function 층값(battle, x, y) { var t = battle.tile(x, y); var v = t ? (t['값'] | 0) : 0; if (v > 100) v -= 100; return v; }
/* ★ 원본 [+0x61] ≥ 300(0x12C) «특수 본체» — 숫자가 아니라 sprite_semantics 의미로 본다 (2026-09-20 계약 · 2026-10-07)
 *   ☠ 리마스터 특별그림 1107·1109(신디·캐빈 직업 페이지)가 ≥ 300 이라 도주(0x4152B)·회복 대상 등에서 대형 취급됐다 */
function 특수본체(t) { var Ru = R(); return (Ru && Ru.isSpecialBody) ? Ru.isSpecialBody(t) : ((t.sprIndex | 0) >= 0x12C); }
function 빠짐(t) { return ((t.f15 | 0) & 0x80) || (((t.gear || {}).mount | 0) >= 7); }   /* 배리어 · 마장기 (0x417B5 · 0x417BF) */
/** 0x1A1DE + 0x1B7FA — 마법 후보 부채꼴(시작 앞 칸에서 한 칸 물러 0x1AF22 폭 1 · 첫 칸 소비) + 한 층 넘는 칸 제외(0x1B8A8) */
function 마법부채꼴(battle, u, n) {
  var Cb = C(); if (!Cb || !Cb.fanCells) return [];
  var F = 앞칸[(u.dir | 0) & 3];
  var base = (층값(battle, u.x | 0, u.y | 0) & 0xF0) + 0x10;        /* 0x1B83E 물러난 칸(= 시전자 칸) 층 */
  return (Cb.fanCells(battle, (u.x | 0) - F.dx, (u.y | 0) - F.dy, u.dir | 0, n | 0, false) || []).filter(function (c) {
    var v = 층값(battle, c.x, c.y); return v !== 0 && v <= base;
  });
}
/** 0x1B7FA 가 [0xF0648] 에 모으는 유닛 — 부채꼴 차례 · 적대 여부가 flag 와 같은 것 */
function 부채꼴유닛(battle, u, cells, 적만) {
  var out = [], 본 = {};
  cells.forEach(function (c) {
    var t = battle.at(c.x, c.y);
    if (!t || !t.alive || 본[t.id]) return;
    if (hostile(battle, u, t) !== 적만) return;
    본[t.id] = 1; out.push(t);
  });
  return out;
}
function 잃은HP(t) { return idiv((t.maxHp | 0) - (t.hp | 0), 100); }
function 권(battle, t) { return effOf(battle, t).cha | 0; }
function 저항(battle, t) { return effOf(battle, t).mr | 0; }
function 거리16(u, x, y) { return (Math.abs((u.x | 0) - x) + Math.abs((u.y | 0) - y)) <= 0x10; }

/** 0x41715 — 부채꼴 적 한 명 (모드 0·1·5·6 거리 · 2 HP · 3 저항(+권 이어짐) · 4 권 최대) */
function AI_41715(battle, u, n0) {
  var list = 부채꼴유닛(battle, u, 마법부채꼴(battle, u, 무기n(battle, u, n0)), true);
  var mode = ai(u).mode | 0, best = (mode === 4) ? -1 : 0x7FFF, 고른 = null;
  list.forEach(function (t) {
    if (빠짐(t)) return;
    var v;
    if (mode === 2) { v = t.hp | 0; if (v < best) { best = v; 고른 = t; } }
    else if (mode === 3) { v = 저항(battle, t); if (v < best) { best = v; 고른 = t; } v = 권(battle, t); if (v > best) { best = v; 고른 = t; } }
    else if (mode === 4) { v = 권(battle, t); if (v > best) { best = v; 고른 = t; } }
    else { v = dist(u, t); if (v < best) { best = v; 고른 = t; } }
  });
  if (!고른 || best === -1 || best === 0x7FFF || !거리16(u, 고른.x, 고른.y)) return null;
  return { unit: 고른, x: 고른.x | 0, y: 고른.y | 0 };
}
/** 0x4189C — 속성 부여: 부채꼴 아군 + 자기(끝) 중 첫 유닛(배리어·마장기·wt2·wt≥6·이미 속성 제외) */
function AI_4189C(battle, u, n0) {
  var list = 부채꼴유닛(battle, u, 마법부채꼴(battle, u, 무기n(battle, u, n0)), false).concat([u]);
  for (var i = 0; i < list.length; i++) {
    var t = list[i], wt = wtOf(battle, t);
    if (빠짐(t) || wt === 2 || wt >= 6 || ((t.f15 | 0) & 7)) continue;
    return 거리16(u, t.x, t.y) ? { unit: t, x: t.x | 0, y: t.y | 0 } : null;
  }
  return null;
}
/** 중심 고르기 틀(0x419F1·0x41BF5·0x42375·0x4258C·0x42743) — 부채꼴 칸마다 점수, 엄격히 큰 것. 자기칸 후보 여부는 호출자가. */
function 중심고르기(battle, u, n0, 자기칸, 점수) {
  var cells = 마법부채꼴(battle, u, 무기n(battle, u, n0));
  if (자기칸) cells = [{ x: u.x | 0, y: u.y | 0 }].concat(cells);        /* 0x42414·0x42636·0x427FB 시전자 칸을 «먼저» 평가 */
  var best = 0, 고른 = { x: u.x | 0, y: u.y | 0 };
  cells.forEach(function (c) { var s = 점수(c); if (s > best) { best = s; 고른 = { x: c.x, y: c.y }; } });
  if (!거리16(u, 고른.x, 고른.y) && best > 0) return null;              /* 0x41BAA */
  return best > 0 ? { unit: battle.at(고른.x, 고른.y) || null, x: 고른.x, y: 고른.y, score: best } : null;
}
function 모드점수(battle, u, t, 표) {                                  /* 표: 모드별 'n' 수 · 'h' 잃은HP · 'r' 120−저항 · 'c' 권 */
  var k = 표[ai(u).mode | 0] || 'n';
  return k === 'n' ? 1 : k === 'h' ? 잃은HP(t) : k === 'r' ? (0x78 - 저항(battle, t)) : 권(battle, t);
}
var 적표 = ['n', 'n', 'h', 'r', 'c', 'n', 'n'];                       /* 0x419D5 · 0x41BD9 */
function 둘레유닛(battle, cx, cy, r, 거르개) {
  var Cb = C(), out = [];
  (Cb.diamond(battle, cx, cy, r | 0, true) || []).forEach(function (c) { var t = battle.at(c.x, c.y); if (t && t.alive && 거르개(t)) out.push(t); });
  return out;
}
/** 0x419F1 — 넓이 중심(적): 중심 둘레 반경 r 마름모의 적 점수 합 */
function AI_419F1(battle, u, n0, r) {
  return 중심고르기(battle, u, n0, false, function (c) {
    var s = 0; 둘레유닛(battle, c.x, c.y, r, function (t) { return !빠짐(t) && hostile(battle, u, t); })
      .forEach(function (t) { s += 모드점수(battle, u, t, 적표); }); return s;
  });
}
/** 0x41BF5 — 띠(폭 9 · 깊이 3, 중심에서 옆으로 ±4 · 앞으로 3줄)의 적 점수 합 */
function AI_41BF5(battle, u, n0) {
  var F = 앞칸[(u.dir | 0) & 3], P = { dx: F.dy, dy: F.dx };
  return 중심고르기(battle, u, n0, false, function (c) {
    var s = 0;
    for (var j = 0; j < 3; j++) for (var k = -4; k <= 4; k++) {
      var x = c.x + P.dx * k + F.dx * j, y = c.y + P.dy * k + F.dy * j, t = battle.at(x, y);
      if (t && t.alive && !빠짐(t) && hostile(battle, u, t)) s += 모드점수(battle, u, t, 적표);
    }
    return s;
  });
}
/** 0x41E41 — 레벨4 앞 영역(플레이어 Lv4 범위와 같은 모양) · 점수는 원본대로 **시전자** 값을 더한다 */
function AI_41E41(battle, u, spell) {
  var Cb = C(), cells = (Cb.rangeOf ? Cb.rangeOf(battle, u, 'magic', { spell: spell, rank: spell % 3 }) : []) || [];
  var 표 = ['n', 'n', 'h', 'r', 'c', 'h', 'n'][ai(u).mode | 0] || 'n', s = 0;   /* 0x41E25 */
  cells.forEach(function (c) {
    var t = battle.at(c.x, c.y);
    if (!t || !t.alive || t === u || !hostile(battle, u, t) || 빠짐(t)) return;
    s += 표 === 'n' ? 1 : 표 === 'h' ? 잃은HP(u) : 표 === 'r' ? (0x78 - 저항(battle, u)) : 권(battle, u);
  });
  return s > 0 ? { unit: null, x: u.x | 0, y: u.y | 0, score: s } : null;
}
/** 0x42025 — 자기 둘레 마름모(반경 무기+랭크×2+3, 종류 4 는 −2 · 아군) · 점수는 **시전자** 값 */
function AI_42025(battle, u, 랭크, 종류) {
  var 아군 = (종류 === 4), r = 무기n(battle, u, 랭크 * 2 + 3) - (아군 ? 2 : 0);
  var 표 = ['n', 'n', 'h', 'r', 'c', 'n', 'n'][ai(u).mode | 0] || 'n', s = 0;   /* 0x42009 */
  둘레유닛(battle, u.x | 0, u.y | 0, r, function (t) {
    return hostile(battle, u, t) === !아군 && !빠짐(t) && !(아군 && 특수본체(t));
  }).forEach(function () { s += 표 === 'n' ? 1 : 표 === 'h' ? 잃은HP(u) : 표 === 'r' ? (0x78 - 저항(battle, u)) : 권(battle, u); });
  return s > 0 ? { unit: null, x: u.x | 0, y: u.y | 0, score: s } : null;
}
function 회복대상(battle, u, t) {                                      /* 0x42274~0x422B4 */
  if (빠짐(t) || 특수본체(t)) return false;
  if (!hostile(battle, u, t) && idiv(t.maxHp | 0, 100) * 70 > (t.hp | 0)) return true;
  return (t.race | 0) === 2;
}
/** 0x42151 — 회복 한 명(부채꼴 + 자기 칸): 다친 아군 또는 언데드 · 모드 0·1·5·6 거리 · 2·3 HP · 4 권 */
function AI_42151(battle, u, n0) {
  var cells = [{ x: u.x | 0, y: u.y | 0 }].concat(마법부채꼴(battle, u, 무기n(battle, u, n0)));   /* 0x42212 시전자 칸 먼저 */
  var mode = ai(u).mode | 0, best = (mode === 4) ? 0 : 0x7FFF, 고른 = null;
  cells.forEach(function (c) {
    var t = battle.at(c.x, c.y); if (!t || !t.alive || !회복대상(battle, u, t)) return;
    var v;
    if (mode === 2 || mode === 3) { v = t.hp | 0; if (v < best) { best = v; 고른 = t; } }
    else if (mode === 4) { v = 권(battle, t); if (v > best) { best = v; 고른 = t; } }
    else { v = dist(u, t); if (v < best) { best = v; 고른 = t; } }
  });
  if (!고른 || best === 0 || best === 0x7FFF || !거리16(u, 고른.x, 고른.y)) return null;
  return { unit: 고른, x: 고른.x | 0, y: 고른.y | 0 };
}
/** 0x42375 — 회복 넓이 중심(부채꼴 + 자기 칸) · 반경 r 안 회복대상 점수 */
function AI_42375(battle, u, n0, r) {
  var 표 = ['n', 'n', 'h', 'h', 'c', 'n', 'n'];                       /* 0x42359 */
  return 중심고르기(battle, u, n0, true, function (c) {
    var s = 0; 둘레유닛(battle, c.x, c.y, r, function (t) { return 회복대상(battle, u, t); })
      .forEach(function (t) { s += 모드점수(battle, u, t, 표); }); return s;
  });
}
/** 0x4258C — 치료 중심(부채꼴 + 자기 칸) · 반경 r 안 상태이상 걸린 아군 수 */
function AI_4258C(battle, u, n0, r) {
  return 중심고르기(battle, u, n0, true, function (c) {
    return 둘레유닛(battle, c.x, c.y, r, function (t) { return !빠짐(t) && !hostile(battle, u, t) && (t.ailment | 0) !== 0; }).length;
  });
}
/** 0x42743 — 상태 마법 중심 · 마스크 < 0xFF 아군 강화 / ≥ 0xFF 적 약화 */
function AI_42743(battle, u, n0, r, mask) {
  var 적 = mask >= 0xFF;
  return 중심고르기(battle, u, n0, !적, function (c) {
    var s = 0;
    둘레유닛(battle, c.x, c.y, r, function (t) { return !빠짐(t); }).forEach(function (t) {
      if (hostile(battle, u, t) !== 적 || 특수본체(t)) return;
      if (!적 ? ((t.f15 | 0) & mask) : ((t.ailment | 0) & (mask >> 8))) return;   /* 0x428FE · 0x42909 이미 걸림 */
      if (mask === 8) { if (wtOf(battle, t) === 2) return; s++; return; }             /* 0x4293B */
      if (mask === 0x40) { if ((t.ailment | 0) & 7) s += 2; return; }                 /* 0x42952 */
      if (mask === 0x800) {                                                           /* 0x4295F 스틸MP */
        if ((t.mp | 0) === 0) return;
        for (var s7 = 0; s7 < 7; s7++) if (계열랭크(battle, t, s7) >= 0) { s++; return; }
        return;
      }
      if (mask === 0x4000) { if ((t.ailment | 0) & 0x20) return; s++; return; }       /* 0x42982 */
      s++;
    });
    return s;
  });
}
/** 0x42A1D — 부채꼴 적 · 인자 0: 장비 칸이 다 같지 않은 적 / 1: 그림<300 && 권≤50 · 맨 나중에 맞는 적 */
function AI_42A1D(battle, u, n0, 인자) {
  var list = 부채꼴유닛(battle, u, 마법부채꼴(battle, u, 무기n(battle, u, n0)), true), 고른 = null;
  list.forEach(function (t) {
    if (빠짐(t)) return;
    if (인자 === 0) {
      var g = t.gear || {};
      if ((g.shield | 0) === (g.weapon | 0) && (g.weapon | 0) === (g.charm | 0) && (g.charm | 0) === (g.sub | 0) && (g.sub | 0) === (g.sub2 | 0)) return;   /* 0x42AC7 [+0x5A..0x5F] (탈것 [+0x5C] 는 안 본다) */
    } else if (특수본체(t) || 권(battle, t) > 0x32) return;
    고른 = t;
  });
  if (!고른 || !거리16(u, 고른.x, 고른.y)) return null;
  return { unit: 고른, x: 고른.x | 0, y: 고른.y | 0 };
}

/** 마법 번호 → 원본 AI 대상 함수 (0xF13B0 49칸 흐름 추적) · null = 대상 없음 · true = 대상 함수 없이 시전 */
function 마법AI대상(battle, u, spell) {
  var s = Math.floor(spell / 21), L = Math.floor((spell % 21) / 3), k = spell % 3;
  var 명부 = function () { return battle.units.some(function (t) { return !t.alive && !t.명부밖; }); };
  if (s <= 2) {
    if (L === 0) return AI_41715(battle, u, k > 0 ? 7 : 5);                 /* 0x28EE5 */
    if (L === 1) return AI_4189C(battle, u, k > 1 ? 7 : 5);                 /* 0x29284 */
    if (L === 2) return (k === 1) ? AI_41BF5(battle, u, 5) : AI_419F1(battle, u, k + 5, k + 3);   /* 0x29526 */
    if (L === 3) return AI_41E41(battle, u, spell);
    if (L === 5) return AI_42025(battle, u, k, s);                          /* 0x2A1C6 */
    return { unit: null, x: u.x | 0, y: u.y | 0, 전용: true };             /* 5 소환 0x29F4D · 7 0x2A75A — 원본과 같음(2026-10-13 역어셈): 0x29F4D·0x2A75A 는 범위를 시전자 둘레로 만들고(0x29C5A·0x29D88) AI(0x74492≠0)면 확인 키(0x4A815) 없이 바로 시전 · 소환 자리도 시전자 둘레 자리표(0x29C5A) · 사장님 「원소 회복 5, 7 은 원래 대상을 고르는 마법이 아니야」 */
  }
  if (s === 3) {
    if (L === 0) return AI_42151(battle, u, k > 1 ? 7 : 5);                 /* 0x2B9D3 */
    if (L === 1) return AI_42375(battle, u, 5, k + 2);                      /* 0x2BAA1 */
    if (L === 2) return AI_4258C(battle, u, 5, k);                          /* 0x2B1F8 */
    if (L === 3) return AI_42025(battle, u, k, 3);                          /* 0x2BBFB 턴언데드 */
    if (L === 5) return 명부() ? { unit: null, x: u.x | 0, y: u.y | 0, 전용: true } : null;   /* 0x2BC55 */
    return { unit: null, x: u.x | 0, y: u.y | 0, 전용: true };             /* ☐ 5 0x2A75A · 7 — 원본과 같음(2026-10-13 역어셈): 0x29F4D·0x2A75A 는 범위를 시전자 둘레로 만들고(0x29C5A·0x29D88) AI(0x74492≠0)면 확인 키(0x4A815) 없이 바로 시전 · 소환 자리도 시전자 둘레 자리표(0x29C5A) · 사장님 「원소 회복 5, 7 은 원래 대상을 고르는 마법이 아니야」 */
  }
  if (s === 4) {
    if (L === 5) return AI_42025(battle, u, k, 4);                          /* 0x2BF25 */
    var 표 = [[1, 8], [2, 0x10], [3, 0x20], [3, 0x40], [1, 0x800], null, [3, 0x2000]][L];   /* 0x2BE4C… */
    /* ★ 반경 = 랭크(k) — 원본 0x2B391: 0x74492==1(AI) 이면 0x42743(시전자, 5, dx, 상태비트) · 대상 모으기 0x28A97 도 같은 dx(반경) (2026-10-12 정정)
     *   ☠ 예전엔 표[0](1·2·3·3·1·-·3)을 반경으로 썼다 — 그것은 진입부 0x2BE4C 의 ecx(이름 띠 0x4F460 인자)였다.
     *   AI 는 반경 3 으로 겨누고 효과는 랭크 반경이라 커스가 아무도 안 맞는 자리에 떨어졌다 (사장님 「매직아머와 커스를 안내인이 사용하는데, 제대로 발동하지 않아」) */
    return AI_42743(battle, u, 5, k, 표[1]);
  }
  if (s === 5) return { unit: null, x: u.x | 0, y: u.y | 0, 전용: true };   /* 소환 — 원본과 같음(2026-10-13 역어셈): 0x29F4D·0x2A75A 는 범위를 시전자 둘레로 만들고(0x29C5A·0x29D88) AI(0x74492≠0)면 확인 키(0x4A815) 없이 바로 시전 · 소환 자리도 시전자 둘레 자리표(0x29C5A) · 사장님 「원소 회복 5, 7 은 원래 대상을 고르는 마법이 아니야」 */
  if (L === 0) return AI_42743(battle, u, 5, k, 0x1000);                    /* 0x2C004 → 0x2B1D0 bx=1 */
  if (L === 1) return AI_42A1D(battle, u, 5, 0);                            /* 0x2C027 */
  if (L === 2) return AI_42A1D(battle, u, 5, 1);                            /* 0x2C2A4 */
  if (L === 3) return 명부() ? { unit: null, x: u.x | 0, y: u.y | 0, 전용: true } : null;   /* 0x2C380 */
  if (L === 4) return AI_42743(battle, u, 5, 0, 0x4000);                    /* 0x2C47E */
  if (L === 5) return AI_419F1(battle, u, 5, k + 3);                        /* 0x2C575 */
  return AI_42025(battle, u, k, 5);                                         /* 0x2C633 */
}

/**
 * 0x432A0 — 마법 한 번 시도. 회차 0~3(차징 중이면 1회), 지정마법 먼저, 대상 함수가 못 찾으면 다음 회차.
 * @returns {{결과:1|2|0|-1, spell, 대상}} 1 시전 · 2 차징 · 0 못 함 · −1 조건 미달
 */
function 마법시도(battle, u, opts) {
  /* [리마스터] _마법금지 — 마법을 시도하지 않는다(«못 함» 0 → 마법형 고리는 이동으로 넘어간다) · 용자의 무덤 16층 공격 성향 0 리치 (2026-10-12 사장님 「리치는 막고」 · 창1 원거리형 성향 0 은 마법을 안 쓴다 0x2BA04) */
  if (u && u._마법금지) return { 결과: 0 };
  var Ru = R(), T = battle.T, a = ai(u), wt = wtOf(battle, u);
  if ((u.mp | 0) < 10 || (u.tp | 0) < 0x32 || ((u.ailment | 0) & 8)) return { 결과: -1 };   /* 0x432B5~0x432CA */
  var 차징 = (u.reserveSpell | 0);
  var 번 = 차징 ? 1 : 4;
  for (var di = 0; di < 번; di++) {
    var sp;
    if (차징) sp = 차징 - 1;
    else if (di === 0 && (a.magic & 0xFF) !== 0xFF) {                                   /* 0x4331A 지정마법 */
      var m = a.magic & 0xFF, rk = 계열랭크(battle, u, Math.floor(m / 7));
      sp = (rk < 0) ? -1 : rk + m * 3;
      if (sp >= 0 && (u.mp | 0) < Ru.spellMp(m % 7, T)) sp = -1;                       /* 0x4336E */
    } else {
      sp = 마법고르기(battle, u, di, opts);
      if (sp === -2) return { 결과: 0 };                                                /* 0x43394 */
    }
    if (sp < 0) continue;
    var lv = Math.floor(sp / 3) % 7, need = Ru.spellTp(lv, T, wt);
    if (need > (u.tp | 0) + (u.chargeTp | 0)) {                                         /* 0x433E7 */
      if ((u.tp | 0) === (maxTpOf(u) | 0)) return { 결과: 2, spell: sp };               /* 0x433F0 차징 */
      continue;
    }
    var 대상 = 마법AI대상(battle, u, sp);
    if (!대상) continue;                                                                 /* 0x434AD −1 → 다음 회차 */
    return { 결과: 1, spell: sp, 대상: 대상 };
  }
  return { 결과: 0 };
}

/**
 * 0x3E3BF + 0x3E739 — **안전 접근** (원본 그대로 · 2026-09-29)
 *   ① 0x3E3BF: 반경 max(a1,3) 마름모의 적 목록(위→아래·왼→오른)
 *   ② 적마다 반경 a2 칸을 이동배열 −1 (0x13D02 · 테두리 x 2..W−3 · y 4..H−5)
 *   ③ 적마다 반경 a2+3 에 위협 = (반경 − 거리)×16 (+16 같은 행·열) — 큰 값만 (0x3E826 jge)
 *   ④ 같은 반경에서 이동배열 값이 0..0x31F 인 칸에 위협 + 0x320 을 한 번 더한다 (0x3E8F5 jae)
 *   ⑤ 자기 둘레 반경 a1 에서 값이 **엄격히 최대**이고 방향 0 또는 1 로 설 수 있는 칸 (0x3E971 jle)
 *   ⑥ 그 칸에서 맨해튼 가장 가까운 적(엄격히 작은 것)을 바라본다
 * @returns {{unit,x,y,dir}|null}
 */
function 안전접근(battle, u, Rg, a1, a2, 주어진적) {
  var Cb = C(), Mv = M(), W = battle.W, H = battle.H;
  var foes = 주어진적 || [], 본 = {};
  if (!주어진적) Cb.diamond(battle, u.x | 0, u.y | 0, Math.max(a1 | 0, 3), true).forEach(function (c) {   /* 0x3E3BF */
    var t = battle.at(c.x, c.y); if (t && t.alive && hostile(battle, u, t) && !본[t.id]) { 본[t.id] = 1; foes.push(t); }
  });
  if (!foes.length) return null;
  var L = new Int32Array(Rg.left.length); for (var i = 0; i < L.length; i++) L[i] = Rg.left[i];
  function 안(x, y) { return x >= 2 && x <= W - 3 && y >= 4 && y <= H - 5; }                   /* 0x13D02 · 0x3E8AE */
  foes.forEach(function (f) { Cb.diamond(battle, f.x | 0, f.y | 0, a2, true).forEach(function (c) { if (안(c.x, c.y)) L[c.y * W + c.x] = -1; }); });
  var R5 = a2 + 3, T = {};
  foes.forEach(function (f) {
    Cb.diamond(battle, f.x | 0, f.y | 0, R5, true).forEach(function (c) {
      var v = (R5 - (Math.abs(c.x - f.x) + Math.abs(c.y - f.y))) * 16 + ((c.x === (f.x | 0) || c.y === (f.y | 0)) ? 0x10 : 0);
      var k = c.y * W + c.x; if (T[k] == null || T[k] < v) T[k] = v;
    });
  });
  foes.forEach(function (f) {
    Cb.diamond(battle, f.x | 0, f.y | 0, R5, true).forEach(function (c) {
      if (!안(c.x, c.y)) return;
      var k = c.y * W + c.x;
      if (L[k] < 0 || L[k] >= 0x320) return;
      L[k] += (T[k] | 0) + 0x320;
    });
  });
  var best = 0, 고른 = null;
  if (battle.unplace) battle.unplace(u);
  try {
    Cb.diamond(battle, u.x | 0, u.y | 0, a1 | 0, true).forEach(function (c) {
      var v = (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) ? L[c.y * W + c.x] : -1;
      if (!(v > best)) return;
      for (var d = 0; d < 2; d++) {                                                          /* 0x3E98D 0x165C2 방향 0·1 */
        if (!Mv.canPlace || Mv.canPlace(battle, u, c.x, c.y, d)) { best = v; 고른 = { x: c.x, y: c.y, dir: d }; break; }
      }
    });
  } finally { if (battle.place) battle.place(u, u.x, u.y, u.dir); }
  if (!고른) return null;
  var 가까운 = null, bd = 0x7FFF;
  foes.forEach(function (f) { var dd = Math.abs(f.x - 고른.x) + Math.abs(f.y - 고른.y); if (dd < bd) { bd = dd; 가까운 = f; } });
  return { unit: 가까운, x: 고른.x, y: 고른.y, dir: 가까운 ? faceDir(고른, 가까운) : 고른.dir, mode: '안전접근', approach: true };
}

/** 마법 시도 결과 → 계획. 대상 함수가 고른 칸을 `magicAt` 으로 넘긴다(실행기 targetTiles[0]). */
function 마법계획(battle, u, plan, 시) {
  var Ru = R(), p = C().spellParts(시.spell);
  plan.kind = 'magic'; plan.spell = 시.spell;
  plan.need = Ru.spellTp(p.level, battle.T, wtOf(battle, u));
  plan.charge = (시.결과 === 2);
  if (시.대상) {
    plan.target = { unit: 시.대상.unit || null, x: 시.대상.x, y: 시.대상.y, dir: u.dir | 0 };
    plan.magicAt = { x: 시.대상.x | 0, y: 시.대상.y | 0 };
  }
  plan.reason = plan.charge ? '마법 차징(+0x7F) 0x432A0' : ('마법 ' + 시.spell + ' (0x432A0)');
  plan.endStance = endStance(battle, u);
  return plan;
}
/** 0x43C1C~0x43C3B — 0x432A0 을 9번까지. 0 이 아니면(시전·차징·조건 미달) 멈춘다 · TP 가 0 이면 멈춘다(0x43C2C 0x1A0E9=[0xF0428]) */
function 원거리마법9번(battle, u, opts) {
  for (var n = 0; n < 9; n++) {
    var 시 = 마법시도(battle, u, opts);
    if (시.결과 === 1 || 시.결과 === 2) return 시;
    if (시.결과 !== 0) return null;
    if (!(u.tp | 0)) return null;
  }
  return null;
}
/**
 * 0x3E457(u, n) — 원거리 마법형의 «다친 아군» 찾기 (2026-10-07 줄 단위)
 *   0x3E47A 내 HP < 최대÷10×7(jg) 또는 0x3E47F [+0x1E] ≠ 0 → −1
 *   n = max(n, 3) · 0x3E49F 0x3E3BF(반경 n 적) → 적마다 반경 2 를 이동배열 −1(0x3E4E8 0x13D02 · 테두리 x 2..W−3 · y 4..H−5)
 *   0x3E511 내 둘레 반경 n 칸의 유닛 중 적이 아니고(0x1201D) [+0x0D] ≠ 2 · [+0x61] < 300 · (HP < 최대÷10×7 또는 [+0x1E] ≠ 0) 인 것을 목록에
 * @returns {-1 | {목록, Rg}}  Rg = 막은 칸을 뺀 사본(0x3E739 가 그 이동배열을 본다)
 */
function 다친아군(battle, u, n, Rg) {
  if (idiv(u.maxHp | 0, 10) * 7 > (u.hp | 0) || (u.ailment | 0) !== 0) return -1;   /* 0x3E47A jg · 0x3E47F */
  var Cb = C(), W = battle.W, H = battle.H;
  n = Math.max(n | 0, 3);                                                           /* 0x3E48F cmp di,3 */
  var left = new Int32Array(Rg.left.length); for (var i = 0; i < left.length; i++) left[i] = Rg.left[i];
  var map = {}; Object.keys(Rg.map || {}).forEach(function (k) { map[k] = Rg.map[k]; });
  function 안(x, y) { return x >= 2 && x <= W - 3 && y >= 4 && y <= H - 5; }        /* 0x13D02 */
  Cb.diamond(battle, u.x | 0, u.y | 0, n, true).forEach(function (c) {             /* 0x3E3BF */
    var t = 칸유닛(battle, c.x, c.y);
    if (!t || t === u || !hostile(battle, u, t)) return;
    Cb.diamond(battle, t.x | 0, t.y | 0, 2, true).forEach(function (q) {            /* 0x3E4B7 ebx=2 */
      if (!안(q.x, q.y)) return;
      left[q.y * W + q.x] = -1; delete map[q.x + ',' + q.y];
    });
  });
  var 목록 = [], 본 = {};
  Cb.diamond(battle, u.x | 0, u.y | 0, n, true).forEach(function (c) {             /* 0x3E511 · 0x3E538 0x11DB2 */
    var t = 칸유닛(battle, c.x, c.y);
    if (!t || 본[t.id] || hostile(battle, u, t)) return;                             /* 0x3E551 0x1201D */
    if ((t.race | 0) === 2 || 특수본체(t)) return;                                   /* 0x3E55B [+0x0D]==2 · 0x3E561 [+0x61]≥300 */
    if (!(idiv(t.maxHp | 0, 10) * 7 > (t.hp | 0) || (t.ailment | 0) !== 0)) return; /* 0x3E576 jg · 0x3E57B */
    본[t.id] = 1; 목록.push(t);
  });
  var Rg2 = Object.assign({}, Rg, { left: left, map: map });
  return { 목록: 목록, Rg: Rg2 };
}

/**
 * 0x3E01B(u, R) — 원거리 마법형의 «먼 접근» = 아군 곁 자리 (2026-10-07 줄 단위)
 *   0x3E041 나를 맵에서 뺀다 · 0x3E054 내 둘레 마름모 반경 R(호출부 0x43A4E edx=0x1E) 칸마다(위→아래·왼→오른)
 *   빈 칸(0x3E07D 0x11DB2 == 0)만 · 0x3E0B2 그 칸 둘레 반경 3 의 유닛 중 적이 아닌 것(0x3E0EE 0x1201D == 0)마다
 *   점수 += 10 · 그 유닛 방향 [+0x63] 칸 수 +1 → 0x3E11C 점수 += R − 거리(나, 칸)
 *   «엄격히 클 때만»(0x3E12D jle) 그 칸 · 방향 = 칸 수가 엄격히 가장 많은 방향(0x3E156 jge · 0 부터) · 0 이면 못 찾음
 * @returns {{x,y,dir,score}|null}
 */
function 원거리먼자리(battle, u, R) {
  var Cb = C(), ox = u.x | 0, oy = u.y | 0, od = u.dir | 0, 격자 = !!(battle.unplace && battle.place);
  var 최고 = 0, 고른 = null;
  if (격자) battle.unplace(u);                                                       /* 0x3E041 0x11EE4 */
  try {
    Cb.diamond(battle, ox, oy, R | 0, true).forEach(function (c) {
      if (칸유닛(battle, c.x, c.y)) return;                                          /* 0x3E084 jne */
      var 수 = [0, 0, 0, 0], 점 = 0;
      Cb.diamond(battle, c.x, c.y, 3, true).forEach(function (q) {                   /* 0x3E0A7 ebx=3 */
        var t = 칸유닛(battle, q.x, q.y);
        if (!t || hostile(battle, u, t)) return;                                     /* 0x3E0F6 jne */
        수[(t.dir | 0) & 3]++; 점 += 10;                                              /* 0x3E102 · 0x3E103 add ecx,0xA */
      });
      점 += (R | 0) - (Math.abs(c.x - ox) + Math.abs(c.y - oy));                    /* 0x3E11C 0x49ADF · 0x3E125 */
      if (점 <= 최고) return;                                                        /* 0x3E130 jle */
      var 방 = 0, 많 = 0;
      for (var d = 0; d < 4; d++) if (수[d] > 많) { 많 = 수[d]; 방 = d; }             /* 0x3E156 cmp dx,cx / jge */
      최고 = 점; 고른 = { x: c.x, y: c.y, dir: 방, score: 점 };
    });
  } finally { if (격자) battle.place(u, ox, oy, od); }                              /* 0x3E17A 0x11E04 */
  return 고른;
}

/**
 * ★★★★★ **0x43CA9 — 무기 2 갈래** (2026-10-08 · 사장님 「몽크, 클레릭, 드루이드, 비숍을 비롯한 모든 마법사 계열 다시 점검해」)
 *   0x43CAC~0x43CCC 직업 0x19~0x20 · 0x26~0x28 · 0x34 → 0 (0x449BA 0x43526 마법형)
 *   0x43CD4~0x43CDC 직업 0x21~0x25                   → 1 (0x449C3 0x438AE 원거리 마법형)
 *   그 밖(0x29 Sorcerer · 0x2A Sharman · 0x2B Exorcist …)  → 2 (0x449B8 jmp 0x44A0C — 아무것도 안 함 · 턴 마무리 자세도 없음)
 */
function 무기2갈래(u) {
  var j = (u && u.job) | 0;
  if ((j >= 0x19 && j <= 0x20) || (j >= 0x26 && j <= 0x28) || j === 0x34) return 0;
  if (j >= 0x21 && j <= 0x25) return 1;
  return 2;
}

/**
 * ★★★★★ **무기 2 고리의 «이동 한 번»** — 원본 줄 단위 (2026-10-08)
 *   마법형   0x43565~0x437D7 · 원거리 마법형 0x438E6~0x43B51 (두 함수는 «목표 없음» 갈래만 다르다)
 *   ① TP ≤ 기본+24 → −3 (0x43579 · 0x438F8)
 *   ② n = (TP−기본)/10 · 범위 0x14300(n×4) · 상태 = 0x3E18B
 *   ③ 상태 > 0  → 0x3E5AB: 못 찾으면 −1 · 지금 자리·방향이면 −2 · 아니면 1
 *      상태 −1 또는 모드 6 → −2 (0x43622·0x43628 / 0x43981·0x43987)
 *      그 밖 — 마법형:   0x3E3BF(u,n) 적 없음 → −1 · 0x3E739(n,2) 못 찾음 → −1 · 제자리 → −2 · 아니면 1
 *               원거리: 0x3E457(u,n) −1 → −2 · 0 → −1 · 그 밖 0x3E739(n,1) 이 지금 자리·방향일 때만 −2 · 아니면 −1(☆ 1 이 아니다 · 0x439E4~0x439FF)
 *   ④ −1 → 상태 ≠ 0 이면 0x3E251(목표 쪽) · 아니면 마법형 0x3DF3B(30) / 원거리 0x3E01B(30)
 *        자리가 없으면 'exit'(0x438A6 — 턴 마무리 자세 없이 끝) · 제자리면 −2 · 길(0x1499C·0x15342) 못 찾으면 'exit' · 아니면 1
 * @returns {{edi, move, 기본비용, reason}}  edi: −3 · −2 · 1 · 'exit'
 */
/** `0x3E5AB` 그대로 — AI 목표 **유닛**(0x3E21B · [+0x71]/[+0x72] 목록 또는 [+0x73])이 있을 때만 그 유닛을 칠 자리 · 없으면 null(0x3E5D0 je 0x3E655)
 *   0x3E5D6~0x3E5E0 무기 < 6 이고 모드 3 이면 0x3D3E5 · 그 밖은 0x3CA3C (2026-10-08)
 *   ☠ 무기 2 이동 단계가 여기서 모드별 적 고르기(chooseTarget 전체)를 불러, 목표 유닛이 없는 원거리 마법형이 적 옆으로 걸어갔다
 *     (원본 TESTWW: 0 을 받아 0x3E251 로 좌표 목표 쪽을 걸었다) */
function 목표자리_3E5AB(battle, u, Rg) {
  var g = AI목표읽기(u);
  var 목유 = g.유닛 || AI목표유닛찾기(battle, g.유닛id, g.유닛코드);
  if (!목유) return null;
  var 자 = (wtOf(battle, u) < 6 && (ai(u).mode | 0) === 3) ? 모드3자리(battle, u, 목유, Rg) : choosePosition(battle, u, 목유, { range: Rg });
  return 자 ? { unit: hostile(battle, u, 목유) ? 목유 : null, x: 자.x, y: 자.y, dir: 자.dir, score: 자.score, cost: 자.cost, mode: '유닛목표' } : null;
}

function 무기2이동단계(battle, unit, opts, 문맥) {
  opts = opts || {};
  var 기본 = (문맥 && 문맥.기본비용 != null) ? (문맥.기본비용 | 0) : 10;
  var 원거리 = !!(문맥 && 문맥.원거리);
  var tp = unit.tp | 0;
  if (tp <= 기본 + 0x18) return { edi: -3, move: null, 기본비용: 기본, reason: 'TP ≤ 기본비용+24 (0x43579·0x438F8)' };
  var n = idiv(tp - 기본, 10);
  var Rg = M().range(battle, unit, { tp: tp, budget: n * 4 });                   /* 0x435B7·0x43995 0x14300(n×4) */
  var 상 = 목표상태(battle, unit), mode = ai(unit).mode | 0;
  function 제자리인가(t) { return t && t.x === (unit.x | 0) && t.y === (unit.y | 0) && (t.dir | 0) === (unit.dir | 0); }
  var edi = -1, tgt = null;
  /* ★ 마법형 0x435AB 는 jle(0 이하 → 0x4361E) · 원거리 0x43926 은 **je(0 일 때만 → 0x4397D)** — −1(도착)도 목표 고르기로 간다
   *   (2026-10-08 원본 TESTWW 실측: 목표 −1 인 원거리 마법형 셋이 0x3E5AB 로 자리를 잡아 북쪽 4칸을 걸었다 · 우리는 제자리 시전) */
  if (원거리 ? (상 !== 0) : (상 > 0)) {                                          /* 0x435AB·0x43926 */
    var t = 목표자리_3E5AB(battle, unit, Rg);                                      /* 0x435D4·0x43934 0x3E5AB */
    if (t) { tgt = t; edi = 제자리인가(t) ? -2 : 1; }
  } else if (상 === -1 || mode === 6) edi = -2;
  else if (!원거리) {
    var s = 안전접근(battle, unit, Rg, n, 2);                                      /* 0x4364B 0x3E3BF · 0x43666 0x3E739(n,2) */
    if (s) { tgt = s; edi = 제자리인가(s) ? -2 : 1; }
  } else {
    var 부 = 다친아군(battle, unit, n, Rg);                                         /* 0x439AF 0x3E457 */
    if (부 === -1) edi = -2;
    else if (부.목록.length) {
      var s2 = 안전접근(battle, unit, 부.Rg, n, 1, 부.목록);                         /* 0x439D0 0x3E739(n,1) */
      if (제자리인가(s2)) edi = -2;
    }
  }
  if (edi === -1) {                                                                /* 0x436A6·0x43A0B */
    if (상 !== 0) {
      var 쪽 = 목표쪽목적지(battle, unit);                                         /* 0x3E251 */
      if (!쪽) return { edi: 'exit', move: null, 기본비용: 기본, reason: '0x3E251 자리 없음 (0x438A6)' };
      if (쪽.x === (unit.x | 0) && 쪽.y === (unit.y | 0)) return { edi: -2, move: null, 기본비용: 기본, reason: '목표 쪽이 제자리' };
      var 걸 = 목적지로걷기(battle, unit, Rg, 쪽.x, 쪽.y, 쪽.목, null, mode, 0);
      if (!걸) return { edi: 'exit', move: null, 기본비용: 기본, reason: '목표 쪽 길 없음 (0x15342 → 0x438A6)' };
      tgt = { unit: null, x: 걸.x, y: 걸.y, dir: 걸.dir };
    } else if (!원거리) {
      var 먼 = 근접접근(battle, unit, Rg, mode);                                   /* 0x436E5 0x3DF3B(30) … 0x14FA4 */
      if (!먼) return { edi: 'exit', move: null, 기본비용: 기본, reason: '0x3DF3B 0 (0x436EE → 0x438A6)' };
      tgt = 먼;
    } else {
      var 곁 = 원거리먼자리(battle, unit, 30);                                      /* 0x43A55 0x3E01B(30) */
      if (!곁) return { edi: 'exit', move: null, 기본비용: 기본, reason: '0x3E01B 0 (0x43A5D → 0x438A6)' };
      if (곁.x === (unit.x | 0) && 곁.y === (unit.y | 0)) return { edi: -2, move: null, 기본비용: 기본, reason: '아군 곁 제자리 (0x43A90)' };
      var 볼 = DIR[(곁.dir | 0) & 3];
      var 곁걸음 = 목적지로걷기(battle, unit, Rg, 곁.x, 곁.y, { x: 곁.x + 볼.dx, y: 곁.y + 볼.dy }, null, '원거리먼접근', 0);
      if (!곁걸음) return { edi: 'exit', move: null, 기본비용: 기본, reason: '아군 곁 길 없음 (0x43AD7 → 0x438A6)' };
      tgt = 곁걸음;
    }
    if (tgt.x === (unit.x | 0) && tgt.y === (unit.y | 0)) return { edi: -2, move: null, 기본비용: 기본, reason: '제자리 (0x43B29·0x437AF)' };
    edi = 1;
  }
  if (edi !== 1) return { edi: edi, move: null, 기본비용: 기본, target: tgt, reason: edi === -2 ? '제자리 — 시전 되풀이' : '이동 없음' };
  var move;
  if (tgt.x === (unit.x | 0) && tgt.y === (unit.y | 0)) move = { x: unit.x, y: unit.y, dir: tgt.dir, turnOnly: true, tp: 기본 };
  else {
    var p = AI경로(battle, unit, Rg, tgt.x, tgt.y);
    if (!p) return { edi: -2, move: null, 기본비용: 기본, target: tgt, reason: '길 없음' };
    move = { x: tgt.x, y: tgt.y, dir: tgt.dir, path: p, cost: p.cost, tp: idiv(p.cost | 0, 4) * 10 + 기본 };   /* 0x4382D~0x43841 걸음×10 + 기본 */
  }
  return { edi: 1, move: move, 기본비용: 기본, target: tgt, reason: 원거리 ? '원거리 마법형 걷기' : '마법형 걷기' };
}

/** 0x43565~ / 0x438E6~ — 마법형이 마법을 못 썼을 때의 이동 */
function 마법형이동(battle, u, plan, Rg, 원거리, opts) {
  function 끝(까닭) { plan.kind = 'wait'; plan.reason = 까닭; plan.endStance = endStance(battle, u); return plan; }
  /* 0x43969 di=−2 → 0x43BF1: TP < 문턱(0x14 · 매번 +2)이면 끝, 아니면 0x432A0 을 9번까지 (원거리 마법형) */
  function 제자리시전(까닭) {
    for (var 문 = 0x14; (u.tp | 0) >= 문; 문 += 2) {
      var 시 = 원거리마법9번(battle, u, opts);
      if (시) return 마법계획(battle, u, plan, 시);
      if (!(u.tp | 0)) break;
    }
    return 끝(까닭);
  }
  if ((u.tp | 0) <= 10 + 0x18) return 끝('TP ≤ 34 (0x43579)');
  var 상태 = 목표상태(battle, u), tgt = null;
  if (상태 > 0) tgt = chooseTarget(battle, u, { range: Rg, rng: opts.rng });        /* 0x435D4 0x3E5AB */
  else if (상태 === -1 || (ai(u).mode | 0) === 6)
    return 원거리 ? 제자리시전('목표 도착·모드 6 (0x43981·0x43987 → 0x43969)') : 끝('목표 도착·모드 6 (0x43622)');
  else if (원거리) {
    /* ★★★ 0x439AF 0x3E457 — «다친 아군 쪽으로» (2026-10-07 줄 단위 · 사장님 「클레릭 ai 지정시 아무것도 안하고 가만히 있는 문제도 있어.」)
     *   −1(내 HP < 70% 또는 상태이상) → 0x439BD je 0x43969 제자리 시전 루프
     *   0(반경 안 다친 아군 없음)       → 0x439B7 je 0x43A0B → 0x43A43 0x3E01B 먼 접근
     *   그 밖                             → 0x439D0 0x3E739(n, 1) 다친 아군 둘레 안전 자리 — 지금 자리·방향과 같으면 0x43A01 시전 루프, 다르면 edi −1 그대로 먼 접근
     *   ☠ 전에는 조건을 뒤집어 «멀쩡하면 대기»로 끝냈다 — 다친 이가 없을 때 건강한 클레릭이 매 턴 가만히 있었다 */
    var n원 = moveSteps(u), 부 = 다친아군(battle, u, n원, Rg);
    if (부 === -1) return 제자리시전('0x3E457 −1 (내 HP < 70% · 상태이상)');
    if (부.목록.length) {
      var 안자리 = 안전접근(battle, u, 부.Rg, n원, 1, 부.목록);                      /* 0x439BF push 1 · push n → 0x3E739 */
      if (안자리 && 안자리.x === (u.x | 0) && 안자리.y === (u.y | 0) && (안자리.dir | 0) === (u.dir | 0))
        return 제자리시전('다친 아군 곁 제자리 (0x43A01)');
    }
    /* ★ 0x43A43 0x3E01B(반경 30) — «아군 곁 자리»로 간다. 적에게 붙지 않는다 (2026-10-07 사장님 「클레릭은 왜 AI시 마법을 안쓰고 다가가냐고 … 원작에서는 잘 쓰는데!」)
     *   ☠ 전에는 0x3DF3B(근접 먼 접근 · 적 옆 칸)로 근사해 클레릭이 적에게 달려갔다 */
    var 곁 = 원거리먼자리(battle, u, 30);
    if (!곁) return 끝('0x3E01B 0 (0x43A5D)');
    if (곁.x === (u.x | 0) && 곁.y === (u.y | 0)) return 제자리시전('아군 곁 제자리 (0x43A90)');   /* 0x43A75~0x43A95 */
    var 볼 = DIR[(곁.dir | 0) & 3];
    var 곁걸음 = 목적지로걷기(battle, u, Rg, 곁.x, 곁.y, { x: 곁.x + 볼.dx, y: 곁.y + 볼.dy }, null, '원거리먼접근', 0);   /* 0x43A9A~0x43B2F */
    if (!곁걸음) return 제자리시전('갈 길 없음 (0x43B29 → 0x43A90)');
    plan.target = 곁걸음;
    if (곁걸음.x !== u.x || 곁걸음.y !== u.y) {
      var p곁 = AI경로(battle, u, Rg, 곁걸음.x, 곁걸음.y);
      if (p곁) plan.move = { x: 곁걸음.x, y: 곁걸음.y, dir: 곁걸음.dir, path: p곁, tp: p곁.tp, cost: p곁.cost };
    }
    plan.kind = 'approach'; plan.reason = '원거리 마법형 — 아군 곁으로 (0x3E01B)';
    plan.endStance = endStance(battle, u);
    return plan;
  }
  else {
    tgt = 안전접근(battle, u, Rg, moveSteps(u), 2);                                 /* 0x43655 push 2 · push n → 0x3E739 */
    if (tgt && tgt.x === (u.x | 0) && tgt.y === (u.y | 0) && (tgt.dir | 0) === (u.dir | 0)) {
      if (원거리) {
        /* ★ 0x43969 di=−2 → 0x43BF1: TP < 문턱(0x14 · 매번 +2)이면 끝, 아니면 0x432A0 을 9번까지 →
         *   못 썼으면 0x438E6 이동으로 돌아가 같은 제자리(−2)를 다시 만난다. 이동 판단이 같으므로 여기서 문턱만 올려 되풀이한다. */
        for (var 문 = 0x14; (u.tp | 0) >= 문; 문 += 2) {
          var 시 = 원거리마법9번(battle, u, opts);
          if (시) return 마법계획(battle, u, plan, 시);
          if (!(u.tp | 0)) break;
        }
      }
      return 끝('안전접근 제자리 (0x43696)');
    }
    if (!tgt) tgt = 근접접근(battle, u, Rg, ai(u).mode | 0);                          /* 0x3DF3B~0x14FA4 (☐ 원거리 0x3E01B) */
  }
  if (!tgt) return 끝('갈 곳 없음');
  plan.target = tgt;
  if (tgt.x !== u.x || tgt.y !== u.y) {
    var p = AI경로(battle, u, Rg, tgt.x, tgt.y);
    if (p) plan.move = { x: tgt.x, y: tgt.y, dir: tgt.dir, path: p, tp: p.tp, cost: p.cost };
  } else if ((tgt.dir | 0) !== (u.dir | 0)) plan.move = { x: u.x, y: u.y, dir: tgt.dir, turnOnly: true, tp: 0 };
  plan.kind = 'approach'; plan.reason = '마법형 이동';
  plan.endStance = endStance(battle, u);
  return plan;
}

function chooseSpell(battle, u, opts) {
  var Ru = R(), T = battle.T;
  var a = ai(u);
  var wt = wtOf(battle, u);
  if ((u.ailment | 0) & 8) return -1;                               // 사일런스
  if ((a.magic & 0xFF) !== 0xFF) return (a.magic & 0xFF) * 3;       // [+0x80] = 함수표 첨자
  var cls = u.magicLv || [];
  var lv = -1;
  for (var L = 6; L >= 0; L--) {                                    // 0x42DFD  si = 6 부터
    if ((u.mp | 0) < Ru.spellMp(L, T)) continue;
    if ((u.tp | 0) + (u.chargeTp | 0) < Ru.spellTp(L, T, wt)) continue;
    lv = L; break;
  }
  if (lv < 0) return -1;                                            // 0x42E62  → −2

  /* 계열 — 배운 것 중에서만 고릅니다 (0x72310 최대 클래스) */
  var series = -1;
  var wounded = alliesOf(battle, u).filter(function (t) {
    return (t.hp | 0) < idiv((t.maxHp | 0) * 7, 10);
  });
  var undead = enemiesOf(battle, u).some(function (t) {
    return (t.race | 0) === 2 && dist(u, t) <= 5;
  });
  var mates = alliesOf(battle, u).length + 1;
  if ((cls[3] | 0) > 0 && (undead || wounded.length * 100 >= mates * 30)) series = 3;
  else {
    for (var s = 0; s < 7; s++) if ((cls[s] | 0) > 0 && s !== 3) { series = s; break; }
  }
  if (series < 0) return -1;
  var rank = clamp((cls[series] | 0) - 1, 0, 2);
  return series * 21 + lv * 3 + rank;                               // 0x43287
}

/* ══════════════════════════════════════════ 7. 한 유닛의 턴 (0x44913 · 0x40295) */

/**
 * 유닛 한 기의 행동을 결정합니다. **결정만 하고 실행은 안 합니다** —
 * 실제로 굴리려면 `G2AI.run(battle, unit)` 을 부르십시오.
 *
 * @returns {{
 *   unit, control:'ai', kind:'wait'|'flee'|'attack'|'special'|'magic'|'approach',
 *   action:number,           // 0x3F321 의 반환 (0 통상 · 1 필살기 · 2 마법 · −1 없음)
 *   target, move:{x,y,dir,path}|null, slot, spell, reason, endStance
 * }}
 */
function act(battle, unit, opts) {
  opts = opts || {};
  var Mv = M(), Cb = C(), Ru = R();
  var plan = { unit: unit, control: 'ai', kind: 'wait', action: -1, target: null,
               move: null, slot: -1, spell: -1, reason: '', steps: [] };
  if (!unit || !unit.alive) { plan.reason = '죽었습니다'; return plan; }
  if ((unit.ailment | 0) & 2) { plan.kind = 'wait'; plan.reason = '행동 불능'; return plan; }

  var Rg = Mv.range(battle, unit, { tp: unit.tp | 0 });
  plan.range = { budget: Rg.budget, cells: Rg.cells.length };

  /* ① 도주·회복 — 0x41515 */
  /* ★ 도주는 컨트롤러 _AI턴머리(0x41515 줄 단위)가 턴에 한 번 한다 — 옛 근사는 도주건너뜀이 없을 때(시험·헤드리스)만 */
  var fl = opts.도주건너뜀 ? null : flee(battle, unit, { range: Rg, rng: opts.rng });
  if (fl && (fl.mode === 'forced' || (fl.cell && chance(battle, unit, 50, opts)))) {
    plan.kind = 'flee'; plan.reason = '도주(' + fl.mode + ', HP ' + fl.hpPct + '%)';
    plan.flee = fl;
    if (fl.cell) plan.move = { x: fl.cell.x, y: fl.cell.y, dir: unit.dir | 0, tp: fl.cell.tp };
    plan.endStance = endStance(battle, unit);
    return plan;
  }

  /* ② 이번에 무엇을 할까 — 0x3F321 */
  /* ★★★★★ **유닛 턴 분기 0x44913** (2026-09-29) — 무기 종류 2 는 직업으로 루프가 갈린다(0x43CA9)
   *   0x19~0x20·0x26~0x28·0x34 → 0x43526 마법형 · 0x21~0x25 → 0x438AE 원거리 마법형 · 그 밖 → 아무것도 안 함
   *   ☐ 보스 광역기(0xA1·0x5B~0x5D → 0x43CF0) · 소환(0xA4 → 0x4426D) · 대형/궁(0x40DFD) 은 아직 일반 루프로 돈다 */
  var wt0 = wtOf(battle, unit), job0 = unit.job | 0;
  var 소환사일반 = false;   /* [리마스터 소환사AI] 소환할 게 없으면 무기 2 고리 대신 아래 일반 고리(다가가 공격)로 */
  if (wt0 === 2) {
    var 마법형 = (job0 >= 0x19 && job0 <= 0x20) || (job0 >= 0x26 && job0 <= 0x28) || job0 === 0x34;
    var 원거리마법형 = (job0 >= 0x21 && job0 <= 0x25);
    /* [리마스터] 소환사AI (정본 479 · 사장님 11-26 «리마스터 옵션 추가») — 원작은 0x43CA9 → 2 라 소환사(0x29 Sorcerer 등)를 AI 로 두면 가만히 있다
     *   (신고 버그신고_20261126_133244 「버그인지는 모르겠는데 소환사는 AI모드하면 아무 행동을 안해요」)
     *   켜면: 소환 계열(5)을 쓸 수 있는 유닛만 — 소환이 필요하면(0x42D51 · 부른 소환수 없음·하나인데 HP 절반 아래) 쓸 수 있는 가장 높은 단계 소환 ·
     *         아니면 일반 고리(다가가 공격)로 · 소환 계열이 없는 직업(샤먼·엑소시스트 …)은 원작대로 */
    if (!마법형 && !원거리마법형 && 소환사AI켬() && 계열랭크(battle, unit, 5) >= 0) {
      var 소 = 소환시도(battle, unit);
      if (소) { plan.action = 2; plan.reason = '[리마스터 소환사AI] 소환'; return 마법계획(battle, unit, plan, 소); }
      소환사일반 = true;   /* 소환할 게 없으면 아래 일반 고리로 — 무기 2 갈래의 나머지를 건너뛴다 */
    } else
    if (!마법형 && !원거리마법형) { plan.kind = 'wait'; plan.reason = '0x43CA9 → 2 (아무것도 안 함)';
                                   plan.endStance = endStance(battle, unit); return plan; }
  }
  if (wt0 === 2 && !소환사일반) {
    if ((unit.mp | 0) < 10) { plan.kind = 'wait'; plan.reason = 'MP < 10 (0x43530)';
                              plan.endStance = endStance(battle, unit); return plan; }
    if (마법형 || (unit.reserveSpell | 0)) {                        /* 0x43550 · 0x438D5 차징 중일 때만 */
      var 시 = 마법시도(battle, unit, opts);
      if (시.결과 === 1 || 시.결과 === 2) return 마법계획(battle, unit, plan, 시);
    } else if (원거리마법형 && opts.앞종류 === 'approach') {
      /* ★ 0x43B51~0x43C3B — 원거리 마법형은 «걸은 뒤» 그 자리에서 0x432A0 을 9번까지(0 이 아니면 멈춤).
       *   ☠ 전에는 이 갈래가 없어 차징 중이 아니면 마법을 한 번도 시도하지 않았다 —
       *   클레릭(0x22) 지정 선라이트가 영영 시작되지 않았다 (2026-10-05 사장님 「아무것도 안하는 버그」) */
      var 시3 = 원거리마법9번(battle, unit, opts);
      if (시3) return 마법계획(battle, unit, plan, 시3);
    }
    plan.action = 2;
    return 마법형이동(battle, unit, plan, Rg, 원거리마법형, opts);
  }

  var kind = decideAction(battle, unit, opts);
  plan.action = kind;
  /* 0x40242 — 일반 루프의 마법: 0x432A0 을 9번까지(1 시전 · 2 차징 → 끝). 못 쓰면 −1 → 이동만 */
  if (kind === 2) {
    for (var 번 = 0; 번 < 9; 번++) {
      var 시2 = 마법시도(battle, unit, opts);
      if (시2.결과 === 1 || 시2.결과 === 2) return 마법계획(battle, unit, plan, 시2);
    }
    kind = -1;
  }
  /* ★ [+0x6D] == 4 → 0x3F321 −1 → 0x4016A 도 −1(0x4026C) 이지만 루프 0x40312 는 −1 이면
   *   이동 단계(0x40323~)로 **계속 간다** — 공격·필살·마법만 안 하고 모드대로 움직인다 (2026-09-29).
   *   ☠ 전에는 여기서 대기로 끝내 성향 4 적(전수 69기)이 한 발도 안 움직였다. */

  /* ③ 목표 선정 — [+0x6C] */
  var tgt = chooseTarget(battle, unit, { range: Rg, rng: opts.rng });
  plan.target = tgt;
  if (!tgt) { plan.kind = 'wait'; plan.reason = '적을 못 찾았습니다';
              plan.endStance = endStance(battle, unit); return plan; }

  /* ④ 설 자리 */
  if (tgt.x !== unit.x || tgt.y !== unit.y) {
    var p = AI경로(battle, unit, Rg, tgt.x, tgt.y);
    if (p) plan.move = { x: tgt.x, y: tgt.y, dir: tgt.dir, path: p, tp: p.tp, cost: p.cost };
  } else if ((tgt.dir | 0) !== (unit.dir | 0)) {
    plan.move = { x: unit.x, y: unit.y, dir: tgt.dir, turnOnly: true, tp: 0 };
  }

  if (!tgt.unit) { plan.kind = 'approach'; plan.reason = '좌표 목표';
                   plan.endStance = endStance(battle, unit); return plan; }
  if (kind === -1) { plan.kind = 'approach'; plan.reason = '[+0x6D] == 4 (공격 안 함 · 이동만)';
                     plan.endStance = endStance(battle, unit); return plan; }

  /* ⑤ 실제 행동 */
  var reachAfter = plan.move ? dist({ x: plan.move.x, y: plan.move.y }, tgt.unit)
                             : dist(unit, tgt.unit);
  /* 원본은 이동(0x41633 로 TP 차감) 뒤에 다시 0x4016A 로 들어와 `TP < 40 → −1` 을 봅니다.
   * 계획 단계에서 같은 판정을 하려면 **이동으로 나갈 TP 를 먼저 뺀** 값을 봐야 합니다. */
  var tpLeft = (unit.tp | 0) - (plan.move ? (plan.move.tp | 0) : 0);
  /* ★★★★★ **실제 공격 칸으로 판정한다** (2026-08-26)
   *
   *   전에는 `dist <= attackReach` 로 **거리만** 봤다. 그런데 무기 5 의 사거리는
   *   **한 칸 띄운 부채꼴**이라(`combat.js fanCells`) 거리만으로는 못 가린다 —
   *   특히 **인접(거리 1)은 못 친다.** AI 가 붙어 놓고 `attack` 을 내면
   *   `attack계획` 이 `false` 를 돌려 **아무 일도 안 일어난다.**
   *
   *   ⇒ `attackCells()` 에 표적 칸이 실제로 있는지 본다. 부채꼴 모양·한 칸 띄움·
   *     리마스터 토글이 **한 번에** 반영된다.
   *   ★ 이동이 있으면 **이동 뒤 자리·방향**으로 다시 재야 한다. */
  var canHit = (function () {
    var Cb3 = C();
    if (!Cb3 || !Cb3.attackCells) return reachAfter <= attackReach(battle, unit);
    var 옛x = unit.x, 옛y = unit.y, 옛d = unit.dir;
    if (plan.move) {
      unit.x = plan.move.x | 0; unit.y = plan.move.y | 0;
      if (plan.move.dir != null) unit.dir = plan.move.dir & 3;
    }
    var 닿나 = false;
    try {
      var cs = Cb3.attackCells(battle, unit) || [];
      for (var ci = 0; ci < cs.length; ci++)
        if (cs[ci].x === (tgt.unit.x | 0) && cs[ci].y === (tgt.unit.y | 0)) { 닿나 = !(Cb3.비행막음 && Cb3.비행막음(battle, unit, tgt.unit)); break; }   /* 0x1A25F */
    } catch (e닿) { 닿나 = reachAfter <= attackReach(battle, unit); }
    unit.x = 옛x; unit.y = 옛y; unit.dir = 옛d;
    return 닿나;
  })();

  if (kind === 1) {
    /* 0x3FFD4 — 이동 뒤 자리·방향·TP 로 잰다(조건 함수가 u.x·u.y·u.dir·TP 를 읽는다).
     *   ☐ 원본은 0x40295 가 0x4016A 를 이동 «전»에도 부른다 — 우리 계획은 한 번(이동 뒤)만 잰다. */
    var 옛필 = { x: unit.x, y: unit.y, dir: unit.dir, tp: unit.tp }, 필;
    if (plan.move) {
      unit.x = plan.move.x | 0; unit.y = plan.move.y | 0;
      if (plan.move.dir != null) unit.dir = plan.move.dir & 3;
    }
    unit.tp = tpLeft;
    try { 필 = 필살시도(battle, unit, opts); }
    finally { unit.x = 옛필.x; unit.y = 옛필.y; unit.dir = 옛필.dir; unit.tp = 옛필.tp; }
    if (필.결과 === 2) {
      /* ☠ 원본 버그 그대로 — 차징 게이지를 올리자마자 0x3C993 이 지우고 TP 를 다 쓴다(0x400CD) → 턴 끝(−2) */
      plan.kind = 'wait'; plan.slot = 필.slot; plan.tpBurn = true;
      plan.reason = '필살기 ' + 필.slot + ' 차징 → TP 만 소모(원본 0x400CD 0x3C993)';
      plan.endStance = null;
      return plan;
    }
    /* 필살기 함수들도 결국 0x1D124·0x1AC08 로 대상을 찾습니다 — 닿지 않으면 −1 로 실패하고
     * 0x400F7 → 0x40114 → 0 → 0x401C0 통상으로 넘어갑니다. */
    if (필.결과 === 1 && 필.초 != null) {   /* [리마스터] AI 지정 초필살기 — 이동 뒤 자리에서 맞는 적을 이미 확인했다(초필살조준) */
      plan.kind = 'special'; plan.ultimate = true; plan.slot = -1; plan.grade = 1;
      plan.초칸 = 필.초칸; plan.초대상들 = 필.초대상들;
      plan.need = Ru.ultimateTp(필.초, battle.T); plan.charge = false;
      plan.reason = '초필살기 ' + 필.초 + ' (AI 지정)';
      plan.endStance = endStance(battle, unit);
      return plan;
    }
    var 혼1 = (필.결과 === 1 && (필.slot === 5 || 필.slot === 10)) ? 혼착지(battle, unit, 필.slot, plan.move ? { x: plan.move.x, y: plan.move.y, dir: plan.move.dir } : null) : null;   /* 0x2E0F0 — 0 이면 −1 → 통상 */
    if (필.결과 === 1 && reachAfter <= specialReach(battle, unit, 필.slot) && (!(필.slot === 5 || 필.slot === 10) || 혼1)) {
      plan.kind = 'special'; plan.slot = 필.slot; plan.grade = 필.등급; plan.혼칸 = 혼1;
      plan.need = Ru.specialTp(필.slot, battle.T);
      plan.charge = false;
      plan.reason = '필살기 슬롯 ' + 필.slot + ' (등급 ' + 필.등급 + ')';
      plan.endStance = endStance(battle, unit);
      return plan;
    }
    kind = 0;                                                        // 못 고르면 통상으로
  }
  if (kind === 2) {
    var sp = (unit.reserveSpell | 0) ? ((unit.reserveSpell | 0) - 1) : chooseSpell(battle, unit, opts);
    if (sp >= 0 && reachAfter > Cb.magicRadius(battle, unit, Cb.spellParts(sp).rank)) sp = -1;
    if (sp >= 0) {
      var pp = Cb.spellParts(sp);
      var needM = Ru.spellTp(pp.level, battle.T, wtOf(battle, unit));
      if (tpLeft + (unit.chargeTp | 0) < needM && tpLeft < maxTpOf(unit)) sp = -1;
    }
    if (sp >= 0) {
      plan.kind = 'magic'; plan.spell = sp;
      var pp2 = Cb.spellParts(sp);
      plan.need = Ru.spellTp(pp2.level, battle.T, wtOf(battle, unit));
      plan.charge = tpLeft + (unit.chargeTp | 0) < plan.need;
      plan.reason = plan.charge ? '마법 차징(+0x7F)' : '마법 ' + sp;
      plan.endStance = endStance(battle, unit);
      return plan;
    }
    kind = 0;
  }

  if (canHit && tpLeft >= 0x28) {                                    // 0x4016A  TP < 40 → −1
    plan.kind = 'attack'; plan.reason = '통상 공격';
  } else {
    plan.kind = 'approach';
    plan.reason = canHit ? ('TP 부족(이동 뒤 ' + tpLeft + ')') : ('접근(거리 ' + reachAfter + ')');
  }
  plan.tpLeft = tpLeft;
  plan.endStance = endStance(battle, unit);
  return plan;
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **원본 턴 순서** (2026-09-29 · 사장님 「원본 순서로 바꿈」)
 *   0x44941 → 0x43C5D 자동 방어 → 0x41515 도주(턴에 한 번 · 하면 루프 없음) → 0x40295 루프
 *   0x40295 한 바퀴 = ① 0x4016A «지금 자리에서» 행동 → ② 행동이 끝난 «뒤» 이동할 곳을 정해 이동
 *   ☠ 전에는 한 바퀴가 «이동할 곳을 먼저 정해 이동 → 그 자리에서 행동»이었다(act).
 *   컨트롤러 `_AI한칸` 이 행동단계 → (실행) → 이동단계 → (실행) 차례로 부른다.
 * ══════════════════════════════════════════════════════════════════════ */

/** 0x43C5D — 턴 시작 자동 방어: 직업 액티브스킬 칸 14(0x731BA) 가 켜 있고 TP > 150 → 배리어(0x3C4C1) · 성공하면 TP 40(0x43CA1 0x3C993) */
function 자동방어(battle, u) {
  var j = battle.jobOf ? battle.jobOf(u) : null, 표 = j && j['액티브스킬'];
  if (!표 || !(표[14] | 0)) return null;                                      /* 0x43C6D */
  if ((u.tp | 0) <= 150) return null;                                         /* 0x43C7B */
  return { unit: u, control: 'ai', kind: 'skill', skill: 14, action: -1, target: null, move: null,
           결과: 0, reason: '턴 시작 자동 방어 (0x43C5D → 0x3C4C1)' };
}

/**
 * ★ 0x3EF12(u, r) — 물러설 칸 (2026-09-29 줄 단위)
 *   0x3E3BF: 내 둘레 마름모 반경 max(r,3) 의 적(칸마다) → 없으면 null
 *   적마다 둘레 반경 4 를 이동배열에서 −1 로 막고(0x13D02) · 내 둘레 반경 r 에서 이동배열 값이 «엄격히» 가장 큰 칸
 *   (방향 0·1 중 하나로 설 수 있어야 · 0x165C2) · 방향 = 0x14F52(칸 → 첫 적) → 못 서면 0x3F0A2 갈래
 * @returns {{x,y,dir,left}|null}
 */
function 물러설칸(battle, u, Rg, r) {
  var Cb = C(), Mv = M(), ux = u.x | 0, uy = u.y | 0;
  var 적들 = [];
  Cb.diamond(battle, ux, uy, Math.max(r, 3), true).forEach(function (c) {       /* 0x3E3C7 · 0x3E3E5 */
    var t = 칸유닛(battle, c.x, c.y);
    if (t && t !== u && hostile(battle, u, t)) 적들.push(t);
  });
  if (!적들.length) return null;                                               /* 0x3EF39 */
  var 막힘 = {};
  적들.forEach(function (e) {
    Cb.diamond(battle, e.x | 0, e.y | 0, 4, true).forEach(function (c) { 막힘[c.x + ',' + c.y] = 1; });   /* 0x3EF52 ebx=4 */
  });
  var 최 = -1, 고른 = null, 고른방 = 0;
  Cb.diamond(battle, ux, uy, r, true).forEach(function (c) {
    var k = c.x + ',' + c.y;
    if (막힘[k]) return;
    var 셀 = Rg.map[k], v = 셀 ? (셀.left | 0) : ((c.x === ux && c.y === uy) ? (Rg.budget | 0) : -1);
    if (v <= 최) return;                                                       /* 0x3EFDD jle */
    var d = 0;
    for (; d < 2; d++) if (!Mv.canPlace || Mv.canPlace(battle, u, c.x, c.y, d)) break;   /* 0x3EFF6 */
    if (d === 2) return;
    최 = v; 고른 = { x: c.x, y: c.y }; 고른방 = d;
  });
  if (!고른) return null;                                                      /* 0x3F04D */
  var 첫 = 적들[0], dir = faceDir(고른, 첫);                                    /* 0x3F06D 0x14F52 */
  if (Mv.canPlace && !Mv.canPlace(battle, u, 고른.x, 고른.y, dir)) {
    dir = 고른방;
    if (!(고른방 & 1)) { if ((첫.y | 0) < 고른.y) dir = 2; }                   /* 0x3F0A8 */
    else if ((첫.x | 0) > 고른.x) dir = 3;                                     /* 0x3F0BD */
  }
  return { x: 고른.x, y: 고른.y, dir: dir, left: 최 };
}

/**
 * ★ 0x41515 — 도주 판단 (턴에 한 번 · 2026-09-29 줄 단위)
 *   그림 ≥ 300 · [+0x6E] == 4 → null(도주 안 함)
 *   HP% = HP / (최대HP / 100) · 표 0x3C97B[성향] = (검토선, 휴식선)
 *   HP% > 검토선 → null · HP% ≤ 휴식선 → 'rest'(0x4D3BA 휴식) · 그 사이 → 'run'(물러서기 되풀이)
 *   ☠ 전에는 휴식선 이하를 도주로, 그 사이를 50% 확률 도주로 했다 — 원본에 난수가 없다
 */
function 도주판단(battle, u) {
  var a = ai(u);
  if (특수본체(u)) return null;                                  /* 0x4152B */
  if ((a.fleeTend | 0) === 4) return null;                                     /* 0x4153A */
  var row = FLEE_TABLE[clamp(a.fleeTend | 0, 0, 3)];
  var pct = idiv(u.hp | 0, Math.max(1, idiv(u.maxHp | 0, 100)));               /* 0x41540 */
  if (pct > row[0]) return null;                                               /* 0x41568 */
  return (pct <= row[1]) ? 'rest' : 'run';                                     /* 0x41581 */
}
/**
 * 0x41596~0x41633 — 물러서기 한 걸음. 기본비용 si(처음 10 · 걸은 뒤 0x167C9).
 * @returns {{move}|null}  null 이면 0x4168C → 휴식
 */
function 도주걸음(battle, u, si) {
  var Mv = M(), tp = u.tp | 0;
  var Rg = Mv.range(battle, u, { tp: tp, budget: idiv(tp - si, 10) * 4 });      /* 0x415B7 · 0x415C2 · 0x415CD */
  var c = 물러설칸(battle, u, Rg, 3);                                          /* 0x415D2 push 3 */
  if (!c) return null;
  var move;
  if (c.x === (u.x | 0) && c.y === (u.y | 0)) move = { x: c.x, y: c.y, dir: c.dir, turnOnly: true, tp: si };
  else {
    var p = AI경로(battle, u, Rg, c.x, c.y);
    if (!p) return null;
    move = { x: c.x, y: c.y, dir: c.dir, path: p, cost: p.cost, tp: idiv(p.cost | 0, 4) * 10 + si };   /* 0x4164C */
  }
  return { move: move };
}

/**
 * [리마스터] 용자의 무덤 — 창1 원거리형(공격형 2) · 공격 성향 0 한 차례 (2026-10-13 · CHRSYS 0x2C93A 직독 · 03_분석/00_창1_AI와_안내인.md §13)
 *   창1 은 ① 반경 2 안 적이면 물러서기(0x2C9A5~0x2CAB3 → 0x2C64D) ② 마법 없음(0x2BA04 성향 < 2) ③ TP ≤ 20 이면 끝(0x2CACF)
 *   ④ 다가가기(0x2CD61~ · 걸은 뒤 거리 ≤ 3 이면 멈춤 0x2AE75) ⑤ 공격·필살 없음(0x2CBBA·0x2D126) — 이 둘을 따로 낸다.
 *   이동력 = min((TP − 10) / 6, 5) × 4 (0x2C9A5~0x2C9C3).
 */
function 창1이동력(u) {
  var tp = u.tp | 0;
  return Math.max(0, Math.min(idiv(tp - 10, 6), 5)) * 4;
}
/** 창1 0x2C788~0x2C842 — 적 쪽 방향 (0 = +y · 1 = −x · 2 = −y · 3 = +x) */
function 창1적쪽(u, e) {
  var dx = (e.x | 0) - (u.x | 0), dy = (e.y | 0) - (u.y | 0);
  if (dy > 0 && Math.abs(dx) <= dy) return 0;
  if (dx > 0 && Math.abs(dy) <= dx) return 3;
  if (dx < 0 && Math.abs(dy) <= Math.abs(dx)) return 1;
  return 2;
}
/** 범위 안 칸 중 점 T 에 맨해튼으로 가장 가까운 칸 — 동점이면 나와 가까운 칸 → 훑는 순서(y 오름 · x 오름) (0x2AB53 · 0x2AE13~0x2AE40) */
function 창1가까운칸(battle, u, Rg, T) {
  var ux = u.x | 0, uy = u.y | 0, 고른 = null, 최 = Math.abs(T.x - ux) + Math.abs(T.y - uy), 최나 = 0;
  var 칸들 = Object.keys(Rg.map).map(function (k) { var p = k.split(','); return { x: +p[0], y: +p[1] }; });
  칸들.sort(function (a, b) { return a.y - b.y || a.x - b.x; });
  칸들.forEach(function (c) {
    if (c.x === ux && c.y === uy) return;
    var t = 칸유닛(battle, c.x, c.y); if (t && t !== u) return;                 /* 0x913C == 0 — 빈칸 */
    var d = Math.abs(T.x - c.x) + Math.abs(T.y - c.y), 나 = Math.abs(c.x - ux) + Math.abs(c.y - uy);
    if (d < 최 || (고른 && d === 최 && 나 < 최나)) { 최 = d; 최나 = 나; 고른 = c; }   /* 지금 자리보다 «엄격히» 가까워야 (0x2AE62) */
  });
  return 고른;
}
function 창1경로계획(battle, u, Rg, c, 멈춤) {
  var p = AI경로(battle, u, Rg, c.x, c.y);
  if (!p || !p.length) return null;
  var 끝 = p.length - 1;
  if (멈춤) for (var i = 0; i < p.length; i++) if (멈춤(p[i])) { 끝 = i; break; }   /* 첫 걸음은 늘 걷는다 (0x2AEC1~0x2AEE2) */
  var 길 = p.slice(0, 끝 + 1);
  for (var key in p) if (Object.prototype.hasOwnProperty.call(p, key) && isNaN(+key)) 길[key] = p[key];
  var 마 = 길[길.length - 1];
  길.cost = (마.cost != null) ? 마.cost : p.cost;
  /* TP — 창1 (이동력 − 남은)/4×6 + 10. ☠ 물러서기의 원본(0x2CA52)은 새 자리가 아니라 적 칸 값을 읽는 버그가 있다 — 다가가기(0x2CEAF)처럼 새 자리로 */
  return { x: 마.x, y: 마.y, path: 길, cost: 길.cost, tp: idiv(길.cost | 0, 4) * 6 + 10 };
}
/** ① 물러서기 — 반경 2 안 적을 훑는 순서(위 줄부터 · x 오름)로 하나씩, 칸을 못 찾으면 다음 적 */
function 창1물러서기(battle, u) {
  var 힘 = 창1이동력(u); if (힘 <= 0) return null;
  var ux = u.x | 0, uy = u.y | 0;
  var 적들 = enemiesOf(battle, u).filter(function (t) { return dist(t, u) <= 2; })
    .sort(function (a, b) { return (a.y - b.y) || (a.x - b.x); });              /* 0x14F4A 마름모 훑기 순서 */
  if (!적들.length) return null;
  var Rg = M().range(battle, u, { tp: u.tp | 0, budget: 힘 });
  for (var i = 0; i < 적들.length; i++) {
    var e = 적들[i];
    var T = { x: ux + (ux > e.x ? 4 : ux < e.x ? -4 : 0), y: uy + (uy > e.y ? 4 : uy < e.y ? -4 : 0) };   /* 0x2C65F~0x2C6B5 */
    var c = 창1가까운칸(battle, u, Rg, T);
    if (!c) continue;                                                           /* 0x2CA4E 다음 적 */
    var mv = 창1경로계획(battle, u, Rg, c, null);
    if (!mv) continue;
    mv.dir = 창1적쪽(c, e);                                                    /* 물러서게 만든 적 쪽 */
    return { move: mv, 적: e };
  }
  return null;
}
/** ④ 다가가기 — 목표: 목표 유닛 → 목표 좌표 → 반경 30 안 가장 가까운 적 (0x2AC2B) · 걸은 뒤 거리 ≤ 3 이면 멈춤 */
function 창1다가가기(battle, u) {
  if ((u.tp | 0) <= 20) return null;                                            /* 0x2CACF */
  var a = ai(u); if ((a.mode | 0) === 5) return null;
  var 목 = null;
  if (a.목표유닛id != null && (a.목표유닛id | 0) !== 255) 목 = battle.units.filter(function (t) { return t.alive && (t.id === a.목표유닛id); })[0] || null;
  if (!목 && a.목표x != null && (a.목표x | 0) !== 255) 목 = { x: a.목표x | 0, y: a.목표y | 0 };
  if (!목) {
    var 적들 = enemiesOf(battle, u).filter(function (t) { return dist(t, u) <= 30; })
      .sort(function (p, q) { return dist(p, u) - dist(q, u) || p.y - q.y || p.x - q.x; });
    목 = 적들[0] || null;
  }
  if (!목) return null;
  var 힘 = 창1이동력(u); if (힘 <= 0) return null;
  var Rg = M().range(battle, u, { tp: u.tp | 0, budget: 힘 });
  var c = 창1가까운칸(battle, u, Rg, 목);                                       /* 목표 거리 0 이면 더 가까운 칸 없음 → 안 움직임(0x2CDF8) */
  if (!c) return null;
  var mv = 창1경로계획(battle, u, Rg, c, function (q) { return Math.abs(q.x - 목.x) + Math.abs(q.y - 목.y) <= 3; });
  if (!mv) return null;
  mv.dir = 창1적쪽(mv, 목);
  return { move: mv, 목표: 목 };
}
/** 옛 이름 — 물러서기만 (시험·호환) */
function 무덤물러서기(battle, u) { return 창1물러서기(battle, u); }

/** 0x41515 — 턴에 한 번. 도주하면 계획을, 아니면 null (null 이면 0x44963 으로 이어 간다) */
function 도주단계(battle, unit, opts) {
  opts = opts || {};
  if (!unit || !unit.alive) return null;
  var Rg = M().range(battle, unit, { tp: unit.tp | 0 });
  var fl = flee(battle, unit, { range: Rg, rng: opts.rng });
  if (!(fl && (fl.mode === 'forced' || (fl.cell && chance(battle, unit, 50, opts))))) return null;
  var plan = { unit: unit, control: 'ai', kind: 'flee', action: -1, target: null, move: null,
               slot: -1, spell: -1, reason: '도주(' + fl.mode + ', HP ' + fl.hpPct + '%)', flee: fl };
  if (fl.cell) plan.move = { x: fl.cell.x, y: fl.cell.y, dir: unit.dir | 0, tp: fl.cell.tp };
  plan.endStance = endStance(battle, unit);
  return plan;
}

/**
 * 0x4016A — **지금 자리에서** 행동 한 번 (이동하지 않는다).
 * @returns plan  kind: 'attack'|'special'|'magic'|'burn'|'none'
 *   결과 = 0x4016A 의 반환 — −2 루프 끝(차징 · 0x401B6/0x40261) · −1 할 것 없음 · 0·1·2 한 것
 */
function 행동단계(battle, unit, opts) {
  opts = opts || {};
  var Ru = R();
  var plan = { unit: unit, control: 'ai', kind: 'none', action: -1, target: null, move: null,
               slot: -1, spell: -1, reason: '', 결과: -1 };
  if (!unit || !unit.alive) { plan.reason = '죽었습니다'; return plan; }
  if ((unit.ailment | 0) & 2) { plan.reason = '행동 불능'; return plan; }
  var kind = decideAction(battle, unit, opts);                                 /* 0x40174 0x3F321 */
  plan.action = kind;
  if (kind === 1) {                                                           /* 0x4019E 0x3FFD4 */
    var 필 = 필살시도(battle, unit, opts);
    if (필.결과 === 2) {
      plan.kind = 'burn'; plan.slot = 필.slot; plan.tpBurn = true; plan.결과 = -2;   /* 0x401B6 */
      plan.reason = '필살기 ' + 필.slot + ' 차징 → TP 만 소모(원본 0x400CD 0x3C993)';
      return plan;
    }
    if (필.결과 === 1 && 필.초 != null) {   /* [리마스터] AI 지정 초필살기 */
      plan.kind = 'special'; plan.ultimate = true; plan.slot = -1; plan.grade = 1; plan.결과 = kind;
      plan.초칸 = 필.초칸; plan.초대상들 = 필.초대상들;
      var 초표 = (필.초대상들 && 필.초대상들[0]) || null;
      plan.target = 초표 ? { unit: 초표, x: unit.x, y: unit.y, dir: unit.dir | 0 } : null;
      plan.need = Ru.ultimateTp(필.초, battle.T);
      plan.reason = '초필살기 ' + 필.초 + ' (AI 지정)';
      return plan;
    }
    if (필.결과 === 1) {
      /* 0x400F7 필살기 함수는 스스로 대상을 찾는다 — 우리는 0x1D124 첫 적(없으면 가까운 적)을 넘기고 닿는지 본다 */
      정면적수(battle, unit);
      var 표적 = 대상목록[0] || null;
      if (!표적) { var 적들 = enemiesOf(battle, unit); 적들.sort(function (a, b) { return dist(unit, a) - dist(unit, b); }); 표적 = 적들[0] || null; }
      var 혼2 = (필.slot === 5 || 필.slot === 10) ? 혼착지(battle, unit, 필.slot) : null;   /* 0x2E0F0 — 0 이면 −1 → 통상 */
      if (표적 && dist(unit, 표적) <= specialReach(battle, unit, 필.slot) && (!(필.slot === 5 || 필.slot === 10) || 혼2)) {
        plan.kind = 'special'; plan.slot = 필.slot; plan.grade = 필.등급; plan.결과 = kind; plan.혼칸 = 혼2;
        plan.target = { unit: 표적, x: unit.x, y: unit.y, dir: unit.dir | 0 };
        plan.need = Ru.specialTp(필.slot, battle.T);
        plan.reason = '필살기 슬롯 ' + 필.slot + ' (등급 ' + 필.등급 + ')';
        return plan;
      }
      /* 0x40114 — 필살기 함수가 −1 → 0 → 통상으로 */
    }
    /* 0x401A6 — 0·−1 이면 0x401C0 통상으로 */
  } else if (kind === 2) {                                                    /* 0x40242 */
    for (var 번 = 0; 번 < 9; 번++) {
      var 시 = 마법시도(battle, unit, opts);
      if (시.결과 === 1 || 시.결과 === 2) {
        마법계획(battle, unit, plan, 시);
        plan.결과 = (시.결과 === 2) ? -2 : 1;                                  /* 0x4025B cmp di,2 → −2 */
        return plan;
      }
    }
    plan.reason = '마법 9번 모두 못 씀 (0x4026C)'; return plan;              /* 0x40266 → −1 */
  } else if (kind !== 0) {
    plan.reason = '[+0x6D] == 4 (0x3F321 −1)'; return plan;                   /* 0x40197 → −1 */
  }
  /* 0x401C0 — 통상 */
  if (!정면적수(battle, unit)) { plan.reason = '칠 수 있는 적 없음 (0x401D7)'; return plan; }
  if ((unit.tp | 0) < 0x28) { plan.reason = 'TP < 40 (0x401E6)'; return plan; }
  if ((ai(unit).atkTend | 0) === 4) { plan.reason = '[+0x6D] == 4 (0x401F0)'; return plan; }
  var 첫 = 대상목록[0];                                                       /* 0x1F748 [0xF0648] 첫 대상 */
  /* ★ 0x40204 0x3F4A1 — 직업 자동기 (2026-09-29 줄 단위)
   *   rand(3) == 0 일 때만 · 액티브스킬 칸 5(0x731B1) == 1 이면 발밑 지형값 > 0x64 이고 (값−0x64)&0xF 가 2·3 → 소용돌이(0x3B9E1)
   *   칸 5 가 아니고 칸 12(0x731B8) == 1 이면 저주(0x3C30A). 스킬이 1 을 내면 통상 공격을 안 한다(0x40209 jne).
   *   스킬 본문의 실패 조건(소용돌이 반경 1 적 없음 0x3BA2C · 저주 정면 적 없음/면역)은 여기서 미리 가려 헛 연출을 막는다 */
  if (랜(opts, 3) === 0) {                                                   /* 0x3F4AA */
    var 직 = battle.jobOf ? battle.jobOf(unit) : null, 액 = 직 && 직['액티브스킬'];
    var 스킬 = -1;
    if (액 && (액[5] | 0) === 1) {                                            /* 0x3F4C0 */
      var 발 = battle.tile ? battle.tile(unit.x, unit.y) : null, 값 = 발 ? (발['값'] | 0) : 0;
      if (값 > 0x64 && (((값 - 0x64) & 0xF) === 2 || ((값 - 0x64) & 0xF) === 3)) {
        var 둘1 = C().diamond(battle, unit.x | 0, unit.y | 0, 1, false);
        for (var s1 = 0; s1 < 둘1.length; s1++) { var t1 = 칸유닛(battle, 둘1[s1].x, 둘1[s1].y); if (t1 && hostile(battle, unit, t1)) { 스킬 = 5; break; } }
      }
    } else if (액 && (액[12] | 0) === 1) {                                    /* 0x3F4FB */
      var 앞d = DIR[(unit.dir | 0) & 3], t12 = 칸유닛(battle, (unit.x | 0) + 앞d.dx, (unit.y | 0) + 앞d.dy);
      if (t12 && hostile(battle, unit, t12) && !(Ru.spriteProfile && Ru.spriteProfile(t12).statusImmune)) 스킬 = 12;
    }
    if (스킬 >= 0) {
      plan.kind = 'skill'; plan.skill = 스킬; plan.결과 = kind;
      plan.target = { unit: 스킬 === 12 ? 칸유닛(battle, (unit.x | 0) + DIR[(unit.dir | 0) & 3].dx, (unit.y | 0) + DIR[(unit.dir | 0) & 3].dy) : null,
                      x: unit.x, y: unit.y, dir: unit.dir | 0 };
      plan.reason = (스킬 === 5 ? '소용돌이' : '저주') + ' (0x3F4A1)';
      return plan;
    }
  }
  plan.kind = 'attack'; plan.결과 = kind;
  plan.target = { unit: 첫, x: unit.x, y: unit.y, dir: unit.dir | 0 };
  plan.reason = '통상 공격 (0x1F738)';
  return plan;
}

/**
 * 0x40323~0x4076A — 행동 «뒤» 이동할 곳. 문맥.기본비용 = [esp+0x2C] (처음 10 · 이동 뒤 0x167C9 위험도)
 * @returns {{edi, move, 기본비용, reason}}  edi: −3 이동 안 함(루프도 끝) · −2 제자리 · 1 이동 · 'end' 0x40876 턴 마무리
 */
function 이동단계(battle, unit, opts, 문맥) {
  opts = opts || {};
  var 기본 = (문맥 && 문맥.기본비용 != null) ? (문맥.기본비용 | 0) : 10;
  var tp = unit.tp | 0;
  if (tp <= 기본 + 0x18) return { edi: -3, move: null, 기본비용: 기본, reason: 'TP ≤ 기본비용+24 (0x4041B)' };
  var Mv = M();
  var Rg = Mv.range(battle, unit, { tp: tp, budget: idiv(tp - 기본, 10) * 4 });   /* 0x40421 0x14300(n*4) */
  var 워반 = AI워프반경(battle, unit), 상 = 목표상태(battle, unit);
  /* 0x4034C~0x40404 — 워프 직업 · TP > 40 · 유닛 목표(상태 1)면 0x3F184: 걸음+워프 링(1 < d ≤ 반경) 안에서 목표를 칠 자리
   *   (0x3F184 는 목표의 상성/방어를 잠깐 극단값으로 바꿔 0x3EBB4 가 목표를 고르게 한다 → 목표를 칠 수 있는 자리가 있나)
   *   거리 ≥ 2 면 워프(edi 2). ☐ 모드 3 의 0x3EBB4 갈래는 0x40473 에서 edi 가 −3 으로 덮여 안 쓰인다 */
  if (워반 && tp > 0x28 && 상 === 1) {
    var 목유w = AI목표읽기(unit).유닛 || AI목표유닛찾기(battle, AI목표읽기(unit).유닛id, AI목표읽기(unit).유닛코드);
    if (목유w && 목유w.alive && hostile(battle, unit, 목유w)) {
      var 자리w = choosePosition(battle, unit, 목유w, { range: 워프범위(battle, unit, Rg, 워반, 1) });
      if (자리w && dist(unit, 자리w) >= 2)                                   /* 0x403F9 0x49ADF · cmp ax,2 */
        return { edi: 2, 기본비용: 기본, target: { unit: 목유w, x: 자리w.x, y: 자리w.y, dir: 자리w.dir },
                 move: { x: 자리w.x, y: 자리w.y, dir: 자리w.dir, warp: true, tp: 0x28 }, reason: '워프 — 목표를 칠 자리 (0x3F184)' };
    }
  }
  var tgt = chooseTarget(battle, unit, { range: Rg, rng: opts.rng, 탐색반경: idiv(tp - 기본, 10) });
  /* 0x405E6 — 0x3E5AB 가 자리를 못 찾았고(edi −1) 워프 직업이고 목표가 있으면 0x3F247: 목표에 가장 가까운 칸으로 워프(방향 그대로) */
  var 목실패 = !tgt || tgt.mode === '유닛목표접근' || (상 === 2 && tgt.mode !== '좌표목표');
  if (워반 && 상 > 0 && 목실패) {
    var 칸w = 워프목적지(battle, unit, Rg, 워반);
    if (칸w) return { edi: 2, 기본비용: 기본, target: null,
                      move: { x: 칸w.x, y: 칸w.y, dir: unit.dir | 0, warp: true, keepDir: true, tp: 0x28 },
                      reason: '워프 — 목표 쪽 (0x3F247)' };
  }
  if (!tgt) return { edi: 'end', move: null, 기본비용: 기본, reason: '도착·모드 5/6·먼 적 없음 (0x40876)' };
  var 같은칸 = (tgt.x === (unit.x | 0) && tgt.y === (unit.y | 0));
  if (같은칸 && ((tgt.dir | 0) === (unit.dir | 0) || tgt.approach))
    return { edi: -2, move: null, 기본비용: 기본, target: tgt, reason: '이미 그 자리·방향 (0x405B2)' };
  var move;
  if (같은칸) move = { x: unit.x, y: unit.y, dir: tgt.dir, turnOnly: true, tp: 기본 };       /* 걸음 0 · 비용 = 기본(0x40820) */
  else {
    var p = AI경로(battle, unit, Rg, tgt.x, tgt.y);
    if (!p) return { edi: -2, move: null, 기본비용: 기본, target: tgt, reason: '길 없음' };
    move = { x: tgt.x, y: tgt.y, dir: tgt.dir, path: p, cost: p.cost,
             tp: idiv(p.cost | 0, 4) * 10 + 기본 };                                            /* 0x40811 걸음×10 + 기본 */
  }
  return { edi: 1, move: move, 기본비용: 기본, target: tgt, reason: tgt.unit ? '목표 쪽으로' : '좌표 목표' };
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **0x40DFD 원거리 루프** (2026-09-29 줄 단위) — 무기 5(활) · 0xB · 0xC · 0xF~0x13
 *   0x44941 턴 분기 0x449CC~0x449FE 가 이 무기 종류를 0x40295 대신 여기로 보낸다.
 *   한 바퀴 = ① 이동(모드 함수 반경 n + 사거리) → ② 0x40BFA 원거리 행동(① 에서 고른 적을 친다)
 *   ☠ 일반 루프(0x40295)와 순서가 반대다 — 먼저 옮기고 쏜다.
 * ══════════════════════════════════════════════════════════════════════ */

/** 0x44941 — 이 무기 종류는 0x40DFD 로 간다(0x449CC~0x449FA) */
function 원거리루프인가(wt) { return wt === 5 || wt === 0xB || wt === 0xC || (wt >= 0xF && wt <= 0x13); }

/** 0x40E48~0x40E9F — 사거리 [esp+0x38] */
function 원거리사거리(battle, u, wt) {
  var j = u.job | 0;
  if (wt === 5) return (j === 0x15 || j === 0x16) ? 5 : 7;
  if (wt === 0xB) return 9;
  if (wt === 0xC) return 3;
  if (wt === 0x12 || wt === 0x13) return 5;
  return 7;
}
/** 0x40DE1 모드 점프표 — 0·1 → 0x3E65E · 2·5 → 0x3EADD · 3 → 0x3EBB4 · 4 → 0x3ED51 · 6 → 0x3EE2B */
var 원거리모드 = { 0: 0, 1: 0, 2: 2, 3: 3, 4: 4, 5: 2, 6: 6 };

/**
 * 0x40EC4~0x413B4 — 원거리 한 바퀴의 이동.
 * @returns {{edi, move, 대상, 기본비용, 끝, reason}}
 *   edi: −3 이동 안 함(그 뒤 루프 끝) · −2 제자리 · 1 걷기 · 2 워프 · −1 못 찾음
 *   끝: 'end' 0x41504(턴 마무리) · 'exit' 0x4150D(턴 마무리 없이 끝)
 */
function 원거리이동단계(battle, unit, opts, 문맥) {
  opts = opts || {};
  var Mv = M();
  var 기본 = (문맥 && 문맥.기본비용 != null) ? (문맥.기본비용 | 0) : 10;
  var tp = unit.tp | 0, n = idiv(tp - 기본, 10);                               /* 0x40ED1 */
  var wt = wtOf(battle, unit), r = 원거리사거리(battle, unit, wt);
  var 워반 = AI워프반경(battle, unit), 상 = 목표상태(battle, unit), mode = ai(unit).mode | 0;
  var edi = -1, 대상 = null, 워프 = null, 워프점수 = null;
  var Rg0 = Mv.range(battle, unit, { tp: tp, budget: n * 4 });

  /* 0x40EF2~0x40FAF — 워프 직업 · TP > 40: 링 2 < d ≤ 반경 · 유닛 목표면 0x3F184 · 모드 3 이면 0x3EBB4 · 거리 > 2 면 edi 2 */
  if (워반 && tp > 0x28) {
    var Rw = 워프범위(battle, unit, Rg0, 워반, 2);                             /* 0x40F15 ebx=2 · 0x40F25 0x3F0E4 */
    if (상 === 1) {
      var G = AI목표읽기(unit).유닛 || AI목표유닛찾기(battle, AI목표읽기(unit).유닛id, AI목표읽기(unit).유닛코드);
      if (G && G.alive && hostile(battle, unit, G)) {
        var pg = choosePosition(battle, unit, G, { range: Rw });
        if (pg) 워프 = { unit: G, x: pg.x, y: pg.y, dir: pg.dir };
      }
    } else if (mode === 3) {
      var t3 = chooseTarget(battle, unit, { range: Rw, mode: 3, 모드만: true, 탐색반경: 워반 + r });
      if (t3) { 워프 = { unit: t3.unit, x: t3.x, y: t3.y, dir: t3.dir }; 워프점수 = t3.key; }
    }
    if (워프 && dist(unit, 워프) > 2) edi = 2;                                 /* 0x40FA4 cmp ax,2 / jle */
  }
  if (tp <= 기본 + 0x18)                                                      /* 0x40FCD → 0x41219 */
    return { edi: -3, move: null, 대상: null, 기본비용: 기본, reason: 'TP ≤ 기본비용+24' };

  var Rg = Rg0, tgt = null, 이동 = null;
  if (상 > 0) {                                                               /* 0x40FF8 */
    if (edi === 2) 대상 = 워프.unit;                                           /* 0x41004 */
    else {
      tgt = chooseTarget(battle, unit, { range: Rg, rng: opts.rng, 탐색반경: n + r });
      if (tgt && (tgt.mode === '유닛목표' || tgt.mode === '좌표목표')) {       /* 0x3E5AB 성공 */
        대상 = tgt.unit || null;
        edi = (tgt.x === (unit.x | 0) && tgt.y === (unit.y | 0) && (tgt.dir | 0) === (unit.dir | 0)) ? -2 : 1;
      } else tgt = null;
    }
  } else {
    var 물 = null;
    if (!워반) {                                                              /* 0x41079 */
      if (wt === 5) 물 = 물러설칸(battle, unit, Rg, 3);                         /* 0x41088 push 3 */
      else if (wt === 0xF) 물 = 물러설칸(battle, unit, Rg, 1);                  /* 0x41092 push 1 */
    }
    if (물) { edi = 1; tgt = { unit: null, x: 물.x, y: 물.y, dir: 물.dir }; }  /* 0x410B6 — 대상 없음 */
    else {
      var m2 = 원거리모드.hasOwnProperty(mode) ? 원거리모드[mode] : -1;
      var tm = (m2 >= 0) ? chooseTarget(battle, unit, { range: Rg, mode: m2, 모드만: true, 탐색반경: n + r }) : null;
      if (m2 === 3 && edi === 2 && (!tm || (워프점수 != null && tm.key != null && 워프점수 < tm.key))) {   /* 0x41139~0x4114C */
        tm = null; 대상 = 워프.unit;
      } else if (tm) {
        대상 = tm.unit || null; tgt = tm;
        edi = (tm.x === (unit.x | 0) && tm.y === (unit.y | 0) && (tm.dir | 0) === (unit.dir | 0)) ? -2 : 1;   /* 0x411A4~0x41064 */
      } else if (mode < 5 && wt === 5 && edi === -1) {                         /* 0x411D8~0x41214 */
        if (tp === maxTpOf(unit) && (unit.chargeTp | 0) < 0x1F4) unit.chargeTp = (unit.chargeTp | 0) + 0x14;
        return { edi: -1, move: null, 대상: null, 기본비용: 기본, 끝: 'exit', reason: '할 일 없음 — 집중 (0x411EE)' };
      }
    }
  }
  /* 0x4121E — 못 찾았고 워프 직업이고 목표가 있으면 0x3F247 */
  if (edi === -1 && 워반 && 상 > 0) {
    var 칸w = 워프목적지(battle, unit, Rg, 워반);
    if (칸w) { edi = 2; 워프 = { unit: null, x: 칸w.x, y: 칸w.y, dir: -1 }; }
  }
  if (edi === -1) {                                                           /* 0x41265 — 먼 적 */
    if (상 > 0) {
      /* 0x41295 0x3E251 목적지 → 0x412E3 제자리면 −2 · 0x41308~ 걷기(0x14300 · 0x1499C · 0x15342 …) — 근접 루프와 같다 (2026-10-01)
       *   ☠ 예전: 이번 턴 범위 안 맨해튼 최소 칸(목표로가까운칸) */
      var 쪽r = 목표쪽목적지(battle, unit);
      var 자리 = 쪽r ? 목적지로걷기(battle, unit, Rg, 쪽r.x, 쪽r.y, 쪽r.목, null, mode, 0) : null;
      if (!자리) return { edi: -2, move: null, 대상: null, 기본비용: 기본, reason: '목표 쪽 자리 없음' };
      tgt = { unit: null, x: 자리.x, y: 자리.y, dir: 자리.dir };
    } else {
      if (상 === -1) return { edi: -1, move: null, 대상: null, 기본비용: 기본, 끝: 'end', reason: '도착 (0x412A0)' };
      if (mode === 6) return { edi: -1, move: null, 대상: null, 기본비용: 기본, 끝: 'end', reason: '모드 6 (0x412AA)' };
      var 먼 = 근접접근(battle, unit, Rg, mode);                                 /* 0x412BF 0x3DF3B … 0x14FA4 */
      /* ☐ 0x3D7B2 의 무기 5 이상 갈래(활 부채꼴 0x1CB53·0x1C685 등)는 아직 — 근접 갈래로 잰다 */
      if (!먼) return { edi: -1, move: null, 대상: null, 기본비용: 기본, 끝: 'exit', reason: '먼 적 없음 (0x412CA)' };
      tgt = 먼;
    }
    if (tgt.x === (unit.x | 0) && tgt.y === (unit.y | 0)) return { edi: -2, move: null, 대상: null, 기본비용: 기본, reason: '제자리' };
    edi = 1;
  }
  if (edi <= 0) return { edi: edi, move: null, 대상: 대상, 기본비용: 기본, reason: '제자리' };

  /* 0x413C9~0x4142A — 목적지까지 3 ≤ 거리 ≤ 워프반경 이거나 edi 2 면 워프 */
  var 목적 = (edi === 2) ? 워프 : tgt;
  var 거리 = Math.abs(목적.x - (unit.x | 0)) + Math.abs(목적.y - (unit.y | 0));
  if (edi === 2 || (거리 >= 3 && 거리 <= 워반)) {
    return { edi: 2, 대상: 대상, 기본비용: 기본, reason: '워프 (0x41406)',
             move: { x: 목적.x, y: 목적.y, dir: (목적.dir == null || 목적.dir < 0) ? (unit.dir | 0) : 목적.dir,
                     warp: true, keepDir: (목적.dir == null || 목적.dir < 0), tp: 0x28 } };
  }
  var 같은칸 = (목적.x === (unit.x | 0) && 목적.y === (unit.y | 0));
  if (같은칸) 이동 = { x: unit.x, y: unit.y, dir: 목적.dir, turnOnly: true, tp: 기본 };
  else {
    var p = AI경로(battle, unit, Rg, 목적.x, 목적.y);
    if (!p) return { edi: -2, move: null, 대상: 대상, 기본비용: 기본, reason: '길 없음' };
    이동 = { x: 목적.x, y: 목적.y, dir: 목적.dir, path: p, cost: p.cost, tp: idiv(p.cost | 0, 4) * 10 + 기본 };   /* 0x41471 */
  }
  return { edi: 1, move: 이동, 대상: 대상, 기본비용: 기본, reason: '걷기' };
}

/**
 * 0x40BFA(u, 대상, 무기) — 원거리 행동. 0x3F321 → 1 필살(0x3FFD4) · 2 마법(0x432A0 ×9) · 0 통상(대상이 있어야)
 * @returns plan  결과: −2 끝(턴 마무리 없음) · −1 할 것 없음 · 0·1·2 한 것
 */
function 원거리행동단계(battle, unit, 대상, opts) {
  opts = opts || {};
  var Ru = R();
  var plan = { unit: unit, control: 'ai', kind: 'none', action: -1, target: null, move: null,
               slot: -1, spell: -1, reason: '', 결과: -1 };
  if (!unit || !unit.alive) return plan;
  var kind = decideAction(battle, unit, opts);                                 /* 0x40C09 */
  plan.action = kind;
  if (kind === 1) {                                                           /* 0x40C33 */
    var 필 = 필살시도(battle, unit, opts);
    if (필.결과 === 2) { plan.kind = 'burn'; plan.slot = 필.slot; plan.tpBurn = true; plan.결과 = -2;
                          plan.reason = '필살기 차징 → TP 만 소모'; return plan; }
    if (필.결과 === 1 && 필.초 != null) {   /* [리마스터] AI 지정 초필살기 */
      plan.kind = 'special'; plan.ultimate = true; plan.slot = -1; plan.grade = 1; plan.결과 = 1;
      plan.초칸 = 필.초칸; plan.초대상들 = 필.초대상들;
      var 초표2 = (필.초대상들 && 필.초대상들[0]) || null;
      plan.target = 초표2 ? { unit: 초표2, x: unit.x, y: unit.y, dir: unit.dir | 0 } : null;
      plan.need = Ru.ultimateTp(필.초, battle.T);
      plan.reason = '초필살기 ' + 필.초 + ' (AI 지정)'; return plan;
    }
    if (필.결과 === 1) {
      var 표 = 대상 || (정면적수(battle, unit) ? 대상목록[0] : null);
      var 혼3 = (필.slot === 5 || 필.slot === 10) ? 혼착지(battle, unit, 필.slot) : null;   /* 0x2E0F0 — 0 이면 −1 → 통상 */
      if (표 && dist(unit, 표) <= specialReach(battle, unit, 필.slot) && (!(필.slot === 5 || 필.slot === 10) || 혼3)) {
        plan.kind = 'special'; plan.slot = 필.slot; plan.grade = 필.등급; plan.결과 = 1; plan.혼칸 = 혼3;
        plan.target = { unit: 표, x: unit.x, y: unit.y, dir: unit.dir | 0 };
        plan.need = Ru.specialTp(필.slot, battle.T);
        plan.reason = '필살기 슬롯 ' + 필.slot; return plan;
      }
    }
  } else if (kind === 2) {                                                    /* 0x40DA7 */
    for (var 번 = 0; 번 < 9; 번++) {
      var 시 = 마법시도(battle, unit, opts);
      if (시.결과 === 1 || 시.결과 === 2) { 마법계획(battle, unit, plan, 시); plan.결과 = (시.결과 === 2) ? -2 : 1; return plan; }
    }
    plan.reason = '마법 9번 모두 못 씀'; return plan;
  } else if (kind !== 0) { plan.reason = '[+0x6D] == 4'; return plan; }
  /* 0x40C52 — 통상: 대상 · TP ≥ 40 · [+0x6D] != 4 */
  if (!대상 || !대상.alive) { plan.reason = '대상 없음 (0x40C54)'; return plan; }
  if ((unit.tp | 0) < 0x28) { plan.reason = 'TP < 40'; return plan; }
  if ((ai(unit).atkTend | 0) === 4) { plan.reason = '[+0x6D] == 4'; return plan; }
  var wt = wtOf(battle, unit);
  /* 0x40C94~0x40CBE — 활·0xF·0x13 은 대상 칸이 적대여야 한다(아니면 아무것도 안 하고 kind 를 낸다) */
  if ((wt === 5 || wt === 0xF || wt === 0x13) && !hostile(battle, unit, 대상)) {
    plan.결과 = kind; plan.reason = '대상이 적이 아님 (0x40CBE)'; return plan;
  }
  plan.kind = 'attack'; plan.결과 = kind;
  /* ★ 0x40C52 → 0x1DDF0 — 고른 대상을 «바로» 친다. 평타 사거리 모양(0x1CC09)으로 다시 거르지 않는다.
   *   ☠ executor 검증이 attackCells 로 다시 걸러, 페리튼(직선 · 지형에서 끊김)이 막힌 대상을 고르면 «사거리 밖» 거절 →
   *     피해·TP 없이 같은 행동을 되풀이했다 (2026-10-03 사장님 「페리튼 공격 판정이 이상해. 오브젝트에 막혔는데 무한 루프처럼 계속 쏴. 데미지는 안들어가고」 · 「ai해놨을때야」) */
  plan.force = true;
  plan.faceTo = { x: 대상.x | 0, y: 대상.y | 0 };                             /* 0x40C82 0x46DF1 대상 쪽을 본다 */
  /* ★ 무기 0x11·0x12(배 대포 등)는 돌지 않는다 — 원본 0x40BFA 에 [+0x63] 쓰기가 없고 0x409AD 가 «지금 방향 기준 옆»으로 쏜다
   *   (0x40A4A test [유닛+0x63],1 → 남북/동서 중 대상 쪽 옆 · 2026-10-10 사장님 「대포의 경우 옆으로 쏴야하는데, ai지정시 정면으로 쏜다고」)
   *   ☠ faceDir 로 대상 쪽을 보게 돌려 대포가 정면으로 나갔다. 0x40C82 0x46DF1 은 «대상 쪽을 본다»가 아니라 카메라를 가운데로 옮기는 함수다. */
  /* 무기 0x10(군단 Magic) 도 돌지 않는다 — 원본 플레이어 길 0x1F8AF cmp cl,0x10 / je 0x1F8EC 가 돌기 0x1A1DE 를 건너뛰고, AI 0x40BFA 에는 [+0x63] 쓰기가 없다 (2026-10-10) */
  var _돌지않음 = (wt === 0x10 || wt === 0x11 || wt === 0x12);
  plan.target = { unit: 대상, x: unit.x, y: unit.y, dir: _돌지않음 ? (unit.dir | 0) : faceDir(unit, 대상) };
  plan.reason = '원거리 통상 (0x1DDF0)';
  if (wt === 0x11 || wt === 0x12) {
    var 과녁 = 대포과녁(battle, unit, 대상, wt);
    if (!과녁) { plan.kind = 'none'; plan.reason = '대포 — 직선 위 십자가 대상에 안 닿음 (0x409AD)'; return plan; }
    plan.조준칸 = { x: 과녁.x, y: 과녁.y };
    plan.대상들 = 과녁.적들;
    plan.reason = '대포 (0x409AD) — 과녁 (' + 과녁.x + ',' + 과녁.y + ') 적 ' + 과녁.적들.length;
  }
  if (wt === 0xB || wt === 0xC) {
    var 마과녁 = 마장기과녁(battle, unit, plan.target.dir | 0);
    if (마과녁) {
      plan.조준칸 = { x: 마과녁.x, y: 마과녁.y };
      plan.대상들 = 마과녁.적들;
      plan.reason = '마장기 원거리 (0x4083A) — 과녁 (' + 마과녁.x + ',' + 마과녁.y + ') 적 ' + 마과녁.적들.length;
    }
  }
  return plan;
}

/**
 * 0x409AD — AI 대포(무기 0x11·0x12)의 과녁 칸 (2026-10-10 원본 직독)
 *   0x409CC  대상 둘레 반경 1 십자에 표시(0x13D02)
 *   0x40A19  0x11: 쏘는 쪽 = 지금 방향 · 한 칸 민 뒤 6칸 / 0x12: 0x40A4A 지금 방향이 동·서면 대상 위·아래로 남(0)/북(2), 남·북이면 좌·우로 동(3)/서(1) · 두 칸 민 뒤 3칸
 *   0x40AAC~0x40B94  한 칸씩 나아가며 그 칸이 표시(대상 십자 안)면 그 칸 십자 안 적 수(0x1AC08 반경 1 · 0x1A1F8)를 세어 가장 많은 칸
 *   ⇒ 대각선 없이 «직선 위 한 칸»을 과녁으로 쏘고, 그 칸 십자에 든 적이 맞는다 (사장님 「대포는 직선으로 밖에 못나가. 효과범위에 들어가면 데미지를 입을 뿐」)
 */
/**
 * 0x4083A — AI 마장기 원거리(무기 0xB 베샤르·Aero Cannon · 0xC 페리튼 Arrow)의 과녁 (2026-10-28 CD설치본 직독)
 *   사장님 「3급마장기 공격 범위에 맞는걸로 아는데 지금 한명밖에 안맞아.」·「기본적으로 타겟 지정을 하면 그 주변으로 범위내 적이 맞는 구조야. 타겟지정영역 전체에 데미지가 들어가는게 아니고」
 *   ```asm
 *   0x40CE7  cmp dl,0xB / 0xC → 0x40CF3 call 0x4083A        ; (0x40C51 의 «대상 하나 등록» 길을 안 탄다)
 *   0x4087C  call 0x1AA82(시작 칸, 지금 방향, 길이 9 · 7)     ; 과녁 고르기 — 반환 = 모인 적 수
 *     0x1AB26  0x13CBD(칸) == 1 인 칸(공격 범위)만
 *     0x1AB51  0x1A410(그 칸, 방향, 폭 2, 길이 2) → 0x1AB89 0x1201D 적대 수 셈
 *     0x1AB96  cmp bx,[best] / jle → 더 «많을» 때만 바꾼다(같으면 앞 칸)
 *   0x408AA  0x1A410(과녁, 방향, 폭 2, 길이 2) · 0x408D3 0x1A1B6 칸마다 적 등록 → 그 적 모두 맞는다
 *   ```
 *   ⇒ 과녁 둘레 2×2 안 적만 (범위 전체가 아니다) · 적이 없으면 null(예전처럼 고른 대상 하나)
 */
function 마장기과녁(battle, u, 방향) {
  var Cb = C(); if (!Cb || !Cb.attackCells || !Cb.원본직선) return null;
  var 옛 = u.dir; u.dir = 방향 & 3;
  var 칸들 = []; try { 칸들 = Cb.attackCells(battle, u) || []; } finally { u.dir = 옛; }
  var 최고 = 0, 고른 = null;
  for (var i = 0; i < 칸들.length; i++) {
    var 블 = Cb.원본직선(battle, 칸들[i].x | 0, 칸들[i].y | 0, 방향 & 3, 2, 2), 적 = [];
    블.forEach(function (c) { var t = battle.at(c.x, c.y); if (t && t.alive && t !== u && hostile(battle, u, t) && 적.indexOf(t) < 0) 적.push(t); });
    if (적.length > 최고) { 최고 = 적.length; 고른 = { x: 칸들[i].x | 0, y: 칸들[i].y | 0, 적들: 적 }; }   /* 0x1AB96 jle — 더 많을 때만 */
  }
  return 고른;
}
function 대포과녁(battle, u, 대상, wt) {
  var Cb = C();
  var 쪽, 민, 칸수;
  if (wt === 0x11) { 쪽 = u.dir & 3; 민 = 1; 칸수 = 6; }                       /* 0x40A1E ebx=6 · 0x40AA0 한 칸 */
  else {
    if ((u.dir | 0) & 1) 쪽 = ((u.y | 0) >= (대상.y | 0)) ? 2 : 0;              /* 0x40A68 cmp y / jge → 2 · 아니면 0 */
    else 쪽 = ((u.x | 0) >= (대상.x | 0)) ? 1 : 3;                              /* 0x40A50 cmp x / jge → 1 · 아니면 3 */
    민 = 2; 칸수 = 3;                                                           /* 0x40A91·0x40AA0 두 칸 · 0x40A42 [esp+0x18]=3 */
  }
  var d = DIR[쪽], x = (u.x | 0) + d.dx * 민, y = (u.y | 0) + d.dy * 민, 최고 = -1, 고른 = null;
  for (var i = 0; i < 칸수; i++) {
    x += d.dx; y += d.dy;                                                       /* 0x40ABB 한 칸 */
    if (Math.abs(x - (대상.x | 0)) + Math.abs(y - (대상.y | 0)) > 1) continue;  /* 0x40ACE 0x13CBD == 1 (대상 십자 표시) */
    var 적들 = [];
    Cb.diamond(battle, x, y, 1, true).forEach(function (c) {                    /* 0x40AF9 0x1AC08 반경 1 */
      var t = battle.at(c.x, c.y);
      if (t && t.alive && t !== u && 적들.indexOf(t) < 0 && hostile(battle, u, t)) 적들.push(t);   /* 0x40B22 0x1A1F8(진영) */
    });
    if (적들.length > 최고) { 최고 = 적들.length; 고른 = { x: x, y: y, 적들: 적들 }; }   /* 0x40B29 cmp di,[수] / jge 건너뜀 */
  }
  return (고른 && 고른.적들.length) ? 고른 : null;
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **0x3CA3C 무기 5(활) 갈래 — 활 설 자리 · 지형 높이 가림** (2026-09-29 어셈블리 한 줄씩)
 *   대상의 네 방향 d 마다 대상 옆 칸 C 에서 부채꼴을 만들어
 *     0x1CB53 부채꼴(C, d, 폭 3, 사거리+1) 값 저장 → 0x1B7D4 기준 → 0x1C685 그림자·고르기 → 0x1CBB1 되돌림
 *   남은 칸 중 이동배열 값이 «엄격히» 가장 큰 설 수 있는 칸. 방향 = (d+2)&3 · 점수 = 값 + 90 − 나~대상 거리(+4 같은 방향)
 *   이동배열: 이번 턴 범위(값) · 적대 유닛 칸 −(진영+1) · 그 밖 −1 · 제 칸 = 예산+1(0x3CA8B)
 *   ☠ 플레이어 활 평타의 지형 시야 그림자(0x1B919 계열)와는 다른 함수다 — 그쪽은 할일 N-16.
 * ══════════════════════════════════════════════════════════════════════ */

/** 0x1AF22 / 0x1B00D — 부채꼴 반복자 (상태까지 원본 그대로) */
function 원본부채꼴(x, y, dir, 폭, 길이) {
  var s = { X: x | 0, Y: y | 0, W: 폭 | 0, L: 길이 | 0, i: 0, r: 0, done: false };
  var d = dir & 3;
  if (d === 0) { s.a = 1; s.b = 0; s.c = -(폭 | 0); s.dd = 1; }               /* 0x1AF68 */
  else if (d === 1) { s.a = 0; s.b = 1; s.c = -1; s.dd = -(폭 | 0); }          /* 0x1AF8D */
  else if (d === 2) { s.a = -1; s.b = 0; s.c = 폭 | 0; s.dd = -1; }            /* 0x1AFB8 */
  else { s.a = 0; s.b = -1; s.c = 1; s.dd = 폭 | 0; }                          /* 0x1AFDB */
  s.next = function () {                                                     /* 0x1B00D */
    if (s.done) return null;
    var out = { x: s.X, y: s.Y };
    s.i++;
    if (s.i !== s.W) { s.X += s.a; s.Y += s.b; return out; }                  /* 0x1B04F */
    s.r++;
    if (s.r === s.L) { s.done = true; s.i = 0; return out; }                  /* 0x1B09A */
    var 남 = s.L - s.r, b2 = 2 * s.b, a2 = 2 * s.a;
    if (남 === 1) {                                                          /* 0x1B0D1 마지막 줄 */
      s.W -= 2;
      if (s.a === 0) s.dd += b2; else s.c += a2;
      s.X += s.c; s.Y += s.dd;
    } else {                                                                 /* 0x1B12B */
      s.W += 2;
      s.X += s.c; s.Y += s.dd;
      if (s.a === 0) s.dd -= b2; else s.c -= a2;
    }
    s.i = 0;
    return out;
  };
  return s;
}

/** 0x3CA3C 무기 5 — @returns {{x,y,dir,값,점수}|null} */
function 활자리(battle, u, target, Rg, 모드인자) {
  var 모드3 = (모드인자 === 3);
  /* '방향마다' — 0x3D3E5 무기 5 갈래(0x3D6E8): 방향마다 0x1B7D4(edx 2 · eax −1)로 기준을 다시 세우고 그 방향의 고른 칸을 따로 낸다 (2026-10-02) */
  var 방향마다 = (모드인자 === '방향마다'), 방향결과 = [];                                                 /* 0x3D7B2 무기 5 갈래는 모드 3(가장 가까운 칸) */
  var W = battle.W | 0, H = battle.H | 0;
  var 배 = new Int16Array(W * H);
  for (var k0 = 0; k0 < 배.length; k0++) 배[k0] = -1;
  (Rg.cells || []).forEach(function (c) { if (c.x >= 0 && c.y >= 0 && c.x < W && c.y < H) 배[c.y * W + c.x] = c.left | 0; });
  battle.units.forEach(function (t) {                                        /* 0x1419C 적대 유닛 칸 −(진영+1) */
    if (!t.alive || t === u || !hostile(battle, u, t)) return;
    var cs = battle.cellsOf ? battle.cellsOf(t, t.x, t.y, t.dir) : [[t.x, t.y]];
    cs.forEach(function (c) { if (c[0] >= 0 && c[1] >= 0 && c[0] < W && c[1] < H) 배[c[1] * W + c[0]] = -((t.side | 0) + 1); });
  });
  function 읽(x, y) { return (x >= 0 && y >= 0 && x < W && y < H) ? 배[y * W + x] : -128; }   /* 0x13CBD */
  function 쓰(x, y, v) {                                                    /* 0x13D02 경계 */
    if (x - 2 < 0 || x - 2 >= W - 4 || y - 4 < 0 || y - 4 >= H - 8) return;
    배[y * W + x] = v;
  }
  function 지형(x, y) {                                                     /* 0x1093D + (> 0x64 → −0x64) */
    var idx = y * W + x, v = 0;
    if (idx >= 0 && idx < W * H) { var tl = battle.tile((idx % W), (idx / W) | 0); v = tl ? (tl['값'] & 0xFF) : 0; }
    return (v > 0x64) ? (v - 0x64) & 0xFF : v;
  }
  var 등급 = 1, 모드 = 2, 최 = -1, 최x = 0, 최y = 0;                          /* [0xF0B8A] · [0xF0B8E] · [0xF0B86/84/82] */
  function 칠(x, y) {                                                       /* 0x1BA9C */
    if (x - 2 < 0 || x - 2 >= W - 4 || y - 4 < 0 || y - 4 >= H - 8) return;
    var v = 배[y * W + x];
    if (등급 === 2) { if ((v > -14900 && v <= -10) || v >= -1) 배[y * W + x] = -2; }
    else if (등급 === 3) { if (v >= -1) 배[y * W + x] = -2; }
    else 배[y * W + x] = -2;
  }
  function 높음2(x, y) { if (x - 2 < 0 || x - 2 >= W - 4 || y - 4 < 0 || y - 4 >= H - 8) return; 배[y * W + x] = -(배[y * W + x] + 15000); }   /* 0x1C5CE */
  function 높음1(x, y) { if (x - 2 < 0 || x - 2 >= W - 4 || y - 4 < 0 || y - 4 >= H - 8) return; 배[y * W + x] = -(배[y * W + x] + 10); }      /* 0x1C62B */
  /* 0x1BB62 — 한쪽으로 넓어지는 삼각 (줄 len−1 · 폭 1 부터 +1) */
  function 삼각(x, y, d, len, 쪽) {
    var w = 1, n;
    if (d === 0) { var st = 쪽 ? -1 : 1, yy = y + 1; for (n = 0; n < len - 1; n++) { for (var i = 0, cx = x; i < w; i++, cx += st) 칠(cx, yy); yy++; w++; } }
    else if (d === 1) { var st1 = 쪽 ? -1 : 1, x0 = x - 1; for (n = 0; n < len - 1; n++) { for (var i1 = 0, cy = y; i1 < w; i1++, cy += st1) 칠(x0, cy); w++; x0--; } }
    else if (d === 2) { var st2 = 쪽 ? 1 : -1, y2 = y - 1; for (n = 0; n < len - 1; n++) { for (var i2 = 0, cx2 = x; i2 < w; i2++, cx2 += st2) 칠(cx2, y2); y2--; w++; } }
    else { var st3 = 쪽 ? 1 : -1, x3 = x + 1; for (n = 0; n < len - 1; n++) { for (var i3 = 0, cy3 = y; i3 < w; i3++, cy3 += st3) 칠(x3, cy3); w++; x3++; } }
  }
  /* 0x1BD1E — 제 칸 칠하고, 폭 2 부터 홀수 줄마다 시작을 옮기고 짝수 줄마다 폭 +1 (줄 len−1) */
  function 비탈(x, y, d, len, 쪽) {
    칠(x, y);
    var w = 2, cnt;
    if (d === 0) { var st = 쪽 ? -1 : 1, sx = x, yy = y + 1; for (cnt = 1; cnt < len; cnt++) { for (var i = 0, cx = sx; i < w; i++, cx += st) 칠(cx, yy); yy++; if (cnt & 1) sx += st; else w++; } }
    else if (d === 1) { var s1 = 쪽 ? -1 : 1, x1 = x - 1, sy = y; for (cnt = 1; cnt < len; cnt++) { for (var i1 = 0, cy = sy; i1 < w; i1++, cy += s1) 칠(x1, cy); x1--; if (cnt & 1) sy += s1; else w++; } }
    else if (d === 2) { var s2 = 쪽 ? 1 : -1, sx2 = x, y2 = y - 1; for (cnt = 1; cnt < len; cnt++) { for (var i2 = 0, cx2 = sx2; i2 < w; i2++, cx2 += s2) 칠(cx2, y2); y2--; if (cnt & 1) sx2 += s2; else w++; } }
    else { var s3 = 쪽 ? 1 : -1, x3 = x + 1, sy3 = y; for (cnt = 1; cnt < len; cnt++) { for (var i3 = 0, cy3 = sy3; i3 < w; i3++, cy3 += s3) 칠(x3, cy3); x3++; if (cnt & 1) sy3 += s3; else w++; } }
  }
  /* 0x1BF2E — 대각 한 줄 (len−1 칸) */
  function 대각(x, y, d, len, 쪽) {
    var n;
    if (d === 0) { var st = 쪽 ? -1 : 1, cx = x, cy = y + 1; for (n = 0; n < len - 1; n++) { 칠(cx, cy); cy++; cx += st; } }
    else if (d === 1) { var s1 = 쪽 ? -1 : 1, x1 = x - 1, y1 = y; for (n = 0; n < len - 1; n++) { 칠(x1, y1); x1--; y1 += s1; } }
    else if (d === 2) { var s2 = 쪽 ? 1 : -1, x2 = x, y2 = y - 1; for (n = 0; n < len - 1; n++) { 칠(x2, y2); y2--; x2 += s2; } }
    else { var s3 = 쪽 ? 1 : -1, x3 = x + 1, y3 = y; for (n = 0; n < len - 1; n++) { 칠(x3, y3); x3++; y3 += s3; } }
  }
  /* 0x1C046 — 가운데 줄 그림자: 폭 1 로 제 칸 줄부터, 홀수 줄 뒤 폭 +2 (줄 len) */
  function 가운데(x, y, d, len) {
    var w = 1, cnt;
    if (d === 0) { var sx = x, yy = y; for (cnt = 0; cnt < len; cnt++) { for (var i = 0; i < w; i++) 칠(sx + i, yy); yy++; if (cnt & 1) { w += 2; sx--; } } }
    else if (d === 1) { var x1 = x, sy = y; for (cnt = 0; cnt < len; cnt++) { for (var i1 = 0; i1 < w; i1++) 칠(x1, sy + i1); x1--; if (cnt & 1) { sy--; w += 2; } } }
    else if (d === 2) { var sx2 = x, y2 = y; for (cnt = 0; cnt < len; cnt++) { for (var i2 = 0; i2 < w; i2++) 칠(sx2 + i2, y2); y2--; if (cnt & 1) { w += 2; sx2--; } } }
    else { var x3 = x, sy3 = y; for (cnt = 0; cnt < len; cnt++) { for (var i3 = 0; i3 < w; i3++) 칠(x3, sy3 + i3); x3++; if (cnt & 1) { sy3--; w += 2; } } }
  }
  /* 0x1C1B2 — 시작 칸이 막혔을 때 부채꼴 통째 그림자 (줄 len−1 · 폭 1 부터 +2) */
  function 통째(x, y, d, len) {
    var w = 1, n;
    if (d === 0) { var sx = x, yy = y + 1; for (n = 0; n < len - 1; n++) { for (var i = 0; i < w; i++) 칠(sx + i, yy); yy++; w += 2; sx--; } }
    else if (d === 1) { var x1 = x - 1, sy = y; for (n = 0; n < len - 1; n++) { for (var i1 = 0; i1 < w; i1++) 칠(x1, sy + i1); w += 2; sy--; x1--; } }
    else if (d === 2) { var sx2 = x, y2 = y - 1; for (n = 0; n < len - 1; n++) { for (var i2 = 0; i2 < w; i2++) 칠(sx2 + i2, y2); y2--; w += 2; sx2--; } }
    else { var x3 = x + 1, sy3 = y; for (n = 0; n < len - 1; n++) { for (var i3 = 0; i3 < w; i3++) 칠(x3, sy3 + i3); w += 2; sy3--; x3++; } }
  }
  /* 0x1C31A — −5 를 −4 로 (폭 3 · 홀수 줄 뒤 +2 · 줄 len−1) */
  function 넓힘(x, y, d, len) {
    var w = 3, cnt;
    function 한(cx, cy) { if (읽(cx, cy) === -5) 쓰(cx, cy, -4); }
    if (d === 0) { var sx = x - 1, yy = y + 1; for (cnt = 0; cnt < len - 1; cnt++) { for (var i = 0; i < w; i++) 한(sx + i, yy); yy++; if (cnt & 1) { sx--; w += 2; } } }
    else if (d === 1) { var x1 = x - 1, sy = y - 1; for (cnt = 0; cnt < len - 1; cnt++) { for (var i1 = 0; i1 < w; i1++) 한(x1, sy + i1); x1--; if (cnt & 1) { sy--; w += 2; } } }
    else if (d === 2) { var sx2 = x - 1, y2 = y - 1; for (cnt = 0; cnt < len - 1; cnt++) { for (var i2 = 0; i2 < w; i2++) 한(sx2 + i2, y2); y2--; if (cnt & 1) { sx2--; w += 2; } } }
    else { var x3 = x + 1, sy3 = y - 1; for (cnt = 0; cnt < len - 1; cnt++) { for (var i3 = 0; i3 < w; i3++) 한(x3, sy3 + i3); x3++; if (cnt & 1) { sy3--; w += 2; } } }
  }
  /** 0x1C685(C, d, len) — 모드 2 */
  function 그림자고르기(x0, y0, d, len) {
    var 뒤 = DIR[(d + 2) & 3];
    var t0 = 지형(x0 + 뒤.dx, y0 + 뒤.dy), Hh = (t0 - (t0 & 0xF)) & 0xFF;      /* 0x1C6C9~0x1C6DB */
    var H8 = (Hh + 8) & 0xFF, H16 = (Hh + 0x10) & 0xFF, H24 = (Hh + 0x18) & 0xFF;
    var it = 원본부채꼴(x0, y0, d, 1, len); it.next();                         /* 0x1C713 · 첫 칸 소비 */
    var c;
    while ((c = it.next())) {                                                /* 0x1C725~0x1C7CE */
      var t = 지형(c.x, c.y);
      if (t === 0 || t === H24) 쓰(c.x, c.y, -5);
      else if (t > H16) 높음2(c.x, c.y);
      else if (t > Hh) 높음1(c.x, c.y);
      else if (모드 === 3) 쓰(c.x, c.y, -1);
    }
    넓힘(x0, y0, d, len);                                                    /* 0x1C7F8 */
    var 옆 = DIR[(d + 1) & 3];
    var it2 = 원본부채꼴(x0 + 옆.dx, y0 + 옆.dy, d, 3, len);                    /* 0x1C83C */
    var tc = 지형(x0, y0);
    if (tc === 0 || tc > H16) 통째(x0, y0, d, len);                          /* 0x1C857~0x1C875 */
    쓰(x0, y0, -2);                                                          /* 0x1C889 */
    while ((c = it2.next())) {                                               /* 0x1CA64 */
      var bl = 지형(c.x, c.y), v = 읽(c.x, c.y);
      if (v === -2) continue;
      if (bl === 0 || (bl & 0xF) === 8) {                                    /* 0x1C956 장애 칸 → 그림자 */
        등급 = (bl === H24) ? 2 : ((bl === H8) ? 3 : 1);
        var 길 = (it2.L - it2.r) + ((it2.i === 0) ? 1 : 0);
        var 가운 = (d & 1) ? (c.y === y0) : (c.x === x0);
        if (가운) { 가운데(c.x, c.y, d, 길); continue; }
        var 쪽 = (d === 0) ? (x0 > c.x) : (d === 2) ? (x0 < c.x) : (d === 1) ? (c.y < y0) : (c.y > y0);
        if (it2.i <= 1) 대각(c.x, c.y, d, 길, 쪽);
        else if (v === -4) 삼각(c.x, c.y, d, 길, 쪽);
        else 비탈(c.x, c.y, d, 길, 쪽);
        continue;
      }
      if (it2.i <= 1) continue;                                              /* 0x1CAC9 줄 가장자리 */
      if (모드 === 3) {                                                     /* 0x1C90A — 나에게서 거리 < 최고 · 0x16699 */
        var dd3 = Math.abs(c.x - ox) + Math.abs(c.y - oy);
        if (dd3 >= 최) continue;
        if (M().canPlace && !M().canPlace(battle, u, c.x, c.y, d)) continue;
        최 = dd3; 최x = c.x; 최y = c.y;
        continue;
      }
      var si = v;
      if (v < -14900) { si = -(v + 15000); 쓰(c.x, c.y, si); }                /* 0x1CAF1 +0x3A98 → 0x1C89F(+10 건너뜀) · neg */
      else if (v < -5) { si = -(v + 10); 쓰(c.x, c.y, si); }                 /* 0x1C893 */
      if (si <= 최) continue;                                                /* 0x1C8B3 */
      var 빈 = (function () { var t2 = battle.at ? battle.at(c.x, c.y) : null; return !t2 || t2 === u; })();
      if (!빈 || 읽(c.x, c.y) < 0) continue;                                  /* 0x1C8DB 0x165C2 */
      최 = si; 최x = c.x; 최y = c.y;
    }
  }
  var ox = u.x | 0, oy = u.y | 0, od = u.dir | 0;
  var 격자 = !!(battle && battle.unplace && battle.place && battle.at && battle.at(ox, oy) === u);
  if (격자) battle.unplace(u);                                               /* 0x3CA6E 0x11EE4 */
  var 결과 = null;
  try {
    if (!모드3) 쓰(ox, oy, (Rg.budget | 0) + 1);                              /* 0x3CA8B (0x3D7B2 에는 없다) */
    var 사거리 = ((u.job | 0) === 0x15 || (u.job | 0) === 0x16) ? 5 : 7;      /* 0x1AEF3 */
    var di = 모드3 ? 0x7FFF : -1;
    for (var d = 0; d < 4; d++) {
      var C0 = { x: (target.x | 0) + DIR[d].dx, y: (target.y | 0) + DIR[d].dy };   /* 0x3CAF3 0x49ABC */
      var 저장 = [], s0 = 원본부채꼴(C0.x, C0.y, d, 3, 사거리 + 1), q;        /* 0x1CB53 */
      while ((q = s0.next())) 저장.push(읽(q.x, q.y));
      if (d === 0 || 방향마다) 최 = 모드3 ? 0x7FFF : -1;                     /* 0x3CCC9 · 0x3DA0E 0x1B7D4 · 0x3D72E(방향마다) */
      모드 = 모드3 ? 3 : 2;
      그림자고르기(C0.x, C0.y, d, 사거리);                                     /* 0x3CD13 */
      var s1 = 원본부채꼴(C0.x, C0.y, d, 3, 사거리 + 1), n1 = 0;               /* 0x1CBB1 되돌림 */
      while ((q = s1.next())) { 쓰(q.x, q.y, 저장[n1++]); }
      if (방향마다) { 방향결과.push({ d: d, 값: 최, x: 최x, y: 최y }); continue; }   /* 0x3D771 [0xF0B86] 값 · [0xF0B84] x · [0xF0B82] y */
      if (모드3 ? (최 < di) : (최 > di)) { di = 최; 결과 = { x: 최x, y: 최y, d: d }; }   /* 0x3CD41 · 0x3DA80 */
    }
  } finally { if (격자) battle.place(u, ox, oy, od); }
  if (방향마다) return 방향결과;
  if (!결과) return null;                                                    /* 0x3CDB2 −1 */
  if (모드3) return { x: 결과.x, y: 결과.y, d: 결과.d, cost: di + 0x5A - (Math.abs(ox - (target.x | 0)) + Math.abs(oy - (target.y | 0))) };   /* 0x3DAD4 */
  var 방 = (결과.d + 2) & 3;                                                  /* 0x3CDBE */
  var 점 = di + (0x5A - (Math.abs(ox - (target.x | 0)) + Math.abs(oy - (target.y | 0))));   /* 0x3CDF0~0x3CDFC */
  if (od === 방) 점 += 4;                                                    /* 0x3D3B8 */
  return { x: 결과.x, y: 결과.y, dir: 방, 값: di, 점수: 점 };
}

/**
 * ★ 0x3CA3C 무기 6~9 · 0xD · 0xE 갈래 — 큰 몸집 몬스터 설 자리 (2026-09-29 어셈블리 한 줄씩 · 0x3CE03~0x3CF81)
 *   d 마다: 시작 = 대상 + d 방향 (0xD 는 d0 → y+1 · d1 → x−1 먼저) · d0 → x−1 · d3 → y+1
 *   0x1A452(시작, d, 폭 2, 길이 = 무기 8·0xD 면 3 아니면 2) 칸을 모아 «뒤에서부터» 본다
 *   점수 = 0x3C9AC(그 칸에 서서 (d+2)&3 을 볼 때 공격 시작칸부터 폭 2·같은 길이 줄의 적대 칸 수) — 엄격히 클 때만 · 0x165C2 로 설 수 있어야
 *   마무리: 방향 (d+2)&3 · 무기 6·7·8·9·0xD 면 점수×4 + 그 칸 이동값(0x3D39D) · +4 이미 그 방향
 */
function 큰자리(battle, u, target, Rg, wt) {
  var Cb = C(), W = battle.W | 0, H = battle.H | 0;
  var 배 = {};
  (Rg.cells || []).forEach(function (c) { 배[c.x + ',' + c.y] = c.left | 0; });
  battle.units.forEach(function (t) {
    if (!t.alive || t === u || !hostile(battle, u, t)) return;
    (battle.cellsOf ? battle.cellsOf(t, t.x, t.y, t.dir) : [[t.x, t.y]]).forEach(function (c) { 배[c[0] + ',' + c[1]] = -((t.side | 0) + 1); });
  });
  var ox = u.x | 0, oy = u.y | 0, od = u.dir | 0;
  배[ox + ',' + oy] = (Rg.budget | 0) + 1;                                     /* 0x3CA8B */
  function 값(x, y) { if (x < 0 || y < 0 || x >= W || y >= H) return -128; var v = 배[x + ',' + y]; return (v == null) ? -1 : v; }
  function 설수(x, y, dir) {                                                  /* 0x165C2 — 발자국: 오른쪽(x+)·위(y−)로 */
    var f = battle.footOf ? battle.footOf(u, dir) : [1, 1], w = f[0] | 0, h = f[1] | 0;
    for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) {
      var cx = x + c, cy = y - r, t = battle.at ? battle.at(cx, cy) : null;
      if (t && t !== u) return false;
      if (값(cx, cy) < 0) return false;
    }
    return true;
  }
  function 줄적수(x, y, dir, 길) {                                            /* 0x3C9AC */
    u.x = x; u.y = y; u.dir = dir;
    var s = Cb.공격시작칸(battle, u), n = 0;
    Cb.원본직선(battle, s.x, s.y, dir, 2, 길).forEach(function (c) {
      var t = battle.at ? battle.at(c.x, c.y) : null;
      if (t && t.alive && t !== u && hostile(battle, u, t)) n++;
    });
    return n;
  }
  var 격자 = !!(battle && battle.unplace && battle.place), di = -1, 결과 = null;
  if (격자) battle.unplace(u);
  try {
    for (var d = 0; d < 4; d++) {
      var x = (target.x | 0) + DIR[d].dx, y = (target.y | 0) + DIR[d].dy;     /* 0x3CAF3 */
      if (wt === 0xD) { if (d === 0) y++; else if (d === 1) x--; }            /* 0x3CE03 */
      var 길 = (wt === 8 || wt === 0xD) ? 3 : 2;                               /* 0x3CE22 */
      if (d === 0) x--; else if (d === 3) y++;                                /* 0x3CE3E */
      var 칸들 = [];
      var DD = DIR[d], 옆 = [[1, 0], [0, 1], [-1, 0], [0, -1]][d];
      for (var i = 0; i < 길; i++) for (var k = 0; k < 2; k++)                /* 0x1A452 폭 2 */
        칸들.push({ x: x + DD.dx * i + 옆[0] * k, y: y + DD.dy * i + 옆[1] * k });
      var 방2 = (d + 2) & 3;
      for (var q = 칸들.length - 1; q >= 0; q--) {                            /* 0x3CEE2 뒤에서부터 */
        var c = 칸들[q];
        var 점 = 줄적수(c.x, c.y, 방2, 길);
        u.x = ox; u.y = oy; u.dir = od;
        if (점 <= di) continue;                                              /* 0x3CF2C jge */
        if (!설수(c.x, c.y, 방2)) continue;
        di = 점; 결과 = { x: c.x, y: c.y, d: d };
      }
    }
  } finally { u.x = ox; u.y = oy; u.dir = od; if (격자) battle.place(u, ox, oy, od); }
  if (!결과) return null;
  var 방 = (결과.d + 2) & 3, 점수 = di;
  if (wt === 6 || wt === 7 || wt === 8 || wt === 9 || wt === 0xD) 점수 = di * 4 + 값(결과.x, 결과.y);   /* 0x3D392 */
  if (od === 방) 점수 += 4;
  return { x: 결과.x, y: 결과.y, dir: 방, 값: 값(결과.x, 결과.y), 점수: 점수, 적수: di };
}

/**
 * ★ 0x3CA3C 무기 0xB · 0xC · 0xF · 0x10 · 0x11 · 0x12 · 0x13 갈래 (2026-09-29 어셈블리 한 줄씩 · 0x3CF86~0x3D372)
 *   마장기·배·비행선. 네 방향 d 마다 C = 대상 + d 방향.
 *   0xB/0xC(0x3CF86): 0x1A7BA(C, d, 사거리 9/7) — 대상 높이에서 한 단씩만 오르는 폭 2 줄 두 번, 앞 몇 칸 건너뛰고 한 열만 후보
 *   0xF(0x3CFFC): C 둘레 마름모 반경 4 중 C 에서 거리 ≥ 2 · 값 엄격히 최대 · 빈 칸
 *   0x10(0x3D091): 대상 둘레 마름모 반경 3 · 값 최대 · 빈 칸 · 방향 = 제 방향 · d 루프 한 번만
 *   0x11(0x3D12B): C + d + (d+1) 에서 d 방향 폭 3 · 길이 7
 *   0x12(0x3D1D4): C + 2d + (d+1) 에서 d 방향 폭 3 · 길이 3 · 방향 (d+1) 를 나~칸 위치로 다시 정함
 *   0x13(0x3D2E3): 홀수 d 만 · C 에서 d 방향 폭 1 · 길이 5
 *   마무리(0x3CDBB): 방향 = (고른 방향 + 2) & 3 · 점수 = 값(+4 이미 그 방향)
 */
function 기타자리(battle, u, target, Rg, wt) {
  var Cb = C(), W = battle.W | 0, H = battle.H | 0;
  var 배 = {};
  (Rg.cells || []).forEach(function (c) { 배[c.x + ',' + c.y] = c.left | 0; });
  battle.units.forEach(function (t) {
    if (!t.alive || t === u || !hostile(battle, u, t)) return;
    (battle.cellsOf ? battle.cellsOf(t, t.x, t.y, t.dir) : [[t.x, t.y]]).forEach(function (c) { 배[c[0] + ',' + c[1]] = -((t.side | 0) + 1); });
  });
  var ox = u.x | 0, oy = u.y | 0, od = u.dir | 0;
  배[ox + ',' + oy] = (Rg.budget | 0) + 1;                                     /* 0x3CA8B */
  function 값(x, y) { if (x < 0 || y < 0 || x >= W || y >= H) return -128; var v = 배[x + ',' + y]; return (v == null) ? -1 : v; }
  function 빈(x, y) { var t = battle.at ? battle.at(x, y) : null; return !t; }  /* 0x11DB2 == 0 */
  function 설수(x, y, dir) {                                                  /* 0x165C2 */
    var f = battle.footOf ? battle.footOf(u, dir) : [1, 1];
    for (var r = 0; r < (f[1] | 0); r++) for (var c = 0; c < (f[0] | 0); c++) {
      var t = battle.at ? battle.at(x + c, y - r) : null;
      if (t && t !== u) return false;
      if (값(x + c, y - r) < 0) return false;
    }
    return true;
  }
  function 지형(x, y) {
    var idx = y * W + x, v = 0;
    if (idx >= 0 && idx < W * H) { var tl = battle.tile(idx % W, (idx / W) | 0); v = tl ? (tl['값'] & 0xFF) : 0; }
    return (v > 0x64) ? ((v - 0x64) & 0xFF) : v;
  }
  function 줄(x, y, d, 폭, 길) {                                              /* 0x1A452 — 맵 밖도 그대로 */
    var DD = DIR[d & 3], 옆 = [[1, 0], [0, 1], [-1, 0], [0, -1]][d & 3], out = [];
    for (var i = 0; i < 길; i++) for (var k = 0; k < 폭; k++) out.push({ x: x + DD.dx * i + 옆[0] * k, y: y + DD.dy * i + 옆[1] * k });
    return out;
  }
  function 마름모(cx, cy, r) {                                                /* 0x1AC08 차례 · 맵 밖 포함 */
    var out = [];
    for (var dy = -r; dy <= r; dy++) { var w = r - Math.abs(dy); for (var dx = -w; dx <= w; dx++) out.push({ x: cx + dx, y: cy + dy, 거리: Math.abs(dx) + Math.abs(dy) }); }
    return out;
  }
  var 최 = -1, 최x = 0, 최y = 0;                                              /* [0xF0B86/84/82] */
  /** 0x1A7BA(x, y, d, 사거리) — 모드 2 */
  function 대포(x, y, d, 사거리) {
    var 뒤 = DIR[(d + 2) & 3], t0 = 지형(x + 뒤.dx, y + 뒤.dy), Hh = (t0 - (t0 & 0xF)) & 0xFF, H16 = (Hh + 0x10) & 0xFF;
    var lx = x, ly = y, col = 0, row = 0, c;
    if (d === 0) { lx = x - 1; ly = y - 1; col = x - 1; c = 6; }              /* 0x1A838 */
    else if (d === 1) { lx = x + 1; row = y + 1; c = 6; }                      /* 0x1A857 */
    else if (d === 2) { ly = y + 1; col = x - 1; c = 4; }                      /* 0x1A871 */
    else { lx = x - 1; ly = y + 1; row = y + 1; c = 4; }                       /* 0x1A88B */
    for (var k = 0; k < 2; k++) {                                            /* 0x1AAB4 두 번 */
      var 칸들 = 줄(lx, ly, d, 2, 사거리 + (c >> 1)), 높 = Hh, 한 = H16, n = 0;
      for (var q = 0; q < 칸들.length; q++) {
        var p = 칸들[q], t = 지형(p.x, p.y);
        if (t === 0) break;                                                  /* 0x1A9A8 */
        if (t === ((높 + 8) & 0xFF)) break;                                  /* 0x1A9BD */
        if (t < 높 && H16 !== 한) break;                                     /* 0x1A9C3~0x1A9D1 */
        if (t > 한) { 높 = 한; 한 = (한 + 0x10) & 0xFF; }                      /* 0x1A9DB */
        n++;
        if (n <= c) continue;                                                /* 0x1A9F1 */
        if ((d & 1) === 0 ? (p.x !== col) : (p.y !== row)) continue;         /* 0x1A8FA · 0x1AA05 */
        var v = 값(p.x, p.y);
        if (v <= 최) continue;                                               /* 0x1A932 */
        if (!설수(p.x, p.y, d)) continue;                                    /* 0x1A94F */
        최 = v; 최x = p.x; 최y = p.y;
      }
      if (d === 0) { lx = lx + 1; col = lx; }                                /* 0x1AA80 */
      else if (d === 1) { ly = ly - 1; row = ly + 1; }                       /* 0x1AA8B */
      else if (d === 2) { col = lx; lx = lx + 1; }                           /* 0x1AA93 */
      else { ly = ly - 1; row = ly; }                                        /* 0x1AAA2 */
    }
  }
  var 격자 = !!(battle && battle.unplace && battle.place), di = -1, 결과 = null;
  if (격자) battle.unplace(u);
  try {
    for (var d = 0; d < 4; d++) {
      var cx = (target.x | 0) + DIR[d].dx, cy = (target.y | 0) + DIR[d].dy;
      if (wt === 0xB || wt === 0xC) {                                        /* 0x3CF86 */
        if (d === 0) 최 = -1;                                                /* 0x1B7D4 */
        대포(cx, cy, d, wt === 0xB ? 9 : 7);
        if (최 > di) { di = 최; 결과 = { x: 최x, y: 최y, d: d }; }
      } else if (wt === 0xF) {                                               /* 0x3CFFC */
        마름모(cx, cy, 4).forEach(function (p) {
          if (4 - p.거리 >= 3) return;                                        /* 0x3D035 cmp bx,3 / jge */
          var v = 값(p.x, p.y);
          if (v <= di || !빈(p.x, p.y)) return;
          di = v; 결과 = { x: p.x, y: p.y, d: d };
        });
      } else if (wt === 0x10) {                                              /* 0x3D091 */
        마름모(target.x | 0, target.y | 0, 3).forEach(function (p) {
          var v = 값(p.x, p.y);
          if (v <= di || !빈(p.x, p.y)) return;
          di = v; 결과 = { x: p.x, y: p.y, d: (od + 2) & 3 };
        });
        break;                                                               /* 0x3D11F [esp+0x3C] = 4 */
      } else if (wt === 0x11 || wt === 0x12) {                               /* 0x3D12B · 0x3D1D4 */
        var sx = cx + DIR[d].dx, sy = cy + DIR[d].dy;
        if (wt === 0x12) { sx += DIR[d].dx; sy += DIR[d].dy; }
        sx += DIR[(d + 1) & 3].dx; sy += DIR[(d + 1) & 3].dy;
        줄(sx, sy, d, 3, wt === 0x11 ? 7 : 3).forEach(function (p) {
          var v = 값(p.x, p.y);
          if (v <= di || !빈(p.x, p.y)) return;
          di = v;
          if (wt === 0x11) { 결과 = { x: p.x, y: p.y, d: d }; return; }
          var dd = (d + 1) & 3;                                              /* 0x3D286~0x3D2D9 */
          if (!(dd & 1)) dd = (oy < p.y) ? 2 : 0; else dd = (ox < p.x) ? 1 : 3;
          결과 = { x: p.x, y: p.y, d: dd };
        });
      } else if (wt === 0x13) {                                              /* 0x3D2E3 */
        if (!(d & 1)) continue;
        줄(cx, cy, d, 1, 5).forEach(function (p) {
          var v = 값(p.x, p.y);
          if (v <= di || !빈(p.x, p.y)) return;
          di = v; 결과 = { x: p.x, y: p.y, d: d };
        });
      }
    }
  } finally { if (격자) battle.place(u, ox, oy, od); }
  if (!결과) return null;
  var 방 = (결과.d + 2) & 3, 점수 = di;
  if (od === 방) 점수 += 4;
  return { x: 결과.x, y: 결과.y, dir: 방, 값: 값(결과.x, 결과.y), 점수: 점수 };
}

/**
 * ★ 0x3D7B2 무기 5 이상 갈래 — 먼 적 접근 칸 (2026-09-29 어셈블리 한 줄씩 · 0x3D9D7~0x3DF3B)
 *   설 자리(0x3CA3C)와 같은 모양을 훑되 기준은 «나에게서 맨해튼 거리가 엄격히 작은 칸»(처음 0x7FFF).
 *   5 활: 0x1C685 모드 3 (활자리 모드 3) · 비용 += 0x5A − 나~적 거리
 *   6~9·0xD·0xE: 폭 2 줄(길이 8·0xD → 3 · 그 밖 2) · 칸 차례대로 · 0x16699(칸, d)
 *   0xB·0xC: 0x1A7BA 모드 3(거리 < 최고 · 0x16699) · 0xF: C 둘레 반경 4 · C 에서 거리 ≥ 2 · 빈 칸
 *   0x10: 적 둘레 반경 3 · 빈 칸 · 한 번만 · 0x11/0x12/0x13: 설 자리와 같은 줄 · 빈 칸
 * @returns {{x,y,cost}|null}
 */
function 원거리접근칸(battle, u, foe) {
  var wt = wtOf(battle, u), Mv = M();
  var ox = u.x | 0, oy = u.y | 0, W = battle.W | 0, H = battle.H | 0;
  if (wt === 5) {
    var Rg5 = Mv.range(battle, u, { tp: u.tp | 0 });
    var b5 = 활자리(battle, u, foe, Rg5, 3);
    return b5 ? { x: b5.x, y: b5.y, cost: b5.cost } : null;
  }
  function 거(x, y) { return Math.abs(x - ox) + Math.abs(y - oy); }
  function 빈(x, y) { var t = battle.at ? battle.at(x, y) : null; return !t; }
  function 놓(x, y, d) { return !Mv.canPlace || Mv.canPlace(battle, u, x, y, d); }   /* 0x16699 */
  function 줄(x, y, d, 폭, 길) {
    var DD = DIR[d & 3], 옆 = [[1, 0], [0, 1], [-1, 0], [0, -1]][d & 3], out = [];
    for (var i = 0; i < 길; i++) for (var k = 0; k < 폭; k++) out.push({ x: x + DD.dx * i + 옆[0] * k, y: y + DD.dy * i + 옆[1] * k });
    return out;
  }
  function 마름모(cx, cy, r) {
    var out = [];
    for (var dy = -r; dy <= r; dy++) { var w = r - Math.abs(dy); for (var dx = -w; dx <= w; dx++) out.push({ x: cx + dx, y: cy + dy, 거리: Math.abs(dx) + Math.abs(dy) }); }
    return out;
  }
  function 지형(x, y) {
    var idx = y * W + x, v = 0;
    if (idx >= 0 && idx < W * H) { var tl = battle.tile(idx % W, (idx / W) | 0); v = tl ? (tl['값'] & 0xFF) : 0; }
    return (v > 0x64) ? ((v - 0x64) & 0xFF) : v;
  }
  var di = 0x7FFF, 결과 = null, 최 = 0x7FFF, 최x = 0, 최y = 0;
  function 대포3(x, y, d, 사거리) {                                           /* 0x1A7BA 모드 3 */
    var 뒤 = DIR[(d + 2) & 3], t0 = 지형(x + 뒤.dx, y + 뒤.dy), Hh = (t0 - (t0 & 0xF)) & 0xFF, H16 = (Hh + 0x10) & 0xFF;
    var lx = x, ly = y, col = 0, row = 0, c;
    if (d === 0) { lx = x - 1; ly = y - 1; col = x - 1; c = 6; }
    else if (d === 1) { lx = x + 1; row = y + 1; c = 6; }
    else if (d === 2) { ly = y + 1; col = x - 1; c = 4; }
    else { lx = x - 1; ly = y + 1; row = y + 1; c = 4; }
    for (var k = 0; k < 2; k++) {
      var 칸들 = 줄(lx, ly, d, 2, 사거리 + (c >> 1)), 높 = Hh, 한 = H16, n = 0;
      for (var q = 0; q < 칸들.length; q++) {
        var p = 칸들[q], t = 지형(p.x, p.y);
        if (t === 0 || t === ((높 + 8) & 0xFF)) break;
        if (t < 높 && H16 !== 한) break;
        if (t > 한) { 높 = 한; 한 = (한 + 0x10) & 0xFF; }
        n++;
        if (n <= c) continue;
        if ((d & 1) === 0 ? (p.x !== col) : (p.y !== row)) continue;
        var s = 거(p.x, p.y);                                                 /* 0x1AA26 */
        if (s >= 최) continue;
        if (!놓(p.x, p.y, d)) continue;                                       /* 0x1AA55 */
        최 = s; 최x = p.x; 최y = p.y;
      }
      if (d === 0) { lx = lx + 1; col = lx; }
      else if (d === 1) { ly = ly - 1; row = ly + 1; }
      else if (d === 2) { col = lx; lx = lx + 1; }
      else { ly = ly - 1; row = ly; }
    }
  }
  var 격자 = !!(battle && battle.unplace && battle.place && battle.at && battle.at(ox, oy) === u), od = u.dir | 0;   /* 이미 뺀 채(0x3DF3B)면 다시 안 뺀다 */
  if (격자) battle.unplace(u);                                               /* 0x3D7D4 0x11EE4 */
  try {
    for (var d = 0; d < 4; d++) {
      var cx = (foe.x | 0) + DIR[d].dx, cy = (foe.y | 0) + DIR[d].dy;         /* 0x3D83C */
      if ((wt >= 6 && wt <= 9) || wt === 0xD || wt === 0xE) {                /* 0x3DAFC · 0x3DB17 */
        var x = cx, y = cy;
        if (wt === 0xD) { if (d === 0) y++; else if (d === 1) x--; }
        var 길 = (wt === 8 || wt === 0xD) ? 3 : 2;
        if (d === 0) x--; else if (d === 3) y++;
        줄(x, y, d, 2, 길).forEach(function (p) {
          var s = 거(p.x, p.y);
          if (s >= di || !놓(p.x, p.y, d)) return;                            /* 0x3DB9A · 0x3DBB6 */
          di = s; 결과 = { x: p.x, y: p.y };
        });
      } else if (wt === 0xB || wt === 0xC) {                                 /* 0x3DBDA */
        if (d === 0) 최 = 0x7FFF;
        대포3(cx, cy, d, wt === 0xB ? 9 : 7);
        if (최 < di) { di = 최; 결과 = { x: 최x, y: 최y }; }                    /* 0x3DC33 */
      } else if (wt === 0xF) {                                               /* 0x3DC49 */
        마름모(cx, cy, 4).forEach(function (p) {
          if (4 - p.거리 >= 3) return;                                        /* 0x3DC82 */
          var s = 거(p.x, p.y);
          if (s >= di || !빈(p.x, p.y)) return;
          di = s; 결과 = { x: p.x, y: p.y };
        });
      } else if (wt === 0x10) {                                              /* 0x3DCD8 */
        마름모(foe.x | 0, foe.y | 0, 3).forEach(function (p) {
          var s = 거(p.x, p.y);
          if (s >= di || !빈(p.x, p.y)) return;
          di = s; 결과 = { x: p.x, y: p.y };
        });
        break;                                                               /* 0x3DD4C */
      } else if (wt === 0x11 || wt === 0x12) {                               /* 0x3DD58 · 0x3DDFC */
        var sx = cx + DIR[d].dx, sy = cy + DIR[d].dy;
        if (wt === 0x12) { sx += DIR[d].dx; sy += DIR[d].dy; }
        sx += DIR[(d + 1) & 3].dx; sy += DIR[(d + 1) & 3].dy;
        줄(sx, sy, d, 3, wt === 0x11 ? 7 : 3).forEach(function (p) {
          var s = 거(p.x, p.y);
          if (s >= di || !빈(p.x, p.y)) return;
          di = s; 결과 = { x: p.x, y: p.y };
        });
      } else if (wt === 0x13) {                                              /* 0x3DEAF */
        if (!(d & 1)) continue;
        줄(cx, cy, d, 1, 5).forEach(function (p) {
          var s = 거(p.x, p.y);
          if (s >= di || !빈(p.x, p.y)) return;
          di = s; 결과 = { x: p.x, y: p.y };
        });
      }
    }
  } finally { if (격자) battle.place(u, ox, oy, od); }
  if (!결과) return null;                                                    /* 0x3DAC6 0x7FFF */
  return { x: 결과.x, y: 결과.y, cost: di };
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **0x43CF0 보스 전용 AI** (2026-09-29 · 사장님 「무신멸뢰옥 마무리되면 보스 ai 구현까지 진행해줘.」)
 *   턴 분기 0x4496F: 직업 0xA1(캐논)·0x5C(화룡)·0x5D(드래곤핸드)·0x5B(크라켄) → 여기. 움직이지 않는다.
 *   끝나면 0x4423C → 0x44A0C (루프도 0x3F415 턴 마무리 자세도 없다).
 *   돌려주는 것: { 종류: '끝' } · { 종류: '공격', 대상들, 외침, 연출 } · { 종류: '마법', 칸, 이름, 실패 }
 *   ☐ 0x43E3D 0x46E19 · 0x44039 0x56BD4(화염6 3클) · 0x440F3 0x57F18(빙한6 3클) · 0x441EB 0x22AF9 전용 연출은 아직 — 대사·공격 연출로 대신한다
 * ══════════════════════════════════════════════════════════════════════ */

/** 0x4496F — 보스 루프로 가나 */
function 보스인가(u) {
  var j = u.job | 0;
  return j === 0xA1 || j === 0x5B || j === 0x5C || j === 0x5D;
}

function 보스단계(battle, u, opts) {
  opts = opts || {};
  var Cb = C(), j = u.job | 0, ux = u.x | 0, uy = u.y | 0;
  function 적인가(t) { return t && t.alive && t !== u && hostile(battle, u, t); }
  function 칸유(x, y) { var t = battle.at ? battle.at(x, y) : null; return (t && t.alive) ? t : null; }
  function 줄칸(x, y, d, 폭, 길) {                                             /* 0x1A452 */
    var DD = DIR[d & 3], 옆 = [[1, 0], [0, 1], [-1, 0], [0, -1]][d & 3], out = [];
    for (var i = 0; i < 길; i++) for (var k = 0; k < 폭; k++) out.push({ x: x + DD.dx * i + 옆[0] * k, y: y + DD.dy * i + 옆[1] * k });
    return out;
  }
  function 모으기(칸들, 목) {                                                  /* 0x1A1F8 — 적대 · 중복 없이 */
    칸들.forEach(function (c) { var t = 칸유(c.x, c.y); if (적인가(t) && 목.indexOf(t) < 0) 목.push(t); });
    return 목;
  }
  function 마름모칸(r) {                                                      /* 0x1AC08 */
    var out = [];
    for (var dy = -r; dy <= r; dy++) { var w = r - Math.abs(dy); for (var dx = -w; dx <= w; dx++) out.push({ x: ux + dx, y: uy + dy }); }
    return out;
  }

  if (j === 0xA1) {                                                          /* 0x43CFA 캐논 */
    /* 0x43D0E 0x1A1DE(u, ecx=0) — 방향 0(남) 공격 시작 칸 · 거기서 남으로 9칸(첫 칸 건너뜀) · 칸마다 둘레 3×3 의 적 수 */
    var od = u.dir | 0; u.dir = 0;
    var s = Cb.공격시작칸 ? Cb.공격시작칸(battle, u) : { x: ux, y: uy + 1 };
    u.dir = od;
    var 줄 = 줄칸(s.x, s.y, 0, 1, 9).slice(1), 최 = 0, 고른 = null;
    줄.forEach(function (c) {
      var n = 0;
      줄칸(c.x - 1, c.y - 1, 0, 3, 3).forEach(function (q) { if (적인가(칸유(q.x, q.y))) n++; });   /* 0x43D6B · 0x43DA3 */
      if (n > 최) { 최 = n; 고른 = c; }                                        /* 0x43DB0 jle */
    });
    if (!고른) return { 종류: '끝', 까닭: '3×3 에 적 없음 (0x43DD5)' };
    var 대상 = 모으기(줄칸(고른.x - 1, 고른.y - 1, 0, 3, 3), []);            /* 0x43DF4 */
    return { 종류: '공격', 대상들: 대상, 외침: null, 연출: '0x46E19', 칸: 고른, 까닭: '캐논 3×3 (0x43E5A 0x1DDF0)' };
  }
  if (j === 0x5C) {                                                          /* 0x43E86 화룡 */
    var 목 = 모으기([{ x: ux, y: uy + 1 }], []);                              /* 0x43EB5 0x49ABC(0) · 0x43ECE */
    모으기(줄칸(ux - 1, uy + 2, 0, 3, 6), 목);                                  /* 0x43EE0 · 0x43EF6 폭 3 · 길이 6 */
    if (목.length) return { 종류: '공격', 대상들: 목, 외침: null, 연출: null, 까닭: '화룡 숨결 (0x43F37)' };
    return { 종류: '마법', 칸: 6, 등급: 1, 이름: 'Meteor', 까닭: '화룡 — 칠 적 없으면 Meteor (0x43F7B [0xF13C8])' };
  }
  if (j === 0x5D) {                                                          /* 0x43F8D 드래곤핸드 */
    var 목5 = 모으기(마름모칸(7), []);
    if (!목5.length) return { 종류: '끝', 까닭: '반경 7 적 없음 (0x43FE3)' };
    return { 종류: '공격', 대상들: 목5, 외침: 'Magma Fire!', 연출: '0x56BD4', 까닭: '드래곤핸드 (0x44010)' };
  }
  /* 0x44056 — 그림 번호로 (크라켄 부위) */
  var sp = u.sprIndex | 0;
  if (sp === 0x184) {
    if (랜(opts, 3) !== 0) return { 종류: '끝', 까닭: '1/3 (0x4406A)' };
    var 목84 = 모으기(마름모칸(7), []);
    if (목84.length) return { 종류: '공격', 대상들: 목84, 외침: 'Sea Blizzard', 연출: '0x57F18', 모션: 6, 까닭: '크라켄 (0x440DC)' };
    return { 종류: '마법', 칸: 13, 등급: 1, 이름: 'Star Tearer', 까닭: '크라켄 — 적 없으면 Star Tearer (0x4412A [0xF13E4])' };
  }
  if (sp > 0x184 && sp <= 0x187) {
    if (랜(opts, 3) !== 0) return { 종류: '끝', 까닭: '1/3 (0x4414B)' };
    return { 종류: '마법', 칸: 10, 등급: 2, 이름: 'Frozen Wall', 모션: [5, 6, 7],
             실패: { 외침: 'Sea Mist', 상태: 2, 확률: 0x1E },
             까닭: '크라켄 부위 — Frozen Wall · 못 쏘면 Sea Mist (0x441B0 [0xF13D8])' };
  }
  return { 종류: '끝', 까닭: '그 밖 그림 (0x44135)' };
}

/** 보스 마법 — 함수표 칸 k 를 AI 대상 고르기(0x28422(1))로.
 *  ★ 등급은 고정이다 — 함수표 함수는 dx 를 등급으로 받고(0x2B823 movsx edx,dx), 호출 앞 0x28883(이름 심기 · mov [0xF13AC],eax ; ret)
 *    에 넘긴 edx 가 그대로 남는다: Meteor 1(0x43F6F) · Star Tearer 1(0x4411E) · Frozen Wall 2(0x441A4). 이름표 색인 19·40·32 와 맞는다.
 *    ☠ 2026-09-29 처음엔 시전자 계열랭크로 짐작했다 — 틀렸다 */
function 보스마법(battle, u, 칸, 등급) {
  var sp = 칸 * 3 + (등급 | 0);
  var 대상 = 마법AI대상(battle, u, sp);
  return 대상 ? { spell: sp, 대상: 대상 } : null;
}

/** 0x441EB~0x44236 「Sea Mist」 — 편 1 목록([0xCC968]) 차례로 0x28947(clamp(30 + 레벨차, 10, 70)%) · 그림 < 300 이면 빙결(상태 2 · 지속 100) */
function 보스안개(battle, u, opts) {
  var Cb = C(), 걸린 = [];
  battle.units.filter(function (t) { return t.alive && (t.side | 0) === 1; }).forEach(function (t) {
    var 확 = 0x1E + (u.level | 0) - (t.level | 0);                                 /* 0x2894A [+0x2B] 레벨 */
    if (확 < 10) 확 = 10; else if (확 > 0x46) 확 = 0x46;
    if (!(랜(opts, 100) < 확)) return;                                            /* 0x28973 */
    if (특수본체(t)) return;                                        /* 0x4420D */
    var v = Cb.view(battle, t);
    v.f1e = ((v.f1e | 0) & 0xF8) | 2;                                             /* 0x44215~0x4422B */
    v.st.d1e[0] = 100;                                                            /* 0x44220 [+0x1F] = 100 */
    Cb.commit(battle, t, v);
    걸린.push(t);
  });
  return 걸린;
}

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **0x4426D God(직업 0xA4) 전용 AI** (2026-09-29 · 사장님 「무신멸뢰옥 마무리되면 보스 ai 구현까지 진행해줘.」)
 *   턴 분기 0x4498F. 움직이지 않고 한 번 하고 0x4490E → 0x40885.
 *   그림 0x19E(414 · DKARLS 칼스)만 소환을 본다: 편 3 목록([0xCC978])에서 [+0x12](소환자 표식)≠0 인 유닛이 2 미만이면
 *     (x−1,y)·(x−2,y) 가 비면 x−2 · 아니면 (x+3,y)·(x+4,y) 가 비면 x+3 (0x11DB2 = 유닛 칸 검사) → rand(3)==0 일 때만 소환.
 *     ★ rand(3) 은 소환 칸이 없어도 굴린다(0x44324 → 0x4432B). 소환 칸 x ≤ 0 이면 소환 안 함(0x44347 jle).
 *   소환 못 하면(또는 그 밖 그림) 0x44530 — 그림 0x195~0x19E 마다 전용 연출(점프표 0x44245) 뒤
 *     편 1·2 목록 전원에게 0x1D770(신, 대상, 치명, 지원 1) 피해 → 숫자 고리 0x287AF → 죽으면 0x1DB1D · 살면 0x53797.
 *   돌려주는 것: { 종류: '소환', x, y } · { 종류: '전체', 형, 연출, 치명, 소리 }
 * ══════════════════════════════════════════════════════════════════════ */

/** 0x4498F — God 인가 */
function 신인가(u) { return (u.job | 0) === 0xA4; }

/* 점프표 0x44245 — 그림 − 0x195. 연출은 같은 그리기 루틴을 쓰는 마법 번호로 빌린다 (magicfx SPEC 주소로 맞춤)
 *   소리는 0x4F460 이 슬롯 50·51·52 에 싣는 파일 (0x77C23~0x77CDC) */
var 신형표 = [
  { 주소: '0x2799A', spell: 145, 소리: ['f-meteo2.ssp'], 중심: [0x11, 0x13] },                          /* 0x44593 아토믹 블라스트 (0x11, 0x13) */
  { 주소: '0x26E1F', spell: 143, 소리: ['b-hole.ssp', 'bolt3.ssp'], 카메라: [1, 3], 중심: [0x11, 0x13] },   /* 0x445B6 블랙홀 (0x11, 0x13, 2) · 0x445CA 카메라 (x+1, y+3) */
  { 주소: '0x25DFE', spell: 77, 소리: ['heal.ssp', 'cure.ssp'] },                    /* 0x44606 회복5 (신, 2) */
  { 주소: '0x570A1', spell: 20, 소리: ['promi-1.ssp', 'promi-2.ssp'], 중심: [0x11, 0x13] },              /* 0x44635 프로미넌스 (0x11, 0x13) */
  { 주소: '0x592B0', spell: 62, 소리: ['thunder3.ssp', 'bolt1.ssp', 'thunder1.ssp'], 중심: [0x11, 0x13] },   /* 0x44667 기가썬더 (0x11, 0x13, 편) */
  { 주소: '0x2C863', spell: null, 흔들기: true, 소리: [] },                          /* 0x446AE 화면 흔들기만 */
  { 주소: '0x5A566', spell: 83, 소리: ['sun1.ssp', 'sun2.ssp', 'sun.ssp'] },         /* 0x446B8 선라이트 (신) */
  { 주소: '0x27C5A', spell: 146, 소리: ['atomic.ssp', 'darkzone.ssp'], 중심: [0x11, 0x13] },             /* 0x446F1 아마게돈 (0x11, 0x13) */
  { 주소: '0x57F18', spell: 38, 소리: ['f-blast.ssp', 'm-wind.ssp', 'boom.ssp'] }    /* 0x44719 블리자드 3클 (신) */
];

function 신단계(battle, u, opts) {
  opts = opts || {};
  var sp = u.sprIndex | 0, x = u.x | 0, y = u.y | 0;
  function 빈(cx, cy) { var t = battle.at ? battle.at(cx, cy) : null; return !(t && t.alive); }   /* 0x11DB2 */
  if (sp === 0x19E) {                                                        /* 0x44278 */
    var n = 0;
    battle.units.forEach(function (t) {                                     /* 0x44284 [0xCC978] 편 3 목록 */
      if (t && t.alive && (t.side | 0) === 3 && (t.summonerTag | 0) !== 0) n++;   /* 0x4428F [+0x12] */
    });
    var 칸x = -1;
    if (n < 2) {                                                             /* 0x4429B */
      if (빈(x - 1, y) && 빈(x - 2, y)) 칸x = x - 2;                          /* 0x442A5~0x442CF */
      else if (빈(x + 3, y) && 빈(x + 4, y)) 칸x = x + 3;                     /* 0x442E8~0x44318 */
    }
    if (랜(opts, 3) !== 0) 칸x = -1;                                          /* 0x4432B rand(3) · 0x4433A */
    if (칸x > 0) return { 종류: '소환', x: 칸x, y: y, 까닭: '칼스 소환 (0x4434D)' };   /* 0x44341 jle */
  }
  var k = sp - 0x195, 치명 = 0, 형 = null;
  if (k >= 0 && k <= 8) 형 = 신형표[k];
  else if (k === 9) {                                                        /* 0x44752 */
    if (랜(opts, 3) === 0) { 형 = { 주소: '0x592B0', spell: 62, 소리: ['thunder3.ssp', 'bolt1.ssp', 'thunder1.ssp'], 중심: [0x11, 0x12] }; 치명 = 1; }   /* 0x44761~0x447A3 [esp+0xC]=1 */
    else 형 = { 주소: '0x27C5A', spell: 146, 소리: ['atomic.ssp', 'darkzone.ssp'], 중심: [0x11, 0x12] };   /* 0x447AC~0x447D4 (0x11, 0x12) */
  }
  /* 그 밖 그림은 0x44580 ja 0x447D9 — 연출 없이 피해만 */
  return { 종류: '전체', 형: 형, 치명: 치명, 까닭: 'God 그림 ' + sp + ' (0x44530)' };
}

/** 0x402B0 — AI 워프 반경: u8[0x731B4 + 직업×15](액티브스킬 칸 8) 1 → 5 · 2 → 7 · 그 밖 0(워프 안 함) */
function AI워프반경(battle, u) {
  var j = battle.jobOf ? battle.jobOf(u) : null, 표 = j && j['액티브스킬'], v = 표 ? (표[8] | 0) : 0;
  return v === 1 ? 5 : (v === 2 ? 7 : 0);
}
/**
 * 0x3F0E4(u, 바깥, 안) — 걸어 닿는 범위에, 안 < d ≤ 바깥 인 링에서 걸어 못 닿던 칸을 값 예산+1−d 로 보탠 범위.
 *   값이 0 미만이면 닿지 않는 칸이다(0x165C2 의 0x13CBD ≥ 0). 0x13D02 의 경계(x 2 ~ W−3 · y 4 ~ H−5)를 지킨다.
 *   제 칸도 값 예산으로 든다(0x3F247 이 제 칸까지 본다).
 */
function 워프범위(battle, u, Rg, 바깥, 안) {
  var map = {}, cells = [];
  (Rg.cells || []).forEach(function (c) { cells.push(c); map[c.x + ',' + c.y] = c; });
  var 제k = (u.x | 0) + ',' + (u.y | 0);
  if (!map[제k]) { var 제 = { x: u.x | 0, y: u.y | 0, left: Rg.budget, cost: 0, tp: 0, stop: true, self: true }; map[제k] = 제; }
  C().diamond(battle, u.x | 0, u.y | 0, 바깥, true).forEach(function (c) {
    var d = Math.abs(c.x - (u.x | 0)) + Math.abs(c.y - (u.y | 0));
    if (d <= 안) return;                                                      /* 0x3F168 링 안쪽 */
    var k = c.x + ',' + c.y;
    if (map[k]) return;                                                       /* 0x3F13B 이미 닿는 칸 */
    if (c.x < 2 || c.y < 4 || c.x >= battle.W - 2 || c.y >= battle.H - 4) return;   /* 0x13D0B~0x13D3A */
    var 값 = (Rg.budget | 0) + 1 - d;
    if (값 < 0) return;
    /* 0x169D7 — 지형 비용 ≤ 0 이거나 유닛이 선 칸은 −2 로 막혀 링이 안 칠한다(0x16A32~0x16A3D · 0x3F13B cmp −1) */
    var t = battle.at ? battle.at(c.x, c.y) : null;
    if (t && t !== u) return;
    if (battle.moveCost && battle.moveCost(c.x, c.y, M().moveTypeOf(battle, u)) <= 0) return;
    var 셀 = { x: c.x, y: c.y, left: 값, cost: 0, tp: 0x28, stop: true, warp: true };
    cells.push(셀); map[k] = 셀;
  });
  return { cells: cells, map: map, budget: Rg.budget, W: Rg.W, H: Rg.H };
}
/** 0x3F247 — 목표([+0x6F/+0x70] 좌표, 없으면 목표 유닛 자리)에 맨해튼 거리가 «엄격히» 가장 가까운 칸(걸음 + 링 2 < d ≤ 반경 · 마름모 차례) */
function 워프목적지(battle, u, Rg, 반경) {
  var 목 = AI목표읽기(u), gx, gy;
  if ((목.x | 0) !== 0xFF) { gx = 목.x | 0; gy = 목.y | 0; }                   /* 0x3F252 */
  else {
    var G = 목.유닛 || AI목표유닛찾기(battle, 목.유닛id, 목.유닛코드);                      /* 0x3F26C 0x3E21B */
    if (!G) return null;
    gx = G.x | 0; gy = G.y | 0;
  }
  var Rw = 워프범위(battle, u, Rg, 반경, 2), 최선 = null, 최 = 0x7FFF;
  C().diamond(battle, u.x | 0, u.y | 0, 반경, true).forEach(function (c) {
    if (!Rw.map[c.x + ',' + c.y]) return;                                     /* 0x3F2D7 0x13CBD < 0 */
    var d = Math.abs(c.x - gx) + Math.abs(c.y - gy);
    if (d >= 최) return;                                                      /* 0x3F2FD jae */
    최 = d; 최선 = { x: c.x, y: c.y };
  });
  return 최선;
}

/** 0x4082C 0x167C9 — 이동 뒤 다음 바퀴 기본비용 = 10 + 30 × 인접 적 */
function 이동뒤기본비용(battle, unit) { return danger(battle, unit); }

/** 0x3F415 — 턴 마무리로 살 자세를 미리 계산해 둡니다(실제 적용은 turn.endUnit). */
function endStance(battle, u) {
  var Ru = R(), Cb = C();
  if (!Ru || !Ru.endTurnStance) return null;
  var v = Cb.view(battle, u);
  var r = Ru.endTurnStance(v, u.tp | 0, battle.T, true);
  return { tp: r.tp, f13: r.f13, useItem: !!r.useItem };
}

/**
 * 계획을 실제로 굴립니다 — 이동 → 행동 → 턴 마무리.
 *
 * ★★★★★ **이것은 SCE 이벤트를 돌리지 않는 「맨 실행」이다** (2026-08-22 · GPT 28차)
 *
 *   실제 게임은 **언제나** `Controller.prototype.runAi()` 를 지난다.
 *   그쪽은 통상 공격을 `_통상공격S3()` 로 보내 원본 경계를 전부 밟는다:
 *
 *     `0x1DE15` S3  ·  `0x1DE3E` 시전자 생존  ·  `0x1ED45` 대상 후처리
 *     (`0x1ED7C` 생존 S4 / `0x1DB50` 사망 S4)  ·  `0x1EF9A` 반격
 *
 *   여기 `run()` 은 그 경계를 **하나도 안 밟는다.** 그래서 계약을 못박는다:
 *
 *   > ★ **`run()` 은 SCE 없는 단위시험·헤드리스 전용이다.**
 *   >   게임 경로(컨트롤러·셸·`전투.html`)에서 부르면 **안 된다.**
 *
 *   ★ 그 뜻으로 **`opts.SCE비활성` 을 명시**해야 한다. 없으면 경고를 남긴다
 *     (막지는 않는다 — 옛 시험이 그대로 돌아야 하므로).
 *
 *   GPT 28차: 「"시험·헤드리스 전용"이라고 적는 것만으로 의미 차이가 사라지지는
 *   않습니다. … 공개 실행 경로의 의미 차이는 이후 다시 문제가 될 가능성이 큽니다」
 *
 * @param {object} [opts] `{ rng, plan, SCE비활성 }`
 * @returns {{plan, moved, result, ended}}
 */
function run(battle, unit, opts) {
  opts = opts || {};
  if (!opts.SCE비활성 && root.console && root.console.warn) {
    root.console.warn('[G2AI.run] ★ SCE 이벤트를 돌리지 않는 맨 실행이다. ' +
      '게임 경로는 Controller.runAi() 를 써야 한다 (0x1DE15·0x1ED45 를 건너뛴다). ' +
      '단위시험이면 opts.SCE비활성 = true 를 명시하라.');
  }
  var Mv = M(), Cb = C();
  var plan = opts.plan || act(battle, unit, opts);
  var out = { plan: plan, moved: null, result: null, ended: null };

  if (plan.move) {
    if (plan.move.turnOnly) { unit.dir = plan.move.dir & 3; out.moved = { turnOnly: true }; }
    else if (plan.move.path) out.moved = Mv.apply(battle, unit, plan.move.path, { facing: plan.move.dir });
  }
  if (plan.kind === 'attack' && plan.target && plan.target.unit) {
    out.result = Cb.attack(battle, unit, plan.target.unit, { rng: opts.rng });
  } else if (plan.kind === 'special') {
    out.result = plan.ultimate
      ? Cb.special(battle, unit, 'ultimate', plan.target && plan.target.unit, { rng: opts.rng, ultimate: true, targets: plan.초대상들 || undefined, at: plan.초칸 || null, allowCharge: false })   /* [리마스터] AI 지정 초필살기 */
      : Cb.special(battle, unit, plan.slot,
                            plan.target && plan.target.unit, { rng: opts.rng, at: plan.혼칸 || null });   /* 혼 — 0x2E0F0 착지 칸 */
  } else if (plan.kind === 'magic') {
    out.result = Cb.cast(battle, unit, plan.spell,
                         plan.target && plan.target.unit, { rng: opts.rng });
  }
  if (root.G2Turn && root.G2Turn.endUnit) out.ended = root.G2Turn.endUnit(battle, unit, {});
  return out;
}

/* ══════════════════════════════════════════ 8. 내보내기 */

var G2AI = {
  VERSION: '1.0 (COMBATII.EXE 대조)',

  /* 사양서에 적힌 4개 */
  act: act,
  chooseTarget: chooseTarget,
  choosePosition: choosePosition,
  flee: flee,
  /* 원본 대조용 — 0x3DF3B·0x15523 (2026-09-29) */
  근접접근: 근접접근, 원본되짚기: 원본되짚기, AI경로: AI경로, 접근칸비용: 접근칸비용, 목표확산: 목표확산, 목표쪽목적지: 목표쪽목적지, 목적지로걷기: 목적지로걷기,

  /* ★ AI 목표를 읽는 **유일한 창구** (P6) — AI 바(`hud.js aiBar`)도 이것으로 읽는다.
   *   전에는 HUD 가 있지도 않은 `ai.target`·`ai.targetUnit` 을 봐서 **늘 「No Target.」** 이었다. */
  'AI목표읽기': AI목표읽기,
  'AI목표유닛찾기': AI목표유닛찾기,
  소환사AI길: 소환사AI길,   /* [리마스터] 정본 479 */

  /* 곁가지 */
  run: run,
  decideAction: decideAction,
  chooseSpecial: chooseSpecial, 필살시도: 필살시도,
  wtOf: wtOf, 마장기과녁: 마장기과녁, 보스인가: 보스인가, 보스단계: 보스단계, 보스마법: 보스마법, 보스안개: 보스안개, 마법시도: 마법시도, 마법고르기: 마법고르기, 마법AI대상: 마법AI대상, 신인가: 신인가, 신단계: 신단계, 마법계획: 마법계획, 원거리접근칸: 원거리접근칸, 활자리: 활자리, 큰자리: 큰자리, 기타자리: 기타자리, 원본부채꼴: 원본부채꼴, 원거리루프인가: 원거리루프인가, 원거리이동단계: 원거리이동단계, 원거리행동단계: 원거리행동단계, 자동방어: 자동방어, 도주단계: 도주단계, 도주판단: 도주판단, 도주걸음: 도주걸음, 물러설칸: 물러설칸, 무덤물러서기: 무덤물러서기, 창1물러서기: 창1물러서기, 창1다가가기: 창1다가가기, 행동단계: 행동단계, 이동단계: 이동단계, 이동뒤기본비용: 이동뒤기본비용, 무기2갈래: 무기2갈래, 무기2이동단계: 무기2이동단계, 원거리마법9번: 원거리마법9번,
  chooseSpell: chooseSpell,
  learnedSlots: learnedSlots,
  specialReach: specialReach, 혼착지: 혼착지,
  초필살조준: 초필살조준,
  approachCell: approachCell,
  fleeCell: fleeCell,
  safeApproach: safeApproach,
  positionScore: positionScore,
  effectiveDef: effectiveDef,
  approachCost: approachCost,
  affinityTo: affinityTo,
  attackReach: attackReach,
  moveSteps: moveSteps,
  danger: danger,
  endStance: endStance,
  bag: bag, draw: draw, chance: chance,
  FLEE_TABLE: FLEE_TABLE,
  faceDir: faceDir
};

root.G2AI = G2AI;
if (typeof module !== 'undefined' && module.exports) module.exports = { G2AI: G2AI };

})(typeof globalThis !== 'undefined' ? globalThis : window);
