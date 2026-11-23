/* ============================================================================
 * 창세기전 2 — 전투 화면 HUD (원본 화면 UI)
 *
 * 사양서 : 03_분석/COMBATII/전투UI_사양.md   (좌표·색·타이밍이 전부 숫자로 있습니다)
 * 자산   : 02_실행기/게임/자산/ui.json + 자산/ui/…  (04_도구/g2_export_ui.py)
 *
 * 좌표계 — 링(ring.js)과 똑같습니다.
 *   원본 **320×200 논리 화면**에 그리고, 화면에 얹을 때만 정수 배율을 곱합니다.
 *   그래야 사기 막대 x=139, 눈금 간격 8, 구체 앵커 (250,38) 이 전부 원본 픽셀로 맞습니다.
 *   (원본 프레임버퍼는 스트라이드 480 이지만 보이는 폭은 320 입니다 — 0x755DA)
 *
 * 그리는 순서 (0x45431 · 0x454D5 그대로)
 *   ① 0x44DF3  상단 사기 바 + 게이지
 *   ② 0x44EB0  하단 턴 바 + 눈금
 *   ③ 좌우 여백 지우기 (0,0)-(16,200) · (304,0)-(320,200)      ; 0x45443 / 0x4545D
 *   ④ 0x454D5  Player Phase / Waiting… / AI Phase + 구체 위젯
 *   ⑤ (덤) 정보 바 · 스테이터스 창
 *
 * 원본과 일부러 다르게 한 곳
 *   (가) 이동 가능 칸 하이라이트(0x1547F)는 **타일 팔레트 리맵**이라 HUD 캔버스가
 *        아니라 맵을 그리는 쪽에서 해야 합니다. 여기서는 뱅크 1 LUT 와 그에 해당하는
 *        RGBA(흰색 30 %)만 내주고 실제 리맵은 안 합니다.  → G2Hud.moveHighlight
 *   (나) MENUSTAT.SYB 창들을 **화면 어디에** 놓는지는 COMBATII.EXE 에 없습니다
 *        (MAIN.EXE 가 띄웁니다). 배치는 우리가 정했고 STATUS_LAYOUT 에 모아 뒀습니다.
 *
 * 쓰는 법 (고전 스크립트 · file:// 에서도 됩니다)
 *   <script src="자산/ui_assets.js"></script>   ← file:// 대비 사본 (없어도 fetch 로 됩니다)
 *   <script src="js/hud.js"></script>           →  window.G2Hud
 * ==========================================================================*/
(function (root) {
'use strict';

function 현재렌더러() {
  return root.G2BattleRuntime && root.G2BattleRuntime.렌더러
    ? root.G2BattleRuntime.렌더러() : null;
}

/* ═══════════════════════════════════════════════ 1. 원본 상수 (사양서 숫자 그대로) */

var VIEW = { w: 320, h: 200 };      // 보이는 화면 (버퍼는 480 스트라이드 — 0x755DA)
var BUFFER_W = 480;
var VIEWPORT = { x1: 16, y1: 4, x2: 304, y2: 195 };   // 맵 뷰포트
var MARGIN = { left: [0, 0, 16, 200], right: [304, 0, 16, 200] };  // 0x45443 / 0x4545D — x=0..15

/* 게임 틱 — 0x101F4 (링각도_규명.md §4) */
var TICK_HZ = 175.47;

/* ── ★ [리마스터 N-13] 사기바·턴바 확장 — FRAME.SYB 14·15 직독 실측 (2026-08-15)
 *
 *   두 프레임 다 318×4 이고, **색 0(검정) 이 아닌 열**을 전수로 뽑으면 이렇습니다:
 *     프레임14: 0~15 | 24~26 | 144~168 | 289~291 | 297~317
 *     프레임15: 0~31 | 33~37 | 163~169 | 294~317
 *   나머지는 전부 색 0 입니다. 그래서 이 덩어리들만 새 자리에 옮겨 놓고 사이를
 *   색 0 으로 채우면 **원본 그림 그대로** 넓은 화면을 채웁니다 — 늘리거나
 *   지어내는 픽셀이 하나도 없습니다.
 *
 * ★ 바 안에 구워져 있는 조각과 그 기준점 — `[소스x, 폭, 기준]`
 *
 *   기준  'L' 화면 왼쪽 끝에서 같은 거리 · 'R' 오른쪽 끝에서 같은 거리
 *         'C' 화면 가운데에서 같은 거리
 *
 *   `CX = 0` 이면 셋 다 원본 자리(`1 + 소스x`)로 떨어집니다 — 확장이 없으면
 *   예전과 픽셀 하나까지 같습니다(`화면프레임_확장.test.js` 가 확인).
 *
 *   조각의 정체 (프레임 픽셀을 직접 봐서 확정, 2026-08-15)
 *     14 |  0~15  좌 장식 캡 (창세기전 1 잔여)
 *        | 24~26  글자 `P` — 아군 쪽 표시
 *        |144~168 글자 `MORALE`
 *        |289~291 글자 `E` — 적군 쪽 표시
 *        |297~317 우 장식 캡
 *     15 |  0~31  좌 장식 캡
 *        | 33~37  눈금 트랙 왼쪽 끝 쐐기 (오른쪽 짝은 우 캡에 묻혀 있다)
 *        |163~169 가운데 마름모 장식
 *        |294~317 우 장식 캡 */
/* ★ 아래 두 줄은 위 주석의 **`FRAME.SYB` 14·15 직독 실측** 그대로다 —
 *   색 0(검정)이 아닌 열을 전수로 뽑은 구간과 한 자리도 안 틀린다
 *   (0~15 → [0,16] · 24~26 → [24,3] · 144~168 → [144,25] ·
 *    289~291 → [289,3] · 297~317 → [297,21]).
 *   `화면프레임_확장.test.js` 가 「확장이 없으면 예전과 픽셀 하나까지 같다」를 검사한다. */
var BARPART = {
  14: [[0, 16, 'L'], [24, 3, 'L'], [144, 25, 'C'], [289, 3, 'R'], [297, 21, 'R']],
  15: [[0, 32, 'L'], [33, 5, 'L'], [163,  7, 'C'],               [294, 24, 'R']]
};

/* ── 상단 사기 게이지 0x44DF3 ── */
var MORALE = {
  barFrame: 14,                    // FRAME.SYB[14] 318×4
  barAt: [1, 0],
  rows: [0, 1, 2],                 // y=3 은 안 칠합니다 (스프라이트 바탕만)
  floor: 40,                       // 사기 40 이하 → 길이 ≤ 0 → 막대가 사라집니다
  ally:  { endX: 139, colors: [0x2C, 0x29, 0x2D] },   // 0x44A16 의 6바이트 앞 3개
  enemy: { startX: 175, colors: [0x15, 0x13, 0x17] }  // 뒤 3개
};

/* ── 하단 턴 게이지 0x44EB0 ── */
var TURN = {
  barFrame: 15, barAt: [1, 196],
  left:  { frame: 16, x: 155, step: -8, y: 196 },
  right: { frame: 17, x: 173, step:  8, y: 196 },
  periodDefault: 10                // [0x74138] EXE 초기값. GAME.CFG 7번째 바이트가 7 로 덮습니다
};

/* ── 우상단 구체 위젯 0x455BD · 0x45844 · 0x45686 ── */
var ORB = {
  home:   { x: 250, y: 38 },       // [0x7500A] / [0x7500C]
  topLeft:{ x:  75, y: 38 },       // 0x45631
  bottom: { x: 250, y: 155 },      // 0x45664
  box:    { dx: -0x26, dy: -0x1D, w: 0x4C, h: 0x3E },  // 0x455CF~0x455F5 겹침 판정 상자
  clockFrame: 4,                   // TIME_GRA[4] 시계 바탕
  skyFirst: 5,                     // TIME_GRA[5 + si/2] 시간대 하늘 8종
  ringFrame: 0,                    // TIME_GRA[0] 행동력 구슬 테두리
  openFrames: [1, 2, 3],           // 여닫기 애니 — 1→2→3 열기, 3→2→1 닫기
  animTicks: 10,                   // 0x1033B(0x0A) 프레임 간격 10틱
  dateAt: [-21, -1], dateColor: 1,     // "%04d %02d" 색 1 (흰색)
  timeAt: [-15, 10], timeColor: 0x18,  // "%02d:%02d" 색 0x18 (230,230,255)
  spacing: 1,
  eraseR: 22,                      // 0x456CC 반지름 22 를 색 0 으로 지움
  centerDy: -6                     // 원반 중심 = ([0x7500A], [0x7500C] − 6)
};

/* ── Player Phase 0x454D5 ── */
var PHASE = {
  at: [0x28, 0xAA],                // (40, 170) — 셋 다 같고 앵커는 안 씁니다
  frame: { player: 8, waiting: 9, ai: 10 },   // ETC.ICO
  code:  { player: 1, waiting: 2, ai: 3 }     // byte[0xF042E]
};

/* ── 정보 바 0x4B4CA ──
 * 원본에서 이 자리 규칙이 나오는 곳은 여기 하나뿐입니다(AI 메뉴용 바).
 * 일반 캐릭터 정보 바는 COMBATII.EXE 에서 못 찾았습니다 — 자리만 그대로 씁니다. */
var INFOBAR = {
  top: 8, bottom: 0xA8,            // 0x4B4F2 / 0x4B4F9
  cameraMargin: 6,                 // 0x4B4EB  카메라 y + 6 이 경계
  rect: { x1: 0, dy1: -2, x2: 319, dy2: 26 },   // 0x4B511~0x4B528
  lutBank: 0                       // 0x4B500 — 검정 쪽 60 % (= rgba(0,0,0,.6) 로 흉내냅니다)
};

/* ── TEXT.CHR 소형 폰트 0x608E6 ── */
var GLYPH = { w: 5, h: 5, count: 100, sheet: 'ui/text_chr_시트정보.png' };

/* ── MENUSTAT.SYB 창 안쪽 좌표 (PNG 픽셀을 직접 재서 얻었습니다) ──
 * 번호는 04_도구/g2_export_ui.py 가 다시 뽑은 것이 맞습니다.
 * 03_분석/COMBATII/전투UI_자산.md 의 옛 표는 1씩 밀려 있었습니다. */
var MENUSTAT = {
  file: 'MENUSTAT.SYB',
  lvWin: 36,      // 94×52  LV/HP/MP/EXP
  statWin: 37,    // 144×135 Status
  itemWin: 38,    // 144×27  아이템 칸 5개
  moreBtn: 39,    // 81×22   MORE
  skillWin: 40,   // 187×190 Special attack / Magic
  /* 36번 창 — 라벨은 스프라이트에 있고 값만 오른쪽에 찍습니다 */
  lvRows: [8, 18, 28, 38],   // LV · HP · MP · EXP 글자 윗줄 y
  lvValueX: 38,              // 라벨이 x 8~33 을 먹으므로 값은 38부터
  /* 37번 창 — 아이콘 칸 23×23, 값 칸 32×23 */
  statRows: [33, 58, 87, 112],
  statIconX: [0, 87],
  statValueX: [25, 112],
  statCellH: 23, statValueW: 32,
  /* 38번 창 — 28×27 칸 5개 */
  itemCells: [0, 29, 58, 87, 116], itemCellW: 28, itemCellH: 27,
  /* 40번 창 */
  skillRows: [18, 42, 66, 90, 114],
  magicRow: 155, magicCells: [0, 26, 52, 78, 104, 130, 156]
};

/* Status 창 8칸의 뜻 — **그림으로 읽었습니다**.
 * MAIN.EXE 가 그리는 창이라 COMBATII.EXE 에는 배치 코드가 없습니다.
 * ★★★★★ **2026-08-29 — 「MAIN.EXE 를 봐야 한다」가 틀렸다.**
 *   `MAIN.EXE` 는 **31KB 짜리 런처**다 — 문자열이 WATCOM 런타임과
 *   `dos4gw.exe` · `combatII.exe` · `chp.exe` · `pack.exe` · `EXIT` · `LOAD` 뿐이다.
 *   화면을 그리는 코드가 없다.
 *
 *   ★ 그리고 **`COMBATII.EXE` 에는 `STR` 같은 능력치 이름 문자열이 하나도 없다**
 *     (`STR`·`AGI`·`DEX`·`CHR`·`CHA` 전수). 곧 전투 창의 8칸은 **글자가 아니라 아이콘**이다
 *     — 「그림으로 읽었습니다」가 맞는 방법이었다.
 *
 *   ★ 능력치 **이름 문자열은 `PACK.EXE 0x521F0`** 에 있다:
 *     `"STR\0INT\0DEX\0CHR\0MP\0"` — 곧 원본 표기는 **DEX**·**CHR** 이다
 *     (우리가 쓰는 `AGI`·`CHA` 와 이름이 다르다. 그 화면은 **마을** 쪽이다).
 * ☐ 남은 것 — 전투 8칸 **아이콘**과 능력치의 대응. 아이콘이라 EXE 문자열로는 못 푼다.
 *   원본 화면을 띄워 눈으로 맞춰야 한다(§A● 6번). */
var STAT_CELLS = [
  { row: 0, col: 0, key: 'str',  label: 'STR' },
  { row: 0, col: 1, key: 'agi',  label: 'AGI' },
  { row: 1, col: 0, key: 'int',  label: 'INT' },
  { row: 1, col: 1, key: 'cha',  label: 'CHA' },
  { row: 2, col: 0, key: 'atk',  label: 'ATK' },
  { row: 2, col: 1, key: 'def',  label: 'DEF' },
  { row: 3, col: 0, key: 'mr',   label: 'MR'  },
  { row: 3, col: 1, key: 'tp',   label: 'TP'  }
];

/* ── 스테이터스 화면 배치 — **원본 좌표입니다** ──────────────────────
 *
 * 「MENUSTAT 창을 어디에 그리는지는 MAIN.EXE 쪽」이라는 옛 메모는 **틀렸습니다.**
 * COMBATII.EXE 에 그대로 있습니다.
 *
 * ```
 * 0x493A3(eax = 유닛)   ★ 좌클릭·링 11 이 부르는 상태창
 *     0x44DEC(0)                        ; [0x75008]=0 — 상·하단 표시와 구체를 끕니다
 *     if (byte[유닛+0x0E] == 1)         ; 진영 1 = 아군
 *          0x48E90(유닛)                ; 장비까지 만지는 대화형 화면 (그리기는 0x48BC1)
 *     else
 *          0x454B3(카메라)              ; 맵을 다시 그리고
 *          0x48734(유닛)                ; ★ 윗부분만 — 초상화·이름·직업·LV/HP/MP/EXP
 *          0x499EF(0x4B0)               ; 1200틱 또는 아무 입력까지 대기
 *
 * 0x48734  초상화 0x48132(76, 120, 번호=byte[+0x10])
 *          이름   0x5E048(76 - 글자수*4, 93, "%s", 유닛+2)            ; 한글 0x5DD5B
 *          LV창   MENUSTAT[36] 을 앵커 (76, 164) 에                    ; [0xFD7A8]
 *          직업명 0x4868A(76 - 글자수*3, 126, 색 0x11, 0x71118+직업*16)
 *          레벨   0x4868A( 96, 146, 0x11, "%d", byte[+0x2B])
 *          HP     0x4868A( 60, 157, 0x11, "%d/%d", 현재HP/100, [+0x4C]/100)
 *          MP     0x4868A( 60, 167, 0x11, "%d/%d", w[+0x50], w[+0x52])
 *          경험치 0x4868A( 96, 177, 0x11, "%d", byte[+0x3D])
 *
 * 0x48BC1  = 0x48734 + 아래 (아군 전용)
 *          Status창 MENUSTAT[37] 앵커 (220,  74) → 좌상단 (148,   7)   ; [0xFD7B4]
 *          MORE     MENUSTAT[39] 앵커 (256, 184) → 좌상단 (216, 173)   ; [0xFD7CC]
 *          아이템창 MENUSTAT[38] 앵커 (220, 158) → 좌상단 (148, 145)   ; [0xFD7C0]
 *          능력치 8칸 0x5E048(x, y, "%d") — x 177·265,  y 45·70·99·124
 *              (177, 45) 힘 +0x40      (265, 45) 민첩 +0x42
 *              (177, 70) 지력 +0x41    (265, 70) 카리스마 +0x43
 *              (177, 99) 공격 w+0x44   (265, 99) 방어 w+0x46
 *              (177,124) MR   +0x59    (265,124) TP   w+0x54
 *          장비 아이콘 5칸 (0xEFDB4 표) x 161·190·219·248·277, y 182
 *              순서 무기[+0x5B] · 방패[+0x5A] · 장신구[+0x5D] · [+0x5E] · [+0x5F]
 * ```
 * ※ 원본은 **바탕을 어둡게 덮지 않습니다.** 맵을 다시 그린 위에 그대로 얹습니다.
 * ------------------------------------------------------------------------ */
var STATUS_LAYOUT = {
  /* 0x48132(76, 120, 번호 = byte[+0x10]).  PORTRAIT.SYF 프레임 앵커가 (−w/2, −h/2) 라
   * 이 좌표가 **그림 한가운데**입니다 (0x48277 `esi -= h/2`, 0x481A6 `edi -= w/2`).
   * h > 0x78 인 큰 그림만 아래쪽 정렬(0x48264 `y + 0x3C − h`)로 갑니다. */
  portrait: { file: 'PORTRAIT.SYF', x: 76, y: 120, tallY: 0x3C, tallH: 0x78 },
  /* 이름 — 원본 화면 실측: 중심 x 76 · 윗변 y 88 · 글자 높이 16
   * 색 0x11(247,223,113) · 외곽 0x12(247,199,85) */
  /* ★★★★★ **좌우맞춤(`rightX: 114`)을 뺐다 — 원본에 없는 처리였다** (2026-09-02)
   *
   *   원본 `0x48755` 는 **단순 중앙 정렬**이다:
   *   ```asm
   *   0x4875A  push 0x5D(93)                     ; ★ y = 93
   *   0x48761  repne scasb / not ecx / dec ecx   ;   ecx = **바이트 길이**
   *   0x48768  edx = 0x4C(76)                    ; ★ 중심 x = 76
   *   0x4876D  **shl eax, 2** ; 0x48770 **sub edx, eax**   ; ★ x = 76 − 길이×4
   *   ```
   *   곧 **폭 = 바이트 × 8** 로 치는 가운데 정렬이다(대사창 이름 `0x484B4` 와 같은 식).
   *
   *   ☠ 옛 주석은 근거를 「**원본 화면에서 잰 값**」이라 밝혔다 — EXE 를 안 본 것이다.
   *     원본 이름에 든 **자간용 공백**(「사    라」)이 벌어져 보인 것을
   *     「좌우로 맞추는 알고리즘」으로 오해했다. `%s` 는 문자열을 손대지 않으므로
   *     공백은 **그대로 폭**이 될 뿐이다.
   *   ☠ 그 결과 **이름 글자 수마다 자간이 달라졌다** —
   *     `소 환 수`(5자) 간격 15 px → 한글 16 px 이 **1 px 겹침** ·
   *     `샐러맨더`(4자) 간격 20 px → **4 px 벌어짐**.
   *   ⇒ 빼면 `_조합형글자외곽선`의 `else` 갈래(`leftX = cx − W/2`)가 도는데
   *     `W` 가 「한글 16 · 그 밖 8」의 합이라 **`76 − 바이트길이×4` 와 같은 식**이다.
   *   전문 — `03_분석/COMBATII/HUD_이름표_정렬_0x48755.md` · 재발방지 **⑥-c** */
  name:     { cx: 76, y: 93, half: 4, size: 16, color: 0x11, shadow: 0 },  // 테두리 검정(팔레트0=#000000). 중앙 정렬 0x48770
  jobName:  { cx: 76, y: 126, half: 3, color: 0x11 },
  lv:       { x: 76,  y: 164 },                // MENUSTAT[36] 앵커 → 좌상단 (29, 138)
  lvValues: { level: [96, 146], hp: [60, 157], mp: [60, 167], exp: [96, 177],
              color: 0x11 },
  stat:     { x: 220, y: 74 },                 // MENUSTAT[37] 앵커 → 좌상단 (148, 7)
  /* 0x5E048 큰 글꼴 기준. 원본 실물에서 왼쪽 칸 "60" 의 왼쪽 끝이 x 185,
   * 글자 윗변이 y 45 근처입니다 — 상수는 그대로 두고 보정값만 둡니다. */
  /* ★ 색과 위치를 원본 화면에서 픽셀로 재서 맞췄습니다.
   *   "60" 잉크 색 rgb(231,231,255) = 팔레트 24(0x18). 1(흰색)이 아닙니다.
   *   왼쪽 끝 x 173 · 윗변 y 40. */
  statCells:{ x: [177, 264], y: [45, 70, 99, 124], color: 0x18, bigDx: -4, bigDy: -5, margin: 3 },
  item:     { x: 220, y: 158 },                // MENUSTAT[38] 앵커 → 좌상단 (148, 145)
  itemIcons:{ x: [161, 190, 219, 248, 277], y: 182 },
  more:     { x: 256, y: 184 },                // MENUSTAT[39] 앵커 → 좌상단 (216, 173)
  /* MORE 2페이지 0x48863 — MENUSTAT[40] 187×190.
   * 앵커 `0x48891 [0x8D7DC]+0xA0` · `0x48883 [0x8D7DE]+0x64`. 두 전역은 창 흔들림
   * 오프셋이고 평소 0 이므로 (160, 100). */
  page2:     { x: 160, y: 100 },
  /* ★ 필살기 5줄 — 2026-08-15 원본에서 다시 잼. 전에는 **x 와 y 를 뒤바꿔** 넣어
   *   아이콘이 창 밖으로 흘러넘쳤다(사용자 지적).
   *     0x488E1  edx = 0x6D   → x 시작 109
   *     0x488DC  edi = 0x21   → y 시작 33
   *     0x48918  edx += 0x15  → 칸 간격 21
   *     0x48937  edi += 0x18  → 줄 간격 24
   *   줄별 개수는 레코드 `[+0x38]`~`[+0x3C]`, 첫 아이콘 번호는 줄마다 상수다
   *   (0x488EE eax=0 → 그리기 전 inc 라 1 · 0x48932 8 · 0x48999 0xC · 0x48A00 0x10
   *    · 0x48A67 0x14). `G2Ring.specialIcon(slot) = slot + 1` 과 그대로 맞는다. */
  /* ★★★★★ **`dyFix` 는 우리 보정이 아니라 원본이다 (2026-08-29 확정)**
   *
   *   사용자 관측(2026-08-15) 「필살기 1픽셀씩 내려야 해」가 맞았다.
   *   `0x4AC28` 을 끝까지 읽으니 **그리기 직전에 y 를 1 더하는 명령**이 있다.
   *   ```asm
   *   0x4AC41  movsx dx, byte [eax+0x0D]   ; 레코드의 x 오프셋
   *   0x4AC46  add edi, edx                ; x
   *   0x4AC53  cmp di, 0x12F(303) / jg     ; 오른쪽 자름
   *   0x4AC58  movsx dx, byte [eax+0x11]   ; 레코드의 y 오프셋
   *   0x4AC5D  add edx, ebx                ; y
   *   0x4AC61  mov cl, [eax+0x09]          ; 높이
   *   0x4AC64  add ebx, ecx / test / jl    ; y+높이 < 0 이면 건너뜀
   *   0x4AC6C  cmp dx, 0xC3(195) / jg      ; 아래 자름
   *   0x4AC73  inc edx                     ; ★★★ **y += 1** ← 바로 이것
   *   0x4AC74  mov ebx, [eax+0x15] · call  ; 그리기
   *   ```
   *   ⇒ 「원본에 없는 보정」이 아니라 **원본이 실제로 1 을 더한다.**
   *     이름만 `dyFix` 로 남아 있을 뿐 값은 원본대로다. */
  page2Rows: { x0: 0x6D, y0: 0x21, dx: 0x15, dy: 0x18, dyFix: 1,
               base: [1, 8, 12, 16, 20] },
  /* ★ 마법 7계열은 **가로 한 줄**이다 (0x48B15~0x48BA4).
   *     0x48B03  edi = 0x4E   → x 시작 78
   *     0x48B97  edi += 0x1A  → 칸 간격 26
   *     0x48B44  edx += 0xAA  → y 170 (+ 프레임 앵커)
   *     0x48B82  레벨 숫자 (x − 3, 0xBA = 186)
   *   프레임 = 41 + s + (`[+0x2E+s]` 마법레벨 − 1) × 7   (0x48B2C imul 7 · 0x48B34 ×0xC) */
  page2Magic:{ x0: 0x4E, dx: 0x1A, y: 0xAA, lvY: 0xBA, lvDx: -3 },
  /* EXP 두 개 — 같은 값을 **두 번** 찍는다. 1px 어긋난 쪽이 그림자다.
   *   필살 0x488BE (0xE9, 0x0B) 색 7  ← 그림자 · 0x488D7 (0xE8, 0x0A) 색 0x18 ← 본체
   *   마법 0x48ACE (0xE1, 0x94) 색 7  ← 그림자 · 0x48AEC (0xE0, 0x93) 색 0x18 ← 본체
   *   서식은 `%3d`(0x77D54) — 폭 3 오른쪽 정렬. */
  page2Exp:  { spX: 0xE8, spY: 0x0A, mgX: 0xE0, mgY: 0x93,
               색: 0x18, 그림자색: 7, dx: 1, dy: 1 },
  /* 아이템 칸 히트 판정 — 0x48F18 : x 0x94~0x123 · y 0x91~0xAB, 칸 폭 0x1D */
  itemHit:  { x1: 148, x2: 291, y1: 145, y2: 171, step: 29 },
  /* (덤) 원본에 없는 우리 추가분 — 장비 이름과 3층 표는 원본에 없습니다 */
  equip:    { x: 148, y: 190, lineH: 9, show: false },
  layers:   { x: 150, y: 146, colStep: 32, show: false }
};

/* ── 장비 제한 0x1832D ──
 * ITEM.DAT 66바이트에는 성별·직업 칸이 **없습니다** (03_분석/공통/ITEM_DAT_구조.md).
 * 제한은 전부 직업표에서 옵니다. */
var SLOT = { SHIELD: 0, WEAPON: 1, SUB: 2 };          // 0x1832D 의 ebx
var JOBWEAPON_TO_ITEMKIND = [                          // 표 0x74124
  255, 1, 5, 3, 2, 4, 255, 255, 255, 255, 255, 255, 255, 255, 0, 0
];
var EQUIP_MSG = {                                      // 0x76F37 …
  slot:      '여기에 장착할 수 없습니다.',
  noWeapon:  '무기를 장착할 수 없는 직업입니다.',
  wrongKind: '직업에 맞지않는 무기입니다.',
  twoHandBlocked: '양손무기를 쥘수 없는 상태입니다.',
  twoHandHeld:    '양손 무기를 쥐고 있는 상태입니다.',
  noShield:  '방패 사용불가인 직업입니다.',
  noCloak:   '회피용 망토 사용불가인 직업입니다.',
  notSub:    '보조구가 아닙니다.'
};

/* ═══════════════════════════════════════════════ 2. 순수 계산 (Node 에서도 됩니다) */

/** 0 쪽으로 자르는 나눗셈 — 386 의 `idiv` 와 같습니다. */
function idiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }

/**
 * 아군 사기 막대 — 0x44E17.  x = 180 − 사기 부터 (사기 − 40)px, 오른쪽 끝은 139 고정.
 * @returns {{x:number, len:number}|null} 길이 ≤ 0 이면 null (0x5EC44 가 그냥 돌아옵니다)
 */
function moraleAlly(m) {
  var len = m - MORALE.floor;
  return len > 0 ? { x: 180 - m, len: len } : null;
}
/** 적군 사기 막대 — x = 175 고정에서 (사기 − 40)px. 끝은 134 + 사기. */
function moraleEnemy(m) {
  var len = m - MORALE.floor;
  return len > 0 ? { x: MORALE.enemy.startX, len: len } : null;
}

/** 하단 눈금 개수 — ((턴 % N) + 1) / 2  (정수 나눗셈).  0x44EC8 */
function gaugeCount(turn, period) {
  var N = period || TURN.periodDefault;
  return idiv((turn % N) + 1, 2);
}

/**
 * 시계 — 0x45844 · 0x459BF · 0x4586A.
 * @param {number} timeIdx  [0xFDF84] 0~15
 * @param {number} turn     [0xF0418]
 * @param {number} kind     [0xBA84E] 전투 종류
 * @param {number} dayIdx   [0xFDF82]
 */
function clock(timeIdx, turn, kind, dayIdx) {
  var si = (timeIdx | 0) & 15;
  var h = (si >> 1) * 3 + (si < 8 ? 12 : -12);    // 0x458C? 표 그대로
  var m = (si & 1) * 30;

  /* 턴에서 나온 분 — 0x4586A / 0x458F1.
   * ※ 모드 4·5 의 제수 10 은 시간 인덱스를 올리는 제수 30 과 3배 어긋납니다.
   *   사양서 8장에 「의도인지 버그인지 못 찾았습니다」로 남아 있습니다. 코드 그대로 씁니다. */
  turn = turn | 0;
  if (kind === 4 || kind === 5) { m += (turn % 10) * 6; }
  else { h += idiv(turn % 900, 600); m += idiv((turn % 900) % 600, 10); }
  if (m >= 60) { h += 1; m -= 60; }               // 0x4592B — 24시 클램프는 원본에 없습니다

  dayIdx = dayIdx | 0;
  return {
    hour: h, min: m,
    sky: ORB.skyFirst + (si >> 1),                // TIME_GRA 프레임 번호
    year: 0x4B7 + idiv(dayIdx, 220),              // 0x4B7 = 1207
    day: (dayIdx % 220) + 1,                      // 1 ~ 220
    dateText: pad(0x4B7 + idiv(dayIdx, 220), 4) + ' ' + pad((dayIdx % 220) + 1, 2),
    timeText: pad(h, 2) + ':' + pad(m, 2)
  };
}
function pad(v, n) { var s = String(v); while (s.length < n) s = '0' + s; return s; }

/**
 * 구체 앵커 — 0x455BD.  커서와 겹치면 자리를 옮깁니다.
 * @param {number} curX,curY  마우스 커서 (논리 320×200). 없으면 null 을 주십시오.
 * @param {{x,y}} cur         지금 앵커
 * @returns {{x,y,moved:boolean}}
 */
/**
 * ★ [리마스터 N-13] 구체가 앉는 **화면 모서리** 자리.
 *
 * 구체는 화면 구석에 붙는 위젯이라 확장 폭을 따라가야 합니다
 * (사용자 지시 2026-08-15 「tp구 위치도 확장에 따라 … 조정되어야 해」).
 * 좌표계는 `draw()` 의 `translate(cx,0)` 뒤 — **화면 가운데는 여전히 160** 이고
 * 왼쪽 끝이 `−CX`, 오른쪽 끝이 `320+CX` 입니다. 그래서 모서리까지의 거리를
 * 그대로 지키려면 오른쪽 것은 `+CX`, 왼쪽 것은 `−CX` 입니다.
 *   home  (250,38)  오른쪽 위  — 오른쪽 여백 70
 *   bottom(250,155) 오른쪽 아래
 *   topLeft(75,38)  왼쪽 위    — 왼쪽 여백 75
 */
function orbCorner(kind, CX) {
  var a = ORB[kind];
  return { x: a.x + (kind === 'topLeft' ? -(CX | 0) : (CX | 0)), y: a.y };
}

function orbAnchor(curX, curY, cur, CX) {
  CX = CX | 0;
  cur = cur || orbCorner('home', CX);
  if (curX == null || curY == null) return { x: cur.x, y: cur.y, moved: false };
  var x0 = cur.x + ORB.box.dx, y0 = cur.y + ORB.box.dy;
  var hit = (x0 <= curX && x0 + ORB.box.w >= curX &&
             y0 <= curY && y0 + ORB.box.h >= curY);
  if (!hit) return { x: cur.x, y: cur.y, moved: false };
  /* 판정 기준 `<90` · `>160` 은 **화면 절반**이라 확장돼도 그대로입니다
   *   (translate 덕분에 가운데는 언제나 160). */
  var b, t, h;
  if (curY <  90) { b = orbCorner('bottom',  CX); return { x: b.x, y: b.y, moved: true }; }  // 0x45600
  if (curX > 160) { t = orbCorner('topLeft', CX); return { x: t.x, y: t.y, moved: true }; }  // 0x4560D
  h = orbCorner('home', CX); return { x: h.x, y: h.y, moved: true };
}

/**
 * 행동력 구슬 램프 — 0x45686.
 * @returns {{base:number, L:number, S:number, rings:{r:number,c:number}[]}}
 */
function orbLamp(v) {
  v = v | 0;
  var base = v > 300 ? 0x20 : v > 200 ? 0x50 : v > 100 ? 0x30 : 0x10;
  var L = Math.ceil((v % 100) / 5); if (L === 0) L = 20;
  var S = L <= 2 ? 3 : L <= 10 ? 2 : L <= 18 ? 1 : 0;
  var rings = [{ r: L, c: base + S }];
  for (var k = S + 1; k <= 3; k++) rings.push({ r: 26 - 8 * k, c: base + k });
  return { base: base, L: L, S: S, rings: rings };
}

/** 정보 바 y — 0x4B4DF.  칸 y 가 카메라 y + 6 보다 아래면 바를 위로 올립니다. */
function infoBarY(unitTileY, cameraTileY) {
  return (unitTileY > (cameraTileY | 0) + INFOBAR.cameraMargin) ? INFOBAR.top : INFOBAR.bottom;
}

/** TEXT.CHR 글리프 번호 — 0x608E6. 0 이하이거나 99 를 넘으면 안 찍습니다. */
function glyphIndex(code) {
  if (code >= 0x61 && code <= 0x7A) code -= 0x20;   // 소문자 → 대문자
  else if (code > 0x7A) code -= 0x1A;
  return code - 1;
}
/** 글자 전진 = 5 + 자간. 마지막 글자 뒤에도 전진합니다(원본 그대로). */
function textAdvance(s, spacing) { return s.length * (GLYPH.w + (spacing == null ? 1 : spacing)); }

/** 0x484F9 의 그림자 색 — 0x48525~0x48544. */
function shadowColor(c) { return c < 8 ? 8 - c : Math.min(c - 7, 6); }

/**
 * ★★★★★ **외곽선 글씨의 프레임별 색** — 원본 [0x484F9] (2026-09-10 · M35)
 *
 *   > 사장님: 「마법 이름뜨는 것도 원본과 달라 **우리는 글자만 뜨고
 *   >  원본은 반짝이는것 같은 효과**가 있어」
 *
 *   0x484F9 는 프레임 f 를 ecx 로 받아 **색을 둘** 정한다.
 *   ☠ 여기 오래 「외곽선과 본문이 **같은 색**」이라 적혀 있었다. **8프레임째부터 갈린다.**
 *
 *   0x48525  cmp bx,8 / jge          ; 외곽선 = f < 8 ? 8 - f : min(f - 7, 6)
 *   0x48532  mov [esp+0x10], ax      ;   ★ f < 8 일 때만 본문칸에도 그 값을 넣는다
 *   0x4856D 0x48583 0x48599 0x485B3  ; 외곽선 넷 (x±1,y) (x,y±1) — 위 값
 *   0x485AF  mov edi, [esp+0x10]     ;   ★ push 뒤라 [esp0+0xC] = **프레임 f 원값**
 *   0x485B8  cmp di,9  / jle 0x485D6
 *   0x485C0    add eax,0x6           ;   f > 9  → 본문 = f + 6
 *   0x485CA    cmp ax,0x11 / jle     ;     17 을 넘으면
 *   0x485D0    mov eax,[esp+0x24]    ;     → **부른 쪽이 넘긴 예비색**(늘 0x11)
 *   0x485D6  cmp di,7  / jle 0x485E8 ;   f <= 7 → 본문 = 외곽선과 같은 값
 *   0x485DE    add eax,0x39          ;   f 8·9 → 본문 = f + 57  (65 · 66)
 *   0x485F3  mov al,[esp+0x10]       ; 본문색
 *
 *   실측 팔레트(GENESIS.PAL) — 1 흰색 · 2~7 점점 어두운 회청 ·
 *   65 (247,210,194) 연살구 · 66 (247,190,174) 살구 ·
 *   16 (255,247,178) 밝은노랑 · 17 (247,223,113) 노랑
 *
 *   f      1  2  3  4  5  6  7 |  8   9  10  11  12 …  36
 *   외곽선 7  6  5  4  3  2  1 |  1   2   3   4   5   6   6 …
 *   본문   7  6  5  4  3  2  1 | 65  66  16  17  17  17  17 …
 *
 *   ⇒ **어둠에서 흰색으로 확 떠올랐다가 살구빛을 거쳐 노란 글씨로 자리잡는다.**
 *     36프레임 중 23프레임이 노랑이다. 우리는 끝까지 어두운 회청색이었다.
 *
 * @param {number} f      연출 프레임 (1~36)
 * @param {number} [예비색] 0x485D0 이 쓰는 색 — 부른 쪽이 넘긴 값. 기본 0x11
 * @returns {{외곽선:number, 본문:number}}
 */
function 외침색(f, 예비색) {
  f = f | 0;
  var 예비 = (예비색 == null) ? 0x11 : (예비색 | 0);
  var 선 = (f < 8) ? (8 - f) : Math.min(f - 7, 6);   // 0x48525~0x48544
  var 본;
  if (f > 9) {                                       // 0x485B8  cmp di,9 / jle
    본 = f + 6;                                      // 0x485C0  add eax,6
    if (본 > 0x11) 본 = 예비;                         // 0x485CA  cmp ax,0x11 / jle → 0x485D0
  } else if (f > 7) {                                // 0x485D6  cmp di,7 / jle
    본 = f + 0x39;                                   // 0x485DE  add eax,0x39
  } else {
    본 = 선;                                          // 0x48532 가 넣어 둔 값 그대로
  }
  return { '외곽선': 선, '본문': 본 };
}

/* ── 장비 제한 0x1832D ─────────────────────────────────────────────────── */

/** 아이템 종류 → 들어갈 칸 부류. 0x1834F */
function slotCategory(kind) {
  if (kind <= 5) return SLOT.WEAPON;                       // 검·부·창·궁·지팡이
  if (kind === 6 || kind === 8) return SLOT.SHIELD;        // 방패·망토
  return SLOT.SUB;                                         // 보조
}

/** 0x174CF — 직업의 무기 종류 코드. */
function jobWeaponCode(unit, T) {
  /* ★★★★★ **0x174D0 을 읽었다 (2026-08-29)** — `[+0x77]` 은 **포인터**다.
   *   ```asm
   *   0x174D0  mov dl, [eax+0x5C] · test / jbe · cmp dl,4 / ja   ; 1~4 일 때만
   *   0x174DA  mov edx, [eax+0x77]                ; ★ **dword 포인터** (다른 유닛 레코드)
   *   0x174DD  cmp byte [edx+0x11], 0x17(23) / jne ; 그쪽의 **직업**이 23 이면
   *   0x174E3  mov al, 5 · ret                    ;   무기 종류 5(활)
   *   0x174E6  dl = [eax+0x11](직업) · ×3 · mov al, [eax + 0x72793] · ret
   *   ```
   *   `+0x11` 이 직업이라는 것은 아래 갈래가 그대로 보여 준다.
   *   직업표는 `0x72793 + 직업 × 3` 이고 **무기 종류는 그 +2** 다
   *   (문서의 `0x72795` 와 맞아떨어진다).
   *   ⇒ `[+0x77]` 은 **같이 탄 상대(탈것/기수)의 레코드**를 가리킨다.
   *   ☐ 우리 상태에는 아직 그 연결이 없어 보정을 안 건다. */
  var arr = T && T['직업'];
  var j = arr && arr[unit.job];
  return j ? (j['무기종류'] | 0) : 0;
}
/** 직업표 0x72795 — 1 = 방패 방어형 · 2 = 회피형. */
function jobDefenseStyle(unit, T) {
  var arr = T && T['직업'];
  var j = arr && arr[unit.job];
  return j ? (j['표72793_3'] | 0) : 0;
}
function itemRec(T, code) {
  if (!code) return null;
  var arr = T && T['아이템'];
  return (arr && arr[code - 1]) || null;      // 코드 = ITEM.DAT 색인 + 1
}

/**
 * 그 칸에 그 아이템을 낄 수 있는지 — 0x1832D 를 그대로 옮겼습니다.
 * 판정 순서까지 원본과 같아야 나오는 문구가 같습니다.
 * @param {object} unit   G2State 유닛 (job · gear 를 봅니다)
 * @param {number} code   아이템 코드 (0 = 벗기 → 언제나 됩니다)
 * @param {number} slotCat SLOT.SHIELD | SLOT.WEAPON | SLOT.SUB
 * @param {object} T      tables.json
 * @returns {{ok:boolean, why:string}}
 */
function canEquip(unit, code, slotCat, T) {
  if (!code) return { ok: true, why: '' };                       // 0x18336
  var rec = itemRec(T, code);
  if (!rec) return { ok: false, why: '없는 아이템 코드입니다.' };
  var kind = rec['종류'] | 0;

  if (slotCategory(kind) !== slotCat) return { ok: false, why: EQUIP_MSG.slot };

  if (slotCat === SLOT.WEAPON) {                                 // 0x183A2
    var need = JOBWEAPON_TO_ITEMKIND[jobWeaponCode(unit, T)];
    if (need === undefined || need === 255) return { ok: false, why: EQUIP_MSG.noWeapon };
    if (need !== kind) return { ok: false, why: EQUIP_MSG.wrongKind };
    if ((rec['크기'] | 0) === 2 && unit.gear && unit.gear.shield)
      return { ok: false, why: EQUIP_MSG.twoHandBlocked };        // 0x183DD
    return { ok: true, why: '' };
  }

  if (slotCat === SLOT.SHIELD) {                                 // 0x183FE
    var w = unit.gear && unit.gear.weapon;
    var wr = itemRec(T, w);
    if (wr && (wr['크기'] | 0) === 2) return { ok: false, why: EQUIP_MSG.twoHandHeld };
    var style = jobDefenseStyle(unit, T);
    if (kind === 6 && style !== 1) return { ok: false, why: EQUIP_MSG.noShield };
    if (kind === 8 && style !== 2) return { ok: false, why: EQUIP_MSG.noCloak };
    return { ok: true, why: '' };
  }

  /* SLOT.SUB — 0x1847E */
  if ((rec['크기'] | 0) !== 0) return { ok: false, why: EQUIP_MSG.notSub };
  return { ok: true, why: '' };
}

/** 우리 유닛의 gear 칸 이름 → 0x1832D 의 칸 부류. */
var GEAR_SLOT = {
  weapon: SLOT.WEAPON,
  shield: SLOT.SHIELD,     // 방패·망토가 같은 칸입니다
  charm:  SLOT.SUB,        // 장신구
  sub:    SLOT.SUB
  /* mount(탈것) 은 ITEM.DAT 아이템이 아니라 별도 표입니다 — 0x1832D 가 안 봅니다 */
};

var Calc = {
  moraleAlly: moraleAlly, moraleEnemy: moraleEnemy, gaugeCount: gaugeCount,
  clock: clock, orbAnchor: orbAnchor, orbLamp: orbLamp, infoBarY: infoBarY,
  glyphIndex: glyphIndex, textAdvance: textAdvance, shadowColor: shadowColor,
  외침색: 외침색,          /* 0x484F9 — 프레임별 { 외곽선, 본문 } */
  slotCategory: slotCategory, canEquip: canEquip, idiv: idiv, pad: pad
};

/* ═══════════════════════════════════════════════ 3. 자산 */

function Assets() {
  this.json = null;
  this.base = '자산/';
  this.images = {};        // png 경로 → Image
  this.sheet = null;       // TEXT.CHR 시트
  this.tints = {};         // 색 번호 → 색칠한 시트 캔버스
  this.ready = false;
  this.native = {};        // 원본 직독: 파일명 → {frames:[{w,h,ax,ay,idx}], palette, canvas:{}}  (native.js)
  /* [11-09] 원본 직독 대상 — 실릴 때까지 frame() 이 추출 PNG 로 물러나지 않는다(battle_assets 가 직독을 걸기 «전»에 사기 바가 그려져 PNG 를 불렀다) · 원본 직독 모듈이 없는 환경(일부 시험)만 예전대로 */
  this.직독대상 = (typeof root !== 'undefined' && root.G2Native) ? { 'G2MSG.SYB': 1, 'PORTRAIT.SYF': 1, 'PORTSMAL.SYF': 1, 'MENUSTAT.SYB': 1, 'FRAME.SYB': 1, 'ETC.ICO': 1, 'TIME_GRA.SYB': 1, 'CHR_EFFC.SYB': 1, 'MAIN.CUR': 1, 'MOVE.CUR': 1 } : null;
}
/** 원본에서 디코딩한 스프라이트를 자산으로 등록 — frame/image 가 이걸 우선 씁니다. */
Assets.prototype.setNative = function (file, frames, palette) {
  this.native[file] = { frames: frames, palette: palette, canvas: {} };
  return this;
};

/**
 * ★★★ **TEXT.CHR 소형 폰트를 원본에서 직독해 시트로 굽는다** (2026-08-23)
 *
 *   전에는 추출 번들 `자산/ui/text_chr_시트정보.png` 만 썼다. 그래서
 *   ① 원본직독 원칙에 어긋나고 ② 번들 경로가 안 맞는 셸(`게임.html`)에서는
 *   **소형 폰트로 그리는 것이 통째로 사라졌다** (LV/HP/MP/EXP · 직업명 · 데미지 숫자).
 *
 *   원본 `TEXT.CHR` = 0x80 헤더 뒤 100자 x (8 건너뜀 + w u16 + h u16 + w*h).
 *   실측 100자 전부 5x5 이고 0xFF 가 투명이다 (0x5F874 · 0x608E6).
 *   `tinted()` 가 source-in 으로 색칠하므로 **불투명 = 획**인 마스크를 만든다.
 *
 *   @param {Array} glyphs  G2Native.decodeTextchr 산출물 100개
 */
Assets.prototype.setTextchr = function (glyphs) {
  if (!glyphs || !glyphs.length || typeof document === 'undefined') return this;
  var n = Math.min(glyphs.length, GLYPH.count);
  var c = document.createElement('canvas');
  c.width = GLYPH.count * GLYPH.w; c.height = GLYPH.h;
  var g = c.getContext('2d'), img = g.createImageData(c.width, c.height);
  for (var i = 0; i < n; i++) {
    var gl = glyphs[i]; if (!gl || !gl.px) continue;
    var tr = (gl.tr == null ? 0xFF : gl.tr);
    for (var y = 0; y < gl.h && y < GLYPH.h; y++) {
      for (var x = 0; x < gl.w && x < GLYPH.w; x++) {
        if (gl.px[y * gl.w + x] === tr) continue;          // 투명
        var o = ((y * c.width) + (i * GLYPH.w + x)) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = 255;
      }
    }
  }
  g.putImageData(img, 0, 0);
  this.sheet = c;
  this.직독시트 = true;      // _미리읽기 가 PNG 로 덮어쓰지 못하게 한다
  this.tints = {};           // 색칠 캐시를 버린다
  return this;
};

/** ★ `GENESIS.PAL` 768바이트를 직접 쥐여 준다 — 이것이 **화면 색의 기준**이다.
 *  ★ 처음 받은 것을 `기본팔레트` 로 간직한다 — 전투 날씨 보정을 **거기서 다시** 만든다. */
Assets.prototype.setPalette = function (pal768) {
  if (pal768 && pal768.length >= 768) {
    if (!this.기본팔레트) this.기본팔레트 = new Uint8Array(pal768);
    this.pal768 = pal768; this.tints = {};
  }
  return this;
};

/** ★★★★★ **전투 날씨에 맞춰 글씨 색을 다시 만든다** — 원본 `0x1077A` (2026-09-10)
 *
 *   > 사장님: 「해당 부분 제외하고도 **노란색 글자를 사용하는 부분 많아**
 *   >  (캐릭터 이름, 아이템 설명, 각종 대사 등). 원본에서 그 글자 색이 동일한지 확인해」
 *
 *   원본 `0x1077A` 는 팔레트 **0~255 전부**를 DAC 에 쓴다. 곧 **맵·스프라이트뿐 아니라
 *   글씨·초상화·HUD 도 같은 팔레트를 본다.** 날씨가 걸린 전투(비·눈·모래바람·안개
 *   — 시나리오 327개 중 **27개**, 첫 전투 1-1 포함)에서는 그 보정이 **글씨에도** 걸린다.
 *
 *   ☠ 우리는 맵·스프라이트에만 걸고 **글씨에는 안 걸었다.** 게다가 `color()` 가
 *     `ui.json` 을 먼저 보는 바람에 `setPalette` 로 준 값이 통째로 버려졌다.
 *
 *   실측(15-2 모래바람 · `05_결과/굽기/원본프레임`) — 여덟 색이 **전부** 원본과 같아졌다:
 *   2·3·4·5·6·16·17·66 → (215,219,227)…(243,227,138)…
 *
 *   ★ 전투에 들어갈 때마다 부른다. 날씨 0 이면 바탕 그대로라 되돌리기도 이것으로 된다.
 */
Assets.prototype.날씨적용 = function () {
  var N = root.G2Native;
  if (!this.기본팔레트 || !N || !N.전투팔레트) return this;
  var 옛팔 = this.pal768;
  this.pal768 = N.전투팔레트(this.기본팔레트);
  this.tints = {};                       /* 소형 폰트 틴팅 캐시 */
  /* ★ 원본 직독 그림(상태창 틀·초상화·아이템…)도 같은 팔레트를 탄다.
   *   `image()` 가 `nf.canvas` 에 구워 두므로 **캐시만 비우면** 다음에 다시 굽는다.
   *   ☠ 제 팔레트를 따로 들고 온 것(있다면)은 건드리지 않는다 — 같은 것만 바꾼다. */
  var self = this;
  Object.keys(this.native || {}).forEach(function (k) {
    var nf = self.native[k];
    if (!nf) return;
    /* 정본 282 — 가리지 않고 모두 지금 날씨 팔레트로 다시 칠한다: 전투마다 setBasePalette·setPalette 가 바탕·작업 팔레트를 새 배열로 갈아
     *   앞 전투의 안개 팔레트를 쥔 초상·장식 기둥·TP 구체가 «남의 팔레트»로 보여 건너뛰어졌다 → 새로고침 전까지 뿌옇게 남았다
     *   (사장님 11-18 「안개맵 갔다왔을때 아직도 전체 ui 뿌옇게 되는거 남아있잖아! … 포트레이트, 장식 기둥, tp구체 등 각종 ui가 뿌옇게 변한채로 남는다고. 새로고침 전까지.」)
     *   원본도 화면 팔레트는 하나다(0x1077A 가 DAC 256색 전부) · 따로 쥔 것은 로딩 화면 사본뿐이고 그것은 열 때마다 원래 색을 다시 쥔다(battle_loading 215) */
    if (nf.palette && nf.palette.__제팔레트) return;   /* 로딩 화면 사본(battle_loading 215)만 그대로 */
    void 옛팔;
    nf.palette = self.pal768; nf.canvas = {};
  });
  return this;
};

/** HUD 자산 기술 JSON과 기준 경로를 설치해 적재 대상을 구성한다. */
Assets.prototype.set = function (json, base) {
  this.json = json;
  this.base = base || this.base;
  this._미리읽기();
  return this;
};

/** HUD 자산을 기준 경로에서 적재하고 완료 콜백에 결과를 전달한다. */
Assets.prototype.load = function (base, cb) {
  var self = this;
  this.base = base || this.base;
  function done(j) { self.set(j, self.base); if (cb) cb(null, j); }

  /* 자산/ui_assets.js 를 <script src> 로 먼저 읽었으면 그걸 씁니다 (file:// 대비) */
  if (root.G2UI_ASSETS) { done(root.G2UI_ASSETS); return this; }

  var url = this.base + 'ui.json';
  if (typeof fetch === 'function' && root.location && root.location.protocol !== 'file:') {
    fetch(url).then(function (r) { return r.json(); }).then(done)
      .catch(function (e) { if (cb) cb(e); });
  } else {
    try {
      var x = new XMLHttpRequest();
      x.open('GET', url, true);
      x.onload = function () {
        try { done(JSON.parse(x.responseText)); } catch (e) { if (cb) cb(e); }
      };
      x.onerror = function () { if (cb) cb(new Error('ui.json 을 못 읽었습니다')); };
      x.send();
    } catch (e) { if (cb) cb(e); }
  }
  return this;
};

/** HUD 자산표의 정적 그림을 초기 캐시에 요청한다. */
Assets.prototype._미리읽기 = function () {
  if (typeof Image === 'undefined' || !this.json) return;
  /* ★★★ **번들 PNG 를 미리 받지 않는다** (2026-08-24)
   *
   *   사용자 지정: 「**모든 소스 원본과 적용폴더에서만 적용되어야해.**」
   *
   *   전에는 `ui.json` 의 모든 프레임 PNG 를 여기서 미리 받았다. 그래서
   *   ① 원본직독으로 이미 올라온 자산까지 **쓰지도 않을 PNG 를 받고**
   *   ② 번들 경로가 없는 셸에서는 `chr_000~099.png` 등 **404 가 무더기로** 났다.
   *
   *   `image()` 에 이미 **쓸 때 한 장씩 받는 갈래**가 있으므로(초상화가 그렇게 돈다)
   *   미리 받기를 걷어낸다. native 로 등록된 것은 애초에 PNG 를 안 건드린다. */
  /* ★ 원본 직독 시트가 이미 있으면 번들 PNG 로 덮지 않는다 (2026-08-23) */
  if (!this.직독시트) this._원본시트받기();
  this.ready = true;
};

/** ★★★★★ **소형 폰트 시트를 원본 `TEXT.CHR` 에서 직접 받는다** (2026-09-10)
 *
 *   > 사장님: 「모든 이미지는 **적용폴더 우선, 없는 경우 원본에서 참조**해야 해.
 *   >  그 외에 **별도 추출본 사용하지 않도록** 확인해줘.」
 *
 *   ☠ 전에는 여기서 번들 `자산/ui/text_chr_시트정보.png` 를 **먼저 받아 두고**,
 *     조금 뒤 `battle_assets.js` 가 `TEXT.CHR` 직독분으로 덮었다.
 *     화면에 나오는 것은 직독분이지만 **추출본을 한 번 받아서 버리고** 있었다
 *     (실측 — 전투 한 판에 `text_chr_시트정보.png` 1KB 를 받았다).
 *   ⇒ 처음부터 원본에서 받는다. `G2URL` 이 **적용폴더 → 원본** 순으로 준다.
 *     직독이 안 되는 환경에서만 번들 PNG 로 떨어진다. */
Assets.prototype._원본시트받기 = function () {
  var self = this, N = root.G2Native;
  function 번들로(까닭) {
    if (self.직독시트) return;
    if (까닭) console.warn('TEXT.CHR 직독 실패 — 번들 시트로 떨어진다:', 까닭);
    if (typeof Image === 'undefined') return;
    self.sheet = new Image();
    self.sheet.src = self.base + GLYPH.sheet;
  }
  if (!N || !N.decodeTextchr || typeof fetch !== 'function') { 번들로(null); return; }
  var url = (typeof root.G2URL === 'function') ? root.G2URL('TEXT.CHR') : '/원본/TEXT.CHR';
  fetch(url)
    .then(function (r) { if (!r.ok) throw new Error('TEXT.CHR ' + r.status); return r.arrayBuffer(); })
    .then(function (b) { self.setTextchr(N.decodeTextchr(new Uint8Array(b))); })
    .catch(function (e) { 번들로(e && e.message); });
};

/** 그림 한 장 — 미리 안 받아 둔 것(초상화)은 여기서 처음 받습니다. */
Assets.prototype.image = function (png) {
  if (!png) return null;
  if (png.charCodeAt(0) === 64) {                 // '@파일#n' — 원본 직독 프레임을 캔버스로
    var sp = png.slice(1).split('#'), file = sp[0], n = sp[1] | 0, nf = this.native[file];
    if (!nf || !nf.frames[n] || typeof document === 'undefined') return null;
    if (!nf.canvas[n]) {
      var fr = nf.frames[n], c = root.G2Native.frameToCanvas(fr, nf.palette);
      /* naturalWidth/Height 는 **논리 크기** — blit/portrait 의 중앙정렬 계산이 그대로 맞는다. */
      c.complete = true; c.naturalWidth = fr.w; c.naturalHeight = fr.h;   // blit/portrait 의 이미지 판정 통과용
      nf.canvas[n] = c;
    }
    return nf.canvas[n];
  }
  /* ── 추출 PNG 갈래 ─────────────────────────────────────────────────
   * ★ 아직 직독으로 안 올라온 자산(`TIME_GRA.SYB` = TP 구체 틀 등)이 여기 온다.
   *   스케일러가 켜져 있으면 **N배 캔버스**로 바꿔 준다 — 준비 전에는 원본
   *   이미지를 그대로 쓰고, 다 구워지면 그때부터 캔버스를 돌려준다.
   *   (사용자 지적 2026-08-14 「TP 구체(내부 게이지만 적용됨)도 적용 안 되고」) */
  var S = root.G2Scaler;
  if (S && S.N() > 1 && S.sheetCanvas) {
    var url = this.base + png;
    var self = this;
    var cv = S.sheetCanvas(url, function () { self._upCache = null; });
    if (cv) {
      /* `blit` 이 `im.complete && im.naturalWidth` 를 보므로 흉내 낸다 */
      if (!cv.complete) { cv.complete = true; cv.naturalWidth = cv.논리w; cv.naturalHeight = cv.논리h; }
      return cv;
    }
  }
  var im = this.images[png];
  if (!im && typeof Image !== 'undefined') {
    im = new Image(); im.src = this.base + png;
    this.images[png] = im;
  }
  return im;
};

/** 프레임 메타 한 칸. */
Assets.prototype.frame = function (file, n) {
  var nf = this.native[file];
  if (nf) {
    var fr = nf.frames[n];
    return fr ? { png: '@' + file + '#' + n, '앵커': [fr.ax, fr.ay], '앵커적용': true, w: fr.w, h: fr.h } : null;
  }
  /* [11-09] 원본 직독을 걸어 둔 파일이면 실릴 때까지 그리지 않는다 — 추출 PNG(자산/ui/…)로 물러나지 않음
   *   (싣는 도중 FRAME.SYB 14~17 이 PNG 로 요청됐다 · 배포 묶음엔 PNG 가 없다 · 사장님 「모든거 원본에서 로드한다고 했는데 png가 왜 들어가있지?」) */
  if (this.직독대상 && this.직독대상[file]) return null;
  var f = this.json && this.json['파일'] && this.json['파일'][file];
  return (f && f['프레임'] && f['프레임'][n]) || null;
};

/** 팔레트 색 → CSS 색.
 *
 *  ☠★★★★★ **2026-09-10 — 순서를 뒤집었다.** 전에는 `ui.json` 을 **먼저** 보고
 *    `pal768` 은 「ui.json 이 없을 때만」 썼다. 그런데 `ui.json` 은 늘 있으므로
 *    `setPalette()` 로 준 **원본 직독 팔레트가 한 번도 안 쓰였다.** 그래서 —
 *      ① 전투 **날씨 보정이 글씨에 안 걸렸다** (`날씨적용()` 주석 참고)
 *      ② `ui.json` 의 6→8비트 환산이 `round(v×255/63)` 이라 원본
 *         (`(v<<2)|(v>>4)`) 과 **1씩 어긋났다** (색 2 → 210 vs **211**)
 *    ⇒ **원본 직독 팔레트가 먼저다.** `ui.json` 은 그것이 없을 때의 대비책이다.
 */
Assets.prototype.color = function (n) {
  n = n & 0xFF;
  /* ★ 원본 직독 팔레트가 먼저 — 전투 날씨 보정(0x1077A)이 여기 들어 있다 */
  if (this.pal768 && this.pal768.length >= 768) {
    var q = n * 3;
    return 'rgb(' + this.pal768[q] + ',' + this.pal768[q + 1] + ',' + this.pal768[q + 2] + ')';
  }
  var p = this.json && this.json['팔레트'];
  var rgb = p && p.rgb && p.rgb[n];
  if (!rgb) return '#ff00ff';        // 눈에 띄게 — 팔레트가 안 실렸다는 뜻입니다
  return 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
};

/** 색칠한 TEXT.CHR 시트 (1비트 마스크라 색은 인자 하나입니다 — 0x5F093). */
Assets.prototype.tinted = function (colorIdx) {
  var key = String(colorIdx);
  if (this.tints[key]) return this.tints[key];
  var sh = this.sheet;                       // ★ Image 이거나 직독 캔버스
  if (!sh) return null;
  if (sh.naturalWidth !== undefined) { if (!sh.complete || !sh.naturalWidth) return null; }
  else if (!sh.width) return null;
  if (typeof document === 'undefined') return null;
  var c = document.createElement('canvas');
  c.width = GLYPH.count * GLYPH.w; c.height = GLYPH.h;
  var g = c.getContext('2d');
  g.drawImage(this.sheet, 0, 0);
  g.globalCompositeOperation = 'source-in';
  /* colorIdx 가 '#rrggbb' 문자열이면 그 색으로 직접 틴팅(리마스터 지정색), 아니면 팔레트 인덱스. */
  g.fillStyle = (typeof colorIdx === 'string' && colorIdx.charAt(0) === '#') ? colorIdx : this.color(colorIdx);
  g.fillRect(0, 0, c.width, c.height);
  /* ★★★ **글자도 스케일러** (2026-09-24 · Z-44 — 사장님: 「글자에도 적용.」)
   *   시트는 5×5 글자가 빈틈없이 붙어 있어 통째로 거르면 **옆 글자가 번진다.**
   *   ⇒ 글자 칸마다 따로 걸러 N배 시트에 앉힌다. `논리w` 를 달아 두면
   *     `Hud.text` 의 9인자 drawImage(논리 소스) 를 몽키패치가 N배로 환산한다. */
  /* ☠ 2026-09-26 — 작은 글자는 스케일러에서 뺀다 (사장님 「스케일러 관련해서 작은 글자는 빼는게 좋겠어」 ·
   *   고르심: 「숫자 (아주 작은 글꼴), 마법 링커맨드에 나오는 마법 이름 같은 작은 영문」 · 「전투 스테이터스창의 직업 영문도」).
   *   셋 다 이 TEXT.CHR 시트(Hud.text)다. 시트는 원래 크기로 두고 Hud.text 가 부드럽게 하기를 끄고 찍는다. 한글(NEWHAN)은 그대로 거른다.
   *   아래 Z-44 갈래는 «작은글자필터» 설정이 참일 때만 돈다(되돌릴 수 있게 남긴다). */
  var S = root.G2Scaler;
  if (S && S.N && S.N() > 1 && S.toCanvas && root.__작은글자필터) {
    var N = S.N(), 큰 = document.createElement('canvas');
    큰.width = c.width * N; 큰.height = c.height * N;
    var 큰g = 큰.getContext('2d');
    for (var gi = 0; gi < GLYPH.count; gi++) {
      var 칸 = g.getImageData(gi * GLYPH.w, 0, GLYPH.w, GLYPH.h);
      큰g.drawImage(S.toCanvas(칸), gi * GLYPH.w * N, 0, GLYPH.w * N, GLYPH.h * N);   /* 5인자 — 그대로 */
    }
    큰.논리w = c.width; 큰.논리h = c.height;
    c = 큰;
  }
  this.tints[key] = c;
  return c;
};

/* ═══════════════════════════════════════════════ 4. HUD */

function Hud() {
  this.assets = new Assets();
  this.canvas = null;
  this.ctx = null;
  this.scale = 1;
  this.scaleX = 1;
  this.scaleY = 1;
  this.battle = null;
  this.opts = {};

  this.phase = 'player';           // byte[0xF042E] 1/2/3 에 해당
  this.message = '';               // 정보 바에 띄울 글
  this.messageUnit = null;         // 자리를 정하는 기준 유닛 (0x4B4DF)
  this.status = null;              // 스테이터스 창에 띄운 유닛
  this.statusPage = 0;             // 0 기본 · 1 MORE 2페이지 (0x48863)
  this.aiUnit = null;              // AI 설정 바(0x4B4CA)를 세울 유닛
  this.cursor = null;              // {x,y} 논리 화면 커서 — 구체 회피 판정용

  this.orbMode = 'clock';          // byte[0xF042F] == 1 → 시계, 아니면 행동력
  this.orbAnchor = { x: ORB.home.x, y: ORB.home.y };
  this._orbCX = 0;                 /* [정본 373 ⑥] 위 자리는 4:3(확장 폭 0) 기준 — 첫 그리기에서 확장 폭만큼 옮긴다 */
  this.ap = 0;                     // word[0xF0428]
  this.orbUnit = null;             // 구슬이 보여 주는 유닛 (0x19FAB 이 채우는 대상)
  this.apTarget = null;            // 깎기 연출 목표 (0x45B4E)
  this.anim = null;                // 여닫기 애니 {frames, i, acc}
}

/* ── 초기화 ──────────────────────────────────────────────────────────── */

/**
 * @param {HTMLCanvasElement|HTMLElement} target 캔버스면 그대로, 아니면 안에 하나 만듭니다
 * @param {object} battle  G2State.Battle
 * @param {object} opts
 *   base     자산 폴더. 기본 '자산/'
 *   margins  좌우 16px 여백을 색 0 으로 지울지. 기본 true (원본 0x45443/0x4545D)
 *   fit      화면 크기에 맞춰 정수 배율로 얹을지. 기본 true
 *   onReady  자산을 다 읽으면 부릅니다
 */
Hud.prototype.init = function (target, battle, opts) {
  this.opts = opts || {};
  this.battle = battle || null;

  if (typeof document !== 'undefined' && target) {
    if (target.tagName === 'CANVAS') {
      this.canvas = target;
    } else {
      /* ★★★★★ **다시 부를 수 있어야 한다** (2026-08-24)
       *   `G2화면자원세우기()` 가 **진입마다** `init()` 을 부르므로,
       *   그때마다 캔버스를 새로 만들어 붙이면 `#hud` 안에 **캔버스가 쌓인다**
       *   (실측: 두 번째 진입에서 자식이 2개). 이미 그 안에 우리가 만든 것이 있으면
       *   **그대로 다시 쓴다.** 그래야 세 진입 경로가 같은 결과를 낸다. */
      var 있던것 = target.querySelector('canvas');
      if (있던것) {
        this.canvas = 있던것;
      } else {
        this.canvas = document.createElement('canvas');
        target.appendChild(this.canvas);
      }
    }
    this._표시준비();
    if (this.opts.fit !== false) { this.fit(); }
  }

  var self = this;
  this.assets.load(this.opts.base || '자산/', function (err) {
    if (self.opts.onReady) self.opts.onReady(err, self);
  });
  return this;
};

/**
 * 캔버스 백킹스토어를 **지금 논리 폭**(`logicalW`)으로 다시 잡습니다.
 * 백킹스토어만 스케일러 배율만큼 키우고, 그리는 좌표는 논리 그대로.
 * (스케일러 꺼짐이면 N=1 이라 예전과 완전히 동일하다.)
 * ※ `canvas.width` 대입은 컨텍스트를 초기화하므로 **그리기 전에** 부릅니다.
 */
Hud.prototype._표시준비 = function () {
  if (!this.canvas) return this;
  var LW = this.logicalW || VIEW.w, LH = this.logicalH || VIEW.h;   /* ★ 세로도 확장 (㉛) */
  if (root.G2Scaler) {
    this.ctx = root.G2Scaler.prepare(this.canvas, LW, LH);
    this.canvas.style.imageRendering = root.G2Scaler.rendering();
  } else {
    this.canvas.width = LW; this.canvas.height = LH;
    this.canvas.style.width = LW + 'px'; this.canvas.style.height = LH + 'px';
    this.canvas.style.imageRendering = 'pixelated';
    this.ctx = this.canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;
  }
  return this;
};

/** 링과 같은 방식 — 화면 한가운데에 정수 배율로 얹습니다. */
Hud.prototype.fit = function () {
  if (!this.canvas || typeof root.innerWidth !== 'number') return this;
  /* ★ 전투 틀 크기(전체화면이면 화면비 틀 · Z-94) — 없으면 창 */
  var 틀 = (typeof root.G2전투틀 === 'function') ? root.G2전투틀() : null;
  if (틀 && 틀.w > 0 && 틀.h > 0) return this.fitViewport(틀.w, 틀.h);
  return this.fitViewport(root.innerWidth, root.innerHeight);
};

/**
 * 원본 320×200 HUD 를 창에 얹습니다.
 *
 * ★ 예전에는 가로 `w/320` · 세로 `h/200` 으로 **따로** 늘였습니다. 창이 4:3 보다
 *   넓으면 두 값이 벌어져 HUD 가 가로로 부풀고, 스테이터스 창은 화면을 꽉 채워
 *   초상화 액자가 그림에서 벗어나고 글자가 배경 위로 넘칩니다.
 *   (1920×855 에서 가로 6.00배 · 세로 4.275배)
 *
 *   원작은 320×200 한 화면이라 배율이 하나뿐입니다. **세로에 맞춰 균등 확대**하고
 *   가로는 가운데 정렬합니다. 남는 좌우에는 맵이 그대로 보이므로 검은 띠는
 *   생기지 않습니다.
 */
Hud.prototype.fitViewport = function (w, h) {
  if (!this.canvas) return this;
  /* ★★★ 배율은 **세로에 맞추되, 가로가 모자라면 가로에 맞춘다** (2026-08-28).
   *
   *   전에는 `h / 200` 하나뿐이었다. 원작 화면비는 320:200 = **1.6** 인데
   *   창이 그보다 세로로 길면 `320 × s > w` 가 되어 **원본 화면 좌우가 잘렸다.**
   *   실측 — 사용자 창 1207×765 (1.578):
   *     `s = 3.825` · `320 × 3.825 = 1224 > 1207` ⇒ `canvasX = −8`
   *     ⇒ 장식 기둥이 좌우 8px 씩 창 밖으로 나가 있었다.
   *
   *   `min` 으로 바꾸면 그런 창에서 세로에 11px 남는데, 그만큼 **가로 확장**
   *   (`LW`)이 커져 맵이 더 들어오므로 좌우는 여전히 꽉 찬다.
   *   창이 가로로 넓을 때(대부분)는 `h / 200` 이 그대로 골라져 예전과 같다. */
  var s = Math.max(0.01, Math.min(w / VIEW.w, h / VIEW.h));
  this.scaleX = this.scaleY = this.scale = s;

  /* ★★★ [리마스터 **I-11**] **고정 해상도 · 화면 비율** (2026-09-02)
   *
   *   사용자 지정 — 「둘 다 넣고 설정에서 고르게」. 기본은 **자동 · 또렷하게**라
   *   아래는 **고르지 않으면 한 줄도 안 탄다**(1:1 포팅이 먼저다 — `CLAUDE.md` §6).
   *
   *   원본은 **VGA 모드 13h 320×200** 이고(`0x230AB mov ecx, 0xA0000` ·
   *   `0x1DDD4 edx = 0x3C7` DAC), 픽셀이 **정사각이 아니다** — 4:3 화면에 늘려
   *   1 : 1.2 로 보인다. 그래서 갈래가 둘이다:
   *     `또렷하게`  정수배만        — 픽셀이 안 뭉갠다
   *     `브라운관`  세로만 ×1.2     — 원본 CRT 모습. 가로줄이 4/5 px 로 번갈아 간다
   *   ★ 창보다 크면 **줄여서** 넣는다 — 잘리는 것보다 낫다(위 `min` 과 같은 뜻). */
  try {
    var _O = root.G2Opt;
    var _크 = _O && _O.화면크기 && _O.화면크기(_O.cfg);
    if (_크) {
      var _맞 = Math.min(1, Math.min(w / _크.w, h / _크.h));   // 창을 넘으면 줄인다
      this.scaleX = (_크.배 * _맞);
      this.scaleY = (_크.세로배 * _맞);
      /* ☠ **`s` 도 함께 갈아야 한다** — 아래 `canvasX`·`cx`·`transform` 이 전부
       *   지역 변수 `s` 를 쓴다. `this.scale` 만 바꾸면 **가로가 옛 값으로 남는다**
       *   (실측에서 `scale(4.245, 4)` 처럼 가로만 자동값이 남았다). */
      s = this.scaleX;
      this.scale = s;                                           // 가로 기준(좌표계는 320)
    }
  } catch (e해상도) { /* 설정 모듈이 없으면 자동 그대로 */ }

  /* ★ [리마스터 N-13] 화면 프레임 확장 — 논리 폭을 창에 맞춰 늘립니다.
   *   원작은 320×200 한 화면이라 사기바(y0)·턴바(y196)·장식 기둥이 320 폭에
   *   딱 맞았습니다. 넓은 창에서는 그 320 이 가운데 떠 있고 좌우가 비어,
   *   바와 기둥이 화면 끝이 아니라 **안쪽에** 걸립니다.
   *   그래서 캔버스 논리 폭만 `LW` 로 늘리고, 그리기 원점을 `cx` 만큼 밀어
   *   **원본 320 좌표는 한 자리도 안 바꿉니다.** 늘어난 좌우는 확장 그리기
   *   (`wideBar`·`clearMargins`)가 채웁니다.
   *   `opts.확장 === false` 면 예전과 완전히 동일(LW=320, cx=0). */
  var LW = VIEW.w, LH = VIEW.h;
  if (this.opts && this.opts['확장'] === false) { LW = VIEW.w; LH = VIEW.h; }
  else {
    LW = Math.max(VIEW.w, Math.ceil(w / s));
    /* ★★★ **세로도 같은 수법으로 늘린다** (2026-08-28 · ㉛)
     *
     *   사용자 지정: 「기본 게임화면은 … **창 크기에 따라 그 비율이 달라져야해.**
     *   창 크기에 따라 **확장 또는 축소**해서 보여져야해.」
     *
     *   가로에서 `LW`/`cx` 로 한 것과 똑같다 — 논리 높이만 `LH` 로 늘리고
     *   그리기 원점을 `cy` 만큼 내려 **원본 200 좌표는 한 자리도 안 바꾼다.**
     *   화면 위·아래 끝에 붙는 것(사기바 `y=0` · 턴 게이지 `y=196`)만
     *   `cy` 로 옮긴다 — 가로에서 `wideBar` 가 한 것과 같다.
     *
     *   ★ 대부분의 창은 320:200 보다 가로로 넓어 `LH === 200` 이고 `cy === 0` 이다.
     *     그때는 예전과 **완전히 같다.** */
    LH = Math.max(VIEW.h, Math.ceil(h / s));
  }
  if (LW !== this.logicalW || LH !== this.logicalH) {
    this.logicalW = LW; this.logicalH = LH; this._표시준비();
  }
  this.cx = (LW - VIEW.w) >> 1;
  this.cy = (LH - VIEW.h) >> 1;

  /* 캔버스 자체의 화면 왼쪽 끝. 확장이면 거의 0(홀수 반올림분만 남습니다). */
  this.canvasX = Math.round((w - LW * s) / 2);
  /* ★ `offsetX` 의 뜻은 그대로 **원본 320 논리 원점의 화면 좌표**입니다.
   *   링·마법이름·대사창이 이 값에 붙어 있으므로 의미를 바꾸면 전부 어긋납니다. */
  this.offsetX = this.canvasX + this.cx * s;
  /* ★ 캔버스 자체의 화면 위 끝. 확장이면 거의 0(홀수 반올림분만 남는다).
   *   ★ [I-11] 세로 배율이 따로면(브라운관) **그 배율로** 가운데를 잡는다. */
  var _sy = (this.scaleY && this.scaleY !== s) ? this.scaleY : s;
  this.canvasY = Math.round((h - LH * _sy) / 2);
  /* ★ `offsetY` 의 뜻은 `offsetX` 와 같다 — **원본 200 논리 원점의 화면 y**.
   *   대사창(`dlgcv`)이 이 값에 붙어 있으므로 의미를 바꾸면 어긋난다. */
  this.offsetY = this.canvasY + this.cy * _sy;      // ★ [I-11] 세로 배율(`_sy`)로
  this.canvas.style.position = this.canvas.style.position || 'absolute';
  this.canvas.style.left = this.canvasX + 'px';
  /* ★ 캔버스는 **확장된 논리 크기 전체**를 담으므로 `canvasY` 에 붙인다.
   *   (`offsetY` 는 그 안의 원본 200 원점이라 값이 다르다) */
  this.canvas.style.top = this.canvasY + 'px';
  this.canvas.style.transformOrigin = '0 0';
  /* ★ [I-11] 세로 배율이 가로와 다르면(=「옛날 브라운관처럼」) **두 값을 따로** 준다.
   *   같으면 예전 그대로 `scale(s)` 하나다 — 기본(또렷하게)에서는 아무것도 안 바뀐다. */
  this.canvas.style.transform = (this.scaleY && this.scaleY !== s)
    ? ('scale(' + s + ',' + this.scaleY + ')')
    : ('scale(' + s + ')');
  return this;
};

/**
 * ★ [리마스터 N-13] 확장된 화면의 **좌·우 끝**을 원본 320 좌표계로 돌려줍니다.
 *
 * `draw()` 가 `translate(cx,0)` 을 걸어 두므로, 그 안에서는 화면 왼쪽 끝이
 * `−cx` · 오른쪽 끝이 `320+cx` 이고 **가운데는 여전히 160** 입니다.
 * 폭을 꽉 채우던 것(정보 바 띠 · 안내 상자 띠 · 대사창 음영)은 이 값을 씁니다.
 * 확장이 없으면 `{L:0, R:320, W:320}` 이라 예전과 완전히 같습니다.
 */
Hud.prototype.화면끝 = function () {
  var CX = this.cx | 0;
  return { L: -CX, R: VIEW.w + CX, W: this.logicalW || VIEW.w };
};

/**
 * HUD가 소유한 viewport 계산 결과의 읽기 전용 스냅샷.
 * 외부 모듈은 스케일러 내부 필드를 직접 읽지 않고 이 창구만 사용한다.
 */
Hud.prototype.viewportState = function () {
  return Object.freeze({
    scale: this.scale || 1,
    scaleX: this.scaleX || this.scale || 1,
    scaleY: this.scaleY || this.scale || 1,
    logicalW: this.logicalW || VIEW.w,
    logicalH: this.logicalH || VIEW.h,
    cx: this.cx | 0,
    cy: this.cy | 0,
    canvasX: this.canvasX | 0,
    canvasY: this.canvasY | 0,
    offsetX: this.offsetX | 0,
    offsetY: this.offsetY | 0
  });
};

/** HUD와 같은 논리 화면 캔버스를 viewport 스냅샷에 맞춰 놓는다. */
Hud.prototype.논리캔버스놓기 = function (canvas, viewport) {
  if (!canvas || !canvas.style || !viewport) return false;
  var s = viewport.scale || 1;
  canvas.style.left = (viewport.offsetX | 0) + 'px';
  canvas.style.top = (viewport.offsetY | 0) + 'px';
  canvas.style.transform = 'scale(' + s + ')';
  return s;
};

/** 논리 화면 캔버스를 표시한다. */
Hud.prototype.논리캔버스보이기 = function (canvas) {
  if (!canvas || !canvas.style) return false;
  canvas.style.display = 'block';
  return true;
};

/** 표시 중인 논리 캔버스를 먼저 비우고 숨긴다. */
Hud.prototype.논리캔버스비우고숨기기 = function (canvas, ctx, w, h) {
  if (!canvas || !canvas.style || canvas.style.display === 'none') return false;
  if (ctx && ctx.clearRect) ctx.clearRect(0, 0, w, h);
  canvas.style.display = 'none';
  return true;
};

/** 링 입력면과 상태창 차단막의 표시·입력 상태를 같은 순서로 반영한다. */
Hud.prototype.링화면상태반영 = function (ringCanvas, ringShade, open, shaded) {
  if (!ringCanvas || !ringCanvas.style || !ringShade || !ringShade.style) return false;
  ringCanvas.style.display = open ? 'block' : 'none';
  ringCanvas.style.pointerEvents = open ? 'auto' : 'none';
  ringShade.style.display = shaded ? 'block' : 'none';
  ringShade.style.pointerEvents = shaded ? 'auto' : 'none';
  return true;
};

/** 전투 무대가 현재 화면 셸에서 활성 표시 상태인지 읽는다. */
Hud.prototype.전투무대보이나 = function (stage) {
  if (!stage) return false;
  return stage.style.display !== 'none';
};

/** 개발용 BattleFreeze 상태 클래스를 전투 무대에 반영한다. */
Hud.prototype.전투무대정지표시 = function (stage, 멈춤) {
  if (!stage || !stage.classList) return false;
  if (멈춤) stage.classList.add('g2-test-frozen');
  else stage.classList.remove('g2-test-frozen');
  return true;
};

/** 대사창의 권위 상태를 우선 읽고, 없는 독립 하네스에서만 계산된 DOM 표시로 물러난다. */
Hud.prototype.대사창떠있나 = function (dialogue) {
  if (dialogue && typeof dialogue.isShown === 'function') return !!dialogue.isShown();
  if (typeof document === 'undefined') return false;
  var d = document.getElementById('dlgcv');
  if (!d) return false;
  try { return getComputedStyle(d).display !== 'none'; }
  catch (e) { return d.style.display !== 'none'; }
};

/** 날씨·비Renderer 폴백을 그리는 전투 효과 캔버스를 기존 표시 상태로 둔다. */
Hud.prototype.전투효과캔버스보이기 = function (canvas) {
  if (!canvas || !canvas.style) return false;
  canvas.style.display = 'block';
  return true;
};

/** 원소 중복 안내 요소를 원본/리마스터 표시 규약으로 초기화한다. */
Hud.prototype.속성중복안내초기화 = function (e, 리마스터) {
  if (!e || !e.style) return false;
  e.style.cssText = 리마스터
    ? 'position:fixed;left:50%;top:14%;transform:translateX(-50%);z-index:99998;' +
      'font:14px/1.3 sans-serif;color:#fff;background:rgba(0,0,0,.72);' +
      'padding:4px 10px;border-radius:3px;pointer-events:none;white-space:pre;'
    : 'position:fixed;left:0;top:0;z-index:99998;' +
      'font:12px/1.1 monospace;color:#fff;background:#000;' +
      'padding:1px 3px;pointer-events:none;white-space:pre;';
  return true;
};

/** 원소 중복 안내 요소를 만들고 문구·표시 규약 반영 뒤 화면에 붙인다. */
Hud.prototype.속성중복안내열기 = function (문구, 리마스터) {
  if (typeof document === 'undefined' || !document.body) return null;
  var e = document.createElement('div');
  e.textContent = 문구;
  this.속성중복안내초기화(e, !!리마스터);
  document.body.appendChild(e);
  return e;
};

/** 원소 중복 안내 요소를 화면에서 제거한다. */
Hud.prototype.속성중복안내닫기 = function (e) {
  if (!e || !e.parentNode) return false;
  e.parentNode.removeChild(e);
  return true;
};

/** 화면 전환 페이드 덮개의 고정 표시 규약을 초기화한다. */
Hud.prototype.전환페이드덮개초기화 = function (e) {
  if (!e || !e.style) return false;
  e.style.cssText = 'position:absolute;left:0;top:0;right:0;bottom:0;' +
    'pointer-events:none;z-index:99999;mix-blend-mode:multiply;background:rgb(255,255,255)';
  return true;
};

/** 전환 페이드 덮개를 현재 무대에 한 번 만들고 표시한다. */
Hud.prototype.전환페이드덮개열기 = function () {
  if (typeof document === 'undefined') return null;
  var 무대 = document.getElementById('무대') || document.body;
  if (!무대) return null;
  var e = document.getElementById('전환페이드');
  if (!e) {
    e = document.createElement('div');
    e.id = '전환페이드';
    this.전환페이드덮개초기화(e);
    무대.appendChild(e);
  }
  e.style.display = 'block';
  return e;
};

/** 전환 페이드의 현재 원본 강도 색을 덮개에 반영한다. */
Hud.prototype.전환페이드색반영 = function (e, 색) {
  if (!e || !e.style) return false;
  e.style.background = 색;
  return true;
};

/** 새 화면 진입 때 전환 페이드 덮개를 숨기고 흰색으로 복원한다. */
Hud.prototype.전환페이드덮개끄기 = function () {
  if (typeof document === 'undefined') return false;
  var e = document.getElementById('전환페이드');
  if (!e || !e.style) return false;
  e.style.display = 'none';
  e.style.background = 'rgb(255,255,255)';
  return true;
};

/** 스케일러 전환 차단막의 세 화면 요소를 종류별 고정 스타일로 초기화한다. */
Hud.prototype.스케일러전환요소초기화 = function (e, 종류) {
  if (!e || !e.style) return false;
  if (종류 === '막') {
    e.style.cssText = 'position:absolute;inset:0;display:none;z-index:95;' +
      'background:#000;pointer-events:auto;';
  } else if (종류 === '그림') {
    e.style.cssText = 'position:absolute;inset:0;background-position:center;' +
      'background-repeat:no-repeat;background-size:contain;image-rendering:pixelated;';
  } else if (종류 === '오류') {
    e.style.cssText = 'position:absolute;left:0;right:0;bottom:8%;display:none;' +
      'text-align:center;font:13px/1.7 monospace;color:#ffd166;text-shadow:0 1px 2px #000;';
  } else return false;
  return true;
};

/** 스케일러 전환 차단막의 DOM 구조와 탈출 버튼을 화면 셸에 한 번 조립한다. */
Hud.prototype.스케일러전환막열기 = function (stage, 새로고침) {
  if (typeof document === 'undefined' || !stage) return null;
  var 막 = document.createElement('div');
  막.id = 'g2-scaler-gate';
  this.스케일러전환요소초기화(막, '막');
  var 그림 = document.createElement('div');
  this.스케일러전환요소초기화(그림, '그림');
  막.appendChild(그림);
  막._im = 그림;
  var 오류 = document.createElement('div');
  this.스케일러전환요소초기화(오류, '오류');
  오류.innerHTML =
    '<div data-말></div>' +
    '<div style="margin-top:10px">' +
    '<button data-다시 style="margin:0 4px;padding:4px 10px">이전 값으로 다시</button>' +
    '<button data-안전 style="margin:0 4px;padding:4px 10px">기본(none)으로</button>' +
    '<button data-새로 style="margin:0 4px;padding:4px 10px">새로고침</button></div>';
  막.appendChild(오류);
  막._오류 = 오류;
  오류.querySelector('[data-다시]').onclick = function () { if (막._재시도) 막._재시도('이전'); };
  오류.querySelector('[data-안전]').onclick = function () { if (막._재시도) 막._재시도('none'); };
  오류.querySelector('[data-새로]').onclick = function () { if (새로고침) 새로고침(); };
  stage.appendChild(막);
  return 막;
};

/** 원작 로딩 그림의 해독 URL을 전환막 그림 요소에 반영한다. */
Hud.prototype.스케일러전환그림반영 = function (그림, url) {
  if (!그림 || !그림.style) return false;
  그림.style.backgroundImage = 'url(' + url + ')';
  return true;
};

/** 스케일러 전환 차단막을 보이고 이전 오류 안내를 지운다. */
Hud.prototype.스케일러전환막보이기 = function (막) {
  if (!막 || !막.style) return false;
  막.style.display = 'block';
  if (막._오류 && 막._오류.style) 막._오류.style.display = 'none';
  return true;
};

/** 스케일러 전환 차단막과 오류 안내를 함께 감춘다. */
Hud.prototype.스케일러전환막숨기기 = function (막) {
  if (!막 || !막.style) return false;
  막.style.display = 'none';
  if (막._오류 && 막._오류.style) 막._오류.style.display = 'none';
  return true;
};

/** 복구 실패 안내를 차단막 위에 표시한다. */
Hud.prototype.스케일러전환오류보이기 = function (막, 말) {
  if (!막 || !막.style || !막._오류 || !막._오류.style) return false;
  막.style.display = 'block';
  막._오류.style.display = 'block';
  var 문구 = 막._오류.querySelector('[data-말]');
  if (문구) 문구.textContent = 말;
  return true;
};

/** 재시도 직전에 복구 실패 안내만 감춘다. */
Hud.prototype.스케일러전환오류숨기기 = function (막) {
  if (!막 || !막._오류 || !막._오류.style) return false;
  막._오류.style.display = 'none';
  return true;
};

/** 차단막의 현재 표시 상태를 화면 셸 안에서 읽는다. */
Hud.prototype.스케일러전환막보이나 = function (막) {
  return !!(막 && 막.style && 막.style.display === 'block');
};

/** HUD 렌더 표면 참조. viewport 수치와 DOM 소유권을 섞지 않는다. */
Hud.prototype.hudCanvas = function () { return this.canvas || null; };

/** 화면 좌표 → 논리 320×200 좌표. (확장분 `cx` 를 빼서 원본 좌표계로 돌립니다) */
Hud.prototype.toLogical = function (clientX, clientY) {
  if (!this.canvas) return { x: clientX, y: clientY };
  var r = this.canvas.getBoundingClientRect();
  return { x: Math.floor((clientX - r.left) / this.scaleX) - (this.cx || 0),
           y: Math.floor((clientY - r.top) / this.scaleY) };
};

/* ── 낱개 그리기 도구 ─────────────────────────────────────────────────── */

/** 스프라이트 한 장. `앵커적용` 이 true 인 프레임만 앵커를 더합니다 (0x5F3FD 는 안 더합니다). */
Hud.prototype.blit = function (ctx, file, n, x, y, useAnchor) {
  var f = this.assets.frame(file, n);
  if (!f) return false;
  var im = this.assets.image(f.png);
  if (!im || !im.complete || !im.naturalWidth) return false;
  var ax = 0, ay = 0;
  if (useAnchor == null ? f['앵커적용'] : useAnchor) { ax = f['앵커'][0]; ay = f['앵커'][1]; }
  ctx.drawImage(im, x + ax, y + ay);
  return true;
};

/** 색 채우기 — 0x5EDDE 사각 채우기와 같습니다(양끝 포함). */
Hud.prototype.fillRect = function (ctx, x1, y1, x2, y2, colorIdx) {
  ctx.fillStyle = this.assets.color(colorIdx);
  ctx.fillRect(x1, y1, x2 - x1 + 1, y2 - y1 + 1);
};

/** 가로선 — 0x5EC44. 길이 ≤ 0 이면 아무것도 안 합니다. */
Hud.prototype.hline = function (ctx, x, y, len, colorIdx) {
  if (len <= 0) return;
  ctx.fillStyle = this.assets.color(colorIdx);
  ctx.fillRect(x, y, len, 1);
};

/**
 * TEXT.CHR 소형 폰트 — 0x608E6.
 * @param {number} spacing 자간. 기본 1 → 글자 간격 6px
 */
Hud.prototype.text = function (ctx, s, x, y, colorIdx, spacing) {
  s = String(s == null ? '' : s);
  var sp = (spacing == null ? 1 : spacing);
  var sheet = this.assets.tinted(colorIdx);
  if (!sheet) return x;
  /* 작은 글자는 확대 필터 없이 또렷하게 — 시트가 원래 크기면 부드럽게 하기를 끈다 (tinted 주석 · 2026-09-26) */
  var 옛부드 = ctx.imageSmoothingEnabled;
  if (!sheet.논리w) ctx.imageSmoothingEnabled = false;
  for (var i = 0; i < s.length; i++) {
    var g = glyphIndex(s.charCodeAt(i));
    if (g > 0 && g < GLYPH.count) {
      ctx.drawImage(sheet, g * GLYPH.w, 0, GLYPH.w, GLYPH.h, x, y, GLYPH.w, GLYPH.h);
    }
    x += GLYPH.w + sp;                        // 0x608E6 은 안 찍어도 전진합니다
  }
  ctx.imageSmoothingEnabled = 옛부드;
  return x;
};

/** 오른쪽 정렬 (창 안 값 칸에 씁니다). */
Hud.prototype.textRight = function (ctx, s, xRight, y, colorIdx, spacing) {
  s = String(s == null ? '' : s);
  return this.text(ctx, s, xRight - textAdvance(s, spacing), y, colorIdx, spacing);
};

/**
 * 4방향 그림자 글씨 — 0x484F9. 그림자 색은 0x48525 의 규칙(shadowColor)을 씁니다.
 *
 * ★★★★★ **가운데 글자 색도 읽었다** — `0x485B8`~`0x485E3` (2026-09-03)
 *
 *   `di` 는 위 `0x48525` 가 만든 **밝기 단계**다. 그것으로 가운데 색을 다시 정한다:
 *   ```asm
 *   0x485B8  cmp di,9 / jle 0x485D6
 *   0x485BE    di > 9  → 색 = di + 6            ; 0x485C5
 *   0x485CA    그 값이 0x11(17) 보다 크면
 *   0x485D0      → **[esp+0x24] 로 되돌린다**   ; ★ 곧 **처음 준 색 그대로**
 *   0x485D6  cmp di,7 / jle 0x485E8
 *   0x485DC    7 < di ≤ 9 → 색 = di + 0x39(57)  ; 0x485DE
 *   0x485E8  (di ≤ 7 이면 손대지 않는다)
 *   ```
 *   ★ `[esp+0x24]` 는 진입에서 `push esi/edi/ebp` + `sub esp,0xC` + `push eax/edx` 로
 *     밀린 자리라 **원래 `ecx`(부르는 쪽이 준 색)** 다.
 *
 *   ⇒ **`di ≤ 7` 이면 준 색 그대로**다. 8·9 는 `+57`, 10 이상은 `+6`(단 17 초과면 원래 색).
 *   ☐ 우리가 지금 쓰는 자리는 전부 `di ≤ 7` 범위라 **준 색 그대로가 맞다** —
 *     8 이상을 쓰는 자리가 생기면 위 식을 넣어야 한다.
 */
/* ★★★★★ **외곽선 색을 따로 줄 수 있다** (2026-09-07 · 사장님 지적 M35)
 *
 *   > 사장님: 「마법 이름뜨는 것도 원본과 달라 우리는 글자만 뜨고
 *   >  **원본은 반짝이는것 같은 효과**가 있어」
 *
 *   원본 `0x484F9` 의 외곽선 넷(`0x4856D`·`0x48583`·`0x48599`·`0x485B3`)은
 *   **본문과 같은 단계 색**을 받는다 — 그림자색이 아니다.
 *   ☠ 여기 `shadowColor(colorIdx)` 는 **다른 함수**(`0x4868A` 그림자 글씨 · 그림자 색 6 고정)의
 *     성질이다. 이미 여러 자리가 그 모양으로 쓰고 있어 **기본 동작은 그대로 두고**,
 *     **일곱째 인자로 외곽선 색을 주면 그것을 쓴다.**
 *   ⇒ 마법 이름 외치기(`0x28889`)가 이 길로 원본과 같아진다.
 *   조사: `03_분석/_보관/끝난조사/00_지금조사_마법이름.md`
 *
 * @param {number} [외곽선색]  주면 외곽선 넷을 이 색으로 (원본 `0x484F9`). 없으면 옛 동작.
 */
Hud.prototype.textOutlined = function (ctx, s, x, y, colorIdx, spacing, 외곽선색) {
  s = String(s == null ? '' : s);
  /* ★ 0x48513 `imul ecx, 글자수, 3` → 0x4851A `sub edx, ecx`
   *   곧 **주어진 x 는 가운데**입니다. 왼쪽 정렬로 찍으면 글자 수만큼 오른쪽으로
   *   밀려 보입니다 — 상태창·AI 바의 숫자가 어긋나 보이던 원인입니다. */
  x = x - s.length * 3;
  var sh = (외곽선색 != null) ? 외곽선색 : shadowColor(colorIdx);
  this.text(ctx, s, x - 1, y, sh, spacing);
  this.text(ctx, s, x + 1, y, sh, spacing);
  this.text(ctx, s, x, y - 1, sh, spacing);
  this.text(ctx, s, x, y + 1, sh, spacing);
  return this.text(ctx, s, x, y, colorIdx, spacing);
};

/**
 * 그림자 글씨 (왼쪽 정렬 · 그림자 색 **6 고정**) — 0x4868A.
 *
 * 0x484F9 와 얼굴이 비슷하지만 두 가지가 다릅니다.
 *   ① `x` 를 그대로 씁니다 (가운데 정렬 안 함)
 *   ② 그림자 색이 계산값이 아니라 **6** 입니다 (0x486BC/0x486D3/0x486E9/0x486FF `push 6`)
 * 스테이터스 창의 LV / HP / MP / EXP 숫자가 이쪽입니다.
 */
Hud.prototype.textShadow6 = function (ctx, s, x, y, colorIdx, spacing) {
  this.text(ctx, s, x - 1, y, 6, spacing);
  this.text(ctx, s, x + 1, y, 6, spacing);
  this.text(ctx, s, x, y - 1, 6, spacing);
  this.text(ctx, s, x, y + 1, 6, spacing);
  return this.text(ctx, s, x, y, colorIdx, spacing);
};

/**
 * 한글 — 원본은 조합형 폰트(NEWHAN.FNT)를 씁니다. 지금은 캔버스 기본 폰트로 찍습니다.
 * 나중에 조합형 폰트로 갈아 끼우려면 G2Hud.setKoreanFont(fn) 하나만 바꾸면 됩니다.
 * fn(ctx, s, x, y, cssColor, size)
 */
Hud.prototype.korean = function (ctx, s, x, y, colorIdx, size) {
  var css = this.assets.color(colorIdx);
  if (this._korean) return this._korean(ctx, s, x, y, css, size || 9);
  ctx.save();
  ctx.font = (size || 9) + 'px "맑은 고딕","Malgun Gothic",sans-serif';
  ctx.textBaseline = 'top';
  ctx.fillStyle = css;
  ctx.fillText(String(s == null ? '' : s), x, y);
  ctx.restore();
  return x;
};
/** 이후 HUD 문자열 그리기에 사용할 한글 그리기 함수를 설정한다. */
Hud.prototype.setKoreanFont = function (fn) { this._korean = fn; return this; };

/**
 * 한글을 **가운데 정렬 + 외곽선**으로 찍습니다.
 * 원본은 NEWHAN.FNT 조합형 비트맵이지만, 리마스터에서는 글꼴만 깔끔한 것을 쓰고
 * 색·크기·자리는 원본에서 잰 값을 그대로 씁니다.
 * @param {number} cx     가운데 x
 * @param {number} y      윗변 y
 */
Hud.prototype.koreanOutlined = function (ctx, s, cx, y, colorIdx, shadowIdx, size, rightX) {
  s = String(s == null ? '' : s);
  if (!s) return this;
  if (this._newhan) return this._조합형글자외곽선(ctx, s, cx, y, colorIdx, shadowIdx, rightX);  // 원작 조합형 픽셀폰트
  size = size || 16;
  ctx.save();
  /* `600` 은 좌표가 아니라 **CSS `font-weight`** 다 — [원본없음] */
  ctx.font = '600 ' + size + 'px "맑은 고딕","Malgun Gothic",sans-serif';
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';
  var sh = this.assets.color(shadowIdx == null ? 0 : shadowIdx);
  ctx.fillStyle = sh;
  ctx.fillText(s, cx - 1, y); ctx.fillText(s, cx + 1, y);
  ctx.fillText(s, cx, y - 1); ctx.fillText(s, cx, y + 1);
  ctx.fillStyle = this.assets.color(colorIdx == null ? 1 : colorIdx);
  ctx.fillText(s, cx, y);
  ctx.restore();
  return this;
};

/** 원본 NEWHAN.FNT(조합형 16×16) 연결 — 이름 등 한글을 원작 픽셀폰트로. (native.js) */
Hud.prototype.setNativeKorean = function (font) { this._newhan = font; return this; };
/** 한글/ASCII 문자열 → 흰색 글리프 마스크 캔버스 {canvas, w}. 한글 16px·ASCII 8px. */
Hud.prototype._조합형글자마스크 = function (s) {
  var G = root.G2Native, font = this._newhan, i, code, w = 0;
  for (i = 0; i < s.length; i++) { code = s.charCodeAt(i); w += (code >= 0xAC00 && code <= 0xD7A3) ? 16 : 8; }
  if (w <= 0 || typeof document === 'undefined') return null;
  /* ★ 정본 400 — 같은 글자(·ASCII 글꼴 있음)면 지난번 마스크를 그대로 · 글꼴이 바뀌거나 400 넘으면 비운다 · 끄기 window.__외곽글자캐시끔
   *   ☠ 대사창(newhanLeft)이 매 장 글자마다 캔버스를 새로 만들고 점 하나하나 fillRect 로 찍었다 — 휴대폰 흉내 1-4 시작 이벤트 5초 중 대사 글자 2초(40%) */
  var 마칸 = null, 마열 = s + '|' + (this._ascii ? 1 : 0);
  if (!root.__외곽글자캐시끔) {
    마칸 = this._마스크캐시;
    if (!마칸 || 마칸._글꼴 !== font) { 마칸 = this._마스크캐시 = new Map(); 마칸._글꼴 = font; }
    var 마있 = 마칸.get(마열); if (마있) return 마있;
  }
  var c = document.createElement('canvas'); c.width = w; c.height = 16;
  var g = c.getContext('2d'); g.fillStyle = '#fff';
  var x = 0;
  for (i = 0; i < s.length; i++) {
    code = s.charCodeAt(i);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      var gl = G.composeSyllable(font, code);
      for (var yy = 0; yy < 16; yy++) { var word = (gl[yy * 2] << 8) | gl[yy * 2 + 1];
        for (var xx = 0; xx < 16; xx++) if (word & (0x8000 >> xx)) g.fillRect(x + xx, yy, 1, 1); }
      x += 16;
    } else if (code < 0x80 && this._ascii) {
      g.drawImage(this._ascii, code * 8, 0, 8, 16, x, 0, 8, 16); x += 8;   // 로드된 NEWASCII 재사용
    } else x += 8;
  }
  c._키 = 'M' + s + (this._ascii ? '|A' : '');      /* Z-44 — 물들인 필터 그림 캐시 키 · 정본 400 — ASCII 글꼴을 읽기 전 그림이 남지 않게 */
  var 마결 = { canvas: c, w: w };
  if (마칸) { if (마칸.size > 400) 마칸.clear(); 마칸.set(마열, 마결); }
  return 마결;
};
/** 원본 마스크를 지정 CSS 색으로 물들인 캐시 캔버스를 반환한다. */
Hud.prototype._마스크색입히기 = function (mask, css) {
  /* ★ 정본 400 — 캐시를 «만들기 전에» 본다 · 1배(스케일러 없음)도 기억한다 · 600 넘으면 비운다 (같은 대사 글자가 매 장 캔버스를 새로 만들어 물들였다) */
  var S0 = root.G2Scaler, 확대0 = !!(S0 && S0.N && S0.N() > 1 && S0.toCanvas), 필0 = 확대0 ? S0.cur() + S0.N() : '1배';
  var 키0 = (!root.__외곽글자캐시끔 && mask._키) ? mask._키 + '|' + css : null;
  if (this._글자색필터 !== 필0) { this._글자색캐시 = {}; this._글자색수 = 0; this._글자색필터 = 필0; }
  if (키0 && this._글자색캐시[키0]) return this._글자색캐시[키0];
  var c = document.createElement('canvas'); c.width = mask.width; c.height = mask.height;
  /* ★ 5인자 — 3인자면 `scaler.js` 몽키패치가 `논리w` 를 보고 **줄여서** 그린다
   *   (`render.js _silhouetteURL` 과 같은 함정. 2026-08-16). */
  var g = c.getContext('2d'); g.drawImage(mask, 0, 0, mask.width, mask.height);
  g.globalCompositeOperation = 'source-in'; g.fillStyle = css; g.fillRect(0, 0, c.width, c.height);
  /* ★ Z-44 (2026-09-24 · 「글자에도 적용」) — 물들인 글자를 지금 필터로 N배 굽는다(`논리w` 가 달려
   *   3인자 drawImage 를 몽키패치가 논리 크기로 눌러 담는다). 매 프레임 불리므로
   *   마스크가 `_키`(문자열·자리)를 달고 오면 (키·색·필터) 로 캐시한다. */
  if (확대0) c = S0.toCanvas(g.getImageData(0, 0, c.width, c.height));
  if (키0) {
    if ((this._글자색수 = (this._글자색수 | 0) + 1) > 600) { this._글자색캐시 = {}; this._글자색수 = 1; }
    this._글자색캐시[키0] = c;
  }
  return c;
};
/** 조합형 픽셀폰트 + 픽셀 외곽선.
 *  rightX 주면 **좌우맞춤**: 우측끝=rightX, 좌측끝=2*cx−rightX(프레임 중심 대칭), 글자 간격 벌려 채움.
 *  rightX 없으면 cx 가운데 정렬. */
Hud.prototype._조합형글자외곽선 = function (ctx, s, cx, y, colorIdx, shadowIdx, rightX) {
  if (typeof document === 'undefined') return this;
  var G = root.G2Native, font = this._newhan, i, code;
  var chars = [], W = 0;
  for (i = 0; i < s.length; i++) { code = s.charCodeAt(i);
    var cw = (code >= 0xAC00 && code <= 0xD7A3) ? 16 : 8; chars.push([code, cw]); W += cw; }
  if (!chars.length) return this;
  var leftX, step = null, lastW = chars[chars.length - 1][1];
  if (rightX != null && chars.length > 1) { leftX = 2 * cx - rightX; step = (rightX - leftX - lastW) / (chars.length - 1); }
  else { leftX = Math.round(cx - W / 2); }
  var maskW = (rightX != null) ? Math.max(1, Math.ceil(rightX - leftX)) : W;
  /* ★ 정본 400 — 같은 글자·폭·간격·두 색·스케일러면 지난번 색 입힌 두 장을 그대로 쓴다
   *   ☠ 매 장 매 글자마다 캔버스를 새로 만들고 점 하나하나 fillRect 로 글자 모양을 만든 뒤 색을 입혔다(스케일러가 없으면 결과도 안 기억)
   *     휴대폰 기록(11-23 · 갤럭시 S24 · 3-4 전투 적 차례) HUD 한 장 평균 65ms · 3초 넘게 15fps · 끄기 window.__외곽글자캐시끔 */
  var 셋S = root.G2Scaler, 셋키 = null, 셋칸 = null;
  var sh색 = this.assets.color(shadowIdx == null ? 0 : shadowIdx), ink색 = this.assets.color(colorIdx == null ? 1 : colorIdx);
  if (!root.__외곽글자캐시끔) {
    셋칸 = this._외곽글자캐시 || (this._외곽글자캐시 = new Map());
    셋키 = s + '|' + maskW + '|' + step + '|' + sh색 + '|' + ink색 + '|' + (셋S && 셋S.cur ? 셋S.cur() + (셋S.N ? 셋S.N() : '') : '') + '|' + (this._ascii ? 1 : 0);
    var 셋 = (셋칸._글꼴 === font) ? 셋칸.get(셋키) : null;
    if (셋) {
      var x0c = Math.round(leftX), 여덟c = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
      for (var c8 = 0; c8 < 8; c8++) ctx.drawImage(셋.sh, x0c + 여덟c[c8][0], y + 여덟c[c8][1]);
      ctx.drawImage(셋.ink, x0c, y);
      return this;
    }
  }
  var mc = document.createElement('canvas'); mc.width = maskW; mc.height = 16;
  var mg = mc.getContext('2d'); mg.fillStyle = '#fff';
  var xseq = 0;
  for (i = 0; i < chars.length; i++) {
    var xp = (step != null) ? Math.round(i * step) : xseq;
    code = chars[i][0];
    if (code >= 0xAC00 && code <= 0xD7A3) { var gl = G.composeSyllable(font, code);
      for (var yy = 0; yy < 16; yy++) { var word = (gl[yy * 2] << 8) | gl[yy * 2 + 1];
        for (var xx = 0; xx < 16; xx++) if (word & (0x8000 >> xx)) mg.fillRect(xp + xx, yy, 1, 1); } }
    else if (code < 0x80 && this._ascii) { mg.drawImage(this._ascii, code * 8, 0, 8, 16, xp, 0, 8, 16); }
    xseq += chars[i][1];
  }
  var x0 = Math.round(leftX);
  mc._키 = 'O' + s + '|' + maskW + '|' + step + (this._ascii ? '|A' : '');      /* Z-44 — 글자·자리가 같으면 같은 그림 · 정본 400 — ASCII 글꼴 읽음 여부도 */
  var sh = this._마스크색입히기(mc, sh색);
  var ink = this._마스크색입히기(mc, ink색);
  if (셋키) {
    if (셋칸._글꼴 !== font || 셋칸.size > 400) { 셋칸.clear(); 셋칸._글꼴 = font; }   /* 글꼴이 바뀌거나 너무 커지면 비운다 */
    셋칸.set(셋키, { sh: sh, ink: ink });
  }
  /* ★★★★★ **외곽선은 8방향이다 — 대각선도 찍는다** (2026-08-25 · `0x5DC38`)
   *
   *   원본 `0x5DBC6` 은 `[0xB75F8]`(모드)로 갈라지고, **모드 4 = 외곽선 글자**다
   *   (분기표는 `cs:0x5DBAE`, 곧 평탄 주소 `0x5DBAE` — `2E` 접두라 코드 베이스 기준).
   *   그 갈래가 좌표를 스택에 만들어 두고 `0x5F6AA` 를 되풀이 부른다:
   *   ```asm
   *   0x5DC6B  lea eax, [ebp-1]   → [esp+0x10] = y−1
   *   0x5DC7A  dec eax            → [esp+0x14] = x−1
   *   0x5DC8D  lea eax, [ebp+1]   → [esp+0x18] = y+1
   *   0x5DC9C  inc eax            → [esp+0x1c] = x+1
   *   0x5DC83  (x−1, y−1)   0x5DCA5  (x+1, y+1)
   *   0x5DCBB  (…)          0x5DCD1  (x+1, y−1)   …  ★ **대각선이 있다**
   *   ```
   *   우리는 상하좌우 **4방향**만 찍어 대각선 모서리가 비어 있었다.
   *
   *   ★ 색 전역 — `0x5DB66(eax = 모드, dx = 색A, bx = 색B)` 이 세운다:
   *     `[0xB75FC] = dx` · `[0xB7604] = bx` (모드 4 는 `0x5DB79` 갈래, 둘 다 지정).
   *     전투 진입 `0x55C25` 가 **모드 4 · dx = 0x1100 · bx = 0xFF**.
   *     ⇒ `0x11`(노랑 246,222,113) + `0x00`(검정)이 사용자 관측과 맞는다.
   *     ★★★★★ **해소 (2026-08-29)** — `0x5F6AA` 는 **두 색을 다 쓴다.**
   *       ```asm
   *       0x5F6D5  mov bl, cl · mov bh, [ebp+8]     ; ★ 색 둘을 bl·bh 에
   *       0x5F6DE  mov dh, [esi] · test dh, 0x80    ; 그 픽셀의 비트
   *       0x5F6E4  cmp bl, 0xFF / je 건너뜀 · mov [edi], bl   ; 비트 1 → 색A
   *       0x5F6EB  cmp bh, 0xFF / je 건너뜀 · mov [edi], bh   ; 비트 0 → 색B
   *       ```
   *       ⇒ 「하위만 쓰는 것 아니냐」는 **기우였다.** 그리고 **`0xFF` 는 투명**이라
   *         `bx = 0xFF` 는 「둘째 색 없음」이라는 뜻이다.
   *         전투 진입의 `dx = 0x1100` · `bx = 0xFF` 가 곧
   *         「색A = `0x11` 노랑 · 색B 없음」이고 관측과 정확히 맞는다.
   *     ★ 색 값 자체는 관측대로 둔다. */
  var 여덟 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
  for (var d8 = 0; d8 < 8; d8++) ctx.drawImage(sh, x0 + 여덟[d8][0], y + 여덟[d8][1]);
  ctx.drawImage(ink, x0, y);
  return this;
};
/** 조합형 픽셀폰트 **좌측정렬** (대사창 등). shadowIdx 주면 1px 외곽선. NEWHAN 없으면 korean 폴백. */
/**
 * ★ 이름 레코드는 **고정 폭**이라 앞·가운데 공백이 실제 정렬 데이터다 (「 미 카 엘」).
 *   원본 `0x5E048` 은 받은 문자열을 그대로 찍는다. 따라서 HUD 계층에서 trim/정규화하지 않는다.
 *   이름 바이트의 복원/검증은 BLACKBOX 경계가 담당하고 화면은 받은 값을 그대로 소비한다.
 */
function 이름_공백정리(s) {
  return String(s == null ? "" : s);
}

/** 조합형 한글 문자열을 왼쪽 기준과 팔레트 외곽선으로 그린다. */
Hud.prototype.newhanLeft = function (ctx, s, x, y, colorIdx, shadowIdx) {
  if (!this._newhan) return this.korean(ctx, s, x, y, colorIdx, 16);
  var m = this._조합형글자마스크(String(s == null ? '' : s)); if (!m) return this;
  /* ★ 외곽선은 **8방향**이다 — 원본 `0x5DC38` 갈래가 대각선까지 찍는다 (2026-08-25).
   *   `_조합형글자외곽선`과 같은 규칙으로 맞춘다. */
  if (shadowIdx != null) {
    /* 색은 팔레트 번호 또는 css 문자열 — 부활 선택창이 STATUS.PCX 색을 그대로 쓴다 (2026-09-26 Z-88) */
    var sh = this._마스크색입히기(m.canvas, typeof shadowIdx === 'string' ? shadowIdx : this.assets.color(shadowIdx));
    var 여덟 = [[-1,-1],[0,-1],[1,-1],[-1,0],[1,0],[-1,1],[0,1],[1,1]];
    for (var d8 = 0; d8 < 8; d8++) ctx.drawImage(sh, x + 여덟[d8][0], y + 여덟[d8][1]);
  }
  ctx.drawImage(this._마스크색입히기(m.canvas, typeof colorIdx === 'string' ? colorIdx
                                    : this.assets.color(colorIdx == null ? 1 : colorIdx)), x, y);
  return this;
};
/** 조합형 문자열 픽셀 폭 (한글 16 · 그 외 8). */
Hud.prototype.newhanWidth = function (s) {
  var w = 0; s = String(s == null ? '' : s);
  for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); w += (c >= 0xAC00 && c <= 0xD7A3) ? 16 : 8; }
  return w;
};

/* ── 원본 도스 폰트 ────────────────────────────────────────────────────
 *
 * 원본에는 글꼴이 **두 벌**입니다.
 *   TEXT.CHR      5×5   100자  — 0x4868A 가 씁니다 (직업명 · LV/HP/MP/EXP)
 *   NEWASCII.FNT  8×16  256자  — 0x5E048 이 씁니다 (능력치 8칸 · 이름)
 *   NEWHAN.FNT    16×16 360자  — 한글 조합형 (초성 8벌×20 · 중성 4벌×22 · 종성 4벌×28)
 *
 * 능력치 숫자가 원본보다 작아 보이던 이유가 이것입니다 — 큰 글꼴로 찍어야 하는데
 * 5×5 로 찍고 있었습니다. (원본 "60" 은 게임 좌표로 폭 20 · 높이 15,
 *  우리 것은 폭 11 · 높이 7 이었습니다.)
 *
 * 글꼴 파일은 **게임 폴더에서 그대로 읽습니다** (`/원본/NEWASCII.FNT`).
 * 미리 뽑아 둔 PNG 를 쓰지 않으므로 사용자가 폰트를 바꿔 끼우면 바로 반영됩니다.
 * ---------------------------------------------------------------------- */

var ASCII_W = 8, ASCII_H = 16;

/** 흰색 글리프 아틀라스를 한 번만 만들어 두고, 색은 그때그때 입힙니다. */
Hud.prototype.loadDosFont = function (base) {
  if (this._asciiPromise) return this._asciiPromise;
  var self = this;
  if (typeof fetch !== 'function') {
    this._asciiPromise = Promise.resolve(null); return this._asciiPromise;
  }
  /* ★★★★★ `base` 를 안 주면 **`G2URL(이름)`** 을 쓴다 — 원본 모드를 탄다.
   *   접두(`base + 이름`)로 받으면 `?원본=1` 을 못 붙인다 (`모드.js G2기준` 주석). */
  var _fnt = base ? (base + 'NEWASCII.FNT')
                  : (typeof G2URL === 'function' ? G2URL('NEWASCII.FNT') : '/원본/NEWASCII.FNT');
  this._asciiPromise = fetch(_fnt)
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(function (buf) {
      var d = new Uint8Array(buf);
      if (d.length < 256 * ASCII_H) throw new Error('NEWASCII.FNT 길이 ' + d.length);
      var c = document.createElement('canvas');
      c.width = 256 * ASCII_W; c.height = ASCII_H;
      var g = c.getContext('2d');
      var img = g.createImageData(c.width, c.height);
      for (var ch = 0; ch < 256; ch++) {
        for (var row = 0; row < ASCII_H; row++) {
          var bits = d[ch * ASCII_H + row];
          for (var b = 0; b < 8; b++) {
            if (!((bits >> (7 - b)) & 1)) continue;
            var px = ch * ASCII_W + b, py = row, o = (py * c.width + px) * 4;
            img.data[o] = img.data[o + 1] = img.data[o + 2] = img.data[o + 3] = 255;
          }
        }
      }
      g.putImageData(img, 0, 0);
      self._ascii = c; self._asciiTint = {};
      return c;
    })
    .catch(function (e) { self._ascii = null; return null; });
  return this._asciiPromise;
};

/** 팔레트 색을 입힌 아틀라스 한 벌을 만들어 캐시합니다. */
Hud.prototype._영문글자색상시트 = function (colorIdx) {
  if (!this._ascii) return null;
  var key = String(colorIdx);
  if (this._asciiTint[key]) return this._asciiTint[key];
  var src = this._ascii;
  var c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  var g = c.getContext('2d');
  g.drawImage(src, 0, 0, src.width, src.height);   // ★ 5인자 (scaler 몽키패치 함정)
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = this.assets.color(colorIdx);
  g.fillRect(0, 0, c.width, c.height);
  this._asciiTint[key] = c;
  return c;
};

/**
 * 0x5E048 — 큰 ASCII 글꼴. **주어진 x 는 왼쪽**입니다.
 * 글꼴을 아직 못 받았으면 예전 5×5 로 물러납니다.
 */
Hud.prototype.bigText = function (ctx, s, x, y, colorIdx, spacing) {
  s = String(s == null ? '' : s);
  var sheet = this._영문글자색상시트(colorIdx == null ? 1 : colorIdx);
  if (!sheet) return this.text(ctx, s, x, y, colorIdx, spacing);
  var step = ASCII_W + (spacing || 0), i, code;
  for (i = 0; i < s.length; i++) {
    code = s.charCodeAt(i) & 0xFF;
    ctx.drawImage(sheet, code * ASCII_W, 0, ASCII_W, ASCII_H,
                  x + i * step, y, ASCII_W, ASCII_H);
  }
  return x + s.length * step;
};
/** 큰 ASCII 글꼴 + 4방향 외곽선(기본 검정 색0). 능력치 수치 등. */
Hud.prototype.bigTextOutlined = function (ctx, s, x, y, colorIdx, spacing, outlineIdx) {
  var o = (outlineIdx == null ? 0 : outlineIdx);
  this.bigText(ctx, s, x - 1, y, o, spacing); this.bigText(ctx, s, x + 1, y, o, spacing);
  this.bigText(ctx, s, x, y - 1, o, spacing); this.bigText(ctx, s, x, y + 1, o, spacing);
  return this.bigText(ctx, s, x, y, colorIdx, spacing);
};

/** 폭을 미리 재서 가운데·오른쪽 정렬에 씁니다. */
Hud.prototype.bigTextWidth = function (s, spacing) {
  return String(s == null ? '' : s).length * (ASCII_W + (spacing || 0));
};

/* ── ★ [리마스터 N-13] 확장 바 그리기 ────────────────────────────────── */

/**
 * `FRAME.SYB` 의 318×4 바를 **창 폭까지** 늘려 그립니다.
 *
 *   ① 띠 전체를 색 0 으로 채웁니다 — 원본 바의 가운데가 바로 색 0 이라
 *      늘어난 자리와 원본 자리가 이어 붙어도 티가 안 납니다.
 *   ② 원본 바를 제자리(320 기준 x=1)에 그립니다 — 게이지 눈금이 원본 좌표에 섭니다.
 *   ③ 그 자리에 딸려 온 **양끝 장식 캡을 색 0 으로 지우고**,
 *      같은 그림을 창의 진짜 양끝에 다시 그립니다.
 *
 * 좌표계는 `draw()` 가 `translate(cx,0)` 을 걸어 둔 원본 320 기준입니다.
 * 따라서 창 왼쪽 끝은 `-cx`, 오른쪽 끝은 `-cx + logicalW` 입니다.
 *
 * @param {number} n  FRAME.SYB 프레임 번호 (14 사기바 · 15 턴바)
 * @param {number} y  y 좌표 (0 · 196)
 */
Hud.prototype.wideBar = function (ctx, n, y) {
  var CX = this.cx | 0;
  if (CX <= 0) return false;                         // 확장이 없으면 원본 그대로
  var parts = BARPART[n]; if (!parts) return false;
  var f = this.assets.frame('FRAME.SYB', n);
  var im = f && this.assets.image(f.png);
  if (!im || !im.complete || !im.naturalWidth) return false;
  var LW = this.logicalW || VIEW.w, H = f.h || 4;
  var x0 = MORALE.barAt[0];                          // 원본 바 왼쪽 = 1 (14·15 공통)

  ctx.fillStyle = this.assets.color(0);
  ctx.fillRect(-CX, y, LW, H);                       // 띠 바탕 (원본 바의 가운데와 같은 색)
  for (var i = 0; i < parts.length; i++) {
    var sx = parts[i][0], w = parts[i][1], a = parts[i][2], dx;
    if (a === 'L')      dx = -CX + x0 + sx;                                  // 왼쪽 끝 기준
    else if (a === 'R') dx = -CX + LW - (VIEW.w - (x0 + sx + w)) - w;        // 오른쪽 끝 기준
    else                dx = -CX + LW / 2 + (x0 + sx + w / 2 - VIEW.w / 2) - w / 2;  // 가운데 기준
    /* 잘라내는 원본 사각형은 **논리 좌표** — 스케일러가 9인자 drawImage 를 보정합니다 */
    ctx.drawImage(im, sx, 0, w, H, Math.round(dx), y, w, H);
  }
  return true;
};

/**
 * ★ [리마스터 N-13] 사기 게이지 가로 확대율.
 *
 * 사용자 지정(2026-08-15): 「**양끝 기준 배치 + 게이지 늘림**」.
 * 게이지 기준점(아군 오른쪽 끝 140 · 적군 왼쪽 끝 175)은 **화면 가운데 기준**이라
 * `translate(cx,0)` 덕분에 저절로 맞습니다. 길이만 이 비율로 늘립니다.
 *
 * ★ 원본과 다른 점 — 원본은 **1px = 사기 1** 입니다(`0x44E17`: 길이 = 사기 − 40).
 *   늘리면 그 대응이 깨집니다. 확장이 없으면(`cx = 0`) 1 이라 원본 그대로입니다.
 */
Hud.prototype.모랄확대 = function () {
  if ((this.cx | 0) <= 0) return 1;
  return (this.logicalW || VIEW.w) / VIEW.w;
};

/* ── ① 상단 사기 게이지 — 0x44DF3 ───────────────────────────────────── */

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ally  아군 사기 word[0xF0BA0]
 * @param {number} enemy 적군 사기 word[0xF0BA2]
 */
Hud.prototype.moraleBar = function (ctx, ally, enemy) {
  /* ★★★ 사기바는 **화면 맨 위**에 붙는다 — 세로 확장이면 `cy` 만큼 **올린다**
   *   (2026-08-28 · ㉛). `draw` 가 `translate(cx, cy)` 를 걸어 두므로
   *   원본 좌표 `y = 0` 은 늘어난 화면의 **가운데 위쪽**이 되어 버린다.
   *   가로에서 `wideBar` 가 `-cx` 로 왼쪽 끝을 잡는 것과 같은 이치다. */
  var TY = MORALE.barAt[1] - (this.cy | 0);
  if (!this.wideBar(ctx, MORALE.barFrame, TY))
    this.blit(ctx, 'FRAME.SYB', MORALE.barFrame, MORALE.barAt[0], TY, false);
  var a = moraleAlly(ally | 0), e = moraleEnemy(enemy | 0), i;
  /* ★ [N-13] 확장 폭에서는 길이를 늘립니다. 기준점(아군 끝 140 · 적군 시작 175)은
   *   화면 가운데 기준이라 그대로 두고, **아군은 왼쪽으로 · 적군은 오른쪽으로** 자랍니다. */
  var k = this.모랄확대();
  if (k !== 1) {
    if (a) { var al = Math.round(a.len * k); a = { x: (a.x + a.len) - al, len: al }; }
    if (e) { e = { x: e.x, len: Math.round(e.len * k) }; }
  }
  for (i = 0; i < MORALE.rows.length; i++) {
    var ry = MORALE.rows[i] - (this.cy | 0);                     /* ★ 막대도 함께 올린다 */
    if (a) this.hline(ctx, a.x, ry, a.len, MORALE.ally.colors[i]);
    if (e) this.hline(ctx, e.x, ry, e.len, MORALE.enemy.colors[i]);
  }
  return this;
};

/* ── [리마스터 · 정본 373] 턴 순서 작은 초상화 ─────────────────────────
 *   사장님 11-22 「x로 선택은 취소하고 캐릭터 순서를 보여주면 어떨까 싶은데? 아군 턴이 돌아오면 화면 중앙 하단 턴바 위쪽에
 *   턴 순서대로 작은 초상화를 배치하고 현재 선택된 캐릭터 초상화에 하이라이트를 해주면 어떨까 싶은데」
 *   원작에 없는 표시 — 작은 초상(PORTSMAL.SYF · 50×46 가운데 앵커)을 절반 크기로 · 초상 번호 = 명부 +0x10(0x54756 과 같은 자리)
 *   @param t {목록: 유닛[] (턴 순서) · 고른: 유닛|null} */
Hud.prototype.턴순서초상 = function (ctx, t) {
  var A = this.assets; if (!A || !A.image) return this;
  /* 줄 = 지금 차례 초상들 · (틈) · 다음 아군 턴부터 턴마다 — 그 턴에 새로 행동 가능해질 캐릭터 초상(작게·흐리게), 아무도 없으면 점
   *   (정본 373 ⑤ · 사장님 11-22 「이올린라시드가 맨 왼쪽에 있되, 먼저 선택되는애가 더 왼쪽, 점 두개 넣고 세번째에 듀란. 턴 소모하면 지워지고 한칸씩 당겨지고」) */
  /* 칸 크기 — 초상 그림에 딱 맞게 작게 (사장님 11-22 「초상화 칸이 이상해. 전체 칸에 비해서 초상화가 너무 작아. 칸을 줄이든 초상화를 키우든 해야해. 칸을 줄이는게 좋겠어.」)
   *   최종본 작은 초상(PORTSMAL · 정본 369)은 한 장이 103×111 이고 그림은 왼쪽 위 46×42 뿐이라 한 장 전체를 줄여 넣으면 칸 왼쪽 위에 작게 찌그러졌다 → 원작 작은 초상 크기(50×46)만 잘라 칸을 채운다 */
  var 칸 = [], 앞 = t.앞 || [], K = 0, 틈 = 1.5;
  t.목록.forEach(function (u) { 칸.push({ u: u, w: 13, h: 12, 지금: true }); });
  앞.forEach(function (a) { if (a.k > K) K = a.k; });
  /* 턴마다 한 묶음 · 묶음 사이 세로 금선 · 같은 턴 캐릭터는 금선 없이 붙임 · 빈 턴은 점 하나
   *   예: 이올린 라시드 | 쥬 카 | · | 듀란 (사장님 11-22 「다음과 한칸 차이가 나야하는데 그게 표시가 안되네」·「그래야 동시에 하는 것과 안겹치나?」 → 고르심 «지금 뒤에 세로 구분선») */
  for (var k = 1; k <= K; k++) {
    칸.push({ 선: true, w: 3 });
    var 이턴 = 앞.filter(function (a) { return a.k === k; });
    if (!이턴.length) 칸.push({ 점: true, w: 5 });
    else 이턴.forEach(function (a) { 칸.push({ u: a.u, w: 10, h: 9, ai: !!a.ai }); });   /* ai — AI 를 건 아군(하늘색 테두리) */
  }
  /* 자리 — Player Phase 글자(ETC.ICO 8 · 100×17 · phaseIcon 자리) 바로 오른쪽에서 시작하는 왼쪽 정렬 · 높이는 늘 턴 게이지 바로 위
   *   ☠ 가운데 정렬 + 겹치면 위로 올리기는 줄 길이가 바뀔 때마다 위아래로 오갔다(사장님 11-22 「왜 턴 표시 초상화가 위로 올라갔다 내려왔다 하지?」 · 스크린샷 122253·122321)
   *   ⇒ 왼쪽 끝은 움직이지 않고 오른쪽으로만 늘어난다(「이올린라시드가 맨 왼쪽에」) · 화면 오른쪽 끝을 넘으면 줄 전체를 줄인다 */
  var 총 = 칸.reduce(function (s, c) { return s + c.w + 틈; }, -틈);
  var 바y = TURN.barAt[1] + (this.cy | 0), 바닥 = 바y - 3;
  var 시작 = PHASE.at[0] - (this.cx | 0) + 100 + 6, 오른끝 = (this.logicalW || VIEW.w) - (this.cx | 0) - (root.__프레임켜짐 ? 18 : 6);   /* 장식 기둥이 켜져 있으면 그만큼 비운다 */
  var 비 = Math.min(1, Math.max(1, 오른끝 - 시작) / Math.max(1, 총));
  ctx.save();
  ctx.translate(시작, 바닥); ctx.scale(비, 비);   /* 원점 = 줄 왼쪽 끝 · 바닥(턴 게이지 위 3) */
  var x = 0;
  for (var i = 0; i < 칸.length; i++) {
    var c = 칸[i];
    if (c.점) { ctx.fillStyle = 'rgba(240,213,140,.85)'; ctx.beginPath(); ctx.arc(x + c.w / 2, -5, 1.1, 0, Math.PI * 2); ctx.fill(); }
    else if (c.선) { ctx.fillStyle = 'rgba(240,213,140,.75)'; ctx.fillRect(x + c.w / 2 - 0.3, -11, 0.6, 11); }
    else if (c.u) {
      /* 초상 번호 = 상태창 초상(0x48132 · Hud.portrait)과 같은 unit.portrait · 번호가 없거나 그림이 없으면 빈 초상 틀(검은 판 + 테두리)
       *   (사장님 11-22 「초상화가 없는애는 빈 초상화로 표시해야해」) */
      var u = c.u, pn = u.portrait != null ? (u.portrait | 0) : (u._원본 ? (u._원본[0x10] | 0) : -1);
      if (pn >= 0 && A.frame && !A.frame('PORTSMAL.SYF', pn)) pn = -1;
      var 고름 = c.지금 && u === t.고른, yy = -c.h, xx = x;   /* 고른 칸도 같은 높이 — 테두리로만 강조(오르내리지 않게) */
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(xx, yy, c.w, c.h);
      /* 원작 작은 초상 50×46 만 — 원본 프레임에서 그 칸만 떼어 따로 굽는다(화면 배율은 frameToCanvas 가 그대로)
       *   ☠ 전에는 한 장 캔버스에서 «실제 픽셀 폭 ÷ 논리 폭»으로 잘랐는데, 휴대폰에서 그 값이 어긋나 한 장 전체가 칸에 줄어 들어갔다
       *     (사장님 11-22 「모바일에서 턴 표시 초상화 이상해. 사이즈 안맞아」·「칸은 크고 초상화는 작아」 · 카톡 스크린샷 132132)
       *   nf.canvas 에 둬서 팔레트가 바뀌면(724) 함께 새로 굽는다 · 스케일러 필터·배율도 열쇠에 */
      var pc = null, nf = pn >= 0 && A.native ? A.native['PORTSMAL.SYF'] : null, fr0 = nf && nf.frames[pn];
      if (fr0 && root.G2Native && root.G2Native.frameToCanvas && typeof document !== 'undefined') {
        var Sc = root.G2Scaler, 열쇠 = '턴칸#' + pn + '|' + (Sc && Sc.cur ? Sc.cur() + Sc.N() : '');
        pc = nf.canvas[열쇠];
        if (!pc) {
          var 떼w = Math.min(50, fr0.w), 떼h = Math.min(46, fr0.h), 떼 = new fr0.idx.constructor(떼w * 떼h);
          for (var 떼y = 0; 떼y < 떼h; 떼y++) for (var 떼x = 0; 떼x < 떼w; 떼x++) 떼[떼y * 떼w + 떼x] = fr0.idx[떼y * fr0.w + 떼x];
          pc = nf.canvas[열쇠] = root.G2Native.frameToCanvas({ w: 떼w, h: 떼h, ax: 0, ay: 0, idx: 떼, tr: fr0.tr }, nf.palette);
        }
      }
      ctx.globalAlpha = c.지금 ? ((!고름 && t.고른) ? 0.6 : 1) : 0.55;
      if (pc) ctx.drawImage(pc, xx, yy, c.w, c.h);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 고름 ? '#ffd65a' : c.ai ? 'rgba(120,200,255,.9)' : (c.지금 ? 'rgba(170,140,80,.8)' : 'rgba(120,100,60,.7)'); ctx.lineWidth = 고름 ? 1 : 0.5;
      ctx.strokeRect(xx - 0.25, yy - 0.25, c.w + 0.5, c.h + 0.5);
      if (고름) { ctx.strokeStyle = 'rgba(255,214,90,.45)'; ctx.lineWidth = 0.75; ctx.strokeRect(xx - 1.25, yy - 1.25, c.w + 2.5, c.h + 2.5); }
      /* AI 를 건 아군 — 초상 왼쪽 아래에 «AI» (사장님 11-22 「ai인 경우 ai로 초상화 좌측 하단에 ai로 표시해줘.」) */
      if (c.ai) {
        ctx.font = 'bold 4px sans-serif'; ctx.textBaseline = 'bottom'; ctx.textAlign = 'left';
        ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.9)'; ctx.strokeText('AI', xx + 0.5, yy + c.h - 0.2);
        ctx.fillStyle = '#8fd8ff'; ctx.fillText('AI', xx + 0.5, yy + c.h - 0.2);
      }
      ctx.restore();
    }
    x += c.w + 틈;
  }
  ctx.restore();
  return this;
};

/* ── ② 하단 턴 게이지 — 0x44EB0 ─────────────────────────────────────── */

/**
 * @param {number} turn   dword[0xF0418] 라운드 번호
 * @param {number} period byte[0x74138] 주기 (EXE 10 · GAME.CFG 7)
 */
Hud.prototype.turnGauge = function (ctx, turn, period) {
  /* ★★★ 턴 게이지는 **화면 맨 아래**에 붙는다 — 세로 확장이면 `cy` 만큼 **내린다**
   *   (2026-08-28 · ㉛). 사기바가 `-cy` 인 것과 짝이다. */
  var BY = TURN.barAt[1] + (this.cy | 0);
  if (!this.wideBar(ctx, TURN.barFrame, BY))
    this.blit(ctx, 'FRAME.SYB', TURN.barFrame, TURN.barAt[0], BY, false);
  var n = gaugeCount(turn | 0, period), k;
  for (k = 0; k < n; k++) {
    this.blit(ctx, 'FRAME.SYB', TURN.left.frame,  TURN.left.x  + TURN.left.step  * k, TURN.left.y  + (this.cy | 0), false);
    this.blit(ctx, 'FRAME.SYB', TURN.right.frame, TURN.right.x + TURN.right.step * k, TURN.right.y + (this.cy | 0), false);
  }
  return this;
};

/* ── ③ 좌우 여백 — 0x45443 / 0x4545D ────────────────────────────────── */

Hud.prototype.clearMargins = function (ctx) {
  ctx.fillStyle = this.assets.color(0);
  /* ★ [리마스터 N-13] 확장이면 여백도 **창 끝까지** 늘립니다. 안 그러면
   *   원본 320 바깥이 안 지워져 맵이 바·기둥 밖으로 삐져나옵니다. */
  var CX = this.cx | 0, LW = this.logicalW || VIEW.w;
  ctx.fillRect(MARGIN.left[0] - CX, MARGIN.left[1], MARGIN.left[2] + CX, MARGIN.left[3]);
  ctx.fillRect(MARGIN.right[0], MARGIN.right[1], MARGIN.right[2] + (LW - VIEW.w - CX), MARGIN.right[3]);
  return this;
};

/* ── ④ 구체 위젯 — 0x45844 (시계) · 0x45686 (행동력) ────────────────── */

/**
 * @param {object} o
 *   mode   'clock' | 'ap'      (byte[0xF042F] == 1 이면 clock)
 *   x,y    앵커. 없으면 지금 앵커
 *   timeIdx / turn / kind / dayIdx    시계용
 *   value  행동력용 word[0xF0428]
 */
Hud.prototype.orb = function (ctx, o) {
  o = o || {};
  var X = (o.x == null ? this.orbAnchor.x : o.x);
  var Y = (o.y == null ? this.orbAnchor.y : o.y);

  /* 여닫기 애니 중이면 그 프레임만 그립니다 — 0x45A41 / 0x45ACF */
  if (this.anim) {
    this.blit(ctx, 'TIME_GRA.SYB', this.anim.frames[this.anim.i], X, Y, true);
    return this;
  }

  if ((o.mode || this.orbMode) === 'clock') {
    var c = clock(o.timeIdx | 0, o.turn | 0, o.kind | 0, o.dayIdx | 0);
    this.blit(ctx, 'TIME_GRA.SYB', ORB.clockFrame, X, Y, true);          // 0x45961
    this.blit(ctx, 'TIME_GRA.SYB', c.sky, X, Y, true);                   // 0x459B0
    this.text(ctx, c.dateText, X + ORB.dateAt[0], Y + ORB.dateAt[1], ORB.dateColor, ORB.spacing);
    this.text(ctx, c.timeText, X + ORB.timeAt[0], Y + ORB.timeAt[1], ORB.timeColor, ORB.spacing);
    return this;
  }

  /* 행동력 구슬 — 0x45686 */
  var v = (o.value == null ? this.ap : o.value) | 0;
  var cx = X, cy = Y + ORB.centerDy;
  var self = this;
  function disc(r, colorIdx) {                                            // 0x6075A 타원 채우기
    ctx.beginPath();
    ctx.ellipse ? ctx.ellipse(cx + 0.5, cy + 0.5, r, r, 0, 0, Math.PI * 2)
                : ctx.arc(cx + 0.5, cy + 0.5, r, 0, Math.PI * 2);
    ctx.fillStyle = self.assets.color(colorIdx);
    ctx.fill();
  }
  disc(ORB.eraseR, 0);                                                    // 0x456CC
  var lamp = orbLamp(v);
  for (var i = 0; i < lamp.rings.length; i++) disc(lamp.rings[i].r, lamp.rings[i].c);
  this.blit(ctx, 'TIME_GRA.SYB', ORB.ringFrame, X, Y, true);              // 0x4583A
  return this;
};

/** 여닫기 애니 시작 — 0x1A0F0. 3프레임 × 10틱 = 30틱. */
Hud.prototype.setOrbMode = function (mode) {
  if (mode === this.orbMode && !this.anim) return this;
  var opening = (mode === 'clock');
  this.anim = { frames: opening ? ORB.openFrames.slice() : ORB.openFrames.slice().reverse(),
                i: 0, acc: 0, next: mode };
  return this;
};

/**
 * ★ 유닛을 고르면 구체를 **그 유닛의 행동력(TP)** 으로 바꿉니다.
 *
 * ```
 * 0x4D674  플레이어 유닛 조작 시작
 *     0x19FAB  [0xF0428] = TP           ; [+0x1E]&0x40 이면 최대TP(+0x54)×70/100, 아니면 +0x54
 *              하한 0x37(55) · 탈것/특수는 +0xFA(250)·+0x3C(60)   ; 0x19FD9
 *     0x1A0F0(0)  → 0x45ACF 프레임 3→2→1 을 10틱씩  ; 시계 → 구슬로 「돌면서」 바뀝니다
 * 0x1A0C6  행동할 때마다 [0xF0428] 을 깎고
 * 0x45B4E  깎이는 연출 — 한 번에 5씩, 매번 화면을 다시 그립니다
 * ```
 * @param {object|null} unit  null 이면 시계로 되돌립니다
 */
Hud.prototype.selectUnit = function (unit) {
  this.orbUnit = unit || null;
  if (!unit) { this.apTarget = null; this.setOrbMode('clock'); return this; }
  this.ap = unit.tp | 0;
  this.apTarget = null;
  this.setOrbMode('ap');
  return this;
};

/** 행동력을 목표값까지 **5씩** 깎는 연출 — 0x45B4E / 0x45B84. */
Hud.prototype.drainAp = function (target) {
  this.apTarget = target | 0;
  return this;
};

Hud.prototype.APDRAIN = { step: 5, ms: 1000 / 60 };   // 0x45B84 는 프레임마다 5씩

/**
 * 게이지가 목표에 닿을 때까지 기다린다 — 원본 0x45B4E 는 링 명령 끝에서 5씩 깎으며 전송(귀선)만 하고
 * 다 깎인 뒤에야 다음(링)으로 간다 (2026-09-25 · 칸 75 원본 기록: 연출 뒤 0x45BB4 전송 40번 → 링).
 * 안전 상한 2초 — 갱신 고리가 멈춰도 흐름이 서지 않게.
 */
Hud.prototype.drainAp완료 = function () {
  var self = this;
  if (this.apTarget == null) return Promise.resolve();
  return new Promise(function (res) {
    var 끝남 = false;
    function 끝() { if (끝남) return; 끝남 = true; res(); }
    (self._apWaiters = self._apWaiters || []).push(끝);
    setTimeout(끝, 2000);
  });
};

/** 애니 진행. dt 는 밀리초. */
Hud.prototype.update = function (dt) {
  /* 행동력 깎기 연출 */
  if (this.apTarget != null) {
    this._apAcc = (this._apAcc || 0) + (dt || 0);
    while (this._apAcc >= this.APDRAIN.ms) {
      this._apAcc -= this.APDRAIN.ms;
      if (this.ap > this.apTarget) this.ap = Math.max(this.apTarget, this.ap - this.APDRAIN.step);
      else if (this.ap < this.apTarget) this.ap = Math.min(this.apTarget, this.ap + this.APDRAIN.step);
      else { this.apTarget = null; break; }
      /* 계측 — 원본은 걸음마다 전송(0x45BAF)만 하고 틱 대기가 없다 → «보조» 장 */
      if (typeof window !== 'undefined' && window.__연출대기감시) { try { window.__연출대기감시(this.APDRAIN.ms, true); } catch (e감) {} }
    }
    if (this.apTarget == null && this._apWaiters && this._apWaiters.length) {
      var 대기들 = this._apWaiters; this._apWaiters = [];
      대기들.forEach(function (f) { try { f(); } catch (e) {} });
    }
  }
  /* 유닛을 잡고 있으면 TP 를 따라갑니다 (링 커맨드가 깎으면 저절로 반영됩니다) */
  if (this.orbUnit && this.apTarget == null && (this.orbUnit.tp | 0) !== this.ap) {
    this.drainAp(this.orbUnit.tp | 0);
  }

  if (!this.anim) return this;
  this.anim.acc += dt || 0;
  var step = ORB.animTicks / TICK_HZ * 1000;         // 10틱 ≈ 56.99 ms
  while (this.anim.acc >= step) {
    this.anim.acc -= step;
    this.anim.i++;
    if (this.anim.i >= this.anim.frames.length) {
      this.orbMode = this.anim.next;
      this.anim = null;
      break;
    }
  }
  return this;
};

/* ── ④ Player Phase — 0x454D5 ───────────────────────────────────────── */

/**
 * @param {'player'|'waiting'|'ai'|'run'|'none'} kind
 *   turn.js 는 [0xF042E] == 0 을 `'run'` 으로 씁니다 — 표에 없으므로 아무것도 안 그립니다.
 */
Hud.prototype.setPhase = function (kind) { this.phase = kind; return this; };

/** 지정 전투 페이즈의 원본 아이콘을 HUD 문맥에 그린다. */
Hud.prototype.phaseIcon = function (ctx, kind) {
  var n = PHASE.frame[kind || this.phase];
  if (n == null) return this;                        // 0 = 라운드 진행 중 → 아무것도 안 그림
  /* [리마스터 · 정본 373 ⑥] 화면 크기에 맞춰 — 왼쪽은 확장 폭(cx)만큼 바깥으로 · 아래는 턴 게이지처럼 화면 맨 아래 기준(cy) · 4:3(cx=cy=0)은 원본 자리 그대로
   *   (사장님 11-22 「페이즈표시 문구와 티피구체 초기 표시 위치가 16:9일때 화면 크기에 맞춰서 사이드로 밀려야해」) */
  this.blit(ctx, 'ETC.ICO', n, PHASE.at[0] - (this.cx | 0), PHASE.at[1] + (this.cy | 0), false);
  return this;
};

/* ── ⑤ 정보 바 — 0x4B4CA ────────────────────────────────────────────── */

/** 정보 바에 띄울 글. 자리는 기준 유닛이 정합니다(없으면 아래). */
Hud.prototype.setMessage = function (text, unit) {
  this.message = text == null ? '' : String(text);
  this.messageUnit = unit || null;
  return this;
};

/**
 * @param {object} o  {text, unitTileY, cameraTileY, lines:[문자열…]}
 * 바탕은 원본이 LUT 뱅크 0(검정 쪽 60 %)으로 리맵합니다. 캔버스에서는 같은 결과가
 * 나오도록 검정을 60 % 알파로 덮습니다.
 */
Hud.prototype.infoBar = function (ctx, o) {
  o = o || {};
  var text = (o.text == null ? this.message : o.text);
  if (!text && !(o.lines && o.lines.length)) return this;

  /* ★ `−1`·`0` 은 좌표 보정이 아니라 **인자를 안 줬을 때의 기본값**이다 —
   *   `−1` = 「유닛 칸이 없음」 표시, `0` = 카메라 원점. **[원본없음]** — 원본 수치가 아니다. */
  var y = infoBarY(o.unitTileY == null ? -1 : o.unitTileY, o.cameraTileY == null ? 0 : o.cameraTileY);
  ctx.save();
  /* ★ 5단계 — **정본 창구**로 간다. 원본은 알파 합성이 아니라 팔레트 리맵이다
   *   (`0x6104A(0)` 단계 0 = 남길 밝기 40 % · 조사표 `0x4B500` 계열 **pass 1**). */
  /* ★ [N-13] 원본 띠는 화면 폭(0~319)을 꽉 채우던 것 — 확장 폭까지 늘립니다 */
  var E = this.화면끝();
  this.화면음영(ctx, 1, { x: E.L, y: y + INFOBAR.rect.dy1, w: E.W,
                          h: INFOBAR.rect.dy2 - INFOBAR.rect.dy1 + 1 });
  ctx.restore();

  var lines = o.lines || [text];
  for (var i = 0; i < lines.length && i < 3; i++) {
    var s = String(lines[i]);
    /* 한글이 섞여 있으면 조합형 폰트 자리(캔버스 기본 폰트)로 보냅니다 */
    /* 글자는 **왼쪽 끝 기준** — 원본에서 기둥(0~24) 바로 옆이라 그 관계를 지킵니다 */
    if (/[^\x00-\x7F]/.test(s)) this.korean(ctx, s, E.L + 24, y + 3 + i * 9, 0x18, 9);
    else this.text(ctx, s, E.L + 24, y + 4 + i * 8, 0x18, 1);
  }
  return this;
};

/* ── AI 설정 전용 바 — 0x4B4CA ────────────────────────────────────────
 *
 * AI 하위 메뉴(`0x4D06E`)가 도는 동안 화면 위(또는 아래)에 **이 바 하나가** 서서
 * 지금 AI 설정을 보여 줍니다. 링만 있고 이 바가 없으면 무엇을 고르는지 알 수 없습니다.
 *
 * ```asm
 * 0x4B4E3  y = (유닛.y > 카메라.y + 6) ? 8 : 0xA8            ; 유닛을 가리지 않는 쪽
 * 0x4B528  0x5EDDE(0, y−2, 0x13F, y+0x1A)  뱅크0(검정 60 %) 로 깔고
 * 0x4B536  [+0x73] (목표 유닛) 이 있으면 → 스프라이트 0x18 + 이름 0x38     "%s"
 * 0x4B589  아니고 [+0x6F] != 0xFF        → 0x18 에 "목적지 [%d %d]" ([+0x6F],[+0x70])
 * 0x4B5B2  아니고 [+0x6F] != [+0x71]     → 그 칸의 유닛 스프라이트 + 이름
 * 0x4B5FF  그 밖                          → 0x38 에 "No Target."
 * 0x4B612  [+0x80] != 0xFF → 0xC0 에 "[AI Magic]"        + 마법 이름 (0x7423C)
 * 0x4B6AD  아니면            0xC0 에 "[Normal Sequence]"
 * 0x4B6CD  [+0x82] != 0xFF → 0x104 에 무기군 아이콘, 0x118 에 필살기 아이콘
 * ```
 * 문자열 0x77E9C 는 조합형 한글 「목적지 [%d %d]」 입니다.
 * @param {object} o { unit, cameraTileY }
 */
var AI_BAR = {
  targetX: 0x38, iconX: 0x18,
  /* ☠★★★★★ **세 줄의 y 가 제각각이다** (2026-09-22 · 원본 재독)
   *   `0x4B652 add eax,6`   [AI Magic]        → y + 0x06
   *   `0x4B6A1 add eax,0xE` 주문 **이름**     → y + 0x0E  ← 라벨 «아래» 줄이다
   *   `0x4B6B6 add eax,0xC` [Normal Sequence] → y + 0x0C
   *   전에는 라벨을 0x0E 에 두고 이름을 **같은 줄 오른쪽**(+66)에 붙였다 — 둘 다 틀렸다. */
  magicX: 0xC0, magicDy: [0x06, 0x0C], magicNameDy: 0x0E,
  spGroupX: 0x104, spIconX: 0x118, spDy: 0x0C,
  msgNoTarget: 'No Target.',                 // 0x77EAB
  msgAiMagic: '[AI Magic]',                  // 0x77EB6
  msgNormal: '[Normal Sequence]',            // 0x77EC1
  msgCoord: '목적지'                          // 0x77E9C (조합형)
};

/** AI 행동 상태 막대를 전달된 값으로 HUD 문맥에 그린다. */
Hud.prototype.aiBar = function (ctx, o) {
  o = o || {};
  var u = o.unit;
  if (!u) return this;
  var y = infoBarY(u.y | 0, o.cameraTileY == null ? 0 : o.cameraTileY);
  ctx.save();
  /* ★ 5단계 — **정본 창구**로 간다. 조사표 `0x4B500 → 0x4B528` rect **pass 1** */
  this.화면음영(ctx, 1, { x: INFOBAR.rect.x1, y: y + INFOBAR.rect.dy1,
                          w: INFOBAR.rect.x2 - INFOBAR.rect.x1 + 1,
                          h: INFOBAR.rect.dy2 - INFOBAR.rect.dy1 + 1 });
  ctx.restore();

  var ai = u.ai || {}, cy = y + 4;                     // 0x4B539  ecx = y + 4
  /* ★★★★★ **목표를 읽는 자리가 틀려서 늘 「No Target.」 이었다** (2026-09-22)
   *
   *   > 사장님: 「ai모드시 **타겟과 좌표 표시도 원본과 달라.**」
   *
   *   ☠ 여기서 보던 `ai.targetUnit` · `ai.target` 은 **어디서도 채우지 않는 이름**이다.
   *     실제 값은 `state.js` 가 `ai.목표x` · `ai.목표y` · `ai.목표유닛id` 로 옮겨 두고,
   *     읽는 창구는 `ai.js AI목표읽기()` **하나**다(P6). 둘이 어긋나 있었으니
   *     목표를 세워도 셋째 갈래로 떨어져 「No Target.」만 나왔다.
   *
   *   원본 갈래 **순서**도 그대로 따른다 —
   *     `0x4B536` `[+0x73]` 포인터가 있으면 → 그 유닛 (그림 0x18 + 이름 0x38)
   *     `0x4B589` 아니고 `[+0x6F]` != 0xFF → 「목적지 [x y]」 (0x18)
   *     `0x4B5B2` 아니고 `[+0x71]` != 0xFF → `0x1379A` 로 찾은 유닛
   *     `0x4B5FF` 그 밖                    → "No Target." (0x38)
   *   ☐ 남은 것: 유닛 갈래의 **스프라이트**(`0x4B565 call 0x5F3FD`, 표 `0xD66A8`
   *     레코드 572B `[+9]`)는 아직 안 얹는다 — 유닛 그림은 렌더러가 DOM 으로 들고 있어
   *     HUD 캔버스로 가져오는 길이 따로 필요하다. 이름·좌표부터 맞춘다. */
  var Ai = root.G2AI;
  var 목 = (Ai && Ai['AI목표읽기']) ? Ai['AI목표읽기'](u) : null;
  var 목표유닛 = 목 ? 목.유닛 : null;                                   /* 0x4B536 [+0x73] */
  if (!목표유닛 && 목 && (목.x | 0) === 0xFF && Ai && Ai['AI목표유닛찾기'])
    목표유닛 = Ai['AI목표유닛찾기'](this.battle, 목.유닛id, 목.유닛코드);             /* 0x4B5B2 [+0x71] */
  if (목표유닛 && 목표유닛.name) {
    /* ★ 목표 유닛 그림 (2026-09-30 사장님 「캐릭터 스프라이트 표시가 안되고 이름으로 표시되는 문제가 있어」)
     *   `0x4B540` [유닛+0x60] 그림 번호 → `0x4B555` 0xD66A8 + 번호×572 → `0x4B55D` [+9] = **첫 레코드**(방향 0 · 모션 0)
     *   `0x4B560` x = 0x18 · `0x4B55A` y = 바 윗변(si) · `0x4B565 call 0x5F3FD` — 기준점 보정 없이 그대로 찍는다.
     *   셋째 갈래(`0x4B5CC`~`0x4B5F4` · 좌표 칸의 유닛)도 같은 식이라 여기 하나로 된다. 그림이 아직 없으면 이름만. */
    var Rd = 현재렌더러(), 그림 = (Rd && Rd.연출유닛프레임) ? Rd.연출유닛프레임(목표유닛, 0, 0) : null;
    if (그림 && 그림.canvas) ctx.drawImage(그림.canvas, AI_BAR.iconX, y, 그림.w, 그림.h);
    /* ★ 글자는 0x5E048(큰 글꼴 · 한글 조합형 0x5DD5B) — 0x4B57C push 0x38 · y = 바 윗변 + 4(0x4B539)
     *   같은 함수의 다른 자리(배치 목록 0x54778)와 같이 노랑 0x11 · 테두리 0x00 (2026-10-01 사장님 「폰트나 아이콘 위치 등은 왜 제멋대로야?」 · 원본 사진: 큰 노란 이름)
     *   ☠ 예전: 캔버스 기본 9px 흰 글씨 */
    this.newhanLeft(ctx, 목표유닛.name, AI_BAR.targetX, cy, 0x11, 0x00);
  } else if (목 && (목.x | 0) !== 0xFF) {
    this.newhanLeft(ctx, AI_BAR.msgCoord + ' [' + (목.x | 0) + ' ' + (목.y | 0) + ']',
                    AI_BAR.iconX, cy, 0x11, 0x00);                       /* 0x4B5A6 push 0x18 · 0x5E048 */
  } else {
    this.bigTextOutlined(ctx, AI_BAR.msgNoTarget, AI_BAR.targetX, cy, 0x11, 0, 0x00);   /* 0x4B608 push 0x38 · 0x5E048 큰 영문 */
  }

  /* ② 마법 — [AI Magic] + 이름 / [Normal Sequence] */
  var mg = ai.magic;
  if (mg != null && (mg | 0) !== 0xFF) {
    this.textOutlined(ctx, AI_BAR.msgAiMagic, AI_BAR.magicX, y + AI_BAR.magicDy[0], 0x11, 1);
    /* ★★★★★ **주문 «이름»을 쓴다 — 번호가 아니다** (2026-09-22 사장님 지적)
     *
     *   > 사장님: 「ai모드시 **타겟과 좌표 표시도 원본과 달라.**」
     *
     *   ☠ 여기 `'#' + 번호` 는 내가 넣은 **임시 글씨**였다. 원본은 이름표를 읽는다 —
     *   ```asm
     *   0x4B625  ecx = [+0x80] * 3           ; 이름표 칸 = (원소×7 + 단계) × 3
     *   0x4B644  call 0x28429(ecx=0x24)      ;   + 그 원소의 **마법 클래스**(랭크)
     *   0x4B698  ebx = [… + 0x7423C]         ; ★ 이름 문자열
     *   0x4B6C8  call 0x484F9(eax=0xC0, edx=y+0x0E, ecx=0x24, 색 0x11)
     *   ```
     *   `magicnames.js NAMES` 가 그 표(`0x7423C`)를 그대로 들고 있다. */
    var Rg = root.G2Ring;
    var cls = (Rg && Rg.magicClassOf) ? Rg.magicClassOf(this.battle, u, Math.floor((mg | 0) / 7)) : 0;
    var Nm = root.G2MagicNames;
    var 주문 = Nm && Nm.NAMES ? (Nm.NAMES[(mg | 0) * 3 + Math.max(0, cls | 0)] || '') : '';
    /* ★ 이름 색은 클래스 색 — 함수 머리 0x4B4D7 이 0x4AE4A 의 세 색(11·31·50 · 마법 목록과 같은 표)을 [esp] 에 복사하고
     *   0x4B677 [esp + 클래스×2] 로 고른다 (2026-10-01 사장님 「마법 클래스 색상도 적용이 안돼.」 · 원본 사진 METEOR 초록) · 라벨만 0x11 */
    var 클색 = [0x11, 0x31, 0x50][Math.max(0, Math.min(2, cls | 0))];
    if (주문) this.textOutlined(ctx, 주문, AI_BAR.magicX, y + AI_BAR.magicNameDy, 클색, 1);
  } else {
    this.textOutlined(ctx, AI_BAR.msgNormal, AI_BAR.magicX, y + AI_BAR.magicDy[1], 0x11, 1);
  }

  /* ③ 필살기 지정 — **글씨가 아니라 아이콘 둘**이다 (`0x4B6CD`)
   *
   *   > 사장님: 「ai모드시 타겟과 좌표 표시도 **원본과 달라.**」
   *
   *   ☠ 전에는 `W1` · `S50` 이라는 **내가 지은 글씨**를 찍었다. 원본은 링과 같은
   *     `.ICO` 에서 아이콘을 꺼내 얹는다 —
   *   ```asm
   *   0x4B6D3  esi += 0xC                       ; ★ 아이콘 줄은 y + 0x0C
   *   0x4B6DB  bl<7→1 · <0xB→2 · <0xF→3 · <0x13→4 · 그밖 5   ; 무기군
   *   0x4B71D  call 0x4AC28(eax=0xFD9A8 mainring.ico, edx=0x104, ebx=y, ecx=무기군)
   *   0x4B737  call 0x4AC28(eax=0xFDA12 special.ico,  edx=0x118, ebx=y, ecx=[+0x82])
   *   ```
   *   무기군 1~5 는 본 링의 `SP_SWORD…SP_FIST` 항목 번호와 **같은 번호**다
   *   (`ring.js MAIN`) — 그래서 `mainring.ico` 에서 바로 꺼낼 수 있다.
   *   ★ 그림이 아직 안 왔으면 **아무것도 안 그린다** — 없는 글씨를 대신 넣지 않는다. */
  var sp = ai.special;
  if (sp != null && (sp | 0) !== 0xFF) {
    var Rg2 = root.G2Ring;
    var grp = Rg2 && Rg2.aiSpecialGroupOf ? Rg2.aiSpecialGroupOf(sp | 0) : -1;
    var ico = Rg2 && Rg2.aiSpecialIconOf ? Rg2.aiSpecialIconOf(sp | 0) : -1;
    var 꺼내기 = (Rg2 && Rg2['아이콘그림'])
      ? function (m, i) { return Rg2['아이콘그림'](m, i, 0); }
      : function () { return null; };
    var g그림 = 꺼내기('mainring', grp), s그림 = 꺼내기('special', ico);
    /* 0x4AC28 — x = edx + 레코드[+0x0D](ax) · y = ebx + 레코드[+0x11](ay) + 1 (0x4AC79 inc edx)
     *   ☠ 전에는 앵커를 빼고 (0x104, y+0x0C) 에 왼위를 붙여 자리가 어긋났다 (2026-10-01 사장님 「필살기 아이콘 위치도 잘못됐다고」) */
    var 앵커 = function (m, i) {
      var a = Rg2 && Rg2['아이콘앵커'] ? Rg2['아이콘앵커'](m, i, 0) : null;
      return a || { ax: 0, ay: 0 };
    };
    var ga = 앵커('mainring', grp), sa = 앵커('special', ico);
    if (g그림) ctx.drawImage(g그림, AI_BAR.spGroupX + ga.ax, y + AI_BAR.spDy + ga.ay + 1);   // 0x4B71D
    if (s그림) ctx.drawImage(s그림, AI_BAR.spIconX + sa.ax,  y + AI_BAR.spDy + sa.ay + 1);   // 0x4B737
  }
  return this;
};

/* ── 스테이터스 · 장비 창 ───────────────────────────────────────────── */

Hud.prototype.showStatus = function (unit) {
  this.status = unit || null; this.statusPage = 0; return this;
};
/** 열린 유닛 상태창과 관련 입력 영역을 숨긴다. */
Hud.prototype.hideStatus = function () {
  this.status = null; this.statusPage = 0;
  this._drag = null; this._iname = null; this._warn = null;
  return this;
};
/**
 * MORE 2페이지가 스스로 닫히기까지 — `0x48BAF eax = 0xBB8` → `0x499EF` (3000틱).
 *
 * 사용자 확인 2026-08-15: 「원본의 경우 미션설명, more창 **시간제한**이 있어.
 * 일정시간이 지나면 미션설명이 닫히고 스토리가 진행되거나 옵션에서 보는 경우
 * 옵션창으로 돌아가. **more 창은 스테이터스창으로 돌아가.**」
 *
 * 시나리오 조건도 같은 값이다(`0x49463`) — `OBJECTIVE_MS` 와 같은 ≈17초.
 */
var MORE_MS = Math.round(0xBB8 / TICK_HZ * 1000);

/** MORE ↔ BACK. 아군만 2페이지가 있습니다 (0x48BC1 안에서만 그립니다). */
Hud.prototype.toggleStatusPage = function () {
  if (!this.status || statusKind(this.status) !== 'ally') return this.statusPage | 0;
  this.statusPage = (this.statusPage | 0) ? 0 : 1;
  this._pageAt = this.statusPage ? Date.now() : 0;      // 0x48BAF 시간 제한 시작
  return this.statusPage;
};
/** 유닛 상태창이 현재 표시 중인지 반환한다. */
Hud.prototype.statusVisible = function () { return !!this.status; };

/** 유닛의 능력치 3층. state.js 의 `unit.eff.layers` 를 그대로 씁니다. */
function layersOf(u) {
  var L = (u.eff && u.eff.layers) || {};
  return { base: L.base || {}, equip: L.equip || {}, buff: L.buff || {} };
}

/** Status 창에 찍을 값 — 8칸. */
function statValue(u, key) {
  var e = u.eff || {};
  switch (key) {
    case 'str': return e.str != null ? e.str : (u.base && u.base.str);
    case 'int': return e.int != null ? e.int : (u.base && u.base.int);
    case 'agi': return e.agi != null ? e.agi : (u.base && u.base.dex);
    case 'cha': return e.cha != null ? e.cha : (u.base && u.base.cha);
    case 'atk': return e.atk; case 'def': return e.def;
    case 'mr':  return e.mr;
    case 'tp':  return e.maxTp != null ? e.maxTp : (u.rawMaxTp | 0);   // 상태창 TP = 최대TP(+0x54), 현재TP 아님
  }
  return 0;
}

/** 아군인가 — 0x493BD `byte[유닛+0x0E] == 1`. */
function isAllyUnit(u) { return (u && (u.side | 0)) === 1; }

/**
 * 상태창의 종류 — 0x493A3.
 * @returns {'ally'|'enemy'} 아군은 장비까지 만지는 전체 화면(0x48E90 → 0x48BC1),
 *   그 밖(우군 2 · 적군 3 · 몬스터 4)은 **윗부분만**(0x48734) 띄우고 잠시 뒤 닫힙니다.
 */
function statusKind(u) { return isAllyUnit(u) ? 'ally' : 'enemy'; }

/**
 * 스테이터스 창.
 *
 * 아군과 적군이 다릅니다 (0x493A3) —
 *   **아군** 0x48BC1 : 윗부분 + Status 창(능력치 8칸) + 아이템 칸 + MORE 버튼
 *   **적군** 0x48734 : 윗부분만 — 초상화 · 이름 · 직업 · LV/HP/MP/EXP.
 *                      능력치도 장비도 안 보여 줍니다.
 * 원본은 바탕을 덮지 않고 맵 위에 그대로 얹습니다.
 *
 * @param {object} opts  `{kind}` 로 강제할 수 있습니다 (기본은 유닛 진영에서 정합니다)
 */
/**
 * 초상화 한 장 — 0x48132.
 * 앵커가 (−w/2, −h/2) 이므로 `blit(..., 76, 120, true)` 하나면 한가운데 정렬입니다.
 * 높이가 0x78 을 넘는 프레임만 `y + 0x3C − h` 로 아래쪽 정렬합니다 (0x48264).
 */
Hud.prototype.portrait = function (ctx, unit) {
  var L = STATUS_LAYOUT.portrait;
  var n = (unit && unit.portrait != null) ? (unit.portrait | 0) : -1;
  var f = (n >= 0) ? this.assets.frame(L.file, n) : null;
  if (!f) {                                   // 번호가 없거나 자산이 없을 때의 자리표
    ctx.save();
    ctx.fillStyle = this.assets.color(0);
    ctx.fillRect(L.x - 36, L.y - 44, 72, 88);
    ctx.strokeStyle = this.assets.color(0x29);
    ctx.strokeRect(L.x - 35.5, L.y - 43.5, 71, 87);
    ctx.restore();
    this.text(ctx, 'NO PORT', L.x - 21, L.y - 3, 0x18, 1);
    return this;
  }
  /* ★ 세로는 **가운데가 아니라 바닥** 기준입니다.
   *
   *   원본을 js-dos 로 띄워 듀란(초상화 41 · w103 h111)을 재보면 그림이
   *   y 9 ~ 120 에 옵니다. 즉 `top = 120 − h`, 앵커 y 가 바닥입니다.
   *   가운데로 잡으면 top 이 65 가 되어 **53픽셀 아래로 밀립니다** — 이름(y 93)이
   *   눈 근처에 찍히고 액자가 LV 창까지 덮어씁니다. 실제로 그렇게 어긋나 있었습니다.
   *   (0x48264 의 `y + 0x3C − h` 는 이 관측과 맞지 않아 문서 쪽을 관측으로 고칩니다.)
   *
   *   가로는 그대로 가운데(−w/2)입니다 — 원본에서 그림이 x 25~120, 중심 76 입니다.
   */
  var im = this.assets.image(f.png);
  if (im && im.complete && im.naturalWidth) {
    var px = L.x + (f['앵커'] ? f['앵커'][0] : -(f.w >> 1));
    var py = L.y - (f.h | 0);
    ctx.drawImage(im, px, Math.max(0, py));
  }
  return this;
};

/**
 * MORE 2페이지 — 0x48863 「Special attack / Magic」 창.
 *
 * ```asm
 * 0x4887E  0x454B3(카메라)               ; 맵을 다시 그리고
 * 0x488A3  0x5F3FD([0xFD7E0], [0xFD7DC]+0xA0, [0xFD7DE]+0x64)   ; MENUSTAT[40]
 * 0x488BE  0x60944(0xE9, 0x0B, 1, 7, "%3d", byte[+0x3F])        ; 마법 숙련? 두 자리
 * 0x488D7  0x60944(0xE8, 0x0A, 1, 0x18, "%3d", byte[+0x3F])
 * 0x488F2  필살기 숙련 [+0x38] 개 아이콘을 x 0x21 부터 0x15 씩 (y = 0x6D)
 * 0x4894C  [+0x39] 개 …  0x489B3  [+0x3A] 개 …  (줄마다 y += 0x18)
 * ```
 * 아이콘 번호는 `0x4AC28` 에 넘어가는 값이라 SPECIAL.ICO 의 슬롯+1 입니다.
 *
 * ### 2026-08-15 전면 재측정 (사용자 지적: 「칸 맞춰서 배치해 줘」)
 *
 * 이올린에게 마법·필살기를 전부 넣고 보니 아이콘이 창 밖으로 흘러넘치고 마법이
 * 겹쳐 그려졌다. 원인은 **x 와 y 를 뒤바꿔 넣은 것**이었다 — `0x488DC edi = 0x21`
 * 은 y, `0x488E1 edx = 0x6D` 은 x 인데 반대로 읽었다. 마법은 세로가 아니라
 * **가로 한 줄**이고 y 는 0xAA 고정이다.
 *
 * 실측으로 맞은 것: 이올린 `필살기숙련 [7,4,4,4,6]` 이 원작 화면의 줄별 칸 수
 * 7·4·4·4·6 과 같고, `필살경험 10` · `마법경험 0` 이 EXP 10 · EXP 0 과 같다.
 *
 * 좌표는 전부 `STATUS_LAYOUT.page2*` 주석에 주소와 함께 적어 뒀다.
 */
Hud.prototype.drawStatusPage2 = function (ctx, unit, T) {
  unit = unit || this.status;
  if (!unit) return this;
  var L = STATUS_LAYOUT, P = L.page2Rows, M = L.page2Magic, E = L.page2Exp;
  var raw = unit._raw || {};
  this.blit(ctx, MENUSTAT.file, MENUSTAT.skillWin, L.page2.x, L.page2.y, true);

  /* ① 필살기 문장 5줄 — 줄별 개수 `[+0x38]`~`[+0x3C]`, 첫 번호 1/8/12/16/20.
   *
   *    ★ `0x4AC28` 에 넘어가는 `ecx` 가 곧 **SPECIAL.ICO 프레임 번호**다.
   *      0번이 초필살기 「超」이므로, 전에 `− 1` 로 슬롯을 만들어 넣는 바람에
   *      **한 칸씩 밀려** 검계열 첫 칸에
   *      「연(連)」 대신 「초(超)」가 나왔다(사용자 지적 2026-08-15).
   *      슬롯 변환은 고를 때(`G2Ring.specialPick`)만 하고, **그릴 때는 번호 그대로**다.
   *
   *    ★ 그림은 **원본 `SPECIAL.ICO` 직독**이다(사용자 지적 2026-08-15: 「png 안 돼
   *      원본에서 불러와」). 링이 `setNativeIcons` 로 이미 구워 둔 것을
   *      `G2Ring.iconMeta` 로 꺼내 쓴다 — 추출 PNG 는 색 0(검정)을 투명으로 구워
   *      글자 속이 뚫린다. 자리도 원본처럼 **프레임 앵커** 기준이다
   *      (`0x4AC41 edi += [eax+0xD]` · `0x4AC5D edx += [eax+0x11]`). */
  var Rg = root.G2Ring;
  var 숙련 = unit.skillExp || raw['필살기숙련'] || [];          /* 지금 값 — raw 는 전투 진입 때 레코드 (2026-10-02) */
  for (var r = 0; r < 5; r++) {
    var cnt = 숙련[r] | 0, y = P.y0 + r * P.dy;
    for (var i = 0; i < cnt; i++) {
      var icon = P.base[r] + i;                          // 0x488F6 inc eax → 1 부터
      var meta = Rg && Rg.iconMeta ? Rg.iconMeta('special', icon, 0) : null;
      if (meta && meta.canvas)
        ctx.drawImage(meta.canvas, P.x0 + i * P.dx + (meta.ax | 0),
                      y + (meta.ay | 0) + P.dyFix);
    }
  }

  /* ② 마법 7계열 — 가로 한 줄.
   *
   * ★ 문장(그림)과 아래 숫자는 **조건이 다르다** (사용자 지적 2026-08-15:
   *   「직업에서 클래스를 1 올려 주는 경우 **문장이 없어도** 1클래스 마법을 쓸 수
   *   있어. 그 부분 MORE 창에 표시되어야 해. 듀란은 문장은 회복 1만 있지만 밑에
   *   숫자는 화염 1 빙한 1 전격 1 회복 2 이렇게 돼야 하는 거야.」)
   *
   * ```asm
   * 0x48B20  dl = [esi + 0x2E + s]          ; 문장 = 마법레벨
   * 0x48B23  test dl, dl ; jbe 0x48B64      ; ★ 0 이면 **그림만** 건너뛴다
   * 0x48B2C    eax = (dl − 1) × 7 + (41 + s)
   * 0x48B5F    call 0x5F3FD                 ;   문장 그리기
   * 0x48B64  call 0x28429(유닛, s) ; 0x48B6E eax += 1   ; ★ 숫자는 **언제나** 여기로 온다
   * 0x48B6F  test ax, ax ; jle 0x48B93      ;   0 이하일 때만 안 그린다
   * 0x48B8B    0x60944(x − 3, 0xBA, …)      ;   숫자 그리기
   * ```
   *
   * 곧 `0x28429`(= `magicClassOf`) 는 직업 보너스를 더하므로, 문장이 없어도
   * 보너스가 있으면 **1** 이 찍힌다. 전에는 `continue` 를 위에 걸어 숫자까지
   * 통째로 건너뛰었다 — 듀란이면 회복 칸만 나오고 나머지가 비었다. */
  var 마법 = unit.magicLv || raw['마법레벨'] || [];              /* 지금 값 — 위와 같다 */
  for (var s = 0; s < 7; s++) {
    var lv = 마법[s] | 0, mx = M.x0 + s * M.dx;
    if (lv > 0)                                          // 0x48B23  test dl,dl ; jbe
      this.blit(ctx, MENUSTAT.file, 41 + s + (lv - 1) * 7, mx, M.y, true);
    var cls = (Rg && Rg.magicClassOf) ? Rg.magicClassOf(this.battle, unit, s) : -1;
    if (cls + 1 > 0)                                     // 0x48B6F  test ax,ax ; jle
      this.text(ctx, String(cls + 1), mx + M.lvDx, M.lvY, E.색, 1);
  }

  /* ③ EXP 두 개 — 그림자를 먼저, 본체를 그 위에. `%3d` 라 폭 3 오른쪽 정렬. */
  /* ★ 살아 있는 유닛 값 — raw 는 전투 진입 때 레코드라 레벨업으로 오른 경험치가 안 보였다 (2026-10-02 사장님 「레벨업 해도 마법 경험치를 안얻는다고」) */
  this.expNumber(ctx, (unit.wexp != null ? unit.wexp : raw['필살경험']) | 0, E.spX, E.spY);      // 0x488BE · 0x488D7  [+0x3F]
  this.expNumber(ctx, (unit.mexp != null ? unit.mexp : raw['마법경험']) | 0, E.mgX, E.mgY);      // 0x48ACE · 0x48AEC  [+0x3E]
  /* 2페이지에는 MORE/BACK 을 그리지 않는다. */
  return this;
};

/** `%3d` 를 그림자와 함께. 그림자가 오른쪽 아래 1px (0x488BE 색 7 → 0x488D7 색 0x18). */
Hud.prototype.expNumber = function (ctx, v, x, y) {
  var E = STATUS_LAYOUT.page2Exp;
  var s = String(v | 0); while (s.length < 3) s = ' ' + s;     // %3d
  this.text(ctx, s, x + E.dx, y + E.dy, E.그림자색, 1);
  this.text(ctx, s, x, y, E.색, 1);
  return this;
};

/** MORE 버튼 히트 판정 — MENUSTAT[39] 81×22, 앵커 (256,184) → 좌상단 (216,173) */
Hud.prototype.moreHit = function (lx, ly) {
  var f = this.assets.frame(MENUSTAT.file, MENUSTAT.moreBtn);
  var L = STATUS_LAYOUT.more;
  var w = f ? (f.w | 0) : 81, h = f ? (f.h | 0) : 22;
  /* ★ 폴백 `−40`·`−11` 은 눈대중이 아니라 **원본 자산의 앵커 그 자체**다.
   *   브라우저에서 `assets.frame('MENUSTAT.SYB', 39)` 를 실제로 불러 재니
   *   **크기 81×22 · 앵커 [−40, −11]** — 위 `w`·`h` 폴백(81·22)까지 한 벌로 맞는다
   *   (2026-09-09 실측. 주석을 믿은 것이 아니라 자산에서 읽었다). */
  var x = L.x + (f ? f['앵커'][0] : -40), y = L.y + (f ? f['앵커'][1] : -11);   /* MENUSTAT.SYB[39] 앵커 실측 */
  return lx >= x && lx < x + w && ly >= y && ly < y + h;
};

/* ══════════════ 장비 칸 — 아이콘 · 히트 판정 · 끌어놓기 (`0x48E90`) ══════
 *
 * 원본은 아군 스테이터스(`0x48BC1`) 위에서 아이템 칸을 **끌어다 놓아** 장비를
 * 바꿉니다. 판정과 맞바꾸기 규칙은 `item.js swapEquip` 에 있고(원본 `0x49033`),
 * 여기서는 **그림과 손놀림**만 맡습니다.
 *
 * ```asm
 * 0x48F18  x 0x94(148) ~ 0x123(291)      0x48F30  y 0x91(145) ~ 0xAB(171)
 * 0x48F4A  칸 = (x − 148) / 0x1D(29)
 * 0x48F6E  빈 칸은 못 집는다
 * 0x48F82~ 집은 아이콘을 커서에 붙여 끌고 다닌다
 * ```
 */
var ITEM_SPR = 'ITEM.SPR';

/** `ITEM.SPR` 아이콘 공급자 — **원본 직독**(`decodeNC2` 124프레임). */
Hud.prototype._아이템그림공급자 = function () {
  if (this._ispr !== undefined) return this._ispr;
  this._ispr = null;
  var self = this;
  (function () {
    var N = root.G2Native;
    if (!N || typeof fetch !== 'function') { self._ispr = false; return; }
    (async function () {
      try {
        var pal = (self.render && self.render.팔레트 && self.render.팔레트()) || null;
        if (!pal) {
          var pr = await fetch(G2URL('GENESIS.PAL'));
          if (!pr.ok) throw new Error('GENESIS.PAL ' + pr.status);
          pal = N.decodePalette(new Uint8Array(await pr.arrayBuffer()));
        }
        var r = await fetch(G2URL(ITEM_SPR));
        if (!r.ok) throw new Error(ITEM_SPR + ' ' + r.status);
        var d = N.decodeNC2(new Uint8Array(await r.arrayBuffer()));
        if (!d || !d.frames.length) throw new Error(ITEM_SPR + ' 디코드 실패');
        /* [리마스터] 덧 아이템 아이콘(js/extitem.js · 코드 125~)을 ITEM.SPR 프레임 뒤에 끼운다 — 전투 상태창 장비 5칸에 흑강검이 안 떴다 (11-13 사장님 「전투 스탯창에서 흑강검 아직도 안나와」)
         *   덧 json 이 아직 안 실렸으면(전투 직행 등) 여기서 먼저 싣는다 */
        var X = root.G2ExtItem;
        if (X && X.프레임끼우기) {
          try {
            if (!(X.있나 && X.있나()) && X.경로) { var jr = await fetch(G2URL(X.경로)); if (jr.ok) X.싣기(JSON.parse(await jr.text())); }
            X.프레임끼우기(d);
          } catch (e덧) {}
        }
        /* ★ 팔레트는 **굽기 직전에** 다시 읽는다 — fetch 사이에 바뀔 수 있다
         *   (`CHR_EFFC.SYB` 에서 같은 함정에 빠진 적이 있다). */
        var pal2 = (self.render && self.render.팔레트 && self.render.팔레트()) || pal;
        self._isprRaw = d.frames;
        self._ispr = N.spriteCanvasProvider(d.frames, pal2);
      } catch (e) {
        console.error('[아이템] 아이콘 직독 실패:', ITEM_SPR, e && e.message);
        self._ispr = false;
      }
    })();
  })();
  return null;
};

/** 아이콘 한 장을 논리 좌표에 그린다. 코드는 1부터(표와 같은 규칙). */
Hud.prototype.drawItemIcon = function (ctx, code, cx, cy) {
  code = code | 0;
  if (!code) return false;
  var prov = this._아이템그림공급자();
  if (!prov) return false;
  var f = prov(code - 1);                      // 프레임은 0부터
  if (!f || !f.canvas) return false;
  /* 칸 한가운데에 놓는다 — 아이콘마다 크기가 다르다. */
  ctx.drawImage(f.canvas, Math.round(cx - f.w / 2), Math.round(cy - f.h / 2), f.w, f.h);
  return true;
};

/**
 * 아이템 칸 히트 판정 — `0x48F18` · `0x48F30` · `0x48F4A`.
 * @returns {number} 칸 0~4, 밖이면 −1
 */
Hud.prototype.itemHit = function (lx, ly) {
  var H = STATUS_LAYOUT.itemHit;
  if (lx < H.x1 || lx > H.x2 || ly < H.y1 || ly > H.y2) return -1;
  var n = Math.floor((lx - H.x1) / H.step);
  return (n >= 0 && n <= 4) ? n : -1;
};

/**
 * 장비 경고 문구 — `0x48083` **전체 재확인** (2026-08-14, 사용자 지적 4건).
 *
 * 사용자: 「그냥 시커먼 색 아니고 **대화창처럼 음영**이야」 · 「글자체도 **이름
 * 글자체**랑 같은 거고」 · 「**노란 글씨에 검정 테두리**」 · 「떠 있는 **지속
 * 시간도 달라**」 — 넷 다 맞았다. 아래가 원본 루틴 전문이다.
 *
 * ```asm
 * 0x480A1  call 0x61F25                 ; sprintf(0x8A784, …)
 * 0x480A6  call 0x5F839                 ; ★ 그리기 대상 = VGA 실화면(0xA0000)
 * 0x480B2  call 0x6104A(ax = 0)         ; ★ 리맵 표 **0번** 선택
 * 0x480C1  call 0x5ECC7(al = 1)         ; ★ 채우기 방식 = 0x5EE2B = **리맵**
 * 0x480C8  call 0x5EDDE(0, 0x50, 0x13F, 0x78)   ; (0,80)-(319,120) 리맵 ①
 * 0x480E3  call 0x5EDDE(   〃    )               ;        〃          리맵 ②
 * 0x480EF  call 0x5ECC7(al = 0)         ; 채우기 방식 되돌리기
 * 0x480F9  repne scasb                  ; 바이트 길이
 * 0x480FE  ecx <<= 2 · 0x48106 ebx = 0xA0 − ecx ; ★ x = 160 − len×4 (= 가운데)
 * 0x48108  push 0x5C                    ; ★ y = 92
 * 0x4810E  call 0x5E048 → 0x5DD5B       ; ★ **조합형 글자 그리기** (이름과 같은 것)
 * 0x4811B  call 0x499EF(ax = 0x5A)      ; ★ **90틱** 또는 아무 입력까지
 * 0x48120  call 0x5F804 · 0x48125 call 0x5E9E8   ; 오프스크린으로 되돌리고 다시 뿌림
 * ```
 *
 * ### ★ 「음영」의 정체 — 리맵 표
 *
 * `0x5EE2B` 은 **화면 픽셀을 읽어 표로 치환**한다(칠하는 게 아니다).
 * 표는 시작할 때 `0x55C59` 가 굽는다.
 *
 * | 표 | 만든 곳 | 인자 | 뜻 |
 * |---|---|---|---|
 * | **0** | `0x55C6C` | `0x6106C(ax=0, bl=0x3C, dx=0)` | 검정과 **60 % 섞기** → 밝기 40 % |
 * | 1 | `0x55C7D` | `0x6106C(ax=1, bl=0x1E, dx=1)` | 흰색과 30 % 섞기 |
 * | 2 | `0x55C8C` | `0x610B6(ax=2, dx=0x0E)` | 다른 종류(단색화) |
 *
 * 섞는 식은 `0x609F9` 다 — `새RGB = 원색 × (100−강도)/100 + 목표색 × 강도/100`
 * 뒤에 가장 가까운 팔레트 색을 찾는다(`0x6098B` 가 목표색 몫을 미리 계산).
 *
 * **표 0 을 두 번** 통과하므로 남는 밝기는 `0.4 × 0.4 = 0.16` — 곧 캔버스에서는
 * 검정을 **84 %** 알파로 덮는 것과 같다. 정보 바(`infoBar`)가 한 번(60 %)인
 * 것과 대비된다. 그래서 사용자 눈에 「시커멓지 않고 음영」으로 보인 것이다.
 *
 * ### 글자
 *
 * `x = 160 − 바이트수 × 4` 는 **바이트당 8px** — 조합형 한글 한 자(2바이트)가
 * 16px 이라는 뜻이고, 이름을 찍는 `koreanOutlined`(NEWHAN.FNT 16×16)와 같다.
 * 색은 사용자 관측대로 **노랑 `0x11`(246,222,113) + 검정 테두리 `0`** 이다.
 *
 * 스테이터스 화면 **위에** 그려야 보인다 — `drawStatus` 맨 끝에서 부른다.
 */
var WARN = {
  x1: 0, x2: 319, y1: 80, y2: 120,        // 0x480AD · 0x480BC · 0x480CD
  ty: 92,                                  // 0x48108  push 0x5C
  글자: 0x11, 테두리: 0, 글꼴: 16,          // 노랑 + 검정 (사용자 관측)
  남길밝기: 0.4, 겹수: 2,                   // ★ 표 0 을 두 번 (0x480C8 · 0x480E3)
  틱: 0x5A                                 // 0x48116  eax = 0x5A → 0x499EF
};
/** 90틱 → ms. TICK_HZ 175.47 → 약 513 ms. */
var WARN_MS = Math.round(WARN.틱 / TICK_HZ * 1000);
/** `0x48083` 은 **범용 안내 상자**다 — `equipWarn` 과 같은 것의 제 이름. */
Hud.prototype.notice = function (v) { return this.equipWarn(v); };
/** 장비 판정값에서 원본 경고 표식 종류를 결정한다. */
Hud.prototype.equipWarn = function (v) {
  if (v === undefined) return this._warn || null;
  this._warn = v ? { text: String(v), at: Date.now() } : null;
  return this;
};
/**
 * ★ 멜트 아이템 — 「[이름] 소멸」 (원본 `0x2C1A1`~`0x2C271` · 2026-09-24 직독)
 *   같은 띠(`0x6104A` · `0x5ECC7(1)` · `0x5EDDE(0,80,319,120)` 두 번 = 위 `WARN`)에
 *   아이템 그림(`0x2C241 call 0x5F3FD` · 표 `0xEFDB4` · 프레임 = 코드−1)과
 *   글자(`0x2C25F call 0x5E048` · 형식 `0x7783F` = "[%s] 소멸" · y `0x5C`)를 얹는다.
 *     글자 왼쪽 x = 0x7C − 4×길이 + 0x1E · 그림 x = 0x7C − 4×길이 + 0xC + ox · 그림 y = 0x7C + oy
 *     길이 = 한글 이름(`0x184CA` dx=0 → 레코드 +1)의 **바이트 수**(조합형 — 한글 2 · 그 밖 1)
 *   ★ 대기(300틱 · `0x499EF`)는 부르는 쪽이 한다 — 여기선 스스로 사라지지 않는다.
 * @param {number} code 아이템 코드 (0 이면 지운다)
 */
Hud.prototype.소멸알림 = function (code) {
  code = code | 0;
  if (!code) { this._warn = null; return this; }
  var It = root.G2Item, it = It && It.at ? It.at(code) : null;
  var 이름 = (it && it.이름) || '';
  var 길이 = 0;
  for (var i = 0; i < 이름.length; i++) 길이 += (이름.charCodeAt(i) > 0x7F) ? 2 : 1;
  this._warn = { text: '[' + 이름 + '] 소멸', at: Date.now(), 고정: true, 아이템: code, 길이: 길이 };
  return this;
};
/** 현재 장비 경고 상태를 지정 HUD 문맥에 그린다. */
Hud.prototype.drawEquipWarn = function (ctx) {
  var w = this._warn;
  if (!w) return this;
  if (!w.고정 && Date.now() - w.at > WARN_MS) { this._warn = null; return this; }   // 0x499EF(0x5A)
  var N = WARN;

  /* ① 배경 — **음영**이다. 표 0(밝기 40 %)을 겹수만큼 통과시킨 것과 같게,
   *    검정을 `1 − 0.4^겹수` 알파로 덮는다. (0x480C1 al=1 → 0x5EE2B 리맵) */
  ctx.save();
  /* ★★★★★ **검정이 아니라 회색을 덮는다** — 원본 `+9` 를 살린다 (2026-09-05)
   *   ☠ 여기 `rgba(0,0,0,…)` 였다. 원본 리맵은 `v × keep + 9`(0~63)라
   *     **검은 자리도 들린다**(`0x60A3F add eax,9`). 검정을 덮으면 그 몫이 빠진다.
   *   ★ 겹수만큼 통과한 결과 —  `k = 남길밝기^겹수` ·
   *     보정은 `c + c·남길밝기 + …` 로 쌓이므로 등비합 `c × (1−남길밝기^겹수)/(1−남길밝기)`.
   *     알파로 옮기면 `a = 1 − k` · 덮는색 = `쌓인보정×4 / a`.
   *   ☠ 팔레트 스냅(`0x60AE5`)은 알파로 못 낸다 — 밝기만 맞춘다. */
  var _k = Math.pow(N.남길밝기, N.겹수);
  var _a = 1 - _k;
  var _쌓인 = (Hud.리맵보정 || 9) * (1 - _k) / (1 - N.남길밝기);
  var _덮 = _a > 0 ? Math.min(255, Math.round(_쌓인 * 4 / _a)) : 0;
  ctx.fillStyle = 'rgba(' + _덮 + ',' + _덮 + ',' + _덮 + ',' + _a.toFixed(3) + ')';
  var E = this.화면끝();                       /* ★ [N-13] 폭을 꽉 채우던 띠 → 확장 폭까지 */
  ctx.fillRect(E.L, N.y1, E.W, N.y2 - N.y1 + 1);
  ctx.restore();

  /* ② 글자 — 이름과 같은 조합형 픽셀폰트, 가운데(160) 정렬, 노랑 + 검정 테두리.
   *    (0x48106 x = 160 − len×4 · 0x48108 y = 0x5C · 0x4810E → 0x5DD5B) */
  if (w.아이템) {
    /* 멜트 — 그림과 왼쪽 기준 글자 (위 `소멸알림` 주석). 글자 가운데 = 왼쪽 + 8×(길이+7)/2 */
    var 왼 = 0x7C - 4 * (w.길이 | 0);
    var prov = this._아이템그림공급자(), f = prov ? prov((w.아이템 | 0) - 1) : null;
    if (f && f.canvas) ctx.drawImage(f.canvas, 왼 + 0xC + (f.ax | 0), 0x7C + (f.ay | 0), f.w, f.h);   // 0x2C241
    this.koreanOutlined(ctx, w.text, 왼 + 0x1E + 4 * ((w.길이 | 0) + 7), N.ty, N.글자, N.테두리, N.글꼴);  // 0x2C25F
    return this;
  }
  this.koreanOutlined(ctx, w.text, 160, N.ty, N.글자, N.테두리, N.글꼴);
  return this;
};

/* ★ 못 넣는 칸의 **빨간 ×** 는 뺐다 (2026-08-14).
 *   사용자 판단: 「빨간 X 는 **월드맵 용**인 것 같아. 일단 여기에서는 없애 줘.」
 *   원본 전투(`0x48E90`)의 끌기 루프가 `0x1832D` 를 부르지 않는 것과도 맞는다 —
 *   전투 장비창은 **놓았을 때 문구**(`0x48083`)로만 알린다.
 *   월드맵(`CHP.EXE`) 장비창을 팔 때 다시 본다. */

/**
 * 아이템 **이름표** — `0x49100` ~ `0x491AF`.
 *
 * 사용자 지적 2026-08-14: 「아이템 **클릭 시 이름이 떠**.」 원본은 집었다가
 * **같은 칸에 도로 놓으면**(= 그냥 클릭) 아이콘 아래에 작은 상자와 이름을 그린다.
 *
 * ```asm
 * 0x49124  call 0x184CA (edx = 1)       ; 레코드의 **영문 이름**(+0x10) 포인터
 * 0x4912F  repne scasb                  ;   길이를 잰다
 * 0x49139  edx = 글자수 × 6 + 4         ;   상자 폭 (6px 글꼴)
 * 0x4913C  eax = 칸 × 0x1D + 0xB4       ;   오른쪽 끝
 * 0x49149  eax −= edx                   ;   → 왼쪽 끝
 * 0x49150  색 3 → 0x4917E 사각 (y 170~178)   ; 윗판
 * 0x49183  색 5 → 0x491A0 사각 (y 171~179)   ; 그림자 (1px 밀림)
 * 0x491A5  색 2 → 0x491C1 사각 (y 171~178)   ; ★ 안쪽 바탕 — 밝은 회색
 * 0x491D0  **글자 색 5** · 0x491D4 y 0xAC(172)
 * ```
 * 팔레트: 2 = (211,215,223) 밝은 회색 · 3 = (170,178,190) · 5 = (89,97,121) 어두움.
 * ★ 사용자 지적: 「글씨는 박스와 글자 색이 달라. **글자가 어두운 게 원본**」
 */
var NAME_BOX = { y1: 170, y2: 179, ty: 172, right: 180, step: 29, cw: 6, pad: 4,
                 윗판: 3, 그림자: 5, 바탕: 2, 글자: 5 };

/** 이름표를 띄운다(`null` 이면 지운다). */
Hud.prototype.itemName = function (v) {
  if (v === undefined) return this._iname || null;
  this._iname = v || null;
  return this;
};

/** 이름표 한 장 — `0x49139` 의 폭 계산과 `0x4917E` 의 상자를 그대로. */
Hud.prototype.drawItemName = function (ctx, cell, code) {
  var It = root.G2Item;
  /* ☠★★★★★ **표가 둘인데 색인 규약이 다르다** (2026-09-08 · 사장님 지적으로 다시 잡음)
   *
   *   > 사장님: 「**스테이터스창 아이템 영어이름이 밀렸어. 명왕검이 듀렌달로 나와**」
   *
   *   실측(2026-09-08) —
   *   | 표 | 길이 | 규약 |
   *   |---|---|---|
   *   | `G2Item.table` (여기서 쓰는 것) | **125** | **`table[코드]`** — `table[0x22].코드 === 0x22` |
   *   | `battle.T['아이템']` (`itemRec` 이 쓰는 것) | **124** | `T[코드 − 1]` |
   *
   *   ☠ 2026-08-30 에 「원본 `0x184D2 dec edx` 니까 −1」이라며 여기를 `T[code − 1]` 로
   *     바꿨는데 **틀렸다.** 원본의 `dec` 는 **원본 메모리 배열**(0 부터) 이야기이고,
   *     `G2Item.table` 은 만들 때 이미 **코드 = 색인**이 되게 맞춰 둔 표다.
   *     그래서 명왕검(코드 `0x22`)을 넣으면 `table[0x21]` = **듀렌달**이 나왔다 —
   *     사장님이 보신 그 증상이다.
   *   ★ `itemRec()`(위)은 **다른 표**를 보므로 `−1` 이 맞다. 헷갈리지 말 것. */
  var it = It && It.at ? It.at(code | 0) : null;
  if (!it) return this;
  var 글 = (it.영문 || it.이름 || '').toUpperCase();
  if (!글) return this;
  var N = NAME_BOX;
  var w = 글.length * N.cw + N.pad;                 // 0x49139
  var x2 = (cell | 0) * N.step + N.right;           // 0x4913C
  var x1 = x2 - w;                                  // 0x49149
  this.fillRect(ctx, x1, N.y1, x2, N.y2 - 1, N.윗판);           // 0x4917E  색 3
  this.fillRect(ctx, x1 + 1, N.y1 + 1, x2 + 1, N.y2, N.그림자);  // 0x491A0  색 5
  this.fillRect(ctx, x1 + 1, N.y1 + 1, x2, N.y2 - 1, N.바탕);    // 0x491C1  색 2
  this.text(ctx, 글, x1 + 2, N.ty, N.글자, 1);                  // 0x491D0  색 5 · y 172
  return this;
};

/** 지금 끌고 있는 것 — `{ cell, code }` 또는 null. */
Hud.prototype.dragItem = function (v) {
  if (v === undefined) return this._drag || null;
  this._drag = v || null;
  return this;
};
/** 커서 자리 (논리 좌표) — 끌고 있는 아이콘을 여기에 그린다. */
Hud.prototype.dragAt = function (lx, ly) {
  this._dragXY = { x: lx | 0, y: ly | 0 };
  return this;
};

/** 유닛과 원본 표를 사용해 상태창 전체를 지정 문맥에 그린다. */
Hud.prototype.drawStatus = function (ctx, unit, T, opts) {
  unit = unit || this.status;
  if (!unit) return this;
  T = T || (this.battle && this.battle.T);
  var kind = (opts && opts.kind) || statusKind(unit);
  var L = STATUS_LAYOUT;
  /* MORE 를 누른 뒤(0x48863) — 아군만 2페이지가 있습니다 */
  if (this.statusPage === 1 && statusKind(unit) === 'ally') {
    this.drawStatusPage2(ctx, unit, T);
    효과덧그리기(this, ctx, unit, false);
    return this;
  }

  /* ── ① 윗부분 0x48734 — 아군·적군 공통 ─────────────────────────── */

  /* 초상화 0x48132(76, 120, byte[+0x10]) — PORTRAIT.SYF 를 그대로 씁니다 */
  this.portrait(ctx, unit);

  /* 이름 — 가운데 정렬 x = 76 − 글자수*4 (0x4876D `shl eax,2`)
   *
   * ★ 원본은 NEWHAN.FNT 16×16 조합형으로 찍습니다. 리마스터에서는 글꼴만 깔끔한
   *   것으로 바꾸고 **색·크기·자리는 원본 그대로** 맞춥니다.
   *   원본 화면에서 잰 값: 잉크 rgb(247,223,113) = 팔레트 0x11,
   *   외곽 rgb(247,199,85) = 0x12, 글자 높이 16, 중심 x 76, 윗변 y 88.
   *   예전에는 색 1(흰색)이라 흰 갑옷 위에서 아예 안 보였습니다. */
  var nm = String(unit.name || '').replace(/\s+$/, '');
  /* [리마스터 이름가운데] 그릴 때만 앞뒤 공백을 빼 정가운데로 — 세이브 이름은 안 바꾼다 · '원작' 이면 원본 0x48755 그대로(공백도 폭)
   *   (2026-10-10 사장님 「2번이 나을 것 같아 … 2번 적용시 공백제거후 가운데 정렬(세이브파일 내 이름을 바꾸지는 않음), 끄면 원본대로」 ·
   *    원본 명부 한 글자 이름 «    켄»·«    닌 »·«    릭»·«    쿤» 은 앞 공백 넷이라 원작도 오른쪽으로 치우친다) */
  try { var _O이 = root.Opt || root.G2Opt; if (_O이 && _O이.cfg && _O이.cfg['이름가운데'] === '리마스터') nm = nm.replace(/^\s+/, ''); } catch (e이) {}
  this.koreanOutlined(ctx, nm, L.name.cx, L.name.y - 5, L.name.color, L.name.shadow,
                      L.name.size, L.name.rightX);

  /* LV / HP / MP / EXP 창 36 */
  this.blit(ctx, MENUSTAT.file, MENUSTAT.lvWin, L.lv.x, L.lv.y, true);

  /* 직업 이름 — 0x4868A, 색 0x11.  x = 76 − 글자수*3 (0x487BF `imul ecx,3`)
   * ★ 원본 표 0x71118 은 **대문자 ASCII** 입니다 ("PALADIN"). CSS 폰트로 "Paladin"
   *   을 찍고 있어서 글꼴도 대소문자도 달랐습니다 — 원작 5×5 글꼴로 되돌립니다. */
  var job = (T && T['직업'] && T['직업'][unit.job] && T['직업'][unit.job]['이름']) ||
            ('JOB ' + (unit.job | 0));
  job = String(job).toUpperCase();
  if (/^[\x20-\x7E]*$/.test(job)) {
    this.textShadow6(ctx, job, L.jobName.cx - job.length * L.jobName.half,   // 0x4868A: 그림자 색6
              L.jobName.y, L.jobName.color, 1);
  } else {
    this.korean(ctx, job, L.jobName.cx - job.length * L.jobName.half,
                L.jobName.y, L.jobName.color, 10);
  }

  var V = L.lvValues, cV = V.color;
  var hp = Math.ceil((unit.hp | 0) / 100), mhp = Math.ceil((unit.maxHp | 0) / 100);
  /* 0x4868A — 4방향 외곽선(색6). 값은 **우측정렬**(사용자 확인: 원작에 가까움).
   *   우측 기준선 V.rightX(LV창 오른쪽 ≈123 에 붙임). 5×5 전진 6px. 미세조정은 V.rightX. */
  var RX = V.rightX || 114, adv = 6;   // 값 우측정렬 기준선(내부 프레임 기준). 미세조정은 V.rightX.
  function rput(self, s, y) { s = String(s); self.textShadow6(ctx, s, RX - s.length * adv, y, cV, 1); }
  rput(this, unit.level | 0, V.level[1]);
  rput(this, hp + '/' + mhp, V.hp[1]);
  rput(this, (unit.mp | 0) + '/' + (unit.maxMp | 0), V.mp[1]);
  /* ★★★★★ **실측으로 확정 (2026-08-29)** — `.SCE` 에 경험치가 없는 것이 맞다.
   *   294개 전수 · 유닛 **6766개**의 `+0x3D` 가 **전부 0** 이다
   *   (`sce.js parse` → `유닛그룹` → `_원본[0x3D]`).
   *   ⇒ 「원본 미확인」이 아니라 **원본 데이터에 값이 없다.**
   *     경험치는 `BLACKBOX` 쪽(저장 파일)에서 온다. */
  rput(this, unit.exp == null ? '0' : String(unit.exp), V.exp[1]);

  if (kind !== 'ally') { 효과덧그리기(this, ctx, unit, false); return this; }   // ★ 적군은 여기까지입니다 (0x493E2)

  /* ── ② 아군 전용 0x48BC1 ────────────────────────────────────────── */

  /* Status 창 37 + 능력치 8칸 */
  this.blit(ctx, MENUSTAT.file, MENUSTAT.statWin, L.stat.x, L.stat.y, true);
  /* ★ 능력치 8칸은 0x5E048 — **큰 글꼴(NEWASCII 8×16)**입니다.
   *   5×5 로 찍고 있어서 원본보다 절반 크기로 나왔습니다.
   *   원본에서 "60" 의 왼쪽 끝이 x 185 이므로 상수 177 은 5×5 기준이었습니다.
   *   큰 글꼴에서는 칸 안쪽 여백이 8px 더 필요합니다. */
  /* 능력치 수치 — 칸(32×23) 기준 **우하단 정렬**, 우·하단 약간(margin) 여백 + 검정 외곽선.
   *   칸 좌상단 = S.x[col]+bigDx, S.y[row]+bigDy. 칸 폭 statValueW, 높이 statCellH. */
  var S = L.statCells, i, SP = 2, MG = (S.margin == null ? 2 : S.margin);
  var VW = MENUSTAT.statValueW, VH = MENUSTAT.statCellH;
  for (i = 0; i < STAT_CELLS.length; i++) {
    var c = STAT_CELLS[i];
    var v = statValue(unit, c.key);
    var 효 = (v != null && root.G2상태효과표시) ? root.G2상태효과표시.수치(this, unit, c.key, v) : null;   /* [리마스터] 효과 반영 값·색 */
    if (효) v = 효.값;
    var s2 = v == null ? '-' : String(v);
    var cellL = S.x[c.col] + (S.bigDx || 0), cellT = S.y[c.row] + (S.bigDy || 0);
    var valW = s2.length * ASCII_W + (s2.length - 1) * SP;            // 마지막 글자 뒤 자간 제외
    var vx = cellL + VW - MG - valW;                                   // 우측정렬
    var vy = cellT + VH - MG - ASCII_H;                                // 하단정렬
    this.bigTextOutlined(ctx, s2, vx, vy, 효 ? 효.색 : S.color, SP, 0);   // 외곽선 검정(색0)
  }

  /* MORE 버튼 39 — 누르면 0x48863 의 2페이지로 갑니다 (drawStatusPage2) */
  this.blit(ctx, MENUSTAT.file, MENUSTAT.moreBtn, L.more.x, L.more.y, true);

  /* 아이템 칸 38 + 착용 가능 판정 (0x1832D) */
  this.blit(ctx, MENUSTAT.file, MENUSTAT.itemWin, L.item.x, L.item.y, true);
  var slots = this.equipReport(unit, T), I = L.itemIcons, k;
  /* MENUSTAT[38]에 무기·방패·장신구·보조·탈것 원작 칸 그림이 포함되어 있다.
   * 비원작 O/X/- 문자를 덧그리지 않는다. 장비 교체 판정은 equipReport에 유지한다. */

  /* ★ 낀 아이템 아이콘 — `ITEM.SPR` 직독. 순서는 화면 칸 차례
   *   (무기 `[+0x5B]` · 방패 `[+0x5A]` · 장신구 `[+0x5D]` · `[+0x5E]` · `[+0x5F]`)
   *   로 `전투UI_사양.md` §10-2 와 같다. `item.js` 의 `SCREEN` 이 그 차례다. */
  var It = root.G2Item, H = L.itemHit;
  if (It && It.SCREEN && unit.gear) {
    var 끄는칸 = (this._drag && this._drag.cell != null) ? (this._drag.cell | 0) : -1;
    for (k = 0; k < 5; k++) {
      if (k === 끄는칸) continue;                       // 집어 든 칸은 비워 둔다
      var key = It.keyOfScreen ? It.keyOfScreen(k) : null;
      var code = key ? (unit.gear[key] | 0) : 0;
      if (!code) continue;
      this.drawItemIcon(ctx, code, H.x1 + H.step * k + H.step / 2, (H.y1 + H.y2) / 2);
    }
  }
  /* 끌고 있는 아이콘은 커서를 따라다닌다 — `0x48F82` ~ `0x48FD7` */
  if (this._drag && this._drag.code && this._dragXY)
    this.drawItemIcon(ctx, this._drag.code, this._dragXY.x, this._dragXY.y);
  /* 클릭한 아이템의 이름표 — `0x49100` (끌고 있는 동안은 안 띄운다) */
  if (!this._drag && this._iname)
    this.drawItemName(ctx, this._iname.cell, this._iname.code);
  /* 안내 상자(`0x48083`)는 여기가 아니라 `draw` 맨 끝에서 그린다 —
   * 옵션 메뉴 위에도 떠야 하기 때문이다(사용자 원작 화면 2026-08-15:
   * 「저장중...」·「읽는중...」이 옵션 메뉴 위에 같은 띠로 뜬다). */

  /* (덤) 원본에 없는 우리 추가분 — 기본은 꺼 둡니다 */
  if (L.equip.show) {
    var ey = L.equip.y, bad = null;
    for (var m = 0; m < slots.length; m++) {
      var s = slots[m];
      this.korean(ctx, s.label, L.equip.x, ey + m * L.equip.lineH, 0x29, 9);
      this.korean(ctx, s.name || '없음', L.equip.x + 34, ey + m * L.equip.lineH,
                  s.code ? (s.ok ? 1 : 0x13) : 0x18, 9);
      if (s.code && !s.ok && !bad) bad = s;
    }
    if (bad) this.korean(ctx, bad.why, L.equip.x, ey + slots.length * L.equip.lineH, 0x15, 8);
  }
  if (L.layers.show) this.statLayers(ctx, unit, L.layers.x, L.layers.y);
  효과덧그리기(this, ctx, unit, true);
  return this;
};

/* [리마스터] 효과 아이콘 줄·설명창 — status_effects.js (옵션 효과표시 · '원작' 이면 아무것도 안 그린다)
 *   원본 스테이터스 창에는 없다 — 리마스터_적용현황.md */
function 효과덧그리기(self, ctx, unit, 능력치칸) {
  var F = root.G2상태효과표시;
  if (!F) return;
  F.덧그리기(self, ctx, unit, function (key) { return statValue(unit, key); }, 능력치칸);
}

/**
 * 능력치 3층 — 기본 / 장비 / 버프 / 합.
 * `unit.eff.layers` 는 state.js 가 만듭니다(원본은 합산값만 들고 있어 되돌릴 수 없었습니다).
 */
Hud.prototype.statLayers = function (ctx, unit, x, y) {
  var L = layersOf(unit);
  var cols = [
    { t: 'BASE', o: L.base }, { t: 'EQIP', o: L.equip },
    { t: 'BUFF', o: L.buff }, { t: 'TOT',  o: null }
  ];
  var rows = [
    { t: 'ATK', k: 'atk' }, { t: 'DEF', k: 'def' },
    { t: 'MR',  k: 'mr'  }, { t: 'MTP', k: 'maxTp' }
  ];
  var step = STATUS_LAYOUT.layers.colStep;
  var colX = [x + step, x + step * 2, x + step * 3, x + step * 4];

  for (var c = 0; c < cols.length; c++) this.text(ctx, cols[c].t, colX[c], y, 0x29, 1);
  for (var r = 0; r < rows.length; r++) {
    var yy = y + 10 + r * 9;
    this.text(ctx, rows[r].t, x, yy, 0x18, 1);
    var tot = 0;
    for (var c2 = 0; c2 < 3; c2++) {
      var v = cols[c2].o[rows[r].k] | 0;
      tot += v;
      this.text(ctx, (c2 && v > 0 ? '+' : '') + v, colX[c2], yy, c2 === 2 && v ? 0x30 : 1, 1);
    }
    this.text(ctx, String(tot), colX[3], yy, 0x2C, 1);
  }
  return this;
};

/**
 * 다섯 칸의 장비와 착용 가능 여부 — 0x1832D 를 그대로 씁니다.
 * @returns {{slot,label,code,name,ok,why}[]}
 */
Hud.prototype.equipReport = function (unit, T) {
  T = T || (this.battle && this.battle.T);
  var gear = unit.gear || {};
  var order = [
    { slot: 'weapon', label: '무기' },
    { slot: 'shield', label: '방패' },
    { slot: 'charm',  label: '장신구' },
    { slot: 'sub',    label: '보조' },
    { slot: 'mount',  label: '탈것' }
  ];
  return order.map(function (o) {
    var code = gear[o.slot] | 0;
    var rec = itemRec(T, code);
    if (o.slot === 'mount') {
      /* 탈것은 ITEM.DAT 아이템이 아닙니다 — 0x1832D 가 아예 안 봅니다 */
      return { slot: o.slot, label: o.label, code: code,
               name: code ? ('#' + code) : '', ok: true, why: '' };
    }
    var v = canEquip(unit, code, GEAR_SLOT[o.slot], T);
    return { slot: o.slot, label: o.label, code: code,
             name: rec ? rec['이름'] : '', ok: v.ok, why: v.why };
  });
};

/* ── 매 프레임 ──────────────────────────────────────────────────────── */

/**
 * 한 프레임 전부. 순서는 0x45431 · 0x454D5 그대로입니다.
 * @param {object} battle  없으면 init 때 준 것
 * @param {CanvasRenderingContext2D} ctx  없으면 내부 캔버스
 */
Hud.prototype.draw = function (battle, ctx) {
  battle = battle || this.battle;
  ctx = ctx || this.ctx;
  if (!ctx) return this;
  var CX = this.cx | 0, LW = this.logicalW || VIEW.w;
  var CY = this.cy | 0, LH = this.logicalH || VIEW.h;              /* ★ 세로 확장 (㉛) */
  ctx.clearRect(0, 0, LW, LH);
  if (!battle) return this;

  /* ★ [리마스터 N-13] 원점을 `cx` 만큼 밀어 **아래 모든 그리기가 원본 320 좌표**를
   *   그대로 쓰게 합니다. 창이 넓어져도 사기 막대 x=139, 구체 (250,38), 대사창
   *   (16,120)-(304,184) 같은 EXE 근거 좌표를 한 자리도 안 고칩니다.
   *   확장분(바 양끝 캡·여백)은 `-cx …  -cx+LW` 범위로 스스로 나갑니다. */
  /* ★ 세로도 같다 — `cy` 만큼 내려 원본 200 좌표를 그대로 쓴다 (2026-08-28 · ㉛) */
  if (CX || CY) ctx.save(), ctx.translate(CX, CY);
  var _ret = this._HUD본문그리기(battle, ctx);
  if (CX || CY) ctx.restore();
  /* ★ 음영 팔레트 배선은 **걷어냈다** (2026-09-10) — `화면음영()` 주석 참고.
   *   혹시 켜진 채 남았으면 **여기서 반드시 푼다.** */
  var _R = 현재렌더러();
  if (_R && _R.음영팔레트 && (_R._음영단계 | 0)) _R.음영팔레트(0);
  /* ★ 화면 전체 물들임(원본 0x5FD1C 256색) — HUD 도 DAC 로 그려지므로 같이 물든다. 그린 픽셀 위에만 덮는다 (render.js _화면물들임 · Z-73) */
  var _물 = _R && _R._물들임;
  if (_물 && _물.a > 0) {
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-atop';
    ctx.fillStyle = 'rgba(' + _물.색[0] + ',' + _물.색[1] + ',' + _물.색[2] + ',' + _물.a + ')';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }
  return _ret;
};

/** `draw()` 의 본체 — 좌표계는 언제나 원본 320×200 입니다. */
Hud.prototype._HUD본문그리기 = function (battle, ctx) {

  /* ★★★★★ **배치 화면 음영은 맵에만 걸린다** — `0x454D5` (2026-08-25 · 사용자 지적)
   *
   *   사용자: 「**음영처리 전반 문제(맵은 음영 되지만 사기바 턴바는 음영처리 없어야 함)**」
   *
   *   원본 순서:
   *   ```asm
   *   0x454E2  ecx=0xC4(196) · eax=0 · ebx=0x130(304)
   *   0x454EE  call 0x6104A          ; ★ 음영(리맵)  — (0,0)~(304,196)
   *   0x45513  call 0x12161          ;   맵 + 유닛
   *   0x45518  call 0x44DCC          ; ★ 상·하단 바 — **음영 뒤**라 밝게 남는다
   *   ```
   *   ⇒ 음영을 **바보다 먼저** 칠해야 한다. HUD 캔버스에서 맵은 아래 DOM 이므로
   *     캔버스 맨 처음 칠하면 맵만 어두워지고 그 위에 그리는 바는 밝다.
   *   ★ 전에는 `draw배치` 말미에서 `dimScreen` 을 불러 **바까지 덮었다.** */
  /* ☠★★★★★ **배치 화면은 팔레트로 갈면 안 된다** (2026-09-10 · 사장님 지적)
   *
   *   > 사장님: 「캐릭터 배치 화면은 왜 저따위로 나와?」
   *   >          「**왜 선택안한캐릭터에 음영이 들어가있는데?**」
   *
   *   ☠ 팔레트를 갈면 **렌더러가 그리는 것 전부**가 어두워진다 — 그 안에는
   *     배치 목록에 늘어선 **캐릭터 스프라이트**도 들어간다. 원본은 맵 사각형만
   *     리맵하고 목록은 **그 위에 밝게** 그린다.
   *   ⇒ 여기는 **반투명**이어야 한다. HUD 캔버스에 먼저 칠하면 아래 DOM(맵)만
   *     어두워지고, 그 뒤에 그리는 목록·바는 밝게 남는다.
   *   ★ 내가 확인 없이 팔레트로 바꿔 목록까지 어둡게 만들었다. 되돌린다. */
  if (battle.배치중 && battle.배치가능 && !battle.배치놓는중) this.dimScreen(ctx);

  /* ① · ② 상·하단 바 — [0x75008] 스위치와 무관하게 늘 그립니다 (0x45431) */
  this.moraleBar(ctx, battle.morale ? battle.morale.ally : 100,
                      battle.morale ? battle.morale.enemy : 100);
  this.turnGauge(ctx, battle.turn, battle.turnPeriod);

  /* ③ 좌우 여백
   * ★★★ **장식 기둥이 켜져 있으면 칠하지 않는다** (2026-08-28).
   *   사용자 지정: 「창 가로가 늘어나면 **칼 프레임 안쪽 영역에 꽉차도록**
   *   기존에 보이지 않던 맵이 화면에 더 들어와야해」
   *   기둥이 이 자리를 덮으므로 원본과 보이는 것이 같고(원본도 그 자리는 맵),
   *   확장분(cx)까지 검게 칠하면 기둥과 맵 사이에 검은 띠가 생긴다. */
  if (this.opts.margins !== false && !root.__프레임켜짐) this.clearMargins(ctx);

  /* ④ Phase + 구체
   * 원본은 [0x75008] != 1 이면 이 둘을 안 그립니다(0x45538 · 0x454D5).
   * 여기서는 스테이터스 창이 떠 있을 때 같은 자리에 걸리므로 그때도 건너뜁니다. */
  var dlgOpen = root.G2Dialogue && root.G2Dialogue.isShown && root.G2Dialogue.isShown();
  /* 마법 목록이 떠 있는 동안엔 TP(행동력) 구체를 끕니다 — 목록이 화면 상단을 채우므로
   *   구체가 목록과 겹쳐 지저분해집니다(렌더 루프가 magicMenuOpen 을 세팅).
   * **대상 선택 중**(마법·특기의 사거리/효과 범위가 떠 있을 때)에도 끕니다 —
   *   구체가 범위 위에 겹쳐 어느 칸이 대상인지 가립니다. */
  /* 이벤트 연출이 도는 동안에도 끕니다 — 원본은 이벤트 중 `[0x75008]` 이 1 이
   * 아니라 구체·Phase 를 아예 그리지 않습니다(0x45538 · 0x454D5). */
  /* ★ ESC 옵션 메뉴·시나리오 조건 중에도 끕니다 — 사용자 확인 2026-08-15:
   *   「**티피구체도 사라져야** 해.」 원본은 0x4E10E 가 `0x44DEC(0)` 으로 상·하단과
   *   구체를 끄고 제 입력 루프로 들어갑니다(0x49411 도 `0x44D6E(1)` 로 같은 상태). */
  /* ★★★★★ **`[0x75008]` 자체를 본다** (2026-08-27 · 사용자 결과 피드백 ⑤)
   *
   *   > 「**시나리오 시작하자마자 마우스스크롤과(실제 스크롤도 작동함) 티피구체가
   *   >  나와. 원작은 안나와.**(실제 원작에서 어떤순서로 로드하는지 확인해서 적용해야해)」
   *
   *   원본은 `[0x75008] != 1` 이면 상·하단과 구체를 **아예 안 그린다**
   *   (`0x45538` · `0x454D5`). 그 값을 세우고 지우는 창구가 `0x44DEC` 하나이고,
   *   호출부 **11곳**을 전수로 봤다 —
   *     끄기(0) `0x19D7E`(페이즈 0 = 라운드 진행) · `0x44CDC` · `0x493AE`(상태창) ·
   *              `0x4D8CA`(명령 실행) · `0x4E10E`(ESC) · `0x55B41`(전투 종료)
   *     켜기(1) `0x19F42`(**Player Phase**) · `0x19F96`(Waiting) · `0x49404` ·
   *              `0x4D8E1` · `0x4E430`
   *   ⇒ **오프닝 이벤트는 페이즈 0 에서 돌므로 그동안 꺼져 있는 것이 원본이다.**
   *
   *   ☠ 우리는 이 조건을 **간접 신호들**(대화창·이벤트·옵션…)로만 흉내 냈고
   *     `[0x75008]`(=`battle.phaseBanner`) 자체는 **안 봤다.**
   *     실측(1-4): 전투 화면이 선 뒤 SCE §0 이 시작하기까지 **2.3초** 동안
   *     `이벤트중=false` 라 구체·상하단이 그대로 떠 있었다.
   *
   *   ★ `turn.js` 가 이미 원본 자리마다 `phaseBanner` 를 세우고 지운다
   *     (`0x19D7E`·`0x19F42`·`0x19F96`·`0x55B41`). 여기서는 **읽기만** 한다. */
  var 표시켜짐 = !!(battle && battle.phaseBanner);                 // [0x75008]
  var 가릴것 = (this.status || dlgOpen || this.magicMenuOpen || this.targetSelect ||
                this.eventPlaying || this._option || this._obj);
  /* ★★★★★ **`Waiting...` 문구는 이벤트 중에도 뜬다** (2026-08-27 · 피드백 ⑥)
   *
   *   > 「원작에서는 **웨이팅 문구는 뜨지만** 실제 이벤트 진행중 ai페이즈가 발동하지는
   *   >  않고 시나리오가 종료돼.」
   *
   *   원본에서 스페이스(`0x19F5D` 타이머 ISR)는 페이즈를 2로 올리고 곧바로
   *   `0x19F96 call 0x44DEC(1)` 로 `[0x75008] = 1` 을 세운다. 그리는 쪽
   *   `0x45538` 은 그 값만 보므로 **이벤트가 돌든 말든 문구가 뜬다.**
   *
   *   ★ 우리 `eventPlaying` 같은 간접 신호는 `[0x75008]` 의 **근사**다.
   *     페이즈가 `waiting` 인 순간만큼은 원본이 명시적으로 켠 것이므로 그것이 이긴다.
   *   ★ [남음] 간접 신호 넷(`muteHud`·`이벤트활성중`·`inputLock`·`anim.isLocked`)을
   *     `[0x75008]` 하나로 합치는 것은 **계획서 §4-③ / 2부 단계 7** 이다.
   *     특히 `0x4D8CA`(명령 실행 전 0) · `0x4D8E1`(뒤 1) 을 아직 안 모델링했다. */
  if (표시켜짐 && 가릴것 && this.phase === 'waiting') this.phaseIcon(ctx);   // 0x19F96 → 0x45538
  if (표시켜짐 && !가릴것) {  // 대화창·마법목록·대상선택·이벤트·옵션 중에는 구체·Phase 를 끕니다 (원본 0x44DEC)
    this.phaseIcon(ctx);
    /* [리마스터 · 정본 373 ⑥] 확장 폭(cx)이 바뀌면(처음 그리기 — 생성자 자리는 4:3 기준 · 창 비율 바뀜) 정해 둔 구체 자리를 그만큼 옮긴다
     *   왼쪽 모서리는 왼쪽으로 · 나머지는 오른쪽으로(orbCorner 와 같은 규칙) — 처음 나오는 자리가 16:9 에서 4:3 자리에 남던 것 (사장님 11-22 「초기에 나오는위치가 이상하고」) */
    if (this.orbAnchor && (this._orbCX | 0) !== (this.cx | 0)) {
      var 구차 = (this.cx | 0) - (this._orbCX | 0);
      this.orbAnchor = { x: this.orbAnchor.x + (this.orbAnchor.x < 160 ? -구차 : 구차), y: this.orbAnchor.y };
    }
    this._orbCX = this.cx | 0;
    /* 커서-구체 회피 — 원본 0x455BD 그대로.
     *  · 판정 상자는 **구체의 현재 위치** 기준 76×62 (0x455CF~0x455F5).
     *  · 커서가 상자 안이면 **커서 위치(region)로 3개 코너에 점프**(0x45600~):
     *      커서 위(y<90) → 구체 BR(250,155) / 커서 우하(y≥90·x>160) → TL(75,38)
     *      / 커서 좌하(y≥90·x≤160) → TR(250,38).
     *  · 위치는 **지속**(다음 프레임 판정도 옮겨진 위치 기준) — 커서가 쫓아오면 코너를 옮겨다닌다.
     * 이동영역(파란 도달칸 하이라이트)이 떠 있을 때만 회피, 아니면 HOME 고정. */
    /* ☠★★★★★ **구체는 «커서»만 본다 — 모드가 아니다** (2026-09-22 사장님 지적)
     *
     *   > 사장님: 「이동 영역에서 타일 선택시 방향 선택을 하게 나오는데 이때
     *   >  **tp구체가 움직여서 시야를 가려.** 본래 **클릭과 tp구체 이동이 상관 없고
     *   >  마우스 위치에 따라 해당 영역을 피해서** 움직이는걸로 아는데
     *   >  지금은 이상하게 작동해」
     *
     *   원본 `0x455BD` 은 위 주석 그대로 **커서가 구체 상자 안에 들어오면** 코너로
     *   점프하고, 그 자리는 **지속**된다. 「무슨 모드인가」는 보지 않는다.
     *   ☠ 우리는 「이동영역이 떠 있을 때만 피하고, 아니면 **집으로 되돌린다**」였다.
     *     그래서 목적지를 고르는 순간(FACING_SELECT)에 회피가 꺼지면서 구체가
     *     **집으로 튀어** 방향 화살표 자리를 덮었다 — 사장님이 보신 그 움직임이다.
     *   ★ 구체를 아예 **끄는** 자리(대사·마법목록·대상선택·이벤트·배치)는 위쪽
     *     `가릴것` 이 이미 맡는다. 여기서는 끄지 않고 **자리만** 정한다. */
    if (this.cursor) {
      var a = orbAnchor(this.cursor.x, this.cursor.y, this.orbAnchor, this.cx);  // ★현재 위치 기준
      if (a.moved) this.orbAnchor = { x: a.x, y: a.y };                 // region 결과로 점프
    } else if (!this.orbAnchor) {
      this.orbAnchor = orbCorner('home', this.cx);   /* ★ N-13 — 확장 폭의 오른쪽 위 모서리 */
    }
    this.orb(ctx, {
      mode: this.orbMode,
      timeIdx: battle.timeIdx, turn: battle.turn,
      kind: battle.battleKind, dayIdx: battle.dayIdx,
      value: this.ap
    });
    /* [리마스터 · 정본 373] 턴 순서 작은 초상화 — 아군 턴에 하단 턴 게이지 위 가운데 · 지금 고른 캐릭터 강조 (battle.__턴순서 = battle_main 렌더 루프) */
    if (this.phase === 'player' && battle.__턴순서 && battle.__턴순서.목록 && battle.__턴순서.목록.length) this.턴순서초상(ctx, battle.__턴순서);
  }

  /* ⑤ 정보 바 · 스테이터스 창 */
  if (this.message) {
    this.infoBar(ctx, {
      text: this.message,
      unitTileY: this.messageUnit ? this.messageUnit.y : -1,
      cameraTileY: (this.opts.cameraTileY != null ? this.opts.cameraTileY : 0)
    });
  }
  /* MORE 2페이지는 3000틱이 지나면 스스로 스테이터스로 돌아간다 (0x48BAF) */
  if (this.statusPage && this._pageAt && Date.now() - this._pageAt > MORE_MS) {
    this.statusPage = 0; this._pageAt = 0;
  }
  if (this.status) this.drawStatus(ctx, this.status, battle.T);
  /* ⑥ AI 설정 바 — 0x4B4CA. AI 하위 메뉴가 도는 동안에만 섭니다 */
  if (this.aiUnit && !this.status)
    /* ★ 위·아래 자리는 카메라 맨 위 칸 줄로 가른다 — 0x4B4E3 [0xBA83C]>>16 + 6 (2026-10-01 사장님 「원작은 특정 조건에 따라 위치도 위아래로 바뀌고」)
     *   ☠ opts.cameraTileY 를 채우는 곳이 없어 늘 0 이었다 → 유닛이 7번째 줄 아래면 늘 위 */
    this.aiBar(ctx, { unit: this.aiUnit,
                      cameraTileY: (this.opts.cameraTileY != null ? this.opts.cameraTileY
                        : ((현재렌더러() && 현재렌더러().카메라좌상단칸) ? 현재렌더러().카메라좌상단칸().y : 0)) });

  /* ⑦ ESC 옵션 메뉴 · 시나리오 조건 — 둘 다 화면을 덮으므로 맨 마지막이다.
   *   조건 화면은 옵션 항목 0 에서도 열리므로 **옵션보다 위**에 그린다
   *   (원본은 0x49411 이 0x454B3 으로 맵을 다시 그려 메뉴를 지운다). */
  if (this._obj) this.drawObjective(ctx);
  else if (this._option) this.drawOption(ctx, this._option);

  /* ★★★★★ **화면 문구** — `op 0x73`. 원본 `0x5046C` 가 **매 틱** 그린다.
   *   (`0x50488 call 0x5E048` — 좌표 `(0x20,0x24)`)
   *   ★ 조건 화면·옵션과 달리 **덮지 않는다** — 맵 위에 글자만 얹는다.
   *   ★ 시간 깎기(`문구틱`)는 그리기와 **한 묶음**이다 — 원본도 같은 루틴이
   *     그리고 나서 `[0xA057C] −= 1` 한다(`0x50494`). */
  if (this._문구현재) {
    this.draw문구(ctx);
    this.문구틱();
  }

  /* ★★★★★ **파티 배치 화면** — `0x54670` (2026-08-24)
   *   맵 위 오버레이다(사용자: 「링커맨드나 마법 UI 뜰 때처럼 현재 맵 위에
   *   오버라이드되어서 뜨는 건데」). 조건 화면·문구보다 위, 로딩보다 아래. */
  if (battle && battle.배치중 && battle.배치가능) this.draw배치(ctx, battle);

  /* 로딩 화면 — 무엇보다 위, 화면을 통째로 덮는다 (0x4E33E) */
  if (this._loading) this.drawLoading(ctx);

  /* ⑧ 안내 상자 `0x48083` — **무엇보다 위**다. 장비 경고뿐 아니라 옵션의
   *   「저장중...」(0x4E30F) ·「읽는중...」(0x4E331) 도 이 한 창구로 뜬다. */
  this.drawEquipWarn(ctx);
  return this;
};

/** 옵션 메뉴 상태를 넣는다(`null` 이면 닫는다). `{cfg, hover, pressed}` */
Hud.prototype.option = function (v) {
  if (v === undefined) return this._option || null;
  this._option = v || null;
  return this._option;
};

/* ═══════════════════════════════════════════════ ESC 옵션 메뉴 · 시나리오 조건
 *
 * 원본 근거는 `03_분석/COMBATII/옵션메뉴_원본확정.md` 에 전문을 적어 뒀다.
 * 여기에는 **자리와 그림 고르기**만 둔다 — 무엇을 하는지는 컨트롤러 몫이다.
 * ------------------------------------------------------------------------ */

var OPTION = {
  file: 'MENUSTAT.SYB',
  /* 그림 — 스테이터스가 36~40, 마법 문장이 41~ 이므로 0~31 이 옵션 몫이다 */
  win: 0,                    // 127×31 앵커(−63,−15)   창(제목판)
  desc: 31,                  // 208×29 앵커(−104,−14)  아래 설명판
  winAt:  [0xA0, 0x24],      // 0x4DC7A  (160, 36)
  descAt: [0xA0, 0x8C],      // 0x4DD59  (160, 140)
  descY:  0x85,              // 0x4E186  설명 글 윗변 133
  /* 항목 자리 — 0 만 따로, 1~8 은 네 개씩 두 줄 (0x4DCB6 · 0x4DD3C · 0x4DD44) */
  /* [리마스터] MISSION 을 첫 줄 높이로 올리고(원본 0x57) 그 밑에 «게임 설정»(항목 9) — 사장님(11-05) 「미션을 다른 아이콘과
   *   같은 높이로 올리고 그 밑에 옵션을 넣는게 좋겠어」 · 그림 = js/option_button.js 전투판다듬기(MISSION 돌 단추 + 조절 막대) */
  item0:  [0x60, 0x4C],      // 원본 0x4DC9F / 0x4DCB0 는 (0x60, 0x57)
  item9:  [0x60, 0x6C],      // [리마스터] 게임 설정 — 둘째 줄 높이
  x0: 0x80, dx: 0x1E, y0: 0x4C, dy: 0x20, perRow: 4,
  hit: 0x18,                 // 0x4DBAB  24×24
  count: 10,                 // 원본 9 + [리마스터] 게임 설정
  /* 이름 — `0x7545C` 포인터 배열 실측(조합형) */
  name: ['임무 설명', 'QUICK SAVE', 'QUICK LOAD', '음악 조정', '효과음 조정',
         'TURN 간격 조정', 'SCROLL 속도 조정', '전투 처음부터', 'TITLE로', '게임 설정'],
  defaultName: 'OPTION 조정',            // [0x75480]
  /* 3·4·6 은 눌림 연출을 건너뛴다 — 아이콘이 바로 바뀌므로 (0x4E2CB) */
  toggle: [3, 4, 6],
  글자: 0x11, 테두리: 0,                 // 관측 — 노랑 + 검정
  /**
   * TURN 간격 조정 하위 화면 — `0x4DE0A`.
   *
   * 사용자 화면 2026-08-15: 아래에 좌우 화살표와 게이지 바가 뜬다.
   * 「1칸이 분 계산할 때 나왔던 거 1로 알고 있어. **총 15개까지** 늘어나
   *  **기본값은 1**이야.」 — 원본과 정확히 맞는다(아래 계산 참조).
   *
   * ```asm
   * 0x4DE13  왼쪽 화살표  프레임 25 앵커 + (0x67, 0xB2)
   * 0x4DE35  오른쪽       프레임 27 앵커 + (0xD9, 0xB2)
   * 0x4DE61  바 배경      프레임 29 앵커 + (0xA0, 0xB2)
   * 0x4DEBB  call 0x1A11C            ; 지금 값
   * 0x4DEC7  esi = 값 × 3
   * 0x4DECA  ecx = 0x73(115)         ; 게이지 시작 x
   * 0x4DEEF  while (cx < 115 + 값×3) { 프레임 30 을 (cx, 0xB2) 에; cx += 6 }
   * 0x4DF3C  ←  값 > 2  이면 값 −= 2  → 0x1A116
   * 0x4DF66  →  값 < 30 이면 값 += 2
   * 0x4DFBD  마우스 히트 9 = 왼쪽 · 10 = 오른쪽 (0x4DFCC 눌린 그림 = 히트×2 + 8)
   * ```
   *
   * 곧 **값은 2씩 움직이고 2~30**, 칸 수는 `값 × 3 / 6 = 값 / 2` 라 **1~15칸**이다.
   * 기본값 2 → 1칸. 우리 `battle.turnPeriod`(= GAME.CFG 4번째 바이트, `[0x74138]`)가
   * 곧 이 값이다.
   */
  turn: {
    bar: 29, barAt: [0xA0, 0xB2],
    left: 25, leftAt: [0x67, 0xB2],
    right: 27, rightAt: [0xD9, 0xB2],
    /* ★ [리마스터] 게이지 시작 x 를 **118** 로 (원본은 `0x4DECA` 의 `0x73` = 115).
     *
     *   사용자 지적 2026-08-15: 「간격이 안 맞아. **꽉 채웠을 때 오른쪽이 남아.**
     *   꽉 채운 것 기준 전체가 **가운데** 들어오도록 위치 조정해야 해.」
     *   → 117 로 옮겼는데도 「아직도 가운데가 아니야」. 픽셀로 다시 재서 원인을 찾았다.
     *
     *   ① 바(프레임 29)의 테두리는 **좌우 1px 씩**이다 → 홈 = 화면 111~208 (98px)
     *   ② 칸(프레임 30)은 5px 이지만 **잉크가 왼쪽 4px** 이다 (`##++.` — 마지막 열은
     *      옅은 그림자). 곧 눈에 보이는 폭은 5 가 아니라 **4** 다.
     *
     *   15칸의 **보이는 폭** = 14×6 + 4 = 88, 홈 98 → 여백 5씩이 가운데다.
     *     x0 115(원본) → 칸 113~200  여백 왼 2 · 오 8
     *     x0 117       → 칸 115~202  여백 왼 4 · 오 6      ← 아직 2px 치우침
     *     x0 118       → 칸 116~203  여백 왼 5 · 오 5      ← 딱 가운데
     *
     *   `리마스터_적용현황.md` 에 적어 뒀다. 원본 그대로 두려면 `origX0` 을 쓴다. */
    cell: 30, x0: 118, origX0: 0x73, step: 6, y: 0xB2,
    min: 2, max: 0x1E, unit: 2,
    hitLeft: 9, hitRight: 10
  }
};

/**
 * 항목별 **아이콘 번호** — `0x4DBDE`. 켜짐/꺼짐이 그림 자체로 나타난다.
 * @param {object} cfg {music, sfx, scroll} — true 면 켜짐
 */
function optionIcons(cfg) {
  cfg = cfg || {};
  return [0, 1, 2,                       // 0x4DBE4  [0x8D8C2 + i*2] = i
          cfg.music  ? 5 : 3,            // 0x4DBF6
          cfg.sfx    ? 6 : 4,            // 0x4DC14
          7,                             // 0x4DC32
          cfg.scroll ? 9 : 8,            // 0x4DC57
          10, 11,                        // 0x4DC5C
          -1];                           // [리마스터] 게임 설정 — MENUSTAT 그림이 아니다 (drawOption 이 따로 그린다)
}
/** 아이콘 번호 → MENUSTAT 프레임. 눌린 그림은 그 +1 (`0x4DCF7` · `0x4DDA4`). */
function optionFrame(icon, pressed) { return (icon | 0) * 2 + 1 + (pressed ? 1 : 0); }
/** 항목 i 의 기준 좌표(앵커 더하기 전). */
function optionAt(i) {
  if (!i) return [OPTION.item0[0], OPTION.item0[1]];
  if (i === 9) return [OPTION.item9[0], OPTION.item9[1]];
  var k = i - 1;
  return [OPTION.x0 + (k % OPTION.perRow) * OPTION.dx,
          OPTION.y0 + Math.floor(k / OPTION.perRow) * OPTION.dy];
}

/**
 * 옵션 메뉴를 그린다 — `0x4DC75`.
 * @param {object} o {cfg:{music,sfx,scroll}, hover:항목|−1, pressed:항목|−1}
 */
Hud.prototype.drawOption = function (ctx, o) {
  o = o || {};
  var icons = optionIcons(o.cfg), hover = (o.hover == null ? -1 : o.hover | 0);

  /* 배경 음영 — 0x44D6E(1) 이 켠 연출 플래그를 0x454D5 가 보고 화면을 리맵
   * 표 단계 0(밝기 40 %)으로 훑는다. 캔버스에서는 검정 60 % 와 같다. */
  this.dimScreen(ctx);

  this.blit(ctx, OPTION.file, OPTION.win, OPTION.winAt[0], OPTION.winAt[1], true);
  for (var i = 0; i < OPTION.count; i++) {
    var at = optionAt(i);
    if (icons[i] < 0) { this.drawSettingsIcon(ctx, at, o.pressed === i); continue; }
    this.blit(ctx, OPTION.file, optionFrame(icons[i], o.pressed === i), at[0], at[1], true);
  }
  this.blit(ctx, OPTION.file, OPTION.desc, OPTION.descAt[0], OPTION.descAt[1], true);
  /* 설명 글 — 가리키는 것이 없으면 「OPTION 조정」 (0x4E16B) */
  var 글 = (hover >= 0 && hover < OPTION.count) ? OPTION.name[hover] : OPTION.defaultName;
  if (o.turn != null) 글 = OPTION.name[5];              // TURN 화면에서는 그 이름을 세워 둔다
  this.koreanOutlined(ctx, 글, 160, OPTION.descY, OPTION.글자, OPTION.테두리, 16);

  /* TURN 간격 하위 화면 — 0x4DE0A */
  if (o.turn != null) this.drawTurnBar(ctx, o.turn, o.pressed);
  /* [리마스터] 게임설정 창 — 옵션창 위에 통째로 · 화면 비율대로 (원점이 cx 만큼 밀려 있으므로 왼끝 = −cx) */
  if (o.확인) {   /* [리마스터] 전투 «TITLE로» 확인 — 월드 확인창(게임.html · 0x28E8A)과 같은 꼴: 검정 → 틀 0x809A4 (52,50) · 글 «끝낼까요?» y 58 · ✓ 0x81E75 (72,108) · ✗ 0x822C5 (174,108) */
    var CXk = this.cx | 0, LWk = this.logicalW || VIEW.w, 캐 = root.__상태 && root.__상태.자산 && root.__상태.자산.옵션캐시, 그 = 캐 && 캐.그림;
    ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(-CXk, 0, LWk, VIEW.h); ctx.restore();
    var 놓 = function (im, x, y) { if (im) ctx.drawImage(im, x, y, im.논리w || im.width, im.논리h || im.height); };
    if (그) { 놓(그[0x809A4], 52, 50); 놓(그[0x81E75], 72, 108); 놓(그[0x822C5], 174, 108); }
    this.koreanOutlined(ctx, '끝낼까요?', 160, 58, OPTION.글자, OPTION.테두리, 16);
    if (그 && root.__패드확인 != null && root.__패드커서숨김 && root.__패드모양빛) root.__패드모양빛(ctx, root.__패드확인 === 0 ? 그[0x81E75] : 그[0x822C5], root.__패드확인 === 0 ? 72 : 174, 108);
    return this;
  }
  if (o.설정창) {
    var CXs = this.cx | 0, LWs = this.logicalW || VIEW.w, 자s = o.설정자원 || {};
    ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(-CXs, 0, LWs, VIEW.h); ctx.restore();
    /* 전투 화면 양옆 덩굴 테두리가 이 층 위에 그려져 안쪽 4점쯤을 덮는다 — 창을 양옆 10점씩 들인다 (11-05 헤드리스 찍어 봄) */
    o.설정창.그리기(ctx, { 글꼴: 자s.글꼴, 바탕: 자s.바탕, 왼: -CXs + 10, 폭: LWs - 20 });
  }
  return this;
};

/** [리마스터] 게임 설정 아이콘 — MISSION 돌 단추(평소 1 · 눌림 2)를 64×64 판에 그려 글자를 지우고 조절 막대 (한 번 굽는다) */
Hud.prototype.drawSettingsIcon = function (ctx, at, pressed) {
  var 키 = pressed ? '눌림' : '평소';
  this._설정아이콘 = this._설정아이콘 || {};
  var c = this._설정아이콘[키];
  if (!c && root.G2OptionButton && typeof document !== 'undefined') {
    c = document.createElement('canvas'); c.width = 64; c.height = 64;
    var g = c.getContext('2d');
    this.blit(g, OPTION.file, optionFrame(0, pressed), 32, 32, true);
    if (root.G2OptionButton.전투판다듬기(g)) this._설정아이콘[키] = c; else c = null;
  }
  if (c) ctx.drawImage(c, at[0] - 32, at[1] - 32);
  return this;
};

/**
 * TURN 간격 게이지 — `0x4DE0A`. 값은 2~30(2씩), 칸은 `값 × 3 / 6` 이라 1~15개.
 * @param {number} v        지금 값 (`battle.turnPeriod`)
 * @param {number} pressed  9 = 왼쪽 화살표 눌림 · 10 = 오른쪽
 */
Hud.prototype.drawTurnBar = function (ctx, v, pressed) {
  var T = OPTION.turn, f = OPTION.file;
  this.blit(ctx, f, T.bar, T.barAt[0], T.barAt[1], true);                 // 0x4DE61
  this.blit(ctx, f, T.left  + (pressed === T.hitLeft  ? 1 : 0), T.leftAt[0],  T.leftAt[1],  true);
  this.blit(ctx, f, T.right + (pressed === T.hitRight ? 1 : 0), T.rightAt[0], T.rightAt[1], true);
  /* 0x4DEC7  esi = 값×3 · 0x4DECA ecx = 0x73 · 0x4DEEC ecx += 6 */
  var end = T.x0 + (v | 0) * 3;
  for (var x = T.x0; x < end; x += T.step) this.blit(ctx, f, T.cell, x, T.y, true);
  return this;
};

/** TURN 화면의 화살표 히트 — 9 왼쪽 · 10 오른쪽, 밖이면 −1 (`0x4DFBD`). */
Hud.prototype.turnHit = function (lx, ly) {
  var T = OPTION.turn, r = [[T.hitLeft, T.left, T.leftAt], [T.hitRight, T.right, T.rightAt]];
  for (var i = 0; i < r.length; i++) {
    var fr = this.assets.frame(OPTION.file, r[i][1]);
    if (!fr) continue;
    var x = r[i][2][0] + fr['앵커'][0], y = r[i][2][1] + fr['앵커'][1];
    if (lx >= x && lx <= x + fr.w && ly >= y && ly <= y + fr.h) return r[i][0];
  }
  return -1;
};

/**
 * 옵션 항목 히트 — `0x4DB7E`. **그린 자리가 곧 히트박스**이고 24×24 다.
 * @returns {number} 항목 0~8, 밖이면 −1
 */
Hud.prototype.optionHit = function (lx, ly) {
  for (var i = 0; i < OPTION.count; i++) {
    var at = optionAt(i), f = this.assets.frame(OPTION.file, optionFrame(0, false));
    var ax = f ? f['앵커'][0] : -11, ay = f ? f['앵커'][1] : -11;
    var x = at[0] + ax, y = at[1] + ay;
    if (lx >= x && lx <= x + OPTION.hit && ly >= y && ly <= y + OPTION.hit) return i;
  }
  return -1;                                                    // 0x4DBD3
};

/**
 * 시나리오 조건 화면 — `0x49411`.
 *
 * ```asm
 * 0x49412  ah = [0x8DBC0] ; je 0x49474      ; 조건이 비면 **아예 안 뜬다**
 * 0x4941C  0x44D6E(1)                       ; 연출 플래그 → 화면 밝기 40 %
 * 0x4943C  0x5E048(0x30, 0x22, "[ 시나리오 조건 ]")
 * 0x4944D  0x5E048(0x40, 0x37, [0x8DBC0])
 * 0x49463  0x499EF(0xBB8)                   ; 3000틱 또는 아무 입력
 * ```
 * 본문은 `.SCE` 작전목표이고 **`\n` 이 들어 있다**(실측:
 * `"\n 제국으로 운송되는 \n 영광의 홀을 탈취하라!\n"`) — 줄 단위로 찍는다.
 *
 * ★★★★★ **확정 (2026-08-29)** — 줄 높이는 **16** 이고 원본 값이다.
 *   ```asm
 *   0x5DDC3  xor eax,eax · mov dx, [0xD7648]      ; 지금 y
 *   0x5DDCA  mov [0xD7646], ax                    ; x = 0 (줄 앞으로)
 *   0x5DDD0  mov ax, [0x755C6]                    ; ★ **줄 높이 전역**
 *   0x5DDD6  add edx, eax · mov [0xD7648], dx     ; y += 줄 높이
 *   ```
 *   `[0x755C6]` 에 쓰는 명령은 **`0x5DD4C` 하나뿐**이고
 *   (`66 89 15 c6 55 07 00` 바이트 전수 · `0x40000`~`0x70000`),
 *   그 자리가 든 함수 `0x5DD46` 을 **부르는 곳이 없다**(`EXE_호출부찾기`).
 *   그래서 이미지 초기값이 그대로 쓰인다 — `0x755C6` 의 word 는 **0x0010 = 16**.
 *   (짝인 `[0x755C4]` 도 16 이다.)
 *   ⇒ 아래 `lineH: 16` 은 맞춘 값이 아니라 **원본 값**이다.
 */
var OBJECTIVE = {
  title: '[ 시나리오 조건 ]',        // 0x77D63
  titleAt: [0x30, 0x22],            // 0x4943C  (48, 34)
  bodyAt:  [0x40, 0x37],            // 0x4944D  (64, 55)
  lineH: 16,                        // 0x755C6 (0x5DDD0)
  틱: 0xBB8,                        // 0x49463
  글자: 0x11, 테두리: 0
};
var OBJECTIVE_MS = Math.round(OBJECTIVE.틱 / TICK_HZ * 1000);

/**
 * 로딩 화면 — `NOWLOAD.PCX` (QUICK LOAD 가 띄운다, `0x4E33E` → `0x4FD25`).
 *
 * 320×200 전체를 덮는다. 그림 안에 이미 「Now Loading...」이 있고, 사용자 관측
 * 2026-08-15 「저기에서 **...이 늘어날거야**」에 따라 **점 세 개를 순서대로**
 * 드러낸다(그림을 다 그린 뒤 아직 안 나올 점을 배경색으로 덮는 방식).
 *
 * 점 자리는 PCX 를 픽셀로 재서 얻었다 — y 186~198, x `[98,101] [103,106] [108,111]`.
 */
var LOADING = { dots: [[98, 101], [103, 106], [108, 111]], y1: 184, y2: 198, ms: 300 };

/** PCX 캔버스를 넘긴다(`전투.html` 이 직독해서 준다). */
Hud.prototype.setLoadingImage = function (cv) { this._loadCv = cv || null; return this; };
/** 로딩 화면을 켜고 끈다. */
Hud.prototype.loading = function (on) {
  if (on === undefined) return !!this._loading;
  this._loading = on ? { at: Date.now() } : null;
  return this._loading;
};
/** 현재 전투 적재 진행 화면을 지정 HUD 문맥에 그린다. */
Hud.prototype.drawLoading = function (ctx) {
  var L = this._loading;
  if (!L) return this;
  ctx.save();
  ctx.fillStyle = '#000';
  /* ★ [리마스터 N-13] 확장 폭까지 덮습니다 — 안 그러면 좌우에 맵이 남습니다 */
  ctx.fillRect(-(this.cx | 0), 0, this.logicalW || VIEW.w, VIEW.h);
  if (this._loadCv) ctx.drawImage(this._loadCv, 0, 0);
  /* 점 애니메이션 — 0·1·2·3 개를 돌아가며 */
  var n = Math.floor((Date.now() - L.at) / LOADING.ms) % (LOADING.dots.length + 1);
  ctx.fillStyle = '#000';
  for (var i = n; i < LOADING.dots.length; i++) {
    var d = LOADING.dots[i];
    ctx.fillRect(d[0], LOADING.y1, d[1] - d[0] + 1, LOADING.y2 - LOADING.y1 + 1);
  }
  ctx.restore();
  return this;
};

/** 화면 음영 — 연출 플래그(`[0x8A8B6]`) → `0x454D5` 리맵 표 단계 0(밝기 40 %). */
/**
 * ★★★★★ **한 색 실루엣** — 원본 `0x5F517` (2026-08-25 신설)
 *
 *   `0x5F3FD`(보통 그리기)와 짝을 이루는 함수로, **그림의 불투명 픽셀을 전부 한 색**
 *   으로 칠한다(`ecx` 가 그 색). 배치 화면의 탈것이 이것으로 그려지고
 *   (`0x54996`·`0x549BA` 색 10·15), 발광 실루엣도 같은 함수다
 *   (`render.js _silhouetteURL` 주석 참조).
 *
 *   캔버스에서는 오프스크린에 그림을 그린 뒤 `source-atop` 으로 색을 덮으면 같다.
 *
 * @param {number} colorIdx 팔레트 인덱스
 */
Hud.prototype.실루엣 = function (ctx, img, x, y, w, h, colorIdx) {
  if (!img || !w || !h) return this;
  var k = '_실루엣' + colorIdx;
  var cv = this[k];
  if (!cv) { cv = this[k] = document.createElement('canvas'); }
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  var g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  g.drawImage(img, 0, 0, img.width || w, img.height || h, 0, 0, w, h);
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = this.assets.color(colorIdx | 0);
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'source-over';
  ctx.drawImage(cv, x, y);
  return this;
};

/* ══════════════════════════════════════════════════════════════════════
 * ★★★★★ **화면 음영 — 정본 창구** (2026-08-26 · 리팩토링 5단계)
 *
 *   원본은 음영을 **알파 합성이 아니라 팔레트 리맵**으로 한다:
 *     `0x6104A(단계)` 가 리맵 표를 고르고 → `0x5ECC7` 이 기록기를 `0x5EE2B` 로
 *     바꾸면 → `0x5EDDE`(사각)·`0x6075A`(타원)가 **화면 색을 표로 치환**한다.
 *   단계 0 표는 `0x55C68` 이 강도 `0x3C`(60)로 굽고 `0x61074` 가
 *   `100 − 60` = **남길 밝기 40 %** 로 만든다.
 *
 *   ★ `GENESIS.PAL` 로 표를 실제로 구워 전 인덱스를 돌려 **실측**했다
 *     (2026-08-15 · `battle_ui.js` 주석):
 *       1회 통과 평균 **39.6 %** (이상적 40) · 2회 **10.5 %** (이상적 16)
 *     2회가 이상보다 어두운 것은 인덱스 팔레트 근사가 바닥으로 몰리기 때문이다
 *     (256 중 159 개는 2회째에 색이 그대로다).
 *
 *   ★★★ **겹침 횟수(pass)가 자리마다 다르다** — `03_분석/표/json/화면음영_19곳.json`
 *     (`call 0x6104A` 전수 · 19곳 중 13곳이 기록기까지 도달):
 *       · `0x454EE → 0x45507` rect **pass 1** — 배치 화면·옵션창
 *       · `0x48443 → 0x4845C` rect **pass 2** — 대사창 (두 사각형이 겹친다)
 *
 *   ⇒ **창구는 하나, 횟수는 인자**다 (P6 단일 소유자).
 *     전에는 `hud.dimScreen` 이 `rgba(0,0,0,0.6)`(알파)이고 `battle_ui` 는
 *     **곱하기**여서, 1회는 우연히 비슷했지만 **겹치면 달라졌다**
 *     (알파 2회 = 16 % vs 원본 실측 **10.5 %**).
 *
 *   @param {CanvasRenderingContext2D} ctx
 *   @param {number} [pass=1] 겹침 횟수 — 원본 자리별 값 (위 표)
 *   @param {object} [영역] `{x,y,w,h}` — 생략하면 화면 전체
 * ══════════════════════════════════════════════════════════════════════ */
Hud.KEEP1 = 39.6;      /* 1회 통과 남는 밝기 % (실측) */
Hud.KEEP2 = 10.5;      /* 2회 통과 (실측) */
/** ★★★★★ 원본 리맵의 **채널 보정** — `0x60A3F add eax, 9`(0~63 스케일) (2026-09-05)
 *
 *   `0x609F9` 의 식은 `새값 = 원값 × keep/100 + 목표색 × 강도/100 + **9**` 다.
 *   R·G·B 셋 다 `+9` 다 (`0x60A3F` · `0x60A62` · `0x60A7E`).
 *   ⇒ **검은 자리도 9(8비트 36)로 들린다.** 원작의 음영이 「검게 덮기」가 아니라
 *     「뿌옇게 흐리기」인 까닭이다(`remap.js` 머리 주석). */
Hud.리맵보정 = 9;
function 회색(pct) {
  var v = Math.round(255 * pct / 100);
  return 'rgb(' + v + ',' + v + ',' + v + ')';
}
/**
 * ★ 반투명으로 덮을 색 — 원본 리맵 `새값 = 원값×keep + 목표색(팔레트 0번) + 9` 를 알파로 옮긴 것
 *   결과 = 원색×(1−a) + 덮는색×a · a = 1 − keep · 덮는색 = 팔레트0 + 36/(1 − KEEP1/100) (한 번 값의 고정점)
 *   검산: 187 → 한 겹 110(원본 109) · 두 겹 73(원본 81). `multiply` 는 +9 가 빠져 두 겹이면 거의 검정(20)이다.
 *   화면 전체 음영(`화면음영`)과 대화창(battle_ui — 리맵 미러를 걷어 낸 뒤 대화창 음영은 이것 하나 · 2026-10-01)이 같이 쓴다 (2026-09-26 · 사장님 「대화창 시꺼먼거만 좀 수정해. 너무 어두워.」)
 * @param {number} pass 1 · 2
 * @param {Uint8Array|number[]} [pal] 지금 화면 팔레트(768) — 없으면 목표색 검정
 * @returns {string} CSS rgba
 */
Hud.음영덮개 = function (pass, pal) {
  var keep = (((pass | 0) >= 2) ? Hud.KEEP2 : Hud.KEEP1) / 100, a = 1 - keep;
  var 목표 = (pal && pal.length >= 3) ? [pal[0], pal[1], pal[2]] : [0, 0, 0];
  var a1 = 1 - Hud.KEEP1 / 100;
  function 덮(i) { return Math.min(255, Math.round(목표[i] + Hud.리맵보정 * 4 / a1)); }
  return 'rgba(' + 덮(0) + ',' + 덮(1) + ',' + 덮(2) + ',' + (Math.round(a * 1000) / 1000) + ')';
};
/** ★ **최종** 밝기 색 — 한 번에 칠할 때 쓴다 */
Hud.음영색 = function (pass) {
  return 회색(((pass | 0) >= 2) ? Hud.KEEP2 : Hud.KEEP1);
};
/**
 * ★★ **덧칠용** 색 — 이미 `pass−1` 장이 깔린 위에 **곱해서** 얹을 때 쓴다.
 *
 *   원본 대사창은 사각형을 **두 번 실제로 그린다**(`0x48457` · `0x48475`).
 *   그 모양을 그대로 옮기려면 두 번째 장은 「최종 10.5 % 가 되도록」
 *   `10.5 / 39.6 ≈ 26.5 %` 여야 한다.
 *   ⇒ `battle_ui` 가 이 창구를 쓴다 — **상수를 두 곳에 두지 않는다** (P6).
 */
Hud.음영색누적 = function (pass) {
  if ((pass | 0) <= 1) return 회색(Hud.KEEP1);
  return 회색(Hud.KEEP2 / Hud.KEEP1 * 100);
};
/** 지정 패스와 논리 영역에 전투 화면 음영을 적용한다. */
Hud.prototype.화면음영 = function (ctx, pass, 영역) {
  ctx.save();
  /* ★★★★★ **투명한 캔버스에 `multiply` 를 쓰면 단색이 된다** (2026-08-27 · 사용자 지적)
   *
   *   > 「몇몇 **음영처리가 깨져서 반투명이 아닌 완전 단색으로 화면을 덮어버려.**
   *   >  대표적인게, 전투에서 **esc로 옵션 진입, 시나리오목표** 등이야.」
   *
   *   `multiply` 는 **대상 픽셀이 있을 때만** 어두워진다. 대상 알파가 0 이면
   *   합성 규칙상 원본(회색)이 그대로 `source-over` 로 얹혀 **불투명 회색 판**이 된다.
   *
   *   ☠ 우리 맵은 이 캔버스가 아니라 **DOM `world` 층**에 있다. 그래서 HUD 캔버스는
   *     그 자리에서 **투명**이고, 곱하기가 통째로 단색으로 나왔다.
   *     (대사창처럼 캔버스 안에 그림이 있는 자리는 멀쩡해서 오래 안 드러났다.)
   *
   *   ⇒ **대상이 있을 때만 곱하고, 없으면 반투명 검정**으로 같은 밝기를 만든다.
   *     원본은 밝기를 `KEEP%` 로 남기므로 검정을 `1 − KEEP/100` 만큼 덮은 것과 같다
   *     (`drawOption` 주석의 「검정 60 %」와 정확히 같은 값이다 — `KEEP1` 39.6 %).
   *
   *   ★ 캔버스 위에 이미 그림이 있는 자리(대사창 등)는 `multiply` 가 더 정확하다.
   *     그래서 **캔버스가 비어 있는지**를 보고 고른다 — `this.맵이캔버스에` 가
   *     참이면 예전대로 곱한다. 기본은 거짓(우리 구조)이다. */
  var 곱하기 = !!this.맵이캔버스에;
  if (곱하기) {
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = Hud.음영색(pass);
  } else {
    /* ★★★★★ **검정이 아니라 회색을 덮는다** — 원본 `+9` 를 살린다 (2026-09-05)
     *
     *   > 사용자: 「대화창뿐만 아니라 **화면 전체에 음영처리 되었을 때도 같은 방식으로
     *   >  차이가 나.** 이 부분도 감안해야 해.」
     *
     *   ☠ 여기 `rgba(0,0,0,…)` 였다. 검정을 덮으면 `결과 = v × keep + 0` 이라
     *     원본의 **`+9` 가 통째로 빠진다.** 그래서 어두운 자리가 원본보다 **검게 뭉갰다.**
     *
     *   ★ 알파 합성은 `결과 = 원색 × (1−a) + 덮는색 × a` 다.
     *     원본 식을 8비트로 옮기면 `결과 = v × keep + 보정×4` 이므로 —
     *       `1 − a = keep`  ·  `덮는색 × a = 보정×4`
     *     `keep 0.396` → `a = 0.604` · 덮는색 = `36 / 0.604` ≈ **60**.
     *   검산 — 배경 187 → `187×0.4 + 36 = 110.8`. 원본 화면 실측 **109**.
     *
     *   ☠ 원본은 그 뒤 **가장 가까운 팔레트 색으로 스냅**한다(`0x60AE5` 맨해튼 거리).
     *     그 단계는 알파로 못 낸다 — **밝기는 맞지만 색이 팔레트 밖으로 나갈 수 있다.**
     *     팔레트까지 맞추려면 대사창처럼 **미러 리맵**이 필요하다 — 아직 안 했다. */
    /* ☠★★★★★ **덮는 색은 검정이 아니라 「팔레트 0번 색」이다** (2026-09-10)
     *
     *   > 사장님: 「원본 직접 몰아서 그 상태가 뭔지 확인해줘」
     *
     *   원본 리맵은 `새값 = 원값×keep + **목표색**×강도/100 + 9` 다(`0x609F9`).
     *   음영(뱅크 0)의 **목표색은 팔레트 0번**이다 — 그런데 **0번이 검정이 아닌 맵이 있다.**
     *   15-2(사막)는 0번이 **(48,48,48)** 이다. 우리는 0번을 늘 검정으로 보고
     *   `덮는색 = 36/a` 만 썼기 때문에 **그런 맵에서 너무 어두웠다.**
     *
     *   실측으로 딱 맞는다 —
     *   ```
     *   덮는색 = 팔레트0 + 36/(1 − KEEP1/100)          ← 한 번 걸었을 때의 고정점
     *     팔레트0 = 48 → 덮는색 108 → 136 이 **119**   · 원본 실측 **118** ✔
     *     팔레트0 =  0 → 덮는색  60 → 187 이 **110**   · 예전 실측 **109** ✔
     *   ```
     *   ★ `a` 만 겹침 횟수를 타고 **덮는색은 한 번 값(고정점)을 그대로 쓴다** —
     *     같은 식을 두 번 거는 것과 결과가 같다(검산 111 ↔ 112).
     *
     *   ★ 전투에서는 **맵 팔레트**가 화면 팔레트다(`R._유닛팔레트()`). */
    var keep = (((pass | 0) >= 2) ? Hud.KEEP2 : Hud.KEEP1) / 100;
    var a = 1 - keep;
    var 목표 = [0, 0, 0];
    var _R = 현재렌더러();
    var _mp = (_R && _R.팔레트 && _R.팔레트()) ||
              (this.assets && this.assets.pal768) || null;
    if (_mp && _mp.length >= 3) 목표 = [_mp[0], _mp[1], _mp[2]];
    var _a1 = 1 - Hud.KEEP1 / 100;                 /* 한 번 걸 때의 강도 */
    function 덮(i) { return Math.min(255, Math.round(목표[i] + Hud.리맵보정 * 4 / _a1)); }
    /* ☠★★★★★ **팔레트를 갈아서 음영을 내면 안 된다** (2026-09-10 · 사장님 지적)
     *
     *   > 사장님: 「**왜 선택안한캐릭터에 음영이 들어가있는데?**」
     *   >          「이상한거 고치라고했더니 **멀쩡한걸 병신을 만들어놨어?**」
     *
     *   한때 여기서 `R.음영팔레트()` 로 **팔레트를 갈아** 「가장 가까운 팔레트 색으로
     *   스냅」까지 맞추려 했다. ☠ **틀렸다** — 팔레트를 갈면 렌더러가 그리는 것이
     *   **전부** 어두워진다. 배치 화면의 **캐릭터 목록**까지 어두워졌다.
     *   원본은 맵 사각형만 리맵하고 목록·창·바는 **그 위에 밝게** 그린다.
     *
     *   ⇒ 음영은 **반투명으로 덮는다.** 밝기는 아래 식으로 원본과 맞는다
     *     (136 → 119 · 원본 실측 118). 스냅은 **대사창처럼 미러**로만 낼 수 있고,
     *     그것은 `battle_ui.js` 가 이미 대사창에 쓰고 있다.
     *   ★ `render.js 음영팔레트()` 는 **아무도 안 부른다** — 지우지 않고 남겨 둔다
     *     (미러를 화면 전체로 넓힐 때 쓸 수 있다). */
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = Hud.음영덮개(pass, _mp);     /* 위 식과 같은 값 — 창구 하나로 (대화창도 쓴다) */
  }
  if (영역) ctx.fillRect(영역.x | 0, 영역.y | 0, 영역.w | 0, 영역.h | 0);
  /* ★ N-13 확장 폭 · ★ 세로 확장(㉛)도 — draw 가 translate(cx, cy) 를 걸었으므로 위 끝은 −cy, 높이는 logicalH (2026-10-05)
   *   ☠ 예전엔 y 0 · 높이 200 만 덮어, 창을 키우면 배치·시나리오 목표 음영의 위아래 띠가 빠졌다
   *   (사장님 「창 최대로 키웠을때, 시나리오목표와 캐릭터 배치 음영처리되는 부분 일부가 누된다고 했는데 그부분 전혀 안고쳐졌어」) */
  else ctx.fillRect(-(this.cx | 0), -(this.cy | 0), this.logicalW || VIEW.w, this.logicalH || VIEW.h);
  ctx.restore();
  return this;
};

/** ★ 옛 이름 — **`화면음영(ctx, 1)` 로 위임**한다 (5단계 · P6).
 *   원본 `0x454EE` 자리는 **pass 1** 이다 (`화면음영_19곳.json`). */
Hud.prototype.dimScreen = function (ctx) { return this.화면음영(ctx, 1); };

/* ══════════════════════════════════════════════════════════════════════
 * ★★★★★ **시나리오 전환 페이드아웃** — 원본 `0x55EBC` (2026-08-26 · 사용자 문제 ⑦)
 *
 *   > 사용자: 「시나리오가 끝나서 다른 시나리오로 이동할때 **페이드아웃 효과**가
 *   >  있는데(**모든 시나리오**) 우리는 적용이 안되어있어.」
 *
 *   원본을 읽어 확정했다:
 *   ```asm
 *   0x55EFD  mov edx, 0x64      ; ★ 강도 **100**
 *   0x55F02  call 0x1033B       ; ★ **프레임 = 3틱**
 *   0x55F0D ┌ …
 *   0x55F20 │ call 0x5FA2C      ; ★ 팔레트 페이드 (색 **256개 전부** → 검정)
 *   0x55F25 │ call 0x499E4      ; ★ 한 프레임 대기 (= 3틱)
 *   0x55F2A │ sub [esp], 5      ; ★ 강도 **−5**
 *   0x55F34 └ jge 0x55F0D
 *   ```
 *   `0x5FA2C` 는 각 색의 R·G·B 를 **`× 강도 / 100`** 해서 VGA 팔레트에 쓴다
 *   (`0x5FA69 imul edx,esi` · `0x5FA71 idiv ebp(=100)` · 포트 `0x3C8`/`0x3C9`).
 *
 *   ★ 부르는 곳은 **세 종료 경로 전부**다 —
 *     `0x01` 종료(`0x50742`) · `0x65` 패배(`0x50792`·`0x507A4`) · `0x12` 체인(`0x52D5F`).
 *
 *   ★★ 우리는 팔레트가 없으므로 **`multiply` 로 회색을 곱한다** — 5단계 음영과
 *     같은 원리다(원본도 곱하기다). 강도 100 = 원래 · 0 = 완전 검정.
 *
 *   @param {number} [강도] 0~100 — 생략하면 100(원래 화면)
 *   @returns {string} CSS 색 (`multiply` 로 덮을 것)
 * ══════════════════════════════════════════════════════════════════════ */
Hud.전환페이드 = {
  시작강도: 100,        /* 0x55EFD mov edx,0x64 */
  단계: 5,              /* 0x55F2A sub [esp],5 */
  프레임틱: 3,          /* 0x55EF8 mov eax,3 → 0x1033B */
  /** 21단계 (100 → 0) */
  단계수: function () { return Math.floor(100 / 5) + 1; },
  /** 그 강도일 때 곱할 색 — `0x5FA69 imul / 0x5FA71 idiv 100` */
  색: function (강도) {
    var g = 강도 == null ? 100 : (강도 | 0);
    if (g < 0) g = 0; if (g > 100) g = 100;
    var v = Math.round(255 * g / 100);
    return 'rgb(' + v + ',' + v + ',' + v + ')';
  }
};

/** 조건 화면을 띄운다(`null` 이면 지운다). 빈 목표면 아무 일도 안 한다. */
Hud.prototype.objective = function (text) {
  if (text === undefined) return this._obj || null;
  var t = (text == null ? '' : String(text));
  this._obj = /\S/.test(t) ? { text: t, at: Date.now() } : null;   // 0x49418
  return this._obj ? true : false;
};

/* ══════════════════════════════════════════════════════════════════════
 *  ★★★★★ **화면 문구** — `op 0x73`(`0x52B4F`) + 표시 루틴 `0x5046C`
 *
 *  사용자 설명 (2026-08-23): 「1-1 의 경우 상단쪽 카메라에서 시작하고 거기에
 *  **대화창 아닌 문구**가 뜨고 카메라가 아래로 내려오면서 …」
 *
 *  ★ 원본을 직접 읽어 확정했다 (`COMBATII.EXE 0x5046C`):
 *
 *  ```asm
 *  0x50470  edx = [0xA0250]           ; 지금 보이는 줄 (없으면 건너뜀)
 *  0x5047E  push edx / push 0x24 / push 0x20
 *  0x50488  call 0x5E048              ; ★ 그리기 — **(0x20, 0x24) = (32, 36)**
 *  0x5048D  dx = [0xA057C] − 1        ; ★ 남은 시간 **매 틱 −1**
 *  0x504A0  jg  → 아직 유지
 *  0x504A5  읽기idx([0xA0692]) == 쓰기idx([0xA0691]) ?
 *             같으면 → 0x504F1: [0xA0250] = 0      ; ★ 표시 끝
 *  0x504C1  ecx = 0x8F0BC + idx*0x10B ; 링버퍼 다음 줄 (한 줄 267 B · 16줄)
 *  0x504C9  [0xA0250] = ecx           ; ★ 다음 줄로 **자동 교체**
 *  0x504CF  ax = [idx*2 + 0x9016A]    ; ★ **SCE 가 지정한 프레임 수** (0x52BB8 이 적재)
 *  0x504DC  [0xA057C] = ax            ; ★ 표시 시간 = 그 값 (길이가 아니다 · 2026-08-24 정정)
 *  0x504E7  idx = (idx+1) % 16
 *  ```
 *
 *  ⇒ `0x73` 은 **큐에 넣기만** 한다. 표시는 여기서 **한 줄씩 자동으로** 넘어간다.
 *    빈 줄도 길이만큼 시간을 쓴다 — 「사이 두기」다.
 * ══════════════════════════════════════════════════════════════════════ */
var 문구 = {
  x: 0x20, y: 0x24,        /* 0x5047F push 0x24 · 0x50481 push 0x20 */
  링: 16,                  /* 0x504E7 idiv 0x10 */
  /* ★★★★★ **한 프레임 = 9틱 ≈ 51.3 ms** (2026-08-24 정정)
   *
   *   사용자 지적: 「지금은 **창없는 대사 진행이 너무 빨라.**」
   *
   *   예전엔 「원본 갱신 주기 = anim.js frameMs(5틱 · 28.5ms)」로 잡았다.
   *   문구를 돌리는 루프를 직접 읽으니 **자기 간격을 따로 세운다**:
   *     0x52AA5  mov eax, 9 / call 0x1033B   ; 문구 대기 루프(mode 2)
   *     0x53026  mov eax, 9 / call 0x1033B   ; 이벤트 루프
   *   `0x1033B(n)` 은 `[0x4] = n` 으로 프레임 간격을 정하고,
   *   루프의 `0x499E4` 가 그만큼 기다린다(`0x10364` 로 플래그 회전).
   *   ⇒ 걷기(5틱)와 **다른 값**이다. 5틱을 쓰면 **1.8배 빨리** 지나간다.
   *
   *   1-1 은 30·40·40·60 = 170프레임 × 51.3ms ≈ **8.7초**.
   *   (`0x455B6` 은 맵그리기+문구틱만 하는 조각 함수라 간격을 호출자가 정한다) */
  틱ms: 9 * (1000 / 175.47),        /* 9틱 · TICK_HZ 175.47 (링각도_규명.md) */
  행간: 16                 /* [0x755C6] 행간 — EXE 초기값 직독 (세팅 호출부 0건) */
};

/** 줄을 큐에 넣는다 — `op 0x73` (`0x52B4F`). `null` 이면 통째로 지운다. */
Hud.prototype.문구넣기 = function (줄, 길이) {
  if (줄 == null) { this._문구큐 = null; this._문구현재 = null; return this; }
  if (!this._문구큐) this._문구큐 = [];
  /* 0x52B85~ 링버퍼는 16줄이고 넘치면 앞을 덮는다 */
  if (this._문구큐.length >= 문구.링) this._문구큐.shift();
  /* ★ 표시 시간 = **SCE 명령의 첫 u16**(`0x52B5E`→`0x52BB8`). 못 받으면 어림값 */
  var n = (길이 != null) ? (길이 | 0) : (String(줄).length * 2 + 1);
  this._문구큐.push({ text: String(줄), 남음: n });
  /* 0x52BCF — 보이는 것이 없으면 **바로 첫 줄을 건다** */
  if (!this._문구현재) this._문구현재 = this._문구큐.shift();
  return this;
};

/** 매 틱 한 번 — `0x5046C`. 남은 시간을 깎고, 다 되면 다음 줄로 넘긴다.
 *
 *  ★★★ **틱은 「화면 갱신 한 번」이다** (2026-08-23 · 원본 호출부로 확인)
 *    `0x5046B` 을 부르는 곳은 **4곳**(`0x455B6`·`0x52ACC`·`0x52AF8`·`0x53030`)이고
 *    전부 **맵을 다시 그리는 자리**다. 원본 화면 갱신 주기는 `frameMs ≈ 28.5ms`
 *    (`anim.js` — `5 × TICK_MS`).
 *    우리 `Hud.draw` 는 rAF(≈16.7ms)라 **1.7배 빨리** 깎였다 — 문구가 그만큼 빨리 사라진다.
 *    ⇒ **시간으로** 잰다. 마지막으로 깎은 뒤 `frameMs` 가 지나야 1 깎는다. */
Hud.prototype.문구틱 = function () {
  var c = this._문구현재;
  if (!c) return false;
  var 지금 = Date.now();
  var 주기 = 문구.틱ms;
  if (c._잰때 == null) { c._잰때 = 지금; return true; }
  if (지금 - c._잰때 < 주기) return true;          /* 아직 한 틱이 안 지났다 */
  var 지난틱 = Math.floor((지금 - c._잰때) / 주기);
  c._잰때 += 지난틱 * 주기;
  c.남음 -= 지난틱;                                /* 0x50494 sub edx, ebx(=1) */
  if (c.남음 > 0) return true;                    /* 0x504A3 jg */
  var q = this._문구큐;
  if (!q || !q.length) { this._문구현재 = null; return false; }   /* 0x504F1 표시 끝 */
  this._문구현재 = q.shift();                     /* 0x504C9 다음 줄로 */
  if (this._문구현재) this._문구현재._잰때 = 지금;
  return true;
};

/** 지금 보이는 줄 (없으면 `null`). */
Hud.prototype.문구현재 = function () { return this._문구현재 || null; };
/** 화면 문구 큐의 읽기 전용 관찰 경계 (`0x504A5`). */
Hud.prototype.문구상태 = function () {
  return Object.freeze({
    표시중: !!this._문구현재,
    대기수: this._문구큐 ? this._문구큐.length : 0,
    완료: !this._문구현재 && !(this._문구큐 && this._문구큐.length)
  });
};
/** 현재 대사 문구의 타자 진행과 대기 단계가 끝났는지 판정한다. */
Hud.prototype.문구끝났나 = function () { return this.문구상태().완료; };

/** 화면에 그린다 — `0x50488 call 0x5E048` 자리. */
/**
 * ★★★★★ **파티 배치 화면** — `COMBATII.EXE 0x54670` (2026-08-24 신설)
 *
 *   사용자 요청: 「각 시나리오별로 **진영별 파티 배치하는 영역 표시**와 **실제 배치**를
 *   구현할 거야.」 사양은 `03_분석/COMBATII/SCE_배치마스크.md` §6 · 주소는 §7.
 *
 *   ── 원본 좌표 (§7-9 에서 확정) ──────────────────────────────────
 *   그리기 말단 `0x5F3FD` → `0x5EB00` 은 **`eax = x` · `edx = y`** 규약이다.
 *
 *     0x54672  edx = 4          ┐ ★ 창틀 `frame.syb` **프레임 0**(180×139) 을
 *     0x54677  eax = 0x7B(123)  ┘   **(123, 4)** 에 → `(123,4)~(303,143)`
 *     0x5467C  ecx = 0x98(152)  ┐ ★ 목록 첫 칸 **(152, 34)**
 *     0x54687  esi = 0x22(34)   ┘
 *     0x546A3  add ecx, 0x1C    ;   x 간격 **28**
 *     0x546B2  add esi, 0x1B    ;   y 간격 **27**
 *     0x546AB  cmp cx, 0x108    ;   x 상한 **264** → 줄바꿈
 *     0x546BA  cmp si, 0x73     ;   y 상한 **115**
 *     0x54603  idiv 5           ; ★ 한 줄 **5칸**
 *     0x54F20~ AUTO 클릭 판정   ;   x **168~195** · y **≤ 92**
 *
 *   ★ 자산은 이미 로드된다 — `battle_assets.js` 의 `files` 에 `FRAME.SYB` 가 있고
 *     `assets.native['FRAME.SYB'].frames` 로 **18프레임**이 나온다(실측).
 *
 *   ★★★★★ **2026-08-29 — `0x54970` 을 `ret` 까지 읽었다.** (84줄 · 가지 3개)
 *     칸마다 **수를 두 번** 그린다 — 그림자와 본체다.
 *
 *     ```
 *     0x54976  ax  = [esi+6]        ; 레코드의 y
 *     0x5497a  eax += 0xB5 (181)    ; ★ 그림자 y = y + 181
 *     0x5497f  cx  = [esi+4]        ; 레코드의 x
 *     0x54986  eax = [esp+8] + cx
 *     0x5498f  inc eax              ; ★ 그림자 x = x + 1
 *     0x54990  ecx = 0x0A (10)      ; ★ 그림자 색 **10**
 *     0x54996  call 0x5F517         ;   (eax=x · edx=y · ebx=[esi+8] 값 · ecx=색)
 *
 *     0x5499f  eax += 0xB4 (180)    ; ★ 본체 y = y + 180   (그림자보다 1 위)
 *     0x549b2  eax = [esp+8] + cx   ;   inc 없음 → 본체 x = x  (그림자보다 1 왼쪽)
 *     0x549b4  ecx = 0x0F (15)      ; ★ 본체 색 **15**
 *     0x549ba  call 0x5F517
 *
 *     0x549c6  esi      += 0x28     ; ★ 레코드 간격 **40바이트**
 *     0x549ca  [esp+8]  += 0x28     ; ★ 칸 x 간격 **40**
 *     ```
 *
 *     ⇒ **색 10을 오른쪽아래 1px 에 깔고 그 위에 색 15로 얹는다.**
 *       필살기의 `0x4AC73 inc edx` 와 **같은 무늬**다.
 *   ☐ 아직 못 본 것 — `0x5F517` 이 수를 어떤 글꼴로 그리는지, 그리고
 *     `0x54A17`·`0x44E0E`(초상화·AUTO 그림). 짐작으로 채우지 않는다.
 */
/**
 * 배치 목록의 아이콘 한 장 — `0x544B2` 규칙.
 *   `R._uspr[파일명]` 이 `(프레임번호) → 캔버스` 함수다(`render.js 유닛자산준비`).
 *   파일명은 `R._sprNames[sprIndex]` 에서 얻는다.
 */
function 배치아이콘(u, 고름) {
  var R = 현재렌더러();
  if (!R || !R.배치아이콘제공자 || u.sprIndex == null) return null;
  /* ★★★ `_uspr` 은 **`battle.units` 기준**으로만 채워진다 (2026-08-24)
   *   배치 목록 캐릭터는 `.SCE` 에 없어서 거기 안 올라온다 —
   *   실측: 목록 첫 항목이 `MAGICIA1.NC2` 인데 `_uspr` 에는 SCE 유닛 6종뿐이었다.
   *   ★ 원시 데이터(`Renderer._선raw`)에는 이미 들어 있다(`유닛자산준비` 가
   *     `배치목록`도 훑도록 고쳤다). `_유닛프레임공급자()`가 그것을 캔버스로 만들어 준다.
   *   ⇒ **필요할 때 부르는 창구**를 쓴다. 처음 몇 프레임은 `null`(로딩 중)이다. */
  var 뽑 = R.배치아이콘제공자(u);
  if (typeof 뽑 !== 'function') return null;
  /* 고른 것만 움직인다 — 원본은 `0x54D24` 가 `[+0x56]` 을 매 프레임 갱신한다.
   *   우리는 그 칸을 안 쓰므로 시계로 대신한다 (그림 결과는 같다). */
  /* ★ 원본 `0x544B2` 의 프레임 규칙
   *     `[+0x56] == 0x80` → **0x27(39) 고정** — 배치된 캐릭터
   *     그 밖              → `13 × (0xFF − [+0x56])`
   *   ☠ **2026-08-29 정정** — 「13 = 한 방향의 모션 수 `[추측]`」은 **틀렸다.**
   *     바로 아래 블록이 이미 정정해 두었다 — 13 은 **레코드 한 칸의 바이트 수**다.
   *     39 = 13 × 3 이므로 **프레임 3**이고, 그것이 사용자가 말한
   *     묶음이고, 그것이 사용자가 말한 「왼쪽으로 돌아선 모습」일 가능성이 크다.
   *     프레임 수가 모자라면 그리지 않는다(캔버스 제공자가 null 을 준다). */
  /* ★★★★★ **0x27 은 바이트 오프셋이지 프레임 번호가 아니다** (2026-08-25 · 원본 확정)
   *   `0x544C3`~`0x54515` 를 풀면 표 주소는
   *     `0xA0A80 + spr*0x34(52) + 13*프레임`
   *   이고, 배치된 것(`[+0x56]==0x80`)은 `lea edi,[eax+0x27]` = **13×3** —
   *   곧 **프레임 3**이다. 한 스프라이트당 항목이 **13 B × 4프레임 = 52 B**.
   *   그 밖은 `13 × (0xFF − [+0x56])` 이라 `[+0x56]` 이 0xFF 부터 줄며 0~3 을 돈다. */
  /* ★★★★★ **NC2 격자는 4방향 × 11모션** — `0x13175 frame = (방향*11 + 모션)*13`
   *   방향은 **0 하 · 1 좌 · 2 상 · 3 우** (`데이터_스키마.md` 99번 칸).
   *
   *   사용자 사양: 「캐릭터가 배치되면 목록 스프라이트가 **음영 처리**가 되고
   *   **옆으로 좌측으로 돌아선 모습**으로 표시돼.」
   *   ⇒ 배치됨 = **방향 1(좌) · 모션 0** = 프레임 `1*11 + 0 = 11`.
   *     대기는 방향 0(하)의 모션 0~3.
   *
   *   ★★★★★ **로더를 읽었다 (2026-08-29)** — 그 넷이 어느 프레임인지는
   *     **코드가 아니라 파일이 정한다.**
   *     ```asm
   *     0x54250  ebp = [esp+0x132] sar 16 · **imul ebp, 0x34(52)**   ; 스프라이트 묶음
   *     0x5425D  ebx = 4 · edx = esp+0x12C · call                    ; 파일에서 4바이트
   *     0x54274  eax = [esp+0x12E] sar 16                            ; ★ 그 4바이트의 **상위 word**
   *     0x5427D  imul eax, 13 · esi = 0xA0A80 · add esi,ebp · add eax,esi
   *     0x54289  edx = eax + 2 · ebx = 1 · call                      ; 표에 1바이트
   *     ```
   *     ⇒ 프레임 번호는 **파일 헤더에서 온다.** 코드는 그 값에 13 을 곱할 뿐이다.
   *   ★★★ 그리고 이 로더는 `0x11756`(전투 스프라이트) 과 **똑같은 꼴**이다 —
   *     거기는 `572 = 13 × 44` · `0xD66A8`, 여기는 `52 = 13 × 4` · `0xA0A80`.
   *     원본이 그 표를 부르는 이름은 **「Character Image Slot」**이다
   *     (`0x76DCD` 오류 문자열 · `ultimate.js` §잔상 큐에 자세히).
   *   ★★★★★★ **갈렸다 (2026-09-02) — 네 칸은 `.NC2` 프레임 `2·3·4·5` 다.**
   *
   *     로더(`0x54111`)를 끝까지 읽으니 **프레임 번호는 파일이 아니라 루프 카운터**였다:
   *       `0x5441F cmp word [esp+0x130], **4** / jl` → 카운터 **0~3**
   *       `0x54273` 이 그 **카운터**를 읽어 `0x5427D imul eax, **13**` 한다.
   *     그리고 파일에서 읽는 자리는 —
   *       `seek(**128**)` → **1 B 를 읽어 버려** 129 부터 (그 값이 0 이 아니면 **+40**)
   *       `0x5420C` 루프가 `seek(상대, size + **0xA**)` 로 **두 번** 건너뛴다
   *     ⇒ 우리 `parseNC2`/`hdrAt` 의 `oo += 12 + size + gap(2)` 과 **같은 식**이다.
   *
   *     **파일로 확인했다** — 읽는 넷의 크기가 `decodeNC2` 프레임 2~5 와 **한 장도 안 틀린다**:
   *       `AKIRA.NC2`    건너뜀 17×24·18×23 → **21×24 · 20×24 · 21×24 · 20×24**
   *       `MAGICIA1.NC2` 건너뜀 22×24·22×23 → **22×24 · 22×24 · 23×24 · 29×24**
   *
   *     ⇒ 칸 0·1·2(대기 깜빡임) = **프레임 2·3·4** — `0x54C97 ebp = **3**` 과 맞물린다.
   *       칸 3(배치됨 `[+0x56]==0x80`) = **프레임 5**.
   *   ☠ 여기 있던 「프레임 번호는 파일 헤더에서 온다」·「좌향 = 11」은 **둘 다 틀렸다.**
   *     `.NC2` 는 44 장(4 방향 × 11 모션)이지만 **배치 목록은 그 격자를 안 쓴다.**
   *     자세히는 `03_분석/COMBATII/SCE_배치마스크.md` — 「표 4 칸은 프레임 2·3·4·5」 */
  /* ★★★★★ **배치된 사람은 `.NC2` 프레임 11 — 옆으로 돌아선 모습** (2026-09-03)
   *
   *   > 사용자 지적: 「배치화면에서 **배치된 캐릭터들 모션 잘못됐어. 옆으로 도는거**라고
   *   >   했잖아. **왜 이상한 공격모션으로** 했어?」
   *
   *   ☠ 2026-09-02 에 「프레임 5 확정」으로 적은 것이 **틀렸다.** 그때 보여 드린
   *     그림(`05_결과/그림확인/배치목록_KNIGHT1_프레임0-1-2-3-4-5-11.png`)은
   *     `0·1·2·3·4·5·11` 일곱 장이었고, 사용자가 「**6번째** 모습으로 기억해.
   *     옆으로 돌아섰던」이라 답한 것을 **프레임 5** 로 받았다. 그런데 그림에서
   *     실제로 **옆으로 돌아선 것은 일곱째(프레임 11)** 다. 여섯째(프레임 5)는
   *     **칼을 위로 든 정면** — 사용자가 지금 「이상한 공격모션」이라 부른 그것이다.
   *
   *   ★ 크기로도 갈린다 — `.NC2` 프레임 5 는 파일마다 제각각이라 24×24 칸에 안 맞는다:
   *     `AKIRA` 20×24 · `MAGICIA1` **29×24** · `KNIGHT1` 23×25 · **`LANCER1` 24×38**
   *     (LANCER1 은 창을 세워 든 자세라 세로가 38 — 24 칸을 한참 넘긴다.)
   *     프레임 11 은 `KNIGHT1` 24×23 · `AKIRA` 19×24 · `MAGICIA1` 21×24 ·
   *     `LANCER1` 23×24 로 **전부 24 안팎**이다. 목록 칸에 들어가는 쪽은 이쪽이다.
   *
   *   ☐ **원본 코드 판독과는 아직 어긋난다** — `0x544BD cmp [+0x56],0x80` →
   *     `0x544DD lea edi,[eax+0x27]` = 표칸 3 이고, 로더 `0x54111` 이 표 4칸에
   *     넣는 것은 `.NC2` **프레임 2·3·4·5** 다(AKIRA `21×24·20×24·21×24·20×24` ·
   *     MAGICIA1 `22×24·22×24·23×24·29×24` — 크기가 한 장도 안 틀린다).
   *     ⇒ 로더가 「청크 둘을 건너뛴다」고 읽은 자리(`AKIRA 0x444`·`MAGICIA1 0x53C`)를
   *       다시 확인해야 한다. **화면으로 본 것이 이기므로 먼저 고치고, 근거는 잇는다.**
   *     자세히: `COMBATII/SCE_배치마스크.md` §「2026-09-03」 */
  var 칸 = 0;
  var 배치프레임 = 11;                               /* 옆으로 돌아선 모습 (사용자 화면 대조) */
  if (u.배치됨) return (function () {
    try { return 뽑(배치프레임) || null; } catch (e) { return null; }
  })();
  /* ★★★★★ **깜빡임 주기는 30 틱이다** (2026-09-03 · 사용자 지적 「선택된 캐릭터 모션도 잘못되었어」)
   *
   *   `200` 은 **근거 없이 넣은 값**이었다. 원본은 시간이 아니라 **틱 창구**를 본다:
   *   ```asm
   *   0x54CC6  call 0x102FF          ; ★ [0x89A6] 을 소비하는 창구 — **30 틱 타이머**
   *   0x54CCB  cmp ax, 1 / jne       ;   그때만 한 칸 넘어간다
   *   0x54CF8  cmp ax, 0x80 / je     ;   배치됨이면 안 돈다
   *   0x54D0C  inc eax               ;   칸 + 1
   *   0x54D12  idiv ebp              ; ★ ÷ 3 (ebp = 3 · 0x54C97) → 0→1→2
   *   0x54D24  mov [esi+0x56], al    ;   [+0x56] = 0xFF − 칸
   *   ```
   *   기준본 `COMBATII/SCE_배치마스크.md` §「깜빡임 `0x54CD1`」.
   *   ★ 1 틱 = 5.6987 ms (175.47 Hz) → **30 틱 = 170.96 ms**.
   *   ★ 도는 것은 **마우스가 가리키는 그 칸 하나**뿐이다 (`0x54CDE` 색인 = `[edi]+[ecx]`). */
  else if (고름) 칸 = ((Date.now() / 170.961) | 0) % 3;   /* 0x54CC6 30틱 · 0x54C97 ebp=3 */
  var n = 2 + 칸;                                    /* 표 칸 → .NC2 프레임 (앞 둘을 건너뛴다) */
  /* ★ 반환은 `{canvas, ax, ay, w, h}` 다 — 앵커까지 함께 온다(실측) */
  try { return 뽑(n) || null; } catch (e) { return null; }
}

/** [리마스터] 탈것 쪽 발톱 자리 (논리 좌표) — 비룡 칸(180~214)과 돈 칸(220~) 사이. battle_main 클릭도 이 값을 쓴다 */
var 탈것발톱 = { 위: { x: 213, y: 166, w: 6, h: 17 }, 아래: { x: 213, y: 183, w: 6, h: 17 } };
/** [리마스터] 3급 마장기 옆모습 그림 — 유닛 그림 방향 3 정지(프레임 24). 렌더러가 그림을 실은 뒤에만 나온다 */
function 마장기탈것아이콘(코드) {
  var R = 현재렌더러();
  if (!R || !R.배치아이콘제공자) return null;
  /* 그림 정보(발자국 2×2)도 셈 쪽에 등록해 둔다 — 놓을 때 footOf 가 [1,1] 로 떨어지지 않게 (render.js _대체스프라이트정보) */
  try { if (R.스프라이트확보) R.스프라이트확보((코드 | 0) + 299); } catch (e0) { }
  var 뽑 = R.배치아이콘제공자({ sprIndex: (코드 | 0) + 299 });
  if (typeof 뽑 !== 'function') return null;
  try { var f = 뽑(24); return (f && f.canvas) || null; } catch (e) { return null; }
}

/** 전투 배치 목록·칸·탈것·안내 UI를 현재 상태로 그린다. */
/* ══════════════════════════════════════════════════════════════════════
 *  [리마스터 편의] 배치 화면 STATUS·CLASS·ITEM 단추 (2026-10-07)
 *   사장님(원문) 「전투 배치화면에서 스테이터스, 전직, 아이템 창을 진입 가능한 버튼을 만들어 진입이 가능하면 좋겠어.」
 *   원본에 없는 단추다. 자리는 초상화(0x48132 · 위 끝 y 25) 위 빈 띠 · 창틀(x 123~) 왼쪽.
 *   글자는 TEXT.CHR(0x608E6 · 한 자 6px) · 색은 정보 띠 이름과 같은 0x11 · 바탕 0.
 *   셸(screens.js 배치창열기)이 없는 전투 단독 실행이나 옵션 '원작' 이면 빈 표.
 * ══════════════════════════════════════════════════════════════════════ */
/* [리마스터] 패드 하이라이트 — 그림(img) 모양 금빛 실루엣을 1·2·3px 바깥으로 겹쳐 깐다(안 진하고 바깥 옅게) · 이 뒤에 그 그림을 그리면 테두리만 남는다 (ring.js _패드테두리 와 같은 꼴) */
function 패드금빛(ctx, img, x, y, w, h) {
  if (!img || typeof document === "undefined") return;
  var iw = img.width || img.naturalWidth, ih = img.height || img.naturalHeight; if (!iw || !ih) return;   /* ★ 실제 그림 판 크기 — 스케일러는 판을 N배로 굽고 naturalWidth 에 원래(논리) 크기를 적어 둔다 · 그걸 먼저 읽어 왼쪽 위 1/N 만 잘려 한 점으로 뭉쳤다 (사장님 11-07 사진) */
  var c = document.createElement("canvas"); c.width = iw; c.height = ih;
  var q = c.getContext("2d"); q.drawImage(img, 0, 0, iw, ih);   /* 크기를 꼭 준다 — 안 주면 원래(논리) 크기로 작게 들어가 왼쪽 위로 뭉쳤다 */ q.globalCompositeOperation = "source-in"; q.fillStyle = "rgb(255,205,80)"; q.fillRect(0, 0, iw, ih);
  var a = 0.75, 옛 = ctx.globalAlpha;
  [[3, 0.22], [2, 0.42], [1, 0.8]].forEach(function (k) { ctx.globalAlpha = k[1] * a; for (var t = 0; t < 8; t++) ctx.drawImage(c, 0, 0, iw, ih, x + Math.cos(t * Math.PI / 4) * k[0], y + Math.sin(t * Math.PI / 4) * k[0], w, h); });
  ctx.globalAlpha = 옛;
}
function 배치창단추() {
  var O = root.G2Opt, S = root.G2Screens;
  if (!S || typeof S.배치창열기 !== 'function') return [];
  if (O && O.cfg && O.cfg.배치창 === '원작') return [];
  var 표 = [['STATUS', 'STATUS'], ['CC', 'CLASS'], ['EQUIP', 'ITEM']];
  /* [개발용] 전체 아이템 상점 — 개발 패널 «개발상점» 켬일 때만 (배포 실행기에는 개발 패널이 없어 안 보인다 · 11-13 정본 149) */
  if (O && O.cfg && O.cfg.개발상점 === '켬') 표.push(['DEVSHOP', 'SHOP']);
  var x = 20, 결과 = [];
  for (var i = 0; i < 표.length; i++) {
    var w = 표[i][1].length * 6 - 1 + 4;          /* 글자폭 + 양옆 2 */
    결과.push({ 화면: 표[i][0], 글: 표[i][1], x: x, y: 7, w: w, h: 13 });
    x += w + 2;
  }
  return 결과;
}

Hud.prototype.draw배치창단추 = function (ctx) {
  var 단추 = 배치창단추();
  for (var i = 0; i < 단추.length; i++) {
    var b = 단추[i];
    this.fillRect(ctx, b.x, b.y, b.x + b.w - 1, b.y + b.h - 1, 0);
    this.hline(ctx, b.x, b.y, b.w, 0x11);
    this.hline(ctx, b.x, b.y + b.h - 1, b.w, 0x11);
    this.fillRect(ctx, b.x, b.y, b.x, b.y + b.h - 1, 0x11);
    this.fillRect(ctx, b.x + b.w - 1, b.y, b.x + b.w - 1, b.y + b.h - 1, 0x11);
    this.text(ctx, b.글, b.x + 2, b.y + 3, 0x11);
  }
  return this;
};

Hud.prototype.draw배치 = function (ctx, battle) {
  var A = this.assets;
  var F = A && A.native && A.native['FRAME.SYB'];
  if (!F || !F.frames || !F.frames.length) return this;

  /* ★★★★★ **배치 모드에서는 UI 를 걷는다** (2026-08-24)
   *   사용자 사양: 「캐릭터 선택 화면에서는 못 움직이고 **선택한 상태에서
   *   배치 영역 나오고 실제 맵에 배치할 때는 맵 스크롤 되고**, 이 상태에서
   *   우클릭 시 캐릭터 선택 화면으로 복귀(esc 동일).」
   *   ★ 사용자가 처음 준 「배치영역」 사진에도 **UI 가 없고 맵과 영역만** 있었다.
   *   ⇒ `배치놓는중` 이면 오버레이를 통째로 건너뛴다. 맵 위 배치 영역 마크
   *     (`R.addMark` · `world` 레이어)는 그대로 남는다. */
  if (battle.배치놓는중) return this;

  /* 프레임 하나를 논리 좌표에 그린다 (`0x5F3FD`).
   *   ★ 정식 창구는 `Assets.image('@파일#n')` 이다 — 원본 프레임을 캔버스로 굽고
   *     스케일러가 켜져 있으면 `논리w/h` 를 함께 남긴다(`hud.js 612`). */
  function 조각(i, x, y) {
    var c = A.image('@FRAME.SYB#' + i);
    if (!c) return;
    var w = c.논리w || c.naturalWidth || c.width;
    var h = c.논리h || c.naturalHeight || c.height;
    ctx.drawImage(c, 0, 0, c.width, c.height, x, y, w, h);
  }

  /* ★★★★★ **화면 음영** — 사용자 사양: 「이 화면이 뜰 때에는 **음영 처리** 들어가야 하고」
   *   원본 사진에서 창 **안팎이 모두** 어둡고 초상화·UI 만 밝다.
   *   ★★★ **2026-08-29 절반** — `0x454EE` 바로 앞이 그 창구다.
   *     `0x454F2  eax = 1 · edx = 4 · call 0x5ECC6`
   *     `0x45501  eax = 0x10 · call 0x5EDDD`
   *     `0x5ECC6` 은 갈래마다 `mov dword [0x755E2], <루틴 주소>` 를 하고 `ret` —
   *     곧 **그리기 루틴을 갈아 끼우는 설정 함수**다. 음영은 색을 칠하는 것이
   *     아니라 **그리기 루틴 교체**로 나온다.
   *   ★★★ **2026-08-29 보탬** — 그 포인터를 **쓰는 쪽**도 찾았다:
   *     `0x5EDFE  push eax,edx,ebx · **call dword [0x755E2]** · pop · inc edx · loop`
   *     곧 `0x5EDDE` 가 그 루틴을 **줄마다** 불러 사각 영역을 칠한다
   *     (`battle_ui.js` §대사창 배경의 `0x48457`·`0x48475` 두 호출이 그것이다).
   *   ☐ `eax`/`edx` 조합이 어느 루틴을 고르는지는 아직.
   *     확인 전까지 `dimScreen`(조건 화면·옵션과 같은 창구)을 쓴다.
   *     0~7)과 같은 식이 `0x21FA6` 에 있지만 그 자리는 다른 용도로 보인다.
   *   ★★★ **음영은 여기서 안 칠한다** — `_HUD본문그리기` 맨 앞으로 옮겼다 (2026-08-25).
   *     원본 `0x454EE` 가 맵 그리기(`0x45513`)·상하단 바(`0x45518`) **보다 먼저**라
   *     바는 밝게 남아야 하기 때문이다. */

  /* 목록은 `units` 가 다 채워진 뒤 만들어야 한다 — 처음 그릴 때 한 번 세운다 */
  if ((!battle.배치목록 || !battle.배치목록.length) && battle.배치목록다시)
    battle.배치목록다시();
  var 목록 = battle.배치목록 || [];

  /* ★★★ UI 조각 좌표는 전부 원본에서 떴다 (`SCE_배치마스크.md` §7-13).
   *   프레임 `i` 의 그림 포인터 `[0x88138 + i*12 + 8]` 를 참조하는 곳을 전수로 찾았다. */
  /* ★★★ **초상화** — `0x54743` 함수가 `0x5475E call 0x48132(72, 136, [+0x10])` 로 그린다.
   *   `PORTRAIT.SYF` 앵커가 `(−w/2, −h/2)` 라 **중심 좌표**다(`STATUS_LAYOUT.portrait` 와 같다).
   *   고른 항목의 초상화를 왼쪽에 크게 띄운다 (사용자 사진의 왼쪽 큰 그림). */
  var 고름m = 목록[battle.배치고른 | 0];
  if (고름m) {
    var pn = 고름m._원본 ? (고름m._원본[0x10] | 0) : -1;   /* 0x54756 bl = [eax+0x10] */
    var pf = (pn >= 0) ? A.frame('PORTRAIT.SYF', pn) : null;
    if (pf) {
      var pc = A.image('@PORTRAIT.SYF#' + pn);
      if (pc) {
        /* ★★★★★ **논리 크기로 그린다** (2026-08-25 · 사용자 지적)
         *   「캐릭터 선택창은 hud 에 그려야 하는데 **필드에 그려서 배율에 따라
         *   위치나 크기도 엉망**으로 바뀌고」
         *   ⇒ `Assets.image()` 는 스케일러가 켜져 있으면 **N배로 구운** 캔버스를 준다.
         *     원래 크기는 `.논리w`/`.논리h` 에 있다(`hud.js 612` · CLAUDE.md 의 함정).
         *     `조각()` 은 이미 그렇게 하는데 초상화만 빠져 있어 **배율만큼 부풀었다.** */
        var pw = pc.논리w || pc.naturalWidth || pc.width;
        var ph = pc.논리h || pc.naturalHeight || pc.height;
        /* ★★★★★ **x 는 중심, y 는 바닥** — `0x48132` (2026-08-25 · 화면 대조로 잡음)
         *   ```asm
         *   0x48137  edi = eax(72)   ; x 기준
         *   0x48139  esi = edx(136)  ; y 기준
         *   0x48245  eax = [esp+0xa] >> 17      ; ★ 폭 / 2
         *   0x4824A  edi -= eax                 ;   x = 72 − 폭/2
         *   0x48248  esi -= [esp+8]             ; ★ y = 136 − **높이**  (바닥 맞춤)
         *   0x4828E  call 0x5F3FD(eax=edi, edx=esi)
         *   ```
         *   실측 `PORTRAIT.SYF` 는 **103×111**(앵커 −51,−55)이라
         *     x = 72 − 51 = 21 · y = 136 − 111 = **25** → 그림은 (21,25)~(124,136).
         *   정보 띠가 y 140 부터이므로 **딱 그 위**에서 끝나고, 오른쪽 124 는
         *   창틀(x 123~) 에 닿는다 — 화면이 맞아떨어진다.
         *   ★ 전에는 `136 − 높이/2` 로 **세로 중심**에 놓아 y 81~192 가 되면서
         *     정보 띠의 이름·STR 을 덮었다(실측: 「AGICIAN」·「TR 10」으로 잘림).
         *   ★★★★★ **그 조건을 찾았다 (2026-08-29)** — 높이 비교 **앞에**
         *     갈림이 하나 더 있다.
         *     ```asm
         *     0x48230  test bx, bx / jne 0x4824C          ; ★ 먼저 bx 를 본다
         *
         *     ; bx == 0 — **바닥 맞춤**
         *     0x48239  edx = [esp+8](높이) · 0x48244 sar eax,17(폭/2)
         *     0x48248  sub esi, edx                        ; y = 136 − 높이
         *     0x4824A  sub edi, eax                        ; x = 72 − 폭/2
         *
         *     ; bx != 0 — 높이로 다시 가른다
         *     0x4825C  cmp cx, 0x78(120) / jle 0x48275
         *     0x48264  add esi,0x3C(60) · sub esi,ecx      ; y = 196 − 높이
         *             (0x4826A test si,si / jg / xor esi,esi — 음수면 0)
         *     0x48275  sar eax,17 · sub esi,eax            ; y = 136 − 높이/2
         *     ```
         *     ⇒ `PORTRAIT.SYF`(103×111)가 위에서 맞아떨어진 것은 **`bx == 0` 갈래**이기
         *       때문이다. 높이 111 은 ≤ 120 이라, 만약 `bx != 0` 이었다면
         *       **136 − 55 = 81** 이 되어 정보 띠를 덮었을 것이다 — 실측으로 틀렸던 그 값이다.
         *   ★ `bx` 는 **`0x48224 mov ebx, [esp+0x10]`** 에서 온다 —
         *     바로 뒤 `0x48228 call 0x10031` 의 인자이기도 하다.
         *   ☐ `[esp+0x10]` 이 호출부에서 무엇으로 채워지는지는 아직.
         *     그러나 갈림 자체는 확정이다. */
        ctx.drawImage(pc, 0, 0, pc.width, pc.height,
                      72 - (pw >> 1), 136 - ph, pw, ph);   /* 0x48245 · 0x48248 */
      }
    }
  }

  조각(0, 123, 4);          /* 0x54672 edx=4    · 0x54677 eax=0x7B  — 창틀 180×139 */
  조각(3, 20, 140);         /* 0x54763 edx=0x8C · 0x54768 eax=0x14  — 정보 띠 280×27 */
  조각(4, 20, 168);         /* 0x54870 edx=0xA8 · 0x5487D eax=0x14  — AUTO 71×27 */
  this.draw배치창단추(ctx);   /* [리마스터 편의] 위 배치창단추 */

  /* ★★★★★ **정보 띠 글자** — `0x54778`~`0x5486B` (`SCE_배치마스크.md` §7-14)
   *   이름은 조합형(`0x5E048`), 나머지는 ASCII 서식(`0x60944`)이다.
   *   능력치는 BLACKBOX 레코드 `+0x40`~`+0x43` = STR·INT·DEX·CHA. */
  if (고름m && 고름m._원본) {
    var r = 고름m._원본;
    var 이름 = (고름m.유닛 && 고름m.유닛.name) ||
               (root.G2Sce && root.G2Sce.decodeJohab
                  ? root.G2Sce.decodeJohab(r, 0x02, 11, true).replace(/ +$/, '') : '');
    /* 0x54778 — 이름 (20,146) · 조합형 */
    /* 0x54778 lea eax,[edi+2] / push 0x92(146) / push 0x14(20) / call 0x5E048
     *   ★ y 는 **146 그대로**다 — 전에 임의로 5 를 뺐다. */
    /* ★★★★★ **`0x5E048` 은 왼쪽 x 다** — `koreanOutlined` 는 **중심** (2026-08-25)
     *   실측: 레코드 `+2` 가 「 미 카 엘」(공백 포함)이라 폭 72px 인데
     *   중심 20 으로 주면 `leftX = 20 − 36 = −16` → **화면 밖으로 반이 잘렸다**
     *   (사진에서 두 글자만 보였다). 원본은 `push 0x14(20)` 가 **글자 시작 x** 다.
     *   ⇒ 폭을 먼저 재서 `20 + 폭/2` 를 중심으로 준다
     *     (`_조합형글자외곽선`과 같은 규칙: 한글 16 · 그 밖 8). */
    /* ★★★★★ **왼쪽 x 를 그대로 준다** — `newhanLeft` (2026-08-25 · 사용자 지적)
     *
     *   사용자: 「캐릭터 **이름 좌 어긋났고** 이름 **테두리 색깔(검정색이어야하는데
     *   지금은 노란색)** 잘못되었어.」
     *
     *   ① 자리 — 원본 `0x5477C push 0x92(146) / 0x54781 push 0x14(20)` 은
     *     **왼쪽 x = 20** 이다. 중심으로 환산해 넘기면(`20 + 폭/2`) 폭을 두 번 재게 되어
     *     반올림만큼 흔들린다. `newhanLeft` 는 **왼쪽 x 를 그대로** 받는다.
     *   ② 색 — 테두리를 `0x12` 로 주고 있었다. 원본 전투 진입 `0x55C25` 가
     *     `0x5DB66(모드 4, dx = 0x1100, bx = 0xFF)` 로 세우는 값이 **`0x11`(노랑) 속색 +
     *     `0x00`(검정) 테두리** 다. 검정으로 바로잡는다. */
    var _s = 이름_공백정리(String(이름));
    this.newhanLeft(ctx, _s, 20, 146, 0x11, 0x00);          /* 0x54781 x=20 · 0x5477C y=146 */

    /* 0x547A9~0x5486B — ASCII 서식 (`hp %lu` 등). 값은 레코드에서 바로 읽는다. */
    /* ★ 직업명 — `COMBATII.EXE 0x71118`(16 B) 직독 (`render.js` 가 `G2직업명` 에 담는다) */
    var 직업표 = (root.G2직업명 && root.G2직업명[r[0x11] | 0]) || '';
    /* ★★★★★ **글자색은 `0x60944` 의 네 번째 인자다** (2026-08-25 · 원본 확정)
     *   ```asm
     *   0x547A9  f(108,147, 1, 0x10, "%s",   직업명)     ; 직업   = 색 16
     *   0x547CD  f(208,147, 1, 0x28, "hp %lu", HP)       ; HP·MP  = 색 40
     *   0x547EF  f(258,147, 1, 0x28, "mp %d",  MP)
     *   0x5480D  f(108,156, 1, 0x08, "str %d", STR)      ; 능력치 = 색 8
     *   0x5482E  f(158,156, 1, 0x08, "int %d", INT)
     *   0x5484F  f(208,156, 1, 0x08, "dex %d", DEX)
     *   0x54870  f(258,156, 1, 0x08, "cha %d", CHA)
     *   ```
     *   전에는 **전부 0x11** 로 칠했다 (사용자 2026-08-25:
     *   「직업 및 스탯 글자색깔」이 다르다). */
    var 칸 = [
      [108, 147, 직업표 || '', 0x10],                             /* 0x547A9 */
      /* ★ HP 는 레코드에 **×100** 으로 들어 있다 (`blackbox.js` — `현재HP: u32(o+0x48)`).
       *   MP 는 `u16(o+0x50)` 이고 배율이 없다. 처음에 둘 다 u16 으로 읽어
       *   `HP 10000` 이 나왔다(실측). */
      [208, 147, 'hp ' + (((r[0x48] | (r[0x49] << 8) | (r[0x4A] << 16) | (r[0x4B] << 24)) / 100) | 0), 0x28],
      [258, 147, 'mp ' + (r[0x50] | (r[0x51] << 8)), 0x28],
      [108, 156, 'str ' + (r[0x40] | 0), 0x08],                    /* 0x5480D */
      [158, 156, 'int ' + (r[0x41] | 0), 0x08],                    /* 0x5482E */
      [208, 156, 'dex ' + (r[0x42] | 0), 0x08],                    /* 0x5484F */
      [258, 156, 'cha ' + (r[0x43] | 0), 0x08]                     /* 0x54870 */
    ];
    for (var t = 0; t < 칸.length; t++) {
      if (칸[t][2]) this.text(ctx, String(칸[t][2]), 칸[t][0], 칸[t][1], 칸[t][3]);
    }
  }

  /* ★★★★★ **탈것 UI** — 0x548AD~0x549D6 (2026-08-25)
   *   사용자: 「맵에 따라 오토와 돈 사이에 탈것 UI 가 생기고(말 2 + 비룡),
   *   이때는 **검정색 실루엣**으로 표시돼 … 색깔 들어온 탈것을 한 번 더 클릭하면
   *   실루엣으로 돌아오고」
   *     0x548E3 ebx = 0x72(114)                        슬롯 x
   *     0x54950 프레임 = u16[0x75496 + X*6 + 종류*2 + 2] (−1 이면 안 그림)
   *     0x54969 프레임 += 6 → frame.syb 포인터 0x88138 + 프레임*12
   *     0x54976 y = [esi+6] + 0xB5(181) · x = 슬롯x + [esi+4] + 1 · 색 10 → 0x5F517
   *     0x5499B y = [esi+6] + 0xB4(180) · x = 슬롯x + [esi+4]     · 색 15 → 0x5F517
   *     0x549BF 슬롯x += 0x28(40) · 종류 < 3 이면 되풀이
   *     0x549E3 타고 있으면 그 자리에 **컬러**로 덧그린다 (0x5F3FD) */
  if (고름m && battle.탈것UI보임 && battle.탈것UI보임(고름m)) {
    var 마장기됨 = !battle.마장기탈것가능 || battle.마장기탈것가능();   /* 마장기 불가 판(전투 종류 ≠ 0)이면 쪽 고르기·마장기 칸 없음 */
    if (!마장기됨) battle.탈것쪽 = 0;
    var 탈쪽 = battle.탈것쪽 | 0;                     /* [리마스터] 0 말·비룡 · 1 마장기 */
    if (탈쪽 === 1) {
      /* [리마스터] 마장기 쪽 — 유닛 그림의 옆모습(방향 3 · 정지 = 프레임 24 · 말 칸처럼 왼쪽을 본다)을
       *   칸(말 칸 30×20 자리 · 비룡 34×21)에 맞춰 줄여 그린다. 고르기 전은 말·비룡과 같은 실루엣(색 10·15) */
      var 쪽1코드들 = battle.쪽1코드들 ? battle.쪽1코드들(고름m.코드 | 0) : battle.마장기탈것코드;   /* 정본 270 — 고른 캐릭터 기준 I 판 */   /* [리마스터] 해전이면 비룡 한 칸 · 진영 I 판 (11-13 · 정본 160) */
      for (var mt = 0; mt < 쪽1코드들.length; mt++) {
        var mc = 마장기탈것아이콘(쪽1코드들[mt]);
        if (!mc) continue;
        var 배 = Math.min(34 / mc.width, 21 / mc.height);
        var mw = mc.width * 배, mh = mc.height * 배;
        var mx0 = 114 + 40 * mt - 14 + (30 - mw) / 2, my0 = 170 + (21 - mh) / 2;
        if (root.__패드커서숨김 && battle.__패드탈것 === mt) 패드금빛(ctx, mc, mx0, my0, mw, mh);   /* [리마스터] 패드가 가리킨 마장기 */
        if ((고름m.탈것 | 0) === mt + 1 && (고름m.탈것쪽 | 0) === 1) {
          ctx.drawImage(mc, 0, 0, mc.width, mc.height, mx0, my0, mw, mh);
        } else {
          this.실루엣(ctx, mc, mx0 + 1, my0 + 1, mw, mh, 10);
          this.실루엣(ctx, mc, mx0,     my0,     mw, mh, 15);
        }
      }
    }
    /* [리마스터] 탈것 쪽 고르기 — 목록 발톱(창틀 그림 FRAME.SYB 0 의 (163,20)·(163,73) 17×49)을 줄여 비룡 칸과 돈 칸 사이에.
     *   눌리면 눌린 발톱(FRAME.SYB 1·2 · 노랑)으로 182ms — 목록 발톱과 같은 규칙 (2026-10-03 사장님 지정) */
    var 창틀 = A.image('@FRAME.SYB#0');
    if (창틀 && 마장기됨) {
      var 틀배 = (창틀.width / (창틀.논리w || 창틀.width));
      var 탈눌 = battle.탈것발톱눌림;
      var 탈눌중 = 탈눌 && (Date.now() - (+탈눌.때 || 0)) < 182.36;
      [[1, 163, 20, 탈것발톱.위], [2, 163, 73, 탈것발톱.아래]].forEach(function (k) {
        var r = k[3];
        if (탈눌중 && (탈눌.방향 | 0) === k[0]) {
          var 눌그림 = A.image('@FRAME.SYB#' + k[0]);
          if (눌그림) { ctx.drawImage(눌그림, 0, 0, 눌그림.width, 눌그림.height, r.x, r.y, r.w, r.h); return; }
        }
        ctx.drawImage(창틀, k[1] * 틀배, k[2] * 틀배, 17 * 틀배, 49 * 틀배, r.x, r.y, r.w, r.h);
      });
    }
    for (var vt = 0; 탈쪽 === 0 && vt < 3; vt++) {
      if (!battle.탈것쓸수있나(고름m, vt)) continue;
      var vf = battle.탈것프레임(vt);
      /* 정본 270 — 고른 캐릭터가 다크아머라 탈것 코드가 I 판으로 바뀌면 원작 UI 그림(FRAME.SYB · 진영 구분 없음) 대신 I 판 유닛 그림으로 (사장님 11-18 「배치화면에도 달리 표시되면 좋겠어」) */
      var 기본코드v = battle.탈것코드결정 ? battle.탈것코드결정(vt + 1, 0, 0) : 0, 실코드v = battle.탈것코드결정 ? battle.탈것코드결정(vt + 1, 0, 고름m.코드 | 0) : 0;
      var I그림v = (vf >= 0 && 실코드v && 실코드v !== 기본코드v) ? 마장기탈것아이콘(실코드v) : null;   /* 아직 못 받았으면 원작 그림으로 */
      if (vf < 0 || I그림v) {   /* [리마스터] 원작 UI 그림이 없는 탈것(배틀쉽) — 유닛 그림으로 (11-13 · 정본 160) */
        var bc = I그림v || (실코드v ? 마장기탈것아이콘(실코드v) : null);
        if (bc) {
          var b배 = Math.min(34 / bc.width, 21 / bc.height), bw = bc.width * b배, bh = bc.height * b배;
          var bx0 = 114 + 40 * vt - 14 + (30 - bw) / 2, by0 = 170 + (21 - bh) / 2;
          if ((고름m.탈것 | 0) === vt + 1 && (고름m.탈것쪽 | 0) === 0) ctx.drawImage(bc, 0, 0, bc.width, bc.height, bx0, by0, bw, bh);
          else { this.실루엣(ctx, bc, bx0 + 1, by0 + 1, bw, bh, 10); this.실루엣(ctx, bc, bx0, by0, bw, bh, 15); }
        }
        continue;
      }
      var vc = A.image('@FRAME.SYB#' + vf);
      if (!vc) continue;
      var vfr = A.frame('FRAME.SYB', vf);
      var vax = (vfr && vfr['앵커']) ? (vfr['앵커'][0] | 0) : 0;
      var vay = (vfr && vfr['앵커']) ? (vfr['앵커'][1] | 0) : 0;
      var vw = vc.논리w || vc.naturalWidth || vc.width;
      var vh = vc.논리h || vc.naturalHeight || vc.height;
      var vx = 114 + 40 * vt + vax;
      var vy = 180 + vay;
      if (root.__패드커서숨김 && battle.__패드탈것 === vt) 패드금빛(ctx, vc, vx, vy, vc.논리w || vc.naturalWidth || vc.width, vc.논리h || vc.naturalHeight || vc.height);   /* [리마스터] 패드가 가리킨 탈것 — 그 그림 테두리 (사장님 11-07 「말선택시 말 테두리에 표시되어야해」) */
      if ((고름m.탈것 | 0) === vt + 1) {
        ctx.drawImage(vc, 0, 0, vc.width, vc.height, vx, vy, vw, vh);
      } else {
        this.실루엣(ctx, vc, vx + 1, vy + 1, vw, vh, 10);
        this.실루엣(ctx, vc, vx,     vy,     vw, vh, 15);
      }
    }
  }

  /* ★ 소지금 — 서식 `"%3d ELD"` (`0x7808A`). 좌표는 **바로 아래 §소지금에 확정**돼 있다
   *   (`0x54A3A edx=171 · eax=220` · `0x54A72 f(x=260, y=179)`). */
  /* ★★★★★ **소지금** — `0x54A3A`~`0x54A72` (2026-08-25 · 원본 확정)
   *   ```asm
   *   0x54a3a  edx = 0xab(171) · 0x54a3f eax = 0xdc(220) · ebx = [0x8817c](프레임 5)
   *   0x54a4a  call 0x5F3FD                       ; ★ 칸을 **먼저** 그린다
   *   0x54a51  ax  = [0x8df85]
   *   0x54a57  edx = [eax*4 + 0x8e36f]            ;   금액 표
   *   0x54a72  f(x=0x104(260), y=0xb3(179), 1, 1, "%3d ELD", 금액)   ; ★ 색 = 1
   *   ```
   *   ★ 전에는 **글자를 먼저** 찍고 칸을 나중에 그려 글자가 칸에 **가려졌다.**
   *     좌표도 (293,178) 오른쪽 정렬에 색 0x11 로 임의였다
   *     (사용자 2026-08-25: 「소지금 표시 위치 및 색깔」).
   *   ★ 금액 자체는 리마스터 창구(`G2셸소지금`)를 쓴다 —
   *     ★★★★★ **2026-08-29** — 색인은 유닛 레코드 `+0x87` 의 **소속**이다.
   *       ☠ 처음에 이것을 「팀」이라 적었다가 바로잡았다 —
   *         `sce.js` §유닛 레코드에 **2026-08-16 로 이미 확정**돼 있었다.
   *       ```asm
   *       0x4E8F0  mov ah, [ebp+0x87]           ; ★ **소속**
   *       0x4E8F6  test ah,ah / je 0x4E8FC      ;   소속 0 이거나
   *       0x4E8FA  cmp ah, 0x63(99) / jne       ;   99 이면
   *       0x4E8FC  mov al, [0x8DF85] · mov [ebp+0x87], al
   *       ```
   *       곧 `[0x8DF85]` 는 **현재 시나리오 번호**이고, 소속이 0·99 일 때
   *       그 값으로 **덮어쓴다**. 99 는 `PACK 0x22C04` 가 새 캐릭터에 찍는
   *       「아직 소속이 정해지지 않음」 표시다.
   *       ⇒ `[0x8E36F + 소속*4]` 는 **소속별 소지금 표**다.
   *     ★ 표 자체는 이미지에서 **전부 0**(BSS)이라 정적으로는 값이 없다 —
   *       그래서 리마스터 창구(`G2셸소지금`)를 쓰는 것이 맞다. */
  조각(5, 220, 171);        /* 0x54A3A edx=0xAB · 0x54A3F eax=0xDC — 소지금 79×22 */
  var 돈 = null;
  try { 돈 = (typeof root.G2셸소지금 === 'function') ? root.G2셸소지금() : null; } catch (e2) { }
  /* ★ 서식은 `[0x78082] = "%-6ld"` — **금액만** 찍는다 (실측).
   *   「ELD」 글자는 칸 그림(프레임 5) 안에 있다. `"%3d ELD"` 는 `0x78088` 로 다른 자리다. */
  if (돈 != null) this.text(ctx, String(돈 | 0), 260, 179, 0x01);            /* 0x54A72 */

  /* ★★★★★ **2026-08-29 — 원본은 「넘칠 때만」이 아니라 「마우스가 그 띠에 있을 때」다.**
   *   `0x54E55`·`0x54EC2` 앞의 조건을 읽으니 **개수가 아니라 세로 좌표**를 본다:
   *   ```asm
   *   0x54E45  edx = [esp+4]                 ; 마우스 y
   *   0x54E49  cmp dx, 0x18(24) · jl 건너뜀
   *   0x54E4F  cmp dx, 0x4A(74) · jge 건너뜀 ; ★ **y 24~73** → 위 발톱
   *   0x54E55  edx = 0x18(24) · eax = 0x11E(286)
   *
   *   0x54EB6  cmp bx, 0x4D(77) · jl 건너뜀
   *   0x54EBC  cmp bx, 0x7F(127) · jge 건너뜀 ; ★ **y 77~126** → 아래 발톱
   *   0x54EC2  edx = 0x4D(77) · eax = 0x11E(286)
   *   ```
   *   ⇒ 두 발톱이 **각자 다른 띠**를 맡고, **마우스가 그 안에 있을 때만** 그린다.
   *
   *   ★★★★★ **2026-09-03 갈렸다 — 이 둘은 「눌린 발톱」 그림이다.**
   *
   *   > 사용자 지적: 「캐릭터 목록 우측 **발톱 장식이 클릭이 되어야해.
   *   >   클릭하면 색깔이 바뀌고** … 캐릭터가 많은 경우 저걸로 스크롤하는거야.」
   *
   *   `0x54E45` 는 **그리기 조건**이 아니라 **클릭 처리**였다 — 그 띠를 누르면
   *   `[0x8814C]`(▲)/`[0x88158]`(▼) 을 덧그리고, **그 다음에** 첫줄을 옮긴다
   *   (`0x54E74`). 못 옮겨도 그림은 이미 바뀐 뒤다.
   *   ⇒ **평상시 발톱 장식은 창틀 그림에 이미 들어 있다.** 여기서 상시로 그리면
   *     「늘 눌린 상태」로 보인다. ☠ `목록.length > 20` 조건은 근거가 없었다.
   *   ★ 머무는 시간 **32 틱**(`0x55126 0x1033B(eax=0x20)`) ≈ 182 ms. */
  var 눌 = battle.배치발톱눌림;
  /* ☠ `눌.때 | 0` 이었다 — Date.now()(1.7×10¹²)를 32비트로 잘라 차이가 늘 엉뚱해 눌린 발톱이 한 번도 안 그려졌다
   *   (2026-10-03 사장님 「발톱을 클릭했을때 원작은 노랗게 변하는 효과가 있는데 우리는 적용이 안되는 것 같아」) */
  if (눌 && (Date.now() - (+눌.때 || 0)) < 182.36) {          /* 32틱 × 5.6987ms */
    if ((눌.방향 | 0) === 1) 조각(1, 286, 24);   /* 0x54E5F [0x8814C] — 눌린 ▲ */
    else                    조각(2, 286, 77);   /* 0x54ECC [0x88158] — 눌린 ▼ */
  }

  /* 목록 격자 — 0x54670 · 한 줄 5칸 (0x54603 idiv 5) */

  /* ★ 발톱으로 스크롤한 만큼 건너뛴다 — `0x546A3` 루프는 `[edi]`(첫 인덱스)부터 돈다 */
  var 첫줄 = battle.배치첫줄 | 0;
  for (var k = 첫줄; k < 목록.length; k++) {
    var 줄 = ((k - 첫줄) / 5) | 0, 칸 = (k - 첫줄) % 5;
    var x = 152 + 칸 * 28, y = 34 + 줄 * 27;      /* 0x546A3 · 0x546B2 */
    if (x > 264 || y > 115) break;                 /* 0x546AB · 0x546BA */
    var u = 목록[k];
    if (!u) continue;
    /* ★★★ 항목 스프라이트 — 원본 `0x544B2`
     *     `[+0x56] == 0x80` → 프레임 **0x27(39) 고정** (배치된 캐릭터)
     *     그 밖             → `13 × (0xFF − [+0x56])`
     *   ☠ **2026-08-29 정정** — 「13 = 한 방향의 모션 수 `[추측]`」은 **틀렸다.**
     *     같은 파일 위쪽(§배치 목록)에서 이미 정정돼 있었다:
     *     `0x27` 은 프레임 번호가 아니라 **바이트 오프셋**이고, 표는
     *     `0xA0A80 + spr*0x34(52) + 13*프레임` — 곧 **한 칸이 13바이트**다.
     *     `0x27 = 13 × 3` 이므로 배치됨은 **프레임 3**이다.
     *     (같은 13바이트 레코드를 전투 쪽 `0xD66A8` 도 쓴다 — `ultimate.js` §잔상 큐.)
     *   ☐ 그 프레임 3 이 「왼쪽으로 돌아선 모습」인지는 아직 — 파일이 주는 값이라
     *     `.NC2` 헤더를 읽어야 한다. 지금은 **정지 프레임 0** 을 쓰고,
     *     **정지 프레임 0** 을 쓰고, 고른 항목만 원본 규칙으로 애니메이션한다. */
    var 그림 = 배치아이콘(u, !u.배치됨 && k === (battle.배치고른 | 0));
    if (그림 && 그림.canvas) {
      /* ★★★★★ **원본대로 앵커에 그리고 24×24 로 자른다** — `0x544B2` (2026-08-25)
       *
       *   ```asm
       *   0x544b9 push eax / 0x544ba push edx      ; [esp]=y · [esp+4]=x
       *   0x54518 [esp+8]  = y + 0x0C              ; ★ 아래 경계
       *   0x54525 ebp      = x + 0x0C              ; ★ 오른 경계
       *   0x54531 [esp+10] = y − 0x0B              ; ★ 위  경계
       *   0x5453c [esp+0c] = x − 0x0B              ; ★ 왼  경계
       *   0x54552 call 0x5EDDE(x−11, y−11, y+12, x+12)   ; ★ 클리핑 사각형
       *   0x5455a edx = y + [edi+5]                ;   프레임 앵커 y
       *   0x54568 eax = x + [edi+4]                ;   프레임 앵커 x
       *   0x54573 call 0x5F3FD(eax=x', edx=y', ebx=그림)
       *   ```
       *   ⇒ 칸은 **(x−11,y−11)~(x+12,y+12) = 24×24** 이고, 그림은 **앵커 그대로**
       *     찍은 뒤 그 사각형 밖이 잘린다. 히트 상자(`0x546D3`)가 (141,23) 인 것도
       *     첫 칸 (152,34) − 11 이라서다.
       *   ★ 전에는 「칸 28×27 안에 가운데 아래 정렬」이라는 **내가 만든 규칙**으로
       *     그려서 캐릭터 크기·자리가 원본과 달랐다
       *     (사용자 2026-08-25: 「캐릭터 크기, 좌표도 다르고」). */
      var cw = 그림.w || 그림.canvas.width, ch = 그림.h || 그림.canvas.height;
      var dx = x + (그림.ax | 0), dy = y + (그림.ay | 0);
      if (root.__패드커서숨김 && battle.__패드목록 && k === (battle.배치고른 | 0)) {   /* [리마스터] 패드가 가리킨 캐릭터 — 그림 모양 금빛 테두리(칸 밖으로 3px) · 그림 아래에 깐다 (사장님 11-07 「네모상자말고 캐릭터 테두리로 해」) */
        ctx.save(); ctx.beginPath(); ctx.rect(x - 14, y - 14, 30, 30); ctx.clip(); 패드금빛(ctx, 그림.canvas, dx, dy, cw, ch); ctx.restore();
      }
      ctx.save();
      ctx.beginPath(); ctx.rect(x - 11, y - 11, 24, 24); ctx.clip();   /* 0x54552 */
      /* ★★★ **이미 배치된 캐릭터는 음영으로** (2026-08-24)
       *   사용자 사양: 「캐릭터가 배치되면 캐릭터 목록의 스프라이트가 **음영 처리**가
       *   되고 **옆으로 좌측으로 돌아선 모습**으로 표시돼.」
       *   원본은 `0x544B2` 가 `[+0x56]==0x80` 일 때 **프레임 0x27(39)** 로 바꾼다 —
       *   ★★★★★ **2026-08-29 — 프레임 39 를 화면에서 확인했다. 좌향이 맞다.**
       *     ① 원본 프레임 규칙 `0x13175 frame = (방향 × 11 + 모션)` 로 풀면
       *        `39 ÷ 11 = 3 나머지 6` → **방향 3 · 모션 6** 이다.
       *        방향 번호는 **0 남 · 1 서 · 2 북 · 3 동**(원본 `0x16440`~`0x164A8`).
       *     ② 그런데 **그림을 실제로 읽어** 좌우 픽셀을 세니(2-4 전투 · `S_IYOLIN.NC2`):
       *        ```
       *        방향0 남        왼 191 / 오 207   가운데
       *        방향1 서        왼 248 / 오 170   **왼쪽**
       *        방향2 북        왼 215 / 오 219   가운데
       *        방향3 동 모션0  왼 181 / 오 231   오른쪽
       *        **프레임 39**   왼 328 / 오 159   ← **왼쪽으로 크게 치우친다**
       *        ```
       *     ⇒ 방향 번호는 「동」이지만 **그려진 그림은 왼쪽을 향한다.**
       *       모션 6 이 그 방향 안에서 **돌아선 자세**이기 때문이다.
       *       사용자 사양 「**옆으로 좌측으로 돌아선 모습**」과 **일치한다.**
       *     ★ 방향 번호만 보고 「동쪽이니 사양과 다르다」고 판정했으면 틀렸을 것이다 —
       *       **그림을 읽어서** 갈렸다.
       *   ★★★★★ **2026-08-29 — 음영 방식은 확정됐다.** 알파가 아니다.
       *     `0x5ECC7(eax=1)` → `[0x755E2] = 0x5EE2B` = **팔레트 리맵**이다 —
       *     단색 덮기도 반투명도 아니고, **픽셀마다 표로 색 번호를 바꿔** 그린다
       *     (`0x5EE21`/`0x5EE43` 에서 `lea ebx,[0x128550]` 로 표를 집는다).
       *
       *   ★ 표가 어떻게 서는지도 읽었다 (`0x61025`~`0x61064`)
       *     ```
       *     0x61027  cwde · shl eax,8 · call 0x61B36   ; ★ **벌수 × 256** 바이트 할당
       *     0x61035  mov [0x128554], eax               ;   표 전체의 시작
       *     0x6103A  mov [0x128550], eax               ;   지금 쓰는 벌 = 0번
       *     0x6104B  mov [0x12855C], ax                ; ★ **벌 번호**를 바꾸면
       *     0x61055  eax = [0x128554] ; edx = 벌<<8
       *     0x6105F  mov [0x128550], eax + edx         ;   지금 벌 포인터가 옮겨간다
       *     ```
       *     ⇒ 리맵 표는 **256색 한 벌짜리가 여러 벌**이고, 벌을 갈아 끼워
       *       어둡기 단계를 바꾼다. 곧 음영은 **여러 단계**다.
       *
       *   ☐ **표의 내용은 정적으로 못 본다 — 검산했다** (2026-08-29)
       *     ★ 오늘 여러 주소가 「fixup 전 값」이라 헤맸으므로 이것도 확인했다:
       *       적용본에서 `0x61035` 의 바이트는 `a3 54 85 12 00`
       *       = `mov [0x00128554], eax` 로 **주소가 그대로다**.
       *       곧 이 자리는 fixup 전/후가 같고, 파일(`0x119640`)보다 뒤라
       *       **진짜 BSS** 가 맞다 — 내용은 위 할당 뒤 실행 중에 채워진다.
       *     ⇒ 표를 뜨려면 **js-dos 로 돌려 그 메모리를 읽어야** 한다(§A● 6번).
       *   ☠ 그때까지 아래 `globalAlpha = 0.45` 는 **원본과 다른 방식**으로 남는다.
       *     짐작으로 색표를 지어내지 않는다. */
      var 옛알파 = ctx.globalAlpha;
      if (u.배치됨) ctx.globalAlpha = 옛알파 * 0.45;
      ctx.drawImage(그림.canvas, 0, 0, 그림.canvas.width, 그림.canvas.height,
                    dx, dy, cw, ch);
      ctx.globalAlpha = 옛알파;
      ctx.restore();                                  /* 클리핑 해제 */
    }
  }
  return this;
};

/** 현재 대사 문구와 화자 정보를 대사창에 그린다. */
Hud.prototype.draw문구 = function (ctx) {
  var c = this._문구현재;
  if (!c || !/\S/.test(c.text)) return this;      /* 빈 줄은 시간만 쓴다 */
  /* ★★★★★ **`0x0A` 는 줄바꿈이다** (2026-08-24)
   *   사용자 지적: 「대화창 없는 문구 **줄바꿈이 적용되지 않고 이상한 기호**로 되어있어.」
   *
   *   원본 `0x5DD5B` (`나머지대역_분석.md §4-2`):
   *     0x5DF52  cmp al, 0x0A        ; ★ 줄바꿈 문자
   *     0x5DF56  mov eax, [esp]      ;   x = 시작 x 로 되돌림
   *     0x5DF66  mov ax, [0x755C6]   ; ★ 행간
   *     0x5DF6C  add ebx, eax        ;   y += 행간
   *   한글 x 전진은 0x5DF40 `mov ax,[0x755C4]` (ASCII 는 그 절반).
   *
   *   EXE 안의 실제 값 (fixup 이미지 직독):
   *     [0x755C4] 자간 16 · [0x755C6] 행간 16 · [0x755C8] 자동줄바꿈 1
   *   ★ 이 셋을 **세팅하는 호출부가 EXE 에 하나도 없다** — 초기값 그대로다
   *     (세터 0x5DD46/0x5DD54 는 있으나 call 이 0건).
   *
   *   SCE 원문 (`SCENARIO/1-1.SCE`):
   *     73 28 00 22 00  0a 0a 3c 3c 20 …조합형한글… 20 3e 3e 0a 00
   *     = op 0x73 + 「LF LF << … >> LF」  — **줄바꿈이 문자열 안에 있다.**
   *   전에는 통째로 한 줄에 그려 0x0A 가 **글자로 찍혔다**. */
  var 줄들 = String(c.text).split(String.fromCharCode(10));
  for (var i = 0; i < 줄들.length; i++) {
    if (!줄들[i]) continue;                       /* 빈 줄도 y 는 내려간다 */
    this.text2(ctx, 줄들[i], 문구.x, 문구.y + i * 문구.행간);
  }
  return this;
};

/** 현재 전투의 승리·패배 조건을 목표 창에 그린다. */
Hud.prototype.drawObjective = function (ctx) {
  var o = this._obj;
  if (!o) return this;
  var O = OBJECTIVE;
  this.dimScreen(ctx);                                            // 0x4941C
  this.text2(ctx, O.title, O.titleAt[0], O.titleAt[1]);
  var lines = String(o.text).split('\n');
  for (var i = 0; i < lines.length; i++)
    if (lines[i]) this.text2(ctx, lines[i], O.bodyAt[0], O.bodyAt[1] + i * O.lineH);
  return this;
};

/** 왼쪽 맞춤 조합형 + 외곽선. `koreanOutlined` 는 가운데 정렬이라 감싼다. */
Hud.prototype.text2 = function (ctx, s, x, y) {
  var w = 0;
  for (var i = 0; i < s.length; i++) {
    var c = s.charCodeAt(i);
    w += (c >= 0xAC00 && c <= 0xD7A3) ? 16 : 8;                   // 0x480FE  바이트당 8px
  }
  return this.koreanOutlined(ctx, s, x + w / 2, y, OBJECTIVE.글자, OBJECTIVE.테두리, 16);
};

/* ── (가) 이동 · 공격 범위 하이라이트 ────────────────────────────────
 * 0x1547F 는 타일 24×16 을 통째로 LUT(뱅크 1)로 리맵합니다. HUD 캔버스가 아니라
 * 맵을 그리는 쪽이 해야 하므로, 여기서는 재료만 내줍니다.
 *   표      : ui.json 의 lut.뱅크1.표  (팔레트 번호 → 팔레트 번호)
 *   근사값  : 흰색 쪽 30 % 블렌드 = rgba(255,255,255,0.3) 를 타일 위에 덮기
 * 이동 범위와 공격 범위는 **원본에서도 같은 색**입니다 (0x1CC09 가 같은 배열을 씁니다).
 * ------------------------------------------------------------------------ */
Hud.prototype.moveHighlight = function () {
  var lut = this.assets.json && this.assets.json.lut;
  return {
    lut: (lut && lut['뱅크1'] && lut['뱅크1']['표']) || null,
    target: 1, percent: 30,
    rgba: 'rgba(255,255,255,0.3)',
    note: '0x1547F — 이동/공격 범위 둘 다 같은 표시입니다 (색으로 구분하지 않습니다)'
  };
};

/* ═══════════════════════════════════════════════ 5. 내보내기 */

var THE = new Hud();

var G2Hud = {
  탈것발톱: 탈것발톱,                       /* [리마스터] 탈것 쪽 발톱 자리 — battle_main 클릭 */
  VERSION: '1.0 (COMBATII.EXE · 전투UI_사양.md 대조)',
  Hud: Hud, Calc: Calc, Assets: Assets,

  /* 사양서에 적힌 것 */
  init:        function (t, b, o) { return THE.init(t, b, o); },
  draw:        function (b, c) { return THE.draw(b, c); },
  setPhase:    function (k) { return THE.setPhase(k); },
  setMessage:  function (s, u) { return THE.setMessage(s, u); },
  showStatus:  function (u) { return THE.showStatus(u); },
  hideStatus:  function () { return THE.hideStatus(); },
  toggleStatusPage: function () { return THE.toggleStatusPage(); },
  showAiBar:   function (u) { THE.aiUnit = u || null; return THE; },
  hideAiBar:   function () { THE.aiUnit = null; return THE; },
  moreHit:     function (x, y) { return THE.moreHit(x, y); },
  /* 장비 칸 — 0x48E90 끌어놓기 */
  itemHit:     function (x, y) { return THE.itemHit(x, y); },
  dragItem:    function (v) { return THE.dragItem(v); },
  dragAt:      function (x, y) { return THE.dragAt(x, y); },
  itemName:    function (v) { return THE.itemName(v); },
  equipWarn:   function (v) { return THE.equipWarn(v); },
  notice:      function (v) { return THE.notice(v); },
  소멸알림:    function (code) { return THE.소멸알림(code); },   /* 멜트 아이템 0x2C1A1~0x2C271 */
  loading:     function (v) { return THE.loading(v); },
  WARN_MS:     WARN_MS,
  setLoadingImage: function (cv) { return THE.setLoadingImage(cv); },
  setNativeKorean: function (font) { return THE.setNativeKorean(font); },
  loadDosFont: function (base) { return THE.loadDosFont(base); },
  setMarginsEnabled: function (v) { if (THE.opts) THE.opts.margins = !!v; return THE; },
  statusPage:  function () { return THE.statusPage | 0; },
  /* ESC 옵션 메뉴 (0x4E0EE) · 시나리오 조건 (0x49411) */
  option:      function (v) { return THE.option(v); },
  optionHit:   function (x, y) { return THE.optionHit(x, y); },
  optionAt:    function (i) { return optionAt(i); },   /* [리마스터] 패드 — 옵션 아이콘 가운데 (pad_input.js 전투옵션패드) */
  turnHit:     function (x, y) { return THE.turnHit(x, y); },
  objective:   function (t) { return THE.objective(t); },
  /* ★★★★★ **화면 문구** — `op 0x73`(`0x52B4F`) + 표시 루틴 `0x5046C`
   *   ★ 프로토타입에만 붙이면 **밖에서 안 보인다** — 실측에서 `문구현재` 가
   *     「창구없음」으로 나왔고, 그래서 화면에 문구가 하나도 안 떴다.
   *     (사용자: 「화면에 문구도 안나오고」) */
  문구넣기:    function (줄, 길이) { return THE.문구넣기(줄, 길이); },
  문구틱:      function () { return THE.문구틱(); },
  문구현재:    function () { return THE.문구현재(); },
  문구상태:    function () { return THE.문구상태(); },
  문구끝났나:  function () { return THE.문구끝났나(); },
  draw문구:    function (ctx) { return THE.draw문구(ctx); },
  OPTION:      OPTION, OBJECTIVE: OBJECTIVE, OBJECTIVE_MS: OBJECTIVE_MS, MORE_MS: MORE_MS,
  optionIcons: optionIcons, optionFrame: optionFrame, optionAt: optionAt,
  moraleBar:   function (c, a, e) { return THE.moraleBar(c, a, e); },
  turnGauge:   function (c, t, p) { return THE.turnGauge(c, t, p); },
  orb:         function (c, o) { return THE.orb(c, o); },

  /* 부가 */
  /** 스케일러가 바뀌었을 때 — 캔버스 백킹스토어와 구워둔 그림 캐시를 새 배율로 다시 만든다. */
  rebuildForScaler: function () {
    if (THE.canvas && root.G2Scaler) {
      /* ☠☠★ **이름을 한글로 바꿀 때 이 한 줄을 빼먹었다** — 2026-09-17 실측
       *   `Hud.prototype._prepare` 를 `_표시준비` 로 고치면서 여기만 예전 이름으로
       *   남았다. 이 줄은 **스케일러를 바꿀 때만** 돌아서 여태 안 드러나고,
       *   `TypeError: THE._prepare is not a function` 이 `전환하기`(async)의 조용한
       *   거부로 끝나 **막을 걷는 코드까지 못 가게** 했다 — 그것이 사장님이 보신
       *   「스츀러 적용시 화면이 검게 되고 아무것도 안 나고 멈춰」의 정체다. */
      THE._표시준비();       /* ★ N-13 — 지금 논리 폭(logicalW)으로 다시 잡는다 */
      THE.fit();
    }
    var nat = THE.assets && THE.assets.native;
    if (nat) for (var f in nat) if (nat.hasOwnProperty(f)) nat[f].canvas = {};
    if (THE.assets) THE.assets.tints = {};   /* Z-44 — 글자 시트도 새 필터로 다시 굽는다 */
    return THE;
  },
  fit:         function () { return THE.fit(); },
  fitViewport: function (w, h) { return THE.fitViewport(w, h); },
  viewportState: function () { return THE.viewportState(); },
  논리캔버스놓기: function (canvas, viewport) { return THE.논리캔버스놓기(canvas, viewport); },
  논리캔버스보이기: function (canvas) { return THE.논리캔버스보이기(canvas); },
  논리캔버스비우고숨기기: function (canvas, ctx, w, h) {
    return THE.논리캔버스비우고숨기기(canvas, ctx, w, h);
  },
  링화면상태반영: function (ringCanvas, ringShade, open, shaded) {
    return THE.링화면상태반영(ringCanvas, ringShade, open, shaded);
  },
  전투무대보이나: function (stage) { return THE.전투무대보이나(stage); },
  전투무대정지표시: function (stage, 멈춤) { return THE.전투무대정지표시(stage, 멈춤); },
  대사창떠있나: function (dialogue) { return THE.대사창떠있나(dialogue); },
  전투효과캔버스보이기: function (canvas) { return THE.전투효과캔버스보이기(canvas); },
  속성중복안내초기화: function (e, 리마스터) { return THE.속성중복안내초기화(e, 리마스터); },
  속성중복안내열기: function (문구, 리마스터) { return THE.속성중복안내열기(문구, 리마스터); },
  속성중복안내닫기: function (e) { return THE.속성중복안내닫기(e); },
  전환페이드덮개초기화: function (e) { return THE.전환페이드덮개초기화(e); },
  전환페이드덮개열기: function () { return THE.전환페이드덮개열기(); },
  전환페이드색반영: function (e, 색) { return THE.전환페이드색반영(e, 색); },
  전환페이드덮개끄기: function () { return THE.전환페이드덮개끄기(); },
  스케일러전환요소초기화: function (e, 종류) { return THE.스케일러전환요소초기화(e, 종류); },
  스케일러전환막열기: function (stage, 새로고침) { return THE.스케일러전환막열기(stage, 새로고침); },
  스케일러전환그림반영: function (그림, url) { return THE.스케일러전환그림반영(그림, url); },
  스케일러전환막보이기: function (막) { return THE.스케일러전환막보이기(막); },
  스케일러전환막숨기기: function (막) { return THE.스케일러전환막숨기기(막); },
  스케일러전환오류보이기: function (막, 말) { return THE.스케일러전환오류보이기(막, 말); },
  스케일러전환오류숨기기: function (막) { return THE.스케일러전환오류숨기기(막); },
  스케일러전환막보이나: function (막) { return THE.스케일러전환막보이나(막); },
  hudCanvas:   function () { return THE.hudCanvas(); },
  update:      function (dt) { return THE.update(dt); },
  toLogical:   function (x, y) { return THE.toLogical(x, y); },
  /* [리마스터 편의] 배치 화면 창 단추 자리 — 그리기(draw배치)와 누르기(battle_main 배치입력)가 같은 표를 쓴다 */
  배치창단추: function () { return 배치창단추(); },
  setCursor:  function (x, y) { THE.cursor = (x == null ? null : { x: x, y: y }); return THE; },
  setMoveRangeShown: function (v) { THE.moveRangeShown = !!v; return THE; },
  setMagicMenu: function (v) { THE.magicMenuOpen = !!v; return THE; },
  /** 대상 선택 중인가 — 참이면 TP 구체·Phase 를 감춘다(범위 표시를 안 가리게). */
  setTargetSelect: function (v) { THE.targetSelect = !!v; return THE; },
  /** 이벤트 연출이 도는 중인가 — 참이면 TP 구체·Phase 를 감춘다. */
  setEventPlaying: function (v) { THE.eventPlaying = !!v; return THE; },
  setAp:       function (v) { THE.ap = v | 0; THE.apTarget = null; return THE; },
  setOrbMode:  function (m) { return THE.setOrbMode(m); },
  selectUnit:  function (u) { return THE.selectUnit(u); },
  drainAp:     function (v) { return THE.drainAp(v); },
  statusVisible: function () { return THE.statusVisible(); },
  statusUnit:  function () { return THE.status; },
  infoBar:     function (c, o) { return THE.infoBar(c, o); },
  drawStatus:  function (c, u, T) { return THE.drawStatus(c, u, T); },
  statLayers:  function (c, u, x, y) { return THE.statLayers(c, u, x, y); },
  equipReport: function (u, T) { return THE.equipReport(u, T); },
  clearMargins: function (c) { return THE.clearMargins(c); },
  phaseIcon:   function (c, k) { return THE.phaseIcon(c, k); },
  text:        function (c, s, x, y, col, sp) { return THE.text(c, s, x, y, col, sp); },
  textRight:   function (c, s, xr, y, col, sp) { return THE.textRight(c, s, xr, y, col, sp); },
  textOutlined: function (c, s, x, y, col, sp, oc) { return THE.textOutlined(c, s, x, y, col, sp, oc); },
  newhanLeft:  function (c, s, x, y, col, sh) { return THE.newhanLeft(c, s, x, y, col, sh); },
  newhanWidth: function (s) { return THE.newhanWidth(s); },
  textShadow6: function (c, s, x, y, col, sp) { return THE.textShadow6(c, s, x, y, col, sp); },
  setKoreanFont: function (fn) { return THE.setKoreanFont(fn); },
  moveHighlight: function () { return THE.moveHighlight(); },
  color:       function (n) { return THE.assets.color(n); },
  blit:        function (c, f, n, x, y, a) { return THE.blit(c, f, n, x, y, a); },
  setBasePalette: function (p) { THE.assets.기본팔레트 = p || null; return THE; },
  setPalette:  function (p) { return THE.assets.setPalette(p); },
  applyWeatherPalette: function () { return THE.assets.날씨적용(); },
  palette:     function () { return THE.assets.pal768 || null; },
  setTextchr:  function (g) { return THE.assets.setTextchr(g); },
  setNative:   function (f, frames, p) { return THE.assets.setNative(f, frames, p); },
  hasNative:   function (f) { return !!(THE.assets.native && THE.assets.native[String(f || '').toUpperCase()]); },
  nativeOf:    function (f) { return (THE.assets.native && THE.assets.native[String(f || '').toUpperCase()]) || null; },   /* 215 로딩 화면 팔레트 되돌리기 */
  basePalette: function () { return THE.assets.기본팔레트 || null; },

  /* 순수 계산 — Node 로 검증할 수 있습니다 */
  moraleAlly: moraleAlly, moraleEnemy: moraleEnemy, gaugeCount: gaugeCount,
  clock: clock, orbAnchor: orbAnchor, orbLamp: orbLamp, infoBarY: infoBarY,
  glyphIndex: glyphIndex, textAdvance: textAdvance, shadowColor: shadowColor,
  외침색: 외침색,          /* 0x484F9 — 프레임별 { 외곽선, 본문 } */
  canEquip: canEquip, slotCategory: slotCategory,
  isAllyUnit: isAllyUnit, statusKind: statusKind,

  /* 상수 */
  VIEW: VIEW, BUFFER_W: BUFFER_W, VIEWPORT: VIEWPORT, MARGIN: MARGIN,
  MORALE: MORALE, TURN: TURN, ORB: ORB, PHASE: PHASE, INFOBAR: INFOBAR,
  GLYPH: GLYPH, MENUSTAT: MENUSTAT, STAT_CELLS: STAT_CELLS,
  STATUS_LAYOUT: STATUS_LAYOUT, SLOT: SLOT, GEAR_SLOT: GEAR_SLOT,
  EQUIP_MSG: EQUIP_MSG, JOBWEAPON_TO_ITEMKIND: JOBWEAPON_TO_ITEMKIND,
  TICK_HZ: TICK_HZ
};

root.G2Hud = G2Hud;
if (typeof module !== 'undefined' && module.exports) module.exports = G2Hud;

})(typeof globalThis !== 'undefined' ? globalThis : this);
