/* ============================================================================
 * **캐릭터 에디터** — `G2캐릭터에디터` (정본 356 · 2026-11-21 · [리마스터])
 *
 *   사장님 11-21 「다른 사용자가 에디터를 요청했어 … 캐릭터 수정부분만 추출해서 에디터를 만들어서 배포하려고해 …
 *    실행기 파일과 연동해서 설치된 게임 폴더와 세이브파일 위치를 자동으로 찾아서 해당 파일을 수정할 수 있으면 좋겠어.」
 *   정한 것: 게임설정 창 «캐릭터 에디터»(타이틀·게임 중 모두) · 세이브 슬롯 SV1~SV5 만(DAT·DEF 못 고름) ·
 *     「수정한건 로드하면 적용될테니 에디터에 그부분만 안내」 · 고칠 것 = 능력치·레벨·HP/MP/TP · 직업·장비 · 팀 ·
 *     새로 만든 캐릭터(곁파일 .G2X)도 수정(만들기는 아님)
 *
 *   ── 길 ───────────────────────────────────────────────────────────────────
 *   읽기 : GET /__환경 (세이브파일 목록 = 실행기 세이브 폴더) → /원본/BLACKBOX.SVn?state=1 · .G2X · CHAPDATA/CONTIBAK.SVn
 *          → `G2ExtSession.런타임열기`(게임 불러오기와 같은 길 · screens.js 런타임명부열기)
 *   고침 : `G2캐릭터셈.고치기`(뷰어 능력치셈을 옮긴 것)
 *   저장 : `G2ExtSession.닫기` → POST /__세이브 {번호, blackbox, contibak(읽은 그대로), g2x} — 게임 저장(screens.js OPT세이브)과 같은 창구
 *          서버가 묶어서 바꾸고 바로 전 판을 .bak 으로 남긴다(server.js saveBundleReplace)
 *   ★ 저장 뒤 게임의 세이브 캐시를 비운다 — 불러오기 화면이 새 내용을 보게
 *   ★ 창 겉 꼴은 버그 신고 창(bug_report.js)과 같다 · 휴대폰은 `.g2판` 으로 터치를 그대로 통과(터치.js 판위)
 * ==========================================================================*/
