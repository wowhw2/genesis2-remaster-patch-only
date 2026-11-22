/* ============================================================================
 * 창세기전 2 (1996, SOFTMAX) — 전투 규칙 참조 구현
 * COMBATII.EXE 디스어셈블에서 그대로 옮긴 순수 함수 모음. 외부 의존 없음.
 *
 *   사양서 : 03_분석/COMBATII/전투로직_사양.md
 *   표     : 02_실행기/게임/자산/tables.json  (인자 `T` 로 넘겨 씁니다)
 *   검증   : 02_실행기/게임/js/rules.test.html
 *
 * 주소 표기는 전부 평탄화 VA (04_도구/g2dis.py 기준) 입니다.
 *
 * 단위 약속 — 원본과 같습니다.
 *   HP  : [+0x48] · [+0x4C] 는 실제 HP × 100. 피해 함수도 ×100 값을 돌려줍니다.
 *   상성: ×10 배율 (10 = 100 %)
 *   사기: 100 = 100 %
 *
 * 쓰는 법 (고전 스크립트 · file:// 에서도 됩니다)
 *   <script src="rules.js"></script>  →  globalThis.Rules
 * ESM 으로 쓰시려면 한 줄짜리 래퍼를 두십시오.
 *   rules.mjs :  import './rules.js'; export const Rules = globalThis.Rules;
 * ==========================================================================*/
