/* ============================================================================
 * **마을 대사창** — `PACK 0x26E32` (§Y-3 · §FF · §HH)
 *
 * ★★ 월드(`CHP.EXE`)와 **같은 그림**이지만 **다른 EXE 에서** 온다 —
 *   `PACK 0x58CF4`(= `mov ebx, 0x8CF4` 에 `+0x50000`)이고, 실측 **261 × 94** 다.
 *   `CHP 0x82720` 과 같은 이미지임을 픽셀로 대조했다(§V-9).
 *
 * ── 위/아래를 가르는 규칙 (`0x26E50`) ────────────────────────────────────
 *   ```asm
 *   0x26E44  esi = 인물번호 × 13                  ; 화면 레코드 (§BB-7)
 *   0x26E50  cmp [esi + 0x3293A], 0x64 ; jge …    ; ★ 인물 화면 **Y ≥ 100** 이면 다른 갈래
 *   0x26E9E  eax = 0x1E(30) ; ebx = 0x8CF4        ; ★ 대사창을 **X = 30** 에
 *   0x26EAE  edx = edi                            ;   Y 는 0x24DA5 가 정한다
 *   0x26ECD  cmp [esi + 0x32938], 0xA0            ;   가로도 절반(160)으로 가른다
 *   ```
 *   ⇒ **말을 건 인물이 화면 위쪽(Y < 100)이면 창을 아래에**, 아래쪽이면 위에 띄운다.
 *     월드 대사창의 「초상화 `y = 115 − 높이`, 위 창은 `199 − 높이`」와 같은 성격이다.
 *
 * ── 「예 / 아니요」 (§HH · `0x1B514`~`0x1B60A`) ──────────────────────────
 *   문구에 **붙어 있는 한 줄**이고 그 위에 클릭 영역이 얹힌다.
 *   좌표는 `townpick.예아니요` 가 들고 있다.
 *
 * ★★★★★ **`0x24DA5` 의 좌표식을 읽었다 (2026-08-29)**
 *   ```asm
 *   0x24DB7  bl = [ecx + 0x32935] · **imul ebx, 0x3842(14402)**   ; 묶음
 *   0x24DC7  ax = [ecx + 0x32936](오브젝트 번호)
 *   0x24DCE  ebx = [ebx + eax*4 + 0x340A6]                        ; ★ 프레임 서술자
 *   0x24DD5  edx = [ecx+0x32936] sar 16 · eax = [ebx+2] sar 16
 *   0x24DE2  esi = edx + eax                                      ;   x + 앵커 ax
 *   0x24DE7  dx = [ebx](폭) · sar edx,31 · sub eax,edx · **sar eax,1**
 *   0x24DF7  add esi, eax                                         ; ★ **+ 폭/2** (가운데)
 *   0x24DFB  edx = [ecx + 0x32938] · eax = [ebx+4] …              ;   y 쪽 같은 꼴
 *   0x24E1B  **cmp esi, 0xA0(160)** / jge                         ; ★ 화면 절반으로 가른다
 *   0x24E20  cmp edi, 1 / jne
 *   ```
 *   ⇒ 좌표는 **오브젝트 좌표 + 프레임 앵커 + 폭/2**(가운데 정렬)이고,
 *     갈래는 **x 가 160 이상인가**로 나뉜다(위/아래가 아니라 **좌/우**다).
 * ✅ **남았던 것을 채운다 (2026-08-31)**
 *   ① `0x24BA4` 는 글자가 아니라 **`portrait.syf` 로더**다 —
 *     `0x26EC8 call 0x24BA4` 가 받는 `al` 은 **캐릭터 레코드 `+16`**(초상화 번호)이다.
 *     `0x1C088 bl = byte [0xF7880]` 이 그 칸을 넘긴다(`0xF7870` = 레코드 136 B 사본).
 *     세이브 123명의 `+16` 은 0~84 이고 **84 가 15명**으로 가장 많다.
 *   ② 위/아래와 **좌/우가 둘 다** 있다 —
 *     `0x26ECD cmp word [레코드 + X], 0xA0(160)`
 *       → 오른쪽에 있으면 `0x26ED8 esi = **8**`
 *       → 왼쪽에 있으면 `0x26EE1 eax = **0x138(312)** − [esp+0x10]`
 *     ⇒ **대사창은 말을 건 상대의 반대쪽에 뜼다** — 네 자리 모두 원본에서 나왔다.
 *   ③ 말풍선 꿬리는 **`0x5E4F9` 부터 200 B 씩 여덟 장**이다 —
 *     `0x24E28 edx = 2 → call 0x2B81D`(난수 0/1) · `edx = 난수 + 4/6/2` · `×200`.
 *     뽑아 보았다 — `03_분석/화면사양/원본화면/말풍선꿬리_8.png`
 *     (0~3 아래쪽 · 4~5 위쪽 왼편 · 6~7 위쪽 오른편).
 *   문서 `03_분석/마을_화면_원본확정.md` §ZZ-2 ~ §ZZ-6.
 * ★★★★★ **창 Y 두 값을 원본에서 찾았다 — 위 80 · 아래 105** (2026-09-02)
 *   `0x24DA5` 가 인물 화면 X(`esi`)와 위/아래(`edi`)로 네 갈래를 타고
 *   말풍선 꼬리를 그린 뒤 **창 Y 를 돌려준다** —
 *   `0x24E82 mov eax, 0x50(80)`(위) · `0x24F47 mov eax, 0x69(105)`(아래).
 *   좀우로는 안 바뀐다(`0x24EE5`·`0x24FA8` 이 같은 자리로 합류).
 * ==========================================================================*/
