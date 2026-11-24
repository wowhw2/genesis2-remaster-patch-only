/* ============================================================
 *  성능 그래프 [개발 · 리마스터] (정본 400 · 2026-11-22)
 *
 *  사장님(동생 말 원문): 「프레임타임 기반으로 cpu/gpu 타임디버깅으로 화면 출력하면서 최대한 수치 낮추는 방법으로 최적화 하래.
 *   의심되는 지점별로 프레임타임 얼마나 차지하는지 그게 타당한지 검토하래.」·「화면 구석에 이런식으로 실시간 지표들 그래프로 그려줘」·
 *   「y축 프레임타임, y축이 각 지표들의 cost, x축 지나간 시간으로 그려주고. 그래프 전체를 y축 아래 값을 낮추고 중간에 튀는 히치가 없도록 하는게 목표야」·
 *   「언리얼엔진의 stat unit graph 처럼 디버깅용 그래프 화면에 그려달라는 소리야」
 *
 *  화면 왼쪽 위 — 가로 = 흘러간 시간(최근 6초) · 세로 = ms
 *    선 넷: Frame(한 프레임 · rAF 간격) · Game(논리) · Draw(CPU 그리기) · GPU(= Frame − Game − Draw · 브라우저 그리기·합성·GPU 대기)
 *    세부(숫자): 논리(전투 pumpFrames) · 셸(월드·마을 걸음·그림) · 효과갱신 / 표시(R.apply · 3D 포함) · 3D장면 · 3D가림 · HUD · 링 · 효과그림
 *  50ms 넘는 프레임(히치)은 빨간 점 · 그 프레임 내역을 콘솔 [성능 히치] 로
 *  켜기: 주소 ?성능=1 · 게임 설정 «화면 › 성능 그래프» · PC F9 — 이 기기에 기억(g2.성능) · 꺼져 있으면 그리지 않는다(재는 비용 ≈ 0)
 * ============================================================ */