(function (root) {
'use strict';

var SpriteSemantics = root.G2SpriteSemantics;
if (!SpriteSemantics && typeof require === 'function') SpriteSemantics = require('./sprite_semantics.js');
if (!SpriteSemantics) throw new Error('rules: G2SpriteSemantics가 먼저 필요하다');
function spriteProfile(v) { return SpriteSemantics.profile(v); }
function spriteBodyClass(v) { return SpriteSemantics.bodyClass(v); }
function isSpecialBody(v) { return SpriteSemantics.isSpecialBody(v); }
function isOrdinaryBody(v) { return SpriteSemantics.isOrdinaryBody(v); }
function isStatusImmune(v) { return SpriteSemantics.isStatusImmune(v); }
function isMagicEffectExcluded(v) { return SpriteSemantics.isMagicEffectExcluded(v); }
function isKnockbackImmune(v) { return SpriteSemantics.isKnockbackImmune(v); }
function isCommandRestricted(v) { return SpriteSemantics.isCommandRestricted(v); }
function usesSpecialMotion(v) { return SpriteSemantics.usesSpecialMotion(v); }
function usesSpecialDeath(v) { return SpriteSemantics.usesSpecialDeath(v); }
function isMountBody(v) { return SpriteSemantics.isMountBody(v); }
function needsLargeVisual(v) { return SpriteSemantics.needsLargeVisual(v); }
/* 외부/옛 검증기 호환 alias */
function spriteSizeClass(v) { return spriteBodyClass(v); }
function isLargeSprite(v) { return isSpecialBody(v); }
function isOrdinarySprite(v) { return isOrdinaryBody(v); }

/* ───────────────────────────────────────────────────────── 0. 잡동사니 */

/** 부호 있는 8비트. tables.json 의 아이템 보정 칸은 전부 unsigned 로 저장돼 있고
 *  원본은 `cbw` / `movsx` 로 읽으므로 반드시 통과시켜야 합니다. */
/* `127` 은 **부호 있는 8비트 경계**다 — 이 파일 머리 「단위 약속」대로
 *  아이템 보정 칸은 unsigned 로 저장되고 원본은 `cbw`/`movsx` 로 읽는다.
 *  근거 — `전투로직_사양.md` · 쓰이는 자리 보기 `0x2CB3B`(피해 계산). */
function s8(v) { v = v | 0; return v > 127 ? v - 256 : v; }
/**
 * 부호 있는 16비트 — 원본 `movsx …, ax` 계열.
 *
 * ★★★ **16비트로 자른 뒤 부호를 확장한다** (2026-08-26 · 리팩토링 6단계 A6)
 *   전에는 `v | 0` 뒤 `v > 32767 ? v − 65536 : v` 였다. 그러면 **16비트 밖 입력을
 *   안 자른다** — `s16(-32769)` 가 `-32769` 로 그대로 나왔다.
 *   원본 `movsx` 는 `ax`(하위 16비트)만 보므로 **`32767`** 이 맞다.
 *   ★ A6 differential 로 잡았다 — `게임/js/jobchange.js`·`jobtable.js` 는 이미
 *     `(v & 0xFFFF) << 16 >> 16` 이었고 **그쪽이 원본에 맞았다.**
 *   ★ 실사용(`:418` 사기 100 안팎)은 16비트 안이라 **값이 안 바뀐다.**
 *   시험: `04_도구/A6_순수유틸.test.js`
 */
function s16(v) { return (v & 0xFFFF) << 16 >> 16; }

/** 0 쪽으로 자르는 나눗셈. 386 의 `idiv` 와 같습니다.
 *  JS 의 Math.floor 는 음수에서 다르게 굴러 피해 계산이 1씩 어긋납니다. */
function idiv(a, b) { const q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

/** 0x499BD — rand(n) = 난수 % n, n 이 0 이면 0.
 *  기본 구현은 xorshift32. 재현이 필요하면 seed 를 주십시오. */
function makeRng(seed) {
  let s = (seed === undefined ? 0x2CA40 : seed) >>> 0 || 1;
  function raw() {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s >>>= 0;
    return s;
  }
  const f = function (n) { n = n | 0; return n === 0 ? 0 : (raw() % n); };
  f.raw = raw;
  return f;
}

/** 표에서 아이템 레코드 한 칸 꺼내기 — 0x184A4.
 *  아이템 코드 0 (맨손·미착용) 이면 0 을 돌려줍니다. 코드 = ITEM.DAT 색인 + 1. */
function itemField(T, code, key) {
  if (!code) return 0;                       // 0x184A7 test ax,ax / xor al,al
  const rec = T['아이템'] && T['아이템'][code - 1];
  if (!rec) return 0;
  const v = rec[key];
  return v === undefined ? 0 : v;
}
/** 부호 있는 아이템 칸 (능력치 보정 계열은 전부 이쪽). */
function itemFieldS(T, code, key) { return s8(itemField(T, code, key)); }

/** 상성 칸(ITEM +0x3A ~ +0x41). tables.json 에서는 이미 signed 로 뽑혀 있습니다. */
function itemAffinity(T, code, attr) {
  if (!code) return 0;
  const rec = T['아이템'] && T['아이템'][code - 1];
  if (!rec || !rec['상성']) return 0;
  return rec['상성'][attr] | 0;
}

function job(T, n) { return (T['직업'] && T['직업'][n]) || null; }

/* ───────────────────────────────────────────────────── 1. 유닛 모형 */
/* 원본 레코드는 파생 능력치를 레코드 안에 캐시해 둡니다(+0x44 공격력 …).
 * 여기서는 **사용자 요구대로 기본 / 장비 / 버프 세 층을 따로 두고 합산**합니다.
 * 층만 분리했을 뿐 합산 결과는 0x1796B 와 같습니다.
 *
 *   unit = {
 *     job, charCode, faction, level, race, mount, sprite,
 *     base : { str, int, agi, cha, defBonus?, mrBonus?, tpBonus?, atkBonus? },
 *     equip: { shield, weapon, accessory, sub1, sub2 },   // 아이템 코드(0 = 없음)
 *     buff : { str,int,agi,cha, atk, def, mr, tp },       // 마법·스킬이 얹는 값
 *     hp, maxHp, mp, maxMp,                               // ×100 (hp/maxHp)
 *     dir, x, y,
 *     f13, f14, f15, f1e,                                 // 상태 비트 4칸
 *     st: { d15:[0,0,0,0], d1e:[0,0,0,0,0] },             // 잔여 턴
 *     wait,                                               // [+0x56] 재행동 대기 (255 = 행동 가능)
 *     critRow, critPos,                                   // [+0x2C] [+0x2D]
 *     spRank, spRow, spPos,                               // [+0x35] [+0x36] [+0x37]
 *     exp, wexp, mexp, spLv:[검,창,부,궁,권], magicClass:[7]
 *   }
 */
function newUnit(o) {
  o = o || {};
  return Object.assign({
    job: 0, charCode: 0, faction: 1, level: 1, race: 0, mount: 0, sprite: 0,
    base: { str: 0, int: 0, agi: 0, cha: 0 },
    equip: { shield: 0, weapon: 0, accessory: 0, sub1: 0, sub2: 0 },
    buff: {},
    /* ★ `10000` 은 **HP 100.00** 이다 — 이 파일 머리 「단위 약속」대로
     *   HP 는 `[+0x48]`·`[+0x4C]` 에 **실제 HP × 100** 으로 넣는다.
     *   같은 파일 `specialHpPay` 가 `0x301EC` 에서 `u.hp − 100` 을
     *   「최소 1 HP 보존」으로 쓴다 — 곳 100 = 1 HP · 10000 = 100 HP. */
    hp: 10000, maxHp: 10000, mp: 0, maxMp: 0,
    dir: 0, x: 0, y: 0,
    f13: 0, f14: 0, f15: 0, f1e: 0,
    st: { d15: [0, 0, 0, 0], d1e: [0, 0, 0, 0, 0] },
    wait: 255,
    critRow: 0, critPos: 0,
    spRank: 4, spRow: 0, spPos: 0,
    exp: 0, wexp: 0, mexp: 0,
    spLv: [0, 0, 0, 0, 0], magicClass: [0, 0, 0, 0, 0, 0, 0],
    escort: false                       // [+0x77] 부속유닛(탑승) 여부
  }, o);
}

/* ────────────────────────────────────────────── 1-2. 능력치 파생 (0x1796B) */

/** 0x174CF — 무기 종류.
 *  0 권(맨손) · 1 검 · 2 지팡이 · 3 창 · 4 부(도끼) · 5 궁 · 6 이상 특수.
 *  탈것 1~4 를 타고 있고 탑승자 직업이 0x17 이면 5. */
function weaponType(u, T) {
  if (u.mount >= 1 && u.mount <= 4 && u.job === 0x17) return 5;
  const j = job(T, u.job);
  return j ? (j['무기종류'] | 0) : 0;
}

/** 장비 3칸(무기 +0x5B · 방패 +0x5A · 장신구 +0x5D) 합산 — 0x184F9. */
/* ★ [리마스터] **윈드 부츠(104) TP 보정 30** (2026-11-13 · 사장님 「윈드부츠가 너무 쓸모없는 아이템으로 보여. tp 수치를 좀 높여야 할 것 같아. 30정도로」 · 정본 148)
 *   원작 ITEM.DAT +0x30 은 1. ITEM.DAT 는 안 고치고 읽는 자리(최대 TP 0x179E3 = 직업값 + 민첩 + 아이템 TP)에서만 토글 «윈드부츠TP30»(기본 켬)을 본다 */
const 아이템TP덮기 = { 104: 30 };
function itemTP(T, code) {
  const 덮 = 아이템TP덮기[code | 0];
  if (덮 !== undefined) {
    const O = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;
    if (!O || O['윈드부츠TP30'] !== '원작') return 덮;
  }
  return itemFieldS(T, code, 'TP');
}
function equipSum3(u, T, key) {
  if (key === 'TP') return itemTP(T, u.equip.weapon) + itemTP(T, u.equip.shield) + itemTP(T, u.equip.accessory);
  return itemFieldS(T, u.equip.weapon, key)
       + itemFieldS(T, u.equip.shield, key)
       + itemFieldS(T, u.equip.accessory, key);
}

/**
 * 0x1796B — 파생 능력치 재계산.  세 층을 각각 돌려주고 합계도 함께 냅니다.
 *
 * @param {object} u    유닛
 * @param {object} T    tables.json
 * @param {object} [opt] { shieldDefense:true }  방패의 방어 보정을 방어력에 넣을지.
 *        원본은 **두 경로가 서로 다릅니다** — 사양서 §1.3 참고.
 *          0x1796B (레벨업·전직 재계산) : 0x184F9 로 3칸을 다 더하므로 **방패 포함**
 *          0x181A6 (장비 착용/해제)     : 0x18212 `test si,si / je` 로 **방패 제외**
 *        기본값 false = 방패 제외 ([리마스터] 2026-10-02 · 방패는 막기 때만). true 면 0x1796B 쪽.
 */
function derive(u, T, opt) {
  /* ★ [리마스터] 방패는 방어(막기 0x1E0F5 shieldDef)에서만 쓴다 — 방어력에 안 더한다 (2026-10-02 사장님 「방패는 방어력 합산이 안돼」 · 「방패는 방어시에만 적용되어야해」)
   *   원본 0x181A6 착용 경로(0x18212 test si,si)와 같은 쪽. 0x1796B 레벨업 쪽(방패 포함)을 보려면 { shieldDefense:true } */
  const withShield = !!(opt && opt.shieldDefense === true);
  if (!u.equip) u = Object.assign({}, u, { equip: {} });   /* 정본 377 — 장비 칸 없는 사본이면 맨손으로 센다(전투가 «undefined 의 weapon» 으로 멈추지 않게) */
  const j = job(T, u.job) || {};
  const b = u.base || {}, f = u.buff || {};

  // — 1차 능력치 : 기본 + 장비(ITEM +0x28~+0x2B) + 버프.  원본은 8비트 덧셈이라
  //   255 를 넘기면 되돌아갑니다(능력치_설계.md). 재현하려면 opt.wrap8 을 켜십시오.
  /* ★★★ §4 — **위로는 안 감기고 아래로만 0** (2026-09-16 사장님 지정)
   *   > 「반대도 고려해야해. **민첩성이 5인데 -10짜리를 끼면 251이 되면 안된다고.**」
   *   원작은 8비트 덧셈이라 `5 − 10 = 251` 이 된다. 그것은 **버그**다.
   *   ☠ 위로는 자르지 않는다 — 순수 255 에 장비를 껴서 **335 가 되는 것이 맞다**
   *     (「순수스탯은 255이지만 335로 표기되고 이대로 적용」).
   *   ★ `opt.wrap8` 은 **원작 재현용**이라 그대로 둔다. */
  const wrap = opt && opt.wrap8 ? (v => v & 0xFF) : (v => (v < 0 ? 0 : v));
  const eq = {
    str: itemFieldS(T, u.equip.weapon, '힘') + itemFieldS(T, u.equip.shield, '힘') + itemFieldS(T, u.equip.accessory, '힘'),
    int: itemFieldS(T, u.equip.weapon, '지') + itemFieldS(T, u.equip.shield, '지') + itemFieldS(T, u.equip.accessory, '지'),
    agi: itemFieldS(T, u.equip.weapon, '민') + itemFieldS(T, u.equip.shield, '민') + itemFieldS(T, u.equip.accessory, '민'),
    cha: itemFieldS(T, u.equip.weapon, '권') + itemFieldS(T, u.equip.shield, '권') + itemFieldS(T, u.equip.accessory, '권')
  };
  const str = wrap((b.str | 0) + eq.str + (f.str | 0));
  const int_ = wrap((b.int | 0) + eq.int + (f.int | 0));
  const agi = wrap((b.agi | 0) + eq.agi + (f.agi | 0));
  const cha = wrap((b.cha | 0) + eq.cha + (f.cha | 0));

  // — 공격력 (0x1797C~0x179B4)
  //   공격력 = 힘.  무기 종류 0(맨손) 이나 6(대형 몬스터) 이면 ×2,
  //   그 밖에는 무기의 공격 보정(ITEM +0x2C)을 더합니다.
  //   ★ [리마스터] **무기 종류 2(지팡이·마법)만 지력**으로 갈아탑니다
  //     (사용자 요청 2026-08-14). 마법사 계열 20직업의 평타를 짧은 원거리로
  //     바꾸면서 딜 근거도 옮긴 것입니다 — `combat.js MAGE_FAN_R` 주석 참조.
  //     원작 그대로 두려면 `{ mageIntAtk: false }`.
  const wt = weaponType(u, T);
  /* ★ 토글 — `Opt.cfg.지력공격력` 이 `'원작'` 이면 힘 기반으로 되돌린다
   *   (개발창 토글, 2026-08-16). `opt.mageIntAtk === false` 는 예전 창구로 그대로 둔다. */
  const _옵 = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) ||
              (typeof window !== 'undefined' && window.Opt && window.Opt.cfg) || null;
  const 지력끔 = !!(_옵 && _옵.지력공격력 === '원작');
  const 지력평타 = (wt === 2) && !지력끔 && (!opt || opt.mageIntAtk !== false);
  let atkBase = 지력평타 ? int_ : str, atkEquip = 0;
  if (wt === 0 || wt === 6) atkEquip = str;                 // ×2 = 힘만큼 더 붙는 셈
  else atkEquip = itemFieldS(T, u.equip.weapon, '공격보정');
  const atk = atkBase + atkEquip + (f.atk | 0) + (b.atkBonus | 0);

  // — 방어력 (0x179CB) = 직업 기본값(0x71B68) + 장비 3칸 합(ITEM +0x2D)
  const defJob = (j['기본방어력'] | 0) + (b.defBonus | 0);
  let defEquip = itemFieldS(T, u.equip.weapon, '방어보정')
               + itemFieldS(T, u.equip.accessory, '방어보정');
  const defShield = itemFieldS(T, u.equip.shield, '방어보정');
  if (withShield) defEquip += defShield;
  const def = defJob + defEquip + (f.def | 0);

  // — 최대 TP (0x179E3) = 직업 기본값(0x71B6C) + 민첩 + **아이템 TP**, 최소 60
  //
  //   ★★★ **아이템 TP 를 되살린다** — 구버전에는 있었고 후기 판이 없앴다 (2026-09-16)
  //     > 사장님: 「tp는 **민첩성+직업tp+아이템tp**인데 패치 버전에서는 이걸 없애버렸어.」
  //     구버전 `COMBATII.EXE`(499,623 B):
  //       장착 `0x181E7  dx = s8[아이템+0x30]` · `0x181F0  add [+0x54], dx`
  //       해제 `0x182A3` 에서 대칭으로 뺀다
  //     후기 판(494,999 B)은 그 자리를 **재계산으로 바꾸면서 아이템 몫을 버렸다.**
  //
  //   ☠ **구버전 그대로 옮기지 않는다** — 누적(`add`/`sub`)이 무한 증식의 원인이다.
  //     > 「**전투에서는 늘어나고 월드에서는 안늘어나고** 이런 버그 이용해서 tp가
  //     >  무한정 늘어나는 버그가 있었어. **그라디우스** 같은거 착용할때.」
  //     데이터가 범인을 가리킨다 — **그라디우스 TP 255**, 나머지는 1~4 뿐이다.
  //   ⇒ **늘 계산한다.** 몇 번을 끼웠다 빼도 같은 값이 나온다 (기준본 §5 ㉮).
  const tpEquip = (!opt || opt.tpEquip !== false) ? equipSum3(u, T, 'TP') : 0;
  let maxTp = (j['표71B68_3'] | 0) + agi + tpEquip + (b.tpBonus | 0) + (f.tp | 0);
  if (maxTp < 60) maxTp = 60;                               // 0x179F1 cmp dx,0x3c

  // — 마법 저항 (0x17A06) = 직업 기본값(0x71B6A) + 장비 3칸 합(ITEM +0x2F)
  //   ※ 0x181A6 에서도 마법저항만은 방패를 가리지 않고 더합니다(0x18230).
  const mrJob = (j['표71B68_2'] | 0) + (b.mrBonus | 0);
  const mrEquip = equipSum3(u, T, '마법저항');
  const mr = mrJob + mrEquip + (f.mr | 0);

  // — 최대 MP.  ★★ **원작 버그(B-04)** — 원본은 이 칸을 아예 안 읽습니다.
  //   0x181A6 이 rec+0(힘) ~ rec+7(마법저항) 을 훑는데 **rec+6 만 건너뜁니다**:
  //     0x181DC +0xB0 힘 · 0x181E5 +0xB1 지 · 0x181EE +0xB2 민 · 0x181F7 +0xB3 권
  //     0x18204 +0xB4 공격 · 0x18217 +0xB5 방어 · (+0xB6 없음) · 0x1822D +0xB7 마법저항
  //   `0xEDDB0` 이 레코드 +0x28 이므로 **+0xB6 = ITEM.DAT +0x2E = MP 보정**입니다.
  //   실제로 그 칸이 0 이 아닌 17개는 전부 지팡이·로드·완드·오브·지혜의반지 계열이고,
  //   `tables.json` 도 이미 'MP' 라는 이름으로 뽑아 두었습니다.
  //   → `opt.mpEquip !== false` 면 리마스터대로 반영합니다 (기본 켜짐).
  //     원작 그대로 두려면 `{ mpEquip: false }`.
  const mpJob = (b.maxMp | 0);
  const mpEquip = (!opt || opt.mpEquip !== false) ? equipSum3(u, T, 'MP') : 0;
  const maxMp = mpJob + mpEquip + (f.mp | 0);

  return {
    str, int: int_, agi, cha, atk, def, maxTp, mr, maxMp, weaponType: wt,
    layers: {
      base:  { str: b.str | 0, int: b.int | 0, agi: b.agi | 0, cha: b.cha | 0,
               atk: atkBase, def: defJob, maxTp: (j['표71B68_3'] | 0) + agi, mr: mrJob,
               maxMp: mpJob },
      equip: { str: eq.str, int: eq.int, agi: eq.agi, cha: eq.cha,
               atk: atkEquip, def: defEquip, defShield, mr: mrEquip,
               maxMp: mpEquip, maxTp: tpEquip },
      buff:  { str: f.str | 0, int: f.int | 0, agi: f.agi | 0, cha: f.cha | 0,
               atk: f.atk | 0, def: f.def | 0, mr: f.mr | 0, tp: f.tp | 0,
               maxMp: f.mp | 0 }
    }
  };
}

/** `0x17E17` — 탈것에 탄 유닛의 공격력.
 *
 *  ★★★★★ **표를 뽑았다** (2026-08-22) — `TODO` 를 지웠다.
 *    `0x17E1D` `[+0x5C]` 가 `0x27`(39) ~ `0x32`(50) 일 때만 돈다.
 *    `0x17E2E edx = 탈것 − 0x27` · `0x17E38 ecx = [(edx*3)*2 + 0x73108]`
 *    `0x17E3F eax = [ebx+0x48]` = **현재 HP**.
 *
 *  ★ 그 `ecx` 를 `>> 17` 한 값이 `G2State.MECHA_TBL[코드][0]`(= `esi`) 이다.
 *    `0x17E6D` 의 마장기 갈래(`0x17FB6`)가 **같은 식을 최대HP 로** 쓴다 —
 *    여기서는 **현재 HP** 로 쓴다(피해를 입으면 공격력이 떨어진다).
 *
 *  ★ 표는 `state.js` 가 든다(`MECHA_TBL`). `tables.json`(추출 자산)을 **안 쓴다** —
 *    `CLAUDE.md` 「새로 만드는 것도 전부 직독으로」. */
function mountAtk(u, T) {
  if (u.mount < 0x27 || u.mount > 0x32) return null;
  const S = (typeof root !== 'undefined' && root.G2State) ||
            (typeof globalThis !== 'undefined' && globalThis.G2State) || null;
  const mk = S && S.MECHA_TBL && S.MECHA_TBL[u.mount | 0];
  if (!mk) return null;                       // 표가 없으면 손대지 않습니다
  const v = mk[0] | 0;                        // 0x17E38 → >> 17
  return v + idiv(v * idiv(u.hp, 100), 1000); // 0x17E42~
}

/* ─────────────────────────────────────────── 2. 물리 공격 */

/** 0x1D6B1 의 셔플백. 20회 주기로 정확히 (무기 ITEM +0x31 값 + 3) 번 발동합니다.
 *  확률 굴림이 아니라 1~20 순열을 한 바퀴 돌리는 구조입니다. */
function criticalBag(u, T, rng) {
  rng = rng || makeRng();
  const perm = T['크리티컬순열표'];
  return {
    get row() { return u.critRow; },
    get pos() { return u.critPos; },
    /** 이번 공격이 크리티컬인가 → true / false (등급은 critCheck 가 봅니다) */
    draw() {
      if (u.critPos === 0) u.critRow = rng(12);            // 0x1D6E9
      const w = s8(itemField(T, u.equip.weapon, '크리티컬'));  // ITEM +0x31
      const pos = u.critPos;
      u.critPos = (pos + 1) % 20;                          // 0x1D71D
      const v = perm[u.critRow][pos];                      // 0x1D741
      return !(v > w + 3);                                 // 0x1D74A  v > w+3 → 일반
    }
  };
}

/**
 * 0x1D6B1 — 크리티컬 판정.  반환 0 = 일반 / 1 = 크리티컬 / 2 = 일격필살.
 * 결과는 원본에서 [0xF0B8C] 에 들어가 공격 한 번 전체가 공유합니다.
 */
function critCheck(u, T, rng) {
  const j = job(T, u.job) || {};
  const pass = (j['패시브특성'] && j['패시브특성'][1] === 1) ? 2 : 1;   // 0x73B58 = 열1 일격필살
  if (u.f13 & 0x20) return pass;                     // 0x1D6B8  필살기 '살' 1·2등급
  if (u.f13 & 0x40) return 2;                        // 0x1D6E3  필살기 '살' 3등급
  return criticalBag(u, T, rng).draw() ? pass : 0;
}

/** 방향 등급 — 0 정면 / 2 배후 / 3 측면. (1 은 "회피 불가" 전용) */
function facingClass(atk, def) {
  if (atk.dir === def.dir) return 2;                 // 0x1DF8A  같은 쪽을 본다 = 뒤에서
  return ((atk.dir + def.dir) & 1) ? 3 : 0;          // 0x1DF9F  합이 홀수면 측면
}

/** 무기 등급 (0x1DEE1~0x1DF28) — 1 이면 회피 0, 2 면 회피·방어가 20 % 로 줄어듭니다. */
const NO_EVADE_WEAPONS = new Set([0x19, 0x1A, 0x1B, 0x1D, 0x22, 0x23, 0x24,
                                  0x28, 0x2D, 0x30, 0x31, 0x3B, 0x43, 0x46]); // 0x195AE
function weaponGrade(u, T) {
  const wt = weaponType(u, T);
  if (wt === 0xC || wt === 0xB || wt === 0xD) return 1;
  if (NO_EVADE_WEAPONS.has(u.equip.weapon)) return 1;
  if (u.job === 0x5C) return 1;
  if (wt >= 6 && wt <= 0xE) return 2;
  return 0;
}

/**
 * 0x1DDF0 — 한 대상에 대한 회피·방패 방어 판정. ★ **`dx != 1` 경로**다.
 *   같은 주소가 `dx == 1` 이면 **영역효과 시작**(S3 `0x1DE15`)으로 간다
 *   (`0x1DDFA cmp dx,1 / jne 0x1DEA7` · `SCE_HP변경_창구.md` §3-k).
 * @returns {{result:'evade'|'block'|'hit', roll:number, evadeRate:number,
 *            blockRate:number, shieldDef:number, facing:number}}
 *   'block' 이면 shieldDef 만큼 방어력을 **그 한 방 동안만** 올려 피해를 계산합니다.
 */
function hitCheck(atk, def, ctx) {
  const T = ctx.tables, rng = ctx.rng || makeRng();
  const jd = job(T, def.job) || {};
  let guardKind, facing;

  if (isSpecialBody(def)) {                              // 0x1DF43  원본은 sprite>=300; 제품은 본체 의미 분류
    guardKind = 0; facing = 1;
  } else {
    guardKind = (jd['표72793_3'] | 0);                // 0x72795  1 방패방어 / 2 회피형
    if (def.f1e & 2) facing = 1;                      // 0x1DF6C  행동불능 = 회피 불가
    else if (def.f1e & 4) facing = 2;                 // 0x1DF71  둔화 = 배후 취급
    else facing = facingClass(atk, def);
  }

  const roll = rng(100);                              // 0x1DFB8
  const grade = ctx.weaponGrade !== undefined ? ctx.weaponGrade : weaponGrade(atk, T);

  // — 회피
  let ev = 10;                                        // 0x1DFD2  기본 10 %
  if (guardKind === 2 && itemField(T, def.equip.shield, '종류') === 8)
    ev = 10 + s8(itemField(T, def.equip.shield, '회피'));    // ITEM +0x32
  if (facing === 1) ev = -1;
  else if (facing === 2) ev = ev >> 1;                // 0x1E029  sar cx,1
  else if (facing === 3) ev = idiv(ev * 75, 100);
  if (grade === 1) ev = 0;                            // 0x1E052
  else if (grade === 2) ev = idiv(ev * 20, 100);
  if (ev > roll) return { result: 'evade', roll, evadeRate: ev, blockRate: -1, shieldDef: 0, facing };

  // — 방패 방어
  let bl = -1, shieldDef = 0;
  if (guardKind === 1 && itemField(T, def.equip.shield, '종류') === 6) {
    const sh = def.equip.shield;
    bl = (idiv(sh - 0x4A, 4) + 1) * 20 + 10;          // 0x1E0D6
    shieldDef = s8(itemField(T, sh, '방어보정'));       // ITEM +0x2D
    if (def.f13 & 1) { shieldDef += 10; bl += 20; }   // 0x1E10B  회피 자세
    if (def.f14 & 4) bl = 100;                        // 0x1E128  무조건 방어
  }
  if (facing === 1) bl = -1;
  else if (facing === 2) bl = bl >> 1;
  else if (facing === 3) bl = idiv(bl * 75, 100);
  // ※ 무기 등급 1 은 회피만 0 으로 만들고 방어는 건드리지 않습니다(0x1E16C 는 2만 봅니다).
  if (grade === 2) bl = idiv(bl * 20, 100);
  if (bl > roll) return { result: 'block', roll, evadeRate: ev, blockRate: bl, shieldDef, facing };

  return { result: 'hit', roll, evadeRate: ev, blockRate: bl, shieldDef: 0, facing };
}

/**
 * 0x1D770 — 물리 피해.  돌려주는 값은 **HP × 100** 입니다.
 *
 * @param {object} A 공격자, @param {object} D 방어자
 * @param {object} ctx {
 *     tables, rng,
 *     attackType : 0 일반 / 1 크리티컬 / 2 일격필살   (0x1D6B1 결과)
 *     support    : true 면 주변 유닛 지원 효과 적용 (근접만. 0x1DDF0 이 wt 5·B·C 는 0)
 *     neighbors  : [{faction}] 반경 1 안의 유닛들 (자기 자신·공격자는 빼고)
 *     morale     : {ally, enemy}  0xF0BA0 / 0xF0BA2
 *     atkOverride: 공격력을 갈아끼울 때 (필살기 0x2CAF7 이 공격력 × x 로 바꿔치기)
 *     attr       : 속성을 강제할 때 (기본은 0x17531 로 구합니다)
 *     shieldDef  : hitCheck 가 'block' 이면 그 값을 방어력에 미리 더해 두십시오
 *     confuse    : 진영 관계 반전 (컨퓨즈, 0x12056 의 [0xE518D])
 *   }
 */
function physicalDamage(A, D, ctx) {
  const T = ctx.tables, rng = ctx.rng || makeRng();
  const at = ctx.attackType | 0;
  const dA = ctx.deriveA || derive(A, T), dD = ctx.deriveD || derive(D, T);

  /* ── 방어 쪽 (0x1D784 ~ 0x1D8E9) ── */
  let defRaw = (dD.def + (ctx.shieldDef | 0)) | 0;
  let def = defRaw;
  if (D.f1e & 0x40) def = idiv(def * 70, 100);        // 0x1D788
  let dice = idiv(def, 5); if (dice <= 0) dice = 1;   // 0x1D7B0  난수 폭 = 방어 / 5

  let Dv;
  if (A.dir === D.dir) {                              // 0x1D7C8  배후
    Dv = (def >> 1) + (rng(dice) >> 1);
  } else if (((A.dir + D.dir) & 1) !== 0) {           // 0x1D7F2  측면
    Dv = idiv(def * 7, 10) + rng(dice);
  } else {                                            // 정면
    Dv = idiv(def * 9, 10) + rng(dice);
  }
  if (D.equip.accessory === 0x78) Dv = defRaw;        // 0x1D83E  카오스 큐브 — 원래 값으로
  if (D.f15 & 0x40) Dv += 20;                         // 0x1D848
  if (D.f14 & 2) Dv = Dv + (Dv >> 1);                 // 0x1D851  ×1.5

  if (ctx.support) {                                  // 0x1D862  지원 효과
    // ★ 기준값은 **방어자 자신의 방어력** × 15 %.
    //   `mov edx,[esi+0x44] / sar edx,0x10` 은 word[esi+0x46] = 방어력을 읽는 관용구입니다.
    const unitV = idiv(defRaw * 15, 100);
    const ns = ctx.neighbors || [];
    for (let i = 0; i < ns.length; i++) {
      const hostile = isHostile(ns[i].faction, D.faction, ctx.confuse);
      if (hostile) Dv -= unitV;                       // 0x1D8E1  적이면 방어력이 깎임
      else Dv += unitV;                               // 0x1D89C / 0x1D8E7  아군이면 같은 unitV
    }
  }

  /* ── 공격 쪽 (0x1D8EB ~ 0x1D982) ── */
  let atk = (ctx.atkOverride !== undefined ? ctx.atkOverride : dA.atk) | 0;
  if (A.f1e & 0x40) atk = idiv(atk * 70, 100);        // 0x1D8F4
  if (A.f15 & 8) atk += 20;                           // 0x1D914
  if (A.f15 & 1) atk += 15;                           // 0x1D91D  (셋 중 하나만)
  else if (A.f15 & 2) atk += 5;
  else if (A.f15 & 4) atk += 10;
  if (A.f14 & 2) atk = atk + (atk >> 1);              // 0x1D93C  ×1.5
  if (ctx.support) {                                  // 0x1D948  사기
    const m = ctx.morale || { ally: 100, enemy: 100 };
    if (A.faction === 1 || A.faction === 2) atk = idiv(atk * s16(m.ally), 100);
    else if (A.faction === 3) atk = idiv(atk * s16(m.enemy), 100);
    // 진영 4(몬스터)는 사기 배율이 아예 붙지 않습니다 (0x1D962 jmp).
  }
  const jd = job(T, D.job) || {};
  if (at === 1 && jd['패시브특성'] && jd['패시브특성'][7] === 0)
    atk = idiv(atk * 150, 100);                       // 0x1D984  방어자 열7 == 0 이면 크리티컬 ×1.5

  /* ── 최종 (0x1D9B9 ~ 0x1DAE6) ── */
  const ja = job(T, A.job) || {};
  let dmg;
  if (ja['패시브특성'] && ja['패시브특성'][3] === 1) { // 0x1D9C0  방어 무시 계열
    if (D.race === 2 || D.mount >= 7) dmg = 0;        // 0x1D9CA  언데드·대형 탈것에는 안 통함
    else dmg = atk * 100;
  } else {
    dmg = (atk - Dv) * 100;                           // 0x1D9DA  ★ 빼기 공식
  }
  if (D.f13 & 1) dmg = idiv(dmg * 70, 100);           // 0x1D9EE  회피 자세

  let attr = (ctx.attr !== undefined) ? ctx.attr : attackAttr(A, T, ctx.phase);
  if (at === 1) { if (dmg < 1000) dmg = 1000; }       // 0x1DA19  크리티컬 최소 10 HP
  else { if (dmg < 100) dmg = 100; }                  //          그 밖 최소 1 HP
  if (isNoAttrWeapon(A.equip.weapon)) attr = -1;      // 0x1DA3F  0x18EF9 == 1 → 상성 무시

  let aff = -1;
  if (attr >= 0) {
    aff = affinity(D, attr, T, A);                    // 0x1DA59 (A — [리마스터] 속성 무기 언데드 판정)
    dmg = idiv(dmg * aff, 10);
  }
  /* [리마스터 규칙 «리마스터 무기 속성»] 정본 241 (2026-11-16 사장님 「그렇게 하자. 상성무시는 2로 가는게 낫겠어. 그게 관통 의미도 통하는 것 같고.. 불속성이지만 데미지를 줄 수 있다 뭐 이런?」)
   *   상성 무시(공격 속성 −1)인 무기에 원소 속성이 있으면 — 무기 종류 상성은 늘 무시하고 원소 상성은 «이로울 때만»(10 초과) · 내성·흡수는 보통 피해
   *     (헬파이어 → 슬라임 화염 2배 · 파이어 골렘 흡수 대신 보통)
   *   빛 무기 평타는 언데드(종족 2 · 소울리콜로 일으킨 유닛 포함)에게 2배 — 힐이 언데드에게 피해 2배(0x2ACCB)인 것과 같은 배율 */
  if (attr === -1 && A.equip && 무기속성켬()) {
    const wa = 무기속성(A.equip.weapon | 0);
    if (wa >= 0 && wa <= 3) { const a2 = affinity(D, wa, T, A); if (a2 > 10) dmg = idiv(dmg * a2, 10); }
    if (wa === 4 && (D.race | 0) === 2) dmg = dmg * 2;
  }
  /* ★ [리마스터] 무속성 무기(0x18EF9 18종 — 엑스칼리버·바리사다·헬파이어 …)는 원작 0x1DA3F 가 attr 을 −1 로 만들어 0x1DA74 `test cx,cx / jle`
   *   에서 일격필살도 건너뛴다 — 스나이퍼·킬러가 헬파이어를 들면 일격(HP 1)이 안 난다(원작 그대로). 토글 «무속성일격»(기본 켬)이면 상성만 무시하고
   *   일격은 낸다 (2026-11-13 사장님 「헬파이어의 경우 스나이퍼나 킬러계열의 일격필살이(체력 1로 만드는) 씹혀」 · 정본 146) */
  const 무속성일격 = (attr < 0) && !!(root.Opt && root.Opt.cfg && root.Opt.cfg['무속성일격'] !== '원작');
  if ((aff > 0 || 무속성일격) && dD.cha < 50 && at === 2 &&   // 0x1DA74  일격필살
      !(D.mount >= 7 && D.mount <= 0x26)) {
    if (dmg < D.hp) dmg = D.hp - 100;                 // HP 를 정확히 1 만 남깁니다
  }
  if (dmg < 0) {                                      // 0x1DA9C  회복이면 최대 HP 를 넘지 않게
    if (-dmg > D.maxHp - D.hp) dmg = D.hp - D.maxHp;
  }
  if (A.job >= 0x86 && A.job <= 0x8B) {               // 0x1DAB5
    dmg = dmg * 3; if (dmg < 100) dmg = 100;
  }
  if (D.equip.accessory === 0x73) dmg = idiv(dmg, 2); // 0x1DAD3  피해 반감 장신구
  return dmg;
}

/** 0x1201D — 진영 관계. 1·2 ↔ 3·4 / 3 ↔ 1·2·4 / 4 ↔ 1·2·3 이 적대.
 *  confuse(전역 [0xE518D])가 서면 결과가 XOR 로 뒤집힙니다 = 암흑 1 컨퓨즈. */
function isHostile(a, b, confuse) {
  let h = 0;
  if (a === 1 || a === 2) h = (b === 3 || b === 4) ? 1 : 0;
  else if (a === 3) h = (b === 1 || b === 2 || b === 4) ? 1 : 0;
  else if (a === 4) h = (b === 1 || b === 2 || b === 3) ? 1 : 0;
  return (h ^ (confuse ? 1 : 0)) === 1;
}

/** 0x18EF9 — 무속성 무기 판정(자료상 18종). 목록을 아직 안 뽑았으므로
 *  TODO: 0x18EF9 를 읽어 채우십시오. 지금은 보수적으로 "무속성 아님"을 돌려줍니다. */
const NO_ATTR_WEAPONS = new Set();
function isNoAttrWeapon(code) { return NO_ATTR_WEAPONS.has(code); }

/** 0x17531 — 공격 속성. −1 이면 상성을 아예 안 탑니다. */
function attackAttr(u, T, phase) {
  if (phase === 4) {                                  // 0x17536  [0xBA84E] == 4
    if (u.job === 0x86) return 6;
    if (u.job === 0x88) return 4;
    if (u.job === 0x8A) return 5;
    return -1;
  }
  const j = job(T, u.job) || {};
  if (j['패시브특성'] && j['패시브특성'][3] === 1) return -1;   // 0x1757B
  const code = j['공격속성코드'] | 0;                  // 0x72794
  if (code === 1) return 0;                            // 불
  if (code === 2) return 1;                            // 얼음
  if (code === 3) return 2;                            // 번개
  if (code === 4) return 3;                            // 암흑
  if (code === 5) return -2;
  // code == 0 : 무기 속성 부여 버프 → 무기 종류
  if (u.f15 & 1) return 0;                             // 0x175F8  화염 부여
  if (u.f15 & 2) return 1;                             // 빙한 부여
  if (u.f15 & 4) return 2;                             // 전격 부여
  /* [리마스터 규칙 «리마스터 무기 속성»] 속성 무기 평타는 그 원소 속성으로 — 원작은 무기 «종류»(검·창·도끼·활)로만 셈해 슬라임·다크 슬라임·리치(검창도끼활 상성 0)에
   *   빙설검·화염인 같은 속성 무기도 피해 0 이었다 (사장님 11-16 「슬라임같은애들한테 공격이 들어가냐는 소리야」 → 고르심 «2» · 정본 237)
   *   · 무기속성(code) 정본(화염 0 · 빙한 1 · 전격 2 · 암흑 3) 그대로 상성 칸 · 빛(4)은 상성 칸이 없어 −1(상성 안 탐 = 보통 피해)
   *   · 속성 부여 마법(위)이 먼저 · 무기속성 토글이 «원작»이면 원래대로 무기 종류 */
  if (무기속성켬() && u.equip) { const wa = 무기속성(u.equip.weapon | 0); if (wa >= 0 && wa <= 3) return wa; if (wa === 4) return -1; }
  const wt = weaponType(u, T);
  const tbl = { 0: -1, 1: 4, 2: -1, 3: 5, 4: 6, 5: 7, 6: -1, 7: 4, 8: 5, 9: 6, 10: 0, 11: -1, 12: 7 };
  return (wt in tbl) ? tbl[wt] : 0;                    // wt > 12 는 0(불)로 떨어집니다 (원본 그대로)
}

/* [리마스터] 언데드 물리 면역 — 옵션 `언데드물리면역` (2026-10-12)
 *   사장님(원문) 「스켈톤 용아병은(다크스켈톤) 물리데미지 면역이어야해.(리치처럼) 속성무기만 공격이 가능해야해.」
 *              · 「전체 적용하고 토글 달아줘. 리마스터 스켈레톤, 용아병 물리 면역 키고 끌 수 있게.」
 *   원작 상성 S4~S7(물리 · attackAttr 무기 종류 4~7): 리치 0,0,0,0 · 아래 셋 5,5,15,1 (0x72982 + 직업*8)
 *   69 Skeleton · 70 Dark Skeleton(아슈람) · 71 DTWarrior(용아병 · 스켈톤로드) — 켜면 리치처럼 0
 *   불·얼음·번개·암흑(S0~S3)·상성 무시 무기(attr −1)·속성 부여(f15)는 그대로 들어간다 */
/* 74 Ghoul · 75 Zombi — 창1 도 물리 4칸 0 (SETTING.DAT 0x1021 직업 60·61 · 피해 0x16969 × 상성/10) · 사장님 「좀비와 굴도 창1에서 어떻게 되었었는지 확인해줘」 (2026-10-12 조사) */
const 물리면역직업 = { 69: 1, 70: 1, 71: 1, 74: 1, 75: 1 };
/* [리마스터] 속성 있는 무기(마법검 표 — 빙설검·선더액스 등 크리티컬 때 마법이 나가는 무기)는 언데드 물리 면역을 뚫는다 (2026-10-13)
 *   사장님 「반격은 기존 언데드 물리내성관련 창1사양 토글과 함께 묶어서 리마스터로 들어가게 해야해」 · 10-09 「마법무기들(속성있는 무기) … 언데드에게 데미지가 안들어가. (빙설검으로 테스트)」
 *   같은 토글(언데드물리면역 · 원작이면 면역 자체가 없음) — 평타·반격이 같은 피해식이라 둘 다 */
/* [리마스터] 속성 무기 8종 (2026-10-13) — 사장님 「속성이 있는 무기(적소검, 빙설검, 뇌전검 등)을 마법검으로 만들면 되는거 아니야?」
 *   · 고르심 「상태이상+면역 뚫기」 · 「검 셋 + 지팡이 넷 + 썬더볼츠」 · 「빙설검 크리티컬시 빙결효과가 있어」
 *   코드(ITEM 번호+1) → 0 불 1 얼음 2 번개 3 암흑. 빙설검 19·뇌전검 16·썬더볼츠 66 은 원본 0x18F52 에 이미 같은 값이 있다(크리티컬 상태이상).
 *   적소검 8·화이어로드 74·아이스로드 75·썬더로드 76·다크로드 77 은 원본 0x18F52 에 없어 [리마스터]로 보탠다 (combat.js weaponStatusAttr). */
const 속성무기표 = { 8: 0, 16: 2, 19: 1, 66: 2, 74: 0, 75: 1, 76: 2, 77: 3,
                     12: 4, 56: 1,     /* [리마스터] 11-13 사장님 「실버소드도 빛이고 … 자비르 … 빙한」 — 실버소드 12 빛(4 · 크리티컬 상태이상 없음) · 자비르 56 빙한 */
                     55: 2, 49: 2, 28: 4, 35: 0,
                     4: 4, 44: 4 };   /* [리마스터] 11-16 사장님 「은장도 어스쉐이커도 빛속성으로 해.」 — 은장도 4 · 어스쉐이커 44 빛(상성 무시 18종 중 속성 없던 둘 · 정본 239) */   /* [리마스터] 11-13 사장님 「궁그닐도 적절한 속성찾아봐. 궁니르 게볼그등 다 신화에 등장하는거니」 — 궁그닐 55 전격(오딘의 창 · 북유럽 신화) · 묠니르 49 전격(토르의 망치 = 번개 · 원작 크리티컬 발동 마법 Curse 보다 신화 우선) · 백엽검 28 빛(Light Sword) · 유성검 35 화염(Meteor Sword · 메테오는 화염 계열) · 어스쉐이커 44(땅)·은장도 4 는 다섯 속성에 없어 무속성 */
/* [리마스터] 속성은 없지만 물리 면역을 뚫는 무기 — 사장님 11-13 「연노도 뚫고」(원작 상성 무시 18종·속성 무기 밖) · 궁그닐(0x37)은 상성 무시 18종이라 이미 뚫는다 */
const 면역뚫기추가 = {};   /* ☠ 11-16 연노(65) 뺌 — 사장님 「연노는 뺴.」(정본 237) */
function 속성무기속성(code) {
  const v = 속성무기표[code | 0];
  if (v !== undefined) return v;
  /* [리마스터] 덧 아이템(js/extitem.js · 추가아이템.json 「속성」) — 지금은 전부 −1(없음) · 흑강검(125)은 11-13 아침까지 암흑 3 이었다가 사장님 11-13 「무기별로 속성이 … 없다면 흑강검도 없애」로 뺌 */
  const X = (typeof root !== 'undefined' && root.G2ExtItem) || null;
  if (X && typeof X.속성 === 'function') { const s = X.속성(code | 0); if (s >= 0) return s; }
  return -1;
}
/* [리마스터] **무기 속성 정본** — 화염 0 · 빙한 1 · 전격 2 · 암흑 3 · 빛 4 · 없음 −1(장검처럼 평범한 무기 = 무속성)
 *   사장님 11-13 「장검이 무속성이고 아수라는 화염속성이어야」 · 「속성은 화염, 빙한, 전격, 빛, 암흑으로 나뉘어야하고. 각각 해당하는 무기들이 있는건데」
 *   순서 ① 리마스터 속성무기표(적소검·로드 넷…)·덧 아이템 속성 ② 원작 0x18F52 크리티컬 상태이상 표(combat.js · 아수라·바리사다·실피드·카오스소드 …)
 *       ③ 크리티컬 발동 마법(마법검 표 0x19168)의 계열 — 1 화염·2 빙한·3 전격 → 그대로 · 4 회복(Turn Undead · 엑스칼리버·영광의 홀) → 빛 · 5 보조(Curse · 몰니르)·7 암흑(Death·Dark Zone) → 암흑
 *   더보기 «속성» 줄(item.js)과 언데드 물리 면역 뚫기(속성무기인가)가 이것 하나를 본다 · 크리티컬 상태이상(0x1EBFE)은 0~3 만(빛은 없음) */
const 속성이름 = ['화염', '빙한', '전격', '암흑', '빛'];
const 마법계열속성 = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 3, 7: 3 };   /* 마법 번호 21칸 = 계열 하나(마법유형_147칸.md) */
function 무기속성켬() {   /* [리마스터 규칙 «리마스터 무기 속성»] — 11-13 사장님 「지금 이건 무기 속성 리마스터로 별도로 넣어야지」(전엔 언데드물리면역 토글에 묶여 있었다) */
  const 옵 = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;
  return !(옵 && 옵['무기속성'] === '원작');
}
function 무기속성(code) {
  const c = code | 0; if (!c) return -1;
  const 켬 = 무기속성켬();
  let v = 켬 ? 속성무기속성(c) : -1; if (v >= 0) return v;
  const CB = (typeof root !== 'undefined' && root.G2Combat) || null;
  if (CB && typeof CB.weaponStatusAttr === 'function') { v = CB.weaponStatusAttr(c); if (v >= 0) return v; }
  const MS = (typeof root !== 'undefined' && root.G2MagicSword) || null;
  const 행 = (켬 && MS && MS.행찾기) ? MS.행찾기(c) : null;   /* 마법 계열로 속성을 매기는 것도 리마스터 해석 */
  if (행) { const k = 마법계열속성[Math.ceil((행.마법 | 0) / 21)]; return (k === undefined) ? -1 : k; }
  return -1;
}
function 속성무기인가(A) {
  if (!A || !A.equip) return false;
  const w = A.equip.weapon | 0;
  if (무기속성(w) >= 0) return true;        /* 속성이 있는 무기는 언데드를 비롯한 물리 면역을 뚫는다 (사장님 11-13) */
  if (면역뚫기추가[w]) return true;          /* 속성 없이 뚫는 무기 — 지금은 없음(11-16 연노 뺌) */
  const CB = (typeof root !== 'undefined' && root.G2Combat) || null;
  return !!(CB && CB.isNoAttrWeapon && CB.isNoAttrWeapon(w));   /* 상성 무시 18종(궁그닐·엑스칼리버 …)은 attr −1 이라 affinity 를 안 거치지만 더보기 표시를 위해 같은 답 */
}
function 물리면역켜짐(직업) {
  if (!물리면역직업[직업 | 0]) return false;
  const 옵 = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;   /* root = globalThis(브라우저에선 window) — window 를 따로 안 본다 (도메인_브라우저의존차단) */
  return !(옵 && 옵['언데드물리면역'] === '원작');
}

/** 0x1762C — 속성 상성 배율(×10). 직업표 + 무기 + 장신구의 ITEM +0x3A~+0x41. */
function affinity(D, attr, T, A) {   /* A — 공격자(있으면 · 속성 무기면 언데드 물리 면역을 안 건다) */
  if (D.f1e & 0x40) return 10;                        // 0x17631  상성 무효화
  const j = job(T, D.job) || {};
  let v = (j['상성'] && j['상성'][attr] !== undefined) ? (j['상성'][attr] | 0) : 10;
  if (attr >= 4 && attr <= 7 && 물리면역켜짐(D.job) && !속성무기인가(A)) v = 0;   // [리마스터] 언데드 물리 면역 — 리치(직업 40) 상성 S4~S7 = 0 과 같게 · 속성 무기는 통한다(2026-10-13)
  const 장 = D.equip || {};                            /* 정본 377 — 장비 칸 없는 사본이면 맨손 */
  v += itemAffinity(T, 장.weapon, attr);              // 0x1765B
  v += itemAffinity(T, 장.accessory, attr);           // 0x1766B
  return v;
}

/** 0x1EF7C — 무기 종류별 반격 사거리. */
function counterRange(wt) {
  if (wt === 8) return 3;
  if (wt === 3 || wt >= 7) return 2;
  return 1;
}

/**
 * 0x1EF9A — 반격.  공격을 맞은 대상 하나하나에 대해 몇 번 되받아치는지 셉니다.
 * @param {object} A 원래 공격자
 * @param {Array}  targets 이번 공격의 대상 목록
 * @param {object} ctx { tables, dist(a,b), frontUnit(u) }
 *   dist      : 맨해튼 거리 (0x49ADF)
 *   frontUnit : 유닛이 보는 방향 한 칸 앞에 있는 유닛 (0x49ABC + 0x11DB2)
 * @returns {Array<{unit, count}>}
 *
 * ★ 원본 버그 : 0x1F09C · 0x1F0B1 · 0x1F0C6 세 곳이 전부 `test bh,4` 입니다
 *   (원시 바이트 `f6 c7 04` ×3). 즉 [+0x13] 의 0x08 · 0x10 은 아무 일도 하지 않고
 *   반격 횟수 2·3 은 도달할 수 없습니다. 필살기 '반' 은 등급 1 일 때만 듣습니다.
 *   원본대로 두려면 opt.fixCounterBug 를 끄십시오(기본).
 */
function counterAttack(A, targets, ctx) {
  const T = ctx.tables, out = [];
  for (let i = 0; i < targets.length; i++) {
    const u = targets[i];
    if (!u) continue;
    if (u.job >= 0x86 && u.job <= 0x8B) {              // 0x1EFD6  방향만 맞으면 무조건
      if (A.dir === ((u.dir + 2) & 3)) out.push({ unit: u, count: 1 });
      continue;
    }
    const rng2 = counterRange(weaponType(u, T));       // 0x1F020
    if (ctx.dist(u, A) > rng2) continue;               // 0x1F041
    if (u.f1e & 0x22) continue;                        // 0x1F04C  행동불능·0x20

    let count = 0;
    // 0x1F07C  방어(반격) 자세 + 자기가 보는 앞칸에 공격자가 있을 때
    if ((u.f13 & 2) && ctx.frontUnit && ctx.frontUnit(u) === A) count = 1;
    else if (u.f13 & 0x04) count = 1;                  // 0x1F09C  전방향 반격 (필살기 '반' 1등급)
    else if (ctx.fixCounterBug && (u.f13 & 0x08)) count = 2;   // 원본에서는 죽은 가지
    else if (ctx.fixCounterBug && (u.f13 & 0x10)) count = 3;   // 원본에서는 죽은 가지
    if (count > 0) out.push({ unit: u, count });
  }
  return out;
}

/* ─────────────────────────────────────────── 3. 마법 */

/** 마법 번호 = 속성(계열 0~6) × 21 + 레벨(0~6) × 3 + 랭크(0~2).  0x43287 */
function spellNumber(series, level, rank) { return series * 21 + level * 3 + rank; }
/** 마법 함수표 색인 = 마법번호 / 3 (0x43472 · 0x4C61E) */
function spellSlot(n) { return idiv(n, 3); }
/** 0x753B6 — 레벨별 MP 소모 {10,15,20,30,40,60,80} */
function spellMp(level, T) { return T['마법MP'][level] | 0; }
/** 0x753A8 — 레벨별 필요 TP {40,50,60,80,100,120,140}.
 *  실제 요구치는 0x28480 이 무기 종류로 한 번 더 손봅니다(종류 2 = 지팡이면 그대로, 그 밖 ×2). */
function spellTp(level, T, casterWeaponType) {
  const base = T['마법TP'][level] | 0;
  if (casterWeaponType === undefined) return base;
  return casterWeaponType === 2 ? base : base * 2;    // 0x28485 cmp al,2 / add eax,eax
}

/**
 * 0x285E4 — 마법 피해.  돌려주는 값은 HP × 100 입니다.
 * @param {object} C 시전자, @param {object} D 대상
 * @param {object} spell { power, div, attr }
 *   power : 마법 위력 (ebx, HP×100 단위 상수)
 *   div   : 제수 (ecx). 실측상 **그 마법의 지력 하한**입니다 —
 *           지력 == div 면 배율 100 %, 지력 == div×2 면 200 % 에서 상한.
 *   attr  : 속성 0~7, −1 이면 상성 생략. 3(암흑)이면 마법 저항을 통째로 무시합니다.
 * @param {object} ctx { tables, timeOfDay }
 */
function magicDamage(C, D, spell, ctx) {
  const T = ctx.tables;
  const dC = ctx.deriveC || derive(C, T), dD = ctx.deriveD || derive(D, T);
  /* [개발 토글 «상한해제»] 켜면 지력 배율 위쪽(200%)을 자르지 않는다 — 지력 999 에서도 마법이 따라 세진다 (사장님 11-14 「상한이 늘어나면 날수록 마법은 큰 의미가 없어지겠네」 → «지력 배율 상한 풀기» · 정본 182) */
  let v = 마법상한해제켬() ? Math.max(100, idiv(dC.int * 100, spell.div)) : clamp(idiv(dC.int * 100, spell.div), 100, 200);   // 0x285EF ~ 0x28620
  v = idiv(v * spell.power, 100);                           // 0x28628

  let mr = dD.mr;
  if (D.f15 & 0x20) mr += 20;                               // 0x28641  방어 자세
  let resist = 100 - mr;
  if (spell.attr === 3) resist = 100;                       // 0x2865C  암흑은 저항 무시
  v = idiv(v * resist, 100);                                // 0x28664

  // 장비 3칸의 마법 위력 보정(ITEM +0x37) + 시간대 보너스
  let boost = itemFieldS(T, C.equip.weapon, '마법위력')
            + itemFieldS(T, C.equip.shield, '마법위력')
            + itemFieldS(T, C.equip.accessory, '마법위력');
  const tod = ctx.timeOfDay | 0;                            // 0xBA84D
  if ((tod === 1 && spell.attr === 2) ||
      (tod === 2 && spell.attr === 1) ||
      (tod === 3 && spell.attr === 0)) boost += 50;         // 0x286E3
  v = v + idiv(v * boost, 100);                             // 0x286E9

  if (spell.attr >= 0) v = idiv(v * affinity(D, spell.attr, T), 10);  // 0x28708
  return v;
}

/**
 * 0x2ACCB — 회복.  언데드([+0x0D] == 2) 면 마법 피해의 **2배**를 줍니다.
 * @returns {{heal:number, damage:number}}  둘 다 HP × 100
 */
function magicHeal(C, D, amount, ctx) {
  const T = ctx.tables;
  if (D.race === 2) {                                       // 0x2AD04
    const dmg = magicDamage(C, D, ctx.spell || { power: amount, div: 100, attr: -1 }, ctx);
    return { heal: 0, damage: dmg * 2 };                    // 0x2AD28
  }
  if (D.mount > 4) return { heal: 0, damage: 0 };           // 0x2AD51  탈것 5 이상은 대상 밖
  const boost = itemFieldS(T, C.equip.weapon, '마법위력')
              + itemFieldS(T, C.equip.shield, '마법위력')
              + itemFieldS(T, C.equip.accessory, '마법위력');  // 0x2AD5D
  let heal = amount + idiv(amount * boost, 100);
  /* [개발 토글 «상한해제»] 회복량도 지력을 따라 — 원작은 지력을 안 본다(0x2AD5D 장비 보정만). 피해식의 지력 배율이 원작 상한(200%)을 넘는 만큼만 곱한다 ⇒ 원작 범위 지력에서는 같고 그 위에서부터 늘어난다 (정본 182) */
  if (마법상한해제켬()) { const dC = ctx.deriveC || derive(C, T), 나눔 = (ctx.spell && ctx.spell.div) || 30; const 배 = idiv(dC.int * 100, 나눔); if (배 > 200) heal = idiv(heal * 배, 200); }
  if (D.hp + heal > D.maxHp) heal = D.maxHp - D.hp;         // 0x2ADB3  (위 줄과 같은 자리 · 상한해제 뒤 다시 자름)
  if (D.hp + heal > D.maxHp) heal = D.maxHp - D.hp;         // 0x2ADB3
  return { heal, damage: 0 };
}

/* ─────────────────────────────────────────── 4. 필살기·초필살기 */

/** 0x753C4 — 슬롯(0~24)별 필요 TP */
function specialTp(slot, T) { return T['필살기TP'][slot] | 0; }
/** 0x753F6 — 슬롯별 HP 소모 (×100 저장) */
function specialHpCost(slot, T) { return T['필살기HP소모'][slot] | 0; }
/** 0x75428 / 0x75442 — 초필살기(0~12) */
function ultimateTp(i, T) { if (ULTIMATE_EXTRA[i] && T['초필살기TP'][i] == null) return ULTIMATE_EXTRA[i].tp | 0; return T['초필살기TP'][i] | 0; }      /* [리마스터] 13~ 는 ULTIMATE_EXTRA */
function ultimateHpCost(i, T) { if (ULTIMATE_EXTRA[i] && T['초필살기HP소모'][i] == null) return ULTIMATE_EXTRA[i].hp | 0; return T['초필살기HP소모'][i] | 0; }

/**
 * 0x301BB — 필살기 HP 소모.  최소 1 HP 는 남기고, 직업 0x32 는 면제(0x4CA62).
 * @returns {number} 실제로 깎이는 HP × 100
 */
function specialHpPay(u, cost, opt) {
  if (u.job === 0x32) return 0;                            // 0x4CA62
  if (cost <= 0) return 0;                                 // 0x301E3
  const cap = u.hp - 100;                                  // 0x301EC  현재HP − 1.00
  return Math.min(cost, Math.max(cap, 0));                 // 0x301F3
}

/**
 * 0x2CA40 — 필살기 등급 추첨.  1 / 2 / 3 을 돌려줍니다(3 이 최상).
 * 유닛 [+0x35](0 최상 ~ 4 최하)로 임계표 0x2C9FA 의 행을 고르고,
 * 크리티컬과 같은 20주기 순열표 0x74144 를 씁니다.
 */
function specialClassRoll(u, T, rng) {
  rng = rng || makeRng();
  if (u.spPos === 0) u.spRow = rng(12);                    // 0x2CA5C
  const v = T['크리티컬순열표'][u.spRow][u.spPos];          // 0x2CA7A
  const th = T['필살기등급임계'][u.spRank | 0];             // 0x2CA85
  u.spPos = (u.spPos + 1) % 20;                            // 0x2CABF
  if (v < th[0]) return 3;
  if (v < th[1]) return 2;
  return 1;
}

/**
 * 0x2CAF7 — 필살기 공통 피해.
 *   피해 = 물리피해(공격력 × x) + a      ← a 는 방어·상성을 건너뜁니다
 * @param {object} A 시전자, @param {Array} targets 대상들
 * @param {number} x 공격력 배수, @param {number} a 상수 (HP × 100)
 */
function specialDamage(A, targets, x, a, ctx) {
  const T = ctx.tables;
  const dA = ctx.deriveA || derive(A, T);
  const atk = dA.atk * x;                                  // 0x2CB0B  공격력을 잠시 바꿔치기
  return targets.map(D => ({
    unit: D,
    damage: physicalDamage(A, D, Object.assign({}, ctx, { atkOverride: atk })) + a   // 0x2CB3B
  }));
}

/** 0x4C06E(메뉴 조건) + 0x4BC3C(번호 결정).
 *  원본 실행부는 **캐릭터 코드만** 봅니다. 무기는 메뉴에 띄울지만 정합니다. */
const ULTIMATE_BY_CHAR = {
  0x01: { idx: 12, name: '블리자드스톰',   weapons: [0x19] },
  0x02: { idx: 3,  name: '설화난영참',     weapons: [0x20] },
  0x12: { idx: 1,  name: '아수라파천무',   weapons: [0x24] },
  0x16: { idx: 5,  name: '교아참',         weapons: [0x37] },
  0x1D: { idx: 2,  name: '부동명왕검',     weapons: [0x21] },
  0x30: { idx: 3,  name: '설화난영참',     weapons: [0x20] },
  0x43: { idx: 0,  name: '비연참',         weapons: [0x1C] },
  0x44: { idx: 8,  name: '멸살성천무',     weapons: [0x23] },
  0x4B: { idx: 11, name: '화염인',         weapons: [0x43] },
  0x4C: { idx: 11, name: '화염인',         weapons: [0x43] },
  0x51: { idx: 9,  name: '광룡탄',         weapons: [0x3C] },
  0x5B: { idx: 7,  name: '진공수라참',     weapons: [0x2F] },
  0x64: { idx: 4,  name: '천지파열무',     weapons: [0x1D] },
  /* ★★★★★ **R-03 복원 — 이루스 + 명왕검 무신멸뢰옥** (2026-09-08 · 사장님 지시)
   *
   *   > 사장님: 「**이루스 명왕검 들었을때 무신멸뢰옥 쓸 수 있도록 초필살기 배정해.**
   *   >  지금은 적용 안되어있어.」
   *
   *   ☠ 원작은 **실행부는 온전한데 메뉴 조건만 빠져** 있어 영영 못 쓴다 —
   *     실행 `0x4BC3C`(캐릭터만 본다) · 실행 함수 `0x37FA4` 는 있는데
   *     메뉴 조건 `0x4C06E`~`0x4C0E3` 의 짝 목록에 `(0x65, 0x22)` 가 없다.
   *     `전투로직_사양.md:1247` 이 **원작 결함 4번**으로 세어 두었다.
   *   ★ 이것은 **일부러 원본과 다르게 하는 것**이다 (CLAUDE.md §6) —
   *     계획이 `03_분석/COMBATII/리마스터_변경사항.md` **R-03** 에 이미 적혀 있었다
   *     (「할 일 : `0x4C03E` 목록 구성에 `(0x65, 0x22)` 짝을 넣습니다」).
   *   ★ 명왕검 = `0x22` (`마법검_시스템.md:40` · `미확정_규명.md:428`).
   *   ★ 실행 번호 10 과 수치(TP 160 · HP 100 · `(물리피해+50) × 최대 10회`)는
   *     원작 그대로다 — **메뉴에 뜨게만** 한다. */
  0x65: { idx: 10, name: '무신멸뢰옥',     weapons: [0x22] },   // ★ R-03 복원 — 명왕검
  0x77: { idx: 6,  name: '풍아열공참',     weapons: [0x16] },
  /* [리마스터] 2026-10-03 사장님 「아이스에 설화난영참과 아론다이트 소환을 추가하면돼」 — 아이스(새 캐릭터 143) + 바리사다. 크로우(0x30)와 설정상 같은 인물 */
  143:  { idx: 3,  name: '설화난영참',     weapons: [0x20] }
};
/* ★★★★★ [리마스터] **(캐릭터, 무기) 짝 초필살기** — 원본 실행부 0x4BC3C 는 캐릭터만 봐서 한 캐릭터에 하나뿐이다 (2026-10-11)
 *   사장님 「폭풍검 초필살기 만들거야. gs가 스탐블링거 장착시 사용가능하게 할거야.」 · 고르심 「1가 2가 3가 4가」
 *   (범위 = 화면 안 적 여럿 · 가까운 적부터 · 단계 길이는 원본 초필살기 틱에 맞춤 · ×3 + 150 전격)
 *   ★ 짝이 맞으면 그 번호, 아니면 예전처럼 캐릭터 표(ULTIMATE_BY_CHAR) — GS 가 아수라를 들면 아수라파천무 그대로
 *   ★ 무기 번호는 ULTIMATE_BY_CHAR 와 같은 체계(아이템 표 색인 + 1) — 스탐블링거 = 아이템[0x19] → 0x1A (0x195EF 마법검 구간 0x19~0x1B)
 *   설계 문서: 03_분석/COMBATII/리마스터_초필살기_기획.md §1-a · 연출_폭풍검.md · 초필살기_발동조건.md
 *   설정 `폭풍검` 이 '원작' 이면 짝 표를 안 본다(원본 그대로). */
const ULTIMATE_BY_PAIR = [
  /* ★ 설정 '초필살기추가' — 이 표 전부가 리마스터 추가 초필살기다 (사장님 11-07 「그리고 리마스터 토글에 순옥살, 진무대지파열, 화염인JR버전 안들어갔어. 폭풍검이랑 묶어서 초필살기 추가로 이름바꾸어서 넣고 상세 툴팁에 폭풍검이랑 순옥살 진무대지파열 관련 정보를 넣어야해.」) · '원작' 이면 짝을 안 보고 ULTIMATE_BY_CHAR(원본)로 */
  { char: 0x12, weapon: 0x1A, idx: 13, name: '폭풍검', 설정: '초필살기추가' },
  /* [리마스터] 진무대지파열 — 카슈타르(0x6A) + 멸살지옥검(0x1D · 칼스 천지파열무와 같은 번호 체계) (2026-10-12)
   *   사장님 「일단 카슈타르 멸살지옥검으로 진무대지파열 제작해줘. 칼스와 동일하고 이펙트스프라이트만 바뀐걸로」
   *   ★ 연출·TP·HP·피해 전부 4 천지파열무 그대로 — 그림만 ultimate.js ULT_NSP_시전자(F_QUAKE_kashutar.NSP)
   *   ★ 흑강검은 아직 없어 멸살지옥검으로 둔다(Z-93 ②) */
  /* [리마스터] 화염인(아리아나jr) — 아리아나jr(0x4C) + 헬파이어(0x43) (2026-10-12)
   *   사장님 「아리아나JR용 화염인도 만들어줘. … 아리아나 스프라이트 나오는 부분만 없애고 본래 캐릭터의 공격모션으로」 · 「별도 초필살기로 두고, 기존 아리아나jr 연결된거 수정해야해.」
   *   원본은 ULTIMATE_BY_CHAR 0x4C → 11(아리아나와 같은 화염인 · 불타는 아리아나 그림)이었다. 이름은 그대로 «화염인»(09-26 사장님)
   *   ★ 연출·TP·HP·피해·범위는 11 그대로 — 연출 갈래만 ultimate.js ULT_갈래_시전자(시전자 유닛 공격 모션) */
  { char: 0x4C, weapon: 0x43, idx: 11, name: '화염인(아리아나jr)', 설정: '초필살기추가' },
  /* [리마스터] 순옥살 — 철산고(0x41) + 장신구 제프리바지(0x73 · [+0x5D]) (2026-10-12 사장님 「순옥살도 만들어줘」 · 09-26 사양 «아이템미정(임시로 제프리바지)»)
   *   ★ 무기가 아니라 «장신구» 짝이다 — 짝 항목에 장신구가 있으면 무기 대신 그것을 본다
   *   ★ 14 = [리마스터] 번호 · TP 160 · HP 100(무신멸뢰옥과 같게 · 고르심) · 피해 (물리+50)×9 (고르심) · 정면 첫 적 한 명(고르심) */
  { char: 0x41, 장신구: 0x73, idx: 14, name: '순옥살', 설정: '초필살기추가' },
  { char: 0x42, 장신구: 0x73, idx: 14, name: '순옥살', 설정: '초필살기추가' },   /* 가파니 — 2026-10-12 사장님 「가파니 철산고 둘다 맞지?」 · 기획 §1-a «순옥살 (철산고 · 가파니)» */
  /* [리마스터] 교아참 확장 — 랜담(0x16) + 게이볼그(0x3B · 아이템 #58 +1) (2026-11-13 사장님 11-12 「랜담의 경우 궁그닐에도 교아참 넣고 게이볼그에도 교아참 넣어줘.」「리마스터 사양이야」)
   *   궁그닐(0x37)은 원작 표(ULTIMATE_BY_CHAR 0x16)에 이미 있다 · 초필살기_발동조건.md §게이볼그 추가 사례 · 설정 '교아참확장' */
  { char: 0x16, weapon: 0x3B, idx: 5, name: '교아참(게이볼그)', 설정: '교아참확장' },
  /* [리마스터] 2026-11-13 — 흑강검(덧 아이템 코드 125 · 06_패치/적용/추가아이템.json)과 연결한다 (사장님 11-12 「진무대지파열을 흑강검과 연결하고」)
   *   ☠ 임시로 쓰던 멸살지옥검(0x1D) 짝은 뗐다 — 흑강검 레코드가 멸살지옥검을 본으로 하므로 능력치는 같다 */
  { char: 0x6A, weapon: 125, idx: 4, name: '진무대지파열', 설정: '초필살기추가',
    /* 피해만 살짝 약하게 — 천지파열무 ×2 + 200 → ×2 + 150 (2026-10-12 사장님 「살짝 약하게 조정해야해.」 · 고르심 「× 2 + 150」) */
    xa: { x: 2, a: 15000, kind: 'xa' } }
];
/** [리마스터] 원본 13칸(0~12) 밖 초필살기의 TP · HP 소모 · 발동 칸 — 원본 표(0x75426 · 초필살기HP소모 · 초필살기발동)에 자리가 없다
 *   ★ 값은 같은 GS 의 아수라파천무(1)와 같게 — TP 200 · 화면 12×12 · 적이 없으면 안 나감
 *   ★ HP 소모만 70 (2026-10-11 사장님 「체력 소모는 70정도로 낮춰줘」 · 아수라 100) */
const ULTIMATE_EXTRA = {
  /* [리마스터] 14 순옥살 — 무신멸뢰옥(10)과 같은 TP 160 · HP 100 · 발동 칸(정면 사거리 7 자동 · 커서 없음) (2026-10-12 고르심 「무신멸뢰옥과 같게」) */
  14: { tp: 160, hp: 10000,
        발동: { 번호: 14, 이름: '순옥살', 함수: '[리마스터]', 발동: 'FRONT_AUTO', 대상: '적', 빈칸허용: false,
                사거리: '정면 사거리 7 · 첫 적 한 명', 선택UI: null, 취소가능: true, 대상요구: true, 커서모드: null,
                근거: '[리마스터] 무신멸뢰옥(10) 발동 칸 그대로 · 대상은 첫 적 한 명(고르심)' } },
  13: { tp: 200, hp: 7000,
        발동: { 번호: 13, 이름: '폭풍검', 함수: '[리마스터]', 발동: 'IMMEDIATE', 대상: '적', 빈칸허용: false,
                사거리: '카메라 원점 기준 12×12', 선택UI: null, 취소가능: true, 대상요구: true, 커서모드: null,
                근거: '[리마스터] 아수라파천무(1)와 같은 칸 · 2026-10-11 사장님 「1가」(화면 안 적 여럿)' } }
};
function _짝켜짐(e) {
  const 옵 = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;   /* root = globalThis(브라우저에선 window) — window 를 따로 안 본다 (도메인_브라우저의존차단) */
  return !(옵 && e.설정 && 옵[e.설정] === '원작');
}
function _짝(charCode, weapon, charm) {
  if (weapon == null && charm == null) return null;
  for (let i = 0; i < ULTIMATE_BY_PAIR.length; i++) {
    const e = ULTIMATE_BY_PAIR[i];
    if (e.char !== (charCode | 0) || !_짝켜짐(e)) continue;
    if (e.장신구 != null) { if (charm != null && e.장신구 === (charm | 0)) return e; continue; }   /* [리마스터] 장신구 짝(순옥살) */
    if (weapon != null && e.weapon === (weapon | 0)) return e;
  }
  return null;
}
/** 메뉴에 초필살기가 뜨는가 = (캐릭터코드, 장착 무기) 짝이 맞는가. */
function ultimateAvailable(charCode, weapon, charm) {
  if (_짝(charCode, weapon, charm)) return true;
  const e = ULTIMATE_BY_CHAR[charCode];
  return !!(e && e.weapons.indexOf(weapon) >= 0);
}
/** 실제로 나가는 초필살기 번호 (0x4BC3C — 캐릭터만 봅니다). [리마스터] 무기를 주면 짝 표를 먼저 본다 */
function ultimateOf(charCode, weapon, charm) {
  const p = _짝(charCode, weapon, charm);
  if (p) return p.idx;
  const e = ULTIMATE_BY_CHAR[charCode];
  return e ? e.idx : -1;
}
/** 초필살기 x · a — 원본 표 ULTIMATE_XA · [리마스터] 짝 초필살기에 xa 가 있으면 그것(진무대지파열) */
function ultimateXa(i, charCode, weapon, charm) {
  const p = _짝(charCode, weapon, charm);
  if (p && p.idx === (i | 0) && p.xa) return p.xa;
  return ULTIMATE_XA[i | 0] || null;
}
/** 초필살기 발동 칸 — 원본 표 `초필살기발동` · 없으면 [리마스터] ULTIMATE_EXTRA */
function ultimateRow(i, T) {
  const rows = T && T['초필살기발동'];
  if (rows && rows[i]) return rows[i];
  return (ULTIMATE_EXTRA[i] && ULTIMATE_EXTRA[i].발동) || null;
}
/** 초필살기 x · a (HP×100). 미확정 칸은 null 로 둡니다. */
const ULTIMATE_XA = [
  { x: 2, a: 10000, kind: 'xa' },     // 0 비연참        0x30F21
  { x: 10, a: 1000, kind: 'xa' },     // 1 아수라파천무   0x32568
  { x: 0, a: 0, kind: 'instakill' },  // 2 부동명왕검     0x1DB1D  HP = 0
  { x: 4, a: 0, kind: 'xa' },         // 3 설화난영참     0x339E3
  { x: 2, a: 20000, kind: 'xa' },     // 4 천지파열무     0x34BF3
  { x: 4, a: 6000, kind: 'phys' },    // 5 교아참         0x354E3 (시프트 전개)
  { x: 5, a: 3000, kind: 'phys' },    // 6 풍아열공참     0x35F63
  { x: 5, a: 3000, kind: 'xa' },      // 7 진공수라참     0x3651D  ※ 자료의 ×10 은 오기
  { x: 4, a: 6000, kind: 'xa' },      // 8 멸살성천무     0x37785
  { x: 2, a: 10000, kind: 'xa' },     // 9 광룡탄         0x37F68
  { x: 1, a: 5000, kind: 'phys', hits: 10 },  // 10 무신멸뢰옥  0x3813D  (피해+50) × 최대 10회
  { x: 2, a: 7000, kind: 'xa' },      // 11 화염인        0x3A932
  { x: 3, a: 7000, kind: 'xa' },      // 12 블리자드스톰   0x3B59A
  { x: 3, a: 15000, kind: 'xa', attr: -1 },  // 13 [리마스터] 폭풍검 — ×3 + 150 · 상성 안 봄(attr −1 · 0x1DA3F 와 같은 갈래) — 사장님 「초필살기 상성은 무시해야해」(10-11 · 전격 면역 적에게 150 만 들어갔다)
  { x: 9, a: 45000, kind: 'phys' }          // 14 [리마스터] 순옥살 — (물리피해 + 50) × 9 = 피해 × 9 + 450 (2026-10-12 고르심 「(물리+50) × 9」 · 무신 0x3813D/0x38142 식을 9타) · 판정은 연출 끝 한 번
];

/* ─────────────────────────────────────────── 5. TP · 이동 */

/**
 * 0x19FAB — 턴 시작 행동 TP.
 * @param {object} u, @param {object} T, @param {number} timeOfDay [0xBA84D]
 * @param {function} rng
 */
function tpRecharge(u, T, timeOfDay, rng) {
  rng = rng || makeRng();
  const d = derive(u, T);
  let tp = (u.f1e & 0x40) ? idiv(d.maxTp * 70, 100) : d.maxTp;   // 0x19FB0
  if (u.f13 & 0x80) { u.f13 &= 0x7F; tp = 250; }                 // 0x19FE6  권 '기'
  if (u.f14 & 2) tp += 60;                                       // 0x19FFC
  const t = timeOfDay | 0;
  if (t === 1) tp = tp - idiv(tp, 4);                            // ×0.75
  else if (t === 3) { if (rng(3) !== 0) tp = tp - idiv(tp, 4); else tp = tp + idiv(tp, 4); }
  else if (t === 4) tp = tp - idiv(tp, 3);                       // ×0.667
  if (tp < 55) tp = 55;                                          // 0x1A08A
  return tp;
}

/** 이동 예산 — 0x4D9A0(플레이어) · 0x41596(AI) 가 같은 식을 씁니다.
 *  budget = ((TP − 10) / 10) × 4.  10 TP = 1칸이고, 표의 비용 단위로는 1칸 = 4 입니다. */
function moveBudget(tp) { return idiv(tp - 10, 10) * 4; }
/** 이동으로 실제 나가는 TP — 0x41633 / 0x40295.  (쓴 예산 / 4) × 10 + 10 */
function moveTpCost(budgetSpent) { return idiv(budgetSpent, 4) * 10 + 10; }

/** 이동 타입 — 0x1665B / 0x149B9.
 *  타입 5(비행)는 [+0x14] & 1 이 서 있어야 하고, 진영 9 는 무조건 5 입니다(0x14A75). */
function moveType(u, T) {
  if (u.faction === 9) return 5;
  const j = job(T, u.job) || {};
  let t = j['이동타입'] | 0;
  if (t === 5 && !(u.f14 & 1)) t = 0;
  return t;
}

/** 0x70B0D + 이동타입×0x100 — 타일 비용. 0 이하면 통행 불가(null). */
function terrainCost(tile, mtype, T) {
  const row = T['지형이동비용']['표'][mtype];
  let c = row[tile & 0xFF] | 0;
  if (c > 127) c -= 256;
  return c <= 0 ? null : c;
}

/**
 * 0x1419C — ZOC 판.  적 유닛 인접 4칸의 보조 배열([0xE65B0], 초기값 −1)에서 30씩 뺍니다.
 * 0x1499C 는 그 칸을 밟을 때 `if (zoc != −1) 남은이동력 += zoc` 를 합니다.
 * 즉 실제로 더 드는 비용은 **1 + 30 × (인접 적 수)** 입니다(초기값 −1 도 같이 먹습니다).
 * @param {Array} enemyCells [{x,y}]  적이 서 있는 칸
 * @returns {Map} "x,y" → 보조 배열 값 (밟을 때 남은 이동력에 그대로 더합니다)
 */
function zocMap(enemyCells, w, h) {
  const m = new Map();
  const dec = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const k = x + ',' + y;
    m.set(k, (m.has(k) ? m.get(k) : -1) - 30);
  };
  for (const c of enemyCells) { dec(c.x, c.y - 1); dec(c.x - 1, c.y); dec(c.x + 1, c.y); dec(c.x, c.y + 1); }
  return m;
}

