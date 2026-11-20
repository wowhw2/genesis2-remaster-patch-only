/* ============================================================================
 * **캐릭터 에디터 셈** — `G2캐릭터셈` (정본 356 · 2026-11-21 · [리마스터])
 *
 *   사장님 11-21 「다른 사용자가 에디터를 요청했어 … 캐릭터 수정부분만 추출해서 에디터를 만들어서 배포하려고해.
 *    뷰어에서 떼어낸다는건 아니고 뷰어를 참조해서 새로 만든다는 이야기야.」
 *   ⇒ 뷰어 `04_도구/뷰어/js/능력치셈.js` 의 세션 길(순수1차·순수MP·셈·레코드에쓰기·게임값고치기)을 옮겼다.
 *     ★ 셈 자체는 다시 쓰지 않는다 — 주인은 `rules.js derive`(원본 0x1796B) · 순수↔포함은 `extbase.js` 다.
 *
 *   이 파일은 **화면을 모른다.** 세션(`G2ExtSession.런타임열기` 가 낸 것)의 사람 객체를 고치기만 한다.
 *   화면·읽기·저장은 `char_editor.js` 가 맡는다.
 *
 *   ── 규칙 (뷰어와 같음 · 사장님 09-16 · 11-21 지시) ─────────────────────────
 *   · 장비는 무기·방패·장신구 세 칸만 능력치에 든다 · 보조1·보조2 는 안 든다 · 방패 방어력은 더하지 않는다
 *   · 장비를 바꿔도 순수 능력치는 그대로 — 레코드 포함값은 «순수 + 새 장비»로 다시 쓴다
 *   · 255 넘는 레벨·능력치·MP 는 곁파일(BASE·BIG·큰MP)로 간다 — 세션 닫기(`G2ExtSession.닫기`)가 쓴다
 *   · HP 는 레코드에 ×100 으로 담긴다 · TP 는 보기만(게임이 늘 다시 센다)
 * ==========================================================================*/