(function (root) {
'use strict';

var 창그림 = 0x58CF4;              /* PACK — `mov ebx, 0x8CF4` + 0x50000 */
var 창X = 30;                      /* 0x26E9E mov eax, 0x1E */
var 창폭 = 261, 창높이 = 94;       /* 실측 */
var 가름Y = 100;                   /* 0x26E50 cmp […], 0x64 */
var 가름X = 160;                   /* 0x26ECD cmp […], 0xA0 */

/**
 * ★★★★★ **창 안은 그림이 아니라 「배경 어둡게 하기」다** (2026-08-28 · §NN-13)
 *
 *   사용자가 보낸 상자 취득 화면에서 **띠 안에 맵이 어렴풋이 비쳤다.**
 *   원본을 따라가니 그대로였다:
 *   ```asm
 *   0x26E7F  edx = 0 ; ebx = 0x9ABD          ; ★ 자료
 *   0x26E91  edx = eax + 9 ; eax = 0x24(36)  ; ★ (36, 창Y + 9)
 *   0x26E99  call 0x186DC                    ; ★★ **어둡게 하기**
 *   0x26E9E  eax = 0x1E(30) ; ebx = 0x8CF4   ;   그 위에 금색 테두리를 (30, 창Y) 에
 *   0x26EB0  call 0x2B240
 *   ```
 *   `0x186DC` 는 월드(`CHP 0x1CAB0`)와 **같은 꼴**이다 —
 *   `w = [자료+1]<<8 | [자료]` · `h = [자료+3]<<8 | [자료+2]` 를 읽고
 *   자료가 `0xFF` 인 자리는 건드리지 않으며, 그 밖에는
 *   **`인덱스 = 7 − (화면 픽셀 밝기 ÷ 37)`** 로 바꾼다.
 *
 *   ★★ 자료 `0x59ABD` 는 **250 × 76** 이고 `0x04` 16,662칸 · `0xFF` 2,338칸이다 —
 *     월드의 `0x834E9`(250 × 76)와 **크기·형식이 같다.** 값 `4` 는 마스크일 뿐 뜻이 없다.
 *   ★ 좌표 관계도 월드와 같다 — 월드는 테두리 (30, 50) · 어둡게 (36, 59)로 **차이 9** 다.
 */
var 어둡게자료 = 0x59ABD;
var 어둡게X = 36, 어둡게Y더하기 = 9;   /* 0x26E94 eax = 0x24 · 0x26E91 lea edx,[eax+9] */

/**
 * 창을 놓는 두 자리.
 * ★ 원작 대사창 스크린샷에서 **창 상단이 화면 y ≈ 10** 이었고, 월드 대사창도
 *   위 `10` · 아래 `114` 다(`CHP 0x2B37B`·`0x2B26F`). 같은 값을 쓴다.
 * ★★★ **2026-08-29 — `0x24DA5` 의 갈래는 Y 가 아니라 X 였다.**
 *   `0x24E1B  cmp esi, 0xA0(160) / jge` — **x 가 화면 절반을 넘는가**로 가른다
 *   (위 §좌표식). Y 식은 같은 꼴로 `[ecx+0x32938]` 과 `[ebx+4]` 를 쓴다.
 *   값이 맞는지는 화면으로 대조했다.
 */
/* ★★★★★ **창 Y 는 원본에서 나온다 — 위 80 · 아래 105** (2026-09-02 확정)
 *
 *   창 자리를 정하는 것은 `0x24DA5` 다. 인물 화면 X(`esi`)와 위/아래(`edi`)로
 *   **네 갈래**를 타고, 각 갈래가 말풍선 꼬리를 그린 뒤 **창 Y 를 돌려준다**.
 *   ```asm
 *   0x24E1B  cmp esi, 0xA0(160) ; jge 0x24E8C     ; 인물이 오른쪽인가
 *   0x24E23  cmp edi, 1 ; jne 0x24E8C             ; 위쪽인가
 *   0x24E82  mov eax, **0x50(80)**  ← ① X<160 · 위
 *   0x24EE5  jmp 0x24E7D → 같은 0x24E82           ← ② X≥160 · 위   ⇒ **80**
 *   0x24F47  mov eax, **0x69(105)** ← ③ X<160 · 아래
 *   0x24FA8  jmp 0x24F42 → 같은 0x24F47           ← ④ X≥160 · 아래 ⇒ **105**
 *   0x24FAA  mov eax, −1                          ← 그 밖(못 그림)
 *   ```
 *   ⇒ 창 Y 는 **위/아래 두 값뿐**이고 좌우로는 안 바뀐다.
 *   ☠ 예전에는 위쪽을 「원작 스크린샷에서 y ≈ 10」으로 **눈대중**했다. **틀렸다.**
 *   ★ 아래쪽 105 는 맞았다 — `199 − 94` 로 잡은 값이 우연히 원본과 같다.
 */
var 위Y반환 = 80;                  /* 0x24E82 mov eax, 0x50 */
var 아래Y = 105;                   /* 0x24F47 mov eax, 0x69 (= 199 − 창높이) */

/* ★★★★★ **위쪽 창은 반환값 그대로가 아니다 — `− 79`** (2026-09-03 확정)
 *
 *   `0x24DA5` 가 돌려주는 80 · 105 는 **그리기 좌표가 아니다.**
 *   대사창은 인물 화면 Y 로 **갈래가 갈리고**(`0x26E50 cmp …, 0x64` = 100),
 *   갈래마다 그 값을 **다르게 보정**한다 —
 *
 *   ```asm
 *   ; ① 인물 Y < 100 → 창이 **아래** (0x26E5E~)
 *   0x27178  esi = eax                  ; = 105
 *   0x2717C  lea edx, [eax + 9]         ;   어둡게 y = 105 + 9 = 114
 *   0x27199  edx = esi ; call 0x2B240   ; ★ 틀 y = **105**
 *
 *   ; ② 인물 Y ≥ 100 → 창이 **위** (0x26F1D~)
 *   0x26F4D  edi = eax                  ; = 80
 *   0x26F52  lea edx, [eax − **0x46**]  ;   어둡게 y = 80 − 70 = **10**
 *   0x26F6F  lea edx, [edi − **0x4F**]  ; ★ 틀 y = 80 − 79 = **1**
 *   0x26F72  call 0x2B240
 *   ```
 *   ⇒ 위쪽 창의 **틀은 y 1**, 어둡게는 **y 10** 이다. 차이는 아래와 똑같이 **9**.
 *
 *   ★★★★★ **원본을 돌려 화면 픽셀로 재어 봤다** (2026-09-09)
 *     js-dos 원본이 마을 실내 대사 장면(초상화 + 「이 실종되는 사건이 늘고 있다네.」)에
 *     있을 때, 논리 320×200 화면에서 **주황 장식선이 굵은 가로줄**을 세었다 —
 *       **y 114** 와 **y 187**   (주황 점 전체 1,259 개 · 한 줄에 40 점 이상인 것만)
 *     `0x2717C` 가 내는 **114** 와 한 픽셀도 안 어긋난다.
 *     ★ 위쪽 창 갈래가 아님도 그것으로 갈렸다 — 위쪽이면 `0x26F52` 의 **10** 이 나온다.
 *     ☠ 주석이 맞는지 **원본으로 재어 본** 기록이다 — 값을 옮기기 전에 한 번 더 보는
 *       것이 규칙이다(CLAUDE.md §2-1-a-2).
 *     ★ 그때 잰 창 안 글자색 — 가장 많은 것이 **`255,247,178`**(906 점) 연노랑이다.
 *     ☐ **`y 187` 이 무엇인지는 못 찾았다.** 창 높이가 `199 − 105 = 94` 면 아래끝이
 *       199 여야 하는데 187 이다. 틀 그림의 아래 여백일 수 있다 — 확인 안 했다.
 *     ☐ 위쪽 창(`틀 y 1`·`어둡게 y 10`)은 **못 쟀다** — 원본이 아래쪽 창 장면이었다.
 *
 *   ☠ 우리는 80 을 **그대로 창 y** 로 썼다 — **79 픽셀 아래**에 그렸다.
 *   ★ 원본 화면(일반 DOSBox 캡처)에서 위쪽 창의 금색 테두리가
 *     논리 **y 10~12** 에 있는 것과 맞는다(틀 그림 위쪽 여백 9). */
var 위Y = 위Y반환;                 /* 0x24E82 — **반환값 그대로** (선택지 줄 Y 는 이것 − 16) */
var 위창보정 = 79;                 /* 0x26F6F lea edx,[edi − 0x4F] — 위쪽 **창(틀)** 만 뺀다 */

/**
 * 말을 건 인물의 화면 위치로 **창을 위에 띄울지 아래에 띄울지** 고른다.
 * @param {{x:number,y:number}} 인물화면  `townobj.화면좌표` 의 결과
 * @returns {{x:number, y:number, 위쪽:boolean}}
 */
function 창자리(인물화면) {
  var y = (인물화면 && 인물화면.y | 0) || 0;
  /* ★ 인물이 위쪽(Y < 100)이면 창은 **아래**로 간다 (0x26E50 jge 로 갈린다) */
  var 위쪽 = (y >= 가름Y);
  /* ★ 위쪽이면 **틀 y = 반환값 − 79** 다(`0x26F6F`). 어둡게는 `대사판` 이 `+9` 하므로
   *   `1 + 9 = 10` 이 되어 원본 `0x26F52 lea edx,[eax−0x46]`(80−70=10)과 맞는다. */
  return { x: 창X, y: 위쪽 ? (위Y - 위창보정) : 아래Y, 위쪽: 위쪽 };
}

/**
 * ★★★ **두 줄의 Y** — 2행은 원본이 못박아 준다.
 *
 *   「예」·「아니요」를 찍는 자리가 **(178, 136)** · **(218, 136)** 이다
 *   (§HH · `0x1B56F push 0x88` = 136). 그 둘은 **2행 안에** 있으므로
 *   **2행 Y = 136** 이다. 창이 아래(`y = 105`)일 때 창 안 **31** 이다.
 *
 *   ★★★ **2026-08-29 — 그 대역에 「1행」이 따로 없다.**
 *     `0x1B400`~`0x1B700` 에서 `push <y>` 를 전수로 보면 **전부 `0x88`(136)** 이다
 *     (`0x1B4C6 0x1B574 0x1B59C 0x1B634 0x1B65C 0x1B693` — 여섯 곳).
 *     달라지는 것은 **x** 뿐이다(`0xB2`(178) · `0xDA`(218) · `0x511A2`/`0x511A5` 서식).
 *     ⇒ **한 줄에 조각을 여러 개 찍는 것**이지 두 행이 아니다.
 *   ★ 글자 높이 **16** 은 확정이다(`[0x755C6]` · `hud.js` §줄 높이).
 *   ★ 그러니 우리 `줄높이 20` 은 **그리기에 안 쓰인다** (2026-09-02 확인) —
 *     `줄Y()` 를 부르는 곳은 **시험뿐**이고(`마을_상점.test.js`), 대사 본문은
 *     `대사줄Y()` 가 `줄버키[줄]` 로 따로 잡는다. 값은 그대로 둔다.
 *   ★ 참고 (2026-09-02) — 대사 본문은 **줄버키[줄]** 로 자리를 잡고(간격 16),
 *     한 줄이 **넘칠 때만** `0x2754C  add dword [esp+0x84], **0x1A(26)**` 로
 *     y 를 26 늘리고 `0x27565 cmp/jle` 로 창 아래 한계와 견줌다.
 *     그 숫자를 **줄 간격으로 오해하지 말 것** — `[esp+0x84]` 가 y · `[esp+0x88]` 이 x 다
 *     (`0x27545` 가 x 를 줄 처음으로 되돌린다).
 */
var 줄높이 = 20;
var 아래창2행Y = 136;                 /* 0x1B56F push 0x88 */
/* ★ 창이 아래(114)일 때 2행이 136 이면 창 안 **22** 다 */

function 줄Y(자리) {
  var 두번째 = 자리.위쪽 ? (자리.y + (아래창2행Y - 아래Y)) : 아래창2행Y;
  return { 첫: 두번째 - 줄높이, 둘: 두번째 };
}

/**
 * 문구 한 줄을 창 안에서 **가운데**로 놓을 X — 월드 이름표와 같은 셈법.
 * @param {string} 글  조합형을 푼 한글 문자열
 * @returns {number}
 */
function 가운데X(글) {
  var w = 0;
  for (var i = 0; i < String(글 || '').length; i++)
    w += (글.charCodeAt(i) > 0x7F) ? 16 : 8;      /* 한글 16 · 영문 8 */
  return 창X + (((창폭 - w) / 2) | 0);
}

/**
 * ★★★★★ **배경을 어둡게 한다** — `PACK 0x186DC` (월드 `CHP 0x1CAB0` 과 같은 꼴)
 *
 *   ```asm
 *   0x186E9  eax = y × 320 + x            ; 화면 오프셋
 *   0x186FD  w = [자료+1]<<8 | [자료]      ; 0x18712 h = [자료+3]<<8 | [자료+2]
 *   ; (월드 0x1CAB0 과 같은 본문)
 *   cmp [자료], 0xFF / je                  ; ★ 0xFF 면 **건드리지 않는다**
 *   edx = pal[화면픽셀].R + .G + .B ; idiv 37
 *   edx = 7 − eax                          ; ★★ **인덱스 = 7 − 밝기 ÷ 37**
 *   ```
 *
 *   ⇒ **미리 구워 둘 수 없다** — 배경이 바뀌면 결과도 바뀐다. 매번 그 자리를 읽어 다시 만든다.
 *   ★ 원본 팔레트는 VGA **6비트**라 8비트 값은 `>> 2` 해서 잰다.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array} 자료  `PACK` LE 이미지에서 `0x59ABD − BASE` 부터
 * @param {number} x @param {number} y
 * @param {Uint8Array} 팔  `decodePalette` 가 편 8비트 팔레트
 */
var 어둡게표 = {};   /* 정본 400 — «밝기 → 색» 표 (팔레트 24값·보간 여부마다 하나) — 어둡게() 안 주석 */
/* 정본 400 — 어둡게를 그래픽 카드(WebGL2)에서: 화면을 CPU 로 되읽지(getImageData) 않는다
 *   되읽기는 그래픽 카드가 하던 일을 다 끝낼 때까지 기다리게 해 안드로이드에서 특히 비쌌다
 *   (갤럭시 S24 기록 R0.1.98 마을 대사 중 장마다 셸 28~30ms · 측정 크롬 CPU×4 대사 중 어둡게 장당 5ms 중 되읽기 4ms)
 *   같은 «밝기 → 색» 표(어둡게표)와 같은 마스크(건드리지 않는 칸)를 텍스처로 넘겨 같은 정수 식으로 칠한다 — 결과 같음(town_darken_gpu_400 화소 견줌)
 *   WebGL2 가 없거나 실패하면 CPU 길 · 끄기 window.__어둡게CPU */
var 어GPU = null;
function 어GPU준비() {
  if (어GPU) return 어GPU.gl ? 어GPU : null;
  어GPU = {};
  try {
    var d = root.document; if (!d || !d.createElement) return null;
    var cv = d.createElement('canvas');
    var gl = cv.getContext('webgl2', { premultipliedAlpha: false, preserveDrawingBuffer: true, antialias: false, alpha: true, depth: false, stencil: false });
    if (!gl) return null;
    var 셰 = function (종, 글) { var s = gl.createShader(종); gl.shaderSource(s, 글); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    var pr = gl.createProgram();
    gl.attachShader(pr, 셰(gl.VERTEX_SHADER, '#version 300 es\nin vec2 p;void main(){gl_Position=vec4(p,0.0,1.0);}'));
    gl.attachShader(pr, 셰(gl.FRAGMENT_SHADER, '#version 300 es\nprecision highp float;precision highp int;' +
      'uniform highp sampler2D uSrc;uniform highp sampler2D uMask;uniform highp sampler2D uLut;uniform int uH;out vec4 o;' +
      'void main(){ivec2 q=ivec2(gl_FragCoord.xy);q.y=uH-1-q.y;vec4 c=texelFetch(uSrc,q,0);' +
      'if(texelFetch(uMask,q,0).r>0.5){o=c;return;}' +
      'ivec3 v=ivec3(floor(c.rgb*255.0+0.5));int b=(v.r>>2)+(v.g>>2)+(v.b>>2);' +
      'o=vec4(texelFetch(uLut,ivec2(b,0),0).rgb,1.0);}'));
    gl.bindAttribLocation(pr, 0, 'p'); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    var bf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, bf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    var 텍 = function (단) { var t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + 단); gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
    var tSrc = 텍(0), tMask = 텍(1), tLut = 텍(2);
    gl.uniform1i(gl.getUniformLocation(pr, 'uSrc'), 0); gl.uniform1i(gl.getUniformLocation(pr, 'uMask'), 1); gl.uniform1i(gl.getUniformLocation(pr, 'uLut'), 2);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false); gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    var 판 = d.createElement('canvas');
    어GPU = { cv: cv, gl: gl, uH: gl.getUniformLocation(pr, 'uH'), tSrc: tSrc, tMask: tMask, tLut: tLut, 판: 판, 판g: 판.getContext('2d'), 마스크키: null, 표: null };
    return 어GPU;
  } catch (e) { 어GPU = {}; try { console.warn('[어둡게GPU] ' + (e && e.message)); } catch (x) {} return null; }
}
/* 마스크(pw×ph · 1 = 건드리지 않는 칸)를 만든다 — 어둡게() 고리의 자리 식 그대로 (자료 없으면 전부 0 = 다 칠함 · 어둡게사각형) */
function 어GPU마스크(자료, w, h, 배X, 배Y, pw, ph) {
  var m = new Uint8Array(pw * ph);
  if (!자료) return m;
  var 열 = new Int32Array(pw);
  for (var x = 0; x < pw; x++) { var mx = (x / 배X) | 0; if (mx >= w) mx = w - 1; 열[x] = mx; }
  for (var y = 0; y < ph; y++) { var my = (y / 배Y) | 0; if (my >= h) my = h - 1; var 줄 = 4 + my * w, o = y * pw;
    for (var x2 = 0; x2 < pw; x2++) if (자료[줄 + 열[x2]] === 0xFF) m[o + x2] = 255; }
  return m;
}
function 어둡게GPU(ctx, px0, py0, pw, ph, 표, 마스크키, 마스크만들기) {
  if (root.__어둡게CPU || !ctx || !ctx.canvas) return false;
  var G = 어GPU준비(); if (!G) return false;
  var gl = G.gl;
  try {
    if (gl.isContextLost()) return false;
    if (G.판.width !== pw || G.판.height !== ph) { G.판.width = pw; G.판.height = ph; G.판g = G.판.getContext('2d'); }
    G.판g.imageSmoothingEnabled = false; G.판g.globalCompositeOperation = 'copy';
    G.판g.drawImage(ctx.canvas, px0, py0, pw, ph, 0, 0, pw, ph);             /* 그래픽 카드 안에서 영역만 옮긴다 */
    if (G.cv.width !== pw || G.cv.height !== ph) { G.cv.width = pw; G.cv.height = ph; }
    gl.viewport(0, 0, pw, ph);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, G.tSrc);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, G.판);
    if (G.마스크키 !== 마스크키) {
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, G.tMask);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, pw, ph, 0, gl.RED, gl.UNSIGNED_BYTE, 마스크만들기());
      G.마스크키 = 마스크키;
    }
    if (G.표 !== 표) {
      var lut = new Uint8Array(256 * 4);
      for (var i = 0; i < 190; i++) { lut[i * 4] = 표[i * 3]; lut[i * 4 + 1] = 표[i * 3 + 1]; lut[i * 4 + 2] = 표[i * 3 + 2]; lut[i * 4 + 3] = 255; }
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, G.tLut);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, lut);
      G.표 = 표;
    }
    gl.uniform1i(G.uH, ph);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.beginPath(); ctx.rect(px0, py0, pw, ph); ctx.clip();
    ctx.globalCompositeOperation = 'copy'; ctx.globalAlpha = 1; ctx.imageSmoothingEnabled = false;
    ctx.drawImage(G.cv, px0, py0);
    ctx.restore();
    return true;
  } catch (e) { try { console.warn('[어둡게GPU] ' + (e && e.message)); } catch (x) {} 어GPU = {}; return false; }
}
function 어둡게(ctx, 자료, x, y, 팔) {
  if (!ctx || !자료 || !팔) return false;
  var w = (자료[0] | 0) | ((자료[1] | 0) << 8);
  var h = (자료[2] | 0) | ((자료[3] | 0) << 8);
  if (!(w > 0 && h > 0 && w <= 640 && h <= 480)) return false;

  /* ★★★★★ **`getImageData` 는 캔버스 변환을 무시한다** (월드가 겪은 함정 · 2026-08-24)
   *
   *   `ctx` 에는 확대(`scale`)가 걸려 있어 `drawImage`·`drawText` 는 논리 좌표로
   *   그리는데, `getImageData`/`putImageData` **만은 실제 픽셀 좌표**를 쓴다.
   *   논리 좌표를 그대로 넘기면 **엉뚱한 자리**를 칠하고 창은 투명해진다.
   *   ⇒ 변환에서 실제 좌표·크기를 구하고, 마스크는 **논리 좌표로 되돌려** 찾는다. */
  var M = ctx.getTransform ? ctx.getTransform() : null;
  var 배X = M ? (M.a || 1) : 1, 배Y = M ? (M.d || 1) : 1;
  var 밀X = M ? (M.e || 0) : 0, 밀Y = M ? (M.f || 0) : 0;
  var px0 = Math.round(x * 배X + 밀X), py0 = Math.round(y * 배Y + 밀Y);
  var pw = Math.max(1, Math.round(w * 배X)), ph = Math.max(1, Math.round(h * 배Y));

  var im, px;
  /* [리마스터] 스케일러가 켜져 캔버스가 1배보다 크면 8단계 양자화 대신 회색 램프(팔레트 0~7)를 밝기로 **보간** — 원작(0x186DC)은 팔레트 색인 8단계라
   *   xBRZ 가 만든 중간색이 전부 8색으로 눌려 창 안 배경이 도트로 보였다 (11-13 사장님 마을 이벤트 대사 사진) */
  var 보간 = !!(root.G2Scaler && typeof root.G2Scaler.N === 'function' && root.G2Scaler.N() > 1 && 배X > 1.01);
  /* 정본 400 — 밝기는 0~189 의 190가지뿐이다 ⇒ 아래 고리의 식(보간·8단계) 그대로 «밝기 → 색» 표를 한 번 만들고, 마스크 열 자리도 열마다 한 번만 센다
   *   결과는 한 화소도 안 바뀐다(같은 식 · 같은 정수 자름) · hq4x 마을 대사창 한 번 9.5ms(되읽기 5.5 + 화소 고리 약 4 · CPU×4 면 12 + 15)
   *   (PC 기록 11-23 19:58 R0.1.93 1536×802 hq4x 마을 이벤트 대사 중 장마다 셸 약 50ms · 평균 15.6fps) · 끄기 window.__어둡게옛 */
  if (!root.__어둡게옛) {
    var 표키 = (보간 ? 'b' : 'q') + Array.prototype.join.call(팔.subarray ? 팔.subarray(0, 24) : Array.prototype.slice.call(팔, 0, 24), ',');
    var 표 = 어둡게표[표키];
    if (!표) {
      표 = new Uint8Array(190 * 3);
      for (var 밝 = 0; 밝 < 190; 밝++) {
        if (보간) {
          var f0 = 7 - 밝 / 37; if (f0 < 0) f0 = 0; if (f0 > 7) f0 = 7;
          var j0 = f0 | 0, j1 = (j0 < 7) ? j0 + 1 : 7, t0 = f0 - j0;
          표[밝 * 3]     = (팔[j0 * 3]     * (1 - t0) + 팔[j1 * 3]     * t0) | 0;
          표[밝 * 3 + 1] = (팔[j0 * 3 + 1] * (1 - t0) + 팔[j1 * 3 + 1] * t0) | 0;
          표[밝 * 3 + 2] = (팔[j0 * 3 + 2] * (1 - t0) + 팔[j1 * 3 + 2] * t0) | 0;
        } else {
          var k0 = 7 - ((밝 / 37) | 0); if (k0 < 0) k0 = 0; if (k0 > 7) k0 = 7;
          표[밝 * 3] = 팔[k0 * 3]; 표[밝 * 3 + 1] = 팔[k0 * 3 + 1]; 표[밝 * 3 + 2] = 팔[k0 * 3 + 2];
        }
      }
      어둡게표[표키] = 표;
    }
    if (어둡게GPU(ctx, px0, py0, pw, ph, 표, 자료.length + '|' + w + 'x' + h + '|' + 배X + ',' + 배Y + '|' + pw + 'x' + ph + '|' + (자료.byteOffset | 0), function () { return 어GPU마스크(자료, w, h, 배X, 배Y, pw, ph); })) return true;   /* 정본 400 — 어GPU준비 주석 */
    im = ctx.getImageData(px0, py0, pw, ph); px = im.data;
    var 열 = new Int32Array(pw);
    for (var x1 = 0; x1 < pw; x1++) { var m1 = (x1 / 배X) | 0; if (m1 >= w) m1 = w - 1; 열[x1] = m1; }
    for (var y1 = 0; y1 < ph; y1++) {
      var my1 = (y1 / 배Y) | 0; if (my1 >= h) my1 = h - 1;
      var 줄 = 4 + my1 * w, q1 = y1 * pw * 4;
      for (var x2 = 0; x2 < pw; x2++, q1 += 4) {
        if (자료[줄 + 열[x2]] === 0xFF) continue;      /* ★ 안 건드린다 */
        var b1 = ((px[q1] >> 2) + (px[q1 + 1] >> 2) + (px[q1 + 2] >> 2)) * 3;
        px[q1] = 표[b1]; px[q1 + 1] = 표[b1 + 1]; px[q1 + 2] = 표[b1 + 2]; px[q1 + 3] = 255;
      }
    }
    ctx.putImageData(im, px0, py0);
    return true;
  }
  im = ctx.getImageData(px0, py0, pw, ph); px = im.data;
  for (var yy = 0; yy < ph; yy++) {
    var my = (yy / 배Y) | 0; if (my >= h) my = h - 1;
    for (var xx = 0; xx < pw; xx++) {
      var mx = (xx / 배X) | 0; if (mx >= w) mx = w - 1;
      var mk = 자료[4 + my * w + mx];
      if (mk === 0xFF) continue;                       /* ★ 안 건드린다 */
      var q = (yy * pw + xx) * 4;
      /* ★ 6비트로 낮춰 잰다 — 원본 팔레트가 0~63 이다 */
      var 밝기 = (px[q] >> 2) + (px[q + 1] >> 2) + (px[q + 2] >> 2);
      if (보간) {
        var f = 7 - 밝기 / 37; if (f < 0) f = 0; if (f > 7) f = 7;      /* 같은 식을 실수로 — 두 색 사이를 섞는다 */
        var i0 = f | 0, i1 = (i0 < 7) ? i0 + 1 : 7, t = f - i0;
        px[q]     = (팔[i0 * 3]     * (1 - t) + 팔[i1 * 3]     * t) | 0;
        px[q + 1] = (팔[i0 * 3 + 1] * (1 - t) + 팔[i1 * 3 + 1] * t) | 0;
        px[q + 2] = (팔[i0 * 3 + 2] * (1 - t) + 팔[i1 * 3 + 2] * t) | 0;
        px[q + 3] = 255;
        continue;
      }
      var idx = 7 - ((밝기 / 37) | 0);                 /* ★★ 0x186DC 본문 */
      if (idx < 0) idx = 0;
      if (idx > 7) idx = 7;
      px[q] = 팔[idx * 3]; px[q + 1] = 팔[idx * 3 + 1]; px[q + 2] = 팔[idx * 3 + 2];
      px[q + 3] = 255;
    }
  }
  ctx.putImageData(im, px0, py0);
  return true;
}