/**
 * 0x3F415 — 턴 종료 시 남은 TP 로 자세 사기. **순차**입니다(택일이 아닙니다).
 *   ① 스프라이트 [+0x61] >= 300 이면 아무것도 안 함
 *   ② [+0x6D] == 4 (행동 안 함 성향) 이면 방어 자세 단계를 통째로 건너뜀
 *   ③ 직업표 0x73B59(패시브 열2 = 자동 반격) == 1 이면 **TP 를 안 내고** 방어 자세를 얻음 (0x3F43A je)
 *      아니면 TP > 60 이고 인자 == 1 일 때 60 을 내고 방어 자세
 *   ④ 남은 TP > 40 이면 40 을 내고 회피 자세
 *   ⑤ 남은 TP > 20 이면 0x4D3BA (아이템·회복 사용) 를 시도. TP 를 버리는 게 아닙니다.
 * @returns {{tp, f13, useItem}}
 */
function endTurnStance(u, tp, T, allowDefense) {
  const j = job(T, u.job) || {};
  let left = tp, f13 = u.f13;
  if (isCommandRestricted(u)) return { tp: left, f13, useItem: false };
  const skipDefense = (u.aiAttack | 0) === 4;
  if (!skipDefense) {
    if (j['패시브특성'] && j['패시브특성'][2] === 1) f13 |= 2;          // 0x3F43A  무료
    else if (left > 60 && allowDefense !== false) { left -= 60; f13 |= 2; }
  }
  if (left > 40) { left -= 40; f13 |= 1; }                              // 0x3F45D
  return { tp: left, f13, useItem: left > 20 };                          // 0x3F478
}

