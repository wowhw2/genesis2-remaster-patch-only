/**
 * ★ `전투.html` 인라인에서 옮겼다 — 통합 6단계 (2026-08-23)
 *   셸(`게임.html`)과 전투 실행기가 **같은 파일**을 읽는다.
 *   코드는 **한 줄도 고치지 않았다** — `<script>` 태그만 벗겼다.
 */
/* 원본 직독 자산 — 서버가 /원본/ 을 패치(06_패치/적용) 우선으로 내려주고, 브라우저가 직접 디코드.
 * 포트레이트·상태창 창틀을 게임 파일에서 바로 그린다(추출 PNG 미사용). 실패하면 기존 자산 폴백. */
(async function () {
  try {
    if (!window.G2Native) return;
    var A = G2Hud;
    if (!A || !A.setNative) return;
    async function grab(name) { var r = await fetch(G2URL(name)); if (!r.ok) throw new Error(name + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); }
    function 현재렌더러() {
      var B = window.G2BattleRuntime;
      return B && B.렌더러 ? B.렌더러() : null;
    }
    /* ★ 날씨가 걸린 전투는 팔레트가 다르다 (0x12824C 실측 · native.js 전투팔레트)
     *
     *   ☠★★★★★ **바탕(날씨 안 걸린 것)을 따로 쥔다** (2026-09-10)
     *     이 블록은 `await fetch` 때문에 **시나리오가 실린 뒤에 끝날 때도 있고
     *     그 전에 끝날 때도 있다.** 그래서 `pal` 에 날씨가 걸려 있을 수도, 없을 수도
     *     있다. 걸린 것을 바탕으로 삼으면 전투에 들어갈 때 **두 번 걸린다**
     *     (실측 — 1-1 노랑이 (195,178,89) 여야 하는데 (154,142,69) 가 됐다).
     *   ⇒ **바탕은 `decodePalette` 결과 그대로**, 날씨는 `날씨적용()` 이 건다. */
    var 바탕 = G2Native.decodePalette(await grab('GENESIS.PAL'));
    var pal = G2Native.전투팔레트(바탕);
    /* ★★★ **팔레트와 소형 폰트를 원본 직독으로 쥐여 준다** (2026-08-23)
     *
     *   전에는 둘 다 추출 번들(`자산/ui.json` + `ui/text_chr_sheet.png`)에만 의존했다.
     *   셸(`게임.html`)은 `/02_실행기/게임/자산/…` 을 찾아 **404** 였고, 그래서
     *   `assets.json` 이 null → `_preload()` 미실행 → `sheet` 가 null →
     *   `tinted()` 가 늘 null → **소형 폰트로 그리는 것이 통째로 안 보였다**
     *   (LV/HP/MP/EXP 값 · 직업명 · 데미지 숫자). 사용자 지적 2026-08-23.
     *   TEXT.CHR = 0x5F874 · 0x608E6 · 틴팅 0x5F093. */
    A.setBasePalette(바탕);       /* ★ 날씨는 `applyWeatherPalette()` 가 여기서 다시 만든다 */
    A.setPalette(pal);
    /* ★ 이 블록이 **전투에 들어간 뒤에** 끝날 수도 있다 — 그때는 위 `pal` 이 이미
     *   낡았다. 지금 시나리오 날씨로 한 번 더 맞춘다(같은 값이면 그대로다). */
    if (A.applyWeatherPalette) A.applyWeatherPalette();
    pal = A.palette() || pal;     /* ★ 아래 그림들은 **맞춘 팔레트**로 굽는다 */

    /* ══════════════════════════════════════════════════════════════════
     *  ★★★★★ **팔레트로 굽는 일은 「다시 부를 수 있게」 모아 둔다** (2026-09-10)
     *
     *  > 사장님: 「**링 아이콘, 커서, 페이즈 배너도 다시 굽게 고쳐.**」
     *
     *  원본 `0x1077A` 는 전투 날씨에 맞춰 팔레트 **256색 전부**를 DAC 에 쓴다.
     *  이 블록은 **부팅 때 한 번만** 돌아서, 한 판에서 날씨가 다른 전투를 잇달아
     *  하면 링 아이콘·커서·마커·선택상자가 **처음 날씨를 그대로** 쓰고 있었다.
     *
     *  ⇒ **읽고 푸는 것**(느리다·팔레트와 무관)과 **굽는 것**(빠르다·팔레트에 달렸다)을
     *    가른다. 굽는 쪽만 `굽기등록()` 으로 모아 두고, 전투에 들어갈 때
     *    `window.__G2자산_날씨적용()` 이 **다시 판다.** 파일은 다시 안 읽는다.
     * ══════════════════════════════════════════════════════════════════ */
    var 굽기목록 = [];
    /* ★ 정본 400 — 프레임들을 주면 «그 그림이 실제로 쓰는 색 칸»의 팔레트 값이 지난번과 같을 때(+ 같은 렌더러 · 같은 스케일러) 다시 굽지 않는다
     *   굽는 결과는 그 색 칸 값에만 달려 있다(frameToCanvas/frameToImageData 가 idx 칸의 팔레트만 읽는다) — 결과가 정확히 같다
     *   ☠ 전투 중 날씨가 바뀔 때마다 커서 12장·턴 표시 8장·선택 상자 모서리 4장을 다시 만들고 PNG 로 바꿨다 — 휴대폰 흉내(CPU×6) 약 50ms 가
     *     첫 팔레트 걸음과 한 장에 겹쳐 200~250ms (사장님 11-23 「날씨 전환 남은 거 줄여」) · 렌더러가 바뀌면(새 전투) 예전처럼 굽는다 · 끄기 window.__자산색같아도굽기 */
    function 쓰는색(프레임들) {
      var 있음 = {}, 목 = [];
      (프레임들 || []).forEach(function (fr) {
        var idx = fr && fr.idx; if (!idx) return;
        for (var i = 0; i < idx.length; i++) { var c = idx[i]; if (c >= 0 && !있음[c]) { 있음[c] = 1; 목.push(c); } }
      });
      return 목.sort(function (a, b) { return a - b; });
    }
    function 굽기등록(fn, 프레임들) {
      if (Array.isArray(fn)) { var 앞 = fn; fn = 프레임들; 프레임들 = 앞; }   /* 굽기등록(프레임들, fn) 꼴도 받는다 */
      var 색들 = 프레임들 ? 쓰는색(프레임들) : null, 열쇠 = null, 구운렌더러 = null;
      var 감싼 = function (p, 날씨) {
        var k = null;
        if (색들) {
          var 값 = [];
          for (var i = 0; i < 색들.length; i++) { var c = 색들[i]; 값.push(p[c * 3], p[c * 3 + 1], p[c * 3 + 2]); }
          k = 값.join(',') + '|' + (window.G2Scaler && G2Scaler.cur ? G2Scaler.cur() : '');
        }
        var 렌 = 현재렌더러();
        if (k && 날씨 && !window.__자산색같아도굽기 && k === 열쇠 && 렌 === 구운렌더러) return;
        fn(p, 날씨);
        열쇠 = k; 구운렌더러 = 렌;
      };
      굽기목록.push(감싼);
      try { 감싼(A.palette() || pal); } catch (e굽) { console.warn('자산 굽기 실패:', e굽 && e굽.message); }
    }
    /** 전투에 들어갈 때마다 부른다 — 날씨가 그대로면 색도 그대로다. */
    window.__G2자산_날씨적용 = function () {
      if (A.applyWeatherPalette) A.applyWeatherPalette();
      var p2 = A.palette(); if (!p2) return 0;
      var n = 0;
      for (var qi = 0; qi < 굽기목록.length; qi++) {
        try { 굽기목록[qi](p2, true); n++; } catch (e2) {   /* 둘째 값 true = 날씨 다시 굽기(안 보이는 것은 미뤄도 된다 · 정본 400) */ console.warn('자산 다시굽기 실패:', e2 && e2.message); }
      }
      return n;
    };
    try { A.setTextchr(G2Native.decodeTextchr(await grab('TEXT.CHR'))); }
    catch (eT) { console.warn('TEXT.CHR 직독 실패:', eT && eT.message); }
    /* 한글 이름 등 — 원본 NEWHAN.FNT 조합형 픽셀폰트 */
    try { G2Hud.setNativeKorean(G2Native.decodeNewhan(await grab('NEWHAN.FNT'))); }
    catch (e3) { console.warn('NEWHAN 로드 실패:', e3 && e3.message); }
    /* ETC.ICO — 페이즈 배너(8·9·10)와 **행동 가능 마커**(0~7). 추출 PNG 는 색 0 을
     * 투명으로 구워 테두리가 뚫립니다(할일 14-c 와 같은 병) — 직독으로 씁니다. */
    /* ★★★ **HUD 가 쓰는 자산은 전부 원본 직독이어야 한다** (2026-08-24)
     *
     *   사용자 지정: 「**모든 소스 원본과 적용폴더에서만 적용되어야해.**」
     *              「티피 구체 적용 안돼」 「폰트 말고 다른것도 살펴봐 턴마커나 티피구체 등」
     *
     *   `Assets.frame()` 은 native 가 등록돼 있으면 **그쪽을 우선** 쓰므로,
     *   여기 이름을 올리는 것만으로 추출 번들 PNG 갈래를 벗어난다.
     *
     *   전에 빠져 있던 둘:
     *     · TIME_GRA.SYB  TP/시계 **구체 틀** — 0x45844(시계) · 0x45686(행동력)
     *                     hud.js 629 에 「아직 직독으로 안 올라온 자산」이라 적혀 있었다.
     *                     번들 PNG 에만 의존해 셸에서 404 → **장식 없는 민무늬 원**만 나왔다
     *                     (같은 지적을 2026-08-14 에도 받았다).
     *     · PORTSMAL.SYF  작은 초상화
     *   ETC.ICO 는 페이즈 배너(8~10)와 **행동 가능 마커**(0~7) = 턴 마커다. */
    /* ★ `ui.json` 이 안고 있던 11종을 **전부** native 로 올린다 — 번들 PNG 갈래를 안 탄다.
     *   (TEXT.CHR 은 위에서 setTextchr 로 따로 굽는다) */
    /* ★ 'G2MSG.SYB' 가 **맨 앞**이다 — 로딩 화면(0x44C1B)이 그것으로 그린다.
     *   원본은 프로그램 시작부터 메모리에 있어 곧바로 찍지만, 우리 셸은 전투마다
     *   받으므로 늦게 오면 로딩 화면이 **까맣게** 뜬다 (2026-08-27 실측). */
    var files = ['G2MSG.SYB', 'PORTRAIT.SYF', 'PORTSMAL.SYF', 'MENUSTAT.SYB', 'FRAME.SYB',
                 'ETC.ICO', 'TIME_GRA.SYB', 'CHR_EFFC.SYB',
                 'MAIN.CUR', 'MOVE.CUR'];
    /* [11-09] 직독 대상 — 다 실릴 때까지 hud Assets.frame 이 추출 PNG(자산/ui/…)로 물러나지 않는다 (배포 묶음엔 PNG 가 없다 · 사장님 「모든거 원본에서 로드한다고 했는데」) */
    A.직독대상 = {}; files.forEach(function (f) { A.직독대상[f] = true; });
    for (var i = 0; i < files.length; i++) {
      /* ★★★★★ **`.SYB` 는 `decodeSYB` 로 푼다 — `decodeNC2` 는 무압축 갈래가 없다** (2026-08-24)
       *
       *   사용자 지적: 「**티피 구체 디코딩 방식 잘못되어서 깨졌어.**」
       *
       *   `.SYB` 프레임 본문은 두 가지다:
       *     · RLE 압축      → decodeRLE
       *     · **무압축**    → 본문이 `w(u16) h(u16) + w*h` 이고 0xFF 가 투명
       *                      (`SYB무압축인가` / `SYB무압축풀기`)
       *   `decodeNC2` 는 **무압축 갈래가 없어** 무압축 본문을 RLE 로 잘못 풀어 깨진다.
       *
       *   원본 10종을 전수 대조한 결과 (04_도구 검사 · 2026-08-24):
       *     TIME_GRA.SYB  13프레임 **전부 무압축**  ← 구체가 깨진 까닭
       *     나머지 9종    무압축 0 (전부 RLE) → 두 디코더 결과가 **완전히 같다**
       *   ⇒ `decodeSYB` 가 상위 호환이므로 전부 이쪽으로 통일한다. */
      /* ★ 여기 올린 것은 `Assets.날씨적용()` 이 팔레트를 갈고 캐시를 비운다 —
       *   `image()` 가 다음에 다시 굽는다. 그래서 굽기목록에 안 넣는다. */
      try { var d = G2Native.decodeSYB(await grab(files[i])); if (d) A.setNative(files[i], d.frames, pal); }
      catch (e2) { console.warn('원본 자산 로드 실패:', files[i], e2 && e2.message); }
    }
    console.log('원본 직독 자산 로드:', files.join(', '));

    /* 행동 가능 마커(0x12240~0x12273)에 쓸 ETC.ICO 0~7 을 캔버스로 넘깁니다.
     * 진영 1 이고 AI 가 아니면 0~3, 그 밖은 4~7 (0x12246 / 0x1224F). */
    try {
      /* ★★★★★ **R 이 아직 없어도 아이콘을 버리지 않는다** (2026-08-24)
       *   사용자 지적: 「아직도 턴 마커는 표시 안돼. 아군 적 모두」
       *   전에는 `window.R` 이 없으면 **디코드 결과를 통째로 버렸다.**
       *   셸은 조각을 동적으로 싣고 `battle_main.js` 도 async 라 R 이 늦게 생긴다.
       *   ⇒ 아이콘은 항상 만들어 전역(`__G2_ETC_ICONS`)에 두고, R 이 있으면 바로 넣는다.
       *     `Renderer` 생성자가 그 전역에서 스스로 되찾으므로 체인·재구성에도 살아남는다. */
      var ei = G2Native.decodeNC2(await grab('ETC.ICO'));
      if (ei) 굽기등록(ei.frames.slice(0, 8), function (pal) {
        var 마커들 = [0, 1, 2, 3, 4, 5, 6, 7].map(function (n) {
          var fr = ei.frames[n]; if (!fr) return null;
          var c = G2Native.frameToCanvas(fr, pal);
          return { url: c.toDataURL(), w: fr.w, h: fr.h };
        });
        window.__G2_ETC_ICONS = 마커들;                 /* ★ R 이 없어도 보관 */
        var 렌더러 = 현재렌더러();
        if (렌더러 && 렌더러.setEtcIcons) 렌더러.setEtcIcons(마커들);
        console.log('원본 직독 자산 로드: ETC.ICO 마커 0~7 (' +
                    마커들.filter(Boolean).length + '/8)' + (렌더러 ? '' : ' — R 대기'));
      });
    } catch (e4) { console.warn('ETC.ICO 직독 실패:', e4 && e4.message); }

    /* ── 링 커맨드 아이콘 — 원본 `.ICO` 직독 (할일 19 · 8) ────────────────
     * 한 파일에 항목 × 4프레임. `G2Ring.ICON_FILE` 이 메뉴 ↔ 파일 대응입니다.
     * 추출본(`자산/ring/*.png`)은 g2_export_ring.py 가 **색 0 을 투명**으로
     * 구워 검정으로 칠한 부분이 뚫립니다 — AI_CTRL.ICO 는 56/56 프레임이
     * 색 0 을 쓰므로 아이콘이 통째로 그 병에 걸려 있었습니다. */
    try {
      var RF = window.G2Ring && G2Ring.ICON_FILE, 링프레임 = {};
      for (var mk in RF) {
        if (!Object.prototype.hasOwnProperty.call(RF, mk)) continue;
        try {
          var ic = G2Native.decodeNC2(await grab(RF[mk]));
          if (ic && ic.frames && ic.frames.length) 링프레임[mk] = ic.frames;
          else console.warn('링 아이콘 비어 있음:', RF[mk]);
        } catch (e6) { console.warn('링 아이콘 직독 실패:', RF[mk], e6 && e6.message); }
      }
      /* ★ 날씨가 바뀌면 **다시 굽는다** — 파일은 위에서 한 번만 읽었다 (2026-09-10) */
      굽기등록([].concat.apply([], Object.keys(링프레임).map(function (k) { return 링프레임[k]; })), function (pal, 날씨) {
        var done = [];
        Object.keys(링프레임).forEach(function (mk2) {
          /* 정본 400 — 날씨가 바뀔 때는 닫힌 링 아이콘을 한가할 때 굽는다(링을 열면 그 자리에서 다 굽는다 · ring.js 아이콘미루기) */
          if (날씨 && G2Ring.아이콘미루기) { G2Ring.아이콘미루기(mk2, 링프레임[mk2], pal); return; }
          var got = G2Ring.setNativeIcons(mk2, 링프레임[mk2], pal);
          if (got) done.push(mk2 + ' ' + got);
        });
        if (done.length) console.log('원본 직독 자산 로드: 링 아이콘 —', done.join(' · '));
      });
    } catch (e5) { console.warn('링 아이콘 직독 실패:', e5 && e5.message); }

    /* 선택박스 귀퉁이 — 원본 MAIN.CUR 4~7 직독(추출 PNG는 index0=검정 테두리를 투명 처리해 잃음).
     * frameToImageData 로 8×7 캔버스에 그려 data-URL 로 R.SELBOX.corner 교체. */
    try {
      var mc = G2Native.decodeNC2(await grab('MAIN.CUR'));
      if (mc) 굽기등록(mc.frames.slice(4, 8), function (pal) {
        var 렌더러 = 현재렌더러();
        if (!(렌더러 && 렌더러.선택상자모서리설정)) return;
        var urls = [4, 5, 6, 7].map(function (fi) {
          var fr = mc.frames[fi], cv2 = document.createElement('canvas');
          cv2.width = fr.w; cv2.height = fr.h;
          var g = cv2.getContext('2d');
          g.putImageData(G2Native.frameToImageData(g, fr, pal), 0, 0);
          return cv2.toDataURL();
        });
        렌더러.선택상자모서리설정(urls, mc.frames[4].w, mc.frames[4].h);
        console.log('원본 직독 자산 로드: MAIN.CUR 코너 4~7');
      });
    } catch (e4) { console.warn('MAIN.CUR 코너 로드 실패:', e4 && e4.message); }

    /* ── 마우스 커서 · 이동 화살표 — 원본 직독 (할일 19) ──────────────────
     * MAIN.CUR 0~3 = 화살표 커서 4방향 (`0x49B16` 이 `[0xFB080+n*4]`)
     * MOVE.CUR 8장 = 방향×2 + 변형 (`[0xE5A90 + 방향*8 + 변형*4]`)
     * 실측 색 0 픽셀: MOVE.CUR 288개(8/8 프레임) · MAIN.CUR 0~3 71개(4프레임).
     * 화살표 윤곽선이 통째로 뚫려 있었습니다. */
    try {
      /* ★ 2026-09-24 (Z-40) 커서 원본은 **늘 1배**로 굽는다.
       *   쓰는 쪽(`scaledCursor` · 이동 화살표)이 스스로 필터를 태운다.
       *   ☠ `frameToCanvas` 는 필터가 켜져 있으면 N배를 내는데 dataURL 로 바꾸면
       *     `논리w` 가 사라져, 쓰는 쪽이 1배로 알고 **한 번 더** 키운다. */
      function curUrls(dec, list, pal) {
        return list.map(function (n) {
          var fr = dec.frames[n]; if (!fr) return null;
          var c = document.createElement('canvas');
          c.width = fr.w; c.height = fr.h;
          var g = c.getContext('2d');
          g.putImageData(G2Native.frameToImageData(g, fr, pal), 0, 0);
          return c.toDataURL();
        });
      }
      var mcur = G2Native.decodeNC2(await grab('MAIN.CUR'));
      var vcur = G2Native.decodeNC2(await grab('MOVE.CUR'));
      /* ★★★★★ **R 이 없어도 전역에 보관한다** — ETC.ICO 와 **같은 함정**이었다
       *   (2026-08-25 · 사용자 지적 「이동 타일 선택 후 화살표 표시가 사라졌어」)
       *
       *   `f259448`(턴 마커)에서 이미 겪은 것과 똑같다 — 자산을 읽는 시점에
       *   `window.R` 이 있어야만 넣으니, **체인·재시작으로 `Renderer` 가 새로 생기면
       *   통째로 날아간다.** 화살표(`MOVE.CUR`)와 마우스 커서(`MAIN.CUR`)가 그랬다.
       *   ⇒ 항상 전역(`__G2_CURSORS`)에 두고, 창구가 있으면 바로 넣는다.
       *     `Renderer` 생성자와 `battle_main` 이 그 전역에서 스스로 되찾는다. */
      /* ★ 날씨가 바뀌면 **다시 굽는다** — 파일은 위에서 한 번만 읽었다 (2026-09-10) */
      굽기등록((mcur ? mcur.frames.slice(0, 4) : []).concat(vcur ? vcur.frames.slice(0, 8) : []), function (pal) {
        var mu = mcur ? curUrls(mcur, [0, 1, 2, 3], pal) : null;
        var vu = vcur ? curUrls(vcur, [0, 1, 2, 3, 4, 5, 6, 7], pal) : null;
        if (mu && vu && mu.every(Boolean) && vu.every(Boolean)) {
          window.__G2_CURSORS = { main: mu, move: vu };          /* ★ R 이 없어도 보관 */
          if (window.__setNativeCursors) window.__setNativeCursors(mu, vu);
          console.log('원본 직독 자산 로드: MAIN.CUR 0~3 · MOVE.CUR 0~7' +
                      (window.__setNativeCursors ? '' : ' — 창구 대기'));
        } else console.warn('커서 직독 프레임이 모자랍니다');
      });
    } catch (e7) { console.warn('커서 직독 실패:', e7 && e7.message); }

    /* ── 이펙트 · 날씨 — 원본 직독 (할일 19-c) ────────────────────────────
     * 그림은 `MAGICSPR/*.NSP`(이펙트) 와 `WEATHER.SYB`(날씨)입니다.
     * fx.json 에서 계속 쓰는 건 `간격틱`(0x1033B 인자) · `소리` · `구간` 처럼
     * **EXE 주소를 근거로 뽑은 값**뿐이고, 그림은 한 장도 안 씁니다.
     *
     * ★ 표에 없는 것도 이름만 주면 읽습니다 — `G2Fx.ensureNative(키, 파일)`.
     *   아직 이식 안 한 마법·필살기 연출을 붙일 때 새 추출 자산을 만들 이유가
     *   없어야 합니다. 초필살기 13종은 `G2Ultimate.NSP` 에 파일 이름이 있습니다. */
    /* ── 로딩 화면 `NOWLOAD.PCX` 직독 — QUICK LOAD 가 띄운다 (0x4E33E) ────── */
    try {
      var pcx = G2Native.decodePcx(await grab('NOWLOAD.PCX'));
      if (pcx) {
        G2Hud.setLoadingImage(G2Native.pcxToCanvas(pcx));
        console.log('원본 직독 자산 로드: NOWLOAD.PCX ' + pcx.w + '×' + pcx.h);
      }
    } catch (e9) { console.warn('NOWLOAD.PCX 직독 실패:', e9 && e9.message); }

    /* ── 집중 이펙트 — `CHR_EFFC.SYB` 0x21~0x23 직독 (0x126FE · 할일 19-d) ── */
    try {
      var ce = G2Native.decodeSYB(await grab('CHR_EFFC.SYB'));
      if (ce) 굽기등록(ce.frames, function (pal) {
        var got = [0x21, 0x22, 0x23].map(function (n) {
          var fr = ce.frames[n]; if (!fr) return null;
          return { url: G2Native.frameToCanvas(fr, pal).toDataURL(),
                   ax: fr.ax, ay: fr.ay, w: fr.w, h: fr.h };
        });
        if (got.every(Boolean)) {
          window.__CHR_EFFC_NATIVE = got;
          console.log('원본 직독 자산 로드: CHR_EFFC.SYB 0x21~0x23 (집중)');
        }
        /* ★★★★★ **상태이상 아이콘** — `CHR_EFFC.SYB` 9~20 (2026-09-07 · 사장님 지적 M36)
         *
         *   > 사장님: 「커스 … **피격대상 저주 효과도 나오지 않아**」
         *   >  「스틸엠피 … **피격대상 침묵효과가 적용이 안돼**」
         *
         *   ☠ 실측하니 **효과는 걸린다**(커스를 쏘니 `f1e` 가 `0 → 32`).
         *     **화면에 표시가 없어서** 안 걸린 것처럼 보인 것이다.
         *
         *   원본 `0x123DF`~`0x12553` 이 상태 비트마다 3프레임 묶음을 고른다
         *   (`상태이상_원본확정.md:655-670`) —
         *   ```
         *   0x1243E  & 0x08 침묵 →  9·10·11
         *   0x12453  & 0x10 혼란 → 12·13·14
         *   0x12468  & 0x20 저주 → 15·16·17
         *   0x1247D  & 0x80 중독 → 18·19·20
         *   ```
         *   ☐ 하위 3비트(화상·빙결·감전)는 기준값 `[0x74FB6]>>16` 을 못 박아 뺐다.
         *   ☐ 버프(`[+0x15] & 0x80` → 30·31·32)도 필드 대응 확인 뒤로 미뤘다.
         *   조사: `03_분석/_보관/끝난조사/00_지금조사_상태아이콘.md` */
        var 상태 = [];
        for (var si = 9; si <= 20; si++) {
          var sf = ce.frames[si];
          상태.push(sf ? { url: G2Native.frameToCanvas(sf, pal).toDataURL(),
                          ax: sf.ax, ay: sf.ay, w: sf.w, h: sf.h } : null);
        }
        if (상태.some(Boolean)) {
          window.__CHR_EFFC_AIL = 상태;   /* 색인 0 = 프레임 9 */
          console.log('원본 직독 자산 로드: CHR_EFFC.SYB 9~20 (상태이상) — ' +
                      상태.filter(Boolean).length + '장');
        }
      });
    } catch (e8) { console.warn('CHR_EFFC.SYB 직독 실패:', e8 && e8.message); }

    var fxDone = false;
    window.__loadNativeFx = async function () {
      if (fxDone || !window.G2Fx) return;
      var a = G2Fx.assetsReady && G2Fx.assetsReady();
      /* fx.json 과 이 블록은 순서가 정해져 있지 않습니다. 아직이면 잠깐 기다립니다
       * (fx.load 콜백도 이 함수를 부르므로 어느 쪽이 먼저 와도 한 번만 돕니다). */
      for (var t = 0; t < 100 && !a; t++) {
        await new Promise(function (r) { setTimeout(r, 50); });
        a = G2Fx.assetsReady && G2Fx.assetsReady();
      }
      if (!a) { console.warn('fx 자산이 안 와서 이펙트 직독을 건너뜁니다'); return; }
      fxDone = true;
      G2Fx.setBasePalette(바탕);    /* ★ 위와 같은 까닭 */
      G2Fx.setPalette(pal);
      if (G2Fx.날씨적용) G2Fx.날씨적용();     /* ★ 지금 시나리오 날씨로 맞춘다 */
      var 팔 = G2Fx.currentPalette() || pal;  /* ★ 아래는 **맞춘 팔레트**로 굽는다 */
      var okN = 0, bad = [];
      var keys = G2Fx.list();
      for (var i = 0; i < keys.length; i++) {
        var k = keys[i], def = G2Fx.meta(k), file = def && def['원본'];
        if (!file) { bad.push(k + '(원본 이름 없음)'); continue; }
        try {
          var d = G2Native.decodeNSP(await grab('MAGICSPR/' + file));
          if (d && G2Fx.setNativeFrames(k, d.frames, 팔)) okN++;
          else bad.push(k);
        } catch (ef) { bad.push(k + '(' + (ef && ef.message) + ')'); }
      }
      try {
        var wd = G2Native.decodeSYB(await grab('WEATHER.SYB'));
        if (wd) G2Fx.setNativeWeather(wd.frames, 팔);
      } catch (ew) { console.warn('WEATHER.SYB 직독 실패:', ew && ew.message); }
      console.log('원본 직독 자산 로드: 이펙트 ' + okN + '/' + keys.length +
                  ' · 날씨 ' + G2Fx.nativeCount('날씨') + '프레임');
      if (bad.length) console.warn('이펙트 직독 실패:', bad.join(', '));

      /* ★ 원거리 투사체·발사음도 여기서 **미리** 받는다.
       *
       *   사용자 지적 2026-08-14: 「마법사 원거리 효과음 넣어야 해.」 — 넣어는
       *   뒀는데 **첫 공격 때 소리가 안 났다.** 무기음을 내는 자리
       *   (`0x1E8C8` = 단계 2 시작)가 투사체 준비보다 **앞**이라, 그 시점엔
       *   `MAGICSPR/F-BALL.SSP` 가 아직 `fetch` 중이었다.
       *   원본 `.VSP` 효과음은 부팅 때 통째로 올라와 있어 활·검은 첫 발부터
       *   소리가 났고, 지연 로드인 이것만 티가 났다.
       *
       *   `BATTLE.SYB`(투사체 133프레임)도 같은 이유로 함께 받는다. */
      try {
        var n1 = window.__투사체준비 ? await window.__투사체준비() : 0;
        var n2 = window.__마법투사체준비 ? await window.__마법투사체준비() : 0;
        console.log('원본 직독 자산 로드: 투사체 ' + n1 + '프레임 · 마법투사체 ' + n2 + '프레임');
      } catch (eb) { console.warn('투사체 미리 받기 실패:', eb && eb.message); }
    };
    await window.__loadNativeFx();
  } catch (e) { console.warn('원본 자산 로드 실패 — 기존 자산 사용:', e && e.message); }
})();
