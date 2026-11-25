/* ============================================================
 *  ★ 정본 332 — 이 파일은 «본체»다: 앱 안 시동(main.js)이 켠다 · 받아 둔 패치의 «설치/모바일본체.js»(이 파일의 새 판)가 있으면 그것을 대신 켠다
 *    그래서 «여기»는 __dirname 이 아니라 시동이 알려 준 앱 폴더(G2M_HERE)다 — 패치 폴더에서 켜져도 게임·패치·일꾼·설치.html 은 앱 안 것을 본다
 *  창세기전 2 리마스터 — 모바일판 앱 안 Node 본체 (Capacitor-NodeJS · nodejs-mobile 18)  2026-11-19
 *
 *  사장님 11-19 「모바일판도 알아서 만들고 테스트해서 잘 작동하는거 확인해줘.」 · 계획서 03_분석/배포용_실행기_계획서.md §7
 *
 *  데스크톱판(02_실행기/앱/main.js · Electron)과 같은 일을 한다 — 다만 창구가 IPC 가 아니라 HTTP 다
 *    127.0.0.1:47861  설치 창구 — 설치 화면(설치.html) · 원본 파일 받기 · 설치 · 시작
 *    127.0.0.1:47862  게임 서버 — 데스크톱판과 «같은» 게임/server.js 를 이 프로세스 안에서 그대로 띄운다
 *  원본은 반드시 사용자가 넣는다(라인게임즈 2차 창작 기준 — 원본 없이 독립 실행 금지) — CD 이미지(cue+bin 또는 iso)·창1 ISO
 *    ① 설치 화면에서 파일 고르기(앱으로 올림) ② 앱 폴더(Android/data/kr.genesis2.remaster/files/원본)에 넣어 두기 — 둘 다 받는다
 * ============================================================ */
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
let 다리 = null; try { 다리 = require('bridge'); } catch (e) { }   /* 앱 밖(PC 시험)에서는 없다 */

const 여기 = process.env.G2M_HERE || __dirname;   /* 정본 332 — 시동(main.js)이 앱 폴더를 알려 준다 */
const 게임폴더 = path.join(여기, '게임');
const 패치폴더 = path.join(여기, '패치');
const 데이터 = process.env.G2M_DATA || (다리 && 다리.getDataPath ? 다리.getDataPath() : path.join(여기, '_데이터'));
/* 앱 바깥 저장소의 앱 폴더 — USB 로 원본을 넣어 둘 수 있는 곳(권한 없이 앱이 읽는다) */
const 바깥폴더후보 = [process.env.G2M_EXT, '/storage/emulated/0/Android/data/kr.genesis2.remaster/files/원본', '/sdcard/Android/data/kr.genesis2.remaster/files/원본'].filter(Boolean);
const 올린폴더 = path.join(데이터, '원본받음');
const 기록파일 = path.join(데이터, '설치기록.json');
const 설치포트 = +(process.env.G2M_PORT || 47861), 게임포트 = +(process.env.G2M_GAMEPORT || 47862);   /* 게임 포트는 데스크톱판과 같은 47862 — 설정(localStorage)이 포트마다 따로라 고정 */

/* 정본 313 — 패치 받기: 바뀐 게임 파일만 공개 저장소에서 받아 데이터 폴더 «패치덮어쓰기» 에 둔다 (게임/패치받기.js · 데스크톱 main.js 와 같은 모듈)
 *   (사장님 11-20 「혹시 매번 새로 받아서 설치하는 방식 말고 패치형태로는 어려워?」 → «만들기 — 깃허브 공개 저장소»)
 *   엔진판 = 이 폴더 package.json version (모바일/만들기.js 가 모바일 package.json 판으로 맞춰 넣는다) */
const 덮어쓰기 = path.join(데이터, '패치덮어쓰기');
let 패치모듈 = null; function 패치() { return 패치모듈 || (패치모듈 = require(path.join(게임폴더, '패치받기.js'))); }
function 엔진판() { try { return JSON.parse(fs.readFileSync(path.join(여기, 'package.json'), 'utf8')).version || ''; } catch (e) { return ''; } }
function 패치설정() { return { 주소: 패치().주소읽기([데이터, 여기]), 게임폴더, 패치폴더, 설치원래: { '설치/모바일.html': path.join(여기, '설치.html'), '설치/모바일본체.js': path.join(여기, '본체.js') }, 덮어쓰기, 엔진판: 엔진판() }; }   /* 정본 327 — 첫 화면도 패치로 */
let 패치진행 = null, 패치중 = false, 패치오류 = null, 패치끝 = null;

/* 정본 331 — 아이폰은 앱을 다시 깔거나 업데이트할 때(라이브 컨테이너 같은 앱 안의 앱에서는 더 자주) 앱 폴더 주소가 바뀐다
 *   → 설치기록.json 에 적힌 전체 경로(GENESIS2·파생·원본받음)가 없어져 «시작»에서 ENOENT 가 났다
 *   (사장님 11-20 [카페 댓글] 「설치하고 시작 누르니 에러납니다 라이브 컨테이너 폴더 경로를 앱이 찾지 못합니다. ENOENT: 경로」)
 *   ⇒ 읽을 때 적힌 경로가 없으면 지금 데이터 폴더 기준으로 다시 맞춘다 — 적어 둔 데이터 폴더(r.데이터)를 지금 것으로 바꾸거나,
 *     옛 기록(r.데이터 없음)은 GENESIS2·파생·원본받음 이름으로 찾는다 · 바깥 앱 폴더(안드로이드 USB)는 그대로 · 바뀌었으면 기록을 고쳐 쓴다 */
function 경로맞추기(p, 옛데이터) {
  if (!p || typeof p !== 'string' || fs.existsSync(p)) return p;
  const 쪼갬 = p.split(/[\\/]/);
  if (옛데이터 && p.startsWith(옛데이터)) { const 새 = path.join(데이터, p.slice(옛데이터.length)); if (fs.existsSync(새)) return 새; }
  for (const 이름 of ['GENESIS2', '파생', '원본받음']) {
    const i = 쪼갬.lastIndexOf(이름); if (i < 0) continue;
    const 새 = path.join(데이터, ...쪼갬.slice(i)); if (fs.existsSync(새)) return 새;
  }
  /* 정본 357 — 아이폰·아이패드 «파일» 앱의 원본 폴더(Documents/원본 · G2M_EXT)는 데이터 폴더 바깥이라 위에서 못 맞췄다
   *   앱을 새로 깔거나 올리면 컨테이너 번호가 바뀌어 CD폴더·CD 가 옛 경로로 남고 → 서버가 CD 를 못 찾아 배경음악이 꺼졌다
   *   (신고 버그신고_휴대폰_20261120_174110 아이패드 「애플기기 bgm이 나오질 않음」 · 시뮬레이터 재현: 다시 깐 뒤 /CD/11 → 404)
   *   ⇒ 같은 «Documents» 아래면 지금 Documents 기준으로 다시 붙인다 (데이터 = Documents/data 일 때만 · 안드로이드는 해당 없음) */
  const 문서 = path.dirname(데이터), k = 쪼갬.lastIndexOf('Documents');
  if (path.basename(문서) === 'Documents' && k >= 0) { const 새 = path.join(문서, ...쪼갬.slice(k + 1)); if (fs.existsSync(새)) return 새; }
  return p;
}
function 기록읽기() {
  let r; try { r = JSON.parse(fs.readFileSync(기록파일, 'utf8')); } catch (e) { return null; }
  if (!r || typeof r !== 'object') return r;
  let 바뀜 = false;
  for (const k of ['창2', 'CD폴더', 'CD', '창1', '파생']) { const 새 = 경로맞추기(r[k], r.데이터); if (새 !== r[k]) { r[k] = 새; 바뀜 = true; } }
  if (r.데이터 !== 데이터) { r.데이터 = 데이터; 바뀜 = true; }
  if (바뀜) try { fs.writeFileSync(기록파일, JSON.stringify(r, null, 1)); } catch (e) { }
  return r;
}
function 기록쓰기(r) { fs.mkdirSync(데이터, { recursive: true }); fs.writeFileSync(기록파일, JSON.stringify(Object.assign({}, r, { 데이터 }), null, 1)); }
function 창2폴더인가(d) {
  try { return ['COMBATII.EXE', 'CHARACTE', 'SCENARIO'].every(n => fs.readdirSync(d).some(f => f.toUpperCase() === n)); } catch (e) { return false; }
}
/* 정본 310 — 첫 화면 «다시 설치(원본 다시 고르기)»: 설치기록 · GENESIS2(CD 에서 푼 사본) · 파생(그림 자료) · 원본받음(앱으로 올린 원본 사본 — 잘못 올린 파일이 다시 잡히지 않게)만 지운다
 *   ★ 세이브·상태·설정.txt 는 그대로 · 바깥 앱 폴더(USB 로 넣은 원본)는 건드리지 않는다
 *   (사장님 11-20 「설치경로를 잘못 설정해서 다른 파일이 인식되었다는데, 재설치 하고싶은데 게임이 자동실행된대.」 → 「차라리 첫화면을 그대로 두고 이미 설치된 경우 다시 설치하거나 바로 시작을 선택할 수 있도록 하는게 어때?」)
 *   게임 서버를 띄우기 «전»에만 부른다 — 앱 안 Node 는 한 번만 뜨므로 앱 재시작이 필요 없는 길 · 시험 02_실행기/게임/install_reselect_310.test.js 가 이 함수 글을 떼어 돌린다 */