/**
 * 0x19AEF — 매 턴 재행동 대기 갱신. [+0x56] 이 직업표 0x71B6E 에 닿으면 255(행동 가능).
 *   [+0x15] & 0x10 이면 필요값 = 기준 × 2 / 3 + 1,  [+0x14] & 2 면 기준 / 2.
 * 행동 가능해지는 순간 [+0x13] 이 0 으로 지워집니다 — 자세·크리티컬 플래그는 여기서 사라집니다.
 */
function readyTick(u, T) {
  if (u.job === 0xA2) return false;                     // 0x19B2C
  if (u.wait === 0xFF) return true;
  u.wait = (u.wait + 1) & 0xFF;
  const j = job(T, u.job) || {};
  let need = j['재행동대기한계'] | 0;
  if (u.f15 & 0x10) need = idiv(need * 2, 3) + 1;       // 0x19B62
  else if (u.f14 & 2) need = need >> 1;                 // 0x19B77
  if (u.wait < need) return false;
  u.wait = 0xFF;
  u.f14 &= ~4; u.f13 = 0;                               // 0x19B8B ~ 0x19B99
  return true;
}

/* ─────────────────────────────────────────── 6. 상태이상 */

/** 0x28947 — 성공률 = clamp(기본 + (시전자 레벨 − 대상 레벨), 10, 70) %. */
function statusChance(C, D, baseChance) {
  return clamp((baseChance | 0) + (C.level - D.level), 10, 70);
}
function statusRoll(C, D, baseChance, rng) {
  rng = rng || makeRng();
  return rng(100) < statusChance(C, D, baseChance);
}