(function (root) {
'use strict';

var 셈 = function () { return root.G2캐릭터셈; };
var 창 = null, 지금 = null, 띠글 = '';   /* 띠글 = 아래 단추 줄의 이름·지금 능력치 */   /* 지금 = { 번호, 세션, ct, 이름, 고른코드, 고침수, 장비자산 } */

function 글(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
function b64(u8) { var s = '', C = 0x8000; for (var i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); }
function 받기(이름, 없어도) {
  var url = '/원본/' + 이름.split('/').map(encodeURIComponent).join('/') + '?state=1';
  return fetch(url, { cache: 'no-store' }).then(function (r) {
    if (!r.ok) { if (없어도) return null; throw new Error(이름 + ' — HTTP ' + r.status); }
    return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
  }, function (e) { if (없어도) return null; throw e; });
}
function 자산() { var s = root.__상태; return (s && s.자산) || null; }

/* ── 슬롯 목록 · 열기 · 저장 ─────────────────────────────────────────────── */
function 슬롯목록() {
  return fetch('/__환경', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (e) {
    return ((e && e.세이브파일) || []).filter(function (m) { return (m.번호 | 0) >= 1 && (m.번호 | 0) <= 5; });
  });
}
function 장비자산받기() {
  var A = 자산();
  if (A && typeof A.장비받기 === 'function') return A.장비받기().then(function (r) { return r || {}; }, function () { return {}; });
  return Promise.resolve({});
}
/* 상태창 자산 — 아이템 아이콘(아이템캔 · ITEM.SPR)·작은 초상화(초상캔 · PORTSMAL.SYF) — 장비·초상화 그림 (게임.html 상태받기) */
function 상태자산받기() {
  var A = 자산();
  if (A && typeof A.상태받기 === 'function') return A.상태받기().then(function (r) { return r || {}; }, function () { return {}; });
  return Promise.resolve({});
}
function 슬롯열기(m) {
  var A = 자산();
  var 바탕 = (A && typeof A.바탕받기 === 'function') ? A.바탕받기()['catch'](function () { }) : Promise.resolve();   /* 새 캐릭터 정의(G2DEF) — 게임 세이브받기와 같다 */
  return 바탕.then(function () {
    return Promise.all([받기(m.blackbox), 받기(m.contibak), 받기(m.blackbox + '.G2X', true)]);
  }).then(function (셋) {
    var S = root.G2ExtSession;
    var 세션 = S.런타임열기(셋[0], (셋[2] && 셋[2].length) ? 셋[2] : null, null, null, { source: 'BLACKBOX.SV' + m.번호 });
    return { 번호: m.번호 | 0, 시각: m.시각, 세션: 세션, ct: 셋[1], 고침수: 0, 고른코드: 0 };
  });
}
function 저장() {
  var S = root.G2ExtSession, 세 = 지금.세션;
  var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
  var 때 = String(d.getFullYear()).slice(2) + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  var 닫 = S.닫기(세.bb, 세.곁, 세.덧값, 때);
  var 몸 = { 번호: 지금.번호, blackbox: b64(닫.명부바이트), contibak: b64(지금.ct), g2x: 닫.곁바이트 ? b64(닫.곁바이트) : null, 덧세이브비움: !닫.곁바이트 };
  return fetch('/__세이브', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(몸) })
    .then(function (r) { return r.json(); })
    .then(function (j) {
      if (!j || !j.ok) throw new Error((j && j.말) || '저장 실패');
      var A = 자산(); if (A) A.세이브캐시 = null;   /* 불러오기 화면이 새 내용을 보게 */
      return j;
    });
}

/* ── 이름 ───────────────────────────────────────────────────────────────── */
function 직업이름(n) {
  var T = root.G2 && root.G2.tables && root.G2.tables['직업'], r = T && T[n | 0];
  return r ? (r['이름'] || r['영문'] || '') : '';
}
function 아이템이름(코드) {
  if (!(코드 | 0)) return '없음';
  var E = 지금 && 지금.장비자산, 이 = E && E.아이템이름 && E.아이템이름[(코드 | 0) - 1];
  if (!이) { var T = root.G2 && root.G2.tables && root.G2.tables['아이템'], r = T && T[(코드 | 0) - 1]; 이 = r ? (r['이름'] || r['영문']) : ''; }
  return (코드 | 0) + ' ' + (이 || '?');
}
function 아이템수() {
  var E = 지금 && 지금.장비자산;
  if (E && E.아이템레코드 && E.아이템레코드.length) return E.아이템레코드.length;
  var T = root.G2 && root.G2.tables && root.G2.tables['아이템'];
  return T ? T.length : 0;
}
/** 이 칸에 낄 수 있나 — 게임 장비창과 같은 판정(G2Equip.판정 · 지금 게임 설정의 리마스터 규칙 그대로) · 보조 칸·판정 못 하면 늘 참 */
function 낄수있나(c, 코드, 판정칸) {
  if (판정칸 == null || !(코드 | 0)) return true;
  var EQ = root.G2Equip, E = 지금.장비자산;
  if (!EQ || !EQ.판정 || !E || !E.아이템레코드) return true;
  try { return EQ.판정(c, (코드 | 0) - 1, E.아이템레코드, root.__CHPLE).칸[판정칸] === 1; } catch (e) { return true; }
}

/* ── 화면 ───────────────────────────────────────────────────────────────── */
/* ☠ 꼴 글 안에는 큰따옴표를 쓰지 않는다 — style="…" 속성을 끊어 단추가 흰 기본 꼴로 보였다(11-21 화면 찍어 봄) */
var 단추꼴 = 'font:14px Malgun Gothic,sans-serif;color:#f8e890;background:#4a5e4a;border:2px solid #1c1c1c;padding:5px 12px;cursor:pointer;white-space:nowrap;flex:none';   /* 휴대폰 가로에서 «다시/읽기»로 꺾였다 — 꺾지 않고 띠가 줄어든다 */
var 칸꼴 = 'background:#0e1410;color:#f0e0a0;border:1px solid #5e7660;font:14px Malgun Gothic,sans-serif;padding:3px 6px;box-sizing:border-box';

function 사람들() {
  var bb = 지금 && 지금.세션 && 지금.세션.bb;
  return ((bb && bb.캐릭터) || []).filter(function (c) { return c && c.이름 && String(c.이름).trim(); });
}
function 고른사람() {
  var 들 = 사람들();
  for (var i = 0; i < 들.length; i++) if ((들[i].코드 | 0) === (지금.고른코드 | 0)) return 들[i];
  return null;
}
function 알림(말, 나쁨) { var a = 창 && 창.querySelector('.g2에-알림'); if (a) { a.textContent = 말 || ''; a.style.minWidth = 말 ? '160px' : '0';   /* 글이 있을 때만 최소 폭 — 비었는데 폭을 잡으면 «닫기»가 다음 줄로 꺾였다 */ a.style.color = 나쁨 ? '#ff8a70' : '#ffcf8a'; } }

function 그리기() {
  if (!창) return;
  var 지금a = 지금칸(); if (지금a && 창.contains(지금a)) 옛초점 = 초점열쇠(지금a);
  var 몸 = 창.querySelector('.g2에-몸');
  if (!지금) { 몸.innerHTML = '<div style="padding:20px;color:#c8b890">위에서 세이브 슬롯을 고르세요.</div>'; return; }
  /* 처음부터 모든 사람을 캐릭터 번호 순서대로 · «파티만»이면 지금 파티만 (사장님 11-21 「현재 파티가 아닌 캐릭터도 에디트 할수 있어야해」·「캐릭터 번호가 있어서 기본적으로 진영 상관없이 순서대로 나와야하고, 파티만을 선택하면 현재 파티만」) */
  var bb = 지금.세션.bb, 활동 = bb['활동팀'] | 0, 파티만 = 창.querySelector('.g2에-모두') && 창.querySelector('.g2에-모두').checked;
  var 들 = 사람들().filter(function (c) { return !파티만 || (c.팀 | 0) === 활동; });
  들.sort(function (a, b) { return (a.코드 | 0) - (b.코드 | 0); });
  if (!지금.고른코드 && 들.length) 지금.고른코드 = 들[0].코드 | 0;
  var 목 = 들.map(function (c) {
    var 고름 = (c.코드 | 0) === (지금.고른코드 | 0);
    var v = 셈().보기값(c);
    return '<div data-코드="' + (c.코드 | 0) + '" tabindex="0" style="padding:5px 8px;cursor:pointer;border-bottom:1px solid #2c3a2e;' + (고름 ? 'background:#3a4e3a;color:#fff6c8' : '') + '">' +
      '<span style="color:#a8a080;font-size:12px">' + (c.코드 | 0) + '</span> ' + 글(c.이름) +
      '<div style="font-size:12px;color:#a8a080">Lv ' + v.레벨 + ' · ' + 글(직업이름(c.직업)) + ' · 진영 ' + (c.팀 | 0) + ((c.팀 | 0) === 활동 ? ' (파티)' : '') + '</div></div>';
  }).join('') || '<div style="padding:10px;color:#a8a080">사람이 없습니다 — «파티만»을 꺼 보세요.</div>';
  var c = 고른사람();
  var 팀값 = (bb.팀 || [])[활동], 돈 = 팀값 ? (팀값.소지금 >>> 0) : 0;
  몸.innerHTML =
    '<div style="width:min(250px,34vw);min-width:140px;display:flex;flex-direction:column;border-right:1px solid #3a4a3a">' +
      '<div style="padding:6px 8px;border-bottom:1px solid #3a4a3a;font-size:12.5px;color:#c8b890">현재 파티(진영 ' + 활동 + ') 소지금<br>' +
        (팀값 ? '<input type="number" inputmode="numeric" enterkeyhint="done" data-칸="소지금" value="' + 돈 + '" min="0" max="4294967295" style="' + 칸꼴 + ';width:100%;margin-top:3px">' : '<span style="color:#a8a080">없음</span>') + '</div>' +
      '<div style="flex:1;overflow-y:auto" class="g2에-목">' + 목 + '</div></div>' +
    '<div style="flex:1;overflow-y:auto;padding:4px 14px 2px;scrollbar-width:none" class="g2에-칸들">' + (c ? 칸들(c) : '') + '</div>';
  Array.prototype.forEach.call(몸.querySelectorAll('[data-코드]'), function (el) {
    el.addEventListener('click', function () { 지금.고른코드 = +el.getAttribute('data-코드'); 그리기(); });
  });
  Array.prototype.forEach.call(몸.querySelectorAll('[data-칸]'), function (el) {
    el.addEventListener('change', function () { if (el.__확정됨) return; 고침(el.getAttribute('data-칸'), el.value); });   /* Enter 로 이미 확정한 칸은 다시 그릴 때 오는 change 를 버린다(한 번 고친 것이 «저장 (2)»로 셌다) */
  });
  창.querySelector('.g2에-저장').disabled = !지금.고침수;
  창.querySelector('.g2에-저장').textContent = 지금.고침수 ? '저장 (' + 지금.고침수 + ')' : '저장';
  초점되살리기();
  var 띠 = 창.querySelector('.g2에-띠'); if (띠) 띠.innerHTML = c ? 띠글 : '';
  그림채우기();
}
/* ── 사람 하나의 칸 — 뷰어 캐릭터 화면과 같은 구성 (사장님 11-21 「HP MP TP도 처리 잘못되었어. 지금 뷰어에 적용된 형식으로 해야한다니까」·「마법 필살기 수정도 안되고..」·「스프라이트나 포트레이트도 바꿀수 있어야하는데」)
 *   위 «지금 능력치» 띠(보기만 · 뷰어 칸판.게임값판) · [왼쪽 캐릭터 정보 · 마법 문장 · 필살기 쌓음 | 오른쪽 능력치 표(칸 · 순수 능력치 · 장비 · 합산 능력치)] ·
 *   장비 다섯 칸 한 줄 + 아이템 그림 (사장님 11-21 배치 지시 셋) */
/* 초상화(PORTRAIT.SYF)·스프라이트(CHARACTE/<이름표 파일> · 선 자세 3번 프레임) 그림 — 뷰어 뷰어틀.고르개그림 과 같은 길 · 팔레트 GENESIS.PAL
 *   (사장님 11-21 「초상화 스프라이트도 나와야해」) · 게임 render.js 처럼 CHARACTE 를 패치본 먼저(G2URL) */
var 그림자원 = { 팔: null, 초상: null, 스프: {} };
function 원본바이트(이름) {
  var url = root.G2URL ? root.G2URL(이름) : '/원본/' + 이름.split('/').map(encodeURIComponent).join('/');
  return fetch(url).then(function (r) { return r.ok ? r.arrayBuffer().then(function (b) { return new Uint8Array(b); }) : null; }, function () { return null; });
}
function 팔받기() { var N = root.G2Native; return 그림자원.팔 || (그림자원.팔 = 원본바이트('GENESIS.PAL').then(function (b) { return b && N && N.decodePalette ? N.decodePalette(b) : null; })); }
function 초상받기() { var N = root.G2Native; return 그림자원.초상 || (그림자원.초상 = 원본바이트('PORTRAIT.SYF').then(function (b) { var v = b && N && N.decodeSYB ? N.decodeSYB(b) : null; return (v && v.frames) || null; })); }
function 스프파일(번호) {
  var R = root.G2Native && root.G2Native.리마스터_스프라이트;   /* 576~ 탑승 · 1101~ 리마스터 보행·비행형 등 — 원본 표보다 먼저 (native.js) */
  if (R && R[번호 | 0]) return R[번호 | 0];
  var T = root.G2 && root.G2.tables && root.G2.tables['스프라이트이름표'];
  if (!T) return null;
  for (var k in T) { var m = /^(\d+)~/.exec(k); if (m && Array.isArray(T[k])) { var i = (번호 | 0) - (+m[1]); if (i >= 0 && i < T[k].length) return T[k][i]; } }
  return null;
}
function 스프받기(파일) {
  var N = root.G2Native, 열 = String(파일 || '').toUpperCase();
  if (!열) return Promise.resolve(null);
  if (그림자원.스프[열]) return 그림자원.스프[열];
  var m = /^([^.]+)\.(.+)$/.exec(열), 짧은 = (m && m[1].length > 8) ? m[1].slice(0, 8) + '.' + m[2] : 열;   /* DOS 8.3 — 긴 이름은 잘린 것이 실제 파일 */
  return (그림자원.스프[열] = 원본바이트('CHARACTE/' + 짧은).then(function (b) {
    if (!b || !N) return null;
    var v = null; try { v = N.decodeNC2(b); } catch (e) { try { v = N.decodeSYB(b); } catch (e2) { v = null; } }
    var fs2 = v && v.frames; return fs2 ? (fs2[3] || fs2[fs2.length - 1] || fs2[0]) : null;   /* 3번 = 가만히 선 자세 (뷰어 전직보기.선자세) */
  }));
}
/** 스프라이트 번호 → 선 자세 프레임 · 여성판(1201~)은 파일이 아니라 «원본 조형 그림 + 색 옮김»이다 (native.js 여성판_규칙 · 게임과 같은 길)
 *   ☠ 파일 이름(ASSASINW2·ASSASINW3)을 8글자로 잘라 읽어 어쌔신(여) 셋이 같은 그림으로 나왔다 (사장님 11-21 「어쌔신 여는 색이 모두 달라야하는데 똑같이 나오네」) */
function 스프프레임(번호) {
  var N = root.G2Native, 여 = N && N.여성판조형 ? N.여성판조형(번호) : null;
  if (!여) return 스프받기(스프파일(번호));
  return 스프받기(스프파일(여.원본)).then(function (fr) { return (fr && N.램프옮긴사본) ? N.램프옮긴사본(fr, 여.옮김) : fr; });
}
/** 그린 뒤 — 그림 자리(data-그림)에 캔버스를 채운다 (비동기 · 다시 그려도 캐시라 빠르다) */
function 그림채우기() {
  if (!창) return;
  Array.prototype.forEach.call(창.querySelectorAll('[data-그림]'), function (곳) {
    var 갈래 = 곳.getAttribute('data-그림'), 번호 = +곳.getAttribute('data-번호'), 칸 = +곳.getAttribute('data-칸크기') || 64;
    var 프 = 갈래 === '초상' ? 초상받기().then(function (들) { return 들 && 들[번호]; }) : 스프프레임(번호);
    Promise.all([팔받기(), 프]).then(function (둘) {
      var 팔 = 둘[0], fr = 둘[1], N = root.G2Native;
      if (!곳.isConnected) return;
      if (!팔 || !fr || !N) { 곳.textContent = '—'; return; }
      var cv = N.frameToCanvas(fr, 팔), 배 = Math.max(1, Math.floor(칸 / Math.max(fr.w | 0, fr.h | 0, 1)));
      cv.style.cssText = 'width:' + (fr.w * 배) + 'px;height:' + (fr.h * 배) + 'px;image-rendering:pixelated';
      곳.innerHTML = ''; 곳.appendChild(cv);
    }, function () { 곳.textContent = '—'; });
  });
}
function 그림자리(갈래, 번호, 칸) { return '<span data-그림="' + 갈래 + '" data-번호="' + (번호 | 0) + '" data-칸크기="' + 칸 + '" style="display:inline-flex;align-items:center;justify-content:center;width:' + 칸 + 'px;height:' + 칸 + 'px;background:#0a0f0b;border:1px solid #3a4a3a;overflow:hidden"></span>'; }
var 그림캐시 = {};
function 그림주소(캔, 열쇠) {
  if (!캔) return '';
  if (그림캐시[열쇠]) return 그림캐시[열쇠];
  try { 그림캐시[열쇠] = 캔.toDataURL('image/png'); } catch (e) { 그림캐시[열쇠] = ''; }
  return 그림캐시[열쇠];
}
function 초상옵(지금, 끝) { var h = ''; for (var n = 0; n <= (끝 | 0); n++) h += '<option value="' + n + '"' + (n === (지금 | 0) ? ' selected' : '') + '>' + 글(n + ' ' + (초상이름[n] || '')) + '</option>'; return h; }
function 그림(주소, 크기) { return 주소 ? '<img src="' + 주소 + '" style="width:' + 크기 + 'px;height:' + 크기 + 'px;object-fit:contain;image-rendering:pixelated;background:#0a0f0b;border:1px solid #3a4a3a">' : '<span style="display:inline-block;width:' + 크기 + 'px;height:' + 크기 + 'px;border:1px solid #3a4a3a;background:#0a0f0b"></span>'; }
/* 리마스터에서 더한 캐릭터 스프라이트 이름 — native.js 리마스터_스프라이트 주석 그대로 (사장님 11-21 「1109 스프라이트 캐빈으로」·「1107은 신디」·「추가된 스프라이트도 모두 적용해야해」)
 *   576~582 는 말·비룡 위에 겹치는 탑승 그림 조각이라 캐릭터가 고르는 번호가 아니다 — 목록에서 뺀다 */
/* 초상화 번호 → 이름 — 뷰어 이름표.초상표싣기 와 같은 규칙으로 04_도구/뷰어/초상화이름.json(.SCE 전수 + BLACKBOX 명부) 에 초상화이름_손질.json(사장님 손질)을 덮어 «이름 (덧붙임)» 만 뽑음 (11-21)
 *   (사장님 11-21 「초상화도 이름 있잖아. 드롭다운에서 선택하게 해」) · 이름이 바뀌면 같은 방법으로 다시 뽑는다 · 없는 번호는 번호만 */
var 초상이름 = {"0":"캐빈","1":"신디","2":"아즈님","3":"마크·라이어","4":"하밀","5":"마하","6":"카인·카스","7":"크리스·라미온","8":"죠엘","9":"아니타","10":"잭슨","11":"사드","12":"그리엄","13":"라르고","14":"레이몬드·죠셉","15":"에리카","16":"자알","17":"키키","18":"데니스","19":"주다스","20":"켄","21":"프리스만·스 퍼","22":"사이브리드","23":"사이렌","24":"하야","25":"샘프라스","26":"뮐러","27":"베네스다","28":"니키타","29":"캐미","30":"지크","31":"라시드","32":"아가시","33":"울드","34":"클로토","35":"나크","36":"듀란트","37":"이올린","38":"라시드","39":"라시드(청년)","40":"라시드(성왕)","41":"듀란","42":"로카르노","43":"미카엘","44":"일지매","45":"G.스케빈져","46":"칼스타이너","47":"G.스케빈져(회색기사단)","48":"흑태자","49":"D.푸니르","50":"랜담","51":"알시온","52":"크로우","53":"테름","54":"로빈","55":"백옥당","56":"낭천","57":"아르시아","58":"아리아나","59":"하이젠버그","60":"반다이크","61":"에리히","62":"슈리","63":"베라딘","64":"칼스","65":"이루스","66":"디아블로","67":"쿤","68":"카메오","69":"기쉬네","70":"카슈타르","71":"한조","72":"번스타인","73":"팔타밀라","74":"카심","75":"스트라이더","76":"사라","77":"모젤","78":"비쉬누","79":"카자","80":"보리스","81":"다이커스","82":"로벨","83":"D.블레이드","84":"없음","85":"솔져","86":"솔져(여)","87":"솔져(제국)","88":"파이터(남)","89":"파이터(여)","90":"가드(남)","91":"가드(여)","92":"로열가드(남)","93":"로열가드(여)","94":"어스퀘이크(남)","95":"어스퀘이크(여)","96":"나이트(남)","97":"나이트(여)","98":"나이트(제국)","99":"팔라딘(남)","100":"팔라딘(여)","101":"팔라딘(제국)","102":"글래디에이터(남)","103":"글래디에이터(여)","104":"파이터(제국)","105":"워리어","106":"버서커","107":"제노사이더","108":"랜서(남)","109":"랜서(여)","110":"랜서(제국)","111":"제네럴(남)","112":"제네럴(여)","113":"제네럴(제국)","114":"아쳐(남)","115":"아쳐(여)","116":"아쳐(제국)","117":"헌터(남)","118":"헌터(여)","119":"헌터(제국)","120":"이글(남)","121":"이글(여)","122":"이글(제국)","123":"스나이퍼(남)","124":"스나이퍼(여)","125":"도둑(남)","126":"도둑(여)","127":"어쌔신","128":"레인저(남)","129":"레인저(여)","130":"스카우트(남)","131":"스카우트(여)","132":"메이지(남)","133":"매지션(남)","134":"알케미스트(남)","135":"위자드(남)","136":"파이어마스터","137":"썬더마스터","138":"아이스마스터","139":"워락","140":"위치","141":"네크로맨서","142":"리치","143":"드루이드","144":"매지션(여)","145":"셔먼","146":"엑소시스트","147":"몽크(남)","148":"몽크(여)","149":"클레릭(남)","150":"클레릭(여)","151":"프리스트","152":"비숍","153":"비숍(여)","154":"머맨솔져","155":"머맨아머","156":"머맨로드","157":"발탄솔져","158":"어절트발탄","159":"발탄로드","160":"지리학자(남)","161":"지리학자(여)","162":"서번트","163":"해적","164":"산적두목","165":"위자드(제국)","166":"산적","167":"선장","168":"킬러","169":"뱀파이어(남)","170":"뱀파이어(여)","171":"캘리퍼","172":"회색기사단","173":"폴라크라켄","174":"하피","175":"사라만다","176":"마리드","177":"지니","178":"스켈톤","179":"용아병","180":"좀비","181":"굴","182":"슬라임","183":"와이번","184":"골렘","185":"전갈","186":"고블린","187":"오크","188":"오거","189":"가고일","190":"박쥐","191":"자비에르","192":"화룡","193":"하지란","194":"브라이언","195":"호드","196":"사키스키","197":"크리스트","198":"웰링턴","199":"파웰","200":"볼츠만","201":"도미니크","202":"우르다나","203":"닌","204":"페넬로","205":"베놈","206":"둥가","207":"파이크","208":"하오","209":"아비게일","210":"철산고","211":"가파니","212":"아슈람","213":"클라리스","214":"마르샤","215":"아리아나jr","216":"그레이프","217":"릭","218":"엔데","219":"바하무트","220":"세실","221":"폴터","222":"화리스","223":"루델","224":"엔닐","225":"네오리스","226":"에크만","227":"알카마","228":"가라","229":"기어","230":"파즈","231":"마에트로","232":"메이","233":"로이드","234":"마하라자","235":"데이모스","236":"프라이오스","237":"비스바덴","238":"아비도스","239":"오브스쿠라","240":"샤크바리","241":"아트레우스","242":"디에네","243":"에르지아스","244":"엘가메데스","245":"카라트","246":"라에비우스","247":"비드고슈제","248":"파괴신 B","249":"파괴신 A","250":"파괴신 C","251":"카메오(이벤트)","252":"이올린(이벤트)","253":"GS(이벤트)","254":"바자"};
var 리마스터스프이름 = { 1101: 'HGS', 1103: '킬러3', 1104: '스트라이더', 1105: '창1 발탄솔져 지상', 1106: '창1 발탄솔져 비행', 1107: '신디', 1108: '아이스', 1109: '캐빈',
  1110: '가리우스 비행형', 1111: '라 비행형', 1112: '아발레스트 비행형', 1113: '야누스 비행형',
  1201: '드루이드(여)', 1202: '비숍(여)', 1203: '네크로맨서(여)', 1204: '리치(여)', 1205: '위저드(여)', 1206: '어쌔신(여) 2', 1207: '어쌔신(여) 3', 1208: '어쌔신(여)' };
function 스프라이트목록() {
  var T = root.G2 && root.G2.tables && root.G2.tables['스프라이트이름표'], 목 = [];
  if (T) Object.keys(T).forEach(function (k) {
    var m = /^(\d+)~/.exec(k); if (!m || !Array.isArray(T[k])) return;
    var 시작 = +m[1]; T[k].forEach(function (이름, i) { 목.push([시작 + i, 이름]); });
  });
  var R = root.G2Native && root.G2Native.리마스터_스프라이트;
  if (R) Object.keys(R).map(Number).filter(function (n) { return n >= 1100; }).sort(function (a, b) { return a - b; }).forEach(function (n) {
    목.push([n, (리마스터스프이름[n] ? 리마스터스프이름[n] + ' · ' : '') + R[n]]);
  });
  return 목;
}
function 무리(제목, 안, 덧꼴) { return '<div style="flex:1;min-width:280px;border:1px solid #3a4a3a;background:#18221b;padding:6px 10px' + (덧꼴 || '') + '">' + (제목 ? '<div style="color:#f8e890;margin-bottom:4px">' + 제목 + '</div>' : '') + 안 + '</div>'; }
function 반반(왼, 오) { return '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:8px 0">' + 왼 + 오 + '</div>'; }
function 표줄(이름, 안, 덧) { return '<tr><td style="color:#c8b890;padding:2px 8px 2px 0;white-space:nowrap">' + 이름 + '</td><td style="padding:2px 0">' + 안 + (덧 ? ' <span style="color:#a8a080;font-size:12px">' + 덧 + '</span>' : '') + '</td></tr>'; }
function 작은수(칸, 값, 최소, 최대, 폭) { return '<input type="number" inputmode="numeric" enterkeyhint="done" data-칸="' + 칸 + '" value="' + 값 + '" min="' + 최소 + '" max="' + 최대 + '" title="' + 최소 + '~' + 최대 + '" style="' + 칸꼴 + ';width:' + (폭 || 90) + 'px">'; }
function 칸들(c) {
  var K = 셈(), v = K.보기값(c), 한 = K.한도얻기(), 상 = (지금 && 지금.상태자산) || {};
  var 부 = function (n) { return (n | 0) === 0 ? '—' : ((n > 0 ? '+' : '−') + Math.abs(n | 0)); };
  var h = '';
  /* 지금 능력치 띠 — 보기만 */
  var 무기종류이름 = ['권 (맨손)', '검', '지팡이 (마법)', '창', '부 (도끼)', '궁', '특수'][v.무기종류] || '';
  띠글 = '<div style="display:flex;flex-wrap:wrap;align-items:baseline;gap:12px;color:#d8c890;font-size:13px">' +
    '<span style="font-size:16px;color:#fff6c8">' + 글(c.이름) + ' <span style="font-size:12px;color:#a8a080">코드 ' + (c.코드 | 0) + '</span></span><span style="color:#f8e890">지금 능력치</span><span>공격력 <b>' + v.공격력 + '</b></span><span>방어력 <b>' + v.방어력 + '</b></span>' +
    '<span>마법 저항 <b>' + v.마법저항 + '</b></span><span>최대 TP <b>' + v.최대TP + '</b></span><span>무기 종류 <b>' + 글(무기종류이름) + '</b></span></div>';
  /* 왼쪽 — 캐릭터 정보 */
  var 팀있음 = K.팀풀이.some(function (t) { return t[0] === v.팀; });
  var 팀목 = (팀있음 ? [] : [[v.팀, '(장 파일·처음 명부에 없는 번호)']]).concat(K.팀풀이).map(function (t) {
    return '<option value="' + t[0] + '"' + (t[0] === v.팀 ? ' selected' : '') + '>' + 글(t[0] + ' — ' + t[1]) + '</option>'; }).join('');
  var JT = (root.G2 && root.G2.tables && root.G2.tables['직업']) || [], 직목 = '';
  for (var j = 1; j < JT.length; j++) if (JT[j]) 직목 += '<option value="' + j + '"' + (j === v.직업 ? ' selected' : '') + '>' + 글(j + ' ' + 직업이름(j)) + '</option>';
  var 스번 = c['스프라이트번호'] | 0, 스목 = 스프라이트목록(), 스있음 = 스목.some(function (s) { return s[0] === 스번; });
  var 스옵 = (스있음 ? '' : '<option value="' + 스번 + '" selected>' + 스번 + ' (이름표에 없음)</option>') + 스목.map(function (s) {
    return '<option value="' + s[0] + '"' + (s[0] === 스번 ? ' selected' : '') + '>' + 글(s[0] + ' ' + s[1]) + '</option>'; }).join('');
  var 초번 = c['초상화'] | 0, 초캔 = 상.초상캔 && 상.초상캔[초번];
  var 성 = c['종족'] | 0, 성옵 = [[0, '0 남'], [1, '1 여'], [2, '2 언데드']].map(function (s) { return '<option value="' + s[0] + '"' + (s[0] === 성 ? ' selected' : '') + '>' + s[1] + '</option>'; }).join('');
  var 정보 = '<table style="border-collapse:collapse;font-size:13.5px">' +
    표줄('초상화', '<span style="display:inline-flex;align-items:center;gap:6px">' + 그림자리('초상', 초번, 64) + '<select data-칸="초상화" style="' + 칸꼴 + ';width:116px">' + 초상옵(초번, 한.초상화[1]) + '</select>' + 그림자리('스프', 스번, 64) + '</span>') +
    표줄('스프라이트', '<select data-칸="스프라이트" style="' + 칸꼴 + ';width:190px">' + 스옵 + '</select>') +
    표줄('직업', '<select data-칸="직업" style="' + 칸꼴 + ';width:190px">' + 직목 + '</select>') +
    표줄('성별', '<span style="display:inline-flex;align-items:center;gap:6px;white-space:nowrap"><select data-칸="성별" style="' + 칸꼴 + ';width:72px">' + 성옵 + '</select>' +
      '<span style="color:#c8b890">진영</span><select data-칸="팀" style="' + 칸꼴 + ';width:128px">' + 팀목 + '</select></span>') +
    '</table>';
  /* 오른쪽 — 능력치 표 (뷰어 칸판.게임값판 과 같은 줄·이름) */
  var 칸th = 'style="text-align:left;color:#c8b890;font-weight:normal;white-space:nowrap;padding:2px 8px 2px 0;border-bottom:1px solid #3a4a3a"';
  var 능줄 = function (이름, 칸, 순수, 한도, 장비, 합) { return '<tr><td style="color:#c8b890;white-space:nowrap;padding:2px 8px 2px 0">' + 이름 + '</td><td>' + 작은수(칸, 순수, 한도[0], 한도[1], 90) + '</td><td style="color:#a8a080;padding:0 8px">' + 장비 + '</td><td><b>' + 합 + '</b></td></tr>'; };
  var 능 = '<table style="border-collapse:collapse;font-size:13.5px"><thead><tr><th ' + 칸th.replace('color:#c8b890;font-weight:normal', 'color:#f8e890;font-weight:normal;font-size:14px') + '>능력치</th><th ' + 칸th + '>순수 능력치</th><th ' + 칸th + '>장비</th><th ' + 칸th + '>합산 능력치</th></tr></thead><tbody>' +
    능줄('레벨', '레벨', v.레벨, 한.레벨, '—', v.레벨) +
    능줄('경험치', '경험치', v.경험치, 한.경험치, '—', v.경험치) +
    능줄('마법 경험치', '마법경험치', v.마법경험치, 한.마법경험치, '—', v.마법경험치) +
    능줄('필살기 경험치', '필살경험치', v.필살경험치, 한.필살경험치, '—', v.필살경험치) +
    능줄('완력', 'str', v.순수.str, 한.순수, 부(v.장비.str), v.실효.str) +
    능줄('지력', 'int', v.순수.int, 한.순수, 부(v.장비.int), v.실효.int) +
    능줄('민첩', 'agi', v.순수.agi, 한.순수, 부(v.장비.agi), v.실효.agi) +
    능줄('권위', 'cha', v.순수.cha, 한.순수, 부(v.장비.cha), v.실효.cha) +
    능줄('HP', '현재HP', v.현재HP, [0, v.최대HP], '—', v.현재HP) +
    능줄('최대 HP', '최대HP', v.최대HP, 한.최대HP, '—', v.최대HP) +
    능줄('MP', '현재MP', v.현재MP, [0, v.최대MP], '—', v.현재MP) +
    능줄('최대 MP', '순수MP', v.순수MP, 한.순수MP, 부(v.장비MP), v.최대MP) +
    '</tbody></table>';
  /* 마법 문장 | 필살기 — 마법 7칸은 4 + 3 두 줄(화염·빙한·전격·회복 / 보조·소환·암흑 · 정본 348-t) */
  var 마이름 = (root.G2MagicNames && root.G2MagicNames.ELEM && root.G2MagicNames.ELEM.length === 7) ? root.G2MagicNames.ELEM : ['화염', '빙한', '전격', '회복', '보조', '소환', '암흑'];
  var 마 = c['마법레벨'] || [], 마칸 = function (i) { return '<span style="display:inline-flex;flex-direction:column;align-items:center;margin:0 4px 0 0"><span style="font-size:12px;color:#c8b890">' + 글(마이름[i]) + '</span>' + 작은수('마법:' + i, 마[i] | 0, 한.마법[0], 한.마법[1], 34) + '</span>'; };
  var 마글 = '<div style="display:flex;align-items:center;gap:8px"><div style="color:#f8e890;line-height:1.25;white-space:nowrap">마법<br>문장</div><div style="white-space:nowrap">' + [0, 1, 2, 3, 4, 5, 6].map(마칸).join('') + '</div></div>';
  var 필이름 = ['검', '창', '도끼', '활', '권'], 필 = c['필살기숙련'] || [], 등 = c['필살기클래스등급'] | 0;
  var 등옵 = [0, 1, 2, 3, 4].map(function (n) { return '<option value="' + n + '"' + (n === 등 ? ' selected' : '') + '>' + ({ 0: '0 최상', 4: '4 최하' }[n] || n) + '</option>'; }).join('');
  /* 등급은 제목 줄로 · 상한 설명 뺌 (사장님 11-21 「필살기 상한 설명 지우고 그자리에 등급을 올려줘」) */
  /* 왼쪽 = «필살기» 아래 등급 고르개 · 오른쪽 = 무기별 다섯 칸 좁혀서 · 설명 뺌 (사장님 11-21 「필살기도 등급을 필살기 아래로 내리고 부가설명 없애고 무기별 필살기는 오르쪽으로 줄여서 배치」) */
  var 등글 = '<select data-칸="필살기등급" title="등급 — 작을수록 좋음" style="' + 칸꼴 + ';width:78px">' + 등옵 + '</select>';
  var 필글 = '<div style="display:flex;align-items:center;gap:8px"><div style="display:flex;flex-direction:column;gap:3px;white-space:nowrap"><span style="color:#f8e890">필살기</span>' + 등글 + '</div><div style="white-space:nowrap">' +
    필이름.map(function (이, i) { return '<span style="display:inline-flex;flex-direction:column;align-items:center;margin:0 4px 0 0"><span style="font-size:12px;color:#c8b890">' + 이 + '</span>' + 작은수('필살기:' + i, 필[i] | 0, 0, K.필살기한도[i], 34) + '</span>'; }).join('') +
    '</div></div>';
  /* 왼쪽에 캐릭터 정보 · 마법 문장 · 필살기를 쌓는다 — 초상화·스프라이트가 작아 비는 자리 (사장님 11-21 「스프라이트와 포트레이트가 작으니 마법문장과 필살기를 그쪽으로 올려도 좋겠어」) */
  var 왼 = '<div style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:8px">' + 무리('캐릭터 정보', 정보, ';flex:none') + 무리('', 마글, ';flex:none') + 무리('', 필글, ';flex:none') + '</div>';
  /* 장비 — 가로 다섯 칸 · 아이템 그림 · 무기·방패·장신구는 낄 수 있는 것만 · 보조는 능력치에 안 들어감 */
  var 수 = 아이템수(), eq = c.장비 || {};
  /* 한 줄 — 칸 이름을 그림 왼쪽에 · 그림 24 (사장님 11-21 「아이템이 지금 보기 안좋아. 줄여서 1줄에 넣으면 좋겠어」) */
  /* 가로 한 줄 · 두 칸 아래 화면 폭 전체 (사장님 11-21 「장비를 가로로 바꿔줘. 지금은 세로로 나열되어있어」 · 오른쪽 칸은 다섯을 가로로 놓기엔 좁다) */
  /* «장비» 제목을 왼쪽에 · 다섯 칸은 그 오른쪽에 조금씩 줄여서 (사장님 11-21 「장비도 조금씩 줄여서 제목 오른쪽으로」) */
  var 장글 = '<div style="display:flex;align-items:center;gap:10px"><div style="color:#f8e890;white-space:nowrap">장비</div><div style="flex:1;min-width:0;display:flex;gap:8px;flex-wrap:nowrap;align-items:flex-end">' + K.장비칸.map(function (k) {
    var 지금코드 = eq[k.열쇠] | 0, 옵 = '<option value="0"' + (지금코드 ? '' : ' selected') + '>없음</option>';
    for (var i = 1; i <= 수; i++) {
      if (i !== 지금코드 && !낄수있나(c, i, k.판정칸)) continue;
      옵 += '<option value="' + i + '"' + (i === 지금코드 ? ' selected' : '') + '>' + 글(아이템이름(i)) + '</option>';
    }
    var 캔 = 지금코드 && 상.아이템캔 && 상.아이템캔[지금코드 - 1];
    /* 칸마다 위 = 이름·그림 · 아래 = 고르개(폭 전체) — 한 줄이면 이름이 잘렸다 */
    return '<div style="flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:3px"><span style="display:flex;align-items:center;gap:6px;font-size:12px;color:#c8b890;white-space:nowrap">' +
      그림(그림주소(캔, '아' + 지금코드), 20) + k.이름 + '</span><select data-칸="장비:' + k.열쇠 + '" style="' + 칸꼴 + ';font-size:12.5px;padding:2px 3px;width:100%;min-width:0">' + 옵 + '</select></div>';
  }).join('') + '</div></div>';
  var 오 = '<div style="flex:1;min-width:280px;display:flex;flex-direction:column;gap:8px">' + 무리('', 능, ';flex:none') + '</div>';
  h += 반반(왼, 오);
  h += 무리('', 장글, ';margin:0');
  return h;
}

function 고침(칸, 값) {
  if (칸 === '소지금') {   /* 현재 파티 소지금 — bb.팀[활동팀].소지금 (u32 · 게임 screens.js 12057 · 뷰어 돈고치기와 같은 4바이트 칸) */
    var bb0 = 지금.세션.bb, 팀0 = (bb0.팀 || [])[bb0['활동팀'] | 0], n0 = Math.floor(Number(값));
    if (!팀0 || !isFinite(n0) || n0 < 0 || n0 > 4294967295) { 알림('소지금은 0~4,294,967,295 만 됩니다', true); 그리기(); return; }
    팀0.소지금 = n0; 지금.고침수++; 알림('고쳤습니다 — «저장»을 눌러야 파일에 씁니다'); 그리기(); return;
  }
  var c = 고른사람();
  if (!c) return;
  try {
    셈().고치기(c, 칸, 값);
    if (root.G2Blackbox && root.G2Blackbox.캐릭터동기화) { /* 객체 칸이 정본 — 닫기(직렬화)가 객체를 쓴다 */ }
    지금.고침수++;
    알림('고쳤습니다 — «저장»을 눌러야 파일에 씁니다');
  } catch (e) { 알림(String(e && e.message || e), true); }
  그리기();
}

function 슬롯고르기(m) {
  알림('읽는 중…');
  return 슬롯열기(m).then(function (s) {
    var E = 지금 && 지금.장비자산;
    지금 = s; 지금.장비자산 = E || {};
    셈().슬롯덧값잡기(s.세션 && s.세션.덧값, s.세션 && s.세션.bb && s.세션.bb.캐릭터);   /* 그 슬롯의 레벨 상한 해제(LVCP) */
    return Promise.all([장비자산받기(), 상태자산받기()]).then(function (둘) { var r = 둘[0]; 지금.상태자산 = 둘[1] || {}; 지금.장비자산 = r || {}; 알림(''); 옛초점 = null; 그리기(); 슬롯단추들(); 초점(창.querySelector('.g2에-목 [data-코드="' + 지금.고른코드 + '"]')); });
  }, function (e) { 알림('슬롯을 못 열었습니다 — ' + (e && e.message || e), true); });
}
var 목록캐시 = [];
function 슬롯단추들() {
  var 칸 = 창 && 창.querySelector('.g2에-슬롯');
  if (!칸) return;
  var h = '';
  for (var n = 1; n <= 5; n++) {
    var m = 목록캐시.filter(function (x) { return (x.번호 | 0) === n; })[0];
    var 고름 = 지금 && 지금.번호 === n;
    h += '<button data-슬롯="' + n + '"' + (m ? '' : ' disabled') + ' style="' + 단추꼴 + (고름 ? ';background:#7c9478;color:#10180f' : '') + (m ? '' : ';opacity:.4;cursor:default') + '">SV' + n + '</button>';
  }
  칸.innerHTML = h;
  Array.prototype.forEach.call(칸.querySelectorAll('[data-슬롯]'), function (b) {
    b.addEventListener('click', function () {
      var n = +b.getAttribute('data-슬롯'), m = 목록캐시.filter(function (x) { return (x.번호 | 0) === n; })[0];
      if (!m) return;
      if (지금 && 지금.고침수) return 물음('저장하지 않은 고침이 있습니다. 버리고 다른 슬롯을 열까요?', function () { 슬롯고르기(m); });
      슬롯고르기(m);
    });
  });
}
function 물음(말, 예) {
  var 띠 = 창.querySelector('.g2에-물음');
  띠.innerHTML = '<span>' + 글(말) + '</span> <button data-k="예" style="' + 단추꼴 + '">예</button> <button data-k="아니오" style="' + 단추꼴 + '">아니오</button>';
  띠.style.display = 'flex';
  초점(띠.querySelector('[data-k="예"]'));
  띠.querySelector('[data-k="예"]').onclick = function () { 띠.style.display = 'none'; 예(); };
  띠.querySelector('[data-k="아니오"]').onclick = function () { 띠.style.display = 'none'; };
}
/* ── 패드·키보드 — 위아래 = 칸 옮기기 · 좌우 = 값 바꾸기(숫자 ±1 · 목록 앞뒤) · 확인 = 누르기 · 취소 = 닫기 · 이전·다음 = 사람 바꾸기
 *   스팀덱·휴대폰 가상 패드는 pad_input.js 가 이 창이 열려 있으면 `패드(명령)` 를 곧바로 부른다 (사장님 11-21 「모바일이나 스팀에서는 … 패드로 조작이 가능하도록」)
 *   키보드는 방향키·Enter·Esc·PageUp/Down 이 같은 명령이다 · 숫자 칸은 글쇠로 바로 쳐도 된다 */
function 고를것들() {
  var 띠 = 창.querySelector('.g2에-물음');
  var 뿌리 = (띠 && 띠.style.display !== 'none') ? 띠 : 창;
  return Array.prototype.filter.call(뿌리.querySelectorAll('button,[data-코드],input,select'), function (el) {
    return !el.disabled && el.offsetParent !== null && !(뿌리 === 창 && 띠.contains(el));
  });
}
function 초점열쇠(el) {
  if (!el) return null;
  if (el.getAttribute('data-칸')) return '[data-칸="' + el.getAttribute('data-칸') + '"]';
  if (el.getAttribute('data-코드')) return '[data-코드="' + el.getAttribute('data-코드') + '"]';
  if (el.getAttribute('data-슬롯')) return '[data-슬롯="' + el.getAttribute('data-슬롯') + '"]';
  var c = (el.className || '').split(' ').filter(function (x) { return /^g2에-/.test(x); })[0];
  return c ? '.' + c : null;
}
var 옛초점 = null;
/* 터치 기기 — 패드로 옮길 땐 숫자·고르개 칸에 진짜 초점을 주지 않는다(초점만 가도 자판이 뜬다 · inputmode none 은 기기에 따라 무시됨)
 *   테두리만 옮기고(가상) 값은 에디터가 바꾼다 · 손가락으로 칸을 직접 누를 때만 진짜 초점 → 자판
 *   (사장님 11-21 「지금 가상키패드로 이동했을때 바로 숫자입력이 떠버려」 → 「아씨 아직도 에디터 화살표 이동하면 바로 키패드 뜨잖아!」·「안떠야한다고」) */
var 가상 = null;
function 터치기기() { try { return !!(root.matchMedia && root.matchMedia('(pointer: coarse)').matches); } catch (e) { return false; } }   /* 휴대폰·태블릿만 — 터치 화면 노트북(주 입력이 마우스)은 키보드로 숫자를 치게 진짜 초점 */
function 지금칸() { return (가상 && 가상.isConnected) ? 가상 : document.activeElement; }
function 칸에가기(el) {
  if (((el.tagName === 'INPUT' && el.type === 'number') || el.tagName === 'SELECT') && 터치기기()) {
    가상 = el; var a = document.activeElement; if (a && a !== document.body && 창 && 창.contains(a) && a.blur) a.blur();
  } else { 가상 = null; el.focus(); }
  자리표시(el);
}
function 초점되살리기() { if (!창 || !옛초점) return; var el = 창.querySelector(옛초점); if (el) { 칸에가기(el); if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); } }
var 바꿈중 = null;   /* { el, 옛값 } — ○ 로 잡은 숫자·고르개 */
function 바꿈끝() { var el = 바꿈중 && 바꿈중.el; if (el) el.classList.remove('g2에-바꿈'); 바꿈중 = null; if (el) 자리표시(el); }
/** 칸의 이름 자리 — 바로 앞 글 조각(화염·무기·진영·필살기) › 그 줄 첫 칸(레벨·완력·직업…) */
function 이름자리(el) {
  var 앞 = el && el.previousElementSibling;
  if (앞 && 앞.tagName === 'SPAN' && !앞.hasAttribute('data-그림')) return 앞;
  var 줄 = el && el.closest && el.closest('tr');
  return 줄 && 줄.cells && 줄.cells[0] !== el.closest('td') ? 줄.cells[0] : null;
}
function 자리표시(el) {
  if (!창) return;
  Array.prototype.forEach.call(창.querySelectorAll('.g2에-자리'), function (x) { x.classList.remove('g2에-자리'); });
  if (!el || !el.closest || el.classList.contains('g2에-바꿈')) return;
  if (el.tagName !== 'INPUT' && el.tagName !== 'SELECT') return;
  if (!el.closest('.g2에-칸들')) { if (el === 가상) el.classList.add('g2에-자리'); return; }   /* 소지금처럼 이름표 없는 칸 — 가상 초점일 땐 칸 자체에 테두리 */
  var 이 = 이름자리(el); if (이) 이.classList.add('g2에-자리');
}
/** 방향으로 가장 가까운 칸 — 그 방향 거리 + 옆으로 벗어난 만큼 덧셈(벗어남을 무겁게) · 없으면 null */
function 옆칸(들, a, 방향) {
  if (!a || !a.getBoundingClientRect) return 들[0];
  var r = a.getBoundingClientRect(), ax = r.left + r.width / 2, ay = r.top + r.height / 2, 최고 = null, 최점 = Infinity;
  들.forEach(function (b) {
    if (b === a) return;
    var q = b.getBoundingClientRect(); if (!q.width && !q.height) return;
    var dx = q.left + q.width / 2 - ax, dy = q.top + q.height / 2 - ay, 앞쪽, 옆쪽;
    if (방향 === '위') { 앞쪽 = -dy; 옆쪽 = Math.abs(dx); } else if (방향 === '아래') { 앞쪽 = dy; 옆쪽 = Math.abs(dx); }
    else if (방향 === '왼쪽') { 앞쪽 = -dx; 옆쪽 = Math.abs(dy); } else { 앞쪽 = dx; 옆쪽 = Math.abs(dy); }
    if (앞쪽 <= 2) return;
    var 점 = 앞쪽 + 옆쪽 * 3; if (점 < 최점) { 최점 = 점; 최고 = b; }
  });
  return 최고;
}
function 초점(el) { if (!el) return; 칸에가기(el); 옛초점 = 초점열쇠(el); if (el.scrollIntoView) el.scrollIntoView({ block: 'nearest' }); }
function 패드(명령) {
  if (!창) return false;
  var 들 = 고를것들(), a = 지금칸(), i = 들.indexOf(a);
  if (i < 0 && 명령 !== '취소') { 초점(들[0]); return true; }
  /* 방향키 = 화면 자리대로 칸 옮기기 · ○ = 숫자·고르개를 «바꾸는 중»으로 잡기 → 위·아래로 바꾸고(좌·우는 10배) ○ 확정 · ✕ 원래대로
   *   (사장님 11-21 「방향키로 전후좌우 움직이고 값 바꿀때 동그라미로 선택한뒤에 위아래로 바꾸는게 낫지 않아?」·「그상태에서 바꾸고 동그라미 누르면 확정 아니면 취소되면서 원래대로」) */
  if (바꿈중 && 바꿈중.el === a && a.isConnected) {
    if (명령 === '위' || 명령 === '아래' || 명령 === '왼쪽' || 명령 === '오른쪽') {
      var 크게 = 명령 === '왼쪽' || 명령 === '오른쪽', 올림 = 명령 === '위' || 명령 === '오른쪽' ? 1 : -1;
      if (a.tagName === 'SELECT') {   /* 고르개는 목록 차례대로 — 위 = 앞 항목 */
        var 칸수 = 크게 ? 10 : 1, n = Math.max(0, Math.min(a.options.length - 1, a.selectedIndex + (명령 === '위' || 명령 === '왼쪽' ? -칸수 : 칸수)));
        a.selectedIndex = n;
      } else {
        var 최대 = Number(a.max) || 0, 걸음 = 최대 >= 1e6 ? 1000 : 최대 >= 1e4 ? 10 : 1;   /* 소지금 1000 · HP·MP 10 · 나머지 1 */
        if (크게) 걸음 *= 10;
        a.value = Math.max(Number(a.min) || 0, Math.min(최대 || Infinity, (Number(a.value) || 0) + 올림 * 걸음));
      }
      return true;
    }
    if (명령 === '확인') { var 칸 = a.getAttribute('data-칸'), 값 = a.value, 바뀜 = 값 !== 바꿈중.옛값; 바꿈끝(); a.__확정됨 = true; if (바뀜) 고침(칸, 값); else 알림(''); return true; }
    if (명령 === '취소') { a.value = 바꿈중.옛값; 바꿈끝(); 알림('바꾸기를 취소했습니다'); return true; }
    return true;
  }
  if (바꿈중) 바꿈끝();
  if (명령 === '위' || 명령 === '아래' || 명령 === '왼쪽' || 명령 === '오른쪽') { var 옆 = 옆칸(들, a, 명령); if (옆) 초점(옆); return true; }
  if (명령 === '확인') {
    if (a.type === 'checkbox') { a.checked = !a.checked; a.dispatchEvent(new Event('change')); return true; }
    if (a.tagName === 'INPUT' && a.type === 'number' && a.value !== a.defaultValue) { a.__확정됨 = true; 고침(a.getAttribute('data-칸'), a.value); return true; }   /* 키보드로 숫자를 친 뒤 Enter = 확정 */
    if ((a.tagName === 'INPUT' && a.type === 'number') || a.tagName === 'SELECT') {
      바꿈중 = { el: a, 옛값: a.value }; a.classList.add('g2에-바꿈'); 자리표시(null); 알림('○ 확정 · ✕ 취소'); return true;
    }
    if (a.getAttribute('data-코드')) { a.click(); 초점(창.querySelector('.g2에-칸들 [data-칸]')); return true; }
    a.click(); return true;
  }
  if (명령 === '취소') { var 띠 = 창.querySelector('.g2에-물음'); if (띠.style.display !== 'none') 띠.style.display = 'none'; else 닫기물음(); 초점되살리기(); return true; }
  if (명령 === '이전' || 명령 === '다음') {
    if (!지금) return true;
    var 목 = Array.prototype.map.call(창.querySelectorAll('.g2에-목 [data-코드]'), function (el) { return +el.getAttribute('data-코드'); });
    var k = 목.indexOf(지금.고른코드 | 0) + (명령 === '이전' ? -1 : 1);
    if (k >= 0 && k < 목.length) { 지금.고른코드 = 목[k]; 그리기(); }
    return true;
  }
  return false;
}
var 키명령 = { ArrowUp: '위', ArrowDown: '아래', ArrowLeft: '왼쪽', ArrowRight: '오른쪽', Enter: '확인', Escape: '취소', PageUp: '이전', PageDown: '다음' };

/** 판을 980×720 으로 그려 창에 맞춰 통째로 늘리고 줄인다 — 어느 해상도든 같은 비율 (사장님 11-21 「지금 저 화면 비율대로 다른 데도 들어가면 안되는거야? 해상도 따라 달라?」)
 *   배율 0.7 아래(휴대폰 가로 등)는 글자가 너무 작아 예전처럼 화면을 채우고 스크롤 · zoom 은 누름 자리도 함께 맞는다(transform 과 달리 자리 계산이 그대로) */
var 판너비 = 980, 판높이 = 720;
function 판맞추기() {
  var 판 = 창 && 창.querySelector('.g2에-판'); if (!판) return;
  var 배 = Math.min(root.innerWidth * 0.96 / 판너비, root.innerHeight * 0.94 / 판높이, 2);
  if (배 >= 0.7) { 판.style.width = 판너비 + 'px'; 판.style.height = 판높이 + 'px'; 판.style.zoom = String(배); }
  else { 판.style.width = 'min(980px,96vw)'; 판.style.height = 'min(720px,94vh)'; 판.style.zoom = ''; }
}
function 닫기() { 바꿈중 = null; 가상 = null; root.removeEventListener('resize', 판맞추기); if (창 && 창.parentNode) 창.parentNode.removeChild(창); 창 = null; 지금 = null; 옛초점 = null; root.__캐릭터에디터열림 = false; }
function 닫기물음() { if (지금 && 지금.고침수) 물음('저장하지 않은 고침이 있습니다. 버리고 닫을까요?', 닫기); else 닫기(); }

function 열기() {
  if (창) return;
  if (!root.G2ExtSession || !root.G2캐릭터셈) { console.warn('[캐릭터 에디터] 모듈이 안 실렸습니다'); return; }
  root.__캐릭터에디터열림 = true;
  창 = document.createElement('div');
  창.className = 'g2에디터 g2판';
  if (!document.getElementById('g2에디터꼴')) { var 꼴 = document.createElement('style'); 꼴.id = 'g2에디터꼴'; 꼴.textContent = '.g2에디터 :focus{outline:2px solid #f8e890;outline-offset:1px}.g2에디터 [data-코드]:focus{background:#2e3e30}' +
      '.g2에디터 [data-칸^="마법:"],.g2에디터 [data-칸^="필살기:"]{padding-left:4px!important;padding-right:2px!important;text-align:center;-moz-appearance:textfield}.g2에디터 [data-칸^="마법:"]::-webkit-inner-spin-button,.g2에디터 [data-칸^="필살기:"]::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}' +
      '.g2에디터 .g2에-칸들::-webkit-scrollbar{display:none}' +
      '.g2에디터 .g2에-칸들 input:focus:not(.g2에-바꿈),.g2에디터 .g2에-칸들 select:focus:not(.g2에-바꿈){outline:none}.g2에디터 .g2에-자리{outline:2px solid #f8e890;outline-offset:2px}.g2에디터 .g2에-바꿈{outline:2px solid #f8e890!important;outline-offset:1px}' +
      '.g2에디터 .g2에-몸 input,.g2에디터 .g2에-몸 select{padding-top:1px!important;padding-bottom:1px!important;font-size:13px!important}.g2에디터 .g2에-몸 td{padding-top:1px!important;padding-bottom:1px!important}' +
      '@media (max-height:520px){.g2에디터 .g2에-안내{font-size:11px;line-height:1.35}.g2에디터 .g2에-머리{padding:5px 10px}}';   /* 휴대폰 가로 — 안내·머리를 줄여 고칠 칸 자리를 넓힌다 */ document.head.appendChild(꼴); }   /* g2판 — 휴대폰 터치를 그대로 통과(터치.js 판위) · 목록·스크롤이 손가락으로 된다 */
  창.style.cssText = 'position:fixed;inset:0;z-index:2147482000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;font:14px "Malgun Gothic",sans-serif;';
  창.innerHTML =
    '<div class="g2에-판" style="background:#1c2620;border:2px solid #7c9478;color:#f0e0a0;width:min(980px,96vw);height:min(720px,94vh);display:flex;flex-direction:column;box-shadow:0 8px 30px #000">' +
      '<div class="g2에-머리" style="display:flex;align-items:center;gap:10px;padding:10px 14px;border-bottom:1px solid #3a4a3a;flex-wrap:wrap">' +
        '<div style="font-size:19px">캐릭터 에디터</div><div class="g2에-슬롯" style="display:flex;gap:6px"></div>' +
        '<label style="margin-left:8px;color:#c8b890;font-size:13px"><input type="checkbox" class="g2에-모두"> 파티만</label>' +
        /* 안내는 «파티만» 옆 (사장님 11-21 「… 이건 파티만 옆으로」) */
        '<span class="g2에-안내" style="color:#c8b890;font-size:12px;line-height:1.4"><b style="color:#ffd890">고친 슬롯을 «불러오기» 하면 적용</b> · 바로 전 파일은 .bak 으로 남음</span></div>' +
      '<div class="g2에-몸" style="flex:1;display:flex;min-height:0"></div>' +
      '<div class="g2에-물음" style="display:none;align-items:center;gap:8px;padding:6px 14px;background:#3a2c20;color:#ffd8a0"></div>' +
      /* ☠ 알림 칸에 최소 폭 · 모자라면 다음 줄로 — 좁은 화면에서 띠가 폭을 다 먹어 알림이 한 자씩 세로로 쌓여 이 줄이 323px 로 늘고 칸 영역을 밀어냈다(손가락이 칸에 안 닿음 · 11-21 휴대폰 크기 실측) */
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px;padding:8px 14px;border-top:1px solid #3a4a3a">' +
        '<div class="g2에-띠" style="flex:0 1 auto;min-width:0"></div><div class="g2에-알림" style="flex:1 1 0;min-width:0;font-size:13px;color:#ffcf8a;word-break:keep-all"></div>' +
        '<button class="g2에-다시" style="' + 단추꼴 + '">다시 읽기</button>' +
        '<button class="g2에-저장" style="' + 단추꼴 + '" disabled>저장</button>' +
        '<button class="g2에-닫기" style="' + 단추꼴 + '">닫기 (Esc)</button></div>' +
    '</div>';
  창.addEventListener('focusin', function (e) { 가상 = null; if (!바꿈중) 자리표시(e.target); });
  창.addEventListener('pointerdown', function (e) {   /* 손가락·마우스로 숫자 칸을 직접 누름 → 숫자 자판 (이미 패드로 와 있던 칸이면 한 번 놓았다 다시 잡아 자판이 뜨게) */
    가상 = null;   /* 손으로 누르면 진짜 초점으로 */
    var t = e.target; if (!t || t.tagName !== 'INPUT' || t.type !== 'number') return;
    if (t.getAttribute('inputmode') === 'none') { t.setAttribute('inputmode', 'numeric'); if (document.activeElement === t) t.blur(); }
  }, true);
  /* 창 안의 키·마우스·터치는 게임으로 새지 않게 (버그 신고 창과 같다) */
  ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'wheel', 'contextmenu', 'touchstart', 'touchmove', 'touchend'].forEach(function (t) {
    창.addEventListener(t, function (e) {
      if (t === 'keydown' && 키명령[e.key]) { e.preventDefault(); 패드(키명령[e.key]); }
      e.stopPropagation();
    });
  });
  창.querySelector('.g2에-닫기').onclick = 닫기물음;
  창.querySelector('.g2에-모두').onchange = 그리기;
  창.querySelector('.g2에-다시').onclick = function () {
    if (!지금) return;
    var m = 목록캐시.filter(function (x) { return (x.번호 | 0) === 지금.번호; })[0];
    var 다시 = function () { var 코 = 지금.고른코드; 슬롯고르기(m).then(function () { if (지금) { 지금.고른코드 = 코; 그리기(); } }); };
    if (지금.고침수) 물음('저장하지 않은 고침을 버리고 파일에서 다시 읽을까요?', 다시); else 다시();
  };
  창.querySelector('.g2에-저장').onclick = function () {
    if (!지금 || !지금.고침수) return;
    var 코 = 지금.고른코드, m = 목록캐시.filter(function (x) { return (x.번호 | 0) === 지금.번호; })[0];
    알림('저장하는 중…');
    저장().then(function (j) {
      return 슬롯고르기(m).then(function () { if (지금) { 지금.고른코드 = 코; 그리기(); } 알림('슬롯 ' + j.말.replace(/^슬롯 /, '') + ' 했습니다 — 게임에서 이 슬롯을 불러오면 적용됩니다'); });
    }, function (e) { 알림('저장하지 못했습니다 — ' + (e && e.message || e), true); });
  };
  document.body.appendChild(창);
  판맞추기(); root.addEventListener('resize', 판맞추기);
  그리기();
  슬롯목록().then(function (목) {
    목록캐시 = 목; 슬롯단추들(); 초점(창.querySelector('[data-슬롯]:not([disabled])'));
    if (!목.length) 알림('세이브 슬롯이 없습니다 — 게임에서 한 번 저장한 뒤 여세요', true);
  }, function (e) { 알림('세이브 목록을 못 받았습니다 — ' + (e && e.message || e), true); });
}

var API = { 열기: 열기, 닫기: 닫기, 패드: 패드, 열림: function () { return !!창; } };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.G2캐릭터에디터 = API;
})(typeof window !== 'undefined' ? window : globalThis);