function 다시설치지우기(데이터폴더) {
  const 지운 = [];
  for (const n of ['설치기록.json', 'GENESIS2', '파생', '원본받음']) {
    const p = path.join(데이터폴더, n);
    try { if (fs.existsSync(p)) { fs.rmSync(p, { recursive: true, force: true }); 지운.push(n); } } catch (e) { }
  }
  return 지운;
}

/* 정본 410 — 창세기전 2 CD 이미지(bin·img)는 있는데 같은 폴더에 .cue 가 없나 — 게임 서버는 배경음악 트랙 자리를 cue 에서 읽는다(server.js CD 찾기)
 *   ☠ 안드로이드는 폴더를 못 보고 고른 파일만 받아, cue 를 안 고르면 설치는 되는데 배경음악만 안 났다(배경음진단_휴대폰_20261123_141008 · AYN Thor — 원본받음에 bin·ISO 만)
 *   윈도우는 고른 파일의 폴더를 통째로 보므로 옆의 cue 를 저절로 찾는다 · 폴더 = 설치기록 CD폴더(설치됨) 또는 찾은 창2 이미지의 폴더(설치 전)
 *   사장님 11-23 「cue가 인식되지 않는경우 해당 cue가 없다고 안내하고 연결할수있게 하면?」 */
/* 정본 427 — CD 이미지가 창2·창1 인지 «안을 열어» 가린다(파일 이름에 기대지 않는다)
 *   사장님 11-23 「현재 genesis2.bin이 아니면 (파일이름이 다르면) 이미지를 알아보지 못한다고 하네. 그렇게 하면 안될 것 같아. 파일 이름이 중요한게 아닌데.」
 *   ☠ 전에는 cue 가 없으면 이름에 GENESIS2·창세기전2 가 있어야 창2 로 봤다 — 안드로이드는 고른 파일만 받아 cue 없는 bin 이 흔하다(배경음진단 141008·141743)
 *   표지는 설치와 같다 — 창2 = CD 안 DOSINST.ARJ(설치엔진 창2설치) · 창1 = CD 안 DISK*.PAK 또는 하드디스크 이미지 안 CHRSYS.EXE(설치엔진 창1열기)
 *   첫 화면이 /state 를 자주 물으므로 파일(경로·크기·고친 때)마다 한 번만 연다 · 못 열면 null → 옛 이름 규칙으로 물러난다 */
const 종류기억 = new Map();
function 이미지종류(p) {
  let st; try { st = fs.statSync(p); } catch (e) { return null; }
  if (!st.isFile() || !/\.(cue|bin|iso|img)$/i.test(p)) return null;
  const 열쇠 = p + '|' + st.size + '|' + st.mtimeMs;
  if (종류기억.has(열쇠)) return 종류기억.get(열쇠);
  let 종류 = null, 엔진 = null;
  try { 엔진 = require(path.join(게임폴더, '설치엔진.js')); } catch (e) { return null; }
  try {
    const cd = 엔진.CD열기(p);
    try {
      const 목 = 엔진.CD목록(cd).map(e => String(e.경로).toUpperCase());
      if (목.includes('DOSINST.ARJ')) 종류 = '창2';
      else if (목.some(n => /^DISK[0-9A-Z]\.PAK$/.test(n))) 종류 = '창1';
    } finally { if (cd.닫기) cd.닫기(); }
  } catch (e) {
    if (!/\.cue$/i.test(p)) try {   /* CD 가 아니면 — 창1 을 설치해 둔 하드디스크 이미지인가 */
      const 하드 = 엔진.FAT열기 ? 엔진.FAT열기(p) : null;
      if (하드) try { if ([...하드.색.keys()].some(k => /(^|\/)CHRSYS\.EXE$/.test(k))) 종류 = '창1'; } finally { 하드.닫기(); }
    } catch (e2) { }
  }
  종류기억.set(열쇠, 종류);
  return 종류;
}
function cue살피기(r, 찾) {
  const 폴더 = (r && r.CD폴더) || (찾 && 찾.창2 ? path.dirname(찾.창2) : null);
  if (!폴더) return { 없음: false, 폴더: null };
  let 이름들 = []; try { 이름들 = fs.readdirSync(폴더); } catch (e) { return { 없음: false, 폴더 }; }
  const 이미지 = 이름들.some(n => { if (!/\.(bin|img)$/i.test(n)) return false; const k = 이미지종류(path.join(폴더, n)); return k ? k === '창2' : !/창1|GENESIS1|창세기전1/i.test(n.normalize('NFC')); });   /* 정본 427 — 안을 보고 · 못 열면 이름 */
  const 큐들 = 이름들.filter(n => /\.cue$/i.test(n));
  /* 정본 470 — cue 가 있어도 음악 트랙을 못 읽으면(꼴이 다르거나 이미지와 안 맞음) «없음»과 같게 연결 단추를 보인다 · 까닭으로 안내 글을 가른다 */
  const 씀 = 큐들.some(n => 큐쓸수있나(path.join(폴더, n)) > 0);
  return { 없음: 이미지 && !씀, 까닭: 이미지 && !씀 ? (큐들.length ? '못읽음' : '없음') : null, 큐: 큐들.map(n => n.normalize('NFC')), 폴더 };
}
/* ── 원본 파일 찾기 — 올린 것 + 바깥 앱 폴더 ── */
function 파일들(d) { try { return fs.readdirSync(d).map(n => path.join(d, n)).filter(p => fs.statSync(p).isFile()); } catch (e) { return []; } }
function 원본찾기() {
  const 실경로 = p => { try { return fs.realpathSync(p); } catch (e) { return p; } };   /* /sdcard 와 /storage/emulated/0 은 같은 곳 — 한 번만 */
  const 모두 = [...new Set([올린폴더, ...바깥폴더후보].flatMap(d => [...파일들(d), ...파일들(path.join(d, '창2')), ...파일들(path.join(d, '창1'))]).map(실경로))];
  /* 정본 331 — 애플 기기는 한글 이름을 자모로 풀어(NFD) 둘 수 있다 → «창세기전2» 글자 견주기가 빗나갔다 · 모아 쓴 꼴(NFC)로 맞춰 견준다 */
  const 밑 = p => path.basename(p).normalize('NFC');
  const 이름 = p => 밑(p).toUpperCase();
  /* 창2 — GENESIS2.CUE 우선 · 없으면 크기가 큰 .bin/.iso 중 창1 이 아닌 것 */
  const 이미지들 = 모두.filter(p => /\.(CUE|BIN|ISO|IMG)$/.test(이름(p))), 크기 = p => { try { return fs.statSync(p).size; } catch (e) { return 0; } };
  /* 정본 427 — 안을 열어 본 종류를 먼저 · cue 를 이미지보다 먼저(배경음 트랙 목차) · 못 가리면 아래 옛 이름 규칙 */
  const 창2 = 이미지들.filter(p => /\.CUE$/.test(이름(p))).find(p => 이미지종류(p) === '창2')
    || 이미지들.filter(p => !/\.CUE$/.test(이름(p))).sort((a, b) => 크기(b) - 크기(a)).find(p => 이미지종류(p) === '창2')
    || 모두.find(p => /\.CUE$/.test(이름(p)) && /GENESIS2|창세기전2|창세기전 2/i.test(밑(p)))
    || 모두.find(p => /\.CUE$/.test(이름(p)) && !/창1|GENESIS1|창세기전1/i.test(p.normalize('NFC')))
    || 모두.find(p => /\.(BIN|ISO|IMG)$/.test(이름(p)) && /GENESIS2|창세기전2/i.test(밑(p)));
  /* .img 도 받는다 — 창1 원본을 .img 로 가진 사람이 많다 (사장님 11-20 「그리고 창세기전1 img가 안된다는 이야기가 있네」 · 정본 302) */
  const 창1 = 이미지들.find(p => p !== 창2 && 이미지종류(p) === '창1')
    || 모두.find(p => /\.(ISO|CUE|IMG)$/.test(이름(p)) && /창세기전1|창세기전 1|GENESIS1|GENESIS\.|창1/i.test(밑(p)) && p !== 창2)
    || 모두.find(p => /\.(ISO|IMG)$/.test(이름(p)) && p !== 창2 && !/GENESIS2|창세기전2/i.test(밑(p)));
  return { 창2: 창2 || null, 창1: 창1 || null, 모두: 모두.map(p => ({ 이름: path.basename(p), 크기: fs.statSync(p).size })) };
}