/**
 * ★★★★★ **직사각형을 통째로 어둡게** — `PACK 0x18899` → `0x187C3` (2026-09-02)
 *
 *   ☠ 문서 여러 곳이 `0x18899` 를 「**창 영역**」·「창을 그린다」로 적어 두었다.
 *     실제로 여는 것은 **어둡게 하기**다 — 위 `어둡게()` 와 **같은 알고리즘**이고
 *     다른 점은 **마스크가 없다**는 것뿐이다.
 *
 *   ```asm
 *   0x18899  esi=eax(x1) · ebp=ecx(y2) · edi=ebx(x2) · ecx=edx(y1)
 *   0x188A4  sub edi, eax                 ;   폭 = x2 − x1
 *   0x188AE  call 0x187C3(x1, y, 폭)      ;   줄마다 부른다
 *   0x188B3  inc ecx · 0x188B4 cmp ecx,ebp · jl   ; y1 … y2−1
 *
 *   0x187C3  eax = y*320 + x + [0x15B9CC]        ;   화면 주소
 *   0x187E2  8a 03  mov al, [ebx]                ; ★ 화면의 **기존 픽셀**
 *   0x187F1  movzx esi, [eax + 0x15B2B8]         ;   팔레트 R
 *   0x187F8  mov dl,  [eax + 0x15B2B9]           ;          G
 *   0x187FE  mov al,  [eax + 0x15B2BA]           ;          B
 *   0x1880D  mov esi, **37**                     ; ★★ ÷ 37 → 인덱스 = 7 − 그것
 *   ```
 *
 *   ★ `y2` 는 **넘지 않는다**(`jl`) — `(0,85)~(319,115)` 면 **85~114** 서른 줄이다.
 *
 * @param {number} x1 @param {number} y1 @param {number} x2 @param {number} y2
 * @param {Uint8Array} 팔  `decodePalette` 가 편 8비트 팔레트
 */