(function (root) {
  'use strict';
  if (typeof document === 'undefined') return;
  var 물음 = location.search || ''; try { 물음 = decodeURIComponent(물음); } catch (e) { }
  var 켬 = /[?&]성능=1/.test(물음); try { if (!켬) 켬 = localStorage.getItem('g2.성능') === '1'; } catch (e) { }

  var 큰선 = [
    { 키: 'Frame', 색: '#ffe040' },
    { 키: 'Game', 색: '#40e080' },
    { 키: 'Draw', 색: '#ff5050' },
    { 키: 'GPU', 색: '#50a0ff' }
  ];
  var 세부 = ['논리', '셸', '효과갱신', '표시', '3D장면', '3D가림', 'HUD', '링', '효과그림'];
  var 깊이 = {}, 누적 = {}, 기록 = [], 길이 = 900, 히치 = [], 보는초 = 6;   /* 900 장 — 6초를 120fps 까지 */
  세부.forEach(function (k) { 누적[k] = 0; });

  /* 함수 감싸기 — 같은 것을 두 번 감싸지 않는다 · 안쪽 중첩은 바깥 구간에도 들어간다(표시 ⊃ 3D) */
  function 감싸기(obj, 이름, 키) {
    if (!obj || typeof obj[이름] !== 'function' || obj[이름].__성능) return false;
    var 원 = obj[이름];
    var 새 = function () {
      /* 같은 구간이 안에서 다시 불리면(apply → goTile → apply 등) 바깥 한 번만 센다 — 겹쳐 세면 표시가 프레임보다 크게 잡혔다(정본 400 · 11-23) */
      if (깊이[키]) return 원.apply(this, arguments);
      깊이[키] = 1; var t = performance.now();
      try { return 원.apply(this, arguments); } finally { 깊이[키] = 0; 누적[키] += performance.now() - t; }
    };
    새.__성능 = true; 새.__원 = 원;
    obj[이름] = 새; return true;
  }
  /* 대상은 전투가 뜬 뒤에야 생기거나 바뀐다(R · 3D 장면) — 1초마다 다시 본다 */
  function 걸기() {
    var R = root.R;
    if (R) {
      감싸기(R, 'apply', '표시');
      /* 표시 안쪽 — 화면 반영 본체(_apply본) · 빌보드(유닛·아이템 판마다) · 3D 갱신 앞부분 (정본 400 · 에뮬레이터 3D 스크롤 표시 28.6ms 중 3D 세부 10.5ms 뺀 약 18ms) */
      감싸기(R, '_apply본', '표시:본체');
      감싸기(R, '_빌보드적용', '표시:빌보드');
      var s = R._리마스터3D;
      if (s && s.장면) 감싸기(s.장면, '그리기', '3D장면');
      if (s && s.가림) 감싸기(s.가림, '가림그리기', '3D가림');
    }
    if (root.G2Hud) 감싸기(root.G2Hud, 'draw', 'HUD');
    if (root.G2Fx) { 감싸기(root.G2Fx, 'draw', '효과그림'); 감싸기(root.G2Fx, 'update', '효과갱신'); 감싸기(root.G2Fx, '날씨칠하기', '효과그림'); }
    if (root.G2Ring) 감싸기(root.G2Ring, 'draw', '링');
    if (root.__셸) { 감싸기(root.__셸, '한걸음', '셸'); 감싸기(root.__셸, '렌더', '셸'); }
    /* 날씨가 바뀌면 이펙트 그림을 새 팔레트로 다시 굽는다(toDataURL) — 비 시작 끊김 후보 (정본 400) */
    if (root.G2Fx) 감싸기(root.G2Fx, '날씨적용', '날씨굽기');
    /* 팔레트 갈기 — 날씨 서서히 바뀜(1.2초에 12번) · 마법·필살기 화면 번쩍임이 모두 이 길로 유닛·바닥·배경벽·오브젝트를 다시 칠한다 (정본 400 · 검 기술 히치 후보) */
    if (R) 감싸기(R, '팔레트만갈기', '팔레트');
    감싸기(root, '__G2자산_날씨적용', '자산굽기');
    if (수집) 수집.걸기();
  }
  setInterval(걸기, 1000);

  var 판 = null, ctx = null, 앞 = 0;
  function 판만들기() {
    if (판) return;
    판 = document.createElement('canvas'); 판.id = '성능그래프';
    판.width = 380 * 2; 판.height = 210 * 2;
    판.style.cssText = 'position:fixed;left:6px;top:28px;width:380px;height:210px;z-index:2147483600;pointer-events:none;' +
      'background:rgba(0,0,0,.62);border:1px solid rgba(255,255,255,.25);border-radius:4px';
    document.body.appendChild(판); ctx = 판.getContext('2d');
  }
  function 한장(t) {
    requestAnimationFrame(한장);
    var dt = 앞 ? t - 앞 : 16.7; 앞 = t;
    var 줄 = { Frame: dt, 때: t };
    세부.forEach(function (k) { 줄[k] = 누적[k] || 0; 누적[k] = 0; });
    줄.Game = 줄.논리 + 줄.셸 + 줄.효과갱신;
    줄.Draw = 줄.표시 + 줄.HUD + 줄.링 + 줄.효과그림;   /* 3D 는 표시 안쪽이라 따로 안 더한다 */
    줄.GPU = Math.max(0, dt - 줄.Game - 줄.Draw);
    기록.push(줄);
    if (수집) 수집.장(줄);   /* 정본 408 */
    if (기록.length > 길이) { 기록.shift(); 히치 = 히치.map(function (i) { return i - 1; }).filter(function (i) { return i >= 0; }); }
    if (dt > 50) {
      히치.push(기록.length - 1);
      try { console.warn('[성능 히치] ' + dt.toFixed(0) + 'ms · Game ' + 줄.Game.toFixed(1) + ' · Draw ' + 줄.Draw.toFixed(1) + ' · GPU ' + 줄.GPU.toFixed(1) + ' · ' + 세부.map(function (k) { return k + ' ' + 줄[k].toFixed(1); }).join(' · ')); } catch (e) { }
    }
    if (!켬) { if (판) 판.style.display = 'none'; return; }
    판만들기(); 판.style.display = '';
    그리기();
  }
  function 그리기() {
    var W = 판.width, H = 판.height, k = 2, 왼 = 26 * k, 위 = 54 * k, 아래 = H - 14 * k, 높 = 아래 - 위, 폭 = W - 왼 - 4 * k;
    var 최고 = 0; 기록.forEach(function (줄) { if (줄.Frame > 최고) 최고 = 줄.Frame; });
    var 최대 = Math.min(200, Math.max(40, Math.ceil(최고 / 20) * 20));
    ctx.clearRect(0, 0, W, H);
    var y = function (ms) { return 아래 - Math.min(ms, 최대) / 최대 * 높; };
    var 지금 = 기록.length ? 기록[기록.length - 1].때 : 0;
    var gx = function (t) { return 왼 + 폭 - (지금 - t) / (보는초 * 1000) * 폭; };
    /* 세로 눈금(ms) · 가로 눈금(초) */
    ctx.font = (8 * k) + 'px monospace'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.strokeStyle = 'rgba(255,255,255,.12)'; ctx.lineWidth = 1;
    for (var v = 0; v <= 최대; v += (최대 > 100 ? 40 : 20)) { ctx.beginPath(); ctx.moveTo(왼, y(v)); ctx.lineTo(W, y(v)); ctx.stroke(); ctx.fillText(String(v), 2 * k, y(v) + 3 * k); }
    for (var s = 0; s <= 보는초; s++) { var xs = 왼 + 폭 - s / 보는초 * 폭; ctx.fillText(s ? '-' + s + 's' : '지금', xs - 8 * k, H - 3 * k); }
    ctx.fillText('ms', 2 * k, 위 - 3 * k);
    /* 기준선 16.7(60fps) · 33.3(30fps) */
    ctx.lineWidth = 1 * k; ctx.setLineDash([4 * k, 4 * k]);
    [[16.7, '60fps'], [33.3, '30fps']].forEach(function (a) {
      if (a[0] > 최대) return;
      ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.beginPath(); ctx.moveTo(왼, y(a[0])); ctx.lineTo(W, y(a[0])); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,.7)'; ctx.fillText(a[1], W - 34 * k, y(a[0]) - 2 * k);
    });
    ctx.setLineDash([]);
    큰선.forEach(function (g) {
      ctx.strokeStyle = g.색; ctx.lineWidth = (g.키 === 'Frame' ? 1.8 : 1.3) * k; ctx.beginPath(); var 첫 = true;
      기록.forEach(function (줄) { var px = gx(줄.때); if (px < 왼) return; var py = y(줄[g.키] || 0); if (첫) { ctx.moveTo(px, py); 첫 = false; } else ctx.lineTo(px, py); });
      ctx.stroke();
    });
    ctx.fillStyle = '#ff3030';
    히치.forEach(function (i) { var 줄 = 기록[i]; if (!줄) return; var px = gx(줄.때); if (px < 왼) return; ctx.beginPath(); ctx.arc(px, y(줄.Frame), 3 * k, 0, Math.PI * 2); ctx.fill(); });
    /* 범례 — 큰선(색) · 세부(흰색) · 최근 30 프레임 평균 ms */
    var 최근 = 기록.slice(-30), 평 = function (키) { var t2 = 0; 최근.forEach(function (줄) { t2 += 줄[키] || 0; }); return 최근.length ? t2 / 최근.length : 0; };
    ctx.font = 'bold ' + (9 * k) + 'px monospace'; var lx = 4 * k;
    큰선.forEach(function (g) { var 글 = g.키 + ' ' + 평(g.키).toFixed(1); ctx.fillStyle = g.색; ctx.fillText(글, lx, 11 * k); lx += ctx.measureText(글).width + 8 * k; });
    ctx.fillStyle = '#fff'; ctx.fillText((1000 / Math.max(1, 평('Frame'))).toFixed(0) + 'fps', W - 40 * k, 11 * k);
    ctx.font = (7.5 * k) + 'px monospace'; ctx.fillStyle = 'rgba(220,220,220,.85)'; lx = 4 * k; var ly = 22 * k;
    세부.forEach(function (k2) { var 글 = k2 + ' ' + 평(k2).toFixed(1); var w = ctx.measureText(글).width; if (lx + w > W - 4 * k) { lx = 4 * k; ly += 8 * k; } ctx.fillText(글, lx, ly); lx += w + 6 * k; });
  }
  requestAnimationFrame(한장);
  addEventListener('keydown', function (e) { if (e.key === 'F9') { API.켜기(!켬); e.preventDefault(); } }, true);

  /* ── 정본 408 — 성능 수집: 끊김·느림이 나면 «그 순간» 앞뒤 수치와 하던 일을 묶어 두고, 게임이 한가할 때 신고 받는 곳으로 보낸다 ──
   *   사장님 11-22 「지금 패치로 다른사람들 실행기에 넣고(그래프는 띄우지는 않고 측정 기능만 넣고) 문제 상황이 생기면 자동으로 해당 상황과
   *   수치 등을 전송해서 데이터 수집을 할 수 없냐는 소리야.」·「지금 비정상 종료처럼」·「그래프는 띄우면 게임에 방해되니까 띄우지 말고」·
   *   「계속 보내지거나 그래서 게임에 지장생기지는 않을까?」 · 고르심 «켜 둠 + 끄는 칸» → 11-23 «동의해야 게임 (끄는 칸 없음)»(정본 409 · bug_report.js 이용 안내)
   *   ★ 기록은 그 자리에서(그때 돌던 연출 · 장면 · 입력 · 앞뒤 프레임) · 보내기는 나중에 한가할 때 — 보내는 일이 끊김을 보태지 않게
   *   ★ 보내는 것은 앱(PC)·휴대폰에서만 — 개발 브라우저·헤드리스 시험은 모으기만 하고 안 보낸다
   *   한도: 같은 까닭은 한 번 켤 때 한 번 · 잡기 20초에 한 번 · 한 번 켤 때 6건 · 보내기 3분에 한 번 · 한 번 켤 때 3번 · 하루 8번 */
  var 수집 = (function () {
    var 켬2 = true;   /* 정본 409 — 끄는 칸 없음: 처음 켤 때 이용 안내 동의(bug_report.js)가 곧 수집 동의 · 켜기()는 시험용 */
    var 모바일 = /[?&]모바일=1/.test(물음), 보냄가능 = false;
    try { 보냄가능 = (!!root.G2앱 || 모바일) && !navigator.webdriver && !/[?&]gputest=1/.test(물음); } catch (e) { }   /* gputest — 최적화 측정 크롬(정본 400) · 11-23 측정 창 모바일=1 기록이 «휴대폰»으로 드라이브에 올라갔다 */
    var 받는곳 = 'https://script.google.com/macros/s/AKfycbyWAiC12QPSOFv7RvUnGeJSHEbyY1YHKQQeD7mR_6XUlIhv3WrGmR-zCyBgBLtvotZU/exec';   /* bug_report.js 휴대폰신고주소 와 같게 */
    var 히치ms = 66, 느림ms = 40;   /* 히치 = 한 장이 60fps 네 장 넘게 걸림 · 느림 = 1초 평균이 25fps 아래로 3초 넘게 */
    var 건너초 = 0, 건너수 = 0;   /* 정본 400 — 연출 건너뜀 셈(장() 안) */
    var 최근일 = [], 대기 = [], 잡은까닭 = {}, 잡은수 = 0, 마지막잡기 = -1e9, 마지막보냄 = -1e9, 보낸수 = 0, 잡는중 = null;
    var 도는 = {}, 도는번 = 0, 앞상황 = '', 앞장면 = '', 장면바뀐때 = performance.now(), 앞패드 = '';
    var 초합 = 0, 초장 = 0, 초시작 = 0, 느린초 = 0;
    function 일(글) {
      글 = String(글).slice(0, 160);
      var 끝 = 최근일[최근일.length - 1], t = performance.now();
      if (끝 && 끝.일 === 글) { 끝.n = (끝.n || 1) + 1; 끝.끝t = t; return; }
      최근일.push({ t: t, 일: 글 }); if (최근일.length > 80) 최근일.shift();
    }
    function 짧게(p) {
      if (p == null) return '';
      if (typeof p !== 'object') return String(p);
      var o = [];
      for (var k in p) { var v = p[k]; if (v == null || typeof v === 'object' || typeof v === 'function') continue; o.push(k + '=' + v); if (o.length >= 6) break; }
      return o.join(' ');
    }
    function 상황() {
      var o = {};
      try { o.셸 = root.__셸 && root.__셸.수명주기 ? root.__셸.수명주기().화면 || '' : ''; } catch (e) { }
      try { var G = root.G2; o.맵 = G && G.scene ? G.scene._시나리오 || G.scene['맵파일'] || '' : ''; } catch (e) { }
      try { if (root.ctrl) o.모드 = root.ctrl.mode; } catch (e) { }
      try { var b = root.battle; if (b) o.턴 = b.turn + '/' + b.phase; } catch (e) { }
      try { o.보기3D = localStorage.getItem('리마스터3D보기') || ''; } catch (e) { }
      /* 정본 400 — 실제 화면 상태(보기3D 는 설정 저장값이라 거의 비어 있었다 · 11-23 기록 열세 개에서 3D 그리기가 잡혔는데도 빈칸) */
      try { var R0 = root.R; if (R0 && R0.cam) { o.기울기 = Math.round(R0.cam.tilt || 0); o.켬3D = !!(R0.host && R0.host.classList && R0.host.classList.contains('g2-3d맵')); } } catch (e) { }
      try { if (root.G2Scaler && root.G2Scaler.cur) o.스케일러 = root.G2Scaler.cur(); } catch (e) { }
      try { var O0 = root.G2Opt; if (O0 && O0.실효배속) o.배속 = O0.실효배속(); } catch (e) { }
      try { var F = root.G2Fx; if (F) { o.날씨 = F.wKind + ':' + F.wStep; o.이펙트 = (F.active ? F.active.length : 0) + (F.screenActive ? F.screenActive.length : 0); } } catch (e) { }
      return o;
    }
    /* 하던 일 — 연출 입구(G2Anim play)·이펙트 재생(G2Fx play)·키·누름·패드를 시각과 함께 (값을 바꾸지 않고 적기만) */
    function 걸기2() {
      var A = root.G2Anim && root.G2Anim.Anim;
      if (A && A.prototype.play && !A.prototype.play.__수집) {
        var 원 = A.prototype.play;
        A.prototype.play = function (kind, payload) {
          var 번 = ++도는번, 이름 = kind + (payload ? ' ' + 짧게(payload) : '');
          도는[번] = 이름; 일('연출 ' + 이름);
          var 끝 = function () { delete 도는[번]; };
          var p;
          try { p = 원.apply(this, arguments); } catch (e) { 끝(); throw e; }
          if (p && typeof p.then === 'function') p.then(끝, 끝); else 끝();
          return p;
        };
        A.prototype.play.__수집 = true;
      }
      var F = root.G2Fx;
      if (F && typeof F.play === 'function' && !F.play.__수집) {
        var 원2 = F.play;
        F.play = function (name) { 일('이펙트 ' + name); return 원2.apply(this, arguments); };
        F.play.__수집 = true;
      }
    }
    /* 정본 400 — 긴 장 기록(Long Animation Frames · 크롬 123+) — 그 장에서 오래 걸린 스크립트(파일·함수·부른 쪽)·강제 배치·그리기 시작
     *   ☠ 큰 끊김이 «GPU»(잰 구간 밖)로만 남아 무엇이 막았는지 몰랐다(11-23 · 173ms·350ms 등) · 없는 브라우저는 긴 작업(longtask)만 */
    var 긴장 = [];
    try {
      new PerformanceObserver(function (목) {
        목.getEntries().forEach(function (e) {
          긴장.push({ t: e.startTime, ms: Math.round(e.duration), 막힘: Math.round(e.blockingDuration || 0),
                      그리기전: Math.round((e.renderStart || e.startTime) - e.startTime), 스타일배치: Math.round(e.styleAndLayoutDuration || 0),
                      스크립트: (e.scripts || []).slice().sort(function (a, b) { return b.duration - a.duration; }).slice(0, 4).map(function (s) {
                        return { ms: Math.round(s.duration), 곳: String(s.sourceURL || '').split('/').pop().replace(/\?.*/, '') + ' ' + (s.sourceFunctionName || '') + '@' + (s.sourceCharPosition | 0),
                                 부름: String(s.invoker || '').slice(0, 80), 강제배치: Math.round(s.forcedStyleAndLayoutDuration || 0) };
                      }) });
          if (긴장.length > 40) 긴장.shift();
        });
      }).observe({ type: 'long-animation-frame', buffered: false });
    } catch (eL) {
      try { new PerformanceObserver(function (목) { 목.getEntries().forEach(function (e) { 긴장.push({ t: e.startTime, ms: Math.round(e.duration), 긴작업: true }); if (긴장.length > 40) 긴장.shift(); }); }).observe({ type: 'longtask', buffered: false }); } catch (eT) { }
    }
    addEventListener('keydown', function (e) { if (!e.repeat) 일('키 ' + e.key); }, true);
    addEventListener('pointerdown', function (e) { 일('누름 ' + (e.pointerType || '')); }, true);
    setInterval(function () {
      if (!켬2 || document.hidden) return;
      var o = 상황(), 글 = JSON.stringify(o), 면 = (o.셸 || '') + ' ' + (o.맵 || '');
      if (글 !== 앞상황) { 앞상황 = 글; 일('상황 ' + 글); }
      if (면 !== 앞장면) { 앞장면 = 면; 장면바뀐때 = performance.now(); }
      try {
        var ps = navigator.getGamepads ? navigator.getGamepads() : [], 눌 = [];
        for (var i = 0; i < ps.length; i++) { var p = ps[i]; if (!p) continue; p.buttons.forEach(function (b, j) { if (b.pressed) 눌.push(j); }); }
        var 패 = 눌.join(','); if (패 !== 앞패드) { 앞패드 = 패; if (패) 일('패드 ' + 패); }
      } catch (e) { }
    }, 500);

    function 짧은줄(줄, 기준) {
      var r = [Math.round(줄.때 - 기준), +줄.Frame.toFixed(1), +줄.Game.toFixed(1), +줄.Draw.toFixed(1), +줄.GPU.toFixed(1)], 세 = {};
      if (줄.Frame <= 25) return r;   /* 고른 장은 큰 넷만 — 세부는 느린 장에만 (휴대폰 데이터 · 사장님 11-22 「전송하는 데이터 용량이 크진 않아?」) */
      세부.forEach(function (k) { if (줄[k] > 0.2) 세[k] = +줄[k].toFixed(1); });
      r.push(세); return r;
    }
    function 이상(까닭, 줄) {
      var t = 줄.때;
      if (잡는중) { if (잡는중.까닭.length < 8) 잡는중.까닭.push(까닭 + ' @' + Math.round(t - 잡는중.t)); return; }
      if (잡은수 >= 6 || t - 마지막잡기 < 20000) return;
      var 큰 = '', 큰값 = 0; 세부.forEach(function (k) { if (줄[k] > 큰값) { 큰값 = 줄[k]; 큰 = k; } });
      var 연출 = Object.keys(도는).map(function (k) { return 도는[k]; });
      var o = 상황(), 키 = 까닭.split(' ')[0] + '|' + o.셸 + '|' + o.맵 + '|' + 큰 + '|' + (연출[0] || '').split(' ')[0];
      if (잡은까닭[키]) return;
      잡은까닭[키] = 1; 마지막잡기 = t;
      잡는중 = { 때: new Date().toISOString(), t: t, 까닭: [까닭], 큰구간: 큰, 상황: o, 도는연출: 연출,
                 장면바뀐뒤ms: Math.round(t - 장면바뀐때), 켠뒤초: Math.round(t / 1000),
                 벽: Date.now() - (performance.now() - t) };   /* 정본 400 — 콘솔 줄(UTC 시각)과 맞출 벽시계 */
      try { if (performance.memory) 잡는중.메모리MB = Math.round(performance.memory.usedJSHeapSize / 1048576) + ' / ' + Math.round(performance.memory.jsHeapSizeLimit / 1048576); } catch (eM) { }   /* 정본 400 — 메모리 부족 튕김 대비 */
      setTimeout(마무리, 1500);   /* 뒤 1.5초까지 담는다 — 끊김이 이어지는지 */
    }
    function 마무리() {
      var c = 잡는중; 잡는중 = null; if (!c) return;
      c.프레임머리 = ['ms(이상 기준)', 'Frame', 'Game', 'Draw', 'GPU', '세부'];
      c.프레임 = 기록.filter(function (줄) { return 줄.때 >= c.t - 3000; }).map(function (줄) { return 짧은줄(줄, c.t); });
      c.하던일 = 최근일.filter(function (x) { return (x.끝t || x.t) >= c.t - 15000; }).map(function (x) { return Math.round(x.t - c.t) + 'ms ' + x.일 + (x.n ? ' ×' + x.n : ''); });
      /* 정본 400 — 그 앞뒤(−3초 ~ +1.5초)의 긴 장 기록과 콘솔 줄 · ☠ 전에는 보낼 때의 마지막 40줄만 담아 끊김 순간의 줄이 빠졌다(11-23 1-10 13턴) */
      c.긴장 = 긴장.filter(function (e) { return e.t >= c.t - 3000 && e.t <= c.t + 1600; }).map(function (e) { var o = {}; for (var k in e) o[k] = e[k]; o.t = Math.round(e.t - c.t); return o; });
      try {
        var 신고0 = root.G2버그신고, 줄들 = 신고0 && 신고0.기록 ? 신고0.기록() : [], 하루 = 86400000, 벽일 = c.벽 % 하루;
        c.콘솔 = 줄들.filter(function (s) {
          var m = /^(\d\d):(\d\d):(\d\d)\.(\d\d\d)/.exec(s); if (!m) return false;
          var ms = ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4], 차 = ms - 벽일;
          if (차 > 하루 / 2) 차 -= 하루; else if (차 < -하루 / 2) 차 += 하루;   /* 자정 넘김 */
          return 차 >= -3000 && 차 <= 1600;
        }).slice(-30).map(function (s) { return s.slice(0, 200); });   /* 1회 약 10KB 를 넘지 않게(이용 안내) */
      } catch (eC) { }
      delete c.t; delete c.벽;
      대기.push(c); 잡은수++;
      try { console.warn('[성능 수집] ' + c.까닭[0] + ' · ' + (c.상황.셸 || '') + ' ' + (c.상황.맵 || '') + ' · 큰 구간 ' + c.큰구간 + ' · 연출 ' + (c.도는연출.join(' / ') || '없음')); } catch (e) { }
    }
    function 장(줄) {
      if (!켬2) return;
      if (document.hidden) { 초장 = 0; 느린초 = 0; return; }
      var dt = 줄.Frame;
      if (dt > 1500) { 초장 = 0; return; }   /* 뒤에 갔다 돌아온 틈 · 멈춘 창 — 끊김이 아니다 */
      if (dt > 히치ms) 이상('히치 ' + Math.round(dt) + 'ms', 줄);
      /* 정본 400 — 연출 건너뜀: 한 장에 연출 걸음(battle_main 연출걸음 셈)이 2 이상이면 그 장 사이 그림이 화면에 안 나왔다 · 1초 안에 4장 넘으면 기록
       *   (사장님 11-24 «필살기 프레임 건너뛰는거 특히 배속에서 심한거 제대로 처리해줘» — 끊김 없이도 생기는 일이라 히치·느림으로는 안 잡혔다) */
      /* 기다림 풀림(연출걸음)과 프레임 시계 걸음(틀걸음)은 따로 본다 — 유닛 한걸음 + 카메라 한 칸은 건너뜀이 아니다 (battle_main 틀걸음 주석) */
      var 건걸 = Math.max(줄.연출걸음 | 0, 줄.틀걸음 | 0);
      if (건걸 >= 2) { if (!(건너초 && 줄.때 - 건너초 < 1000)) { 건너초 = 줄.때; 건너수 = 0; } if (++건너수 === 4) 이상('연출 건너뜀 1초에 4장 넘게 (한 장 ' + 건걸 + '걸음)', 줄); }
      if (!초장) 초시작 = 줄.때;
      초합 += dt; 초장++;
      if (줄.때 - 초시작 >= 1000) {
        var 평 = 초합 / 초장; 초합 = 0; 초장 = 0;
        느린초 = 평 > 느림ms ? 느린초 + 1 : 0;
        if (느린초 >= 3) { 이상('느림 ' + Math.round(1000 / 평) + 'fps(3초 넘게)', 줄); 느린초 = 0; }
      }
    }

    /* 보내기 — 한가할 때만(최근 60장 평균 25ms 아래 · 도는 연출 없음 · 마지막 잡기 10초 뒤) · 뒤로 넘어갈 때는 남은 것을 곧바로 */
    function 오늘() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
    function 하루수(더) {
      var 키 = 'g2.성능수집.날', v = { 날: 오늘(), n: 0 };
      try { var j = JSON.parse(localStorage.getItem(키) || 'null'); if (j && j.날 === v.날) v = j; } catch (e) { }
      if (더) { v.n += 더; try { localStorage.setItem(키, JSON.stringify(v)); } catch (e) { } }
      return v.n;
    }
    function 보낼수있나() { return 보냄가능 && 켬2 && 대기.length > 0 && 보낸수 < 3 && 하루수(0) < 8; }
    function 보내기() {
      if (!보낼수있나()) return false;
      var 신고 = root.G2버그신고; if (!신고 || !신고._zip || !신고._바64) return false;
      var 묶 = 대기.splice(0, 대기.length); 보낸수++; 마지막보냄 = performance.now(); 하루수(1);
      try {
        var 정보 = 신고.모으기('성능 기록(저절로) — ' + 묶.map(function (c) { return c.까닭[0]; }).join(' · '));
        var 엔 = new TextEncoder(), 때 = new Date(), 붙 = function (n) { return (n < 10 ? '0' : '') + n; };
        var 이름 = '성능기록_' + (모바일 ? '휴대폰' : 'PC') + '_' + 때.getFullYear() + 붙(때.getMonth() + 1) + 붙(때.getDate()) + '_' + 붙(때.getHours()) + 붙(때.getMinutes()) + 붙(때.getSeconds()) + '.zip';
        var zip = 신고._zip([
          { 이름: '성능.json', 바이트: 엔.encode(JSON.stringify(묶)) },
          { 이름: '정보.json', 바이트: 엔.encode(JSON.stringify(정보, null, 1)) },
          { 이름: '콘솔끝.txt', 바이트: 엔.encode(신고.기록().slice(-40).join('\n')) }]);
        var 몸 = JSON.stringify({ 이름: 이름, 설명: String(정보.설명 || '').slice(0, 1000), zip: 신고._바64(zip) });
        fetch(받는곳, { method: 'POST', mode: 'no-cors', keepalive: 몸.length < 60000, headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: 몸 }).catch(function () { });
        return 이름;
      } catch (e) { return false; }
    }
    setInterval(function () {
      if (!보낼수있나() || document.hidden) return;
      var 지금 = performance.now();
      if (지금 - 마지막보냄 < 180000 || 지금 - 마지막잡기 < 10000 || 잡는중 || Object.keys(도는).length) return;
      var 최근 = 기록.slice(-60), 합 = 0; 최근.forEach(function (줄) { 합 += 줄.Frame; });
      if (!최근.length || 합 / 최근.length > 25) return;
      (root.requestIdleCallback || function (f) { return setTimeout(f, 0); })(function () { 보내기(); });
    }, 15000);
    document.addEventListener('visibilitychange', function () { if (document.hidden && !잡는중) 보내기(); });

    return {
      걸기: 걸기2, 장: 장, 일: 일,
      켜짐: function () { return 켬2; },
      켜기: function (v) { 켬2 = !!v; if (!켬2) 대기.length = 0; return 켬2; },
      대기: function () { return 대기.slice(); },
      최근일: function () { return 최근일.slice(); },
      보낼수있나: function () { return !!보낼수있나(); },
      _보내기: 보내기, _마무리: 마무리, _이상: 이상
    };
  })();

  var API = {
    켜짐: function () { return 켬; },
    켜기: function (v) { 켬 = !!v; try { localStorage.setItem('g2.성능', 켬 ? '1' : '0'); } catch (e) { } if (!켬 && 판) 판.style.display = 'none'; return 켬; },
    기록: function () { return 기록.slice(); },
    /** 최근 n 프레임 평균(ms) — 측정 도구가 읽는다 */
    평균: function (n) {
      var 최근 = 기록.slice(-(n || 60)), o = { 장수: 최근.length };
      ['Frame', 'Game', 'Draw', 'GPU'].concat(세부).forEach(function (k) { var t = 0; 최근.forEach(function (줄) { t += 줄[k] || 0; }); o[k] = +(최근.length ? t / 최근.length : 0).toFixed(2); });
      return o;
    },
    /** 최근 n 프레임 중 가장 긴 프레임과 그 내역 */
    최악: function (n) { var 최근 = 기록.slice(-(n || 300)), m = null; 최근.forEach(function (줄) { if (!m || 줄.Frame > m.Frame) m = 줄; }); return m; },
    걸기: 걸기,
    수집: 수집,   /* 정본 408 */
    /** 바깥에서 잰 구간을 이 프레임에 더한다(전투 논리 pumpFrames 등) */
    더하기: function (키, ms) { if (!(키 in 누적)) { 누적[키] = 0; if (세부.indexOf(키) < 0) 세부.push(키); } 누적[키] += ms; }   /* 처음 보는 키는 세부에 더한다(3D 세부 등) */
  };
  root.G2성능 = API;
})(typeof window !== 'undefined' ? window : this);