(function (root) {
'use strict';

/* 장비 칸 — 레코드 자리 · blackbox 객체 열쇠 · 장착 판정 칸(G2Equip 칸 번호 · 보조는 판정 없음) */
var 장비칸 = [
  { 이름: '무기',   열쇠: '무기',   자리: 0x5B, 판정칸: 0 },
  { 이름: '방패',   열쇠: '방패',   자리: 0x5A, 판정칸: 1 },
  { 이름: '장신구', 열쇠: '장신구', 자리: 0x5D, 판정칸: 2 },
  { 이름: '보조1',  열쇠: '보조',   자리: 0x5E, 판정칸: null },
  { 이름: '보조2',  열쇠: '예비',   자리: 0x5F, 판정칸: null }
];

/* 팀 번호 풀이 — 뷰어 `이름표.js 팀풀이` 와 같은 근거(CHAPDATA N.CHP Period +0xC9·정보[9] · BLACKBOX.DEF · 0x10A16) */
var 팀풀이 = [
  [1, '이올린 일행'], [2, 'G.스케빈져(GS) 일행'], [3, '카자 일행'], [4, '로빈 일행'], [5, '알시온 일행'],
  [6, '제국군(적)'], [7, '칼스 일행'], [8, '베라딘'], [9, '흑태자(G.스케빈져) 일행'], [10, '용병(미계약)'],
  [12, '라시드 일행'], [13, '아리아나 일행'], [14, '스트라이더 일행'], [15, '랜담 일행'], [17, '크로우 일행'],
  [99, '용병(재계약)']
];

/* 고칠 수 있는 상한 — 게임 저장 그릇과 같다(BIG u16 · 상한 해제 999 · 최대MP·HP 99,999 · 정본 181-b · 뷰어 게임값한도) */
var 한도 = { 레벨: [1, 999], 순수: [0, 999], 순수MP: [0, 99999], 최대HP: [1, 99999], 현재HP: [0, 99999], 현재MP: [0, 99999],
             경험치: [0, 99], 마법경험치: [0, 99], 필살경험치: [0, 99], 팀: [0, 255], 직업: [0, 255],
             초상화: [0, 255], 스프라이트: [0, 65535], 성별: [0, 2], 마법: [0, 2], 필살기등급: [0, 4] };   /* 성별 0 남·1 여·2 언데드 · 필살기 등급 0 최상~4 최하 · 마법 문장 0~2(사장님 11-21 · 직업표 마법최대클래스 최대 3 − 1 · rules.js levelUpMastery 0x17796) */
/* 필살기(검·창·도끼·활·권) 한도 — rules.js WEAPON_SKILL_CAP [7,4,4,4,6] (0x177D5~0x17831) · 사장님 11-21 「검은 7까지, 창 도끼 활은 4까지, 권은 6까지」 */
var 필살기한도 = [7, 4, 4, 4, 6];

/** 지금 게임 설정의 한도 — 레벨·순수 능력치는 게임 상한 함수(rules.js 레벨상한·능력상한 · 게임설정 «상한 해제»·«능력치 상한 해제»)를 따른다
 *   원작 = 레벨 99 · 능력치 255 / 상한 해제 = 999 (사장님 11-21 「최대 값 지정을 해놨어」) · HP·MP 는 저장 그릇 한도 99,999 */
/* 연 슬롯의 덧값 — 2회차 «레벨 상한 해제»(LVCP)는 그 판 세이브에 있다 (rules.js 상한해제켬 · 정본 284)
 *   ☠ Rules 는 «지금 돌고 있는 게임»의 덧값만 본다 — 레벨 999 슬롯인데 상한 99 로 나왔다 (사장님 11-21 「지금 내 1번 세이브의 경우 레벨이 999인데 상한은 99로 나와」) */
/*   ☠ 1번 세이브는 LVCP 가 없는데 레벨 999 인 사람이 여럿이다(11-21 읽어 봄) — 이미 상한을 넘은 사람이 있으면 그 슬롯은 999 까지 */
var 슬롯덧값 = null, 슬롯사람 = null;
function 슬롯덧값잡기(덧, 사람) { 슬롯덧값 = 덧 || null; 슬롯사람 = 사람 || null; }
function 슬롯최고(골라) { var m = 0; (슬롯사람 || []).forEach(function (c) { if (c && c.이름) { var v = 골라(c) | 0; if (v > m) m = v; } }); return m; }
function 슬롯레벨해제() {
  var 덧 = 슬롯덧값 || [];
  for (var i = 0; i < 덧.length; i++) if (덧[i] && 덧[i].열쇠 === 'LVCP' && 덧[i].값 && (덧[i].값[0] | 0)) return true;
  return false;
}
function 한도얻기() {
  var R = root.Rules, h = {};
  for (var k in 한도) if (Object.prototype.hasOwnProperty.call(한도, k)) h[k] = 한도[k].slice();
  try { if (R && R.레벨상한) h.레벨 = [1, R.레벨상한() | 0]; if (R && R.능력상한) h.순수 = [0, R.능력상한() | 0]; } catch (e) { }
  if (슬롯레벨해제() || 슬롯최고(function (c) { return (c.큰레벨 | 0) || (c['레벨'] | 0); }) > h.레벨[1]) h.레벨 = [1, 999];
  if (슬롯최고(function (c) { var 순 = 순수1차(c); return Math.max(순.str, 순.int, 순.agi, 순.cha); }) > h.순수[1]) h.순수 = [0, 999];
  return h;
}

function 표() { var G = root.G2; return (G && G.tables) || null; }
function 아이템표() { var T = 표(); return (T && T['아이템']) || null; }

/** 아이템 한 칸(부호 있는 8비트) — 코드 1-base · 0 은 없음 */
function 아이템칸(코드, 열쇠) {
  var T = 아이템표();
  if (!코드 || !T) return 0;
  var r = T[(코드 | 0) - 1];
  if (!r) return 0;
  var v = (r[열쇠] | 0) & 0xFF;
  return v > 127 ? v - 256 : v;
}

/** 순수 1차 능력치 — 곁파일(BASE·BIG)에서 온 `c.순수` 가 이기고, 없으면 «레코드 − 장비»(extbase.순수로) */
function 순수1차(c) {
  if (c && c.순수) return { str: c.순수.str | 0, int: c.순수.int | 0, agi: c.순수.agi | 0, cha: c.순수.cha | 0 };
  var B = root.G2ExtBase, T = 아이템표();
  if (B && B.순수로 && c && c._원본 && T) {
    try { var 순 = B.순수로(c._원본, T); if (순 && 순.agi != null) return 순; } catch (e) { /* 아래로 */ }
  }
  var eq = (c && c.장비) || {};
  function 합(k) { return 아이템칸(eq['무기'], k) + 아이템칸(eq['방패'], k) + 아이템칸(eq['장신구'], k); }
  return { str: (c['완력'] | 0) - 합('힘'), int: (c['지력'] | 0) - 합('지'), agi: (c['민첩'] | 0) - 합('민'), cha: (c['권위'] | 0) - 합('권') };
}

/** 장비 MP 합 — 무기·방패·장신구(extbase.장비MP합) */
function 장비MP(c) {
  var B = root.G2ExtBase, T = 아이템표();
  if (B && B.장비MP합 && c && c._원본 && T) return B.장비MP합(c._원본, T) | 0;
  var eq = (c && c.장비) || {};
  return 아이템칸(eq['무기'], 'MP') + 아이템칸(eq['방패'], 'MP') + 아이템칸(eq['장신구'], 'MP');
}

/** 순수 최대 MP — 고치는 중 값(__순수MP) › 큰MP(65535 넘음 · 곁파일 BIG = 순수 + 장비) − 장비 › 곁파일 BMP(세션의 `순수MP`) › «레코드 − 장비 MP»
 *   ☠ BMP 는 u16 이라 65535 에서 멈춘다 — 70000 을 넣고 다시 열면 65535 로 보였다(11-21 시험). 큰MP 가 있으면 그것이 참값이다 */
function 순수MP(c) {
  if (c && c.__순수MP != null) return c.__순수MP | 0;
  if (c && c.큰MP) return Math.max(0, (c.큰MP | 0) - 장비MP(c));
  if (c && c.순수MP != null) return c.순수MP | 0;
  return Math.max(0, (c['최대MP'] | 0) - 장비MP(c));
}

/** rules.derive 로 셈 — 뷰어 «셈» 과 같은 옵션(방패 방어 빼기 · MP·TP 장비 몫 넣기) */
function 셈(c) {
  var R = root.Rules, T = 표();
  if (!R || !R.derive || !T) throw new Error('rules.js · 표가 아직 안 실렸습니다');
  var eq = (c && c.장비) || {}, 순 = 순수1차(c);
  var u = { job: c['직업'] | 0, mount: eq['탈것'] | 0,
            base: { str: 순.str, int: 순.int, agi: 순.agi, cha: 순.cha, maxMp: 순수MP(c) },
            equip: { weapon: eq['무기'] | 0, shield: eq['방패'] | 0, accessory: eq['장신구'] | 0, sub1: eq['보조'] | 0, sub2: eq['예비'] | 0 },
            buff: {} };
  var v = R.derive(u, T, { shieldDefense: false, mpEquip: true, tpEquip: true });
  return { 공격력: v.atk, 방어력: v.def, 마법저항: v.mr, 최대TP: v.maxTp, 최대MP: v.maxMp,
           완력: v.str, 지력: v.int, 민첩: v.agi, 권위: v.cha, 무기종류: v.weaponType, 층: v.layers };
}

/** 셈한 파생 칸을 객체에 다시 넣는다 — 공·방·MR·최대TP · 순수가 있으면 포함값 넷과 최대MP · 현재 TP·MP 는 최대를 안 넘게 */
function 레코드에쓰기(c) {
  var 값 = 셈(c);
  c['공격력'] = 값.공격력 | 0; c['방어력'] = 값.방어력 | 0; c['마법저항'] = 값.마법저항 | 0; c['최대TP'] = 값.최대TP | 0;
  var B = root.G2ExtBase, T = 아이템표();
  if (c.순수 && B && B.포함으로 && c._원본 && T) {
    var 포 = B.포함으로(c.순수, c._원본, T);
    c['완력'] = 포.str | 0; c['지력'] = 포.int | 0; c['민첩'] = 포.agi | 0; c['권위'] = 포.cha | 0;
  }
  if (c.__순수MP != null) {   /* 최대MP = 순수 + 장비 MP · 65535 를 넘으면 큰MP(곁파일)에 — 장비를 바꿔도 큰MP 가 따라온다 */
    var 합MP = (c.__순수MP | 0) + 장비MP(c);
    c['최대MP'] = Math.min(65535, 합MP);
    if (합MP > 65535) c.큰MP = 합MP; else delete c.큰MP;
    c.순수MP = Math.min(65535, c.__순수MP | 0);
  } else if (c.순수MP != null) c['최대MP'] = Math.min(65535, (c.순수MP | 0) + 장비MP(c));
  if ((c['TP'] | 0) > (값.최대TP | 0)) c['TP'] = 값.최대TP | 0;
  if (!c.큰MP && (c['MP'] | 0) > (c['최대MP'] | 0)) c['MP'] = c['최대MP'] | 0;
  return 값;
}

/** 고치기 전 순수값을 붙잡는다 — 장비·직업을 바꿔도 순수는 그대로(게임 extroster 0x181A6 · 뷰어 확장잡기) */
function 순수잡기(c) { c.순수 = 순수1차(c); c.__순수MP = 순수MP(c); }

/** 화면에 보일 값 — 뷰어 «세션값» 과 같다 */
function 보기값(c) {
  var B = root.G2ExtBase, T = 아이템표();
  var 순 = 순수1차(c);
  var 장 = (B && B.장비1차합 && c._원본 && T) ? B.장비1차합(c._원본, T) : { str: 0, int: 0, agi: 0, cha: 0 };
  var 실 = {};
  ['str', 'int', 'agi', 'cha'].forEach(function (k) { 실[k] = Math.max(0, (순[k] | 0) + (장[k] | 0)); });
  var 순MP = 순수MP(c), 장MP = 장비MP(c), 최대MP = c.큰MP ? (c.큰MP | 0) : 순MP + 장MP;
  var 최대TP = c['최대TP'] | 0, 공 = c['공격력'] | 0, 방 = c['방어력'] | 0, 저 = c['마법저항'] | 0, 무기종류 = -1;
  try { var r = 셈(c); 최대TP = r.최대TP | 0; if ((r.무기종류 | 0) === 2) 공 = r.공격력 | 0; 무기종류 = r.무기종류 | 0; } catch (e) { }
  return {
    레벨: (c.큰레벨 | 0) || (c['레벨'] | 0), 순수: 순, 장비: 장, 실효: 실,
    순수MP: 순MP, 장비MP: 장MP, 최대MP: 최대MP,
    현재HP: Math.floor((c['현재HP'] >>> 0) / 100), 최대HP: Math.floor((c['최대HP'] >>> 0) / 100),
    현재MP: (c.큰MP && (c['MP'] | 0) >= 65535) ? (c.큰MP | 0) : (c['MP'] | 0),
    최대TP: 최대TP, 현재TP: c['TP'] | 0, 공격력: 공, 방어력: 방, 마법저항: 저, 무기종류: 무기종류,
    경험치: c['경험'] | 0, 마법경험치: c['마법경험'] | 0, 필살경험치: c['필살경험'] | 0,
    팀: c['팀'] | 0, 직업: c['직업'] | 0
  };
}

function 범위(종류, 값) {
  var 한들 = 한도얻기(), n = Math.floor(Number(값)), 한 = 한들[종류] || 한들.순수;
  if (!isFinite(n) || n < 한[0] || n > 한[1]) throw new Error('값은 ' + 한[0] + '~' + 한[1] + ' 만 됩니다 (' + 값 + ')');
  return n;
}

/**
 * 값 하나를 고친다 — 뷰어 «게임값고치기» + 직업·장비·팀
 * @param 종류 '레벨'|'str'|'int'|'agi'|'cha'|'순수MP'|'최대HP'|'현재HP'|'현재MP'|'경험치'|'마법경험치'|'필살경험치'|'팀'|'직업'|'장비:<열쇠>'
 */
function 고치기(c, 종류, 값) {
  if (!c) throw new Error('사람이 없습니다');
  순수잡기(c);
  if (/^장비:/.test(종류)) {
    var 열쇠 = 종류.slice(3), 칸 = 장비칸.filter(function (k) { return k.열쇠 === 열쇠; })[0];
    if (!칸) throw new Error('모르는 장비 칸 — ' + 열쇠);
    var 코드 = Math.max(0, Math.floor(Number(값)) || 0);
    c.장비 = c.장비 || {}; c.장비[열쇠] = 코드;
  } else if (종류 === '직업') {
    c['직업'] = 범위('직업', 값);
  } else if (종류 === '팀') {
    c['팀'] = 범위('팀', 값);
  } else if (종류 === '초상화') {          /* +0x10 PORTRAIT.SYF 프레임 */
    c['초상화'] = 범위('초상화', 값);
  } else if (종류 === '스프라이트') {      /* +0x61 u16 — 번호 → 파일 = COMBATII 0x75AA8 (tables 스프라이트이름표) */
    c['스프라이트번호'] = 범위('스프라이트', 값);
  } else if (종류 === '성별') {            /* +0x0D 종족 — 0 남 · 1 여 · 2 언데드 (jobchange.js O_종족) */
    c['종족'] = 범위('성별', 값);
  } else if (/^마법:\d$/.test(종류)) {     /* +0x2E ×7 — 화염·빙한·전격·회복·보조·소환·암흑 */
    var mi = +종류.slice(3); if (mi > 6) throw new Error('마법 계열은 0~6');
    c['마법레벨'] = (c['마법레벨'] || [0, 0, 0, 0, 0, 0, 0]).slice(); c['마법레벨'][mi] = 범위('마법', 값);
  } else if (종류 === '필살기등급') {      /* +0x35 — 0 이 최상 · 4 가 최하 (rules.js specialClassRoll) */
    c['필살기클래스등급'] = 범위('필살기등급', 값);
  } else if (/^필살기:\d$/.test(종류)) {   /* +0x38 ×5 — 검·창·도끼·활·권 */
    var pi = +종류.slice(4); if (pi > 4) throw new Error('필살기 계열은 0~4');
    var pn = Math.floor(Number(값));
    if (!isFinite(pn) || pn < 0 || pn > 필살기한도[pi]) throw new Error('값은 0~' + 필살기한도[pi] + ' 만 됩니다 (' + 값 + ')');
    c['필살기숙련'] = (c['필살기숙련'] || [0, 0, 0, 0, 0]).slice(); c['필살기숙련'][pi] = pn;
  } else {
    var n = 범위(종류, 값);
    if (종류 === '경험치' || 종류 === '마법경험치' || 종류 === '필살경험치') {
      c[{ 경험치: '경험', 마법경험치: '마법경험', 필살경험치: '필살경험' }[종류]] = n;
    } else if (종류 === '최대HP') {
      c['최대HP'] = n * 100;
      if ((c['현재HP'] >>> 0) > c['최대HP']) c['현재HP'] = c['최대HP'];
    } else if (종류 === '현재HP') {
      c['현재HP'] = Math.min(n * 100, c['최대HP'] >>> 0);
    } else if (종류 === '현재MP') {
      var 최대 = c.큰MP ? (c.큰MP | 0) : (c['최대MP'] | 0), v = Math.min(n, 최대);
      if (v > 65535 && v !== 최대) throw new Error('65535 를 넘는 현재 MP 는 최대 MP 와 같을 때만 담깁니다 (게임 저장 규칙)');
      c['MP'] = Math.min(65535, v);
    } else if (종류 === '레벨') {
      if (n > 255) { c.큰레벨 = n; c['레벨'] = 255; } else { delete c.큰레벨; c['레벨'] = n; }
    } else if (종류 === '순수MP') {
      c.__순수MP = n;   /* 큰MP·최대MP 는 아래 레코드에쓰기가 맞춘다 */
    } else if (['str', 'int', 'agi', 'cha'].indexOf(종류) >= 0) {
      var 새 = { str: c.순수.str, int: c.순수.int, agi: c.순수.agi, cha: c.순수.cha }; 새[종류] = n; c.순수 = 새;
    } else throw new Error('모르는 칸 — ' + 종류);
  }
  레코드에쓰기(c);
  return c;
}

function 팀글(n) {
  n = n | 0;
  for (var i = 0; i < 팀풀이.length; i++) if (팀풀이[i][0] === n) return n + ' — ' + 팀풀이[i][1];
  return n + ' — (장 파일·처음 명부에 없는 번호)';
}

var API = { 장비칸: 장비칸, 팀풀이: 팀풀이, 팀글: 팀글, 한도: 한도, 한도얻기: 한도얻기, 슬롯덧값잡기: 슬롯덧값잡기, 필살기한도: 필살기한도,
            순수1차: 순수1차, 순수MP: 순수MP, 장비MP: 장비MP, 셈: 셈, 레코드에쓰기: 레코드에쓰기, 보기값: 보기값, 고치기: 고치기 };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.G2캐릭터셈 = API;
})(typeof window !== 'undefined' ? window : globalThis);