function 어둡게사각형(ctx, x1, y1, x2, y2, 팔) {
  if (!ctx || !팔) return false;
  var w = (x2 | 0) - (x1 | 0), h = (y2 | 0) - (y1 | 0);   /* 0x188A4 · 0x188B4 jl */
  if (!(w > 0 && h > 0 && w <= 640 && h <= 480)) return false;

  /* ★ `getImageData` 는 캔버스 변환을 무시한다 — 위 `어둡게()` 와 같은 함정 */
  var M = ctx.getTransform ? ctx.getTransform() : null;
  var 배X = M ? (M.a || 1) : 1, 배Y = M ? (M.d || 1) : 1;
  var 밀X = M ? (M.e || 0) : 0, 밀Y = M ? (M.f || 0) : 0;
  var px0 = Math.round((x1 | 0) * 배X + 밀X), py0 = Math.round((y1 | 0) * 배Y + 밀Y);
  var pw = Math.max(1, Math.round(w * 배X)), ph = Math.max(1, Math.round(h * 배Y));

  /* 정본 400 — 그래픽 카드 길(어GPU준비 주석) · 8단계 표 = 어둡게() 의 보간 아님 표와 같은 식 */
  if (!root.__어둡게CPU) {
    var 표키4 = 'q' + Array.prototype.join.call(팔.subarray ? 팔.subarray(0, 24) : Array.prototype.slice.call(팔, 0, 24), ',');
    var 표4 = 어둡게표[표키4];
    if (!표4) { 표4 = new Uint8Array(190 * 3); for (var 밝4 = 0; 밝4 < 190; 밝4++) { var k4 = 7 - ((밝4 / 37) | 0); if (k4 < 0) k4 = 0; if (k4 > 7) k4 = 7; 표4[밝4 * 3] = 팔[k4 * 3]; 표4[밝4 * 3 + 1] = 팔[k4 * 3 + 1]; 표4[밝4 * 3 + 2] = 팔[k4 * 3 + 2]; } 어둡게표[표키4] = 표4; }
    if (어둡게GPU(ctx, px0, py0, pw, ph, 표4, '사각|' + pw + 'x' + ph, function () { return 어GPU마스크(null, 0, 0, 1, 1, pw, ph); })) return true;
  }
  var im = ctx.getImageData(px0, py0, pw, ph), px = im.data;
  for (var i = 0; i < px.length; i += 4) {
    /* ★ 6비트로 낮춰 잰다 — 원본 팔레트가 0~63 이다 */
    var 밝기 = (px[i] >> 2) + (px[i + 1] >> 2) + (px[i + 2] >> 2);
    var idx = 7 - ((밝기 / 37) | 0);                     /* 0x1880D · 0x187C3 본문 */
    if (idx < 0) idx = 0;
    if (idx > 7) idx = 7;
    px[i] = 팔[idx * 3]; px[i + 1] = 팔[idx * 3 + 1]; px[i + 2] = 팔[idx * 3 + 2];
    px[i + 3] = 255;
  }
  ctx.putImageData(im, px0, py0);
  return true;
}

/**
 * ★★★★★ **구입 · 매각 확인 화면의 좌표** — `PACK 0x1B3E5`~`0x1B4CD` (§NN-11)
 *
 *   대사창(261 × 94)이 **아니다** — 화면 폭 전체를 쓰는 **전용 화면**이다.
 *
 *   ```asm
 *   0x1B3E5  edx = 0x22(34) ; ebx = 0x13F(319) ; ecx = 0xA0(160) ; eax = 0
 *   0x1B3FA  call 0x18899                     ; ★ (0,34)~(319,160) 을 **어둡게** — 그림이 아니다(0x187C3)
 *
 *   0x1B3FF  strlen(이름)                     ;   조합형이라 **바이트 수**다
 *   0x1B40D  shl ecx, 3                       ;   × 8  (한글 1자 = 2바이트 = 16 px)
 *   0x1B411  eax = 0x8C(140) − 그것            ; ★★ 이름 X — **오른쪽 끝이 140**
 *   0x1B418  push 0x28(40)                    ; ★★ 이름 Y = **40**
 *
 *   0x1B44E  shl ecx, 2                       ;   가격 길이 × 4
 *   0x1B452  eax = 0xDC(220) − 그것            ; ★★ 가격 X — **220 이 가운데**
 *   0x1B459  push 0x28(40)                    ; ★★ 가격 Y = 40
 *
 *   0x1B47C  ebx = 0xD2(210)                  ; ★ 「예」 박스 x2
 *   0x1B48C  ecx = 0x97(151)                  ; ★           y2
 *   0x1B492  eax = 0xA1(161) ; edx = 0x86(134) ; call 0x1843D   ; ★ 「예」 **박스**
 *   0x1B4B7  ebx = 0x10B(267)                 ; ★ 「아니요」 x2
 *   0x1B4A1  eax = 0xD8(216) ; edx = 0x86(134) ; call 0x1843D   ; ★ 「아니요」 박스
 *
 *   ⇒ 「예」 **(161,134)~(210,151)** · 「아니요」 **(216,134)~(267,151)**
 *   ★★ 클릭 영역(§HH)이 `x 162~209` · `y 135~150` 이니 **박스 안쪽 1 px** 이다 —
 *     원본이 `jle`/`jge` 로 걸러서 테두리를 뺀 셈이다. 완전히 맞물린다.
 *
 *   0x1B4C1  push 0x11CC ; push 0x88(136) ; push 0x32(50)       ; ★★ 물음 줄 **(50, 136)**
 *   ```
 *
 *   ★ 우리가 가운데 정렬로 낸 X 52 와 원본 **50** 이 거의 같았다 — 이제 원본 값을 쓴다.
 *   ★★ 박스 좌표와 **클릭 경계가 같은 상수**다 — `0x1B492 eax = 0xA1`(박스)과
 *     `0x1B51A cmp esi, 0xA1`(클릭)이 같은 `0xA1` 이다. 클릭은 `jle` 로 걸러서
 *     **실제 통과가 162 부터**일 뿐이다(§HH).
 *   ★ 사용자가 보낸 원작 화면에는 **인물 초상 · 능력치 · 소지금**이 함께 있다.
 *   ★★★ **2026-08-29 — `0x37A56` 머리를 읽었다.**
 *     ```asm
 *     0x37A5F  edx = eax · dec edx
 *     0x37A67  eax = ebx << 5 = ×32 · add ebx → ×33 · add eax,eax → ★ **×66**
 *     0x37A6E  al = [eax + 0xF10CC]            ; ★ **66바이트 레코드 표**
 *     0x37A7C  cmp eax, 0x80
 *     ```
 *     ★ **66 은 `ITEM.DAT` 의 레코드 크기다**(`itemdat.js` — 8184B ÷ 66 = 124개).
 *     ✅ **정정 (2026-08-31)** — `0xF10CC` 는 표의 **바탕이 아니다.**
 *       바탕은 **`0xF10A4`**(참조 13곳) — `+0` 종류 · `+1` 한글 이름 ·
 *       `+16` 영문 이름 · `+37` 손 개수 · `+38` 가격.
 *       그러므로 `0xF10CC` 는 레코드의 **`+40`** 이다.
 *       ★ `+40` 은 **부호 있는 보정값**이다 — `0x37A7C cmp eax, 0x80 / jl` 뒤에
 *         `0x100 − 값` 을 `neg` 해 음수로 만든다.
 *       ★ 124개 중 **123개가 0** 이고 `[111] Strength Ring`(종류 7)만 **+30** 이다.
 *         ⇒ 「장신구가 더하는 보정」으로 읽힌다.
 *       · 같은 칸을 `0x37793` · `0x37DF1` · `0x37EAC` 도 읽는다(넷 곳).
 *     ☠ 주소 주의 — 코드에 박힌 값은 `0xA10CC` 이고 적용본에서 **`0xF10CC`**(+0x70000)다.
 *     ★ 그 자리는 전부 `00` — **BSS** 라 내용은 실행 중에 채워진다(확정).
 *   ★ 「`0x37A7C` 이후를 보면 초상·능력치 좌표가 나온다」는 **틀렸다** (2026-09-02)
 *     그 대역은 함수 `0x37A56`(부르는 자리 `0x1B481`·`0x1B8E8`) 안이고,
 *     `0xF10CE` 등을 읽어 **보정값을 부호 있는 값으로 고치는** 일만 한다
 *     (`0x37AE9 cmp eax,0x80` → `0x100 − 값` 을 `neg`). **좌표가 없다.**
 *   ★ 초상·능력치·소지금의 좌표는 **상점이 아니라 스테이터스 화면**(`0x32315`) 것이다 —
 *     마을 T6 의 완료 조건 밖이라 여기서 다루지 않는다.
 */
