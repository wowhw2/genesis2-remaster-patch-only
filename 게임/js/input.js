/* ============================================================
 *  **입력 2층** — 계약 §5-c (2026-08-20 · UI 트랙 U0-2)
 *
 *  `상태.의도들` 은 **완성된 게임 행위**만 담는다(`{종류:'이동', 지점:3}`).
 *  커서가 어디 있는지 · 메뉴 몇 번째인지 · 키가 눌렸는지 떼졌는지는 담을 자리가 없다.
 *  그래서 **두 층**으로 나눈다.
 *
 *  ```
 *  ① 저수준 층 (여기)  키보드·마우스 → 눌림/떼짐/반복 · 확정/취소로 **정규화**
 *          ↓
 *  ② 화면             커서 이동 · 포커스 · 메뉴 탐색  →  runtime.ui 에만 쓴다
 *          ↓
 *  ③ 게임 행위         **확정된 선택만** 상태.의도들 로
 *  ```
 *
 *  ★★★ **화면은 DOM 이벤트를 직접 보지 않는다.** 공급자가 낸 묶음만 본다.
 *  그래야 **브라우저와 헤드리스가 같은 것을 먹는다** (계약 §5-d 6번).
 *
 *  ── 저수준 입력 묶음 ────────────────────────────────────────────────────
 *  ```js
 *  { 종류: '눌림' | '떼짐' | '반복', 키: 키이름, 원시: (있으면 원본 이벤트 정보) }
 *  ```
 *
 *  ★★★ **U0-2 에서 정하지 않는다** (GPT 31차) — 아래 둘은 그 뒤 **원본에서 읽어**
 *  풀렸다. 남은 ☐ 는 각 항목 안에 적었다:
 *  · ★★★★★ **키 반복 간격 — 마을(PACK)에서는 「반복」이 없다** (2026-09-02 확정)
 *    마을 메인 루프가 **매 프레임** 주인공 처리를 부른다 —
 *    ```asm
 *    0x1910E / 0x1911E  call 0x1D12F      ; 한 프레임에 한 번
 *    0x1D284  8a 3d ce 44 05 00  mov bh, [0x544CE]   ; ★ 걸음 단계
 *    0x1D28D  84 ff              test bh, bh
 *    0x1D28F  0f 86 87 07 00 00  jbe 0x1DA1C          ; ★ 0 이면 **새 입력을 본다**
 *    0x1D295  8a 1d 49 29 08 00  mov bl, [0x82949]    ;   아니면 **마지막 스캔**으로 잇는다
 *    ```
 *    ⇒ 원본에는 **반복 지연이 없다.** 걷는 중에는 새 입력을 안 보고 그 걸음을 마치며,
 *      다 마친 프레임에 다시 키 상태를 읽는다. 곧 **실질 반복 간격 = 한 칸 걸음 시간**이다.
 *      우리 `screens.js` 도 「걸음이 흐르는 중이면 그 의도를 버린다」로 같게 돈다.
 *    ★★★★★ **전투(`COMBATII`)는 다르다 — 거기엔 반복 지연이 있다** (2026-09-07 읽었다)
 *      맵 훑어보기 커서의 방향키 반복 스크롤(`0x4A3FF`)이 **맨 먼저** 이것을 부른다:
 *      ```asm
 *      0x4A408  mov eax, 3          ; ★ 지연 값 **3**
 *      0x4A40D  call 0x1033B
 *      0x1033C  mov [0x70004], ax   ;   그 값을 담는다
 *      0x10342  cmp ax, 1 / jae     ;   1 미만이면 1 로 올린다 (0x10348)
 *      0x10355  [0x789A7] = 0 · [0x789A2] = 0  ;  세는 것을 되돌린다
 *      ```
 *      ⇒ **마을과 구조가 다르다.** 마을은 「걸음이 끝나야 다시 본다」이고,
 *        전투 커서는 **틱 3 마다** 되풀이한다.
 *    ★★★★★ **월드(`CHP`)와 마을(`PACK`)에는 그 장치가 없다** (2026-09-07 · 전수로 봤다)
 *      `0x1033B` 의 바이트꼴 `53 66 A3 .. .. .. .. 66 3D 01 00 73 09`
 *      (`push ebx` · `mov [imm32],ax` · `cmp ax,1` · `jae`) 를 세 EXE 에서 전수했다:
 *      ```
 *      COMBATII.EXE  1곳 (0x1033B)      ← 반복 지연을 담는 자리
 *      CHP.EXE       0곳
 *      PACK.EXE      0곳
 *      ```
 *      ⇒ 읽은 범위에서는 **반복 지연이 전투에만 있다.** 마을은 「걸음이 끝나야
 *        다시 본다」이고, 월드는 입력을 **폴링**한다
 *        (`03_분석/CHP/입력큐_0x28A06.md` — 큐 코드는 남아 있지만 넣는 쪽을
 *         아무도 안 부른다).
 *    ⇒ 그래서 이 모듈은 지금도 **`반복` 을 만들어 내지 않는다.**
 *      전투 커서(`0x4A3FF`)만 제 지연을 따로 든다.
 *    ☐ **화면으로는 안 봤다** — 전투에서 방향키를 눌러 커서가 도는 빠르기를
 *      원본과 나란히 재지는 못했다.
 *    그래서 여기서는 여전히 `반복` 을 **만들어 내지 않는다.** 공급자가 받은 것만 넘긴다
 *  · ~~**확정·취소 동시 입력의 우선순위** — 안 읽었다.~~
 *    ★★★★★ **2026-09-03 읽었다 — 우선순위는 없다. 「먼저 들어온 것」이다.**
 *    ```asm
 *    0x5D242  cmp al, ah / je         ; 꼬리 == 머리면 빈 큐
 *    0x5D24A  inc edx · 0x5D24B ecx = 0x1E(30) · idiv   ; ★ 머리를 **하나** 앞으로
 *    0x5D257  mov [0xB385E], dl       ;   원형 30 칸
 *    0x5D28A  eax = 머리 × 3 · 0x5D28F lea edx, [eax+eax]  ; 한 칸 **6 B**
 *    0x5D292  ax = [edx + 0xB3756] · 0x5D29E ax = [edx + 0xB3758]  ; 그 칸의 값 둘
 *    ```
 *    ⇒ **완전한 FIFO** 다. 한 번 부를 때 **한 칸만** 꺼내고, 두 키가 같은 프레임에
 *      들어와도 **들어온 순서대로** 따로따로 나온다. 「확정이 취소를 이긴다」 같은
 *      **우선순위 규칙이 원본에 없다.**
 *    ★ 우리도 **순서를 바꾸지 않고** 그대로 넘긴다 — 지금 동작이 원본과 같다.
 *  · ~~**전환 잠금 중 들어온 입력을 버릴지 보관할지** — 안 읽었다.~~
 *    ★★★★★ **2026-09-03 읽었다 — 원본은 「보관」이다.**
 *    입력 큐는 **원형 30 칸**(`0x5D22E` · `idiv 0x1E`)이고 잠겨 있어도 인터럽트가 채운다.
 *    **비우는 자리는 `0x5D2F5`(「입력 이벤트 큐 비우기 tail=head」) 하나뿐**이고,
 *    그것을 부르는 `0x5D388`(커서 재설정 + 큐 비우기)마저 **`0x55BF1` 한 곳**
 *    (전투 화면을 세울 때)에서만 불린다. ⇒ **평소에는 안 비운다.**
 *    그래서 **공급(모으기)과 차단(셸이 화면에 안 준다)을 갈라 뒀다.**
 *    지금은 셸이 잠금 중에 화면에 안 주고, **버릴지 보관할지는 공급자 정책**으로 남긴다
 * ============================================================ */
