/* ============================================================================
 * 창세기전 2 — 턴 시스템
 *
 * 턴 관리자 `0x19D53` 을 그대로 옮겼습니다. 메인 입력 루프 `0x5580F` 가
 * 매 바퀴 `0x558E2` 에서 이 함수를 부릅니다.
 *
 *   0x19D53   턴 관리자          턴 수 [0xF0418] · 진영 인덱스 [0xF0424]
 *                                재진입 [0xF0422] · 페이즈 [0xF042E]
 *   0x197CA   시간 진행          시각 [0xFDF84] 0~15, 8 이 되면 날짜 [0xFDF82] +1
 *   0x19AEF   라운드 시작 일괄 처리 — 재행동 대기 · 도트 · 잔여턴 · 지형피해
 *   0x19FAB   TP 충전
 *   0x44913   AI 유닛 행동 시작   [+0x56] = 0 → 0x19FAB
 *   0x4D6F0   플레이어 유닛 행동 시작 (같은 순서)
 *   0x3F415   행동 종료 — 남은 TP 로 방어(60)·회피(40) 구입
 *   0x44EB0   하단 턴 게이지      눈금 = ((턴 % [0x74138]) + 1) / 2
 *
 * ── 원본 구조 (오해하기 쉬운 곳) ────────────────────────────────────────
 *
 * ① **턴 관리자는 「이번에 행동할 유닛 한 명」을 내주지 않습니다.**
 *    `0x19D53` 은 한 번 불릴 때마다 턴을 1 올리고 **진영 1 → 2 → 3 → 4 전체를
 *    그 자리에서 끝까지 훑습니다**. 그러면서
 *    · 진영 1 · AI 플래그 0 · 조작불가([+0x1E]&0x10) 아님  →  **아무것도 안 하고 다음 유닛**
 *      (0x19E52 `cmp ch,1 / jg 0x19E65` → 0x19E57 → 0x19E63 `je 0x19E7D`)
 *    · 그 밖에서 `[+0x56] == 0xFF` → 그 자리에서 `0x44913`(AI 행동)
 *    메인 루프 `0x5580F` 는 이것을 **매 바퀴** 부릅니다(0x558E2). 즉 페이즈가 0 인
 *    동안은 라운드가 프레임마다 계속 흘러가고, 플레이어 유닛은 행동하지 않은 채
 *    **행동 가능 대기열에 계속 쌓입니다**.
 *
 * ①-b **행동 가능 아군 대기열** — [0xF041C] 머리 / [0xF0414] 꼬리 / [0xF0426] 개수.
 *    `0x19AEF` 가 `[+0x56] = 0xFF` 를 쓴 직후(0x19B8B) 0x19C01 이
 *    「진영 1 · [+0x83]==0 · !([+0x1E]&0x10)」 를 보고 `0x196D0` 으로 **대기열에 넣습니다**.
 *      0x196D0 넣기(+1) · 0x19718 빼기(−1) · 0x197AD 빼기 + [+0x56]=0
 *      0x1979F i번째 · 0x19792 비었나
 *    플레이어는 이 대기열에 있는 아군을 **순서 없이 아무나** 조작합니다.
 *    `0x4D674` 어디에도 "이 유닛이 이번 차례인가" 검사가 없습니다 —
 *    `[+0x56] == 0xFF` 이기만 하면 됩니다(0x4D6BB).
 *
 * ①-c **멈추는 곳은 딱 두 군데** ([0xF042E] 페이즈).
 *      0 라운드 진행 · 1 Player Phase · 2 Waiting · 3 AI Phase — 0 이 아니면
 *      `0x19D69` 가 턴 관리자를 통째로 막습니다(return 1).
 *    · 정기 정지 : `(턴+1) % [0x74138] == 0` 이고 대기열이 비어 있지 않으면
 *      0x19F06~0x19F42 가 대기열 **마지막** 유닛으로 카메라를 옮기고
 *      `[0xF042E] = 1`, 배너 [0x75008] = 1, **return 2**.
 *    · 스페이스바 : 타이머 ISR(0x101F4 → 0x1029F → **0x19F5D**) 이
 *      「디바운스 [0x789A4]==0 · 페이즈 0 · 스캔코드 0x39 눌림」이면 페이즈 = 2.
 *      다음 프레임 0x19D59 가 2 → 3 으로 올리고 계속 멈춰 있습니다.
 *    다시 흐르게 하는 곳도 두 군데.
 *    · 스페이스바 키 이벤트(코드 0x20) → **0x55B19** : 페이즈 != 0 이면 **페이즈 = 0**.
 *    · 세션 종료 **0x4DB58** : 페이즈 == 1 이고 대기열이 비었으면 페이즈 = 0.
 *      → 조작할 아군을 전부 쓰면 시간이 저절로 다시 흐릅니다.
 *
 * ①-d `[0xF0422]` 는 **진영 순회 재개 플래그**입니다. 0x19E09 에서 1 을 쓰고
 *    0x19EC0 에서 0 으로 지웁니다. 순회 도중 중단되면(0x19E88 이 페이즈 2 를 보면
 *    페이즈를 3 으로 만들고 return 2) 다음 호출 때 0x19D83 이 이 플래그를 보고
 *    **턴 증가·시간·0x19AEF 를 건너뛰고** 저장된 [0xF0424]/[0xF0410] 에서 이어 갑니다.
 *
 * ② **TP 충전은 라운드 시작이 아니라 유닛이 행동을 시작할 때**입니다.
 *    0x44943 `[+0x56] = 0` → 0x44947 `0x19FAB`. 플레이어도 0x4D6F0/0x4D6FB 로
 *    똑같습니다. 그래서 `next()` 가 유닛을 내주면서 충전합니다.
 *    라운드 시작에 도는 것은 재행동 대기·도트·잔여턴·지형피해(0x19AEF)입니다.
 *
 * ③ 매 라운드 `(턴 + 1) % [0x74138] == 0` 이면 [0xF0426] > 0 일 때
 *    `[0xF042E] = 1`(Player Phase) 로 바꾸고 카메라를 옮깁니다(0x19EF1~0x19F42).
 *    하단 게이지는 이 주기 안에서 지금 몇 번째 라운드인지를 보여 줍니다.
 *    `[0x74138]` 는 EXE 초기값 10 이지만 `GAME.CFG` 7번째 바이트가 덮어써
 *    원본 배포본은 **7** 입니다(0x4FEE5, 2~30 클램프).
 *
 * ④ 시간은 턴으로만 흐릅니다 — `[0xBA84E]` 가 4·5 면 30턴, 아니면 **900턴**
 *    마다 0x197CA 가 시각을 한 칸 올립니다(0x19D9C~0x19DD2).
 *
 * ⑤ 화면 표시 — `0x454D5` 는 [0x75008] == 1 일 때만 배너를 그립니다.
 *    페이즈 1 → `ETC.ICO` 8 (Player Phase, 0x45BBF/[0xD6630])
 *    페이즈 2 → `ETC.ICO` 9 (Waiting…,    0x45477/[0xD663C])
 *    페이즈 3 → `ETC.ICO` 10 (AI Phase,   0x45494/[0xD6648])
 *    자리는 셋 다 (0x28, 0xAA). 자산 배정은 0x44A4C 가 `etc.ico` 를 0~7 → [0xBA850],
 *    8~10 → [0xD6628] 로 나눠 읽는 데서 확정됩니다.
 *
 * ⑥ 행동 가능 표식(깜빡이는 빛) — `0x12161` 이 맵을 그리면서 칸마다
 *    `[+0x56] == 0xFF` 인 유닛을 찾아 `ETC.ICO` 를 덧그립니다(0x12240~0x12273).
 *      진영 1 · [+0x83]==0  →  프레임 `[0xE518E]`      (0~3, 파랑·흰 반짝임 15×13)
 *      그 밖               →  프레임 `[0xE518E] + 4`  (4~7)
 *    `[0xE518E]` 는 대기 모션과 같은 자리(0x120EF)에서 **30틱마다 (+1) & 3**.
 *
 * 쓰는 법
 *   <script src="rules.js"></script> <script src="state.js"></script>
 *   <script src="move.js"></script>  <script src="turn.js"></script>
 *                                              →  globalThis.G2Turn
 * ==========================================================================*/
