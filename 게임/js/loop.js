/* ============================================================
 *  **브라우저 루프** — RAF 는 **스케줄러로만** 쓴다 (계약 §5-d 4·9번 · U0-3)
 *
 *  ★★★ GPT 33차가 못박은 것:
 *  · RAF 가 주는 `timestamp` 를 **틱이나 화면에 전달하지 않는다**
 *  · **`Date.now()` 로 경과를 계산하지 않는다**
 *  · 셸에는 **고정 `논리dt`** 만 준다
 *  · 게임 결과는 「RAF 가 몇 ms 였나」가 아니라 **「논리 틱을 몇 번 돌렸나」**로만 정해진다
 *  · 한 RAF 에서 정한 수만큼 틱을 돌린 뒤 **따로 한 번 렌더**한다
 *
 *  최소 단계에서는 **RAF 1회당 논리 틱 1회**가 가장 단순하다. 나중에 보정 루프가
 *  필요해져도 **벽시계는 「몇 틱 돌릴지」를 정하는 바깥 스케줄러에서만** 보고,
 *  각 틱에는 계속 **고정 `dt`** 를 준다.
 *
 *  ★ 시험은 **가짜 RAF** 를 주입해 콜백을 직접 부른다 — 실제 시간을 안 기다린다.
 * ============================================================ */
