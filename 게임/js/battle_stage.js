/**
 * ★★★★★ **전투 무대 DOM** — 셸과 전투 실행기가 **같은 마크업**을 쓴다 (2026-08-23)
 *
 *   `전투통합_계획.md` §2-b-②(나):
 *   > 「무대 DOM 생성도 **공유 창구**여야 한다 — 셸에 마크업을 **복사하면 한 소스가
 *   >  깨진다.** 부팅 모듈이 「주어진 호스트 안에 무대를 만들고 해제」한다」
 *
 *   ★★★ **지금은 `전투.html` 이 자기 마크업을 그대로 갖고 있다.**
 *     이 모듈은 그것을 **그대로 옮겨 적은 것**이고, 둘이 갈라지지 않도록
 *     `04_도구/전체실행기/무대마크업_일치.js` 가 **전수 대조**한다.
 *     다음 단계에서 `전투.html` 도 이 모듈을 쓰게 바꾸면 한 소스가 된다.
 *
 *   ★ `display:none` 만으로는 부족하다 — 퇴장에서 **DOM 을 실제로 걷어낸다.**
 *     (RAF·타이머 중지는 `battle_boot.끝내기()` 가 맡는다)
 */
(function (root) {
'use strict';

/* ── 무대 본체 — `전투.html` 133~141 행 ─────────────────────────────── */
var 무대앞 = [
    "  <div id=\"view\"></div>",
    "  <canvas id=\"fx\" width=\"320\" height=\"200\"></canvas>",
    "  <div id=\"ringShade\"></div>",
    "  <canvas id=\"frameDeco\" width=\"320\" height=\"200\"></canvas>",
    "  <div id=\"hud\"></div>",
    "  <canvas id=\"ring\" width=\"320\" height=\"200\"></canvas>",
    "  <!-- 마법 이름 외치기 (원본 0x28889) — 시전자 머리 위 -->",
    "  <canvas id=\"shout\" width=\"320\" height=\"200\"></canvas>"
  ].join("\n");

/* ── 무대 꼬리 — `전투.html` 221~226 행 ─────────────────────────────── */
var 무대뒤 = [
    "  <div id=\"info\"><div class=\"devhdr\" data-fold=\"infoBody\">정보<span class=\"foldbtn\">▲</span></div><div id=\"infoBody\"></div></div>",
    "  <div id=\"err\"></div>",
    "  <!-- 대사창 어둡게 — 원본 팔레트 리맵(0x5ECC7 al=1 → 0x5EE2B, 단계 0 = 밝기 40%).",
    "       알파 합성이 아니라 **곱하기**라야 같은 결과가 나온다(겹치면 0.4×0.4 = 0.16). -->",
    "  <canvas id=\"dlgshade\" width=\"320\" height=\"200\"></canvas>",
    "  <canvas id=\"dlgcv\" width=\"320\" height=\"200\"></canvas>",
    "  <!-- 아이템 칸이 둘 다 찼을 때 고르는 창 (원본 0x1888D) —",
    "       원본은 자기 입력 루프를 도는 모달이다(0x18A24). 대사창보다 위에 둔다. -->",
    "  <canvas id=\"slotshade\" width=\"320\" height=\"200\"></canvas>",
    "  <canvas id=\"slotcv\" width=\"320\" height=\"200\"></canvas>"
  ].join("\n");

/* ── 개발 패널 — `전투.html` 142~220 행. **셸에서는 기본으로 안 만든다** ── */
var 개발패널 = [
    "  <div id=\"panel\">",
    "    <div class=\"devhdr\" data-fold=\"panelBody\">개발<span class=\"foldbtn\">▲</span><button type=\"button\" id=\"panelPop\" title=\"개발창을 브라우저 밖 별도 창으로 뺍니다(다시 누르면 되돌립니다)\">↗</button></div>",
    "    <div id=\"panelBody\">",
    "    <!-- ★ 세 영역으로 나눠 각각 접는다 (2026-08-17 · 사용자 지정)",
    "         「개발창 세개 영역 각각 접을 수 있게 해줘. 시나리오, 화면, 리마스터 영역으로」 -->",
    /* ☒ 시나리오 고르기(#sceSel · #sceInfo) 칸은 뺐다 (2026-11-07 사장님 「전투이동과 시나리오 선택 두가지가 달라? 다른게 없고
     *   위에 저렇게 별도로 배치할거면 밑에 시나리오 선택부분은 없어야할 것 같아」) — 셸 개발도구 «전투 이동»(게임.html #셸전투고르개)이
     *   전투 안에서는 같은 창구(G2셸시나리오바꾸기)를 쓰고 전투 밖에서도 된다. battle_main 의 처리기는 #sceSel 이 없으면 그냥 돌아간다. */
    /* [원본없음] — 아래는 **개발 패널**이다. 기울기·회전·배율·원근·시야는
     * 리마스터에서 더한 카메라를 손으로 만져 보는 슬라이더라 원본에 대응물이 없다.
     * 슬라이더의 최소·최대(88·180·120·1200·34 등)는 **손잡이 범위**지 원본 값이 아니다. */
    "    <div class=\"devhdr sub\" data-fold=\"devView\">화면<span class=\"foldbtn\">▲</span></div>",
    "    <div id=\"devView\">",
    "    <label>기울기 <b id=\"vTilt\">0°</b><input type=\"range\" id=\"tilt\" min=\"0\" max=\"88\" value=\"0\"></label>",
    "    <label>회전 <b id=\"vRot\">0°</b><input type=\"range\" id=\"rot\" min=\"-180\" max=\"180\" value=\"0\"></label>",
    "    <label title=\"기울이거나 돌렸을 때 캐릭터·이펙트·방패를 원작 그리는 차례로 겹치게 합니다(render.js _평면대열적용). 끄면 예전처럼 3D 거리로 앞뒤를 정합니다.\">기울기 평면 대열",
    "      <input type=\"checkbox\" id=\"optFlatOrder\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label>배율 <b id=\"vZoom\">1.0×</b><input type=\"range\" id=\"zoom\" min=\"10\" max=\"120\" value=\"30\"></label>",
    "    <label>원근 <b id=\"vDist\">0</b><input type=\"range\" id=\"dist\" min=\"-400\" max=\"1200\" value=\"0\"></label>",
    "    <label>시야 <b id=\"vFov\">34</b><input type=\"range\" id=\"fov\" min=\"12\" max=\"100\" value=\"34\"></label>",
    "    <label>프리셋 <span style=\"float:right\"><button type=\"button\" id=\"presetDefault\">기본값</button> <button type=\"button\" id=\"presetView\">눕힘시점</button> <button type=\"button\" id=\"preset3D\" title=\"3D · 높이 100 · 세로 보정 100 · 배율 1.5 · 원근 400 · 시야 100 · 기울기 40\">3D기본화면</button> <button type=\"button\" id=\"preset3DWide\" title=\"3D기본화면과 같고 배율만 1\">3D넓은화면</button></span></label>",
    "    <label>센터링 <select id=\"cameraFollow\"><option value=\"instant\">즉시 이동</option><option value=\"smooth\" selected>부드러운 스크롤</option></select></label>",
    "    <label title=\"캐릭터 발밑 그림자(원본 SHADOW.SYB). 원본은 체크무늬 1픽셀 격자라 사이로 바닥이 비칩니다 — 반투명이 아닙니다. 끄면 안 그립니다.\">발밑 그림자 <input type=\"checkbox\" id=\"optShadow\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label>스토리 프레임 <input type=\"checkbox\" id=\"frameDecoToggle\" style=\"float:right;margin-top:5px\"></label>",
    "    <!-- 픽셀 스케일러 — 리마스터 전용(원본 재현 아님). 목록은 js/scaler.js 가 채웁니다. -->",
    /* [리마스터 편의] 게임 배속 1·1.5·2 (2026-10-07 · opt.js 배속 · battle_main pumpFrames) */
    "    <label title=\"전투·월드·마을의 시간을 같은 비율로 빠르게 흘립니다. 차례와 흐름은 그대로입니다.\">게임 배속 <select id=\"speedSel\"></select></label>",
    /* [리마스터 편의] 경험치 배율 1·2·4·8·12·16·20 (2026-10-07 사장님 「개발툴에 슬라이더로 경험치 배율도 설정해줘. 기본 2 4 8 12 16 20배로」 · combat.js 경험치적용) */
    "    <label title=\"처치·마법으로 얻는 레벨 경험치에 곱합니다. 1배가 원작입니다. 배율이 크면 한 번에 여러 레벨이 오르고, 오를 때마다 원작 성장이 그대로 적용됩니다.\">경험치 배율 <b id=\"vExpMul\">1×</b><input type=\"range\" id=\"expMul\" min=\"0\" max=\"19\" step=\"1\" value=\"0\"></label>",
    /* [리마스터 편의] 적 능력치 배율 0.5~3 (사장님 10-28 「적 능력치 슬라이더 만들어줘.」 · 「HP MP str int dex cha만 해당되고 나머지 능력치는 스탯과 직업에 의해 계산된 값으로 적용되어야해」) · opt.js 적능력배율 · state.js derive/적HP배 */
    "    <label title=\"적의 HP·MP·STR·INT·DEX·CHA 에 곱합니다. 공격력·TP·회피·턴은 그 능력치로 원작 식대로 다시 계산됩니다(무기 공격력·방어력·MR 은 그대로). 1배가 원작입니다. 전투 중에 옮기면 바로 바뀌고 남은 HP 비율은 그대로입니다.\">적 능력치 <b id=\"vEnemyMul\">1×</b><input type=\"range\" id=\"enemyMul\" min=\"0\" max=\"7\" step=\"1\" value=\"2\"></label>",
    "    <label>스케일러 <select id=\"scalerSel\"></select></label>",
    /* ★ [원본없음] 좁힌 xBRZ 손잡이 — 2026-09-17 사장님 지시
     *   「섞는 값을 개발토글에서 입력해서 적용되게… 최적값을 찾아보고 싶어」
     *   ☐ «좁힘» 계열(xbrz2n·3n·4n)을 골랐을 때만 효과가 있다. */
    "    <label title=\"xBRZ(좁힘) 전용 · 2·3·4배에 모두 먹습니다. ★ 0 = 기본 xBRZ 와 똑같은 그림입니다. 내릴수록 칠하는 칸이 줄어 색이 덜 번집니다(-1 = 바로 인접한 칸까지). 배율마다 거리로 환산됩니다 — 4배 -1 은 r2, 3배 -1 은 r1\">└ 좁힘 <b id=\"vNarrowR\">-1</b><input type=\"range\" id=\"narrowR\" min=\"-3\" max=\"0\" step=\"1\" value=\"-1\"></label>",
    "    <label title=\"xBRZ(좁힘) 전용 · 2·3·4배에 모두 먹습니다. ★ 0 = 기본 xBRZ 의 섞기 비율입니다. 내리면 덜 섞고(-100 = 아예 안 섞음) 올리면 더 세게 덮습니다(+100). ☐ 0 과 -100 사이의 중간(-50 언저리)이 오히려 가장 흐려 보입니다 — 두 색의 한가운데라서 그렇습니다. 눈으로 고르세요\">└ 섞기 <b id=\"vNarrowS\">0</b><input type=\"range\" id=\"narrowS\" min=\"-100\" max=\"100\" step=\"5\" value=\"0\"></label>",
    "    <!-- 표시 보간 — 원본 논리(19.5fps 이산 이동)는 그대로 두고 화면만 부드럽게.",
    "         녹화본과 프레임 대조할 때는 끕니다. -->",
    "    <label>부드러운 표시 <input type=\"checkbox\" id=\"lerpToggle\" checked style=\"float:right;margin-top:5px\"></label>",
    "    </div>",
    "",
    /* ★ [원본없음] **마우스 좌표 표시** (2026-09-13 · 사장님 지시)
     *   「마우스 커서 기준으로 좌표를 표시… 개발 도구에서 토글로 키고 끌 수 있어야 하고,
     *    우리가 사용하는 좌표계의 모든 좌표를 함께 표시」
     *   값은 `js/devcoord.js` 가 채운다. 화면 겹치기는 **기본 꺼짐** —
     *   원본과 픽셀로 견줄 때 개발 도구가 화면에 찍히면 안 된다(2026-09-05 지정). */
    "    <div class=\"devhdr sub\" data-fold=\"devCoord\">좌표<span class=\"foldbtn\">▲</span></div>",
    "    <div id=\"devCoord\">",
    "    <label title=\"마우스 커서가 놓인 자리를 우리가 쓰는 모든 좌표계로 함께 보여줍니다(칸·맵픽셀·마법FX·논리 320×200·HUD·#fx·3D). 게임 동작은 바뀌지 않습니다.\">마우스 좌표 표시",
    "      <input type=\"checkbox\" id=\"coordOn\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"같은 내용을 게임 화면 안 커서 옆에도 띄웁니다. 원본과 화면을 겹쳐 볼 때는 꺼 두세요 — 캡처에 찍힙니다.\"",
    "           style=\"padding-left:14px;opacity:.85\">└ 화면에도(커서 옆)",
    "      <input type=\"checkbox\" id=\"coordFollow\" style=\"float:right;margin-top:5px\"></label>",
    "    <div id=\"coordOut\">꺼짐</div>",
    "    </div>",
    "",
    "    <div class=\"devhdr sub\" data-fold=\"devRemaster\">리마스터<span class=\"foldbtn\">▲</span></div>",
    "    <div id=\"devRemaster\">",
    "    <!-- ★ [리마스터 I-08] 마법 이름 직접 클릭 — 링에서 마법을 고르면 원본이 화면 상단에",
    "         원소별 주문 목록을 띄운다(`ring.js _drawMagicListBody`). 그 **이름을 직접 누르면**",
    "         바로 시전한다. 원작은 룬워드 3단 조합이고, 이건 **조작만** 바꾼 「이지」 모드다",
    "         — 고를 수 있는 집합·MP·TP·판정은 `magicGate` 로 클래식과 같은 창구를 탄다.",
    "         끄면 원작대로 룬워드 조합으로만 시전한다. -->",
    "    <label title=\"끄면 원작대로 룬워드 조합으로만 시전합니다\">마법 이름 클릭 시전",
    "      <input type=\"checkbox\" id=\"easyMagicOn\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <!-- ★ 위 토글의 **하위** 옵션 (사용자 지정 2026-08-16: 「완전히 없애지는 말고",
    "         이지모드의 하위 토글 버튼으로 넣는게 좋겠어」). 켜면 마법 하위메뉴에서",
    "         링을 감추고 목록만 띄운다 — 목록 첫 줄이 링에 가리는 일이 없어진다.",
    "         이지 모드가 꺼져 있으면 이 옵션은 아무 일도 하지 않는다. -->",
    "    <label title=\"마법 하위메뉴에서 링을 감추고 목록만 띄웁니다 (마법 이름 클릭 시전이 켜져 있을 때만)\"",
    "           style=\"padding-left:14px;opacity:.85\">└ 링 감추고 목록만",
    "      <input type=\"checkbox\" id=\"magicListOnly\" style=\"float:right;margin-top:5px\"></label>",
    "",
    "    <!-- ★★ 리마스터 토글 모음 (사용자 지정 2026-08-16: 「일전에 토글로 달았던것들",
    "         모두 개발창에 토글버튼으로 만들어줘 나중에 잊어버릴 것 같아」).",
    "         전부 `__Opt.cfg` 를 그대로 읽고 쓴다 — 기본값은 **원작**이다. -->",
    "    <div style=\"margin-top:6px;border-top:1px solid #444;padding-top:4px;opacity:.9\">리마스터 옵션</div>",
    "    <label title=\"효과 범위에 맞을 대상이 없어도 시전할 수 있게 합니다. 원작은 3단계만 막고 4·6·7단계는 빈 칸도 허용합니다(원작의 불일치를 그대로).\">빈 칸에도 시전",
    "      <input type=\"checkbox\" id=\"optEmptyCast\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"이미 원소 속성이 걸린 대상에 또 걸었을 때 원작은 「AI Check! %x」를 띄웁니다. 켜면 뜻이 통하는 문구로 바꿉니다.\">중복 문구 다듬기",
    "      <input type=\"checkbox\" id=\"optDupMsg\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"전격 1단계에서 번개 발끼리 살짝 벌려 발수가 눈에 보이게 합니다(원작은 겹쳐서 티가 안 납니다).\">번개 발수 구분",
    "      <input type=\"checkbox\" id=\"optBoltGap\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"마법사 계열(무기 종류 2 · 지팡이)의 평타를 짧은 부채꼴 원거리로 바꿉니다. 끄면 원작대로 정면 1칸입니다.\">마법사 원거리 평타",
    "      <input type=\"checkbox\" id=\"optMageRange\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"마법사 계열의 평타 공격력을 힘이 아니라 지력으로 계산합니다. 끄면 원작대로 힘 기반입니다.\">지력 기반 공격력",
    "      <input type=\"checkbox\" id=\"optMageIntAtk\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"궁수 계열 사거리를 세 단계(아처·킬러 5 / 헌터·클리너 6 / 그 밖 7)로 나눕니다. 끄면 원작대로 아처·헌터만 5, 나머지 7입니다.\">궁수 사거리 세 단계",
    "      <input type=\"checkbox\" id=\"optBowTier\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"빙한 6단계 1·2클(레오파드·아이스스톰)에도 3클 블리자드처럼 화면을 파랗게 물들입니다. 원작은 3클만 물들입니다.\">빙한6 1·2클 파란 물들임",
    "      <input type=\"checkbox\" id=\"optIce6Pal\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"전격 4단계 2클의 번개를 다른 원소 4단계 2클처럼 시전자 앞에서 3·5·7·9칸으로 넓어지며 앞으로 퍼지게 합니다. 끄면 원작대로 옆으로 세 번 칩니다.\">전격4 2클 앞으로 퍼짐",
    "      <input type=\"checkbox\" id=\"optThunder4Spread\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"소환수·분신·소울리콜로 일으킨 유닛이 번 경험치를 부른 사람이 받습니다(레벨업 포함). 끄면 원작대로 소환수 몫은 사라집니다.\">소환수 경험치 → 소환자",
    "      <input type=\"checkbox\" id=\"optExpSummon\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"회복·버프·디버프·부활처럼 피해를 주지 않는 마법이 실제로 먹힌 대상 한 명당, 그 대상을 쓰러뜨렸을 때 경험치의 1/5(최소 1)을 받습니다. 시전 한 번에 20까지. 끄면 원작대로 없습니다.\">보조 마법 경험치",
    "      <input type=\"checkbox\" id=\"optExpSupport\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"쓰러뜨리지 못하고 피해만 줬을 때 — 쓰러뜨렸을 때 경험치 × (깎은 HP ÷ 최대 HP) × 1/2(최소 1). 평타·필살기·초필살기·스킬·마법 모두. 끄면 원작대로 쓰러뜨려야만 받습니다.\">피해 부분 경험치",
    "      <input type=\"checkbox\" id=\"optExpPartial\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"상태창 이름을 그릴 때만 앞뒤 공백을 빼고 정가운데에 찍습니다(세이브 이름은 그대로). 끄면 원작대로 공백까지 폭으로 쳐서 한 글자 이름이 오른쪽으로 치우칩니다.\">상태창 이름 가운데",
    "      <input type=\"checkbox\" id=\"optNameCenter\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"배 대포처럼 칸을 골라 십자로 맞히는 무기는, 공격 범위 칸 위에 적이 없어도 어느 범위 칸의 십자에 적이 들어오면 공격할 수 있습니다. 끄면 원작대로 범위 칸 위에 적이 있어야 공격 아이콘이 켜집니다.\">대포 십자 조준",
    "      <input type=\"checkbox\" id=\"optCannonCross\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"암흑성에서 흑태자가 실버애로우 포로를 풀어 주는 장면 뒤, 그때 포로였던 사람(이올린 빼고)이 고용 명부로 돌아와 마을에서 고용할 수 있습니다. 또 파티에 이올린이 있으면 이올린 편(로카르노·카메오·캐빈·사이브리드·사이렌·신디·사드·아르시아)이 GS 에게도 합류합니다. 끄면 원작대로입니다.\">포로 석방 뒤 고용 가능",
    "      <input type=\"checkbox\" id=\"optPrisonerFree\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"GS 가 스탐블링거를 들면 초필살기가 아수라파천무 대신 폭풍검(비·천둥 속에 떠올라 가까운 적부터 벼락, 큰 벼락으로 마무리 · 전격)이 됩니다. 끄면 원작대로 무기와 상관없이 아수라파천무입니다.\">초필살기 추가",
    "      <input type=\"checkbox\" id=\"optStormSword\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"말·비룡·마장기를 타면 TP 가 캐릭터 민첩 그대로 + 탈것 보정이 됩니다. 끄면 원작대로 탈것마다 정해진 민첩 상한(말 100 · 마장기 40~70)에서 잘립니다.\">탈것 TP 민첩 상한 없앰",
    "      <input type=\"checkbox\" id=\"optMountTpCap\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"레벨업 때 무기 숙련 경험치가 창세기전1처럼 레벨대마다 다르게 오릅니다(2~10: 10 · 11~20: 15 · 21~40: 20 · 41~50: 25 · 51~70: 35 · 71 이상: 50). 끄면 원작대로 늘 10입니다.\">필살기 숙련 창1 방식",
    "      <input type=\"checkbox\" id=\"optMasterySp\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"레벨업 때 마법 숙련 경험치가 창세기전1처럼 레벨대마다 다르게 오릅니다(필살기와 같은 표). 문장을 얻는 계열 순서와 상한은 원작 그대로입니다. 끄면 원작대로 늘 10입니다.\">마법 문장 숙련 창1 방식",
    "      <input type=\"checkbox\" id=\"optMasteryMg\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"리바이블을 쓰면 되살릴 사람을 월드 스테이터스 목록 같은 창에서 고릅니다(우클릭·ESC 취소, 휠로 넘김). 끄면 원작대로 가장 먼저 쓰러진 아군이 곧바로 되살아납니다.\">리바이블 대상 고르기 창",
    "      <input type=\"checkbox\" id=\"optRevivePick\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"레인저·스카우트·어쌔신도 워프를 씁니다. 레인저·스카우트는 도둑과 같은 반경 5칸, 고고학자·어쌔신은 반경 7칸입니다. 끄면 원작대로 도둑·고고학자(반경 5)만 씁니다.\">워프 직업 넓히기",
    "      <input type=\"checkbox\" id=\"optWarpJobs\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"도둑부터 탐색 스킬이 숨겨진 아이템까지 모두 짚습니다. 끄면 원작대로 스카우트·고고학자만 숨겨진 아이템을 찾습니다.\">탐색 넓히기",
    "      <input type=\"checkbox\" id=\"optSearchAll\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"원작은 다른 맵의 다른 아이템 몇 쌍이 «주웠음» 표시를 같이 써서 하나를 주우면 다른 하나가 사라집니다(3-3A 화이어크레스트 ↔ 3-3G 암흑검 등 28개). 켜면 모두 따로 얻습니다. 끄면 원작대로입니다.\">다른 맵 아이템 모두 얻기",
    "      <input type=\"checkbox\" id=\"optItemFlagSplit\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"조련 스킬이 정면 칸에 몬스터를 한 마리 부릅니다(조련사 레벨 19 이하 슬라임 · 29 박쥐 · 39 오크 · 49 오크로드 · 59 흡혈박쥐 · 그 위 블러드오크). 조련사 한 명당 한 마리이고 경험치는 조련사가 받습니다. 끄면 원작대로 정면 몬스터를 혼란에 빠뜨립니다.\">조련 소환",
    "      <input type=\"checkbox\" id=\"optTameSummon\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"스테이터스 창 위에 걸린 버프·디버프·자세를 아이콘으로 보여 주고, 공격·방어·마법 저항·TP 칸에 효과가 반영된 값을 색으로(오르면 초록 · 내리면 빨강) 찍습니다. 아이콘이나 수치에 마우스를 올리면 효과 설명이 뜹니다. 끄면 원작 창 그대로입니다.\">스테이터스 효과 표시",
    "      <input type=\"checkbox\" id=\"optStatusFx\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"이벤트 행진 때 유닛이 대본의 출발 칸에 없으면 그 칸까지 걸어간 뒤 행진합니다. 끄면 원작대로 출발 칸으로 순간이동합니다.\">이벤트 행진 합류",
    "      <input type=\"checkbox\" id=\"optMarchJoin\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"힘이 오르내리는 장비(힘의 반지 등)를 끼우거나 벗으면 공격력도 그만큼 바로 바뀝니다(맨손·대형 직업은 2배). 끄면 원작대로 힘만 바뀌고 공격력은 레벨업·전직 때 다시 계산됩니다.\">장비 힘 → 공격력 바로 반영",
    "      <input type=\"checkbox\" id=\"optEquipStrAtk\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"전투 배치 화면 왼쪽 위에 STATUS·CLASS·ITEM 단추를 띄웁니다. 누르면 월드와 같은 캐릭터·전직·장비 창이 전투 위에 열리고, 나오면 바뀐 직업·장비가 배치 목록과 이미 놓인 캐릭터에 그대로 반영됩니다. 끄면 원작대로 단추가 없습니다.\">배치 화면 캐릭터 창 단추",
    "      <input type=\"checkbox\" id=\"optDeployWin\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"스켈톤·다크스켈톤·용아병(스켈톤로드 포함)·굴·좀비가 리치처럼 물리 공격(검·창·활·광역 무기)에 피해를 입지 않습니다. 불·얼음·번개·암흑 속성 공격과 속성을 부여한 무기는 그대로 들어갑니다. 끄면 원작대로 물리 공격을 줄여서 받습니다.\">언데드 물리 면역",
    "      <input type=\"checkbox\" id=\"optUndeadPhys\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"원작에 없던 무기 속성(적소검·로드·실버소드·자비르·궁그닐·묠니르·백엽검·유성검·흑강검 등). 크리티컬 상태이상과 언데드 물리 면역 뚫기.\">리마스터 무기 속성<input type=\"checkbox\" id=\"optWeaponAttr\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"아군으로 배치돼 전투를 마친 캐릭터(43-0 번스타인)를 전투 뒤 활동 파티에 합류. 끄면 원작대로 전 팀에 남음.\">아군 배치로 돌아온 캐릭터는 파티 복귀<input type=\"checkbox\" id=\"optAllyDeployReturn\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"원작은 활동 파티 90명이면 고용·합류가 막힘(PACK 0x1C719). 켜면 상한 없음.\">파티 인원 제한(90명) 해제<input type=\"checkbox\" id=\"optPartyNoLimit\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"버서커(광전사)를 쓴 캐릭터가 적만 공격합니다. 끄면 원작대로 피아를 가리지 않고, 차례마다 3분의 1 확률로 아군을 공격합니다.\">버서커 적만 공격",
    "      <input type=\"checkbox\" id=\"optBerserkFoeOnly\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"라시드는 킹이 되어도 빙룡소환을 씁니다(다른 킹은 못 씀).\">라시드 킹 빙룡소환<input type=\"checkbox\" id=\"optIceDragonKing\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"GS 가 데스로드가 되면 마장기 아수라를 소환합니다.\">GS 데스로드 아수라 소환<input type=\"checkbox\" id=\"optAsuraSummon\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"랜담이 게이볼그를 들어도 교아참을 씁니다.\">랜담 게이볼그 교아참<input type=\"checkbox\" id=\"optGyoachamExt\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"창을 한손 무기로 보아 방패와 함께 낍니다. 기본 원작.\">창을 한손 무기로<input type=\"checkbox\" id=\"optSpearOneHand\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"«창을 한손 무기로» 가 켜졌을 때 랜서·궁그닐·자비르만 한손.\">한손 창은 기마형만<input type=\"checkbox\" id=\"optSpearOneHandCavalry\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"도끼를 한손 무기로 보아 방패와 함께 낍니다. 기본 원작.\">도끼를 한손 무기로<input type=\"checkbox\" id=\"optAxeOneHand\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"활을 한손 무기로 보아 망토와 함께 낍니다. 기본 원작.\">활을 한손 무기로<input type=\"checkbox\" id=\"optBowOneHand\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"원작에서 방패·망토를 못 끼던 직업 몇에 허용(표 값 사장님 결정 대기). 기본 원작.\">방패·망토 착용 직업 넓히기<input type=\"checkbox\" id=\"optGuardExt\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"아이템 팝업·상점 확인창에서 우클릭(키보드는 Alt)으로 숨은 효과(코드 효과·크리티컬 상태이상·마법검·초필살기·숨은 수치)를 봅니다.\">아이템 정보 더보기(우클릭·Alt)<input type=\"checkbox\" id=\"optItemMore\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"상성을 무시하는 명검(헬파이어 등)으로도 스나이퍼·킬러 일격필살이 납니다.\">상성 무시 무기도 일격필살<input type=\"checkbox\" id=\"optNoAttrOneShot\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"화이어·아이스·썬더·다크 로드를 들면 그 속성 마법 클래스가 하나 오릅니다.\">속성 로드 마법 클래스 +1<input type=\"checkbox\" id=\"optRodClass\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"윈드 부츠 TP 보정 30(원작 1).\">윈드 부츠 TP 30<input type=\"checkbox\" id=\"optWindBootsTp\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"성왕의 길 탈출 뒤에도 29장 전까지 라시드를 따라다닙니다.\">레이몬드·캐빈 라시드 파티 유지<input type=\"checkbox\" id=\"optRaymondKevin\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"엔딩 기록이 있으면 새 게임에 능력치·레벨을 이어받습니다.\">다회차: 능력치·레벨 계승<input type=\"checkbox\" id=\"optNewGamePlusStats\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"엔딩 기록이 있으면 새 게임에 장비·소지품·소지금을 이어받습니다.\">다회차: 아이템·소지금 계승<input type=\"checkbox\" id=\"optNewGamePlusItems\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"[개발] 레벨 상한을 999 로 풉니다(원작 99) — 다회차용. 능력치 상한(255 → 999)은 게임설정 리마스터 규칙 «능력치 상한 해제»가 따로 맡습니다. 255 넘는 값은 덧세이브에 저장합니다.\">[개발] 레벨 상한 해제<input type=\"checkbox\" id=\"optLevelCapOff\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"[개발] 마법 피해의 지력 배율을 200% 에서 자르지 않고, 회복 마법도 지력을 따라 늘립니다(원작 범위 지력에서는 같음).\">[개발] 마법 지력 배율 상한 해제<input type=\"checkbox\" id=\"optMagicCapOff\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"[개발] 고른 캐릭터 한 명을 레벨 999 까지 올립니다 — 레벨마다 원작 레벨업 성장을 그대로 되풀이해 능력치도 함께 오릅니다. 상한 해제를 자동으로 켭니다. 전투가 끝나야 명부에 저장됩니다.\">[개발] 레벨 999<span style=\"float:right\"><select id=\"devLv999Who\" style=\"max-width:120px\"><option value=\"\">캐릭터 고르기</option></select> <button type=\"button\" id=\"devLv999\">올리기</button> <button type=\"button\" id=\"devMaxAll\" title=\"[개발] 고른 캐릭터 한 명을 전부 최대로 — 레벨·힘·민첩·지력·권위 999 · 체력 15000 · 마력 15000(표기값) · 필살기 등급 검7 창4 도끼4 활4 권6 · 마법 일곱 계열 문장 2(직업이 타고난 계열은 3클래스까지). 레벨 상한 해제를 자동으로 켭니다. 전투가 끝나야 명부에 저장됩니다. (정본 248)\">전부 최대</button> <button type=\"button\" id=\"devCharReset\" title=\"[개발] 고른 캐릭터 한 명만 새 게임 처음 값으로 — 레벨·능력치·마법 레벨·필살기 등급/숙련·경험을 BLACKBOX.DEF 값으로 되돌립니다(직업·장비·소지품은 그대로 · 낀 장비 보정은 다시 더합니다). 명부에 바로 쓰고, 이번 전투가 끝나도 그 캐릭터는 명부를 덮어쓰지 않습니다.\">초기화</button></span></label>",
    "    <label title=\"해전 배치: 셋째 칸 배틀쉽, 비룡은 발톱 내려 둘째 줄. 끄면 원작 갤리·세일러·비룡.\">해전: 배틀쉽 + 둘째 줄 비룡<input type=\"checkbox\" id=\"optNavalVehicles\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"다크아머(게이시르·트리시스·가라드) 캐릭터가 타는 탈것은 I 판(제국 그림). 끄면 원작 실버애로우 판.\">다크아머 캐릭터의 탈것은 I 판<input type=\"checkbox\" id=\"optVehicleFaction\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"개발용 전체 아이템 상점 — 배치 화면에 SHOP 단추가 생깁니다(전부 0 ELD · 종류별 하위 메뉴 · 추가 아이템 포함). 제품 플레이에는 없습니다.\">[개발] 배치 화면 SHOP 단추<input type=\"checkbox\" id=\"optDevShop\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"직업별로 익힐 수 있는 문장 단계를 리마스터 값으로 씁니다(서번트 전 계열 2 · 킹 화빙뇌회 2 · 데스로드 화빙뇌회암 2 · 발키리 빙 2 · 드래곤나이트 화빙뇌회 1 등). 끄면 원작 표입니다.\">직업별 문장 한도 리마스터",
    "      <input type=\"checkbox\" id=\"optEmblemCap\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"전직 조건에서 성별을 보지 않습니다(남녀 누구나 그 직업으로 전직). 끄면 원작대로 성별이 맞아야 합니다.\">전직 성별 조건 빼기",
    "      <input type=\"checkbox\" id=\"optJobGender\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"적이나 아군 한 명을 고르는 마법(단일 대상)의 커서가 고를 수 있는 캐릭터 위에서 그 캐릭터 크기 상자로 바뀝니다(통상 공격 대상처럼). 칸·범위를 고르는 마법은 그대로 한 칸입니다. 끄면 원작대로 마법 커서는 캐릭터 위에서도 늘 한 칸 상자입니다.\">타겟 지정 UI 개선",
    "      <input type=\"checkbox\" id=\"optTargetUI\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"켜면 군단 전투에서 원작에서 보병으로 몰리던 직업을 어울리는 병종으로 바꿉니다(기사형 → 기병 · 병사·근위 → 창병 · 활·암살형 → 궁병 · 마법·성직형 → 마법병). 끄면 원작 표대로입니다.\">군단전투 직업별 병종 개선",
    "      <input type=\"checkbox\" id=\"optLegionJob\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"켜면 군단 전투에서 대본이 미리 배치한 캐릭터의 병종(보병·기병·창병·궁병·마법병)을 그 캐릭터의 지금 직업에 맞게 다시 정합니다(배치 때와 같은 표). 마장기·비룡·포병은 그대로입니다. 끄면 원작대로 대본에 적힌 병종입니다.\">병종 연결 개선",
    "      <input type=\"checkbox\" id=\"optLegionLink\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"켜면 상점에서 팔거나 취소한 뒤, 또는 팔 수 없다는 안내가 닫힌 뒤 판매 목록이 같은 자리로 다시 열려 이어서 팔 수 있습니다. 끄면 목록이 다시 열리지 않습니다.\">상점 판매후 상점리스트 복귀",
    "      <input type=\"checkbox\" id=\"optSellReturn\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"켜면 마법 링 첫 룬(속성) 아이콘이 속성 색으로 보이고(화염 빨강·빙한 하늘·전격 노랑·회복 초록·보조 흰색·소환 주황·암흑 보라), 룬에 커서를 대면 그 룬으로 쓸 수 있는 마법이 목록에서 빛납니다. 끄면 원작대로입니다.\">마법 룬 속성 색·목록 빛내기",
    "      <input type=\"checkbox\" id=\"optRuneGuide\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"켜면 눈밭처럼 밝은 바닥에서 이동·대상·효과 범위 칸이 푸른 기로 표시되어 잘 보입니다(원작 방식으로는 흰 바닥이 거의 안 바뀌는 색만 바꾸고, 다른 바닥은 원작과 같은 색입니다). 끄면 원작대로입니다.\">눈밭(밝은 바닥) 범위 칸 잘 보이게",
    "      <input type=\"checkbox\" id=\"optBrightMark\" checked style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"소환한 몬스터의 이름을 한글 종류 이름으로 보여줍니다(고 블 린 · 샐러맨더 …). 끄면 원작대로 어떤 소환수든 「소 환 수」로만 뜹니다. 자간은 원작 규칙(64픽셀 맞춤)을 그대로 씁니다.\">소환수 한글 이름",
    "      <input type=\"checkbox\" id=\"optSummonNameKo\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"3급 마장기(베샤르·페리튼·로퍼)에 탄 조종사를 창세기전1의 PM*.MCR 로 그립니다. 원작 창세기전2는 이름 있는 캐릭터만 조종사를 그려서, 제국병·로열가드가 타면 아무도 안 보입니다. 켜면 병종 조종사도 보입니다.\">3급 마장기 조종사(창1)",
    "      <input type=\"checkbox\" id=\"optPMPilot\" style=\"float:right;margin-top:5px\"></label>",
    "    <label title=\"PM0·PM1·PM2 중 어느 벌을 쓸지. 자동은 마장기 순서대로(베샤르 PM0 · 페리튼 PM1 · 로퍼 PM2) — 창세기전1 표 순서 근거. 옆모습에서 조종사 자리가 달라 견주어 보라고 둔 셀렉트입니다.\">PM 벌 고르기",
    "      <select id=\"optPMBundle\" style=\"float:right;margin-top:3px;font-size:11px\">",
    "        <option value=\"자동\">자동(마장기순)</option>",
    "        <option value=\"0\">PM0 고정</option>",
    "        <option value=\"1\">PM1 고정</option>",
    "        <option value=\"2\">PM2 고정</option>",
    "      </select></label>",
    "    </div>",
    "    </div>",
    "  </div>"
  ].join("\n");

/**
 * 호스트 안에 전투 무대를 만든다.
 * @param {Element} 호스트  무대를 담을 요소
 * @param {object} [옵션]   `{ 개발패널: false }`
 * @returns {Element} 만들어진 `#stage`
 */
/* ★★★ **스타일 보장** — 무대가 보이려면 `battle_stage.css` 가 있어야 한다.
 *   전투 실행기는 자기 `<style>` 을 갖고 있으므로 **중복 주입하지 않는다**
 *   (표식 id 로 한 번만). 셸은 무대를 만들 때 넣고 **해제할 때 뺀다** —
 *   맨 앞 `html, body` 규칙이 전역이라 남겨 두면 셸 배경·스크롤이 바뀐다. */
var 스타일ID = "g2-battle-stage-css";

function 스타일보장() {
  if (typeof document === "undefined") return null;
  var 옛 = document.getElementById(스타일ID);
  if (옛) return 옛;
  var l = document.createElement("link");
  l.id = 스타일ID;
  l.rel = "stylesheet";
  l.href = "/battle_stage.css";        /* 서버 루트 = 02_실행기/게임/ */
  document.head.appendChild(l);
  return l;
}

function 스타일해제() {
  if (typeof document === "undefined") return false;
  var l = document.getElementById(스타일ID);
  if (!l || !l.parentNode) return false;
  l.parentNode.removeChild(l);
  return true;
}

function 만들기(호스트, 옵션) {
  if (!호스트) throw new Error('battle_stage.만들기: 호스트가 없다');
  옵션 = 옵션 || {};
  if (호스트.querySelector && 호스트.querySelector('#stage'))
    throw new Error('battle_stage.만들기: 이미 #stage 가 있다 — 해제() 를 먼저 불러야 한다');
  if (옵션.스타일 !== false) 스타일보장();
  var st = document.createElement('div');
  st.id = 'stage';
  /* ★★★★★ **전체 화면 모드** (2026-08-23 · 사용자 지적)
   *
   *   > 「대사창 위치도 안맞고 … 기존 적용 되던 포트레이트나 이런것도 안되고」
   *
   *   전투 UI 는 **창 전체**를 기준으로 배치한다(`innerWidth/innerHeight`).
   *   셸은 무대를 화면 컨테이너 `#판` 안에 두므로 크기가 달라진다 —
   *   실측: 전투.html 은 무대 958×1030 인데 셸은 **738×461**,
   *   대사창 `#dlgcv` 는 1171×477 로 **무대 밖으로 삐져나갔다.**
   *   그래서 대사창·초상화·배율이 전부 어긋났다.
   *
   *   ⇒ 셸에서는 `position: fixed; inset: 0` 으로 **창 전체**를 쓴다.
   *     원본도 전투는 전체 화면이다. `#stage` 의 CSS 는 `absolute` 라
   *     부모(`#판`)에 갇히므로 여기서 덮어쓴다. */
  if (옵션.전체화면) {
    st.style.position = 'fixed';
    st.style.left = '0'; st.style.top = '0';
    st.style.right = '0'; st.style.bottom = '0';
    st.style.width = '100%'; st.style.height = '100%';
    st.style.zIndex = '50';        /* 셸 진단칸(있으면) 위로 */
    /* ★★★ [리마스터] **전체화면이면 전투도 화면비 틀 안에** (2026-10-03 · Z-94)
     *   > 사장님 결정(2026-09-26): 「앱창은 크기로 전체화면은 틀 안에서」 · 2026-10-03 「진행한다」
     *   전체화면에서는 셸이 그리는 틀(#판 — 게임.html 화면맞추기 · 4:3/16:9 레터박스)의 자리·크기에 무대를 둔다.
     *   전체화면이 아니면 예전처럼 창 전체(앱 창은 창 크기 자체가 그 비율이다 — 게임.html 앱창맞추기).
     *   ★ 전투 UI 는 이 틀 크기를 쓴다 — battle_main fitRing · hud.fit 이 G2전투틀() 을 본다.
     *   ★ 마우스 좌표는 전부 캔버스 getBoundingClientRect 기준이라 틀이 옮겨져도 맞다. */
    var 틀맞추기 = function () {
      var 판 = 호스트 && 호스트.id === '판' ? 호스트 : document.getElementById('판');
      /* ★ 11-09 — 창 모드에서도 틀 안에: 사장님 「전투화면이 지금은 창 크기에 따라 맞춰서 변해. 처음 의도했던거긴하지만 4:3, 16:9 세팅한 이상 그 비율에 맞아야해.」
       *   셸 틀(#판)은 창 모드에서도 화면비대로 레터박스된다(게임.html 화면맞추기) — 예전엔 전체화면일 때만 따랐다 */
      var r = (판 && 판.getBoundingClientRect) ? 판.getBoundingClientRect() : null;
      if (r && r.width > 0 && r.height > 0) {
        st.style.left = Math.round(r.left) + 'px'; st.style.top = Math.round(r.top) + 'px';
        st.style.right = 'auto'; st.style.bottom = 'auto';
        st.style.width = Math.round(r.width) + 'px'; st.style.height = Math.round(r.height) + 'px';
      } else {
        st.style.left = '0'; st.style.top = '0'; st.style.right = '0'; st.style.bottom = '0';
        st.style.width = '100%'; st.style.height = '100%';
      }
    };
    틀맞추기();
    window.addEventListener('resize', function () { 틀맞추기(); if (window.requestAnimationFrame) requestAnimationFrame(틀맞추기); });   /* 셸 틀(화면맞추기)이 먼저 자리 잡은 뒤 한 번 더 */
    document.addEventListener('fullscreenchange', function () {
      틀맞추기();
      try { window.dispatchEvent(new Event('resize')); } catch (e틀) {}   /* 전투 UI(fitRing)도 다시 맞춘다 */
    });
  }
  /** 전투 UI 가 쓰는 틀 — 무대가 있으면 그 크기, 없으면 창 */
  window.G2전투틀 = function () {
    var 무 = document.getElementById('stage');
    var r = 무 && 무.getBoundingClientRect ? 무.getBoundingClientRect() : null;
    if (r && r.width > 0 && r.height > 0) return { x: r.left, y: r.top, w: r.width, h: r.height };
    return { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
  };
  st.innerHTML = 무대앞 + "\n" +
                 (옵션.개발패널 ? 개발패널 + "\n" : "") +
                 무대뒤;
  호스트.appendChild(st);
  return st;
}

/** 무대를 걷어낸다 — **DOM 을 실제로 지운다**(감추기가 아니다). */
function 해제(호스트) {
  if (!호스트 || !호스트.querySelector) return false;
  var st = 호스트.querySelector('#stage');
  if (!st || !st.parentNode) return false;
  st.parentNode.removeChild(st);
  스타일해제();          /* ★ 전역 규칙(html,body)을 남기지 않는다 */
  return true;
}

/**
 * ★★★★★ **무대를 감춘다 — DOM 은 남긴다** (2026-08-24)
 *
 *   사용자 지정: 「월드랑 전투랑 **명확히 분리**해서 월드에서 전투 진입하면
 *   **월드 세팅 다 없애고 전투세팅 부르고**, 전투 끝나면 **전투 세팅 끝내고**
 *   **다시 로드**하고 하면 될걸 왜 계속 꼬여서 이상하게 만드냐고」
 *
 *   분리는 **상태**로 해야 한다. DOM 을 지웠다 다시 만들면
 *   `battle_main.js` 가 잡아 둔 참조(입력 리스너 10개 · 개발 패널 bind ·
 *   대사창 `#dlgcv`)가 **끊긴 옛 노드**를 가리켜 조작·배율·대사가 죽는다.
 *   그래서 전에는 `screens.js` 가 「체인이면 무대를 그대로 둔다」는 **예외**를
 *   두었는데, 그 예외 때문에 「처음 전투와 나중 전투가 달라졌다.」
 *
 *   ⇒ 무대 DOM 은 **한 번 만들어 두고 감췄다 드러낸다.**
 *     전투 세팅(`battle`·`Renderer`·컨트롤러·HUD·Ring·Fx)은
 *     진입마다 `G2전투재구성()` + `G2화면자원세우기()` 로 **통째로 다시 세운다.**
 *     그러면 세 경로(`?sce=` 직행 · 월드→전투 · 체인)가 **완전히 같은 길**을 간다.
 */
function 감추기(호스트) {
  var st = 호스트 && 호스트.querySelector ? 호스트.querySelector('#stage') : null;
  if (!st) return false;
  st.style.display = 'none';
  스타일해제();               /* 전역 규칙(html,body)은 월드에 남기지 않는다 */
  return true;
}

/** 감춰 둔 무대를 다시 드러낸다. 없으면 false — 부른 쪽이 `만들기()` 한다. */
function 드러내기(호스트, 옵션) {
  var st = 호스트 && 호스트.querySelector ? 호스트.querySelector('#stage') : null;
  if (!st) return false;
  if (!옵션 || 옵션.스타일 !== false) 스타일보장();
  st.style.display = '';
  return true;
}

var API = { 만들기: 만들기, 해제: 해제, 감추기: 감추기, 드러내기: 드러내기,
            스타일보장: 스타일보장, 스타일해제: 스타일해제,
            _무대앞: 무대앞, _무대뒤: 무대뒤, _개발패널: 개발패널 };
root.G2BattleStage = API;
if (typeof module !== 'undefined' && module.exports) module.exports = API;

})(typeof window !== 'undefined' ? window : globalThis);