/**
 * 0x29437 — 상태이상 부여.
 *   종류 2 는 기본 확률에서 20 을 뺍니다(0x2944A).
 *   스프라이트 [+0x61] >= 300 인 유닛은 면역(0x29488).
 *   [+0x1E] 하위 3비트를 지우고 새 종류를 세운 뒤 잔여치 [+0x1F] 에 지속표 값을 넣습니다.
 */
function statusApply(C, D, kind, baseChance, step, ctx) {
  const T = ctx.tables, rng = ctx.rng || makeRng();
  let ch = baseChance | 0;
  if (kind === 2) ch -= 20;                             // 0x2944A
  if (!statusRoll(C, D, ch, rng)) return false;
  if (isStatusImmune(D)) return false;                       // 0x29488 원본 sprite>=300 상태면역 의미
  D.f1e = (D.f1e & 0xF8) | kind;                        // 0x29494 · 0x294AB
  const dur = T['상태이상지속'];
  // 0x294D1 은 0x7448A(= 표[1] 부터), 0x294E8 은 0x74488(= 표[0] 부터) 로 읽습니다.
  const i = (step | 0);
  D.st.d1e[0] = (kind === 2 ? dur[i] : dur[i + 1]) | 0;
  if (kind === 2) { D.wait = 0; }                       // 0x294FA → 0x197AD
  return true;
}