'use strict';
(function (root) {

  var SH = (typeof module !== 'undefined' && module.exports) ? require('./shell.js') : root.G2Shell;

  /**
   * 루프를 만든다.
   *
   * @param 옵션 `{셸, 렌더러, RAF, 취소RAF, 틱수, 틱Hz, 시계, 몰아치기상한, 멈출까}`
   *   · `RAF`/`취소RAF` 를 안 주면 전역 `requestAnimationFrame` 을 쓴다
   *     (없으면 루프를 시작할 수 없다 — 시험은 **가짜**를 주입한다)
   *   · `틱수` — 한 프레임에 돌릴 논리 틱 수 (기본 1)
   *   · `틱Hz` — ★★★★★ **주면 벽시계로 「몇 틱 돌릴지」를 정한다** (아래)
   *   · `시계` — `틱Hz` 를 쓸 때 현재 ms 를 주는 함수 (기본 `performance.now`)
   *   · `몰아치기상한` — 한 프레임에 돌릴 최대 틱 수 (기본 4)
   *   · `멈출까(결과)` — 참이면 루프를 멈춘다 (기본: 끝 화면·멈춤이면 멈춘다)
   *
   * ★★★★★★★ **`틱Hz` 는 왜 필요한가** (2026-09-03)
   *
   *   `RAF 1 회 = 틱 1 회` 로 두면 **논리 틱이 모니터 주사율을 그대로 탄다.**
   *   실측 — 이 컴퓨터는 **144.9 Hz** 였다. 원본은 **70 Hz 고정**이다.
   *
   *   ```asm
   *   CHP 0x23253  call 0x1DA88        ; 메인 루프 한 바퀴에 화면 출력 **한 번**
   *   0x1DA98  inc ecx
   *   0x1DA99  cmp ecx, [0xC5C58]      ; 폴링 상한 (Speed 0 = 9,000,000)
   *   0x1DAA1  in al,dx / test al,8 / je 0x1DA98   ; ★ 수직 귀선 **1 회** 대기
   *   ```
   *   mode 13h 는 **70 Hz** ⇒ **원본의 한 바퀴 = 1/70 초 = 14.286 ms.**
   *   ⇒ 144 Hz 화면에서 우리 실행기는 **2.07 배 빠르게** 돌고 있었다.
   *     게다가 **모니터마다 게임 속도가 달랐다.**
   *
   *   ★ 결정론 계약은 그대로다 — 벽시계는 **「몇 틱 돌릴지」에만** 쓰고,
   *     틱 하나하나에는 계속 **고정 `dt`** 를 준다 (이 파일 머리 주석 · GPT 33 차).
   *   ★ `틱Hz` 를 **안 주면 예전과 똑같이** 돈다 — 기존 시험이 안 깨진다.
   */
  function 만들기(옵션) {
    옵션 = 옵션 || {};
    var 셸 = 옵션.셸;
    if (!셸) throw new Error('루프에 셸이 없다');
    var 렌더러 = 옵션.렌더러 || null;
    var 틱수 = (옵션.틱수 != null) ? 옵션.틱수 : 1;
    var 틱Hz = (옵션.틱Hz != null) ? 옵션.틱Hz : null;
    var 끝났을때 = (typeof 옵션.끝났을때 === 'function') ? 옵션.끝났을때 : null;   /* 끝 화면에 닿아 멈춘 뒤 한 번 (앱은 EXIT 면 창을 닫는다 · 11-19) */
    if (틱Hz != null && !(틱Hz > 0)) throw new Error('틱Hz 는 0 보다 커야 한다 — ' + 틱Hz);
    var 틱ms = (틱Hz != null) ? (1000 / 틱Hz) : null;
    var 몰아치기상한 = (옵션.몰아치기상한 != null) ? 옵션.몰아치기상한 : 4;
    var 몰아치기배 = 1;   /* 빨리감기·배속으로 박자를 올리면 상한도 같은 배수로 — 틱Hz설정 둘째 인자 (정본 380) */
    var 시계 = 옵션.시계 || (typeof root.performance !== 'undefined'
                             && root.performance && typeof root.performance.now === 'function'
                             ? function () { return root.performance.now(); }
                             : function () { return Date.now(); });
    var RAF = 옵션.RAF || (typeof root.requestAnimationFrame === 'function'
                           ? root.requestAnimationFrame.bind(root) : null);
    var 취소RAF = 옵션.취소RAF || (typeof root.cancelAnimationFrame === 'function'
                                   ? root.cancelAnimationFrame.bind(root) : null);
    /* ★ 무엇이 「치명적」인가 (GPT 34차 3·7번)
     *   · **정상 종료** — 끝 화면(`r.끝`)에 닿았다
     *   · **비정상 종료** — 화면이 던졌거나(`r.중단`) 자원 해제가 실패했거나 미구현이다
     *   · **치명적이 아님** — `머묾`(입력 대기) · `적재중`(자산 대기) · `복귀` */
    var 멈출까 = 옵션.멈출까 || function (r) {
      if (!r) return false;
      if (r.끝) return true;                       /* 정상 종료 */
      if (r.적재중 || r.머묾 || r.복귀) return false;
      return !!r.멈춤;
    };

    var 돌고있나 = false, 손잡이 = null, 프레임수 = 0, 마지막 = null;
    var 누적ms = 0, 지난때 = null, 틱수합 = 0;

    /** 이번 프레임에 돌릴 틱 수를 정한다 — ★ 벽시계는 **여기서만** 본다 */
    function 이번틱수() {
      if (틱ms == null) return 틱수;               /* 예전 그대로 */
      var 이제 = 시계();
      if (지난때 == null) { 지난때 = 이제; return 1; }   /* 첫 프레임은 한 틱 */
      var 경과 = 이제 - 지난때;
      지난때 = 이제;
      if (!(경과 >= 0)) 경과 = 0;                  /* 시계가 뒤로 갔을 때 */
      누적ms += 경과;
      /* ★ 탭이 뒤에 있다 돌아오면 경과가 몇 초씩 쌓인다 —
       *   몰아쳐 돌리면 연출이 순간이동한다. 상한을 두고 나머지는 버린다. */
      var n = Math.floor(누적ms / 틱ms);
      /* ☠ 상한을 고정 4 로 두면 박자를 ×4 로 올려도 «화면 한 장에 4 걸음»에서 잘린다 — 휴대폰(30 장/초)에선 ×4 가 거의 안 먹었다
       *   (사장님 11-22 「모바일에서 r1 가속이 잘 안먹는 느낌이야. 표시는 뜨는데 빨라지지 않는달까」 · 정본 380) ⇒ 올린 배수만큼 상한도 올린다 */
      var 상한 = Math.ceil(몰아치기상한 * 몰아치기배);
      if (n > 상한) { n = 상한; 누적ms = 0; }
      else 누적ms -= n * 틱ms;
      return n;
    }

    /** 한 프레임 — ★ `timestamp` 를 **받지도 쓰지도 않는다** */
    function 한프레임() {
      프레임수++;
      var r = null;
      var n = 이번틱수();
      for (var i = 0; i < n; i++) {
        r = 셸.한걸음();
        틱수합++;
        마지막 = r;
        if (멈출까(r)) break;
      }
      /* ★ 틱을 다 돌린 **뒤에 따로 한 번** 렌더한다 (계약 §5-d 9번)
       *
       * ★★★★★ **틱이 0 번 돌았으면 그리지 않는다** (2026-09-03)
       *   원본의 한 바퀴는 **그리기 1 회 + vsync 1 회**다(`0x22D5F`·`0x23253`).
       *   곧 **원본은 70 Hz 로 그린다.** 우리가 RAF 마다(144 Hz) 그리면
       *   ① 같은 그림을 두 번 그려 CPU 를 버리고
       *   ② ★ **렌더 안에서 전진하는 연출**이 그만큼 빨라진다 —
       *      `게임.html` 의 맵 로드 **줌아웃**(`0x22C97`)이 그렇다.
       *   `틱Hz` 를 안 주면 `n >= 1` 이라 예전과 똑같이 매 프레임 그린다. */
      if (렌더러 && n > 0) 셸.렌더(렌더러);
      return r;
    }

    function 다음예약() {
      if (!돌고있나) return;
      손잡이 = RAF(function () { 돌기(); });
    }

    function 돌기() {
      if (!돌고있나) return;                       /* 멈춘 뒤 남은 콜백은 무시 */
      var r = 한프레임();
      if (멈출까(r) || (셸.끝났나 && 셸.끝났나())) { 멈추기(); if (끝났을때 && 셸.끝났나 && 셸.끝났나()) { try { 끝났을때(); } catch (e끝) { } } return; }
      다음예약();
    }

    function 시작() {
      if (돌고있나) return 루프;                   /* ★ 두 번 시작해도 중복 예약 안 한다 */
      if (!RAF) throw new Error('requestAnimationFrame 이 없다 — 루프를 시작할 수 없다');
      돌고있나 = true;
      /* ★ 멈췄다 다시 시작할 때 그 사이 시간이 몰아치지 않게 시계를 다시 잡는다 */
      지난때 = null; 누적ms = 0;
      다음예약();
      return 루프;
    }

    function 멈추기() {
      if (!돌고있나) return 루프;
      돌고있나 = false;
      if (손잡이 != null && 취소RAF) 취소RAF(손잡이);
      손잡이 = null;
      return 루프;
    }

    var 루프 = {
      시작: 시작, 멈추기: 멈추기,
      한프레임: 한프레임,
      돌고있나: function () { return 돌고있나; },
      프레임수: function () { return 프레임수; },
      틱수합: function () { return 틱수합; },      /* ★ 진단·시험용 — 논리 틱을 몇 번 돌렸나 */
      틱Hz: function () { return 틱Hz; },
      /**
       * ★★★★★★★ **박자를 바꾼다** — 원본 Speed 옵션이 이것을 한다 (2026-09-03)
       *
       *   `CHP 0x236E9` 는 `[0xC5C58]`(vsync 폴링 상한)**만** 바꾼다 —
       *   걸음 크기도 걸음 횟수도 안 건드린다(참조 6 곳 전수 확인).
       *   곧 원본의 「빠름」은 **루프 전체를 빠르게 도는 것**이지
       *   특정 연출만 두 배로 하는 것이 아니다.
       *
       *   ★ 쌓여 있던 `누적ms` 는 버린다 — 박자가 바뀌는 순간에 몰아치면 안 된다.
       */
      틱Hz설정: function (n, 배) {
        몰아치기배 = (배 > 1) ? 배 : 1;
        if (n == null) { 틱Hz = null; 틱ms = null; }
        else {
          if (!(n > 0)) throw new Error('틱Hz 는 0 보다 커야 한다 — ' + n);
          틱Hz = n; 틱ms = 1000 / n;
        }
        누적ms = 0; 지난때 = null;
        return 틱Hz;
      },
      마지막: function () { return 마지막; }
    };
    return 루프;
  }

  var API = { 만들기: 만들기 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.G2Loop = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
