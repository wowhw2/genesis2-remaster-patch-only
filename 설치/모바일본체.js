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

/* ── 원본 파일 찾기 — 올린 것 + 바깥 앱 폴더 ── */
function 파일들(d) { try { return fs.readdirSync(d).map(n => path.join(d, n)).filter(p => fs.statSync(p).isFile()); } catch (e) { return []; } }
function 원본찾기() {
  const 실경로 = p => { try { return fs.realpathSync(p); } catch (e) { return p; } };   /* /sdcard 와 /storage/emulated/0 은 같은 곳 — 한 번만 */
  const 모두 = [...new Set([올린폴더, ...바깥폴더후보].flatMap(d => [...파일들(d), ...파일들(path.join(d, '창2')), ...파일들(path.join(d, '창1'))]).map(실경로))];
  const 이름 = p => path.basename(p).toUpperCase();
  /* 창2 — GENESIS2.CUE 우선 · 없으면 크기가 큰 .bin/.iso 중 창1 이 아닌 것 */
  const 창2 = 모두.find(p => /\.CUE$/.test(이름(p)) && /GENESIS2|창세기전2|창세기전 2/i.test(path.basename(p)))
    || 모두.find(p => /\.CUE$/.test(이름(p)) && !/창1|GENESIS1|창세기전1/i.test(p))
    || 모두.find(p => /\.(BIN|ISO|IMG)$/.test(이름(p)) && /GENESIS2|창세기전2/i.test(path.basename(p)));
  /* .img 도 받는다 — 창1 원본을 .img 로 가진 사람이 많다 (사장님 11-20 「그리고 창세기전1 img가 안된다는 이야기가 있네」 · 정본 302) */
  const 창1 = 모두.find(p => /\.(ISO|CUE|IMG)$/.test(이름(p)) && /창세기전1|창세기전 1|GENESIS1|GENESIS\.|창1/i.test(path.basename(p)) && p !== 창2)
    || 모두.find(p => /\.(ISO|IMG)$/.test(이름(p)) && p !== 창2 && !/GENESIS2|창세기전2/i.test(path.basename(p)));
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
    if (이름들.some(n => n.toUpperCase() === 적힌.toUpperCase())) return cue;   /* 있다(대소문자만 달라도 설치엔진이 찾는다) */
    const 후보 = 이름들.filter(n => /\.(bin|img|iso)$/i.test(n) && path.join(폴더, n) !== 창1 && !/창1|창세기전1|창세기전 1|GENESIS1/i.test(n))
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
  require(path.join(게임폴더, 'server.js'));
  게임켬 = true;
}
const 게임주소 = () => 'http://127.0.0.1:' + 게임포트 + '/' + encodeURIComponent('게임') + '/' + encodeURIComponent('게임') + '.html?devtools=0&' + encodeURIComponent('모바일') + '=1';

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
    if (p === '/state') { const r = 기록읽기(); return 제이슨(res, { 기록: r, 설치됨: !!(r && 창2폴더인가(r.창2) && r.창1), 찾음: 원본찾기(), 진행, 설치중, 설치오류, 바깥폴더: 바깥폴더후보[0] }); }
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
      fs.mkdirSync(올린폴더, { recursive: true });
      const 임시 = path.join(올린폴더, 이름 + '.받는중'), 끝 = path.join(올린폴더, 이름);
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