/* ────────────────────────────────────────────────────────────────
 * 비트 ↔ 지속 칸 대응  (해제 마스크 실측에서 그대로 나옵니다)
 *
 *   버프  [+0x15] · 칸 4개 [+0x16]+i*2 · 마스크 0x74139 = F8 F7 EF 1F
 *   상태  [+0x1E] · 칸 5개 [+0x1F]+i*2 · 마스크 0x7413D = F8 F7 EF 9F 7F
 *
 * 마스크가 「그 칸이 0 이 되면 어떤 비트를 끄는가」이므로, 뒤집으면 곧
 * 「어떤 비트가 어느 칸을 쓰는가」입니다.
 *
 * | 칸 | 버프 [+0x15]                                   | 상태 [+0x1E]              |
 * |----|-----------------------------------------------|---------------------------|
 * | 0  | 속성부여 화염 01 · 빙한 02 · 전격 04 (공유)     | 화상 01 · 빙결 02 · 감전 04 |
 * | 1  | 파워업 08                                      | 침묵 08                    |
 * | 2  | 스피드업 10                                    | 혼란 10                    |
 * | 3  | ★ 매직아머 20 · 블레스 40 · 배리어 80 (공유)    | 저주 20 · DNA 40 (공유)    |
 * | 4  | ―                                              | 중독 80                    |
 *
 * ★ 3번 칸을 셋이 공유하는 것이 커뮤니티가 관측한 「매직아머·블레스·배리어는
 *   서로 지속시간만 갱신한다」의 정체입니다. 하나를 새로 걸면 칸 값만 덮이고
 *   이미 선 비트는 안 지워지므로, 효과는 남고 시간만 늘어납니다.
 * ────────────────────────────────────────────────────────────── */
const BUFF_SLOT = [0, 0, 0, 1, 2, 3, 3, 3];      // 0x74139 를 뒤집은 것
const AIL_SLOT  = [0, 0, 0, 1, 2, 3, 3, 4];      // 0x7413D 를 뒤집은 것

/** 비트값(0x01…0x80) → 칸 번호. 여러 비트면 가장 낮은 것을 봅니다. */
function slotOfBit(bit, map) {
  for (let i = 0; i < 8; i++) if ((bit | 0) & (1 << i)) return map[i];
  return -1;
}

/** 버프를 켜고 그 비트가 쓰는 칸에 지속을 넣습니다. (0x2A414 · 0x291C6) */
function applyBuffBit(D, bit, dur) {
  D.f15 = (D.f15 | 0) | (bit | 0);
  const s = slotOfBit(bit, BUFF_SLOT);
  if (s >= 0) D.st.d15[s] = dur | 0;
  return D.f15;
}

/**
 * ★★ [+0x1E] 한 칸 — 유닛의 f1e(원본 이름)와 ailment(제품 이름)를 한 저장소로 묶는다 (2026-09-26)
 *   ☠ 둘이 따로 놀았다: 보조·암흑(사일런스·커스·컨퓨즈·DNA)은 applyAilmentBit 로 f1e 에, 원소 상태이상은
 *     view/commit 으로 ailment 에 썼다. 화면(ailmentFrames)·턴 지속 감소(turn shimOf)는 ailment 를 봐서
 *     사일런스가 아이콘도 안 뜨고 영영 안 풀렸다(실측 TESTWC: 사일런스 뒤 f1e 8 · ailment 0).
 *   f1e 를 ailment 를 읽고 쓰는 창구로 만든다. 여러 번 불러도 한 번만 건다. 사본(view·shim)은 제 칸을 그대로 쓴다.
 */
function 상태칸묶기(u) {
  if (!u || typeof u !== 'object' || u.__상태칸묶음) return u;
  var 옛 = Object.getOwnPropertyDescriptor(u, 'f1e');
  var 값 = (u.ailment | 0) | ((옛 && ('value' in 옛)) ? (옛.value | 0) : 0);
  if (옛) delete u.f1e;
  u.ailment = 값;
  Object.defineProperty(u, 'f1e', { get: function () { return this.ailment | 0; },
                                    set: function (v) { this.ailment = v | 0; },
                                    enumerable: false, configurable: true });
  Object.defineProperty(u, '__상태칸묶음', { value: true, enumerable: false, configurable: true });
  return u;
}
/** 상태이상을 켜고 그 비트가 쓰는 칸에 지속을 넣습니다. (0x2C55B 등) */
function applyAilmentBit(D, bit, dur) {
  D.f1e = (D.f1e | 0) | (bit | 0);
  const s = slotOfBit(bit, AIL_SLOT);
  if (s >= 0) D.st.d1e[s] = dur | 0;
  return D.f1e;
}

/**
 * 0x2920A · 0x29213 — 속성부여는 **하위 3비트를 갈아치웁니다.**
 * 「화염을 걸어 둔 채 빙한을 걸면 화염이 사라진다」는 관측 그대로입니다.
 * (이미 걸려 있으면 0x291D5 가 메시지를 하나 띄웁니다.)
 */
function applyElement(D, bit, dur) {
  const had = (D.f15 | 0) & 0x07;                       // 0x291CF
  D.f15 = ((D.f15 | 0) & 0xF8) | ((bit | 0) & 0x07);    // 0x2920A · 0x29213
  D.st.d15[0] = dur | 0;                                // 0x291C6
  return had;
}

