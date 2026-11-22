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
  var 누적 = {}, 기록 = [], 길이 = 900, 히치 = [], 보는초 = 6;   /* 900 장 — 6초를 120fps 까지 */
  세부.forEach(function (k) { 누적[k] = 0; });

  /* 함수 감싸기 — 같은 것을 두 번 감싸지 않는다 · 안쪽 중첩은 바깥 구간에도 들어간다(표시 ⊃ 3D) */
  function 감싸기(obj, 이름, 키) {
    if (!obj || typeof obj[이름] !== 'function' || obj[이름].__성능) return false;
    var 원 = obj[이름];
    var 새 = function () {
      var t = performance.now();
      try { return 원.apply(this, arguments); } finally { 누적[키] += performance.now() - t; }
    };
    새.__성능 = true; 새.__원 = 원;
    obj[이름] = 새; return true;
  }
  /* 대상은 전투가 뜬 뒤에야 생기거나 바뀐다(R · 3D 장면) — 1초마다 다시 본다 */
  function 걸기() {
    var R = root.R;
    if (R) {
      감싸기(R, 'apply', '표시');
      var s = R._리마스터3D;
      if (s && s.장면) 감싸기(s.장면, '그리기', '3D장면');
      if (s && s.가림) 감싸기(s.가림, '가림그리기', '3D가림');
    }
    if (root.G2Hud) 감싸기(root.G2Hud, 'draw', 'HUD');
    if (root.G2Fx) { 감싸기(root.G2Fx, 'draw', '효과그림'); 감싸기(root.G2Fx, 'update', '효과갱신'); 감싸기(root.G2Fx, '날씨칠하기', '효과그림'); }
    if (root.G2Ring) 감싸기(root.G2Ring, 'draw', '링');
    if (root.__셸) { 감싸기(root.__셸, '한걸음', '셸'); 감싸기(root.__셸, '렌더', '셸'); }
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
    /** 바깥에서 잰 구간을 이 프레임에 더한다(전투 논리 pumpFrames 등) */
    더하기: function (키, ms) { if (!(키 in 누적)) { 누적[키] = 0; if (세부.indexOf(키) < 0) 세부.push(키); } 누적[키] += ms; }   /* 처음 보는 키는 세부에 더한다(3D 세부 등) */
  };
  root.G2성능 = API;
})(typeof window !== 'undefined' ? window : this);
