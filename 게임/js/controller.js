/* ============================================================================
 * 창세기전 2 — 전투 컨트롤러 (G2Controller)
 *
 * 명세서 §5.2 「웹 구현에서 필요한 단일 권위 상태」 · §26 모듈 구조 · §27 불변식.
 * 상태 ID 는 §23 목록을 그대로 씁니다.
 *
 * ── 이 파일의 책임 ────────────────────────────────────────────────────
 *   ① `BattleControllerState` 를 **혼자** 소유합니다.
 *      battle · ring · move · combat · turn · fx · renderer 는 서비스일 뿐이고
 *      입력 상태를 따로 갖지 않습니다.
 *   ② 입력 라우터 — 지금 상태에만 입력을 흘립니다 (§26 input-router).
 *   ③ 세션(0x4D674) · 이동(0x16834) · 선택기(0x4A483) · 실행기를 엮습니다.
 *   ④ 연출 중에는 입력을 잠급니다 (불변식 8).
 *   ⑤ 시점·거리 조절은 여기 없습니다 — 카메라는 논리 상태를 **읽기만** 합니다 (불변식 12).
 *
 * ── 서비스 주입 ───────────────────────────────────────────────────────
 *   G2Controller.create(battle, {
 *     anim,      G2Anim 인스턴스 (없으면 즉시 완료 = Node 검증용)
 *     ringView,  { open(unit,icons,ctx), swap(menu,icons), close(), gather(), spread() }
 *     hud,       { selectUnit(u), showStatus(u), hideStatus(), drainAp(tp), message(s) }
 *     view,      { center(x,y), marks(list), selectBox(t), updateUnit(u), apply() }
 *     rng, onState(mode, ctrl)
 *   })
 *   전부 없어도 됩니다. 없으면 그냥 안 부릅니다.
 * ==========================================================================*/
(function (root) {
'use strict';

function S() { return root.G2State; }
function Turn() { return root.G2Turn; }
function Mv() { return root.G2Move; }
function Cb() { return root.G2Combat; }
function AI() { return root.G2AI; }
function Xc() { return root.G2Executor; }
function Sess() { return root.G2Session; }
function Move2() { return root.G2Movement; }
function Sel() { return root.G2Selector; }
function Anim() { return root.G2Anim; }

/* ── §23 상태 ID 전체 목록 ─────────────────────────────────────────── */
var MODE = {
  /* 23.1 전역·턴 */
  BOOTSTRAP: 'BOOTSTRAP', FRAME_IDLE: 'FRAME_IDLE', MAP_CURSOR_MOVE: 'MAP_CURSOR_MOVE',
  SYSTEM_MENU: 'SYSTEM_MENU', ROUND_ADVANCE: 'ROUND_ADVANCE', UNIT_SCAN: 'UNIT_SCAN',
  ACTOR_RECHARGE: 'ACTOR_RECHARGE', ROUND_END: 'ROUND_END',
  /* 23.2 세션·링 */
  ACTOR_SESSION_ENTER: 'ACTOR_SESSION_ENTER', RING_BUILD_MAIN: 'RING_BUILD_MAIN',
  RING_OPENING: 'RING_OPENING', RING_IDLE: 'RING_IDLE', RING_GATHER: 'RING_GATHER',
  RING_SPREAD: 'RING_SPREAD', RING_CLOSING: 'RING_CLOSING',
  SPECIAL_MENU: 'SPECIAL_MENU', MAGIC_MENU: 'MAGIC_MENU', SKILL_MENU: 'SKILL_MENU',
  AI_MENU: 'AI_MENU', AI_COORD_SELECT: 'AI_COORD_SELECT', STATUS_VIEW: 'STATUS_VIEW',
  /* 23.3 이동·대상 */
  MOVE_RANGE_BUILD: 'MOVE_RANGE_BUILD', MOVE_DESTINATION_SELECT: 'MOVE_DESTINATION_SELECT',
  MOVE_PATH_DRAFT: 'MOVE_PATH_DRAFT', FACING_SELECT_ENTER: 'FACING_SELECT_ENTER',
  FACING_SELECT: 'FACING_SELECT', MOVE_COMMIT: 'MOVE_COMMIT',
  MOVE_ANIMATING: 'MOVE_ANIMATING', POST_MOVE: 'POST_MOVE',
  TARGET_RANGE_BUILD: 'TARGET_RANGE_BUILD', TARGET_SELECT: 'TARGET_SELECT',
  ACTION_CONFIRM: 'ACTION_CONFIRM',
  /* 23.4 행동·연출 */
  ATTACK_COMMIT: 'ATTACK_COMMIT', ATTACK_ANIMATING: 'ATTACK_ANIMATING',
  COUNTER_ANIMATING: 'COUNTER_ANIMATING',
  SPECIAL_PREPARE: 'SPECIAL_PREPARE', SPECIAL_COMMIT: 'SPECIAL_COMMIT',
  SPECIAL_ANIMATING: 'SPECIAL_ANIMATING',
  MAGIC_PREPARE: 'MAGIC_PREPARE', MAGIC_COMMIT: 'MAGIC_COMMIT',
  MAGIC_ANIMATING: 'MAGIC_ANIMATING',
  SKILL_PREPARE: 'SKILL_PREPARE', SKILL_COMMIT: 'SKILL_COMMIT',
  SKILL_ANIMATING: 'SKILL_ANIMATING',
  ITEM_OR_WAIT: 'ITEM_OR_WAIT', DEFEND_COMMIT: 'DEFEND_COMMIT',
  GUARD_COMMIT: 'GUARD_COMMIT', FOCUS_COMMIT: 'FOCUS_COMMIT', ACTOR_END: 'ACTOR_END',
  /* 23.5 AI·결과 */
  AI_SESSION_ENTER: 'AI_SESSION_ENTER', AI_DECIDE: 'AI_DECIDE', AI_MOVE: 'AI_MOVE',
  AI_ACTION: 'AI_ACTION', AI_END: 'AI_END',
  UNIT_DEATH: 'UNIT_DEATH', EVENT_EVALUATE: 'EVENT_EVALUATE',
  BATTLE_OUTCOME: 'BATTLE_OUTCOME', GAME_OVER_MENU: 'GAME_OVER_MENU'
};

/* 링 명령 → 실행기 명령. 아이콘 8 은 **휴식**입니다 (충돌해소 §3). */
var CMD_MAP = { attack: 'attack', defend: 'defend', guard: 'guard', focus: 'focus',
                item: 'rest', status: 'status', ai: 'ai',
                magic: 'magic', special: 'special', skill: 'skill' };

/* 대상을 골라야 하는 명령.
 *
 * ★ 필살기는 여기 있다고 해서 다 선택 화면이 뜨는 게 아닙니다.
 *   원본 `0x4C98A` 는 등급을 뽑고 `0xF1474+슬롯*4` 실행 함수를 **바로** 부르고,
 *   대상 선택은 실행 함수 안에서만 일어납니다. 25종 중 커서가 뜨는 건 8종뿐입니다.
 *   슬롯별 발동 방식은 tables.json `필살기발동` 에 있고 `activationOf()` 가 읽습니다. */
var NEEDS_TARGET = { special: 'special', magic: 'magic' };

/* 발동 방식 세 갈래 — tables.json `필살기발동_설명` */
var ACT = { IMMEDIATE: 'IMMEDIATE', FRONT_AUTO: 'FRONT_AUTO', TARGET_PICK: 'TARGET_PICK' };

/* 표가 없을 때의 기본값. 못 밝힌 것은 선택 화면을 띄우는 쪽이 안전합니다. */
var ACT_UNKNOWN = { 발동: ACT.TARGET_PICK, 대상: '적', 빈칸허용: false,
                    확실성: '미확정', 근거: 'tables.json 에 발동 표가 없습니다' };

function noop() {}

/* ══════════════════════════════════════════ 컨트롤러 */

function Controller(battle, svc) {
  svc = svc || {};
  this.battle = battle;
  /* 난수기는 전투 내내 한 스트림을 써야 합니다. null을 넘긴 채 Rules.hitCheck가
   * 매 공격마다 같은 기본 시드(첫 roll=1)를 만들면 기본 회피율 10에 계속 걸립니다. */
  var persistentRng = svc.rng || (root.Rules && root.Rules.makeRng
    ? root.Rules.makeRng(((Date.now ? Date.now() : 0x44913) ^ ((battle.turn | 0) << 8)) >>> 0)
    : null);
  this.svc = {
    anim: svc.anim || Anim() || null,
    ringView: svc.ringView || null,
    hud: svc.hud || null,
    view: svc.view || null,
    rng: persistentRng,
    onState: svc.onState || noop,
    onEvent: svc.onEvent || noop,
    onMessage: svc.onMessage || noop,
    /* ★★★★★ **`wait`·`focus`·`updateUnit` 이 목록에 없어 조용히 사라지고 있었다**
     *   (2026-09-02 · 바로 위 주석이 경고한 그 함정에 그대로 걸렸다)
     *
     *   이 셋은 컨트롤러가 **이미 쓰고 있었다** —
     *     `focus`      탐색(스킬 3)이 찾은 칸으로 카메라 (`0x18DFA call 0x1124A`)
     *     `wait`       탐색 실패 500틱 (`0x18D8F eax = 0x1F4` → `0x18D94 call 0x499EF`) ·
     *                  스킬 문구 뒤 대기 (`0x1033B`)
     *     `updateUnit` 스킬 모션 `[+0x64]` 세우기·되돌리기 (`0x12124`)
     *   그런데 화이트리스트에 없어 `if (this.svc.focus)` 가 **언제나 거짓**이었다.
     *   실측 — `svc` 키 열다섯에 셋이 **없었다**. */
    wait: svc.wait || null,
    delay: svc.delay || null,
    nextFrame: svc.nextFrame || null,
    focus: svc.focus || null,
    updateUnit: svc.updateUnit || null,
    dyingUnit: svc.dyingUnit || null,
    unitMsg: svc.unitMsg || null,          /* 0x48612 — 유닛 머리 위 문구 */
    /* 라운드 훅 — SCE 턴 이벤트(원본 0x19DF8 → 0x53523).
     * ★ `svc` 는 여기서 **화이트리스트로 복사**됩니다. 새 손잡이를 만들 때
     *   이 목록에 넣지 않으면 조용히 사라집니다(그래서 이벤트가 안 났습니다). */
    onRound: svc.onRound || null,
    /* 격파 획득 대사창 — 사망 연출 직후 유닛마다 (0x1DBCD → 0x17A20 → 0x482A5) */
    onKillGain: svc.onKillGain || null,
    /* 도트(화상·감전·중독) 연출 — 원본 0x19C82~0x19D29 (battle_main svc.도트연출 · 2026-09-26 Z-67) */
    도트연출: svc.도트연출 || null,
    /* [리마스터 부활선택] 리바이블 대상 고르기 창 (battle_main svc.부활선택창 · 2026-09-26 Z-88) */
    부활선택창: svc.부활선택창 || null,
    /* ★★★★★ **HP 변경 창구** — 통합 2-c (2026-08-22 · GPT 10~12차)
     *
     *   원본은 S3/S4 이벤트를 **HP 가 바뀐 직후, 그 유닛으로** 검사한다
     *   (`0x53797` · 호출부 **7곳**). 매 틱 목록을 훑지 않는다.
     *   기준본 — `03_분석/COMBATII/SCE_HP변경_창구.md`
     *
     *   ★ **HP 값 변경 ≠ `0x53797` 호출 경계**다. 확인된 호출은 일곱 곳뿐이라
     *     범용 setter 가 매번 스캔하면 **원본에 없는 호출이 생긴다.**
     *     그래서 호출자가 `원본경계` 를 **명시**하고, `G2HpWatch` 가 그것을
     *     표와 대조해 `스캔` 여부를 정한다.
     *
     *   서명: `HP변경알림({ 변경유닛, 주체유닛, 이전HP, 이후HP, 까닭, 원본경계 })`
     *   반환: 보고(얼려 있다) 또는 `null`(HP 가 안 바뀜). `보고.대기` 가 있으면
     *         **다음 진행 전에 기다린다**. */
    HP변경알림: svc.HP변경알림 || null,
    /* 사망 처리 뒤 시전자 자세 복귀 — 원본 0x28889(사망 처리) → 0x12124 (2026-09-25 · 칸 133) */
    시전자자세복귀: svc.시전자자세복귀 || null,
    /* 사망 처리 뒤 초필살기 HP 소모 — 원본 0x4CA6E 0x301BB 는 연출 함수(피해·사망 포함)가 반환한 뒤 (2026-09-26) */
    필살HP소모: svc.필살HP소모 || null,
    /* ★★★ **영역효과 S3 창구** — 통합 2-c 4단계 (2026-08-22)
     *   서명: `영역S3알림({ 소스유닛, 대상목록, 모드, 원본경계 })`
     *   ★ 원본 `0x1DE15` — 대상 확정 뒤 · 첫 피해 전에 **한 번**. */
    영역S3알림: svc.영역S3알림 || null,
    /* ★★★ **S5 창구** — 통합 2-c 6단계 (2026-08-22)
     *   서명: `관계S5알림({ 유닛1, 유닛2, 원본경계 })`
     *   ★ 원본 `0x1DE2A` — S3(`0x1DE15`) **뒤** · 크리티컬/피해 **앞**,
     *     **대상 배열 순서대로 대상마다** 한 번씩. */
    관계S5알림: svc.관계S5알림 || null,

    /* ★★★★★ **S2 + S6 창구** — 원본 `0x5401B` (2026-08-22)
     *   서명: `S2S6알림({ 유닛 })` — **유닛 하나**를 받아 둘을 한 묶음으로:
     *     ① `0x5403A call 0x5361C` — S2 (구역 안 유닛)
     *     ② `0x54061`~`0x5407C` — **바라보는 방향 한 칸 앞**의 유닛 찾기
     *     ③ `0x5408E call 0x5394D`(bx=1) — S6 (두 유닛 관계 · 순서 무관)
     *   ★ `0x5361C` 호출부는 `0x5403A` **한 곳뿐**이다 — S2 는 단독으로 안 돈다.
     *   반환: `{대기}` 또는 `null`. */
    S2S6알림: svc.S2S6알림 || null,

    /* ★★★★★ **§11(진영 전멸) 질의 창구** — 원본 `0x3C2F6` → `0x53F94`
     *   (2026-08-27 · 사용자 ① 「1-2부터 1-5진행에 루프 돌아서 계속 반복」)
     *
     *   ☠ **이 줄이 빠져 있어 화면에서 안 고쳐졌다.** `battle_main.js` 의 `svc` 에는
     *     넣었는데 **여기 화이트리스트에 안 넣어** `this.svc.전멸이벤트있나` 가
     *     `undefined` 였고, `checkOutcome()` 의 가드가 `typeof !== 'function'` 으로
     *     **언제나 통과**해 「아군 전멸 → defeat」 를 그대로 냈다.
     *     회귀 시험이 **문자열 검색**이라 못 잡았고 **화면 확인이 잡았다.**
     *     (강제 사망으로 검증할 때는 §11 이 `deaths` 경로로 먼저 돌아 가려져 있었다.)
     *
     *   서명: `전멸이벤트있나(진영인덱스)` → boolean
     *     0 아군 · 1 우군 · 2 적군 · 3 몬스터
     *   ★ `true` 면 `checkOutcome()` 은 **입을 다문다** — 승패는 §11 이 정한다. */
    전멸이벤트있나: svc.전멸이벤트있나 || null,
    /* §11 — 한 명의 사망 처리 끝(0x1DD9C → 0x1DDD7 → 0x1DDE3)에서 그 유닛의 진영이 비었나 본다 (2026-10-11) */
    사망전멸: svc.사망전멸 || null
  };

  /* ── §5.2 BattleControllerState — 단일 권위 ─────────────────────── */
  this.mode = MODE.BOOTSTRAP;
  this.actor = null;              // 이번 차례 유닛 (턴 관리자가 준 것)
  this.session = null;            // 0x4D674
  /* ★★★★★ **SCE 세대** — 옛 연출이 늦게 끝나도 새 상태를 건드리지 못하게 (GPT 37차 ⑥)
   *   > 「토큰만으로는 이전 전투의 늦은 완료를 완전히 막지 못한다 —
   *   >  런타임마다 토큰이 다시 1부터 시작할 수 있다」
   *   전투가 새로 시작되거나 세션이 끊길 때마다 **올린다.** */
  this.SCE세대 = 1;
  /* ★ 2-4 (2026-08-26) — `SCE권위` 표와 `_SCE권위잠금` 을 지웠다.
   *   legacy `EVT` 가 없으니 섹션마다 소유자를 고를 일이 없다.
   *   **모든 섹션 = `SceRuntime`** 이 유일한 창구다. */
  this.cursorTile = { x: 0, y: 0 };
  this.ringContext = null;        // { menu, icons, unit }
  this.rangeContext = null;       // { kind, cells }
  this.moveDraft = null;
  this.targetDraft = null;
  this.actionSnapshot = null;
  this.animationToken = 0;
  this.inputLock = false;
  this.pendingOutcome = null;
  /* ★★★★★ **처음 진영 인원은 전투를 잡는 순간 기록한다** (2026-08-30)
   *
   *   ☠ 여태 `checkOutcome()` 이 **처음 불릴 때** `Math.max` 로 잡았다.
   *     그런데 세션 안에서 유닛이 죽는 경로가 **첫 호출**이면 그때는 이미
   *     적이 0명이라 「처음부터 0명인 진영」으로 오판하고 **판정을 접었다.**
   *     ⇒ 마지막 적을 죽여도 전투가 안 끝난다.
   *
   *   원본 `0x3C2EB  cmp dword [ecx+0xCC968], 0` → `0x3C2F6 call 0x53F94` 는
   *   **사망 처리 안에서 그 자리에서** 판정한다. 「처음 인원」을 보지 않는다 —
   *   누가 죽어야 그 자리에 오므로, 애초에 빈 진영은 올 일이 없다.
   *   우리는 안전망이라 초기 인원이 필요하지만, **잡는 시점**은 지금이 맞다. */
  this._초기진영 = (function (b) {
    try {
      return { 아군: (b.living(1).length + b.living(2).length) | 0,
               적군: (b.living(3).length + b.living(4).length) | 0 };
    } catch (e) { return null; }
  })(battle);
  /* ★★★★★ **전투가 끝났다는 사실은 지워지지 않는다** (2026-08-27 · 피드백 ⑫)
   *   `pendingOutcome` 은 **셸이 읽고 비운다**(`screens.js` BATTLE 틱).
   *   그것만 보면 셸이 비운 순간 `settle()` 이 **다시 라운드를 돌린다** —
   *   실측(1-5): 결말 `clear` 뒤에도 턴이 16 → 31 로 계속 올라갔다.
   *   원본은 `op 0x01` → `0x506F3` → `0x61CFF` 로 **프로세스가 끝난다.**
   *   ⇒ 「끝났다」는 컨트롤러가 따로 기억하고, 전투를 새로 시작할 때만 지운다. */
  this.전투끝남 = false;
  this.pendingNextScenario = null;   /* ★ op 0x12 — 셸이 체인에 쓴다 (2026-08-23) */
  this.statusUnit = null;
  this._statusReturn = null;
  this.pendingCommand = null;     // 대상 선택 중인 명령
  this.lastActivation = null;     // 마지막 필살기의 발동 방식 (검증·HUD 용)
  this.history = [];              // 전이 기록 (검증용)
  this.historyMax = 512;

  this.movement = Move2().create();
  this.selector = Sel().create();
  this._guard = 0;
}

/* ── 상태 전이 기록 ───────────────────────────────────────────────── */
Controller.prototype._상태전이 = function (mode, note) {
  /* ★ 링으로 돌아가면 **활 당김 표시**를 지운다 — 다음에 다시 고르면 또 당겨야 한다
   *   (`0x2EFD0` 32틱 · 슬롯 15·16 · 위 `runCommand` 주석 참조) */
  if (mode === MODE.RING_IDLE || mode === MODE.UNIT_IDLE || mode === MODE.FRAME_IDLE) { this._활당김 = null; this._직선캠 = null; }
  this.mode = mode;
  if (this.history.length < this.historyMax) this.history.push(note ? mode + ':' + note : mode);
  this.svc.onState(mode, this);
  return mode;
};
/** 누적된 컨트롤러 전이 기록을 독립 배열로 반환한다. */
Controller.prototype.trace = function () { return this.history.slice(); };
/** 컨트롤러 전이 기록만 비우고 자신을 반환한다. */
Controller.prototype.clearTrace = function () { this.history.length = 0; return this; };
/** 주입된 메시지 표시 경계에 전투 안내를 전달한다. */
Controller.prototype.msg = function (s) { this.svc.onMessage(s); return this; };

/** 입력 잠금 또는 연출 드라이버 잠금이 남아 있는지 판정한다. */
Controller.prototype.locked = function () {
  return this.inputLock || !!(this.svc.anim && this.svc.anim.isLocked());
};

/** 입력·선택 상태의 읽기 전용 관찰 경계. 상태 쓰기는 Controller만 한다. */
Controller.prototype.현재모드 = function () { return this.mode; };
/** 현재 컨트롤러 상태가 지정 모드인지 판정한다. */
Controller.prototype.모드인가 = function (mode) { return this.mode === mode; };
/** 현재 커서 칸 좌표의 동결 스냅샷을 반환한다. */
Controller.prototype.커서칸 = function () {
  return Object.freeze({ x: this.cursorTile.x | 0, y: this.cursorTile.y | 0 });
};
/** 광역 효과 범위 확인 단계인지 판정한다. */
Controller.prototype.효과범위확인중인가 = function () {
  return !!(this.rangeContext && this.rangeContext.효과확인);
};
/** 이동 가능 영역을 표시하는 단계인지 판정한다. */
Controller.prototype.이동범위표시중인가 = function () {
  return !!(this.rangeContext && this.rangeContext.kind === 'move');
};
/** 선택기에 유효 대상 후보가 하나 이상 있는지 판정한다. */
Controller.prototype.대상후보있나 = function () {
  var s = this.selector;
  return !!(s && s.targets && s.targets.length > 0);
};
/** 입력·커서·범위·명령 대기의 동결 관찰 상태를 반환한다. */
Controller.prototype.선택상태 = function () {
  var c = this.cursorTile || { x: 0, y: 0 };
  return Object.freeze({
    모드: this.mode,
    커서: Object.freeze({ x: c.x | 0, y: c.y | 0 }),
    입력잠김: !!this.inputLock,
    효과범위확인중: this.효과범위확인중인가(),
    이동범위표시중: this.이동범위표시중인가(),
    대상후보있음: this.대상후보있나(),
    명령대기중: !!this.pendingCommand
  });
};
/** 행동 명령 세션이 존재하고 아직 끝나지 않았는지 판정한다. */
Controller.prototype.명령세션열림 = function () {
  return !!(this.session && !this.session.ended);
};
/** 현재 명령 세션 또는 컨트롤러가 소유한 행동 유닛을 반환한다. */
Controller.prototype.행동유닛 = function () {
  return (this.session && !this.session.ended && this.session.actor) || this.actor || null;
};
/** 열린 명령 세션이 소유한 행동자를 반환한다. */
Controller.prototype.명령행위자 = function () {
  return (this.session && !this.session.ended && this.session.actor) || null;
};
/** 명령 세션의 열림·행위자·비용·마법 선택 수를 동결해 반환한다. */
Controller.prototype.명령세션상태 = function () {
  var s = this.session;
  return Object.freeze({
    열림: !!(s && !s.ended),
    행위자: (s && !s.ended && s.actor) || null,
    이탈비용: s ? (s.exitCost | 0) : 10,
    마법선택수: (s && s.magicPicks) ? s.magicPicks.length : 0
  });
};
/** 지정 유닛이 현재 상태창 대상인지 판정한다. */
Controller.prototype.상태유닛인가 = function (u) { return this.statusUnit === u; };
/** 현재 상태창 대상 유닛을 반환한다(읽기 전용 · 입력선택_소유권). */
Controller.prototype.상태유닛 = function () { return this.statusUnit || null; };
/** 선택기가 마장기 원거리처럼 «앞 2칸» 커서로 열렸는지 판정한다(0x1F466 · 읽기 전용). */
Controller.prototype.선택기앞2칸인가 = function () { return !!(this.selector && this.selector.ctx && this.selector.ctx.앞2칸); };
/** 선택기 상태 이름을 반환한다(진단용 · 읽기 전용). */
Controller.prototype.선택기상태 = function () { return (this.selector && this.selector.state) || '-'; };

/** 주입 연출 드라이버로 한 연출을 재생하고 마지막 토큰을 기록한다. */
Controller.prototype._연출실행 = function (kind, payload) {
  var a = this.svc.anim;
  if (!a) return Promise.resolve({ token: 0, kind: kind, ok: true, result: null });
  var self = this;
  return a.play(kind, payload).then(function (r) { self.animationToken = r.token; return r; });
};

/* ══════════════════════════════════════════ 1. 전투 시작 · 턴 진행 */

/** 명세서 §6.1 `FRAME_IDLE` 로 들어가는 첫 걸음 */
Controller.prototype.beginBattle = function (opts) {
  this._상태전이(MODE.ROUND_ADVANCE, 'begin');
  /* 0x19652 초기화 + 턴 1 의 0x19AEF 한 번. 그 다음부터는 메인 루프(= settle)가
   * 0x19D53 을 매 바퀴 부르며 AI 를 굴리고 아군을 대기열에 쌓습니다. */
  var o = {};
  for (var k in (opts || {})) o[k] = opts[k];
  o.settle = false;
  this.head = Turn().begin(this.battle, o);
  return this.settle();
};

/** 지금 조작할 수 있는 아군 전부 — 화면과 입력이 함께 읽습니다 ([0xF041C]). */
Controller.prototype.readyUnits = function () { return Turn().readyPlayerUnits(this.battle); };

/* `0x19D3A → 0x1ED90`: 라운드 끝 생존 S4를 진영 순서대로 직렬 호출한다.
 * 계획 시점 스냅샷이 아니라 처리 순간 HP/alive를 다시 읽는다. */
function 라운드끝HP보고체인(ctrl, r, 체인) {
  var 후 = r && r.round && r.round.라운드끝후처리;
  if (!ctrl.svc.HP변경알림 || !후 || !후.대상 || !후.대상.length) return 체인;
  후.대상.forEach(function (x) {
    if (!x || !x.유닛) return;
    체인 = 체인.then(function () {
      var u = x.유닛;
      if (!((u.hp | 0) > 0 && u.alive)) return null;
      var 보 = ctrl.svc.HP변경알림({
        변경유닛: u, 주체유닛: null,
        이전HP: u.hp | 0, 이후HP: u.hp | 0,
        까닭: '기타', 원본경계: 후.원본경계
      });
      return (보 && 보.대기) || null;
    });
  });
  return 체인;
}

/* ★★★★★ **라운드(도트·지형) 사망에도 사망 연출을 낸다** (2026-10-05)
 *   사장님: 「상태이상 도트데미지로 죽을때 사망 연출 없는 문제」
 *   원본은 도트(0x199DC)·지형(0x17310 → 0x1745B)으로 죽어도 같은 `0x1DB1D` 를 탄다 —
 *     0x1DB50 S4 대사 → 0x1DB92 카메라 → 0x1DBA1 0x463FB / 0x1DBB7 0x46B2C / 0x1DBC0 0x46A11 사망 연출 → 0x1DD9C 리스트 제거.
 *   ☠ 우리 라운드 정리는 「사망전처리 → S4 → 사망후처리」만 하고 연출(`death`)을 안 불러 유닛이 그냥 사라졌다.
 *   ⇒ 공격 사망(`_사망처리`)과 같은 연출 창구를 부른다. 킬러가 없으니 경험치 창(0x1DBCD)은 없다. */
function 라운드사망표시(ctrl, u, 켬) {
  try { if (ctrl.svc && ctrl.svc.dyingUnit) ctrl.svc.dyingUnit(u, !!켬); } catch (e) {}
}
function 라운드사망연출(ctrl, u) {
  if (!u || u._사망연출함) return null;
  u._사망연출함 = true;
  ctrl._상태전이(MODE.UNIT_DEATH);
  return Promise.resolve(ctrl._연출실행('death', { unit: u }));
}

/* HP 변경 알림 창구 없이 남은 사망 유예를 닫는 호환 경계.
 * 0x1DB50 S4 보고는 만들지 않고 기존 사망마무리 순서만 보존한다. */
function 보고없는사망마무리(ctrl, r) {
  var 예정 = r && r.round && r.round.사망예정;
  if (!예정 || !예정.length) return;
  예정.slice().forEach(function (u) {
    if (Turn().사망마무리(ctrl.battle, u)) (r.died || (r.died = [])).push(u);
  });
  예정.length = 0;
}

/* 특정 유닛의 마지막 HP 보고 뒤 0x1745B → 0x1DB1D 사망을 닫는다.
 * 전처리 → 0x1DB50 S4 → 후처리이며, 동기 예외와 대기 거부에도 후처리를 실행한다. */
/* ★★★★★ **라운드 사망 뒤에도 그 진영이 비었나 본다** — 원본 0x1DB1D 끝 0x1DDD7 → 0x1DDE3 §11 (2026-10-05)
 *   지속 피해로 죽는 길(0x19D53 라운드)도 같은 사망 함수를 타므로 전멸 검사가 따라온다.
 *   ☠ 우리는 라운드 사망을 연출까지만 하고 §11 을 안 봐, 우군·아군이 지속 피해로 전멸해도 패배·이벤트가 안 났다
 *     (사장님 「레이몬드 죽었을 때 게임오버 안돼」) · 사망 보고 창구(onEvent)가 0x1DDE3 갈래를 그대로 탄다 */
function 라운드사망전멸(ctrl, u) {
  if (!ctrl || !ctrl.svc || typeof ctrl.svc.사망전멸 !== 'function') return null;
  var 외 = ctrl.svc.사망전멸(u);                       /* 0x1DDD7 → 0x1DDE3 (2026-10-11 onEvent 경유를 걷었다) */
  return (외 && typeof 외.then === 'function') ? 외 : null;
}
function HP보고뒤사망정리(ctrl, r, 사망예정, h) {
  var 마지막 = true;
  for (var k = r.hurt.indexOf(h) + 1; k < r.hurt.length; k++) {
    if (r.hurt[k] && r.hurt[k].unit === h.unit && r.hurt[k].이전HP != null) {
      마지막 = false; break;
    }
  }
  if (!마지막) return null;
  var i = 사망예정.indexOf(h.unit);
  if (i < 0) return null;
  사망예정.splice(i, 1);

  var 사망진영 = Turn().사망진영(h.unit);                 /* 0x1DB55 — 호출 지역 */
  if (!Turn().사망전처리(ctrl.battle, h.unit)) return null; /* 0x1DB2A · 0x1DB43 */
  라운드사망표시(ctrl, h.unit, true);                     /* S4 동안 맵에 남는다 (0x1DB50 · 리스트 제거는 0x1DD9C 맨 끝) */

  var 보고 = null, 동기오류 = null;
  try {
    보고 = ctrl.svc.HP변경알림({
      변경유닛: h.unit,
      주체유닛: (h.주체유닛 !== undefined) ? h.주체유닛 : null,
      이전HP: 0, 이후HP: 0,
      까닭: '사망', 원본경계: '0x1DB50'
    });
  } catch (e) { 동기오류 = e; }

  var 후처리 = function () {
    if (Turn().사망후처리(ctrl.battle, h.unit, 사망진영)) {
      (r.died || (r.died = [])).push(h.unit);
      return Promise.resolve(라운드사망연출(ctrl, h.unit)).then(function () { return 라운드사망전멸(ctrl, h.unit); });
    }
    라운드사망표시(ctrl, h.unit, false);                   /* S4 가 살렸다(0x1DB6B) — 표시만 푼다 */
    return null;
  };
  if (동기오류) { 후처리(); throw 동기오류; }
  if (보고 && 보고.대기)
    return Promise.resolve(보고.대기).then(후처리, function (e) { 후처리(); throw e; });
  return 후처리();
}

/** 한 프레임 쉬기 — 원본 메인 루프의 「한 바퀴 = 한 프레임」에 해당한다. */
/* 마지막 HP 보고에 걸리지 않은 사망을 원본 순서대로 직렬 정리한다.
 * 각 유닛은 전처리 → 0x1DB50 S4 → 후처리이며, 하나가 실패해도 전부 정리한 뒤
 * 처음 오류를 다시 던진다. 동기 예외와 Promise 거부 양쪽에서 후처리를 보장한다. */
function 남은사망직렬정리(ctrl, r, 사망예정) {
  var 남은 = 사망예정.slice();
  사망예정.length = 0;
  var 오류 = null;
  var 체인 = Promise.resolve();
  남은.forEach(function (u) {
    체인 = 체인.then(function () {
      var 사망진영u = Turn().사망진영(u);                 /* 0x1DB55 — 호출 지점 */
      if (!Turn().사망전처리(ctrl.battle, u)) return null; /* 0x1DB2A · 0x1DB43 */
      라운드사망표시(ctrl, u, true);
      var 보 = null, 동기오류 = null;
      try {
        보 = ctrl.svc.HP변경알림({
          변경유닛: u, 주체유닛: null, 이전HP: 0, 이후HP: 0,
          까닭: '사망', 원본경계: '0x1DB50'
        });
      } catch (e) { 동기오류 = e; }
      var 후처리 = function () {
        if (Turn().사망후처리(ctrl.battle, u, 사망진영u)) {
          (r.died || (r.died = [])).push(u);
          return Promise.resolve(라운드사망연출(ctrl, u)).then(function () { return 라운드사망전멸(ctrl, u); });
        }
        라운드사망표시(ctrl, u, false);
        return null;
      };
      if (동기오류) { 후처리(); throw 동기오류; }
      if (보 && 보.대기)
        return Promise.resolve(보.대기).then(후처리, function (e) { 후처리(); throw e; });
      return 후처리();
    }).catch(function (e) { if (!오류) 오류 = e; return null; });
  });
  return 체인.then(function () { if (오류) throw 오류; return null; });
}

function 전투프레임양보(ctrl) {
  if (ctrl && ctrl.svc && typeof ctrl.svc.nextFrame === 'function')
    return ctrl.svc.nextFrame();
  if (ctrl && ctrl.svc && typeof ctrl.svc.delay === 'function')
    return ctrl.svc.delay(0);
  if (ctrl && ctrl.svc && typeof ctrl.svc.wait === 'function')
    return ctrl.svc.wait(0);
  /* 독립 동기 하네스: 제품은 battle_main이 세션 nextFrame을 반드시 주입한다. */
  return Promise.resolve();
}

/* AI 직렬 실행 뒤의 `0x19EB7~0x19F56` 라운드 마무리.
 * 다음 라운드 호출은 명시 인자로 받아 settle의 지역 step 소유권을 유지한다. */
function AI라운드마무리(ctrl, r, 남은AI, 다음라운드) {
  /* ★ 멈췄으면 라운드를 **닫지 않는다** — 남은 유닛이 다음에 이어서 움직인다 */
  if (r.ai멈춤) {
    r.남은AI = 남은AI;
    ctrl._상태전이(MODE.AI_PHASE_HOLD || MODE.ROUND_ADVANCE, 'AI 페이즈 — ' + 남은AI.length + '기 대기');
    return r;
  }
  if (ctrl.pendingOutcome || ctrl.전투끝남) { ctrl._상태전이(MODE.BATTLE_OUTCOME); return null; }
  /* 0x19EB7~0x19F56 — 이제서야 라운드를 닫습니다. 대기열(0x19F06)은
   * 위 AI 행동 결과까지 반영된 값이라 원본과 같은 판단이 됩니다. */
  if (r.pendingClose) Turn().closeRound(ctrl.battle, { rng: ctrl.svc.rng }, r);
  ctrl._상태전이(MODE.ROUND_END);
  var o = ctrl.checkOutcome();
  if (o) { ctrl.pendingOutcome = o; ctrl.전투끝남 = true; ctrl._상태전이(MODE.BATTLE_OUTCOME); return null; }
  if (r.playerPhase) return r;                    // 0x19F3C — Player Phase 로 멈춤
  /* 원본 메인 루프 `0x5580F` 는 `0x19D53` 라운드 하나를 프레임마다 한 번 부른다.
   * 비동기 SCE가 도는 동안 다음 라운드를 시작하지 않는 기존 순서도 유지한다. */
  return 전투프레임양보(ctrl)
    .then(function () { return ctrl._이벤트끝날때까지(); })
    .then(다음라운드);
}

/**
 * 메인 루프 `0x5580F` 의 자동 진행 — **조작할 아군이 생길 때까지 시간을 흘립니다.**
 *
 * 한 바퀴가 `0x19D53` 한 번(= 라운드 하나)입니다. 그 안에서
 *   · AI 유닛은 그 자리에서 행동하고 (0x19E6F → 0x44913)
 *   · 플레이어 유닛은 **건드리지 않은 채 대기열에 남습니다** (0x19E63)
 * 멈추는 곳은 `(턴+1) % [0x74138] == 0` 이고 대기열이 비어 있지 않은 지점뿐입니다
 * (0x19EF1 → Player Phase). 그래서 한 번 멈추면 **여러 명이 동시에** 기다립니다.
 *
 * @returns {Promise<object|null>}  멈춘 지점의 `advance()` 보고
 */
Controller.prototype.settle = function (opts) {
  var self = this;
  opts = opts || {};
  var guard = opts.maxRounds != null ? (opts.maxRounds | 0) : 4096;
  /* ★★★★★ **`settle()` 은 세대를 올리지 않는다** (2026-08-22 — 실제 버그였다)
   *
   *   전에 여기서 올렸더니 **진행 중인 SCE 가 취소됐다**:
   *     ① `settle` 시작 → 세대 2
   *     ② `settle` 안에서 `onRound` → 소비 시작 (세대 2 캡처)
   *     ③ 대사 대기
   *     ④ 게임 루프가 또 `settle` → 세대 3
   *     ⑤ **옛 소비가 `{취소됨:true}` 로 접힌다** — 연출도 재개도 안 한다
   *
   *   `1-5.SCE` 권위 전환에서 실제로 이것 때문에 이동·카메라가 **한 번도 안 돌았다.**
   *
   *   ★ GPT 40차 ② 가 정확히 이것을 요구했다:
   *     > 「같은 `settle()` 안에서 시작된 S0/S3/S4/S11 소비는
   *     >  **다음 라운드까지 임의 취소되지 않음**」
   *
   *   ⇒ 세대는 **세션이 실제로 바뀔 때만** 올린다 —
   *     `endSession()` · `nextScenario` · 전투 교체(부팅).
   *     `settle()` 은 「시간을 흘리는」 것이지 세션 교체가 아니다. */

  this.session = null;
  this.rangeContext = null; this.moveDraft = null; this.targetDraft = null;

  /* ★ 이 고리가 도는 전투 — 도중에 전투가 바뀌면(개발 패널 시나리오 바꿈 · 체인 → 전투교체) 옛 고리는 거기서 멈춘다.
   *   ★ 사장님 「애초에 새 시나리오를 선택하면 컨트롤러를 리셋해야해.」 — 전투교체가 컨트롤러를 리셋하며 `_리셋세대` 를 올리고, 그 전에 시작한 고리는 버린다.
   *   ☠ 안 멈추면 옛 고리가 다음 라운드를 «새» 전투(self.battle)로 돌려, 배치 화면 뒤에서 적이 먼저 움직이고
   *     A.I. 페이즈 배너가 떴다 (2026-11-07 사장님 「전투중 다른 전투로 이동시, 캐릭터 선택화면이 나오는 동안 턴이 돌아서
   *     선택화면 뒤쪽에서 배치된 적 캐릭터들이 먼저 행동을 하는 문제」 · 실측 2-4 → 2-3: 배치중인데 ROUND_END → FRAME_IDLE·배너)
   *   ★ 배치 화면이 떠 있는 동안에도 시간을 안 흘린다 — 원본은 배치(0x5604F 0x55518)가 끝나야 메인 루프(0x5607D 0x5580F)로 간다 */
  var 리셋 = this._리셋세대 | 0;
  function 버려짐() { return (self._리셋세대 | 0) !== 리셋 || !!(self.battle && self.battle.배치중); }
  function 버림() {
    /* 새 전투가 아직 배치 화면이면 처음 들어온 전투와 같은 BOOTSTRAP 으로 둔다 (다른 고리가 돌고 있으면 건드리지 않는다) */
    if ((self._진행고리 | 0) <= 1 && self.battle && self.battle.배치중 && self.mode !== MODE.BOOTSTRAP) self._상태전이(MODE.BOOTSTRAP, '옛 전투 진행 고리 멈춤 — 배치 화면');
    return null;
  }

  function step() {
    if (버려짐()) return Promise.resolve(버림());
    /* ★ 결말이 났으면 더 돌지 않는다 — 셸이 `pendingOutcome` 을 비워도 마찬가지다 */
    if (self.pendingOutcome || self.전투끝남) { self._상태전이(MODE.BATTLE_OUTCOME); return Promise.resolve(null); }
    if (guard-- <= 0) { self.msg('라운드 루프 보호 — 4096 바퀴'); return Promise.resolve(null); }

    self._상태전이(MODE.ROUND_ADVANCE);
    /* ★ `deferClose` — 라운드 마무리(0x19EB7~0x19F56)를 **AI 를 다 돌린 뒤로** 미룹니다.
     *   원본은 순회 안(0x19E6F)에서 AI 를 그 자리에서 부르므로, 정기 정지가
     *   대기열을 세는 0x19F06 시점엔 AI 의 공격 결과까지 반영돼 있습니다.
     *   우리 AI 는 연출 때문에 아래 rest() 에서 나중에 도니, 여기서 마무리까지
     *   해버리면 **AI 가 죽이기 전의 대기열**을 보고 Player Phase 로 들어갑니다.
     *   그러면 멈춘 자리에 조작할 아군이 하나도 없어 시간이 안 흐릅니다. */
    /* ★★★★★ **사망 유예** — 통합 2-c 2단계 (2026-08-22 · GPT 14차)
     *   원본 `0x17310` 은 **S4 를 먼저**(`0x173EB`) 부르고 그 다음
     *   사망 처리(`0x1745B call 0x1DB1D`)한다. 우리 S4 는 **비동기**(연출)라
     *   `turn.js` 가 바로 죽이면 순서가 뒤집힌다.
     *   ⇒ 창구가 있을 때만 유예를 켜고, S4 가 끝난 뒤 `사망마무리()` 한다.
     *     ★ 창구가 없으면 **예전 그대로** 즉시 죽는다(호환). */
    var r = Turn().advance(self.battle, { rng: self.svc.rng, deferClose: true,
                                          사망유예: !!self.svc.HP변경알림,
                                          /* ★ 라운드 끝 전체 진영 후처리 (`0x19D3A → 0x1ED90`) */
                                          라운드끝후처리: !!self.svc.HP변경알림 });

    /* 페이즈가 0 이 아니면 턴 관리자가 통째로 막힙니다 (0x19D69) */
    if (r.blocked) return Promise.resolve(r);

    /* ★★★★★ **독·지형 HP 변경을 창구에 넘긴다** — 통합 2-c 2단계 (2026-08-22)
     *
     *   원본은 지형 피해를 깎은 **바로 그 자리**에서 S4 를 검사한다:
     *     0x173E6  mov [ecx+0x48], edx   ; 감산 결과 저장
     *     0x173E9  xor edx, edx          ; ★ **주체 없음**
     *     0x173EB  call 0x53797 (eax=그 유닛, ebx=1)
     *
     *   ★★★ **유닛마다 각각** 부르고 **각각 기다린다** (GPT 13차 지정):
     *     「한 턴의 지형 피해를 한 번으로 묶으면 선택자 포인터 동일성 ·
     *      한건만 정책 · 발동표 기록 시점 · 첫 이벤트가 상태를 바꾼 뒤
     *      다음 유닛을 검사하는 순서가 전부 달라진다」
     *   ★★★ **`Promise.all` 로 병렬 실행하면 안 된다** — 직렬 체인이어야 한다.
     *
     *   ★ 독은 원본 대응이 **미확인**이라 `원본경계: null` → 창구가 `스캔:false`.
     *   ★ `r.hurt` 는 전에 **아무도 안 쓰고 버려지던** 것이다.
     *
     *   ★ **사망은 유예된다** — `opts.사망유예` 로 `turn.js` 가 예정만 남기고,
     *     여기서 **S4 가 끝난 뒤** `사망마무리()` 한다 (원본 `0x1745B`).
     *
     *   ★ [알려진 한계] 유닛 **사이**의 순서는 아직 원본과 다르다 —
     *     원본은 `A 지형 → A S4 → A 사망 → B 지형 → …` 인데
     *     우리는 `모든 유닛 지형 → A S4 → B S4 → …` 다.
     *     ★ 출하 자료에서는 차이가 없다 (`SCE_HP변경_창구.md` §3-f 전수 근거):
     *       S4 140건 중 조건 활성 **2건**뿐이고 둘 다 「영역 인원」인데,
     *       영역 인원(`0x533FC`)은 **맵 칸의 소속만** 세고 HP 를 안 본다. */
    /* ★ 도트(화상·감전·중독) 연출을 먼저 — 원본은 진영을 다 돈 뒤 25걸음 숫자·밀림(0x19C82~0x19D29)을 하고 나서 사망(0x19D3A 0x1ED90)을 처리한다.
     *   HP 보고·사망 마무리를 모두 이 뒤에 잇는다 (2026-09-26 Z-67 · battle_main svc.도트연출) */
    var 도트목록 = (r && r.hurt) ? r.hurt.filter(function (h) { return h && (h.dot | 0) > 0; }) : [];
    var hp보고체인 = Promise.resolve(도트목록.length && self.svc.도트연출 ? self.svc.도트연출(도트목록) : null)
      .catch(function (e도트) { try { console.warn('[도트연출] ' + (e도트 && e도트.message)); } catch (x) {} });
    if (self.svc.HP변경알림 && r && r.hurt && r.hurt.length) {
      var 사망예정 = (r.round && r.round.사망예정) || [];
      /** ★ 그 유닛의 **마지막 보고** 뒤에 사망을 마무리한다 (`0x1745B`).
       *   성공·거부 양쪽에서 같은 함수를 쓴다 — 거부면 정리 뒤 **다시 던진다.** */
      function 사망정리(h) { return HP보고뒤사망정리(self, r, 사망예정, h); }
      /* ★★★★★ **반환 Promise 를 체인에 연결한다** — GPT 23차 검수
       *   전에는 `사망정리(h)` 가 `보2.대기` 를 돌려줘도 **버렸다.**
       *     · `0x1DB50` S4 가 끝나기 전에 다음 유닛이 시작될 수 있었다
       *     · 대기 거부가 상위로 **전달되지 않았다**
       *     · 처리되지 않은 거부(unhandled rejection)가 될 수 있었다 */
      function 사망성공(h) { return function () { return 사망정리(h); }; }
      function 사망거부(h) {
        return function (e) {
          /* ★ 사망 정리를 **기다린 뒤** 원래 오류를 다시 던진다 */
          return Promise.resolve(사망정리(h)).then(
            function () { throw e; },
            function () { throw e; }
          );
        };
      }
      r.hurt.forEach(function (h) {
        if (!h || h.이전HP == null) return;          /* 저주 등 HP 무관 항목 */
        hp보고체인 = hp보고체인.then(function () {
          var 보 = self.svc.HP변경알림({
            변경유닛: h.unit, 주체유닛: (h.주체유닛 !== undefined) ? h.주체유닛 : null,
            이전HP: h.이전HP, 이후HP: h.이후HP,
            까닭: h.까닭 || '기타', 원본경계: h.원본경계 || null
          });
          return (보 && 보.대기) || null;            /* ★ 다음 유닛 전에 기다린다 */
        }).then(사망성공(h), 사망거부(h));
        /* ★★★★★ **성공·거부 양쪽**에서 사망을 마무리한다 (GPT 15차 검수)
         *   전에는 `.then(성공)` 하나뿐이라 **`보.대기` 가 거부되면**
         *   사망 정리가 통째로 건너뛰어졌다 → `HP<=0` 인데 `alive=true` 이고
         *   맵에도 남는 **반쯤 죽은 유닛**이 생겼다.
         *   ★ 취소 시에도 사망 **연출**을 하라는 뜻이 아니다 —
         *     **내부 상태 불변식**만 지킨다. */
      });
      /* ★ 보고가 없는 사망(있을 수 없지만 안전망)도 반드시 마무리한다.
       *   ★★★ **성공·거부 양쪽**에 건다 (GPT 15차) — 거부면 정리 뒤 **다시 던진다.** */
      /* ★★★★★ **삼키지 않고 직렬로 기다린 뒤 첫 오류를 던진다** — GPT 23차
       *   전에는 동기 예외를 빈 `catch` 로 삼키고 `보.대기` 도 안 기다렸다.
       *   GPT: 「그 시점에는 `Turn().사망마무리()` 가 이미 끝났으므로
       *   『던지면 유닛이 반쯤 남는다』는 근거가 성립하지 않는다」
       *   ⇒ **내부 상태는 끝까지 정리**하고, **오류는 모아** 마지막에 던진다. */
      function 남은사망정리() { return 남은사망직렬정리(self, r, 사망예정); }
      hp보고체인 = hp보고체인.then(
        function () { return 남은사망정리(); },
        function (e) {
          /* ★ 정리를 **기다린 뒤** 원래 오류를 다시 던진다 (GPT 23차) */
          return Promise.resolve(남은사망정리()).then(
            function () { throw e; }, function () { throw e; });
        }
      );
    } else {
      hp보고체인 = hp보고체인.then(function () { 보고없는사망마무리(self, r); });   /* 도트 연출 뒤 */
    }

    /* ★ SCE 턴 이벤트 — 원본 라운드 루프 0x19D53 안에서
     *     0x19DF3  mov eax, [0xF0418]      ; 턴 카운터
     *     0x19DF8  call 0x53523            ; 카테고리 0 스캐너
     *   를 **AI 가 움직이기(0x19E6F → 0x44913) 전에** 부릅니다.
     *   그래서 이벤트가 정해 둔 자리를 AI 가 덮어쓰지 않습니다.
     *   훅이 약속을 돌려주면 그 연출이 끝날 때까지 라운드를 세웁니다. */
    /* ★★★★★ **라운드 끝 전체 진영 후처리** — `0x19D3A → 0x1ED90` (GPT 21차)
     *
     *   원본은 유닛별 지형 S4(`0x173EB`)를 다 돌린 **뒤**, `0x19AEF` 끝에서
     *   진영 0~3 을 전부 훑어 생존자마다 `0x1EE0B call 0x53797` **S4** 를 부른다.
     *   ★★★ **중복이 아니다** — 원본 호출 경계가 **둘**이다 (GPT 21차).
     *   ★ 직렬이어야 한다 — `Promise.all` 금지. */
    /* ★★★★★ **처리하는 순간 다시 판정한다** — GPT 22차 검수
           *
           *   전에는 `turn.js` 가 계획을 만들 때의 `x.생존` **스냅샷**을 봤다.
           *   앞 유닛의 S4 명령이 뒤 유닛의 HP·퇴장·상태를 바꾸면
           *   원본과 달라진다:
           *     원본  — 뒤 유닛에 도달했을 때 **현재 HP 를 다시 읽는다**
           *     스냅샷 — 계획 생성 당시 값을 쓴다
           *   ★ 지금은 shadow 라 안 드러나지만 `SceRuntime` 을 실제로 연결하면
           *     곧바로 오류가 된다 (GPT: 「곧 실제 오류가 된다」).
           *
           *   ★ `x.생존` 은 **진단용 스냅샷**으로만 남긴다. */
    hp보고체인 = 라운드끝HP보고체인(self, r, hp보고체인);

    /* ★ 독·지형 S4 가 다 끝난 **뒤** 턴 이벤트(S0)로 간다 —
     *   원본도 유닛 틱이 라운드 스캐너보다 앞이다. */
    return hp보고체인.then(function () {
      if (버려짐()) return 버림();
      var ev = self.svc.onRound ? self.svc.onRound(self.battle.turn | 0, r) : null;
      /* [리마스터] 라운드 이벤트 안의 공격·마법이 준 부분·보조 경험치 — 이벤트가 끝나면 바로 넣는다 (2026-10-10) */
      if (ev && typeof ev.then === 'function') return ev.then(function () { return self._리마스터경험창(); }).then(function () { return rest(r); });
      return Promise.resolve(self._리마스터경험창()).then(function () { return rest(r); });
    });
  }

  /** 한 라운드의 나머지 — AI 행동과 마무리. 이벤트 연출 뒤에 이어집니다. */
  function rest(r) {
    if (버려짐()) return 버림();
    self._상태전이(MODE.UNIT_SCAN);
    var chain = Promise.resolve();
    /* ★★★★★ **유닛 하나가 끝날 때마다 페이즈를 본다** — `0x19E88` (2026-08-26)
     *
     *   사용자: 「고블린 10마리가 턴을 진행할 차례이고 현재 첫번째 고블린이 움직이고
     *   있고 이때 스페이스키를 누르면, **바로 웨이팅 문구가 떠야** 해. 첫번째 고블린
     *   행동을 마치면(**9마리의 고블린은 미행동 상태**) **ai 페이즈로 넘어가는** 거야.
     *   이상태에서 다시 스페이스를 누르면 남은 9마리 고블린이 순서대로 행동하는거고.」
     *
     *   ```asm
     *   0x19E19 ┌ 진영 0 → 3 순회
     *   0x19E6F │  AI 한 기 실행
     *   0x19E88 │  cmp [0x8042E], 2        ; ★ **유닛 하나 끝날 때마다**
     *   0x19E8E │  → 3 으로 올리고 ret = 2 ; ★ **그 자리에서 중단**
     *   0x19EB1 └  [0xF0422] 는 그대로 → 다음 호출이 **이어서** 돈다
     *   ```
     *
     *   ★ `turn.js advance()` 는 이미 이 검사를 갖고 있다(972행). 그런데 우리는
     *     연출 때문에 **AI 목록을 미리 뽑아 두고**(`deferClose`) 컨트롤러가 돌린다.
     *     그 루프가 페이즈를 **한 번도 안 봐서** 스페이스를 눌러도 **10마리가 다
     *     움직인 뒤에야** AI 페이즈로 넘어갔다.
     *   ⇒ 여기서도 **유닛마다** 본다. 멈추면 **남은 유닛은 미행동으로 남고**,
     *     다음 `advance()` 가 `_inRound` 덕에 이어서 돈다.
     */
    var 남은AI = [];
    r.ai.forEach(function (a, i) {
      chain = chain.then(function () {
        if (버려짐()) return null;
        /* ★ 이미 멈췄으면 나머지는 손대지 않는다 — 미행동으로 남긴다 */
        if (r.ai멈춤) { 남은AI.push(a); return null; }
        if (!a.unit.alive || self.pendingOutcome || self.전투끝남) return null;   // 먼저 행동한 AI 에게 죽었으면
        /* ★★★★★ **이벤트가 도는 동안에는 AI 를 시작하지 않는다** (2026-08-26 · 사용자 지적)
         *
         *   사용자: 「**이벤트 대사 진행중에 ai 행동이 멈춰야하는데 계속 공격이 지속돼.**」
         *
         *   원본은 **순차**다 — 라운드마다 `0x19DF8` 이 S0 이벤트를 돌리고, 그것이
         *   끝난 뒤에 AI 순회(`0x19E88`)가 온다. 한 흐름이라 겹칠 수가 없다.
         *
         *   우리는 SCE 를 **비동기 사슬**로 따로 돌린다(`_SCE소비중` · `_SCE세션` — 2-6 에서 `G2Events` 는 없어졌다).
         *   이 루프가 그 사슬을 **한 번도 안 봐서**, 대사창이 떠 있는 동안에도
         *   다음 AI 가 계속 행동했다.
         *
         *   ⇒ 스텝 **앞에서** 이벤트가 끝나기를 기다린다. 그것이 원본 순서다.
         *   ★ 무한정 기다리지 않는다 — 이벤트가 걸려도 전투가 멈추면 안 되므로
         *     상한을 둔다(`이벤트대기상한`).
         */
        return self._이벤트끝날때까지().then(function () {
          if (버려짐()) return null;
          if (r.ai멈춤) { 남은AI.push(a); return null; }   /* 기다리는 사이 멈췄을 수 있다 */
          if (!a.unit.alive || self.pendingOutcome || self.전투끝남) return null;
          /* [리마스터] 앞 행동 뒤에 끝난 이벤트의 경험치가 남았으면 이 유닛이 움직이기 «전»에 넣는다 (2026-10-10) */
          return Promise.resolve(self._리마스터경험창()).then(function () { return self.runAi(a.unit); });
        }).then(function (out) {
          /* 0x19E88 — 이 유닛이 끝난 **직후** 페이즈를 본다 */
          if (Turn().phaseCode && Turn().phaseCode(self.battle) === 2) {   /* 2 = Waiting */
            Turn().setPhase(self.battle, 3);                               /* 0x19E8E → AI Phase */
            r.ai멈춤 = true;
          }
          return out;
        });
      });
    });
    return chain.then(function () {
      /* ★★★★★ **한 바퀴마다 프레임을 양보한다** (2026-08-27 · 사용자 피드백 ⑦)
       *
       *   원본 메인 루프 `0x5580F` 는 `0x19D53`(라운드 하나)을 **프레임마다 한 번**
       *   부르고 그 사이에 화면을 그린다. 스핀하지 않는다.
       *
       *   ☠ 우리는 `return step()` 이 `.then()` 안이라 **전부 마이크로태스크**로
       *     이어졌다. 마이크로태스크는 다음 rAF 앞에 몰아서 돌므로,
       *     4096바퀴가 **한 덩어리 동기 작업**이 된다.
       *     실측(1-5, 고치기 전): `longtask` **9574 ms** · rAF 간격 **9626 ms** ·
       *     콘솔 「턴 4097 · 행동 가능 0명」.
       *
       *   ⇒ 한 바퀴가 끝날 때마다 **한 프레임 쉬어 준다.** 화면이 안 얼어붙고,
       *     원본의 「프레임마다 한 라운드」와도 같아진다.
       *   ★ 대부분의 경우 몇 바퀴면 멈추므로 체감 지연은 없다.
       *     정말로 오래 도는 상황이라면 그 자체가 드러나야 할 문제다. */
      /* ★★★★★ **이벤트가 도는 동안에는 라운드를 안 돌린다** (2026-08-27 · 피드백 ⑫)
       *
       *   원본에서 `.SCE` 이벤트는 `0x53F94`/`0x53797` 같은 **동기 호출**이다.
       *   사망 처리(`0x1DB1D`) 안에서 §11 이 불리면 그것이 끝나야 `0x1DB1D` 가
       *   반환되고, 그제서야 메인 루프가 다음 `0x19D53` 을 돈다.
       *
       *   ☠ 프레임을 양보하고 나니 **§11 대사가 도는 7초 동안 라운드가 계속 돌았다**
       *     (실측: 턴 16 → 33). 우리 SCE 는 비동기 사슬이라 그냥 두면 겹친다. */
      if (버려짐()) return 버림();
      return AI라운드마무리(self, r, 남은AI, step);
    });
  }

  /* ★ 진행 고리가 도는 중인지 센다 — 스페이스 재개(spaceResume)가 고리를 겹쳐 세우지 않게 (2026-10-05) */
  self._진행고리 = (self._진행고리 | 0) + 1;
  function 고리끝() { if ((self._리셋세대 | 0) !== 리셋) return; self._진행고리 = Math.max(0, (self._진행고리 | 0) - 1); }   /* 리셋 뒤 옛 고리는 새 고리 수를 안 깎는다 */
  return step().then(function (r) { if (버려짐()) { 버림(); 고리끝(); return null; } 고리끝(); return self._대기상태(r); },
                     function (e) { 고리끝(); throw e; });
};

/**
 * 시간이 멈춘 자리 = `FRAME_IDLE`.
 * 원본은 여기서 아무 유닛도 「잡지」 않습니다 — 플레이어가 맵에서 고릅니다.
 * `actor` 는 카메라·HUD 가 가리키는 **초점**일 뿐이고, 조작 자격과는 무관합니다
 * (0x19F12 는 대기열 마지막 유닛으로 카메라를 옮깁니다).
 */
Controller.prototype._대기상태 = function (r) {
  if (this.pendingOutcome || this.전투끝남) { this._상태전이(MODE.BATTLE_OUTCOME); return this.pendingOutcome || '끝남'; }
  var q = this.readyUnits();

  /* ★ 조작할 아군이 하나도 없으면 멈춰 있을 이유가 없습니다.
   *
   *   제자리는 `0x4DB58` — 유닛 행동이 끝난 직후(endSession)에서 이미 겁니다.
   *   정상 흐름이면 `0x19F06`(closeRound)이 AI 행동 뒤의 대기열을 세므로
   *   대기열이 빈 채로 Player Phase 에 들어가는 일 자체가 없습니다.
   *   여기는 이벤트가 유닛을 없애는 등 **다른 경로로 비었을 때의 안전장치**입니다. */
  if (!q.length && !this.pendingOutcome && !this.전투끝남 && (this._autoResume | 0) < 8) {
    var freed = Turn().releaseIfQueueEmpty(this.battle);   // 0x4DB58
    /* ☠☠☠ **자동 해제를 껐다** — 원본에 없다 (2026-08-27 · 사용자 지적 ⑥)
     *
     *   > 「이벤트 진행도중 **waiting 문구와 ai모드 진입 관련 로직도 점검**해야해.
     *   >  원작에서는 **웨이팅 문구는 뜨지만 실제 이벤트 진행중 ai페이즈가 발동하지는
     *   >  않고 시나리오가 종료돼.** 우리는 **웨이팅 문구 발동이 되지 않아.**」
     *
     *   전에는 여기서 `Turn().resume()` 을 불러 페이즈 2·3 도 풀었다.
     *   실측(1-5) — 이벤트 중 스페이스를 누르면
     *   ```
     *    2130ms  waiting/배너켜짐          ← 여기까지는 맞다
     *   11168ms  run/배너꺼짐  mode=ROUND_END   ← ★ 스스로 풀어 버린다
     *   11200ms  AI_MOVE … AI_ACTION            ← 그리고 AI 가 계속 행동한다
     *   ```
     *
     *   원본은 `[0x8042E]` 가 0 이 아니면 턴관리자 `0x19D53` 이 `0x19D70 jne` 로
     *   **즉시 반환**한다. 그 값을 0 으로 되돌리는 곳은 원본 전체에서 **둘뿐**이다:
     *     `0x55B19`  스페이스바를 다시 누름
     *     `0x4DB6C`  **Player Phase(1)** 인데 대기열이 비었을 때 (= `releaseIfQueueEmpty`)
     *   곧 **2(Waiting)·3(AI Phase)에는 자동 해제가 없다.** 플레이어가 개입을
     *   요청한 상태이므로 플레이어가 풀 때까지 기다리는 것이 원본이다.
     *
     *   ★ 위 `releaseIfQueueEmpty` 는 페이즈 1 에서만 참이고, 그 경우 `q.length`
     *     가 0 이면 반드시 푼다. 즉 여기 남아 있던 `resume` 은 **페이즈 2·3
     *     전용 경로**였다 — 통째로 원본에 없는 코드였다. */
    if (freed) {
      this._autoResume = (this._autoResume | 0) + 1;
      return this.settle();
    }
  }
  this._autoResume = 0;

  var focus = (r && r.focus && r.focus.alive) ? r.focus : q[q.length - 1] || null;
  this.actor = focus;
  if (focus) {
    this.cursorTile = { x: focus.x, y: focus.y };
    if (this.svc.view && this.svc.view.center) this.svc.view.center(focus.x, focus.y);
  }
  /* 0x19F12의 focus는 카메라 기준일 뿐 선택 상태가 아니다. FRAME_IDLE에서는
   * 언제나 시계/날짜 뒷면을 보이고, 실제 클릭으로 세션에 들어갈 때만 TP 구체가 된다. */
  if (this.svc.hud && this.svc.hud.selectUnit) this.svc.hud.selectUnit(null);
  this._상태전이(MODE.FRAME_IDLE, focus ? focus.name : '대기열 없음');
  return r || null;
};

/**
 * 예전 이름 — 「다음 차례 유닛을 잡는다」는 개념 자체가 원본에 없어서
 * `settle()` 로 접었습니다. `endActor()` 같은 편의 경로가 아직 부릅니다.
 */
Controller.prototype.nextActor = function () { return this.settle(); };

/**
 * 스페이스바 — 메인 루프 이벤트 코드 0x20 → `0x55B19`.
 * 페이즈를 0 으로 풀고 다시 시간을 흘립니다. **대기열은 그대로 둡니다** —
 * 그래서 다음에 멈췄을 때 이전에 조작 안 한 아군과 새로 온 아군이 함께 서 있습니다.
 */
Controller.prototype.spaceResume = function () {
  if (this.session && !this.session.ended) return Promise.resolve({ ignored: '세션 중' });
  /* ★★★★★ **재개는 깃발만 푼다 — 고리가 이미 돌고 있으면 새로 세우지 않는다** (2026-10-05)
   *   원본 0x55B19(키 이벤트 0x20)는 [0xF042E] = 0 하나뿐이다. 메인 루프(0x5580F)는 하나다.
   *   ☠ 이벤트 대사 중 스페이스 두 번(멈춤 → 재개)이면 대사를 기다리던 진행 고리 위에 settle() 이 하나 더 서
   *     라운드·이벤트·AI 가 두 벌로 돌았다 (사장님 「가끔 이벤트 대사 진행도중 무한루프가 돌 때가 있어 … 스페이스로 멈추거나 이럴때 발생하는 것 같아」)
   *   ⇒ 도는 고리가 있으면 깃발만 풀고, 그 고리가 다음 바퀴에서 이어 간다. 멈춰 선 뒤(고리 없음)에만 새로 세운다. */
  if (Turn().resume(this.battle)) {
    if ((this._진행고리 | 0) > 0) return Promise.resolve({ ok: true, resumed: true, 고리: '이어감' });
    return this.settle();
  }
  /* ★★★★★ **진행 중이면 반대로 멈춘다** — 0x19F5D (2026-08-25 · 사용자 지적)
   *   사용자: 「스페이스키로 ai 모드 진입 및 문구 표시 안되는 문제」
   *   원본 스페이스는 두 자리에서 처리된다:
   *     0x55B19  누름        — 페이즈 != 0 이면 0 으로 (시간 재개)
   *     0x19F5D  누르고 있음 — 페이즈 == 0 이면 2(Waiting) 로   ← 타이머 ISR
   *   그리고 0x19D62 가 다음 advance() 에서 2 → 3(AI Phase) 로 올린다.
   *   배너는 0x45477(2) · 0x45494(3) 이 그린다.
   *   ★ 우리는 resume 만 이어 두고 pause 는 테스트에서만 불렀다 —
   *     그래서 스페이스로 Waiting·AI Phase 에 영영 못 들어갔다.
   *   ★ ISR 대신 키 이벤트로 받으므로 「누르면 멈추고 다시 누르면 진행」이 된다
   *     (원본도 한 틱만 눌려도 ISR 이 잡으므로 결과가 같다). */
  if (!Turn().pause(this.battle)) return Promise.resolve({ ignored: '멈출 수 없음' });
  /* ★★★★★ **멈출 때는 `settle()` 을 부르지 않는다** — `0x19F9C` (2026-08-26 · 화면 실측)
   *
   *   사용자: 「첫번째 고블린이 움직이고 있고 이때 스페이스키를 누르면, **바로 웨이팅
   *   문구가 떠야해.** 첫번째 고블린 행동을 마치면(9마리의 고블린은 미행동 상태)
   *   **ai 페이즈로 넘어가는거야.**」
   *
   *   원본 타이머 ISR 을 `ret` 까지 읽으면 —
   *   ```asm
   *   0x19F5E  call 0x10392         ; 쿨다운 확인
   *   0x19F68  cmp [0x8042E], 0     ; 페이즈가 0(평상)이어야
   *   0x19F71  eax=0x39 ; call 0x5D827   ; 스캔코드 0x39 = 스페이스가 눌려 있나
   *   0x19F86  mov [0x8042E], 2     ; ★ Waiting
   *   0x19F8C  call 0x1038B         ;   쿨다운 50틱
   *   0x19F96  eax=1 ; call 0x44DEC ;   배너 켜기 ([0x5008] = 1)
   *   0x19F9C  ret                  ; ★★★ **advance 를 부르지 않는다**
   *   ```
   *   3(AI Phase)으로 올리는 것은 **나중에 도는** `advance`(`0x19D62`)다.
   *   그 사이에 진행 중이던 유닛이 하던 행동을 마친다 — 사용자가 말한 그 순서다.
   *
   *   ★ 우리는 `pause()` 직후 `settle()` 을 불러 **같은 호출 안에서 3까지** 올렸다.
   *     30 ms 로 촘촘히 찍어도 `ph2/waiting` 이 한 번도 안 잡혔다 —
   *     **Waiting 문구가 화면에 뜰 틈이 없었다.**
   *   ⇒ 여기서는 페이즈만 2 로 바꾸고 돌아간다. 프레임 루프가 다음 `advance()` 를
   *     돌릴 때 `turn.js:945` 가 2 → 3 으로 올린다. */
  return Promise.resolve({ ok: true, paused: true, phase: this.battle.phase });
};

/**
 * 우클릭 — `0x55AC7`. Player Phase 일 때 대기열을 한 칸씩 돌며 세션을 엽니다.
 * (0x55AD6 `movsx eax, cx` → 0x1979F, 널이면 0 번으로 되돌아갑니다)
 */
Controller.prototype.cycleReady = function () {
  var q = this.readyUnits();
  if (!q.length) return { ok: false, reason: '행동 가능한 아군이 없습니다' };
  var i = (this._cycle | 0);
  if (i >= q.length) i = 0;                       // 0x55AE3  널 → 인덱스 0
  this._cycle = i + 1;
  var u = q[i];
  this.cursorTile = { x: u.x, y: u.y };
  if (this.svc.view && this.svc.view.center) this.svc.view.center(u.x, u.y);
  return this.enterSession(u);
};

/* ══════════════════════════════════════════ 2. 입력 라우터 (§26) */

/**
 * 모든 입력이 여기로 들어옵니다. **지금 상태에만** 흘립니다.
 * @param {object} ev
 *   { type:'click'|'rightClick'|'hover'|'key'|'ringIcon'|'ringCenter'|'ringCancel',
 *     x, y,               타일 좌표 (click·hover)
 *     px, py,             방향 선택용 화면 오프셋 (마우스 − 목적지 중심)
 *     icon,               ringIcon
 *     key }
 * @returns {Promise}
 */
Controller.prototype.input = function (ev) {
  if (this.전투끝남) return null;   /* ★ 2026-10-12 결말(승리·패배·다음 시나리오)이 났으면 입력을 받지 않는다 — 셸이 pendingOutcome 을 비운 뒤 링이 다시 떴다 (사장님 「실패했을때, 게임 진행이 멈춰야하는데 … 링커맨드가 뜨거나」) */
  ev = ev || {};
  /* ★★★★★ **스페이스는 연출 잠금을 뚫는다** — 원본은 타이머 ISR 이다 (2026-08-26)
   *
   *   사용자: 「ai 페이즈랑 웨이팅도 전혀 구현안됐다고! **적 턴 중간에 끊고
   *   조작할수 있는 스페이스바로 진입하는 기능** 구현을 하라고 한건데」
   *
   *   `call 0x19F5D` 호출부는 **`0x1029F` 한 곳뿐**이고 그 자리는 타이머 인터럽트
   *   핸들러 안이다(`0x102A5 callf [0x8998]` → `0x102B4 iret`).
   *   조건은 셋뿐이다 —
   *     0x19F5E  call 0x10392        ; [0x89A4] == 0  (쿨다운 없음)
   *     0x19F68  cmp [0x8042E], 0    ; 평상 상태인가
   *     0x19F76  call 0x5D827(0x39)  ; 스페이스가 눌려 있나
   *   **연출 중인지·세션 중인지·무슨 모드인지 보지 않는다.**
   *
   *   ★ 2026-08-25 에 `key()` 안의 모드 제한만 걷어내고 **여기 `locked()` 는
   *     그대로 뒀다.** AI 턴은 이동·공격 연출이 계속 도니 `locked()` 가 참이라,
   *     스페이스가 `key()` 에 **닿지도 못했다.** 절반만 고친 셈이다.
   *   ★ 다른 입력은 그대로 막는다 — 불변식 8 은 유지된다. */
  if (this.locked()) {
    var _스페이스 = (ev.type === 'key' && ev.key === ' ');
    if (!_스페이스) return Promise.resolve({ ignored: '연출 중' });   // 불변식 8
  }

  switch (ev.type) {
    case 'hover': return Promise.resolve(this.hover(ev.x, ev.y, ev));
    case 'click': return this.click(ev.x, ev.y, ev);
    case 'rightClick':
      /* AI 목표 지정에서 오른쪽 누름(코드 3)은 ESC 와 같은 «취소»다 (0x4CFFB) — cancel 갈래가 AI 링으로 돌린다 */
      return this.cancel();
    case 'ringIcon': return this.ringIcon(ev.icon);
    case 'ringCenter': return this.ringCenter();
    case 'ringCancel': return this.cancel();
    case 'key': return this.key(ev.key, ev);
    default: return Promise.resolve({ ignored: ev.type });
  }
};

/** 키는 **한 곳에서만** 받습니다 (명세서 §6.1). */
Controller.prototype.key = function (k, ev) {
  if (this.전투끝남) return null;   /* ★ 2026-10-12 결말(승리·패배·다음 시나리오)이 났으면 입력을 받지 않는다 — 셸이 pendingOutcome 을 비운 뒤 링이 다시 떴다 (사장님 「실패했을때, 게임 진행이 멈춰야하는데 … 링커맨드가 뜨거나」) */
  if (k === 'Escape') return this.cancel();
  /* ★ 스페이스바는 「커서 칸 클릭」이 아닙니다 — 시간을 다시 흘립니다 (0x55B19).
   * v5 §6.1 의 「연출 속도 토글」은 오독이었습니다. 0x20 이벤트가 하는 일은
   * [0xF042E] = 0 하나뿐입니다. */
  if (k === ' ') {
    /* ★★★★★ **모드를 가리지 않는다** — 원본은 타이머 ISR 이다 (2026-08-25 · 사용자 지적)
     *
     *   사용자: 「**적군 행동 도중** 스페이스키를 누르면 누른시점에 이미 행동중이던
     *   캐릭터는 **하던 행동을 마칠때까지** 움직이고 이때 player phase 자리에
     *   **waiting** 이 표시돼. 해당 캐릭터가 행동이 끝나면 **ai phase** 로 표시가
     *   바뀌고 이때 맵이나 유닛을 살펴볼 수 있어.」
     *
     *   전에는 `MODE.FRAME_IDLE` 일 때만 받았다 — **AI 가 행동 중이면 다른 모드**라
     *   통째로 무시됐다. 그래서 AI 페이즈에 영영 못 들어갔다.
     *
     *   원본은 두 자리에서 받고 **둘 다 모드와 무관**하다:
     *     0x19F5D  타이머 ISR (0x101F4 → 0x1029F) — `[0xF042E]==0` 이면 **2(Waiting)**
     *     0x55B19  메인 루프 키 이벤트 0x20     — `[0xF042E]!=0` 이면 **0(재개)**
     *   곧 조건은 **페이즈뿐**이다. `Turn().pause/resume` 이 그 조건을 이미 들고 있으니
     *   모드 제한만 걷어내면 원본과 같아진다.
     *
     *   ★ 행동 중이던 캐릭터가 하던 것을 마치는 것도 저절로 된다 — `pause()` 는
     *     페이즈를 2 로 **표시만** 바꾸고, 3(AI Phase)으로 올리는 것은 다음
     *     `advance()`(0x19D62)다. 그 사이 진행 중인 연출·이동은 그대로 끝난다.
     *   ★ 세션(링 조작) 중에는 `spaceResume()` 이 걸러 낸다. 원본도 그때는
     *     페이즈가 1(Player Phase)이라 ISR 조건 `==0` 에 안 걸린다 — 같은 결과다. */
    return this.spaceResume();
  }
  /* 2026-10-28 Tab·S(상태 보기)·N(차례 강제 끝내기) 뺌 — 원본에 없는 키 · 사장님 「빼도 돼. 저게 왜들어간거야;; 난 요구한적이 없는데」
   *   Enter(커서 칸 클릭)도 뺌 — 사장님 「3. 빼」 */
  return Promise.resolve({ ignored: k });
};

/** 마우스 이동 — 상태를 바꾸지 않습니다. */
Controller.prototype.hover = function (x, y, ev) {
  /* AI 목표 지정 — 마우스 움직임(코드 1 · 0x4CF2E)마다 커서·상자가 따라온다 */
  if (this.mode === MODE.AI_COORD_SELECT && x != null) { this.cursorTile = { x: x, y: y }; return this.pickAiCoord(x, y); }
  if (this.mode === MODE.FACING_SELECT) {
    if (ev && ev.px != null) {
      var d = this.movement.facingFromMouse(ev.px, ev.py);
      if (this.moveDraft) {
        this.moveDraft.facing = d;
        /* 방향 화살표는 고정 위치가 아니다. 원작 0x163EB~0x164A8처럼
         * 목적지 중심에서의 마우스 오프셋을 보존해 선택된 변을 따라가게 한다. */
        this.moveDraft.pointer = { x: ev.px, y: ev.py };
      }
      return { facing: d };
    }
    return { facing: this.moveDraft && this.moveDraft.facing };
  }
  /* ★★★ ② 효과 범위 확인 중에는 **커서가 그 자리에 고정**된다 — 원본 `0x4A815`
   *   키 대기 동안 칸이 `[0x8A8B0]/[0x8A8B2]` 에 묶여 있다.
   *   사용자: 「효과 범위가 표시된 상태에서는 **마우스가 그 자리에 고정**돼」
   *
   *   ★ `cursorTile` 갱신을 **이 판정 뒤로** 미뤄야 한다. 앞에 두면 커서 칸이
   *     마우스를 따라 움직여, 셀렉터만 고정되고 **화면 커서는 그대로 돌아다녔다**
   *     (사용자 2026-08-16: 「마우스 커서가 그 자리에 고정되고 움직이면 안되는데
   *     해당기능 구현 안됨」). */
  var 잠김 = (this.mode === MODE.TARGET_SELECT &&
              this.rangeContext && this.rangeContext.효과확인 && this.rangeContext.잠금);
  if (잠김) {
    this.cursorTile = { x: 잠김.x, y: 잠김.y };
    return this.selector.hover(잠김.x, 잠김.y);
  }
  if (x != null) this.cursorTile = { x: x, y: y };
  if (this.mode === MODE.TARGET_SELECT) return this.selector.hover(x, y);
  return { cursor: this.cursorTile };
};

/* ══════════════════════════════════════════ 3. 좌클릭 */

Controller.prototype.click = function (x, y, ev) {
  if (this.전투끝남) return null;   /* ★ 2026-10-12 결말(승리·패배·다음 시나리오)이 났으면 입력을 받지 않는다 — 셸이 pendingOutcome 을 비운 뒤 링이 다시 떴다 (사장님 「실패했을때, 게임 진행이 멈춰야하는데 … 링커맨드가 뜨거나」) */
  var self = this;
  /* ★ ② 중에는 클릭 좌표로도 커서가 움직이면 안 된다 (위 `hover` 와 같은 이유) */
  var 잠클 = (this.mode === MODE.TARGET_SELECT &&
              this.rangeContext && this.rangeContext.효과확인 && this.rangeContext.잠금);
  if (잠클) this.cursorTile = { x: 잠클.x, y: 잠클.y };
  else if (x != null) this.cursorTile = { x: x, y: y };

  switch (this.mode) {
    case MODE.STATUS_VIEW:
      /* ★ 2026-09-24 — 2쪽(`0x48863`)은 `0x48BAF eax=0xBB8` · `0x48BB4 call 0x499EF` 로 3000틱 또는
       *   **아무 입력**까지 기다린 뒤 1쪽 고리(`0x48E90`)로 **돌아간다**. 그 입력은 대기가 먹는다.
       *   ☠ 전에는 2쪽에서 누르면 아래로 흘러 상태창이 통째로 닫혔다. */
      if (this.svc.hud && this.svc.hud.statusPage && this.svc.hud.statusPage() === 1 &&
          this.svc.hud.toggleStatusPage) {
        var pg0 = this.svc.hud.toggleStatusPage();
        this.svc.onEvent({ type: 'statusPage', page: pg0 });
        return Promise.resolve({ ok: true, statusPage: pg0 });
      }
      /* ★ MORE 버튼(MENUSTAT[39]) 위를 누른 것이면 창을 닫지 않고 2페이지로 넘깁니다.
       *   `ev.lx/ly` 는 입력부가 준 **논리 320×200 좌표**입니다. */
      if (ev && ev.lx != null && this.svc.hud && this.svc.hud.moreHit &&
          (!this.svc.hud.statusPage || this.svc.hud.statusPage() === 0) &&
          this.svc.hud.moreHit(ev.lx, ev.ly)) {
        var pg = this.svc.hud.toggleStatusPage ? this.svc.hud.toggleStatusPage() : 0;
        this.svc.onEvent({ type: 'statusPage', page: pg });
        return Promise.resolve({ ok: true, statusPage: pg });
      }
      /* ★ 장비 칸을 눌렀으면 **집거나 놓는다** — 창을 닫지 않는다 (0x48E90) */
      if (ev && ev.lx != null) {
        var r장비 = this.equipClick(ev.lx, ev.ly, ev.press === true);
        if (r장비) return Promise.resolve(r장비);
      }
      return Promise.resolve(this.closeStatus());

    case MODE.FRAME_IDLE: {
      var u = this.battle.at(x, y);
      if (!u || !u.alive) return Promise.resolve({ ok: false, reason: '빈 칸' });
      /* 원본 0x55AA2 : 아군([+0x0E]==1) → 0x4D674, 그 밖 → 0x493A3.
       * ★ 0x4D674 는 「이번 차례인가」를 안 봅니다 — `[+0x56] == 0xFF` 이기만 하면
       *   대기열의 **아무 아군이나 순서 없이** 조작할 수 있습니다 (0x4D6BB).
       *   행동 가능하지 않은 아군은 조회 전용 링이 열립니다.
       *
       * ★★★★★ **우군(진영 2)은 조작할 수 없다 — 진영 1 만이다** (2026-09-03)
       *
       *   > 사용자 지적: 「**우군 캐릭터 링커맨드에 진입되는 문제**도 있어. 원작은
       *   >   우군은 캐릭터가 전혀 관여할 수 없어. … 스페이스바로 ai 페이즈가 되었을때
       *   >   **우군 링커맨드 진입이 되는 문제**가 있어. 우군캐릭터는 **적군처럼 확인만**
       *   >   가능하고 유저가 우군 링커맨드에 접근할 수 없어.」
       *
       *   ☠ `S().isAlly()` 는 **1·2 를 아군**으로 본다(`state.js:23`). 그건 「같은 편인가」
       *     (사기·피아 판정)용이고, **조작할 수 있는가**와는 다른 물음이다.
       *   원본은 여기서 **진영 1 만** 가른다:
       *   ```asm
       *   0x55AA2  cmp [eax+0x0E], 1      ; ★ 진영 == 1 인가
       *   0x55AA6  jne 0x55AB5            ;   아니면
       *   0x55AAE  call 0x4D674           ; ★ 1 이면 **조작 링**
       *   0x55AB5  call 0x493A3           ; ★ 그 밖은 **조회 화면**
       *   ```
       *   ★ 같은 판정이 경험치 대사창에도 있다 — `0x17AB7 cmp [ebp+0x0E], 1`
       *     (`battle_main.js:2178` 주석이 이미 「진영 2 도 창이 안 뜬다」고 적어 두었다). */
      if ((u.side | 0) === 1) return Promise.resolve(this.enterSession(u));   /* 0x55AA2 */
      return Promise.resolve(this.openStatus(u));                             /* 0x493A3 */
    }

    case MODE.MOVE_DESTINATION_SELECT: {
      var d = this.movement.pickDest(x, y);
      if (!d.ok) return Promise.resolve({ ok: false, reason: d.reason });   // 거부, 상태 유지
      this.moveDraft = this.movement.draft;
      this._상태전이(MODE.MOVE_PATH_DRAFT);
      this._상태전이(MODE.FACING_SELECT_ENTER);
      this._상태전이(MODE.FACING_SELECT);
      return Promise.resolve({ ok: true, draft: this.moveDraft, mode: this.mode });
    }

    case MODE.FACING_SELECT:
      return this.confirmFacing();

    case MODE.TARGET_SELECT: {
      /* ★★★ **광역 마법은 두 단계다** — 원본 `0x1F784` (2026-08-16)
       *
       *   사용자 지정: 「원본은 **타겟 지정 범위에서 특정 지점을 클릭해야 그 자리에서
       *   효과 범위가 표시**돼. 효과 범위가 표시된 상태에서는 **마우스가 그 자리에
       *   고정**돼(4·6·7단계 같은 다른 광역도 마찬가지). 이 상태에서 클릭하면
       *   **시전**되고 **우클릭하면 취소**되어 다시 타겟 지정 영역이 나와.」
       *
       *   ```asm
       *   0x1F78B  call 0x1CC09      ; ① 사거리(타겟 지정 영역) 칠하기
       *   0x1F790  call 0x1F19C      ; ① 대상 선택 — 커서가 자유롭게 움직인다
       *   0x1F7A2  [0x8A8B0]/[0x8A8B2] = 고른 칸        ; ★ 여기서 칸이 **확정**된다
       *   0x1F7DE  call 0x1AC08      ; ② 효과 범위 순회 시작 (그 칸 중심)
       *   0x1F803  call 0x13D02      ; ②   칸을 칠한다
       *   0x1F837  call 0x4A815      ; ② **키 대기** — 커서가 고정된다
       *   0x1F83D  cmp eax, -1 ; 0x1F842 [0x80B9E] = 0  ; 취소면 플래그를 0 으로
       *   0x1F853  je 0x1F789        ; ★ 0 이면 **① 로 되돌아간다**
       *   ```
       *   즉 효과 범위는 **클릭으로 칸이 확정된 뒤에** 칠해진다. 우리는 이 단계가
       *   없어서 ①에서 커서를 따라 범위가 계속 따라다녔다. */
      if (this.rangeContext && this.rangeContext.효과확인) {
        /* ── ② 상태 — 좌클릭이면 그대로 시전 (커서는 고정이라 좌표를 무시한다) */
        var 잠 = this.rangeContext.잠금;
        /* ★ 대포 — 0x4A815 확인이 났다 → 십자 안의 적 전부를 «모은 대상 그대로»(사거리 재검사 없음 · 마장기 원거리와 같은 길)로 쏜다 */
        if (this.rangeContext.대포십자) {
          this.targetDraft = { targetUnits: (this.rangeContext.대포적들 || []).slice(), targetTiles: this.rangeContext.효과칸 || [],
                               조준칸: { x: 잠.x | 0, y: 잠.y | 0 }, 범위검사없음: true, cell: { x: 잠.x | 0, y: 잠.y | 0 } };
          this._상태전이(MODE.ACTION_CONFIRM);
          return this.commitAction();
        }
        var p2 = this.selector.pick(잠.x, 잠.y);
        /* ★★★ **자기중심은 `pick` 이 실패해도 진행한다** (2026-08-16 회귀 고침)
         *
         *   사용자: 「**4단계** 조금 전 범위마법 수정으로 인해 지금은 **발동 자체가
         *   안 됨.**」 ← 바로 앞 커밋(3976c53)이 만든 회귀다.
         *
         *   원인 — `잠금` 을 **시전자 칸**으로 두는데 `selector.pick` 은
         *   `c.legal` 을 요구한다(`selector.js:169`). 4단계(`dir4`)는 사거리가
         *   **시전자 앞쪽**이라 시전자 칸이 `legal` 이 아니고, 그래서 `pick` 이
         *   「유효하지 않은 대상」으로 거부해 **아무 일도 안 일어났다.**
         *
         *   원본에는 애초에 이 관문이 없다 — `0x1F8A0` 은 **선택 없이**
         *   `[esp+0xC]=1` 로 바로 진행하고, 소환도 `0x29FC6 call 0x4A815` 로
         *   **확인만** 받는다. 곧 자기중심 갈래에서 `pick` 은 **없어야 할 단계**다.
         *
         *   그래서 실패하면 초안을 **직접** 만든다. 효과 칸은 이미 `효과칸` 에
         *   들어 있고(시전자 기준), 대상은 그 칸 위의 살아 있는 유닛 전부다 —
         *   관계 필터는 `combat.gatherMagicTargets` 가 다시 본다. */
        if (!p2.ok) {
          if (!this.rangeContext.자기중심) return Promise.resolve({ ok: false, reason: p2.reason });
          var 칸들 = this.rangeContext.효과칸 || [{ x: 잠.x, y: 잠.y }];
          var us = ((this.battle && this.battle.units) || []).filter(function (q) {
            if (!q || !q.alive) return false;
            for (var i = 0; i < 칸들.length; i++)
              if ((칸들[i].x | 0) === (q.x | 0) && (칸들[i].y | 0) === (q.y | 0)) return true;
            return false;
          });
          this.selector.draft = { targetUnits: us, targetTiles: 칸들,
                                  cell: { x: 잠.x | 0, y: 잠.y | 0 } };
        }
        this.targetDraft = this.selector.draft;
        this._상태전이(MODE.ACTION_CONFIRM);
        return this.commitAction();
      }
      /* ── ① → ② — 광역이면 **칸만 잡아 두고** 효과 범위를 편다 (아직 시전 안 함)
       *
       *   ★ `selector.pick()` 을 **부르기 전에** 가른다. 예전엔 pick 을 먼저 하고
       *     `selector.cancel()` 로 되돌렸는데, 그러면 셀렉터가 취소 상태로 빠져
       *     ①로 돌아온 뒤 **다시 클릭이 안 먹었다** (사용자 2026-08-16:
       *     「우클릭하면 취소되고 타겟 선택 영역 표시는 남아있는데, **다시 클릭이
       *     되지 않아**」). 셀렉터는 ②에서 좌클릭할 때 **그때 한 번만** 건드린다. */
      var 광 = this._광역효과확인가능({ x: x | 0, y: y | 0 });
      /* ★ 광역인데 **효과 범위에 맞을 대상이 없다** → 아무 반응 없이 ① 유지.
       *   원본 `0x1F7BB jl 0x1F790`(유효성 실패 → 대상 선택 다시)과 같은 자리다. */
      if (광 === '거부') {
        return Promise.resolve({ ok: false, reason: '효과 범위에 대상이 없습니다', 무반응: true });
      }
      if (광) {
        this.rangeContext.효과확인 = true;
        this.rangeContext.잠금 = { x: x | 0, y: y | 0 };
        /* 칸 목록을 **여기서 한 번** 만들어 둔다 — 표시 쪽이 매 프레임 다시
         *   계산하면 느려진다(사용자: 「처리가 너무 느려」). */
        this.rangeContext.효과칸 = 광.cells;
        /* ★★★ **화면을 곧바로 다시 칠하라고 알린다** (2026-08-16)
         *
         *   사용자: 「아직도 범위 선택되는게 아주 많이 느려… 타겟 지정 영역이나
         *   이동 영역이랑 뭐가 달라서 이렇게 늦지? 다른건 빨리 잘 뜨는데.」
         *
         *   답은 **`refresh()` 가 매 프레임 도는 게 아니라는 것**이다. `전투.html` 은
         *   `svc.onState`(= 모드가 바뀔 때)와 몇 군데에서만 부른다. ①→② 는 모드를
         *   그대로 두므로(둘 다 `TARGET_SELECT`) 아무도 refresh 를 안 불렀고,
         *   범위는 **다음 입력이 올 때까지** 안 그려졌다. ②는 커서까지 고정이라
         *   hover 도 안 오니 유난히 오래 걸린 것이다.
         *   (타겟 지정·이동 영역이 빨랐던 이유는 그때는 **모드가 바뀌기** 때문이다.)
         *
         *   마크 캐시(`refresh._sig`)로 최적화한 것은 그것대로 맞지만, **진짜 원인은
         *   이쪽**이었다. */
        this.svc.onState(this.mode, this);
        return Promise.resolve({ ok: true, 효과확인: true, at: this.rangeContext.잠금 });
      }
      var p = this.selector.pick(x, y);
      if (!p.ok) return Promise.resolve({ ok: false, reason: p.reason });   // 거부, 상태 유지
      this.targetDraft = this.selector.draft;
      this._상태전이(MODE.ACTION_CONFIRM);
      return this.commitAction();
    }

    /* AI 좌표 설정 0x4CE1F — 맵에서 칸 하나를 고릅니다 (코드 2 = 좌클릭 → 0x4D016) */
    case MODE.AI_COORD_SELECT:
      /* 왼쪽 누름(코드 2 · 0x4CF17) = 곧바로 확정 → AI 링 (0x4D016 → 0x4D0D0) */
      this.pickAiCoord(x, y);
      return Promise.resolve(this.confirmAiCoord());

    case MODE.RING_IDLE:
      /* 맵 클릭은 링이 서 있는 동안 무시합니다 — 링 캔버스가 받습니다 */
      return Promise.resolve({ ignored: '링이 서 있습니다' });

    default:
      return Promise.resolve({ ignored: this.mode });
  }
};

/* ══════════════════════════════════════════ 4. 우클릭 / ESC */

/**
 * ★ 지금 고르는 것이 **광역 마법**인가 — ② 효과 범위 확인 단계를 둘지 판단한다.
 *
 * 원본 `0x1F784` 는 대상 칸이 정해진 뒤 `0x1AC08`/`0x1AC59` 로 **주변 칸을 모아
 * 칠하고** `0x4A815` 로 키를 기다린다. 그 「주변 칸 모으기」가 있는 마법 =
 * 효과 범위가 고른 칸 하나보다 넓은 마법이 곧 광역이다.
 * 3단계뿐 아니라 **4·6·7단계 등 광역 전부**가 여기 걸린다(사용자 지정 2026-08-16).
 *
 * `effectCells` 가 없거나(단일 대상) 결과가 한 칸뿐이면 ②를 건너뛴다.
 * @param {{x,y}} [at] 고른 칸 — 호출부가 넘긴다 (초안 구조에 기대지 않는다)
 * @returns {boolean}
 */
Controller.prototype._광역효과확인가능 = function (at) {
  var rc = this.rangeContext;
  /* ★ 대포(무기 0x11·0x12) — 범위 안 칸이면 그 칸 중심 반경 1 십자(0x1AC08 edi=1) · 십자 안에 적이 없으면 '거부'(0x1F84B je → 다시 고르기) */
  if (rc && rc.kind === 'attack' && rc.대포십자) {
    var 자리 = at || rc.잠금;
    if (!자리) return false;
    var 범위안 = rc.cells && rc.cells.some(function (c) { return (c.x | 0) === (자리.x | 0) && (c.y | 0) === (자리.y | 0); });
    if (!범위안) return false;
    var Cb십 = root.G2Combat, 나 = this.session && this.session.actor, b = this.battle;
    var 십 = (Cb십 && Cb십.diamond) ? Cb십.diamond(b, 자리.x | 0, 자리.y | 0, 1, true) : [{ x: 자리.x | 0, y: 자리.y | 0 }];
    var 적들 = [];
    십.forEach(function (c) {
      var t = b.at ? b.at(c.x, c.y) : null;
      if (t && t.alive && t !== 나 && 적들.indexOf(t) < 0 && Cb십 && Cb십.hostile && Cb십.hostile(나.side, t.side, b.confuse)) 적들.push(t);
    });
    if (!적들.length) return '거부';
    rc.대포적들 = 적들;
    return { cells: 십 };
  }
  if (!rc || rc.kind !== 'magic' || typeof rc.effectCells !== 'function') return false;
  /* ★ 칸은 **호출부가 넘긴 좌표**를 쓴다. 처음엔 `selector.draft.at` 을 봤는데
   *   초안의 칸 필드는 `at` 이 아니라 `cell` 이라(`selector.js:191`
   *   `draft = { targetUnits, targetTiles, cell }`) 늘 `false` 가 나왔고,
   *   그래서 ②를 건너뛰고 곧바로 시전됐다 (사용자 2026-08-16:
   *   「효과범위 안그려지고 바로 시전돼」). 초안 구조에 기대지 않는다. */
  if (!at) at = rc.잠금;
  if (!at) return false;
  /* ★ **사거리 안인지 먼저 본다** — 원본 `0x1F7B3 call 0x13CBD` 가 실패하면
   *   `0x1F7BB jl 0x1F790` 으로 ① 선택을 다시 돌린다. 밖을 눌러도 ②로 들어가면
   *   안 된다. (`pick` 을 안 부르고 가르므로 여기서 직접 확인해야 한다.)
   *
   *   ★ `legal` 도 함께 본다 — `selector.highlight()` 는 **고를 수 없는 칸도**
   *   `legal:false` 로 함께 돌려준다(`selector.js:146`). 좌표만 맞다고 ②로 들여보내면
   *   ②에서 `pick` 이 `c.legal` 검사에 걸려 **시전이 안 된다**
   *   (사용자 2026-08-16: 「효과 영역 나타난 상태에서 클릭해도 시전이 안됨」). */
  var 안 = rc.cells && rc.cells.some(function (c) {
    return (c.x | 0) === (at.x | 0) && (c.y | 0) === (at.y | 0) && c.legal !== false;
  });
  if (!안) return false;
  var cells = null;
  try { cells = rc.effectCells(at); } catch (e) { return false; }
  /* ☠☠☠★★★★★ **「몇 칸이냐」가 아니라 「범위형 마법이냐」로 가른다** (2026-09-15)
   *
   *   > 사장님: 「**한번더 클릭**하게 되어있네. **범위 설정마법인데 범위가 1**로
   *   >  되어있어」 · 「1클래스 마법들(회복3, 보조1~5, 보조7, 암흑1)도 **범위 유형으로**」
   *   > 화면 실측 — 지금은 ㉮ 「클릭 한 번에 바로 나간다」, 나와야 할 것은
   *   >             ㉯ 「범위는 뜨는데 **한 칸만** 칠해진다」
   *
   *   ☠ 여기 `cells.length <= 1` 이 있었다. **1클래스는 반경이 1 이라 효과칸이
   *     딱 한 칸**이라서 이 줄에 걸려 ②(효과 범위 확인)를 통째로 건너뛰고
   *     곧바로 시전됐다. 걸리는 칸 여덟 —
   *       회복3 Cure · 보조1 PowerUP · 보조2 SpeedUP · 보조3 MagicArmor ·
   *       보조4 Bless · 보조5 Silence · 보조7 Curse · 암흑1 Confuse
   *     (`combat.js` 의 판정은 셋 다 `field`+`aoe` 로 **처음부터 맞았다** —
   *      147칸 전수 대조에서 어긋난 칸이 0 이었다. 어긋난 곳은 여기뿐이다.)
   *
   *   ⇒ `magicTargeting().effect` 가 `'single'` 이 아니면 **범위형**이다.
   *     효과칸이 한 칸이어도 ②를 거친다 — 그것이 「범위가 1인 범위 마법」이다.
   *   ★ 단일 대상 마법(`effect:'single'`)은 예전 그대로 ②가 없다.
   *   ★ 칠할 칸이 **아예 0** 이면 보여 줄 것이 없으므로 예전처럼 건너뛴다. */
  var 범위형 = false;
  try {
    var Cw = root.G2Combat;
    if (Cw && Cw.spellParts && Cw.magicTargeting) {
      var pw = Cw.spellParts(rc.spell | 0);
      var tgw = Cw.magicTargeting(pw.series, pw.level, pw.rank);
      범위형 = !!(tgw && tgw.effect && tgw.effect !== 'single');
    }
  } catch (e범위) { 범위형 = false; }
  if (!cells || !cells.length) return false;
  if (!범위형 && cells.length <= 1) return false;

  /* ★★★ **효과 범위 안에 맞을 대상이 없으면 그 칸은 아예 못 고른다** (2026-08-16)
   *
   *   사용자 지정: 「원작은 타겟 선택 영역에서 좌표를 클릭할 때, 해당 좌표 기준으로
   *   **효과 범위 내 적용받는 대상이 없으면 애초에 그 좌표 선택이 안 되고 아무 반응이
   *   없이** 그대로 타겟 지정 영역에서 조작이 이어져. 반면에 **4, 6, 7 단계는 범위
   *   마법인데 효과 범위 내에 적용받는 대상이 없어도 시전이 돼.** 원작이 약간
   *   **일관성이 없는** 부분이기도 해.」
   *
   *   그래서 **단계별로 다르다** — 3단계(`level === 2`)만 대상을 요구하고,
   *   4·6·7단계는 빈 칸에도 떨어뜨릴 수 있다. 원작의 불일치를 그대로 옮긴다.
   *   ☠☠☠ **2026-09-03 — 여기 「검사 자리를 찾았다」고 적었던 것은 틀렸다.**
   *
   *     `0x1F84B cmp [0x80B9E], 0 / je 0x1F789` 을 「빈 칸 시전 거부」라고 적었는데,
   *     그 줄이 든 함수 **`0x1F738` 은 마법이 아니라 「통상 공격」 창구**다:
   *     ```
   *     플레이어 링 아이콘 **0 공격**  0x4D442 → 0x4D45E → 0x1F738
   *     일반 AI 근접 1스텝           0x4016A → 0x40210 → 0x1F738
   *     ```
   *     (`링커맨드_원본동작.md` §9 분기표 · `SCE_HP변경_창구.md` §3-n ·
   *      이 파일 4505 줄 주석이 이미 「둘이 공유한다」고 적어 두었다.)
   *     마법은 같은 분기표의 **아이콘 6** → `0x4D4B1` → `0x4C72A` **하위 메뉴**로 간다.
   *   ☠ **함수 머리를 확인하지 않고 근처 주소를 「그 검사」라고 단정한 것**이 원인이다.
   *     `EXE_호출부찾기.js` 가 「진짜 머리는 0x1F738」이라고 알려 줬는데도
   *     그 함수가 **무엇인지**를 안 물었다 (재발방지 R67 과 같은 갈래).
   *   ★★★★★ **다시 찾았다 — 이번엔 마법 쪽이다** (2026-09-03 · R75 규칙대로)
   *
   *     `마법_타게팅_지오메트리_주소맵.md` §2.1 에 **이미 적혀 있었다** —
   *     「`cmp [0x80b9e],0 je 취소 (대상 없음)`」. 원본으로 검산했다:
   *   ```asm
   *   ── 화염 계열 선택범위 0x29552 (class 2/3 경로) ──
   *   0x29552  eax = [esp+0xC](class) · 0x29556 bx = [0x74492]   ; 조작 모드
   *   0x29560  eax = class + 3                                    ; 반경
   *   0x29565  cmp bx, 1 / jne 0x295DA                            ; 1 = 수동 커서
   *   0x2957C  call 0x419F1                                       ; ★ 칸 고르기
   *   0x29584  je 0x29548                                         ;   취소면 −1
   *   0x29594  call 0x11EE4 · 0x295B0 0x28A97 · 0x295BE 0x11E04   ; 커서 표시·수집
   *   0x295C3  **cmp [0x80B9E], 0**                               ; ★ **대상 수가 0 인가**
   *   0x295CB  **je 0x29548**                                     ; ★ 0 이면
   *   0x29548  **mov eax, −1** · 0x2954D jmp 0x29430              ;   **취소로 되돌린다**
   *   ```
   *     ⇒ 사용자 관측(「효과 범위에 대상이 없으면 **아무 반응 없이** 다시 고르게 된다」)이
   *       `0x295C3` 두 줄로 확인됐다. **`[0x80B9E]` 는 `0x28596` 이 채우는 대상 수**다.
   *   ★ **class 1 은 다른 경로**(`0x2952C call 0x28C8A`)라 이 검사가 없다 —
   *     「단계마다 다르다」는 관측과 맞물린다. 우리 `level === 2`(3단계) 조건은
   *     **class 2/3 경로만 대상을 요구한다**는 이 구조에서 나온 것이다.
   *   ★★★★★ **단계 다섯을 전수로 세었다 — 검사는 `Lv3` 한 곳뿐이다** (2026-09-03)
   *
   *     마법 함수표의 단계별 핸들러를 **함수 경계 안에서만** 세었다
   *     (`마법_타게팅_지오메트리_주소맵.md` §1):
   *     ```
   *     Lv1 0x28ED6 ~ 0x29273 — 대상수 검사 **0 곳**
   *     Lv2 0x29273 ~ 0x29514 — **0 곳**
   *     Lv3 0x29514 ~ 0x29722 — ★ **1 곳 (0x295C3)**
   *     Lv4 0x29722 ~ 0x29F4D — **0 곳**   ← 자기 광역/방향
   *     Lv5 0x29F4D ~        — **0 곳**   ← 소환
   *     ```
   *     ⇒ 사용자 관측(「**4·6·7 단계는 빈 칸에도 시전된다**」)과 **정확히 맞는다.**
   *   ☠ 처음에 400 인스트럭션씩 훑었더니 Lv2 에도 「1 곳」이 잡혔다 — **함수 경계를
   *     넘어 Lv3 의 것을 주워 온 것**이었다 (재발방지 **R75**). 경계로 자르니 0 이다.
   *
   *   ★★★ **그런데 우리와 원본이 다르다** — 원본은 `Lv3` **전부**가 아니라
   *     **`class 2·3` 만** 그 검사를 탄다:
   *     `0x29514` 안에서 `cmp dx, 1` 로 갈려 **class 1 은 `0x2952C call 0x28C8A`**
   *     (검사 없음), **class 2/3 은 `0x29552`** → `0x295C3` 검사.
   *     ⇒ **3단계 1클래스 마법은 빈 칸에도 시전된다.** 아래 조건에 `rank` 를 더한다.
   *
   *   리마스터 토글(`Opt.cfg.빈칸시전`)로 「전부 허용」을 고를 수 있다
   *   (`리마스터_적용현황.md` [R-빈칸시전]). 기본은 **원작**이다. */
  var P = root.G2Combat && root.G2Combat.spellParts;
  var p = P ? P(rc.spell | 0) : null;
  /* ★ 원본 `0x29514` — **Lv3(level 2) 이면서 class 2·3(rank 1·2)** 만 대상을 요구한다.
   *   class 1(rank 0)은 `0x2952C` 갈래라 `0x295C3` 검사를 안 탄다. */
  var 대상필요 = !!(p && p.level === 2 && (p.rank | 0) >= 1);   // 3단계 · 2·3클래스
  /* ★ 버프·디버프 범위 마법도 대상을 요구한다 (2026-09-26 · Z-84)
   *   사장님 「컨퓨즈 같은 범위지정 버프, 디버프 마법이 … 타일을 지정할때, 해당 타일 안에 효과를 받는 캐릭터가 없는 경우 지정이 안돼.
   *   예를들면 1칸 범위는 타겟을 직접 지정해야만 범위 영역이(1칸) 나오고, 2칸(십자가형태) 지정범위는 그 범위내에 타겟이 있는 타일만 지정이 가능해.」
   *   원본: 칸 고르기 0x28B24 — 0x4A483 → 0x28A97 대상 수집 → [0x80B9E]==0 이면 0x28C57 je 0x28BA7 다시 고르기(확인 없음).
   *   이 고르기를 부르는 곳 넷 — 원소 3단계 0x295EB(위) · 큐어·컨퓨즈 0x2B1D0(0x2B29C) · 보조 0x2B391(0x2B441) · 0x2C566(0x2C58D).
   *   ⇒ 보조 계열(4) 전부 · 회복 3단계 큐어(3·2) · 암흑 1단계 컨퓨즈(6·0). 힐(0x2AE44) 등은 이 고르기를 안 써 그대로 둔다. */
  if (p && ((p.series | 0) === 4 || ((p.series | 0) === 3 && (p.level | 0) === 2) || ((p.series | 0) === 6 && (p.level | 0) === 0)))
    대상필요 = true;
  var 옵 = root.Opt && root.Opt.cfg;
  if (옵 && 옵.빈칸시전 === '허용') 대상필요 = false;      // [리마스터] 전부 허용
  /* ★★ 「대상이 없다」와 「광역이 아니다」는 **다르다** — `'거부'` 로 갈라 준다.
   *   그냥 `false` 를 주면 호출부가 「광역이 아니네」로 보고 `selector.pick` 으로
   *   넘어가 **곧바로 시전**해 버린다 (사용자 2026-08-16: 「빈칸으로 판단되는
   *   부분을 클릭했을때, 영역이 안뜨고 **바로 스킬이 시전**돼」).
   *   원작은 **아무 반응 없이** 타겟 지정 영역에 그대로 머문다. */
  if (대상필요 && !this._효과대상있나(at)) return '거부';

  /* 칸 목록째로 돌려준다 — 호출부가 그대로 캐시해 쓴다(매 프레임 재계산 방지). */
  return { cells: cells };
};

/**
 * ★ 그 칸에 떨어뜨렸을 때 **실제로 효과를 받을 유닛**이 하나라도 있나.
 *
 * 칸 목록이 아니라 `gatherMagicTargets` 를 그대로 쓴다 — 관계 필터(적/아군/양쪽)와
 * 생존 판정까지 원본과 같은 창구를 타야 한다(`0x42743` 필터 · `[unit+0x61] < 0x12c`).
 * @param {{x,y}} at
 * @returns {boolean}
 */
Controller.prototype._효과대상있나 = function (at) {
  var C = root.G2Combat, rc = this.rangeContext;
  if (!C || !C.gatherMagicTargets || !C.spellParts || !C.magicTargeting) return true;
  try {
    var p = C.spellParts(rc.spell | 0);
    var tg = C.magicTargeting(p.series, p.level, p.rank);
    var got = C.gatherMagicTargets(this.battle, this.session.actor, p, tg, null, { at: at });
    return !!(got && got.length);
  } catch (e) { return true; }                            // 못 재면 막지 않는다
};

/** 현재 입력 단계를 원본 ESC·우클릭 규칙에 따라 한 단계 취소한다. */
Controller.prototype.cancel = function () {
  switch (this.mode) {
    case MODE.STATUS_VIEW: return Promise.resolve(this.closeStatus());

    case MODE.RING_IDLE: {
      var r = this.session.ringCancel();
      if (r.kind === 'menu') {
        this._상태전이(MODE.RING_GATHER); this._상태전이(MODE.RING_SPREAD);
        this.ringContext = { menu: r.menu, icons: r.icons, unit: this.session.actor };
        if (this.svc.ringView && this.svc.ringView.swap) this.svc.ringView.swap(r.menu, r.icons);
        this._AI막대동기화(r.menu);
        this._상태전이(MODE.RING_IDLE, r.menu);
        return Promise.resolve({ ok: true, menu: r.menu });
      }
      /* AI 본 링에서 나온 −1 은 `0x4D3A6` — 유닛을 행동 리스트에서 빼고([+0x83]==1 유지)
       * 세션을 끝냅니다. 그 유닛은 AI 가 조작하게 됩니다. */
      if (r.ai) {
        var au = this.session.actor;
        /* ★ `0x4D3A6` 은 [+0x83] 을 **안 쓴다** — 들어올 때 값 그대로(본 링 AI 아이콘이면 0x4D55B 가 1 로 세워 두었다).
         *   ☠ 예전엔 무조건 1 로 덮어 소울리콜·소환수의 2 가 1 이 되고, 다음 클릭에 AI 링에 AI END(13)가 생겨
         *     풀 수 있었다(원본 `0x4C5E9 cmp [+0x83],2 / je` — 2 면 13 을 안 올린다).
         *     (2026-09-24 사장님 「소울리콜로 소환한 캐릭터 ai 해제 불가능해야해.」) */
        au.ai = au.ai || {}; if (!(au.ai.flag | 0)) au.ai.flag = 1;
        /* ★★★★★ **대기열에서 직접 버린다** — `0x4D3A8 call 0x19718` (2026-08-30 · B-3)
         *   ☠ 예전에는 주석에만 적고 `endSession` 에 맡겼는데,
         *     `session.end` 는 TP 를 안 썼으면 `waitCount = savedWait`(0xFF) 로
         *     **되돌려** 다시 행동 가능하게 둔다(`0x4DAE4`→`0x4DB44`).
         *     AI 로 넘긴 유닛도 TP 를 안 썼으므로 그 갈래를 타 **대기열에 남았고**,
         *     대기열이 안 비니 `0x4DB58` 이 페이즈를 0 으로 못 돌렸다 —
         *     그래서 **스페이스바를 눌러야** AI 가 움직였다(지적 B-3).
         *   ★ 원본은 `0x19718`(빼기만)이다 — `0x197AD`(빼기 + `[+0x56]=0`)가 아니다.
         *     곳 대기값은 건드리지 않는다. */
        try {
          var Tn = root.G2Turn;
          if (Tn && Tn.dequeueReady) Tn.dequeueReady(this.battle, au);   /* 0x19718 */
        } catch (eAi) {}
        this.msg((au.name || '유닛') + ' — AI 조작으로 넘겼습니다');
        return this.endSession('AI 설정 취소 (0x19718)');
      }
      /* −1 : 링 모으기 없이 바로 닫고 세션 종료 (0x4D975) */
      return this.endSession('명령 −1 (우클릭)');
    }

    /* 0x4CFF5 ESC(0x1B) · 오른쪽 누름(3) → 목표를 지운 채로 AI 링으로 */
    case MODE.AI_COORD_SELECT:
      this.aiCoordCursor = null;
      return Promise.resolve(this.backToAiRing());

    case MODE.FACING_SELECT: {
      /* ★ 방향 취소 → 링이 아니라 **같은 이동 범위**의 목적지 선택으로 (§27-5) */
      var c = this.movement.cancelFacing();
      this.moveDraft = null;
      this._상태전이(MODE.MOVE_DESTINATION_SELECT, '방향 취소');
      return Promise.resolve({ ok: true, rangeKept: c.rangeKept, mode: this.mode });
    }

    case MODE.MOVE_DESTINATION_SELECT:
      this.movement.cancelDest();
      return this.moveExit();

    case MODE.TARGET_SELECT: {
      /* ★ ② 효과 범위 확인 중이면 **①로 되돌아간다** — 원본 `0x1F853 je 0x1F789`.
       *   명령 자체가 취소되는 게 아니라 타겟 지정 영역이 다시 나온다. */
      /* ★★ 자기중심·전체맵은 **① 이 애초에 없다** — 되돌아갈 곳이 없으므로
       *   명령 자체를 취소하고 링으로 간다 (2026-08-16). */
      if (this.rangeContext && this.rangeContext.효과확인 && this.rangeContext.자기중심) {
        this.selector.cancel();
        this.targetDraft = null; this.pendingCommand = null;
        return this.resumeRing('대상 선택 취소');
      }
      if (this.rangeContext && this.rangeContext.효과확인) {
        this.rangeContext.효과확인 = false;
        this.rangeContext.잠금 = null;
        this.rangeContext.효과칸 = null;
        /* ★ `selector` 는 건드리지 않는다 — ①에서 `pick` 을 아예 안 했으므로
         *   셀렉터는 여전히 고를 수 있는 상태다. 여기서 `cancel()` 을 부르면
         *   ①로 돌아와도 클릭이 안 먹는다. */
        this.svc.onState(this.mode, this);      // ★ 곧바로 다시 칠한다 (위 ①→② 와 같은 이유)
        return Promise.resolve({ ok: true, 효과확인: false, reason: '효과 범위 취소 — 대상 지정으로' });
      }
      /* 비용도 난수도 소비하지 않습니다 (§27-6) */
      this.selector.cancel();
      this.targetDraft = null; this.pendingCommand = null;
      return this.resumeRing('대상 선택 취소');
    }

    /* 0x55AC7 — 맵 우클릭은 대기열의 다음 아군을 잡아 세션을 엽니다 */
    case MODE.FRAME_IDLE:
      return Promise.resolve(this.cycleReady());

    default:
      return Promise.resolve({ ignored: this.mode });
  }
};

/* ══════════════════════════════════════════ 5. 세션 · 링 */

/**
 * `ACTOR_SESSION_ENTER` — 0x4D674.
 *
 * ★ 조회 전용 판정은 **차례가 아니라 상태**로 정해집니다 (0x4D6BB / 0x4D6C1).
 *     `[+0x56] != 0xFF`  또는  페이즈 == 3 (AI Phase)  →  [0xFDAF2] = 1
 *   예전 구현은 "이번 차례 유닛이 아니면 조회 전용" 이었는데, 원본에는 그런 검사가
 *   아예 없습니다. 그래서 대기열의 아군을 아무 순서로나 조작할 수 있습니다.
 */
Controller.prototype.enterSession = function (unit, opts) {
  if (this.전투끝남) return { ok: false, reason: '전투 끝남' };   /* ★ 2026-10-12 결말 뒤 세션 금지 */
  opts = opts || {};
  this._상태전이(MODE.ACTOR_SESSION_ENTER, unit.name);
  var g = Turn().canCommand(this.battle, unit);
  if (!g.ok) { this._상태전이(MODE.FRAME_IDLE, '진입 가드'); return { ok: false, reason: g.reason }; }
  var viewOnly = opts.viewOnly != null ? !!opts.viewOnly : g.viewOnly;
  var s = Sess().create(this.battle, unit, { assets: this.svc.ringAssets });
  /* 0x4D6A9 — AI 에 맡긴 유닛([+0x83] ≥ 1)은 **AI 링부터** 뜬다 */
  var r = s.begin({ viewOnly: viewOnly, savedWait: Sess().READY, aiEntry: !!g.aiRing });
  if (!r.ok) { this._상태전이(MODE.FRAME_IDLE, '진입 가드'); return { ok: false, reason: r.reason }; }
  this.session = s;
  if (!viewOnly) this.actor = unit;                     // 초점만 옮깁니다
  if (this.svc.hud && this.svc.hud.selectUnit) this.svc.hud.selectUnit(unit);
  this.movement.reset();
  var opened = this.openRing();
  /* ★★ AI 에 맡긴 유닛을 클릭했을 때 — **본 링을 연 뒤 AI 하위 메뉴로 들어간다.**
   *
   *   사용자 정정 2026-08-14: 「AI 모드가 걸린 캐릭터를 다시 클릭했을 때
   *   링커맨드가 제대로 안 나왔다」 「**일반 링커맨드에서 AI 하위 메뉴
   *   링커맨드가 나와야** 해.」
   *
   *   `session.openRing()` 이 AI 링을 곧바로 띄우던 것을 본 링으로 바꾸고,
   *   여기서 `ringIcon(AI_ICON)` **그대로**를 태운다. 본 링에서 손으로 누른 것과
   *   같은 경로라 그림·애니메이션·스택이 전부 같아진다. */
  if (this.session && this.session.aiEntry && this.mode === MODE.RING_IDLE) {
    var self = this;
    return Promise.resolve(opened).then(function () {
      return self.ringIcon(AI_ICON);
    }).then(function () { return opened; });
  }
  return opened;
};

/* 본 링의 AI 아이콘 — `0x4BD26` 이 맨 마지막에 올리는 `AI` 글자 (13). */
var AI_ICON = 13;

/** `RING_BUILD_MAIN` → `RING_OPENING` → `RING_IDLE` */
/**
 * 링을 여는 자리에서 칠하는 **공격 범위** — 원본 `0x1CC09`.
 *
 * `상태전이_원본확정.md` A-4 4번 · A-5 `0x4D7EA` 루프 —
 * ```
 *   0x1CC09(unit)                              ; ★ 공격 범위 표시
 *   0x4B0F5 / 0x4BD26(unit) / 0x4AD69          ; 링 목록 구성
 *   0x4B767  링 열기 R 276 → 36
 * ```
 * 링을 **열기 전에** 부르고, 링이 다시 서는 매 회차마다 다시 부릅니다.
 * 사용자 확인 2026-08-14: 「원작은 링커맨드를 띄우면 **음영 처리 된 부분에 본인
 * 공격 범위가 표시**돼.」
 *
 * ★ 다만 **원거리는 여기서 안 칠합니다** — 사용자 확인:
 *   「이때 원거리는 공격 범위가 아니라 **타겟 지정 범위**라 따로 영역이 뜨지 않아.」
 *   원거리는 링에서 「공격」을 고른 뒤 대상 선택 단계에서 뜹니다.
 *   해당하는 것은 무기 **5**(궁)와 [리마스터] 무기 **2**(마법사 평타)입니다.
 *   ☐ `0x1CC09` 의 무기 5 갈래가 `0x1B7BF(ebx=0)` 로 스캔하는데
 *     그 `ebx` 가 「표시 배열에 쓰지 말라」는 뜻인지 **아직 못 박았습니다.**
 *     (`원거리_사거리_투사체.md` §1·§2). 사용자 관찰을 따랐습니다.
 *
 *   ★★★★★ **2026-08-29 — 사슬을 끝까지 이었다.**
 *
 *     ① `0x1CC94 cmp dl,5 · jbe 0x1CD55` — 무기 **5** 는 `0x1CD55` 갈래다.
 *     ② `0x1CD62 xor ebx,ebx` → **ebx = 0** → `0x1CD67 call 0x1B7BF`
 *     ③ `0x1B7BF` 는 세 전역에 저장만 한다 —
 *        `mov [0x80B88],ax` · `mov [0x80B86],dx` · **`mov [0x80B8E],bx`** · `ret`
 *        ☠ 적용본 주소는 **`0xF0B8E`**(`66 89 1d 8e 0b 0f 00`). 담은 자리 7곳.
 *     ④ 읽는 쪽 `0x1A70D cmp [0xF0B8E],0 · jne` —
 *        **== 0** → `ebx=1 · call 0x13D02`
 *        **!= 0** → `call 0x11DB2` (유닛 조회)
 *     ⑤ `0x13D02` 는 **`mov [ebx*2 + 0x78F48], cx`** 로 배열에 쓴다.
 *        `[0x78F48]` 은 **이미 확정된 배열**이다 — `.SCE 0x19A` 배치마스크가
 *        u16 로 올라온 자리다(`state.js` §배치마스크 · `0x54B0B`).
 *
 *   ⇒ **원본은 무기 5(궁)에서도 `ebx=0` 으로 부르고, 그 값이면 배열에 쓴다.**
 *     곧 `ebx` 는 「쓰지 말라」가 아니라 **「쓰라」**는 쪽이다.
 *
 *   ☠ **다만 사용자 관찰과 어긋나 보인다** — 「원거리는 공격 범위가 아니라
 *     타겟 지정 범위라 따로 뜬다」. 배열에 쓰는 것과 **화면에 칠하는 것**이
 *     같은지는 아직 모른다(그 배열은 배치마스크와 **공용**이다).
 *     ⇒ CLAUDE.md §3 에 따라 **사용자 피드백을 따르고 코드는 그대로 둔다.**
 *     ☐ 확인할 것: `[0x78F48]` 에 쓴 값이 실제로 화면에 칠해지는 경로인가.
 *       거기까지 봐야 「원본과 다르다」를 말할 수 있다.
 */
/** ★ [리마스터] 마법사 원거리 평타 토글 — `combat.js 마법사원거리켜짐()` 과 같은 판정.
 *  기본은 **켜짐**이고 `Opt.cfg.마법사원거리 === '원작'` 일 때만 끈다. */
function _마법사원거리켜짐() {
  var c = root.Opt && root.Opt.cfg;
  return !(c && c.마법사원거리 === '원작');
}

/** 링에서 고른 공격 명령의 대상 범위를 계산해 표시 상태로 만든다. */
Controller.prototype.ringAttackRange = function () {
  var C = Cb(), b = this.battle, u = this.session && this.session.actor;
  if (!C || !u) return null;
  var wt = C.weaponTypeOf(b, u) | 0;
  /* ★ 무기 2(마법사)는 **리마스터 토글이 켜져 있을 때만** 원거리다 (2026-08-16).
   *   사용자 지정: 「마법사 원거리 평타 관련하여 **토글이 꺼지면 일반 근접캐릭처럼
   *   링커맨드시 공격 영역 표시**되어야 해.」
   *   토글이 꺼지면 `attackCells` 가 정면 1칸을 주므로, 여기서도 막지 말고
   *   근접과 똑같이 칠해야 앞뒤가 맞는다. */
  var 마법사원거리 = C.isMageWeapon && C.isMageWeapon(wt) && _마법사원거리켜짐();
  /* ☠★★★★★ **여기를 풀려다 되돌렸다 (2026-09-01)** — 사용자 관찰이 이긴다
   *
   *   원본 `0x1CC94` 의 무기 5 갈래가 **비어 있지 않아서**(아래) 「원본도 칠한다」고
   *   보고 `wt === 5` 를 뺐다가, **시험이 잡아 줘서 되돌렸다.**
   *   ```asm
   *   0x1CC99  jbe 0x1CD55      ; 무기 5 (활)
   *   0x1CD67  call 0x1B7BF     ;   무언가 칠한다
   *   0x1CD8E  call 0x1B7FA     ;   무언가 칠한다
   *   ```
   *   ★ 그런데 **사용자가 직접 보고 말한 것**이 있다 (2026-08-14) —
   *     「원작은 링커맨드를 띄우면 음영 처리 된 부분에 본인 공격 범위가 표시돼.」
   *     「이때 **원거리는 공격 범위가 아니라 타겟 지정 범위**라 **따로 영역이 뜨지 않아.**」
   *   ⇒ `CLAUDE.md` §3 — **결과 피드백은 문서·EXE 해석보다 세다.**
   *   ⇒ 곧 `0x1CD55` 가 칠하는 것은 **링 단계의 공격 범위가 아니라 다른 것**이다
   *     (공격을 고른 **뒤**의 타겟 지정 범위로 읽힌다). 내가 단계를 헷갈린 것이다.
   *   ☐ **`0x1B7BF`·`0x1B7FA` 가 각각 어느 단계에서 도는지** 아직 못 갈랐다.
   *     그것을 갈라야 이 줄을 손댈 수 있다. **지금은 그대로 둔다.** */
  if (wt === 5 || 마법사원거리) return null;                             // 원거리는 안 칠함
  var cells = C.rangeOf(b, u, 'attack') || [];
  return cells.length ? { kind: 'attack', cells: cells, ring: true } : null;
};

/** 선택 유닛의 명령 세션과 링 UI를 전투 진입 순서에 맞춰 연다. */
Controller.prototype.openRing = function (열기) {
  this._상태전이(MODE.RING_BUILD_MAIN);
  var r = this.session.openRing();
  this.ringContext = { menu: this.session.ring.menu, icons: r.icons, unit: this.session.actor, 펼치기: !!(열기 && 열기.펼치기) };
  /* ☠★★★★★ **HUD 선택은 «링을 여는 자리»에서 켠다** (2026-09-15 · 사장님 지적)
   *
   *   > 「링커맨드가 뜨면 원래 **체력 hud 가 표시되어야**하는데, **마법 사용후
   *   >  복귀하는 링커맨드 발동시 안나오는거야.** 지금 이런 비슷한게 계속 나오는데,
   *   >  **링커맨드 호출하는 것 자체에 hud 표시를 넣으면 될걸 이걸 별도로 처리해서
   *   >  어디는 나오고 어디는 안나오고** 하는걸로 보여」
   *
   *   ☠ `selectUnit(unit)` 이 `enterSession`(1489) **한 곳**에만 있었다. 링을 여는
   *     길은 셋인데 —
   *       `enterSession` → `openRing`      ○ 켜진다 (처음 여는 길)
   *       `resumeRing`   → `openRing`      ☠ 안 켜진다 (마법·행동 뒤 복귀)
   *       세션 안에서 곧바로 `openRing`     ☠ 안 켜진다
   *     그 사이 `selectUnit(null)`(823·4756·4835)로 꺼 두므로 복귀 길에서는
   *     체력 구체가 안 돌아왔다.
   *   ⇒ **여는 자리 한 곳**에서 켠다. 어느 길로 오든 같아진다.
   *   ★ 끄는 것은 그대로 둔다 — 세션이 끝나면 날짜·시계 구체로 돌아가는 것이 원본이다. */
  if (this.svc.hud && this.svc.hud.selectUnit) this.svc.hud.selectUnit(this.session.actor);
  this._상태전이(MODE.RING_OPENING);
  /* ★ 공격 범위는 **링·음영과 같은 순간**에 켠다 — `0x1CC09` 는 `0x4B767`(링 열기)
   *   바로 앞이고, 그 앞 `0x1124A`(커서·카메라)가 이미 끝나 있다.
   *
   *   사용자 지적 2026-08-14: 「링커맨드가 뜨고 배경 음영이 처리될 때 **동시에**
   *   떠야 하는데, 지금은 **공격 영역이 먼저 뜨고** 링커맨드와 음영 처리가 발동해.
   *   **카메라 센터가 아닐 때** 캐릭터를 선택하면 발생해.」
   *
   *   카메라 스크롤이 비동기(rAF)라 `0x1124A` 자리에 해당하는 대기가 끝나기 전에
   *   범위만 먼저 그려졌던 것이다. `ringView.open` 바로 앞으로 옮겨 한 프레임에
   *   함께 나가게 했다. */
  this.rangeContext = this.ringAttackRange();                  // 0x1CC09
  if (this.svc.ringView && this.svc.ringView.open)
    this.svc.ringView.open(this.session.actor, r.icons, this.ringContext);
  this._AI막대동기화(this.session.ring.menu);
  this._상태전이(MODE.RING_IDLE);
  return { ok: true, icons: r.icons, mode: this.mode };
};

/** 링을 다시 엽니다 — A-5 의 `→ LOOP` */
Controller.prototype.resumeRing = function (note) {
  if (!this.session || this.session.ended) return this.endSession(note || '세션 없음');
  this.movement.reset();
  this.rangeContext = null;
  return Promise.resolve(this.openRing({ 펼치기: true }));   /* 0x4D7EA 복귀 — 펼치기 0x4B8EB */
};

/** 링 아이콘 좌클릭 */
/** 세션이 낸 «하위 메뉴로» 결과를 링에 반영한다 — RING_SPREAD → 메뉴별 모드 → RING_IDLE (ringIcon · aiMagicList 공용) */
Controller.prototype._링메뉴반영 = function (r) {
  this._상태전이(MODE.RING_SPREAD);
  this.ringContext = { menu: r.menu, icons: r.icons, unit: this.session.actor };
  if (this.svc.ringView && this.svc.ringView.swap) this.svc.ringView.swap(r.menu, r.icons);
  var m = r.menu === 'special' ? MODE.SPECIAL_MENU
        : (r.menu === 'magic') ? MODE.MAGIC_MENU
        : r.menu === 'skill' ? MODE.SKILL_MENU
        : (r.menu === 'ai_ctrl' || r.menu === 'ai_group' ||
           r.menu === 'ai_magic' || r.menu === 'ai_special') ? MODE.AI_MENU
        : MODE.RING_IDLE;
  this._상태전이(m);
  this._AI막대동기화(r.menu);
  this._상태전이(MODE.RING_IDLE, r.menu);
  return { ok: true, menu: r.menu, icons: r.icons };
};

/**
 * ★ [리마스터 I-08] AI 마법 지정 메뉴에서 위쪽 마법 목록의 이름을 눌렀다 (2026-10-01 사장님 「ai 마법 선택에서도 일반 링커맨드 마법 사용처럼 클릭으로 선택할 수 있어야해」)
 *   룬 세 단을 고른 것과 같은 결과 — Session.aiMagicFromList (0x4D362 [+0x80] = 번호 / 3 → AI 링)
 * @param {number} spell 마법 번호 (Ring.magicHit 의 spell)
 */
Controller.prototype.aiMagicList = function (spell) {
  if (this.mode !== MODE.RING_IDLE || !this.session || !this.session.aiMagicFromList)
    return Promise.resolve({ ignored: this.mode });
  this._상태전이(MODE.RING_GATHER);
  var r = this.session.aiMagicFromList(spell);
  if (!r.ok || r.kind !== 'menu') {
    this._상태전이(MODE.RING_IDLE, '거부');
    return Promise.resolve({ ok: false, reason: r.reason });
  }
  return Promise.resolve(this._링메뉴반영(r));
};

Controller.prototype.ringIcon = function (icon) {
  if (this.mode !== MODE.RING_IDLE) return Promise.resolve({ ignored: this.mode });
  this._상태전이(MODE.RING_GATHER);
  var r = this.session.ringPick(icon);
  if (r.kind === 'reject') {
    this._상태전이(MODE.RING_IDLE, '거부');
    return Promise.resolve({ ok: false, reason: r.reason });
  }
  if (r.kind === 'menu') return Promise.resolve(this._링메뉴반영(r));
  /* ★ **AI END**(아이콘 13) — `0x4D217` 이 `[+0x83] = 0` 으로 풀고 반환 1.
   *   `0x4D6AE cmp ax,1` 을 통과해 `0x4D6B8` 부터 일반 세션이 이어진다.
   *
   *   사용자 정정 2026-08-14: 「AI 하위 메뉴에서 **상위 메뉴로 갈 때에는 AI END
   *   커맨드**를 선택하면 상위 메뉴로 가.」 — 그래서 **AI 갈래로 들어왔든
   *   본 링에서 파고들었든** 똑같이 본 링으로 되돌린다.
   *   (예전에는 `aiEntry` 일 때만 갈아타서, 본 링에서 들어간 경우 되돌아갈 길이
   *    없었다.) */
  if (r.cmd && r.cmd.kind === 'ai' && (r.cmd.ret | 0) === 1 && this.session) {
    if (this.session.aiEntry) {
      var e = this.session.releaseAi();
      if (!e.ok) return Promise.resolve(this.endSession('AI 해제 실패: ' + e.reason));
      if (!e.viewOnly) this.actor = this.session.actor;
      /* ★ 화면 문구에서 **EXE 주소를 뺐다** (2026-08-29)
       *   사용자는 프로그래머가 아니다 — 「(0x4D217)」은 뜻 없는 글자다.
       *   근거 주소는 여기 주석에 남긴다: 원본 `0x4D217`. */
      this.msg('AI 조작을 풀었습니다');
    }
    this.movement.reset();
    return Promise.resolve(this.openRing());     // 본 링으로
  }
  /* ★ 명령을 골랐다 — 링을 모은 뒤(0x4B9D7 · 9 장 × 2 틱 · 그린다) 명령을 돈다. 원본 처리기 0x4D989 가 모으기 → 0x4D98E TP 검사 → 실행 (2026-09-27)
   *   ☠ 예전엔 곧바로 명령을 돌려 연출이 0 틱에 시작했다(원본 18 틱 · 설화 기록) */
  var self = this, 모 = (this.svc.ringView && this.svc.ringView.모으기) ? this.svc.ringView.모으기() : null;
  if (!모) return this.runCommand(r.cmd);
  return Promise.resolve(모).then(function () { return self.runCommand(r.cmd); });
};

/** 링 중심 좌클릭 `-2` — **이동은 여기서만 들어옵니다** (§27-1) */
Controller.prototype.ringCenter = function () {
  if (this.mode !== MODE.RING_IDLE) return Promise.resolve({ ignored: this.mode });
  var r = this.session.ringCenter();
  /* ☠★★★★★ **하위 링에서 가운데는 «이전 링으로»** (2026-09-22 사장님 지적)
   *
   *   > 사장님: 「링커맨드 하위메뉴에서 **가운데를(캐릭터를) 누르면 이전 링커맨드로
   *   >  돌아가야**하는데, 지금은 **이동으로 바로 연결**돼.」
   *
   *   ☠ 세션은 이미 「하위 메뉴입니다」로 **거부**하고 있었는데
   *     (`session.ringCenter` — `isMain()` 이 아니면 `ok:false`),
   *     **여기서 그 답을 버리고** 무조건 `enterMove()` 로 들어갔다.
   *     그래서 하위 링에서 가운데를 누르면 이동이 시작됐다.
   *
   *   ★ 2026-08-26 에 한 번 「상위로」를 넣었다가 링이 통째로 망가져 되돌린 기록이 있다
   *     (`session.js` 주석). 그때 깨진 것은 **되돌리는 길을 새로 만든 것**이었고,
   *     지금은 **이미 있는 길**(`ringCancel` → `ring.back()`)을 그대로 쓴다.
   *     우클릭 이탈과 **같은 함수**라 새 경로가 생기지 않는다.
   *   ★ 본 링에서는 예전 그대로 **이동 진입**이다 (`0x4BA7F` −2 → `0x16834`). */
  if (r && r.ok === false) {
    if (/하위 메뉴/.test(r.reason || '')) return Promise.resolve(this.cancel());
    return Promise.resolve({ ok: false, reason: r.reason });   /* 조회 전용 등은 그대로 무시 */
  }
  this._상태전이(MODE.RING_GATHER);
  if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
  return Promise.resolve(this.enterMove());
};

/* ══════════════════════════════════════════ 6. 명령 실행 */

/**
 * 필살기 한 종의 발동 방식 — tables.json `필살기발동` / `초필살기발동`.
 *
 * 원본 근거는 실행 함수 표 `0xF1474 + 슬롯*4` 를 전수 디스어셈블한 것입니다.
 * 표가 없으면 `TARGET_PICK`(확실성 미확정) 으로 둡니다 — 못 밝힌 걸 즉발로
 * 흘려보내면 비용만 나가고 아무 일도 안 일어나는 쪽이 되기 때문입니다.
 *
 * @param {object} cmd 링이 낸 `{ kind:'special', slot, ultimate }`
 */
Controller.prototype.activationOf = function (cmd) {
  var T = (this.battle && this.battle.T) || {};
  var slot = cmd && cmd.slot != null ? cmd.slot | 0 : -1;
  var ultimate = !!(cmd && cmd.ultimate) || slot < 0;
  var rows, idx;
  if (ultimate) {
    rows = T['초필살기발동'];
    var Ru = root.Rules;
    var u = this.session && this.session.actor;
    /* [리마스터] (캐릭터, 무기) 짝 초필살기 — combat.ultimateIndexOf 한 곳에서 (무기 포함 · 폭풍검) */
    var Cb초 = root.G2Combat;
    idx = (Cb초 && Cb초.ultimateIndexOf && u) ? Cb초.ultimateIndexOf(this.battle, u) : ((Ru && u) ? Ru.ultimateOf(u.charCode | 0) : -1);
  } else {
    rows = T['필살기발동'];
    idx = slot;
  }
  var row = (rows && idx >= 0 && rows[idx]) || null;
  if (!row && ultimate && idx >= 0 && root.Rules && root.Rules.ultimateRow) row = root.Rules.ultimateRow(idx, T);   /* [리마스터] 13~ */
  if (!row) {
    var out = {}; for (var k in ACT_UNKNOWN) out[k] = ACT_UNKNOWN[k];
    out.슬롯 = slot; out.초필살기 = ultimate;
    return out;
  }
  return row;
};

/**
 * `IMMEDIATE` · `FRONT_AUTO` — 선택 화면 없이 곧장 실행기로.
 *
 * ★★ **대상이 없을 때의 취소는 여기서 하지 않는다.**
 *
 *   예전에는 `FRONT_AUTO` 만 여기서 미리 걸러 `MODE.RING_IDLE` 로 세워 뒀다.
 *   그런데 그건 **모드만 바꾸고 링을 다시 그리지 않아** 필살기 하위 메뉴가 그대로
 *   남았다 — 사용자 지적 2026-08-14: 「**정면에 대상이 없습니다**」 만 뜨고
 *   「그대로 필살기 링커맨드에 있는 게 아니라 **우클릭으로 초기 링커맨드로
 *   돌아가듯이** 진행되는 거야.」
 *
 *   이제 판정은 `combat.special` 한 자리에서만 한다(링·AI·이벤트 공통).
 *   여기서는 그냥 실행기를 부르고, `_실행뒤` 이 `rep.cancelled` 를 보고
 *   `resumeRing` 으로 **초기 링**에 되돌린다.
 */
Controller.prototype.runAutoSpecial = function (cmd, act) {
  var self = this, actor = this.session.actor;
  this._상태전이(MODE.SPECIAL_PREPARE, act.발동);
  this._상태전이(MODE.SPECIAL_COMMIT, act.발동);
  var intent = { actor: actor, command: 'special', slot: cmd.slot | 0,
                 ultimate: !!cmd.ultimate };
  var res = Xc().commit(this.battle, intent, { rng: this.svc.rng });
  res.activation = act.발동;
  this.svc.onEvent(res);
  if (res.todo) this.msg('아직 안 만든 기술입니다 — ' + (res.reason || 'special'));
  return this._실행뒤(res, 'special', intent).then(function (r) {
    if (r && typeof r === 'object') r.activation = act.발동;
    return r;
  }).catch(function (e) { self.msg(String(e)); throw e; });
};

/** `0x1D124` 가 모으는 정면 대상 — 있으면 발동, 없으면 취소처럼 끝납니다. */
Controller.prototype.frontTargets = function (cmd) {
  var C = Cb(), b = this.battle, u = this.session.actor;
  if (!C) return [];
  /* 초필살기(부동명왕검·무신멸뢰옥)도 무기 사거리로 정면을 봅니다 — combat.special 과 같은 attackCells */
  var cells = (cmd && cmd.ultimate)
    ? (C.rangeOf(b, u, 'attack') || [])
    : (C.rangeOf(b, u, 'special', cmd.slot | 0) || []);
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var t = cells[i].unit;
    if (t && t.alive && t !== u && C.hostile(u.side, t.side, b.confuse) &&
        out.indexOf(t) < 0) out.push(t);
  }
  return out;
};

/** 통상 공격 전용 정면 대상. 링 표시와 실행이 같은 `rangeOf('attack')` 결과를 씁니다. */
/**
 * AI 통상 공격의 대상들 — 플레이어 정면 공격(frontAttackTargets · 0x1D3EF)과 같은 모으기.
 *   원본 AI 0x40210 은 플레이어 링 0x4D45E 와 같은 0x1F738 을 부르므로 범위 무기(마장기 폭 2 직선 등)는 범위 안 적 전부를 친다.
 *   ☠ 전에는 [고른 대상] 하나만 넘겨 마장기를 AI 로 두면 한 명만 쳤다 (2026-10-02 사장님 「마장기 ai지정시 기본공격이 범위를 공격하는게 아니라 1인만 공격하는 문제도 있어보여」)
 *   활(5)·마장기 원거리(0xB·0xC)·마법사 원거리는 플레이어도 칸 하나를 고르므로 고른 대상 하나 그대로.
 */
Controller.prototype._AI정면대상 = function (unit, tgt) {
  var C = Cb(), b = this.battle;
  if (!C || !unit || !tgt) return [tgt];
  var wt = C.weaponTypeOf(b, unit) | 0;
  /* 무기 0xF(갤리·보우 화살)·0x13 도 대상 하나 — AI 0x40C94 cmp 5 / 0xF / 0x13 → 0x40CB1 대상만 0x1A1F8 등록 (2026-10-11 사장님 「화살 … 범위내 전부 맞아」) */
  if (wt === 5 || wt === 0xF || wt === 0x13 || wt === 0xB || wt === 0xC || (C.isMageWeapon && C.isMageWeapon(wt))) return [tgt];
  var 목 = (C.rangeOf(b, unit, 'attack') || []).filter(function (c) {
    return c.unit && c.unit.alive && c.unit !== unit && C.hostile(unit.side, c.unit.side, b.confuse);
  }).sort(function (a, z) {
    return (Math.abs(a.x - unit.x) + Math.abs(a.y - unit.y)) - (Math.abs(z.x - unit.x) + Math.abs(z.y - unit.y));
  }).map(function (c) { return c.unit; });
  if (목.indexOf(tgt) < 0) return [tgt];          /* 고른 대상이 범위에 없으면(반격 등 특수) 예전 그대로 */
  return 목.filter(function (u, i) { return 목.indexOf(u) === i; });
};

Controller.prototype.frontAttackTargets = function () {
  var C = Cb(), b = this.battle, u = this.session && this.session.actor;
  if (!C || !u) return [];
  return (C.rangeOf(b, u, 'attack') || []).filter(function (c) {
    return c.unit && c.unit.alive && c.unit !== u &&
           C.hostile(u.side, c.unit.side, b.confuse);
  }).sort(function (a, z) {
    var da = Math.abs(a.x - u.x) + Math.abs(a.y - u.y);
    var dz = Math.abs(z.x - u.x) + Math.abs(z.y - u.y);
    return da - dz;
  }).map(function (c) { return c.unit; });
};

/**
 * 링에서 나온 명령을 굴립니다.
 * 대상이 필요한 것은 선택기로 넘기고, 나머지는 곧장 실행기로 갑니다.
 */
/**
 * ★★★★★ **활 당기는 모션 32틱** — 대상 커서를 열기 **전에** 온다 (2026-09-03)
 *
 * ```asm
 * 0x2EFD0  eax = 0x20(32) · 0x2EFD5 call 0x1033B   ; 간격 32 틱
 * 0x2EFDA  [esi+0x64] = 5                          ; 모션 5 — 활을 당긴다
 * 0x2EFDE  call 0x45559 · 0x2EFE3 call 0x499E4     ; 한 프레임 = 32 틱 (182 ms)
 * 0x2EFE8  [esi+0x64] = 6                          ; 모션 6 — 당긴 채로 멈춘다
 * ```
 *
 * **두 자리에 있다.**
 *
 * | 어디 | 조건 | 근거 |
 * |---|---|---|
 * | 필살기 **활 살(15)·활 연(16)** | 그 슬롯이면 언제나 | `0x2FA38`·`0x2FA54` 가 `0x2EF4A` 를 부른다 (호출부 **둘뿐**) |
 * | **일반 공격 대상 커서** `0x1F19C` | `0x1F1FA call 0x1F179` 이 **0** 일 때 | `0x1F1FF test ax,ax · jne 0x1F225` |
 *
 * 그 `0x1F179` 를 뜯으니 **직업만 본다** —
 * ```asm
 * 0x1F17A  dl = [eax+0x11]                         ; 직업
 * 0x1F17D  cmp dl,0x15 · 0x1F182 0x16 · 0x1F187 0x17 · 0x1F18C 0x18
 * 0x1F191  je → xor eax,eax  (0 = 활 계열)         ; Archer · Hunter · Eagle · Sniper
 * 0x1F195  else eax = 1
 * ```
 * ⇒ **직업 `0x15`~`0x18` 이면 활 당김을 한다.** 무기 종류는 안 본다.
 *
 * @returns {Promise|null} 당길 것이 있으면 Promise, 없으면 `null`
 */
Controller.prototype._활당기기 = function (actor, 표) {
  if (!actor || !this.svc || !this.svc.wait) return null;
  if (this._활당김 === 표) return null;                      /* 이미 당겼다 */
  this._활당김 = 표;
  var _자 = this;
  /* ★ 활 살(15) — 0x2FA23 0x2D684(살 도막)가 활 당기기(0x2EF4A)보다 먼저다 (2026-09-26) */
  if (표 === 'special:15' && typeof root.__활살앞 === 'function') {
    var _활표 = 표;
    return Promise.resolve(root.__활살앞(actor)).then(function () { _자._활당김 = null; return _자._활직업(actor) ? _자._활당기기(actor, _활표 + ':당김') : null; })
      .then(function () { _자._활당김 = _활표; });
  }
  actor.motion = 5;                                          /* 0x2EFDA */
  try { if (this.svc.updateUnit) this.svc.updateUnit(actor); } catch (e활1) {}
  var _틱ms = (root.G2Anim && root.G2Anim.TICK_MS) || (1000 / 175.47);
  /* ★ 틱 → ms 는 **0 쪽으로 자른다** (`정수나눗셈_반올림_점검.test.js`) */
  return Promise.resolve(this.svc.wait((32 * _틱ms) | 0))     /* 0x2EFD0 = 32 */
    .then(function () {
      actor.motion = 6;                                      /* 0x2EFE8 */
      try { if (_자.svc.updateUnit) _자.svc.updateUnit(actor); } catch (e활2) {}
    });
};

/** 직업이 활 계열인가 — `0x1F179` (0x15 Archer · 0x16 Hunter · 0x17 Eagle · 0x18 Sniper) */
Controller.prototype._활직업 = function (u) {
  /* ★ 정본은 `u.job` 이다 (`battle_main.js:3461 var job = (a.job | 0)` 와 같은 자리).
   *   ☠ 처음에 `_원본[0x11]` 을 앞세웠는데, 탈것에 탄 유닛은 `_riderSnapshot` 쪽이라
   *     `_원본` 이 실제 직업과 어긋날 수 있다. */
  var job = (u && u.job != null) ? (u.job | 0) : -1;
  return job >= 0x15 && job <= 0x18;                          /* 0x1F17D ~ 0x1F18F */
};

/* ☠★★★★★ **문구가 «끝나고 나서» 링을 연다** (2026-09-20 · 사장님 지적)
 *
 *   > 「tp 부족시 **no tp 메세지는 나오는데, 바로 링커맨드로 복귀해서 메세지가 가려져.**
 *   >  원작은 **메세지가 나왔다가 사라지고 나서** 링커맨드로 복귀해」
 *
 *   ★ 원본 `0x48612` 는 **막는 함수**다 —
 *     `0x48620 eax=3 call 0x1033B`(간격 3틱) → `0x48652`~`0x4867D cmp si,0x24`
 *     로 **36프레임을 돌고 나서** 반환한다 (≈ 615 ms). 그 뒤에야 `0x4D442` 가
 *     −2 를 내어 **링이 다시 열린다.**
 *   ☠ 우리는 `unitMsg()` 가 돌려주는 프라미스(36프레임이 끝나면 풀린다 —
 *     `render.js:5632`)를 **버리고** 곧바로 `resumeRing()` 을 불렀다.
 *     그래서 링이 문구 위에 곧바로 덮였다.
 *   ⇒ 프라미스를 **기다렸다가** 링을 연다. 창구가 없으면(`msg()` 물러섬) 하던 대로. */
function 문구뒤에(자, 문구프라미스, 이어서) {
  if (문구프라미스 && typeof 문구프라미스.then === 'function')
    return Promise.resolve(문구프라미스).then(이어서, 이어서);
  return 이어서();
}

/* 마법 선행 거부 — 대상 선택 전 `0x4C605`, 문구 `0x48612`, 비용 0 링 복귀. */
Controller.prototype._마법선행거부 = function (cmd) {
  var gate = (cmd.gate !== undefined)
    ? cmd.gate
    : (root.G2Ring && root.G2Ring.magicGate
         ? root.G2Ring.magicGate(this.battle, this.session.actor, cmd.spell | 0)
         : null);
  if (!gate) return null;
  var _문구p = null;
  if (this.svc.unitMsg && this.session && this.session.actor)
    _문구p = this.svc.unitMsg(this.session.actor, gate);            /* 0x48612 */
  else this.msg(gate);
  this.svc.onEvent({ type: 'magic_reject', actor: this.session.actor,
                     spell: cmd.spell | 0, reason: gate });
  this._상태전이(MODE.RING_IDLE, gate);
  var _자거부 = this;
  return 문구뒤에(this, _문구p, function () { return _자거부.resumeRing(gate); });
};

/* 필살기 TP 선행 거부 — 대상 선택 전 `0x4C9BD`, 비용 0 링 복귀. */
Controller.prototype._필살선행거부 = function (cmd) {
  var gate = (root.G2Ring && root.G2Ring.specialGate)
    ? root.G2Ring.specialGate(this.battle, this.session.actor, cmd) : null;
  if (!gate) return null;
  var _문구p2 = null;
  if (this.svc.unitMsg && this.session && this.session.actor)
    _문구p2 = this.svc.unitMsg(this.session.actor, gate);           /* 0x48612 */
  else this.msg(gate);
  this.svc.onEvent({ type: 'special_reject', actor: this.session.actor,
                     slot: cmd.slot | 0, ultimate: !!cmd.ultimate, reason: gate });
  this._상태전이(MODE.RING_IDLE, gate);
  var _자거부2 = this;
  return 문구뒤에(this, _문구p2, function () { return _자거부2.resumeRing(gate); });
};

/* 돌진·워프·승하차의 공통 칸 선택기 `0x4A483` 준비. */
Controller.prototype._스킬대상열기 = function (cmd) {
  this._상태전이(MODE.TARGET_RANGE_BUILD, 'skill');
  var 인자 = { skill: cmd.skill | 0, level: cmd.level | 0 };
  var actor = this.session.actor;
  var 탑승중 = !!(actor._riderSnapshot || (actor.rider && ((actor.gear || {}).mount | 0)));
  var 열린것 = this.selector.open(this.battle, actor, {
    kind: 'skill', arg: 인자,
    relation: (cmd.skill | 0) === 0 && !탑승중 ? 'other' : 'empty',
    allowEmpty: (cmd.skill | 0) !== 0 || 탑승중,
    빈범위열기: (cmd.skill | 0) === 15 || (cmd.skill | 0) === 8,   /* 0x3C8EE · 0x3C03C — 표시 0 이어도 선택기 (우클릭으로 링) */
    returnState: MODE.RING_IDLE
  });
  if (!열린것.ok) {
    this.msg(열린것.reason);
    this._상태전이(MODE.RING_IDLE, '스킬 사거리 없음');
    /* ★ 링을 다시 띄운다 — 다른 거부(_마법선행거부·_필살선행거부)와 같다. ☠ 전엔 상태만 바꿔 링 없이 멈췄다 (2026-10-10) */
    var _자스 = this;
    return Promise.resolve(_자스.resumeRing('스킬 사거리 없음')).then(function () { return { ok: false, reason: 열린것.reason }; });
  }
  this.pendingCommand = cmd;
  /* 돌진 `0x3C8DF`·워프 `0x3C03C`는 모드 1, 승하차 `0x3B84E/0x3B6EF`는 0. */
  this.rangeContext = {
    kind: 'skill', cells: this.selector.highlight(),
    pickMode: ((cmd.skill | 0) === 15 || (cmd.skill | 0) === 8) ? 1 : 0
  };
  this._상태전이(MODE.TARGET_SELECT, 'skill');
  return Promise.resolve({ ok: true, targets: 열린것.count });
};

/* 원거리 통상 공격 대상 선택기. 활 직업의 `0x1F1FA` 준비 모션과
 * 마장기 원거리 `0x1F466`의 앞 2칸 커서 규칙을 함께 소유한다. */
Controller.prototype._원거리공격대상열기 = function (cmd, actor, 무기종류) {
  if (this._활직업(actor)) {
    var self = this;
    var 당김 = this._활당기기(actor, 'attack');
    if (당김) return 당김.then(function () { return self.runCommand(cmd); });
  }
  this._상태전이(MODE.TARGET_RANGE_BUILD, 'attack');
  /* ★ 무기 0x11·0x12(배 대포 등) — 칸을 고르면 그 칸 중심 십자를 보여 주고 한 번 더 눌러 쏜다 (2026-10-10 원본 직독)
   *   0x1F784~0x1F859: 0x1CC09 범위 → 0x1F19C 칸 고르기(빈 칸도 된다 · 0x13CBD 범위 안이면) → 0x1AC08 반경 1 십자 칠하기·대상 등록
   *   → 0x4A815 확인(좌클릭·Enter 쏨 / 우클릭·Esc 다시 고르기 · 십자 안에 적이 없어도 다시 고르기)
   *   (사장님 「원작에서 공격시 바로 발사가 아니라 대상을 클릭하면 십자가 표시가 나왔던 것 같은데」 · 「원본대로 넣어줘」) */
  var _대포 = (무기종류 === 0x11 || 무기종류 === 0x12);
  var 열린것 = this.selector.open(this.battle, actor, {
    kind: 'attack', relation: 'hostile', allowEmpty: _대포,
    returnState: MODE.RING_IDLE,
    앞2칸: (무기종류 === 0xB || 무기종류 === 0xC)       /* 0x1F466 */
  });
  if (!열린것.ok) {
    this.msg(열린것.reason);
    this._상태전이(MODE.RING_IDLE, '원거리 사거리 없음');
    return Promise.resolve({ ok: false, reason: 열린것.reason });
  }
  this.pendingCommand = cmd;
  this.rangeContext = { kind: 'attack', cells: this.selector.highlight(), 대포십자: _대포 };
  /* ★ 대포 칸 고르기는 «칸 우선» — 0x1F19C 는 0x49E4E(ecx=0)·0x49EEE(칸 사각형)만 쓰고 유닛 그림 판정 0x49FE1 이 없다 (2026-10-11)
   *   ☠ 전엔 배 그림이 빈 바다 칸을 덮으면 누른 자리가 그 배의 칸으로 바뀌어(범위 밖) 고르기가 «될 때도 안 될 때도» 있었다
   *   (사장님 「제자리에서도 직선범위내 적이 없으면(위 아래에만 있으면) 타겟 지정이 안돼」 · 「이상해 될때가 있고 안될때가 있어」) */
  if (_대포) this.rangeContext.pickMode = 0;
  this._상태전이(MODE.TARGET_SELECT, '원거리 대상 선택');
  return Promise.resolve({ ok: true, targets: 열린것.count, targetSelect: true });
};

/* 정면 범위의 통상 공격 실행. `0x1D3EF`가 모은 대상 전부를 보존하고,
 * S3(`0x1DE15`) 뒤 실행 및 사망 확정 뒤 알림 순서를 소유한다. */
Controller.prototype._정면통상공격실행 = function (actor, targets) {
  if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
  this._상태전이(MODE.ATTACK_COMMIT);
  var intent = { actor: actor, command: 'attack', targetUnits: targets.slice(), 플레이어공격: true };   /* 플레이어공격 — 군단 근접 병종 연속 공격(_군단연타 · 0x1F8EC) */
  var self = this;
  return this._통상공격S3(intent).then(function (result) {
    if (!result.ok) {
      self.msg('공격 실패: ' + (result.reason || '알 수 없는 오류'));
      self._상태전이(MODE.RING_IDLE, '공격 실패');
      return result;
    }
    if (!result.후처리보류) self.svc.onEvent(result);
    return self._실행뒤(result, 'attack', intent);
  });
};

/** 링이 확정한 명령을 종류별 실행 경계에 전달한다. */
Controller.prototype.runCommand = function (cmd) {
  var self = this;
  var kind = cmd && cmd.kind;

  /* ★ 링에서 명령을 고르는 순간 **링 범위 표시(`0x1CC09`)를 걷는다.**
   *   원본 A-5 도 `0x4B9D7`(링 모으기) 뒤에 `0x4D442`(명령 분기)로 가므로
   *   링과 함께 사라진다.
   *   사용자 지적 2026-08-14: 「**공격 범위(1칸) 표시가 왜 초필살기에 나와.**」
   *   — `runAutoSpecial`(`IMMEDIATE`·`FRONT_AUTO`)은 대상 선택을 안 거쳐
   *   `rangeContext` 를 새로 안 세우는데, 링에서 칠한 것이 그대로 남아 있었다.
   *   대상 선택으로 가는 명령들은 아래에서 각자 다시 세운다. */
  if (this.rangeContext && this.rangeContext.ring) this.rangeContext = null;

  /* 통상 공격: 근접 무기는 정면 대상을 즉시 공격하지만 **원거리는 사거리 판을
   * 연 뒤 적 한 명을 직접 고릅니다.**
   *   wt 5 (궁) — 원본 그대로 (`0x1AEF3` 사거리)
   *   wt 2 (지팡이·마법) — [리마스터] 마법사 평타. 사용자 지적 2026-08-14
   *     「지금은 해당 범위 전체에 데미지가 들어가는 느낌이야. **타겟 지정해서
   *     선택**해야 공격할 수 있어야 해.」 — 활과 같은 창구를 타야 합니다. */
  if (kind === 'attack') {
    var actor0 = this.session.actor;
    var wt0 = Cb().weaponTypeOf(this.battle, actor0) | 0;
    /* ★ 무기 2 는 토글이 켜져 있을 때만 「대상 선택」 경로를 탄다 (위 `ringAttackRange` 와 한 쌍).
     *   꺼져 있으면 정면 1칸이므로 근접과 똑같이 곧바로 친다. */
    /* ★★★★★ **마장기 원거리(`0xB`·`0xC`)도 대상 선택기를 탄다** — 0x1F87E (2026-09-01)
     *
     *   원본이 무기로 갈래를 나눈다:
     *   ```asm
     *   0x1F87E  cmp al, 0x0B / je  0x1F886
     *   0x1F882  cmp al, 0x0C / jne 0x1F89C      ; ★ 0xB·0xC 만 아래로
     *   0x1F886  eax = esi ; call 0x1CC09        ;   범위 칠하기
     *   0x1F88D  eax = esi ; call 0x1F466        ; ★ 전용 선택기 (커서를 앞 2 칸에)
     *   ```
     *   사거리는 이미 맞다 — `combat.js:495 wt === 0xB → diamond(…, 9)`(`0x1D389`).
     *   빠진 것은 **대상 선택기를 타는 것**과 **커서 시작 칸**뿐이었다. */
    /* ★ 무기 0xF·0x11·0x12·0x13(배·탈것 무기)도 대상 고르기 — 0x1F75E cmp al,5 / 0xF / 0x11 / 0x12 / 0x13 → 0x1F776 (0x10 은 아니다 · 2026-10-10) */
    if (wt0 === 5 || (Cb().isMageWeapon && Cb().isMageWeapon(wt0) && _마법사원거리켜짐())
        || wt0 === 0xB || wt0 === 0xC || wt0 === 0xF || wt0 === 0x11 || wt0 === 0x12 || wt0 === 0x13) {
      /* ★★★★★ **활 직업은 커서 전에 활을 당긴다** — `0x1F1FA call 0x1F179` (2026-09-03)
       *   `0x1F1FF test ax,ax · jne 0x1F225` 이라 **0 일 때만** 당긴다.
       *   `0x1F179` 는 **직업만** 본다 — `0x15`~`0x18`(Archer·Hunter·Eagle·Sniper).
       *   ☠ 무기 종류는 안 본다. 마장기 원거리(`0xB`·`0xC`)·마법사 평타는 **안 당긴다.** */
      return this._원거리공격대상열기(cmd, actor0, wt0);
    }
    var targets0 = this.frontAttackTargets();
    if (!targets0.length) {
      this.msg('정면에 공격할 적이 없습니다');
      this._상태전이(MODE.RING_IDLE, '정면 대상 없음');
      return Promise.resolve({ ok: false, reason: '정면에 공격할 적이 없습니다' });
    }
    return this._정면통상공격실행(actor0, targets0);
  }

  /* 11 스테이터스 — 링 문맥을 그대로 두고 창만 엽니다 (§29-9) */
  if (kind === 'status') {
    this._statusReturn = 'ring';
    this.openStatus(this.session.actor);
    return Promise.resolve({ ok: true, status: true });
  }

  /* ★ 마법 — 0x4C605 의 1~3 단계는 **대상 선택 전에** 끝납니다.
   *   틀린 조합 / TP 부족 / MP 부족이면 원본 문구를 띄우고 비용 0 으로 링을 다시 엽니다
   *   (0x4D4CB 이 언제나 0 을 반환하므로 링 재개). 예전에는 그냥 취소로 삼켰습니다. */
  if (kind === 'magic') {
    var 마법거부 = this._마법선행거부(cmd);
    if (마법거부) return 마법거부;
  }

  /* AI 좌표 설정 0x4CE1F — 맵에서 칸 하나를 고릅니다 */
  if (kind === 'aiCoord') return Promise.resolve(this.openAiCoord());

  /* 필살기·초필살기 — 슬롯별 발동 방식이 먼저입니다 (§59·§60) */
  this.lastActivation = null;
  if (kind === 'special') {
    /* ★★★★★ **TP 는 대상을 고르기 «전»에 본다** — `0x4C9BD` (2026-09-10)
     *
     *   > 사장님: 「tp가 부족하면 **no tp 문구가 잠시 뜨고** 초필살기는 발동이 안되고
     *   >  **tp소모 없이 메인 링커맨드로 복귀**해야하는데, 지금은 **턴이 종료**되어버려.」
     *
     *   ☠ 게이트가 마법에만 있었다. 필살기는 대상을 다 고른 뒤 `combat.special()`
     *     안에서야 TP 를 봤고, 거기서 **차징**(`0x4007B` — AI 전용)으로 빠져
     *     `u.tp = 0` 이 되며 턴을 썼다.
     *   ★ 원본은 `0x4C9BF jge` 로 «먼저» 걸러 "No TP!" 를 띄우고 **비용 0** 으로 돌아가며,
     *     `0x4D442` 가 언제나 −2 를 내므로 **링이 다시 열린다**. 마법 게이트와 같은 꼴이다. */
    var 필살거부 = this._필살선행거부(cmd);
    if (필살거부) return 필살거부;
    var act = this.activationOf(cmd);
    this.lastActivation = act;
    if (act.발동 !== ACT.TARGET_PICK) return this.runAutoSpecial(cmd, act);
  }

  /* 돌진·워프·승하차는 스킬 함수 안에서 공통 칸 선택기(0x4A483)를 엽니다.
   * 현재 구현 단계에서는 빈 칸을 고르는 돌진·워프부터 원본 경로로 연결합니다. */
  if (kind === 'skill' && ((cmd.skill | 0) === 15 || (cmd.skill | 0) === 8 || (cmd.skill | 0) === 0)) {
    return this._스킬대상열기(cmd);
  }

  /* ★★★★★ **활 계열 필살기는 커서를 열기 전에 「활 당기는 모션」이 있다** (2026-09-03)
   *
   *   ```asm
   *   0x2EFD0  eax = 0x20(32) · 0x2EFD5 call 0x1033B   ; 간격 32 틱
   *   0x2EFDA  [esi+0x64] = 5                          ; ★ 모션 5 — 활을 당긴다
   *   0x2EFDE  call 0x45559 · 0x2EFE3 call 0x499E4     ; ★ 한 프레임 = 32 틱 (182 ms)
   *   0x2EFE8  [esi+0x64] = 6                          ; ★ 모션 6 — 당긴 채로 멈춘다
   *   0x2F003  0x1A1DE · 0x2F01A 0x1B7BF · 0x2F040 0x1B7FA   ; 사거리·부채 칠하기
   *   0x2F04C  call 0x1F19C                            ; ★ **그제서야** 대상 커서
   *   ```
   *   ⇒ 「고름 → 활 당김 32 틱 → 사거리 → 커서」 순서다. 우리는 커서를 바로 열었다.
   *
   *   ★ **어느 슬롯인가**는 호출부 전수로 못박았다 —
   *     `0x2EF4A`(원거리 공통)를 부르는 자리는 **둘뿐**이고
   *     `0x2FA38`(슬롯 15 활 살) · `0x2FA54`(슬롯 16 활 연) 다.
   *     ☠ 문서가 「`0x1F209`(활 심)도 같은 구조」라 했는데, `0x1F209` 는
   *       **함수 `0x1F19C`**(일반 공격 대상 커서) 안이다 — 활 심이 아니다.
   *
   *   한 번 돌고 나면 `_활당김` 에 표시를 남겨 다시 안 돈다 (`_상태전이` 가 링으로
   *   돌아갈 때 지운다). */
  /* ★ 직선 투척(검 비 3 · 창 투 9 · 권 장 21 → 0x2EB61)은 고르기 «전»에 카메라를 방향 앞 3칸으로 (0x2EB8C 0x200DE(3)) —
   *   원본 기록 필살_03_g3: 칸 고르기 때 카메라 2,11 → 2,14 (2026-09-26) */
  if (kind === 'special' && ((cmd.slot | 0) === 3 || (cmd.slot | 0) === 9 || (cmd.slot | 0) === 21) && this.svc.focus &&
      this._직선캠 !== 'special:' + (cmd.slot | 0)) {
    this._직선캠 = 'special:' + (cmd.slot | 0);
    var _직자 = this.session && this.session.actor, _자직 = this;
    if (_직자) {
      var _앞 = [[0, 1], [-1, 0], [0, -1], [1, 0]][(_직자.dir | 0) & 3];
      return Promise.resolve(this.svc.focus((_직자.x | 0) + _앞[0] * 3, (_직자.y | 0) + _앞[1] * 3))
        .then(function () { return _자직.runCommand(cmd); });
    }
  }
  var _활당김슬롯 = { 15: true, 16: true };                 /* 0x2FA38 · 0x2FA54 */
  /* ★ 커서 0x1F19C 는 «궁수일 때» 활을 당긴다 — 0x1F179 는 직업 0x15~0x18 이면 0 을 돌려주고(0x1F191), 0x1F202 jne 0x1F225 는 궁수가 아니면 건너뛴다
   *   (☠ 2026-09-26 한때 뜻을 거꾸로 읽어 «궁수가 아닐 때만»으로 바꿨다 — 원본 기록 필살_15·16: 쏘는 동안 시전자 모션 6) · 활 살의 살 도막(__활살앞)은 누구나 */
  if (kind === 'special' && _활당김슬롯[cmd.slot | 0] && ((cmd.slot | 0) === 15 || this._활직업(this.session && this.session.actor))) {
    var _자활 = this;
    var _p활 = this._활당기기(this.session && this.session.actor, 'special:' + (cmd.slot | 0));
    if (_p활) return _p활.then(function () { return _자활.runCommand(cmd); });
  }

  /* 대상이 필요한 명령 → TARGET_RANGE_BUILD */
  if (NEEDS_TARGET[kind]) {
    this._상태전이(MODE.TARGET_RANGE_BUILD, kind);
    /* 혼·비연참·화염인 계열은 **빈 칸**을 고릅니다 (0x2E3E4 의 0x11DB2 == 0). */
    var pickAct = (kind === 'special') ? this.lastActivation : null;
    var allowEmpty = !!(pickAct && pickAct.빈칸허용);
    /* ★ 마법 타게팅 — 스펠별 선택범위·대상관계 (마법_타게팅_사양.md). combat.magicTargeting 기술자.
     *   arg 에 {spell, rank} 를 넘겨 rangeOf 가 전방부채꼴/자기영역/전체맵 등 형태를 만든다. */
    var magRel = null, arg, magPick = null, pickAny = false;
    if (kind === 'magic') {
      arg = { spell: cmd.spell | 0, rank: cmd.rank != null ? cmd.rank | 0 : 0 };
      /* ★ 이름을 `Cb` 로 두면 안 됩니다 — 이 파일 32행의 접근자 `function Cb()` 를
       *   같은 함수 안에서 var 호이스팅이 통째로 가려, 위쪽 686행의 `Cb()` 가
       *   `undefined` 가 됩니다. 활(무기종류 5)을 든 유닛이 공격을 고르는 순간
       *   `Cb is not a function` 으로 죽던 원인입니다. */
      var Cmag = root.G2Combat;
      if (Cmag && Cmag.magicTargeting && Cmag.spellParts) {
        var mp = Cmag.spellParts(cmd.spell | 0), tg = Cmag.magicTargeting(mp.series, mp.level, mp.rank);
        magRel = { enemy: 'hostile', ally: 'friendly', empty: 'empty', dead: 'friendly', both: 'any', heal: 'heal' }[tg.relation] || 'hostile';
        if (tg.relation === 'empty' || tg.select === 'summon' || tg.select === 'reviveList') allowEmpty = true;
        /* ★★ **고르는 시스템과 효과가 닿는 시스템은 다르다** (사용자 확인 2026-08-15).
         *   `combat.magicPick` 이 **네 분류**로 가른다 — 근거는 그 함수 주석의 표.
         *     `'enemy'` 적군 1인   → 적 유닛을 고른다        (`0x28982` 모드 1)
         *     `'ally'`  아군 1인   → 아군 유닛을 고른다      (관계 판정 `0x1201D` 만 다름)
         *     `'field'` 필드(타일) → 사거리 안 **아무 칸**   (`0x28A1F xor ecx,ecx`)
         *     `'none'`  필요 없음  → 효과 범위만 보여 주고 아무 칸이나 누르면 발동
         *
         *   `'field'`·`'none'` 은 `pickAny` 로 연다. 이걸 안 해서 빈 칸이 `legal = false`
         *   가 됐고, 그래서 **필드 타게팅이 아예 안 되고** 광역 마법도 적을 찍어야만
         *   나갔다 (사용자 지적 2026-08-15). */
        magPick = Cmag.magicPick ? Cmag.magicPick(tg) : 'enemy';
        if (Cmag.magicPicksTile ? Cmag.magicPicksTile(magPick) : magPick !== 'enemy') {
          pickAny = true; allowEmpty = true;
        }
      }
    } else {
      arg = kind === 'special' ? (cmd.slot | 0) : null;
    }
    /* ★★★★★ **초필살기는 사거리를 「번호」로 잡는다** — `0x302E6` (2026-09-10)
     *
     *   > 사장님: 「초필살기 **타겟 지정 범위**도 문제가 있어. … **본인기준 특정 범위로
     *   >  발동**하는게 있고 다양한 형태가 있는데 제대로 적용이 안돼.」
     *
     *   ☠ 여기서 `arg = cmd.slot | 0` 를 주고 있었다. 초필살기는 `slot` 이 없으니
     *     `arg === 0` → `rangeOf(…, 'special', 0)` → **슬롯 0 필살기(연) 범위**가 떴다.
     *   ★ `kind` 를 `'ultimate'` 로 바꿔 `ultimatePickCells()` 로 보낸다 —
     *     비연참·풍아열공참 **방향 직선 7** · 화염인 **진행축 거리 3~6 네 칸**.
     *   ★ 확정 조건도 표대로 건다 (`칸조건` · `최소거리`) —
     *     `빈칸만` `0x30A6C 0x11DB2==0` · `적있는칸` `0x35814 0x1A1F8!=0` · `아무칸` `ecx=0` */
    var 초 = (kind === 'special' && !!cmd.ultimate && !!pickAct);
    var 고를kind = NEEDS_TARGET[kind];
    if (초) {
      고를kind = 'ultimate';
      var Ru초 = root.Rules, u초 = this.session.actor;
      arg = { index: (root.G2Combat && root.G2Combat.ultimateIndexOf && u초) ? root.G2Combat.ultimateIndexOf(this.battle, u초) : ((Ru초 && u초) ? Ru초.ultimateOf(u초.charCode | 0) : -1) };   /* [리마스터] 무기 포함 */
      var 칸조건 = pickAct['칸조건'];
      if (칸조건 === '빈칸만') { allowEmpty = true; pickAny = false; magRel = 'empty'; }
      else if (칸조건 === '적있는칸') { allowEmpty = false; pickAny = false; magRel = 'hostile'; }
      /* 화염인 — `0x39B6D ecx=0` 무제한. 칸은 아무거나 찍을 수 있고, 적이 있는지는
       *   `0x39C31` 이 **착탄 반경 2** 로 따로 본다 (`combat.needsFoe` → `대상요구`). */
      else if (칸조건 === '아무칸') { allowEmpty = true; pickAny = true; magRel = 'any'; }
    }
    /* ☠☠☠★★★★★ **칠할 칸이 0 인 마법을 «사거리 없음»으로 튕기면 안 된다** (2026-09-15)
     *
     *   > 사장님: 「리바이블 … **바로 시전되야하는데**, 전체 마법처럼 표시가 나와」
     *
     *   ☠ 리바이블·소울리콜은 `combat.js` 가 `select:'reviveList'` 를 **`cells = []`**
     *     로 낸다(원본 `0x59A70`·`0x2B1D0` 안에 칠하기 창구 `0x13D02` 가 한 번도 없다).
     *     그런데 `selector.open` 은 `if (!this.cells.length)` 면 **`ok:false
     *     「사거리가 없습니다」`** 로 돌아간다(`selector.js` 155). 그래서 아래
     *     「자기중심·바로 확인」 자리에 **닿지도 못하고** 링으로 되튕겼다 — 실측 확인.
     *   ★ 원본은 고를 것이 없는 마법을 `0x4A815` 로 **확인만** 받는다.
     *   ⇒ 칠할 칸이 0 이면 **시전자 칸 하나**를 선택기에 먹여 열리게만 한다.
     *     바로 아래 `magPick === 'none'` 갈래가 `cells` 를 **효과칸(=빈 배열)** 으로
     *     덮으므로 **화면에는 아무것도 안 칠해진다.** 좌클릭 한 번이면 시전된다. */
    var 빈칸대체 = null;
    if (kind === 'magic' && magPick === 'none') {
      var Cn = root.G2Combat, 칠할 = null;
      try { 칠할 = (Cn && Cn.rangeOf) ? Cn.rangeOf(this.battle, this.session.actor, 'magic', arg) : null; }
      catch (e칠) { 칠할 = null; }
      if (!칠할 || !칠할.length)
        빈칸대체 = [{ x: this.session.actor.x | 0, y: this.session.actor.y | 0 }];
    }
    var open = this.selector.open(this.battle, this.session.actor, {
      kind: 고를kind, arg: arg, cells: 빈칸대체 || undefined,
      relation: magRel || (allowEmpty ? 'empty' : 'hostile'), allowEmpty: allowEmpty,
      pickAny: pickAny,                       // 0x4A483 ecx = 0 (마법 착탄점 0x28A1F)
      /* ★ **최소거리** — 혼(5·10)·비연참은 거리 2 이상이어야 한다 (2026-08-30 · B-1)
       *   `0x2E3D0 cmp ax,2 / jl` · 비연참은 `0x30A58 cmp ax,2 / jl`
       *   — `0x49ADF`(맨해튼)으로 재고 미달이면 다시 고른다. */
      minRange: (pickAct && pickAct['최소거리']) | 0,        /* 0x2E3D0 · 0x30A58 */
      returnState: MODE.RING_IDLE
    });
    if (!open.ok) {
      this.msg(open.reason);
      this._상태전이(MODE.RING_IDLE, '사거리 없음');
      return Promise.resolve({ ok: false, reason: open.reason });
    }
    if (open.empty) this.msg(open.reason);       // 원본도 화면만 띄우고 취소를 기다립니다
    this.pendingCommand = cmd;
    this.rangeContext = { kind: kind, cells: this.selector.highlight() };
    /* ★ 빈 칸을 고르는 필살·초필살(비연참·혼…)은 유닛이 선 칸을 칠하지 않는다 (2026-09-27 · Z-98)
     *   원본은 고를 수 있는 칸(0x2E3E4 0x11DB2 == 0 인 칸)만 이동 배열에 써 0x1547F 가 칠한다 — 비연참 원본 8,21~24 4 칸 ↔ 우리 8,18~20 까지 7 칸
     *   (칸 아무거나인 화염인은 원본도 유닛 칸까지 칠해 그대로 둔다) */
    if (kind === 'special' && allowEmpty && !pickAny && this.rangeContext.cells)
      this.rangeContext.cells = this.rangeContext.cells.filter(function (c) { return !(c.unit && c.unit.alive !== false); });
    /* ★ 필살기·초필살기도 칸 선택기(0x4A483)면 그 모드를 싣는다 — 표 `커서모드`(0 무제한 · 1 제한)
     *   원본 칸 선택기는 좌표 → 칸만 하고 유닛 그림 판정(0x49FE1)이 없다. 모드가 없으면 입력이 유닛 그림을 먼저 잡아
     *   윗칸을 눌러도 아래 유닛이 잡혔다 (2026-09-26 원본 기록 칸 06: 풍아 고른 칸 8,18 → 우리 8,19) */
    if (kind !== 'magic' && pickAct && pickAct['커서모드'] != null) this.rangeContext.pickMode = pickAct['커서모드'] | 0;
    if (kind === 'magic') {
      /* ★ 마법 착탄점은 `0x28A21`(`0x28A1F xor ecx,ecx`) — **모드 0(무제한)**.
       *   돌진·워프(`mov ecx,1`)와 달리 유닛 칸에도 상자가 그대로 뜬다
       *   (`명령_공통대역.md` §4 표). 그동안 마법이 `pickMode` 를 안 싣고 있었다. */
      this.rangeContext.pickMode = 0;
      this.rangeContext.pick = magPick;          // 'unit' | 'tile' | 'self'
      this.rangeContext.spell = cmd.spell | 0;
      /* ★ **효과 영역은 선택 범위와 다른 도형이다.** 커서가 놓인 칸을 주면 실제로
       *   피해가 닿을 칸을 돌려준다 — 표시하는 쪽(`전투.html refresh`)이 쓴다.
       *   `'self'` 는 커서와 무관하게 시전자 기준이라 늘 같은 도형이다. */
      var Cm = root.G2Combat, bt = this.battle, ac = this.session.actor, sp = cmd.spell | 0;
      this.rangeContext.effectCells = (Cm && Cm.magicEffectCells)
        ? function (at) { return Cm.magicEffectCells(bt, ac, sp, at); }
        : null;

      /* ★★★ **자기중심·방향형·전체맵은 ① 이 없다** — 곧바로 ② 로 연다 (2026-08-16)
       *
       *   사용자 지적: 「본래 **6단계·7단계** 마법의 경우 **타겟 지정 영역이 없고
       *   자기 자리 기준으로 효과 영역만 보여주고 클릭 시 바로 시전**인데, 지금은
       *   타겟 지정 영역이 뜨고 거기에서 **지정한 칸 주변으로 효과 영역이 설정**되네.」
       *
       *   문서에 이미 그렇게 적혀 있었다 —
       *   `마법_타게팅_사양.md` 표: **광역** = 「캐릭터 주변 정해진 영역 표시
       *   (**선택 없이**)」 · §광역/자기영역: 「**대상/방향 재선택 없음.**
       *   확인(클릭/스페이스)하면 발동」.
       *   `상태전이_원본확정.md` 무기 종류 표: `0x10` → `0x1F8A0`
       *   「**선택 없음**, `[esp+0xC]=1` 로 바로 진행」.
       *   소환도 같다 — `0x29F4D` 에 칸 선택기 호출이 아예 없고 `0x29FC6 call 0x4A815`
       *   로 **확인만** 받는다.
       *
       *   ★ `combat.js` 는 이미 옳았다. `magicPick` 이 `'none'` 을 내고
       *     `magicEffectCells` 도 `pick === 'none'` 이면 **커서를 무시하고 시전자
       *     기준**으로 낸다. 어긋난 곳은 **여기 UI 뿐**이었다 — `magicPicksTile('none')`
       *     이 참이라 `pickAny` 로 열면서 **사거리(① 타겟 지정 영역)까지 칠했다.**
       *
       *   그래서 ①을 건너뛰고 처음부터 ② 상태로 둔다:
       *     · `잠금` = **시전자 칸** (커서가 거기 고정 — `hover`/`click` 이 이미 처리)
       *     · `cells` = 효과칸 (사거리 대신 **효과 범위**를 칠한다)
       *     · 좌클릭 → `handleClick` 의 `효과확인` 갈래로 곧바로 시전
       *     · 우클릭 → ①이 없으므로 **링으로** 되돌린다 (`자기중심` 플래그) */
      if (magPick === 'none' && this.rangeContext.effectCells) {
        var 자리 = { x: ac.x | 0, y: ac.y | 0 };
        var 칸들 = this.rangeContext.effectCells(자리) || [];
        /* ☠☠★★★★★ **효과칸이 «없어도» 자기중심으로 연다** (2026-09-15)
         *
         *   > 사장님: 「리바이블 판정 안바뀌었어. **바로 시전되야하는데, 전체 마법처럼
         *   >  표시가 나와**」
         *   > (2026-09-08 M18) 「리바이블 **범위 표시 없이 바로 발동**해야하는데,
         *   >  지금은 시전자 주변 2바퀴 범위 표시가 나와」
         *
         *   ☠ 여기 `if (칸들.length)` 가 있었다. 리바이블·소울리콜은 **칠하는 칸이
         *     하나도 없다** — `combat.js` 가 `select:'reviveList'` 를 `cells = []` 로
         *     내기 때문이다(원본 `0x59A70`·`0x2B1D0` 안에 칠하기 창구 `0x13D02` 가
         *     한 번도 없다). 그래서 이 `if` 를 못 타고, 위에서 `pickAny`·`allowEmpty`
         *     로 열어 둔 **일반 타겟 지정 상태가 그대로 남아** 「전체 마법처럼」 떴다.
         *   ⇒ `magicPick` 이 `'none'` 이면 칸이 0 이어도 **자기중심·바로 확인**으로 둔다.
         *     칠할 칸이 없으면 아무것도 안 칠해진다 — 그것이 바라는 그림이다. */
        this.rangeContext.자기중심 = true;     // ★ 우클릭이 ① 로 안 가게
        this.rangeContext.효과확인 = true;
        this.rangeContext.잠금 = 자리;
        this.rangeContext.효과칸 = 칸들;
        this.rangeContext.cells = 칸들;        // ★ 타겟 지정 영역을 안 칠한다 (빈 배열이면 아무것도 안 뜬다)
      }
    }
    /* ★ 2026-09-25 사장님 「리바이블 같은경우 대상이 없으면 바로 링커맨드로 복귀해야하는데 지금은 한번 클릭해야하는 문제」
     *   원본 리바이블 처리기 0x2BC3B 는 머리에서 사망자 명부가 비었으면 곧 나간다(0x2BC5C jne · 0x2BC63 jmp 0x2BDF1).
     *   ☠ (정정 2026-09-26) «사망자가 있을 때의 확인 클릭은 원본에도 있다»는 틀렸다 — 처리기 0x2BC3B~0x2BDF1 에 확인(0x4A815)도 대상 고르기(0x4A483)도 없다.
     *     흐름은 명부 검사 → 0x169D7(이동 배열 준비) → 앞 칸 → 0x28889 이름 외침 → 0x59A70 연출. 곧 룬을 고르면 **바로 시전**된다(아래).
     *   ⇒ 되살릴 사람이 없으면 확인을 띄우지 않고 곧바로 링으로 (판정은 combat.js 0x2B272 가드와 같은 잣대) */
    /* ★ 2026-09-26 소울리콜도 — 사장님 「리바이블이나 소울리콜 같은경우도 대상이 없으면 초기 링커맨드로 복귀해(별다른 클릭 없이 바로 복귀)」 */
    if (kind === 'magic' && typeof mp !== 'undefined' && mp && typeof tg !== 'undefined' && tg && tg.select === 'reviveList') {
      var C되 = root.G2Combat, 시전자되 = this.session.actor, 전되 = this.battle;
      var 죽은되 = ((전되 && 전되.units) || []).filter(function (q) {
        return q && !q.alive && !q.명부밖 && (((mp.series | 0) === 6 && (mp.level | 0) === 3) ||
               !(C되 && C되.hostile && C되.hostile(시전자되.side, q.side, 전되.confuse)));
      });
      if (!죽은되.length) {
        this.selector.cancel && this.selector.cancel();
        this.pendingCommand = null; this.rangeContext = null;
        /* 처음 링으로 — 시전 실패 길(아래 command==='magic' && ok===false)과 같이 링을 걷고 다시 편다 (2026-09-26 사장님 「초기 링커맨드로 복귀해」) */
        if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
        return Promise.resolve(this.resumeRing('되살릴 사람이 없다')).then(function () { return { ok: false, reason: '되살릴 사람이 없다' }; });
      }
      /* [리마스터 부활선택] 리바이블(계열 3 · 단계 5)만 — 되살릴 사람을 창에서 고른다 (2026-09-26 사장님 · Z-88)
       *   「리바이블같은 마법의 경우 부활 대상을 선택할 수 있게하면 좋겠어.(부활 목록을 표처럼 만들고 그중에 선택할 수 있도록 …
       *    월드 스테이터스 화면에서 캐릭터 목록같이 만들면 어떨까 싶어. 단 화면을 모두 가리지는 않게 창처럼 띄우는게 좋을 것 같고)」
       *   원작은 창 없이 명부 머리(가장 먼저 죽은 사람 · 0x137E7)를 되살린다 — 옵션 `부활선택` 이 '원작' 이면 그대로.
       *   목록 차례도 명부 차례(죽은 차례)다. 소울리콜은 원본이 무작위로 뽑으므로(0x13838) 넣지 않는다. */
      var 옵되 = root.Opt && root.Opt.cfg;
      if ((mp.series | 0) === 3 && (mp.level | 0) === 5 && 옵되 && 옵되['부활선택'] === '리마스터' &&
          typeof this.svc.부활선택창 === 'function' && this.pendingCommand && !this.pendingCommand.부활대상) {
        var self되 = this, 명령되 = this.pendingCommand;
        var 줄되 = 죽은되.map(function (q, k) { return { q: q, k: k }; }).sort(function (a, b) {
          var ca = (a.q.죽은차례 == null) ? 0 : (a.q.죽은차례 | 0), cb = (b.q.죽은차례 == null) ? 0 : (b.q.죽은차례 | 0);
          return (ca - cb) || (a.k - b.k);
        }).map(function (e) { return e.q; });
        /* ★ 창이 떠 있는 동안 «대상 고르기» 상태로 기다린다 — 범위 만들기(TARGET_RANGE_BUILD)에 머물면 본 루프가 행동이 끝난 줄 알고 라운드를 돌렸다(실측) */
        this._상태전이(MODE.TARGET_SELECT, kind);
        return Promise.resolve(this.svc.부활선택창(줄되, 시전자되)).then(function (고른) {
          if (!고른 || self되.pendingCommand !== 명령되) return self되.cancel();   /* 우클릭·ESC — 대상 고르기 취소와 같은 길 */
          명령되.부활대상 = 고른;
          return self되.click(null, null);
        });
      }
      /* ★ 되살릴 사람이 있으면 확인 클릭 없이 곧바로 시전 — 원본 0x2BC3B 에 확인이 없다 (2026-09-26 사장님 「리바이블 사용하면 바로 시전되어야하는데 지금은 한번 클릭하게 나와」)
       *   자기중심·효과확인 상태(위)를 세운 뒤 그 확인 클릭을 여기서 대신 부른다 */
      if (this.rangeContext && this.rangeContext.효과확인 && this.rangeContext.잠금) {
        this._상태전이(MODE.TARGET_SELECT, kind);
        return this.click(null, null);
      }
    }
    /* ★ 2026-09-26 소환 — 세울 빈 칸이 하나도 없으면 확인 없이 곧바로 링으로
     *   (사장님 「소환도 그래야할 것 같아. 소환할 수 없는 상황에서는 그렇게 되어야 해」 · 판정은 combat.js 소환자리있나 = cast 소환 갈래와 같은 잣대) */
    if (kind === 'magic' && typeof tg !== 'undefined' && tg && tg.select === 'summon' && root.G2Combat && root.G2Combat.소환자리있나 &&
        !root.G2Combat.소환자리있나(this.battle, this.session.actor, cmd.spell | 0)) {
      this.selector.cancel && this.selector.cancel();
      this.pendingCommand = null; this.rangeContext = null;
      if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
      return Promise.resolve(this.resumeRing('소환할 자리가 없다')).then(function () { return { ok: false, reason: '소환할 자리가 없다' }; });
    }
    this._상태전이(MODE.TARGET_SELECT, kind);
    return Promise.resolve({ ok: true, targets: this.selector.targets.length });
  }

  /* 그 밖 — 곧장 실행 */
  var command = CMD_MAP[kind];
  if (!command) { this._상태전이(MODE.RING_IDLE); return Promise.resolve({ ok: false, reason: '미지원 명령 ' + kind }); }

  var pre = { defend: MODE.DEFEND_COMMIT, guard: MODE.GUARD_COMMIT,
              focus: MODE.FOCUS_COMMIT, rest: MODE.ITEM_OR_WAIT,
              skill: MODE.SKILL_COMMIT, ai: MODE.AI_MENU }[command];
  if (pre) this._상태전이(pre);

  /* [리마스터 조련소환] 조련(스킬 4) — 해금된 몬스터 목록 창(리바이블 창과 같은 창)에서 고른 뒤 부른다 (2026-10-11)
   *   사장님(원문) 「지금 리바이블 창처럼 몬스터 목록을 띄우고 그중에 선택 가능하면 좋겠어. 각각의 몬스터는 레벨에 따라 해금되고.」
   *   우클릭·ESC 면 취소(링으로) · '원작' 이면 창 없이 원본 조련 */
  var 옵조 = root.Opt && root.Opt.cfg;
  if (command === 'skill' && (cmd.skill | 0) === 4 && 옵조 && 옵조['조련소환'] === '리마스터' &&
      typeof this.svc.부활선택창 === 'function' && cmd.조련고름 == null && Cb().조련목록) {
    var self조 = this, 목조 = Cb().조련목록(this.session.actor).map(function (e) {
      return { name: e.name, sprIndex: e.sprIndex, job: e.job, level: e.level, 칸: e.칸, 전투그림: true, _raw: e.기록 };
    });
    if (!목조.length) { this.msg('부를 수 있는 몬스터가 없습니다'); this._상태전이(MODE.RING_IDLE); return Promise.resolve({ ok: false, reason: '해금된 몬스터 없음' }); }
    this._상태전이(MODE.TARGET_SELECT, 'skill');
    return Promise.resolve(this.svc.부활선택창(목조, this.session.actor)).then(function (고른) {
      if (!고른) return self조.cancel();
      cmd.조련고름 = 고른.칸 | 0;
      return self조.runCommand(cmd);
    });
  }
  /* [리마스터 조련소환] 몬스터를 고른 뒤 — 세울 자리 후보를 칠해 보여 주고 눌러 확인받는다(마법 소환 0x29F4D → 0x4A815 와 같이 «정해진 자리»)
   *   보통 몸 = 정면 칸 · 큰 몸 = 마법 대형 소환 자리 · 우클릭·ESC 면 링으로 (2026-11-15 사장님 「테이머 소환 큰 몬스터 문제 있어. 소환마법처럼 자리를 지정해서 나와야하는데 자리가 애매해.」 · 정본 208) */
  if (command === 'skill' && (cmd.skill | 0) === 4 && 옵조 && 옵조['조련소환'] === '리마스터' &&
      cmd.조련고름 != null && Cb().조련후보칸) {
    var 조후보 = Cb().조련후보칸(this.battle, this.session.actor, cmd.조련고름 | 0) || [];
    if (!조후보.length) {
      this.msg('소환할 자리가 없습니다');
      this._상태전이(MODE.RING_IDLE, '조련 자리 없음');
      var self조자 = this;
      return Promise.resolve(self조자.resumeRing('조련 자리 없음')).then(function () { return { ok: false, reason: '소환할 자리가 없습니다' }; });
    }
    this._상태전이(MODE.TARGET_RANGE_BUILD, 'skill');
    var 열린조 = this.selector.open(this.battle, this.session.actor, {
      kind: 'skill', arg: { skill: 4, level: cmd.level | 0 }, cells: 조후보,
      relation: 'empty', allowEmpty: true, returnState: MODE.RING_IDLE
    });
    if (!열린조.ok) { this.msg(열린조.reason); this._상태전이(MODE.RING_IDLE, '조련 자리 없음'); return Promise.resolve(this.resumeRing('조련 자리 없음')); }
    this.pendingCommand = cmd;
    /* 정본 293 — 소환 마법처럼 «영역만 칠하고 아무 데나 누르면 그 자리에» (원본 소환 0x29F4D 칸 선택기 없음 → 0x29FC6 0x4A815 확인만)
     *   ☠ 칸 고르기(pickMode 0)로 열어 칠한 영역 안을 눌러야만 됐다 (사장님 11-19 「소환계통은 보통 영역이 나오고 그 영역을 누르는게 아니라 아무데나 눌러도 해당 영역에 소환되어야하는건데 지금은 해당 영역을 눌러야해」)
     *   ⇒ 효과확인·자기중심 상태(소환 마법 magicPick none 과 같은 길) · 잠금 = 첫 자리(앵커) · 좌클릭 = 그 자리 · 우클릭 = 링 */
    var 조앵 = 조후보.filter(function (c) { return !c.발자국; })[0] || 조후보[0];
    this.rangeContext = { kind: 'skill', cells: 조후보, 효과칸: 조후보, 효과확인: true, 자기중심: true, 잠금: { x: 조앵.x | 0, y: 조앵.y | 0 } };
    this._상태전이(MODE.TARGET_SELECT, 'skill');
    return Promise.resolve({ ok: true, targets: 열린조.count });
  }
  var intent = { actor: this.session.actor, command: command };
  if (command === 'skill') intent.skill = cmd.skill | 0;
  if (command === 'skill' && cmd.조련고름 != null) intent.조련고름 = cmd.조련고름 | 0;
  var res = Xc().commit(this.battle, intent, { rng: this.svc.rng });
  /* 0x4D56B — AI 하위 메뉴 반환값은 `0x4D442` 가 그대로 흘립니다.
   *   사람 모양(0x4D217) → 1, 우클릭 취소(0x4D3A6) → −1. */
  if (kind === 'ai' && cmd.ret != null) res.ret = cmd.ret | 0;
  /* ★★★ **탐색(스킬 열 3)의 연출** — 실행기는 `report` 에 실어 올리기만 한다.
   *   `0x18DFA call 0x1124A` 로 **카메라를 그 칸으로**(`svc.focus` 가 그 창구다 — 3852행),
   *   못 찾으면 `0x18D8F eax = 0x1F4` **500 틱** 쉰다(`0x18D94 call 0x499EF`). */
  var _탐 = res && res.report;
  /* 스킬의 모션·문구·회전·대기는 `skill` 연출 드라이버가 Promise로 직렬화한다.
   * 여기서 `svc.wait()` 반환값을 버리며 먼저 진행하면 도막들이 한 프레임에 겹친다. */
  if (command === 'skill') {
    this.svc.onEvent(res);
    if (res.todo) this.msg('아직 안 만든 기술입니다 — ' + (res.reason || kind));
    return this._실행뒤(res, command, intent);
  }
  if (_탐 && _탐.카메라 && this.svc.focus) {
    try { this.svc.focus(_탐.카메라.x | 0, _탐.카메라.y | 0); } catch (e탐) {}
  }
  /* ★★★★★ **스킬이 띄우는 문구** — `0x48612` (2026-09-02)
   *
   *   > 사용자 지적: 「… 적용 효과와 **표시되는 이펙트**, 이펙트 타이밍 등이 문제가 많아.」
   *
   *   원본은 스킬을 쓸 때 `0x48612` 로 영문 문구를 띄운다 —
   *   `Poison` · `Berserk!` · `MP +20!` · `Morale Down!` · `Wish to Win!!!` ·
   *   `Curse` · `Ice Dragon!` · `Defense!` · `Morale Up!` (아홉).
   *   그 함수는 마법의 "Wrong Spell!"·"No TP!"·"No MP!" 와 **같은 것**이라
   *   창구는 이미 있었다(`this.msg()` → `onMessage` → `flash()`) — **스킬만 안 탔다.**
   *   표와 근거는 `combat.js SKILL_MSG` · `03_분석/00_누락기능_목록.md` §18.
   *   ★ 문구를 먼저 띄우고 그 스킬의 프레임 간격만큼 쉰다.
   *     ☐ 「문구가 앞이냐 뒤냐」와 모션 번호는 아직 안 옮겼다 — 연출 층이 필요하다. */
  /* ★ 모션을 먼저 세운다 — 원본은 `mov byte [유닛+0x64], N` 이 문구·대기보다 앞이다
   *   (기도 `0x3BDCC`=8 · 일갈 `0x3C0B9`=8 · 희생 `0x3C13E`=8 · 저주 `0x3C37A`=7 ·
   *    사기업 `0x4CD7D`=8). 되돌리기는 `call 0x12124`. */
  var _액터 = this.session && this.session.actor;
  var _모션앞 = null;
  if (_탐 && _탐.모션 != null && _액터) {
    _모션앞 = _액터.motion | 0;
    _액터.motion = _탐.모션 | 0;                                   // [+0x64]
    try { if (this.svc.updateUnit) this.svc.updateUnit(_액터); } catch (e모) { }
  }
  /* 공통 시전자 회전 호환 경로. 분신(9)은 여기를 쓰지 않는다.
   * `0x3BD08`에서 ebp가 새 레코드를 받으므로 실제 `0x3BD8E` 회전 주체는 분신이며,
   * 제품 진입점 presenter(`battle_main.js`)가 생성 한 기마다 따로 직렬화한다.
   *   ```asm
   *   0x3BD8E ┌ al = [ebp+0x63] + 1 & 3   ; 방향을 한 칸씩 돌린다
   *   0x3BD99 │ 0x45559 · 0x3BD9E 0x499E4 ; 그리고 한 프레임 (간격 0x3BC80 = 6틱)
   *   0x3BDA3 └ cmp dx,0xC                ; 12 프레임
   *   ```
   *   ⇒ 이 공통 블록은 report에 회전이 명시된 다른 시전자 연출만 처리한다.
   *   ★ 프라미스로 미루지 않고 `svc.wait` 을 프레임마다 부른다 — 그 창구가
   *     이미 **밀리초 단위 블로킹**이라 여기 흐름과 맞다. */
  if (_탐 && _탐.회전 && _액터 && this.svc.wait) {
    var _틱ms회 = (root.G2Anim && root.G2Anim.TICK_MS) || (1000 / 175.47);
    var _앞방향 = _액터.dir | 0;
    for (var _f = 0; _f < (_탐.회전.프레임 | 0); _f++) {
      _액터.dir = ((_액터.dir | 0) + 1) & 3;                        /* 0x3BD91 · 0x3BD93 */
      try { if (this.svc.updateUnit) this.svc.updateUnit(_액터); } catch (e회) {}
      try { this.svc.wait(((_탐.회전.틱 | 0) * _틱ms회) | 0); } catch (e회2) {}
    }
    _액터.dir = _앞방향;                                             /* 12 는 4 의 배수라 제자리 */
    try { if (this.svc.updateUnit) this.svc.updateUnit(_액터); } catch (e회3) {}
  }
  /* ★ 원본은 **유닛 머리 위**에 띄운다(`0x48612`) — `msg()` 는 디버그 텍스트다.
   *   창구가 없으면 예전처럼 `msg()` 로 물러선다. */
  if (_탐 && _탐.문구) {
    if (this.svc.unitMsg && _액터) this.svc.unitMsg(_액터, _탐.문구);   // 0x48612
    else this.msg(_탐.문구);
  }
  if (_탐 && _탐.문구틱 && this.svc.wait) {
    var _틱ms2 = (root.G2Anim && root.G2Anim.TICK_MS) || (1000 / 175.47);
    try { this.svc.wait(Math.round((_탐.문구틱 | 0) * _틱ms2)); } catch (e문) { }
  }
  /* ★ 자세 되돌리기 — `call 0x12124` (기도 `0x3BEF7` · 일갈 `0x3C123` ·
   *   저주 `0x3C38F` · 사기업 `0x4CD94` · 희생은 `0x3C2CA` 가 0 으로 덮는다) */
  if (_모션앞 != null && _액터) {
    _액터.motion = _모션앞 | 0;                                    // 0x12124
    try { if (this.svc.updateUnit) this.svc.updateUnit(_액터); } catch (e모2) { }
  }
  if (_탐 && _탐.딜레이틱 && this.svc.wait) {
    /* ☠ `svc.wait` 은 **밀리초**를 받는다(`battle_main.js:1194 연출대기(ms)`).
     *   원본은 **틱**이므로(`0x499EF` 가 `eax` 로 틱을 받는다) 틱 → ms 로 바꿔 넘긴다.
     *   1 틱 = `G2Anim.TICK_MS` (= 1000 / 175.47 ≈ 5.6987 ms). */
    var _틱ms = (root.G2Anim && root.G2Anim.TICK_MS) || (1000 / 175.47);
    try { this.svc.wait(Math.round((_탐.딜레이틱 | 0) * _틱ms)); } catch (e딜) {}
  }
  this.svc.onEvent(res);
  if (res.todo) this.msg('아직 안 만든 기술입니다 — ' + (res.reason || kind));

  return this._실행뒤(res, command);
};

/** 대상이 확정된 뒤 — `ATTACK_COMMIT` 계열 */
Controller.prototype.commitAction = function () {
  var cmd = this.pendingCommand || { kind: 'attack' };
  var command = CMD_MAP[cmd.kind] || 'attack';
  var draft = this.targetDraft || {};
  var modeC = { attack: MODE.ATTACK_COMMIT, special: MODE.SPECIAL_COMMIT,
                magic: MODE.MAGIC_COMMIT, skill: MODE.SKILL_COMMIT }[command] || MODE.ATTACK_COMMIT;
  this._상태전이(modeC);

  var intent = {
    actor: this.session.actor, command: command,
    targetUnits: draft.targetUnits || [], targetTiles: draft.targetTiles || [],
    플레이어공격: command === 'attack'   /* 군단 근접 병종 연속 공격(_군단연타 · 0x1F8EC) — 플레이어 명령 길만 */
  };
  if (command === 'special') { intent.slot = cmd.slot | 0; intent.ultimate = !!cmd.ultimate; }
  /* 마장기 원거리 2×2 — 과녁 칸(0x46E19)과 «모인 대상 그대로»(0x1F731 · 사거리 재검사 없음) */
  if (command === 'attack' && draft.조준칸) { intent.조준칸 = draft.조준칸; intent.force = !!draft.범위검사없음; }
  /* 혼 계열 — 고른 칸이 비어 있으면 대상 목록을 비워 보내지 말고 **아예 안 보냅니다.**
   * 원본 0x2E25B 는 고른 칸까지 돌진하면서 경로 위의 적을 치기 때문입니다
   * (0x2E385 의 칸마다 0x2CAF7). 빈 배열을 주면 아무도 안 맞습니다. */
  if (command === 'special' && this.lastActivation && this.lastActivation.빈칸허용 &&
      !intent.targetUnits.length) delete intent.targetUnits;
  if (command === 'magic') intent.spell = cmd.spell | 0;
  if (command === 'magic' && cmd.부활대상) intent.reviveTarget = cmd.부활대상;   /* [리마스터 부활선택] (Z-88) */
  if (command === 'skill') {
    intent.skill = cmd.skill | 0;
    intent.skillLevel = cmd.level | 0;
    if (cmd.조련고름 != null) intent.조련고름 = cmd.조련고름 | 0;   /* [리마스터 조련소환] 자리 확인 뒤 — 고른 몬스터 (정본 208) */
  }

  /* ★★★ **대상을 지정하는 공격은 «앞 칸 ~ 고른 칸» 가운데를 비춘 뒤 친다** — 원본 `0x1F8A8`~`0x1F8E7` (2026-10-03)
   *   > 사장님: 「원거리 공격시 카메라 확인해줘. 지금은 타겟이 화면을 벗어나는 경우가 있어」
   *   ```asm
   *   0x1F757  call 0x174CF            ; 무기 종류
   *            5·0xF·0x13 → 0x1F19C(대상 선택) · 0x11·0x12 → 범위 지정 · 0xB·0xC → 0x1F466   ⇒ [esp+0xC] = 1
   *            그 밖(근접) → [esp+0xC] = 0
   *   0x1F8A8  cmp [esp+0xC],1 / jne    ; 지정형만
   *   0x1F8AF  cmp cl,0x10 / je         ; 무기 0x10 은 빼고
   *   0x1F8C2  call 0x1A1DE            ; 공격 시작 칸(앞 칸 · 0x1A146)
   *   0x1F8E7  call 0x46DF1            ; 그 칸과 고른 칸 [0x8A8B0]/[0x8A8B2] 의 가운데(sar 1) → 0x1124A
   *   ```
   *   ★ [리마스터] 마법사 원거리 평타(무기 2 · 토글 켬)도 대상을 지정하므로 같은 길로 비춘다. */
  var 가운데 = null;
  if (command === 'attack' && this.svc.focus) {
    var _Cb = root.G2Combat, _자 = this.session.actor;
    var _wt = (_Cb && _Cb.weaponTypeOf) ? (_Cb.weaponTypeOf(this.battle, _자) | 0) : -1;
    var _지정 = [5, 0xF, 0x11, 0x12, 0x13, 0xB, 0xC].indexOf(_wt) >= 0 ||
                (_wt === 2 && _마법사원거리켜짐() && _Cb && _Cb.isMageWeapon && _Cb.isMageWeapon(2));
    var _고른 = draft.조준칸 || (draft.targetTiles && draft.targetTiles[0]) ||
                (draft.targetUnits && draft.targetUnits[0] ? { x: draft.targetUnits[0].x, y: draft.targetUnits[0].y } : null);
    var _앞 = (_지정 && _고른 && _자 && _Cb && _Cb.공격시작칸) ? _Cb.공격시작칸(this.battle, _자) : null;
    if (_앞) 가운데 = { x: (_앞.x | 0) + (((_고른.x | 0) - (_앞.x | 0)) >> 1),
                       y: (_앞.y | 0) + (((_고른.y | 0) - (_앞.y | 0)) >> 1) };   /* 0x46DFC~0x46E0F */
  }
  var self = this;
  function 실행() {
    /* ★ 대상을 골라 치는 통상 공격(원거리 · 마법사 원거리 평타 · 마장기 원거리)도 S3(0x1DE15)를 지난다 — 원본은 근접·원거리 모두 0x1F738 한 창구
     *   ☠ 여기서 실행기를 바로 불러 «공격받으면» 이벤트가 근접 정면 공격(_정면통상공격실행)에서만 돌았다
     *   (사장님 11-07 「용자의 무덤 마지막층 안내인 이벤트 일반공격만 적용된다고 했는데, 원거리 공격은 적용 안되는 것 같아.」) */
    if (command === 'attack' && typeof self._통상공격S3 === 'function') {
      return self._통상공격S3(intent).then(function (result) {
        self.selector.close();
        self.targetDraft = null; self.pendingCommand = null;
        self.rangeContext = null;
        if (!result.ok && result.반환 === 2) { self._상태전이(MODE.RING_IDLE, '공격자 소멸'); return result; }   /* S3 이벤트가 공격자를 없앴다 (0x1DE48 → 0x1F917) */
        if (!result.후처리보류) self.svc.onEvent(result);
        return self._실행뒤(result, command, intent);
      });
    }
    var res = Xc().commit(self.battle, intent, { rng: self.svc.rng });
    self.svc.onEvent(res);
    self.selector.close();
    self.targetDraft = null; self.pendingCommand = null;
    self.rangeContext = null;
    /* ★ 화면에 뜨는 문구다 — **사용자의 말로** 쓴다 (2026-08-29)
     *   여기로 오는 것은 **스킬 3(중독) 하나뿐**임을 확인했다(`combat.js` §skill).
     *   전에는 「TODO(원본 미확인)」이라고 떠서 무슨 말인지 알 수 없었다. */
    if (res.todo) self.msg('아직 안 만든 기술입니다 — ' + (res.reason || cmd.kind));
    return self._실행뒤(res, command, intent);
  }
  if (가운데) return Promise.resolve(this.svc.focus(가운데.x, 가운데.y)).then(실행);   /* 0x1124A — 도착까지 */
  return 실행();
};

/**
 * 실행 → 연출 → 사망 → 승패 → 링 복귀. §55 의 수직 경로가 여기입니다.
 * @returns {Promise}
 */
/**
 * ★★★★★ **통상 공격의 S3 — `0x1DE15`** (2026-08-22 · 통합 2-c 4단계)
 *
 *   원본 흐름 (`SCE_HP변경_창구.md` §3-p · §3-q):
 *
 *   ```
 *   0x1F738  대상 확정 (0x1F19C · 0x1AC08 · 0x1F466)
 *      ↓  실패하면 여기서 반환 — S3 를 안 지난다
 *   0x1F90C / 0x1F97A  call 0x1DDF0 (dx = 1)   ★ 직업 0x86~0x8B 이면 앞, 아니면 뒤 (배타)
 *      ↓
 *   0x1DE15  call 0x53797            ★★★ **S3** — eax=시전자 · edx=대상[0]
 *      ↓
 *   0x1DE2A  call 0x5394D            대상마다 S5 (★ 우리 미구현)
 *      ↓
 *   0x1DE3E  call 0x11FF7            ★ **시전자가 아직 진영 목록에 있나**
 *      ↓  없으면 −1 → 0x1F917 → **반환 2 (공격자 소멸)**
 *   0x1DE52  ── 실제 피해 루프 ──
 *   ```
 *
 *   ⇒ S3 는 **대상이 확정된 뒤 · 첫 피해 전**에 **정확히 한 번**이다.
 *     대상이 몇이든 대상별로 부르지 않는다.
 *
 *   @param {object} intent `{ actor, command:'attack', targetUnits }`
 *   @returns {Promise<object>} executor 결과. 취소면 `{ ok:false, 반환:2 }`
 */
Controller.prototype._통상공격S3 = function (intent, opts) {
  var self = this;
  opts = opts || {};
  var 실행 = function () { return Xc().commit(self.battle, intent, { rng: self.svc.rng, noCounter: !!opts.noCounter }); };   /* noCounter — 군단 연속 공격 셋째(0x1F93D) */

  /* 창구가 없으면(shadow 이전 · 시험) **그냥 예전처럼** 동기로 돈다 */
  if (!self.svc.영역S3알림 || !Cb() || !Cb().attack계획) return Promise.resolve(실행());

  var A = intent.actor;
  var ts = (intent.targetUnits || []).filter(function (u) { return u && u.alive; });
  var 계획 = Cb().attack계획(self.battle, A, ts[0], { targets: ts, force: intent.force, tp: intent.tpCost });   /* tpCost 0 = 군단 연속 공격 둘째·셋째(TP 는 명령에서 한 번) */
  /* 대상 확정 실패 = 원본이 `0x1F9FA` 로 빠지는 자리 — **S3 를 안 지난다** */
  if (!계획.ok) return Promise.resolve(실행());

  /* ★ `0x11FF7` 재확인용 — S3 **전**의 진영 (원본 `0x1DE04 movsx ecx,[eax+0xe]`) */
  var 공격전진영 = Turn().사망진영(A);

  /* ★★★ **동기 예외에도 흐름을 끊지 않는다** — 사망 경로와 같은 규칙 (GPT 24차) */
  var 외피 = null, 동기오류 = null;
  try {
    외피 = self.svc.영역S3알림({
      소스유닛: A, 대상목록: 계획.targets,
      모드: 1,                       /* 원본 dx = 1 */
      원본경계: '0x1DE15'
    });
  } catch (e) { 동기오류 = e; }
  if (동기오류) return Promise.reject(동기오류);

  return Promise.resolve((외피 && 외피.대기) || null).then(function () {
    /* ★★★ `0x1DE3E call 0x11FF7` — S3 이벤트가 **시전자를 죽였을 수 있다** */
    if (!Turn().진영목록에있나(self.battle, A, 공격전진영)) {
      return { ok: false, reason: '공격자 소멸', 반환: 2, 원본: '0x1DE48 → 0x1F917' };
    }
    /* ★★★★★ **`0x1DE2A` — 대상마다 S5** (2026-08-22 · GPT 30차 차단 조건)
     *   S3 **뒤**, 크리티컬·피해 **앞**이다. 그 뒤 `0x1DE3E` 를 **한 번 더** 본다. */
    return self._대상S5(계획.targets, A).then(function () {
      /* ★ S5 이벤트도 시전자를 죽일 수 있다 — 원본은 S5 루프 **뒤**에 0x1DE3E */
      if (!Turn().진영목록에있나(self.battle, A, 공격전진영)) {
        return { ok: false, reason: '공격자 소멸', 반환: 2, 원본: '0x1DE48 → 0x1F917' };
      }
      /* ★★★★★ **`0x1ED45` 를 컨트롤러가 돈다** — 피해는 전부 먼저 (GPT 28차) */
      intent.사망유예 = true;
      var res = 실행();
      if (!res || !res.ok || !res.report || !res.report.사망유예) return res;

      /* ★★★★★ **`0x1ED45` 는 연출(`0x1E61D`) 뒤다 — 여기서 돌리지 않는다**
       *   (2026-08-27 · 사용자 결과 피드백 ③)
       *
       *   > 「원작기준 **대사 발동 캐릭터가 체력이 0이하가 되었을때(사망효과 직전에)
       *   >  대사 이벤트 발생하고 사망 효과가 나와.** 우리는 **공격 중간에 대사가 뜨고**
       *   >  (… **공격 개시하자마자 체력이 0으로 계산되어 그때 이벤트가 발동하는 느낌**)」
       *
       *   원본 `0x1F973` 일반 갈래 —
       *   ```asm
       *   0x1F97A  call 0x1DDF0   ; 피해 계산 (S3 0x1DE15 · S5 0x1DE2A 포함)
       *   0x1F98C  call 0x1E61D   ; ★ 공격 연출
       *   0x1F998  call 0x1EF5C   ;   대상 자세 복귀
       *   0x1F99F  call 0x1ED45   ; ★★★ **사망 처리** — 여기가 제자리
       *   0x1F9AD  call 0x1EF9A   ;   반격
       *   ```
       *   다단 갈래(`0x1F905`)도 `0x1F92C 0x1E61D` → `0x1F938 0x1ED45` 로 **같다.**
       *
       *   그리고 `0x1ED45` 안이 —
       *   ```asm
       *   0x1ED5C  cmp [eax+0x48], 0 ; jg 0x1ED75   ; HP > 0 이면
       *   0x1ED68    call 0x1DB1D                   ;   HP <= 0 → 사망 처리(대사·연출)
       *   0x1ED6D    대상배열[i] = 0                 ;   0x1ED6D
       *   0x1ED7C  call 0x53797 (ebx=1)             ; 살아 있으면 S4
       *   ```
       *   ⇒ **HP 를 깎는 것은 연출 앞이 맞다**(원본도 그렇다). 그러나 **대사를 띄우는
       *     것은 연출 뒤**다. 우리는 둘을 한자리에서 해 버렸다.
       *
       *   ☠ 그냥 여기서 지우면 **반격 계산(`attack반격`)까지 사라진다** —
       *     `_대상후처리` 끝에 붙어 있고, 원본도 `0x1ED45` **뒤**가 `0x1EF9A` 다.
       *   ⇒ 통째로 **미뤄서** `_실행뒤` 이 연출 뒤에 부른다. */
      res.후처리보류 = function () { return self._대상후처리(res, A); };
      return res;
    });
  });
};

/**
 * ★★★★★ **`0x1DE2A` — 대상마다 S5** (2026-08-22)
 *
 *   ```asm
 *   0x1DE15  call 0x53797          ; S3
 *   0x1DE1A  jmp 0x1DE30
 *   0x1DE1C  movsx edx, di
 *   0x1DE21  xor ebx, ebx          ; ★ bx = 0 → **S5**
 *   0x1DE23  mov edx, [edx*4+0x80648]  ; 대상[i]
 *   0x1DE2A  call 0x5394D          ; ★★★ S5 — eax = 시전자 · edx = 대상[i]
 *   0x1DE2F  inc edi
 *   0x1DE30  cmp di, [0x80B9E]     ; 대상 수만큼
 *   0x1DE37  jl 0x1DE1C
 *   0x1DE3E  call 0x11FF7          ; ★ 루프 **뒤** 시전자 생존
 *   ```
 *
 *   ★ **직렬**이다 — S5 이벤트가 다음 대상을 죽이거나 옮길 수 있다.
 *   ★ 유닛1 = **시전자**, 유닛2 = **대상[i]** (`0x53954`·`0x53956`).
 */
Controller.prototype._대상S5 = function (대상목록, A) {
  var self = this;
  if (!self.svc.관계S5알림) return Promise.resolve(null);
  var 체인 = Promise.resolve();
  (대상목록 || []).forEach(function (D) {
    체인 = 체인.then(function () {
      if (!D) return null;
      var 보 = null, 동기 = null;
      try {
        보 = self.svc.관계S5알림({ 유닛1: A, 유닛2: D, 원본경계: '0x1DE2A' });
      } catch (e) { 동기 = e; }
      if (동기) throw 동기;                  /* ★ 삼키지 않는다 */
      return (보 && 보.대기) || null;
    });
  });
  return 체인;
};

/**
 * ★★★★★ **`0x1ED45` — 대상 목록 후처리** (2026-08-22 · GPT 28차)
 *
 *   ```asm
 *   0x1ED4A  mov ecx, eax           ; ecx = **시전자** — 사망·생존 **둘 다 주체**
 *   0x1ED56  mov eax, [ebx+0x80648] ;   대상[i]
 *   0x1ED5C  cmp [eax+0x48], 0
 *   0x1ED60  jg 0x1ED75             ;   > 0 → 생존
 *     사망 : 0x1ED68 call 0x1DB1D (그 안 0x1DB50 S4) · 0x1ED6D 배열을 **null 로**
 *     생존 : 0x1ED75 ebx=1 · 0x1ED7C call 0x53797   ★ **S4**
 *   0x1ED82  cmp si, [0x80B9E] / jl ;   대상 배열 **순서 그대로**
 *   ```
 *
 *   ★ 사망과 생존은 **배타**다. 처리 **순간** HP 를 다시 본다 (스냅샷 아님) —
 *     앞 대상의 S4 명령이 뒤 대상을 살리거나 죽일 수 있다.
 *   ★ **직렬**이다. `Promise.all` 금지.
 */
Controller.prototype._대상후처리 = function (res, A) {
  var self = this, rep = res.report;
  var 목록 = (rep && rep.후처리대상) || [];
  var 체인 = Promise.resolve();

  목록.forEach(function (D, i) {
    체인 = 체인.then(function () {
      /* ★ `0x1ED6D` — 앞서 처리하다 배열에서 빠진 자리 */
      if (!D) return null;
      /* ★★★ `0x1ED5C` — **처리 순간** HP 를 다시 본다 */
      if ((D.hp | 0) > 0 || D._불사) return self._생존S4(D, A, rep);   /* _불사 — [리마스터] 무덤 8층 안내인 HP 0 으로 버팀 (combat.js applyDamage) */
      return self._대상사망(D, A, 목록, i, rep);
    });
  });

  return 체인.then(function () {
    /* ★ `0x1EF9A` 반격 + TP — **`0x1ED45` 뒤**다.
     *   ★★★ 실행 단계와 **같은 옵션**을 준다 — `noCounter`·`free` 가 사라지면
     *     안 해야 할 반격을 하고 안 내야 할 TP 를 낸다 (GPT 29차). */
    if (rep.반격보류 && Cb().attack반격) {
      var 옵 = res.실행옵션 || {};
      Cb().attack반격(self.battle, A, rep, {
        rng: 옵.rng || self.svc.rng, noCounter: 옵.noCounter,
        free: 옵.free, tp: 옵.tp
      });
    }
    return self._결과재확정(res, A);
  });
};

/**
 * ★★★★★ **`0x1ED45` · 반격 뒤 결과를 다시 확정한다** (2026-08-22 · GPT 29차)
 *
 *   `executor.commit()` 은 `attack실행()` 이 **HP 만 깎은 시점**에 결과를 만든다.
 *   그 뒤 `0x1ED45` 의 S4 가 대상을 살리거나 죽이고, 반격이 공격자를 죽일 수 있다.
 *   그런데 `res.ret`·`res.session` 은 `_실행뒤()` 의 **상태 전환 입력**이라
 *   낡은 값이면 `ACTOR_GONE` 처리가 통째로 깨진다.
 *
 *   > GPT 29차: 「단순 진단 필드가 아니라 `_실행뒤()` 의 상태 전환 입력이므로 필수」
 */
Controller.prototype._결과재확정 = function (res, A) {
  if (!res || !res.확정보류) return res;
  var X = Xc();

  /* ① 사망자 — S4 가 살렸으면 빠지고, S4·반격이 죽였으면 들어온다 */
  res.deaths = X.collectDeaths(res.report);

  /* ② 공격자 소멸 — 반격에 맞아 죽는 경우 (0x1F738 이 2 → 0x4D442 가 TP 0 + −4) */
  res.ret = (A && A.alive) ? X.RET.CONTINUE : X.RET.ACTOR_GONE;
  if (res.ret === X.RET.ACTOR_GONE && X.setTp) X.setTp(A, 0);   // 0x1A0BF(0)
  res.session = X.sessionOf(res.ret);

  /* ③ 실제로 나간 TP — `attack반격()` 이 뺀 뒤라야 맞다 */
  if (res.tp이전 !== undefined && A) {
    res.committedCosts = [{ unit: A, tp: (res.tp이전 | 0) - (A.tp | 0), mp: 0, hp: 0 }];
  }

  res.확정보류 = false;
  return res;
};

/** ★ `0x1ED7C` — 살아남은 대상에 **S4**. 주체는 **시전자**(`0x1ED7A mov edx,ecx`). */
Controller.prototype._생존S4 = function (D, A, rep) {
  var self = this;
  if (!self.svc.HP변경알림) return null;
  var 보 = null, 동기 = null;
  try {
    보 = self.svc.HP변경알림({
      변경유닛: D, 주체유닛: A,
      /* [리마스터] 바뀌기 전 HP = 공격 결과의 피해 전 HP(hpBefore) — HP 이벤트 모드 4 «맞으면»이 «줄었나»를 본다 (2026-11-07 · 무덤 33층) */
      이전HP: (function () { var rs = (rep && rep.results) || []; for (var k = 0; k < rs.length; k++) if (rs[k] && rs[k].unit === D && rs[k].hpBefore != null) return rs[k].hpBefore | 0; return D.hp | 0; })(),
      이후HP: D.hp | 0,   /* 이미 반영됐다 — 경계가 통과시킨다 */
      까닭: '공격', 원본경계: '0x1ED7C'   /* ★ 허용 목록 밖이면 '기타' 로 접힌다 */
    });
  } catch (e) { 동기 = e; }
  if (동기) throw 동기;                    /* ★ 삼키지 않는다 */
  return (보 && 보.대기) || null;
};

/** ★ `0x1ED68 → 0x1DB1D` — 죽은 대상. 주체도 **시전자**(`0x1ED64 mov eax,ecx`). */
Controller.prototype._대상사망 = function (D, A, 목록, i, rep) {
  var self = this;
  var 진영 = Turn().사망진영(D);            /* ★ 0x1DB55 — 호출 지역 */
  /* ★★★★★ **조기 반환에서도 슬롯을 비운다** (2026-08-22 · GPT 30차)
   *   앞 대상의 S4 가 이 대상을 **이미 죽였거나 퇴장**시켰으면 `사망전처리()` 가
   *   `false` 다. 그래도 원본은 사망 갈래에 들어간 이상 `0x1ED6D` 로 슬롯을 비운다. */
  if (!Turn().사망전처리(self.battle, D)) {              /* 0x1DB2A · 0x1DB43 */
    if (목록 && i !== undefined) 목록[i] = null;         // 0x1ED6D
    return null;
  }
  /* ★★★★★ **대사 중에도 스프라이트는 남아 있어야 한다** (2026-08-27 · 사용자 지적)
   *
   *   > 「1-5 캐릭터 체력0시 이벤트 사망효과가 대사 끝나고 나오는건 잘 적용되었는데,
   *   >  **대사 도중에 캐릭터가 이미 사라져 있어.** 캐릭터 스프라이트는 없어지지 않고
   *   >  유지되어야하고 **대화가 끝나면 사망효과와 함께** 사라져야해.」
   *
   *   원본 `0x1DB1D` 은 **리스트에서 빼는 것이 맨 끝**이다 —
   *   ```asm
   *   0x1DB43  [+0x48] = 0            ; HP 0
   *   0x1DB50  call 0x53797           ; ★ S4 대사      ← 이 동안 유닛은 **맵에 있다**
   *   0x1DB8B~ call 0x463FB/0x46A11   ;   사망 연출
   *   0x1DD9C  call 0x1137A           ; ★ **리스트 제거** — 맨 끝
   *   ```
   *
   *   ☠ 우리는 셈(`combat.kill`)이 `alive = false` 를 먼저 넣는다. 그러면
   *     `updateUnit` 이 매 프레임 숨겨 **대사 도중에 유닛이 사라진다.**
   *     실측(1-5 · 하밀) —
   *     ```
   *     45844ms  HP 0 · 살아있음 · 보임
   *     46802ms  ☠ · **안 보임** · 대사 열림   ← 여기서 사라졌다
   *     50844ms  보임 · dying · UNIT_DEATH     ← 4초 뒤에야 다시 나온다
   *     ```
   *
   *   ⇒ HP 가 0 이 되는 **그 자리**에서 「연출 중」 표시를 켠다.
   *     `DRIVER.death` 가 회전을 마치고 `0x465A8` 에서 끈다 —
   *     곧 원본의 `0x1DD9C` 자리와 같아진다.
   *   ★ 연출이 끝내 안 돌아도 `R.clearDying()` 안전장치가 시체를 치운다. */
  try { if (this.svc.dyingUnit) this.svc.dyingUnit(D, true); } catch (e잔상) {}

  var 보 = null, 동기 = null;
  /* `_사망처리()` 의 공통 사망 경로가 같은 S4 를 다시 부르지 않게 표시한다.
   * 평타는 원본 `0x1DB50` 을 바로 여기서 거치지만, 마법 등은 아래 공통 경로에서
   * 사망 연출 직전에 거친다. */
  D._S4사망검사함 = true;
  try {
    if (self.svc.HP변경알림) {
      보 = self.svc.HP변경알림({
        변경유닛: D, 주체유닛: A,           /* ★ 0x1ED64 — 주체는 시전자 */
        이전HP: 0, 이후HP: 0,
        까닭: '사망', 원본경계: '0x1DB50'
      });
    }
  } catch (e) { 동기 = e; }

  var 뒤 = function () {
    /* ★★★ `0x1ED6D` — 원본은 `call 0x1DB1D` 가 **돌아온 뒤 조건 없이**
     *   대상 슬롯을 0 으로 만든다. 회복·진영이탈이어도 마찬가지다 (GPT 29차). */
    if (목록 && i !== undefined) 목록[i] = null;
    /* ★★★ `0x1DB6B` — S4 가 살렸으면 안 죽는다. `0x11FF7` 도 함께 본다 */
    /* ☠★★★★★ **사망 연출로 안 가면 «연출 중» 표시를 내린다** (2026-10-06)
     *   > 사장님: 「gs 로카르노 결투 이벤트 다른버그들은 사라졌는데, gs가 이탈하지 않고 체력0으로 계속 남는 버그가 있어.
     *   >  라시드처럼 함께 맵에서 사라져야해」
     *   4-8 HP 상태 B(GS · HP ≤ 0) → op 0x04 GS 걸어서 퇴장 → 원본 0x1DB66 je 0x1DB71 로 사망 연출을 건너뛴다.
     *   ☠ 위에서 켠 `dyingUnit(D, true)` 는 사망 연출 끝(0x465A8)에서만 내렸다 — 연출로 안 가는 이 두 갈래에서는
     *     아무도 안 내려(`clearDying()` 안전장치는 부르는 곳이 없다) 퇴장한 GS 그림이 HP 0 으로 남았다.
     *     라시드는 HP 0 이 아니라 이 표시가 없어 멀쩡히 사라졌다. */
    function 표시내림() { try { if (self.svc.dyingUnit) self.svc.dyingUnit(D, false); } catch (e내림) {} }
    if (!Turn().진영목록에있나(self.battle, D, 진영)) { 표시내림(); return null; }
    if ((D.hp | 0) > 0) { 표시내림(); return null; }
    /* ★ `0x1DB8B~0x1DD9C` — 연출·경험치·사기·리스트 제거는 `kill()` 이 한다 */
    var k = Cb().kill(self.battle, D, { killer: A, reason: 'attack' });
    if (rep) {
      if (rep.deaths.indexOf(D) < 0) rep.deaths.push(D);
      if (k && k.exp) rep.exp.push(k.exp);
    }
    return null;
  };

  if (동기) { 뒤(); throw 동기; }            /* ★ 후처리 뒤 다시 던진다 */
  if (보 && 보.대기) return Promise.resolve(보.대기).then(뒤, function (e) { 뒤(); throw e; });
  return 뒤();
};

/**
 * ★★★★★ **SCE `stateChanges` 를 전투에 옮기고 뒷정리한다** (2026-08-22 · GPT 34·35차)
 *
 *   `sceruntime` 은 **사본**에만 손대고 이름도 다르다(`HP` vs `hp`).
 *   `G2SceApply` 가 값을 옮기고, **여기서** 화면·세션 캐시를 되살린다.
 *
 *   > GPT 35차: 「`side` 는 적대 판정·링 대상·이동 범위에 즉시 영향을 주므로
 *   >  오래된 캐시를 **한 프레임이라도** 쓰면 잘못된 대상 선택이 가능합니다」
 *
 *   ★ **걸어 나가는 퇴장**(`op 0x04` 모드 0)은 여기서 확정하지 않는다 —
 *     `연출대기` 로 `보류` 에 담아 돌려주고, 연출이 끝난 뒤
 *     `_퇴장확정()` 이 마무리한다 (원본 `0x17071` 도 걸은 **뒤** `0x17263`).
 *
 * @param {Array} 변경들 `sceruntime` 이 낸 `stateChanges`
 * @param {object} [옵션] `{ 연출대기: true }`
 * @returns {{적용, 건너뜀, 바뀐유닛, 보류}}
 */
Controller.prototype.SCE변경적용 = function (변경들, 옵션) {
  var A = root.G2SceApply;
  if (!A) throw new Error('controller: G2SceApply 가 없다 (sceapply.js 미로드)');
  var 옵 = 옵션 || {};
  if (옵.원자 === undefined) 옵.원자 = true;      /* ★ 기본이 **원자**다 */
  var r = A.적용(this.battle, 변경들, 옵);

  /* ★★★★★ **반쯤 적용된 상태를 만들지 않는다** (GPT 36차 ④)
   *   > 「일부 적용 후 경고만 남기는 상태 금지 — `preflight → 전부 적용`」
   *   사본과 실전이 갈라지는 것이 가장 위험하다. 던져서 위로 올린다. */
  if (r.통과 === false) {
    var 목록 = (r.건너뜀 || []).map(function (m) {
      var c = m && m.변경 ? m.변경 : m;
      return (m && m.왜) ? m.왜 : ((c && c.scope || '?') + '/' + (c && c.kind || '?'));
    }).join(' · ');
    this.msg && this.msg('SCE 변경을 못 옮겼습니다 (' + (r.건너뜀 || []).length + '건)');
    throw new Error('SCE변경적용: 옮길 수 없는 변경이 있어 **아무것도 적용하지 않았다** — ' + 목록);
  }

  this._SCE뒷정리(r.바뀐유닛);
  return r;
};

/**
 * ★ 바뀐 유닛에 맞춰 **캐시를 버린다**.
 *   진영·생사가 바뀌면 세션이 잡고 있던 대상·범위가 통째로 무효다.
 */
Controller.prototype._SCE뒷정리 = function (바뀐유닛) {
  var self = this;
  if (!바뀐유닛 || !바뀐유닛.length) return;

  var 진영바뀜 = false, 사라짐 = false, 맵바뀜 = false;
  var 날씨바뀜 = false;
  바뀐유닛.forEach(function (x) {
    if (x.kind === 'unitSide') 진영바뀜 = true;
    if (x.kind === 'unitLeave') 사라짐 = true;
    if (x.kind === 'mapTile') 맵바뀜 = true;      /* op 0x10 */
    if (x.kind === 'weather') 날씨바뀜 = true;    /* op 0x71 */
  });

  /* ★ `0x52823` → `0x44F30` — 전투 중 날씨 변경을 즉시 화면에 반영한다.
   * 논리값만 바꾸면 TP/마법 계산은 새 날씨를 보지만, 맵·유닛·UI와 WEATHER.SYB는
   * 진입 당시 팔레트/종류에 그대로 머문다. 원본처럼 같은 프레임 경계에서 전부
   * 같은 날씨 전역을 보게 한다. */
  if (날씨바뀜) {
    var 새날씨 = this.battle.timeOfDay | 0;
    var 옛날씨 = (this.battle._보인날씨 != null) ? (this.battle._보인날씨 | 0) : ((this.battle.S && this.battle.S['날씨']) | 0);   /* 전투마다 따로 — 직전에 화면에 보인 날씨 */
    this.battle._보인날씨 = 새날씨;
    if (root.G2 && root.G2.scene) root.G2.scene['날씨'] = 새날씨;
    var R날 = this.svc.view || null;
    var N날 = root.G2Native;
    /* [리마스터] 전투 도중 날씨가 바뀌면 팔레트를 1.2초에 걸쳐 옛 날씨 색 → 새 날씨 색으로 섞어 옮긴다
     *   원본은 0x44F30 이 256색을 한 번에 계산해 0x5F9AE 로 곧바로 쓴다(서서히 없음) — 비가 «갑자기 나타나» 어색했다
     *   (사장님 11-09 「비 전환 어색한거 자연스럽게 비 연출이 들어오도록 수정해. 갑자기 나타나서 그랬을거야」) */
    var 서서히ms = 1200;
    if (옛날씨 !== 새날씨 && R날 && typeof R날.날씨팔레트서서히 === 'function' && R날.날씨팔레트서서히(옛날씨, 새날씨, 서서히ms)) {
      try { if (root.G2Fx && root.G2Fx.weather) root.G2Fx.weather(새날씨, undefined, 서서히ms); if (root.__G2자산_날씨적용) root.__G2자산_날씨적용(); if (root.G2Fx && root.G2Fx.날씨적용) root.G2Fx.날씨적용(); }
      catch (e날씨2) { if (root.console && root.console.warn) root.console.warn('[SCE] weather 화면 반영 실패 — ' + (e날씨2 && e날씨2.message)); }
      날씨바뀜 = false;   /* 아래 «한 번에 갈기» 길은 건너뛴다 */
    }
  }
  if (날씨바뀜) {
    var 칠함 = !!(R날 && typeof R날.날씨팔레트갈기 === 'function' && R날.날씨팔레트갈기(새날씨));
    if (!칠함 && R날 && !R날.nmap && root.console && root.console.warn)
      root.console.warn('[SCE] 날씨 — 화면 창구에 날씨팔레트갈기가 없다: 맵·유닛 색을 못 바꾼다 (0x44F30)');
    if (!칠함 && R날 && R날.nmap && R날.팔레트만갈기 && N날 && N날.날씨팔레트) {
      var 바탕팔 = R날.nmap._날씨바탕팔레트;
      if (바탕팔) {
        var 새팔 = 새날씨 ? N날.날씨팔레트(바탕팔, 새날씨) : new Uint8Array(바탕팔);
        R날.팔레트만갈기(새팔, '날씨' + 새날씨);
      }
    }
    try {
      if (root.G2Fx && root.G2Fx.weather) root.G2Fx.weather(새날씨);
      if (root.__G2자산_날씨적용) root.__G2자산_날씨적용();
      if (root.G2Fx && root.G2Fx.날씨적용) root.G2Fx.날씨적용();
    } catch (e날씨) {
      if (root.console && root.console.warn)
        root.console.warn('[SCE] weather 화면 반영 실패 — ' + (e날씨 && e날씨.message));
    }
  }

  /* ★★★★★ **맵 타일이 바뀌면 다시 그린다** (`op 0x10` · `0x52CDC`·`0x52CE2`)
   *   원본은 묶음이 끝나야 `call 0x4559F`(다시 그리기)·`call 0x5E9E8`(화면) 을 한다.
   *   ★ `sceapply` 가 `layerA/B/C` 와 `battle.terrain` 을 이미 고쳤다 —
   *     여기서는 **렌더러가 다시 굽게** 한다 (`useNativeMap` 이 창구다).
   *   ★ `18-5C.SCE` 는 연속 5칸을 한 묶음으로 바꾸므로 **한 번만** 다시 그린다. */
  if (맵바뀜) {
    var R = this.svc.view || null;
    var 맵 = this.battle && this.battle.map;
    if (R && typeof R.useNativeMap === 'function' && 맵) {
      try { R.useNativeMap(맵, null); }
      catch (e) {
        if (root.console && root.console.warn)
          root.console.warn('[SCE] mapTile — 맵 다시 그리기 실패: ' + (e && e.message));
      }
    } else if (root.console && root.console.warn) {
      root.console.warn('[SCE] mapTile — view.useNativeMap 이 없다. **맵이 안 다시 그려진다** (0x52CDC)');
    }
  }

  /* ★ 진영·생사가 바뀌면 **선택·범위 캐시를 버린다** (GPT 35차 ⑮) */
  if (진영바뀜 || 사라짐) {
    this.rangeContext = null;
    /* 세션이 잡고 있던 대상이 이제 아군/적이거나 사라졌을 수 있다 */
    if (this.session && this.session.targets) this.session.targets = null;
    if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
  }

  /* 사라진 유닛이 초점이면 초점을 놓는다 */
  if (사라짐 && this.actor && !this.actor.alive) this.actor = null;

  /* 화면 갱신 — 감춤·방향·진영 색이 모두 여기서 반영된다 */
  바뀐유닛.forEach(function (x) {
    if (x.kind === 'unitHide' && self.svc.view && self.svc.view.hideUnit) {
      self.svc.view.hideUnit(x.유닛, true);       /* render.js 2273 */
    }
  });
  if (this.svc.onState) this.svc.onState();
};

/**
 * ★★★ **걸어 나가는 퇴장을 연출 뒤에 확정한다** (`op 0x04` 모드 0).
 *
 *   원본 `0x17071` 은 이동 연출을 끝낸 **뒤** `0x1723A`(대기열)·`0x17263`(리스트)
 *   으로 논리 이탈한다. `SCE변경적용(..., {연출대기:true})` 이 돌려준 `보류` 를 받는다.
 *
 * @param {Array} 보류 `{유닛, kind, 갈래}` 목록
 * @returns {Promise}
 */
/**
 * ★★★★★ **취소 경계** (2026-08-22 · GPT 57차 ②④)
 *
 *   `살아있나` 를 주면 **두 시점**에 본다:
 *     ① 들어올 때 — 이미 무효면 **애니메이션도 시작하지 않는다**
 *     ② 연출이 끝난 **뒤**, `A.퇴장()` **앞** — 그 사이 세대가 바뀌었으면 확정하지 않는다
 *
 *   ★ 전에는 ②가 없어 **퇴장 연출 도중 세션이 바뀌어도 확정됐다.**
 *     `SCE결과소비()` 의 `살아있나()` 는 `한바퀴()` **머리에만** 있어
 *     이미 시작된 연출 뒤 확정은 못 막았다 (비동기 시험이 드러냈다).
 *
 *   ★ 「확정을 막으면 옛 사본과 옛 전투가 어긋난다」는 사실이지만,
 *     **취소된 비동기 작업이 이후 상태를 건드리지 않는다**는 계약이 더 중요하다 —
 *     둘은 함께 폐기된다.
 */
/**
 * ★★★★★ **SCE 공격 연출** (`op 0x07` 값 0·1 · `0x1E61D`) — 2026-08-22
 *
 *   `공격모션_분석.md` §1-h — `전투.html DRIVER.attack` 이 **이미 원본 구조**다
 *   (갈래값 0/1/2 · 본 루프 4회전 · 크리티컬 7→8 도입 24틱).
 *   ★ `[0x80B8C]` 크리티컬 플래그 → `report.attackType`
 *     (`0 일반 · 1 크리티컬 · 2 일격필살` — `전투.html:2123`).
 *   ★ **상태는 안 바꾼다** — 피해는 `0x1DDF0` 이 이미 깎아 뒀다 (`:234`).
 *   ★ 원본은 `0x1E61D` 가 **동기**로 끝난 뒤 다음 명령으로 간다 — 그래서
 *     **퇴장·이동보다 먼저** 돌리고 기다린다.
 *
 * @param {Array} 보류 `sceapply` 가 돌려준 목록
 * @param {Function} 살아있나 취소 경계 (필수)
 * @returns {Promise}
 */
Controller.prototype._SCE공격연출 = function (보류, 살아있나) {
  var self = this;
  if (typeof 살아있나 !== 'function')
    throw new Error('_SCE공격연출: 살아있나 는 **필수 인자**다 (취소 계약)');
  var 공격들 = (보류 || []).filter(function (x) { return x && x.kind === 'sceAttack'; });
  /* ★★★★★ **묶음 판정** (`op 0x07` 묶음 둘째 · `0x51D58`) — 같은 보류에 있다.
   *   원본은 `[0xF0430+i*2]` 에 판정을 넣고 대상 배열(`0x80648`)을 훑어 연출한다.
   *   ★ 우리 `DRIVER.attack` 은 `rep.results[].result` 로 그것을 안다 —
   *     `'hit'` · `'block'`(`0x1E86C` SHIELD.VSP) · `'evade'`(`0x1EB66`).
   *   ★ 원본 묶음은 **공격 하나 + 판정 하나**다 (`0x51D46 cmp cl,2`) —
   *     그래서 판정들을 **그 공격의 `results`** 로 넘긴다 (아래 `짝`). */
  /* ★★★ **공격이 없으면 `null` 을 동기로 준다** — `Promise.resolve(null)` 을 주면
   *   호출부의 `.then` 이 **한 틱을 쓴다.** 비동기 시험 ④(대사 붙잡힘)가 그것을 잡았다.
   *   `_등장연출` 의 「연출이 없으면 한 틱도 안 쓰고 바로 잇는다」와 같은 규칙이다. */
  if (!공격들.length) return null;
  if (!살아있나()) return { 취소됨: true };
  /* ★★★★★ **판정은 «자기 묶음»의 것만** — 공격 하나 뒤에 이어 온 판정까지 (`0x51D46` 묶음 = 공격 + 판정)
   *   ☠ 보류에 평타 묶음 여럿이 한꺼번에 쌓이는데(16-1A 넷) 판정 전부를 평타마다 넘겨,
   *     휘두르는 라시드 자신이 «막기» 대상이 돼 돌아서고 크로우는 차례도 아닌데 피하며 방향이 바뀌었다
   *     (2026-10-10 사장님 「서로 마주보고 주고받아야하는데 이상한데로 칼을 휘두른다고」 · 「이동없이계속 휘두르는데 방향을 왜바꾸는건데」) */
  var 짝 = [], 지금 = null;
  (보류 || []).forEach(function (x) {
    if (!x) return;
    if (x.kind === 'sceAttack') { 지금 = []; 짝.push(지금); }
    else if (x.kind === 'sceHit' && 지금) 지금.push(x);
  });
  return 공격들.reduce(function (사슬, x, 번) {
    var 판정들 = 짝[번] || [];
    return 사슬.then(function () {
      /* ★ 연출 사이에도 취소를 본다 — 퇴장과 같은 규칙 (GPT 57차 ②④) */
      if (!살아있나() || !x.유닛 || x.유닛.alive === false) return null;
      /* ★ 대본 공격도 크리티컬이면 마법검 — 원본 공격 연출 루틴 0x1E989 가 [0x80B8C]=1 이면 0x19168(무기 전용 마법)을 부른다(공격모션_분석 116·175). 대본 공격(0x1E61D)도 같은 루틴이라 멸살지옥검(다크존) 같은 무기 효과가 난다.
       *   연출만 — 판정 대상의 HP·생사·상태는 호출 전으로 되돌리고(이벤트 전투에서 실제 피해는 안 낸다) 피해 숫자도 안 띄운다 (사장님 11-11 「칼스가 크리티컬 모션으로 칼 휘두를 때 멸살지옥검 크리티컬 이펙트(다크존) 나와야하는데 안나와」) */
      var 마검 = null;
      if (x.크리티컬 && root.G2Combat && typeof root.G2Combat.마법검쏘기 === 'function') {
        var 대상들 = 판정들.map(function (h) { return h.유닛; }).filter(function (u) { return !!u; });
        var 스냅 = [x.유닛].concat(대상들).map(function (u) { return [u, u.hp, u.alive, u.dead, u.ailment, u.mp, u.tp, u.chargeTp]; });
        try { 마검 = root.G2Combat.마법검쏘기(self.battle, x.유닛, true, 대상들, { rng: self.rng || (self.svc && self.svc.rng) || null }); } catch (e마) { 마검 = null; }
        스냅.forEach(function (q) { q[0].hp = q[1]; q[0].alive = q[2]; q[0].dead = q[3]; q[0].ailment = q[4]; q[0].mp = q[5]; q[0].tp = q[6]; q[0].chargeTp = q[7]; });
        if (마검 && 마검.result) { 마검.result.deaths = []; 마검.result.exp = []; (마검.result.results || []).forEach(function (r) { if (r) { r.damage = null; r.dead = false; } }); }
        if (!(마검 && 마검.fired)) 마검 = null;
      }
      return self._연출실행('attack', {
        actor: x.유닛,
        report: {
          attackType: x.크리티컬 ? 1 : 0,          /* 0x80B8C */
          magicSword: 마검 || undefined,
          /* ★ 묶음 판정을 대상별 결과로 (`0x51D58` → `[0xF0430+i*2]`) */
          results: 판정들.map(function (h) {
            /* ★ `damage` 를 **주지 않는다** — SCE 판정 말단(`0x45ED2`·`0x4609A`·
             *   `0x461C6`)은 넉백 벡터만 세우고 숫자(`0x1EB27`)를 안 부른다.
             *   `0` 을 주면 `0x45E21` 의 **「miss」** 가 떴다 (사용자 지적 2026-08-24). */
            return { unit: h.유닛, result: h.판정, damage: null };
          })
        }
      });
    });
  }, Promise.resolve(null));
};

/**
 * ★★★★★ **`op 0x0A` 피해 연출** — 넉백 + 피격음 (`0x52218` · 2026-08-24)
 *
 *   ```asm
 *   0x5220A  sub [ecx+0x48], edi     ; HP 는 `unitHP` 가 이미 옮겼다
 *   0x52218  call 0x45ED2            ; ★ 넉백 벡터 (arg = 방향 0~3)
 *   0x5221D  eax=5 / edx=1 / call 0x1033B   ; ★ **틱 5**
 *   0x52248  call 0x454B3            ;   화면 다시 그리기
 *   0x52253  call 0x45F29            ; ★ 피격음 — `i=0` 이라 `rnd(0)=0` = **즉시**
 *   ```
 *   ☒ 「피해 숫자는 없다」는 틀렸다 (2026-10-05) — 0x5219C 카메라 · 0x52205 0x45BFB 숫자 · 0x45CCB 루프 · 0x5228C 자세 되돌림.
 *   ★ 방향이 `null`(원본 `0x45EEE` 의 `ja` 갈래)이면 **넉백 없이 소리만**.
 */
Controller.prototype._SCE피격연출 = function (보류, 살아있나) {
  var self = this;
  if (typeof 살아있나 !== 'function')
    throw new Error('_SCE피격연출: 살아있나 는 **필수 인자**다 (취소 계약)');
  var 것들 = (보류 || []).filter(function (x) { return x && x.kind === 'sceHurt'; });
  /* ★ 없으면 **동기로 `null`** — 한 틱도 안 쓴다 (`_등장연출` 과 같은 규칙) */
  if (!것들.length) return null;
  if (!살아있나()) return { 취소됨: true };
  return self._연출실행('hurt', {
    units: 것들.map(function (x) { return x.유닛; }),
    dirs: 것들.map(function (x) { return x.방향; }),
    피해들: 것들.map(function (x) { return x.피해 | 0; }),   /* 0x52205 0x45BFB */
    카메라: true,                                           /* 0x5219C 0x1124A */
    살아있나: 살아있나
  });
};

/** 퇴장 연출이 끝난 유닛의 제거와 후속 상태 전이를 확정한다. */
Controller.prototype._퇴장확정 = function (보류, 살아있나) {
  var self = this;
  /* ★★★ **필수 인자**다 (GPT 58차 ④). 선택으로 두었더니 통합 하네스 래퍼가
   *   조용히 버려 **취소 계약을 검증하지 못하고 있었다.**
   *   독립 시험은 `function () { return true; }` 를 명시적으로 넘긴다. */
  if (typeof 살아있나 !== 'function')
    throw new Error('_퇴장확정: `살아있나` 는 필수다 — 취소 경계 없이 부르면 안 된다');
  var A = root.G2SceApply;
  if (!보류 || !보류.length || !A) return Promise.resolve(null);
  /* ★ 보류에는 **이동**도 섞여 있다 — 퇴장만 고른다 (GPT 37차 ⑪) */
  var 퇴장들 = 보류.filter(function (x) { return x.kind === 'unitLeave'; });
  if (!퇴장들.length) return Promise.resolve(null);
  /* ★ ① 들어올 때 — 이미 무효면 연출조차 시작하지 않는다 */
  if (!살아있나()) return Promise.resolve({ 취소됨: true });

  /* ★★★★★ **갈래마다 연출이 다르다** (2026-08-22 — `0x508E6` 을 `ret` 까지 읽고 정정)
   *
   *   | 갈래 | 원본 | 연출 |
   *   |---|---|---|
   *   | `걸어서` (모드 0) | `0x17071` | 맵 가장자리까지 **걷는다** — ★ 드라이버 아직 없음 |
   *   | `페이드` (모드 1) | `0x508E6(4)` | 제자리 **8단계 페이드** — `leave` 드라이버 |
   *   | `즉시` (2·3·4) | `0x50AA7` | **연출 없음** |
   *
   *   ★ 셋 다 `0x197AD`(대기열) + `0x113CC`(진영 리스트)로 **똑같이 뺀다** —
   *     예전에 「모드 1 은 안 뺀다」고 적었던 것은 `0x50A28` 을 놓친 탓이다.
   *
   *   ★ 세 갈래를 **동시에** 돌린다 — 원본도 대상 배열을 한 루프에서 훑는다.
   *     묶음(`0x51683` 연속 `0x04`)은 보류에 이미 다 모여 있다. */
  var 걷는들 = [], 페이드들 = [], 걷는방향들 = [], 위로들 = [];
  퇴장들.forEach(function (x) {
    if (x.갈래 === '페이드') 페이드들.push(x.유닛);
    else if (x.갈래 === '즉시') { /* 연출 없음 (`0x50B19` — 모드가 2·3·4 도 아닌 그 밖) */ }
    /* ★★★★★ **모드 2·3·4 는 걸어 나가는 것이 아니다** (2026-09-04)
     *
     *   ☠ 전에는 이 셋이 아래 `else`(= 걸어서)로 떨어졌다. 그러면 **흩어져 사라져야 할
     *     유닛이 걸어 나간다.** 원본 `0x50AA7` 은 `si` 로 셋을 가른다:
     *       `0x50B1B  si==2 → 0x46710`  난수 픽셀을 `0xFF` 로 흩어 지운다
     *       `0x50B28  si==3 → 0x468BC`  위로 날린다
     *       `0x50B2F  si==4 → 0x46A11`  16 프레임 소멸
     *
     *   ☐ **그 세 연출 드라이버가 아직 없다.** 지금은 페이드로 물러난다 —
     *     걸어 나가는 것보다는 가깝지만 **원본과 다르다.**
     *     드라이버를 만들면 여기서 갈라 보낸다.
     *   자세히: `03_분석/_보관/끝난조사/00_지금조사_SCE퇴장.md` */
    /* ★ 모드 3 = **위로 날아간다** — 드라이버 `소멸위로` 가 원본 `0x468BC` 를 옮겼다
     *   (처음 속도 1 · 5번째 걸음부터 배로 · y −100 이면 안 그림 · 2026-09-04). */
    else if (x.갈래 === '위로') 위로들.push(x.유닛);
    /* ☐ 모드 2(`0x46710`)·모드 4(`0x46A11`)는 스프라이트 픽셀을 난수로 `0xFF` 로
     *   지우는 연출이라 렌더러 창구가 필요하다. 불투명도로 흉내내면 모양이
     *   달라지므로(CLAUDE.md §6 근사 금지) **아직 안 넣고** 페이드로 물러난다.
     *   ⇒ 원본과 다르다. 드라이버가 생기면 여기서 갈라 보낸다. */
    else if (x.갈래 === '흩어짐' || x.갈래 === '소멸16') {
      페이드들.push(x.유닛);
      if (root.console && root.console.warn && !Controller._소멸경고했나) {
        Controller._소멸경고했나 = 1;
        root.console.warn('[_퇴장확정] ☐ 소멸 연출 「' + x.갈래 + '」 드라이버가 없다 — ' +
                          '페이드로 물러난다 (원본 0x46710 / 0x46A11 은 픽셀을 지운다)');
      }
    }
    else {                                          /* 기본 = 걸어서 (0x17071) */
      걷는들.push(x.유닛);
      /* ★★★ 방향은 **명령의 다섯째 인자(+5)**다 — 유닛의 현 방향이 아니다
       *   (`0x51523` 이 인자를 하나 더 읽어 `0x51557` 에서 방향으로 쓴다).
       *   실측 1-1A `04 01 08 00 00 00` → 0 = 남(아래). 사용자 지적과 일치. */
      걷는방향들.push(x.방향 | 0);
    }
  });

  /* ★★★ **드라이버가 없으면 `Anim.play()` 는 즉시 완료한다** (GPT 36차 ⑦) —
   *   그러면 「연출 뒤 확정」이 사실상 「즉시 확정」이다. 그것을 **드러낸다.**
   *   ★ 걷기(`leaveWalk`)와 페이드(`leave`)는 **다른 kind** 다 — 하나로 묶으면
   *     걸어 나가야 할 유닛에 페이드가 붙는다. */
  var A2 = self.svc.anim;
  if (걷는들.length && A2 && A2.드라이버있나 && !A2.드라이버있나('leaveWalk')) {
    if (root.console && root.console.warn) {
      root.console.warn('[_퇴장확정] ★ leaveWalk 드라이버가 없다 — 걸어 나가는 연출 없이 ' +
                        '즉시 확정한다 (원본 0x17071 은 걸은 뒤 0x17263)');
    }
  }
  /* ★★★★★ **제거 시점을 원본에 맞춘다** (2026-08-22 · GPT 42차 ①)
   *
   *   원본은 페이드가 **다 끝난 뒤**가 아니라 **단계가 6 이 되는 순간**
   *   (첫 감소 `7→6`) `0x509FE call 0x197AD` · `0x50A28 call 0x113CC` 로 뺀다.
   *   끝나고 빼면 페이드 대부분 동안 유닛이 논리적으로 **남아 있어** 원본과 다르다.
   *
   *   ⇒ 드라이버에 `제거` 콜백을 넘겨 **그 순간** 확정한다. 확정한 것은 기억해 두고
   *     아래 마무리에서 **두 번 확정하지 않는다.**
   *   ★ 콜백 안에서도 `살아있나()` 를 본다 — 연출 도중 세대가 바뀌면 확정하지 않는다.
   *
   *   ★ 걸어 나가기(`0x17071`)는 원본도 **다 걸은 뒤**(`0x1723A`·`0x17263`)라
   *     콜백이 없다 — 아래 마무리에서 확정한다. */
  var 확정됨 = [];
  function 지금확정(u) {
    if (!u || 확정됨.indexOf(u) >= 0) return false;
    if (!살아있나()) return false;
    확정됨.push(u);
    A.퇴장(self.battle, u);                      /* 0x197AD + 0x113CC */
    self._SCE뒷정리([{ 유닛: u, kind: 'unitLeave' }]);
    return true;
  }

  var 연출들 = [];
  if (걷는들.length)
    연출들.push(self._연출실행('leaveWalk', { units: 걷는들, dirs: 걷는방향들,
                                          살아있나: 살아있나 }));
  if (페이드들.length)
    연출들.push(self._연출실행('leave', { units: 페이드들, mode: 1,
                                      살아있나: 살아있나, 제거: 지금확정 }));
  /* ★ 모드 3 소멸 — 원본 `0x468BC` 를 옮긴 드라이버 (2026-09-04 · 11-16 정본 256).
   *   원본 `0x50AA7` 은 대상을 **한 명씩** 날리고 그 유닛이 끝나자마자 `0x50B56 0x197AD` → `0x50B7F 0x113CC` 로 뺀다
   *   (카메라 창 밖이면 연출 없이 곧바로) — 드라이버가 유닛마다 `제거` 를 부른다. */
  if (위로들.length)
    연출들.push(self._연출실행('소멸위로', { units: 위로들, 살아있나: 살아있나, 제거: 지금확정 }));

  return Promise.all(연출들).then(function () {
    /* ★★★★★ ② 연출이 끝난 **뒤** — 그 사이 세대·전투가 바뀌었으면 **확정하지 않는다** */
    if (!살아있나()) {
      if (root.console && root.console.warn) {
        root.console.warn('[_퇴장확정] 연출 도중 세대가 바뀌었다 — **확정하지 않는다** ' +
                          '(퇴장 ' + 퇴장들.length + '건)');
      }
      return { 취소됨: true };
    }
    /* ★ 페이드가 단계 6 에서 이미 확정한 것은 **두 번 하지 않는다** */
    var 남은 = 퇴장들.filter(function (x) { return 확정됨.indexOf(x.유닛) < 0; });
    남은.forEach(function (x) { A.퇴장(self.battle, x.유닛); });
    if (남은.length) self._SCE뒷정리(남은.map(function (x) {
      return { 유닛: x.유닛, kind: 'unitLeave' };
    }));
    return null;
  });
};


/**
 * ★★★★★ **유닛 등장을 연출한다** (`op 0x03` · 2026-08-22)
 *
 *   원본 `0x50D9F` 는 **먼저 놓고 연출한다** — `0x50E25` 슬롯 할당 →
 *   `0x51127` 진영 리스트 추가 → 그 **뒤** 연출. 퇴장과 **반대**다.
 *   그래서 `sceapply` 가 보류하지 않고 곧바로 적용하고, 여기서는 **연출만** 한다.
 *
 *   | 모드 | 원본 | 연출 |
 *   |:--:|---|---|
 *   | **0** | `0x511F6 call 0x16D3E` | 경로를 따라 **걸어 들어온다** (207건) |
 *   | 그 밖 | `0x51202 eax=3 / call 0x508E6` | **8단계 페이드 인** (53건) |
 *
 *   ★ 페이드 인은 `leave` 드라이버에 **`mode:3`** 으로 태운다 — 원본이 같은 함수다.
 *   ★ 걷기는 `move` 드라이버를 쓴다. `sceapply` 가 이미 **마지막 경로점**에 놓았으므로
 *     `DRIVER.move` 의 「이미 커밋된 상태」 계약이 그대로 맞는다.
 *
 * @param {Array} 바뀐유닛 `SCE변경적용()` 이 돌려준 목록
 * @param {function} 살아있나 취소 경계 — **필수**
 */
Controller.prototype._등장연출 = function (바뀐유닛, 살아있나) {
  var self = this;
  if (typeof 살아있나 !== 'function')
    throw new Error('_등장연출: `살아있나` 는 필수다 — 취소 경계 없이 부르면 안 된다');
  /* ★★★ 할 일이 없으면 **동기로** 돌려준다 — Promise 를 돌려주면 마이크로태스크가
   *   한 번 더 들어 **뒤 연출이 한 틱 밀린다**(비동기 시험이 잡았다). */
  if (!바뀐유닛 || !바뀐유닛.length) return null;
  var 등장들 = 바뀐유닛.filter(function (x) { return x && x.kind === 'spawn'; });
  if (!등장들.length) return null;
  if (!살아있나()) return { 취소됨: true };

  /* ★★★★★ **묶음은 한 번에 연출한다** (2026-08-22 · GPT 46차 ②)
   *   원본은 같은 모드의 연속 레코드를 **전부 슬롯·목록에 넣은 뒤**
   *   `[0x80B9E] = 개수` 로 `0x16D3E`(또는 `0x508E6`)를 **한 번** 부른다.
   *   한 소비 바퀴의 `바뀐유닛` 을 통째로 모으므로 자연히 같은 모양이 된다.
   *   ★ 페이드는 `units` 배열로 한 번, 걷기는 유닛마다 부르되 `Promise.all` 로 **동시**다.
   *
   *   ★★★ **시작 지연**(`p+2` → `0x75A50`)이 유닛마다 다르다 —
   *     `0x17132 cmp [eax+0x75A50], 0 / jne` 가 「0 이 아니면 이번 프레임은 쉰다」이므로
   *     지연이 큰 유닛은 **늦게 출발**한다. 프레임 하나 = `WALK.frameTicks`(5틱)로 잰다. */
  var 걷는들 = [], 페이드들 = [];
  등장들.forEach(function (x) {
    if (x.갈래 === '페이드') 페이드들.push(x);   /* ★ 지연이 필요하므로 통째로 */
    else 걷는들.push(x);                       /* 경로가 필요하므로 통째로 */
  });

  /* ★★★★★ **이벤트 행진 시계 — 한 걸음 = 4프레임 × 9틱** (2026-08-22 확정)
   *
   *   0x16DDE  eax = 9 / call 0x1033B     ; ★ 프레임 **간격**을 9틱으로 설정
   *                                        (0x1033B 는 [0x4] = ax 만 하고 안 기다린다)
   *   0x16EBC  ┌ 프레임 루프
   *   0x16EC6  │   call 0x499E4            ; ★ 그 간격만큼 **기다린다**
   *   0x17018  │   [esp+0x40]++ / cmp ax, 4 / jl 0x16EBC   ; ★ **4프레임**
   *   0x17026  └ inc [esp+0x48]            ; ★ **걸음** 하나
   *   0x1702A  cmp ax, [0x7DD74] / jl      ;   걸음 상한
   *
   *   ★ `[0x75A50]` 은 `0x16EF1` 에서 **경로 걸음 번호**로 쓰인다
   *     (`idx*64 + 값*2` 로 `0x75210` 배열을 색인). 음수면 아직 출발 전이다.
   *   ⇒ 시작 지연 한 단위 = **걸음 하나 = 4 × 9틱**. */
  /* ★★★★★ **걷기와 페이드는 시계가 다르다** (2026-08-22 · GPT 48차 ④)
   *
   *   | | 프레임 간격 | 한 단위 | 합 |
   *   |---|---|---|---|
   *   | 걷기 `0x16D3E` | `0x16DDE` **9틱** | `0x1701C` **4프레임** | **36틱** |
   *   | 페이드 `0x508E6` | `0x5093D` **12틱** | `0x50986 test di,1` **2프레임** | **24틱** |
   *
   *   페이드에 걷기 단위를 쓰면 **1.5배 늦다.** */
  var TICK = (root.G2Anim && root.G2Anim.TICK_MS) || (1000 / 175.47);
  var 걷기단위틱 = 4 * 9;                        /* 0x1701C × 0x16DDE */
  var 페이드단위틱 = 2 * 12;                     /* 0x50986 × 0x5093D */
  /* ★★★★★ **지연은 프레임 수로 센다 — 간격은 연출이 정한다** (2026-08-22 · GPT 49차)
   *
   *   원본 `0x1033B` 가 `[0x4]` 에 간격을 넣고 `0x499E4` 가 그만큼 기다린다.
   *   우리도 `__프레임틱(n)` 으로 간격을 지정하고 `__프레임대기()` 를 **프레임 수만큼** 센다.
   *   ⇒ `BattleFreeze` 중에는 프레임이 안 와서 **지연도 안 흐른다** (벽시계를 안 본다).
   *
   *     걷기  0x16DDE **9틱** × 0x1701C **4프레임** = 한 걸음
   *     페이드 0x5093D **12틱** × 0x50986 **2프레임** = 한 단계
   */
  function 프레임틱(n) {
    var 시계 = root.G2FrameClock;
    if (시계 && typeof 시계.틱설정 === 'function') 시계.틱설정(n);
    else if (typeof root.__프레임틱 === 'function') root.__프레임틱(n); /* 독립 하네스 호환 */
  }
  function 늦게프레임(단위, 프레임당, 틱) {
    var n = (단위 | 0) * (프레임당 | 0);
    if (n <= 0) return null;
    var 시계 = root.G2FrameClock;
    var FW = 시계 && typeof 시계.다음프레임 === 'function'
      ? 시계.다음프레임 : root.__프레임대기; /* 독립 하네스 호환 */
    /* 독립 하네스도 브라우저 벽시계를 직접 잡지 않고 주입 시간원을 쓴다. */
    if (typeof FW !== 'function') {
      var 지연 = self.svc.delay || self.svc.wait;
      return typeof 지연 === 'function' ? 지연(n * 틱 * TICK) : Promise.resolve();
    }
    /* ★★★★★ **대기 프레임에도 카메라는 흐른다** (2026-08-28)
     *   원본 등장/퇴장 루프는 지연 구간에서도 `0x5095A call 0x4559F`(맵 + 카메라 한
     *   걸음)를 **매 프레임** 부른다. `__프레임대기()` 를 인자 없이 부르면 정책이
     *   `null` 이라 `SCE_STEP_5046B` 요청이 안 나가 **그 동안 카메라가 선다**
     *   (실측 1-5: op0F 뒤 24프레임에 카메라 3걸음). */
    var 정책 = { 출처: 'sce.등장지연/0x5095A',
                 after: (root.G2FRAME_OP && root.G2FRAME_OP.SCE_STEP_5046B) || 1 };
    var p = Promise.resolve();
    for (var i = 0; i < n; i++) p = p.then(function () { return FW(정책); });
    return p;
  }
  function 늦게(대기, f) {
    if (!대기) return f();
    return Promise.resolve(대기).then(f);
  }

  /* ★★★★★ **명령 순서를 보존한다** (2026-08-22 · GPT 51차 ②)
   *
   *   원본은 `0x50DE8` 에서 모드가 다르면 **현재 묶음만** 끝내고, 디스패처가 다음
   *   명령을 **순서대로** 실행한다. 명령열이 `걷기 묶음 → 페이드 묶음` 이면
   *   연출도 그 순서여야 한다.
   *   ★ 전에는 「페이드 전체 → 걷기 전체」로 **재배열**했다 — 원본과 순서가 뒤집힌다.
   *
   *   ⇒ `바뀐유닛` 배열 순서(= 명령 순서)대로 **갈래가 바뀔 때마다 새 묶음**을 열고,
   *     묶음끼리는 **순차**, 묶음 안에서는 **동시**로 돌린다.
   *     (프레임 간격 `[0x4]` 는 전역 하나라 다른 간격이 겹치면 안 된다) */
  var 묶음들 = [];
  등장들.forEach(function (x) {
    var 갈래 = (x.갈래 === '페이드') ? '페이드' : '걸어서';
    var 끝 = 묶음들[묶음들.length - 1];
    /* 갈래가 같고 `묶음ID` 도 같으면(또는 둘 다 없으면) 이어 붙인다 */
    if (끝 && 끝.갈래 === 갈래 && 끝.묶음ID === x.묶음ID) 끝.항목.push(x);
    else 묶음들.push({ 갈래: 갈래, 묶음ID: x.묶음ID, 항목: [x] });
  });

  function 한묶음(m) {
    if (m.갈래 === '페이드') {
      /* ★★★★★ **지연은 「대기」가 아니라 루프 안의 음수 단계다** (2026-08-28)
       *
       *   > 사용자: 「원본기준 아래쪽 캐릭터가 **화면 안쪽에 충분히 들어와 있는 상태에서**
       *   >  등장 이펙트가 나오는데 우리는 자꾸 **끄트머리 경계에 걸려서 이펙트가 씹힌다**」
       *
       *   원본 `op 0x03` 은 지연을 **음수 단계**로 넣고 등장 루프를 **한 번** 돈다 —
       *     0x512B1  neg dl                   ; dl = −지연
       *     0x512B3  mov [i+0xE5A50], dl      ;   유닛별 페이드 단계
       *     0x51354  cmp ax,[0xEDD74] / jle   ; ★ [0xEDD74] 에는 **최대 지연**만 남는다
       *     0x50947  mov di,[0xEDD74]         ;   (+8, ×2) = 루프 총 프레임
       *     0x5095A  call 0x4559F             ; ★ **첫 프레임부터** 맵+카메라 한 걸음
       *     0x50276  단계 0~7 밖이면 안 그린다 ;   음수 동안은 화면에 없다
       *
       *   ☠ 우리는 지연을 루프 **밖**에서 `늦게프레임()`(= `__프레임대기()`)으로 세었다.
       *     그 창구는 정책 없이 부르면 `SCE_STEP_5046B` 요청을 안 내므로 **그 동안
       *     카메라가 선다.** 실측(1-5 아래쪽 킬러 · 지연 10·15):
       *     op0F 발행 뒤 **24프레임에 카메라가 3걸음**만 갔고, 페이드가 시작될 때
       *     유닛은 아직 화면 밖(y 815 > 화면높이 805)이었다 — 그래서 이펙트가 잘렸다.
       *
       *   ⇒ 묶음을 **쪼개지 않고** `지연들` 을 통째로 넘긴다. 루프 길이는
       *     `_연출실행('leave')` 가 `(최대지연 + 8) × 2` 로 잡고(0x50947·0x50953),
       *     매 프레임 `__프레임작업요청("sce.등장퇴장/0x5095A")` 를 낸다. */
      var 지연들 = {};
      var us묶 = [];
      m.항목.forEach(function (x) {
        if (!x.유닛) return;
        지연들[x.유닛.id] = (x.지연 | 0);
        us묶.push(x.유닛);
      });
      프레임틱(12);                                /* 0x5093D */
      if (!살아있나()) return null;
      return self._연출실행('leave', { units: us묶, mode: 3, 지연들: 지연들, 살아있나: 살아있나 });
    }
    var 갈것 = m.항목.filter(function (x) { return x.path && x.path.length >= 2; });
    if (!갈것.length) return null;                 /* 경로가 없으면 그냥 나타난다 */
    /* ★★★★★ **걸어 들어오는 등장은 「경로 첫 칸」에서 시작한다** (2026-08-24)
     *
     *   사용자 지적: 「2-6 에서 번스타인, 카슈타르와 제네럴2 패러딘2 등장할 때,
     *   **한꺼번에 먼저 나타났는데 뒤에서 또 나와서 겹쳐져.**」
     *
     *   까닭: `sceapply 등장()` 이 `옮기기(battle, u, x, y)` 로 유닛을 **목적지에
     *   즉시** 놓는다(원본 `0x50E25` 슬롯 등록 ↔ `0x51127` 리스트 연결에 해당).
     *   그런데 걷기 연출은 `path[0]`(화면 밖)부터 재생하므로, **목적지의 그림**과
     *   **걸어 오는 그림**이 동시에 보여 겹쳤다.
     *
     *   원본에서 「먼저 놓는다」는 **슬롯·리스트 등록**이고, 화면에 그리는 좌표는
     *   `0x16D3E` 걷기가 **경로 시작점부터** 굴린다(`0x15F47` 이 칸 절반에서 갱신).
     *   ⇒ 연출 직전에 좌표를 **경로 첫 칸**으로 놓는다. 드라이버가 걸음마다 갱신하고,
     *     `finish()` 가 경로 마지막 칸(= 목적지)에서 멈춘다.
     *   ★ 이동(`op 0x05`)의 `dest` 문제와 **같은 뿌리**다 — 좌표를 놓는 시점과
     *     연출이 읽는 시점이 어긋나 있었다. */
    갈것.forEach(function (x) {
      var u = x.유닛, p0 = x.path[0];
      if (u && p0 && (u.x !== p0.x || u.y !== p0.y)) {
        var A0 = root.G2SceApply;
        if (A0 && typeof A0.옮기기 === 'function') A0.옮기기(self.battle, u, p0.x, p0.y);
        else { u.x = p0.x; u.y = p0.y; }
      }
    });
    프레임틱(9);                                   /* 0x16DDE */
    return Promise.all(갈것.map(function (x) {
      /* 0x1701C (4프레임) × 0x16DDE (9틱) = 한 걸음 */
      return 늦게(늦게프레임((x.지연 | 0), 4, 9), function () {
        if (!살아있나()) return null;
        /* ☠★★★★★ **최종 방향을 넘긴다 — `0x16F73`** (2026-09-22)
         *
         *   > 사장님: 「1-1a 의 경우 **제국병이 오른쪽을 바라봐야하는데 정면을 바라봐**.
         *   >  … 이동후 방향지정 관련 문제가 있는 걸로 보여」
         *
         *   원본 `0x16F5D` — 경로 종단(`0xFF`)을 만나면
         *   `0x16F6D mov dl,[idx+0xE5AD0]` · `0x16F73 mov [edi+0x63],dl` 로
         *   **꼬리 첫 바이트(최종 방향)를 다시 세운다.** 걷는 동안의 방향(`0x16E2B`)은
         *   연출일 뿐이라 마지막에 덮인다.
         *
         *   ☠ 여기 옛 주석은 「`sceapply 등장()` 이 놓은 `u.dir` 을 `DRIVER.move` 의
         *     `dest.dir` 이 되돌린다」였는데 — **`finish()` 는 `dest.dir` 을 안 쓴다.**
         *     그래서 걸음마다 찍힌 방향이 그대로 남아 최종 방향이 통째로 없어졌다.
         *     실측 1-1A — `op03` 세 유닛의 최종방향은 `0·0·**3**(동)` 인데 셋 다 남(0)이었다
         *     (0 인 둘은 티가 안 나 「정상」으로 보였다).
         *   ⇒ 등장 걷기도 `facing` 을 실어 `finish()` 가 `0x16F73` 을 하게 한다. */
        /* ★★★ **행진 인원 수를 넘긴다** — `0x16D59 dx = [0x80B9E]` (2026-08-28)
         *   발소리 범위가 이 수로 갈린다(혼자 1 · 여럿 4 · `0x16D60`).
         *   ☠ 안 넘겨서 늘 「혼자」로 잡혔고, 넷이 **같은 순간**에 울려
         *     슬롯 하나에 셋이 막혔다(실측: 4회 중 3회 `막힘`). */
        return Promise.resolve(self._연출실행('move', { unit: x.유닛, path: x.path, event: true,
                                    facing: (x.dir != null) ? (x.dir & 3) : null,
                                    묶음: 갈것.length })).then(function (v) {
          /* ★★★★★ **다 걸었으면 점유도 목적지로** (2026-10-05)
           *   걷기 등장은 시작 칸(path[0])에 점유를 놓고(위 옮기기) 걸어 들어온다. 이동 연출(DRIVER.move finish)은
           *   좌표만 바꾸고 점유표는 안 건드린다 — 이벤트 이동(op 0x05)은 연출 뒤 sceapply 가 옮기지만 등장 걷기는 아무도 안 옮겼다.
           *   ☠ 그래서 등장한 적이 선 칸을 눌러도 비어 있어 선택이 안 됐고, 시작 칸에 보이지 않는 점유가 남았다
           *     (사장님 「2-6에서 이벤트로 등장하는 적 선택이 안되는 문제가 있어」) · 원본 0x16D3E 행진은 걸음마다 칸을 옮긴다 */
          var u끝 = x.유닛, 끝 = x.path[x.path.length - 1];
          if (u끝 && 끝 && u끝.alive !== false && self.battle && self.battle.at(끝.x | 0, 끝.y | 0) !== u끝) {
            var A1 = root.G2SceApply;
            if (A1 && typeof A1.옮기기 === 'function') A1.옮기기(self.battle, u끝, 끝.x, 끝.y);
            else if (self.battle.moveUnit) self.battle.moveUnit(u끝, 끝.x | 0, 끝.y | 0);
          }
          return v;
        });
      });
    }));
  }

  if (!묶음들.length) return null;

  /* ★★★★★ **예외에도 반드시 되돌린다** (GPT 50차 ③)
   *   성공 `.then` 에만 두면 `_연출실행` 이 거부될 때 프레임 간격이 **9 또는 12 로 굳는다.** */
  function 정리() { 프레임틱(null); }

  var 사슬 = Promise.resolve(null);
  묶음들.forEach(function (m) {
    사슬 = 사슬.then(function () {
      if (!살아있나()) return null;
      return 한묶음(m);
    });
  });

  return 사슬.then(function () {
    정리();
    if (!살아있나()) {
      if (root.console && root.console.warn) {
        root.console.warn('[_등장연출] 연출 도중 세대가 바뀌었다 (등장 ' + 등장들.length + '건)');
      }
      return { 취소됨: true };
    }
    return null;
  }, function (e) {
    정리();                                        /* ★ 거부돼도 되돌린다 */
    throw e;
  });
};

/**
 * ★★★ **이동을 연출 뒤에 확정한다** (2026-08-22 · GPT 37차 ⑪)
 *   좌표를 먼저 옮기면 이동 드라이버가 **이미 도착한 유닛**을 다시 움직인다.
 *   ★ 연출은 `_SCE연출('movement')` 이 이미 했다 — 여기서는 **확정만** 한다.
 */
Controller.prototype._이동확정 = function (보류, 살아있나) {
  var self = this;
  /* ★★★ **필수 인자**다 (GPT 58차 ④) */
  if (typeof 살아있나 !== 'function')
    throw new Error('_이동확정: `살아있나` 는 필수다 — 취소 경계 없이 부르면 안 된다');
  var A = root.G2SceApply;
  if (!보류 || !보류.length || !A) return null;
  /* ★ 취소 경계 — 앞선 연출을 기다린 뒤 불릴 수 있다 (GPT 57차 ⑤) */
  if (!살아있나()) return { 취소됨: true };
  /* ★★★★★ **`kind` 로 걸러야 한다** (2026-08-22 · 비동기 시험이 잡았다)
   *
   *   보류에는 **퇴장(`unitLeave`)도 섞여 있다** — `_퇴장확정()` 은
   *   `filter(x => x.kind === 'unitLeave')` 로 거르는데 여기만 안 걸렀다.
   *   그래서 걸어 나가는 퇴장 유닛이 `옮기기(…, undefined, undefined)` 로
   *   **`moveUnit(u, 0, 0)`** 되어 **(0,0) 으로 끌려갔다.**
   *
   *   ★ 실측: `op 0x04 mode 0` 하나만 있는 이벤트에서
   *     `alive=false` 인데 `_cells=[0]` · 좌표 `0,0` 이 됐다.
   *     후보 94개에는 걸어 나가는 퇴장이 없어 회귀에 안 잡혔다 —
   *     **지연 Promise 로 퇴장을 붙잡는 시험**이 드러냈다. */
  var 이동들 = 보류.filter(function (x) { return x && x.kind === 'move'; });
  if (!이동들.length) return null;
  이동들.forEach(function (x) { A.옮기기(self.battle, x.유닛, x.x, x.y); });
  self._SCE뒷정리(이동들.map(function (x) { return { 유닛: x.유닛, kind: 'move' }; }));
  return null;
};

/**
 * ★★★★★ **SceRuntime 결과 소비 오케스트레이터** (2026-08-22 · GPT 35차 ⑭-3)
 *
 *   `sceruntime` 의 계약:
 *
 *   ```
 *   스캔(섹션, 문맥) / 실행()  →  { 변경, 거부, outcome, nextScenario, 대기, 이어서 }
 *   대기 != null 이면 **거기서 멈춘다** — 연출을 끝내고 재개() 를 부른다
 *   재개()                      →  같은 모양의 결과
 *   ```
 *
 *   ⇒ 이 함수가 그 사슬을 돈다:
 *
 *   ```
 *   변경 적용 → (보류가 있으면) 연출 → 확정 → 대기 연출 → 재개 → …
 *            → outcome · nextScenario 를 상위로
 *   ```
 *
 *   ★★★ **`재개()` 는 정확히 한 번**이다 — `런타임.대기중()` 이 비어 있으면 안 부른다.
 *   ★ `건너뜀` 이 있으면 `SCE변경적용` 이 드러낸다 (조용히 안 넘어간다).
 *   ★ 오류를 **삼키지 않는다** — 던져서 위로 올린다.
 *
 * ★★★ **진입 계약** (2026-08-22 · GPT 37차 ⑦) —
   `첫결과` 는 반드시 **`실행()`** 이 돌려준 것이다.
 *   `스캔()` 은 `{ 발동, 종료사유 }` 만 주고 **큐에 담기만** 한다.
 *   ⇒ 올바른 순서: `스캔(섹션, 문맥)` → **`실행()`** → `SCE결과소비(런타임, 실행결과)`
 *
 * @param {object} 런타임 `G2SceRuntime.생성()` 결과
 * @param {object} 첫결과 ★ **`실행()`** 이 돌려준 것 (`스캔()` 이 아니다)
 * @returns {Promise<{outcome, nextScenario, 적용, 건너뜀, 바퀴}>}
 */
function SCE멈춤상세(런타임) {
  try {
    var 이력 = (런타임 && 런타임.관찰보기) ? 런타임.관찰보기() : [];
    for (var i = 이력.length - 1; i >= 0; i--) {
      var e = 이력[i];
      if (e && e.상태 === 'error' && e.무엇 === 'command') {
        return '  ⟵ op 0x' + ((e.op | 0).toString(16)) + ' 섹션 ' + e.섹션 +
               ' 명령 ' + e.명령 + (e.사유 ? (' · ' + String(e.사유).slice(0, 200)) : '');
      }
    }
  } catch (e상세) {}
  return '';
}

function SCE비대기연출실행(ctrl, 목록) {
  (목록 || []).forEach(function (요청) {
    if (!요청) return;
    try {
      var 연출 = ctrl._SCE연출(요청.kind || 'effect', { 연출요청: 요청 });
      if (연출 && typeof 연출.then === 'function') {
        연출.then(null, function (e) {
          if (root.console && root.console.warn)
            root.console.warn('[SCE연출] 비대기 연출 실패 — ' + (e && e.message));
        });
      }
    } catch (e2) {
      if (root.console && root.console.warn)
        root.console.warn('[SCE연출] 비대기 연출 실패 — ' + (e2 && e2.message));
    }
  });
}

/* 단일 소비 사슬의 소유권과 이벤트 세션 카운터를 성공·실패 양쪽에서 정리한다. */
function SCE소비사슬추적(ctrl, 사슬) {
  ctrl._SCE소비중 = 사슬;
  ctrl._SCE세션 = (ctrl._SCE세션 | 0) + 1;
  function 닫기() {
    if (ctrl._SCE소비중 === 사슬) ctrl._SCE소비중 = null;
    if ((ctrl._SCE세션 | 0) > 0) ctrl._SCE세션 = (ctrl._SCE세션 | 0) - 1;
  }
  return 사슬.then(function (v) { 닫기(); return v; },
                   function (e) { 닫기(); throw e; });
}

function SCE재진입대기(ctrl, 재진입) {
  if (root.console && root.console.warn)
    root.console.warn('[SCE결과소비] 런타임이 ' + 재진입 +
                      ' 를 기다리는 중이다 — **진행 중인 사슬을 기다린다**');
  var 진행 = ctrl._SCE소비중;
  if (진행 && typeof 진행.then === 'function') {
    return 진행.then(function () { return { 재진입: 재진입, 기다렸다: true }; },
                     function (e) { throw e; });
  }
  return Promise.resolve({ 재진입: 재진입, 기다렸다: false, 사슬없음: true });
}

function SCE소비최종결과(ctrl, 마지막, 살아있나, 적용, 건너뜀, 바퀴) {
  if (!살아있나()) return { 취소됨: true, 적용: 적용, 바퀴: 바퀴 };
  if (마지막.outcome != null && ctrl.pendingOutcome == null && !ctrl.전투끝남) {   /* ★ 셸이 결과를 읽어 비운 뒤 두 번째 결과가 또 서지 않게 (2026-10-12) */
    ctrl.pendingOutcome = 마지막.outcome;
    ctrl.전투끝남 = true;
    ctrl._상태전이(MODE.BATTLE_OUTCOME);
  }
  if (마지막.nextScenario) ctrl.pendingNextScenario = 마지막.nextScenario;
  if (마지막.nextScenario) ctrl.SCE세대올리기('nextScenario: ' + 마지막.nextScenario);
  /* ★ 대본이 판을 끝냈다 — 원본 op 0x01(0x506F3)·0x65·0x12(0x52D75 call 0x61CFF)는 그 자리에서 프로그램을 끝낸다.
   *   남은 사망 연출·경험치 창은 돌지 않는다 (2026-10-06 · 3-8 전체마법 도중 GS 패배 대본 → 남은 캘리퍼 사망이 다음 판 배치 화면에서 돌았다) */
  if (마지막.outcome != null || 마지막.nextScenario) ctrl._대본끝 = true;
  return { outcome: 마지막.outcome, nextScenario: 마지막.nextScenario,
           재진입: 마지막.재진입 || null,
           적용: 적용, 건너뜀: 건너뜀, 바퀴: 바퀴 };
}

function SCE결과거부검사(런타임, 결과) {
  if (결과.거부) {
    throw new Error('SCE결과소비: 사본 적용이 ' + 결과.거부 + '건 거부됐다 — ' +
                    '실제 전투에 **아무것도 옮기지 않는다**');
  }
  if (결과.멈춤 && 결과.멈춤 !== '결말') {
    throw new Error('SCE결과소비: 런타임이 멈췄다 (' + 결과.멈춤 + ')' + SCE멈춤상세(런타임));
  }
}

/** SCE 결과를 대사·이동·효과 프레젠터로 순서대로 소비한다. */
Controller.prototype.SCE결과소비 = function (런타임, 첫결과) {
  var self = this;
  if (!런타임) throw new Error('controller: SceRuntime 이 없다');

  /* ★★★★★ **재진입 역압력 — 단일 소비 사슬** (2026-08-22 · GPT 마감검수 ④)
   *
   *   런타임이 대기 중일 때 `실행()` 이 또 불리면 `{재진입}` 이 온다.
   *   전에는 그 자리에서 **곧바로 완료**했다 — 이벤트가 사라지지는 않지만
   *   (`미룬스캔` FIFO 가 잡아 둔다) **호출자가 기다리지 않아 역압력이 없다.**
   *   그러면 다른 라운드·S3/S4/S5/S11 진입이 앞선 이벤트 처리가 끝나기 전에
   *   전투를 계속 진행시킬 수 있다.
   *
   *   ⇒ **진행 중인 소비 사슬의 Promise 를 그대로 돌려준다.**
  *     원본에는 Promise 도 병렬 `onRound()` 도 없다 —
    *     실행 순서를 보존하는 **단일 사슬**이 가장 가까운 대응이다. */
  if (첫결과 && 첫결과.재진입) {
    return SCE재진입대기(self, 첫결과.재진입);
  }

  var 총적용 = 0, 총건너뜀 = [], 바퀴 = 0;
  var 마지막 = { outcome: null, nextScenario: null, 재진입: null };
  var 상한 = 256;                     /* 무한 루프 방지 — 원본 루프상한 64 보다 넉넉히 */
  /* ★★★★★ **세대를 잡아 둔다** (GPT 37차 ⑥) — 연출이 늦게 끝나 돌아왔을 때
   *   전투가 이미 바뀌었으면 **상태 적용·재개·결과 전달을 모두 중단**한다. */
  var 내세대 = self.SCE세대;
  /* ★★★ **`battle` 객체 동일성도 본다** (GPT 57차 ④) — 세션이 바뀌면 컨트롤러가
   *   새 `battle` 을 들 수 있다. 세대만 보면 그 경계를 놓친다. */
  var 내전투 = self.battle;
  function 살아있나() { return self.SCE세대 === 내세대 && self.battle === 내전투; }

  function 한바퀴(r) {
    if (!r) return Promise.resolve(null);
    /* ★★★★★ 세대가 바뀌었으면 **아무것도 하지 않는다** (GPT 37차 ⑥) */
    if (!살아있나()) {
      if (root.console && root.console.warn) {
        root.console.warn('[SCE결과소비] 세대가 바뀌었다 (' + 내세대 + ' → ' +
                          self.SCE세대 + ') — 중단한다');
      }
      return Promise.resolve(null);
    }
    if (++바퀴 > 상한) throw new Error('SCE결과소비: 바퀴가 ' + 상한 + ' 을 넘었다');

    /* ★★★★★ ① `거부`·`멈춤` 을 **적용보다 먼저** 본다 (GPT 37차 ⑨)
     *   > 「핸들러 반환 위반이나 사본 적용 거부 뒤에도 실제 전투 변경을 적용할 수 있다」
     *   사본이 거부한 것을 실전에만 넣으면 **갈라진다.** */
    /* 거부·멈춤은 실제 전투 적용 전에 검사한다. */
    if (r.거부 || (r.멈춤 && r.멈춤 !== '결말')) {
      /* ★★★★★ **왜 멈췄는지 함께 싣는다** (2026-09-04)
       *   ☠ 전에는 「런타임이 멈췄다 (핸들러 예외)」만 나와서 **어느 op 가 무슨
       *     예외를 냈는지 알 길이 없었다.** 사유는 관찰 이력에만 남는데
       *     (`sceruntime.js:1403` `관찰('command','error',{op, 사유})`)
       *     그 배열은 예외와 함께 사라진다.
       *   ⇒ 이력에서 **마지막 error 한 줄**을 꺼내 붙인다. 「멈췄다」만으로는 못 고친다. */
      SCE결과거부검사(런타임, r);
    }

    /* ★★★★★ **대기 중 재진입** — 아무것도 하지 않는다 (2026-08-22)
     *
     *   런타임이 이미 무언가를 기다리는 중에 `실행()` 이 또 불리면
     *   `{ 재진입: '대기 종류' }` 를 준다. 그 결과에는 `연출요청` 이 **없다** —
     *   있는 것을 채워 주면 **같은 연출을 두 번** 하게 되기 때문이다.
     *
     *   ⇒ 여기서 **조용히 끝낸다.** 대기를 재개하는 것은 그 대기를 낸
     *     **원래 소비 사슬**의 몫이다.
     *
     *   ★ 실제로 `1-5.SCE` 부팅에서 났다 — 전투 루프가 `onRound()` 를 한 번 더
     *     부르는데 첫 호출이 아직 대사를 기다리고 있었다.
     *     전에는 `연출요청` 없는 결과가 `_SCE연출()` 로 흘러가 **던졌다.** */
    if (r.재진입) {
      if (root.console && root.console.warn) {
        root.console.warn('[SCE결과소비] 런타임이 ' + r.재진입 +
                          ' 를 기다리는 중이다 — **이번 호출은 아무것도 안 한다**');
      }
      마지막.재진입 = r.재진입;      /* ★ 바깥 최종 반환이 덮지 않도록 남긴다 */
      return Promise.resolve(null);
    }

    /* ② 상태 변경을 실제 전투로 — **걸어 나가는 퇴장·이동은 보류**한다 */
    var a = self.SCE변경적용(r.변경 || [], { 연출대기: true });
    총적용 += a.적용 | 0;
    if (a.건너뜀 && a.건너뜀.length) 총건너뜀 = 총건너뜀.concat(a.건너뜀);

    /* ★★★ **`clear`/`fail` 이 이미 있으면 뒤 결과로 덮지 않는다** (GPT 36차 ⑮) */
    if (r.outcome != null && 마지막.outcome == null) 마지막.outcome = r.outcome;
    if (r.nextScenario != null && 마지막.nextScenario == null) 마지막.nextScenario = r.nextScenario;
    /* ★★★ 결말이 났으면 **이후 명령·재개를 중단**한다 (GPT 36차 ⑯).
     *   ★ 다만 **보류한 것은 먼저 확정**한다 — 반쯤 남기면 안 된다 (GPT 37차 ⑫). */
    /* ★★★★★ **이벤트 공격 → 피해는 차례로** (2026-10-06)
     *   사장님 「이벤트 공격과 데미지 표시가 순차적으로 나와야하는데, 거의 동시에 나와. 원작은 중간 사이에 텀이 있어」
     *   원본은 한 흐름이다 — op 0x07 값 0·1 은 0x51E18 call 0x1E61D(공격 연출)가 끝나야 0x51E84 → 다음 명령이고,
     *   op 0x0A 는 그 뒤 0x5219C 카메라 → 0x52205 숫자 → 0x52218 밀림이다.
     *   ☠ 전에는 같은 바퀴에 모인 둘을 Promise.all 로 동시에 돌렸다.
     *   피격 연출은 공격이 끝난 «뒤»에 시작한다(부르는 순간 그림이 움직이므로 미리 부르지 않는다). */
    function 공격뒤피격(공) {
      if (공 && 공.취소됨) return 공;
      if (!공) return self._SCE피격연출(a.보류, 살아있나);          /* 공격이 없으면 곧바로 (없으면 동기 null) */
      return Promise.resolve(공).then(function () {
        if (!살아있나()) return null;
        return self._SCE피격연출(a.보류, 살아있나);                  /* 0x52218 */
      });
    }
    if (마지막.outcome != null) {
      var 공p = self._SCE공격연출(a.보류, 살아있나);
      if (공p && 공p.취소됨) return null;
      var 퇴처리 = function () {
      return Promise.resolve(self._퇴장확정(a.보류, 살아있나)).then(function (v) {
        if ((v && v.취소됨) || !살아있나()) return null;   /* ★ 명시적으로 끊는다 */
        self._이동확정(a.보류, 살아있나);
        /* ★ 등장 연출도 돌린다 — 결말이 나도 화면은 맞춰 둔다 */
        var 등p2 = self._등장연출(a.바뀐유닛, 살아있나);
        return (등p2 && !등p2.취소됨) ? Promise.resolve(등p2).then(function () { return null; }) : null;
      });
      };
      /* ★ 공격 → 피격 **차례로** (2026-10-06) — 원본 op 0x07 의 0x1E61D 가 끝나야 op 0x0A(0x5211D)가 돈다 */
      var 앞 = 공격뒤피격(공p);
      return 앞 ? Promise.resolve(앞).then(퇴처리) : 퇴처리();   /* ★ 없으면 한 틱도 안 쓴다 */
    }

    /* ★ **공격 연출이 먼저다** (`0x1E61D` 는 동기) — 그 뒤 퇴장 */
    var 공p2 = self._SCE공격연출(a.보류, 살아있나);
    if (공p2 && 공p2.취소됨) return null;
    var 뒤처리 = function () {
    /* ③ 보류(걸어 나가는 퇴장)를 연출하고 확정 — 원본도 걸은 **뒤** 이탈한다 */
    return Promise.resolve(self._퇴장확정(a.보류, 살아있나)).then(function (퇴v) {
      /* ★★★ **퇴장이 취소됐으면 그 바퀴를 끝낸다** (GPT 58차 ③).
       *   그냥 이어가면 `_SCE연출()` 까지 들어가 `__SCE계측.런타임연출` 이나
       *   `svc.onEvent('sce_wait')` 같은 **관찰 가능한 동작**이 취소 뒤에도 난다. */
      if ((퇴v && 퇴v.취소됨) || !살아있나()) return null;
      /* ★★★★★ **등장 연출** (`op 0x03` · 2026-08-22)
       *   원본은 **먼저 놓고 연출한다**(`0x50E25` 슬롯 → `0x51127` 리스트 → 연출)
       *   — 퇴장과 반대다. `sceapply` 가 이미 적용했으므로 여기서는 그림만 맞춘다.
       *   ★ 할 일이 없으면 `_등장연출` 이 **동기로 `null`** 을 준다 — 그때는
       *     `.then` 을 타지 않아야 한다. 체인을 늘리면 **뒤 연출이 한 틱 밀린다.** */
      var 등p = self._등장연출(a.바뀐유닛, 살아있나);
      if (등p && 등p.취소됨) return null;
      function 나머지() {
        if (!살아있나()) return null;
        /* ④ `waitFor` 가 있으면 그 연출을 기다린다 */
        if (!r.대기) {
          /* ★★★★★ **기다리지 않는 연출도 실행한다** (2026-08-26 · GPT 6차 검수 ①)
           *
           *   > 「핸들러는 모드 0·1 에 `waitFor:null` 과 `연출요청` 을 **함께** 반환한다.
           *   >  소비기는 `if (!r.대기) { … return null; }` 로 먼저 빠지고
           *   >  `_SCE연출()` 은 `r.대기` 가 있을 때만 호출한다. …
           *   >  현재 동작은 「카메라를 시작하고 기다리지 않음」이 아니라
           *   >  **「카메라 요청 폐기」** 다」
           *
           *   ★ 원본 `0x52A2C`(카메라 모드 0·1)는 **목표를 표에 넣고**(`0x9065C` 등)
           *     화면 갱신이 **다음 프레임부터 따라간다.** 「안 기다린다」와
           *     「안 한다」는 **다르다.**
           *
           *   ⇒ `waitFor` 는 **런타임을 멈출지**만 정하고, `연출요청` 은
           *     **있으면 언제나 실행**한다. 결과는 기다리지 않는다.
           *   시험: `04_도구/카메라_모드별대기.test.js` */
          /* ★ 런타임이 `결과.비대기연출[]` 에 실어 올린다 (`sceruntime.js`).
           *   `_SCE연출(무엇, 결과)` 의 `무엇` 은 **`waitFor` 값**과 같은 이름이므로
           *   `연출요청.kind` 를 그대로 쓴다 — 핸들러가 `kind:'effect'` 를 낸다. */
          SCE비대기연출실행(self, r.비대기연출);
          self._이동확정(a.보류, 살아있나); return null;
        }
      /* ★★★★★ **토큰을 여기서 잡는다** (GPT 36차 ⑫)
       *   연출 Promise 가 두 번 완료되거나 옛 세션이 늦게 끝나도
       *   `재개(토큰)` 이 **거절**한다. */
      var 토큰 = (r.토큰 != null) ? r.토큰
               : (런타임.대기토큰 ? 런타임.대기토큰() : null);
      return Promise.resolve(self._SCE연출(r.대기, r)).then(function (연출결과) {
        if (연출결과 && 연출결과.취소됨) return null;
        /* ★★★★★ 연출이 끝났다 — **그 사이 전투가 바뀌지 않았는지** 본다 (GPT 37차 ⑥) */
        if (!살아있나()) {
          if (root.console && root.console.warn) {
            root.console.warn('[SCE결과소비] 연출 중 세대가 바뀌었다 — 확정·재개를 안 한다');
          }
          return null;
        }
        /* ★★★ **연출이 끝난 뒤** 이동을 확정한다 (GPT 37차 ⑪) */
        self._이동확정(a.보류, 살아있나);
        /* ★ 기다리는 것이 없으면 부르지 않는다 */
        if (!런타임.대기중 || !런타임.대기중()) {
          if (root.console && root.console.warn) {
            root.console.warn('[SCE결과소비] 대기(' + r.대기 + ')를 연출했는데 ' +
                              '런타임은 기다리는 것이 없다 — 재개() 를 건너뛴다');
          }
          return null;
        }
        var 다음 = 런타임.재개(토큰);
        if (다음 == null) return null;      /* 토큰이 거절됐다 — 조용히 멈춘다 */
        return 한바퀴(다음);
      });
      }                                     /* ← function 나머지() */
      /* ★ 등장 연출이 없으면 **한 틱도 안 쓰고** 바로 잇는다 */
      return 등p ? Promise.resolve(등p).then(나머지) : 나머지();
    });
    };
    /* ★ 공격 → 피격 **차례로** (2026-10-06 · 아래 공격뒤피격) */
    var 앞2 = 공격뒤피격(공p2);
    return 앞2 ? Promise.resolve(앞2).then(뒤처리) : 뒤처리();   /* ★ 없으면 한 틱도 안 쓴다 */
  }

  /* ★★★ **이 사슬을 남긴다** — 재진입한 호출자가 이것을 기다린다 (역압력).
   *   끝나면 **자기 것일 때만** 지운다 (뒤에 새 사슬이 들어섰을 수 있다). */
  var 사슬 = Promise.resolve(한바퀴(첫결과)).then(function () {
    /* ★ 세대가 바뀌었으면 **결과도 전달하지 않는다** */
    /* ★★★ 시나리오가 바뀌면 **런타임이 교체된다** — 세대를 올린다 (GPT 38차 ⑤) */
    /* ★★★★★ **다음 시나리오를 컨트롤러에 남긴다** (2026-08-23 · 통합 7단계)
     *
     *   `nextScenario`(op 0x12 · `0x52D33`)는 지금까지 **이 함수의 반환값으로만**
     *   나왔다. 독립 실행기는 그것을 쓰지 않지만, 셸은 이 값으로 **다음 `.SCE` 로
     *   체인**해야 한다(`screens.js` BATTLE 의 `체인` 갈래).
     *   ⇒ 셸이 틱에서 읽을 수 있게 여기 남긴다.
     *   ★ 사용자 지적: 「2-4 시나리오 종료후 다음 시나리오 2-4a로 연결도 안돼」 */
    /* ★★★★★ **`outcome` 도 셸이 읽게 남긴다** (2026-08-24)
     *
     *   사용자 지적: 「2-1 시나리오에서 **대화 이벤트가 끝나고 월드로 복귀가 안돼.**」
     *
     *   2-1 은 전투가 없는 **대화만 있는 시나리오**다. 마지막 명령이
     *     `op 0x01` → `0x506F3` 시나리오 종료 (blackbox 저장 → contmap.dat 삭제 → `exit(1)`)
     *   이고 원본은 여기서 COMBATII 를 끝내 **월드(MAIN.EXE)로 돌아간다**
     *   (`승패조건_SCE_분석.md` §3 · `UI데이터계열_분석.md` §3.3).
     *   우리는 프로세스를 안 죽이므로 `sce_handlers` 가 `outcome: 'clear'` 로 낸다.
     *
     *   ★ 그런데 여기서 `nextScenario` 만 `pendingNextScenario` 에 남기고
     *     **`outcome` 은 반환값에만 담아 흘려보냈다.** 소비 사슬을 부른 쪽은
     *     그 값을 안 읽으므로 **결말이 증발**했다 —
     *     실측: 런타임 로그에 `outcome=clear` 가 찍히는데도
     *     `ctrl.pendingOutcome` 은 계속 null 이고 모드가 `RING_IDLE` 로 갔다.
     *     (`op 0x12` 다음 시나리오는 남기고 있었으니 2-4→2-4A 는 됐던 것이다.)
     *
     *   셸(`screens.js`)은 `pendingOutcome` 이 **문자열 'clear'/'fail'** 이어도 받는다. */
    return SCE소비최종결과(self, 마지막, 살아있나, 총적용, 총건너뜀, 바퀴);
  });
  /* ★★★★★ **이벤트 세션 카운터** — 커서가 명령 사이 빈틈에 새어 나오지 않게 (2026-08-24)
   *
   *   사용자 지적: 「**2-1 스토리 진행하는동안 커서 안나와야해.** 이건 2-1분만 아니라
   *   **이벤트로만 진행되는 시나리오 동일**할거야.」
   *
   *   원본 근거 — 커서 그리기 `0x49C05` 의 **호출부 15곳 전수** (`.tools/le_xref.js` 신설):
   *     0x1634A 0x1658B 0x17064 0x17303 0x1F2E4 0x1F5A5 0x4934F 0x4A4E2
   *     0x4A5D4 0x4BB69 0x4CF3A 0x4E11A 0x54DA4 0x559CD 0x55C07
   *   ★ **SCE 이벤트 루프(`0x455B6`·`0x52ACC`·`0x52AF8`·`0x53030`)는 하나도 없다.**
   *     `0x1634A` 는 유닛 이동이 **끝난 뒤** 되살리는 자리다 — 연출 중엔 안 그린다.
   *   ⇒ 이벤트가 시작해 끝날 때까지 커서는 **한 번도** 안 그려진다.
   *
   *   `_SCE소비중` 은 사슬 하나짜리라, 사슬이 갈리는 순간 `이벤트진행중()` 이 잠깐
   *   거짓이 되어 커서가 깜빡였다. 카운터는 겹친 사슬도 안전하게 덮는다. */
  return SCE소비사슬추적(self, 사슬);
};

/** SCE 소비 구현의 비공개 슬롯을 외부가 직접 읽지 않게 하는 관찰 창구. */
Controller.prototype.SCE진행중인가 = function () {
  return !!this._SCE소비중 || (this._SCE세션 | 0) > 0;
};

/** SCE 프레젠터 계측 공개 경계. 프레젠터 인스턴스는 Controller가 소유한다. */
Controller.prototype.SCE프레젠터계측비우기 = function () {
  var P = this._프레젠터();
  if (P && P.셈비우기) P.셈비우기();
};
/** SCE 프레젠터 종류별 처리 계측의 복사본을 반환한다. */
Controller.prototype.SCE프레젠터계측보기 = function () {
  var P = this._프레젠터();
  return P && P.셈보기 ? P.셈보기() : null;
};

/**
 * ★★★ **SCE 세대를 올린다** — 진행 중인 소비를 전부 무효로 만든다 (GPT 37차 ⑥).
 *   전투를 새로 시작하거나 세션을 끊을 때 부른다.
 */
/* ★★★★★ **`SCE권위설정`·`SCE런타임권위`·`SCE레거시권위`·`SCE권위잠그기` 를 지웠다**
 *   (2026-08-26 · 2단계 2-4)
 *
 *   2-3 에서 legacy `EVT` 정의를 지웠으므로 **고를 상대가 없다.**
 *   모든 섹션은 언제나 `SceRuntime` 이 맡는다 — 표도 잠금도 필요 없다.
 *   전문: `03_분석/_보관/옛계획/00_2단계_legacy제거_대상.md`
 */

Controller.prototype.SCE세대올리기 = function (왜) {
  this.SCE세대 = (this.SCE세대 | 0) + 1;
  this._프레젠터캐시 = null;      /* ★ 새 세대는 새 프레젠터 (옛 것은 취소로 접힌다) */
  if (root.console && root.console.info) {
    root.console.info('[SCE세대] ' + this.SCE세대 + ' 로 올렸다' + (왜 ? ' (' + 왜 + ')' : ''));
  }
  return this.SCE세대;
};

/**
 * ★ `waitFor` 종류별 연출. `sceruntime` 이 허용하는 것은 셋뿐이다
 *   (`대기종류 = ['dialogue', 'movement', 'effect']`).
 *
 *   ★ **[할 일]** 지금은 이동만 이어 붙었다 — 대사·이펙트는 어댑터가 없다.
 *     GPT 35차 ⑨: 「핸들러는 로그를 남기고 `waitFor` 만 반환하며,
 *     실제 대사 자료를 연출 어댑터로 전달하지 않는다」
 */
/**
 * ★★★ **유일한 연출 창구** — 옛 `EVT` 와 어댑터가 같이 쓰라고 뽑았다 (GPT 38차 ⑨).
 *   ★ 2-3 에서 `EVT` 를 지웠으므로 지금은 **이것 하나뿐**이다 (P6 단일 소유자).
 *   의존은 **주입**한다 — 프레젠터가 모듈 전역을 직접 찾지 않는다 (GPT 39차 ⑥).
 *   ★ `살아있나` 로 **SCE 세대**를 넘겨, 옛 연출이 늦게 끝나면 취소로 접는다.
 */
Controller.prototype._프레젠터 = function () {
  var self = this;
  if (self._프레젠터캐시) return self._프레젠터캐시;
  var M = root.G2ScePresent;
  if (!M) return null;
  var 세대 = self.SCE세대;
  /* ★★★★★ **렌더러는 주입받는다** (2026-08-22 — 실제 버그였다)
   *
   *   `svc.view` 는 `{center, updateUnit, apply}` 뿐이다.
   *   카메라 API(`goFocus`·`goCamTile`·`cameraScroll`)는 **`G2Render` 인스턴스**에 있고
   *   그것은 `전투.html` 의 IIFE 지역(`ST.R`)이라 컨트롤러가 못 찾는다.
   *
   *   ★ `1-5.SCE` 권위 전환에서 실제로
   *     `ScePresent.카메라: cameraScroll 이 없다` 로 **터졌다.**
   *
   *   ⇒ `ctrl.SCE연출의존({ renderer, anim, dialogue, wait })` 로 **주입**한다. */
  var 의 = self._SCE연출의존 || {};
  self._프레젠터캐시 = M.만들기({
    anim: 의.anim || self.svc.anim || null,
    renderer: 의.renderer || self.svc.view || null,
    dialogue: 의.dialogue || root.G2Dialogue || null,
    살아있나: function () { return self.SCE세대 === 세대; },
    wait: 의.wait || self.svc.wait || null,
    frameClock: 의.frameClock || root.G2FrameClock || null
  });
  return self._프레젠터캐시;
};

/**
 * ★★★ **연출 의존 주입** — `전투.html` 이 `ST.R`·`ST.anim` 을 아는 자리에서 준다.
 *   ★ 주입하면 프레젠터 캐시를 버려 **다음 호출부터** 새 것이 쓰인다.
 */
Controller.prototype.SCE연출의존 = function (의존) {
  this._SCE연출의존 = 의존 || {};
  this._프레젠터캐시 = null;
  return this._SCE연출의존;
};

/* ★★★★★ [리마스터] **행진 합류** — 대본 첫 칸까지 걸어간 뒤 행진한다 (2026-10-06)
 *
 *   > 사장님: 「4-4 이벤트 진행중에도 이동 튀어. 갑자기 순간이동해서 나타나」 → 고르심 «② 걸어가서 합류»
 *
 *   원본 `op 0x05` 는 SCE 첫 좌표를 유닛 좌표에 써 넣는다(0x51785~0x517AB) — 플레이어가 유닛을 옮겨 둔 뒤
 *   행진이 오면 원본도 **첫 칸으로 순간이동**한다(sce_handlers.js «원본걸음» 주석).
 *   ⇒ 설정 행진합류(기본 '리마스터')면 지금 칸 → 첫 칸 길(G2Move.path · ZOC 없음)을 앞에 붙여 걸어서 메운다.
 *     도착 자리·대본 경로는 원본 그대로다. '원작' 이면 원본처럼 첫 칸으로 놓고 걷는다.
 *   ★ 길이 안 나오면(막힌 지형) 세로 먼저 한 칸씩(0x16E2B 규칙) 잇는다 — 어떤 경우에도 건너뛰지 않는다. */
function 행진합류길(battle, u, path) {
  var O = root.G2Opt || root.Opt;
  if (O && O.cfg && O.cfg['행진합류'] === '원작') return path;
  if (!u || !path || !path.length || u.x == null) return path;
  var x = u.x | 0, y = u.y | 0, p0 = path[0];
  if (x === (p0.x | 0) && y === (p0.y | 0)) return path;
  var 앞 = null, Mv = root.G2Move;
  try {
    var 길 = (Mv && Mv.path && battle) ? Mv.path(battle, u, p0.x | 0, p0.y | 0, { budget: 0x7FFF, zoc: 'none' }) : null;
    if (길 && 길.length >= 2 && 길[0].x === x && 길[0].y === y) 앞 = 길.map(function (q) { return { x: q.x, y: q.y }; });
  } catch (e) { 앞 = null; }
  if (!앞) {
    앞 = [{ x: x, y: y }];
    while (y !== (p0.y | 0)) { y += (y < p0.y) ? 1 : -1; 앞.push({ x: x, y: y }); }
    while (x !== (p0.x | 0)) { x += (x < p0.x) ? 1 : -1; 앞.push({ x: x, y: y }); }
  }
  return 앞.slice(0, -1).concat(path);     /* 앞의 끝 = 첫 칸 — 한 번만 */
}

/** SCE 연출 명령 하나를 주입된 표시·시간원 경계로 재생한다. */
Controller.prototype._SCE연출 = function (무엇, 결과) {
  var self = this;
  if (!무엇) return null;
  var 요청 = (결과 && 결과.연출요청) || null;

  /* ★★★ 계약 §6-1b — `waitFor` 를 내면 `연출요청` 이 **반드시** 온다 (GPT 36차 ⑪).
   *   없으면 계약 위반이다 — 조용히 넘기지 않는다. */
  if (!요청) {
    throw new Error('_SCE연출: waitFor=' + 무엇 + ' 인데 연출요청 이 없다 (계약 §6-1b)');
  }
  if (self.svc.onEvent) self.svc.onEvent({ type: 'sce_wait', 무엇: 무엇, 요청: 요청 });
  /* ★★★ **권위 경계에서만** 센다 (2026-08-22 · GPT 41차 ⑦)
   *   프레젠터 전체 셈은 `EVT`(legacy 다른 섹션)와 **섞인다** —
   *   실제로 첫 전환 계측에서 대사가 2로 나와 헛짚었다. */
  if (root.__SCE계측) {
    root.__SCE계측.런타임연출 = (root.__SCE계측.런타임연출 | 0) + 1;
    root.__SCE계측['런타임' + 무엇] = (root.__SCE계측['런타임' + 무엇] | 0) + 1;
  }

  /* ★★★★★ **유일한 프레젠터**를 쓴다 — 옛 `EVT` 와 같은 것이었다 (GPT 38차 ⑨ · 39차 ⑥) */
  var P = self._프레젠터();
  if (P) {
    var 유닛 = function (id) {
      return (self.battle && self.battle.units) ? self.battle.units[id] : null;
    };
    if (무엇 === 'movement' && ((요청.units && 요청.units.length) ||
                                (요청.path && 요청.path.length))) {
      /* ★★★★★ **연속된 `0x05` 는 전원이 동시에 행진한다** (2026-08-23 · 사용자 지적)
       *   > 「이벤트 이동이 **한꺼번에 이동**해야 하는데 지금은 한명씩 이동해」
       *   원본 `0x51927` 이 다음 `0x05` 를 흡수해 유닛을 더 등록하고,
       *   등록이 끝나면 `0x16D3E` 가 **함께** 재생한다
       *   (`SCE이벤트_모딩툴대조.md` §「0x05 행진」).
       *   `sce_handlers` 가 묶음을 `요청.units` 로 모아 준다. */
      var 목록 = (요청.units && 요청.units.length)
        ? 요청.units.map(function (m) {
            return { unit: 유닛(m.unitId), path: m.path, dir: m.dir };
          }).filter(function (m) { return m.unit && m.path && m.path.length; })
        : [{ unit: 유닛(요청.unitId), path: 요청.path, dir: 요청.dir }];
      if (!목록.length) return null;
      목록.forEach(function (m) { m.path = 행진합류길(self.battle, m.unit, m.path); });
      return P.이동({ units: 목록 });
    }
    if (무엇 === 'dialogue' && 요청.text) {
      /* ★ 화자 풀이는 **런타임 몫**이다 — 여기서는 이미 정해진 것을 넘긴다.
       *   `요청.화자` = 런타임이 원본 선택자 규칙(0x501BA / 0x5019C)으로 찾은 유닛,
       *   `요청.flag` = 0x508BA 가 직전 화자와 비교해 만든 값 (0 이면 타원 연출 생략). */
      /* ★★★★★ **초상화·이름은 화자 레코드에서 읽는다** — 원본 `0x482A5` 그대로 (2026-08-24)
       *
       *   사용자 지적: 「대화마다 포트레이트 함께 띄우는 것도 대부분 빠졌어.」
       *              「포트레이트도 불러와야하는데 경로가 잘못지정된거 아니야?」
       *
       *   `UI데이터계열_분석.md §3.1` (`0x482A5(eax=유닛레코드, edx=대사문자열, bx=플래그)`):
       *     6. `0x48132(화면X=0x48, bl=[eax+0x10])` — **초상화 = 레코드 +0x10**
       *     7. 이름 문자열 = **`eax+2`** 를 "%s" 로 중앙 정렬 출력
       *   ⇒ 둘 다 **화자 레코드에서 직접** 나온다. 대사 명령이 따로 싣는 값이 아니다.
       *
       *   SCE 런타임 경로(`sce_handlers.js`)는 `요청.portrait`/`요청.name` 을 안 채운다.
       *   그래서 `|| null` 이 되어 `battle_ui.js:1072` 의 `line.portrait != null` 이
       *   늘 거짓 → **초상화가 통째로 안 떴다**. 화자에서 읽어 원본과 맞춘다.
       *   (`state.js:53` · `battle_data.js:123` 이 레코드 '초상화' 를 `portrait` 에 담는다) */
      var _화자 = 요청.화자 || 요청.unit || null;
      return P.대사({ lines: [{ char: 요청.char, flag: 요청.flag, text: 요청.text,
                                name: (요청.name != null ? 요청.name
                                       : (_화자 && _화자.name != null ? _화자.name : null)),
                                portrait: (요청.portrait != null ? 요청.portrait
                                           : (_화자 && _화자.portrait != null ? _화자.portrait : null)),
                                unit: _화자,
                                중앙타일: 요청.중앙타일 || null }] });   /* ★ 0x50877 대체 화자 */
    }
    /* ★★★★★ `spawn` — `op 0x03` **묶음끝**이 내는 대기 (2026-08-22 · GPT 52차 ③)
     *   연출 자체는 이 바퀴의 **`_등장연출(a.바뀐유닛)`** 이 이미 돌렸다.
     *   여기서 또 돌리면 **두 번** 연출된다 — 대기는 「묶음마다 소비를 끊는」 것이 목적이다.
     *   ⇒ 아무것도 하지 않고 `null` 을 준다 (어댑터 없음 경고를 피한다). */
    if (무엇 === 'spawn') return null;

    /* ★★★★★ **화면 문구** — `op 0x73` (`0x52B4F`) · 2026-08-23
     *
     *   사용자 설명: 「1-1 의 경우 상단쪽 카메라에서 시작하고 거기에 **대화창 아닌
     *   문구**가 뜨고 카메라가 아래로 내려오면서 캐릭터를 지목하고 대화가 나오고…」
     *
     *   원본은 링버퍼(`0xFF0BC` · 한 줄 267 B · 16줄)에 줄을 쌓는다
     *   (`UI데이터계열_분석.md` §148). 1-1 을 보면 `빈 / "<< 비프로스트 기간테스
     *   산맥 >>" / 빈` 세 줄이 이어져 **가운데 정렬된 여러 줄 문구**를 이룬다.
     *   ★ **대기가 없다** — 문구는 다음 명령들이 도는 동안 떠 있고,
     *     빈 줄만 남으면 지워진다. 그래서 연출은 즉시 끝난다. */
    /* ★★★★★ **사망 연출** — `op 0x0A` 즉사 (`0x1DB92`~`0x1DBB7`) · 2026-08-25
     *
     *   사용자: 「이벤트 공격 데미지가 들어가고 캐릭터 죽는게 처리되는 거겠지.
     *   **지금은 그냥 눈앞에서 사라진다고.**」 (장면 = `1-1A.SCE` 턴1 아수라)
     *
     *   ★ **원본은 연출이 끝날 때까지 이벤트가 멈춘다** — 확정했다:
     *     `0x463FB`(사망 연출) 안에 **`0x499E4`(대기) ×2 · `0x1033B`(틱설정) ×2**
     *     가 있다. DOS 단일 스레드라 **연출 루프가 끝나야 `ret`** 하고,
     *     그래야 `0x1DB1D` → `0x5229B` 다음 줄로 간다.
     *     (한때 「[원본 미확인]」으로 남겼던 것을 호출 구성을 세어 확정했다.)
     *   ⇒ `waitFor: 'effect'` 로 **명령열을 멈춘다.** 연출이 끝나면 재개한다. */
    if (무엇 === 'effect' && 요청.무엇 === '사망') {
      var 죽 = 유닛(요청.unitId);
      var 창 = root.__playDeathFx;
      /* ★ 피해로 HP 0 (실행본 0x52291 → 0x1DB1D) — 넉백이 끝난 이 자리에서 사망을 확정한다 (즉사 갈래는 상태 적용 때 이미 했다) */
      if (죽 && 요청.피해뒤 && 죽.alive !== false && (죽.hp | 0) <= 0)
        self.SCE변경적용([{ scope: 'battle', kind: 'unitDie', unitId: 요청.unitId, 원본: '0x52291 → 0x1DB1D' }]);
      if (!죽 || !창) return null;
      /* ★ 0x5229B → 0x1DB1D 끝 0x1DDE3 — 대본 피해로 죽어도 그 진영이 비었나 본다 (실행 중이라 런타임이 미뤘다가 이 이벤트 뒤에 돈다) */
      return Promise.resolve(창(죽)).then(function () {
        if (죽.alive !== false || self._대본끝 || !self.svc.사망전멸) return null;
        return self.svc.사망전멸(죽);
      });
    }

    /* ★★★★★ **대본 회복** — `op 0x0A` 양수·`0x7FFF` (`0x521CD → 0x462A7`) · 2026-10-05
     *   원본은 회복 게이지가 끝나야 다음 명령이다. 게이지는 `sceapply 체력()` 이 상태 적용 때 이미 띄웠고
     *   그 약속을 `u._대본회복대기` 에 남겼다 — 여기서 그것을 기다린다. 없으면(1 HP 미만 · 창구 없음) 곧바로 끝. */
    /* ★ 대본 피해 — 넉백·숫자는 보류(sceHurt)가 이미 돌렸다. 이 요청은 «다음 명령을 그 뒤로» 미루는 몫뿐이다 (0x52288 루프 뒤 다음 명령) */
    if (무엇 === 'effect' && 요청.무엇 === '피해') return null;

    if (무엇 === 'effect' && 요청.무엇 === '회복') {
      var 회 = 유닛(요청.unitId);
      var 회대기 = 회 && 회._대본회복대기;
      if (회) 회._대본회복대기 = null;
      return 회대기 ? Promise.resolve(회대기) : null;
    }

    if (무엇 === 'effect' && 요청.무엇 === '문구') {
      var H = root.G2Hud;
      /* ★★★★★ **작전 목표 자리(`objective`)로 폴백하면 안 된다** (2026-08-23)
       *
       *   실제로 그렇게 했다가 화면을 직접 찍어 보고 잡았다 —
       *   「**〔 시나리오 조건 〕**」이라는 **제목이 붙고 화면이 회색으로 덮였다**
       *   (`drawObjective` 가 `dimScreen` 을 부른다).
       *   원본(사용자가 준 스크린샷)은 **맵 위에 글자만** 얹는다. 제목도 없고 안 덮는다.
       *   ⇒ 전용 창구(`문구넣기`)만 쓴다. 없으면 **조용히 넘기지 않고 경고**한다
       *     (GPT 검수 ⑰ — 미구현을 무시하면 가짜 합격이 된다). */
      if (!H || typeof H.문구넣기 !== 'function') {
        if (root.console && root.console.warn) {
          root.console.warn('[SCE연출] op 0x73 — `G2Hud.문구넣기` 창구가 없다. ' +
                            '문구가 화면에 안 나온다 (원본 0x52B4F/0x5046C)');
        }
        return null;
      }
      try {
        if (요청.지움) {
          H.문구넣기(null);                          /* 0x504F1 — 표시 끝 */
        } else {
          /* ★ 방금 들어온 줄 **하나만** 넣는다 — 원본 `0x52B4F` 도 한 줄씩 적재한다.
           *   표시 시간은 **SCE 가 지정한 프레임 수**다 — `0x52BB8` 이 첫 u16 을
           *   `[idx*2+0x9016A]` 에 넣고 `0x504CF` 가 그것을 읽는다 (2026-08-24 정정). */
          var 줄들 = 요청.줄들 || [];
          var 이번줄 = 줄들.length ? 줄들[줄들.length - 1] : '';
          H.문구넣기(이번줄, 요청.길이);
        }
      } catch (e) {
        if (root.console && root.console.warn) root.console.warn('[SCE연출] 문구 표시 실패', e);
      }
      return null;                                  /* ★ 즉시 끝 — 원본에 대기가 없다 */
    }

    if (무엇 === 'effect' && 요청.무엇 === '카메라') {
      return P.카메라({ mode: 요청.mode, a: 요청.a, b: 요청.b, step: 요청.step,
                        unit: 요청.unitId != null ? 유닛(요청.unitId) : null });
    }

    /* ★★★★★ **마법 · 필살기 시전** — `op 0x08` / `op 0x6C` (2026-08-23)
     *   `sce_handlers.js` 가 `연출요청 {kind:'effect', 무엇:'마법'|'필살기',
     *   unitId, 표색인, 랭크}` 를 낸다. 원본 `0x51E8B`.
     *   ★ 필살기/초필살기는 통합 presenter가 있으면 `sceapply`가 `defer` 보고만 만들고,
     *     실제 피해·상태·이동은 이 연출의 `DRIVER.special → rep.commit()` 경계에서 확정한다.
     *     마법은 각 마법의 기존 defer 계약을 따른다. */
    if (무엇 === 'effect' && (요청.무엇 === '마법' || 요청.무엇 === '필살기')) {
      var 시전자 = 요청.unitId != null ? 유닛(요청.unitId) : null;
      if (!시전자) {
        if (root.console && root.console.warn) {
          root.console.warn('[SCE연출] ' + 요청.무엇 + ' — 시전자(unitId ' +
                            요청.unitId + ')를 못 찾았다 (원본 ' + (요청.원본 || '?') + ')');
        }
        return null;
      }
      var b0 = this.battle || (this.svc && this.svc.battle) || null;
      var 시전보고 = b0 ? b0.__SCE마법보고 || null : null;
      /* ★★★★★ **대상이 없어 취소된 이벤트 필살기는 연출 없이 넘어간다** — 원본 0x2FB10 mov eax,-1 · 혼 0x2E264 (2026-10-10)
       *   sceapply 마법시전 이 cancelled 면 __SCE마법보고 = null 로 남긴다. 원본은 그 자리에서 −1 로 돌아가 아무것도 안 그린다.
       *   ☠ 보고 없이 P.마법 을 돌려 연출이 끝나지 않았다 — 16-1A(라시드 진영 없음 → 혼·비 대상 0)가 «이펙트 대기»로 섰다. */
      if (요청.무엇 === '필살기' && !시전보고) return null;
      /* ★★★★★ **마법도 같다 — 대상이 없으면(보고 null) 연출을 안 그린다** (2026-11-13 · 사장님 11-12 지적)
       *   > 「43-4B 베라모드 각성 직전 6연속 마법 … 대상 아군이 배리어마법이 걸린 상태이면 다크존, 아마겟돈 대신 파이어애로우를 두번 사용」
       *   원본 op 0x08 은 [0x74492]=1(AI 모드)로 마법 함수표를 불러 AI 대상 함수(암흑7 = 0x42025 · 배리어(+0x15 bit7)·탑승≥7 제외)가
       *   −1 이면 그 자리에서 돌아가 **아무것도 안 그린다**. sceapply 마법시전 도 마법AI대상 이 null 이면 보고를 null 로 두는데,
       *   ☠ 여기서는 필살기만 걸러 마법은 보고 없이 P.마법 → anim.play('cast', report null) 로 갔고, 보고가 없으면
       *   기본 마법(0 = 파이어애로우) 연출이 나갔다 — 헤드리스 43-4B S4#2 재현(아군 배리어 f15|0x80 → 마법AI대상(146) null). */
      if (요청.무엇 === '마법' && !시전보고) return null;
      /* ★ 연출(효과 commit) 뒤 죽은 유닛을 플레이어 시전과 같은 사망 처리(0x1ED45 · 사망 연출·리스트 제거·S4·§11)로 넘긴다.
       *   ☠ 빠져 있어 이벤트 마법에 죽은 유닛이 칸에서만 빠지고 그림이 남았다
       *   (2026-10-02 사장님 「화면에 작게 아이템 상자가 떠있고 죽은 슬라임이 사라지지 않아.」 · 3-3 라이어 헬파이어) */
      return Promise.resolve(P.마법({ unit: 시전자, 무엇: 요청.무엇,
                      표색인: 요청.표색인, 랭크: 요청.랭크,
                      report: 시전보고 })).then(function (v) {
        var X = root.G2Executor;
        var 죽음 = (시전보고 && X && X.collectDeaths) ? X.collectDeaths(시전보고) : [];
        var 창 = root.__playDeathFx;
        /* 이벤트 실행 «안»이라 _사망처리(이벤트 끝 대기)를 쓰지 않는다 — op 0x0A 사망 갈래(아래 「사망」)와 같은 창구 */
        /* ★★★★★ **그러나 _사망처리 가 하던 뒷일은 여기서 같은 순서로 닫는다** (2026-10-05)
         *   사장님: 「이벤트 초필살기 후 체력 소모가 먼저 나오지 않고 밀려서 다음턴 행동 이후 발동하는 문제도 있어.
         *            사기 다운 스킬을 썼는데 체력이 소모되는 식이야」 · 「그리고 이벤트 초필살기 경험치 획득도 안돼」
         *   원본: 필살기 함수 안 사망(0x1DB1D: 사망 연출 0x1DBA1 → 경험치 창 0x1DBCD) → 반환 뒤 HP 소모 0x301BB(0x4CA6E).
         *   ☠ 사망 연출만 돌리고 끝나 — 경험치 창이 없었고, 사망 때문에 미뤄 둔 HP 소모(`_HP소모미룸`)·
         *     시전자 자세 복귀(`_시전자복귀미룸`)가 남아 **다음 행동의 사망 처리**(`_사망처리` 끝)에서 터졌다. */
        var 나 = self;
        var gains = (시전보고 && 시전보고.exp) || [];
        var 줄 = Promise.resolve();
        /* ★ 한 명씩 사망 처리를 마칠 때 명부에서 뺀다(0x1DD9C) — 그 전엔 진영에 남아 있다 (_사망처리 와 같은 표시) */
        죽음.forEach(function (u) { if (u && !u.alive) u._명부대기 = true; });
        죽음.forEach(function (u) {
          줄 = 줄.then(function () {
            if (!u || u.alive) { if (u) u._명부대기 = false; return null; }
            var 연출 = null;
            if (!u._사망연출함 && 창) { u._사망연출함 = true; 연출 = 창(u); }
            return Promise.resolve(연출).then(function () {
              if (!나 || !나.svc || !나.svc.onKillGain) return null;
              for (var i = 0; i < gains.length; i++)
                if (gains[i] && gains[i].victim === u) return 나.svc.onKillGain(gains[i], u);   /* 0x1DBCD */
              return null;
            }).then(function () { u._명부대기 = false; },
                    function (e명부) { u._명부대기 = false; throw e명부; })
              /* ★ 0x1DDD7 → 0x1DDE3 — 그 진영이 비었나 (이벤트 실행 중이라 런타임이 미뤘다가 이 이벤트 뒤에 돈다) */
              .then(function () { return (나._대본끝 || !나.svc.사망전멸) ? null : 나.svc.사망전멸(u); });
          });
        });
        return 줄.then(function () {
          if (나 && 시전자._시전자복귀미룸) {
            시전자._시전자복귀미룸 = false;
            if (나.svc && 나.svc.시전자자세복귀) 나.svc.시전자자세복귀(시전자);
          }
          if (나 && 시전자._HP소모미룸 && 나.svc && 나.svc.필살HP소모) return 나.svc.필살HP소모(시전자);   /* 0x301BB */
          return null;
        }).then(function () { return v; });
      });
    }
  }

  /* ── 그 밖은 아직 어댑터가 없다 ────────────────────────────────────── */
  if (root.console && root.console.warn) {
    root.console.warn('[SCE연출] ★ ' + 무엇 + '/' + (요청.무엇 || '?') +
                      ' 어댑터가 아직 없다 — 기다리지 않고 넘어간다 (원본 ' +
                      (요청.원본 || '?') + ')');
  }
  return null;
};

/** 실행 보고의 HP·사망·후속 SCE 처리를 정해진 직렬 순서로 마친다. */
Controller.prototype._실행뒤 = function (res, command, intent) {
  var self = this;

  /* ★ [리마스터] **대상이 없어 취소된 필살기** — 링을 걷지도, 연출을 돌지도 않는다.
   *
   *   판정은 `combat.special` 안에 있다(이벤트·AI 도 같은 자리를 지나야 하므로 —
   *   사용자 지시 2026-08-14 「이건 필살기 자체에 넣어야 이벤트 사용에도 같이
   *   적용될 거야」). 여기서는 그 결과를 받아 **링으로 되돌리기만** 한다.
   *   비용은 이미 안 나갔다(`applyHits` 전에 빠져나온다). */
  var rep0 = res && res.report;
  if (rep0 && rep0.cancelled) {
    this.msg(rep0.reason || '대상이 없습니다');
    this.svc.onEvent({ type: 'special_cancel', actor: res.actor || this.actor,
                       slot: rep0.slot, ultimate: rep0.kind === 'ultimate',
                       reason: rep0.reason });
    /* ★ **기본 링**으로 되돌린다 — 필살기 하위 메뉴가 아니다.
     *
     *   사용자 지적 2026-08-14: 「눌렀는데 기존 하위 링커맨드에 있는 게 아니라
     *   **기본 링커맨드로 돌아가야** 하는 거야.」
     *   「필살기 사용 시 적용 범위에 대상이 없으면 그대로 필살기 링커맨드에 있는 게
     *   아니라 **마우스 우클릭으로 초기 링커맨드로 돌아가듯이** 진행되는 거야.」
     *
     *   `resumeRing` → `session.openRing()` → `RingMenu.build()` 가
     *   `menu = 'mainring'` · `stack = []` 로 **맨 위부터 새로 짓는다**.
     *   ★ 뷰는 아직 필살기 서브메뉴를 그리고 있으므로 **먼저 닫는다** —
     *     안 닫으면 새 링이 그 위에 겹친다. */
    if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
    /* ★★★★★ **취소였다는 사실을 반환값에 남긴다** (2026-08-30)
     *
     *   ☠ 여태 `resumeRing()`(→ `openRing()`)의 결과를 그대로 돌려줘서
     *     **`cancelled` 가 지워졌다.** 부르는 쪽은 `{ok:true}` 만 받아
     *     「나갔다」로 읽었다. 실행기 시험에서도 `r.cancelled` 가 `null` 이었다.
     *
     *   `combat.js` 의 취소 주석(2026-08-14)이 이미 짚어 두었다 —
     *     「원인은 면제가 아니라 **부르는 쪽이 취소를 안 다뤘던 것**이다.」
     *   `전투.html` 의 `0x6C`/`0x08` 처리가 「연출만 건너뛰고 다음 명령으로」
     *   가려면 이 값이 있어야 한다.
     *
     *   ★ 링 복귀 자체는 그대로 둔다 — 새 객체에 실어 보낸다. */
    return Promise.resolve(this.resumeRing(rep0.reason || '대상 없음'))
      .then(function (ring) {
        return { ok: false, cancelled: true, cost: false,
                 reason: rep0.reason || '대상 없음',
                 slot: rep0.slot, ultimate: rep0.kind === 'ultimate',
                 targets: [], ring: ring };
      });
  }

  /* ★★★ **마법 함수가 −1 로 끝났으면 연출이 없다** (2026-09-24 · 후속감사35 남은 것 ①)
   *   리바이블 `0x2BC3B` 는 사망자 명부가 비었거나(`0x2BC55 0x113DD`) 적대 아닌 사망자가 없거나
   *   (`0x2BCD3 je`) 앞 칸을 못 쓰면(`0x2BCA7`·`0x2BCC0`) **연출(`0x2BD1C`) 전에 −1** 이다.
   *   사장님 M18: 「죽은 캐릭터 없으면 시전 안되고 메인 링커맨드로 복귀」.
   *   ☠ 여기서 `ok:false` 를 안 보고 연출로 넘어가 **126장 부활 연출이 돌았다**(실측).
   *   ⇒ 필살기 취소와 같이 링을 걷고 기본 링으로 되돌린다. 비용은 모델이 이미 안 냈다. */
  if (command === 'magic' && rep0 && rep0.ok === false) {
    if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
    return Promise.resolve(this.resumeRing(rep0.reason || '시전 실패'))
      .then(function (ring) {
        return { ok: false, cancelled: true, cost: false,
                 reason: rep0.reason || '시전 실패', targets: [], ring: ring };
      });
  }

  /* ★★ 명령이 확정되면 **연출에 들어가기 전에 링을 걷습니다** (0x4B842).
   *
   *   원본 순서: 필살기를 고름 → 링이 닫힘 → 연출 → (이벤트가 걸리면 그 사이에
   *   실행) → 끝나고 `resumeRing`(0x4B8EB)이 다시 펼침.
   *
   *   예전엔 공격(attack)에서만 닫아서, 필살기·마법으로 이벤트에 진입하면
   *   **링이 뜬 채로 대사창이 겹쳤습니다.** 게다가 링은 화면 고정 위치라
   *   카메라가 화자에게 가면 엉뚱한 캐릭터 위에 떠 있는 것처럼 보였습니다.
   *   (이올린이 「살」로 자기 피해 → 블리자드스톰 → 듀란 대사) */
  if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
  var animKind = { attack: 'attack', special: 'special', magic: 'cast',
                   skill: 'skill', defend: 'wait', guard: 'wait',
                   focus: 'wait', rest: 'rest' }[command] || 'wait';
  var animMode = { attack: MODE.ATTACK_ANIMATING, special: MODE.SPECIAL_ANIMATING,
                   magic: MODE.MAGIC_ANIMATING, skill: MODE.SKILL_ANIMATING }[command];
  /* ★ 차징(집중)만 했으면 마법 연출을 틀지 않는다 — 원본 0x433F0 은 [+0x57]+=20 · [+0x7F]=번호+1 만 하고 시전 함수를 안 부른다 (2026-10-02)
   *   사장님: 「이번에는 레오파드를 썼는데, mp는 달지 않았고 집중이펙트도 소모되지 않았어」 · 「범위 밖 레오파드 이미지」
   *   ☠ combat.cast 가 {kind:'charge'} 를 돌려주는데 여기서 보지 않아, 범위에 아무도 없는 큰 마법 연출이 MP 소모 없이 나왔다 */
  if (command === 'magic' && res && res.report && res.report.kind === 'charge') { animKind = 'wait'; animMode = null; }
  if (animMode) this._상태전이(animMode);

  /* ★ `result: res` 를 같이 넘긴다 — 초필살기는 피해를 연출 뒤로 미루므로
   *   (`0x4CA55` 안에서 `0x3B593`) 사망자가 **연출 도중에** 정해진다.
   *   드라이버가 `rep.commit()` 뒤 `p.result.deaths` 를 채워 주지 않으면
   *   `_사망처리` 가 빈 목록을 받아 **사망 연출이 통째로 안 돈다**. */
  return this._연출실행(animKind, { actor: res.actor, report: res.report,
                                intent: intent, result: res })
    /* ★★★★★ **`0x1ED45` — 연출 뒤 · 반격 앞** (2026-08-27 · 사용자 피드백 ③)
     *   `_통상공격S3` 이 `res.후처리보류` 로 미뤄 둔 것을 여기서 돈다.
     *   사망 대사(`0x1DB50`)와 사망 확정(`kill`)이 **공격 연출이 다 끝난 뒤**에
     *   나오게 하는 자리다. `attack반격`(=`0x1EF9A` 의 모델 계산)도 여기 끝에 붙어
     *   있으므로, 바로 아래 `rep.counters` 검사는 이것이 돈 **뒤**여야 한다. */
    .then(function () {
      var f = res && res.후처리보류;
      if (typeof f !== 'function') return null;
      res.후처리보류 = null;                     /* 두 번 돌지 않게 */
      /* ★★★★★ **원본 `0x1DB1D` 의 순서를 그대로 밟는다** (2026-08-27 · 피드백 ④⑪)
       *
       *   ```asm
       *   0x1DB2A  call 0x197AD          ; 대기열에서 제거
       *   0x1DB43  [edx+0x48] = 0        ; HP = 0
       *   0x1DB50  call 0x53797          ; ★ ① S4 — **사망 대사**
       *   0x1DB6F  cmp [ecx+0x48],0 ; jle
       *   0x1DB92  call 0x1124A          ;   카메라를 죽는 유닛으로
       *   0x1DBA1  call 0x463FB          ; ★ ② **사망 연출** (대형은 0x46A11·0x46B2C)
       *   0x1DBCD  call 0x17A20          ;   경험치 대사창
       *   0x1DBEB  … 0x113CC             ;   진영 리스트에서 제거
       *   0x1DDE3  call 0x53F94          ; ★ ③ **§11 진영 전멸**
       *   ```
       *   ⇒ **대사 → 사망 효과 → 전멸 이벤트.** 사용자 설명 그대로다.
       *
       *   ☠ 우리는 ③(`onEvent` 의 §11 스캔)이 ②(사망 연출)보다 **앞**이었다.
       *     그래서 전멸 대사가 사망 효과보다 먼저 떴다 —
       *     「우군 모두 사망후 발생하는 적군 대사도 타이밍이 이상해」 */
      return Promise.resolve(f())                          /* ① 대사 + kill */
        .then(function () { return self._사망처리(res, true); })   /* ② 사망 연출 (반격 몫은 뒤로) */
        .then(function () {
          if (self.svc && self.svc.onEvent) self.svc.onEvent(res);   /* ③ §11 */
          return null;
        });
    })
    .then(function () {
      /* 반격 — 별도 서브상태 (§13.3) */
      var rep = res.report;
      if (rep && rep.counters && rep.counters.length) {
        self._상태전이(MODE.COUNTER_ANIMATING);
        return self._연출실행('counter', { counters: rep.counters });
      }
      return null;
    })
    .then(function () { return self._사망처리(res); })
    .then(function () { return self._군단연타(res, command, intent); })   /* 군단 근접 병종 둘째·셋째 공격 — 0x1F905~0x1F968 (행동 마침 S2·S6 앞) */
    /* ★ 선라이트 회복 — 사망 처리(0x2ABEC call 0x1ED90) «뒤»에 0x2AC75 0x2ACCB (battle_main cast 가 __후회복 으로 미뤄 둔다) */
    .then(function () { var f = res && res.__후회복; if (typeof f !== 'function') return null; res.__후회복 = null; return f(); })
    /* ★★★★★ **행동을 마쳤으면 S2 + S6** — 원본 `0x5401B` (2026-08-22)
     *
     *   원본은 행동 함수 **여덟** 이 각자 끝에서 `call 0x5401B` 를 한다:
     *     `0x169A6` `0x2E7FB` `0x3C95B` `0x40838` `0x4149C` `0x41670` `0x43859` `0x43BD3`
     *   상위 다섯 갈래가 **플레이어**(`0x4CB5E` ← `0x4D4E4`) · **AI**(`0x44913` ← `0x19E6F`) ·
     *   **초필살**(`0x32BCB` ← `0x303A4`) 등으로 갈리지만, 전부 **행동 뒤**다.
     *
     *   ★ 사망 처리(`_사망처리`) **뒤**에 둔다 — 원본도 행동 함수 안에서
     *     `0x1DB1D`(사망) 을 먼저 돌리고 마지막에 `0x5401B` 를 부른다.
     *   ★ `S2S6알림` 이 없으면(구 배선) 조용히 건너뛴다 — `null` 을 돌려준다. */
    .then(function () { return self._리마스터경험창(); })   /* [리마스터] 부분·보조 경험치 — 행동이 끝난 뒤 넣고 레벨업만 창 */
    .then(function () {
      if (typeof self.svc.S2S6알림 !== 'function') return null;
      var 행위자 = res.actor || (self.session && self.session.actor) || null;
      if (!행위자 || 행위자.alive === false) return null;
      var 외 = self.svc.S2S6알림({ 유닛: 행위자, 원본경계: '0x5401B' });
      return (외 && 외.대기) || null;
    })
     .then(function () {
       if (self.pendingOutcome || self.전투끝남) { self._상태전이(MODE.BATTLE_OUTCOME); return self.pendingOutcome || '끝남'; }
       /* 스킬 5 탑승/하차 — 조작 유닛 포인터 자체를 갈아 끼웁니다 (2-D) */
       if (res.actorSwap) self.session.swapActor(res.actorSwap);
       /* 권 기 0x2FFF0 은 [+0x13] 비트만 세운다. 링으로 돌아가는 이 경계에서
        * 0x19FE6 충전을 한 번 소비해야 같은 행동 세션의 TP 250을 쓸 수 있다.
        * recharge가 비트를 지우므로 같은 턴 재진입에서도 중복 적용되지 않는다. */
       if (command === 'special' && intent && !intent.ultimate && (intent.slot | 0) === 22 &&
           res.report && res.report.ok && res.actor && ((res.actor.stance | 0) & 0x80) &&
           root.G2Turn && root.G2Turn.recharge) {
         root.G2Turn.recharge(self.battle, res.actor, self.svc.rng);
       }
       /* HUD 구슬 반영 — 논리에는 영향이 없습니다 */
      if (self.svc.hud && self.svc.hud.drainAp) self.svc.hud.drainAp(self.session.actor.tp | 0);
      /* ★ 0x45B4E — 게이지가 다 깎인 뒤에 다음으로 간다(링 명령 처리 0x4Cxxx 전부 · 2026-09-25 칸 75) */
      var 게이지 = (self.svc.hud && typeof self.svc.hud.drainAp완료 === 'function') ? self.svc.hud.drainAp완료() : null;
      return Promise.resolve(게이지).then(function () { return 링으로(); });
    });
    /* ★★★★★ **링은 이벤트가 «다» 끝난 뒤에 편다** — 원본 `0x3029B call 0x53797` 은 동기라 퇴장 걸음까지 끝나야 `0x4B8EB` (2026-10-09)
     *   > 사장님: 「이벤트로 체력 일정이하시 퇴장하는 경우 링커맨드가 먼저 떠서 오류가 생겨. 공격후 이벤트 확인 후 링커맨드 복귀해야해」
     *   ☠ S4 대기 약속은 대사까지만 기다리고, 걸어 나가는 퇴장(op 0x04)은 보류 연출로 따로 돌아 링이 먼저 열렸다
     *     (9-9 · 24번 HP 절반 미만 → 「후후, 난 이만!」 퇴장 · 실측 1757ms 링 · 2058ms 퇴장 끝).
     *   ⇒ `_이벤트끝날때까지()`(이벤트·연출 잠금이 풀릴 때까지 · 상한 20초)를 지난 뒤에 링으로 간다. */
    function 링으로() {
      /* [리마스터] 행동 뒤 이벤트(S4·S2S6)가 준 부분·보조 경험치도 이벤트가 끝난 그 자리에서 넣는다 (2026-10-10 사장님 「행동 끝나면 바로 경험치 들어와야지 왜 다음행동에 들어와?」) */
      return Promise.resolve(self._이벤트끝날때까지()).then(function () { return self._리마스터경험창(); }).then(링으로본문);
    }
    function 링으로본문() {
      var d = self.session.dispatch(res.ret);
      /* 여기서도 이벤트가 걸릴 수 있으므로 기다린 뒤에 링을 펼칩니다 (위와 같은 이유) */
      var ev2 = self.svc.onEvent({ type: 'dispatch', ret: res.ret, next: d.next, reason: d.reason });
      return Promise.resolve(ev2).then(function () {
        if (d.next === 'RING') return self.resumeRing('ret ' + res.ret);
        return self.endSession(d.reason || ('ret ' + res.ret));
      });
    }
};

/**
 * ★★★★★ **군단 근접 병종 연속 공격** — 플레이어 공격 명령 `0x1F8EC`~`0x1F96A` (2026-11-08 Genesis2 EXE 직독)
 *   ```asm
 *   0x1F8EC  cl = [esi+0x11](직업) · cmp cl,0x86 jb / cmp cl,0x8B ja → 0x1F973(한 번 치는 보통 갈래)
 *   0x1F901  edi = 0
 *   0x1F905 ┌ call 0x1DDF0(dx=1)   ; 피해(S3 포함)
 *   0x1F92C │ call 0x1E61D         ; 공격 연출
 *   0x1F931 │ call 0x1EF5C         ; 대상 자세
 *   0x1F938 │ call 0x1ED45         ; 사망 처리
 *   0x1F93D │ cmp di,2 / jge       ; ★ 첫째·둘째 뒤에만
 *   0x1F945 │ call 0x1EF9A         ;   반격
 *   0x1F959 │ call 0x1D124         ; 지금 자리·방향에서 칠 적이 남았나 — 없으면 끝
 *   0x1F963 │ inc edi
 *   0x1F964 └ cmp di,3 / jl        ; ★ 최대 세 번
 *   ```
 *   직업 134~139 = Infantry·I.Infantry·Cavalry·I.Cavalry·Spear·I.Spear(군단 근접 병종). Bow·Magic·Canon 은 한 번.
 *   ★ 일반 AI 도 같은 공격 명령(0x4016A → 0x40210 → 0x1F738)을 타므로 같은 고리다 — AI 공격 흐름 끝에서도 부른다(runAi 쪽).
 *     ☠ (정정 11-08) «AI 는 0x40D6D~0x40D83 이라 한 번»이라 적었던 것은 다른 AI 갈래만 본 틀린 말이었다 (사장님 「세번친다고」).
 *   ★ TP 40 은 명령 처리(0x4D45C → 0x45B4E)에서 한 번만 낸다 — 둘째·셋째는 TP 를 안 낸다(tpCost 0).
 *   첫째는 보통 공격 길(_통상공격S3 → _실행뒤)이 그대로 하고, 여기서 둘째·셋째를 같은 연출·후처리·반격·사망 길로 돈다.
 *   (사장님 11-08 「공격방식도 이상해. 원작은 한번 공격에 3번씩 연속으로 공격해야해. 모든 병종이 그런건 아니고 병종마다 달라 원작 확인해서 적용해야해.」)
 */
Controller.prototype._군단연타 = function (res, command, intent) {
  var self = this;
  if (command !== 'attack' || !intent || !intent.플레이어공격 || intent.연타회차) return null;
  var A = intent.actor || res.actor, j = A ? (A.job | 0) : -1;
  if (!(j >= 0x86 && j <= 0x8B)) return null;                         /* 0x1F8EF · 0x1F8F8 */
  var C = Cb();
  function 정면적() {                                                  /* 0x1D124 — ai.js 정면적수와 같은 잣대 */
    var 목 = [];
    ((C && C.attackCells) ? (C.attackCells(self.battle, A) || []) : []).forEach(function (c) {
      var t = (c.unit !== undefined) ? c.unit : self.battle.at(c.x, c.y);
      if (!t || !t.alive || t === A) return;
      var 적 = (c.hostile !== undefined) ? c.hostile
             : (C.hostile(A.side, t.side, self.battle.confuse) && !(C.비행막음 && C.비행막음(self.battle, A, t)));
      if (적 && 목.indexOf(t) < 0) 목.push(t);
    });
    return 목;
  }
  var 회차 = 1;
  function 한번() {
    if (회차 >= 3 || !A.alive || self.pendingOutcome || self.전투끝남) return null;   /* 0x1F964 */
    var 앞 = 정면적(); if (!앞.length) return null;                                  /* 0x1F95E je 0x1F96A */
    var 회 = 회차++;
    var it = { actor: A, command: 'attack', targetUnits: 앞, tpCost: 0, 플레이어공격: true, 연타회차: 회 };
    return self._통상공격S3(it, { noCounter: 회 >= 2 }).then(function (r) {           /* 0x1F93D — 셋째(di=2) 뒤는 반격 없음 */
      if (!r || !r.ok) return null;
      if (!r.후처리보류) self.svc.onEvent(r);
      self._상태전이(MODE.ATTACK_ANIMATING);
      return self._연출실행('attack', { actor: A, report: r.report, intent: it, result: r })
        .then(function () {
          var f = r.후처리보류; if (typeof f !== 'function') return null; r.후처리보류 = null;
          return Promise.resolve(f()).then(function () { return self._사망처리(r, true); })
            .then(function () { if (self.svc && self.svc.onEvent) self.svc.onEvent(r); return null; });
        })
        .then(function () {
          var rp = r.report;
          if (rp && rp.counters && rp.counters.length) { self._상태전이(MODE.COUNTER_ANIMATING); return self._연출실행('counter', { counters: rp.counters }); }
          return null;
        })
        .then(function () { return self._사망처리(r); })
        .then(function () { if (!A.alive && r.ret != null) res.ret = r.ret; return 한번(); });   /* 반격에 죽었으면 행동 결과도 «공격자 소멸» */
    });
  }
  return 한번();
};

/** [리마스터] 부분·보조 경험치 정산 (2026-09-26 사장님 · Z-87) — 행동 중에 쌓인 몫을 넣고
 *  레벨이 오른 사람만 원본 레벨업 창(0x17BCA 이하)을 띄운다. 「경험치 N 획득!」 줄은 안 낸다(`조용히`). */
Controller.prototype._리마스터경험창 = function () {
  var C = Cb();
  if (!C || typeof C.리마스터경험정산 !== 'function') return null;
  var 창 = C.리마스터경험정산(this.battle);
  if (!창.length || !this.svc.onKillGain) return null;
  var self = this;
  return 창.reduce(function (p, g) {
    return p.then(function () { return self.svc.onKillGain(g, g.unit); });
  }, Promise.resolve());
};

/** `UNIT_DEATH` → `EVENT_EVALUATE` → `BATTLE_OUTCOME` (§21) */
Controller.prototype._사망처리 = function (res, 반격앞) {
  var self = this;
  /* ☠★★★★★ **반격이 죽인 유닛은 «반격 연출 뒤»에 죽는다** (2026-09-20 · 사장님 지적)
   *
   *   > 「반격으로 적이 사망시 **공격효과와 데미지 표시 이후 캐릭터가 죽어야**
   *   >  하는데, 지금은 **먼저 죽고 효과와 데미지 표시가 나중에** 나와」
   *
   *   ★ 원본은 반격 루프 **안**에서 순서가 정해진다 —
   *     `0x1F145 call 0x1E61D`(공격 연출 본체) → `0x1F14A 0x1EF5C`(자세 복귀)
   *     → `0x1F152 call 0x1ED45`(**사망 처리**). 곧 **연출이 먼저**다.
   *   ☠ 우리는 `attack반격()` 이 `_대상사망` 사슬 끝에서 **연출 전에** 피해를 매기고,
   *     `_결과재확정()` 이 그 사망자를 `res.deaths` 에 담는다. 그래서 반격 연출보다
   *     **앞**에 있는 첫 `_사망처리()` 가 그 유닛을 먼저 죽여 버렸다.
   *   ⇒ `반격앞` 으로 불리면 **반격에 맞을 유닛은 건너뛴다.** 반격 연출이 끝난 뒤
   *     두 번째 `_사망처리()`(인자 없음)가 그때 죽인다 — 원본과 같은 차례다. */
  var 반격맞는이 = null;
  if (반격앞) {
    반격맞는이 = [];
    ((res && res.report && res.report.counters) || []).forEach(function (c) {
      ((c && c.results) || []).forEach(function (r) {
        if (r && r.unit && 반격맞는이.indexOf(r.unit) < 0) 반격맞는이.push(r.unit);
      });
    });
    if (!반격맞는이.length) 반격맞는이 = null;
  }
  /* ★★★★★ **한 유닛의 사망 연출은 한 번뿐이다** (2026-08-27 · 사용자 피드백 ④⑪)
   *
   *   원본 `0x1DB1D` 은 **유닛 한 명짜리 루틴**이고 그 안에서
   *     `0x1DB50` S4(사망 대사) → `0x1DBA1` **사망 연출** → 리스트 제거 → §11
   *   순으로 **한 번** 돈다.
   *
   *   우리는 그 순서를 맞추려고 사망 연출을 **§11 앞**으로 옮겼는데,
   *   반격으로 공격자가 죽는 경우가 있어 **반격 뒤에도 한 번 더** 부른다
   *   (`0x1F9AD call 0x1EF9A` 안의 `0x1F152 call 0x1ED45`).
   *   ⇒ 같은 유닛이 두 번 연출되지 않게 **표시해 둔다.**
   *   ★ S4 가 되살린 유닛은 표시를 지운다 — 다시 죽으면 다시 연출돼야 한다. */
  var deaths = ((res && res.deaths) || []).filter(function (u) {
    if (!u) return false;
    if (u.alive) { u._사망연출함 = false; return false; }
    if (반격맞는이 && 반격맞는이.indexOf(u) >= 0) return false;   /* ★ 0x1F152 는 0x1F145 뒤다 */
    if (u._사망연출함) return false;
    u._사망연출함 = true;
    return true;
  });
  /* ★★★★★ **사망 처리를 마칠 때까지는 진영 명부에 있다** — 원본 0x1DB1D 는 S4(0x1DB50) → 사망 연출 → 0x1DD9C 명부 제거 → 0x1DDD7 비었나 (2026-10-06)
   *   마법은 피해를 한꺼번에 넣어(0x28728 «사망은 나중에») 전원이 곧바로 alive=false 가 된다. 우리 전멸 셈은 alive 로만 세서
   *   첫 사망 처리 도중 다른 알림이 오자 캘리퍼 진영을 «0명»으로 보고 §11(4-8 «멸족» → 0x01 끝)을 먼저 터뜨렸다
   *   (사장님 「한 명 죽는 중간에 로카르노가 이벤트 대사를 하더니 시나리오가 종료되었어 … 시전하고 바로 넘어갔잖아」 · 시험 탭 4-8 재현).
   *   ⇒ 목록 전원에 «명부대기»를 달고(state.js 진영인원이 센다) 한 명씩 처리를 마칠 때 뗀다. */
  deaths.forEach(function (u) { u._명부대기 = true; });
  var chain = Promise.resolve();
  if (deaths.length) {
    /* ★ 모드는 **대사를 기다린 뒤** 세운다 — 기다리는 동안 UNIT_DEATH 로 보이면
     *   계측이 「대사 중에 사망 연출이 돈다」고 잘못 읽는다 (2026-08-27 실측에서 겪었다). */
    /* ★ `0x1DB1D` 은 **유닛 한 명짜리 루틴**이고 사망 연출(`0x1DBB7`)과
     *   경험치 대사창(`0x1DBCD` → `0x17A20` → `0x482A5`)이 둘 다 그 안에 있다.
     *   그래서 광역으로 여럿이 죽으면 **「한 명 연출 → 그 한 명 몫 대사창」이
     *   사람 수만큼 반복**된다 — 몰아서 한 번이 아니다.
     *   (`경험치_레벨업.md` §여럿이 한꺼번에 죽으면) */
    /* 순번으로 짝지으면 어긋난다 — 잡은 사람이 없는 죽음은 `exp` 에 안 실린다.
     * 그래서 `victim`(그 몫이 누구를 잡은 것인지)으로 잇는다. */
    var gains = (res && res.report && res.report.exp) || [];
    deaths.forEach(function (u) {
      /* 사망 연출 전에 S4가 되살렸는지와, 연출 뒤 하차로 같은 슬롯이 살아났는지를
       * 현재 alive 값으로 구분할 수 없다. 이 유닛의 연출 진입 여부를 로컬로 보존한다. */
      var 사망연출시작함 = false;
      /* ★★★★★ **대사가 떠 있는 동안에는 사망 연출을 시작하지 않는다** (2026-08-27)
       *
       *   > 사용자: 「캐릭터가 hp가 0이되어(죽을때) 이벤트 대사가 뜰때,
       *   >  **대사가 먼저나오고 죽는 이펙트는 대사가 끝나고 나와야** 하는데,
       *   >  지금은 **대사 중 나와.** **대사가 나오는 도중 다른 효과는 모두 멈춰야** 해.」
       *
       *   원본은 순차다 — 대사 대기 `0x499EF` 는 화면 갱신과 입력 폴링만 하고
       *   연출 루프(`0x463FB` 등)로 **돌아가지 않는다.** `0x1DB1D` 안에서도
       *   `0x1DB50`(S4 대사)이 **동기 호출**이라 그것이 끝나야 `0x1DBA1`(사망 연출)로 간다.
       *
       *   ☠ 우리 대사는 **비동기**라, 앞 유닛의 사망 대사나 §4 조건 대사가 떠 있는
       *     채로 다음 유닛의 사망 연출이 시작됐다.
       *     실측(1-5): `mode=UNIT_DEATH` 인데 `대사=true` 인 순간이 **35회**.
       *
       *   ⇒ 유닛마다 **연출 직전에** 이벤트가 끝나기를 기다린다.
       *     `_이벤트끝날때까지()` 는 상한(기본 20초)이 있어 영영 멈추지 않는다. */
      var 대본끝건너뜀 = false;
      chain = chain.then(function () {
                     /* ★ 대본(0x01·0x65·0x12)이 판을 끝냈으면 원본은 그 자리에서 프로그램이 끝난다 — 남은 사망 처리는 없다 */
                     if (self._대본끝) { 대본끝건너뜀 = true; return null; }
                     /* ★ `0x1DB50` — S4 HP 이벤트는 사망 연출·하차보다 먼저다.
                      *
                      * 마법/즉사 공통 경로는 `combat.kill()` 이 만든 사망자를 곧장
                      * 여기로 보낸다. 이전 구현은 death 드라이버가 `finishDeath()` 에서
                      * 탈것을 탑승자로 바꾼 뒤에야 아래 EVENT_EVALUATE 에서 HP 조건을
                      * 훑었다. 그러면 2-4A 캐리어(code 1)가 이미 제국병(code 1,
                      * HP 10000)이라 §4의 `HP <= 0` 이 사라진다.
                      *
                      * 평타는 `_대상사망()` 이 같은 경계를 이미 실행하므로 표시로
                      * 중복을 막는다. S4가 살렸다면 원본 `0x1DB6B`처럼 사망 연출도
                      * 취소한다. 객체를 복제하지 않는 이유는 SCE 변경을 실전 유닛에
                      * 그대로 적용해야 하기 때문이다. */
                     if (u._S4사망검사함 || !self.svc.HP변경알림) return null;
                     u._S4사망검사함 = true;
                     var 보 = self.svc.HP변경알림({
                       변경유닛: u, 주체유닛: res.actor || null,
                       이전HP: 0, 이후HP: 0,
                       까닭: '사망', 원본경계: '0x1DB50'
                     });
                     return (보 && 보.대기) || null;
                   })
                   .then(function () { return 대본끝건너뜀 ? null : self._이벤트끝날때까지(); })
                   .then(function () {
                     if (대본끝건너뜀 || self._대본끝) { 대본끝건너뜀 = true; u._S4사망검사함 = false; return null; }
                     /* ★ 사망 연출로 안 가는 두 갈래(되살아남 · 퇴장)는 켜 둔 «연출 중» 표시를 내린다 — `_대상사망` 주석 (2026-10-06 4-8 GS) */
                     var 표시내림 = function () { try { if (self.svc.dyingUnit) self.svc.dyingUnit(u, false); } catch (e내림) {} };
                     if (u.alive && (u.hp | 0) > 0) {
                       u._사망연출함 = false;
                       u._S4사망검사함 = false;
                       표시내림();
                       return null;
                     }
                     /* ★★★★★ `0x1DB61 call 0x11FF7` — S4 이벤트가 진영 목록에서 «빼냈으면»(퇴장) 사망 연출로 안 간다 (2026-10-06)
                      *   사장님 「로카르노와 gs 결투 이벤트에서 gs 패배시 … 죽지 않고 이탈해야하는데 지금은 죽는 걸로 나와」
                      *   3-8 HP 상태 B 0(GS · 모드 3 = HP ≤ 0) → op 0x04 GS 걸어서 퇴장. 원본은 0x1DB66 je 0x1DB71 로 연출을 건너뛴다.
                      *   ☠ 여기는 «되살았나»(0x1DB6B)만 봐서 퇴장한 GS 에도 쓰러지는 연출을 돌렸다 (평타 갈래 _대상사망 은 진영목록에있나 로 이미 본다) */
                     if (u._퇴장함) {
                       u._S4사망검사함 = false;
                       표시내림();
                       return null;
                     }
                     self._상태전이(MODE.UNIT_DEATH);
                     사망연출시작함 = true;
                     return self._연출실행('death', { unit: u });
                   })
                   .then(function () {
                     u._S4사망검사함 = false;
                     if (!사망연출시작함) return null;
                     if (!self.svc.onKillGain) return null;
                     var g = null;
                     for (var i = 0; i < gains.length; i++)
                       if (gains[i] && gains[i].victim === u) { g = gains[i]; break; }
                     if (!g) return null;
                     return self.svc.onKillGain(g, u);   // 0x1DBCD — 이 한 명 몫
                   })
                   /* ★ 0x1DD9C — 이 한 명의 사망 처리가 끝났다 · 명부에서 뺀다 (오류여도 뗀다 — 진영이 영영 안 비면 안 된다) */
                   .then(function () { u._명부대기 = false; },
                         function (e명부) { u._명부대기 = false; throw e명부; })
                   /* ★ 0x1DDD7 → 0x1DDE3 — 그 진영이 비었으면 §11. 이벤트가 끝나야 다음 사람의 사망 처리로 간다(원본 동기 호출) */
                   .then(function () {
                     if (!사망연출시작함 || self._대본끝 || !self.svc.사망전멸) return null;
                     return self.svc.사망전멸(u);
                   });
    });
  }
  return chain.then(function () {
    deaths.forEach(function (u) { u._명부대기 = false; });   /* 안전망 — 모두 뗀 뒤 아래 전멸 검사(0x557F8 자리)로 */
    if (self._대본끝) return null;                          /* 대본이 판을 끝냈다 — 원본은 여기 오지 않는다 */
    /* 마법 드라이버가 미뤄 둔 시전자 복귀 — 사망 연출이 다 돈 뒤 (원본 0x28889 → 0x12124 · 칸 133 · 2026-09-25) */
    var 시전자 = res && res.actor;
    if (시전자 && 시전자._시전자복귀미룸) {
      시전자._시전자복귀미룸 = false;
      if (self.svc && self.svc.시전자자세복귀) self.svc.시전자자세복귀(시전자);
    }
    if (시전자 && 시전자._HP소모미룸 && self.svc && self.svc.필살HP소모) {
      return Promise.resolve(self.svc.필살HP소모(시전자)).then(function () { return 사망뒤이어(); });
    }
    return 사망뒤이어();
  });
  function 사망뒤이어() {
    self._상태전이(MODE.EVENT_EVALUATE);
    /* ★ SCE 조건 검사는 **여기**입니다 — 연출·피해·비용·사망이 다 끝난 자리.
     *
     *   원본은 시전자 HP 소모 루틴이 끝나면서 직접 훑습니다.
     *     0x301BB  … 0x3020C sub [+0x48], ecx   HP 차감
     *              … 0x30285 cmp bx, 0x19       게이지 25프레임
     *       0x30292  call 0x12124               픽셀 오프셋 되돌리기
     *       0x3029B  call 0x53797 (eax=유닛, ebx=1)  ★ 카테고리 4 = HP 조건
     *   그리고 `0x301BB` 자체가 `0x4CA6E`, 곧 **연출 함수가 반환한 뒤**에 불립니다.
     *
     *   예전엔 명령을 낸 직후(`onEvent(res)`)에 훑어서, 눈보라가 도는 중에
     *   대사창이 떴습니다. */
    /* ★ 이벤트가 걸리면 **끝날 때까지 기다립니다.** 원본은 `0x3029B call 0x53797`
     *   이 동기 호출이라, 이벤트가 다 끝나야 `0x4D442` 가 반환되고 그제서야
     *   `0x4B8EB`(링 다시 펼치기)이 돕니다. 안 기다리면 링이 열린 채로 대사가
     *   진행됩니다. */
    /* ★ `deaths` 를 여기 실어 보내면 안 된다 — 사망 연출이 **이미 끝난** 뒤라
     *   받는 쪽이 「죽는 순간」 표시(`R.dyingUnit`)를 다시 켜서 **시체가 남는다**.
     *   개수만 알린다. */
    /* ★★★★★ **HP 변경 보고를 창구에 넘긴다** — 통합 2-c 1단계 (2026-08-22)
     *
     *   `combat.js` 가 `rep.hp변경` 에 실어 보낸 것을 **여기서** 창구에 넘긴다.
     *   순수 규칙층은 `SceRuntime`·컨트롤러를 모른다 (GPT 12차).
     *
     *   ★ 이 자리가 원본 `0x3029B` 다 — 연출·피해·비용·사망이 다 끝난 뒤.
     *   ★ 지금은 **shadow** — 창구 받개가 아직 `SceRuntime` 을 안 부른다.
     *     `보고.대기` 가 생기면 **여기서 기다린다**(아래 `대기들`). */
    var 대기들 = [];
    if (self.svc.HP변경알림 && res && res.hp변경 && res.hp변경.length) {
      /* ★★★★★ **예외를 삼키지 않는다** — GPT 13차 검수 (2026-08-22)
       *
       *   전에는 `try { … } catch (e) {}` 로 감쌌다. 그러면
       *   가짜 원본경계 · 창구 계약 위반 · 받개/SceRuntime 예외 ·
       *   세션 오연결이 **전부 사라진다.**
       *   `G2HpWatch` 가 「표 밖 주소는 반드시 던진다」는 계약을 가졌는데
       *   바로 위 호출자가 삼키면 **실제 전투에서는 보호가 무효**다.
       *   ⇒ 그대로 던지게 둔다. 상위 Promise 로 전파된다. */
      res.hp변경.forEach(function (o) {
        var 보 = self.svc.HP변경알림(o);
        if (보 && 보.대기) 대기들.push(보.대기);
      });
      res.hp변경.length = 0;              /* 두 번 넘기지 않는다 */
    }

    var ev = self.svc.onEvent
      ? self.svc.onEvent({ type: 'eventScan', deathCount: deaths.length }) : null;
    return Promise.all(대기들.concat([Promise.resolve(ev)])).then(function () {
      var o = self.checkOutcome();
      if (o) { self.pendingOutcome = o; self.전투끝남 = true; }
      return o;
    });
  }
};

/**
 * 승패 — §21.3. 지금은 **전멸 조건만** 봅니다.
 * ★★★★★ **실측으로 규모를 쟀다 (2026-08-29)** — 안 옮긴 것은 **네 건뿐**이다.
 *   `.SCE` **294개 전수**에서 승패 op(`0x01` 전투승리 · `0x65` 전투패배)를 세니
 *   **outcomes 4건**밖에 없다:
 *     승리 — 「**4 HP 조건**」 2건 · 「**B 진영 전멸**」 1건 · 「**6 유닛 조우**」 1건
 *     패배 — **0건**
 *   나머지 290개는 승패 스크립트가 **아예 없다** — 전멸 조건으로 끝난다.
 *   ⇒ 지금 「전멸 조건만 본다」가 **294개 중 290개에서 원본과 같다.**
 *   ☐ 남은 네 건(HP 조건 · 진영 전멸 · 유닛 조우)만 옮기면 된다.
 */
/**
 * ★★★★★ **새 전투로 갈아 끼운다** — 셸 체인(op 0x12) 재진입용 (2026-08-23)
 *
 *   사용자 지적: 「2-4 대화 이벤트가 끝나면 자동으로 2-4a 전투가 시작되고」
 *
 *   전투 단독(`전투.html`)은 시나리오마다 **페이지가 새로 뜨므로** 컨트롤러도
 *   새로 만들어진다. 셸(`게임.html`)은 전투 조각을 한 세션에 한 번만 싣기 때문에
 *   `ctrl` 이 **옛 `battle` 을 계속 들고 있었다** — 실측에서 2-4A 로 체인했는데
 *   `ctrl.battle` 이 여전히 2-4 의 아군 9명(적 0명)이라 시작하자마자
 *   「적 전멸 승리」가 났다(`window.battle` 은 20명으로 제대로 새로 만들어졌다).
 *
 *   ⇒ 생성자가 세우는 **인스턴스 상태를 그대로 다시 세운다.**
 *     `svc`·`movement`·`selector` 는 화면·난수기와 엮여 있어 **그대로 둔다**
 *     (원본도 전투 사이에 화면·난수 스트림을 갈지 않는다).
 *
 *   ★ 여기 목록은 생성자와 **한 벌**이다 — 생성자에 필드를 더하면 여기도 더한다.
 */
Controller.prototype.전투교체 = function (battle) {
  if (!battle) throw new Error('전투교체: battle 이 없다');
  /* ★ 컨트롤러 리셋 (2026-11-07 사장님 「애초에 새 시나리오를 선택하면 컨트롤러를 리셋해야해.」)
   *   옛 전투에서 돌던 진행 고리(settle)·AI 사슬은 이 세대를 보고 거기서 멈춘다 — 새 전투에 손대지 않는다.
   *   진행 고리 수도 0 으로 — 옛 고리가 남아 있다고 세면 스페이스 재개가 새 고리를 못 세운다. */
  this._리셋세대 = (this._리셋세대 | 0) + 1;
  this._진행고리 = 0;
  this.battle = battle;
  this.mode = MODE.BOOTSTRAP;
  this.actor = null;
  this.session = null;
  this.cursorTile = { x: 0, y: 0 };
  this.ringContext = null;
  this.rangeContext = null;
  this.moveDraft = null;
  this.targetDraft = null;
  this.actionSnapshot = null;
  this.animationToken = (this.animationToken | 0) + 1;   /* 0 으로 되돌리면 옛 연출의 토큰과 겹칠 수 있다 — 올린다 */
  this.inputLock = false;
  this.pendingOutcome = null;
  /* ★★★★★ **전투가 끝났다는 사실은 지워지지 않는다** (2026-08-27 · 피드백 ⑫)
   *   `pendingOutcome` 은 **셸이 읽고 비운다**(`screens.js` BATTLE 틱).
   *   그것만 보면 셸이 비운 순간 `settle()` 이 **다시 라운드를 돌린다** —
   *   실측(1-5): 결말 `clear` 뒤에도 턴이 16 → 31 로 계속 올라갔다.
   *   원본은 `op 0x01` → `0x506F3` → `0x61CFF` 로 **프로세스가 끝난다.**
   *   ⇒ 「끝났다」는 컨트롤러가 따로 기억하고, 전투를 새로 시작할 때만 지운다. */
  this.전투끝남 = false;
  this.pendingNextScenario = null;
  this._대본끝 = false;
  this.statusUnit = null;
  this._statusReturn = null;
  this.pendingCommand = null;
  this.lastActivation = null;
  this.history = [];
  this._guard = 0;
  this._SCE소비중 = null;
  this._SCE세션 = 0;              /* 이벤트 세션 겹침 수 — 0x49C05 호출부 전수 근거 */
  /* ★ 새 전투이므로 **초기 진영 인원을 다시 잰다** — 안 지우면 옛 시나리오의
   *   인원으로 전멸을 판정한다(`checkOutcome` 참조). */
  this._초기진영 = null;
  /* ★ SCE 세대는 **올린다** — 옛 시나리오의 늦은 연출·재개가 새 전투에 끼어들지
   *   못하게 막는 그 장치다(`SCE세대올리기` 와 같은 뜻). */
  this.SCE세대 = (this.SCE세대 | 0) + 1;
  if (this.movement && this.movement.reset) { try { this.movement.reset(); } catch (e) {} }
  if (this.selector && this.selector.reset) { try { this.selector.reset(); } catch (e) {} }
  return this;
};

/** 생존 진영을 검사해 전멸과 전투 종료 여부를 판정한다. */
/**
 * ★★★★★ **퀵로드 복원 안정 경계** — 2026-09-21
 *
 * QSV 는 전투 모델을 되살리지만 링/대상선택/이동 draft/진행 중 Promise 를
 * 직렬화하지 않는다. 그래서 그 중간 상태를 흉내내지 않고 **FRAME_IDLE** 로 접는다.
 * 원본 모델값(`battle.phase`·turn·unit state)은 건드리지 않는다.
 *
 * 이 함수는 새 전투를 만드는 `전투교체()` 와 다르다. 같은 Battle 인스턴스의
 * 저장 상태를 복원한 뒤 **입력/선택 계층만** 안전 경계로 되돌린다.
 */
Controller.prototype.복원안정화 = function (왜) {
  this.SCE세대올리기('퀵로드 복원: ' + (왜 || 'QSV'));
  try { if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close(); } catch (e) {}
  try { if (this.svc.hud && this.svc.hud.hideAiBar) this.svc.hud.hideAiBar(); } catch (e2) {}
  try { if (this.svc.hud && this.svc.hud.selectUnit) this.svc.hud.selectUnit(null); } catch (e3) {}

  this.actor = null;
  this.session = null;
  this.ringContext = null;
  this.rangeContext = null;
  this.moveDraft = null;
  this.targetDraft = null;
  this.actionSnapshot = null;
  this.pendingCommand = null;
  this.lastActivation = null;
  this.statusUnit = null;
  this._statusReturn = null;
  this.inputLock = false;
  this.animationToken = (this.animationToken | 0) + 1;
  this.pendingOutcome = null;
  this.전투끝남 = false;
  this.pendingNextScenario = null;
  this._대본끝 = false;
  this._guard = 0;
  this._autoResume = 0;
  this._푸는중 = false;
  if (this.movement && this.movement.reset) { try { this.movement.reset(); } catch (e4) {} }
  if (this.selector && this.selector.reset) { try { this.selector.reset(); } catch (e5) {} }

  /* 현재 phase 가 player 라면 바로 클릭 가능한 유닛을 초점만 잡는다. run 이면
   * 제품 quickLoad() 가 이 함수 뒤 `settle()` 로 원본 메인 루프를 다시 잇는다. */
  var q = [];
  try { q = this.readyUnits(); } catch (e6) {}
  var focus = q.length ? q[q.length - 1] : null;
  if (!focus && this.battle && this.battle.units) {
    for (var i = 0; i < this.battle.units.length; i++) {
      var u = this.battle.units[i];
      if (u && u.alive !== false) { focus = u; break; }
    }
  }
  if (focus) {
    this.actor = focus;
    this.cursorTile = { x: focus.x | 0, y: focus.y | 0 };
    try { if (this.svc.view && this.svc.view.center) this.svc.view.center(focus.x, focus.y); } catch (e7) {}
  }
  this._상태전이(MODE.FRAME_IDLE, '퀵로드 안전 경계');
  return this;
};

Controller.prototype.checkOutcome = function () {
  var b = this.battle;
  /* ★ 탑승자가 곧 내릴 탈것도 센다 (state.js 진영인원 · 0x1DCF7 분리 뒤에 판정 · 2026-10-05 2-4A 임페리얼) */
  var 인원 = function (s) { return (typeof b.진영인원 === 'function') ? b.진영인원(s) : b.living(s).length; };
  var allies = 인원(1) + 인원(2);
  var foes = 인원(3) + 인원(4);

  /* ★★★★★ **처음부터 0명인 진영은 「전멸」이 아니다** (2026-08-23 · 원본 확정)
   *
   *   사용자 지적: 「2-4 대화 이벤트가 끝나면 자동으로 2-4a 전투가 시작되고」
   *
   *   `2-4.SCE` 는 **아군만 있고 적이 0명인 대화 전용 시나리오**다(실측 유닛
   *   `[9,0,0,0]`). 그런데 여기서 곧바로 `victory` 가 나 **대사가 끝나기도 전에
   *   전투가 끝났다.**
   *
   *   원본은 그러지 않는다 — `승패조건_SCE_분석.md`:
   *     §18  「승리 조건은 **`.SCE` 안의 이벤트 스크립트**. 전용 필드가 아니다」
   *     §175 「**전멸**은 그 진영 연결 리스트의 head 가 NULL 이 되는 **순간**이다」
   *   그 판정은 **유닛 사망 처리 끝**(`0x3C2C1`~`0x3C2F6`)에서만 돈다:
   *     `0x3C2CE` 리스트에서 제거 → `0x3C2EB cmp [ecx+0xCC968], 0` → `0x53F94` 카테고리 B
   *   ⇒ **누가 죽어야** 판정이 일어난다. 처음부터 비어 있으면 그 순간이 없다.
   *
   *   ★ 그래서 **전투를 시작할 때의 인원**을 기준으로 삼는다. 0 이었던 진영은
   *     아무리 지금 0 이어도 전멸이 아니다.
   *   ★ 이 함수 자체는 원본에 없는 **안전망**이다(`.SCE` 에 승패 조건이 없는
   *     시나리오도 끝나야 하므로 남긴다). 다만 **원본이 절대 내지 않는 결과는
   *     내지 않게** 막는다. */
  /* ★★★★★ **「처음」이 아니라 「한 번이라도 있었나」다** (2026-08-28 · 실측으로 잡음)
   *
   *   ☠ 전에는 이 값을 **첫 판정 때 한 번만** 정했다. 그런데 `1-5.SCE` 처럼
   *     **적이 이벤트로 나중에 등장**하는 시나리오는 그 순간 적이 0명이라
   *     `_초기진영.적군 = 0` 으로 굳었다. 그러면 아래 `처음적군 > 0` 이 영영
   *     거짓이라 **적을 다 죽여도 승리 판정이 나지 않는다.**
   *
   *     실측 (1-5 · 검증 크롬 9333) — 암흑살수 4명을 전부 죽인 뒤:
   *       `living(3) = 0` · `_초기진영 = {아군:4, 적군:0}` · `checkOutcome() → null`
   *
   *   원본 근거 (`승패조건_SCE_분석.md` §175) —
   *     「**전멸**은 그 진영 연결 리스트의 head 가 NULL 이 되는 **순간**이다」
   *   곧 「**있었다가 없어지는** 순간」이지 「처음에 있었나」가 아니다.
   *   ⇒ 볼 때마다 **최댓값으로 갱신**한다. 처음부터 끝까지 0인 진영은 여전히 0 이라
   *     「대화 전용 시나리오가 곧바로 victory」를 내던 문제도 그대로 막힌다. */
  if (!this._초기진영) this._초기진영 = { 아군: 0, 적군: 0 };
  this._초기진영.아군 = Math.max(this._초기진영.아군 | 0, allies);
  this._초기진영.적군 = Math.max(this._초기진영.적군 | 0, foes);
  var 처음아군 = this._초기진영.아군, 처음적군 = this._초기진영.적군;

  /* ★★★★★ **§11 이 있는 진영은 안전망이 건드리지 않는다** (2026-08-27 · 사용자 ①)
   *
   *   > 「아직도 **1-2부터 1-5진행에 루프 돌아서 계속 반복**돼」
   *   > 「모두 죽은뒤 **적군 이벤트 대사**가 나와야해」
   *
   *   ── 왜 두 증상이 하나인가 ────────────────────────────────────
   *   원본에는 자동 승패가 **없다**. 사망 처리 끝(`0x3C2C1~0x3C2F6`)에서
   *     `cmp [ecx+0xCC968],0` → `call 0x53F94`
   *   로 **§11(카테고리 B) 이벤트를 훑을 뿐**이고, 승패는 그 본문의
   *   `0x01`/`0x65`/`0x12` 가 정한다 (`승패조건_SCE_분석.md` §2.2).
   *
   *   `1-5.SCE` 는 §11 진영이 **1(우군)** 이고 본문이 **`0x01`(전투 종료)** 다
   *   — 유닛 구성이 `[아군 0 · 우군 4 · 적 0]` 이라 마크 일행이 우군이고,
   *   그들이 전멸하면 **클리어**다(스토리상 전멸 = 게임상 진행).
   *   그런데 이 안전망이 「아군 전멸 → defeat」를 **먼저** 내는 바람에
   *     ① 셸이 `fail` → `재실행:true` 로 **같은 지점에 재진입** (무한 루프)
   *     ② §11 이 돌 틈이 없어 **적군 대사가 한 번도 안 나옴**
   *   두 증상이 **한 원인**이었다.
   *
   *   ⇒ `.SCE` 에 그 진영의 §11 이 있으면 **입을 다문다.**
   *     결과는 이벤트가 정하고, 그때 `pendingOutcome` 이 채워진다.
   *   ★ 없을 때만 안전망이 끝낸다 — 승패 조건이 없는 `.SCE` 도 끝나야 하므로. */
  var 물어 = this.svc && this.svc.전멸이벤트있나;
  function 이벤트가맡나(진영인덱스) {
    if (typeof 물어 !== 'function') return false;
    try { return !!물어(진영인덱스); } catch (e) { return false; }
  }

  if (처음아군 > 0 && allies === 0) {
    /* 진영 번호 1·2 → 인덱스 0(아군)·1(우군). 둘 중 하나라도 §11 이 맡으면 뺀다 */
    if (이벤트가맡나(0) || 이벤트가맡나(1)) return null;
    return { result: 'defeat', reason: '아군 전멸' };
  }
  if (처음적군 > 0 && foes === 0) {
    if (이벤트가맡나(2) || 이벤트가맡나(3)) return null;
    /* ★ 시나리오에 승리 명령(0x01 전투 종료 · 0x12 다음 맵)이 하나라도 있으면 승리는 그 이벤트가 정한다 — 원본에 자동 승리가 없다.
     *   전수(.SCE 345): 승리 명령이 없는 것은 시험·아레나 18개뿐 — 안전망은 그들에게만.
     *   ☠ 2-5 는 적 전멸 §11 이 없고 「이올린이 위쪽 줄 (2,4)-(51,4) 도착 → 0x01」(§2#0) 로 끝나는데,
     *     안전망이 적 전멸만으로 승리를 내 화면이 멈췄다 (2026-10-02 사장님 「2-5 시나리오에서 적군 전멸시 승리화면이 뜨고 게임이 멈추는 문제」) */
    try {
      var P승 = root.G2SceLive;
      var 승리명령 = !!(P승 && (P승.sections || []).some(function (s) {
        return (s.events || []).some(function (e) {
          return (e.script || []).some(function (x) { return x && (x.op === 0x01 || x.op === 0x12); });
        });
      }));
      if (승리명령) return null;
    } catch (e승) {}
    return { result: 'victory', reason: '적 전멸' };
  }
  return null;
};

/* ══════════════════════════════════════════ 7. 이동 (0x16834 반복 루프) */

Controller.prototype.enterMove = function () {
  this._상태전이(MODE.MOVE_RANGE_BUILD);
  var r = this.movement.enter(this.battle, this.session.actor,
                              { exitCost: this.session.exitCost });
  if (!r.ok) return this.moveExit();
  this.rangeContext = { kind: 'move', cells: this.movement.highlight(), budget: r.budget };
  this._상태전이(MODE.MOVE_DESTINATION_SELECT);
  return { ok: true, budget: r.budget, cells: r.cells, mode: this.mode };
};

/** 반복 루프의 다음 바퀴 — 0x4D98E */
Controller.prototype.moveLoop = function () {
  this._상태전이(MODE.MOVE_RANGE_BUILD, 'loop');
  var r = this.movement.buildRange();
  if (!r.ok) return this.moveExit();
  this.rangeContext = { kind: 'move', cells: this.movement.highlight(), budget: r.budget };
  this._상태전이(MODE.MOVE_DESTINATION_SELECT);
  return { ok: true, budget: r.budget };
};

/** 방향 확정 — 여기서 처음 좌표·방향·TP 가 커밋됩니다 (§27-4) */
Controller.prototype.confirmFacing = function () {
  var self = this;
  var p = this.movement.prepareCommit();
  if (!p.ok) {
    /* ★ 되돌림 2026-08-26 — 「못 서면 목적지 선택으로」가 무한 루프를 낼 수 있어 뺀다.
     *   원본 0x1692D je 0x169CD → jmp 0x1685B 가 그렇게 도는 것은 맞지만,
     *   우리 상태기계에서는 되돌아간 뒤 같은 자리를 다시 확정하려 해 맴돌 수 있다.
     *   **화면에서 끝까지 확인한 뒤** 다시 넣는다. */
    return Promise.resolve({ ok: false, reason: p.reason });   // 거부, 상태 유지
  }

  /* ★★★★★ **출발 칸은 커밋 「앞」에서 떠 둔다** (2026-09-05 · 사용자 지적)
   *
   *   > 「원본은 캐릭터가 이동할때 **캐릭터에 포커스가 계속 따라가**
   *   >  (맵이 움직이는 것처럼 보임). 우리는 **도착 지점에 포커스가 고정**되고
   *   >  캐릭터는 별도로 움직임.」
   *
   *   ☠ 아래 `_시작칸` 은 **이름과 달리 도착 칸**이었다 — 바로 위 `commit()` 이
   *     좌표를 목적지로 옮긴 **뒤에** `session.actor.x` 를 읽었기 때문이다
   *     (이 함수 머리 주석이 「**여기서 처음 좌표·방향·TP 가 커밋됩니다**」라고
   *      스스로 적어 두었다).
   *   ⇒ 카메라가 도착지로 가고, 그러면 `camFollowsAxis` 의
   *     「유닛 − 카메라좌상단 == 6」이 **처음부터 거짓**이라 걷는 내내 안 따라간다.
   *
   *   ★ 원본은 `0x1694C call 0x1124A` 시점에 유닛이 **아직 출발점**에 있다 —
   *     좌표는 `0x15F47` 이 **칸의 절반**에서 한 칸씩 옮긴다. */
  var _출발칸 = { x: this.session.actor.x | 0, y: this.session.actor.y | 0 };
  this._상태전이(MODE.MOVE_COMMIT);
  var res = Xc().commit(this.battle, p.intent, { rng: this.svc.rng });
  this.svc.onEvent(res);
  /* 논리 좌표는 이미 도착점으로 커밋됐지만, 그림은 DRIVER.move가 출발점부터
   * 인수한다. 여기서 updateUnit()을 먼저 부르면 방향 확정 직후 도착점에 한 프레임
   * 나타났다가 드라이버가 숨겨 사용자에게 순간이동처럼 보인다. */
  /* ☠★★★★★ **커밋 직후 그림을 출발 칸으로 되돌린다** — `0x15F47` (2026-09-22)
   *
   *   > 사장님: 「이동 가능영역에서 타일 선택시 **해당 타일로 순간이동한것처럼
   *   >  해당 지점에 캐릭터가 나타났다가 사라지고** 이동이 시작돼」
   *
   *   원본은 「먼저 옮기고 걷는다」가 **아니다** — `0x15EB5` 가 한 칸을 옮기며
   *   **칸의 절반에서** `0x15F47` 로 좌표를 하나씩 갱신한다. 곧 걷기 전에는
   *   유닛이 아직 출발 칸에 있다.
   *   ☠ 우리는 `commit()` 이 좌표를 목적지로 옮긴 **뒤**, 아래 카메라 맞춤
   *     (`svc.focus` → `focusScroll` → `apply()`)이 화면을 다시 그린다.
   *     그 사이 유닛이 **도착 칸에 한 번 나타났다가** 드라이버가 출발점으로
   *     되돌리며 사라진다 — 사장님이 보신 그 깜빡임이다.
   *   ⇒ 걷기 드라이버가 있을 때만(= 실제로 걸어갈 때만) 그림 좌표를 출발 칸으로
   *     되돌린다. `DRIVER.move` 가 `path[0]` 에서 인수해 걸음마다 갱신하고,
   *     `finish()` 가 경로 마지막 칸(= 커밋된 목적지)에서 멈춘다.
   *   ★ 연출이 없으면(드라이버 없음·즉시 모드) **건드리지 않는다** — 그때는
   *     커밋된 좌표가 곧 최종 좌표다. */
  try {
    var _A연 = this.svc.anim;
    if (_A연 && typeof _A연.드라이버있나 === 'function' && _A연.드라이버있나('move') &&
        p.plan && p.plan.path && p.plan.path.length > 1) {
      var _주 = this.session.actor;
      _주.x = _출발칸.x; _주.y = _출발칸.y; _주.ox = 0; _주.oy = 0;   /* 0x1626F 와 같은 자리 */
    }
  } catch (e되돌) { /* 되돌리지 못해도 이동 자체는 그대로 돈다 */ }
  if (this.svc.hud && this.svc.hud.drainAp) this.svc.hud.drainAp(this.session.actor.tp | 0);

  this._상태전이(MODE.MOVE_ANIMATING);
  /* ★★★★★ **걷기 직전에 카메라를 유닛에게 맞춘다** — `0x1694C` (2026-08-26)
   *
   *   사용자: 「링커맨드를 통해 이동할떄, 캐릭터 이동할 타일 선택후 방향지정을 하면
   *   **본래 캐릭터 위치로 카메라가 이동**하고 캐릭터가 이동하는동안 카메라가
   *   캐릭터를 계속 따라가야 하는데 이부분 제대로 적용이 안되었어.」
   *
   *   ```asm
   *   0x1693F  edx = [esi+1] · eax = [esi]   ; 유닛 칸
   *   0x1694C  call 0x1124A                  ; ★ 카메라 맞춤 (= 본래 위치로)
   *   0x16955  call 0x1620A                  ;   경로 재생
   *   ```
   *   `0x1124A` 는 스크롤 옵션을 보고 스르륵 가거나 순간이동한다(`0x1126D`).
   *   그 뒤 `0x15EBB` 가 **한 칸마다** 추종 여부를 다시 재므로,
   *   여기서 맞춰 두면 걷는 동안 `camFollowsAxis` 가 계속 따라간다.
   *
   *   ★ 우리는 이 자리가 **통째로 빠져 있었다** — 그래서 화면이 엉뚱한 데 있으면
   *     유닛만 걸어가고 카메라가 안 따라왔다. */
  var _시작칸 = _출발칸;                     /* ★ 커밋 앞에서 뜬 값 — 0x1693F */
  /* `svc.focus` 가 곧 `R.focusScroll`(= `0x1124A`) 창구다 (`battle_main` 1239). */
  var _카메라 = Promise.resolve();
  try {
    if (this.svc.focus) _카메라 = Promise.resolve(this.svc.focus(_시작칸.x, _시작칸.y));
  } catch (e카) { _카메라 = Promise.resolve(); }

  return _카메라.then(function () {
    return self._연출실행('move', {
      unit: self.session.actor, path: p.plan.path, facing: p.plan.facing,
      from: p.plan.from, to: p.plan.to, remain: p.remain
    });
  }).then(function () {
    self._상태전이(MODE.POST_MOVE);
    self.moveDraft = null;
    var a = self.movement.afterCommit({ survived: self.session.actor.alive });
    self.session.exitCost = a.exitCost;
    /* ★★★★★ **맵 아이템 습득 알림** — 원본 0x16987 → 0x18B2E → 0x5196F 대사창
     *   (2026-08-25 · 사용자 지적 11)
     *
     *   사용자: 「해당 아이템을 습득했을때 **시나리오에 정해진 경험치**를 얻고
     *   이는 **적을 처치했을때처럼 대화창으로 표시**되어야해.」
     *
     *   `승패조건_SCE_분석.md` §504 — `0x5196F` 가 ITEM.DAT 이름 + "획득!" 을 띄우고
     *   착용 판정(0x1832D)까지 한다. 경험치·ELD 는 레코드의 `+3`·`+5` 다.
     *   ☐ 착용/보관 갈래(`0x1888D`)와 그리기는 아직이라,
     *     지금은 **획득 사실과 경험치·ELD 만** 이벤트로 올린다.
     *     ★ 2026-08-29 — `0x1888D` 는 **그리기 연출 함수**임을 확인했다
     *       (`state.js` 의 같은 날 주석에 근거를 적었다):
     *       `0x18897` 에서 `1 · 130 · 162 · 189 · 184`, `0x188D1` 에서 `125 · 146 · 93`
     *       여덟 값을 스택에 심고 `0x188FF` 에서 카메라 `[0x4A83C]`·`[0x4A83A]` 를 읽는다.
     *     ☐ **무엇을 띄우는지**는 아직 — `0x188FF` 이후를 더 봐야 한다. 값을 옮기지 않는다. */
    /* ★★★★★ **칸이 둘 다 찼을 때 — 「어디에 넣을까」 창** (원본 `0x18BA6 call 0x1888D`)
     *
     *   `state.js pickMapItem()` 이 그 경우 `{칸선택필요:true, …}` 를 올리고
     *   `movement.js` 가 `a.칸선택` 으로 갈라 준다. 여기서 창을 띄운다.
     *
     *   ```asm
     *   0x18BA6  call 0x1888D              ; 창
     *   0x18BAB  test ax,ax / je 0x18D2E   ; ★ 0 = ESC → **못 먹는다**(바닥에 남는다)
     *   0x18AF7  test di,di / jne 0x18B08  ;   고른 칸
     *   0x18B01    call 0x4ECE4            ; 칸 0 — **새 것**을 창고로. 배낭 그대로
     *   0x18B0E    al = [edx+0x5F]         ; 칸 1 — **예비 칸**의 것을
     *   0x18B11    call 0x4ECE4            ;        창고로 보내고
     *   0x18B19    [edx+0x5F] = 새 코드    ;        그 자리에 새 것
     *   ```
     *   ★ 보조 칸 `+0x5E` 는 **어느 갈래에서도 안 바뀐다.**
     *   ★ 어느 쪽을 골라도 **바닥에서는 사라진다**(둘 다 `eax = 1`). ESC·오른쪽만 0. */
    /* ★ 아이템 경험치는 한 창구로 — 배낭에 바로 들어가든, 칸을 골라 창고로 보내든 같다 (원본 0x18CC5 · combat 아이템경험) */
    function 아이템경험넣기(u, exp) {
      try { return (Cb() && Cb().아이템경험) ? Cb().아이템경험(self.battle, u, exp | 0) : null; }
      catch (e아경) { return null; }
    }
    if (a.칸선택 && root.G2SlotPick) {
      var 칸 = a.칸선택;
      var 창이름 = null;
      try {
        var It1 = root.G2Item;
        /* ★ 위 「1-기준 표」와 같은 자리 — `코드 − 1` 로 찾으면 한 칸 앞 이름이 나온다 (2026-09-22) */
        var 행1 = It1 && It1.at ? It1.at(칸.code | 0) : null;
        창이름 = 행1 && (행1['이름'] || 행1.name);
      } catch (e창) {}
      return new Promise(function (완료) {
        root.G2SlotPick.열기({ 이름: 창이름 || '' }, function (고른) {
          if (고른 == null) return 완료(다음단계());        // 0x18B23 — 못 먹는다
          var u1 = 칸.unit, g1 = (u1 && u1.gear) || null;
          var 밀린것 = null;
          if (고른 === 1 && g1) {                            // 0x18B0E~0x18B19
            밀린것 = g1.sub2 | 0;
            g1.sub2 = 칸.code | 0;
          }                                                  // 고른 === 0 → 배낭 그대로 (0x18B01)
          /* ★ `0x4ECE4` = `[0xFE4FF + 시나리오×0x1E]` **획득 목록**.
           *   전투 사본에는 그 저장소가 없어 `battle.획득아이템` 에 기록만 남긴다 —
           *   `sceapply.js:257`(`op 0x06` 갈래 0)이 쓰는 것과 **같은 자리**다. */
          try {
            var b1 = self.battle, 보낼 = (고른 === 1) ? 밀린것 : (칸.code | 0);
            if (b1 && 보낼) (b1.획득아이템 || (b1.획득아이템 = [])).push(보낼 | 0);
          } catch (e창고) {}
          /* 바닥에서는 사라진다 — 둘 다 `eax = 1`(0x18B1C).
           * `state.js:1740` 이 `it.taken` 을 보고 건너뛴다. */
          var 집은것 = null;
          try {
            var ms = self.battle && self.battle.mapItems;
            for (var mi = 0; ms && mi < ms.length; mi++) {
              var it1 = ms[mi];
              if (!it1.taken && it1.x === 칸.x && it1.y === 칸.y) {
                집은것 = it1;
                if (self.battle.markMapItemTaken) self.battle.markMapItemTaken(it1);
                else it1.taken = true;
                break;
              }
            }
          } catch (e지움) {}
          /* ★★★★★ **고른 뒤에 획득 대사창이 뜬다** — 원본 `0x18BB4`~`0x18C05` (2026-09-24)
           *
           *   > 사장님: 「그전에 **획득 메세지가 뜨고** 저 선택 창이 뜨는걸로 알고있는데
           *   >  지금 **저것만** 뜨잖아. 뭔지도 모르고.」
           *
           *   원본 순서를 읽어 확정했다 — **선택창이 먼저이고 메시지가 나중**이다:
           *   ```asm
           *   0x18BA6  call 0x1888D          ; 선택창 (창 안에 아이템 이름 — 0x189AB)
           *   0x18BAB  test ax,ax / je 0x18D2E ;   ESC 면 **못 먹고 메시지도 없다**
           *   0x18BB4~ 이름 + 조각으로 문자열 조립 (`0x18BCE` 는 **새로 주운** 코드다)
           *   0x18C05  call 0x482A5          ; ★ 획득 대사창
           *   ```
           *   ☠ 우리는 고른 뒤 바로 다음 단계로 넘어가 **메시지가 없었다.**
           *   ★ 자리는 원본이 `0x18B01`(칸 0 = 새 것을 창고로) · `0x18B19`(칸 1 = 배낭에)
           *     로 갈리므로 그대로 싣는다. */
          if (typeof root !== 'undefined' && root.__playItemGain) {
            var 얻이름 = null;
            try {
              var It2 = root.G2Item;
              var 행2 = It2 && It2.at ? It2.at(칸.code | 0) : null;
              얻이름 = 행2 && (행2['이름'] || 행2.name);
            } catch (e얻) {}
            /* ★ 창고로 보내도 경험치는 먹는다 — 원본 0x18CC5 는 칸 고르기(0x18AF7) 뒤 공통 꼬리다 (2026-10-05)
             *   ☠ 이 갈래만 경험치를 안 더해, 배낭이 찬 뒤 주운 아이템은 획득 창만 뜨고 경험치가 안 올랐다
             *   (사장님 「여러번 반복하고 받지 못하고 창고로 넣었을때도 경험치 먹어야해. 지금 일부만 먹어지고 일부는 안올라」) */
            var 아경B = 아이템경험넣기(칸.unit || self.session.actor, 집은것 ? (집은것.exp | 0) : 0);
            return root.__playItemGain({
              unit: 칸.unit || self.session.actor, name: 얻이름, code: 칸.code | 0,
              place: (고른 === 1) ? 'bag' : null,          /* 0x18B19 배낭 / 0x18B01 창고 */
              '경험치': 집은것 ? (집은것.exp | 0) : 0,
              ELD: 집은것 ? (집은것.eld | 0) : 0,
              levels: 아경B ? (아경B.levels | 0) : 0,
              levelAfter: 아경B ? 아경B.levelAfter : null,
              growth: 아경B ? 아경B.growth : null,
              mastery: 아경B ? 아경B.mastery : null
            }).then(function () { 완료(다음단계()); },
                    function () { 완료(다음단계()); });
          }
          완료(다음단계());
        });
      });
    }
    if (a.item) {
      /* ★ 획득 대사창은 **이미 있는 창구**를 쓴다 — `window.__playItemGain`
       *   (`battle_main.js` 의 `playItemGain`, 원본 `0x5196F`).
       *   그 함수가 이름 + "획득!" 을 띄우고, 경험치·ELD 가 붙어 있으면
       *   `killGainLines` 로 **적을 처치했을 때와 같은 루틴**을 이어서 돌린다 —
       *   사용자가 말한 「적을 처치했을때처럼 대화창으로 표시」가 이 뜻이다. */
      var 이름 = null;
      try {
        /* ★★★★★ **이름표는 `G2Item.table`(ITEM.DAT)이다** (2026-08-30)
         *   ☠ 전에는 `T['아이템']` 을 봤는데, 그것은 **맵 위 상자 목록**이다
         *     (`sce.js:436` — `{x, y, 코드, 경험치, ELD, 조건, 획득플래그}` · **이름 칸이 없다**).
         *     그걸 아이템 코드로 색인했으니 이름이 맞을 리가 없다 (지적 A-4).
         *
         *   ☠☠★★★★★ **우리 표는 «1-기준» 이다 — 코드에서 1을 빼면 안 된다** (2026-09-22)
         *
         *     > 사장님: 「전투에서 아이템 획득시 실제 아이템과 대사창에 나오는 아이템의
         *     >  이름이 잘못된 문제도 있어. **소검을 획득했는데, 대사창에는 그라디우스**로 나와.」
         *
         *     `item.js decodeItemDat()` 은 `out = [null]` 로 시작해 `코드: i+1` 로 채운다 —
         *     곧 **`table[코드]` 가 바로 그 아이템**이다. 그런데 여기서 `코드 − 1` 로 찾아
         *     **한 칸 앞 것**이 나왔다: 소검(코드 5) → 그라디우스(코드 4).
         *     (표 실측 — `그라디우스 = 4` · `소검 = 5` 로 **바로 옆칸**이다.)
         *   ☠ 옛 주석이 근거로 든 `0x18BD5 dec edx` 는 **원본의 0-기준 배열**
         *     (`×66 + 0xEDD88`)을 위한 것이다. 우리 표는 이미 1-기준이라 **두 번 빼는 셈**이었다.
         *     `same-word-two-meanings` — 같은 「색인」이 두 뜻으로 쓰인 자리다. */
        var It0 = root.G2Item;
        var 행 = It0 && It0.at ? It0.at(a.item.code | 0) : null;
        이름 = 행 && (행['이름'] || 행.name);
      } catch (e이름) {}
      var 놓인곳 = null;
      var g0 = self.session.actor.gear || {};
      if ((g0.sub | 0) === (a.item.code | 0)) 놓인곳 = 'bag';
      else if ((g0.sub2 | 0) === (a.item.code | 0)) 놓인곳 = 'bag';
      /* ★ 경험치를 실제로 더한다 — 원본 0x18CC5~0x18CF6 (대사 0x18CC0 «뒤») · 레벨업이면 그 줄도 대사에 (2026-10-05 「아이템 획득 경험치도 반영이 안돼」) */
      var 아경 = 아이템경험넣기(self.session.actor, a.item.exp | 0);
      if (typeof root !== 'undefined' && root.__playItemGain) {
        return root.__playItemGain({ unit: self.session.actor, name: 이름,
                                     code: a.item.code | 0,   /* ★ ≥0x96 이면 경험치 지점 (0x18C0A) */
                                     place: 놓인곳, '경험치': a.item.exp | 0,
                                     ELD: a.item.eld | 0,
                                     levels: 아경 ? (아경.levels | 0) : 0,
                                     levelAfter: 아경 ? 아경.levelAfter : null,
                                     growth: 아경 ? 아경.growth : null,
                                     mastery: 아경 ? 아경.mastery : null })
          .then(function () { return 다음단계(); });
      }
    }
    /* ★★★★★ **이동을 마친 자리의 지형 피해** — 원본 `0x169BC` (2026-09-03)
     *
     *   > 사용자: 「가시밭 **이동시 즉각적으로 체력 다는거는 현재 적용 안돼**」
     *   > 「용암도 서서히 다는건 **다음턴이 되었을 때** 이야기고 **내가 이동할때에는
     *   >  즉각적으로** 달았던 것 같아」
     *
     *   ☠ 라운드 시작 피해(`turn.js:588` · `0x19AEF`→`0x19C63`)만 있었고
     *     **이동 직후 경로가 없었다.** 원본은 둘 다 `0x17310` 을 부른다 —
     *     호출부 7곳 «전부» 지형이다 — ☠ (2026-10-12 정정) 예전엔 「`0x19C6B`(턴)·`0x169BC`(이동) 둘」이라 적고 AI 다섯(0x43865·0x43BE3·0x40844·0x414A8·0x41680)을 빠뜨렸다 → `_지형피해`
     *     (`node 04_도구/EXE_호출부찾기.js COMBATII.EXE 0x17310`).
     *
     *   `주소맵/movement.md` —
     *     `0x16925` **move_confirm_face_commit** : 「이동 **방향확정 이후의** 커밋 처리 …
     *       `0x187b1·0x18b2e`(아이템) → `0x5401b`(이동 후 이벤트) → **`0x17310`(지형)**」
     *     `0x169bc` **terrain_damage_gate** : 「`0x17310` 을 호출하는 분기.
     *       반환 `ax==0`(사망)이면 `-2` 경로로」
     *   ★ **걸음마다가 아니라 「이동을 확정한 뒤 한 번」**이다 — 창1 과 같다
     *     (사용자: 「이동중 지나는건 제외, **도착점 기준**」).
     *
     *   ★ 계산은 손대지 않는다 — `rules.지형효과()` 가 이미 원본 그대로다.
     *     가시밭(값 10) → `idx 1` → **최대 HP ÷ 10**.
     *   ★ 보고는 라운드 시작과 **같은 창구**(`HP변경알림`)를 쓴다. 그래야 피격
     *     연출·사망 처리·S4 가 한 곳으로 모인다. */
    var 지형끝 = false;
    function 지형피해() {
      if (지형끝) return Promise.resolve(); 지형끝 = true;
      return self._지형피해(self.session.actor, '0x169BC');
    }

    /* ☠★★★★★ **이동이 끝나면 S2(구역 진입)를 본다** — `0x169A6 call 0x5401B` (2026-09-22)
     *
     *   > 사장님: 「시나리오 이벤트로 **특정 영역에 도달하면 다음스테이지로 넘어가는거
     *   >  작동하지 않아.**」
     *
     *   `SCE_섹션2_좌표트리거_원본확정.md` §0 — 호출 시점은 **「플레이어·AI 유닛의
     *   이동/돌진이 끝난 직후 1회」** 다. 원본은 행동 함수 여덟이 각자 끝에서
     *   `0x5401B` 를 부르는데 그중 **`0x169A6` 이 곧 이동**이다.
     *
     *   ☠ 우리는 `S2S6알림` 을 **행동(공격·마법 등) 마무리**에서만 불렀다
     *     (`controller.js` 의 `0x5401B` 자리). **이동만 하고 끝나는 길에는 없었다.**
     *     그래서 구역에 걸어 들어가도 아무 일도 안 났다 —
     *     실측: `1-2.SCE` 는 구역 `(24,30)~(27,33)` 에 캐릭터 1이 들어오면
     *     대사 셋 뒤 `op 0x12 → 1-4.sce` 로 넘어간다(S2 1건). 그것이 안 돌았다.
     *   ★ 지형 피해 **뒤**에 둔다 — 원본도 이동 함수 끝자락이다.
     *   ★ 창구가 없으면(구 배선) 조용히 건너뛴다. */
    function S2알림() {
      if (typeof self.svc.S2S6알림 !== 'function') return null;
      var u = (self.session && self.session.actor) || null;
      if (!u || u.alive === false) return null;
      var 외 = self.svc.S2S6알림({ 유닛: u, 원본경계: '0x169A6' });
      return (외 && 외.대기) || null;
    }
    function 다음단계() {
      var 뒤 = function () {
        if (a.next === 'MOVE') return self.moveLoop();              // ★ 반복 루프
        if (a.next === 'RING') return self.resumeRing('인접 적 + TP≥40');
        if (a.code === Move2().CODE.ACTOR_GONE) self.session.markAborted();
        return self.moveExit();
      };
      return Promise.resolve(지형피해())
        .then(function () {
          /* ★ 이동을 확정했으면 범위 표시를 걷고 S2 를 본다 — 이벤트(0x5401B)가 이동 하이라이트 위에서 돌았다
           *   (2026-11-09 사장님 「초필살기 발동했는데, 이동 하이라이트가 표시된 상태에서 발동해.」 · 24-1A 아수라파천무 = 구역 진입 S2)
           *   · 이동을 이어 가면 moveLoop 가 범위를 새로 만든다 · 그만두면 moveExit 이 어차피 비운다 */
          self.rangeContext = null;
          try { self.svc.onState(self.mode, self); } catch (e범) {}
          return S2알림();
        })
        .then(뒤);
    }
    function _다음단계_옛() {
      if (a.next === 'MOVE') return self.moveLoop();                  // ★ 반복 루프
      if (a.next === 'RING') return self.resumeRing('인접 적 + TP≥40');
      if (a.code === Move2().CODE.ACTOR_GONE) self.session.markAborted();
      return self.moveExit();
    }
    return 다음단계();
  });
};

/** 이동 서브머신 탈출 — 0x4DA7B */
Controller.prototype.moveExit = function () {
  var e = this.movement.exit();
  this.rangeContext = null;
  if (e.next === 'END') return this.endSession('이동 종료: ' + e.reason);
  return this.resumeRing('이동 취소');
};

/**
 * AI 설정 바(0x4B4CA) 켜기/끄기 — AI 계열 메뉴에 있는 동안만 섭니다.
 * @param {string} menu 지금 링 메뉴 이름
 */
Controller.prototype._AI막대동기화 = function (menu) {
  var h = this.svc.hud;
  if (!h) return;
  /* ★ AI 바는 AI 링 두 겹에서만 — 원본 0x4B744(링 펼치기 0x4B8EB 의 ebx): 1 = 마법 목록 0x4B18F · 2 = AI 바 0x4B4CA · 0 = 없음
   *   AI 링 0x4D121·0x4D26E ebx=2 · 마법 선택 0x4C72A → 0x4C795 ebx=1(AI 에서 들어와도 같은 함수) · 필살기 선택 0x4CAA3 → 0x4CAEE ebx=0
   *   ☠ 예전엔 ai_magic·ai_special 에서도 띄워 마법 목록 위에 「No Target.」·「[Normal Sequence]」 가 겹쳤다 (2026-10-01 화면 확인) */
  var on = (menu === 'ai_ctrl' || menu === 'ai_group');
  if (on) { if (h.showAiBar) h.showAiBar(this.session && this.session.actor); }
  else    { if (h.hideAiBar) h.hideAiBar(); }
};

/* ══════════════════════════════════════════ 7-A. AI 좌표 설정 (0x4CE1F) */

/**
 * 링을 걷고 맵 커서를 켭니다. 원본은 `0x103A8`(대기 모션 정지) → `0x49E4E`(미리보기) →
 * 입력 루프 `0x4CEA3` 이고, 코드 2(좌클릭)이면 `0x4D016` 에서 칸을 확정합니다.
 */
/* ★★★★★ **AI 목표 지정 — 원본 `0x4CE1F` 그대로** (2026-09-26 무인 · 사장님 「각각 기능은 추정하지말고 원본 로직에 따라 …
 *   특히 좌표 설정 같은거나 각각 아이콘의 작동 방식을 잘 구분해야해」)
 *
 *   ```asm
 *   0x4CE3C  call 0x49E4E(유닛, 5)            ; 커서를 이 유닛 칸에
 *   0x4CE64  [+0x71] = 0xFF · [+0x73] = 0     ; ★ 들어오자마자 목표를 지운다
 *   0x4CE73  [+0x6F] = [+0x71] (= 0xFF)       ;   ([+0x70] 은 안 건드린다)
 *   ── 입력 ──
 *   0x4CF2E  1(왼쪽 클릭) → 가장자리(x<40·x>280·y<20·y>180)면 그쪽으로 스크롤 · 누른 칸으로 커서
 *            0x4CFB7 그 칸의 유닛 → 있으면 선택 상자(0x49FE1) · 없으면 칸 커서(0x49E4E)
 *   0x4CF17  2(오른쪽 클릭) → 0x4D016 ★ **확정**: 커서 칸에 유닛이 있으면 [+0x73] = 그 유닛
 *                                             없으면 [+0x6F] = x · [+0x70] = y → 1 을 돌려준다
 *   0x4CFF5  0x1B(ESC)·3 → 0 을 돌려준다 (목표는 지워진 채)
 *   ```
 *   어느 쪽이든 부른 쪽(0x4D2DC)은 0x4D0D0 으로 가 AI 링을 다시 짓는다.
 *   ★ `[+0x6C]`(목표 모드)는 **안 건드린다** — 모드 5 는 활 유닛의 아이콘 5(0x4D2F4)에서만 선다.
 *   ☠ 여태 ① 왼쪽 클릭으로 곧 확정 ② 우클릭이 취소 ③ `ai.mode = 5` 를 지어 넣음 ④ `u.ai.target` 에 써서
 *     **AI 가 한 번도 읽지 않았다**(ai.js AI목표읽기 는 AI목표x/y·AI목표유닛 을 본다). */
Controller.prototype.openAiCoord = function () {
  if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
  var u = this.session && this.session.actor;
  if (u) {
    var 지금 = (root.G2AI && root.G2AI['AI목표읽기']) ? root.G2AI['AI목표읽기'](u) : { y: 0xFF };
    u.AI목표유닛 = null;                            // 0x4CE68 [+0x73] = 0
    u.AI목표x = 0xFF;                               // 0x4CE64 · 0x4CE73 [+0x71]=[+0x6F]=0xFF
    u.AI목표y = (지금.y == null ? 0xFF : 지금.y) & 0xFF;   // [+0x70] 은 그대로
    this.aiCoordCursor = { x: u.x | 0, y: u.y | 0 };        // 0x4CE3C 커서는 유닛 칸에서 시작
    this.cursorTile = { x: -1, y: -1 };            // 입력부가 «같은 칸» 이라 움직임을 안 보내지 않도록 — 본인 칸 위에서도 커서가 따라온다
  }
  /* ★ 목표 고르는 동안엔 AI 바가 없다 — 0x4CE1F 루프는 맵(0x45559)·커서만 그리고 0x4B744(AI 바)를 안 부른다 (2026-10-01 화면 확인) */
  this._AI막대동기화(null);
  this._상태전이(MODE.AI_COORD_SELECT, 'AI 좌표');
  return { ok: true, mode: this.mode };
};

/** 마우스 움직임(코드 1) — 커서만 옮긴다 (0x4CF2E~0x4CFED). 확정은 왼쪽 누름(코드 2 → `confirmAiCoord`)
 *
 *   ☠ 2026-10-01 까지 «왼쪽 = 커서만 · 오른쪽 = 확정»으로 잘못 넣었다 — 큐 코드를 INT33 버튼 비트로 읽은 탓.
 *     큐에 넣는 쪽(0x5D640~)이 정한다: 움직임 = 1 · 왼쪽 누름 = 버튼+1 = 2 · 오른쪽 누름 = 3 · 두 번 누름 = 4/5 · 뗌 = 8/9.
 *     사장님 「캐릭터나 좌표 선택후 복귀가 안된다」 — 왼쪽으로 찍으면 상자만 생기고 멈춰 있었다. */
Controller.prototype.pickAiCoord = function (x, y) {
  if (!this.session || !this.session.actor) return { ok: false, reason: '세션 없음' };
  this.aiCoordCursor = { x: x | 0, y: y | 0 };
  if (this.svc.onState) this.svc.onState(this.mode);
  return { ok: true, cursor: this.aiCoordCursor };
};

/** 오른쪽 클릭 — 커서 칸으로 확정 (0x4D016~0x4D02A) · 그 뒤 AI 링으로 (0x4D0D0) */
Controller.prototype.confirmAiCoord = function () {
  var u = this.session && this.session.actor, c = this.aiCoordCursor;
  if (u && c) {
    var 거기 = this.battle.at ? this.battle.at(c.x, c.y) : null;
    if (거기 && 거기.alive) { u.AI목표유닛 = 거기; }              // 0x4D01A [+0x73] = 유닛 ([+0x6F] 는 0xFF 그대로)
    else { u.AI목표유닛 = null; u.AI목표x = c.x & 0xFF; u.AI목표y = c.y & 0xFF; }   // 0x4D023 · 0x4D02A
  }
  this.aiCoordCursor = null;
  return this.backToAiRing();
};

/** AI 본 링으로 되돌아갑니다 (0x4D0D0 회차 머리). */
Controller.prototype.backToAiRing = function () {
  var s = this.session;
  if (!s || s.ended) return this.endSession('AI 좌표 후 세션 없음');
  var G = root.G2Ring;
  var icons = G ? G.buildAi(this.battle, s.actor) : [];
  s.ring.menu = 'ai_ctrl'; s.ring.icons = icons;
  s.state = 'RING_IDLE';
  this.ringContext = { menu: 'ai_ctrl', icons: icons, unit: s.actor };
  this._상태전이(MODE.RING_OPENING);
  if (this.svc.ringView && this.svc.ringView.open)
    this.svc.ringView.open(s.actor, icons, this.ringContext);
  this._상태전이(MODE.AI_MENU);
  this._AI막대동기화('ai_ctrl');                 /* AI 링으로 돌아오면 바를 다시 (0x4D121 ebx=2) */
  this._상태전이(MODE.RING_IDLE, 'ai_ctrl');
  return { ok: true, menu: 'ai_ctrl', icons: icons };
};

/* ══════════════════════════════════════════ 8. 스테이터스 (0x493A3) */

/**
 * 스테이터스 창의 **장비 칸 클릭** — `0x48E90` 의 집기/놓기.
 *
 * ```asm
 * 0x48F4A  집은 칸 = (x − 148) / 29        0x48F6E  빈 칸은 못 집는다
 * 0x49033  놓은 칸도 같은 식
 * 0x4907F  call 0x1832D 로 착용 판정 · 0x490A9 맞바꿀 상대도 같은 판정
 * ```
 * 규칙은 `item.js swapEquip` 이 그대로 옮겨 두었고, 여기서는 **손놀림만** 맡는다.
 *
 * ★ **끌어놓기**다 — 누를 때 집고(`누르기 = true`), 뗄 때 놓는다.
 *   사용자 지적 2026-08-14: 「아이템 이동은 **드래그 앤 드롭**으로 적용돼.」
 *
 * @param {boolean} [누르기] `true` 면 mousedown(집기), 없으면 mouseup(놓기)
 * @returns {?object} 장비 칸을 다뤘으면 결과, 아니면 `null`(그러면 창이 닫힌다)
 */
Controller.prototype.equipClick = function (lx, ly, 누르기) {
  var hud = this.svc.hud, It = root.G2Item, u = this.statusUnit;
  if (!hud || !hud.itemHit || !It || !It.swapEquip || !u) return null;
  /* 아군만 장비를 만진다 — 원본도 `0x48BC1`(아군 전용 화면)에서만 이 루프를 돈다
   *   ★ 2026-09-03 — **진영 1 만**이다. `isAlly()` 는 1·2 를 아군으로 보지만
   *     원본 `0x55AA2` 는 진영 1 만 조작 경로로 보낸다. 우군(2)의 장비는 못 만진다. */
  if ((u.side | 0) !== 1) return null;                    /* 0x55AA2 */

  var cell = hud.itemHit(lx, ly);
  if (cell < 0) {
    /* 칸 밖 — 들고 있었으면 **제자리에 돌려놓는다**(0x4934D 취소 경로) */
    if (hud.dragItem && hud.dragItem()) { hud.dragItem(null); return { ok: true, 취소: true }; }
    return null;                                   // 아무것도 안 들었으면 창을 닫게 둔다
  }

  var 든것 = hud.dragItem && hud.dragItem();
  if (!든것) {
    /* ── 집기 (0x48F6E) ── */
    var key = It.keyOfScreen(cell), code = key ? (u.gear[key] | 0) : 0;
    if (!code) return { ok: false, reason: '빈 칸입니다' };   // 창은 그대로 둔다 (문구 없음 — 0x48F6E 도 조용하다)
    hud.dragItem({ cell: cell, code: code });
    hud.dragAt(lx, ly);
    if (hud.itemName) hud.itemName(null);          // 새로 집으면 옛 이름표는 치운다
    this.svc.onEvent({ type: 'equipPick', unit: u, cell: cell, code: code });
    return { ok: true, 집음: cell, code: code };
  }
  if (누르기) return { ok: true, 끄는중: true };   // 이미 들었으면 누름은 무시

  /* ── 놓기 (0x49033) ── */
  hud.dragItem(null);
  if (cell === 든것.cell) {
    /* ★ 같은 칸에 도로 놓았다 = **그냥 클릭** → 이름표를 띄운다 (0x49100)
     *   사용자 지적 2026-08-14: 「아이템 클릭 시 이름이 떠.」 */
    if (hud.itemName) hud.itemName({ cell: cell, code: 든것.code });
    return { ok: true, 이름: 든것.code };
  }
  if (hud.itemName) hud.itemName(null);            // 자리를 옮기면 이름표는 치운다
  var r = It.swapEquip(u, 든것.cell, cell);
  if (!r.ok) {
    /* ★ 0x48083 — 스테이터스 화면 **위에** 문구를 띄운다.
     *   사용자 지적 2026-08-14: 「착용 불가 메시지도 구현 안 됐어.」
     *   `msg()` 만으로는 상태창에 가려 안 보인다. */
    this.msg(r.reason || '넣을 수 없습니다');
    if (hud.equipWarn) hud.equipWarn(r.reason || '넣을 수 없습니다');
    this.svc.onEvent({ type: 'equipReject', unit: u, from: 든것.cell, to: cell, reason: r.reason });
    return { ok: false, reason: r.reason };
  }
  this.svc.onEvent({ type: 'equipSwap', unit: u, from: 든것.cell, to: cell, moved: r.moved });
  return { ok: true, 바꿈: r.moved };
};

/** 지정 유닛의 상태창을 열고 입력 상태를 상태 보기로 전환한다. */
Controller.prototype.openStatus = function (u) {
  if (!u) return { ok: false, reason: '유닛 없음' };
  if (this.mode !== MODE.STATUS_VIEW) this._statusPrev = this.mode;
  this.statusUnit = u;
  /* ★ 0x493A3 은 맨 먼저 `0x44DEC(0)` 로 상·하단 표시를 끄고, 링이 떠 있으면 링 그림도
   *   화면에서 내려갑니다 — 상태창만 남아야 합니다 (§29-9).
   *   링 **문맥**은 그대로 두고 그림만 걷습니다. */
  if (this.svc.ringView && this.svc.ringView.hide) this.svc.ringView.hide();
  if (this.svc.hud && this.svc.hud.showStatus) this.svc.hud.showStatus(u);
  this._상태전이(MODE.STATUS_VIEW, u.name);
  return { ok: true, unit: u };
};

/** 닫으면 **링 문맥을 그대로** 이어 받습니다 (§29-9) */
Controller.prototype.closeStatus = function () {
  if (this.mode !== MODE.STATUS_VIEW) return { ok: false };
  this.statusUnit = null;
  if (this.svc.hud && this.svc.hud.hideStatus) this.svc.hud.hideStatus();
  if (this._statusReturn === 'ring' && this.session && !this.session.ended) {
    this._statusReturn = null;
    /* 0x4D53B 는 0 을 반환합니다 → A-5 의 링 재개 경로를 그대로 탑니다 */
    var d = this.session.dispatch(0);
    if (d.next === 'RING') { this.openRing(); return { ok: true, back: 'RING_IDLE' }; }
    this.endSession(d.reason || 'status');
    return { ok: true, back: 'ACTOR_END' };
  }
  this._상태전이(this._statusPrev || MODE.FRAME_IDLE, '스테이터스 닫기');
  return { ok: true, back: this.mode };
};

/* ══════════════════════════════════════════ 9. 세션 종료 · 턴 넘김 */

Controller.prototype.endSession = function (reason) {
  var self = this;
  /* ★★★★★ **SCE 세대를 올린다** (2026-08-22 · GPT 38차 ⑤)
   *   > 「`SCE세대올리기()` 는 만들어졌지만 **실제 호출이 없다** …
   *   >  전투 A 의 연출 대기 중 퇴장 → 전투 B 재진입 →
   *   >  늦게 끝난 A 가 상태 확정·재개·결과 전달」
   *   세션이 끝나면 진행 중이던 SCE 소비는 **전부 무효**다. */
  this.SCE세대올리기('세션 종료: ' + (reason || '?'));
  /* 세션이 없으면 시간을 흘릴 이유가 없습니다 — 그냥 대기 화면으로 (0x4DB58 은 세션 종료용) */
  if (!this.session) return Promise.resolve(this._대기상태(null));
  this._상태전이(MODE.RING_CLOSING);
  if (this.svc.ringView && this.svc.ringView.close) this.svc.ringView.close();
  if (this.svc.hud && this.svc.hud.hideAiBar) this.svc.hud.hideAiBar();
  var r = this.session.end(reason);
  this.svc.onEvent({ type: 'sessionEnd', reason: reason, turnConsumed: r.turnConsumed, rest: r.rest });
  this.ringContext = null; this.rangeContext = null;
  this.movement.reset(); this.selector.reset();
  this._상태전이(MODE.ACTOR_END, reason);

  var actor = this.session.actor;
  this.session = null;
  /* 링/행동 세션이 끝난 즉시 선택을 해제해 날짜·시간 구체로 되돌린다. */
  if (this.svc.hud && this.svc.hud.selectUnit) this.svc.hud.selectUnit(null);

  if (this.pendingOutcome || this.전투끝남) { this._상태전이(MODE.BATTLE_OUTCOME); return Promise.resolve(this.pendingOutcome || '끝남'); }

  /* 조회 전용 세션은 차례와 무관합니다 — 원래 상태로 되돌아갑니다 (0x4DAD6) */
  if (r.viewOnly) { this._상태전이(MODE.FRAME_IDLE, '조회 전용'); return Promise.resolve(r); }

  /* ★ TP 를 한 톨도 안 썼으면 턴이 소비되지 않습니다 (0x4DB44) — 대기열에 그대로 남습니다 */
  if (!r.turnConsumed) {
    this._상태전이(MODE.FRAME_IDLE, '턴 미소비');
    return Promise.resolve(r);
  }

  /* 0x4DB0D (0x197AD) — 차례를 썼으니 대기열에서 뺍니다 */
  Turn().consumeTurn(this.battle, actor);

  /* ★ 0x4DB58 — 페이즈가 1(Player Phase) 인데 대기열이 비었으면 페이즈 = 0.
   *   즉 **조작할 아군을 다 쓰면 시간이 저절로 다시 흐릅니다.**
   *   아직 남아 있으면 그대로 `FRAME_IDLE` — 다음 유닛을 자동으로 잡지 않습니다. */
  var q = this.readyUnits();
  if (q.length) {
    this._상태전이(MODE.FRAME_IDLE, '남은 아군 ' + q.length);
    if (this.actor === actor) this._대기초점(q);
    return Promise.resolve(r);
  }
  this._cycle = 0;
  /* ★★★ **Player Phase 일 때만 시간을 다시 흘린다** — `0x4DB58 call 0x19FA3 / 0x4DB5D cmp ax,1 / jne 0x4DB71` (2026-10-08)
   *   사장님 「아직도 ai페이즈에서 아군 ai설정 바꾸고 ai링커맨드 빠져나오면 ai페이즈가 종료되고 게임이 진행되는 문제가 있어」
   *   ☠ 페이즈를 안 보고 resume 해 Waiting(2)·AI Phase(3)까지 풀었다 — 그 둘은 스페이스로만 풀린다(0x55B19). */
  if (this.battle && this.battle.phase !== 'player' && this.battle.phase !== 'run') {
    this._상태전이(MODE.FRAME_IDLE, '페이즈 ' + this.battle.phase + ' 유지 (0x4DB5D)');
    return Promise.resolve(r);
  }
  Turn().resume(this.battle);                      // 0x4DB6C  [0xF042E] = 0
  return this.settle();
};

/**
 * ★★★★★ **Player Phase 인데 대기열이 빈 채로 멈춰 있으면 푼다 — 매 프레임**
 *
 *   > 사장님 (2026-09-15): 「저거 버그야. **우리편 턴 없으면 자동으로 턴 돌아야하는데
 *   >  안돌아.** 해결해줘.」 · 「**ai 적용할때에도 같은 문제가생겨.** 어차피 수정해야하는
 *   >  문제야.」
 *
 *   ☠ 무엇이 어긋났나 — 안전장치(`releaseIfQueueEmpty` = `0x4DB58`)는 **있는데
 *     부르는 사람이 없었다.** `endSession` 과 `_대기상태` 두 «길목»에서만 부른다.
 *     그런데 사망은 **유예**된다(`사망유예` → S4 연출 → `사망마무리`) —
 *     길목을 지날 때는 아직 살아서 대기열에 있고, 연출이 끝난 **뒤**에 죽어
 *     대기열이 빈다. 그때는 이미 `FRAME_IDLE` 로 파킹한 뒤라 아무도 다시 안 본다.
 *
 *   실측 (2026-09-15 · 몽크 셋이 「희생」으로 죽은 판) —
 *   ```
 *     mode FRAME_IDLE · session 없음 · actor 주다스(죽은 몽크)
 *     readyUnits 0 · phase player · banner true      ← 영영 멈춰 있다
 *     releaseIfQueueEmpty(battle) -> true            ← 손으로 부르니 바로 풀린다
 *   ```
 *
 *   ★ 원본은 메인 루프 `0x5580F` 가 턴 관리자 `0x19D53` 을 **프레임마다** 부른다.
 *     곧 「길목」이 아니라 **늘 다시 본다.** 그 성질을 여기서 되살린다.
 *   ★ `releaseIfQueueEmpty` 는 **페이즈 1(Player Phase)에서만** 참이다
 *     (`turn.js` 1178). 2(Waiting)·3(AI Phase)은 손대지 않는다 —
 *     그 둘의 자동 해제가 원본에 없다는 것은 2026-08-27 에 이미 못박았다.
 *
 * @returns {false|Promise}  풀 것이 없으면 `false`
 */
Controller.prototype.멈춤풀기 = function () {
  if (this._푸는중) return false;                                  /* 재진입 금지 */
  if (this.session && !this.session.ended) return false;           /* 링·행동 중 */
  if (this.pendingOutcome || this.전투끝남) return false;
  if (this.battle && this.battle['배치중']) return false;          /* 배치 화면 */
  if (!Turn().releaseIfQueueEmpty(this.battle)) return false;      /* 0x4DB58 */
  var self = this;
  this._푸는중 = true;
  this._cycle = 0;
  this.msg && this.msg('Player Phase 인데 대기열이 비었다 — 시간을 다시 흘린다 (0x4DB58)');
  return Promise.resolve()
    .then(function () { return self.settle(); })
    .then(function (r) { self._푸는중 = false; return r; },
          function (e) { self._푸는중 = false; throw e; });
};

/** 방금 행동한 유닛을 놓았을 때 초점을 남은 아군으로 옮깁니다 (화면용). */
Controller.prototype._대기초점 = function (q) {
  var u = q[0];
  this.actor = u;
  /* 다음 행동 가능 유닛으로 카메라 초점만 옮긴다. HUD는 미선택 시계 상태다. */
  if (this.svc.hud && this.svc.hud.selectUnit) this.svc.hud.selectUnit(null);
  return u;
};

/**
 * N 키 — 원본에는 없는 편의 종료. 세션이 있으면 세션 종료로 접습니다.
 * 세션이 없으면 초점 유닛의 차례를 버리고, 대기열이 비면 시간을 다시 흘립니다.
 */
Controller.prototype.endActor = function (reason) {
  if (this.session && !this.session.ended) return this.endSession(reason || '강제 종료');
  var q = this.readyUnits();
  if (!this.actor && !q.length) return this.settle();
  var u = this.actor && q.indexOf(this.actor) >= 0 ? this.actor : q[0];
  if (u) {
    Turn().endUnit(this.battle, u, {});
    Turn().consumeTurn(this.battle, u);            // 0x197AD
  }
  q = this.readyUnits();
  if (q.length) { this._대기초점(q); this._상태전이(MODE.FRAME_IDLE, '남은 아군 ' + q.length);
                  return Promise.resolve({ ok: true, left: q.length }); }
  this._cycle = 0;
  Turn().resume(this.battle);
  return this.settle();
};

/* ══════════════════════════════════════════ 10. AI — 같은 실행기 (§27-9) */

/**
 * AI 한 기의 차례. UI 만 생략하고 **`G2Executor` 를 그대로 씁니다**.
 * @returns {Promise<{plan, results:[]}>}
 */
/**
 * ★★★★★ **이벤트(대사·연출)가 끝날 때까지 기다린다** — `0x19DF8` → `0x19E88` 순서
 *   (2026-08-26 · 사용자 지적)
 *
 *   사용자: 「**이벤트 대사 진행중에 ai 행동이 멈춰야하는데 계속 공격이 지속돼.**」
 *
 *   원본은 라운드마다 S0 이벤트(`0x19DF8`)를 **먼저** 돌리고 그 뒤에 AI 순회
 *   (`0x19E88`)가 온다 — **한 흐름**이라 겹칠 수가 없다. 우리는 SCE 를 비동기
 *   사슬로 돌리므로 여기서 명시적으로 순서를 맞춘다.
 *
 *   ★ 상한을 둔다 — 이벤트가 걸려도 전투가 영영 멈추면 안 된다.
 *     (상한에 닿으면 경고만 남기고 진행한다)
 *
 * @returns {Promise}
 */
Controller.prototype._이벤트끝날때까지 = function (상한ms, 옵션) {
  /* 옵션.연출잠금 === false — 지금 도는 연출 «안»에서 부를 때(무신 연출 중 사망 S4)는 연출 잠금을 안 본다.
   *   ☠ 그 잠금은 자기 연출이라 영영 안 풀려 상한 20초를 다 채웠다 (2026-09-29 사장님 「죽인 이후에 멈춰」) */
  var self = this;
  var 상한 = (상한ms == null) ? 20000 : (상한ms | 0);
  var 간격 = 60;
  function 도는중() {
    try {
      /* ★ 1-c — 정본 창구로 옮겼다 (2026-08-26). 옛 이름도 대비로 남긴다 */
      if (root.G2이벤트활성중) return !!root.G2이벤트활성중(옵션 && 옵션.연출잠금 === false ? { 연출잠금: false } : undefined);
      if (root.G2이벤트진행중) return !!root.G2이벤트진행중();
    } catch (e) { /* 창구가 없으면 아래로 */ }
    /* ★ 2-6 — 마지막 `G2Events.busy` 갈래를 지웠다 (GPT 검수 ①).
     *   2-3 에서 `EVT` 정의를 지워 `G2Events` 는 영영 undefined 다. */
    if (self._SCE소비중) return true;
    if ((self._SCE세션 | 0) > 0) return true;
    return false;
  }
  if (!도는중()) return Promise.resolve(false);
  var 시작 = (typeof Date !== 'undefined') ? Date.now() : 0;
  return new Promise(function (ok, no) {
    (function 돌기() {
      if (!도는중()) return ok(true);
      var 지난 = ((typeof Date !== 'undefined') ? Date.now() : 상한 + 1) - 시작;
      if (지난 >= 상한) {
        if (root.console && console.warn)
          console.warn('[AI] 이벤트 대기 상한 ' + 상한 + 'ms 초과 — 그대로 진행한다 · 안 끝난 연출 ' +
            JSON.stringify((self.svc.anim && self.svc.anim.도는연출) ? self.svc.anim.도는연출() : null));
        return ok(false);
      }
      var 시간원 = self.svc.delay || self.svc.wait;
      if (typeof 시간원 !== 'function')
        return no(new Error('_이벤트끝날때까지: delay 또는 wait 시간원이 필요하다'));
      var 대기 = 시간원(간격);
      Promise.resolve(대기).then(돌기, no);
    })();
  });
};

/**
 * ★ **AI 한 스텝** — 원본 `0x4016A`(+ 그 앞뒤의 이동·목표 선정) 한 바퀴에 해당한다.
 *   `beginUnit`·`endUnit` 은 **루프를 도는 `runAi`** 가 맡는다 (`0x402E0`~`0x40876`).
 *   @param {object} unit
 *   @param {object} [opt] `{ 첫바퀴:boolean }`
 */
Controller.prototype._AI한칸 = function (unit, opt) {
  opt = opt || {};
  var self = this, out = { unit: unit, plan: null, results: [] };
  /* ★ `0x44943` — **행동을 시작하는 이 순간** 대기를 푼다.
   *   원본은 순회 안에서 AI 를 부르므로 이 자리가 곧 순회 자리다. 우리는 연출
   *   때문에 순회(`advance`)와 실행이 떨어져 있어, 순회 때 전원 것을 풀면
   *   행동 가능 마커(ETC.ICO)가 **한꺼번에** 사라진다. 원작은 차례가 온 전원에게
   *   같이 뜨고 **행동하는 순서대로 하나씩** 사라진다. (turn.js beginUnit 주석) */
  if (opt.첫바퀴 !== false && !opt._카메라됨) Turn().beginUnit(this.battle, unit);
  /* ★ AI 유닛 카메라는 «스크롤»이다 — 원본 0x407C6(걷기 전)·0x401FD(행동 전) call 0x1124A ·
   *   0x1126D cmp [0xFDAEA],0 → 0 이면 0x11003 8px/프레임 스크롤 · 출하 GAME.CFG 첫 바이트 = 00 (01_원본게임 GAME.CFG 직독)
   *   ☠ 즉시 옮기기(view.center)였다 — 처치·경험치 연출이 8px 로 천천히 가다가 다음 AI 차례에서 휙 건너뛰었다
   *   (2026-10-02 사장님 「카메라 이동이 이상해지는(천천히 이동하다가 갑자기 순간이동하는) 문제」 · 2026-10-13 실측) */
  if (!opt._카메라됨 && this.svc.focus) {
    var selfC = this, optC = Object.assign({}, opt, { _카메라됨: true });
    return Promise.resolve(this.svc.focus(unit.x | 0, unit.y | 0)).then(function () { return selfC._AI한칸(unit, optC); });
  }
  if (!this.svc.focus && this.svc.view && this.svc.view.center) this.svc.view.center(unit.x, unit.y);
  this._상태전이(MODE.AI_SESSION_ENTER, unit.name);
  /* [리마스터] 용자의 무덤 8층 안내인 — 아무것도 안 한다(이동·공격·마법 없음) · u._가만히 (battle_main 무덤 머리)
   *   2026-10-12 사장님 「8층에서 안내인 아무것도 하면 안돼. 마법 쓰지 못하고 가만히만 있어야해」 */
  if (unit._가만히) { out.plan = { unit: unit, control: 'ai', kind: 'wait', action: -1, reason: '[리마스터] 가만히' }; return Promise.resolve(out); }
  /* [리마스터] 무덤 30층 안내인 — 공격·마법 없이 창1 원거리형 물러서기만 (ai.js 무덤물러서기)
   *   2026-10-12 사장님 「30층에서 안내인은 워프로 이동하는게 아니라 왼쪽 통로로 걸어갔던걸로 기억하는데」 */
  if (unit._물러서기만) {
    /* 창1 원거리형 · 공격 성향 0 (CHRSYS 0x2C93A) — 물러서기 → (마법 없음) → 다가가기 → 공격 없음 · 행동 뒤 TP > 10 이면 처음부터(0x2D2C6) */
    var selfM = this, Am = AI(), 바퀴m = 0;
    out.plan = { unit: unit, control: 'ai', kind: 'wait', action: -1, reason: '[리마스터] 창1 원거리형 성향 0' };
    var 한바퀴m = function () {
      if (++바퀴m > 4 || !unit.alive || selfM.pendingOutcome || selfM.전투끝남 || (unit.tp | 0) <= 10) return Promise.resolve(out);   /* 바퀴 4 = 안전장치(원본엔 없다) */
      var 앞 = (unit.x | 0) + ',' + (unit.y | 0) + ',' + (unit.tp | 0);
      var 물 = Am.창1물러서기 ? Am.창1물러서기(selfM.battle, unit) : null;
      var p = Promise.resolve();
      if (물) p = p.then(function () {
        selfM._상태전이(MODE.AI_DECIDE, 'flee');
        return selfM._AI계획실행(unit, { unit: unit, control: 'ai', kind: 'none', move: 물.move, target: null, reason: '[리마스터] 창1 물러서기 (0x2C64D)' }, out);
      });
      return p.then(function () {
        if (!unit.alive || selfM.pendingOutcome || selfM.전투끝남 || (unit.tp | 0) < 10) return null;   /* 0x2CAA9 */
        var 다 = Am.창1다가가기 ? Am.창1다가가기(selfM.battle, unit) : null;
        if (!다) return null;
        selfM._상태전이(MODE.AI_DECIDE, 'move');
        return selfM._AI계획실행(unit, { unit: unit, control: 'ai', kind: 'none', move: 다.move, target: null, reason: '[리마스터] 창1 다가가기 (0x2CD61)' }, out);
      }).then(function () {
        var 뒤 = (unit.x | 0) + ',' + (unit.y | 0) + ',' + (unit.tp | 0);
        if (뒤 === 앞) return out;                                              /* 아무것도 못 했으면 끝 */
        return 한바퀴m();
      });
    };
    return 한바퀴m().then(function () { out.끝 = 'end'; return out; });
  }
  /* ★ 원본 순서(행동 → 행동 뒤 이동)는 일반 루프(0x40295)만 — 무기 2 마법형(0x43526·0x438AE)은 옛 한 장 계획 */
  var A = AI();
  var wt0 = A.wtOf ? A.wtOf(this.battle, unit) : -1;
  /* 0x449CC~0x449FE — 활(5)·0xB·0xC·0xF~0x13 은 원거리 루프 0x40DFD */
  /* 0x4496F — 직업 0xA1·0x5B·0x5C·0x5D 는 보스 루프 0x43CF0 (이동 없음) */
  if (A.보스인가 && !opt.옛길 && A.보스인가(unit)) return this._AI한칸_보스(unit, opt, out);
  if (A.신인가 && !opt.옛길 && A.신인가(unit)) return this._AI한칸_신(unit, opt, out);     /* 0x4498F → 0x4426D */
  if (A.원거리루프인가 && !opt.옛길 && A.원거리루프인가(wt0)) return this._AI한칸_원거리(unit, opt, out);
  if (A.행동단계 && !opt.옛길 && wt0 !== 2) return this._AI한칸_원본순서(unit, opt, out);
  /* 0x449A0~0x449CA — 무기 2 는 0x43CA9 갈래로 0x43526(마법형)·0x438AE(원거리 마법형)·아무것도 안 함 */
  /* [리마스터] 정본 479 소환사AI — 0x43CA9 → 2(소환사 등)인데 소환을 쓰면 무기 2 마법 고리(갈래 2 = 아무것도 안 함) 대신 일반 고리로 · 걸음마다 G2AI.act 가 소환 또는 다가가 공격을 고른다 */
  if (A.무기2이동단계 && !opt.옛길 && wt0 === 2 && !(A.소환사AI길 && A.소환사AI길(this.battle, unit))) return this._AI한칸_마법(unit, opt, out);
  var self2 = this;
  var 머리 = (opt.첫바퀴 !== false) ? this._AI턴머리(unit, out) : Promise.resolve();
  return 머리.then(function () {
    if (out.끝 === 'flee' || !unit.alive || self2.pendingOutcome || self2.전투끝남) return out;
    var plan = A.act(self2.battle, unit, { rng: self2.svc.rng, 도주건너뜀: true, 앞종류: opt.첫바퀴 !== false ? null : opt.앞종류 });
    out.plan = plan;
    self2._상태전이(MODE.AI_DECIDE, plan.kind);
    return self2._AI계획실행(unit, plan, out);
  });
};

/**
 * ★★★★★ **`0x40295` 한 바퀴 — 원본 순서** (2026-09-29 · 사장님 「원본 순서로 바꿈」)
 *   첫 바퀴: 0x43C5D 자동 방어 → 0x41515 도주(하면 이 턴은 그걸로 끝 · 루프 없음)
 *   매 바퀴: ① 0x4016A 지금 자리 행동 → 실행 ② 결과 −2 면 끝 · −1 이고 앞 바퀴 edi −2 면 끝
 *            ③ 행동이 끝난 «뒤» 이동할 곳을 정해(0x40323~) 이동 · 이동 뒤 기본비용 = 0x167C9
 *   out: { 끝: −2|'end'|undefined, edi, 기본비용, 걸음: 실제로 걸었나 }
 */
Controller.prototype._AI한칸_원본순서 = function (unit, opt, out) {
  var self = this, A = AI(), rng = this.svc.rng;
  out.원본순서 = true;
  var chain = (opt.첫바퀴 !== false) ? this._AI턴머리(unit, out) : Promise.resolve();
  return chain.then(function () {
    if (out.끝 === 'flee' || !unit.alive || self.pendingOutcome || self.전투끝남) return out;
    var 행 = A.행동단계(self.battle, unit, { rng: rng });                     /* 0x402FE 0x4016A */
    out.plan = 행; out.결과 = 행.결과;
    self._상태전이(MODE.AI_DECIDE, 행.kind);
    return self._AI계획실행(unit, 행, out).then(function () {
      if (행.결과 === -2) { out.끝 = -2; return out; }                          /* 0x4030C → 0x40882 */
      if (행.결과 === -1 && opt.앞edi === -2) { out.끝 = 'end'; return out; }   /* 0x4031D → 0x40876 */
      if (!unit.alive || self.pendingOutcome || self.전투끝남) return out;
      var 이 = A.이동단계(self.battle, unit, { rng: rng }, { 기본비용: opt.기본비용 });
      out.edi = 이.edi; out.기본비용 = 이.기본비용; out.이동 = 이;
      if (이.edi === 'end') { out.끝 = 'end'; return out; }
      if (이.edi === 2) {
        /* 0x4077A — 워프: 0x3BF00(Warp! 연출) → 0x3C993(40) TP 40 · [+0x57]·[+0x7F]·[+0x81] = 0 → 방향 < 4 면 [+0x63] = 방향 */
        var 워프계획 = { unit: unit, control: 'ai', kind: 'skill', skill: 8, target: 이.target || null,
                         targetTiles: [{ x: 이.move.x, y: 이.move.y }], reason: 이.reason };
        var 앞tpw = unit.tp | 0;
        return self._AI계획실행(unit, 워프계획, out).then(function () {
          if ((unit.tp | 0) < 앞tpw) { unit.chargeTp = 0; unit.reserveSpell = 0; unit.reserveSpecial = 0; }
          if (!이.move.keepDir && unit.alive) unit.dir = 이.move.dir & 3;              /* 0x407B7 */
          out.워프 = true;
          return out;
        });
      }
      if (이.edi !== 1) return out;
      var 이동계획 = { unit: unit, control: 'ai', kind: 'none', move: 이.move, target: 이.target || null,
                       reason: 이.reason };
      return self._AI계획실행(unit, 이동계획, out).then(function () {
        out.걸음 = true;
        out.기본비용 = A.이동뒤기본비용(self.battle, unit);                     /* 0x4082C 0x167C9 */
        return out;
      });
    });
  });
};

/**
 * ★★★★★ **`0x40DFD` 원거리 한 바퀴** (2026-09-29) — ① 이동(또는 워프) → 걸었으면 0x5401B(S2+S6) → ② 0x40BFA 원거리 행동
 *   out: { 원거리: true, 끝: −2|'end'|'exit'|'flee', edi, 기본비용, 결과 }
 */
Controller.prototype._AI한칸_원거리 = function (unit, opt, out) {
  var self = this, A = AI(), rng = this.svc.rng;
  out.원거리 = true;
  var chain = (opt.첫바퀴 !== false) ? this._AI턴머리(unit, out) : Promise.resolve();
  var 이 = null;
  return chain.then(function () {
    if (out.끝 === 'flee' || !unit.alive || self.pendingOutcome || self.전투끝남) return null;
    이 = A.원거리이동단계(self.battle, unit, { rng: rng }, { 기본비용: opt.기본비용 });
    out.edi = 이.edi; out.기본비용 = 이.기본비용; out.이동 = 이;
    if (이.끝) { out.끝 = 이.끝; return null; }
    if (이.edi === 2) {
      /* 0x41406 0x3BF00 워프 → 0x3C993(40) → 방향 < 4 면 [+0x63] */
      var 워 = { unit: unit, control: 'ai', kind: 'skill', skill: 8, targetTiles: [{ x: 이.move.x, y: 이.move.y }], reason: 이.reason };
      var 앞tp = unit.tp | 0;
      return self._AI계획실행(unit, 워, out).then(function () {
        if ((unit.tp | 0) < 앞tp) { unit.chargeTp = 0; unit.reserveSpell = 0; unit.reserveSpecial = 0; }
        if (!이.move.keepDir && unit.alive) unit.dir = 이.move.dir & 3;
      });
    }
    if (이.edi !== 1) return null;
    var 걷기 = { unit: unit, control: 'ai', kind: 'none', move: 이.move, reason: 이.reason };
    return self._AI계획실행(unit, 걷기, out).then(function () {
      out.걸음 = true;
      out.기본비용 = A.이동뒤기본비용(self.battle, unit);                        /* 0x41490 0x167C9 */
      if (typeof self.svc.S2S6알림 !== 'function') return null;               /* 0x4149C 0x5401B */
      var 외S = self.svc.S2S6알림({ 유닛: unit, 원본경계: '0x4149C' });
      return (외S && 외S.대기) || null;
    }).then(function () { return self._지형피해(unit, '0x414A8'); });   /* 0x17310 지형 피해 (2026-10-12) */
  }).then(function () {
    if (out.끝 || !unit.alive || self.pendingOutcome || self.전투끝남) return out;             /* 0x414A4 · 0x414B0 */
    var 행 = A.원거리행동단계(self.battle, unit, 이 && 이.대상, { rng: rng });  /* 0x414C4 0x40BFA */
    out.plan = out.plan || 행; out.결과 = 행.결과;
    self._상태전이(MODE.AI_DECIDE, 행.kind);
    return self._AI계획실행(unit, 행, out).then(function () { return out; });
  });
};

/**
 * ★★★★★ **무기 2 한 턴 — `0x43526` 마법형 · `0x438AE` 원거리 마법형** (2026-10-08 · 원본 줄 단위)
 *   사장님 「몽크, 클레릭, 드루이드, 비숍을 비롯한 모든 마법사 계열 다시 점검해」
 *   ☠ 전에는 일반 고리(0x40295)의 틀(문턱 10·+4 · TP ≤ 34 면 멈춤)로 «한 장 계획»을 되풀이했다 —
 *     마법형은 제자리(−2)에서 시전을 다시 굴리지 않아 한 번 실패하면 서 버렸고, 시전 뒤 남은 TP 로 다시 시전하지 않았다.
 *   원본 고리 (턴 머리 0x43C5D·0x41515 는 0x4494E·0x44955 에서 이미 지남)
 *     공통 머리  MP < 10 → 끝(자세 없음 · 0x43530·0x438B8) · 문턱 = 0x14 · 기본비용 = 10
 *     마법형     L: 0x432A0 을 1(시전)이 나오는 동안 되풀이(0x43559) · 2(차징) → 끝(0x4389A 자세)
 *                → 이동 한 번(무기2이동단계) → 1 이면 걷고 기본비용 = 0x167C9 · 0x5401B
 *                → −2 면 TP < 문턱 → 끝(자세) · 문턱 += 2 → −3 이면 끝(자세) · 아니면 L
 *     원거리     머리: 차징 중([+0x7F])이면 0x432A0 한 번 · 2 → 끝(자세 없음 · 0x438E4)
 *                M: 이동 한 번 → (마법형과 같은 걷기·−2 처리) → −3 이면 끝(자세)
 *                   → 0x432A0 을 9번까지(0 이 아니면 멈춤 · TP 0 이면 멈춤 · 0x43C20~0x43C3B) → TP 0 → 끝(자세) · 아니면 M
 *   'exit'(0x438A6)는 턴 마무리 자세 없이 끝 · 0x43CA9 = 2(0x29~0x2B …)는 아무것도 안 함(0x449B8 → 0x44A0C · 자세 없음)
 */
Controller.prototype._AI한칸_마법 = function (unit, opt, out) {
  var self = this, A = AI(), rng = this.svc.rng;
  var 갈래 = A.무기2갈래(unit), 원거리 = (갈래 === 1);
  out.마법루프 = true;
  var 문턱 = 0x14, 기본 = 10, 고리수 = 0;
  function 살았나() { return unit.alive && !self.pendingOutcome && !self.전투끝남; }
  function 끝(자세없음) { if (자세없음) out.자세없음 = true; return out; }
  function 새계획() { return { unit: unit, control: 'ai', kind: 'none', action: 2, target: null, move: null, spell: -1, reason: '' }; }
  function 실행(plan) {
    if (!out.plan) out.plan = plan;
    self._상태전이(MODE.AI_DECIDE, plan.kind);
    return self._AI계획실행(unit, plan, out);
  }
  function 시전(시) { return 실행(A.마법계획(self.battle, unit, 새계획(), 시)); }
  function 시도() { return A.마법시도(self.battle, unit, { rng: rng }); }

  /* 이동 한 번 + 그 뒤처리 — 돌려주는 값: 'stance'(0x4389A) · 'exit'(0x438A6) · 'again' */
  function 이동한번() {
    if (++고리수 > 200) return Promise.resolve('stance');                        /* ★ 안전장치 — 원본엔 없다 */
    var 이 = A.무기2이동단계(self.battle, unit, { rng: rng }, { 기본비용: 기본, 원거리: 원거리 });
    out.이동 = 이;
    if (이.edi === 'exit') return Promise.resolve('exit');
    var 걸음 = Promise.resolve(null);
    if (이.edi === 1 && 이.move) {
      var 걷기 = { unit: unit, control: 'ai', kind: 'none', move: 이.move, target: 이.target || null, reason: 이.reason };
      걸음 = 실행(걷기).then(function () {
        out.걸음 = true;
        기본 = A.이동뒤기본비용(self.battle, unit);                                /* 0x43848·0x43BC2 0x167C9 */
        if (typeof self.svc.S2S6알림 !== 'function') return null;               /* 0x43859·0x43BD3 0x5401B */
        var 외S = self.svc.S2S6알림({ 유닛: unit, 원본경계: 원거리 ? '0x43BD3' : '0x43859' });
        return (외S && 외S.대기) || null;
      }).then(function () { return self._지형피해(unit, 원거리 ? '0x43BE3' : '0x43865'); })   /* 0x17310 지형 피해 (2026-10-12) */
        .then(function () { return self._이벤트끝날때까지(); });
    }
    return 걸음.then(function () {
      if (!살았나()) return 'exit';                                                /* 0x43861·0x4386D 0x17310 */
      if (이.edi === -2) {                                                          /* 0x43872~0x4388A · 0x43BF4~0x43C10 */
        if ((unit.tp | 0) < 문턱) return 'stance';
        문턱 += 2;
      }
      if (이.edi === -3) return 'stance';                                          /* 0x43891 · 0x43C17 */
      return 'again';
    });
  }

  function 마법형고리() {
    function 시전반복() {
      if (!살았나()) return Promise.resolve('exit');
      var 시 = 시도();                                                              /* 0x43550 0x432A0 */
      if (시.결과 === 1) return 시전(시).then(시전반복);                             /* 0x43559 je 0x4354E */
      if (시.결과 === 2) return 시전(시).then(function () { return 'stance'; });    /* 0x4355F → 0x4389A */
      return Promise.resolve(null);
    }
    return 시전반복().then(function (r) {
      if (r) return r;
      return 이동한번().then(function (m) { return m === 'again' ? 마법형고리() : m; });
    });
  }

  function 원거리고리() {
    return 이동한번().then(function (m) {
      if (m !== 'again') return m;
      /* 0x43C1C~0x43C3B — 0x432A0 을 9번까지 */
      var 시 = A.원거리마법9번(self.battle, unit, { rng: rng });
      var 다음 = 시 ? 시전(시) : Promise.resolve(null);
      return 다음.then(function () {
        if (!살았나()) return 'exit';
        if (!(unit.tp | 0)) return 'stance';                                        /* 0x43C45 → −3 → 0x4389A */
        return 원거리고리();                                                         /* 0x43C52 jne 0x438E6 */
      });
    });
  }

  var 머리 = (opt.첫바퀴 !== false) ? this._AI턴머리(unit, out) : Promise.resolve();
  return 머리.then(function () {
    if (out.끝 === 'flee') return 끝(true);                                         /* 0x4495D → 0x44A0C */
    if (!살았나()) return out;
    if (갈래 === 2) { out.plan = { unit: unit, control: 'ai', kind: 'wait', reason: '0x43CA9 → 2 (아무것도 안 함)' }; return 끝(true); }
    if ((unit.mp | 0) < 10) { out.plan = { unit: unit, control: 'ai', kind: 'wait', reason: 'MP < 10 (0x43530·0x438B8)' }; return 끝(true); }
    var 몸;
    if (!원거리) 몸 = 마법형고리();
    else {
      var 앞 = Promise.resolve(null);
      if ((unit.reserveSpell | 0)) {                                                 /* 0x438C9~0x438E4 차징 중이면 한 번 */
        var 시0 = 시도();
        if (시0.결과 === 1 || 시0.결과 === 2) 앞 = 시전(시0).then(function () { return 시0.결과 === 2 ? 'exit' : null; });
      }
      몸 = 앞.then(function (r) { return r || 원거리고리(); });
    }
    return 몸.then(function (r) {
      if (!out.plan) out.plan = { unit: unit, control: 'ai', kind: 'wait', reason: (out.이동 && out.이동.reason) || '할 일 없음' };
      return 끝(r === 'exit');
    });
  });
};

/**
 * ★★★★★ **0x43CF0 보스 한 턴** (2026-09-29) — 턴 머리(자동방어·도주) → 보스 판단 → 대사 → 대상 목록 공격 / 보스 마법 → 끝
 */
Controller.prototype._AI한칸_보스 = function (unit, opt, out) {
  var self = this, A = AI(), rng = this.svc.rng;
  out.보스 = true;
  var chain = (opt.첫바퀴 !== false) ? this._AI턴머리(unit, out) : Promise.resolve();
  return chain.then(function () {
    if (out.끝 === 'flee' || !unit.alive || self.pendingOutcome || self.전투끝남) return out;
    var 결 = A.보스단계(self.battle, unit, { rng: rng });
    out.보스판단 = 결;
    self._상태전이(MODE.AI_DECIDE, '보스:' + 결.종류);
    if (결.종류 === '끝') return out;
    /* ★ 전용 연출 (2026-09-29) — 원본 차례: 판정 0x1DDF0 → 카메라·외침 → 전용 연출 → 공격 연출 0x1E61D.
     *   판정은 실행기가 굴리므로 외침·전용 연출은 공격 연출 머리(DRIVER.attack 의 intent.앞연출)에서 튼다 — 난수 차례가 원본과 같다 */
    var 앞 = Promise.resolve(), 앞연출 = null;
    if (결.모션 != null && !Array.isArray(결.모션)) { unit.motion = 결.모션 | 0; }          /* 0x440E8 [+0x64]=6 — 외침보다 먼저 */
    if (결.종류 === '공격') {
      if (결.연출 === '0x46E19')                                                            /* 캐논 0x43E3D · 0x43E4E 카메라 중점 */
        앞 = 앞.then(function () { return self._연출실행('보스연출', { unit: unit, 주소: '0x46E19', 칸: 결.칸 }); });
      else if (결.연출 || 결.외침)
        앞연출 = { unit: unit, 주소: 결.연출, 외침: 결.외침, 대상들: 결.대상들 };       /* 판정(0x44010·0x440DC 0x1DDF0) «뒤» — 공격 연출 머리에서 튼다 */
      var 첫 = 결.대상들[0];
      var 계 = { unit: unit, control: 'ai', kind: 'attack', target: { unit: 첫 }, 대상들: 결.대상들,
                 force: true, tpCost: 0, reason: 결.까닭, 조준칸: 결.칸 || null, 앞연출: 앞연출 };
      return 앞.then(function () { return self._AI계획실행(unit, 계, out); })
               .then(function () { if (결.모션 != null) unit.motion = 0; return out; });   /* 0x44106 [+0x64]=0 */
    }
    /* 마법 — 0x28422(1) AI 대상 고르기 · 함수표 칸 직접 호출 · MP/TP 없음 · 외치는 이름은 고정(0x28883 [0x742xx]) */
    if (Array.isArray(결.모션))                                                              /* 0x44159~0x44187 모션 5 → 16틱 → 6 → 16틱 → 7 */
      앞 = 앞.then(function () { return self._연출실행('보스연출', { unit: unit, 주소: '모션567' }); });
    var 마 = A.보스마법(self.battle, unit, 결.칸, 결.등급);
    if (마) {
      var 계2 = A.마법계획(self.battle, unit, { unit: unit, control: 'ai', kind: 'wait' }, { 결과: 1, spell: 마.spell, 대상: 마.대상 });
      계2.free = true; 계2.reason = 결.까닭; 계2.외침이름 = 결.이름;
      return 앞.then(function () { return self._AI계획실행(unit, 계2, out); })
               .then(function () { if (Array.isArray(결.모션)) unit.motion = 0; return out; });   /* 0x44238 [+0x64]=0 */
    }
    if (!결.실패) return 앞.then(function () { return out; });
    /* 0x441C9 — 못 쏘면 「Sea Mist」(0x48612) → 0x22AF9(x, y, 2) 연출 → 편 1 전원에게 clamp(30 + 레벨차, 10, 70)% 로 빙결 */
    return 앞.then(function () { return self._연출실행('보스연출', { unit: unit, 주소: '0x22AF9', 외침: 결.실패.외침 }); })
      .then(function () {
        A.보스안개(self.battle, unit, { rng: rng });
        unit.motion = 0;                                                                     /* 0x44238 */
        if (self.svc.view && self.svc.view.apply) self.svc.view.apply();
        return out;
      });
  });
};

/**
 * ★ God(직업 0xA4) 한 턴 — 0x4426D (2026-09-29)
 *   소환(0x4434D) 이면 소환수를 세우고 소환 연출(0x21944) · 아니면 전체 공격:
 *   0x44530 카메라→신 · 12틱 · 모션 5·6 → 그림별 연출(0x44245) → 편 1·2 전원 0x1D770 → 숫자 고리 0x287AF → 사망/S4.
 *   연출·숫자·사망은 마법 길(DRIVER.cast)을 빌린다 — combat.cast 의 opts.신광역 이 대상·피해를 바꾼다.
 *   끝나면 0x4490E → 0x40885 (루프 없음)
 */
Controller.prototype._AI한칸_신 = function (unit, opt, out) {
  var self = this, A = AI(), rng = this.svc.rng;
  out.보스 = true;
  var chain = (opt.첫바퀴 !== false) ? this._AI턴머리(unit, out) : Promise.resolve();
  return chain.then(function () {
    if (out.끝 === 'flee' || !unit.alive || self.pendingOutcome || self.전투끝남) return out;
    var 결 = A.신단계(self.battle, unit, { rng: rng });
    out.보스판단 = 결;
    self._상태전이(MODE.AI_DECIDE, '신:' + 결.종류);
    if (결.종류 === '소환') {
      var m = Cb().신소환(self.battle, unit, 결.x, 결.y);
      return Promise.resolve(self._연출실행('신소환', { unit: unit, summon: m }))
        .then(function () { if (self.svc.view && self.svc.view.apply) self.svc.view.apply(); return out; });
    }
    var 형 = 결.형;
    var 계 = { unit: unit, control: 'ai', kind: 'magic', spell: (형 && 형.spell != null) ? 형.spell : 145,
               free: true, reason: 결.까닭, target: null,
               신광역: { 치명: 결.치명 | 0, 흔들기: !!(형 && 형.흔들기), 연출없음: !형, 주소: 형 && 형.주소, 카메라: 형 && 형.카메라 } };
    /* 그리기 루틴 인자 — 고정 칸 (0x11, 0x13) · 갈래 9 는 (0x11, 0x12) · 회복5·선라이트·블리자드는 신 자신 */
    var 중 = (형 && 형.중심) ? { x: 형.중심[0], y: 형.중심[1] } : { x: unit.x | 0, y: unit.y | 0 };
    계.magicAt = 중; 계.신광역.중심 = 중;
    return self._AI계획실행(unit, 계, out).then(function () { return out; });
  });
};

/**
 * ★ AI 턴 머리 — 0x44941 → 0x43C5D 자동 방어 → 0x41515 도주 (첫 바퀴에 한 번 · 모든 무기 공통)
 *   도주하면 out.끝 = 'flee' (0x4495D jne 0x44A0C — 루프 없음)
 */
Controller.prototype._AI턴머리 = function (unit, out) {
  var self = this, A = AI(), rng = this.svc.rng;
  var chain = Promise.resolve();
  {
    var 방어 = A.자동방어(this.battle, unit);
    if (방어) chain = chain.then(function () {
      var 앞tp = unit.tp | 0;
      return self._AI계획실행(unit, 방어, out).then(function () {
        /* 0x43C94 성공이면 0x3C993(40) — 실행기가 TP 40 을 이미 뺐으면 그대로 · [+0x57]·[+0x7F]·[+0x81] 은 0 */
        if ((unit.tp | 0) < 앞tp) { unit.chargeTp = 0; unit.reserveSpell = 0; unit.reserveSpecial = 0; }
      });
    });
    /* ★ 0x44955 0x41515 — 도주 (2026-09-29 줄 단위): 'rest' → 휴식 · 'run' → 물러서기를 TP 가 되는 동안 되풀이 · 못 물러서면 휴식
     *   하면 이 턴은 그걸로 끝(0x4495D jne 0x44A0C — 루프도 0x3F415 턴 마무리 자세도 없다) */
    chain = chain.then(function () {
      if (!unit.alive || self.pendingOutcome || self.전투끝남) return null;
      var 판 = A.도주판단 ? A.도주판단(self.battle, unit) : null;
      if (!판) return null;
      out.끝 = 'flee'; out.자세없음 = true;
      var si = 10;                                                             /* 0x4156E */
      function 마무리() { unit.chargeTp = 0; unit.reserveSpecial = 0; unit.reserveSpell = 0; }   /* 0x416D6~0x416E9 */
      function 휴식() {                                                        /* 0x41691 */
        if ((unit.tp | 0) <= 0x28) return Promise.resolve(마무리());          /* 0x416A0 */
        var 쉼 = { unit: unit, control: 'ai', kind: 'rest', reason: '휴식 (0x4D3BA)' };
        out.plan = out.plan || 쉼;
        self._상태전이(MODE.AI_DECIDE, 'rest');
        return self._AI계획실행(unit, 쉼, out).then(마무리);
      }
      if (판 === 'rest') return 휴식();                                        /* 0x41586 jle 0x4168C */
      function 한걸음() {
        var 걸 = A.도주걸음(self.battle, unit, si);
        if (!걸) return 휴식();                                                /* 0x415E2 jl 0x4168C */
        var 물 = { unit: unit, control: 'ai', kind: 'flee', move: 걸.move, reason: '물러서기 (0x3EF12)' };
        out.plan = out.plan || 물;
        self._상태전이(MODE.AI_DECIDE, 'flee');
        return self._AI계획실행(unit, 물, out).then(function () {
          si = A.danger(self.battle, unit);                                    /* 0x41662 0x167C9 */
          var 외S = (typeof self.svc.S2S6알림 === 'function')
            ? self.svc.S2S6알림({ 유닛: unit, 원본경계: '0x41670' }) : null;  /* 0x41670 0x5401B */
          return Promise.resolve(외S && 외S.대기).then(function () { return self._지형피해(unit, '0x41680'); }).then(function () {   /* 0x17310 지형 피해 (2026-10-12) */
            if (!unit.alive || self.pendingOutcome || self.전투끝남) return null;               /* 0x41678 · 0x41685 → 0x416EC */
            if ((unit.tp | 0) > si + 0x18) return 한걸음();                    /* 0x416C0~0x416D0 */
            마무리();
            return null;
          });
        });
      }
      return 한걸음();
    });
  }
  return chain;
};

/**
 * ★★★★★ 이동을 마친 칸의 지형 피해 — 원본 `0x17310` (2026-10-12 한 곳으로 모음)
 *   호출부 7곳 전부가 지형 피해다: 0x169BC(플레이어 이동) · 0x19C6B(라운드 시작 — turn.js) ·
 *   AI 걸음 뒤 0x43865·0x43BE3(이동한번) · 0x40844(한바퀴·원본순서뒤) · 0x414A8(원거리 걷기) · 0x41680(도주 걸음).
 *   ☠ AI 다섯 곳을 «살아 있나»로만 옮겨 적이 가시·용암에서 피해를 안 받았다
 *     (사장님 「내가 이야기를 왜하냐면 적이 가시칸에 이동했는데 체력이 안닳아」).
 *   ★ 멈춘 칸 한 번만(중간 경로는 안 본다 — 사장님 「원래 중간 이동경로는 창1에서도 무시돼」 · 「데미지는 한번만 입고」).
 *   ★ 배리어면 안 받는다 — 0x17316 test [eax+0x15],0x80 (상태이상_원본확정.md:280).
 * @returns Promise — 원본은 살아 있으면 1 · 부르는 쪽이 unit.alive 로 본다 */
Controller.prototype._지형피해 = function (u, 원본경계) {
  var self = this;
  if (!u || !u.alive || !self.svc.HP변경알림) return Promise.resolve();
  if (((u.f15 | 0) & 0x80)) return Promise.resolve();            // 0x17316
  var R2 = (root.Rules || {}), 칸 = self.battle.tile ? self.battle.tile(u.x, u.y) : null;
  if (!칸 || !R2.지형효과) return Promise.resolve();
  var 효 = R2.지형효과(u, 칸['값'] | 0, self.battle.T, { 가시배: self.battle.무덤가시배 });   /* [리마스터] 무덤 진한 가시 2배 */
  if (!효 || !효.대상) return Promise.resolve();                 // 0x17477 로 빠지는 경우
  var 전 = u.hp | 0;
  u.hp = 전 - (효.값 | 0);
  var 보 = null;
  try {
    보 = self.svc.HP변경알림({ 변경유닛: u, 주체유닛: null,       // 0x173E9 xor edx,edx
                              이전HP: 전, 이후HP: u.hp | 0,
                              까닭: '지형', 원본경계: 원본경계 || '0x17310' });
  } catch (e지형) {}
  /* ★ 0x173EB S4 → 0x1745B 사망 처리(0x1DB1D) — 원본은 지형 피해로 죽으면 그 자리에서 죽는다.
   *   ☠ 예전 플레이어 갈래는 HP 만 깎고 사망 처리가 없었다(HP 0 인 채 살아 있음). 라운드 사망과 같은 직렬 정리를 쓴다. */
  return Promise.resolve(보 && 보.대기 ? 보.대기 : null).then(function () {
    /* 0x1744C call 0x46359 — 피해 숫자·피격음 (S4 뒤 · 사망 앞) */
    return (효.값 | 0) > 0 ? self._연출실행('terrainHit', { unit: u, damage: 효.값 | 0 }) : null;
  }).then(function () {
    if (!u.alive || (u.hp | 0) > 0) return null;
    return 남은사망직렬정리(self, {}, [u]);
  });
};

/** 계획 한 장을 실행한다 — 이동(있으면) → 행동(있으면). 옛 `_AI한칸` 의 몸통. */
Controller.prototype._AI계획실행 = function (unit, plan, out) {
  var self = this;
  var chain = Promise.resolve();

  /* ── AI_MOVE — 플레이어와 같은 이동 계약 ─────────────────────────── */
  if (plan.move) {
    chain = chain.then(function () {
      self._상태전이(MODE.AI_MOVE);
      if (plan.move.turnOnly) {
        unit.dir = plan.move.dir & 3;
        /* 원본은 걸음 0 인 이동도 기본비용을 뺀다(0x40820 0x3C993) — 옛 act() 는 tp 0 */
        if (plan.move.tp) unit.tp = Math.max(0, (unit.tp | 0) - (plan.move.tp | 0));
        return null;
      }
      if (!plan.move.path) return null;
      var intent = { actor: unit, command: 'move', path: plan.move.path,
                     facing: plan.move.dir, tpCost: plan.move.tp };
      var res = Xc().commit(self.battle, intent, { rng: self.svc.rng });
      out.results.push(res);
      self.svc.onEvent(res);
      return self._연출실행('move', { unit: unit, path: plan.move.path, facing: plan.move.dir })
        .then(function () {
          if (self.svc.view && self.svc.view.center) self.svc.view.center(unit.x, unit.y);
        });
    });
  }

  /* ── AI_ACTION ───────────────────────────────────────────────────── */
  chain = chain.then(function () {
    self._상태전이(MODE.AI_ACTION, plan.kind);
    if (plan.faceTo && plan.target && unit.alive) unit.dir = plan.target.dir & 3;   /* 원거리는 대상 쪽을 보고 쏜다 */
    /* ★★★ **원거리 통상은 공격자와 대상의 «가운데»를 비춘다** — 원본 `0x40C82 call 0x46DF1` (2026-10-03 · 사장님 지적)
     *   > 「원거리 공격시 카메라 확인해줘. 지금은 타겟이 화면을 벗어나는 경우가 있어」
     *   ```asm
     *   0x40C73  ecx = 대상[+1] · ebx = 대상[+0] · edx = 유닛[+1] · eax = 유닛[+0]
     *   0x40C82  call 0x46DF1   ; x = x1 + (x2−x1)/2 · y = y1 + (y2−y1)/2 → 0x1124A (스크롤 · 다 갈 때까지)
     *   ```
     *   ☠ 전에는 이 자리를 「대상 쪽을 본다」로만 읽어 카메라를 **공격자 칸**에 두었다 — 멀리 쏘면 대상이 화면 밖에 남았다. */
    if (plan.faceTo && unit.alive && self.svc.focus) {
      var _fx = (unit.x | 0) + (((plan.faceTo.x | 0) - (unit.x | 0)) >> 1);
      var _fy = (unit.y | 0) + (((plan.faceTo.y | 0) - (unit.y | 0)) >> 1);
      return Promise.resolve(self.svc.focus(_fx, _fy)).then(function () { return 행동계속(); });
    }
    /* 0x401FD call 0x1124A — 행동 전 그 유닛으로 «스크롤» (GAME.CFG 00 · 위 _AI한칸 머리 주석) */
    if (unit.alive && self.svc.focus) return Promise.resolve(self.svc.focus(unit.x | 0, unit.y | 0)).then(function () { return 행동계속(); });
    if (self.svc.view && self.svc.view.center) self.svc.view.center(unit.x, unit.y);
    return 행동계속();
  }).then(function (r) { return r; });
  function 행동계속() {
    var tgt = plan.target && plan.target.unit;
    var intent = null;
    if (plan.kind === 'attack' && tgt)
      intent = { actor: unit, command: 'attack', targetUnits: plan.대상들 || self._AI정면대상(unit, tgt),
                 force: !!plan.force, tpCost: plan.tpCost, 조준칸: plan.조준칸 || null, 앞연출: plan.앞연출 || null };             /* 보스(0x43CF0)는 대상 목록 · 사거리 검사 없음 · TP 없음 */
    else if (plan.kind === 'rest')                                    /* 0x41691 0x4D3BA 휴식 */
      intent = { actor: unit, command: 'rest' };
    else if (plan.kind === 'skill')                                   /* 0x43C5D 자동 방어 → 0x3C4C1 */
      intent = { actor: unit, command: 'skill', skill: plan.skill | 0, targetUnits: [],
                 targetTiles: plan.targetTiles || [] };                   /* 워프(8) 목적지 */
    else if (plan.kind === 'special')
      /* ★ grade — AI 는 고르기 «앞»에 등급을 뽑는다(0x3FFFA 0x2CA40) · 실행은 그 등급을 쓴다(0x400F7 edx=si) */
      intent = { actor: unit, command: 'special', slot: plan.slot, grade: plan.grade, targetUnits: tgt ? [tgt] : [],
                 targetTiles: plan.혼칸 ? [plan.혼칸] : [] };   /* 혼(5·10) — AI 착지 칸 0x2E0F0 (실행기 targetTiles[0] → special at · 사장님 11-18 「ai로 사용하는 혼이 이상해」) */
    else if (plan.tpBurn) {
      /* 0x3FFD4 차징 — 원본 버그: 0x400CD 0x3C993 이 [+0x57]·[+0x7F]·[+0x81] 을 0 으로 · TP 를 전부 쓴다 */
      unit.chargeTp = 0; unit.reserveSpell = 0; unit.reserveSpecial = 0;
      unit.tp = 0;
      return null;
    }
    else if (plan.kind === 'magic')
      intent = { actor: unit, command: 'magic', spell: plan.spell, targetUnits: tgt ? [tgt] : [], free: !!plan.free, 신광역: plan.신광역 || null, 외침이름: plan.외침이름 || null,
                 /* ★ AI 대상 함수(0x41715~0x42A1D)가 고른 칸 — 실행기 targetTiles[0] = 착탄점 (2026-09-29) */
                 targetTiles: plan.magicAt ? [plan.magicAt] : [] };
    if (intent && plan.kind === 'special' && plan.ultimate) {   /* [리마스터] AI 지정 초필살기 — 플레이어 commitAction 과 같은 꼴(ultimate · 고른 칸 · 대상) */
      intent.ultimate = true; intent.slot = -1; intent.grade = 1;
      intent.targetTiles = plan.초칸 ? [plan.초칸] : [];
      if (plan.초대상들) intent.targetUnits = plan.초대상들.slice(); else delete intent.targetUnits;
    }
    if (!intent) return null;
    /* ★★★★★ **통상 공격은 플레이어와 같은 창구를 탄다** (2026-08-22 · GPT 27차)
     *
     *   원본은 `0x1F738` **하나**를 둘이 공유한다:
     *     플레이어 링  `0x4D442` → `0x4D45E` → `0x1F738`
     *     일반 AI     `0x4016A` → `0x40210` → `0x1F738`
     *   (`AI대역_분석.md` §`0x4016A` · `SCE_HP변경_창구.md` §3-n)
     *
     *   ⇒ S3(`0x1DE15`)도 **같은 자리**에서 돌아야 한다.
     *     AI 만 S3 를 건너뛰면 이벤트가 절반만 도는 셈이다. */
    var 실행 = (intent.command === 'attack')
      ? self._통상공격S3(intent)
      : Promise.resolve(Xc().commit(self.battle, intent, { rng: self.svc.rng }));
    return 실행.then(function (res) {
      out.results.push(res);
      /* ★ 사망이 확정된 뒤에 알린다 — 플레이어 경로와 같은 까닭 (§11 스캔) */
      if (!res.후처리보류) self.svc.onEvent(res);
      /* 플레이어 _실행뒤와 같은 결과 객체를 넘긴다. 지연 필살기의 commit 뒤
       * DRIVER.special이 사망자/비용을 갱신해야 아래 _사망처리가 연출 뒤 사망을
       * 소비한다(0x4CA55, 사망 표시 0x1ED45). report만 주면 res.deaths는 빈 채 남는다. */
      /* ★ 집중(charge)만 했으면 마법 연출 없이 대기 — 원본 0x433F0 은 시전 함수를 안 부른다
       *   (2026-10-02 사장님 「레오파드를 썼는데, mp는 달지 않았고 집중이펙트도 소모되지 않았어」) */
      var 집중만 = plan.kind === 'magic' && res && res.report && (res.report.kind === 'charge' || res.report.ok === false);   /* 실패(TP·MP 부족)도 시전 연출 없음 */
      return self._연출실행(집중만 ? 'wait' : plan.kind === 'magic' ? 'cast' : plan.kind,
                        { actor: unit, report: res.report, intent: intent, result: res })
        /* ★★★★★ **`0x1ED45` 는 연출 뒤** — 플레이어 경로(`_실행뒤`)와 같다.
         *   원본은 `0x1F738` **하나**를 둘이 공유하므로 순서도 같아야 한다
         *   (`0x4016A` → `0x40210` → `0x1F738`). (2026-08-27 · 사용자 피드백 ③) */
        .then(function () {
          var f = res && res.후처리보류;
          if (typeof f !== 'function') return null;
          res.후처리보류 = null;
          /* ★ 원본 `0x1DB1D` 순서 — ① 대사(`0x1DB50`) → ② 사망 연출(`0x1DBA1`)
           *   → ③ §11(`0x1DDE3`). 플레이어 경로(`_실행뒤`)와 같다. */
          return Promise.resolve(f())                              /* ① */
            .then(function () { return self._사망처리(res, true); })  /* ② 반격 몫은 뒤로 */
            .then(function () {
              if (self.svc && self.svc.onEvent) self.svc.onEvent(res);  /* ③ */
              return null;
            });
        })
        /* ★★★★★ **AI 공격에도 반격 연출이 있어야 한다** (2026-08-27 · 사용자 피드백 ②)
         *   `0x1F9AD call 0x1EF9A` 는 플레이어·AI 공통 자리다. 예전에는 AI 쪽만
         *   빠져 있어서 **킬러에게 맞은 아군이 반격을 해도 화면에 안 나왔다.** */
        .then(function () {
          var rep = res && res.report;
          if (!rep || !rep.counters || !rep.counters.length) return null;
          return self._연출실행('counter', { counters: rep.counters });
        })
        .then(function () { return self._사망처리(res); })
        .then(function () { return (intent.command === 'attack' && typeof self._군단연타 === 'function') ? self._군단연타(res, 'attack', Object.assign({}, intent, { 플레이어공격: true, actor: unit })) : null; })   /* 군단 근접 병종 연속 공격 — AI 도 0x4016A → 0x40210 → 0x1F738 를 타므로 같은 고리 (11-08 사장님 「세번친다고」) */
        /* ★ 선라이트 회복 — 사망 처리 뒤 (플레이어 경로와 같다 · battle_main cast 의 __후회복) */
        .then(function () { var f = res && res.__후회복; if (typeof f !== 'function') return null; res.__후회복 = null; return f(); });
    });
  }

  /* ★★★★★ **S2 + S6 는 여기가 아니다 — `runAi` 로 옮겼다** (2026-08-27 · 사용자 ③)
   *
   *   > 사용자 ②결과피드백: 「**1-5 이벤트도 순서 잘못되었어.** …
   *   >  **AI상태에서 마크가 이동하고** 그 이후 이벤트 대사 뜨고 적군 등장 …
   *   >  우리는 **대사가 나오고 적군이 등장하고 AI상태에서 이동**하고」
   *
   *   ── 무엇이 틀렸나 (화면 관찰로 잡았다) ────────────────────────
   *   `1-5` 에서 §0 의 이벤트 이동(op 0x05)이 끝난 **164ms 뒤** S2 가 터져
   *   암흑살수가 등장했다. AI 이동은 그로부터 **28초 뒤**였다.
   *   원인: 이 자리에서 **행동 종류를 안 보고 무조건** `0x5401B` 를 불렀다.
   *   §0 이동으로 마크는 이미 §2 구역 (55,49)~(60,54) 안에 서 있었고,
   *   AI 가 할 일이 없어 **`wait` 로 끝났는데도** S2 가 돌았다.
   *
   *   ── 원본 (`0x40295` 루프를 `ret` 까지 읽었다) ─────────────────
   *   ```asm
   *   0x402FE  call 0x4016A     ; AI 스텝
   *   0x40309  cmp eax, -2
   *   0x4030C  je 0x40882       ; ★ 아무것도 못 했으면 **S2S6 도 턴 마무리도 건너뜀**
   *   0x40312  cmp eax, -1
   *   0x4031D  je 0x40876       ; ★ -1 이고 di == -2 여도 건너뜀
   *      …행동…
   *   0x40838  call 0x5401B     ; ★ S2 + S6 — **여기가 제자리**
   *   0x4083D  test ax,ax / je 0x40882
   *   0x40844  call 0x17310     ;   살아 있나
   *   0x40857  call 0x1A0E9     ;   TP
   *   ```
   *   ⇒ `0x5401B` 는 **한 스텝이 실제로 무언가를 한 뒤에만** 돈다.
   *
   *   ★ 문서 `SCE_섹션2_좌표트리거_원본확정.md` §8 이 이미 못박아 뒀다:
   *     「**이벤트로 유닛을 영역에 밀어 넣어도 S2 는 안 터진다.**
   *      구현에서 반드시 지켜야 한다」 — 지키지 못하고 있었다. */

  return chain.then(function () {
    /* ★ `0x3F415` 턴 마무리는 **루프가 끝난 뒤 한 번**이다 — `runAi` 가 부른다.
     *   여기서 부르면 매 바퀴 방어·회피 자세가 서고 TP 가 사라진다. */
    if (self.pendingOutcome || self.전투끝남) self._상태전이(MODE.BATTLE_OUTCOME);
    return out;
  });
};

/**
 * ★★★★★ **AI 한 유닛의 턴** — `0x40295` 루프 (2026-08-26 · 사용자 지적)
 *
 *   사용자: 「원작에서 **킬러들이 2번씩 공격하는걸로 아는데** 지금은 1번씩만
 *   공격하고 턴이 넘어가.」 → **원본을 읽어 보니 맞다.**
 *
 *   ```asm
 *   0x402E0  mov ebx, 0xA               ; ★ 문턱 초기값 = 10
 *   0x402FC ┌ call 0x4016A              ; ★ 한 스텝 (이동 + 공격/필살기/마법)
 *   0x40309 │  cmp eax, -2 / je 0x40882 ; ★ −2 면 통째로 종료 (턴 마무리도 건너뜀)
 *   0x40857 │  call 0x1A0E9             ; ★ ax = 현재 TP (word[0x80428])
 *   0x4085C │  cmp ax, dx / jl 0x40876  ; ★ TP < 문턱이면 루프 끝
 *   0x40861 │  ebx = edx + 4            ; ★ 문턱 += 4
 *   0x4086D └  cmp edi,-3 / jne 0x402FC ; ★ −3 이 아니면 반복
 *   0x40876  call 0x3F415               ;   턴 마무리 (남은 TP 처리)
 *   ```
 *   통상 공격 한 번은 **TP 40**(`0x4016A` 의 `TP < 40 → −1`)이므로, TP 가 넉넉한
 *   유닛은 **한 턴에 두 번 이상** 친다. 전문: `03_분석/COMBATII/AI_턴반복_원본확정.md`
 *
 *   ★ 우리 `runAi` 에는 이 루프가 **통째로 없었다.**
 */
Controller.prototype.runAi = function (unit) {
  var self = this;
  var 문턱 = 10;                                     /* 0x402E0  ebx = 0xA */
  var 바퀴 = 0, 상한바퀴 = 8;                        /* ★ 안전장치 — 원본엔 없다 */
  var 앞edi = null, 기본비용 = 10, 앞종류 = null;   /* 앞종류: 옛 한 장 계획(무기 2)의 앞 바퀴 계획 종류 — 0x438AE 이동 뒤 마법 */                     /* 0x402E9 [esp+0x2C] = 10 · di 는 앞 바퀴 이동 결과 */
  var 모음 = { unit: unit, plan: null, results: [], steps: [] };

  /* ══════════════════════════════════════════════════════════════════
   * ★★★★★ **컨퓨즈 — 이 유닛의 행동 동안만 켜지는 전역** (2026-08-26 · 4-f)
   *
   *   원본 `[0x7518D]` 를 전수 추적해 확정했다
   *   (`00_4단계_도메인로직통합.md` §5 · 도구 `04_도구/검증/le_call찾기.js`):
   *
   *   ```asm
   *   0x4491c  test [edx+0x1e], 0x10   ; ★ 혼란 상태이상 비트
   *   0x44922  test [edx+0x14], 0x2    ;   또는 이 플래그 (뜻 미확인)
   *   0x44926  je  0x44941             ;   둘 다 없으면 그냥 행동
   *   0x44928  mov eax,3 / call 0x499bd; ★ rand() % 3
   *   0x44935  jne 0x44941             ; ★ **0 일 때만** = 1/3 확률
   *   0x4493c  call 0x12017            ; ★★★ [0x7518D] = 1
   *      …  유닛 행동 본체  …
   *   0x44a0e  call 0x12017 (eax=0)    ; ★★★ 끝나면 **반드시** 0
   *   ```
   *
   *   ⇒ 「혼란」은 표시가 아니라 **그 턴에 아군을 적으로 보게 만드는** 메커니즘이다.
   *     `isHostile` 이 XOR 로 뒤집히므로(`0x12062`) 대상 선택이 통째로 반전된다.
   *
   *   ★ `combat.js` 가 `applyAilmentBit(D, 0x10, …)` 로 그 비트를 **이미 걸고
   *     있었는데 읽는 쪽이 없었다** — GPT 4차 검수 ③이 잡았다.
   *
   *   ★★★★★ **`[+0x14] & 2` 를 전수로 갈랐다 (2026-09-02)**
   *
   *     ① **비트를 세우는 코드가 없다** — `[reg+0x14]` 를 만지는 자리를 전부 훑으니
   *        `or byte […], 1` 이 세 곳(`0x18081`·`0x29B1A`·`0x4F0FF`)뿐이고,
   *        **`2` 를 세우는 자리는 한 곳도 없다.** `mov` 대입 23 곳도 값을 옮기거나
   *        `0`/`0x20` 을 넣을 뿐이다.
   *     ② **데이터에도 없다** — `.SCE` **294 개 · 유닛 6766 개**를 전수로 세니
   *        `[+0x14]` 는 **`0` 이 6471 · `1` 이 295** 뿐이다. **비트 2 는 0 개.**
   *        `BLACKBOX.SV1` 캐릭터 123 명도 **전부 `0`**.
   *
   *     ⇒ **`test byte […+0x14], 2` 일곱 곳은 실제로 한 번도 참이 안 된다.**
   *        (`0x19B71` · `0x19FFC` · `0x1D851` · `0x1D93C` · `0x44922` · `0x4D68D` · `0x4EBB9`)
   *        `rules.js` 가 잇는 공격력 ×1.5(`0x1D93C`)도 **원본에서 안 걸린다.**
   *     ☠ **「죽은 코드다」라고 못박지는 않는다** — 우리가 못 본 데이터 경로
   *        (에디터·세이브 다른 칸)가 있을 수 있다. 다만 **배포된 것 안에서는 0 이다.**
   *     ★ 그러므로 **혼란 비트만 잇는 지금 처리가 옳다.**
   *     ☠☠ **정정 (2026-10-13)** — ①이 틀렸다. 버서커 스킬 `0x3BC41 mov ah,[ecx+0x14] · 0x3BC4B or ah,2 · 0x3BC4E mov [ecx+0x14],ah`
   *        가 세운다(`or byte` 꼴이 아니라 레지스터를 거쳐 써서 전수 검색에서 빠졌다). 그래서 0x44922 도 살아 있다 —
   *        아래 컨퓨즈판정이 버서크 비트를 함께 본다(리마스터 옵션 «버서크적만» 이 '원작' 일 때).
   * ══════════════════════════════════════════════════════════════════ */
  var 컨퓨즈켬 = false;
  (function 컨퓨즈판정() {
    if (!unit || !self.battle) return;
    if (root.Rules && root.Rules.상태칸묶기) root.Rules.상태칸묶기(unit);   /* f1e·ailment 한 칸 */
    var 혼란 = !!((unit.f1e | 0) & 0x10);            /* 0x4491C  [+0x1e] & 0x10 */
    /* ★ 0x44922 test [+0x14],2 — 버서커 스킬(0x3BC41~0x3BC4E or ah,2)이 세운다. 원작은 혼란과 같이 1/3 로 피아를 뒤집는다(적·아군 둘 다 친다).
     *   ☠ 옛 조사(2026-09-02)는 «세우는 곳이 없다»고 봤으나 0x3BC4B 가 세운다 (2026-10-13 역어셈 확인)
     *   [리마스터] 옵션 «버서크적만»(기본 '리마스터') — 적만 친다 · '원작' 이면 원본처럼 뒤집기에 든다
     *   2026-10-13 사장님 「현재처럼 적만 공격하는 것이 리마스터 옵션이고, 원본은 피아 구분없이 공격하는거야. 이걸 토글로 설정가능하게 해달라는거야」 */
    var 옵b = (root.Opt && root.Opt.cfg) || null;
    var 버서크 = !!((unit.f14 | 0) & 2) && !!(옵b && 옵b['버서크적만'] === '원작');
    if (!혼란 && !버서크) return;
    /* 0x44928  rand() % 3 — 0 일 때만 (`0x499bd` 가 `0x61ede` 를 3 으로 나눈 나머지) */
    /* ★ 전투 내내 **한 스트림**을 쓴다 (`Controller` 생성자 `persistentRng`).
     *   매번 새 시드를 만들면 원본과 달리 같은 값이 반복된다.
     *
     *   ★★★ **조용한 `Math.random()` 폴백을 지웠다** (2026-08-26 · 4-g · GPT 5차 ②)
     *     > 「창구 부재는 폴백보다 **배선 오류**로 다루는 편이 리팩터링 원칙과 맞다」
     *     원본은 `0x4492D → 0x499BD` 라는 **기존 난수 창구**를 쓴다. 다른 난수원으로
     *     계속 가면 **재현성과 난수 소비 순서가 달라진다.** */
    var rng = self.svc && self.svc.rng;
    if (typeof rng !== 'function') {
      throw new Error('runAi: svc.rng 가 없다 — 난수 스트림 배선이 빠졌다 (원본 0x499BD)');
    }
    /* ★ 0x44928 eax=3 → 0x4492D call 0x499BD — 정수 rand(3). 0 일 때만 뒤집는다 (3분의 1)
     *   ☠ 예전 `(rng() * 3) | 0` 은 인자 없이 불러 제품 창구(battle_main `G2Rand.rng(n|0)`)에서 rand(0) = 0 이 나와
     *     혼란이면 «매 차례» 뒤집혀 아군만 쳤다 (2026-10-05 사장님 「피아 구분없이가 아니라 아군만 공격하는 것 같아」) */
    var r = rng(3) | 0;
    if (r !== 0) return;
    self.battle.confuse = 1;                          /* 0x4493C  [0x7518D] = 1 */
    컨퓨즈켬 = true;
    if (root.console && console.info) {
      console.info('[AI] 컨퓨즈 — ' + (unit.name || '?') + ' 가 이번 행동 동안 적아를 뒤집어 본다 (0x4493C)');
    }
  })();
  /** ★ 행동이 끝나면 **반드시** 끈다 — `0x44A0E`. 다음 유닛에 안 샌다. */
  function 컨퓨즈끄기() {
    if (!컨퓨즈켬) return;
    컨퓨즈켬 = false;
    if (self.battle) self.battle.confuse = 0;         /* 0x44A0E  [0x7518D] = 0 */
  }

  function 한바퀴() {
    바퀴++;
    return Promise.resolve(self._AI한칸(unit, { 첫바퀴: 바퀴 === 1, 앞edi: 앞edi, 기본비용: 기본비용, 앞종류: 앞종류 })).then(function (r) {
      모음.steps.push(r);
      if (!모음.plan) 모음.plan = r && r.plan;
      if (r && r.results && r.results.length) 모음.results = 모음.results.concat(r.results);

      /* ── 종료 조건 ─────────────────────────────────────────── */
      if (!unit || unit.alive === false) return 모음;          /* 0x40844  call 0x17310 */
      if (self.pendingOutcome || self.전투끝남) return 모음;
      if (r && r.원본순서) return 원본순서뒤(r);
      if (r && r.원거리) return 원거리뒤(r);
      if (r && r.보스) { 모음.자세없음 = true; return 모음; }       /* 0x4423C → 0x44A0C — 한 번으로 끝 · 0x3F415 없음 */
      if (r && r.마법루프) { if (r.자세없음) 모음.자세없음 = true; return 모음; }   /* 0x43526·0x438AE 는 고리를 안에서 다 돈다 */
      if (r && r.끝 === 'flee') { 모음.자세없음 = true; return 모음; }     /* 0x44A0C — 도주면 루프·턴 마무리 자세 없음 */
      if (바퀴 >= 상한바퀴) return 모음;

      var kind = (r && r.plan && r.plan.kind) || 'wait';
      앞종류 = (kind === 'approach' && r.plan.move) ? 'approach' : kind;
      /* `0x40309 cmp eax,-2 / 0x4030C je 0x40882` — 아무것도 못 했으면 통째로 끝낸다.
       *   우리 `act()` 에서 그에 해당하는 것: 대기 · 도주 · 제자리(approach 인데 못 감)
       *   ★★★ 여기서 끝내면 **`0x40838 call 0x5401B`(S2+S6)도 건너뛴다** — 원본 그대로다.
       *     이것을 안 지켜서 `1-5` 에서 **이벤트 이동 직후 암흑살수가 등장**했다(2026-08-27). */
      if (kind === 'wait' || kind === 'flee') return 모음;
      /* ★ `0x3E5AB`: 「후보가 이미 **현재 위치·방향**이면 edi = -2, 아니면 edi = 1」
       *   → `edi == -2` 는 위 `0x4030C` 갈래로 가 **S2S6 도 턴 마무리도 건너뛴다.**
       *   좌표 목표(`approach`)인데 **실제로 한 칸도 못 갔으면** 그 경우다. */
      if (kind === 'approach' && !(r && r.plan && r.plan.move)) return 모음;

      /* ★★★★★ **`0x40838  call 0x5401B` — S2(좌표 영역) + S6(앞칸 조우)**
       *
       *   원본은 **한 스텝이 실제로 무언가를 한 뒤**에만 부른다 — 바로 이 자리
       *   (`0x4030C` 의 `-2` 갈래를 지나온 지점)다.
       *   `0x5401B` 안의 순서: S2(`0x5403A`) → 살아있나(`0x54041`) → S6(`0x5408E`).
       *   ★ 전에는 `_aiStep` **안**에서 종류를 안 보고 불렀다. 그래서 `wait` 로
       *     끝난 스텝에서도 S2 가 돌았다. */
      return Promise.resolve(self._리마스터경험창()).then(function () {   /* [리마스터] 부분·보조 경험치 */
      var S2S6대기 = null;
      if (typeof self.svc.S2S6알림 === 'function') {
        var 외S = self.svc.S2S6알림({ 유닛: unit, 원본경계: '0x40838' });
        S2S6대기 = (외S && 외S.대기) || null;
      }
      return Promise.resolve(S2S6대기).then(function () { return self._지형피해(unit, '0x40844'); });   /* 0x17310 지형 피해 (2026-10-12) */
      }).then(function () {
      /* `0x4083D test ax,ax / je 0x40882` · `0x40844 call 0x17310` —
       *   S2/S6 가 이 유닛을 죽였거나 결과를 냈을 수 있다 */
      if (!unit || unit.alive === false) return 모음;
      if (self.pendingOutcome || self.전투끝남) return 모음;
      /* `0x4086D  cmp edi,-3` — `TP <= 10+24`(34) 면 반복하지 않는다 */
      if ((unit.tp | 0) <= 34) return 모음;
      /* `0x4085F  cmp ax,dx / jl` — TP 가 문턱보다 작으면 끝 */
      if ((unit.tp | 0) < 문턱) return 모음;
      문턱 += 4;                                              /* 0x40861 */
      /* ★★★★★ **다음 바퀴 앞에서도 이벤트가 끝나기를 기다린다** (2026-08-27)
       *
       *   > 사용자 ②결과피드백: 「그리고 아직도 **이벤트 대사 끝나지 않았는데,
       *   >  공격이 이어져.**」 (2026-08-26 에도 같은 지적 — 그때는 **스텝 앞**에만 달았다)
       *
       *   `0x402FC call 0x4016A` 는 **동기**다 — 그 안에서 `0x53797` 이 이벤트를
       *   돌리면 **다 끝난 뒤** 반환된다. 다음 바퀴(`0x4086D jne 0x402FC`)는
       *   언제나 이벤트 **뒤**다. 우리는 비동기이므로 여기서 명시적으로 기다린다. */
      return self._이벤트끝날때까지().then(function () {
        /* ★ 기다리는 사이에 죽었거나 결과가 났을 수 있다 — 원본 `0x40844`·`0x40309` */
        if (!unit || unit.alive === false) return 모음;
        if (self.pendingOutcome || self.전투끝남) return 모음;
        return 한바퀴();
      });
      });   /* ← `0x40838` S2S6 대기 */
    });
  }

  /**
   * 원본 순서 바퀴의 뒤 — 0x40838~0x4086D
   *   걸었으면(edi 1) 0x40838 S2+S6 → 0x40844 살아 있나 · 그다음 0x40857 TP < 문턱 → 끝 · 문턱 += 4 · edi −3 → 끝
   *   ★ S2S6 는 «걸었을 때만» 돈다 — 공격만 한 바퀴에는 안 돈다(0x40838 은 edi 1 갈래 안)
   */
  function 원본순서뒤(r) {
    /* −2(0x4030C → 0x40882)·'flee'(0x44A0C)는 0x3F415 턴 마무리 자세를 건너뛴다 · 'end'(0x40876)는 한다 */
    if (r.끝 === -2 || r.끝 === 'flee') 모음.자세없음 = true;
    if (r.끝 != null) return 모음;                                /* −2 · 'end' · 'flee' */
    앞edi = r.edi;
    if (r.기본비용 != null) 기본비용 = r.기본비용;
    if (바퀴 >= 100) return 모음;                                  /* ★ 안전장치 — 원본엔 없다 */
    return Promise.resolve(self._리마스터경험창()).then(function () {   /* [리마스터] 부분·보조 경험치 */
      if (!r.걸음 || typeof self.svc.S2S6알림 !== 'function') return null;
      var 외S = self.svc.S2S6알림({ 유닛: unit, 원본경계: '0x40838' });
      return (외S && 외S.대기) || null;
    }).then(function () { return r.걸음 ? self._지형피해(unit, '0x40844') : null; })   /* 0x17310 지형 피해 (2026-10-12) — 걸었을 때만(0x4083D je) */
    .then(function () {
      if (!unit || unit.alive === false) return 모음;               /* 0x40844 0x17310 */
      if (self.pendingOutcome || self.전투끝남) return 모음;
      if ((unit.tp | 0) < 문턱) return 모음;                         /* 0x4085F */
      문턱 += 4;                                                     /* 0x40861 */
      if (r.edi === -3) return 모음;                                 /* 0x4086D */
      return self._이벤트끝날때까지().then(function () {
        if (!unit || unit.alive === false) return 모음;
        if (self.pendingOutcome || self.전투끝남) return 모음;
        return 한바퀴();
      });
    });
  }

  /**
   * 원거리 바퀴의 뒤 — 0x414C9~0x414FE
   *   행동 −2 → 0x4150D(마무리 없음) · −1 이고 이동 −2 → 0x41504 · TP < 문턱 → 0x41504 · 문턱 += 4 · 이동 −3 → 0x41504
   *   턴 마무리 0x41508 은 0x3F415(인자 0) — 반격 자세가 없다
   */
  function 원거리뒤(r) {
    모음.원거리 = true;
    if (r.끝 === -2 || r.끝 === 'flee' || r.끝 === 'exit') { 모음.자세없음 = true; return 모음; }
    if (r.끝 === 'end') return 모음;
    if (r.결과 === -2) { 모음.자세없음 = true; return 모음; }
    if (r.결과 === -1 && r.edi === -2) return 모음;
    if (r.기본비용 != null) 기본비용 = r.기본비용;
    if (바퀴 >= 100) return 모음;
    return Promise.resolve(self._리마스터경험창()).then(function () {
      if (!unit || unit.alive === false || self.pendingOutcome || self.전투끝남) return 모음;
      if ((unit.tp | 0) < 문턱) return 모음;                         /* 0x414ED */
      문턱 += 4;
      if (r.edi === -3) return 모음;                                 /* 0x414FB */
      return self._이벤트끝날때까지().then(function () {
        if (!unit || unit.alive === false || self.pendingOutcome || self.전투끝남) return 모음;
        return 한바퀴();
      });
    });
  }

  /* ★★★ 컨퓨즈는 **어떤 길로 끝나든** 꺼야 한다 — 원본 `0x44A0E` 는 `ret` 바로 앞이다.
   *   실패로 빠져나가도 켜진 채로 두면 **다음 유닛까지 적아가 뒤집힌다.**
   *   ★ `한바퀴()` **호출 자체**가 동기 예외를 던질 수 있으므로 `try/finally` 로
   *     감싼다 (4-g · GPT 5차 ①). 사슬 끝에도 따로 건다 — 두 번 불려도 안전하다. */
  var 사슬;
  try {
    사슬 = 한바퀴();
  } catch (e동기) {
    컨퓨즈끄기();                                     /* 0x44A0E — 동기 예외 */
    throw e동기;
  }
  /* ★ [리마스터] 부분·보조 경험치는 «이 유닛의 행동이 끝나는 자리»에서 반드시 정산한다 (2026-10-10)
   *   사장님: 「마법을 쓰고, 다른 캐릭터가 행동한 뒤에 이전에 마법쓴 캐릭터가 레벨이 오르는 경우가 있음. 꽤 자주」
   *   ☠ 정산은 원본순서·원거리 바퀴 뒤에만 있었다 — 마법루프(0x43526·0x438AE)·보스·도주·사망·결과·상한으로
   *     빠지면 쌓인 몫이 남아 «다음 유닛의» 정산에서 넣어졌다(한 박자 늦은 레벨업 창). */
  return 사슬.then(function (out) {
    return Promise.resolve(self._리마스터경험창()).then(function () { return out; }, function () { return out; });
  }).then(function (out) {
    self._상태전이(MODE.AI_END);
    /* 0x40876 → 0x3F415 — 턴 마무리는 **루프가 끝난 뒤 한 번**이다 */
    var 마무리 = Turn().endUnit(self.battle, unit, { 자세없음: !!(out && out.자세없음),
                                        defense: !(out && out.원거리) });   /* 0x41508 edx=0 — 원거리 루프는 반격 자세 없음 */
    if (self.pendingOutcome || self.전투끝남) self._상태전이(MODE.BATTLE_OUTCOME);
    /* ★ 0x3F48A 0x1124A(그 유닛을 비춤) → 0x3F499 0x4D3BA → 0x4D401 0x462A7 회복 숫자 — 남은 TP 휴식 (2026-10-07 · turn.endUnit 주석) */
    if (마무리 && (마무리.heal | 0) > 0 && unit.alive) {
      return Promise.resolve(self.svc.focus ? self.svc.focus(unit.x | 0, unit.y | 0) : null)
        .then(function () { return self._연출실행('rest', { unit: unit, report: { heal: 마무리.heal | 0 } }); })
        .then(function () { return out; }, function () { return out; });
    }
    return out;
  })
  /* ★★★★★ **동기 예외까지 반드시 끈다** (2026-08-26 · 4-g · GPT 5차 검수 ①)
   *
   *   > 「`Promise.resolve(self._aiStep(...))` 는 `_aiStep()` 을 **먼저 평가**한다.
   *   >  동기 예외를 던지면 `한바퀴()` 자체가 던져 `.then(성공, 실패)` 의 실패
   *   >  처리까지 **도달하지 않는다.** 성공 처리에서도 `self._상태전이()`·
   *   >  `Turn().endUnit()` 이 동기 예외를 던지면 `컨퓨즈끄기()` 보다 먼저 빠져나간다.
   *   >  그 경우 `battle.confuse = 1` 이 **다음 유닛에 남는다.**」
   *
   *   ⇒ `try { … } finally` 로 **호출 자체**를 감싸고, 사슬 끝에도 건다.
   *     원본 `0x44A0E` 는 `ret` 직전이라 「어떤 길로도」가 계약이다.
   *   ★ `컨퓨즈끄기()` 는 **여러 번 불려도 안전**하다(`컨퓨즈켬` 을 먼저 내린다). */
  .then(function (out) { 컨퓨즈끄기(); return out; },
        function (e) { 컨퓨즈끄기(); throw e; });
};

/* ══════════════════════════════════════════ 11. 렌더러가 읽는 것 (읽기 전용) */

/**
 * 화면에 그릴 하이라이트. **컨트롤러가 주는 대로만** 그립니다 (§27-12).
 * @returns {{kind, cells}|null}
 */
Controller.prototype.highlight = function () { return this.rangeContext; };
/** 렌더러가 읽을 현재 링 문맥을 반환한다. */
Controller.prototype.ringState = function () { return this.ringContext; };
/** 방향 선택 단계에서만 이동 방향 초안을 반환한다. */
Controller.prototype.facingDraft = function () {
  return (this.mode === MODE.FACING_SELECT) ? this.moveDraft : null;
};
/** 컨트롤러의 공개 전투 진행 상태를 진단용 값으로 복사한다. */
Controller.prototype.snapshot = function () {
  return {
    mode: this.mode,
    phase: this.battle.phase,
    ready: this.readyUnits().map(function (u) { return u.name; }),
    actor: this.actor ? this.actor.name : null,
    sessionActor: this.session ? this.session.actor.name : null,
    tp: this.session ? this.session.tp() : (this.actor ? this.actor.tp | 0 : 0),
    exitCost: this.session ? this.session.exitCost : 0,
    ring: this.ringContext ? { menu: this.ringContext.menu, icons: this.ringContext.icons.slice() } : null,
    range: this.rangeContext ? { kind: this.rangeContext.kind, n: this.rangeContext.cells.length } : null,
    locked: this.locked(), outcome: this.pendingOutcome
  };
};

/* ── 모듈 ──────────────────────────────────────────────────────────── */

var G2Controller = {
  VERSION: '1.0 (COMBATII.EXE 대조)',
  Controller: Controller,
  MODE: MODE, CMD_MAP: CMD_MAP, NEEDS_TARGET: NEEDS_TARGET, ACT: ACT,
  create: function (battle, svc) { return new Controller(battle, svc); }
};

root.G2Controller = G2Controller;
if (typeof module !== 'undefined' && module.exports) module.exports = G2Controller;

})(typeof globalThis !== 'undefined' ? globalThis : this);
