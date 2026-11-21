/* ============================================================================
 *  마을 화면 리마스터 3D — 도구(04_도구/_맵3D/지정보기.html)로 만든 마을 3D 를 게임 마을 화면에 그린다
 *
 *  사장님 (2026-11-04): 「마을맵 3d 게임에 적용해줘.」 ·
 *    「이미 마을맵 작업 거의 끝났어. 기존에 3d 작업한것들을 게임에 적용하라는거야」 ·
 *    「요소 지정된 모든맵 전부 적용해야해. 그리고 앞으로 개선하는 부분도 자동으로 반영되어야 해」
 *
 *  ① 굽기 — 전투와 같은 창구(G2리마스터3D._굽기)로 «마을_<맵>» 을 굽는다.
 *     원본 CSTLDATA/<맵>.MAP + 맵 설정 CSTLDATA/<맵>.요소지정.json(도구가 구울 때마다 내보냄) · 픽셀 첨부 없음
 *  ② 그리기 — 전투와 같은 그리기 모듈(G2지정본그리기 = 지정보기에서 만든 것)로 WebGL 캔버스에 그리고,
 *     그 그림을 마을 화면 캔버스에 통째로 얹는다. 바닥·위층(건물·나무)은 3D 장면이 대신한다.
 *  ③ 인물 — 마을 화면이 그리던 그대로(정렬·그림)를 «발밑 점 → 3D 땅 위 투영 점» 변환만 걸어 그린다.
 *  ④ 켜는 때 — 개발 패널 기울기·회전이 0 이 아닐 때만 (0 이면 원작 평면 화면 그대로 · 전투와 같은 규칙)
 *     카메라 = 패널 기울기·회전·배율·원근·시야 + 마을 카메라(화면 가운데 = 카메라 픽셀 + 160·100)
 * ==========================================================================*/