/** 0x19892 — 잔여 턴 감소. [+0x15] 는 4칸, [+0x1E] 는 5칸을 각자 가집니다. */
function tickDurations(u, T) {
  const mA = T['상태해제마스크']['플래그B_0x74139'];
  const mB = T['상태해제마스크']['상태이상_0x7413D'];
  if (u.f15 !== 0) for (let i = 0; i < 4; i++) {
    if (u.st.d15[i] === 0) { u.f15 &= mA[i]; u.st.d15[i] = 0xFFFF; }
    else if (u.st.d15[i] > 0 && u.st.d15[i] !== 0xFFFF) u.st.d15[i]--;
  }
  if (u.f1e !== 0) for (let i = 0; i < 5; i++) {
    if (u.st.d1e[i] === 0) {
      /* ★★ DNA 모습 되돌리기 — 원본에 있다 (2026-09-26 0x19892 직독 · 사장님 「원본기준 dna체인저 스프라이트 되돌리는 부분이 미적용」)
       *   0x198EF test [+0x1E],0x40 → 0x198FB call 0x1198D([+0x61]) · 0x19900 [+0x60]=al — 원래 그림을 다시 싣는다.
       *   ★ «어느 칸이든» 시간이 다 된 순간 DNA 비트가 켜져 있으면 되돌린다(비트를 끄기 «앞»). DNA 칸이 아니면 비트(능력치 ×70%)는 남는다.
       *   ☠ 예전 주석 「원본에는 복귀가 없다」는 틀렸다 — 0x2C547 만 보고 지속 감소 쪽을 안 읽었다. */
      if ((u.f1e & 0x40) && u._dna전스프라이트 != null) u.sprIndex = u._dna전스프라이트 | 0;   // 0x198EF · 0x198FB · 0x19900
      u.f1e &= mB[i]; u.st.d1e[i] = 0xFFFF;                                                        // 0x19906 · 0x1990F
      if (!(u.f1e & 0x40)) { u._dna전스프라이트 = null; u.dnaForm = null; }
    }
    else if (u.st.d1e[i] > 0 && u.st.d1e[i] !== 0xFFFF) u.st.d1e[i]--;
  }
}

/**
 * 0x1992D §저주 — **저주가 걸려 있으면 1분마다 상태이상이 하나 더 붙습니다.**
 *
 * ```asm
 * 0x19942  edx = [eax+0x23] sar 16      ; ★ dword[+0x23] 의 상위 워드 = word[+0x25]
 *                                       ;   = 상태 지속 칸[3] — 곧 **저주 자신의 남은 시간**
 * 0x19952  idiv 10 ; 나머지 != 0 → 건너뜀 ; ★ 10 마다 한 번 = 1분마다 (1분 = 대기시간 10)
 * 0x19958  test [ecx+0x1E], 0x20 ; je
 * 0x1995E  eax = 6 ; call 0x499BD       ; rand(6)
 * 0x1996A  ax < 3  → [+0x1F] = 50, [+0x1E] &= 0xF8   ; 칸[0] 공유 — 셋을 밀고 덮어쓴다
 * 0x19981  ax == 5 → [+0x27] = 50                    ; 칸[4] 중독
 * 0x1998A  그 밖   → [ecx + ax*2 + 0x1B] = 50        ; ax=3 → +0x21 칸[1] 침묵
 *                                                     ; ax=4 → +0x23 칸[2] 혼란
 * 0x1999F  or [ecx+0x1E], 표0x1964C[rand]
 * ```
 * 표 `0x1964C` 6바이트 실측 = `01 02 04 08 10 80`
 * (화상 · 빙결 · 감전 · 침묵 · 혼란 · 중독 — **저주 0x20 과 DNA 0x40 은 안 나옵니다**).
 * 새로 거는 지속은 전부 `0x32`(50) = 5분 고정입니다.
 */
const CURSE_ROLL = [0x01, 0x02, 0x04, 0x08, 0x10, 0x80];   // 0x1964C 실측
const CURSE_DUR  = 0x32;                                   // 0x19973 · 0x1998A · 0x19993

function curseTick(u, rng) {
  if (!(u.f1e & 0x20)) return 0;                           // 0x19958
  const 남은 = u.st.d1e[3] | 0;                            // 0x19942  [+0x25] = 칸[3]
  if (남은 === 0xFFFF || (남은 % 10) !== 0) return 0;      // 0x19952
  const r = (rng ? rng(6) : Math.floor(Math.random() * 6)) | 0;   // 0x1995E
  const bit = CURSE_ROLL[r];
  if (r < 3) { u.st.d1e[0] = CURSE_DUR; u.f1e &= 0xF8; }   // 0x19973 · 0x19979
  else if (r === 5) u.st.d1e[4] = CURSE_DUR;               // 0x19993
  else u.st.d1e[r - 2] = CURSE_DUR;                        // 0x1998A  ax=3→칸1, ax=4→칸2
  u.f1e |= bit;                                            // 0x1999F
  return bit;
}

/**
 * 0x1992D — 턴 시작 도트 피해.  돌려주는 값은 HP × 100 입니다.
 *   화상([+0x1E]&1) → 속성 0,  감전(&4) → 속성 2,  둘 다 (100 − 마법저항) × 15.
 *   실제 HP 로는 (100 − 마법저항) × 0.15 입니다.
 *   [+0x1E]&0x80 이면 800(= 8 HP) 이 더 붙습니다.
 */
function dotDamage(u, T) {
  const d = derive(u, T);
  let dot = 0, attr = -1;
  if (u.f1e & 1) { dot = idiv((100 - d.mr) * 1500, 100); attr = 0; }
  else if (u.f1e & 4) { dot = idiv((100 - d.mr) * 1500, 100); attr = 2; }
  if (attr >= 0) dot = idiv(dot * affinity(u, attr, T), 10);
  if (u.f1e & 0x80) dot += 800;
  return dot;
}

/**
 * ★★★★★ **지형 효과 — 「대상인가」와 「얼마인가」를 갈라서 준다** (통합 2-c · 2026-08-22)
 *
 *   원본 `0x17310` 은 **면제·비대상이면 `0x17477` 로 일찍 빠지고**, 유효 지형이면
 *   **계산 결과가 0 이어도** `0x173E2 sub` → `0x173EB call 0x53797`(S4)까지 간다:
 *
 *     0x17316  test [+0x15],0x80 / jne 0x17477   ; 면제
 *     0x17320  test [+0x14],1    / jne 0x17477   ; 면제
 *     0x1732D  cmp [+0x11],0x4C/0x5C/0x5D / je   ; 종족 제외
 *     0x17373  test bx,bx / jl 0x17477           ; 비대상 지형
 *     0x1737C  cmp bx,5   / jg 0x17477           ; 비대상 지형
 *     … 0x173E2 sub edx,esi → 0x173EB call 0x53797  ★ **여기까지 오면 무조건**
 *
 *   ★ 그래서 **반환 `0` 하나로는 갈라낼 수 없다.** `terrainDamage()` 는
 *     네 가지(면제·종족·비대상·계산 0)를 전부 `0` 으로 돌려준다.
 *
 *   @returns {{대상: boolean, 값: number, idx: number}}
 *     `대상` 이 `false` 면 원본이 `0x17477` 로 빠지는 경우 — **S4 도 안 부른다.**
 *     `대상` 이 `true` 면 `값` 이 0 이어도 **S4 를 부른다.**
 *     ★ `값` 은 **음수일 수 있다** — 상성 합계가 음수면 회복이다
 *       (원본 `0x173E2 sub edx, esi` 는 `esi` 가 음수면 더하기).
 */
function 지형효과(u, tile, T, 덧) {
  const 없음 = { 대상: false, 값: 0, idx: -1 };
  if ((u.f15 & 0x80) || (u.f14 & 1)) return 없음;              // 0x17316  면제
  if (u.job === 0x4C || u.job === 0x5C || u.job === 0x5D) return 없음;
  let idx;
  if (tile < 0x64) idx = (tile & 0xF) - 9;                     // 0x1735C
  else idx = ((tile - 0x64) & 0xF) - 5;
  if (idx < 0 || idx > 5) return 없음;                          // 0x17373 · 0x1737C
  let dmg = (idx === 0 || idx === 3 || idx === 4) ? idiv(u.maxHp, 20) : idiv(u.maxHp, 10);
  if (idx > 1) dmg = idiv(dmg * affinity(u, idx - 2, T), 10);  // 속성 = idx − 2 (불·얼음·번개·암흑)
  /* [리마스터] 용자의 무덤 진한 가시 — 창1 값 7(0x1F)은 2배(CHRSYS 0x10067 · 0x10071 shl dx,1) (2026-10-12)
   *   창2 표엔 20% 칸이 없어 무덤 변환이 6·7 을 둘 다 10 으로 보냈다 · 한 맵에 6 과 7 이 같이 없다(값 6 = 204·216 맵뿐)
   *   ⇒ 전투가 «덧.가시배»(battle.무덤가시배)를 주면 값 10 피해에 곱한다 · 사장님 「확실하면 2번」 */
  if (덧 && (덧.가시배 | 0) > 1 && tile === 10) dmg = dmg * (덧.가시배 | 0);
  return { 대상: true, 값: dmg, idx: idx };
}

/** 0x17310 — 지형 피해. 타일 하위 니블로 종류를 정하고 2 이상이면 속성 상성을 곱합니다.
 *  ★ 「대상인가」까지 알아야 하면 `지형효과()` 를 쓴다 (위). */
function terrainDamage(u, tile, T) {
  return 지형효과(u, tile, T).값;
}

/* ─────────────────────────────────────────── 7. 사기 */

const MORALE_MIN = 0x32;   // 50   — 0x1DC6A
const MORALE_MAX = 0x96;   // 150  — 0x1DC92

/** 0x1DC0D — 죽은 유닛의 권위([+0x43])로 증감표 0x74234 의 칸을 고릅니다. */
function moraleIndex(authority) {
  if (authority > 0x50) return 3;   // 81 이상 → 12
  if (authority > 0x32) return 2;   // 51~80  → 7
  if (authority > 0x1E) return 1;   // 31~50  → 3
  return 0;                          // 0~30   → 1
}

/**
 * 0x1DC34 — 사망 시 사기 변동. 죽은 쪽은 내려가고(하한 50) 상대는 올라갑니다(상한 150).
 * 소환수([+0x12] >= 10)가 죽으면 이 코드에 아예 도달하지 않습니다(0x1DBE7).
 * @param {object} morale {ally, enemy}  → 새 값을 돌려줍니다(원본 객체는 안 건드립니다)
 */
function moraleOnDeath(morale, deadFaction, authority, T, isSummon) {
  const m = { ally: morale.ally, enemy: morale.enemy };
  if (isSummon) return m;
  const v = T['사기증감'][moraleIndex(authority | 0)] | 0;
  if (deadFaction === 1 || deadFaction === 2) {
    m.ally -= v; if (m.ally < MORALE_MIN) m.ally = MORALE_MIN;
    m.enemy += v; if (m.enemy > MORALE_MAX) m.enemy = MORALE_MAX;
  } else if (deadFaction === 3) {
    m.enemy -= v; if (m.enemy < MORALE_MIN) m.enemy = MORALE_MIN;
    m.ally += v; if (m.ally > MORALE_MAX) m.ally = MORALE_MAX;
  }
  return m;
}
/** 스킬 11 일갈 — 상대 진영 −2, 하한만 걸립니다 (0x3C0DF). */
function moraleTaunt(morale, casterFaction) {
  const m = { ally: morale.ally, enemy: morale.enemy };
  if (casterFaction === 1 || casterFaction === 2) { m.enemy -= 2; if (m.enemy < MORALE_MIN) m.enemy = MORALE_MIN; }
  else if (casterFaction === 3 || casterFaction === 4) { m.ally -= 2; if (m.ally < MORALE_MIN) m.ally = MORALE_MIN; }
  /* 0x3C0D3 jb / 0x3C0DD jmp: 진영 0 또는 5 이상은 사기를 바꾸지 않는다. */
  return m;
}
/** 스킬 11 희생 — 자기 진영 +10, **상한이 없습니다** (0x3C289 뒤에 비교문이 없습니다). */
function moraleSacrifice(morale, casterFaction) {
  const m = { ally: morale.ally, enemy: morale.enemy };
  if (casterFaction === 1 || casterFaction === 2) m.ally += 10; else m.enemy += 10;
  return m;
}
/** 통상 공격 공격력에 곱해지는 배율 (0x1D948). 진영 4 는 사기를 안 탑니다. */
function moraleMul(faction, morale) {
  if (faction === 1 || faction === 2) return morale.ally;
  if (faction === 3) return morale.enemy;
  return 100;
}

/* ─────────────────────────────────────────── 8. 경험치 · 성장 · 숙련 */

/** 0x17A61 — 획득 경험치. 레벨차 < 0 → 5, 아니면 (레벨차 + 1) × 10. */
function expGain(myLevel, enemyLevel) {
  const d = enemyLevel - myLevel;
  return d < 0 ? 5 : (d + 1) * 10;
}

/**
 * 0x17A20 — 경험치 적용.
 *   원본은 획득량을 "100 − 현재 경험치" 로 **잘라 냅니다**(0x17A97) — 초과분은 버려집니다.
 *   레벨 99 면 경험치 0, 획득 0.
 * @param {object} opt {keepOverflow:false}  true 로 두면 초과분을 살립니다(개선안).
 */
/* [개발 토글 «상한해제»] 켜면 레벨 999 · 순수 능력치 999 (원작 99 · 255) — 정본 181 */
function 상한해제켬() { var O = (root.G2Opt && root.G2Opt.cfg) || (root.Opt && root.Opt.cfg) || null; if (O && O['상한해제'] === '리마스터') return true;
  /* 정본 284 — 2회차 시작 때 고른 «레벨 상한 해제»는 그 판 세이브 덧값 LVCP 에 있다(회차 LOOP 와 같은 꼴 · 그 판에서만) */
  return (function () { try { var 덧 = (root.__상태 && root.__상태.ext && root.__상태.ext.덧값) || []; for (var i = 0; i < 덧.length; i++) if (덧[i] && 덧[i].열쇠 === 'LVCP' && 덧[i].값 && (덧[i].값[0] | 0)) return true; } catch (e) {} return false; })(); }
function 레벨상한() { return 상한해제켬() ? 999 : 99; }
function 마법상한해제켬() { var O = (root.G2Opt && root.G2Opt.cfg) || (root.Opt && root.Opt.cfg) || null; return !!(O && O['마법상한해제'] === '리마스터'); }   /* 정본 182 — 따로 켜고 끈다 */
/* [리마스터 «능력치상한해제»] 순수 능력치 상한 255 → 999 — 레벨 상한(99)과 떼어 1회차에도 (11-16 사장님 「1회차에도 레벨은 99로 제한하지만 나머지 스탯은 풀어도 될 것 같아. 기존에 최대 성장치에 걸려서 멈추는 애들이 있어서.」 · 정본 245) */
function 능력치상한해제켬() { var O = (root.G2Opt && root.G2Opt.cfg) || (root.Opt && root.Opt.cfg) || null; return !!(O && O['능력치상한해제'] !== '원작'); }
function 능력상한() { return 능력치상한해제켬() ? 999 : 255; }   /* 11-16 사장님 「그러면 다회차에 능력치 상한 해제가아니라 레벨 제한 해제가 될거야」 — 개발 토글 «상한해제»는 레벨만 */
function applyExp(u, gain, opt) {
  var 끝레벨 = 레벨상한();
  if (u.level >= 끝레벨) { u.exp = 0; return { gain: 0, levels: 0 }; }   // 0x17AA6 (원작 99)
  let g = gain;
  if (!(opt && opt.keepOverflow)) g = Math.min(g, 100 - u.exp);      // 0x17A97
  u.exp += g;
  let levels = 0;
  if (opt && opt.keepOverflow) {
    while (u.exp >= 100 && u.level < 끝레벨) { u.level++; u.exp -= 100; levels++; }
    if (u.level >= 끝레벨) u.exp = 0;
  } else if (u.exp === 100) {                                        // 0x17B5A  ★ == 100
    u.level++; u.exp = 0; levels = 1;
  }
  return { gain: g, levels };
}

