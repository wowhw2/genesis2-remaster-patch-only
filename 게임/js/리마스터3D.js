/* ============================================================
 *  리마스터 3D 맵 — 기울인 화면의 맵을 지정본(사람이 지정한 3D)으로 그린다 (이식 1단계)
 *
 *  사장님 (2026-10-18): 「일단 3d를 이식하는쪽으로 방향을 잡자」 · 「그릭은 이식해도 돼」 ·
 *    「실행기에 별도 png나 이런걸 첨부해서는 안돼. 기존 원본 맵을 알고리즘으로 변환하고,
 *     높이나 건물지정등의 요소만 별도 맵설정 파일로 첨부해야해.」
 *
 *  하는 일
 *    ① 맵이 열리면 — 허락된 맵(켜는맵)이고 스위치가 켜졌을 때만 —
 *       원본 .MAP · 맵 설정 파일(SCENARIO/<맵>.요소지정.json — 칸 비트·높이 · 픽셀 없음) ·
 *       지면화 분류(/__블록분류) · 묶음 표 를 받아 **그 자리에서 굽는다** (지정본굽기.js · 도구와 같은 코드)
 *    ② WebGL 캔버스를 호스트 맨 아래에 깔고, 실행기 apply() 마다 **같은 카메라**로 그린다 (지정본그리기.js)
 *    ③ 기울기·회전이 있을 때만 켠다 — 기울기 0 은 원본 화면 그대로(원본 기준선)
 *       켜진 동안 화면 요소 맵(바닥·타일·눕힌 사물·배경막·원경·맵 조각)만 감춘다.
 *       유닛·연출·이동 범위 표식·보물 상자는 화면 요소 그대로 위에 얹힌다
 *    ④ (2단계) 유닛 상자를 그 칸 지형 높이만큼 띄우고(translateZ — 같은 카메라라 WebGL 지형 위에 선다),
 *       유닛 위에 겹친 투명 «가림판» 캔버스에 유닛보다 앞 줄의 세운 사물·건물을 유닛 자리에만 그린다
 *       (앞뒤 = 실행기 줄 차례 · 유닛 줄은 실행기 box._row · 절벽 위 «목록 D» 예외는 3D 에선 안 따름 — 사장님 고르심 10-18)
 *    ⑤ (4단계) 이동·공격 범위 표식(g2-mark · 위 표식)과 보물 상자도 그 칸 높이만큼 띄운다 ·
 *       클릭→칸(R.screenToTile)은 시선을 위에서 따라 내려가 처음 닿는 지형 표면의 칸으로 (projection.js 역투영평면)
 *    ⑥ (3단계) 연출 — 연출 층(아래·월드·위·맨 위) 안에서 밑동 자리(_ground)를 가진 판(빌보드놓기로 놓인 그림)을
 *       그 밑동 자리 지형 높이만큼 띄운다. 눕는 마법진도 같다. 화면 고정 연출(밑동 없음)은 그대로
 *
 *    ⑦ (10-18) 카메라가 화면 가운데 지점 높이를 따른다 · 커서 박스·목적지 네모·범위 표식·보물도 높이·가림을 따른다 · 3D 높이 슬라이더(개발 패널 기울기 아래)
 *    ⑧ (10-19) 세우는 판은 «닻»에 선다 — 원본 화면의 세로 자리가 닻 발줄 위 높이가 되게 변환을 직접 만든다(세우기).
 *       유닛 = 자기 발줄 · 체력 숫자·고른 커서 = 그 유닛 · 연출 = 지금 연출의 시전자·대상 중 겹치거나 가까운 유닛(사이를 나는 것은 둘을 섞음) ·
 *       HUD 캔버스 숫자(screenOfRendered)도 그 유닛 판에서 잰다 · 카메라 높이는 가운데 칸 유닛 발 높이 · apply 뒤 _vcam 은 높이 밀림을 뺀 판단용 값
 *       (사장님 「연출 위치가 다르고 … 커서와 박스 위치가 다름 … 카메라도 중심이 아니라 … 기존 2.5d와 3d 간 문제 생기지 않게」 · 대조 04_도구/리마스터3D_연출대조.js)
 *  스위치: 맵 설정 파일이 있는 맵은 기본 켬 · 개발 패널 «2.5D / 3D» 고르기 (10-18 사장님 「세 맵은 기본 옵션 켜는 걸로 해줘.」) · 끄기 ?리마스터3D=off 또는 window.__리마스터3D켬 = false
 *    켜는맵 밖의 맵은 늘 꺼짐 — 기울기 0 은 어느 맵이든 원본 화면 그대로
 * ============================================================ */