/* ── 설치 — 일꾼 스레드에서(화면이 멈추지 않게 · 진행을 물어볼 수 있게) · 없으면 이 자리에서 ── */
let 진행 = { 단계: '', 지금: 0, 전체: 0, 이름: '' }, 설치중 = false, 설치오류 = null;
function 일시키기(일) {
  return new Promise((ok, no) => {
    let W = null; try { W = require('worker_threads').Worker; } catch (e) { }
    const 일꾼파일 = path.join(여기, '일꾼.js');
    if (!W) { try { ok(require(일꾼파일).하기(Object.assign({ 게임폴더, 패치폴더 }, 일), p => { 진행 = p; })); } catch (e) { no(e); } return; }
    const w = new W(일꾼파일, { workerData: Object.assign({ 게임폴더, 패치폴더 }, 일) });
    w.on('message', m => { if (m.진행) 진행 = m.진행; else if (m.끝) ok(m.끝); else if (m.실패) no(new Error(m.실패)); });
    w.on('error', no);
  });
}
/* 정본 331 — cue 의 FILE 이름과 올린 이미지 이름이 다르면(이미지 이름을 바꿨거나 다른 cue) 설치가 «ENOENT … 원본받음/gne2.img» 로 멈췄다
 *   (사장님 11-20 아이폰 제보 「원본받음/gne2.img래」) ⇒ 그 이름의 파일이 없으면 같은 폴더의 CD 이미지(.bin·.img·.iso) 중 창1 이 아닌 가장 큰 것으로
 *   «고친_<cue이름>» 을 같은 폴더에 써서 그것으로 설치한다 · 설치엔진.js 도 같은 대체를 하지만 그건 새 앱부터라 본체(패치로 감)에서도 막는다 */
function 큐맞추기(cue, 창1) {
  if (!cue || !/\.cue$/i.test(cue)) return cue;
  try {
    const 날 = fs.readFileSync(cue), 유 = 날.toString('utf8'), 글씨 = 유.indexOf(String.fromCharCode(0xFFFD)) < 0 ? 'utf8' : 'latin1';   /* 한글 이미지 이름이 깨지지 않게 — 설치엔진 큐글 과 같다 */
    const 폴더 = path.dirname(cue), 글 = 날.toString(글씨), m = /FILE\s+"([^"]+)"/i.exec(글);
    if (!m) return cue;
    const 이름들 = fs.readdirSync(폴더), 적힌 = path.basename(m[1]);
    if (이름들.some(n => n.normalize('NFC').toUpperCase() === 적힌.normalize('NFC').toUpperCase())) return cue;   /* 애플 NFD 이름도 */   /* 있다(대소문자만 달라도 설치엔진이 찾는다) */
    const 후보 = 이름들.filter(n => /\.(bin|img|iso)$/i.test(n) && path.join(폴더, n) !== 창1 && !/창1|창세기전1|창세기전 1|GENESIS1/i.test(n.normalize('NFC')))
      .map(n => { let 크기 = 0; try { 크기 = fs.statSync(path.join(폴더, n)).size; } catch (e) { } return { n, 크기 }; }).sort((a, b) => b.크기 - a.크기);
    if (!후보.length) {
      if (fs.existsSync(path.join(폴더, 적힌 + '.받는중'))) throw new Error('CD 이미지(' + 적힌 + ')가 아직 다 올라가지 않았습니다 — 그 파일을 다시 올려 주세요');   /* 올리기 도중 끊김 */
      return cue;
    }
    const 고친 = path.join(폴더, '고친_' + path.basename(cue).replace(/^고친_/, ''));
    fs.writeFileSync(고친, 글.replace(m[0], 'FILE "' + 후보[0].n + '"'), 글씨);
    console.log('[모바일] cue 의 FILE «' + 적힌 + '» 이 없어 «' + 후보[0].n + '» 로 고친 cue 로 설치: ' + 고친);
    return 고친;
  } catch (e) { if (/다 올라가지 않았습니다/.test(e.message)) throw e; return cue; }
}
async function 설치하기() {
  const 찾 = 원본찾기();
  if (찾.창2) 찾.창2 = 큐맞추기(찾.창2, 찾.창1);
  if (!찾.창2) throw new Error('창세기전 2 CD 이미지(.cue + .bin, 또는 .iso)를 찾지 못했습니다');
  if (!찾.창1) throw new Error('창세기전 1 원본(CD 이미지 .iso)을 찾지 못했습니다 — 창세기전 2 리마스터는 창세기전 1 원본이 꼭 있어야 합니다');
  const 대상 = path.join(데이터, 'GENESIS2'), 파생 = path.join(데이터, '파생');
  await 일시키기({ 일: '창2', cd: 찾.창2, 대상 });
  await 일시키기({ 일: '파생', 창2: 대상, 창1: 찾.창1, 파생 });
  const r = { 창2: 대상, CD폴더: path.dirname(찾.창2), CD: 찾.창2, 창1: 찾.창1, 파생, 만든때: new Date().toISOString() };   /* CD — 첫 화면 «설치된 원본» 줄 (정본 310) */
  기록쓰기(r); return r;
}

/* ── 게임 서버 — 데스크톱 main.js 게임열기 와 같은 설정으로 game/server.js 를 띄운다 ── */
let 게임켬 = false;
/* 정본 362 — 게임 서버(server.js · 패치로 못 바꾸는 엔진)는 이 프로세스 안에서 돈다 → 서버가 찍는 줄(켜질 때 «CD음악» · «404 CD트랙»)을 붙잡아
 *   /cdcheck 로 버그 신고에 실어 보낸다 (아이패드 배경음 404 — 같은 폴더 꼴을 PC 에서 띄우면 나오는데 기기에서만 안 나옴 · 신고 101607) */