var 상점화면 = {
  영역: { x1: 0, y1: 34, x2: 319, y2: 160 },   /* 0x1B3E5 */
  이름: { 오른끝: 140, y: 40, 배수: 8 },        /* 0x1B411 · 0x1B418 */
  가격: { 가운데: 220, y: 40, 배수: 4 },        /* 0x1B452 · 0x1B459 */
  물음: { x: 50, y: 136 },                      /* 0x1B4CB · 0x1B4C6 */
  /* ★★★ 박스는 **네 좌표**를 다 준다 — `0x1843D(eax=x1, edx=y1, ebx=x2, ecx=y2)` */
  예박스: { x: 161, y: 134, x2: 210, y2: 151 },       /* 0x1B492 · 0x1B47C · 0x1B48C */
  아니요박스: { x: 216, y: 134, x2: 267, y2: 151 },   /* 0x1B4A1 · 0x1B4B7 */
  박스색: 2                                            /* [0x53D09] */
};

/** 조합형 **바이트 수** — 한글 1자가 2바이트다 (원본 `strlen`) */
function 바이트수(글) {
  var n = 0, s = String(글 || '');
  for (var i = 0; i < s.length; i++) n += (s.charCodeAt(i) > 0x7F) ? 2 : 1;
  return n;
}

/** 이름 X — `140 − 바이트수 × 8` (`0x1B411`) */
function 이름X(이름) { return 상점화면.이름.오른끝 - 바이트수(이름) * 상점화면.이름.배수; }

/** 가격 X — `220 − 바이트수 × 4` (`0x1B452`) */
function 가격X(글) { return 상점화면.가격.가운데 - 바이트수(글) * 상점화면.가격.배수; }

/**
 * ★★★★★ **대사창 글자 배치와 타이핑** — `PACK 0x2708B` (§NN-1 · §NN-12)
 *
 *   사용자가 말한 그대로다.
 *
 *   > 「npc 대화는 기본적으로 **타이핑처럼** 나타나는데, **좌클릭시 빠르게** 나와.
 *   >  **한번에 나오지는 않고** 타이핑 속도가 빨라지는 것처럼 작동해.」
 *   > 「좌클릭대신 **컨트롤키도 같은 동작**을 해. 대사 창이 넘어갈때, **누르지 않으면
 *   >  다음 창으로 넘어가지 않아.**」
 *
 * ── 창 (0x2716E ~ 0x2719B) ──────────────────────────────────────────────
 *   ```asm
 *   0x2716E  ebx = 0x9ABD ; edx = 0 ; call 0x24DA5   ; esi = edi = **창 Y**
 *   0x2717C  edx = esi + 9 ; eax = 0x24(36) ; call 0x186DC   ; 어둡게 (36, Y+9)
 *   0x27189  eax = 0x1E(30) ; ebx = 0x8CF4 ; edx = esi ; call 0x2B240  ; 창 그림
 *   0x2721A  edi += 0x3F(63)                          ; ★ **글자 기준선**
 *   0x27222  [esp+0x88] = 0x37(55)                    ; ★ **글자 시작 X**
 *   ```
 *
 * ── 네 줄 (`ecx = 기준 − 0x30 / 0x20 / 0x10 / 0`) ────────────────────────
 *   | 줄 | 코드 | Y |
 *   |---|---|---|
 *   | 1 | `0x27421 sub ecx, 0x30` | 창Y + **15** |
 *   | 2 | `0x275BD sub ecx, 0x20` | 창Y + **31** |
 *   | 3 | `0x27755 sub ecx, 0x10` | 창Y + **47** |
 *   | 4 | (빼지 않는다)            | 창Y + **63** |
 *
 *   ★ **첫 줄은 NPC 이름**이다(`0x27367`) — `edx = 0x1000`(강조색)으로,
 *     X 는 `55 + 8` = **63**. 대사는 **둘째 줄부터** 시작한다.
 *     사용자 스크린샷과 정확히 맞는다(「마을 청년」이 첫 줄).
 *
 * ── 줄 나누기 — **26바이트 고정** (`0x2754C add [esp+0x84], 0x1A`) ───────
 *   낱말 단위가 **아니다.** 26바이트를 채우면 그냥 다음 줄이다.
 *   ✔ 스크린샷의 「서부클립스지방의 요충지이」 = 조합형 13자 = **정확히 26바이트**.
 *   한 글자 폭 — 1바이트 **8** px(`0x2745D`) · 한글 2바이트 **16** px(`0x274A0`).
 *   `'@'`(0x40)를 만나면 거기서 끝난다(`0x27599 edx = 0x40`).
 *
 * ── ★★★ 타이핑 속도 (`0x274ED` ~ `0x2752B`) ─────────────────────────────
 *   ```asm
 *   0x274DC  call 0x2B470                ; 화면 갱신 — **한 글자마다**
 *   0x274E1  call 0x19924                ; 마우스 읽기
 *   0x274ED  cmp [0x2CF20], 1            ; ★ 왼쪽 버튼
 *   0x274F6  cmp [0x150168], 0           ; ★ **Ctrl 자리로 보인다** — 같은 갈래다
 *   0x274FF  cmp [0x10BA22], 1           ;   「이미 소비된 누름」 빗장
 *   0x27508  call 0x2B206 × 3            ; ★★ 수직귀선(0x3DA) **3 프레임 대기**
 *   0x27529  [0x10BA22] = 0              ;   둘 다 떼면 빗장을 푼다
 *   ```
 *
 *   ⇒ 기본은 **한 글자마다 3 프레임**. 누르고 있으면 **0 프레임**(딜레이만 건너뛴다 —
 *     한 번에 다 나오지 **않는다**). 사용자 말과 정확히 같다.
 *   ⇒ ★ 빗장 `[0x10BA22]` 때문에 **누른 채로 창이 뜨면 그 누름은 안 먹는다.**
 *     한 번 떼었다가 다시 눌러야 빨라진다. (`towninput` 이 쓰는 그 변수다)
 *
 * ★★★ **2026-08-29 — 전수로 보니 정적으로는 못 가른다.**
 *   `[0x150168]` 참조 **43곳** 중 **38곳**이 `cmp dword [0x150168], 1` 이고
 *   (`83 3d 68 01 1a 00` 바이트 전수) **쓰는 명령은 하나도 없다**
 *   (`a1`·`c7 05`·`89 /r` 전수 0곳). 곧 **인터럽트 핸들러가 세우는 값**이다.
 *   `0x13252` 는 그것을 `[0x10BA22]`(한 프레임에 하나)와 **함께** 본다.
 *   ⇒ Ctrl 인지는 **원본을 돌려서** 확인해야 한다(§A● 6번 js-dos 대조).
 *     사용자가 「Ctrl 도 된다」고 했고 이 자리가 왼쪽 버튼과 한 갈래라 그렇게 둔다.
 */
var 대사배치 = {
  줄바이트: 0x1A,            /* 0x2754C — 26바이트 고정 */
  시작X: 0x37,               /* 0x27222 — 55 */
  이름X더하기: 8,            /* 0x273A4 — 이름만 8 px 안쪽 */
  기준더하기: 0x3F,          /* 0x2721A — 창Y + 63 */
  줄빼기: [0x30, 0x20, 0x10, 0],   /* 0x27421 · 0x275BD · 0x27755 · (없음) */
  한바이트폭: 8,             /* 0x2745D */
  두바이트폭: 16,            /* 0x274A0 */
  끝글자: 0x40,              /* 0x27599 — '@' */
  느린대기: 3,               /* 0x27508 — 수직귀선 3회 */
  빠른대기: 0
};

/** 줄 번호(0~3) 의 Y — `창Y + 63 − 줄빼기[줄]` */
function 대사줄Y(창Y, 줄) {
  var b = 대사배치.줄빼기[줄 | 0];
  if (b == null) return null;
  return (창Y | 0) + 대사배치.기준더하기 - b;
}

/**
 * ★★★ **대사를 26바이트 줄로 자른다** — `0x2754C`
 *
 *   낱말을 살피지 않는다. 조합형 한글은 2바이트라 **한 글자가 쪼개지지 않게** 만
 *   지킨다(원본은 26바이트 창을 통째로 읽고 `0x24D5C` 로 한 자씩 앞에서부터 읽어
 *   나가므로, 26번째 바이트에서 한글이 시작하면 그 글자는 다음 줄로 밀린다).
 *
 * @param {string} 글
 * @returns {string[]} 줄들 — `'@'` 를 만나면 거기서 멈춘다
 */
function 대사줄나누기(글) {   /* ★ 대비책 — 원본 줄나누기는 `talktbl.채우기` 다 */
  var s = String(글 == null ? '' : 글);
  var 줄들 = [], 이번 = '', 폭 = 0;
  for (var i = 0; i < s.length; i++) {
    var ch = s.charAt(i);
    if (ch.charCodeAt(0) === 대사배치.끝글자) break;      /* '@' */
    var b = (ch.charCodeAt(0) > 0x7F) ? 2 : 1;
    if (폭 + b > 대사배치.줄바이트) { 줄들.push(이번); 이번 = ''; 폭 = 0; }
    이번 += ch; 폭 += b;
  }
  if (이번 !== '') 줄들.push(이번);
  return 줄들;
}

/**
 * ★★★★★ **대사창 한 판의 배치** — 이름 한 줄 + 대사 세 줄
 *
 * @param {string} 이름   NPC 이름 (`0x1397C` 버퍼)
 * @param {string|Array} 글  대사 — **`talktbl.채우기` 가 준 줄 배열**이 원본이다.
 *                        문자열을 주면 `대사줄나누기` 로 26바이트씩 자른다(대비책).
 * @param {number} 창Y    `창자리()` 가 준 Y
 * @returns {{창:{x,y}, 어둡게:{x,y}, 줄들:Array}}
 *   `줄들[i]` — `{글, x, y, 강조}` · `강조` 는 이름 줄만 참(`edx = 0x1000`)
 */
