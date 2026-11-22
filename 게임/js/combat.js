/* ============================================================================
 * 창세기전 2 — 전투 실행 (COMBATII.EXE 대조)
 *
 * `rules.js` 가 "식", 이 파일이 "흐름" 입니다. 계산은 되도록 `Rules.*` 를 그대로
 * 부르고, 사양서에 없어서 새로 옮긴 것만 여기에 원본 주소와 함께 적어 두었습니다.
 *
 *   0x1D6B1  크리티컬 셔플백            (Rules.critCheck / criticalBag)
 *   0x1DDF0  명중·회피·방패            (Rules.hitCheck)  ★ **dx != 1 경로**
 *            ↑ 같은 주소가 **dx == 1** 이면 **영역효과 시작**(S3 `0x1DE15`)이다.
 *              `0x1DDFA cmp dx,1 / jne 0x1DEA7` 가 갈림길 — `SCE_HP변경_창구.md` §3-k
 *   0x1D770  물리 피해                  (Rules.physicalDamage)
 *   0x1EBFE  무기 부가 상태이상         ← **이 파일에서 새로 옮겼습니다**
 *   0x1EF9A  반격                       (Rules.counterAttack + 실행)
 *   0x1ED45  사망 처리 → 0x1DB1D
 *   0x1DC0D  사망 사기 변동             (Rules.moraleOnDeath)
 *   0x17A20  경험치·레벨업·숙련         (Rules.expGain / applyExp / applyGrowth / levelUpMastery)
 *   0x1D124  통상 공격 사거리 모양      ← **이 파일에서 새로 옮겼습니다**
 *   0x18EF9  무속성 무기 18종           ← **이 파일에서 새로 옮겼습니다** (rules.js 의 TODO)
 *   0x18F52  무기 → 부가 속성           ← **이 파일에서 새로 옮겼습니다**
 *   0x2CA40  필살기 등급 추첨           (Rules.specialClassRoll)
 *   0x2CAF7  필살기 피해 = 물리(공격력×x) + a
 *   0x301BB  필살기 HP 소모 (최소 1HP · 직업 0x32 면제)
 *   0x3FFD4 · 0x432A0  TP 차징 (+0x57 · +0x81 · +0x7F)
 *   0x285E4 / 0x2ACCB  마법 피해·회복 (언데드 2배)
 *   0x3B9E1 · 0x3C09F · 0x3C12D · 0x3C30A · 0x3C4C1  스킬 5·11·12·13·15
 *
 * ── 단위 ────────────────────────────────────────────────────────────────
 *   HP·피해는 전부 **실제 HP × 100** 입니다. 상성은 ×10, 사기는 100 = 100 %.
 *
 * ── state.js 유닛 ↔ rules.js 유닛 ──────────────────────────────────────
 *   칸 이름이 다릅니다(state.js 는 `side`·`gear`·`ailment`·`stance`,
 *   rules.js 는 `faction`·`equip`·`f1e`·`f13`). `view()` 가 유닛마다 하나씩
 *   캐시(`u._cv`)를 만들어 매번 값만 갱신하고, 바뀐 값은 `commit()` 이 되씁니다.
 *   능력치는 **state.js 의 3층 합산(u.eff)** 을 씁니다 — `.SCE` 저장값이 이미
 *   장비까지 반영된 최종값이라서 Rules.derive 로 다시 계산하면 어긋납니다.
 *
 * ── 크리티컬 셔플백 ────────────────────────────────────────────────────
 *   원본은 유닛 레코드 [+0x2C]·[+0x2D] 에 행·순번을 들고 있습니다. 여기서는
 *   요구대로 `battle.critBags[유닛id] = {row, pos}` 에 두고 view 와 동기화합니다.
 *   20번 때리면 반드시 `무기 ITEM +0x31 + 3` 번 발동합니다(난수 굴림이 아닙니다).
 *
 * 쓰는 법 (고전 스크립트 · file:// 에서도 됩니다)
 *   <script src="rules.js"></script> <script src="state.js"></script>
 *   <script src="move.js"></script>  <script src="combat.js"></script>
 *                                            →  window.G2Combat
 * ==========================================================================*/
(function (root) {
'use strict';

function R() { return root.Rules; }
function spriteProfile(u) { var Ru = R(); if (!Ru || !Ru.spriteProfile) throw new Error('combat: Rules.spriteProfile이 필요하다'); return Ru.spriteProfile(u); }
var 표시포트 = null;
function 표시연결(포트) {
  표시포트 = 포트 || null;
  var 연결값 = 표시포트;
  return function () { if (표시포트 === 연결값) 표시포트 = null; };
}
function idiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/** ★★★★★ **워프 반경** — 원본 `0x3BFC6` (2026-09-23 · 사장님 「원본대로 해줘」)
 *
 *  ```asm
 *  0x3BFBC  dl = [esi+0x11]                  ; 직업
 *  0x3BFBF  eax = 직업*16 − 직업 = 직업×15
 *  0x3BFC6  cmp byte [eax+0x31b4], 1         ; ★ 0x731B4 = 0x731AC + 8
 *  0x3BFCD  jne → 7                          ;   1 이면 5, 아니면 7
 *  ```
 *  `0x731AC` 는 15바이트×직업 짜리 **액티브스킬 표**다 — `데이터기준선_캡처.js:157`.
 *  EXE 와 `tables.json 직업[].액티브스킬` 을 165개 전수로 견줘 **어긋남 0** 이다.
 *  칸 8 이 1 인 직업은 넷 — **Thief(10) · Archeaogist(13) · Killer(53) · Cleaner(54)**
 *  ⇒ 그 넷은 **5**, 나머지 161개는 **7**.
 *  ☠ 우리는 **스킬 레벨**로 갈랐다 — 원본에 그런 갈래는 없다. */
/** 원본 0x13D02 — 표시 배열에 쓰는 칸은 x 2 ~ W−3 · y 4 ~ H−5 뿐 (0x13D0B~0x13D3A · 2026-10-13 사장님 「워프 가장자리도 원본대로 고쳐줘」) */
function 워프경계안(battle, x, y) {
  var W = battle.W | 0, H = battle.H | 0;
  return (x | 0) >= 2 && (x | 0) <= W - 3 && (y | 0) >= 4 && (y | 0) <= H - 5;
}
function 워프반경(battle, u) {
  var row = battle && battle.jobOf ? battle.jobOf(u) : null;
  var 표 = row && row['액티브스킬'];
  return (표 && (표[8] | 0) === 1) ? 5 : 7;            // 0x3BFCF / 0x3BFD6
}

/** 방향 0 남 · 1 서 · 2 북 · 3 동 (0x49ABC). move.js 와 같은 표입니다. */
var DIR = [{ dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }, { dx: 1, dy: 0 }];

/** 맨해튼 거리 — 0x49ADF. */
function dist(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.y - b.y); }

/**
 * `0x1201D` — 적대 관계. **정본은 `rules.isHostile`** 이다.
 *
 *   ★★★ **근사 폴백을 지웠다** (2026-08-26 · 4-f · GPT 4차 검수 ⑤)
 *     전에는 `Ru ? Ru.isHostile(...) : (a !== b)` 였다. `Rules` 가 없으면
 *     **원본과 다른 근사식으로 조용히** 돌았다 — `a !== b` 는 `1↔2`(아군↔우군)까지
 *     적대로 본다.
 *     ★ `state.hostile` 은 이미 던지게 고쳤는데(4단계 ①), AI·controller·selector·
 *       session 이 쓰는 **이쪽이 남아 있었다** — 계약이 갈라져 있었다.
 *   ⇒ 없으면 **던진다.** 조용한 근사보다 드러난 실패가 낫다 (2-7 원칙).
 */
function hostile(a, b, confuse) {
  var Ru = R();
  if (!Ru || typeof Ru.isHostile !== 'function') {
    throw new Error('combat.hostile: Rules.isHostile 이 없다 — rules.js 를 먼저 실어야 한다');
  }
  return Ru.isHostile(a, b, confuse);
}

/* ══════════════════════════════════════════ 0. 유닛 보기(view) */

function jobRow(battle, u) { return battle.jobOf ? battle.jobOf(u) : null; }

/** 크리티컬 셔플백 상태 — 요구대로 battle.critBags 에 둡니다 (원본 [+0x2C][+0x2D]). */
function critBag(battle, u) {
  if (!battle.critBags) battle.critBags = {};
  var k = (u.id != null ? u.id : u.name);
  if (battle.critBags[k]) return battle.critBags[k];
  /* ★ 유닛이 들고 온 진행 상태로 시작한다 (원본 [+0x2C][+0x2D][+0x36][+0x37]).
   *   2026-08-22 까지 늘 0 으로 시작해 **저장된 셔플백 진행이 버려지고 있었다.** */
  var s = (u && u.critSeed) || null;
  return (battle.critBags[k] = { row:   s ? (s.row   | 0) : 0,
                                 pos:   s ? (s.pos   | 0) : 0,
                                 spRow: s ? (s.spRow | 0) : 0,
                                 spPos: s ? (s.spPos | 0) : 0, hits: 0 });
}

/**
 * state.js 유닛 → rules.js 가 기대하는 모양. 유닛마다 한 개를 캐시해 재사용합니다.
 * 되돌리기는 commit() 이 합니다.
 */
function view(battle, u) {
  if (R() && R().상태칸묶기) R().상태칸묶기(u);    /* f1e·ailment 한 칸 (rules 상태칸묶기) */
  var v = u._cv || (u._cv = {});
  var g = u.gear || {};
  var bag = critBag(battle, u);
  v.unit = u;
  v.job = u.job | 0; v.charCode = u.charCode | 0; v.level = u.level | 0;
  v.faction = u.side | 0; v.race = u.race | 0;
  v.mount = g.mount | 0; v.sprite = u.sprIndex | 0;              // [+0x61]
  v.spriteSizeClass = u.spriteSizeClass != null ? u.spriteSizeClass : (u.sizeClass != null ? u.sizeClass : null);
  v.spriteSemantics = u.spriteSemantics || null;
  v.equip = v.equip || {};
  v.equip.shield = g.shield | 0; v.equip.weapon = g.weapon | 0;
  v.equip.accessory = g.charm | 0; v.equip.sub1 = g.sub | 0; v.equip.sub2 = 0;
  v.base = u.base || {}; v.순수 = u.순수 || null; v.buff = u.buff || {};
  v.x = u.x | 0; v.y = u.y | 0; v.dir = u.dir | 0;               // [+0x63]
  v.f13 = u.stance | 0; v.f14 = u.f14 | 0; v.f15 = u.f15 | 0; v.f1e = u.ailment | 0;
  v.st = u.st || (u.st = { d15: [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF],
                           d1e: [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF] });
  v.hp = u.hp | 0; v.maxHp = u.maxHp | 0; v.mp = u.mp | 0; v.maxMp = u.maxMp | 0;
  v.wait = u.waitCount | 0;                                      // [+0x56]
  v.critRow = bag.row; v.critPos = bag.pos;                      // [+0x2C] [+0x2D]
  v.spRank = u.specialGrade | 0;                                 // [+0x35]
  v.spRow = bag.spRow; v.spPos = bag.spPos;                      // [+0x36] [+0x37]
  v.exp = u.exp | 0; v.wexp = u.wexp | 0; v.mexp = u.mexp | 0;
  v.spLv = u.skillExp || (u.skillExp = [0, 0, 0, 0, 0]);
  v.magicClass = u.magicLv || (u.magicLv = [0, 0, 0, 0, 0, 0, 0]);
  v.aiAttack = u.ai ? (u.ai.atkTend | 0) : 0;                    // [+0x6D]
  v.escort = !!u.escort;
  return v;
}

/** view 가 바꾼 값을 state.js 유닛으로 되씁니다. */
/**
 * ★★★ **`commit` 은 실행기에 넷 있고 계약이 전부 다르다** (2026-08-26 · 7단계)
 *
 *   | 어디 | 서명 | 층 |
 *   |---|---|---|
 *   | **여기 (`combat`)** | `(battle, u, v)` | ★ **유닛 상태 확정** — 뷰 `v` 를 유닛 레코드로 되쓴다 |
 *   | `executor.js:228` | `(battle, intent, opts)` | 명령 실행 창구 |
 *   | `move.js:414` | `(battle, unit, pl, opts)` | 이동 확정 |
 *   | `battle_main.js` | `()` | 연출 보고 위임 (`rep.commit()`) |
 *
 *   ★ 0-7 판정: **통합하지 않는다** — 층이 다르다.
 *     이름을 가르는 것도 **안 한다**(공개 API 변경 · P2). 서명이 뚜렷이 달라
 *     실수로 바꿔 부를 위험이 낮다. 대신 **여기 계약을 적어 둔다.**
 *   전문: `03_분석/_보관/옛계획/00_0단계_0-7_계약분류.md` §1
 *
 *   되쓰는 것: `stance`·`f14`·`f15`·`ailment`·`hp`·`mp`·`waitCount`·`sprIndex`
 */
function commit(battle, u, v) {
  v = v || u._cv; if (!v) return;
  u.stance = v.f13 | 0; u.f14 = v.f14 | 0; u.f15 = v.f15 | 0; u.ailment = v.f1e | 0;
  u.hp = v.hp | 0; u.mp = v.mp | 0; u.waitCount = v.wait | 0;
  u.sprIndex = v.sprite | 0;                       // DNA 체인지가 갈아끼운다 (0x2C547)
  u.level = v.level | 0; u.exp = v.exp | 0; u.wexp = v.wexp | 0; u.mexp = v.mexp | 0;
  u.maxHp = v.maxHp | 0; u.maxMp = v.maxMp | 0;
  var bag = critBag(battle, u);
  bag.row = v.critRow | 0; bag.pos = v.critPos | 0;
  bag.spRow = v.spRow | 0; bag.spPos = v.spPos | 0;
  /* ★★★ 유닛에도 되돌린다 — 원본은 유닛 레코드 [+0x2C][+0x2D][+0x36][+0x37] 하나뿐이다.
   *   `battle.critBags` 에만 두면 상태 브리지(`G2Bridge`)가 읽는 `u.critSeed` 와
   *   **갈라져** 진행 상태가 커밋되지 않는다 (계획 §A-1 (마) 「변경 즉시 갱신」). */
  if (!u.critSeed) u.critSeed = { row: 0, pos: 0, spRow: 0, spPos: 0 };
  u.critSeed.row = bag.row; u.critSeed.pos = bag.pos;
  u.critSeed.spRow = bag.spRow; u.critSeed.spPos = bag.spPos;
}

/** 능력치 — state.js 의 3층 합산(u.eff). rules.js 의 derive 자리에 그대로 넣습니다. */
function eff(battle, u) {
  var e = u.eff;
  if (!e && root.G2State && root.G2State.derive) e = root.G2State.derive(u);
  e = e || { atk: u.rawAtk | 0, def: u.rawDef | 0, mr: u.rawMr | 0, maxTp: u.rawMaxTp | 0 };
  return {
    atk: e.atk | 0, def: e.def | 0, mr: e.mr | 0, maxTp: e.maxTp | 0,
    str: e.str | 0, int: e.int | 0, agi: e.agi | 0, cha: e.cha | 0,
    weaponType: e.weaponType | 0
  };
}

/** 0x174CF — 무기 종류. */
function weaponTypeOf(battle, u) {
  var g = u.gear || {};
  if ((g.mount | 0) >= 1 && (g.mount | 0) <= 4 && u.job === 0x17) return 5;
  var j = jobRow(battle, u);
  return j ? (j['무기종류'] | 0) : 0;
}

/* ══════════════════════════════════════════ 1. 무기 속성 표 (새로 옮김) */

/**
 * 0x18EF9 — **무속성 무기 18종**. 서면 `0x1DA3F` 가 공격 속성을 −1 로 만들어
 * 상성 계산을 통째로 건너뜁니다. rules.js 는 이 목록을 못 뽑아 비워 두었고
 * (`NO_ATTR_WEAPONS = new Set()` + TODO) 여기서 원본 바이트로 채웠습니다.
 *   0x18EFB~0x18F47 의 `cmp al,n / je 0x18F49` 18개를 그대로 옮긴 것입니다.
 * ※ rules.js 를 건드리면 rules.test.html 의 "슬라임(검 상성 0) 0" 항목이
 *   깨집니다(그 항목이 쓰는 무기 25 가 바로 이 목록 안에 있습니다). 그래서
 *   rules.js 는 그대로 두고 이 파일이 `ctx.attr = −1` 로 넘깁니다.
 */
var NO_ATTR_WEAPONS = [0x04, 0x0C, 0x16, 0x19, 0x1A, 0x1B, 0x1C, 0x1D, 0x20,
                       0x22, 0x23, 0x24, 0x2C, 0x31, 0x37, 0x3C, 0x43, 0x46];
/* [리마스터 규칙 «리마스터 무기 속성»] 명검인데 원작 18종에서 빠진 셋도 상성 무시 — 듀렌달 33 · 부로바 47 · 게이볼그 59 (속성은 안 붙임 · 게이볼그는 원래 화염)
 *   (2026-11-16 사장님 「대부분 소위 말하는 명검에 붙는건데..」·「속성은 딱히 안넣어도 될 것 같은데 상성 무시는 넣어줘」 · 정본 240) · 규칙이 «원작»이면 원본 18종만 */
var 리마스터상성무시 = [33, 47, 59, 125];   /* 125 흑강검 — 11-16 사장님 「흑강검도 명검으로 넣어줘」(정본 242 · 덧 아이템 · 암흑 그대로) */
function isNoAttrWeapon(code) { var c = code | 0; if (NO_ATTR_WEAPONS.indexOf(c) >= 0) return true; return 리마스터상성무시.indexOf(c) >= 0 && 리마스터속성무기(); }

/**
 * 0x18F52 — 무기 → **부가 상태이상 속성**. 0(불) 1(얼음) 2(번개) 3(암흑) −1(없음).
 * 0x1EBFE 이 이 값을 먼저 보고, −1 이면 공격 속성(0x17531)으로 떨어집니다.
 */
var WEAPON_STATUS_ATTR = { 0x24: 0, 0x3B: 0, 0x2D: 0, 0x43: 0,
                           0x20: 1, 0x13: 1,
                           0x16: 2, 0x10: 2, 0x42: 2, 0x3C: 2, 0x30: 2,
                           0x1B: 3, 0x18: 3 };
function weaponStatusAttr(code) {
  var v = WEAPON_STATUS_ATTR[code | 0];
  return v === undefined ? -1 : v;
}

/** 0x17531 + 0x1DA3F — 이번 공격의 속성. 무속성 무기면 −1. */
function attackAttr(battle, u) {
  var Ru = R(), v = view(battle, u);
  var attr = Ru ? Ru.attackAttr(v, battle.T, battle.battleKind | 0) : -1;
  if (isNoAttrWeapon(v.equip.weapon)) attr = -1;          // 0x1DA3F
  return attr;
}

/* ══════════════════════════════════════════ 2. 사거리 (0x1D124) */

function inMap(battle, x, y) { return x >= 0 && y >= 0 && x < battle.W && y < battle.H; }

/** 마름모(맨해튼) 반경 — 0x1AC08 / 0x1AC59 순회와 같은 칸 집합입니다. */
function diamond(battle, cx, cy, r, includeSelf) {
  var out = [];
  for (var dy = -r; dy <= r; dy++) {
    var w = r - Math.abs(dy);
    for (var dx = -w; dx <= w; dx++) {
      if (!includeSelf && dx === 0 && dy === 0) continue;
      var x = cx + dx, y = cy + dy;
      if (inMap(battle, x, y)) out.push({ x: x, y: y });
    }
  }
  return out;
}

/* ══════════ 부채꼴 = 계단식 확산 `0x1AF22` + `0x1B00D` ═══════════════════
 *
 * 사양은 `03_분석/COMBATII/원거리_사거리_투사체.md` §2.
 *
 * 원거리 평타(무기 5)와 마법 타겟 지정이 **같은 프리미티브**를 씁니다.
 * `0x1B7FA` 가 첫 칸(시전자 자기 칸)을 **소비만 하고 안 칠하므로** 실제로
 * 칠해지는 것은 줄 1 부터입니다.
 *
 * ```asm
 * 0x1B132  W += 2                       ; 매 줄
 * 0x1B0D8  W -= 2                       ; ★ 마지막 줄만 (R − r == 1)
 * ```
 * 곧 폭 = `1, 3, 5, …, 2R−3` 이고 **마지막 줄만 `2R−5`**.
 *
 *   R=5 → `3 5 7 5`      R=6 → `3 5 7 9 7`      R=7 → `3 5 7 9 11 9`
 *
 * 방향 증분 (`0x1AF60 jmp [eax*4 + 0x1AF12]`)
 *   0 남 줄안 (+1,0) 넘김 (−1,+1) · 1 서 (0,+1)/(−1,−1)
 *   2 북 (−1,0)/(+1,−1)          · 3 동 (0,−1)/(+1,+1)
 *
 * ※ 지형 시야 그림자(`0x1B919` → `0x1B61E`/`0x1B1AE`/`0x1B43A` 가 막힌 칸 뒤를
 *   `−2` 로 지움)는 **아직 안 넣었습니다** — 할일 N-16.
 *
 * @param {number} R  사거리 = 줄 수
 * @param {boolean} 인접포함  줄 0(폭 1 짜리 바로 앞 칸)까지 칠할지.
 *   기본 false — 궁수 계열은 인접 칸을 못 칩니다(아래 주석).
 *   true 면 `1 3 5 3` 처럼 **정면 한 칸부터** 시작합니다 — [리마스터] 마법사 평타.
 */
function fanCells(battle, cx, cy, dir, R, 인접포함) {
  var STEP = [{ dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 }, { dx: 0, dy: -1 }];
  var NEXT = [{ dx: -1, dy: 1 }, { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: 1, dy: 1 }];
  var d = dir & 3, s = STEP[d], n = { dx: NEXT[d].dx, dy: NEXT[d].dy };

  /* ★★ **한 칸 앞에서 시작한다** — 바라보는 방향으로 1칸.
   *
   *   원본은 시전자 칸에서 시작해 폭 3 줄이 **거리 1**(바로 앞 칸)에 옵니다
   *   (`원거리_사거리_투사체.md` §2 「한 줄 어긋남」). 그런데 사용자 확인은
   *   「**바로 앞 칸은 공격 못 하고 두 번째 칸부터**」이고, 실제 화면에서도
   *   앞 칸이 칠해지는 것이 틀렸다고 지적됐습니다(2026-08-13).
   *
   *   그냥 첫 줄을 빼면 폭이 `5 7 5` 가 되어 수열이 어긋납니다. **통째로 한 칸
   *   밀어야** `3 5 7 5` 가 유지되면서 인접 칸이 빕니다.
   *
   *   전진 벡터 = 줄넘김 + 줄안 (`NEXT[d] + STEP[d]`) —
   *     0 남 (0,+1) · 1 서 (−1,0) · 2 북 (0,−1) · 3 동 (+1,0)
   *
   *   ★ 원작 화면과 원본 코드가 왜 다른지는 **아직 못 밝혔습니다**.
   *     ☐ 2026-08-29 — 의심하던 것 하나를 **지웠습니다.**
   *       `0x1F19C`(대상 커서) 안에는 **거리 하한 상수가 없습니다.**
   *       그 안에서 부르는 `0x1F179` 도 거리가 아니라 **종류 판정**입니다:
   *       ```asm
   *       0x1F17A  mov dl,[eax+0x11]
   *       0x1F17D  cmp dl,0x15 / 0x16 / 0x17 / 0x18  → 맞으면 eax=0
   *       0x1F195  아니면 eax=1
   *       ```
   *       곧 `[+0x11]` 이 **21~24** 인지만 봅니다.
   *     ☐ 링 메뉴 쪽도 초입을 봤지만 **거리 하한이 안 보입니다.**
   *       (`0x4BD28`~`0x4BD6F`: `[0x8DAF2]`가 1이면 `edx=0xD`로 `0x4BC2C`,
   *        아니면 `0x174CF` 로 넘어갑니다. 거리 비교가 없습니다.)
   *       다음에 볼 곳은 `0x174CF` 와 `0x4C026` 입니다. */
  var fwd = { dx: n.dx + s.dx, dy: n.dy + s.dy };
  var out = [], W = 1, x = (cx | 0) + fwd.dx, y = (cy | 0) + fwd.dy;

  for (var r = 0; r < (R | 0); r++) {
    /* r = 0 은 폭 1 짜리 「가상의 시작 칸」이라 안 칠한다 — 원본 `0x1B880` 과 같다.
     * 한 칸 밀었으므로 실제로 칠해지는 첫 줄(폭 3)이 **거리 2** 에 온다.
     * ★ `인접포함` 이면 줄 0 도 칠한다 — 한 칸 밀어 둔 덕에 그 자리가 **정면
     *   한 칸**이라, 폭이 `1 3 5 …` 로 시작하는 부채꼴이 된다. */
    for (var i = 0; i < W; i++) {
      if ((r > 0 || 인접포함) && inMap(battle, x, y)) out.push({ x: x, y: y });
      if (i < W - 1) { x += s.dx; y += s.dy; }
    }
    if (r === (R | 0) - 1) break;
    if (((R | 0) - r) === 1 + 1) {          /* 다음이 마지막 줄 — 0x1B0D8 */
      W -= 2;
      if (s.dx === 0) n.dy += 2 * s.dy; else n.dx += 2 * s.dx;
      x += n.dx; y += n.dy;
    } else {                                 /* 0x1B132 */
      W += 2;
      x += n.dx; y += n.dy;
      if (s.dx === 0) n.dy -= 2 * s.dy; else n.dx -= 2 * s.dx;
    }
  }
  return out;
}

/** 방향 dir 로 n 칸 직선 — 0x1A452. */
/**
 * 0x1A146 — 공격이 시작되는 칸. 앵커 (x,y) 와 **그 방향의** 발자국 (w,h)(0xD66A8 +방향×143 의 +0·+1)로
 * 발자국 앞면 첫 칸을 낸다. 점프표 0x1A136:
 *   0 남 0x1A195 `y+1` · 1 서 0x1A19A `x−1, y−(h−1)` · 2 북 0x1A1AD `x+(w−1), y−h` · 3 동 0x1A1C9 `x+w`
 * 1×1 유닛은 곧 정면 한 칸이다.
 */
function 공격시작칸(battle, u) {
  var d = u.dir & 3, f = battle.footOf ? battle.footOf(u, d) : [1, 1];
  var w = f[0] | 0, h = f[1] | 0, x = u.x | 0, y = u.y | 0;
  if (d === 0) y += 1;
  else if (d === 1) { x -= 1; y -= (h - 1); }
  else if (d === 2) { x += w - 1; y -= h; }
  else x += w;
  return { x: x, y: y };
}
/**
 * ★★★★★ 0x1B7FA — 활(무기 5) 부채꼴 + **지형 시야 그림자** (2026-10-07 · 어셈블리 한 줄씩)
 *   사장님 고르심 «적 AI 동선 차이» — 2-4A 넘김 2 뮐러(활·모드 6)가 원본은 «칠 적 없음»으로 그대로, 우리는 방향을 틀었다.
 *   원본 0x1D124 무기 5 갈래: 0x1B7BF(진영 · 적대 1 · 모으기 1) → 0x13F8A(이동배열 −1) → 0x1AEF3(사거리) → 이 함수.
 *   ☠ 예전에는 그림자 없는 부채꼴(fanCells)이라 막힌 칸 뒤의 적까지 «보였다».
 *   (사장님 10-05 「활공격 무한루프 … 사이에 낮은 오브젝트」 — AI 가 원본은 못 보는 적을 겨눈 것과 같은 뿌리)
 *
 *   ① 기준 = 시작 칸 «뒤» 한 칸(0x1B82B 0x49ABC((방향+2)&3))의 지형값(>100 이면 −100) 윗 니블 + 0x10
 *   ② 반복자 0x1AF22(시작 칸, 방향, 폭 1, 길이 R) · 첫 칸(시작)은 소비만 — 그 칸 지형이 0 이거나 기준보다 높으면 통째로 없음
 *   ③ 칸마다: 이동배열 −2(그림자)면 건너뜀(0x1B9F4) · 지형값 t (>100 이면 −100) · t > 기준 이고 하위 4비트 8 이면 t = 0 (0x1BA1A)
 *      t == 0 이면 막힘 → 0x1B919 그림자 · 아니면 보이는 칸(0x1BA43 칠하기 / 0x1B8B7 모으기)
 *   ④ 0x1B919: 남은 줄 = 줄수 − 줄번호 (+1 줄 안 순번이 0 이면) · 가운데 줄이면 0x1B61E · 아니면 줄 안 순번 ≤ 1 이면 0x1B1AE 그 밖 0x1B43A
 *   ⑤ 그림자 칸 표시(0x13D02)는 지도 가장자리(가로 2·세로 4 칸)를 안 쓴다 — 그래서 가장자리 칸은 뒤에서 안 건너뛴다
 *   검산: 04_도구 에뮬레이터로 원본 0x1B7FA 를 그대로 돌린 칸과 무작위 지형에서 한 칸도 안 틀린다 (bow_shadow_1B7FA.test.js)
 * @returns {Array<{x,y}>} 보이는 칸 (원본 차례)
 */
function 활시야칸(battle, sx, sy, dir, R) {
  var AIm = root.G2AI || (typeof require === 'function' ? (function () { try { var m = require('./ai.js'); return (m && m.G2AI) || m; } catch (e) { return null; } })() : null);
  if (!AIm || !AIm.원본부채꼴) return fanCells(battle, sx - DIR[dir & 3].dx, sy - DIR[dir & 3].dy, dir, R);
  var W = battle.W | 0, H = battle.H | 0, d = dir & 3;
  var 배 = new Int16Array(W * H); 배.fill(-1);                                      /* 0x13F8A */
  function 값(x, y) { return (x < 0 || y < 0 || x >= W || y >= H) ? -128 : 배[y * W + x]; }   /* 0x13CBD */
  function 표(x, y, v) {                                                          /* 0x13D02 — 가장자리 밖만 쓴다 */
    if (x - 2 < 0 || x - 2 >= W - 4 || y - 4 < 0 || y - 4 >= H - 8) return;
    배[y * W + x] = v;
  }
  function 지형(x, y) {                                                           /* 0x1093D · >100 이면 −100 */
    var t = battle.tile ? battle.tile(x, y) : null, v = t ? (t['값'] & 0xFF) : 0;
    return (v > 0x64) ? ((v - 0x64) & 0xFF) : v;
  }
  var 뒤 = DIR[(d + 2) & 3];
  var 기준 = ((지형(sx + 뒤.dx, sy + 뒤.dy) & 0xF0) + 0x10) & 0xFF;                /* 0x1B84B~0x1B852 · 0x1B895 */
  var it = AIm.원본부채꼴(sx, sy, d, 1, R);
  var c = it.next();                                                              /* 0x1B87B 시작 칸 */
  if (!c) return [];
  var t0 = 지형(c.x, c.y);
  if (t0 === 0 || t0 > 기준) return [];                                          /* 0x1B8A0 · 0x1B8A8 */

  function 줄그림자(X, Y, 칸, 옆) {                                               /* 0x1B1AE */
    표(X, Y, -2);
    var 수 = 2, k;
    if (d === 0) { var s = 옆 ? -1 : 1; Y++; for (k = 1; k < 칸; k++) { for (var j = 0; j < 수; j++) 표(X + j * s, Y, -2); Y++; if (k & 1) X += s; else 수++; } }
    else if (d === 1) { var t = 옆 ? -1 : 1; X--; for (k = 1; k < 칸; k++) { for (var j1 = 0; j1 < 수; j1++) 표(X, Y + j1 * t, -2); X--; if (k & 1) Y += t; else 수++; } }
    else if (d === 2) { var u = 옆 ? 1 : -1; Y--; for (k = 1; k < 칸; k++) { for (var j2 = 0; j2 < 수; j2++) 표(X + j2 * u, Y, -2); Y--; if (k & 1) X += u; else 수++; } }
    else { var v = 옆 ? 1 : -1; X++; for (k = 1; k < 칸; k++) { for (var j3 = 0; j3 < 수; j3++) 표(X, Y + j3 * v, -2); X++; if (k & 1) Y += v; else 수++; } }
  }
  function 곧은그림자(X, Y, 칸, 옆) {                                             /* 0x1B43A */
    var 수 = 1, k;
    if (d === 0) { var s = 옆 ? -1 : 1; for (k = 0; k < 칸; k++) { for (var j = 0; j < 수; j++) 표(X + j * s, Y, -2); Y++; if (k & 1) 수++; } }
    else if (d === 1) { var t = 옆 ? -1 : 1; for (k = 0; k < 칸; k++) { for (var j1 = 0; j1 < 수; j1++) 표(X, Y + j1 * t, -2); X--; if (k & 1) 수++; } }
    else if (d === 2) { var u = 옆 ? 1 : -1; for (k = 0; k < 칸; k++) { for (var j2 = 0; j2 < 수; j2++) 표(X + j2 * u, Y, -2); Y--; if (k & 1) 수++; } }
    else { var v = 옆 ? 1 : -1; for (k = 0; k < 칸; k++) { for (var j3 = 0; j3 < 수; j3++) 표(X, Y + j3 * v, -2); X++; if (k & 1) 수++; } }
  }
  function 가운데그림자(X, Y, 칸) {                                                /* 0x1B61E */
    var 수 = 1, k;
    if (d === 0) { for (k = 0; k < 칸; k++) { for (var j = 0; j < 수; j++) 표(X + j, Y, -2); Y++; if (k & 1) { X--; 수 += 2; } } }
    else if (d === 1) { for (k = 0; k < 칸; k++) { for (var j1 = 0; j1 < 수; j1++) 표(X, Y + j1, -2); X--; if (k & 1) { Y--; 수 += 2; } } }
    else if (d === 2) { for (k = 0; k < 칸; k++) { for (var j2 = 0; j2 < 수; j2++) 표(X + j2, Y, -2); Y--; if (k & 1) { X--; 수 += 2; } } }
    else { for (k = 0; k < 칸; k++) { for (var j3 = 0; j3 < 수; j3++) 표(X, Y + j3, -2); X++; if (k & 1) { Y--; 수 += 2; } } }
  }

  var out = [];
  for (;;) {
    c = it.next();                                                                /* 0x1B9D8 */
    if (!c) break;
    if (값(c.x, c.y) === -2) continue;                                            /* 0x1B9FA */
    var tv = 지형(c.x, c.y);
    if (tv > 기준 && (tv & 0xF) === 8) tv = 0;                                     /* 0x1BA1A~0x1BA2A */
    if (tv !== 0) { out.push({ x: c.x, y: c.y }); 표(c.x, c.y, 1); continue; }   /* 0x1BA43 */
    var 남 = (it.L - it.r) + (it.i === 0 ? 1 : 0);                                /* 0x1B919~0x1B934 */
    if (d === 0 || d === 2) {
      if (c.x === sx) 가운데그림자(c.x, c.y, 남);                                 /* 0x1B953 */
      else {
        var 옆 = (d === 0) ? (c.x < sx) : (c.x > sx);                             /* 0x1B97B setl · 0x1B983 setg */
        if (it.i <= 1) 줄그림자(c.x, c.y, 남, 옆); else 곧은그림자(c.x, c.y, 남, 옆);   /* 0x1B98A */
      }
    } else {
      if (c.y === sy) 가운데그림자(c.x, c.y, 남);                                 /* 0x1BA64 */
      else {
        var 옆2 = (d === 1) ? (sy > c.y) : (sy < c.y);                             /* 0x1BA76 setg · 0x1BA84 setl */
        if (it.i <= 1) 줄그림자(c.x, c.y, 남, 옆2); else 곧은그림자(c.x, c.y, 남, 옆2);
      }
    }
  }
  return out;
}

/**
 * 0x1A452 — 직선 반복자를 그대로. 시작 칸부터 **옆으로 폭**, **앞으로 길이**.
 * 옆 증분([0xF0B9A],[0xF0B96]) 점프표 0x1A442: 0 남 (+1,0) · 1 서 (0,+1) · 2 북 (−1,0) · 3 동 (0,−1).
 * 줄을 바꿀 때는 옆으로 간 만큼 되돌아 앞으로 한 칸(0x1A5C2 [0xF0B9C]/[0xF0B98]).
 */
var 직선옆 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function 원본직선(battle, sx, sy, dir, width, length) {
  var d = DIR[dir & 3], s = 직선옆[dir & 3], out = [];
  for (var i = 0; i < length; i++)
    for (var k = 0; k < width; k++) {
      var x = sx + d.dx * i + s[0] * k, y = sy + d.dy * i + s[1] * k;
      if (inMap(battle, x, y)) out.push({ x: x, y: y });
    }
  return out;
}
function line(battle, cx, cy, dir, n) {
  var out = [], d = DIR[dir & 3];
  for (var i = 1; i <= n; i++) {
    var x = cx + d.dx * i, y = cy + d.dy * i;
    if (!inMap(battle, x, y)) break;
    out.push({ x: x, y: y });
  }
  return out;
}

/**
 * ★★★★★ **시작 칸 → 끝 칸** 사이의 칸들 — 혼(돌진)이 쓴다 (2026-08-30 · B-1)
 *
 *   원본 `0x2E385` 는 시작 화면 좌표와 **고른 칸**의 화면 좌표를 잡고
 *   `(끝 − 시작) / 5` 씩 나아간다(`0x2E567`). 칸 단위로 옮기면 **사이의 칸 전부**다.
 *   칸 선택기가 거리 2 이상의 **빈 칸**만 고르게 하므로(`0x2E3D0`·`0x2E3E4`)
 *   시작과 끝은 가로나 세로로 겹치거나 비스덤하게 놓일 수 있다 —
 *   긴 쪽 축을 따라 한 칸씩 나아가며 모은다(끝 칸 포함, 시작 칸 제외).
 * @returns {Array<{x,y}>}
 */
function 직선칸(battle, x0, y0, x1, y1) {
  var out = [], x = x0 | 0, y = y0 | 0, 걸음 = 0;
  var 한계 = (battle.W | 0) + (battle.H | 0) + 2;   /* 맴돌지 않게 */
  while ((x !== (x1 | 0) || y !== (y1 | 0)) && 걸음++ < 한계) {
    var dx = (x1 | 0) - x, dy = (y1 | 0) - y;
    /* ★ 여기 `±1` 은 **칸 하나**다 — 픽셀 보정이 아니다. 근거는 이 함수 머리에 있고
     *   (원본 `0x2E385` 가 `(끝−시작)/5` 씩 나아가는 것을 칸 단위로 옮긴 것 · `0x2E567`)
     *   전수 도구가 앞뒤 두 줄만 보므로 여기에도 적어 둔다. */
    if (Math.abs(dx) >= Math.abs(dy)) x += (dx > 0 ? 1 : -1);   /* 0x2E385 · 0x2E567 — 긴 축으로 한 칸 */
    else y += (dy > 0 ? 1 : -1);                                /* 0x2E385 · 0x2E567 */
    if (!inMap(battle, x, y)) break;
    out.push({ x: x, y: y });
  }
  return out;
}

/* ══════════ 활 사거리 — 원본 `0x1AEF3` + [리마스터] 세 단계 ═════════════
 *
 * **원작** (`0x1AEF3`)
 * ```asm
 * 0x1AEF7  cmp dl, 0x15 ; je       ; Archer
 * 0x1AEFC  cmp dl, 0x16 ; jne      ; Hunter
 * 0x1AF01    eax = 5 ; ret         ; ★ 둘만 5
 * 0x1AF08    eax = 7 ; ret         ; ★ 그 밖 전부 7
 * ```
 * 곧 원작은 **5 아니면 7** 두 가지뿐입니다.
 *
 * **[리마스터] 세 단계로 나눕니다** (사용자 요청 2026-08-13) —
 * 「아처 킬러 `3 5 7 5`, 헌터 클리너 `3 5 7 9 7`, 나머지 `3 5 7 9 11 9`」
 *
 * | 직업 | R | 폭 | 원작 R |
 * |---|---|---|---|
 * | `0x15` Archer · `0x35` Killer | **5** | `3 5 7 5` | 5 / 7 |
 * | `0x16` Hunter · `0x36` Cleaner | **6** | `3 5 7 9 7` | 5 / 7 |
 * | `0x17` Eagle · `0x18` Sniper · `0x37` Shadow Killer · `0x38` Shadow Master · `0xA7` | **7** | `3 5 7 9 11 9` | 7 |
 *
 * 원작에서 Killer 가 7 이던 것을 5 로, Hunter 가 5 이던 것을 6 으로 옮겼습니다.
 * 관련 — `리마스터_변경사항.md`(등록 필요) · 할일 N-16
 */
var BOW_R = {};
BOW_R[0x15] = 5; BOW_R[0x35] = 5;                    // 아처 · 킬러
BOW_R[0x16] = 6; BOW_R[0x36] = 6;                    // 헌터 · 클리너
/** ★ [리마스터] 궁 사거리 세 단계 — `Opt.cfg.궁사거리 === '원작'` 이면 원작 두 단계.
 *  원작(`0x1AEF3`)은 **Archer(0x15)·Hunter(0x16) 만 5, 그 밖 전부 7** 이다. */
function 궁사거리리마스터() {
  var c = root.Opt && root.Opt.cfg;
  return !(c && c.궁사거리 === '원작');
}
function bowRange(job) {
  var j = job | 0;
  if (!궁사거리리마스터()) return (j === 0x15 || j === 0x16) ? 5 : 7;   // 0x1AF01 / 0x1AF08
  return BOW_R[j] || 7;
}

/* ══════════ [리마스터] 마법사 계열 평타 = 짧은 원거리 ═══════════════════
 *
 * **원작** — 무기 종류 2(지팡이·마법)는 `0x1CCBB` 에서 `ecx=1`, 길이 1 이라
 * **정면 인접 한 칸**입니다(`원거리_사거리_투사체.md` §1). 공격력도 힘
 * 기반(`0x1797C`)이라 마법사가 평타를 칠 일이 사실상 없었습니다.
 *
 * **[리마스터]** (사용자 요청 2026-08-14) — 마법사 계열 평타를 **원거리**로
 * 바꾸고 **공격력을 지력 기반**으로 돌립니다(`rules.js derive` 참조).
 *
 * | 항목 | 값 | 왜 |
 * |---|---|---|
 * | 사거리 | **R = 4, 인접 포함 → `1 3 5 3`** | 궁수 최하위(`3 5 7 5`)보다 짧게 둬야 궁수 입지가 남습니다 |
 * | 인접 칸 | **친다** | 궁수는 못 치지만 마법사는 지팡이라 인접도 됩니다 (사용자 확인) |
 * | 직업 구분 | **없음** — 20직업 전부 같은 사거리 | 마법 쪽이 이미 클래스별로 갈립니다 |
 * | 투사체 | `MAGICSPR/F_BALL2.NSP` | 원작 화염 1계열 2클래스 이펙트. 원작은 포물선이지만 여기서는 직선 |
 *
 * 마법사 계열 = 무기 종류 2 인 직업 **20개** (`0x72793` 실측) —
 *   `0x19` Mage · `0x1A` Magician · `0x1B` Alchemist · `0x1C` Fire Master ·
 *   `0x1D` Ice Master · `0x1E` Thunder Master · `0x1F` Wizard ·
 *   `0x20` Dark Wizard · `0x21` Monk · `0x22` Cleric · `0x23` Priest ·
 *   `0x24` Druid · `0x25` Bishop · `0x26` Warlock · `0x27` Necromancer ·
 *   `0x28` Lich · `0x29` Sorcerer · `0x2A` Sharman · `0x2B` Exorcist · `0x34` Savant
 *
 * 반격 사거리(`0x1EF7C`)는 **손대지 않습니다** — wt 2 는 1 칸 그대로라,
 * 궁수와 마찬가지로 멀리서 쏘면 반격을 안 맞습니다.
 *
 * 관련 — `리마스터_변경사항.md` · 할일 N-17
 */
var MAGE_FAN_R = 4;                                  // 폭 1 3 5 3
/** ★ [리마스터] 마법사 평타를 짧은 원거리(부채꼴)로 할까 — 기본 **켜짐**.
 *  `Opt.cfg.마법사원거리` 가 `'원작'` 이면 끈다(원작은 정면 1칸). */
function 마법사원거리켜짐() {
  var c = root.Opt && root.Opt.cfg;
  return !(c && c.마법사원거리 === '원작');
}
function isMageWeapon(wt) { return (wt | 0) === 2; }

/**
 * 0x1D124 — **통상 공격이 닿는 칸**. 무기 종류로 모양이 갈립니다.
 *   wt <= 2 (권·검·지팡이)          : 정면 1칸        0x1D1F5 push 1
 *   wt == 3 (창)                    : 정면 2칸        0x1D238 push 2
 *   wt == 4 (부)                    : 0x1AD62 **두 벡터** (아래 표 · 2026-08-29 확정)
 *   wt == 5 (궁)                    : 반경 5(직업 0x15·0x16) 또는 7   0x1AEF3
 *   wt 6~9 · 0xD                    : 정면 2칸(8·0xD 는 3칸)          0x1D327
 *   wt 0xB                          : 반경 9,  wt 0xC : 반경 7        0x1D389
 * 대형 유닛(스프라이트 >= 300)의 발자국 모양 표 0xD66A8 은 자산에 없어 1×1 로 봅니다.
 * ★★★ **2026-08-29** — `0xD66A8` 은 이미지에서 **전부 0**(BSS)이고 실행 중에 채워진다.
 *   `ultimate.js` §잔상 큐에 구조를 적었다 — `572 × i + 13 × j` 로 도는
 *   **묶음마다 44칸 × 13바이트** 표이고, `0x11873 imul eax,13` 이 채우는 자리다.
 *   곧 「자산에 없다」가 아니라 **실행 중에 만들어지는 표**다.
 */
/**
 * ★ **공중전(전투 종류 6)은 위아래로 못 친다** — 원본 0x1D124 머리 · 0x1CC0C(범위 칠하기) 머리가 똑같다.
 *   ```asm
 *   0x1D130  mov ah,[0xBA84E] · 0x1D13D cmp ah,6 / jne      ; 공중전이 아니면 방향 그대로
 *   0x1D142  mov dl,[ecx+0x63] · test dl,dl / je · cmp dl,2 / jne
 *   0x1D14E  mov al,[esp] · inc al                          ; 방향 0(남)→1(서) · 2(북)→3(동)
 *   ```
 *   (0x1CC13~0x1CC2B 도 같은 식) — 곧 남·북을 보고 있어도 공격 칸은 서·동으로 센다.
 *   AI 후보(ai.js)도 이 창구로 칸을 세므로 위아래 대상이 빠진다.
 *   사장님(원문) 「공중전 방향지정도 잘못되었어. 위아래로는 공격할 수 없는데, AI가 공격하네. 제대로 처리해」(2026-11-09)
 */
function 공중전공격방향으로(battle, u, fn) {
  var d = u.dir | 0;
  if (!battle || (battle.battleKind | 0) !== 6 || (d !== 0 && d !== 2)) return fn();
  u.dir = d + 1;
  try { return fn(); } finally { u.dir = d; }
}
function attackCells(battle, u) {
  return 공중전공격방향으로(battle, u, function () { return attackCells방향대로(battle, u); });
}
function attackCells방향대로(battle, u) {
  var wt = weaponTypeOf(battle, u), j = u.job | 0;
  /* ★ [리마스터] 무기 2(지팡이·마법)는 원작이 정면 1칸이지만 짧은 부채꼴로 바꿉니다.
   *   `Opt.cfg.마법사원거리 === '원작'` 이면 원작대로 1칸 (개발창 토글, 2026-08-16). */
  if (isMageWeapon(wt) && 마법사원거리켜짐()) {
    return fanCells(battle, u.x, u.y, u.dir, MAGE_FAN_R, true);
  }
  if (wt <= 2) return line(battle, u.x, u.y, u.dir, 1);
  if (wt === 3) return line(battle, u.x, u.y, u.dir, 2);
  if (wt === 4) {
    /* ★★★★★ **0x1AD62 를 4방향 전수로 읽었다 (2026-08-29)**
     *
     *   0x1AD65  [0xA0B94] = dx · 0x1AD6C xor edx,edx  (dx = 0)
     *   0x1AD6E  [0xA0B92] = ax · 0x1AD85 xor eax,eax · 0x1AD87 mov ax,bx (방향)
     *   0x1AD7B  cmp bx,3 / ja 벗어남
     *   0x1AD8A  jmp dword [eax*4 + 0x1AD52]      ; ★ 방향 4칸 점프표
     *
     *   각 갈래가 채우는 네 word — **전수**
     *   | 방향 | 갈래 | `+0x96` | `+0x98` | `+0x9A` | `+0x9C` |
     *   |---|---|---:|---:|---:|---:|
     *   | 0 | `0x1AD92` | -1 |  0 | -1 |  2 |
     *   | 1 | `0x1ADBD` | -1 |  2 |  1 |  0 |
     *   | 2 | `0x1ADEB` |  1 |  0 |  1 | -2 |
     *   | 3 | `0x1AE11` |  1 | -2 | -1 |  0 |
     *
     *   ⇒ 「부채꼴」이 아니라 **두 벡터 쌍**이고, 네 방향이 같은 네 점
     *     `(-1,0) (-1,2) (1,0) (1,-2)` 을 돌려쓴다.
     *   ★ `0x1A5AE add bx, [0xA0B96]` → `[0xA0B94]` 로 들어가므로
     *     `+0x96` 은 **진입 `dx` 쪽**의 증분이고, `+0x9C` 는 `[0xA0B92]`(진입 `ax`) 쪽이다.
     *   호출부(`0x1D2A4`)는 이렇게 부른다 —
     *     `0x1D29A mov edx,[esp+2] · mov eax,[esp+6] · mov ebx,edi(방향)`
     *     `0x1D2A0 sar edx,16 · sar eax,16` (둘 다 **+2 의 word 읽기** 관용구)
     *   ★★★★★ **갈랐다 (2026-09-02) — `(+0x96,+0x98)` 과 `(+0x9A,+0x9C)` 가 짝이다**
     *
     *     ☠ 먼저 **주소를 바로잡는다** — 표는 `0xA0B92` 가 아니라 **`0xF0B92`~`0xF0B9C`** 다.
     *       `0x1A5AB` 의 실물이 `66 03 1d **96 0b 0f 00**`(= `add bx, [0xF0B96]`)이다.
     *
     *     ★ **채우는 곳은 `0x1AD62`**(도끼 벡터 함수)이고, 방향별 점프표 `0x1AD52`
     *       네 갈래를 **바이트로 떠서** 확정했다:
     *       ```asm
     *       ; 방향 0 — 0x1AD92        (edx = 0 · 0x1AD6C xor edx,edx)
     *       ebx = -1 ; esi = 2
     *       [+0x98] = dx(0) · [+0x9A] = bx(-1) · [+0x96] = bx(-1) · [+0x9C] = si(2)
     *       ; 방향 2 — 0x1ADEB
     *       eax = 1 ; ebx = -2
     *       [+0x98] = dx(0) · [+0x9A] = ax(1) · [+0x96] = ax(1) · [+0x9C] = bx(-2)
     *       ```
     *       ⇒ **방향 0 → `(-1, 0)` 과 `(-1, 2)`** · **방향 2 → `(1, 0)` 과 `(1, -2)`**
     *       ⇒ 곧 **`(+0x96, +0x98)` 이 한 점, `(+0x9A, +0x9C)` 가 다른 점**이다.
     *         위에서 「훨씬 규칙적이다」라고 본 쪽이 **맞았다.**
     *     ☠ `0x1A5AE`·`0x1A5C2` 로 짝을 정하려던 것이 **어긋난 접근**이었다 —
     *       그 자리는 **읽어 쓰는 다른 함수**(`0x1A5A8` 대역)이지 **채우는 곳이 아니다.**
     *     ★ 표 실물은 **전부 0** 이다 — `0x1AD62` 가 **실행 중에 채운다.**
     *   ☐ **아래 임시 모양은 아직 안 바꿨다** — 대조해 보니 **어긋난다:**
     *       실행기 방향 0 : `(0,1)` · `(1,0)` · `(-1,0)`   ← **세 칸**
     *       원본   방향 0 : `(-1,0)` · `(-1,2)`            ← **두 칸**
     *     ☠ 그런데 **`+0x96` 이 x 인지 y 인지**를 아직 못 정했다. 원본 값이 `(x,y)` 순인지
     *       `(y,x)` 순인지에 따라 대응이 달라지므로 **지금 바꾸면 추측이 된다.**
     *     ★★★★★ **x/y 가 갈렸다 (2026-09-02)** — `0x49ABC` 는 **「한 칸 앞으로」** 함수다.
     *       점프표 `0x49AAC` 네 갈래가 각각 **한 줄**이다:
     *       ```asm
     *       방향 0 → 0x49ACF  66 ff 02   inc word [edx]    ; y + 1
     *       방향 1 → 0x49AD3  66 ff 08   dec word [eax]    ; x − 1
     *       방향 2 → 0x49AD7  66 ff 0a   dec word [edx]    ; y − 1
     *       방향 3 → 0x49ADB  66 ff 00   inc word [eax]    ; x + 1
     *       ```
     *       호출부가 `0x1EE8F lea edx,[esp+8]`(**&y**) · `0x1EE96 lea eax,[esp+0xC]`(**&x**)
     *       이므로 **`edx` 가 y 포인터 · `eax` 가 x 포인터**다.
     *       ⇒ 네 방향이 `combat.js:55 DIR` 과 **정확히 같다**(0=(0,+1) 1=(-1,0) 2=(0,-1) 3=(+1,0)).
     *
     *     ☆☆☆ **「점 둘」이 아니었다 — 직사각 영역 반복자다 (2026-09-02)**
     *       앞서 적은 「두 점」도 「`(+0x96,+0x98)` 짝」도 **틀렸다.**
     *       `0x1AD62` 는 값을 심기만 하고, 실제로 걷는 것은 `0x1A567` 대역이다:
     *       ```asm
     *       0x1A567  *eax = [0xF0B92]   ; x 를 호출자에게
     *       0x1A577  *edx = [0xF0B94]   ; y 를 호출자에게
     *       0x1A57A  cx = [0xF0B78] ; inc cx ; si = [0xF0B7C]   ; 안쪽 카운터 · 한계
     *       0x1A590  cmp cx, si ; je 0x1A5C2                    ; 안쪽이 끝나면 줄을 바꾼다
     *       0x1A595  x += [0xF0B9A] ; y += [0xF0B96]            ; ★ 안쪽 걸음
     *       0x1A5C2  x += [0xF0B9C] ; y += [0xF0B98]            ; ★ 바깥 걸음
     *       0x1A5D6  cx = [0xF0B7A] ; inc cx ; si = [0xF0B7E]   ; 바깥 카운터 · 한계
     *       0x1A5E6  [0xF0B78] = 0                              ; 안쪽 카운터 리셋
     *       0x1A612  [0xF0B90] = 1                              ; 다 돌았다
     *       ```
     *       ⇒ **짝은 `(x = +0x9A, y = +0x96)`(안쪽) 과 `(x = +0x9C, y = +0x98)`(바깥)**이다.
     *         근거 — `0x1A5A9 add edx,eax`(eax = `[0xF0B9A]`) 의 결과가
     *         `0x1A5B2 [0xF0B92]`(**x**) 로, `0x1A5AB add bx,[0xF0B96]` 의 결과가
     *         `0x1A5B9 [0xF0B94]`(**y**) 로 들어간다.
     *       ⇒ 걸음 벡터 (방향 0 = `0x1AD92` · 방향 1 = `0x1ADBD`):
     *         방향 0 — 안쪽 `(-1, -1)` · 바깥 `(2, 0)`
     *         방향 1 — 안쪽 `(1, -1)` · 바깥 `(0, 2)`
     *       ★ 꼬리 `0x1AE3C` 는 `[0xF0B90] = 0` 만 한다 — **개수는 안 세운다.**
     *         ⇒ 안쪽/바깥 개수 `[0xF0B7C]` · `[0xF0B7E]` 는 **호출자가 미리 세운다.**
     *
     *     ★★★ **반격도 유닛 자신의 방향을 그대로 쓴다** — `(방향+2)%4` 가 **아니다.**
     *       `0x1EE93 mov ebx,[ecx+0x60] ; 0x1EE9A sar ebx,0x18` 이 유닛의 방향이고,
     *       `0x1EEA6` 이 같은 것을 다시 실어 `0x1EEB8 call 0x1AD62` 에 넘긴다.
     *       (`0x1EE40` 대역의 「방향 셋」은 `[esp]`~`[esp+4]` 에 담기며 **여기에 안 쓰인다.**)
     *     ★ 기준 좌표는 **한 칸 앞**이다 — `0x1EE9D call 0x49ABC` 가 먼저 돌고
     *       그 결과를 `0x1EEB8` 에 넣는다.
     *
     *     ★★★★★ **칸은 세 개다** — 꺼내는 쪽이 세 번만 돈다:
     *       ```asm
     *       0x1EEB6  xor esi,esi              ; i = 0
     *       0x1EEB8  call 0x1AD62             ; 반복자 초기화 (한 번)
     *       0x1EEC5  call 0x1AE48             ; ← 다음 칸 꺼내기
     *       0x1EED8  call 0x11DB2             ; 그 칸의 유닛
     *       0x1EEEF  call 0x1201D ; cmp ax,1  ; 적인가
     *       0x1EEFA  edx = [esp + i*2 - 2] sar16 ; ★ 「방향 셋」은 **피격 방향**으로 쓰인다
     *       0x1EF06  call 0x137B0             ; 대상 등록
     *       0x1EF0C  cmp si, 3 ; jge          ; ★★★ **세 번**
     *       ```
     *     ⇒ 네 방향 걸음 벡터 (안쪽 = `(+0x9A, +0x96)` · 바깥 = `(+0x9C, +0x98)`):
     *       ```
     *       방향 0  0x1AD92   안쪽 (-1, -1)   바깥 ( 2,  0)
     *       방향 1  0x1ADBD   안쪽 ( 1, -1)   바깥 ( 0,  2)
     *       방향 2  0x1ADEB   안쪽 ( 1,  1)   바깥 (-2,  0)
     *       방향 3  0x1AE11   안쪽 (-1,  1)   바깥 ( 0, -2)
     *       ```
     *     ★★★★★ **안쪽 한계 `[0xF0B7C]` = 2 다 (역산 · 네 방향 전수)**
     *       `0x1AD62` 는 개수를 안 세운다(세우는 함수는 `0x1A452`, 개수를 인자로 받는다).
     *       그래서 값을 **네 방향 전수로 역산**했다 — 2 일 때만 전부 맞는다:
     *       ```
     *       방향 0  한 칸 앞 (x, y+1) → 안쪽 (x-1, y) → 줄바꿈 (x+1, y)
     *       방향 1  한 칸 앞 (x-1, y) → 안쪽 (x, y-1) → 줄바꿈 (x, y+1)
     *       방향 2  한 칸 앞 (x, y-1) → 안쪽 (x+1, y) → 줄바꿈 (x-1, y)
     *       방향 3  한 칸 앞 (x+1, y) → 안쪽 (x, y+1) → 줄바꿈 (x, y-1)
     *       ```
     *       (카운터: `[0xF0B78]` 이 0→1 이면 안쪽 걸음, 1→2 에서 `cmp cx,si` 가 걸려 줄바꿈)
     *
     *     ☆☆☆☆☆ **⇒ 아래 모양은 「임시」가 아니라 원본과 같다. 바꾸지 않는다.**
     *       네 방향 모두 **칸 집합이 정확히 일치**한다. 앞서 「어긋난다」고 적은 것은
     *       내가 `0x1AD62` 를 「점 둘을 놓는 함수」로 잘못 읽었기 때문이다.
     *   ☐ 다만 **순서**는 다르다 — 원본은 `앞 · 안쪽 · 줄바꿈`, 아래는 `앞 · 오른 · 왼`.
     *     방향 0 이면 원본 `(x,y+1)·(x-1,y)·(x+1,y)` / 아래 `(x,y+1)·(x+1,y)·(x-1,y)`.
     *     순서는 `0x1EEFA` 의 **피격 방향 배정**에 영향을 주므로 손대려면 조사가 더 필요하다. */
    var d = DIR[u.dir & 3], out = [];
    var cand = [{ x: u.x + d.dx, y: u.y + d.dy },
                { x: u.x + d.dy, y: u.y + d.dx },
                { x: u.x - d.dy, y: u.y - d.dx }];
    for (var i = 0; i < cand.length; i++) if (inMap(battle, cand[i].x, cand[i].y)) out.push(cand[i]);
    return out;
  }
  /* ★ 무기 5 — 0x1D2DC → 0x1B7FA(시작 칸 0x1A146 · 지형 시야 그림자). 위 활시야칸 (2026-10-07) */
  if (wt === 5) { var 활시작 = 공격시작칸(battle, u); return 활시야칸(battle, 활시작.x, 활시작.y, u.dir, bowRange(j)); }
  /* ★★★★★ **무기 11(베샤르 Cannon)·12(페리튼 Arrow) — 마름모가 아니라 «앞으로 쏘는 폭 2 직선»** (2026-10-03 원본 직독)
   *   사장님(원문) 「한편 마장기 탑승 관련하여 베샤르, 페리튼, 로퍼 공격 범위나 효과 제대로 적용되는지도 확인해야해」
   *   ☠ 전에는 마름모 반경 9·7 이었다(근거 없음).
   *   ```asm
   *   0x1D172  call 0x1A146            ; 시작 칸 = 발자국 앞면 (무기 6~9 와 같은 자리 · 공격시작칸)
   *   0x1D389  cmp bl,0xB / cl = 9 : 7
   *   0x1D3C5  call 0x1A625(시작x, 시작y, 방향, ecx=2 폭, 인자 cl)
   *   ── 0x1A625 ──
   *   0x1A657  0x49ABC((방향+2)&3)       ; 시작에서 한 칸 «뒤» 의 지형값 t (0x1093D · >100 이면 −100)
   *   0x1A68D  기준 = (t & 0xF0) + 0x18
   *   0x1A6A3  0x49ABC(방향)             ; 시작에서 한 칸 «앞» 으로
   *   0x1A6C4  0x1A452(그 칸, 방향, 폭 2, 길이 인자−1)   ; ★ 8 · 6
   *   0x1A6FB  칸 지형값 == 0 이면 끝 · 0x1A703 == 기준 이면 끝   ; ★ 첫 막힘에서 «통째로» 멈춘다
   *   ``` */
  if (wt === 0xB || wt === 0xC) {
    var 시0 = 공격시작칸(battle, u), dd = DIR[u.dir & 3];
    var 지 = function (x, y) { var t = battle.tile ? battle.tile(x, y) : null; var v = t ? (t['값'] & 0xFF) : 0; return (v > 0x64) ? ((v - 0x64) & 0xFF) : v; };
    var 기준 = ((지(시0.x - dd.dx, 시0.y - dd.dy) & 0xF0) + 0x18) & 0xFF;
    var 줄 = 원본직선(battle, 시0.x + dd.dx, 시0.y + dd.dy, u.dir, 2, (wt === 0xB ? 9 : 7) - 1), 끊은 = [];
    for (var q = 0; q < 줄.length; q++) {
      var tv = 지(줄[q].x, 줄[q].y);
      if (tv === 0 || tv === 기준) break;                              /* 0x1A6FB · 0x1A703 → 0x1A791 */
      끊은.push(줄[q]);
    }
    return 끊은;
  }
  /* ★ 2026-09-24 (사장님: 「공격 범위도 지금은 말처럼 1*2로 되어있는데, 2*2여야해」)
   *   0x1D1E2 `cmp bl,9 / jbe 0x1D327` — 무기 6~9 는 0x1D327 로 간다:
   *   `0x1D344 mov ecx,2`(폭 2) · 길이 bh==8 이면 3 아니면 2 → 0x1A452.
   *   시작 칸은 0x1A146 이 방향별 발자국 앞면으로 옮긴다(공격시작칸 주석).
   *   전에는 폭 1 직선(line)이라 마장기가 「1×2」로 쳤다. */
  if (wt >= 6 && wt <= 9) {
    var 시작 = 공격시작칸(battle, u);
    return 원본직선(battle, 시작.x, 시작.y, u.dir, 2, (wt === 8) ? 3 : 2);
  }
  /* ★★★★★ **wt 13·14 = 브레스** — 폭 2 직선 (2026-08-25 · 원본 확정)
   *
   *   사용자 지적: 「탈것 탑승후 링커맨드 열었을 때 표시되는 **공격범위가 이상해.**
   *   탈것별로 공격 범위도 다른데, 지금 **비룡을 탑승했는데 말 공격범위**로
   *   표시되고 그렇게 적용돼. … 비룡의 경우 **브레스**를 뿜어서 공격해야해.」
   *
   *   원인: wt 14 갈래가 **아예 없어서** 맨 아래 폴백 `line(…, 2)` 로 떨어졌다 —
   *   그게 마침 말(wt 3)과 같은 모양이라 「말 공격범위」로 보였다.
   *
   *   원본 사거리 디스패처 `0x1D124` —
   *   ```
   *   0x1D187  cmp bl,0x0B / jb  0x1D1CE     ; wt < 11
   *   0x1D18C  cmp bl,0x0C / jbe 0x1D389     ; 11~12
   *   0x1D195  cmp bl,0x0F / jb  0x1D1C0     ; ★ **13~14**
   *   0x1D1C0  cmp bl,0x0D / jbe 0x1D327     ;   13 → 0x1D327
   *   0x1D1C9  jmp 0x1D3CF                   ;   ★ **14 → 0x1D3CF**
   *
   *   0x1D3CF  push 2        ; ★ 길이 2
   *   0x1D3DC  mov ecx, 2    ; ★ 폭 2
   *   0x1D3EA  call 0x1A452  ;   **직선 반복자**
   *
   *   0x1D327  cmp bh,8 je / cmp bh,0xD jne  ; 13 은 그 값이면 길이 3
   *   0x1D331  mov al,3  /  0x1D335  mov al,2
   *   0x1D344  mov ecx,2 / 0x1D349 push eax  ; 폭 2 · 길이 2 또는 3
   *   ```
   *   `0x1A452` 의 인자 규약은 이미 확정돼 있다 —
   *   `마법_타게팅_지오메트리_주소맵.md` §87: **eax,edx=좌표 · ebx=방향 ·
   *   ecx=폭 · 스택=길이**. 그래서 `dirRange(…, 'line', 길이, 폭)` 이 그대로 맞는다.
   *
   *   ★★★★★ **해소** — 「짝수 폭이 어느 쪽으로 치우치는지」는 §661 에서
   *     `0x1A452` 반복자를 읽어 **확정**돼 있다(2026-08-25):
   *     폭은 중심 기준이 아니라 **한 방향으로 세고**(`0x1A57A` · `0x1A4BD +1` ·
   *     `0x1A4CB -(폭-1)`), 증분이 `+1` 이라 짝수 폭은 **+ 쪽으로 한 칸** 치우친다.
   *     구현도 이미 그렇게 돈다 — `lo = -(width/2-1)` · `hi = width/2` (§674).
   *     곧 폭 2 가 폭 1 로 뭉개지던 것은 그때 고쳐졌고, 여기 주석만 옛것이었다
   *     (2026-08-29 정리). */
  /* ☠ 2026-09-24 — `dirRange` 는 옆 방향이 `(d.dy, d.dx)` 라 서·동에서 원본 `0x1A442`(서 +y · 동 −y)와
   *   **반대쪽**에 폭 2 를 붙였고, 시작 칸(`0x1A146` 발자국 앞면)도 안 썼다(정본 1429 발견).
   *   무기 13 은 `0x1D1E2 jbe 0x1D327` 로 **무기 6~9 와 같은 갈래**이고, 14 의 `0x1D3CF` 도
   *   같은 시작 좌표·방향으로 `0x1A452` 를 부른다 ⇒ 마장기와 같은 `공격시작칸 + 원본직선`. */
  if (wt === 0xD || wt === 0xE) {
    var 시작B = 공격시작칸(battle, u);
    /* 0x1D327 — bh 가 8 이나 0xD 면 길이 3(무기 13), 0x1D3CF — 무기 14 는 길이 2 */
    return 원본직선(battle, 시작B.x, 시작B.y, u.dir, 2, (wt === 0xD) ? 3 : 2);
  }
  /* ★★★★★ 무기 15~19 — 배·투석 같은 탈것 무기 (2026-10-10 실행본 0x1D195~0x1D6AF 직독)
   *   사장님(원문) 「배들 공격 범위도 이상해. 대포를 쏘는 것들은 옆으로 쏴야하고, 화살은 주변으로 둘러서 쏴야하는데 지금 범위가 엉망이야」
   *   ☠ 이 갈래가 통째로 없어 맨 아래 «앞 2칸»으로 떨어졌다 (19-1 실측: 아군 배 무기 18 · 해적두목 15).
   *   0x1D195 cmp bl,0xF jb · 0x1D19A cmp bl,0x10 jbe 0x1D420 · 0x1D1A3 cmp bl,0x12 jb 0x1D4B4(11) · jbe 0x1D518(12) · 0x1D1B2 je 0x1D63D(13)
   *   도우미: 0x49ABC = 방향으로 한 칸(ecx 안 씀) · 0x49B01 = 맨해튼 거리 · 0x1AC08/0x1AC59 = 마름모 · 0x1A452/0x1A552 = 직선(씨앗부터) */
  if (wt === 0xF || wt === 0x10) {
    /* 0x1D420 — 0x10 이면 반경 3 · 0xF 면 반경 4(직업 0x8C·0x8D 는 중심 = 공격 시작 칸 0x1A146) · 0x1D48E 거리 ≤ 1 은 뺀다 ⇒ 둘레 */
    var 중 = (wt === 0xF && (j === 0x8C || j === 0x8D)) ? 공격시작칸(battle, u) : { x: u.x | 0, y: u.y | 0 };
    return diamond(battle, 중.x, 중.y, wt === 0x10 ? 3 : 4, false).filter(function (c) {
      return (Math.abs(c.x - (u.x | 0)) + Math.abs(c.y - (u.y | 0))) > 1;   /* 0x1D48E call 0x49B01(유닛, 칸) · jle 1 → 건너뜀 */
    });
  }
  if (wt === 0x11) {
    /* 0x1D4B4 — 씨앗 = 머리의 0x1D172 0x1A146(공격 시작 칸 = 발자국 앞 첫 칸) 에서 다시 한 칸 앞(0x1D4C7 0x49ABC) · 폭 3(ecx 3) · 길이 7(0x1D4CC) · 전부
     *   ⇒ 1칸 유닛이면 두 칸 앞부터 여덟 칸 앞까지 — 바로 앞 한 줄은 못 친다
     *   ☠ 유닛 칸에서 한 칸만 가서 한 칸 앞부터 일곱 칸 앞까지로 한 칸 당겨져 있었다 (2026-11-08 Genesis2 EXE 직독 · 사장님 「포병 사거리가 이상해.」)
     *   ★ 폭 3 은 씨앗에서 한쪽(0x1A442 옆 증분)으로만 센다 — 0x1A452 에 가운데 맞춤이 없다(원본도 한쪽으로 쏠린다) */
    var 시11 = 공격시작칸(battle, u), d11 = DIR[u.dir & 3];
    return 원본직선(battle, 시11.x + d11.dx, 시11.y + d11.dy, u.dir, 3, 7);
  }
  if (wt === 0x12) {
    /* 0x1D518 — 옆 두 쪽((방향+1)&3 · (방향+3)&3)마다 그쪽 한 칸 씨앗 · 폭 1 · 길이 5 · 앞 두 칸(0x1A552 두 번)을 건너뛰고 3~5칸째 */
    var 옆칸 = [];
    [1, 3].forEach(function (더) {
      var 쪽 = ((u.dir | 0) + 더) & 3, ds = DIR[쪽];
      for (var i12 = 2; i12 < 5; i12++) {
        var x12 = (u.x | 0) + ds.dx * (1 + i12), y12 = (u.y | 0) + ds.dy * (1 + i12);
        if (inMap(battle, x12, y12)) 옆칸.push({ x: x12, y: y12 });
      }
    });
    return 옆칸;
  }
  if (wt === 0x13) {
    /* 0x1D63D — 앞으로 한 칸 씨앗 · 폭 1 · 길이 5 · 전부 */
    var d13 = DIR[u.dir & 3];
    return 원본직선(battle, (u.x | 0) + d13.dx, (u.y | 0) + d13.dy, u.dir, 1, 5);
  }
  return line(battle, u.x, u.y, u.dir, 2);
}

/** ★★★★★ **0x3C7D1 돌진(대쉬) 후보 — 정면 «7칸»** (2026-09-23 · 사장님 지적)
 *
 *  > 사장님: 「**대쉬 이동 범위도 달라. 2번세이브의 미카엘 기준 원본은 6칸인데,
 *  >  우리는 4칸**이야.」
 *
 *  ```asm
 *  0x3C801  ecx = 1                     ; ★ 폭 1
 *  0x3C806  call 0x49ABC                ;   좌표를 방향으로 **한 칸** 민다 (앞칸이 씨앗)
 *  0x3C80B  push 7                      ; ★★ **길이 7**
 *  0x3C821  call 0x1A452                ;   직선 반복자 — eax,edx=좌표 ebx=방향 ecx=폭 스택=길이
 *  0x3C833  call 0x1A552                ;   씨앗 칸부터 내놓는다(0x1A56E 가 먼저 쓴다)
 *  0x3C84F  call 0x13CBD ; cmp eax,-1   ; ★ −1(빈 칸)이 아니면 **거기서 끝**
 *  ```
 *  ⇒ **앞칸부터 7칸**을 한 칸씩 보며 첫 막힌 칸에서 끊는다.
 *  ☠ 우리는 4칸이었다 — 근거 없는 값이었다.
 *  ★ 사장님이 세신 「6칸」은 일곱째 칸이 막혀 끊긴 것과 들어맞는다.
 *    (`push 7` 은 직업·레벨과 무관한 **상수**다.) */
function dashCells(battle, u) {
  var d = DIR[u.dir & 3], out = [];
  var mt = root.G2Move && root.G2Move.moveTypeOf
    ? root.G2Move.moveTypeOf(battle, u) : 0;
  for (var n = 1; n <= 7; n++) {                       /* 0x3C80B push 7 */
    var x = (u.x | 0) + d.dx * n, y = (u.y | 0) + d.dy * n;
    if (!inMap(battle, x, y) || battle.at(x, y) || battle.moveCost(x, y, mt) <= 0) break;
    out.push({ x: x, y: y });
    /* ★ 적이 붙은 칸에서 멈춘다 (그 칸은 표시) — 0x3C862~0x3C8B4 네 방향 이웃(0x49ABC)에 0x1201D 적대 유닛이 있으면
     *   0x3C8B6 표시 뒤 cx≠4 라 0x3C8D5 로 루프를 끝낸다 (2026-10-10 직독 · 전엔 적을 지나 7칸까지 갔다) */
    var 붙음 = false;
    for (var k = 0; k < 4 && !붙음; k++) {
      var nx = x + DIR[k].dx, ny = y + DIR[k].dy;
      var nu = inMap(battle, nx, ny) ? battle.at(nx, ny) : null;
      if (nu && nu !== u && nu.alive !== false && hostile(nu.side, u.side, battle.confuse)) 붙음 = true;   /* 0x3C8A4 call 0x1201D */
    }
    if (붙음) break;
  }
  return out;
}

/** 공격 칸 목록이 대상의 발자국 중 하나와 닿는가. 대형 유닛의 앵커만 보지 않습니다. */
function targetInCells(battle, target, cells) {
  var foot = battle.cellsOf ? battle.cellsOf(target) : [[target.x, target.y]];
  for (var i = 0; i < cells.length; i++)
    for (var j = 0; j < foot.length; j++)
      if (cells[i].x === foot[j][0] && cells[i].y === foot[j][1]) return true;
  return false;
}

/** 마법 **선택범위** 반경 — 원본 확정 (2026-08-30)
 *
 *  ```asm
 *  0x29514(eax=시전자, dx=class)
 *    0x29526  cmp dx, 1 / jne 0x29552
 *    0x2952C    ecx = 5                  ; ★ **class 1 → 5 고정**
 *    0x29539    call 0x28C8A → 0x41BF5(cx 그대로) → 0x41C07 call 0x28465
 *
 *    0x29552  eax = [esp+0xC]            ;   class
 *    0x2955D  edx += 5                   ; ★ **class + 5**
 *    0x29560  eax += 3                   ;   class + 3 (스택 인자 — 반경 아님)
 *    0x2956E  ecx = dx
 *    0x2957C  call 0x419F1 → 0x41A02 call 0x28465
 *
 *  0x28465(eax=유닛, edx=n)              ; ★ **공통 마무리**
 *    0x28468  al  = [eax + 0x5B]         ;   무기 (bridge.js:224)
 *    0x2846B  edx = 0x36                 ;   ITEM 필드
 *    0x28475  call 0x184A4               ;   ITEM 값 — (번호−1)×66 레코드
 *    0x2847C  eax += ebx                 ; ★ **+ n**
 *  ```
 *
 *  ⇒ **반경 = `ITEM[무기].마법사거리` + (class 1 이면 5, 아니면 class + 5)**
 *
 *  ☠ **예전 식 `rank*2 + 3 + 보정` 은 클래스 3 에서 틀렸다** —
 *      class 1 → 5 ✅   class 2 → 7 ✅   class 3 → **9 ✗ (원본 8)**
 *    `rank*2+3` 에는 EXE 근거가 없었다. 1·2 가 우연히 맞아 안 보였다.
 *
 *  ☠ `마법_타게팅_지오메트리_주소맵.md` §2.1 의 「선택범위 반경 = class+3
 *    (1→5 · 2→5 · 3→6)」도 **틀렸다.** `class+3` 은 `0x29560` 의 **스택 인자**(`edi`)이고
 *    반경으로 쓰이는 것은 `ecx`(`class+5`)다. 문서를 정정했다.
 *
 *  ★ ITEM `+0x36`(우리 `마법사거리` · `g2_export_battle.py r[54]`)은 124개 중
 *    **다섯만 1** 이다 — 마인검 · 지혜의 반지 · 오브 · 다크오브 · 크리스탈 오브.
 */
/**
 * ★ 자기 둘레 광역 반경 — `0x2A1C6` 은 `0x2A211 call 0x28465(유닛, 클래스×2+3)` 로 **무기 마법사거리(ITEM +0x36)를 더한다** (2026-10-02)
 *   쓰는 마법 넷(`무기보정` 표지): 원소 6 · 회복 4 · 보조 6(배리어 −2) · 암흑 7 — 호출부 `0x2B8EA` · `0x2C63B` 전수.
 *   ☠ 우리는 보정 없이 클래스×2+3 만 써서, AI(`0x42025` 는 보정 포함)가 «범위 안 적 있음» 으로 시전했는데 효과 범위엔
 *     아무도 없어 시전이 실패(MP 도 안 빠짐)했다 — 사장님 「2-6에서 네크로맨서가 범위내에 적도 없는데 계속 익스플로젼은 쓰는데?」·「mp소모도 제대로 안되고」
 */
function 자기광역반경(battle, u, tg, rank) {
  var r = tg.radiusOf ? (tg.radiusOf(rank) | 0) : (3 + rank * 2);
  if (tg.무기보정) {
    var Ru = R();
    r += Ru ? (Ru.itemFieldS(battle.T, (u.gear || {}).weapon | 0, '마법사거리') | 0) : 0;
  }
  return r;
}

function magicRadius(battle, u, rank) {
  var Ru = R(), T = battle.T;
  var bonus = Ru ? Ru.itemFieldS(T, (u.gear || {}).weapon | 0, '마법사거리') : 0;
  /* 2026-09-15 정정 - rank 는 0 기준(0,1,2)인데 원본 식의 class 는 1 기준이다.
   *   `((rank)===1) ? 5 : rank+5` 로 두어 5.5.7 이 나왔다. 원본은 5.7.8 이다.
   *     0x2952C  class 1 -> 5 고정
   *     0x2955D  그 밖   -> class + 5   (class2 -> 7 . class3 -> 8) */
  var cls = (rank | 0) + 1;                                 // 0 기준 rank -> 1 기준 class
  var n = (cls === 1) ? 5 : (cls + 5);                      // 0x2952C · 0x2955D
  return n + (bonus | 0);                                   // 0x2847C
}

/** 필살기 사거리 — ITEM +0x38(필살기사거리) + 등급 (0x2F4DE · 0x2F80B). */
function specialRadius(battle, u, grade) {
  var Ru = R();
  var v = Ru ? Ru.itemFieldS(battle.T, (u.gear || {}).weapon | 0, '필살기사거리') : 0;
  return (v | 0) + (grade | 0);
}

/* ══════════════════════ 마법 타게팅 형태 (마법_타게팅_사양.md) ═══════════ */

/* ★★ [리마스터] 타겟 지정 마법의 선택 범위를 **클래스별로 통일** (2026-08-13)
 *
 * 사용자 요청: 「마법의 경우 **클래스별로 같은 단계 마법이어도 타겟 선택 범위가
 * 달라지는데, 마법 단계별로 다르게 적용돼** … 예를 들면 1단계 마법은 1클래스
 * `3 5 7 5`, 2~3클래스 `3 5 7 9 11 9`, 2단계 마법은 1~2클래스 `3 5 7 5`,
 * 3클래스 `3 5 7 9 11 9` 이런 식인데, **모든 타겟 지정 마법 관련하여 통일**하면
 * 좋겠어.」
 *
 * 원작은 **단계와 클래스가 뒤섞여** 같은 단계인데도 클래스에 따라 범위가 튑니다.
 * 의도한 설계가 아니라 **버그처럼 보인다**는 판단이라, 리마스터는 **클래스만** 봅니다.
 *
 * | 클래스 | R | 폭 |
 * |---|---|---|
 * | 1 | **5** | `3 5 7 5` |
 * | 2 | **6** | `3 5 7 9 7` |
 * | 3 | **7** | `3 5 7 9 11 9` |
 *
 * **적용 대상** (사용자 지정) — 원소 1~3단계 · 회복 1~3단계 · 보조 1~4단계 ·
 * 암흑 1~3단계 + 5~6단계.
 *
 * ★ 4단계 **원소**는 제외합니다 — 타겟 선택이 아니라 **효과 영역**(블리자드 스톰의
 *   화면 전체 같은 것)이라 개념이 다릅니다. **광역 효과 범위 작업에서 따로 다룹니다**
 *   (사용자 판단 2026-08-13, 할일 N-20).
 *
 * 모양은 원거리 평타와 **같은 프리미티브**(`fanCells`)입니다 — `R` 만 다릅니다.
 */
/* ★ `spellParts` 는 **0 기준**이다 — `rank` 0·1·2 = 1·2·3 클래스,
 *   `level` 0·1·2… = 1·2·3단계. 계열은 `magicTargeting` 기준으로
 *   **0·1·2 화염·빙한·전격(=원소) · 3 회복 · 4 보조 · 5 소환 · 6 암흑**. */
/** 그 마법이 [리마스터] 통일 대상인가 — 계열·단계(둘 다 0 기준)로 판정. */

/**
 * ★★ **원작** 타겟 지정 마법의 선택 범위 R — 리마스터 통일을 껐을 때 쓴다.
 *
 * 클래스 이름 (사용자 2026-08-16): **1클 나이트 · 2클 엑소시스트 · 3클 서번트**
 *
 * 폭 `3 5 7 5` = **R 5** · `3 5 7 9 11 9` = **R 7** — 원작은 이 **두 가지뿐**이다.
 *
 * | 단계 | 1클 나이트 | 2클 엑소시스트 | 3클 서번트 |
 * |---|---|---|---|
 * | 1단계 | `3 5 7 5` **5** | `3 5 7 9 11 9` **7** | `3 5 7 9 11 9` **7** |
 * | 2단계 | `3 5 7 5` **5** | `3 5 7 5` **5** | `3 5 7 9 11 9` **7** |
 * | 3단계 | `3 5 7 5` **5** | `3 5 7 5` **5** | `3 5 7 9 11 9` **7** |
 *
 * 곧 원소는 **1단계만 2클부터 R 7 이고, 2단계부터는 3클만 R 7** 이다.
 * 식으로는 `rank > min(level, 1)` — 문턱이 1단계에서 한 번 올라간 뒤 고정된다.
 *
 * ★ 예전에 `rank > level` 로 뒀던 것은 **틀렸다.** 그러면 3단계 서번트이 5 가 되는데
 *   실제로는 **7** 이다 (사용자 확인 2026-08-16).
 *
 * ── **계열마다 다르다** (사용자 확인 2026-08-16: 「회복 3단계 모두 `3575`」) ──
 *
 * | 계열 | 단계 | 1클 | 2클 | 3클 |
 * |---|---|---|---|---|
 * | 원소(0~2) | 1 | 5 | **7** | **7** |
 * | 원소(0~2) | 2·3 | 5 | 5 | **7** |
 * | **회복(3)** | **1** | **5** | **5** | **7** |
 * | **회복(3)** | **2·3** | **5** | **5** | **5** ← 서번트도 5 |
 * | **보조(4)** | **6단계 빼고 전부** | **5** | **5** | **5** |
 * | **암흑(6)** | **1·2·3·5·6단계** | **5** | **5** | **5** |
 *
 * 원소 규칙을 계열 전체에 쓰면 **회복 3단계 3클이 7 로 틀린다.** 그래서 계열을
 * 먼저 가른다.
 *
 * ★★ **여기까지가 「타겟 지정 마법」 전부다** (사용자 확인 2026-08-16:
 *   「지금 우리가 수정한 영역은 **원본을 다 뽑은 거야.** 나머지는 **광역마법과
 *   소환마법**이야. 이부분은 손을 안 댔어.」)
 *
 *   곧 위 표에서 빠진 칸(원소 4단계 이상 · 보조 6단계 · 암흑 4·7단계)은
 *   **미확인이 아니라 애초에 이 함수가 다룰 것이 아니다** — 광역(효과 영역)이나
 *   소환이라 선택 범위를 이렇게 정하지 않는다. 사거리를 정하는 것
 *   목록과 정확히 겹친다. 그 칸들은 `magicRadius` 로 물러나도 **닿지 않는다.**
 *
 * ★★ **타겟 지정 마법은 이걸로 전부 확정됐다** (2026-08-16). 남은 미확인 없음.
 *   회복 1단계만 3클이 7 이고(원소 2·3단계와 같은 모양), 2단계부터 전부 5 로
 *   내려간다 — 「회복은 처음만 넓고 뒤로 갈수록 좁다」.
 *
 * @param {number} r 예전 `magicRadius` 값 — 규칙 밖이면 이것으로 물러난다
 */
/* ☠★★★★★ **이 표는 이제 «쓰지 않는다» — 검산용으로만 남긴다** (2026-09-15)
 *   > 사장님: 「**1로 해야해.** 2는 1과 동일한지 확인만 해야해.」
 *   > 「아마 **2값이 내가 임의로 지정해준 값**일 수도 있어. **전체적인 형태만 보고
 *   >  원본이 맞는거야.**」
 *   사거리는 `magicRadius()`(EXE 식 `0x2952C`·`0x2955D`·`0x28465`)가 낸다.
 *   이 표는 2026-08-16 에 눈대중으로 적어 주신 것이라 **근거가 EXE 가 아니다** —
 *   실제로 69칸 중 **43칸이 EXE 식과 달랐다**(2·3클이 전부).
 *   재는 도구 — `node 04_도구/마법사거리_EXE식_대조.js`
 *   ☐ 지울지는 나중에 정한다. 지금은 대조 기준으로 둔다. */
function 원작마법범위(series, level, rank, r) {
  var s = series | 0, L = level | 0, k = rank | 0;
  if (s === 3) {
    if (L === 0) return (k >= 2) ? 7 : 5;                 // 회복 1단계 — 서번트만 7
    if (L <= 2) return 5;                                 // 회복 2·3단계 — 전부 5
  }
  if (s === 4 && L !== 5) return 5;                       // 보조 — 6단계는 광역이라 제외
  /* 암흑 — 1·2·3·5·6단계(L 0·1·2·4·5). 4·7단계는 광역이라 여기 안 온다 */
  if (s === 6 && (L <= 2 || L === 4 || L === 5)) return 5;
  if (s <= 2 && L <= 2) return (k > Math.min(L, 1)) ? 7 : 5;   // 원소 1~3단계
  /* 그 밖 = 광역·소환(선택 범위를 이렇게 안 정한다) + 회복 1단계(확인 전) */
  return (r | 0) || 5;
}

/** 전방 부채꼴 — 원거리 평타와 같은 계단식 확산(`0x1AF22`). R 은 클래스로 정합니다. */
function frontFan(battle, u, r) {
  return fanCells(battle, u.x, u.y, u.dir, r);
}
/** 전방 3줄 직선 (원소 Lv4 3클래스) — 정면 n칸 × 좌·중·우. */
function front3Row(battle, u, n) {
  var d = DIR[u.dir & 3], out = [];
  for (var s = -1; s <= 1; s++) for (var i = 1; i <= n; i++) {
    var x = u.x + d.dx * i + d.dy * s, y = u.y + d.dy * i + d.dx * s;   // perp=(dy,dx)
    if (inMap(battle, x, y)) out.push({ x: x, y: y });
  }
  return out;
}
/**
 * 방향형 범위 (facing 기준 전방). EXE 0x29722(원소 Lv4): 1클 line 5/1 · 2클 step 4/3 · 3클 line 10/3.
 *   kind 'line' = 폭 width 고정 직선 (프리미티브 0x1A452)
 *   kind 'step' = 계단식 확산, 거리와 함께 폭 증가(최대 width) (프리미티브 0x1AF22)
 *   (마법_타게팅_지오메트리_주소맵.md §2.5. len/width 확정, 계단식 셀분포는 근사)
 */
function dirRange(battle, u, kind, length, width, fromSelf) {
  var d = DIR[u.dir & 3], px = d.dy, py = d.dx, out = [], halfMax = (width - 1) >> 1;
  /* ★ `fromSelf` — **시전자 양옆 칸부터** 시작한다 (i = 0). 시전자 칸 자신은 뺀다.
   *   사용자 확인(2026-08-15) 3클: 「3줄로 … 이때 **시전자 양쪽 옆도 포함**되고」 */
  for (var i = fromSelf ? 0 : 1; i <= length; i++) {
    var half;
    if (kind === 'step') {
      /* ★★ 계단식 확산 `0x1AF22` — **폭이 `width` 에서 2씩 넓어지다 마지막 단만 줄어든다.**
       *
       *   사용자 확인(2026-08-15) 2클: 「정면으로 4칸까지 부채꼴형(**3 5 7 5**)」
       *
       *   `원거리_사거리_투사체.md` 의 부채꼴 규칙(「폭 `1,3,…,2R−3` **마지막만** `2R−5`」)과
       *   **같은 규칙**이고 시작 폭만 다르다 — 원거리는 `ecx = 1`, 마법 Lv4 2클은
       *   `0x2977DD ecx = 3` 이다. R = 4 로 맞춰 보면
       *     원거리(width 1) → 1, 3, 5, **3**
       *     마법  (width 3) → 3, 5, 7, **5**   ← 사용자 확인과 일치
       *   즉 `폭[i] = width + 2(i−1)`, 마지막 단만 `width + 2(len−3)`.
       *
       *   예전엔 `min(i−1, halfMax)` 로 1,3,3,3 을 냈다 — 폭이 안 자랐다. */
      var w = (i === length) ? (width + 2 * (length - 3)) : (width + 2 * (i - 1));
      half = Math.max(0, (w - 1) >> 1);
    } else {
      half = halfMax;
    }
    /* ★★★★★ **짝수 폭은 한쪽으로 한 칸 더** (2026-08-25 · 원본 0x1A452 확정)
     *
     *   반복자를 읽어 보니 폭은 **중심에서 좌우로 나뉘는 게 아니라 한 방향으로 센다** —
     *   ```
     *   0x1A57A  cx = [0xF0B78] / inc / cmp cx, [0xF0B7C](폭) / je → 다음 줄
     *   0x1A4BD  [0xF0B9A] = +1        ; 옆 증분
     *   0x1A4CB  [0xF0B9C] = -(폭-1)   ; 폭을 다 채우면 되돌리는 양
     *   ```
     *   홀수 폭은 호출부가 시작점을 반만큼 밀어 대칭이 되고(마법 3클 `3칸폭` 이
     *   사용자 확인 「시전자 양쪽 옆도 포함」과 맞았다), **짝수 폭은 반이 안 떨어져
     *   한쪽으로 한 칸 치우친다.** 증분이 `+1` 이므로 그 한 칸은 **+ 쪽**이다.
     *
     *   전에는 `halfMax = (2-1)>>1 = 0` 이라 **폭 2 가 폭 1 로 뭉개졌다.** */
    var lo = -half, hi = half;
    if (kind !== 'step' && (width & 1) === 0) { lo = -(width / 2 - 1); hi = width / 2; }
    for (var s = lo; s <= hi; s++) {
      if (i === 0 && s === 0) continue;                 // 시전자 칸 자신은 제외
      var x = u.x + d.dx * i + px * s, y = u.y + d.dy * i + py * s;
      if (inMap(battle, x, y)) out.push({ x: x, y: y });
    }
  }
  return out;
}
/**
 * 원소 Lv4 클래스별 방향형 파라미터 (EXE `0x29722`). rank 0/1/2 = class 1/2/3.
 *
 * 사용자 확인(2026-08-15) — 타겟 지정 없이 방향으로 쏜다.
 *   1클 정면 **직선 5칸**, 불덩어리 **1개**가 줄을 따라 이동
 *   2클 정면 **4칸** 부채꼴 **3·5·7·5**, 불덩어리가 **줄 단위로** 3개 5개 7개 5개
 *   3클 정면 **7칸 이상**(스크롤이 안 돼 끝 확인 불가) **3줄**, **시전자 양옆 포함**,
 *       불덩어리 **3개**가 끝까지 진행
 *
 * 3클 길이 10 은 `0x29780D push 0xA` 직독값이다(사용자가 못 센 「7칸 이상」과 어긋나지 않는다).
 */
var DIR4 = [{ kind: 'line', len: 5, wid: 1 },
            { kind: 'step', len: 4, wid: 3 },
            { kind: 'line', len: 10, wid: 3, fromSelf: true }];
/** 맵 전체. */
function wholeMapCells(battle) {
  var out = [];
  for (var y = 0; y < battle.H; y++) for (var x = 0; x < battle.W; x++) out.push({ x: x, y: y });
  return out;
}
/** 가로 밴드 — 화면 수평 방향으로 폭 halfW, 높이 halfH(반) 직사각형. 원소 Lv3 2클래스 효과영역(관측: 스크린샷 가로밴드). */
function hBand(battle, cx, cy, halfW, halfH) {
  var out = [];
  for (var dy = -halfH; dy <= halfH; dy++) for (var dx = -halfW; dx <= halfW; dx++) {
    var x = cx + dx, y = cy + dy;
    if (inMap(battle, x, y)) out.push({ x: x, y: y });
  }
  return out;
}
/**
 * 마법 효과영역 셀 — 선택지점(cx,cy) 중심. 클래스(rank)별로 형태 전환.
 *
 * ★★★ 원소 Lv3(series≤2, level 2) — **원본 확정 (2026-08-16)**
 *
 * 사용자 확정: 「3단계 마법 원본기준 효과 범위야. **1클 1 3 5 7 5 3 1**,
 * **2클 9 9 9**, **3클 1 3 5 7 9 11 9 7 5 3 1**」 → EXE 로 전부 대조했고 일치한다.
 * (점검 문서 §3-2 의 「효과 영역 ↔ 이펙트 영역 중 어느 쪽이 원본이냐」에 대한 답 —
 *  **이펙트 영역 쪽이 원본**이었고, 효과 영역이 좁게 들어가 있었다.)
 *
 * ── 1클·3클 : 마름모 (`0x29514` → `0x28A97` → 반복자 `0x1AC08`/`0x1AC59`)
 * ```asm
 * 0x29552  mov eax, [esp+0xc]      ; 진입 시 dx = 클래스(0·1·2)
 * 0x29560  add eax, 0x3            ; ★ 반경 = 클래스 + 3
 * 0x2956b  movsx edi, ax
 * 0x295a3  mov ebx, edi            ; 0x28A97 의 반경 인자
 * 0x295b0  call 0x28a97
 * ```
 * → 1클 r=3 (`1 3 5 7 5 3 1`) · 3클 r=5 (`1 3 5 7 9 11 9 7 5 3 1`). 딱 맞는다.
 * 예전 값 r=2·r=4 는 **한 단계씩 좁았다**.
 *
 * ── 2클 : 방향 밴드 (`0x29526 cmp dx,1 ; jne` → `0x28C8A`)
 * ```asm
 * 0x28ca4  mov al, [ebx+0x63]      ; ★ 시전자 방향 (유닛+0x63)
 * 0x28cb0  jmp [eax*4+0x18c7a]     ; 방향 4갈래 점프테이블
 *          → 오프셋 (dx,dy) 에 ±4 를 넣는다: (-4,0) (0,-4) (+4,0) (0,+4)
 * 0x28d20  mov ax, [ebp]  / 0x28d28  add eax, edx   ; 중심 = 선택칸 + 오프셋
 * 0x28d30  mov ax, [edi]  / 0x28d36  add eax, ecx
 * 0x28d38  mov ecx, 0x9            ; ★★ 길이 9
 * 0x28d2a  mov ebx, [esi+0x60] / sar 0x18           ; = [유닛+0x63] 방향을 반복자에도
 * 0x28d13  push 0x3                ; ★★ 두께 3
 * 0x28d3e  call 0x1a452            ; 사각 영역 반복자 (0x1a552 로 순회)
 * ```
 * → **9 × 3**, 방향에 따라 회전하고, 중심이 **방향으로 4칸** 밀린다.
 *   폭 9 의 절반이 4 이므로 **선택한 칸이 영역의 앞끝**이 된다 — 점검 §3-3 의
 *   「클릭한 곳이 중간이 아니라 선택한 지점 뒤로 펼쳐져야 한다」가 이것이다.
 *
 * @param {object} [시전] 시전자 — 2클 방향(`[유닛+0x63]`)에 쓴다.
 */
function aoeShape(battle, cx, cy, series, level, rank, radiusOf, 시전) {
  rank = clamp(rank | 0, 0, 2);
  if (series <= 2 && level === 2) {                          // 원소 Lv3 타겟광역
    if (rank === 1) {                                        // 2클 — 0x28C8A
      var d = DIR[(시전 && 시전.dir | 0) & 3] || { dx: 0, dy: 0 };
      /* ★★ 벽은 **타겟 지점부터** 시작한다 (2026-08-16 정정).
       *
       *   사용자 지적: 「2클은 범위는 맞는데 **위치가 잘못**되었어.
       *   **타겟 지점부터 시작**해야 해. 지금은 타겟 지점 **뒤에서** 시작해.」
       *
       *   진행축 두께가 3 이므로 중심을 방향으로 **1칸**만 밀면 선택칸이 벽의
       *   **앞끝**이 된다. 점프테이블의 `±4`(`0x28CB0`)를 그대로 넣었더니 벽이
       *   선택칸에서 4칸 떨어져 사이가 두 칸 비었다 — `±4` 는 폭 9 축을 재던
       *   값으로 보이고, 진행축(두께 3)에 쓸 값이 아니었다.
       *   ★★★★★ **`±4` 의 쓰임을 읽었다 (2026-08-29)**
       *     `0x28CB0  jmp [eax*4 + 0x28C7A]` — 방향 **4칸 점프표**다.
       *     | 방향 | 갈래 | 하는 일 |
       *     |---:|---|---|
       *     | 0 | `0x28CB8` | `eax = −4` · `[esp+0xC] = edx` · `[esp+8] = −4` |
       *     | 1 | `0x28CC7` | `ecx = −4` · `[esp+8] = edx` · `[esp+0xC] = −4` |
       *     | 2 | `0x28CCE` | `eax = +4` · (0 갈래와 같은 자리로 합류) |
       *     | 3 | `0x28CD5` | `ecx = +4` · `[esp+8] = edx` · `[esp+0xC] = +4` |
       *     ⇒ **한 축에는 `±4` 상수**, 다른 축에는 `edx`(반복 변수)를 넣는다.
       *       곧 중심에서 그 방향으로 **4칸 민 자리**가 기준이고,
       *       나머지 축을 `edx` 로 훑어 길이 9 를 만든다.
       *     ☠ 그런데 **화면 관측은 1칸이 맞았다**(사용자 2026-08-16 「타겟 지점부터」).
       *       어긋남이 남아 있다 — `edx` 의 범위와 뒤 `0x28CE4` 검사를 더 봐야 한다.
       *       그때까지 **화면에 맞는 1칸**을 쓴다(사용자 관측이 이긴다). */
      var bx = cx + (d.dx | 0), by = cy + (d.dy | 0);
      /* ★★ 길이 9 는 **바라보는 방향에 수직**이다 — 방향으로 9칸 뻗는 게 아니라
       *   **가로로 넓은 벽**이 선다 (2026-08-16 정정).
       *
       *   사용자 지적: 「2클래스 범위 잘못됐어. 바라보는 방향 기준 **세로로
       *   길쭉하게가 아니라 가로로 길쭉하게**야.」
       *   원소 3단계 2클의 이름이 Fire **Wall** / Ice **Wall** / Energy **Wall**
       *   인 것과도 맞는다 — 벽이니 진행 방향으로 두께 3, 옆으로 9칸이다. */
      return (d.dx | 0) ? hBand(battle, bx, by, 1, 4)        // 좌·우 봄 → 세로 9 × 가로 3
                        : hBand(battle, bx, by, 4, 1);       // 위·아래 봄 → 가로 9 × 세로 3
    }
    return diamond(battle, cx, cy, 3 + rank, true);           // 1클 r=3 · 3클 r=5
  }
  /* ★ `radiusOf` — 기술자가 준 반경을 **그대로 쓴다**. 예전엔 이걸 무시하고 늘
   *   `1 + rank` 를 썼는데, 그러면 회복3 이 2·3(13칸·25칸)이 되어 실측과 어긋난다.
   *
   *   사용자 실측(2026-08-15) 회복3 Cure — **1클 단일 · 2클 5칸 · 3클 13칸(줄별 1·3·5·3·1)**.
   *   `magicTargeting` 회복 Lv3 의 `radiusOf: byRank` 가 `rank` 를 그대로 내므로
   *     rank 0 → 반경 0 = **1칸(단일)** · rank 1 → **5칸(십자)** · rank 2 → **13칸(마름모)**
   *   로 정확히 떨어진다. 특별 분기가 필요 없다 — 반경만 제대로 넘기면 된다. */
  var r = radiusOf ? (radiusOf(rank) | 0) : (1 + rank);
  return diamond(battle, cx, cy, r, true);
}

/**
 * 스펠 타게팅 기술자 — 선택방식·관계·효과범위·형태. (마법_타게팅_사양.md, level 0-based)
 * @returns {{select,relation,effect,radiusOf,dirShape}}
 *   select   'target'|'selfArea'|'summon'|'whole'|'reviveList'
 *   relation 'enemy'|'ally'|'empty'|'dead'|'both'
 *   effect   'single'|'aoe'|'all'   · radiusOf(rank) · dirShape 'line'|'fan'|'row3'
 */
/* ☠☠★★★★★ **1클래스도 «범위» 마법이다 — 범위가 1일 뿐이다** (2026-09-15 · 사장님 지적)
 *
 *   > 사장님: 「**한번더 클릭**하게 되어있네. **범위 설정마법인데 범위가 1**로 되어있어」
 *   > 「**타겟 범위로 전환해서 돌려야해. 모두**」
 *   > 「예를들면 **컨퓨즈 1단계가 타겟 지정했을때 1명 범위가 표시되어서 한번 더 클릭**했던 것 같은」
 *
 *   ☠ 여태 `rank > 0 ? 'aoe' : 'single'` 이라 **1클만 «단일»** 이었다. 그러면 칸을 고르는
 *     것이 아니라 유닛을 바로 집어 **확정 클릭이 한 번 빠진다.**
 *   ★ 원본 실측 — 147칸을 실제로 쏴 보니 아래 여덟 칸이 **1클도 두 번 눌러야** 나갔다.
 *     한 번만 누르면 「안 나감」이 된다 (2026-09-15 · `05_결과/굽기/마법GIF/_원장.json`).
 *       회복3 Cure 69 · 보조1 PowerUP 84 · 보조2 SpeedUP 87 · 보조3 MagicArmor 90 ·
 *       보조4 Bless 93 · 보조5 Silence 96 · 보조7 Curse 102 · 암흑1 Confuse 126
 *   ⇒ 세 클래스 모두 `aoe` 다. 반경은 그대로 `byRank`(0·1·2) — **1클은 반경 0 = 한 칸**이다.
 *   ★ 재는 도구 — `node 04_도구/마법발동방식_원본대조.js` (147칸 유형 대조)
 */
function magicTargeting(series, level, rank) {
  rank = clamp(rank | 0, 0, 2);
  var byRank = function (r) { return r; }, aoe1 = function (r) { return 1 + r; },
      /* ★★★★★ 자기광역 다이아 반경 = **클래스 × 2 + 3** (EXE `0x2A202`) — 3/5/7
       *   ☠ **2026-09-09 정정** — 전에는 `(rank + 1) × 2 + 3` 으로 5/7/9 를 냈다.
       *     주석에 「class = rank + 1」이라 적혀 있었지만 **원본 근거가 없는 해석**이었다.
       *   ★ 원본은 그 값을 **배열 색인**으로 쓴다 —
       *     `0x4C6D7 ebx = [esp]` · `0x4C6DD mov eax,[eax + ebx*4 + 0x7423C]` ·
       *     `0x4C6EC movsx edx, ax` 로 **그대로** `dx` 가 되어 `0x2A202` 에 들어간다.
       *     `0x7423C` 는 **147칸 마법 이름표**(`표/json/마법_이름_원본대조.json`)이고
       *     `147 = 49마법 × 3클래스` · 색인 = `마법번호 × 3 + ebx` 이므로 **ebx 는 0·1·2**.
       *   ⇒ 클래스는 **0 기준**이다. 근거: `03_분석/_보관/끝난조사/00_지금조사_기타.md`
       *   + 장비보정(`[caster+0x5B]` · `0x28465`) · 그 보정은 여기서 생략. */
      selfR = function (r) { return r * 2 + 3; };
  var E = 'enemy', A = 'ally';
  if (series <= 2) {                                        // 화염·빙한·전격
    switch (level) {
      case 0: return { select: 'target', relation: E, effect: 'single' };
      case 1: return { select: 'target', relation: A, effect: 'single' };            // 무기 속성부여
      /* 원소 Lv3 — 타겟 지정 광역(`0x29514` → 착탄점 `0x28A21`). 칸을 고르고
       *   그 주위로 효과가 펼쳐진다. 빈 칸에 떨어뜨려도 둘레의 적이 맞는다. */
      case 2: return { select: 'target', relation: E, effect: 'aoe', radiusOf: aoe1 };
      case 3: return { select: 'selfArea', relation: E, effect: 'all', dir4: DIR4[rank] };   // Lv4 방향형 EXE 0x29722
      case 4: return { select: 'summon', relation: 'empty' };
      case 5: return { select: 'selfArea', relation: E, effect: 'all', radiusOf: selfR, 무기보정: true };   /* 0x2B8EA → 0x2A1C6 */
      case 6: return { select: 'whole', relation: E, effect: 'all' };
    }
  }
  if (series === 3) {                                       // 회복
    switch (level) {
      /* ★ 힐·와이드힐 = 관계 'heal' — «적대가 아니거나 언데드» (2026-10-11 사장님 「언데드몬스터에게 힐, 와이드힐 데미지가 안들어가는 문제 …
       *   적한테도 사용이 가능해야하고 아군에게 써도 체력이 소모되어야해(아슈람)」)
       *   힐 0x2AE44: 0x2AF22 call 0x1201D(적대) == 1 이면 0x2AF2D cmp [+0x0D],2 — 언데드일 때만 받는다 · 적대 아니면 늘 받는다
       *   와이드힐 0x2BA8E: 0x2AF53 «적대 아님·언데드 아님»(0x2AFC3 · 0x2AFCD) 회복 → 0x2AFE0 «언데드»(0x2B024 · 편 안 봄) 피해 (0x2ACCB 0x2AD04) */
      case 0: return { select: 'target', relation: 'heal', effect: 'single' };
      case 1: return { select: 'target', relation: 'heal', effect: 'aoe', radiusOf: aoe1 };
      case 2: return { select: 'target', relation: A, effect: 'aoe', radiusOf: byRank };
      case 3: return { select: 'selfArea', relation: E, effect: 'all', radiusOf: selfR, 무기보정: true };   // 언데드 즉사 · 0x2A1C6
      case 4: return { select: 'whole', relation: A, effect: 'all' };
      case 5: return { select: 'reviveList', relation: 'dead' };
      case 6: return { select: 'whole', relation: 'both', effect: 'all' };
    }
  }
  if (series === 4) {                                       // 보조
    if (level <= 3) return { select: 'target', relation: A, effect: 'aoe', radiusOf: byRank };
    if (level === 4) return { select: 'target', relation: E, effect: 'aoe', radiusOf: byRank };
    /* ★★★★★ **리바이블은 칸을 고르지 않는다** (2026-09-08 · 사장님 지적 M18)
     *   > 「범위 표시 없이 바로 발동해야하는데, 지금은 시전자 주변 2바퀴 범위 표시가 나와」
     *   원본은 **사망자 목록**(`0x66620`)에서 되살릴 사람을 집는다
     *   (`scecontext.js:240` `0x1DDA1 mov eax,0x66620` → `0x1134F` 로 사망자 목록에 넣는다 ·
     *    `battle_main.js:8688` 그룹 5 → `[0x66620]`).
     *   그리고 연출 함수 `0x59A70` 안에 범위를 칠하는 `0x13D02` 가 **한 번도 없다**.
     *   ☠ 효과 범위는 그대로 둔다 — 원본이 몇 명을 되살리는지 아직 못 읽었다. */
    /* ☠★★★★★ **여기 리바이블 규칙이 잘못 들어 있었다** (2026-09-09 바로잡음)
     *
     *   > 사장님: 「**배리어 사용이 안돼. 클릭해서도 안되고 주문으로도 안돼.**」
     *
     *   ☠ 이 줄이 `select:'reviveList' · relation:'dead'` 였다. 그러면
     *     `combat.js` 의 「되살릴 사람이 없다」 가드(`0x2B272`)에 걸려
     *     **죽은 아군이 없으면 배리어가 아예 안 나간다.**
     *     차징으로 TP 240 을 채워도 `ok:false` 였다(실측).
     *
     *   ★ **계열을 잘못 짚은 것이다** — 마법 이름표를 직접 읽어 갈랐다:
     *     계열 3(회복) 단계 5 = **Revible** (마법 78)
     *     계열 4(보조) 단계 5 = **Barrier** (마법 99)
     *   리바이블 규칙은 위 회복 갈래(`case 5`)에 **이미 제대로** 있다.
     *
     *   ★ 배리어는 **제자리 둘레 광역 버프**다 — `magicfx.js:2502` 가
     *     `0x26930`~`0x26AB6` 을 전수로 보고 적어 둔 결론:
     *     「보조 Lv6 의 **`selfArea` 반경**」
     *   ☠ **2026-09-09 정정** — 그 결론이 적은 `(rank+1)*2+3` = 5·7·9 는 **틀렸다.**
     *     클래스는 **0 기준**이라 `rank*2+3` = 3·5·7 이고, 배리어는 거기서 −2 해
     *     **1·3·5** 다. 근거는 아래 주석과 `03_분석/_보관/끝난조사/00_지금조사_배리어범위.md`.
     *     (`마법_타게팅_사양.md:58` 「Lv 6 광역 버프 — 제자리 둘레 몇 바퀴」도 같다)
     *   ★ 버프이므로 대상은 **아군**(`A`)이다 — 위 `level <= 3` 줄들과 같다. */
    /* ★★★★★ **배리어는 반경이 2 칸 좁다** — `클래스×2 + 1` (2026-09-09)
     *
     *   > 사장님: 「배리어 범위가 너무커 캐릭터 **5바퀴**인데 우리는 **9바퀴**」
     *   > 사장님 코멘트: 「캐릭터 주변 **효과 영역 타일** 이야기하는거야.」
     *
     *   실행함수표(`표/json/실행함수표.json`) — **보조 6단계 = `0x2BF08`**.
     *   그 함수를 바이트로 풀면 —
     *     `0x2BF25  mov ebx, 4`   ★ 셋째 인자 = **4**
     *     `0x2BF2A  jmp 0x2B8EA`  ☆ **call 이 아니라 jmp** 라 호출부 찾기에 안 잡혔다
     *   `0x2B8EA` 가 `call 0x2A1C6` 자리이고 `0x2A1D1 edi = ebx` → **`di = 4`**.
     *   반경 계산(`0x2A202`~`0x2A21E` 바이트 직독) —
     *     `0x2A205 add eax,eax` · `0x2A207 add eax,3`   → 클래스×2 + 3
     *     `0x2A218 cmp di,4` · `0x2A21E sub ebx,2`      ★ **di == 4 면 −2**
     *   ⇒ 배리어 = **클래스×2 + 1** — 클래스가 **0·1·2** 이므로 **1 · 3 · 5**
     *   ☠ **2026-09-09 정정** — 전에는 「1클 3 · 2클 5 · 3클 7」이라 적었다.
     *     selfR 이 (r+1)×2+3 이라 한 칸씩 밀려 있었기 때문이다.
     *     사장님 「**5바퀴**」가 **3클 5칸**과 맞고, 「우리는 9바퀴」도
     *     고치기 전 값 (2+1)×2+3 = 9 와 맞는다 — **3클을 보고 말씀하신 것**이다.
     *   ☠ 같은 `selfR` 를 쓰는 다른 마법은 `di` 가 4 가 아니라 **안 건드린다**. */
    if (level === 5) return { select: 'selfArea', relation: A, effect: 'all', 무기보정: true,
                              radiusOf: function (r) { return selfR(r) - 2; } };   /* 0x2A21E sub ebx,2 */
    /* ★★★★★ **보조 7단계(커스)는 「적」이다** — 2026-09-06 원본 확정
     *
     *   > 사장님: 「커스 … 이펙트 대상도 **본인이 아니라 효과를 적용받는 적 모두**이고,
     *   >  **적군 수만큼 효과가 반복**되어야해.」
     *
     *   ☠ 여태 이 줄이 `relation: A`(아군)였다. 그래서 아군만 모이고, 곁에 아군이
     *     없으면 **시전자 자신**이 잡혔다 — 그것이 「대상이 본인」의 정체다.
     *
     *   ```asm
     *   0x2BF2F  mov ebx, 0x2000            ; 커스 상태 비트 (보조 함수표 [0xF1438])
     *   0x2B3A8  test byte [esp+0x11], 0x28 ; ★ 0x2000 의 상위 바이트 0x20 → setne al = 1
     *   0x2B3FB  movsx ecx, si              ;   그 1 을 **관계**로 넘긴다
     *   0x2B40E  call 0x28A97               ;   대상 수집 (ebx = 반경 · ecx = 관계)
     *     0x28B0B  call 0x1201D             ;     관계 판정 — **적대면 ah = 1**
     *     0x28B10  cmp ax, cx ; jne         ;     ★ 넘긴 관계와 같아야 담는다
     *     0x28B17  call 0x28596             ;     담는다
     *   ```
     *   ⇒ `cx == 1` = **적**. 커스는 적을 모은다.
     *
     *   ★ 반경은 `0x28A97` 의 `ebx`(진입점 두 번째 인자)다. 다른 보조 마법과 같은
     *     자리이므로 `radiusOf: byRank` 는 **그대로 둔다** — 바꿀 근거를 아직 못 찾았다.
     *     여럿이 걸리면 연출이 **대상 수만큼** 돈다
     *     (`0x2B53E inc esi / cmp si,[0xF0B9E] / jl` · `magicfx.js` `column:`). */
    if (level === 6) return { select: 'target', relation: E, effect: 'aoe', radiusOf: byRank };
    return { select: 'target', relation: A, effect: 'aoe', radiusOf: byRank };
  }
  /* ☠★★★★★ **대형 소환수는 자리 계산이 다르다** (2026-09-15 · 사장님 지적)
   *   > 「**소환마법도 소환영역 표시되는 범위가 달라.** 소형몬스터와 대형몬스터 소환시
   *   >  소환 영역이 다른데 **우리 실행기는 동일하게 되어있어.**」
   *   원본 `0x29F77 cmp cx,4 / cmp cx,6` — 소환 종류 **4~6 이면 `0x29D88`**(대형),
   *   아니면 `0x29C5A`(소형). 4~6 은 직업 이름표(`0x71118+job×16`)로 읽어
   *   **Ogre · Fire Golem · Gargoyle** — 소환 계열 **5·6·7단계**(level 0기준 4·5·6)다.
   *   (근거 전문 — `03_분석/COMBATII/소환수_생성_0x299DA.md` §3-b)
   *   ☠ `대형` 을 안 넘겨 주고 있었다. `summonTiles` 에 갈래는 있는데 늘 소형으로 돌았다. */
  if (series === 5) return { select: 'summon', relation: 'empty', 대형: level >= 4 };
  if (series === 6) {                                       // 암흑
    switch (level) {
      case 0: return { select: 'target', relation: E, effect: 'aoe', radiusOf: byRank };
      case 1: return { select: 'target', relation: E, effect: 'single' };
      case 2: return { select: 'target', relation: E, effect: 'single' };            // Death
      /* ★★★★★ **소울리콜은 소환 갈래가 맞다 — 다만 대상이 없으면 안 나간다**
       *   (2026-09-08 · 사장님 지적 M32)
       *   ☠ 한때 `reviveList` 로 바꿨는데 **틀렸다.** 근거로 삼은 `0x2B1D0` 은
       *     소울리콜이 아니라 **상태 처리**였다(`0x2B2EB call 0x25C88` = 큐어).
       *   진짜 처리는 `0x2C36A` 이고 **소환 자리 잡기를 그대로 부른다** —
       *   ```asm
       *   0x2C380  call 0x113DD        ; 사망자 목록에서 하나 꺼낸다
       *   0x2C385  test eax,eax
       *   0x2C387  jne 0x2C393         ;   있으면 진행
       *   0x2C389  eax = -1            ; ★ 없으면 -1 로 나간다 = 시전 안 됨
       *   0x2C39B  call 0x29C5A        ;   자리는 소환과 같은 창구
       *   ```
       *   ⇒ 갈래는 `summon`, 대신 `relation: 'dead'` 로 **대상 없으면 취소**를 건다. */
      case 3: return { select: 'summon', relation: 'dead' };                         // Soul Recall — 0x2C36A
      case 4: return { select: 'target', relation: E, effect: 'single' };
      /* ★ 반경 = 랭크 + 3 (3·4·5) — 원본 0x2C566 dx(랭크 0..2) → 0x2C577 add eax,3 → 0x28B24 수집 반경 · 마법효과_시스템.md «반경 dx+3»
       *   ☠ 2026-10-12 정정 — 예전 2 + 랭크(2·3·4)라 한 칸 좁았다. AI(0x2C575 → ai.js AI_419F1 반경 k+3)는 원본 반경으로 겨눠
       *   «맞는다»고 쏘는데 효과가 빗나가 블랙홀이 엉뚱한 데 떨어진 것처럼 보였다 (사장님 「안내인이 블랙홀을 사용했는데, 위치가 이상해」) */
      case 5: return { select: 'target', relation: E, effect: 'aoe', radiusOf: function (r) { return 3 + r; } };  // Black Hole
      case 6: return { select: 'selfArea', relation: E, effect: 'all', radiusOf: selfR, 무기보정: true };   // Armageddon · 0x2C63B → 0x2A1C6
    }
  }
  return { select: 'target', relation: E, effect: 'single' };
}

/**
 * ★★ **선택 방식** — 원본은 「고르는 것」과 「효과가 닿는 것」이 **다른 시스템**이다.
 *
 * 사용자 확인(2026-08-15): 「타겟 지정 마법, 타겟 지정 광역 마법, 광역 마법 이런식으로
 * 분류할 수 있어. 쉽게 이야기하면 **타겟을 지정하는 시스템과 효과가 적용되는 시스템이
 * 다르다**는 거야. … 광역 마법은 효과 범위를 보여주고 **아무데나 클릭하면 발동**이
 * 되어야해. 그런데 지금은 광역 마법인데 타겟을 지정하는 등 꼬여있어.」
 *
 * 원본이 정확히 그 구조다.
 *
 * 사용자 확인(2026-08-15): 「마법 종류에 따라 **적군 1인 타겟팅, 아군 1인 타겟팅,
 * 필드(타일) 타겟팅, 타겟팅 필요 없음** 이런 것들이 필요한데 현재 구분이 잘
 * 안되어있어. 특히 **필드 타겟팅은 전혀 안되는** 걸로 알고있어.」 — 그 네 갈래다.
 *
 * | 분류 | `pick` | 원본 | 고르는 것 | 표시 배열 |
 * |---|---|---|---|---|
 * | **적군 1인** | `'enemy'` | 단일 gather `0x28982` (`[0x74492]`==1 → 커서 칸의 유닛) | 적 **유닛** | 선택범위(부채꼴 사거리) |
 * | **아군 1인** | `'ally'` | 〃 (관계 판정 `0x1201D` 만 다르다) | 아군 **유닛** | 〃 |
 * | **필드(타일)** | `'field'` | 착탄점 `0x28A21` (`0x28A1F` **`xor ecx,ecx`**) | 사거리 안 **아무 칸** | 선택범위 — **효과영역과 다르다** |
 * | **필요 없음** | `'none'` | 선택 루틴이 **아예 없다** (`0x29722` 방향형 · `0x2A1C6` 자기광역 · 전체맵) | — (발동 확인일 뿐) | 효과 범위 |
 *
 * ★ **필드 타게팅이 전혀 안 되던 이유**가 이것이다 — `selector.js` 가 `relationOk`
 *   로만 걸러 **유닛이 선 칸만** `legal` 이었다. 원본은 `ecx == 0` 이라 빈 칸도
 *   확정되고, 효과 대상은 그 **칸**을 중심으로 뒤에 모은다.
 *
 * ★ `0x4A483` 의 `ecx` 가 **0(무제한)** 이라는 것이 핵심이다(`명령_공통대역.md` §2·§4).
 *   `ecx == 1`(제한) 이었다면 「남의 유닛 칸엔 상자가 안 뜨는」 돌진·워프처럼 굴었겠지만,
 *   마법 착탄점은 `xor ecx,ecx` 라 **어느 칸이든 확정된다.** 유닛 유무를 보지 않는다.
 *   효과 대상은 확정 **뒤에** `0x2A75A`(±6 스캔) · `0x28A97`(마름모) · `0x42743`(필터)
 *   가 따로 모은다 — 그 몫이 `gatherMagicTargets()` 다.
 *
 * @param {object} tg `magicTargeting()` 이 낸 기술자
 * @returns {'enemy'|'ally'|'field'|'none'}
 */
function magicPick(tg) {
  if (!tg) return 'enemy';
  /* 자기중심·방향형·전체맵 = 고를 것이 없다. 효과 범위를 보여 주고 확인만 받는다. */
  if (tg.select === 'selfArea' || tg.select === 'whole') return 'none';
  /* ★ 소환 = **고르지 않는다.** `0x29F4D` 에 칸 선택기 호출이 아예 없고, 자리는
   *   시전자 방향 기준 정면/좌/우로 자동이다(`0x29C5A`). 후보 칸을 칠하고
   *   `0x29FC6 call 0x4A815` 로 확인만 받는다 → 「타게팅 필요 없음」. */
  if (tg.select === 'summon') return 'none';
  /* ☠☠★★★★★ **리바이블은 고르지 않는다 — 바로 발동이다** (2026-09-15 원본 실측)
   *   > 사장님 (2026-09-08): 「**범위 표시 없이 바로 발동해야하는데**, 지금은
   *   >  시전자 주변 2바퀴 범위 표시가 나와」
   *   원본에서 리바이블 1·2·3클(칸 78·79·80)을 실제로 쏴 보니 **클릭 한 번**으로 나갔다
   *   (2026-09-15 · `05_결과/굽기/마법GIF/_원장.json` — 유형 a 바로발동).
   *   `magicTargeting` 주석에도 이미 근거가 적혀 있다 — 원본은 **사망자 목록**(`0x66620`)
   *   에서 집고, 연출 함수 `0x59A70` 안에 범위를 칠하는 `0x13D02` 가 **한 번도 없다.**
   *   ☠ 여기가 `'field'` 라서 칸을 고르라고 했고 **확정 클릭이 한 번 더 붙었다.**
   *   ★ 재는 도구 — `node 04_도구/마법발동방식_원본대조.js` */
  if (tg.select === 'reviveList') return 'none';
  /* ★★ **타겟 지정 광역 = 칸을 고르고, 그 주위로 효과가 펼쳐진다.**
   *
   *   사용자 확인(2026-08-15): 「타겟 지정 영역이 나오면 거기에서 **한 지점을 내가
   *   클릭하면 그 주위로 마름모가 펼쳐져야** 해.」
   *
   *   ★ 「적군 타겟 / 아군 타겟」은 **효과가 걸리는 대상의 관계**를 말한 것이지
   *     선택 방식이 아니다. 사일런스가 「범위는 큐어 동일, 단 적군 타겟」인 것은
   *     **고르는 방식은 큐어와 같고(칸) 효과 필터만 적**이라는 뜻이다.
   *     — 한때 이걸 「유닛을 고른다」로 잘못 읽어 되돌렸다(2026-08-15).
   *
   *   원본도 그렇다 — 착탄점 `0x28A21` 이 `0x28A1F xor ecx,ecx`(무제한)로 **칸**을
   *   내고, 효과 대상은 그 뒤에 `0x2A75A`/`0x28A97`/`0x42743` 가 **관계를 보며** 모은다.
   *   고르는 것과 맞는 것이 갈려 있다.
   *
   *   단일(`effect: 'single'`)만 유닛을 직접 고른다 — `0x28982`(커서 칸의 유닛). */
  if (tg.effect && tg.effect !== 'single') return 'field';
  /* 1인 타게팅 — 관계로 적/아군을 가른다 (`0x1201D` 진영 판정). */
  return (tg.relation === 'ally' || tg.relation === 'dead' || tg.relation === 'heal') ? 'ally' : 'enemy';
}

/** 칸을 고르는 갈래인가 — `selector` 의 `pickAny`(= `0x4A483` `ecx == 0`) 조건. */
function magicPicksTile(pick) { return pick === 'field' || pick === 'none'; }

/**
 * **효과 영역** 미리보기 — 커서가 놓인 칸 기준으로 실제 피해가 닿는 칸들.
 *
 * 선택범위(`rangeOf`)와는 **다른 도형**이다. 할일 10번의 「타겟 지정 마법이 타겟
 * 범위가 아니라 효과 범위(마름모)로 표시됨」은 이 둘을 안 갈라서 생긴 것이다.
 *
 * @param {object} at `{x, y}` 커서 칸 (광역이면 무시하고 시전자 기준)
 * @returns {Array} `[{x, y}]` — 없으면 빈 배열
 */
function magicEffectCells(battle, u, spell, at) {
  var p = spellParts(spell | 0), tg = magicTargeting(p.series, p.level, p.rank);
  var pick = magicPick(tg);
  /* 소환 — 후보 칸은 시전자 방향 기준 정면/좌/우 `rank+1` 개 (`0x29C5A` → `0x13D02`).
   *   ★ 대형은 **두 칸**을 차지하므로 `발자국` 으로 가까운 칸까지 칠한다 (`XXO`). */
  if (tg.select === 'summon')
    return summonTiles(battle, u, null, (p.rank | 0) + 1, !!tg.대형, { 발자국: true });
  /* ☠★★★★★ **되살리기는 «효과 범위»도 안 칠한다** (2026-09-15 · 사장님 지적)
   *   > 「리바이블 판정 안바뀌었어. **바로 시전되야하는데, 전체 마법처럼 표시가 나와**」
   *   > (2026-09-08 M18) 「**범위 표시 없이 바로 발동**해야하는데, 지금은 시전자 주변
   *   >  **2바퀴 범위 표시**가 나와」
   *
   *   ☠ `rangeOf`(1400행)에는 `reviveList → cells = []` 갈래가 있는데 **여기에는
   *     없었다.** 그래서 아래 `pick === 'none'` 이 기본 마름모(반경 2 = 25칸)를 내고,
   *     그것이 「자기중심」 갈래에서 `rangeContext.cells` 로 들어가 그대로 칠해졌다
   *     (실측 — 칸수 25 · 효과칸수 25).
   *   ★ 원본 근거는 `rangeOf` 쪽과 같다 — 연출 함수 `0x59A70`(리바이블)·
   *     `0x2B1D0`(소울리콜) 안에 칠하기 창구 `0x13D02` 가 **한 번도 없다.** */
  if (tg.select === 'reviveList') return [];
  if (pick === 'none') {
    if (tg.select === 'whole') return wholeMapCells(battle);
    if (tg.dir4) return dirRange(battle, u, tg.dir4.kind, tg.dir4.len, tg.dir4.wid, tg.dir4.fromSelf);   // 0x29722
    return diamond(battle, u.x, u.y, 자기광역반경(battle, u, tg, p.rank), true);
  }
  if (pick === 'field' && at && tg.effect && tg.effect !== 'single') {
    return aoeShape(battle, at.x, at.y, p.series, p.level, p.rank, tg.radiusOf, u);                 // 0x29514 클래스 분기
  }
  return at ? [{ x: at.x, y: at.y }] : [];
}

/** 관계 매칭 — enemy/ally/both. */
function magicRelMatch(rel, u, t, battle) {
  if (!t || !t.alive) return false;
  var foe = hostile(u.side, t.side, battle.confuse);
  if (rel === 'ally') return !foe;
  if (rel === 'heal') return !foe || (t.race | 0) === 2;   /* 힐·와이드힐 0x2AF22·0x2AF2D / 0x2AFC3·0x2B024 */
  if (rel === 'both') return true;
  return foe;                                              // 'enemy' 기본
}
/** 효과 대상 수집 — 타게팅 기술자에 따라 단일/광역/전체. picked = 선택된 유닛/타일. */
/**
 * ★★★★★ **배리어가 걸린 유닛은 마법 대상에서 빠진다** — 0x2A500 (2026-09-08 · 사장님 지적)
 *
 *   > 사장님: 「배리어 효과가 적용되면 **버프도 못받아** … 적이 사용한 공격이나 디버프,
 *   >  **아군이 써준 힐이나 버프** … 전부 안들어가.」
 *   > 「**직접 지정하는 버프의 경우 선택이 안 되고**, 범위 버프나 디버프의 경우
 *   >  범위에 포함되어도 **이펙트와 효과가 패스**돼.」
 *
 *   원본 `0x2A500` 은 `[유닛+0x7B]` 연결 리스트를 도는 **대상 수집 루프**이고,
 *   배리어를 만나면 채택하지 않고 **다음 유닛으로 넘긴다** —
 *   ```asm
 *   0x2A560  edi = [esi+0x7B]                ; 다음 유닛
 *   0x2A568  test byte [esi+0x15], 0x80      ; ★ 배리어인가
 *   0x2A56C  jne  0x2A574                    ; ★★ 배리어면 → esi = edi (건너뛴다)
 *   0x2A56E  cmp  byte [esi+0x5C], 7 / jb    ;   아니면 채택 쪽으로
 *   0x2A574  mov  esi, edi
 *   ```
 *   전수 근거 — `03_분석/COMBATII/상태이상_원본확정.md:318` 「0x2A500 이 배리어 유닛을
 *   후보에서 뺀다 … 「배리어 중에는 어떤 마법도 못 건다」의 근거가 이것」
 *
 *   ☠ 이 파일 아래쪽(`doDamage`)에 **「대상 수집에 넣으면 안 된다 — 회복·버프까지
 *     막힌다」**고 적어 두었었다. **그 판단이 틀렸다** — 사장님이 원하시는 것이
 *     바로 「회복·버프까지 막히는 것」이다(CLAUDE.md §3 ② 결과 피드백이 이긴다).
 *   ★ `[+0x5C] >= 7`(탈것)도 같은 루프에서 빠진다 — `doDamage` 와 같은 조건이다.
 *   ★ 소환·부활(`select: 'summon'`·`'reviveList'`)은 애초에 `[]` 를 내므로 무관하다.
 */
function 배리어제외(list) {
  if (!list || !list.length) return list || [];
  return list.filter(function (t) {
    return !(t && (((t.f15 | 0) & 0x80) || (t.mount | 0) >= 7));   // 0x2A568 · 0x2A56E
  });
}

function gatherMagicTargets(battle, u, p, tg, picked, opts) {
  return 배리어제외(gatherMagicTargets_원(battle, u, p, tg, picked, opts));
}

/**
 * ★★★★★ **선라이트(회복 7) 대상 셋** — 원본 `0x2A75A` 형태 4 (2026-09-24 직독)
 *
 * ```asm
 * 0x2A7F3  cmp bx,4 / je 0x2A811        ; 형태 4 → 중심 = 시전자 칸 [ebp+0]·[ebp+1]
 * 0x2A82D  sub ecx,6 · 0x2A830 sub esi,6
 * 0x2A83D  음수면 0 (0x2A842) · 아니면 맵폭−12 를 넘을 때 맵폭−12 (0x2A846~0x2A865)
 * 0x2A8AE~0x2A901  y 바깥 · x 안쪽, 각각 시작부터 12칸
 *          0x11DB2(칸→유닛) → 0x1201D(적대) → 0x28596(배리어·탑승≥7 제외 · 중복 제외)
 * 0x2A500  진영 1~4 중 적대인 진영의 명부를 돌며 목록에 **없는** 유닛(배리어·탑승≥7 제외)
 * 0x2ABF1  cmp cx,1 / jl 끝             ; 1클(0)은 회복 없음
 * 0x2AC0C  cmp [ebp+0xE],3 / jge        ; 시전자 진영 < 3 이면 명부 1·2 · 아니면 자기 진영 명부
 * 0x2AC27  cmp cl,[edx+0xD]  (cl=2)     ; 언데드 제외 → 0x28596
 * ```
 * ★ 적대 판정은 `hostile()`(= `0x1201D`, 혼란 반전 포함) · 아군 명부는 **진영 번호 그대로**다.
 * @returns {{targets: Array, 모드: Array<'damage'|'silent'|'heal'>}}
 */
function 선라이트대상(battle, u, rank) {
  var 목록 = [], 모드 = [];
  function 빠지나(t) { return ((t.f15 | 0) & 0x80) || (t.mount | 0) >= 7; }   // 0x28596 · 0x2A568
  function 넣기(t, m) { if (t && 목록.indexOf(t) < 0) { 목록.push(t); 모드.push(m); } }
  function 창시작(c, n) {                                                  // 0x2A83D~0x2A865
    var s = (c | 0) - 6;
    if (s < 0) return 0;
    return (s > (n | 0) - 12) ? (n | 0) - 12 : s;
  }
  var W = battle.W | 0, H = battle.H | 0;
  var sx = 창시작(u.x, W), sy = 창시작(u.y, H);
  for (var y = sy; y < sy + 12; y++) {                                     // 0x2A8F2
    for (var x = sx; x < sx + 12; x++) {                                   // 0x2A8E0
      var t = battle.at ? battle.at(x, y) : null;                          // 0x11DB2
      if (!t || !t.alive || 빠지나(t)) continue;
      if (hostile(u.side, t.side, battle.confuse)) 넣기(t, 'damage');      // 0x1201D → 0x28596
    }
  }
  var 유닛들 = (battle.units || []).filter(function (t) { return t && t.alive; });
  for (var j = 1; j <= 4; j++) {                                           // 0x2A515 · 0x2A5AF
    if (!hostile(u.side, j, battle.confuse)) continue;                    // 0x2A529
    유닛들.forEach(function (t) {
      if ((t.side | 0) === j && !빠지나(t)) 넣기(t, 'silent');             // 0x2A563~0x2A572
    });
  }
  if ((rank | 0) >= 1) {                                                   // 0x2ABF1
    var 진영들 = ((u.side | 0) < 3) ? [1, 2] : [u.side | 0];               // 0x2AC0C
    진영들.forEach(function (s) {
      유닛들.forEach(function (t) {
        if ((t.side | 0) === s && (t.race | 0) !== 2 && !빠지나(t)) 넣기(t, 'heal');   // 0x2AC27 · 0x28596
      });
    });
  }
  return { targets: 목록, 모드: 모드 };
}

/** DNA 체인저를 못 받는 대상인가 — 원본 0x2C4E7 그림 300 이상 · 0x2C4F2 이미 커스(0x20) · 0x2C4F7 이미 DNA(0x40) */
function dna못받나(D) {
  return !D || (D.sprIndex | 0) >= 0x12C || ((D.f1e | 0) & 0x60) !== 0;
}
function gatherMagicTargets_원(battle, u, p, tg, picked, opts) {
  var sel = (opts.targets && opts.targets[0]) || picked || null;
  /* ★ **칸이 기준이다.** 원본은 착탄점 `0x28A21` 이 낸 칸 좌표를 효과 수집
   *   (`0x2A75A` ±6 스캔 · `0x28A97` 마름모)에 그대로 넘긴다 — 유닛이 아니다.
   *   `opts.at` 은 `executor.js` 가 `intent.targetTiles[0]` 으로 실어 준 그 칸이다. */
  var at = opts.at || (sel ? { x: sel.x, y: sel.y } : null);
  if (tg.select === 'summon' || tg.select === 'reviveList') return [];   // 생성계 — cast 전처리에서
  if (!tg.effect || tg.effect === 'single') {
    if (sel) return [sel];
    /* 단일인데 유닛을 못 받았으면 **고른 칸에 선 유닛**을 본다 (`0x11DB2` 커서 칸). */
    var one = at ? battle.at(at.x, at.y) : null;
    return (one && one.alive) ? [one] : (opts.targets || []);
  }
  var out = [], rel = tg.relation;
  if (tg.select === 'whole' && p.series <= 2 && p.level === 6) {
    /* ★★★★★ 원소 7단계(메테오·프로미넌스·스타티어러·문라이트·메가/기가/파워썬더)는 «맵 전체»가 아니다 (2026-09-25 · 0x2A75A 전문)
     *   중심 — 0x2A807 call 0x2A6C0: 적 진영 목록을 돌며 권위([+0x43])가 가장 큰 유닛(처음 나온 최대 · 0x2A710 cmp/jge)의 칸
     *          못 찾으면 0x2A811 시전자 칸
     *   범위 — 0x2A825~0x2A89A: x0 = 중심x − 6 · y0 = 중심y − 6 (0 밑이면 0 · 맵폭−12 넘으면 맵폭−12)
     *          0x2A8B4~0x2A8FF: y0 ≤ y < y0+12 · x0 ≤ x < x0+12 칸마다(행 우선) 적대 유닛(0x1201D)을 목록에 넣는다
     *          0x28596: 배리어([+0x15]&0x80)·탈것 7 이상([+0x5C]≥7)은 빼고 같은 유닛은 한 번만
     *   ☠ 예전: 맵 전체 적 — 원본 기록 칸 39·60·62 숫자 루프 대상 1명 ↔ 우리 9명(피격음 난수가 어긋났다)
     *   ★ 목록 밖 적은 상태이상만 받는다(0x2A5BE — 원소 3단계 규칙과 같은 0x28947). */
    var 중심 = null, 최대 = -1;
    (battle.units || []).slice().sort(function (a, b) { return ((a.side | 0) - (b.side | 0)); }).forEach(function (t) {
      if (!t || !t.alive || !magicRelMatch(rel, u, t, battle)) return;
      var c = eff(battle, t).cha | 0;
      if (c > 최대) { 최대 = c; 중심 = t; }                   // 0x2A710 cmp edi,esi ; jge — 더 클 때만
    });
    var cx0 = 중심 ? (중심.x | 0) : (u.x | 0), cy0 = 중심 ? (중심.y | 0) : (u.y | 0);
    var W7 = battle.W | 0, H7 = battle.H | 0;
    var x0 = cx0 - 6, y0 = cy0 - 6;
    if (x0 < 0) x0 = 0; else if (x0 > W7 - 12) x0 = W7 - 12;   // 0x2A83D~0x2A865
    if (y0 < 0) y0 = 0; else if (y0 > H7 - 12) y0 = H7 - 12;   // 0x2A86A~0x2A89A
    for (var yy = y0; yy < y0 + 12; yy++) for (var xx = x0; xx < x0 + 12; xx++) {
      var t7 = inMap(battle, xx, yy) ? battle.at(xx, yy) : null;   // 0x2A8B7 call 0x11DB2
      if (!t7 || !t7.alive || out.indexOf(t7) >= 0 || !magicRelMatch(rel, u, t7, battle)) continue;
      if (((t7.f15 | 0) & 0x80) || (((t7.gear && t7.gear.mount) | 0) >= 7)) continue;   // 0x2859A · 0x285A0
      out.push(t7);                                          // 0x285D3
    }
    return out;
  }
  if (tg.select === 'whole') {                              // 전체 맵
    (battle.units || []).forEach(function (t) { if (magicRelMatch(rel, u, t, battle)) out.push(t); });
    return out;
  }
  var cells;                                                // 범위 셀
  if (tg.select === 'selfArea') {
    if (tg.dir4) cells = dirRange(battle, u, tg.dir4.kind, tg.dir4.len, tg.dir4.wid, tg.dir4.fromSelf);   // Lv4 방향형 (EXE 0x29722)
    else cells = diamond(battle, u.x, u.y, 자기광역반경(battle, u, tg, p.rank), true);
  } else {
    /* 타겟 광역 — **고른 칸**이 중심이다. 유닛이 아니라 칸이므로 빈 칸에 떨어뜨려도
     *   둘레의 적이 맞는다(원본 `0x29514` → `0x28A97`). `at` 을 먼저 본다. */
    var pt = at || sel || picked; if (!pt) return sel ? [sel] : [];
    cells = aoeShape(battle, pt.x, pt.y, p.series, p.level, p.rank, tg.radiusOf, u);  // 클래스별 형태 (원소 Lv3: 마름모 r3 / 방향밴드 9x3 / 마름모 r5)
  }
  var seen = [];
  for (var i = 0; i < cells.length; i++) {
    var t = battle.at(cells[i].x, cells[i].y);
    if (t && seen.indexOf(t) < 0 && magicRelMatch(rel, u, t, battle)) { out.push(t); seen.push(t); }
  }
  /* 와이드힐 — 회복 받을 이(0x2AF53)를 먼저 다 돌고, 그다음 언데드(0x2AFE0)에게 피해 (0x2BB5D → 0x2BB84 → 0x2BBA4) */
  if (rel === 'heal') out = out.filter(function (q) { return (q.race | 0) !== 2; }).concat(out.filter(function (q) { return (q.race | 0) === 2; }));
  return out;
}

/**
 * 사거리 칸 목록.
 * @param {string} kind 'attack' | 'magic' | 'special' | 'counter' | 'move'
 * @param {*} arg  magic → 랭크(또는 {radius}), special → 슬롯, 그 밖 무시
 * @returns {Array} [{x, y, unit, hostile}]
 */
/**
 * 화면에 칠하는 공격 범위 `0x1CC09` 가 «칠 적 판정» `0x1D124`(attackCells)와 다른 무기 — 다르면 칸 목록, 같으면 null
 *   무기 0x11(포병 등): 0x1CC09 → 0x1CF46 — 씨앗 0x1CC4B 0x1A1DE(= 0x1A146 공격 시작 칸)에서 0x1CF57 0x49ABC 한 칸 앞 ·
 *     0x1CF52 ecx = **1**(폭 1) · 0x1CF5C push 7 · 0x1A452 → 0x13D02 칠하기 ⇒ 정면 2~8칸 «한 줄»
 *   0x1D124 쪽은 같은 씨앗에 폭 3(0x1D4C2) — 그것은 칠 적이 있나·AI 용이고, 플레이어는 칠한 한 줄에서 칸을 고른다(0x1F784 → 0x1F19C 0x13CBD)
 *   (2026-11-08 사장님 「저거 확실해? 한줄 아니야?」 — 맞았다 · Genesis2 EXE 직독)
 */
function 공격범위표시칸(battle, u) {
  if (weaponTypeOf(battle, u) !== 0x11) return null;
  return 공중전공격방향으로(battle, u, function () {                       /* 0x1CC13 공중전 남·북 → 서·동 */
    var 시 = 공격시작칸(battle, u), d = DIR[u.dir & 3];
    return 원본직선(battle, 시.x + d.dx, 시.y + d.dy, u.dir, 1, 7);
  });
}
function rangeOf(battle, u, kind, arg) {
  var cells;
  if (kind === 'attack' || kind == null) cells = 공격범위표시칸(battle, u) || attackCells(battle, u);
  else if (kind === 'magic') {
    /* ★ 스펠별 선택범위 (마법_타게팅_사양.md). arg 는 {spell, rank} 또는 랭크값.
     *   타겟계 → 전방 부채꼴, 광역/자기중심 → 자기영역(방향형/다이아), 전체맵/소환 → 각각. */
    var mSpell = (arg && arg.spell != null) ? (arg.spell | 0) : null;
    var mRank = (arg && arg.rank != null) ? (arg.rank | 0) : (arg | 0);
    var r = (arg && arg.radius != null) ? arg.radius : magicRadius(battle, u, mRank);
    if (mSpell != null) {
      var p = spellParts(mSpell), tg = magicTargeting(p.series, p.level, p.rank);
      if (tg.select === 'whole') cells = wholeMapCells(battle);
      /* ★ 소환 후보 칸 — 시전자 정면/좌/우 `rank+1` 개 (`0x29C5A`). 예전엔 반경 2
       *   마름모를 칠하고 있었는데, 원본은 딱 그 셋만 `0x13D02` 로 칠한다. */
      /* ★ 대형은 **두 칸**을 차지한다 — `발자국` 으로 가까운 칸까지 칠한다 (`XXO`) */
      else if (tg.select === 'summon')
        cells = summonTiles(battle, u, null, (p.rank | 0) + 1, !!tg.대형, { 발자국: true });
      /* ★★★★★ **되살리기는 범위를 안 칠한다** (2026-09-08 · 사장님 지적 M18)
       *   > 「리바이블 **범위 표시 없이 바로 발동**해야하는데, 지금은 시전자 주변
       *   >  **2바퀴 범위 표시**가 나와」
       *   원본에서 범위를 칠하는 창구는 `0x13D02` 인데 —
       *     소환   `0x29C5A` 안에 **2번** 있다
       *     리바이블 `0x59A70` · 소울리콜 `0x2B1D0` 안에는 **한 번도 없다**
       *   ⇒ 되살리기 갈래는 칠하지 않는다. */
      else if (tg.select === 'reviveList') cells = [];        // 0x59A70·0x2B1D0 에 0x13D02 없음
      else if (tg.select === 'selfArea') {
        if (tg.dir4) cells = dirRange(battle, u, tg.dir4.kind, tg.dir4.len, tg.dir4.wid, tg.dir4.fromSelf);   // Lv4 방향형 (EXE 0x29722)
        else cells = diamond(battle, u.x, u.y, tg.radiusOf ? 자기광역반경(battle, u, tg, mRank) : r, true);
      }
      else {
        /* ☠★★★★★ **마법 사거리 통일(리마스터)을 뺐다 — 원본대로 간다** (2026-09-15 · 사장님 지정)
         *   > 사장님: 「**사거리 로직도 원본에 맞춰야해**」
         *   > 「기본적으로는 대충 맞을텐데 **리마스터 옵션으로 추가해둔 부분이 있는데,
         *   >  그부분은 제거하는게 낫겠어. 원본대로 하는게 나을 것 같아.**」
         *   전에는 `MAGIC_FAN_R = [5,6,7]` 로 **클래스만 보고** 사거리를 정했다
         *   (옵션 `마법범위통일` 기본 켜짐 · `리마스터_적용현황.md` 710행).
         *   ☠ 그 통일이 **보조1~4 에만 걸리고 보조5·7 에는 안 걸려** 같은 「범위 적」인데
         *     사거리가 갈렸다(실측 — 보조5·7 은 세 클래스 다 5 고정, 암흑1 은 5·6·7).
         *   ⇒ 통일을 걷어내고 **늘 `원작마법범위()`** 를 쓴다. */
        /* 2026-09-15 사장님 지정 - EXE 식으로 통일한다
         *   > 「1로 해야해. 2는 1과 동일한지 확인만 해야해.」
         *   반경 = ITEM[무기].마법사거리 + (class 1 이면 5, 아니면 class + 5)
         *          0x28465 . ITEM +0x36        0x2952C . 0x2955D
         *   ☠ 여태 `원작마법범위()` 가 5.7 을 박아 돌려주어 **아이템 보정이 통째로 버려졌다**
         *     (실측 - 마인검을 들어도 사거리가 한 칸도 안 늘었다).
         *   ★ `원작마법범위()` 는 지우지 않는다 - 2026-08-16 에 사장님이 확인해 주신 표라
         *     검산에 쓴다. `node 04_도구/마법사거리_EXE식_대조.js` */
        var fanR = (arg && arg.radius != null) ? arg.radius
                                               : magicRadius(battle, u, p.rank);
        cells = frontFan(battle, u, fanR);                   // 'target' — 전방 부채꼴
        /* ★★ [리마스터 변경] **버프 마법은 부채꼴에 「시전자 칸」을 더한다.**
         *
         * 사용자 지정 2026-08-15: 「기본 영역은 리마스터한 것과 같은데 원소 2단계
         * 마법을 비롯한 **버프 마법은 거기에 자기 자신 영역을 더한다.**」
         *
         * 부채꼴 자체(리마스터 §1-2 인접 칸 제외)는 **그대로 둔다.** 자기 칸만 얹는다.
         * 원본은 시전자를 대상에서 빼지 않는다(`0x1A1F8` 에 「시전자와 같은가」 검사가
         * 아예 없다 — `연출_원소2단계_원본확정.md` §11-1). 우리 부채꼴이 앞으로 한 칸
         * 밀려 있어서 자기 칸이 빠졌을 뿐이라, 버프 계열만 되돌린다. */
        if (tg.relation === 'ally' || tg.relation === 'heal') cells = cells.concat([{ x: u.x | 0, y: u.y | 0 }]);
      }
    } else {
      cells = diamond(battle, u.x, u.y, r, true);
    }
  } else if (kind === 'special') {
    cells = specialCells(battle, u, arg | 0, (arg && arg.grade) || 1, null);
  } else if (kind === 'ultimate') {
    /* ★ 초필살기는 **슬롯이 아니라 번호**로 정해진다 (`0x302E6` 이 `0x302B2` 점프표를
     *   타고, 캐릭터를 안 본다). `arg.index` 가 없으면 시전자에서 뽑는다(`0x4BC3C`). */
    var ui = (arg && arg.index != null) ? (arg.index | 0) : ultimateIndexOf(battle, u);
    cells = (ui >= 0) ? ultimatePickCells(battle, u, ui) : attackCells(battle, u);
  } else if (kind === 'counter') {
    var Ru = R();
    cells = diamond(battle, u.x, u.y, Ru ? Ru.counterRange(weaponTypeOf(battle, u)) : 1, false);
  } else if (kind === 'move') {
    var M = root.G2Move;
    if (!M) return [];
    return M.range(battle, u, { tp: u.tp | 0 }).cells;
  } else if (kind === 'skill') {
    var sk = (arg && arg.skill != null) ? (arg.skill | 0) : (arg | 0);
    if (sk === 15) cells = dashCells(battle, u);                    // 돌진 0x3C7D1
    else if (sk === 8) {                                            // 워프 0x3BFAC
      /* ★★★★★ **설 수 있는 칸만 하이라이트한다** (2026-09-23 · 사장님 지적)
       *
       *   > 사장님: 「스킬 워프 관련해서 제품은 **범위내 모든 지점에 워프가 가능**해.
       *   >  (이동 불가능한 타일로 워프가 가능함) **원본은 이동 가능한 타일에만
       *   >  하이라이트 표시가 되고 해당 표시된 영역만 워프가 가능**해.」
       *
       *   원본 `0x3BFAC` — 나선(`0x1AC08`)으로 반경 안을 훑되 칸마다 거른다:
       *   ```asm
       *   0x3BFF0  call 0x1AC59        ; 다음 칸 (기하만 낸다 — 지형을 안 본다)
       *   0x3C008  call 0x13CBD        ; ★ 맵 격자 word[0x78F48 + (y*W+x)*2]
       *   0x3C00E  cmp eax, -1 / jne   ; ★ **−1(빈 칸)이 아니면 건너뛴다**
       *   0x3C026  call 0x13D02 (ebx=1); 그 칸을 «표시»한다
       *   ```
       *   곧 하이라이트와 고를 수 있는 칸이 **같은 집합**이다.
       *   ☠ 우리는 마름모를 그대로 내보내 못 서는 칸까지 켜고 있었다 —
       *     실행부(`skill case 8`)만 `canStand` 로 막아 표시와 어긋났다.
       *   ★ 거르개는 **실행부와 같은 창구**(`G2Move.canStand`)를 쓴다.
       *   ☐ 반경 기준은 따로다 — 원본은 `0x3BFC6 [0x731B4 + 직업×15] == 1 ? 5 : 7`
       *     (직업표)인데 우리는 스킬 레벨을 본다. 정본 Z-17 에 적어 두었다. */
      var wRad = 워프반경(battle, u);                                /* 0x3BFC6 */
      /* ☠☠ **`canStand(…, null)` 은 지형을 안 본다** (2026-09-23 재확인)
       *   `move.js:526` — `if (R) { … R.left[k] … }` 라 **`R` 을 넘겨야만** 지형을 본다.
       *   실행부(`skill case 8`)도 `null` 을 넘기고 있어서 **못 서는 칸으로도 워프가 됐다**
       *   (사장님 최초 지적). 그래서 `dashCells` 와 **같은 잣대**로 바꾼다 —
       *   `battle.at()` 로 유닛, `moveCost() <= 0` 으로 지형. 원본 `0x13CBD == −1` 과 같은 뜻. */
      var wMt = (root.G2Move && root.G2Move.moveTypeOf)
        ? root.G2Move.moveTypeOf(battle, u) : 0;
      cells = diamond(battle, u.x, u.y, wRad, false).filter(function (c) {
        if (!inMap(battle, c.x, c.y)) return false;
        if (!워프경계안(battle, c.x, c.y)) return false;        /* 0x13D02 — 맵 가장자리는 표시하지 않는다 (2026-10-13) */
        if (battle.at(c.x, c.y)) return false;                  /* 0x3C00E 유닛이 있으면 −1 이 아니다 */
        return battle.moveCost(c.x, c.y, wMt) > 0;              /* 0x3C00E 지형도 −1 이 아니다 */
      });
    }
    else if (sk === 0) cells = mountSkillCells(battle, u);          // 승·하차 0x3B614/0x3B7CE
    else cells = [];
  } else cells = [];
  /* ★ 2026-09-25 사장님 「소환한 가고일 비행판정 안되어서 일반 공격이 통하는 문제」 — 원본 0x1A25F(칸 대상 판정)는
   *   0x1A26B dl = 대상[+0x14] · 0x1A270 test dl,1 · 0x1A275 test 공격자[+0x14],1 · je 0x1A2D3 → «비행 대상은 비행 공격자만».
   *   호출은 0x1D124 의 근접 갈래 셋(0x1D22E·0x1D293·0x1D2D5 — 권·검·지팡이 1칸 · 창 2칸 · 도끼)뿐이고
   *   활(0x1AEF3)·원거리(0x1D327·0x1D389)는 이 판정을 안 탄다 → 원거리는 비행 대상도 친다 */
  var 평타 = (kind === 'attack' || kind == null);
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var c = cells[i], t = battle.at(c.x, c.y);
    var 막음 = 평타 && 비행막음(battle, u, t);
    out.push({ x: c.x, y: c.y, unit: (t && t.alive) ? t : null,
               hostile: !!(t && t.alive && !막음 && hostile(u.side, t.side, battle.confuse)) });
  }
  return out;
}
/** 원본 0x1A25F 비행 판정 — 근접 평타(무기 종류 ≤ 4 · 0x1D124 의 0x1D22E·0x1D293·0x1D2D5 갈래)는 비행 대상([+0x14]&1)을
 *  공격자가 비행일 때만 친다. 평타 대상을 스스로 거르는 곳(ai·ring·session)도 이 함수를 쓴다 (2026-09-25) */
function 비행막음(battle, u, t) {
  return !!(u && t && weaponTypeOf(battle, u) <= 4 && ((t.f14 | 0) & 1) && !((u.f14 | 0) & 1));
}

/**
 * 승마·하차 선택 배열.
 *
 * 승마 `0x3B7D8~0x3B830`은 시전자 중심 십자(자기 칸 포함)를 1로 칠한다. 자기 칸은
 * 뒤의 탈것 조건에서 탈락하므로 실제 후보는 상하좌우 네 칸이다.
 * 하차 `0x3B61F~0x3B6D4`는 현재 탈것 발자국 `w×h`의 위·아래 한 줄과 좌·우 한 줄을
 * 칠한다. 즉 앵커 인접 네 칸이 아니라 **발자국 전체의 한 칸 바깥 테두리**다.
 */
function mountSkillCells(battle, u) {
  var riding = !!(u && (u._riderSnapshot || (u.rider && ((u.gear || {}).mount | 0))));
  if (!riding) return diamond(battle, u.x, u.y, 1, false);
  var foot = battle.footOf ? battle.footOf(u, u.dir) : [1, 1];
  var w = Math.max(1, foot[0] | 0), h = Math.max(1, foot[1] | 0);
  var x0 = u.x | 0, y0 = (u.y | 0) - h + 1, out = [], seen = {};
  function add(x, y) {
    if (!inMap(battle, x, y)) return;
    var k = x + ',' + y;
    if (!seen[k]) { seen[k] = 1; out.push({ x: x, y: y }); }
  }
  var x, y;
  for (x = x0; x < x0 + w; x++) { add(x, y0 - 1); add(x, y0 + h); }
  for (y = y0; y < y0 + h; y++) { add(x0 - 1, y); add(x0 + w, y); }
  return out;
}

/* ══════════════════════════════════════════ 3. 피해 적용 · 사망 */

/**
 * 피해 적용 — 0x1DAF9 (`[+0x48] −= 피해`) + 0x1ED45 사망 처리.
 * @param {number} dmg  HP × 100. 음수면 회복입니다.
 * @param {object} [ctx] { killer, reason, rng, silent }
 */
function applyDamage(battle, u, dmg, ctx) {
  ctx = ctx || {};
  /* ☠★★★★★ **여기에 배리어 가드를 넣었다가 되돌렸다** (2026-09-08)
   *
   *   > 사장님: 「배리어 효과가 적용되면 … **물리데미지, 필살기 데미지, 초필살기 데미지,
   *   >  스킬데미지(대쉬같은 본인 체력이 다는)** … 전부 안들어가.
   *   >  **원본 로직 살펴봐서 그대로 적용**해야해.」
   *
   *   원본을 전수로 뒤진 결과 — `test [유닛+0x15], 0x80` 은 **17곳뿐**이고
   *   (`03_분석/COMBATII/상태이상_원본확정.md:280`), 그 어디에도 **평타·필살기·초필살기·
   *   스킬 자해 경로가 없다.** 마법 배리어가 막는 것은 셋이다 —
   *     ① 마법 피해   `0x2A568`·`0x2A621` (함수 `0x2A500` 대상 수집 루프)
   *     ② 지형 피해   `0x17316` (함수 `0x17310` — 호출부 **7곳**, 대부분 AI 대역)
   *     ③ AI 표적     `0x417B5`~`0x42AAA` 11곳
   *   ☠ `0x17310` 을 「피해 적용 공통」이라 읽고 여기에 넣었었는데 **틀렸다.**
   *     호출부를 세어 보니 7곳이고 평타(`0x1DAF9`)·필살기가 없다.
   *   ☠ `[+0x14] & 4`(`0x1E128` 「무조건 방어」)는 **스킬 배리어**(번호 14 · `0x3C4C1` ·
   *     방패 필요)이고 **마법 배리어와 다른 것**이다. 그것도 피해 0 이 아니라
   *     **방패 방어 확률 100 %** 다(`능력치판정_분석.md:503`).
   *   ⇒ 2026-09-08 사장님 결정 — **「원본에서 찾은 것만 막는다」**.
   *     물리·필살기·초필살기는 그대로 들어간다. 마법·지형은 각자 자리에서 막는다. */
  var before = u.hp | 0;
  var hp = before - (dmg | 0);
  /* ★★★★★ **회복은 `0x1DA9C` 가 아니라 `0x462A7` 이 한다** (2026-09-02)
   *
   *   > 사용자 지적: 「날씨가 적용될때 **부수적인 적용 효과들**이 있는데 그부분이
   *   >   제대로 안된것 같다. **모래바람의 경우 tp가 줄기도 늘기도** 하고 …」
   *
   *   날씨 전역 `[0xBA84D]` 를 읽는 자리 11곳을 전수로 뒤져 보니, 실행기가
   *   놓친 것이 **하나** 있었다 — `0x462A7` 의 **회복량 절반**이다.
   *   (TP 보정 `0x19FAB` 과 마법 위력 `0x286AC` 는 이미 들어 있었다.)
   *
   *   ```asm
   *   0x462A7  (eax = 유닛, edx = 회복량)
   *   0x462AB  ecx = edx
   *   0x462AD  eax = [+0x48] + edx
   *   0x462B5  cmp eax, [+0x4C]            ; 최대HP 를 넘으면
   *   0x462B9    ecx = [+0x4C] − [+0x48]   ;   남은 만큼으로 자른다
   *   0x462BE  cmp [0xBA84D], 3            ; ★ 날씨 3 = 모래바람
   *   0x462C7  cmp [0xBA84E], 3            ; ★ 또는 전투 종류 3
   *   0x462D0  ecx = ecx / 2               ; ★★★ 회복량 **절반**
   *   0x462DD  cmp ecx, 0x64 ; jl 0x46356  ; ★ 1 HP 미만이면 **함수를 끝낸다**
   *   0x46323  [+0x48] += 0x64 씩          ;   실제로 올리는 양이 ecx 다
   *   ```
   *   ★ `0x46356` 은 `pop ecx · pop ebx · ret` — **아무 일도 안 하고 나간다.**
   *     그러니 절반 뒤 1 HP 에 못 미치면 **회복 자체가 없다.**
   *   ★ 자른 **뒤에** 절반이다. 그래서 모래바람에서는 **최대 HP 에 닿지 못한다.**
   *
   *   부르는 곳 다섯 — `0x17310`(피해가 음수) · `0x1F738` · `0x2ACCB`(회복 마법) ·
   *   `0x4D3BA`(휴식) · `0x5211D`(`.SCE` HP 증감). 우리는 이 다섯이 모두
   *   `applyDamage(…, 음수)` 로 모이므로 여기 한 곳에 둔다.
   *   ★ 기도(`combat.js` 의 `ally.hp` 직접 증가)는 원본에서 `0x462A7` 을 거치지
   *     않으므로 **일부러 뺐다.** */
  if ((dmg | 0) < 0) {
    var 회복 = -(dmg | 0);
    if (before + 회복 > (u.maxHp | 0)) 회복 = (u.maxHp | 0) - before;   // 0x462B5
    var _날씨 = (battle && battle.timeOfDay != null) ? (battle.timeOfDay | 0)
              : ((battle && battle.S && (battle.S['날씨'] | 0)) || 0);   // [0xBA84D]
    if (_날씨 === 3 || ((battle && battle.battleKind | 0) === 3))        // 0x462BE · 0x462C7
      회복 = Math.floor(회복 / 2);                                       // 0x462D0
    if (회복 < 100) 회복 = 0;                                            // 0x462DD → 0x46356
    hp = before + 회복;
  }
  if (hp > u.maxHp) hp = u.maxHp;                    // 0x1DA9C 회복 상한
  if (hp < 0) hp = 0;
  u.hp = hp;
  var out = { unit: u, damage: dmg | 0, hpBefore: before, hpAfter: hp, died: false, kill: null };
  /* [리마스터 부분경험치] 죽이지 못한 피해 — 평타·필살기·초필살기·스킬·마법 모두 여기를 지난다
   *   (사장님 2026-09-26 「데미지 부분 경험치의 경우 일반 공격이나 필살기 등 마법이 아닌 공격에도 적용되는게 좋겠어」) */
  if (hp > 0 && hp < before && u.alive && ctx.killer) out.부분경험 = 부분경험(battle, ctx.killer, u, before - hp);
  /* ★★★★★ **`ctx.사망유예`** — HP 만 깎고 사망 처리를 **미룬다** (2026-08-22 · GPT 28차)
   *
   *   원본은 대상 **전부**에 피해를 준 뒤(`0x1DEA7~`) **`0x1ED45`** 에서
   *   대상마다 HP 를 다시 보고 사망/생존을 가른다:
   *
   *     원본 :  A 피해 · B 피해  →  A 사망(0x1DB1D) · B 생존S4(0x1ED7C)
   *     전 우리:  A 피해 · A 사망  →  B 피해 · B 생존S4
   *
   *   A 의 사망 S4 명령이 **B 의 HP·진영·퇴장**을 바꿀 수 있으므로 연출 순서가 아니다.
   *
   *   ★ **기본값은 예전 그대로** — 마법·필살기·지형·독은 아직 이 구조가 미확인이다.
   *     통상 공격 경로에서만 컨트롤러가 켠다 (GPT 28차: 「범위: 통상 공격만」). */
  /* [리마스터] 용자의 무덤 8층 안내인 «HP 0 으로 버팀» — u._불사 (battle_main 무덤 머리에서 건다 · 2026-10-12 사장님 「혹시 죠엘이 때려서 죽더라도 체력0상태에서 진행되어야해. 그리고 평타 말고 필살기같은것도 적용 되어야 하고」)
   *   평타·필살기·초필살기·스킬·마법이 모두 지나는 이 자리에서 죽음으로 안 넘긴다 — 살아남은 대상(S4 0x1ED7C)으로 간다 */
  if (hp <= 0 && u.alive && u._불사) { out.불사 = true; return out; }
  if (hp <= 0 && u.alive && ctx.사망유예) {
    out.died = true;               /* 연출·보고용 표시만 */
    out.사망유예 = true;           /* ★ 컨트롤러가 0x1ED45 에서 처리한다 */
    return out;
  }
  if (hp <= 0 && u.alive) {
    out.kill = kill(battle, u, ctx);
    /* 탈것이었으면 죽지 않고 **탑승자가 남는다** — 0x1DD30 이 사망 처리를 건너뛴다 */
    out.died = true;                          // 연출은 언제나 돈다 (0x1DBB7 이 분기보다 앞)
    /* 탈것이면 연출 **뒤에** `G2Combat.unmount()` 로 탑승자가 나온다 (0x1DCF7) */
    if (out.kill && out.kill.unmountPending) out.unmountPending = true;
  }
  return out;
}

/** 값 복사 — `_cv`·`_shim`·`_raw` 같은 되돌이 참조는 뺀다. `skill()` 과 공용. */
/* ★★★ 복제에서 빼는 칸 (2026-08-22 · GPT 3단계 4차 검수)
 *   `_표` 는 2026-08-22 에 **아예 안 달게** 바꿨다(표는 G2State.현재표() 가 내준다).
 *   옛 사본이 남아 있어도 복제하지 않도록 목록에는 그대로 둔다.
 *   `_영속기준` 은 그 유닛의 적재 기준이므로 사본에도 **같은 값**이 가야 한다 —
 *   숫자 넷뿐이라 깊은 복제로 그대로 둔다. */
var 복제제외 = { _cv: 1, _shim: 1, _raw: 1, _표: 1, _HP소모미룸: 1 };   /* 정본 283 — _HP소모미룸 은 연출 묶음(p.actor = 자기)이라 고리다 · 초필살기로 적이 죽은 뒤 마장기 소환이 시전자를 복사하다 호출 깊이 초과로 멈췄다 (사장님 11-18 버그신고 «42-0B에서 카슈타르 아수라 소환후 멈춤») */

/* 정본 283 — 고리에 안전하게: 한 번 복사한 객체를 다시 만나면 그 사본을 쓴다(구조 그대로) · 처음 만난 고리는 칸 길을 콘솔에 한 번 남긴다
 *   ☠ 고리가 있으면 끝없이 돌아 «Maximum call stack size exceeded» — 마장기 소환(skill 16 copyValue(u))이 SKILL_COMMIT 에서 멈췄다
 *   (사장님 11-18 버그신고 «42-0B에서 카슈타르 아수라 소환후 멈춤» · 고리 칸은 아직 못 짚음 → 다음 신고의 콘솔 «[복사 고리]» 줄로 찾는다) */
var 복사고리알림 = false;
/* 정본 283 — 다른 유닛을 가리키는 칸은 복사하지 않고 같은 유닛을 가리킨다 · AI목표유닛 = SCE op 0x6F «유닛» 갈래(sceapply AI목표 · sceruntime aiGoal)
 *   ☠ 42-0B(칼스·카슈타르 일대일)는 이 칸이 서로를 가리켜, 카슈타르 아수라 소환(skill 16 copyValue(u))이 끝없이 돌다 멈췄다 · 42-0A 는 이 명령이 없어 멀쩡
 *   (사장님 11-18 「42-0a에서는 잘되고 42-0b에서만 발생해」) */
var 참조로둠 = { AI목표유닛: 1 };
function copyValue(v, 본, 길) {
  if (!v || typeof v !== 'object') return v;
  /* ★ 형식화 배열(`_원본` 136B 등)은 **같은 형식으로** 복제한다.
   *   `Object.keys` 로 돌면 인덱스만 든 **일반 객체**가 되어 조용히 망가진다. */
  if (ArrayBuffer.isView(v) && typeof v.slice === 'function') return v.slice();
  본 = 본 || new Map(); 길 = 길 || '';
  if (본.has(v)) {
    if (!복사고리알림 && 본.진행 && 본.진행.has(v)) { 복사고리알림 = true; try { console.warn('[복사 고리] ' + (길 || '(뿌리)')); } catch (e) {} }
    return 본.get(v);
  }
  if (!본.진행) 본.진행 = new Set();
  if (Array.isArray(v)) {
    var arr = []; 본.set(v, arr); 본.진행.add(v);
    for (var i = 0; i < v.length; i++) arr.push(copyValue(v[i], 본, 길 + '[' + i + ']'));
    본.진행.delete(v);
    return arr;
  }
  var o = {}; 본.set(v, o); 본.진행.add(v);
  Object.keys(v).forEach(function (k) {
    if (복제제외[k]) return;
    o[k] = 참조로둠[k] ? v[k] : copyValue(v[k], 본, 길 + '.' + k);
  });
  본.진행.delete(v);
  return o;
}

/**
 * 탈것이 죽었을 때 — **탑승자가 그 자리에 남는다.** 0x1DCF7 → 0x1808A.
 *
 * ```asm
 * 0x1DCF7  cmp [유닛+0x77], 0 ; je 0x1DD65   ; ★ [+0x77] = 탑승자 레코드. 없으면 그냥 죽는다
 * 0x1DCFF  call 0x1808A(eax = 유닛)          ;   분리
 * 0x1DD04  cmp [0x4A84E], 4 ; jge 0x1DD35    ; 전투 종류 ≥ 4 면 탑승자도 같이 죽는다
 * 0x1DD16  call 0x11F74(x, y, 유닛)          ; 그 칸에 다시 놓는다
 * 0x1DD21  [유닛+0x77] = 0                   ; 탑승자 칸 비우기
 * 0x1DD28  [유닛+0x60] = 0x1198D([유닛+0x5F] >> 16)   ; 스프라이트 프레임 되잡기
 * 0x1DD30  jmp 0x1DDAD                       ; ★ 사망 처리(리스트 제거)를 **건너뛴다**
 * ```
 *
 * 분리 `0x1808A` — **좌표를 그대로 물려준다.** 그래서 자리가 안 튄다.
 * ```asm
 * 0x18090  call 0x103A8                      ; 대기 모션 정지
 * 0x18095  cmp [탈것+0x5C], 6 ; ja           ; 코드 ≤ 6(말·비룡)이면
 * 0x1809E    eax = [탑승자+0x5D]>>24 → 0x119B6 ; 스프라이트 세트 되돌리기
 * 0x180AC  [탑승자+0x00] = [탈것+0x00]        ; ★ x
 * 0x180B0  [탑승자+0x01] = [탈것+0x01]        ; ★ y  — **같은 칸**
 * 0x180B6  [탑승자+0x6F..0x72] = 탈것 것       ; AI 목표 좌표
 * 0x180CE  [탑승자+0x73] = 탈것 것
 * 0x180D4  [탑승자+0x14] &= ~1                ; ★ 비행 비트 끄기
 * 0x180EC  0x61E59(dst = 탈것, src = 탑승자, 136)  ; ★ 탑승자 레코드로 슬롯을 덮는다
 * 0x180F3  [탈것+0x5C] = 0                    ;   탑승 해제
 * 0x180F7  call 0x1134A · 0x180FE call 0x12124 ; 픽셀 오프셋 0 (자리 튐 방지)
 * 0x18103  call 0x103A0                       ; 대기 모션 복구
 * ```
 * `0x61E59` 는 `(eax = dst, edx = src, ebx = 길이)` 다 (`edi = eax` · `esi = edx` · `rep movsd`).
 * 즉 **탈것 슬롯이 탑승자가 된다** — 새 슬롯을 만들지 않는다. 그래서 방향도 안 틀어진다.
 *
 * ★★ **사기·경험치·ELD 는 그대로 준다.** `0x1DB1D` 를 순서대로 읽으면
 *   `0x1DBCD call 0x17A20`(경험치)와 사기(`0x1DC0D`)가 탈것 분기 `0x1DCF7` 보다
 *   **앞**이다. 즉 「탈것을 잡은 것」도 격파로 친다. 건너뛰는 것은 그 뒤의
 *   **맵·리스트 제거와 소환수 정리**뿐이다 (`0x1DD30 jmp 0x1DDAD`).
 *
 * @returns {boolean} 분리했으면 true, 아니면 false(그냥 죽는다)
 */
/* ★ 정본 189 — 탑승자를 원본 레코드(u.rider._raw)로 새로 만들 때 순수 능력치를 넘긴다. 레코드에는 순수값이 없어 한 바이트 레코드에서 역산했고,
 *   255 넘던 능력치가 감겼다 — 말 탄 신디(팔라딘)의 순수 힘 257 이 말이 쓰러지며 내린 뒤 1 이 됐고 리바이블이 그대로 되살렸다
 *   (2026-11-14 사장님 「또 이상해졌어 힘이 1이 되어버렸어」·「정상 진행했는데 이렇게 됐어 다른캐릭터는 괜찮아」·「리바이블 했어」).
 *   레코드에 순수값이 있으면 그대로 · 없으면 같은 캐릭터인 본체(u)의 순수값(전투 시작 때 명부에서 받은 값) */
function 탑승자레코드(u) {
  var r = u && u.rider && u.rider._raw;
  if (!r || (r.순수 && r.순수.str != null) || !u.순수) return r;
  var 같은 = (r['캐릭터코드'] == null) || ((r['캐릭터코드'] | 0) === (u.charCode | 0));
  if (같은) {
    r.순수 = { str: u.순수.str | 0, int: u.순수.int | 0, agi: u.순수.agi | 0, cha: u.순수.cha | 0 };
    if ((u.level | 0) > 255 && (r['레벨'] | 0) < (u.level | 0)) r['레벨'] = u.level | 0;   /* 정본 191 — 255 넘는 레벨도 (레코드는 255 에서 멈춤) */
  }
  return r;
}
function unmountOnDeath(battle, u, ctx) {
  if (u) u._탑승자내림대기 = false;   /* kill 이 단 «곧 내린다» 표시 — 여기서 내리든 못 내리든 끝난다 */
  /* ★ `_riderSnapshot` 은 **하차 스킬(0x3B614)을 써야만** 생겼다. 그래서 `.SCE` 에서
   *   처음부터 타고 나온 유닛은 죽어도 분리가 안 되고 **탑승자가 사라졌다.**
   *   원본 `[+0x77]` 은 탑승 순간부터 채워져 있으므로, 여기서도 `u.rider._raw` 로
   *   그때 만들어 준다 (`skill()` 의 하차 갈래와 같은 방법). */
  if (!u._riderSnapshot && u.rider && u.rider._raw &&
      root.G2State && root.G2State.makeUnit) {
    var loaded = root.G2State.makeUnit(탑승자레코드(u), u.id);
    if (loaded) {
      /* ★★ 스프라이트는 **`makeUnit` 이 낸 값이 맞다** — 건드리지 말 것.
       *
       *   `u.rider.sprIndex` 는 `.SCE` 의 `탑승자RCR`(암흑기사 502 = `RDARK.RCR`)
       *   로, **말 위 상반신 겹쳐그리기용** 그림이다. 그걸 넣으면 말이 죽어도
       *   「말 탄 모습」이 그대로 남는다. 한 번 그렇게 넣었다가 되돌렸다.
       *
       *   원본은 탑승할 때 `0x17E81 [+0x61] = 탈것코드 + 299` 로 유닛의 스프라이트를
       *   **덮어쓰고**, 원래 값은 탑승자 레코드 `[+0x77]` 에 남겨 둔다.
       *   분리 `0x180EC` 가 그 레코드를 통째로 되돌리므로 보행 그림으로 돌아온다.
       *   우리 쪽에서 그 「원래 값」에 해당하는 것이 `makeUnit(_raw)` 의 결과다
       *   (`.NC2` 는 목록 순번 = sprIndex — `전투데이터_추출.md` §스프라이트 파일명 표).
       *
       *   ※ 다만 그 번호의 **메타가 `sprites.json` 에 없으면 층이 0개**가 되어
       *     안 보인다. 그건 할일 19-e(좌표 메타를 EXE `0x75AA8` 직독으로) 몫이다. */
      u._riderSnapshot = copyValue(loaded);
      사람참조되돌리기(u._riderSnapshot, 사람참조(loaded));   /* 원본 136B·장비 껍데기 연결 */
    }
  }
  if (!u._riderSnapshot) return false;                     // [+0x77] == 0
  /* 0x1DD04 — `[0x4A84E]` ≥ 4 면 탑승자도 같이 죽는다.
   * `[0x4A84E]` 는 `.SCE 0x06` 탈것 수준이고 Battle.탈것수준으로 적재된다.
   * 수준 4~6에서는 0x1808A 분리 경로를 타지 않으므로 여기서 분리하지 않는다. */
  if ((battle.탈것수준 | 0) >= 4) return false;
  var rider = copyValue(u._riderSnapshot);
  사람참조되돌리기(rider, 사람참조(u._riderSnapshot));      /* 사본이 뺀 원본 136B·장비 껍데기 — 레벨업이 든 사람 레코드 그대로 */
  var keepId = u.id;
  var keepSide = u.side | 0;

  /* 0x180AC · 0x180B0 — 좌표를 그대로 물려받는다 (자리가 안 튄다) */
  rider.x = u.x | 0; rider.y = u.y | 0;
  /* 배치된 탈것 슬롯의 현재 진영을 물려받는다.
   * 2-5.SCE의 번스타인·카슈타르는 탈것 본체가 적군(3)인데 부속 탑승자 원문은
   * 아군(1)이다. 원본 로더는 진영 리스트에 붙일 때 슬롯 진영을 확정한 뒤 그
   * 슬롯을 하차 레코드로 덮는다. 실행기에서 `makeUnit(탑승자._raw)`만 다시 하면
   * 그 로더 보정이 빠져 하차 순간 아군으로 뒤집힌다. */
  rider.side = keepSide;

  /* ★★ **방향은 물려받지 않는다** — `0x1808A` 를 끝까지 읽어 확정 (2026-08-13).
   *
   *   ```asm
   *   0x180AC  al = [탈것]      ; [탑승자]    = x       ← 좌표만
   *   0x180B0  al = [탈것+1]    ; [탑승자+1]  = y
   *   0x180B6  +0x6F · +0x70 · +0x71 · +0x72 · +0x73     ; AI 참조
   *   0x180D7  +0x7B                                     ; 리스트 next
   *   0x180D4  dl = [탑승자+0x14] & ~1                    ; 비행 비트 끄기
   *   0x180EC  call 0x61E59(eax = 탈것, edx = 탑승자, ebx = 0x88)
   *   ```
   *   `0x61E59` 는 `edi = eax`(목적지) · `esi = edx`(원본) · `rep movsd` —
   *   즉 **탑승자 레코드 136바이트가 탈것 슬롯을 통째로 덮는다.**
   *   `+0x63`(방향)은 `0x88` 안에 들어가는데 **위에서 안 덮었으므로**
   *   탑승자 레코드에 들어 있던 값이 그대로 살아난다.
   *   탑승 `0x17E6D` 도 `+0x63` 을 안 건드린다(전 구간 확인).
   *
   *   그래서 **탑승자 자신이 갖고 있던 방향**이 답이다.
   *     · `.SCE` 배치 탑승 유닛 → 파일의 탑승자 레코드 `+0x63`
   *     · 전투 중 승차(`0x3B7CE`)  → 탈 때의 방향 (레코드가 그 시점 사본)
   *
   *   ★ 원본 파일 **294개 전수 실측**: 탑승 쌍 819개 **전부 탑승자 `+0x63` = 0(남)**.
   *     탈것 쪽은 0:153 · 1:240 · 2:119 · 3:307 로 제각각이다. 즉 배치 탑승
   *     유닛이 죽으면 **탑승자는 언제나 남쪽을 본다** — 탈것이 서쪽을 보고
   *     있었어도 그렇다. 편집기가 그 칸을 안 쓰는 것으로 보이지만, 원본 코드가
   *     그 값을 그대로 복사하므로 결과가 이렇다.
   *
   *   예전엔 `rider.dir = u.dir` 로 **탈것 방향을 물려줬다.** 「슬롯을 덮으니
   *   방향도 유지」라고 적어 뒀는데, 덮는 원본이 탑승자 레코드라는 걸 놓친 것이다. */
  rider.ox = 0; rider.oy = 0;                              // 0x12124 픽셀 오프셋 0
  rider.f14 = (rider.f14 | 0) & ~1;                        // 0x180D4 비행 비트 끄기
  rider.id = keepId;
  rider.alive = true;
  rider.rider = null; rider._riderSnapshot = null; rider._mountSnapshot = null;
  rider.gear = rider.gear || {}; rider.gear.mount = 0;     // 0x180F3 [+0x5C] = 0

  /* 덮기 **전에** 탈것이 밟고 있던 칸을 기억해 둔다 — 덮고 나면 못 센다.
   * `cellsOf` 가 `sprIndex` 로 발자국을 찾으므로 탈것 스프라이트가 살아 있어야 한다. */
  var 밟던칸 = battle.cellsOf ? battle.cellsOf(u, u.x, u.y, u.dir) : [[u.x | 0, u.y | 0]];

  /* 0x180EC — 슬롯을 통째로 덮는다. 새 유닛을 만들지 않는다. */
  /* ★ 슬롯은 같은 목록(그룹)에 그대로 남는다 — 0x180EC 는 136B 만 덮고 리스트는 안 건드린다 (2026-10-11)
   *   ☠ 덮으면서 그룹이 사라져(makeUnit 사람 = 그룹 없음) 전투 끝 커밋(battle_commit «그룹 0 만»)이 이 유닛을 건너뛰었다 —
   *     배치 화면이 명부에 써 둔 탈것 칸(+0x5C)이 안 지워진 채 저장됐다
   *     (사장님 「비룡을 탔던 메이가 … 걸을때 말 소리가 나고, 필살기사용이 안되고」 · 재현: 그룹 0 → null · 커밋 반영 0) */
  var 슬롯표시 = { 그룹: u.그룹, _그룹: u._그룹, _전향합류: u._전향합류 };
  Object.keys(u).forEach(function (k) { delete u[k]; });
  Object.keys(rider).forEach(function (k) { u[k] = rider[k]; });
  Object.keys(슬롯표시).forEach(function (k) { if (슬롯표시[k] !== undefined) u[k] = 슬롯표시[k]; });
  if (root.G2State && root.G2State.derive && u.base) root.G2State.derive(u);

  /* ★★ **말이 차지하던 칸을 전부 비우고** 탑승자 몫만 다시 채운다 — `0x11EE4`.
   *
   *   발자국은 스프라이트마다 다르다(`전투데이터_추출.md` §4.5) —
   *   `HORSE1.BCR` 은 방향에 따라 **2×1 · 1×2** 로 **두 칸**을 차지하는데,
   *   `.NC2`(보행)는 `0x1188E` 가 **1×1 로 박는다**.
   *   그래서 앵커 한 칸만 다시 놓으면 **말이 밟고 있던 옆 칸이 그대로 남아**
   *   내린 캐릭터가 두 칸을 차지한 것처럼 된다 (사용자 지적 2026-08-13).
   *
   *   원본도 `0x11EE4` 가 「방향*11 + 현재 모션」 발자국을 훑어 지운다. */
  밟던칸.forEach(function (c) {
    if (battle.at(c[0], c[1]) === u) battle.setAt(c[0], c[1], null);
  });
  battle.setAt(u.x, u.y, u);                               // 0x11F74 — 탑승자 몫 한 칸

  return true;
}

/**
 * 사망 **연출이 끝난 뒤** 부른다 — `0x1DCF7` 자리.
 * 탈것이었으면 탑승자로 갈아 끼우고 `true`, 아니면 `false`.
 * @returns {boolean}
 */
function unmount(battle, u) {
  if (!u || !battle) return false;
  return unmountOnDeath(battle, u, {});
}

/**
 * 이 유닛을 가리키던 **다른 유닛의 AI 목표 포인터를 전부 끊는다** — `0x1DAEE`.
 *
 * ```asm
 * 0x1DAF7  진영 0~3 리스트(0xCC968)를 돈다
 * 0x1DB05  cmp edx, [유닛+0x73] ; jne          ; ★ [+0x73] = AI 목표 유닛 포인터
 * 0x1DB0A    [유닛+0x73] = 0                   ;   죽은 놈을 가리키면 지운다
 * 0x1DB0D  eax = [유닛+0x7B]                   ; 다음 노드
 * ```
 * 사망 처리 `0x1DB1D` 가 `0x1DBEB`(소환수) · `0x1DD41`(정규) 두 자리에서 부른다.
 * 끊지 않으면 **죽은 유닛을 계속 쫓는다**.
 *
 * 우리 쪽 대응은 `u.ai.targetUnit` 이다. 좌표 목표(`ai.target`)는 원본
 * `[+0x6F]/[+0x70]` 이라 그대로 둔다 — 원본도 안 지운다.
 */
function dropTargetRefs(battle, dead) {
  if (!battle || !dead) return 0;
  var n = 0;
  for (var i = 0; i < battle.units.length; i++) {
    var s = battle.units[i];
    if (!s || s === dead) continue;
    if (s.ai && s.ai.targetUnit === dead) { s.ai.targetUnit = null; n++; }
    /* ★ AI 가 실제로 읽는 목표 유닛(ai.js AI목표읽기 · op 0x6F · 목표 지정 0x4D01A)도 끊는다 — [+0x73] = 0 (2026-09-26) */
    if (s.AI목표유닛 === dead) { s.AI목표유닛 = null; n++; }
  }
  return n;
}

/**
 * 사망 — 0x1ED45 → 0x1DB1D.
 *   ① 맵·리스트에서 뺍니다
 *   ② 사기 (0x1DC0D) — **소환수([+0x12] >= 10)는 사기를 안 움직입니다** (0x1DBE7 jb)
 *   ③ 경험치·레벨업·숙련 (0x17A20) — ctx.killer 가 있을 때만
 *   ④ 격파 보상 ELD 누적 (0x17B4C)
 *   ⑤ 소환자가 죽으면 그가 부른 소환수도 함께 사라집니다 ([+0x12] == 소환자코드 + 10)
 */
/** 0x17A97~0x17D47 — 받을 이 `k` 에게 경험치 `gain` 을 넣고 레벨업·성장·숙련까지 한다.
 *  반환은 대사창(`killGainLines`)이 읽는 모양 그대로다. `victim` 이 있으면 그 ELD 를 싣는다. */
/* [리마스터 편의] 경험치 배율 (opt.js 경험치배율 · 개발 패널 슬라이더) — 1 이면 원작 그대로 (2026-10-07)
 *   원본 0x17A97 은 한 번에 «100 − 지금 경험치»까지만 받으므로 그냥 곱하면 20배여도 한 레벨에서 잘린다.
 *   ⇒ 배율이 1 보다 크면 곱한 값을 레벨 하나 몫씩 나눠 원본 적용(0x17A20)을 거듭한다 — 레벨마다 원본 성장(0x1767E)·숙련(0x176F1)이 한 번씩 돈다. */
function 경험치적용(battle, k, gain, victim, expOpt) {
  var O = root.G2Opt || root.Opt, 배 = (O && O.경험치배율값) ? O.경험치배율값() : 1;
  /* [리마스터] 게임설정 «수련 장비 — 경험치 증가» — 낀 장비 성장 칸 합 1 점마다 +25% (rules.js 수련경험치배 · 정본 170) */
  if (gain > 0 && R() && R().수련경험치배) { try { 배 *= R().수련경험치배(view(battle, k), battle.T); } catch (e수련) { } }
  if (!(배 > 1) || !(gain > 0)) return 경험치한번(battle, k, gain, victim, expOpt);
  var 남 = Math.round(gain * 배), 합 = 0, 레벨 = 0, 끝 = null;   /* 수련 배율은 1.25 처럼 소수라 반올림 */
  var _끝레벨 = (R() && R().레벨상한) ? R().레벨상한() : 99;   /* 정본 181 — 상한해제면 999 */
  while (남 > 0 && (k.level | 0) < _끝레벨) {
    var 이번 = Math.min(남, 100 - (k.exp | 0));
    끝 = 경험치한번(battle, k, 이번, victim, expOpt);
    남 -= 이번; 합 += 끝.gain | 0; 레벨 += 끝.levels | 0;
    if ((끝.gain | 0) <= 0) break;
  }
  if (!끝) return 경험치한번(battle, k, 0, victim, expOpt);
  끝.gain = 합; 끝.levels = 레벨;
  return 끝;
}
/* [개발] 한 번에 목표 레벨까지 — 원작 레벨업(경험치한번: 0x17A97 · 성장 0x1767E · 숙련 0x176F1 · 파생 0x1796B)을 레벨마다 되풀이해 능력치도 실제 레벨업처럼 오른다
 *   상한은 R().레벨상한()(개발 토글 «상한해제»면 999 · 아니면 99) · 화면 연출 없음 · 탄 채면 사람 기록(경험치받을이)
 *   (2026-11-15 사장님 「테스트용으로 한번에 레벨 999까지 올리는 방법 만들어줘. 스탯도 함꼐 올라야해.」 · 정본 209) */
function 레벨올리기(battle, u, 목표) {
  if (!battle || !u) return 0;
  var k = 경험치받을이(battle, u) || u;
  var 끝 = Math.min(목표 | 0, (R() && R().레벨상한) ? R().레벨상한() : 99), 돈 = 0;
  while ((k.level | 0) < 끝 && 돈 < 2000) {
    var 전 = k.level | 0;
    경험치한번(battle, k, Math.max(1, 100 - (k.exp | 0)), null, null);
    돈++;
    if ((k.level | 0) <= 전) break;                                   /* 더 못 오른다(상한) */
  }
  return k.level | 0;
}
function 경험치한번(battle, k, gain, victim, expOpt) {
  var Ru = R();
  var kv = view(battle, k);
  var res = Ru.applyExp(kv, gain, expOpt);                           // 0x17A97 · 0x17B5A
  var grew = null, mastery = null;
  if (res.levels > 0) {
    grew = Ru.applyGrowth(kv, battle.T);                             // 0x1767E
    /* [리마스터] 숙련 증가량 — 필살기·마법 따로 (2026-10-02 사장님 「필살기 창1 표, 마법은 a안으로 가자 토글은 각각」) */
    mastery = Ru.levelUpMastery(kv, battle.T,                         // 0x176F1
      { 필살기: 경험치옵션('필살기숙련'), 마법: 경험치옵션('마법숙련') });
  }
  commit(battle, k, kv);
  /* ★★★ 레벨업 뒤에는 **원본 0x1796B 처럼 파생 능력치를 통째로 다시 쓴다**
   *   (0x17D47 call 0x1796B). `derive()` 만 부르면 `base.atk = rawAtk − eqAtk` 로
   *   옛 저장값을 역산해 버려서 **성장한 힘이 공격력에 반영되지 않는다.**
   *   2026-08-22 · GPT 3단계 재검수 지적. */
  if (res.levels > 0 && root.G2State) {
    try {
      if (root.G2State.레벨업재계산) root.G2State.레벨업재계산(k);
      else if (root.G2State.derive) root.G2State.derive(k);
    } catch (e) {
      /* ★ 의존이 빠진 채 조용히 넘어가면 잘못된 값이 커밋된다 —
       *   전투를 끊지는 않되 **반드시 남긴다** (GPT 4차 검수). */
      if (typeof console !== 'undefined' && console.error)
        console.error('[레벨업] 파생 재계산 실패 — ' + e.message);
      battle.레벨업재계산실패 = (battle.레벨업재계산실패 | 0) + 1;
    }
  }
  /* ① 대사창이 「경험치 N  M ELD 획득!」을 한 줄로 내므로 ELD 도 같이 싣는다
   *   (0x17B05 ax = [죽은적+0x85] — 같은 문자열 안에 들어간다) */
  /* [리마스터] 탄 채로 오른 레벨·경험치·1차 능력치를 탄 슬롯에도 보인다 (2026-10-05)
   *   원본은 사람 레코드([+0x77])만 바꾸고 탄 슬롯은 그대로 둔다 — 상태창이 옛 레벨을 보였다.
   *   사장님 「탑승 후 레벨업시 탑승상태에서도 정상적으로 레벨업이 되어야하고 스탯이 올라야하고」 · 싸움 값(공격·방어·HP)은 원본대로 탈것 것 */
  var 슬롯 = k._탄슬롯;
  if (슬롯 && 슬롯 !== k) {
    슬롯.level = k.level | 0; 슬롯.exp = k.exp | 0;
    if (k.base && 슬롯.eff) ['str', 'int', 'cha'].forEach(function (s) { if (k.base[s] != null) 슬롯.eff[s] = k.base[s] | 0; });
    if (k.base && 슬롯.eff && k.base.dex != null) 슬롯.eff.agi = k.base.dex | 0;
  }
  return { unit: k, gain: res.gain, levels: res.levels, levelAfter: k.level | 0, growth: grew,
           mastery: mastery, eld: victim ? (victim.reward | 0) : 0, victim: victim || null };
}

/**
 * ★★★★★ **맵 아이템(상자·경험치 지점)의 경험치** — 원본 `0x18CC5`~`0x18D04` (2026-10-05)
 *   사장님: 「아이템 획득 경험치도 반영이 안돼.」
 *   ```asm
 *   0x18CC5  cmp [esp+8], 0 / jle     ; 경험치(아이템 +3)가 없으면 건너뜀
 *   0x18CD4  add ah, al               ; ★ [+0x3D] += 경험치 (바이트)
 *   0x18CE3  cmp [+0x3D], 0x64 / jb   ; 100 미만이면 끝
 *   0x18CED  [+0x3D] = 100
 *   0x18CF1  call 0x17A20 (edx = 0)   ; ★ 레벨업 루틴(처치 경험치와 같은 함수 · 레벨업 대사 포함)
 *   0x18CF6  [+0x3D] = 0              ; ★ 넘친 몫은 버린다
 *   ```
 *   ☠ 우리는 획득 대사(«경험치 N 점 획득!»)만 띄우고 유닛에 더하지 않았다.
 *   ☐ 0x18CDC·0x18CFA — 탑승 중이면 탑승자 기록([+0x77])에도 같은 값을 쓴다. 우리 탑승자 기록 경로는 따로 남은 일(정본).
 * @returns {object|null} 경험치적용 과 같은 꼴 {gain, levels, growth, mastery…} — 대사창이 쓴다
 */
function 아이템경험(battle, u, gain) {
  gain = gain | 0;
  if (!u || gain <= 0) return null;                                  // 0x18CCB jle
  /* [리마스터] 받는 이는 킬 경험치와 «같은 창구»(경험치받을이) — 탄 채면 보관 사람 레코드 (2026-10-05 사장님 「캐릭터 레벨업이면 어디에서든 그 기능으로 들어가고」) */
  u = 경험치받을이(battle, u);
  var e = ((u.exp | 0) + gain) & 0xFF;                               // 0x18CD4 add ah,al
  if (e < 100) {                                                     // 0x18CE7 jb
    u.exp = e;
    if (u._탄슬롯 && u._탄슬롯 !== u) u._탄슬롯.exp = e;              /* [리마스터] 탄 슬롯 표시 */
    return { unit: u, gain: gain, levels: 0, levelAfter: u.level | 0, growth: null, mastery: null, eld: 0 };
  }
  u.exp = 100;                                                       // 0x18CED
  var r = 경험치적용(battle, u, 0, null);                            // 0x18CF1 call 0x17A20(edx=0)
  u.exp = 0;                                                         // 0x18CF6
  if (r) r.gain = gain;
  return r;
}

/* ══════════ [리마스터] 경험치 옵션 셋 — 원본에 없다 (2026-09-26 사장님 · Z-87) ══════════
 *
 *   사장님: 「1. 소환수가 경험치 획득한걸 소환자에게 귀속시키는거(소환자가 레벨도 올라야함.
 *   이건 스킬 분신에도 적용) 2. 회복, 버프, 디버프, 부활 등 데미지를 주지 않는 마법에 경험치 부여
 *   (과하지 않도록 적절한 환산 공식을 생각해야해) 3. 하나 더 추가한다면 죽이지 못하고 데미지만
 *   주었을때 부분경험치(마찬가지로 과하지 않도록 적절한 환산 공식을 생각해야 함)」
 *   고르신 식 — ② 「한번에 최대 … 20정도」 · ③ 「피해 비율의 절반」 · 표시 「레벨업 때만 창」
 *
 *   `Opt.cfg` 키 셋 — 값이 `'리마스터'` 일 때만 켠다(없거나 `'원작'` 이면 원본 그대로)
 *     소환경험치  소환수·분신·소울리콜로 일어난 유닛([+0x12] = 소환자코드 + 10)이 번 경험치를 소환자가 받는다
 *     보조경험치  비피해 마법이 실제로 먹힌 대상 한 명당 킬 경험치의 1/5(최소 1) · 시전 한 번 합계 20 까지
 *     부분경험치  죽이지 못한 피해 — 킬 경험치 × (깎은 HP ÷ 최대HP) × 1/2 (최소 1) · 죽이면 킬 경험치는 따로
 *     ★ 여기 «킬 경험치»는 한 레벨(100)로 자른 값이다(`실효킬경험`) — 원본도 킬 한 번에 한 레벨을 못 넘긴다
 *   킬 경험치 = 원본 0x17A61 (`Rules.expGain`) · 적용은 원본 0x17A97 그대로(레벨업까지 남은 양으로 자른다)
 *
 *   ★ ②③은 **바로 넣지 않고 쌓았다가 행동이 끝날 때 한꺼번에 넣는다** (`리마스터경험정산`).
 *     공격·필살기는 행위자의 사본(`view`)을 들고 있다가 끝에 되쓴다(`commit(battle, A, av)`) —
 *     도중에 넣으면 그 되쓰기가 경험치·레벨을 덮는다.
 *   ★ 창은 레벨업 때만 뜬다 — 「경험치 N 획득!」 줄은 안 낸다 (`battle_main.js killGainLines` 의 `조용히`). */
function 경험치옵션(키) {
  var c = root.Opt && root.Opt.cfg;
  return !!(c && c[키] === '리마스터');
}
function 편무리(u) { return ((u && u.side) | 0) === 3 ? 3 : 1; }
/** 소환수·분신의 소환자 — [+0x12] = 소환자 캐릭터코드 + 10 (0x2B638 · 0x3BD30). 살아 있는 본체만 */
function 소환자찾기(battle, k) {
  var tag = (k && k.summonerTag) | 0;
  if (tag < 10) return null;
  for (var i = 0; i < battle.units.length; i++) {
    var s = battle.units[i];
    if (s && s !== k && s.alive && ((s.summonerTag | 0) < 10) && (s.charCode | 0) === tag - 10
        && 편무리(s) === 편무리(k)) return s;
  }
  return null;
}
/** 탈것·마장기에 탄 유닛의 «보관된 사람 레코드»([+0x77]) — 없으면 null.
 *  .SCE 에서 처음부터 타고 나온 유닛은 탑승자._raw 로 그때 만든다(승·하차 0x3B614 갈래와 같은 방법). */
function 보관몸(battle, u) {
  if (!u) return null;
  if (u._mechaSnapshot) return u._mechaSnapshot;                     // 0x3C548 원래 몸
  if (u._riderSnapshot) return u._riderSnapshot;                     // 0x3B929 기수 사본
  if (u.rider && u.rider._raw && root.G2State && root.G2State.makeUnit) {
    var r = root.G2State.makeUnit(탑승자레코드(u), u.id);
    if (!r) return null;
    try { if (root.G2State.derive) root.G2State.derive(r); } catch (e) {}
    r.x = u.x | 0; r.y = u.y | 0; r.side = u.side | 0;
    u._riderSnapshot = copyValue(r);
    사람참조되돌리기(u._riderSnapshot, 사람참조(r));
    if (!u._mountSnapshot) u._mountSnapshot = copyValue(u);
    return u._riderSnapshot;
  }
  return null;
}
/** 사본(copyValue)이 빼는 참조 넷 — 사람 레코드의 원본 136B(_raw._원본)·판정 껍데기(_shim · 장비 보정)를 **사본에 그대로 붙여 둔다**.
 *  ⇒ 탄 동안 레벨업 성장이 사람 장비 보정으로 계산되고, 하차·커밋이 사람 원본 기록을 찾는다. 마장기(_mechaRefs · Z-30)와 같은 까닭.
 *  ☠ 없으면 내린 사람이 원본 기록과 끊겼다 (2026-10-05 사장님 「탑승했을때 스테이터스창에 무기가 사라지는것처럼 보여. 이상태로 레벨업을 해도 보정치는 적용이 되어야한다고」) */
function 사람참조(u) { return u ? { _raw: u._raw, _shim: u._shim, '_표': u['_표'], _cv: u._cv } : null; }
function 사람참조되돌리기(u, 참조) {
  if (u && 참조) Object.keys(참조).forEach(function (k) { if (참조[k] !== undefined) u[k] = 참조[k]; });
}
/** 경험치를 받을 이 — 부속유닛은 본체(0x17A36) · [리마스터 소환경험치] 소환수·분신은 소환자
 *  ★ 탈것·마장기에 탄 유닛은 «보관된 사람 레코드»가 받는다 (2026-10-05 · CD 설치본 0x179F4 직독)
 *    0x179F4 edx = [ebp+0x77] · test edx,edx / je · [edx] = x · [edx+1] = y · **ebp = edx** — 그 뒤 경험치·레벨·성장 전부 사람 레코드
 *    ⇒ 레벨업 성장은 사람이 낀 장비 보정으로 계산되고, 하차(0x1808A 사람 → 슬롯 복사)·커밋(0x113F0 사람 우선) 뒤에도 남는다.
 *    ☠ 전에는 탈것 슬롯이 받아 내리면 사라졌다 (사장님 「마장기 탑승 후 레벨업한 내용과 스탯이 탑승 해제했을때 적용되지 않아」 ·
 *      「마장기 뿐만 아니라 모든 탑승물이 동일하게 처리되어야해」) */
function 경험치받을이(battle, k) {
  if (k && k.escortOf) k = k.escortOf;                               // 0x17A36
  if (k && 경험치옵션('소환경험치')) {
    var o = 소환자찾기(battle, k);
    if (o) k = o.escortOf || o;
  }
  var 몸 = 보관몸(battle, k);
  if (몸) {
    몸.x = k.x | 0; 몸.y = k.y | 0; 몸.alive = true;                 // 0x179FF~0x17A10
    /* 사본 복제(copyValue)·저장에 안 끼도록 열거 안 되는 칸으로 슬롯을 단다 — 레벨 표시 맞추기에만 쓴다 */
    Object.defineProperty(몸, '_탄슬롯', { value: k, enumerable: false, configurable: true, writable: true });
    return 몸;
  }
  return k;
}
/** 죽였을 때 «실제로» 받을 킬 경험치 — 0x17A61 값을 0x17A97 처럼 한 레벨(100)로 자른다.
 *  ☠ 자르지 않으면 레벨 10 이 레벨 70 을 반만 깎아도 610×½×½ = 152 로 한 대에 레벨이 올랐다(2026-09-26 실측 TESTWC).
 *  ⇒ 부분 경험치는 한 번에 최대 50 · 보조 경험치는 한 명당 최대 20 */
function 실효킬경험(k, D) {
  return Math.min(100, R().expGain(k.level | 0, D.level | 0));      // 0x17A61 · 0x17A97
}
function 리마스터경험쌓기(battle, k, gain) {
  (battle._리마스터경험 || (battle._리마스터경험 = [])).push({ unit: k, gain: gain | 0 });
}
/** ③ 부분 경험치 — `applyDamage` 가 죽지 않은 피해마다 부른다 */
function 부분경험(battle, 행위자, D, 깎은) {
  if (!경험치옵션('부분경험치') || !행위자 || !(깎은 > 0)) return 0;
  var k = 경험치받을이(battle, 행위자);
  /* ★ 적대는 0x1201D 판정으로 — ☠ 편무리()는 진영 4(제3 진영)를 아군(1)과 한 무리로 쳐서 진영 4 적을 때려도 부분 경험치가 안 쌓였다
   *   (2026-09-26 사장님 「화룡소환 부분 경험치 안들어와」 · TESTWC 실측: 적 넷을 맞혔는데 셋 몫만 쌓임) */
  if (!k || !k.alive || k === D || (k.job | 0) === 0xA1 || !hostile(k.side | 0, D.side | 0, battle.confuse)) return 0;
  var 최대 = D.maxHp | 0;
  if (최대 <= 0) return 0;
  var 킬 = 실효킬경험(k, D);
  var g = Math.max(1, Math.floor(킬 * Math.min(깎은, 최대) / 최대 / 2));
  리마스터경험쌓기(battle, k, g);
  return g;
}
/** ② 비피해 마법 — 대상 한 명이 실제로 효과를 받았을 때. `rep._보조경험` 이 시전 한 번의 합계 */
function 보조경험(battle, 시전자, D, rep) {
  if (!경험치옵션('보조경험치') || !시전자 || !D) return 0;
  var k = 경험치받을이(battle, 시전자);
  if (!k || !k.alive || (k.job | 0) === 0xA1) return 0;
  var 남 = 20 - (rep._보조경험 | 0);
  if (남 <= 0) return 0;
  var g = Math.min(남, Math.max(1, Math.floor(실효킬경험(k, D) / 5)));
  rep._보조경험 = (rep._보조경험 | 0) + g;
  리마스터경험쌓기(battle, k, g);
  return g;
}
/** 비피해 마법이 «먹혔나» — 대상의 HP·상태 칸·그림·장비를 앞뒤로 견준다 (지속만 늘린 중복 걸기는 안 친다) */
function 보조상태(D) {
  var 장비 = '';
  try { 장비 = JSON.stringify(D.equip || null); } catch (e) {}
  return [D.alive ? 1 : 0, D.hp | 0, D.f15 | 0, D.f1e | 0, D.ailment | 0, D.sprIndex | 0, 장비].join('|');
}
/** 행동이 끝날 때 — 쌓인 ②③을 넣는다. 레벨이 오른 몫만 돌려준다(그것만 창을 띄운다) */
function 리마스터경험정산(battle) {
  var q = battle && battle._리마스터경험;
  if (!q || !q.length || !R()) return [];
  battle._리마스터경험 = [];
  var 창 = [];
  q.forEach(function (e) {
    var k = e.unit;
    if (!k || !k.alive || (k.job | 0) === 0xA1) return;
    var x = 경험치적용(battle, k, e.gain, null);
    if (x && x.levels > 0) { x.조용히 = true; 창.push(x); }
  });
  return 창;
}

/**
 * ★ 죽을 때 상태이상·버프를 지운다 — 원본 사망 함수 0x1DD35/0x1DD65 `[+0x1E]=0` · 0x1DD3C/0x1DD6C `[+0x15]=0` (어느 갈래로 죽어도).
 *   kill() 의 몸통에 있던 것을 떼어 냈다 — ☠ 독·화상 턴 피해 사망(turn.js 사망후처리)·시전자 사망 때 소환수 동반 소멸·희생은
 *   kill() 을 안 거쳐 상태이상을 단 채 시체가 됐고, 소울리콜이 그대로 일으켰다
 *   (2026-11-13 사장님 「소울리콜에 상태이상이 따라오는 문제가 있어. 소환한 몬스터가 이전에 걸린 상태이상이 소울리콜에 그대로 따라오는 문제가 있으니 해결해야해.」 · 정본 176).
 *   여러 번 불러도 같다 — 이미 지운 뒤면 표시 사본(_사망전표시)을 0 으로 덮지 않는다.
 */
function 사망상태지우기(u) {
  if (!u) return u;
  if ((u.ailment | 0) || (u.f15 | 0) || !u._사망전표시)
    u._사망전표시 = { ailment: u.ailment | 0, f15: u.f15 | 0 };
  u.f1e = 0;                                                  // 0x1DD35  ★ raw
  u.f15 = 0;                                                  // 0x1DD3C  ★ raw
  u.ailment = 0;                                              // 0x1DD35 (제품 보조 표현)
  if (u.mbuff) {                                              // 0x1DD3C (제품 보조 표현)
    Object.keys(u.mbuff).forEach(function (열쇠) {
      var 덜 = (u.mbuff[열쇠] && (u.mbuff[열쇠].delta | 0)) || 0;
      if (u.buff && u.buff[열쇠] != null) u.buff[열쇠] = (u.buff[열쇠] | 0) - 덜;
      if (u.eff && u.eff[열쇠] != null) u.eff[열쇠] = (u.eff[열쇠] | 0) - 덜;
    });
    u.mbuff = {};
  }
  return u;
}
function kill(battle, u, ctx) {
  ctx = ctx || {};
  var Ru = R();
  if (!u.alive) return null;
  if (u._불사) { u.hp = 0; return null; }   /* [리마스터] 용자의 무덤 8층 안내인 «HP 0 으로 버팀» — u._불사 (battle_main 무덤 머리에서 건다 · 2026-10-12 사장님 「혹시 죠엘이 때려서 죽더라도 체력0상태에서 진행되어야해. 그리고 평타 말고 필살기같은것도 적용 되어야 하고」) */

  /* ★ 탈것 수준 0~3에서는 나중에 **탑승자로 바뀐다**(0x1DCF7). 수준 4~6은
   *   0x1DD04에서 분리를 건너뛰어 탑승자까지 함께 죽는다. 다만 사기·경험치는
   *   그 분기보다 **앞**(0x1DBCD · 0x1DC0D)이라 그대로 준다 — 순서를 지킨다.
   *   맵에서 빼는 것도 미룬다(분리가 같은 칸을 다시 쓴다). */
  /* ★ `_riderSnapshot` 은 `unmountOnDeath` 가 **필요할 때 만든다**(`.SCE` 에서
   *   처음부터 타고 나온 유닛은 아직 없다). 그러니 여기서는 `rider` 까지 봐야 한다 —
   *   `_riderSnapshot` 만 보면 그 유닛은 영영 분리가 안 된다. */
  var mounted = !!(u._riderSnapshot || (u.rider && u.rider._raw));
  var riderSurvives = mounted && ((battle.탈것수준 | 0) < 4);   // 0x1DD04

  /* 탈것이어도 **연출 동안은 죽은 것과 같다** — 회전·파편이 말에 대해 돈다.
   * 맵 칸은 비우지 않는다. 곧 탑승자가 같은 칸을 쓴다 (0x11F74). */
  u.hp = 0;
  u.alive = false;
  /* ★★★★★ **죽은 차례를 남긴다** — 원본의 「사망자 명부」 자리를 뜻으로 옮긴 것이다
   *   (2026-09-19 · PACKET 14 ADDENDUM 2)
   *
   *   ```asm
   *   ── 사망 처리 ──
   *   0x1DD97  add eax, 0xCC968        ; 진영 명부
   *   0x1DD9C  call 0x1137A            ;   거기서 «뺀다»
   *   0x1DDA1  mov eax, 0xD6620        ; ★ 사망자 명부
   *   0x1DDA8  call 0x1134F            ; ★★ 그 «꼬리»에 넣는다
   *   ── 꼬리에 붙이기 0x1134F ──
   *   0x1136A  mov eax,[ebx+0x4] ; mov [eax+0x7b], edx ; mov [ebx+0x4], edx
   *   ```
   *   ⇒ 사망자 명부의 차례는 **죽은 순서**다. 부활(`0x137E7`)이 **머리부터** 훑으므로
   *     **가장 먼저 죽은 쪽**이 먼저 나온다.
   *   ★ 우리는 링크드 리스트를 안 쓰므로 **번호**로 같은 뜻을 낸다.
   *     시나리오 시작부터 죽어 있던 유닛은 번호가 없다 — 명부에 먼저 들어간 셈이라
   *     `0` 으로 친다 (`revibleTarget`). */
  /* ★★ **명부에 안 들어가는 죽음** — 언데드 · 그림 300 이상(큰 괴물) · 탈것을 탄 유닛 (2026-09-25 원본 직독)
   *   0x1DCF7 cmp [+0x77],0 ; je 0x1DD65   ; 탈것이면 → 내리거나(0x1DD0D~0x1DD30) 0x1DD35 → 0x1DD4D — 어느 쪽도 명부를 안 탄다
   *   0x1DD7D cmp [+0x0D],2 ; je 0x1DD4D    ; ★ 언데드면 명부를 건너뛴다
   *   0x1DD83 cmp [+0x61],0x12C ; jge 0x1DD4D ; ★ 그림 300 이상이면 건너뛴다
   *   0x1DD4D → 0x113CC(진영 명부에서 빼고 0x1134A 로 없앤다) · 0x1DDA1 0x1134F(사망자 명부)는 안 탄다
   *   ⇒ 리바이블(0x137E7)·소울리콜(0x13838)이 이 유닛을 다시는 고를 수 없다 — 소울리콜로 되살아난(언데드) 유닛도 같다
   *   (사장님 2026-09-25 「원본의 경우 소울리콜로 되살아 난 캐릭터가 죽었을때는 사망 명부에 다시 포함되지 않아」) */
  /* ★ 0x1DD83 의 «그림 ≥ 300» 은 큰 괴물(특수 본체) 거르개다 — 숫자 말고 본체 의미(rules isSpecialBody · sprite_semantics)로 본다.
   *   ☠ 리마스터 특별그림(1101~·1201~ · 히어로 등)이 300 이상이라 사람인데도 명부밖이 되어, 한 번 리바이블한 뒤 그 사람이 죽으면 목록이 비었다
   *   (2026-11-08 사장님 「리바이블도 버그가 있어 … 이후 GS가 죽었는데, GS가 살아나지 않아.」·「직업 hero라서?」 — AI 쪽 같은 잘못은 10-07 에 이미 이렇게 고쳤다 · ai.js 특수본체) */
  var _특수본체 = (Ru && Ru.isSpecialBody) ? Ru.isSpecialBody(u) : ((u.sprIndex | 0) >= 0x12C);
  u.명부밖 = !!(mounted || (u.race | 0) === 2 || _특수본체);
  if (u.죽은차례 == null && !u.명부밖) {
    battle._죽은셈 = (battle._죽은셈 | 0) + 1;                 // 0x1DDA8 꼬리에 붙이기
    u.죽은차례 = battle._죽은셈;
  }
  /* ★★★★★ **죽으면 상태이상·버프가 사라진다** (2026-09-19 · PACKET 15 §1)
   *
   *   ```asm
   *   0x1DD35  mov [ecx+0x1e], 0x0      ; ★ 상태이상을 0 으로
   *   0x1DD39  mov al, [ecx+0x1e]       ;   방금 0 이 된 값을 읽어
   *   0x1DD3C  mov [ecx+0x15], al       ; ★ 1차상태(버프)에도 넣는다 = 0
   *   ── 같은 짝이 다른 갈래에도 있다 ──
   *   0x1DD65 · 0x1DD69 · 0x1DD6C
   *   ```
   *   ☠ 사망 함수 전문(`0x1DB1D`~`0x1DDEF` 198명령)에서 `[+0x1E]` 를 **쓰는** 곳은
   *     그 둘뿐이다 — 전수로 셌다. **어느 길로 죽어도 지워진다.**
   *
   *   ☠☠ 여태 우리는 거꾸로 **부활할 때** 지웠다 (`reviveUnit`). 그래서 —
   *     ① 죽어 있는 동안 상태가 남았고
   *     ② 버프 «수치»(`u.buff`)는 부활 뒤에도 안 지워졌으며 (실측 `buff.atk = 20`)
   *     ③ **소울리콜**로 살아나면 상태이상·버프가 **그대로** 남았다 (실측 `ailment = 8`)
   *   ⇒ 지우는 자리를 **원본과 같은 곳(사망)** 으로 옮긴다. 그러면 되살리는 길이
   *     무엇이든 저절로 맞는다.
   *
   *   ★ `[+0x15]` 는 문서가 「1차상태(버프)」라 부르는 칸이고, 우리 모델에서는
   *     `mbuff`(기록) + 그것이 `buff`·`eff` 에 더해 둔 **수치**다. 셋을 함께 되돌린다 —
   *     `mbuff` 만 비우면 효과가 안 사라진다. */
  /* ☠☠★★★★★ **raw 칸이 진짜다 — 모델 칸만 지우면 아무것도 안 지운 것이다**
   *   (2026-09-19 · PACKET 16 §0 · ChatGPT 독립 검수가 잡았다)
   *
   *   Packet 15 는 `ailment`·`mbuff`·`buff`·`eff`(제품의 «모델» 표현)만 지웠다.
   *   그런데 `rules.js` 가 실제 전투에서 쓰는 것은 **raw `f15`·`f1e`** 다 —
   *     `f15 & 0x08` 공격 +20 (`0x1D914`) · `& 0x40` 방어 +20 (`0x1D848`)
   *     `f15 & 0x20` MR +20 (`0x28641`) · `& 0x10` 대기 감소 (`0x19B62`)
   *     `f15 & 0x01/0x02/0x04` 원소 부여 (`0x175F8`) · `f1e & 8` 침묵
   *   ⇒ 실측: 죽어도 **`f15 = 249`(0xF9)** · **`f1e = 8`** 이 남아,
   *     **되살아난 유닛이 버프를 그대로 달고 있었다.**
   *
   *   원본 `0x1DD35`·`0x1DD3C` 는 그 두 칸을 **통째로** 0 으로 만든다.
   *
   *   ☠ **지속 슬롯 `st.d15`·`st.d1e` 는 안 건드린다** — 원본이 `[+0x16..]` 까지
   *     지우는지는 **근거가 없다**(§0 마지막 줄). `f15 = 0` 이라는 사실만으로
   *     지어내지 않는다. `tickDurations` 는 비트를 **끄기만** 하므로 남아도 해가 없다. */
  /* ★ 화면용 — 원본은 터지는 연출(0x1DBA1 0x463FB · 0x1DBB7 0x46B2C · 0x1DBC0 0x46A11)을 «먼저» 하고 0x1DD35 에서 지운다.
   *   그래서 상태이상·배리어 효과가 붙은 채로 터진다(2026-09-25 사장님 「원본은 죽을때에도 상태이상 효과가 있는 상태에서 터질텐데」).
   *   계산은 원본대로 여기서 지우고, 렌더러(ailmentFrames · tickAilmentFx)는 죽은 동안 이 사본을 본다. */
  사망상태지우기(u);                                          // 0x1DD35 · 0x1DD3C
  /* ★★★★★ **여기서 「연출 중」 표시를 켠다** — 원본은 리스트 제거가 **맨 끝**이다
   *   (2026-08-27 · 사용자 지적 두 번째)
   *
   *   > 「hp0 이벤트 대사 도중 **캐릭터 스프라이트 또 사라지네.**」
   *
   *   ```asm
   *   0x1DB43  [+0x48] = 0      HP 0
   *   0x1DB50  call 0x53797     ★ S4 대사   ← 이 동안 유닛은 **맵에 있다**
   *   0x1DB8B~ 0x463FB/0x46A11  사망 연출
   *   0x1DD9C  call 0x1137A     ★ **리스트 제거** — 맨 끝
   *   ```
   *
   *   ☠ 처음에는 `controller._대상사망`(평타 경로) **한 곳**에만 켰다.
   *     그런데 `kill()` 은 마법·지형 피해·S5·전멸 처리 등 **여러 경로**에서 불린다 —
   *     그 경로로 죽으면 `alive = false` 뒤 `updateUnit` 이 곧바로 숨겼다.
   *   ⇒ `alive = false` 를 세우는 **바로 이 자리**에서 켠다. 한 곳이면 다 덮인다.
   *
   *   ★ `DRIVER.death` 가 회전을 마치고 `0x465A8` 에서 끈다.
   *     연출이 끝내 안 돌아도 `R.clearDying()` 안전장치가 시체를 치운다.
   *   ★ 셈 모듈이 렌더러를 **아는 것이 아니라**, 있으면 알려 줄 뿐이다(가드). */
  try { if (표시포트 && 표시포트.dyingUnit) 표시포트.dyingUnit(u, true); } catch (e잔상) {}
  if (!riderSurvives && battle.at(u.x, u.y) === u) battle.setAt(u.x, u.y, null);

  var out = { unit: u, morale: null, exp: null, eld: 0, summons: [] };

  /* ② 사기 — 소환수는 변동 없음 */
  var isSummon = (u.summonerTag | 0) >= 10;
  if (Ru && Ru.moraleOnDeath) {
    var m = Ru.moraleOnDeath(battle.morale, u.side | 0, (u.base && u.base.cha) != null
              ? eff(battle, u).cha : 0, battle.T, isSummon);
    battle.morale.ally = m.ally; battle.morale.enemy = m.enemy;
    out.morale = { ally: m.ally, enemy: m.enemy, changed: !isSummon };
  }

  /* ③④ 경험치 · 보상 */
  var k = ctx.killer;
  if (k && k.alive && Ru) {
    k = 경험치받을이(battle, k);                                      // 0x17A36 부속유닛 → 본체 (+ [리마스터] 소환자)
    if ((k.job | 0) !== 0xA1) {                                      // 0x17A2C
      var gain = Ru.expGain(k.level | 0, u.level | 0);               // 0x17A61
      out.exp = 경험치적용(battle, k, gain, u, ctx.expOpt);
    }
    out.eld = u.reward | 0;
    battle.eld = (battle.eld | 0) + out.eld;                         // 0x17B4C
    /* ★★★ **그 자리에서 팀 돈에 더한다** — `0x17B3E dx = [0x8DF85](팀) · 0x17B45 ax = [죽은이+0x85] · 0x17B4C add [팀×4+0x8E36F], eax`
     *   (2026-10-08 · 사장님 「그리고 적 처치시 돈이 들어오지 않는 문제도 있어.」)
     *   ☠ battle.eld 에 쌓기만 하고 팀 돈에 넣는 곳이 없었다. 셸이 없으면(독립 전투) battle.eld 만 남는다. */
    if (out.eld && typeof root.G2셸소지금 === 'function' && typeof root.G2셸소지금설정 === 'function') {
      try { var 돈0 = root.G2셸소지금(); if (돈0 != null) root.G2셸소지금설정((돈0 | 0) + out.eld); } catch (e돈) {}
    }
  }

  /* ⓪ 여기가 `0x1DCF7` 자리다 — 탈것이었으면 **탑승자로 바뀌고 끝난다.**
   *   `0x1DD30 jmp 0x1DDAD` 가 아래 ⑤(맵·리스트 정리)를 건너뛴다.
   *   사기·경험치는 위에서 이미 줬다 — 원본도 그 순서다.
   *
   * ★★ 다만 **분리는 여기서 하지 않는다.** 사망 연출(`0x1DBB7 call 0x46B2C` ·
   *   `0x1DBC0 call 0x46A11`)이 이 분기보다 **앞**이다. 즉 원본은
   *   **말이 회전하며 터진 다음**에 탑승자가 나온다.
   *   여기서 바로 갈아 끼우면 연출이 이미 탑승자로 바뀐 슬롯을 터뜨리고 숨긴다.
   *   → 표시만 남기고, 연출이 끝난 뒤 `G2Combat.unmount()` 를 부른다. */
  if (riderSurvives) {
    out.unmountPending = true;
    /* ★★★★★ **탑승자가 곧 내린다는 표시** — 진영 전멸 판정이 이 유닛을 «남은 사람»으로 센다 (2026-10-05)
     *   사장님: 「2-4a에서 마지막에 임페리얼을 처치하면 이벤트 문구 나오고 클리어 처리가 되어버려. 클리어 아니고 안에 캐릭터가 나와야하는데」
     *   원본은 탑승자 분리(0x1DCF7 → 0x1DD30) «뒤에» 진영이 비었나(0x1DDD7)를 본다 — 탑승자가 명부에 있으니 전멸이 아니다.
     *   ☠ 우리는 분리를 사망 연출 뒤(finishDeath → unmount)로 미뤄, 그 사이 공격 직후의 전멸 판정(battle_main 0x1DDE3 자리)이
     *     진영 0명으로 보고 §11(적 전멸 → 클리어)을 터뜨렸다. 표시는 unmountOnDeath 가 푼다. */
    u._탑승자내림대기 = true;
    return out;                       // ⑤ 소환수 정리는 건너뛴다 (0x1DD30)
  }

  /* ⓐ 이 유닛을 쫓던 AI 목표 포인터를 끊는다 — 0x1DD41 call 0x1DAEE */
  out.droppedRefs = dropTargetRefs(battle, u);

  /* ⑤ 소환수 정리 — [+0x12] = 소환자 캐릭터코드 + 10 (0x29B73) */
  var tag = (u.charCode | 0) + 10;
  for (var i = 0; i < battle.units.length; i++) {
    var s = battle.units[i];
    if (s !== u && s.alive && (s.summonerTag | 0) !== 0 && (s.summonerTag | 0) === tag) {
      s.hp = 0; s.alive = false;
      사망상태지우기(s);                                      /* 정본 176 — 동반 소멸도 죽음이다(0x1DD35) */
      if (battle.at(s.x, s.y) === s) battle.setAt(s.x, s.y, null);
      out.summons.push(s);
    }
  }
  return out;
}

/* ══════════════════════════════════════════ 4. 통상 공격 (0x1F738 → 0x1DEAE) */

/** 지원 효과가 붙는가 — 0x1DEBF. 원거리(wt 5·0xB·0xC)는 안 붙습니다. */
function supportOn(wt) { return !(wt === 5 || wt === 0xB || wt === 0xC); }

/** 반경 1 마름모의 유닛들 (지원 효과용 — 0x1D862).
 *  ★ 원본 0x1D897 `0x1AC08(방어자 x, y, 반경 1)` → `0x1AC59` 는 위·왼·**가운데**·오른·아래 다섯 칸을 돈다
 *    (반복자를 그대로 흉내 내 셈 · 2026-10-07). 그 칸의 유닛(0x11DB2)에서 **공격자만** 뺀다(0x1D8C7 `cmp eax, edi`).
 *    ⇒ 가운데 칸의 «방어자 자신»도 한 번 들어가 적대가 아니므로 방어 +15%(0x1D8E7) 가 늘 붙는다.
 *    ☠ 예전에는 네 칸만 보고 자신을 빼서 물리 피해가 원본보다 컸다
 *      (2-4A 같은 씨앗 · 암흑기사→이올린 원본 1575 ↔ 우리 2520 — 할일정본 10-02 적 AI 대조). */
var 지원칸 = [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]];
function neighborsOf(battle, D, exclude) {
  var out = [];
  for (var k = 0; k < 지원칸.length; k++) {
    var n = battle.at(D.x + 지원칸[k][0], D.y + 지원칸[k][1]);
    if (n && n.alive && n !== exclude) out.push({ faction: n.side | 0, unit: n });
  }
  return out;
}

/**
 * 0x1EBFE — 무기 부가 상태이상. **크리티컬이 떴을 때만**([0xF0B8C] != 0) 돕니다.
 *   속성 = 0x18F52(무기), −1 이면 0x17531(공격 속성)
 *   회피한 대상·스프라이트 >= 300 은 건너뜁니다
 *   0 불   → 상성 > 0 이면 화상(0x01), 잔여 100
 *   1 얼음 → 상성 > 0 이면 행동불능(0x02), 잔여 100, 행동 리스트에서 뺌([+0x56] = 0)
 *   2 번개 → 상성 > 0 이면 감전(0x04), 잔여 100
 *   3 암흑 → 무조건 조작불가(0x10)
 *  −2      → 무조건 도트 +800(0x80), 잔여 [+0x27] = 100
 * 확률 굴림이 없습니다(0x28947 을 안 거칩니다).
 */
function 리마스터속성무기() {   /* [리마스터 규칙 «리마스터 무기 속성»] 11-13 — 언데드물리면역에서 떼어 냄 (사장님 「무기 속성 리마스터로 별도로」) */
  var 옵 = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;
  return !(옵 && 옵['무기속성'] === '원작');
}
/* ★ 정본 421 — 빙결을 걸면 원본 0x197AD 가 «대기열에서 빼기(0x19718) + 대기 0» 을 한다 · 대기만 0 으로 두면 이미 차례가 와 대기열에 든 유닛은 얼어도 그대로 움직였다
 *   (사장님 11-23 「캘리퍼 두번째 맵에서(로카르노 나가서 허공에 칼 휘두르는) 스타티어러로 얼린 적이 움직이는 버그도 있어.」 · 무기 빙결은 11-13 정본 146 에서 같은 까닭으로 고침)
 *   0x29437 을 거치는 원소 단계·빙룡 빙결과 원소 7단계 범위 밖 빙결(0x2A6A1)이 같은 길 · Sea Mist(0x44215)는 원본도 안 부름 */
function 빙결대기열빼기(battle, D) {
  var Tq = root.G2Turn, 실 = (D && D.unit) || D;
  if (Tq && Tq.consumeTurn && 실) { try { Tq.consumeTurn(battle, 실); } catch (e) { /* 대기열이 없는 시험 */ } }
}
function weaponStatus(battle, A, hits) {
  var Ru = R(), out = [];
  var av = view(battle, A);
  var attr = weaponStatusAttr(av.equip.weapon);
  /* [리마스터] 적소검·로드 넷 — 원본 0x18F52 에 없는 속성 무기도 크리티컬 때 상태이상 (rules.js 속성무기표 · 2026-10-13)
   *   언데드물리면역 토글과 한 묶음 — 「원작」이면 원본대로 0x17531 로 떨어진다 */
  if (attr === -1 && Ru && Ru.속성무기속성 && 리마스터속성무기()) attr = Ru.속성무기속성(av.equip.weapon);
  if (attr === -1) attr = Ru ? Ru.attackAttr(av, battle.T, battle.battleKind | 0) : -1;
  if (attr === -1) return out;
  for (var i = 0; i < hits.length; i++) {
    var h = hits[i];
    if (h.result === 'evade') continue;                       // 0x1EC41 cmp …,2
    var D = h.unit;
    if (!D.alive || spriteProfile(D).statusImmune) continue;        // 0x1EC57
    var dv = view(battle, D), 큐빼기 = false;
    var aff = Ru ? Ru.affinity(dv, attr < 0 ? 0 : attr, battle.T) : 10;
    if (attr === 0 && aff > 0)      { dv.f1e = (dv.f1e & 0xF8) | 1; dv.st.d1e[0] = 100; }
    /* ★ 0x1ECC1 call 0x197AD = 0x19718(대기열에서 뺀다) + [+0x56] = 0 — 대기만 0 으로 두면 이미 대기열에 든 유닛은 그대로 차례가 와
     *   «빙결이 안 걸린 것처럼» 움직였다 (2026-11-13 사장님 「바리사다의 경우 빙결이 안걸리고」 · 정본 146). 혼란(0x1ED14)·블리자드(0x3B4D8)와 같은 꼴 */
    else if (attr === 1 && aff > 0) { dv.f1e = (dv.f1e & 0xF8) | 2; dv.st.d1e[0] = 100; dv.wait = 0; 큐빼기 = true; }
    else if (attr === 2 && aff > 0) { dv.f1e = (dv.f1e & 0xF8) | 4; dv.st.d1e[0] = 100; }
    /* ★ 0x1ECFA or [+0x1E],0x10 · **0x1ED01 [+0x23] = 100** — 칸[2] 잔여가
     *   빠져 있었다(2026-08-30). 잔여가 0 이면 혼란이 **안 풀린다**. */
    else if (attr === 3)            {
      dv.f1e |= 0x10; dv.st.d1e[2] = 100;
      /* ★★★ **혼란에 걸린 아군은 조작 차례를 잃는다** (2026-08-30)
       *   0x1ED07  cmp dh, 1 / jne         ; 진영 1(아군)만
       *   0x1ED0C  cmp byte [ebx+0x56], 0xFF / jne
       *   0x1ED14  call 0x19718            ; ★ **대기열에서 민다**
       *   `[+0x56]`(= `waitCount`) `0xFF` 는 **행동 가능**이라는 뜻이다.
       *   푸는 쪽은 이미 있었다 — Cure(`0x2B30D call 0x196D0`). */
      var _Tn = root.G2Turn, _실 = D.unit || D;
      if ((D.side | 0) === 1 && (_실.waitCount | 0) === 0xFF &&
          _Tn && _Tn.dequeueReady) {
        try { _Tn.dequeueReady(battle, _실); } catch (e) { /* 무시 */ }
      }
    }
    else if (attr === -2)           { dv.f1e |= 0x80; dv.st.d1e[4] = 100; }
    else continue;
    commit(battle, D, dv);
    if (큐빼기) {                                                   /* 0x197AD → 0x19718 (turn.js consumeTurn = 빼기 + [+0x56] = 0) */
      var _Tq = root.G2Turn, _Dq = D.unit || D;
      if (_Tq && _Tq.consumeTurn) { try { _Tq.consumeTurn(battle, _Dq); } catch (eq) { /* 대기열이 없는 시험 */ } }
    }
    out.push({ unit: D, attr: attr, f1e: dv.f1e, 큐빼기: 큐빼기 });
  }
  return out;
}

/**
 * 한 대상에 대한 한 방 — 0x1DDF0 판정 + 0x1D770 피해.
 * @returns {{unit, result, roll, evadeRate, blockRate, facing, attackType, damage}}
 */
/** 0x2CACA — 피해 + 피해 × s8 ITEM[무기 +0x5B].+0x39 ÷ 100 (idiv · 무기 0 이면 0x184AC 0) */
function 무기필살위력(A, dmg) {
  var _w = (A.gear && A.gear.weapon) | 0;
  var _wr = (_w && root.G2Item && root.G2Item.table) ? root.G2Item.table[_w] : null;
  var _wp = _wr ? (_wr.필살기위력 | 0) : 0;
  return _wp ? dmg + Math.trunc(dmg * _wp / 100) : dmg;
}

function strike(battle, A, D, crit, opts) {
  var Ru = R(), T = battle.T;
  var av = view(battle, A), dv = view(battle, D);
  var wt = weaponTypeOf(battle, A);
  var rng = opts.rng || (Ru.makeRng ? Ru.makeRng() : null);

  /* ★ opts.판정없음 — 초필살기 피해(0x2CAF7 · 교아 0x354DE · 풍아 0x35F5C)는 명중 판정 0x1DDF0 없이 곧바로 0x1D770 이다
   *   (회피·방어가 없고 판정 난수 rand(100) 도 안 굴린다 · 2026-09-26 무인 직독) */
  var hit = opts.판정없음 ? { result: 'hit', roll: 0, evadeRate: 0, blockRate: 0, facing: null }
                          : Ru.hitCheck(av, dv, { tables: T, rng: rng });   // 0x1DDF0 (dx != 1 경로)
  var out = { unit: D, result: hit.result, roll: hit.roll, evadeRate: hit.evadeRate,
              blockRate: hit.blockRate, facing: hit.facing, attackType: crit,
              damage: 0, hpBefore: D.hp | 0, hpAfter: D.hp | 0, died: false, kill: null };
  /* ★ 회피·방패 방어면 방어자가 공격자 쪽으로 돌아선다 — 피해 계산 «전»이다 (2026-10-07)
   *   회피 0x1E091 call 0x461C6 · 방어 0x1E1B1 call 0x4609A(대상, [공격자+0x63]) → [대상+0x63] = (공격자 방향 + 2) % 4
   *   (점프표 0x4608A·0x461B6 둘 다 0→2 · 1→3 · 2→0 · 3→1) — 그 뒤 0x1E1F5 0x1D770 이 돌아선 방향으로 방향 보정을 한다.
   *   실측(2-4A 씨앗 12345 넘김 3): 암흑기사(14,26 방향 2)→로카르노(14,24 방향 3) 방어 크리 — 원본 0x1D770 진입 때 로카르노 방향 0 · 피해 1575.
   *   ☠ 전에는 안 돌려 측면(3)으로 계산해 3675 가 들어갔다. 반격 판정도 막거나 피했으면 이 돌아선 방향(아래 ④ · 11-09) · 그냥 맞았으면 맞기 전 방향(rep.피격전방향 · 10-01). */
  if (!opts.판정없음 && (hit.result === 'evade' || hit.result === 'block')) {
    D.dir = ((A.dir | 0) + 2) & 3;
    dv.dir = D.dir;
  }
  if (hit.result === 'evade') return out;                          // 0x1E070

  /* 방패에 막히면 공격 종류가 1 로 내려갑니다 — 0x1E1D2 / 0x1E1EF */
  var at = crit;
  if (hit.result === 'block') at = (crit !== 0) ? 1 : 0;
  out.attackType = at;

  var support = opts.support !== undefined ? opts.support : supportOn(wt);
  var dmg = Ru.physicalDamage(av, dv, {
    tables: T, rng: rng,
    attackType: at,
    support: support,
    neighbors: support ? neighborsOf(battle, D, A) : [],
    morale: battle.morale,
    shieldDef: hit.result === 'block' ? hit.shieldDef : 0,         // 0x1E1C0 → 0x1E20A
    deriveA: opts.deriveA || eff(battle, A),
    deriveD: eff(battle, D),
    atkOverride: opts.atkOverride,
    attr: opts.attr !== undefined ? opts.attr : attackAttr(battle, A),
    phase: battle.battleKind | 0,
    confuse: battle.confuse
  });
  if (opts.피해배수) dmg = dmg * (opts.피해배수 | 0);                  // 교아 0x354E3 shl eax,2 · 풍아 — 공격력이 아니라 «피해»에 곱한다
  if (opts.피해십분) dmg = Math.trunc(dmg * (opts.피해십분 | 0) / 10);  // 연타 0x2D3E5 imul 20·25·30 → idiv 10 — «피해»에 곱한다
  if (opts.plusA) dmg += opts.plusA | 0;                           // 0x2CB3B  필살기 상수 a
  /* ★ 무기 필살 위력 — 0x2CACA(유닛, 피해): 피해 + 피해 × s8 ITEM[무기 +0x5B].+0x39 ÷ 100 (idiv · 0 쪽으로 버림 · 무기 0 이면 0x184AC 0)
   *   연타 0x2D403 · 직선 0x2ED29 · 활 연 0x2F175 · 교아 0x354EE · 풍아 0x35F72 만 부른다 — «+a 까지 더한 피해»에 건다 (2026-09-26 무인 직독)
   *   ☠ 예전에는 어디에도 없었다 */
  if (opts.무기필살보정) dmg = 무기필살위력(A, dmg);
  out.damage = dmg;
  if (opts.계산만) return out;                                     // 0x1D770 은 값만 낸다 — 깎기는 부르는 쪽(활 연 0x2F321~)
  var res = applyDamage(battle, D, dmg, { killer: A, reason: opts.reason || 'attack',
                                          사망유예: !!opts.사망유예 });   /* ★ 0x1ED45 (GPT 28차) */
  out.hpAfter = res.hpAfter; out.died = res.died; out.kill = res.kill;
  if (res.사망유예) out.사망유예 = true;
  return out;
}

/**
 * 통상 공격 한 번 — 사양서 §13 의 ①~⑤ 순서를 그대로 돕니다.
 *
 * @param {object} opts {
 *     rng, targets:[유닛], free:true(=TP 안 냄), noCounter:true, tp:40 }
 * @returns {object} 자세한 보고서
 */
/**
 * ★★★★★ **공격 계획** — 원본 `0x1F738` 의 **대상 확정까지** (2026-08-22 · GPT 27차)
 *
 *   원본은 대상 목록(`0x80648` · 개수 `0x80B9E`)을 **먼저 채우고**
 *   `0x1DDF0(dx=1)` 에 들어가서, 그 머리에서 **S3(`0x1DE15`)** 를 부른다.
 *   ⇒ S3 는 **대상이 확정된 뒤 · 첫 피해 전**이다 (`SCE_HP변경_창구.md` §3-q).
 *
 *   그래서 `attack()` 을 둘로 나눈다. 컨트롤러가 그 사이에서 S3 를 **기다린다**.
 *   ★ `attack()` 껍데기는 그대로 남으므로 기존 호출부는 안 바뀐다.
 *
 *   @returns {object} `{ ok, targets, tpCost }` 또는 `{ ok:false, reason }`
 */
function attack계획(battle, A, D, opts) {
  opts = opts || {};
  var Ru = R();
  if (!Ru) return { ok: false, reason: 'rules.js 가 없습니다' };
  if (!A || !A.alive) return { ok: false, reason: '공격자가 없습니다' };

  var tpCost = opts.tp != null ? (opts.tp | 0) : 0x28;             // 0x4D45C · 0x4016A  TP 40
  if (!opts.free && (A.tp | 0) < tpCost) return { ok: false, reason: 'TP 부족', need: tpCost };

  var targets = opts.targets || (D ? [D] : []);
  targets = targets.filter(function (t) { return t && t.alive; });
  if (!targets.length) return { ok: false, reason: '대상이 없습니다' };

  /* 사거리 — 링 커맨드 0 도 0x1D124 로 대상이 있는지부터 봅니다(0x4BD9C).
   * 연출·스크립트에서 억지로 때릴 때는 opts.force 로 건너뜁니다. */
  if (!opts.force) {
    var cells = attackCells(battle, A), inRange = true;
    for (var n = 0; n < targets.length; n++) {
      var found = targetInCells(battle, targets[n], cells);
      if (!found) { inRange = false; break; }
    }
    if (!inRange) return { ok: false, reason: '사거리 밖', cells: cells.length };
  }

  /* ★★★ 무기 0x11·0x12(배 대포 등) — 고른 칸을 중심으로 «십자»(반경 1 마름모) 안의 적 모두 (2026-10-10 원본 직독)
   *   플레이어 0x1F776~0x1F81C: 0x1F19C 로 칸을 고른 뒤 0x1AC08(그 칸, 반경 edi=1) → 0x1A1F8(칸, 공격자 진영) 로 등록
   *   AI 0x40D4C~0x40D61 → 0x409AD: 0x409CC 0x1AC08(대상 칸, 반경 1) — 같은 십자
   *   (사장님 「공격범위에서 한칸을 선택하면 그 점 기준으로 십자가 형태를 말하는거야」) */
  var _wt대포 = weaponTypeOf(battle, A);
  if ((_wt대포 === 0x11 || _wt대포 === 0x12) && !opts.targets && D) {
    var _십자 = diamond(battle, D.x | 0, D.y | 0, 1, true), _모음 = [];
    _십자.forEach(function (c) {
      var t = battle.at(c.x, c.y);
      if (t && t.alive && t !== A && _모음.indexOf(t) < 0 && hostile(A.side, t.side, battle.confuse)) _모음.push(t);
    });
    if (_모음.indexOf(D) < 0 && D.alive) _모음.unshift(D);
    targets = _모음;
  }

  /* ★ S3 자리 — 여기서 **컨트롤러가 끼어든다** (0x1DE15).
   *   대상은 확정됐고 피해는 아직 하나도 안 들어갔다. 크리티컬도 아직 안 굴렸다
   *   (원본 크리티컬 `0x1D6B1` 은 `0x1DEA7`(dx!=1) 갈래 = **S3 뒤**다). */
  return { ok: true, attacker: A, targets: targets, tpCost: tpCost, 원본경계: '0x1DE15' };
}

/* ══════════════════════════════════════════════════════════════════
 *  ★★★ **마법검** — 크리티컬이면 무기가 마법을 낸다 (2026-09-16 신설 · 2026-10-10 함수로 뺌)
 *
 *  원본 `0x1E989` — **크리티컬이면** `0x19168` 로 간다 (`공격모션_분석.md:175`).
 *  0x1E989 는 평타 함수 0x1E61D 안이라 그것을 부르는 반격(0x1F145)도 같은 판정을 탄다
 *  (2026-10-10 사장님 「반격 크리티컬시 무기 마법(선더액스 같은거) 안나가」 — 전엔 평타만 불렀다).
 *  표는 `js/magicsword.js` 가 들고 있다 (`마법검_시스템.md` · EXE 검증본).
 *
 *  ☠☠ **원본은 무기마다 «전용 루틴»** 이라 마법 번호로 부르지 않는다.
 *    우리는 같은 마법을 `cast(…, {free:true})` 로 낸다 — 「뜻을 옮긴다」.
 *    `G2MagicSword.발동인가()` 가 꺼져 있으면 판정만 적어 둔다.
 *  ☠☠ **MP·TP 를 안 먹는다** — 원본 마법검은 «전용 루틴»이라 마법 시전
 *    경로(`0x434D2` MP · `0x28480` TP)를 **아예 안 탄다.** `cast` 를 빌려 쓰므로
 *    깎인 값은 손수 되돌린다 (실측: 엑스칼리버 크리티컬에 MP 100 → 70).
 * @returns {object|null} `{weapon, spell, fired, result, …}` — 크리티컬이 아니거나 마법검 무기가 아니면 null
 * ══════════════════════════════════════════════════════════════════ */
function 마법검쏘기(battle, A, crit, 대상들, opts) {
  opts = opts || {};
  var MS = root.G2MagicSword;
  if (!MS || !crit || !A) return null;               /* 크리티컬이 아니면 안 본다 */
  var 무기 = (A.gear && A.gear.weapon) | 0;
  var 행 = MS.행찾기(무기);
  if (!행) return null;
  var ms = { weapon: 무기, weaponName: 행.무기이름,
             spell: 행.마법 | 0, spellName: 행.마법이름,
             fired: false, 근거: 행.발동VA };
  if (!MS.발동인가()) return ms;
  try {
    var mp앞 = A.mp | 0, tp앞 = A.tp | 0, 충전앞 = A.chargeTp | 0;
    var 목록 = (대상들 || []).filter(function (t) { return t && t.alive !== false; });
    var 마o = { rng: opts.rng, free: true };
    /* ★ 턴언데드 마법검(0x19224)은 마법을 «시전»하지 않는다 — 이번 공격의 대상 배열 [0xF0648] 을 돌며
     *   적대(0x1201D)이고 언데드([+0x0D]==2)면 0x59675 연출 → HP −1. 시전자 둘레가 아니다
     *   (2026-10-10 사장님 「턴언데드가 크리티컬 효과인 무기들(엑스칼리버, 영광의홀 등)은 피격 캐릭터에게만 적용되어야하는데, 주변으로 전체 적용이 돼」) */
    /* ★ 언데드 거르기 0x19264 cmp byte [+0x0D],2 — 맞은 적대 «언데드»만. 하나도 없으면 아무것도 안 난다(효과음 0x770B7 assist-d 만 싣고 고리가 빈다)
     *   (2026-10-13 사장님 「턴언데드를 시전하는게 아니라 피격 대상만 발동하는거야. 그것도 언데드인 경우에만」) */
    if ((행.마법 | 0) >= 72 && (행.마법 | 0) <= 74) {
      마o.대상고정 = 목록.filter(function (t) { return hostile(A.side, t.side, battle.confuse) && (t.race | 0) === 2; });
      if (!마o.대상고정.length) return ms;
      ms.대상 = 마o.대상고정.slice();
    }
    var r2 = cast(battle, A, 행.마법 | 0, (마o.대상고정 && 마o.대상고정[0]) || 목록[0] || null, 마o);
    A.mp = mp앞; A.tp = tp앞; A.chargeTp = 충전앞;
    ms.fired = !!(r2 && r2.ok);
    ms.result = r2;
    ms.무료 = true;
  } catch (e) {
    ms.error = (e && e.message) || String(e);
  }
  return ms;
}

/**
 * ★ **공격 실행** — S3(`0x1DE15`) **뒤**의 나머지 전부.
 *   @param 계획 `attack계획()` 이 돌려준 것
 */
function attack실행(battle, A, 계획, opts) {
  opts = opts || {};
  var Ru = R();
  if (!Ru) return { ok: false, reason: 'rules.js 가 없습니다' };
  if (!계획 || !계획.ok) return 계획 || { ok: false, reason: '계획이 없습니다' };
  A = A || 계획.attacker;
  var targets = 계획.targets, tpCost = 계획.tpCost | 0;

  /* ① 크리티컬 — 공격 한 번에 한 번만 굴립니다 ([0xF0B8C]) */
  var av = view(battle, A);
  var crit = Ru.critCheck(av, battle.T, opts.rng || Ru.makeRng());  // 0x1D6B1
  commit(battle, A, av);                                           // 셔플백 순번 저장
  critBag(battle, A).hits++;

  var rep = { ok: true, attacker: A, attackType: crit, tpCost: 0, tpCost0: tpCost,
              results: [], status: [], counters: [], deaths: [], exp: [] };
  /* ★ 반격 판정(0x1F07C 「보는 앞칸에 공격자」)은 «맞기 전» 방향으로 한다 — 맞으면 공격자 쪽으로 돌아서므로
   *   (battle_main faceToward) 그 뒤 방향으로 재면 옆·뒤에서 맞아도 반격이 났다.
   *   (2026-10-01 사장님 「옆에서 공격을 받았는데 반격을 했다고」 · 「맞으면 방향전환하는거 맞아. 다만 반격은 같은 방향일때만 하는거고,
   *    필살기 반이 방향 상관없이 반격하는거고」) */
  rep.피격전방향 = (targets || []).map(function (t) { return { unit: t, dir: (t && t.dir) | 0 }; });

  /* ══════════════════════════════════════════════════════════════════
   *  ★★★ **마법검** — 크리티컬이면 무기가 마법을 낸다 (2026-09-16 신설)
   *
   *  원본 `0x1E989` — **크리티컬이면** `0x19168` 로 간다 (`공격모션_분석.md:175`).
   *  표는 `js/magicsword.js` 가 들고 있다 (`마법검_시스템.md` · EXE 검증본).
   *
   *  ☠☠ **원본은 무기마다 «전용 루틴»** 이라 마법 번호로 부르지 않는다.
   *    우리는 같은 마법을 `cast(…, {free:true})` 로 낸다 — 「뜻을 옮긴다」.
   *    ⇒ 원본과 다르게 가는 것이라 **기본은 꺼 둔다**(`G2MagicSword.발동인가()`).
   *    ☐ 연출 프레임 대조를 마치면 켠다. 그 전까지 **판정만 하고 리포트에 적어**
   *      둔다 — 무엇이 나올 뻔했는지는 보이되, 전투 수치는 안 건드린다. */
  rep.magicSword = 마법검쏘기(battle, A, crit, targets || [], opts);
  if (rep.magicSword && rep.magicSword.fired && rep.magicSword.result) {
    /* ★ 마법검에 죽은 유닛도 이 공격의 사망·경험치로 센다 — 원본 전용 루틴이 같은 사망 처리로 간다 (2026-10-03) */
    (rep.magicSword.result.deaths || []).forEach(function (d) { if (d && rep.deaths.indexOf(d) < 0) rep.deaths.push(d); });
    (rep.magicSword.result.exp || []).forEach(function (x) { rep.exp.push(x); });
  }
  if (!rep.magicSword) delete rep.magicSword;

  /* ② 대상마다 판정 + 피해 — 원본 `0x1DEA7` 이후 */
  for (var i = 0; i < targets.length; i++) {
    /* ★ 마법검이 먼저 쓰러뜨린 대상은 물리 피해를 다시 받지 않는다 — 사망 처리가 두 번 돌지 않게 */
    if (rep.magicSword && rep.magicSword.fired && targets[i] && targets[i].alive === false) continue;
    var r = strike(battle, A, targets[i], crit, opts);
    rep.results.push(r);
    if (r.died && !r.사망유예) {
      rep.deaths.push(r.unit);
      if (r.kill && r.kill.exp) rep.exp.push(r.kill.exp);
    }
  }

  /* ★★★★★ **`0x1ED45` 대상 후처리 목록** — 사망유예일 때만 (GPT 28차)
   *
   *   ```asm
   *   0x1ED4A  mov ecx, eax           ; ecx = **시전자**
   *   0x1ED5C  cmp [대상+0x48], 0     ;   HP 재판정
   *   0x1ED60  jg 0x1ED75
   *     사망 : mov edx,대상 / mov eax,ecx / call 0x1DB1D / [배열]=null
   *     생존 : mov ebx,1   / mov edx,ecx / call 0x53797   ← 0x1ED7C S4
   *   0x1ED82  cmp si,[0x80B9E] / jl  ; 대상 배열 **순서 그대로**
   *   ```
   *
   *   ★ 여기서는 **목록만 만든다.** 실행은 컨트롤러다 —
   *     사망(`0x1DB50`)·생존(`0x1ED7C`) 둘 다 이벤트를 **기다려야** 하고,
   *     `combat.js` 는 `SceRuntime` 을 모르는 순수 규칙층이다. */
  if (opts.사망유예) {
    rep.후처리대상 = targets.slice();      /* ★ 대상 배열 순서 그대로 */
    rep.사망유예 = true;
    rep.원본경계 = '0x1ED45';
  }

  /* ★★ `0x1E2B7` — **맞으면 행동 봉쇄 상태이상이 풀린다.**
   *
   * ```asm
   * 0x1E2BD  edx = 대상배열[i]
   * 0x1E2C5  없으면 건너뜀
   * 0x1E2C7  test [edx+0x1E], 0x2 ; je 0x1E2DD    ; ★ 빙결이면
   * 0x1E2CD    mov [edx+0x1F], 0xFFFF             ;   지속 = −1(없음)
   * 0x1E2D9    and [eax+0x1E], 0xF8               ;   ★ 하위 3비트(독1·빙결2·마비4) 지움
   * 0x1E2DD  다음 대상 ([0x80B9E] 개)
   * ```
   *
   * 사용자 확인 2026-08-14: 「빙결의 경우 풀리는 시간도 있을 거고, **맞아도 풀려**.」
   *
   * ★ **시간으로는 안 풀립니다.** 지속 `[+0x1F]` 를 **깎는 코드가 EXE 에 한 곳도
   *   없습니다** — 쓰는 곳 10군데가 전부 대입입니다
   *   (`0x3B4CC` 0x5A · `0x1EC7F` 0x64 · `0x19973` 0x32 · `0x1E2CD` 0xFFFF …).
   *   `0x199B3` 이 `[+0x1F] & 1` 로 **홀짝만** 보므로 「남은 턴 수」도 아닙니다.
   *   풀리는 길은 `and [+0x1E], 0xF8` **세 곳뿐**입니다 —
   *     `0x1E2D9` 평타 피격(여기) · `0x19C23` 버프 `[+0x15] & 0x40` ·
   *     `0x29494` 마법(Cure 계열, 대형 `>= 300` 은 제외)
   */
  for (var z = 0; z < rep.results.length; z++) {
    var zt = rep.results[z] && rep.results[z].unit;
    if (!zt) continue;
    var zv = view(battle, zt);
    if (!((zv.f1e | 0) & 2)) continue;                 // 0x1E2C7
    zv.st.d1e[0] = 0xFFFF;                             // 0x1E2CD
    zv.f1e = (zv.f1e | 0) & 0xF8;                      // 0x1E2D9
    commit(battle, zt, zv);
    rep.status.push({ unit: zt, cured: '행동봉쇄', 근거: '0x1E2D9' });
  }

  /* ③ 무기 부가 상태이상 (크리티컬일 때만) */
  if (crit !== 0) rep.status = rep.status.concat(weaponStatus(battle, A, rep.results));

  /* ★★★ **반격은 `0x1ED45` 뒤다** — 원본 순서 (2026-08-22 · GPT 28차)
   *
   *     0x1E61D 연출 → (단발만) 0x1EBFE → 0x1EF5C → **0x1ED45** → 0x1EF9A 반격
   *
   *   그래서 `사망유예` 면 여기서 멈추고, 컨트롤러가 `0x1ED45` 를 처리한 뒤
   *   `attack반격()` 을 부른다. TP 도 원본에선 `0x1F738` **밖**(`0x45B4E`)이라 뒤다. */
  if (opts.사망유예) { rep.반격보류 = true; return rep; }

  attack반격(battle, A, rep, opts);
  return rep;
}

/**
 * ★ **반격 + TP** — 원본 `0x1EF9A`(반격) 와 `0x45B4E`(TP). **`0x1ED45` 뒤**다.
 *   `attack실행()` 이 `사망유예` 로 멈췄을 때 컨트롤러가 부른다.
 */
/**
 * ★★★★★ **맞은 쪽 돌려세우기** — `0x1EE23`(공격자) · `0x137B0`(유닛, 방향) (2026-11-08 Genesis2 EXE 직독)
 *   반격 함수 0x1EF9A 가 반격 횟수를 다 정한 «뒤»(0x1F100) 부른다 — 0x1EF9A 를 안 타는 공격(원거리·여러 대상 [esp+0xC]=1 · 군단 연속 공격 셋째)은 안 돌린다.
 *   ```asm
 *   0x1EE2D  call 0x174CF ; cmp al,4 / jne 0x1EF14          ; 공격자 무기가 도끼(4)인가
 *   ── 도끼: 방향 셋 d0 = (A+2)%4 · d1 = (d0+1)%4 · d2 = (d0+2)%4 (= A)
 *   0x1EE9D  0x49ABC 한 칸 앞 → 0x1EEB8 0x1AD62 → 0x1EEC5 0x1AE48 칸 셋(앞 · 안쪽 · 줄바꿈 — attackCells 도끼 주석)
 *   0x1EEEF  0x1201D(그 칸 유닛, 공격자) == 1(적대)이면 0x1EF06 0x137B0(유닛, d[i])
 *   ── 그 밖: 0x1EF1D 대상 목록 [0xF0648+i] 마다 0x1EF45 0x137B0(대상, (A+2)%4)
 *   0x137B0  [+0x61] ≥ 0x12C 이거나 [+0x1E]&2 면 탈것 0x27~0x2C(군단 근접 병종)일 때만 · 아니면 늘 → [+0x63] = 방향
 *   ```
 *   ⇒ 옆·뒤에서 맞은 군단 근접 병종은 첫째 공격엔 반격 안 하고(맞기 전 방향) 돌아서서, 둘째 공격엔 마주 보므로 반격한다.
 *   ★ 도끼 셋째 칸(d2 = 공격자와 같은 방향)은 공격자를 마주 보지 않는다 — 원본 그대로 옮긴다.
 *   ★ 그림 ≥ 300 은 본체 의미(isSpecialBody)로 본다 — 리마스터 특별그림 사람은 돈다 ([[remaster-sprite-not-big-monster]]).
 *   (사장님 11-08 「방향이 다른곳에서 공격하면 첫번째 공격에 방향이 전환되고 두번째 공격에 반격하고 세번째 반격 안한다는거지?」·
 *    「마장기의 경우 공격범위도 각각 다른데 이때 반격 판정도 확인해야해 예를들면 아수라는 도끼계열처럼 전좌우를 공격하는데 …」)
 */
function 돌려세움(u, 방향) {                                                       /* 0x137B0 */
  if (!u || !u.alive) return;
  var Ru = R(), 특수 = (Ru && Ru.isSpecialBody) ? Ru.isSpecialBody(u) : ((u.sprIndex | 0) >= 0x12C);
  if (특수 || ((u.f1e | 0) & 2)) {
    var 탈 = ((u.gear && u.gear.mount) | 0);
    if (!(탈 >= 0x27 && 탈 <= 0x2C)) return;                                       /* 0x137C2 · 0x137C7 */
  }
  u.dir = 방향 & 3;                                                                /* 0x137CC */
}
function 피격돌려세우기(battle, A, rep) {
  if (!A) return;
  var d0 = ((A.dir | 0) + 2) & 3;
  if (weaponTypeOf(battle, A) === 4) {                                             /* 0x1EE32 */
    var 방향들 = [d0, (d0 + 1) & 3, (d0 + 2) & 3];
    /* 원본 차례 = 앞 · 안쪽 · 줄바꿈 — attackCells 도끼는 «앞 · 오른 · 왼» 차례라 원본 차례(도끼원본칸)로 따로 세운다 */
    var 원본차례 = 도끼원본칸(A);
    for (var i = 0; i < 원본차례.length; i++) {
      var t = battle.at(원본차례[i].x, 원본차례[i].y);
      if (t && t.alive && t !== A && hostile(A.side, t.side, battle.confuse)) 돌려세움(t, 방향들[i]);   /* 0x1EEEF · 0x1EF06 */
    }
    return;
  }
  ((rep && rep.results) || []).forEach(function (r) { if (r && r.unit) 돌려세움(r.unit, d0); });   /* 0x1EF1D~0x1EF45 */
}
/** 도끼 칸 셋 — 원본 차례(0x1AE48): 방향 0 (x,y+1)·(x−1,y)·(x+1,y) · 1 (x−1,y)·(x,y−1)·(x,y+1) · 2 (x,y−1)·(x+1,y)·(x−1,y) · 3 (x+1,y)·(x,y+1)·(x,y−1) */
function 도끼원본칸(A) {
  var x = A.x | 0, y = A.y | 0;
  switch ((A.dir | 0) & 3) {
    case 0: return [{ x: x, y: y + 1 }, { x: x - 1, y: y }, { x: x + 1, y: y }];
    case 1: return [{ x: x - 1, y: y }, { x: x, y: y - 1 }, { x: x, y: y + 1 }];
    case 2: return [{ x: x, y: y - 1 }, { x: x + 1, y: y }, { x: x - 1, y: y }];
    default: return [{ x: x + 1, y: y }, { x: x, y: y + 1 }, { x: x, y: y - 1 }];
  }
}

function attack반격(battle, A, rep, opts) {
  opts = opts || {};
  var tpCost = rep.tpCost0 !== undefined ? (rep.tpCost0 | 0)
             : (opts.tp != null ? (opts.tp | 0) : 0x28);
  /* ④ 반격 — 0x1EF9A
   *   ★ 원거리·여러 대상 무기는 반격을 «받지» 않는다 — 0x1F738 이 무기 5·0x0B·0x0C·0x0F·0x10·0x11·0x12·0x13 이면 0x1F877 [esp+0xC]=1,
   *     보통 갈래 끝 0x1F9A4 cmp [esp+0xC],0 / jne 0x1F9B2 로 0x1F9AD call 0x1EF9A 를 건너뛴다 (2026-11-08 Genesis2 EXE 직독)
   *   ☠ 없어서 군단 궁병(0x0F)·마법병(0x10)·포병(0x11)이 쏴도 마주 보는 근접 병종(직업 134~139 — 거리를 안 본다)이 반격했다
   *   (사장님 11-08 「반격이 불가능한 공격도 있고」) · 군단 근접 연속 공격 고리(0x1F905)는 이 표시를 안 본다 — 그 병종은 무기 1 이라 해당 없음 */
  var _무기A = weaponTypeOf(battle, A), _반격못받음 = [5, 0x0B, 0x0C, 0x0F, 0x10, 0x11, 0x12, 0x13].indexOf(_무기A) >= 0;
  if (!opts.noCounter && !_반격못받음) {
    피격돌려세우기(battle, A, rep);                                   /* 0x1F100 call 0x1EE23 — 반격 횟수는 «맞기 전» 방향으로 정하고(rep.피격전방향) 맞은 쪽은 돌아선다 */
    for (var k = 0; k < rep.results.length; k++) {
      var t = rep.results[k].unit;
      if (!t.alive) continue;
      var 전 = null;
      for (var q = 0; rep.피격전방향 && q < rep.피격전방향.length; q++)
        if (rep.피격전방향[q].unit === t) { 전 = rep.피격전방향[q].dir; break; }
      /* ★ 막거나 피했으면 «먼저 돌아선» 방향으로 판정한다 — 원본 0x4609A(방어)·0x461C6(회피)가 [+0x63] 을 (공격자 방향+2)%4 로 쓴 «뒤»
       *   0x1EFC1 이 반격을 정한다(0x1F07C 가 그 [+0x63] 으로 앞칸을 잰다). 그냥 맞은 것만 맞기 전 방향(맞고 도는 것은 0x1F100 뒤).
       *   사장님 11-09 「회피나 방어시에는 방향 전환이 먼저 되는거 맞고. 일반적으로 피격 당했을때는 맞고 도는건데」 */
      var 결 = rep.results[k].result;
      if (결 === 'block' || 결 === 'evade') 전 = ((A.dir | 0) + 2) & 3;
      var c = counter(battle, t, A, 전 == null ? opts : Object.assign({}, opts, { 피격전방향: 전 }));
      if (c && c.count) rep.counters.push(c);
      /* 반격 마법검에 죽은 유닛 · 경험치 — 이 공격의 사망 목록으로 (평타 마법검과 같다) */
      if (c && c.deaths) c.deaths.forEach(function (d) { if (d && rep.deaths.indexOf(d) < 0) rep.deaths.push(d); });
      if (c && c.exp) c.exp.forEach(function (x) { rep.exp.push(x); });
      if (!A.alive) break;
    }
  }

  if (!opts.free) { A.tp = Math.max(0, (A.tp | 0) - tpCost); rep.tpCost = tpCost; }
  rep.morale = { ally: battle.morale.ally, enemy: battle.morale.enemy };
  rep.반격보류 = false;
  return rep;
}

/**
 * 통상 공격 — `0x1F738`. **동기 한 방** (기존 호출부 호환).
 *
 *   ★ S3(`0x1DE15`)를 기다려야 하는 통합 경로는 이것을 쓰지 말고
 *     `attack계획()` → *S3 대기* → `attack실행()` 을 쓴다 (`controller.js`).
 */
function attack(battle, A, D, opts) {
  var 계획 = attack계획(battle, A, D, opts);
  if (!계획.ok) return 계획;
  return attack실행(battle, A, 계획, opts);
}

/**
 * 반격 — 0x1EF9A. 판정은 `Rules.counterAttack`(원본 버그 포함) 이 하고
 * 여기서는 그 횟수만큼 실제로 때립니다(0x1F13E → 0x1DDF0 → 0x1D770).
 */
function counter(battle, defender, attacker, opts) {
  opts = opts || {};
  var Ru = R();
  if (!Ru || !defender || !defender.alive || !attacker || !attacker.alive) return null;
  var dv = view(battle, defender), av = view(battle, attacker);
  if (opts.피격전방향 != null) dv.dir = opts.피격전방향 & 3;      /* 맞기 전 방향으로 판정 (attack실행 rep.피격전방향) */
  var list = Ru.counterAttack(av, [dv], {
    tables: battle.T,
    dist: function (a, b) { return dist(a, b); },
    frontUnit: function (u) {                                     // 0x1F07C  보는 앞칸
      var d = DIR[u.dir & 3], t = battle.at(u.x + d.dx, u.y + d.dy);
      return (t && t.alive) ? view(battle, t) : null;
    },
    fixCounterBug: !!opts.fixCounterBug                            // 기본 꺼짐 = 원본
  });
  if (!list.length) return null;
  var n = list[0].count, out = { unit: defender, target: attacker, count: n, results: [] };
  for (var i = 0; i < n; i++) {
    if (!attacker.alive || !defender.alive) break;
    /* 0x1F130 이 매번 0x1D124 로 대상이 아직 붙어 있는지 확인합니다 */
    if (dist(defender, attacker) > Ru.counterRange(weaponTypeOf(battle, defender))) break;
    /* ★ 0x1D124 의 근접 갈래(무기 ≤ 4)는 0x1A25F 로 «비행 대상은 비행 공격자만» 거른다 — 지상 근접은 비행 공격자에게 반격 못 한다 (2026-10-06)
     *   사장님(원문) 「지상유닛은 공중유닛을 대상으로 반격이 안되어야하는데, 반격이 적용되는 문제도 있어」
     *   ☠ 전에는 거리만 보고 이 판정을 안 불렀다(평타·AI·링은 `비행막음` 을 이미 쓴다). CD 0x1F0DE call 0x1D0E2(= 0x1D124) */
    if (비행막음(battle, defender, attacker)) break;
    var crit = Ru.critCheck(view(battle, defender), battle.T, opts.rng || Ru.makeRng());
    commit(battle, defender, defender._cv);
    /* ★ 반격도 0x1E61D 를 지나므로 크리티컬이면 마법검(0x1E989 → 0x19168) — 평타와 같은 함수 */
    var ms = 마법검쏘기(battle, defender, crit, [attacker], opts);
    if (ms && ms.fired && ms.result) {
      out.deaths = out.deaths || []; out.exp = out.exp || [];
      (ms.result.deaths || []).forEach(function (d) { if (d && out.deaths.indexOf(d) < 0) out.deaths.push(d); });
      (ms.result.exp || []).forEach(function (x) { out.exp.push(x); });
    }
    /* 마법검이 먼저 쓰러뜨렸으면 물리 피해를 다시 넣지 않는다 (평타 2861 과 같다) — 연출용 한 대만 남긴다 */
    var r = (ms && ms.fired && attacker.alive === false)
      ? { unit: attacker, result: 'hit', damage: null, attackType: crit }
      : strike(battle, defender, attacker, crit, { rng: opts.rng, reason: 'counter' });
    /* ★ 몇 번째 반격 «한 대»인가 — 도끼 곁 칸도 같은 대에 묶여 한 번의 공격 연출(0x1E61D)로 같이 맞는다 (battle_main DRIVER.counter · 2026-10-06) */
    if (r) { r.반격차례 = i; if (ms) r.magicSword = ms; }
    out.results.push(r);
    /* ★★★★★ **도끼(무기 4) 반격은 평타와 같은 칸을 친다** — 0x1EE23 (2026-09-02)
     *
     *   원본이 무기 4 를 따로 가르고, **평타와 같은 창구**로 대상을 모은다:
     *   ```asm
     *   0x1EE2B  **mov ecx, eax**                              ; ★ ecx = 반격자(첫 인자)
     *   0x1EE2D  call 0x174CF ; **cmp al, 4** / jne 0x1EF14    ; ★ 무기 4(도끼)만
     *   0x1EE40  (방향+2) % 4 · 0x1EE53 그 +1 · 0x1EE6D 그 +2  ;   방향 셋
     *   0x1EE7C  [ecx](x) · [ecx+1](y) → 좌표 묶음
     *   0x1EE9D  call 0x49ABC ; ebx = [ecx+0x60] sar 24        ;   좌표 옮기기
     *   0x1EEB8  **call 0x1AD62**                              ; ★★★ **도끼 두 벡터**
     *   0x1EEC5  call 0x1AE48
     *   ```
     *   ★ `0x1AD62` 는 `combat.js:439` 가 「무기 4(부) : **`0x1AD62` 두 벡터**」라고
     *     **이미 적어 둔 그 함수**다 — 곧 **평타 `attackCells` 와 같은 창구**다.
     *   ⇒ 그러므로 **방향을 다시 계산하지 않는다.** `attackCells(battle, 반격자)` 를
     *     그대로 쓰면 원본과 같은 칸이 나온다.
     *   ☠ **원공격자는 이미 위에서 쳤으므로 뺀다.** 관계(적)는 그대로 본다.
     *   ☠ **반격 횟수 루프 안**이다 — 원본도 같은 자리다. */
    if (weaponTypeOf(battle, defender) === 4) {                    // 0x1EE32
      var _칸 = attackCells(battle, defender) || [];               // 0x1EEB8 → 0x1AD62
      for (var _k = 0; _k < _칸.length; _k++) {
        if (!defender.alive) break;
        var _t2 = battle.at(_칸[_k].x, _칸[_k].y);
        if (!_t2 || !_t2.alive || _t2 === attacker || _t2 === defender) continue;
        if (!hostile(defender.side, _t2.side, battle.confuse)) continue;
        if (비행막음(battle, defender, _t2)) continue;              /* 도끼도 근접 — 비행 대상은 못 친다 (0x1AD62 → 0x1A25F) */
        commit(battle, defender, defender._cv);
        var _r2 = strike(battle, defender, _t2,
          Ru.critCheck(view(battle, defender), battle.T, opts.rng || Ru.makeRng()),
          { rng: opts.rng, reason: 'counter' });
        if (_r2) _r2.반격차례 = i;                                  /* 같은 대 — 같이 맞는다 */
        out.results.push(_r2);
      }
    }
  }
  return out;
}

/* ══════════════════════════════════════════ 5. 필살기 (0x4C98A / 0x3FFD4) */

/**
 * 슬롯별 공격력 배수 x — 등급 1 / 2 / 3.
 * 값은 `필살기_데미지공식.md`(커뮤니티 검증본)에서 옮겼습니다.
 * ☐ **2026-08-29 — `0x2F47F` 를 뜯었다. 그런데 데미지 배수가 안 나온다.**
 *   ```asm
 *   0x2F481  cmp dx,2 · jb/jbe · cmp dx,3 · je …   ; dx = **등급**으로 네 갈래
 *   0x2F497  등급 1 → ecx=1 · ebx=[0x4492] · **edx = 5**
 *   0x2F4B2  등급 2 → ecx=1 · ebx=[0x4492] · **edx = 7**
 *   0x2F4C4  등급 3 → ecx=1 · ebx=[0x4492] · **edx = 0xC(12)**
 *   0x2F4A7  sar ebx,16 · call 0x2CC3A
 *   ```
 *   ★ 등급별로 갈리는 값은 **5 · 7 · 12** 다.
 *   ☠ 그런데 아래 `SPECIAL_X` 의 `[2, 2.5, 3]` 과는 **척도가 다르다** — 바로 대응하지 않는다.
 *     `0x2CC3A` 는 유닛 레코드(`[eax+0x60]`·`[eax+1]`)를 읽고 `0x1CA0E` 에서
 *     **20바이트를 스택에 복사**(`movsd`×5)하는 **연출성 함수**로 보인다.
 *     ⇒ `0x2F47F` 가 데미지 배수를 만드는 자리인지부터 다시 봐야 한다.
 *   ☑ 2026-09-24 — `0x1CA0E`(mov esi 즉시값 → +0x10000 = `0x2CA0E`)는 **잔상 실루엣 색 표**다
 *     (3D·3C·3A·39·38). 피해와 무관하다. 연타 피해는 `0x2D3CB`: 물리 × (20/25/30)/10 + ebx 인자
 *     (검 1000·창 0·권 2000 — `0x2D3F8` 이 [esp+0x78] 을 읽는다) — 아래 `SPECIAL_X` [2,2.5,3] 와 같다.
 *   ★ 상수 a 는 표 `0x74494` 라 확정이다(그건 그대로다).
 */
var SPECIAL_X = {
  0:  [2, 2.5, 3],  1:  null,        2:  null,        3:  [1, 2, 2],
  4:  null,         5:  [1, 2, 3],   6:  [1, 2, 3],
  7:  null,         8:  [2, 2.5, 3], 9:  [1, 2, 2],   10: [1, 2, 3],
  11: [0, 2, 3],    12: null,        13: [1, 2, 3],   14: [3, 4, 5],
  15: [1, 1.5, 1.5],16: [1, 2, 2],   17: [1, 2, 2],   18: [1, 2, 2],
  19: [2, 2.5, 3],  20: null,        21: [1, 2, 2],   22: null,
  23: null,         24: [1, 2, 3]
};
/** 피해가 없는(효과만 있는) 슬롯 — §4.6 의 "피해 X" 칸. */
var SPECIAL_EFFECT_ONLY = [1, 2, 4, 7, 12, 20, 22, 23];

/**
 * 그 필살기가 **적을 필요로 하는가** — `필살기발동` / `초필살기발동` 표의
 * `대상` 칸을 그대로 본다. `적` 이면 참, `자기`(반·살·기) 와 `빈칸`(혼 계열)은 거짓.
 *
 * 표가 없으면 **거짓**을 낸다 — 모르는 것을 취소로 몰면 멀쩡한 필살기가
 * 조용히 안 나가는 쪽이 되기 때문이다(비용만 안 나갈 뿐 사용자는 영문을 모른다).
 */
/** 그 칸들 안에 살아 있는 적이 하나라도 있는가. */
function foeInCells(battle, u, cells) {
  cells = cells || [];
  for (var i = 0; i < cells.length; i++) {
    var t = battle.at(cells[i].x, cells[i].y);
    if (t && t.alive && hostile(u.side, t.side, battle.confuse)) return true;
  }
  return false;
}

function needsFoe(T, ultimate, uidx, slot) {
  var rows = ultimate ? (T && T['초필살기발동']) : (T && T['필살기발동']);
  var row = rows && rows[ultimate ? (uidx | 0) : (slot | 0)];
  if (!row && ultimate && R() && R().ultimateRow) row = R().ultimateRow(uidx | 0, T);   /* [리마스터] 13~ */
  if (!row) return false;
  /* ★★★ 표의 `대상요구` 가 있으면 그것이 이긴다 (2026-09-10)
   *   `대상==='적' && !빈칸허용` 만으로는 **화염인**을 못 가린다 — 고르는 칸은 비어도
   *   되지만(`0x39B6D ecx=0`) 착탄 반경 2 안에 적이 0 명이면 `0x39C31` 이 커서를
   *   다시 열어 **발동을 안 한다.** 그래서 표에 칸을 따로 두었다. */
  if (row['대상요구'] !== undefined && row['대상요구'] !== null) return !!row['대상요구'];
  return row['대상'] === '적' && !row['빈칸허용'];
}

/** 상수 a — 표 0x74494 (24칸) + 권 '극'(슬롯 24) 은 즉값 0x7D00. */
function specialA(battle, slot) {
  if (slot === 24) return 32000;                                   // 0x30049
  var t = battle.T['필살기상수a'] || [];
  return t[slot] | 0;
}

/** 슬롯 → 무기 계열 (0x4C026 점프표). */
function slotGroup(slot) {
  if (slot <= 6) return 1;                                         // 검
  if (slot <= 10) return 3;                                        // 창
  if (slot <= 14) return 4;                                        // 부
  if (slot <= 18) return 5;                                        // 궁
  return 0;                                                        // 권
}

/* ★★★★★ **필살기 사거리는 `0x2CBFB(ITEM+0x38 + 인자)` 다** (2026-09-02 전수 정정)
 *
 *   > 사용자 지적: 「… 스킬 **적용 효과**와 표시되는 이펙트, 이펙트 타이밍 등이 문제가 많아.」
 *
 *   `tables.json['필살기발동']` 의 「사거리」 칸이 이미 답을 적어 두었는데
 *   **코드가 딴 값을 쓰고 있었다.** 진입점부터 원본을 읽어 인자를 확정했다:
 *
 *   | 공용 함수 | 인자 | 근거 |
 *   |---|---|---|
 *   | `0x2EB61` (비·투·장) | **무기종류 + 6** — 검 6 · 창 7 · 권 8 | `0x2EB72 eax = edx` · `0x2EB74 add eax, 6` |
 *   | `0x2E25B` (혼) | **무기종류 + 5** — 검 5 · 창 6 | `0x2E271 add edx, 5` |
 *   | `0x2F816` (부 회) | **5 + (등급 > 1 ? 1 : 0)** | `0x2F816 cmp dx,1` · `0x2F81A setg al` · `0x2F81F add eax,5` |
 *   | `0x2FAAF` (활 뇌) | **9** | `tables.json` 「ITEM+0x38 + 9 직선」 |
 *
 *   ☠ 우리는 `3 + grade` · `3` · `specialRadius(u, grade)` 처럼 **등급을 섞어** 쓰고 있었다.
 *     원본은 이 넷 모두 **등급과 무관**하다(부 회만 등급 1 초과 여부로 5/6). */
/* ══════════════════════════════════════════════════════════════════════
 * ★★★★★ **넉백** — `0x2E896` (2026-09-10 · 사장님 지적으로 전수 점검하다 찾았다)
 *
 *   > 사장님: 「필살기마다 발동방식, 적용범위가 다르고 **효과도 달라.** …
 *   >  **효과 발동 위치(좌표) 순서** 등 주의해서」
 *
 *   ☠ **우리에게 아예 없었다.** 문서(`필살기_전체목록.md`)가 「비 — 맞은 적은 **뒤로 밀림**」
 *     「투 — 맞은 적은 **뒤로 밀림**」 「붕 — 피해 없이 **밀쳐냄**」이라 적어 두었는데
 *     코드에 미는 자리가 한 곳도 없었다.
 *
 *   ── 누가 미나 (E8 전수) ─────────────────────────────────────────────
 *   `call 0x2E896` 은 **두 곳**뿐이다 — `0x2ED53` 과 `0x30034`.
 *     · `0x30034` = **붕(23)** `0x2FFF9` — 피해 없이 바로 민다
 *     · `0x2ED53` = 공용 원거리 `0x2EB61` 안 — **비(3)·투(9)·장(21)** 이 그리로 온다
 *       (`0x2F592 edx=0` 검 · `0x2F6EB edx=1` 창 · `0x2FF36 edx=2` 권)
 *   ★ 그런데 그 자리엔 조건이 있다:
 *     ```asm
 *     0x2ED37  [대상+0x48] -= 피해      ; ★ **피해를 먼저 넣고**
 *     0x2ED42  cmp di, 2               ;   di = 무기종류 (0 검 · 1 창 · 2 권)
 *     0x2ED46  jge 0x2ED58             ; ★ **2 이상(권)이면 안 민다**
 *     0x2ED53  call 0x2E896            ;   그제서야 넉백
 *     ```
 *     ⇒ **장(21)은 안 민다.** 미는 것은 **비(3) · 투(9) · 붕(23)** 셋이다.
 *
 *   ── 어떻게 미나 `0x2E896(eax = 밀 유닛, dx = 방향)` ─────────────────
 *   ```asm
 *   0x2E8A4  cmp [eax+0x61], 0x12C / jge   ; ★ 대형(스프라이트 ≥ 300)은 «안 밀린다»
 *   0x2E8B0  cmp byte [eax+0x5C], 0 / jne  ; ★ **탈것**을 탔으면 «안 밀린다»
 *   0x2E8BC  [ecx+0x64] = 0xA              ;   모션 10 (밀리는 자세)
 *   0x2E8D7  [esp] = 0                     ;   민 칸 수
 *   루프 (0x2E932  cmp si, 3 ; jl)         ; ★ **최대 세 칸**
 *     0x2E8F1  call 0x49ABC                ;     그 방향으로 한 칸
 *     0x2E904  call 0x13CBD                ;     그 칸의 이동 배열 값
 *     0x2E90A  cmp eax, -2 / jne           ; ★   −2 (못 가는 칸)이면
 *     0x2E90F  al = 방향 + 2 & 3           ;       **반대 방향**으로 한 칸 되돌리고
 *     0x2E922  call 0x49ABC · 0x2E927 jmp  ;       루프를 나간다
 *     0x2E92C  [esp]++ · esi++             ;     갈 수 있으면 한 칸 늘린다
 *   0x2E938  민 칸 수 == 0 → 그냥 끝       ; ★ 한 칸도 못 밀면 아무 일 없다
 *   0x2E94C  0x11EE4(옛 칸)                ;   옛 칸 지우고
 *   0x2E955  [ecx] = 새 x · [ecx+1] = 새 y ; ★ **좌표를 옮긴다** (방향은 «안» 건드린다)
 *   0x2E96E  0x11E04(새 칸)                ;   새 칸에 그린다
 *   ```
 *   ★ 「−2 면 되돌린다」는 곧 **막히기 전 칸까지만** 간다는 뜻이다.
 *     우리는 `G2Move.canPlace`(빈 칸 · 지형 통행 · 테두리)로 같은 판정을 한다.
 * ══════════════════════════════════════════════════════════════════════ */
function knockback(battle, t, dir, opts) {
  if (!t || !t.alive) return null;
  if (spriteProfile(t).knockbackImmune) return null;                       // 0x2E8A4
  if ((((t.gear || {}).mount) | 0) !== 0) return null;            // 0x2E8B0  [+0x5C]
  var M = root.G2Move;
  var d = DIR[(dir | 0) & 3];
  var x = t.x | 0, y = t.y | 0, 민칸 = 0;
  var 최대 = (opts && opts.max != null) ? (opts.max | 0) : 3;      // 0x2E932  cmp si, 3
  for (var i = 0; i < 최대; i++) {
    var nx = x + d.dx, ny = y + d.dy;
    var 갈까 = M && M.canPlace
      ? M.canPlace(battle, t, nx, ny, t.dir)                      // 0x2E904 0x13CBD != −2
      : (inMap(battle, nx, ny) && !battle.at(nx, ny));
    if (!갈까) break;                                             // 0x2E90F 되돌리고 탈출
    x = nx; y = ny; 민칸++;
  }
  if (!민칸) return null;                                          // 0x2E938
  var 전 = { x: t.x | 0, y: t.y | 0 };
  battle.moveUnit(t, x, y, t.dir);        /* 0x2E955 — ★ 방향은 그대로 둔다 */
  return { unit: t, from: 전, to: { x: x, y: y }, cells: 민칸 };
}

/** 무기 필살 위력(0x2CACA)을 받는 일반 필살 — 연타(검 연 0·창 연 8·권 연 19 · 0x2D403) · 직선(비 3·투 9·장 21 · 0x2ED29) · 활 연 16(0x2F175 · 0x2EF4A edx=1 갈래 — 활 살 edx=0 은 안 부른다) */
function 무기보정슬롯(slot) {
  slot = slot | 0;
  return slot === 0 || slot === 8 || slot === 19 || slot === 3 || slot === 9 || slot === 21 || slot === 16;
}

/** 그 슬롯이 대상을 미는가 — `0x2ED42 cmp di,2 / jge` 와 `0x30034` (위 주석) */
function specialKnocks(slot) {
  slot = slot | 0;
  return slot === 3 || slot === 9 || slot === 23;
}

/** 필살기가 닿는 칸 — §4.6 의 범위 도우미 종류를 그대로 씁니다. */
function specialCells(battle, u, slot, grade, opts) {
  var r;
  switch (slot) {
    case 0: case 8: case 11: case 19: case 23: case 24:            // 연·격·붕·극 → 0x1D124
      return attackCells(battle, u);
    case 1: case 7:                                                // 제 — 0x1AC08 나선
      return diamond(battle, u.x, u.y, Math.max(1, specialRadius(battle, u, grade)), false);
    case 3:                                                        // 검 비 — 직선 + 넉백
      return line(battle, u.x, u.y, u.dir,
                  Math.max(1, specialRadius(battle, u, 6)));       // 0x2EB74 무기0 + 6
    case 5: case 10:
      /* ★★★★★ **혼은 고른 칸까지 돌진한다** — `0x2E385` (2026-08-30 · 지적 B-1)
       *   `0x2E525`/`0x2E53B` 가 **고른 칸**을 끝점으로 잡아 5분의 1씩 나아간다.
       *   ☠ 전에는 `u.dir` 방향 직선만 봐서 사용자가 고른 칸을 **버렸다**.
       *   고른 칸이 안 오면(AI·이벤트) 예전대로 방향 직선을 쓴다. */
      var 혼끝 = opts && opts.at;
      if (혼끝 && (혼끝.x != null) && (혼끝.y != null))
        return 직선칸(battle, u.x, u.y, 혼끝.x | 0, 혼끝.y | 0);
      return line(battle, u.x, u.y, u.dir,
                  Math.max(1, specialRadius(battle, u, (slot === 10) ? 6 : 5)));  // 0x2E271 무기종류 + 5
    /* ★★★★★ **검 파는 반경 5 「고정」이다** — `0x2F5FB mov ebx, 5` (2026-09-02 정정)
     *
     *   진입점 `0x2F5EF` 부터 읽으면 등급을 안 본다:
     *   ```asm
     *   0x2F5FB  mov ebx, 0x5          ; ★ **반경 5 고정**
     *   0x2F607  call 0x1AC08          ;   마름모 생성기
     *   0x2F61B  call 0x1AC59          ;   다음 칸
     *   ```
     *   `tables.json['필살기발동'][6]` 도 「자기 중심 **반경 5 고정**」이라 적어 두었다.
     *   ☠ 우리는 `1 + grade`(1~3)를 써서 **원본의 1/5 ~ 3/5** 밖에 안 닿았다. */
    case 6:                                                        // 검 파 — 나선 전체
      return diamond(battle, u.x, u.y, 5, false);                  // 0x2F5FB ebx = 5
    case 9:                                                        // 창 투 — 투척
      return line(battle, u.x, u.y, u.dir,
                  Math.max(1, specialRadius(battle, u, 7)));       // 0x2EB74 무기1 + 6 = 7
    case 13:                                                       // 부 회 — 0x1A452 직선
      /* 0x2F816 cmp dx,1 · 0x2F81A setg al · 0x2F81F add eax,5 — 등급 > 1 이면 6, 아니면 5 */
      r = Math.max(1, specialRadius(battle, u, ((grade | 0) > 1) ? 6 : 5));
      return line(battle, u.x, u.y, u.dir, r);
    /* ★★★★★ **부 광도 반경 1 「고정」이다** — `0x2F994 mov ebx, 0x1` (2026-09-02 정정)
     *   `tables.json['필살기발동'][14]` 「자기 중심 **반경 1 고정**. 검 파(반경 5)보다 좁다」
     *   ☠ 우리는 `grade`(1~3)를 써서 등급 2·3 에서 **원본보다 넓었다**. */
    case 14:                                                       // 부 광 — 좁은 나선
      return diamond(battle, u.x, u.y, 1, false);                  // 0x2F994 ebx = 1
    /* ★★★★★ **활 살·활 연은 「무기 사거리」가 아니다** — `0x2EF4A` (2026-09-02 정정)
     *
     *   `tables.json['필살기발동'][15]` 「사거리 **`ITEM+0x38 + 7`**(직업 0x15·0x16 은 +5)」·
     *   「범위도우미 **`0x1B7FA` 부채**」·「`0x2EF8F 0x2CBFB(0x1AEF3())` 로 사거리를 얻고
     *   `0x2EFF3` 플레이어 경로에서 `0x1B7BF(ebx=0)` → `0x1B7FA` 로 칸 전체를 칠한다」
     *
     *   `0x1AEF3` 을 읽으니 **직업 하나만 본다**:
     *   ```asm
     *   0x1AEF4  dl = [eax+0x11]        ; 직업
     *   0x1AEF7  cmp dl, 0x15 · je · 0x1AEFC cmp dl, 0x16 · jne
     *   0x1AF01    eax = 5              ; ★ 직업 0x15·0x16 → **5**
     *   0x1AF08  else eax = 7           ; ★ 그 밖 → **7**
     *   ```
     *   ☠ 우리는 `attackCells`(무기 종류별 사거리)를 쓰고 있었다 —
     *     활을 안 든 유닛이면 **1칸**밖에 안 나왔다(실측). */
    case 15: case 16: {                                            // 궁 살·연 — 부채꼴
      var 궁직 = (u.job | 0);
      var 궁길이 = Math.max(1, specialRadius(battle, u, (궁직 === 0x15 || 궁직 === 0x16) ? 5 : 7));
      return fanCells(battle, u.x, u.y, u.dir, 궁길이, true);      // 0x1B7FA
    }
    /* ★★★★★ **활 뇌(17)는 직선이다** — `0x2FA6E` (2026-09-02 정정)
     *
     *   진입점부터 읽으면 `0x2CBFB`(사거리 계산) 뒤 **`0x1A452` 직선**을 돈다.
     *   `tables.json['필살기발동'][17]` 도 이미 적어 두었다 —
     *   「사거리 **`ITEM+0x38 + 9` 직선**」·「범위도우미 `0x1A452/0x1A552`」·
     *   「`0x2FAAF 0x2CBFB(9)` 로 길이를 얻어 **시전자 방향 직선만** 돈다. 커서 없음」
     *   ☠ 우리는 15·16 과 묶어 `attackCells`(무기 사거리 부채꼴)로 쓰고 있었다 —
     *     **모양도 길이도 달랐다.** */
    case 17: {                                                     // 활 뇌 — 방향 직선
      var 뇌길이 = Math.max(1, (R() ? R().itemFieldS(battle.T, (u.gear || {}).weapon | 0,
                                                          '필살기사거리') : 0) + 9);   // 0x2FAAF 0x2CBFB(9)
      return line(battle, u.x, u.y, u.dir, 뇌길이);                 // 0x1A452
    }
    case 18: {
      /* ★★★★★ **활 심(心) 은 「맵 전체」가 아니라 «테두리를 뺀 사각형»** — `0x2FD03` (2026-09-10)
       *
       *   > 표: 「사거리 무시 — 화면 전체(`0x13F08`)」 — 그 말이 헷갈리게 적혀 있었다.
       *   원본이 그 함수에 넘기는 인자를 보면 **화면이 아니라 맵**이고, 테두리를 뺀다:
       *   ```asm
       *   0x2FD2C  ax = [0xBA840](맵 높이) · 0x2FD32 sub eax, 4   → ecx = 높이 − 4
       *   0x2FD38  ax = [0xBA844](맵 폭)   · 0x2FD40 sub eax, 4   → ebx = 폭 − 4
       *   0x2FD43  edx = 2 · 0x2FD4B eax = 2                      ; ★ 시작은 (2, 2)
       *   0x2FD4D  call 0x13F08(x0=2, y0=2, x1=폭−4, y1=높이−4)
       *   ```
       *   `0x13F08` 은 그 사각형을 이동 배열(`0xE8F48`)에 칠한다
       *   (`0x13F38` 이 맵 폭으로 색인을 만든다 — 화면 좌표가 아니다).
       *
       *   ☠ 우리는 `diamond(반경 W+H)` 로 **맵 전체**를 냈다. 34×38 맵에서
       *     1291칸이 나왔는데 원본은 **957칸**(x 2~30 · y 2~34)이다.
       *     테두리에 선 유닛을 원본에서는 못 고른다. */
      var 심 = [];
      var x1 = (battle.W | 0) - 4, y1 = (battle.H | 0) - 4;   // 0x2FD40 · 0x2FD32
      for (var sy = 2; sy <= y1; sy++)                        // 0x2FD43 edx = 2
        for (var sx = 2; sx <= x1; sx++) {                    // 0x2FD4B eax = 2
          if (sx === (u.x | 0) && sy === (u.y | 0)) continue;  /* 자기 칸은 뺀다 */
          심.push({ x: sx, y: sy });
        }
      return 심;
    }
    case 21:                                                       // 권 장 — 원거리 장풍
      return line(battle, u.x, u.y, u.dir,
                  Math.max(1, specialRadius(battle, u, 8)));       // 0x2EB74 무기2 + 6 = 8
    default:                                                       // 자기 자신에게 거는 것들
      return [{ x: u.x, y: u.y }];
  }
}

/**
 * 필살기·초필살기.
 *
 * @param {number|string} slot 0~24, 또는 −1 / 'ultimate' (초필살기)
 * @param {object} opts { rng, free, targets, allowCharge:true }
 * @returns {object} { ok, kind:'special'|'ultimate'|'charge', grade, x, a, results … }
 *
 * 흐름 — 0x3FFD4(AI) · 0x4C98A(플레이어) 가 같은 순서입니다.
 *   ① 필요 TP  = 0x753C4[슬롯]  /  초필살기 0x75428[n]
 *   ② 가진 힘  = TP + 차징(+0x57).  모자라면 TP 가 최대일 때만 차징(+20, 상한 500)
 *   ③ 등급 추첨 0x2CA40 (20주기 셔플백)
 *   ④ 피해 = 물리피해(공격력 × x) + a          (a 는 방어·상성 밖에서 더합니다)
 *   ⑤ HP 소모 0x301BB — 최소 1 HP 보존, 직업 0x32 면제
 *   ⑥ TP 소모 = 필요TP − 차징,  차징·예약 초기화
 */
/* ══════════════════════════════════════════════════════════════════════
 * 초필살기 대상 범위
 *
 * 원본은 `0x302E6` 이 번호로 점프표(`0x202B2`)를 타고, **핸들러마다 범위가
 * 다릅니다**. 지금까지 확인한 것만 여기 둡니다 — 나머지는 예전처럼 무기
 * 사거리 정면(`attackCells`)이고, 확인되는 대로 옮깁니다(할일목록 11번).
 *
 *   12 블리자드스톰 `0x3AEE8` — **화면 전체**
 *     0x3AEF8  di = [0xBA83E]            카메라 좌상단 Y
 *     0x3AEFF  [0xF0B9E] = 0             대상 개수 초기화
 *     0x3AF08  cx = [0xBA83C]            카메라 좌상단 X
 *     0x3AF1B  call 0x1A1F8(x, y, 진영)  그 칸의 적을 목록에 추가
 *     0x3AF2C  x < 카메라X + 12 까지 · 0x3AF3F  y < 카메라Y + 12 까지
 *   `0x1A1F8` 은 `0x11DB2`(칸의 유닛) → `0x1201D`(관계 판정) → 중복 검사 후 추가.
 *   즉 **화면에 보이는 12×12 칸 안의 적 전원**입니다.
 * ════════════════════════════════════════════════════════════════════ */
/* ★★★★★ **화면 전체(카메라 원점 12×12)는 다섯이다** (2026-09-02 정정)
 *   `tables.json['초필살기발동']` 의 「사거리」 칸 —
 *     1 아수라파천무 · 3 설화난영참 · 4 천지파열무 · 8 멸살성천무 · 12 블리자드스톰
 *   ☠ 여태 **12 하나만** 있어 나머지 넷이 `attackCells`(정면 1칸)로 떨어졌다. */
var ULTIMATE_SCREEN = { 1: true, 3: true, 4: true, 8: true, 12: true, 13: true };   /* 13 [리마스터] 폭풍검 — 화면 안 적 여럿 (2026-10-11 사장님 「1가」) */

/* ══════════════════════════════════════════════════════════════════════
 * ★★★★★ **카메라를 맵 안으로 «가둔다»** — `0x11003` (2026-09-10 · 사장님 지적)
 *
 *   > 사장님: 「실제 원본 화면에서는 **시전자가 중심**이 맞아. 이게 안 맞으면
 *   >  뭔가 **앵커나 중심 조정 로직이 누락**된거야.」
 *
 *   맞다. 원본 `0x3AEE8` 은 `[0xBA83C]`·`[0xBA83E]`(카메라 좌상단 타일)부터
 *   12×12 를 훑는데, 그 카메라 값은 `0x11003` 이 **맵 안으로 가둬 둔** 것이다:
 *
 *   ```asm
 *   0x1100F  test ax, ax / jge 0x11018     ; 새 camX 가 음수면
 *   0x11014  xor ebx, eax                  ;   ★ **0 으로**
 *   0x11018  eax = [0xBA844](맵 폭)
 *   0x11023  sub eax, 0xC                  ;   맵폭 − 12
 *   0x11026  cmp edx, eax / jle 0x11034    ; 그 이하면 그대로
 *   0x1102A  bx = [0xBA844] · 0x11031 sub ebx, 0xC   ; ★ **맵폭 − 12 로**
 *   ```
 *   y 도 같은 꼴이다 (`0x11039` 0 · `0x1104F` `[0xBA840]`(맵 높이) − 12).
 *
 *   ⇒ **카메라 좌상단 = clamp(시전자 − 6, 0, 맵크기 − 12)**
 *     그래서 화면은 **언제나 12×12 가 온전히** 잡힌다.
 *
 *   ☠ 우리는 `시전자 − 6` 을 그대로 쓰고 **맵 밖 칸을 걸러내기만** 했다.
 *     그래서 가장자리에 선 유닛은 칸이 모자랐다 — 시전자가 (2,2) 면
 *     원본은 x 0~11 (12칸)인데 우리는 x 0~7 (**8칸**) 이라 **오른쪽 4칸을 놓쳤다.**
 *     화면으로는 「같은 자리에 서 있는데 원본에서는 맞고 우리는 안 맞는」 것이 된다.
 * ══════════════════════════════════════════════════════════════════════ */
/** 화면(카메라 좌상단부터 12×12) 칸 목록. 카메라를 모르면 시전자 중심으로. */
function screenCells(battle, u, opts) {
  var N = 12, cam = opts && opts.camera;
  var W = battle.W || battle.w || 0, H = battle.H || battle.h || 0;
  var cx = cam ? (cam.x | 0) : ((u.x | 0) - (N >> 1));
  var cy = cam ? (cam.y | 0) : ((u.y | 0) - (N >> 1));
  /* 0x11003 — 맵 안으로 가둔다. 맵이 12 보다 작으면 0 (원본은 음수를 그대로 쓰지만
   * 출하 맵은 모두 12 이상이라 그 갈래는 안 탄다) */
  if (W) cx = Math.max(0, Math.min(cx, W - N));
  if (H) cy = Math.max(0, Math.min(cy, H - N));
  var out = [];
  for (var y = cy; y < cy + N; y++) {
    if (y < 0 || (H && y >= H)) continue;
    for (var x = cx; x < cx + N; x++) {
      if (x < 0 || (W && x >= W)) continue;
      out.push({ x: x, y: y });
    }
  }
  return out;
}

/** 초필살기 번호에 맞는 대상 칸. */
/* ★★★★★ **초필살기 13칸 범위를 표대로 옮겼다** (2026-09-02)
 *
 *   > 사용자 지적: 「필살기, **초필살기**, 마법, 스킬 **적용 효과**와 표시되는
 *   >   이펙트, 이펙트 타이밍 등이 문제가 많아. **꼼꼼하게 전수 확인**해야해.」
 *
 *   여태 **화면 전체(12)를 뺀 열두 칸이 전부 `attackCells`**(「아직 미확인」)였다.
 *   그런데 `tables.json['초필살기발동']` 에 **13칸 전부** 사거리와 근거가 적혀 있었다.
 *
 *   | # | 이름 | 범위 | 근거 |
 *   |--:|---|---|---|
 *   | 0 | 비연참 | **정면 직선 7** | `0x30910 edx = 7` |
 *   | 1 | 아수라파천무 | 화면 12×12 | 표 |
 *   | 2 | 부동명왕검 | **정면 1칸** | 표 |
 *   | 3 | 설화난영참 | 화면 12×12 | 표 |
 *   | 4 | 천지파열무 | 화면 12×12 | 표 |
 *   | 5 | 교아참 | **방향 직선 3** | `0x34C6F push 3` · `0x34C8A 0x1A452` |
 *   | 6 | 풍아열공참 | **정면 사거리 7** | 표 |
 *   | 7 | 진공수라참 | **시전자 중심 반경 2** | 표 |
 *   | 8 | 멸살성천무 | 화면 12×12 | 표 |
 *   | 9 | 광룡탄 | **방향 폭3 × 길이7** | `0x377BF` 가 `[+0x63]` 만 보고 `0x1A452` |
 *   | 10 | 무신멸뢰옥 | **정면 사거리 7** | `0x380FC cmp di,7` · 0x38493/0x383A2 경계로 최대 11타 |
 *   | 11 | 화염인 | **거리 3~6 → 착탄점 반경 2** | `0x39B71 0x4A483` 칸 커서 |
 *   | 12 | 블리자드스톰 | 화면 12×12 | `0x3AEE8` |
 *
 *   ✅ 9 광룡탄의 「폭 3」은 **읽었다 (2026-09-02 · 커밋 `f1448a0`)** —
 *     `0x377D6 edi = −1` … `0x37846 cmp di,1 / jle` 로 **−1 · 0 · +1 세 줄**이고,
 *     두 갈래(`0x377D6`·`0x37852`)는 **어느 축에 `edi` 를 더하느냐**만 다르다.
 *     ⇒ 직선 7 을 수직으로 한 칸씩 밀어 **21칸**. `case 9` 가 그대로 낸다.
 *   ☐ 11 화염인의 「거리 3~6」은 **고른 칸**이 있어야 한다(`opts.at`). 없으면
 *     방향 6칸 끝을 착탄점으로 삼는다.
 *   ✅ 10 「총 10타」는 **후반부까지 추적해 원본 근거를 확정했다** (2026-09-21 정정).
 *     `0x38676 cmp word [esp+0x14],0xA` 가 총 타격 수 10의 종료 조건이고,
 *     대상 HP가 음수가 되면 `0x386A1~0x38737` 에서 현재 방향으로 다시 최대 7칸을
 *     훑어 다음 적을 잡아 **남은 횟수**를 이어 쓴다. 새 대상마다 `0x1D770 + 0x1388` 로
 *     피해를 다시 계산한다. */
function ultimateCells(battle, u, uidx, opts) {
  if (ULTIMATE_SCREEN[uidx]) return screenCells(battle, u, opts);
  var n = uidx | 0;
  switch (n) {
    case 0:                                                        // 비연참 — 0x30910 edx = 7
      return line(battle, u.x, u.y, u.dir, 7);
    case 2:                                                        // 부동명왕검 — 정면 1칸
      return line(battle, u.x, u.y, u.dir, 1);
    case 5:                                                        // 교아참 — 0x34C6F push 3
      return line(battle, u.x, u.y, u.dir, 3);
    case 6:                                                        // 풍아열공참 — 정면 사거리 7
      return line(battle, u.x, u.y, u.dir, 7);
    case 7:                                                        // 진공수라참 — 시전자 중심 반경 2
      return diamond(battle, u.x, u.y, 2, false);
    case 9: {                                                      // 광룡탄 — 방향 **폭 3** × 길이 7
      /* ★★★★★ **「폭 3」의 근거를 찾았다** — `0x377D6`~`0x37846` (2026-09-02)
       *
       *   ```asm
       *   0x377BA  ebx = 7                       ; ★ 길이 7
       *   0x377C7  cmp ah, 1 · 0x377CC cmp [esi+0x63], 3
       *            방향 1·3(좌우) → 0x377D6 갈래 · 그 밖 → 0x37852 갈래
       *   0x377D6 ┌ edi = −1                     ; ★ **−1 에서 시작**
       *   0x37801 │  eax += edi                  ; ★ 좌표에 −1 / 0 / +1
       *   0x37813 │  call 0x1A452 (직선 시작) · 0x37820 0x1A552 (다음)
       *   0x3783E │  call 0x1A1F8 (대상 수집)
       *   0x37845 │  inc edi
       *   0x37846 └  cmp di, 1 · jle             ; ★ **−1, 0, +1 = 세 줄**
       *   ```
       *   두 갈래(`0x377D6` · `0x37852`)는 **어느 축에 `edi` 를 더하느냐**만 다르다 —
       *   좌우로 볼 때는 y 를, 위아래로 볼 때는 x 를 흔든다.
       *   ⇒ **시전자 방향 직선 7 을 좌우(수직) 한 칸씩 밀어 세 줄.**
       *   ☠ 여태 가운데 한 줄(7칸)만 냈다 — 원본은 **21칸**이다. */
      var d9 = DIR[u.dir & 3];
      var 옆 = (d9.dx !== 0) ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };   // 진행축의 수직
      var 모음 = [], 본 = {};
      for (var o9 = -1; o9 <= 1; o9++) {                              // 0x377D6 edi = −1 … 0x37846 cmp di,1
        var sx = (u.x | 0) + 옆.dx * o9, sy = (u.y | 0) + 옆.dy * o9;
        var ln = line(battle, sx, sy, u.dir, 7);                      // 0x377BA ebx = 7
        for (var q9 = 0; q9 < ln.length; q9++) {
          var k9 = ln[q9].x + ',' + ln[q9].y;
          if (!본[k9]) { 본[k9] = 1; 모음.push(ln[q9]); }
        }
      }
      return 모음;
    }
    case 10:                                                       // 무신멸뢰옥 — 정면 사거리 7
    case 14:                                                       // [리마스터] 순옥살 — 무신과 같은 정면 사거리 7 (첫 적 한 명은 special 이 고른다)
      return line(battle, u.x, u.y, u.dir, 7);
    case 11: {                                                     // 화염인 — 착탄점 반경 2
      /* ★★★★★ **「거리 3~6」의 근거를 찾았다** — `0x39A5C`~`0x39AE4` (2026-09-03)
       *
       *   방향 `[esi+0x63]` 으로 넷을 가르고, **진행축에 −3 에서 −6(또는 +3 에서 +6)**
       *   까지 칸을 표시한다 — 네 갈래가 대칭이다:
       *   ```asm
       *   0x39A5F  cmp ah,1 →  0x39A68 ecx = [esi] − 3      … 0x39A82 edx = [esi] − 6
       *   0x39A8E  cmp ah,3 →  0x39A97 ecx = [esi] + 3      … 0x39AB1 edx = [esi] + 6
       *   0x39ABA  ah == 0 →  0x39AC3 ecx = [esi+1] + 3     … 0x39ADD eax = [esi+1] + 6
       *   0x39AE6  cmp ah,2 →  (같은 꼴로 [esi+1] − 3 … − 6)
       *      각 갈래 안: 0x39A6D ebx = 1 · call 0x13D02(칸 표시) · dec/inc ecx
       *   ```
       *   ⇒ **진행축으로 거리 3·4·5·6 — 한 줄 네 칸**이다. 좌우 폭은 없다.
       *   ★ 그 뒤 `0x39B6D mov ecx, edi`(= 0) 로 `0x4A483` 을 부르니 **모드 0 = 무제한**이다
       *     (`마법_연출유형_원본확정.md` §1-1). 곧 표시된 네 칸 **밖도 고를 수 있다** —
       *     표시는 안내일 뿐이고 확정은 어느 칸이든 된다.
       *   ⇒ 그래서 `opts.at`(고른 칸)이 있으면 그것을 쓰고, 없으면 **거리 6**(끝 칸)을 쓴다. */
      var 착 = opts && opts.at;
      if (!착 || 착.x == null) {
        var d11 = DIR[u.dir & 3];
        착 = { x: (u.x | 0) + d11.dx * 6, y: (u.y | 0) + d11.dy * 6 };   // 0x39A82 −6 / 0x39AB1 +6
      }
      return diamond(battle, 착.x | 0, 착.y | 0, 2, true);
    }
    default:
      return attackCells(battle, u);           // 표에 없는 번호는 예전 그대로
  }
}

/* ══════════════════════════════════════════════════════════════════════
 * ★★★★★ **「고르는 범위」와 「닿는 범위」는 다르다** — `TARGET_PICK` 세 종 (2026-09-10)
 *
 *   > 사장님: 「초필살기 **타겟 지정 범위**도 문제가 있어. 각 필살기 별로
 *   >  **전방 몇칸을 선택할 수 있고, 1인에게 적용되는 것도 있고** 한데,
 *   >  **본인기준 특정 범위로 발동**하는게 있고 다양한 형태가 있는데 제대로 적용이 안돼.」
 *
 *   ☠ `ultimateCells()` 는 **닿는 범위**(효과)다. 그런데 UI 가 쓸 **고르는 범위**를
 *     내는 자리가 아예 없었다 — `rangeOf(…, 'special', arg)` 는 `arg|0` 을 **필살기
 *     슬롯**으로 읽어 `specialCells()` 로 보냈다. 초필살기는 `slot` 이 없으니
 *     `arg|0 === 0` 이 되어 **슬롯 0 필살기 범위**가 나왔다.
 *
 *   원본을 직독해 셋을 못박았다 (`0x13D02` 가 칠하는 칸 = 고르는 범위) —
 *
 *   | # | 이름 | 고르는 범위 | 커서 `ecx` | 확정 조건 |
 *   |--:|---|---|--:|---|
 *   | 0 | 비연참 | **방향 직선 7** `0x30990 0x1A452(push 7)` | 1 | 범위 안 · 거리 ≥ 2 (`0x30A58`) · **빈 칸** (`0x30A6C 0x11DB2 == 0`) |
 *   | 6 | 풍아열공참 | **방향 직선 7** `0x357C3 0x13D02` | 0 | **그 칸에 적** (`0x35814 0x1A1F8 != 0`) · 범위 안 |
 *   | 11 | 화염인 | **진행축 거리 3·4·5·6 — 네 칸** `0x39A76 0x13D02` | 0 | 범위 안 · ★ **착탄 반경 2 안에 적 ≥ 1** (`0x39C31`) |
 *
 *   ☠ 화염인의 옛 근거는 「확정 조건이 `0x13CBD>=0` 뿐이라 유닛이 없는 칸도 고를 수
 *     있다」였는데 **틀렸다.** `0x39C31 cmp di, [0xF0B9E]` 가 모은 대상이 0 명이면
 *     `je 0x39B5F` 로 **커서를 다시 연다** — 빈 곳에는 못 쏜다.
 *     (표 `tables.json['초필살기발동']` 의 `근거` 칸을 그 자리에서 고쳤다)
 * ══════════════════════════════════════════════════════════════════════ */
function ultimatePickCells(battle, u, uidx) {
  var n = uidx | 0;
  switch (n) {
    case 0: {                                  // 비연참 — 0x30990 / 0x13CBD
      var moveType0 = (root.G2Move && root.G2Move.moveTypeOf)
        ? root.G2Move.moveTypeOf(battle, u) : 0;
      return line(battle, u.x, u.y, u.dir, 7).filter(function (c) {
        return battle.moveCost(c.x, c.y, moveType0) > 0;     // 원본 0x13CBD: −1 이동불가 칸은 표시하지 않음
      });
    }
    case 6:                                    // 풍아열공참 — 0x357C3 0x13D02
      return line(battle, u.x, u.y, u.dir, 7);
    case 11: {                                 // 화염인 — 0x39A5F~0x39AE6 거리 3·4·5·6
      var d = DIR[(u.dir | 0) & 3], out = [];
      for (var i = 3; i <= 6; i++) {           // 0x39A68 −3 … 0x39A82 −6 (네 갈래 대칭)
        var x = (u.x | 0) + d.dx * i, y = (u.y | 0) + d.dy * i;
        if (inMap(battle, x, y)) out.push({ x: x, y: y });
      }
      return out;
    }
    default:
      return ultimateCells(battle, u, n, null);   /* 고르기가 없는 것은 닿는 범위 그대로 */
  }
}

/** 그 유닛의 초필살기 번호 — `0x4BC3C`(`Ru.ultimateOf`). 없으면 −1. */
function ultimateIndexOf(battle, u) {
  var Ru = R();
  /* [리마스터] 무기도 넘긴다 — (캐릭터, 무기) 짝 초필살기(폭풍검 GS + 스탐블링거 · rules ULTIMATE_BY_PAIR) */
  var _ve = view(battle, u).equip;
  return (Ru && u) ? Ru.ultimateOf(u.charCode | 0, _ve.weapon, _ve.accessory) : -1;   /* [리마스터] 장신구 짝(순옥살) */
}

/* ★★★★★ 무신멸뢰옥 `0x37FA4` — 정면 첫 적부터 남은 타수를 이어 쓰는 관통 연쇄(최대 11타).
 *
 * 원본은 일반 초필살기 피해(`0x2CAF7`)를 쓰지 않는다.
 *   0x3813D  0x1D770(물리피해, attackType=0, support=1)
 *   0x38142  + 0x1388 (= +50 HP)
 * 을 **대상마다 한 번만** 계산해 같은 값을 반복해서 빼고, 대상 HP가 음수가 되면
 * 현재 칸 뒤로 최대 7칸을 더 훑어 다음 적을 잡아 남은 타수를 이어 쓴다
 * (`0x386A1`~`0x38737`). 명중/회피 `0x1DDF0` 은 거치지 않는다.
 *
 * 연출도 같은 대상 순서를 알아야 하므로 실제 적용 전에 읽기 전용 plan을 만든다.
 * plan 생성은 HP/유닛을 바꾸지 않는다. */
function musinNextTarget(battle, A, fromX, fromY) {
  var d = DIR[(A.dir | 0) & 3];
  var x = fromX | 0, y = fromY | 0;
  for (var i = 0; i < 7; i++) {                         // 0x380FC / 0x38702
    x += d.dx; y += d.dy;                               // 0x49ABC
    if (!inMap(battle, x, y)) break;
    var t = battle.at(x, y);                            // 0x1D124
    if (t && t.alive && hostile(A.side, t.side, battle.confuse)) return t; // 0x165C2
  }
  return null;
}

function musinDamage(battle, A, D, rng) {
  var Ru = R(), T = battle.T;
  var av = view(battle, A), dv = view(battle, D);
  var dmg = Ru.physicalDamage(av, dv, {
    tables: T, rng: rng || (Ru.makeRng ? Ru.makeRng() : null),
    attackType: 0,                                    // 0x38133 xor ebx,ebx
    support: true,                                    // 0x38129 ecx = 1
    neighbors: neighborsOf(battle, D, A),
    morale: battle.morale, shieldDef: 0,
    deriveA: eff(battle, A), deriveD: eff(battle, D),
    attr: attackAttr(battle, A),
    phase: battle.battleKind | 0, confuse: battle.confuse
  });
  return (dmg | 0) + 0x1388;                          // 0x38142 / 0x3872F
}

function musinPlan(battle, A, opts) {
  opts = opts || {};
  var simX = A.x | 0, simY = A.y | 0;
  var current = musinNextTarget(battle, A, simX, simY);
  var out = { hits: [], groups: [], targets: [], finalTarget: null };
  var used = 0, rng = opts.rng, GR = root.G2Rand;
  var planSeed = (GR && GR.켜짐 && GR.켜짐() && GR.지금씨앗)
    ? (GR.지금씨앗() >>> 0) : null;
  /* 아래 계획은 실제 연출 전에 타깃/타수 뼈대만 만들므로 기존 G2Rand API로
   * 난수 상태를 저장·복원한다. 난수식을 복제하지 않고 전역 흐름도 선소비하지 않는다. */
  out.refreshGroup = function (group, position) {
    if (!group || !group.unit) return null;
    var ax = A.x | 0, ay = A.y | 0;
    if (position) { A.x = position.x | 0; A.y = position.y | 0; }
    var dmg;
    try { dmg = musinDamage(battle, A, group.unit, rng); }
    finally { A.x = ax; A.y = ay; view(battle, A); }
    group.damage = dmg;
    var hp = group.unit.hp | 0;
    for (var hi = 0; hi < group.hits.length; hi++) {
      var h = group.hits[hi], before = hp;
      hp -= dmg;
      h.damage = dmg; h.hpBefore = before; h.hpAfterRaw = hp; h.kills = hp < 0;
    }
    return group;
  };
  /* 0x383A2 pair 시작은 count>=10에서 끝난다. 정상타 뒤 0x38493은
   * count>10일 때만 크리티컬을 건너뛰므로, count가 9에서 시작한 정상타가
   * 10이 되어도 살아 있으면 그 대상의 크리티컬 한 타(11번째)는 이어진다. */
  while (current && used < 10) {
    /* 0x382E9~0x38303 moves the attacker to the target-adjacent tile before
     * the next target's 0x3872A damage calculation. Simulate that position
     * while planning each group; do not calculate every target from the
     * caster's initial tile. */
    var ax = A.x | 0, ay = A.y | 0;
    A.x = simX; A.y = simY;
    var dmg;
    try { dmg = musinDamage(battle, A, current, rng); }
    finally { A.x = ax; A.y = ay; view(battle, A); }
    var simHp = current.hp | 0;
    var group = { unit: current, damage: dmg, hits: [] };
    out.groups.push(group); out.targets.push(current); out.finalTarget = current;
    while (used < 10) {
      var before = simHp;
      simHp -= dmg;
      var targetOrdinal = group.hits.length + 1;
      var hit = { unit: current, damage: dmg, ordinal: used + 1,
                  targetOrdinal: targetOrdinal,
                  /* 0x383A2~0x38609: 한 대상 안에서 첫 타격은 일반 스윙(ebx=0),
                   * 둘째는 크리티컬 스윙(ebx=1)이고 이 2타 묶음을 반복한다.
                   * 새 대상으로 넘어가면 0x381EF로 돌아가므로 다시 일반 스윙부터다.
                   * ★ 시각/음향 구분일 뿐 피해식은 둘 다 같은 (물리+50)이다. */
                  visualCritical: (targetOrdinal & 1) === 0,
                  visualKind: (targetOrdinal & 1) === 0 ? 'critical' : 'normal',
                  hpBefore: before, hpAfterRaw: simHp,
                  kills: simHp < 0 };                 // 원본은 `jl`, 0은 아직 생존
      group.hits.push(hit); out.hits.push(hit);
      used++;
      if (simHp < 0) break;
    }
    /* count=10이 된 정상타만 뒤따르는 크리티컬을 허용한다. count=10에서
     * 죽었거나 크리티컬로 10에 도달한 경우에는 원본처럼 새 pair/대상에 진입하지 않는다. */
    var lastHit = group.hits[group.hits.length - 1];
    if (used === 10 && simHp >= 0 && lastHit && !lastHit.visualCritical) {
      var lastBefore = simHp;
      simHp -= dmg;
      var lastTargetOrdinal = group.hits.length + 1;
      var finalHit = { unit: current, damage: dmg, ordinal: used + 1,
                       targetOrdinal: lastTargetOrdinal, visualCritical: true,
                       visualKind: 'critical', hpBefore: lastBefore,
                       hpAfterRaw: simHp, kills: simHp < 0 };
      group.hits.push(finalHit); out.hits.push(finalHit); used++;
    }
    if (simHp >= 0 || used >= 10) break;
    var d = DIR[(A.dir | 0) & 3];
    simX = (current.x | 0) - d.dx;
    simY = (current.y | 0) - d.dy;
    var priorTarget = current, wasAlive = priorTarget.alive;
    priorTarget.alive = false;              /* 0x3866B의 뒤 대상은 검색 전에 죽었다 */
    try { current = musinNextTarget(battle, A, simX, simY); }
    finally { priorTarget.alive = wasAlive; } /* plan은 기존 전투 모델을 바꾸지 않는다 */
  }
  if (planSeed != null) GR.씨앗(planSeed);
  return out;
}

/** 무신멸뢰옥 도착 위치를 전투 모델에 확정한다.
 * 원본 `0x382E9 → 0x382F2/0x382FA → 0x38303` 은 시전자를 기존 점유에서 내리고,
 * 현재 대상의 x/y를 시전자 레코드에 쓴 뒤 **그 대상 칸에 시전자를 다시 올린다**.
 * 대상이 살아 있으면 그 칸의 grid 포인터가 시전자로 덮이는 원본의 특수 상태도 그대로다. */
function musinCommitPosition(battle, A, plan) {
  var t = plan && plan.finalTarget;
  if (!battle || !A || !t) return null;
  /* ★ 대상 «바로 앞» 칸 — 0x3809B 0x1D124 가 앞 칸에 적이 있는 칸을 찾고 0x382EE 가 시전자를 그 칸으로 옮긴다
   *   (원본 기록 초필살_10: 첫 대상 (8,18) 쓰러진 뒤 시전자 (8,17)→(8,18) · 마지막 대상 (8,19) 앞 · ☠ 예전엔 대상 칸 위에 올려 겹쳤다 · 2026-09-26) */
  var _d = DIR[(A.dir | 0) & 3];
  var x = (t.x | 0) - _d.dx, y = (t.y | 0) - _d.dy;
  if (typeof battle.moveUnit === 'function') battle.moveUnit(A, x, y, A.dir);
  else { A.x = x; A.y = y; }
  plan.finalPosition = { x: x, y: y, targetId: t.id };
  return plan.finalPosition;
}

/** SCE100/101 공통 피해(0x2C8D8~0x2C9C6). 연출 후 commit하며 사망은 후처리 소유다.
 * 일반 magicDamage/applyDamage의 지력·속성·회복·HP상한 보정을 거치지 않는다. */
function sceDirectMagic(battle, directIndex) {
  var rep = { ok: true, kind: 'sceDirectMagic', directIndex: directIndex | 0,
    committed: false, targets: [], results: [], deaths: [], exp: [], 후처리대상: [] };
  rep.commit = function () {
    if (rep.committed) return rep;
    // 0xCC968의 네 활성 진영 목록. 실행기는 side1..4를 사용한다(turn.js 진영목록 계약).
    var units = (battle.units || []).filter(function (u) {
      return u && u.alive && (u.side | 0) >= 1 && (u.side | 0) <= 4;
    }).slice().sort(function (a, b) { return (a.side | 0) - (b.side | 0); });
    rep.committed = true;
    units.forEach(function (u) {
      // 0x2C8FA는 u8 MR, 0x2C902는 Magic Armor +20. 배리어/속성 검사는 없다.
      var mr = (eff(battle, u).mr & 255) + ((u.f15 & 0x20) ? 20 : 0);
      var damage = Math.trunc((100 - mr) * 10000 / 100);
      var before = u.hp | 0;
      u.hp = (before - damage) | 0; // 0x2C9B6 signed dword sub: 음수HP/최대HP 초과를 보존
      rep.targets.push(u);
      rep.results.push({ unit: u, damage: damage, hpBefore: before, hpAfter: u.hp });
    });
    rep.후처리대상 = units.slice();
    return rep;
  };
  return rep;
}

/** 초필살기가 피해 앞에 거는 상태이상 — [+0x1E] 비트 · [+0x1F] = 0x5A (주소는 special 안 주석) */
var ULT_STATUS = { 0: { bit: 1 }, 9: { bit: 4 }, 11: { bit: 1 }, 12: { bit: 2, 대형제외: true, 대기리셋: true } };

function special(battle, u, slot, target, opts) {
  opts = opts || {};
  var Ru = R(), T = battle.T;
  if (!Ru) return { ok: false, reason: 'rules.js 가 없습니다' };
  var ultimate = (slot === 'ultimate' || (slot | 0) < 0 || opts.ultimate);
  var uv = view(battle, u);

  var need, uidx = -1;
  if (ultimate) {
    /* ★★★★★ **`opts.ultimateIndex`** — 이벤트(`op 0x6C` 값 ≥ 100)는 **번호를 직접 준다**
     *   (2026-08-23 · `0x302e6` 직독):
     *   ```asm
     *   0x302e6  mov ebx, eax          ; 시전자
     *   0x302e9  cmp dx, 0xc           ; ★ 번호 0~12 만 본다
     *   0x302ed  ja  0x30519
     *   0x302f8  jmp [eax*4+0x202b2]   ; ★★★ **캐릭터를 안 본다** — 번호로 직접 점프
     *   ```
     *   `0x51fbf call 0x302e6(eax=시전자, edx=값−100)` 이 그 자리다.
     *   출하 `.SCE` 의 초필살 번호는 1·3·4·7·8·10·11·12 — 전부 0~12 안이다.
     *   ⇒ 이벤트는 **그 캐릭터가 못 쓰는 초필살기도 강제로 쓴다.** */
    uidx = (opts.ultimateIndex != null) ? (opts.ultimateIndex | 0)
                                        : Ru.ultimateOf(u.charCode | 0, uv.equip.weapon, uv.equip.accessory);   // 0x4BC3C  실행부는 캐릭터만 · [리마스터] 짝 초필살기는 무기도
    if (uidx < 0) return { ok: false, reason: '초필살기가 없는 캐릭터입니다' };
    /* 발동 조건은 **(캐릭터 코드 [+0x0F], 무기 [+0x5B]) 짝** 입니다 — 0x4C06E~0x4C0E3.
     * 이루스(0x65)만 실행부에는 있는데 조건표에 빠져 원작에선 뜨지 않습니다(원본 버그).
     * 스크립트 발동처럼 조건을 무시해야 하면 opts.ignoreWeapon 을 켜십시오. */
    if (!opts.ignoreWeapon && !Ru.ultimateAvailable(u.charCode | 0, uv.equip.weapon, uv.equip.accessory))
      return { ok: false, reason: '초필살기 발동 조건(캐릭터↔무기 짝) 불충족',
               charCode: u.charCode | 0, weapon: uv.equip.weapon };
    need = Ru.ultimateTp(uidx, T);
  } else {
    slot = slot | 0;
    if (slot < 0 || slot > 24) return { ok: false, reason: '슬롯 범위 밖', slot: slot };
    var g = slotGroup(slot);
    if (g !== weaponTypeOf(battle, u)) return { ok: false, reason: '무기 계열이 다릅니다', slot: slot };
    need = Ru.specialTp(slot, T);
  }

  /* ② 차징 — 0x4007B
   *
   * ★ **이벤트 발동(`opts.free`)은 TP 검사를 하지 않습니다.**
   *   이벤트 경로는 `0x51E8B` → `0x51F86` → `0x302E6` 인데, `0x302E6` 은
   *   초필살 번호(dx)로 점프표(`0x202B2`)를 타 연출·리소스만 부릅니다 —
   *   TP 를 조회하는 자리가 없습니다. TP 검사는 링에서 고를 때(`0x4BE07` 등)
   *   하는 것입니다.
   *   아래 `magic()` 은 이미 `!opts.free` 가드가 있었는데 여기만 빠져 있어,
   *   TP 0 인 이올린의 **블리자드 스톰(초필살 12)이 「TP 부족」으로 죽었습니다.**
   *   그 바람에 `_afterExec` 을 안 타서 링도 안 걷혔습니다. */
  var charge = u.chargeTp | 0, tp = u.tp | 0;
  if (!opts.free && tp + charge < need) {
    var maxTp = (u.eff && u.eff.maxTp) || u.rawMaxTp || 0;
    if (opts.allowCharge === false || tp < maxTp)
      return { ok: false, reason: 'TP 부족', need: need, have: tp + charge };
    u.chargeTp = Math.min(500, charge + 20);                       // 0x400B4
    u.reserveSpecial = ultimate ? -1 : (slot + 1);                 // [+0x81] = 슬롯 + 1
    u.tp = 0;
    return { ok: true, kind: 'charge', need: need, charge: u.chargeTp, tp: 0 };
  }

  /* ③ 등급 추첨 — 일반 필살기만(0x4CA4B call 0x2CA40). 초필살기 길(0x4C99B → 0x4C9DE 0x302E6)은 추첨이 없다
   *   ☠ 초필살기에도 추첨해 크리티컬 순열 자리가 한 칸 밀리고 rand(12)(0x2CA5C)를 한 번 더 굴렸다 (2026-09-26 원본 기록 칸 07 난수) */
  /* ★ AI 는 이미 뽑았다(0x3FFD4 → 0x3FFFA 0x2CA40, 고르기 앞) — 그 등급을 쓰고 다시 뽑지 않는다 (2026-09-29) */
  var grade = ultimate ? 1 : (opts.grade != null ? (opts.grade | 0)
                                                 : Ru.specialClassRoll(uv, T, opts.rng || Ru.makeRng()));
  commit(battle, u, uv);

  var x, a, kind;
  if (ultimate) {
    var xa = (Ru.ultimateXa ? Ru.ultimateXa(uidx, u.charCode | 0, uv.equip.weapon, uv.equip.accessory) : Ru.ULTIMATE_XA[uidx]) || { x: 1, a: 0, kind: 'xa' };   /* [리마스터] 짝 초필살기 피해(진무대지파열) */
    x = xa.x; a = xa.a; kind = 'ultimate';
  } else {
    var row = SPECIAL_X[slot];
    /* ★ 이 `−1` 은 좌표가 아니라 **배열 색인**이다 — 등급 1·2·3 을 칸 0·1·2 로 옮긴다.
     *   (등급은 `0x2CA40 specialClassRoll` 이 1~3 으로 낸다) */
    x = row ? row[clamp(grade, 1, 3) - 1] : 0;     /* 0x2CA40 등급 1~3 → 색인 0~2 */
    a = specialA(battle, slot);
    kind = 'special';
  }

  /* ④ 대상 모으기 */
  var targets = opts.targets;
  /* ★ 화염인(11)은 고른 칸이 «착탄점»이다 — 0x39BD1 0x1AC08(반경 2) → 0x39C08 0x1A1F8 로 둘레 적을 전부 모은다.
   *   컨트롤러가 그 칸에 선 유닛 하나(targetUnits)를 넘겨도 그것으로 대신하지 않는다
   *   (2026-09-26 원본 기록 칸 11: 대상 3명 · ☠ 우리는 칸 위 한 명뿐이었다) */
  if (ultimate && uidx === 11) targets = null;
  if (!targets) {
    targets = [];
    /* ★★★★★ **「피해가 없다」와 「대상이 없다」는 다르다** (2026-09-10 · 필살기 전수)
     *
     *   ☠ `SPECIAL_EFFECT_ONLY` 는 **피해를 안 넣는** 슬롯 목록인데, 그것을 그대로
     *     「대상을 안 모은다」로 써 왔다. 그래서 **제(1·7)** 가 대상을 하나도 못 모아
     *     행동 봉쇄가 **한 번도 안 걸렸다.**
     *   ★ 원본 `0x2F4DE` 는 대상을 «모은다» —
     *     `0x2F51F [0xF0B9E] = 0` (개수 0) → `0x2F529 0x2CBFB`(반경) →
     *     `0x2F538 0x1AC08`(마름모) → `0x2F543 0x1AC59`(다음 칸) →
     *     `0x2F565 0x1A1F8`(그 칸의 적을 목록에) 을 돌고,
     *     `0x2E868 cmp [0xF0B9E], 0` 으로 **0 명이면 −1** 을 낸다.
     *   ⇒ 제는 피해만 없을 뿐 **대상이 필요하다.** 자기 버프(반·살·기)와 다르다. */
    var 대상없이 = (SPECIAL_EFFECT_ONLY.indexOf(slot) >= 0 && slot !== 1 && slot !== 7);
    if (ultimate || !대상없이) {
      var cells = ultimate ? ultimateCells(battle, u, uidx, opts)
                           : specialCells(battle, u, slot, grade, opts);
      for (var i = 0; i < cells.length; i++) {
        var t = battle.at(cells[i].x, cells[i].y);
        /* ★ 같은 유닛은 한 번만 — 원본 0x1A1F8(대상 등록)은 0x11DB2 칸의 유닛 → 0x1201D 관계 → **중복 검사**로 목록에 넣는다
         *   (초필살_블리자드스톰.md §0x1A1F8 · 연출_필살기.md 629). ☠ 전에는 칸마다 넣어 여러 칸을 차지하는 큰 몸(파괴신 등)이 겹치는 칸 수만큼
         *   같은 초필살기를 여러 번 맞았다 — 숫자는 겹쳐 떠 한 번처럼 보였다 (사장님 11-10 「아수라파천무 데미지는 3천대가 뜨는데 왜 5천이 넘는 파괴신이 한번에 죽지?」) */
        if (t && t.alive && hostile(u.side, t.side, battle.confuse) && targets.indexOf(t) < 0) targets.push(t);
      }
      /* 화염인(11)은 선택된 착탄점 주위의 적 목록만 쓴다.
       * `target`은 선택 칸 위의 유닛일 수 있어, 공통 ultimate 경로처럼
       * 덧붙이면 원본 0x1A1F8의 진영 필터를 우회해 아군을 때릴 수 있다. */
      if (!(ultimate && uidx === 11) && target && target.alive && targets.indexOf(target) < 0 &&
          (ultimate || slot === 18)) targets.push(target);
      /* ★ 직선 투척(검 비 3 · 창 투 9 · 권 장 21 → 0x2EB61)은 «고른 칸의 한 명»만 — 0x2EC61 0x4A483 고르기 → 0x2EC8C 0x1A1F8 로 그 칸만 등록 →
       *   0x2ED0D~0x2ED37 [0x80648] 하나에만 피해. 칸 수 N 도 그 칸까지의 거리(0x2ECC5 0x49ADF)다 (원본 기록 필살_03_g3: 3장 = N 1 · 2026-09-26) */
      if (!ultimate && (slot === 3 || slot === 9 || slot === 21)) {
        var 고른 = (opts && opts.at) ? battle.at(opts.at.x | 0, opts.at.y | 0) : target;
        targets = (고른 && targets.indexOf(고른) >= 0) ? [고른] : targets.slice(0, 1);
      }          // 궁 '심' 은 사거리 무시 (0x2FD03 활 심 · 0x2FD4D 0x13F08 화면 전체)
    }
  }

  /* 무신멸뢰옥은 `ultimateCells()`의 7칸 적 전부가 대상이 아니다.
   * 0x38097~0x38113 이 **첫 적 하나만** 잡고, 죽은 뒤에만 다음 7칸을 다시 훑는다. */
  /* [리마스터] 폭풍검(13) — 가까운 적부터 차례로 벼락 (2026-10-11 사장님 「2가」) · 같으면 모은 차례 그대로 */
  if (ultimate && uidx === 13) {
    var _가까움 = function (t) { return Math.abs((t.x | 0) - (u.x | 0)) + Math.abs((t.y | 0) - (u.y | 0)); };
    targets = targets.map(function (t, i) { return { t: t, i: i }; })
      .sort(function (a, b) { return (_가까움(a.t) - _가까움(b.t)) || (a.i - b.i); }).map(function (e) { return e.t; });
  }
  if (ultimate && uidx === 10) {
    var _musinFirst = musinNextTarget(battle, u, u.x | 0, u.y | 0);
    targets = _musinFirst ? [_musinFirst] : [];
  }
  /* [리마스터] 순옥살(14) — 정면 첫 적 한 명 (2026-10-12 고르심 「정면 첫 적 한 명」) · 무신 0x380FC 와 같은 찾기 */
  var _순자리 = null;
  if (ultimate && uidx === 14) {
    var _순첫 = musinNextTarget(battle, u, u.x | 0, u.y | 0);
    targets = _순첫 ? [_순첫] : [];
    /* 나아가 설 칸 = 대상 «바로 앞» (무신 0x382EE 와 같은 칸) · 다른 유닛이 있으면 제자리 — 연출과 커밋이 같은 값을 쓴다 */
    if (_순첫) {
      var _앞d = DIR[(u.dir | 0) & 3], _ax = (_순첫.x | 0) - _앞d.dx, _ay = (_순첫.y | 0) - _앞d.dy;
      var _있 = battle.at ? battle.at(_ax, _ay) : null;
      _순자리 = ((!_있 || _있 === u) && inMap(battle, _ax, _ay)) ? { x: _ax, y: _ay } : { x: u.x | 0, y: u.y | 0 };
    }
  }

  /* ★★ [리마스터] **범위에 대상이 없으면 발동하지 않고 링으로 되돌린다** ──────
   *
   * 사용자 지시 (2026-08-14): 「원작 기준 **초·연**은 아무 반응 없이 바로 링으로
   * 복귀, **제**는 칼을 휘두르려는 모션에서 링으로 복귀, **반·살·파**는 시전됨,
   * **비·혼**은 타겟 선택이니 별개. 다만 우리는 **초·연·제·파는 대상 없으면 바로
   * 링으로 복귀**하고 **반·살은 발동**하면 될 것 같아.」
   *   그리고 「이건 **필살기 자체에 넣어야 이벤트 사용에도 같이 적용**될 거야.」
   *   — 그래서 컨트롤러가 아니라 여기(`special`)에 둔다. 링·AI·SCE 이벤트가
   *   모두 이 함수를 지나므로 한 자리만 고치면 된다.
   *
   * ── 원본은 어떤가 — **필살기와 초필살기가 다릅니다** ────────────────
   *
   * ☠★★★★★ **여기 「IMMEDIATE 는 허공에도 그냥 시전된다」고만 적혀 있었습니다.**
   *   그것은 **필살기** 이야기인데 **초필살기까지 그런 것처럼** 읽혔습니다.
   *   원본을 뜯어 갈래를 나눕니다 (2026-09-08).
   *
   * | 무엇 | 대상이 0 이면 | 근거 |
   * |---|---|---|
   * | 필살기 `FRONT_AUTO` | −1 을 돌려주고 비용을 건너뜁니다 | `0x4CA5D cmp eax,-1` |
   * | 필살기 `IMMEDIATE`(검 제·검 파·창 제 …) | −1 경로가 **없어** 허공에도 시전 | 표 전수 |
   * | **초필살기** | ★ **−1 경로가 있습니다 — 안 나갑니다** | 아래 |
   *
   * 멸살성천무 `0x367EE` 를 진입점부터 읽으면 —
   * ```asm
   * 0x367FD  cx = [0xBA83E]              ; 카메라 좌상단 Y
   * 0x36804  [0xF0B9E] = 0               ; 대상 개수 초기화
   * 0x36823  call 0x1A1F8                ;   12×12 를 훑어 적을 모은다
   * 0x3684E  cmp  word [0xF0B9E], 0      ; ★ 모은 개수가 0 인가
   * 0x36856  jne  0x36862                ;     0 이 아니면 연출로
   * 0x36858  mov  ebx, 0xFFFFFFFF        ; ★ 0 이면 −1 을 돌려주고
   * 0x3685D  jmp  0x37799                ;     그대로 끝난다 (TP 도 안 씁니다)
   * ```
   * ⇒ `tables.json['초필살기발동']` 의 **`빈칸허용:false` 는 원본과 맞습니다.**
   *   대상이 범위에 없으면 **원본에서도 초필살기가 안 나갑니다.**
   *
   * ★ 곧 「제·파도 되돌린다」는 **필살기 쪽만** 리마스터입니다.
   *   (`리마스터_적용현황.md` 참조)
   *
   * ── 무엇을 되돌리고 무엇을 발동하나 ─────────────────────────────────
   * 표의 **`대상` 칸**이 그대로 갈라 줍니다. 사용자가 든 예와 정확히 맞습니다.
   *
   * | `대상` | 해당 | 여기서 |
   * |---|---|---|
   * | `적` | 초·연·제·파·격·회·광·뇌·투·장·붕·극 … | **대상 0 이면 취소** |
   * | `자기` | **반**(2) · **살**(4·12·20) · **기**(22) | 늘 발동 |
   * | `빈칸` | **혼**(5·10) · 비연참 · 화염인 | 빈 칸을 고르는 것이라 별개 |
   *
   * ★ 비용은 `applyHits()` 안에서 냅니다(`0x4CA6E`/`0x4CA73`). 여기서 먼저
   *   빠져나가므로 **TP·HP 를 한 톨도 안 씁니다** — 원본 취소와 같습니다.
   *   등급 추첨(`0x2CA40`)은 이미 지났는데, 원본도 실행 함수를 부르기 **전에**
   *   뽑으므로 같은 자리입니다.
   *
   * `opts.강제시전` 을 켜면 이 판정을 건너뜁니다(연출 시험용). */
  /* ★ 효과만 있는 슬롯(`SPECIAL_EFFECT_ONLY` — 검 제 1 · 창 제 7 · 권 붕 23)은
   *   위에서 **대상을 아예 안 모은다.** 그래서 `targets.length` 만 보면 적이
   *   옆에 있어도 늘 취소된다. 이 셋은 범위를 따로 세어 준다. */
  var 대상있음 = targets.length > 0;
  if (!대상있음 && !ultimate && SPECIAL_EFFECT_ONLY.indexOf(slot) >= 0)
    대상있음 = foeInCells(battle, u, specialCells(battle, u, slot, grade, opts));

  /* ★★ **이벤트로 터뜨릴 때도 마찬가지다.**
   *
   *   사용자 정정 2026-08-14: 「이벤트에도 **블리자드 스톰 자체는 적이 없으면
   *   발동 안 해.** 멘트만 하고. **이후 체력 회복은 진행**해야 해.」
   *
   *   곧 막아야 할 것은 **필살기 하나**이지 이벤트 줄기가 아니다. 여기서는
   *   그냥 취소를 돌려주고, 부르는 쪽(`전투.html` 의 `0x6C`/`0x08` 처리)이
   *   **연출만 건너뛰고 다음 명령으로 넘어간다.**
   *   (앞서 한 번 `opts.free` 를 통째로 면제했다가 「이벤트가 통째로 패스되어
   *    체력 회복이 안 보인다」는 지적을 받고 되돌렸다 — 원인은 면제가 아니라
   *    부르는 쪽이 취소를 안 다뤘던 것이다.) */
  if (!opts.강제시전 && !대상있음 && needsFoe(T, ultimate, uidx, slot)) {
    return { ok: false, cancelled: true, cost: false, kind: kind,
             slot: ultimate ? -1 : slot, ultimateIndex: uidx, grade: grade,
             targets: [], reason: '범위 안에 대상이 없습니다',
             근거: '[리마스터] 대상=적 인 필살기는 빈 채로 시전하지 않는다' };
  }

  var rep = { ok: true, kind: kind, slot: ultimate ? -1 : slot, ultimateIndex: uidx,
              grade: grade, x: x, a: a, need: need,
              targets: targets.slice(),                            // 연출이 쓸 대상 목록
              고른칸: (opts.at && opts.at.x != null) ? { x: opts.at.x | 0, y: opts.at.y | 0 } : null,   // 연출이 쓸 고른 칸 (화염인 착탄점 0x39B8D)
              results: [], deaths: [], effects: [], exp: [] };

  /* 무신멸뢰옥은 타격/대상 전환 자체가 연출 타임라인의 일부라 commit 전 plan을 싣는다.
   * 같은 plan을 연출과 실제 피해 적용이 함께 소비하므로 둘의 대상 순서가 갈라지지 않는다. */
  if (ultimate && uidx === 10) {
    rep.musin = musinPlan(battle, u, opts);
    rep.targets = rep.musin.targets.slice();
  }
  if (ultimate && uidx === 14 && _순자리) rep.순옥살자리 = _순자리;   /* [리마스터] 순옥살 — 연출이 나아갈 칸 · 커밋이 옮길 칸 */

  /**
   * 피해 적용 — 원본은 **연출이 끝난 뒤** 한다.
   *
   * 블리자드 스톰을 보면 `0x3AEE8` 이 눈보라를 다 돌린 **다음**
   * `0x3B593 ebx = 3 ; edx = 0x1B58 ; call 0x2CAF7` 로 피해를 넣고
   * `0x3B5A4` 로 돌아간다. 다른 필살기 연출도 같은 자리에 있다.
   *
   * 그래서 `opts.defer` 를 켜면 여기서 **계산도 적용도 안 하고** `rep.commit()`
   * 으로 미룬다. 부르는 쪽이 연출을 다 돌린 다음 부른다.
   *   ※ 안 미루면 시전 시작과 동시에 `alive = false` 가 되어 **적이 연출 도중에
   *     사라진다.** (사망 연출은 그 뒤에 나오므로 「그냥 없어지는」 것으로 보인다)
   */
  /* 무신멸뢰옥은 원본 0x385E6~0x3867C처럼 각 타격 끝에서 HP를 갱신한다.
   * HP<0일 때 S4(0x1DB50) 뒤에야 kill/사망 후처리를 잇도록 두 단계로 나눈다. */
  function applyMusinHit(ph) {
    if (!ph) return null;
    if (ph._제품적용됨) return ph._제품결과 || null;
    ph._제품적용됨 = true;
    var md = ph.unit;
    if (!md || !md.alive) return null;
    var mbefore = md.hp | 0;
    var mraw = mbefore - (ph.damage | 0);
    md.hp = Math.max(0, mraw);
    var mr = { unit: md, result: 'hit', attackType: 0, damage: ph.damage | 0,
               hpBefore: mbefore, hpAfter: md.hp | 0, died: false, kill: null,
               musinOrdinal: ph.ordinal | 0, musinTargetOrdinal: ph.targetOrdinal | 0 };
    ph._제품결과 = mr;
    ph._제품대기죽음 = mraw < 0;
    rep.results.push(mr);
    return mr;
  }
  function finalizeMusinDeath(ph) {
    if (!ph || ph._제품죽음확정) return ph && ph._제품결과 || null;
    ph._제품죽음확정 = true;
    if (!ph._제품대기죽음) return ph._제품결과 || null;
    var md = ph.unit, mr = ph._제품결과;
    if (!md || !mr || !md.alive || (md.hp | 0) > 0) return mr;  /* S4가 되살렸으면 취소 */
    if (md.alive) {
      mr.kill = kill(battle, md, { killer: u, reason: 'ultimate' });
      mr.died = true;
      if (rep.deaths.indexOf(md) < 0) rep.deaths.push(md);
      if (mr.kill && mr.kill.exp) rep.exp.push(mr.kill.exp);
    }
    return mr;
  }
  if (ultimate && uidx === 10 && rep.musin) rep.applyMusinHit = applyMusinHit;
  if (ultimate && uidx === 10 && rep.musin) rep.finalizeMusinDeath = finalizeMusinDeath;

  function applyHits() {
    /* ★ 미는 셋(비·투·붕)은 사망을 뒤로 미룬다 — 바로 아래 주석(`0x2ED66`) */
    var 밀슬롯 = !ultimate && specialKnocks(slot);
    var 유예된 = [];
    /* 무신멸뢰옥 — 0x3813D/0x3872A. 명중판정 없이 plan의 타격별 피해를 최대 11회 공유.
     * ★ 원본은 HP가 **음수(<0)** 일 때만 그 자리에서 사망 처리한다. 0은 다음 타격을
     * 한 번 더 받을 수 있으므로 applyDamage(<=0 사망)를 쓰지 않고 이 기술만 직접 뺀다. */
    if (ultimate && uidx === 10 && rep.musin) {
      var mh = rep.musin.hits || [];
      for (var mi = 0; mi < mh.length; mi++) {
        applyMusinHit(mh[mi]);
        finalizeMusinDeath(mh[mi]);  /* 중단된 presenter 경로도 HP=0/alive=true로 남지 않게 */
      }
      /* 0x382E0~0x38303 — 연출에서 마지막으로 도달한 대상 칸이 실제 시전자 위치다.
       * 피해/사망 처리가 끝난 뒤 grid를 갱신해 이후 행동·사거리도 그 위치에서 시작한다. */
      musinCommitPosition(battle, u, rep.musin);
    }
    /* 즉사형 초필살기 — 부동명왕검(0x1DB1D 이 [+0x48] = 0) */
    else if (ultimate && Ru.ULTIMATE_XA[uidx] && Ru.ULTIMATE_XA[uidx].kind === 'instakill') {
      for (var q = 0; q < targets.length; q++) {
        if (!targets[q].alive) continue;
        var res0 = applyDamage(battle, targets[q], targets[q].hp | 0, { killer: u, reason: 'ultimate' });
        rep.results.push({ unit: targets[q], damage: res0.damage, died: res0.died, instakill: true });
        if (res0.died) {
          rep.deaths.push(targets[q]);
          if (res0.kill && res0.kill.exp) rep.exp.push(res0.kill.exp);   // 0x1DBCD
        }
      }
    } else if (x > 0 || a > 0) {
      var atk = Math.floor(eff(battle, u).atk * x);                // 0x2CB0B  공격력 × x
      var hits = ultimate ? (Ru.ULTIMATE_XA[uidx].hits || 1) : 1;  // 무신 타수는 앞선 plan이 원본 경계로 산정
      /* ★★★★★ **미는 필살기는 사망을 «뒤로» 미룬다** — `0x2ED66` (2026-09-10)
       *
       *   원본 `0x2EB61` 안의 세 줄이 순서를 못박는다 —
       *   ```asm
       *   0x2ED37  [대상+0x48] -= 피해   ; ① HP 를 깎는다 (죽이지는 «않는다»)
       *   0x2ED53  call 0x2E896          ; ② ★ **민다**
       *   0x2ED66  call 0x1ED45          ; ③ 그제서야 사망 처리
       *   ```
       *   붕(`0x2FFF9`)도 마찬가지로 `0x30034` 넉백까지 하고 함수를 나가며,
       *   그 안에 `0x1ED45`·`0x1DB1D` 호출이 **한 곳도 없다** — 사망은 바깥 몫이다.
       *   그리고 넉백 `0x2E896` 은 대형(`0x2E8A4`)·탈것(`0x2E8B0`)만 거르고
       *   **살아 있는지는 안 본다.**
       *
       *   ⇒ 원본은 **죽어도 밀린 자리에서 쓰러진다.** 우리는 `strike` 가 그 자리에서
       *     바로 죽여 `alive` 가 꺼졌고, 그래서 쓰러지는 칸이 한 칸 달랐다.
       *   ★ 이미 있는 `사망유예`(`0x1ED45` 용) 를 그대로 쓴다 — 미는 셋에만 켠다. */
      /* ★ 활 연(16) — 원거리공통 0x2EF4A(edx=1): 첫 대상 하나에 0x1D770 을 «한 번» 굴려(0x2F11E~0x2F169) 등급 1 은 ×1 · 그 밖 ×2 («피해»에) + a →
       *   0x2F175 0x2CACA → 0x2F321~ 대상 전원에 «같은 피해»(0x45BFB) · 굴림은 화살 루프 «앞»이라 연출이 미뤄져도 미리 굴려 둔다(활연피해 · 2026-09-26 사장님 「원본대로」) */
      if (!ultimate && slot === 16) {
        var 연피 = 활연피해();
        for (var jy = 0; jy < targets.length && 연피 != null; jy++) {
          var ty = targets[jy];
          if (!ty.alive) continue;
          var yb = ty.hp | 0;
          var yres = applyDamage(battle, ty, 연피, { killer: u, reason: kind });
          var yr = { unit: ty, result: 'hit', attackType: 0, damage: 연피, hpBefore: yb, hpAfter: yres.hpAfter,
                     died: yres.died, kill: yres.kill };
          rep.results.push(yr);
          if (yr.died && rep.deaths.indexOf(ty) < 0) { rep.deaths.push(ty); if (yr.kill && yr.kill.exp) rep.exp.push(yr.kill.exp); }
        }
        hits = 0;
      }
      /* ★ 활 살(15) — 원거리공통 0x2EF4A(edx=0) 0x2F2C1: 등급 3 인데 첫 대상 레벨([+0x2B]) ≥ 시전자면 등급 2 (0x2F2C9~0x2F2D1)
       *   → 0x2F2E6 0x1D770(첫 대상 · ebx = 등급 − 1 «공격 종류»: 1 크리티컬 · 2 일격필살 판정 · ecx 0) + a → 0x2F321~ 대상 전원에 같은 피해
       *   배수·무기 보정(0x2CACA) 없음 · 붉은 번쩍 0x1E565 는 연출(battle_main 활쏘기)이 낸다 (2026-09-26 무인 직독)
       *   ☠ 예전에는 공격력 × 1·1.5·1.5 로 대상마다 따로 굴렸다 */
      if (!ultimate && slot === 15) {
        var s0 = targets[0];
        if (s0 && s0.alive) {
          var 살등급 = clamp(grade, 1, 3);
          if (살등급 === 3 && (s0.level | 0) >= (u.level | 0)) 살등급 = 2;
          var 살피 = strike(battle, u, s0, 살등급 - 1, { rng: opts.rng, atkOverride: Math.floor(eff(battle, u).atk), reason: kind,
                                                       noCounter: true, 판정없음: true, support: false, 계산만: true }).damage + (a | 0);
          for (var js = 0; js < targets.length; js++) {
            var ts = targets[js];
            if (!ts.alive) continue;
            var sb = ts.hp | 0;
            var sres = applyDamage(battle, ts, 살피, { killer: u, reason: kind });
            var sr = { unit: ts, result: 'hit', attackType: 살등급 - 1, damage: 살피, hpBefore: sb, hpAfter: sres.hpAfter,
                       died: sres.died, kill: sres.kill };
            rep.results.push(sr);
            if (sr.died && rep.deaths.indexOf(ts) < 0) { rep.deaths.push(ts); if (sr.kill && sr.kill.exp) rep.exp.push(sr.kill.exp); }
          }
        }
        hits = 0;
      }
      /* ★ 연타(검 연 0·창 연 8·권 연 19) — 0x2D3D8 0x1D770 피해 × (20·25·30) ÷ 10 + a · 공격력은 그대로 (SPECIAL_X 2·2.5·3 은 «피해» 배수) */
      var 연타 = !ultimate && (slot === 0 || slot === 8 || slot === 19);
      for (var h = 0; h < hits; h++) {
        for (var j = 0; j < targets.length; j++) {
          if (!targets[j].alive) continue;
          /* ★ 초필살기 — 0x2CAF7 은 0x1D770(ebx=0 일반 · ecx=0 지원 없음)만 부른다. 명중 판정도 지원 효과도 없다.
           *   'phys'(교아 0x354DE · 풍아 0x35F5C)는 공격력을 안 바꾸고 «피해 × x + a» 다 */
          var _초 = ultimate && Ru.ULTIMATE_XA[uidx];
          var _phys = !!(_초 && _초.kind === 'phys' && uidx !== 10);
          var r = strike(battle, u, targets[j], 0, _초 ? {
            rng: opts.rng, atkOverride: _phys ? undefined : atk, 피해배수: _phys ? x : 0, plusA: a,
            attr: (_초.attr != null) ? (_초.attr | 0) : undefined,   /* [리마스터] 폭풍검 전격 */
            reason: kind, noCounter: true, 판정없음: true, support: false,
            무기필살보정: uidx === 5 || uidx === 6,                 /* 교아 0x354EE · 풍아 0x35F72 → 0x2CACA */
            사망유예: 밀슬롯
          } : {
            /* ★ 일반 필살기도 명중 판정 0x1DDF0 이 없다 — 필살 구간 0x2C000~0x30400 에 0x1DDF0 호출이 한 곳도 없고
             *   0x2CAF7(0x2CB2F)·연타 0x2D3E1·직선 0x2ED19 모두 0x1D770(ebx=0 · ecx=0 지원 없음)만 부른다.
             *   ☠ 예전엔 판정을 굴려 회피·방어가 나고 rand(100) 이 한 칸씩 더 돌아 숫자 고리 피격음이 원본과 갈렸다 (원본 기록 필살_05_g3 · 2026-09-26) */
            rng: opts.rng, atkOverride: 연타 ? Math.floor(eff(battle, u).atk) : atk, 피해십분: 연타 ? Math.round(x * 10) : 0,
            plusA: a, reason: kind, noCounter: true, 판정없음: true, support: false,
            무기필살보정: 무기보정슬롯(slot),                    /* 연타 0x2D403 · 직선 0x2ED29 · 활 연 0x2F175 → 0x2CACA */
            사망유예: 밀슬롯                                   /* 0x2ED37 — 깎기만 */
          });
          rep.results.push(r);
          if (r.사망유예) { if (유예된.indexOf(r.unit) < 0) 유예된.push(r.unit); continue; }
          if (r.died && rep.deaths.indexOf(r.unit) < 0) {
            rep.deaths.push(r.unit);
            if (r.kill && r.kill.exp) rep.exp.push(r.kill.exp);          // 0x1DBCD
          }
        }
      }
      /* ★ 부 회(13) 등급 3 — 0x2F900 cmp di,2 · jle 뒤 같은 줄(0x1A452)을 다시 모아(0x2F939~0x2F962 살아 있는 적) 0x2F980 0x2CAF7 을 한 번 더
       *   ⇒ 두 번째 피해·두 번째 숫자 고리. 결과는 rep.둘째결과 에 따로 담는다 — 연출(DRIVER.special)이 첫 고리 뒤에 이어 낸다 (2026-09-26) */
      if (!ultimate && slot === 13 && (grade | 0) === 3) {
        rep.둘째결과 = [];
        for (var j2 = 0; j2 < targets.length; j2++) {
          if (!targets[j2].alive) continue;
          var r2 = strike(battle, u, targets[j2], 0, { rng: opts.rng, atkOverride: atk, plusA: a, reason: kind, noCounter: true, 판정없음: true, support: false });
          rep.둘째결과.push(r2);
          if (r2.died && rep.deaths.indexOf(r2.unit) < 0) {
            rep.deaths.push(r2.unit);
            if (r2.kill && r2.kill.exp) rep.exp.push(r2.kill.exp);
          }
        }
      }
    }
    /* ★ 활 뇌(17) — 숫자 고리 뒤 0x2FCE5 0x29437(비트 4 감전 · 기본 30 · 지속 칸 2) 를 대상마다 (0x28947 rand(100) 굴림 · 그림 300 이상 면역)
     *   (원본 기록 필살_17_g3: 박 330 에 rand(100) 셋 · 2026-09-26) */
    if (!ultimate && slot === 17) {
      /* ★ 숫자 고리 «뒤»에 건다 — 연출이 있으면 rep.뒤효과 로 미뤄 DRIVER.special 이 고리 뒤에 부른다(난수 차례 · 원본 기록 필살_17 박 330) */
      rep.뒤효과 = function () { rep.뒤효과 = null;
      targets.forEach(function (t) {
        if (!t || !t.alive) return;
        var cv뇌 = view(battle, u), dv뇌 = view(battle, t);
        if (Ru.statusApply(cv뇌, dv뇌, 4, 30, 2, { tables: T, rng: opts.rng })) {
          dv뇌.hp = t.hp | 0; dv뇌.mp = t.mp | 0;
          commit(battle, t, dv뇌);
          rep.effects.push('감전:' + (t.name || ''));
        }
      });
      };
      if (typeof root.__playSpecialFx !== 'function') rep.뒤효과();
    }
    /* ② 넉백 — 비(3) · 투(9) · 붕(23). 원본은 **대상 배열의 첫 유닛**만 민다
     *   (`0x2ED4B`/`0x3002C` 가 `[0xF0648]` 를 읽는다). 방향은 **시전자 방향**
     *   `[시전자+0x60] sar 24` 다. 장(21)은 `0x2ED46 jge` 로 걸러진다.
     *   ☠ 피해 갈래(`x > 0 || a > 0`) **밖**에 둔다 — 붕은 피해가 없는 등급이
     *     있어서, 안에 두면 그때 미는 것이 통째로 빠진다. */
    if (밀슬롯) {
      var 밀대상 = (targets && targets[0]) || target || null;
      var 민것 = 밀대상 ? knockback(battle, 밀대상, u.dir | 0, null) : null;
      if (민것) {
        rep.knockback = 민것;                     /* 연출이 쓴다 (모션 10 · 미끄러짐) */
        rep.effects.push('넉백:' + (민것.unit.name || '') + ' ' +
                         민것.from.x + ',' + 민것.from.y + '→' + 민것.to.x + ',' + 민것.to.y);
      }
      /* ③ `0x2ED66 call 0x1ED45` — 밀고 «난 뒤» 사망을 마무리한다 */
      for (var d = 0; d < 유예된.length; d++) {
        var 죽 = 유예된[d];
        if (!죽.alive || (죽.hp | 0) > 0) continue;             /* 0x1ED5C HP 재판정 */
        var k = kill(battle, 죽, { killer: u, reason: kind });
        if (rep.deaths.indexOf(죽) < 0) rep.deaths.push(죽);
        if (k && k.exp) rep.exp.push(k.exp);                    // 0x1DBCD
      }
    }

    /* [리마스터] 순옥살(14) — 시전자는 대상 «바로 앞» 칸(rep.순옥살자리 · 위에서 정함)에 선다 */
    if (ultimate && uidx === 14 && rep.순옥살자리) {
      var _순 = rep.순옥살자리;
      if (typeof battle.moveUnit === 'function') battle.moveUnit(u, _순.x, _순.y, u.dir); else { u.x = _순.x; u.y = _순.y; }
    }

    return rep;
  }

  function applyCosts() {
    /* ── ⑤ HP 소모 · ⑥ TP 소모 — 원본은 **연출이 끝난 뒤** 낸다 ──────────
     * ```asm
     * 0x4CA55  call [ebx*4 + 0x81474]   ; 필살기 실행 함수 = 연출 + 피해(0x3B593)
     * 0x4CA5D  cmp eax, -1 ; je         ; 취소면 비용도 안 낸다
     * 0x4CA62  cmp [시전자+0x11], 0x32  ; 직업 0x32 면제
     * 0x4CA6E  call 0x301BB             ; ★ HP 소모
     * 0x4CA73  … call 0x45B4E           ;   TP 소모
     * 0x4CA98  [시전자+0x57] = 0        ;   집중 게이지
     * ```
     * ★★ 예전엔 이 셋이 `special()` 몸통에 있어 **명령을 낸 순간** 깎였다.
     *   그래서 시전자 HP 가 연출 시작과 동시에 떨어지고, 그 자리에서
     *   `0x53797`(HP 조건) 이벤트가 걸려 **눈보라가 도는 중에 대사창이 떴다.**
     *   원본은 `0x301BB` 가 **끝나면서** `0x3029B call 0x53797` 로 검사하므로
     *   연출이 다 끝난 다음에야 트리거가 선다. */
    /* 무신멸뢰옥(10)은 본문 꼬리 0x38776 xor eax,eax로 AX=0을 반환한다.
     * 링 호출부 0x4C9E3 cmp ax,1 / 0x4C9E7 jne 0x4CA9E는 이때
     * 0x4C9F6 call 0x301BB와 후속 TP·집중 정리를 전부 건너뛴다. */
    /* ★ [리마스터 R-03] (2026-09-29 사장님 「무신멸뢰옥 tp 소모도 안되네..」) — 원작은 이루스가 무신을 못 쓰는 조건표 누락이라
     *   AX=0 반환(0x38776)으로 비용 꼬리를 건너뛰는 길은 원작에서 한 번도 안 돈다. 메뉴를 되살린 이상 다른 초필살처럼
     *   TP(0x75426 표)·HP(0x301BB)·집중을 치른다(리마스터_적용현황 R-03 · 필살기_데미지공식 「TP와 함께 HP도 차감」). */
    var 무신비용꼬리건너뜀 = false;
    /* ★ 이벤트 발동(opts.free — sceapply 만 넘긴다)은 HP 를 안 낸다: 원본 0x51F86~0x51FC6 · 0x302E6 은 함수표만 부르고
     *   0x301BB(HP 소모)는 링 0x4CA6E · 0x4C9F6 에만 있다
     *   (2026-10-10 16-1A 라시드 혼 12000→8000 · 사장님 「원작에서 둘다 체력 소모는 없었던 것 같기는 해」) */
    var hpCost = (무신비용꼬리건너뜀 || opts.free) ? 0 : (ultimate ? Ru.ultimateHpCost(uidx, T) : Ru.specialHpCost(slot, T));
    var paid = Ru.specialHpPay(view(battle, u), hpCost);
    var hp전 = u.hp | 0;
    /* 초필살기 비용은 본문과 대상 피해가 끝난 뒤 0x301BB에서 적용한다.
     * presenter의 rep.commit()은 대상 피해를 모델에 반영하지만, 사망 연출 뒤
     * selfHpCostBody가 0x30207 숫자 등록 시점에 HP 비용을 실제 확정한다.
     * ★ 일반 필살기도 같다 — 0x4CA55 call [0x81474] (피해 0x2CAF7 → 사망 0x1ED45 → 0x1DB1D 사망 연출·경험치 0x17A20)
     *   가 반환한 뒤 0x4CA6E 0x301BB HP · 0x4CA73 TP. 전에는 필살기만 commit 에서 먼저 깎았다
     *   (2026-10-02 사장님 「타겟이 죽는게(레벨업이나 경험치 획득하는게)먼저이고 그 이후에 체력이 달았던 것 같은데 우리는 반대야」)
     *   ☐ 이름의 «초필살» 은 옛 이름 — rep.초필살HP소모적용 을 battle_main 이 부른다 */
    var 초필살비용지연 = !!(opts.defer && !무신비용꼬리건너뜀);
    var hp적용됨 = false;
    function 시전자HP비용적용() {
      if (hp적용됨) return;
      hp적용됨 = true;
      if (paid > 0) u.hp = Math.max(100, (u.hp | 0) - paid);     // 0x3020C
      if ((u.hp | 0) !== hp전) {
        (rep.hp변경 || (rep.hp변경 = [])).push({
          변경유닛: u, 주체유닛: null,
          이전HP: hp전, 이후HP: u.hp | 0,
          까닭: ultimate ? '초필살지연' : '필살지연', 원본경계: '0x3029B'
        });
      }
    }
    if (초필살비용지연) rep.초필살HP소모적용 = 시전자HP비용적용;
    else 시전자HP비용적용();
    rep.hpCost = hpCost; rep.hpPaid = paid;
    /* ★★★★★ **S4 경계 `0x3029B`** — 통합 2-c 1단계 (2026-08-22 · GPT 12차)
     *
     *   원본은 HP 를 깎은 **바로 그 함수 끝**에서 검사한다:
     *     0x3020C  sub [시전자+0x48], ecx   ; ★ 위 한 줄이 이것
     *     0x30285  cmp bx, 0x19            ; 게이지 25프레임
     *     0x30292  call 0x12124            ; 픽셀 오프셋 되돌리기
     *     0x30297  xor edx, edx            ; ★ **주체 없음**
     *     0x3029B  call 0x53797 (eax=esi=시전자, ebx=1)   ★ **S4**
     *
     *   ★ `eax` = **시전자**다. 「초필살 피해를 받은 대상」이 아니다.
     *   ★ `edx = 0` 이므로 **주체유닛은 없다**(`SCE_HP변경_창구.md` §3-c).
     *
     *   ★★★ **여기서 창구를 직접 부르지 않는다** — `combat.js` 는 순수 규칙층이라
     *     `SceRuntime`·컨트롤러를 몰라야 한다(GPT 12차: 「`applyDamage()` 는 결과만
     *     보존하면 된다. 그 후 오케스트레이션 층에서…」).
     *     ⇒ **보고 재료를 `rep.hp변경` 에 실어** 보내고, 컨트롤러가 창구에 넘긴다. */
    var pay = 0;
    if (!opts.free && !무신비용꼬리건너뜀) {
      pay = need - (u.chargeTp | 0);
      rep.tpCost = Math.max(0, pay);
    }
    if (!opts.free && !무신비용꼬리건너뜀 && !초필살비용지연)
      u.tp = Math.max(0, (u.tp | 0) - Math.max(0, pay));          // 0x4CA73
    var tp적용됨 = false;
    /* 0x4CA98 [+0x57]=0 · [+0x81]=0 — 명령 처리기가 연출을 «다 돌린 뒤» 한다 (2026-09-27 · 비연참 원본 집중 3000 이 278 틱까지 남아 불꽃 틀33 이 뜬다)
     *   ☠ 피해를 넣는 applyAll 안에서 비워, 초필살처럼 연출 중간에 피해를 넣으면 그때 불꽃이 꺼졌다(우리 135 틱) → defer 면 rep.집중지우기 로 넘긴다 */
    var 집중끄기 = function () {
      if (초필살비용지연 && !tp적용됨) {
        tp적용됨 = true;
        if (!opts.free) u.tp = Math.max(0, (u.tp | 0) - Math.max(0, pay));  // 0x4CA73 — HP 소모 숫자 고리 뒤
      }
      u.chargeTp = 0; u.reserveSpecial = 0;
    };
    if (opts.defer) {
      if (!무신비용꼬리건너뜀) rep.집중지우기 = 집중끄기;
    } else if (!무신비용꼬리건너뜀) 집중끄기();

    return rep;
  }

  /* 혼(5·10)의 연출은 논리 이동 전에 출발/도착 좌표가 필요하다.
   * 좌표 메타만 먼저 확정하고 실제 grid 이동은 applySpecialEffects()에서 한다. */
  /* ★ 비연참(초필살 0)도 고른 빈 칸으로 옮긴다 — 0x30E9B~0x30ED5 가 시전자 x/y 에 거리([esp+0x50])를
   *   방향대로 더하고 0x30EE2 0x11E04 로 그 칸에 세운다. 고른 칸은 방향 직선 위라 곧 opts.at 이다 (2026-09-26 무인 직독) */
  var dashPending = ((!ultimate && (slot === 5 || slot === 10)) || (ultimate && uidx === 0)) && opts.at &&
                    opts.at.x != null && opts.at.y != null &&
                    !battle.at(opts.at.x | 0, opts.at.y | 0);
  if (dashPending) {
    rep.from = { x: u.x | 0, y: u.y | 0 };
    rep.destination = { x: opts.at.x | 0, y: opts.at.y | 0 };
  }

  function applySpecialEffects() {
    /* 효과만 있는 슬롯 — §1.5 의 [+0x13] 비트 */
    /* ★ 초필살기 상태이상 — 피해(0x2CAF7) 바로 앞에 대상 전원에게 [+0x1E] |= 비트 · [+0x1F] = 90 (2026-09-26 무인 직독)
     *   0 비연참 0x30EFA 비트 1 · 9 광룡탄 0x37F41 비트 4 · 11 화염인 0x3A864 비트 1 — 판정·크기 거르기 없음
     *   12 블리자드 0x3B4BA 그림 300 이상은 건너뜀 · 0x3B4C2 비트 2 · 0x3B4D8 0x197AD(대기 0 · 큐에서 뺌)
     *   ☠ 예전에는 블리자드만 연출(ultimate.js)이 걸었고 지속을 [+0x1F] 가 아닌 곳(ailmentDur)에 넣었다 · 나머지 셋은 없었다 */
    if (ultimate && ULT_STATUS[uidx]) {
      var _us = ULT_STATUS[uidx];
      for (var _ui = 0; _ui < targets.length; _ui++) {
        var _ut = targets[_ui];
        if (!_ut || !_ut.alive) continue;
        if (_us.대형제외 && spriteProfile(_ut).magicEffectExcluded) continue;   /* 0x3B4BA 그림 300 컷 — 의미 판정 */
        var _uv = view(battle, _ut);
        _uv.f1e |= _us.bit;
        _uv.st.d1e[0] = 0x5A;
        if (_us.대기리셋) { _uv.wait = 0; }
        commit(battle, _ut, _uv);
        if (_us.대기리셋) _ut.acted = false;                 /* 0x197AD — 0x19718 큐에서 뺀다 (제와 같은 꼴) */
        rep.effects.push('상태:' + _ut.name);
      }
    }
    if (dashPending && ultimate) {                          /* 비연참 0x30E9B → 0x11E04 착지 */
      battle.moveUnit(u, rep.destination.x | 0, rep.destination.y | 0, u.dir);
      rep.destination = { x: u.x | 0, y: u.y | 0 };
      rep.effects.push('돌진');
    }
    if (!ultimate) {
    var v2 = view(battle, u);
    if (slot === 2) { v2.f13 |= (4 << (grade - 1)); rep.effects.push('반격자세'); }   // 0x2F56C
    if (slot === 4 || slot === 12 || slot === 20) {                                   // 살
      if (grade >= 3) { v2.f13 |= 0x40; rep.effects.push('일격필살100%'); }           // 0x2F5CF
      else { v2.f13 |= 0x20; rep.effects.push('크리티컬100%'); }                      // 0x2F5C0
    }
    /* ★★★★★ **혼(5·10)은 고른 칸으로 옮긴다** — `0x2E385` (2026-08-30 · B-1)
     *   원본은 `0x2E4F5 call 0x11F74` 로 시작 칸을 비우고,
     *   `0x2E525`/`0x2E53B` 의 끝점(=고른 칸)까지 5분의 1씩 날아간 뒤 거기 선다.
     *   ★ 방향은 그대로 둔다 — `0x2E385` 에 `+0x63` 대입이 없다.
     *   ★ 연출이 쓰도록 출발 자리를 남긴다(돌진 스킬 `0x46DF1` 과 같은 꼴).
     *   ☠ 고른 칸이 안 오면(AI·이벤트) 안 옮긴다 — 지어내지 않는다. */
    if (dashPending) {                                      /* 0x2E3E4 — 빈 칸이어야 */
      battle.moveUnit(u, rep.destination.x | 0, rep.destination.y | 0, u.dir); /* 0x2E4F5 → 착지 */
      rep.destination = { x: u.x | 0, y: u.y | 0 };
      rep.effects.push('돌진');
    }
    if (slot === 22) { v2.f13 |= 0x80; rep.effects.push('다음턴TP250'); }             // 0x2FFF0
    /* ★★★★★ **넉백** — 비(3) · 투(9) · 붕(23) (`knockback` 주석의 전수)
     *   원본은 **대상 배열의 첫 유닛**만 민다 (`0x2ED4B`/`0x3002C` 가 `[0xF0648]` 를 읽는다).
     *   방향은 **시전자 방향** `[시전자+0x60] sar 24` 다.
     *   ★ 순서 — 피해를 «넣은 뒤»에 민다 (`0x2ED37` HP → `0x2ED53` 넉백). */
    /* ★ 실제로 미는 자리는 `applyHits()` 안이다 — 아래 주석 참조 (2026-09-10) */
    /* ★★★★★ **제(1·7) 는 「대기 리셋」이지 상태이상이 아니다** — `0x197AD` (2026-09-10)
     *
     *   원본 `0x2E80C` 의 대상 루프는 딱 둘만 한다 —
     *   ```asm
     *   0x2E829  call 0x4F4CD(0x32)          ;   소리 50
     *   0x2E835  call 0x2D527                ;   ★ **연출** (0x1033B 틱 · 0xF0DAA 프레임)
     *   0x2E842  call 0x197AD                ;   ★★ 효과 — 그것뿐이다
     *   ```
     *   그리고 `0x197AD` 는 두 줄이다:
     *   ```asm
     *   0x197B0  call 0x19718                ; ★ 행동 «큐»(0xF041C 연결 리스트)에서 뺀다
     *   0x197B5  mov byte [edx + 0x56], 0    ; ★ **재행동 대기를 0 으로** (0xFF = 행동 가능)
     *   ```
     *   ⇒ 대상은 **처음부터 다시 기다려야** 한다 — 그것이 문서의 「움직임을 둔화」다.
     *
     *   ☠ 우리는 여기에 **원본에 없는 상태이상 2 를 100 지속**으로 걸고 있었다
     *     (`f1e = …|2` · `d1e[0] = 100`). 그 자리는 빙결(`0x199A9`) 것이지 제가 아니다. */
    if (slot === 1 || slot === 7) {                                                   // 제 — 0x2F4DE
      for (var z = 0; z < targets.length; z++) {
        /* ☠ 대형/특수 본체(그림 300 컷)를 건너뛰던 줄을 뺐다 (2026-10-04 사장님 「1번으로 원작대로 고쳐줘」)
         *   원본 0x2F565 0x1A1F8(적대만) → 0x2E80C 루프 → 0x197AD 어디에도 그 거르기가 없다 — 큰 적도 턴이 밀린다. */
        var tv = view(battle, targets[z]);
        tv.wait = 0;                                           // 0x197B5  [+0x56] = 0
        commit(battle, targets[z], tv);
        targets[z].acted = false;                              /* 0x19718 — 큐에서 빠져 다시 기다린다 */
        rep.effects.push('대기리셋:' + targets[z].name);
      }
    }
    commit(battle, u, v2);
  }
    return rep;
  }

  /** 활 연 피해 — 한 번만 굴려 담아 둔다 (0x2F11E~0x2F175 · 대상이 없으면 null) */
  function 활연피해() {
    if (rep._활연피해 !== undefined) return rep._활연피해;
    var t0 = targets && targets[0];
    if (!t0 || !t0.alive) return (rep._활연피해 = null);
    var 밑 = strike(battle, u, t0, 0, { rng: opts.rng, atkOverride: Math.floor(eff(battle, u).atk), reason: kind,
                                        noCounter: true, 판정없음: true, support: false, 계산만: true }).damage;
    return (rep._활연피해 = 무기필살위력(u, (clamp(grade, 1, 3) === 1 ? 밑 : 밑 * 2) + (a | 0)));
  }
  if (!ultimate && slot === 16) 활연피해();                  /* ★ 화살(연출) «앞»에 굴린다 — 0x2F14B 가 0x2F1A3 화살 루프보다 먼저 */

  /* 원본 `0x4CA55 → 0x4CA6E → 0x4CA73` 계약:
   * 기술 본문(이동/상태/피해)이 끝난 뒤 HP/TP 비용을 확정한다.
   * `opts.defer` 일 때는 이 전체 묶음을 presenter 뒤로 미룬다. */
  function applyAll() {
    if (rep.committed) return rep;
    applySpecialEffects();
    applyHits();
    applyCosts();
    rep.committed = true;
    rep.morale = { ally: battle.morale.ally, enemy: battle.morale.enemy };
    return rep;
  }

  if (opts.defer) {
    rep.committed = false;
    rep.commit = applyAll;
    /* 연출이 필요로 하는 읽기 전용 메타는 이미 rep에 준비돼 있다. */
    rep.morale = { ally: battle.morale.ally, enemy: battle.morale.enemy };
  } else {
    applyAll();
  }
  return rep;
}

/* ══════════════════════════════════════════ 6. 마법 (0x432A0 / 0x4C605) */

/** 마법 번호 → {계열, 레벨, 랭크} — 0x43287 의 역산. */
/* 마장기 소환 호출부 0x4CCB4~0x4CD34 — 캐릭터 코드 → 마장기 코드.
 * 그림 번호는 마장기 코드 + 299 (0x17E7C add eax,0x12B). 렌더러 선로드도 이 표를 쓴다. */
var 마장기소환표 = {
  0x02: { code: 0x10 }, // 0x4CCCE 라시드 → 아론다이트
  0x16: { code: 0x14 }, // 0x4CCF2 랜담 → 가리우스
  0x1D: { code: 0x0F }, // 0x4CD1A 알시온 → 아바레스트
  /* [리마스터] 2026-09-24 사장님: 「카심, 카오스소드 장착시 라 소환으로 연결해줘.」
   *   원본 0x4CCB4~0x4CD34 에는 카심 갈래가 없다. 링 조건(카오스소드 0x18)은 ring.js,
   *   라 = 마장기 0x15 (MOUNT 표 0x72E9A+0x15×16 이 이미 있다). 리마스터_적용현황.md */
  0x73: { code: 0x15 }, // 카심 → 라
  /* [리마스터] 2026-10-03 사장님 「아론다이트도 본래 아이스가 사용하던거야」 — 아이스(143) + 바리사다 0x20 (ring.js 무기 조건) */
  143:  { code: 0x10 },  // 아이스 → 아론다이트
  /* [리마스터] 2026-11-13 사장님 11-12 「GS의 경우 데스로드가 되면 아수라 소환(마장기) 넣는게 좋겠어. (리마스터)」
   *   GS(0x12)가 데스로드(직업 2)일 때만 · 아수라 = 마장기 0x11(이급마장기표 칼스 쪽과 같은 코드 · MOUNT 표 0x72E9A) · 설정 '아수라소환' 이 '원작' 이면 없음
   *   무기 조건은 없다(1급 원본 0x4CCB4 처럼 캐릭터만) — ring.js 는 1급 무기표에 GS 가 없어 이 표(마장기소환찾기)로 온다 */
  0x12: { code: 0x11, 조건: function (u) { return (u.job | 0) === 2; }, 설정: '아수라소환' }
};
/* [리마스터] 2급 마장기 소환 — 원본에는 없다(시나리오가 배치만 한다). 2026-10-03 사장님 선택 ③
 *   「일단 3번으로 가되 아직은 아이템 종류를 특정하지 않고 바로 사용할 수 있게 해두고 후에 아이템 추가시 그부분만 추가해서 넣으면 될 것 같아.」
 *   캐릭터 코드 → 2급 마장기 (탈것_시스템.md 등급표 · 명단은 사장님 원문 그대로 · 리마스터_적용현황.md) */
var 이급마장기표 = {
  1: 0x13, 3: 0x13, 4: 0x13, 10: 0x13, 13: 0x13, 12: 0x13, 11: 0x13, 14: 0x13, 134: 0x13,      // 엘제나로 — 이올린 듀란 로카르노 캐빈 신디 사이렌 사이브리드 지크 듀나미스
  100: 0x11, 113: 0x11, 106: 0x11, 112: 0x11, 105: 0x11, 101: 0x11, 107: 0x11, 141: 0x11,     // 아수라 — 칼스 번스타인 카슈타르 그리엄 로벨 이루스 D.블레이드 에제르
  80: 0x12, 81: 0x12, 83: 0x12, 86: 0x12, 82: 0x12, 84: 0x12, 85: 0x12, 87: 0x12, 88: 0x12,   // 듄그리니드 — 에리히 슈리 엔데 세실 베케네 바하무트 화리스 폴터 네오리스
  116: 0x16, 117: 0x16                                                                       // 야누스 — 마에트로 아즈님
};
/** 2급 소환 조건 — ★ 아이템 조건 자리. 지금은 조건 없이 된다(사장님 2026-10-03). 아이템을 정하면 여기만 바꾼다. */
function 이급소환조건(battle, u) { return true; }
/** 이 유닛이 부를 마장기 — 1급(원본 0x4CCB4 표) 먼저, 없으면 2급 */
function 마장기소환찾기(battle, u) {
  var c = (u && u.charCode) | 0;
  if (마장기소환표[c]) {
    var 항 = 마장기소환표[c];
    /* [리마스터] 조건·설정이 달린 항목(GS 데스로드 아수라) — 조건이 안 맞거나 설정이 '원작' 이면 없는 것으로 */
    var 옵 = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;
    if (항.설정 && 옵 && 옵[항.설정] === '원작') return null;
    if (typeof 항.조건 === 'function' && !항.조건(u)) return null;
    return 항;
  }
  if (이급마장기표[c] != null && 이급소환조건(battle, u)) return { code: 이급마장기표[c], 급: 2 };
  return null;
}
function spellParts(n) {
  n = n | 0;
  return { series: idiv(n, 21), level: idiv(n % 21, 3), rank: (n % 21) % 3 };
}
/** 계열 → 상성 속성. 화염0 빙한1 전격2 · 암흑6 → 3. 나머지는 −1(상성 없음). */
function seriesAttr(s) { return (s <= 2) ? s : (s === 6 ? 3 : -1); }

/**
 * 마법 시전.
 * @param {number} spellNo 0~146 (= 계열×21 + 레벨×3 + 랭크)
 * @param {object} opts { rng, free, targets, power, div, heal, allowCharge }
 *
 *   MP  = 0x753B6[레벨]  ({10,15,20,30,40,60,80})           0x434D2
 *   TP  = 0x753A8[레벨] × (무기 종류 2 면 1, 아니면 2)      0x28480
 *   위력 = 0x283FE / 0x2840A 의 클래스별 상수 (기본은 랭크로 고릅니다)
 *   제수 = 그 마법의 "지력 하한"                            §3.2
 *   회복 계열(3)은 0x2ACCB — **언데드에게는 피해 2배**
 */
function cast(battle, u, spellNo, target, opts) {
  opts = opts || {};
  var Ru = R(), T = battle.T;
  if (!Ru) return { ok: false, reason: 'rules.js 가 없습니다' };
  var p = spellParts(spellNo);
  var wt = weaponTypeOf(battle, u);
  var mpCost = Ru.spellMp(p.level, T);
  var need = Ru.spellTp(p.level, T, wt);

  /* ★ 보스(0x43F7B·0x4412A·0x441B0)는 함수표 [0xF13B0] 를 곧장 부른다 — 0x432A0 의 침묵·MP 검사(0x432B5~0x432CA)와
   *   MP 차감(0x434CE)을 안 지난다 (2026-09-29) */
  var 함수표직접 = !!opts.함수표직접;
  if (!함수표직접 && (((u.f1e | 0) | (u.ailment | 0)) & 8)) return { ok: false, reason: '사일런스' }; // [+0x1E] & 8
  if (!함수표직접 && (u.mp | 0) < mpCost) return { ok: false, reason: 'MP 부족', need: mpCost };

  var charge = u.chargeTp | 0, tp = u.tp | 0;
  if (!opts.free && tp + charge < need) {                                 // 0x433AA
    var maxTp = (u.eff && u.eff.maxTp) || u.rawMaxTp || 0;
    if (opts.allowCharge === false || tp < maxTp)
      return { ok: false, reason: 'TP 부족', need: need, have: tp + charge };
    u.chargeTp = Math.min(500, charge + 20);
    u.reserveSpell = spellNo + 1;                                         // [+0x7F] = 번호 + 1
    u.tp = 0;
    return { ok: true, kind: 'charge', need: need, charge: u.chargeTp, spell: spellNo };
  }

  var attr = seriesAttr(p.series);
  var powTable = T['마법클래스위력'] || {};
  /* ★★★★★ **마법 공통 경로는 `0x283FE` 표 하나만 쓴다** (2026-09-04 실측 정정)
   *
   *   > 사용자: 「**데미지도 너무 세.** 원본과 데미지 차이가 많이 나」
   *   > `파워썬더.gif` 에서 숫자를 읽었다 — 원본 **70** · 우리 **158** (약 2.2 배).
   *
   *   ☠ 여태 「레벨 4 이상이면 `0x2840A`(5000·8000·12000)」로 갈랐는데 **틀렸다.**
   *     원본 마법 공통 경로는 스택으로 표를 복사해 쓰는데, 그 자리가 **하나**다 —
   *   ```asm
   *   0x2A76D  edi = esp
   *   0x2A76F  **esi = 0x283FE**          ; ★ 2000 · 4000 · 7000
   *   0x2A774  movsd ; movsd ; movsd      ;   세 칸을 스택에 복사
   *   …
   *   0x2AA3D  eax = [esp+0xE] sar 0x10   ;   클래스
   *   0x2AA49  ebx = 0x46(70)             ;   div
   *   0x2AA4E  **edx = [esp + eax*4]**    ; ★ 그 스택 표에서 power
   *   0x2AA53  call 0x28728               ;   피해 루프
   *   ```
   *   `0x2A500`~`0x2AD00` 대역에서 위력표를 스택에 복사하는 자리를 **전수로 훑으니
   *   `0x2A76F` 하나**였다.
   *
   *   ★ `0x2840A`(5000·8000·12000)는 **소환수 경로**다 —
   *     참조가 `0x2BAA9` 한 곳뿐이고, 그 함수(`0x2BA8E` → `0x2B5C4`)를 부르는
   *     `0x2C36E` 가 `0x29C5A`(소환 후보 칸)를 부른다.
   *   ☐ 소환수 피해에 그 표를 쓰는지는 **아직 안 봤다.** 확인 전까지 여기서는 안 쓴다. */
  /* ★★★★★ **위력은 「단계 × 계열」로 정해진다 — 클래스만 보면 안 된다** (2026-09-06)
   *
   *   > 사용자 2026-09-04: 「이펙트를 바꿔서 나오게 해놓고 좌표를 틀리고 · 소리도 안 맞고 ·
   *   >  카메라도 안 맞고 · **데미지 공식도 안 맞고**」
   *
   *   ☠ 바로 위 주석이 「마법 공통 경로는 `0x283FE` 표 **하나만** 쓴다」고 단정했는데
   *     **틀렸다.** 표를 스택에 복사하는 자리를 `0x2A500`~`0x2AD00` 안에서만 훑어서
   *     **4단계 함수의 `0x29742 mov esi,0x28352` 를 통째로 놓쳤다.**
   *     `0x283FE` 를 읽는 `0x2A76F` 는 **7단계 함수 `0x2A75A` 안**이다 —
   *     곧 그 표는 **7단계 전용**인데 우리는 일곱 단계 모두에 쓰고 있었다.
   *
   *   ── 단계 함수 일곱 (`0x2B5C4` 가 차례로 부른다) ─────────────────────
   *
   *   | 함수 | 단계 | 화염 | 빙한 | 전격 | 나눗값 |
   *   |---|---|---|---|---|---|
   *   | `0x28ED6` | 1 | **3000/4500/6000** | 같음 | `클래스×1500+3000` | 20 |
   *   | `0x29273` | 2 | 피해 없음 — 무기 속성 부여 | | | — |
   *   | `0x29514` | 3 | **2000** | **1000** | 2000 | 30 |
   *   | `0x29722` | 4 | **15000** | **10000** | **12000** | 30 |
   *   | `0x29F4D` | 5 | 피해 없음 — 소환 | | | — |
   *   | `0x2A1C6` | 6 | **25000** | **20000** | `클래스×2000+24000` | 50 |
   *   | `0x2A75A` | 7 | 2000/4000/7000 | 같음 | 같음 | 70 |
   *
   *   ```asm
   *   ; ── 1단계 (0x28ED6) — 클래스마다 리터럴
   *   0x28F92 call 0x2016A(F_ARROW)  → 0x28F97 ebx=0x14 · 0x28F9C edx=0xBB8  = 3000
   *   0x28FD3 call 0x2016A(F_BALL)   → 0x28FD8 ebx=0x14 · 0x28FDD edx=0x1194 = 4500
   *   0x29008 call 0x203CC(F_BLAST)  → 0x28FEE ebx=0x14 · 0x2900D edx=0x1770 = 6000
   *   0x29102 call 0x23882(LBOLT)    → 0x2910E imul edx,edx,0x5DC(1500)
   *                                    0x29120 add  edx,0xBB8(3000)   ; 같은 값이 된다
   *   ; ── 4단계 (0x29722) — **계열**로 꺼내는 표
   *   0x2973E lea edi,[esp+8] · 0x29742 mov esi,0x28352 · movsd ; movsw   ; 6바이트
   *   0x29974 mov edx,[esp+ecx*2+6] · 0x2997A sar edx,0x10   ; = [esp+8+계열*2] word
   *   0x2996F mov ebx,0x1E(30)
   *      표 실측 0x28352 word — **15000 · 10000 · 12000**
   *   ; ── 6단계 (0x2A1C6) — 계열 점프표 0x2A1AE
   *   0x2A2B5 ebx=0x32(50) · 0x2A2BA edx=0x61A8(25000)   ; 화염6 EXPLOSIO/FIRESTOR/HELLFIRE
   *   0x2A2FE ebx=0x32(50) · 0x2A303 edx=0x4E20(20000)   ; 빙한6 ICESTORM/BLIZZARD
   *   0x2A342~0x2A35D  eax=클래스 shl5(×32) sub(×31) shl2(×124) add(×125) shl4(×2000)
   *                    lea edx,[eax+0x5DC0(24000)]        ; 전격6 P_LIGHT
   *   ; ── 7단계 (0x2A75A)
   *   0x2A76F mov esi,0x283FE · movsd×3 → 스택
   *   0x2AA4E mov edx,[esp+eax*4](클래스) · 0x2AA49 ebx=0x46(70)
   *   ```
   *
   *   ★★★ **칸 대응은 NSP 파일 이름으로 교차검증했다** — 골격 표의 칸 이름은 우리
   *     SPEC 에서 온 것이라 근거가 못 된다(순환 논리). 진짜 근거는
   *     `03_분석/COMBATII/이펙트_배정표.md`(MAGICSPR NSP 110개 직접 디코드):
   *     `F_ARROW`=화염1 · `F_FIELD`=화염3 · `THUNDWAV`=전격4 · `EXPLOSIO`=화염6 ·
   *     `P_LIGHT`=전격6 · `METEO`=화염7 · `THUN7`=전격7.
   *
   *   ★ **147칸 전제도 원본 링에서 세어 확인했다** (`원본_마법목록_세기.js`) —
   *     일곱 계열 모두 단계 아이콘 8~14(일곱 칸)가 활성이다.
   *
   *   ★ 예전 지적 「**데미지도 너무 세**」(파워썬더 원본 70 · 우리 158)는
   *     **7단계**(`div[6]`=70) 이야기였고 — `Power Thunder`=`THUN73`=**전격7 3클** —
   *     `0x2840A`(…8000…) 를 쓰던 것이 원인이라 `0x283FE` 로 바꿔 **이미 해결됐다.**
   *     검산: 위력 7000 · 나눗값 70 · 지력 70 미만 ⇒ 배율 하한 100 % ⇒
   *     `100×7000÷100` = 7000 = 화면 표시 **70**. 실측과 정확히 같다.
   *
   *   ☠☠ 옛 주석의 「`0x2840A`(5000·8000·12000)는 **소환수 경로**다 — 참조가
   *     `0x2BAA9` 한 곳뿐이고 그 함수를 부르는 `0x2C36E` 가 `0x29C5A`(소환 후보 칸)를
   *     부른다」는 **틀렸다** (2026-09-06 정정).
   *     `0x2BAA9` 는 `0x2BAA8 mov esi, 0x2840A` 의 **오퍼랜드 자리**이고,
   *     그 함수 `0x2BA8E` 는 `0x2BB0C call 0x25254`(**회복2 Wide Heal 연출**)를
   *     부른 뒤 `0x2BB58 mov edx,[esp+eax*4]` 로 그 표를 클래스로 꺼내
   *     `0x2BB5D call 0x2ACCB`(회복)에 넘긴다.
   *     ⇒ `0x2840A` 는 **Wide Heal 회복량표**다. 아래 회복 계열에서 쓴다. */
  var basePow = powTable['0x283FE'] || [2000, 4000, 7000];   // 0x2A76F — **7단계 전용**
  /** 단계(0~6) × 계열(0 화염 · 1 빙한 · 2 전격) → 위력.
   *  배열이면 클래스별, 숫자면 클래스 무관, `null` 이면 피해 자체가 없다. */
  var 원소위력 = [
    [[3000, 4500, 6000], [3000, 4500, 6000], [3000, 4500, 6000]],   // 1단계 0x28F9C·0x28FDD·0x2900D·0x2910E
    [null, null, null],                                             // 2단계 속성 부여 (0x29273)
    [2000, 1000, 2000],                                             // 3단계 0x29646 · 0x296C6
    [15000, 10000, 12000],                                          // 4단계 표 0x28352 word ×3
    [null, null, null],                                             // 5단계 소환 (0x29F4D)
    [25000, 20000, [24000, 26000, 28000]],                          // 6단계 0x2A2BA · 0x2A303 · 0x2A342
    [basePow, basePow, basePow]                                     // 7단계 표 0x283FE
  ];
  var power = opts.power != null ? opts.power : (basePow[clamp(p.rank, 0, 2)] | 0);
  if (opts.power == null && p.series <= 2) {
    var 칸 = (원소위력[p.level] || [])[p.series];
    if (Array.isArray(칸)) power = 칸[clamp(p.rank, 0, 2)] | 0;
    else if (typeof 칸 === 'number') power = 칸 | 0;
    /* `null` 이면 그 단계는 피해를 안 준다 — 아래 `row === 1`(속성 부여)과
     *  `magicTargeting` 의 `select:'summon'`(5단계)이 각각 먼저 걸러 낸다.
     *  여기까지 오는 일은 없지만, 와도 옛 값을 그대로 두어 안전하게 넘긴다. */
  }
  var div = opts.div != null ? opts.div : [20, 20, 30, 30, 50, 50, 70][p.level];   // §3.2 지력 하한 — 일곱 단계 실측과 일치
  /* ★★★ **원소 3단계 위력은 원본 호출부에 리터럴로 있다** (2026-08-16)
   *
   *   위 `basePow` 는 「레벨 4 이상/미만」 두 갈래뿐이라 **1단계와 3단계가 같은 값**을
   *   썼다 — 사용자: 「3단계 마법 데미지 이상해. **지금 너무 세게 들어가**.」
   *
   *   `0x28728(edx = power, ebx = div)` 호출부를 떠서 확정한 값이다:
   *   ```asm
   *   0x29639  call 0x20620 (화염3 1클) → 0x29641 ebx=0x1E(30) · 0x29646 edx=0x7D0(2000)
   *   0x29668  call 0x2095A (화염3 2클) → 0x29671 ebx=0x1E(30) · 0x29676 edx=0x7D0(2000)
   *   0x296B9  call 0x22AF9 (빙한3)     → 0x296C1 ebx=0x1E(30) · 0x296C6 edx=0x3E8(1000)
   *   ```
   *   곧 **클래스는 위력을 안 바꾸고**(연출 파일만 바뀐다) **계열이 바꾼다.**
   *   화염 `2000`(INT30→20.00 · INT60→40.00) · 빙한 `1000`(10.00 → 20.00).
   *
   *   ★ **전격 3단계 = 화염과 같다** (사용자 확인 2026-08-16: 「전격이랑 화염
   *     데미지 같은 것 같아」 · 「원본기준」) → `2000`.
   *     이걸로 `마법_데미지공식.md` §레벨별 표의 3레벨 `20→40 / 20→40 / 10→20`
   *     은 **얼음·전격이 뒤바뀐 것**으로 확정된다 — 실제는
   *     **불 20→40 · 얼음 10→20 · 전격 20→40** 이다. */
  var 원소3위력 = { 0: 2000, 1: 1000, 2: 2000 };       // 화염 · 빙한 · 전격
  if (opts.power == null && p.level === 2 && 원소3위력[p.series] != null) {
    power = 원소3위력[p.series];
    div = (opts.div != null) ? div : 30;              // 0x29641 · 0x296C1 — ebx = 0x1E
  }

  /* ★ 효과 대상 수집 — 스펠 타게팅(마법_타게팅_사양.md)에 따라 단일/광역/전체.
   *   opts.targets(선택기가 준 것)가 있으면 그걸 기준으로, 광역이면 그 지점 주변으로 확장. */
  var tgtSpec = magicTargeting(p.series, p.level, p.rank);
  var targets = gatherMagicTargets(battle, u, p, tgtSpec, target, opts);
  /* ★ 마법검 전용 루틴처럼 «이번 공격의 대상 목록»만 도는 경우 — 0x19224 턴언데드 마법검은 [0xF0648] 만 돈다 (마법검쏘기 참조) */
  if (opts.대상고정) targets = opts.대상고정.slice();
  targets = targets.filter(function (t) { return t && t.alive; });
  /* Heal Wind(mode 3)는 0x2AC03~0x2AC5F에서 진영 live list를 훑되
   * race 2(언데드)는 0x2AC27/0x2AC52 비교로 대상 목록에서 제외한다. */
  if (p.series === 3 && p.level === 4)
    targets = targets.filter(function (t) { return (t.race | 0) !== 2; });
  /* Cure 대상 루프는 sprite ID 300 이상을 효과 적용 전에 건너뛴다. 0x2B2C9. */
  if (p.series === 3 && p.level === 2)
    targets = targets.filter(function (t) { return !spriteProfile(t).magicEffectExcluded; });
  /* Power UP 공통 실행부는 대상 루프 첫머리에서 sprite ID 300 이상을 건너뛴다.
   * 0x2B45D cmp [ecx+0x61],0x12C / jge 0x2B53E. */
  /* ★ 2026-09-26 — 같은 루프를 **여섯이** 쓴다: 파워업(0x2BE5B ebx 8 → call 0x2B391) 뒤로
   *   스피드업 0x10 · 매직아머 0x20 · 블레스 0x40 · 사일런스 0x800 · 커스 0x2000 이 모두 `jmp 0x2BE60`.
   *   (배리어는 0x2A3EB 따로다.) ☠ 여태 파워업만 여기서 뺐다 — 나머지는 대형에게도 연출이 돌았다.
   *   ★ 매직아머는 대상이 이미 블레스(`[+0x15] & 0x40`)면 연출(0x26584)·비트·지속을 통째로 건너뛴다
   *     (0x2B4E2 test [ecx+0x15],0x40 / jne 0x2B53E). */
  if (p.series === 4 && p.level !== 5)
    targets = targets.filter(function (t) { return !spriteProfile(t).magicEffectExcluded; });
  if (p.series === 4 && p.level === 2)
    targets = targets.filter(function (t) { return !((t.f15 | 0) & 0x40); });     // 0x2B4E2
  /* ★ 선라이트(회복 7)는 **대상 셋을 따로 모은다** — `선라이트대상()` (0x2A75A 형태 4) */
  var 선라이트모드 = null;
  if (p.series === 3 && p.level === 6) {
    var 선 = 선라이트대상(battle, u, p.rank);
    targets = 선.targets; 선라이트모드 = 선.모드;
  }
  /* ★★★★★ 원소 7단계는 12×12 창 «밖»의 적에게도 피해·상태이상이 들어간다 (2026-09-25 사장님 「원소7단계, 회복7단계는 전체맵을 대상으로하는 전체 마법인데?」)
   *   ☠ 고침 81 은 0x2A75A 의 창 스캔(0x28728 숫자 피해)만 옮기고 뒤의 두 호출을 빠뜨렸다 —
   *   0x2AA68 cmp bx,3 / jge → 원소(0·1·2)만:
   *     0x2AA92 call 0x29437   창 안 목록 상태이상(기본 30 · 결빙 −20 · 지속 표[i+1]/표[i])
   *     0x2AAA2 call 0x2A5BE   진영 1~4 적대 · 목록 밖 · 배리어·sprite≥300 뺌 → 0x28947(30, 결빙 보정 없음) · 지속 0x7448C/0x7448A = 표[i+2]/표[i+1]
   *     0x2ACAD call 0x2A500   진영 1~4 적대 · 목록 밖 · 배리어·탈것≥7 뺌 → 0x285E4 같은 식 · 숫자 없이 [+0x48] 에서 뺀다(0x2A5A0)
   *   ⇒ 목록 밖은 'outside' 로 붙인다 — 상태이상 굴림을 모두 한 뒤 피해를 준다(원본 차례 · 피해식엔 난수가 없다). */
  if (p.series <= 2 && p.level === 6) {
    var 칠모드 = targets.map(function () { return 'damage'; });
    var 칠목록 = targets.slice();
    for (var 진 = 1; 진 <= 4; 진++) {                                      // 0x2A5D1 · 0x2A6B0
      if (!hostile(u.side, 진, battle.confuse)) continue;                   // 0x2A5E4 call 0x1201D
      (battle.units || []).forEach(function (t) {
        if (!t || !t.alive || (t.side | 0) !== 진 || 칠목록.indexOf(t) >= 0) return;   // 0x2A618 목록에 없음
        if ((t.f15 | 0) & 0x80) return;                                     // 0x2A621 · 0x2A568 배리어
        칠목록.push(t); 칠모드.push('outside');
      });
    }
    targets = 칠목록; 선라이트모드 = 칠모드;
  }

  /* ★★★★★ **되살릴 사람이 없으면 시전하지 않는다** (2026-09-08 · 사장님 지적 M18)
   *   > 「**죽은 캐릭터 없으면 시전 안되고** 메인 링커맨드로 복귀」
   *   원본은 수집한 뒤 개수를 보고 0 이면 건너뛴다 —
   *   ```asm
   *   0x2B23B  call 0x42743              ; 대상 수집
   *   0x2B26A  cmp word [0xF0B9E], 0     ; ★ 등록 수가 0 이면
   *   0x2B272  je 0x2B215                ;   시전을 건너뛴다
   *   ```
   *   `[0x80B9E]` 가 등록 인원 수인 근거는 `battle_main.js:3929`(`0x16D59 dx = [0x80B9E]`).
   *   ☠ `targets` 는 **살아 있는 유닛**만 남기므로 되살리기 갈래는 여기서 늘 비어 있다.
   *     그래서 **죽은 아군이 있는지**를 따로 본다. */
  if (tgtSpec && (tgtSpec.select === 'reviveList' || tgtSpec.relation === 'dead')) {
    var _죽은 = (battle.units || []).filter(function (q) {
      /* Soul Recall(암흑4)은 전역 사망자 명부를 그대로 쓴다.
       * 0x2B5D6 이 0을 넘겨 0x137E7의 적대 검사를 건너뛴다. Revible만 같은 편 검사. */
      /* ★ 2026-09-24 — 리바이블은 «같은 진영»이 아니라 **적대가 아닌** 사망자다
       *   (`0x137E7` → `0x13811 call 0x1201D` · je → 그것). 진영 1 에게 진영 2(동맹)도 대상이다. */
      return q && !q.alive && !q.명부밖 && ((p.series === 6 && p.level === 3) ||   // 명부밖 — 사망자 명부에 없는 죽음(0x1DD7D·0x1DD83·0x1DCF7)
                               !hostile(u.side, q.side, battle.confuse));
    });
    if (!_죽은.length) return { ok: false, reason: '되살릴 사람이 없다' };   // 0x2B272 je
  }

  /* ★ God(0x4426D) 전체 공격 — 연출만 이 마법 것을 빌린다. 대상은 편 1·2 목록 전원(0x447EC [0xCC968 + i×8] · i 0·1),
   *   피해는 대상마다 0x1D770(신, 대상, 치명, 지원 1)를 판정 없이 (0x4480F) (2026-09-29) */
  if (opts.신광역) targets = battle.units.filter(function (t) { return t && t.alive && ((t.side | 0) === 1 || (t.side | 0) === 2); });
  var rep = { ok: true, kind: 'magic', spell: spellNo, series: p.series, level: p.level,
              rank: p.rank, attr: attr, power: power, div: div, mpCost: mpCost,
              /* ★ `exp` — 마법으로 죽여도 경험치를 준다(`0x1745B` → `0x1DB1D` →
               *   `0x1DBCD` → `0x17A20`). 이 배열이 없어서 `controller.js` 의
               *   `res.report.exp` 가 늘 비었고 **경험치가 안 들어왔다.** */
              need: need, results: [], deaths: [], exp: [] };
  if (opts.신광역) rep.신광역 = opts.신광역;

  var cv = view(battle, u);
  var eRow = p.level, eRank = clamp(p.rank, 0, 2);
  /* ★★★★★ **지속표 `0x74488` 은 마법마다 「읽는 자리」가 다르다** (2026-09-09)
   *   실측 — `node 04_도구/EXE_표읽기.js 0x74488 8 --워드`
   *     `0x74488 → 30  40  50  60  70  0  1000  0`
   *
   *   | 무엇 | 표를 읽는 줄 | 색인 | 값 |
   *   |---|---|---|---|
   *   | 속성부여(2단계) | `0x29170 add dl,2` → `0x291A2 [edx*2 + 0x74488]` | 클래스+2 | 50·60·70 |
   *   | 침묵·스틸엠피 | `0x2B581 [edi*2 + **0x7448A**]` | 클래스+1 | **40·50·60** |
   *   | 배리어 | `0x2A408 [edx*2 + **0x7448A**]` | 클래스+1 | **40·50·60** |
   *   | ★ **커스** | `0x2B5B2 [eax*2 + **0x74488**]` | **클래스** | **30·40·50** |
   *
   *   두 블록이 같은 `[esp+0xA]`(= `[esp+0xC]` = `dx` = 클래스)를 쓰는데
   *   **표 주소만 2 다르다.** 곧 커스가 **한 칸 짧다.**
   *   ☠ 전에는 하나(`40·50·60`)로 다 넘겨 **커스가 1분 길었다.**
   *   근거: `03_분석/_보관/끝난조사/00_지금조사_기타.md` */
  var buffDur = [40, 50, 60][eRank];                 // 0x7448A — 침묵·배리어·버프 (4/5/6분)
  var curseDur = [30, 40, 50][eRank];                // ★ 0x74488 — 커스만 (3/4/5분)
  rep.effect = magicEffectKind(p.series, eRow);

  /* ── 생성/부활계 (대상이 살아있는 유닛이 아님) ──────────────────────── */
  /* ★★ **원소계열 Lv5(=`eRow` 4)도 소환이다** — 화염5 Salamanda · 빙한5 Marid ·
   *   전격5 Jinn. 셋 다 소환 공통 루틴 `0x29F4D` 를 타고 `ebx` 만 다르다
   *   (`연출_나머지계열.md` 「소환 계열」 · `연출_화염계열.md` 「화염 5단계」).
   *   여기 분기가 **아예 없어서** 원소 5단계가 안 나갔다 — 할일 10 「5단계 소환 미적용」.
   *   사용자 확인(2026-08-15): 「화염 5단계는 몬스터 소환이야. … **샐러맨더를 소환해**」 */
  var ELEM_SUMMON = [90, 89, 88];              // 화염 Salamanda · 빙한 Marid · 전격 Jinn
  var isElemSummon = (p.series <= 2 && eRow === 4);
  if (p.series === 5 || isElemSummon || (p.series === 6 && eRow === 3)) {
    /* 소환(계열5)·소울리콜(암흑 row3) — 빈 칸에 유닛 생성. 원본 0x29f4d/0x2c36a.
     *   직업: Bat76·Slime72·Goblin63·Orc65·Ogre67·Golem83·Gargoyle82(계열5), 소울리콜=언데드×최대3. */
    var job = isElemSummon ? ELEM_SUMMON[p.series]
            : (p.series === 5) ? [76, 72, 63, 65, 67, 83, 82][eRow] : 76;
    /* ★ 마리수 = **rank + 1 (1·2·3)** — `0x29C5A` 의 자리 배열이 3칸뿐이고 루프가
     *   `ebx = rank + 1` 번 돈다(`summonTiles` 주석의 전문). 사용자 확인과 일치:
     *   「클래스에 따라 **1~3마리** 소환이 가능해」. 예전 `eRank + 2`(2·3·4)는
     *   `미확정_규명 §1` 의 잘못된 해석을 그대로 옮긴 것이었다. */
    var count = (p.series === 6 && eRow === 3) ? (eRank + 1) : (eRank + 1);
    /* ★ 소환도 **칸**이 기준이다 — 빈 칸을 골랐으면 `targetUnits` 가 비어 있다.
     *   `opts.at`(= `intent.targetTiles[0]`)을 먼저 본다. */
    /* ★★★★★ **소울리콜은 새 몬스터를 만들지 않는다 — 죽은 아군을 일으킨다**
     *   (2026-09-08 · 사장님 지적 M32)
     *   > 「**죽은 캐릭터가 초록색 모습으로** 소환되어야하는데, **스프라이트 없는 bat** 가
     *   >  소환이돼 … **능력치는 본래 캐릭터의 능력치를 이어받아야해**」
     *
     *   원본 `0x2C449 call 0x2B5C4` 안 —
     *   ```asm
     *   0x2B5F9  mov byte [ebx+0x0D], 2     ; ★ race = 2 (언데드)
     *   0x2B5FD  mov byte [ebx],   al       ;   x
     *   0x2B603  mov byte [ebx+1], al       ;   y
     *   0x2B609  mov byte [ebx+0x0E], al    ;   소속
     *   0x2B60F  mov byte [ebx+0x64], 3     ;   모션
     *   0x2B619  mov byte [ebx+0x14], 0     ;   비행 끔
     *   0x2B61D  mov byte [ebx+0x0F], 0xFF  ;   charCode = 255
     *   0x2B63A  mov byte [ebx+0x82], 0xFF  ;   AI 필살기 없음
     *   ```
     *   ⇒ **`[+0x61]`(그림 번호)를 한 번도 안 건드린다.** 원래 모습 그대로 일어나고
     *     능력치 칸도 안 건드리므로 **그대로 이어받는다.**
     *   ☠ 자리는 소환 창구를 그대로 쓴다(`0x2C39B call 0x29C5A`). */
    /* ★★★★★ 세울 빈 자리가 하나도 없으면 발동하지 않는다 (2026-09-26 사장님 「잘못적용되었어. 지금은 아군이 재소환돼. 원본은 소환 자체 발동이 안돼」)
     *   후보는 이동 범위로 고르므로 아군이 선 칸도 표시되지만(summonTiles 주석), 빈 칸이 없으면 원본은 발동하지 않는다.
     *   ☠ 예전(방금 고침): 빈 칸이 없어도 시전이 돌아 연출이 후보 칸의 아군에게 솟아오르기를 걸었다.
     *   rep.ok = false 면 비용도 없다(아래 0x434CE 앞 — 리바이블 «부활할 자리 없음»과 같은 길) */
    if (!(p.series === 6 && eRow === 3)) {
      var _소번 = SUMMON_IDX[job];
      if (_소번 == null) _소번 = Math.max(0, [76, 72, 63, 65, 67, 83, 82].indexOf(job));
      if (!summonTiles(battle, u, opts.at || target, count, (_소번 >= 4 && _소번 <= 6), { 빈칸만: true, 비울유닛: collectReplacedSummons(battle, u) }).length) {
        rep.ok = false; rep.reason = '소환할 자리가 없습니다'; rep.소환불가 = true;
        return rep;
      }
    }
    var made;
    var replacedSummons = collectReplacedSummons(battle, u);
    rep.replacedSummons = replacedSummons.slice();
    /* 자산은 교체 commit 전에 준비한다. Soul Recall은 선택/난수 순서를 바꾸지 않고
     * 현재 사망 후보가 가진 그림 번호만 준비 보고에 싣는다. */
    if (p.series === 6 && eRow === 3) {
      rep.requiredSpriteIndices = uniqueSpriteIndices((battle.units || []).filter(function (q) {
        return q && !q.alive;
      }));
    } else {
      rep.requiredSpriteIndices = uniqueSpriteIndices([{ sprIndex: summonSpriteIndex(job, u.sprIndex) }]);
    }
    var generationCommitted = false;
    function commitGeneration() {
      if (generationCommitted) return rep;
      generationCommitted = true;
      rep.committed = true;
      removeReplacedSummons(battle, u, replacedSummons);
      if (p.series === 6 && eRow === 3) {
      var _칸들 = summonTiles(battle, u, opts.at || target, count, false, { 옛규칙: true });
      /* ★★★★★ **소울리콜은 «무작위»로 고른다** (2026-09-19 · PACKET 15 §3)
       *
       *   ```asm
       *   0x2B5D6  xor eax, eax          ; ★ 인자 0 으로
       *   0x2B5D8  call 0x137E7          ;   Revible 과 «같은 함수»인데 갈래가 다르다
       *   ── 0x137E7 안 ──
       *   0x13802  test dl,dl ; je 0x1381B   ; 인자가 0 이면 적대 검사를 «건너뛰고» 세기만
       *   0x13825  cmp [esp],0 ; je 0x1382F  ; ★ 인자 0 → 난수 갈래
       *   0x13832  mov ebx,[0xD6620]         ;   명부 머리
       *   0x13838  call 0x499BD(사망자 수)    ; ★★ 무작위로 하나
       *   0x13841  dec ecx ; mov ebx,[ebx+0x7b] ; 그만큼 걸어간다
       *   ```
       *   ☠ **Revible 과 다르다.** 리바이블은 같은 함수에 «시전자 진영»을 넘겨
       *     «머리부터 첫 비적대»(= 가장 먼저 죽은 이)를 얻는다.
       *     소울리콜은 **0** 을 넘겨 **적대 검사 없이 무작위**로 고른다.
       *   ⇒ `죽은차례` helper 를 여기에 **공용화하지 않는다** — 뜻이 다르다.
       *
       *   ☠ 제품은 `battle.units` 배열 차례로 앞에서부터 골랐다 — 씨앗을 바꿔
       *     30판을 돌려도 늘 같은 셋이 나왔다.
       *   ★ 자리 수는 원본도 «클래스 + 1» 이다 (`0x2C393 inc edx ; call 0x29C5A`)
       *     — 제품 `count = eRank + 1` 이 이미 맞다. */
      /* ☠☠★★★★★ **후보는 «모든 진영»이다 — 적 시체도 일어난다**
       *   (2026-09-19 · PACKET 16 §1 · ChatGPT 독립 검수가 잡았다)
       *
       *   `0xD6620` 에 **넣는** 자리를 EXE 에서 전수로 찾았다 — 둘뿐이고
       *   **둘 다 진영 거르개가 없다** —
       *     `0x1DDA1 mov eax,0xD6620 ; call 0x1134F`   (사망 처리 0x1DB1D)
       *     `0x3C2D3 mov eax,0xD6620 ; call 0x1134F`
       *   곧 `0xD6620` 은 **전역** 사망자 명부다.
       *
       *   그리고 소울리콜은 `0x2B5D6 xor eax,eax` 로 `0x137E7` 을 불러
       *   `0x13802 test dl,dl ; je` 로 **적대 검사(`0x1201D`)를 건너뛴다.**
       *   ⇒ **적 시체도 후보**이고, 되살아나면 `0x2B609` 가 **시전자 진영**을 준다.
       *
       *   ☠ 제품은 `(q.side|0) === (u.side|0)` 로 같은 편만 골랐다 —
       *     적 시체가 살아난 판 **0 / 36**.
       *   ★ Revible 은 **다르다** — 거기는 적대 검사를 한다(`0x13811 call 0x1201D`). */
      var _죽은목록 = (battle.units || []).filter(function (q) {
        return q && !q.alive && !q.명부밖;                 // 0xD6620 — 진영 거르개 없음 · 명부밖(언데드·그림≥300·탈것)은 명부에 없다
      });
      /* ★★ 명부 차례 = 죽은 차례 — 0x1134F 는 꼬리에 붙인다(0x1136A [꼬리+0x7B] = 새것 · 0x11370 꼬리 = 새것).
       *   시나리오 시작부터 죽어 있던 유닛은 죽은차례가 없어 맨 앞(0x137F0 머리부터 — 아래 revibleTarget 과 같은 규약) */
      _죽은목록 = _죽은목록.map(function (q, k) { return { q: q, k: k }; }).sort(function (a, b) {
        var ca = (a.q.죽은차례 == null) ? 0 : (a.q.죽은차례 | 0), cb = (b.q.죽은차례 == null) ? 0 : (b.q.죽은차례 | 0);
        return (ca - cb) || (a.k - b.k);
      }).map(function (e) { return e.q; });
      (function 명부에서뽑기() {                                 // 0x13838 call 0x499BD
        /* ★ 원본은 늘 0x499BD(= 우리 G2Rand) 다 — 호출자가 rng 를 안 넘기면 G2Rand 로 (2026-09-25 칸 137:
         *   우리 기록에 난수 0회 · 배열 차례대로 세워 원본과 자리가 달랐다 · 원본 기록 0x1383D rand(3)·rand(2)·rand(1)) */
        /* ☠ 2026-09-25 — 실제 게임은 opts.rng(Rules 난수 · 연출과 다른 흐름)가 늘 넘어와 G2Rand 를 안 탔다(칸 136 원본 rand 2번 · 우리 0번).
         *   원본은 연출·판정이 한 난수(0x499BD)이므로 G2Rand 를 먼저 쓴다 */
        var rng = (root.G2Rand && root.G2Rand.rng) || opts.rng;
        if (!rng || !_죽은목록.length) return;
        /* 0x13838 rand(남은 수) → 0x13841 머리부터 그만큼 걸어간 것을 꺼내고 → 0x2B5EB 0x1137A 명부에서 뺀다.
         *   남은 것의 차례는 그대로다(☠ 예전엔 자리 바꾸기(피셔-예이츠)라 남은 차례가 흐트러졌다) */
        var 남은 = _죽은목록.slice(), 뽑힌 = [], 몇 = Math.min(_칸들.length, 남은.length);
        for (var i = 0; i < 몇; i++) {
          var r = rng(남은.length) | 0;
          뽑힌.push(남은.splice(r, 1)[0]);
        }
        _죽은목록 = 뽑힌;
      })();
      made = [];
      for (var _si = 0; _si < _칸들.length && _si < _죽은목록.length; _si++) {
        var _d = _죽은목록[_si], _t = _칸들[_si];
        _d.x = _t.x | 0; _d.y = _t.y | 0;                  // 0x2B5FD · 0x2B603
        _d.alive = true; _d.dead = false;
        /* 사망 연출 한 번 표지(controller 4216)를 끈다 — 안 끄면 되살아난 뒤 다시 죽을 때 사망 연출이 걸러져 HP 0 인 채 남는다
         *   (2026-09-25 사장님 「소울리콜로 부활한 몬스터를 힐로 죽여지지 않아. 체력 0 상태에서 그대로 남아있어」 · 희생으로 켜진 표지가 남아 있었다) */
        _d._사망연출함 = false;
        /* 사망자 명부에서 빠졌다(0x2B5EB call 0x1137A).
         * 제품의 연결리스트 대용 표식도 비워야 재사망 때 새 꼬리 순서를 받는다. */
        _d.죽은차례 = null;
        _d.hp = _d.maxHp || _d.hp || 1;                     // 0x2B644 [+0x48] = [+0x4C]
        _d.race = 2;                                        // 0x2B5F9 [+0x0D] = 2
        /* ☠☠ **Reference 가 확정한 넷이 빠져 있었다** (PACKET 16 §1)
         *   같은 반환물 안에서 `soulrecall-combat.json` 과 이 코드가 서로 어긋났다. */
        _d.side = u.side | 0;                               // 0x2B609 [+0x0E] = 시전자 진영
        _d.dir = u.dir | 0;                                 // 0x2B613 [+0x63] = 시전자 방향
        _d.motion = 3;                                      // 0x2B60F [+0x64] = 3
        _d.mp = 0;                                          // 0x2B621 [+0x50] = 0
        _d.f14 = 0;                                         // 0x2B619 [+0x14] = 0 «통째로»
        /* 정본 176 — 원본은 시체가 상태이상을 안 갖는다(사망 0x1DD35·0x1DD3C 가 지움). 사망 경로를 다 고쳤지만 옛 세이브·SCE 시체를 위해 한 번 더 */
        사망상태지우기(_d); _d._사망전표시 = null;
        _d.charCode = 0xFF;                                 // 0x2B61D [+0x0F] = 0xFF
        _d.summonerTag = (u.charCode | 0) + 10;             // 0x2B638 [+0x12] = 시전자[+0x0F] + 10
        /* ★ 초록 몸 — 새 그림 슬롯(0x2B6A3 0x1198D)의 44장 픽셀을 치환표 2 로 한 번 바꾼다
         *   (0x2B6AB eax=2 → 0x2B6B2 0x6104A 표 고르기 · 0x2B6D1 0x100F2 픽셀 치환 × 0x2C).
         *   표 2 는 전투 준비 0x55C8C 0x610B6(표 2, 색 14) — 렌더러 _치환표2() 가 같은 식으로 굽는다.
         *   (2026-09-25 사장님 「소울리콜의 경우 되살아난 캐릭터가 초록색으로 보여야하는데」 · 원본 칸 137 메모리: 되살아난 셋만 초록) */
        _d.치환표 = 2;
        /* 0x2B65F cmp [시전자+0x0E],1 / jne → 0x2B665 [+0x83] = 2 — 아군이 부른 것만. 그 밖엔 쓰지 않는다(그대로 둔다) */
        if ((u.side | 0) === 1) _d.ai = 소환수직접조작() ? null : { flag: 2, on: true };
        /* ★ 맵 점유 배열에 놓는다 — 원작은 0x11E04 짝이 이 자리에 있다.
         *   ☠ 없으면 그 칸이 비어 있는 것으로 보여 다른 유닛이 겹쳐 선다 (실측 0/60). */
        if (battle.setAt) battle.setAt(_d.x, _d.y, _d);      // 0x11E04
        try { if (표시포트 && 표시포트.updateUnit) 표시포트.updateUnit(_d); } catch (e되) {}
        made.push(_d);
      }
      } else {
        made = summonUnits(battle, u, job, opts.at || target, count, opts.rng);
      }
      rep.summoned = made.map(function (m) { return m.name || ('#' + m.id); });
      rep.results = made.map(function (m) { return { unit: m, summon: true }; });
      /* [리마스터 보조경험치] 소울리콜로 일으킨 유닛 한 명당 (소환은 뺀다 — 부활·회복·버프·디버프만) */
      if (p.series === 6 && eRow === 3) made.forEach(function (m) { 보조경험(battle, u, m, rep); });
      return rep;
    }
    if (opts.defer) { rep.committed = false; rep.commit = commitGeneration; }
    else commitGeneration();
  }
  else if (p.series === 3 && eRow === 5) {
    /* Revible(부활) — 죽은 아군 rank별 30/60/100% 복원. 원본 0x2bc3b. */
    var dead = revibleTarget(battle, u, target, opts);
    /* ★★★★★ **되살아나는 칸은 «시전자 앞 칸»이다** (2026-09-19 · 사장님 지적)
     *
     *   > 「원본은 시전자 앞 칸인데, 우리 실행기는 시전자 칸에서 살아났었거든」
     *
     *   ```asm
     *   0x2BC6F  movsx ax, byte [esi]        ; x = 시전자 칸 x
     *   0x2BC78  movsx ax, byte [esi+0x1]    ; y = 시전자 칸 y
     *   0x2BC83  mov ebx,[esi+0x60] ; sar ebx,0x18   ; = [+0x63] **시전자 방향**
     *   0x2BC8D  call 0x49ABC(&x, &y, 방향)          ; ★ 그 방향으로 **한 칸**
     *   0x2BCA0  call 0x11DB2 ; test/jne → −1        ;   그 칸에 유닛이 있으면 실패
     *   0x2BCB7  call 0x13CBD ; cmp −1/jne → −1      ;   맵 밖이면 −128 이라 실패
     *   0x2BD21  [대상+0] = x · [대상+1] = y         ; ★★ **거기에 놓는다**
     *   0x2BD3D  call 0x11E04(x, y, 대상)            ;   맵 점유 배열에 놓는다
     *   ```
     *   ☠ 원본은 **죽은 자리를 한 번도 읽지 않는다** — 함수 전문(`0x2BC3B`~`0x2BDF4`)
     *     에서 대상의 `[+0]`·`[+1]` 은 **쓰기로만** 나온다.
     *     우리는 `opts.at || target` 을 그대로 써서 **죽은 칸**(실측 18/18)이나
     *     **시전자 칸**(선택이 시전자를 넘겨줄 때)에 일어섰다.
     *   ★ 클래스 갈래(`0x2BD42`)는 좌표 쓰기 **뒤**에 온다 ⇒ 1·2·3 위치 규칙이 같다.
     *   ★ `DIR` 은 `0x49ABC` 의 점프표(`0x49AAC`)와 같은 표다 — combat.js:61. */
    var 앞d = DIR[(u.dir | 0) & 3];                                  // 0x49ABC
    var 앞x = (u.x | 0) + 앞d.dx, 앞y = (u.y | 0) + 앞d.dy;           // 0x2BC8D
    if (dead && (!inMap(battle, 앞x, 앞y) || battle.at(앞x, 앞y))) {
      /* 0x2BCA7 · 0x2BCC0 — 앞 칸을 못 쓰면 −1. **아무 상태도 안 바꾼다.** */
      rep.ok = false; rep.reason = '부활할 자리가 없습니다';
    }
    else if (dead) {
      /* ★★★★★ **원본 직독으로 확인했다** (2026-09-09) — 클래스는 **0·1·2** 다
       *   ```asm
       *   0x2BD42  cmp di, 1 ; jb  0x2BD55   ; ★ di == 0 → 0x2BD5A
       *   0x2BD48            ; jbe 0x2BD91   ; ★ di == 1
       *   0x2BD4A  cmp di, 2 ; je  0x2BDC1   ; ★ di == 2
       *
       *   0x2BD5A  esi = [ecx+0x4C]<<4 − eax ; esi += esi   ; ×15×2 = **×30**
       *   0x2BD72  idiv 100                                  ; ⇒ **30 %**
       *   0x2BD96  esi = …<<4 − eax ; esi <<= 2              ; ×15×4 = **×60**
       *   0x2BDAA  idiv 100                                  ; ⇒ **60 %**
       *   0x2BDC1  eax = [ecx+0x4C] ; [ecx+0x48] = eax       ; ⇒ **100 %** (그대로)
       *   ```
       *   ⇒ **`[30, 60, 100][클래스]` 가 맞다.** R163 의 또 하나의 증거다. */
      var pct = [30, 60, 100][eRank];
      /* ★★★★★ **되살림은 연출 «뒤»다** (2026-09-24 · `0x2BC3B` 전문 — PACKET14 §3 「연출이 먼저, 좌표 쓰기가 뒤」)
       *   ```asm
       *   0x2BD1C  call 0x59A70            ; 연출 — 이 동안 대상은 아직 옛 자리·사망
       *   0x2BD21  대상[+0]·[+1] = 앞 칸   ; 0x2BD3D call 0x11E04 점유 · 0x2BD42 HP/MP · 0x2BDCF 산 명부
       *   ```
       *   ☠ 여기서 곧바로 되살려, 연출이 도는 내내 되살아날 유닛이 **앞 칸에 먼저 서 있었다**
       *     (후속감사30 잔여 「부활 모델 선적용·점유·몸체 선노출」).
       *   ⇒ `defer` 면 `rep.commit()`(= 연출 뒤)에 되살린다. 연출이 그릴 대상은 미리 알린다. */
      var 되살리기 = function () {
        if (rep.committed) return rep;
        rep.committed = true;
        reviveUnit(battle, dead, pct, { x: 앞x, y: 앞y });          // 0x2BD21 · 0x2BD3D · 0x2BD42 · 0x2BDCF
        rep.results.push({ unit: dead, revive: pct, heal: dead.hp });
        if (dead.alive) 보조경험(battle, u, dead, rep);             // [리마스터 보조경험치] 부활
        return rep;
      };
      rep.revived = dead.name || ('#' + dead.id);
      rep.targets = [dead];                                          // 0x2BD14 — 연출에 넘기는 그림
      if (opts.defer) { rep.committed = false; rep.commit = 되살리기; }
      else 되살리기();
    } else { rep.ok = true; rep.reason = '부활 대상 없음'; }
  }
  else {
    /* ── 대상 유닛에 효과 적용 (계열·행별 디스패치) ──────────────────── */
    /**
     * ★★ **원본은 피해를 연출 *뒤*에 넣는다.** `0x28ED6`(Lv1 핸들러) 실측 —
     *
     * ```asm
     * 0x28F62  edx=0x32 ; eax=0x767B ; call 0x4F460   ; ② 소리 로드
     * 0x28F92  call 0x2016A                           ; ③ 연출
     * 0x28F97  ebx = 0x14 (20)                        ; ④ 피해 인자
     * 0x28F9C  edx = 0xBB8 (3000)                     ;    데미지 ×100
     * 0x28FA1  jmp 0x29012                            ;    → 0x28728 피해 적용
     * ```
     * 초필살기(`0x3B593`)와 같은 자리다.
     *
     * 안 미루면 시전과 동시에 `alive = false` 가 되어 **적이 연출 도중에 사라진다** —
     * 사용자가 「데미지 판정 순서」가 어긋난다고 한 것이 이것이다.
     * `opts.defer` 를 켜면 `rep.commit()` 으로 미룬다(두 번 불러도 한 번만 먹는다).
     */
    /* ★ DNA 체인저 — 대상이 못 받으면(그림 300 이상 · 이미 커스 · 이미 DNA) 원본은 소리 적재·연출(0x275A4)까지 건너뛴다
     *   (0x2C4E7 jge · 0x2C4F2 test 0x20 · 0x2C4F7 test 0x40 → 0x2C55F). 이름 외치기(0x2C4BF 0x28889)는 그 앞이라 난다.
     *   연출은 피해보다 먼저 돌므로 시전 때 알린다 — battle_main playMagicFx 가 본다 (2026-09-26 Z-50) */
    if (p.series === 6 && p.level === 4 && targets.length && targets.every(dna못받나)) rep.연출생략 = true;
    /* ★ 대상 하나씩 적용할 수 있게 나눈다 — 버프·디버프는 한 명의 연출이 끝나면 곧바로 그 한 명에게 건다 (2026-09-26 · Z-85)
     *   사장님 「버프 디버프 마법의 효과가 실제 적용되는건 … 한명한명 이펙트가 끝나면 바로 적용이 되어야해」
     *   원본 0x2B391 은 대상마다 연출 → 비트 쓰기 → 다음 대상 차례다. rep.commit한명(D) 가 그 한 명만, rep.commit 은 남은 대상만 */
    var 끝난 = [];
    var 하나적용 = function (i) {
      if (끝난[i]) return;
      끝난[i] = true;
      if (opts.신광역) {                                                /* 0x4480F 0x1D770 · 0x448A0 [+0x48] −= 피해 */
        var G = targets[i];
        var gh = strike(battle, u, G, opts.신광역.치명 | 0, { 판정없음: true, support: true, rng: opts.rng, reason: 'god' });
        rep.results.push(gh);
        if (gh.died) { rep.deaths.push(G); if (gh.kill && gh.kill.exp) rep.exp.push(gh.kill.exp); }   /* 0x448E4 0x1DB1D */
        return;
      }
      {
        var D = targets[i], dv = view(battle, D);
        var 전상태 = 보조상태(D);                                     // [리마스터 보조경험치]
        var ctx = { tables: T, timeOfDay: battle.timeOfDay | 0, rng: opts.rng,
                    deriveC: eff(battle, u), deriveD: eff(battle, D) };
        var res = applyMagicToUnit(battle, u, D, cv, dv, p, ctx, opts, Ru,
                                   { power: power, div: div, attr: attr, dur: buffDur,
                                     curseDur: curseDur,      /* ★ 커스만 0x74488 (2026-09-09) */
                                     /* 선라이트 — 대상마다 피해/조용한 피해/회복 · 회복은 표[클래스−1] (0x2AC64) */
                                     sunMode: 선라이트모드 ? 선라이트모드[i] : null,
                                     sunHeal: basePow[clamp(p.rank - 1, 0, 2)] | 0 });
        rep.results.push(res);
        /* [리마스터 보조경험치] 피해가 아닌 효과가 실제로 먹혔으면 (피해 몫은 applyDamage 의 부분경험치가 맡는다) */
        if (res.damage == null && !res.died && 보조상태(D) !== 전상태) res.보조경험 = 보조경험(battle, u, D, rep);
        /* ★★★ **경험치** — 마법으로 죽여도 준다 (원본 `0x17451` → `0x1745B`).
         *
         * 사용자 지적 2026-08-16: 「지금 **경험치 획득이 안돼.** 공격마법 전수
         * 조사해서 경험치 획득 관련 확인하고 없으면 넣어.」
         * → 우리 `cast()` 만 `rep.exp.push` 가 **빠져 있었다.**
         *   평타(`0x1257`)·필살기(`0x1660`·`0x1675`)에는 있었다.
         *
         * ```asm
         * 0x17451  cmp [유닛+0x48], 0     ; ★ 피해를 넣은 뒤 HP 가 0 이하면
         * 0x17455  jg  0x17477
         * 0x1745B  call 0x1DB1D           ; ★★ 사망 처리 — 그 안 0x1DBCD 가
         *                                 ;    0x17A20(경험치·레벨업)을 부른다
         * ```
         * `0x17310`(피해 적용 공통)이 **HP 를 깎고 바로 사망을 처리**하므로
         * **모든 피해 마법이 경험치를 준다.**
         *
         * ★ 즉사 마법도 마찬가지다 — 데스(`0x2C359`) · 블랙홀(`0x2C618`) ·
         *   턴언데드(`0x2A3B9`) **셋 다 `0x1DB1D` 를 직접 부른다.**
         *   「데스·블랙홀은 경험치를 못 먹는다」는 기억은 **원본과 다르다**
         *   (`경험치_레벨업.md` §마법). 예외 없이 전부 준다. */
        if (res.died) {
          rep.deaths.push(D);
          if (res.kill && res.kill.exp) rep.exp.push(res.kill.exp);      // 0x1745B → 0x1DBCD
        }
      }
    };
    var 적용 = function () {
      if (rep.committed) return rep;
      rep.committed = true;
      for (var i = 0; i < targets.length; i++) 하나적용(i);
      return rep;
    };
    /** 대상 한 명만 곧바로 — 새로 생긴 결과만 돌려준다 (이미 했거나 대상이 아니면 빈 배열) */
    rep.commit한명 = function (D) {
      if (rep.committed) return [];
      var i = targets.indexOf(D);
      if (i < 0 || 끝난[i]) return [];
      var n0 = rep.results.length;
      하나적용(i);
      return rep.results.slice(n0);
    };
    rep.targets = targets.slice();          // 연출이 대상을 미리 알아야 한다
    if (opts.defer) { rep.committed = false; rep.commit = 적용; }
    else 적용();
  }

  /* ★ 2026-09-24 — 마법 함수가 −1 로 끝났으면(리바이블 「앞 칸을 못 쓴다」 `0x2BCA7`·`0x2BCC0`)
   *   비용도 없다. `0x434CE` 는 1 을 돌려준 뒤에만 닿는다(executor 「실패·취소는 비용 0」). */
  if (rep.ok === false) return rep;
  if (!함수표직접) u.mp = Math.max(0, (u.mp | 0) - mpCost);                // 0x434CE
  if (!opts.free) {
    var pay = need - (u.chargeTp | 0);
    u.tp = Math.max(0, (u.tp | 0) - Math.max(0, pay));
    rep.tpCost = Math.max(0, pay);
  }
  /* ☠☠★★★★★ **집중 게이지 지우기는 «연출 뒤»다** (2026-09-15 · 사장님 지정)
   *
   *   > 사장님: 「마법에서 **집중을 먼저 지우는것 부터 제대로 뒤로 옮겨**」
   *
   *   ☠ 여기서 곧바로 `u.chargeTp = 0` 을 하고 있었다. 그러면 시전이 시작되는
   *     순간 **머리 위 집중 불꽃이 꺼진다** (`battle_main.js chargeMarks()` 가
   *     `word[+0x57]` 을 본다). 실측 —
   *       원본  49 49 49 49 49 49 101 133 133 149 367 130 …   ← 끝까지 유지
   *       우리  63 63 49 62 62 **0** 237 28 28 28 …           ← 5장에서 꺼졌다
   *   ★ **필살기는 이미 뒤로 옮겨 놓았다** (이 파일 3072행 「원본은 연출이 끝난 뒤
   *     낸다」 · `0x4CA98`). **마법만 안 옮겨져 있었다.**
   *   ⇒ `defer` 면 `rep.commit()`(= 연출 뒤)에서 지우고, 아니면 예전처럼 지금 지운다.
   *   ★ TP 계산(`pay = need − chargeTp`)은 **지금 그대로** 한다 — 원본도 값은 먼저
   *     쓰고 게이지만 나중에 0 으로 민다. */
  var 집중지우기 = function () { u.chargeTp = 0; u.reserveSpell = 0; };   // 0x45B56 · 0x4CA98
  if (opts.defer && typeof rep.commit === 'function') {
    var _앞commit = rep.commit;
    rep.commit = function () { var r = _앞commit.apply(this, arguments); 집중지우기(); return r; };
  } else {
    집중지우기();
  }
  rep.morale = { ally: battle.morale.ally, enemy: battle.morale.enemy };
  return rep;
}

/* ════════════════════════════ 마법 효과 디스패치 (마법효과_시스템.md) ═══════
 * 계열(series)·행(row)·클래스(rank)별 효과. EXE 오프셋을 실행기 유닛필드에 매핑:
 *   HP=u.hp[+0x48] · MP=u.mp[+0x50] · MR=u.eff.mr[+0x59] · 언데드=u.race===2[+0x0d]
 *   1차상태(버프)→u.buff/u.mbuff[+0x15] · 2차상태(상태이상)→u.ailment[+0x1e] */

/** 마법 효과 종류명(리포트·이펙트 선택용). */
function magicEffectKind(series, row) {
  /* ★ 원소 **2단계(row 1)만 피해가 아니다** — 무기 속성 부여(`0x2914A`).
   *   `연출_원소2단계_원본확정.md` §3. HUD·연출이 `rep.effect` 로 갈리므로 여기도 나눈다. */
  if (series <= 2) return (row === 1) ? 'enchant' : 'damage';
  if (series === 3) return ['heal', 'wideHeal', 'cure', 'turnUndead', 'healWind', 'revible', 'sunLight'][row] || 'heal';
  if (series === 4) return ['powerUp', 'speedUp', 'magicArmor', 'bless', 'silence', 'barrier', 'curse'][row] || 'buff';
  if (series === 5) return 'summon';
  if (series === 6) return ['confuse', 'meltItem', 'death', 'soulRecall', 'dnaChange', 'blackHole', 'armageddon'][row] || 'dark';
  return 'magic';
}

/** 버프 수치 적용 — 중복 불가(원본 §3.3: 플래그·지속만 갱신). u.mbuff 로 추적, eff 즉시 반영. */
function applyBuff(D, key, delta, dur) {
  D.mbuff = D.mbuff || {};
  if (D.mbuff[key]) { D.mbuff[key].dur = Math.max(D.mbuff[key].dur | 0, dur | 0); return false; }  // 중첩X, 지속만
  D.mbuff[key] = { delta: delta | 0, dur: dur | 0 };
  D.buff = D.buff || {}; D.buff[key] = (D.buff[key] | 0) + (delta | 0);
  if (D.eff) D.eff[key] = (D.eff[key] | 0) + (delta | 0);
  return true;
}

/** 대상 유닛에 마법 효과 적용. S={power,div,attr,dur}. */
function applyMagicToUnit(battle, u, D, cv, dv, p, ctx, opts, Ru, S) {
  var series = p.series, row = p.level, rank = clamp(p.rank, 0, 2);
  var res = { unit: D };
  function doDamage(power, div, attr) {
    /* ★★★★★ **배리어·탈것은 마법 피해를 건너뛴다** — 0x2A500 (2026-09-01)
     *
     *   원본은 **대상 수집이 아니라 HP 를 빼기 직전**에 거른다:
     *   ```asm
     *   0x2A563  cmp ax, dx / jne 0x2A574              ; 이미 맞은 목록(0xF0648)이면 건너뛴다
     *   0x2A568  test [esi+0x15], 0x80 / jne 0x2A574   ; ★ 배리어면 건너뛴다
     *   0x2A56E  cmp  [esi+0x5C], 7   / jb  0x2A585    ; ★ 탈것 7 이상도 건너뛴다
     *   0x2A585  … call 0x285E3(위력) … 0x2A59F  sub [esi+0x48], eax
     *   ```
     *   ☠ **`applyDamage()` 에 넣으면 안 된다** — 평타·필살기도 그 함수를 쓰는데
     *     원본의 이 검사는 **마법 광역 피해(0x2A500) 안에만** 있다(평타 `0x1DAF9` 에는 없다).
     *   ☠ **대상 수집(`gatherMagicTargets`)에 넣어도 안 된다** — 회복·버프까지 막힌다.
     *     원본은 수집 함수(`0x28982`·`0x42743`)를 그대로 두고 **피해만** 건너뛴다.
     *   ★ `0x80` 은 배리어다 — `0x2A3FD  or [ebx+0x15], 0xE0` 셋(매직아머 0x20 ·
     *     블레스 0x40 · **배리어 0x80**) 중 하나이고, 그 칸이 곧 `f15` 다(`combat.js:114`).
     *     ☠ `ailment`(`[+0x1E]`)와 **다른 칸**이다.
     *   ★ `[+0x5C] < 7` 은 관용구다 — `cmp byte [reg+0x5C], imm` 전수 42 곳 중 `7` 이 16 곳
     *     (`0x417BF`~`0x42AB4` 열한 곳이 연달아). 그 값이 `mount` 다(`combat.js:108`·`:1252`). */
    if (((D.f15 | 0) & 0x80) || (D.mount | 0) >= 7) {   // 0x2A568 · 0x2A56E
      res.damage = 0; res.blocked = true; return res;
    }
    var dmg = Ru.magicDamage(cv, dv, { power: power, div: div, attr: attr }, ctx);
    var r = applyDamage(battle, D, dmg, { killer: u, reason: 'magic' });
    res.damage = dmg; res.hpAfter = r.hpAfter; res.died = r.died;
    res.kill = r.kill;                                   // ★ 경험치 — 0x1745B
    return res;
  }
  function instantKill() {
    var r = applyDamage(battle, D, (D.hp | 0), { killer: u, reason: 'magic' });
    res.damage = D.hp | 0; res.hpAfter = r.hpAfter; res.died = r.died; res.instantKill = true;
    /* ★ 즉사도 경험치를 준다 — 데스 0x2C359 · 블랙홀 0x2C618 이 0x1DB1D 를 직접 부른다 */
    res.kill = r.kill;
    return res;
  }
  function doHeal(amount) {                                            // 회복 위력=(rank+1)×5000 (0x2ba6b)
    /* ★★★★★ **나눗값은 30 이다 — 100 이 아니었다** (2026-09-06 · `0x2BA75` 직독)
     *
     *   ```asm
     *   0x2BA6B  movsx eax, di           ; 클래스
     *   0x2BA6E  inc   eax
     *   0x2BA6F  imul  edx, eax, 0x1388  ; ★ 위력 = (클래스+1) × 5000   ← 우리 값과 같다
     *   0x2BA75  mov   ebx, 0x1E         ; ★ **나눗값 30** (바이트 BB 1E 00 00 00)
     *   0x2BA7C  call  0x2ACCB           ;   회복 함수
     *   ; ── 그 안 언데드 갈래
     *   0x2AD04  cmp byte [esi+0xD], 2   ;   언데드면
     *   0x2AD0A  push -1                 ;   attr = −1 (상성 생략)      ← 우리 값과 같다
     *   0x2AD0C  mov ecx, [esp+0xA]      ; ★ 나눗값 = 함수의 bx 인자 = **30**
     *   0x2AD1B  call 0x285E4            ;   마법 피해 계산
     *   0x2AD23  lea edx, [eax+eax]      ;   **2배**                     ← 우리 값과 같다
     *   ```
     *   ☠ `100` 이면 `0x285E4` 의 `clamp(지력×100÷나눗값, 100, 200)`(`0x28609 idiv` →
     *     `0x2860D`~`0x28620`)이 지력 100 미만에서 늘 **하한 100 %**에 붙는다.
     *     지력 60 이면 원본 200 % ↔ 우리 100 % — **언데드에게 주는 피해가 절반**이었다.
     *     (지력 30 이하에서만 우연히 같았다.)
     *   ★ 살아 있는 대상을 **회복하는 양**은 이 값과 무관하다 — 원본도 지력을 안 본다
     *     (`0x2AD51` 아래는 장비 보정 `0x2AD5D` 만 곱한다 · `rules.js magicHeal`). */
    ctx.spell = { power: amount, div: 30, attr: -1 };       // 0x2BA75 mov ebx, 0x1E
    var h = Ru.magicHeal(cv, dv, amount, ctx);
    /* ★ 언데드면 피해가 0 이어도 피해 갈래다 — 0x2AD2F call 0x45BFB(숫자 팝업)·0x2AD48 [esp+0xC]=1 을 늘 탄다 → 0 이면 miss
     *   ☠ 예전엔 `if (h.damage)` 라 마법방어로 0 이 된 언데드(소울리콜 반다이크)가 회복 0 갈래로 빠져 표시가 없었다
     *   (2026-09-25 사장님 「원본은 소울리콜로 되살아난 반다이크가 회복 1,2단계 마법 효과를 받으면 miss판정이 나네」) */
    if (D.race === 2) { var rd = applyDamage(battle, D, h.damage | 0, { killer: u, reason: 'magic' });
      res.damage = h.damage; res.undead = true; res.hpAfter = rd.hpAfter; res.died = rd.died;
      res.kill = rd.kill; }                              // ★ 턴언데드도 — 0x2A3B9
    else {
      var 전hp = D.hp | 0;
      applyDamage(battle, D, -h.heal, { reason: 'heal' }); res.heal = h.heal; res.hpAfter = D.hp;
      /* ★ 실제로 오른 양 — 게이지(0x462A7)는 이것이 100 미만이면 안 돈다(0x462DD cmp ecx,0x64). 명목 회복량으로 돌리면
       *   HP 가 가득 찬 대상도 «hp−회복량» 에서 다시 차오르는 게이지를 그렸다 (2026-09-25 칸 75 원본은 연출 뒤 게이지 대기 0) */
      res.healGain = (D.hp | 0) - 전hp;
    }
    return res;
  }
  if (series <= 2) {
    /* ★★★ **2단계(row 1)는 피해가 아니라 「무기 속성 부여」다.** (`0x2914A`)
     *
     * 사용자 지적 2026-08-15: 「마법 효과 자체도 잘못되었어. 지금은 **아군에게
     * 데미지를 입혀.** 아군의 무기에 각 원소 속성을 부여해야 해.」
     * → `COMBATII.EXE` 를 읽어 확인했다. **HP 를 건드리는 명령이 하나도 없다** —
     *   `0x28728`(피해 루프)도 `0x285E4`(피해 계산)도 안 부른다.
     *   하는 일은 `[대상+0x15] &= 0xF8 ; |= 속성` 과 `[대상+0x16] = 지속` 뿐이다.
     *   자세히 — `03_분석/COMBATII/연출_원소2단계_원본확정.md` §3 · §8-1.
     *
     * `rules.js applyElement`(같은 주소 근거)와 지속표는 **이미 있었다.**
     * 여기서 안 불러서 원소 전 단계가 피해로 새고 있었던 것뿐이다.
     */
    /* ★ 계열 비트는 **2단계(속성부여)와 3단계(상태이상)가 함께 쓴다** — 그래서
     *   `row === 1` 블록 밖에 둔다. 안에 두면 3단계에서 `undefined` 라
     *   `ELEM_BIT[series]` 에서 예외가 나고 **피해까지 통째로 안 들어간다**
     *   (사용자 2026-08-16: 「데미지가 안들어가는데?」). */
    var ELEM_BIT = [1, 2, 4];                         // 화염 1 · 빙한 2 · 전격 4 (0x29306·0x29213)
    if (row === 1) {
      var 지속 = [50, 60, 70][rank];                   // 0x74488[rank+2] — 5·6·7분 (1분 = 대기시간 10)
      var 이전 = Ru.applyElement(D, ELEM_BIT[series], 지속);
      if (D.unit) { D.unit.f15 = D.f15; }              // view → 실체 (commit 을 안 타는 경로 대비)
      res.enchant = ELEM_BIT[series];
      res.enchantDur = 지속;
      res.enchantHad = 이전 | 0;                       // 0x291CF — 이미 걸려 있었나
      return res;
    }
    /* 원소 7단계 창 밖 적 — 0x2A5BE 상태이상 → 0x2A500 숫자 없는 피해 (castMagic 'outside' 주석) */
    if (row === 6 && S.sunMode === 'outside') {
      var 비트o = ELEM_BIT[series] | 0;
      if (!Ru.isStatusImmune(dv) && Ru.statusRoll(cv, dv, 30, ctx.rng)) {   // 0x2A627 sprite≥300 먼저 · 0x2A649 0x28947(30)
        var 표o = ctx.tables['상태이상지속'];
        dv.f1e = (dv.f1e & 0xF8) | 비트o;                                    // 0x2A654~0x2A662
        dv.st.d1e[0] = (비트o === 2 ? 표o[rank + 1] : 표o[rank + 2]) | 0;     // 0x2A693 0x7448A · 0x2A682 0x7448C
        if (비트o === 2) dv.wait = 0;                                        // 0x2A6A1 call 0x197AD
        commit(battle, D, dv);
        if (비트o === 2) 빙결대기열빼기(battle, D);                          // 정본 421 — 0x197AD 의 «대기열에서 빼기»(0x19718)
        res.ailment = 비트o; res.ailmentDur = dv.st.d1e[0] | 0;
      }
      var r밖 = doDamage(S.power, S.div, S.attr);    // 0x2A59B call 0x285E4 — 배리어·탈것≥7(0x2A568·0x2A56E)은 doDamage 가 거른다
      r밖.silent = true;                                 // 0x2A5A0 sub [esi+0x48] — 0x45BFB 없음
      return r밖;
    }
    var r피해 = doDamage(S.power, S.div, S.attr);      // 그 밖 원소 단계는 피해
    /* ★★★ **원소 3단계는 상태이상을 함께 건다** — 원본 `0x29711` → `0x29437` (2026-08-16)
     *
     *   사용자 지정: 「상태이상 효과 부여(확률 등 원본 참조, **블리자드스톰처럼
     *   100%는 절대 아님**)」 — 원본을 떠 보니 정말 확률이었다.
     *
     *   ```asm
     *   0x296EE  ebx = 0x32(50) ; edx = 속성+1      ; 기본 확률 50 · 거는 비트
     *   0x29711  call 0x29437
     *   0x2944A    cmp dx,2 ; 0x29450 sub ebx,0x14  ; ★ 빙결이면 −20
     *   0x29473    call 0x28947                     ; 확률 판정
     *   0x29488    cmp [대상+0x61],0x12c ; jge      ; sprite>=300 대상은 면역
     *   0x29494    and [대상+0x1E],0xF8 → or → mov  ; 하위 3비트를 갈아 끼운다
     *   ```
     *   확률(`0x28947`)은 **레벨 차이**로 오르내린다 —
     *   `[유닛+0x2B]` 는 **레벨**이다(`경험치_레벨업.md` `0x17B6C [유닛+0x2B]++`).
     *
     *   ★★★★★ **지속 시간은 표에서 온다 (2026-08-29)** — 100 이 아니다.
     *     ```asm
     *     0x2949E  dl = [esp+4](비트) · or [eax+0x1E], dl
     *     0x294AE  cmp bx, 2 / jb 0x294BE / jbe 0x294DD
     *     0x294B6  cmp bx, 4 / je …
     *     0x294BE  cmp bx, 1 / jne
     *     0x294C2  eax = [esi*4 + 0xA0648](유닛)
     *              **dx = [edi*2 + 0x7448A]** · mov [eax+0x1F], dx   ; ★ 비트 1
     *     0x294DD  **ax = [edi*2 + 0x74488]** · …                    ; ★ 비트 2
     *     ```
     *     표 실측 — `0x74488` 부터 word 로 **30 · 40 · 50 · 60 · 70 · 0**.
     *     곧 비트마다 **표의 시작 칸이 다르다**(비트 2 → `+0` · 비트 1 → `+2`).
     *     같은 표를 DNA Change 도 쓴다(`0x2C553  [edx*2 + 0x7448C]` = **50/60/70**) —
     *     그 주석의 「표[2] 부터」와 정확히 맞물린다.
     *   ★★★ **함수 규약도 읽었다** — `0x29437  push esi,edi,ebp · sub esp,8`
     *     `0x2943C  mov ebp, eax`(유닛) · `0x2943F  [esp+4] = dx`(**비트**) ·
     *     `0x29443  [esp] = bx`(**기본 확률**) · `0x29446  **mov edi, ecx**`(색인)
     *     `0x2944A  cmp dx, 2 / jne · 0x2944E sub ebx, 20`  ← ★ **빙결이면 −20**
     *
     *   ★ **기본 확률은 caller별이다** — 후속 호출 역추적(2026-09-08)에서:
     *     `0x29711` = 원소 **3단계** 공통 효과(기본 50 · 비트=원소),
     *     `0x299C1` = 4단계 공용 효과 내부(기본 30 · 비트4),
     *     `0x2A4E9` = 암흑4/Soul Recall 쪽(기본 30 · 비트4),
     *     `0x2AA92` = 빙한6/회복5가 쓰는 `0x2A75A` 공용루틴 내부다.
     *   따라서 여기 3단계 경로는 **base=50** 으로 `0x29437`을 호출하는 것이 확정이다.
     *   지속시간은 평타의 100이 아니라 `0x74488/0x7448A` 표를 사용한다. */
    /* ★★★★★ 원소 상태이상 caller를 원본 호출점별로 매핑한다.
     *
     *   3단계: 0x29711 -> 0x29437
     *     - 화염/빙한/전격 공통
     *     - caller base = 50
     *
     *   빙한 7단계: 0x2B8F3 -> 0x2A75A -> 0x2AA92 -> 0x29437
     *     - Star Tearer(class 1/2), Moon Light(class 3)
     *     - caller base = 30
     *     - freeze(kind 2) 보정 -20 이 `Rules.statusApply` 안에서 적용되므로
     *       동레벨 성공률은 10%
     *     - 지속시간은 class 1/2/3 = 30/40/50
     *
     *   2026-09-20 원본 정적 재검증에서 Ice7 호출경로를 직접 확인했다.
     *   0x2AA92 를 다른 마법에서 추정 재사용한 것이 아니라
     *   Ice7 wrapper(0x2B8F3)부터 제어흐름을 따라 도달한 결과다. */
    /* ★ 2026-09-25 원소 4단계 추가 — 처리기 0x297E1(연출 0x2111E/0x2132B/0x215FE BOOM·ICESTICK · 0x23ABA/0x23C36/0x23F3A THUNDWAV)이
     *   0x28728 피해 · 0x287AF 숫자 뒤 대상마다 0x299C1 call 0x29437(기본 30 · 속성 0·1 → 비트 +1, 2 → 4)을 부른다.
     *   (사장님 2026-09-25 「원소마법의 경우 1,2,5단계 제외하고 대부분 상태이상(화상,결빙,감전) 효과가 있던걸로 기억하는데 누락된게 많아보여」)
     *   ★ 7단계는 화염·빙한·전격 모두다 — 0x2A75A 안 0x2AA68 cmp bx,3 / jge 뒤 0x2AA92 call 0x29437(비트 1<<bx · 기본 30) (2026-09-25 직독)
     *   ★ 6단계는 0x2A4E9(함수 0x2A1C6) 가 그 호출이다 — 아래 상태기본 주석 */
    /* ★ 6단계 — 0x2A1C6(종류 di = 계열 0·1·2 · 점프표 0x2A1AE) 이 연출(화염 0x5666E… · 빙한 0x57766… · 전격 0x241F7…) 뒤
     *   0x2A4A9 0x28728 피해 → 0x2A4BA cmp di,2 : di<2 면 비트 di+1, di==2 면 비트 4 · 기본 30(0x2A4C4·0x2A4DA) → 0x2A4E9 call 0x29437.
     *   같은 함수의 암흑 7단계(di 5)는 jne 0x2A4EE 로 건너뛴다 — 사장님 「다크존 아토믹 아마게돈은 상태이상 없어」와 같다 (2026-09-26 Z-50) */
    var 상태기본 = (row === 2) ? 50 : (((row === 3 || row === 5 || row === 6) && series >= 0 && series <= 2) ? 30 : null);
    if (상태기본 != null) {                              // row = p.level (0 = 1단계)
      var 비트 = ELEM_BIT[series] | 0;                 // 화염 1 · 빙한 2 · 전격 4
      /* `Rules.statusApply` 가 원본 0x29437 공통루틴을 담당한다:
       *   chance = clamp(base + casterLv - targetLv, 10, 70)  (0x28947)
       *   freeze(kind 2)는 base -20                          (0x2944A)
       *   sprite >=300 면역                                  (0x29488)
       *   하위 3비트 교체                                    (0x29494)
       *   지속표 0x74488/0x7448A                             (0x294D1/0x294E8)
       *   freeze wait=0                                      (0x294FA) */
      var 적용됨 = Ru.statusApply(cv, dv, 비트, 상태기본, rank, ctx);
      /* `dv` 는 피해 적용 전 view라 HP/MP가 stale이다. 상태만 commit하면서
       * 방금 적용된 피해/현재 MP를 되돌리지 않도록 실체 값을 다시 싣는다. */
      if (적용됨) {
        dv.hp = D.hp | 0; dv.mp = D.mp | 0;
        commit(battle, D, dv);
        if (비트 === 2) 빙결대기열빼기(battle, D);                            // 정본 421 — 0x294FA call 0x197AD
        res.ailment = 비트;
        res.ailmentDur = (dv.st && dv.st.d1e) ? (dv.st.d1e[0] | 0) : 0;
      }
      /* 표시/시험용 성공률. statusApply 내부와 같은 입력을 쓴다. */
      res.ailmentRate = Ru.statusChance(cv, dv, 상태기본 - ((비트 === 2) ? 20 : 0));
    }
    return r피해;
  }

  if (series === 3) {                                                 // 회복 계열
    if (row === 2) {                                                  // Cure — 0x2B1D0
      /* ★ 원본은 비트를 지우기 **전에** 혼란이던 아군을 행동 대기열에 되돌린다.
       * ```asm
       * 0x2B2FC  cmp [ecx+0x83], 0 ; jne 0x2B312    ; AI 위임이면 건너뛴다
       * 0x2B305  test [ecx+0x1E], 0x10 ; je 0x2B312 ; ★ 혼란이면
       * 0x2B30D    call 0x196D0                     ;   대기열에 넣는다 ([+0x0E]==1 아군만)
       * 0x2B312  mov [ecx+0x1E], 0                  ; 2차 상태 통째로 0
       * ```
       * 혼란이 걸리면 AI 가 조작하느라 대기열에서 빠져 있기 때문이다
       * (`0x19C10` → `0x19C18`). 풀어 줘도 대기열에 안 넣으면 그 유닛은
       * **차례가 와도 조작할 수 없다.** */
      var Tn = root.G2Turn, 실체 = D.unit || D;
      if (((D.f1e | 0) & 0x10) && (실체.side | 0) === 1 && (실체.waitCount | 0) === -1 &&
          !((실체.ai && 실체.ai.flag) | 0) &&
          Tn && Tn.enqueueReady) {
        try { Tn.enqueueReady(battle, 실체); } catch (e) { /* 무시 */ }
      }
      /* ☠☠★★★★★ **raw 칸을 지워야 실제로 풀린다** (2026-09-19 · PACKET 16 §5.5)
       *   원본 `0x2B312 mov [ecx+0x1e], 0` 은 상태이상을 **통째로** 0 으로 만든다.
       *   여태 `D.ailment`(제품 보조 표현)만 지우고 **raw `D.f1e` 를 안 건드렸다** —
       *   실측: 비트 0x01·0x02·0x08·0x10·0x20 을 걸고 Cure 를 쓰면
       *   `ailment` 255→0 인데 **`f1e` 는 59→59 그대로**였다.
       *   `rules.js` 의 실제 판정(`tickDurations`·`applyAilmentBit`)은 raw 를 쓴다
       *   ⇒ **치료해도 상태이상이 안 풀렸다.**
       *   ☠ 지속 슬롯 `st.d1e` 는 근거가 없어 안 건드린다 — `tickDurations` 는
       *     비트를 «끄기만» 하므로 남아도 해가 없다. */
      /* ★ 승인된 리마스터 버그 수정 — Cure는 모든 negative debuff/status를 지우고,
       * DNA Change 중이면 stat 복구와 함께 pre-DNA sprite/form도 즉시 복원한다.
       * positive buff(f15)는 보존한다. */
      var _cureHadDNA = !!((D.f1e | 0) & 0x40);
      D.f1e = 0;                                                      // 0x2B312  ★ raw negative statuses clear
      D.ailment = 0;
      if (_cureHadDNA && D._dna전스프라이트 != null) {
        D.sprIndex = D._dna전스프라이트 | 0;
        D._dna전스프라이트 = null;
        D.dnaForm = null;
      }
      res.cure = true;
      res.intentionalBugfix = _cureHadDNA ? 'BUGFIX_DNA_CHANGE_FORM_RESTORE' : null;
      return res;
    }
    if (row === 3) return (D.race === 2) ? instantKill() : (res.noEffect = true, res);  // Turn Undead — 언데드 즉사 0x2a1c6
    /* ★★★★★ **속성은 −1 이다 — 3 이 아니었다** (2026-09-06 · `0x2ABAE` 직독)
     *
     *   ☠ 옛 근거 `0x30FBB` 는 **EXE 파일 오프셋**이지 코드 주소가 아니다
     *     (`마법_데미지공식.md` 의 「주소 검증 결과」 표가 통째로 파일 오프셋이다).
     *     그 자리를 코드로 뜨면 `01 00 A1 CC 55 07 00` — 전혀 다른 명령이다.
     *
     *   진짜 자리 — 7단계 함수 `0x2A75A` 안, 계열 4(회복) 갈래:
     *   ```asm
     *   0x2AB8E  cmp word [esp+0xC], 4     ; ★ 계열이 4(회복)인가
     *   0x2AB96  cmp word [esp+0x10], 0    ;   클래스
     *   0x2ABA0  call 0x5A267              ;   1클 연출 (SUN)
     *   0x2ABA9  call 0x5A566              ;   2·3클 연출 (SUNL·SUNL2)
     *   0x2ABAE  mov ecx, 0xFFFFFFFF       ; ★ **속성 = −1** (상성 생략)
     *   0x2ABB3  mov ebx, 0x46(70)         ;   나눗값 70   ← 우리 div[6] 과 같다
     *   0x2ABBA  mov edx, 0x2328(9000)     ;   위력 9000   ← 우리 값과 같다
     *   0x2ABC6  call 0x28728              ;   피해
     *   ```
     *   ☠ `3`(암흑)이면 `rules.js magicDamage` 가 **마법 저항을 통째로 무시**하고
     *     (`0x2865C`) **상성을 곱한다**(`0x28708`). `−1` 이면 정반대로
     *     **저항은 적용되고 상성은 생략**된다. 두 갈래가 다른 값을 낸다. */
    /* ★★★★★ **선라이트는 「언데드 피해·나머지 회복」이 아니다** (2026-09-24 · 0x2AB8E~0x2AC75 직독)
     *   > 사장님: 「선라이트 적 데미지, 아군 회복 적용 안되는 문제」
     *   ☠ 여기는 대상마다 `언데드면 피해 · 아니면 (클래스+1)×5000 회복` 이었다 — 회복 1단계
     *     (`0x2BA6B`)의 식을 잘못 옮긴 것이라 **일반 적이 회복**되고(풀피면 0) 1클도 아군을 채웠다.
     *   원본은 대상을 셋으로 나눠 따로 친다(`선라이트대상()`) —
     *     'damage' 창 안 적  `0x28728(9000, 70, −1)` · 숫자 `0x28775 call 0x45BFB`
     *     'silent' 맵의 나머지 적  `0x2A500(9000, 70, −1)` · 숫자 없음(`0x2A59B`→`0x2A5A0 sub`)
     *     'heal'   2·3클 아군  `0x2ACCB(0x283FE[클래스−1], 50)` · 1클은 `0x2ABF5 jl` 로 없음 */
    if (row === 6) {
      if (S.sunMode === 'heal') return doHeal(S.sunHeal);                  // 0x2AC75
      var r해 = doDamage(9000, S.div, -1);                                  // 0x2ABB3 · 0x2ABBA
      if (S.sunMode === 'silent') r해.silent = true;                        // 0x2A500 — 0x45BFB 없음
      return r해;
    }
    /* Heal Wind — 0x2BC2E mode 3 → 0x2AC64가 0x283FE[클래스]를 꺼내
     * ebx=50으로 0x2ACCB에 넘긴다. living heal에는 지력 factor를 쓰지 않는다. */
    if (row === 4) return doHeal(S.power);                              // 2000 · 4000 · 7000
    /* ★★★★★ **회복 2단계(Wide Heal)만 「표」다 — 계산식이 아니다** (2026-09-06)
     *
     *   ```asm
     *   ; ── 회복 1단계 Heal (계산식)
     *   0x2BA6B  movsx eax, di
     *   0x2BA6E  inc   eax
     *   0x2BA6F  imul  edx, eax, 0x1388   ; ★ (클래스+1) × 5000  → 5000·10000·15000
     *   0x2BA75  mov   ebx, 0x1E(30)
     *   0x2BA7C  call  0x2ACCB
     *   ; ── 회복 2단계 Wide Heal (표)   함수 0x2BA8E
     *   0x2BA9D  mov   edi, esp
     *   0x2BAA8  mov   esi, 0x2840A       ; ★ **표 주소**
     *   0x2BABE  movsd ; movsd ; movsd    ;   dword 셋을 스택에 복사
     *   0x2BB0C  call  0x25254            ;   회복2 1클 연출 (골격 회복2.1)
     *   0x2BB53  mov   ebx, 0x1E(30)
     *   0x2BB58  mov   edx, [esp + eax*4] ; ★ **클래스로 꺼낸다**
     *   0x2BB5D  call  0x2ACCB
     *   ```
     *   표 실측 `0x2840A` dword — **5000 · 8000 · 12000**.
     *
     *   ☠ 우리는 `(클래스+1)×5000` = 5000·**10000**·**15000** 을 쓰고 있었다 —
     *     2클래스가 **1.25배**, 3클래스가 **1.25배** 더 회복됐다.
     *
     *   ☠☠ 그리고 위 `basePow` 옆 주석의 「`0x2840A` 는 **소환수 경로**다 —
     *     참조가 `0x2BAA9` 한 곳뿐이다」는 **틀렸다.** `0x2BAA9` 는 바로 이
     *     `0x2BAA8 mov esi,0x2840A` 의 오퍼랜드 자리이고, 그 함수 `0x2BA8E` 는
     *     `0x2BB0C call 0x25254`(회복2 연출)를 부르는 **Wide Heal 경로**다. */
    if (row === 1) {                                                  // Wide Heal — 0x2BAA8 표 0x2840A
      /* `powTable`은 cast() 지역 변수라 applyMagicToUnit()에서 참조하면 ReferenceError다.
       * 이 경로의 정본은 바로 위에서 고정한 원본 표 0x2840A 자체다. */
      var 넓힘 = [5000, 8000, 12000];
      return doHeal(넓힘[clamp(rank, 0, 2)] | 0);
    }
    return doHeal((rank + 1) * 5000);                                 // Heal (0x2BA6F) / Heal Wind
  }

  if (series === 4) {                                                 // 보조 — 버프/디버프
    /* ★ 지속은 **비트마다 정해진 칸**에 넣는다 (`rules.js` BUFF_SLOT/AIL_SLOT).
     * 예전에는 `mbuffDur` 라는 딴 주머니에 넣어서 `tickDurations` 가 못 깎았고,
     * 그래서 **버프가 영영 안 풀렸다.** (2026-08-14 수정) */
    if (row === 0) Ru.applyBuffBit(D, 0x08, S.dur);                     // Power Up    → physicalDamage f15&8 → 공+20
    else if (row === 1) Ru.applyBuffBit(D, 0x10, S.dur);                // Speed Up    대기-3
    else if (row === 2) Ru.applyBuffBit(D, 0x20, S.dur);                // Magic Armor → magicDamage f15&0x20 → MR+20
    else if (row === 3) Ru.applyBuffBit(D, 0x40, S.dur);                // Bless       → physicalDamage f15&0x40 → 방어+20
    /* ★★★★★ **탑승·대형 몬스터에게는 안 걸린다** (2026-09-07 · 사장님 지적 M23)
     *
     *   > 사장님: 「스틸엠피 … **탑승몬스터한테는** … **발동이 안되어야 하는데 발동이 돼**」
     *
     *   원본은 침묵·저주를 **같은 루프 `0x2B391`** 로 처리하고, 그 루프가
     *   **`0x2B45D cmp [대상+0x61], 0x12C(300) ; jge 0x2B53E`** 로
     *   **그림 번호 300 이상이면 통째로 건너뛴다**(`범위마법_순차적용_㉯.md:177`).
     *   ☠ (정정 2026-09-26) 「연출은 그대로 나가고 효과만 안 걸린다」는 틀렸다 — 0x2B45D jge 0x2B53E 가 대상별 연출 호출(0x261FC 등)까지 건너뛴다.
     *     그래서 cast 가 대상 목록에서 미리 뺀다(아래 여기서의 검사는 남은 안전줄).
     *   ☠ 우리는 이 검사를 **배리어(`row 5`)에만** 옮겨 두었다(`0x2A3F5`).
     *     원본은 **두 곳 다에서** 거른다.
     *   ★ 스틸 MP 는 이름만 다를 뿐 **침묵과 같은 기능**이다(MP 를 안 훔친다) —
     *     이름표 `96 Silence · 97 Silence · 98 Steal MP`, 함수 하나 `0x2BEDE`.
     *   조사: `03_분석/_보관/끝난조사/00_지금조사_탑승제외.md` */
    /* ★★★★★ **원본에는 제외 조건이 셋이다** (2026-09-08 · `0x12124` 를 뜯었다)
     *   ```asm
     *   0x12125  cmp word [유닛+0x61], 0x12C ; jge → 안 걸림   (그림 300 이상)
     *   0x1212D  cmp byte [유닛+0x56], 0xFF  ; je  → 안 걸림   (행동 가능한 유닛이 아님)
     *   0x12133  test byte [유닛+0x14], 1    ; jne → 안 걸림   (★ 비행)
     *   0x12139  그 밖 [유닛+0x64] = 3       ; 걸림
     *   ```
     *   ☠ 우리는 그림 번호 하나만 봤다. **비행**을 더한다 —
     *     `[+0x14]` 비트 1 = 비행은 이미 확정돼 있다(`0x29B1A`·`0x3B5B4`·`0x180D4`).
     *   ☐ `[+0x56]==0xFF` 의 우리 쪽 대응은 아직 못 찾아 넣지 않았다. */
    else if (row === 4) {
      /* ☠★★★★★ **`D.sprite` 는 유닛에 없는 이름이었다** (2026-09-08 · 사장님 지적)
       *
       *   > 사장님: 「스틸엠피 … **탑승몬스터한테는 발동이 안되어야 하는데 발동이 돼**」
       *   > (말한테 시험하셨다)
       *
       *   `D` 는 **유닛 그 자체**다(`3059줄 var D = targets[i]`). 유닛의 키를 전수로
       *   찍어 보니 `sprite` 가 **없고 `sprIndex` 뿐**이다.
       *   ⇒ `undefined | 0` = **0** 이라 `0 < 300` 이 늘 참이 되어 **아무도 안 걸러졌다.**
       *   ★ `sprite` 는 `view()` 가 만드는 **사본**의 이름이다(`108줄`) — 검사는 원본에 했다.
       *   실측 — `sprIndex = 305`(말)인 대상도 `f1e` 가 0 → **8**(침묵)이 됐다.
       *   같은 함정이 **셋**이었다(침묵·배리어·저주). 셋 다 고쳤다. */
      /* 효과 제외는 0x2B45D의 sprite>=300뿐이다. 0x1212D/0x12133의 [+0x56]·비행
       * 검사는 대상 루프가 끝난 뒤 모션 [+0x64]을 0/3으로 정하는 별도 처리다. */
      if (!spriteProfile(D).magicEffectExcluded) Ru.applyAilmentBit(D, 0x08, S.dur);  // 0x2B45D · 0x2B577
    }
    else if (row === 5) {
      /* ★ 배리어 — 0x2A3EB ~ 0x2A420
       * ```asm
       * 0x2A3F5  cmp [ebx+0x61], 0x12C ; jge   ; 대형(>=300)은 제외
       * 0x2A3FD  or  [ebx+0x15], 0xE0          ; ★ 매직아머 20 + 블레스 40 + 배리어 80 을 한꺼번에
       * 0x2A408  dx = [edx*2 + 0x7448A]        ;   표[1] 부터 = 40/50/60 (4·5·6분)
       * 0x2A410  mov [ebx+0x1E], 0             ; ★ 상태이상을 통째로 지운다 (Cure 를 겸한다)
       * 0x2A414  mov [ebx+0x1C], dx            ;   버프 지속 칸[3] — 셋이 공유
       * ```
       * 셋을 다 켜므로 배리어 하나로 물리·마법 방어가 같이 오릅니다. */
      if (!spriteProfile(D).magicEffectExcluded) {                                  // 0x2A3F5 (★ sprite → sprIndex · 2026-09-08)
        Ru.applyBuffBit(D, 0xE0, S.dur);                                // 0x2A3FD · 0x2A414
        D.f1e = 0;                                                   // 0x2A410
        res.cure = true;
      }
    }
    /* ★ 커스도 **같은 루프**(`0x2B391`)를 탄다 — 대형은 `0x2B45D` 로 건너뛴다 (M23·M25) */
    /* ★★★ **커스만 지속표의 다른 자리를 읽는다** — `0x2B5B2 [eax*2 + 0x74488]`
     *   (침묵·배리어는 `0x7448A`). 곧 커스가 **한 칸 짧다** — 30·40·50 (2026-09-09) */
    else if (row === 6) { if (!spriteProfile(D).magicEffectExcluded) Ru.applyAilmentBit(D, 0x20, S.curseDur != null ? S.curseDur : S.dur); }  // Curse 0x2B45D · 0x2B59E · 0x2B5B2
    res.buff = magicEffectKind(series, row); res.dur = S.dur; return res;
  }

  if (series === 6) {                                                 // 암흑
    if (row === 0) {                                                  // Confuse — 칸[2]
      /* ★ 2026-09-25 — 원본 0x2B32B~0x2B334: 0x28947(시전자, 대상, 기본 30) 성공일 때만 [+0x1E] |= 0x10 · [+0x23] = 지속표(0x2B34F).
       *   ☠ 예전엔 굴림 없이 늘 걸렸다. 난수는 연출이 대상마다 예약해 둔 것(magicfx cure · 0x28973 자리)을 먼저 쓴다 */
      /* ★ 2026-09-26 — 그림 300 이상은 굴리지 않고 건너뛴다(0x2B2C9 cmp [+0x61],0x12C / jge 0x2B370) · 지속은 0x7448C(표[클래스+2] = 50·60·70 · 0x2B34F)
       *   ☠ 예전: 늘 굴렸고(난수 한 칸 더 씀) 지속을 0x7448A(40·50·60)로 한 칸 짧게 넣었다 */
      if ((D.sprIndex | 0) >= 0x12C) { res.resisted = true; return res; }
      var 예약 = root.G2Rand && root.G2Rand._판정예약;
      var 굴 = (예약 && 예약.length) ? 예약.shift()
             : ((root.G2Rand && root.G2Rand.rng) ? root.G2Rand.rng(100) : Math.floor((opts.rng ? opts.rng() : Math.random()) * 100));
      if (굴 < Ru.statusChance(cv, dv, 30)) { Ru.applyAilmentBit(D, 0x10, [50, 60, 70][clamp(rank, 0, 2)]); res.status = 'confuse'; }   // 0x2B346 · 0x2B34F
      else res.resisted = true;
      return res;
    }
    if (row === 1) { res.melt = meltItem(D, rank, opts.rng); return res; }   // Melt Item — 0x2C00E
    if (row === 2 || row === 5) {                                     // Death / Black Hole — 저항롤 8>>rank + 면역 0x2c34f
      /* ★ 2026-09-25 원본 데스 0x2C322~0x2C359 · 블랙홀 0x2C5E5~0x2C618 다시 읽음:
       *   연출(0x2C31D 0x26C9A) «뒤» rand(8 >> 클래스)(0x499BD) 가 0 이면 — 대상 그림 [+0x61] < 300(0x2C347) 이고
       *   [+0x43] 권위(장비 포함) < 50(0x2C34F jae) 일 때만 0x1DB1D 로 죽인다. 블랙홀은 목록 [0x80648] 차례로 대상마다.
       *   ☠ 예전: Rules 난수(연출과 다른 흐름) 실수 굴림 · 면역을 레벨 ≥ 50 으로 봤다 — 칸 133 원본은 성공(사망 연출) · 우리는 실패 */
      var 판n = 8 >> rank, 판r;
      if (root.G2Rand && root.G2Rand.rng) 판r = root.G2Rand.rng(판n);    // 0x2C32A · 0x2C5F4 call 0x499BD — 연출과 같은 흐름
      else 판r = Math.floor((opts.rng ? opts.rng() : Math.random()) * 판n);
      var immune = !!D.deathImmune || (D.sprIndex | 0) >= 0x12C || (eff(battle, D).cha | 0) >= 50;
      if (판r === 0 && !immune) return instantKill();
      res.resisted = true; return res;
    }
    if (row === 4) {
      /* ★ DNA Change — 0x2C525 ~ 0x2C55B
       * ```asm
       * 0x2C52A  or  [eax+0x1E], 0x40          ; 상태 비트 → 공/방 ×70%, 최대TP ×70%(0x19FB0)
       * 0x2C533  eax = [eax+0x5D] sar 24       ; = [+0x60]  현재 스프라이트 **캐시 슬롯**
       * 0x2C539  call 0x119B6                  ;   그 슬롯을 반납(참조 카운트 −1)
       * 0x2C547  mov [eax+0x60], 0x64          ; ★ 슬롯을 100 번으로 갈아끼운다 = 모습이 바뀐다
       * 0x2C553  dx = [edx*2 + 0x7448C]        ;   표[2] 부터 = 50/60/70 (5·6·7분)
       * 0x2C55B  mov [eax+0x25], dx            ;   상태 지속 칸[3]
       * ```
       * `[+0x60]` 은 **런타임 캐시 슬롯**이지 스프라이트 번호가 아니라
       * (`전투데이터_추출.md` §유닛 레코드), 슬롯 100 에 무엇이 실려 있는지는
       * ★★★★★ **알 수 있었다 (2026-08-29)** — 슬롯 100 에 무엇을 싣는지 찾았다.
       *   ```asm
       *   0x11C7D  eax = [dx*12 + 0xBB880] · inc edx · call …   ; 슬롯 0~35 를 채우는 루프
       *   0x11C90  cmp dx, 0x24(36) / jl                        ; 그 루프의 끝
       *   0x11C96  mov edx, **100**                             ; ★ 슬롯 100
       *   0x11C9B  mov eax, **0x6D(109)**                       ; ★ 스프라이트 **109**
       *   0x11CA0  call 0x11575                                 ;   Character Image Slot 적재기
       *   ```
       *   ⇒ **DNA Change 의 모습은 스프라이트 109** 다.
       *     (`0x11575` 는 `native.js` §7 이 말하는 그 적재기다.)
       *   ★★★ **109 가 무엇인지도 확인했다** — `native.js spriteNames(LE)` 표(1209칸):
       *     `109 → "GOBLIN.NC2"` · `110 → "GOBLINL.NC2"` · `100 → "TAMER2.NC2"`
       *     그리고 우리가 쓰던 `63 → "CLERICKW.NC2"`(성직자)였다.
       *   ⇒ **「고블린」이라는 뜻은 맞았고 번호가 틀렸다.** 63 → **109** 로 고쳤다.
       *
       * `0x1DBD2` · `0x3C264` · `0x50A78` · `0x50B8B` 네 곳이 스프라이트를
       * 반납할 때 `& 0x40` 이면 건너뛰는 것도 이 슬롯 교체 때문이다 —
       * `[+0x60]` 이 이미 100 이라 원래 것을 반납할 수 없다. */
      /* ☠★★★★★ **여기도 `sprite` 였다** (2026-09-08 · 스틸엠피와 같은 함정)
       *   `D` 는 유닛 그 자체라 `sprite` 가 **없다**(`sprIndex` 뿐).
       *   ⇒ `전` 이 늘 **0** 이었고, 되돌릴 때 `rules.js:951` 이
       *     `u.sprIndex = 0` 을 넣어 **엉뚱한 그림**이 됐을 것이다.
       *   ★ 되돌리는 쪽(`rules.js:951`)은 `sprIndex` 를 쓴다 — **짝이 안 맞았다.**
       *   전수: `04_도구/전수/없는속성_검사.js` */
      if (dna못받나(D)) { res.resisted = true; res.dnaSkip = true; return res; }   // 0x2C4E7 · 0x2C4F2 · 0x2C4F7 → 0x2C55F (확률 굴림은 없다)
      var 전 = D.sprIndex | 0;
      Ru.applyAilmentBit(D, 0x40, S.dur);                               // 0x2C52A · 0x2C55B
      /* ☠★★★★★ **`D.unit` 도 사본의 이름이었다** (2026-09-08)
       *   `D` 가 유닛 그 자체라 `D.unit` 이 **없다** → 조건이 늘 거짓이라
       *   **원래 그림을 한 번도 저장하지 않았다.** 되돌릴 수가 없었다.
       *   (`rules.js:950` 이 `u._dna전스프라이트` 를 보고 되돌린다.)
       *   ★ 실측 — 고치기 전 `저장된것` 이 `undefined` 였다. */
      var _본체 = D.unit || D;
      if (_본체._dna전스프라이트 == null) _본체._dna전스프라이트 = 전;
      /* ★★★★★ **`109 = GOBLIN.NC2` — 원본 이름표로 검증했다** (2026-08-29)
       *   `node 04_도구/EXE_스프라이트이름표.js --전부` 로 428칸을 뽑아 대조했다:
       *     `109` → **GOBLIN.NC2**  ·  `110` → GOBLINL.NC2
       *     `63`  → **CLERICKW.NC2**(성직자) ← 고치기 전 값이 왜 틀렸는지도 드러난다
       *   표는 `0x70024`(적용본) 부터 4바이트 포인터 428개다. */
      D.dnaForm = 109; D.sprIndex = 109;    /* 0x11C9B — GOBLIN.NC2 (★ sprite → sprIndex · 2026-09-08) */
      /* ★★★★★ **`0x2C547` 의 100 은 「슬롯 번호」다 — 109 와 짝이다** (2026-09-02 확정)
       *   ```asm
       *   ; ── 적재 (0x11C96~0x11CA0)
       *   0x11C96  ba 64 00 00 00   mov edx, 0x64(100)   ; ★ **슬롯 번호**
       *   0x11C9B  b8 6d 00 00 00   mov eax, 0x6D(109)   ; ★ **파일 번호** GOBLIN.NC2
       *   0x11CA0  e8 d0 f8 ff ff   call 0x11575         ; ★ 스프라이트 적재기
       *
       *   ; ── 이 갈래 (0x2C52A~0x2C547)
       *   0x2C52A  or byte [eax+0x1e], 0x40   ;   상태이상 비트 0x40 (아래 applyAilmentBit)
       *   0x2C533  eax = [eax+0x5D] sar 0x18  ;   지금 슬롯을 읽어
       *   0x2C539  call 0x119B6               ;     넘기고
       *   0x2C547  mov byte [eax+0x60], 0x64  ; ★ **유닛의 스프라이트 슬롯 = 100**
       *   ```
       *   `[유닛+0x60]` 이 스프라이트 슬롯인 근거 —
       *     `그리기계열_분석.md:624`  「0x30644  ecx = 0xD66A8 + [유닛+0x60]*572」
       *   ⇒ 원본은 **「109 를 슬롯 100 에 적재해 두고, 유닛 슬롯을 100 으로 바꾼다」**.
       *     우리는 슬롯 개념이 없어 **파일 번호 109 를 바로** 쓴다 — **결과는 같다.**
       *     (그 슬롯에 들어 있는 것이 바로 109 이기 때문이다.)
       *   ★ 곧 아래 `D.sprite = 109` 는 **원본과 어긋나지 않는다.** 값을 바꾸지 않는다. */
      /* ★ 원본은 **`× 70 ÷ 100` 을 `idiv`(0 쪽 자르기)** 로 한다 — 반올림이 아니다.
       *   `0x19FBE~0x19FC8` 가 `×8 → +원본 → ×4 → −원본 → ×2` 로 **×70** 을 만들고
       *   `0x19FD5 idiv ecx(100)` 으로 나눈다.
       *   ☠ `Math.round` 는 **TP 17 에서 12, 원본은 11** 로 갈라졌다 (2026-08-30).
       *   `rules.js:748`·`turn.js:826` 은 **이미 `idiv`** 를 쓴다 — 여기만 달랐다. */
      D.tp = Math.max(0, idiv((D.tp | 0) * 70, 100));              // 0x19FB0
      res.dna = true; return res;
    }
    if (row === 6) return doDamage(30000, S.div, 3);                  // Armageddon base 30000
    return doDamage(S.power, S.div, 3);
  }
  return doDamage(S.power, S.div, S.attr);
}

/** Melt Item — 원본 `0x2C00E` (2026-09-24 전문 직독)
 *
 *  ☠ 옛 구현은 `D.equip.accessory/shield/weapon` 을 봤는데 유닛 장비는 **`D.gear`** 에 있다 —
 *    그래서 **한 번도 아무것도 안 녹였다.** 확률도 없었다.
 *  ```asm
 *  0x2C0B1  eax = 8 >> 클래스 ; 0x2C0BC call 0x499BD ; test / jne 실패   ; 성공 = rand(8>>클) == 0
 *  0x2C0D0  [+0x5E] 보조 → 0x2C0F3 [+0x5F] 보조2 → 0x2C116 [+0x5D] 장신구
 *           → 0x2C142 [+0x5A] 방패 → 0x2C16B [+0x5B] 무기
 *           비어 있지 않고 0x19600(코드) == 0 인 첫 칸을 0 으로 (장비 셋은 0x18262 로 능력치 되돌림)
 *  ```
 *  칸 이름은 `blackbox.js`(+0x5A 방패 · +0x5B 무기 · +0x5D 장신구 · +0x5E·+0x5F 보조)와 `state.js gear` 대응. */
var 녹지않는코드 = [0x16, 0x19, 0x1A, 0x1D, 0x20, 0x21, 0x22, 0x23, 0x24, 0x3C, 0x46, 0x67, 0x78];   // 0x19600
var 멜트차례 = ['sub', 'sub2', 'charm', 'shield', 'weapon'];                                          // 0x2C0D0~0x2C16B
function meltItem(D, rank, rng) {
  var n = 8 >> clamp(rank | 0, 0, 2);                                   // 0x2C0B1
  var 굴림 = rng ? rng() : Math.random();
  if (Math.floor(굴림 * n) !== 0) return null;                          // 0x2C0BC · 0x2C0C4 jne
  D.gear = D.gear || {};
  for (var i = 0; i < 멜트차례.length; i++) {
    var 키 = 멜트차례[i], 코드 = D.gear[키] | 0;
    if (!코드 || 녹지않는코드.indexOf(코드) >= 0) continue;
    var S = root.G2State;
    if (키 !== 'sub' && 키 !== 'sub2' && S && typeof S.reequip === 'function') {
      try { S.reequip(D, 키, 0); } catch (e) { D.gear[키] = 0; }       // 0x18262 — 능력치 되돌림
    } else {
      D.gear[키] = 0;
    }
    D.gear[키] = 0;
    return { slot: 키, item: 코드 };
  }
  return null;
}

/* ── 부활(Revible) ── */
function revibleTarget(battle, u, target, opts) {
  /* [리마스터 부활선택] 창에서 고른 사람 — 원본 규칙(명부에 있고 적대가 아닌 사망자)을 만족할 때만 (2026-09-26 Z-88) */
  var 고른 = opts && opts.부활대상;
  if (고른 && !고른.alive && !고른.명부밖 && !hostile(u.side, 고른.side, battle.confuse)) return 고른;
  if (target && !target.alive) return target;
  /* ★ 부활도 **칸**을 고른다(`pick: 'tile'`) — 고른 칸에 시체가 있으면 그것이 대상이다. */
  var at = opts && opts.at;
  if (at) {
    var here = null;
    (battle.units || []).forEach(function (q) {
      if (q && !q.alive && (q.x | 0) === (at.x | 0) && (q.y | 0) === (at.y | 0)) here = q;
    });
    if (here) return here;
  }
  var list = (opts && opts.targets) || [];
  for (var i = 0; i < list.length; i++) if (list[i] && !list[i].alive) return list[i];
  /* ★★★★★ **가장 먼저 죽은 아군이다** — 거리가 아니다 (2026-09-19 · PACKET 14)
   *
   *   ```asm
   *   ── 대상 고르기 0x137E7 ──
   *   0x137F0  mov ebx, [0xD6620]        ; ★ 사망자 명부 «머리»
   *   0x13808  eax = 후보[+0xE]
   *   0x13811  call 0x1201D              ;   시전자와 «적대인가»
   *   0x13819  test ax,ax ; je           ; ★ 적대가 아니면 «그것»을 돌려준다
   *   0x1381B  mov ebx, [ebx+0x7b]       ;   아니면 다음
   *   ── 사망 처리 0x1DDA8 ──
   *   call 0x1134F(0xD6620, 죽은이)       ; ★★ 명부 «꼬리»에 넣는다
   *   ```
   *   ⇒ 명부 차례 = **죽은 순서**. 머리부터 찾으니 **가장 먼저 죽은 쪽**이다.
   *
   *   ☠ 여태 「죽은 아군 중 **가장 가까운** 하나」였다. 실측으로 갈렸다 —
   *     먼저 죽은 이를 멀리(거리 20), 나중 죽은 이를 가까이(거리 3) 두면
   *     제품은 **나중 죽은 쪽**을 되살렸다. 원본은 **먼저 죽은 쪽**이다.
   *   ★ 시나리오 시작부터 죽어 있던 유닛은 `죽은차례` 가 없다 — 명부에 먼저
   *     들어간 셈이라 `0` 으로 친다. */
  var best = null, b차례 = Infinity;
  (battle.units || []).forEach(function (q) {
    /* ★ 2026-09-24 — 같은 진영이 아니라 «적대가 아닌» 사망자 (`0x13811 call 0x1201D` · `0x13819 je`) */
    if (!q || q.alive || q.명부밖 || hostile(u.side, q.side, battle.confuse)) return;   // 명부밖 — 0x1DD7D·0x1DD83·0x1DCF7 명부에 없는 죽음
    var 차 = (q.죽은차례 == null) ? 0 : (q.죽은차례 | 0);      // 0x137F0 명부 머리부터
    if (차 < b차례) { b차례 = 차; best = q; }
  });
  return best;
}
function reviveUnit(battle, dead, pct, target) {
  /* ★ 원본은 **`× pct ÷ 100` 을 `idiv`(0 쪽 자르기)** 로 한다 (2026-08-30).
   *   `0x2BD5F~0x2BD64` 가 `×16 → −원본 → ×2` 로 **×30** 을 만들고
   *   `0x2BD72 idiv ebx(100)` 으로 나눈다. **반올림이 아니다.**
   *   x87 반올림 함수 `0x39980` 도 **RC=3(0 쪽 자르기)** 이다. */
  dead.hp = Math.max(1, idiv((dead.maxHp | 0) * pct, 100));    // 0x2bd5a rank별 %
  if (dead.maxMp != null) dead.mp = idiv((dead.maxMp | 0) * pct, 100);
  /* ★ **부활은 상태를 안 지운다** — 원본 `0x2BC3B` 전문에 `[+0x1E]`·`[+0x15]` 를
   *   쓰는 명령이 없다. 지우는 자리는 **사망**(`0x1DD35`·`0x1DD3C`)이고 `kill()` 이 한다.
   *   ☠ 여기서 지우면 «소울리콜로 살아나는 길»이 빠진다 — 실제로 빠져 있었다. */
  dead.alive = true;
  dead._사망연출함 = false;          /* 다시 죽으면 다시 연출돼야 한다 — controller 사망 연출 한 번 표지 (2026-09-25) */
  if (target && target.x != null) { dead.x = target.x | 0; dead.y = target.y | 0; }
  if (battle.setAt) battle.setAt(dead.x, dead.y, dead);
  if ((battle.units || []).indexOf(dead) < 0) battle.units.push(dead);
}

/* ── 소환(Summon) — 빈 칸에 소환수 생성. 시전자 사이드 편입(원본 0x29f4d). ──
 *
 * ★★★ **소환수 능력치표 `0x28359`** — 원본 직독 확정 (2026-08-15).
 *
 * `0x299EF` 가 `[0x18358]` 첫 바이트를 따로 읽고 `0x18359` 부터 **165바이트**를
 * 스택에 복사한다. 데이터 오퍼랜드 `+0x10000` 규칙이라 실제 VA 는 **`0x28359`** 다.
 * **직업당 15바이트 × 11종**이고, 인덱스는 `0x29F4D` 의 `cx` 인자다.
 *
 * ```asm
 * 0x29A55  ebx = 인덱스 × 15                      ; eax*16 − eax
 * 0x29A60  [유닛+0x40..0x43] = 표[+0..+3]         ; 힘 · 민첩 · 지력 · ?
 * 0x29A7E  [유닛+0x44] = [유닛+0x40] × 2          ; 공격력
 * 0x29A8E  [유닛+0x46] = word[인덱스 × 8 + 0x71B68]
 * 0x29A9C  [유닛+0x54] = [유닛+0x42] + word[인덱스 × 8 + 0x71B6C]
 * 0x29AAD  [유닛+0x48] = [유닛+0x4C] = 표[+4] × 1000    ; ★ HP
 * 0x29AC9  [유닛+0x50] = [유닛+0x52] = 표[+5] × 10      ; ★ TP
 * 0x29B2C  [유닛+0x2E..0x33] = 표[+6..+11]        ; 여섯 칸 (저항/스킬로 추정 — 미확인)
 * 0x29B73  [유닛+0x12] = [시전자+0xF] + 10        ; 소환자 코드
 * 0x29B86  [유닛+0x61] = 직업 번호(bx 인자)
 * 0x29BC2  [유닛+0x60] = 0x1198D(직업) → 스프라이트 번호
 * ```
 *
 * 인덱스와 직업 번호는 **따로** 온다 — `0x2B7C7` 화염5 `ecx=7, ebx=0x5A(90)` ·
 * `0x2B897` 빙한5 `ecx=8, ebx=0x59(89)`.
 *
 * ★ **스프라이트는 `[0x7502D + 직업]` 표**를 거친다(`0x114EF`). 그 표는 **BSS** 라
 *   원본이 런타임에 캐릭터 레코드로 채운다 — 우리도 원본 데이터에서 와야 한다.
 *   ☐ 지금은 실행기가 이미 들고 있는 직업→스프라이트 표를 쓰고, 시전자 것을 쓴다.
 *   ★★★ **2026-08-29 — 채우는 구조를 읽었다** (`0x2B6C0`~`0x2B6ED`)
 *     ```asm
 *     0x2B6C3  imul edx, edx, 0x23C   ; ★ **572** = 캐릭터 이미지 슬롯 한 칸
 *     0x2B6C9  mov eax, [edx+eax+0x666B1]
 *     0x2B6D6  cmp bx, 0x2C · jl …    ; ★ **44회** 루프  (572 = 13 × 44 와 맞물린다)
 *     0x2B6DF  mov eax,[ecx+0x5F] · sar 16   ; = [ecx+0x61] = **직업 번호**
 *     0x2B6ED  mov [eax+0x7502D], dl         ; ★ **[표 + 직업] = 스프라이트 번호**
 *     ```
 *     ⇒ 원본은 **캐릭터 레코드를 44칸 훑어** 직업마다 스프라이트를 심는다.
 *       우리가 직업→스프라이트 표를 들고 있는 것과 **구조가 같다**.
 *
 *   ★★★★★ **표의 진짜 주소는 `0xE502D` 다** (2026-08-29 정정)
 *     적용본에서 `0x2B6ED` 의 바이트는 `88 90 2d 50 0e 00`
 *     = `mov [eax + 0x000E502D], dl` 이다. 주석의 `0x7502D` 는 **fixup 전** 값이다.
 *     그 주소를 담은 자리는 **14곳** —
 *     `0x114FA` · `0x11597` · `0x11A10` · `0x11A23` · `0x11B07` · `0x11B12` ·
 *     `0x11BE0` · `0x11D35` · `0x2B68E` · `0x2B698` … (스프라이트를 고르는 자리들)
 *   ☐ 표 **내용**은 그 자리가 전부 `00` 이라 **BSS** 다 — 실행 중에 채워진다.
 *     ⇒ 값을 지어내지 않는다. 뜨려면 js-dos 로 메모리를 봐야 한다.
 */
/** 소환수 능력치표 `0x28359` — 인덱스당 15바이트. `[힘, 민첩, 지력, ?, HP÷1000, TP÷10, …]` */
var SUMMON_STAT = [
  [20, 0, 30, 0, 4, 0, 0, 0, 0, 0, 0, 0],
  [40, 0, 26, 10, 8, 0, 0, 0, 0, 0, 0, 0],
  [30, 0, 30, 0, 10, 0, 0, 0, 0, 0, 0, 0],
  [40, 0, 35, 0, 15, 0, 0, 0, 0, 0, 0, 0],
  [60, 0, 30, 0, 20, 0, 0, 0, 0, 0, 0, 0],
  [70, 30, 20, 0, 30, 10, 3, 3, 3, 0, 0, 0],
  [60, 30, 52, 0, 32, 10, 0, 0, 0, 0, 0, 0],
  [40, 60, 40, 0, 20, 20, 4, 0, 0, 0, 0, 0],   // 7 Salamanda
  [30, 70, 30, 0, 20, 20, 0, 4, 0, 0, 0, 0],   // 8 Marid
  [30, 50, 70, 0, 15, 20, 0, 0, 4, 0, 0, 0],   // 9 Jinn
  [30, 0, 35, 0, 8, 0, 0, 0, 4, 0, 0, 0]
];
/** `0x71B68` — 인덱스당 8바이트. `word[+0]` → `[유닛+0x46]`, `word[+4]` → `[유닛+0x54]` 가산 */
var SUMMON_AUX = [[60, 70], [80, 85], [100, 90], [75, 95], [90, 85], [85, 100],
                  [30, 40], [40, 50], [40, 55], [50, 60], [0, 20]];
/** 마법 직업 번호 → 능력치표 인덱스 (`0x2B7C7` 등 호출부 상수) */
var SUMMON_IDX = { 90: 7, 89: 8, 88: 9 };
/* 소환수 이름 — 직업표 `0x71118`.
 * ★ 원소계열 Lv5 의 셋(90·89·88)이 빠져 있어 「소환수」로 뜨고 있었다 (2026-08-15).
 *   화염5 Salamanda(90) · 빙한5 Marid(89) · 전격5 Jinn(88) — `연출_나머지계열.md` 「소환 계열」.
 *   사용자 확인: 화염5 「샐러맨더를 소환해」 · 빙한5 「마리드를 소환해」. */
/* ★★★★★ **이름은 원본 표 그대로다** — `0x71118 + job × 16` (2026-09-01 대조)
 *
 *   110 칸(job 0~109) · 영문 NUL 종료. `CHP.EXE` 직업 이름표(`0x88788 + 번호×16`)와
 *   **같은 규격**이고 앞 52 칸이 똑같다 — 곧 **직업과 몬스터가 한 표**다.
 *   접근 코드 `0x11E99  mov ebx, 0x38788 ; shl eax, 4 ; add ebx, eax` (`+0x50000` fixup).
 *   검산: `Goblin`(job 63) → `0x71508` = `0x71118 + 63×16` ✅
 *
 *   ☠ **둘이 원본과 달랐다 (2026-09-01 고침)**
 *     `83` `Golem` → **`Fire Golem`** · `88` `Jinn` → **`Djinni`**
 *     나머지 여덟은 원본과 정확히 같았다.
 *   ★ **골렘 소환은 `Fire Golem` 하나뿐**이다 — `84 Ice Golem`·`85 Thunder Golem`·
 *     `86 Dark Golem`·`87 Dao` 는 **이름표에만 있고 싣는 자리가 없다**(마법 대역 전수).
 *     싣는 자리는 넷뿐 — `0x2BFCA mov ebx,83` · `0x2B98B 88` · `0x2B89C 89` · `0x2B7CC 90`.
 *   ★ **마법 이름표와 다른 표다** — 고를 때 뜨는 글은 `magicnames.js`(`0x7423C`)이고
 *     거기서는 원본도 `Golem` 이다. **섞지 말 것.**
 *   ☠ 두 EXE 이름표는 **job 93·118·119 세 칸이 다르다** — 전투는 **COMBATII 표**를 쓴다. */
var SUMMON_NAME = { 76: 'Bat', 72: 'Slime', 63: 'Goblin', 65: 'Orc', 67: 'Ogre', 83: 'Fire Golem', 82: 'Gargoyle',
                    90: 'Salamanda', 89: 'Marid', 88: 'Djinni' };

/**
 * ★★★★★ **소환수 유닛 이름 — 원본/한글 토글** (2026-09-02 · 리마스터 I-10)
 *
 *   사용자 지정 — 「원본 방식인 **소환수 고정**과 리마스터 개선방식인 **본래 이름**
 *   둘 다 적용하고 **토글로 전환**」 · 「**영문 말고 한글로** 바꾸어서」.
 *
 *   ── 원본 모드 ────────────────────────────────────────────────────
 *   원본은 **어떤 소환수든 유닛 이름이 「소 환 수」** 다 —
 *   `0x29A2E esi = 0x776E4`(조합형) → `0x29A3C movsd·movsd·movsb` 로
 *   `[유닛+2]` 부터 **9 바이트**를 덮는다.
 *
 *   ── 리마스터 모드 (아래 표) ──────────────────────────────────────
 *   ☠ **한글 이름은 원본에 없다.** `0x71118` 표는 **영문뿐**이라 이것은 **우리가 지은 것**이다
 *     (`리마스터_적용현황.md` **I-10**).
 *   ★ **자간은 원본 규칙을 따른다** — 원본 「소 환 수」가 `16+8+16+8+16` = **64 px** 이므로
 *     한글 이름도 **64 px 로 맞춘다**(한글 16 px · 공백 8 px):
 *       2 글자 `한␣␣␣␣한`(16+32+16) · 3 글자 `한␣한␣한`(16+8+16+8+16) · 4 글자 `한한한한`(64)
 *     ⇒ 전부 **8 B + NUL = 9 B** 로 원본 칸에도 들어간다.
 *     (캐릭터 이름은 **72 px** 기준이라 다르다 — `연출_소환_원본확정.md` 참조.)
 */
/* ★★★★★ **소환수 스프라이트 번호** — 원본이 **진입점마다 상수로 박아** 넘긴다
 *   (2026-09-02 · 전문 `COMBATII/스프라이트_슬롯표_0xE502D.md`)
 *
 *   `0x2BF59`~`0x2BFD6` 과 `0x2B7C0`·`0x2B892`·`0x2B981` 에 **같은 꼴이 열 개**다:
 *   ```asm
 *   push ebx ; push ecx
 *   **push <스프라이트 번호>**       ; → [esp+0xCC] → 0x29B86 `mov [ebp+0x61], ax`
 *   **mov ecx, <소환 번호 0~9>**
 *   **mov ebx, <직업 번호>**
 *   jmp 0x2B7D1                     ; (박쥐만 `xor ecx,ecx` 뒤 `jmp 0x2B7D4`)
 *   ```
 *   ☠ **표에서 찾는 것이 아니다** — 소환 마법마다 **전용 진입점**이 있다.
 *     `0x7502D`(= `0xE502D`)는 **슬롯 점유 표**(`0xFF` = 빈 칸)이지 대응표가 아니었다.
 *
 *   ★ 번호가 두 무리로 갈린다 —
 *     `109`·`111`·`114`·`128` 은 **첫 표**(`0x70024` · 0~224) = **일반 몬스터 그림**
 *     `366`·`367`·`371`·`374`·`375`·`378` 은 **둘째 표**(`0x703A8` · 300~426) = **소환 전용** */
var SUMMON_SPR = {
  76: 114,   // 0  박쥐        0x2BF5B push 0x72
  72: 128,   // 1  슬라임      0x2BF6E push 0x80
  63: 109,   // 2  고블린      0x2BF84 push 0x6D
  65: 111,   // 3  오크        0x2BF97 push 0x6F
  67: 375,   // 4  오우거      0x2BFA8 대역
  83: 371,   // 5  골렘        0x2BFC0 대역
  82: 367,   // 6  가고일      0x2BFD6 대역
  90: 378,   // 7  샐러맨더    0x2B7C2 push 0x17A
  89: 374,   // 8  마리드      0x2B892 push 0x176
  88: 366    // 9  진니        0x2B981 push 0x16E
};

/* 소환 직업의 그림 선택은 생성 객체와 지연 준비 보고가 같은 경로를 쓴다. */
function summonSpriteIndex(job, fallback) {
  return (SUMMON_SPR[job | 0] != null) ? SUMMON_SPR[job | 0] : fallback;
}
function uniqueSpriteIndices(units) {
  var out = [];
  (units || []).forEach(function (u) {
    var id = u && u.sprIndex;
    if (id == null || !isFinite(Number(id))) return;
    id = Number(id) | 0;
    if (out.indexOf(id) < 0) out.push(id);
  });
  return out;
}

var SUMMON_NAME_KO = {
  76: '박    쥐',      /* Bat        2 글자 — 사이 공백 4 */
  65: '오    크',      /* Orc        2 */
  83: '골    렘',      /* Fire Golem 2 (「화염골렘」은 4 자라 64 px 를 넘는다) */
  88: '진    니',      /* Djinni     2 */
  63: '고 블 린',      /* Goblin     3 — 사이 공백 1 */
  67: '오 우 거',      /* Ogre       3 */
  82: '가 고 일',      /* Gargoyle   3 */
  89: '마 리 드',      /* Marid      3 */
  72: '슬 라 임',      /* Slime      3 */
  90: '샐러맨더'       /* Salamanda  4 — 자간 0 */
};
/** 원본 이름 — `0x776E4` 조합형 「소 환 수」. 어떤 소환수든 이것이다. */
var SUMMON_NAME_원본 = '소 환 수';

/**
 * ★ [리마스터 **I-12**] 소환수를 **플레이어가 직접 조작**하나 (2026-09-02 · 지적 5-6).
 *
 *   원본은 **아군 소환수도 AI 가 잡는다** — `0x29BAF cmp byte [eax+0xE], 1` →
 *   `0x29BB5 mov byte [ebp+0x83], 2`. 사용자가 「**둘을 선택할 수 있는 게 좋겠어**」라
 *   했으므로 토글을 둔다. **기본은 `'원작'`(AI)** 이다 — `CLAUDE.md` §6.
 *   ★ `summonName()` 과 **같은 창구·같은 판정 방향**이다(기본 꺼짐이라 `=== '리마스터'`).
 */
function 소환수직접조작() {
  var c = root.Opt && root.Opt.cfg;
  return !!(c && c.소환수조작 === '리마스터');
}

/** 지금 켜진 모드로 소환수 이름을 고른다. 토글이 없으면 **원본**이다. */
function summonName(job) {
  /* ★ 다른 토글과 **같은 창구**를 쓴다 — `controller.js:1365 _마법사원거리켜짐()` 과 같은 꼴.
   *   ☠ 기본이 **꺼짐**(원작)이라 판정 방향이 마법사 쪽과 반대다:
   *     마법사 원거리는 기본 켜짐이라 `!== '원작'` 으로 보지만,
   *     이것은 기본 꺼짐이라 **`=== '리마스터'` 일 때만** 켠다. */
  var c = root.Opt && root.Opt.cfg;
  if (!(c && c.소환수한글 === '리마스터')) return SUMMON_NAME_원본;   // 0x29A2E
  return SUMMON_NAME_KO[job | 0] || SUMMON_NAME_원본;
}
/**
 * ★★ 소환 자리 — **시전자 방향 기준 정면 → 옆 → 반대쪽 옆.** 원본 `0x29C5A` 직독(2026-08-15).
 *
 * ```asm
 * 0x29C80  mov al, [ecx+0x63]         ; dirs[0] = 시전자 방향            ← 정면
 * 0x29C83  mov [edx], al
 * 0x29C85  cmp bx, 1 ; jle 0x29CA1    ; ebx <= 1 이면 여기서 끝
 * 0x29C8B  edx = [ecx+0x60] >> 24
 * 0x29C91  inc edx ; ebx = 4 ; idiv   ; dirs[1] = (방향 + 1) % 4         ← 한쪽 옆
 * 0x29CA1  cmp [esp+4], 2 ; jle       ; ebx <= 2 면 여기서 끝
 * 0x29CAF  add edx, 3 ; idiv 4        ; dirs[2] = (방향 + 3) % 4         ← 반대쪽 옆
 * 0x29CC5  루프 si = 0 … [esp+4]      ; 자리 수 = ebx
 * 0x29CE4    call 0x49ABC(좌표, dirs[si])  ; 그 방향 인접 칸
 * 0x29CF7    call 0x13CBD(x, y) ; jl → 건너뜀   ; 못 놓는 칸
 * 0x29D14    call 0x13D02(x, y, 0x3E8)          ; 표시 배열에 1000 = 후보 칸
 * ```
 *
 * 사용자 확인(2026-08-15): 「소환영역은 **1클 정면, 2클 정면+좌측**(또는 우측,
 * 확인해봐야해), **3클 정면+좌측+우측**」 — `dirs` 배열이 **3칸뿐**이고 루프가
 * `ebx` 번 도는 것과 정확히 맞는다.
 *
 * ★ **`ebx` 는 `rank + 1` 이다** (`0x29F68 mov ebx,[esp+8]` → `0x29F6C add ebx,edx`,
 *   `edx = 1`). 진입 `edx` 를 class(1~3)로 읽으면 2·3·4 가 되어 **자리가 3칸뿐인 것과
 *   어긋난다.** 곧 진입값은 **rank(0~2)** 이고 자리 수는 **1·2·3** 이다.
 *   → `미확정_규명.md §1` 의 「`0x29F6C add ebx,1` → 1클2·2클3·3클4」는 **틀렸다**
 *     (그 문서에 되돌려 적을 것).
 *
 * ★ 착탄점을 **안 고른다** — `0x29F4D` 에 칸 선택기 호출이 없다. 후보 칸을 칠하고
 *   `0x29FC6 call 0x4A815` 로 확인만 받는다(취소하면 −1). 그래서 `magicPick` 이 `'none'`.
 */
function summonTiles(battle, u, target, count, 대형, 옵션) {
  var out = [];
  var d0 = (u.dir | 0) & 3;
  /* ★★★★★ **대형 몬스터는 좌·우 둘뿐이다** (2026-09-08 · 사장님 지적 M29)
   *   > 「오거, 골렘, 가고일 … 다른 소환이 **전, 우, 좌** 라면 대형몬스터는 **좌, 우**」
   *
   *   원본은 소환수 인덱스로 자리 잡는 함수를 갈라 부른다 —
   *   ```asm
   *   0x29F77  cmp cx,4 ; jl  → 깃발 0
   *   0x29F7D  cmp cx,6 ; jle → ★ 4~6 이면 깃발 유지
   *   0x29F9C  call 0x29C5A   ;   보통 자리
   *   0x29FAE  call 0x29D88   ;   대형 자리
   *   ```
   *   두 함수가 넣는 방향이 다르다 —
   *   ```asm
   *   보통 0x29C91 inc edx (+1 우) · 0x29CAF add edx,3 (+3 좌) · 기본 0 (앞)
   *   대형 0x29DAF mov byte [edx],1 (+1 우) · 0x29DB4 mov byte [edx+1],3 (+3 좌)
   *   ```
   *   인덱스 4·5·6 은 직업 이름표(`0x71118 + job×16`)로 읽어
   *   **Ogre · Fire Golem · Gargoyle** 임을 확인했다. */
  /* ☠★★★★★ **대형은 «절대» 왼쪽·오른쪽이다 — 시전자 방향과 무관** (2026-09-15)
   *   ```asm
   *   소형 0x29C91  inc edx        (+1)  ; ★ 시전자 방향에 **더한다** = 상대
   *        0x29CAF  add edx, 3     (+3)
   *   대형 0x29DAF  [edx]   = 1          ; ★ 값을 **박는다** = 절대
   *        0x29DB4  [edx+1] = 3
   *   ```
   *   `0x49ABC` 방향표 — `0` y+1(아래) · **`1` x−1(왼쪽)** · `2` y−1(위) · **`3` x+1(오른쪽)**
   *   ⇒ 대형은 **왼쪽 먼저, 그다음 오른쪽**. 「1~2클 좌측 · 3클 좌+우」(`마법_타게팅_사양.md`)와 맞는다.
   *   ☐ 마릿수 — `0x29F6C` 는 「클래스+1」인데 `0x29E6D cmp di,2` 는 **늘 두 번** 돈다.
   *     둘이 어긋난다(`소환수_생성_0x299DA.md` 도 같은 것을 적어 두었다). 여기서는
   *     부르는 쪽이 준 `count` 를 그대로 따른다 — 바꿀 근거를 아직 못 찾았다. */
  var 왼 = 1, 오 = 3;                                  // 0x49ABC 표 — 절대 방향 번호
  var dirs = 대형 ? [왼, 오]                            // 0x29DAF · 0x29DB4
                  : [d0, (d0 + 1) & 3, (d0 + 3) & 3]; // 0x29C83 · 0x29C91 · 0x29CAF
  /* ☠★★★★★ **대형은 마릿수가 3 이상일 때만 «두» 자리다** (2026-09-15 · EXE 직독)
   *   > 사장님: 「우리 실행기 **대형몬스터 소환 마릿수 원본에 맞춰**줘」
   *   ```asm
   *   0x29D8B  89 5c 24 04         mov  [esp+4], ebx        ; ★ ebx = 마릿수
   *   0x29E64  66 83 7c 24 04 03   cmp  word [esp+4], 3     ; ★ 3 보다 작으면
   *   0x29E6A  7c 0b               jl   +11                 ;   ↓ 열한 바이트를 건너뛴다
   *   0x29E6C  47                  inc  edi                 ;   (= 둘째 자리를 안 만든다)
   *   0x29E6D  66 83 ff 02         cmp  di, 2
   *   0x29E71  0f 8c 46 ff ff ff   jl   0x29DBD
   *   ```
   *   `jl +11` 이 `inc`(1) + `cmp`(4) + `jl`(6) = **정확히 11바이트**를 건넌다.
   *   마릿수 = 클래스 + 1(`0x29F6C add ebx,edx`)이므로 —
   *     클래스 0·1 (마릿수 1·2) → **왼쪽 한 자리**
   *     클래스 2   (마릿수 3)   → **왼쪽 + 오른쪽 두 자리**
   *   `마법_타게팅_사양.md` 「5~7 소환(대형) **1~2클=좌측 · 3클=좌+우**」와 맞는다. */
  if (대형 && (count | 0) < 3) dirs = [왼];             // 0x29E64 cmp [esp+4],3 / jl
  /* ★★★★★ **대형은 «두 칸» 밀어 놓는다** (2026-09-15 · 원본 0x29DDF + 0x29DFF)
   *   ```asm
   *   0x29DDB  movsx ebx,[esi+ebp]   ; 방향
   *   0x29DDF  call 0x49ABC          ;   한 칸
   *   0x29DFB  movsx ebx,[esi+ebp]   ; ★ **같은 방향으로**
   *   0x29DFF  call 0x49ABC          ;   **또 한 칸** — 모두 두 칸
   *   0x29E12  call 0x13CBD / jl     ;   두 칸 다 유효한지 검사
   *   ```
   *   소형(`0x29C5A`)은 한 칸이다. */
  var 걸음 = 대형 ? 2 : 1;
  /* ☠★★★★★ **대형은 «두 칸»을 차지한다 — 표시도 두 칸이어야 한다** (2026-09-15)
   *
   *   > 사장님: 「대형유닛 소환마법 시전시 소환 영역이 **실제 소환되어서 자리를
   *   >  차지하는 두칸으로** (`XXO`, X는 영역, O는 시전자) 표시되어야해.
   *   >  지금은 **한칸만** 표시돼 (`XNO`, N은 표시 없음)」
   *
   *   ☠ 여기서 `걸음 = 2` 로 **먼 칸 하나만** 담고 있었다. 그래서 시전자 바로 옆
   *     (가까운 칸)이 빈 채로 그려져 `X N O` 가 됐다.
   *   ★ 원본은 같은 방향으로 **두 번** 걸어 두 칸을 잡고, 둘 다 유효한지 본다 —
   *     `0x29DDF`(한 칸) → `0x29DFF`(또 한 칸) → `0x29E12 call 0x13CBD / jl`.
   *     바로 위 주석이 이미 그렇게 적어 두었는데 **가까운 칸을 안 담고 안 봤다.**
   *
   *   ⇒ ① **가까운 칸도 비어 있어야** 그 자리를 후보로 친다 (`0x29E12`)
   *     ② `옵션.발자국` 을 주면 anchor와 둘째 점유칸을 함께 돌려준다.
   *        좌측은 먼 anchor + 가까운 x−1, 우측은 가까운 x+1 anchor + 먼 x+2다.
   *   ★ `count` 는 **자리 수**다. 발자국은 세지 않는다 — 안 그러면 마릿수가 반으로 준다. */
  var 발자국 = !!(옵션 && 옵션.발자국);
  /* ★★★★★ «못 놓는 칸» = 시전자 이동 범위(예산 12) 밖 — 원본 0x29C68 0x14300(0xC) 예산 12 · 0x14032+0x143F3 이동 범위 →
   *   0x29CF7/0x29E12 call 0x13CBD(이동 배열) · jl(음수)이면 건너뜀 (2026-09-26 사장님 「소환마법이 이동불가 타일에 걸쳐있으면 해당 칸이 나오면 안돼」
   *   · 「원본은 이동 불가영역이 포함된 왼쪽은 나오지 않고 아군 캐릭터가 있는 오른쪽에만 소환영역이 표시돼. 원본의 경우 실제 소환은 되지 않고」)
   *   ⇒ 이동불가 지형·적이 선 칸은 빠지고, 아군이 선 칸은 «지나갈 수 있어» 후보로 남는다(move.js ③). 실제로 세울 때는 빈 칸만(옵션.빈칸만).
   *   ☠ 예전: 유닛이 선 칸만 빼고 지형은 안 봐서 정반대(이동불가 쪽 표시 · 아군 쪽 빠짐)였다. */
  var 이동 = null;
  var 옛규칙 = !!(옵션 && 옵션.옛규칙);   /* 소울리콜 자리 — 원본 규칙을 아직 안 봤다. 예전대로(빈 칸 · 세 방향) */
  /* 정본 291 — 예산은 대형 24 · 보통 12: 원본 대형 자리 0x29D97 mov eax,0x18 → 0x29D9C call 0x14300 · 보통 0x29C68 0x14300(0xC)
   *   ☠ 둘 다 12 로 써서 두 칸 떨어진 대형 자리가 자갈(보행 비용 10) 같은 지형에서 늘 탈락 — 대형 소환 마법이 자리 표시 없이 링으로 돌아갔다
   *   (사장님 11-19 버그신고 42-0A «대형몬스터 소환 안됨. 시전시 자리표시 나오지 않고 바로 링커맨드로 복귀함.» · 「다른 몬스터는 소환되는데 지금 대형몬스터만 안된다고!」) */
  try { if (!옛규칙 && root.G2Move && root.G2Move.range && battle.W) 이동 = root.G2Move.range(battle, u, { budget: 대형 ? 24 : 12 }); } catch (e이동) { 이동 = null; }
  function 놓나(px, py) {
    if (!inMap(battle, px, py)) return false;
    if (이동) return 이동.left[py * battle.W + px] >= 0;                      // 0x13CBD ≥ 0
    if (옛규칙) return !(battle.at && battle.at(px, py));                    // 소울리콜 — 예전 규칙
    return true;                                                             // G2Move 없는 환경(시험) — 지형은 못 보고, 점유는 «빈칸만»이 본다
  }
  var 비울 = (옵션 && 옵션.비울유닛) || [];   /* 다시 소환하면 치워질 옛 소환수 칸은 빈 칸으로 본다(0x29EE4 치우기가 세우기 앞) */
  function 비었나(px, py) { var q = battle.at && battle.at(px, py); return !q || 비울.indexOf(q) >= 0; }
  var 빈칸만 = !!(옵션 && 옵션.빈칸만);
  /* 소형은 앞에서부터 «마릿수» 개 방향만 본다 — 0x29D1A cmp si,[esp+4] / jl. 못 쓰는 방향이 있어도 다른 방향으로 넘기지 않는다 */
  var 볼방향 = (대형 || 옛규칙) ? dirs.length : Math.min(dirs.length, count | 0);
  var 앵커수 = 0;
  for (var i = 0; i < 볼방향 && 앵커수 < count; i++) {
    var d = DIR[dirs[i]];
    var x = u.x + d.dx * 걸음, y = u.y + d.dy * 걸음;
    if (!놓나(x, y)) continue;                         // 0x29CF7 · 0x29CFF jl → 못 놓는 칸은 건너뜀
    if (빈칸만 && !비었나(x, y)) continue;
    var nx = u.x + d.dx, ny = u.y + d.dy;              // 가까운 칸 (대형이 함께 차지한다)
    if (대형) {                                        // 0x29E12 — 두 칸 다 봐야 한다
      if (!놓나(nx, ny)) continue;
      if (빈칸만 && !비었나(nx, ny)) continue;
    }
    /* 원본 0x2A151 dec eax: 오른쪽 대형 후보의 생성 anchor는 farX−1.
     * 생성 유닛의 2×1 발자국은 anchor와 anchor+1 이므로 x=8 기준 9·10을 채운다.
     * 위쪽 near/far 충돌 검사는 변경하지 않는다. */
    if (대형 && dirs[i] === 3) x--;
    if (out.some(function (t) { return t.x === x && t.y === y; })) continue;
    out.push({ x: x, y: y });
    앵커수++;
    var footprintX = 대형 ? x + 1 : nx;
    if (대형 && 발자국 && !out.some(function (t) { return t.x === footprintX && t.y === y; }))
      out.push({ x: footprintX, y: y, 발자국: true });        // ★ 표시 전용 — 놓는 자리가 아니다
  }
  return out;
}
/**
 * 이 소환 마법을 지금 쓸 수 있나 — 세울 빈 칸이 하나라도 있나 (2026-09-26 사장님 「소환도 그래야할 것 같아. 소환할 수 없는 상황에서는 그렇게 되어야 해」)
 *   컨트롤러가 마법을 고르는 순간 보고, 없으면 확인 클릭 없이 곧바로 링으로 돌린다(리바이블 대상 없음과 같은 길).
 *   자리 규칙은 cast 의 소환 갈래와 같다(summonTiles · 빈칸만). 소울리콜·소환이 아닌 마법은 늘 참.
 */
/* [리마스터 조련소환] 조련사 레벨에 가장 가까운 대본 기록 (taming_summon_table 칸의 기록들) */
function 조련기록고르기(조칸, 조lv) {
  var 조기록 = null, 조차 = 1e9;
  ((조칸 && 조칸.기록) || []).forEach(function (r) { var d = Math.abs((r['레벨'] | 0) - (조lv | 0)); if (d < 조차) { 조차 = d; 조기록 = r; } });
  return 조기록;
}
/* [리마스터 조련소환] 세울 자리 후보 — 마법 소환과 같은 «정해진 자리»(원본 0x29F4D 는 칸 선택기 없이 후보를 칠하고 0x4A815 로 확인만)
 *   보통 몸 = 정면 칸(원본 조련과 같은 칸) · 큰 몸(그림 300 이상: 오거·오거로드·와이번·블랙와이번) = 마법 대형 소환 자리(summonTiles 대형 — 왼쪽, 마릿수 1)
 *   (사장님 11-07 「다 불러야해 오거도 큰몸이야. 일반 소환처럼 처리해줘.」 · 11-15 「소환마법처럼 자리를 지정해서 나와야하는데 자리가 애매해」 · 정본 208) */
/* 정본 292 — 그림 자료가 아직 안 실렸을 때를 위한 2×2 큰 몸(와이번 382 · 블랙와이번 383 = WYV-A·WYV-D.BCR · 머리 발자국 실측 2×2) */
var 조련넷칸 = { 382: 1, 383: 1 };
function 조련자리후보(battle, u, 조기록) {
  if (!battle || !u || !조기록) return [];
  /* 정본 292 — 큰 몸은 소환 마법 대형처럼 두 칸(앵커 + 발자국)을 칠한다 · 발자국 칸엔 짝 앵커를 단다(눌러도 그 자리로)
   *   ☠ 발자국 옵션 없이 앵커 한 칸만 내 블랙와이번·오거 같은 큰 몸이 «한 칸»으로 보였다 (사장님 11-19 「블랙와이번 대형 아니야? 그런데 왜 발자국 1칸이야」) */
  if ((조기록['스프라이트번호'] | 0) >= 300) {
    var 앞앵 = null, 큰칸 = summonTiles(battle, u, null, 1, true, { 빈칸만: true, 발자국: true }).map(function (c) { if (!c.발자국) { 앞앵 = { x: c.x | 0, y: c.y | 0 }; return 앞앵; } return { x: c.x | 0, y: c.y | 0, 발자국: true, 앵커: 앞앵 }; });
    /* 정본 292 — 와이번·블랙와이번은 2×2(그림 머리 실측: WYV-A·WYV-D.BCR 네 방향 모두 2×2 · 오거·골렘·가고일은 2×1/1×2)
     *   격자는 앵커에서 오른쪽·위로 차지한다(state cellsOf: x~x+1 · y~y−1) — 위 줄 두 칸도 비고 맵 안이어야 세우고, 네 칸을 칠한다
     *   [리마스터] 원작엔 와이번 소환이 없어 자리 규칙이 없다 — 일반 대형 자리(왼쪽 두 칸)에 위 줄을 더한 것 (사장님 11-19 「와이번 2*2라고 안했어? 그럼 일반 대형과 좀 다른데?」) */
    var 번조 = 조기록['스프라이트번호'] | 0, 발조 = null;
    try { 발조 = battle.footOf ? battle.footOf({ sprIndex: 번조, dir: 0 }) : null; } catch (e발) { 발조 = null; }
    if ((발조 && 발조[0] >= 2 && 발조[1] >= 2) || 조련넷칸[번조]) {
      var 넷 = [];
      큰칸.filter(function (c) { return !c.발자국; }).forEach(function (a) {
        var 위 = [{ x: a.x, y: a.y - 1 }, { x: a.x + 1, y: a.y - 1 }];
        if (!위.every(function (c) { return inMap(battle, c.x, c.y) && !(battle.at && battle.at(c.x, c.y)); })) return;
        넷.push(a, { x: a.x + 1, y: a.y, 발자국: true, 앵커: a }, { x: 위[0].x, y: 위[0].y, 발자국: true, 앵커: a }, { x: 위[1].x, y: 위[1].y, 발자국: true, 앵커: a });
      });
      return 넷;
    }
    return 큰칸;
  }
  var fd = DIR[u.dir & 3], x = (u.x | 0) + fd.dx, y = (u.y | 0) + fd.dy;
  if (!inMap(battle, x, y) || battle.at(x, y)) return [];
  if (battle.moveCost && battle.moveCost(x, y, 0) <= 0) return [];
  return [{ x: x, y: y }];
}
/** 컨트롤러용 — 목록 창에서 고른 칸(조련고름)의 자리 후보 */
function 조련후보칸(battle, u, 고름) {
  var 표 = root.G2조련소환표; if (!표 || !u) return [];
  var lv = u.level | 0, 칸 = (고름 != null && 표[고름 | 0]) || 표.filter(function (k) { return lv <= (k.까지 | 0); })[0] || 표[표.length - 1];
  return 조련자리후보(battle, u, 조련기록고르기(칸, lv));
}
function 소환자리있나(battle, u, spellNo) {
  var p = spellParts(spellNo | 0);
  var eRow = p.level, eRank = clamp(p.rank, 0, 2);
  var 원소소환 = (p.series <= 2 && eRow === 4);
  if (!(p.series === 5 || 원소소환)) return true;
  var job = 원소소환 ? [90, 89, 88][p.series] : [76, 72, 63, 65, 67, 83, 82][eRow];
  var 번 = SUMMON_IDX[job]; if (번 == null) 번 = Math.max(0, [76, 72, 63, 65, 67, 83, 82].indexOf(job));
  return summonTiles(battle, u, null, eRank + 1, (번 >= 4 && 번 <= 6), { 빈칸만: true, 비울유닛: collectReplacedSummons(battle, u) }).length > 0;
}
/* 원본 0x29EE4는 소환자 진영의 [+0x12] 표식이 맞는 살아 있는 유닛을 순회한다.
 * 스냅샷은 cast 보고에 담고, commit 시점에 그 참조만 0x463FB→0x11EE4 점유 해제 후 목록에서 뺀다.
 * 사망명부는 유지한다. 이 제거는 일반 격파가 아니므로 XP·S4·kill 처리를 호출하지 않는다. */
function collectReplacedSummons(battle, u) {
  var tag = (u.charCode | 0) + 10, side = u.side | 0;
  return (battle.units || []).filter(function (q) {
    return q && q !== u && q.alive && (q.side | 0) === side &&
      (q.summonerTag | 0) === tag;
  });
}
function removeReplacedSummons(battle, u, refs) {
  var removed = 0;
  (refs || []).forEach(function (q) {
    if (!q || !q.alive || (q.side | 0) !== (u.side | 0) ||
        (q.summonerTag | 0) !== ((u.charCode | 0) + 10)) return;
    dropTargetRefs(battle, q);                           // 0x29F32 → 0x1DAEE
    if (battle.unplace) battle.unplace(q);               // 0x463FB → 0x11EE4
    q.hp = 0; q.alive = false; q.dead = true; 사망상태지우기(q);   /* 정본 176 */
    var i = (battle.units || []).indexOf(q);
    if (i >= 0) battle.units.splice(i, 1);              // 0x29F44 call 0x113CC
    removed++;
  });
  if (removed && battle.log) {
    try { battle.log('소환수 ' + removed + '이 사라졌다'); } catch (e) {}
  }
  return removed;
}
/**
 * ★ God(칼스 그림 0x19E) 소환 — 0x4434D~0x44526 (2026-09-29)
 *   0x112FD 새 레코드 · 0x61E59 신 레코드 0x88 바이트를 그대로 복사한 뒤 덮는다:
 *   이름 0x77BFA 「소 환 수」 · [+0x11] 직업 0x5F · [+0xD] 1 · 힘 0x78 · 민첩 0x64 · 지력 0x50 · 권위 0xA ·
 *   공격 = 힘×2 · 방어 = 표 0x71B68[0x5F].word0(100) · 마방 = 지력 + word4(100) · HP·최대HP 100000 · MP 0 ·
 *   [+0x56] 0 · 집중 0 · [+0x13]·[+0x1E](와 [+0x14]·[+0x15]) 0 · 마법 랭크 6칸 0 · 그림 0x182 · 모션 0 ·
 *   [+0x7F] 0 · [+0x80] 0xFF · [+0x12] = 신[+0x0F] + 10 · 신의 편 목록에 넣고(0x44498 0x1134F) 칸 점유(0x44521 0x11E04).
 *   ☐ [+0x6F]·[+0x71]=0xFF · [+0x73]·[+0x6B]·[+0x6C~0x6E]·[+0x67]·[+0x63] 은 우리 필드와 맞대 보지 못했다 — 복사본 그대로 둔다
 */
function 신소환(battle, god, x, y) {
  var m = Object.assign({}, god);
  var ids = (battle.units || []).map(function (q) { return q.id | 0; });
  m.id = (ids.length ? Math.max.apply(null, ids) : 0) + 1;
  m.name = '소 환 수'; m.job = 0x5F; m.race = 1;                           // 0x44367 · 0x4437E · 0x44382
  m.x = x | 0; m.y = y | 0; m.dir = god.dir | 0; m.alive = true; m.dead = false;
  m.힘 = 0x78; m.민첩 = 0x64; m.지력 = 0x50;                             // 0x44386~0x4438E
  var 방어 = 100, 마방 = 0x50 + 100;                                      // 0x443A4 [0x71E60] · 0x443AE [0x71E64]
  m.base = Object.assign({}, god.base || {}, { atk: 0x78 * 2, def: 방어, mr: 마방, cha: 0xA });
  m.eff = Object.assign({}, god.eff || {}, { atk: 0x78 * 2, def: 방어, mr: 마방, cha: 0xA });
  m.cha = 0xA;                                                            // 0x4439A [+0x43]
  m.hp = 100000; m.maxHp = 100000;                                        // 0x443B4 · 0x443F0
  m.mp = 0; m.maxMp = 0;                                                  // 0x443BB · 0x443F7
  m.waitCount = 0; m.chargeTp = 0;                                        // 0x443C1 · 0x443C5
  m.f13 = 0; m.f14 = 0; m.f1e = 0; m.f15 = 0; m.ailment = 0;              // 0x443CB~0x44404
  m.buff = { atk: 0, def: 0, mr: 0, maxTp: 0 }; m.mbuff = {};
  m.st = god.st ? JSON.parse(JSON.stringify(god.st)) : god.st;
  m.sprIndex = 0x182; m.motion = 0;                                       // 0x44429 · 0x4442F
  m.reserveSpell = 0; m.reserveSpecial = 0;                               // 0x4443A [+0x81]→[+0x7F]
  m.ai = Object.assign({}, god.ai || {}, { magic: 0xFF });                // 0x44443 [+0x82]→[+0x80]
  m.summonerTag = (god.charCode | 0) + 10;                                // 0x44441 · 0x4444A [+0x12]
  m.summoned = true;
  m.magicLv = [0, 0, 0, 0, 0, 0, ((god.magicLv || [])[6]) | 0];           // 0x44412~0x44420 [+0x2E..+0x33] 여섯 칸만 (일곱째는 복사본)
  battle.units.push(m);                                                   // 0x44498 0x1134F
  if (battle.place) battle.place(m, m.x, m.y, m.dir);                     // 0x44521 0x11E04
  else if (battle.setAt) battle.setAt(m.x, m.y, m);
  return m;
}
function summonUnits(battle, u, job, target, count, rng) {

  /* ★ 대형(오거·골렘·가고일)은 자리가 다르다 — `0x29F77 cmp cx,4` · `0x29F7D cmp cx,6` */
  var _idx0 = SUMMON_IDX[job];
  if (_idx0 == null) _idx0 = Math.max(0, [76, 72, 63, 65, 67, 83, 82].indexOf(job));
  var _대형 = (_idx0 >= 4 && _idx0 <= 6);              // 0x29F77 · 0x29F7D
  var made = [], tiles = summonTiles(battle, u, target, count, _대형, { 빈칸만: true });   /* 실제로 세우는 것은 빈 칸만 — 아군이 선 후보 칸엔 안 나온다(사장님 관찰) */
  /* ★ 능력치는 **인덱스**로 찾는다 — 직업 번호와 다른 체계다 (`0x29F4D` 의 `cx` 인자).
   *   표에 없는 직업(구버전 소환수)은 인덱스 0 으로 떨어뜨린다. */
  var idx = SUMMON_IDX[job];
  if (idx == null) idx = Math.max(0, [76, 72, 63, 65, 67, 83, 82].indexOf(job));
  var st = SUMMON_STAT[idx] || SUMMON_STAT[0];
  var aux = SUMMON_AUX[idx] || SUMMON_AUX[0];
  var HP = st[4] * 1000;                                   // 0x29AAD  ×1000
  var TP = st[5] * 10;                                     // 0x29AC9  ×10
  for (var i = 0; i < tiles.length && made.length < count; i++) {
    var id = 1; while ((battle.units || []).some(function (q) { return q && q.id === id; })) id++;
    var m = {
      /* ★ 유닛 이름 — 원본은 「소 환 수」 고정(`0x29A2E`), 리마스터 토글이면 한글 이름.
       *   ☠ 영문 `SUMMON_NAME` 은 **직업 이름표**(`0x71118`)이지 유닛 이름이 아니다 —
       *     화면에 뜨는 이름과 섞지 말 것. (2026-09-02 · 리마스터 I-10) */
      /* ★ `race: 1`(마수·정령) — 원본 `0x29A5C mov byte [edx+0x0D], 1` 그대로다
       *   (2026-09-02 확인). 소환수는 시전자 사본이지만 **종족은 덮어쓴다.**
       *   ☐ `0x29B26 [edx+0x0D] = 2`(언데드) 갈래가 하나 더 있는데
       *     조건이 `0x29B20 cmp bx, 0x0A(10)` 이고 `bx = [esp+0xC8]` 이다.
       *     소환 번호는 **0~9** 뿐이라(박쥐~진니) **소환에서는 안 탄다** —
       *     이 함수를 다른 데서 쓸 때의 갈래로 보인다. **값을 지어내지 않는다.**
       *   ★★★★★ **2026-09-02 — 짐작이 틀렸다. 이 함수는 호출부가 하나뿐이다.**
       *     `EXE_함수머리찾기.js` — 머리 `0x299DA` · 다음 머리 `0x29C5A` ·
       *     **부르는 자리 1곳 `0x2A181`**. 곧 「다른 데서 쓸 때의 갈래」가 아니다.
       *   ★ 그리고 그 위에 **갈래가 하나 더** 있었다 —
       *     ```asm
       *     0x29B0A  8b 9c 24 c8 00 00 00   mov ebx, [esp+0xC8]   ; ★ 첫 스택 인자
       *     0x29B14  66 83 fb 06            cmp bx, 6
       *     0x29B18  75 06                  jne 0x29B20
       *     0x29B1A  80 4a 14 01            or byte [edx+0x14], 1 ; ★★ **비행 비트**
       *     0x29B20  66 83 fb 0a            cmp bx, 0x0A(10)
       *     0x29B26  c6 42 0d 02            mov byte [edx+0x0D], 2 ;   언데드
       *     ```
       *     `[+0x14]` 비트 1 이 **비행**인 것은 이미 확정돼 있다 —
       *     아래 `0x3B5B4`(비행 전환 · `[+0x14] ^= 1`) · `0x180D4`(탑승 시 끄기).
       *     `[esp+0xC8]` 이 첫 스택 인자인 것은 프레임으로 셈이 맞는다 —
       *     `0x299DA push esi,edi,ebp`(12) + `0x299DD sub esp,0xAC`(172) +
       *     `0x299E3 push eax,edx,ecx`(12) = **196**, 진입 시 `[esp+4]` → `[esp+0xC8]`.
       *     `0x29B0A` 뒤 `0x29B20` 까지 `ebx` 를 바꾸는 자리는 **없다**(전수 확인).
       *   ☐ **`bx` 가 무엇인지는 아직 못 짚었다.** 소환 번호(0~9)라면 6 = 가고일이라
       *     **가고일에 비행이 켜져야 하는데 우리 소환 객체에는 `f14` 가 아예 없다.**
       *     직업 번호라면 6 은 다른 것이다. 호출부 `0x2A181` 이 넘기는
       *     `0x2A17B push eax`(= 호출자 `[esp+0x18]` word)의 출처를 더 따라가야 한다.
       *     ★ **그 전에는 비행을 켜지 않는다** — 「가고일이니 날겠지」는 추측이다(§2-1).
       */
      /* ★ 레벨 = 시전자 레벨 — 원본은 시전자 레코드 136B 사본(0x29A08 ecx = 0x88)에서 힘·민첩·지력·HP·TP·그림 칸만 덮고 레벨 칸(+0x2B)은 안 덮는다
       *   ☠ 전에는 level 칸을 아예 안 넣어 소환수 레벨이 0 으로 보였다 (2026-11-15 사장님 「소환수 레벨은 왜 0이야?」 · 정본 207) */
      level: u.level | 0,
      id: id, name: summonName(job), job: job, side: u.side, race: 1,
      x: tiles[i].x, y: tiles[i].y, dir: 0, alive: true,
      hp: HP, maxHp: HP, mp: 0, maxMp: 0, tp: TP, chargeTp: 0, ailment: 0,
      summonCode: ((u.charCode | 0) || (u.id | 0)) + 10,               // [+0x12] 소환수 마커 (0x29B73)
      buff: { atk: 0, def: 0, mr: 0, maxTp: 0 }, mbuff: {}, equip: {}, gear: {},
      /* 0x29A60~0x29AC9 — 힘 `+0x40` · 공격력 `+0x44` = 힘 × 2 ·
       * 방어 `+0x46` = 보조표 · 마방 `+0x54` = 지력 + 보조표 · 최대TP `+0x50` */
      힘: st[0], 민첩: st[1], 지력: st[2],
      base: { atk: st[0] * 2, def: aux[0], mr: st[2] + aux[1], maxTp: TP },
      eff:  { atk: st[0] * 2, def: aux[0], mr: st[2] + aux[1], maxTp: TP },
      /* ★★★★★ **소환수는 제 그림을 쓴다** (2026-09-02 · `0x29B86`)
       *   원본은 `0x29B7F eax = [esp+0xCC]` · `0x29B86 mov [ebp+0x61], ax` 로
       *   **인자로 받은 스프라이트 번호**를 세운다 — 소환자 것을 물려받지 **않는다.**
       *   ☠ 전에는 `sprIndex: u.sprIndex`(**소환자 것**)라 소환수가 시전자와 같은
       *     그림으로 나왔다(사용자 지적 **5-3** 「스프라이트가 안 맞음」).
       *   ★ 표에 없는 직업이면 **예전대로** 소환자 것을 쓴다 — 원본에 없는 경우라
       *     값을 지어내지 않는다(`CLAUDE.md` §2-1). */
      /* ★★★★★ **초상화는 소환자 것이다** (2026-09-02 · 지적 **5-4**)
       *   원본은 소환수를 **시전자 레코드 `0x88`(136 B) 사본**으로 만든다:
       *   ```asm
       *   0x29A08  ecx = **0x88(136)**
       *   0x29A0D  esi = **[esp+8]**        ; ★ 시전자
       *   0x29A1A  shr ecx,2 ; 0x29A1D movsd ; 0x29A24 repne movsb
       *   ```
       *   그 뒤 덮어쓰는 것은 **셋뿐**이다 — 직업(`0x29A2B`) · 이름(`0x29A2E`) ·
       *   스프라이트(`0x29B86`). **초상화 `[+0x10]` 은 안 건드리므로 소환자 것이 남는다.**
       *   ⇒ 사용자 지적 「포트레이트가 **소환자의 것이어야** 하고」가 원본과 맞는다. */
      portrait: u.portrait,
      summoned: true,
      /* ★★★★★ **소환자 표식** — 원본 `0x29B6A add al,0xA` → `0x29B73 [+0x12] = al`
       *   (2026-09-08 · 사장님 지적 M2). 이 표식이 있어야 다음 소환 때 지울 수 있다.
       *   `+10` 규약은 DNA 클론(`combat.js:4294` · `0x3BD30`)과 같다.
       *   ☠ 전에는 `summoned: true` 만 세우고 **표식을 안 붙여** 아무도 못 찾았다. */
      summonerTag: (u.charCode | 0) + 10,        // 0x29B6A · 0x29B73
      /* ★★★★★ **가고일 소환수는 비행 상태로 나온다** (2026-09-02 · `0x29B1A`)
       *   ```asm
       *   0x29B0A  mov ebx, [esp+0xC8]     ; ★ 첫 스택 인자 = **소환 번호**
       *   0x29B14  cmp bx, 6               ; ★ 6 = 가고일
       *   0x29B1A  or byte [edx+0x14], 1   ; ★★ **비행 비트를 켠다**
       *   ```
       *   소환 번호인 근거 — 진입점의 `mov ecx, imm` 을 전수로 떴더니
       *   `ecx` 와 `ebx`(직업)가 아래 `SUMMON_SPR` 표와 **열 개가 그대로 맞는다**:
       *     `0x2BF65 xor ecx,ecx`(0 박쥐) · `0x2BF73`(1·72) · `0x2BF86`(2·63) ·
       *     `0x2BF99`(3·65) · `0x2BFAF`(4·67) · `0x2BFC5`(5·83) ·
       *     **`0x2BFDB`(6·82 = 가고일)** · `0x2B7C7`(7·90) · `0x2B897`(8·89) ·
       *     `0x2B986`(9·88)
       *   그 `ecx` 가 `0x29F5E mov word [esp+0x14], cx` 를 거쳐 이 인자가 된다.
       *   `[+0x14]` 비트 1 이 비행인 것은 `0x3B5B4`(전환) · `0x180D4`(탑승 시 끄기)로
       *   이미 확정돼 있다. */
      f14: ((job | 0) === 82) ? 1 : 0,                                  // 0x29B1A 가고일만 비행
      sprIndex: summonSpriteIndex(job, u.sprIndex),
      /* ★★★★★ **아군이 부른 소환수는 AI 가 움직인다** (2026-09-02 · `0x29BB5`)
       *
       *   ```asm
       *   0x29BAB  eax = [esp+8]                  ; 시전자
       *   0x29BAF  **cmp byte [eax+0xE], 1**      ; ★ 진영이 **1(아군)** 인가
       *   0x29BB3  jne 0x29BBC                    ;   아니면 건너뛴다
       *   0x29BB5  **mov byte [ebp+0x83], 2**     ; ★ AI 플래그 = **2**
       *   ```
       *   ⇒ **아군 소환수만** AI 가 잡는다. 적·몬스터가 부른 것은 원래 AI 라 안 세운다.
       *   ★ `ai.flag = 2` 는 버서커(`0x3BC17`)·분신(`0x3BC67`)과 **같은 규약**이다
       *     (`combat.js:3513`·`:3570`).
       *   ☠ 사용자 지적 **5-6** 「원작은 소환물이 **AI 조작만** 가능. 지금은 직접 조작됨」 —
       *     `summoned: true` 만 세우고 **아무도 그것을 안 봤다**(`grep` 으로 확인).
       *
       *   ☠☐ **한 가지 어긋날 수 있다** — 원본 `[+0xE]` 는 **「소속」**이고
       *     실행기 `u.side` 는 **소속_진영표를 거친 「진영」**이다
       *     (`sce.js:60` 「`+0x0E` 는 진영이 아니라 소속이다」 · `state.js:96 side: rec['진영']`).
       *     대개 **소속 1 → 진영 1(아군)** 이라 결과가 같지만, 표가 다르게 매핑된
       *     시나리오에서는 갈릴 수 있다. **원본 값 그대로가 아니므로 여기 적어 둔다.**
       *     ⇒ 소속을 유닛에 실어 오면 그때 `u.소속 === 1` 로 바꾼다.
       *   ☠☠☠★★★★★ **2026-09-02 — 파고 보니 더 깊다. `+0x0E` 는 로더가 덮어쓴다.**
       *     `0x4E8F0`~`0x4E92D` 를 읽었다 —
       *     ```asm
       *     0x4E8F0  mov ah, [ebp+0x87]           ; ★ **팀**(+0x87) — 소속이 아니다
       *     0x4E8F6  test ah,ah / je              ;   0 이거나
       *     0x4E8FA  cmp ah, 0x63(99) / jne       ;   99 이면
       *     0x4E8FF  al = [0xFDF85]               ;     현재 시나리오 번호로
       *     0x4E904  mov [ebp+0x87], al           ;     바꾼다
       *     0x4E90C  al = [ebp+0x87]              ;   그 팀으로
       *     0x4E912  al = [eax*2 + 0xFDAF6]       ; ★ **표[팀]** — word 배열, 인덱스는 팀 **그대로**
       *     0x4E919  dec al                       ; ★ **− 1**
       *     0x4E91B  mov [ebp+0xe], al            ; ★★★ **결과를 `+0x0E` 에 쓴다**
       *     0x4E929  cmp byte [eax+0xe], 1        ;   그 값을 1 과 견준다
       *     ```
       *     ⇒ 파일의 `+0x0E`(소속)는 **적재 때 `표[팀] − 1` 로 덮어써진다.**
       *       곧 `0x29BAF cmp byte [eax+0xE], 1` 은 **「표[팀] == 2」** 라는 뜻이다.
       *   ☠ 그러면 `sce.js:60` 의 **「진영 = 소속_진영표[소속 − 1]」이 두 군데 어긋난다** —
       *       ① 인덱스가 **소속 − 1** 이 아니라 **팀(`+0x87`)** 그대로다
       *       ② 결과에 **−1** 이 붙어 `+0x0E` 에 들어간다
       *     (`0x4E8F0` 이 「0·99 를 시나리오 번호로 바꾼다」는 것은 `sce.js` 주석에
       *      **이미 맞게** 적혀 있다. 다만 그 자리를 「소속」이라 불렀는데 **`+0x87`(팀)** 이다.)
       *   ★ 실측 — `.SCE` 294개에서 `표[0] !== 1` 인 시나리오가 **107개**다.
       *     곧 「소속 1」과 「진영 1」이 갈리는 판이 드물지 않다.
       *   ⇒ **여기서 고치지 않는다.** 이건 `combat.js` 한 줄이 아니라
       *     `sce.js`(진영 계산) · `state.js`(유닛 적재) · `battle_main.js`(진영 덮기)에
       *     걸친 **구조 문제**다. CLAUDE.md §2-4 대로 **알리고 손대지 않는다.**
       *     자세한 근거는 `03_분석/00_진영소속_어긋남.md`.
       *
       *   ★ **[리마스터 I-12] 토글** — 사용자 지정 「**둘을 선택할 수 있는 게 좋겠어**」.
       *     `소환수조작 === '리마스터'` 면 AI 를 안 걸어 **직접 조작**하게 둔다.
       *     기본은 `'원작'`(AI) 이다. */
      ai: (((u.side | 0) === 1) && !소환수직접조작()) ? { flag: 2, on: true } : null
    };
    battle.units.push(m);
    if (battle.setAt) battle.setAt(m.x, m.y, m);
    made.push(m);
  }
  return made;
}

/* ══════════════════════════════════════════ 7. 스킬 (0x731AC 열 번호) */

/**
 * 액티브 스킬. `skillNo` 는 **직업표 0x731AC 의 열 번호(0~14)** 입니다
 * (링 메뉴 아이콘 번호가 아닙니다 — 대응표는 스킬_시스템.md).
 *
 *  1 비행   0x3B5B4  스프라이트 ±1, [+0x14] ^= 1
 *  5 소용돌이 0x3B9E1  물 위에서만. 주변 나선, 위력 0x1770 · 제수 0x14
 * 10 일갈   0x3C09F  상대 진영 사기 −2 (하한 50)
 * 11 희생   0x3C12D  자기 진영 사기 +10 (**상한 없음**)
 * 12 저주   0x3C30A  정면 1칸 적에게 [+0x1E] |= 0x20(혼란), 잔여 60. 스프라이트 >= 300 면역
 * 14 배리어 0x3C4C1  방패(ITEM 종류 6) 필요. [+0x14] |= 4 = 무조건 방어
 * 탐색 0x18D36은 SCE 아이템 표(`battle.mapItems`)를 순환해 카메라/표시 보고를 냅니다.
 * 승마·조련·버서커·기도·워프·분신·빙룡소환·마장기 소환도 아래 실행부에 연결했습니다.
 */
/* ★★★★★ **스킬이 띄우는 문구** — `0x48612` (2026-09-02)
 *
 *   > 사용자 지적: 「필살기, 초필살기, 마법, 스킬 적용 효과와 **표시되는 이펙트**,
 *   >   이펙트 타이밍 등이 문제가 많아. 이부분은 특히 **꼼꼼하게 전수 확인**해야해.」
 *
 *   원본은 스킬을 쓸 때 **화면에 영문 문구를 띄운다.** 창구 `0x48612` 는
 *   마법의 "Wrong Spell!"·"No TP!"·"No MP!" 와 **같은 함수**다
 *   (`ring.js MAGIC_MSG` → `controller.js this.msg()` → `onMessage` → `flash()`).
 *   **스킬만 그 길을 안 타고 있었다.**
 *
 *   `node 04_도구/스킬문구_원본추출.js` 로 `mov edx,<문자열>` → `call 0x48612`
 *   짝을 전수로 뽑았다. 순서(문구가 앞인지 뒤인지)도 함수마다 읽어 적었다.
 *
 *   | 스킬 | 자리 | 문구 | 원본 순서 |
 *   |---|---|---|---|
 *   | 2 중독 | `0x3BB75` | `Poison` | 문구 → `[+0x1E]\|=0x80`·`[+0x27]=0xC8` → **64틱** |
 *   | 6 버서커 | `0x3BC26` | `Berserk!` | 문구 → `0x19718` → `[+0x83]=2`·`[+0x6D]=0`·`[+0x6E]=4` |
 *   | 7 기도(성공 · r2 ≥ 4) | `0x3BEBB` | `MP +20!` | 모션 8 → **90틱** → `rand(10)` 성공 판정 → 다시 `rand(10)` ≥ 4 면 문구 · ☒ 「실패면 문구」는 틀렸다 — 실패는 아무 일 없음 (2026-10-05 · case 7 주석) |
 *   | 10 일갈 | `0x3C0C9` | `Morale Down!` | 모션 8 → **16틱 한 프레임** → 문구 → 사기 write |
 *   | 11 희생 | `0x3C149` | `Wish to Win!!!` | 모션 8 → 화면 갱신 → 문구 → HP |
 *   | 12 저주 | `0x3C37E` | `Curse` | 모션 7 → 문구 → `[+0x1E]\|=0x20`·`[+0x25]=0x3C` |
 *   | 13 빙룡소환 | `0x3C44D` | `Ice Dragon!` | 문구 → `0x22D18` 소환 |
 *   | 14 배리어 | `0x3C508`·`0x3C514` | `Defense!` | 문구 → **32틱** → `[+0x14]\|=4` |
 *   | 17 사기업 | `0x4CD8D` | `Morale Up!` | 모션 8 → 한 프레임(**16틱**) → 문구 |
 *
 *   ★ `rep.문구` 로 실어 보내면 컨트롤러가 `msg()` 로 띄운다.
 *     `rep.문구틱` 은 그 스킬이 원본에서 쓰는 **프레임 간격**이다
 *     (`0x1033B(eax = 틱)` 실측 · `모션_딜레이표.md` §7).
 *   ☐ **모션 번호와 「문구가 앞이냐 뒤냐」는 아직 안 옮겼다** — 연출 층이 필요하다.
 */
/* ★★★ **스킬이 세우는 모션 `[+0x64]`** — `04_도구/스킬틱_원본대조.js` 와 같은 방식으로
 *   `mov byte [reg+0x64], N` 을 전수로 뽑았다 (2026-09-02).
 *   `call 0x12124` 가 **자세를 되돌리는** 자리다.
 *
 *   | 스킬 | 모션 | 되돌리기 |
 *   |---|---|---|
 *   | 7 기도 | `0x3BDCC` → **8** | `0x3BEF7` |
 *   | 10 일갈 | `0x3C0B9` → **8** | `0x3C123` |
 *   | 11 희생 | `0x3C13E` → **8** · `0x3C2CA` → **0**(자체 복귀) | — |
 *   | 12 저주 | `0x3C37A` → **7** | `0x3C38F` |
 *   | 13 빙룡소환 | 없음 | `0x3C48C` |
 *   | 17 사기업 | `0x4CD7D` → **8** | `0x4CD94` |
 *
 *   그 밖(중독·소용돌이·분신·버서커·배리어…)은 **모션을 안 세운다.** */
var SKILL_MSG = {
  2:  { 문구: 'Poison',         틱: 64 },   /* 0x3BB75 · 0x3BB89 */
  5:  {                         틱: 5  },   /* 0x3BA5E — 문구 없음 · 방향 회전 */
  6:  { 문구: 'Berserk!'                },   /* 0x3BC26 */
  /* ★ 기도의 문구는 **실패 갈래에서만** 뜬다 — `0x3BEAD jmp 0x3BEF5` 로 성공
   *   갈래가 먼저 끝나고, `0x3BEAF~0x3BEBB` 가 실패 갈래다.
   *   성공 때 뜨는 "Sun Light!"(`0x3BE65`)·"Heal Wind!"(`0x3BE8F`)는 `0x48612` 가
   *   아니라 **`0x28883`(마법 이름 외치기)** 로 간다 — **다른 창구**라 여기 넣지 않는다.
   *   ⇒ `틱` 만 표에 두고 `문구` 는 아래 `case 7` 의 실패 갈래에서 붙인다. */
  7:  {                         틱: 90, 모션: 8 },   /* 0x3BDDA · 모션 0x3BDCC → 되돌리기 0x3BEF7 */
  /* 0x3BF00: 중점 카메라 → 문구 → 3틱 간격 12회 회전 → 좌표 갱신. */
  8:  { 문구: 'Warp!',          회전: { 프레임: 12, 틱: 3 } },
  /* ★★★★★ **분신은 새로 생긴 분신 자신이 팽이처럼 돈다** — `0x3BD08`·`0x3BD8E`
   *   ```asm
   *   0x3BC76  eax = 6 · 0x3BC80 call 0x1033B        ; ★ 간격 **6 틱**
   *   0x3BD8E ┌ al = [ebp+0x63] + 1 & 3             ; ★ 방향을 **한 칸씩 돌린다**
   *   0x3BD99 │ call 0x45559 · 0x3BD9E call 0x499E4 ;   그리고 한 프레임
   *   0x3BDA3 └ cmp dx,0xC                          ; ★ **12 프레임**
   *   ```
   *   ⇒ 분신 하나마다 **12 프레임 × 6 틱 = 72 틱(410 ms)** 동안 돈다.
   *     바깥 루프가 두 번이니 둘이면 **820 ms**.
   *   ★ 그림 이펙트는 없다 — `0x1FEA4` 호출이 이 대역에 없다(스킬 그림은 셋뿐). */
  /* 분신(9)은 생성 한 기마다 카메라→분신 회전을 반복한다. 공통 시전자 회전 표에 넣지 않는다. */
  10: { 문구: 'Morale Down!',   틱: 16, 모션: 8 },   /* 0x3C0C9 · 0x3C0B4 · 모션 0x3C0B9 → 0x3C123 */
  /* ★ 희생은 `0x3C149` 로 "Wish to Win!!!" 를 `0x48612` 에 띄운다.
   *   뒤이어 나오는 "Heal Wind!"(`0x3C1C8`)·"Sun Light!"(`0x3C207`)는
   *   **`0x28883`(마법 이름 외치기)** 라 창구가 다르다 — 여기 넣지 않는다. */
  11: { 문구: 'Wish to Win!!!',         모션: 8 },   /* 0x3C149 · 모션 0x3C13E → 0x3C2CA 가 0 으로 */
  12: { 문구: 'Curse',                  모션: 7 },   /* 0x3C37E · 모션 0x3C37A → 0x3C38F */
  13: { 문구: 'Ice Dragon!'             },   /* 0x3C44D */
  18: { 문구: 'Fire Dragon!'            },   /* [리마스터] 화룡소환 Z-91 — 빙룡의 'Ice Dragon!'(0x3C44D) 과 같은 꼴 */
  14: { 문구: 'Defense!',       틱: 32 },   /* 0x3C508·0x3C514 · 0x3C51E */
  17: { 문구: 'Morale Up!', 준비틱: 16, 모션: 8 }    /* 0x4CD6C→0x4CD86 한 프레임 뒤 0x4CD8D 문구 */
};

/** [리마스터 조련소환] 조련사 레벨로 해금된 몬스터 칸 번호들 (2026-10-11 사장님 「각각의 몬스터는 레벨에 따라 해금되고」)
 *   칸 k 는 «앞 칸의 끝 레벨(까지) + 1» 부터 — 표 순서 그대로(슬라임 1 · 박쥐 20 · 오크 30 · 오크로드 40 · 흡혈박쥐 50 · 블러드오크 60) */
function 조련해금목록(lv) {
  var 표 = root.G2조련소환표 || [], out = [];
  for (var k = 0; k < 표.length; k++) {
    var 시작 = k === 0 ? 1 : ((표[k - 1].까지 | 0) + 1);
    if ((lv | 0) >= 시작) out.push(k);
  }
  return out;
}
/** 목록 창에 띄울 줄 — 해금된 몬스터마다 조련사 레벨에 가장 가까운 기록 하나 (조련 실행과 같은 고르기) */
function 조련목록(u) {
  var 표 = root.G2조련소환표 || [], lv = (u && u.level) | 0;
  return 조련해금목록(lv).map(function (k) {
    var 칸 = 표[k], 고른 = null, 차 = 1e9;
    (칸.기록 || []).forEach(function (r) { var d = Math.abs((r['레벨'] | 0) - lv); if (d < 차) { 차 = d; 고른 = r; } });
    return { 칸: k, name: 칸.이름, 기록: 고른,
             sprIndex: 고른 ? (고른['스프라이트번호'] | 0) : 0, job: 고른 ? (고른['직업'] | 0) : 0, level: Math.max(1, lv) };   /* 목록에 보이는 레벨 = 불려 나올 레벨 = 조련사 레벨 (11-07) */
  });
}
function skill(battle, u, skillNo, target, opts) {
  opts = opts || {};
  var Ru = R();
  skillNo = skillNo | 0;
  var rep = { ok: true, kind: 'skill', skill: skillNo, results: [], effects: [] };
  /* ★ 원본이 띄우는 문구·프레임 간격을 실어 보낸다 — 위 `SKILL_MSG` 표 (0x48612) */
  var _m = SKILL_MSG[skillNo];
  if (_m) {
    if (_m.문구) rep.문구 = _m.문구;
    if (_m.틱 != null) rep.문구틱 = _m.틱 | 0;
    if (_m.준비틱 != null) rep.준비틱 = _m.준비틱 | 0;
    if (_m.모션 != null) rep.모션 = _m.모션 | 0;      /* [+0x64] · 되돌리기는 0x12124 */
    /* 공통 회전은 시전자 연출용이다. 분신(9)의 생성 유닛 회전은 presenter 전용 경로가 맡는다. */
    if (_m.회전) rep.회전 = { 프레임: _m.회전.프레임 | 0, 틱: _m.회전.틱 | 0 };
  }

  function frontEnemy() {
    var fd = DIR[u.dir & 3], q = target || battle.at(u.x + fd.dx, u.y + fd.dy);
    return q && q.alive && hostile(u.side, q.side, battle.confuse) ? q : null;
  }
  function random(n) {
    var rng = opts.rng || (Ru && Ru.makeRng ? Ru.makeRng() : null);
    return rng ? rng(n) : Math.floor(Math.random() * n);
  }
  switch (skillNo) {
    case 0: {                                                       // 승·하차 0x3B7CE / 0x3B614
      var mc = (opts.targetTiles || [])[0];
      if (!mc) return { ok: false, reason: '승·하차할 칸을 선택해야 합니다' };
      var legalMountCell = mountSkillCells(battle, u).some(function (q) {
        return (q.x | 0) === (mc.x | 0) && (q.y | 0) === (mc.y | 0);
      });
      if (!legalMountCell) return { ok: false, reason: '승·하차 범위 밖입니다' };

      /* SCE에서 처음부터 탑승한 유닛도 `탑승자._raw`로 보행 레코드를 복원합니다. */
      if (!u._riderSnapshot && u.rider && u.rider._raw && root.G2State && root.G2State.makeUnit) {
        var loadedRider = root.G2State.makeUnit(탑승자레코드(u), u.id);
        root.G2State.derive(loadedRider);
        /* 방향은 안 물려준다 — `0x1808A` 는 좌표(`0x180AC`·`0x180B0`)만 덮고
         * `+0x63` 은 탑승자 레코드 값을 그대로 쓴다. `unmountOnDeath` 주석 참조.
         * (하차 스킬 `0x3B614` 도 `0x3B768` 에서 같은 `0x1808A` 를 부른다.) */
        loadedRider.x = u.x | 0; loadedRider.y = u.y | 0;
        /* ★ 진영은 지금 슬롯 것 — 배치(state.js 배치 `u.side = 1`)·원본 로더가 확정한 진영이다. unmountOnDeath 의 keepSide 와 같은 까닭.
         *   ☠ 빠져 있어 레코드 원문 진영(우군 등)으로 내려와, 턴이 끝나면 AI(우군)로 움직였다
         *   (2026-10-02 사장님 「말 내리고 턴 종료하면 우군으로 변경되는 오류도 있어」) */
        loadedRider.side = u.side | 0;
        u._riderSnapshot = copyValue(loadedRider);
        사람참조되돌리기(u._riderSnapshot, 사람참조(loadedRider));   /* 원본 136B·장비 껍데기 연결 */
        u._mountSnapshot = copyValue(u);
      }
      if (u._riderSnapshot) {                                      // 하차 0x3B614
        if (battle.at(mc.x, mc.y)) return { ok: false, reason: '하차할 칸이 비어 있지 않습니다' };
        /* 0x3B732 rep movsd: 소환 전 원형이 아니라 **현재 탑승 레코드** 136B를 복사한다. */
        var mountCopy = copyValue(u);
        var maxId = 0;
        battle.units.forEach(function (q) { maxId = Math.max(maxId, (q.id | 0) + 1); });
        /* ★ 새 레코드(0x3B72D call 0x112FD)는 한 번 쓴 번호를 다시 안 받는다 — 배치(state.js _다음유닛id)와 같은 일련번호.
         *   ☠ 「지금 최댓값 + 1」이면 탔다 빠진 말 번호가 되살아 옛 화면 요소를 물려받았다 */
        if (battle._다음유닛id != null) { maxId = Math.max(maxId, battle._다음유닛id | 0); battle._다음유닛id = maxId + 1; }
        mountCopy.id = maxId; mountCopy.x = u.x | 0; mountCopy.y = u.y | 0;
        mountCopy.rider = null; mountCopy._riderSnapshot = null; mountCopy._mountSnapshot = null;
        /* 0x3B732~0x3B74C: 탑승 상태 136B를 그대로 복사한 뒤 정확히 셋만 덮는다.
         * 진영5(0x3B73D [+0x0E]) · 탑승자 포인터0(0x3B743 [+0x77]) · [+0x10]=100(0x3B74C). 대기값은 건드리지 않는다.
         * ☠ [+0x10] 은 초상화 칸이다(sce.js·blackbox.js 「초상화: +0x10」 · 캐릭터코드는 +0x0F) — 전에는 charCode 를 100 으로 덮었다 */
        mountCopy.side = 5; mountCopy.portrait = 100; mountCopy.alive = true;

        /* ★ 남는 빈 탈것은 새 레코드(0x3B72D 0x112FD)다 — 파티 목록(그룹 0) 밖. 사람의 그룹·전향 표시를 물려받으면 전투 끝 커밋이
         *   이 탈것 몸을 사람으로 알고 명부에 쓴다 (2026-10-11 · 탈것 전수) */
        mountCopy.그룹 = null; mountCopy._그룹 = null; mountCopy._전향합류 = false;
        var keepId = u.id, keepTp = u.tp | 0, rider = copyValue(u._riderSnapshot);
        사람참조되돌리기(rider, 사람참조(u._riderSnapshot));     /* 탄 동안 오른 레벨이 든 사람 레코드 + 원본 136B·장비 껍데기 */
        var 슬롯표시 = { 그룹: u.그룹, _그룹: u._그룹, _전향합류: u._전향합류 };   /* 슬롯은 제 목록에 남는다 (unmountOnDeath 와 같음) */
        battle.unplace(u);
        Object.keys(u).forEach(function (k) { delete u[k]; });
        Object.keys(rider).forEach(function (k) { u[k] = rider[k]; });
        Object.keys(슬롯표시).forEach(function (k) { if (슬롯표시[k] !== undefined) u[k] = 슬롯표시[k]; });
        u.id = keepId; u.tp = keepTp; u.x = mc.x | 0; u.y = mc.y | 0;
        u.rider = null; u._riderSnapshot = null; u._mountSnapshot = null; u.alive = true;
        /* ★ 하차 스킬 0x3B614 도 0x3B768 에서 0x1808A 를 부른다 — 0x180F3 [+0x5C](탈것) = 0 · 0x180D4 비행 비트 끄기 (unmountOnDeath 와 같다)
         *   ☠ 빠져 있어 사람 사본에 남은 탈것 칸(대본 «장비.탈것» 값)이 그대로 남았다 → 링 스킬 메뉴가 «탈것 1~4 → 승마 해제만»(0x4C1C1) 갈래로 빠지고
         *     무기 종류(weaponTypeOf 탈것 1~4 → 5)·필살기까지 어긋났다 (2026-11-10 사장님 「말 내리고나서 스킬이 제대로 안나와. 탑승 스킬만 있고 다른 스킬이 없어」·「필살기도 안나와」) */
        u.gear = u.gear || {}; u.gear.mount = 0;                                   // 0x180F3
        if (u._raw && u._raw['장비']) u._raw['장비']['탈것'] = 0;
        u.f14 = (u.f14 | 0) & ~1;                                                  // 0x180D4
        battle.units.push(mountCopy);
        battle.setAt(mountCopy.x, mountCopy.y, mountCopy);
        battle.setAt(u.x, u.y, u);
        rep.created = [mountCopy]; rep.destination = { x: u.x, y: u.y };
        rep.mountAction = 'dismount'; rep.effects.push('하차'); rep.newActor = u;
        return rep;
      }

      var mount = target || battle.at(mc.x, mc.y);                  // 탑승 0x3B7CE
      if (!mount || !mount.alive || mount === u || !spriteProfile(mount).mountBody ||
          !((mount.gear || {}).mount | 0) || mount.rider)
        return { ok: false, reason: '탈 수 있는 빈 탈것이 아닙니다' };

      var riderSnapshot = copyValue(u), mountSnapshot = copyValue(mount);
      사람참조되돌리기(riderSnapshot, 사람참조(u));            /* mount() 가 u._raw 를 새 사본으로 바꾸기 «전» 원래 것 */
      var riderVisual = {
        sprIndex: u.sprIndex | 0, name: u.name, job: u.job | 0,
        charCode: u.charCode | 0, level: u.level | 0
      };
      var oldId = u.id, oldSide = u.side | 0, oldAi = copyValue(u.ai), oldTp = u.tp | 0;
      battle.unplace(u); battle.unplace(mount); mount.alive = false;
      var mi = battle.units.indexOf(mount); if (mi >= 0) battle.units.splice(mi, 1);
      Object.keys(mountSnapshot).forEach(function (k) {
        /* ★ 그룹·전향 표시는 탄 사람 슬롯 것 — 0x3B7CE 는 레코드만 덮고 리스트는 그대로 (2026-10-11 · 탈것 전수) */
        if (k !== 'id' && k !== 'x' && k !== 'y' && k !== 'side' && k !== 'alive' &&
            k !== '그룹' && k !== '_그룹' && k !== '_전향합류') u[k] = copyValue(mountSnapshot[k]);
      });
      u.id = oldId; u.x = mc.x | 0; u.y = mc.y | 0; u.side = oldSide; u.ai = oldAi;
      u.tp = oldTp; u.alive = true; u.rider = riderVisual;
      /* ★ 이름(+0x02)·[+0x10](초상화)은 탑승자 것 — 원본은 덮기 «전»에 탈것 레코드로 옮겨 둔다
       *   (0x3B8F6~0x3B915 이름 문자열 · 0x3B920~0x3B926 [+0x10]). ☠ 빠져 있어 내린 말에 다른 사람이 타면 처음 탄 사람 이름이 됐다 */
      u.name = riderSnapshot.name; u.portrait = riderSnapshot.portrait;
      /* ★★★★★ **탑승 변환** `0x3B997 call 0x17E6D(자기, [+0x5C])` (2026-08-22 · GPT 57차)
       *   원본은 탈것 레코드를 자기 슬롯에 덮은(`0x3B942`) **뒤** 다시 세운다.
       *   `G2State.mount()` 가 열 가지를 한다 — 등장(`0x50181`)·초기 배치와 **같은 창구**다.
       *   (`탈것_시스템.md` §「탑승 함수」 · 표 `0x72E9A`·`0x71B68`) */
      var _mc = (u.gear && u.gear.mount) | 0;
      if (_mc >= 1 && root.G2State && root.G2State.mount) {
        try { root.G2State.mount(u, _mc); } catch (e_) {}
      }
      /* ★ 덧그릴 탑승자 그림 — 0x3B99E call 0x11B77 → [탑승자+0x60]. 배치 탑승(state.js 배치 · native.js riderRcrOf)과 같은 창구.
       *   ☠ 전에는 걷는 그림 번호를 그대로 덧그려 말 위에 엉뚱한 그림이 겹쳐 깨졌다
       *   (2026-10-02 사장님 「탑승 이미지로 넘어가지 않고 이미지가 깨져 … 기존 말 배치할때처럼 코드가 맞아야해」) */
      riderVisual.보행spr = riderVisual.sprIndex;
      riderVisual._raw = riderSnapshot._raw;
      riderVisual.sprIndex = null;
      try {
        if (root.G2Native && root.G2Native.riderRcrOf)
          riderVisual.sprIndex = root.G2Native.riderRcrOf(root.G2탑승자RCR표 || null, _mc, riderVisual.보행spr,
            { race: riderSnapshot.race | 0, charCode: riderVisual.charCode | 0 });   /* 성별·캐릭터 지정 (2026-10-12) */
      } catch (e_r) {}
      u._riderSnapshot = riderSnapshot; u._mountSnapshot = mountSnapshot;
      battle.setAt(u.x, u.y, u);
      rep.removed = [mount]; rep.destination = { x: u.x, y: u.y };
      rep.mountAction = 'mount'; rep.effects.push('승마'); rep.newActor = u;
      return rep;
    }
    case 15: {                                                      // 돌진 0x3C7D1
      var dc = (opts.targetTiles || [])[0];
      if (!dc) return { ok: false, reason: '돌진할 칸을 선택해야 합니다' };
      var legalDash = dashCells(battle, u).some(function (q) {
        return q.x === (dc.x | 0) && q.y === (dc.y | 0);
      });
      if (!legalDash || battle.at(dc.x, dc.y)) return { ok: false, reason: '돌진할 수 없는 칸입니다' };
      var hpCost = Math.floor((u.maxHp | 0) / 20);
      if ((u.hp | 0) <= hpCost) return { ok: false, reason: 'HP가 부족합니다' };
      /* ★★★ **원본 순서** — 0x3C92C call 0x3C769(이동) → 0x3C946(HP 차감)
       *   → 0x3C94D call 0x46359(숫자·비명).
       *   0x3C769 안에서 0x46DF1 이 **출발·도착의 중점**으로 카메라를 옮긴다:
       *     y = y1 + (y2−y1)/2 · x = x1 + (x2−x1)/2 → 0x1124A
       *   연출 쪽이 쓰도록 출발 좌표를 함께 남긴다. */
      rep.from = { x: u.x | 0, y: u.y | 0 };                 /* 0x46DF1 인자 */
      rep.destination = { x: dc.x | 0, y: dc.y | 0 };
      rep.hpCost = hpCost;
      function 돌진확정() {
        if (rep.committed) return rep;
        rep.committed = true;
        battle.moveUnit(u, dc.x | 0, dc.y | 0, u.dir);               // 0x3C92C → 0x3C769
        u.hp = Math.max(1, (u.hp | 0) - hpCost);                     // 0x3C946
        rep.destination = { x: u.x | 0, y: u.y | 0 };
        return rep;
      }
      if (opts.defer) { rep.committed = false; rep.commit = 돌진확정; }
      else 돌진확정();
      rep.effects.push('돌진');
      return rep;
    }
    case 1: {                                                       // 비행 전환 0x3B5B4
      var v = view(battle, u), flightCommitted = false;
      rep.wasFlying = !!(v.f14 & 1);
      rep.fromSprite = u.sprIndex | 0;
      rep.toSprite = rep.fromSprite + (rep.wasFlying ? -1 : 1);
      rep.target = u;
      rep.commit = function () {
        if (flightCommitted) return rep;
        flightCommitted = true; rep.committed = true;
        u.sprIndex = rep.toSprite | 0;                              // 0x3B5C9 / 0x3B5F1
        u.f14 = rep.wasFlying ? ((u.f14 | 0) & ~1) : ((u.f14 | 0) | 1); // 0x3B5DE / 0x3B606
        return rep;
      };
      rep.effects.push('비행 ' + (rep.wasFlying ? '끔' : '켬'));
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 2: {                                                       // 중독 0x3BB05
      var p = frontEnemy();
      if (!p) return { ok: false, reason: '정면에 적이 없습니다' };
      if (spriteProfile(p).statusImmune) return { ok: false, reason: '대형/특수 본체에는 중독을 사용할 수 없습니다' };
      var poisonCommitted = false;
      rep.target = p;
      rep.commit = function () {
        if (poisonCommitted) return rep;
        poisonCommitted = true; rep.committed = true;
        var pv = view(battle, p);
        pv.f1e |= 0x80; pv.st.d1e[4] = 200;                         // 0x3BB7A · 0x3BB83
        commit(battle, p, pv);
        return rep;
      };
      rep.committed = false;
      rep.effects.push('중독:' + p.name);
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 3: {                                                       // 탐색 0x18D36
      /* ★★★★★ **맵 위 보물 상자를 하나씩 짚는다** — 전문 `COMBATII/스킬_탐색_0x18D36.md`
       *
       *   ```asm
       *   0x18D3D  ah = [eax+0x11] ; cmp ah,0x0C / setae al / bl = al  ; ★ bl = (직업 ≥ 12)
       *   0x18D51  cl = 0xFF                       ; ★ **끝까지 0xFF 다** (아래 ☠ 참조)
       *   0x18D55  dx = [0xF040E] ; inc edx        ; ★ 커서 — **함수를 나가도 남는다**
       *   0x18D5D  cmp dx, 0x0A / jl               ;   한 바퀴 = 표 칸 수
       *   0x18D69  edx = −1 ; inc esi              ;   되감고 **한 바퀴 셌다**
       *   0x18D76  cmp si, 2 / jl                  ; ★ **두 바퀴**까지만
       *   0x18D9E  eax = dx × 0xC                  ;   레코드 12 B
       *   0x18DA4  ch = [eax+0xF0382]              ;   +2 **코드** (0 이면 빈 칸)
       *   0x18DAE  cmp cl, ch / je 다음            ; ★ **코드가 0xFF 면 건너뛴다** (☠ 아래)
       *   0x18DB2  ch = [eax+0xF0389]              ;   +9 **조건**
       *   0x18DB8  test ch,ch / je 채택            ;   0 이면 조건 없음
       *   0x18DBC  cmp ch, 3 / jne 다음            ;   3 이 아니면 건너뛴다
       *   0x18DC1  test bx,bx / jle 다음           ; ★ 조건 3 은 **직업 ≥ 12** 라야
       *   0x18DC6  [0xF040E] = dx                  ; ★ 채택
       *   0x18D82  "Search Failed" ; 0x18D8F eax = 0x1F4(500) ; 0x18D94 call 0x499EF
       *   0x18DFA  call 0x1124A                    ; ★ 카메라를 그 칸으로
       *   ```
       *   ★ 표는 원본 `0xF0380`(12 B × n) 이고 **`.SCE` 에서 통째로 읽는다**
       *     (`0x4F1C8 ebx=2` 개수 word · `0x4F1F0 ebx=0xC` · `0x4F1F8 edx += 0xF0380`).
       *     우리 쪽에서는 `sce.js:428` 이 이미 파싱해 `battle.mapItems` 로 들어와 있다 —
       *     `+0` x · `+1` y · `+2` 코드 · `+9` 조건. **같은 표다.**
       *   ★ **`taken` 은 안 본다** — 원본에 그런 판정이 없다. `+2`(코드)만 본다.
       *
       *   ☐ **원본과 하나 다르다 — 칸 수** — 원본은 `0x18D5D cmp dx, 0x0A` 로 **10 칸 고정**을
       *     훑고(초기화도 `0x1854C cmp ax, 0x0A` 로 10 칸), **빈 칸도 세면서** 건너뛴다.
       *     우리 `mapItems` 는 `state.js:1131` 이 **코드 0·0xFF 를 미리 뺀 압축 목록**이라
       *     길이가 다르다. ⇒ 「몇 칸을 도는가」는 다르지만 **고르는 결과는 같다**
       *     (빈 칸은 어차피 `0x18DAA test ch,ch` 로 건너뛰므로).
       *     ★ 다만 **「두 바퀴 돌면 실패」의 바퀴 길이**가 달라지므로 여기 적어 둔다.
       *   ★★★★★ **칸 수 차이는 실제로 문제가 안 된다 — 실측으로 확인했다** (2026-09-02)
       *     원본은 `0x18D5D cmp dx, 0x0A` 로 **10칸 고정**을 훑는다. 그러면
       *     **11칸째부터는 원본이 아예 안 본다**는 뜻이라, 자료에 11칸 이상이
       *     있으면 우리와 결과가 갈린다. 그래서 **전 시나리오를 세어 봤다** —
       *     ```
       *     01_원본게임/창세기전2/Genesis2/SCENARIO/*.SCE  294개 전부 파싱
       *     칸 수 분포 — 0칸:204 · 1칸:19 · 2칸:44 · 3칸:13 · 4칸:4 · 5칸:8 · 7칸:1 · 10칸:1
       *     최대 **10칸** (`7-3B.SCE`)  ⇒ **10칸을 넘는 시나리오 0개**
       *     ```
       *     ⇒ 원본의 「10칸 고정」은 **자료의 상한과 정확히 맞는다.**
       *       잘리는 칸이 하나도 없으니 우리 압축 목록과 **고르는 결과가 같다.**
       *     ★ 「두 바퀴 돌면 실패」도 같다 — 빈 칸은 어차피 건너뛰므로,
       *       유효 칸이 있으면 둘 다 첫 바퀴에 찾고 없으면 둘 다 실패한다.
       *     ⇒ 이 자리는 **어긋남이 아니다.** 다만 원본 상한이 10 이라는 것은
       *       기억해 둔다 — 모드로 11칸 이상을 넣으면 원본과 갈린다.
       */
      var 표 = battle.mapItems || [];
      var 칸수 = 표.length;
      /* ☠☠☠ **처음에 `cl` 을 「직전에 고른 것」으로 읽었다 — 틀렸다.**
       *   `0x18D36`~`0x18DD0` 을 **전수로** 훑으니 `cl` 을 만지는 자리는
       *   **`0x18D51 mov cl, 0xFF` 하나뿐**이다(루프 안에서 안 바뀐다).
       *   ⇒ `0x18DAE cmp cl, ch` 는 **「코드가 `0xFF` 인 칸을 건너뛴다」**는 뜻이다.
       *   ★ 그리기 쪽 `0x187E4 cmp ah, 0xFF / je` 와 **같은 걸러내기**이고,
       *     `state.js:1131` 이 이미 `코드 === 0 || 코드 === 0xFF` 를 빼 두었다.
       *     ⇒ 우리 목록에는 그 칸이 애초에 없다 — **따로 거를 것이 없다.** */
      var 직업허용 = ((u.job | 0) >= 0x0C);                            // 0x18D42 cmp ah,0x0C setae
      /* [리마스터] 탐색확장 — 도둑부터(탐색을 쓸 수 있는 직업 전부) 숨겨진 아이템까지 짚는다 (2026-10-05 사장님 「아이템 탐색 스킬도 도둑부터 모든 아이템 찾게 해」)
       *   원작은 직업 12(스카우트) 이상만 조건 3(숨김)을 짚는다. 상자(조건 1·2)를 건너뛰는 것은 그대로 — 상자는 맵에 보인다. '원작' 이면 끈다 */
      if (root.Opt && root.Opt.cfg && root.Opt.cfg['탐색확장'] === '리마스터') 직업허용 = true;
      var 커서 = (battle.탐색커서 == null) ? -1 : (battle.탐색커서 | 0);   // [0xF040E]
      var 바퀴 = 0, 고름 = null;
      while (칸수 && 바퀴 < 2) {                                       // 0x18D76 cmp si, 2
        커서++;
        if (커서 >= 칸수) { 커서 = -1; 바퀴++; continue; }              // 0x18D69
        var it = 표[커서];
        var 코드 = it && (it.code | 0);                                // +2 (0x18DA4)
        if (!코드) continue;                                           // 0x18DAA 빈 칸
        if (코드 === 0xFF) continue;                                   // 0x18DAE cmp cl(0xFF), ch
        /* ☠★★★★★ **이미 먹은 상자는 건너뛴다** (2026-09-22 사장님 지적)
         *
         *   > 사장님: 「탐색 스킬 사용시 필드에 있는 아이템 위치로 이동하는건 잘 적용되는데,
         *   >  **이미 먹은 뒤에도 해당 위치로 이동**하는 문제가 있어.」
         *
         *   원본에서 먹은 상자는 **목록에서 사라진 것과 같다** —
         *   줍기가 획득 플래그를 세우고(`0x18D27 byte[0xFE04F+f]=1`),
         *   적재는 그 플래그가 선 칸을 **아예 안 싣는다**
         *   (`state.js:1236` · 「`0x4F216` — 이미 먹은 아이템은 로드 때 `code=0xFF` 로
         *    지운 것과 같은 결과」). 곧 `0x18DAE` 의 `0xFF` 걸러내기에 걸리는 것과 같다.
         *   ☠ 우리는 **같은 판 안에서는** 목록에 남겨 두고 `taken` 만 세운다
         *     (그리기는 `0x1868A` 의 `먹음` 으로 이미 감춘다). 그래서 탐색만 계속 짚었다.
         *   ⇒ 여기서도 `taken` 을 `0xFF` 와 같이 본다. */
        if (it.taken) continue;                                        // 0x18D27 → 0x4F216
        var 조건 = it.cond | 0;                                        // +9 (0x18DB2)
        /* [리마스터] 조건 4 = 용자의 무덤 «아무나 먹는 숨은 아이템» — 직업 가리지 않고 짚는다 (2026-10-12 사장님 「리마스터용으로 만든 안보이지만 아무나 먹을 수 있는 아이템도 탐색에 표시되어야하는데 안나와.」) */
        if (조건 === 4) { 고름 = it; break; }
        if (조건) {                                                    // 0x18DB8
          if (조건 !== 3) continue;                                    // 0x18DBC
          if (!직업허용) continue;                                     // 0x18DC1
        }
        고름 = it; break;                                              // 0x18DC6 채택
      }
      battle.탐색커서 = 커서;
      if (!고름) {                                                     // 0x18D7C si == 2 → 실패
        rep.탐색성공 = false;
        rep.안내문구 = 'Search Failed';                                // 0x18D82  0x770A9 → 0x48083
        rep.딜레이틱 = 0x1F4;                                          // 0x18D8F  500 틱
        return rep;
      }
      rep.탐색성공 = true;
      rep.카메라 = { x: 고름.x | 0, y: 고름.y | 0 };                   // 0x18DFA call 0x1124A
      /* 0x18E4A/0x18E6B 화면 변환 뒤 (x,y)~(x+24,y+16)을 팔레트 표 10으로
       * 리맵하고 0x49EEE를 호출한다. 좌표·표 번호는 확정됐지만 0x49EEE의 그림
       * 본문을 아직 1:1 포팅하지 않았으므로 presenter에는 사실만 전달한다. */
      rep.탐색표시 = { x: 고름.x | 0, y: 고름.y | 0, w: 0x18, h: 0x10,
                       palette: 0x0A, originalCall: 0x49EEE };
      rep.딜레이틱 = 0x1F4;                                           // 0x18EE5~0x18EEA 성공도 500틱
      return rep;
    }
    case 4: {                                                       // 조련 0x3BBA7
      /* ★★★★★ [리마스터] 조련 소환 (2026-10-06 · 사장님 「기본 원작 사양 그대로 두고 리마스터 사양으로 소환으로 가자」 ·
       *   선택 「조련사 레벨별 고정 표」·「조련사 한 명당 한 마리」) — 설정 조련소환 = '리마스터'(기본)일 때만.
       *   정면 칸(원본 조련과 같은 칸)이 비어 있으면 표(taming_summon_table.js · 04_도구/조련소환표_굽기.js)의 몬스터를
       *   조련사 레벨에 가장 가까운 .SCE 기록으로 세운다. 소환수 표시(summonerTag = 조련사 코드 + 10)라
       *   경험치는 조련사에게 간다(경험치받을이) · 조작은 다른 소환수와 같은 규칙(소환수직접조작). '원작' 이면 아래 원본 그대로. */
      if (root.Opt && root.Opt.cfg && root.Opt.cfg['조련소환'] === '리마스터' && root.G2조련소환표 &&
          root.G2State && root.G2State.makeUnit) {
        var 조표 = root.G2조련소환표, 조lv = (u.level | 0);
        var 있던 = (battle.units || []).filter(function (q) { return q && q.alive && q._조련주인 === u.id; })[0];
        if (있던) return { ok: false, reason: '이미 데리고 있는 소환수가 있습니다' };
        var 조칸 = 조표.filter(function (k) { return 조lv <= (k.까지 | 0); })[0] || 조표[조표.length - 1];
        /* [리마스터 조련소환] 목록 창에서 고른 몬스터 — 해금된 것(조련해금목록)만 받는다 (2026-10-11 사장님 「리바이블 창처럼 몬스터 목록을 띄우고 그중에 선택 … 각각의 몬스터는 레벨에 따라 해금되고」) */
        if (opts.조련고름 != null) {
          var 해금 = 조련해금목록(조lv);
          if (해금.indexOf(opts.조련고름 | 0) < 0) return { ok: false, reason: '아직 해금되지 않은 몬스터입니다' };
          조칸 = 조표[opts.조련고름 | 0];
        }
        var 조기록 = 조련기록고르기(조칸, 조lv);
        if (!조기록) return { ok: false, reason: '조련 소환 표가 비었습니다' };
        /* 자리 — 조련자리후보(아래) · 컨트롤러가 같은 후보를 칠해 보여 주고 고른 칸(targetTiles)을 넘긴다 (마법 소환처럼 0x29F4D → 0x4A815 확인)
         *   (2026-11-15 사장님 「테이머 소환 큰 몬스터 문제 있어. 소환마법처럼 자리를 지정해서 나와야하는데 자리가 애매해.」 · 정본 208) */
        var 조후보 = 조련자리후보(battle, u, 조기록);
        if (!조후보.length) return { ok: false, reason: ((조기록['스프라이트번호'] | 0) >= 300) ? '큰 몸이 설 자리가 없습니다' : '정면 칸에 설 수 없습니다' };
        var 조앵커 = 조후보.filter(function (c) { return !c.발자국; });   /* 정본 292 — 표시용 발자국 칸은 세울 자리가 아니다 */
        var 조고른 = (opts.targetTiles && opts.targetTiles[0]) || null, 조x = 조앵커[0].x, 조y = 조앵커[0].y;
        if (조고른) 조후보.forEach(function (c) { if (c.발자국 && c.앵커 && (c.x | 0) === (조고른.x | 0) && (c.y | 0) === (조고른.y | 0)) 조고른 = c.앵커; });   /* 발자국 칸을 눌렀으면 그 짝 앵커로 */
        if (조고른) for (var 조i = 0; 조i < 조후보.length; 조i++) if ((조후보[조i].x | 0) === (조고른.x | 0) && (조후보[조i].y | 0) === (조고른.y | 0)) { 조x = 조후보[조i].x; 조y = 조후보[조i].y; break; }
        var 조id = 0; battle.units.forEach(function (q) { 조id = Math.max(조id, (q.id | 0) + 1); });
        if (battle._다음유닛id != null) { 조id = Math.max(조id, battle._다음유닛id | 0); battle._다음유닛id = 조id + 1; }
        var 조rec = JSON.parse(JSON.stringify(조기록));
        조rec.x = 조x; 조rec.y = 조y;
        /* ★ 대본 기록의 AI 칸은 비운다 — 그 시나리오에서 그 몬스터가 받던 목표(«특정 위치»로 가기 등)·성향·지정 마법/필살기가 딸려 와 엉뚱하게 움직였다
         *   (2026-11-15 사장님 「생성된 몬스터가 이상한 AI가 걸려있어」·「특정 위치」 · 정본 208) · 마법 소환수처럼 소환수 규약(ai.flag 2)만 남긴다 */
        조rec['AI목표모드'] = 0; 조rec['AI공격성향'] = 0; 조rec['AI후퇴성향'] = 0; 조rec['AI목표'] = null;
        조rec['AI필살기지정'] = 0xFF; 조rec['AI지정마법'] = 0xFF; 조rec['AI마법지정'] = 0xFF; 조rec['AI플래그'] = 0;
        조rec['레벨'] = Math.max(1, 조lv);   /* 소환 레벨 = 조련사 레벨 (사장님 11-07 「실제 소환 레벨은 소환자 레벨에 맞추는게 좋을 것 같아」) · 능력치는 표(리마스터) 그대로 */
        var 짐승 = root.G2State.makeUnit(조rec, 조id);
        짐승.x = 조x; 짐승.y = 조y; 짐승.dir = u.dir & 3;
        짐승.side = u.side; 짐승.팀 = 0; 짐승.그룹 = null; 짐승.alive = true; 짐승.감춤 = false;
        짐승.summonerTag = (u.charCode | 0) + 10;                    /* 소환수 표시 — 0x29B73 과 같은 칸 */
        짐승._조련주인 = u.id;
        짐승.ai = 짐승.ai || {}; 짐승.ai.flag = 2; 짐승.ai.on = !소환수직접조작();
        if (root.G2State.derive) { try { root.G2State.derive(짐승); } catch (e조) { } }
        짐승.hp = 짐승.maxHp | 0; 짐승.tp = 0;
        battle.units.push(짐승);
        if (battle.place) battle.place(짐승, 조x, 조y, 짐승.dir); else battle.setAt(조x, 조y, 짐승);   /* 발자국째 (큰 몸은 여러 칸 · 0x11E04 와 같은 창구) */
        rep.조련소환 = 짐승; rep.created = [짐승];
        rep.조련이름 = 조칸.이름;                                       /* 연출이 같은 계열 소환 주문을 고른다 (battle_main skill 4) */
        rep.effects.push('조련 소환:' + 조칸.이름 + ' Lv' + (조기록['레벨'] | 0));
        return rep;
      }
      var beast = frontEnemy();
      if (!beast) return { ok: false, reason: '정면에 적이 없습니다' };
      if ((beast.side | 0) !== 4 || (beast.race | 0) === 2)
        return { ok: false, reason: '진영 4의 비언데드 대상에게만 사용할 수 있습니다' };
      var bv = view(battle, beast);
      bv.f1e |= 0x10; bv.st.d1e[2] = 200;      // 0x3BBF4 or [+0x1E],0x10 · 0x3BBFB [+0x23]=200 — 칸[2]
      commit(battle, beast, bv);
      rep.effects.push('조련:' + beast.name);
      return rep;
    }
    case 5: {                                                       // 소용돌이 0x3B9E1
      var tile = battle.tile(u.x, u.y), val = tile ? (tile['값'] | 0) : 0;
      var low = (val > 0x64) ? ((val - 0x64) & 0xF) : (val & 0xF);
      if (!(val > 0x64 && (low === 2 || low === 3)))
        return { ok: false, reason: '물 위에서만 쓸 수 있습니다' };
      /* ★★★★★ **반경은 1 이다** — `0x3B9F4 mov ebx, 1` (2026-09-02 정정)
       *
       *   ```asm
       *   0x3B9ED  [0xF0B9E] = 0                  ; 대상 수 카운터
       *   0x3B9F4  ebx = 1                        ; ★ **반경 1**
       *   0x3BA00  call 0x1AC08 (eax = x, edx = y); 마름모 생성기
       *   0x3BA05 ┌ call 0x1AC59                  ;   다음 칸
       *   0x3BA25 │ call 0x1A25F (eax,edx = 칸 · ebx = 시전자)
       *   0x3BA2A └ jmp 0x3BA05
       *   0x3BA2C  카운터가 0 이면 eax = −1 (취소)
       *   ```
       *   `0x1AC08` 의 `ebx` 가 반경인 것은 다른 칸으로도 맞는다 —
       *   검 파 `0x2F5FB ebx = 5`(자기 중심 반경 5) · 부 광 `0x2F994 ebx = 1`(반경 1).
       *   ☠ 우리는 **2** 를 쓰고 있었다 — 인접 4칸이어야 할 것이 **12칸**으로 세 배였다. */
      var cells = diamond(battle, u.x, u.y, 1, false), cv = view(battle, u);   // 0x3B9F4 ebx = 1
      var swirlTargets = [];
      for (var i = 0; i < cells.length; i++) {
        var t = battle.at(cells[i].x, cells[i].y);
        if (!t || !t.alive || !hostile(u.side, t.side, battle.confuse)) continue;
        swirlTargets.push(t);                                      // 0x1A25F → 0xF0648
      }
      if (!swirlTargets.length)                                    // 0x3BA2C~0x3BA3B
        return { ok: false, reason: '주변에 대상이 없습니다' };
      var swirlCommitted = false;
      rep.targets = swirlTargets.slice();
      rep.deaths = [];
      rep.originalDir = u.dir | 0;
      rep.commit = function () {
        if (swirlCommitted) return rep;
        swirlCommitted = true; rep.committed = true;
        /* 원본은 12회 방향 증가로 제 방향에 돌아온 뒤 피해를 적용한다. */
        u.dir = rep.originalDir | 0;
        for (var j = 0; j < swirlTargets.length; j++) {
          var targetUnit = swirlTargets[j];
          if (!targetUnit || !targetUnit.alive) continue;
        /* ★★★★★ **날씨를 넘긴다** — `0x3BAE7 call 0x28728` → `0x28768 call 0x285E4` (2026-09-03)
         *   ☠ `timeOfDay` 를 안 넘겨 `ctx.timeOfDay | 0 = 0` 이 되어
         *     **날씨 위력 보정(`0x286E3` +50 %)이 영영 안 걸렸다.**
         *   원본은 껍데기 `0x28728` 이 유닛을 돌며 **피해 계산 `0x285E4` 하나**를 부르므로
         *   그 안의 날씨 갈래를 **반드시 탄다**. 스킬만 예외일 수 없다.
         *   (소용돌이는 `attr: -1` 이라 지금은 값이 안 변하지만, 창구를 갈라 두면
         *    R90 처럼 뒤에 속성이 붙을 때 또 죽는다 — 같이 넘긴다.) */
          var dmg = Ru.magicDamage(cv, view(battle, targetUnit),
                    { power: 0x1770, div: 0x14, attr: -1 },
                    { tables: battle.T, timeOfDay: battle.timeOfDay | 0,
                      deriveC: eff(battle, u), deriveD: eff(battle, targetUnit) });
          var r = applyDamage(battle, targetUnit, dmg, { killer: u, reason: 'skill' });
          rep.results.push({ unit: targetUnit, damage: dmg, died: r.died });
          if (r.died) rep.deaths.push(targetUnit);
          /* ★ 죽인 몫을 rep.exp 에 — 컨트롤러 _사망처리 가 report.exp 로 «경험치 획득»·레벨업 창을 띄운다 (0x1DBCD) · ☠ 예전에는 kill() 이 넣기만 하고 안 실어 창이 안 떴다 (2026-09-26 사장님 「경험치 획득 안되는 문제도 있고」) */
          if (r.died && r.kill && r.kill.exp) (rep.exp || (rep.exp = [])).push(r.kill.exp);
        }
        return rep;
      };
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 6: {                                                       // 버서커 0x3BC17
      var berserkCommitted = false;
      rep.commit = function () {
        if (berserkCommitted) return rep;
        berserkCommitted = true; rep.committed = true;
        if (root.G2Turn && root.G2Turn.dequeueReady) root.G2Turn.dequeueReady(battle, u); // 0x3BC2D
        u.ai = u.ai || {};
        u.ai.flag = 2; u.ai.on = true;                              // 0x3BC32 [+0x83]
        u.ai.atkTend = 0; u.ai.fleeTend = 4;                        // 0x3BC39 · 0x3BC3D
        u.ai.special = 0xFF; u.ai.magic = 0xFF;                     // 0x3BC44 · 0x3BC57~5D
        u.f14 = (u.f14 | 0) | 2;                                   // 0x3BC41~4E
        u.ai.mode = u.ai.atkTend | 0;                               // 0x3BC51~54 [+0x6C]=[+0x6D]
        return rep;
      };
      rep.committed = false;
      rep.effects.push('버서커');
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 7: {                                                       // 기도 0x3BDC7
      /* 0x3BDC7은 모션8→맵 갱신→90틱 한 프레임 뒤 난수를 뽑고,
       * 그 다음 성공 회복 또는 실패 MP+20을 실제로 적용한다. 제품은 연출을
       * presenter로 옮겼으므로 결과를 여기서 먼저 써 버리면 HP/MP가 화면보다 앞선다.
       * 난수·대상 결정만 고정하고 실제 write는 멱등 commit으로 넘긴다. */
      /* ★★★★★ **원본 차례 그대로** — CD 설치본 0x3BD75~0x3BEAD 역어셈 (2026-10-05)
       *   ```asm
       *   0x3BD92  cmp [ecx+0x11],0x25        ; ★ **직업**(+0x11) 비숍(0x25)이면 5 · 아니면 3
       *   0x3BDA9  r1 = rand(10) · 0x3BDB1 cmp dx,ax / jle 0x3BEA3   ; ★ 확률 ≤ r1 → **아무 일 없음**(자세만 되돌림)
       *   0x3BDBC  r2 = rand(10) · 0x3BDC5 cmp ax,4 / jge 0x3BE5D    ;   r2 ≥ 4 → 「MP +20!」(0x77B70 · cure.ssp · 자기 MP +20)
       *   0x3BDDA  r3 = rand(10) · 0x3BDE3 cmp ax,5 / jge            ;   r3 < 5 → 「Sun Light!」(ebx 4) · 아니면 「Heal Wind!」(ebx 3)
       *   ```
       *   ☠ 전에는 캐릭터 코드 0x25 를 봤고, 실패를 «MP +20» 으로 두어 기도가 **매번** 무언가를 냈다
       *     (사장님 「기도 스킬 확인해.」 · 「원작은 특정 조건에의해 확률적으로 발동하는데, 지금 너무 자주 발동하는 느낌이야」) */
      var chance = ((u.job | 0) === 0x25) ? 5 : 3;                    // 0x3BD92 직업 비숍
      var prayerSuccess = random(10) < chance;                          // 0x3BDA9 · 0x3BDB1
      var prayerCommitted = false;
      rep.prayerKind = 0;
      rep.prayerTargets = [];
      rep.committed = false;

      if (!prayerSuccess) {                                             // 0x3BDB1 jle 0x3BEA3 — 아무 일 없음
        rep.prayerKind = -1;
        rep.effects.push('기도 실패');
        rep.commit = function () { prayerCommitted = true; rep.committed = true; return rep; };
        if (!opts.defer) rep.commit();
        return rep;
      }
      if (random(10) >= 4) {                                            // 0x3BDBC · 0x3BDC5 jge 0x3BE5D — MP +20
        var prayerMpBefore = u.mp | 0;
        var prayerMpAfter = Math.min(u.maxMp | 0, prayerMpBefore + 20);
        rep.prayerKind = 0;                                         // 성공 갈래 r2 ≥ 4 = Cure + MP+20 (0x3BE5D)
        rep.prayerTargets = [u];
        rep.문구 = 'MP +20!';                                       // 0x3BEBB
        rep.effects.push('MP +' + (prayerMpAfter - prayerMpBefore));
        rep.commit = function () {
          if (prayerCommitted) return rep;
          prayerCommitted = true; rep.committed = true;
          var beforeMp = u.mp | 0;
          u.mp = Math.min(u.maxMp | 0, beforeMp + 20);
          rep.mpGain = (u.mp | 0) - beforeMp;
          return rep;
        };
        if (!opts.defer) rep.commit();
        return rep;
      }

      /* 0x3BE37: 효과 종류는 한 번만 뽑습니다.
       * kind 4(Sun Light)는 0x2328을 4회, kind 3(Heal Wind)는
       * 0x283FE[0] == 0x07D0을 3회 0x2A75A에 넘깁니다. */
      var sunLight = random(10) < 5;                                   // 0x3BDDA · 0x3BDE3 cmp ax,5
      var prayerPulses = sunLight ? 4 : 3;
      var prayerPower = sunLight ? 0x2328 : 0x07D0;
      rep.prayerKind = sunLight ? 4 : 3;
      rep.pulses = prayerPulses;
      rep.effects.push(sunLight ? 'Sun Light!' : 'Heal Wind!');
      battle.units.forEach(function (ally) {
        if (!ally.alive || hostile(u.side, ally.side, battle.confuse)) return;
        /* kind 3의 아군 수집 루틴은 언데드(종족 2)를 제외합니다. */
        if (!sunLight && (ally.race | 0) === 2) return;
        rep.prayerTargets.push(ally);
      });
      rep.commit = function () {
        if (prayerCommitted) return rep;
        prayerCommitted = true; rep.committed = true;
        rep.results.length = 0;
        rep.prayerTargets.forEach(function (ally) {
          if (!ally || !ally.alive) return;
          var before = ally.hp | 0;
          for (var pulse = 0; pulse < prayerPulses; pulse++)
            ally.hp = Math.min(ally.maxHp | 0, (ally.hp | 0) + prayerPower);
          rep.results.push({ unit: ally, heal: (ally.hp | 0) - before, hpAfter: ally.hp | 0,
                             pulses: prayerPulses, perPulse: prayerPower });
        });
        return rep;
      };
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 8: {                                                       // 워프 0x3BFAC
      var wc = (opts.targetTiles || [])[0];
      if (!wc) return { ok: false, reason: '워프할 칸을 선택해야 합니다' };
      var wr = 워프반경(battle, u);                                  /* 0x3BFC6 */
      if (Math.abs((wc.x | 0) - (u.x | 0)) + Math.abs((wc.y | 0) - (u.y | 0)) > wr ||
          battle.at(wc.x, wc.y) || !워프경계안(battle, wc.x | 0, wc.y | 0)) return { ok: false, reason: '워프할 수 없는 칸입니다' };   /* 0x13D02 경계 */
      /* ☠ `canStand(…, null)` 은 지형을 안 본다 — 범위와 **같은 잣대**로 고쳤다 (2026-09-23) */
      var wMt2 = (root.G2Move && root.G2Move.moveTypeOf)
        ? root.G2Move.moveTypeOf(battle, u) : 0;
      if (battle.moveCost(wc.x | 0, wc.y | 0, wMt2) <= 0)
        return { ok: false, reason: '워프할 수 없는 칸입니다' };
      rep.from = { x: u.x | 0, y: u.y | 0 };
      rep.destination = { x: wc.x | 0, y: wc.y | 0 };
      function 워프확정() {
        if (rep.committed) return rep;
        rep.committed = true;
        battle.moveUnit(u, wc.x | 0, wc.y | 0, u.dir);               // 0x3BF72~0x3BFA1
        rep.destination = { x: u.x | 0, y: u.y | 0 };
        return rep;
      }
      if (opts.defer) { rep.committed = false; rep.commit = 워프확정; }
      else 워프확정();
      rep.effects.push('워프');
      return rep;
    }
    case 9: {                                                       // 분신 0x3BC67
      if ((u.usedOnce | 0) & 2) return { ok: false, reason: '이번 행동에 이미 분신을 사용했습니다' };
      var made = [], offsets = [1, 3], offsetIndex = 0;
      /* ★★★★★ **분신은 넷이 아니라 「양옆 둘」이다** — `0x3BC7B` (2026-09-03)
       *
       *   ```asm
       *   0x3BC7B  edx = 1 · 0x3BC85 [esp+0x8] = dx      ; ★ 시작 **1**
       *   0x3BCA6  al = [시전자+0x63]                     ;   시전자 방향
       *   0x3BCA9  add al,[esp+0x8] · 0x3BCAD and al,3   ; ★ 방향 = (내 방향 + n) & 3
       *   0x3BCBA  call 0x49ABC(방향)                     ;   그 방향 앞 칸
       *   0x3BCCD  call 0x11DB2 · test / jne 넘어감       ;   차 있으면 건너뛴다
       *   0x3BDAD  ebx += 2 · 0x3BDB5 cmp bx,4 / jl      ; ★ n = **1 · 3** 두 번
       *   ```
       *   ⇒ **내 방향 기준 +1 과 +3**, 곧 **양옆 두 칸**이다.
       *   ☠ 우리는 `for (di = 0; di < DIR.length; di++)` 로 **네 방향 전부**에
       *     만들고 있었다 — 최대 4 개가 나왔다. 원본은 **최대 2 개**다. */
      function 다음분신확정() {
        while (offsetIndex < offsets.length) {
          var _n = offsets[offsetIndex++];                              /* 0x3BC7B · 0x3BDAD */
          var di = ((u.dir | 0) + _n) & 3;                              /* 0x3BCA9 · 0x3BCAD */
          var nx = (u.x | 0) + DIR[di].dx, ny = (u.y | 0) + DIR[di].dy;
          /* 0x3BCCD(점유) 뒤 0x3BCE6(이동배열 == -1) 검사. 제품은 이 함수가
           * 0x169D7로 초기화한 원본 이동배열을 보존하지 않으므로 맵 경계만 동치로 확인한다. */
          if (!inMap(battle, nx, ny) || battle.at(nx, ny)) continue;
          var nextId = 0;
          battle.units.forEach(function (q) { nextId = Math.max(nextId, (q.id | 0) + 1); });
          var clone = copyValue(u);                                     // 0x3BD0A~0x3BD17: 0x88B 전부 복사
          clone.id = nextId; clone.x = nx; clone.y = ny;
          /* 방향(+0x63), waitCount(+0x56), usedOnce(+0x84)는 136B 복사값을 유지한다.
           * 원본은 좌표 외 이 셋을 초기화하지 않고, 회전 12회 뒤 방향도 제자리다. */
        clone.summonerTag = (u.charCode | 0) + 10;     // 0x3BD24 al = [+0xF] · 0x3BD27 +0xA · 0x3BD30 [+0x12]
        /* ★★★ **분신은 팀(`+0x87`)이 0 이다** — `0x3BD29 mov byte [ebx+0x87], 0` (2026-09-02)
         *   `+0x87` 은 「스크립트 캐릭터 식별 보조값」이다(`SCE_HP변경_창구.md`).
         *   `0x53AB0`·`0x53ADA` 가 `[ecx+0x87] == [ebx+0x87]` 로 **같은 인물인가**를 보므로,
         *   0 으로 두지 않으면 SCE 이벤트가 **분신을 본인으로 착각**한다.
         *   ☠ `copyValue(u)` 라 여태 원본의 팀 번호를 그대로 물려받고 있었다. */
        clone.팀 = 0;                                  // 0x3BD29
        clone.ai = clone.ai || {}; clone.ai.flag = 2; clone.ai.on = true;
          clone.alive = true;
        battle.units.push(clone); battle.setAt(nx, ny, clone); made.push(clone);
          rep.effects = ['분신 ×' + made.length];
          return clone;                                                   // 0x1134F → 0x1198D → 0x11E04 뒤 한 기씩 연출
        }
        return null;
      }
      function 분신마침() {
        if (rep.committed) return rep;
        while (다음분신확정()) { /* 비-defer 호출은 두 후보를 모두 명령 순서대로 확정 */ }
        u.usedOnce = (u.usedOnce | 0) | 2;                              // 호출부 0x4CC5A~0x4CC63
        rep.committed = true;
        if (!made.length) rep.effects = ['분신 ×0'];
        return rep;
      }
      rep.created = made;
      rep.commitNext = 다음분신확정;
      rep.finish = 분신마침;
      if (opts.defer) rep.committed = false;
      else 분신마침();
      return rep;
    }
    case 10: {                                                      // 일갈 0x3C09F
      var tauntCommitted = false;
      rep.commit = function () {
        if (tauntCommitted) return rep;
        tauntCommitted = true;
        var m = Ru.moraleTaunt(battle.morale, u.side | 0);
        battle.morale.ally = m.ally; battle.morale.enemy = m.enemy;
        rep.morale = { ally: m.ally, enemy: m.enemy };
        rep.committed = true;
        return rep;
      };
      if (opts.defer) rep.committed = false;
      else rep.commit();
      return rep;
    }
    case 11: {                                                      // 희생 0x3C12D — 상한 없음
      /* ★★★★★ **희생은 사기만 올리는 것이 아니다** (2026-09-02 · 원본 전수)
       *
       *   > 사용자 지적: 「필살기, 초필살기, 마법, 스킬 **적용 효과**와 표시되는
       *   >   이펙트, 이펙트 타이밍 등이 문제가 많아.」
       *
       *   `0x3C12D` 를 머리부터 `ret` 까지 읽었다 (`00_누락기능_목록.md` §19):
       *   ```asm
       *   0x3C132  esi = eax                     ; ★ **시전자** — 끝까지 안 바뀐다
       *   0x3C13E  [+0x64] = 8 (모션) · 0x3C149 "Wish to Win!!!" (0x48612)
       *   0x3C154  eax = 최대HP − 0xC8(200) · cmp 현재HP
       *   0x3C171    최대HP − 200 ≥ 현재HP  → edi = 0        ; ★ **등급 0**
       *   0x3C15D  cmp [+0x2B](**레벨**), 0x3C(60)
       *   0x3C16A    레벨 ≤ 60 → edi = 1 · 0x3C163 레벨 > 60 → edi = 2
       *   0x3C1B7  edx = 0x2710(10000) · 0x3C1BE call 0x2ACCB(esi)  ; ★ **회복 10000**
       *   0x3C1C3  di ≥ 1 → "Heal Wind!"(0x28883) · 0x3C1FC 0x2A75A(edx=2, **ebx=3**)
       *   0x3C201  di ≥ 2 → "Sun Light!"        · 0x3C24A 0x2A75A(edx=1, **ebx=4**)
       *   0x3C289  진영 1·2 → [0xF0BA0] += 10 · 0x3C293 진영 3 → [0xF0BA2] += 10
       *   0x3C29B  [+0x1E] = 0 (상태이상) · 0x3C2A8 [+0x15] = 0 (자세)
       *   0x3C2B0  0x1DAEE(참조 끊기) · 0x3C2B9 0x197AD(대기열에서 빼기)
       *   0x3C2CE  0x1137A(**자기 진영 리스트에 다시 넣기**)
       *   ```
       *   ★ `ebx` 3/4 는 **기도(`0x3BE93`/`0x3BE69`)와 같은 위력 갈래**다 —
       *     3 → `0x283FE[0]` **2000** 을 3회 · 4 → **0x2328** 을 4회
       *     (`case 7` 의 `prayerPower`·`prayerPulses` 와 같은 표).
       *     다른 것은 `edx`(연출 종류)뿐이다 — 기도 0 · 희생 2/1.
       *   ☠ `0x3C2A7 dec edx` 를 「진영을 낮춘다」로 읽어 **「소속 이동」이라는 없는
       *     기능**을 만들 뻔했다. 진영은 1~4·색인은 0~3 이라 **색인 변환**이다
       *     (재발방지 **R71**). 실제로는 **대기열 갱신**이다.
       *   ☐ 대기열 갱신(`0x197AD` → `0x1137A`)은 **아직 안 옮겼다** — 우리 턴 구조와
       *     대응을 확정해야 한다. */
      /* ① 등급을 **먼저** 정한다 — 원본도 회복(`0x3C1BE`)보다 앞이다
       *   `0x3C154 eax = 최대HP − 0xC8` · `0x3C159 cmp eax, 현재HP`
       *   ★ 우리 HP 는 **×100** 단위라 200 → **20000** 이다. */
      var sacBefore = u.hp | 0;
      var sacGrade = ((u.maxHp | 0) - 20000 >= sacBefore) ? 0         // 0x3C171
                   : (((u.level | 0) > 60) ? 2 : 1);                  // 0x3C163 · 0x3C16A ([+0x2B] 레벨)
      rep.sacrificeGrade = sacGrade;

      rep.sequence = ['wide-heal-c2'];
      if (sacGrade >= 1) rep.sequence.push('heal-wind');
      if (sacGrade >= 2) rep.sequence.push('sun-light');

      /* 효과를 연출 사이에 넣을 수 있게 원본 호출 경계별로 나눈다. 각 함수는 멱등이다. */
      rep.commitBase = function () {
        if (rep._baseCommitted) return rep;
        rep._baseCommitted = true;
        var before = u.hp | 0;
        applyDamage(battle, u, -10000, { reason: 'heal' });           // 0x3C1BE
        if ((u.hp | 0) !== before)
          rep.results.push({ unit: u, heal: (u.hp | 0) - before, hpAfter: u.hp | 0 });
        return rep;
      };

      /* ③ 등급별 광역 회복 — 기도(`case 7`)와 **같은 위력 갈래**를 쓴다.
       *   등급 1 → ebx 3 (0x07D0 × 3회) · 등급 2 는 그 위에 ebx 4 (0x2328 × 4회)를 더한다. */
      function 희생회복(pulses, power, 언데드제외) {
        battle.units.forEach(function (ally) {
          if (!ally.alive || hostile(u.side, ally.side, battle.confuse)) return;
          if (언데드제외 && (ally.race | 0) === 2) return;
          var b0 = ally.hp | 0;
          for (var pz = 0; pz < pulses; pz++)
            ally.hp = Math.min(ally.maxHp | 0, (ally.hp | 0) + power);
          if ((ally.hp | 0) !== b0)
            rep.results.push({ unit: ally, heal: (ally.hp | 0) - b0, hpAfter: ally.hp | 0,
                               pulses: pulses, perPulse: power });
        });
      }
      rep.commitHealWind = function () {
        if (rep._windCommitted || sacGrade < 1) return rep;
        rep._windCommitted = true;
        희생회복(3, 0x07D0, true); rep.effects.push('Heal Wind!');    // 0x3C1FC
        return rep;
      };
      rep.commitSunLight = function () {
        if (rep._sunCommitted || sacGrade < 2) return rep;
        rep._sunCommitted = true;
        희생회복(4, 0x2328, false); rep.effects.push('Sun Light!');   // 0x3C24A
        return rep;
      };
      rep.commitFinish = function () {
        if (rep._finishCommitted) return rep;
        rep._finishCommitted = true;
        var m2 = Ru.moraleSacrifice(battle.morale, u.side | 0);
        battle.morale.ally = m2.ally; battle.morale.enemy = m2.enemy; // 0x3C289 · 0x3C293
        rep.morale = { ally: m2.ally, enemy: m2.enemy };
        u.ailment = 0;                                                // 0x3C29B
        u.stance = 0;                                                 // 0x3C2A8
        return rep;
      };
      rep.commit = function () {
        rep.commitBase(); rep.commitHealWind(); rep.commitSunLight(); rep.commitFinish();
        rep.committed = true; return rep;
      };
      if (opts.defer) rep.committed = false;
      else rep.commit();
      return rep;
    }
    case 12: {                                                      // 저주 0x3C30A
      var d = DIR[u.dir & 3], t2 = battle.at(u.x + d.dx, u.y + d.dy);
      if (!t2 || !t2.alive || !hostile(u.side, t2.side, battle.confuse))
        return { ok: false, reason: '정면에 적이 없습니다' };
      if (spriteProfile(t2).statusImmune) return { ok: false, reason: '대형/특수 본체는 면역' };
      var curseCommitted = false;
      rep.target = t2;
      rep.commit = function () {
        if (curseCommitted) return rep;
        curseCommitted = true;
        var tv = view(battle, t2);
        tv.f1e |= 0x20; tv.st.d1e[3] = 60;     // 0x3C383 · 0x3C389
        commit(battle, t2, tv);
        rep.committed = true;
        return rep;
      };
      rep.effects.push('저주:' + t2.name);
      if (opts.defer) rep.committed = false;
      else rep.commit();
      return rep;
    }
    case 13: {                                                      // 빙룡소환 0x3C3A5
      if ((u.usedOnce | 0) & 4) return { ok: false, reason: '이번 전투에 이미 빙룡소환을 사용했습니다' };
      var cv = view(battle, u);
      var iceCommitted = false;
      rep.deaths = [];
      rep.commit = function () {
        if (iceCommitted) return rep;
        iceCommitted = true;
        battle.units.slice().forEach(function (enemy) {
          if (!enemy.alive || !hostile(u.side, enemy.side, battle.confuse)) return;
        /* ★★★★★ **날씨를 넘긴다** — `0x3C465 call 0x28728` → `0x28768 call 0x285E4` (2026-09-03)
         *   빙룡소환은 `attr: 1`(빙한)이라 **날씨 2(눈)에서 피해가 +50 %** 여야 한다
         *   (`0x286C1 cmp [0xBA84D],2` · `0x286CA cmp [esp+0x10],1` · `0x286E3 add ecx,0x32`).
         *   `timeOfDay` 를 안 넘겨 그 보정이 통째로 빠져 있었다. */
        var dmg = Ru.magicDamage(cv, view(battle, enemy),
          { power: 0x1770, div: 0x32, attr: 1 },
          { tables: battle.T, timeOfDay: battle.timeOfDay | 0,
            deriveC: eff(battle, u), deriveD: eff(battle, enemy), rng: opts.rng });
        var rr = applyDamage(battle, enemy, dmg, { killer: u, reason: 'ice-dragon' });
        /* ★ 빙결은 «확률» — 0x3C49A 0x29437(시전자, edx=2 빙결, ebx=0x1E 기본 30, ecx=2 칸) · 목록 밖 적대(그림 300 미만)는 0x3C4AD 0x2A5BE 같은 판정
         *   (2026-09-26 사장님 「화룡소환 빙룡소환 상태이상 확률도 이상해」 · ☠ 예전에는 살아남은 적 모두에게 100% 걸었다) · 활 뇌 감전(0x29437 비트 4)과 같은 함수 */
        if (!rr.died && enemy.alive) {
          var ecv = view(battle, u), ev = view(battle, enemy);
          if (Ru.statusApply(ecv, ev, 2, 0x1E, 2, { tables: battle.T, rng: opts.rng })) {
            ev.hp = enemy.hp | 0; ev.mp = enemy.mp | 0;
            commit(battle, enemy, ev);
            빙결대기열빼기(battle, enemy);                                     // 정본 421 — 빙룡 빙결도 0x29437 → 0x197AD
          }
        }
          rep.results.push({ unit: enemy, damage: dmg, died: rr.died });
          if (rr.died) rep.deaths.push(enemy);
          if (rr.died && rr.kill && rr.kill.exp) (rep.exp || (rep.exp = [])).push(rr.kill.exp);   /* 위 소용돌이 주석과 같다 */
        });
        u.usedOnce = (u.usedOnce | 0) | 4;
        return rep;
      };
      rep.effects.push('Ice Dragon!');
      if (!opts.defer) rep.commit();
      return rep;
    }
    /* ★ [리마스터] 18 화룡소환 (Z-91 · 2026-09-26 사장님) — 빙룡소환(13 · 0x3C3A5)과 같은 틀 · 속성만 «화염»(사장님 「화염 속성」)
     *   피해 0x28728 → magicDamage(위력 6000 · 나눔 50 · attr 0) — 빙룡과 같은 값 · 적 전원
     *   살아남으면 화상(비트 1) 확률 판정 — 빙룡의 빙결 0x29437(비트 2 · 기본 30 · 칸 2)과 같은 함수에 «화염 짝»
     *   한 전투에 한 번 — usedOnce 비트 8 (원본은 2 분신 · 4 빙룡만 쓴다 · ring.js 0x84 주석) */
    case 18: {
      if ((u.usedOnce | 0) & 8) return { ok: false, reason: '이번 전투에 이미 화룡소환을 사용했습니다' };
      var fcv = view(battle, u);
      var fireCommitted = false;
      rep.deaths = [];
      rep.commit = function () {
        if (fireCommitted) return rep;
        fireCommitted = true;
        battle.units.slice().forEach(function (enemy) {
          if (!enemy.alive || !hostile(u.side, enemy.side, battle.confuse)) return;
          var fdmg = Ru.magicDamage(fcv, view(battle, enemy),
            { power: 0x1770, div: 0x32, attr: 0 },
            { tables: battle.T, timeOfDay: battle.timeOfDay | 0,
              deriveC: eff(battle, u), deriveD: eff(battle, enemy), rng: opts.rng });
          var frr = applyDamage(battle, enemy, fdmg, { killer: u, reason: 'fire-dragon' });
          /* 화상도 빙룡과 같은 확률 판정 — 0x29437 비트 1 · 기본 30 · 칸 2 (빙룡 0x3C49A 의 «화염 짝») */
          if (!frr.died && enemy.alive) {
            var fcv2 = view(battle, u), fev = view(battle, enemy);
            if (Ru.statusApply(fcv2, fev, 1, 0x1E, 2, { tables: battle.T, rng: opts.rng })) {
              fev.hp = enemy.hp | 0; fev.mp = enemy.mp | 0;
              commit(battle, enemy, fev);
            }
          }
          rep.results.push({ unit: enemy, damage: fdmg, died: frr.died });
          if (frr.died) rep.deaths.push(enemy);
          if (frr.died && frr.kill && frr.kill.exp) (rep.exp || (rep.exp = [])).push(frr.kill.exp);   /* 소용돌이 주석과 같다 */
        });
        u.usedOnce = (u.usedOnce | 0) | 8;
        return rep;
      };
      rep.effects.push('Fire Dragon!');
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 14: {                                                      // 배리어 0x3C4C1
      var it = Ru.itemField(battle.T, (u.gear || {}).shield | 0, '종류');
      if (it !== 6) return { ok: false, reason: '방패가 필요합니다' };
      if ((u.ailment | 0) & 2) return { ok: false, reason: '행동 불능' };
      if ((u.ailment | 0) & 4) return { ok: false, reason: '이미 방어 자세입니다' };
      /* 0x3C4EA~0x3C53C: 방향을 0으로 보이는 구간은 presenter가 맡고,
       * Defense! 및 32틱이 끝난 뒤 방향 복원과 [+0x14]|=4를 함께 확정한다. */
      var barrierCommitted = false;
      rep.originalDir = u.dir | 0;
      rep.target = u;
      rep.commit = function () {
        if (barrierCommitted) return rep;
        barrierCommitted = true;
        u.dir = rep.originalDir | 0;
        u.f14 = (u.f14 | 0) | 4;
        rep.committed = true;
        return rep;
      };
      rep.effects.push('무조건 방어');
      if (!opts.defer) rep.commit();
      return rep;
    }
    case 16: {                                                      // 마장기 소환·해제 0x3C548
      if (u._mechaSnapshot) {
        var mid = u.id, mx = u.x | 0, my = u.y | 0, md = u.dir | 0, mtp = u.tp | 0;
        /* 해제 소멸(0x46710)은 **마장기 그림**을 지운다 — 복원 전에 그림 번호를 남긴다 */
        rep.mechaSpr = u.sprIndex | 0;
        var human = copyValue(u._mechaSnapshot), 참조 = u._mechaRefs || null;
        battle.unplace(u); Object.keys(u).forEach(function (k) { delete u[k]; });
        Object.keys(human).forEach(function (k) { u[k] = human[k]; });
        u.id = mid; u.x = mx; u.y = my; u.dir = md; u.tp = mtp;
        if (참조) Object.keys(참조).forEach(function (k) { if (참조[k] !== undefined) u[k] = 참조[k]; });   // 0x1808A 사본 전체
        u._mechaSnapshot = null; u.alive = true; battle.setAt(mx, my, u);
        rep.mechaAction = 'release'; rep.effects.push('마장기 해제'); rep.newActor = u;
        return rep;
      }
      /* 0x4CCB4~0x4CD34 호출부는 캐릭터 코드 [+0x0F]만 검사한다.
       * 무기 조건과 카심(0x73) 갈래는 원본에 없다. */
      var summon = 마장기소환찾기(battle, u);
      if (!summon) return { ok: false, reason: '이 캐릭터는 마장기를 소환할 수 없습니다' };
      /* 0x3C565 ebx=3 → 0x49ABC 갈래 3은 x만 +1한다. 그 칸이 점유됐거나
       * 이동 배열 값이 -1이 아니면 0을 반환하고 아무것도 바꾸지 않는다. */
      var effectAt = { x: (u.x | 0) + 1, y: u.y | 0 };
      if (effectAt.x < 0 || effectAt.y < 0 || effectAt.x >= battle.W || effectAt.y >= battle.H ||
          battle.at(effectAt.x, effectAt.y) ||
          (root.G2Move && !root.G2Move.canStand(battle, u, effectAt.x, effectAt.y, u.dir, null)))
        return { ok: false, reason: '오른쪽 소환 칸이 비어 있지 않습니다' };
      /* ★★★★★ **원본 표 `0x72E9A`** — 확정 (2026-08-30)
       *
       *   `0x17D82(eax=유닛, dx=종류)` 가 탈것 번호로 표를 색인한다 —
       *   ```asm
       *   0x17D8C  bl = [eax+0x5C]            ; 탈것 번호
       *   0x17D91  ebx <<= 4                  ; ★ **16바이트 간격**
       *   0x17D97  bx = [ebx + 0x72E9A]       ; ★ 상한 (힘/민첩 캡)
       *   0x17D9E  cmp dx, bx / jle           ;   min(스탯, 상한)
       *   0x17DB0  dx += [eax + 0x72EA0]      ; ★ 더하는 값 (+6 칸)
       *   ```
       *
       *   실측 (`0x72E9A + 탈것×16`, word):
       *     0x0F 아바레스트  70  70  800  200
       *     0x10 아론다이트  80  50 1000  250
       *     0x14 가리우스    75  60  700  220
       *     0x15 라          80  70  800  220
       *                     [0] [1]  [2]  [3]
       *      ⇒ [0] 힘 상한 · [1] 민첩 상한 · [2] HP · [3] 더하는 공격력
       *
       *   아래 표는 **같은 값**을 `[힘상한, 공격력+, HP, 민첩상한, ?]` 순으로 담은 것이다. */
      var MOUNT = {
        0x0F: [70, 200, 800, 70, 170], 0x10: [80, 250, 1000, 50, 200],
        0x14: [75, 220, 700, 60, 160], 0x15: [80, 220, 800, 70, 170],
        /* [리마스터] 2급 — 같은 표 0x72E9A + 탈것×16 실측(실험본 COMBATII.EXE): 0x11 50 32 384 E6 · 0x12 3C 3C 1F4 AA · 0x13 3C 32 226 B4 · 0x16 41 3C 258 D2 (다섯째 칸은 쓰지 않는다) */
        0x11: [80, 230, 900, 50, 0], 0x12: [60, 170, 500, 60, 0],
        0x13: [60, 180, 550, 50, 0], 0x16: [65, 210, 600, 60, 0]
      };
      var spec = MOUNT[summon.code], snapshot = copyValue(u), job = battle.T['직업'][summon.code + 95] || {};
      /* 0x3C5B9 0x11EE4: 변신과 소환 연출 동안 기존 점유를 먼저 뺀다. live list의
       * 레코드는 그대로이며, 0x112FD 결과는 [+0x77] 복원 사본일 뿐 live 편입이 아니다. */
      var ox = u.x | 0, oy = u.y | 0;
      battle.unplace(u);
      u._mechaSnapshot = snapshot;
      /* ★ 2026-09-24 (Z-30) — 사본(copyValue)은 `_raw`·`_shim`·`_표`·`_cv` 를 **복제 제외**한다(복제제외 표).
       *   해제가 유닛을 비우고 사본을 부으면 이 넷이 사라져, 해제 뒤 능력치(`_shim` → Rules.derive)·
       *   이동 깃발(`_raw` 플래그14)·탑승 복원이 소환 전과 달라졌다. 원본 0x1808A 는 136바이트
       *   사본 전체를 되돌린다 — 참조를 따로 들고 있다가 해제 때 그대로 되돌린다. */
      u._mechaRefs = { _raw: u._raw, _shim: u._shim, '_표': u['_표'], _cv: u._cv };
      사람참조되돌리기(snapshot, u._mechaRefs);                   /* 보관 몸에도 — 탄 동안 레벨업 성장이 사람 장비 보정으로 (2026-10-05) */
      /* 마장기 동안 판정(turn.js shimOf 는 base·equip 을 재활용)이 사람 장비를 읽지 않게 —
       *   0x17E6D 가 비우는 칸(방패·무기·보조)을 _shim 에서도 비운 **새 객체**를 쓴다. 해제 때 원래 것으로. */
      if (u._shim) {
        var 마장기shim = {}; Object.keys(u._shim).forEach(function (k) { 마장기shim[k] = u._shim[k]; });
        마장기shim.equip = { shield: 0, weapon: 0, accessory: (u._shim.equip || {}).accessory | 0, sub1: 0, sub2: 0 };
        u._shim = 마장기shim;
      }
      /* ★ 2026-09-24 (사장님: 「마장기 소환시 방향은 남쪽을 바라보는걸로 고정이야」)
       *   0x3C604 `mov byte [ebp+0x63], 0` — 변환(0x17E6D) 직전에 방향을 0(남)으로 세운다.
       *   사본(0x112FD)은 그 앞이라 해제 때는 원래 방향으로 돌아온다. */
      u.dir = 0;
      u.gear.mount = summon.code; u.gear.shield = 0; u.gear.weapon = 0; u.gear.sub = 0;
      u.job = summon.code + 95; u.sprIndex = summon.code + 299; u.rider = null;   // 0x17E87 add al,0x5F(95) · 0x17E7C add eax,0x12B(299)
      u.rawAtk = Math.min((snapshot.base || {}).str | 0, spec[0]) + spec[1];
      u.rawDef = job['기본방어력'] | 0; u.rawMr = job['표71B68_2'] | 0;
      var _탈상한없음 = !!(root.Opt && root.Opt.cfg && root.Opt.cfg['탈것TP상한없음'] === '리마스터');   /* [리마스터] opt.js 탈것TP상한없음 */
      u.rawMaxTp = Math.max(60, (_탈상한없음 ? ((snapshot.base || {}).dex | 0) : Math.min((snapshot.base || {}).dex | 0, spec[3])) + (job['표71B68_3'] | 0));   // 0x17F2E cmp ax,0x3C → 0x17F34 [+0x54]=0x3C (하한 60)
      u.maxHp = spec[2] * 100; u.hp = u.maxHp; u.mp = 0; u.maxMp = 0;
      u.base.atk = u.rawAtk; u.base.def = u.rawDef; u.base.mr = u.rawMr; u.base.maxTp = u.rawMaxTp;
      u.equip = { atk: 0, def: 0, mr: 0, maxTp: 0 };
      u.eff = { atk: u.rawAtk, def: u.rawDef, mr: u.rawMr, maxTp: u.rawMaxTp,
                str: (snapshot.base || {}).str | 0, int: (snapshot.base || {}).int | 0,
                agi: (snapshot.base || {}).dex | 0, cha: (snapshot.base || {}).cha | 0,
                weaponType: job['무기종류'] | 0 };
      var mechaFinished = false;
      rep.commitFinish = function () {
        if (mechaFinished) return rep;
        mechaFinished = true;
        battle.setAt(ox, oy, u);                                    // 0x3C6D5~0x3C6DF 0x11E04
        rep.committed = true;
        return rep;
      };
      /* ★ 2026-09-24 (사장님: 「마장기 소환은 기본적으로 맵에서 1회만 가능해」)
       *   0x4CCE2/0x4CD06/0x4CD2E — 0x3C548 이 1을 돌려주면 캐릭터별 깃발
       *   [0xFD8BC](라시드)·[0xFD8BE](랜담)·[0xFD8C0](알시온) = 1. 링 메뉴(0x4C23B~0x4C270)는
       *   깃발이 0일 때만 소환 아이콘을 넣는다 — 해제·파괴 뒤에도 그 맵에서는 다시 안 뜬다.
       *   깃발은 전투마다 새로 선다(전투 객체에 둔다). */
      (battle.마장기소환깃발 || (battle.마장기소환깃발 = {}))[u._mechaSnapshot.charCode | 0] = 1;
      rep.mountCode = summon.code; rep.mechaAction = 'summon'; rep.effectAt = effectAt;
      rep.originalAt = { x: ox, y: oy }; rep.committed = false;
      rep.effects.push('마장기 소환'); rep.newActor = u;
      return rep;
    }
    case 17: {                                                      // 사기업 0x4CD39
      /* ★★★★★ **원본을 `ret` 까지 읽고 두 가지를 고쳤다** (2026-09-01)
       *
       *   ```asm
       *   0x4CD39  dx = [0xF0BA0](사기) ; cmp dx, 0x96(150) ; jge 0x4CD67  ; ★ 들어갈 때만 본다
       *   0x4CD4C    [0xF0BA0] = dx + 2                       ; ☠ 자르지 않는다
       *   0x4CD55    cmp [eax+0x5D], 0x4E(장신구) ; jne 0x4CD67
       *   0x4CD60    [0xF0BA0] = 그 + 2                       ; ☠ 여기도 안 자른다
       *   0x4CD67  ← 두 분기가 모두 여기로
       *   0x4CDA3  call 0x1A0E9                               ; ★ 현재 TP
       *   0x4CDAD  call 0x45B4E                               ; ★ TP 게이지 연출
       *   0x4CDB2  call 0x53E0F ; xor eax,eax ; pop ×3 ; ret
       *   ```
       *
       *   ① ☠ **`Math.min(150, …)` 이 원본에 없다.** 원본은 **들어가기 전에만** 150 을 보고,
       *      더한 뒤에는 검사가 없다. ⇒ 149 에서 쓰면 **151**(장신구 있으면 **153**).
       *      ★ 「원본도 어딘가에서 자르는 것 아닌가」를 **전수로 확인해 반증했다** —
       *        `[0xF0BA0]` 에 쓰는 자리 **네 곳** 중 셋만 자른다:
       *          `0x1DC63` 하한 50 · `0x1DCE0` **상한 150** · `0x3C10B` 하한 50 ·
       *          **`0x4CD4C`(사기업) 아무 검사도 없다.**
       *        곧 **일부러 안 자르는 것**이다.
       *   ② ☠ **TP 소모가 아예 없었다.** 원본 꼬리가 `0x1A0E9`(현재 TP) → `0x45B4E`
       *      (TP 게이지 연출)를 부른다. `0x4CD8F`~`0x4CDA3` 로 **뛰어드는 곳이 0 곳**이라
       *      (전수 확인) 이 꼬리는 **`case 17` 전용**이다 — 다른 스킬이 공유하지 않는다. */
      var own = ((u.side | 0) === 1 || (u.side | 0) === 2) ? 'ally' : 'enemy';
      var m0 = battle.morale[own] | 0;
      if (m0 < 150) {                                               // 0x4CD40 cmp dx,0x96 / jge
        var add = 2 + ((((u.gear || {}).charm | 0) === 0x4E) ? 2 : 0);   // 0x4CD4C · 0x4CD60
        battle.morale[own] = m0 + add;                              // ☠ 자르지 않는다
        rep.effects.push('사기 +' + add);
      }
      /* ★ TP 전액 소모 + 게이지 연출 — 0x4CDA3 → 0x4CDAD.
       *   ☠ **150 이상이어서 사기가 안 올라도 돈다** — 원본의 `jge` 목적지(`0x4CD67`)가
       *     이 꼬리 **앞**이기 때문이다. 「효과가 없으면 TP 도 안 쓴다」가 아니다. */
      rep.tpCost = u.tp | 0;                                        // 0x1A0E9 현재 TP
      rep.tpGauge = true;                                           // 0x45B4E 게이지 연출
      rep.moraleBefore = m0;
      rep.moraleAfter = battle.morale[own] | 0;
      rep.moraleChanged = rep.moraleAfter !== m0;
      rep.morale = { ally: battle.morale.ally, enemy: battle.morale.enemy };
      return rep;
    }
    default:
      return { ok: false, todo: true,
               reason: '기술 ' + skillNo + ' 번 (중독) 은 아직 안 만들었습니다' };
      /* ★★★★★ **2026-08-29 — 여기로 오는 것은 스킬 3(중독) 하나뿐이다.**
       *   위 `case` 를 세니 **0~17 중 3 만 빠졌다**(17개 구현).
       *   `ring.js` 가 `active(…, 2) === 1` 일 때 `out.push(3)` — 곧 **중독**이다.
       *
       *   원본 입구를 찾았다 — 필살기 함수표 `0xF1474` 의 **슬롯 3 = `0x2F592`**
       *   (`node 04_도구/EXE_필살기함수표_0x81474.js --전부`):
       *   ```asm
       *   0x2F592  ecx = [0x4498] sar 16 · ebx = dx · edx = 0
       *   0x2F5A2  jmp 0x2F6FE → call 0x2EB61 · ret     ; 아주 짧다
       *   0x2EB61  edx += 6 · call 0x2CBFB · edx = 3    ; ★ 갈래 3
       *   ```
       *   ☐ `0x2CBFB` 안까지는 아직 안 읽었다. **값을 지어내지 않는다.** */
  }
}

/* ══════════════════════════════════════════ 8. 내보내기 */

var G2Combat = {
  VERSION: '1.0 (COMBATII.EXE 대조)',
  표시연결: 표시연결,

  /* 사양서에 적힌 8개 */
  attack: attack,
  attack계획: attack계획,      /* ★ 0x1F738 대상 확정까지 (S3 앞) */
  attack실행: attack실행,      /* ★ S3 뒤 · 0x1ED45 앞 */
  attack반격: attack반격,      /* ★ 0x1ED45 뒤 — 반격(0x1EF9A) + TP */
  special: special, ultimateIndexOf: ultimateIndexOf,
  sceDirectMagic: sceDirectMagic,
  cast: cast,
  skill: skill,
  applyDamage: applyDamage,
  counter: counter,
  조련해금목록: 조련해금목록, 조련목록: 조련목록, 레벨올리기: 레벨올리기,
  kill: kill, 사망상태지우기: 사망상태지우기, unmount: unmount, 아이템경험: 아이템경험, 리마스터경험정산: 리마스터경험정산, _보조경험: 보조경험,
  rangeOf: rangeOf,

  /* 곁가지 — ai.js · 테스트가 씁니다 */
  view: view, commit: commit, eff: eff, critBag: critBag,
  weaponTypeOf: weaponTypeOf, attackAttr: attackAttr,
  attackCells: attackCells, specialCells: specialCells, ultimateCells: ultimateCells,
  knockback: knockback, specialKnocks: specialKnocks,   /* 0x2E896 — 비·투·붕 */
  ultimatePickCells: ultimatePickCells,        /* ★ 고르는 범위 — 닿는 범위와 다르다 */
  musinPlan: musinPlan, musinNextTarget: musinNextTarget,
  musinCommitPosition: musinCommitPosition,              /* 0x382E9~0x38303 실제 위치 이동 검증용 */
  diamond: diamond, line: line, dist: dist, hostile: hostile, 비행막음: 비행막음, 공격시작칸: 공격시작칸, 원본직선: 원본직선, 신소환: 신소환, 마법검쏘기: 마법검쏘기,   /* 대본 공격(controller _SCE공격연출)도 크리티컬이면 마법검 — 원본 0x1E989 (11-11) */
  fanCells: fanCells, bowRange: bowRange,
  isMageWeapon: isMageWeapon, MAGE_FAN_R: MAGE_FAN_R,
  neighborsOf: neighborsOf, supportOn: supportOn, strike: strike,
  활시야칸: 활시야칸,
  weaponStatus: weaponStatus, weaponStatusAttr: weaponStatusAttr,
  isNoAttrWeapon: isNoAttrWeapon, NO_ATTR_WEAPONS: NO_ATTR_WEAPONS,
  SPECIAL_X: SPECIAL_X, SPECIAL_EFFECT_ONLY: SPECIAL_EFFECT_ONLY,
  specialA: specialA, slotGroup: slotGroup,
  spellParts: spellParts, seriesAttr: seriesAttr, 마장기소환표: 마장기소환표, 이급마장기표: 이급마장기표, 마장기소환찾기: 마장기소환찾기, 소환자리있나: 소환자리있나, 조련후보칸: function (b, u, 고름) { return 조련후보칸(b, u, 고름); },
  magicRadius: magicRadius, specialRadius: specialRadius, magicTargeting: magicTargeting,
  /* ★ 선택 시스템 ↔ 효과 시스템 분리 (2026-08-15) */
  magicPick: magicPick, magicPicksTile: magicPicksTile,
  magicEffectCells: magicEffectCells, aoeShape: aoeShape,
  aoeShape: aoeShape, gatherMagicTargets: gatherMagicTargets,
  DIR: DIR
};

root.G2Combat = G2Combat;
if (typeof module !== 'undefined' && module.exports) module.exports = { G2Combat: G2Combat };

})(typeof globalThis !== 'undefined' ? globalThis : window);