const 서버기록 = [];
function 서버기록붙잡기() {
  if (서버기록붙잡기.됨) return; 서버기록붙잡기.됨 = true;
  for (const 갈래 of ['log', 'warn', 'error']) {
    const 원 = console[갈래].bind(console);
    console[갈래] = function () {
      try { 서버기록.push(new Date().toISOString().slice(11, 19) + ' ' + Array.prototype.map.call(arguments, a => typeof a === 'string' ? a : (a && a.message) || String(a)).join(' ').slice(0, 400)); if (서버기록.length > 300) 서버기록.splice(0, 서버기록.length - 300); } catch (e) { }
      return 원.apply(null, arguments);
    };
  }
}
/* ★ 정본 362·410 — 배경음 트랙(/CD/n)은 본체가 직접 내준다 (패치로 바뀌는 쪽에서)
 *   배경음진단_휴대폰_20261123_170350(아이폰 라이브 컨테이너 · R0.1.88): 원본받음에 Genesis2.img·고친_Genesis2.cue 가 있고 본체의 cue 풀이는 «있음 · 트랙 19 · 음악 18» 인데
 *   같은 순간 게임 서버는 켤 때 «CD 이미지 못 찾음» → /CD/2·/CD/11 404 (정본 362 아이패드 미니6 와 같은 꼴 · PC 에서 같은 폴더로는 서버가 찾았다)
 *   서버(server.js cdAudio)는 패치로 못 바꾸는 엔진이고 한 번 «없음»이면 앱을 다시 켤 때까지 그대로다(나중에 cue 를 연결해도)
 *   ⇒ 서버를 띄우기 전에 http.createServer 를 감싸 /CD/숫자 만 본체가 대답한다 · 못 찾으면 서버에 넘긴다(예전과 같음)
 *   서버 sendCdTrack·wavHeader 와 같은 꼴(44바이트 PCM WAV 머리 · Range) */
const CD_칸 = 2352, CD_빈도 = 44100;
let 본체CD기억 = null;
/* 정본 470 — cue 글 → 트랙표 { 번호: { type, start } } · 번호·INDEX 를 0 없이(«TRACK 1» · «INDEX 1») 써도 읽는다
 *   신고 버그신고_휴대폰_20261124_234450·20261125_030746(아이패드 · img·ccd·cue·sub · 「창2 원본이미지 cue인식 불가」·「애플기기 모바일에서 cue만 연결이 보이지 않음」):
 *   진단 cue 풀이 «트랙 19 · 음악 18» 인데 데이터 트랙 모드가 비어(설치엔진 «TRACK 01 MODE1/2352» 꼴이 아님) 본체·서버 모두 «CD 없음» → /CD 404 */
