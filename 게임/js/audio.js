/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **소리 — 효과음 음소거 · BGM** (전투·셸 **공용**)
 *
 *  원래 `전투.html` 안에 있던 것을 **공유 모듈로 뺐다** (2026-08-22).
 *  사용자 지정: 「지금 옵션에 있는 항목들은 **전투랑도 연계**돼.
 *   스피드, bgm, fix(효과음)」 · 「지금 bgm 안불러와지고 있고,
 *   효과음 음소거 안되고(bgm도 안될걸로 추정)」
 *  ⇒ 셸(`게임.html`)에 이 시스템이 아예 없어서 옵션이 먹지 않았다.
 *
 *  ★ **복사가 아니라 이동**이다 — `전투.html` 도 이 파일을 읽는다.
 *    한쪽에서 고치면 양쪽에 반영된다.
 *
 *  ## 원본 근거
 *    효과음 음소거 `[0x8DAE6]` · BGM `[0x8DAE8]` (`0x4F369` / `0x4F3AE`)
 *    SCE BGM 번호 → 트랙 `0x4F375` · `0x4F38B` (n + 2)
 *    18(0x12) 이상이면 끈다.
 * ══════════════════════════════════════════════════════════════════════ */
(function (root) {
  'use strict';

  var Sfx = { muted: false, bgm: null };
  (function () {
    if (typeof HTMLMediaElement === 'undefined') return;
    var orig = HTMLMediaElement.prototype.play;
    /** 새로 생성된 효과음에도 현재 전체 음소거 상태를 적용한 뒤 원래 재생기를 호출한다. */
    HTMLMediaElement.prototype.play = function () {
      if (this !== Sfx.bgm) this.muted = Sfx.muted;      // ★ 새로 만들어진 것도 여기서 걸린다
      return orig.apply(this, arguments);
    };
  })();
  /** 효과음 전체 음소거. BGM 은 건드리지 않는다. */
  function setSfxMuted(on) {
    Sfx.muted = !!on;
    /* 이미 울리고 있는 것도 즉시 */
    var list = document.querySelectorAll('audio');
    for (var i = 0; i < list.length; i++)
      if (list[i] !== Sfx.bgm) list[i].muted = Sfx.muted;
    if (window.G2Fx && G2Fx.setVolume) try { G2Fx.setVolume(Sfx.muted ? 0 : 1); } catch (e) {}
  }
  window.__setSfxMuted = setSfxMuted;

  /* ── BGM — 원본은 **CD 오디오 트랙**을 돌린다 (`0x4F369`) ────────────────
   *
   * ```asm
   * 0x4F36B  cmp [0x8DAE8], 1 ; jne 끝        ; ★ 음악 꺼져 있으면 아무 일도 안 한다
   * 0x4F375  cmp [0x8F0B7], 0x12 ; jge 끝     ; ★ 번호가 18 이상이면 안 튼다
   * 0x4F37E  eax = [0x8F0B4] >> 24            ;   같은 바이트 = BGM 번호
   * 0x4F38B  add eax, 2                       ; ★ 트랙 = 번호 + 2
   * 0x4F390  call 0x5AEB5(eax, edx = 1, ebx = 0)   ; CD 재생
   * 0x4F3AE  cmp [0x8DAE8], 0 ; jne 끝 → 0x5AF1B   ; 정지
   * ```
   * 번호는 `.SCE` 헤더 `0x18A`(우리 `S['BGM']`). 0 → 트랙 2 … 17 → 트랙 19 로
   * 원본 CD 의 오디오 트랙 열여덟 개와 딱 맞는다.
   * ★ 2026-09-09 — **원본 CD(`.cue`+`.bin`)에서만 읽는다.** 추출본 `.ogg` 로
   *   물러나던 길을 없앴다(사장님 지정 · 아래 `url()` 주석).
   * ------------------------------------------------------------------------ */
  var Bgm = (function () {
    var el = null, cur = -1, enabled = true, blocked = false, hiddenWasPlaying = false;
    var playGeneration = 0;
    /* ★ 원본 CD 를 못 읽었나 — 추출본으로 물러나지 않으므로 «왜 조용한가»를 남긴다 */
    var CD못읽음 = false;
    /* ★ 창1 「용자의 무덤」처럼 **CD 트랙이 아닌 파일**을 틀 때 쓴다 (2026-09-08) */
    var 직접 = null;
    /* ★★★★★ **원본 CD 에서만 읽는다 — 추출본으로 물러나지 않는다** (2026-09-09)
     *
     *   > 사장님: 「배경음악은 **저렇게 추출해서 실행하면 안되고, 원본 cd를 직접
     *   >  마운트해서 불러와야해.** 저 파일에서 하게되면 **실행기 배포시 음원도
     *   >  포함해서 배포해야해.** … **원본 cd 경로만 지정하면(cue) 바로 거기에서
     *   >  로드**할 수 있어야해.」
     *
     *   서버가 `.cue` 를 읽어 `.bin` 에서 그 트랙만 잘라 WAV 로 내준다
     *   (`02_실행기/게임/server.js:688~` · CD 경로는 설정의 `CD경로` 나 원본 폴더).
     *
     *   ☠ 여기 **추출본 `.ogg` 로 갈아타는 길**이 있었다. CD 를 못 읽으면 조용히
     *     넘어가서, 잘 들리니 아무도 모르는 채 **음원을 배포에 끼워 넣게 되는**
     *     길이었다. 사장님이 그것을 막으라 하셨다. ⇒ 못 읽으면 **안 튼다.**
     *
     *   실측 2026-09-09 — `/CD/11` 이 35,790,428 바이트를 냈고,
     *   `GENESIS2.cue` 로 계산한 트랙 11(35,790,384 + WAV 머리 44)과 **똑같다.**
     *   원본 `GENESIS2.bin`(649,119,072 바이트 · 트랙 19개)에서 잘라 온 것이 맞다. */
    function url(n) { return '/CD/' + n; }
    var 합성곡 = null;   /* [11-09] 지금 OPL 로 연주 중인 창1 곡 이름 */
    function 합성멈춤() { if (합성곡 && root.G2G1Music) root.G2G1Music.멈춤(); 합성곡 = null; }
    function ensure() {
      if (el) return el;
      el = new Audio(); el.loop = true; el.volume = 0.6;
      Sfx.bgm = el;                                    // ★ 이것만 효과음 음소거에서 뺀다
      el.addEventListener('error', function () {
        if (직접) return;                                /* 창1 음악은 파일 주소로 튼다 */
        /* ★ 물러날 곳이 없다 — 원본 CD 를 못 읽으면 **안 튼다**(2026-09-09 사장님 지정).
         *   조용히 죽으면 「음악이 원래 없나 보다」로 오해하시므로 무엇을 어디에
         *   두면 되는지까지 찍는다. */
        CD못읽음 = true;
        /* 정본 410 — 까닭(CD 경로·/CD 응답·설치 폴더)을 하루 한 번 저절로 보낸다(bug_report.js 배경음진단보내기) */
        try { if (root.G2버그신고 && root.G2버그신고.배경음진단보내기) root.G2버그신고.배경음진단보내기('트랙 ' + cur + ' 재생 오류 ' + (el && el.error ? el.error.code + ' ' + (el.error.message || '') : '')); } catch (e진) { }
        console.warn('[BGM] 원본 CD 를 못 읽었습니다 — 트랙 ' + cur + ' 을 안 틉니다.\n' +
                     '  원본 CD 이미지(GENESIS2.cue + GENESIS2.bin)가 있어야 합니다.\n' +
                     '  둘 곳: 원본 게임 폴더, 또는 설정의 「CD경로」가 가리키는 폴더.\n' +
                     '  ☠ 추출해 둔 Track**.ogg 로는 물러나지 않습니다 — 배포에 음원을\n' +
                     '     끼워 넣게 되기 때문입니다(사장님 지정 2026-09-09).');
      });
      return el;
    }
    function start() {
      if (!enabled) return;
      /* ★ 2026-09-24 (사장님: 「기본 옵션이 꺼져있어도 처음 게임 시작시 bgm이 재생되는 문제 … 다시 끄면 적용되는데」)
       *   원본 재생 함수는 **틀 때마다** 음악 깃발을 본다 — COMBATII 0x4F36B `cmp [0xFDAE8],1 / jne` ·
       *   PACK·CHP 도 같은 깃발(GAME.CFG). 우리는 옵션 화면에서 바꿀 때만 `enabled` 를 맞춰서,
       *   게임을 켠 직후 첫 곡(월드 11 등)은 저장된 「꺼짐」을 모른 채 났다. ⇒ 설정 값을 여기서 본다. */
      var O = root.G2Opt;
      if (O && O.cfg && O.cfg.music === false) return;
      var u = 직접 || (cur >= 2 ? url(cur) : null);
      if (!u) return;
      /* [11-09] 창1 음악은 실행 때 .IMS 를 OPL 로 연주한다(js/g1music.js · 우리 OPL 흉내 js/opl.js) — 구운 ogg 를 안 쓴다
       *   사장님 「창1 음악과 용자의무덤맵은 창세기전1 설치폴더나 설치 cd에서 추출해서 적용할 수 있도록 하면 좋겠어.」 · OPL 은 답 «직접 만들기» */
      var 창1 = /창1음악\/([^\/?]+)\.ogg/.exec(decodeURIComponent(String(u)));
      if (창1 && root.G2G1Music) {
        if (el) try { el.pause(); } catch (e) {}
        if (합성곡 !== 창1[1]) {
          합성곡 = 창1[1];
          root.G2G1Music.연주(창1[1], 0.6).catch(function (e) { 합성곡 = null; console.warn('[BGM] 창1 음악 연주 실패 — ' + (e && e.message)); });
        }
        blocked = false; return;
      }
      합성멈춤();
      ensure();
      var generation = ++playGeneration;
      if (el.getAttribute('src') !== u) { el.setAttribute('src', u); el.src = u; }
      var pr = el.play();
      if (pr && pr.then) pr.then(function () {
        if (generation === playGeneration) blocked = false;
      }, function () {
        if (generation === playGeneration) blocked = true;
      });   // 종료되거나 교체된 재생 요청의 늦은 결과는 무시
      else blocked = false;
    }
    return {
      /** SCE BGM 번호로 튼다. 18 이상이면 끈다 (0x4F375). */
      set: function (no) {
        var n = no | 0;
        직접 = null;
        if (n < 0 || n >= 0x12) { this.stop(); cur = -1; return; }
        cur = n + 2;                                    // 0x4F38B
        start();
      },
      /* ★★★★★★★ **CD 트랙을 «번호 그대로» 튼다** — `PACK`·`CHP` 는 +2 를 안 한다
       *   (2026-09-22)
       *
       *   ☠ 위 `set(no)` 은 **전투(`COMBATII`) 규칙**이다 — `.SCE` 헤더의 BGM 번호를 받아
       *     `0x4F38B add eax, 2` 로 트랙을 만든다.
       *   ★ 마을(`PACK`)·월드(`CHP`)는 **트랙 번호를 그대로** 넘긴다 —
       *     표를 채우는 자리가 `TOC 트랙 번호`로 색인한다
       *     (`PACK 0x39E01 edx = 1` → `0x39E19 ebx = edx*4` → `0x39E23`/`0x39E49`).
       *     데이터 트랙(제어 바이트 `0x40`)은 `0x39E10`/`0x39E17` 이 건너뛰므로
       *     색인이 밀리지도 않는다.
       *   ⇒ 두 규칙을 **창구로 갈라 둔다.** 섞어 쓰면 두 칸씩 어긋난다. */
      setTrack: function (t) {
        var n = t | 0;
        직접 = null;
        if (n < 2 || n > 19) { this.stop(); return; }   /* 오디오 트랙은 2~19 뿐이다 */
        cur = n;
        start();
      },
      /* ★★★★★ **창1 음악을 파일 주소로 튼다** (2026-09-08 · 사장님 T2 지정)
       *
       *   > 「**창세기전1 필요한 음원을 적용폴더에 넣고 거기에서 불러올 수 있도록 해.**」
       *
       *   「용자의 무덤」은 창세기전1 곡을 쓴다. 창2 CD 트랙 번호로는 가리킬 수 없어
       *   `/원본/창1음악/3.ogg` 처럼 **파일을 곧바로** 준다.
       *   원본 `.IMS`(애드립 FM 시퀀스)를 `04_도구/창1음악_굽기.js` 로 미리 구운 것이다. */
      setUrl: function (u) {
        직접 = u || null; cur = -1;
        if (!직접) { this.stop(); return; }
        start();
      },
      setEnabled: function (on) {
        enabled = !!on;
        if (!enabled) { 합성멈춤(); if (el) try { el.pause(); } catch (e) {} }      // 0x5AF1B
        else start();                                                   // 0x4F369
      },
      // 음소거(setEnabled)와 종료를 구분: 종료 후 입력/가시성 복귀로 옛 곡을 재생하지 않는다.
      stop: function () {
        ++playGeneration;
        cur = -1; 직접 = null; blocked = false; hiddenWasPlaying = false; 합성멈춤();
        if (el) try { el.pause(); } catch (e) {}
        /* ★ 2026-09-24 — 원본 정지(COMBATII 0x5AF1B → 0x5AF42 명령 0x85 Stop Audio) 뒤의 재생은 곡 **처음부터**다.
         *   되감지 않으면 같은 곡을 다시 틀 때 멈춘 자리부터 이어졌다. */
        if (el) try { el.currentTime = 0; } catch (e) {}
      },
      pauseForVisibility: function () {
        hiddenWasPlaying = !!(el && !el.paused) || !!합성곡; 합성멈춤();
        if (hiddenWasPlaying) try { el.pause(); } catch (e) {}
      },
      resumeFromVisibility: function () {
        if (!hiddenWasPlaying) return;
        hiddenWasPlaying = false;
        start();
      },
      /** 자동재생이 막혔으면 첫 입력에 다시 시도한다 (브라우저 정책). */
      kick: function () { if (blocked) { blocked = false; start(); } },
      get track() { return cur; },
      get file() { return 직접; },
      get source() { return CD못읽음 ? '원본 CD 를 못 읽었다' : '원본 CD 직독'; },
      get cdFailed() { return CD못읽음; },
      get playing() { return !!(el && !el.paused) || !!합성곡; }
    };
  })();
  window.__Bgm = Bgm;
  if (typeof document !== 'undefined' && document.addEventListener) {
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) Bgm.pauseForVisibility();
      else Bgm.resumeFromVisibility();
    });
  }
  ['pointerdown', 'keydown'].forEach(function (t) {
    addEventListener(t, function () { Bgm.kick(); }, true);
  });

  /* ★ 전역 이름은 **예전 그대로** 둔다 — `전투.html` 의 나머지 코드가 이 이름을 쓴다. */
  root.Sfx = Sfx;
  root.setSfxMuted = setSfxMuted;
  root.Bgm = Bgm;
  root.G2Audio = { Sfx: Sfx, setSfxMuted: setSfxMuted, Bgm: Bgm };
})(typeof globalThis !== 'undefined' ? globalThis : this);