(function (root) {
'use strict';

function isMagicEffectExcluded(u) { var Ru = root.Rules; if (!Ru && typeof require === 'function') { try { Ru = require('./rules.js').Rules; } catch (e) {} } if (!Ru || !Ru.isMagicEffectExcluded) throw new Error('Rules.isMagicEffectExcluded가 필요하다'); return Ru.isMagicEffectExcluded(u); }

function idiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }
function R() { return root.Rules; }

var READY = 0xFF;              // [+0x56] 행동 가능 표시

/* [0xF042E] — 0 라운드 진행 · 1 Player Phase · 2 Waiting · 3 AI Phase */
var PHASE = { RUN: 'run', PLAYER: 'player', WAITING: 'waiting', AI: 'ai' };
var PHASE_CODE = { run: 0, player: 1, waiting: 2, ai: 3 };
var PHASE_NAME = ['run', 'player', 'waiting', 'ai'];

/* ───────────────────────────────────────────── 0. rules.js 와 칸 이름 맞추기 */

/**
 * state.js 유닛 → rules.js 가 기대하는 모양.
 * state.js 가 `derive()` 때 만들어 둔 `_shim` 을 재활용하고 런타임 칸만 얹습니다.
 * 되돌리기는 `writeBack()` 이 합니다.
 */
function shimOf(u) {
  if (R() && R().상태칸묶기) R().상태칸묶기(u);    /* f1e·ailment 한 칸 (rules 상태칸묶기) */
  /* 정본 377 — 사본(_shim)은 state.js derive 가 장비(equip)·순수 능력치(base)를 실어 만든다 · 그것을 한 번도 안 탄 유닛이면 먼저 태운다
   *   빈 사본으로 라운드 시작 도트 피해(rules dotDamage → derive)를 세다 «undefined 의 weapon» 으로 전투가 멈췄다
   *   (신고 버그신고_20261122_122830 · 칼스·카심 피라미드 5-2 · turn.js unitPass → rules.js:210) */
  if ((!u._shim || !u._shim.equip) && root.G2State && root.G2State.derive && u.gear) { try { root.G2State.derive(u); } catch (e사본) { } }
  var s = u._shim || (u._shim = {});
  s.job = u.job; s.level = u.level; s.race = u.race;
  s.faction = u.side; s.charCode = u.charCode;
  s.sprite = u.sprIndex | 0;                       // [+0x61]
  s.mount = u.gear ? u.gear.mount : 0;
  s.f13 = u.stance | 0;                            // [+0x13]
  s.f14 = u.f14 | 0;                               // [+0x14]
  s.f15 = u.f15 | 0;                               // [+0x15]
  s.f1e = u.ailment | 0;                           // [+0x1E]
  s.wait = u.waitCount | 0;                        // [+0x56]
  s.hp = u.hp | 0; s.maxHp = u.maxHp | 0;          // ×100 단위
  s.aiAttack = u.ai ? (u.ai.atkTend | 0) : 0;      // [+0x6D]
  /* DNA 모습 — 지속 감소(rules tickDurations 0x198EF~0x19900)가 원래 그림으로 되돌린다. 사본에도 실어야 되돌릴 수 있다
   *   ☠ 예전엔 안 실어서 지속이 끝나도 고블린 그대로였다 (2026-09-26 사장님 「dna체인저 스프라이트 되돌리는 부분이 미적용」) */
  s.sprIndex = u.sprIndex | 0; s._dna전스프라이트 = u._dna전스프라이트; s.dnaForm = u.dnaForm;
  s.st = u.st || (u.st = { d15: [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF],
                           d1e: [0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF, 0xFFFF] });
  return s;
}
function writeBack(u, s) {
  u.stance = s.f13 | 0; u.f14 = s.f14 | 0; u.f15 = s.f15 | 0;
  u.ailment = s.f1e | 0; u.waitCount = s.wait | 0;
  if (s.hp != null) u.hp = s.hp | 0;
  if (s.sprIndex != null) u.sprIndex = s.sprIndex | 0;   /* DNA 되돌림 (shimOf 주석) */
  u._dna전스프라이트 = s._dna전스프라이트; u.dnaForm = s.dnaForm;
}

/* ───────────────────────────────────────────── 1. 조작 주체 · 진영 순회 */

/**
 * 이 유닛을 누가 움직이는가 — 0x19E4C ~ 0x19E63.
 * 진영 <= 1 이고 AI 플래그가 0 이고 조작불가([+0x1E] & 0x10) 가 아니면 플레이어.
 */
function controlOf(battle, u) {
  if ((u.side | 0) > 1) return 'ai';
  if ((u.ai && (u.ai.flag | 0)) !== 0) return 'ai';
  if ((u.ailment | 0) & 0x10) return 'ai';
  return 'player';
}

/** 진영 인덱스 0~3 → 진영 번호 1~4 (0x19EA9 `리스트 인덱스 = 진영 − 1`). */
function sideOfIndex(i) { return (i | 0) + 1; }

/** 그 진영의 유닛 — 원본은 [0xCC968 + idx*8] 연결 리스트, 여기서는 파일 순서. */
function listOf(battle, sideIdx) {
  var side = sideOfIndex(sideIdx);
  return battle.units.filter(function (u) { return (u.side | 0) === side; });
}

/* ─────────────────────────────────── 1-b. 행동 가능 아군 대기열 (0xF041C)
 *
 * 원본은 8바이트 노드 {유닛, 다음} 의 단일 연결 리스트입니다.
 *   [0xF041C] 머리 · [0xF0414] 꼬리 · [0xF0426] 개수
 * 여기서는 그냥 배열 하나(`battle.readyQueue`)로 두고 **순서를 원본과 같게** 지킵니다
 * (뒤에 붙임 = 늦게 행동 가능해진 순). 0x19F12 가 카메라를 옮길 때 쓰는 것은
 * `[0xF0426] − 1` 번째 = **가장 마지막에 들어온 유닛**입니다.
 * -------------------------------------------------------------------------- */

function queue(battle) {
  if (!battle.readyQueue) battle.readyQueue = [];
  return battle.readyQueue;
}

/** 0x196D0 — 진영 1 이면 대기열 꼬리에 붙이고 [0xF0426]++. */
function enqueueReady(battle, u) {
  if (!u || (u.side | 0) !== 1) return false;          // 0x196D3  cmp [eax+0xE], 1
  var q = queue(battle);
  if (q.indexOf(u) >= 0) return false;
  q.push(u);
  return true;
}

/** 0x19718 — 대기열에서 빼고 [0xF0426]--. */
function dequeueReady(battle, u) {
  var q = queue(battle), i = q.indexOf(u);
  if (i < 0) return false;
  q.splice(i, 1);
  return true;
}

/** 0x197AD — 빼기 + `[+0x56] = 0`. 「이 유닛은 차례를 썼다」의 정본입니다. */
/**
 * ★★★ **유닛 하나의 사망 마무리** — 원본 `0x1DB1D` 에 해당하는 상태 전이.
 *
 *   통합 2-c 2단계에서 뽑아냈다 (2026-08-22 · GPT 14차 권고):
 *   「`turn.js` 가 사망을 예정 상태로 반환하고, 같은 모듈의 공개 함수가
 *    기존 네 동작을 수행하게 한다. 그러면 컨트롤러가 사망 규칙을
 *    재구현하지 않고 **언제 실행할지**만 정한다」
 *
 *   ★ 원본 순서: 지형 감산 → **S4(`0x173EB`)** → 사망 처리(`0x1745B`).
 */
function 사망마무리(battle, u) {
  var 진영 = 사망진영(u);                   /* ★ S4 **전**의 진영 (원본은 [esp-0x3]) */
  if (!사망전처리(battle, u)) return false;
  사망후처리(battle, u, 진영);
  return true;
}

/**
 * ★★★★★ **사망 전처리** — 원본 `0x1DB50`(S4) **앞**까지 (2026-08-22 · GPT 23차)
 *
 *   ```asm
 *   0x1DB2A  call 0x197AD          ; ★ **대기열에서 빼기**
 *   0x1DB43  mov [edx+0x48], 0     ; ★ **HP = 0**
 *   0x1DB50  call 0x53797          ; ★★★ S4 — 여기서 유닛은 **아직 맵에 있다**
 *   ```
 *
 *   ★ `alive = false` 와 맵 제거는 **S4 뒤**다 (`사망후처리`).
 *     S4 공통조건의 **영역 인원**(`0x533FC`)은 **맵 칸**을 세므로 순서가 중요하다.
 */
function 사망전처리(battle, u) {
  if (!u || !u.alive) return false;
  if (u._불사) { u.hp = 0; return false; }   /* [리마스터] 용자의 무덤 8층 안내인 «HP 0 으로 버팀» — u._불사 (battle_main 무덤 머리에서 건다 · 2026-10-12 사장님 「혹시 죠엘이 때려서 죽더라도 체력0상태에서 진행되어야해. 그리고 평타 말고 필살기같은것도 적용 되어야 하고」) — 사망 갈래를 통째로 안 탄다 */
  /* ★ 원본은 진영 번호를 **S4 전에** 스택(`[esp-0x3]`)에 담아 두고
   *   `0x1DB5B sar eax,0x18` 로 꺼낸다 — **호출별 지역 상태**다.
   *   ★★★ 그래서 **유닛 객체에 보관하지 않는다** (GPT 26차):
   *     S4 명령열이 같은 유닛의 사망을 **중첩**시키면 안쪽 호출이 바깥 값을 덮어쓴다.
   *   ⇒ 부르는 쪽이 `사망진영(u)` 으로 캡처해 `사망후처리(…, 진영)` 에 넘긴다. */
  u.hp = 0;                        // 0x1DB43
  consumeTurn(battle, u);          // 0x1DB2A → 0x197AD  대기열에서 빼기
  return true;
}

/**
 * ★★★★★ **사망 후처리** — 원본 `0x1DB50`(S4) **뒤** (2026-08-22 · GPT 23차)
 *
 *   ```asm
 *   0x1DB6B  cmp [ecx+0x48], 0     ; ★★★ **HP 를 다시 본다**
 *   0x1DB6F  jle 0x1DB8B           ;   여전히 0 이하 → 사망 연출
 *   0x1DB71  …                     ;   ★ **회복됐으면 안 죽는다**
 *   0x1DD9C  call 0x1137A          ; ★ **리스트 제거** — S4 보다 훨씬 뒤
 *   ```
 *
 *   @returns {boolean} 실제로 죽였으면 `true`. ★ **S4 가 HP 를 회복시켰으면 `false`**
 */
function 사망후처리(battle, u, 저장진영) {
  if (!u) return false;
  /* ★ 저장 진영을 **안 주면** 지금 진영으로 물러선다 (오래된 호출부 호환).
   *   ★★★ 통합 경로(`controller`)는 **반드시 명시로 넘긴다** — 시험으로 고정했다. */
  var 진영 = (저장진영 === undefined || 저장진영 === null) ? (u.side | 0) : (저장진영 | 0);

  /* ★★★ `0x11FF7` — **원래 진영의 활성 목록에 아직 있는가** (0x1DB61) */
  if (!진영목록에있나(battle, u, 진영)) return false;   // 0x1DB66 je 0x1DB71

  /* ★★★ 원본 `0x1DB6B` — S4 뒤에 HP 를 **다시 본다.** 회복됐으면 안 죽는다 */
  if ((u.hp | 0) > 0) return false;

  u.alive = false;
  /* 정본 176 — 독·화상 턴 피해로 죽어도 상태이상·버프를 지운다(0x1DD35·0x1DD3C). 안 지우면 소울리콜이 상태이상째 일으켰다 */
  { var C176 = (typeof root !== 'undefined' && root.G2Combat) || (typeof window !== 'undefined' && window.G2Combat) || null;
    if (C176 && C176.사망상태지우기) C176.사망상태지우기(u); }
  /* ★★★★★ **`unplace(u)` 를 쓴다 — `setAt(x,y,null)` 이 아니다** (GPT 25차)
   *   `setAt(x, y, null)` 은 **그 칸의 점유자**를 통째로 내린다 (`state.js:543`).
   *   S4 가 유닛을 옮겼는데 옛 좌표로 지우면 **남의 유닛이 맵에서 사라진다.**
   *   `unplace(u)` 는 `grid[k] === u` 인 칸만 지우므로 그럴 일이 없다. */
  if (battle && battle.unplace) battle.unplace(u);       // 0x1DD9C → 0x1137A
  else if (battle && battle.setAt) battle.setAt(u.x, u.y, null);   /* 오래된 스텁 */
  return true;
}

/**
 * ★★★★★ **`0x11FF7` 대응 — 유닛이 그 진영의 활성 목록에 있는가** (2026-08-22 · GPT 25차)
 *
 *   원본 `0x11FF7(진영, 유닛)` 은 `dword[0xCC968 + 진영*8]` 부터 `+0x7B` 체인을
 *   따라가며 유닛 포인터를 찾는다 (`그리기계열_분석.md` §0x11FF7).
 *
 *   ★ 그 연결리스트에서 **빠지는 자리**를 전수로 떴다 — `call 0x1137A` **9곳**:
 *     `0x113CF` `0x1DD9C`(사망) `0x2B5F0` `0x2BCDC` `0x3B8E2` `0x3C2CE`
 *     **`0x52558`**(SCE 명령 — `eax = 0x5C968 + 진영*8 − 8`) `0x55231` `0x553F6`
 *
 *   ⇒ 리스트는 「**전투에 살아서 참가 중인 유닛**」이다. 죽거나 SCE 명령으로 나가면 빠진다.
 *
 *   ### 우리 JS 의 대응
 *
 *   | 원본 | 우리 |
 *   |---|---|
 *   | 리스트에 노드가 있다 | `battle.units` 에 있다 (죽어도 남으므로 아래를 함께 본다) |
 *   | 살아 있다 | `u.alive` |
 *   | **그 진영**의 리스트 | `(u.side|0) === 진영` — S4 가 진영을 바꿨으면 원래 진영엔 없다 |
 *
 *   ★ **맵 점유는 보지 않는다.** 칸을 잃는 것과 리스트에서 빠지는 것은 다른 일이다
 *     (GPT 25차 지적 — 전에 `battle.at()` 으로 대응했다가 불승인).
 *
 *   ★★★★★ **`0x52558` 은 SCE opcode `0x0C` 다** — 확정 (2026-08-30)
 *
 *     함수 머리는 **`0x52463`** 이고(`0x52558` 은 그 안쪽), 디스패처를 풀었다 —
 *
 *       0x52F54  al  = opcode
 *       0x52F58  ecx = 0x1B                    ; 27개
 *       0x52F5D  edi = 0x52DCF                 ; ★ **opcode 값 표**(27바이트)
 *       0x52F62  repne scasb                   ;   표에서 찾는다
 *       0x52F64  jmp [ecx*4 + 0x52DE9]         ; ★ **점프표**
 *
 *     `repne scasb` 는 찾으면 `ecx` 가 **남은 개수**가 된다 ⇒ 위치 = 26 − ecx.
 *     점프표[12] = `0x52FA2` → `call 0x52463` ⇒ 위치 14 ⇒ **opcode 0x0C**.
 *     검산: 점프표[15] = `0x52FD2` → `0x52940`(카메라) ⇒ **0x0F** — 맞는다.
 *     못 찾으면 ecx=0 → 점프표[0] = `0x52F01` = 다음 명령으로 계속.
 *     (전수표: `03_분석/COMBATII/SCE_명령_미지opcode_원본확정.md:410~`)
 *
 *   ★ `0x52463` 이 하는 일 — **진영 바꾸기**다
 *       0x52558  call 0x1137A              ; 원래 리스트에서 **뺀다**
 *       0x52567  al = [eax*2 + 0xFDAF6]    ;   표에서 새 진영 번호
 *       0x52571  [ecx + 0x0E] = al         ; ★ **진영**(+0x0E) 을 바꿔 넣는다
 *       0x52578  [esi + 0x0E] = al         ;   탈것/짝에도 같이
 *       0x52589  eax = 진영*8 − 8 + 0xCC968 ;   진영 리스트 표
 *       0x5258E  call 0x1134F              ; ★ **새 리스트에 넣는다**
 *
 *   ★ 실행기는 이미 배선돼 있다 — `sce_handlers.js:505` `붙(0x0C, …)`.
 *     퇴장 `0x04`(→ `0x51449`)는 여전히 미등록이다.
 */
/**
 * ★ **S4 앞의 진영을 캡처한다** — 원본 `0x1DB55 mov eax,[esp-0x3]` 에 해당.
 *   `사망전처리()` 를 부르기 **직전**에 잡아 두었다가 `사망후처리()` 에 넘긴다.
 */
function 사망진영(u) { return u ? (u.side | 0) : 0; }

function 진영목록에있나(battle, u, 진영) {
  if (!u) return false;
  if (!u.alive) return false;
  if (battle && battle.units && battle.units.indexOf(u) < 0) return false;
  if (진영 !== undefined && 진영 !== null && (u.side | 0) !== (진영 | 0)) return false;
  return true;
}

function consumeTurn(battle, u) {
  dequeueReady(battle, u);
  if (u) u.waitCount = 0;
  return u;
}

/**
 * 지금 플레이어가 조작할 수 있는 아군 전부 — 대기열 순서 그대로.
 *
 * 원본의 권위는 대기열이지만, 이 구현은 시험 코드가 `u.waitCount` 를 직접 세우는
 * 길도 열어 두므로 **한 번 맞춰 준 뒤** 돌려줍니다(대기열에 없는데 조건을 만족하면
 * 뒤에 붙이고, 조건이 깨진 것은 뺍니다). 원본 동작에는 영향이 없습니다 —
 * 0x19C18 을 거치면 언제나 대기열에 이미 들어 있기 때문입니다.
 */
function readyPlayerUnits(battle) {
  var q = queue(battle);
  for (var i = q.length - 1; i >= 0; i--) {
    var u = q[i];
    if (!u.alive || (u.waitCount | 0) !== READY || controlOf(battle, u) !== 'player') q.splice(i, 1);
  }
  battle.units.forEach(function (u) {
    if (!u.alive) return;
    if ((u.side | 0) !== 1) return;                    // 0x196D3
    if ((u.waitCount | 0) !== READY) return;
    if (controlOf(battle, u) !== 'player') return;
    if (q.indexOf(u) < 0) q.push(u);
  });
  return q.slice();
}

/** 0x19792 — 대기열이 비어 있지 않은가. */
function hasReadyPlayer(battle) { return readyPlayerUnits(battle).length > 0; }

/** 0x1979F — 대기열 i 번째 (없으면 null). */
function readyAt(battle, i) {
  var q = readyPlayerUnits(battle);
  return q[(i | 0)] || null;
}

/**
 * 세션 진입 가드 — `0x4D674` 0x4D680 ~ 0x4D6CA 를 그대로.
 * **「이번 차례인가」검사는 원본에 없습니다.** 대기열 순서와도 무관합니다.
 *
 * ```
 * 0x4D680  test [유닛+0x1E], 0x10 ; jne 0x4DB76   상태이상 bit4 → 그냥 돌아간다
 * 0x4D68D  test [유닛+0x14], 2    ; jne 0x4DB76   ★ 버서커(0x3BC17) → 손댈 수 없다
 * 0x4D697  cmp  [유닛+0x83], 1    ; jb  0x4D6B8   ★ AI 플래그가 0 이면 그냥 통과
 * 0x4D6A9  call 0x4D06E(x, y, 유닛)               AI 플래그가 서 있으면 **AI 링을 연다**
 * 0x4D6AE  cmp ax, 1 ; jne 0x4DB76                1 이 아니면 세션을 안 연다
 * 0x4D6B8  … 계속 (일반 세션)
 * ```
 * ★★ 예전엔 `0x4D697` 을 「AI 위임이면 못 연다」로 읽어 통째로 막고 있었다.
 *    실제로는 **AI 설정 링(0x4D06E)이 대신 열리고**, 거기서 사람 아이콘(0x0D)을
 *    고르면 `0x4D217` 이 `[+0x83] = 0` 으로 AI 를 풀고 1 을 돌려주어
 *    그대로 **일반 링으로 이어진다**. 그래서 AI 에 맡긴 아군은 클릭해서
 *    방침을 바꾸거나 조작권을 되찾을 수 있어야 한다.
 *
 * @returns {{ok:boolean, viewOnly:boolean, aiRing:boolean, reason:string}}
 *   ok:false      아예 못 엽니다
 *   aiRing:true   일반 링 대신 **AI 링부터** 엽니다 (0x4D6A9)
 *   viewOnly:true 링에 AI·스테이터스만 (조회 전용)
 */
function canCommand(battle, u) {
  if (!u || !u.alive) return { ok: false, viewOnly: false, aiRing: false, reason: '유닛 없음' };
  if ((u.ailment | 0) & 0x10)
    return { ok: false, viewOnly: false, aiRing: false, reason: '조작 불가 (0x4D680)' };
  /* 0x4D68D — [+0x14] bit1 = 버서커. 0x3BC17 이 세우고, 0x1D851·0x19FFC 도 같은 비트를 본다. */
  if (flags14(u) & 2)
    return { ok: false, viewOnly: false, aiRing: false, reason: '버서커 (0x4D68D)' };
  var aiRing = (u.ai && (u.ai.flag | 0)) >= 1;          // 0x4D697  cmp [+0x83], 1 ; jb
  /* 0x4D6BB / 0x4D6C1 — 대기가 0xFF 가 아니거나 AI Phase 면 조회 전용 */
  if ((u.waitCount | 0) !== READY)
    return { ok: true, viewOnly: true, aiRing: aiRing, reason: '행동 가능 아님' };
  if (battle.phase === PHASE.AI)
    return { ok: true, viewOnly: true, aiRing: aiRing, reason: 'AI Phase (0x4D6C6)' };
  return { ok: true, viewOnly: false, aiRing: aiRing, reason: '' };
}

/** 유닛의 [+0x14] 상태 비트 B — `move.js flags14` 와 같은 규칙. */
function flags14(u) {
  if (u.f14 != null) return u.f14 | 0;
  if (u._raw && u._raw['플래그14'] != null) return u._raw['플래그14'] | 0;
  return 0;
}

/* ─────────────────────────────────── 1-c. 페이즈 [0xF042E] */

function phaseCode(battle) { return PHASE_CODE[battle.phase] != null ? PHASE_CODE[battle.phase] : 0; }
function setPhase(battle, v) {                          // 0x19F9D
  battle.phase = (typeof v === 'number') ? (PHASE_NAME[v] || PHASE.RUN) : v;
  return battle.phase;
}

/**
 * 스페이스바 **누름** — 메인 루프 이벤트 코드 0x20 → `0x55B19`.
 * 페이즈가 0 이 아닐 때만 먹고, 0 으로 돌려 시간을 다시 흐르게 합니다.
 * (원본은 [0x789A4] 50틱 디바운스도 봅니다 — 그림 담당이라 여기엔 두지 않습니다.)
 * @returns {boolean} 실제로 풀렸는가
 */
/**
 * ★★★★★ **50 틱 쿨다운** — `[0x89A4]` (2026-08-26 · 원본 확정)
 *
 *   원본은 개입·재개 **양쪽 다** 50 틱(`0x32`)을 재운다 —
 *     0x19F81  mov eax, 0x32 / 0x19F8C call 0x1038B    ; 개입(ISR)
 *     0x55B35  mov eax, 0x32 / 0x55B3A call 0x1038B    ; 재개(메인 루프)
 *   그리고 **두 자리 다 들어가기 전에 `0x10392`(= `[0x89A4] == 0`)를 확인**한다 —
 *     0x19F5E  call 0x10392 / test ax,ax / je   ← 개입
 *     0x55B23  call 0x10392 / cmp ax,1  / jne   ← 재개
 *   없으면 키를 **누르고 있는 동안** 개입↔재개가 되풀이돼 화면이 깜빡인다
 *   (우리는 keydown 자동 반복이 같은 구실을 한다).
 *
 *   ★ 원본 틱은 `0x101F4` 타이머 ISR 이 재는 것이라 우리 `TICK_HZ` 와 다르다.
 *     쿨다운은 **시각(ms)** 으로 흉내 낸다 — 50 틱 ≈ 700 ms
 *     (원본 타이머는 초당 약 70 틱 — `모션_딜레이표.md`).
 */
var COOLDOWN_MS = 700;                                  // 0x32 틱 ≈ 700 ms
function 쿨다운중(battle) {                              // 0x10392
  var t = battle.__phaseCool | 0;
  if (!t) return false;
  var now = (typeof Date !== 'undefined') ? Date.now() : 0;
  if (now - t >= COOLDOWN_MS) { battle.__phaseCool = 0; return false; }
  return true;
}
function 쿨다운걸기(battle) {                            // 0x1038B (eax = 0x32)
  battle.__phaseCool = (typeof Date !== 'undefined') ? Date.now() : 1;
}

function resume(battle) {
  if (battle.phase === PHASE.RUN) return false;         // 0x55B1E  test ax,ax / je
  if (쿨다운중(battle)) return false;                    // 0x55B23  call 0x10392
  setPhase(battle, PHASE.RUN);                          // 0x55B30
  쿨다운걸기(battle);                                    // 0x55B3A
  battle.phaseBanner = false;                           // 0x55B41  [0x75008] = 0
  return true;
}

/**
 * 스페이스바 **누르고 있음** — 타이머 ISR `0x19F5D`.
 * 페이즈가 0 일 때만 먹고 2(Waiting) 로 만듭니다. 다음 `advance()` 가 3 으로 올립니다.
 */
function pause(battle) {
  if (쿨다운중(battle)) return false;                    // 0x19F5E  call 0x10392
  if (battle.phase !== PHASE.RUN) return false;         // 0x19F68
  setPhase(battle, PHASE.WAITING);                      // 0x19F86
  쿨다운걸기(battle);                                    // 0x19F8C
  battle.phaseBanner = true;                            // 0x19F96  [0x75008] = 1
  return true;
}

/* ───────────────────────────────────────────── 2. 시간 */

/** 시간 진행 — 0x197CA. 시각 0~15 를 한 칸 올리고, 8 이 되면 날짜 +1. */
function timeStep(battle) {
  battle.timeIdx = (((battle.timeIdx | 0) + 1) % 16 + 16) % 16;
  var newDay = false;
  if (battle.timeIdx === 8) { battle.dayIdx = (battle.dayIdx | 0) + 1; newDay = true; }
  return { timeIdx: battle.timeIdx, dayIdx: battle.dayIdx, newDay: newDay };
}

/** 시간이 흐르는 주기 — 0x19D9C. [0xBA84E] 가 4·5 면 30턴, 아니면 900턴. */
function timePeriod(battle) {
  var k = battle.battleKind != null ? (battle.battleKind | 0)
        : (battle.S && (battle.S['페이즈'] | 0)) || 0;
  return (k === 4 || k === 5) ? 30 : 900;
}

/** 하단 턴 게이지 눈금 개수 — 0x44EB0. 좌우 대칭이라 화면엔 이 개수가 양쪽에. */
function gaugeTicks(battle) {
  var N = (battle.turnPeriod | 0) || 2;              // [0x74138] GAME.CFG byte3
  return idiv(((battle.turn | 0) % N) + 1, 2);
}

/* ───────────────────────────────────────────── 3. 라운드 시작 일괄 처리 */

/**
 * 0x19AEF — 진영 0~3 전 유닛을 훑습니다.
 *   ① 직업 0xA2 는 건너뜀 (0x19B2C)
 *   ② [+0x56] 이 0xFF 가 아니면 +1, 직업표 기준([0x71B6E + 직업*8])에 닿으면
 *      0xFF 로 세우고 [+0x14] &= ~4 · [+0x13] = 0 · [+0x64] = 0
 *      ([+0x15]&0x10 둔화면 기준 ×2/3+1, [+0x14]&2 가속이면 기준 /2)
 *   ③ [+0x15] & 0x40 이면 [+0x1E] 하위 3비트를 지움 (0x19C23)
 *   ④ [+0x1E] != 0 이면 도트 피해 (0x1992D)
 *   ⑤ 잔여 턴 감소 (0x19892)
 *   ⑥ [+0x56] == 0xFF 인 유닛만 지형 피해 (0x19C63 → 0x17310)
 */
function unitPass(battle, opts) {
  opts = opts || {};
  var Ru = R(), T = battle.T;
  var ready = [], hurt = [], died = [];
  /* ★ 통합 2-c — opts.사망유예 일 때만 찬다. 컨트롤러가 S4 뒤에 사망마무리() 한다 */
  var 사망예정 = [];
  for (var si = 0; si < 4; si++) {
    listOf(battle, si).forEach(function (u) {
      if (!u.alive) return;
      if (u.job === 0xA2) return;                          // 0x19B2C
      var s = shimOf(u);
      var wasReady = (s.wait === READY);
      if (Ru && Ru.readyTick) {
        if (Ru.readyTick(s, T) && !wasReady) {
          ready.push(u);
          u.motion = 0;                          // 0x19BA0  [+0x64] = 0 — 대기 모션 처음부터

          /* ★★★★★ **0x19BA4 ~ 0x19BFE — 「빈사 각성」** (2026-09-09 신설)
           *
           *   직업표 **열 8**(`0x73B5F`)이 1 인 직업이 **현재 HP < 최대 HP ÷ 2** 이면,
           *   차례가 온 그 순간 **스스로 버프를 건다.**
           *
           *   ```asm
           *   0x19BA4  cmp byte [직업×9 + 0x73B5F], 1 ; jne 0x19C01
           *   0x19BAD  eax = [+0x4C](최대HP) ; edx = [+0x48](현재HP)
           *   0x19BB3  sar eax, 1
           *   0x19BB7  jle 0x19C01                    ; ★ 최대÷2 <= 현재 면 건너뛴다
           *   0x19BB9  [+0x18] = 30                   ; 칸1 — 파워업
           *   0x19BC2  [+0x1A] = 30                   ; 칸2 — 스피드업
           *   0x19BC8  [+0x15] |= 0x18                ;   두 비트를 한꺼번에
           *   0x19BCB  eax = ebp(=3 · 0x19B03) ; call 0x499BD   ; ★ rand(3)
           *   0x19BD8  je 0x19BEB                     ;   0 이면 아래로
           *   0x19BDD  [+0x1C] = 30 ; [+0x15] |= 0x40 ;   ≠0 (2/3) → 블레스
           *   0x19BEB  cmp word [+0x61], 0x12C ; jge 0x19C01    ;   0 (1/3) & NC2 사람형이면
           *   0x19BF6  [+0x1C] = 30 ; [+0x15] |= 0xE0 ;     매직아머+블레스+배리어 통째로
           *   ```
           *
           *   ★ 지속 **30** 은 지속 표 `0x74488` 의 **색인 0** 값이다
           *     (`T['상태이상지속'][0]` · 마법으로 거는 40·50·60 보다 짧다).
           *   ★ 비트 ↔ 칸 대응은 해제 마스크 `0x74139` = `F8 F7 EF 1F` 에서 나온다 —
           *     `applyBuffBit` 이 그 대응을 들고 있으므로 **비트별로 따로** 부른다
           *     (`0x18` 을 한 번에 넘기면 가장 낮은 비트의 칸 하나만 서고 만다).
           *   ★ 걸리는 직업 11개 — Death lord · Dragon knight · Dragon slayer ·
           *     Gradiater · Valkyrie · Warrior · Berserker · Genoicider · Tusa ·
           *     Martial Arts · Grima.
           *   자세히는 `03_분석/COMBATII/상태이상_원본확정.md` §4-1-A. */
          var 패 = ((T['직업'] && T['직업'][u.job]) || {})['패시브특성'];
          if (패 && (패[8] | 0) === 1
              && ((s.maxHp | 0) >> 1) > (s.hp | 0)          // 0x19BB3 · 0x19BB7
              && Ru.applyBuffBit) {
            var 지속 = ((T['상태이상지속'] || [])[0]) | 0;   // 0x74488[0] = 30
            Ru.applyBuffBit(s, 0x08, 지속);                 // 0x19BB9 칸1 파워업
            Ru.applyBuffBit(s, 0x10, 지속);                 // 0x19BC2 칸2 스피드업
            var 뽑기 = (battle.rng ? battle.rng(3) : 0) | 0; // 0x19BCB rand(3) · ebp=3
            if (뽑기 !== 0) Ru.applyBuffBit(s, 0x40, 지속);  // 0x19BDD 블레스
            else if ((!isMagicEffectExcluded(u)))            // 0x19BEB 그래픽 ID < 300 = NC2
              Ru.applyBuffBit(s, 0xE0, 지속);               // 0x19BF6 매직아머+블레스+배리어
          }

          /* 0x19B8B 로 [+0x56] 이 0xFF 가 된 직후 — 0x19C01 이 조작 가능한
           * 아군이면 0x196D0 으로 **행동 가능 대기열에 넣습니다**. */
          if ((u.side | 0) === 1 && (!(u.ai && (u.ai.flag | 0))) && !((s.f1e | 0) & 0x10))
            enqueueReady(battle, u);
        }
      }
      if (s.f15 & 0x40) s.f1e &= 0xF8;                     // 0x19C23
      var dot = 0;
      if (s.f1e !== 0 && Ru && Ru.dotDamage) {
        /* ★ 0x19942 — 저주가 걸려 있으면 **1분(=대기시간 10)마다 상태이상이
         *   하나 더 붙는다.** 도트보다 **먼저** 돈다(0x1992D 진입 직후).
         *   판정에 쓰는 값은 `[+0x25]` = 저주 자신의 남은 지속(칸[3])이다. */
        if (Ru.curseTick) {
          var 새상태 = Ru.curseTick(s, battle.rng || null);   // 0x19958~0x1999F
          if (새상태) hurt.push({ unit: u, curse: 새상태 });
        }
        /* ★★ `0x1992D` 앞부분 — **행동 봉쇄 갈래**. 예전엔 도트 피해만 옮겨
         *   두고 이쪽을 통째로 빼먹었다.
         *
         *   ```asm
         *   0x199A2  al = [+0x1E]
         *   0x199A5  test al, 2 ; je 0x199AF     ; ★ 빙결
         *   0x199A9    [+0x56] = 0               ;   대기 카운터를 **0 으로 못 박는다**
         *   0x199AD    jmp 0x199CC               ;   → 차례가 영영 안 온다
         *   0x199AF  test al, 4 ; je 0x199CC     ; 마비
         *   0x199B3    test [+0x1F], 1 ; je      ;   지속이 **홀수**일 때만
         *   0x199B9    dh = [+0x56] ; 0 이하·0xFF 면 건너뜀
         *   0x199C7    dec dh ; [+0x56] = dh     ;   대기 카운터 1 되돌림
         *   0x199CC  cmp [+0x56], 0xFF ; jne     ; ★ 아직 대기 중이면
         *   0x199D2    return −1                 ;   **도트도 안 낸다**
         *   ```
         *
         *   사용자 물음 2026-08-14: 「빙결의 경우 풀리는 시간도 있을 거고,
         *   맞아도 풀려.」 — **맞아야 풀립니다.** `[+0x1F]` 를 깎는 코드가 EXE 에
         *   한 곳도 없다(대입만 10곳). 아래 「해제」 참조. */
        if (s.f1e & 2) { s.wait = 0; }                     // 0x199A9  빙결 — 차례 안 옴
        else if ((s.f1e & 4) && ((s.st.d1e[0] | 0) & 1)) { // 0x199AF  마비 — 지속 홀수
          var w = s.wait | 0;                              // 0x199B9
          if (w > 0 && w !== READY) s.wait = w - 1;        // 0x199C7
        }
        /* 0x199CC → 0x199D2 `return −1` — **도트만** 안 낸다.
         * ★ 여기서 함수 전체를 빠져나오면 안 된다. 호출부 `0x19C3D cmp ax,1 ; jne
         *   0x19C5C` 가 −1 을 받아도 **⑤ 잔여 턴 감소 `0x19892` 로 그냥 간다.**
         *   (한 번 `return` 으로 막았다가 지속이 안 깎여 빙결이 영영 안 풀렸다 —
         *    2026-08-14 자체 발견) */
        if (s.wait === READY) {
          dot = Ru.dotDamage(s, T) | 0;                    // 0x199DC~  HP×100
          if (dot) {
            /* ★ **감산 순간마다** 이전/이후 HP 를 남긴다 — 통합 2-c 2단계
             *   GPT 11차: 「HP 100·독 10·지형 20 이면 지형 보고는
             *   `100→70` 이 아니라 **`90→70`** 이어야 한다」
             *   ★ 독은 원본 대응이 아직 **미확인**이라 `원본경계: null` 이다. */
            var 독전 = s.hp | 0;
            s.hp -= dot;
            hurt.push({ unit: u, dot: dot, 이전HP: 독전, 이후HP: s.hp | 0,
                        까닭: '독', 원본경계: null });
          }
        }
      }
      if (Ru && Ru.tickDurations) Ru.tickDurations(s, T);  // 0x19892
      var terr = 0;
      if (s.wait === READY && Ru && (Ru.지형효과 || Ru.terrainDamage)
          && !((s.f15 | 0) & 0x80)) {          // ★ 0x17316 — 배리어면 지형 피해 없음
          /* ★★★★★ **배리어면 지형 피해를 안 받는다** — 0x17316 (2026-09-08 · 사장님 지적)
           *
           *   > 사장님: 「배리어 효과가 적용되면 … **지형에서 받는 데미지도(용암같은)**
           *   >  전부 안들어가. **원본 로직 살펴봐서 그대로 적용**해야해.」
           *
           *   원본 `0x17310`(지형 피해)의 **첫 두 줄**이 이 가드다 —
           *   ```asm
           *   0x17316  test byte [eax+0x15], 0x80   ; ★ 배리어
           *   0x1731A  jne  0x17477                 ; ★★ 곧장 함수 끝 — 아무 일도 안 한다
           *   ```
           *   ★ 이 함수는 **음수 값(= 지형 회복)도** 지나므로 배리어면 그것도 안 받는다.
           *   ☐ `0x17320 test [+0x14], 1` 은 안 넣었다 — 우리 `f14` 비트0 은 비행이라
           *     그대로 넣으면 비행 유닛이 지형 피해에서 빠진다. 뜻을 확인한 뒤에 넣는다.
           *   전수 근거 — `03_분석/COMBATII/상태이상_원본확정.md:280` (17곳 전수 분류) */
        var tile = battle.tile(u.x, u.y);
        /* [리마스터] 용자의 무덤 가시는 라운드 시작(도트)에는 안 깎는다 — 이동을 끝낼 때만(controller _지형피해) (2026-10-12)
         *   사장님(원문) 「창1에서는 가시밭에서 이동을 확정하면 피격 효과가 뜨고 데미지를 직접 입어. 도트데미지처럼 달지는 않고」 ·
         *   「가시 데미지방식 변경하면서 기존 도트방식은 적용 안되는거지?」 — 무덤판(battle.무덤가시배 · battle_main 무덤층유닛규칙)의 값 10 만 */
        if (tile && battle.무덤가시배 && (tile['값'] | 0) === 10) tile = null;
        if (tile) {
          /* ★★★★★ **「대상인가」와 「얼마인가」를 갈라 본다** (2026-08-22 · GPT 15차)
           *   원본 `0x17310` 은 면제·비대상이면 `0x17477` 로 **일찍 빠지지만**,
           *   유효 지형이면 **계산 결과가 0 이어도** `0x173EB call 0x53797`(S4)까지
           *   간다. 전에는 `if (terr)` 로 0 이면 아무것도 안 했다 — **원본과 달랐다.**
           *   ★ `값` 은 **음수일 수 있다**(상성 합계가 음수 = 회복).
           *     `0x173E2 sub edx, esi` 는 `esi` 가 음수면 더하기다. */
          var 효과 = Ru.지형효과 ? Ru.지형효과(s, tile['값'] | 0, T, { 가시배: battle.무덤가시배 })   /* [리마스터] 무덤 진한 가시 2배 */
                                 : { 대상: !!Ru.terrainDamage(s, tile['값'] | 0, T),
                                     값: Ru.terrainDamage(s, tile['값'] | 0, T) | 0 };
          terr = 효과.값 | 0;
          if (효과.대상) {
            /* ★★★★★ **S4 경계 `0x173EB`** — 통합 2-c 2단계 (2026-08-22)
             *   원본은 지형 피해를 깎은 **바로 그 자리**에서 S4 를 검사한다:
             *     0x173E2  sub edx, esi          ; 감산
             *     0x173E6  mov [ecx+0x48], edx   ; ★ 이 한 줄이 아래다
             *     0x173E9  xor edx, edx          ; ★ **주체 없음**
             *     0x173EB  call 0x53797 (eax=ecx=그 유닛, ebx=1)
             *   ★ 독을 이미 깎은 **뒤** 값이 이전HP 다 (GPT 11차). */
            var 지형전 = s.hp | 0;
            s.hp -= terr;
            hurt.push({ unit: u, terrain: terr, 이전HP: 지형전, 이후HP: s.hp | 0,
                        까닭: '지형', 주체유닛: null, 원본경계: '0x173EB' });
          }
        }
      }
      writeBack(u, s);
      /* ★★★★★ **사망 유예** — 통합 2-c 2단계 (2026-08-22 · GPT 14차)
       *
       *   원본 `0x17310` 은 **S4 를 먼저** 부르고 그 다음 사망 처리한다:
       *     0x173EB  call 0x53797     ; ★ S4
       *     0x17451  cmp [ecx+0x48],0
       *     0x17455  jg  → 살아 있으면 1 반환
       *     0x1745B  call 0x1DB1D     ; ★ **사망 처리는 뒤**
       *
       *   ★ 우리는 S4 가 **비동기**(연출)라 여기서 바로 죽이면 순서가 뒤집힌다.
       *     GPT 14차: 「사망 유예는 나중에 해도 되는 개선이 아니라
       *     **2-c 지형 단계의 완료 조건**이다」
       *
       *   ⇒ `opts.사망유예` 가 켜지면 **예정만 남기고** 실제 제거는
       *     `사망마무리()` 를 부르는 쪽(컨트롤러)이 S4 뒤에 한다.
       *     ★ 플래그를 안 주면 **예전 그대로** 즉시 죽는다(호환). */
      if (u.hp <= 0 && u.alive) {
        if (opts.사망유예) { 사망예정.push(u); }
        else { 사망마무리(battle, u); died.push(u); }
      }
    });
  }
  /* ★★★★★ **라운드 끝 전체 진영 후처리** — `0x19D3A → 0x1ED90` (2026-08-22 · GPT 21차)
   *
   *   원본은 유닛별 지형 S4(`0x173EB`)를 다 돌린 **뒤**, `0x19AEF`(라운드 시작
   *   일괄 처리)의 **끝**에서 한 번 더 훑는다:
   *
   *     0x19D38  xor eax, eax        ; 기준 진영 값 **0**
   *     0x19D3A  call 0x1ED90        ; ★ 전체 진영 후처리
   *     0x19D42  jmp 0x196C9         ; 0x19AEF 반환
   *
   *   `0x1ED90` 은 `edi` 를 **0~3 전부** 돌며(`0x1EE15 cmp di,4 / jl`)
   *   진영 연결리스트(`[edi*8+0xCC968]`)를 훑어:
   *     · HP > 0  → `0x1EE0B call 0x53797` **S4**
   *     · HP ≤ 0  → `0x1EDFD call 0x1DB1D` **사망 처리**
   *
   *   ★★★ GPT 21차: 「같은 라운드에 `0x173EB` 와 `0x1EE0B` 가 둘 다 발생한다.
   *     **중복 버그가 아니라 원본 호출 경계가 둘인 것**이다.
   *     발동표가 재발동을 막을 수 있지만 **창구 호출 자체를 합치면 안 된다**」
   *
   *   ★ 여기서는 **계획만** 돌려준다 — 컨트롤러가 직렬로 S4 를 걸고 기다린다.
   *     (`turn.js` 는 순수 계산층이라 `SceRuntime` 을 모른다) */
  var 라운드끝후처리 = null;
  /* ★★★★★ **이번 라운드에 독·지형 피해를 받은 유닛이 없으면 통째로 건너뛴다** (2026-10-10 · CD COMBATII 직독)
   *   0x19C40  cmp word [0xF0B9E], 0 ; je 0x19CFD   ; 피해 목록 수가 0 이면 흔들기·숫자(0x45ED7·0x45C79)·0x12124 와
   *   0x19CF8  call 0x1ED3E                          ;   ★ 이 라운드 S4 를 «함께» 건너뛴다
   *   ☠ 전엔 매 라운드 살아 있는 전원에게 S4 를 불러, HP 모드 0(무조건) 레코드가 시작하자마자 떴다
   *   (16-2 S4#0 라시드 「내가 이 피라미드에 들어올 자격이 없다고…」 + 크리티컬 평타 · 사장님 「갑자기 허공에 칼 휘두르고 라시드가 대사를 하는데 이거 아니야」 · 「저게 시작하자 마자 나온다고」) */
  var 피해수 = hurt.filter(function (h) { return h && h.이전HP != null; }).length;
  if (opts.라운드끝후처리 && 피해수 > 0) {
    var 훑을것 = [];
    /* ★ 원본 순서 — 진영 0 → 1 → 2 → 3, 각 진영은 연결리스트 차례 */
    for (var si2 = 0; si2 < 4; si2++) {
      battle.units.forEach(function (u2) {
        if (!u2) return;
        if (((u2.side | 0) - 1) !== si2) return;      /* side 는 1-기준 */
        훑을것.push({ 유닛: u2, 진영idx: si2,
                      생존: (u2.hp | 0) > 0 && !!u2.alive });
      });
    }
    라운드끝후처리 = { 기준진영: 0, 대상: 훑을것, 원본경계: '0x1EE0B' };
  }

  return { ready: ready, hurt: hurt, died: died,
           /* ★ `opts.사망유예` 일 때만 찬다 — 컨트롤러가 S4 뒤에 `사망마무리()` 한다 */
           사망예정: 사망예정,
           /* ★ `opts.라운드끝후처리` 일 때만 찬다 — `0x19D3A → 0x1ED90` */
           라운드끝후처리: 라운드끝후처리 };
}

/**
 * ★★★★★ **시각을 올린다** — 0x19D9C ~ 0x19DD2 (2026-09-01)
 *
 *   원본은 **턴을 올린 바로 다음 줄**에서 이것을 한다. 주기가 전투 종류로 갈린다:
 *   ```asm
 *   0x19D9C  bl = [0xBA84E]              ; 전투 종류
 *   0x19DA2  cmp bl, 4 / je  0x19DAC
 *   0x19DA7  cmp bl, 5 / jne 0x19DC0
 *   0x19DAC  ebx = 0x1E(30)   ; eax = [0xF0418](턴) ; div ebx   ; ★ 종류 4·5
 *   0x19DC0  ebx = 0x384(900) ; eax = [0xF0418](턴) ; div ebx   ; ★ 그 밖
 *   0x19DCE  test edx,edx / jne 끝                              ;   나머지 0 일 때만
 *   0x19DD2  call 0x197CA                                       ; ★ 시각 +1
 *   ```
 *   그리고 `0x197CA` 가 하는 일:
 *   ```asm
 *   0x197D1  dl = [0xFDF84] ; inc edx ; ecx = 16 ; idiv ecx
 *   0x197E4  [0xFDF84] = dl              ; ★ 0~15 순환
 *   0x197EA  cmp dl, 8 / jne / inc [0xFDF82]   ; ★ 8 이 될 때마다 날짜 +1
 *   ```
 *   ☠ **900 턴은 사실상 안 온다** — 일반 전투에서 900 턴은 나오지 않는다.
 *     ⇒ 시각이 실제로 도는 것은 **전투 종류 4·5** 뿐이다. 원본이 그렇다.
 *   ★ `hud.js:352` 주석이 「모드 4·5 의 제수 **10** 은 시간 인덱스를 올리는
 *     제수 **30** 과 3배 어긋납니다」라고 적어 두었다 — **그 30 이 이것**이다.
 */
function 시각올리기(battle) {
  var 종류 = battle.battleKind | 0;                   // [0xBA84E] — state.js:1106
  var 주기 = (종류 === 4 || 종류 === 5) ? 30 : 900;    // 0x19DAC · 0x19DC0
  if (((battle.turn | 0) % 주기) !== 0) return;        // 0x19DBA · 0x19DCE
  battle.timeIdx = (((battle.timeIdx | 0) + 1) % 16);  // 0x197D7 · 0x197E4
  if ((battle.timeIdx | 0) === 8)                      // 0x197EA
    battle.dayIdx = (battle.dayIdx | 0) + 1;           // 0x197EF
}

/** 라운드 머리 — 0x19D91 ~ 0x19DFD (턴 증가는 부르는 쪽이 이미 했다고 봅니다). */
function roundStart(battle, opts) {
  var out = { turn: battle.turn | 0, time: null };
  if (((battle.turn | 0) % timePeriod(battle)) === 0) { out.time = timeStep(battle); battle.시각흐름 = true; }   /* 0x197CA — 한 번 흐른 뒤로 밝기(0x197F6 → [0xF042C])를 팔레트 낼 때마다 곱한다 · battle_main 색조 (사장님 11-09 「시간 밝기 변화는 … 있으면 넣어」) */
  var p = unitPass(battle, opts);
  out.ready = p.ready; out.hurt = p.hurt; out.died = p.died;
  /* ★ 통합 2-c — 사망 유예를 켰으면 컨트롤러가 S4 뒤에 `사망마무리()` 한다 */
  out.사망예정 = p.사망예정;
  /* ★ 통합 2-c — 라운드 끝 전체 진영 후처리 계획 (`0x19D3A → 0x1ED90`) */
  out.라운드끝후처리 = p.라운드끝후처리;
  out.gauge = gaugeTicks(battle);
  return out;
}

/* ───────────────────────────────────────────── 4. 바깥으로 내보내는 흐름 */

/**
 * 전투 시작. 원본은 [0xF0418] 이 0 인 상태로 들어와 첫 바퀴에 1 로 올립니다.
 *
 * ── 원본의 첫 턴 TP 를 확인했습니다 (임무 ①) ─────────────────────────────
 *
 * `.SCE` 파일의 [+0x56] 값이 무엇이든 **로더가 0 으로 덮습니다**.
 *   `0x4F070  mov byte ptr [ebp + 0x56], 0`     ← SCE 유닛 로더
 * 그리고 [+0x56] 에 0xFF(행동 가능) 를 넣는 곳은 EXE 전체에서 **딱 한 군데**,
 * 라운드 시작 처리 0x19AEF 안의 `0x19B8B  mov byte ptr [ebx+0x56], 0xff` 뿐입니다
 * (`mov [reg+0x56], …` 전수 검색으로 확인). 전투 시작 시 일괄로 세우는 코드는 없습니다.
 *
 * 그래서 원본의 실제 동작은 이렇습니다.
 *   · 턴 1 에는 **아무도 행동 가능이 아니고 TP 도 전부 0** 입니다.
 *   · 매 라운드 0x19AEF 가 [+0x56] 을 +1 하고, 직업표 `0x71B6E` 의 재행동 대기 한계에
 *     닿으면 0xFF 로 세웁니다 (Magician 5 · Archer 7 · Fighter 8 · Knight/Soldier 11 ·
 *     Paladin/Lancer/Brown Horse 12 · Carrier 15).
 *   · 아무도 행동하지 못한 라운드는 0x19EB7 이 1 을 돌려주고 메인 루프 0x5580F 가
 *     **곧바로 다음 바퀴**를 돕니다. 한 프레임에 한 라운드라 화면상으론 순식간입니다.
 *   · TP 는 그 유닛이 실제로 행동을 시작할 때 채웁니다 (0x44943 / 0x4D6F0 → 0x19FAB).
 *
 * 지금까지 `begin()` 은 라운드 머리 **한 번**만 돌고 멈춰서, 아무도 0xFF 가 되지 못하고
 * TP 도 영영 0 이었습니다. 그래서 여기서 원본 메인 루프가 하는 "아무도 못 움직이면
 * 다음 라운드" 를 **미리 돌려** 첫 행동 가능 유닛이 나올 때까지 진행시킵니다.
 * 그리고 그 라운드에 행동 가능해진 유닛들의 TP 를 채웁니다 — 원본이 행동 직전에
 * 채우는 것과 **값이 같습니다**(같은 라운드 안이라 상태가 안 바뀝니다). 이중 충전은
 * `_tpTurn` 으로 막아 `0x19FE6`(권 '기' 비트 소모) 같은 1회성 처리가 두 번 먹지 않습니다.
 *
 * @param {object} [opts] { settle:true, settleAll:false, maxRounds:512, rng }
 *   settle    누군가 행동 가능해질 때까지 라운드를 진행 (기본 true, 원본 동작)
 *   settleAll 살아 있는 유닛이 **전부** 행동 가능해질 때까지 (검증·디버그용)
 * @returns roundStart 결과 + { rounds, ready }
 */
function begin(battle, opts) {
  opts = opts || {};
  /* 0x19652 — 전투 시작 초기화. 대기열도 여기서 비웁니다(0x19658 ~ 0x196C3). */
  battle.turn = 1;                                   // [0xF0418] 0 → inc → 1
  battle.sideIdx = 0;                                // [0xF0424]
  battle.phase = PHASE.RUN;                          // [0xF042E] = 0
  battle.phaseBanner = false;                        // [0x75008] = 0
  battle.readyQueue = [];                            // [0xF041C]/[0xF0414]/[0xF0426]
  battle._cursor = 0;                                // [0xF0410] 리스트 위치
  battle._acted = false;                             // [0xF0420]
  battle._inRound = false;                           // [0xF0422]  ★ 순회 전이므로 0
  battle.units.forEach(function (u) { u._tpTurn = null; });

  var head = roundStart(battle);
  var settle = opts.settle !== false;
  var guard = opts.maxRounds != null ? (opts.maxRounds | 0) : 512;
  while (settle && guard-- > 0 && !readyCount(battle, !!opts.settleAll)) {
    head = endRound(battle, opts);                   // 0x19EB7 이 1 → 다음 바퀴
  }
  chargeReady(battle, opts.rng);
  head.rounds = battle.turn | 0;
  head.ready = battle.units.filter(function (u) {
    return u.alive && (u.waitCount | 0) === READY;
  });
  head.charged = head.ready.map(function (u) { return { unit: u, tp: u.tp | 0 }; });
  return head;
}

/** settleAll 이면 "살아 있는 전원", 아니면 "한 명이라도" 행동 가능한지. */
function readyCount(battle, all) {
  var live = battle.units.filter(function (u) { return u.alive; });
  var n = live.filter(function (u) { return (u.waitCount | 0) === READY; }).length;
  return all ? (n > 0 && n === live.length) : n > 0;
}

/**
 * 지금 행동 가능한 유닛들의 TP 를 채웁니다.
 * 원본은 0x44943 / 0x4D6F0 이 행동 직전에 한 명씩 채우지만, 같은 라운드 안에서는
 * 입력이 안 바뀌므로 값이 같습니다. `_tpTurn` 으로 라운드당 한 번만 먹입니다.
 */
function chargeReady(battle, rng) {
  var out = [];
  battle.units.forEach(function (u) {
    if (!u.alive) return;
    if ((u.waitCount | 0) !== READY) return;
    if (u._tpTurn === battle.turn) return;
    u._tpTurn = battle.turn;
    out.push({ unit: u, tp: recharge(battle, u, rng) });
  });
  return out;
}

/**
 * **저수준 순회 커서** — 0x19E19 ~ 0x19EA9 한 걸음.
 *
 * ★ 이제 이것이 「이번 차례 유닛」을 내주는 창구가 아닙니다.
 *   원본 턴 관리자는 플레이어 유닛을 **건너뛰므로**(0x19E63) 관리자 입장의
 *   올바른 호출은 `next(battle, {skipPlayer: true})` 이고, 그 일은 `advance()` 가 합니다.
 *   `skipPlayer:false` 는 「전원 AI」 검증(combat.test.js)용 편의로 남겨 둡니다.
 *
 * @param {object} [opts] { skipPlayer:false }
 * @returns {{unit, side, control, tp}|null}  null 이면 이번 라운드 순회 끝
 */
function next(battle, opts) {
  opts = opts || {};
  while ((battle.sideIdx | 0) < 4) {
    var list = listOf(battle, battle.sideIdx);
    var i = battle._cursor | 0;
    while (i < list.length) {
      var u = list[i]; i++;
      battle._cursor = i;
      if (!u.alive) continue;
      var ctrl = controlOf(battle, u);
      if (ctrl === 'player' && opts.skipPlayer) continue;   // 0x19E63
      if ((u.waitCount | 0) !== READY) continue;            // 0x19E6A
      /* 0x44943 / 0x4D6F0 — 행동을 시작하면 대기를 0 으로 되돌리고 TP 를 채웁니다.
       * 이 라운드에 이미 채웠으면(begin/endRound 의 chargeReady) 다시 안 채웁니다 —
       * 0x19FE6 의 `[+0x13] & 0x80 → TP 250` 같은 1회성 처리가 두 번 먹지 않게.
       *
       * ★★ `deferBegin` — **행동 가능 마커(ETC.ICO)가 한꺼번에 사라지던 원인.**
       *   원본은 AI 를 순회 **안**(0x19E6F → 0x44913)에서 그 자리에서 부르므로
       *   `[+0x56] = 0` 은 **그 유닛이 행동을 시작하는 순간** 걸립니다. 그래서
       *   차례가 온 전원에게 마커가 같이 뜨고 **행동하는 순서로 하나씩** 사라집니다.
       *   우리 AI 는 연출을 기다려야 해서 컨트롤러가 나중에 돌리는데, 여기서
       *   전원 것을 미리 0 으로 만들어 **마커가 동시에 사라졌습니다.**
       *   이 갈래에서는 미뤄 두고 `beginUnit()`(= 0x44943)을 컨트롤러가 부릅니다.
       *   순회 진행은 `battle._cursor` 가 하므로 이 값이 없어도 같은 자리를
       *   두 번 고르지 않습니다. */
      if (!opts.deferBegin) u.waitCount = 0;
      var tp;
      if (u._tpTurn === battle.turn) { tp = u.tp | 0; }
      else { u._tpTurn = battle.turn; tp = recharge(battle, u, opts.rng); }
      battle._acted = true;                                 // [0xF0420] = 1
      return { unit: u, side: u.side | 0, control: ctrl, tp: tp };
    }
    battle.sideIdx = (battle.sideIdx | 0) + 1;              // 0x19EA2
    battle._cursor = 0;
  }
  return null;
}

/**
 * TP 충전 — 0x19FAB.
 * ```
 * 0x19FB0  [+0x1E] & 0x40 → TP = 최대TP × 70/100,  그 밖 → TP = 최대TP
 * 0x19FE6  [+0x13] & 0x80 → 비트 지우고 TP = 250            ; 권 '기'
 * 0x19FFC  [+0x14] & 2    → TP += 60                        ; 스피드업
 * 0x1A00A  시간대 [0xBA84D] 1 → ×0.75 · 4 → ×0.667
 *                           3 → rand(3) != 0 이면 ×0.75, 0 이면 ×1.25
 * 0x1A08A  TP = max(TP, 55)
 * ```
 * `Rules.tpRecharge` 를 쓰지 않고 여기서 다시 쓴 이유는 하나뿐입니다 —
 * 그쪽은 최대TP 를 직업표(0x71B6C + 직업*8 + 민첩)로 **다시 계산**하는데,
 * state.js 는 "`.SCE` 값이 이미 장비까지 반영된 최종값"이라는 원칙(0x181A6 의
 * 호출부에 SCE 로더가 없음)으로 `u.eff.maxTp` 를 씁니다. 이올린이 105 냐 115 냐가
 * 여기서 갈립니다. 나머지 단계는 위 주소 그대로입니다.
 */
function recharge(battle, u, rng) {
  var Ru = R();
  rng = rng || (Ru && Ru.makeRng ? Ru.makeRng() : function (n) { return 0; });
  var maxTp = (u.eff && u.eff.maxTp != null) ? (u.eff.maxTp | 0) : (u.rawMaxTp | 0);
  var tp = ((u.ailment | 0) & 0x40) ? idiv(maxTp * 70, 100) : maxTp;   // 0x19FB0
  if ((u.stance | 0) & 0x80) { u.stance &= 0x7F; tp = 250; }           // 0x19FE6
  if ((u.f14 | 0) & 2) tp += 60;                                       // 0x19FFC
  var tod = battle.timeOfDay != null ? (battle.timeOfDay | 0)
          : (battle.S && (battle.S['날씨'] | 0)) || 0;
   /* [0xBA84D] = .SCE 0x04 (날씨) */
  if (tod === 1) tp = tp - idiv(tp, 4);                                // 0x1A00A
  else if (tod === 3) tp = (rng(3) !== 0) ? tp - idiv(tp, 4) : tp + idiv(tp, 4);
  else if (tod === 4) tp = tp - idiv(tp, 3);
  if (tp < 55) tp = 55;                                                // 0x1A08A
  /* ☠ [+0x84](분신 2 · 빙룡 4 · [리마스터] 화룡 8)는 여기서 지우지 않는다 — 원본 TP 충전(0x19F..~0x1A0EF)에는 [+0x84] 쓰기가 없고,
   *   쓰는 자리는 0x11440·0x4EC2A(유닛 세우기)·0x4F07B(재배치) 셋뿐이다 ⇒ **한 전투에 한 번** (2026-09-26 사장님 「빙룡소환은 원작에서 해당 전투에서 1회만 사용할수 있어」)
   *   예전에는 행동마다 0 으로 지워 몇 번이고 쓸 수 있었다 */
  u.tp = tp;
  u._tp충전값 = tp;          /* session.js — 안 쓰고 다시 열면 원본처럼 다시 충전(0x4D6FB · 바람 재굴림) */
  return tp;
}

/**
 * 한 유닛 **행동 시작** — `0x44943`.
 *
 * 원본이 AI 유닛 하나를 잡고 `0x44913` 으로 들어갈 때 거는 것입니다.
 * ```
 * 0x44943  mov byte [유닛+0x56], 0     ; 대기 해제 = 행동 가능 마커가 사라짐
 * ```
 * 마커를 그리는 `0x12240` 이 `[+0x56] == 0xFF` 만 그리므로, 이 한 줄이
 * 「차례가 온 전원에게 뜨고 행동 순서대로 하나씩 사라지는」 동작을 만듭니다.
 * 우리 구현은 순회와 실행이 떨어져 있어(`next({deferBegin:true})`) 컨트롤러가
 * 각 AI 행동 **직전**에 부릅니다.
 */
function beginUnit(battle, unit) {
  if (!unit) return false;
  if ((unit.waitCount | 0) !== READY) return false;
  unit.waitCount = 0;                                 // 0x44943
  return true;
}

/**
 * 한 유닛 행동 종료 — 0x3F415. **순차**입니다(택일 아님).
 *   [+0x61] >= 300 → 아무것도 안 함 / [+0x6D] == 4 → 방어 단계 통째로 건너뜀
 *   자동 반격 직업(패시브 열2) → TP 없이 방어 / 아니면 TP > 60 이면 60 내고 방어
 *   남은 TP > 40 → 40 내고 회피 / 남은 TP > 20 → 아이템·회복 시도
 * @param {object} [opts] { defense:true }  원본의 `인자 == 1`
 */
function endUnit(battle, unit, opts) {
  opts = opts || {};
  var Ru = R();
  unit.acted = true;
  unit.moved = false;
  if (unit.waitCount === READY) unit.waitCount = 0;   // 0x44943 을 안 거쳤을 때 보정
  /* AI 가 0x40882(−2) · 0x44A0C(도주) 로 끝나면 0x3F415 턴 마무리 자세가 없다 (2026-09-29) */
  if (opts.자세없음) return { tp: unit.tp | 0, stance: unit.stance | 0 };
  if (!Ru || !Ru.endTurnStance) return { tp: unit.tp | 0, stance: unit.stance | 0 };
  var s = shimOf(unit);
  var r = Ru.endTurnStance(s, unit.tp | 0, battle.T, opts.defense !== false);
  unit.tp = r.tp | 0;
  unit.stance = r.f13 | 0;
  /* ★ 0x3F478~0x3F499 — 남은 TP > 20 이면 그 유닛을 비추고(0x1124A) 0x4D3BA(유닛, 남은 TP) 휴식 회복 — TP 는 안 쓴다 (2026-10-07)
   *   ☠ 예전에는 useItem 을 «판정만» 하고 회복하지 않았다 — 원본 대조(2-4A 씨앗 12345 넘김 3)에서
   *     공격 성향 4 인 이올린이 원본은 21805 → 22400(최대HP 80%) · 우리는 그대로였다.
   *   회복량 = min((남은TP − 10) × 30, 최대HP × 80/100 − 현재HP) — executor.restHeal(플레이어 휴식·세션 자동 휴식과 같은 함수) */
  var 회복 = 0, X = root.G2Executor;
  if (r.useItem && X && typeof X.restHeal === 'function') 회복 = X.restHeal(unit, unit.tp | 0) | 0;
  return { tp: unit.tp, stance: unit.stance, useItem: !!r.useItem, heal: 회복 };
}

/**
 * 라운드 종료 → 다음 라운드 머리까지.
 *   0x19EB7 : 누가 행동했으면 3, 아니면 1 을 돌려주고 진영 인덱스를 0 으로
 *   0x19EF1 : (턴 + 1) % [0x74138] == 0 이면 Player Phase 로 넘어감
 *   그리고 다음 바퀴의 0x19D91~0x19DFD (턴 +1 · 시간 · 0x19AEF) 를 여기서 합니다.
 * @returns {{turn, result, playerPhase, gauge, time, ready, hurt, died}}
 */
function endRound(battle, opts) {
  opts = opts || {};
  var N = (battle.turnPeriod | 0) || 2;
  var result = battle._acted ? 3 : 1;                 // 0x19ECC / 0x19ED3
  var playerPhase = (((battle.turn | 0) + 1) % N) === 0;   // 0x19EF1

  battle.sideIdx = 0; battle._cursor = 0; battle._acted = false; battle._inRound = false;
  /* 0x19F0D — 정기 지점이어도 **행동 가능한 아군이 없으면 멈추지 않습니다**.
   * `playerPhase` 는 「정기 지점이었나」를 그대로 알려 주고, 실제 정지는 여기서. */
  var stop = playerPhase && hasReadyPlayer(battle);
  battle.phase = stop ? PHASE.PLAYER : PHASE.RUN;     // [0xF042E] = 1 / 0
  battle.phaseBanner = stop;                          // [0x75008]

  battle.turn = (battle.turn | 0) + 1;                // 0x19D91
  /* 시각은 roundStart 가 올린다(0x19D9C~0x19DD2) — 여기서 시각올리기 를 또 불러 30턴째에 두 칸 흘렀다 (2026-11-09) */
  var head = roundStart(battle);
  /* 이번 라운드에 행동 가능해진 유닛의 TP 를 채워 둡니다. 원본은 유닛이 행동을
   * 시작하는 순간(0x44943/0x4D6F0) 채우지만 같은 라운드라 값이 같습니다. */
  chargeReady(battle, opts.rng);
  head.result = result;
  head.playerPhase = playerPhase;
  head.charged = battle.units.filter(function (u) {
    return u.alive && (u.waitCount | 0) === READY;
  }).map(function (u) { return { unit: u, tp: u.tp | 0 }; });
  return head;
}

/* ───────────────────────────────────────────── 4-b. 턴 관리자 한 번 = advance()
 *
 * `0x19D53` **통째**입니다. 메인 루프 0x5580F 가 0x558E2 에서 매 바퀴 부르는 그것.
 * 한 번 부르면 (막히지 않는 한) 라운드가 **한 칸 통째로** 지나갑니다.
 * -------------------------------------------------------------------------- */

/**
 * @param {object} [opts] { rng }
 * @returns {{
 *   ret:number,        1 아무도 안 움직임 · 2 중단(페이즈 전환) · 3 누가 행동함
 *   blocked:boolean,   페이즈가 0 이 아니라 아무것도 안 했다 (0x19D69)
 *   turn:number, phase:string,
 *   ai:Array,          이번 라운드에 행동할 AI 유닛들 {unit, side, control:'ai', tp}
 *   round:object|null, 0x19AEF 결과 (ready/hurt/died/time/gauge)
 *   playerPhase:boolean, focus:object|null,  0x19EF1 정기 정지와 카메라 대상
 *   ready:Array        이 호출이 끝난 시점의 행동 가능 아군
 * }}
 *
 * ── AI 를 왜 배열로 돌려주나 ──────────────────────────────────────────────
 * 원본은 0x19E6F 에서 `0x44913` 을 **그 자리에서** 부릅니다. 이 구현의 AI 는 연출을
 * 기다려야 해서 동기 호출을 할 수 없으므로, 순회는 여기서 원본 순서대로 끝내고
 * 실제 실행은 부르는 쪽(컨트롤러)이 순서대로 합니다. `[+0x56] = 0` 과 TP 충전
 * (0x44943 → 0x19FAB)은 순회 시점에 이미 걸어 두므로 값은 같습니다 — 같은 라운드
 * 안이라 입력이 안 바뀝니다. 먼저 행동한 AI 에게 죽은 유닛은 `alive` 로 걸러집니다.
 */
function advance(battle, opts) {
  opts = opts || {};
  var out = { ret: 1, blocked: false, turn: battle.turn | 0, phase: battle.phase,
              ai: [], round: null, playerPhase: false, focus: null, ready: [] };

  /* 0x19D59 → **0x19D62** — Waiting(2) 은 다음 프레임에 AI Phase(3) 가 됩니다.
   *   ★ 이 자리 말고는 2 를 소비하는 곳이 없다. 스페이스 ISR(0x19F5D)은
   *     `0x19F9C ret` 로 끝나므로 **여기 오기 전까지 배너는 `Waiting...`** 이다. */
  if (battle.phase === PHASE.WAITING) setPhase(battle, PHASE.AI);

  /* 0x19D69 — 페이즈가 0 이 아니면 여기서 끝. return 1 */
  if (battle.phase !== PHASE.RUN) {
    out.blocked = true; out.phase = battle.phase; out.ret = 1;
    out.ready = readyPlayerUnits(battle);
    return out;
  }
  battle.phaseBanner = false;                            // 0x19D7E  [0x75008] = 0

  /* 0x19D83 — 순회 도중이었으면 턴 증가·시간·0x19AEF 를 건너뛰고 이어서 */
  if (!battle._inRound) {
    battle.turn = (battle.turn | 0) + 1;                 // 0x19D91
    /* ★ 통합 2-c — 사망 유예 옵션을 그대로 넘긴다 (컨트롤러가 켠다) */
    out.round = roundStart(battle, opts);                // 0x19D9C 시간 · 0x19DFD → 0x19AEF
    chargeReady(battle, opts.rng);
  }
  battle._inRound = true;                                // 0x19E09  [0xF0422] = 1
  out.turn = battle.turn | 0;

  /* 0x19E19 ~ 0x19EB1 — 진영 0 → 3 을 이 자리에서 끝까지 */
  var t;
  while ((t = next(battle, { skipPlayer: true, rng: opts.rng,
                            deferBegin: !!opts.deferClose })) !== null) {
    out.ai.push(t);
    /* 0x19E88 — 유닛 하나 끝날 때마다 페이즈를 봅니다. 2 면 3 으로 올리고 중단.
     * [0xF0422] 를 그대로 두므로 다음 호출이 이 자리에서 재개합니다. */
    if (battle.phase === PHASE.WAITING) {
      setPhase(battle, PHASE.AI);                        // 0x19E8E → 0x19F9D(3)
      out.ret = 2; out.phase = battle.phase;
      out.ready = readyPlayerUnits(battle);
      return out;
    }
  }

  /* 0x19EB7 ~ 0x19F56 — 라운드 마무리와 정기 정지.
   *
   * ★ `deferClose` 는 **연출 때문에 AI 를 나중에 돌리는 쪽(컨트롤러)** 전용입니다.
   *   원본은 순회 안(0x19E6F)에서 AI 를 그 자리에서 부르므로 여기 올 때는
   *   이미 다 움직인 뒤입니다. 우리 AI 는 나중에 도니, 여기서 대기열을 세면
   *   **AI 가 죽이기 전의 수**를 보게 됩니다 — 그래서 부르는 쪽이 AI 를 다
   *   돌린 뒤 `closeRound()` 를 직접 부릅니다. */
  if (opts.deferClose) { out.pendingClose = true; out.phase = battle.phase; return out; }
  return closeRound(battle, opts, out);
}

/**
 * `0x19EB7 ~ 0x19F56` — 라운드 마무리 + 정기 정지 판정.
 *
 * ```
 *   0x19EB7  bx = [0xF0420] (누가 행동했나) → 결과 3 / 1     (0x19ECC · 0x19ED3)
 *   0x19EC0  [0xF0422] = 0                  순회 종료
 *   0x19EE1  [0xF0424] = 0 · [0xF0420] = 0  진영 인덱스·행동 표시 초기화
 *   0x19EF1  eax = 턴 + 1 ; div [0x74138] ; 나머지 != 0 이면 건너뜀
 *   0x19F06  di = [0xF0426]  ← **대기열 수**
 *   0x19F0D  di <= 0 이면 건너뜀            정기 지점이어도 아무도 없으면 안 멈춘다
 *   0x19F12  focus = 대기열[di − 1] (0x1979F) → 0x1124A 카메라
 *   0x19F3C  [0xF042E] = 1  Player Phase
 *   0x19F42  [0x75008] = 1  배너
 * ```
 *
 * ★★ `0x19F06` 이 읽는 `[0xF0426]` 은 **이번 라운드 AI 가 다 움직인 뒤의** 값입니다.
 *   AI 가 마지막 남은 아군을 죽였으면 여기서 0 이라 Player Phase 로 안 넘어갑니다.
 *   (그 판단을 AI 보다 먼저 하면 대기열이 빈 채로 시간이 멈춰 게임이 진행되지
 *    않습니다 — 예전 이 구현이 그랬습니다.)
 *
 * @param {object} [out]  advance() 가 쓰던 보고서에 이어 쓰려면 넘깁니다.
 */
function closeRound(battle, opts, out) {
  opts = opts || {};
  out = out || { ret: 1, blocked: false, turn: battle.turn | 0, phase: battle.phase,
                 ai: [], round: null, playerPhase: false, focus: null, ready: [] };
  out.pendingClose = false;

  var result = battle._acted ? 3 : 1;                    // 0x19ECC / 0x19ED3
  battle._inRound = false;                               // 0x19EC0  [0xF0422] = 0
  battle.sideIdx = 0; battle._acted = false; battle._cursor = 0;   // 0x19EE1 ~ 0x19EFC
  out.ret = result;

  /* 0x19EF1 — 정기 정지. (턴+1) % [0x74138] == 0 이고 [0xF0426] > 0 */
  var N = (battle.turnPeriod | 0) || 2;
  var q = readyPlayerUnits(battle);
  if ((((battle.turn | 0) + 1) % N) === 0 && q.length > 0) {
    out.playerPhase = true;
    out.focus = q[q.length - 1];                         // 0x19F12  [0xF0426] − 1
    setPhase(battle, PHASE.PLAYER);                      // 0x19F3C
    battle.phaseBanner = true;                           // 0x19F42  [0x75008] = 1
    /* 0x19F1D  mov eax, 0x1D ; 0x19F22  call 0x4F4CD — **턴 알림음**(VSP 29 TURN).
     * 원본도 이 자리에서 직접 냅니다. 스페이스로 시간을 재개했다가 다시
     * Player Phase 로 멈출 때 나는 소리가 이것입니다. */
    if (root.G2Fx && root.G2Fx.playSound) root.G2Fx.playSound(29);
    out.ret = 2;                                         // 0x19F51 → 0x19E98
  }
  out.phase = battle.phase;
  out.ready = q;
  return out;
}

/**
 * `0x4DB58` — 유닛 하나의 행동이 **끝난 직후**에 거는 빗장 풀기.
 *
 * ```
 *   0x4DB58  call 0x19FA3      ; al = [0xF042E] 페이즈
 *   0x4DB5D  cmp ax, 1         ; Player Phase 가 아니면
 *   0x4DB61  jne 0x4DB71       ;   그냥 나간다
 *   0x4DB63  call 0x19792      ; 대기열 머리 [0xF041C] != 0 ?
 *   0x4DB6A  jne 0x4DB71       ; 아직 남아 있으면 그대로 둔다
 *   0x4DB6C  call 0x19F9D      ; eax = 0 → [0xF042E] = 0  ← 시간을 다시 흘린다
 * ```
 *
 * `0x19792`(대기열이 비었나)를 부르는 곳은 원본 전체에서 **여기 하나뿐**입니다.
 * 즉 Player Phase 를 푸는 지점은 이 한 곳입니다(스페이스바 0x55B19 제외).
 *
 * @returns {boolean} 빗장을 풀었으면 true
 */
function releaseIfQueueEmpty(battle) {
  if (battle.phase !== PHASE.PLAYER) return false;       // 0x4DB5D
  if (hasReadyPlayer(battle)) return false;              // 0x4DB63 → 0x19792
  setPhase(battle, PHASE.RUN);                           // 0x4DB6C → 0x19F9D (eax=0)
  battle.phaseBanner = false;                            // [0x75008]
  return true;
}

/**
 * 스페이스바 한 번 = 「조작할 아군이 나올 때까지 시간을 흘린다」.
 *   0x55B19 로 페이즈를 0 으로 풀고, 0x19D53(= `advance`) 을 멈출 때까지 반복.
 *
 * 멈추는 조건은 원본 그대로 **정기 정지(0x19EF1)** 하나뿐입니다. 즉 AI 만 계속
 * 행동하다가, `(턴+1) % [0x74138] == 0` 인 라운드에 행동 가능한 아군이 하나라도
 * 있으면 Player Phase 로 멈춥니다. 이때 **이전에 쌓여 있던 아군도 그대로 남아
 * 있으므로**, 여러 명을 순서 없이 조작하게 됩니다.
 *
 * @param {object} [opts] { rng, maxRounds:4096, onAi:function(unit) }
 *   onAi 를 주면 AI 를 그 자리에서(동기로) 굴립니다. 안 주면 `ai` 에 모아 돌려줍니다.
 * @returns {{rounds, ai, ready, focus, phase, playerPhase, ended}}
 */
function settleUntilPlayerReady(battle, opts) {
  opts = opts || {};
  var guard = opts.maxRounds != null ? (opts.maxRounds | 0) : 4096;
  var out = { rounds: 0, ai: [], ready: [], focus: null,
              phase: battle.phase, playerPhase: false, ended: false };
  resume(battle);                                        // 0x55B19
  while (guard-- > 0) {
    var r = advance(battle, opts);
    out.rounds++;
    if (r.blocked) { out.ended = true; break; }
    for (var i = 0; i < r.ai.length; i++) {
      if (!r.ai[i].unit.alive) continue;
      out.ai.push(r.ai[i]);
      if (opts.onAi) opts.onAi(r.ai[i].unit, r.ai[i]);
    }
    if (r.playerPhase) { out.playerPhase = true; out.focus = r.focus; break; }
    if (opts.stop && opts.stop(battle, r)) break;
  }
  out.phase = battle.phase;
  out.ready = readyPlayerUnits(battle);
  return out;
}

/* ───────────────────────────────────────────── 5. 내보내기 */

/**
 * [리마스터 · 정본 373 ⑤] 앞으로의 아군 차례 — 아군 턴이 멈출 때마다(정기 정지 0x19EF1 · 주기 [0x74138]) 새로 행동 가능해질 플레이어 유닛.
 *   재행동 대기는 원작 규칙(Rules.readyTick · 0x19AEF)을 «사본»에 라운드마다 돌려 센다 — 유닛·_shim 은 건드리지 않는다
 *   지금 아군 턴(턴 T0 · (T0+1)%주기 == 0)에서 j 번째 다음 라운드에 행동 가능해지면 → ceil(j ÷ 주기) 번째 다음 아군 턴
 *   그 사이 상태이상 지속이 끝나 둔화·가속이 풀리는 것은 지금 값 그대로 본다(근사)
 *   (사장님 11-22 「남은 턴 개수까지 점 같은 걸로 표시해서 다음 턴 오는게 누구인지도 알 수 있으면 좋겠어」)
 * @returns [{ u, r, k }] r = 몇 라운드 뒤 · k = 몇 번째 다음 아군 턴(1 = 다음) · 지금 행동 가능(대기열)인 유닛은 넣지 않는다 · r 순
 */
function 앞으로차례(battle, 최대라운드) {
  var Ru = R(), T = battle && battle.T, N = (battle && battle.turnPeriod | 0) || 2, 끝 = 최대라운드 || 64, out = [];
  if (!Ru || !Ru.readyTick || !battle) return out;
  (battle.units || []).forEach(function (u) {
    if (!u || !u.alive || (u.side | 0) !== 1 || u.job === 0xA2) return;   /* 0x19B2C */
    /* AI 를 건 아군(조작불가 포함)도 넣는다 — 그 아군은 READY 가 된 라운드에 곧바로 스스로 움직인다(0x44913) · ai 표시로 구분
     *   (사장님 11-22 「그리고 ai 걸면 안나오는 문제도 있어」 — 전에는 대기열에 들어오는 아군만 넣어 AI 를 걸면 줄에서 빠졌다) */
    var ai = controlOf(battle, u) !== 'player';
    if ((u.waitCount | 0) === 0xFF) return;                              /* 이미 행동 가능 */
    var s = { job: u.job, wait: u.waitCount | 0, f13: u.stance | 0, f14: u.f14 | 0, f15: u.f15 | 0 };
    for (var j = 1; j <= 끝; j++) if (Ru.readyTick(s, T)) { out.push({ u: u, r: j, k: Math.ceil(j / N), ai: ai }); return; }
  });
  out.sort(function (a, b) { return a.r - b.r; });
  return out;
}

var G2Turn = {
  앞으로차례: 앞으로차례,   /* 정본 373 ⑤ */
  begin: begin,
  next: next,
  beginUnit: beginUnit, endUnit: endUnit,
  endRound: endRound,
  gaugeTicks: gaugeTicks,
  /* ★ 새 턴 구조 — 0x19D53 / 0xF041C 대기열 / 0xF042E 페이즈 */
  advance: advance,
  closeRound: closeRound,                    // 0x19EB7~0x19F56 — AI 를 다 돌린 뒤 부른다
  releaseIfQueueEmpty: releaseIfQueueEmpty,  // 0x4DB58 — 대기열이 비면 시간을 다시 흘린다
  settleUntilPlayerReady: settleUntilPlayerReady,
  readyPlayerUnits: readyPlayerUnits,
  hasReadyPlayer: hasReadyPlayer,
  readyAt: readyAt,
  canCommand: canCommand,
  enqueueReady: enqueueReady,
  dequeueReady: dequeueReady,
  consumeTurn: consumeTurn,
  /* ★ 통합 2-c — 사망 유예를 쓸 때 컨트롤러가 S4 **뒤에** 부른다 (0x1745B) */
  사망마무리: 사망마무리,
  /* ★★★ 원본 `0x1DB1D` 순서대로 쓰려면 이 둘을 쓴다 (2026-08-22 · GPT 23차):
   *   `사망전처리()` → **await S4(`0x1DB50`)** → `사망후처리()`
   *   ★ `사망후처리()` 는 S4 가 HP 를 회복시켰으면 **`false`** 를 돌려준다 */
  사망전처리: 사망전처리,
  사망후처리: 사망후처리,
  진영목록에있나: 진영목록에있나,   /* ★ 0x11FF7 대응 */
  사망진영: 사망진영,               /* ★ 0x1DB55 — S4 앞 진영 캡처 */
  resume: resume,
  pause: pause,
  setPhase: setPhase,
  phaseCode: phaseCode,
  PHASE: PHASE, PHASE_CODE: PHASE_CODE,
  /* 곁가지 */
  controlOf: controlOf,
  listOf: listOf,
  timeStep: timeStep,
  timePeriod: timePeriod,
  roundStart: roundStart,
  unitPass: unitPass,
  recharge: recharge,
  chargeReady: chargeReady,
  readyCount: readyCount,
  /**
   * `0x4D9A0` — 이동 예산. 화면에 같이 찍으려고 곁들인다.
   *   ★ **정본은 `move.budgetOf`** 다 (4단계 ②).
   *   ★★ **조용한 `0` 폴백을 지웠다** (2026-08-26 · 4-f · GPT 4차 검수 ⑥):
   *     전에는 `root.G2Move ? … : 0` 이라 `move.js` 가 없으면 **예산 0** 을 찍어
   *     「이동할 수 없는 유닛」처럼 보였다. 없으면 **던진다** (2-7 원칙).
   *   ★ 이탈비용은 안 넘긴다 — 화면 표시는 원본 초기값 10 자리다.
   */
  budgetOf: function (u) {
    if (!root.G2Move || typeof root.G2Move.budgetOf !== 'function') {
      throw new Error('turn.budgetOf: G2Move.budgetOf 가 없다 — move.js 를 먼저 실어야 한다');
    }
    return root.G2Move.budgetOf(u.tp | 0);
  },
  READY: READY
};

root.G2Turn = G2Turn;
if (typeof module !== 'undefined' && module.exports) module.exports = { G2Turn: G2Turn };

})(typeof globalThis !== 'undefined' ? globalThis : window);