function 큐트랙(글) {
  const 트랙 = {}; let 지금 = null;
  for (const 줄 of String(글).split(/\r?\n/)) {
    let m = 줄.match(/TRACK\s+(\d+)\s+(\S+)/i); if (m) { 지금 = { no: +m[1], type: m[2].toUpperCase() }; continue; }
    m = 줄.match(/INDEX\s+0*1\s+(\d+):(\d+):(\d+)/i);
    if (m && 지금) { 트랙[지금.no] = { type: 지금.type, start: ((+m[1] * 60 + +m[2]) * 75 + +m[3]) * CD_칸 }; 지금 = null; }
  }
  return 트랙;
}
/* 정본 470 — 이 cue 로 배경음 트랙을 낼 수 있나: 이미지가 있고 음악 트랙 수 · cue없음 안내와 본체CD표가 같은 눈으로 본다 */
function 큐쓸수있나(cue) {
  let 큐읽기 = null; try { 큐읽기 = require(path.join(게임폴더, '설치엔진.js')).큐읽기; } catch (e) { }
  try {
    const c = 큐읽기 ? 큐읽기(cue) : null; if (!c || !c.bin || /\.iso$/i.test(c.bin) || !fs.existsSync(c.bin)) return 0;
    const 트 = 큐트랙(fs.readFileSync(cue, 'latin1')); return Object.keys(트).filter(k => 트[k].type === 'AUDIO').length;
  } catch (e) { return 0; }
}
function 본체CD표() {
  const r = 기록읽기();
  const 폴더들 = [];
  if (r && r.CD) { try { const st = fs.statSync(r.CD); 폴더들.push(st.isFile() ? path.dirname(r.CD) : r.CD); } catch (e) { } }
  if (r && r.CD폴더) 폴더들.push(r.CD폴더);
  폴더들.push(올린폴더);
  let 큐읽기 = null; try { 큐읽기 = require(path.join(게임폴더, '설치엔진.js')).큐읽기; } catch (e) { }
  for (const d of [...new Set(폴더들)]) {
    let 이름들 = []; try { 이름들 = fs.readdirSync(d); } catch (e) { continue; }
    const 큐들 = 이름들.filter(n => /\.cue$/i.test(n)).sort((a, b) => (/^고친_/.test(b) ? 1 : 0) - (/^고친_/.test(a) ? 1 : 0));
    for (const n of 큐들) {
      const cue = path.join(d, n);
      try {
        const c = 큐읽기 ? 큐읽기(cue) : null; if (!c || !c.bin || /\.iso$/i.test(c.bin)) continue;
        const 크기 = fs.statSync(c.bin).size, 열쇠 = cue + '|' + fs.statSync(cue).mtimeMs + '|' + c.bin + '|' + 크기;
        if (본체CD기억 && 본체CD기억.열쇠 === 열쇠) return 본체CD기억;
        const 트랙 = 큐트랙(fs.readFileSync(cue, 'latin1'));   /* 정본 470 */
        const 번호 = Object.keys(트랙).map(Number).sort((a, b) => a - b); if (!번호.length) continue;
        번호.forEach((k, i) => { 트랙[k].end = (i + 1 < 번호.length) ? 트랙[번호[i + 1]].start : 크기; });
        본체CD기억 = { 열쇠, bin: c.bin, 트랙 };
        console.log('[본체] 배경음 트랙 — ' + path.basename(c.bin) + ' · 음악 ' + 번호.filter(k => 트랙[k].type === 'AUDIO').length + '개 (' + n + ')');
        return 본체CD기억;
      } catch (e) { continue; }
    }
  }
  return null;
}
function 본체CD내주기(req, res) {
  let 주소 = String(req.url || '').split('?')[0]; try { 주소 = decodeURIComponent(주소); } catch (e) { }
  const m = /^\/CD\/(\d+)$/.exec(주소); if (!m) return false;
  let cd = null; try { cd = 본체CD표(); } catch (e) { cd = null; }
  const t = cd && cd.트랙[+m[1]];
  if (!t || t.type !== 'AUDIO') return false;              /* 못 찾으면 서버에 넘긴다 */
  const 전체 = t.end - t.start, 끝까지 = 44 + 전체;
  let s = 0, e = 끝까지 - 1;
  const rg = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (rg) { if (rg[1]) s = Math.min(+rg[1], 끝까지 - 1); if (rg[2]) e = Math.min(+rg[2], 끝까지 - 1); }
  const 머리 = Buffer.alloc(44);
  머리.write('RIFF', 0); 머리.writeUInt32LE(36 + 전체, 4); 머리.write('WAVE', 8); 머리.write('fmt ', 12); 머리.writeUInt32LE(16, 16);
  머리.writeUInt16LE(1, 20); 머리.writeUInt16LE(2, 22); 머리.writeUInt32LE(CD_빈도, 24); 머리.writeUInt32LE(CD_빈도 * 4, 28);
  머리.writeUInt16LE(4, 32); 머리.writeUInt16LE(16, 34); 머리.write('data', 36); 머리.writeUInt32LE(전체, 40);
  const 답머리 = { 'Content-Type': 'audio/wav', 'Content-Length': String(e - s + 1), 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (rg) 답머리['Content-Range'] = 'bytes ' + s + '-' + e + '/' + 끝까지;
  res.writeHead(rg ? 206 : 200, 답머리);
  if (s < 44) res.write(머리.subarray(s, Math.min(44, e + 1)));
  const 부터 = Math.max(0, s - 44), 까지 = Math.max(-1, e - 44);
  if (까지 < 부터) { res.end(); return true; }
  const rs = fs.createReadStream(cd.bin, { start: t.start + 부터, end: t.start + 까지 });
  rs.on('error', () => { try { res.end(); } catch (x) { } });
  rs.pipe(res);
  return true;
}
function 게임띄우기(r) {
  /* GAME.CFG — 원본 CD 에 없고 원본 설치 프로그램이 만든다 → 없으면 출하 기본값 10B (앱 main.js 와 같음) */
  try { if (!fs.readdirSync(r.창2).some(f => f.toUpperCase() === 'GAME.CFG'))
    fs.writeFileSync(path.join(r.창2, 'GAME.CFG'), Buffer.from([0x00, 0x00, 0x01, 0x02, 0x20, 0x02, 0x07, 0x00, 0x01, 0x00])); } catch (e) { }
  if (게임켬) return;
  const 설정 = path.join(데이터, '설정.txt');
  fs.writeFileSync(설정, ['# 앱이 쓴다 — 설치기록.json 에서', '원본경로=' + r.창2, 'CD경로=' + (r.CD폴더 || ''), '세이브경로=' + path.join(데이터, '세이브'),
    '파생자료경로=' + r.파생, ''].join('\n'));
  try { 패치().준비(패치설정()); } catch (e) { }   /* 정본 313 — 바꾸다 꺼진 패치 마무리 · 앱이 받아 둔 패치보다 새 판이면 옛 덮어쓰기 치움 */
  Object.assign(process.env, { PORT: String(게임포트), G2_CONFIG: 설정, G2_PATCH_DIR: 패치폴더, G2_DERIVED_DIR: r.파생,
    'G2_세이브경로': path.join(데이터, '세이브'), 'G2_상태경로': path.join(데이터, '상태'), 'G2_덮어쓰기경로': 덮어쓰기 });
  fs.mkdirSync(path.join(데이터, '세이브'), { recursive: true });
  fs.mkdirSync(path.join(데이터, '상태', 'CHAPDATA'), { recursive: true });
  서버기록붙잡기();
  /* 정본 362·410 — 게임 서버가 만드는 http 서버에서 /CD/숫자 만 본체가 먼저 받는다 (위 본체CD내주기) */
  const 원만들기 = http.createServer;
  http.createServer = function (a, b) {
    const 처리 = typeof a === 'function' ? a : b;
    const 감싼 = function (req, res) { try { if (본체CD내주기(req, res)) return; } catch (e) { } return 처리.apply(this, arguments); };
    return typeof a === 'function' ? 원만들기.call(http, 감싼) : 원만들기.call(http, a, 감싼);
  };
  try { require(path.join(게임폴더, 'server.js')); } finally { http.createServer = 원만들기; }
  게임켬 = true;
}
const 게임주소 = () => 'http://127.0.0.1:' + 게임포트 + '/' + encodeURIComponent('게임') + '/' + encodeURIComponent('게임') + '.html?devtools=0&' + encodeURIComponent('모바일') + '=1';

/* ★★★★★ **튕김 기록 — 휴대폰** (정본 371 · 2026-11-22 · 사장님 「모바일도 해야지」)
 *   ☠ «끔» 기록 여부로 튕김을 가르지 않는다 — 앱 목록에서 밀어 닫기·모두 닫기는 운영체제가 앱을 그 자리에서 죽여 «끔»을 남길 틈이 없다
 *     (사장님 11-22 「모바일에서 그냥 앱목록에서 슬라이드해서 닫거나 전체 종료하거나」·「그런것들과 비정상 종료된것과 구분을 하는게 문제인데」)
 *   ⇒ 운영체제가 알려 주는 «지난 종료 까닭»으로 가른다:
 *      안드로이드 — MainActivity 가 ApplicationExitInfo(안드 11+)를 앱 폴더 «종료까닭.txt» 에 적는다(만들기.js · 새 앱)
 *      아이폰 — G2Crash(MetricKit) 가 문서 폴더 «종료까닭.txt» 에 충돌·멈춤·메모리 한도 꺼짐 횟수를 적는다(아이폰_시작.swift · 새 앱)
 *   + 이 본체(게임 서버도 같은 프로세스)의 처리 못 한 오류 · 게임 화면 오류(/crashlog POST · 기록만, 보내지 않음)
 *   다시 켤 때 «튕김»·«본체 오류»가 새로 있으면 버그 신고 받는 곳(구글 드라이브)으로 기록 글만 보낸다 · 첫 화면 /state «튕김알림» */
const 튕김파일 = path.join(데이터, '튕김기록.txt'), 튕김보냄파일 = path.join(데이터, '튕김기록_보냄.json'), 까닭읽음파일 = path.join(데이터, '종료까닭_읽음.json');
const 휴대폰신고주소 = 'https://script.google.com/macros/s/AKfycbyWAiC12QPSOFv7RvUnGeJSHEbyY1YHKQQeD7mR_6XUlIhv3WrGmR-zCyBgBLtvotZU/exec';   /* 게임 js/bug_report.js 와 같은 주소 */
function 튕김적기(종류, 글) {
  try {
    fs.mkdirSync(데이터, { recursive: true });
    fs.appendFileSync(튕김파일, new Date().toISOString() + ' [' + 종류 + '] ' + String(글 == null ? '' : 글).slice(0, 4000).replace(/\r?\n/g, ' ⏎ ') + '\n');
    if (fs.statSync(튕김파일).size > 400000) { const b = fs.readFileSync(튕김파일); fs.writeFileSync(튕김파일, b.subarray(b.length - 200000)); try { fs.unlinkSync(튕김보냄파일); } catch (e) { } }
  } catch (e) { }
}
process.on('uncaughtException', e => 튕김적기('본체 오류', (e && e.stack) || e));
process.on('unhandledRejection', e => 튕김적기('본체 약속 오류', (e && e.stack) || e));
/* 안드로이드 ApplicationExitInfo 까닭 번호 → 갈래 (developer.android.com · REASON_*) */
const 안드까닭 = { 1: ['끔', '앱이 스스로 끝냄'], 2: ['기록 없이 꺼짐', '신호로 끝남(SIGNALED)'], 3: ['튕김', '메모리 부족(LOW_MEMORY)'], 4: ['튕김', '충돌(CRASH)'], 5: ['튕김', '네이티브 충돌(CRASH_NATIVE)'],
  6: ['튕김', '응답 없음(ANR)'], 7: ['튕김', '시작 실패(INITIALIZATION_FAILURE)'], 8: ['끔', '권한 바뀜'], 9: ['튕김', '자원 과다 사용(EXCESSIVE_RESOURCE_USAGE)'],
  10: ['끔', '사용자가 닫음(USER_REQUESTED)'], 11: ['끔', '사용자가 멈춤(USER_STOPPED)'], 12: ['기록 없이 꺼짐', '의존 프로세스 끝남'], 13: ['기록 없이 꺼짐', '그 밖(OTHER)'],
  14: ['기록 없이 꺼짐', '얼림(FREEZER)'], 15: ['끔', '패키지 상태 바뀜'], 16: ['끔', '앱 업데이트'] };
/* 정본 400 — 지난 실행의 «마지막 상태»(게임 화면이 30초마다 /laststate 로 보낸 화면·맵·3D·메모리 등) — 이번에 튕김이 새로 적히면 그 뒤에 한 줄 붙인다
 *   ☠ 메모리 부족(LOW_MEMORY) 튕김은 앱이 꺼지기 전에 아무것도 못 남겨 무엇을 하다 꺼졌는지 몰랐다(11-23 튕김기록_휴대폰_20261123_080341)
 *   사장님 11-23 「혹시 더 수집 필요한 항목이 필요하다면 동의 공지에 추가하면 돼」 — 이용 안내 «끊김 전후의 게임 진행 기록과 메모리 사용량» 안 */
const 마지막상태파일 = path.join(데이터, '마지막상태.json');
let 지난상태 = ''; try { 지난상태 = fs.readFileSync(마지막상태파일, 'utf8').slice(0, 2000); fs.unlinkSync(마지막상태파일); } catch (e) { }
let 이번튕김수 = 0;
(function 종료까닭읽기() {
  const 후보 = [path.join(path.dirname(데이터), '종료까닭.txt'),                                            /* 아이폰 — 문서 폴더(데이터 = 문서/data) */
    ...바깥폴더후보.map(d => path.join(path.dirname(d), '종료까닭.txt'))];                                     /* 안드로이드 — 앱 폴더(files) */
  let 읽음 = {}; try { 읽음 = JSON.parse(fs.readFileSync(까닭읽음파일, 'utf8')) || {}; } catch (e) { }
  /* 정본 371 — 안드로이드는 같은 앱 폴더를 가리키는 경로가 여럿이라(/storage/emulated/0 · /sdcard …) 같은 파일을 두 번 읽어 기록이 두 벌 적혔다
   *   (튕김기록_휴대폰_20261122_135849) → 실제 경로로 한 번만 · 한 번 켤 때 같은 줄은 한 번만 */
  const 본파일 = new Set(), 본줄 = new Set();
  for (const f0 of 후보) {
    let f = f0; try { f = fs.realpathSync(f0); } catch (e) { continue; }
    if (본파일.has(f)) continue; 본파일.add(f);
    let 글 = ''; try { 글 = fs.readFileSync(f, 'utf8'); } catch (e) { continue; }
    const 자리 = Math.max(읽음[f] | 0, 읽음[f0] | 0), 새 = 글.slice(자리 > 글.length ? 0 : 자리);   /* 옛 열쇠(실경로 전)의 자리도 본다 — 이미 보낸 기록을 다시 보내지 않게 */
    for (const 줄 of 새.split('\n')) {
      if (!줄.trim() || 본줄.has(줄)) continue;
      본줄.add(줄);
      const k = 줄.split('\t');
      if (k[0] === 'IOS') { if (k[1] !== '끔') 이번튕김수++; 튕김적기(k[1] === '끔' ? '끔' : '튕김', '아이폰 ' + k.slice(2).join(' · ')); continue; }   /* IOS \t 갈래 \t 내용 … */
      const 때 = new Date(+k[0] || 0).toISOString(); let 까 = 안드까닭[+k[1]] || ['기록 없이 꺼짐', '까닭 ' + k[1]];
      /* 정본 371 — 메모리 부족(3)이라도 그때 앱이 화면 앞이 아니었으면(중요도 > 125 · 100 = 화면 앞 · 200 = 보임 · 400 = 뒤) 휴대폰이 뒤에 있는 앱을 정리한 것 — 튕김이 아니다
       *   (튕김기록_휴대폰_20261122_135849 — LOW_MEMORY · PSS 28MB) · 중요도 칸(k[6])이 없는 옛 앱 기록은 그대로 */
      const 중 = k[6] != null && k[6] !== '' ? +k[6] : NaN;
      if (+k[1] === 3 && 중 > 125) 까 = ['기록 없이 꺼짐', '메모리 부족 — 뒤에 있을 때 휴대폰이 정리(중요도 ' + 중 + ')'];
      if (까[0] === '튕김') 이번튕김수++;
      튕김적기(까[0], '안드로이드 지난 종료 ' + 때 + ' · ' + 까[1] + ' · 상태 ' + k[2] + ' · 메모리 PSS ' + Math.round((+k[3] || 0) / 1024) + 'MB · RSS ' + Math.round((+k[4] || 0) / 1024) + 'MB' + (k[5] && k[5] !== 'null' ? ' · ' + k[5] : '') + (isNaN(중) ? '' : ' · 중요도 ' + 중));
    }
    읽음[f] = 글.length;
  }
  try { fs.mkdirSync(데이터, { recursive: true }); fs.writeFileSync(까닭읽음파일, JSON.stringify(읽음)); } catch (e) { }
})();
/* 정본 400 — 이번에 튕김이 새로 적혔으면 지난 실행의 마지막 상태를 붙인다(상태 «때»와 종료 시각을 견주면 그 튕김의 상태인지 안다) */
if (이번튕김수 && 지난상태) 튕김적기('마지막 상태', 지난상태);
튕김적기('켬', '본체 ' + (process.env.G2M_본체 || '?') + ' · ' + process.platform + ' ' + process.arch + ' · node ' + process.version);
/* zip(저장 방식) — 데스크톱 main.js 와 같은 꼴 */
function zip묶기(목록) {
  const 표 = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; 표[n] = c >>> 0; }
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = 표[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const 앞 = [], 중앙 = []; let 자리 = 0;
  for (const f of 목록) {
    const 이름 = Buffer.from(f.이름, 'utf8'), d = f.바이트, c = crc(d);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt32LE(c, 14); h.writeUInt32LE(d.length, 18); h.writeUInt32LE(d.length, 22); h.writeUInt16LE(이름.length, 26);
    앞.push(h, 이름, d);
    const z = Buffer.alloc(46); z.writeUInt32LE(0x02014b50, 0); z.writeUInt16LE(20, 4); z.writeUInt16LE(20, 6); z.writeUInt16LE(0x0800, 8); z.writeUInt32LE(c, 16); z.writeUInt32LE(d.length, 20); z.writeUInt32LE(d.length, 24); z.writeUInt16LE(이름.length, 28); z.writeUInt32LE(자리, 42);
    중앙.push(z, 이름); 자리 += 30 + 이름.length + d.length;
  }
  const 중앙b = Buffer.concat(중앙), 끝 = Buffer.alloc(22);
  끝.writeUInt32LE(0x06054b50, 0); 끝.writeUInt16LE(목록.length, 8); 끝.writeUInt16LE(목록.length, 10); 끝.writeUInt32LE(중앙b.length, 12); 끝.writeUInt32LE(자리, 16);
  return Buffer.concat([...앞, 중앙b, 끝]);
}
let 튕김알림 = '';
/* 정본 474 — 글 한 덩이를 POST 하고 답 번호만 (넘기는 답 302 는 따라가지 않는다 — 아래 «보냈음» 규칙)
 *   ☠ 전에는 fetch 를 썼는데 아이폰·아이패드 node(v18 · JIT 없음)는 fetch 속 undici 가 WebAssembly 를 못 써
 *     «[본체 약속 오류] ReferenceError: WebAssembly is not defined (lazyllhttp)» 로 실패 → 아이폰 튕김 기록이 한 번도 안 갔다
 *     (신고 버그신고_휴대폰_20261125_030746 튕김기록 · 켤 때마다 같은 줄 — 그 줄이 다시 «보낼 기록»이 되어 되풀이)
 *   ⇒ node 기본 https 로 (안드로이드·PC 시험도 같은 길) */
function 글보내기(주소, 몸, 시간) {
  return new Promise((되, 안) => {
    let u; try { u = new URL(주소); } catch (e) { return 안(e); }
    const 몸바이트 = Buffer.from(몸, 'utf8');
    const 모듈 = u.protocol === 'http:' ? http : require('https');
    const 요청 = 모듈.request(u, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Content-Length': 몸바이트.length } }, (답) => {
      답.resume(); 답.on('end', () => 되(답.statusCode | 0)); 답.on('error', () => 되(답.statusCode | 0));
    });
    요청.setTimeout(시간 || 30000, () => { 요청.destroy(new Error('시간 넘음')); });
    요청.on('error', 안);
    요청.end(몸바이트);
  });
}
async function 튕김보내기() {
  let 글 = ''; try { 글 = fs.readFileSync(튕김파일, 'utf8'); } catch (e) { return; }
  let 보낸 = 0; try { 보낸 = JSON.parse(fs.readFileSync(튕김보냄파일, 'utf8')).자리 | 0; } catch (e) { }
  const 새 = 글.slice(보낸 > 글.length ? 0 : 보낸);
  if (!새.split('\n').some(l => /\[(튕김|본체 오류|본체 약속 오류)\]/.test(l))) return;   /* 끔·기록 없이 꺼짐·화면 오류만으로는 보내지 않는다 */
  const 때 = new Date(), 붙 = n => String(n).padStart(2, '0');
  const 이름 = '튕김기록_휴대폰_' + 때.getFullYear() + 붙(때.getMonth() + 1) + 붙(때.getDate()) + '_' + 붙(때.getHours()) + 붙(때.getMinutes()) + 붙(때.getSeconds()) + '.zip';
  const 설명 = '[튕김 기록 자동] 휴대폰 ' + process.platform + ' · 본체 ' + (process.env.G2M_본체 || '?');
  const zip = zip묶기([{ 이름: '튕김기록.txt', 바이트: Buffer.from(새, 'utf8') }, { 이름: '설명.txt', 바이트: Buffer.from(설명, 'utf8') }]);
  /* «보냈음»을 먼저 적는다 — 보내는 도중 앱을 닫으면 답을 못 받아 다음에 같은 기록을 또 보냈다(11-22 PC 시험 · 드라이브에 둘) · 실패하면 되돌린다 */
  let 옛표시 = null; try { 옛표시 = fs.readFileSync(튕김보냄파일, 'utf8'); } catch (e) { }
  const 되돌리기 = () => { try { if (옛표시 == null) fs.unlinkSync(튕김보냄파일); else fs.writeFileSync(튕김보냄파일, 옛표시); } catch (e) { } };
  try { fs.writeFileSync(튕김보냄파일, JSON.stringify({ 자리: 글.length, 때: 때.toISOString() })); } catch (e) { }
  try {
    /* 구글 Apps Script 는 받은 뒤 302 로 결과 주소에 넘긴다 — Node 가 그것을 따라가다 실패로 보면 «보냈음»을 못 적어 다음에 또 보냈다(11-22 PC 시험)
     *   ⇒ 넘기는 답을 따라가지 않고 2xx·3xx 면 받은 것으로 본다 */
    const 상태 = await 글보내기(휴대폰신고주소, JSON.stringify({ 이름, 설명, zip: zip.toString('base64') }));
    if (상태 >= 200 && 상태 < 400) 튕김알림 = '지난번 튕김 기록을 개발자에게 보냈습니다(오류 기록 글만 · 세이브·화면은 보내지 않습니다).';
    else 되돌리기();
  } catch (e) { 되돌리기(); }
}
setTimeout(() => { 튕김보내기().catch(() => { }); }, 3000);