function 대사판(이름, 글, 창Y, 쪽) {
  var Y = 창Y | 0;
  var 줄들 = [];
  /* ★★★★★ **이름은 대사 한 덩어리에 딱 한 번** — `PACK 0x2708B` (2026-09-08)
   *
   *   > 사장님 지적: 「이어지는 대사에는 **이름이 없고 내용이 들어와야** 하는데,
   *   >  지금은 이름이 표시되면서 뒤로 밀려.」
   *
   *   ☠ 여태 **쪽마다** 이름을 넣었다. 원본은 빗장을 하나 두고 한 번만 그린다 —
   *   ```asm
   *   0x270A6  mov ah, 1
   *   0x270C6  mov byte [esp+0xa4], ah   ; ★ 함수에 들어올 때 1
   *   0x2735E  cmp bh, byte [esp+0xa4]   ; bh = 1
   *   0x27365  jne 0x273df               ; ★ 0 이면 이름을 건너뛰고 대사 줄로
   *   0x27367  ...이름 그리기 (edx=0x1000 강조색 · x = 55+8)...
   *   0x273D3  mov byte [esp+0xa4], ch   ; ch = 0 → ★★ 한 번 그리면 끈다
   *   ```
   *   끄는 자리는 `0x273D3` 하나뿐이고 켜는 자리는 함수 머리 `0x270C6` 뿐이다 —
   *   곧 **함수를 다시 부를 때(새 대사)만** 켜진다.
   *   같은 빗장을 `0x27142`·`0x2723A`(배경 지우기)도 본다 — 곧 **첫 창인가**다.
   *   ⇒ **첫 창만 이름 1줄 + 대사 3줄, 이어지는 창은 대사 4줄.** */
  var 첫쪽 = !(쪽 | 0);
  if (첫쪽) {
    /* [리마스터 이름가운데] 이름 줄의 앞뒤 공백을 그릴 때만 뺀다 — 전투 대화·상태창과 같은 토글 · '원작' 이면 원본 그대로
     *   (2026-10-10 사장님 「대화할때 포트레이트에도 동일하게 적용되어야해」) · 마을·월드 이름 줄은 원본도 왼쪽 맞춤(x = 55+8)이라 앞 공백만큼 들여졌다 */
    var _이름글 = String(이름 == null ? '' : 이름);
    try { var _O이 = root.Opt || root.G2Opt; if (_O이 && _O이.cfg && _O이.cfg['이름가운데'] === '리마스터') _이름글 = _이름글.replace(/^\s+|\s+$/g, ''); } catch (e이) {}
    줄들.push({ 글: _이름글,
                x: 대사배치.시작X + 대사배치.이름X더하기,
                y: 대사줄Y(Y, 0), 강조: true });
  }
  /* ★ `talk.tbl` 이 이미 26바이트 줄로 나눠 준다(`talktbl.채우기`) — 배열이면 그대로 */
  var 본문 = (글 && 글.length != null && typeof 글 !== 'string') ? 글 : 대사줄나누기(글);
  var 담을수 = 대사배치.줄빼기.length - (첫쪽 ? 1 : 0);      /* 첫 쪽 3 · 그 뒤 4 */
  for (var i = 0; i < 본문.length && i < 담을수; i++) {
    줄들.push({ 글: 본문[i], x: 대사배치.시작X,
                y: 대사줄Y(Y, i + (첫쪽 ? 1 : 0)), 강조: false });
  }
  return { 창: { x: 창X, y: Y },
           어둡게: { x: 어둡게X, y: Y + 어둡게Y더하기 },
           줄들: 줄들, 남은줄: 본문.slice(담을수) };
}

/**
 * ★★★ **한 글자를 더 낼 때까지 기다릴 프레임 수** — `0x274ED`
 *
 * @param {{왼쪽:boolean, Ctrl:boolean}} 입력
 * @param {boolean} 빗장  `[0x10BA22]` — 「이 누름은 이미 소비됐다」
 * @returns {{대기:number, 빗장:boolean}}
 */
function 타이핑대기(입력, 빗장) {
  var 눌림 = !!(입력 && (입력.왼쪽 || 입력.Ctrl));
  var b = !!빗장;
  /* 0x274ED — 눌렸고 빗장이 풀렸으면 딜레이를 건너뛴다 */
  var 대기 = (눌림 && !b) ? 대사배치.빠른대기 : 대사배치.느린대기;
  /* 0x27529 — 둘 다 떼면 빗장을 푼다 */
  if (!눌림) b = false;
  return { 대기: 대기, 빗장: b };
}

/** ★ 한 창에 들어가는 **대사 줄 수** — **첫 창만** 이름이 한 줄을 차지한다
 *
 *   `PACK 0x273D3` 이 이름 빗장 `[esp+0xa4]` 를 한 번 그리고 끄므로,
 *   **첫 창 3줄 · 이어지는 창 4줄**이다 (`0x2708B` · 2026-09-08).
 */
var 첫쪽줄 = 대사배치.줄빼기.length - 1;    /* 3 — 이름이 한 줄을 먹는다 */
var 다음쪽줄 = 대사배치.줄빼기.length;      /* 4 — 이름이 없다 */
/** 옛 이름 — 첫 쪽 기준이다. 새 코드는 `첫쪽줄`·`다음쪽줄` 을 쓴다 */
var 쪽당줄 = 첫쪽줄;

/** 줄 하나의 **글자 수** — 한글 2바이트가 한 글자다 (`0x274A3`) */
function 글자수(줄) {
  if (줄 == null) return 0;
  if (typeof 줄 === 'string') return 줄.length;
  var n = 0, i = 0;
  while (i < 줄.length) { if (!줄[i]) break; i += (줄[i] >> 7) === 1 ? 2 : 1; n++; }
  return n;
}

/** `쪽` 번째 창이 맡는 줄들 — 첫 쪽 3줄 · 그 뒤 4줄 (`0x273D3`) */
function 쪽줄들(모든줄, 쪽) {
  var k = 쪽 | 0;
  var 시작 = (k === 0) ? 0 : 첫쪽줄 + (k - 1) * 다음쪽줄;
  return (모든줄 || []).slice(시작, 시작 + (k === 0 ? 첫쪽줄 : 다음쪽줄));
}

/** 창이 몇 쪽인가 — 첫 쪽 3줄 · 그 뒤 4줄 (`0x273D3`) */
function 쪽수(모든줄) {
  var n = (모든줄 || []).length;
  if (n <= 첫쪽줄) return 1;
  return 1 + Math.ceil((n - 첫쪽줄) / 다음쪽줄);
}

/**
 * ★★★★★ **대사창 한 프레임** — `PACK 0x27332`(타이핑) · `0x27A25`(창 넘김)
 *
 *   원본은 **한 글자를 낼 때마다 화면을 갱신**하고(`0x274DC`), 그 사이에
 *   수직귀선을 3번 기다린다(`0x27508`). 누르고 있으면 그 대기를 건너뛴다.
 *
 *   창을 다 채우면 **빗장을 걸고**(`0x27A1F [0x10BA22] = 1`) 기다린다.
 *   ★ 누른 채로는 안 넘어간다 — `0x27A6B` 가 빗장을 보고 다시 기다린다.
 *     **한 번 떼었다 다시 눌러야** 다음 창으로 간다(`0x27A51` 이 빗장을 푼다).
 *   사용자: 「대사 창이 넘어갈때, 누르지 않으면 다음 창으로 넘어가지 않아.」
 *
 * @param {object} 대사  `screens.js` 가 만든 상태 — 이 자리에서 **고쳐 쓴다**
 * @param {{왼쪽:boolean, Ctrl:boolean}} 입력
 * @returns {object} 같은 대사 상태 (끝났으면 `끝났나 = true`)
 */
function 대사진행(대사, 입력) {
  if (!대사 || 대사.끝났나) return 대사;
  var 눌림 = !!(입력 && (입력.왼쪽 || 입력.Ctrl));
  var 줄들 = 쪽줄들(대사.모든줄, 대사.쪽);
  var 이쪽글자 = 0;
  for (var i = 0; i < 줄들.length; i++) 이쪽글자 += 글자수(줄들[i]);

  /* ── ★★★ 선택지 창이 떠 있다 — `0x256CD` 의 대기 루프 (`0x25B2F`~`0x25D94`)
   *   원본은 **왼쪽 버튼이 눌린 그 순간** 커서가 얹힌 줄을 고른다.
   *   줄 밖이면 아무 일도 없이 계속 돈다(`0x25D8E ja 0x25B2F`). */
  if (대사.선택지대기) {
    /* ★★★ **선택지만 「눌린 사건」이다** — `0x25D80` 은 큐에서 꺼낸 사건을 본다
     *   (타이핑 가속·창 넘기기는 **상태**다 — `0x274ED`·`0x27A62`).
     *   ☠ 여기에 상태를 쓰면 누르고 있는 동안 **줄이 계속 다시 골라진다.**
     *   ★ `에지` 가 없으면(옛 호출부·시험) 예전처럼 `왼쪽` 을 본다. */
    var 사건 = (입력 && 입력.에지 !== undefined) ? !!입력.에지 : !!(입력 && 입력.왼쪽);
    if (!사건) return 대사;                                /* 0x25D80 cmp [0x7CF20],1 */
    var 고른줄 = 선택지고르기(선택지자리(!!대사.창위쪽), (입력 && 입력.마우스) || null);
    if (!고른줄) return 대사;                              /* 0x25C3F esi = 0 */
    대사.고른것 = 고른줄;                                  /* 0x25D94 → eax = 1~4 */
    대사.선택지대기 = false;
    대사.끝났나 = true;
    return 대사;
  }

  /* ── 이 창을 다 냈다 — 다음 창을 기다린다 (0x27A25) ────────────────── */
  if ((대사.낸글자 | 0) >= 이쪽글자) {
    if (!눌림) { 대사.빗장 = false; return 대사; }        /* 0x27A51 */
    if (대사.빗장) return 대사;                            /* 0x27A72 — 아직 안 먹는다 */
    대사.쪽 = (대사.쪽 | 0) + 1;
    대사.낸글자 = 0;
    대사.기다림 = 0;
    대사.빗장 = true;                                      /* 0x27A1F */
    if (대사.쪽 >= 쪽수(대사.모든줄)) {
      /* ★★★ 마지막 창을 넘겼다 — `@` 가 있었으면 **선택지 창**이 뜬다
       *   (`0x27A74 cmp byte [esp+0xa0],1` → `0x27AC6 call 0x256CD`). */
      if (대사.선택지 && 대사.선택지.length) 대사.선택지대기 = true;
      else 대사.끝났나 = true;
    }
    return 대사;
  }

  /* ── 아직 내는 중 (0x27332) ──────────────────────────────────────── */
  if ((대사.기다림 | 0) > 0) { 대사.기다림 = (대사.기다림 | 0) - 1; return 대사; }
  대사.낸글자 = (대사.낸글자 | 0) + 1;
  var r = 타이핑대기(입력, 대사.빗장);
  대사.기다림 = r.대기;
  대사.빗장 = r.빗장;
  if ((대사.낸글자 | 0) >= 이쪽글자) 대사.빗장 = true;     /* 0x27A1F — 다 내면 빗장 */
  return 대사;
}