/**
 * 0x1767E — 레벨업 성장 조회.  edx = 0~5.
 *   0~3 : 힘·민첩·지력·카리스마 — 레벨 mod 표값 == 0 이면 1(= +1)
 *   4·5 : 최대HP·최대MP        — 증가량 = 15 − (표값 − 1) × 3
 *   직업 >= 0x3F 는 무조건 1, 표값 0 이면 0.
 */
function growth(u, idx, T) {
  /* ★ [리마스터] 201 이상은 추가 «사람» 직업이다 (extjob · 2026-10-02) — 원본은 0x3F 이상을 몬스터로 본다 */
  if (u.job >= 0x3F && u.job < 201) return 1;        // 0x17682
  const row = T['성장표'][u.job];
  const v = row ? (row[idx] | 0) : 0;
  if (v === 0) return 0;                             // 0x176AD
  if (idx <= 3) return (u.level % v === 0) ? 1 : 0;  // 0x176AF
  return 15 - (v - 1) * 3;                           // 0x176CD
}

/**
 * ★★★ **아이템 성장 보정** — `ITEM.DAT +0x33`·`+0x34`·`+0x35` = 힘·지력·민첩
 *
 *  기준본 — `03_분석/00_능력치와_아이템_처리.md` §5 ㉰
 *
 *  ☠ **두 판 어디에도 이 칸을 읽는 코드가 없다.** 데이터만 6개 들어 있다
 *    (단도 `[0,0,1]` 민첩 · 소검 `[1,0,0]` 힘 · 수련검·도끼·창 `[1,0,1]` 힘+민첩 ·
 *     용아 `[1,1,1]` 셋 다). 창1 에는 구현돼 있었고(`+0x36~38`), 창2 가 옮기면서 빠졌다.
 *
 *  ★ 칸이 무엇인지는 **사장님이 채우셨다** — 창1 자료(`07_보관/창세기전1/창세기전1.xlsx`)의
 *    「?」 세 칸이 **힘·지·민**이고, 「수련검은 힘」·「(단도는) 민첩」이다.
 *    교차 검증 — `GEFF'S PANTS`(힘 +20)·`CRYSTAL ORB`(지 +30)·`WIND CLORK`(민 +10)가
 *    각각 같은 칸에 성장을 갖는다. 예외 0건.
 *
 *  ☐ **계산식은 아직 원본으로 못 봤다.** 창1 은 16비트라 바이트 검색이 가짜를 잡는다.
 *    사장님 기억(「**더하기로 알고는 있는데**」)대로 **매 레벨업에 값만큼 더한다.**
 *    다른 식이 밝혀지면 여기만 고치면 된다 — 관문이 지킨다.
 */
function 아이템성장(u, T) {
  const 없음 = { str: 0, int: 0, agi: 0 };
  if (!T || !T['아이템'] || !u || !u.equip) return 없음;
  /* 무기·방패·장신구 3칸 — 장비 보정과 같은 셋을 본다 */
  const 합 = (키) => itemFieldS(T, u.equip.weapon, 키)
                   + itemFieldS(T, u.equip.shield, 키)
                   + itemFieldS(T, u.equip.accessory, 키);
  /* `tables.json` 은 세 칸을 `성장: [힘, 지, 민]` 배열로 뽑아 두었다 */
  const 한칸 = (code, i) => {
    if (!code) return 0;
    const r = T['아이템'][code - 1];
    return (r && r['성장'] && (r['성장'][i] | 0)) || 0;
  };
  const 칸합 = (i) => 한칸(u.equip.weapon, i) + 한칸(u.equip.shield, i) + 한칸(u.equip.accessory, i);
  return { str: 칸합(0), int: 칸합(1), agi: 칸합(2) };
}

/* [리마스터] 수련 장비(성장 칸이 있는 무기·방패·장신구) 쓰는 법 — 게임설정 «수련 장비» 세 갈래 (2026-11-16 · 정본 170)
 *   사장님 「2번은 일단 경험치 증가와 능력치 증가를 둘다 구현해서 토글로 전환하도록 해줘. 끄거나, 성장치 보정, 경험치 증가 이렇게 나누어서.」
 *   '끔'     — 원작 창2 그대로: 성장 칸을 안 읽는다(두 판 EXE 어디에도 읽는 코드 없음)
 *   '성장치' — 레벨업마다 성장 칸 값을 능력치에 더한다(지금까지의 리마스터 · 기본)
 *   '경험치' — 성장 칸은 안 더하고, 낀 장비 성장 칸 합 1 점마다 얻는 경험치 +25% (단도·소검 +25% · 수련검·도끼·창 +50% · 용아 +75%) */
function 수련모드() { var O = (root.G2Opt && root.G2Opt.cfg) || (root.Opt && root.Opt.cfg) || null; var v = O && O['수련장비']; return (v === '끔' || v === '경험치') ? v : '성장치'; }
const 수련경험치비율 = 0.25;
function 수련경험치배(u, T) {
  if (수련모드() !== '경험치') return 1;
  const g = 아이템성장(u, T);
  return 1 + 수련경험치비율 * ((g.str | 0) + (g.int | 0) + (g.agi | 0));
}

/** 레벨업 한 번에 붙는 성장 전부. HP·MP 는 ×100 · ×1 로 반영합니다. */
function applyGrowth(u, T, opt) {
  const out = { str: 0, agi: 0, int: 0, cha: 0, hp: 0, mp: 0 };
  /* ★ 아이템 성장 — 원작 주기와 **별개로** 매 레벨업에 더한다 (§5 ㉰) · 게임설정 «수련 장비»가 «성장치 보정»일 때만 (정본 170) */
  const g = ((!opt || opt.itemGrowth !== false) && (opt && opt.itemGrowth === true || 수련모드() === '성장치')) ? 아이템성장(u, T) : { str: 0, int: 0, agi: 0 };
  const 순수 = u.순수 || u.base;
  const 민첩칸 = u.순수 ? 'agi' : ((u.base.dex != null) ? 'dex' : 'agi');
  const 올림 = (k, n) => {
    const 전 = 순수[k] | 0;
    const 후 = Math.min(능력상한(), Math.max(0, 전 + (n | 0)));   /* 원작 255 · 상한해제 999 */
    순수[k] = 후;
    return 후 - 전;
  };
  if (growth(u, 0, T) === 1) out.str += 올림('str', 1);
  /* `Rules` 단독 모델은 `base.agi`, 실제 전투 유닛(`state.js makeUnit`)은
   * 원본 레코드 +0x42 이름을 따라 `base.dex` 를 쓴다. 전에는 실제 전투에서도
   * `base.agi` 를 만들려다 NaN이 되어, 판정/메시지는 「민첩도 상승」인데 저장값과
   * 전투 능력치는 오르지 않았다. 두 모델 중 이미 존재하는 칸 하나만 올린다. */
  if (growth(u, 1, T) === 1) out.agi += 올림(민첩칸, 1);
  if (growth(u, 2, T) === 1) out.int += 올림('int', 1);
  if (growth(u, 3, T) === 1) out.cha += 올림('cha', 1);
  if (g.str) out.str += 올림('str', g.str);
  if (g.int) out.int += 올림('int', g.int);
  if (g.agi) out.agi += 올림(민첩칸, g.agi);
  out.hp = growth(u, 4, T); u.maxHp += out.hp * 100;
  out.mp = growth(u, 5, T); u.maxMp += out.mp;
  return out;
}

/** 무기 계열 상한 — 0x177D5~0x17831. 색인 0 검 1 창 2 부 3 궁 4 권. */
const WEAPON_SKILL_CAP = [7, 4, 4, 4, 6];
/**
 * [리마스터] 창1 숙련 증가량 — 레벨대마다 오르는 양 (2026-10-02 사장님 「필살기 창1 표, 마법은 a안으로 가자 토글은 각각」)
 *   창1 CHRSYS.EXE 0xAC7A 가 ds:0xC8C 의 word 9개를 [(새 레벨 − 1) / 10] 으로 고른다 — 직업은 안 본다.
 *   창2 COMBATII.EXE 0x17481 에 같은 표가 그대로 남아 있으나 읽는 곳이 없다(0x17751·0x1779E 가 +10 고정).
 *   창1 은 91 이상에서 표 밖을 읽는다 — 여기서는 마지막 값(50)으로 둔다.
 *   문서: 03_분석/COMBATII/숙련_경험치_시스템.md «창1 CHRSYS.EXE 직독»
 */
const MASTERY_GAIN_G1 = [10, 15, 20, 20, 25, 35, 35, 50, 50];
function masteryGainG1(level) {
  const i = Math.floor(((level | 0) - 1) / 10);
  return MASTERY_GAIN_G1[Math.max(0, Math.min(MASTERY_GAIN_G1.length - 1, i))];
}
/**
 * 0x176F1 / 0x17D2F — 레벨업 숙련.
 *   무기(dx 6~10)는 **쓸 수 있는 계열 전부** 가 +10 (칸 하나를 공유하므로 겹치면 +20 …).
 *   마법(dx 11~17)은 **아직 최대에 닿지 않은 첫 계열 하나만** 오릅니다.
 *   100 에 닿으면 그 계열이 한 단계 오르고 경험치는 0 으로 초기화.
 *   opt.필살기 / opt.마법 — [리마스터] 켜면 그쪽 +10 을 창1 레벨대 증가량(masteryGainG1)으로 바꾼다.
 *     나머지(어느 계열·한 계열씩·상한·0 초기화)는 원작 그대로다.
 */
function levelUpMastery(u, T, opt) {
  const log = [];
  const 무기량 = opt && opt.필살기 ? masteryGainG1(u.level) : 10;   // 원작 0x17751 +10
  const 마법량 = opt && opt.마법 ? masteryGainG1(u.level) : 10;     // 원작 0x1779E +10
  const grow = T['성장표'][u.job] || [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  // 무기 — 표 칸 6·7·8·9 = 검 · 도끼 · 창 · 활 (점프표 순서)
  const weaponMap = [{ col: 6, skill: 0 }, { col: 7, skill: 2 }, { col: 8, skill: 1 }, { col: 9, skill: 3 }];
  for (const w of weaponMap) {
    if (!grow[w.col]) continue;
    u.wexp += 무기량;                                 // 0x17751
    if (u.wexp >= 100) {                             // 0x177AD
      if (u.spLv[w.skill] < WEAPON_SKILL_CAP[w.skill]) { u.spLv[w.skill]++; log.push('무기' + w.skill); }
      u.wexp = 0;
    }
  }
  // 권 — 표에 칸이 없어 직업 47·48 만 코드에 박아 두었습니다 (0x17760)
  /* [리마스터 B-01] 테이머(0x33)도 권 숙련이 오른다 — 원본 0x1775D 는 47·48 만 (리마스터_변경사항 B-01) */
  if (u.job === 0x2F || u.job === 0x30 || u.job === 0x33) {
    u.wexp += 무기량;
    if (u.wexp >= 100) { if (u.spLv[4] < WEAPON_SKILL_CAP[4]) { u.spLv[4]++; log.push('권'); } u.wexp = 0; }
  }
  // 마법 — 0x72310 의 최대 클래스보다 낮은 첫 계열 하나만
  const cap = T['마법최대클래스'][u.job] || [0, 0, 0, 0, 0, 0, 0];
  for (let s = 0; s < 7; s++) {
    if (cap[s] === 0) continue;
    if (cap[s] - 1 <= u.magicClass[s]) continue;     // 0x17796
    u.mexp += 마법량;                                 // 0x1779E
    if (u.mexp >= 100) { u.magicClass[s]++; u.mexp = 0; log.push('마법' + s); }
    break;                                           // 0 을 돌려주고 루프가 끊깁니다
  }
  return log;
}

/* ─────────────────────────────────────────── 9. 승패 */

/** 0x3C2EB — 진영 전멸 = 그 진영 연결 리스트([0xCC968 + (진영−1)*8])의 head 가 NULL. */
function factionWiped(units, faction) {
  return !units.some(u => u.faction === faction && u.hp > 0);
}
/** 카테고리 B 이벤트의 첫 바이트 = 리스트 색인 (0 아군 · 1 우군 · 2 적군 · 3 몬스터). */
function factionListIndex(faction) { return faction - 1; }
/** 스크립트 명령 — 0x65 게임 오버 · 0x12 다음 맵 · 0x01 전투 종료 */
const SCRIPT_CMD = { GAME_OVER: 0x65, NEXT_MAP: 0x12, END_BATTLE: 0x01 };

/**
 * 진영 전멸 하나로 승패를 정리합니다(원본은 .SCE 이벤트가 정합니다 — 여기는 기본형).
 * @returns {null|'gameover'|'clear'}
 */
function judge(units) {
  if (factionWiped(units, 1)) return 'gameover';                       // 아군 전멸 → 0x65
  if (factionWiped(units, 3) && factionWiped(units, 4)) return 'clear'; // 적 전멸 → 0x12 / 0x01
  return null;
}

/* ─────────────────────────────────────────── 내보내기 */

const Rules = {
  VERSION: '1.0 (COMBATII.EXE 대조 완료)',
  // 유틸
  s8, s16, idiv, clamp, makeRng, itemField, itemFieldS, itemAffinity, job, newUnit,
  spriteProfile, spriteBodyClass, isSpecialBody, isOrdinaryBody, isStatusImmune, isMagicEffectExcluded,
  isKnockbackImmune, isCommandRestricted, usesSpecialMotion, usesSpecialDeath, isMountBody, needsLargeVisual,
  spriteSizeClass, isLargeSprite, isOrdinarySprite,
  // 1 능력치
  derive, weaponType, equipSum3, mountAtk,
  // 2 물리
  criticalBag, critCheck, facingClass, weaponGrade, hitCheck, physicalDamage,
  isHostile, attackAttr, affinity, counterRange, counterAttack, 속성무기속성, 속성무기인가, 물리면역켜짐, 무기속성, 무기속성켬, 속성이름,
  // 3 마법
  spellNumber, spellSlot, spellMp, spellTp, magicDamage, magicHeal,
  // 4 필살기
  specialTp, specialHpCost, ultimateTp, ultimateHpCost, specialHpPay,
  specialClassRoll, specialDamage, ultimateAvailable, ultimateOf, ultimateRow, ultimateXa, ULTIMATE_BY_PAIR, ULTIMATE_EXTRA,
  ULTIMATE_BY_CHAR, ULTIMATE_XA, WEAPON_SKILL_CAP, MASTERY_GAIN_G1, masteryGainG1,
  // 5 TP · 이동
  tpRecharge, moveBudget, moveTpCost, moveType, terrainCost, zocMap,
  endTurnStance, readyTick,
  // 6 상태이상
  statusChance, statusRoll, statusApply, tickDurations, dotDamage, terrainDamage,
  /* ★ 통합 2-c — 「대상인가」까지 준다 (0x17310 은 면제·비대상이면 0x17477 로 빠진다) */
  지형효과,
  BUFF_SLOT, AIL_SLOT, slotOfBit, applyBuffBit, applyAilmentBit, applyElement, curseTick, 상태칸묶기,
  // 7 사기
  MORALE_MIN, MORALE_MAX, moraleIndex, moraleOnDeath, moraleTaunt, moraleSacrifice, moraleMul,
  // 8 경험치
  expGain, applyExp, growth, applyGrowth, 수련모드, 수련경험치배, levelUpMastery, 레벨상한, 능력상한, 상한해제켬,   /* 정본 181 */
  // 9 승패
  factionWiped, factionListIndex, judge, SCRIPT_CMD
};

root.Rules = Rules;
if (typeof module !== 'undefined' && module.exports) module.exports = { Rules };

})(typeof globalThis !== 'undefined' ? globalThis : this);