/* ── 설치 창구 서버 ── */
function 보냄(res, code, 종류, 몸) { res.writeHead(code, { 'Content-Type': 종류, 'Cache-Control': 'no-store' }); res.end(몸); }
const 제이슨 = (res, o, code) => 보냄(res, code || 200, 'application/json; charset=utf-8', JSON.stringify(o));
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1'), p = u.pathname;   /* 창구 주소는 영문만 — 한글이 깨져 들어와도 죽지 않게 */
  try {
    if (p === '/') {
      /* 정본 310 — 설치돼 있어도 곧바로 게임으로 가지 않고 설치.html 이 «바로 시작» / «다시 설치» 를 보여 준다
       *   (사장님 11-20 「차라리 첫화면을 그대로 두고 이미 설치된 경우 다시 설치하거나 바로 시작을 선택할 수 있도록 하는게 어때?」)
       *   · 게임 서버가 이미 떠 있으면(웹뷰가 이 주소를 다시 읽음) 그대로 게임으로 — 떠 있는 동안 «다시 설치»는 막는다 */
      const r = 기록읽기();
      if (게임켬 && r) { res.writeHead(302, { Location: 게임주소() }); return res.end(); }
      /* 정본 327 — 받아 둔 패치에 «설치/모바일.html» 이 있으면 그것 (첫 화면도 «패치 받기»로 · 이 화면은 바깥 파일을 안 부른다) · 못 읽으면 앱 안 것 */
      let 첫화면 = null; try { 첫화면 = fs.readFileSync(path.join(덮어쓰기, '설치', '모바일.html')); } catch (e) { 첫화면 = null; }
      return 보냄(res, 200, 'text/html; charset=utf-8', 첫화면 || fs.readFileSync(path.join(여기, '설치.html')));
    }
    /* 정본 343 — 게임 «종료»: 앱 안 Node 는 앱과 같은 프로세스라 여기서 끝내면 앱이 통째로 꺼진다(아이폰 · 라이브 컨테이너 안에서도)
     *   아이폰 본체에 종료 창구(g2exit)가 안 달린 경우를 위해 터치.js 가 이 주소로 온다 (신고 130617 «0.1.25 … 종료허기 누르면 멈추고 앱이 안꺼집니다» · 종료창구 false) */
    if (p === '/exit') { 보냄(res, 200, 'text/html; charset=utf-8', '<body style="background:#000"></body>'); setTimeout(() => process.exit(0), 150); return; }
    /* 정본 362 — CD 점검(버그 신고가 읽는다 · 게임 화면은 다른 포트라 허용 머리) — CD폴더·원본 폴더의 파일 이름·크기와 cue 안 FILE·트랙 수
     *   사장님은 신고자에게 되물을 수 없다(11-21) → 배경음이 안 날 때 «무엇이 들어 있나»를 신고 한 번으로 본다 */
    /* 정본 371 — 튕김 기록 창구: GET = 기록 글(버그 신고가 담는다) · POST = 게임 화면 오류 한 줄(기록만 · 보내지 않음) · 게임 화면은 다른 포트라 허용 머리 */
    /* 정본 400 — 마지막 상태(게임 화면이 30초마다 · 뒤로 넘어갈 때) — 파일 하나에 덮어쓴다 · 다음에 켤 때 튕김이 있으면 붙인다(위 지난상태) */
    if (p === '/laststate' && req.method === 'POST') {
      let 몸 = ''; req.on('data', d => { if (몸.length < 4000) 몸 += d; });
      req.on('end', () => { try { fs.mkdirSync(데이터, { recursive: true }); fs.writeFileSync(마지막상태파일, 몸.slice(0, 2000)); } catch (e) { }
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' }); res.end('ok'); });
      return;
    }
    if (p === '/crashlog') {
      const 머리 = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' };
      if (req.method === 'POST') {
        let 몸 = ''; req.on('data', d => { if (몸.length < 8000) 몸 += d; });
        req.on('end', () => { 튕김적기('화면 오류', 몸.slice(0, 4000)); res.writeHead(200, 머리); res.end('ok'); });
        return;
      }
      let 글 = ''; try { 글 = fs.readFileSync(튕김파일, 'utf8'); } catch (e) { }
      res.writeHead(200, 머리); return res.end(글.slice(-60000));
    }
    if (p === '/cdcheck') {
      const r = 기록읽기() || {}, 본 = {};
      const 폴더들 = [r.CD폴더, ...바깥폴더후보, 올린폴더].filter((d, i, a) => d && a.indexOf(d) === i);
      for (const d of 폴더들) {
        const o = { 있음: false };
        try {
          const 이름들 = fs.readdirSync(d); o.있음 = true;
          o.파일 = 이름들.slice(0, 40).map(n => { let 크기 = -1, 폴더 = false; try { const st = fs.statSync(path.join(d, n)); 크기 = st.size; 폴더 = st.isDirectory(); } catch (e) { } return n.normalize('NFC') + (폴더 ? '/' : ' ' + 크기); });
          o.큐 = 이름들.filter(n => /\.cue$/i.test(n)).map(n => { try { const t = fs.readFileSync(path.join(d, n), 'latin1'); const m = /FILE\s+"([^"]+)"/i.exec(t); return n.normalize('NFC') + ' → FILE ' + (m ? Buffer.from(m[1], 'latin1').toString('utf8') : '없음') + ' · 트랙 ' + (t.match(/TRACK\s+\d+/gi) || []).length + ' · 음악 ' + (t.match(/TRACK\s+\d+\s+AUDIO/gi) || []).length + ' · 본체가 읽은 음악 ' + 큐쓸수있나(path.join(d, n)) + (t.length <= 4000 ? ' · 글 ' + JSON.stringify(t) : ''); }   /* 정본 470 — 다음 신고에서 cue 꼴을 바로 본다(작은 글 · 개인 정보 없음) */ catch (e) { return n + ' 못 읽음'; } });
        } catch (e) { o.오류 = e.code || e.message; }
        본[d] = o;
      }
      /* 서버가 CD 음악을 찾는 차례(server.js cdAudio)를 그대로 — 설정.txt 의 CD경로 → cue 를 설치엔진.큐읽기로 풀어 이미지가 있나 · 서버 콘솔 줄 */
      let 설정글 = null; try { 설정글 = fs.readFileSync(path.join(데이터, '설정.txt'), 'utf8'); } catch (e) { 설정글 = '못 읽음 ' + (e.code || e.message); }
      const 큐풀이 = {};
      try {
        const 큐읽기 = require(path.join(게임폴더, '설치엔진.js')).큐읽기, m = /^CD경로=(.*)$/m.exec(설정글 || '');
        let d = m && m[1].trim(); if (d && fs.existsSync(d) && fs.statSync(d).isFile()) d = path.dirname(d);
        큐풀이.CD경로 = d || null; 큐풀이.있음 = !!(d && fs.existsSync(d));
        if (큐풀이.있음) for (const n of fs.readdirSync(d).filter(n => /\.cue$/i.test(n))) {
          try { const q = 큐읽기(path.join(d, n)); let 크기 = -1; try { 크기 = fs.statSync(q.bin).size; } catch (e) { } 큐풀이[n.normalize('NFC')] = path.basename(q.bin).normalize('NFC') + ' ' + 크기 + ' ' + (q.모드 || '') + '/' + q.크기; }
          catch (e) { 큐풀이[n.normalize('NFC')] = '오류 ' + e.message; }
        }
      } catch (e) { 큐풀이.오류 = e.message; }
      const 서버줄 = 서버기록.filter(l => /CD|BGM|음악|원본|설정|오류|Error|404/i.test(l)).slice(-60);
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
      return res.end(JSON.stringify({ 기록: { CD폴더: r.CD폴더, CD: r.CD, 창2: r.창2 }, 데이터: 데이터, 폴더: 본, 설정글, 큐풀이, 서버줄, 게임켬 }));
    }
    if (p === '/state') { const r = 기록읽기(), 찾 = 원본찾기(); return 제이슨(res, { 기록: r, 설치됨: !!(r && 창2폴더인가(r.창2) && r.창1), 찾음: 찾, 진행, 설치중, 설치오류, 바깥폴더: 바깥폴더후보[0], 튕김알림, cue없음: cue살피기(r, 찾).없음, cue까닭: cue살피기(r, 찾).까닭 }); }   /* 정본 470 — '없음' | '못읽음' */
    if (p === '/reinstall' && req.method === 'POST') {   /* 정본 310 — 첫 화면 «다시 설치» */
      if (설치중 || 게임켬) return 제이슨(res, { 오류: 설치중 ? '설치 중입니다' : '게임이 이미 시작됐습니다 — 앱을 다시 켠 뒤 첫 화면에서 고르세요' }, 409);
      설치오류 = null; 진행 = { 단계: '', 지금: 0, 전체: 0, 이름: '' };
      return 제이슨(res, { 지움: 다시설치지우기(데이터) });
    }
    if (p === '/notes') {   /* 정본 313 — 받은 패치의 릴리즈노트가 있으면 그것 */
      let t = '';
      for (const f of [path.join(덮어쓰기, '게임', '릴리즈노트.txt'), path.join(게임폴더, '릴리즈노트.txt')]) { try { t = fs.readFileSync(f, 'utf8').split('\r').join(''); break; } catch (e) { } }
      return 보냄(res, 200, 'text/plain; charset=utf-8', t);
    }
    /* 정본 313 — 첫 화면 «새 패치가 있습니다 — 패치 받기» · 게임 서버를 띄우기 «전»에만 받는다 */
    if (p === '/patch/check') {
      const r = await 패치().확인(Object.assign(패치설정(), { 시간제한: 5000 }));
      return 제이슨(res, { 있음: r.있음, 판: r.판, 지금판: r.지금판, 크기: r.크기, 파일수: r.받을.length, 지울수: r.지울.length, 엔진옛것: r.엔진옛것, 엔진다름: r.엔진다름 });
    }
    if (p === '/patch/get' && req.method === 'POST') {
      if (게임켬 || 설치중) return 제이슨(res, { 오류: 게임켬 ? '게임이 이미 시작됐습니다 — 앱을 다시 켠 뒤 첫 화면에서 받으세요' : '설치 중입니다' }, 409);
      if (!패치중) {
        패치중 = true; 패치오류 = null; 패치끝 = null; 패치진행 = { 단계: '확인', 지금: 0, 전체: 0, 이름: '' };
        패치().받기(Object.assign(패치설정(), { 진행: q => { 패치진행 = q; } }))
          .then(r => { 패치중 = false; 패치끝 = { 판: r.판, 받음: r.받음, 지움: r.지울.length, 엔진옛것: r.엔진옛것, 엔진다름: r.엔진다름 }; },
            e => { 패치중 = false; 패치오류 = String(e && e.message || e); });
      }
      return 제이슨(res, { 시작함: true });
    }
    if (p === '/patch/state') return 제이슨(res, { 패치중, 진행: 패치진행, 오류: 패치오류, 끝: 패치끝 });
    if (p === '/upload' && req.method === 'PUT') {   /* 파일 하나 — 몸 그대로 흘려 쓴다(650MB bin 도) · ?이름= */
      const 이름 = path.basename(String(u.searchParams.get('name') || '')).replace(/[\\/:*?"<>|]/g, '_');
      if (!이름) return 제이슨(res, { 오류: '이름 없음' }, 400);
      /* 정본 410 — ?cue=1 : 설치된 뒤 «cue 파일 연결» — CD 이미지가 있는 폴더(게임 서버가 cue 를 찾는 곳)에 둔다 · .cue 만 */
      let 넣을폴더 = 올린폴더;
      if (u.searchParams.get('cue') === '1') {
        if (!/\.cue$/i.test(이름)) return 제이슨(res, { 오류: '.cue 파일을 골라 주세요' }, 400);
        넣을폴더 = cue살피기(기록읽기(), 원본찾기()).폴더 || 올린폴더;
      }
      fs.mkdirSync(넣을폴더, { recursive: true });
      const 임시 = path.join(넣을폴더, 이름 + '.받는중'), 끝 = path.join(넣을폴더, 이름);
      const f = fs.createWriteStream(임시);
      req.pipe(f);
      f.on('finish', () => { fs.renameSync(임시, 끝); 제이슨(res, { 받음: 이름, 크기: fs.statSync(끝).size }); });
      f.on('error', e => 제이슨(res, { 오류: String(e.message) }, 500));
      return;
    }
    if (p === '/clear' && req.method === 'POST') { fs.rmSync(올린폴더, { recursive: true, force: true }); return 제이슨(res, { 지움: true }); }
    if (p === '/install' && req.method === 'POST') {
      if (설치중) return 제이슨(res, { 설치중: true });
      설치중 = true; 설치오류 = null; 진행 = { 단계: '시작', 지금: 0, 전체: 1, 이름: '' };
      설치하기().then(() => { 설치중 = false; 진행 = { 단계: '끝', 지금: 1, 전체: 1, 이름: '' }; },
        e => { 설치중 = false; 설치오류 = String(e && e.message || e); });
      return 제이슨(res, { 시작함: true });
    }
    if (p === '/start') { const r = 기록읽기(); if (!r) return 제이슨(res, { 오류: '설치 기록 없음' }, 400); 게임띄우기(r); return 제이슨(res, { 주소: 게임주소() }); }
    return 보냄(res, 404, 'text/plain; charset=utf-8', '없음');
  } catch (e) { return 제이슨(res, { 오류: String(e && e.message || e) }, 500); }
}).listen(설치포트, '127.0.0.1', () => {
  console.log('[모바일] 설치 창구 ' + 설치포트 + ' · 데이터 ' + 데이터 + (process.env.G2M_본체 ? ' · 본체 ' + process.env.G2M_본체 : ''));
  try { fs.unlinkSync(path.join(데이터, '시동시도.json')); } catch (e) { }   /* 정본 332 — 창구가 떴다 = 이 본체로 켜기 성공 → 시동 표지를 지운다 */
  if (다리 && 다리.channel) 다리.channel.send('준비', 설치포트);
});

/* 게임 «종료»(EXIT) — 화면 쪽이 부르면 앱을 끝내라고 알린다 (www/index.html 이 받아 App.exitApp) */
if (다리 && 다리.channel) 다리.channel.on('핑', () => 다리.channel.send('퐁', 게임켬));