/** 지금 창의 글자를 다 냈나 */
function 이쪽다냈나(대사) {
  if (!대사) return false;
  var 줄들 = 쪽줄들(대사.모든줄, 대사.쪽), n = 0;
  for (var i = 0; i < 줄들.length; i++) n += 글자수(줄들[i]);
  return (대사.낸글자 | 0) >= n;
}

/**
 * [리마스터 편의] 이벤트 자동 진행·빨리감기 (2026-10-07 · opt.js 이벤트자동·빨리감기)
 *   사장님(원문) 「마을 이벤트나 sce 이벤트를 빠르게 자동으로 진행해주거나(auto), 스킵하는 기능이 추가되면 좋겠어.」
 *   손 입력 대신 `대사진행` 에 넣을 입력을 만든다 — 규칙(타이핑 가속 0x274ED · 창 넘김 빗장 0x27A51)은 그대로 탄다.
 *   · '빨리' — 한 프레임 누르고 한 프레임 떼기를 되풀이한다 (Ctrl = 원본 «좌클릭 대신»)
 *   · '자동' — 이 창을 다 낸 뒤 `자동ms` 가 지나면 한 프레임 누른다
 *   · 선택지 창은 손으로 고른다 · 손이 누르고 있으면 손을 따른다
 * @param 지금ms 벽시계 (읽는 시간은 배속과 무관하게 잰다)
 */
function 자동입력(대사, 입력, 모드, 지금ms, 자동ms) {
  입력 = 입력 || {};
  if (!대사 || !모드 || 대사.선택지대기 || 입력.왼쪽 || 입력.Ctrl) {
    if (대사) { 대사._자동번갈 = 0; 대사._자동다낸때 = null; }
    return 입력;
  }
  var 새 = {};
  for (var k in 입력) if (Object.prototype.hasOwnProperty.call(입력, k)) 새[k] = 입력[k];
  if (모드 === '빨리') {
    대사._자동번갈 = (대사._자동번갈 | 0) ? 0 : 1;
    새.Ctrl = !!대사._자동번갈;
    return 새;
  }
  if (!이쪽다냈나(대사)) { 대사._자동다낸때 = null; return 입력; }
  if (대사._자동다낸때 == null) { 대사._자동다낸때 = 지금ms; return 입력; }
  if (지금ms - 대사._자동다낸때 >= (자동ms == null ? 1500 : 자동ms)) {
    대사._자동다낸때 = null;
    새.Ctrl = true;
  }
  return 새;
}

/**
 * ★★★ **지금 그릴 것** — 이름 한 줄 + 대사 세 줄, 낸 만큼만 자른다.
 * @returns {{창:{x,y}, 어둡게:{x,y}, 줄들:Array}}
 */
function 대사그릴것(대사) {
  if (!대사) return null;
  var 판 = 대사판(대사.이름, 쪽줄들(대사.모든줄, 대사.쪽), 대사.창Y | 0, 대사.쪽 | 0);
  /* 이름은 늘 다 보인다(0x27367 이 먼저 그린다). 대사만 낸 만큼 자른다.
   * ★ 이름 줄이 없는 쪽(둘째 창부터)은 **0번 줄부터** 대사다 (`0x273D3`) */
  var 남 = 대사.낸글자 | 0;
  for (var i = ((대사.쪽 | 0) ? 0 : 1); i < 판.줄들.length; i++) {
    var 줄 = 판.줄들[i].글;
    var n = 글자수(줄);
    if (남 >= n) { 남 -= n; continue; }
    판.줄들[i] = { 글: 자르기글자(줄, 남), x: 판.줄들[i].x, y: 판.줄들[i].y, 강조: false };
    남 = 0;
  }
  return 판;
}

/** 앞에서 `n` **글자**만 남긴다 — 한글 2바이트를 쪼개지 않는다 */
function 자르기글자(줄, n) {
  if (줄 == null) return 줄;
  if (typeof 줄 === 'string') return 줄.slice(0, n);
  var i = 0, c = 0;
  while (i < 줄.length && c < n) { if (!줄[i]) break; i += (줄[i] >> 7) === 1 ? 2 : 1; c++; }
  return 줄.subarray ? 줄.subarray(0, i) : 줄.slice(0, i);
}

/**
 * ★★★★★ **작은 8×8 글꼴** — `PACK 0x526FC` (`0x1813C` 가 쓴다 · 2026-09-02)
 *
 *   ```asm
 *   0x1813C  88 04 24         mov [esp], al        ; 글자
 *   0x1814C  80 ea **20**     sub dl, 0x20         ; ★ ASCII **32** 부터
 *   0x1816F  8a 9c c2 fc 26 05 00                  ; ★★ mov bl, [edx***8** + eax + **0x526FC**]
 *                                                  ;    edx = 글자−32 · eax = 줄(0~7)
 *   ```
 *   ⇒ 한 글자가 **8 바이트**이고 바이트마다 한 줄의 **8 비트**다(1bpp · 왼쪽이 MSB).
 *
 *   ★ 실측으로 확인했다 — `'A'` 와 `'I'` 가 제대로 그려진다.
 *   ☠ 우리 `G2Native.drawText` 는 ASCII 를 **8×16** 으로 그린다(`NEWASCII.FNT`).
 *     매각 목록의 영문 이름은 **이 8×8** 이라야 줄이 안 겹친다 —
 *     한글 9~24 · 영문 25~**32** · 다음 줄 한글 33~48. 16 짜리로 그리면 겹친다.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Uint8Array} le  `window.__PACKLE` (PACK LE 이미지)
 * @param {string} 글  ASCII 만
 * @param {number} x @param {number} y
 * @param {number[]} rgb
 */