(function (root) {
  'use strict';

  /* 2.5D / 3D 고르기 — 기억된 값을 먼저 읽는다 (개발 패널 토글) */
  try { if (root.localStorage.getItem('리마스터3D보기') === '2.5d') root.__리마스터3D끄기 = true; } catch (e) {}

  /* 어느 맵을 켜나 — 모든 전투 맵 (10-20 · 설정 파일이 없으면 완전 평면으로 굽는다 — 굽기()) · 예전: 실행기 맵 설정 파일(SCENARIO/<맵>.요소지정.json)이 있는 맵 전부
   *   (10-18 사장님 「일단 구워놓은 맵이 적용되게 해야하고, 나중에 추가로 수정해서 구우면 그대로 적용되어야해」)
   *   맵 설정은 04_도구/맵_지정적용.js 가 손칠 있는 전투 맵을 구울 때마다 쓴다. 켜는맵[맵] = false 로 한 맵만 끌 수 있다 */
  var 켜는맵 = {};

  function 스위치() {
    var v = null;
    try { v = new URLSearchParams(root.location ? root.location.search : '').get('리마스터3D'); } catch (e) {}
    if (v === 'off') return false;
    if (v === 'on') return true;
    if (root.__리마스터3D켬 === false) return false;
    return true;      /* 켜는맵은 기본 켬 — 10-18 사장님 「세 맵은 기본 옵션 켜는 걸로 해줘.」 · 끄기 ?리마스터3D=off */
  }
  function 경로(p) { return typeof root.G2URL === 'function' ? root.G2URL(p) : '/원본/' + p; }
  async function 받기(p, 글) {
    try {
      var r = await fetch(경로(p));
      if (!r.ok) return null;
      return 글 ? await r.text() : new Uint8Array(await r.arrayBuffer());
    } catch (e) { return null; }
  }

  /* 바닥·맵 조각만 감추는 규칙 — 호스트에 g2-3d맵 이 붙은 동안 (맵가리기 와 달리 이동 범위 표식·보물은 남긴다)
   *   g2-fpm-marks(원경 위 범위 표식 조각 · render.js _원경짓기 11-09)도 — 평면에선 바닥 밑이라 안 보이지만 3D 에선 바닥이 빠져
   *   밝힌 원경 네모가 유닛을 덮었다 (사장님 11-09 「가림처리 잘못된건지 왜 이렇게 된거야?」·「마장기 왼쪽」) · 3D 는 표식3D 가 따로 그린다 */
  function 규칙넣기() {
    if (root.document.getElementById('g2-3d맵-규칙')) return;
    var st = root.document.createElement('style');
    st.id = 'g2-3d맵-규칙';
    st.textContent = ['g2-floorlayer', 'g2-tilelayer3d', 'g2-flat-object-layer', 'g2-backdrop', 'g2-backdrop-anim',
      'g2-fpm', 'g2-fpm-top', 'g2-fpm-marks', 'g2-map-structure', 'g2-map-object-strip', 'g2-map-tree-composite', 'g2-rowflat',
      'g2-map-flatpiece'].map(function (c) { return '.g2-3d맵 .' + c; }).join(',\n') + ' { display: none !important; }' +
      /* 리맵 범위 표식은 3D 지형 위에 WebGL 로 그리는 동안 감춘다 (표식3D) */
      /* 3D 동안은 늘 감춘다 — 3D 로 못 그리는 것이 확실할 때(g2-3d표식없음)만 평면 표식을 띄운다 · 켜는 class 를 기다리면 링을 연 첫 화면에 평면 칸이 한 번 비쳤다(평면 칸은 땅 높이를 안 받아 캐릭터 남쪽에 보인다) (11-05 사장님 「남쪽에도 깜빡거리는게 문제야」) */
      '\n.g2-3d맵:not(.g2-3d표식없음) .g2-mark.g2-범위리맵 { visibility: hidden !important; }' +
      /* 눕힌 오브젝트 위 표식(addMarkTop · 오버레이 층 = 유닛보다 위) — 같은 칸 바닥 표식이 3D 로 그려지므로 감춘다
       *   (10-24 사장님 「하이라이트 표시가 캐릭터나 오브젝트 일부를 덮는 문제도 있어」 — 계단 위 반투명 띠가 유닛을 덮었다) */
      '\n.g2-3d맵:not(.g2-3d표식없음) .g2-mark-top { visibility: hidden !important; }';
    root.document.head.appendChild(st);
  }

  /* 다른 맵 굽기 — 마을 굽기가 빌려 쓰는 맵(짝 전투맵·DES·이웃 마을) · 한 번 구우면 기억 */
  var 남캐시 = {};
  function 남굽기(nm) { if (!남캐시[nm]) 남캐시[nm] = 굽기(nm, null, null).then(function (r) { return r && !r.실패 ? r : null; }, function () { return null; }); return 남캐시[nm]; }
  /* ① 굽기 — 원본 .MAP + 맵 설정으로. PNG 를 만들지 않고 픽셀을 그대로 받는다 */
  async function 굽기(이름, mapx, 맵층) {
    /* 마을 맵(마을_X) — 원본 = CSTLDATA/X.MAP · 맵 설정 = CSTLDATA/X.요소지정.json (도구 04_도구/_맵3D/마을_X_요소지정.json 을 맵_지정적용.js 가 구울 때마다 내보냄) · 이름은 «마을_X» 그대로 굽고 그려야 맵별 손질(다층지붕표 등)이 걸린다 (사장님 11-04 「마을맵 3d 게임에 적용해줘.」·「요소 지정된 모든맵 전부 적용해야해. 그리고 앞으로 개선하는 부분도 자동으로 반영되어야 해」) */
    var 마을 = 이름.indexOf('마을_') === 0, 원이름 = 마을 ? 이름.slice(3) : 이름, 자리 = 마을 ? 'CSTLDATA/' : 'SCENARIO/';
    /* 블록 분류(지면화 도구가 저장한 눕힘·세움 지정) — 전투 렌더러가 맵을 열 때 받아 두는 값이라, 전투 없이 마을에 들어가면 비어 있었다 → 도구와 다른 굽기(세울 것이 눕고 지형 그림이 비어 축대 옆면이 검게 빠짐) (11-05 사장님 「3d 맵 제대로 안들어갔어. 다 깨지는데? 지정보기 모양이랑 완전 달라」) */
    if (root.G2블록분류 === undefined || root.G2블록분류 === null) { try { var 분r = await fetch('/__블록분류'); if (분r.ok) { var 분j = await 분r.json(); root.G2블록분류 = (분j && 분j.분류) || null; root.G2묶음지정 = (분j && 분j.묶음) || null; } } catch (e분) {} }
    var PAL = await 받기('GENESIS.PAL'), MAP = await 받기(자리 + 원이름 + '.MAP');
    var 설정글 = await 받기(자리 + 원이름 + '.요소지정.json', true);
    /* 맵 설정 파일이 없는 맵 = 완전 평면 맵 — 모든 칸 평지 · 높이 1 · 세울 오브젝트는 원본 분류대로 (10-20 사장님 「두 모드에서 모든맵이 사용되려면 평면맵도 3d로 구워야 할 것 같아」 → 고르심 ①) */
    if (!설정글 && MAP && root.G2Native) { var mm = root.G2Native.decodeMAP(MAP, new Uint8Array(768)), 여 = 6, 칸 = [], 높 = [];
      for (var yy = 0; yy < mm.H + 여; yy++) for (var xx = 0; xx < mm.W; xx++) { 칸.push(yy < mm.H ? 1 : 0); 높.push(yy < mm.H ? 1 : -1); }
      설정글 = JSON.stringify({ 맵: 이름, W: mm.W, H: mm.H, 여백: 여, 설명: '평면 맵 — 설정 파일 없음(자동)', 칸: 칸, 높이: 높, 오브젝트세움: [] }); }
    if (!PAL || !MAP || !설정글) return { 실패: '자료 없음 — ' + (!PAL ? 'GENESIS.PAL ' : '') + (!MAP ? 이름 + '.MAP ' : '') + (!설정글 ? 이름 + '.요소지정.json' : '') };
    var 묶음틀 = await 받기('오브젝트묶음틀.json', true);
    var N = root.G2Native;
    /* 갈 수 있는 칸 — 원본 지형표에서 (도구의 _지형.json 갈수 와 전투 맵 226개에서 같음 확인 · 10-18) */
    var 팔 = new Uint8Array(768);
    for (var i = 0; i < 768; i++) { var v = PAL[i] & 0x3F; 팔[i] = (v << 2) | (v >> 4); }
    var m0 = N.decodeMAP(MAP, 팔);
    /* 원경(.FPM) 이름은 .MAP 꼬리가 준다 — render.js _원경짓기 · COMBATII 0x108CC 와 같은 규칙 (SKY07→SKY02 · SKY08→SKY04 · SKY09→SKY06 · M07→M06 · ODS03→ODS3 …)
     *   ☠ 전에는 맵 이름(SKY07.FPM)으로만 찾아 그런 맵은 3D 에서 원경이 통째로 빠져 하늘이 검었다 (사장님 11-09 「공중전용 맵 원경에 검정색 선이 있어서 이거 처리해야해.」) */
    var 원경이름 = (m0.배경 && m0.배경.이름) || 이름;
    var FPM = 마을 ? null : (await 받기('SCENARIO/' + 원경이름 + '.FPM')) || (원경이름 !== 이름 ? await 받기('SCENARIO/' + 이름 + '.FPM') : null);
    if (맵층) ['layerA', 'layerB', 'layerC'].forEach(function (k) { var v = 맵층[k]; if (v && m0[k] && v.length === m0[k].length) m0[k].set(v); });   /* 실행 중 바뀐 칸(op 0x10) — 갈 수 있는 칸도 지금 맵으로 */
    var T = N.mapTerrain(m0), 갈수 = new Array(m0.W * m0.H);
    for (var y = 0; y < m0.H; y++) for (var x = 0; x < m0.W; x++) 갈수[y * m0.W + x] = T.칸[y][x].비용[0] > 0 ? 1 : 0;
    var 설정 = JSON.parse(설정글);
    var 파일 = {}, 쓴 = {}, 그림 = {}, 도구 = '04_도구', 맵3D = '04_도구/_맵3D/';
    /* 마을 통행표 — 도구(04_도구/마을_통행표.js)와 같은 식: 이 맵의 .TWN 평면 A 를 모두 겹쳐 «모든 벌에서 막힘» 만 벽 · 0줄은 막힘 · TWN 이름 목록은 설정(__twn)에 담아 내보냄 */
    var 벌들 = [];
    if (마을 && Array.isArray(설정.__twn) && root.G2Twn) for (var ti = 0; ti < 설정.__twn.length; ti++) { var tb = await 받기('CSTLDATA/' + 설정.__twn[ti]); if (!tb) continue; try { var tw = root.G2Twn.TWN파싱(tb); 벌들.push({ W: tw.W, H: tw.H, A: tw.평면.A }); } catch (e) {} }
    function 통행표(nm, W, H) { var 벌 = 벌들.filter(function (v) { return v.W === W; }); if (!벌.length) return null; var 갈수 = new Uint8Array(W * H).fill(1);
      for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) { if (y === 0) { 갈수[x] = 0; continue; } var 막 = 0, 셈 = 0; for (var q = 0; q < 벌.length; q++) { var r = y - 1; if (r >= 벌[q].H) continue; 셈++; if (벌[q].A[r * W + x] === 1) 막++; } 갈수[y * W + x] = !셈 || 막 === 셈 ? 0 : 1; }
      return { 갈수: 갈수 }; }
    /* 빌림 — 굽기가 읽는 «구운 결과»(<맵>_지정*.png · <맵>_지정.json): 다른 맵(짝 전투맵 지형·DES 기둥 본·브릿지 건물·클립스 자료)은 그 맵을 여기서 먼저 구워서, 자기 맵 것(평면 그림 — 같은 굽기에서 나중에 나옴)은 첫 판 결과로 · 도구는 폴더에 남은 구운 파일을 읽는다 · 마을만 (사장님 「요소 지정된 모든맵 전부 적용해야해」) */
    var 빌림쓰기 = 마을 || 이름 === 'GREEK';   /* 다른 맵 구운 결과 빌려 쓰기(png읽기·가상 파일) — 마을 + 전투 GREEK(브리드 재료 · 아래 마을require 주석) */
    var 빌림 = {}, 빠짐 = {}, 빌림키 = function (p) { var b = String(p).split('/').pop(); return /_지정[^/]*\.(png|json)$/.test(b) ? b : null; };
    /* 굽기 모듈의 require — 마을만 · 통행표와 빌림 그림 읽기 */
    /* 전투 GREEK 도 — 굽기가 «브리드 재료»(남쪽 지붕·용마루 줄·장식창)를 12,7 판 아래 빈 줄에 옮기는 단계가 png읽기(환경.require)로만 돌아
     *   게임(브라우저)에서 건너뛰어 정면 박공 면돌림·날개 지붕이 빈 곳을 덮어 검게 나왔다 (11-19 사장님 [그림 #87] 「이거 그릭 지붕은 왜이렇게 됐어?」·「마을용 바탕으로 전투에도 동일하게 적용해야해」 · 마을 GRIK 은 이 장치로 돌아 정상)
     *   다른 전투 맵은 그대로 둔다 — require 를 보는 다른 갈래(사막 기둥 빌림·마을 짝)가 같이 바뀌지 않게 */
    var 마을require = 빌림쓰기 ? function (n) { if (/마을_통행표/.test(n)) return { 통행표: 통행표 }; if (/png읽기/.test(n)) return { 읽기: function (p) { var k = 빌림키(p), g = k && 빌림[k]; if (!g || typeof g === 'string') { if (k) 빠짐[k] = 1; throw new Error('없음 ' + p); } return { W: g.w, H: g.h, ch: 4, data: g.rgba }; } }; throw new Error('없음 ' + n); } : null;
    파일['01_원본게임/창세기전2/Genesis2/GENESIS.PAL'] = PAL;
    파일[맵3D + 이름 + '_요소지정.json'] = 설정글;
    if (마을) 파일['01_원본게임/창세기전2/Genesis2/CSTLDATA/' + 원이름 + '.MAP'] = MAP; else 파일['06_패치/적용/SCENARIO/' + 이름 + '.MAP'] = MAP;
    파일[맵3D + 이름 + '_지형.json'] = JSON.stringify({ 갈수: 갈수 });
    파일['06_패치/적용/블록분류.json'] = JSON.stringify({ 분류: root.G2블록분류 || {}, 묶음: root.G2묶음지정 || {} });
    if (mapx) 파일['06_패치/적용/SCENARIO/' + 이름 + '.mapx.json'] = JSON.stringify(mapx);
    // CYRUPS: 공통 굽기의 기존 짝분류/짝칸이 읽는 전투 자료를 같은 메모리 파일 공급으로 연결.
    if (이름 === '마을_CYRUPS') {
      var 짝설정 = await 받기('SCENARIO/CYRUPS.mapx.json', true);
      if (짝설정) { var 짝MAP = await 받기('SCENARIO/CYRUPS.MAP');
        if (짝MAP) { 파일['06_패치/적용/SCENARIO/CYRUPS.mapx.json'] = 짝설정; 파일['06_패치/적용/SCENARIO/CYRUPS.MAP'] = 짝MAP; }
      }
    }
    if (묶음틀 && 설정.__묶음) { try { var 틀j = JSON.parse(묶음틀); 틀j.그림묶음 = 틀j.그림묶음 || {}; if (!틀j.그림묶음[이름]) 틀j.그림묶음[이름] = 설정.__묶음; 묶음틀 = JSON.stringify(틀j); } catch (e) {} }   /* 마을 — 짝 전투맵 묶음 후보를 마을 칸으로 옮긴 것(도구 맵_지정적용.js 마을대응과 같은 값을 설정에 담아 옴) */
    if (묶음틀) 파일['06_패치/적용/오브젝트묶음틀.json'] = 묶음틀;
    if (FPM) { 파일['01_원본게임/창세기전2_CD/GENESIS2/SCENARIO/' + 이름 + '.FPM'] = FPM; 파일['01_원본게임/창세기전2_CD/GENESIS2/SCENARIO/' + 원경이름 + '.FPM'] = FPM; }   /* 굽기는 꼬리 이름 → 맵 이름 순으로 찾는다 (지정본굽기 fpm) */
    if (Array.isArray(설정.칸옮김)) 파일[맵3D + 이름 + '_칸옮김.json'] = JSON.stringify(설정.칸옮김);
    /* 마을 맵 설정 파일에 함께 담아 내보낸 도구 설정(덧칠·집설정·지형 갈수) — 도구가 굽기에 읽는 자리에 그대로 둔다 · 도구와 같은 결과가 나와야 «고치면 그대로 반영» 된다 */
    if (설정.__덧칠) 파일[맵3D + 이름 + '_덧칠.json'] = JSON.stringify(설정.__덧칠);
    if (설정.__집설정) 파일[맵3D + 이름 + '_집설정.json'] = JSON.stringify(설정.__집설정);
    if (설정.__지형) 파일[맵3D + 이름 + '_지형.json'] = JSON.stringify(설정.__지형);
    if (설정.__씨앗) 파일[도구 + '/건물씨앗/' + 이름 + '.json'] = JSON.stringify(설정.__씨앗);   /* 건물씨앗 — 빠지면 도구와 다르게 구워졌다(CYRUPS 세움 23개 더 · 11-05 사장님 「지정보기에 내가 지정한거 자동으로 게임에 적용되어야한다고」) */
    var fs = {
      existsSync: function (p) { if (Object.prototype.hasOwnProperty.call(파일, p)) return true; var k = 빌림쓰기 && 빌림키(p); if (k && 빌림[k] != null) return true; if (k) 빠짐[k] = 1; return false; },
      readFileSync: function (p, enc) {
        var k = 빌림쓰기 && !Object.prototype.hasOwnProperty.call(파일, p) && 빌림키(p);
        if (k && typeof 빌림[k] === 'string') return enc ? 빌림[k] : new TextEncoder().encode(빌림[k]);
        if (!Object.prototype.hasOwnProperty.call(파일, p)) { if (k) 빠짐[k] = 1; throw new Error('없음 ' + p); }
        var v = 파일[p];
        if (enc) return typeof v === 'string' ? v : new TextDecoder().decode(v);
        return typeof v === 'string' ? new TextEncoder().encode(v) : v;
      },
      readdirSync: function () { return []; },
      writeFileSync: function (p, d) { 쓴[p] = d; }
    };
    var path = { join: function () { return Array.prototype.filter.call(arguments, Boolean).join('/').replace(/\/+/g, '/'); } };
    var 조용 = { log: function () {}, error: function () {}, warn: function () {} };
    /* 굽기 모듈이 다른 맵을 빌려 읽으면(DES02·DES04 → DES03 · DES05 → DES01 기둥 본 · 10-22 덧기둥표) 그 .MAP 을 받아 넣고 다시 굽는다 (10-25)
     *   ☠ 지금 맵 파일만 넣어 «없음 …/DES03.MAP» 으로 굽기가 실패해 그 맵들은 3D 가 안 켜졌다 */
    for (var 판 = 0; 판 < 8; 판++) { 쓴 = {}; 그림 = {}; 빠짐 = {};
    for (var 다시 = 0; 다시 < 6; 다시++) {
      try {
        root.G2지정본굽기.굽기({
          /* Buffer.copy(대상, 대상시작, 원시작, 원끝) 도 — 굽기가 같은 판 안 화소 옮기기에 쓴다(타일 문·PRISON 등 · 10-26 INSL07 「d2.copy is not a function」으로 3D 실패) */
          fs: fs, path: path, zlib: null, Buffer: { alloc: function (n) { var a = new Uint8Array(n); a.copy = function (t, ts, ss, se) { ss = ss || 0; se = se == null ? this.length : Math.min(se, this.length); if (se <= ss) return 0; t.set(this.subarray(ss, se), ts || 0); return se - ss; }; return a; } },
          N: N, ROOT: '', 도구폴더: 도구, 이름: 이름, 높이장: false, 맵층: 맵층 || null, require: 마을require, console: 조용,
          png쓰기: function (p, w, h, rgba) { 그림[String(p).split('_지정').pop().replace('.png', '')] = { w: w, h: h, rgba: rgba }; }
        });
        break;
      } catch (e굽) {
        var 빠진 = /없음 (\S+\/([A-Za-z0-9_]+)\.MAP)$/.exec(String(e굽 && e굽.message || ''));
        if (!빠진 || 파일[빠진[1]]) throw e굽;
        var 남MAP = await 받기('SCENARIO/' + 빠진[2] + '.MAP');
        if (!남MAP) throw e굽;
        파일[빠진[1]] = 남MAP;
      }
    }
      /* 빠진 구운 결과를 채우고 한 번 더 — 채운 것이 없으면 끝 */
      var 채움 = 0, 빠진것 = Object.keys(빠짐);
      for (var bi = 0; bi < 빠진것.length; bi++) { var 키 = 빠진것[bi]; if (빌림[키] != null || 빌림[키] === false) continue; var 남이름 = 키.split('_지정')[0], 종 = 키.slice(남이름.length + 3).replace(/\.(png|json)$/, ''), 남 = 남이름 === 이름 ? { 자료: 쓴[맵3D + 이름 + '_지정.json'] ? JSON.parse(쓴[맵3D + 이름 + '_지정.json']) : null, 그림: 그림 } : await 남굽기(남이름);
        var 값 = !남 ? null : /\.json$/.test(키) ? (종 === '' && 남.자료 ? JSON.stringify(남.자료) : null) : (남.그림 && 남.그림[종]) || null;
        빌림[키] = 값 || false; if (값) 채움++; }
      if (!채움) break; }
    var 자료글 = 쓴[맵3D + 이름 + '_지정.json'];
    if (!자료글) return { 실패: '굽기 결과 없음' };
    /* 마을 실내 규칙 자료 — 도구 04_도구/맵_바닥굽기.js 와 같은 식: 바닥 = 바닥 타일만(오브젝트 없음 · 빈 화소 검정) · 오브 = 그 맵 오브젝트 종류별 한 줄 시트 + 칸마다 종류 */
    var 실내자료 = null;
    if (마을) { var W0 = m0.W, H0 = m0.H, cw0 = W0 * 24, ch0 = H0 * 16, 바 = new Uint8Array(cw0 * ch0 * 4);
      for (var bi0 = 3; bi0 < 바.length; bi0 += 4) 바[bi0] = 255;
      for (var y0 = 0; y0 < H0; y0++) for (var x0 = 0; x0 < W0; x0++) { var ti0 = m0.layerA[y0 * W0 + x0] - 1; if (ti0 < 0 || ti0 >= m0.w) continue; var tl = m0.tile(ti0);
        for (var ty = 0; ty < 16; ty++) for (var tx = 0; tx < 24; tx++) { var pv = tl[ty * 24 + tx]; if (pv === 0) continue; var o0 = ((y0 * 16 + ty) * cw0 + x0 * 24 + tx) * 4; 바[o0] = m0.palette[pv * 3]; 바[o0 + 1] = m0.palette[pv * 3 + 1]; 바[o0 + 2] = m0.palette[pv * 3 + 2]; } }
      var 종 = [], 색2 = {}, 칸종 = new Array(W0 * H0).fill(-1);
      for (var ii = 0; ii < W0 * H0; ii++) { var b0 = m0.layerB[ii] - 1; if (b0 < 0) continue; var kk = N.blockKey(m0, b0); if (색2[kk] === undefined) { var fr0 = m0.decodeBlock(b0); if (!fr0) continue; 색2[kk] = 종.length; 종.push({ 키: kk, w: fr0.w, h: fr0.h, 수: 0, fr: fr0 }); } 칸종[ii] = 색2[kk]; 종[색2[kk]].수++; }
      var 오 = null, 오표 = null;
      if (종.length) { var sh0 = 0, sw0 = 0; 종.forEach(function (t2) { sh0 = Math.max(sh0, t2.h); t2.ox = sw0; sw0 += t2.w; }); var sd0 = new Uint8Array(sw0 * sh0 * 4);
        종.forEach(function (t2) { for (var yy2 = 0; yy2 < t2.fr.h; yy2++) for (var xx2 = 0; xx2 < t2.fr.w; xx2++) { var v2 = t2.fr.idx[yy2 * t2.fr.w + xx2]; if (v2 < 0) continue; var q2 = ((sh0 - t2.h + yy2) * sw0 + t2.ox + xx2) * 4; sd0[q2] = m0.palette[v2 * 3]; sd0[q2 + 1] = m0.palette[v2 * 3 + 1]; sd0[q2 + 2] = m0.palette[v2 * 3 + 2]; sd0[q2 + 3] = 255; } });
        오 = { w: sw0, h: sh0, rgba: sd0 }; 오표 = { 맵: 이름, W: W0, H: H0, 시트: { 폭: sw0, 높: sh0 }, 종류: 종.map(function (t2) { return { 키: t2.키, w: t2.w, h: t2.h, ox: t2.ox, 수: t2.수 }; }), 칸: 칸종 }; }
      실내자료 = { 바닥: { w: cw0, h: ch0, rgba: 바 }, 오브: 오, 오브표: 오표 }; }
    /* [리마스터] 던전(YOU·DUN) — 걸을 수 있는 칸은 용암을 빼고 캐릭터를 1층에 세운다(지정본그리기 높이px 의 지정.발높이 · 지형 그림·높이는 칠한 그대로)
     *   2층으로 그려진 칸에 선 캐릭터는 1층 높이라 앞 2층 지형 그림에 가려진다 (사장님 11-09 「이런 실내 YOU시리즈나 DUN시리즈 던전에서 이동가능한 부분은(용암 제외)
     *   모두 1층이고 2층으로 되어있는 부분은 1층이지만 2층 오브젝트에 가려져야하는 부분인데 지금 자꾸 2층으로 올라가.」) */
    var 던전발 = null;
    if (/^(YOU|DUN)\d+$/i.test(이름)) {
      던전발 = new Array(m0.W * m0.H);
      for (var dy = 0; dy < m0.H; dy++) for (var dx = 0; dx < m0.W; dx++) {
        var 칸d = T.칸[dy][dx];
        던전발[dy * m0.W + dx] = (갈수[dy * m0.W + dx] && 칸d && 칸d.이름 !== '용암') ? 1 : null;
      }
    }
    return { 설정글: 설정글, 자료: JSON.parse(자료글), 그림: 그림, 묶음틀: 묶음틀 ? JSON.parse(묶음틀) : null, 바탕팔: m0.palette ? new Uint8Array(m0.palette) : null, 유형: 설정.유형 || null, 실내자료: 실내자료, 덧칠: 설정.__덧칠 || null, 던전발: 던전발 };
  }

  /* ② 장면 — 실행기 카메라 그대로 */
  function 장면만들기(R, 이름, 구운것, mapx) {
    var host = R.host, cv = root.document.createElement('canvas');
    cv.className = 'g2-3d맵-캔버스';
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:none;';
    cv.width = Math.max(1, host.clientWidth); cv.height = Math.max(1, host.clientHeight);
    host.insertBefore(cv, host.firstChild);
    /* (2단계) 가림판 — 월드(유닛이 든 층) 바로 뒤 = 유닛 위 · 화면 위 연출층보다는 아래 */
    var cv2 = root.document.createElement('canvas');
    cv2.className = 'g2-3d가림판';
    cv2.style.cssText = cv.style.cssText;
    cv2.width = cv.width; cv2.height = cv.height;
    if (R.world && R.world.parentNode === host) host.insertBefore(cv2, R.world.nextSibling); else host.appendChild(cv2);
    /* 자료는 장면·가림판이 따로 갖는다 — 그리기 모듈의 맵별 손질(PAN 받침 조각 끼우기 등)이 자료를 고쳐 쓴다.
     *   한 객체를 같이 쓰면 두 번째(가림판)가 늘어난 세움 수로 원래 그림 폭을 나눠 조각 폭이 소수가 되어 멈췄다 (10-19 PAN 3D 안 켜짐 · Invalid array length) */
    function 환경(캔버스, 가림판) { return {
      세로배율: 세로배율,   /* 오브젝트로 세워 둔 인물 조각(굽기 «인물»)도 유닛과 같은 기울기 세로 보정 (사장님 11-11) */
      장면판번호: function () { var s3 = R._리마스터3D; return s3 && s3.장면 ? (s3.장면.판번호 | 0) : -1; },
      장면표식번호: function () { var s3 = R._리마스터3D; return s3 ? (s3.표식번호 | 0) : 0; },   /* 정본 375 — 범위 칸이 바뀐 장면은 가림판이 아끼지 않게 */   /* 정본 336 — 가림판이 장면이 바뀐 때만 다시 올린다 */
      캔버스: 캔버스, 가림판: 가림판, 장면캔버스: 가림판 ? cv : null, 맵: 이름, 덧칠: 구운것.덧칠 || null,   /* 장면캔버스 — 가림판이 앞 건물 자리에 장면 그림을 그대로 옮겨 칠한다 (10-24) */ 자료: 가림판 ? JSON.parse(JSON.stringify(구운것.자료)) : 구운것.자료, 그림: 구운것.그림, 묶음틀: 구운것.묶음틀,
      배경막: (mapx && mapx.backdrop && mapx.backdrop.foldY) || 0,
      설정: {},
      카메라: function () {
        var 표3 = R._리마스터3D, c = R.cam, v = (표3 && !표3.apply중 && 표3.vcam3d) || R._vcam || {};   /* apply 밖이면 3D 화면 카메라 */
        return { tilt: c.tilt, rot: c.rot, dist: c.dist, fov: c.fov, zoom: c.zoom, cx: c.cx, cy: c.cy,
                 vcx: v.cx != null ? v.cx : c.cx, vcy: v.cy != null ? v.cy : c.cy };
      },
      투영: root.G2Projection,
      투영옵: function () { return { 흔들: R.shake || { x: 0, y: 0 } }; },
      dpr: root.devicePixelRatio || 1,
      /* ★ 원경 리맵본 — 3D 범위 표식(표식그리기)은 바닥 리맵 그림을 땅에 눕히는데, 바닥이 비어 원경이 비치는 칸(ODS03_2 30% · 하늘 맵 63%)은
       *   그림이 투명이라 셰이더가 원경을 «그대로» 그려 표식이 안 보였다. 원본 0x10130 은 화면 버퍼 24×16 을 LUT(표1 · 강도 30 · 보정 9)로 바꾸므로
       *   원경도 밝아진다 → 원경 그림을 같은 표로 한 벌 더 굽고 표식을 그리는 동안만 셰이더의 원경 텍스처를 이것으로 바꾼다 (2D 길 render.js _원경짓기 와 같은 표)
       *   (사장님 11-10 「원경을 사용하는 맵에 하이라이트 표시 전수 확인해야해. 지금 오디세이에서 베라딘과 대결하는 장면 타일 하이라이트 안나와. 이동, 타겟 선택, 범위」) */
      원경리맵: function (그림) {
        var pal = 구운것 && 구운것.바탕팔, RM = root.G2Remap;
        if (!그림 || !pal || pal.length < 768 || !RM || typeof RM['표1'] !== 'function') return null;
        var 그릴색 = RM['표1그릴색'] ? RM['표1그릴색'](pal, !!(RM.표식보강켬 && RM.표식보강켬()), !!root.__눈밭맵) : null, LUT = RM['표1'](pal, 9), w = 그림.width, h = 그림.height;   /* [리마스터 밝은바닥표식] 정본 316 */
        var c = root.document.createElement('canvas'); c.width = w; c.height = h;
        var g = c.getContext('2d'); g.drawImage(그림, 0, 0);
        var im = g.getImageData(0, 0, w, h), d = im.data, 사전 = {}, i;
        for (i = 0; i < 256; i++) 사전[(pal[i * 3] << 16) | (pal[i * 3 + 1] << 8) | pal[i * 3 + 2]] = i;
        var 가까운 = {};
        for (var p = 0; p < d.length; p += 4) {
          if (d[p + 3] < 128) continue;
          var key = (d[p] << 16) | (d[p + 1] << 8) | d[p + 2], idx = 사전[key];
          if (idx == null) {   /* 원경자르기가 가장자리를 이웃 색으로 메워 표 밖 색이 생긴다 — 가장 가까운 팔레트 색으로 (색마다 한 번만) */
            idx = 가까운[key];
            if (idx == null) { var best = 1e9; for (i = 0; i < 256; i++) { var dr = pal[i * 3] - d[p], dg = pal[i * 3 + 1] - d[p + 1], db = pal[i * 3 + 2] - d[p + 2], e = dr * dr + dg * dg + db * db; if (e < best) { best = e; idx = i; } } 가까운[key] = idx; }
          }
          if (그릴색) { d[p] = 그릴색[idx * 3]; d[p + 1] = 그릴색[idx * 3 + 1]; d[p + 2] = 그릴색[idx * 3 + 2]; }
          else { var m = LUT[idx]; d[p] = pal[m * 3]; d[p + 1] = pal[m * 3 + 1]; d[p + 2] = pal[m * 3 + 2]; }
        }
        g.putImageData(im, 0, 0);
        return c;
      }
    }; }
    var 장면 = root.G2지정본그리기.만들기(환경(cv, false));
    /* [정본 336] 장면 그림이 바뀔 때마다 번호를 올린다 — 가림판이 같은 장면을 한 번 그릴 때 두 번(곧바로·유닛 자리 다시 잡은 뒤) 텍스처로 다시 올렸다
     *   (맥 시뮬레이터 아이패드 1-7 3D 가만히: texImage2D 5초 66번 1199ms · 사장님 11-20 「느린거 해결해야해. 지금 오딘3(안드로이드)도 느리다고 피드백이 왔어」) */
    ['그리기', '크기', '표식그리기'].forEach(function (k) { var f = 장면 && 장면[k]; if (typeof f === 'function') 장면[k] = function () { 장면.판번호 = (장면.판번호 | 0) + 1; return f.apply(this, arguments); }; });
    var 가림 = root.G2지정본그리기.만들기(환경(cv2, true));
    return { 캔버스: cv, 장면: 장면, 가림캔버스: cv2, 가림: 가림 };
  }

  /* ★ 3D 에서만 바꾸는 이동 칸 — 3D 그림이 원본과 다르게 놓인 곳 (맵: [[x, y, layerC 값]])
   *   SF 옆 계단 — 3D 는 사선 계단(왼쪽 11~13열 · 오른쪽 27~29열 23~28줄)을 23~25줄 가로 계단으로 펴 그린다(위 난간 23 · 디딤판 24 · 아래 난간 25 · 그 아래 26~28줄은 바닥 그림)
   *   → 디딤판 24줄 = 걷는 칸(1) · 난간 23·25줄(꼭대기 기둥 14·26열 25줄 포함) = 막힘(0x18) · 26~28줄 = 바닥(1)
   *   3D 가 켜진 동안만 · 2.5D(기울기 0)·3D 걷기 때 원본 값으로 되돌린다 (사장님 10-26 「옆 계단이 원본 맵과 다르게 그려서 이동가능 영역과 맞지 않아」 → 고르심 «1 이동 칸 바꾸기»·«1 3D 켜졌을 때만») */
  var 이동칸표 = { SF: (function () { var r = [];
    [[11, 14], [27, 26]].forEach(function (p) { var x0 = p[0], 끝 = p[1];
      for (var x = x0; x < x0 + 3; x++) { r.push([x, 23, 0x18], [x, 24, 1], [x, 25, 0x18], [x, 26, 1], [x, 27, 1], [x, 28, 1]); }
      r.push([끝, 25, 0x18]); });
    return r; })() };
  function 이동칸맞춤(R, s, 켬) {
    var 표 = 이동칸표[s && s.이름], map = R.b && R.b.map;
    if (!표 || !map || !map.layerC || !root.G2Native || !root.G2Native.mapTerrain) return;
    var W = map.W;
    if (켬 && !s.이동원) { s.이동원 = 표.map(function (c) { return map.layerC[c[1] * W + c[0]]; }); 표.forEach(function (c) { map.layerC[c[1] * W + c[0]] = c[2]; }); }
    else if (!켬 && s.이동원) { 표.forEach(function (c, i) { map.layerC[c[1] * W + c[0]] = s.이동원[i]; }); s.이동원 = null; }
    else return;
    R.b.terrain = root.G2Native.mapTerrain(map);
  }

  /* ③ 실행기 apply 뒤에 그린다 — 기울기·회전이 있을 때만 */
  /* ★ 구조물 캐릭터(직업 161 대포·포대 · 162 성벽·성문·감옥문·감옥벽·요새입구 — SCE 전수) — 다른 캐릭터처럼 세우되 제자리에서 축대 기울기만큼 눕힌다
   *   (사장님 10-28 「문과 대포는 다른캐릭터와 동일한 방식으로 하고 축대 기울기에 맞춰 제위치에서 기울이는 걸로 처리해줘」 · 지형 데칼 방식은 되돌림) */
  var 구조직업 = { 161: 1, 162: 1 };
  function 구조물인가(u) { return !!(u && 구조직업[u.job | 0]); }

  function 갱신(R) {
    var s = R._리마스터3D;
    if (!s || !s.준비됨) return;
    var 켬 = !!((R.cam && (R.cam.tilt || R.cam.rot)) && !root.__리마스터3D끄기);
    if (R.host.classList.contains('g2-3d맵') !== 켬) R.host.classList.toggle('g2-3d맵', 켬);
    이동칸맞춤(R, s, 켬);   /* 3D 에서만 바꾸는 이동 칸 (SF 옆 계단) */
    /* 초필살기 «화면 0 칠»(render 맵가리기)이 켜진 동안은 3D 맵·가림판도 감춘 채 둔다 (2026-11-13) */
    s.캔버스.style.display = (켬 && !R._맵가림) ? '' : 'none';
    s.가림캔버스.style.display = (켬 && !R._맵가림) ? '' : 'none';
    if (!켬) { 유닛내리기(R); 표식내리기(R); 연출내리기(R); 커서내리기(R); 화면판풀기(R, s); return; }
    s.호 = null;
    var w = Math.max(1, R.host.clientWidth), h = Math.max(1, R.host.clientHeight);
    if (s.캔버스.width !== w || s.캔버스.height !== h) { s.장면.크기(w, h); s.가림.크기(w, h); }
    else s.장면.그리기();
    var _성0 = root.G2성능 ? performance.now() : 0;
    표식3D(R, s);
    if (_성0) root.G2성능.더하기('3D:표식3D', performance.now() - _성0);                              /* 장면 깊이가 남아 있을 때 — 범위 표식을 땅에 눕혀 그린다 */
    /* 가림판은 커서 층(overlay) 바로 앞(아래) — 유닛만 앞 건물·나무에 가리고 커서 박스는 늘 보인다 (10-24 · 맨 위 연출층도 안 가림) */
    var 뒤 = R.overlayLayer && R.overlayLayer.parentNode === R.host ? R.overlayLayer : null;
    /* (10-24) 커서 층 «아래»로 — 선택 박스는 건물에 안 가리고 늘 보인다 (사장님 「선택박스는 보여야하는데 박스도 가려져」) */
    if (뒤 && 뒤.previousSibling !== s.가림캔버스) R.host.insertBefore(s.가림캔버스, 뒤);
    현재돌 = (R.cam && R.cam.rot) || 0; 현재기울 = (R.cam && R.cam.tilt) || 0;
    /* [개발] 성능 그래프 세부(정본 400) — 꺼져 있으면 G2성능 이 없거나 재기만 하고 그리지 않는다 */
    var 성 = root.G2성능, 잰 = 성 ? performance.now() : 0, 잼 = function (키) { if (!성) return; var n = performance.now(); 성.더하기(키, n - 잰); 잰 = n; };
    s.사각 = 유닛띄우기(R, s);                 /* 점검용으로 남긴다 */
    잼('3D:유닛');
    R.host.querySelectorAll('.g2-unit').forEach(function (st) { if (st._3d본체) 파편무대맞추기(st); });
    잼('3D:파편');
    s.유닛사각수 = s.사각.length;              /* 가림다시() 가 유닛 상자만 갈아 끼운다 */
    표식띄우기(R, s);
    잼('3D:표식');
    연출띄우기(R, s);
    잼('3D:연출');
    try { 화면판맞추기(R, s); s.화면판오류 = null; } catch (e화면판) { s.화면판오류 = String(e화면판 && e화면판.stack || e화면판).slice(0, 300); }
    잼('3D:화면판');
    커서띄우기(R, s);
    잼('3D:커서');
    /* 가림판보다 아래 층(월드·월드 아래)의 맵 위 연출도 유닛처럼 — 앞 줄 건물·나무에 가린다 (맨 위 연출층은 가림판 위라 그대로) */
    연출자리(R, s).forEach(function (q) { s.사각.push(q); });
    잼('3D:연출자리');
    s.가림그린 = s.가림.가림그리기(s.사각);
    잼('3D:가림그림');
    /* 유닛 아래 화면 층(fxScreenUnderLayer — 문라이트 어두운 막 등)에 판이 있으면 가림판을 감춘다 (10-24)
     *   사장님 「문라이트에 타겟 캐릭터에 오브젝트가 같이 묶여서 그려지는 것도」 — 맵·오브젝트는 그 막 아래인데 가림판은 유닛 위라,
     *   가림판이 그린 앞 덤불·나무가 막을 안 받은 원래 색 네모로 유닛 위에 떴다 */
    var 아래막 = false, 막층 = R.fxScreenUnderLayer;
    if (막층) for (var mi = 0; mi < 막층.children.length && !아래막; mi++) { var me = 막층.children[mi]; if (me.offsetWidth && me.style.display !== 'none') 아래막 = true; }
    if ((s.가림캔버스.style.visibility === 'hidden') !== 아래막) s.가림캔버스.style.visibility = 아래막 ? 'hidden' : '';
    잼('3D:아래막');
    try { 색필터(R, s); } catch (e색) {}
    잼('3D:색필터');
  }

  /* ── 암전·팔레트 바꿈을 3D 맵에도 (10-19 사장님 「그리고 초필살기 암전이 적용이 안돼. 팔레트 스왑도 마찬가지일걸로 생각돼. 이부분도 처리해야해」) ──
   *   실행기는 ① CSS 밝기 암전(_css암전걸기 — 땅판·배경벽·맵 사물에만) ② 256색 섞기 필터(url(#g2-섞기)) ③ 바닥을 새 팔레트로 다시 칠하기(팔레트만갈기)
   *   로 맵 색을 바꾼다. 3D 맵(WebGL)은 구운 색 그림이라 셋 다 못 받았다.
   *   ⇒ ① 같은 밝기 필터를 3D 캔버스·가림판에 · ② 맵 층에만 걸린 섞기 필터면 3D 캔버스에도 · ③ 구울 때 팔레트 → 지금 맵 팔레트 를
   *     채널마다 «원래 값 → 바뀐 값» 표로 만들어 SVG 색 변환 필터로 (팔레트가 바뀔 때만 다시) */
  function 색필터(R, s) {
    var 줄 = [];
    var 지금팔 = (R.nmap && R.nmap.palette) || R._palette;
    if (지금팔 && s.바탕팔) {
      if (s.색팔기억 !== 지금팔) { s.색팔기억 = 지금팔; s.색팔같음 = 팔레트표만들기(s.바탕팔, 지금팔); }
      if (!s.색팔같음) 줄.push('url(#g2-3d팔레트)');
    }
    if (R._섞기필터켬 && !(R._섞기필터요소 || []).some(function (q) { return q.e === R.host || (q.e && q.e.contains && q.e.contains(s.캔버스)); })) 줄.push('url(#g2-섞기)');
    if (R._css암전) 줄.push(R._css암전);
    var f = 줄.join(' ');
    [s.캔버스, s.가림캔버스].forEach(function (c) { if (c && c.style.filter !== f) c.style.filter = f; });
  }
  /* 바탕 → 지금 팔레트를 채널마다 256칸 표로 (같은 원래 값의 바뀐 값 평균 · 빈 칸은 이웃 사이를 곧게) — 같으면 true */
  function 팔레트표만들기(바탕, 지금) {
    var n = Math.min(바탕.length, 지금.length), 같다 = true;
    for (var i = 0; i < n; i++) if (바탕[i] !== 지금[i]) { 같다 = false; break; }
    if (같다) return true;
    var d = root.document, NS = 'http://www.w3.org/2000/svg', flt = d.getElementById('g2-3d팔레트');
    if (!flt) {
      var svg = d.createElementNS(NS, 'svg'); svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
      svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
      flt = d.createElementNS(NS, 'filter'); flt.setAttribute('id', 'g2-3d팔레트'); flt.setAttribute('color-interpolation-filters', 'sRGB');
      var ct = d.createElementNS(NS, 'feComponentTransfer');
      ['R', 'G', 'B'].forEach(function (c) { var fn = d.createElementNS(NS, 'feFunc' + c); fn.setAttribute('id', 'g2-3d팔레트-' + c); fn.setAttribute('type', 'table'); ct.appendChild(fn); });
      flt.appendChild(ct); svg.appendChild(flt); (d.body || d.documentElement).appendChild(svg);
    }
    ['R', 'G', 'B'].forEach(function (c, k) {
      var 합 = new Float64Array(256), 수 = new Float64Array(256);
      for (var i = k; i < n; i += 3) { 합[바탕[i]] += 지금[i]; 수[바탕[i]]++; }
      var 표 = new Array(256), 앞 = -1;
      for (var v = 0; v < 256; v++) if (수[v]) 표[v] = 합[v] / 수[v];
      /* 빈 칸 — 양쪽 아는 값 사이를 곧게 · 끝은 같은 비율로 */
      var 아는 = []; for (v = 0; v < 256; v++) if (표[v] != null) 아는.push(v);
      if (!아는.length) { for (v = 0; v < 256; v++) 표[v] = v; }
      else for (v = 0; v < 256; v++) {
        if (표[v] != null) continue;
        var j = 0; while (j < 아는.length && 아는[j] < v) j++;
        var a = 아는[j - 1], b = 아는[j];
        if (a == null) 표[v] = 표[b] * (b ? v / b : 1);
        else if (b == null) 표[v] = 표[a] + (v - a) * (a ? 표[a] / a : 1);
        else 표[v] = 표[a] + (표[b] - 표[a]) * (v - a) / (b - a);
      }
      d.getElementById('g2-3d팔레트-' + c).setAttribute('tableValues', 표.map(function (x) { return Math.max(0, Math.min(1, x / 255)).toFixed(4); }).join(' '));
    });
    return false;
  }

  /* 유닛 상자를 지형 높이만큼 띄워 지면에 수직으로 세운다 — 실행기 _빌보드적용 이 매 장면 변환을 다시 쓰므로 그 뒤에 덮는다 */
  function 유닛띄우기(R, s) {
    var 사각 = [], 호 = R.host.getBoundingClientRect(), H = (s.장면.지정() || {}).H || 200;
    var 상자들 = R.unitEls || {};
    s.유닛표 = null;
    /* ★ 정본 400 — 쓰기(세우기)를 먼저 다 하고 읽기(그림사각 = getBoundingClientRect)를 모아서 한다
     *   ☠ 유닛마다 «세우기 → 읽기»를 번갈아 하면 읽을 때마다 브라우저가 레이아웃을 다시 계산한다(레이아웃 스래싱 · 유닛 36 이면 한 장에 36 번)
     *   에뮬레이터 3D 스크롤 프로파일: getBoundingClientRect 14.8% · 표시 23ms 중 3D 장면·가림 4ms 뿐 · 각 유닛 사각형은 제 변환에만 달려 결과는 같다 */
    var 세운 = [];
    for (var k0 in 상자들) {
      var box0 = 상자들[k0], u0 = box0 && box0._unit;
      if (!box0 || !u0 || box0.style.display === 'none') continue;
      var 닻0 = 유닛닻(R, s, box0);
      세우기(R, s, box0, 닻0);
      /* HUD(체력 숫자) — 그 유닛을 닻으로 (원본 화면에서 머리 위에 있던 자리가 그 유닛 발줄 위 높이가 된다) */
      var 값 = R.valueEls && R.valueEls[u0.id];
      if (값 && 값.style.display !== 'none') { 세우기(R, s, 값, 닻0); 값._3d유닛값 = true; }
      세운.push({ box: box0, u: u0, 닻: 닻0 });
    }
    for (var si = 0; si < 세운.length; si++) {
      var box = 세운[si].box, u = 세운[si].u, 닻 = 세운[si].닻;
      var r = 그림사각(box);
      if (r.width < 1 || r.height < 1) continue;
      var 줄 = Number.isFinite(box._row) ? box._row : (u.y | 0);
      /* 실행기 목록 D(절벽 위 유닛은 모든 줄 위 · 원본 규칙)는 3D 에서는 따르지 않고 선 칸의 줄로 가린다
       *   (2026-10-18 사장님 고르심 «3D 에서는 가림을 따름» — 기울기 0 원본 화면은 원본 규칙 그대로) */
      if (줄 > H + 1) 줄 = (u.y | 0);
      /* 초필살기·필살기 중인 시전자·대상은 가림판에 안 넣는다(맵 사물 위 · 감싸기 맵위 표시 · 2026-11-13) */
      if (연출유닛 && 연출유닛.맵위 && 연출유닛.indexOf(u) >= 0) continue;
      /* ★ 정본 402 — 바로 앞(남쪽) 칸이 «끊김 없이 이어진 오르막 비탈»이면 판을 그 칸 남쪽 끝까지 내민다 — 자기가 선 비탈이 몸을 덮지 않게
       *   (사장님 11-22 「북쪽이 낮은 축대의 경우 캐릭터가 자꾸 애매하게 잘려」 · 1-10 21~23열 25~28줄 비탈: 발키리 비룡의 큰 몸 아랫단이 앞 칸 오르막(56→69)에 곧게 잘림)
       *   절벽(경계에서 땅이 끊김)·걸을 수 없는 칸은 그대로 — 그 너머 벽·축대는 여전히 가린다 */
      var 이음 = 비탈이음(s, u.x | 0, u.y | 0) ? 1 : 0, 남끝 = (u.y | 0) * 16 + 16 + (u.oy | 0) + 이음 * 16;
      사각.push({ l: r.left - 호.left, t: r.top - 호.top, r: r.right - 호.left, b: r.bottom - 호.top, 줄: 줄, 발: { x: 닻.x, y: 닻.가림F != null ? 닻.가림F : 닻.F, h: 닻.높, 오y:닻.오끝, 앞: 닻.오끝 != null ? Math.max(0.01, 남끝 - 0.01 - (닻.가림F != null ? 닻.가림F : 닻.F)) : Math.max(0.5, Math.min(8 + 이음 * 16, 남끝 - 0.5 - (닻.가림F != null ? 닻.가림F : 닻.F))) } });   /* 앞 — 판을 카메라 쪽으로 8px 미는데 유닛 칸 남쪽 끝은 넘지 않게: 넘으면 바로 남쪽 바위 칸의 가장자리 테두리(칸 위 0~3px)가 판 뒤로 잡혀 머리를 못 덮었다 (사장님 10-27 「아직도 머리가 위로 튀어나와」 · 1-7 YOU01 22~26열 13줄 · 발 219 + 8 = 227 > 바위 칸 224) */
      /* ★ 정본 401 — 발밑 그림자는 «선 땅 높이에 눕힌 판»으로 따로 가린다 (사장님 11-22 「1-10 전투인데 비룡 그림자 잘리는거 심각하게 어색하고.」)
       *   ☠ 몸과 같은 세운 판(발줄)으로 가리면 발 아래로 내려간 그림자는 «땅 속»이 되어 앞 칸 맨땅이 덮었다 — 비룡처럼 그림자가 몸에서 멀리 아래인
       *     그림은 가는 띠 몇 줄만 남고 칸 경계에서 곧게 잘렸다(1-10 발키리 실측). 원작에서 그림자는 바닥에 깔리는 그림이다(0x1309D · 맵 그리기 몫)
       *   ⇒ 같은 높이 앞 땅은 그림자를 안 덮고, 앞에 솟은 벽·턱만 덮는다(눕힌 판 = 지정본그리기_가림판 발.눕 · 높이 = 선 땅 + 1) */
      var 그 = box._shd;
      if (그 && 그.style.display !== 'none') {
        var rs = 그.getBoundingClientRect();
        if (rs.width >= 1 && rs.height >= 1)
          사각.push({ l: rs.left - 호.left, t: rs.top - 호.top, r: rs.right - 호.left, b: rs.bottom - 호.top, 줄: 줄, 그림자: true,
                      발: { x: 닻.x, y: 닻.가림F != null ? 닻.가림F : 닻.F, h: 닻.높, 눕: true } });
      }
    }
    return 사각;
  }

  /* ══ 닻 — 세운 판이 «어느 발줄 위에 서나» (2026-10-19 전수 대조) ══════════════════════════════
   *   사장님 「연출 위치가 다르고(예를들면 검을 휘둘렀는데, 검광 위치가 다름), 캐릭터를 선택했는데, 커서와 박스 위치가 다름) …
   *   기존 2.5d와 3d 간 문제 생기지 않게 잘 적용해야해」 · 「마법, 필살기, 초필살기 이런것도 확인해야해 검광만이 아니야」
   *   ☠ 원인 — 실행기 그림은 «화면을 보는 판»이라 원본 화면의 세로 자리(밑동 줄 _ground)가 곧 화면 높이다. 지면에 수직으로 세우면
   *     그 밑동 줄이 «유닛 발보다 북쪽 땅»이 되어, 가슴 높이 검광·머리 위 체력 숫자가 유닛 뒤 땅에 섰다
   *     (04_도구/리마스터3D_연출대조.js 실측: 기울기 30·60·회전 25 에서 커서 0.2 · 체력 숫자 0.25~0.41 · 연출 최대 1.7 유닛 키)
   *   ⇒ 판마다 닻 = { F 발줄(맵 y) · x · 높 } 을 정해 «원본 화면에서 F 보다 위 n px = 닻 위 높이 n» 이 되게 변환을 직접 만든다.
   *     유닛 = 자기 발줄(실행기 회전축) · 체력 숫자·고른 커서 = 그 유닛 · 연출·피해 숫자 등 = 원본 배치에서 겹치는 유닛(없으면 자기 밑변) ·
   *     높이 기둥(_들림)은 자기 밑동 · 눕는 바닥 연출은 그대로 눕힌다 */
  function 원점값(v, 길이) {                    /* render.js 평면한요소 의 원점px 와 같은 풀이 */
    if (v == null || v === '' || v === 'center') return 길이 / 2;
    if (v === 'left' || v === 'top') return 0;
    if (v === 'right' || v === 'bottom') return 길이;
    if (/%$/.test(v)) return 길이 * parseFloat(v) / 100;
    return parseFloat(v) || 0;
  }
  /* 판의 실행기 배치 — CSS 자리(l·t · 여백 포함)와 회전 원점(px). 평면 대열이면 실행기가 정해 둔 --pl·--pt·--ox·--oy */
  function 원점(e) {
    var st = e.style, 판 = e.parentNode;
    /* CSS 크기가 없는 캔버스(피해 숫자 글자 등)는 자기 크기 속성 — offsetWidth 는 쓰기 직후 배치를 강제로 다시 계산해 숫자 12개 피격에 수백 ms (10-24) */
    var 캔 = e.tagName === 'CANVAS';
    var w = parseFloat(st.width) || (캔 ? e.width : 0) || e.offsetWidth || 0, h = parseFloat(st.height) || (캔 ? e.height : 0) || e.offsetHeight || 0;
    if (판 && 판._평면tf && e._평면ox != null) return { l: e._평면l, t: e._평면t, ox: e._평면ox, oy: e._평면oy, w: w, h: h };
    var 키 = st.transformOrigin + '|' + w + '|' + h + '|' + e.className;
    /* ☠ 감춰진(display:none) 판은 계산값이 px 가 아니라 «50% 100%» 로 온다 — % 를 px 로 읽어 체력 숫자 원점이 100px 아래로 갔다 (10-19 대조 · 유닛 키 2~5배 튐) */
    if (e._3d원점키 !== 키) { var o = (st.transformOrigin || getComputedStyle(e).transformOrigin || '50% 50%').split(/\s+/); e._3d원점 = [원점값(o[0], w), 원점값(o[1] == null ? '50%' : o[1], h)]; e._3d원점키 = 키; }
    return { l: (parseFloat(st.left) || 0) + (parseFloat(st.marginLeft) || 0), t: (parseFloat(st.top) || 0) + (parseFloat(st.marginTop) || 0),
             ox: e._3d원점[0], oy: e._3d원점[1], w: w, h: h };
  }
  /* 닻 { F, x (맵 픽셀) · 높 } 에 지면 수직으로 세운다 — 판 점 (px,py) → 세계 (닻.x + 판 위 가로, F, 높 + F − (t+py))
   *   국소 = translate3d(T) · rotateZ(−회전) · rotateX(−90°) 를 원점 o 둘레에 건다:
   *   d = l+ox − 닻x · e = F − t − oy  ⇒  T = ( d(cos r − 1) , e − d·sin r , 높 + e )  (r = 회전 · CSS rotateZ(−r)) */
  function 세우기(R, s, box, 닻) {
    if (평평한판(box.parentNode)) { 평평세우기(R, s, box, 닻); return; }
    var 면 = 구조물인가(box._unit) && box._unit && !box._3d유닛값 ? 구조면(R, s, box, 닻) : null;
    if (면) { 구조세우기(R, s, box, 닻, 면); return; }
    if (box._3d구조면) { box.style.clipPath = ''; box._3d구조면 = null; }
    var 돌 = (닻.돌 != null) ? 닻.돌 : 현재돌;   /* 닻.돌 — 카메라 대신 정한 방향으로 선 판(천지 3D 빛 벽 · 경계선 방향) */
    var o = 원점(box), r = 돌 * Math.PI / 180, k = 세로배율();
    var d = o.l + o.ox - (닻.x - R.mapW / 2), e = (닻.F - R.mapH / 2) - o.t - o.oy;
    /* 세로 보정 k — 판 위아래를 닻 발줄 둘레로 k 배 (scaleY 를 rotateX 앞에 · 높이 z = 높 + k·(F − y)) */
    var tf = 'translate3d(' + (d * (Math.cos(r) - 1)).toFixed(2) + 'px, ' + (e - d * Math.sin(r)).toFixed(2) + 'px, ' + ((닻.높 || 0) + k * e).toFixed(2) + 'px) rotateZ(' + (-돌) + 'deg) rotateX(-90deg)' + (k !== 1 ? ' scaleY(' + k.toFixed(4) + ')' : '');
    var 판 = box.parentNode;
    if (판 && 판._평면tf) { if (box.style.getPropertyValue('--loc') !== tf) box.style.setProperty('--loc', tf); }
    else if (box.style.transform !== tf) box.style.transform = tf;
    box._3d국 = tf; box._3d들림 = 닻.높 || 0; box._3d닻 = 닻;
    if (s.세운것) s.세운것.add(box);
    if (box._unit && 개발판()) 높이감시(R, s, box, 닻);
    그림자제자리(box);
  }
  /* ★ 구조물 판 — 축대 면 기울기 (2026-10-28)
   *   사장님 「문과 대포는 다른캐릭터와 동일한 방식으로 하고 축대 기울기에 맞춰 제위치에서 기울이는 걸로 처리해줘」
   *   원작 화면에서 문·대포 그림은 성벽(축대) 앞면 위에 그려져 있다 (18-1 실측: 성문 몸 658~743줄 = 성벽 윗끝 661 ~ 돌 끝 720 + 절벽 띠 23줄 ·
   *   대포 몸 183~207줄 = 성벽 앞면 166~224 안) ⇒ 그림 n 줄 위 = 맵 줄 F−n · 높이 = 그 면의 높이 (같은 면에 눕혀 기댄다 · 자리·크기는 원작 그대로)
   *   면 = THUND 는 성벽선(지정본그리기 THUND면 의 성벽 앞면 식 · 무너진 틈은 옆 성벽 기준 윗끝) · 다른 맵은 몸이 걸친 줄의 지형 높이를 곧은 면으로 맞춘다
   *   반환 { 기울: 한 줄 위로 갈 때 오르는 높이(px) · 발높: 발줄 F 의 면 높이 } · 기울지 않은 자리(평지)는 null → 다른 캐릭터처럼 곧게 */
  function 구조면(R, s, box, 닻) {
    var 지 = s.장면.지정 && s.장면.지정(); if (!지) return null;
    var o = 원점(box), 몸 = 몸배치(box), TW = 지.TW || 24, X = 닻.x, cx = Math.floor(X / TW), tx = Math.max(0, Math.min(TW - 1, Math.floor(X - cx * TW)));
    var T = o.t + R.mapH / 2 + 몸.t, F = 닻.F;
    if (!(F - T > 2)) return null;
    if (지.성벽선 && 지.맵 === 'THUND') {
      for (var i = 0; i < 지.성벽선.length; i++) {
        var w0 = 지.성벽선[i]; if (w0.x !== cx) continue;
        var w = w0.열별 ? w0.열별[tx] : w0, yt = w.무너짐 ? w.기준[tx] : Math.min(w.윗[tx], w.c0);
        if (!(w.c0 > yt) || T > w.c0 || F < yt) continue;   /* 몸이 이 성벽 앞면에 걸쳐야 */
        var 밑 = s.장면.높이(cx + 0.5, w.b0 + 4), 단 = w.아래 > 0 && 밑 > 0 ? 밑 / w.아래 : 50;   /* 단 = amp/2 (절벽 밑 높이 = 아래 단) */
        var 기 = (w.위 - w.띠위) * 단 / (w.c0 - yt);
        return { 기울: 기, 발높: w.띠위 * 단 + (w.c0 - F) * 기, 윗줄: yt };
      }
      return null;
    }
    /* 몸이 걸친 칸마다 곧은 면을 맞춰 가장 가파른 칸을 쓴다 — 문 자리 칸은 통로라 바닥 높이(평평)이고 벽 면은 옆 칸에 있다 (33-2 감옥문 27,53: 26·27열 비탈 · 28열 바닥) */
    var L0 = o.l + R.mapW / 2 + 몸.l, 최 = null;
    for (var c = Math.floor(L0 / TW); c <= Math.floor((L0 + 몸.w - 1) / TW); c++) {
      var n = 0, sy = 0, sz = 0, syy = 0, syz = 0, 앞z = null, 윗 = Infinity;
      for (var y = T; y <= F + 2; y += 2) {   /* 비탈 구간만 (이웃 표본과 높이가 다른 줄) — 윗면·바닥 평평한 줄을 섞으면 기울기가 묽어진다 */
        var z = s.장면.높이(c + 0.5, y) || 0, z2 = s.장면.높이(c + 0.5, y + 2) || 0;
        if (Math.abs(z - z2) > 0.3 || (앞z != null && Math.abs(앞z - z) > 0.3)) { n++; sy += y; sz += z; syy += y * y; syz += y * z; if (y < 윗) 윗 = y; }
        앞z = z;
      }
      var 분 = n * syy - sy * sy; if (n < 3 || !(분 > 0)) continue;
      var b = (n * syz - sy * sz) / 분, a = (sz - b * sy) / n;   /* z = a + b·y (b < 0 = 북쪽이 높다) */
      if (-b > 0.15 && (!최 || -b > 최.기울)) 최 = { 기울: -b, 발높: a + b * F, 윗줄: 윗 };
    }
    return 최;
  }
  /* 판 점 (qx,qy · 원점 기준) → 세계 (그 자리, 줄 그대로, 발높 + 기울·(F − 줄)) — 카메라 돌림(rotateZ)은 안 건다: 성벽 면은 맵에 붙어 있다 */
  function 구조세우기(R, s, box, 닻, 면) {
    var o = 원점(box), e = (닻.F - R.mapH / 2) - o.t - o.oy;
    var tf = 'translate3d(0px, 0px, ' + (면.발높 + 면.기울 * e).toFixed(2) + 'px) matrix3d(1,0,0,0, 0,1,' + (-면.기울).toFixed(4) + ',0, 0,0,1,0, 0,0,0,1)';
    var 판 = box.parentNode;
    if (판 && 판._평면tf) { if (box.style.getPropertyValue('--loc') !== tf) box.style.setProperty('--loc', tf); }
    else if (box.style.transform !== tf) box.style.transform = tf;
    /* 면 윗끝(윗줄) 위의 그림 줄 — 원작에선 성벽 윗단(평평한 윗면)에 그려진 줄이라 면을 따라 올리면 윗면 위로 턱이 솟는다 (9-6 감옥벽 · 33-2 감옥문) ⇒ 잘라 내고 윗면 지형 그림에 맡긴다 */
    var 자름 = 면.윗줄 - (o.t + R.mapH / 2), 클 = 자름 > 0.5 ? 'inset(' + 자름.toFixed(1) + 'px -400px -400px -400px)' : '';
    if (box.style.clipPath !== 클) box.style.clipPath = 클;
    box._3d국 = tf; box._3d들림 = 면.발높; box._3d닻 = 닻; box._3d구조면 = 면;
    if (s.세운것) s.세운것.add(box);
  }
  /* ── 유닛 그림자 — 몸과 같은 판에 둔다 (실행기 _빌보드적용 의 scaleY(cos 기울기) 그대로) ──
   *   10-24 사장님 「화상 효과 밑에 그림자가 어색하게 보이는 문제도 있고」·「상태이상과 그림자 어색한것도 고쳐야한다고」 (얼음·불꽃 사진 — 아랫단 체크무늬)
   *   ☠ 예전엔 세운 상자 안에서 그림자만 rotateX(90deg) 로 바닥에 눕혔다 — 서 있는 상태이상 판과 교차해 그림자 앞 절반이 상태이상 그림 아랫단 위로 그려졌다.
   *   ⇒ 몸과 같은 판(DOM 순서상 그림자가 첫 자식이라 늘 아래) · 화면 세로 = 그림자 높이 × cos × 세로배율 × sin = 2.5D 와 같다 */
  function 그림자제자리(box) {
    var 그 = box && box._shd; if (!그 || 그.style.transform !== 'rotateX(90deg)') return;
    var sy = Math.cos((현재기울 || 0) * Math.PI / 180); if (!(sy > 0.05)) sy = 0.05;
    그.style.transform = root.__그림자눕히기 ? '' : 'scaleY(' + (Math.round(sy * 1000) / 1000) + ')';
  }
  /* 평평한 층(땅판 안 fxUnderLayer — 세울 수 없다) 에서 «세운 판처럼 보이게» — 카메라에서 높이 z 는 땅 위 (−sin r, −cos r)·z·tan(기울기) 와
   *   같은 화면 점이다. 그래서 판을 땅에 rotateZ(−r)·세로 tan(기울기) 로 펼친다 (10-19 대조 마법 88·초필살기 4: 대상 위 판이 땅에 눕은 꼴로 70% 눌렸다)
   *   판 점 (px,py) → 땅점 = (닻x,F) + Rz(−r)·( l+px−닻x , (t+py−F)·T − 높·T )   (T = tan 기울기)
   *   국소 L = translate(V)·rotateZ(−r)·scaleY(T) 를 원점 o 둘레에:  V = (닻x,F) + Rz·(ox, oy·T) + Rz·(l−닻x, (t−F)·T − 높·T) − (l+ox, t+oy) */
  function 평평세우기(R, s, box, 닻) {
    var o = 원점(box), r = 현재돌 * Math.PI / 180, T0 = Math.tan(Math.max(0, Math.min(80, 현재기울)) * Math.PI / 180), T = T0 * 세로배율();
    var ax = 닻.x - R.mapW / 2, F = 닻.F - R.mapH / 2, 높 = 닻.높 || 0, c = Math.cos(r), sn = Math.sin(r);
    function Rz(a, b) { return [a * c + b * sn, -a * sn + b * c]; }
    var v1 = Rz(o.ox, o.oy * T), v2 = Rz(o.l - ax, (o.t - F) * T - 높 * T0);   /* 판 높이는 k 배(T) · 지형 높이는 그대로(T0) */
    var Vx = ax + v1[0] + v2[0] - (o.l + o.ox), Vy = F + v1[1] + v2[1] - (o.t + o.oy);
    var tf = 'translate(' + Vx.toFixed(2) + 'px, ' + Vy.toFixed(2) + 'px) rotateZ(' + (-현재돌) + 'deg) scaleY(' + T.toFixed(4) + ')' + (box._반전tf ? ' ' + box._반전tf : '');
    if (box.style.transform !== tf) box.style.transform = tf;
    box._3d국 = tf; box._3d들림 = 높; box._3d닻 = 닻;
    if (s.세운것) s.세운것.add(box);
  }
  /* ── 사망 파편 무대 (10-24 사장님 「캐릭터 사망연출도 좌표가 잘못되었어. 캐릭터는 중앙에서 도는데 터지는 파편은 아래쪽에서 터져」) ──
   *   render.js 사망파편무대열기 는 유닛 상자를 복제한 무대에 파편을 붙이고 원래 상자는 감춘다. 무대는 평면 변환(_평면한요소)만 받아
   *   3D 세우기(높이·지면 수직·세로 보정)가 빠졌다 → 파편이 2.5D 자리(땅 쪽 아래)에서 터졌다.
   *   ⇒ 원래 상자가 마지막으로 받은 3D 변환(_3d국)을 무대에 그대로 — 파편은 무대 안 국소 좌표라 유닛과 같은 판에 선다 */
  function 파편무대맞추기(st) {
    var b = st._3d본체; if (!b || !b._3d국) return;
    var 판 = st.parentNode;
    if (판 && 판._평면tf) { if (st.style.getPropertyValue('--loc') !== b._3d국) st.style.setProperty('--loc', b._3d국); }
    else if (st.style.transform !== b._3d국) st.style.transform = b._3d국;
  }
  /* 유닛 닻 — 실행기 회전축(그림 발줄)과 가로 원점 · 높이는 유닛 발 자리 지형 */
  function 유닛닻(R, s, box) {
    var u = box._unit, o = 원점(box);
    var 칸x = (u.x | 0) + 0.5 + ((u.ox | 0) / 24);
    var 길y = (u.y | 0) * 16 + 8 + (u.oy | 0);   /* 높이는 그림 발끝이 아니라 칸 가운데 길(+이동 밀림)에서 — 박쥐처럼 날개·그림자가 칸 아래로 내려오는 그림은 발끝이 남쪽 바위 칸에 닿아 2층으로 떴다 (사장님 10-27 「이런데는 위로 올라가는 범위가 더 넓고」·「박쥐는 … 비행유닛이 아니야」) */
    var F = o.t + o.oy + R.mapH / 2, 가F = Math.min(F, (u.y | 0) * 16 + 11 + (u.oy | 0));
    /* 정본 179 — 큰 몸(특수 본체 · 그림 300~ BCR 신·괴물)은 그림 발끝이 선 칸 아래(남쪽 칸)까지 내려오는 것이 원래 모습이다 — 칸 접지선으로 누르면 그 아래를 같은 높이 앞 땅이 덮어
     *   43-2 디에네 27px·라에비우스 8px·아스모데우스 걸음 프레임이 가로로 잘렸다 (2026-11-14 사장님 「신들과의 전투에서 아스모데우스를(이동중일떄) 비롯하여 디에네, 라에비우스 등 아랫단이 잘리는 캐릭터들이 있어」 · 3D 기울임).
     *   ⇒ 큰 몸은 실제 발끝(F)을 가림 줄로 — 더 높은 앞 지형·오브젝트는 깊이로 그대로 가린다. 박쥐 같은 일반 유닛은 위 제한 그대로 */
    if (root.Rules && typeof root.Rules.isSpecialBody === 'function' && root.Rules.isSpecialBody(u)) 가F = F;
    /* 같은 칸에 지면보다 높은 오브젝트층(바위 테두리 · 지면만 낮춘 칸)이 걸쳐 있으면 — 지형 판은 자기 칸 남쪽 끝(남쪽 바위가 가림) · 오브젝트층만 따로 «오브젝트가 북쪽으로 이어진 끝»(오끝)에 세운 판으로 가린다 (지정본그리기 지형가림 발.오y)
     *   (사장님 10-27 「북쪽으로 연결된 오브젝트 끝단을 기준으로 맞춰야」·「지면에는 잘 가리는데 오브젝트에 잘 안가려지는걸로 보여」 · ☠ 판 아래끝을 그대로 두니 판과 발 사이 같은 높이 바닥이 발을 덮어 «면을 뚫고 나오는» 꼴이었다 · ☠ 자기 칸 남쪽 끝에 판을 두니 자기 칸 오브젝트가 안 가렸다)
     *   (사장님 10-27 「아까 작업한 오브젝트만 올라가 있는 부분에서 그래 … 북쪽으로 연결된 오브젝트 끝단을 기준으로 맞춰야할 것 같아」) */
    var 지 = s.장면.지정 && s.장면.지정(), 오 = 지 && 지._오높;
    if (오) { var IW = 지.W * 지.TW, X = Math.max(0, Math.min(IW - 1, Math.round(o.l + o.ox + R.mapW / 2))), 땅 = 지.지형높이[(u.y | 0) * 지.W + (u.x | 0)], 높 = function (y) { var v = 오[(96 + y) * IW + X]; return v === v && v != null && v > 땅 + 0.5; };
      var 밑 = (u.y | 0) * 16 + 15 + (u.oy | 0), 끝 = null; for (var yy = 밑; yy >= (u.y | 0) * 16 + (u.oy | 0) && 끝 == null; yy--) if (높(yy)) { 끝 = yy; while (끝 > 0 && 높(끝 - 1)) 끝--; } }
    return { F: F, 가림F: 가F, 오끝: 오 && 끝 != null ? 끝 - 1 : null, x: o.l + o.ox + R.mapW / 2, 높: 걸음높이(s, u) };   /* 높이 — 서는 높이 표 + 걸음 잇기(정본 353 · 옛: 길 위 점 땅 s.장면.높이(칸x, 길y)) */   /* 가림F — 앞 지형 가림 판은 칸 접지선(칸 위 11px · 원본 13−2)을 넘지 않게: 그림 발끝이 남쪽 바위 칸 안에 들어가 바위가 판 뒤로 잡혀 유닛이 관통해 보였다 (사장님 10-27 「앞쪽 모양에 따라 가려져야하는데, 그렇지 않고 관통해서 나와」) */
  }
  /* 원본 배치(맵 픽셀)의 유닛 사각형 — 한 장면에 한 번 */
  function 유닛표(R, s) {
    if (s.유닛표 && s.유닛표틱 === s.틱) return s.유닛표;
    var 표 = [], 상자들 = R.unitEls || {};
    for (var k in 상자들) {
      var b = 상자들[k]; if (!b || !b._unit || b.style.display === 'none') continue;
      var o = 원점(b), 몸 = 몸배치(b);
      /* 겹침은 상자가 아니라 몸 그림으로 (상자 41×39 보다 몸이 작고 어긋나 있어 이웃 유닛 것으로 잘못 잡았다 · 10-19 대조) */
      표.push({ L: o.l + R.mapW / 2 + 몸.l, T: o.t + R.mapH / 2 + 몸.t, w: 몸.w, h: 몸.h, box: b, 닻: b._3d닻 || 유닛닻(R, s, b) });
    }
    s.유닛표 = 표; s.유닛표틱 = s.틱;
    return 표;
  }
  function 가운데높이(R, s, cx, cy) {
    var tx = Math.floor(cx / 24), ty = Math.floor(cy / 16), 상자들 = R.unitEls || {};
    for (var k in 상자들) {
      var b = 상자들[k], u = b && b._unit;
      if (!u || b.style.display === 'none' || (u.x | 0) !== tx || (u.y | 0) !== ty) continue;
      return 걸음높이(s, u);   /* 유닛닻과 같게 (정본 353) */
    }
    return s.장면.높이(cx / 24, cy) || 0;
  }
  /* 유닛 몸 그림의 상자 안 배치 사각형 — 그림자·지형효과 빼고 · offsetLeft/Top 이라 변환에 안 흔들린다 */
  function 몸배치(b) {
    var 안 = 몸층들(b, 'canvas, img'), l = 1e9, t = 1e9, r = -1e9, bb = -1e9;
    for (var i = 0; i < 안.length; i++) {
      var q = 안[i];
      if (q.closest('.g2-shadow') || q.closest('.g2-지형효과') || !q.offsetWidth || !q.offsetHeight) continue;
      var x = 0, y = 0, n = q;
      while (n && n !== b) { x += n.offsetLeft || 0; y += n.offsetTop || 0; n = n.offsetParent; }
      if (n !== b) continue;
      l = Math.min(l, x); t = Math.min(t, y); r = Math.max(r, x + q.offsetWidth); bb = Math.max(bb, y + q.offsetHeight);
    }
    if (!(r > l && bb > t)) { var o = 원점(b); return { l: 0, t: 0, w: o.w, h: o.h }; }
    return { l: l, t: t, w: r - l, h: bb - t };
  }
  function 자기닻(s, L, T, w, F) { var x = L + w / 2; return { F: F, x: x, 높: s.장면.높이(x / 24, F) || 0 }; }
  /* ── 지금 연출의 시전자·대상 — 닻 후보를 그 유닛들로 좁힌다 (10-19 대조: 둘레 알갱이가 구경꾼 유닛 쌍에 붙어 뜻 없는 자리가 됐다) ──
   *   감싸는 창구: 마법 재생(G2MagicFx.play) · 초필살기(G2Ultimate.play) · 필살기(__playSpecialFx) · 전투 연출 드라이버(평타·반격·마법·필살·스킬)
   *   연출이 겹치면 앞 값을 되돌리는 쌓기 · 문맥은 바꾸지 않는다(읽기만) */
  var 연출유닛 = null;
  function 감싸기(obj, 이름, 뽑기, 뷰포트판정, 맵위) {
    if (!obj || typeof obj[이름] !== 'function' || obj[이름].__3d감쌈) return;
    var 원 = obj[이름];
    var 새 = function () {
      var 목 = null; try { 목 = (뽑기.apply(null, arguments) || []).filter(function (u) { return u && u.id != null; }); } catch (e) {}
      /* ★ 초필살기·필살기 동안 시전자·대상은 맵 사물 «위»에 그려진다 — 원본은 화면 리맵 뒤 등록 대상(0x44DCC)·시전자(0x12F2A)를 다시 그린다
       *   (2026-11-13 · 사장님 11-12 「초필살기 연출중에 오브젝트가 시전자나 적 캐릭터를 가리지 않았던 것 같은데 지금은 가려져」)
       *   유닛띄우기 가 이 표시를 보고 그 유닛 사각을 가림판에 안 넣는다 → 앞 줄 건물·나무가 덮지 않는다. 평타·반격·마법은 원본대로 가린다. */
      if (목 && 목.length && 맵위) 목.맵위 = true;
      var 앞 = 연출유닛; if (목 && 목.length) 연출유닛 = 목;
      var 뷰 = false; try { 뷰 = !!(뷰포트판정 && 뷰포트판정.apply(null, arguments)); } catch (e) {}
      if (뷰) 뷰포트마법중++;
      var 뷰끝 = function () { if (뷰) { 뷰 = false; 뷰포트마법중 = Math.max(0, 뷰포트마법중 - 1); } };
      var r; try { r = 원.apply(this, arguments); } catch (x) { 연출유닛 = 앞; 뷰끝(); throw x; }
      /* 돌려받은 객체는 그대로 돌려준다(부르는 쪽이 다른 속성을 쓸 수 있다) — 끝나면 되돌리기만 옆에 건다 */
      if (r && typeof r.then === 'function') { var 끝 = function () { if (연출유닛 === 목 || !목 || !목.length) 연출유닛 = 앞; 뷰끝(); }; r.then(끝, 끝); return r; }
      연출유닛 = 앞; 뷰끝(); return r;
    };
    새.__3d감쌈 = true; 새.__원 = 원; obj[이름] = 새;
  }
  function 결과유닛(rep) { return rep ? ((rep.targets && rep.targets.length) ? rep.targets : (rep.results || []).map(function (x) { return x && x.unit; })) : []; }
  function 연출창구감싸기() {
    감싸기(root.G2MagicFx, 'play', function (c) { return c ? [c.actor].concat(c.targets || []) : []; }, 뷰포트마법인가);
    감싸기(root.G2Ultimate, 'play', function (n, c) { return c ? [c.actor].concat(c.targets || []) : []; }, null, true);
    감싸기(root, '__playSpecialFx', function (a, rep, 대상) { return [a, 대상].concat(결과유닛(rep)); }, null, true);
    var D = root.__연출드라이버;
    if (D) ['attack', 'counter', 'cast', 'special', 'skill'].forEach(function (k) {
      감싸기(D, k, function (p) { return p ? [p.actor].concat(p.targets || (p.intent && p.intent.targetUnits) || [], 결과유닛(p.report)) : []; });
    });
  }
  /* 지금 연출의 시전자·대상 중 화면에 보이는 것 — 장면(틱)마다 한 번 · 같은 차례 끝에 비운다 (10-24)
   *   ☠ 판마다 유닛 그림 사각형을 다시 읽어(getBoundingClientRect) 숫자 12개 피격 동안 6만 번 넘게 배치를 다시 계산했다
   *     (사장님 「지금 전체마법시 여러캐릭터가 데미지를 입을때(데미지 표시 연출이 나올때) 많이 느려지는 문제가 있어.」) */
  function 든연출유닛(s, 표) {
    var c = s.든캐시;
    if (!(c && c.틱 === s.틱 && c.목 === 연출유닛)) {
      var 보임 = new Set();
      표.forEach(function (u) { if (연출유닛.indexOf(u.box._unit) < 0) return; var q = 그림사각(u.box, true); if (q.width >= 1 && q.height >= 1 && isFinite(q.left)) 보임.add(u.box); });
      c = s.든캐시 = { 틱: s.틱, 목: 연출유닛, 보임: 보임 };
    }
    /* 유닛표는 다시 만들어질 수 있다 — 보이는 상자 묶음으로 지금 표에서 고른다 (배치 읽기 없음) */
    return 표.filter(function (u) { return c.보임.has(u.box); });
  }
  /* 연출·피해 숫자 등 — 원본 배치에서 가장 많이 겹치는 유닛 · 크기 없는 점이면 그 점을 품는 유닛(머리 위 조금까지) · 없으면 자기 밑변 */
  function 닻찾기(R, s, e) {
    var o = 원점(e), L = o.l + R.mapW / 2, T = o.t + R.mapH / 2, w = o.w, h = o.h;
    var 표 = 유닛표(R, s), 고른 = null, 최 = 0, 점 = w < 1 && h < 1, 반경 = 2;
    /* 연출 중이면 그 연출의 시전자·대상만 후보로 — 가까움 반경도 넓힌다(대상 둘레로 퍼지는 판) */
    if (연출유닛 && !점) {
      /* 화면에 안 보이는 유닛(초필살기 동안 감춘 시전자)은 뺀다 — 같은 세로줄의 대상 머리 위 판이 감춘 시전자 몸 자리와 겹쳐 시전자 판에 섰다 (10-19 대조 초필살기 13) */
      var 든 = 든연출유닛(s, 표);
      if (든.length) { 표 = 든; 반경 = 4; }
      /* ★ 연출 중 닻은 판 밑점과 시전자·대상 발 자리의 거리로 매끄럽게 섞는다 (10-24)
       *   사장님 「전격 4단계 3클 마법 번개 이펙트 연출이 이상해. 번개 줄기 아래에 동그란 구체가 붙어있어야 하는데, 중간에 구체가 다른 위치로 튀어」 ·
       *   「전격 3단계 3클 위치도 이상하게 옮겨져. 제위치가 아니라 이상하게 퍼지네」 · 「캐릭터 사망연출도 좌표가 잘못되었어. 캐릭터는 중앙에서 도는데 터지는 파편은 아래쪽에서 터져」
       *   ☠ 판마다 유닛 하나를 골랐더니(겹침 → 가까움 4배 → 사이 → 자기 밑변) 원본에서 붙어 있던 판이 서로 다른 유닛을 골라 3D 에서 떨어졌다
       *     (실측 마법 53: 줄기 161px 는 대상 몸과 겹쳐 대상 · 밑 구체는 시전자 → 줄기가 대상 쪽으로 가는 동안 구체만 시전자 쪽에 남음)
       *   ⇒ 원본 화면 자리에 대해 이어진 식 — 밑점(판 아래 가운데)과 유닛 발 자리(닻 x·F)의 거리 네제곱 역수 무게(+8px²)로 F·x·높을 섞는다.
       *     유닛 곁 판은 그 유닛 닻과 같고(거리 10 · 200 이면 99.6%) · 밑점이 같은 판은 같은 닻 · 유닛이 하나면 늘 그 유닛 */
      if (든.length) {
        var bx = L + w / 2, by = T + h, 합 = 0, F섞 = 0, X섞 = 0, 높섞 = 0, 곁 = null, 곁d = 1e18;
        for (var k = 0; k < 든.length; k++) {
          /* 무게 = 거리 네제곱 역수 — 제곱이면 시전자 곁 62px 판이 200px 떨어진 대상 무게를 9% 받아 상대 자리가 0.5 키 뒤틀렸다(10-24 대조 마법 50) · 네제곱이면 0.9% */
          var q = 든[k], ddx = bx - q.닻.x, ddy = by - q.닻.F, d2 = ddx * ddx + ddy * ddy, 무 = 1 / ((d2 + 64) * (d2 + 64));
          합 += 무; F섞 += 무 * q.닻.F; X섞 += 무 * q.닻.x; 높섞 += 무 * (q.닻.높 || 0);
          if (d2 < 곁d) { 곁d = d2; 곁 = q; }
        }
        return { F: F섞 / 합, x: X섞 / 합, 높: 높섞 / 합, 유닛: (곁 && 곁d < 곁.h * 곁.h) ? 곁.box : null };
      }
    }
    for (var i = 0; i < 표.length; i++) {
      var u = 표[i];
      if (점) {
        if (L >= u.L - 2 && L <= u.L + u.w + 2 && T >= u.T - 24 && T <= u.닻.F + 6) { var 가 = Math.abs(u.닻.F - T); if (!고른 || 가 < 최) { 고른 = u; 최 = 가; } }
        continue;
      }
      var ix = Math.min(L + w, u.L + u.w) - Math.max(L, u.L), iy = Math.min(T + h, u.T + u.h) - Math.max(T, u.T);
      if (ix > 0 && iy > 0 && ix * iy > 최) { 최 = ix * iy; 고른 = u; }
    }
    /* 겹치지 않으면 가까운 유닛 (유닛 키 2배 안 · 가운데끼리 거리) — 시전자 옆에 생기는 불덩이·옆 섬광도 그 유닛 판에 (10-19 대조: 자기 밑변이면 0.3~0.5 어긋남) */
    if (!고른 && !점) {
      var 거 = 1e9, cx = L + w / 2, cy = T + h / 2;
      for (var j = 0; j < 표.length; j++) {
        var v = 표[j], dd = Math.hypot(cx - (v.L + v.w / 2), cy - (v.T + v.h / 2));
        if (dd < 반경 * v.h && dd < 거) { 거 = dd; 고른 = v; }
      }
    }
    if (고른) return { F: 고른.닻.F, x: 고른.닻.x, 높: 고른.닻.높, 유닛: 고른.box };
    /* 두 유닛 사이를 나는 것(투사체) — 가까운 유닛 6 중 두 유닛을 잇는 선 위(선에서 유닛 키 1.5배 안)면 두 닻을 가로 위치로 섞는다.
     *   자기 밑변으로 세우면 그 아래 땅(골짜기·절벽) 높이를 따라 출렁였다 (10-19 · 홀로 판 대부분이 2~7 유닛 키 거리의 투사체) */
    if (!점 && 표.length >= 2) {
      var ex = L + w / 2, ey = T + h / 2;
      var 가까 = 표.map(function (u) { return { u: u, d: Math.hypot(ex - (u.L + u.w / 2), ey - (u.T + u.h / 2)) }; })
        .sort(function (a, b) { return a.d - b.d; }).slice(0, 6);
      /* 연출 중(시전자·대상만 후보)이면 선 폭도 가까움과 같은 반경 4 — 화살 꼬리 알갱이가 선에서 키 1.5~3배 흩어져 자기 밑변(땅)으로 떨어졌다
       *   (10-19 대조 마법 6·7·8·48~50·66~68: 몸 키 22px · 알갱이 선 거리 21~78px → 원본 흩어짐이 3D 에서 선 위로 모임) */
      var 쌍 = null, 최선 = 1e9, 폭 = 반경 > 2 ? 반경 : 1.5;
      for (var a = 0; a < 가까.length; a++) for (var b2 = a + 1; b2 < 가까.length; b2++) {
        var A = 가까[a].u, B = 가까[b2].u, ax = A.L + A.w / 2, ay = A.T + A.h / 2, bx = B.L + B.w / 2, by = B.T + B.h / 2;
        var vx = bx - ax, vy = by - ay, 길 = vx * vx + vy * vy; if (길 < 1) continue;
        var tt = ((ex - ax) * vx + (ey - ay) * vy) / 길; if (tt < 0 || tt > 1) continue;
        var 수 = Math.abs((ex - ax) * vy - (ey - ay) * vx) / Math.sqrt(길);
        if (수 < 폭 * Math.max(A.h, B.h) && 수 < 최선) { 최선 = 수; 쌍 = { A: A, B: B, t: tt }; }
      }
      if (쌍) {
        var t2 = 쌍.t, FA = 쌍.A.닻, FB = 쌍.B.닻;
        return { F: FA.F + (FB.F - FA.F) * t2, x: ex, 높: FA.높 + (FB.높 - FA.높) * t2 };
      }
    }
    /* 높이 기둥(_들림)은 유닛에 안 붙을 때만 실행기가 정한 밑동으로 — 밑동(기준y)이 유닛 발이 아니라 몸 한가운데 줄이라
     *   먼저 밑동을 쓰면 그 북쪽 땅에 서서 시전자 머리 위 기둥이 유닛 키 0.5 낮게·대상 밑 판이 낮은 칸으로 떨어졌다 (10-19 대조 마법 5·12) */
    if (e._들림) return 자기닻(s, L, T, w, T + h + e._들림);
    return 자기닻(s, L, T, w, T + h);
  }
  /* 유닛 자리 — 상자가 아니라 안의 보이는 그림(캔버스·그림자·지형효과)을 합친 사각형
   *   (10-18 실측: 상자 219×96 · 그림 44×34 — 상자 빈 테두리가 이웃 유닛 자리와 겹쳐 앞 지형 가림을 막았다) */
  /* 상자 안 그림 요소 + 몸 층(div) — 발광(원소 2단계 뒤 단색 실루엣 · render.js 유닛층그리기)은 몸 캔버스를 감추고 층 div 배경으로 그린다 (2026-10-28)
   *   ☠ canvas·img 만 세면 발광 동안 몸이 빠진 사각(그림자·지형효과·상자 전체)으로 가림판 자리를 잡아 경계에서 잘리고 엉뚱한 모양이 났다
   *   (사장님 「원소계열 2단계 마법 사용할떄, 연출후 캐릭터가 색깔로 덮히는 부분이 화면 경계에서 캐릭터가 가려질때 잘못처리되는 문제가 있어. 잘린경계선에 잘린 부분이 생기기도하고, 다른 오브젝트 모양으로 나오기도 해.」) */
  function 몸층들(box, 고르개) {
    var 목 = Array.prototype.slice.call(box.querySelectorAll(고르개)), L = box._layers || [];
    for (var i = 0; i < L.length; i++) { var e = L[i] && L[i].el; if (e && e.style.display !== 'none' && 목.indexOf(e) < 0) 목.push(e); }
    return 목;
  }
  function 그림사각(box, 몸만) {
    /* 발밑 지형 효과(눈·물 · 배경 그림 div)와 그림자 div 도 — canvas·img 만 모으면 몸 아래로 내려온 효과 띠가 가림판 자리에서 빠져
     *   둑 뒤 유닛의 발밑 눈 띠만 둑 앞으로 삐져나왔다 (10-20 LFT01 · 몸 바닥 737 · 효과 바닥 748) */
    /* (10-24) 턴 마커(.g2-ready)·상태 그림(.g2-ail·.g2-ailfx)도 — 배경 그림 div 라 빠져, 건물 뒤에서 마커만 지붕 위로 비쳤다 (사장님 「턴 돌아왔다는 ai 마커를 포함해서 … 힐끗힐끗 비쳐보여」) */
    /* (10-29) 집중 이펙트(.g2-charfx · render.js charMarks — 몸 뒤 z −1 배경 그림)도 — 빠져 몸 바깥으로 퍼진 불꽃이 건물 가림을 뚫고 보였다 (사장님 「건물 가림 관련해서 집중 이펙트가 가림을 뚫고 보여. 캐릭터는 가려지는데. 안보여야 할 것 같아.」) */
    var 안 = 몸층들(box, 'canvas, img, .g2-지형효과, .g2-shadow, .g2-ready, .g2-ail, .g2-ailfx, .g2-charfx'), l = Infinity, t = Infinity, rr = -Infinity, bb = -Infinity;
    for (var i = 0; i < 안.length; i++) {
      if (몸만 && (안[i].closest('.g2-shadow') || 안[i].closest('.g2-지형효과'))) continue;
      var q = 안[i].getBoundingClientRect();
      if (q.width < 1 || q.height < 1) continue;
      if (q.left < l) l = q.left; if (q.top < t) t = q.top; if (q.right > rr) rr = q.right; if (q.bottom > bb) bb = q.bottom;
    }
    if (!(rr > l && bb > t)) return box.getBoundingClientRect();
    return { left: l, top: t, right: rr, bottom: bb, width: rr - l, height: bb - t };
  }
  /* 높이 h 만큼 세계 z 로 띄운다.
   *   ① 평면 대열(기울기 · spriteLayer 가 세계판 밖 판) — 요소 변환은 고정 틀 «세계(--w) · 제자리 · 원점 둘레 국소(--loc)» 이다.
   *      --w 뒤로는 평행 이동뿐이라 --loc 맨 앞의 translateZ 는 세계 좌표의 위다. 실행기 값(_평면loc)은 건드리지 않는다
   *   ② 평면 대열 끔(세계판 안) — 실행기 국소 변환(_빌보드원문) 앞에 붙인다 */
  /* 수직 — 지면에 수직으로 세우고 화면 쪽으로 돌기만 한다: rotateZ(−회전)·rotateX(−90°) (나무와 같다)
   *   (10-18 사장님 「캐릭터도 완전 수직이아니라 지면에 수직으로 세워야하려나봐. 어차피 90도 각도를 만들지는 못하게 할거라 기울기에 따라 건물에 파묻히네」)
   *   ☠ 실행기 빌보드는 화면 정면(기울기·회전의 역 전체)이라 기울기 90° 가 아니면 윗부분이 뒤로 눕는다
   *   수직이 아니면(false) 실행기 국소 변환 그대로 + 들어 올림만 */
  var 현재돌 = 0, 현재기울 = 0;
  /* ── 세로 보정 (10-19 사장님 「지금 캐릭터가 지면에 수직으로 세워지면서 상대적으로 납작하게 눌려보이는 문제가 있어. 기울어진 각도에 따라
   *   세로 길이를 삼각함수 값으로 곱하는 방식으로 보정을 조금 할 수 있지 않을까?」 · 고르심 «슬라이더로 하되 기본값은 완전 보정» · «유닛 쪽 먼저») ──
   *   수직 판은 화면 세로가 sin(기울기) 배로 준다 → k = 1 + (1/sin − 1)·보정%  (100% = 원본 키 · 0% = 지면 수직 그대로)
   *   기울기 10도 아래는 10도로 센다(그 밑에서는 1/sin 이 너무 커진다) · 유닛·체력 숫자·커서·연출·보물(실행기 화면 요소)에 같은 k */
  var 세로보정 = 100;
  try { var _세 = root.localStorage.getItem('리마스터3D세로보정'); if (_세 != null && +_세 >= 0 && +_세 <= 100) 세로보정 = +_세; } catch (e) {}
  function 세로배율() {
    var t = Math.max(10, Math.min(89, 현재기울 || 0)) * Math.PI / 180;
    return 1 + (1 / Math.sin(t) - 1) * 세로보정 / 100;
  }
  /* 평평하게 합치는 층(transform-style: flat · 평면 대열 아님 — 땅판 안 fxUnderLayer 등) — 그 안의 판은 translateZ 가 땅판에 눌려 높이가 사라진다
   *   (10-19 대조 마법 5: 대상 밑 마법진이 높이 50 을 받고도 땅바닥에 그려졌다) */
  function 평평한판(판) {
    if (!판 || 판._평면tf || !판.isConnected) return false;
    if (판._3d평평 == null) 판._3d평평 = getComputedStyle(판).transformStyle === 'flat';
    return 판._3d평평;
  }
  /* 높이 h 를 땅 위 자리 옮기기로 — 높이 h 인 점은 화면에서 (−h·tan기울기·sin회전, −h·tan기울기·cos회전) 옮긴 땅점과 겹친다 (카메라 높이 맞추기와 같은 식) */
  function 땅옮김(높) {
    var k = 높 * Math.tan(Math.max(-80, Math.min(80, 현재기울)) * Math.PI / 180), r = 현재돌 * Math.PI / 180;
    return 'translate(' + (-k * Math.sin(r)).toFixed(2) + 'px, ' + (-k * Math.cos(r)).toFixed(2) + 'px)';
  }
  function 띄우기(box, 높, 수직) {
    var 판 = box.parentNode, 들 = 높 ? 'translateZ(' + 높.toFixed(2) + 'px) ' : '';
    if (높 && 평평한판(판)) { 들 = 땅옮김(높) + ' '; 수직 = false; }
    if (판 && 판._평면tf) {
      var 새 = 수직 ? 들 + 'rotateZ(' + (-현재돌) + 'deg) rotateX(-90deg)' : 들 + (box._평면loc || 'translate(0px, 0px)');
      if (box._3d국 !== 새 || box.style.getPropertyValue('--loc') !== 새) { box.style.setProperty('--loc', 새); box._3d국 = 새; }
    } else {
      var 원 = box._빌보드원문 != null ? box._빌보드원문 : '';
      var tf = 수직 ? 들 + 'rotateZ(' + (-현재돌) + 'deg) rotateX(-90deg)' : 들 + (원 && 원 !== 'none' ? 원 : '');
      if (box.style.transform !== tf) box.style.transform = tf;
      box._3d국 = 수직 ? tf : null;
    }
    box._3d들림 = 높;
    if (수직) 그림자제자리(box);
  }
  /* ── 범위 표식(리맵 바닥)을 3D 지형 위에 — 그리기 모듈 표식그리기 (10-19 사장님 「현재 이동 타겟 범위 하이라이트가 경사면에 제대로 적용이 안되어서
   *   단차마다 끊어져서 표현되는데, 경사면에 맞게 눕혀서 잘 표시되어야해. 그리고 지금은 하이라이트 표시 및 커서 박스 선택시 꽤 느려지는 문제가 있어서 이부분도 해결하면 좋겠어」)
   *   그림 = 실행기 _범위리맵바닥 (바닥을 원본 리맵 표로 칠한 그림 · 스타일 규칙과 같은 것) · 칸 = markLayer 의 리맵 표식 자리
   *   그린 동안 DOM 리맵 표식은 감춘다(g2-3d표식) — 리맵 그림이 없으면(반투명 표식) 예전대로 DOM 을 띄운다 */
  function 표식3D(R, s) {
    var 켬 = false, 기다림 = false;   /* 기다림 — 첫 범위 리맵판을 읽는 중: 그동안도 평면 표식을 감춘다(링을 열 때 첫 화면에 평면 칸이 한 번 비쳤다) */
    try {
      var url = R._범위리맵URL, L = R.markLayer, 칸 = [];
      if (url && L && L.children.length && s.장면.표식그리기 && R._floorW && R._floorH) {
        if (!s.표식그림 || s.표식그림._url !== url) { if (s.표식그림 && s.표식그림.complete && s.표식그림.naturalWidth) s.표식그림옛 = s.표식그림;
          /* 정본 336 — 실행기가 미리 만들어 읽어 둔 그림(R._범위미리)이 같은 주소면 그것을 쓴다(3MB 그림 해독을 «이동» 누를 때 하지 않게) */
          var 미리 = R._범위리맵그림; if (미리 && 미리._url === url) { s.표식그림 = 미리; if (!(미리.complete && 미리.naturalWidth)) 미리.addEventListener('load', function () { if (R.apply) R.apply(); }); } else {
          var im = new Image(); im._url = url; im.onload = function () { if (R.apply) R.apply(); }; im.onerror = function () { im._오류 = true; if (R.apply) R.apply(); }; im.src = url; s.표식그림 = im; } }
        /* 새 그림(팔레트가 바뀌어 다시 만든 범위 리맵판)이 다 읽히기 전에는 옛 그림으로 그린다 — 그 사이 3D 표식이 꺼지면 감춰 둔 평면(2D) 표식이 드러나, 땅 높이를 안 받는 평면 자리(캐릭터 남쪽)에 회색 칸이 깜빡였다 (11-05 사장님 [그림] 「링커맨드시 공격 가능 범위 영역이 뒤에 애매하게 깜빡거려」·「남쪽에도 깜빡거리는게 문제야」) */
        var 쓸그림 = (s.표식그림.complete && s.표식그림.naturalWidth) ? s.표식그림 : (s.표식그림옛 && s.표식그림옛.complete && s.표식그림옛.naturalWidth ? s.표식그림옛 : null);
        if (쓸그림) {
          var 자식 = L.children;
          for (var k = 0; k < 자식.length; k++) {
            var e = 자식[k]; if (!e.classList.contains('g2-범위리맵')) continue;
            var x = Math.round((parseFloat(e.style.left) + R.mapW / 2) / 24), y = Math.round((parseFloat(e.style.top) + R.mapH / 2) / 16);
            if (Number.isFinite(x) && Number.isFinite(y)) 칸.push(x + ',' + y);
          }
          켬 = s.장면.표식그리기(칸, 쓸그림, R._floorW, R._floorH) > 0;
        } else if (!s.표식그림._오류) 기다림 = true;
      }
    } catch (e표식) { s.표식오류 = String(e표식 && e표식.message || e표식); 켬 = false; }
    s.표식GL = 켬;
    var 표식서명 = 켬 ? 칸.join(';') : '';   /* 정본 375 — 그린 범위 칸이 바뀌면 번호를 올린다(가림판이 옛 장면을 옮겨 칠하지 않게) */
    if (s.표식서명 !== 표식서명) { s.표식서명 = 표식서명; s.표식번호 = (s.표식번호 | 0) + 1; }
    var 감춤 = 켬 || 기다림, 없음 = !감춤 && !!(R._범위리맵URL && R.markLayer && R.markLayer.children.length);   /* 없음 = 범위가 있는데 3D 로 못 그림 */
    if (R.host.classList.contains('g2-3d표식') !== 감춤) R.host.classList.toggle('g2-3d표식', 감춤);
    if (R.host.classList.contains('g2-3d표식없음') !== 없음) R.host.classList.toggle('g2-3d표식없음', 없음);
  }
  /* 범위 표식·위 표식·보물 상자 — 칸 가운데 높이만큼 (표식은 다시 만들어지면 새 요소라 한 번만 셈) */
  /* ★ 서는 높이 — 칸마다 유닛이 서는 높이 하나 (정본 353 · 사장님 11-21)
   *   「절벽 북쪽에 낮은 지대일때 … 절벽에 가려지고 낮은지대에 있어야하는데 갑자기 절벽위로 올라가는게 문제」
   *   「말이 절벽이지. 북쪽이 높이가 낮은 모든 곳을 말하는거야」·「축대로 연결되지 않고 바로 인접타일 높이가 변하는 곳」
   *   ⇒ 걸을 칸의 북쪽 이웃이 걸을 칸이고 칠 높이가 더 낮으며 둘 다 축대 띠(빗면)가 아니면 → 북쪽 이웃 높이에 선다(남쪽 높은 땅에 가린다)
   *   칠 높이끼리만 견주므로 남쪽으로 번지지 않는다(경계 첫 줄만) — 축대로 이어진 빗면은 그대로 땅을 따라 오른다
   *   측정(11-21 · 3D 전투 맵 142): «북쪽 낮고 남쪽 높은» 뜀 432곳 */
  function 서는표(s) {
    if (s._서는표 && s._서는표수 === s.높이수) return s._서는표;
    var 지 = s.장면.지정 && s.장면.지정(), 표 = null;
    if (지 && 지.갈수 && 지.지형높이) {
      var W = 지.W, H = 지.H, g = 지.갈수, h = 지.지형높이, 띠 = {}, i, x, y;
      (지.축대구간 || []).forEach(function (q) { if (q.위 > q.아래) for (var yy = q.y0; yy <= q.y1; yy++) 띠[yy * W + q.x] = 1; });
      표 = new Float32Array(W * H);
      for (y = 0; y < H; y++) for (x = 0; x < W; x++) { i = y * W + x; 표[i] = s.장면.높이(x + 0.5, y * 16 + 8) || 0; }
      /* 덮이는 줄 수 = 높이 차 × 2.5D 한 단 화소(지정._단px · 축대 띠로 잰 값) ÷ 16 — 높은 땅 윗면 그림이 그만큼 북쪽으로 밀려 그려져 뒤 낮은 땅을 덮는다
       *   (LFT02 51→52줄: 단px 64 = 4줄 · 52·53(4)·54(3.75) 걸을 칸이 윗면 그림에 덮인 뒤 땅 · 55~57 못 가는 앞면 · 첫 줄만 낮추니 경계가 한 줄 남쪽으로 옮겨 갔을 뿐이었다) */
      var 단px = Number.isFinite(지._단px) && 지._단px > 0 ? 지._단px : 16;
      for (y = 1; y < H; y++) for (x = 0; x < W; x++) { i = y * W + x; var n = i - W;
        /* 반 층(지형높이 0.5) 넘게 차이 날 때만 — 한 줄에 0.25 씩 칠로 만든 완만한 비탈(IM03 16열 21~24줄)은 «바로 바뀌는 곳»이 아니다 */
        if (!(g[i] && g[n] && !띠[i] && !띠[n] && h[n] <= h[i] - 0.5)) continue;
        var 밑 = s.장면.높이(x + 0.5, (y - 1) * 16 + 8) || 0, 줄수 = Math.ceil((h[i] - h[n]) * 단px / 16);
        /* ★ 정본 402·403 — «바로 바뀌는 곳»만: 두 칸 경계에서 땅이 실제로 끊기는지(경계 바로 위·아래 높이 차가 두 칸 가운데 높이 차의 절반을 넘나) 본다
         *   ☠ 칠 높이 0.5 씩 오르는 매끈한 비탈(2-4A 15열 29~31줄 · 2.0→2.5→3.0 · 땅 101→149 이 끊김 없이 이어짐 · 경계 위아래 차 약 2)도 «반 층 이상»에 걸려
         *     칸마다 한 칸 북쪽 높이로 내려앉았다(30줄: 땅 125 인데 108 에 섬 · 31줄: 141.7 인데 125) — 사장님 11-22 「점점 바닥으로 파묻히는 것 같다」·「북쪽이 낮은 축대의 경우 캐릭터가 자꾸 애매하게 잘려」
         *   ⇒ 땅이 이어지는 비탈이면 땅을 따라 선다 · 경계에서 뚝 끊기는 절벽은 그대로 낮은 쪽에 서서 남쪽 높은 땅에 가린다(11-21 규칙) */
        var 가운데차 = (s.장면.높이(x + 0.5, y * 16 + 8) || 0) - 밑, 경계차 = (s.장면.높이(x + 0.5, y * 16 + 1) || 0) - (s.장면.높이(x + 0.5, y * 16 - 1) || 0);
        if (가운데차 > 0 && 경계차 < 가운데차 * 0.5) continue;
        for (var j = 0; j < 줄수 && y + j < H; j++) { var k = i + j * W; if (!g[k] || 띠[k] || h[k] <= h[n] + 0.01) break; 표[k] = Math.min(표[k], 밑); } }
      표 = { W: W, H: H, 높: 표, 갈수: g };
    }
    s._서는표 = 표; s._서는표수 = s.높이수; return 표;
  }
  /* 정본 402 — (x, y+1) 이 걸을 칸이고, 두 칸 경계에서 땅이 끊기지 않고(경계 위·아래 차가 두 칸 가운데 차의 절반 아래) 남쪽이 더 높은 비탈인가 */
  function 비탈이음(s, x, y) {
    var 지 = s.장면.지정 && s.장면.지정(); if (!지 || !지.갈수) return false;
    if (y + 1 >= 지.H || !지.갈수[(y + 1) * 지.W + x]) return false;
    var 가운데차 = (s.장면.높이(x + 0.5, (y + 1) * 16 + 8) || 0) - (s.장면.높이(x + 0.5, y * 16 + 8) || 0);
    if (!(가운데차 > 1)) return false;
    var 경계차 = (s.장면.높이(x + 0.5, (y + 1) * 16 + 1) || 0) - (s.장면.높이(x + 0.5, (y + 1) * 16 - 1) || 0);
    return 경계차 < 가운데차 * 0.5;
  }
  function 칸높이(s, x, y) { var 표 = 서는표(s); if (표 && x >= 0 && y >= 0 && x < 표.W && y < 표.H) return 표.높[y * 표.W + x]; return s.장면.높이(x + 0.5, y * 16 + 8) || 0; }
  /* ★ 높이 감시 — 개발판(브라우저 · 앱·휴대폰 아님)에서만 · 유닛 높이가 한 번 갱신되는 사이에 반 층 넘게 뛰면 그 순간을 기록한다 (정본 353)
   *   사장님 11-22 「전투는 내가 가도 테스트가 힘들어」·「어차피 pc에서 사용해도 부하는 걸릴테니」·「저상태에서 문제 생겼을때 자동으로 기록하게해」
   *   · 남기는 곳: 브라우저 저장소 'G2가림높이감시'(최근 200 · 새로고침해도 남음) + 콘솔 경고(F8 버그 신고에 실림) · 꺼내기 G2가림높이감시.기록() · 비우기 .비우기()
   *   · 두 칸 넘게 옮긴 것(순간이동·배치)·높이 설정을 바꾼 직후는 뺀다 */
  var 개발판값 = null;
  function 개발판() {
    if (개발판값 == null) { var 물 = ''; try { 물 = decodeURIComponent(String(location.search || '')); } catch (e) { 물 = String(location.search || ''); } 개발판값 = !root.G2앱 && !/[?&]모바일=1/.test(물); }
    return 개발판값;
  }
  var 감시키 = 'G2가림높이감시';
  function 감시남기기(줄) {
    var 목 = []; try { 목 = JSON.parse(root.localStorage.getItem(감시키) || '[]') || []; } catch (e) { 목 = []; }
    목.push(줄); if (목.length > 200) 목.splice(0, 목.length - 200);
    try { root.localStorage.setItem(감시키, JSON.stringify(목)); } catch (e) { }
    try { console.warn('[가림높이 감시] ' + JSON.stringify(줄)); } catch (e) { }
  }
  function 높이감시(R, s, box, 닻) {
    var u = box._unit, h = +닻.높 || 0, x = u.x | 0, y = u.y | 0, 앞 = box._감시;
    box._감시 = { h: h, x: x, y: y, 수: s.높이수 };
    if (!앞 || 앞.수 !== s.높이수 || Math.abs(앞.x - x) + Math.abs(앞.y - y) > 1) return;
    var 한층 = (s.높이 || 100) / 2;
    if (Math.abs(h - 앞.h) <= 한층 / 2) return;
    var 둘레 = {}; [[0, 0], [0, -1], [0, 1], [-1, 0], [1, 0]].forEach(function (d) { 둘레[d[0] + ',' + d[1]] = Math.round(s.장면.높이(x + d[0] + 0.5, (y + d[1]) * 16 + 8) || 0); });
    감시남기기({ 때: new Date().toISOString(), 맵: s.이름, 시나리오: (function () { try { return new URLSearchParams(location.search).get('sce'); } catch (e) { return null; } })(), 유닛: String(u.name || '').trim(), 편: u.side,
      칸: [x, y], 앞칸: [앞.x, 앞.y], 밀림: [u.ox | 0, u.oy | 0], 높이: [Math.round(앞.h), Math.round(h)], 서는: Math.round(칸높이(s, x, y)), 장면둘레: 둘레,
      기울기: 현재기울, 회전: 현재돌 });
  }
  root.G2가림높이감시 = { 기록: function () { try { return JSON.parse(root.localStorage.getItem(감시키) || '[]'); } catch (e) { return []; } }, 비우기: function () { try { root.localStorage.removeItem(감시키); } catch (e) { } } };
  /* 걸음 높이 — 길 위 점의 땅을 그때그때 재지 않고, 지금 칸과 밀린 쪽 이웃 칸의 서는 높이를 밀린 만큼 잇는다
   *   (칸 경계 턱·절벽 면에서 한 층씩 확 뛰던 것 · 사장님 11-21 「보통 이동할때 그렇게 튀는것 같으니까」) · 이웃이 못 가는 칸이면 지금 칸 높이 */
  function 걸음높이(s, u) {
    var x = u.x | 0, y = u.y | 0, ox = (u.ox | 0) / 24, oy = (u.oy | 0) / 16, h = 칸높이(s, x, y), 표 = 서는표(s);
    var 이웃 = function (nx, ny) { return 표 && nx >= 0 && ny >= 0 && nx < 표.W && ny < 표.H && 표.갈수[ny * 표.W + nx]; };
    if (ox) { var nx = x + (ox > 0 ? 1 : -1), tx = Math.min(1, Math.abs(ox)); if (이웃(nx, y)) h += (칸높이(s, nx, y) - h) * tx; }
    if (oy) { var ny = y + (oy > 0 ? 1 : -1), ty = Math.min(1, Math.abs(oy)); if (이웃(x, ny)) h += (칸높이(s, x, ny) - h) * ty; }
    return h;
  }
  function 표식띄우기(R, s) {
    var 층들 = [R.markLayer, R._표식위층];
    /* 위 표식(addMarkTop · 눕힌 오브젝트가 덮은 칸)은 3D 에서 감춘다(위 스타일 규칙 .g2-mark-top) — 감춘 요소의 가림 상자를 세지 않는다
     *   (11-10 사장님 「한조 심 사용시(하이라이트 나올시) 심하게 버벅거려」 — SFT04 실측: 덮인 칸 1928 → 요소마다 getBoundingClientRect 가
     *    강제 레이아웃 · refresh 한 번 374ms(그중 357ms 가 이것) → 빼면 23ms) */
    var 위표식감춤 = R.host.classList.contains('g2-3d맵') && !R.host.classList.contains('g2-3d표식없음');
    for (var i = 0; i < 층들.length; i++) {
      var L = 층들[i]; if (!L) continue;
      if (위표식감춤 && L === R._표식위층) continue;
      var 자식 = L.children;
      for (var k = 0; k < 자식.length; k++) {
        var e = 자식[k];
        if ((s.표식GL || 위표식감춤) && e.classList.contains('g2-범위리맵')) continue;   /* WebGL 로 그렸다(또는 첫 리맵판을 읽는 동안 감춰 둔 상태) — 띄우기·가림 계산 안 함
                                                                                           *   (11-10 실측: 리맵판을 읽는 첫 refresh 에 3510 칸 전부 getBoundingClientRect → 4.9초 멈춤) */
        if (e._3d높 == null || e._3d수 !== s.높이수) {
          var x = Math.round((parseFloat(e.style.left) + R.mapW / 2) / 24), y = Math.round((parseFloat(e.style.top) + R.mapH / 2) / 16);
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (e._3d높 == null) e._3d원tf = e.style.transform || '';
          var 높 = 칸높이(s, x, y);
          e._3d높 = 높; e._3d수 = s.높이수; e._3d줄 = y;
          e.style.transform = (높 ? 'translateZ(' + 높.toFixed(2) + 'px) ' : '') + e._3d원tf;
        }
        가림자리(R, s, e, e._3d줄, { x: (parseFloat(e.style.left) + R.mapW / 2) + 12, y: e._3d줄 * 16 + 8, h: e._3d높, 눕: true });   /* 앞 줄 건물·나무·지형에 가린다 */
      }
    }
    var 보물 = R._itemEls || {};
    for (var key in 보물) {
      var it = 보물[key];
      if (!it || it._칸x == null) continue;
      if (it._3d수 !== s.높이수) { it._3d국 = null; it._3d수 = s.높이수; }
      var 보높 = 칸높이(s, it._칸x, it._칸y);
      if (it._billboardMode === 'floor') 띄우기(it, 보높, false);
      else { var 보o = 원점(it); 세우기(R, s, it, { F: 보o.t + 보o.h + R.mapH / 2, x: 보o.l + 보o.w / 2 + R.mapW / 2, 높: 보높 }); }   /* 자기 밑변에 선다 */
      가림자리(R, s, it, it._칸y, { x: it._칸x * 24 + 12, y: it._칸y * 16 + 8, h: 보높, 눕: it._billboardMode === 'floor' });
    }
  }
  function 표식내리기(R) {
    [R.markLayer, R._표식위층].forEach(function (L) {
      if (!L) return;
      Array.prototype.forEach.call(L.children, function (e) {
        if (e._3d높 == null) return;
        e.style.transform = e._3d원tf || ''; e._3d높 = null;
      });
    });
    var 보물 = R._itemEls || {};
    for (var key in 보물) { var it = 보물[key]; if (it && (it._3d들림 || it._3d국)) 띄우기(it, 0); }
  }

  /* 가림판 자리 하나 더하기 — 화면 사각형 + 줄 */
  /*   발 = { x, y (맵 픽셀), h (높이), 눕 } — 있으면 앞 지형(언덕·절벽)에도 가린다 (10-18) */
  function 가림자리(R, s, e, 줄, 발) {
    if (!e || e.style.display === 'none' || !Number.isFinite(줄)) return;
    var r = e.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    var 호 = s.호 || (s.호 = R.host.getBoundingClientRect());
    s.사각.push({ l: r.left - 호.left, t: r.top - 호.top, r: r.right - 호.left, b: r.bottom - 호.top, 줄: 줄, 발: 발 || null });
  }
  /* 눕힌 커서의 가림 높이 — 칸 안에서 가장 높은 곳 (2026-10-28)
   *   사장님 [그림] 「타일 선택 박스에 표시가 이상해. 커서박스가 생기면 위쪽 하이라이트가 사라진다고 해야하나?」
   *   ☠ 가림판은 눕힌 것을 «그 높이의 수평판»으로 보고 그보다 가까운(높은) 지형을 덮어 그린다 — 칸 가운데 높이를 넘기니
   *     비탈 칸 북쪽 절반(더 높다)이 «앞 지형»으로 잡혀 하이라이트 없는 맨땅으로 덮였다 (18-1 20,31: 북 129 · 가운데 125 · 남 121) */
  function 칸최고(s, x, y, 기본) {
    var 높 = 기본 || 0, 점 = [[0.5, 1], [0.5, 15], [0.05, 8], [0.95, 8], [0.05, 1], [0.95, 1]];
    for (var i = 0; i < 점.length; i++) { var h = s.장면.높이(x + 점[i][0], y * 16 + 점[i][1]) || 0; if (h > 높) 높 = h; }
    return 높;
  }
  /* 커서 박스(선택 상자 · 빌보드 밑동 _ground)와 이동 목적지 네모(눕힘 · left/top) */
  function 커서띄우기(R, s) {
    (R.boxEls || []).forEach(function (b) {
      if (!b || b.style.display === 'none') return;
      if (b._ground == null) {                       /* 빈 칸 커서 — 바닥에 눕힌 상자(left/top · transform none) */
        var bw = parseFloat(b.style.width) || 24, bh = parseFloat(b.style.height) || 16;
        var cx = Math.floor((parseFloat(b.style.left) + bw / 2 + R.mapW / 2) / 24), cy = Math.floor((parseFloat(b.style.top) + bh / 2 + R.mapH / 2) / 16);
        if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
        var 높0 = 칸높이(s, cx, cy), tf0 = 높0 ? 'translateZ(' + 높0.toFixed(2) + 'px)' : 'none';
        if (b.style.transform !== tf0) b.style.transform = tf0;
        b._3d눕커서 = true;
        가림자리(R, s, b, cy, { x: cx * 24 + 12, y: cy * 16 + 8, h: 칸최고(s, cx, cy, 높0), 눕: true });
        return;
      }
      if (b._left == null) return;
      var 닻 = 커서닻(R, s, b);
      세우기(R, s, b, 닻);
      가림자리(R, s, b, Math.floor((닻.F - 1) / 16), { x: 닻.x, y: 닻.F, h: 닻.높 });
    });
    var f = R.facingBoxEl;
    if (f && f.style.display !== 'none') {
      var x = Math.floor((parseFloat(f.style.left) + 1 + R.mapW / 2) / 24), y = Math.floor((parseFloat(f.style.top) + 1 + R.mapH / 2) / 16);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        var 높 = 칸높이(s, x, y), tf = 높 ? 'translateZ(' + 높.toFixed(2) + 'px)' : 'none';
        if (f.style.transform !== tf) f.style.transform = tf;
        f._3d커서 = true;
        가림자리(R, s, f, y, { x: x * 24 + 12, y: y * 16 + 8, h: 칸최고(s, x, y, 높), 눕: true });
      }
    }
  }
  function 커서내리기(R) {
    (R.boxEls || []).forEach(function (b) {
      if (!b) return;
      if (b._3d눕커서) { if (b._ground == null) b.style.transform = 'none'; b._3d눕커서 = false; }
      else if (b._3d들림 || b._3d국) 띄우기(b, 0);
    });
    if (R.facingBoxEl && R.facingBoxEl._3d커서) { R.facingBoxEl.style.transform = 'none'; R.facingBoxEl._3d커서 = false; }
  }

  /* 고른 유닛 커서 — 그 유닛 · 다른 상자(대상 고르기 등)는 원본 배치에서 겹치는 유닛 */
  function 커서닻(R, s, b) {
    var 대 = R.boxTarget, 대상 = b === R.boxEl && 대 && 대.id != null && R.unitEls && R.unitEls[대.id];
    if (대상 && 대상.style.display !== 'none') return 대상._3d닻 || 유닛닻(R, s, 대상);
    return 닻찾기(R, s, b);
  }
  /* 세우지 않는 판 — 맵 사물(3D 에서는 감춤)·지형 미리보기 */
  function 안세움(e) {
    var c = e.classList;
    return !c || c.contains('g2-map-object-strip') || c.contains('g2-map-tree-composite') || e._terrainPreviewAnchor;
  }
  /* 한 요소만 그 자리에서 — 갱신 의 규칙과 같다 (실행기가 판을 놓을 때마다 · 어느 층이든) */
  /* ★ 걷는 동안 가림판 — 유닛이 apply 밖에서 옮겨지면(걸음 틱) 가림판은 옛 자리를 덮고 있어 새 자리 유닛이 앞 건물 지붕 위로 비쳤다.
   *   걸음이 끝난 뒤 apply 가 없으면 멈춘 뒤에도 그대로 비쳤다 (사장님 10-24 그릭 「지붕쪽에 계속 비친다고」·「움직일때 주로 비치는 경우가 많고 안움직일때에도 특정 위치에서는 비쳐」)
   *   ⇒ 같은 차례 끝에 한 번 — 유닛 상자만 다시 재고(표식·커서·연출 상자는 그대로) 가림판을 다시 그린다 */
  function 가림다시(R, s) {
    if (s.가림예약) return;
    /* (10-24) 한 화면에 한 번만 바로 — 같은 화면에서 또 오면 다음 rAF 에 한 번으로 모은다
     *   (사장님 「지금 전체마법시 여러캐릭터가 데미지를 입을때(데미지 표시 연출이 나올때) 많이 느려지는 문제가 있어.」 — 피격 밀림 고리 12개가
     *    걸음마다 따로 불러 «유닛 전부 다시 재기 + 가림판 다시 그리기»가 한 화면에 12번 · 실측 숫자 12개 1.7초에 화면 1~4장)
     *   걷기는 한 화면에 한 걸음이라 바로 그리는 것이 그대로다 */
    if (s.가림이번틀) {
      if (!s.가림틀예약 && root.requestAnimationFrame) { s.가림틀예약 = true; root.requestAnimationFrame(function () { s.가림틀예약 = false; s.가림이번틀 = false; 가림다시(R, s); }); }
      return;
    }
    s.가림이번틀 = true;
    var 틀풀기 = function () { if (!s.가림틀예약) s.가림이번틀 = false; };
    if (root.requestAnimationFrame) root.requestAnimationFrame(틀풀기); setTimeout(틀풀기, 34);
    s.가림예약 = true;
    /* (10-24) 다음 화면(rAF)으로 미루니 걸음마다 한 화면 늦어 이동 중간에 살짝 비쳤다 (사장님 「아직도 이동 중간에 살짝 비쳐보이는 곳이 있어」)
     *   ⇒ 같은 차례 끝(마이크로태스크) — 이 틱의 유닛 옮김이 다 끝난 뒤, 화면에 그려지기 전에 한 번 */
    Promise.resolve().then(function () {
      s.가림예약 = false;
      try {
        if (!s.준비됨 || !R.host.classList.contains('g2-3d맵') || !s.가림) return;
        var 나머지 = (s.사각 || []).slice(s.유닛사각수 || 0), 새 = 유닛띄우기(R, s);
        s.유닛사각수 = 새.length; s.사각 = 새.concat(나머지);
        s.가림그린 = s.가림.가림그리기(s.사각);
      } catch (x) {}
    });
  }
  function 즉시띄우기(R, s, e) {
    현재돌 = (R.cam && R.cam.rot) || 0; 현재기울 = (R.cam && R.cam.tilt) || 0;
    if (e._unit && R.unitEls && R.unitEls[e._unit.id] === e) { 세우기(R, s, e, 유닛닻(R, s, e)); if (!s.apply중) 가림다시(R, s); return; }
    if (e === R._probeEl) {                              /* screenOfRendered 의 재는 점 — 재는 유닛을 닻으로 (HUD 캔버스 숫자가 3D 자리를 따른다) */
      var 잼 = s.재는유닛 && R.unitEls && R.unitEls[s.재는유닛.id];
      if (잼) 세우기(R, s, e, 잼._3d닻 || 유닛닻(R, s, 잼));
      return;
    }
    if (e._ground == null || 안세움(e)) return;
    if ((R.boxEls || []).indexOf(e) >= 0 || e === R.boxEl) { if (e._left != null) 세우기(R, s, e, 커서닻(R, s, e)); return; }
    if (e.classList.contains('g2-unit-value')) {
      for (var id in (R.valueEls || {})) if (R.valueEls[id] === e) { var 주 = R.unitEls && R.unitEls[id]; if (주) { 세우기(R, s, e, 주._3d닻 || 유닛닻(R, s, 주)); e._3d유닛값 = true; } return; }
      return;
    }
    if (e._3d주인) {                                      /* 피해 숫자 — 주인 유닛 닻 (hitNumber 감쌈) */
      var 숫주 = R.unitEls && R.unitEls[e._3d주인.id];
      if (숫주) { 세우기(R, s, e, 숫주._3d닻 || 유닛닻(R, s, 숫주)); e._3d연출 = true; if (s.세운것) s.세운것.add(e); return; }
    }
    if (e._칸x != null && R._itemEls) {
      var 보높 = 칸높이(s, e._칸x, e._칸y);
      if (e._billboardMode === 'floor') 띄우기(e, 보높, false);
      else { var 보o = 원점(e); 세우기(R, s, e, { F: 보o.t + 보o.h + R.mapH / 2, x: 보o.l + 보o.w / 2 + R.mapW / 2, 높: 보높 }); }
      return;
    }
    if (e._left != null) 연출하나(R, s, e);
  }
  /* 연출·피해 숫자·상태 아이콘 등 하나 — 눕는 바닥 연출은 자기 자리 높이만큼 띄워 눕히고, 나머지는 닻에 세운다 */
  /* ★ 칸에 붙은 연출 판(magicfx 항목 «칸» → e._3d칸 · 화염3 파이어필드·월·플라즈마존 등 rain) — 시전자·대상 닻과 섞지 않고 그 칸 발줄에 선다 (2026-10-28)
   *   사장님 「용자의무덤 마지막층에서 적이 파이어월을 쓰는데 화면에 표시되는 모습이 이상했어.」·「평지 지형인데 왜 저렇게 보이는지 모르겠어」
   *   ☠ 실측(TOMB33 · 223.MAP): 착지 불꽃 밑변 156·172(칸 9·10 줄 = 칸y×16+12)인데 닻찾기 가 시전자·대상 발줄과 섞어 F 132~155 에 세워,
   *     밑변 아래 몸이 땅속으로 들어가 가림판이 칸마다 바닥으로 곧게 잘랐다(가로 띠) · 떨어지는 불덩이도 같은 칸 발줄 위 높이로 */
  function 칸닻(R, s, e) {
    var o = 원점(e), 칸 = e._3d칸, x = o.l + o.w / 2 + R.mapW / 2;
    if (!칸) { var F = +e._ground; return { F: F, x: x, 높: s.장면.높이(x / 24, F - 4) || 0, 줄: Math.floor((F - 1) / 16) }; }   /* 발밑 판 — 제 밑변(_ground) · 높이는 밑변 바로 위 땅 */
    return { F: 칸.y * 16 + 12, x: x, 높: 칸높이(s, 칸.x, 칸.y), 줄: 칸.y | 0 };
  }
  function 연출하나(R, s, e) {
    if (e.style.translate || e.style.scale) { e.style.translate = ''; e.style.scale = ''; }   /* 화면판에서 재활용돼 온 판 */
    if (e._billboardMode === 'floor') {
      /* 눕는 바닥 연출(마법진 등) — 기준 유닛이 있으면 그 유닛 높이로 눕힌다
       *   (10-19 전수 대조 마법 5: 자기 자리 땅 높이로 띄우니 절벽 위 대상 밑 마법진이 절벽 앞 낮은 땅으로 떨어졌다 · 유닛 키 2배 아래) */
      var 닻 = 닻찾기(R, s, e);
      if (e._3d수 !== s.높이수) { e._3d국 = null; e._3d수 = s.높이수; }
      띄우기(e, 닻.유닛 ? 닻.높 : (닻.높 || 0), false);
      e._3d닻 = null;
    } else if (e._3d닻고정) {
      /* 천지 3D 빛기둥(ultimate.js 천지빛3D세우기) — 원본 빛띠의 파편 경계 밑점(맵 XY)에 지면 수직으로 · 높이 = 그 점 땅 (2026-10-28) */
      var 고 = e._3d닻고정;
      세우기(R, s, e, { F: 고.F, x: 고.x, 높: s.장면.높이(고.x / 24, 고.F) || 0, 돌: 고.돌 });
      /* 땅에 붙은 판 — 연출 층은 화면 흔들림을 빼고 그리지만(render fxTopLayer) 이 판은 땅과 함께 흔들려야 한다 (사장님 10-28 「흔들리는거 같다고 해야하나...」 — 땅만 흔들려 기둥이 땅 위에서 떨렸다) */
      var 흔 = R.shake || {};
      if ((흔.x | 0) || (흔.y | 0)) {
        var 흔tf = 'translate3d(' + (흔.x | 0) + 'px, ' + (흔.y | 0) + 'px, 0px) ' + e._3d국, 흔판 = e.parentNode;
        if (흔판 && 흔판._평면tf) e.style.setProperty('--loc', 흔tf); else e.style.transform = 흔tf;
      }
      if (e._3d원z !== undefined) { e.style.zIndex = e._3d원z; e._3d원z = undefined; }
    } else if (e._3d칸 || (e._3d발밑 && Number.isFinite(+e._ground) && 연출유닛)) {
      var 칸d = 칸닻(R, s, e); 세우기(R, s, e, 칸d);
      /* 3D 겹침 — 연출 층은 평평한 층(넣은 차례대로 그린다)이라 원본 화면처럼 뒤 줄 불꽃 밑동이 앞 줄 위로 보였다
       *   (사장님 「기울기 적용되었을때도 잘 적용되어야해. 기울기0과 동일하면 안되는데」) ⇒ 칸 줄이 남쪽일수록 위 · 같은 줄은 넣은 차례 · 3D 끌 때 되돌림(연출내리기) */
      if (e._3d원z === undefined) e._3d원z = e.style.zIndex;
      var 칸z = String(1000 + (칸d.줄 | 0));
      if (e.style.zIndex !== 칸z) e.style.zIndex = 칸z;
    } else {
      if (e._3d원z !== undefined) { e.style.zIndex = e._3d원z; e._3d원z = undefined; }   /* 칸 판으로 쓰이다 다른 판으로 재활용됨 */
      세우기(R, s, e, 닻찾기(R, s, e));
    }
    e._3d연출 = true;
    if (s.세운것) s.세운것.add(e);
  }

  /* ── 화면판 연출 — 원본 320×200 화면 좌표 층(fxScreenLayer·fxScreenUnderLayer)과 카메라 판(fxCamPlane·fxCamPlaneUnder) ──
   *   (10-19 전수 대조: 마법 15~20·27~29·36~40·60~64·75~81 · 초필살기 4·12·13 이 유닛 키 1~9배 어긋남 — 이 층은 화면 좌표라
   *    유닛이 기울기·높이로 화면에서 옮겨 그려져도 따라가지 않는다 · 2.5D 기울인 화면에서도 같았던 갈래)
   *   ⇒ 연출 중이면 작은 판마다 원본 화면 좌표에서 시전자·대상 중 기준 유닛(겹침 → 가까움 4배 → 둘 사이)을 골라,
   *     그 유닛이 지금 화면에 그려진 자리에 대해 같은 상대 자리가 되게 CSS translate 로 옮긴다(크기는 그대로 · 화면 덮는 큰 판은 안 건드림) */
  function 화면판층(R) { return [R.fxScreenLayer, R.fxScreenUnderLayer, R.fxCamPlane, R.fxCamPlaneUnder].filter(Boolean); }
  /* ★ 뷰포트 마법 — 재생되는 동안 화면판맞추기 를 하지 않는다 (3D 전에 맞춰 둔 그대로: 화면에 고정 · 배율 무관)
   *   10-24 사장님 「3D 적용하면서 뷰포트에 그려져야 하는 마법들이 위치가 옮겨졌는지 배율 적용이 되는 문제가 있어」 ·
   *   「니가 적용하기 전에 기껏 맞춰서 세팅해놨었는데, 그거 제대로 다시 확인하라고」 · 「아마게돈은 해당 없어」 · 「아토믹 아니라고!」
   *   3D 전 설정 = magicfx SPEC `화면고정: true` — Z-77(9-26 「프로미넌스, 화염과 빙한 6단계, 빙한 3단계, 전격 7단계」 · 「암흑7 아니야」)
   *     · Z-82 스타티어러 → randomBurst 15~17 · prominence 20 · drift 27~29 · blizzard 36~38 · starfall 39~40 · gigaThunder 60~62
   *     + 문라이트 41 (SPEC 이 아니라 판마다 좌표층 '뷰포트' · magicfx playMoonlight 문라이트아래층/빛층/위층)
   *   (화룡·빙룡은 G2MagicFx.play 를 안 거쳐 연출유닛 이 없어 원래 안 옮겨진다 · 아토믹블라스트 공은 판에만 화면고정 이라 대상 아님) */
  var 뷰포트마법중 = 0;
  function 뷰포트마법인가(c) {
    try { var M = root.G2MagicFx, sp = c && M && M.specOf ? M.specOf(c.series, c.level, c.rank) : null; return !!(sp && (sp.화면고정 === true || sp.유형 === 'moonlight')); } catch (e) { return false; }
  }
  function 화면판풀기(R, s) {
    if (!s || !s.화면판) return;
    s.화면판.forEach(function (e) { if (e.style.translate) e.style.translate = ''; if (e.style.scale) e.style.scale = ''; });
    s.화면판.clear();
  }
  function 화면판맞추기(R, s) {
    if (!s.화면판) s.화면판 = new Set();
    var 든 = 연출유닛 ? 연출유닛.filter(function (u) { return R.unitEls && R.unitEls[u.id] && R.unitEls[u.id].style.display !== 'none'; }) : [];
    var 판들 = [];
    화면판층(R).forEach(function (L) {
      var 모두 = L.querySelectorAll('*');
      for (var i = 0; i < 모두.length; i++) {
        var e = 모두[i]; if (e.children.length) continue;
        /* 그림 판 — 인라인 배경·캔버스·그림 · 클래스로 배경을 받는 판도 (10-19 대조 마법 27) */
        if (e._화면고정) continue;   /* 화면 전체에 뿌린 조각(폭풍검 메가썬더) — 옮기지 않는다 · 남은 옮김은 아래에서 지운다 (11-09) */
        if (e.style.backgroundImage || e.tagName === 'CANVAS' || e.tagName === 'IMG' || (e.className && getComputedStyle(e).backgroundImage !== 'none')) 판들.push({ e: e, L: L });
      }
    });
    판들.forEach(function (p) { if (p.e.style.translate) p.e.style.translate = ''; if (p.e.style.scale) p.e.style.scale = ''; });
    /* 재활용으로 화면판 층을 떠난 판 — 붙였던 옮김·크기를 지운다 (10-19 대조 마법 15: 맵 위 연출 층으로 옮겨진 판에 남아 엉뚱하게 옮겨졌다) */
    s.화면판.forEach(function (e) { if (e.style.translate) e.style.translate = ''; if (e.style.scale) e.style.scale = ''; });
    s.화면판.clear();
    if (뷰포트마법중 > 0) return;                /* 뷰포트 마법 — 화면에 그대로 (위 뷰포트마법인가) */
    if (!든.length || !판들.length) return;
    var 배 = R.화면배율 ? R.화면배율() : { s: 1, ox: 0, oy: 0 }, 호 = R.host.getBoundingClientRect();
    var 옮 = s.옮 || { x: 0, y: 0 }, v = R._vcam || R.cam, 왼 = (v.cx - 옮.x) - 160, 위 = (v.cy - 옮.y) - 100;   /* 원본 화면 왼위(맵 픽셀) — 높이 밀림 뺀 논리 카메라 */
    var 표 = 유닛표(R, s), 유 = [];
    든.forEach(function (u) {
      var t = 표.filter(function (q) { return q.box._unit === u; })[0]; if (!t) return;
      var r3 = 그림사각(t.box, true), w = Math.max(1, t.w), h = Math.max(1, t.h);   /* 몸만 — 3D 에서 그림자는 바닥에 눕혀 아래끝이 내려간다 */
      if (!(r3.width >= 1 && r3.height >= 1 && isFinite(r3.left))) return;      /* 화면에 안 보이는 유닛(초필살기 동안 감춘 시전자) — 기준에서 뺀다 (10-19) */
      유.push({ 유닛: u, cx: t.L - 왼 + w / 2, b: t.T - 위 + h, w: w, h: h, X: (r3.left + r3.right) / 2, Y: r3.bottom, sx: r3.width / w, sy: r3.height / h });   /* 원본 논리 가운데·발 · 지금 화면 · 배율 */
    });
    if (!유.length) return;
    /* 원본 논리점 → 지금 화면점·배율 — 가까운 두 유닛(시전자·대상)을 잇는 선 위 자리 t 로 두 유닛 기준을 매끄럽게 섞는다
     *   (유닛 근처 = 그 유닛 기준 · 사이 = 섞임 · 바깥 = 가까운 끝) — 그림마다 한 유닛으로 끊으면 가로가 1.3배 벌어졌다 (10-19 대조) */
    /* ★ 모든 연출 유닛에 거리 제곱 역수 무게로 섞는다 (10-24 사장님 「선라이트 열쇠돌아가는 위치도 안맞고 갑자기 튀어」)
     *   ☠ 예전엔 «가장 가까운 두 유닛» 을 잇는 선 위 t 로 섞어, 대상이 여럿이면 움직이는 판의 가까운 두 유닛이 바뀌는 순간 기준이 끊겨 튀었다.
     *   몸 한가운데 점 기준(발 점이면 대상 몸 한가운데 판이 시전자 쪽으로 섞였다 · 10-19 시험판) · 유닛 곁이면 그 유닛 기준과 같다 */
    function 사상(lx, ly) {
      function 한(u) { return { x: u.X + (lx - u.cx) * u.sx, y: u.Y + (ly - u.b) * u.sy, sx: u.sx, sy: u.sy }; }
      if (유.length === 1) return 한(유[0]);
      var 합 = 0, x = 0, y = 0, sx = 0, sy = 0;
      for (var i = 0; i < 유.length; i++) {
        var u = 유[i], ddx = lx - u.cx, ddy = ly - (u.b - u.h / 2), d2 = ddx * ddx + ddy * ddy + 16, 무 = 1 / (d2 * d2), q = 한(u);   /* 네제곱 역수 — 닻찾기 와 같다 */
        합 += 무; x += 무 * q.x; y += 무 * q.y; sx += 무 * q.sx; sy += 무 * q.sy;
      }
      return { x: x / 합, y: y / 합, sx: sx / 합, sy: sy / 합 };
    }
    var 재 = 판들.map(function (p) { return p.e.getBoundingClientRect(); });
    판들.forEach(function (p, i) {
      var r = 재[i]; if (r.width < 1 || r.height < 1) return;
      var 캠판 = p.L === R.fxCamPlane || p.L === R.fxCamPlaneUnder, ps = 배.s, x0 = 호.left + 배.ox, y0 = 호.top + 배.oy;
      /* 카메라 판 — 화면 가운데의 원본 320×200 판(카메라 배율) · apply 도중엔 판 크기가 아직 안 잡혀 판 사각형으로 재면 배율이 1 로 나왔다 (10-19) */
      if (캠판) { ps = R.cam.zoom || 1; x0 = 호.left + 호.width / 2 - 160 * ps; y0 = 호.top + 호.height / 2 - 100 * ps; }
      var lx = (r.left - x0) / ps, ly = (r.top - y0) / ps, lw = r.width / ps, lh = r.height / ps;
      /* 화면을 덮는 판 — 위아래를 꿰뚫는 기둥(프로미넌스 68×198 등)은 가로 자리만 · 옆으로 덮는 띠는 세로 자리만 · 둘 다 덮으면 그대로 (10-19 대조 마법 20) */
      var 높음 = lh > 190, 넓음 = lw > 280;
      var 닻 = p.e._3d묶음닻, 목;
      if (닻) {
        /* [리마스터] 묶음 연출(아마게돈 다섯) — 크기와 상관없이 한 덩어리: 닻(원본 화면 점)을 시전자 몸 가운데에 두고 시전자 그림 비율로 키운다
         *   ☠ 아래 일반 갈래는 판이 화면만큼 커지면(넓음·높음) 옮기기·키우기를 멈춰, 커지는 도중에 옛 2D 화면 자리·크기로 돌아갔다
         *   (11-09 헤드리스 2-3 실측: 1604ms 크기 1.139·세로 13.6px → 1929ms 크기 1·0 · 사장님 「…캐릭터 중심이 아닌 기존 2d화면 중심으로 나오는 느낌이야.」) */
        높음 = 넓음 = false;
        var 시 = 유.filter(function (q) { return 연출유닛 && q.유닛 === 연출유닛[0]; })[0];
        if (시) {
          var 몸x = 시.X, 몸y = 시.Y - (시.h / 2) * 시.sy;
          목 = { x: 몸x + (lx + lw / 2 - 닻.x) * 시.sx, y: 몸y + (ly + lh / 2 - 닻.y) * 시.sy, sx: 시.sx, sy: 시.sy };
        } else {
          var 닻목 = 사상(닻.x, 닻.y);
          목 = { x: 닻목.x + (lx + lw / 2 - 닻.x) * 닻목.sx, y: 닻목.y + (ly + lh / 2 - 닻.y) * 닻목.sy, sx: 닻목.sx, sy: 닻목.sy };
        }
      } else {
        if (높음 && 넓음) return;
        목 = 사상(lx + lw / 2, ly + lh / 2);
      }
      /* 크기 — 기준 유닛이 원본보다 가로·세로로 준 비율만큼 · 줄면서 원점 둘레로 가운데가 움직인 만큼 빼고 옮긴다 */
      var kx = 목.sx / ps, ky = 목.sy / ps;
      if (!(kx > 0.05 && kx < 20)) kx = 1; if (!(ky > 0.05 && ky < 20)) ky = 1;
      if (높음 || 넓음) { kx = 1; ky = 1; }
      /* 원점 비율은 판 자체 크기로 — 카메라 판 안의 판은 원점이 판 안쪽 px 라 화면 px 로 나누면 원점이 위쪽 10% 로 잡혀 30도에서 120px 밀렸다 (10-19) */
      var 원 = getComputedStyle(p.e).transformOrigin.split(/\s+/), 자w = p.e.offsetWidth || r.width, 자h = p.e.offsetHeight || r.height;
      var fx0 = 원점값(원[0], 자w) / Math.max(1, 자w), fy0 = 원점값(원[1] == null ? '50%' : 원[1], 자h) / Math.max(1, 자h);
      var Ox = r.left + fx0 * r.width, Oy = r.top + fy0 * r.height;
      var 줄cx = Ox + kx * ((r.left + r.right) / 2 - Ox), 줄cy = Oy + ky * ((r.top + r.bottom) / 2 - Oy);
      var dx = 목.x - 줄cx, dy = 목.y - 줄cy;
      if (높음) dy = 0; if (넓음) dx = 0;
      if (캠판) { dx /= ps; dy /= ps; }
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(kx - 1) < 0.01 && Math.abs(ky - 1) < 0.01) return;
      p.e.style.translate = dx.toFixed(1) + 'px ' + dy.toFixed(1) + 'px';
      p.e.style.scale = kx.toFixed(3) + ' ' + ky.toFixed(3);
      s.화면판.add(p.e);
    });
  }

  /* 연출 판 — 연출 층은 작아서 매 장면 훑어도 된다 */
  function 연출층들(R) { return [R.fxUnderLayer, R.fxWorldUnderLayer, R.fxLayer, R.fxTopLayer, R.fxTopFrontLayer].filter(Boolean); }
  function 연출띄우기(R, s) {
    연출층들(R).forEach(function (L) {
      var 모두 = L.querySelectorAll('*');
      for (var i = 0; i < 모두.length; i++) {
        var e = 모두[i];
        if (e._ground == null || e._left == null || 안세움(e)) continue;
        연출하나(R, s, e);
      }
    });
  }
  function 연출자리(R, s) {
    var 사각 = [], 호 = R.host.getBoundingClientRect();
    [R.fxUnderLayer, R.fxWorldUnderLayer, R.fxLayer].filter(Boolean).forEach(function (L) {
      var 모두 = L.querySelectorAll('*');
      for (var i = 0; i < 모두.length; i++) {
        var e = 모두[i];
        if (e._ground == null) continue;
        /* 눕는 바닥 연출(마법진·땅 불길 등) — 하이라이트처럼 «눕힌 판»으로 앞 건물·언덕에 가린다 (10-24)
         *   사장님 「지면에 깔리는 마법이 대부분 이상해」 — DOM 바닥 판은 3D 지형 캔버스 위에 깊이 없이 그려지는데 가림판 목록에서 빠져
         *   건물·언덕 뒤 바닥 판도 그 위로 보였다 */
        if (e._billboardMode === 'floor') {
          var rf = e.getBoundingClientRect();
          if (rf.width < 1 || rf.height < 1 || getComputedStyle(e).display === 'none') continue;
          var of = 원점(e), fx = of.l + of.w / 2 + R.mapW / 2, fy = of.t + of.h / 2 + R.mapH / 2;
          사각.push({ l: rf.left - 호.left, t: rf.top - 호.top, r: rf.right - 호.left, b: rf.bottom - 호.top, 줄: Math.max(0, Math.floor(fy / 16)),
            발: { x: fx, y: fy, h: e._3d들림 || 0, 눕: true } });
          continue;
        }
        if (L === R.fxUnderLayer) continue;
        var r = e.getBoundingClientRect();
        if (r.width < 1 || r.height < 1 || getComputedStyle(e).display === 'none') continue;
        var 닻 = e._3d닻;
        /* 앞 = 닻 발줄 아래로 내려온 만큼 선 판을 앞으로 — 원본 화면에서 발보다 아래 그린 부분(땅 위 폭발 아래쪽)을 앞 같은 높이 땅이 자르지 않게 */
        var o = 원점(e), 아래 = 닻 ? Math.max(0, o.t + o.h + R.mapH / 2 - 닻.F) : 0;
        사각.push({ l: r.left - 호.left, t: r.top - 호.top, r: r.right - 호.left, b: r.bottom - 호.top, 줄: Math.max(0, Math.floor(((닻 ? 닻.F : e._ground) - 1) / 16)),
          발: 닻 ? { x: 닻.x, y: 닻.F, h: 닻.높, 앞: 8 + 아래 } : null });
      }
    });
    return 사각;
  }
  /* 3D 끌 때 — 세웠던 판을 실행기 변환으로 되돌린다 (어느 층이든 · 떨어져 나간 것은 버린다) */
  function 연출내리기(R) {
    var s = R._리마스터3D, 목 = s && s.세운것;
    if (목) {
      목.forEach(function (e) {
        if (!e.isConnected) { 목.delete(e); return; }
        if (e._unit && R.unitEls && R.unitEls[e._unit.id] === e) return;     /* 유닛은 유닛내리기 가 */
        if (e._3d원z !== undefined) { e.style.zIndex = e._3d원z; e._3d원z = undefined; }   /* 칸 판 3D 겹침 되돌림 */
        if (e._3d국 || e._3d들림 || e._3d연출) 띄우기(e, 0, false);
        e._3d연출 = false; e._3d닻 = null;
        목.delete(e);
      });
    }
    연출층들(R).forEach(function (L) {
      var 모두 = L.querySelectorAll('*');
      for (var i = 0; i < 모두.length; i++) if (모두[i]._3d연출) { 띄우기(모두[i], 0); 모두[i]._3d연출 = false; }
    });
  }

  /* 칸에 선 유닛(발~머리 · 칸 폭)이 3D 화면에서 완전히 벗어났나 — 3D 가 켜진 동안만 true/false, 아니면 null
   *   퇴장 걷기(battle_main leaveWalk «보이는 화면 밖까지 걷는다»)가 2D 화면 창을 칸으로 세어 멈추는데,
   *   3D 는 기울여 위·아래가 더 보여 그 칸이 화면 안(60/0 아래 칸 = 976 중 815px)이라 유닛이 화면 한가운데서 사라졌다
   *   (10-26 사장님 「sce 이벤트 에서 카메라 이동 관련 전수 확인해」 — 23-1 실측) */
  function 칸화면밖(R, s, x, y) {
    var P = root.G2Projection, c = R.cam, v = (!s.apply중 && s.vcam3d) || R._vcam || {};
    var 카 = { tilt: c.tilt, rot: c.rot, dist: c.dist, fov: c.fov, zoom: c.zoom, cx: c.cx, cy: c.cy,
              vcx: v.cx != null ? v.cx : c.cx, vcy: v.cy != null ? v.cy : c.cy };
    var 세계 = { mapW: R.mapW, mapH: R.mapH, TW: 24, TH: 16 };
    var W = R.host.clientWidth, H = R.host.clientHeight, 뷰 = { 출력w: W, 출력h: H, dpr: root.devicePixelRatio || 1 }, 옵 = { 흔들: R.shake || { x: 0, y: 0 } };
    var z = s.장면.높이(x + 0.5, y * 16 + 8) || 0, l = 1e9, r = -1e9, t = 1e9, b = -1e9;
    /* 칸 네 귀 발밑 + 머리(유닛 그림 키 넉넉히 64) — 세운 유닛이 그리는 범위를 감싼다 */
    [[0, 0], [24, 0], [0, 16], [24, 16]].forEach(function (d) {
      [0, 64].forEach(function (h) {
        var p = P.투영(카, 세계, 뷰, { x: x * 24 + d[0] - R.mapW / 2, y: y * 16 + d[1] - R.mapH / 2, z: z + h }, 옵);
        if (!p) return; l = Math.min(l, p.sx); r = Math.max(r, p.sx); t = Math.min(t, p.sy); b = Math.max(b, p.sy);
      });
    });
    return r < 0 || l > W || b < 0 || t > H;
  }

  /* 클릭→칸 — 3D 가 켜진 동안만. 시선을 맨 위 높이에서부터 4px 씩 내려가며 지형 표면에 처음 닿는 점 */
  function 클릭칸(R, s, sx, sy) {
    var P = root.G2Projection, c = R.cam, v = (!s.apply중 && s.vcam3d) || R._vcam || {};   /* 클릭은 apply 밖 — 3D 화면 카메라로 */
    var 카 = { tilt: c.tilt, rot: c.rot, dist: c.dist, fov: c.fov, zoom: c.zoom, cx: c.cx, cy: c.cy,
              vcx: v.cx != null ? v.cx : c.cx, vcy: v.cy != null ? v.cy : c.cy };
    var 세계 = { mapW: R.mapW, mapH: R.mapH, TW: 24, TH: 16 };
    var 뷰 = { 출력w: R.host.clientWidth, 출력h: R.host.clientHeight, dpr: root.devicePixelRatio || 1 };
    var 옵 = { 흔들: R.shake || { x: 0, y: 0 } };
    var 맨위 = s.높이최대 || 0, 맞은 = null;
    for (var z = 맨위; z >= 0; z -= 4) {
      var p = P.역투영평면(카, 세계, 뷰, { sx: sx, sy: sy }, z, 옵);
      if (!p) continue;
      var mx = p.x + R.mapW / 2, my = p.y + R.mapH / 2;
      /* 맵 밖(위 여백 등)에 닿은 것은 건너뛰고 더 내려간다 — THUND 는 맵 위 바깥이 높게 서 있어 0~3줄을 누르면 −3~−7줄이 잡혀 맨 위 캐릭터가 안 골라졌다 (사장님 10-28 「맵 맨 위쪽의 캐릭터가 마우스로 선택이 안되는 문제도 있어. thund 맵이야」·「이게 18-1이고 클릭시 이상한 캐릭터가 선택되기도 해.」) */
      if (mx < 0 || my < 0 || mx >= R.mapW || my >= R.mapH) continue;
      /* z = 닿은 자리의 땅 높이 — 시선 높이(z 걸음)로 두면 블록 옆벽에 닿을 때 벽 중간 높이가 되어 아래 낮은 칸으로 넘어갔다 (10-26 BEA06 10,16 → 옆벽 높이 48 → 11,17) */
      if (s.장면.높이(mx / 24, my) >= z - 2) { 맞은 = { mx: mx, my: my, z: s.장면.높이(mx / 24, my) }; break; }
    }
    if (!맞은) return null;
    var tx = Math.floor(맞은.mx / 24), ty = Math.floor(맞은.my / 16);
    /* 닿은 면의 높이가 그 칸 윗면과 다르면 닿은 높이를 윗면으로 가진 이웃 칸으로 — 벽 윗면은 칸 경계보다 2px 앞(북)에서 선다(DUN04 높이(20.5,350)=100 · 칸 22 는 352 부터)
     *   그 2px 띠를 누르면 벽 앞 낮은 칸(21)이 잡혔다 (10-25 사장님 「작업된 맵 제대로 작동하는지 확인해줘」 — 높이 점검 DUN04·DUN09 20,15→20,21) */
    var 칸위 = function (x, y) { return s.장면.높이(x + 0.5, y * 16 + 8) || 0; };
    if (Math.abs(칸위(tx, ty) - 맞은.z) > 4) {
      var 고른 = null, 거리 = 1e9, 차 = Math.abs(칸위(tx, ty) - 맞은.z);
      [[0, 1], [0, -1], [1, 0], [-1, 0]].forEach(function (d) {
        var nx = tx + d[0], ny = ty + d[1], 이차 = Math.abs(칸위(nx, ny) - 맞은.z);
        var dd = d[1] ? Math.abs((d[1] > 0 ? (ty + 1) * 16 : ty * 16) - 맞은.my) : Math.abs((d[0] > 0 ? (tx + 1) * 24 : tx * 24) - 맞은.mx);
        /* ① 이웃 윗면이 닿은 높이와 1 안(평평한 벽 윗면)이고 맞닿은 변에서 8px 안 — 비탈 칸 안쪽을 이웃으로 넘기지 않는다
         *   (DUN01 10,24 를 누르면 벽 윗면이 칸 28 경계보다 4.7px 앞 (11.69,27.71) 에서 닿았다)
         * ② 변에서 3px 안이면 닿은 높이에 더 가까운 윗면 칸 — 벽 끝 비탈진 면(이웃 사이 보간)에 닿으면 앞 낮은 칸이 잡혔다
         *   (10-26 사장님 「추가된 맵들 다시 확인해서 검증해줘」 — PRISON01 10,18 → 통로 12,22(33) · 닿은 곳 (12.33,22.16) 높이 81 · 위 칸 91) */
        var 됨 = (이차 <= 1 && dd <= 8) || (dd <= 3 && 이차 < 차);
        if (!됨) return;
        if (dd < 거리) { 거리 = dd; 고른 = [nx, ny]; }
      });
      if (고른) { tx = 고른[0]; ty = 고른[1]; }
    }
    return { x: tx, y: ty, px: 맞은.mx, py: 맞은.my };
  }

  function 유닛내리기(R) {
    var 상자들 = R.unitEls || {};
    var 값들 = R.valueEls || {};
    for (var v in 값들) { var ve = 값들[v]; if (ve && ve._3d유닛값) { 띄우기(ve, 0, false); ve._3d유닛값 = false; } }
    for (var k in 상자들) {
      var box = 상자들[k];
      if (box && box._shd && box._shd.style.transform === 'rotateX(90deg)') box._shd.style.transform = '';
      if (box && box._3d구조면) { box.style.clipPath = ''; box._3d구조면 = null; }   /* 구조물 판 윗줄 자름 풀기 */
      if (!box || (!box._3d들림 && !box._3d국)) continue;
      var 판 = box.parentNode;
      if (판 && 판._평면tf) { if (box._평면loc) box.style.setProperty('--loc', box._평면loc); }
      else box.style.transform = box._빌보드원문 != null ? box._빌보드원문 : '';
      box._3d들림 = 0; box._3d국 = null;
    }
  }

  /* WebGL 판 정리 — 화면에서 떼기만 하면 판(텍스처·버퍼)이 남아 전투마다 쌓였다 (마을 3D town3d.js 버리기 와 같은 방식)
   *   (11-20 사장님 「안드로이드버전 왜 자꾸 튕기지」·「메모리 반환문제가 맞나봐. 한번 전투하고 두번째 들어가면 거의 튕긴다고 봐야하네..」 · 정본 304
   *    에뮬레이터 실측: 전투를 바꿀 때마다 WebGL 판이 2개씩 늘고(3→5→7, 하나도 안 잃음) 웹 화면 렌더러 1.30→1.58→1.88GB) */
  var 지금R = null;   /* 지금 3D 를 맡은 렌더러 — 새 전투 렌더러가 오면 이전 것을 걷는다 */
  function 판정리(판) {
    try { var gl = 판 && 판.gl, ex = gl && gl.getExtension('WEBGL_lose_context'); if (ex) ex.loseContext(); } catch (e) { }
  }
  function 걷기(R) {
    var s = R._리마스터3D;
    if (!s) return;
    if (s.캔버스 && s.캔버스.parentNode) s.캔버스.parentNode.removeChild(s.캔버스);
    if (s.가림캔버스 && s.가림캔버스.parentNode) s.가림캔버스.parentNode.removeChild(s.가림캔버스);
    판정리(s.장면); 판정리(s.가림);
    유닛내리기(R);
    if (R.host) R.host.classList.remove('g2-3d맵');
    이동칸맞춤(R, s, false);   /* 3D 걷으면 이동 칸도 원본으로 */
    if (s.원apply) R.apply = s.원apply;
    if (s.원칸) R.screenToTile = s.원칸;
    if (s.원선택상자) R.selectBox = s.원선택상자;
    if (s.원방향안내) R.facingGuide = s.원방향안내;
    if (s.원빌보드) R._빌보드적용 = s.원빌보드;
    if (s.원화면점) R.screenOfRendered = s.원화면점;
    if (s.원놓기한판) R._놓기한판 = s.원놓기한판;
    if (s.원평면놓기) R.연출명령평면놓기 = s.원평면놓기;
    if (s.원camTo) R.camTo = s.원camTo;
    if (s.애니타이머) { clearInterval(s.애니타이머); s.애니타이머 = null; }
    화면판풀기(R, s);
    표식내리기(R); 연출내리기(R); 커서내리기(R);
    if (s.슬라이더줄 && s.슬라이더줄.parentNode) s.슬라이더줄.style.display = 'none';
    R._리마스터3D = null;
  }

  /* ── 3D 높이 슬라이더 (10-18 사장님 「지금 3d 높이가 너무 높아 높이를 슬라이더로 설정할 수 있게 해줘」) ──
   *   값 = 지정보기 «단 높이»(amp) 의 실행기 쪽 값 · 0~400 · 실행기 기본 100 (지정보기 기본 200 의 절반) · 이 브라우저에 기억 */
  var 높이기본 = 100;
  /* 맵마다 기본 높이 — 표에 있는 맵은 그 값이 기본이고 슬라이더로 바꾸면 그 맵만 따로 기억 (사장님 11-01 「페리스마을은 게임에 적용시 기본 단 높이를 50으로 적용하기」) */
  var 맵높이기본 = { '마을_PERIS': 50 };
  function 높이키(이름) { return 맵높이기본[이름] != null ? '리마스터3D높이:' + 이름 : '리마스터3D높이'; }
  function 높이값(이름) {
    var 기 = 맵높이기본[이름] != null ? 맵높이기본[이름] : 높이기본;
    try { var t = root.localStorage.getItem(높이키(이름)), v = +t; return (t != null && v >= 0 && v <= 400) ? v : 기; }
    catch (e) { return 기; }
  }
  function 높이적용(s, v) {
    s.높이 = v; s.높이수 = (s.높이수 | 0) + 1;
    s.장면.값('amp', v); s.가림.값('amp', v);
    s.높이최대 = 0;
    var 자 = s.장면.지정();
    if (자) for (var yy = 0; yy < 자.H; yy++) for (var xx = 0; xx < 자.W; xx++) { var hh = s.장면.높이(xx + 0.5, yy * 16 + 8); if (hh > s.높이최대) s.높이최대 = hh; }
    s.높이최대 += 8;
  }
  function 슬라이더(R, s) {
    var d = root.document, 기 = d.getElementById('tilt');
    if (!기) return;
    var 줄 = d.getElementById('리마스터3D높이줄');
    if (!줄) {
      줄 = d.createElement('label'); 줄.id = '리마스터3D높이줄';
      줄.title = '리마스터 3D 맵의 높이 (지정보기 단 높이와 같은 값 · 100 = 지정보기 기본의 절반)';
      줄.innerHTML = '<span id=리마스터3D고름 style="margin-right:8px"><label style="display:inline"><input type=radio name=리마스터3D보기 value=2.5d> 2.5D</label> <label style="display:inline"><input type=radio name=리마스터3D보기 value=3d> 3D</label></span>' +
        '3D 높이 <input type=range id=리마스터3D높이 min=0 max=400 step=10> <b id=v리마스터3D높이></b>' +
        ' · 세로 보정 <input type=range id=리마스터3D세로 min=0 max=100 step=5 title="세운 캐릭터·연출의 세로 — 100% = 원본 키 · 0% = 지면 수직 그대로"> <b id=v리마스터3D세로></b>';
      var 자리 = 기.closest('label') || 기.parentNode;
      자리.parentNode.insertBefore(줄, 자리.nextSibling);
    }
    줄.style.display = '';
    var 입 = d.getElementById('리마스터3D높이'), 글 = d.getElementById('v리마스터3D높이');
    입.value = s.높이; 글.textContent = s.높이 + '%';
    입.oninput = function () {
      var v = +입.value; 글.textContent = v + '%';
      try { root.localStorage.setItem(높이키(s.이름), String(v)); } catch (e) {}
      var t = R._리마스터3D; if (!t || !t.준비됨) return;
      높이적용(t, v); R.apply();
    };
    var 세입 = d.getElementById('리마스터3D세로'), 세글 = d.getElementById('v리마스터3D세로');
    if (세입) {
      세입.value = 세로보정; 세글.textContent = 세로보정 + '%';
      세입.oninput = function () {
        세로보정 = +세입.value; 세글.textContent = 세로보정 + '%';
        try { root.localStorage.setItem('리마스터3D세로보정', String(세로보정)); } catch (e) {}
        R.apply();
      };
    }
    /* 2.5D / 3D 고르기 (10-18 사장님 「개발도구에 2.5d 3d 선택할 수 있는 토글 달아야해」) — 이 브라우저에 기억 · 그 자리에서 바뀐다 */
    var 고름들 = 줄.querySelectorAll('input[name=리마스터3D보기]');
    Array.prototype.forEach.call(고름들, function (r) {
      r.checked = (r.value === '3d') !== !!root.__리마스터3D끄기;
      r.onchange = function () {
        if (!r.checked) return;
        root.__리마스터3D끄기 = r.value !== '3d';
        try { root.localStorage.setItem('리마스터3D보기', r.value); } catch (e) {}
        입.disabled = !!root.__리마스터3D끄기;
        R.apply();
      };
    });
    입.disabled = !!root.__리마스터3D끄기;
    s.슬라이더줄 = 줄;
  }

  /** render.js 가 원본 맵을 깐 뒤 부른다 */
  async function 맵준비(R, 이름, mapx, 맵층) {
    /* 전투를 바꾸면 렌더러(R)가 새로 생긴다 — 옛 렌더러의 3D 는 아무도 걷지 않아 판(WebGL)이 전투마다 둘씩 쌓였다 → 옛 것부터 걷는다 (정본 304 · 에뮬레이터 실측 3→5→7판) */
    if (지금R && 지금R !== R) { try { 걷기(지금R); } catch (e옛) { } }
    지금R = R;
    걷기(R);
    이름 = String(이름 || '').toUpperCase();
    if (켜는맵[이름] === false || !스위치()) return { 상태: 'off' };
    if (!root.G2지정본굽기 || !root.G2지정본그리기 || !root.G2Projection || !root.G2Native) return { 상태: '모듈 없음' };
    var 표 = { 이름: 이름, 준비됨: false, mapx: mapx };
    R._리마스터3D = 표;
    var t0 = (root.performance && performance.now()) || 0;
    var 구운것;
    /* 맵층을 안 받았으면 지금 전투 맵 층으로 — 대본이 3D 굽기 전에 칸을 바꾸면(26-1 봉화 불 · 시작 연출) 다시굽기 창구가 3D 를 못 찾아 건너뛰어 원본 파일 그대로 구웠다 (10-26) */
    var 지금맵 = R.b && R.b.map;
    if (!맵층 && 지금맵 && 지금맵.layerA && 지금맵.layerB && 지금맵.layerC) 맵층 = { layerA: Uint16Array.from(지금맵.layerA), layerB: Uint16Array.from(지금맵.layerB), layerC: Uint8Array.from(지금맵.layerC) };
    try { 구운것 = await 굽기(이름, mapx, 맵층); }
    catch (e) { 표.실패 = '굽기 오류: ' + (e && e.message); console.warn('[리마스터3D]', 표.실패); return 표; }
    if (R._리마스터3D !== 표) return { 상태: '맵 바뀜' };
    if (구운것.실패) { 표.실패 = 구운것.실패; console.warn('[리마스터3D]', 표.실패); return 표; }
    var 만든 = 장면만들기(R, 이름, 구운것, mapx);
    표.바탕팔 = 구운것.바탕팔;
    표.캔버스 = 만든.캔버스; 표.장면 = 만든.장면; 표.가림캔버스 = 만든.가림캔버스; 표.가림 = 만든.가림; 표.굽기ms = Math.round(((root.performance && performance.now()) || 0) - t0);
    try { if (R.tileLayer) R.tileLayer.classList.add('g2-tilelayer3d'); } catch (e) {}
    규칙넣기();
    await 만든.장면.준비; await 만든.가림.준비;
    if (R._리마스터3D !== 표) {
      [만든.캔버스, 만든.가림캔버스].forEach(function (c) { if (c.parentNode) c.parentNode.removeChild(c); });
      판정리(만든.장면); 판정리(만든.가림);   /* 만들다 버리는 판도 정리 (정본 304) */
      return { 상태: '맵 바뀜' };
    }
    /* [리마스터] 던전 캐릭터 1층 — 본 장면(유닛 발 높이)과 가림판(앞 지형 판정) 둘 다 같은 표 (굽기 «던전발» 주석) */
    if (구운것.던전발) [만든.장면, 만든.가림].forEach(function (판) {
      try { if (판 && 판._평가) 판._평가('(function (a) { 지정.발높이 = a; })')(구운것.던전발); } catch (e던) {}
    });
    /* 맵에서 가장 높은 곳(클릭 시선 시작)은 높이적용 이 센다 */
    /* ★ 3D 클릭·호버 유닛 고르기 — 그 점에 «실제로 그려진» 유닛 가운데 맨 앞 (2026-10-28)
     *   사장님 「지금 보이는 화면에서 라시드 클릭시 제국궁수 화면이 나와」·「커서 자체가 다른데로 가는거 같아」·「작은화면에서 안잡혀」
     *   ☠ 원인(18-1 실측): 기울기 45·60 에서 화면 앞쪽(남쪽) 먼 유닛 판의 사각(getBoundingClientRect)이 원근으로 화면만큼 부풀어
     *     불투명 판정 후보에 끼고(궁수 20,41·17,41 · 성벽 33,30), «밑변이 가장 아래» 기준으로 그것이 뽑혔다
     *   ⇒ 후보를 브라우저 겹침 순서(elementsFromPoint — 3D 변환·앞뒤를 따진다)로 거른다: 그 점에 없는 판은 빼고, 앞에서부터 처음 불투명한 유닛 */
    표.원점유닛 = R.화면점유닛;
    if (표.원점유닛) R.화면점유닛 = function (units, x, y) {
      if (!(표.준비됨 && R.host.classList.contains('g2-3d맵'))) return 표.원점유닛.call(this, units, x, y);
      var 목 = root.document.elementsFromPoint(x, y), 상자 = new Map(), 본 = [];
      for (var i = 0; i < (units || []).length; i++) { var u = units[i], b = u && u.alive && R.unitEls && R.unitEls[u.id]; if (b) 상자.set(b, u); }
      for (var j = 0; j < 목.length; j++) {
        var n = 목[j]; while (n && !상자.has(n)) n = n.parentNode;
        if (!n) continue; var v = 상자.get(n); if (본.indexOf(v) >= 0) continue; 본.push(v);
        if (R.유닛불투명픽셀인가(v, x, y)) return v;
      }
      return null;
    };
    표.원칸 = R.screenToTile;
    /* 선택 상자를 놓는 그 자리에서 3D 높이도 — 빈 칸 상자는 selectBox 가 높이 0(transform none)으로 눕히고 커서띄우기는 다음 apply 에서야 올려 한 프레임 땅속으로 꺼졌다
     *   (사장님 11-07 「십자키로 연속해서 이동할때 커서 박스가 튀면서 아래로 내려갔다가 올라오는데」 — 실측 3-3A 기울기 45: 다섯 걸음 중 한 프레임씩 translateZ(50px) → none → 50px) */
    표.원선택상자 = R.selectBox;
    R.selectBox = function () {
      var r = 표.원선택상자.apply(this, arguments);
      if (표.준비됨 && R._리마스터3D === 표 && R.host.classList.contains('g2-3d맵')) { try { 커서띄우기(R, 표); } catch (e) {} }
      return r;
    };
    /* 정본 392 — 방향 화살표도 같다: facingGuide 가 방향을 바꿀 때마다 높이를 transform none(땅 0)으로 되돌리고 커서띄우기는 다음 apply 에서야 올려
     *   단차 칸에서 화살표가 한 프레임 땅속으로 꺼졌다 떴다 (사장님 11-22 「아직도 화살표 이슈 그대로 문제 있대. 자꾸 그림이 튄대.」) — 선택 상자(위)와 같은 자리에서 곧바로 다시 얹는다 */
    표.원방향안내 = R.facingGuide;
    R.facingGuide = function () {
      var r = 표.원방향안내.apply(this, arguments);
      if (표.준비됨 && R._리마스터3D === 표 && R.host.classList.contains('g2-3d맵')) { try { 커서띄우기(R, 표); } catch (e) {} }
      return r;
    };
    R.screenToTile = function (sx, sy) {
      var 켬 = 표.준비됨 && R.host.classList.contains('g2-3d맵');
      if (켬) {
        try { var t = 클릭칸(R, 표, sx, sy); if (t) return t; } catch (e) {}
      }
      return 표.원칸.apply(this, arguments);
    };
    /* 퇴장 걷기가 묻는다 — 3D 가 켜졌으면 true/false, 아니면 null(2D 화면 창 규칙 그대로) */
    R.칸화면밖3D = function (x, y) {
      if (!(표.준비됨 && R._리마스터3D === 표 && R.host.classList.contains('g2-3d맵'))) return null;
      try { return 칸화면밖(R, 표, x | 0, y | 0); } catch (e) { return null; }
    };
    높이적용(표, 높이값(이름));
    슬라이더(R, 표);
    /* ★ 놓자마자 띄운다 — 실행기 빌보드 적용(_빌보드적용)을 감싼다 (10-18 전수 점검: 연출 판이 매 틱 변환을 다시 써
     *   다음 화면 갱신 전까지 한순간 높이 0 에 그려졌다 · 40초 표본 5판 중 2판). 유닛·HUD·커서·맵 위 연출 모두 이 창구로 놓인다 */
    /* 연출 카메라 판(화면 고정 연출 판) — apply 밖에서 놓일 때도 3D 화면 카메라로 (화면 가운데에 맞게) */
    표.원놓기한판 = R._놓기한판;
    if (표.원놓기한판) R._놓기한판 = function () {
      var v3 = 표.vcam3d;
      if (!v3 || 표.apply중) return 표.원놓기한판.apply(this, arguments);
      var v = this._vcam; this._vcam = v3;
      try { return 표.원놓기한판.apply(this, arguments); } finally { this._vcam = v; }
    };
    연출창구감싸기();
    /* 화면판 그림이 apply 밖에서 놓이면(연출 재생기가 장마다) 같은 차례 안에 맞춘다 */
    표.원평면놓기 = R.연출명령평면놓기;
    if (표.원평면놓기) R.연출명령평면놓기 = function () {
      var r = 표.원평면놓기.apply(this, arguments);
      if (표.준비됨 && !표.apply중 && this.host.classList.contains('g2-3d맵') && !표.평면예약) {
        표.평면예약 = true;
        var self = this;
        Promise.resolve().then(function () { 표.평면예약 = false; try { if (self.host.classList.contains('g2-3d맵')) 화면판맞추기(self, 표); } catch (e) {} });
      }
      return r;
    };
    /* ★ 3D 애니 — 박자(≈171ms)가 바뀌면 장면·가림판 그림(애니 블록·타일)을 갈아 끼우고 3D 가 보일 때 다시 그린다 (지정본그리기 애니걸음 · 사장님 10-26 「3d에서 애니타일 다뤄야해」) */
    표.애니타이머 = setInterval(function () { if (R._리마스터3D !== 표 || !표.준비됨) return; var 바뀜 = 표.장면.애니걸음 && 표.장면.애니걸음(); if (표.가림.애니걸음) 표.가림.애니걸음(); if (바뀜 && R.host.classList.contains('g2-3d맵') && !표.apply중) { try { 표.장면.그리기(); 표식3D(R, 표); } catch (e) {} } }, 40);   /* 애니로 장면만 다시 그리면 범위 표식이 지워진다 — 같이 다시 (10-28) */
    표.세운것 = new Set();                       /* 세운 판 — 3D 끌 때 어느 층에 있든 되돌린다 */
    표.틱 = 0;
    /* screenOfRendered — HUD 캔버스(피해 숫자 등)가 «유닛 그림의 이 점이 화면 어디인가»를 잰다. 재는 점을 그 유닛 닻에 세우도록 알려 준다 */
    표.원화면점 = R.screenOfRendered;
    if (표.원화면점) R.screenOfRendered = function (u) {
      표.재는유닛 = u;
      try { return 표.원화면점.apply(this, arguments); } finally { 표.재는유닛 = null; }
    };
    /* 피해 숫자 — 만든 자리에서 주인 유닛을 붙인다 (render.js hitNumber 가 그 자리에서 글자 캔버스를 만든다) · 즉시띄우기 가 주인 닻에 바로 세운다
     *   (10-24 사장님 「지금 전체마법시 여러캐릭터가 데미지를 입을때(데미지 표시 연출이 나올때) 많이 느려지는 문제가 있어.」 —
     *    숫자 판이 일반 연출로 닻찾기(유닛표 다시 만들기·배치 읽기)를 타서 숫자 12개에 3D 371ms ↔ 2.5D 13ms) */
    표.원숫자 = R.hitNumber;
    if (표.원숫자) R.hitNumber = function (u) {
      var r = 표.원숫자.apply(this, arguments);
      try { if (u) Array.prototype.forEach.call(this.host.querySelectorAll('.g2-hit-number'), function (e) { if (!e._3d주인) e._3d주인 = u; }); } catch (e) {}
      return r;
    };
    /* 사망 파편 무대 — 유닛 상자 복제본(render.js 사망파편무대열기)에 원래 상자의 3D 변환(세우기)을 입힌다 (파편무대맞추기 · 10-24) */
    표.원파편무대 = R.사망파편무대열기;
    if (표.원파편무대) R.사망파편무대열기 = function () {
      var h = 표.원파편무대.apply(this, arguments);
      try { if (h && h.무대 && h.본체) { h.무대._3d본체 = h.본체; if (표.준비됨 && this.host.classList.contains('g2-3d맵')) 파편무대맞추기(h.무대); } } catch (e) {}
      return h;
    };
    표.원빌보드 = R._빌보드적용;
    R._빌보드적용 = function (e) {
      var r = 표.원빌보드.apply(this, arguments);
      try { if (표.준비됨 && this.host.classList.contains('g2-3d맵') && e) 즉시띄우기(this, 표, e); } catch (x) {}
      return r;
    };
    /* 부드러운 카메라 이동(render camTo)의 도착 자리를 기억한다 — 스크롤 동안 높이를 출발 → 도착으로만 바꾸려고 (apply 감쌈 · 10-27) */
    표.원camTo = R.camTo;
    if (표.원camTo) R.camTo = function (ex, ey) {
      표.애니끝 = { x: +ex, y: +ey };
      return 표.원camTo.apply(this, arguments);
    };
    표.원apply = R.apply;
    R.apply = function () {
      /* ★ 카메라가 높이를 따른다 — 화면 가운데 지점의 높이 h 만큼 보는 자리를 옮겨, 높은 층 유닛도 화면 가운데에 오게 한다
       *   (공통 투영: 높이 h 인 점은 Rz⁻¹·(0, −h·tan 기울기) 만큼 옮긴 바닥점과 화면 가운데에서 겹친다 · 원근과 상관없이 맞다)
       *   h 는 부드럽게 따라간다 — 층이 바뀌는 곳에서 화면이 튀지 않게. 논리 카메라 값은 apply 뒤 되돌린다 */
      var c = this.cam, 켬 = 표.준비됨 && c && (c.tilt || c.rot) && !root.__리마스터3D끄기, 옮 = null;
      if (켬) {
        /* 가운데 땅 점이 놓인 칸에 유닛이 있으면 그 유닛 발 높이 — 실행기 카메라 맞춤(유닛 칸 − 6칸 · focusScroll)은 가운데 점이 그 유닛 칸 안이다.
         *   점 높이만 보면 축대 비탈 칸에서 발과 높이가 달라 맞춘 유닛이 5~10px 아래로 밀렸다 (10-19 대조) */
        var 목표 = 가운데높이(this, 표, c.cx, c.cy);
        /* 한 번에 크게 옮겨진 카메라(유닛 맞춤·이벤트 즉시 이동)는 높이도 곧바로 — 따라가는 중에 apply 가 끊기면(연출 중) 중간 값에 멈춰 화면이 틀어졌다 (10-19) */
        var 뜀 = !표.캠앞 || Math.abs(c.cx - 표.캠앞.x) + Math.abs(c.cy - 표.캠앞.y) > 48;
        /* ★ 카메라가 스크롤하는 동안은 지나는 땅 높이를 따르지 않는다 — 출발 높이 → 도착 자리 높이로 간 거리만큼만 바꾼다
         *   (10-27 사장님 「카메라 이동할때 중간에 튕긴다고 해야하나? 단차 올라갈때 그러는건가?」 · 고르심 «스크롤 중엔 높이 고정» —
         *    DAGAL (20,30)→(20,50) 한 화면 −24px 가 단차(50→100)에서 +14·+41 로 거꾸로 60px 튕기고 비탈에서 −46 으로 빨라졌다)
         *   도착 자리: 이벤트 스크롤 _evCam · 대사 맞춤 _camTo(한 칸 양 vx·vy · 남은 칸 fx·fy · tx·ty) · 부드러운 이동 camTo(감쌈이 기억한 끝) */
        var 길 = null, 끝x = 0, 끝y = 0;
        if (this._camScrolling && this._camTo) 길 = this._camTo; else if (this._evCam) 길 = this._evCam;
        if (길) {
          끝x = 길.tx != null ? 길.tx : c.cx + (길.fx > 0 ? 길.fx : 0) * (길.vx || 0);
          끝y = 길.ty != null ? 길.ty : c.cy + (길.fy > 0 ? 길.fy : 0) * (길.vy || 0);
          try {   /* 카메라 가두기(render clampCamera)와 같은 한계 */
            var 최소 = this.camPixelOf({ x: 0, y: 0 }), N = this.CAM_TILES, 최대 = this.camPixelOf({ x: Math.max(0, this.tilesW() - N), y: Math.max(0, this.tilesH() - N) });
            끝x = Math.max(최소.cx, Math.min(최대.cx, 끝x)); 끝y = Math.max(최소.cy, Math.min(최대.cy, 끝y));
          } catch (e) {}
        } else if (this._camAnim && 표.애니끝) { 길 = 표.애니끝; 끝x = 표.애니끝.x; 끝y = 표.애니끝.y; }
        if (길) {
          var 남 = Math.hypot(끝x - c.cx, 끝y - c.cy);
          if (표.길 !== 길) { 표.길 = 길; 표.길시작높 = 표.캠높 != null ? 표.캠높 : 목표; 표.길총 = Math.max(남, 1e-6); }
          /* 진행은 «표시 보간된» 자리로 잰다 — 논리 카메라는 3장마다 2px 계단으로 뛰고 2D 는 그 사이를 lerpT 로 채우는데, 높이만 계단으로 바뀌어
           *   화면이 0.6·0.6·1.2px 로 고르지 않게 움직여 덜덜 떨렸다 (사장님 10-27 「이벤트 카메라 이동시 떨리는 문제」·「3d에서 카메라가 덜덜 떨리는 것처럼 보여」 · 1-1A 실측) */
          var pcx = this._pcam && this._pcam.cx != null ? this._보간값(this._pcam.cx, c.cx) : c.cx, pcy = this._pcam && this._pcam.cy != null ? this._보간값(this._pcam.cy, c.cy) : c.cy;
          남 = Math.hypot(끝x - pcx, 끝y - pcy);
          var 진 = Math.max(0, Math.min(1, 1 - 남 / 표.길총));
          표.캠높 = 표.길시작높 + (가운데높이(this, 표, 끝x, 끝y) - 표.길시작높) * 진;
        } else {
          if (표.길) { 표.길 = null; 뜀 = true; }   /* 스크롤이 막 끝났다 — 도착 자리 높이 그대로 */
          표.캠높 = (표.캠높 == null || 뜀) ? 목표 : 표.캠높 + (목표 - 표.캠높) * 0.25;
          if (Math.abs(목표 - 표.캠높) < 0.3) 표.캠높 = 목표;
        }
        표.캠앞 = { x: c.cx, y: c.cy };
        /* 정본 400 — 카메라가 움직이는 동안은 전투 프레임 루프가 다음 장에도 apply 하므로 따로 예약하지 않는다(한 장 3D 두 번 그리기) */
        var 루프가그림 = this.lerpOn && this.카메라이동중인가 && this.카메라이동중인가() && this._프레임루프때 && performance.now() - this._프레임루프때 < 100;
        if (표.캠높 !== 목표 && !표.캠예약 && !루프가그림 && typeof requestAnimationFrame === 'function') {   /* 다 못 따라갔으면 다음 화면에 한 번 더 */
          표.캠예약 = true;
          requestAnimationFrame(function () { 표.캠예약 = false; try { R.apply(); } catch (e) {} });
        }
        var 기 = Math.max(-80, Math.min(80, c.tilt || 0)) * Math.PI / 180, 돌 = (c.rot || 0) * Math.PI / 180;
        var k = 표.캠높 * Math.tan(기);
        옮 = { x: -k * Math.sin(돌), y: -k * Math.cos(돌) };
        c.cx += 옮.x; c.cy += 옮.y;
        if (this._pcam) { this._pcam.cx += 옮.x; this._pcam.cy += 옮.y; }
      } else { 표.캠높 = null; 표.캠앞 = null; }
      var r;
      표.틱++;                                   /* 장면 차례 — 유닛표 를 한 장면에 한 번만 만든다 */
      if (root.__연출드라이버 && !(root.__연출드라이버.attack && root.__연출드라이버.attack.__3d감쌈)) 연출창구감싸기();   /* 전투가 새로 열리면 드라이버도 새것 */
      표.apply중 = true; 표.옮 = 옮;
      /* ★ 3D 덧그리기는 한 화면에 한 번 (10-19 사장님 「특히 하이라이트에서 타일 선택하고 방향지정할때 느려」 — 방향 지정 중 마우스 움직임마다
       *   R.apply() 를 바로 불러(battle_main mousemove) 한 화면 사이에 3D 장면·가림판·유닛 자리 재기를 여러 번 했다).
       *   8ms 안에 또 오면 이번 덧그리기는 건너뛰고 다음 그리기 직전에 apply 를 한 번 더 — 유닛·커서·연출 판은 놓이는 순간 띄우는
       *   즉시띄우기(_빌보드적용 감쌈)가 따로 있어 중간 모습이 안 보인다. 재는 도구는 root.__리마스터3D즉시 = true 로 끈다 · 3D 켰을 때만(2.5D 는 그대로) */
      /* (10-24) 카메라가 움직인 apply 는 모으지 않는다 — 실행기 판(유닛)은 새 카메라로 옮겨졌는데 3D 장면·가림판만 한 화면 늦어,
       *   스크롤 중 건물 뒤 캐릭터가 힐끗힐끗 비쳤다 (사장님 「카메라 스크롤 중 자꾸 힐끗힐끗 비쳐보여」) · 마우스만 움직인 apply 는 그대로 모은다 */
      /* 캠키는 «표시 보간된» 자리로 — 논리 카메라는 3장마다 한 번 뛰고 그 사이는 보간이 화면을 옮기는데, 논리 값으로 견주니 사이 두 장은 «같은 카메라»로 3D 그리기를 모아 미뤄
       *   유닛·2D 층만 움직이고 3D 맵은 3장마다 따라와 덜덜 떨렸다 (사장님 10-28 「일전에 수정한 1-1a만 멀쩡하고 나머지는 다 덜덜거리는 느낌이야」 — 1-1A 는 높이가 매 장 바뀌어 늘 다시 그렸다) */
      var 보x = c && this._pcam && this._pcam.cx != null && this._보간값 ? this._보간값(this._pcam.cx, c.cx) : c && c.cx, 보y = c && this._pcam && this._pcam.cy != null && this._보간값 ? this._보간값(this._pcam.cy, c.cy) : c && c.cy;
      var 캠키 = c ? [보x, 보y, this.lerpT, c.tilt, c.rot, c.zoom, c.dist].join(",") : "", 캠같음 = 표.그린캠 === 캠키;
      /* (10-24) 판정은 «이번 화면에서 이미 그렸나» — 8ms 창으로 보면 3D 한 번이 9ms 라 다음 호출은 늘 창 밖이어서 하나도 안 모였다
       *   (사장님 「지금 전체마법시 여러캐릭터가 데미지를 입을때(데미지 표시 연출이 나올때) 많이 느려지는 문제가 있어.」 — 실측 숫자 12개:
       *    3D apply 134번 × 8.9ms · 1958ms 동안 6장 ↔ 2.5D 1.8ms · 687ms 21장). 깃발은 다음 rAF(없으면 34ms)에 풀린다 */
      var 지금 = (root.performance && performance.now()) || 0, 모음 = 켬 && 캠같음 && !root.__리마스터3D즉시 && !!표.이번틀그림;
      if (모음 && !표.다음예약) {
        /* 정본 400 — 예약한 «뒤»에 이미 통째로 그렸으면(카메라가 움직여 전투 루프가 새로 그림) 그 그림이 지금 상태를 다 담았다 — 또 그리지 않는다
         *   ☠ 스크롤 중 이것이 매 장 한 번 더 통째로 그려 CPU×4 프로파일의 16% 였다 */
        var 나 = this, 예약때 = 지금, 한번 = function () { if (!표.다음예약) return; 표.다음예약 = false; if (표.그린때 != null && 표.그린때 > 예약때) return; 표.그린때 = null; 표.이번틀그림 = false; 나.apply(); };
        표.다음예약 = true;
        if (root.requestAnimationFrame) root.requestAnimationFrame(한번);
        setTimeout(한번, 34);
      }
      try { r = 표.원apply.apply(this, arguments); if (!모음) { 표.그린때 = 지금; 표.그린캠 = 캠키; try { 갱신(this); } catch (e) { console.warn('[리마스터3D] 그리기 오류', e); }
        if (켬 && !표.이번틀그림) { 표.이번틀그림 = true; var 풀기 = function () { 표.이번틀그림 = false; }; if (root.requestAnimationFrame) root.requestAnimationFrame(풀기); setTimeout(풀기, 34); } } }
      finally {
        표.apply중 = false; 표.옮 = null;
        if (옮) {
          c.cx -= 옮.x; c.cy -= 옮.y; if (this._pcam) { this._pcam.cx -= 옮.x; this._pcam.cy -= 옮.y; }
          /* ★ 화면 카메라(_vcam)도 높이 밀림을 뺀 값으로 돌려 둔다 — 퇴각 걸음(leaveWalk 카메라 칸)·지속 피해 화면 안 판정 등 «판단»이
           *   2.5D 와 같은 값을 받게 (10-19 · 높이 100·기울기 45 면 6칸 넘게 밀린 값이 새어 나갔다). 밀린 값은 vcam3d 로 — 그리기만 쓴다 */
          if (this._vcam) { 표.vcam3d = { cx: this._vcam.cx, cy: this._vcam.cy }; this._vcam = { cx: this._vcam.cx - 옮.x, cy: this._vcam.cy - 옮.y }; }
        } else 표.vcam3d = null;
      }
      return r;
    };
    표.준비됨 = true;
    /* 준비되자마자 apply 한 번 — 갱신만 부르면 카메라 높이 보정(apply 감쌈) 없이 그려져, 다음 apply(이벤트 진행)까지 캐릭터가
     *   벽 위에 서고 가림이 어긋났다 (10-27 사장님 「가림관계가 처리가 안되어서 벽 위에 캐릭터가 올라가 있고 이벤트 발동하면서 진행시 내려가」) */
    try { R.apply(); } catch (e) { 갱신(R); }
    /* 준비 뒤 2초 동안 0.25초마다 한 번 더 — 처음부터 하기로 이어 들어온 전투(1-1A→월드→1-2)는 준비 직후 apply 뒤 다음 apply 가 2초 뒤에야 와서, 그 사이 유닛 그림(스프라이트)이 늦게 차며 가림판이 옛 유닛 사각으로 남아 맨 아래 레인저가 바위 위에 보였다
     *   (사장님 10-27 「아직도 잠깐씩 맨 아래 레인저가 벽 위에 올라가있어」·「처음부터 하기로 진행했을때만 그래」 · 헤드리스 재현: 걷힘 46.9초 틱5 → 다음 틱6 48.9초에 바로잡힘) */
    /* ★ 2초가 지나도 유닛 그림(스프라이트)이 다 안 왔으면 다 올 때까지 계속(최대 15초) — 그림이 늦게 오면 그 뒤 첫 갱신(대사 시작)까지 가림판이 안 그려져
     *   캐릭터가 벽·축대 위에 올라와 있다가 대사가 시작되면 가려졌다 (11-09 사장님 「왜 가림판정이 맵 로드후 진행 중에 시작되는건데? … 이건 예전부터 이야기한건데!」)
     *   그림이 왔는지 = 유닛 상자 _layers (render.js updateUnit 이 «그림이 아직»이면 건너뛰는 그 값) */
    var 유닛그림다옴 = function () { var 표U = R.unitEls || {}; for (var id in 표U) { var 상 = 표U[id], uu = 상 && 상._unit; if (!상 || (uu && uu.alive === false) || 상.style.display === 'none') continue; if (!(상._layers || []).length) return false; } return true; };
    (function 뒤갱신(n, 다옴셈) { if (R._리마스터3D !== 표 || n <= -52) return; var 다 = 유닛그림다옴(); 다옴셈 = 다 ? 다옴셈 + 1 : 0; if (n <= 0 && 다옴셈 >= 2) return;
      setTimeout(function () { if (R._리마스터3D !== 표) return; try { R.apply(); } catch (e) {} 뒤갱신(n - 1, 다옴셈); }, 250); })(8, 0);
    console.log('[리마스터3D] ' + 이름 + ' 준비 — 굽기 ' + 표.굽기ms + 'ms · 건물 ' + (구운것.자료.건물 || []).length + ' · 세움 ' + (구운것.자료.세움 || []).length);
    return 표;
  }

  /* ★ 대본이 맵 칸을 바꾸면(op 0x10 · controller 맵바뀜) 지금 battle.map 층으로 3D 를 다시 굽는다 — 3D 는 맵을 열 때 원본 파일로 한 번만 구워
   *   바뀐 칸(26-1 봉화 불 · 18-5C 길 열기 등)이 3D 에 안 나왔다 (사장님 10-26 고르심 «1 — 3D 를 다시 굽기») */
  /* 스케일러를 바꾸면 3D 맵 그림도 새 배율로 다시 굽는다 — 지정본그리기 텍스처가 G2Scaler 배율로 키워 올린다 (사장님 10-27 「1. 3d맵에 스케일러 적용하기.」) */
  try { if (root.G2Scaler && root.G2Scaler.onChange) root.G2Scaler.onChange(function () { try { var 렌 = root.G2BattleRuntime && root.G2BattleRuntime.렌더러 ? root.G2BattleRuntime.렌더러() : root.R; if (렌 && 렌._리마스터3D && 렌._리마스터3D.이름 && 렌.nmap) 다시굽기(렌, 렌.nmap); } catch (e) {} }); } catch (e) {}
  function 다시굽기(R, map) {
    var s = R && R._리마스터3D;
    if (!s || !s.이름 || !map || !map.layerA) return Promise.resolve({ 상태: '3D 없음' });
    var 층 = { layerA: Uint16Array.from(map.layerA), layerB: Uint16Array.from(map.layerB), layerC: Uint8Array.from(map.layerC) };
    return 맵준비(R, s.이름, s.mapx, 층);
  }
  /* 3D 준비가 끝나는 약속을 렌더러에 건다 — 전투 로딩 화면(battle_boot 맵기다리기)이 3D 까지 다 뜬 뒤에 걷는다
   *   (10-27 사장님 「3d 맵 적용하면서 로드하는데 … 일부만 먼저 불러와지고 순차적으로 로드가 돼. 완전히 로드되기 전까지 로딩화면으로 덮는게 좋을 것 같은데」 —
   *    render.js 는 맵준비를 기다리지 않고 맵 짓기 약속을 푼다) · 실패·끔·맵 바뀜도 풀린다 */
  function 맵준비걸기(R, 이름, mapx) {
    /* 로딩 화면이 안 열린 길(이벤트로 이어지는 전투 등)에서도 3D 로 보는 중이면 다 뜰 때까지 덮는다 — 직접 연 것만 직접 닫는다
     *   (10-27 사장님 「전투 진입시 로딩화면 제대로 안나올때가 있어」) */
    var L = root.G2전투로딩, 내가 = false;
    try {
      var 슬 = function (id) { var e = root.document && root.document.getElementById(id); return e ? +e.value || 0 : 0; };   /* 체인 재진입은 슬라이더 값을 다음 틱에 다시 넣는다(battle_main G2시점다시적용) */
      var 보임 = R && R.cam && (R.cam.tilt || R.cam.rot || 슬('tilt') || 슬('rot')) && !root.__리마스터3D끄기 && 스위치() && 켜는맵[String(이름 || '').toUpperCase()] !== false;
      if (보임 && L && L.열려있나 && !L.열려있나()) { L.열기(1); 내가 = true; }
    } catch (e) {}
    var p = 맵준비(R, 이름, mapx);
    try {
      R._리마스터3D대기 = Promise.resolve(p).then(function () {}, function () {}).then(function () {
        if (!내가) return;
        return new Promise(function (끝) {   /* 다 그린 화면이 한 번 나간 뒤 걷는다 */
          var 걷기 = function () { try { if (L.열려있나()) L.닫기(); } catch (e) {} 끝(); };
          if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(걷기); }); else 걷기();
        });
      });
    } catch (e) {}
    return p;
  }
  root.G2리마스터3D = { 남굽기: 남굽기,   /* 마을 실내 규칙이 다른 맵 구운 자료를 빌린다 */ 맵준비: 맵준비걸기, 다시굽기: 다시굽기, 걷기: 걷기, 켜는맵: 켜는맵, 스위치: 스위치, _굽기: 굽기, 높이값: 높이값,   /* 마을 화면 3D(town3d.js)도 같은 «3D 높이» 값 */
    /* 시험용 — 감싼 창구를 안 거치는 연출(필살기 안쪽 길 직접 부르기)에 시전자·대상을 알려 준다 */
    연출유닛: function (목) { 연출유닛 = 목 && 목.length ? 목 : null; },
    현재연출유닛: function () { return 연출유닛; },
    세로보정: function (v) { if (v != null) 세로보정 = Math.max(0, Math.min(100, +v)); return 세로보정; },
    /* 시험용 — 화면판 맞추기를 지금 한 번 돌리고 옮긴 판 수나 오류를 돌려준다 */
    화면판시험: function () { var R = root.R, s = R && R._리마스터3D; if (!s) return '3D 없음'; try { 화면판맞추기(R, s); return '옮긴 판 ' + (s.화면판 ? s.화면판.size : 0); } catch (e) { return String(e && e.stack || e).slice(0, 500); } } };
})(typeof window !== 'undefined' ? window : globalThis);