'use strict';
(function (root) {

  /** 원본 키 이름 — 화면은 이 이름만 본다 */
  var 키들 = ['위', '아래', '왼쪽', '오른쪽', '확정', '취소', '메뉴', '보조', '설명', '앞쪽', '뒤쪽'];   /* 설명 = F1 (정본 246) · 앞쪽·뒤쪽 = PageUp·PageDown — 배치표에만 있고 여기 없어 누르면 «그런 키는 없다» 오류 (정본 247) */
  var 종류들 = ['눌림', '떼짐', '반복'];

  /** 저수준 입력 하나를 만든다 */
  function 입력(종류, 키, 원시) {
    if (종류들.indexOf(종류) < 0) throw new Error('그런 입력 종류는 없다: ' + 종류);
    if (키들.indexOf(키) < 0) throw new Error('그런 키는 없다: ' + 키);
    var e = { 종류: 종류, 키: 키 };
    if (원시 !== undefined) e.원시 = 원시;
    return e;
  }

  /* ══════════════════════════════════════════════════════════════════
   *  ★★★ **마우스** — 원본에 있다 (`TTL.EXE` 직독 2026-08-20)
   *
   *  사용자 지적: 「**첫 화면 마우스가 적용이 안 돼.**」
   *
   *  원본은 마우스를 **키로 바꾸지 않는다.** `0x141B4` 가 INT 33h AX=0 으로 열고
   *  AX=0x0C 로 이벤트 콜백(`0x43AA`)을 걸어, 콜백이 **30칸 링버퍼**에 쌓는다.
   *  화면 루프는 `0x14300` 으로 한 칸씩 꺼내 `{버튼, x, y}` 를 읽는다
   *  (`[0x261C+i*12]`=버튼 · `[0x2620+i*12]`=x · `[0x2624+i*12]`=y).
   *
   *  그래서 우리도 **키로 바꾸지 않고** 같은 모양으로 낸다:
   *  ```js
   *  { 종류: '마우스', 동작: '움직임'|'누름'|'뗌', x, y, 버튼 }
   *  ```
   *  좌표는 **원본 화면 좌표(320×200)** 다 — 공급자가 환산해서 넣는다.
   *
   *  ★★★★★ **해소 (2026-08-29 · `screens.js` §타이틀에 이미 있었다)**
   *    `TTL 0x13982 esi = [0x25FC]` · `0x1398E cmp esi, 1` · `0x13991 jne 0x13A74` —
   *    **왼쪽 버튼(1)인지만 본다.** 1 이 아니면 `0x13A74` 로 가서 고른 항목이
   *    바뀌었나만 보고 다시 그린다. ⇒ **오른쪽 버튼 갈래가 아예 없다.**
   *    우리가 무시하는 것이 원본과 같다.
   *    휠은 1996년 도스라 **없다.**
   * ══════════════════════════════════════════════════════════════════ */
  var 마우스동작들 = ['움직임', '누름', '뗌'];

  /** 마우스 저수준 입력 하나 */
  function 마우스(동작, x, y, 버튼) {
    if (마우스동작들.indexOf(동작) < 0) throw new Error('그런 마우스 동작은 없다: ' + 동작);
    return { 종류: '마우스', 동작: 동작, x: x | 0, y: y | 0, 버튼: 버튼 | 0 };
  }

  /** 마우스 입력인가 — 화면이 키 입력과 가르는 데 쓴다 */
  function 마우스냐(x) { return !!x && x.종류 === '마우스'; }

  /** 규약 밖 입력을 거른다 — **모든 진입 경로**가 이걸 거친다 (GPT 32차 3번) */
  function 입력검증(x) {
    if (!x || typeof x !== 'object') throw new Error('입력이 객체가 아니다: ' + x);
    if (x.종류 === '마우스') {                       /* ★ 마우스는 키가 없다 */
      if (마우스동작들.indexOf(x.동작) < 0) throw new Error('그런 마우스 동작은 없다: ' + x.동작);
      if (typeof x.x !== 'number' || typeof x.y !== 'number')
        throw new Error('마우스 좌표가 숫자가 아니다');
      return x;
    }
    if (종류들.indexOf(x.종류) < 0) throw new Error('그런 입력 종류는 없다: ' + x.종류);
    if (키들.indexOf(x.키) < 0) throw new Error('그런 키는 없다: ' + x.키);
    return x;
  }

  /**
   * ★★★ **잠금 정책** — 전환·적재로 잠긴 동안 들어온 원시 입력을 어떻게 하나.
   *
   * · `'보관'` — 쌓아 뒀다가 잠금이 풀리면 한꺼번에 낸다
   * · `'폐기'` — 잠긴 동안 들어온 것을 버린다
   *
   * ★★★ **원본에 입력 큐가 있다 (2026-09-02 · 읽는 중)**
   *   `PACK 0x1992E` 에 **원형 큐** 무늬이 있다 —
   *   ```asm
   *   0x19937  a0 32 29 08 00     mov al, [0x82932]    ; 머리
   *   0x1993C  8a 25 33 29 08 00  mov ah, [0x82933]    ; 꼬리
   *   0x19942  38 e0 / 74 32      cmp al, ah ; je      ;   비었으면 나간다
   *   0x1994B  b9 1e 00 00 00     mov ecx, **30**      ; ★ 칸 수
   *   0x19950  f7 f9              idiv ecx             ;   꼬리를 30 으로 돌린다
   *   0x19957  88 15 33 29 08 00  mov [0x82933], dl
   *   ```
   *   ⇒ 「보관」 쪽에 가깝다 — 다만 **30칸이 차면 넘친다.**
   * ☐ 그러나 「전환·적재로 잠긴 동안」에도 그 큐가 쌓이는지는 **아직 안 봤다.**
   *   이것은 셀·입력층 계약이라 여기서 기본값을 바꾸지 않는다.
   * 그래서 **계약이 기본값을 확정하지 않는다.** 공급자를 만들 때 **골라 주입**한다.
   * 아무것도 안 주면 `'보관'` 으로 도는데, 그것은 **실행기 임시 선택**이지 원본 근거가
   * 아니다 (`정책출처` 로 그렇게 표시한다). 원본을 읽으면 여기만 고친다.
   */
  var 잠금정책들 = ['보관', '폐기'];
  function 정책정하기(옵션) {
    옵션 = 옵션 || {};
    var p = 옵션.잠금정책;
    /* ★ 기본 '보관' 은 **원본과 같다** (2026-09-03) — 원본 입력 큐(원형 30칸)를
     *   비우는 자리는 `0x5D2F5` 하나뿐이고 전투 화면을 세울 때(`0x55BF1`)만 불린다.
     *   잠금 중 입력은 큐에 그대로 쌓였다가 풀리면 나온다. */
    if (p == null) return { 잠금정책: '보관', 정책출처: '원본 0x5D22E 큐 · 0x5D2F5 비우기 한 곳' };
    if (잠금정책들.indexOf(p) < 0) throw new Error('그런 잠금 정책은 없다: ' + p);
    return { 잠금정책: p, 정책출처: '주입됨' };
  }

  /**
   * **주입식 공급자** — 시험·헤드리스가 쓴다 (계약 §5-d 3번).
   * @param 옵션 `{잠금정책: '보관'|'폐기'}` — 위 설명 참조
   */
  function 주입공급자(옵션) {
    var 정책 = 정책정하기(옵션);
    var 대기 = [];
    var 이력 = [];
    var 버린수 = 0;
    var 공급 = {
      잠금정책: 정책.잠금정책, 정책출처: 정책.정책출처,
      /** 입력을 넣는다. `('눌림','확정')` 또는 입력 객체·배열 — **모두 검증한다** */
      넣기: function (a, b, c) {
        if (Array.isArray(a)) { a.forEach(function (x) { 공급.넣기(x); }); return 공급; }
        대기.push(typeof a === 'string' ? 입력(a, b, c) : 입력검증(a));
        return 공급;
      },
      /**
       * 한 틱 분량을 꺼낸다 — 꺼내면 비워진다.
       * @param 잠김 셸이 알려 주는 잠금 상태. ★ 잠겼으면 **어느 정책이든 내주지 않는다**
       */
      모으기: function (틱번호, 잠김) {
        if (잠김) {
          if (공급.잠금정책 === '폐기') { 버린수 += 대기.length; 대기 = []; }
          return [];
        }
        var 낸것 = 대기; 대기 = [];
        낸것.forEach(function (x) {
          이력.push(x.종류 === '마우스'
            ? { 틱: 틱번호, 종류: '마우스', 동작: x.동작, x: x.x, y: x.y, 버튼: x.버튼 }
            : { 틱: 틱번호, 종류: x.종류, 키: x.키 });
        });
        return 낸것;
      },
      비우기: function () { 대기 = []; return 공급; },
      /** ★ 언제 무엇이 공급됐는지 관찰한다 (계약 §5-d 5번) */
      이력: function () { return 이력.slice(); },
      대기수: function () { return 대기.length; },
      버린수: function () { return 버린수; }
    };
    return 공급;
  }

  /** **무동작 공급자** — 헤드리스에서 입력이 필요 없을 때 */
  function 무동작공급자() {
    return { 잠금정책: '폐기', 정책출처: '무동작',
             넣기: function () { return this; }, 모으기: function () { return []; },
             비우기: function () { return this; }, 이력: function () { return []; },
             대기수: function () { return 0; }, 버린수: function () { return 0; } };
  }

  /** 공급자가 규약을 지키는지 — 셸이 만들 때 **즉시** 검사한다 (GPT 32차 4번) */
  function 공급자검증(공급) {
    var 탈 = [];
    if (!공급 || typeof 공급 !== 'object') return ['입력 공급자가 객체가 아니다'];
    if (typeof 공급.모으기 !== 'function') 탈.push('모으기() 가 없다');
    if (typeof 공급.비우기 !== 'function') 탈.push('비우기() 가 없다');
    return 탈;
  }

  /**
   * **브라우저 공급자** — DOM 이벤트를 저수준 입력으로 **정규화**한다.
   *
   * ★ 키 배치는 **실행기 편의**다. 원본 키 배치를 확인하면 여기만 고친다
   *   ★★★ **2026-08-29 — 어느 EXE 가 키를 쓰는지 세어 봤다.**
   *     방향키 스캔코드(`0x48` ↑ · `0x4B` ← · `0x4D` → · `0x50` ↓)를
   *     `cmp al,imm8` / `cmp cl,imm8` 꼴로 전수했다:
   *     ```
   *     PACK      25곳   ← ★ **마을이 키를 주로 쓴다**
   *     COMBATII   6곳
   *     CHP        6곳
   *     TTL        1곳
   *     ```
   *     실제로 마을 커서 방향은 `PACK 0x2E250`~`0x2E26F` 에서
   *     `↑(0x48)→0 · ↓(0x50)→2 · →(0x4D)→4 · ←(0x4B)→6` 으로 확정돼 있다
   *     (`townpick.js` §커서 방향과 핫스팟 보정).
   *   ★★★★★ **방향별로 갈라 세니 결론이 났다** — `COMBATII` 는 방향키를 **안 쓴다.**
   *     ```
   *     PACK      ← 6 · → 6 · ↓ 8 · ↑ 5     ★ **네 방향이 고르게 있다**
   *     CHP       → 4 · ↓ 2                     (↑ ← 없음)
   *     COMBATII  → 3 · ↓ 2 · ← 1               (↑ **하나도 없음**)
   *     ```
   *     `↑`(0x48)이 없는 EXE 에서 나온 값들은 **우연히 같은 수**다
   *     (0x4B·0x4D·0x50 = 75·77·80 은 흔한 상수다).
   *   ⇒ **키 배치는 마을(PACK)에서만 원본을 확인할 수 있다.**
   *     전투는 마우스 중심이므로 여기 키 배치는 **실행기 편의가 맞다.**
   *     `townpick.js` §커서 방향에 그 확정이 있다(`0x2E250`~`0x2E26F`)..
   * ★ `keydown` 의 `repeat` 플래그는 **브라우저가 만든 것**이라 원본 간격과 다르다.
   *   그래서 `반복` 으로 넘기되 **간격을 우리가 만들지는 않는다**.
   *
   * @param 창 `window` 같은 것 (없으면 아무것도 안 한다)
   */
  function 브라우저공급자(창, 배치, 옵션) {
    var 정책 = 정책정하기(옵션);
    var 대기 = [], 이력 = [], 붙임 = null, 버린수 = 0;
    배치 = 배치 || {
      ArrowUp: '위', ArrowDown: '아래', ArrowLeft: '왼쪽', ArrowRight: '오른쪽',
      Enter: '확정', ' ': '확정', Escape: '취소', Backspace: '취소',
      /* [개발용] 개발 상점(DEVSHOP) 쪽 넘기기 — 표에 없어 키보드·패드(L·R) 모두 버려졌다 · 다른 화면은 이 이름을 안 본다 (2026-11-15 · 정본 210) */
      PageUp: '앞쪽', PageDown: '뒤쪽',
      /* ★★★★★ **Ctrl 이 원본의 확인 키다** (2026-08-28 · 사용자 ②)
       *
       *   > 「대사 속도 관련 좌클릭대신 **컨트롤키도 같은 동작**을 해.」
       *   > 「월드에서 대화 이벤트 대화창도 마을에서 npc 대화처럼
       *   >  **좌클릭(컨트롤키도 동일)** 누르고 있는 동안 타이핑이 가속되는거야.」
       *
       *   원본이 왼쪽 버튼과 **한 갈래**로 Ctrl 을 본다 —
       *   마을 `PACK 0x274F6 cmp [0x150168], 0`(= 스캔코드 0x1D · §NN-17) ·
       *   월드 `CHP 0x2B5B6 cmp [0x4C58C], 0` (같은 자리).
       *   ☠ 배치표에 **Control 이 아예 없어서** Ctrl 입력이 통째로 버려졌다. */
      Control: '확정',
      Tab: '메뉴',
      /* [리마스터] F1 = 게임설정 «리마스터 규칙» 상세보기 — 표에 없어 게임에 안 오고(눌림 이 preventDefault 도 안 함) 크롬이 F1 을 «도움말 창»으로 열었다
       *   (2026-11-16 사장님 「…f1을 누르라는데 내경우 이상한 창이 뜨고(크롬창) 상세 내용은 안보여」 · 정본 246) · 다른 화면은 이 이름을 안 본다 */
      F1: '설명',
      /* ★★★★★★★ **「보조」는 Shift 가 아니라 Alt 다** — `PACK 0x191AE` (2026-09-04)
       *
       *   > 사용자: 「**컨트롤이 좌클릭, 알트가 우클릭처럼 작동해야하는데**, 지금은
       *   >  처리 로직이 달라. **우클릭으로 진입하는 스탯창은 알트로 들어가야하는데,
       *   >  지금은 시프트키를 누르면 들어가.**」
       *
       *   ```asm
       *   0x191A5  cmp dword [0x7CF20], 2      ; ★ 마우스 종류 2 = **우클릭**
       *   0x191AC  je  0x191B7
       *   0x191AE  cmp dword [0x1A01D4], 0     ; ★★ **Alt**
       *   0x191B5  je  0x191BC
       *   0x191B7  call 0x32315                ; ★ STATUS 화면
       *   ```
       *   ⇒ **우클릭 또는 Alt** 가 스테이터스다. Shift 가 아니다.
       *
       *   ★ 키 상태 배열은 **스캔코드 × 4**, 밑이 `0x1A00F4` 다 — 네 자리가 다 맞는다:
       *   ```
       *   Esc  0x01 → 0x1A00F8    Ctrl 0x1D → 0x1A0168
       *   Alt  0x38 → 0x1A01D4    F10  0x44 → 0x1A0204
       *   ```
       *   ☠ **Shift 자리는 원본이 안 쓴다** — 왼쪽 `0x2A → 0x1A019C` ·
       *     오른쪽 `0x36 → 0x1A01CC` 둘 다 참조가 **0 곳**이다.
       *     그래서 `Shift` 를 빼도 잃는 것이 없다. */
      Alt: '보조'
    };
    /* 정본 430 — 글 칸(버그 신고 설명 등)에 쓰는 중이면 게임 키로 받지 않는다 · ☠ Backspace 를 «취소»로 받아 기본 동작을 막아 글이 안 지워졌다
     *   (신고 버그신고_휴대폰_20261123_082450 «버그신고글도지우는안됨») */
    function 글칸인가(ev) { var t = ev && ev.target; if (!t || !t.tagName) return false; var n = String(t.tagName).toUpperCase(); return n === 'TEXTAREA' || (n === 'INPUT' && !/^(button|checkbox|radio|range|submit)$/i.test(t.type || '')) || !!t.isContentEditable; }
    function 눌림(ev) {
      if (글칸인가(ev)) return;
      var 키 = 배치[ev.key]; if (!키) return;
      대기.push(입력(ev.repeat ? '반복' : '눌림', 키, { key: ev.key }));
      if (ev.preventDefault) ev.preventDefault();
    }
    function 떼짐(ev) {
      if (글칸인가(ev)) return;
      var 키 = 배치[ev.key]; if (!키) return;
      대기.push(입력('떼짐', 키, { key: ev.key }));
    }

    /* ★★★ 마우스 — DOM 좌표를 **원본 화면 좌표(320×200)** 로 바꿔 넣는다.
     *   환산은 `옵션.좌표` 가 한다(캔버스가 CSS 로 확대돼 있으므로).
     *   안 주면 마우스를 **아예 안 붙인다** — 좌표를 지어내지 않는다. */
    var 좌표 = 옵션 && 옵션.좌표;
    var 마우스대상 = (옵션 && 옵션.마우스대상) || 창;
    function 환산(ev) {
      var p = 좌표(ev);
      return p && p.x === p.x && p.y === p.y ? p : null;   /* NaN 거르기 */
    }
    /* ★ 정본 225 — 눌린 채 이웃 맵으로 넘어가면 로딩 화면(G2전투로딩 덮개)이 게임 화면을 덮어 «뗌»이 화면 밖에 떨어졌다
     *   → 버튼상태가 1 로 남아 로딩이 걷힌 뒤 마우스를 움직이면 안 눌렀는데도 걸었다
     *   (2026-11-15 사장님 「마우스로 누르고 있는 상태에서 연결된 다른 맵으로 이동시 다음맵에서 왼쪽버튼을 누르지 않아도 자동으로 이동도는 문제가 있어.」)
     *   원본은 INT 33h 가 채운 «실제» 버튼 상태(0x7CF20)를 읽는다 — 뗀 버튼은 0 · 같은 뜻으로
     *   ① 움직일 때 실제 버튼(ev.buttons)이 떼어졌으면 바로잡고 ② 창 어디서 떼든 받는다 */
    function 뗌바로잡기(ev) {
      if (!버튼상태) return;
      var p = 환산(ev) || { x: 0, y: 0 };
      버튼상태 = 0;
      대기.push(마우스('뗌', p.x, p.y, 0));
    }
    function 움직임(ev) {
      if (버튼상태 && ev && typeof ev.buttons === 'number' && ev.buttons === 0) 뗌바로잡기(ev);   /* ① */
      var p = 환산(ev); if (p) 대기.push(마우스('움직임', p.x, p.y, 버튼상태));
    }
    var 버튼상태 = 0;
    function 누름(ev) {
      var p = 환산(ev); if (!p) return;
      버튼상태 = (ev.button === 0) ? 1 : (ev.button === 2 ? 2 : 3);
      var 사건 = 마우스('누름', p.x, p.y, 버튼상태);
      /* ☠★★★★★ **누른 그 순간의 마을 칸을 함께 싣는다** — `PACK 0x1D178`~`0x1D195`
       *   (2026-09-08 · 화면으로 잡았다)
       *
       *   원본은 마우스를 읽는 **그 프레임에서 곧바로** 칸으로 바꾼다 —
       *   `0x1D178 mov eax,[0x7CF28]` → `0x1D184 sar 4` → `0x1D195 add 카메라Y`.
       *   ☠ 우리는 「저수준 입력 → **여러 프레임 뒤** 의도 만들기 → 그때 칸 풀기」였다.
       *     그 사이에 걷기가 시작돼 **카메라가 움직여** 딴 칸이 됐다 —
       *     실측: 노린 칸 (13,5) 인데 처리될 때는 (13,4). 상자·진열품이 영영 안 열렸다.
       *   ★ 렌더가 남긴 `__마을카메라` 가 **지금 화면의 카메라**다. 그것으로 여기서 푼다. */
      try {
        var R = (typeof window !== 'undefined') ? window : null;
        if (R && R.G2TownObj && R.G2TownObj.마우스칸 && R.__상태 && R.__상태.town) {
          var 캠 = R.__마을카메라 || R.__상태.town.카메라;
          var 땅p = (R.G2마을3D && R.G2마을3D.칸용마우스) ? R.G2마을3D.칸용마우스({ x: p.x, y: p.y, 버튼: 버튼상태 }) : { x: p.x, y: p.y, 버튼: 버튼상태 };   /* 정본 219 — 3D 면 날 마우스(감싼 마우스칸이 한 번 옮긴다) */
          var _타 = R.__상태.town.twn, 매p = (R.G2마을3D && R.G2마을3D.매대칸 && _타 && _타.평면) ? R.G2마을3D.매대칸({ x: p.x, y: p.y }, _타.평면.D, _타.W | 0, _타.H | 0) : null;   /* 정본 219 — 3D 매대는 세운 상자 판으로 */   /* 리마스터 3D — 3D 화면에서 짚은 땅 칸 (11-06) */
          if (캠) 사건.칸 = 매p || R.G2TownObj.마우스칸(땅p,
                                                  캠, R.__상태.town.오프셋);
        }
      } catch (e) { /* 마을이 아니거나 모듈이 없으면 그냥 넘어간다 */ }
      대기.push(사건);
    }
    function 뗌(ev) {
      var p = 환산(ev); if (!p) return;
      버튼상태 = 0;
      대기.push(마우스('뗌', p.x, p.y, 0));
    }
    /** ★ 오른쪽 클릭 메뉴 차단 — 게임이 우클릭을 먹어야 한다 (2026-08-21).
     *   ★ 한때 이 함수를 **다른 클로저**의 `var 공급` 앞에 넣어
     *     `메뉴막기 is not defined` 로 화면이 통째로 안 떴다 (사용자 지적 2026-08-21).
     *     같은 이름의 `var 공급` 이 이 파일에 **둘** 있다 — 앵커로 쓸 때 조심할 것. */
    function 메뉴막기(ev) { if (ev && ev.preventDefault) ev.preventDefault(); return false; }
    /* ★ [리마스터 Z-89] 마우스 휠 — 원작(1996 도스)에는 휠이 없다. 지금 화면의 ▲/▼ 단추 자리를 «누르고 떼는» 것으로 넣어
     *   원본 단추와 같은 길(같은 판정·같은 상한)을 탄다. 어느 자리인지는 셸을 아는 쪽(옵션.휠단추)이 알려 준다 (2026-09-26)
     *   사장님: 「월드나 마을의 스탯, 전직창, 물품 판매창 등 스크롤이 있는 모든 곳에 마우스 휠로 조작이 가능하면 좋겠어.」 */
    var 휠단추 = 옵션 && 옵션.휠단추;
    var 휠스크롤 = 옵션 && 옵션.휠스크롤;
    var 휠손가락 = 옵션 && 옵션.휠손가락;   /* [리마스터] 터치패드(두 손가락 쓸기·벌리기) — 셸이 먼저 받는다 · 처리했으면 true (11-19) */
    function 휠(ev) {
      if (!ev) return;
      if (typeof 휠손가락 === 'function') {
        var 손 = null; try { 손 = 휠손가락(ev); } catch (e손) { 손 = null; }
        if (손 === true) { if (ev.preventDefault) ev.preventDefault(); return; }
        if (손 && typeof 손 === 'object' && 손.deltaY) ev = { deltaY: 손.deltaY, preventDefault: function () { } };   /* 모아 둔 한 칸 — 아래 마우스 휠 길로 */
        else if (손 === false) { /* 마우스 휠 — 그대로 */ }
        else if (손 === 0) { if (ev.preventDefault) ev.preventDefault(); return; }   /* 터치패드인데 아직 한 칸이 안 찼다 */
      }
      if (!ev.deltaY) return;
      /* ★ 상점 매각 목록·장비창은 스크롤 자리를 «직접» 한 줄씩 옮긴다 — 단추 누르기 흉내는 누름·뗌이 한 틱에
       *   몰려 마을 판정(눌린 것을 본 뒤 처리)이 못 봤다 (2026-10-03 사장님 「휠 … 적용안돼」) */
      if (typeof 휠스크롤 === 'function') {
        var 됨 = false; try { 됨 = !!휠스크롤(ev.deltaY < 0 ? -1 : 1); } catch (e휠2) { 됨 = false; }
        if (됨) { if (ev.preventDefault) ev.preventDefault(); return; }
      }
      if (typeof 휠단추 !== 'function') return;
      var 판 = null; try { 판 = 휠단추(); } catch (e휠) { 판 = null; }
      var d = 판 && (ev.deltaY < 0 ? 판.위 : 판.아래);
      if (!d) return;
      if (ev.preventDefault) ev.preventDefault();
      대기.push(마우스('누름', d.x, d.y, 1));
      대기.push(마우스('뗌', d.x, d.y, 0));
    }
    var 공급 = {
      잠금정책: 정책.잠금정책, 정책출처: 정책.정책출처,
      /** 창에 붙인다 — ★ 붙인 쪽이 `떼기()` 로 **반드시** 뗀다 (계약 §5-b 9번) */
      붙이기: function () {
        if (!창 || !창.addEventListener || 붙임) return 공급;
        창.addEventListener('keydown', 눌림, false);
        창.addEventListener('keyup', 떼짐, false);
        if (좌표 && 마우스대상 && 마우스대상.addEventListener) {
          마우스대상.addEventListener('mousemove', 움직임, false);
          마우스대상.addEventListener('mousedown', 누름, false);
          마우스대상.addEventListener('mouseup', 뗌, false);
          if (마우스대상 !== 창) 창.addEventListener('mouseup', 뗌바로잡기, false);   /* ② 정본 225 — 게임 화면 밖(로딩 덮개 위)에서 뗀 것 · 화면 안에서 뗐으면 뗌() 이 먼저 0 으로 놓아 여기선 그냥 지나간다 */
          /* ★★★ **오른쪽 클릭 메뉴를 막는다** (사용자 지적 2026-08-21:
           *   「우클릭시 자꾸 이미지를 다른이름으로 저장 모달 뜨는거 없앨 수 없어?」)
           *   원본에서 우클릭은 **취소·상세보기**라 게임이 먹어야 하는 입력이다.
           *   브라우저 기본 메뉴가 뜨면 그 위에 덮여 조작이 끊긴다. */
          마우스대상.addEventListener('contextmenu', 메뉴막기, false);
          마우스대상.addEventListener('wheel', 휠, { passive: false });
        }
        붙임 = true;
        return 공급;
      },
      떼기: function () {
        if (!창 || !창.removeEventListener || !붙임) return 공급;
        창.removeEventListener('keydown', 눌림, false);
        창.removeEventListener('keyup', 떼짐, false);
        if (좌표 && 마우스대상 && 마우스대상.removeEventListener) {
          마우스대상.removeEventListener('mousemove', 움직임, false);
          마우스대상.removeEventListener('mousedown', 누름, false);
          마우스대상.removeEventListener('mouseup', 뗌, false);
          if (마우스대상 !== 창) 창.removeEventListener('mouseup', 뗌바로잡기, false);
          마우스대상.removeEventListener('contextmenu', 메뉴막기, false);
          마우스대상.removeEventListener('wheel', 휠, { passive: false });
        }
        붙임 = null; 대기 = [];
        return 공급;
      },
      모으기: function (틱번호, 잠김) {
        if (잠김) {
          if (공급.잠금정책 === "폐기") { 버린수 += 대기.length; 대기 = []; }
          return [];
        }
        var 낸것 = 대기; 대기 = [];
        낸것.forEach(function (x) {
          이력.push(x.종류 === '마우스'
            ? { 틱: 틱번호, 종류: '마우스', 동작: x.동작, x: x.x, y: x.y, 버튼: x.버튼 }
            : { 틱: 틱번호, 종류: x.종류, 키: x.키 });
        });
        return 낸것;
      },
      비우기: function () { 대기 = []; return 공급; },
      이력: function () { return 이력.slice(); },
      대기수: function () { return 대기.length; },
      버린수: function () { return 버린수; },
      붙었나: function () { return !!붙임; }
    };
    return 공급;
  }

  var API = { 입력: 입력, 입력검증: 입력검증, 키들: 키들, 종류들: 종류들,
              마우스: 마우스, 마우스냐: 마우스냐, 마우스동작들: 마우스동작들,
              잠금정책들: 잠금정책들, 공급자검증: 공급자검증,
              주입공급자: 주입공급자, 무동작공급자: 무동작공급자, 브라우저공급자: 브라우저공급자 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.G2Input = API;

  /* ── [리마스터] 우클릭한 채 마우스를 끌면 3D 기울기 (2026-11-09) ─────────────────────
   *   사장님(원문) 「기울기 변경관련 우클릭 상태에서 마우스 움직이는게 어떨까 싶어.」
   *   · 전투·마을에서만 — 우클릭 «누름»을 잠깐 붙잡고, 5px 넘게 끌면 기울기(위로 끌면 커짐 · 0~80 — 패드 우스틱과 같은 방향·범위 · G2공유시점)
   *   · 안 끌고 떼면 붙잡은 우클릭을 그 자리에 그대로 넘긴다 — 원작 우클릭(누를 때 동작)은 뗄 때로 조금 늦을 뿐 같은 동작
   *   ★ 다시 넘기는 사건은 표시(__우끌넘김)를 달아 여기서 또 붙잡지 않는다 */
  if (typeof window !== 'undefined' && window.addEventListener && typeof document !== 'undefined') (function () {
    var 잡음 = null, 끌기문턱 = 5, 도당 = 0.25;   /* 1px 에 0.25° — 리마스터 · 써 보고 맞춤 */
    function 쓸화면() {
      try { var c = window.__셸 && window.__셸.현재 && window.__셸.현재(), h = c && (c.화면 || c.이름); return (h === 'BATTLE' || h === 'TOWN') && !!window.G2공유시점; } catch (e) { return false; }
    }
    window.addEventListener('mousedown', function (e) {
      if (e.button !== 2 || e.__우끌넘김 || !쓸화면()) return;
      if (e.target && e.target.closest && e.target.closest('#셸개발칸,.g2신고,input,select,textarea,button')) return;   /* 패널·창 안은 그대로 */
      잡음 = { x: e.clientX, y: e.clientY, 대상: e.target, 끎: false, 시작: window.G2공유시점.읽기('tilt') | 0, init: { clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY, button: 2, buttons: 2, bubbles: true, cancelable: true, view: window } };
      e.preventDefault(); e.stopImmediatePropagation();
    }, true);
    window.addEventListener('mousemove', function (e) {
      if (!잡음) return;
      if (!(e.buttons & 2)) { 잡음 = null; return; }
      var dy = e.clientY - 잡음.y;
      if (!잡음.끎 && Math.hypot(e.clientX - 잡음.x, dy) > 끌기문턱) 잡음.끎 = true;
      if (!잡음.끎) return;
      var 새 = Math.max(0, Math.min(80, Math.round(잡음.시작 - dy * 도당)));
      if (새 !== (window.G2공유시점.읽기('tilt') | 0)) {
        window.G2공유시점.쓰기('tilt', 새);
        if (typeof window.G2시점다시적용 === 'function') try { window.G2시점다시적용(); } catch (e시) { }
      }
    }, true);
    window.addEventListener('mouseup', function (e) {
      if (e.button !== 2 || !잡음) return;
      var 그것 = 잡음; 잡음 = null;
      if (그것.끎) { e.preventDefault(); e.stopImmediatePropagation(); return; }   /* 끌었으면 우클릭 동작 없음 */
      try {   /* 안 끌었으면 붙잡았던 누름을 그대로 — 뒤따르는 진짜 mouseup 은 그대로 흘러간다 */
        var ev = new MouseEvent('mousedown', 그것.init); ev.__우끌넘김 = true;
        (그것.대상 && 그것.대상.isConnected ? 그것.대상 : document.elementFromPoint(그것.x, 그것.y) || document.body).dispatchEvent(ev);
      } catch (e넘) { }
    }, true);
  })();
})(typeof globalThis !== 'undefined' ? globalThis : this);