function 작은글자(ctx, le, 글, x, y, rgb) {
  if (!ctx || !le || !글) return false;
  /* ★ `__PACKLE` 은 `image`/`base`(소문자) 꾴이다 — `게임.html EXE비압축그림` 과 같게 본다.
   *   ☠ `img`/`BASE`(대문자)만 보면 엉뚱한 자리를 읽어 **세로 막대**가 난다(실측). */
  var img = le.image || le.img || le;
  var BASE = (le.base != null) ? le.base
           : (le.BASE != null ? le.BASE : 0x10000);
  var 바탕 = 0x526FC - BASE;
  if (바탕 < 0 || 바탕 >= img.length) return false;
  /* ★★★★★ **글자마다 폭이 다르다 — 비례 글꼴이다** — `PACK 0x5269C` (2026-09-04)
   *   ```asm
   *   0x181ED  mov bh, byte [eax + 0x5269C]   ; ★ 그 글자의 **폭**
   *   0x181F3  cmp dl, bh / jb 0x18167        ;   폭만큼만 비트를 훑는다
   *   ```
   *   `eax` 는 **글자 − 0x20** 이다(`0x1814C sub dl,0x20` 뒤 `[esp]` 에 남는 값).
   *   실측 — `I` = 2 · `1` = 3 · 나머지 영문/숫자는 대개 6.
   *   ☠ 8 고정으로 그렸더니 능력치 박스(폭 20)에 `STR`(24)이 **넘쳤다**(화면 실측). */
  var 폭표 = 0x5269C - BASE;
  var 폭있나 = (폭표 >= 0 && 폭표 + 96 < img.length);
  var c = 'rgb(' + ((rgb && rgb[0]) | 0) + ',' + ((rgb && rgb[1]) | 0) + ',' + ((rgb && rgb[2]) | 0) + ')';
  var N = root.G2Native;
  var 필터 = !!(N && N.필터글자쓸까 && N.필터글자 && N.필터글자쓸까(ctx));
  ctx.save();
  ctx.fillStyle = c;
  for (var i = 0; i < 글.length; i++) {
    var code = 글.charCodeAt(i);
    if (code < 32 || code > 127) { x += 8; continue; }
    var o = 바탕 + (code - 32) * 8;                    /* 0x1814C · 0x1816F */
    var 폭 = 폭있나 ? (img[폭표 + (code - 32)] | 0) : 8;   /* 0x181ED */
    if (폭 <= 0 || 폭 > 8) 폭 = 8;
    /* ★ Z-44 (2026-09-24 · 「글자에도 적용」) — N배로 그려지는 캔버스면 글자 하나를 필터로 키워 그린다.
     *   폭이 글자마다 달라 캐시 키에 폭을 넣는다. 자리·전진폭은 그대로. */
    if (필터 && rgb) {
      var 칸 = o;
      ctx.drawImage(N.필터글자('P8:' + 폭 + ':', code, function (bx, by) {
        return ((img[칸 + by] | 0) >> (7 - bx)) & 1;
      }, 폭, 8, [rgb[0] | 0, rgb[1] | 0, rgb[2] | 0]), x, y, 폭, 8);
      x += 폭;
      continue;
    }
    for (var yy = 0; yy < 8; yy++) {
      var b = img[o + yy] | 0;
      for (var xx = 0; xx < 폭; xx++)                  /* 0x181F3 cmp dl, bh */
        if ((b >> (7 - xx)) & 1) ctx.fillRect(x + xx, y + yy, 1, 1);
    }
    x += 폭;
  }
  ctx.restore();
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 *  ★★★★★ **선택지 대사창** — `PACK 0x2708B` → `0x256CD` (2026-09-03 확정)
 *
 *  대사 줄에 **`@`** 가 있으면 그 줄은 **그리지 않고** 「선택지 모드」로 넘어간다.
 *  창을 다 넘긴 뒤 **선택지 창**이 뜨고, 고른 **줄 번호 1~4** 가 `.TEC` 조건 ②
 *  (`[0x1A00CA]`)로 들어간다.
 *
 *  ```asm
 *  ; ── 0x2708B — 줄마다 '@' 를 찾는다 (네 슬롯 모두 같은 꼴) ───────────
 *  0x273DF  26바이트(0x1A) 한 줄을 [0x196C14+오프셋] 에서 지역버퍼로 복사
 *  0x27402  call 0x3B251            ; ★ strrchr(줄, 0x40='@')
 *  0x2740B  mov byte [esp+0xa0], 1  ; ★ 있으면 **선택지 모드**로 표시하고 그 줄은 건너뛴다
 *      (같은 꼴 네 곳 — 0x2740B · 0x275A7 · 0x2773F · 0x278D7)
 *  0x27A74  cmp byte [esp+0xa0], 1 / 0x27A7C jne 0x27ACD   ; 아니면 반환 0
 *  0x27AC6  call 0x256CD            ; ★ 선택지 창 — 그 반환값이 op11 의 반환값
 *
 *  ; ── 0x256CD — 네 칸을 갈라 그린다 ────────────────────────────────
 *  0x2592C  '[' 을 만날 때까지 건너뛰고 → ']' 까지를 한 칸으로 담는다  (네 번)
 *  0x25961  글자 y = Y − 0x30   ; 0x259B2  Y − 0x20
 *  0x25A06          Y − 0x10   ; 0x25A59  Y
 *  0x25839 / 0x2591E  글자 x = **0x37 (55)**
 *  0x25B13  ebp = x + **0xD0 (208)**        ; 가로 띠 끝 = 55+208 = 263
 *
 *  ; ── 창 Y — 대사창 자리에서 나온다 ───────────────────────────────
 *  0x25774  call 0x24DA5(edx=0)  ; 말하는 이 레코드 Y < 100 → 창이 **아래**(105)
 *  0x2582F  add eax, 0x3F        ;   ⇒ 선택지 Y = 105 + 63 = **168**
 *  0x2587B  call 0x24DA5(edx=1)  ; 레코드 Y ≥ 100 → 창이 **위**(80)
 *  0x2591B  sub eax, 0x10        ;   ⇒ 선택지 Y = 80 − 16 = **64**
 *
 *  ; ── 어느 줄을 눌렀나 — [0x7CF24] 마우스x · [0x7CF28] 마우스y ──────
 *  0x25C38  esi = 1  (y ∈ [Y−48, Y−32])    0x25BFA  esi = 2  (y ∈ [Y−32, Y−16])
 *  0x25BB9  esi = 3  (y ∈ [Y−16, Y   ])    0x25B7B  esi = 4  (y ∈ [Y,    Y+16])
 *  0x25D80  cmp [0x7CF20], 1 / jne         ; ★ **왼쪽 버튼**일 때만
 *  0x25D94  jmp [esi*4 + 0x256BD]          ; → eax = 1 · 2 · 3 · 4
 *  ```
 *
 *  ★★★ **네 줄 모두 늘 누를 수 있다** — 개수 검사(`0x25C2E cmp …,0` 등)가 보는
 *    `[esp+0x98]` 은 `0x2572D` 에서 0 으로 놓고 **무조건 세 번**(`0x25979`·`0x259CA`·
 *    `0x25A1E`) 늘린 뒤 `0x25B04` 에서 한 번 더 늘려 **언제나 4** 다.
 *    곧 빈 칸(`[]`)을 눌러도 3·4 가 나온다 — **원본의 성질이라 그대로 옮긴다.**
 *
 *  ★ 실제 데이터 — `TALK.TBL` 에서 `@` 가 든 대사는 **1148~1157 열 개**뿐이고
 *    전부 **항해**다: 「항해를 하실려구요? `@[예] [아니오] [] []`」 ·
 *    「가고자하는 목적지를 선택하세요. `@[와이번섬] [커티스] [] []`」
 *    `.TEC` 가 조건 ②로 쓰는 값이 **1·2 뿐**인 것과 맞는다(마을 7·9·12 의 13슬롯).
 * ══════════════════════════════════════════════════════════════════════ */
var 선택지글자X = 0x37;            /* 0x25839 · 0x2591E */
var 선택지가로 = 0xD0;             /* 0x25B13 add ebp, 0xD0 */
var 선택지줄높이 = 0x10;           /* 띠 하나 16 — 0x25961 부터 0x10 씩 */
var 선택지칸수 = 4;                /* 0x25B2A mov ecx, 4 */

/** `@` 가 든 줄인가 — `0x27402 call 0x3B251`(strrchr(줄,'@')) */
function 선택지줄인가(줄) {
  if (!줄) return false;
  if (typeof 줄 === 'string') return 줄.indexOf('@') >= 0;
  for (var i = 0; i < 줄.length; i++) { if (!줄[i]) break; if (줄[i] === 0x40) return true; }
  return false;
}

/**
 * `@[가] [나] [] []` 를 **네 칸**으로 가른다 — `0x2592C`~`0x25A50`.
 * @returns {Array<Uint8Array>} 언제나 길이 4 (없는 칸은 빈 배열)
 */
function 선택지파싱(줄) {
  var b = 줄;
  if (typeof 줄 === 'string') { b = new Uint8Array(줄.length); for (var q = 0; q < 줄.length; q++) b[q] = 줄.charCodeAt(q) & 0xFF; }
  var 것 = [], i = 0;
  for (var k = 0; k < 선택지칸수; k++) {
    while (i < b.length && b[i] !== 0x5B) i++;        /* 0x2592C — '[' 까지 */
    i++;                                              /* 0x25931 inc esi */
    var 처음 = i;
    while (i < b.length && b[i] !== 0x5D) i++;        /* 0x2593C — ']' 까지 */
    것.push(b.subarray ? b.subarray(처음, Math.min(i, b.length)) : new Uint8Array(0));
    i++;
  }
  return 것;
}

/**
 * 선택지 네 줄의 **자리와 클릭 띠** — `0x25832`/`0x25925` · `0x25B44`~`0x25C3F`.
 * @param {boolean} 위쪽  `창자리().위쪽` — 대사창이 위(80)면 true
 * @returns {{Y:number, 줄들:Array<{번호,x,y,띠:{x1,y1,x2,y2}}>}}
 */
function 선택지자리(위쪽) {
  /* 창이 **위(80)** → 0x2591B sub 0x10 ⇒ 64 · 창이 **아래(105)** → 0x2582F add 0x3F ⇒ 168 */
  var Y = 위쪽 ? (위Y - 0x10) : (아래Y + 0x3F);
  var 줄들 = [];
  /* ★★★ 선택지 창도 **같은 금색 틀 `0x58CF4`** 다 — 자리만 다르다
   *   위 갈래  `0x258A0 edx = ret − 0x4F` = 80 − 79 = **1**   (= Y − 63)
   *   아래 갈래 `0x25799 edx = ecx(ret)`   = **105**          (= Y − 63)
   *   어둡게    `0x25889 ret − 0x46`(10) · `0x25782 ret + 9`(114) (= Y − 54) */
  for (var k = 0; k < 선택지칸수; k++) {
    var y = Y - (3 - k) * 선택지줄높이;               /* Y−48 · Y−32 · Y−16 · Y */
    줄들.push({ 번호: k + 1, x: 선택지글자X, y: y,
                띠: { x1: 선택지글자X, y1: y, x2: 선택지글자X + 선택지가로, y2: y + 선택지줄높이 } });
  }
  return { Y: Y, 줄들: 줄들,
           창: { x: 창X, y: Y - 63 },                 /* 0x257A8 / 0x258B0  eax = 0x1E */
           어둡게: { x: 어둡게X, y: Y - 54 } };       /* 0x2578A / 0x25891  eax = 0x24 */
}

/**
 * ★★★ 대사를 만들 때 **`@` 줄을 비우고** 선택지를 뽑아 둔다.
 *
 *   원본은 그 줄을 **그리지 않고 건너뛴다**(`0x2740B` 등이 표시만 하고 `jmp`).
 *   줄 자체는 그대로 소비되므로 **빈 줄로 남긴다** — 줄 수가 달라지면 쪽 나눔이 어긋난다.
 *
 * @param {Array} 모든줄  `TALK.TBL` 줄바이트들
 * @returns {{모든줄:Array, 선택지:Array<Uint8Array>|null}}
 */
function 선택지뽑기(모든줄) {
  var 줄들 = 모든줄 || [];
  for (var i = 0; i < 줄들.length; i++) {
    if (!선택지줄인가(줄들[i])) continue;
    /* ★ 괄호가 **다음 줄로 넘칠 수 있다** — 원본 파서는 버퍼를 줄 경계 없이
     *   이어 읽는다(`0x25A92` 가 진행 위치를 되돌려 준다). 그래서 이어 붙여 판다. */
    var 이은 = [];
    for (var k = i; k < 줄들.length; k++) {
      var u = 줄들[k];
      for (var q = 0; q < u.length; q++) { if (!u[q]) break; 이은.push(u[q]); }
    }
    var 항목 = 선택지파싱(new Uint8Array(이은));
    /* ★★★ **`@` 줄 «뒤» 줄도 안 그린다** — `0x2756D cmp [esp+0xA0],0 / jne 0x276F1` (2026-10-06)
     *   선택지 표시가 서면 그다음 줄부터 전부 건너뛴다(두·세·네째 줄 머리가 다 같은 꼴).
     *   ☠ 전에는 `@` 줄만 비워서, 괄호가 넘친 「] 」 줄(TALK 1149·1150)이 다음 창으로 따로 떴다 —
     *   사장님(원문) 「가고자하는 목적지가 제대로 안보여. 원작은 항구 이름이 나오는데 우리는 ]만 나와」 */
    var 사본 = 줄들.slice(0, i + 1);
    사본[i] = new Uint8Array(0);                    /* ★ 그 줄은 안 그린다 */
    return { 모든줄: 사본, 선택지: 항목 };
  }
  return { 모든줄: 줄들, 선택지: null };
}

/**
 * 마우스가 어느 줄 위인가 — `0x25B44`~`0x25C3F`.
 * 원본은 `jl`/`jg` 로 견주므로 **양끝을 포함**한다.
 * @returns {number} 1~4 · 아무 줄도 아니면 0 (`0x25C3F xor esi,esi`)
 */
function 선택지고르기(자리, 마우스) {
  if (!자리 || !마우스) return 0;
  var mx = 마우스.x | 0, my = 마우스.y | 0;
  for (var k = 자리.줄들.length - 1; k >= 0; k--) {   /* 원본은 4번 줄부터 본다 */
    var 띠 = 자리.줄들[k].띠;
    if (mx >= 띠.x1 && mx <= 띠.x2 && my >= 띠.y1 && my <= 띠.y2) return k + 1;
  }
  return 0;
}

var API = { 작은글자: 작은글자, 창자리: 창자리,
            선택지줄인가: 선택지줄인가, 선택지파싱: 선택지파싱, 선택지뽑기: 선택지뽑기,
            선택지자리: 선택지자리, 선택지고르기: 선택지고르기, 가운데X: 가운데X, 줄Y: 줄Y, 어둡게: 어둡게, 어둡게사각형: 어둡게사각형,
            대사배치: 대사배치, 대사줄Y: 대사줄Y, 대사줄나누기: 대사줄나누기,
            쪽당줄: 쪽당줄, 글자수: 글자수, 쪽줄들: 쪽줄들, 쪽수: 쪽수,
            대사진행: 대사진행, 대사그릴것: 대사그릴것, 자르기글자: 자르기글자,
            이쪽다냈나: 이쪽다냈나, 자동입력: 자동입력,
            대사판: 대사판, 타이핑대기: 타이핑대기,
            상점화면: 상점화면, 바이트수: 바이트수, 이름X: 이름X, 가격X: 가격X,
            상수: { 창그림: 창그림, 창X: 창X, 창폭: 창폭, 창높이: 창높이,
                    어둡게자료: 어둡게자료, 어둡게X: 어둡게X, 어둡게Y더하기: 어둡게Y더하기,
                    가름Y: 가름Y, 가름X: 가름X, 아래Y: 아래Y, 위Y: 위Y, 위창보정: 위창보정,
                    줄높이: 줄높이, 아래창2행Y: 아래창2행Y,
                    선택지글자X: 선택지글자X, 선택지가로: 선택지가로,
                    선택지줄높이: 선택지줄높이, 선택지칸수: 선택지칸수 } };
if (typeof module !== 'undefined' && module.exports) module.exports = API;
root.G2TownTalk = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