(function (root) {
  'use strict';

  var 준비번호 = 0;
  var 상태 = null;   /* { 키, 이름, 준비됨, 실패, 장면, 가림, 캔버스, 가림캔버스, 캠, 세계 } */

  /* ★ 덮개 모양 (2026-11-08 · 03_분석/맵3D_마을가림_전수.md) — 인물 발밑을 덮는 갓돌·경계석 위층 조각의 그림키(townview 그림열쇠)
   *   고른 법(사장님 11-08 「가려지는 타일 모양을 선정하는건 기존에 가림처리가 적용되어있는 타일을 바탕으로 선정하고 … 적절한 경우 동일한 모양에 모두 적용한다」):
   *   옛 축대 덮개가 실제로 걸리던 조각(축대 띠 칸·그 바로 옆 눕힌 조각 · 덧칠·건물 칸·세운 칸 제외)의 모양 전부 — 마을 야외 28맵 조사.
   *   덮개 그림 = 이 모양이 3D 바닥 그림(지형c2 · 덧칠·건물 뒤 포함)에서 «제 불투명 화소 색 그대로» 보이는 화소만. 땅 화소는 안 넣는다(칸째 넣으면 일직선으로 잘린다 — 사장님 11-08). */
  var 덮개모양 = {}; [
    '038f6707c202 05071f712266 061b9391c58d 070bcf192859 082dbee9c05d 0965787d93fe 099fed3b1dc9 09af56210b0b 09f5b1f34bb4 0aab66a94f03',
    '0c19c77e82d5 10130ca7c61b 107268eb8ed6 1074adedb36a 1105d04698ca 117b780eae9a 11872ad51ba8 13bfcdaa617e 13f5932d12ca 157aaead5039',
    '1604ac65e5c0 16154b9aa015 1a146be20ffc 1a374cc859ef 1a3ffaf9efd1 1c037fb97d18 1c5cea42dc5f 1d0d5aa12574 1d7735282fab 1d9140ee5554',
    '1f6d9573517c 2228f50483d8 233216c194bb 23aaff40901e 248c3793c44a 26246143fc41 2a64c7a2398d 316ef1ab2df5 325db73292f6 32b47c575e43',
    '3447959680ea 34551ba795b0 35ac48fe371c 36df9c69480b 37f2b83c1c0c 381fc408ecd5 39af6fd1aa9a 39f775ae757b 3a65265e3461 3afa4b0b86fb',
    '3deea53a9e81 3e2ac5dd48ed 40b970ee4f06 414ca0f0b8a7 415b92e5b3c2 422eaa4d4244 42ee745c2e9d 43cb6ef92423 450d019bdc1b 4937dde1a8db',
    '53501992d541 5426b6425cd4 556552db61dc 56cf886bf1b7 56f4fe7122a6 5842a4e9d9d8 592d9fb14e1b 5ad7e2984ccd 5f2365175f5c 5f63fafad191',
    '60dc5d706404 616c09a5f5bd 62d0d7fc7d0c 634341704ca4 641e6d812cd9 65077eb92335 657bf9eb81fe 665444d1154e 67161e47d2e6 69480b78074b',
    '6a5a80c639b7 6abd01a00c8a 6b1f411c5ea4 6b4f8f7f173f 6c3d84b6a145 6d15a17dca52 6d5395ba4327 6d7d4c51a395 6e588eeac043 6e9fdaf29a7a',
    '6f315f3e3964 6f6e668491c1 6fc2f7762f43 7067be55cc72 730f5d0d1af3 7329727f81c6 73f29a973363 74a2280358c6 757e97f7fdb2 76009f764bd4',
    '783fc3213774 7850bcacafab 78b38c6d2af3 78e243ce0709 78e3ca90eaac 7a191931fc56 7a5837e69066 7c916f6dc5c2 7ca3c24420f2 7dd214f472c8',
    '7decc4a937a8 7dfd4579b383 7dfec4d55ab3 7f53a055c536 7f63d6c7c877 8076c9e5803f 80bf0951054d 81dc4542cdb6 8325a234d2ea 8372d27fbb0e',
    '84ace67ffbb4 84e5951f9d3a 8c2ef4e79ed9 8c500d50c4c3 8d54f2168952 8d7ec4835442 8e044598f26c 8ea39ceac45f 8ea7a983fdb5 9050252432bf',
    '9112cc3845a0 9533a50b5e22 95e0cae66251 963d65411c2b 97d19d8de6e6 9810947e9b72 994b52283ef6 995d745644ac 996f7cd4046e 9971dc50469b',
    '99c0da5f88fd 99cd54c0ac46 9c835c5dcbc5 9ec010d71e81 a0bc3b35b286 a12bb83f512c a1f69ffc4f5d a3279b39864e a511a6ad1281 a521bdf84a4a',
    'a8ed92d08828 a903f577160d a9d78f30fea9 aa1048e2b830 abab0be5a84c ac179626b380 b0138c51525b b11bb5e99b07 b3251fda99b0 b358934bbe21',
    'b381025a7d63 bae2d7b53411 bb291c700db4 bbc9e94c3344 bc78fccb3ee3 bd0ba875e458 bd2e6f01ffbe bdca5be6d6c0 be80fd6aaea3 be85d31c7f74',
    'bf5b151d6e79 c446cfe0081b c7129516544f c8bd15ba13d5 ca305ae97ab0 ca36e1ea7fb7 cb03aa0c8740 cdf060350460 cf362e9e6218 cf521754a027',
    'd177d1f85c7c d2d05548be03 d648c1f3df01 da4b8161b92f da5fb86cafb9 db9ccd74c698 dbe230330eca dc10f2170ed7 e2c2330dec8f e35edc7a668e',
    'e60da511e9c6 e8255c1a2059 e9e66d289343 edda44b5ebce ef6af4f5f66d efbab9351f12 f0d962f4ee22 f0ddad290f90 f2e47b57b6bf f301845bd325',
    'f68811dded0d f7951711487c f7cc0d4f9638 fa07a23ade65 fa2926a7113b fe153edb240f ff8ca13a3f2f ffb1a88042db'
  ].join(' ').split(' ').forEach(function (k) { 덮개모양[k] = 1; });
  var 덮개뺌 = {};   /* 사장님이 «이건 아니야» 하신 그림키 — 문서 §0 */

  /* 시점 손잡이 — 셸 개발 도구(#셸개발몸 · 모든 화면에 뜸)에 «마을 3D» 기울기·회전·배율을 붙인다 · 전투 패널(#tilt …)과 아이디를 나눈다(전투 무대가 서면 셸 칸은 물러나지만 요소는 남는다) · 값은 이 브라우저에 기억 */
  /* ★ 전투·마을 한 시점 — 기울기·회전은 G2공유시점(이 브라우저에 기억) · 처음 값 기울기 45 · ?sce= 직행(측정·대조 도구)은 0 (11-05 사장님 고르심 «전투와 묶고 기본 3D(45)») */
  var 공유저장키 = '공유시점';
  var 직행 = false; try { 직행 = /[?&]sce=/.test(root.location ? root.location.search : ''); } catch (e) {}
  /* ★ 시점 다섯 값(기울기·회전·배율·원근·시야)을 전투·마을이 한 값으로 — 개발 패널에는 셸 줄 한 벌만 (전투 칸의 같은 막대는 감춤 · 전투 프리셋은 그대로 이 값을 바꾼다)
   *   기본 = 전투 시점기본(battle_main.js · zoom 30 · dist 0 · fov 34) · ?sce= 직행(측정·대조 도구)은 기억값을 안 읽는다
   *   (사장님 11-05 「개발도구 전투와 월드(마을 포함) 통합해줘」 · 11-06 「월드랑 전투 개발도구 통합하랬잖아」) */
  var 기울기최대 = 80;   /* [리마스터] 마을·전투 카메라 기울기 위 끝 — 써 보고 조정 (사장님 11-06) */
  var 공유기본 = { tilt: 직행 ? 0 : 45, rot: 0, zoom: 30, dist: 0, fov: 34 }, 공유값 = JSON.parse(JSON.stringify(공유기본));
  try { var 옛공 = JSON.parse(root.localStorage.getItem(공유저장키) || 'null'); if (옛공 && !직행) Object.keys(공유값).forEach(function (k) { if (옛공[k] != null && isFinite(+옛공[k])) 공유값[k] = +옛공[k]; }); } catch (e) {}
  function 시점글(k, v) { return k === 'zoom' ? (v / 30).toFixed(2) + '×' : k === 'dist' || k === 'fov' ? String(v) : v + '°'; }
  function 줄맞춤(k) { var d = root.document; if (!d) return; var v = 공유값[k], 막 = d.getElementById('마을3D_' + k), 수 = d.getElementById('마을3D수_' + k), 글 = d.getElementById('v마을3D_' + k);
    if (막 && +막.value !== v) 막.value = v; if (수 && 수.value !== String(v) && d.activeElement !== 수) 수.value = v; if (글) 글.textContent = 시점글(k, v); }
  root.G2공유시점 = { 기본값: function () { return JSON.parse(JSON.stringify(공유기본)); },
    기본으로: function () { Object.keys(공유기본).forEach(function (k) { root.G2공유시점.쓰기(k, 공유기본[k]); }); if (typeof root.G2시점다시적용 === 'function') try { root.G2시점다시적용(); } catch (e) { } },   /* 패드 R3 — 시점 기본값으로 (사장님 11-06 「r3 카메라 시점 기본값으로가 적용이 안돼」) */
    읽기: function (k) { return 공유값[k] != null ? 공유값[k] : 0; },
    쓰기: function (k, v) { if (!(k in 공유값) || !isFinite(+v)) return; if (k === 'tilt') v = Math.max(0, Math.min(기울기최대, +v));   /* 기울기 0~80 — 0 = 원작 평면 (사장님 11-06 「낮추는건 0도까지 … 높이는건 우선 80까지」) */ 공유값[k] = +v; try { root.localStorage.setItem(공유저장키, JSON.stringify(공유값)); } catch (e) {} 줄맞춤(k); } };
  function 손잡이() {
    var d = root.document, 몸 = d && d.getElementById('셸개발몸');
    if (!몸 || d.getElementById('마을3D줄')) return;
    var 줄 = d.createElement('div'); 줄.id = '마을3D줄';
    /* 숫자 칸 — 막대는 한 픽셀에 몇씩 움직여 정확한 값을 못 맞춘다 → 쳐 넣거나 ↑↓ 로 1씩 · «0/기본» 단추 (사장님 11-06 「한픽셀만 움직여도 몇도씩 튀고」·「원근도 값 한픽셀에 몇씩 튀어서 … 슬라이드 늘릴수도 없고」) */
    줄.innerHTML = '<style>#셸전투칸 label:has(> #tilt), #셸전투칸 label:has(> #rot), #셸전투칸 label:has(> #zoom), #셸전투칸 label:has(> #dist), #셸전투칸 label:has(> #fov) { display: none !important; } #마을3D줄 input[type=number] { width: 56px; }</style>' +
      [['tilt', '3D 기울기', 0, 기울기최대, '0'], ['rot', '3D 회전', -180, 180, '0'], ['zoom', '3D 배율', 10, 120, '기본'], ['dist', '3D 원근', -400, 1200, '기본'], ['fov', '3D 시야', 12, 100, '기본']].map(function (q) {
      return '<label title="전투·마을 같은 값 · 기울기·회전이 0 이면 원작 평면 화면 그대로입니다">' + q[1] + ' <b id="v마을3D_' + q[0] + '"></b><input type="range" id="마을3D_' + q[0] + '" min="' + q[2] + '" max="' + q[3] + '" step="1">' +
        '<input type="number" id="마을3D수_' + q[0] + '" min="' + q[2] + '" max="' + q[3] + '" step="1"><button type="button" id="마을3D0_' + q[0] + '">' + q[4] + '</button></label>'; }).join('');
    몸.appendChild(줄);
    ['tilt', 'rot', 'zoom', 'dist', 'fov'].forEach(function (k) { var 막 = d.getElementById('마을3D_' + k), 수 = d.getElementById('마을3D수_' + k), 단 = d.getElementById('마을3D0_' + k);
      var 넣기 = function (v) { v = Math.round(+v); if (!isFinite(v)) return; v = Math.max(+막.min, Math.min(+막.max, v)); root.G2공유시점.쓰기(k, v); if (typeof root.G2시점다시적용 === 'function') try { root.G2시점다시적용(); } catch (e) {} };
      막.oninput = function () { 넣기(막.value); };
      수.onchange = function () { 넣기(수.value); 수.value = 공유값[k]; };
      수.oninput = function () { if (수.value !== '' && isFinite(+수.value)) 넣기(수.value); };
      단.onclick = function (e) { e.preventDefault(); 넣기(공유기본[k] && k !== 'tilt' ? 공유기본[k] : 0); };
      줄맞춤(k); });
  }
  /* 게임이 뜨자마자 시점 줄을 단다 — 마을을 열 때만 달아 전투(직행·월드에서 바로)엔 줄이 없었다 */
  (function 걸기(n) { try { 손잡이(); } catch (e) {} if (n < 100 && !(root.document && root.document.getElementById('마을3D줄'))) setTimeout(function () { 걸기(n + 1); }, 200); })(0);
  /* 벽 내리기 방식 — 이 브라우저에 기억 · 그리기 모듈의 벽내리기 값으로 */
  function 벽내리기값(v) { if (v != null) { try { root.localStorage.setItem('실내벽내리기', v); } catch (e) {} if (상태 && 상태.장면) { 상태.장면.값('벽내리기', v); 상태.가림.값('벽내리기', v); } return v; }
    try { var t = root.localStorage.getItem('실내벽내리기'); if (t === '칸') t = '끔'; if (t === '끔' || t === '화면' || t === '전체') return t; } catch (e) {} return '끔'; }   /* 11-06 «정해진 칸» 뺌 · 기본 끄기 */
  function 슬(id, 기본) { if (id in 공유값) return 공유값[id]; return 기본; }   /* 시점 다섯 값 = 전투와 한 값 */
  function 스위치() { var R3 = root.G2리마스터3D; if (root.__리마스터3D끄기) return false; return !R3 || !R3.스위치 || R3.스위치(); }
  /* 정본 260 — 지금 마을 맵의 3D 일 때만 켠다: 원작 평면으로 다른 맵에 들어오면 앞 맵 상태가 남아 있어 기울이는 순간 앞 맵 3D 가 그려질 뻔했다 */
  function 지금맵인가() { var k = root.__마을맵 && root.__마을맵.키; return !k || !상태 || 상태.키 === String(k).replace(/.MAP$/i, '').toUpperCase(); }
  function 켬() { return !!(상태 && 상태.준비됨 && 지금맵인가() && 스위치() && (슬('tilt', 0) || 슬('rot', 0))); }
  /* 정본 260 — 3D 를 쓸 때(기울기·회전이 있고 스위치가 켜졌을 때)만 굽는다 · 원작 평면에서도 맵마다 굽기(지정본굽기 + 지형 그림 4배 키우기 ×6 · 약 3초)가 로딩창이 닫힌 «뒤»에 돌아
   *   새 맵에서 주민·키 입력이 멈췄다 (사장님 11-17 「이동한 직후에 아직도 버벅거리면서 엔피씨 이동도 중간에 잠시 멈추고 키 입력도 안먹혀」·「3d에서는 덜하고 원작평면일때 더 심해」) */
  function 쓸까() { return !!(스위치() && (슬('tilt', 0) || 슬('rot', 0))); }
  /* 원작 평면으로 들어온 맵에서 나중에 기울기를 바꾸면 그때 굽기 시작 — 매 프레임 그리기() 가 부른다 */
  function 필요하면준비() {
    if (!쓸까()) return;
    var 키 = root.__마을맵 && root.__마을맵.키; if (!키) return;
    var 원 = String(키).replace(/.MAP$/i, '').toUpperCase();
    if (상태 && 상태.키 === 원) return;   /* 굽는 중 · 다 구움 · 실패 — 다시 안 부른다 */
    준비(키);
  }

  function 버리기() {
    if (상태 && 상태.장면 && 상태.장면.gl) { try { var ex = 상태.장면.gl.getExtension('WEBGL_lose_context'); if (ex) ex.loseContext(); } catch (e) {} }
    if (상태 && 상태.가림 && 상태.가림.gl) { try { var ex2 = 상태.가림.gl.getExtension('WEBGL_lose_context'); if (ex2) ex2.loseContext(); } catch (e) {} }
    상태 = null;
  }

  var 유형약속 = null;
  function 맵유형받기() { if (!유형약속) 유형약속 = fetch(typeof root.G2URL === 'function' ? root.G2URL('CSTLDATA/_마을맵유형.json') : '/원본/CSTLDATA/_마을맵유형.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }); return 유형약속; }

  /** 맵이 바뀔 때 — 키 = 'GEYSIR.MAP' */
  function 준비(키, 새로) {
    try { 손잡이(); } catch (e) {}
    var 원 = String(키 || '').replace(/\.MAP$/i, '').toUpperCase(), 이름 = '마을_' + 원;
    if (상태 && 상태.키 === 원 && !새로) return 상태.약속;
    var 차례 = ++준비번호, 이전 = 새로 && 상태 && 상태.준비됨 ? 상태 : null;
    if (!이전) 버리기();
    var R3 = root.G2리마스터3D, 그 = root.G2지정본그리기;
    var 내것 = { 키: 원, 이름: 이름, 준비됨: false, 캠: { tilt: 0, rot: 0, dist: 0, fov: 34, zoom: 1, cx: 0, cy: 0 } };
    if (!이전) 상태 = 내것;
    if (!R3 || !R3._굽기 || !그) { 내것.실패 = '모듈 없음'; return (내것.약속 = Promise.resolve(false)); }
    var 맵유형 = null;
    var 높처음 = R3.높이값 ? R3.높이값(이름) : 100;
    내것.약속 = 맵유형받기().then(function (t) { 맵유형 = t; return R3._굽기(이름, null, null); }).then(function (r) {
      if (차례 !== 준비번호) return false;
      if (!r || r.실패) { 내것.실패 = r && r.실패 || '굽기 실패'; return false; }
      /* 실내 맵(81개) — 도구 실내 규칙(실내공통규칙.js · 그리기 모듈 안에 들어 있음)이 읽는 자료를 넘긴다: 맵 유형 표(CSTLDATA/_마을맵유형.json) · 바닥·오브 시트(굽기가 원본 .MAP 에서 만듦) · 다른 맵 구운 자료(남굽기) (11-05 사장님 「실내맵은?」) */
      var 실내 = null;
      if (r.유형 && r.유형.실내) { 실내 = { 맵유형: 맵유형, 바닥: r.실내자료 && r.실내자료.바닥, 오브: r.실내자료 && r.실내자료.오브, 오브표: r.실내자료 && r.실내자료.오브표, 남: function (nm) { return R3.남굽기(nm); } }; }
      var d = root.document, cv = d.createElement('canvas'), cv2 = d.createElement('canvas');
      cv.width = cv2.width = 320; cv.height = cv2.height = 200;
      function 환경(캔버스, 가림판) { return {
        캔버스: 캔버스, 가림판: 가림판, 가림안티: 가림판, 장면캔버스: 가림판 ? cv : null, 맵: 이름,
        자료: 가림판 ? JSON.parse(JSON.stringify(r.자료)) : r.자료, 그림: r.그림, 묶음틀: r.묶음틀, 덧칠: r.덧칠 || null,
        배경막: 0, 설정: { amp: 높처음 },   /* 높이를 만들 때부터 — 다 만든 뒤 바꾸면 옆면(쪼갬 옆면) 판이 옛 높이로 남아 축대 옆면이 비었다(검은 틈) */
        실내: 실내, 맵자료: r.실내자료 || null,   /* 야외 울타리도 기존 메모리 바닥·오브 자료를 소비. 실내 규칙 활성화와 분리 (2026-11-06). */
        카메라: function () { var c = 내것.캠; return { tilt: c.tilt, rot: c.rot, dist: c.dist, fov: c.fov, zoom: c.zoom, cx: c.cx, cy: c.cy, vcx: c.cx, vcy: c.cy }; },
        투영: root.G2Projection,
        투영옵: function () { return { 흔들: { x: 0, y: 0 } }; },
        dpr: 1
      }; }
      내것.캔버스 = cv; 내것.가림캔버스 = cv2;
      내것.장면 = 그.만들기(환경(cv, false));
      내것.가림 = 그.만들기(환경(cv2, true));
      var 자 = 내것.장면.지정 && 내것.장면.지정();
      내것.세계 = { mapW: (자 && 자.W || 0) * 24, mapH: (자 && 자.H || 0) * 16, TW: 24, TH: 16 };
      return Promise.all([내것.장면.준비, 내것.가림.준비]).then(function () {
        if (차례 !== 준비번호) return false;
        var 높 = R3.높이값 ? R3.높이값(이름) : 100;   /* 높이는 준비가 끝난 뒤 — 앞서 넣으면 메시 전이라 높이갱신이 멈췄다 */
        내것.장면.값('amp', 높); 내것.가림.값('amp', 높);
        내것.덧칠목 = (r.덧칠 && r.덧칠.칠) || [];   /* 덮개 그림이 덧칠을 차례대로 따라 옮긴다 (11-08) */
        내것.덧칠칸 = {}; ((r.덧칠 && r.덧칠.칠) || []).forEach(function (c) { if (c && c.칸) 내것.덧칠칸[c.칸[1] * ((r.자료 && r.자료.W) || 0) + c.칸[0]] = 1; });   /* 사장님 덧칠 칸 — 원래 건물 그림이 덮던 자리 */
        내것.장면.값('벽내리기', 벽내리기값()); 내것.가림.값('벽내리기', 벽내리기값());
        내것.설정글 = r.설정글;
        if (이전) { 버리기(); 상태 = 내것; 내것.캠높 = 이전.캠높; }
        내것.준비됨 = true; return true; }, function (e) { if (차례 === 준비번호) { 내것.실패 = String(e && e.message || e); 내것.실패자리 = String(e && e.stack || '').slice(0, 600); } return false; });   /* 그리기 준비가 멈추면 그 마을은 원작 평면 */
    }, function (e) { if (차례 === 준비번호) 내것.실패 = String(e && e.message || e); return false; });
    return 내것.약속;
  }

  // 지정보기 저장 후 내보낸 설정을 기존 URL로 확인한다. 새 장면 완성 전에는 현재 장면 유지.
  var 설정확인중 = false;
  root.setInterval(async function () {
    var s = 상태;
    if (설정확인중 || !s || !s.준비됨 || !s.설정글 || (root.document && root.document.hidden)) return;
    설정확인중 = true;
    try {
      var p = 'CSTLDATA/' + s.키 + '.요소지정.json';
      var res = await fetch(typeof root.G2URL === 'function' ? root.G2URL(p) : '/원본/' + p, { cache: 'no-store' });
      if (!res.ok) return;
      var 글 = await res.text();
      if (상태 !== s || 글 === s.설정글) return;
      JSON.parse(글); // 저장 중 불완전한 응답이면 기존 장면 유지
      await 준비(s.키, true);
    } catch (e) { if (상태 === s) s.설정갱신오류 = String(e && e.message || e); }
    finally { 설정확인중 = false; }
  }, 1000);

  /** 마을 화면 바닥 대신 — 3D 장면을 그려 얹었으면 true (그때 바닥·위층은 안 그린다)
   *  캠x·캠y = 마을 카메라 픽셀(화면 논리 (0,0) 의 맵 픽셀) */
  function 그리기(ctx, 캠x, 캠y, ms) {
    if (!켬()) { 필요하면준비(); return false; }
    if (!ctx) return false;
    /* 화면 변환 = 논리배 배율 + 논리cx 밀기(넓은 화면) — 원본 320 의 가운데(160, 100) 가 투영 화면 가운데에 오게: 캔버스 가운데 = 논리 (LW/2 − cx) 자리라 카메라 중심을 그만큼 옮긴다 */
    var s = 상태, cv = ctx.canvas, w = cv.width, h = cv.height, n = h / 200, 폭 = root.__셸논리폭 ? root.__셸논리폭() : { LW: w / n, cx: 0 };
    /* 정본 278 — 이벤트 중엔 기울기를 30도로 고정한다: 많이 눕히면 맵 뒤 너머가 보여 빌 수밖에 없다 (사장님 11-18 「기울기가 많이 눕혀지면 당연히 빌수밖에 없어. 기울기를 어느정도로 고정해야해」 · 고르심 30도) · 끝나면 설정값으로 */
    var 가운데x = 폭.LW / 2 - (폭.cx | 0);
    s.캠 = { tilt: 지금기울기(), rot: 슬('rot', 0), dist: 슬('dist', 0), fov: 슬('fov', 34),
             zoom: n * 슬('zoom', 30) / 30, cx: 캠x + 가운데x, cy: 캠y + 100 - 당김() };
    { var 틀3 = 화면틀(캠x + 가운데x - 160, 캠y, true); s.캠.zoom = n * 틀3.z; s.캠.cx = 틀3.cx; }   /* 정본 263 — 3D 도 가로는 같은 틀(가운데 맵 안으로 · 표의 맵은 배율 하한) */
    /* 맵 끝 — 원래 카메라는 그대로, 주인공이 화면 가운데에서 한 칸 넘게 벗어난 만큼(=원래 카메라가 맵 끝에서 멈춘 만큼)만 3D 카메라를 더 민다 · 최대 세 칸 · 한 칸 안은 안 건드려 걸을 때 안 떨린다 (사장님 11-05 「카메라 왼쪽으로 더 이동할 수 있어야」) */
    { var 마1 = root.__상태 && root.__상태.town, 지끝 = s.장면.지정 && s.장면.지정(); if (마1 && 마1.좌표 && 지끝 && 지끝.실내벽) { var 죽 = function (d, k, m) { var a = Math.max(0, Math.abs(d) - k); return Math.sign(d) * Math.min(m, a); };
        var ex = 죽(마1.좌표.x * 24 + 12 - s.캠.cx, 30, 72), ey = 죽(마1.좌표.y * 16 + 8 - s.캠.cy, 20, 48);
        if (!s.끝 || s.끝이름 !== s.이름) s.끝 = { x: ex, y: ey }; else { s.끝.x += (ex - s.끝.x) * 0.12; s.끝.y += (ey - s.끝.y) * 0.12; }
        s.끝이름 = s.이름; s.캠.cx += s.끝.x; s.캠.cy += s.끝.y; } }
    /* 정본 266 — 위 실내 밀기가 맞춰 둔 가운데를 다시 밀어 그림 밖(오른쪽 검은 곳)이 보였다(DANCIN 3D) → 가로는 그림 범위 안으로 한 번 더 가둔다 */
    { var 범2 = 맵범위(), 폭2 = root.__셸논리폭 ? root.__셸논리폭() : null, LW2 = (폭2 && 폭2.LW) || 320, z2 = s.캠.zoom / (n || 1); if (범2 && z2 > 0) s.캠.cx = 가둠(s.캠.cx, 범2.x0 + LW2 / 2 / z2, 범2.x1 - LW2 / 2 / z2); }
    s.밀x = (폭.cx | 0) * n; s.사각 = [];
    /* 카메라가 화면 가운데 땅 높이를 따른다(전투와 같은 뜻) — 그 높이의 점이 화면 가운데 오게 중심을 화면 위쪽 방향으로 h·tan(기울기) 만큼 옮긴다 · 안 하면 높은 마을(3·4단)에서 주인공이 화면 위로 쏠렸다 */
    /* 카메라 높이 = 주인공이 선 칸의 땅 높이(부드럽게) — 화면 가운데 땅 높이를 쓰니 통로에서 벽 윗면·바닥이 번갈아 걸려 같은 높이에서 옆으로만 가도 화면이 위아래로 튀었다 (11-05 사장님 [그림] 「이런 통로를 좌우로 이동할때 카메라가 튀어. 위아래로 움직여서 정신없달까?」·「같은 맵 높이에서 옆으로 칸만 이동한거야」) */
    { var 마0 = root.__상태 && root.__상태.town, 목표 = 0; try { 목표 = 마0 && 마0.좌표 ? 칸높이(s, 마0.좌표.x, 마0.좌표.y) : (s.장면.높이(s.캠.cx / 24, s.캠.cy) || 0); } catch (e) {}
      { var 지0 = s.장면.지정 && s.장면.지정(); if (지0 && 지0.실내벽 && root.G2리마스터3D && root.G2리마스터3D.높이값) 목표 = (지0.실내벽.바닥층 || 0) * root.G2리마스터3D.높이값(s.이름) / 2; }   /* 실내는 늘 바닥 높이 (11-05 사장님 「실내에서는 항상 지면이어야해」) */
      s.캠높 = s.캠높 == null || Math.abs(s.캠높 - 목표) > 400 ? 목표 : s.캠높 + (목표 - s.캠높) * 0.15; var h0 = s.캠높; var t0 = s.캠.tilt * Math.PI / 180, r0 = s.캠.rot * Math.PI / 180, d0 = h0 * Math.tan(Math.min(t0, 1.4));
      s.캠.cx -= d0 * Math.sin(r0); s.캠.cy -= d0 * Math.cos(r0); }
    /* 정본 267 — 세로: 화면 아래 끝이 맵 그림 아래(원작처럼 끝 1.5줄 뺌)를 넘으면 그만큼 카메라를 올린다 (사장님 11-17 「좌우도 문제지만 상하도 확인해야해」)
     *   원근이라 화면 아래 끝이 닿는 맵 줄을 역투영으로 잰다(카메라 높이 땅 · 세 번 다시 짚음) · 위쪽은 맨 윗줄 너머가 뒷벽(그림)이라 가두지 않는다 · 회전이 있으면 세로가 맵 세로와 달라 건너뛴다 */
    { var 범3 = 맵범위(); if (범3 && s.세계 && !(+s.캠.rot) && root.G2Projection && root.G2Projection.역투영평면) { var 뷰3 = { 출력w: w, 출력h: h, dpr: 1 }, 점3 = { sx: w / 2, sy: h - 1 };
      for (var 회3 = 0; 회3 < 3; 회3++) { var q3 = null; try { q3 = root.G2Projection.역투영평면(s.캠, s.세계, 뷰3, 점3, s.캠높 || 0); } catch (e) { q3 = null; } if (!q3 || !isFinite(q3.y)) break;
        var 넘3 = (q3.y + s.세계.mapH / 2) - 범3.y1; if (넘3 <= 0.5) break; s.캠.cy -= 넘3; }
      /* 위가둠 맵 — 화면 위 끝도 그림 위(y0)를 안 넘게 · 위아래가 둘 다 넘치면 배율을 5% 씩 키운다(여섯 번까지) */
      /* 정본 278 — 이벤트 중에는 모든 마을에 위가둠: 3D 는 위를 안 가둬 왕궁(BIF) 이벤트에서 맨 윗줄 너머 검은 곳이 화면 절반 가까이 드러났다
       *   (사장님 11-18 「마을이벤트 계속 똑같잖아!」 [그림 #81] · 앞서 278 은 원작 평면만 고쳤다)
       *   뒷벽이 선 맵은 위 끝 높이를 «맨 윗줄 땅 높이»(그림 칸 가운데값)로 잰다 — 카메라 높이로 재면 뒷벽 윗부분까지 잘린다 */
      var 위가둠3 = 범3.위가둠 || 이벤트중(), 위높3 = s.캠높 || 0;
      if (위가둠3 && !범3.위가둠 && s.장면.높이) { var 줄높 = []; for (var 열3 = Math.floor(범3.x0 / 24); 열3 < Math.ceil(범3.x1 / 24); 열3++) { var 값3 = null; try { 값3 = s.장면.높이(열3 + 0.5, 범3.y0 + 8); } catch (e) { 값3 = null; } if (isFinite(값3)) 줄높.push(+값3); }
        if (줄높.length) { 줄높.sort(function (a, b) { return a - b; }); 위높3 = 줄높[줄높.length >> 1]; } }
      if (위가둠3) { var 역3 = function (sy, 높) { var q = null; try { q = root.G2Projection.역투영평면(s.캠, s.세계, 뷰3, { sx: w / 2, sy: sy }, 높); } catch (e) { q = null; } return (q && isFinite(q.y)) ? q.y + s.세계.mapH / 2 : null; };
        var 키움한도 = 범3.위가둠 ? 6 : 40;   /* 정본 278 — 이벤트는 상하좌우 여백 없이 다 찰 때까지 키운다(1.05^40 ≈ 7배) (사장님 11-18 「여백 안남게 채우는게 맞겠어」「상하 좌우 모두」) */
        for (var 회4 = 0; 회4 < 키움한도 + 4; 회4++) { var 위4 = 역3(0, 위높3), 밑4 = 역3(h - 1, s.캠높 || 0); if (위4 == null || 밑4 == null) break; var 위넘 = 범3.y0 - 위4, 밑넘 = 밑4 - 범3.y1;
          /* 정본 306 — «보이는 세로 폭 > 그림 세로 폭»이면 배율을 키운다 · 한도에 닿으면 위부터 맞춘다
           *   ☠ 전엔 «한 자리에서 위아래 둘 다 넘칠 때»만 키웠다 — 바로 앞 아래가둠이 아래를 맞춰 둬 둘이 함께 넘치는 일이 없어 위·아래 맞춤을 번갈아 하다
           *     횟수가 다 되면 «아래 맞춤»으로 끝나 가로로 긴(세로 짧은) 맵의 이벤트 화면 위가 비었다 (사장님 11-20 「아직도 마을이벤트시 화면 가로로 길쭉한 맵들 위쪽이 비어서 나와」)
           *   · 카메라를 위아래로 옮겨도 이 폭은 그대로다(역투영평면 y = y1 − dy) → 폭이 맞으면 한 번 옮겨 끝난다 */
          if ((밑4 - 위4) - (범3.y1 - 범3.y0) > 0.5) { if (회4 >= 키움한도) { s.캠.cy += 위넘; break; } s.캠.zoom *= 1.05; continue; }
          if (위넘 > 0.5) { s.캠.cy += 위넘; continue; } if (밑넘 > 0.5) { s.캠.cy -= 밑넘; continue; } break; } } } }
    s.n = n; s.캠x = 캠x; s.캠y = 캠y;
    /* 실내 앞벽 내리기 — 주인공 칸 기준(지정보기 시험 인물 자리 대신) */
    { var 마 = root.__상태 && root.__상태.town; if (마 && 마.좌표 && s.장면.사람자리) { s.장면.사람자리(마.좌표.x, 마.좌표.y, 0, 0); s.가림.사람자리(마.좌표.x, 마.좌표.y, 0, 0); } }
    if (ms != null && s.장면.애니걸음) { try { s.장면.애니걸음(ms); } catch (e) {} }
    if (s.캔버스.width !== w || s.캔버스.height !== h) { s.장면.크기(w, h); s.가림.크기(w, h); }
    else s.장면.그리기();
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(s.캔버스, 0, 0, w, h); ctx.restore();
    { var 사본 = s.장면판 || (s.장면판 = root.document.createElement('canvas')); if (사본.width !== w || 사본.height !== h) { 사본.width = w; 사본.height = h; } var sg = 사본.getContext('2d'); sg.clearRect(0, 0, w, h); sg.drawImage(s.캔버스, 0, 0, w, h); }   /* 원작 덮개용 장면 사본 — WebGL 그림판은 다음에 읽으면 비어 있다 */
    /* 참 깊이 가림 준비 — 가림판에 같은 장면을 한 번 그려 깊이를 채운다(인물마다 그 깊이와 견줌) · 다층 지붕·상자 건물·실내 벽까지 모두 가린다 (11-05 사장님 「마을 맵 전수 확인해서 캐릭터 가림이라던가 앞뒤관계 문제 해결해야해.」) */
    /* 덮개 지도 — 깊이 가림 준비(같은 가림판 캔버스를 덮는다) «앞»에 한 번 그려 2D 판으로 옮긴다 (11-08 · 맵3D_마을가림_전수.md) */
    s.덮개자료 = null;
    if (!root.__덮개끔 && s.가림.덮개지도그리기) try {
      var 덮텍 = null; try { 덮텍 = s.가림._평가 ? s.가림._평가('지형tex') : null; } catch (e) {}
      if (s.덮개 && 덮텍 !== s.덮개텍) s.덮개 = undefined;   /* 바닥 텍스처가 새로 만들어지면(늦게 얹힌 덧칠 등) 덮개도 다시 — 애니 타일은 같은 텍스처를 고쳐 써서 안 걸린다 */
      if (s.덮개 === undefined || (s.덮개 === null && s.덮개재시도 !== (root.__마을맵 && root.__마을맵.구운것))) { s.덮개재시도 = root.__마을맵 && root.__마을맵.구운것; s.덮개 = 덮개그림만들기(s); s.덮개텍 = 덮텍; }
      var 마9 = root.__상태 && root.__상태.town, 덮키 = s.덮개 ? [s.덮개.판본, w, h, s.캠.tilt, s.캠.rot, s.캠.dist, s.캠.fov, s.캠.zoom, s.캠.cx, s.캠.cy, 벽내리기값(), 마9 && 마9.좌표 ? 마9.좌표.x + ',' + 마9.좌표.y : ''].join('|') : '';
      if (s.덮개 && 덮키 === s.덮개키 && s.덮개판) { /* 카메라·크기·벽내리기·주인공 칸이 그대로면 지난 덮개 지도를 쓴다 — 매 장면 지형을 한 번 더 그려 초당 60→47 장으로 떨어졌다 (11-08 실측) */ }
      else if (s.덮개) {
        var 덮판 = s.덮개판 || (s.덮개판 = root.document.createElement('canvas')); if (덮판.width !== w || 덮판.height !== h) { 덮판.width = w; 덮판.height = h; }
        // GRIK 계단: MSAA로 행44가42로 섞여 인물이 비쳤다. 장면/깊이 AA는 유지한다.
        var 번호대상 = s.키 === 'GRIK' ? 덮판 : null;
        s.덮개정확 = false;
        if (번호대상) {
          // 이벤트/커서에는 기존 번호를 보존. 일반 인물만 PACK 후등록 동률 규칙과 정확 번호를 함께 쓴다.
          var 기존판 = s.덮개기존판 || (s.덮개기존판 = root.document.createElement('canvas'));
          if (기존판.width !== w || 기존판.height !== h) { 기존판.width = w; 기존판.height = h; }
          if (!s.가림.덮개지도그리기(s.덮개.그림, s.덮개.판본, 기존판)) throw Error('기존 덮개 번호 실패');
        }
        if (s.가림.덮개지도그리기(s.덮개.그림, s.덮개.판본, 번호대상, !!번호대상)) {
          if (!번호대상) { var dg = 덮판.getContext('2d', { willReadFrequently: true }); dg.clearRect(0, 0, w, h); dg.drawImage(s.가림캔버스, 0, 0, w, h); } s.덮개정확 = !!번호대상; s.덮개키 = 덮키;
        } else { s.덮개키 = null; 덮판.getContext('2d').clearRect(0, 0, w, h); }
      } else { s.덮개키 = null; if (s.덮개판) s.덮개판.getContext('2d').clearRect(0, 0, s.덮개판.width, s.덮개판.height); }
    } catch (e) { s.덮개오류 = String(e && e.message || e); }
    /* 컨트롤룸(마을_CONTROL·CONTROL2 · INSL07 규칙)은 «줄 차례» 가림판만 — 참 깊이는 세움 판·눕힌 기둥 면이 인물 판과 교차해 인물을 비스듬히 잘라내고 뒤 조각은 못 가렸다. 사장님 원칙: 남쪽 줄 조각 그림이 북쪽 인물을 통째로 덮는다 (11-11 「그냥 남쪽에 있는 오브젝트에 캐릭터가 그대로 가려지면 되잖아! 왜 자꾸 이상하게 잘라내는건데!」) */
    var 줄차례만 = false;   /* ☠ 11-12 컨트롤룸 «줄 차례만» 예외 걷음 — 참 깊이 가림을 쓴다(그림자는 땅 평판 비교로 보호) (사장님 「깊이가림 쓰게 해!」) · 11-11 예외는 세움 판·눕힌 기둥 면이 인물 판과 교차해 비스듬히 잘렸던 것 — 다시 나면 그 자리를 고친다 */
    /* 정본 349 — 깊이 가림 결과(덮인 모양)를 인물별로 남겨 둔다. 카메라·크기·벽내리기·주인공 칸이 그대로고 인물 판이 같으면 GPU 를 다시 읽지 않고
     *   지난 덮인 모양에 «이번» 장면 화소를 채워 덮는다(물 애니도 그대로 따라감). 인물마다 가림판을 2D 로 옮기는 GPU 되읽기가 한 번 20ms 넘어
     *   비프로스트 이벤트(인물 여럿)가 초당 4장이었다. 깊이가림시작(장면 한 번 더 그리기·장면 올리기)도 새 인물이 나올 때만 한다 */
    s.깊이차례 = (s.깊이차례 | 0) + 1; s.깊이시작 = false;
    { var 마8 = root.__상태 && root.__상태.town, 깊키 = [w, h, s.캠.tilt, s.캠.rot, s.캠.dist, s.캠.fov, s.캠.zoom, s.캠.cx, s.캠.cy, 벽내리기값(), 마8 && 마8.좌표 ? 마8.좌표.x + ',' + 마8.좌표.y : '', s.덮개텍 ? 1 : 0].join('|');
      if (깊키 !== s.깊이키 || !s.깊이캐시) { s.깊이캐시 = {}; s.깊이키 = 깊키; s.깊이불가 = false; }
      for (var 깊k in s.깊이캐시) if (s.깊이캐시[깊k].차례 < s.깊이차례 - 2) delete s.깊이캐시[깊k];
      if (s.덮개캐시) for (var 덮k in s.덮개캐시) if (s.덮개캐시[덮k].차례 < s.깊이차례 - 2) delete s.덮개캐시[덮k]; }
    s.깊이 = false; if (root.__마을깊이가림 !== false && !줄차례만 && s.가림.깊이가림시작 && s.가림.깊이가림) try { if (s.깊이불가 || root.__깊이캐시끔) { s.깊이 = !!s.가림.깊이가림시작(); s.깊이시작 = true; } else s.깊이 = true; }   /* ☐ 참 깊이 가림은 아직 시험 중(뒤 인물이 안 가려짐) — 켤 때까지 예전 가림판 */ catch (e) { s.가림오류 = String(e && e.message || e); }
    return true;
  }

  /** 인물 하나를 3D 땅 위에 — 발밑 논리 점(발x, 발y)을 투영 점으로 옮기는 변환을 걸고 그리기()를 부른다 */
  /* 칸에 선 인물의 땅 높이 — 원작에서 건물 그림이 덮는 북쪽 칸(굽기 «덮임»)은 그 건물 바닥 높이(지붕·벽 뒤에 가린다 · 11-05) */
  /* 바깥 마을 — 걸을 수 있는 칸인데 이웃 걸을 칸보다 한 층 넘게 높은 칸(성벽 윗길·탑 꼭대기 등 원작에서 벽 그림 뒤로 숨는 자리)은 이웃 바닥 높이로 · 층이 다른 벽 위로 기어오르지 않고 바닥에 선 채 벽에 가린다 · 축대 띠(계단) 칸은 그대로 (사장님 11-06 「층이 다른데 거기를 왜 기어올라가 … 층이 다르면 가려져야지」) */
  /* ☠ 다갈 마을만 — 계단을 축대로 안 칠한 마을(그릭)은 낮춤이 계단을 타고 번져 위층 2335칸이 아래층 높이로 내려가 인물이 땅에 묻혔다 (사장님 11-06 「그릭은 … 축대에서만 나타나고」·「층 올라가면 안나와」) */
  function 바닥표(s) { if (s.바닥 !== undefined) return s.바닥; s.바닥 = null; if (s.이름 !== '마을_DAGAL') return null; var 지 = s.장면.지정 && s.장면.지정(); if (!지 || 지.실내벽 || !지.갈수 || !지.지형높이) return null; var W = 지.W, H = 지.H, g = 지.갈수, h = Float32Array.from(지.지형높이), 띠 = {}; (지.축대구간 || []).forEach(function (q) { if (q.위 > q.아래) for (var yy = q.y0; yy <= q.y1; yy++) 띠[yy * W + q.x] = 1; });
    var 바뀜 = true, n = 0; while (바뀜 && n++ < 60) { 바뀜 = false; for (var i = 0; i < W * H; i++) { if (!g[i] || 띠[i]) continue; var x = i % W, lo = Infinity; [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i - W, i + W].forEach(function (k) { if (k >= 0 && k < W * H && g[k] && !띠[k]) lo = Math.min(lo, h[k]);   /* 축대 띠(비탈) 이웃은 빼다 — 축대 윗칸 바닥이 띠 아랫단으로 내려가 축대 뒤에 숨었다 */ }); if (lo < h[i] - 0.6) { h[i] = lo; 바뀜 = true; } } }
    s.바닥 = h; return h; }
  function 칸높이(s, x, y, 발mx, 발my) { var 지 = s.장면.지정 && s.장면.지정();
    // 덧칠·분리 건물층은 현재 발 화소의 지면을 공유한다. 칸 중심/이전 행을 참조하면 경계에서 뜨거나 묻힌다.
    // 서스카스는 아래의 기존 지붕·사다리 좌표 변환을 유지한다.
    if(지 && !지.실내벽 && s.이름 !== '마을_SUSCAS' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 발칸 = Math.floor(발my / 16) * 지.W + Math.floor(발mx / 24);
      if ((s.덧칠칸 && s.덧칠칸[발칸]) || (지.오브층 && 지.오브층.칠칸 && 지.오브층.칠칸.includes(발칸))) {
        var 발높 = s.장면.높이(발mx / 24, 발my); if(Number.isFinite(발높))return 발높;
      }
    }
    /* DRAKE 남쪽 확인5칸: 행 첫4px의 판 바깥 발 소유 보존. */
    if (지 && !지.실내벽 && s.이름 === '마을_DRAKE' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 남쪽발x = Math.floor(발mx / 24), 남쪽발y = Math.floor(발my / 16);
      if (발my - 남쪽발y * 16 < 4 && ((남쪽발y === 20 && (남쪽발x === 8 || 남쪽발x === 9 || 남쪽발x === 12 || 남쪽발x === 13)) || (남쪽발x === 1 && 남쪽발y === 22))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DRAKE 14행 확인2칸: 행 첫4px의 판 바깥 발 소유 보존. */
    if (지 && !지.실내벽 && s.이름 === '마을_DRAKE' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 중간발x = Math.floor(발mx / 24), 중간발y = Math.floor(발my / 16);
      if (발my - 중간발y * 16 < 4 && 중간발y === 14 && (중간발x === 30 || 중간발x === 33)) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DRAKE 북쪽축대 확인6칸: 행 첫4px의 판 바깥 발 소유 보존. */
    if (지 && !지.실내벽 && s.이름 === '마을_DRAKE' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 북쪽발x = Math.floor(발mx / 24), 북쪽발y = Math.floor(발my / 16);
      if (발my - 북쪽발y * 16 < 4 && ((북쪽발y === 5 && (북쪽발x === 16 || 북쪽발x === 21 || 북쪽발x === 24 || 북쪽발x === 25)) || (북쪽발x === 26 && 북쪽발y === 8) || (북쪽발x === 27 && 북쪽발y === 12))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DRAKE 인접축대 확인4칸: 행 첫4px의 판 바깥 발 소유 보존. */
    if (지 && !지.실내벽 && s.이름 === '마을_DRAKE' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 인접발x = Math.floor(발mx / 24), 인접발y = Math.floor(발my / 16);
      if (발my - 인접발y * 16 < 4 && ((인접발x === 14 && 인접발y === 26) || (인접발y === 28 && (인접발x === 24 || 인접발x === 27 || 인접발x === 28)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DRAKE 17,27: 행 첫4px의 현재 판 바깥 발 소유 보존. */
    if (지 && !지.실내벽 && s.이름 === '마을_DRAKE' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 드레이크발x = Math.floor(발mx / 24), 드레이크발y = Math.floor(발my / 16);
      if (발my - 드레이크발y * 16 < 4 && 드레이크발x === 17 && 드레이크발y === 27) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* CLIPS 확인평판28칸: 행 첫4px의 높은면/낮은길 실제 발 소유 공유. */
    if (지 && !지.실내벽 && s.이름 === '마을_CLIPS' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 클립스발x = Math.floor(발mx / 24), 클립스발y = Math.floor(발my / 16);
      if (발my - 클립스발y * 16 < 4 && ((클립스발x === 31 && (클립스발y === 28 || 클립스발y === 29)) || (클립스발y === 30 && ((클립스발x >= 1 && 클립스발x <= 17) || (클립스발x >= 22 && 클립스발x <= 30))))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* BASRA 확인갑판7칸: 행 첫4px의 현재 판 발 소유 공유. */
    if (지 && !지.실내벽 && s.이름 === '마을_BASRA' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 바스라발x = Math.floor(발mx / 24), 바스라발y = Math.floor(발my / 16);
      if (발my - 바스라발y * 16 < 4 && 바스라발y === 28 && 바스라발x >= 31 && 바스라발x <= 37) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LIOS 갑판1칸/MUTU 축대2칸: 행 첫4px의 현재 면 발 소유 공유. */
    if (지 && !지.실내벽 && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 연결발x = Math.floor(발mx / 24), 연결발y = Math.floor(발my / 16);
      if (발my - 연결발y * 16 < 4 && ((s.이름 === '마을_LIOS' && 연결발x === 11 && 연결발y === 33) || (s.이름 === '마을_MUTU' && 연결발y === 15 && (연결발x === 3 || 연결발x === 9)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DARIN 확인11칸: 행 첫4px의 현재 부분축대/갑판 발 소유 공유. */
    if (지 && !지.실내벽 && s.이름 === '마을_DARIN' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 다린발x = Math.floor(발mx / 24), 다린발y = Math.floor(발my / 16);
      if (발my - 다린발y * 16 < 4 && ((다린발x === 51 && 다린발y === 1) || (다린발y === 30 && (다린발x === 20 || 다린발x === 24 || 다린발x === 26 || (다린발x >= 43 && 다린발x <= 49))))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* BARAN 갑판 세칸: 행 첫4px의 현재 평판 발높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_BARAN' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 바란발x = Math.floor(발mx / 24), 바란발y = Math.floor(발my / 16);
      if (발my - 바란발y * 16 < 4 && 바란발y === 40 && 바란발x >= 23 && 바란발x <= 25) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* SAKARA 부분평판29칸: 행 첫4px도 현재 높은면/낮은길 발 소유 공유. */
    if (지 && !지.실내벽 && s.이름 === '마을_SAKARA' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 사카라발x = Math.floor(발mx / 24), 사카라발y = Math.floor(발my / 16);
      if (발my - 사카라발y * 16 < 4 && ((사카라발y === 31 && ((사카라발x >= 6 && 사카라발x <= 9) || (사카라발x >= 16 && 사카라발x <= 19))) || (사카라발y === 34 && ((사카라발x >= 1 && 사카라발x <= 5) || 사카라발x === 10 || 사카라발x === 14 || 사카라발x === 15 || (사카라발x >= 20 && 사카라발x <= 31))) || (사카라발x === 14 && 사카라발y === 35))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* CLIPS 부분평판 두칸: 행 첫4px도 현재 발의 높은면/낮은길 소유를 공유. */
    if (지 && !지.실내벽 && s.이름 === '마을_CLIPS' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 부분발x = Math.floor(발mx / 24), 부분발y = Math.floor(발my / 16);
      if (발my - 부분발y * 16 < 4 && ((부분발x === 31 && 부분발y === 27) || (부분발x === 21 && 부분발y === 30))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DAKAMA 둘째배 아래갑판 확인9칸: 행 첫4px의 현재 평판 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_DAKAMA' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 둘째발x = Math.floor(발mx / 24), 둘째발y = Math.floor(발my / 16);
      if (발my - 둘째발y * 16 < 4 && ((둘째발y === 82 && 둘째발x >= 27 && 둘째발x <= 34) || (둘째발x === 26 && 둘째발y === 87))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DAKAMA 첫배 아래갑판 확인11칸: 행 첫4px의 현재 평판 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_DAKAMA' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 아래발x = Math.floor(발mx / 24), 아래발y = Math.floor(발my / 16);
      if (발my - 아래발y * 16 < 4 && ((아래발y === 78 && (아래발x === 7 || (아래발x >= 9 && 아래발x <= 14))) || (아래발y === 79 && (아래발x === 6 || 아래발x === 8)) || (아래발x === 10 && (아래발y === 86 || 아래발y === 94)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DAKAMA 위갑판 확인18칸: 행 첫4px의 실제 갑판 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_DAKAMA' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 위발x = Math.floor(발mx / 24), 위발y = Math.floor(발my / 16);
      if (발my - 위발y * 16 < 4 && ((위발y === 71 && 위발x >= 7 && 위발x <= 13) || (위발y === 74 && (위발x === 10 || 위발x === 11)) || (위발y === 75 && 위발x >= 28 && 위발x <= 33) || (위발y === 77 && (위발x === 27 || 위발x === 30 || 위발x === 31)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* DAKAMA 배끝 평판3칸: 행 첫4px도 현재 높이2 갑판에 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_DAKAMA' && Number.isFinite(발mx) && Number.isFinite(발my) && 발my >= 97 * 16 && 발my < 97 * 16 + 4 && Math.floor(발mx / 24) >= 9 && Math.floor(발mx / 24) <= 11) return s.장면.높이(발mx / 24, 발my) || 0;
    /* DAKAMA 부분 갑판2칸: 행 첫4px도 현재 갑판 안팎의 발높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_DAKAMA' && Number.isFinite(발mx) && Number.isFinite(발my) && 발my >= 99 * 16 && 발my < 99 * 16 + 4 && (Math.floor(발mx / 24) === 25 || Math.floor(발mx / 24) === 35)) return s.장면.높이(발mx / 24, 발my) || 0;
    /* DAKAMA 확인 계단4칸·갑판 모서리1칸은 실제 발이 놓인 계단 높이. 계단 행 첫4px도 이전 행 중심으로 묶지 않는다. */
    if (지 && !지.실내벽 && s.이름 === '마을_DAKAMA' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 계단x = Math.floor(발mx / 24), 계단y = Math.floor(발my / 16);
      if ((계단x === 6 && 계단y === 96) || (계단x === 7 && (계단y === 76 || 계단y === 77)) || (계단x === 27 && (계단y === 80 || 계단y === 81))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 마지막 평판 확인12칸: 행 첫4px의 실제 발밑 면 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 끝발x = Math.floor(발mx / 24), 끝발y = Math.floor(발my / 16);
      if (발my - 끝발y * 16 < 4 && ((끝발y === 51 && (끝발x === 4 || 끝발x === 5)) || (끝발y === 52 && (끝발x === 5 || 끝발x === 17)) || (끝발y === 53 && 끝발x >= 6 && 끝발x <= 11) || (끝발x === 11 && (끝발y === 54 || 끝발y === 55)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 높은 평판 확인8칸: 행 첫4px의 실제 높은 면/낮은 면 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 고발x = Math.floor(발mx / 24), 고발y = Math.floor(발my / 16);
      if (발my - 고발y * 16 < 4 && ((고발y === 50 && (고발x === 39 || 고발x === 40)) || (고발x === 39 && 고발y === 51) || (고발y === 52 && 고발x >= 37 && 고발x <= 39) || (고발x === 37 && (고발y === 53 || 고발y === 54)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 남동쪽 확인11칸: 행 첫4px의 실제 평판/낮은 면 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 남동발x = Math.floor(발mx / 24), 남동발y = Math.floor(발my / 16);
      if (발my - 남동발y * 16 < 4 && ((남동발y === 50 && ((남동발x >= 28 && 남동발x <= 30) || 남동발x === 35)) || (남동발y === 51 && (남동발x === 30 || 남동발x === 35)) || (남동발y === 52 && 남동발x >= 31 && 남동발x <= 35))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 남서쪽 확인9칸: 행 첫4px의 현재 평판 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 남서발x = Math.floor(발mx / 24), 남서발y = Math.floor(발my / 16);
      if (발my - 남서발y * 16 < 4 && ((남서발y === 50 && 남서발x >= 23 && 남서발x <= 27) || (남서발y === 51 && 남서발x >= 19 && 남서발x <= 22))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 서쪽 확인6칸: 행 첫4px의 실제 평판 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 서발x = Math.floor(발mx / 24), 서발y = Math.floor(발my / 16);
      if (발my - 서발y * 16 < 4 && ((서발y === 40 && 서발x >= 2 && 서발x <= 5) || (서발x === 2 && (서발y === 41 || 서발y === 42)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 내부 확인9칸: 행 첫4px의 실제 평판/낮은 면 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 내발x = Math.floor(발mx / 24), 내발y = Math.floor(발my / 16);
      if (발my - 내발y * 16 < 4 && ((내발y === 39 && 내발x >= 20 && 내발x <= 23) || (내발x === 23 && 내발y === 40) || (내발x === 24 && 내발y === 41) || (내발x === 25 && 내발y >= 41 && 내발y <= 43))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 동쪽 확인15칸: 행 첫4px의 현재 평판 소유 높이 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 동발x = Math.floor(발mx / 24), 동발y = Math.floor(발my / 16);
      if (발my - 동발y * 16 < 4 && ((동발y === 37 && 동발x >= 36 && 동발x <= 41) || (동발y === 38 && 동발x >= 30 && 동발x <= 35) || (동발y === 39 && 동발x >= 28 && 동발x <= 30))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 중간 확인11칸: 행 첫4px의 실제 높은 면/낮은 면 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 중발x = Math.floor(발mx / 24), 중발y = Math.floor(발my / 16);
      if (발my - 중발y * 16 < 4 && ((중발x === 17 && (중발y === 31 || 중발y === 32)) || ((중발x === 18 || 중발x === 19) && 중발y === 31) || (중발x === 20 && 중발y >= 31 && 중발y <= 33) || (중발x === 10 && 중발y >= 32 && 중발y <= 34) || (중발x === 15 && 중발y === 33))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 확인3칸 행 첫4px: 현재 평판과 낮은 면의 실제 발높이만 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && Number.isFinite(발mx) && Number.isFinite(발my) && ((Math.floor(발mx / 24) === 39 && 발my >= 23 * 16 && 발my < 23 * 16 + 4) || (Math.floor(발mx / 24) === 2 && 발my >= 27 * 16 && 발my < 27 * 16 + 4) || (Math.floor(발mx / 24) === 8 && 발my >= 29 * 16 && 발my < 29 * 16 + 4))) return s.장면.높이(발mx / 24, 발my) || 0;
    /* SHIP 확인 행경계57칸: 행 첫4px의 갑판 바깥도 현재 발밑 면을 따른다. */
    if (지 && !지.실내벽 && s.이름 === '마을_SHIP' && Number.isFinite(발mx) && Number.isFinite(발my)) {
      var 줄발x = Math.floor(발mx / 24), 줄발y = Math.floor(발my / 16);
      if (발my - 줄발y * 16 < 4 && ((줄발y === 9 && (줄발x === 7 || 줄발x === 8 || 줄발x === 14 || 줄발x === 15)) || ((줄발x === 7 && 줄발y >= 10 && 줄발y <= 13) || (줄발x === 16 && 줄발y >= 10 && 줄발y <= 12)) || (줄발y >= 16 && 줄발y <= 20 && (줄발x === 7 || 줄발x === 16)) || (줄발y === 21 && 줄발x === 7) || (줄발y >= 21 && 줄발y <= 24 && 줄발x === 16) || (줄발y === 25 && 줄발x === 16) || (줄발y >= 26 && 줄발y <= 29 && (줄발x === 7 || 줄발x === 16)) || ((줄발y === 30 || 줄발y === 34) && (줄발x === 7 || 줄발x === 16)) || (줄발y >= 31 && 줄발y <= 33 && 줄발x === 16) || (줄발y === 35 && (줄발x === 7 || 줄발x === 8 || 줄발x === 15 || 줄발x === 16)) || (줄발y === 36 && (줄발x === 7 || 줄발x === 16)) || (줄발y === 37 && 줄발x === 15) || (줄발y === 38 && (줄발x === 8 || 줄발x === 15)) || (줄발y === 39 && 줄발x === 8) || (줄발y === 40 && 줄발x === 14) || (줄발y === 41 && (줄발x === 9 || 줄발x === 13)) || (줄발y === 42 && (줄발x === 10 || 줄발x === 13)))) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* SHIP (9,40) 행 첫4px: 높은 갑판에서 바깥 낮은 면으로 넘어가는 발 위치를 실제 면에 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_SHIP' && Number.isFinite(발mx) && Number.isFinite(발my) && Math.floor(발mx / 24) === 9 && 발my >= 40 * 16 && 발my < 40 * 16 + 4) return s.장면.높이(발mx / 24, 발my) || 0;
    /* SHIP (15,39): 상단 6화소 갑판만 현재 발 소유를 사용. 나머지는 기존 my-4 판정 보존. */
    if (지 && !지.실내벽 && s.이름 === '마을_SHIP' && Number.isFinite(발mx) && Number.isFinite(발my) && Math.floor(발mx / 24) === 15 && Math.floor(발my / 16) === 39) {
      var 끝발 = Math.floor(발my - 39 * 16) * 24 + Math.floor(발mx - 15 * 24);
      if (끝발 >= 0 && 끝발 < 384 && s.장면._평가('경계떼기목록.some(e => e.x === 15 && e.y === 39 && e.틀 && !!e.틀[' + 끝발 + '])')) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* LAST2 (4,50): 기존 비계단 축대 띠는 중심 높이 유지. 현재 평판 마스크가 소유한 발 화소만 윗면에 연결. */
    if (지 && !지.실내벽 && s.이름 === '마을_LAST2' && x === 4 && y === 50 && Number.isFinite(발mx) && Number.isFinite(발my) && Math.floor(발my / 16) === y) {
      var 부분발 = Math.floor(발my - y * 16) * 24 + Math.floor(발mx - x * 24);
      if (부분발 >= 0 && 부분발 < 384 && s.장면._평가('경계떼기목록.some(e => e.x === 4 && e.y === 50 && e.틀 && !!e.틀[' + 부분발 + '])')) return s.장면.높이(발mx / 24, 발my) || 0;
    }
    /* 2026-11-06 CLIPS·SAKARA·DAKAMA·LAST2 확인 부분칸: 낮은 길/높은 면의 실제 발 화소를 기존 장면 높이로 조회. 다른 칸·실내는 중심 기준 보존. */
    if (지 && !지.실내벽 && ((s.이름 === '마을_SHIP' && (((y===40&&x>=9&&x<=14)||(y===41&&x>=9&&x<=13)||(y===42&&x>=10&&x<=13)) || (x>=8&&x<=15&&(y===38||(y===39&&x<=14))) || (((x===7||x===8||x===15||x===16)&&(y===35||y===36))||((x===8||x===15)&&y===37)) || ((x === 7 || x === 16) && y >= 30 && y <= 34) || ((x === 7 || x === 16) && y >= 25 && y <= 29) || ((x === 7 || x === 16) && y >= 21 && y <= 24) || ((x === 7 || x === 16) && y >= 16 && y <= 20) || (x === 7 && y >= 10 && y <= 13) || (x === 16 && y >= 10 && y <= 12) || (y === 8 && x >= 8 && x <= 15) || (y === 9 && (x === 7 || x === 15)))) || (s.이름 === '마을_LAST2' && ((y === 51 && (x === 4 || x === 5)) || (y === 52 && (x === 5 || x === 8 || x === 17)) || (y === 53 && x >= 5 && x <= 11) || (x === 11 && (y === 54 || y === 55)) || (y === 49 && (x === 40 || x === 41)) || (y === 50 && (x === 39 || x === 40)) || (y === 51 && x === 39) || (y === 52 && x >= 37 && x <= 39) || (x === 37 && (y === 53 || y === 54)) || (y === 49 && (x === 28 || x === 29)) || (y === 50 && ((x >= 28 && x <= 30) || x === 35)) || (y === 51 && ((x >= 30 && x <= 33) || x === 35)) || (y === 52 && x >= 31 && x <= 35) || (y === 49 && x >= 24 && x <= 27) || (y === 50 && x >= 22 && x <= 27) || (y === 51 && x >= 19 && x <= 22) || (y === 40 && x >= 2 && x <= 5) || (x === 2 && (y === 41 || y === 42)) || (y === 39 && x >= 20 && x <= 23) || (y === 40 && (x === 23 || x === 24)) || (y === 41 && x === 24) || (x === 25 && y >= 41 && y <= 43) || (y === 36 && x >= 37 && x <= 40) || (y === 37 && x >= 35 && x <= 41) || (y === 38 && x >= 30 && x <= 35) || (y === 39 && x >= 28 && x <= 30) || (y === 31 && x >= 17 && x <= 20) || (y === 32 && x === 17) || (x === 20 && y >= 32 && y <= 33) || (x === 10 && y >= 32 && y <= 34) || (x === 15 && y === 33) || (y === 27 && x === 2) || (y === 28 && x >= 4 && x <= 7) || (y === 29 && x === 8) || (y === 22 && (x === 40 || x === 41)) || (y === 23 && (x === 38 || x === 39)))) || (s.이름 === '마을_DAKAMA' && y === 99 && (x === 25 || x === 35)) || (s.이름 === '마을_CLIPS' && ((x === 31 && y === 27) || (x === 21 && y === 30))) || (s.이름 === '마을_SAKARA' && ((y === 31 && ((x >= 6 && x <= 9) || (x >= 16 && x <= 19))) || (y === 34 && ((x >= 1 && x <= 5) || x === 10 || x === 14 || x === 15 || (x >= 20 && x <= 31))) || (y === 35 && x === 14)))) && Number.isFinite(발mx) && Number.isFinite(발my) && Math.floor(발my / 16) === y) return s.장면.높이(발mx / 24, 발my) || 0;
    { var 바9 = 바닥표(s); if (바9 && 지 && !지.실내벽 && 바9[y * 지.W + x] < 지.지형높이[y * 지.W + x] - 0.01 && root.G2리마스터3D && root.G2리마스터3D.높이값) return 바9[y * 지.W + x] * root.G2리마스터3D.높이값(s.이름) / 2; } var 지 = s.장면.지정 && s.장면.지정(), 덮 = 지 && 지.덮임 && 지.덮임[y * (지.W || 0) + x];
    if (지 && 지.실내벽 && root.G2리마스터3D && root.G2리마스터3D.높이값) { var 계 = null; try { 계 = s.장면._평가('실내계단발높이(' + (x + 0.5) + ',' + (y * 16 + 8) + ')'); } catch (e) {} var 배9 = root.G2리마스터3D.높이값(s.이름) / 2;
      /* 암흑성(마을_DARKCAST) — 방 전체가 7→1 로 내려가는 긴 비탈 축대(열 2~14 · 5~21줄 · 계단 목록 없음)라 바닥층 고정이면 인물이 비탈 뒤에 가린다 → 축대 띠 안 칸은 지형 높이(비탈 보간)를 따라 올라간다 (사장님 11-11 「축대면 따라서 올라가는 것처럼 되어야하는데 지금은 지면에서 이동하면서 축대 뒤로 캐릭터가 가려져」) */
      if (계 == null && s.이름 === '마을_DARKCAST' && 지.축대구간 && 지.축대구간.some(function (q) { return q.x === x && y >= q.y0 && y <= q.y1; })) { var h비 = (Number.isFinite(발mx) && Number.isFinite(발my)) ? s.장면.높이(발mx / 24, 발my) : s.장면.높이(x + 0.5, y * 16 + 8); if (Number.isFinite(h비)) return h비; }   /* 발 «실제 자리»로 보간 — 칸 가운데 높이로 세우니 발이 칸 가운데보다 북쪽일 때 비탈(줄당 0.375단 · 반 줄이면 0.19단 ≈ 9px)이 발보다 높아 하체가 비탈 면 뒤에 묻혀 잘렸다 (사장님 11-12 [그림] 「DARKCAST 축대면 올라갈때 아래 잘려. 안잘리게 처리해」) */
      return (계 != null ? 계 : (지.실내벽.바닥층 || 0)) * 배9; }   /* 마을 실내 — 인물은 늘 바닥(계단만 계단 높이) · 벽 윗면(2층) 칸에 서도 올라가지 않고 바닥에 서서 앞 벽·물건에 가린다 (사장님 11-05 「축대 북쪽에서 2층 위로 올라가는부분은 올라가지 않고 지면에」·「해당 벽면이나 오브젝트에 가려져야하고」) */
    // 사용자 덧칠로 복원한 지면은 현재 높이를 쓴다. 원래 건물에 가려졌다는 정보로 다시 낮추지 않는다.
    if (지 && !지.실내벽 && s.덧칠칸 && s.덧칠칸[y * 지.W + x]) 덮 = null;
    if (덮 != null && 지.칸 && 지.축대구간) { if (!s.띠칸2) { s.띠칸2 = {}; 지.축대구간.forEach(function (q) { if (!(q.위 > q.아래)) return; for (var yy = q.y0; yy <= q.y1; yy++) s.띠칸2[yy * 지.W + q.x] = 1; }); }
      for (var yy = y + 1; yy < 지.H && yy <= y + 10; yy++) { var ii = yy * 지.W + x; if ((지.칸[ii] | 0) & 4) { if (지.지형높이 && 지.지형높이[ii] >= 지.지형높이[y * 지.W + x] - 0.01) 덮 = null; break; }   /* 건물 칸 땅이 이 칸보다 낮지 않으면 내리지 않는다 — 다갈 26~28줄 */ if (s.띠칸2[ii] || (지.지형높이 && 지.지형높이[ii] < 지.지형높이[y * 지.W + x] - 0.01)) { 덮 = null; break; } } }   /* 건물까지 사이에 땅이 낮아지는 곳(축대 경계·턱)이 있어도 내리지 않는다 — 다갈 5~13열 26~28줄이 한 층 떨어졌다 (사장님 11-06 「축대 경계인데 또 아래로 떨어지냐고」) */   /* 건물 앞에 축대가 있으면(축대 뒤 윗면) 건물 덮임으로 내리지 않는다 — 한 칸 아래로 떨어져 축대에 잘렸다 (사장님 11-06 「축대 뒤쪽 칠 새로한 부분도 지금 한칸 아래로 떨어져 … 원래 건물로 가려져있던 축대」) */
    var h = s.장면.높이(x + 0.5, y * 16 + 8) || 0; if (덮 != null && root.G2리마스터3D && root.G2리마스터3D.높이값) { var hb = 덮 * root.G2리마스터3D.높이값(s.이름) / 2; if (hb < h) h = hb; } return h; }
  /* 마을 실내 — 발밑 칸 땅이 벽 윗면(바닥보다 높음)이면 가림 판을 칸 뒤쪽으로 · 벽 앞면과 같은 자리라 안 가려졌다 (사장님 11-05 「해당 벽면이나 오브젝트에 가려져야하고」) */
  function 실내뒤(s, mx, my) { var 지 = s.장면.지정 && s.장면.지정(); if (!지 || !지.실내벽 || !root.G2리마스터3D || !root.G2리마스터3D.높이값) return 0; var 배 = root.G2리마스터3D.높이값(s.이름) / 2, 칸y = Math.floor((my - 4) / 16), h = 0; try { h = s.장면.높이(Math.floor(mx / 24) + 0.5, 칸y * 16 + 8) || 0; } catch (e) {} return h > (지.실내벽.바닥층 || 0) * 배 + 0.5 ? (root.__실내뒤 || -14) : 0; }
  /* 3D 화면 안인가 — 발밑 논리 점을 세워그리기와 같은 투영으로 옮겨 캔버스(여백 = 그림 크기만큼) 안인지 · 원작 화면(320×200) 거름 대신 · 배율·원근·기울기대로 보이는 범위가 바뀐다
   *   (사장님 11-06 「상자가 캐릭터가 특정 위치에 갔을떄(일정 거리에 들어갔을때) 그려지는데, 배율에 따라 달리보여야해」) */
  function 화면안(ctx, 발x, 발y, 키) { var s = 상태; if (!켬() || !s || !s.세계 || 발x == null) return true;
    var mx = 발x + s.캠x, my = 발y + s.캠y, 높 = 0; try { 높 = 칸높이(s, Math.floor(mx / 24), Math.floor((my - 4) / 16), mx, my); } catch (e) {}
    var p = root.G2Projection.투영(s.캠, s.세계, { 출력w: ctx.canvas.width, 출력h: ctx.canvas.height, dpr: 1 }, { x: mx - s.세계.mapW / 2, y: my - s.세계.mapH / 2, z: 높 });
    if (!p || !isFinite(p.sx) || !isFinite(p.sy)) return false;
    var 여 = ((키 || 64) + 16) * s.캠.zoom * (p.factor || 1);
    return p.sx > -여 && p.sx < ctx.canvas.width + 여 && p.sy > -여 && p.sy < ctx.canvas.height + 여; }
  /* ★ 덮개 그림 만들기 (2026-11-08 · 맵3D_마을가림_전수.md) — 가림판(s.가림) 지형 그림(지형c2 · 위여백 96 · 1배)과 같은 크기
   *   화소 = 덮는 조각이 보이면 (255, 행번호×단, 0) · 아니면 (0,0,0, 지형 그림 알파 그대로)  ·  행번호 = 그 조각 발밑 칸 줄 + 1 (발밑 = 줄×16+6 · 0x218C0)
   *   ① 원작 자리 — 위층 조각(그림키가 덮개모양 · 눕힘) 그대로, 불투명 화소 가운데 지형c2 색이 같은 화소만 (다른 조각·3D 건물·덧칠이 덮은 화소는 빠진다)
   *   ② 덧칠 — 덧칠 목록을 차례대로 따라 원 칸 덮개를 칸으로 옮긴다(찾지 않음 · 행번호는 옮긴 줄 수만큼)
   *   ③ 같은 모양 찾기 — «윤곽 띠»(투명이 섞인 16줄 띠)가 맞으면 그 자리에 같은 조각이 있다고 보고 나머지 띠를 이어 견준다(꽉 찬 띠만 맞는 맨바닥은 안 잡음)
   *   ⇒ 겹치면 행번호가 큰(나중에 그려지는) 조각이 이긴다 — 원작 정렬과 같다 */
  function 덮개그림만들기(s) {
    var 지 = s.가림 && s.가림.지정 && s.가림.지정(), c2 = 지 && 지._지형c2, 마 = root.__마을맵;
    if (!지 || !c2 || 지.실내벽 || !마 || !마.구운것 || !마.구운것.팔 || 마.키 !== s.키 + '.MAP') return null;
    var 위여 = 지.위여백 | 0, CW = c2.width, CH = c2.height, TW = 지.TW || 24, TH = 지.TH || 16, W = 지.W, H = 지.H;
    var 원 = c2.getContext('2d').getImageData(0, 0, CW, CH).data, 팔 = 마.구운것.팔, 위 = 마.구운것.위조각들 || [];
    var 행 = new Int16Array(CW * CH), 누구 = new Int16Array(CW * CH), 키목록 = [], 키번 = {}, 조각수 = 0, 찾은수 = 0;   /* 누구 = 그 화소를 덮는 모양(키목록 번호+1) — 점검·전수 측정용 */
    var 키찾기 = function (k) { if (!키번[k]) { 키목록.push(k); 키번[k] = 키목록.length; } return 키번[k]; };
    var 같은색 = function (q, ci) { return Math.abs(원[q] - 팔[ci]) + Math.abs(원[q + 1] - 팔[ci + 1]) + Math.abs(원[q + 2] - 팔[ci + 2]) < 12 && 원[q + 3] >= 128; };
    var 틀 = {};
    위.forEach(function (o) { var k = o.그림키; if (!k || !덮개모양[k] || 덮개뺌[k] || !o.눕힘 || !o.그림 || !o.그림.idx) return;
      var g = o.그림, n = Math.floor(o.발밑 / TH) + 1, 번 = 키찾기(k); 조각수++;
      for (var j = 0; j < g.h; j++) { var y = o.픽셀y + 위여 + j; if (y < 0 || y >= CH) continue;
        for (var i = 0; i < g.w; i++) { var v = g.idx[j * g.w + i]; if (v < 0) continue; var x = o.픽셀x + i; if (x < 0 || x >= CW) continue;
          var p = y * CW + x; if (같은색(p * 4, v * 4) && n > 행[p]) { 행[p] = n; 누구[p] = 번; } } }
      if (!틀[k] && (o.픽셀y - o.칸y * TH) % TH === 0) {   /* 띠 견주기 틀 — 띠마다 불투명 화소 목록 */
        var 띠들 = []; for (var b = 0; b * TH < g.h; b++) { var 점 = []; for (var jj = 0; jj < TH && b * TH + jj < g.h; jj++) for (var ii = 0; ii < g.w; ii++) { var vv = g.idx[(b * TH + jj) * g.w + ii]; if (vv >= 0) 점.push(ii, jj, vv * 4); } 띠들.push(점); }
        틀[k] = { ax: o.픽셀x - o.칸x * TW, ay: o.픽셀y - o.칸y * TH, w: g.w, 띠들: 띠들 }; } });
    /* ② 덧칠 — 찾지 않고 그대로 옮긴다: 덧칠 목록(칸 ← 원 칸, 차례대로 · 지정보기 덧칠베끼기와 같은 차례)을 따라 원 칸 덮개를 칸으로. 행번호는 옮긴 줄 수만큼 (같은 조각을 그 자리에 얹은 셈) */
    var 덧수 = 0;
    (s.덧칠목 || []).forEach(function (e) { if (!e || !e.칸 || !e.원) return; var tx = e.칸[0], ty = e.칸[1], sx = e.원[0], sy = e.원[1], dy = ty - sy;
      if (tx < 0 || ty < 0 || sx < 0 || sy < 0 || tx >= W || sx >= W || ty >= H || sy >= H) return; 덧수++;
      for (var j = 0; j < TH; j++) for (var i = 0; i < TW; i++) { var ps = (위여 + sy * TH + j) * CW + sx * TW + i, pt = (위여 + ty * TH + j) * CW + tx * TW + i;
        var nn = 행[ps]; 행[pt] = nn ? Math.max(1, nn + dy) : 0; 누구[pt] = nn ? 누구[ps] : 0; } });
    /* ③ 같은 모양 찾기 — «윤곽 띠»(투명 화소가 섞여 조각 가장자리가 보이는 띠)가 95% 이상 맞을 때만 그 자리에 같은 조각이 있다고 보고, 같은 조각의 나머지 띠를 위아래 칸에서 이어 견준다.
     *   ☠ 처음엔 띠마다 따로 찾아, 구멍 없이 모래로 꽉 찬 띠가 사막 바닥 전체와 맞아 인물이 모래에 묻혔다(라스트2 · 2864곳) — 맨바닥은 조각이 아니다 (사장님 11-08 「지면 타일까지 해당 칸으로 포함되니 … 그러면 안되고」) */
    var 띠맞음 = function (t, 점, x0, y0) { var n점 = 점.length / 3, 맞 = 0; for (var e2 = 0; e2 < 점.length; e2 += 3) if (같은색(((y0 + 점[e2 + 1]) * CW + x0 + 점[e2]) * 4, 점[e2 + 2])) 맞++; return n점 > 0 && 맞 >= n점 * 0.95; };
    Object.keys(틀).forEach(function (k) { var t = 틀[k], 번2 = 키찾기(k), nb = t.띠들.length, 끝줄 = t.ay + nb * TH - 10;
      t.띠들.forEach(function (점, b) { var n점 = 점.length / 3; if (n점 < 12 || n점 >= t.w * TH) return;   /* 윤곽 띠만 — 화소가 적은 띠는 엉뚱한 곳과 맞기 쉽고, 꽉 찬 띠는 맨바닥과 같을 수 있다 */
        var 표본 = [0, Math.floor(n점 / 3), Math.floor(2 * n점 / 3), n점 - 1];
        for (var r = 0; r < H; r++) for (var cx = 0; cx < W; cx++) { var x0 = cx * TW + t.ax, y0 = 위여 + r * TH;
          if (x0 < 0 || x0 + t.w > CW || y0 + TH > CH) continue;
          var 됨 = true; for (var si = 0; si < 4 && 됨; si++) { var e = 표본[si] * 3; if (!같은색(((y0 + 점[e + 1]) * CW + x0 + 점[e]) * 4, 점[e + 2])) 됨 = false; }
          if (!됨 || !띠맞음(t, 점, x0, y0)) continue;
          var 꼭대기줄 = r - b, n = Math.floor((꼭대기줄 * TH + 끝줄) / TH) + 1; 찾은수++;   /* 발밑 = 원래 자리 픽셀y + h − 10 · 꼭대기줄 = 조각 맨 윗 띠가 놓인 칸 줄 */
          for (var bb = 0; bb < nb; bb++) { var 점b = t.띠들[bb], yb = 위여 + (꼭대기줄 + bb) * TH; if (!점b.length || yb < 0 || yb + TH > CH) continue;
            if (bb !== b && !띠맞음(t, 점b, x0, yb)) continue;   /* 같은 조각의 나머지 띠 — 이어 맞는 것만 */
            for (var e3 = 0; e3 < 점b.length; e3 += 3) { var p3 = (yb + 점b[e3 + 1]) * CW + x0 + 점b[e3]; if (같은색(p3 * 4, 점b[e3 + 2]) && n > 행[p3]) { 행[p3] = n; 누구[p3] = 번2; } } } } }); });
    var 단 = 0, cv = root.document.createElement('canvas'); cv.width = CW; cv.height = CH;
    var g2 = cv.getContext('2d'), im = g2.createImageData(CW, CH), d = im.data;
    for (var p4 = 0; p4 < 행.length; p4++) { var q4 = p4 * 4; if (행[p4] > 0) { d[q4] = 255; d[q4 + 1] = ((행[p4] >> 4) & 15) * 16 + 8; d[q4 + 2] = (행[p4] & 15) * 16 + 8; d[q4 + 3] = 255; }   /* 행번호 = 초록(16단위 큰 자리) · 파랑(작은 자리) — 각 자리가 16 간격이라 어두운 면 반올림 오차(±몇)에도 정확히 읽힌다. ☠ 처음엔 초록 하나에 행×단(줄 100개 맵은 단 2)을 담아 어두운 면에서 3~6줄 크게 읽혀 엉뚱한 화소가 덮였다(사이럽스 43,94) */ else d[q4 + 3] = 원[q4 + 3]; }
    g2.putImageData(im, 0, 0);
    return { 그림: cv, 단: 단, 판본: s.이름 + '#' + (++덮개판본수), 조각수: 조각수, 찾은수: 찾은수, 덧칠수: 덧수, 행: 행, 누구: 누구, 키목록: 키목록, CW: CW, 위여: 위여 };
  }
  var 덮개판본수 = 0;
  function 덮개행읽기(자, q) { var R = 자[q], k = 255 / R, hi = Math.round((자[q + 1] * k - 8) / 16), lo = Math.round((자[q + 2] * k - 8) / 16); return (Math.max(0, Math.min(15, hi)) << 4) + Math.max(0, Math.min(15, lo)); }
  /* 인물 하나를 그린 바로 뒤 — 덮개 지도(화면 화소마다 덮는 조각 발밑 줄)에서 «발밑이 이 인물보다 아래»인 화소만 장면 그림으로 다시 덮는다 · 원작 정렬 0x2278F */
  function 덮개앞인가(행, 발밑y, 지도후등록) { var 조각발 = (행 - 1) * 16 + 6; return 행 > 0 && (조각발 > 발밑y || (지도후등록 === true && 조각발 === 발밑y)); }
  // PACK 0x22851 안정 동률 / 0x19128 지도 후등록. GRIK 일반 인물만 확인한 순서를 명시한다.
  function 덮개덮기(ctx, s, l, t, r, b, 발밑y, 크기) {
    var 동률 = s.키 === 'GRIK' && s.덮개정확 && !!(크기 && 크기.지도후등록 === true);
    var 판 = s.키 === 'GRIK' && !동률 ? s.덮개기존판 : s.덮개판, 덮 = s.덮개; if (!판 || !덮 || !s.장면판 || r <= l || b <= t) return 0;
    var w = r - l, h = b - t, 덮자;
    /* 정본 349 — 덮개 지도(덮개키)·인물 상자·발밑이 그대로면 지난 «덮을 모양»을 쓴다. 인물마다 getImageData·putImageData 가 아이패드에서 장마다 약 48ms */
    var 덮캐키 = (root.__덮개캐시끔 || root.__덮개기록 || !s.덮개키) ? null : [s.덮개키, 판 === s.덮개기존판 ? 1 : 0, l, t, w, h, 발밑y, 동률 ? 1 : 0].join('|');
    if (덮캐키 && s.덮개캐시주인 !== s.덮개키) { s.덮개캐시 = {}; s.덮개캐시주인 = s.덮개키; }
    var 덮옛 = 덮캐키 ? s.덮개캐시[덮캐키] : null;
    if (덮옛) {
      덮옛.차례 = s.깊이차례; if (!덮옛.수) return 0;
      var 작옛 = s.덮개작판 || (s.덮개작판 = root.document.createElement('canvas')); if (작옛.width < w || 작옛.height < h) { 작옛.width = Math.max(작옛.width, w); 작옛.height = Math.max(작옛.height, h); }
      var g옛 = 작옛.getContext('2d'); g옛.globalCompositeOperation = 'copy'; g옛.drawImage(덮옛.판, 0, 0);
      g옛.globalCompositeOperation = 'source-in'; g옛.drawImage(s.장면판, l, t, w, h, 0, 0, w, h); g옛.globalCompositeOperation = 'source-over';
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(작옛, 0, 0, w, h, l, t, w, h); ctx.restore();
      return 덮옛.수;
    }
    try { 덮자 = 판.getContext('2d', { willReadFrequently: true }).getImageData(l, t, w, h); } catch (e) { return 0; }   /* 인물 상자만 읽는다 — 화면 전체를 장면마다 읽던 것이 느렸다 */
    var 자 = 덮자.data, PW = w, 작 = s.덮개작판 || (s.덮개작판 = root.document.createElement('canvas'));
    if (작.width < w || 작.height < h) { 작.width = Math.max(작.width, w); 작.height = Math.max(작.height, h); }
    var g = 작.getContext('2d'); g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, 작.width, 작.height);
    var im = g.createImageData(w, h), d = im.data, 수 = 0;
    for (var y = 0; y < h; y++) for (var x = 0; x < w; x++) { var q = (y * PW + x) * 4, R = 자[q]; if (R < 64) continue;   /* 너무 어두운 화소는 읽지 않는다 */
      var n = 덮개행읽기(자, q); if (n < 1) continue;
      if (덮개앞인가(n, 발밑y, 동률)) { d[(y * w + x) * 4 + 3] = 255; 수++; } }
    if (root.__덮개기록) { var 코 = {}; for (var yy = 0; yy < h; yy += 2) for (var xx = 0; xx < w; xx += 2) { var qq = (yy * PW + xx) * 4; if (자[qq] >= 64) { var nn = 덮개행읽기(자, qq); 코[nn] = (코[nn] || 0) + 1; } } var 점9 = s.덮개점, 안수 = 0, 안넓이 = 0; if (점9) { var il = Math.max(l, Math.floor(점9.sx - 점9.k * 점9.sw / 2)), ir = Math.min(r, Math.ceil(점9.sx + 점9.k * 점9.sw / 2)), it = Math.max(t, Math.floor(점9.sy - 점9.k * 점9.sh)), ib = Math.min(b, Math.ceil(점9.sy)); 안넓이 = Math.max(0, ir - il) * Math.max(0, ib - it); for (var y9 = it; y9 < ib; y9++) for (var x9 = il; x9 < ir; x9++) if (d[((y9 - t) * w + x9 - l) * 4 + 3]) 안수++; } (s.덮개기록 = s.덮개기록 || []).push({ l: l, t: t, r: r, b: b, 발밑: 발밑y, 수: 수, 코: 코, 안수: 안수, 안넓이: 안넓이, sx: 점9 && 점9.sx, sy: 점9 && 점9.sy }); if (s.덮개기록.length > 20) s.덮개기록.shift(); }   /* 점검용 */
    if (덮캐키) { var 덮판옛 = null; if (수) { 덮판옛 = root.document.createElement('canvas'); 덮판옛.width = w; 덮판옛.height = h; 덮판옛.getContext('2d').putImageData(im, 0, 0); } s.덮개캐시[덮캐키] = { 수: 수, 판: 덮판옛, 차례: s.깊이차례 }; }
    if (!수) return 0;
    g.putImageData(im, 0, 0); g.globalCompositeOperation = 'source-in'; g.drawImage(s.장면판, l, t, w, h, 0, 0, w, h); g.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(작, 0, 0, w, h, l, t, w, h); ctx.restore();
    return 수;
  }
  /* ★ 마을 사람 = 지면에 수직으로 세운 판 + 기울기 세로 보정 — 전투 유닛(리마스터3D 빌보드 + 세로배율)과 같은 식 (사장님 11-12 「마을 캐릭터도 지면에 수직으로 세우고 보정을 적용해야해. 지금은 그림자가 지면에 파묻혀」)
   *   수직 판은 화면 세로가 sin(기울기) 배로 줄고, 보정 k = 1 + (1/sin − 1)·보정% 로 다시 키운다 → 화면 세로 계수 = sin·k (보정 100% = 원래 키 · 0% = 수직 판 그대로) · 10°~89° · 발끝 고정
   *   ☠ 그 전엔 정면 그림을 투영점에 그대로 그려(세로 1) 그림 아래(그림자)가 수직 판 가림(깊이가림)보다 길어 앞 바닥에 덮였다 · 11-12 처음엔 sin 없이 k 만 곱해 사람이 그냥 커졌다(「마을에서 왜 캐릭터가 커져!」) */
  /* ★ 전투 유닛 실측(헤드리스 2-3 · 유닛 그림 캔버스 세로/가로 비율 ÷ 원래 비율): 기울기 45 보정 100 → 0.71 · 보정 0 → 0.50 · 보정 50 → 0.61 · 기울기 60 보정 100 → 0.50 · 보정 0 → 0.43 · 기울기 30 보정 100 → 0.87
   *   ⇒ 전투 유닛 화면 세로 = cos(기울기) × (sin + (1 − sin)·보정%) — 수직 판은 cos·sin 으로 눌리고 보정 k = 1 + (1/sin − 1)·보정% 가 sin 쪽을 되살린다 · 보정 100 = cos(기울기) · 마을도 같은 값으로 (사장님 11-12 「마을 캐릭터 90도로 세우고 기울기에 따라 보정거는건 제대로 적용 안됐어」·「마을 적용 안된다고!」 — 전엔 sin·k = 1 로 두어 눈에 변화가 없었다) */
  function 사람세로계수() { var 보 = (root.G2리마스터3D && typeof root.G2리마스터3D.세로보정 === 'function') ? root.G2리마스터3D.세로보정() : 100; var 기 = Math.abs(+지금기울기() || 0), a = Math.max(10, Math.min(89, 기)) * Math.PI / 180, sn = Math.sin(a), 실 = Math.sin(Math.max(0, Math.min(89, 기)) * Math.PI / 180); return 실 * (1 + (1 / sn - 1) * 보 / 100); }   /* 10도 아래 — 배율은 10도에 묶고 기울기는 실제 값 = 세운 물건(지정보기 세움세로배율)·전투 유닛(리마스터3D 세로배율)과 같은 식 · 10도 이상은 예전과 같다 (사장님 11-21 고르심 «인물도 물건처럼» · 전엔 인물만 10도 아래에서도 키 그대로라 물건이 누우며 가림이 갑자기 바뀌었다 · 정본 353) */   /* ☠ 11-12 cos·(…) 로 눌렀더니 「지금은 지면에 누워있잖아!」 — 전투 측정이 그림자 캔버스(첫 자식 · scaleY(cos))를 잰 것이었다 → 수직 판(sin)·보정(1/sin) = 보정 100% 에서 1 로 되돌림 */
  /* 정본 349 — 인물 하나의 깊이 가림 덮기(지난 덮인 모양 재사용) · root.__깊이캐시끔=true 면 예전처럼 매번 */
  function 깊이가림덮기(ctx, s, 인, l, t, w, h) {
    var 키 = root.__깊이캐시끔 ? null : JSON.stringify(인) + '|' + l + ',' + t + ',' + w + ',' + h, 옛 = 키 ? s.깊이캐시[키] : null;
    if (!옛) {
      if (!s.깊이시작) { s.깊이시작 = true; if (!s.가림.깊이가림시작()) { s.깊이불가 = true; s.깊이 = false; return; } }
      옛 = { 됨: !!s.가림.깊이가림(인), 차례: s.깊이차례 };
      if (옛.됨) { var 판 = root.document.createElement('canvas'); 판.width = w; 판.height = h; 판.getContext('2d').drawImage(s.가림캔버스, l, t, w, h, 0, 0, w, h); 옛.판 = 판;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(판, l, t); ctx.restore(); }
      if (키) s.깊이캐시[키] = 옛; return;
    }
    옛.차례 = s.깊이차례; if (!옛.됨 || !s.장면판) return;
    var 작 = s.깊이작판 || (s.깊이작판 = root.document.createElement('canvas')); if (작.width < w || 작.height < h) { 작.width = Math.max(작.width, w); 작.height = Math.max(작.height, h); }
    var g = 작.getContext('2d'); g.globalCompositeOperation = 'copy'; g.drawImage(옛.판, 0, 0);
    g.globalCompositeOperation = 'source-in'; g.drawImage(s.장면판, l, t, w, h, 0, 0, w, h); g.globalCompositeOperation = 'source-over';
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(작, 0, 0, w, h, l, t, w, h); ctx.restore();
  }
  function 그림자가림보정(o, 그림자, 위y, 아래y) { if (그림자) { o.밑그림 = 1; o.밑화면 = Math.floor(위y); o.기존밑화면 = undefined; o.t = Math.min(o.t, Math.floor(위y) - 2); o.b = Math.max(o.b, Math.ceil(아래y) + 2); o.물리지면 = false; o.평판공유 = false; } return o; }   /* 그림자 항목 — 타원 윗변(밑화면)부터 아래끝까지 땅 평판 비교 */
  function 세워그리기(ctx, 발x, 발y, 그리기함수, 크기) {
    var s = 상태;
    if (!켬() || 발x == null) { 그리기함수(); return; }
    var mx = 발x + s.캠x, my = 발y + s.캠y, 세 = s.세계;
    var 높 = 0; try { var 칸y = Math.floor((my - 4) / 16); 높 = 칸높이(s, Math.floor(mx / 24), 칸y, mx, my); } catch (e) {}   /* 발이 선 칸 가운데 높이 — 발 바로 위 줄(벽 윗면)을 짚어 인물이 벽 위로 떠 머리만 보였다 (11-05 [그림]) */
    if (s.이름 === '마을_SUSCAS') { try { var 수 = s.장면._평가('수스지붕(' + mx + ',' + (my - 2) + ',' + Math.floor(mx / 24) + ',' + Math.floor((my - 4) / 16) + ')'); if (수) { 높 += 수.높; my = 수.z; } } catch (e) {} }   /* 서스카스 지붕·사다리 — 지정보기와 같은 식(수스지붕) · 지붕 칸이면 지붕 높이로, 사다리 칸이면 앞면 따라 오른다 (사장님 11-06 「사다리 올라갈때 수직으로 이동해야하고 건물 2층에서 움직일 수 있어야해」) */
    var p = root.G2Projection.투영(s.캠, 세, { 출력w: ctx.canvas.width, 출력h: ctx.canvas.height, dpr: 1 },
      { x: mx - 세.mapW / 2, y: my - 세.mapH / 2, z: 높 });
    var k = s.캠.zoom * (p.factor || 1);
    var 난간겹침 = !!(s.깊이 && s.장면.난간접점 && s.장면.난간접점(mx, my, 높, ((크기 && 크기.w) || 32) / 2, (크기 && 크기.h) || 64));
    /* 가림 — 전투와 같은 가림판: 인물 자리(넉넉한 상자) + 발밑(맵 픽셀 · 줄) → 앞에 선 건물·나무를 그 자리에만 다시 칠한다 */
    /* ★ 지면에 수직으로 선 판 — 전투 유닛(리마스터3D 빌보드)처럼 발 좌·우 점과 머리 점을 3D 투영해 그 결과로 그림을 세운다(가로 = 발 좌우 투영 차 · 세로 = 머리−발 투영 차 · 원근·기울기가 투영에서 나온다)
     *   머리 높이 = 그림 키 × 보정 k(1 + (1/sin − 1)·보정%) — 전투와 같은 세로 보정 · 그림자(타원)는 땅에 눕힌 판(세로 = 땅 위 한 줄 투영 차)
     *   ☠ 그 전엔 투영점에 캔버스 직사각(setTransform(k,0,0,k·ky))을 그려 카메라가 어떻게 돌아도 늘 정면이었다 (사장님 11-12 「캐릭터가 지면에 수직으로 서야한다니까?」·「지금은 무조건 정면을 바라보게 되어있다고」) */
    var 뷰 = { 출력w: ctx.canvas.width, 출력h: ctx.canvas.height, dpr: 1 }, 투 = function (dx, dy, dz) { return root.G2Projection.투영(s.캠, 세, 뷰, { x: mx + dx - 세.mapW / 2, y: my + dy - 세.mapH / 2, z: 높 + dz }); };
    var sw = (크기 && 크기.w) || 32, sh = (크기 && 크기.h) || 64, 보k = 사람세로계수(), 그림자판 = !!(크기 && Number.isFinite(크기.그림자중심y));
    var pL = 투(-sw / 2, 0, 0), pR = 투(sw / 2, 0, 0), pT = 투(0, 0, sh * 보k);   /* 머리 = 키×보정 만큼 위 · 그림자도 같은 수직 판 벡터(전투 render.js 유닛그림자그리기 — 그림자는 몸 상자 첫 자식) */
    var ax = (pR.sx - pL.sx) / sw, ay = (pR.sy - pL.sy) / sw;                       /* 논리 x 1px → 화면 */
    var bx, by; { var ux = p.sx - pT.sx, uy = p.sy - pT.sy, ul = Math.hypot(ux, uy) || 1, 세길 = Math.hypot(ax, ay) * 보k;   /* 세로 «방향»은 머리점 투영(원근·회전) · «길이»는 전투 유닛 실측과 같게 가로 배율 × 보정 계수(수직 판 sin × k · 보정 100 = 원래 키) — 투영 세로 길이를 그대로 쓰면 45° 에서 0.72 배로 전투(1.0)보다 짧았다 */ bx = ux / ul * 세길; by = uy / ul * 세길; }   /* 논리 y 1px(아래로) → 화면 */
    // Canvas2D 발끝의 반화소 coverage가 수직 판 아래로 새지 않게 출력 1px만 여유를 둔다. 접지·깊이는 그대로.
    var 발위 = 투(0, 0, 1), 높이한칸px = Math.hypot(발위.sx - p.sx, 발위.sy - p.sy), 판밑여유 = 높이한칸px > 1e-6 ? 1 / 높이한칸px : 0;
    var 판회전 = 0; // 가림도 현재 인물의 세계 X 방향을 따른다. 옆으로 완전히 눕는 표시 대체 때만 카메라 방향.
    if (!(isFinite(ax) && isFinite(by)) || Math.abs(ax) < 1e-6) { 판회전 = +슬('rot', 0) || 0; ax = k; ay = 0; bx = 0; by = k; }
    /* ★ 그림자 = 전투와 같은 규칙(render.js 유닛그림자그리기 0x12FF6·0x130C0: 그림자 중심 = 발 + 12px 아래 · 몸과 같은 수직 판 안 · 리마스터3D 그림자제자리: 세로만 scaleY(cos 기울기)) — 타원 그림의 중심(그림자중심y)을 발 투영점에서 세로 벡터 12px 아래에, 세로는 cos 로 눌러 (사장님 11-12 「전투에서 그림자 어떻게 처리하는지 보고 하면 되잖아」 · [그림] 「장난하나 진짜!」 — 윗변을 발에 두니 발과 그림자 사이가 떴다) */
    var 그림자c = 그림자판 ? Math.cos(Math.max(10, Math.min(89, Math.abs(+지금기울기() || 0))) * Math.PI / 180) : 1, 기준y = 그림자판 ? 크기.그림자중심y : 발y - ((크기 && 크기.발여백) || 0), 그림자내림 = 0;   /* 사람: 실제 발 픽셀(아래끝 − 발여백)을 땅 점에 · 그림자: ★ 중심 = 땅 점(발 픽셀) — 전투 실측(그림자 중심 = 발끝)과 같다 · 남쪽으로 내리면 발 앞에 따로 깔린다 (사장님 11-12 「그림자가 왜 남쪽에 있냐고」) · 몸이 타원 윗부분을 가리고 아래 반이 보인다 · 아래 반이 땅에 덮이던 것은 땅 평판 비교(그림자가림보정)로 막는다 */   /* 타원 윗변 = 실제 발 픽셀 바로 밑(그림 아래 투명 줄 = 발여백 만큼 올림) — 사장님 11-12 [그림 034xxx] 이 꼴로 확인 · 전투(중심 = 그림 아래끝)와는 발여백만큼 다르다 */   /* 타원 «윗변»이 발 투영점에 딱 붙게 — 중심을 (눌린 타원 높이)/2 만큼만 내린다 (4px 고정은 21px 틈 · 사장님 11-12 [그림] 「장난하냐고!!」) */   /* 전투 실측(2-3 · 45°·60°): 그림자(24×16 · scaleY(cos)) 중심 = 몸 발끝 화면 y(차 0 · 아래 반 8px 가 발 밑에 보인다) · 마을 타원은 h 7 이라 중심을 발에 두면 위 반이 몸에 가려 3.5px 만 남아 «잘려» 보였다 → 아랫변이 전투와 같은 자리(발 + 8)가 되게 중심을 발 아래 4px 에 (12 로 두니 63px 떠서 「날아다녀?」) */   /* 그림자는 타원 «윗변»을 발 투영점에 — 중심을 발에 두니 위 절반이 몸 뒤에 숨어 잘려 보였다 (사장님 11-12 [그림 둘] 「이렇게 나와야하는데 … 자꾸 이렇게 잘린다고」) */
    var 세로px = Math.abs(by) * sh, 가로px = Math.abs(ax) * sw;
    /* 그림자는 줄 차례 가림(가림마무리 · 컨트롤 맵처럼 참 깊이 가림을 안 쓰는 맵)의 사각에 안 넣는다 — 발 줄보다 앞 줄에 걸친 타원 아래쪽을 그 줄 땅이 다시 칠해 잘렸다 (사장님 11-12 「왜 컨트롤맵에서만 잘리냐고」) */
    if (s.사각 && !그림자판 && !(크기 && 크기.가림없음)) s.사각.push({ l: p.sx - 20 * Math.abs(ax), r: p.sx + 20 * Math.abs(ax), t: p.sy - Math.max(72 * Math.abs(ax), 세로px + 8 * Math.abs(ax)), b: p.sy + 4 * Math.abs(ax), 줄: Math.floor((my - 1) / 16), 발: { x: mx, y: my, h: 높, 앞: 0.5 } });
    ctx.save();
    var 그림자반 = 그림자판 ? Math.abs(by) * 그림자c * ((크기.그림자h || 7) / 2) : 0, 그림자위y = p.sy + by * 그림자내림 - 그림자반, 그림자아래y = p.sy + by * 그림자내림 + 그림자반;   /* 타원 윗변·아래끝 화면 y — 깊이 가림의 땅 평판 구간 */
    ctx.setTransform(ax, ay, bx * 그림자c, by * 그림자c, p.sx + bx * 그림자내림 - ax * 발x - bx * 그림자c * 기준y, p.sy + by * 그림자내림 - ay * 발x - by * 그림자c * 기준y);   /* 발(발x, 기준y) 이 투영점 p(+그림자는 12px 아래)에 · 가로·세로 벡터는 투영 차 · 그림자 세로는 cos */
    void 가로px;
    try { 그리기함수(); } finally { ctx.restore(); }
    /* 크기.가림없음 — 커서 상자 같은 표시는 원작처럼 늘 맨 위 · 앞 매대·건물이 덮지 않는다 (정본 231 · 사장님 11-16 「상점 커서박스가 가려져서 잘 안보여.」) */
    if (크기 && 크기.가림없음) return;
    // 2026-11-06 GEYSIR 114426: 바닥 윗선 아래 사각 자르기 금지. 실제 장면 깊이·난간 알파만 사용.
    // 분리 건물층의 실제 발 위치는 현재 GPU 깊이가 가린다. 옛 그림 윗선 덮개를 겹치면 앞에 선 몸까지 잘린다.
    /* 덮개 — 원작에서 이 인물보다 발밑이 아래인 갓돌·경계석 조각이 덮는 화소 (11-08 · 맵3D_마을가림_전수.md) */
    /* 그림자는 덮개(발밑이 아래인 갓돌·경계석 조각 다시 칠하기)도 안 건다 — 컨트롤 맵(참 깊이 가림 없음)에서 타원 아래쪽을 아래 줄 바닥 조각이 덮어 잘렸다 (사장님 11-12 「왜 컨트롤맵에서만 잘리냐고」) */
    if (s.덮개판 && !root.__덮개끔 && !그림자판) { try { var 덮k = s.캠.zoom * (p.factor || 1), 덮sw = (크기 && 크기.w) || 32, 덮sh = (크기 && 크기.h) || 64, 덮W = ctx.canvas.width, 덮H = ctx.canvas.height;
      s.덮개점 = { sx: p.sx, sy: p.sy, k: 덮k, sw: 덮sw, sh: 덮sh }; 덮개덮기(ctx, s, Math.max(0, Math.floor(p.sx - 덮k * (덮sw + 8))), Math.max(0, Math.floor(p.sy - 덮k * (덮sh * 2 + 24))), Math.min(덮W, Math.ceil(p.sx + 덮k * (덮sw + 8))), Math.min(덮H, Math.ceil(p.sy + 덮k * 10)), my, 크기); } catch (e) { s.덮개오류 = String(e && e.message || e); } }
    /* 이 인물을 그린 바로 뒤 — 장면(건물·지붕·벽·나무)이 이 인물 «선 판»보다 앞인 화소에 장면 그림을 덮는다 · 뒤→앞 차례라 앞 인물은 나중에 그 위에 그려진다 */
    if (s.깊이 && s.가림.깊이가림) { var sw = (크기 && 크기.w) || 32, sh = (크기 && 크기.h) || 64, cvw = ctx.canvas.width, cvh = ctx.canvas.height;
      var 판드라그림자 = s.이름 === '마을_PANDRA' && 크기 && 크기.그림자전용 === true && Number.isFinite(크기.밑그림);
      var 그림자지면 = 판드라그림자 || ((s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===18) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && [19,20].includes(Math.floor(my/16)))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===16) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && Math.floor(my/16)===16) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===17) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && [23,24].includes(Math.floor(my/16))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===7 && Math.floor(my/16)===21) || (Math.floor(mx/24)===16 && [21,22].includes(Math.floor(my/16))))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && [28,29].includes(Math.floor(my/16))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===27) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===16 && [25,26].includes(Math.floor(my/16))) || (Math.floor(mx/24)===7 && Math.floor(my/16)===26))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===34) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===33) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===32) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===31) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===30) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===15 && Math.floor(my/16)===37) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && Math.floor(my/16)===36) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && Math.floor(my/16)===35) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===15 && Math.floor(my/16)===38) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===8 && [38,39].includes(Math.floor(my/16))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===13 && Math.floor(my/16)===41) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===9 && [40,41].includes(Math.floor(my/16))) || (Math.floor(mx/24)===10 && Math.floor(my/16)===42))) && 크기 && Number.isFinite(크기.밑그림) || (s.이름 === '마을_DRAKE' && (([24,27,28].includes(Math.floor(mx/24)) && Math.floor(my/16)===28) || ([16,21,24,25].includes(Math.floor(mx/24)) && Math.floor(my/16)===5) || (Math.floor(mx/24)===26 && Math.floor(my/16)===8) || (Math.floor(mx/24)===27 && Math.floor(my/16)===12) || ([30,33].includes(Math.floor(mx/24)) && Math.floor(my/16)===14) || ([8,9,12,13].includes(Math.floor(mx/24)) && Math.floor(my/16)===20) || (Math.floor(mx/24)===1 && Math.floor(my/16)===22)) && 크기 && Number.isFinite(크기.밑그림)) || ((s.이름 === '마을_CLIPS' && Math.floor(mx / 24) === 31 && Math.floor(my / 16) === 29) || (s.이름 === '마을_DRAKE' && ((Math.floor(mx / 24) === 17 && Math.floor(my / 16) === 27) || (Math.floor(mx / 24) === 14 && Math.floor(my / 16) === 26)))) && 크기 && Number.isFinite(크기.밑그림);
      var l = Math.max(0, Math.floor(p.sx - k * (sw + 8))), r2 = Math.min(cvw, Math.ceil(p.sx + k * (sw + 8))), t = Math.max(0, Math.floor(p.sy - k * (sh * 2 + 24))),   /* 위로 넉넉히 — 인물 그림이 크기.h 보다 위로 그려져(머리카락) 그 줄이 가림 네모 밖이라 안 가려졌다 (사장님 11-05 「캐릭터 가려지는 크기를 잘못 계산한걸로 보여」) */ b = Math.min(cvh, Math.ceil(그림자판 ? 그림자아래y + 4 : p.sy + k * Math.max(6, (그림자지면 && 크기.밑그림) || 0) + (그림자지면 ? 1 : 0)));   /* 그림자는 타원 아래끝까지 */
      /* 암흑성(마을_DARKCAST) 비탈(줄당 0.375단 ≈ 49.5°)은 카메라 기울기(45°)보다 가팔라 발 뒤 비탈면이 사람 수직 판 위쪽보다 카메라에 가까워져 몸을 덮었다(머리만 남음) → 비탈 칸의 사람은 깊이 가림을 아예 건너뛴다 — 그 자리엔 가릴 벽·기둥이 없다 (사장님 11-12 [그림] 「암흑성도 축대면에서 지면에 파묻힌다고」·「거기는 가림 없다고」) */
      var 암비탈dz = 0; if (s.이름 === '마을_DARKCAST') { try { var 지v = s.장면.지정 && s.장면.지정(), cxv = Math.floor(mx / 24), cyv = Math.floor((my - 4) / 16); if (지v && 지v.축대구간 && 지v.축대구간.some(function (q) { return q.x === cxv && cyv >= q.y0 && cyv <= q.y1; })) 암비탈dz = 32; } catch (e) {} }
      /* 그림자: 발 아래 화면 영역은 발 높이 수직 판 밖이라 발 앞 땅(카메라에 더 가까움)이 이겨 타원 아래가 잘렸다 → 가림판의 «발 아래는 땅 평판 깊이와 비교» 길(밑그림·밑화면)로 — 땅은 동률(판이 이김)·앞 벽·기둥은 덮는다 (사장님 11-12 「지면에 가려서 잘린다고」) */
      if (r2 > l && b > t && !암비탈dz) { try { 깊이가림덮기(ctx, s, 그림자가림보정({ l: l, t: t, r: r2, b: b, x: mx, y: my, h: 높, 키: sh, 반폭: sw / 2 + 2, 판회전: 그림자판 ? undefined : 판회전, 판앞: 그림자판 ? undefined : 0, 판밑여유: 그림자판 ? 0 : 판밑여유, 물리지면: (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===16), 평판공유: 판드라그림자 || ((s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===18) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && [19,20].includes(Math.floor(my/16)))) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===16) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && Math.floor(my/16)===16) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===17) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && [23,24].includes(Math.floor(my/16))) || (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===7 && Math.floor(my/16)===21) || (Math.floor(mx/24)===16 && [21,22].includes(Math.floor(my/16))))) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && [28,29].includes(Math.floor(my/16))) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===27) || (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===16 && [25,26].includes(Math.floor(my/16))) || (Math.floor(mx/24)===7 && Math.floor(my/16)===26))) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===34) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===33) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===32) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===31) || (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===30) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===15 && Math.floor(my/16)===37) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && Math.floor(my/16)===36) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && Math.floor(my/16)===35) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===15 && Math.floor(my/16)===38) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===8 && [38,39].includes(Math.floor(my/16))) || (s.이름 === '마을_SHIP' && Math.floor(mx/24)===13 && Math.floor(my/16)===41) || (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===9 && [40,41].includes(Math.floor(my/16))) || (Math.floor(mx/24)===10 && Math.floor(my/16)===42))) || s.이름 === '마을_DRAKE' && (([24,27,28].includes(Math.floor(mx/24)) && Math.floor(my/16)===28) || ([16,21,24,25].includes(Math.floor(mx/24)) && Math.floor(my/16)===5) || (Math.floor(mx/24)===26 && Math.floor(my/16)===8) || (Math.floor(mx/24)===27 && Math.floor(my/16)===12) || ([30,33].includes(Math.floor(mx/24)) && Math.floor(my/16)===14) || ([8,9,12,13].includes(Math.floor(mx/24)) && Math.floor(my/16)===20) || (Math.floor(mx/24)===1 && Math.floor(my/16)===22)), 밑그림: 그림자지면 ? 크기.밑그림 : undefined, 밑화면: (s.이름 === '마을_SHIP' && Math.floor(mx/24)===7 && [19,20].includes(Math.floor(my/16))) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===16) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===24) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && ((Math.floor(mx/24)===16 && [25,26].includes(Math.floor(my/16))) || (Math.floor(mx/24)===7 && Math.floor(my/16)===26))) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && [7,16].includes(Math.floor(mx/24)) && Math.floor(my/16)===34) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===33) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && Math.floor(mx/24)===16 && Math.floor(my/16)===31) ? Math.ceil(p.sy) : (s.이름 === '마을_SHIP' && Math.floor(mx/24)===15 && Math.floor(my/16)===37) ? Math.ceil(p.sy) : p.sy, 기존밑화면: Math.min(cvh, Math.ceil(p.sy + k * 6)), dz: 난간겹침 ? (그림자판 ? -8 : 0) : 실내뒤(s, mx, my) }, 그림자판, 그림자위y, 그림자아래y), l, t, r2 - l, b - t); } catch (e) { s.가림오류 = String(e && e.message || e); } } }
  }

  /** 인물을 다 그린 뒤 — 앞 건물·나무를 인물 자리에만 덮는다 */
  function 가림마무리(ctx) {
    var s = 상태; if (s && s.깊이) { s.사각 = []; return 0; }   /* 참 깊이 가림을 인물마다 이미 했다 */
    if (!켬() || !s.사각 || !s.사각.length) return 0;
    /* 실내 앞벽 내리기 맵 — 가림판은 앞벽을 안 내린 채 그려서 인물 다리를 바닥 그림으로 덮었다(AINAA 찍어 확인) · 그때는 가림을 안 건다(앞벽은 장면에서 이미 내려간다) ☐ 가구 가림은 아직 */
    { var 지0 = s.장면.지정 && s.장면.지정(); if (지0 && 지0.실내벽 && 지0.실내벽.앞벽가림) { s.사각 = []; return 0; } }
    var n = 0; try { n = s.가림.가림그리기(s.사각); } catch (e) { s.가림오류 = String(e && e.message || e); return 0; }
    if (n) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(s.가림캔버스, 0, 0); ctx.restore(); }
    s.사각 = []; return n;
  }

  /** 마우스(논리 320 좌표) → 그 자리 3D 땅이 평면 화면에서 놓일 논리 좌표 — 마을의 칸 고르기(마우스칸)가 평면 식 그대로 쓰게
   *  땅 높이를 따라 세 번 다시 짚는다(높이 h 평면과 만나는 점 → 그 점 땅 높이 → …) (11-05 사장님 「상점에서 아이템 구입시 커서가 따로 놀아」·[그림]) */
  function 평면자리(lx, ly) {
    var s = 상태; if (!켬() || !s.세계 || !s.캔버스) return null;
    var n = s.n || 1, 폭 = root.__셸논리폭 ? root.__셸논리폭() : { cx: 0 };
    var 점 = { sx: (lx + (폭.cx | 0)) * n, sy: ly * n }, 뷰 = { 출력w: s.캔버스.width, 출력h: s.캔버스.height, dpr: 1 }, h = 0, q = null;
    for (var i = 0; i < 4; i++) { q = root.G2Projection.역투영평면(s.캠, s.세계, 뷰, 점, h); if (!q) return null;
      var mx = q.x + s.세계.mapW / 2, my = q.y + s.세계.mapH / 2, h2 = 0; try { h2 = s.장면.높이(mx / 24, my) || 0; } catch (e) {}
      if (Math.abs(h2 - h) < 0.5) break; h = h2; }
    return { x: q.x + s.세계.mapW / 2 - s.캠x, y: q.y + s.세계.mapH / 2 - s.캠y };
  }
  /* 발밑(발x, 발y)에 세워 그린 그림 위의 점(점x, 점y · 평면 논리 좌표) → 3D 화면의 논리 좌표 — 세워그리기와 같은 투영·배율 · s = 평면 1px 이 3D 화면에서 몇 논리px 인가
   *   말풍선·마을 사람 고르기·커서 상자를 3D 로 그려진 인물 자리에 맞춘다 (사장님 11-06 「말풍선 위치가 잘못되었어. 배율이나 기울기등 화면 설정이 바뀌어도 캐릭터 위치에서 제대로 표시되어야해」·「캐릭터 선택도 이상한 칸에서 돼」) */
  function 화면점(발x, 발y, 점x, 점y) { var s = 상태; if (!켬() || !s.세계 || !s.캔버스 || 발x == null) return null;
    var n = s.n || 1, 폭 = root.__셸논리폭 ? root.__셸논리폭() : { cx: 0 }, mx = 발x + s.캠x, my = 발y + s.캠y, 높 = 0;
    try { 높 = 칸높이(s, Math.floor(mx / 24), Math.floor((my - 4) / 16)); } catch (e) {}
    var p = root.G2Projection.투영(s.캠, s.세계, { 출력w: s.캔버스.width, 출력h: s.캔버스.height, dpr: 1 }, { x: mx - s.세계.mapW / 2, y: my - s.세계.mapH / 2, z: 높 });
    if (!p || !isFinite(p.sx) || !isFinite(p.sy)) return null;
    var k = s.캠.zoom * (p.factor || 1), 뷰2 = { 출력w: s.캔버스.width, 출력h: s.캔버스.height, dpr: 1 }, 투2 = function (dx, dz) { return root.G2Projection.투영(s.캠, s.세계, 뷰2, { x: mx + dx - s.세계.mapW / 2, y: my - s.세계.mapH / 2, z: 높 + dz }); };
    var pR2 = 투2(1, 0), pT2 = 투2(0, 사람세로계수()), ax2 = pR2.sx - p.sx, ay2 = pR2.sy - p.sy, bx2 = p.sx - pT2.sx, by2 = p.sy - pT2.sy;   /* 세워그리기와 같은 수직 판 투영 — 논리 x·y 1px 의 화면 벡터 */
    var ddx = (점x == null ? 발x : 점x) - 발x, ddy = (점y == null ? 발y : 점y) - 발y, px = p.sx + ax2 * ddx + bx2 * ddy, py = p.sy + ay2 * ddx + by2 * ddy;
    return { x: px / n - (폭.cx | 0), y: py / n, s: k / n, sx: px, sy: py, k: k }; }
  /* 마우스(논리 좌표)가 3D 화면에서 짚은 땅 자리 — 평면 논리 좌표로 · 3D 가 꺼져 있으면 그대로 (걷는 방향 판정용) */
  /* [리마스터] 평면(기울기·회전 0 = 원작 평면)에서도 배율 — 2.5D 방식: 평면 그림을 화면 가운데(160,100) 기준으로 그대로 키운다 (사장님 11-06 「기울기0으로 원작평면상태에서는 배율이 안먹히는데, 배율은 먹혀야해」 · 11-07 「마을 기울기0에서 배율은 2.5d 방식으로 하는게 어떨까 싶어.」)
   *   1 이면 원작 그대로 · 3D 가 켜지면 1(3D 가 배율을 맡는다) · 3D 스위치를 끈 원작 모드도 1 */
  /* ★ 정본 263 — 마을 «보이는 틀» (사장님 11-17 고르심 2번 「2번이 좋아보여.」)
   *   ① 모든 마을 — 배율은 설정 그대로 · 화면 가운데만 맞춘다: 맵이 화면보다 넓으면 맵 안으로 가두고(검은 곳 안 보임) 좁으면 맵 가운데에 둔다(양옆 여백 같게) · 위아래가 새로 잘리지 않는다
   *   ② 배율하한 표의 맵만 가로를 채우는 배율로 키운다 — 맵마다 화면을 보고 넣는다 (사장님 「잘못 맞추면 윗부분이 잘려서 이상해지는 경우도 있을것 같은데.. 좀 조심스럽네」)
   *   카메라(원작 12×13칸 창 · 이벤트가 칸을 정함)는 그대로 두고 그리는 틀만 정한다 · 맵 범위 = 원작 카메라가 비추는 범위(x 0~W칸 · y 1칸~H−1.5칸 · 0x212A4 cy ≥ 1 · 0x21309 cy ≤ H−14) */
  /* 정본 268 — 화면 세로 가운데를 한 칸(16px) 위로: 원작 카메라는 주인공을 12.5줄 창의 위에서 5번째 칸에 둬(0x21C0C sub eax,5) 주인공이 가운데보다 한 칸 위에 섰다
   *   (사장님 11-17 「카메라 위치가 화면(세로기준) 중앙이 아니라 살짝 위에 있는 느낌이야」 · 측정 16:9 주인공 세로 평면 33% · 3D 42%) · 맵 끝 가두기는 그대로 */
  var 세로당김 = 36;   /* 주인공 그림이 칸보다 위로 올라가 그려져(몸 가운데 ≈ 논리 64) 한 칸(16)으로는 40% 자리 → 36 이면 50% (측정 DANCIN 평면·3D) */
  var 그림범위 = { 'BALCOZ.MAP': { 가로채움: true, 세로당김: 0, 위가둠: true } };   /* 위가둠 — 뒷벽 없는 맵: 3D 에서도 맨 윗줄 위(빈 곳)를 안 비춘다 (사장님 11-18 「아직도 위쪽이 조금 비는데?」 [그림 #76]) */   /* BALCOZ 는 당기면 너무 내려간다 (사장님 11-18 「balocz맵은 그렇게 하면 너무 내려가. 해당맵은 이전이 나았어」) */
  var 이벤트기울기 = 30;   /* 정본 278 — 이벤트 중 3D 기울기 (사장님 11-18 고르심) · 이벤트 중엔 가로도 채운다(맵범위 가로채움) */
  function 지금기울기() { return 이벤트중() && 슬('tilt', 0) ? 이벤트기울기 : 슬('tilt', 0); }   /* 인물 세로 길이·그림자도 장면과 같은 기울기 */
  /* 정본 278 — 이벤트(.EVE)가 도는 동안은 당기지 않는다: 이벤트는 원작 카메라 구도로 짜여 당기면 위 빈 곳이 드러나고 인물이 아래로 밀렸다 (사장님 11-18 「이벤트 카메라 정렬 이상해」 [그림 #78]) */
  function 이벤트중() { var t = root.__상태 && root.__상태.town; return !!(t && t.실행중); }
  function 당김() { if (이벤트중()) return 0; var 마 = root.__마을맵, 따 = 마 && 그림범위[String(마.키 || '').toUpperCase()]; return (따 && 따.세로당김 != null) ? 따.세로당김 : 세로당김; }   /* BALCOZ(21.TWN 아스타니아 탑) — 가로를 채우는 배율 하한 · [그림 #69·#73] */
  /* 정본 266 — 맵 범위는 «그림이 있는 칸»(아래층 −1 아닌 칸)으로 잰다: ASTACC(20칸 중 0~12)·DANCIN(20칸 중 1~13)·BALCOZ(100칸 중 0~12)처럼 파일 폭보다 그림이 좁은 맵은 빈 칸까지 맵으로 봐서 오른쪽이 비었다
   *   (사장님 11-17 「다른맵도 카메라 부분 확인해야해. astacc, dancing 맵도 카메라가 한쪽으로 쏠리고 오른쪽에 여백이 많아」)
   *   세로 끝은 원작 카메라처럼 마지막 1.5줄을 안 비춘다(cy ≤ H−14 · 창 12.5줄) · 맨 윗줄(0)도 안 비춘다(cy ≥ 1) — BALCOZ 는 옛 표 값(0~312 · 16~200)과 같다 */
  function 맵범위() {
    var 마 = root.__마을맵, m = 마 && 마.map; if (!m) return null;
    var 따 = 그림범위[String(마.키 || '').toUpperCase()], W = m.W | 0, H = m.H | 0;
    if (!m._그림칸) { var v = m.아래 || [], x0 = W, y0 = H, x1 = -1, y1 = -1; for (var i = 0; i < W * H && i < v.length; i++) if (v[i] !== -1 && v[i] != null) { var x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      m._그림칸 = x1 < 0 ? { x0: 0, y0: 0, x1: W - 1, y1: H - 1 } : { x0: x0, y0: y0, x1: x1, y1: y1 }; }
    var g = m._그림칸;
    return { x0: g.x0 * 24, x1: (g.x1 + 1) * 24, y0: Math.max(1, g.y0) * 16, y1: ((g.y1 + 1 >= H) ? H - 1.5 : g.y1 + 1) * 16,   /* 정본 278 — «끝 1.5줄 안 비춤»은 파일 끝일 때만(원작 카메라 cy ≤ H−14) · 그림 아래 빈 줄이 있는 맵(BIF 20줄 중 그림 1~14)은 그림 끝까지 */ 가로채움: !!(따 && 따.가로채움) || 이벤트중(), 위가둠: !!(따 && 따.위가둠) };
  }
  function 가둠(v, a, b) { return b < a ? (a + b) / 2 : Math.max(a, Math.min(b, v)); }
  /** 틀 — 캠x·캠y = 마을 카메라 픽셀(논리 (0,0) 의 맵 픽셀) · 가로만이면 세로는 안 건드린다(3D 는 원근이라 세로 넓이가 다르다) · {z, cx, cy} = 배율 · 화면 가운데의 맵 픽셀 */
  function 화면틀(캠x, 캠y, 가로만) {
    var z = 슬('zoom', 30) / 30; if (!(z > 0)) z = 1;
    var cx = 캠x + 160, cy = 캠y + 100 - 당김(), 범 = 맵범위();
    if (!범) return { z: z, cx: cx, cy: cy };
    var 폭 = root.__셸논리폭 ? root.__셸논리폭() : null, LW = (폭 && 폭.LW) || 320;
    if (범.가로채움) { var 채 = LW / Math.max(1, 범.x1 - 범.x0); if (z < 채) z = 채; }
    if (!가로만) { var 세로채 = 200 / Math.max(1, 범.y1 - 범.y0); if (z < 세로채) z = 세로채; }   /* 정본 278 — 평면은 세로를 채우는 배율 아래로 안 내린다(위 빈 곳이 검게 드러났다) · 가운데 놓기로 바꿨다가 사장님 「여백 안남게 채우는게 맞겠어」로 되돌림 */
    cx = 가둠(cx, 범.x0 + LW / 2 / z, 범.x1 - LW / 2 / z);
    if (!가로만) cy = 가둠(cy, 범.y0 + 100 / z, 범.y1 - 100 / z);
    return { z: z, cx: cx, cy: cy };
  }
  /* 원작 평면 틀 — 그릴 때 정하고(게임.html) 마우스 되돌리기가 같은 값을 읽는다 · ax·ay = 화면 가운데(160,100)에 오는 논리 점 */
  var 평틀 = { z: 1, ax: 160, ay: 100 };
  function 평면틀(캠x, 캠y) { if (켬()) { 평틀 = { z: 1, ax: 160, ay: 100 }; return 평틀; } var f = 화면틀(캠x, 캠y, false); 평틀 = { z: Math.abs(f.z - 1) <= 0.005 ? 1 : f.z, ax: f.cx - 캠x, ay: f.cy - 캠y }; if (Math.abs(평틀.ax - 160) < 0.01) 평틀.ax = 160; if (Math.abs(평틀.ay - 100) < 0.01) 평틀.ay = 100; return 평틀; }
  function 평면줌() { return 켬() ? 1 : 평틀.z; }   /* 3D 스위치를 끈 원작 모드도 배율은 먹는다 — 전엔 1 로 고정해 휠·슬라이더가 안 먹었다 (사장님 11-11 「원작 평면상태에서 휠로 배율조절이 안되는데 … 전투, 마을 모두」) */
  function 맵마우스(m) { if (!m) return m; if (!켬()) { var 틀m = 평틀; return (틀m.z === 1 && 틀m.ax === 160 && 틀m.ay === 100) ? m : { x: Math.round(틀m.ax + ((+m.x || 0) - 160) / 틀m.z), y: Math.round(틀m.ay + ((+m.y || 0) - 100) / 틀m.z), 버튼: m.버튼 }; }   /* 평면 배율 — 화면 점 → 원본 화면 점 */ var q = null; try { q = 평면자리(m.x | 0, m.y | 0); } catch (e) {} return q ? { x: Math.round(q.x), y: Math.round(q.y), 버튼: m.버튼 } : m; }
  /* 정본 219 — 칸을 풀 마우스: 3D 면 날 마우스 그대로(감싼 마우스칸이 한 번 평면 자리로 옮긴다) · 아니면 평면 배율만 뺀 자리
   *   ☠ 부르는 곳마다 맵마우스(땅 자리) 뒤에 감싼 마우스칸이 또 땅 자리로 옮겨 3D 에서 역투영이 두 번 걸렸다 — 원근이 클수록 칸이 크게 어긋났다
   *     (2026-11-15 사장님 「3d맵에서 커서로 npc 구입물품 선택하는거에 문제가 많아. 원근설정에 따라 정확하게 계산해서 맞춰져야해. 지금은 제대로 클릭이 안돼」) */
  function 칸용마우스(m) { return 켬() ? m : 맵마우스(m); }
  /* 정본 219 — 매대(평면 D) 칸은 «세워 그린 상자 판»으로 고른다: 물품 그림(덧 진열품)·커서 상자는 발밑 맵 픽셀 (칸x×24+11, 칸y×16+24)에 세워진 24×16 판이라
   *   마우스 밑 땅을 짚으면 판 뒤쪽 땅 칸이 잡혔다 · 판 네 귀를 세워그리기와 같은 투영(화면점)으로 옮겨 마우스가 든 판을 찾는다(여럿이면 발이 앞인 것) · 없으면 null */
  function 매대칸(m, D, W, H) {
    var s = 상태; if (!켬() || !m || !D || !s || !s.세계 || !s.캔버스) return null;
    var mx = +m.x || 0, my = +m.y || 0, 고른 = null, 고른발 = -1e9;
    /* ☠ 11-16 한때 «원작 진열품은 맵에 눕혀 그려진다»고 짐작해 덧 진열품만 세운 판으로 고르게 바꿨다가 되돌림 —
     *   3D 에서 원작 진열품도 세워진다(사장님 11-16 「기울기에 따라 다른아이템은 세워지는데 그려넣은애들은 눕혀져 있어.」) · 눕힌 그림을 정답으로 잰 측정이 틀렸다 */
    var 안 = function (q, x, y) { var 부호 = 0; for (var i = 0; i < 4; i++) { var a = q[i], b = q[(i + 1) % 4], c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x); if (Math.abs(c) < 1e-9) continue; var g = c > 0 ? 1 : -1; if (부호 && g !== 부호) return false; 부호 = g; } return true; };
    for (var y = 0; y < H; y++) for (var x = 0; x < W; x++) {
      if (!((D[y * W + x] | 0) > 0)) continue;
      var 발x = x * 24 + 11 - s.캠x, 발y = y * 16 + 24 - s.캠y;
      var 귀 = [[발x - 12, 발y - 16], [발x + 12, 발y - 16], [발x + 12, 발y], [발x - 12, 발y]].map(function (p) { return 화면점(발x, 발y, p[0], p[1]); });
      if (귀.some(function (p) { return !p; })) continue;
      if (안(귀, mx, my) && 발y > 고른발) { 고른 = { x: x, y: y }; 고른발 = 발y; }
    }
    return 고른;
  }
  /* 마을 마우스 칸 — 3D 일 때는 마우스를 평면 자리로 옮겨 원래 식(0x1D154)에 넣는다 */
  if (root.G2TownObj && root.G2TownObj.마우스칸 && !root.G2TownObj.마우스칸._3d) {
    var 원마우스칸 = root.G2TownObj.마우스칸;
    /* ★ 정본 219 고침(11-16) — 3D 로 기울이면 원작 화면 밖(평면 자리 x·y < 0)까지 보여 짚는다. 원작 식은 «| 0»(0 쪽으로 자름)이라
     *   음수에서 한 칸 어긋났다(−46 ÷ 16 → −2 · 내림이면 −3 · 측정 11-16 기울기 60 매대 빗나감 128 점 전부 y < 0) — 원작 화면 안에서는 마우스가 음수일 일이 없다
     *   ⇒ 평면 자리를 100칸만큼 양수 쪽으로 밀고 카메라 칸을 그만큼 빼서 같은 원작 식에 넣는다(양수에서는 결과가 같다) */
    var 새마우스칸 = function (마우스, 카메라칸, 오프셋) {
      if (마우스 && 켬()) { var p = 평면자리(+마우스.x || 0, +마우스.y || 0);
        if (p) { var 밀 = 100; 마우스 = Object.assign({}, 마우스, { x: Math.round(p.x) + 밀 * 24, y: Math.round(p.y) + 밀 * 16 });
          카메라칸 = { x: ((카메라칸 && 카메라칸.x) | 0) - 밀, y: ((카메라칸 && 카메라칸.y) | 0) - 밀 }; } }
      /* 정본 263 — 원작 평면도 틀(가운데 옮김·축소)로 원작 화면 밖(논리 x·y < 0)이 보인다 · 같은 까닭(원작 식 «| 0» 은 0 쪽으로 자름)으로 100칸 밀어 넣는다 · 양수에서는 결과가 같다 */
      else if (마우스 && ((+마우스.x || 0) < 0 || (+마우스.y || 0) < 0)) { var 밀2 = 100; 마우스 = Object.assign({}, 마우스, { x: (+마우스.x || 0) + 밀2 * 24, y: (+마우스.y || 0) + 밀2 * 16 });
        카메라칸 = { x: ((카메라칸 && 카메라칸.x) | 0) - 밀2, y: ((카메라칸 && 카메라칸.y) | 0) - 밀2 }; }
      return 원마우스칸(마우스, 카메라칸, 오프셋); };
    새마우스칸._3d = true; root.G2TownObj.마우스칸 = 새마우스칸;
  }
  /** 3D 로 볼 마을을 아직 굽는 중이면 true — 마을 로딩 화면이 이것이 끝날 때까지 덮는다(평면이 비쳤다가 3D 로 바뀌었다 · 11-05 사장님 「마을 3d 진입시 3d 로드되기전에 로딩화면 나와야해」) */
  /* 정본 260 — 원작 평면에서도 기다린다: 평면이라 안 기다리면 로딩창이 먼저 닫히고 굽기(약 3초)가 새 맵 위에서 돌아 주민·키 입력이 멈췄다 (사장님 11-17 「그냥 3d를 다 로드한 상태에서 2d도 열리면 되지 않아?」) */
  function 기다리나() { return !!(상태 && !상태.준비됨 && !상태.실패 && 스위치()); }
  /* 바깥 마을 3D — 축대(비탈) 칸 중 계단이 아닌 칸은 못 가게 막는다 · 원작은 축대 그림 뒤로 들어가 숨지만 3D 에서는 축대 앞면 위에 선 꼴이 됐다
   *   계단 = 띠 전체를 걸을 수 있고 바로 위·아래 칸도 걸을 수 있는 띠 · 막으면 걸을 땅이 둘로 끊기는 무리는 막지 않는다 (사장님 11-05 「그냥 못가게 막는게 좋을 것 같은데」) */
  function 막음표(s) { if (s.막음 !== undefined) return s.막음; s.막음 = null; var 지 = s.장면.지정 && s.장면.지정(); if (!지 || 지.실내벽 || !지.갈수 || !지.축대구간) return null;
    var W = 지.W, H = 지.H, g = 지.갈수, 후 = new Uint8Array(W * H);
    지.축대구간.forEach(function (q) { if (!(q.위 > q.아래)) return; var 다 = true, y; for (y = q.y0; y <= q.y1; y++) if (!g[y * W + q.x]) 다 = false; var 위 = q.y0 > 0 && g[(q.y0 - 1) * W + q.x], 아 = q.y1 < H - 1 && g[(q.y1 + 1) * W + q.x]; if (다 && 위 && 아) return; for (y = q.y0; y <= q.y1; y++) if (g[y * W + q.x]) 후[y * W + q.x] = 1; });
    var 무 = new Int32Array(W * H).fill(-1), n = 0, i, k; for (i = 0; i < W * H; i++) { if (!g[i] || 후[i] || 무[i] >= 0) continue; var 큐 = [i]; 무[i] = n; while (큐.length) { k = 큐.pop(); var x = k % W; [x > 0 ? k - 1 : -1, x < W - 1 ? k + 1 : -1, k - W, k + W].forEach(function (j) { if (j >= 0 && j < W * H && g[j] && !후[j] && 무[j] < 0) { 무[j] = n; 큐.push(j); } }); } n++; }
    var 막 = new Uint8Array(W * H), 본 = new Uint8Array(W * H); for (i = 0; i < W * H; i++) { if (!후[i] || 본[i]) continue; var 묶 = [], 닿 = {}, 큐2 = [i]; 본[i] = 1; while (큐2.length) { k = 큐2.pop(); 묶.push(k); var x2 = k % W; [x2 > 0 ? k - 1 : -1, x2 < W - 1 ? k + 1 : -1, k - W, k + W].forEach(function (j) { if (j < 0 || j >= W * H || !g[j]) return; if (후[j]) { if (!본[j]) { 본[j] = 1; 큐2.push(j); } } else 닿[무[j]] = 1; }); }
      if (Object.keys(닿).length <= 1) 묶.forEach(function (q) { 막[q] = 1; }); }
    s.막음 = { W: W, 막: 막 }; return s.막음; }
  function 막힌칸(x, y) { if (!켬()) return false; var t = 막음표(상태); return !!(t && x >= 0 && x < t.W && t.막[y * t.W + x]); }
  root.G2마을3D = { 화면안: 화면안, 화면점: 화면점, 맵마우스: 맵마우스, 칸용마우스: 칸용마우스, 매대칸: 매대칸, 평면줌: 평면줌, 평면틀: 평면틀, 화면틀: 화면틀, 벽내리기: 벽내리기값, 막힌칸: 막힌칸, 평면자리: 평면자리, 기다리나: 기다리나, 쓸까: 쓸까, _속: function () { return 상태; },   /* 점검용 */ _칸높이: function (x, y, 발mx, 발my) { return 상태 ? 칸높이(상태, x, y, 발mx, 발my) : null; },   /* 점검용 — 가림·높이 측정기(정본 353)가 인물 선 높이를 잰다 · 동작 안 바꿈 */ 가림마무리: 가림마무리, 시점: function (v) { if (v) Object.keys(v).forEach(function (k) { if (k in 공유값) 공유값[k] = +v[k]; }); return 공유값; },   /* 시험용 — 기억은 안 바꿈 */ 준비: 준비, 그리기: 그리기, 세워그리기: 세워그리기, 켬: 켬, 버리기: function () { ++준비번호; 버리기(); },
    상태: function () { return 상태 && { 키: 상태.키, 준비됨: 상태.준비됨, 실패: 상태.실패 || null, 실패자리: 상태.실패자리 || null, 캠: 상태.캠 }; } };
})(typeof window !== 'undefined' ? window : globalThis);
