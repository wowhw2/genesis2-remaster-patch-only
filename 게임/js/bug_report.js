/* ============================================================
 *  버그 신고 — 배포판에서 사용자가 문제를 알려 오게 한다 (2026-11-09)
 *
 *  사장님 11-09 「한편, 배포하면서 버그리포트도 가능하도록 만들어야해」 → 고르심 «둘 다»
 *    (신고 묶음 파일을 만들고, 받을 주소가 정해져 있으면 보내기도)
 *
 *  · 여는 길: 어디서든 F8 · 게임설정 › 일반 › 「버그 신고」 (game_settings.js)
 *  · 모으는 것: 사용자 설명 · 지금 장면(셸 화면·시나리오·모드·턴) · 설정 · 전투 유닛 요약 · 대본 기록 끝 · 콘솔/오류 기록(최근 400줄)
 *  · 앱(일렉트론 · window.G2앱): 화면 그림·세이브·설정까지 zip 하나로 만들어 폴더를 연다 (앱/main.js «버그신고»)
 *    받을 주소(앱/신고설정.json «주소»)가 있으면 «보내기»도 된다
 *  · 브라우저(개발판): 정보 JSON 을 내려받는다 (화면 그림·세이브는 빠진다)
 * ============================================================ */
(function (root) {
  'use strict';
  var 판 = '0.1.0';

  /* ── 콘솔·오류 기록 — 가장 먼저 실려 뒤에 나는 것을 다 모은다 ── */
  var 기록 = [], 기록한도 = 400;
  function 적기(수준, 인자) {
    try {
      var 글 = Array.prototype.map.call(인자, function (a) {
        if (a instanceof Error) return a.stack || a.message;
        if (typeof a === 'object') { try { return JSON.stringify(a).slice(0, 500); } catch (e) { return String(a); } }
        return String(a);
      }).join(' ');
      기록.push(new Date().toISOString().slice(11, 23) + ' [' + 수준 + '] ' + 글.slice(0, 2000));
      if (기록.length > 기록한도) 기록.splice(0, 기록.length - 기록한도);
    } catch (e) { }
  }
  if (root.console) ['log', 'info', 'warn', 'error'].forEach(function (k) {
    var 옛 = root.console[k];
    if (typeof 옛 !== 'function') return;
    root.console[k] = function () { 적기(k, arguments); return 옛.apply(this, arguments); };
  });
  /* ── 정본 337 — 화면 속도(장 사이 시간) 최근 600장 · 신고의 «진단» 칸이 쓴다 (사장님 11-20 「혹시 로그 기능을 첨부해서 해당 로그파일만 바로 전달받으면 수정도 쉽지 않을까?」)
   *   «이동이 느리다»(아이폰 1-2)·«메탈이 아니라 CPU 로 그린다» 같은 제보를 신고 파일 하나로 가른다 ── */
  var 장사이 = [];
  (function 재기() {
    if (typeof root.requestAnimationFrame !== 'function') return;
    var 앞 = 0;
    function 한장(t) { if (앞 && t - 앞 < 2000) { 장사이.push(t - 앞); if (장사이.length > 600) 장사이.shift(); 초에넣기(t, t - 앞); } 앞 = t; root.requestAnimationFrame(한장); }
    root.requestAnimationFrame(한장);
  })();
  /* 정본 341 — 휴대폰은 옵션을 열어야 신고할 수 있어 «최근 600장»이 옵션 화면 값으로 바뀐다
   *   (사장님 11-20 「일단 패드에서 접수를 하려면 옵션을 열어서 할수밖에 없어. 느린 화면에서 바로 보낼수가 없어」)
   *   ⇒ 최근 3분을 1초씩(장면 이름·장 수·가장 긴 장) 적어 두고, 장면별 요약도 따로 — 옵션을 열기 전 느린 구간이 신고에 남는다 */
  var 초기록 = [], 장면별 = {};
  function 지금장면() {
    var 셸 = '', 맵 = '';
    try { 셸 = root.__셸 && root.__셸.수명주기 ? root.__셸.수명주기().화면 || '' : ''; } catch (e) { }
    try { var G = root.G2; 맵 = G && G.scene ? G.scene._시나리오 || G.scene['맵파일'] || '' : ''; } catch (e) { }
    return 셸 + (맵 ? ' ' + 맵 : '');
  }
  function 초에넣기(t, 사이) {
    var 초 = Math.floor(t / 1000), 끝 = 초기록[초기록.length - 1], 면 = 지금장면();
    if (!끝 || 끝.초 !== 초 || 끝.장면 !== 면) {   /* 1초 안에서 장면이 바뀌어도 칸을 새로 — 옵션 장이 앞 장면 값에 섞이지 않게 */
      끝 = { 초: 초, 장면: 면, 장: 0, 합: 0, 최장: 0 }; 초기록.push(끝); if (초기록.length > 240) 초기록.shift();
    }
    끝.장++; 끝.합 += 사이; if (사이 > 끝.최장) 끝.최장 = 사이;
    var s = 장면별[끝.장면] || (장면별[끝.장면] = { 장: 0, 합: 0, 끊김: 0 });
    s.장++; s.합 += 사이; if (사이 > 50) s.끊김++;
  }
  function 진단() {
    var o = {};
    o.화면속도 = 해(function () {
      if (!장사이.length) return null;
      var 정렬 = 장사이.slice().sort(function (a, b) { return a - b; }), 합 = 장사이.reduce(function (s, v) { return s + v; }, 0);
      var 느림 = 정렬[Math.floor(정렬.length * 0.95)] || 정렬[정렬.length - 1];
      return { 장: 장사이.length, 평균fps: Math.round(1000 / (합 / 장사이.length) * 10) / 10, 느린5퍼fps: Math.round(1000 / 느림 * 10) / 10, 끊김장_50ms넘음: 장사이.filter(function (v) { return v > 50; }).length };
    });
    /* 정본 341 — 장면별 평균 · 최근 3분 1초씩(지금에서 몇 초 전 · 장면 · fps · 가장 긴 장 ms) */
    o.장면별화면속도 = 해(function () {
      var r = {};
      Object.keys(장면별).forEach(function (k) { var s = 장면별[k]; r[k || '(모름)'] = { 장: s.장, 평균fps: Math.round(1000 / (s.합 / s.장) * 10) / 10, 끊김장_50ms넘음: s.끊김 }; });
      return r;
    });
    o.최근3분 = 해(function () {
      var 끝 = 초기록.length ? 초기록[초기록.length - 1].초 : 0;
      return 초기록.map(function (c) { return (끝 - c.초) + '초 전 · ' + (c.장면 || '(모름)') + ' · ' + Math.round(1000 / (c.합 / c.장)) + 'fps · 최장 ' + Math.round(c.최장) + 'ms'; });
    });
    o.그래픽 = 해(function () {
      var c = document.createElement('canvas'), gl = c.getContext('webgl2') || c.getContext('webgl'), r = { webgl: !!gl, webgl2: !!(gl && root.WebGL2RenderingContext && gl instanceof root.WebGL2RenderingContext) };
      if (gl) {
        var d = gl.getExtension('WEBGL_debug_renderer_info');
        r.장치 = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        r.만든곳 = d ? gl.getParameter(d.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
        r.텍스처한도 = gl.getParameter(gl.MAX_TEXTURE_SIZE);
        var lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      }
      return r;
    });
    o.화면 = 해(function () { return { 배율: root.devicePixelRatio, 기기화면: screen.width + '×' + screen.height, 창: root.innerWidth + '×' + root.innerHeight }; });
    o.스케일러배 = 해(function () { return root.G2Scaler && G2Scaler.N ? G2Scaler.N() : null; });
    o.보기3D = 해(function () { return localStorage.getItem('리마스터3D보기'); });
    o.모바일 = 모바일;
    o.메모리MB = 해(function () { return performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' / ' + Math.round(performance.memory.jsHeapSizeLimit / 1048576) : null; });
    o.리마스터판 = 해(function () { return root.G2리마스터판 || (typeof document !== 'undefined' && document.title) || ''; });
    /* 정본 343 — 아이폰 «종료» 창구(앱 본체 R0.1.21 아이폰_시작.swift G2ExitGate)가 달렸나 · 신고 «판» 은 패치 판이라 본체가 새것인지 이것으로 가른다 */
    o.종료창구 = 해(function () { return !!(root.webkit && root.webkit.messageHandlers && root.webkit.messageHandlers.g2exit); });
    return o;
  }
  /* 휴대폰(주소 «모바일=1»)은 앱 창구(G2앱)가 없다 — 신고를 zip 으로 묶어 같은 받는 곳(구글 드라이브 Apps Script · 앱/신고설정.json 과 같은 주소)으로 곧바로 보낸다 */
  var 모바일 = false; try { var 물 = String(location.search || ''); try { 물 = decodeURIComponent(물); } catch (e1) { } 모바일 = /[?&]모바일=1/.test(물); } catch (e2) { }
  var 휴대폰신고주소 = 'https://script.google.com/macros/s/AKfycbyWAiC12QPSOFv7RvUnGeJSHEbyY1YHKQQeD7mR_6XUlIhv3WrGmR-zCyBgBLtvotZU/exec';   /* 02_실행기/앱/신고설정.json «주소» 와 같게 */
  /* 압축 없는 zip (설명·정보·콘솔·화면) — 받는 쪽이 zip 으로 저장한다 */
  var 크표 = null;
  function 크32(b) { if (!크표) { 크표 = []; for (var n = 0; n < 256; n++) { var c = n; for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; 크표[n] = c >>> 0; } }
    var x = 0xFFFFFFFF; for (var i = 0; i < b.length; i++) x = 크표[(x ^ b[i]) & 0xFF] ^ (x >>> 8); return (x ^ 0xFFFFFFFF) >>> 0; }
  function zip만들기(목록) {
    var 조각 = [], 가운데 = [], 자리 = 0, 엔 = new TextEncoder();
    var u16 = function (v) { return [v & 255, (v >>> 8) & 255]; }, u32 = function (v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; };
    목록.forEach(function (f) {
      var 이름 = 엔.encode(f.이름), 몸 = f.바이트, crc = 크32(몸);
      var 머리 = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(몸.length), u32(몸.length), u16(이름.length), u16(0));
      조각.push(new Uint8Array(머리), 이름, 몸);
      가운데.push(new Uint8Array([].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0), u32(crc), u32(몸.length), u32(몸.length), u16(이름.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(자리))), 이름);
      자리 += 머리.length + 이름.length + 몸.length;
    });
    var 가운데길이 = 가운데.reduce(function (s, a) { return s + a.length; }, 0);
    var 끝 = new Uint8Array([].concat(u32(0x06054b50), u16(0), u16(0), u16(목록.length), u16(목록.length), u32(가운데길이), u32(자리), u16(0)));
    var 모두 = 조각.concat(가운데, [끝]), 길이 = 모두.reduce(function (s, a) { return s + a.length; }, 0), 밖 = new Uint8Array(길이), p = 0;
    모두.forEach(function (a) { 밖.set(a, p); p += a.length; });
    return 밖;
  }
  function 바64(b) { var s = '', 덩 = 0x8000; for (var i = 0; i < b.length; i += 덩) s += String.fromCharCode.apply(null, b.subarray(i, i + 덩)); return btoa(s); }
  if (root.addEventListener) {
    root.addEventListener('error', function (e) { 적기('오류', [(e.message || '') + ' @' + (e.filename || '') + ':' + (e.lineno || '') + (e.error && e.error.stack ? '\n' + e.error.stack : '')]); });
    root.addEventListener('unhandledrejection', function (e) { 적기('약속거부', [e.reason]); });
  }

  /* ── 지금 상태 모으기 — 실패해도 신고는 만든다(칸마다 감싼다) ── */
  function 해(f) { try { return f(); } catch (e) { return '읽기 실패: ' + (e && e.message); } }
  function 모으기(설명) {
    var b = root.battle, ct = root.ctrl, G = root.G2;
    return {
      판: root.G2리마스터판 || 판, 때: new Date().toISOString(), 설명: 설명 || '',
      앱: !!root.G2앱, 주소: 해(function () { return location.pathname + location.search; }),
      창: 해(function () { return root.innerWidth + '×' + root.innerHeight; }),
      셸화면: 해(function () { return root.__셸 && __셸.수명주기 ? __셸.수명주기().화면 : null; }),
      시나리오: 해(function () { return G && G.scene ? G.scene._시나리오 || G.scene['맵파일'] : null; }),
      모드: 해(function () { return ct ? ct.mode : null; }),
      턴: 해(function () { return b ? { turn: b.turn, phase: b.phase, timeIdx: b.timeIdx } : null; }),
      설정: 해(function () { return root.G2Opt && G2Opt.cfg ? JSON.parse(JSON.stringify(G2Opt.cfg)) : null; }),
      스케일러: 해(function () { return root.G2Scaler && G2Scaler.cur ? G2Scaler.cur() : null; }),
      유닛: 해(function () {
        return b && b.units ? b.units.map(function (u) {
          return [u.id, String(u.name || '').trim(), u.charCode, 'side' + u.side, '팀' + u.팀, '그룹' + u.그룹, u.x + ',' + u.y,
                  'hp' + u.hp + '/' + u.maxHp, 'job' + u.job, 'lv' + u.level, u.alive ? '' : '죽음'].join(' ');
        }) : null;
      }),
      대본기록: 해(function () {
        var L = root.__SCE런타임 && __SCE런타임.로그 && __SCE런타임.로그.줄;
        return L ? L.slice(-60).map(function (x) { return (x.수준 || '') + ' ' + (x.글 || ''); }) : null;
      }),
      브라우저: 해(function () { return navigator.userAgent; }),
      진단: 진단(),   /* 정본 337 — 화면 속도 · 그래픽 장치 · 배율 · 스케일러 · 3D */
      배경음점검: 배경음점검   /* 정본 362 — 원본·CD 경로 · /CD/2·/CD/11 응답 */
    };
  }

  /* ── 신고 창 (DOM 덮개 — 게임 그림과 상관없이 늘 같은 자리) ── */
  var 창 = null, 찍은화면 = null, 주소있음 = false;
  function 닫기() { if (창 && 창.parentNode) 창.parentNode.removeChild(창); 창 = null; 찍은화면 = null; }
  function 알림(글) { var e = 창 && 창.querySelector('.g2신고-알림'); if (e) e.textContent = 글; }
  function 내려받기(이름, 글) {
    var a = document.createElement('a'), u = URL.createObjectURL(new Blob([글], { type: 'application/json' }));
    a.href = u; a.download = 이름; document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(u); if (a.parentNode) a.parentNode.removeChild(a); }, 1000);
  }
  function 만들기(보내기) {
    var 설명 = (창.querySelector('textarea').value || '').trim();
    if (!설명) { 알림('무엇이 잘못됐는지 한 줄이라도 적어 주세요.'); return; }
    var 정보 = 모으기(설명), 콘솔 = 기록.join('\n');
    if (root.G2앱 && typeof root.G2앱.버그신고 === 'function') {
      알림(보내기 ? '묶어서 보내는 중…' : '묶는 중…');
      root.G2앱.버그신고({ 정보: JSON.stringify(정보, null, 1), 콘솔: 콘솔, 설명: 설명, 화면: 찍은화면, 보내기: !!보내기 })
        .then(function (r) {
          if (!r) { 알림('만들지 못했습니다.'); return; }
          var 말 = '만들었습니다 — ' + r.파일;
          if (보내기) 말 += r.보냄 ? ' · 보냈습니다. 고맙습니다!' : ' · 보내지 못했습니다(' + (r.실패 || '?') + ') — 파일을 직접 보내 주세요.';
          알림(말);
        }, function (e) { 알림('만들지 못했습니다: ' + (e && e.message)); });
      return;
    }
    /* 휴대폰 — zip 으로 묶어 받는 곳으로 곧바로 (정본 337) · 응답은 못 읽는다(다른 주소라) — 보낸 것까지만 알린다 */
    if (모바일) {
      try {
        var 엔 = new TextEncoder(), 이름 = '버그신고_휴대폰_' + 정보.때.replace(/[-:]/g, '').replace('T', '_').slice(0, 15) + '.zip';
        var 목록 = [{ 이름: '설명.txt', 바이트: 엔.encode(설명) }, { 이름: '정보.json', 바이트: 엔.encode(JSON.stringify(정보, null, 1)) }, { 이름: '콘솔.txt', 바이트: 엔.encode(콘솔) }];
        if (찍은화면) 목록.push({ 이름: '화면.png', 바이트: Uint8Array.from(atob(찍은화면), function (ch) { return ch.charCodeAt(0); }) });
        var 묶음 = zip만들기(목록);
        알림('보내는 중…');
        fetch(휴대폰신고주소, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ 이름: 이름, 설명: 설명.slice(0, 2000), zip: 바64(묶음) }) })
          .then(function () { 알림('보냈습니다. 고맙습니다! (' + 이름 + ')'); }, function (e) { 알림('보내지 못했습니다 — 인터넷을 확인해 주세요 (' + (e && e.message) + ')'); });
      } catch (e3) { 알림('만들지 못했습니다: ' + (e3 && e3.message)); }
      return;
    }
    /* 브라우저(개발판) — 정보만 내려받는다 */
    내려받기('버그신고_' + 정보.때.replace(/[:.]/g, '-') + '.json', JSON.stringify({ 정보: 정보, 콘솔: 기록 }, null, 1));
    알림('정보 파일을 내려받았습니다 (브라우저에서는 화면 그림·세이브가 빠집니다).');
  }
  /* 정본 362 — 배경음 점검(신고 창을 열 때 미리) · 서버가 아는 원본·CD 경로와 /CD/n 이 돌려준 것 — 서버 쪽 실패 까닭은 신고에 안 남아 «왜 안 나오나»를 못 가렸다
   *   (신고 버그신고_휴대폰_20261120_202452 · 아이패드 미니6 R0.1.43 「브금은 여전히 안나옵니다」) */
  var 배경음점검 = null;
  function 배경음살피기() {
    배경음점검 = { 상태: '재는 중' };
    var 결과 = {};
    var 트랙 = function (n) {
      return fetch('/CD/' + n, { headers: { Range: 'bytes=0-43' }, cache: 'no-store' })
        .then(function (r) { 결과['CD' + n] = r.status + ' ' + (r.headers.get('content-type') || '') + ' ' + (r.headers.get('content-range') || r.headers.get('content-length') || ''); return r.arrayBuffer(); })
        .then(function () { }, function (e) { 결과['CD' + n] = '실패 ' + (e && e.message); });
    };
    var 환경 = fetch('/__환경', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (e) {
      결과.원본경로 = e && e.원본경로; 결과.CD경로 = e && e.CD경로; 결과.CD찾음 = e && e.CD찾음; 결과.세이브경로 = e && e.세이브경로;
    }, function (e) { 결과.환경 = '실패 ' + (e && e.message); });
    /* 휴대폰 — 앱 설치 서버(본체 47861 /cdcheck)의 CD폴더·원본 폴더 파일 목록과 cue 안 FILE (사장님은 신고자에게 되물을 수 없다 · 11-21) */
    var 설치CD = !모바일 ? Promise.resolve() : fetch('http://127.0.0.1:47861/cdcheck', { cache: 'no-store' }).then(function (r) { return r.json(); })
      .then(function (j) { 결과.설치CD = j; }, function (e) { 결과.설치CD = '실패 ' + (e && e.message); });
    Promise.all([환경, 트랙(2), 트랙(11), 설치CD]).then(function () { 배경음점검 = 결과; }, function () { 배경음점검 = 결과; });
  }
  function 열기() {
    if (창) return;
    try { 배경음살피기(); } catch (e배) { 배경음점검 = { 상태: '못 잼 ' + (e배 && e배.message) }; }
    var 시작 = function () {
      창 = document.createElement('div');
      창.className = 'g2신고';
      창.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:15px "Malgun Gothic",sans-serif;';
      창.innerHTML =
        '<div style="background:#1c2620;border:2px solid #7c9478;color:#f0e0a0;padding:18px 20px;width:min(560px,92vw);box-shadow:0 8px 30px #000">' +
        '<div style="font-size:19px;margin-bottom:8px">버그 신고</div>' +
        '<div style="color:#c8b890;font-size:13px;line-height:1.6;margin-bottom:10px">무엇이 잘못됐는지, 어떻게 하다 그랬는지 적어 주세요.<br>' +
        '지금 화면 그림 · 장면 정보 · 세이브 · 기록을 함께 묶습니다.</div>' +
        '<textarea style="width:100%;height:130px;box-sizing:border-box;background:#0e1410;color:#f0e0a0;border:1px solid #5e7660;font:14px \'Malgun Gothic\',sans-serif;padding:8px" placeholder="예) 24-1A 에서 아수라파천무가 안 나가요"></textarea>' +
        '<div class="g2신고-알림" style="min-height:20px;margin:8px 0;color:#ffcf8a;font-size:13px;word-break:break-all"></div>' +
        '<div style="display:flex;gap:8px;justify-content:flex-end">' +
        (모바일 ? '' : '<button data-k="만들기">묶음 파일 만들기</button>') +   /* 휴대폰은 파일을 남길 수 없다 — 보내기만 */
        (주소있음 || 모바일 ? '<button data-k="보내기">만들어서 보내기</button>' : '') +
        '<button data-k="닫기">닫기 (Esc)</button></div></div>';
      Array.prototype.forEach.call(창.querySelectorAll('button'), function (bt) {
        bt.style.cssText = 'font:14px "Malgun Gothic",sans-serif;color:#f8e890;background:#4a5e4a;border:2px solid #1c1c1c;padding:6px 14px;cursor:pointer';
        bt.addEventListener('click', function (e) {
          e.stopPropagation();
          var k = bt.getAttribute('data-k');
          if (k === '닫기') 닫기(); else 만들기(k === '보내기');
        });
      });
      /* 신고 창 안의 키는 게임으로 새지 않게 */
      ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'wheel', 'contextmenu'].forEach(function (t) {
        창.addEventListener(t, function (e) { if (t === 'keydown' && e.key === 'Escape') 닫기(); e.stopPropagation(); });
      });
      document.body.appendChild(창);
      setTimeout(function () { var ta = 창 && 창.querySelector('textarea'); if (ta) ta.focus(); }, 30);
    };
    /* 앱이면 신고 창을 띄우기 «전»에 지금 화면을 찍어 둔다 · 주소가 있는지도 묻는다 */
    if (root.G2앱 && typeof root.G2앱.화면찍기 === 'function') {
      Promise.all([root.G2앱.화면찍기().catch(function () { return null; }),
                   (root.G2앱.신고주소있나 ? root.G2앱.신고주소있나() : Promise.resolve(false)).catch(function () { return false; })])
        .then(function (r) { 찍은화면 = r[0]; 주소있음 = !!r[1]; 시작(); });
    } else {
      /* 휴대폰 — 게임 화면 캔버스(#화면)를 찍어 둔다(3D 판은 따로라 안 담길 수 있다) */
      if (모바일) try { var cv = document.getElementById('화면'); if (cv && cv.toDataURL) 찍은화면 = cv.toDataURL('image/png').split(',')[1] || null; } catch (e4) { 찍은화면 = null; }
      시작();
    }
  }

  /* F8 — 어디서든 (게임 키 처리보다 먼저 잡는다) */
  if (root.addEventListener) root.addEventListener('keydown', function (e) {
    if (e.key === 'F8') { e.preventDefault(); e.stopPropagation(); if (창) 닫기(); else 열기(); }
  }, true);

  var API = { 열기: 열기, 닫기: 닫기, 모으기: 모으기, 기록: function () { return 기록.slice(); }, 판: 판, _zip: zip만들기, _바64: 바64, _만들기: function (보내기) { return 만들기(보내기); } };   /* _ 셋은 시험용 */
  root.G2버그신고 = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window : globalThis);
