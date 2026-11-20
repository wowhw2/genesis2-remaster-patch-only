/* ============================================================================
 * 창세기전 2 — 전투 렌더러
 *
 * 원본은 480×200 버퍼에 y 정렬로 그리는 2D 입니다.
 * 여기서는 같은 그림을 기울여 볼 수 있게 CSS 3D 로 세웁니다.
 *
 *   바닥      원본 `.MAP` 지면(레이어 A)을 평면 그대로 (rotateX/rotateZ 로 눕힘)
 *   오브젝트  원본 `.MAP` 블록(레이어 B)을 각 배치 위치에 **세웁니다**
 *   유닛      원본 `.NC2` 스프라이트를 발밑 기준으로 **세웁니다**
 *
 * 그림은 전부 원본 파일을 런타임에 디코드해 씁니다 (`_원본맵초기화` → `decodeMAP`).
 *
 * 세워 두면 뒤쪽 것이 앞쪽 것에 자연히 가려집니다 — 원본의 y 정렬과 같은 결과이고,
 * 기울여도 앞뒤가 안 뒤집힙니다.
 *
 * 좌표 약속 (04_도구/g2_export_battle.py 와 같습니다)
 *   타일 24×16.  유닛 기준점을 (x*24 + 12, y*16 − 2) 에 맞춥니다.
 * ==========================================================================*/
(function (root) {
'use strict';

function needsLargeVisual(u) { var Ru = root.Rules; if (!Ru && typeof require === 'function') { try { Ru = require('./rules.js').Rules; } catch (e) {} } if (!Ru || !Ru.needsLargeVisual) throw new Error('Rules.needsLargeVisual가 필요하다'); return Ru.needsLargeVisual(u); }

/* 타일 한 칸 **24 x 16 = 384바이트** — `.MAP` 로더 `0x2163E` 가
 * `ebx = 0x180`(384) 으로 한 칸을 읽는다 (`00_이어가기.md` 타일 줄). */
/* 공용 좌표층 소유. 원본 근거: 0x10971(24), 0x10988(16). */
var 좌표상수 = root.G2Projection;
if (!좌표상수 && typeof require === 'function') 좌표상수 = require('./projection.js');
if (!좌표상수) throw new Error('G2Render: G2Projection이 먼저 필요하다');
var 연출명령계약 = root.G2EffectCommand;
if (!연출명령계약 && typeof require === 'function') 연출명령계약 = require('./effect_command.js');
if (!연출명령계약) throw new Error('G2Render: G2EffectCommand가 먼저 필요하다');
var 연출층계약 = root.G2EffectLayer;
if (!연출층계약 && typeof require === 'function') 연출층계약 = require('./effect_layer.js');
if (!연출층계약) throw new Error('G2Render: G2EffectLayer가 먼저 필요하다');
var TW = 좌표상수.타일가로, TH = 좌표상수.타일세로;

function el(tag, cls, parent) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
}

function Renderer(host, G2, battle, 시간원찾기) {
  this.host = host;
  this.G2 = G2;
  this.b = battle;
  /* 전투 수명은 렌더러가 소유하지 않는다. 호출 시점의 세션을 주입받아 일회 RAF만
   * 빌린다. 생성은 세션보다 앞서므로 세션 객체 자체를 고정해 두면 안 된다. */
  this._시간원찾기 = (typeof 시간원찾기 === 'function') ? 시간원찾기 : null;
  this._세션종료정리 = [];
  this._렌더러폐기됨 = false;
  this._자산재시도 = [];
  this._mapSurfaceStore = root.G2Map3DSurfaceStore
    ? root.G2Map3DSurfaceStore.create() : null;
  this.base = '자산/';

  /* zoom = 화면 배율.  dist 는 원근의 세기일 뿐 크기를 바꾸지 못합니다
   *   (translateZ 는 뒤로 미는 것이라 확대가 안 됩니다).
   * 원본 논리 화면이 320×200 이고 광역 초필살기 범위가 12×12칸 = 288×192 이므로
   * **zoom 이 화면높이/200 일 때가 원작과 같은 크기**입니다. 그것을 기본으로 잡습니다. */
  /* ★ 원작은 **완전한 평면 2D** 입니다 (실황 영상 0:60·3:16·4:49 전 구간 확인).
   *   기울기·회전은 리마스터 HD-2D 항목이라 원본 재현이 끝난 뒤에 켭니다.
   *   슬라이더는 그대로 두되 기본값은 원작과 같은 0° 입니다. */
  /* [원본없음] — 카메라 기울기·회전·원근은 **리마스터에서 더한 것**이다.
   * 기본값은 tilt 0 · rot 0 · dist 0 이라 **꺼진 상태**(원본과 같은 2D)로 시작한다.
   * fov 34 는 켰을 때 쓰는 값이라 원본에 대응물이 없다. */
  this.cam = { tilt: 0, rot: 0, dist: 0, fov: 34, zoom: 1, cx: 0, cy: 0 };
  this.mapW = battle.W * TW;
  this.mapH = battle.H * TH;

  host.innerHTML = '';
  /* ★ 여기서 자르면 안 됩니다.  기울인 평면은 화면 밖으로 크게 뻗는데
   *   host 가 overflow:hidden 이면 그 경계에서 맵이 싹둑 잘려 보입니다
   *   (검은 세로 띠 너머로 맵이 다시 보이던 증상). 자르는 것은 #stage 하나면 충분합니다. */
  host.style.overflow = 'visible';

  /* ★★★ 지면 그룹 — **world 보다 앞**에 붙여 항상 아래에 깔린다 (2026-08-17).
   *
   * 왜 world 밖으로 뺐나: `world` 는 `preserve-3d` 라 자식이 z-index 가 아니라
   * **3D 깊이**로 정렬된다. 유닛 상자는 빌보드라 `rotateX(−tilt)` 로 **세워져**
   * 있고, 그 안의 그림자는 기준점보다 아래(`+y`)에 놓이므로 회전 뒤엔 z 가
   * 지면 평면(z=0)보다 **뒤로** 내려간다. 그래서 지면 조각이 그림자 아랫부분을
   * 덮어 **타원 아래가 칼로 자른 듯 잘렸다**(사용자 보고 2026-08-16·17).
   *
   * `transform-style:flat` 만으로는 부족했다 — 레이어가 한 장으로 합쳐질 뿐
   * 그 평면이 여전히 같은 3D 공간의 z=0 에 있어 깊이 비교를 계속 한다.
   * **다른 3D 컨텍스트로 갈라야** 비교 자체가 없어진다.
   *
   * `overlayLayer`(선택박스)·`fxTopLayer`(마법)와 **같은 수법**이다. 그쪽은
   * world **다음**에 붙여 위에 얹고, 이쪽은 world **앞**에 붙여 아래에 깐다.
   * `apply()` 가 셋 모두에 **똑같은 변환**을 주므로 확대·기울기·원근은 같다.
   * ★ z-index·translateZ 로 유닛 하나를 띄우는 방식은 쓰지 않는다(사용자 금지). */
  this.groundLayer = el('div', 'g2-ground', host);
  this.groundLayer.style.cssText =
    'position:absolute;left:50%;top:50%;transform-style:preserve-3d;';

  /* 세운 연출 그림을 지면에 눕히지 않고, 유닛보다 뒤에서 월드 배율로 그린다. */
  this.fxWorldUnderLayer = el('div', 'g2-fxworld-under', host);
  this.fxWorldUnderLayer.style.cssText =
    'position:absolute;left:50%;top:50%;transform-style:preserve-3d;pointer-events:none;';

  this.world = el('div', 'g2-world', host);
  this.world.style.cssText =
    'position:absolute;left:50%;top:50%;transform-style:preserve-3d;';

  /* ── 바닥 ──────────────────────────────────────────────────────────────
   * 맵 한 장을 통짜 <img> 로 두면 크게 확대했을 때 브라우저 합성 레이어 한도에
   * 걸려 잘립니다. 격자로 쪼개면 조각마다 따로 래스터화되어 잘리지 않습니다.
   * 오브젝트는 MAP layer-B 원시 블록으로 따로 세웁니다. 합성된 map_obj.png 를
   * 다시 자르면 이웃 픽셀까지 복제되어 숲과 벽이 깨지기 때문입니다. */
  this.floorLayer = el('div', 'g2-floorlayer', this.groundLayer);   // ★ world 가 아니라 지면 그룹
  this.floorLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';
  /* ★ 바닥·오브젝트는 **원본 .MAP 직독**으로만 짓는다(추출 PNG 미사용).
   *   생성 직후 비동기 _원본맵초기화가 원본에서 불러와 채운다. */

  /* 움직이는 바닥 타일 (js/fx.js). 바닥은 조각마다 한 장으로 구워 놓아 그 안의
   * 한 칸만 못 고치므로, 그 자리에 원본 블록을 덧그립니다(`blockUrl`).
   * 바닥과 같은 평면에 눕혀 두어야 오브젝트·유닛이 자연히 위로 옵니다. */
  /* 바닥과 같은 평면이므로 **지면 그룹**에 둔다(위 `groundLayer` 주석).
   * 조각들이 쓰는 `translateZ(0.05px)`(z-fighting 회피)는 그룹 안에서 그대로 산다. */
  this.tileLayer = el('div', '', this.groundLayer);
  this.tileLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';
  this.tileEls = {};

  /* 원작 0x12BEE처럼 오브젝트와 유닛을 한 목록에서 y 정렬합니다. */
  this.spriteLayer = el('div', 'g2-sprite-layer', this.world);
  this.spriteLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';
  this.objLayer = this.spriteLayer;

  /* ★★★★★ **지형·맵 오브젝트를 잠깐 가린다** — 「배경생성」 마법용 (2026-09-07)
   *
   *   > 사장님(`battle-moonlight-obj`): 「**오브젝트 보이고** … 다시 수정해」
   *   > CLAUDE.md 분류 ① **배경생성** — 「마법이 배경을 만든다. 그 위에 맵 지형·
   *   >   오브젝트를 **다시 안 그린다**」
   *
   *   원본 문라이트 도막 ②~④ 는 한 프레임에 이것만 그린다 —
   *   ```asm
   *   0x58906  테두리(레코드 0)   → 0x5EFB9
   *   0x58919  call 0x12F2A       ; ★ **유닛 전부** — 유닛은 다시 그린다
   *   …        빛줄기
   *   0x58AE8  테두리(레코드 1)   → 0x5EFB9
   *   0x58AED  call 0x5E9E8       ;   갱신
   *   ```
   *   **맵을 다시 그리는 `0x454B3` 호출이 없다.** ⇒ 지형·오브젝트는 사라지고 유닛만 남는다.
   *
   *   ☠ `objLayer` 는 `spriteLayer` 와 **같은 층**이다(바로 위 줄). 통째로 숨기면
   *     **유닛까지 사라진다.** 그래서 맵 조각은 **클래스로 갈라** 숨긴다. */
  this._맵가림 = false;

  /* 높이 16인 Layer-B 블록은 바닥 장식·경계 타일이므로 세우지 않습니다.
   * ★ **지면 그룹**에 둔다 (2026-08-17) — 눕힌 것이라 `world` 안에 있으면
   *   이 평면(z=0)이 세운 그림자의 아랫부분(z<0)을 덮는다(`groundLayer` 주석).
   *   지금은 **움직이는 눕힘 블록**(물결·불꽃)이 여기 들어가므로 실제로 걸린다. */
  this.flatObjLayer = el('div', 'g2-flat-object-layer', this.groundLayer);
  this.flatObjLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';

  /* 이동/공격 범위 표식은 지형과 같은 바닥 평면에 눕고, 스프라이트보다 **아래**에
   * 페인트되어야 한다(원본 0x1547F: 타일을 리맵/그린 뒤 그 위에 스프라이트를 그림).
   * ★ 그래서 **지면 그룹**에 둔다(2026-08-17) — 전에는 `world` 안에서 `spriteLayer`
   *   앞에 꽂아 DOM 순서로 눌렀지만, 그러면 이 평면(z=0)이 세운 그림자의 아랫부분
   *   (z<0)을 **덮는다.** 지면과 성질이 같으니 자리도 지면과 같아야 한다. */
  this.markLayer = el('div', '', this.groundLayer);
  this.markLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';

  /* ★★★ **유닛보다 아래에 깔리는 이펙트** — 바닥 불·마법진·별표 (2026-08-16)
   *
   * 사용자 지정: 「바닥에 깔리는 타원형 이펙트는(불, 마법진) **캐릭터 아래에 깔려야**
   * 해. 이펙트가 캐릭터에 **가려져야** 한다는 소리야. … 회복마법의 턴언데드나,
   * 보조 마법, 소환 마법 등에도 비슷하게 적용될 거야.」
   *
   * 원본은 화면 다시 그리기(`0x12BEE`)를 이펙트 그리기 **앞**에 부르느냐 **뒤**에
   * 부르느냐로 앞뒤를 가른다. 뒤에 부르면 유닛이 나중에 그려져 **위**로 온다.
   * ```
   * 화염2 3클 B단(바닥 불 6~19)  0x56443 call 0x1FFFE → 0x56448 call 0x12BEE  ★ 유닛이 위
   *           C단(시험관 0~5)    0x56484 call 0x12BEE → 0x5650A call 0x561F4    이펙트가 위
   *           D단(파티클)        0x564F3 call 0x12BEE → 그리기                  이펙트가 위
   * 빙한2 3클 cx ≤ 10 (바닥 별표) 0x22AC7 나중                                  ★ 유닛이 위
   *           cx > 10 (머리 위)   0x22A84 먼저                                   이펙트가 위
   * ```
   * `preserve-3d` 깊이 **동률**에서는 DOM 순서가 결정하므로 `spriteLayer` **앞**에
   * 둔다 — `markLayer` 와 같은 수법이다. 깊이가 다른(= 다른 칸) 경우는 z 가
   * 알아서 갈라 주므로 뒤쪽 칸의 불이 앞쪽 캐릭터에 가리는 것도 그대로 맞는다.
   *
   * ★ `fxLayer` 로는 안 된다. 그건 `world` 에 **append** 되어 `spriteLayer` **뒤**에
   *   있으므로, 같은 칸(z 동률)에서는 오히려 유닛 위로 올라온다. 빙한2 3클이
   *   `본체.아래 = (i <= 10)` 로 이미 배선돼 있는데도 캐릭터를 덮었던 이유다. */
  this.fxUnderLayer = el('div', '', this.groundLayer);
  /* ★★ `translateZ` 로 **지면보다 살짝 아래**에 놓는다 — DOM 순서만으로는 부족하다.
   *
   *   빌보드는 회전만 걸고 이동이 없어(`_빌보드적용`), `preserve-3d` 공간에서는
   *   **레이어 경계를 넘어 z 로 정렬**된다. 그래서 `spriteLayer` 앞에 꽂아도 세워진
   *   마법진이 캐릭터보다 앞으로 나올 수 있다 (사용자: 「빙한 마법진은 **아직도
   *   위에 표시**되는 것 같아」).
   *
   *   `world` 평면의 법선 방향으로 2px 내리면 바닥에 깔린 그림이 지면 속으로 살짝
   *   들어가는 셈이라, 지면 **위에 선** 캐릭터보다 언제나 뒤가 된다. 2px 는 기울기가
   *   걸려도 화면에서 1px 이 안 되므로 배치는 그대로다.
   *   (`markLayer` 는 눕혀 있어 이 처리가 필요 없었다 — 세운 것만의 문제다.) */
  /* ★★★ **`transform-style: flat`** 이 핵심이다 — 3D 교차에서 통째로 빼낸다.
   *
   *   `preserve-3d` 로 두면 브라우저가 **요소 단위가 아니라 3D 교차**로 그린다.
   *   눕힌 마법진이라도 평면 위 각 점의 카메라 거리가 다르므로, **앞쪽 절반은
   *   캐릭터보다 카메라에 가까워** 캐릭터를 가린다. DOM 순서도 `translateZ` 도
   *   이걸 못 이긴다 (사용자: 「빙한 마법진도 캐릭터 위에 그려져」).
   *
   *   `flat` 이면 이 레이어의 자식들은 3D 공간에 개별 참여하지 않고 레이어 평면에
   *   그려진 뒤 **한 장으로 합성**된다. 그 한 장이 `world` 의 z = −2 평면에 놓이므로
   *   `spriteLayer` 의 세운 유닛들보다 **언제나 뒤**다. `world` 의 기울기·회전은
   *   부모에서 이미 걸려 있어 그대로 따라간다. */
  /* ★ `translateZ` 를 쓰면 안 된다 — 뒤로 밀면 **바닥 타일(`g2-floorlayer`)보다도
   *   뒤**로 가서 아예 안 보인다(사용자: 「마법진과 불타원이 안 나와」).
   *   `flat` 이라 이 레이어는 z = 0 평면 한 장이고, 바닥 타일도 z = 0 이므로
   *   **DOM 순서**가 결정한다:
   *     floorLayer(바닥) → tileLayer → markLayer → **fxUnderLayer**   ← 지면 그룹
   *     그다음 world 의 spriteLayer(유닛)
   *   바닥 **위**, 유닛 **아래** — 정확히 원하는 자리다.
   *
   * ★★★ **지면 그룹(`groundLayer`)에 둔다** — `world` 안이 아니다 (2026-08-17).
   *   사용자 보고: 「화염2 3클 … **이 불장판에 그림자가 또 아까처럼 잘려**」.
   *   `world` 안에 두면 이 평면(z=0)이 세운 그림자의 아랫부분(z<0)을 덮는다.
   *   지면과 성질이 같은 것(눕혀서 유닛 아래)은 전부 지면 그룹으로 모은다. */
  this.fxUnderLayer.style.cssText = 'position:absolute;transform-style:flat;';

  this.unitLayer = this.spriteLayer;

  /* 이펙트 (js/fx.js). 유닛과 같은 방식으로 **세웁니다** — 앞뒤 가림이 유닛과 맞습니다. */
  this.fxLayer = el('div', '', this.world);
  this.fxLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';
  this.fxEls = [];
  /* 위층 이펙트 자산 소유자가 attach 때 넣는 읽기 포트. 독립 렌더러는 null이다. */
  this._이펙트시트정보읽기 = null;

  /* 화면 흔들림 0x2C863 — 좌표 변환 0x10971/0x10988 이 [0x7001C]/[0xBA838] 을 더하는 것과
   * 같은 자리입니다. 원본은 맵·유닛·이펙트를 통째로 밀므로 여기서도 world 를 밉니다. */
  this.shake = { x: 0, y: 0 };

  this.objEls = [];
  this.unitEls = {};
  this._hidden = {};              // 연출이 잠시 지운 유닛 (hideUnit)
  this._dying = {};               // 사망 연출이 도는 동안 (dyingUnit)
  /* ★ 턴 마커 아이콘을 되찾는다 — 셸에서 R 이 다시 만들어져도 마커가 살아 있게 (2026-08-24) */
  this._etc = root.__G2_ETC_ICONS || null;
  /* ★ 이동 화살표(MOVE.CUR)도 같이 되찾는다 — 재생성 때 날아가던 것 (2026-08-25) */
  if (root.__G2_CURSORS && root.__G2_CURSORS.move) this.MOVECUR = root.__G2_CURSORS.move;
  this.marks = [];

  /* ★ 선로드분이 있으면 **유닛을 만들기 전에** 심는다 (2026-08-16) */
  if (Renderer._표 && !this._sprNames) this._sprNames = Renderer._표;
  if (Renderer._선raw) {
    this._usprRaw = this._usprRaw || {};
    var _r = Renderer._선raw;
    for (var _f in _r) if (!this._usprRaw[_f]) this._usprRaw[_f] = _r[_f];
  }
  if (Renderer._선swing) {
    this._usprSwing = this._usprSwing || {};
    var _sw = Renderer._선swing;
    for (var _sf in _sw) if (!this._usprSwing[_sf]) this._usprSwing[_sf] = _sw[_sf];
  }
  this._유닛상자전체짓기();
  this.center(battle.units[0] ? battle.units[0].x : 0,
              battle.units[0] ? battle.units[0].y : 0);
  this.apply();
  this._원본맵초기화();           /* 원본 .MAP 직독으로 바닥·오브젝트 채움 (비동기) */
}

/** 현재 전투 세션의 다음 프레임. 세션 종료 시 거부되어 늦은 카메라 쓰기를 막는다. */
Renderer.prototype._다음프레임 = function () {
  var s = this._시간원찾기 && this._시간원찾기();
  if (s && typeof s.다음프레임 === 'function') return s.다음프레임();
  return new Promise(function (ok) {
    if (root && typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(ok);
    else setTimeout(function () { ok(Date.now()); }, 16);
  });
};

/** 세션 시간원으로 다음 렌더 프레임 콜백을 예약한다. */
Renderer.prototype._raf예약 = function (fn) {
  var s = this._시간원찾기 && this._시간원찾기();
  if (s && typeof s.raf === 'function') return { 세션: s, 손잡이: s.raf(fn) };
  return { 세션: null, 손잡이: root.requestAnimationFrame(fn) };
};

/** 세션 시간원으로 반복 콜백을 예약한다. */
Renderer.prototype._반복예약 = function (fn, ms) {
  var s = this._시간원찾기 && this._시간원찾기();
  if (s && typeof s.interval === 'function') return { 세션: s, 손잡이: s.interval(fn, ms) };
  return { 세션: null, 손잡이: setInterval(fn, ms) };
};

/** 세션 시간원에 등록한 반복 콜백을 취소한다. */
Renderer.prototype._반복취소 = function (예약) {
  if (!예약 || !예약.손잡이) return false;
  if (예약.세션 && typeof 예약.세션.interval취소 === 'function')
    return 예약.세션.interval취소(예약.손잡이);
  clearInterval(예약.손잡이);
  return true;
};

/** 세션 시간원으로 지연 콜백을 예약한다. */
Renderer.prototype._시간예약 = function (fn, ms) {
  var s = this._시간원찾기 && this._시간원찾기();
  if (s && typeof s.timeout === 'function') return { 세션: s, 손잡이: s.timeout(fn, ms) };
  return { 세션: null, 손잡이: setTimeout(fn, ms) };
};

/** 세션 시간원에 등록한 지연 콜백을 취소한다. */
Renderer.prototype._시간취소 = function (예약) {
  if (!예약 || !예약.손잡이) return false;
  if (예약.세션 && typeof 예약.세션.timeout취소 === 'function')
    return 예약.세션.timeout취소(예약.손잡이);
  clearTimeout(예약.손잡이);
  return true;
};

/** 현재 전투가 소유하는 fetch. 독립 시험·전투 밖 예열에서는 브라우저 fetch를 쓴다. */
Renderer.prototype._가져오기 = function (입력, 설정) {
  var s = this._시간원찾기 && this._시간원찾기();
  if (s && typeof s.가져오기 === 'function') return s.가져오기(입력, 설정);
  return root.fetch(입력, 설정);
};

/** 세션 도중 생긴 짧은 연출의 복구 함수를 보관한다. 반환 함수는 정상 종료 때 등록만 해제한다. */
Renderer.prototype._종료정리등록 = function (정리) {
  var 목록 = this._세션종료정리 || (this._세션종료정리 = []);
  목록.push(정리);
  return function () {
    var i = 목록.indexOf(정리);
    if (i >= 0) 목록.splice(i, 1);
  };
};

/** 전투 퇴장 경계. 예약 콜백은 세션이 취소하고, 기다리는 호출자는 여기서 풀어 준다. */
Renderer.prototype.세션정리 = function () {
  this._렌더러폐기됨 = true;
  this.map3D건물진단();
  if (root.G2Map3DUAuthoringDraft &&
      typeof root.G2Map3DUAuthoringDraft.onMapChanged === 'function') {
    try { root.G2Map3DUAuthoringDraft.onMapChanged(this, 'session-ended'); }
    catch (_) {}
  }
  var mapLoadAbort = this._mapPrivateLoadAbort;
  this._mapPrivateLoadAbort = null;
  if (mapLoadAbort) mapLoadAbort.abort();
  /* ★ 유닛 GPU 판(유닛공급자)도 그래픽 카드에서 비운다 (2026-10-06) */
  var 바들G = this._유닛바탕, GG = root.G2PaletteGPU;
  if (바들G && GG) Object.keys(바들G).forEach(function (f) {
    var 판들 = 바들G[f] && 바들G[f].판;
    if (판들) Object.keys(판들).forEach(function (k) { if (판들[k]) GG.버리기(판들[k]); });
  });
  this._유닛바탕 = null;
  this._centerToken = (this._centerToken | 0) + 1;
  this._camAnim = false;
  this._camScrolling = false;
  this._camTo = null;
  if (this.shake) this.shake.y = 0;
  if (this._effcTimer) { this._반복취소(this._effcTimer); this._effcTimer = null; }
  if (this._refreshT) { this._시간취소(this._refreshT); this._refreshT = null; }
  if (this._rebuildT) { this._시간취소(this._rebuildT); this._rebuildT = null; }
  var 재시도들 = (this._자산재시도 || []).splice(0);
  for (var j = 0; j < 재시도들.length; j++) this._시간취소(재시도들[j]);
  var 정리들 = (this._세션종료정리 || []).splice(0);
  for (var i = 0; i < 정리들.length; i++) {
    try { 정리들[i](); } catch (e) { console.error('[렌더러] 세션 종료 정리 실패', e); }
  }
  if (typeof this._카메라대기해제 === 'function') this._카메라대기해제();
};

/** 원본 .MAP 직독 로드 — 팔레트+맵+MAPX 를 원본에서 받아 바닥·오브젝트 구성.
 *  ★ 추출 PNG 를 쓰지 않는다. 실패하면 맵이 비지만 원본 외 소스로 폴백하지 않는다. */
Renderer.prototype._원본맵초기화 = function () {
  if (this._렌더러폐기됨) return;
  var self = this;
  if (!root.G2Native) { console.error('[맵] G2Native 없음 — 원본 맵 직독 불가'); return; }
  this._스프라이트표불러오기();     /* 스프라이트 파일명 표도 원본 EXE 에서 */
  var scene = (root.G2 && root.G2.scene) || {};
  var mapFile = scene['맵파일'] || 'FR08.MAP';
  var base = mapFile.replace(/\.[Mm][Aa][Pp]$/, '');
  async function grab(p, init) { var r = await self._가져오기(p, init); if (!r.ok) throw new Error(p + ' ' + r.status); return new Uint8Array(await r.arrayBuffer()); }
  /* ★ 맵 짓기 약속을 쥔다 — 전투 부팅이 로딩 화면을 걷기 «전»에 기다린다 (battle_boot.js 맵기다리기)
   *   2026-10-06 사장님 「전투 화면에서도 로딩할때 오브젝트같은게 늦게 그려지는경우가 있어 … 맵이 떴을때는 완전한 상태로 떠야해」
   *   실측(1-2): 로딩을 걷은 순간 #view 요소 346 → 0.15초 뒤 739 — 맵·오브젝트가 걷은 뒤에 지어졌다. */
  var mapLoading;
  var 맵이름표 = base;   /* 맵 짓기 약속의 맵 이름 — 전투 부팅이 «앞 전투의 옛 약속»인지 맵 이름으로 가린다 (battle_boot 새맵과3D · 10-27) */
  this._원본맵약속 = mapLoading = (async function () {
    var privateMapPrepared = null;
    function staleMapLoad() {
      if (self._원본맵약속 === mapLoading && !self._렌더러폐기됨) return false;
      if (privateMapPrepared) {
        var stalePrivateMap = privateMapPrepared;
        privateMapPrepared = null;
        try { Promise.resolve(stalePrivateMap.revokeAndRelease('map-load-replaced'))
          .catch(function () {}); } catch (_) {}
      }
      return true;
    }
    try {
      var privateProofRequested = root.G2_MAP3D_U_PRIVATE_MAP_PROOF === true &&
        typeof root.AbortController === 'function';
      var oldPrivateLoadAbort = self._mapPrivateLoadAbort;
      /* 일반 MAP 읽기도 같은 요청의 교체 신호로 취소한다. U 증명은 여전히 기본 off다. */
      var privateLoadAbort = typeof root.AbortController === 'function'
        ? new root.AbortController() : null;
      self._mapPrivateLoadAbort = privateLoadAbort;
      if (oldPrivateLoadAbort) oldPrivateLoadAbort.abort();
      if (self._mapPrivateHandle) {
        var replacedPrivateHandle = self._mapPrivateHandle;
        self._mapPrivateHandle = null;
        self._mapPrivateMapHandoff = null;
        self._mapPrivateMapCompletion = null;
        if (self._mapUPublishGate) self._mapUPublishGate.revoke();
        try { Promise.resolve(replacedPrivateHandle.revokeAndRelease('map-replaced'))
          .catch(function () {}); } catch (_) {}
      }
      var paletteRead = grab(G2URL('GENESIS.PAL'),
        privateLoadAbort ? { signal: privateLoadAbort.signal } : undefined);
      var paletteBytes;
      if (privateLoadAbort) {
        var abortPalette;
        var paletteCanceled = new Promise(function (resolve) {
          abortPalette = function () { resolve(null); };
          if (privateLoadAbort.signal.aborted) abortPalette();
          else privateLoadAbort.signal.addEventListener('abort', abortPalette, { once: true });
        });
        try { paletteBytes = await Promise.race([paletteRead, paletteCanceled]); }
        finally { privateLoadAbort.signal.removeEventListener('abort', abortPalette); }
        if (paletteBytes === null) return;
      } else paletteBytes = await paletteRead;
      var pal = root.G2Native.decodePalette(paletteBytes);
      if (staleMapLoad()) return;
      /* MAP U 식별은 화면에 실제로 넘긴 바로 그 바이트의 hash를 함께 보관한다.
       * 식별 정보가 없더라도 기존 2.5D MAP 표시는 그대로 진행한다. */
      var mapInput;
      var privateMapVerified = false;
        if (privateProofRequested && root.G2Source &&
            root.G2Map3DUPrivateControlSocketFactory) {
          try {
            var manifestRead = root.G2Source.manifest(true,
              { signal: privateLoadAbort.signal,
                headers: { 'X-G2-Map3D-U-Local-Proof': '1' } });
            var abortManifest;
            var manifestCanceled = new Promise(function (resolve) {
              abortManifest = function () { resolve(null); };
              if (privateLoadAbort.signal.aborted) abortManifest();
              else privateLoadAbort.signal.addEventListener('abort', abortManifest,
                { once: true });
            });
            var manifest;
            try { manifest = await Promise.race([manifestRead, manifestCanceled]); }
            finally { privateLoadAbort.signal.removeEventListener('abort', abortManifest); }
            if (privateLoadAbort.signal.aborted || staleMapLoad()) return;
            var generation = manifest && manifest.sourceGeneration;
           if (Number.isSafeInteger(generation) && generation >= 1)
             privateMapPrepared = await root.G2Map3DUPrivateControlSocketFactory
               .prepareBeforeMap({ source: root.G2Source,
                 sourceGeneration: generation,
                 signal: privateLoadAbort.signal });
         } catch (_) { privateMapPrepared = null; }
       }
      if (staleMapLoad()) return;
      if (root.G2Source && typeof root.G2Source.readMapIdentity === 'function') {
        var mapReadOptions = {
          fetcher: function (u, init) { return self._가져오기(u, init); }
        };
       if (privateMapPrepared) {
         try {
           mapInput = await privateMapPrepared.readMapIdentity(
             'SCENARIO/' + mapFile, mapReadOptions);
         } catch (_) { mapInput = null; }
         if (!mapInput) {
           var failedPrivateMap = privateMapPrepared;
           privateMapPrepared = null;
           try { Promise.resolve(failedPrivateMap.revokeAndRelease(
             'pre-map-read-failed')).catch(function () {}); }
           catch (_) {}
         }
       }
        privateMapVerified = !!mapInput;
          if (!mapInput) {
            if (staleMapLoad()) return;
            var fallbackOptions = privateLoadAbort
              ? { fetcher: mapReadOptions.fetcher,
                  fetchInit: { signal: privateLoadAbort.signal } }
              : mapReadOptions;
            var fallbackRead = root.G2Source.readMapIdentity(
              'SCENARIO/' + mapFile, fallbackOptions);
            if (privateLoadAbort) {
              var abortFallback;
              var fallbackCanceled = new Promise(function (resolve) {
                abortFallback = function () { resolve(null); };
                if (privateLoadAbort.signal.aborted) abortFallback();
                else privateLoadAbort.signal.addEventListener('abort', abortFallback,
                  { once: true });
              });
              try { mapInput = await Promise.race([fallbackRead, fallbackCanceled]); }
              finally { privateLoadAbort.signal.removeEventListener('abort', abortFallback); }
            } else mapInput = await fallbackRead;
          }
      } else {
        var directRead = grab(G2URL('SCENARIO/' + mapFile),
          privateLoadAbort ? { signal: privateLoadAbort.signal } : undefined);
        var directBytes;
        if (privateLoadAbort) {
          var abortDirect;
          var directCanceled = new Promise(function (resolve) {
            abortDirect = function () { resolve(null); };
            if (privateLoadAbort.signal.aborted) abortDirect();
            else privateLoadAbort.signal.addEventListener('abort', abortDirect, { once: true });
          });
          try { directBytes = await Promise.race([directRead, directCanceled]); }
          finally { privateLoadAbort.signal.removeEventListener('abort', abortDirect); }
          if (directBytes === null) return;
        } else directBytes = await directRead;
        mapInput = { bytes: directBytes, meta: null };
      }
      if (staleMapLoad()) return;
      var map = root.G2Native.decodeMAP(mapInput.bytes, pal);
      map._mapLeaseEpoch = mapInput.meta && mapInput.meta.mapLeaseEpoch;
      map._sourceIdentity = mapInput.meta && mapInput.meta.identityStatus === 'ready' &&
        (!privateProofRequested || privateMapVerified &&
          mapInput.meta.mapResponseId)
        ? Object.freeze({ actualRelativePath: mapInput.meta.actualRelativePath,
          contentHash: mapInput.meta.contentHash,
          sourceGeneration: mapInput.meta.sourceGenerationToken,
          mapLeaseEpoch: mapInput.meta.mapLeaseEpoch,
          mapResponseId: mapInput.meta.mapResponseId,
          role: mapInput.meta.role, mode: mapInput.meta.mode,
          selectionPolicyId: mapInput.meta.selectionPolicyId }) : null;
      map._privateMapPrepared = privateMapPrepared;
      self._FR08나무맵기억(map, base);
      /* SCE op 0x71 은 전투 도중 날씨를 다시 바꾼다. 변조된 팔레트만 남기면
       * 0(해제)이나 다른 날씨로 갈 때 누적 변조가 되므로 MAP 색까지 합쳐진
       * 무날씨 바탕을 별도로 보존한다. */
      map._날씨바탕팔레트 = new Uint8Array(map.palette);
      /* ★★★★★ **날씨가 걸리면 원본은 팔레트를 바꾼다** (2026-09-06 · 실측 확정)
       *
       *   원본 활성 팔레트(`0x12824C`)를 전투 중에 읽어 `GENESIS.PAL` 과 세웠더니
       *   날씨마다 **다른 변환**이 걸려 있었다. 우리는 파일 값을 그대로 써서
       *   화면이 **약 1.27배 밝았다**(비·눈 기준).
       *
       *   ★ 맵 구간(색인 104~255)도 똑같이 변환된다 — 같은 맵에 날씨만 다른 짝으로
       *     확인했다(`R01.MAP` `12-6`↔`2-6` **768/768** · `DES03.MA` `16-1`↔`15-2` **768/768**).
       *     그래서 `decodeMAP` **뒤에** 건다 — 맵이 채운 104~255 까지 함께 바꿔야 한다.
       *
       *   식과 근거 — `03_분석/표/json/날씨_팔레트변환.json` · `native.js 날씨팔레트()`
       *   ☠ 아직 **맵 팔레트만**이다. 원본은 DAC 전체를 바꾸므로 스프라이트·UI 도
       *     같이 어두워져야 한다. 그쪽은 화면으로 확인한 뒤 넓힌다. */
      var _날씨 = (scene['날씨'] | 0);
      if (_날씨 >= 1 && _날씨 <= 4 && root.G2Native.날씨팔레트) {
        map.palette = root.G2Native.날씨팔레트(map._날씨바탕팔레트, _날씨);
        console.log('[맵] 날씨 팔레트 변환:', _날씨,
                    ['-', '비', '눈', '모래바람', '안개'][_날씨]);
      }
      /* ★ mapx(2.5D 확장)는 **맵과 같은 자리** — `SCENARIO/<맵>.mapx.json` 이 정본이다
       *   (2026-08-17 · 231개 전수 생성). 예전에 적용 폴더 **루트**에 두던 것도
       *   계속 읽어 준다 — 손으로 만든 것이 거기 남아 있을 수 있다. */
      var mapx = null;
      for (var 후보 of [G2URL('SCENARIO/' + base + '.mapx.json'), G2URL(base + '.mapx.json')]) {
        try {
          var mapxRead = (async function () {
            var mr = await self._가져오기(후보,
              privateLoadAbort ? { signal: privateLoadAbort.signal } : undefined);
            return mr.ok ? { found: true, value: await mr.json() } : { found: false };
          })();
          var mapxResult;
          if (privateLoadAbort) {
            var abortMapx;
            var mapxCanceled = new Promise(function (resolve) {
              abortMapx = function () { resolve(null); };
              if (privateLoadAbort.signal.aborted) abortMapx();
              else privateLoadAbort.signal.addEventListener('abort', abortMapx, { once: true });
            });
            try { mapxResult = await Promise.race([mapxRead, mapxCanceled]); }
            finally { privateLoadAbort.signal.removeEventListener('abort', abortMapx); }
            if (mapxResult === null) return;
          } else mapxResult = await mapxRead;
          if (mapxResult.found) { mapx = mapxResult.value; break; }
        } catch (e) { if (staleMapLoad()) return; }
      }
      /* ★ 오브젝트 묶음 표 — 모든 맵 공통 · 한 번만 받는다 (2026-10-03 · `04_도구/오브젝트틀_전수.js` 가 굽는다)
       *   못 받으면 예전 나무 표(나무윤곽틀·나무자동틀)로 돈다 */
      if (root.G2오브젝트묶음틀 === undefined) {
        root.G2오브젝트묶음틀 = null;
        try {
          var templateRead = (async function () {
            var tr = await self._가져오기(G2URL('오브젝트묶음틀.json'),
              privateLoadAbort ? { signal: privateLoadAbort.signal } : undefined);
            return tr.ok ? { found: true, value: await tr.json() } : { found: false };
          })();
          var templateResult;
          if (privateLoadAbort) {
            var abortTemplate;
            var templateCanceled = new Promise(function (resolve) {
              abortTemplate = function () { resolve(null); };
              if (privateLoadAbort.signal.aborted) abortTemplate();
              else privateLoadAbort.signal.addEventListener('abort', abortTemplate,
                { once: true });
            });
            try { templateResult = await Promise.race([templateRead, templateCanceled]); }
            finally { privateLoadAbort.signal.removeEventListener('abort', abortTemplate); }
            if (templateResult === null) return;
          } else templateResult = await templateRead;
          if (staleMapLoad()) return;
          if (templateResult.found) root.G2오브젝트묶음틀 = templateResult.value;
        } catch (e틀) { if (staleMapLoad()) return; }
      }
      /* ★★★★★ 사장님 손 분류(지면화 도구 · `06_패치/적용/블록분류.json`) — 한 번만 받는다 (2026-10-04)
       *   사장님: 「지금 맵에 이상하게 세워져있는 오브젝트가(난 분명히 눕혔는데) 있고」 · 선택 「연결만 하기」
       *   `_원본오브젝트분류` ① 단계가 `G2블록분류` 를 맨 앞에서 보는데, 그 값을 넣는 곳이 지면화 도구 화면뿐이었다 —
       *   게임 전투는 한 번도 안 읽어 손으로 눕힌 조각 4,092(31맵)가 서고 세운 조각 5,803 이 누웠다.
       *   서버 `GET /__블록분류` (server.js) = 지면화 도구가 저장하는 그 파일. 못 받으면 예전처럼 mapx 로 돈다. */
      if (root.G2블록분류 === undefined) {
        root.G2블록분류 = null;
        try {
          var blockRead = (async function () {
            var br = await self._가져오기('/__블록분류',
              privateLoadAbort ? { signal: privateLoadAbort.signal } : undefined);
            return br.ok ? { found: true, value: await br.json() } : { found: false };
          })();
          var blockResult;
          if (privateLoadAbort) {
            var abortBlock;
            var blockCanceled = new Promise(function (resolve) {
              abortBlock = function () { resolve(null); };
              if (privateLoadAbort.signal.aborted) abortBlock();
              else privateLoadAbort.signal.addEventListener('abort', abortBlock, { once: true });
            });
            try { blockResult = await Promise.race([blockRead, blockCanceled]); }
            finally { privateLoadAbort.signal.removeEventListener('abort', abortBlock); }
            if (blockResult === null) return;
          } else blockResult = await blockRead;
          if (staleMapLoad()) return;
          if (blockResult.found) {
            var bj = blockResult.value;
            /* 저장된 지정을 «그대로» 쓴다 — 눕힘·세움 둘 다. 지면화 도구 화면과 같아야 한다
             *   (2026-10-04 사장님 「지금 저장되어있는 데이터 자체를 기본으로 두면 되는거잖아」 · 「돌려」 —
             *    잠깐 넣었던 «눕힘만 받기» 거르기를 걷었다) */
            root.G2블록분류 = (bj && bj.분류) || null;
            /* 묶음 지정 — 지면화 도구에서 사장님이 묶음째 세움/눕힘으로 정한 것 (2026-10-18) · _오브젝트묶음찾기 가 읽는다 */
            root.G2묶음지정 = (bj && bj.묶음) || null;
          }
        } catch (e분류) { if (staleMapLoad()) return; }
      }
      /* ★★★ 전투 **진입**에서는 단계마다 프레임을 양보한다 (2026-08-28).
       *   한 덩어리로 돌면 400ms 넘게 메인 스레드를 잡아 로딩 화면이 **멈춘 채**
       *   있는다 — 사용자가 말한 「시나리오 시작시 잠시 멈추는 듯한 딜레이」다.
       *   여기는 이미 `async` 안이라 기다려도 부팅 흐름이 바뀌지 않는다. */
      if (staleMapLoad()) return;
      await self.useNativeMap비동기(map, mapx, function (이름) {
        try { if (root.G2전투로딩 && root.G2전투로딩.한칸) root.G2전투로딩.한칸(이름); } catch (e칸) {}
      }, function () { return self._원본맵약속 === mapLoading; },
      privateLoadAbort && privateLoadAbort.signal);
      /* ★ 리마스터 3D 맵 (이식 1단계 · 2026-10-18 사장님 「그릭은 이식해도 돼」) — 허락된 맵·스위치 켬일 때만 · 기본 꺼짐 (js/리마스터3D.js) */
      if (!staleMapLoad() && root.G2리마스터3D) root.G2리마스터3D.맵준비(self, base, mapx).catch(function (e3d) { console.warn('[리마스터3D]', e3d); });
       /* 검증 중인 MAPX 건물/지형은 본화면에서 기본 표시하지 않는다.
        * 명시 ?map3dBuildings=0/90 비교에서만 기존 거래 관문을 사용한다. */
       if (!staleMapLoad() && root.location &&
           /\/게임\.html$/.test(decodeURIComponent(root.location.pathname || '')) &&
           mapx && mapx.building3d && mapx.building3d.entries) {
         var buildingAngle = new URLSearchParams(root.location.search).get('map3dBuildings');
          var greekDesignated = /^GREEK\.MAP$/i.test(mapx.sourceMap || '') &&
            !!mapx.building3d.designatedLayout && !!mapx.terrain3d;
           if (buildingAngle === null) buildingAngle = 'off';
         if (buildingAngle === '0' || buildingAngle === '90') {
           var buildingHandle = greekDesignated
             ? self.map3D지정전체미리보기() : self.map3D맵X건물전체미리보기();
           if (buildingHandle.displayAllowed && buildingHandle.isCurrent()) {
             self.cam.rot = Number(buildingAngle);
             if (greekDesignated && self.cam.tilt === 0) self.cam.tilt = 55;
             self.apply();
           }
         }
       }
      console.log('[맵] 원본 직독:', mapFile, map.W + '×' + map.H,
                  '오브젝트', root.G2Native.mapObjects(map).length, mapx ? '(MAPX)' : '');
    } catch (e) {
      if (privateMapPrepared)
        privateMapPrepared.revokeAndRelease('map-load-failed').catch(function () {});
      console.error('[맵] 원본 직독 실패:', e && e.message);
    }
  })();
  try { mapLoading._맵 = 맵이름표; } catch (e표) {}
};

/* ── 바닥 격자 ────────────────────────────────────────────────────────── */
Renderer.prototype.TILEBLK = 256;     // 조각 한 변 (픽셀). 작을수록 안전, 요소는 늘어남

/* ★ 추출 자산으로 바닥·오브젝트를 짓던 `_buildFloor` / `_buildObjects` 는
 *   지웠습니다 (할일 19-d). `map.png` · `map_blocks/*` 를 읽던 유일한 자리였고,
 *   `useNativeMap` 이 부르는 `_buildFloorNative` / `_buildObjectsNative` 가
 *   원본 `.MAP` 에서 같은 일을 한 지 오래라 **아무도 안 부르는 코드**였습니다. */

Renderer.prototype.fixObjectOrigin = function () { this.apply(); };

/* ══════════════════════════════════════════════════════════════════════
 * 원본 .MAP 직독 렌더 (추출 map.png / map_blocks 대체)
 *   G2Native.decodeMAP 결과를 받아 바닥·오브젝트를 원본 데이터로 다시 짓는다.
 *   눕힘/세움 구분: MAPX(blocks/flatBlocks) → 높이 → 기본. (FR08.mapx.json)
 * ════════════════════════════════════════════════════════════════════ */
/** 블록 index → data-URL (decodeBlock → 캔버스). 블록당 1회 캐시(913배치, 154블록). */
Renderer.prototype._블록그림URL = function (bi) {
  this._blkCache = this._blkCache || {};
  if (this._blkCache[bi] !== undefined) return this._blkCache[bi];
  var fr = this.nmap.decodeBlock(bi), url = null;
  var _블바 = fr ? root.G2Native.frameToCanvas(fr, this.nmap.palette) : null;
  if (_블바) url = _블바.toDataURL();
  /* 팔레트 GPU 판의 바탕 — 바탕 팔레트(연출·음영이 안 걸린 때)로 처음 만든 것만 쥔다 */
  if (_블바 && !this._palSaved && !this._음영바탕 && root.G2Scaler && root.G2Scaler.N() > 1) {
    if (this.nmap._블록바탕필터 !== root.G2Scaler.cur()) { this.nmap._블록바탕 = {}; this.nmap._블록바탕필터 = root.G2Scaler.cur(); }   /* 옛 필터 바탕은 버린다 */
    var _블표 = this.nmap._블록바탕 || (this.nmap._블록바탕 = {}), _블키 = root.G2Scaler.cur() + '|' + bi;
    if (!_블표[_블키]) _블표[_블키] = { cv: _블바, pal: this.nmap.palette, 필터: root.G2Scaler.cur() };
  }
  this._blkCache[bi] = url;
  /* 팔레트만 바뀔 때 요소를 다시 짓지 않고 색만 옮겨 칠하려고 URL → 블록 번호·크기를 기억한다 (2026-09-25 Z-47) */
  if (url && fr) { (this._블록URL역 || (this._블록URL역 = {}))[url] = { bi: bi, w: fr.w, h: fr.h }; }
  return url;
};
/** [리마스터] 세워 그릴 조각 그림 — 용자의 무덤 가시면 «바닥과 같은 점»을 뺀 그림, 아니면 블록 그림 그대로 (2026-10-12)
 *   사장님(원문) 「아니야 그럼 그냥 세우고 지금 타일 하이라이트만 잘 지정되면 돼. 특히 세웠을때 원래 바닥에 해당하는 부분은 제외하고 순수 가시만 세우면 좋겠어.」
 *   무덤 가시 블록(24×32)은 가시 둘레에 그 자리 바닥 그림이 함께 들어 있다(TOMB03 실측: 그림 점 419 중 160 이 바로 밑 바닥과 같은 색 번호).
 *   세우면 그 바닥까지 서서 칸 표식(이동·배치)을 덮었다 ⇒ 바닥 그림(mapGround)과 같은 점은 투명으로 — 바닥은 바닥 판에 이미 있다.
 *   같은 가림끼리 그림 한 장(가림 열쇠) · 팔레트만 바뀔 때도 가린 채로 칠한다(_오브젝트색칠하기 · 표.가림키) */
Renderer.prototype._세움그림URL = function (o) {
  if (!o || !this._무덤가시블록표()[o.blockIndex]) return this._블록그림URL(o.blockIndex);
  var m = this.nmap, NN = root.G2Native, fr = o.frame;
  try {
    if (!this._가시바닥 || this._가시바닥.맵 !== m) this._가시바닥 = { 맵: m, g: NN.mapGround(m, 0), 판: {} };
    var g = this._가시바닥.g, GW = g.w, GH = g.h, px = o.x * TW, py = o.y * TH + TH - fr.h;
    var idx = new Int16Array(fr.idx.length), 키 = [o.blockIndex], 뺀 = 0;
    for (var y = 0; y < fr.h; y++) for (var x = 0; x < fr.w; x++) {
      var i = y * fr.w + x, v = fr.idx[i]; idx[i] = v;
      if (v < 0) continue;
      var gx = px + x, gy = py + y;
      if (gx >= 0 && gy >= 0 && gx < GW && gy < GH && g.idx[gy * GW + gx] === v) { idx[i] = -1; 키.push(i); 뺀++; }
    }
    if (!뺀) return this._블록그림URL(o.blockIndex);
    var k = 키.join(','), 판 = this._가시바닥.판;
    if (판[k]) return 판[k].url;
    var f2 = {}; for (var p in fr) f2[p] = fr[p]; f2.idx = idx;
    var url = NN.frameToCanvas(f2, m.palette).toDataURL();
    판[k] = { url: url, fr: f2 };
    (this._블록URL역 || (this._블록URL역 = {}))[url] = { bi: o.blockIndex, w: fr.w, h: fr.h, 가림키: k };
    return url;
  } catch (e) { return this._블록그림URL(o.blockIndex); }
};
/** 팔레트만 바뀔 때 — 블록 배경을 가진 오브젝트 요소마다 자식 캔버스에 새 팔레트의 블록 그림을 옮긴다. 옮긴 수를 돌려준다(0 이면 다시 짓기로) */
Renderer.prototype._오브젝트색칠하기 = function (pal) {
  var 역 = this._블록URL역; if (!역 || !this.nmap) return 0;
  var self = this, 판 = {}, n = 0, 바탕 = this._palSaved || this._음영바탕 || pal, 맵 = this.nmap;
  var 확대 = !!(root.G2Scaler && root.G2Scaler.N() > 1);
  function 블록판(bi) {
    if (판[bi] !== undefined) return 판[bi];
    /* 스케일러면 판을 맵 객체에 블록 번호로 쥐고 색 차이만 얹는다(맵이 바뀌면 판도 새로) */
    var 블바 = 맵._블록바탕 && root.G2Scaler && 맵._블록바탕[root.G2Scaler.cur() + '|' + bi];
    return (판[bi] = 팔레트그림(맵, 'b' + bi, function () { return 맵.decodeBlock(bi); }, pal, 바탕, 블바));
  }
  [this.objLayer, this.flatObjLayer, this.backdropEl].forEach(function (층) {
    if (!층 || !층.querySelectorAll) return;
    /* ☠ 나무·수풀은 스트립 안의 span 조각이다 — div 만 고르면 나무만 옛 색으로 남는다(2026-09-25 사장님 다크존·힐윈드·파워썬더 사진) */
    var els = 층.querySelectorAll('div,span');
    for (var i = 0; i < els.length; i++) {
      /* 표는 붙들지 않고 늘 지금 배경에서 찾는다 — 오브젝트 애니(fx.js)가 배경을 갈아 끼운다 */
      var e = els[i], bg, u, 표;
      /* ★ 한 번 찾은 것은 요소에 기억한다 — 배경 주소는 data URL 이라 걸음마다 읽으면 2-4A 에서 1570개 · 28.6MB · 53ms 였다 (2026-09-26 · Z-72)
       *   배경을 바꾸는 곳은 fx.js 오브젝트 애니 하나다 — 거기서 _블록memo 를 비운다 */
      var m = e._블록memo;
      if (m && m.역 === 역) { if (!m.표) continue; u = m.u; 표 = m.표; bg = e._블록캔버스 ? 'none' : m.bg; }
      else {
        bg = e.style && e.style.backgroundImage;
        /* 칠한 캔버스를 얹은 요소는 배경을 감춰 두었다 — 원래 주소는 _블록원url 에 있다 */
        u = (bg && bg.indexOf('url(') === 0) ? bg.slice(4, -1).replace(/^"|"$/g, '') : (bg === 'none' ? e._블록원url : null);
        표 = u ? 역[u] : null;
        e._블록memo = { 역: 역, u: u, 표: 표 || null, bg: (bg === 'none') ? 'none' : 'url' };
        if (!표) continue;
      }
      /* 스케일러면 화면 밖 오브젝트는 들어올 때 칠한다(바닥·행과 같은 까닭 · _밀어두기) — 배경은 그때까지 바탕 그림 그대로 */
      if (확대 && !창안인가(e)) { self._밀어두기(e, { fn: 칠하기.bind(null, e, bg, u, 표) }); n++; continue; }
      if (칠하기(e, bg, u, 표)) n++;
    }
  });
  function 가림판(표) {                                       /* [리마스터] 무덤 가시 — 바닥 점을 뺀 그림(_세움그림URL) */
    var 키 = 'g' + 표.가림키;
    if (판[키] !== undefined) return 판[키];
    var 쥔 = self._가시바닥 && self._가시바닥.판[표.가림키];
    return (판[키] = 쥔 ? 팔레트그림(맵, 'gb' + 표.가림키, function () { return 쥔.fr; }, pal, 바탕, null) : 블록판(표.bi));
  }
  function 합판(표) {                                         /* [리마스터] 정본 253 — 큰 눕힘 합친 판(_원본맵오브젝트짓기 «큰 눕힘 합치기») · 조각마다 칠하면 이음선이 다시 난다 */
    var 키 = 표.합키;
    if (판[키] !== undefined) return 판[키];
    var 쥔 = self._큰눕힘판 && self._큰눕힘판[키];
    if (!쥔) return (판[키] = 블록판(표.bi));
    var 합바 = 맵._블록바탕 && root.G2Scaler && 맵._블록바탕[root.G2Scaler.cur() + '|' + 키];
    return (판[키] = 팔레트그림(맵, 'h' + 키, function () { return 쥔; }, pal, 바탕, 합바));
  }
  function 칠하기(e, bg, u, 표) {
      var src = 표.가림키 ? 가림판(표) : (표.합키 ? 합판(표) : 블록판(표.bi)); if (!src) return false;
      var c = e._블록캔버스;
      if (c && (c.width !== src.width || c.height !== src.height)) { c.width = src.width; c.height = src.height; c.style.width = 표.w + 'px'; c.style.height = 표.h + 'px'; }
      if (!c) {
        c = e._블록캔버스 = document.createElement('canvas');
        c.width = src.width; c.height = src.height;
        c.style.cssText = 'position:absolute;left:0;top:0;width:' + 표.w + 'px;height:' + 표.h + 'px;image-rendering:' + rend() + ';pointer-events:none;';
        e.insertBefore(c, e.firstChild);
      }
      /* ☠ 밑의 배경 그림(옛 색)을 감춘다 — 스케일러 가장자리는 반투명이라 캔버스 사이로 옛 색이 비쳐 윤곽이 남았다
       *   (2026-09-25 사장님 「지금 오브젝트 실루엣이 남아」) */
      if (bg !== 'none') { e._블록원url = u; e.style.backgroundImage = 'none'; }
      /* ☠ 스케일러는 drawImage 를 가로채 확대 그림을 논리 크기로 줄여 찍는다(scaler.js drawImage 몽키패치) — 3인자로 부르면 왼쪽 위 1/N 만 칠해졌다.
       *   원본 사각형은 논리 좌표로, 목적지는 캔버스 실제 크기로 준다 (2026-09-25 사장님 「스케일러 적용한상태에서 마법 사용시 오브젝트 덮는게 제대로 작동하지 않고」) */
      var g = c.getContext('2d'); g.clearRect(0, 0, c.width, c.height);
      g.drawImage(src, 0, 0, src.논리w || src.width, src.논리h || src.height, 0, 0, c.width, c.height);
      e._밀린칠 = null;                    /* 곧바로 칠했으면 예전에 밀어 둔 칠(옛 팔레트)은 버린다 */
      return true;
  }
  return n;
};
/** 바깥(fx.js 타일 애니메이션)에서 쓰는 창구 — 원본 맵이 아직이면 null. */
/* ★★★ **바닥 타일 한 칸의 그림 URL** (2026-08-16)
 *
 *   바닥 애니(`0x7EBAC`)가 주는 번호는 **레이어A 타일 번호**다 — `blockUrl` 이
 *   받는 **레이어B 블록 번호**와 **다른 표**다. 그걸 섞어 쓰는 바람에
 *   `blockUrl` 이 `null` 을 내고 **폭포가 한 칸도 안 붙었다.**
 *   `native.js mapGround` 가 쓰는 `map.tile(ti)` 와 같은 길이다. */
/* ★ 캐시 항목은 `{cv, _url}` — 주소는 읽을 때 굽는다. 애니 칸(tileCell)은 캔버스를 바로 칠한다
 *   (2026-10-06 · 선라이트 끊김: 팔레트 걸음마다 이 자리 toDataURL 204번 + 애니 84번 — `_유닛프레임정보` 주석과 같은 까닭) */
Renderer.prototype._타일항목 = function (ti) {
  ti = ti | 0;
  var m = this.nmap; if (!m || !m.tile) return null;
  if (ti < 0 || ti >= m.w) return null;
  this._tileURLCache = this._tileURLCache || {};
  if (this._tileURLCache[ti] !== undefined) return this._tileURLCache[ti];
  var t = m.tile(ti);
  if (!t) { this._tileURLCache[ti] = null; return null; }
  /* 바닥 타일은 **값 0 이 투명**이다(`mapGround` 가 `val !== 0` 일 때만 쓴다) */
  var idx = new Int16Array(TW * TH);
  for (var i = 0; i < TW * TH; i++) idx[i] = t[i] ? t[i] : -1;
  var cv = root.G2Native.frameToCanvas({ w: TW, h: TH, idx: idx, tr: null }, m.palette);
  return (this._tileURLCache[ti] = { cv: cv, _url: null });
};
Renderer.prototype.tileUrl = function (ti) {
  var o = this._타일항목(ti);
  return o ? (o._url || (o._url = o.cv.toDataURL())) : null;
};
/** 바닥 타일 한 칸의 캔버스 (주소로 굽지 않는다) — tileCell 이 바로 칠한다 */
Renderer.prototype.tileCanvas = function (ti) {
  var o = this._타일항목(ti);
  return o ? o.cv : null;
};

/** 원본 맵 블록 번호의 직독 그림 URL을 조회한다. */
Renderer.prototype.blockUrl = function (bi) {
  if (!this.nmap) return null;
  try { return this._블록그림URL(bi | 0); } catch (e) { return null; }
};
/** 배경이미지 CSS 조각 — 스케일러가 켜져 있으면 N배 그림을 논리 크기로 눌러 담는다. */
function bgcss(url, w, h) {
  return root.G2Scaler ? root.G2Scaler.bg(url, w, h)
                       : 'background-image:url(' + url + ');background-repeat:no-repeat;';
}
/** 인라인 style 용 확대 보간 방식. */
function rend() { return root.G2Scaler ? root.G2Scaler.rendering() : 'pixelated'; }
/* ══════════════════════════════════════════════════════════════════════
 * 유닛 스프라이트 — 원본 직독 (CLAUDE.md 「원본 직독 아키텍처」)
 *
 * 추출 시트(`자산/units/*.png`)는 **색 0 을 투명으로** 구워서 검정으로 칠한
 * 픽셀이 뚫립니다 — 캐릭터 **눈동자**가 그것입니다(캐릭터당 22~25개,
 * `S_IYOLIN` 프레임0 의 (10,7)(10,8)(13,8) 실측). 원본 NC2 는
 * 「기록 안 된(skip) 픽셀만 투명, 값 0 은 불투명」이라 원본을 직접 읽으면
 * 그대로 살아납니다(`native.js decodeRLE`).
 *
 * ★ 좌표는 **하나도 바뀌지 않습니다.** 추출 메타의 프레임 표(w·h·ax·ay)가
 *   원본 값과 이미 같음을 대조했습니다(KNIGHTW f0 22×22 −10,−9 일치).
 *   바뀌는 것은 **그림 출처뿐**입니다.
 * ════════════════════════════════════════════════════════════════════ */

/** 팔레트 — 맵이 오면 맵 것(104~255 가 맵 고유색), 그 전엔 GENESIS.PAL. */
Renderer.prototype._유닛팔레트 = function () {
  /* ★ 리맵(0x454D5 화면 치환)을 팔레트 축소로 흉내 내는 동안에는 «치환 전» DAC(_dacPal)를 준다 — 원본은 이펙트·시전자·대상을 치환 «뒤»에 그려 원래 밝기다
   *   ☠ 2026-09-26 필살 암전(setPaletteMix …, 40)을 넣은 뒤 nmap.palette 가 어두운 팔레트가 되어, 그 사이 구운 필살 이펙트(fx.js·loadUltNsp)가 모두 어둡게 구워졌다
   *   (사장님 「대부분 필살기 효과가 음영에 다 덮힌다」) · DAC 섞기만 걸린 때(keepPct 없음)는 _dacPal 이 없어 지금 팔레트를 그대로 준다 */
  return this._dacPal || (this.nmap && this.nmap.palette) || this._palette || null;
};

/**
 * 스프라이트 번호 → 파일명. **원본 EXE 의 파일명 표**에서 얻는다.
 * 준비 전에는 추출본 메타(`sprites.json`)의 `파일` 을 임시로 쓴다.
 * (표가 오면 `_refreshUnits()` 로 다시 굽는다)
 */
Renderer.prototype._스프라이트파일 = function (meta, no) {
  var names = this._sprNames;
  if (names && no != null) {
    var i = root.G2Native.spriteIndexOf(no);
    if (i >= 0 && names[i]) return names[i];
  }
  return meta && meta['파일'];      /* 표가 오기 전 임시 */
};

/** COMBAT-PRESENT-001 canonical snapshot. 통합 셸은 부트에서 이미 만들어 둔다. */
function 전투표시정본() {
  var st = root.__G2CombatPresentationDomainStatus;
  return st && st.snapshot && st.snapshot.compatibility ? st.snapshot : null;
}
function 전투표시정본설치(snap) {
  if (!snap || !snap.compatibility || !snap.compatibility.spriteNames) return null;
  Renderer._표 = 이름표바로잡기(snap.compatibility.spriteNames);
  /* 독립 전투 진입에서는 메인 셸의 compatibility install을 거치지 않을 수 있다. */
  try {
    if (root.G2CombatPresentationDomain && root.G2CombatPresentationDomain.installCompatibility)
      root.G2CombatPresentationDomain.installCompatibility(root, snap);
  } catch (e) {}
  return Renderer._표;
}
/** standalone fallback도 SOURCE-001을 통한다. 세션 fetcher를 넣으면 취소 계약도 유지된다. */
function 전투표시정본읽기(fetcher) {
  var D = root.G2CombatPresentationDomain;
  if (root.G2ExeImage && typeof root.G2ExeImage.read === 'function') {
    return root.G2ExeImage.read('COMBATII.EXE', { fetcher: fetcher || root.fetch }).then(function (x) {
      if (!x) throw new Error('COMBATII.EXE 없음');
      var snap = D ? D.decodeImage(x.le, x.meta) : null;
      if (!snap) snap = { compatibility: { spriteNames: root.G2Native.spriteNames(x.le) }, original: {} };
      snap.sourceFile = 'COMBATII.EXE'; snap.sourceSize = x.bytes.length;
      snap.supportedSize = x.bytes.length === 494999;
      root.__G2CombatPresentationDomainStatus = { snapshot: snap, install: null, standalone: true };
      전투표시정본설치(snap);
      return snap;
    });
  }
  /* 옛 독립 진입점 호환. 현대 제품/전투 진입은 위 G2ExeImage 길만 탄다. */
  if (root.G2Source && typeof root.G2Source.read === 'function') {
    return root.G2Source.read('COMBATII.EXE', { fetcher: fetcher || root.fetch }).then(function (r) {
      if (!r) throw new Error('COMBATII.EXE 없음');
      var snap = D ? D.decode(r.bytes, r.meta) : null;
      if (!snap) {
        var le0 = root.G2Native.decodeLE(r.bytes);
        snap = { compatibility: { spriteNames: root.G2Native.spriteNames(le0) }, original: {} };
      }
      root.__G2CombatPresentationDomainStatus = { snapshot: snap, install: null, standalone: true };
      전투표시정본설치(snap);
      return snap;
    });
  }
  return Promise.reject(new Error('COMBATII.EXE source 경계가 없다'));
}

/** COMBATII.EXE 를 읽어 스프라이트 파일명 표를 만든다 (한 번만). */
/** ★★★ **Promise 를 돌려준다** — 유닛 상자를 만들기 **전에** 기다릴 수 있게 (2026-08-16)
 *
 *  이 표(`COMBATII.EXE 0x75AA8`)가 없으면 `_대체스프라이트정보` 가 `null` 을 돌려
 *  **본체(말) 층이 빠진 채** 상자가 굳는다. 전에는 늦게 온 뒤 캐시를 지워
 *  다시 짓게 했는데, 사용자 지적대로 **「나오다 안나오다」** 했다 —
 *  **한 번에 제대로 불러오는 것**이 맞다. `준비()` 로 기다린다. */
Renderer.prototype._스프라이트표불러오기 = function () {
  /* ★ 통합 셸의 COMBAT-PRESENT-001 snapshot을 최우선으로 쓴다. */
  var 정본 = 전투표시정본();
  if (!Renderer._표 && 정본) 전투표시정본설치(정본);
  /* ★ 선로드해 둔 표가 있으면 **즉시** 쓴다 — 첫 `_buildUnits` 부터 폴백이 된다 */
  if (!this._sprNames && Renderer._표) this._sprNames = Renderer._표;
  if (this._sprNames) return Promise.resolve(this._sprNames);
  if (this._sprNamesP) return this._sprNamesP;
  this._sprNamesLoading = true;
  var self = this;
  this._sprNamesP = (async function () {
    try {
      /* 독립 실행기만 여기로 온다. 같은 EXE를 renderer가 직접 다시 해석하지 않는다. */
      var snap = await 전투표시정본읽기(function (u, init) { return self._가져오기(u, init); });
      if (self._렌더러폐기됨) return null;
      var names = snap && snap.compatibility && snap.compatibility.spriteNames;
      if (!names || names.length < 400) throw new Error('표 길이 ' + (names ? names.length : 0));
      self._sprNames = names = 이름표바로잡기(names);
      console.log('[유닛] 스프라이트 파일명 표 정본:', names.length + '개 (0x75AA8)');
      self._uspr = {}; self._uurl = {}; self._footCache = {}; self._effcURL = {};
      self._silCache = {};              // ★ 발광 실루엣도 함께 — 스케일러가 바뀌면 다시 굽는다
      /* ★★★ **층 캐시를 무효화한다** (2026-08-16 · 「이제 몬스터도」)
       *
       *   이 표(`0x75AA8`)가 **비동기로 늦게** 오므로, 그전에 만들어진 상자는
       *   `_대체스프라이트정보` 가 `null` 을 돌려 **층이 모자란 채 굳는다.**
       *   `_layerSig` 는 `sprIndex:riderSpr` 라 그대로여서 `_refreshUnits` 로도
       *   다시 안 만들어졌다 — 2-5 제국장교·구축기사가 **말 없이 사람만** 나오던 자리다
       *   (2-4A 암흑기사는 본체 `300` 이 목록에 있어 폴백이 필요 없었고 그래서 멀쩡했다).
       *   표가 도착한 지금은 폴백이 되므로 **상자를 다시 짓게 한다.** */
      var 지운수 = 0;
      Object.keys(self.unitEls || {}).forEach(function (id) {
        var box = self.unitEls[id];
        if (box) { box._layerSig = null; 지운수++; }
      });
      if (지운수) console.log('[유닛] 파일명 표 도착 — 층 캐시 ' + 지운수 + '개 무효화');
      self._유닛전체새로고침();
      /* ★★★ **늦게 준비되는 그림을 몇 번 더 확인한다** (2026-08-16)
       *
       *   표가 도착한 **그 순간**에는 `_대체스프라이트정보()` 가 그림 파일을 아직
       *   못 읽은 것이 있다(파일도 비동기다). 그러면 층이 모자란 채로 또 굳는다.
       *   3급 마장기 조종사(`PM*.MCR` · 901~)가 정확히 그랬다 — `layersOf` 는
       *   2층을 주는데 상자는 1층이라 **화면에만 안 보였다.**
       *   콘솔에서 손으로 다시 지으면 바로 나왔다 → 타이밍 문제로 확정.
       *
       *   ★ 한 번(600 ms)만 재시도했더니 **그때도 아직 안 왔다.** 여러 번 본다. */
      /* [원본없음] — 자산이 늦게 도착하는 것은 **웹에서만** 생기는 일이다.
       * 원본은 파일을 동기로 읽어 이런 재시도가 없다.
       * 간격은 「한 번(600ms)으로 모자랐다」는 실측에서 늘려 잡은 것이다. */
      [400, 1200, 2500, 5000].forEach(function (ms) {
        var 예약 = self._시간예약(function () {
          if (self._렌더러폐기됨) return;
          var ri = self._자산재시도.indexOf(예약);
          if (ri >= 0) self._자산재시도.splice(ri, 1);
          var 또 = 0;
          Object.keys(self.unitEls || {}).forEach(function (id) {
            var b = self.unitEls[id]; if (!b) return;
            var 있 = (b._layers || []).length;
            var 와야 = (self.layersOf(self._ID유닛찾기(id)) || []).length;
            if (와야 && 있 < 와야) { b._layerSig = null; 또++; }
          });
          if (또) {
            console.log('[유닛] 늦게 준비된 그림 ' + 또 + '개 — 다시 짓는다 (' + ms + 'ms)');
            self._유닛전체새로고침(); self.apply();
          }
        }, ms);
        self._자산재시도.push(예약);
      });
    } catch (e) {
      console.warn('[유닛] 파일명 표 직독 실패 — 추출본 메타로 진행:', e && e.message);
    }
  })();
  return this._sprNamesP;
};

/* ═══════════════════ 상태이상 이펙트 — `CHR_EFFC.SYB` (0x123DF ~ 0x12553) ══
 *
 * 원본은 유닛을 그릴 때마다 `[+0x1E]` 여섯 갈래 + 배리어를 도는 루프를 돌려
 * **유닛 자리에 겹쳐 그린다.** HUD 표식이 아니다 — 화상이면 몸에 불이 붙고
 * 빙결이면 얼음 기둥이 씌워진다.
 *
 * ```asm
 * 0x11C66  ecx = 0x24 (36)                ; 프레임 36개
 * 0x11C70  eax = 0x76E34 "chr_effc.syb"   ; ★ 파일
 * 0x123E5  cmp [edx+0x1E], 0 ; je 0x123F2 ; 상태이상이 있으면 si = 0 부터
 * 0x123F2  test [edx+0x15], 0x80          ; 없고 배리어면 si = 5 만
 * 0x12418  jmp [ebp*4 + 0x23A9]           ; 여섯 갈래 점프표
 * 0x124C0  bx += [edx+0x65]               ; ★ 유닛 픽셀 오프셋을 따라간다
 * ```
 *
 * 자세한 것은 `03_분석/COMBATII/상태이상_원본확정.md` §6.
 * ────────────────────────────────────────────────────────────────────────── */

/** 0x12406 점프표 — `si` 별 「어느 비트를 보고 어느 프레임을 쓰는가」. */
var EFFC = [
  /* si 0 */ { f15: false, mask: 0x07, base: null },   // 화상 0 · 빙결 3 · 감전 6 (0x1242A)
  /* si 1 */ { f15: false, mask: 0x08, base: 9 },      // 침묵   0x1244C add 9
  /* si 2 */ { f15: false, mask: 0x10, base: 12 },     // 혼란   0x12461 add 12
  /* si 3 */ { f15: false, mask: 0x20, base: 15 },     // 저주   0x12476 add 15
  /* si 4 */ { f15: false, mask: 0x80, base: 18 },     // 중독   0x1248B add 18
  /* si 5 */ { f15: true,  mask: 0x80, base: 30 }      // 배리어 0x124A2 add 0x1E
];
/* ★ DNA 0x40 은 없다 — 모습 자체가 바뀌므로(0x2C547). 여덟 비트 중 유일하다. */

var EFFC_FILE = 'CHR_EFFC.SYB';
var EFFC_STEP = 3;                                     // 0x12114  idiv 3

/**
 * 지금 이 유닛에 겹쳐 그릴 프레임 번호들. 원본 루프(0x12406)를 그대로 돈다.
 * 반환은 **기준 프레임**만이고, 애니메이션 0~2 는 부르는 쪽에서 더한다.
 */
/** 상태이상 효과를 그릴 때 볼 값 — 죽은 유닛은 죽기 직전 값(원본은 터지는 연출 뒤에 지운다 · combat.js kill 0x1DD35) */
function 표시상태(u) {
  if (root.Rules && root.Rules.상태칸묶기) root.Rules.상태칸묶기(u);   /* f1e·ailment 한 칸 */
  var s = (u && !u.alive && u._사망전표시) || u;
  return { ailment: s.ailment | 0, f15: s.f15 | 0 };
}
Renderer.prototype.ailmentFrames = function (u) {
  var 표 = 표시상태(u), f1e = 표.ailment, f15 = 표.f15, out = [];
  /* 0x123E5 — 상태이상이 하나도 없으면 배리어(si 5)만 본다. */
  var from = f1e ? 0 : 5;                              // 0x123EB · 0x123FC
  if (!f1e && !(f15 & 0x80)) return out;               // 0x123F6  둘 다 없으면 끝
  for (var si = from; si < EFFC.length; si++) {        // 0x12554  cmp si, 6
    var e = EFFC[si], v = e.f15 ? f15 : f1e;
    if (!(v & e.mask)) continue;                       // 갈래마다 je 0x12553
    if (e.base != null) { out.push(e.base); continue; }
    /* si 0 — 하위 3비트는 값에 따라 갈린다 (0x1242A ~ 0x1242F)
     *   al &= 7 ; sar 1 ; ebp = eax*3     화상 1→0 · 빙결 2→3 · 감전 4→6 */
    out.push((((v & 0x07) >> 1) | 0) * 3);
  }
  return out;
};

/** `CHR_EFFC.SYB` 프레임 공급자 (원본 직독). 준비 전 null · 실패 false */
Renderer.prototype._상태효과프레임공급자 = function () {
  if (this._effc !== undefined) return this._effc;
  this._effc = null;
  var self = this;
  (async function () {
    try {
      if (!self._유닛팔레트()) {
        var pr = await self._가져오기(G2URL('GENESIS.PAL'));
        if (!pr.ok) throw new Error('GENESIS.PAL ' + pr.status);
        /* ★ 날씨가 걸린 전투는 팔레트가 다르다 (0x12824C 실측 · native.js 전투팔레트) */
        self._palette = root.G2Native.전투팔레트(root.G2Native.decodePalette(new Uint8Array(await pr.arrayBuffer())));
      }
      var r = await self._가져오기(G2URL(EFFC_FILE));
      if (!r.ok) throw new Error(EFFC_FILE + ' ' + r.status);
      var d = root.G2Native.decodeSYB(new Uint8Array(await r.arrayBuffer()));
      var fr = (d && (d.frames || d)) || null;
      if (!fr || !fr.length) throw new Error(EFFC_FILE + ' 디코드 실패');
      self._effcRaw = fr;
      /* ★★ 팔레트는 **굽기 직전에 다시 읽는다.** 읽기 시작할 때 잡아 두면
       *   fetch 가 도는 사이에 팔레트가 바뀌어도 옛 것으로 굽는다.
       *
       *   실제로 그래서 **블리자드 스톰으로 얼린 얼음만 어두웠다** —
       *   ① 연출 시작 `setPaletteMix(검정, 40%)` → `_팔레트반영(어두움)`.
       *      이때는 `_effcRaw` 가 아직 없어 이펙트를 다시 굽지 않는다.
       *   ② 연출 도중 빙결이 걸려 여기 처음 들어온다 → **어두운 팔레트**를 잡는다.
       *   ③ 연출 끝 `clearPaletteMix()` → `_팔레트반영(밝음)`. 그런데 `_effcRaw` 가
       *      **아직도 없다**(fetch 가 도는 중) → 역시 다시 굽지 않는다.
       *   ④ fetch 가 끝나 **②에서 잡은 어두운 팔레트로 굽는다** → 영영 어둡다.
       *
       *   여기서 다시 읽으면 ④가 ③ 이후의 밝은 팔레트를 쓴다.
       *   (계측 2026-08-14 — 코드로 직접 건 빙결은 밝고, 초필살기로 건 것만
       *    어두웠다. 같은 URL·같은 CSS 였으므로 굽는 시점 말고는 다를 게 없었다.) */
      self._effc = root.G2Native.spriteCanvasProvider(fr, self._유닛팔레트());
      self._effcURL = {};
      self._상태효과애니시작();                        // 0x12100 카운터
      self._유닛전체새로고침();
    } catch (e) {
      console.error('[상태이상] 원본 직독 실패:', EFFC_FILE, e && e.message);
      self._effc = false;
    }
  })();
  return null;
};

/** 프레임 하나의 data-URL. 스케일러가 바뀌면 비운다(`_unitFrameURL` 과 같은 방식). */
Renderer.prototype._상태효과그림정보 = function (n) {
  var prov = this._상태효과프레임공급자();
  if (!prov) return null;
  this._effcURL = this._effcURL || {};
  if (Object.prototype.hasOwnProperty.call(this._effcURL, n)) return this._effcURL[n];
  var f = prov(n);
  if (!f) return (this._effcURL[n] = null);
  return (this._effcURL[n] = { url: f.canvas.toDataURL(), w: f.w, h: f.h, ax: f.ax, ay: f.ay });
};

/**
 * ★★★ **평타 속성 타격 이펙트** — 원본 `0x1E4E1` (2026-08-16 확정).
 *
 * 사용자 지적: 「속성 부여후 **일반 공격시 속성 이펙트 터지는거** 구현안됐어」
 * 「화염은 동그랗게(도넛처럼) 터지고, 빙결은 하얀색 … 퍼지고, 전격은 적한테 터져」
 *
 * ```asm
 * 0x1E4E1  (eax = **시전자**, edx = **대상**, bx = 애니메이션 오프셋)
 * 0x1E4E8  dl = [시전자+0x15]           ; ★ 원소 속성 비트
 * 0x1E4EB  test dl, 0x7 ; je            ; ★ 속성이 없으면 **아무것도 안 그린다**
 * 0x1E4F7  edx = (dl & 7) >> 1          ; 비트 → 번호  1→0 · 2→1 · 4→2
 * 0x1E507  eax = 3*edx + 0x15           ; ★★ **프레임 = 21 + 3 × 속성번호**
 * 0x1E50C  esi = bx + eax
 * 0x1E510  call 0x135EB (eax = 대상)    ; ★ **대상** 자리
 * 0x1E527  ax = [번호*12 + 0x4B87C]     ;   CHR_EFFC 앵커 x
 * 0x1E534  ax = [번호*12 + 0x4B87E]     ;              앵커 y
 * 0x1E55A  call 0x5F3FD                 ; ★ 그리기 — **불투명**
 * ```
 * 호출부 `0x1EA71` 은 대상마다 한 번 돌고 **회피(상태 2)면 건너뛴다**(`0x1EA4A`).
 *
 * | 속성 | 비트 | 프레임 | 그림 |
 * |---|---|---|---|
 * | 화염 | `1` | **21·22·23** | 주황 도넛 |
 * | 빙한 | `2` | **24·25·26** | 하얀 반짝임 |
 * | 전격 | `4` | **27·28·29** | 노란 번개 |
 *
 * ★ 지속 상태 표시(`0x123E0`, 프레임 0~20·30~32)와 **같은 파일**을 쓰지만
 *   그리는 곳이 다르다 — 이쪽은 **타격 순간 한 번**이다.
 *
 * @param {object} 대상   맞은 유닛
 * @param {number} 비트   시전자의 `[+0x15] & 7` (1 화염 · 2 빙한 · 4 전격)
 * @param {number} 오프셋 0·1·2
 * @returns {boolean} 그렸으면 true
 */
Renderer.prototype.attrHit = function (대상, 비트, 오프셋) {
  var b = (비트 | 0) & 0x07;
  if (!b || !대상) return false;                       // 0x1E4EB test dl,7 ; je
  var 번호 = b >> 1;                                   // 0x1E4F7  1→0 · 2→1 · 4→2
  var n = 0x15 + 3 * 번호 + ((오프셋 | 0) % 3);        // 0x1E507  21 + 3×번호
  var fr = this._상태효과그림정보(n);
  if (!fr) return false;

  this._attrEls = this._attrEls || [];
  /* 0x1EA71: 평타 화면·유닛 뒤 0x1E4E1 대상 타격 도막 — 선택위다. */
  var e = this.fxSprite ? this.fxSprite(fr.url, 'top') : null;
  if (!e) return false;
  /* 좌표는 `0x1E510 → 0x135EB` 와 같다 — **대상** 기준점(유닛 앵커 +12 / −2)에
   * 프레임 앵커를 더한다. `unitAt` 규약과 같으므로 맵 픽셀로 낸다. */
  var p = this.mapOf({ x: 대상.x | 0, y: 대상.y | 0 });
  var x = p.x + 12 + (fr.ax | 0) + ((대상.ox | 0));     // 0x124C0 과 같은 밀림 보정
  var y = p.y - 2 + (fr.ay | 0) + ((대상.oy | 0));
  e.style.width = fr.w + 'px'; e.style.height = fr.h + 'px';
  e.style.backgroundSize = fr.w + 'px ' + fr.h + 'px';
  this._빌보드놓기(e, x, y + fr.h, fr.h);
  e._pl = x; e._pg = y + fr.h;
  this._attrEls.push(e);
  return true;
};

/** 위에서 얹은 속성 타격 이펙트를 전부 뗀다. */
Renderer.prototype.attrHitClear = function () {
  var L = this._attrEls || [];
  for (var i = 0; i < L.length; i++) this.dropFxSprite(L[i]);
  this._attrEls = [];
};

/**
 * 0x12100 ~ 0x12116 — **3프레임 반복 카운터**. 화면을 한 장 그릴 때마다 하나씩.
 *
 * ```asm
 * 0x12109  inc edx
 * 0x12114  idiv 3          ; 0 → 1 → 2 → 0 …
 * 0x12116  mov [0x74FB8], dx
 * ```
 * ★★★ **2026-08-29 — 여기까지 팠다.**
 *   · 카운터가 든 함수는 `0x12063`(`53 51 52 56 57 55` push ×6)부터
 *     `0x12123 ret` 까지다. 앞은 `0x12062 c3`(다른 함수 끝).
 *   · 그런데 이 함수를 **`e8` 로 부르는 자리가 하나도 없다** (전 이미지 훑음).
 *     `0x12063` 을 상수로 싣는 자리도 없다 — 곧 **간접 호출**이거나
 *     진입점 판단이 틀렸다.
 *   · 읽는 쪽은 `0x12448`·`0x1245D`·`0x12472`·`0x12487`·`0x1249E`·`0x1270B`
 *     여섯 곳(전수) 이고 모두 `0x74FB8` 을 word 로 읽는다.
 *   ⇒ 「어느 주기로 다시 그리나」는 **§A● 5번(프레임 시계)과 같은 물음**이다.
 *     거기서 한꺼번에 푼다. 그때까지 아래 값은 **눈대중**이다.
 *   여기서는 렌더 루프에서 부르되 `EFFC_MS` 마다 한 칸 넘긴다.
 */
/* ☠ **눈대중 값이다** — 원본은 밀리초가 아니라 프레임 카운터로 돈다.
 *   ☐ 2026-08-29 검산 — `[0x74FB8]` 의 **값은 정적으로 못 읽는다.**
 *     `-BASE` → `0x64FB8` 자리가 `d1 e8 66 89 45 fa …` 로 **코드**이고,
 *     `+0x70000-BASE` → `0xD4FB8` 은 **파일 범위 밖**이다(파일은 `0x78D97` 까지).
 *     곧 실행 중에 채워진다. **값을 지어 넣지 않는다.**
 *   ⇒ §A● 5번(프레임 시계)에서 한꺼번에 푼다. 그때까지 아래는 눈대중이다. */
/* ★ 2026-09-26 풀었다 (Z-86 · 사장님 「상태이상 효과 이펙트 전환 속도도 확인해줘. 컨퓨즈 물음표가 너무 빨리 움직이는 것처럼 보여」)
 *   카운터는 0x12065 끝(0x12100~0x12116)에서 한 칸 오르고, 0x12065 는 타이머 인터럽트 0x101F4 가
 *   틱 계수기 [0x899E] 가 30 일 때 부른다(0x1022E cmp 0x1E → 0x10238 [0x70006]!=0 → 0x10246 call 0x12065).
 *   ⇒ 30틱 × (1000/175.47) ≈ 171 ms. 옛 눈대중 120 ms 는 1.4 배 빨랐다.
 *   전투 고리는 R.정기갱신끔일 때 호출을 건너뛴다(battle_main.js 상태효과틱).
 *   원본 [0x70006]=0의 모든 진입·해제 경로 대응은 별도 검증 대상이다. */
var EFFC_MS = 30 * 1000 / 175.47;
/** 원본 박자에 맞춰 유닛 상태이상 표시 프레임을 진행한다. */
Renderer.prototype.tickAilmentFx = function () {
  this._effcN = ((this._effcN | 0) + 1) % EFFC_STEP;   // 0x12114
  var self = this, b = this.b;
  if (!b || !b.units) return this._effcN;
  /* 상태가 걸린 유닛만 다시 놓는다 — `updateUnit` 전체를 돌릴 일이 아니다. */
  b.units.forEach(function (u) {
    var box = self.unitEls[u.id];
    if (!box) return;
    var 표 = 표시상태(u), 있나 = 표.ailment || (표.f15 & 0x80);
    if (!있나 && !(box._fx && box._fx.length)) return;
    self._상태효과놓기(u, box, box._ox | 0, box._oy | 0, (box._layers || []).length);
  });
  /* ★★★ **시각 상태가 바뀐 바로 그 지점에서 알린다** (2026-08-17 · §32-45)
   *   여기서 안 알리면 대화창 미러는 **다음 `draw()`** 에서야 따라와
   *   전환마다 한 프레임씩 어긋난다(실측: 45프레임 중 3회). */
  this._시각변경알림('ailment-frame');
  return this._effcN;
};

/* ══════════════════════════════════════════════════════════════════════
 * ★★★ **선택적 시각 갱신 훅** (2026-08-17 · 사용자 지정 · §32-45)
 *
 * 사용자 지정: 「렌더러가 미러를 직접 참조하지 않도록 **선택적 시각 갱신
 * hook** 을 두세요. 직접 `render.js → RemapMirror` 를 호출하게 만들면
 * 렌더러와 대화 기능이 **강하게 결합**되므로 피하는 것이 좋습니다.」
 *
 * · 렌더러는 `RemapMirror` 를 **모른다** — 붙는 쪽이 `R.onVisualChanged` 를 건다
 * · 훅이 없으면 아무 일도 안 한다(기본 경로에 비용 0)
 * · **훅이 던져도 렌더러는 계속 돈다** — 붙인 쪽 사정으로 화면이 멈추면 안 된다
 * ══════════════════════════════════════════════════════════════════════ */
Renderer.prototype._시각변경알림 = function (reason) {
  var f = this.onVisualChanged;
  if (typeof f !== 'function') return;
  try { f.call(this, reason); }
  catch (e) { console.warn('[시각훅] ' + reason + ' 실패 — 훅을 뗀다', e); this.onVisualChanged = null; }
};

/** 이펙트 애니메이션 타이머 — 한 번만 띄운다. */
Renderer.prototype._상태효과애니시작 = function () {
  /* ★ 전투 고리가 게임 시계로 30 틱마다 tickAilmentFx 를 부르면(상태효과게임시계) 벽시계 타이머를 안 건다 (2026-09-27)
   *   ☠ 벽시계 171 ms 간격이라 녹화(한 틱이 느림) 중에는 거의 틱마다 넘어갔다 — 원본 0x12065 는 타이머 30 틱마다 */
  if (this.상태효과게임시계) return;
  if (this._effcTimer) return;
  var self = this;
  this._effcTimer = this._반복예약(function () { self.tickAilmentFx(); }, EFFC_MS);
};

/**
 * 유닛 상자 안에 이펙트 층을 얹는다. `box` 자체가 이미 `[+0x65]`/`[+0x66]` 을
 * 반영하고 있으므로(`updateUnit` 의 `px`/`py`) **밀림·흔들림을 저절로 따라간다**
 * — 원본 `0x124C0 bx += [edx+0x65]` 과 같은 자리다.
 */
Renderer.prototype._상태효과놓기 = function (u, box, ox, oy, zTop) {
  var want = this.ailmentFrames(u);
  var pool = box._fx || (box._fx = []);
  if (!want.length && !pool.length) return;
  var n = this._effcN | 0;                             // 0x12432  카운터를 더한다
  for (var i = 0; i < want.length; i++) {
    var rec = this._상태효과그림정보(want[i] + n);
    var d = pool[i];
    if (!d) {
      d = pool[i] = el('div', 'g2-ail', box);
      d.style.cssText = 'position:absolute;background-repeat:no-repeat;pointer-events:none;' +
                        'image-rendering:' + rend() + ';';
    }
    if (!rec) { d.style.display = 'none'; d._effcNo = null; continue; }
    d.style.display = '';
    /* ★★★ **대화창 미러가 읽는다** (2026-08-17 · §32-42)
     *   그림자(`_shdNo`)와 같은 수법이다 — 미러가 `want`·`_effcN` 갈래를
     *   복제하지 않고 **메인이 고른 번호를 읽기만** 한다.
     *   원본 사슬로 상태이상은 리맵 **전**에 그려지므로 included 다:
     *     `0x454CB → 0x12BEE → 0x12C2B → 0x12567 → 0x12B33 → 0x123C1`
     *     그 뒤에 `0x4845C`·`0x48475` 사각형 리맵. */
    d._effcNo = want[i] + n;
    if (d._url !== rec.url) {
      d._url = rec.url;
      d.style.cssText = 'position:absolute;background-repeat:no-repeat;pointer-events:none;' +
        'image-rendering:' + rend() + ';' + bgcss(rec.url, rec.w, rec.h) +
        'width:' + rec.w + 'px;height:' + rec.h + 'px;';
    }
    /* 프레임 앵커가 곧 기준점으로부터의 오프셋 — 유닛 층과 똑같이 놓는다
     * (0x124B1 `+[ebp+0x4B87C]` · 0x124E3 `+[ebp+0x4B87E]`). */
    d.style.left = (ox + (rec.ax | 0)) + 'px';
    /* ★ 비행 유닛이면 세로 −0x18 — 원본 0x123CF test [+0x14],1 → 0x123D5 [esp+0x10] = −0x18 → 0x12502 add (HP 숫자 0x134FE 와 같은 올림)
     *   ☠ 빠져 있어 나는 와이번의 상태 그림이 몸보다 24 아래 땅에 떨어져 잘려 보였다 (2026-11-15 사장님 [그림] 「상태이상 잘리는것도 해결해야해」 · 정본 213) */
    d.style.top = (oy + (rec.ay | 0) - ((((u.f14 | 0) & 1)) ? 0x18 : 0)) + 'px';
    d.style.zIndex = (zTop | 0) + 1 + i;               // 유닛 위에 겹친다
  }
  for (var j = want.length; j < pool.length; j++) pool[j].style.display = 'none';
};

/**
 * 스프라이트 파일 하나를 원본에서 읽어 프레임 공급자를 만든다.
 * @returns {function(n)|null|false} 준비 전 null · 실패 false
 */
Renderer.prototype._유닛프레임공급자 = function (file) {
  if (this._렌더러폐기됨) return false;
  this._uspr = this._uspr || {};
  if (Object.prototype.hasOwnProperty.call(this._uspr, file)) return this._uspr[file];
  this._uspr[file] = null;                                  // 로딩 중 (중복 요청 방지)
  var self = this;
  this._usprP = this._usprP || {};
  this._usprErr = this._usprErr || {};
  this._usprErr[file] = null;
  this._usprP[file] = (async function () {
    try {
      /* 선로드 원본 프레임은 이미 디코드되어 있다. 이 렌더러에 공급자만 만든다. */
      var raw = self._usprRaw && self._usprRaw[file];
      var pal = self._유닛쓸팔 || self._유닛팔레트();   /* 연출 중에 실리는 유닛도 리맵 전 팔레트로 (_팔레트따라잡기 와 같은 까닭) */
      if (!pal) {
        if (!self._palette) {
          var pr = await self._가져오기(G2URL('GENESIS.PAL'));
          if (self._렌더러폐기됨) return false;
          if (!pr.ok) throw new Error('GENESIS.PAL ' + pr.status);
          var palBytes = new Uint8Array(await pr.arrayBuffer());
          if (self._렌더러폐기됨) return false;
          /* ★ 날씨가 걸린 전투는 팔레트가 다르다 (0x12824C 실측 · native.js 전투팔레트) */
          self._palette = root.G2Native.전투팔레트(root.G2Native.decodePalette(palBytes));
        }
        pal = self._palette;
      }
      if (self._렌더러폐기됨) return false;
      var d = raw ? { frames: raw, weaponSwing: self._usprSwing && self._usprSwing[file] } : null;
      if (!d) {
        var r = await self._가져오기(G2URL('CHARACTE/' + file));
        if (self._렌더러폐기됨) return false;
        if (!r.ok) throw new Error(file + ' ' + r.status);
        /* 파일명을 넘기면 탈것 갑옷 **색인 리맵**이 걸린다 (`탈것_갑옷색_리맵.md`) */
        var bytes = new Uint8Array(await r.arrayBuffer());
        if (self._렌더러폐기됨) return false;
        d = root.G2Native.decodeNC2(bytes, file);
      }
      if (!d || !d.frames || !d.frames.length) throw new Error(file + ' 디코드 실패');
      if (self._렌더러폐기됨) return false;
      self._usprRaw = self._usprRaw || {};
      self._usprRaw[file] = d.frames;                       // 발끝 계산용 인덱스 버퍼
      self._usprSwing = self._usprSwing || {};
      if (d.weaponSwing) self._usprSwing[file] = d.weaponSwing;
      self._uspr[file] = 유닛공급자(self, file, pal);   /* ★ GPU 판 길 (2026-10-06) */
      (self._usprPal || (self._usprPal = {}))[file] = pal;   /* ★ 어떤 팔레트로 구웠나 */
      self._유닛전체새로고침();
      return self._uspr[file];
    } catch (e) {
      if (self._렌더러폐기됨) return false;
      console.error('[유닛] 원본 직독 실패:', file, e && e.message);
      self._usprErr[file] = e;
      self._uspr[file] = false;
      return false;
    }
  })();
  return null;
};

/** 번호의 원본 프레임과 파생 메타가 실제 준비될 때까지 기다린다. */
Renderer.prototype.스프라이트자산대기 = async function (no) {
  if (no == null) throw new Error('스프라이트 번호가 없다');
  if (this._렌더러폐기됨) throw new Error('렌더러가 종료되었다');
  var unregister = null, rejectStop;
  var stopped = new Promise(function (_, reject) { rejectStop = reject; });
  unregister = this._종료정리등록(function () { rejectStop(new Error('렌더러가 종료되었다')); });
  try {
    var ready = await Promise.race([this._스프라이트표불러오기(), stopped]);
    if (this._렌더러폐기됨) throw new Error('렌더러가 종료되었다');
    if (!ready) throw new Error('스프라이트 파일명 표를 읽지 못했다');
    this._sprNames = this._sprNames || ready;
    var i = root.G2Native.spriteIndexOf(no), file = this._sprNames[i];
    if (!(i >= 0) || !file) throw new Error('스프라이트 파일명이 없다: ' + no);
    var provider = this._유닛프레임공급자(file);
    if (provider === null) {
      var pending = this._usprP && this._usprP[file];
      if (!pending) throw new Error('스프라이트 공급자가 대기 상태에 없다: ' + file);
      provider = await Promise.race([pending, stopped]);
      if (!provider) throw this._usprErr[file] || new Error('스프라이트 프레임을 준비하지 못했다: ' + file);
      provider = this._유닛프레임공급자(file);
    }
    if (this._렌더러폐기됨) throw new Error('렌더러가 종료되었다');
    if (!provider) throw this._usprErr[file] || new Error('스프라이트 프레임을 준비하지 못했다: ' + file);
    var meta = this._대체스프라이트정보(no);
    if (!meta || !meta._원본직독 || !this.G2 || !this.G2.sprites)
      throw new Error('스프라이트 메타 등록 실패: ' + no);
    var shared = this.G2.sprites[no];
    if (!shared || !shared._원본직독 || !shared['칸'])
      throw new Error('공유 스프라이트 메타가 준비되지 않았다: ' + no);
    return shared;
  } finally {
    if (unregister) unregister();
  }
};

/**
 * ★★★★★ **팔레트가 바뀌었으면 그 스프라이트를 다시 굽는다** (2026-09-10)
 *
 *   > 사장님: 「실행기에서 **특정 몬스터들 팔레트가 잘못되어서 까맣게** 나와.
 *   >  성문, 성벽에 박힌 대포 같은 종류들이야(아마 화룡도 포함).
 *   >  이 스프라이트는 일반 genesis 팔레트가 아니라 **해당맵 팔레트**를 사용해야
 *   >  이미지가 제대로 나와.」
 *
 *   조사는 `03_분석/팔레트_104대역_문제.md` 에 다 있다 — 팔레트는 **역할이 갈린다**:
 *     `0~103` 은 `GENESIS.PAL`(전역) · `104~255` 는 **맵 파일이 들고 있다.**
 *   성문·성벽·대포·비룡은 픽셀의 **거의 전부가 104↑** 라, `GENESIS.PAL` 로 구우면
 *   그 대역이 검정 150칸이어서 **한 픽셀도 색이 없다** → 통째로 검정.
 *
 *   ☠ 실행기는 `_유닛팔레트()` 로 **맵 팔레트를 이미 우선**하고 있었다. 그런데
 *     `_유닛프레임공급자()`가 **맵이 아직 안 실린 사이**에 불리면 `GENESIS.PAL` 로 굽고,
 *     그 뒤 맵 팔레트가 와도 **다시 굽지 않았다.** 그것이 문제의 전부였다.
 *     (실측 13-7 — `THNDWALL.BCR` 7,649픽셀 **전부 검정** · `CANNON.BCR` 576 전부.
 *      `R._팔레트반영(R._유닛팔레트())` 를 손으로 부르면 **0 %** 가 된다.)
 *
 *   ⇒ 파일마다 **무슨 팔레트로 구웠는지**(`_usprPal`)를 적어 두고, 그릴 때 지금
 *     팔레트와 다르면 **그 파일만** 다시 굽는다. 인덱스 버퍼(`_usprRaw`)를 쥐고
 *     있으므로 **다시 읽지 않는다.**
 */
Renderer.prototype._팔레트따라잡기 = function (file) {
  /* ☠ 연출 중(초필살 암전·필살 리맵)에는 유닛을 «리맵 전 팔레트»(_유닛쓸팔)로 굽는다 — 맵 팔레트(암전된 것)와 견주면 그릴 때마다
   *   유닛 그림을 암전 팔레트로 다시 구워 시전자·대상까지 어두워졌다 (2026-09-26 사장님 「시전자랑 타겟은 음영처리 안되어야한다고!」) */
  var 지금 = this._유닛쓸팔 || this._유닛팔레트();
  if (!지금 || !this._usprPal || !this._usprRaw) return false;
  if (!this._usprPal[file] || this._usprPal[file] === 지금) return false;
  if (typeof this._uspr[file] !== 'function' || !this._usprRaw[file]) return false;
  this._uspr[file] = 유닛공급자(this, file, 지금);
  this._usprPal[file] = 지금;
  /* data-URL·실루엣 캐시도 팔레트를 물고 있다 — **그 파일 것만** 버린다 */
  var self = this, 앞 = file + '#';
  if (this._uurl) Object.keys(this._uurl).forEach(function (k2) {
    if (k2.indexOf(앞) === 0) delete self._uurl[k2]; });
  if (this._silCache) Object.keys(this._silCache).forEach(function (k3) {
    if (k3.indexOf(file) >= 0) delete self._silCache[k3]; });
  return true;
};

/**
 * ★★★ **유닛 그림 공급자 — 팔레트가 바뀌면 GPU 판으로 칠한다** (2026-10-06)
 *   사장님(원문) 「일단 최대한 gpu로 옮기는 방법으로 해보자.」 (선라이트 끊김)
 *   실측(9344 탭 3-3A · 유닛 40): 선라이트 한 번에 팔레트 51걸음 × 유닛 그림을 CPU xBRZ 로 다시 확대 777번 186ms.
 *   ⇒ 처음 팔레트로 확대한 그림을 «바탕»으로 쥐고(spriteCanvasProvider), 다른 팔레트면 프레임마다
 *     palettegpu 판(바탕 그림 + 색 번호)으로 새 팔레트만 칠한다 — 바닥·행·오브젝트(확대판얻기)와 같은 길.
 *   스케일러 1배 · GPU 없음 · 판을 못 올리면 예전대로 spriteCanvasProvider(CPU).
 */
var 유닛바탕주인 = null;   /* 유닛 바탕 텍스처를 가진 렌더러 — 전투를 바꾸면 렌더러가 새로 생겨 옛 텍스처가 그래픽 메모리에 쌓였다 (정본 304) */
function 유닛공급자(self, file, pal) {
  var raw = self._usprRaw && self._usprRaw[file], S = root.G2Scaler, G = root.G2PaletteGPU;
  if (!raw) return null;
  if (G && 유닛바탕주인 && 유닛바탕주인 !== self && 유닛바탕주인._유닛바탕) {   /* 새 렌더러 — 옛 렌더러의 유닛 텍스처를 비운다 */
    var 옛 = 유닛바탕주인._유닛바탕;
    Object.keys(옛).forEach(function (f) { var b = 옛[f]; if (b && b.판) Object.keys(b.판).forEach(function (k) { if (b.판[k]) G.버리기(b.판[k]); }); });
    유닛바탕주인._유닛바탕 = null;
  }
  유닛바탕주인 = self;
  if (!(S && S.N() > 1) || !G || !G.준비()) return root.G2Native.spriteCanvasProvider(raw, pal);
  var 바들 = self._유닛바탕 || (self._유닛바탕 = {}), 바 = 바들[file];
  if (!바 || 바.raw !== raw || 바.N !== S.N() || 바.필터 !== S.cur()) {
    if (바 && 바.판) Object.keys(바.판).forEach(function (k) { if (바.판[k]) G.버리기(바.판[k]); });   /* 그래픽 카드 메모리를 비운다 */
    바 = 바들[file] = { raw: raw, pal: pal, prov: root.G2Native.spriteCanvasProvider(raw, pal), 판: {}, N: S.N(), 필터: S.cur() };
  }
  if (바.pal === pal) return 바.prov;
  var cache = {};
  return function (n) {
    if (cache[n] !== undefined) return cache[n];
    var b = 바.prov(n);
    if (!b) return (cache[n] = null);
    var 판 = 바.판[n];
    if (판 === undefined) 판 = 바.판[n] = G.판올리기(b.canvas, raw[n], 바.pal) || null;
    if (판) {
      var c = document.createElement('canvas');
      c.width = b.canvas.width; c.height = b.canvas.height; c.논리w = b.w; c.논리h = b.h;
      if (G.칠하기(판, pal, c, 0, 0)) return (cache[n] = { canvas: c, ax: b.ax, ay: b.ay, w: b.w, h: b.h });
    }
    /* GPU 가 못 칠했다 — 이 프레임만 예전대로 CPU */
    var fr = raw[n];
    return (cache[n] = { canvas: root.G2Native.frameToCanvas(fr, pal), ax: fr.ax, ay: fr.ay, w: fr.w, h: fr.h });
  };
}

/** 프레임 하나의 data-URL (+논리 크기·앵커). 스케일러가 바뀌면 캐시를 비운다. */
Renderer.prototype._유닛프레임정보 = function (file, n) {
  this._uurl = this._uurl || {};
  this._팔레트따라잡기(file);          /* ★ 맵 팔레트가 늦게 와도 따라간다 */
  var k = file + '#' + n;
  if (Object.prototype.hasOwnProperty.call(this._uurl, k)) return this._uurl[k];
  var prov = this._유닛프레임공급자(file);
  if (!prov) return null;                                   // 아직 로딩 중 / 실패
  var f = prov(n);
  if (!f) return (this._uurl[k] = null);
  /* ★ `canvas` 도 같이 넘긴다 — 발광 실루엣(`_silhouetteURL`, 원본 `0x5F517`)이
   *   data-URL 로는 동기로 못 굽는다. 원본 캔버스가 있어야 한다. */
  /* `열쇠` — 실루엣 캐시용 «어느 파일의 몇 번 그림» (윤곽은 팔레트와 무관하다 · `_실루엣그림정보`) */
  /* ★ `url` 은 «읽을 때» 굽는다 (2026-10-06 · 사장님(원문) 「지금 선라이트 1클 너무 느려졌는데?」 → «연출이 끊기고 버벅임» · «지금 바로»)
   *   팔레트가 바뀌는 연출(선라이트 등)은 걸음마다 이 캐시를 비우는데, 그때마다 유닛 그림을 PNG 로 구웠다
   *   (시험 탭 실측: 선라이트 1클 한 번에 이 자리 toDataURL 259번 · 33ms 넘는 프레임 54개 · 최장 187ms).
   *   매 프레임 길(`유닛층그리기`)은 이제 `canvas` 를 바로 칠하므로 굽지 않는다 — 다른 호출부는 읽는 순간 한 번 굽는다. */
  var rec = { canvas: f.canvas, w: f.w, h: f.h, ax: f.ax, ay: f.ay, 열쇠: k, _url: null };
  Object.defineProperty(rec, 'url', { enumerable: true, configurable: true,
    get: function () { return this._url || (this._url = this.canvas.toDataURL()); },
    set: function (v) { this._url = v; } });
  return (this._uurl[k] = rec);
};

/**
 * 지금 보이는 프레임 한 장의 정보 — 원본 직독본 기준.
 * @returns {{file,n,w,h,ax,ay,url,idx}|null} 아직 안 읽혔으면 null
 */
Renderer.prototype.frameOf = function (meta, no, dir, motion) {
  if (!meta) return null;
  var rows = meta['행'] || 4, cols = meta['열'] || meta['방향당프레임'] || 11;
  var d = (((dir | 0) % rows) + rows) % rows;
  var m = Math.min(Math.max(motion | 0, 0), cols - 1);
  var n = d * cols + m, file = this._스프라이트파일(meta, no);
  var rec = this._유닛프레임정보(file, n);
  if (!rec) return null;
  var raw = this._usprRaw && this._usprRaw[file] && this._usprRaw[file][n];
  return { file: file, n: n, w: rec.w, h: rec.h, ax: rec.ax, ay: rec.ay,
           url: rec.url, idx: raw && raw.idx };
};

/**
 * 프레임의 **불투명 픽셀 목록** `[{x, y, c}]` — 원본 인덱스 버퍼에서 바로.
 *
 * 예전엔 추출 시트를 캔버스에 그려 알파를 읽었습니다(`atlasPixels`). 그
 * 시트는 검정을 투명으로 구웠기 때문에 **검정 픽셀이 파편에서 통째로 빠졌고**,
 * `file://` 로 열면 tainted canvas 라 아예 못 읽어 균등 표집으로 물러났습니다.
 * 원본 인덱스는 「기록 안 된 픽셀만 투명」이라 둘 다 없어집니다.
 */
Renderer.prototype.framePixels = function (meta, no, dir, motion, cap) {
  var f = this.frameOf(meta, no, dir, motion);
  if (!f || !f.idx) return null;
  var pal = this._유닛팔레트(), out = [], n = f.w * f.h;
  var step = 1;
  if (cap && cap > 0) {
    var vis = 0, i;
    for (i = 0; i < n; i++) if (f.idx[i] >= 0) vis++;
    if (vis > cap) step = Math.ceil(vis / cap);
  }
  var seen = 0;
  for (var k = 0; k < n; k++) {
    var v = f.idx[k];
    if (v < 0) continue;
    if ((seen++ % step) !== 0) continue;
    out.push({ x: k % f.w, y: (k / f.w) | 0,
               c: pal ? ('rgb(' + pal[v * 3] + ',' + pal[v * 3 + 1] + ',' + pal[v * 3 + 2] + ')') : null });
  }
  return out;
};

/** 프레임 안 (px,py) 가 불투명 픽셀인가 — 커서 클릭 판정용. */
Renderer.prototype.frameOpaqueAt = function (meta, no, dir, motion, px, py) {
  var f = this.frameOf(meta, no, dir, motion);
  if (!f || !f.idx) return null;                 // 아직 못 읽음 → 부르는 쪽이 상자 판정
  if (px < 0 || py < 0 || px >= f.w || py >= f.h) return false;
  return f.idx[py * f.w + px] >= 0;
};

/** 유닛 그림만 다시 붙인다 (좌표 재계산 없음). */
Renderer.prototype._유닛전체새로고침 = function () {
  var self = this;
  if (this._렌더러폐기됨) return;
  if (this._refreshT) return;
  this._refreshT = this._시간예약(function () {
    self._refreshT = null;
    if (self._렌더러폐기됨) return;
    /* ★ 층 보정 재시도는 걷어냈다 (2026-08-16 · 「그냥 한번에 불러와져야해」).
     *   스프라이트 파일명 표를 **Renderer 생성 전에 선로드**하므로
     *   첫 `_buildUnits` 부터 폴백이 되어 탈것 본체 층이 빠지지 않는다. */
    if (self.b && self.b.units) self.b.units.forEach(function (u) { self.updateUnit(u); });
    self.apply();
    /* ★ 유닛 전체를 다시 놓았다 — 미러도 같은 프레임에 따라와야 한다 (§32-45) */
    self._시각변경알림('refresh-units');
  }, 0);
};

/** 이 블록이 **움직이는가**(레이어B 애니 표에 2프레임 이상). 원본 블록메타. */
Renderer.prototype._애니블록 = function (bi) {
  var a = this.nmap && this.nmap.blockAnim && this.nmap.blockAnim[bi];
  return !!(a && a.length > 1);
};
/** 눕힘/세움/구조물 분류. (blockIndex = 0-base, mapObjects 기준)
 *
 *  ★★★ **순서** (2026-10-13 · mapx의 시각 검토 항목을 먼저 적용한다)
 *
 *  | 우선 | 어디서 | 무엇 |
 *  |---|---|---|
 *  | ① | `mapx.object3d.classes[열쇠]` | 현재 맵에서 시각 검토해 명시한 항목 |
 *  | ② | `G2블록분류[열쇠]` | 그림 열쇠로 묶은 전역 수동 분류 |
 *  | ③ | `mapx.blocks[bi]` | 맵별 옛 예외 |
 *  | ④ | `mapx.flatBlocks` | 자동 지면화가 고른 눕힘 후보 |
 *  | ⑤ | `height <= 16` | 낮은 바닥장식·경계턱 |
 *  | ⑥ | 그 밖 | 세움 (나무·수풀) |
 *
 *  ★ 전역이 옛 mapx 예외보다 앞인 까닭 — 사람이 그림을 직접 보고 정한 것이고, 같은 그림이
 *    쓰인 **모든 맵에 한꺼번에** 걸려야 한다는 것이 사용자 요구다(2026-08-24:
 *    「내가 눕힘으로 설정하고 저장한 오브젝트는 **전체 맵에서 같은 오브젝트에
 *    동일한 옵션으로** 저장되게 하고」). 자동 규칙(③)이나 예전 맵별 예외(②)가
 *    이것을 덮으면 도구에서 정한 것이 안 보인다. 현재 맵에서 실제 화면을 보고
 *    `mapx.object3d.classes`에 명시한 경우에만 그 맵의 전역 분류를 덮는다.
 *  ★ 열쇠 계산은 `native.js blockKey` 한 벌뿐이다 — 캐시가 있어 값싸다.
 */

/** 프레임 **맨 아랫줄**의 불투명 비율 — 「칸 바닥에 닿는가」 (`맵_지면화.js` 의 `아래비`) */
Renderer.prototype._아래비 = function (fr) {
  if (!fr || !fr.idx || !fr.w || !fr.h) return 0;
  var w = fr.w, base = (fr.h - 1) * w, n = 0;
  for (var x = 0; x < w; x++) if (fr.idx[base + x] >= 0) n++;
  return n / w;
};
/** 프레임 전체의 불투명 비율 — 「꽉 찼는가」 (`맵_지면화.js` 의 `꽉찬비`) */
Renderer.prototype._꽉찬비 = function (fr) {
  if (!fr || !fr.idx || !fr.w || !fr.h) return 0;
  var N = fr.w * fr.h, n = 0;
  for (var i = 0; i < N; i++) if (fr.idx[i] >= 0) n++;
  return n / N;
};
/**
 * ★★★★★ **벽은 눕히면 안 된다** — 「바닥에 닿고 꽉 찬 높은 것」 (2026-08-27 · 사용자 지적 ㉘)
 *
 *   > 사용자: 「맵 오브젝트 렌더링 관련하여 1-5에서 **오브젝트 높이 적용이 덜되었는지**
 *   >  이벤트 이동 도중 **벽면인데 그 위로 캐릭터가 올라가는** 부분이 있어.」
 *
 *   실측(1-5 · YOU01) — 96종 중 **세움이 2종뿐**이었다.
 *   자동 지면화 규칙(`맵_지면화.js`)이 「h 17~63 은 꽉찬비 ≥ 0.2 **또는**
 *   아래비 ≥ 0.9 면 **지면의 턱**으로 보고 눕힌다」라, **벽도 함께 눕혔다.**
 *
 *   눕히면 2.5D 에서 그림이 **바닥에 깔린다** — 높이가 사라져 캐릭터가 그 위를
 *   지나간다. 원본은 320×200 2D 라 오브젝트가 늘 **화면에 그대로** 찍힌다.
 *
 * ☠☠☠ **되돌렸다** (2026-08-27, 같은 날) — 사용자:
 *   > 「벽관련해서, **세우면 안돼. 세우면 화면 깨져 일부러 눕힌거야.**
 *   >  **눕힌건 이미지인거고 실제 판정은 세운것처럼 위에 있어야 하는거야.**」
 *
 *   ⇒ 고칠 것은 **분류가 아니라 그리기 순서**다. 눕힌 그림 그대로 두고,
 *     행별 오버레이가 **캐릭터를 덮게** 해야 한다.
 *     지금은 `preserve-3d` 가 DOM 순서를 무시하고 z 로 정렬해서 안 덮인다.
 *   ★ 아래 판정 함수는 **그대로 둔다** — 「어느 것이 벽인가」는 그 작업에서도 쓴다.
 *
 *   ★★ 사용자: 「벽 세우는건 **차후에 맵 2.5d가 조금더 완벽해지면** 고려해볼 수
 *     있지만 지금 단계에서 **여러가지 시도했었는데 실패**했어. 일단은 눕혀놓는게
 *     맞고 세우는건 **차후 별도 계획**으로 해야해. 아마 **프로젝트 거의 마지막**에서
 *     다루지 않을까 싶어.」
 *     ⇒ **세우지 않는다.** 이 함수는 「덮기」에만 쓴다.
 *
 *   ⇒ 「턱」과 「벽」을 가른다 —
 *     · **턱**: 낮거나(h ≤ 32) 얇다(꽉찬비 낮음). 눕는 것이 맞다
 *     · **벽**: **h ≥ 32 · 꽉찬비 ≥ 0.4 · 아래비 ≥ 0.9** — 바닥에 닿고 속이 찼다
 *
 *   실측 블록 지표 (YOU01 · `mapx._자동.눕힘근거`)
 *   ```
 *   29  h48 꽉0.52 아래1.00   ← ★ 벽 (레인저가 그 위로 지나갔다)
 *   18  h32 꽉0.22 아래0.97   ←   턱 (얇다)
 *   32  h32 꽉0.00 아래0.91   ←   턱 (아래 선만)
 *   22  h48 꽉0.35 아래0.06   ←   천장 쪽 — 세우면 공중에 뜬다
 *   21  h48 꽉0.33 아래0     ←   같음
 *   ```
 *   ★ **아래비를 함께 보는 것이 핵심**이다. 아래비가 0 인 것(칸 바닥에 안 닿는 것)을
 *     세우면 공중에 뜬다 — 지면화 도구가 그것을 눕힌 것은 옳다.
 *   ★ 되돌리는 스위치: `window.__벽승격끄기 = true`
 */
Renderer.prototype._벽인가 = function (o) {
  if (root.__벽승격끄기) return false;
  var fr = o && o.frame;
  if (!fr || fr.h < 32) return false;
  var 키 = o.blockIndex;
  if (!this._벽캐시) this._벽캐시 = {};
  if (this._벽캐시[키] !== undefined) return this._벽캐시[키];
  var r = (this._꽉찬비(fr) >= 0.4) && (this._아래비(fr) >= 0.9);
  this._벽캐시[키] = r;
  return r;
};

/**
 * ★★★★★ **움직이는 타일이 깔린 칸**의 좌표 집합 (2026-08-27)
 *
 * 왜 필요한가 — 사용자 지적: 「용암 주변 오브젝트들이 없이 칼로 자른것처럼
 * 직각으로 보인다」. 원인을 재 보니 **용암 칸 위에 있는 오브젝트 47개가
 * 애니 타일에 통째로 가려지고 있었다**(애니 타일은 투명 픽셀이 0인 불투명).
 *
 * 층 순서는 사용자가 정리한 대로여야 한다:
 *   배경 → 맵 타일 → **맵 타일 애니메이션** → 오브젝트·캐릭터
 * 그런데 눕힌 오브젝트는 지면 캔버스에 **구워져** 있어서 두 번째 층에 섞였고,
 * 세 번째 층(애니)이 그것을 덮었다. 원본 `0x12BEE` 는 한 행에서
 * 타일을 먼저 칠하고 **목록 A(오브젝트)** 를 그 뒤에 그린다 — 순서가 뒤집혀 있었다.
 *
 * `fx.js _맵애니칸` 과 **같은 규칙**으로 고른다: `layerA` 타일의 프레임표가
 * 2장 이상인 칸(YOU01 은 타일 71~74 · 271칸).
 */
Renderer.prototype._애니깔린칸 = function () {
  var m = this.nmap;
  if (!m || !m.tileAnim || !m.layerA) return null;
  var 키 = (m.W | 0) + 'x' + (m.H | 0) + ':' + (m.tileAnim.length | 0);
  if (this._애니칸키 === 키 && this._애니칸집합) return this._애니칸집합;
  var S = {}, W = m.W | 0, H = m.H | 0, x, y, ti, an;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    ti = m.layerA[y * W + x] - 1;
    if (ti < 0 || ti >= m.tileAnim.length) continue;
    an = m.tileAnim[ti];
    if (!an || an.length < 2) continue;
    S[x + ',' + y] = 1;
  }
  this._애니칸키 = 키; this._애니칸집합 = S;
  return S;
};
/** 원본 블록과 높이를 바닥·경계·오브젝트 렌더 종류로 분류한다. */
Renderer.prototype._원본오브젝트분류 = function (bi, height) {
  /* ☠ 무덤 가시를 여기서 'flat' 으로 바꾸던 줄은 걷었다(10-12) — 사장님 「수동으로 지정한 파일에서 … 왜 별도 로직을 넣었어?」 · 「그냥 세우고 … 순수 가시만 세우면」 ⇒ 분류는 파일대로(세움) · 바닥 점만 뺀다(_가시순수URL) */
  var mx = this.mapx || {};
  var explicit = root.G2Map3DMapxObjectGroups &&
    root.G2Map3DMapxObjectGroups.explicitClass(mx, this.nmap, bi, root.G2Native);
  if (explicit) return explicit;
  var 전역 = root.G2블록분류;
  if (전역 && this.nmap && root.G2Native && root.G2Native.blockKey) {
    var k = root.G2Native.blockKey(this.nmap, bi);
    if (k && 전역[k]) return 전역[k];
  }
  if (mx.blocks && mx.blocks[bi]) return mx.blocks[bi];          // 'structure'|'billboard'|'flat'
  if (mx.flatBlocks && mx.flatBlocks.indexOf(bi) >= 0) return 'flat';
  if (height <= TH) return 'flat';                                // 낮은 바닥장식·경계턱
  return 'billboard';                                             // 그 외 = 나무·수풀(세움)
};
/** [리마스터] 용자의 무덤 가시 블록 — 지형값 10(가시) 칸에 놓인 오브젝트 블록 번호표 (2026-10-12)
 *   사장님(원문) 「가시 확인해보니 하이라이트가 세워진게 아니라 가시 오브젝트 옆에 배경이 같이 세워져서 그렇게 보인거네.. 가시그냥 눕히는게 낫겠어.」
 *            · 「아니야 이방식 안돼. … 그냥 가시 눕히는걸로 다시 가줘.」(세운 가시 밝히기 되돌림)
 *   무덤 맵(창1 이식)의 가시는 세워 그리면 가시 둘레 바닥 그림이 함께 선다 → (10-12 고침) 분류는 파일대로(세움) 두고 _세움그림URL 이 바닥 점만 뺀다.
 *   ☠ 한때 여기서 'flat' 으로 눕혔다 — 키 32 눕힘은 지붕 규칙(대열)이라 앞줄 가시가 캐릭터·선택 박스를 덮었고, 사장님이 «파일대로 세우고 순수 가시만» 으로 정하셨다.
 *   맵을 지을 때는 시나리오 이름이 아직 없을 수 있어 맵 출처(SCENARIO/2xx.MAP — 창1 이식 맵은 적용 폴더에만)로도 알아본다. 맵이 바뀌면 다시 센다. */
Renderer.prototype._무덤가시블록표 = function () {
  var m = this.nmap;
  if (this._무덤가시표 && this._무덤가시표맵 === m) return this._무덤가시표;
  var 표 = {};
  try {
    var 이름 = String((root.G2 && root.G2.scene && root.G2.scene['_시나리오']) || '');
    var 경로 = String((m && m._sourceIdentity && m._sourceIdentity.actualRelativePath) || '');
    var 무덤맵 = /^TOMB\d+\.SCE$/i.test(이름) || /(^|[\/\\])2\d\d\.MAP$/i.test(경로);
    if (m && m.layerC && 무덤맵 && root.G2Native && root.G2Native.mapObjects) {
      root.G2Native.mapObjects(m).forEach(function (o) {
        if ((m.layerC[o.y * m.W + o.x] | 0) === 10) 표[o.blockIndex] = 1;
      });
    }
  } catch (e가시) {}
  this._무덤가시표 = 표; this._무덤가시표맵 = m;
  return 표;
};
/** 한 밴드(행 y0..y1) 를 캔버스로 합성 — 지면 + 오브젝트(all=true 면 전부, 아니면 눕힘만). 아래끝 정렬. */
Renderer.prototype._가로띠합성 = function (map, y0, y1, allObjects) {
  var self = this, GW = map.W * TW, full = root.G2Native.mapGround(map, 0);
  var bandH = (y1 - y0) * TH, idx = new Uint8Array(GW * bandH), y;
  for (y = 0; y < bandH; y++) idx.set(full.idx.subarray((y0 * TH + y) * GW, (y0 * TH + y) * GW + GW), y * GW);
  root.G2Native.mapObjects(map).forEach(function (o) {
    if (o.y < y0 || o.y >= y1) return;
    if (!allObjects && self._원본오브젝트분류(o.blockIndex, o.height) !== 'flat') return;
    var fr = o.frame, px = o.x * TW, py = (o.y - y0) * TH + TH - fr.h, yy, xx, ry, rx, v;
    for (yy = 0; yy < fr.h; yy++) { ry = py + yy; if (ry < 0 || ry >= bandH) continue;
      for (xx = 0; xx < fr.w; xx++) { rx = px + xx; if (rx < 0 || rx >= GW) continue;
        v = fr.idx[yy * fr.w + xx]; if (v >= 0) idx[ry * GW + rx] = v; } }
  });
  /* ★★★ **`tr` 을 함께 넘긴다** (2026-08-16 · `.fpm` 배경을 깔면서)
   *
   *   `mapGround` 는 `{w,h,idx,tr:0}` 을 준다 — **타일이 없는 칸은 인덱스 0**이고
   *   `frameToImageData` 가 `fr.tr` 로 투명을 가른다. 여기서 안 넘기면 배경벽이
   *   **전부 불투명**해져 뒤에 깐 `.fpm` 고정 배경을 통째로 가린다
   *   (1-1 `IM05` 는 `foldY = mapH` 라 화면 전체가 배경벽이다).
   *   미러(`remapmirror.js 지면()`)에서도 같은 자리를 이미 겪었다. */
  var 조각 = { w: GW, h: bandH || 1, idx: idx, tr: full.tr };
  var cv = root.G2Native.frameToCanvas(조각, map.palette);
  cv._조각 = 조각;          /* 팔레트만 바뀌면 이 번호판으로 다시 칠한다 (_배경벽다시칠하기) */
  return cv;
};

/**
 * ★★★★★ **행별 눕힘 오버레이** — 원본 `0x12BEE` 의 「행마다 A → C → B」 (2026-08-27)
 *
 *   > 사용자 ②: 「던전 맵 윗부분을 지나가면 **캐릭터가 벽 아래로 들어가야** 하는데
 *   >  벽 위를 지나가는 것처럼 된다」
 *   > 사용자 ①: 「용암타일 주변 오브젝트들이 **직각으로 잘라놓은 것처럼** 안 그려진다」
 *
 *   원본은 한 행씩 모아 **그 자리에서** 그린다 —
 *   ```asm
 *   0x12BEE  루프 edi = 0..0x10 (17행)
 *     0x12C26  call 0x10CBD   ; 맵 오브젝트 한 행 → 목록 A
 *     0x12C2B  call 0x12567   ; 유닛 한 행       → 목록 C / B / D
 *     0x12C37  목록 A 그리기   ; ★ 오브젝트가 **그 행 유닛보다 먼저**
 *     0x12C68  목록 C 그리기
 *     0x12CC8  목록 B 그리기
 *   0x12D33  목록 D            ; 행 루프 **밖** = 맨 위
 *   ```
 *   곧 **아랫줄 오브젝트는 윗줄 캐릭터를 덮는다.**
 *
 *   ☠ 우리는 눕힘(`flat`) 오브젝트를 **지면 한 장에 구워** 버려서 그 대열에
 *     아예 못 들어갔다 — 언제나 캐릭터 **아래**였다.
 *     실측(YOU01 · 1-2·1-5): 오브젝트 562개 중 **flat 560개**가 구워짐.
 *
 *   ⇒ 구운 그림은 그대로 두고(= 캐릭터 없는 곳의 배경), **행마다 투명 캔버스**에
 *     그 행의 눕힘 오브젝트를 **한 번 더** 그려 유닛과 같은 대열(`_sortSprites`)에
 *     넣는다. 캐릭터가 없는 자리에서는 같은 그림이 겹쳐 **색이 같아 티가 안 나고**,
 *     캐릭터가 있는 자리에서만 가림이 되살아난다.
 *   ★ 두 번 그려도 되는 근거 — 눕힘 블록은 **이진 투명**이다
 *     (YOU01 96블록 68,352픽셀 전수: 인덱스는 −1(투명) 아니면 팔레트 번호뿐).
 *
 *   ★ 캔버스는 그 행에 **실제로 그림이 있는 범위**(bbox)만 만든다 —
 *     맵 폭 전체로 잡으면 52행 × 1704px 이라 메모리가 헛되이 든다.
 *   ★ 높이를 16px 로 자르면 안 된다 — 위로 뻗는 오브젝트가 있다(80px 짜리).
 *     그 행 프레임들의 **위·아래 합집합**을 담는다.
 *   ★ 움직이는 눕힘 블록(`_애니블록`)은 굽지도 않았고 `_눕힌애니` 요소로 따로
 *     있으므로 여기서 **뺀다** — 넣으면 정지 그림이 한 장 더 겹친다.
 */
Renderer.prototype._행별눕힘오버레이짓기 = function () {
  var self = this, map = this.nmap;
  (this._rowFlatEls || []).forEach(function (e) { if (e && e.parentNode) e.parentNode.removeChild(e); 판들버리기(e); });   /* 판(그래픽 카드)도 버린다 */
  this._rowFlatEls = [];
  if (!map || !root.G2Native || !root.G2Native.mapObjects) return 0;
  var foldY = this._foldY || 0;

  /* ① 행별로 모은다 — 매 프레임 562개를 훑지 않기 위해 여기서 한 번만 */
  var 행별 = {};
  root.G2Native.mapObjects(map).forEach(function (o) {
    if (o.y < foldY) return;                                   /* 접는선 위는 배경벽이 통째로 그린다 */
    if (self._원본오브젝트분류(o.blockIndex, o.height) !== 'flat') return;
    if (self._애니블록(o.blockIndex)) return;                   /* `_눕힌애니` 가 따로 그린다 */
    if (o.height > TH) return;   /* ★ 여러 행에 걸치는 것은 `_눕힌조각` 이 개별로 그린다 */
    (행별[o.y] || (행별[o.y] = [])).push(o);
  });

  /* ② 행마다 투명 캔버스 한 장 */
  var hw = this.mapW / 2, hh = this.mapH / 2, 만든수 = 0;
  Object.keys(행별).forEach(function (k) {
    var y = k | 0, list = 행별[k];
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    list.forEach(function (o) {
      var fr = o.frame, px = o.x * TW, py = o.y * TH + TH - fr.h;
      if (px < x0) x0 = px;
      if (px + fr.w > x1) x1 = px + fr.w;
      if (py < y0) y0 = py;
      if (py + fr.h > y1) y1 = py + fr.h;
    });
    if (!(x1 > x0 && y1 > y0)) return;
    var w = x1 - x0, h = y1 - y0;
    var idx = new Int16Array(w * h);
    for (var i = 0; i < idx.length; i++) idx[i] = -1;           /* −1 = 투명 */
    list.forEach(function (o) {
      var fr = o.frame, px = o.x * TW - x0, py = o.y * TH + TH - fr.h - y0;
      for (var yy = 0; yy < fr.h; yy++) {
        var ry = py + yy; if (ry < 0 || ry >= h) continue;
        for (var xx = 0; xx < fr.w; xx++) {
          var rx = px + xx; if (rx < 0 || rx >= w) continue;
          var v = fr.idx[yy * fr.w + xx];
          if (v >= 0) idx[ry * w + rx] = v;
        }
      }
    });
    var 조각 = { w: w, h: h, idx: idx, tr: -1 };
    var cv = root.G2Native.frameToCanvas(조각, map.palette);
    var e = el('div', 'g2-rowflat', self.spriteLayer);
    e._조각 = 조각;
    e._바탕 = { cv: cv, pal: map.palette, 필터: root.G2Scaler ? root.G2Scaler.cur() : 'none' };   /* 팔레트 GPU 판의 바탕 */                      /* ★ 팔레트만 바뀌면 이것으로 다시 칠한다 */
    e.style.cssText = 'position:absolute;pointer-events:none;' +
      'image-rendering:' + rend() + ';' +
      'left:' + (x0 - hw) + 'px;top:' + (y0 - hh) + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;';
    /* ★ 2026-09-25 PNG 로 굽지 않고 캔버스를 그대로 붙인다 — 팔레트가 바뀔 때 toDataURL 이 33장 29ms 를 먹었다(Z-47 · 원본은 DAC 표만 교체).
     *   캔버스는 N배 그림이고 CSS 로 논리 크기에 눌러 담는다(스케일러 bg 와 같은 뜻) */
    행캔버스붙이기(e, cv, w, h);
    /* ★ 눕힌다 — `_빌보드적용` 가 `'floor'` 면 `transform:none` 으로 둔다 */
    e._billboardMode = 'floor';
    e._row = y;
    e._kind = -1;            /* 목록 A — 같은 행에서 유닛(C=1)·공격유닛(B=2)보다 **먼저** */
    e._sortY = y * TH + TH;
    self._rowFlatEls.push(e);
    self.objEls.push(e);     /* `_sortSprites` 가 대열에 넣는다 */
    만든수++;
  });
  try { 만든수 += this._행별세움짓기(); } catch (e세움) { try { console.warn('[행별 세움] ' + (e세움 && e세움.message)); } catch (x) {} }
  return 만든수;
};

/* mapx 명시 건물 preview 동안 선택한 짧은 B만 행별 눕힘 판에서 제외한다.
 * 기존 판의 크기·정렬 자리는 그대로 두고 공통 mapObjects 결과를 다시 그린다. */
Renderer.prototype._map3D짧은B행제외 = function (mapView, parts) {
  var self = this, map = this.nmap;
  if (!map || !mapView || Object.getPrototypeOf(mapView) !== map ||
      !Array.isArray(parts) || !parts.length || !root.G2Native ||
      !root.G2Native.mapObjects || !root.G2Native.frameToCanvas)
    throw new TypeError('현재 MAP의 명시 짧은 B가 필요하다');
  var rows = new Set(parts.map(function (part) { return part.y; }));
  var byRow = new Map();
  root.G2Native.mapObjects(mapView).forEach(function (o) {
    if (!rows.has(o.y) || self._원본오브젝트분류(o.blockIndex, o.height) !== 'flat' ||
        self._애니블록(o.blockIndex) || o.height > TH) return;
    if (!byRow.has(o.y)) byRow.set(o.y, []);
    byRow.get(o.y).push(o);
  });
  var ready = [];
  rows.forEach(function (y) {
    var matches = (self._rowFlatEls || []).filter(function (e) {
      return e && e.parentNode && e.classList &&
        e.classList.contains('g2-rowflat') &&
        !e.classList.contains('g2-rowstand') && e._row === y && e._조각;
    });
    if (matches.length !== 1) throw new TypeError('원본 행별 눕힘 판을 찾을 수 없다: ' + y);
    var e = matches[0], old = e._조각, left = Number.parseFloat(e.style.left) + self.mapW / 2;
    var top = Number.parseFloat(e.style.top) + self.mapH / 2;
    if (!Number.isInteger(left) || !Number.isInteger(top))
      throw new TypeError('원본 행별 판의 좌표가 잘못됐다');
    var idx = new Int16Array(old.w * old.h); idx.fill(-1);
    (byRow.get(y) || []).forEach(function (o) {
      var fr = o.frame, x0 = o.x * TW - left, y0 = o.y * TH + TH - fr.h - top;
      for (var yy = 0; yy < fr.h; yy++) for (var xx = 0; xx < fr.w; xx++) {
        var x = x0 + xx, py = y0 + yy, value = fr.idx[yy * fr.w + xx];
        if (x >= 0 && py >= 0 && x < old.w && py < old.h && value >= 0)
          idx[py * old.w + x] = value;
      }
    });
    var removed = parts.filter(function (part) { return part.y === y; }).map(function (part) {
      var bi = map.layerB[part.y * map.W + part.x] - 1;
      var fr = map.decodeBlock(bi);
      if (!fr) throw new TypeError('선택 B 원본 프레임이 없다');
      return { x0: part.x * TW - left,
        y0: (part.y + 1) * TH - fr.h - top,
        x1: part.x * TW - left + fr.w,
        y1: (part.y + 1) * TH - top };
    });
    for (var at = 0; at < idx.length; at++) {
      if (idx[at] === old.idx[at]) continue;
      var px = at % old.w, py = Math.floor(at / old.w);
      if (!removed.some(function (box) {
        return px >= box.x0 && px < box.x1 && py >= box.y0 && py < box.y1;
      })) throw new TypeError('선택 B 바깥의 행별 그림이 달라졌다');
    }
    // 짧은 B를 잠시 뺄 때 현재 행판은 팔레트·음영·스케일러가 이미
    // 적용된 화면일 수 있다. 원본 인덱스만 다시 칠하면 off에서 다른 색이 남는다.
    ready.push({ el: e, old: old,
      oldCanvas: e._칠캔버스, oldBase: e._바탕,
      oldColorCache: e._칠캐시, oldRowCanvas: e._행칠캔,
      oldPaintedPalette: e._칠한팔,
      next: { w: old.w, h: old.h, idx: idx, tr: -1 } });
  });
  function setFrame(item, frame) {
    판들버리기(item.el);
    item.el._조각 = frame;
    item.el._칠캐시 = {};
    item.el._행칠캔 = null;
    var pal = self._palette || map.palette;
    var cv = root.G2Native.frameToCanvas(frame, pal);
    item.el._바탕 = { cv: cv, pal: map.palette,
      필터: root.G2Scaler ? root.G2Scaler.cur() : 'none' };
    행캔버스붙이기(item.el, cv, frame.w, frame.h);
  }
  function restoreFrame(item) {
    판들버리기(item.el);
    item.el._조각 = item.old;
    item.el._바탕 = item.oldBase;
    item.el._칠캐시 = item.oldColorCache;
    item.el._행칠캔 = item.oldRowCanvas;
    item.el._칠한팔 = item.oldPaintedPalette;
    if (item.oldCanvas) 행캔버스붙이기(item.el, item.oldCanvas,
      item.old.w, item.old.h);
    else setFrame(item, item.old);
  }
  var changed = [], closed = false;
  try {
    ready.forEach(function (item) { changed.push(item); setFrame(item, item.next); });
  } catch (error) {
    changed.forEach(function (item) { restoreFrame(item); });
    throw error;
  }
  return { isCurrent: function () {
      return !closed && self.nmap === map && ready.every(function (item) {
        return item.el.parentNode && item.el._조각 === item.next;
      });
    },
    close: function () {
      if (closed) return;
      closed = true;
      ready.forEach(function (item) {
        if (item.el._조각 === item.next) restoreFrame(item);
      });
    } };
};

/* ★★★★★ [리마스터] **기울기 0 에서는 세운 오브젝트도 줄마다 한 장으로 굽는다** (2026-10-03 · 사장님 Z-75)
 *   > 「그리고 오브젝트 타일에 맵과 경계가 보여. 원본은 없어. 얇게 어긋난것처럼 보이는 선이야.」
 *   > 사장님 선택 「맵 캔버스에 직접 그림」
 *   실측(2-3 · 배율 4.29 · 화면 배율 1.25): 오브젝트 조각 224개의 위·아래 가장자리가 **전부 소수점 자리**였다.
 *   DOM 요소 가장자리는 덮인 만큼 바탕과 섞여 그려진다(가장자리 안티에일리어싱) — 그것이 얇은 선이다.
 *   원본은 한 화면 버퍼에 줄마다(0x12D65 행 루프 · 오브젝트 → 그 줄 유닛) 찍으므로 그런 선이 없다.
 *   ⇒ 그 줄의 세운 오브젝트(structure·billboard · 움직이지 않는 것)를 **투명 캔버스 한 장**에 굽는다.
 *     캔버스 안의 경계는 최근접 표본이라 섞이지 않는다. 그리는 차례는 원래 줄 조각과 같다(_sortY = 줄 아랫변 · _kind 0).
 *   ☠ 바닥 캔버스 한 장에 통째로 구우면 «앞 줄 나무가 뒤 줄 캐릭터를 가리는 것»이 깨진다 — 그래서 줄마다다.
 *   ★ 기울이거나 돌리면 원래 조각(세워 그리는 빌보드)으로 돌아간다 — _세움표시적용 이 매 apply 에서 고른다.
 *   ★ _rowFlatEls 에 함께 넣어 팔레트 바뀜·스케일러(_행오버레이_다시칠하기)를 그대로 탄다. */
Renderer.prototype._행별세움짓기 = function () {
  var self = this, map = this.nmap;
  this._세움칸 = {};
  if (!map || !root.G2Native || !root.G2Native.mapObjects || typeof document === 'undefined') return 0;
  var foldY = this._foldY || 0, 행별 = {};
  root.G2Native.mapObjects(map).forEach(function (o) {
    if (o.y < foldY) return;                                   /* 접는선 위는 배경벽이 통째로 그린다 */
    var kind = self._원본오브젝트분류(o.blockIndex, o.height);
    if (kind !== 'structure' && kind !== 'billboard') return;
    if (self._애니블록(o.blockIndex)) return;                   /* 움직이는 것은 조각 그대로 */
    (행별[o.y] || (행별[o.y] = [])).push(o);
  });
  var hw = this.mapW / 2, hh = this.mapH / 2, 만든수 = 0;
  Object.keys(행별).forEach(function (k) {
    var y = k | 0, list = 행별[k];
    var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    list.forEach(function (o) {
      var fr = o.frame, px = o.x * TW, py = o.y * TH + TH - fr.h;   /* 아랫변을 그 줄에 — 0x10D0D~0x10D1A */
      if (px < x0) x0 = px; if (px + fr.w > x1) x1 = px + fr.w;
      if (py < y0) y0 = py; if (py + fr.h > y1) y1 = py + fr.h;
    });
    if (!(x1 > x0 && y1 > y0)) return;
    var w = x1 - x0, h = y1 - y0, idx = new Int16Array(w * h);
    for (var i = 0; i < idx.length; i++) idx[i] = -1;
    list.forEach(function (o) {
      var fr = o.frame, px = o.x * TW - x0, py = o.y * TH + TH - fr.h - y0;
      for (var yy = 0; yy < fr.h; yy++) {
        var ry = py + yy; if (ry < 0 || ry >= h) continue;
        for (var xx = 0; xx < fr.w; xx++) {
          var rx = px + xx; if (rx < 0 || rx >= w) continue;
          var v = fr.idx[yy * fr.w + xx];
          if (v >= 0) idx[ry * w + rx] = v;                      /* 같은 줄 안은 x 차례로 덮는다(원본 0x10D4E 열 루프) */
        }
      }
      self._세움칸[o.x + ',' + o.y] = 1;
    });
    var 조각 = { w: w, h: h, idx: idx, tr: -1 };
    var cv = root.G2Native.frameToCanvas(조각, map.palette);
    var e = el('div', 'g2-rowflat g2-rowstand', self.spriteLayer);
    e._조각 = 조각;
    e._바탕 = { cv: cv, pal: map.palette, 필터: root.G2Scaler ? root.G2Scaler.cur() : 'none' };
    e.style.cssText = 'position:absolute;pointer-events:none;' +
      'image-rendering:' + rend() + ';' +
      'left:' + (x0 - hw) + 'px;top:' + (y0 - hh) + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;';
    행캔버스붙이기(e, cv, w, h);
    e._billboardMode = 'floor';          /* 기울기 0 에서만 보이므로 세우지 않아도 같다 */
    e._세움행 = true;
    e._row = y;
    e._kind = 0;                         /* 원래 줄 조각과 같은 자리 — 같은 줄 유닛보다 먼저 */
    e._sortY = y * TH + TH;
    self._rowFlatEls.push(e);
    self.objEls.push(e);
    만든수++;
  });
  this._세움표시상태 = null;             /* 다음 apply 에서 다시 고른다 */
  return 만든수;
};
/** 기울기·회전이 0 이면 줄 캔버스를, 아니면 원래 조각을 보인다 (Z-75) */
Renderer.prototype._세움표시적용 = function () {
  var 칸 = this._세움칸; if (!칸) return;
  var c = this.cam || {}, 평면 = !(c.tilt) && !(c.rot);
  var 열쇠 = (평면 ? 1 : 0) + ':' + (this.objEls ? this.objEls.length : 0);
  if (this._세움표시상태 === 열쇠) return;
  this._세움표시상태 = 열쇠;
  var self = this;
  (this.objEls || []).forEach(function (e) {
    if (!e) return;
    var 숨김;
    if (e._세움행) 숨김 = !평면;
    else {
      var cl = e.classList;
      if (!cl || !(cl.contains('g2-map-object-strip') || cl.contains('g2-map-structure'))) return;
      var 다구움 = true;
      if (e._colParts && e._colParts.length) {
        for (var i = 0; i < e._colParts.length; i++) if (!칸[(e._colParts[i]._col | 0) + ',' + (e._row | 0)]) { 다구움 = false; break; }
      } else if (e._col != null) 다구움 = !!칸[(e._col | 0) + ',' + (e._row | 0)];
      else 다구움 = false;
      if (!다구움) return;
      숨김 = 평면;
    }
    if (e._세움숨김 !== 숨김) {
      e._세움숨김 = 숨김;
      var 표시 = (숨김 || e._묶음숨김) ? 'none' : '';  /* 묶음 숨김과 함께 본다 (_FR08나무표시적용) */
      if (self._맵가림 && e._옛display !== undefined) {
        e._옛display = 표시;
        e.style.display = 'none';
      } else e.style.display = 표시;
    }
  });
};

/**
 * ★★★★★ **행 오버레이를 팔레트만 갈아 다시 칠한다** (2026-09-10)
 *
 *   `_buildRowFlatOverlays()` 는 **픽셀 버퍼를 처음부터 다시 만든다**(562개 오브젝트를
 *   훑고 행마다 겹쳐 그린다) — 실측 **44 ms**. 팔레트만 바뀌었으면 버퍼는 그대로이므로
 *   **다시 칠하기만** 하면 된다. 요소도 자리도 그대로 둔다.
 */
/* 행 오버레이 요소에 캔버스를 자식으로 붙인다 — 이미 있으면 갈아 끼운다(같은 캔버스면 그대로) */
/* ★★ 스케일러가 켜져 있을 때 팔레트만 바뀌면 «다시 확대»하지 않고 «색 차이만 얹는다» (2026-09-25 사장님 선택 ①)
 *   > 사장님: 「덮히기는 하는데 많이 느려」 — xBRZ 2배에서 바닥 1152×576 을 걸음마다 다시 확대해 110ms 가 들었다.
 *   처음 한 번 확대해 두고 확대 픽셀마다 «가장 가까운 원래 색 번호»를 기억한다.
 *   팔레트가 바뀌면 번호별 (새 색 − 바탕 색)을 픽셀에 더한다. 필터가 섞은 가장자리 픽셀만 근사다.
 *   판 = { W, H, lw, lh, rgba, idx(확대 크기) } */
function 확대판만들기(fr, 바탕팔) {
  var cv = root.G2Native.frameToCanvas(fr, 바탕팔);
  var W = cv.width, H = cv.height, lw = cv.논리w || fr.w, lh = cv.논리h || fr.h, N = W / lw;
  var rgba = cv.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  var src = fr.idx, fw = fr.w, fh = fr.h, tr = fr.tr, trA = Array.isArray(tr) ? tr : null, P = 바탕팔;
  var A = new Int16Array(W * H), B = new Int16Array(W * H), wt = new Uint8Array(W * H);
  function 투명(c) { return trA ? trA.indexOf(c) >= 0 : (tr != null ? c === tr : c < 0); }   /* native frameToImageData 와 같은 규칙 */
  var 후보 = new Int16Array(9);
  for (var y = 0; y < H; y++) {
    var sy = (y / N) | 0, 칸 = y * W, fy = (y + 0.5) / N - 0.5;
    for (var x = 0; x < W; x++) {
      var p = 칸 + x, q = p * 4, sx = (x / N) | 0, fx = (x + 0.5) / N - 0.5;
      A[p] = -1; B[p] = -1; wt[p] = 255;
      if (!rgba[q + 3]) continue;
      /* 이웃 3×3 의 불투명 원래 색 — 가장 가까운 것이 A */
      var n후 = 0, a = -1, 최 = 1e9;
      for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) {
        var nx = sx + dx, ny = sy + dy; if (nx < 0 || ny < 0 || nx >= fw || ny >= fh) continue;
        var v = src[ny * fw + nx]; if (투명(v) || v < 0 || v > 255) continue;
        var dd = (nx - fx) * (nx - fx) + (ny - fy) * (ny - fy); if (dd < 최) { 최 = dd; a = v; }
        var 있 = false; for (var j = 0; j < n후; j++) if (후보[j] === v) { 있 = true; break; }
        if (!있) 후보[n후++] = v;
      }
      if (a < 0) continue;
      A[p] = a; B[p] = a;
      var r = rgba[q], g = rgba[q + 1], b = rgba[q + 2];
      var ar = P[a * 3], ag = P[a * 3 + 1], ab = P[a * 3 + 2];
      var sr = r - ar, sg = g - ag, sb = b - ab, 오 = sr * sr + sg * sg + sb * sb;
      if (오 <= 12) continue;                                        /* A 한 색 그대로 */
      /* 필터가 섞은 픽셀 — rgb ≈ (1−t)·A + t·B 가 되는 B·t 를 이웃에서 찾는다 */
      for (var k = 0; k < n후; k++) {
        var c2 = 후보[k]; if (c2 === a) continue;
        var vr = P[c2 * 3] - ar, vg = P[c2 * 3 + 1] - ag, vb = P[c2 * 3 + 2] - ab, vv = vr * vr + vg * vg + vb * vb;
        if (!vv) continue;
        var t = (sr * vr + sg * vg + sb * vb) / vv; if (t < 0) t = 0; else if (t > 1) t = 1;
        var er = sr - t * vr, eg = sg - t * vg, eb = sb - t * vb, e2 = er * er + eg * eg + eb * eb;
        if (e2 < 오) { 오 = e2; B[p] = c2; wt[p] = Math.round((1 - t) * 255); }
      }
    }
  }
  return { W: W, H: H, lw: lw, lh: lh, rgba: rgba, A: A, B: B, wt: wt, 바탕: 바탕팔 };
}
/** 판의 논리 사각형(sx,sy,w,h)을 새 팔레트로 캔버스 c 에 칠한다 — 섞인 픽셀은 두 색의 차이를 그 비율로 더한다 */
function 확대판조각칠하기(판, pal, c, sx, sy, w, h) {
  if (판.gpu) {
    if (root.G2PaletteGPU && root.G2PaletteGPU.칠하기(판.gpu, pal, c, sx, sy)) return;   /* 그래픽 카드 길 */
    /* ☠ 그래픽 카드가 못 칠했다(문맥을 잃는 등) — GPU 판엔 CPU 자료가 없어 예외가 나 뒤 조각이 하얗게 남았다
     *   (2026-09-26 사장님 「아직도 이런식으로 안지워지는 부분이 생겨」) ⇒ 이 자리에서 CPU 판으로 바꿔 칠한다 */
    var 대 = 확대판만들기(판.원fr, 판.원바탕);
    판하나버리기(판); for (var 열 in 대) 판[열] = 대[열]; 판._팔 = null;
  }
  if (판._팔 !== pal) { var d = 판._d || (판._d = new Int16Array(768)), b0 = 판.바탕; for (var i = 0; i < 768; i++) d[i] = (pal[i] | 0) - (b0[i] | 0); 판._팔 = pal; }
  var dt = 판._d, N = 판.W / 판.lw, X0 = Math.round(sx * N), Y0 = Math.round(sy * N);
  var CW = c.width, CH = c.height, W = Math.min(CW, 판.W - X0), H = Math.min(CH, 판.H - Y0);
  var g = c.getContext('2d', { willReadFrequently: true }), im = g.createImageData(CW, CH);
  var o = im.data, s = 판.rgba, AA = 판.A, BB = 판.B, WT = 판.wt;
  for (var y = 0; y < H; y++) {
    var p = (Y0 + y) * 판.W + X0, q = y * CW * 4, sq = p * 4;
    for (var x = 0; x < W; x++, p++, q += 4, sq += 4) {
      var a = AA[p];
      if (a < 0) { o[q] = s[sq]; o[q + 1] = s[sq + 1]; o[q + 2] = s[sq + 2]; }
      else {
        var ka = a * 3, bb = BB[p];
        if (bb === a) { o[q] = s[sq] + dt[ka]; o[q + 1] = s[sq + 1] + dt[ka + 1]; o[q + 2] = s[sq + 2] + dt[ka + 2]; }
        else {
          var kb = bb * 3, u = WT[p], v = 255 - u;
          o[q] = s[sq] + (dt[ka] * u + dt[kb] * v) / 255;
          o[q + 1] = s[sq + 1] + (dt[ka + 1] * u + dt[kb + 1] * v) / 255;
          o[q + 2] = s[sq + 2] + (dt[ka + 2] * u + dt[kb + 2] * v) / 255;
        }
      }
      o[q + 3] = s[sq + 3];
    }
  }
  g.putImageData(im, 0, 0);
}
function 확대판칠하기(판, pal) {
  var cv = document.createElement('canvas'); cv.width = 판.W; cv.height = 판.H;
  확대판조각칠하기(판, pal, cv, 0, 0, 판.lw, 판.lh);
  cv.논리w = 판.lw; cv.논리h = 판.lh;
  return cv;
}
/** 판을 얻는다(없으면 만든다) — 주인 객체에 필터별로 쥔다. fr 이 함수면 만들 때만 푼다
 *   바탕그림({cv, pal, 필터})이 있고 그래픽 카드를 쓸 수 있으면 GPU 판(palettegpu.js)을 만든다 — 그림을 다시 확대하지 않는다 */
function 확대판얻기(주인, 열쇠, fr, 바탕팔, 바탕그림) {
  var S = root.G2Scaler, 지연 = (typeof fr === 'function');
  var 판들 = 주인._확대판 || (주인._확대판 = {}), k = S.cur() + '|' + 열쇠, 판 = 판들[k];
  if (!판 || (!지연 && 판.fr !== fr)) {
    var f1 = 지연 ? fr() : fr; if (!f1) return null;
    if (판) 판하나버리기(판);
    /* ☠ 스케일러를 바꾸면 옛 필터용 판이 그래픽 카드에 쌓였다 — 새 판을 만들 때 같은 열쇠의 다른 필터 판을 치운다 (2026-09-26 「다시 느려졌는데」) */
    Object.keys(판들).forEach(function (kk) {
      if (kk !== k && kk.slice(kk.indexOf('|') + 1) === String(열쇠)) { 판하나버리기(판들[kk]); delete 판들[kk]; }
    });
    var G = root.G2PaletteGPU, gp = null;
    if (G && 바탕그림 && 바탕그림.cv && 바탕그림.필터 === S.cur() && G.준비()) gp = G.판올리기(바탕그림.cv, f1, 바탕그림.pal);
    판 = 판들[k] = gp ? { W: gp.W, H: gp.H, lw: gp.lw, lh: gp.lh, gpu: gp, 원fr: f1, 원바탕: 바탕그림.pal } : 확대판만들기(f1, 바탕팔);
    판.fr = 지연 ? null : fr;
  }
  return 판;
}
function 판하나버리기(판) { if (판 && 판.gpu && root.G2PaletteGPU) { root.G2PaletteGPU.버리기(판.gpu); 판.gpu = null; } }
/** 주인이 쥔 판을 모두 버린다 — 맵·행 오버레이를 새로 지을 때(그래픽 카드 메모리가 새지 않게) */
function 판들버리기(주인) {
  if (!주인 || !주인._확대판) return;
  Object.keys(주인._확대판).forEach(function (k) { 판하나버리기(주인._확대판[k]); });
  주인._확대판 = null;
}
/** 요소가 지금 창 안에 보이나 — 안 보이는 조각은 들어올 때 칠한다(apply → _밀린칠하기) */
/* ★ 팔레트 한 걸음 동안은 «화면 안인가»를 걸음 머리에 한 번 몰아 잰 값으로 쓴다 (2026-10-07)
 *   사장님(원문) 「1, 3은 기존 게임 진행 및 흐름에 문제 없도록 신중하게 수정해줘」 — 3 렌더링 잔여
 *   실측(9344 탭 3-3A · 선라이트 한 번): getBoundingClientRect 2.7만 번 · 칠하기 사이 스타일 쓰기 때문에 잴 때마다 배치를 다시 계산했다.
 *   걸음 안에서는 카메라·변환이 안 바뀐다 — 걸음 끝 apply «앞»에서 값을 버린다(팔레트만갈기 끝). 걸음 밖에서는 예전대로 그때그때 잰다. */
var 창안판 = null;
function 창안인가(e) {
  if (창안판 && e._창안판 === 창안판) return e._창안;
  var r = e.getBoundingClientRect();
  var v = r.right > 0 && r.bottom > 0 && r.left < (root.innerWidth || 1e9) && r.top < (root.innerHeight || 1e9) && r.width > 0;
  if (창안판) { e._창안판 = 창안판; e._창안 = v; }
  return v;
}
/** 걸음 머리 — 칠할 조각들의 자리를 한 번에 읽는다(쓰기 전에 읽기만 모아 배치 계산을 한 번으로) */
function 창안몰아재기(R) {
  창안판 = {};
  var 모음 = [];
  (R._rowFlatEls || []).forEach(function (e) { if (e) 모음.push(e); });
  if (R.floorLayer) [].push.apply(모음, R.floorLayer.querySelectorAll('.g2-floor'));
  [R.objLayer, R.flatObjLayer, R.backdropEl].forEach(function (층) {
    if (층 && 층.querySelectorAll) [].push.apply(모음, 층.querySelectorAll('div,span'));
  });
  for (var i = 0; i < 모음.length; i++) 창안인가(모음[i]);
}
/** 팔레트 한 벌로 그림을 낸다 — 스케일러가 꺼져 있으면 예전대로, 켜져 있으면 판(주인 객체에 필터별로 쥔다)에 색 차이만 얹는다 */
function 팔레트그림(주인, 열쇠, fr, pal, 바탕팔, 바탕그림) {
  var S = root.G2Scaler;
  var 지연 = (typeof fr === 'function');           /* 함수면 판을 만들 때만 푼다(블록은 풀 때마다 새 객체라 같은지 못 본다) */
  if (!S || S.N() <= 1 || !바탕팔) { var f0 = 지연 ? fr() : fr; return f0 ? root.G2Native.frameToCanvas(f0, pal) : null; }
  var 판 = 확대판얻기(주인, 열쇠, fr, 바탕팔, 바탕그림); if (!판) return null;
  return 확대판칠하기(판, pal);
}
function 행캔버스붙이기(e, cv, w, h) {
  if (!e || !cv) return;
  if (e._칠캔버스 === cv) return;
  cv.style.position = 'absolute'; cv.style.left = '0'; cv.style.top = '0';
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.style.imageRendering = rend(); cv.style.pointerEvents = 'none';
  if (e._칠캔버스 && e._칠캔버스.parentNode === e) e.replaceChild(cv, e._칠캔버스); else e.appendChild(cv);
  e._칠캔버스 = cv;
}
Renderer.prototype._행오버레이_다시칠하기 = function (pal, 딱지) {
  var n = 0, 바탕 = this._palSaved || this._음영바탕 || pal, self = this;
  var 확대 = !!(root.G2Scaler && root.G2Scaler.N() > 1);
  (this._rowFlatEls || []).forEach(function (e) {
    if (!e || !e._조각) return;
    if (확대) {
      /* 스케일러 — 줄마다 캔버스 하나를 두고 보이는 줄만 이 걸음에 칠한다(바닥과 같은 까닭 · _바닥확대칠하기) */
      var 판 = 확대판얻기(e, '행', e._조각, 바탕, e._바탕); if (!판) return;
      var c = e._행칠캔;
      if (!c || c.width !== 판.W || c.height !== 판.H) { c = e._행칠캔 = document.createElement('canvas'); c.width = 판.W; c.height = 판.H; e._칠한팔 = null; }
      행캔버스붙이기(e, c, e._조각.w, e._조각.h);
      try { self._칠맡기기(e, 판, pal, c, 0, 0, e._조각.w, e._조각.h); } catch (e칠) { e._칠한팔 = null; try { console.warn('[행칠] ' + (e칠 && e칠.message)); } catch (x) {} }
      n++;
      return;
    }
    /* ★ 한 번 구운 것은 **딱지별로 쥔다** — 음영을 켰다 껐다 해도 다시 안 굽는다 */
    var 캐 = e._칠캐시 || (e._칠캐시 = {});
    var k = (root.G2Scaler ? root.G2Scaler.cur() + '|' : '') + (딱지 == null ? '?' : String(딱지));   /* 필터가 바뀌면 옛 배율 그림을 안 쓴다 */
    if (!캐[k]) {
      if (Object.keys(캐).length >= 16) { 캐 = e._칠캐시 = {}; }     /* 서서히 바뀌는 팔레트(딱지가 매번 다름)로 캐시가 끝없이 커지지 않게 */
      캐[k] = 팔레트그림(e, '행', e._조각, pal, 바탕);   /* ★ PNG 없이 캔버스 그대로 (2026-09-25 Z-47) · 스케일러면 색 차이만 얹는다 */
    }
    행캔버스붙이기(e, 캐[k], e._조각.w, e._조각.h);
    n++;
  });
  return n;
};

/** 원본 맵 적용 — 전투.html 의 async 자산 로드에서 호출. */
/* ══════════════ 팔레트 섞기 — 0x30824 / 0x5F9AE ═══════════════════════
 *
 * 원본은 화면이 **8비트 인덱스 프레임버퍼**라 팔레트만 바꾸면 화면 전체 색이
 * 한 번에 돈다. 우리는 트루컬러 캔버스라 **다시 굽는** 수밖에 없는데,
 * 이 연출은 **페이드가 아니라 한 번**(`0x5FD1C` 가 한 번 써 넣고 끝)이라
 * 연출 시작에 한 번, 끝에 한 번만 구우면 된다. 매 프레임 부담이 아니다.
 *
 * 되돌리기는 `0x3B546 call 0x5F9AE` — 저장해 둔 256색을 통째로 다시 쓴다.
 *
 * ※ CSS 필터로는 대체할 수 없다. 바뀌는 것은 **인덱스 0x60~0xFF 뿐**이고
 *   0x00~0x5F(UI·글꼴)는 그대로여야 한다 — 화면 전체 필터와 결과가 다르다.
 * ──────────────────────────────────────────────────────────────────── */

/**
 * @param {number} colorIdx  섞을 색 번호 (블리자드 스톰은 0 = 검정, `0x3B04D`)
 * @param {number} pct       퍼센트 (블리자드 스톰은 40, `0x3B043 edx = 0x28`)
 * @param {number} [from]    시작 인덱스 (기본 0x60 — `0x30842 eax = 0x60`)
 * @param {number} [to]      끝 인덱스(미포함, 기본 0x100)
 */
Renderer.prototype.setPaletteMix = function (colorIdx, pct, from, to, keepPct, 옵션) {
  if (!root.G2Native || !root.G2Native.mixPalette) return this;
  var base = this._palSaved || this._유닛팔레트();
  if (!base) return this;
  /* ★ 일반 필살 암전은 «곱하기만»(섞기 0 · 리맵 keepPct)이다 — 맵은 CSS 밝기로 건다 (2026-10-01 사장님 「1로 진행해줘」)
   *   ☠ 팔레트로 다시 칠하면 xBRZ 4배 · 2-4A(57×53)에서 필살 시작마다 605ms 화면이 섰다
   *     (바닥 309 · 행 그림 155 · 오브젝트 108 · 배경벽 19 — 계측). 유닛은 이미 같은 일을 CSS 로 한다(연출밝은유닛).
   *   scalePalette 는 색 × keepPct ÷ 100(내림) — brightness(keepPct/100) 와 255 단계 중 1 이하 차이.
   *   맵 팔레트(nmap.palette)는 안 바꾼다 — 이펙트·유닛은 원래도 «치환 전» DAC(_dacPal)로 굽는다(_유닛팔레트 주석).
   *   부르는 쪽이 { css: true } 를 줄 때만(일반 필살 두 곳) — 초필살은 뒤이어 «지금 팔레트» 기준 누적 섞기가 붙을 수 있어 옛 길 그대로. */
  if (옵션 && 옵션.css && (pct | 0) === 0 && keepPct != null && from == null && to == null && !this._palSaved) {
    var 그대로 = root.G2Native.mixPalette(base, colorIdx, 0, from, to);
    this._dacPal = 그대로;
    this._유닛쓸팔 = 그대로;
    this._css암전걸기('brightness(' + (Math.min(100, Math.max(0, keepPct | 0)) / 100) + ')');
    return this;
  }
  /* ★ 가벼운 초필살 암전 (2026-10-13 · 팔레트 정리 ③) — 검정 쪽 섞기 + 리맵이면 맵은 CSS 밝기 · 유닛만 다시 칠한다 */
  if (this._가벼운암전쓸까(colorIdx, from, to, keepPct, base)) {
    this._가벼운암전바탕 = base;
    this._css암전배 = 1 - Math.min(100, Math.max(0, pct | 0)) / 100;
    return this._가벼운암전걸기(root.G2Native.mixPalette(base, colorIdx, pct, from, to), keepPct);
  }
  this._palSaved = this._palSaved || base;                 // 0x30831 — 원본 저장
  var pal = root.G2Native.mixPalette(base, colorIdx, pct, from, to);
  /* ★ 리맵 전 «DAC 몫» — 원본은 DAC(0x30824)와 화면 리맵(0x454D5)이 따로다. 누적 섞기(팔레트다시섞기)와 계측이 이것을 본다 (2026-09-26) */
  this._dacPal = (keepPct != null) ? pal : null;
  this._유닛쓸팔 = (keepPct != null) ? pal : null;          /* 유닛은 리맵 없이 (위 ① 주석) */
  /* ★ 화면 리맵(`0x454D5` → `0x5EE2B`)까지 같이 얹는다.
   *   원본은 매 프레임 화면 (16,4)-(304,196) 을 리맵 표로 훑어 **밝기 40%**(단계 0,
   *   `0x55C68` 강도 60) 로 낮춘다. 팔레트 섞기(×0.6)와 **곱해져** 최종 ≈ 0.24 다.
   *   우리는 트루컬러라 화면을 훑는 대신 팔레트에 곱해 두면 결과가 같다. */
  if (keepPct != null && root.G2Native.scalePalette)
    pal = root.G2Native.scalePalette(pal, keepPct);        // 리맵은 전 인덱스
  /* ★ 켤 때도 색만 칠한다 — 끌 때(clearPaletteMix)와 같은 가벼운 길 (2026-10-01 사장님 「끊김이 있는 것 자체가 문제야」)
   *   ☠ 여기만 _팔레트반영(맵 통째로 다시 짓기)이라 필살 시작마다 50ms(TESTWC) · 큰 맵 175ms 화면이 섰다(계측 — 끊긴 장 0~66ms 가 이것).
   *   딱지 = 섞기 인자 + 바탕 해시 — 같은 필살을 다시 쓰면 바닥 그림을 그대로 꺼내 쓴다. 못 칠하는 판(맵 없음 등)은 예전대로 */
  if (this.팔레트만갈기 && this.nmap && this._floorIdx) {
    var 합 = 0; for (var hi = 0; hi < base.length; hi++) 합 = (합 * 31 + base[hi]) | 0;
    this.팔레트만갈기(pal, '섞기:' + colorIdx + ':' + pct + ':' + from + ':' + to + ':' + keepPct + ':' + 합);
    return this;
  }
  this._팔레트반영(pal);
  return this;
};

/**
 * 현재 화면 팔레트를 기준으로 한 번 더 섞는다 — `0x307A6` 계열.
 *
 * `setPaletteMix()`는 연출 시작 시 저장한 원본 팔레트를 기준으로 절대 강도를 만든다.
 * 반면 원본 `0x307A6`는 호출 때마다 VGA DAC의 **현재 팔레트**를 다시 읽고 그 상태에서
 * 다시 pct%를 섞는다. 천지파열무 마지막 5프레임처럼 누적되어야 하는 곳에서 둘을
 * 같은 함수로 처리하면 매 호출이 원점으로 돌아가 누적 효과가 사라진다.
 *
 * @param {number} colorIdx 목표 팔레트 색 인덱스
 * @param {number} pct      현재 팔레트에서 목표색 쪽으로 섞을 퍼센트
 * @param {number} from     시작 인덱스(포함)
 * @param {number} to       끝 인덱스(미포함)
 */
Renderer.prototype.mixCurrentPalette = function (colorIdx, pct, from, to) {
  if (!root.G2Native || !root.G2Native.mixPalette) return this;
  /* ☠ _palette 는 처음 실은 기본 팔레트(맵 색 칸 0x60~ 비어 있음) — 지금 맵을 칠하는 nmap.palette 를 먼저 (2026-10-01 · 필살흰번쩍 과 같은 함정) */
  var current = (this.nmap && this.nmap.palette) || this._palette || this._유닛팔레트();
  if (!current) return this;
  /* 연출 종료의 clearPaletteMix()가 시작 전 팔레트로 복구할 수 있도록 최초 상태만 보존. */
  if (!this._palSaved) this._palSaved = current;
  var pal = root.G2Native.mixPalette(current, colorIdx, pct, from, to);
  /* 구조를 다시 만들 필요가 없다. `0x307A6`도 DAC만 바꾸므로 팔레트 종속 그림만 재굽는다. */
  if (this.팔레트만갈기) this.팔레트만갈기(pal, '누적혼합:' + colorIdx + ':' + pct + ':' + from + ':' + to);
  else this._팔레트반영(pal);
  return this;
};

/**
 * Atomic Blast `0x27B88~0x27BC0` 의 **한 팔레트 도막**.
 *
 * 원본은 현재 VGA DAC 사본(각 0..63)에서 **색마다 R 한 바이트만** 훑어
 *   값 < 62  → +1
 *   값 >= 62 → -10
 * 한 뒤 즉시 DAC에 다시 쓴다(0x27BC0 call 0x5F9AE). 24번 되풀이해 화면이 **붉어지다가**
 * 상한 부근에서 툭 떨어진다.
 * ☠ 전에는 「768바이트 전부」라 적고 R·G·B 를 다 올려 **하얘졌다** (2026-09-24 직독 —
 *   0x27B88 dx 0..255 · 0x27B8B lea eax,[eax+eax*2] · 0x27B8E mov bl,[esp+eax] · 0x27BA8 cmp dx,0x100).
 *
 * 우리 팔레트는 decodePalette() 이후 8비트(0..255)이므로 먼저 VGA6 값으로
 * 되돌린 뒤 같은 산술을 적용하고 다시 8비트로 확장한다. 최초 호출 전 팔레트는
 * clearPaletteMix()가 연출 종료 때 되살릴 수 있도록 한 번만 보존한다.
 */
Renderer.prototype.atomicPaletteStep = function () {
  /* ☠ 2026-09-24 사장님 「사용후 영구적으로 맵이 검게 변하는 문제」 — `this._palette` 를 먼저 봤더니
   *   맵이 쓰는 `nmap.palette`(TESTWC 합 347038)와 다른 옛 팔레트(합 169527)가 잡혀, 그것이 저장되고
   *   clearPaletteMix 가 맵에 덮어써 바닥 평균 밝기가 65→26 으로 남았다. setPaletteMix 와 같이 화면 팔레트를 쓴다. */
  /* ★ 다시 칠하지 않고 성분별 색 표 필터로 (2026-10-10 사장님 「아토믹블래스트도 너무 느려」)
   *   한 걸음은 칸마다 «그 칸의 R 6비트 값»만으로 정해진다(<0x3E → +1 · 아니면 −10 · G·B 그대로) — n 걸음 = 원래 R 에 그 식을 n 번.
   *   ☠ 전에는 24걸음마다 맵 전체를 다시 칠했다(팔레트밝기 와 같은 병 — 한 번 ≈180~390ms). */
  if (!this._섞기필터끔 && this.nmap && this.팔레트만갈기 && typeof document !== 'undefined' &&
      (!this._palSaved || this._원자필터)) {
    var 원 = this._palSaved || this._유닛팔레트();
    if (원) {
      if (!this._palSaved) { this._palSaved = 원; this._원자걸음 = 0; }
      if (this.nmap.palette !== 원) this.팔레트만갈기(원, '원자바탕');
      if (this.nmap.palette === 원) {
        var 걸음 = this._원자걸음 = (this._원자걸음 | 0) + 1;
        if (this._섞기필터(원, 0, 0, function (b6, k) {
          if (k !== 0) return b6;                                  /* 0x27B8B dx×3 — R 만 */
          for (var s = 0; s < 걸음; s++) b6 = (b6 < 0x3E) ? (b6 + 1) : (b6 - 0x0A);   // 0x27B91 / 0x27B98 / 0x27BA1
          return b6;
        })) { this._원자필터 = true; return this; }
      }
    }
  }
  this._원자필터 = false;
  var current = this._palSaved ? (this._palette || this._유닛팔레트()) : this._유닛팔레트();
  if (!current) return this;
  if (!this._palSaved) { this._palSaved = current; this._원자걸음 = 0; }
  this._원자걸음 = (this._원자걸음 | 0) + 1;
  var pal = new Uint8Array(current);
  for (var i = 0; i < current.length; i += 3) {      // 0x27B8B dx×3 — R 만
    var v = (current[i] | 0) >> 2;                 // decodePalette()의 8bit → VGA 6bit
    v = (v < 0x3E) ? (v + 1) : (v - 0x0A);       // 0x27B91 / 0x27B98 / 0x27BA1
    pal[i] = ((v << 2) | (v >> 4)) & 0xFF;        // VGA 6bit → 8bit
  }
  if (this.팔레트만갈기) this.팔레트만갈기(pal, 'atomic-step:' + this._원자걸음);   /* ★ 걸음마다 딱지가 달라야 바닥이 걸음마다 다시 칠해진다 (딱지 하나면 첫 걸음 바닥에 멈춘다) */
  else this._팔레트반영(pal);
  return this;
};

/**
 * ★★★★★ **팔레트만 갈아 끼운다** — DOM 구조는 그대로 두고 **그림만 다시 굽는다**
 *
 *   `_팔레트반영()` 는 `useNativeMap()` 을 통째로 다시 돌려 **175 ms** 가 든다
 *   (실측 2026-09-10). 그중 그림을 굽는 몫은 **55 ms** 뿐이고 나머지는 DOM 을
 *   다시 짓는 값이다. 팔레트만 바뀌었으면 **DOM 은 그대로여도 된다.**
 */
Renderer.prototype.팔레트만갈기 = function (pal, 딱지) {
  var self = this;
  if (!pal || !this.nmap || !root.G2Native) return this;
  if (typeof document !== 'undefined') { try { 창안몰아재기(this); } catch (e창) { 창안판 = null; } }   /* ★ 걸음 머리에 한 번 (2026-10-07) */
  try { return this._팔레트만갈기본(pal, 딱지); }
  finally {
    창안판 = null;                                            /* 무슨 일이 있어도 걸음 밖으로 안 새게 */
    if (!this._palSaved) this._범위리맵미리굽기();             /* 바탕 팔레트(시간대·날씨)가 바뀌었으면 범위 바닥을 쉬는 틈에 미리 */
  }
};
Renderer.prototype._팔레트만갈기본 = function (pal, 딱지) {
  var self = this;
  /* mapx 건물 시험면은 원래 팔레트로 구운 PNG다. 바닥·B를 새 색으로
   * 다시 칠하기 전에 원자 거래를 닫아 원본 판을 먼저 복원한다. */
  if (this._map3dMapxBuildingPreview) {
    this._map3dMapxBuildingPreview.close(); this._map3dMapxBuildingPreview = null;
  }
  /* ★ 캐시 열쇠(바닥·배경벽·행 그림)는 «팔레트 내용»으로 만든다 — 부르는 쪽 이름표는 같은데 팔레트가 다른 일이 많다
   *   ('필살흰뒤'·'기본'·'음영1'·'bright:…'·'날씨N' — 시간대·날씨·지금 섞기에 따라 내용이 다름)
   *   ☠ 이름표로 쥐면 다른 때 구운 그림(밤에 낮 그림 · 다른 섞기)을 그대로 꺼냈다
   *   (2026-10-01 사장님 「팔레트 변경 전수 검토해서 수정해 … 누더기만들지말고 제대로 확인해!」) */
  var 해1 = 0x811C9DC5 | 0, 해2 = 0;
  for (var hi = 0; hi < pal.length; hi++) { 해1 = Math.imul(해1 ^ pal[hi], 0x01000193); 해2 = (해2 * 31 + pal[hi]) | 0; }
  딱지 = '팔' + (해1 >>> 0).toString(36) + '.' + (해2 >>> 0).toString(36);
  this._지금딱지 = 딱지;
  this.nmap.palette = pal;
  this._palette = pal;
  this._blkCache = {}; this._uurl = {}; this._silCache = {};
  this._effcURL = {}; this._shdURL = {};
  /* ☠ 바닥 애니 타일(물·용암·풀) 그림도 팔레트를 문다 — 안 비우면 흰 섞기 중 처음 만든 장면이 마법 뒤에도 하얗게 돈다
   *   (2026-09-25 사장님 「선라이트의 경우 맵 일부가 하얗게 남는 문제도 있어」 · 옛 되돌리기 길 _팔레트반영 도 안 비웠다) */
  this._tileURLCache = {};
  this._범위리맵URL = null; this._범위리맵팔 = null;
  this._범위미리();   /* 정본 336 — 잠잠해지면 미리 만든다 */
  /* 상태 표시(CHR_EFFC)도 리맵 전 DAC 로 굽는다 — 리맵 몫은 연출밝은유닛·_표시어둡기가 CSS 로 한 번만 건다 */
  if (this._effcRaw) this._effc = root.G2Native.spriteCanvasProvider(this._effcRaw, this._유닛쓸팔 || pal);
  if (this._usprRaw && this._uspr) {
    this._usprPal = this._usprPal || {};
    /* ★ 유닛은 화면 리맵(0x454D5) 전 DAC 로 칠한다 — 원본은 리맵 «뒤»에 시전자·대상을 다시 그린다(0x44DCC · 0x12F2A) (2026-09-26) */
    var _유팔 = self._유닛쓸팔 || pal;
    Object.keys(this._usprRaw).forEach(function (f) {
      self._uspr[f] = 유닛공급자(self, f, _유팔);   /* ★ 팔레트 걸음 — GPU 판으로 칠한다 (2026-10-06) */
      self._usprPal[f] = _유팔;
    });
  }
  /* 팔레트를 물고 있는 **그림만** 다시 굽는다 (`_nativeMap단계` 의 앞 여섯 단계) */
  try {
    /* ★ 바닥은 **인덱스 버퍼가 그대로**다 — 다시 굽지 않고 **다시 칠하기만** 한다
     *   (`_맵단계_바닥굽기` 는 562개 오브젝트를 다시 겹쳐 그린다 — 팔레트엔 무관하다) */
    if (this._floorIdx && root.G2Scaler && root.G2Scaler.N() > 1) {
      /* ★ 스케일러 — 보이는 바닥 조각만 이 걸음에 색 차이를 얹는다. 나머지는 화면에 들어올 때(apply → _밀린칠하기)
       *   xBRZ 4배면 바닥이 1060만 픽셀이라 통째로 칠하면 걸음마다 50ms 가 넘었다 (2026-09-25 사장님 「주로 xbrz 4배 좁힘 옵션을 사용하는데 너무 느려」) */
      this._바닥확대칠하기(pal);
    } else if (this._floorIdx) {
      /* ★ 바닥도 **딱지별로 쥔다** — 토글이 공짜가 된다 */
      /* ★ 2026-09-25 PNG 로 굽지 않는다 — 바닥 캔버스 한 장을 만들어 조각마다 자식 캔버스로 옮겨 칠한다(Z-47 · 9ms → 3ms 남짓) */
      /* ☠ 바닥이 바뀌면(다른 맵) 비운다 — 안 비우면 같은 딱지(같은 마법)에 이전 맵 바닥이 칠해진다 (2026-09-25) */
      if (this._floorCV캐시주인 !== this._floorIdx) { this._floorCV캐시 = {}; this._floorCV캐시주인 = this._floorIdx; }
      var _fc = this._floorCV캐시 || (this._floorCV캐시 = {});
      var _fk = (root.G2Scaler ? root.G2Scaler.cur() + '|' : '') + (딱지 == null ? '?' : String(딱지));   /* 필터가 바뀌면 옛 배율 그림을 안 쓴다 */
      if (!_fc[_fk]) { if (Object.keys(_fc).length >= 16) _fc = this._floorCV캐시 = {}; _fc[_fk] = 팔레트그림(this, '바닥', this._floorIdx, pal, this._palSaved || this._음영바탕 || pal); }   /* 스케일러면 색 차이만 얹는다 */
      this._바닥캔버스칠하기(_fc[_fk]);
    } else this._맵단계_바닥굽기(this.nmap);
    var 옛배경벽 = this.backdropEl, 배경벽새로지음 = false;
    if (!this._배경벽다시칠하기(pal, 딱지)) {
      this._배경벽짓기(this.nmap);   /* 다시 짓기는 2-4A 에서 걸음마다 180ms (Z-72) */
      배경벽새로지음 = true;
    }
    this._원경짓기();
    /* ★ 2026-09-25 오브젝트도 다시 짓지 않고 색만 옮겨 칠한다(Z-47 · 다시 짓기 29.5ms) — 못 하면(처음 등) 예전대로 다시 짓는다 */
    var _오칠 = this._오브젝트색칠하기(pal);
    /* 벽만 다시 지으면 접는선 위 애니 요소는 옛 벽과 함께 떨어진다.
     * 지면 오브젝트 색칠 성공만으로 재구성을 생략하면 Fx가 분리된 요소를 계속 갱신한다. */
    if (배경벽새로지음 && 옛배경벽 && this.animObjEls &&
        Object.keys(this.animObjEls).some(function (bi) {
          return this.animObjEls[bi].some(function (item) { return item.el.parentNode === 옛배경벽; });
        }, this)) _오칠 = 0;
    if (!_오칠) {
      this.flatObjLayer.innerHTML = '';
      this.objEls.forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
      this.objEls = [];
      this._원본맵오브젝트짓기();
    }
    /* ★ 행 오버레이도 **다시 칠하기만** — 44 ms 짜리 다시 만들기를 안 한다.
     *   ☠ `objEls` 를 위에서 비웠으므로 대열에 다시 넣어야 한다. */
    var _행 = this._행오버레이_다시칠하기(pal, 딱지);
    /* ☠ 예전 식 「_행 && !_오칠 … else 짓기」는 색만 칠한 걸음마다 행 오버레이를 한 벌 더 지었다(36ms 헛일 · 2026-09-25 실측) — 못 칠했을 때만 짓는다 */
    if (_행) { if (!_오칠) { var self2 = this;   /* 오브젝트를 다시 지었을 때만 — 색만 칠했으면 objEls 에 이미 있다 */
               (this._rowFlatEls || []).forEach(function (e) { self2.objEls.push(e); }); } }
    else if (this._행별눕힘오버레이짓기) this._행별눕힘오버레이짓기();
    /* 색만 칠한 경우 — 배경벽·원경을 다시 지으며 떨어져 나간 옛 요소를 대열에서 걷는다(겹쳐 쌓이지 않게) */
    if (_오칠) this.objEls = this.objEls.filter(function (e) { return e && e.isConnected; });
  } catch (e) { console.warn('[팔레트만갈기] ' + (e && e.message)); }
  finally {
    // 팔레트 fallback이 새 오브젝트·행 DOM을 만든 경우에도 기존 맵 가림을 유지한다.
    if (this._맵가림) this.맵가리기(true);
  }
  this._맵아이템다시칠하기();
  this._애니타일다시칠하기();
  this._범위리맵다시();
  this._유닛전체새로고침();
  /* 명시적 3D 건물 preview만 현재 DAC로 다시 굽는다. 기존 조각 격리도 새 DOM에 맞춘다. */
  if (this._map3dPreview && this._map3dPreview.spec) {
    var 다시 = this._map3dPreview.spec;
    try { this.map3D건물진단(다시.source, 다시.building, 다시.policy, 다시.options); }
    catch (e3d) { console.warn('[맵3D preview] 팔레트 갱신 실패:', e3d && e3d.message); }
  }
  /* ★ 다시 지은 배경벽·오브젝트에 변환을 건다 — 평소 맵 짓기(`_nativeMap단계` 마지막 '이동판정')와 같이 (2026-09-25)
   *   ☠ 사장님 「처음에는 제대로 나오다가 중간에 갑자기 기존 오브젝트가 사라지고 다시 그려진다고」 · 스크린샷 121310↔121303:
   *     아토믹 블래스트 ② 는 한 장 안에서 흔들기(apply) → 팔레트 걸음(여기서 다시 짓기) 차례라, 화면에 나오는 장마다
   *     배경벽이 접는선에서 안 세워지고(rotateX 없음 — 화면 위에 누운 띠) 나무가 안 세워진 채였다. */
  창안판 = null;                                              /* ★ apply 가 카메라·변환을 바꿀 수 있다 — 몰아 잰 값은 여기까지 */
  this.apply();
  return this;
};

/**
 * ★★★★★ **화면 음영을 팔레트로 건다** — 원본 `0x454D5` → `0x5EE2B` (2026-09-10)
 *
 *   > 사장님: 「**가장 가까운 색표 색으로 맞추는 것도** 진행해줘」
 *
 *   원본은 화면을 **표로 치환**한다 — 곧 결과가 **반드시 팔레트 안의 색**이다
 *   (`0x60AE5` 맨해튼 거리로 가장 가까운 색인을 고른다).
 *   반투명을 덮는 것으로는 **밝기는 맞출 수 있어도 그 스냅을 못 낸다**
 *   (실측 잔차 — 채널당 평균 4.3 · 최대 34/765).
 *
 *   ⇒ 화면 전체 음영은 **팔레트를 갈아** 낸다. 그러면 스냅이 저절로 맞는다.
 *   ★ 뱅크 0 = 목표 **0번 색** · 강도 **60** · 보정 **9** (`0x6104A` 호출 11곳 전수 확인).
 *   ★ 겹침(`pass`)은 **표를 그만큼 거듭** 적용한다 (`G2Remap.거듭`).
 *   ☠ **부분 영역**(대사창·정보바)에는 못 쓴다 — 그쪽은 반투명 그대로다.
 *
 *   @param {number} pass 0 이면 되돌린다. 1·2 는 겹침 횟수
 */
Renderer.prototype.음영팔레트 = function (pass) {
  pass = pass | 0;
  if (this._음영단계 === pass) return this;
  if (this._palSaved) return this;              /* 연출이 팔레트를 쥐고 있다 — 비켜난다 */
  var R2 = root.G2Remap;
  if (!R2 || !R2['표굽기'] || !this.nmap) return this;
  if (!pass) {
    if (this._음영바탕) { var b = this._음영바탕; this._음영바탕 = null; this._음영단계 = 0;
                          this.팔레트만갈기(b, '기본'); }
    this._음영단계 = 0;
    return this;
  }
  var base = this._음영바탕 || this._유닛팔레트();
  if (!base) return this;
  this._음영바탕 = base;
  var LUT = R2['표굽기'](R2['pal63에서'](base), 60, 0, 9);
  if (pass > 1 && R2['거듭']) LUT = R2['거듭'](LUT, pass);
  var pal = new Uint8Array(768);
  for (var i = 0; i < 256; i++) {
    var m = LUT[i];
    pal[i*3] = base[m*3]; pal[i*3+1] = base[m*3+1]; pal[i*3+2] = base[m*3+2];
  }
  pal._기록바탕 = base._기록바탕 || base; /* 계측 전용 꼬리표 — 이 팔레트를 만든 원래 팔레트(암전 판정 · 04_도구/우리그리기기록.js · 2026-09-27) */
  this._음영단계 = pass;
  this.팔레트만갈기(pal, '음영' + pass);
  return this;
};

/** 저장해 둔 원본 팔레트로 되돌린다 — `0x3B546` → `0x5F9AE`. */
/**
 * ★ 팔레트 밝기 — 원본 0x5FA2C(eax 시작 · edx 끝 · ebx 기준표 · ecx %) (2026-09-25)
 *   DAC = trunc(기준 6비트 × % ÷ 100) — VGA DAC 는 6비트라 63 을 넘으면 윗비트가 버려진다(0x5FA67 imul · 0x5FA71 idiv 100 · out).
 *   기준표는 원본 팔레트(0x12824C) — 우리는 연출이 처음 팔레트를 잡을 때 저장한 `_palSaved`(없으면 지금 유닛 팔레트).
 *   원본 기록(칸 62 파워썬더) 43번 고리: 섬광마다 120·115·110·100·100·95·90·85·80·75 → 100 %. 되돌리기는 clearPaletteMix.
 */
Renderer.prototype.팔레트밝기 = function (퍼센트, 시작, 끝) {
  this._섞기필터걷기();                                   /* 256색 섞기 필터가 걸려 있으면 먼저 걷는다 — 다시 칠한 팔레트 위에 겹치지 않게 */
  var base = this._palSaved || this._유닛팔레트();
  if (!base) return this;
  if (!this._palSaved) this._palSaved = base;
  퍼센트 = 퍼센트 | 0; 시작 = (시작 == null) ? 0 : (시작 | 0); 끝 = (끝 == null) ? 256 : Math.min(256, 끝 | 0);
  /* ★ 전체 범위 밝기도 다시 칠하지 않고 성분별 색 표 필터로 (2026-10-09 사장님 「마법 느린거 고쳤는데 또 느려졌어 … 파워썬더 크게 치는 번개 느리고」)
   *   0x5FA2C 도 칸마다 «그 칸의 6비트 성분 값»만으로 정해진다(trunc(b6 × % ÷ 100) & 63) — 팔레트섞기 의 필터 길과 같은 까닭으로 같은 색이 난다.
   *   ☠ 실측(헤드리스 2-4A · xbrz3 · 기울기 45 · 배율 60): 파워썬더(칸 62) 섬광 43번이 걸음마다 맵 전체 다시 칠하기(한 번 ≈180~390ms)
   *     → 시전 27.6초 · 50ms 넘는 장 48. 빠지는 254·255 는 섞기 필터 주석과 같은 까닭으로 화면에 거의 안 나온다. */
  /* ★ 밝기는 늘 «원래»(base)에서 새로 낸다 — 앞의 부분 섞기(파워썬더 0~40% 색 96~255)가 다시 칠해 둔 화면이면
   *   원래로 «한 번» 되돌려 칠하고 필터를 건다(뒤따르는 밝기 10번은 칠하기 없이). 결과 팔레트는 다시 칠하기 길과 같다. */
  if (시작 === 0 && 끝 >= 254 && !this._섞기필터끔 && this.nmap && this.팔레트만갈기 && typeof document !== 'undefined') {
    if (this.nmap.palette !== base) this.팔레트만갈기(base, '밝기바탕');
    if (this.nmap.palette === base &&
        this._섞기필터(base, 0, 0, function (b6) { return Math.trunc(b6 * 퍼센트 / 100) & 63; }))   /* 0x5FA67 imul · 0x5FA71 idiv 100 */
      return this;
  }
  var pal = new Uint8Array(base);
  for (var i = 시작 * 3; i < 끝 * 3; i++) {
    var v = Math.trunc(((base[i] | 0) >> 2) * 퍼센트 / 100) & 63;   // 8bit → VGA 6bit · × % · 6비트로 자름
    pal[i] = ((v << 2) | (v >> 4)) & 0xFF;                          // VGA 6bit → 8bit (decodePalette 와 같은 식)
  }
  if (this.팔레트만갈기) this.팔레트만갈기(pal, 'bright:' + 시작 + '-' + 끝 + ':' + 퍼센트);
  else this._팔레트반영(pal);
  return this;
};

/** 0x5FD1C 색 섞기 — 색 i 를 기준 + trunc((대상색 − 기준) × % ÷ 100) 으로 (6비트 · 시작~끝−1). 대상색 = 기준 팔레트의 색인 한 칸 (0x562A8 · 0x5FC21 차이표) — 2026-09-25 */
function 같은팔(a, b) { if (!a || !b || a.length !== b.length) return false; for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; }
Renderer.prototype.팔레트섞기 = function (대상색인, 퍼센트, 시작, 끝, 기준팔) {
  var 원래 = this._palSaved || this._유닛팔레트();
  if (!원래) return this;
  if (!this._palSaved) this._palSaved = 원래;
  /* ★ 기준팔 — 원본 0x5FC21 은 «지금 팔레트 사본»에서 차이표를 만든다. 앞 섞기가 바꿔 둔 팔레트 위에 겹쳐 섞을 때 준다
   *   (2026-09-25 리바이블: 도막① 색 0x31 섞기 뒤 흰 섞기 — 칸 78). 되돌림(clearPaletteMix)은 언제나 원래 팔레트로 */
  var base = 기준팔 || 원래;
  퍼센트 = Math.min(100, 퍼센트 | 0); 시작 = (시작 == null) ? 0 : (시작 | 0); 끝 = (끝 == null) ? 256 : Math.min(256, 끝 | 0);
  var t = (대상색인 | 0) * 3;
  /* ★ 256색 전부를 섞을 때는 다시 칠하지 않고 성분별 색 표 필터 한 장으로 (2026-10-07 사장님 「아직도 많이 느려. 특히 선라이트같은 마법에서」)
   *   0x5FD1C 는 칸마다 «그 칸의 6비트 성분 값»만으로 정해진다 — 같은 성분 값이면 같은 결과 ⇒ 성분별 256칸 표(discrete)가 다시 칠하기와 같은 색을 낸다.
   *   실측(시험 탭 · xbrz3 · 기울기 45 · 배율 60): 다시 칠하기면 섞는 동안 프레임 평균 49ms(20fps) — 선라이트는 50 프레임 내내 섞는다.
   *   ☠ 지금 화면 팔레트가 «원래»일 때만 — 앞 섞기가 다시 칠해 둔 위에 겹치면 표가 원래 기준이라 어긋난다. 일부 구간(0~254 등)·기준팔 겹침은 예전대로 다시 칠한다. */
  /* ★ 0~253(끝 254 · 스타티어러 0x2325F · 팔레트 도막) 도 같은 길로 — 빠지는 254·255 는 화면에 거의 안 나온다:
   *   255 는 마법 그림 110개 전부 투명색 · 254 를 그리는 것은 BARRIER.NSP 20픽셀뿐 · 251~255 는 같은 회색(170,170,170).
   *   실측(2-4A · 스케일러 끔): 필터(256) ↔ 다시 칠하기(0~253) 화면 픽셀 0/1,857,776 다름 (2026-10-07 사장님 「스타티어러는 느려. 하얗게 처리되는게 많이 느린 것 같아」) */
  /* ★ 기준팔이 있어도 «지금 칠해진 팔레트 = 기준팔»이면 같은 길 — 표는 화면 색 값과 목표색만 보므로 칠해진 값에서 섞는 원본(0x5FC21 지금 사본)과 같다
   *   (리바이블 도막②③ 46프레임 흰 섞기 · 0x59E59·0x59F84·0x5A16D — 2026-10-10 사장님 「리바이블 여전히 엄청 느려」 「계속 처리해」) */
  var 칠한게기준 = !기준팔 ? (this.nmap && this.nmap.palette === 원래) : (this.nmap && 같은팔(this.nmap.palette, 기준팔));
  if (시작 === 0 && 끝 >= 254 && !this._섞기필터끔 && 칠한게기준 &&
      this._섞기필터(base, t, 퍼센트)) {
    /* HUD·장식 기둥·맵 밖 바탕은 예전처럼 _물들임 으로 — #view 안(맵·유닛·연출 그림)만 필터가 맡는다 */
    if (끝 >= 256) this._화면물들임([base[t], base[t + 1], base[t + 2]], 퍼센트 / 100, base);   /* 다시 칠하기 길과 같게 — 0~253 은 HUD·장식에 안 건다 */
    return this;
  }
  /* ★ 96~255 만 섞기(리바이블 도막① 0x59DD3 · 메테오·전격7 0x30824 계열) — 원본에서 맵·유닛 색 대역이고 이펙트(0~95)는 안 물든다.
   *   같은 성분 필터를 #view 전체가 아니라 맵·월드(유닛)·유닛 위/중간 층에만 건다 — 이펙트 층(g2-fx)은 안 건다.
   *   ☠ 전엔 이 범위가 다시 칠하기 길로 가 매 프레임 맵 전체를 다시 구웠다 (2026-10-10 사장님 「리바이블 여전히 엄청 느려」 · 도막① 70프레임) */
  if (시작 === 96 && 끝 >= 256 && !기준팔 && !this._섞기필터끔 && this.nmap && this.nmap.palette === 원래) {
    var 층들 = [this.groundLayer, this.world, this.unitTopLayer, this.unitMidLayer].filter(function (e) { return e && e.style; });
    if (층들.length && this._섞기필터(base, t, 퍼센트, null, 층들)) return this;
  }
  this._섞기필터걷기();
  var pal = new Uint8Array(base);
  for (var i = 시작; i < 끝; i++) for (var k = 0; k < 3; k++) {
    var b6 = (base[i * 3 + k] | 0) >> 2, t6 = (base[t + k] | 0) >> 2;
    var v = (b6 + Math.trunc((t6 - b6) * 퍼센트 / 100)) & 63;    // 0x5FD65~0x5FD84 · DAC 6비트
    pal[i * 3 + k] = ((v << 2) | (v >> 4)) & 0xFF;
  }
  if (this.팔레트만갈기) this.팔레트만갈기(pal, 'mix:' + 대상색인 + ':' + 시작 + '-' + 끝 + ':' + 퍼센트);
  else this._팔레트반영(pal);
  /* 256색 전부면 원본은 화면의 모든 것(맵 밖 바탕·HUD·장식)이 같이 물든다 — 맵 밖에도 건다 */
  if (시작 === 0 && 끝 >= 256) this._화면물들임([base[t], base[t + 1], base[t + 2]], 퍼센트 / 100, pal);
  return this;
};

/**
 * ★ 화면 전체 물들임 — 팔레트로 안 그리는 것(맵 밖 바탕 · HUD 캔버스 · 좌우 장식 기둥)에도 같은 섞기를 건다 (2026-09-26 · Z-73)
 *   사장님 「힐윈드 같은 경우 화면 밝아지는게 맵 뿐만 아니라 맵 좌우 여백까지 같이 밝아지는데 우리는 해당 부분은 밝아지지 않아.」
 *   (답: 맵 밖 검은 바탕 · 좌우 장식 테두리 · 위아래 바·HUD 셋 다)
 *   원본 0x5FD1C 는 DAC 256색을 통째로 섞으므로 화면의 모든 픽셀이 대상색 쪽으로 퍼센트만큼 간다.
 *   · 맵 밖 바탕 = 팔레트 0번 색을 섞은 값(#view 바탕색)
 *   · HUD 캔버스 = 그린 픽셀 위에만 대상색을 그 비율로 덮는다(hud.js draw 끝 · source-atop)
 * @param {number[]|null} 색 대상색 RGB — null 이면 걷는다
 * @param {number} a 0~1
 * @param {Uint8Array} [pal] 섞인 팔레트(맵 밖 바탕색을 여기 0번에서 꺼낸다)
 */
/* 0x5FD1C 를 성분별 색 표로 — #view(맵·유닛·연출 그림·바탕)에만 건다. 장식 기둥·HUD 는 예전처럼 _물들임 이 칠한다.
 *   #view 는 원근만 주는 평면이라 필터가 3D 를 눌러 펴지 않는다(연출 층 넷 모두 #view 안 · 실측). */
Renderer.prototype._섞기필터 = function (base, t, 퍼센트, 성분식, 대상들) {
  if (typeof document === 'undefined' || !this.host || !this.host.style) return false;
  var NS = 'http://www.w3.org/2000/svg', 이름 = ['R', 'G', 'B'];
  var flt = document.getElementById('g2-섞기');
  if (!flt) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    flt = document.createElementNS(NS, 'filter');
    flt.setAttribute('id', 'g2-섞기');
    flt.setAttribute('color-interpolation-filters', 'sRGB');      /* 붉기필터와 같은 함정 — linearRGB 면 값이 어긋난다 */
    var ct = document.createElementNS(NS, 'feComponentTransfer');
    이름.forEach(function (c) {
      var fn = document.createElementNS(NS, 'feFunc' + c);
      fn.setAttribute('id', 'g2-섞기-' + c); fn.setAttribute('type', 'discrete');
      ct.appendChild(fn);
    });
    flt.appendChild(ct); svg.appendChild(flt);
    (document.body || document.documentElement).appendChild(svg);
  }
  for (var k = 0; k < 3; k++) {
    var t6 = (base[t + k] | 0) >> 2, 표 = new Array(256);
    for (var x = 0; x < 256; x++) {                              /* 8비트 값 x = 6비트 b6 를 펼친 것 — b6 = x >> 2 */
      var b6 = x >> 2, v = 성분식 ? (성분식(b6, k) & 63)                         /* 밝기 0x5FA2C 등 — 부르는 쪽이 6비트 식을 준다 (k = 0 R · 1 G · 2 B) */
                                  : ((b6 + Math.trunc((t6 - b6) * 퍼센트 / 100)) & 63);   // 0x5FD65~0x5FD84
      표[x] = (((v << 2) | (v >> 4)) & 0xFF) / 255;
    }
    document.getElementById('g2-섞기-' + 이름[k]).setAttribute('tableValues', 표.join(' '));
  }
  /* 대상 층이 바뀌면 먼저 걷는다 — #view 전체(0~255) ↔ 맵·유닛 층만(96~255) */
  var 겨눔 = (대상들 && 대상들.length) ? 대상들 : [this.host];
  if (this._섞기필터켬 && this._섞기필터대상 !== 겨눔.length) this._섞기필터걷기();
  this._섞기필터대상 = 겨눔.length;
  if (!this._섞기필터켬) {
    this._섞기필터요소 = 겨눔.map(function (e) {
      var 앞 = e.style.filter || '';
      e.style.filter = (앞 ? 앞 + ' ' : '') + 'url(#g2-섞기)';
      return { e: e, 앞: 앞 };
    });
    this._섞기필터켬 = true;
  }
  return true;
};
Renderer.prototype._섞기필터걷기 = function () {
  if (!this._섞기필터켬) return this;
  (this._섞기필터요소 || []).forEach(function (q) { q.e.style.filter = q.앞; });
  this._섞기필터요소 = null; this._섞기필터켬 = false;
  return this;
};

Renderer.prototype._화면물들임 = function (색, a, pal) {
  var 켬 = !!(색 && a > 0);
  this._물들임 = 켬 ? { 색: 색, a: a } : null;
  /* 섞기 필터가 걸려 있으면 바탕은 원래 색(0번)으로 두고 필터가 섞는다 — 두 번 섞이지 않게 */
  if (this.host && this.host.style) this.host.style.backgroundColor = (켬 && pal) ? 'rgb(' + pal[0] + ',' + pal[1] + ',' + pal[2] + ')' : '';
  /* HUD 는 평소 흐름(battle_main 렌더 루프)이 매 프레임 다시 그리며 draw 끝에서 이 값을 본다 — 여기서 따로 부르지 않는다 */
  try { if (root.__repositionFrameDeco) root.__repositionFrameDeco(); } catch (e2) {}   /* 장식 기둥(battle_portrait)도 다시 그린다 */
  return this;
};

/**
 * ★ `0x30824` 되풀이 — 부를 때마다 «지금 DAC»(0x5F945 로 읽음)에서 다시 섞는다 (2026-09-26 무인 · 원본 직독)
 *   ```asm
 *   0x3083D  call 0x5F945(0, 256, 0x8189C)   ; 지금 DAC 를 읽는다
 *   0x30842~0x30867  색 0x60~0xFF 의 목표를 색 eax 로
 *   0x3087D  call 0x5FC21 · 0x3089E → 0x5FD1C(%)  ; DAC = 지금 + trunc((목표 − 지금) × % ÷ 100) (6비트)
 *   ```
 *   ⇒ 같은 % 로 되풀이하면 **누적**된다 (멸살성천무 0x36A26 이 도막 ③ 10장 동안 장마다 · 원본 기록 56→51→46 …).
 *   리맵(`keepPct` · 0x454D5)은 DAC 와 따로 얹는다.
 */
/**
 * ★★★★★ **가벼운 초필살 암전** — 팔레트 정리 ③ (2026-10-13)
 *   2026-10-13 사장님 「팔레트 관련해서 잘못 건드리면 느려지는 문제가 자꾸 생겨서 … 유형별로 모으고 그대로 적용하는게 좋겠어」 · 고르심 «단계별로 전부»
 *   원본: 0x30824 가 DAC 96~255 를 색 0(검정) 쪽으로 pct% 섞고(장마다 누적 0x307A6) · 0x454D5 가 화면을 40% 로 리맵 · 시전자·대상은 리맵 뒤에 다시 그린다.
 *   옛 길은 걸음마다 팔레트만갈기(바닥·행·오브젝트·배경벽 다시 칠함 — 일반 필살이 같은 길에서 605ms 섰다 · 정본 3179).
 *   ⇒ 맵 층은 CSS brightness(누적배 × 리맵) 만 바꾸고(일반 필살 _css암전걸기 와 같은 길), 유닛·상태 표시만 섞인 DAC 로 다시 칠한다(GPU 판 · 리맵 몫은 연출밝은유닛 CSS).
 *   쓰는 조건: 섞을 색이 검정 · 범위 기본(96~255) · 리맵 있음 · 기록기 꺼짐 · 옛 길이 이미 팔레트를 쥐고 있지 않음.
 *   ☠ 원본은 색 번호 96~255 만 어두워진다 — CSS 밝기는 맵의 96 아래 색(바닥 약 2.5%)도 같이 어둡게 한다 · 6비트 끊기 대신 곱 (리마스터_적용현황 2026-10-13)
 *   그 밖(천지 0~0x68 부분 섞기 등)은 옛 길로 넘어간다 — 넘어갈 때 지금 누적 DAC 를 이어받는다.
 */
Renderer.prototype._가벼운암전쓸까 = function (colorIdx, from, to, keepPct, base) {
  if (keepPct == null || from != null || to != null) return false;
  if (root.__우리기록 && root.__우리기록.켜짐) return false;     /* 기록기는 팔레트를 읽는다 — 옛 길 */
  if (this._palSaved && !this._가벼운암전켬) return false;     /* 옛 길이 이미 팔레트를 쥐고 있다 */
  var b = this._가벼운암전바탕 || base;
  if (!b || !this.nmap || !this._css암전걸기) return false;
  var c = (colorIdx | 0) * 3;
  return (b[c] | 0) === 0 && (b[c + 1] | 0) === 0 && (b[c + 2] | 0) === 0;
};
Renderer.prototype._가벼운암전걸기 = function (dac, keepPct) {
  var self = this;
  this._가벼운암전켬 = true;
  this._dacPal = dac;
  this._유닛쓸팔 = dac;
  this._유닛만다시칠하기(dac);
  var f = Math.max(0, Math.min(1, (this._css암전배 == null ? 1 : this._css암전배) * (Math.min(100, Math.max(0, keepPct | 0)) / 100)));
  this._css암전걸기('brightness(' + f.toFixed(4) + ')');
  return this;
};
/** 유닛·상태 표시만 이 팔레트로 다시 칠한다 — 팔레트만갈기의 유닛 몫(맵은 안 건드림) */
Renderer.prototype._유닛만다시칠하기 = function (pal) {
  var self = this;
  if (!pal || !root.G2Native) return this;
  this._uurl = {}; this._silCache = {}; this._effcURL = {}; this._shdURL = {};
  if (this._effcRaw) this._effc = root.G2Native.spriteCanvasProvider(this._effcRaw, pal);
  if (this._usprRaw && this._uspr) {
    this._usprPal = this._usprPal || {};
    Object.keys(this._usprRaw).forEach(function (f) { self._uspr[f] = 유닛공급자(self, f, pal); self._usprPal[f] = pal; });
  }
  if (this._유닛전체새로고침) this._유닛전체새로고침();
  return this;
};
/** 가벼운 암전을 걷는다 — 맵은 CSS 만 걷고(팔레트는 안 바꿨다) 유닛을 원래 팔레트로 */
Renderer.prototype._가벼운암전걷기 = function () {
  if (!this._가벼운암전켬) return this;
  var 바탕 = this._가벼운암전바탕;
  this._가벼운암전켬 = false; this._가벼운암전바탕 = null; this._css암전배 = null;
  if (this._css암전) this._css암전걸기(null);
  this._dacPal = null; this._유닛쓸팔 = null;
  if (바탕) this._유닛만다시칠하기(바탕);
  return this;
};
/** 가벼운 암전에서 옛 길로 넘어간다 — 누적 DAC 를 그대로 이어받고 맵을 한 번 칠한다(천지 부분 섞기 등) */
Renderer.prototype._가벼운암전넘기기 = function () {
  if (!this._가벼운암전켬) return this;
  var 바탕 = this._가벼운암전바탕;
  this._가벼운암전켬 = false; this._가벼운암전바탕 = null; this._css암전배 = null;
  if (this._css암전) this._css암전걸기(null);
  this._palSaved = this._palSaved || 바탕;                 /* clearPaletteMix 가 이것으로 되돌린다 */
  return this;
};

Renderer.prototype.팔레트다시섞기 = function (colorIdx, pct, from, to, keepPct) {
  this._섞기필터걷기();                                   /* 256색 섞기 필터가 걸려 있으면 먼저 걷는다 — 다시 칠한 팔레트 위에 겹치지 않게 */
  /* 본문이 머리 암전을 걷고 장마다 누적만 하는 초필살(무신·천지·화염인·풍아·부동·멸살·순옥살)은 여기서 가벼운 길을 시작한다 */
  if (!this._가벼운암전켬 && !this._palSaved) {
    var 새바탕 = this._유닛팔레트();
    if (this._가벼운암전쓸까(colorIdx, from, to, keepPct, 새바탕)) {
      this._가벼운암전바탕 = 새바탕; this._가벼운암전켬 = true; this._css암전배 = 1; this._dacPal = null;
    }
  }
  if (this._가벼운암전켬) {
    if (this._가벼운암전쓸까(colorIdx, from, to, keepPct, null)) {
      var dac0 = this._dacPal || this._가벼운암전바탕, c0 = (colorIdx | 0) * 3, p0 = Math.min(100, Math.max(0, pct | 0));
      var out0 = new Uint8Array(dac0);
      for (var i0 = 0x60; i0 < 0x100; i0++) for (var k0 = 0; k0 < 3; k0++) {   /* 아래 옛 길과 같은 6비트 식 — 유닛·이펙트가 쓰는 DAC 몫 */
        var b60 = (dac0[i0 * 3 + k0] | 0) >> 2, t60 = (dac0[c0 + k0] | 0) >> 2;
        var v0 = (b60 + Math.trunc((t60 - b60) * p0 / 100)) & 63;
        out0[i0 * 3 + k0] = ((v0 << 2) | (v0 >> 4)) & 0xFF;
      }
      this._css암전배 = (this._css암전배 == null ? 1 : this._css암전배) * (1 - p0 / 100);
      return this._가벼운암전걸기(out0, keepPct);
    }
    this._가벼운암전넘기기();                               /* 검정이 아니거나 범위가 있다 — 옛 길로 (누적 DAC 이어받음) */
  }
  var 원래 = this._palSaved || this._유닛팔레트();
  if (!원래) return this;
  if (!this._palSaved) this._palSaved = 원래;
  var dac = this._dacPal || 원래;
  var f = (from == null ? 0x60 : from | 0), t = (to == null ? 0x100 : Math.min(256, to | 0));
  var p = Math.min(100, Math.max(0, pct | 0)), c = (colorIdx | 0) * 3;
  var out = new Uint8Array(dac); out._기록바탕 = 원래._기록바탕 || 원래; /* 계측 전용 꼬리표 — 이 팔레트를 만든 원래 팔레트(암전 판정 · 04_도구/우리그리기기록.js · 2026-09-27) */
  for (var i = f; i < t; i++) for (var k = 0; k < 3; k++) {
    var b6 = (dac[i * 3 + k] | 0) >> 2, t6 = (dac[c + k] | 0) >> 2;
    var v = (b6 + Math.trunc((t6 - b6) * p / 100)) & 63;          // 0x5FD65~0x5FD84 · DAC 6비트
    out[i * 3 + k] = ((v << 2) | (v >> 4)) & 0xFF;
  }
  this._dacPal = out;
  this._유닛쓸팔 = (keepPct != null) ? out : null;
  var pal = (keepPct != null && root.G2Native && root.G2Native.scalePalette) ? root.G2Native.scalePalette(out, keepPct) : out;
  var 합 = 0; for (var hi = 0x60 * 3; hi < out.length; hi += 7) 합 = (합 * 31 + out[hi]) | 0;
  if (this.팔레트만갈기) this.팔레트만갈기(pal, '다시섞기:' + (keepPct | 0) + ':' + 합);
  else this._팔레트반영(pal);
  return this;
};

/* 비연참 t243 색 전환 — DAC·유닛 표는 원래 팔레트로, 화면 팔레트는 리맵만 유지한다.
 * 0x5F9AE는 DAC를 복원하지만 백버퍼 픽셀 색 번호는 다시 그릴 때까지 남긴다.
 * `_팔레트반영` 대신 `팔레트만갈기`를 써 기존 지면/월드 층과 가림 순서를 재생성하지 않는다.
 * 틱279의 새 장에서 clearPaletteMix()가 리맵까지 걷고 원래 팔레트로 다시 칠한다. */
Renderer.prototype.restoreDACWithScreenRemap = function (keepPct) {
  this._섞기필터걷기();                                   /* 256색 섞기 필터가 걸려 있으면 먼저 걷는다 — 다시 칠한 팔레트 위에 겹치지 않게 */
  if (this._가벼운암전켬 && this._가벼운암전바탕) {        /* 가벼운 암전 — DAC 는 원래로 · 화면 리맵만 남긴다 (팔레트 정리 ③) */
    this._css암전배 = 1;
    return this._가벼운암전걸기(this._가벼운암전바탕, keepPct);
  }
  var base = this._palSaved || this._유닛팔레트();
  if (!base) return this;
  var pct = Math.max(0, Math.min(100, keepPct | 0));
  this._dacPal = base;
  this._유닛쓸팔 = base;
  var screenPal = (root.G2Native && root.G2Native.scalePalette)
    ? root.G2Native.scalePalette(base, pct) : base;
  if (this.팔레트만갈기) this.팔레트만갈기(screenPal, 'DAC복원-화면리맵:' + pct);
  else this._팔레트반영(screenPal);
  return this;
};

/** 맵 층(바닥 층 · 배경벽 · 스프라이트 층의 맵 그림)에 CSS 밝기를 건다/걷는다 — setPaletteMix 의 CSS 암전 (null 이면 걷기) */
Renderer.prototype._css암전걸기 = function (f) {
  var 걸린 = this._css암전요소 || [];
  걸린.forEach(function (e) { if (e && e.style && e._css암전 != null) { e.style.filter = e._css암전옛 || ''; e._css암전 = null; e._css암전옛 = null; } });
  this._css암전요소 = [];
  this._css암전 = f || null;
  if (!f) return this;
  var 목록 = this._css암전요소;
  function 걸기(e) {
    if (!e || !e.style || e._css암전 != null) return;
    e._css암전옛 = e.style.filter || '';
    e.style.filter = (e._css암전옛 ? e._css암전옛 + ' ' : '') + f;
    e._css암전 = f;
    목록.push(e);
  }
  걸기(this.groundLayer);                                  /* 바닥 · 바닥 애니 · 눕힌 오브젝트 · 배경(fpm) — 유닛 없음 */
  걸기(this.backdropEl);                                   /* 접어 세운 배경벽 */
  var 층 = this.objLayer;                                  /* 유닛과 맵 그림이 섞인 층 — 맵 그림만 */
  if (층 && 층.children) for (var i = 0; i < 층.children.length; i++) {
    var c = 층.children[i], cls = String(c.className || '');
    if (/(^|\s)g2-(map-|rowflat)/.test(cls)) 걸기(c);
  }
  return this;
};
Renderer.prototype.clearPaletteMix = function () {
  if (this._가벼운암전켬) this._가벼운암전걷기();          /* 가벼운 초필살 암전 — 맵 CSS 걷고 유닛만 원래 팔레트로 (팔레트 정리 ③) */
  if (this._css암전) this._css암전걸기(null);             /* CSS 암전(일반 필살)이면 밝기만 걷는다 — 팔레트는 안 바꿨다 */
  this._dacPal = null;
  this._유닛쓸팔 = null;          /* 목록 밖 유닛 밝기(연출밝은유닛)는 연출 틀이 끝에 되돌린다 — 본문 머리의 clearPaletteMix 가 지우면 안 된다 */
  if (this._물들임) this._화면물들임(null, 0);            /* 화면 전체 물들임도 걷는다 (Z-73) */
  var 필터였다 = this._섞기필터켬; this._섞기필터걷기();   /* 256색 섞기 필터 — 팔레트는 안 바꿨으니 걷기만 하면 된다 */
  this._원자필터 = false;
  if (!this._palSaved) return this;
  var base = this._palSaved; this._palSaved = null;
  if (필터였다 && this.nmap && this.nmap.palette === base) return this;
  /* ★ 되돌리기도 색만 칠한다 — 맵을 통째로 다시 지으면 xBRZ2 에서 190ms 멈칫했다 (2026-09-25 사장님 「덮히기는 하는데 많이 느려」)
   *   원본도 저장해 둔 256색을 다시 쓸 뿐이다(0x5F9AE). 못 칠하는 판(맵 없음 등)은 예전대로 다시 짓는다 */
  if (this.팔레트만갈기 && this.nmap && this._floorIdx) { var 합 = 0; for (var hi = 0; hi < base.length; hi++) 합 = (합 * 31 + base[hi]) | 0;   /* 바탕(시간대·날씨)이 바뀌면 딱지도 바뀌게 */
    this.팔레트만갈기(base, '복원:' + 합); this._팔레트캐시비우기(); return this; }
  this._팔레트반영(base);
  this._팔레트캐시비우기();
  return this;
};

/* ★ 연출이 끝나 원래 팔레트로 돌아오면 «지금 팔레트» 그림만 남기고 버린다 (2026-10-10 사장님 「리바이블 … 시전후 게임 자체가 엄청 느려졌어」 · 「그 이후에도 영향이 남는다」)
 *   줄·벽 조각마다 팔레트별 그림을 16장까지(_칠캐시) · 바닥도 16장(_floorCV캐시) 쥔다 — 매 프레임 팔레트가 바뀌는 연출(리바이블 116프레임)이면
 *   조각 수 × 16장이 연출 뒤에도 남아 메모리·GPU 를 눌렀다. 다음 연출에서 필요하면 다시 칠한다. */
Renderer.prototype._팔레트캐시비우기 = function () {
  var 지금 = this._지금딱지 || null;
  var 남길 = function (k) { return 지금 && String(k).slice(-지금.length) === 지금; };
  var 비움 = function (캐) { if (!캐) return; Object.keys(캐).forEach(function (k) { if (!남길(k)) delete 캐[k]; }); };
  비움(this._floorCV캐시);
  try {
    var 모두 = this.host && this.host.querySelectorAll ? this.host.querySelectorAll('*') : [];
    for (var i = 0; i < 모두.length; i++) if (모두[i]._칠캐시) 비움(모두[i]._칠캐시);
  } catch (e) { /* 화면이 없으면 건너뛴다 */ }
  return this;
};

/** 팔레트를 갈아 끼우고 구워 둔 것들을 다시 굽는다. */
Renderer.prototype._팔레트반영 = function (pal) {
  var self = this;
  if (this._map3dMapxBuildingPreview) {
    this._map3dMapxBuildingPreview.close(); this._map3dMapxBuildingPreview = null;
  }
  if (this.nmap) this.nmap.palette = pal;
  this._palette = pal;
  /* 블록·프레임 data-URL 캐시는 팔레트가 박혀 있으므로 통째로 버린다 */
  this._blkCache = {};
  this._tileURLCache = {};              // ★ 바닥 애니 타일도 팔레트를 문다 (2026-09-25 · 팔레트만갈기 주석)
  this._uurl = {};
  this._silCache = {};                  // ★ 발광 실루엣 (0x5F517) — 배율이 바뀌면 다시 굽는다
  /* 상태이상 이펙트도 팔레트를 물고 있다 (CHR_EFFC.SYB) */
  this._effcURL = {};
  /* ★ 그림자도 팔레트를 물고 있다 (SHADOW.SYB · 2026-08-17 · 시나리오 6-C)
   *   `_shadowKey` 에 팔레트 해시가 들어 있어 **기능은 정상**이지만, 여기서 안 비우면
   *   초필살기 시작·종료마다 **안 쓰는 팔레트 세대가 계속 쌓인다**(실측 5 → 7칸).
   *   다른 팔레트 종속 캐시와 **같은 자리**에서 함께 비운다. */
  this._shdURL = {};
  this._범위리맵URL = null; this._범위리맵팔 = null;   /* ★ 이동 범위 리맵판도 팔레트를 문다 */
  this._범위미리();   /* 정본 336 — 잠잠해지면 미리 만든다 */
  /* 상태 표시(CHR_EFFC)도 리맵 전 DAC 로 굽는다 — 리맵 몫은 연출밝은유닛·_표시어둡기가 CSS 로 한 번만 건다 */
  if (this._effcRaw) this._effc = root.G2Native.spriteCanvasProvider(this._effcRaw, this._유닛쓸팔 || pal);
  /* 유닛 스프라이트 공급자도 팔레트를 물고 있다 — 원본 인덱스 버퍼로 다시 만든다 */
  if (this._usprRaw && this._uspr) {
    this._usprPal = this._usprPal || {};
    /* ★ 유닛은 화면 리맵(0x454D5) 전 DAC 로 칠한다 — 원본은 리맵 «뒤»에 시전자·대상을 다시 그린다(0x44DCC · 0x12F2A) (2026-09-26) */
    var _유팔 = self._유닛쓸팔 || pal;
    Object.keys(this._usprRaw).forEach(function (f) {
      self._uspr[f] = 유닛공급자(self, f, _유팔);
      self._usprPal[f] = _유팔;
    });
  }
  /* 바닥·배경벽·오브젝트를 다시 굽는다 (같은 맵으로 재구성) */
  var map3dAgain = this._map3dPreview && this._map3dPreview.spec;
  if (this.nmap) this.useNativeMap(this.nmap, this.mapx);
  if (map3dAgain) { try { this.map3D건물진단(map3dAgain.source, map3dAgain.building,
    map3dAgain.policy, map3dAgain.options); }
    catch (e3d) { console.warn('[맵3D preview] 팔레트 재구성 실패:', e3d && e3d.message); } }
  this._맵아이템다시칠하기();          /* ☠ 복원 길에도 — 없으면 마법 뒤 상자가 물든 색으로 남는다(2026-09-25 사장님) */
  this._애니타일다시칠하기();
  this._범위리맵다시();
  this._유닛전체새로고침();
  return this;
};

/* ══════════════════════════════════════════════════════════════════════
 * ★★★★★ **맵 세우기를 단계로 나눈다** (2026-08-28)
 *
 * 사용자 지적: 「연결된 시나리오 시작시 **잠시 멈추는 듯한 딜레이**도 있고 …
 *   매끄럽지 못한건 완성도가 떨어지는거야」
 *
 * 계측 (셸 1-4 → 1-5 체인 · 검증 크롬 9333):
 *   `useNativeMap` 이 **한 덩어리로 400ms 넘게** 메인 스레드를 잡는다.
 *   그동안 전투 로딩 화면은 **열려 있는데 한 칸도 안 움직인다** — 「멈춘 화면」이다.
 *
 * ⇒ 본문을 **단계 배열**로 쪼갠다.
 *   · `useNativeMap`        — 예전 그대로 한 번에 돈다 (SCE `op 0x10` 맵 바꾸기 등)
 *   · `useNativeMap비동기`  — 단계 사이에 **프레임을 양보**하고 진행을 알린다
 *                              (전투 진입 `_원본맵초기화`가 쓴다 — 이미 async 다)
 *
 * ★ 단계 순서와 내용은 **한 자리도 바꾸지 않았다.** 나눈 자리만 다르다.
 * ════════════════════════════════════════════════════════════════════ */
Renderer.prototype._nativeMap단계 = function (map, mapx) {
  var self = this;
  var map3dModes = root.G2Map3DToggle && mapx && mapx.sourceMap
    ? root.G2Map3DToggle.resolve(mapx.sourceMap) : null;
  if (!this._mapLeaseRevokeUnsubscribe && root.G2Source &&
      typeof root.G2Source.onMapLeaseRevoked === 'function') {
    this._mapLeaseRevokeUnsubscribe = root.G2Source.onMapLeaseRevoked(function () {
      if (self._map3dMixedFloor) { self._map3dMixedFloor.close(); self._map3dMixedFloor = null; }
      if (self._mapSurfaceStore) self._mapSurfaceStore.openMap(null);
      if (self._map3dPreview && self._map3dPreview.proofReceipt)
        self.map3D건물진단();
      if (self._mapUPublishGate) self._mapUPublishGate.revoke();
      self._mapUPublishGate = null;
      self._mapSourceIdentity = null;
      var privateHandle = self._mapPrivateHandle;
      if (privateHandle) self._mapPrivateHandle = null;
      self._mapPrivateMapHandoff = null;
      self._mapPrivateMapCompletion = null;
      if (privateHandle) {
        try { Promise.resolve(privateHandle.revokeAndRelease('map-source-revoked'))
          .catch(function () {}); } catch (_) {}
      }
    });
    this._종료정리등록(function () {
      if (self._mapSurfaceStore) self._mapSurfaceStore.openMap(null);
      if (self._mapUPublishGate) self._mapUPublishGate.revoke();
      self._mapUPublishGate = null;
      self._mapSourceIdentity = null;
      self._mapPrivateMapHandoff = null;
      self._mapPrivateMapCompletion = null;
      self._mapLeaseRevokeUnsubscribe();
      self._mapLeaseRevokeUnsubscribe = null;
    });
  }
  /* A MAP load begun before source revocation may complete later. Its U lease
   * stays unavailable while the existing 2.5D map may still be displayed. */
  if (map._sourceIdentity && root.G2Source &&
      typeof root.G2Source.mapLeaseEpoch === 'function' &&
      map._mapLeaseEpoch !== root.G2Source.mapLeaseEpoch())
    map._sourceIdentity = null;
  if (this.nmap && this.nmap !== map && this._mapUPublishGate) {
    if (this._map3dMixedFloor) { this._map3dMixedFloor.close(); this._map3dMixedFloor = null; }
    this._mapUPublishGate.revoke();
    this._mapUPublishGate = null;
  }
  if (this.nmap && this.nmap !== map) {
    if (this._map3dMapxBuildingPreview) {
      this._map3dMapxBuildingPreview.close(); this._map3dMapxBuildingPreview = null;
    }
    this.map3D지형진단();
    this.map3D사물묶음끄기();
    this.map3D건물진단();
    if (root.G2Map3DUAuthoringDraft &&
        typeof root.G2Map3DUAuthoringDraft.onMapChanged === 'function') {
      try { root.G2Map3DUAuthoringDraft.onMapChanged(this); } catch (_) {}
    }
  }
  else {
    var oldPreview = this._map3dPreview;
    this._map3dPreview = null;
    if (this._map3dPreviewUnsub) { this._map3dPreviewUnsub(); this._map3dPreviewUnsub = null; }
    if (oldPreview) oldPreview.remove();
  }
  if (this.nmap && this.nmap !== map) { 판들버리기(this.nmap); 판들버리기(this); }   /* 맵이 바뀌면 옛 맵의 팔레트 판(그래픽 카드)을 버린다 */
  this.nmap = map; this.mapx = mapx || {};
  this._mapSourceIdentity = map._sourceIdentity || null;
  var openedMapLease = this._mapSurfaceStore && this._mapSurfaceStore.openMap(map);
   if (map._privateMapPrepared) {
     var preparedMap = map._privateMapPrepared;
     map._privateMapPrepared = null;
     var privateMapBound = false;
     try {
       privateMapBound = !!openedMapLease &&
         preparedMap.bindMapLease(openedMapLease,
           this._mapSurfaceStore.currentSource) === true;
     } catch (_) {}
     if (privateMapBound) {
      this._mapPrivateHandle = preparedMap;
      var handoff;
      try { handoff = preparedMap.testOnlyMapHandoff(this._mapSurfaceStore,
        function (receipt) {
          // 평면 카메라에서는 면이 없더라도 on 수명은 남아 있다.
          // 같은 opaque 완료의 명시 면만 정리한다.
          var preview = self._map3dPreview;
          var onSpec = self._map3dOnSpec;
          if (self._map3dMixedFloor) {
            self._map3dMixedFloor.close(); self._map3dMixedFloor = null;
          }
          if ((preview && preview.proofReceipt === receipt) ||
              (onSpec && onSpec.spec.options.proofReceipt === receipt))
            self.map3D건물진단();
          var draft = root.G2Map3DUAuthoringDraft;
          if (draft && typeof draft.onCompletedRevoked === 'function') {
            try { draft.onCompletedRevoked(self, receipt); } catch (_) {}
          }
        }); }
      catch (_) { handoff = null; }
      var publishGate = null;
      if (handoff && root.G2Map3DUPublishGate) {
        try {
          publishGate = root.G2Map3DUPublishGate.create(this._mapSurfaceStore,
            function (lease, receipt) {
              var read = self._mapPrivateMapCompletion;
              var completion = read && read();
              return self._mapUPublishGate === publishGate &&
                self._mapPrivateHandle === preparedMap &&
                self._mapPrivateMapHandoff === handoff &&
                lease === openedMapLease && !!completion &&
                completion.receipt === receipt;
            });
          this._mapUPublishGate = publishGate;
        } catch (_) { handoff = null; }
      }
      function discardHandoff(reason) {
        if (self._mapPrivateHandle !== preparedMap) return;
        if (publishGate) publishGate.revoke();
        self._mapPrivateHandle = null;
        self._mapPrivateMapHandoff = null;
        self._mapPrivateMapCompletion = null;
        try { Promise.resolve(preparedMap.revokeAndRelease(reason)).catch(function () {}); }
        catch (_) {}
      }
      if (!handoff || typeof handoff.request !== 'function')
        discardHandoff('map-handoff-unavailable');
      else {
        this._mapPrivateMapHandoff = handoff;
        this._mapPrivateMapCompletion = null;
        Promise.resolve().then(function () {
          return self._mapPrivateHandle === preparedMap &&
            self._mapSurfaceStore.currentSource() === openedMapLease
            ? handoff.request() : null;
        }).then(function (result) {
          if (self._mapPrivateHandle !== preparedMap ||
              self._mapPrivateMapHandoff !== handoff) return;
          var completed = false;
          try {
            completed = !!result && result.ok === true &&
              preparedMap.canPublish() === true &&
              self._mapSurfaceStore.currentSource() === openedMapLease &&
              handoff.testOnlyCurrentRecords(result.receipt).ok === true;
          } catch (_) {}
          if (!completed)
            return discardHandoff('map-handoff-failed');
          var receipt = result.receipt;
           self._mapPrivateMapCompletion = function () {
            try {
              if (self._mapPrivateHandle !== preparedMap ||
                  self._mapPrivateMapHandoff !== handoff ||
                  self._mapSurfaceStore.currentSource() !== openedMapLease ||
                  preparedMap.canPublish() !== true) return null;
              var selected = handoff.testOnlyCurrentRecords(receipt);
              if (!selected || selected.ok !== true ||
                  self._mapSurfaceStore.currentSource() !== openedMapLease ||
                  preparedMap.canPublish() !== true) return null;
              return Object.freeze({ receipt: receipt, records: selected.records });
             } catch (_) { return null; }
           };
           if (publishGate) {
             var admission = publishGate.publishCurrentCompletion(
               self._mapPrivateMapCompletion, openedMapLease, receipt);
             if (admission.status !== 'published' &&
                 admission.status !== 'verified-empty')
               discardHandoff('map-publish-failed');
           }
        }, function () { discardHandoff('map-handoff-failed'); });
      }
      this._종료정리등록(function () {
        if (self._mapPrivateHandle === preparedMap) {
          if (publishGate) publishGate.revoke();
          self._mapPrivateHandle = null;
          self._mapPrivateMapHandoff = null;
          self._mapPrivateMapCompletion = null;
          preparedMap.revokeAndRelease('map-session-ended').catch(function () {});
        }
      });
     } else {
       try { Promise.resolve(preparedMap.revokeAndRelease(
         'map-lease-bind-failed')).catch(function () {}); }
       catch (_) {}
     }
  }
  /* 새 3D 이식은 맵별로 명시적으로만 켠다. 아직 구현된 기능이 없어 모두 off이며
   * 기존 2.5D 생성 단계와 DOM은 이 값으로 변경하지 않는다. */
  this._map3dModes = map3dModes;
  this._blkCache = {};
  /* 접는 선(fold) — 이 행 위(0..foldY)는 세운 배경벽, 아래는 평평한 바닥. (mapx.backdrop.foldY) */
  var foldY = (this.mapx.backdrop && this.mapx.backdrop.foldY != null) ? this.mapx.backdrop.foldY : map.H;
  this._foldY = Math.max(0, Math.min(map.H, foldY));
  return [
  ['바닥 굽기', function () { self._맵단계_바닥굽기(map); }],
  /* ★ 층(단차) — 원본 layerC 지형8(절벽)로 계산한다. mapx 에서 tiers:false 로 끌 수 있다.
   *   ★★ **세 조각으로 나눈다** (2026-08-28) — 이 단계 혼자 188ms 를 써서
   *     비동기로 돌려도 여기서만 크게 멈췄다. 나누면 로딩 화면이 그만큼 더 자주 움직인다. */
  ['바닥 격자 1', function () { self.floorLayer.innerHTML = ''; self._원본바닥짓기(0, 3); }],
  ['바닥 격자 2', function () { self._원본바닥짓기(1, 3); }],
  ['바닥 격자 3', function () { self._원본바닥짓기(2, 3); }],
  ['배경벽', function () {
    /* 배경벽(접는선 위) — 지면+오브젝트 전부 구운 한 장을 접는선에 경첩으로 세운다. */
    self._배경벽짓기(map);
    self._원경짓기();                 /* ★ 배경벽보다 더 뒤에 고정 배경 (.fpm) */
  }],
  ['오브젝트', function () {
    /* 오브젝트 — 기존 PNG 오브젝트 제거 후 native 로 재구성. */
    try {
      self.flatObjLayer.innerHTML = '';
      self.objEls.forEach(function (e) { if (e.parentNode) e.parentNode.removeChild(e); });
      self.objEls = [];
      self._원본맵오브젝트짓기();
    } finally {
      // 가림 중 MAP 재구성은 새 sprite 조각을 만든다. 기존 가림 목록에 합친다.
      if (self._맵가림) self.맵가리기(true);
    }
  }],
  ['행 오버레이', function () {
    /* ★ 행별 눕힘 오버레이 — 원본 0x12BEE 의 목록 A 를 되살린다 (2026-08-27) */
    try {
      var _행수 = self._행별눕힘오버레이짓기();
      if (_행수) console.log('[맵] 행별 눕힘 오버레이 ' + _행수 + '행 (0x12BEE 목록 A)');
    } catch (e행) { console.warn('행별 눕힘 오버레이 실패:', e행 && e행.message); }
    if (self._맵가림) self.맵가리기(true);
  }],
  ['이동판정', function () {
    /* ★ 이동판정 지형도 원본 layerC 기반으로 교체 (추출 terrain.json 대체). EXE 0x70B0D 비용표. */
    /* ★★★ **`battle.map` 도 세운다** — `op 0x10`(맵 타일 바꾸기)이 이것을 본다.
     *   전에는 렌더러만 맵을 들고 있어 `sceapply` 의 `맵타일()` 이 **늘 false** 였다. */
    if (self.b) self.b.map = map;
    if (self.b && root.G2Native.mapTerrain) {
      self.b.terrain = root.G2Native.mapTerrain(map);
      console.log('[맵] 이동판정 terrain 도 원본 직독으로 교체');
    }
    self.apply();
  }]
  ];
};

/* 저장된 mapx 건물 전체를 한 거래로 표시한다. 기본 게임 진입 또는 비교 호출에서
 * 현재 제품 mapx 항목을 그대로 쓰며, 건물 소속/외관 승인을 뜻하지 않는다. */
Renderer.prototype.map3D맵X건물전체미리보기 = function () {
  var toggle = root.G2Map3DToggle, transaction = root.G2Map3DMapxBuildingTransaction;
  var mapx = this.mapx, name = mapx && mapx.sourceMap;
  var catalog = mapx && mapx.building3d;
  if (!this.nmap || !this.nmap._sourceIdentity ||
      this.nmap._sourceIdentity.actualRelativePath !== 'SCENARIO/' + name ||
      this._렌더러폐기됨 ||
      !name || !toggle || !transaction || !catalog ||
      catalog.schema !== 'g2.mapx-building/1' ||
      !Array.isArray(catalog.entries) || !catalog.entries.length ||
      this._map3dMapxBuildingPreview || this._map3dPreview ||
      this._map3dMixedFloor || this._map3dOnSpec)
    return { status: 'not-admitted', displayAllowed: false };
  var mode = toggle.resolve(name).buildingSurfaces;
  if (mode.requested !== 'off' || mode.effective !== 'off')
    return { status: 'not-admitted', displayAllowed: false };
  var entries = catalog.entries, prepared = null, handle = null;
  try {
    prepared = entries.length === 1
      ? transaction.prepare(this, entries[0])
      : transaction.prepareMany(this, entries);
    prepared.close(); prepared = null;
    toggle.set(name, 'buildingSurfaces', 'preview');
    handle = transaction.mountPreview(this, entries.length === 1 ? entries[0] : entries);
    if (!handle.displayAllowed || !handle.isCurrent())
      throw new TypeError(handle.reason || '현재 mapx 건물 표시가 거부됐다');
    return handle;
  } catch (error) {
    if (prepared) prepared.close();
    if (handle && handle.close) handle.close();
    if (toggle.resolve(name).buildingSurfaces.requested === 'preview')
      toggle.set(name, 'buildingSurfaces', 'off');
    return { status: 'not-admitted', displayAllowed: false,
      reason: error && error.message || '현재 mapx 건물 표시 실패' };
  }
};

Renderer.prototype.map3D맵X건물전체끄기 = function () {
  var handle = this._map3dMapxBuildingPreview;
  if (!handle) return false;
  handle.close();
  var toggle = root.G2Map3DToggle, name = this.mapx && this.mapx.sourceMap;
  if (toggle && name && toggle.resolve(name).buildingSurfaces.requested === 'preview')
    toggle.set(name, 'buildingSurfaces', 'off');
  return true;
};

/* 명시적으로 preview를 요청한 맵에서만 건물 면을 얹는다.
 * 원본 MAP 그림과 기존 2.5D 오브젝트는 그대로 두며 전투/입력에는 관여하지 않는다. */
/* 비공개 U 공급자가 동일 MAP lease의 변경 레코드를 전달하는 좁은 창구.
 * 이 함수는 건물 표시를 켜지 않는다. */
Renderer.prototype.map3D표면수신 = function (records, lease) {
  if (this._mapUPublishGate)
    throw new Error('완결 MAP U 게시 관문이 활성 상태다');
  if (!this._mapSurfaceStore || !lease || lease.map !== this.nmap ||
      lease !== this._mapSurfaceStore.currentSource())
    throw new Error('MAP U 원천 세대가 현재 맵과 다르다');
  return this._mapSurfaceStore.receive(records, lease);
};

/* U의 최종 소속과 실제 제품 MAP 조각을 M0 검사한 뒤에만 반환한다.
 * 이 조회만으로 DOM을 바꾸지 않는다. */
Renderer.prototype.map3D소속조회 = function (surfaceId, sourceSpec) {
  var store = this._mapSurfaceStore, lease = store && store.currentSource();
  if (!lease || lease.map !== this.nmap) return { status: 'source-unavailable' };
  var completion = this._mapPrivateMapCompletion && this._mapPrivateMapCompletion();
  var result = this._mapUPublishGate
    ? (completion ? this._mapUPublishGate.lookup(surfaceId, lease,
        completion.receipt) : { status: 'not-admitted' })
    : store.getMapSurface(surfaceId, lease.mapAssetId, lease.sourceHash);
  if (result.status !== 'ready') return result;
  if (!root.G2Map3DBuildingSource || !sourceSpec)
    throw new Error('독립 건물 소속과 M0 검사가 필요하다');
  root.G2Map3DBuildingSource.validateManifest(this.nmap, sourceSpec, result.value);
  return result;
};

/* 독립 소속 후보의 M0 검사를 통과한 현재 MAP에서만 M1 바닥 사본을 만든다.
 * 이 반환값은 표시 승인이나 owner 활성 상태가 아니며 원본 바닥은 바꾸지 않는다. */
Renderer.prototype.map3D바닥사본준비 = function (surfaceId, sourceSpec) {
  var owned = this.map3D소속조회(surfaceId, sourceSpec);
  if (owned.status !== 'ready') return owned;
  if (!root.G2Map3DFloorCOW)
    throw new Error('M1 바닥 사본 준비 모듈이 필요하다');
  var tileAnim = this.nmap.tileAnim;
  function movingTile(value) {
    var frames = tileAnim && tileAnim[value - 1];
    return !!(value > 0 && frames && frames.length > 1);
  }
  /* M1은 그림을 복사하지 않고 A 타일 번호를 옮긴다. 선택 칸과 복사 원천의
   * 애니 덧칠을 정적 바닥 후보로 승인하지 않는다. B 애니는 여기서 소비하지 않는다. */
  if (sourceSpec.parts.some(function (part) {
    return part.kind === 'tile' && movingTile(this.nmap.layerA[part.y * this.nmap.W + part.x]);
  }, this)) return { status: 'animated-floor-unproven', displayAllowed: false };
  /* v3 U의 원천 자격은 현재 MAP의 공통 지형 해석으로 재계산한다.
   * 사용자 지정 바닥 후보 규칙이며 원본 EXE의 지면 소속을 뜻하지 않는다. */
  var groundChoices = owned.value.groundChoices;
  var groundPolicy = owned.value.groundSourcePolicy;
  var sourceEligible = null, sourceLayerC = null, preparedSourceC = null;
  if (groundPolicy !== undefined) {
    if (groundPolicy !== 'nonflying-traversable' || !this.nmap.layerC ||
        !root.G2Native || typeof root.G2Native.mapTerrain !== 'function')
      return { status: 'ground-source-unavailable', displayAllowed: false };
    var terrain = root.G2Native.mapTerrain(this.nmap);
    if (!terrain || !terrain.칸 || terrain.폭 !== this.nmap.W ||
        terrain.높이 !== this.nmap.H)
      return { status: 'ground-source-unavailable', displayAllowed: false };
    sourceLayerC = this.nmap.layerC;
    preparedSourceC = sourceLayerC.slice();
    sourceEligible = function (x, y) {
      var cell = terrain.칸[y] && terrain.칸[y][x];
      return !!(cell && cell.비용 && cell.비용.slice(0, 5).some(function (cost) {
        return cost > 0;
      }));
    };
  }
  var prepared = groundChoices === undefined && !sourceEligible
    ? root.G2Map3DFloorCOW.prepare(this.nmap, sourceSpec)
    : root.G2Map3DFloorCOW.prepareWithGroundChoices(this.nmap, sourceSpec,
        groundChoices, sourceEligible);
  if (prepared.replacedTiles.some(function (part) { return movingTile(part.to); }))
    return { status: 'animated-floor-unproven', displayAllowed: false };
  var selectedA = sourceSpec.parts.filter(function (part) {
    return part.kind === 'tile';
  }).length;
  if (!selectedA || prepared.preservedTiles.length ||
      prepared.replacedTiles.length !== selectedA)
    return { status: 'incomplete', displayAllowed: false,
      preservedTiles: prepared.preservedTiles };
  var self = this, heldLease = this._mapSurfaceStore.currentSource();
  var heldCompletion = this._mapPrivateMapCompletion && this._mapPrivateMapCompletion();
  var heldReceipt = heldCompletion && heldCompletion.receipt;
  var heldMapView = prepared.mapView, heldLayerA = heldMapView.layerA;
  var preparedLayerA = heldLayerA.slice();
  var sourceLayerA = heldLease.map.layerA, sourceLayerB = heldLease.map.layerB;
  var preparedSourceA = sourceLayerA.slice(), preparedSourceB = sourceLayerB.slice();
  var heldReplaced = prepared.replacedTiles;
  var heldPreserved = prepared.preservedTiles;
  var preparedReplaced = heldReplaced.map(function (p) {
    return { x: p.x, y: p.y, from: p.from, to: p.to,
      distance: p.distance, sourceAt: p.sourceAt };
  });
  function current() {
    if (self._mapSurfaceStore.currentSource() !== heldLease ||
        heldLease.map !== self.nmap || prepared.mapView !== heldMapView ||
        heldLease.map.layerA !== sourceLayerA ||
         heldLease.map.layerB !== sourceLayerB ||
         (sourceLayerC && (heldLease.map.layerC !== sourceLayerC ||
           sourceLayerC.length !== preparedSourceC.length)) ||
        sourceLayerA.length !== preparedSourceA.length ||
        sourceLayerB.length !== preparedSourceB.length ||
        heldMapView.layerA !== heldLayerA ||
        heldMapView.layerB !== heldLease.map.layerB ||
        heldLayerA.length !== preparedLayerA.length ||
        prepared.replacedTiles !== heldReplaced ||
        heldReplaced.length !== preparedReplaced.length ||
        prepared.preservedTiles !== heldPreserved || heldPreserved.length) return false;
    for (var sourceAt = 0; sourceAt < preparedSourceA.length; sourceAt++)
      if (sourceLayerA[sourceAt] !== preparedSourceA[sourceAt]) return false;
    for (var sourceBAt = 0; sourceBAt < preparedSourceB.length; sourceBAt++)
      if (sourceLayerB[sourceBAt] !== preparedSourceB[sourceBAt]) return false;
    if (sourceLayerC) for (var sourceCAt = 0; sourceCAt < preparedSourceC.length; sourceCAt++)
      if (sourceLayerC[sourceCAt] !== preparedSourceC[sourceCAt]) return false;
    for (var i = 0; i < preparedLayerA.length; i++)
      if (heldLayerA[i] !== preparedLayerA[i]) return false;
    for (var j = 0; j < preparedReplaced.length; j++) {
      var a = heldReplaced[j], b = preparedReplaced[j];
      if (!a || a.x !== b.x || a.y !== b.y || a.from !== b.from ||
          a.to !== b.to || a.distance !== b.distance ||
          a.sourceAt !== b.sourceAt) return false;
    }
    var completion = self._mapPrivateMapCompletion && self._mapPrivateMapCompletion();
    if ((completion && completion.receipt) !== heldReceipt) return false;
    try {
      var now = self.map3D소속조회(surfaceId, sourceSpec);
      return now.status === 'ready' &&
        now.generation.sourceGeneration === owned.generation.sourceGeneration &&
        now.generation.revision === owned.generation.revision;
    } catch (_) { return false; }
  }
  return { status: 'prepared-only', mapView: prepared.mapView,
    replacedTiles: prepared.replacedTiles,
    preservedTiles: prepared.preservedTiles, displayAllowed: false,
    isCurrent: current };
};

/* 혼합 A+B의 표시 후보만 만든다. 현재 M1/receipt가 완전할 때 기존 바닥 굽기
 * 규칙을 사본에 재사용하며, 반환 버퍼는 DOM·_floorIdx·owner에 연결하지 않는다. */
Renderer.prototype.map3D혼합바닥사본시험 = function (sourceSpec, prepared) {
  if (!root.G2Map3DFloorCOW || !prepared || prepared.status !== 'prepared-only' ||
      typeof prepared.isCurrent !== 'function' || !prepared.isCurrent() ||
      !this.nmap || !this._floorIdx || !prepared.mapView ||
      Object.getPrototypeOf(prepared.mapView) !== this.nmap)
    return { status: 'not-current', displayAllowed: false };
  var protectedB = new Uint8Array(this._floorIdx.idx.length);
  var candidate = this._맵단계_바닥인덱스(prepared.mapView, protectedB);
  return root.G2Map3DFloorCOW.prepareDisplayFrame(
    this.nmap, sourceSpec, prepared, this._floorIdx, candidate, protectedB);
};

/* 현재 U receipt의 완전 M1과 A 최종 벽 마스크를 명시 호출에서만 바닥판에 적용한다.
 * 이 거래는 건물 owner/on을 열지 않으며, 닫거나 증거가 철회되면 이전 바닥판으로 복원한다. */
Renderer.prototype.map3D혼합바닥표시 = function (surfaceId, sourceSpec) {
  if (!root.G2Map3DFloorDisplayTransaction || !root.G2Map3DBuildingSource ||
      !root.G2Native || !this._mapUPublishGate || !this._mapPrivateMapCompletion ||
      !this.nmap || !this.nmap._sourceIdentity ||
      this.nmap._sourceIdentity.syntheticMap3DTest ||
      !this.mapx || !this.mapx.sourceMap || this._map3dOnSpec)
    return { status: 'not-admitted', displayAllowed: false };
  this.map3D혼합면끄기();
  if (this._map3dMixedFloor) {
    this._map3dMixedFloor.close(); this._map3dMixedFloor = null;
  }
  var m1, display, mask, completion, receipt, self = this;
  try {
    m1 = this.map3D바닥사본준비(surfaceId, sourceSpec);
    if (m1.status !== 'prepared-only') return m1;
    display = this.map3D혼합바닥사본시험(sourceSpec, m1);
    if (display.status !== 'prepared-only') return display;
    mask = root.G2Map3DBuildingSource.prepareBakedTileExclusion(
      this.nmap, sourceSpec, this._맵단계_바닥인덱스.bind(this));
    if (!mask.selectedPixels || !mask.isCurrent())
      return { status: 'not-admitted', displayAllowed: false };
    completion = this._mapPrivateMapCompletion();
    receipt = completion && completion.receipt;
    if (!receipt) return { status: 'not-admitted', displayAllowed: false };
    var heldMap = this.nmap, heldGate = this._mapUPublishGate;
    var proof = function () {
      if (!self._mapPrivateMapCompletion || !self._mapUPublishGate ||
          self._mapUPublishGate !== heldGate || !self._mapSurfaceStore ||
          self.nmap !== heldMap || Object.getPrototypeOf(m1.mapView) !== heldMap)
        return false;
      var now = self._mapPrivateMapCompletion();
      if (!now || now.receipt !== receipt || !m1.isCurrent()) return false;
      try { return self.map3D소속조회(surfaceId, sourceSpec).status === 'ready'; }
      catch (_) { return false; }
    };
    var style = root.document && root.document.getElementById('g2-바닥-스타일');
    var mounted = root.G2Map3DFloorDisplayTransaction.mountCurrent({
      renderer: this, prepared: display, mask: mask, spec: sourceSpec,
      styleElement: style, proofCurrent: proof,
      frameToCanvas: root.G2Native.frameToCanvas,
      subscribeRevocation: function (close) {
        return heldGate.onRevoke(close);
      }
    });
    if (mounted.status === 'current-mounted') {
      this._map3dMixedFloor = mounted;
      this._종료정리등록(function () { mounted.close(); });
    } else {
      display.close(); mask.close();
    }
    return mounted;
  } catch (_) {
    if (display && display.close) display.close();
    if (mask && mask.close) mask.close();
    return { status: 'not-admitted', displayAllowed: false };
  }
};

Renderer.prototype.map3D혼합바닥끄기 = function () {
  this.map3D혼합면끄기();
  if (!this._map3dMixedFloor) return false;
  this._map3dMixedFloor.close();
  this._map3dMixedFloor = null;
  return true;
};

/* 별도 U 표면 두 개의 완전 M1을 한 바닥판으로 표시한다. 각 M1/마스크와
 * 동일 native receipt가 모두 현재일 때만 유지하며 owner/on은 열지 않는다. */
Renderer.prototype.map3D두혼합바닥표시 = function (items) {
  if (!Array.isArray(items) || items.length !== 2 || !items[0] || !items[1] ||
      items[0].surfaceId === items[1].surfaceId ||
      !root.G2Map3DFloorDisplayTransaction || !root.G2Map3DBuildingSource ||
      !root.G2Native || !this._mapUPublishGate || !this._mapPrivateMapCompletion ||
      !this.nmap || !this.nmap._sourceIdentity ||
      this.nmap._sourceIdentity.syntheticMap3DTest ||
      !this.mapx || !this.mapx.sourceMap || this._map3dOnSpec)
    return { status: 'not-admitted', displayAllowed: false };
  this.map3D혼합바닥끄기();
  var self = this, map = this.nmap, gate = this._mapUPublishGate;
  var receipt = this._mapPrivateMapCompletion() && this._mapPrivateMapCompletion().receipt;
  var members = [], combinedDisplay = null, combinedMask = null, mounted = null;
  function closeMembers() {
    members.forEach(function (m) {
      if (m.display && m.display.close) m.display.close();
      if (m.mask && m.mask.close) m.mask.close();
    });
  }
  function proof() {
    if (!receipt || self.nmap !== map || self._mapUPublishGate !== gate ||
        !self._mapSurfaceStore || !self._mapPrivateMapCompletion ||
        self._mapPrivateMapCompletion().receipt !== receipt) return false;
    return members.length === 2 && members.every(function (m) {
      try { return m.m1.isCurrent() && m.display.isCurrent() &&
        m.mask.isCurrent() &&
        self.map3D소속조회(m.item.surfaceId, m.item.sourceSpec).status === 'ready'; }
      catch (_) { return false; }
    });
  }
  try {
    if (!receipt || this._map3dOnSpec) throw new Error('현재 off receipt 필요');
    items.forEach(function (item) {
      var m1 = self.map3D바닥사본준비(item.surfaceId, item.sourceSpec);
      if (m1.status !== 'prepared-only' || !m1.isCurrent() ||
          Object.getPrototypeOf(m1.mapView) !== map) throw new Error('M1 부재');
      var display = self.map3D혼합바닥사본시험(item.sourceSpec, m1);
      if (display.status !== 'prepared-only' || !display.isCurrent())
        throw new Error('완전 M1 부재');
      var mask = root.G2Map3DBuildingSource.prepareBakedTileExclusion(
        map, item.sourceSpec, self._맵단계_바닥인덱스.bind(self));
      members.push({ item: item, m1: m1, display: display, mask: mask });
      if (!mask.selectedPixels || !mask.isCurrent()) throw new Error('A 마스크 부재');
    });
    var base = this._floorIdx, mapView = Object.create(map);
    mapView.layerA = map.layerA.slice();
    var selected = new Set();
    members.forEach(function (m) {
      m.m1.replacedTiles.forEach(function (tile) {
        var at = tile.y * map.W + tile.x;
        if (selected.has(at) || mapView.layerA[at] !== tile.from)
          throw new Error('두 A칸 중복 또는 원천 변경');
        selected.add(at); mapView.layerA[at] = tile.to;
      });
    });
    var frame = this._맵단계_바닥인덱스(mapView,
      new Uint8Array(base.idx.length));
    if (frame.w !== base.w || frame.h !== base.h || frame.tr !== base.tr)
      throw new Error('합친 바닥 크기 불일치');
    var left = Math.min(members[0].mask.x, members[1].mask.x);
    var top = Math.min(members[0].mask.y, members[1].mask.y);
    var right = Math.max(members[0].mask.x + members[0].mask.w,
      members[1].mask.x + members[1].mask.w);
    var bottom = Math.max(members[0].mask.y + members[0].mask.h,
      members[1].mask.y + members[1].mask.h);
    var w = right - left, h = bottom - top;
    var allowed = new Uint8Array(w * h), covered = new Uint8Array(w * h);
    members.forEach(function (m) {
      var src = m.mask;
      for (var y = 0; y < src.h; y++) for (var x = 0; x < src.w; x++) {
        var from = y * src.w + x, to = (src.y - top + y) * w + src.x - left + x;
        if (src.mask[from]) allowed[to] = 1;
        if (src.coveredByBlockMask && src.coveredByBlockMask[from]) covered[to] = 1;
      }
    });
    combinedDisplay = { status: 'prepared-only', frame: frame, baseFrame: base,
      isCurrent: proof, close: closeMembers };
    combinedMask = { status: 'candidate-only', x: left, y: top, w: w, h: h,
      mask: allowed, coveredByBlockMask: covered, isCurrent: proof,
      close: closeMembers };
    var style = root.document && root.document.getElementById('g2-바닥-스타일');
    mounted = root.G2Map3DFloorDisplayTransaction.mountCurrent({
      renderer: this, prepared: combinedDisplay, mask: combinedMask,
      spec: { rect: { x: left, y: top, w: w, h: h } }, styleElement: style,
      proofCurrent: proof, frameToCanvas: root.G2Native.frameToCanvas,
      subscribeRevocation: function (close) { return gate.onRevoke(close); }
    });
    if (mounted.status !== 'current-mounted') throw new Error('합친 거래 거부');
    var pair = Object.freeze({ status: 'current-mounted', displayAllowed: true,
      pairItems: items.slice(), isCurrent: mounted.isCurrent, close: mounted.close });
    this._map3dMixedFloor = pair;
    this._종료정리등록(function () { pair.close(); });
    return pair;
  } catch (_) {
    if (mounted && mounted.close) mounted.close();
    closeMembers();
    return { status: 'not-admitted', displayAllowed: false };
  }
};

/* 혼합 건물의 면 원천은 현재 명시 바닥 거래가 살아 있는 동안만 준비한다.
 * 원본 A+B 그림을 조합할 뿐 높이·면 배치·픽셀 owner를 승인하거나 표시하지 않는다. */
Renderer.prototype.map3D혼합면원천준비 = function (surfaceId, sourceSpec) {
  var floor = this._map3dMixedFloor;
  if (!floor || !floor.isCurrent || !floor.isCurrent() ||
      (floor.pairItems && !floor.pairItems.some(function (item) {
        return item.surfaceId === surfaceId && item.sourceSpec === sourceSpec;
      })) ||
      !root.G2Map3DBuildingSource || !this.nmap ||
      !sourceSpec || !sourceSpec.rect || !Array.isArray(sourceSpec.parts) ||
      !sourceSpec.parts.some(function (part) { return part.kind === 'tile'; }) ||
      !sourceSpec.parts.some(function (part) { return part.kind === 'block'; }))
    return { status: 'not-current', displayAllowed: false };
  var prepared = this.map3D바닥사본준비(surfaceId, sourceSpec);
  if (prepared.status !== 'prepared-only' || !prepared.isCurrent())
    return { status: 'not-current', displayAllowed: false };
  if (root.G2Map3DBuildingSource.hasAnimatedSourceParts(this.nmap, sourceSpec))
    return { status: 'animated-source-unproven', displayAllowed: false };
  var source = root.G2Map3DBuildingSource.compose(this.nmap, sourceSpec);
  if (source.w !== sourceSpec.rect.w || source.h !== sourceSpec.rect.h ||
      !floor.isCurrent() || !prepared.isCurrent())
    return { status: 'not-current', displayAllowed: false };
  var self = this;
  return { status: 'prepared-only', displayAllowed: false, source: source,
    isCurrent: function () {
      return self._map3dMixedFloor === floor && floor.isCurrent() &&
        prepared.isCurrent();
    } };
};

/* 현재 명시 바닥 위에만 면을 시험한다. 면 높이/각도는 호출자의 별도
 * 리마스터 표시 입력이며 MAP 원본 사실 또는 owner/on 승인이 아니다. */
Renderer.prototype.map3D혼합면미리보기 = function (surfaceId, sourceSpec, building, policy, appendPair) {
  if (!appendPair) this.map3D혼합면끄기();
  if (this._map3dOnSpec)
    return { status: 'not-admitted', displayAllowed: false };
  var candidate = this.map3D혼합면원천준비(surfaceId, sourceSpec);
  if (candidate.status !== 'prepared-only') return candidate;
  if (!root.G2Map3DBuildingGeometry || !root.G2Map3DBuildingPreview ||
      !building || !policy || building.pw !== candidate.source.w ||
      building.ph !== candidate.source.h ||
      policy.tileW !== 24 || policy.tileH !== 16)
    return { status: 'geometry-input-required', displayAllowed: false };
  /* 위쪽 원천 돌출은 허용하되 좌·우와 아랫변은 같은 MAP 위치여야 한다. */
  if (building.x0 * policy.tileW !== sourceSpec.rect.x ||
      (building.x1 + 1) * policy.tileW !== sourceSpec.rect.x + sourceSpec.rect.w ||
      (building.y1 + 1) * policy.tileH !== sourceSpec.rect.y + sourceSpec.rect.h)
    return { status: 'placement-mismatch', displayAllowed: false };
  var shape, view, unsubscribe = null, frameRequest = null, legacy = [];
  try {
    shape = root.G2Map3DBuildingGeometry.faces(building, policy);
    if (!candidate.isCurrent()) return { status: 'not-current', displayAllowed: false };
    var seen = Object.create(null);
    sourceSpec.parts.forEach(function (part) {
      if (part.kind !== 'block') return;
      var key = part.x + ',' + part.y;
      if (seen[key]) throw new Error('중복 B 조각');
      seen[key] = true;
      var found = (this.objEls || []).filter(function (el) {
        return el._col === part.x && el._row === part.y && el.parentNode &&
          el.classList && el.classList.contains('g2-map-flatpiece');
      });
      if (found.length !== 1 || found[0].style.display === 'none')
        throw new Error('B 조각 격리 불가');
      legacy.push({ el: found[0], display: found[0].style.display });
    }, this);
    view = root.G2Map3DBuildingPreview.mount(this, shape, {
      source: candidate.source, palette: this.nmap.palette, scaler: root.G2Scaler,
      closedShell: true,
      sideSampling: building.sideEdges && building.sideEdges.every(Number.isInteger)
        ? { left: building.sideEdges[0], right: building.sideEdges[1] } : null
    });
    if (!candidate.isCurrent()) throw new Error('면 원천 철회');
    legacy.forEach(function (entry) { entry.el.style.display = 'none'; });
  } catch (_) {
    if (view) view.remove();
    legacy.forEach(function (entry) {
      if (entry.el.style.display === 'none') entry.el.style.display = entry.display;
    });
    return { status: 'geometry-unproven', displayAllowed: false };
  }
  var self = this, removed = false;
  function remove() {
    if (removed) return;
    removed = true;
    if (frameRequest !== null && root.cancelAnimationFrame)
      root.cancelAnimationFrame(frameRequest);
    if (unsubscribe) { unsubscribe(); unsubscribe = null; }
    legacy.forEach(function (entry) {
      if (entry.el.style.display === 'none') entry.el.style.display = entry.display;
    });
    view.remove();
    if (self._map3dMixedFace === handle) self._map3dMixedFace = null;
  }
  function current() {
    if (removed || !candidate.isCurrent() || !view.node.parentNode ||
        !legacy.every(function (entry) {
          return entry.el.parentNode && self.objEls.indexOf(entry.el) >= 0 &&
            entry.el.style.display === 'none';
        })) {
      remove(); return false;
    }
    return true;
  }
  var handle = { status: 'preview-only', ownerAllowed: false,
    node: view.node, faceEntries: view.faceEntries,
    roofPanel: view.roofPanel, backAlpha: view.backAlpha,
    isCurrent: current, remove: remove };
  try {
    unsubscribe = this._mapUPublishGate.onRevoke(remove);
    if (typeof unsubscribe !== 'function' || !current()) {
      remove(); return { status: 'not-current', displayAllowed: false };
    }
    if (!appendPair) this._map3dMixedFace = handle;
    this._종료정리등록(remove);
    if (root.requestAnimationFrame) {
      var tick = function () {
        if (current()) frameRequest = root.requestAnimationFrame(tick);
      };
      frameRequest = root.requestAnimationFrame(tick);
    }
    return handle;
  } catch (_) {
    remove(); return { status: 'not-current', displayAllowed: false };
  }
};

/* 한 receipt의 별도 두 표면을 독립 면으로 붙인다. 표시 시험 전용이며
 * 겹친 면의 픽셀 소유권이 확인되기 전에는 owner/on에 연결하지 않는다. */
Renderer.prototype.map3D두혼합면미리보기 = function (items, policy, options) {
  this.map3D혼합면끄기();
  var floor = this._map3dMixedFloor;
  if (!floor || !floor.pairItems || !floor.isCurrent() ||
      !Array.isArray(items) || items.length !== 2 || !policy || this._map3dOnSpec ||
      !items.every(function (item) {
        return item && floor.pairItems.some(function (held) {
          return held.surfaceId === item.surfaceId && held.sourceSpec === item.sourceSpec;
        });
      })) return { status: 'not-current', displayAllowed: false };
  var views = [], self = this;
  for (var i = 0; i < 2; i++) {
    var item = items[i];
    var view = this.map3D혼합면미리보기(
      item.surfaceId, item.sourceSpec, item.building, item.policy || policy, true);
    if (view.status !== 'preview-only') {
      views.forEach(function (v) { v.remove(); });
      return view;
    }
    views.push(view);
  }
  var composite = null;
  if (options && options.pixelDepthDiagnostic === true) {
    try {
      composite = root.G2Map3DBuildingPreview.mountPairPixelMask(this, views);
    } catch (_) {
      views.forEach(function (v) { v.remove(); });
      return { status: 'pixel-depth-unproven', displayAllowed: false };
    }
  }
  var removed = false, unsubscribe = null;
  var handle = { status: 'preview-only', ownerAllowed: false,
    views: views, composite: composite,
    faceEntries: views.map(function (v) { return v.faceEntries; }),
    isCurrent: function () {
      if (removed || composite && !composite.isCurrent() || !floor.isCurrent() ||
          !views.every(function (v) { return v.isCurrent(); })) {
        handle.remove(); return false;
      }
      return true;
    },
    remove: function () {
      if (removed) return;
      removed = true;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (composite) composite.remove();
      views.forEach(function (v) { v.remove(); });
      if (self._map3dMixedFace === handle) self._map3dMixedFace = null;
    } };
  try {
    unsubscribe = this._mapUPublishGate.onRevoke(handle.remove);
    if (typeof unsubscribe !== 'function' || !handle.isCurrent()) {
      handle.remove();
      return { status: 'not-current', displayAllowed: false };
    }
  } catch (_) {
    handle.remove();
    return { status: 'not-current', displayAllowed: false };
  }
  this._map3dMixedFace = handle;
  this._종료정리등록(handle.remove);
  return handle;
};

Renderer.prototype.map3D혼합면끄기 = function () {
  if (!this._map3dMixedFace) return false;
  this._map3dMixedFace.remove();
  return true;
};

Renderer.prototype.map3D건물진단 = function (sourceSpec, building, policy, options) {
  var t = root.G2Map3DToggle, name = this.mapx && this.mapx.sourceMap;
  var preservingFlatOn = !sourceSpec && options && options.preserveFlatOn === true;
  if (this._map3dFaceOwnerProbe) {
    this._map3dFaceOwnerProbe.remove(); this._map3dFaceOwnerProbe = null;
  }
  var oldPreview = this._map3dPreview;
  this._map3dPreview = null;
  if (this._map3dPreviewUnsub) { this._map3dPreviewUnsub(); this._map3dPreviewUnsub = null; }
  if (oldPreview) oldPreview.remove();
  if (!sourceSpec && !building && !policy && !preservingFlatOn &&
      this._map3dOnSpec && t && name) {
    this._map3dOnSpec = null;
    t.revokeBuildingSurface(name);
  }
  if (!sourceSpec && !building && !policy && oldPreview && !preservingFlatOn &&
      typeof oldPreview.restoreRequested === 'function') {
    try { oldPreview.restoreRequested(); }
    catch (error) { console.warn('[맵3D preview] 이전 토글 복원 실패:', error); }
  }
  if (!sourceSpec && !building && !policy) return null;  /* 명시적 정리 */
  if (this._렌더러폐기됨) return null;
  var mode = t && name && t.resolve(name).buildingSurfaces.effective;
  if (!this.nmap || !name || (mode !== 'preview' && mode !== 'on')) return null;
  /* 기울기 0에서는 세운 벽이 접혀 B 마스크만 남는다. 기존 집 그림을 보존한다. */
  if (options && options.keepMasks && this.cam && this.cam.tilt === 0) return null;
  var proofCurrent = options && options.proofCurrent;
  function currentProof() {
    try { return typeof proofCurrent === 'function' && proofCurrent() === true; }
    catch (_) { return false; }
  }
  if (options && options.proofReceipt &&
      !currentProof()) return null;
  if (!root.G2Map3DBuildingSource || !root.G2Map3DBuildingGeometry || !root.G2Map3DBuildingPreview)
    throw new Error('건물 진단 모듈을 먼저 적재해야 한다');
  if (options && options.proofReceipt &&
      root.G2Map3DBuildingSource.hasAnimatedSourceParts(this.nmap, sourceSpec)) return null;
  var source = root.G2Map3DBuildingSource.compose(this.nmap, sourceSpec);
  var trim = sourceSpec.trimOuterWall;
  var designated = trim && !building.sideEdges
    ? Object.assign({}, building, { sideEdges: [trim.left, trim.right + 1] }) : building;
  var shape = root.G2Map3DBuildingGeometry.faces(designated, policy);
  if (source.w !== building.pw || source.h !== building.ph)
    throw new Error('건물 원천 그림과 표시 면의 크기가 다르다');
  var legacy = [], maskEntries = [];
  if (options && (options.isolate || options.keepMasks)) {
    /* 기존 조각이 정확히 하나씩 DOM에 있을 때만 이 미리보기에서 격리한다.
     * 다른 맵/묶음/바닥에 구운 조각은 실패 시 기존 2.5D를 그대로 둔다. */
    var used = Object.create(null);
    sourceSpec.parts.forEach(function (part) {
      if (part.kind !== 'block') throw new Error('격리 미리보기는 MAP 블록만 허용한다');
      var key = part.x + ',' + part.y;
      if (used[key]) throw new Error('중복 건물 블록 지정: ' + key);
      used[key] = true;
      var found = (this.objEls || []).filter(function (e) {
        return e._col === part.x && e._row === part.y && e.parentNode &&
          e.classList && e.classList.contains('g2-map-flatpiece');
      });
      if (found.length !== 1 || found[0].style.display === 'none')
        throw new Error('기존 건물 블록을 안전하게 격리할 수 없다: ' + key);
      legacy.push({ el: found[0], display: found[0].style.display });
    }, this);
  }
  if (options && options.keepMasks) {
    if (options.isolate || !root.G2Map3DBuildingSource.prepareBlockKeepAlpha ||
        !root.G2Map3DBuildingPreview.mountBlockKeepMasks)
      throw new Error('B 조각 보존 마스크를 준비할 수 없다');
    maskEntries = legacy.map(function (entry, index) {
      return { el: entry.el, keep: root.G2Map3DBuildingSource.prepareBlockKeepAlpha(
        this.nmap, sourceSpec, source, index) };
    }, this);
  }
  /* 팔레트/배율 재구성은 이 명시 요청을 다시 쓴다. 호출자의 이후 편집이
   * 재요청 없이 다른 조각·면 정책을 붙이지 않도록 현재 값만 보유한다. */
  var savedSource = Object.assign({}, sourceSpec, {
    rect: Object.freeze(Object.assign({}, sourceSpec.rect)),
    parts: Object.freeze(sourceSpec.parts.map(function (part) {
      return Object.freeze(Object.assign({}, part));
    }))
  });
  if (sourceSpec.trimOuterWall)
    savedSource.trimOuterWall = Object.freeze(Object.assign({}, sourceSpec.trimOuterWall));
  Object.freeze(savedSource);
  var savedBuilding = Object.assign({}, building);
  if (Array.isArray(building.sideDepth))
    savedBuilding.sideDepth = Object.freeze(building.sideDepth.slice());
  if (Array.isArray(building.sideEdges))
    savedBuilding.sideEdges = Object.freeze(building.sideEdges.slice());
  Object.freeze(savedBuilding);
  var savedPolicy = Object.freeze(Object.assign({}, policy));
  var savedOptions = options && Object.freeze({ texture: !!options.texture,
    isolate: !!options.isolate, keepMasks: !!options.keepMasks,
    proofReceipt: options.proofReceipt || null,
    proofCurrent: proofCurrent, restoreRequested: options.restoreRequested });
  var view = root.G2Map3DBuildingPreview.mount(this, shape,
    options && options.texture ? { source: source, palette: this.nmap.palette,
      scaler: root.G2Scaler,
      sideSampling: designated.sideEdges && designated.sideEdges.every(Number.isInteger)
        ? { left: designated.sideEdges[0], right: designated.sideEdges[1] }
        : null } : null);
  if (options && options.proofReceipt && !currentProof()) {
    view.remove();
    return null;
  }
  var masks = null;
  try {
    if (maskEntries.length)
      masks = root.G2Map3DBuildingPreview.mountBlockKeepMasks(maskEntries);
  } catch (error) { view.remove(); throw error; }
  if (options && options.proofReceipt && !currentProof()) {
    if (masks) masks.remove();
    view.remove();
    return null;
  }
  /* 배경생성 도막에서 맵을 가린 동안 재생성된 진단면도 맵과 함께 숨긴다. */
  if (this._맵가림) {
    view.node._옛display = view.node.style.display || '';
    view.node.style.display = 'none';
  }
  /* 맵 조각을 화면 아래 연출 판 밑으로 내린 동안 진단면만 위에 남기지 않는다. */
  if (this._오브젝트내림) view.node.style.visibility = 'hidden';
  if (options && options.isolate)
    legacy.forEach(function (entry) { entry.el.style.display = 'none'; });
  this._map3dPreview = { node: view.node, faceEntries: view.faceEntries,
    ridgeOpaqueFraction: view.ridgeOpaqueFraction, backImage: view.backImage,
    backAlpha: view.backAlpha, roofPanel: view.roofPanel,
    proofReceipt: options && options.proofReceipt || null,
    proofCurrent: proofCurrent,
    restoreRequested: options && options.restoreRequested,
    spec: { source: savedSource, building: savedBuilding,
            policy: savedPolicy, options: savedOptions },
    remove: function () {
    if (masks) masks.remove();
    if (options && options.isolate)
      legacy.forEach(function (entry) { entry.el.style.display = entry.display; });
    view.remove();
  } };
  var self = this;
  this._map3dPreviewUnsub = t.subscribe(function (changed) {
    if (changed == null || changed === String(name).replace(/\.MAP$/i, '').toUpperCase()) {
      var effective = t.resolve(name).buildingSurfaces.effective;
      if (effective !== 'preview' && effective !== 'on') self.map3D건물진단();
    }
  });
  if (mode === 'on' && this._map3dOnSpec && this._map3dOnSpec.surfaceId) {
    if (!this.map3D면소유권시험(this._map3dOnSpec.surfaceId)) {
      this.map3D건물진단();
      return null;
    }
  }
  return { node: view.node, sourceSize: [source.w, source.h],
           isolatedPieces: options && options.isolate ? legacy.length : 0,
           maskedPieces: maskEntries.length,
           opaquePixels: source.idx.reduce(function (n, x) { return n + (x >= 0); }, 0),
           remove: function () {
             if (self._map3dPreview && self._map3dPreview.node === view.node)
               self.map3D건물진단();
           } };
};

/* 완료 receipt 아래 현재 명시 면의 합성 순서만 조사한다. 유닛 앞/뒤 ID는
 * 진단 호출자가 지정하며, 실제 owner/on 판정과 게임 상태에는 사용하지 않는다. */
Renderer.prototype.map3D면소유권시험 = function (surfaceId) {
  var preview = this._map3dPreview, t = root.G2Map3DToggle;
  try {
    if (!preview || !preview.proofReceipt || !preview.proofCurrent ||
        preview.proofCurrent() !== true || !this.cam || this.cam.tilt === 0 ||
        !this.mapx || !t ||
        ['preview', 'on'].indexOf(t.resolve(this.mapx.sourceMap).buildingSurfaces.effective) < 0 ||
        !this.map3D소속조회 ||
        this.map3D소속조회(surfaceId, preview.spec.source).status !== 'ready' ||
        !root.G2Map3DBuildingPreview.mountFaceOwnerProbe)
      return null;
  } catch (_) { return null; }
  if (this._map3dFaceOwnerProbe) this._map3dFaceOwnerProbe.remove();
  this._map3dFaceOwnerProbe = root.G2Map3DBuildingPreview.mountFaceOwnerProbe(
    this, preview);
  return this._map3dFaceOwnerProbe;
};

/* 명시 클릭에서만 현재 U 완료 receipt의 한 표면을 소유한다. */
Renderer.prototype.map3D면소유권켜기 = function (surfaceId) {
  var preview = this._map3dPreview, t = root.G2Map3DToggle;
  var name = this.mapx && this.mapx.sourceMap;
  try {
    if (!preview || !preview.proofReceipt || !preview.proofCurrent ||
        preview.proofCurrent() !== true || !this.cam || this.cam.tilt === 0 ||
        !name ||
        !t || !this.map3D소속조회 ||
        this.map3D소속조회(surfaceId, preview.spec.source).status !== 'ready' ||
        !t.grantBuildingSurface(name, surfaceId, preview.proofCurrent)) return null;
    this._map3dOnSpec = { surfaceId: surfaceId, spec: preview.spec };
    t.set(name, 'buildingSurfaces', 'on');
    var owner = this.map3D면소유권시험(surfaceId);
    if (!owner) { this.map3D건물진단(); return null; }
    return owner;
  } catch (_) {
    this.map3D건물진단();
    return null;
  }
};

/** 예전 그대로 — **한 번에** 다 돈다. SCE `op 0x10` 처럼 그 자리에서 끝나야 하는 곳이 쓴다. */
Renderer.prototype.useNativeMap = function (map, mapx) {
  if (this._렌더러폐기됨 || !map || !root.G2Native) return;
  var 단계 = this._nativeMap단계(map, mapx);
  try {
    for (var i = 0; i < 단계.length; i++) 단계[i][1]();
  } catch (error) {
    if (this._mapSurfaceStore) this._mapSurfaceStore.openMap(null);
    if (this._mapUPublishGate) this._mapUPublishGate.revoke();
    this._mapUPublishGate = null;
    this._mapSourceIdentity = null;
    var privateHandle = this._mapPrivateHandle;
    this._mapPrivateHandle = null;
    this._mapPrivateMapHandoff = null;
    this._mapPrivateMapCompletion = null;
    if (privateHandle) {
      try { Promise.resolve(privateHandle.revokeAndRelease('map-stage-failed'))
        .catch(function () {}); } catch (_) {}
    }
    throw error;
  }
};

/**
 * ★ 단계마다 **프레임을 양보**하며 돈다 — 로딩 화면이 실제로 움직인다.
 * @param {function} [진행]  `(이름, 몇째, 전체)` — 로딩 칸을 채우는 데 쓴다
 * @returns {Promise} 다 끝나면 resolve
 */
Renderer.prototype.useNativeMap비동기 = function (map, mapx, 진행, 현재로딩, 요청신호) {
  if (this._렌더러폐기됨 || !map || !root.G2Native) return Promise.resolve();
  var self = this, 단계 = this._nativeMap단계(map, mapx), i = 0;
  return new Promise(function (끝, 실패) {
    var finished = false;
    var unregister = self._종료정리등록(function () { finish(); });
    var onAbort = function () { finish(); };
    function cleanup() {
      if (finished) return false;
      finished = true;
      if (요청신호) 요청신호.removeEventListener('abort', onAbort);
      unregister();
      return true;
    }
    function finish() { if (cleanup()) 끝(); }
    function fail(error) { if (cleanup()) 실패(error); }
    if (요청신호) {
      요청신호.addEventListener('abort', onAbort, { once: true });
      if (요청신호.aborted) { finish(); return; }
    }
    (function 다음() {
      if (finished) return;
      if (i >= 단계.length) { finish(); return; }
      try { self._다음프레임().then(function () {
        if (finished || self._렌더러폐기됨 ||
            (현재로딩 && !현재로딩())) { finish(); return; }
        var s = 단계[i++];
        try { s[1](); }
        catch (e단) {
          if (self._mapSurfaceStore) self._mapSurfaceStore.openMap(null);
          if (self._mapUPublishGate) self._mapUPublishGate.revoke();
          self._mapUPublishGate = null;
          self._mapSourceIdentity = null;
          var privateHandle = self._mapPrivateHandle;
          self._mapPrivateHandle = null;
          self._mapPrivateMapHandoff = null;
          self._mapPrivateMapCompletion = null;
          if (privateHandle) {
            try { Promise.resolve(privateHandle.revokeAndRelease('map-stage-failed'))
              .catch(function () {}); } catch (_) {}
          }
          console.warn('[맵] 단계 「' + s[0] + '」 실패:', e단 && e단.message);
        }
        if (진행) { try { 진행(s[0], i, 단계.length); } catch (e진) {} }
        다음();
      }, function () { finish(); }); }
      catch (error) { fail(error); }
    })();
  });
};

/** 바닥 한 장 굽기 — 지면 + 눕힌 오브젝트를 구워 `_floorURL` 로 만든다. */
Renderer.prototype._맵단계_바닥인덱스 = function (map, protectedB) {
  var self = this;
  /* 바닥(접는선 아래) — 지면 + 눕힌 오브젝트를 구워넣는다. 세운 것(나무)만 빌보드로 남긴다. */
  var g = root.G2Native.mapGround(map, 0), GW = g.w;
  root.G2Native.mapObjects(map).forEach(function (o) {
    if (self._원본오브젝트분류(o.blockIndex, o.height) !== 'flat') return;
    /* ★★★★★★★ **여러 행에 걸치는 눕힘은 굽지 않는다** (2026-09-04 · 사용자 지정)
     *
     *   > 사용자: 「**눕힌 오브젝트중 캐릭터 위로 올라가야하는게 있는데 캐릭터가
     *   >  위로 올라가는 부분이 있음.** 예를들어 **집 지붕위로 캐릭터가 올라감**」
     *   > 「**지금 이건 전투에 적용되는 2.5d 맵에도 동일하게 적용**되어야해.」
     *   > 선택: 「**누운 것도 개별 조각으로 대열에 (마을과 같게)**」
     *
     *   ☠ 눕힘은 「2.5D 로 기울일 때 빌보드가 어긋나므로 지면에 눕힌다」는 뜻일 뿐
     *     **앞뒤와 무관하다.** 그런데 구워 버리면 행 정렬 대열에서 빠져
     *     **늘 캐릭터 아래**가 된다 — 지붕이 캐릭터를 못 가린다.
     *
     *   ★ 원본은 구분이 없다. 마을 `PACK 0x21FDA` 는 위층을 **SPR 2 로 레코드에
     *     등록해 정렬 표(`0x83D84`)에 넣고**, 전투 `0x12BEE` 는 **행마다** 훑는다.
     *
     *   ★★ 그래서 **`h > 16`(여러 행에 걸치는 것)만** 조각으로 올린다.
     *     `h ≤ 16` 은 한 행 안에 들어가므로 구워도 순서가 안 틀린다.
     *     실측 (SCENARIO 231 장) — 굽지 않을 것 **평균 68 · 최다 772**(CYRUPS),
     *     전부 올리면 평균 263 · 최다 1483 이라 **4 배 무겁다.** */
    if (o.height > TH) return;
    /* ★★★ **움직이는 블록은 굽지 않는다** (2026-08-17)
     *   구워 버리면 요소가 없어 `fx.js 오브젝트애니()` 가 갈아 끼울 대상이 사라진다 —
     *   물결·불꽃·풀이 **정지 그림**이 된다. 대신 `_buildObjectsNative` 가
     *   **눕힌 요소**로 따로 만든다(`_눕힌애니`). 사용자 지정: 「타일이나 오브젝트
     *   애니메이션 구현되어야 하고」. BEA01·AST·PAN 은 애니 블록이 전부 h=16 이라
     *   `_classifyNative` 가 무조건 flat 으로 보내 **11·8·8종이 통째로 멈춰 있었다.** */
    if (self._애니블록(o.blockIndex)) return;
    var fr = o.frame, px = o.x * TW, py = o.y * TH + TH - fr.h, yy, xx, ry, rx, v;
    for (yy = 0; yy < fr.h; yy++) { ry = py + yy; if (ry < 0 || ry >= g.h) continue;
      for (xx = 0; xx < fr.w; xx++) { rx = px + xx; if (rx < 0 || rx >= GW) continue;
        v = fr.idx[yy * fr.w + xx]; if (v >= 0) {
          var pixel = ry * GW + rx;
          g.idx[pixel] = v;
          if (protectedB) protectedB[pixel] = 1;
        } } }
  });
  return g;
};
Renderer.prototype._맵단계_바닥굽기 = function (map) {
  var g = this._맵단계_바닥인덱스(map);
  var _바닥바탕 = root.G2Native.frameToCanvas(g, map.palette);
  this._floorURL = _바닥바탕.toDataURL();
  /* 팔레트 GPU 판의 바탕 — 맵을 지을 때 이미 확대한 그림을 그대로 쓴다(첫 걸음에 다시 확대하지 않게 · palettegpu.js) */
  this._바닥바탕 = { cv: _바닥바탕, pal: map.palette, 필터: root.G2Scaler ? root.G2Scaler.cur() : 'none' };
  this._floorW = g.w; this._floorH = g.h;          // 논리 크기 — background-size 용
  this._바닥규칙쓰기();
  /* ★ 인덱스 버퍼를 쥐고 있는다 — 이동 범위 리맵판을 **다시 계산하지 않고** 굽는다 */
  this._floorIdx = g;
  this._floorURL캐시 = null;                      /* ★ 맵이 바뀌면 음영 캐시도 버린다 */
  this._범위리맵URL = null; this._범위리맵팔 = null;
  this._범위미리();   /* 정본 336 — 잠잠해지면 미리 만든다 */
  this._가시리맵URL = null; this._가시리맵팔 = null;   /* [리마스터] 무덤 가시 리맵판 */
  this._범위리맵미리굽기();
};

/* ★ 범위 표시 바닥(맵 전체 리맵판)을 «한가할 때» 미리 굽는다 (2026-10-10 사장님 「링커맨드 처음 열때 버벅거리고 계속 그런다고」)
 *   굽기는 맵 한 장 확대(xBRZ)라 300ms 남짓 — 링을 «여는 순간» 구우면 그만큼 멈칫했다(헤드리스 19-1 프로파일: 첫 열기 380ms 가 이것).
 *   맵이 서거나 바탕 팔레트(시간대·날씨)가 바뀐 뒤 연출이 없을 때 쉬는 틈에 굽는다. 결과·캐시 규칙은 _범위리맵바닥 그대로. */
Renderer.prototype._범위리맵미리굽기 = function () {
  var self = this;
  if (typeof setTimeout !== 'function' || this._범위리맵예약) return;
  this._범위리맵예약 = true;
  var 쉬는틈 = (typeof requestIdleCallback === 'function')
    ? function (fn) { requestIdleCallback(fn, { timeout: 3000 }); } : function (fn) { setTimeout(fn, 400); };
  setTimeout(function () {
    쉬는틈(function () {
      self._범위리맵예약 = false;
      if (self._렌더러폐기됨 || self._palSaved || self._섞기필터켬) return;   /* 연출 중 팔레트로는 굽지 않는다 */
      try { self._범위리맵바닥(); } catch (e) {}
    });
  }, 300);
};

/**
 * ★★★★★ **이동·공격 범위 표시** — 원본 `0x1547F` → `0x10130` (2026-09-10)
 *
 *   > 사장님: 「이동 범위 리맵은 **색깔만 변경**한다는거지? 맞으면 진행해줘.」
 *   ★ 그렇다. 칸의 **픽셀 색만** 표로 바꾼다 — 모양·자리는 그대로다.
 *
 *   ```asm
 *   0x10135  edi = [0xB8550]    ; 지금 고른 표
 *   0x10140  dx  = 0x10         ; 16 줄  (TH)
 *   0x10146  ecx = 0x18         ; 24 픽셀 (TW)
 *   0x1014D  bl = [ebx + edi]   ; ★ 픽셀 = LUT[픽셀]
 *   0x154CC  뱅크 1 = 목표색 **1**(흰) · 강도 **30** · 보정 **+9**
 *   ```
 *
 *   ☠ 전에는 `rgba(255,255,255,.30)` 를 **덧칠**했다. 알파 합성으로는 `+9`(8비트 +36)를
 *     낼 수 없어 **원본보다 어두웠다.** 실측(15-2 사막) — 채널당 **31** 어두웠다:
 *     `158,113,97` → 원본 **219,186,178** vs 우리 187,156,144.
 *
 *   ☠ `자산/ui.json` 의 `lut.뱅크1.표` 는 **다른 팔레트로 구운 것**이라 못 쓴다
 *     (맵 색을 전부 6번으로 보낸다). 표는 **지금 맵 팔레트로 다시 구워야** 한다 —
 *     `remap.js 표1()` 이 원본 알고리즘 그대로다(EXE 에뮬레이션과 256/256 일치).
 *
 *   ⇒ 바닥 그림을 **리맵 팔레트로 한 벌 더** 구워 두고, 표시할 칸에 그 그림의
 *     **같은 자리**를 오려 얹는다. 곧 「같은 칸, 색만 바뀐 것」이다.
 *   ★ **처음 쓸 때만** 굽는다 — 범위를 한 번도 안 여는 판에서는 비용이 0이다.
 *
 * @returns {string|null} 리맵한 바닥 그림 주소. 못 만들면 null(그러면 옛 반투명으로 떨어진다)
 */
/** [리마스터] 무덤 가시 칸 범위 리맵판 — 바닥 번호판 + 눕힌 오브젝트(가시)를 합쳐 일반 칸과 «같은 표»(G2Remap 표1)로 다시 칠한다 (2026-10-12)
 *   사장님(원문) 「근데 왜 가시 위와 일반 타일 위 색깔이 달라?」 — 일반 칸은 바닥 리맵(0x1547F 뜻)인데 가시 칸은 눕힌 가시 조각이 그 위를 덮어
 *   반투명 흰 네모를 얹었었다. 이 판에서 그 칸만 잘라 오버레이층에 얹으면 일반 칸과 같은 색이 된다. 가시가 없는 맵이면 null. */
Renderer.prototype._가시리맵판 = function () {
  /* ★ 2026-10-12 넓힘 — 사장님 「가시뿐만아니라 다른 오브젝트 위에 올라갈때도 같은 방식이어야해」: 무덤 가시만이 아니라 어느 맵이든 눕혀 그린 오브젝트 전부 */
  var pal = this._유닛팔레트(), m = this.nmap, g = this._floorIdx;
  if (!pal || !m || !g || !g.idx || !root.G2Remap || !root.G2Remap['표1'] || !root.G2Native) return null;
  var 보강 = !!(root.G2Remap.표식보강켬 && root.G2Remap.표식보강켬()) && this._눈밭맵(pal);   /* [리마스터 밝은바닥표식] 눈밭 맵에서만 (정본 316) */
  if (this._가시리맵URL && this._가시리맵팔 === pal && this._가시리맵보강 === 보강) return this._가시리맵URL;
  try {
    var self = this, W = g.w, H = g.h, idx = new Int16Array(g.idx.length);
    for (var i = 0; i < idx.length; i++) idx[i] = g.idx[i];
    var 덮인 = {}, 있음 = false;
    root.G2Native.mapObjects(m).forEach(function (o) {
      if (self._원본오브젝트분류(o.blockIndex, o.height) !== 'flat') return;   /* 바닥에 눕혀 그리는 것만 — 화면과 같은 겹침 */
      if (o.height <= TH) return;   /* 바닥에 구운 한 행 눕힘은 바닥 리맵 표식(addMark)이 그대로 덮는다 — 대열에 오른 큰 눕힘만 위층 표식 */
      var fr = o.frame, px = o.x * TW, py = o.y * TH + TH - fr.h;
      for (var yy = 0; yy < fr.h; yy++) { var ry = py + yy; if (ry < 0 || ry >= H) continue;
        for (var xx = 0; xx < fr.w; xx++) { var rx = px + xx; if (rx < 0 || rx >= W) continue;
          var v = fr.idx[yy * fr.w + xx]; if (v >= 0) { idx[ry * W + rx] = v; 덮인[((rx / TW) | 0) + ',' + ((ry / TH) | 0)] = 1; 있음 = true; } } }
    });
    this._눕힘덮인칸 = 덮인; this._눕힘덮인칸맵 = m;
    if (!있음) { this._가시리맵URL = null; this._가시리맵팔 = pal; return null; }
    var palH = root.G2Remap['표1그릴색'](pal, 보강, 보강);   /* 표1(강도 30·보정 9) — 눈밭 맵 보강이면 눈 색만 하늘색 */
    this._가시리맵URL = root.G2Native.frameToCanvas({ w: W, h: H, idx: idx, tr: g.tr }, palH).toDataURL();
    this._가시리맵팔 = pal; this._가시리맵보강 = 보강;
    /* ☠ 주소를 요소마다 쓰면 안 된다 — 아래 _범위리맵바닥 과 같은 함정(맵 한 장 data-URL 수백 KB × 칸 수 · 매 프레임)
     *   2026-10-12 사장님 「이동 영역이 표시되었을 때 너무 느려져」 — addMarkTop 이 cssText 에 통째로 넣고 있었다 ⇒ 스타일 규칙 한 줄 */
    if (typeof document !== 'undefined') {
      var st = document.getElementById('g2-가시리맵-스타일');
      if (!st) { st = document.createElement('style'); st.id = 'g2-가시리맵-스타일';
                 (document.head || document.documentElement).appendChild(st); }
      st.textContent = '.g2-mark-top.g2-가시리맵{' + bgcss(this._가시리맵URL, this._floorW, this._floorH) + 'image-rendering:' + rend() + ';}';
    }
    return this._가시리맵URL;
  } catch (e) { return null; }
};
/** [리마스터] 그 칸이 바닥에 눕혀 그린 오브젝트에 덮였나 — 덮였으면 범위 표식을 위층(addMarkTop · 같은 리맵판)에도 (2026-10-12) */
Renderer.prototype.덮인칸 = function (x, y) {
  if (this._눕힘덮인칸맵 !== this.nmap) { this._가시리맵URL = null; this._가시리맵판(); }
  return !!(this._눕힘덮인칸 && this._눕힘덮인칸[(x | 0) + ',' + (y | 0)]);
};
/** [리마스터 밝은바닥표식] 지금 맵이 눈밭인가 — 바닥 그림 색으로 (remap.js 눈밭인가 · 정본 316) · 팔레트·바닥이 같으면 한 번만 센다
 *   3D 원경(리마스터3D 원경리맵)은 바닥을 모르므로 여기서 root.__눈밭맵 으로 알린다 */
Renderer.prototype._눈밭맵 = function (pal) {
  var g = this._floorIdx;
  if (this._눈밭판 === pal && this._눈밭바닥 === g) return !!this._눈밭;
  this._눈밭판 = pal; this._눈밭바닥 = g;
  this._눈밭 = !!(g && g.idx && root.G2Remap && root.G2Remap.눈밭인가 && root.G2Remap.눈밭인가(pal, g.idx));
  root.__눈밭맵 = this._눈밭;
  return this._눈밭;
};
/** [정본 336] 이동 범위 리맵판을 미리 만들어 둔다 — «이동»을 누르는 순간 만들던 것(바닥 1704×1040 → xBRZ 2배 → PNG 3MB)이
 *   시뮬레이터(애플 칩)에서도 290ms · 오딘·아이패드에서는 «이동 선택 → 잠깐 멈춤 → 하이라이트»로 보였다
 *   (사장님 11-20 「오딘은 올려준 영상보니 링커맨드에서 이동을 선택했을때 잠깐 딜레이가 생기고 이동영역(하이라이트)가 떠」)
 *   ⇒ 맵·팔레트가 바뀐 뒤 1.5초 동안 팔레트가 그대로면(마법 연출처럼 매 장 바뀌는 동안은 미룸) 한 번 만들고 그림 읽기(해독)까지 해 둔다 */
Renderer.prototype._범위미리 = function () {
  var self = this;
  if (typeof setTimeout !== 'function' || typeof document === 'undefined') return;
  if (this._범위미리타이머) clearTimeout(this._범위미리타이머);
  this._범위미리타이머 = setTimeout(function () {
    self._범위미리타이머 = null;
    try {
      var url = self._범위리맵URL || self._범위리맵바닥();
      if (url && typeof Image === 'function' && !(self._범위리맵그림 && self._범위리맵그림._url === url)) {
        var im = new Image(); im._url = url; im.src = url;
        if (im.decode) im.decode()['catch'](function () { });
        self._범위리맵그림 = im;   /* 리마스터3D 표식3D 가 같은 주소면 이 그림을 그대로 쓴다 */
      }
    } catch (e) { }
    /* 범위를 칠할 때 함께 부르는 덮인칸 → 가시 리맵판(맵 전체 그림 · 처음 한 번 337ms 실측)도 — 한꺼번에 하면 그 순간이 멈추니 짬을 두고 */
    setTimeout(function () { try { if (self.덮인칸) self.덮인칸(0, 0); } catch (e2) { } }, 400);
  }, 1500);
};
Renderer.prototype._범위리맵바닥 = function () {
  var pal = this._유닛팔레트();
  if (!pal || !this._floorIdx || !root.G2Remap || !root.G2Remap['표1'] || !root.G2Native) return null;
  var 보강 = !!(root.G2Remap.표식보강켬 && root.G2Remap.표식보강켬()) && this._눈밭맵(pal);   /* [리마스터 밝은바닥표식] 눈밭 맵에서만 (정본 316) */
  if (this._범위리맵URL && this._범위리맵팔 === pal && this._범위리맵보강 === 보강) return this._범위리맵URL;
  try {
    var palH = root.G2Remap['표1그릴색'](pal, 보강, 보강);   /* 목표 1 · 강도 30 · 보정 9 — 눈밭 맵 보강이면 눈 색만 하늘색 */
    palH._기록바탕 = pal._기록바탕 || pal; /* 계측 전용 꼬리표 — 이 팔레트를 만든 원래 팔레트(암전 판정 · 04_도구/우리그리기기록.js · 2026-09-27) */
    this._범위리맵URL = root.G2Native.frameToCanvas(this._floorIdx, palH).toDataURL();
    this._범위리맵팔 = pal; this._범위리맵보강 = 보강;
    /* ☠★★★★★ **주소를 요소마다 쓰면 안 된다** (2026-09-10)
     *   이 data-URL 은 **500KB 안팎**이다. 범위 표시는 `clearMarks() → addMark × 61` 을
     *   **매 프레임** 돌므로, `cssText` 에 넣으면 프레임마다 **30MB** 짜리 문자열을
     *   만든다. ⇒ **스타일 규칙 한 줄**에 넣고 요소는 클래스만 단다. */
    if (typeof document !== 'undefined') {
      var st = document.getElementById('g2-범위리맵-스타일');
      if (!st) { st = document.createElement('style'); st.id = 'g2-범위리맵-스타일';
                 (document.head || document.documentElement).appendChild(st); }
      st.textContent = '.g2-mark.g2-범위리맵{' +
        bgcss(this._범위리맵URL, this._floorW, this._floorH) +
        'image-rendering:' + rend() + ';}';
    }
    return this._범위리맵URL;
  } catch (e) {
    console.warn('[범위리맵] 실패 — 반투명으로 떨어진다:', e && e.message);
    return null;
  }
};
/**
 * ★ **탐색 스킬이 찾은 칸의 음영** — 원본 `0x18E77`~`0x18EAB` (2026-09-24)
 *
 *   > 사장님: 「원작은 해당 커서 내부(아이템이 있는 칸)에 **특이한 음영처리**가 있어야해.」
 *
 *   ```asm
 *   0x18E77  call 0x5ECC7(1)        ; 픽셀 모드 1 = 리맵
 *   0x18E81  call 0x6104A(10)       ; ★ 리맵표 **10번 줄**
 *   0x18EA4  call 0x5EDDE(x,y,x+24,y+16) ; 그 칸 24×16 을 리맵
 *   0x18EAB  call 0x5ECC7(0) · 0x18ED4 call 0x49EEE(선택상자)
 *   ```
 *   ☠★ 리맵표는 **4줄만** 잡힌다(`0x55C59 eax=4` → `0x6102C` 1024B). 10번 줄은 표 **밖**이다.
 *     원본 메모리를 읽으니(js-dos · 3-3A · 표 시작 +0xA00) 그 자리는 바로 뒤에 실린
 *     **`MAGICSPR/SWORD.VSP` 의 1596~1851 바이트**와 256/256 같았다(4~11번 줄 전부 이 파일).
 *     ⇒ 색이 파형(128 둘레)으로 흩어진다 — 그것이 「특이한 음영」이다. 지어낸 표가 아니다.
 *
 * @param {Uint8Array} 줄 256바이트 리맵 줄
 * @returns {string|null} 리맵한 바닥 그림 주소
 */
Renderer.prototype._탐색리맵바닥 = function (줄) {
  var pal = this._유닛팔레트();
  if (!pal || !줄 || !this._floorIdx || !root.G2Native) return null;
  if (this._탐색리맵URL && this._탐색리맵팔 === pal) return this._탐색리맵URL;
  var palH = new Uint8Array(768);
  for (var n = 0; n < 256; n++) {
    var m = 줄[n];
    palH[n * 3] = pal[m * 3]; palH[n * 3 + 1] = pal[m * 3 + 1]; palH[n * 3 + 2] = pal[m * 3 + 2];
  }
  palH._기록바탕 = pal._기록바탕 || pal; /* 계측 전용 꼬리표 — 이 팔레트를 만든 원래 팔레트(암전 판정 · 04_도구/우리그리기기록.js · 2026-09-27) */
  this._탐색리맵URL = root.G2Native.frameToCanvas(this._floorIdx, palH).toDataURL();
  this._탐색리맵팔 = pal;
  if (typeof document !== 'undefined') {
    var st = document.getElementById('g2-탐색리맵-스타일');
    if (!st) { st = document.createElement('style'); st.id = 'g2-탐색리맵-스타일';
               (document.head || document.documentElement).appendChild(st); }
    st.textContent = '.g2-mark.g2-탐색리맵{' +
      bgcss(this._탐색리맵URL, this._floorW, this._floorH) +
      'image-rendering:' + rend() + ';}';
  }
  return this._탐색리맵URL;
};
/** 탐색 음영을 (x,y) 칸에 켠다. 리맵 줄은 SWORD.VSP 에서 한 번만 읽어 둔다. */
Renderer.prototype.탐색음영 = function (x, y) {
  var R = this;
  var 줄 = Renderer._탐색리맵줄;
  var 준비 = 줄 ? Promise.resolve(줄)
    : fetch((typeof root.G2URL === 'function') ? root.G2URL('MAGICSPR/SWORD.VSP') : '/원본/MAGICSPR/SWORD.VSP')
      .then(function (r) { return r.arrayBuffer(); })
      .then(function (b) {
        /* 표 시작 +0xA00 = 파일 1596 (4번 줄 = 파일 60 · 3-3A 원본 메모리 실측) */
        return (Renderer._탐색리맵줄 = new Uint8Array(b).slice(1596, 1596 + 256));
      });
  return 준비.then(function (z) {
    if (z.length !== 256 || !R._탐색리맵바닥(z)) return false;
    R._탐색음영자리 = { x: x | 0, y: y | 0 };
    R._탐색음영붙이기();
    return true;
  }).catch(function (e) { console.warn('[탐색음영] 실패:', e && e.message); return false; });
};
/** 탐색 음영을 끈다 — 원본 `0x18EEF call 0x13F8A` (500틱 뒤 다시 그리기). */
Renderer.prototype.탐색음영끄기 = function () {
  this._탐색음영자리 = null;
  if (this._탐색음영El && this._탐색음영El.parentNode) this._탐색음영El.parentNode.removeChild(this._탐색음영El);
  this._탐색음영El = null;
};
/** clearMarks 가 표식층을 비워도 탐색 음영은 끌 때까지 남긴다. */
Renderer.prototype._탐색음영붙이기 = function () {
  var p = this._탐색음영자리;
  if (!p || !this.markLayer) return;
  var d = this._탐색음영El;
  if (!d) {
    d = this._탐색음영El = document.createElement('div');
    d.className = 'g2-mark g2-탐색리맵';
  }
  d.style.cssText =
    'position:absolute;width:' + TW + 'px;height:' + TH + 'px;' +
    'left:' + (p.x * TW - this.mapW / 2) + 'px;' +
    'top:' + (p.y * TH - this.mapH / 2) + 'px;' +
    'background-position:' + (-(p.x * TW)) + 'px ' + (-(p.y * TH)) + 'px;pointer-events:none;';
  if (d.parentNode !== this.markLayer) this.markLayer.appendChild(d);
};
/** 바닥 격자 — _buildFloor 와 같되 배경이 native floor data-URL.
 *
 *  ★★★ 층(단차)이 켜져 있으면 **칸 단위로 z 를 준다** (2026-08-24).
 *    사용자: 「**벽체쪽은 엄밀히 말하면 좌표가 없고**, 위쪽에 이동할수 있는 높은 면이
 *            **벽체 좌표를 덮고**, 본래 윗부분이 있던 곳은 **성벽 뒤 평지로 갈음**」
 *    → 벽 칸은 지면으로 안 깔고, 그 위 칸들을 **아래로 z칸 밀면서** `translateZ(z)` 로 올린다.
 *      낮은 면 3D y = y1+1+c · 높은 면 = y1+c 라 **빈틈 없이 이어진다**(검산 완료).
 */
/**
 * @param {number} [부분] 몇 번째 조각인가 (0 부터). 없으면 전부 한 번에.
 * @param {number} [총]   몇 조각으로 나누나. 없으면 1.
 *
 * ★★ 나눠 부르는 까닭 — 이 함수 혼자 **188ms** 를 써서, 맵 세우기를 단계로 쪼개도
 *   여기서만 크게 멈췄다 (2026-08-28 · 시나리오 전환). 격자 **행**을 나눈다.
 *   `useNativeMap` 이 `(0,3) (1,3) (2,3)` 으로 세 번 부르면 결과는 한 번에 부른 것과
 *   **완전히 같다** — 같은 행을 같은 순서로 돌기 때문이다.
 *   ★ 캔버스를 지우는 것(`floorLayer.innerHTML = ''`)은 **부르는 쪽**이 첫 조각에서만 한다.
 */
/**
 * ★★★★★ **바닥 그림은 스타일 규칙 하나가 든다** (2026-09-10)
 *
 *   ☠ 전에는 바닥 조각 **12~35개마다** `background-image:url(<585KB data URL>)` 를
 *     **인라인 css 로** 넣었다. 조각 수만큼 곱해져 **7 MB 짜리 문자열**을 만든다.
 *     그래서 `_buildFloorNative` 만 **32 ms**(실측)를 썼고, 팔레트를 갈 때마다 그만큼 더 든다.
 *   ⇒ 그림·크기는 **규칙 한 줄**에 두고, 조각은 **자리와 오려낼 위치**만 준다.
 *     팔레트가 바뀌면 규칙 한 줄만 고치면 된다.
 */
Renderer.prototype._바닥규칙쓰기 = function () {
  if (typeof document === 'undefined' || !this._floorURL) return this;
  var st = document.getElementById('g2-바닥-스타일');
  if (!st) { st = document.createElement('style'); st.id = 'g2-바닥-스타일';
             (document.head || document.documentElement).appendChild(st); }
  st.textContent = '.g2-floor{' + bgcss(this._floorURL, this._floorW, this._floorH) +
                   'image-rendering:' + rend() + ';}';
  return this;
};

/** 팔레트만 바뀔 때 — 바닥 조각마다 자식 캔버스에 바닥 캔버스의 제 부분을 옮긴다(CSS 배경 위를 덮는다 · 2026-09-25 Z-47) */
/** 스케일러가 켜져 있을 때 바닥 조각에 새 팔레트를 얹는다 — 보이는 조각만 곧바로, 나머지는 밀어 둔다 */
Renderer.prototype._바닥확대칠하기 = function (pal) {
  var 판 = 확대판얻기(this, '바닥', this._floorIdx, this._palSaved || this._음영바탕 || pal, this._바닥바탕); if (!판) return this;
  var N = 판.W / 판.lw, ds = this.floorLayer ? this.floorLayer.querySelectorAll('.g2-floor') : [];
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i], a = d._바닥자리; if (!a) continue;
    var c = d._바닥캔버스;
    if (!c) {
      c = d._바닥캔버스 = document.createElement('canvas');
      c.style.cssText = 'position:absolute;left:0;top:0;width:' + a.w + 'px;height:' + a.h + 'px;image-rendering:' + rend() + ';pointer-events:none;';
      d.appendChild(c);
    }
    if (c.width !== Math.round(a.w * N) || c.height !== Math.round(a.h * N)) { c.width = Math.round(a.w * N); c.height = Math.round(a.h * N); d._칠한팔 = null; }
    try { this._칠맡기기(d, 판, pal, c, a.sx, a.sy, a.w, a.h); }
    catch (e칠) { d._칠한팔 = null; try { console.warn('[바닥칠] ' + (e칠 && e칠.message)); } catch (x) {} }   /* 한 조각이 실패해도 나머지는 칠한다 */
  }
  return this;
};
/** 보이면 곧 칠하고, 안 보이면 밀어 둔다 — 같은 팔레트로 이미 칠했으면 건너뛴다 */
Renderer.prototype._칠맡기기 = function (e, 판, pal, c, sx, sy, w, h) {
  /* ☠ 이미 이 팔레트로 칠해져 있어도 밀어 둔 옛 칠(효과 중 흰색 등)은 버려야 한다 — 안 버리면 효과 내내 화면 밖이던 조각이
   *   나중에 화면에 들어올 때 흰색으로 칠해져 네모 하나가 하얗게 남았다 (2026-09-26 사장님 사진 「안지워지는 부분」) */
  if (e._칠한팔 === pal) { e._밀린칠 = null; return; }
  if (창안인가(e)) { 확대판조각칠하기(판, pal, c, sx, sy, w, h); e._칠한팔 = pal; e._밀린칠 = null; return; }
  this._밀어두기(e, { 판: 판, pal: pal, c: c, sx: sx, sy: sy, w: w, h: h });
};
/** 화면 밖 요소의 칠을 밀어 둔다 — m 은 판 칠하기 인자거나 { fn } (그 자리에서 할 일) */
Renderer.prototype._밀어두기 = function (e, m) {
  e._밀린칠 = m;
  (this._칠밀림 || (this._칠밀림 = [])).indexOf(e) < 0 && this._칠밀림.push(e);
  /* ☠ apply 만 믿으면 카메라가 다른 길로 움직일 때 영영 안 칠해진다 — 밀린 것이 있는 동안 매 프레임 본다
   *   (2026-09-25 사장님 「다른거는 시전된 화면 밖의 일부가 바뀌는데」) */
  var self = this;
  if (!this._밀림rAF && typeof requestAnimationFrame === 'function') {
    var 돌기 = function () {
      self._밀림rAF = null;
      if (!self._칠밀림 || !self._칠밀림.length) return;
      try { self._밀린칠하기(); } catch (e밀) {}
      if (self._칠밀림 && self._칠밀림.length) self._밀림rAF = requestAnimationFrame(돌기);
    };
    this._밀림rAF = requestAnimationFrame(돌기);
  }
};
/** apply 마다 — 밀어 둔 조각 가운데 화면에 들어온 것을 칠한다 */
Renderer.prototype._밀린칠하기 = function () {
  var 남 = [];
  for (var i = 0; i < this._칠밀림.length; i++) {
    var e = this._칠밀림[i], m = e._밀린칠;
    if (!m || !e.isConnected) continue;
    if (창안인가(e)) {
      try { if (m.fn) m.fn(); else { 확대판조각칠하기(m.판, m.pal, m.c, m.sx, m.sy, m.w, m.h); e._칠한팔 = m.pal; } }
      catch (e칠) { try { console.warn('[밀린칠] ' + (e칠 && e칠.message)); } catch (x) {} }
      e._밀린칠 = null;
    }
    else 남.push(e);
  }
  this._칠밀림 = 남;
};
Renderer.prototype._바닥캔버스칠하기 = function (cv) {
  if (!cv || !this.floorLayer) return this;
  var lw = (cv.논리w || this._floorW || cv.width), N = cv.width / (lw || 1);
  var ds = this.floorLayer.querySelectorAll('.g2-floor');
  for (var i = 0; i < ds.length; i++) {
    var d = ds[i], a = d._바닥자리; if (!a) continue;
    var c = d._바닥캔버스;
    if (!c) {
      c = d._바닥캔버스 = document.createElement('canvas');
      c.width = Math.round(a.w * N); c.height = Math.round(a.h * N);
      c.style.cssText = 'position:absolute;left:0;top:0;width:' + a.w + 'px;height:' + a.h + 'px;image-rendering:' + rend() + ';pointer-events:none;';
      d.appendChild(c);
    }
    /* 스케일러 배율이 바뀌었으면 캔버스 크기를 맞춘다 — 처음 만들 때 크기로 남아 왼쪽 위만 칠해졌다 */
    if (c.width !== Math.round(a.w * N) || c.height !== Math.round(a.h * N)) { c.width = Math.round(a.w * N); c.height = Math.round(a.h * N); }
    var g = c.getContext('2d'); g.imageSmoothingEnabled = false;
    g.clearRect(0, 0, c.width, c.height);
    /* 원본 사각형은 논리 좌표 — 스케일러 몽키패치가 N 을 곱한다(위 _오브젝트색칠하기 주석) */
    /*   논리 크기를 넘으면 몽키패치가 «실제 좌표»로 보고 안 곱한다 — 맵 끝 조각(1px 겹침)을 논리 크기 안으로 자른다 */
    var lh = (cv.논리h || this._floorH || cv.height), sw = Math.min(a.w, lw - a.sx), sh = Math.min(a.h, lh - a.sy);
    if (sw > 0 && sh > 0) g.drawImage(cv, a.sx, a.sy, sw, sh, 0, 0, Math.round(sw * N), Math.round(sh * N));
  }
  return this;
};

/** 직독 원본 블록으로 지정 범위의 바닥·경계 표시를 구성한다. */
Renderer.prototype._원본바닥짓기 = function (부분, 총) {
  총 = (총 | 0) || 1; 부분 = 부분 | 0;
  var 마지막조각 = (부분 >= 총 - 1);
  var hw = this.mapW / 2, hh = this.mapH / 2, foldPx = (this._foldY || 0) * TH;
  var self = this;
  /* ★★★ 조각을 **z 로 띄운 적이 있나** (2026-08-28).
   *   아래 「바탕 한 장」 블록은 층(단차)이 z 로 떠서 생기는 구멍을 메우려는 것이다.
   *   지금은 첫 루프가 z = 0 만 쓰므로 그 블록이 **첫 루프와 완전히 같은 조각을
   *   한 벌 더 만든다** — 실측으로 `g2-floor` 가 35개가 아니라 **70개**였고,
   *   `_buildFloorNative` 가 시나리오 전환에서 **361ms** 를 썼다.
   *   층이 되살아나 z 를 쓰기 시작하면 이 값이 참이 되어 바탕이 다시 깔린다. */
  /* ★ 나눠 부를 때는 조각마다 새로 시작하면 안 된다 — 인스턴스에 쌓는다. */
  if (부분 === 0) this._floor띄움 = false;
  function 조각(px, py, w, h, sx, sy, z) {
    if (z) self._floor띄움 = true;
    var d = el('div', 'g2-floor', self.floorLayer);
    /* ★ 그림·크기는 `.g2-floor` 규칙이 든다 (`_바닥규칙쓰기`) — 여기서는 자리만 */
    d.style.cssText = 'position:absolute;' +
      'left:' + (px - hw) + 'px;top:' + (py - hh) + 'px;' +
      'width:' + w + 'px;height:' + h + 'px;' +
      (z ? 'transform:translateZ(' + z + 'px);' : '') +
      'background-position:' + (-sx) + 'px ' + (-sy) + 'px;';
    d._바닥자리 = { sx: sx, sy: sy, w: w, h: h };   /* 팔레트만 바뀔 때 캔버스로 이 부분만 옮겨 칠한다 (2026-09-25 Z-47) */
    return d;
  }
    var B = this.TILEBLK, cols = Math.ceil(this.mapW / B), rows = Math.ceil(this.mapH / B);
    /* ★ 이 조각이 맡는 행 범위. `총 === 1` 이면 0..rows 라 예전과 같다. */
    var r0시작 = Math.floor(rows * 부분 / 총), r0끝 = Math.floor(rows * (부분 + 1) / 총);
    for (var r = r0시작; r < r0끝; r++) for (var c = 0; c < cols; c++) {
      var x = c * B, y = r * B, w = Math.min(B, this.mapW - x), h = Math.min(B, this.mapH - y);
      if (y + h <= foldPx) continue;                    // 접는선 위(배경벽 밴드)는 바닥으로 안 그림
      /* ★ 이웃 타일과 1px 겹치게 늘린다 — 확대·3D 변환 시 경계에 생기던 검정 이음새 제거. */
      조각(x, y, w + (c < cols - 1 ? 1 : 0), h + (r < rows - 1 ? 1 : 0), x, y, 0);
    }
  /* ★★★ **바탕 한 장을 z=0 에 먼저 깐다** (2026-08-24 · 사용자 회전 확인으로 잡음).
   *   높은 면을 아래로 밀어 올리면 그 자리(z=0 평면)가 **비어 뚫린다**.
   *   정면에서는 앞의 벽면이 가려 안 보이지만 **돌리면 검은 구멍**이 드러난다.
   *   원본 지면을 그대로 한 장 깔아 두면 구멍이 생길 수가 없다. */
  /* ★ **띄운 조각이 하나도 없으면 건너뛴다** — 위 루프가 이미 z = 0 바탕을 깔았다.
   *   두 번 깔면 같은 그림을 **두 벌** 그리게 되어 전환이 그만큼 느려진다
   *   (2026-08-28 실측: 시나리오 체인에서 650ms 멈춤 중 `_buildFloorNative` 361ms). */
  /* ★ 나눠 부를 때는 **마지막 조각에서만** 깐다 — 안 그러면 조각 수만큼 겹친다. */
  if (this._floor띄움 && 마지막조각) {
    var B0 = this.TILEBLK, c0 = Math.ceil(this.mapW / B0), r0 = Math.ceil(this.mapH / B0);
    for (var rb = 0; rb < r0; rb++) for (var cb = 0; cb < c0; cb++) {
      var bx = cb * B0, by = rb * B0;
      var bw = Math.min(B0, this.mapW - bx), bh2 = Math.min(B0, this.mapH - by);
      if (by + bh2 <= foldPx) continue;
      조각(bx, by, bw + (cb < c0 - 1 ? 1 : 0), bh2 + (rb < r0 - 1 ? 1 : 0), bx, by, 0);
    }
  }
};

/** ★ 층 벽면 — 벽 띠를 **수직 판**으로 세운다 (덩어리의 옆면).
 *  남향판: 원본 지면의 벽돌 띠 그림을 그대로 텍스처로 쓴다.
 *  옆판  : 원본에 옆면 그림이 없으므로 **높은 쪽 지면 한 줄**을 늘려 채운다.
 *    사용자 지적: 「좌우 벽면도 생각해야해. 회전이 없어도 **원근때문에 옆에서 보면
 *                  비스듬하게** 보이게 돼」 */

/** 배경벽 — 접는선(foldY) 위 밴드를 지면+오브젝트 통째로 구워 접는선에 경첩으로 세운다.
 *  transform 은 apply() 가 tilt 에 맞춰 갱신(rotateX(-tilt)). tilt=0 이면 눕어 바닥과 연속(원작 2D). */
Renderer.prototype._배경벽짓기 = function (map) {
  if (this.backdropEl && this.backdropEl.parentNode) this.backdropEl.parentNode.removeChild(this.backdropEl);
  판들버리기(this.backdropEl);            /* 판(그래픽 카드)도 버린다 */
  this.backdropEl = null;
  var foldY = this._foldY || 0;
  if (foldY <= 0) return;
  var cv = this._가로띠합성(map, 0, foldY, true), bH = foldY * TH;
  var e = el('div', 'g2-backdrop', this.world);
  e.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
    'transform-origin:50% 100%;' +                    // 경첩 = 아래끝(접는선)
    'left:' + (-this.mapW / 2) + 'px;top:' + (-this.mapH / 2) + 'px;' +
    'width:' + this.mapW + 'px;height:' + bH + 'px;' +
    bgcss(cv.toDataURL(), cv.논리w || cv.width, cv.논리h || cv.height);
  /* 배경벽은 바닥·스프라이트보다 뒤(먼저) 그려 뒤에 서게 한다. */
  this.world.insertBefore(e, this.world.firstChild);
  e._조각 = cv._조각 || null;
  e._바탕 = { cv: cv, pal: map.palette, 필터: root.G2Scaler ? root.G2Scaler.cur() : 'none' };   /* 팔레트 GPU 판의 바탕 */
  this.backdropEl = e;
  /* 맵을 가린 동안(초필살 검은 화면 · 맵가리기) 다시 지어졌으면 새 벽도 가린다 — 끌 때 맵가리기가 되살린다 */
  if (this._맵가림) { e._옛display = ''; e.style.display = 'none'; }
};
/**
 * ★ 팔레트만 바뀔 때 배경벽을 다시 짓지 않고 색만 칠한다 (2026-09-26 · Z-72)
 *   사장님 「1번 세이브 불러서 2-4에서 스케일러 적용하고 2-4a 시나리오로 넘어가서 사용하면 버벅거려」
 *   실측(2-4A · 57×53 · 접는선 16 · xBRZ 4배): 다시 짓기가 걸음마다 약 180ms(합성 115 + PNG 45)였다.
 *   번호판(_가로띠합성 의 idx)은 그대로이므로 행 오버레이(_행오버레이_다시칠하기)와 같은 길로 칠한다.
 *   칠 캔버스는 배경벽의 **첫 자식**으로 둔다 — 벽 위 애니 칸(tileCell · g2-backdrop-anim)이 그 위에 선다.
 *   배경 그림(backgroundImage)은 그대로 둔다 — 투명 자리가 같고, 미러 준비 검사(remapmirror.js)가 그것을 본다.
 * @returns {boolean} 칠했으면 true — false 면 부르는 쪽이 다시 짓는다
 */
Renderer.prototype._배경벽다시칠하기 = function (pal, 딱지) {
  var e = this.backdropEl;
  if (!e || !e.isConnected || !e._조각) return false;
  var 조각 = e._조각, 바탕 = this._palSaved || this._음영바탕 || pal, lw = this.mapW, lh = (this._foldY || 0) * TH;
  var c;
  if (root.G2Scaler && root.G2Scaler.N() > 1) {
    var 판 = 확대판얻기(e, '벽', 조각, 바탕, e._바탕); if (!판) return false;
    c = e._벽칠캔;
    if (!c || c.width !== 판.W || c.height !== 판.H) { c = e._벽칠캔 = document.createElement('canvas'); c.width = 판.W; c.height = 판.H; e._칠한팔 = null; }
    벽캔버스붙이기(e, c, lw, lh);
    try { this._칠맡기기(e, 판, pal, c, 0, 0, 조각.w, 조각.h); } catch (e칠) { e._칠한팔 = null; try { console.warn('[벽칠] ' + (e칠 && e칠.message)); } catch (x) {} }
    return true;
  }
  /* 스케일러 없음 — 딱지별로 쥔다(음영 켜고 끄기가 공짜) */
  var 캐 = e._칠캐시 || (e._칠캐시 = {});
  var k = (root.G2Scaler ? root.G2Scaler.cur() + '|' : '') + (딱지 == null ? '?' : String(딱지));
  if (!캐[k]) {
    if (Object.keys(캐).length >= 16) 캐 = e._칠캐시 = {};
    캐[k] = root.G2Native.frameToCanvas(조각, pal);
  }
  벽캔버스붙이기(e, 캐[k], lw, lh);
  return true;
};
function 벽캔버스붙이기(e, cv, w, h) {
  if (!e || !cv || e._칠캔버스 === cv) return;
  cv.style.position = 'absolute'; cv.style.left = '0'; cv.style.top = '0';
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  cv.style.imageRendering = rend(); cv.style.pointerEvents = 'none';
  if (e._칠캔버스 && e._칠캔버스.parentNode === e) e.replaceChild(cv, e._칠캔버스); else e.insertBefore(cv, e.firstChild);
  e._칠캔버스 = cv;
}

/* ── `.FPM` 고정 배경 ──────────────────────────────────────────────────
 *
 * 사용자 지적 2026-08-16: 「1-1 맵 상단쪽은 원작에 **fpm 파일을 검정색 뒷쪽에**
 * 깔게 되어있는 것 같아. 이런 맵들이 좀 있던데」.
 *
 * `SCENARIO\` + 맵이름 + `.fpm`(**소문자** — `COMBATII.EXE 0x65A99`)이 있으면
 * **배경벽보다 더 뒤**에 깐다. `480×400` 한 장이고 팔레트도 자기 것을 쓴다
 * (`native.js decodeFPM`).
 *
 * ★ 조건은 **파일이 있으면**이다 — 26개가 전부 같은 이름의 `.MAP` 과 짝이고,
 *   모딩툴 표의 시나리오 매핑(`IM05 → 1-1, 29-0`)도 맵 기준과 맞는다.
 *   ★★★★★ **해소 (2026-08-29)** — 스위치는 없다. **`.MAP` 꼬리가 직접 이름을 준다.**
 *     `native.js mapBackdropTail()`(§1041) 이 파일 끝 **16B 이름 + 2B S** 를 읽고,
 *     `0x108C6 cmp eax,1 / je 0x10922` 로 배경이 없는 맵을 가른다.
 *     배경이 있는 맵 **28개 전부** 실제 `.FPM` 이 있다(빠짐 0 ·
 *     `04_도구/MAP_배경기준줄.js`). `.SCE` 는 관여하지 않는다.
 * ==================================================================== */
Renderer.prototype._원경짓기 = function () {
  var self = this;
  if (this.fpmEl && this.fpmEl.parentNode) this.fpmEl.parentNode.removeChild(this.fpmEl);
  if (this.fpmTopEl && this.fpmTopEl.parentNode) this.fpmTopEl.parentNode.removeChild(this.fpmTopEl);
  if (this._fpm표식층 && this._fpm표식층.parentNode) this._fpm표식층.parentNode.removeChild(this._fpm표식층);
  this.fpmEl = null; this.fpmTopEl = null; this._fpm표식층 = null;
  var scene = (root.G2 && root.G2.scene) || {};
  var mapFile = scene['맵파일'] || '';
  var base = String(mapFile).replace(/\.[Mm][Aa][Pp]$/, '');
  /* ★★★★★ **어느 그림을 까는지는 `.MAP` 이 들고 있다** (2026-08-28)
   *
   *   `COMBATII 0x108CC` 가 `.MAP` 꼬리에서 **이름 16바이트**를 읽어 '.' 에서 자르고
   *   `.fpm` 을 붙인다. 곧 **맵 이름과 그림 이름이 다를 수 있다.**
   *   실제로 다른 것이 6개다 — `SKY07→SKY02` · `SKY08→SKY04` · `SKY09→SKY06` ·
   *   `M07→M06` · `ODS03→ODS3` · `ODS03_1→ODS3-1`.
   *   ✅ **닫힌 이야기** — 한때 「`SKY07~09` 는 자기 `.FPM` 이 없어 무엇을 까는지
   *     모른다」고 적어 두었으나, 위 규칙(맵 꼬리 16 B 이름)으로 **전부 풀렸다.**
   *     배경이 있는 맵 **28 개 전부** 가리키는 `.FPM` 이 실제로 있다
   *     (빠짐 0 · `04_도구/MAP_배경기준줄.js`).
   *
   *   ★ 같은 꼬리의 **뒤 2바이트가 `S`** — 배경이 1/4 로 흐르는 **기준 칸 y** 다
   *     (`0x10913`). `_fpmParallax` 가 쓴다. */
  var 꼬리 = (this.nmap && this.nmap['배경']) || null;
  if (꼬리 && 꼬리['이름']) base = 꼬리['이름'];
  this._fpmS = 꼬리 ? (꼬리.S | 0) : -1;                  /* 0x10922 — 없으면 −1 */
  if (!base || !root.G2Native || !root.G2Native.decodeFPM) return;
  (async function () {
    try {
      /* ★ 한 번 푼 .FPM 은 쥐어 둔다 — 팔레트 걸음마다(팔레트만갈기) 다시 깔 때 가져오기를 안 기다리게.
       *   쥔 것이 있으면 await 를 안 거쳐 이 자리에서 곧바로 깐다(옛 요소를 걷은 뒤 빈 틈이 안 생긴다) */
      var d = (self._fpm캐시 && self._fpm캐시.이름 === base) ? self._fpm캐시.d : null;
      var r = d ? { ok: true } : await self._가져오기(G2URL('SCENARIO/' + base + '.FPM'));
      if (d) { /* 쥔 것 */ }
      else if (r.ok) {
        d = root.G2Native.decodeFPM(new Uint8Array(await r.arrayBuffer()));
        self._fpm캐시 = { 이름: base, d: d };
      } else {
        /* ★★★ **`.FPM` 이 없으면 배경을 깔지 않는다** (2026-08-16 · 사용자 지정
         *   「일단 해당 맵 배경 빼」)
         *
         *   ★★★★★ **2026-08-28 — 닫혔다.** `SKY07~09` 는 **맵 꼬리가 다른 이름을
         *     가리키고 있었다**(`SKY07→SKY02` · `SKY08→SKY04` · `SKY09→SKY06`).
         *     위의 `this.nmap['배경']` 이 그 이름을 쓰므로 여기로 오지 않는다.
         *     배경이 있는 맵 28개 전부 가리키는 `.FPM` 이 실제로 있다(빠짐 0).
         *
         *   ★ 헛짚은 기록 — 두 갈래를 다 넣어 봤고 둘 다 아니었다.
         *     ① `CHAPDATA/SKY<N>.XCP` — 이름만 보고 세운 규칙. `COMBATII.EXE` 에
         *        `xcp`·`chapdata` 문자열이 **아예 없다**(있는 건 `fpm` VA `0x75aa3`).
         *        전투 모듈은 `.XCP` 를 열지 않는다.
         *     ② `AST.FPM` — 사용자 제보로 넣었지만 화면에서 「저거 아니야」.
         *
         *   ★ 다음에 볼 것: `04_도구/le_fixup.js` 의 레코드 파싱을 고쳐
         *     (지금 형별 분포가 0~15 에 고르게 퍼진다 = 어긋남) `fpm` 문자열
         *     참조를 뜨고, 파일명을 어떻게 만드는지·없을 때 무엇을 하는지 본다. */
        return;
      }
      if (!d) return;
      /* ★★★★★ **배경도 날씨를 탄다** — 원본 `0x1077A` 는 팔레트 256색 전부를
       *   DAC 에 쓴다 (2026-09-10 · 사장님 「더 꼼꼼히 찾아봐」).
       *   ☠ `.FPM` 은 **자기 팔레트**를 들고 오는데, 우리는 그것을 날씨 보정 없이
       *     그대로 구웠다. 실측(1-1 눈) — 하늘·산이 (227,243,227) 로 떴다.
       *     원본은 (178,195,178) 이다. */
      var _fpmPal = (root.G2Native.전투팔레트 ? root.G2Native.전투팔레트(d.palette) : d.palette);
      /* ★★★★★ **연출 팔레트도 배경이 받는다** (2026-09-26 사장님 「산 하늘은 한번 더 확인이 필요해」)
       *   원본 0x1077A 가 .FPM 팔레트를 DAC 에 그대로 쓰므로 배경과 맵은 **같은 DAC** 를 쓴다
       *   (실측 1-1 IM05 — 쓰는 84색이 전투팔레트 뒤 맵 팔레트와 한 색도 안 다르다). 그래서 DAC 섞기(0x30824)와
       *   화면 리맵(0x454D5 · 화면 버퍼를 통째로)이 배경에도 걸린다. 연출 중(_palSaved)이면 지금 화면 팔레트로 칠한다.
       *   ☠ 전에는 늘 제 팔레트로만 구워 암전 때 산·하늘만 밝게 남았다 */
      if (self._palSaved && self._palette && self._palette.length >= 768) _fpmPal = self._palette;
      /* ★★★★★ **같은 팔레트로 구운 원경은 쥐어 두고 다시 안 굽는다** (2026-11-13 · 사장님 11-12 「칼스 초필살기(천지파열무) 끝날때 갑자기 심하게 버벅」
       *   「배경이 원경인 부분(마지막 베라모드와 전투)에서만」)
       *   팔레트 걸음(팔레트만갈기)마다 여기로 와 .FPM → 캔버스(스케일러 xBRZ) → 검은 열 재기 → 거울 → toDataURL → 리맵 벌 또 toDataURL 을
       *   통째로 다시 했다. 헤드리스 계측(43-4B ODS3 · xbrz4): 원경 짓기 240ms · 팔레트 걸음 413ms · 끝 복원 363ms — 천지파열무 꼬리는
       *   9틱마다 섞고(0x34B13) 끝에 되돌린다(0x5F9AE) → 원경 맵에서만 끝이 멈칫했다.
       *   ⇒ 열쇠 = 배경 이름 | 팔레트(FNV) | 스케일러 | 맵 크기 | 접는선. 히트면 그림 css·치수를 그대로 쓴다(복원 = 처음 구운 열쇠 → 즉시).
       *   원작 동작(배경도 DAC 섞기를 받는다)은 그대로다 — 굽는 횟수만 준다. */
      var foldPx = Math.max(0, Math.min(self.mapH, (self._foldY || 0) * TH));
      var 팔해 = 0x811C9DC5 | 0; for (var ph = 0; ph < _fpmPal.length; ph++) 팔해 = Math.imul(팔해 ^ _fpmPal[ph], 0x01000193);
      var 원경키 = base + '|' + (팔해 >>> 0).toString(36) + '|' + (root.G2Scaler && root.G2Scaler.cur ? root.G2Scaler.cur() : '') +
                   '|' + self.mapW + 'x' + self.mapH + '|' + foldPx;
      self._원경캐시 = self._원경캐시 || {};
      var 캐 = self._원경캐시[원경키] || null;
      var 원W, 원H, 왼잘, 오잘, 내용W, 그림css;
      if (캐) {
        원H = 캐.원H; 왼잘 = 캐.왼잘; 내용W = 캐.내용W; 그림css = 캐.그림css;
        self._fpmW = 캐.fpmW; self._fpmH = 캐.fpmH; self._fpm왼잘 = 왼잘; self._fpmFoldPx = foldPx;
      } else {
      var cv = root.G2Native.frameToCanvas(
        { w: d.w, h: d.h, idx: d.idx, tr: (d.tr == null ? null : d.tr) }, _fpmPal);
      /* ★★★ **배경은 「배경벽 뒤」에 깐다** (2026-08-16)
       *
       *   사용자가 처음부터 그렇게 말했다 — 「1-1 맵 상단쪽 같은 경우 원작에
       *   fpm 파일을 **검정색 뒷쪽에 깔게** 되어 있는 것 같아」. 그 「검정색」이
       *   바로 **배경벽**(`g2-backdrop`)이다. 접는선(`_foldY`) 위쪽 맵을 세워
       *   놓은 판이고, 하늘이어야 할 자리가 검게 비어 있다.
       *
       *   그래서 배경은 **배경벽과 똑같은 자리·크기·변환**으로, 그보다 **뒤에**
       *   놓는다. 그러면 벽의 빈 곳으로 하늘이 비친다.
       *   (`backdrop` 은 `left:-mapW/2 · top:-mapH/2 · mapW×mapH`,
       *    `transform-origin:50% 100%` 로 경첩을 아래에 두고 `rotateX(−tilt)` 로 선다.
       *    `apply()` 에서 배경도 **같은 변환**을 받는다.)
       *
       *   ★ 헛짚은 기록 — 여기까지 **세 번** 틀렸다.
       *     ① `host`(화면)에 붙여 화면 전체를 덮음 → 「맵 밖으로 나오잖아」
       *     ② `world` 안에 맵 크기(바닥 자리)로 깖 → 바닥에만 깔려 위쪽은 검정,
       *        게다가 `cover` 로 3.2 배 늘려 뭉갬 → 「위치 안 맞아」
       *     ③ 이제 배경벽 자리로. **사용자가 첫 지적에서 이미 「검정색 뒷쪽」이라고
       *        말했는데** 그 말을 안 따라간 것이 세 번 헤맨 이유다.
       *
       *   ★ 크기 — `AST.FPM` 480×400 · 벽 1536×384. **세로가 거의 같다(400 ≈ 384).**
       *     세로를 벽 높이에 맞추고 가로는 비율대로 두고 반복시킨다. `cover` 로
       *     늘리면 가로가 3.2 배가 되어 뭉개진다(② 에서 실제로 그랬다).
       *     ☐ **가로가 정말 반복인지 아직 코드로 못 봤다.**
       *       2026-08-29 — 여기까지 팠다:
       *       · `.FPM` 문자열은 **어느 EXE 에도 없다**(대문자 전수 0곳).
       *         소문자 `fpm` 이 `COMBATII` 에 **한 곳**뿐이고 바로 앞이 `SCENARIO\` 다
       *         — 곧 **경로와 확장자를 조립해서 연다**.
       *       ★ `04_도구/le_fixup.js` 로 **fixup 적용본에서 열린다**(주소가 다르다):
       *         `SCENARIO\` = **`0x75A99`** · `fpm` = **`0x75AA3`**
       *         쓰는 자리 — `SCENARIO\` 는 `0x10512`·`0x105BD`, `fpm` 은 **`0x108EF`**.
       *         ```asm
       *         0x108E6  cmp bh, 0x2E('.') · jne …   ; 이름에서 점을 찾아
       *         0x108EE  mov edx, 0x5AA3             ; (fixup 후 0x75AA3 = "fpm")
       *         0x108FB  call 0x61C88                ; ★ **확장자를 fpm 으로 바꾼다**
       *         ```
       *       ☠ 옛 메모의 「`le_fixup.js` 파싱을 고쳐야 뜬다」는 **이미 해결돼 있었다.**
       *         헷갈린 원인은 `EXE_주소참조찾기.js` 가 **파일 오프셋**을 주는데
       *         파일은 fixup 적용 전이라 그 자리를 그대로 읽으면 값이 안 맞는 것이다.
       *       ☐ 다만 **가로 반복은 그리기 쪽**이라 여기서는 아직 안 나온다.
       *         다음에 볼 곳은 `0x10500`(ebx=2 로 부른다) 이후다. 값을 지어내지 않는다.** */
      /* ★★★ **접는선이 있으면 배경을 두 조각으로 나눈다** (2026-08-24 · 계획 §4)
       *
       *   사용자 확정 2026-08-23: 「**배경은 함께 세워야해.(세워도 해당 배경이
       *   더 뒤에 있도록)**」
       *
       *   `foldY > 0` 이면 접는선 위 밴드가 **배경벽으로 서는데**, 그 자리에
       *   FPM 도 눕은 채 깔려 있어 **같은 그림이 두 번** 보인다. 요소 하나로는
       *   「위만 세우고 아래만 눕히기」가 안 되므로 **DOM 요소를 둘로 나눈다.**
       *
       *   | 조각 | 어디에 | 변환 | 그림의 어느 부분 |
       *   |---|---|---|---|
       *   | 윗조각 `fpmTopEl` | `world` — `backdropEl` **바로 앞** | `rotateX(−tilt)` — 배경벽과 **완전 동평면** | 위 `foldPx` |
       *   | 아랫조각 `fpmEl`  | `groundLayer` 맨 앞 (지금 그대로) | `none` (눕힘) | 아래 나머지 |
       *
       *   ★ **동평면이어야 하는 까닭** — `world` 는 `preserve-3d` 라 **깊이가
       *     조금이라도 다르면 DOM 순서로 못 이긴다**(`연출_원소2단계_원본확정.md`).
       *     같은 `left`·`width`·같은 `transform-origin:50% 100%`·같은 회전을 주고
       *     DOM 에서 **앞**에 넣어야 배경벽 **뒤**에 그려진다.
       *
       *   ★ **이음새** — 두 조각 다 `background-size:auto mapH` 로 **같은 배율**이고,
       *     윗조각은 `top` 정렬(그림 `0..foldPx`) · 아랫조각은 `bottom` 정렬
       *     (그림 `foldPx..mapH`) 이라 정확히 이어진다. 가로도 폭이 `mapW` 로 같아
       *     `center` + `repeat-x` 의 위상이 어긋나지 않는다. */
      var foldPx = Math.max(0, Math.min(self.mapH, (self._foldY || 0) * TH));
      self._fpmFoldPx = foldPx;      /* 아랫조각의 요소 원점 = 맵 y foldPx */
      /* ★★★★★ **배경은 원래 크기로 깐다 — 맵 높이로 늘이면 안 된다** (2026-08-28)
       *
       *   원본 `0x10BCA~0x10BD7` 은 고른 줄 번호에 **× 480**(`.FPM` 한 줄)을 곱해
       *   그 줄부터 화면으로 **1:1** 로 보낸다. 늘이거나 줄이는 코드가 없다.
       *   ⇒ `.FPM` 480×400 은 논리 픽셀 그대로다. 맵 1칸(16 px)과 화면 1 px 이
       *     같은 단위이므로 `background-size` 도 **그림 크기 그대로**가 맞다.
       *
       *   ☠ 전에는 `auto mapH`(1-1 은 **992**)로 늘였다 — 산이 2.5배로 커졌다. */
      self._fpmW = d.w | 0; self._fpmH = d.h | 0;         /* 480 × 400 */
      /* ★★★ **거울로 이어 붙인다** (2026-10-04 · 사장님 「1-1의 경우 원경에 해당하는 배경맵이 좌우로 반복되어 그려지는데
       *   배율 변경시 그림이 연결되지 않아서 많이 어색해.」 · 선택 「거울로 이어 붙이기」)
       *   `.FPM` 은 좌우 끝이 이어지게 그려진 그림이 아니다(IM05 이음 줄 색차 95.5 · 보통 이웃 줄 11.6~17.2).
       *   원본은 화면 320 폭이라 그림 안쪽만 보여 이음이 안 나오지만, 배율을 낮춰 넓어지면 반복 이음이 드러난다.
       *   [그림 | 좌우 뒤집은 그림] 한 벌(2w)을 반복하면 어느 이음이든 같은 줄끼리 맞닿는다.
       *   원래 그림은 한 벌의 왼쪽 0..w 그대로라 _원경시차반영 의 위치 식(0x10B3A)과 원작 배율 화면은 안 바뀐다. */
      /* ★★ **끝이 통째로 검은 열은 빼고 잇는다** (2026-10-08 · 사장님 「7-6도 맵 뒤에 배경이 이상하게 연결되는 문제가 있어 1-1처럼 해결해야해」)
       *   7-6 의 `.FPM` 은 왼쪽 끝 6열이 위아래 전부 검정이라, 거울 이음마다 12열짜리 검은 띠가 생겼다(1-1 IM05 는 끝 열이 검지 않다).
       *   끝의 «통째 검은 열»을 잘라 [내용 | 뒤집은 내용] 으로 잇고, 잘라 낸 만큼 _원경시차반영 이 위치를 밀어
       *   원래 그림의 열은 제자리에 둔다 — 달라지는 것은 그 검은 열 자리(맨 왼쪽 몇 px)에 이웃 그림이 보이는 것뿐이다. */
      /* ☠ cv 는 스케일러를 거쳐 논리 크기(d.w)의 k 배일 수 있다 — 픽셀은 cv 크기로 재고 논리 px 로 바꾼다 */
      var 원W = d.w | 0, 원H = d.h | 0, 왼잘 = 0, 오잘 = 0;
      var cW = cv.width | 0, cH = cv.height | 0, k배 = (원W > 0 && cW > 0) ? cW / 원W : 1;
      try {
        var 픽 = cv.getContext('2d').getImageData(0, 0, cW, cH).data;
        var 검은열 = function (x) {
          /* 60 — SKY05 왼쪽 11열은 순검정이 아닌 한 가지 어두운 색(합 52)이라 «> 0» 을 빠져나가 거울 이음마다 검은 기둥이 섰다
           *   (사장님 11-09 「공중전용 맵 원경에 검정색 선이 있어서 이거 처리해야해.」 · 3D 원경자르기 도 같은 기준) */
          for (var yy = 0; yy < cH; yy++) { var q = (yy * cW + x) * 4; if (픽[q + 3] && (픽[q] + 픽[q + 1] + 픽[q + 2]) > 60) return false; }
          return true;
        };
        var 왼p = 0, 오p = 0;
        while (왼p < cW / 4 && 검은열(왼p)) 왼p++;
        while (오p < cW / 4 && 검은열(cW - 1 - 오p)) 오p++;
        /* 검은 끝 열을 잘랐으면 바로 옆 «번짐 열» 하나(75% 이상 어두움)도 — SKY05 12번째 열(80%)이 거울 이음에 2px 줄로 남았다 (11-09 · 3D 원경자르기 와 같은 규칙)
         *   끝 열이 안 잘린 그림(우주 SPACE·ODS3 처럼 검정이 곧 그림)은 안 건드린다 · 픽셀은 cv 크기(k배)라 논리 한 열 = k배 픽셀 열 */
        /* ☆ 정정(11-09) — 번짐은 한 열이 아니었다: SKY05 은 검은 12열 뒤 열 밝기 272·417(보통 540) — 한 열만 자르니 이음에 가는 사선이 남았다.
         *   ⇒ 안쪽 보통 열(6열 안) 밝기의 90% 가 될 때까지(최대 4열) 자른다 · 3D 원경자르기(지정보기.html)와 같은 규칙 */
        var 평밝 = function (x) { var t = 0; for (var yy = 0; yy < cH; yy++) { var q = (yy * cW + x) * 4; if (픽[q + 3]) t += 픽[q] + 픽[q + 1] + 픽[q + 2]; } return t / cH; };
        var 열k = Math.max(1, Math.round(k배));
        if (왼p > 0) { var 왼기준 = 평밝(Math.min(cW - 1, 왼p + 6 * 열k)), 왼끝 = 왼p + 4 * 열k; while (왼p < 왼끝 && 평밝(왼p) < 왼기준 * 0.9) 왼p++; }
        if (오p > 0) { var 오기준 = 평밝(Math.max(0, cW - 1 - 오p - 6 * 열k)), 오끝 = 오p + 4 * 열k; while (오p < 오끝 && 평밝(cW - 1 - 오p) < 오기준 * 0.9) 오p++; }
        왼잘 = Math.floor(왼p / k배); 오잘 = Math.floor(오p / k배);    /* 논리 열 단위 — 반쯤 걸친 열은 남긴다 */
      } catch (e잘) { 왼잘 = 0; 오잘 = 0; }
      var 내용W = 원W - 왼잘 - 오잘;
      self._fpm왼잘 = 왼잘;
      var sx = Math.round(왼잘 * k배), sW = Math.round(내용W * k배);
      var 거울 = document.createElement('canvas');
      거울.width = sW * 2; 거울.height = cH;
      var 거울g = 거울.getContext('2d');
      거울g.drawImage(cv, sx, 0, sW, cH, 0, 0, sW, cH);
      거울g.save(); 거울g.translate(sW * 2, 0); 거울g.scale(-1, 1); 거울g.drawImage(cv, sx, 0, sW, cH, 0, 0, sW, cH); 거울g.restore();
      그림css = 'background-image:url(' + 거울.toDataURL() + ');' +
        'background-repeat:repeat-x;background-size:' +
        (내용W * 2) + 'px ' + 원H + 'px;';
      /* 쥐어 둔다 — 8벌까지(연출 한 번에 섞인 팔레트 몇 벌 + 원래 팔레트) · 넘치면 통째로 비운다 */
      if (Object.keys(self._원경캐시).length >= 8) self._원경캐시 = {};
      캐 = self._원경캐시[원경키] = { 그림css: 그림css, 내용W: 내용W, 원H: 원H, 왼잘: 왼잘, fpmW: self._fpmW, fpmH: self._fpmH, 리맵: null };
      }   /* if (!캐) 끝 */
      var 공통css = 'position:absolute;transform-origin:50% 100%;' +
        'left:' + (-self.mapW / 2) + 'px;width:' + self.mapW + 'px;' +
        'image-rendering:' + rend() + ';pointer-events:none;';

      /* ── 윗조각 — 배경벽과 **함께 선다**(단 배경벽보다 뒤) ───────────── */
      if (foldPx > 0 && self.world) {
        var 윗e = el('div', 'g2-fpm-top', null);
        윗e.style.cssText = 공통css +
          'top:' + (-self.mapH / 2) + 'px;height:' + foldPx + 'px;' + 그림css +
          'background-position:center top;' +
          'transform:rotateX(' + (-(self.cam ? self.cam.tilt : 0)) + 'deg);';
        /* 배경벽보다 **먼저** 그려져야 뒤에 선다 */
        self.world.insertBefore(윗e, self.backdropEl || self.world.firstChild);
        self.fpmTopEl = 윗e;
      }

      /* ── 아랫조각 — 맵과 **함께 눕는다** ──────────────────────────── */
      /* ★★★ **`world` 안에, 맵과 함께 눕힌다** (2026-08-17 · 사용자 지정)
       *
       *   사용자: 「배경합성맵에 **배경이 위로 올라왔어**」 →
       *          「**독립레이어로 하면 안돼. 안에 넣고 한번에 눕혀야해.**」 →
       *          「정확히는 **맵 바깥으로 배경이 삐져나오면 안된다**는 소리야.」
       *
       *   배경에 `rotateX(−tilt)` 를 따로 걸어 **세우면** 그 판이 맵 평면 위로
       *   솟아 **맵 바깥까지 뻗는다.** 독립 레이어로 빼면 더 심하다 —
       *   화면 전체로 퍼진다.
       *
       *   그래서 **자체 회전을 걸지 않는다.** 부모의 변환만 받으면 맵 평면에
       *   그대로 눕고, 크기가 `mapW×mapH` 라 **맵 사각형과 정확히 겹친다.**
       *
       *   ★ 자리는 **`groundLayer` 의 맨 앞** — 「**배경이 맵 아래로 들어가야지**」.
       *     지면(`floorLayer`)도 `groundLayer` 안이므로, 여기 넣어야 지면보다
       *     아래로 간다. `world` 안에 넣으면(지면은 `world` **밖**이라)
       *     오히려 지면 위로 올라온다.
       *     눕혀 놨으니 지면과 같은 z=0 평면이고, 같은 평면끼리는 **DOM 순서**가
       *     결정한다 — 맨 앞 = 제일 아래.
       *   맵 타일이 없는 칸(인덱스 0 투명)으로 배경이 비친다. */
      if (foldPx < self.mapH) {
        var e = el('div', 'g2-fpm', null);
        e.style.cssText = 공통css +
          'top:' + (-self.mapH / 2 + foldPx) + 'px;' +
          'height:' + (self.mapH - foldPx) + 'px;' + 그림css +
          'background-position:center bottom;';
        var 담을곳 = self.groundLayer || self.world;
        if (담을곳) { 담을곳.insertBefore(e, 담을곳.firstChild); self.fpmEl = e; }
        /* [리마스터] **범위 표식이 원경에도 걸린다** (2026-11-09 사장님 「공중전 맵에서 이동 영역 하이라이트가 표시되지 않아」·「이동, 배치 하이라이트도 안나오고」)
         *   원본 0x10130 은 화면 버퍼의 칸 24×16 픽셀을 LUT 로 바꾼다 — 바닥이 비어 원경이 비치는 칸이면 원경 구름이 밝아진다.
         *   우리 addMark 는 바닥 그림만 리맵해 얹으므로, 바닥이 63% 투명한 하늘 맵(SKY05)에서는 칸이 거의 안 보였다.
         *   ⇒ 원경도 같은 표(G2Remap 표1 · 강도 30 · 보정 9)로 한 벌 더 굽고, 원경 바로 위·바닥 아래 층에 칸 조각을 깐다.
         *     시차는 _원경시차반영 이 --fpx/--fpy 로 넘긴다 (원경과 같은 background-position). */
        try {
          /* ★ 리맵 벌도 열쇠로 쥔다 — 연출 중(_palSaved · 섞인 팔레트)에는 표식이 없으니 굽지 않는다(2026-11-13 · 위 원경 캐시 주석). */
          var 리맵css = (캐 && 캐.리맵) ? 캐.리맵 : null;
          if (!리맵css && !self._palSaved && root.G2Remap && root.G2Remap['표1'] && _fpmPal && _fpmPal.length >= 768) {
            var palR = root.G2Remap['표1그릴색'](_fpmPal, !!(root.G2Remap.표식보강켬 && root.G2Remap.표식보강켬()), !!root.__눈밭맵);   /* [리마스터 밝은바닥표식] 눈밭 맵에서만 (정본 316) */
            var cvR = root.G2Native.frameToCanvas({ w: d.w, h: d.h, idx: d.idx, tr: (d.tr == null ? null : d.tr) }, palR);
            var cWR = cvR.width | 0, cHR = cvR.height | 0, kR = (self._fpmW > 0 && cWR > 0) ? cWR / self._fpmW : 1;
            var sxR = Math.round(왼잘 * kR), sWR = Math.round(내용W * kR);
            var 거울R = document.createElement('canvas');
            거울R.width = sWR * 2; 거울R.height = cHR;
            var gR = 거울R.getContext('2d');
            gR.drawImage(cvR, sxR, 0, sWR, cHR, 0, 0, sWR, cHR);
            gR.save(); gR.translate(sWR * 2, 0); gR.scale(-1, 1); gR.drawImage(cvR, sxR, 0, sWR, cHR, 0, 0, sWR, cHR); gR.restore();
            리맵css = '.g2-fpm리맵{background-image:url(' + 거울R.toDataURL() + ');background-repeat:repeat-x;background-size:' +
              (내용W * 2) + 'px ' + 원H + 'px;image-rendering:' + rend() + ';position:absolute;pointer-events:none;}';
            if (캐) 캐.리맵 = 리맵css;
          }
          if (리맵css) {
            var stR = document.getElementById('g2-원경리맵-스타일');
            if (!stR) { stR = document.createElement('style'); stR.id = 'g2-원경리맵-스타일'; (document.head || document.documentElement).appendChild(stR); }
            stR.textContent = 리맵css;
            var 층 = el('div', 'g2-fpm-marks', null);
            층.style.cssText = 'position:absolute;pointer-events:none;left:' + (-self.mapW / 2) + 'px;width:' + self.mapW + 'px;' +
              'top:' + (-self.mapH / 2 + foldPx) + 'px;height:' + (self.mapH - foldPx) + 'px;';
            담을곳.insertBefore(층, e.nextSibling);
            self._fpm표식층 = 층;
            if (self._원경시차반영) self._원경시차반영();
            /* ★ 이미 찍힌 표식에 조각을 얹는다 — 스케일러를 켜면 원경 리맵(xBRZ)이 늦게 구워져 이 층이 배치·이동 표식보다 «뒤에» 생기고,
             *   addMark 는 그때 층이 없어 조각을 못 얹었다 → 하늘 맵에선 표식이 안 보였다
             *   (사장님 11-10 「공중전에 배치 하이라이트 안나와」 · 헤드리스 41-3A: 스케일러 없음 → 보임 / xbrz2 → 29개 있는데 조각 0 · 안 보임) */
            try { self._fpm표식조각다시(); } catch (e조) {}
          }
        } catch (e리) { self._fpm표식층 = null; }
      }
      console.log('[배경] ' + base + ' — ' + d.w + 'x' + d.h +
        (foldPx > 0 ? ' · 접는선 ' + self._foldY + '행(' + foldPx + 'px) 위는 세움' : '') + ' 깔았다');
    } catch (err) { /* 없으면 그만 */ }
  })();
};
/** FR08 나무 묶기는 원본 `.MAP` 를 읽은 이 renderer의 map 객체에만 허용한다.
 *  `useNativeMap()` 은 SCE 맵 교체에도 쓰이므로 파일 이름만 남겨 두면 다른 맵을 오인한다. */
Renderer.prototype._FR08나무맵기억 = function (map, base) {
  var 이름 = String(base || '').toUpperCase();
  /* ★ 2026-10-02 — 그 밖의 맵도 자동 나무 틀(나무자동틀)로 묶으므로 원본 맵이면 늘 기억한다 */
  this._fr08TreeMapObject = map || null;
  this._fr08TreeMapName = 이름 || null;
};

/* ★ FR08 과 같은 나무를 쓰는 맵 일곱 — 같은 방식(5×2 조각 한 그루)으로 묶는다
 *   (2026-09-30 사장님 「8개 맵 전부 같은 방식으로 묶어서 적용해줘」 · 문서 `맵_오브젝트_덩어리묶기.md`)
 *   팔레트가 달라 블록 열쇠(색 포함)는 FR08 과 안 맞는다 ⇒ 조각의 «윤곽»(투명/불투명 칸)으로 나무 안 자리를 안다.
 *   윤곽 열쇠 40개 = FR08 표본 (3,16)·(8,16)·(13,16)·(6,18) 의 5×2 조각에서 `나무윤곽열쇠` 로 뽑은 값 — 40개 모두 서로 다르다.
 *   맵별 [묶음, 조각] = 원본 `.MAP`(native.js)으로 같은 규칙을 돌려 센 값 · 자리 충돌 0 · 눕힘 조각 0 · 접는선 위 0.
 *   하나라도 어긋나면 FR08 처럼 아무것도 안 묶는다(예전 그대로). FR08 은 표본 자리 방식 그대로 둔다. */
var 나무윤곽틀 = {
  '8fc4fa5e': [0, 0, 0], '615d007d': [0, 1, 0], '64cf6e74': [0, 2, 0], '68e455e4': [0, 3, 0], 'eae76102': [0, 4, 0],
  '83c005e': [0, 0, 1], 'd0fc4a38': [0, 1, 1], 'ee81ab29': [0, 2, 1], 'bf13d8cd': [0, 3, 1], 'ba1f137c': [0, 4, 1],
  '8bb5d515': [1, 0, 0], 'ef6637d1': [1, 1, 0], '1544cb9b': [1, 2, 0], 'a5f13fa1': [1, 3, 0], '91c6ea9c': [1, 4, 0],
  '3d6deb1c': [1, 0, 1], 'e259e2a1': [1, 1, 1], '489e722c': [1, 2, 1], 'a475dc78': [1, 3, 1], 'edd86b2f': [1, 4, 1],
  '5b2f509d': [2, 0, 0], '21af1ac': [2, 1, 0], 'a30f6eb7': [2, 2, 0], 'b6129fbe': [2, 3, 0], '22244acb': [2, 4, 0],
  '16c1b686': [2, 0, 1], '9c00e10c': [2, 1, 1], '56a01357': [2, 2, 1], '3e15d02d': [2, 3, 1], '6b06274b': [2, 4, 1],
  '6f5dccc8': [3, 0, 0], '7237c475': [3, 1, 0], '4e7886f5': [3, 2, 0], 'e65dbc5d': [3, 3, 0], 'c211cea4': [3, 4, 0],
  '438a60af': [3, 0, 1], '7c115559': [3, 1, 1], '5fbe6c19': [3, 2, 1], '60a922ba': [3, 3, 1], 'fde71335': [3, 4, 1]
};
var 나무윤곽맵수 = {
  FR02: [32, 305], FR03: [53, 488], FR06: [73, 588], FR07: [85, 705],
  FR09: [46, 352], FR10: [90, 726], SEAL02: [28, 233]
};
/* ★★★ 자동 나무 틀 — FR08 계열 여덟 맵 밖의 «두 줄 이상» 나무 (2026-10-02 사장님 「나무 자동 묶기 진행해줘」 · 범위 「나무만 자동으로」)
 *   도구 `04_도구/나무틀_찾기.js` 가 전투 맵 256 원본 .MAP 에서 윤곽 열쇠로 «늘 같은 자리에 붙어 나오는» 틀 155 를 스스로 찾고,
 *   그림을 보고 나무만 37 틀을 골라(--틀) 줄로 갈린 짝을 이은 뒤(한쪽이 90 % 이상 함께 나옴) 두 줄 이상인 10 틀만 남겼다.
 *   한 줄 나무는 지금도 같은 줄 연속 조각이 한 판으로 서므로 묶지 않는다. 문서: 맵_오브젝트_덩어리묶기.md §11
 *   [틀번호, 칸x, 칸y] · 틀 크기 = 나무자동틀크기[틀번호] (폭칸, 높칸) */
var 나무자동틀크기 = [[5, 3], [5, 3], [4, 4], [4, 5], [4, 3], [6, 3], [4, 2], [4, 3], [4, 2], [6, 2]];
var 나무자동틀 = {
  '28420702': [0, 0, 1], '33931193': [0, 3, 1], '55670689': [9, 5, 0], '28d594ac': [0, 0, 0], 'b4bdb956': [0, 1, 0],
  'd8d18d96': [0, 2, 0], '8d11b24c': [0, 3, 0], '1b135564': [0, 1, 1], '493bad0': [0, 0, 2], '5b920041': [0, 2, 1],
  'fe68242d': [0, 1, 2], '56b2de98': [0, 2, 2], '12c0c4c0': [0, 4, 1], 'a0cf576b': [0, 3, 2], 'b9aa464b': [0, 4, 2],
  '9e877421': [1, 0, 0], '8efebce3': [1, 1, 0], '1a075efd': [1, 2, 0], '68d0a39f': [1, 3, 0], '7b5d6155': [1, 4, 0],
  '7a1b4421': [1, 0, 2], 'f0c79b2e': [1, 1, 2], 'fd240b4d': [1, 2, 2], '70cb0a6f': [1, 3, 2], 'd52e41b5': [1, 4, 2],
  '2e4c78f2': [2, 0, 3], '5407aa72': [2, 1, 3], '69413e5e': [2, 2, 3], '38add16b': [2, 2, 0], '65c05bea': [2, 3, 0],
  '6fddcb3': [2, 1, 0], '34dce38': [2, 0, 0], '3e840c6b': [3, 0, 0], '209578f8': [3, 1, 0], '9cbe2ab7': [3, 2, 0],
  '5908f986': [3, 0, 2], '8dd6a030': [3, 1, 2], 'da8acab6': [3, 2, 2], 'dfd67a40': [3, 3, 2], 'fb0dbd46': [3, 0, 4],
  'e20dd05b': [3, 1, 4], '310faf73': [3, 2, 4], '92d2c21': [3, 3, 4], '8f035e11': [4, 0, 0], '2fd829a9': [4, 1, 0],
  '979ff26e': [4, 2, 0], '185aef64': [4, 3, 0], 'ad36c9db': [4, 0, 2], 'a0c57d9': [4, 1, 2], 'b5a84be3': [4, 2, 2],
  '612059cc': [4, 3, 2], '99fc4bc1': [5, 0, 0], '2ddd1cde': [5, 1, 0], '2093314a': [5, 2, 0], 'db07c16a': [5, 3, 0],
  '9631542f': [5, 4, 0], 'baaf854f': [5, 5, 0], '364da02a': [5, 0, 2], '3547c585': [5, 1, 2], 'b0229349': [5, 2, 2],
  '72a3171e': [5, 3, 2], '1c71e28a': [5, 4, 2], '2130207d': [5, 5, 2], 'f65047fc': [6, 0, 0], 'af361e88': [6, 1, 0],
  '5dd5cf9b': [6, 2, 0], 'b0d34b7a': [6, 1, 1], '3493c216': [6, 3, 0], '6854ddc8': [6, 2, 1], 'd8a5484e': [6, 3, 1],
  '721df810': [7, 0, 0], '688d19': [7, 1, 0], '3c0130a': [7, 0, 1], 'c6d97bff': [7, 2, 0], '45a9fa9b': [7, 1, 1],
  '8e83b05d': [7, 0, 2], '69d501c6': [7, 3, 0], '17e6d933': [7, 2, 1], '4d83b068': [7, 1, 2], 'b18d33e1': [7, 3, 1],
  '69a0bf77': [7, 2, 2], '87013f3b': [7, 3, 2], 'f1e5dd66': [8, 0, 0], 'f433b469': [8, 1, 0], '2faac884': [8, 2, 0],
  '1f6b813d': [8, 1, 1], '2bd01137': [8, 3, 0], '70ce7a65': [8, 2, 1], '9d8f6994': [9, 0, 0], '24e528a9': [9, 1, 0],
  'b9c16d9a': [9, 2, 0], 'd3ecd573': [9, 3, 0], '864cde97': [9, 4, 0], 'f5ef5394': [9, 0, 1], 'd56ffabb': [9, 1, 1],
  '2765832c': [9, 2, 1], '250327d1': [9, 3, 1], '4bacffe': [9, 4, 1], 'aadcde89': [9, 5, 1],
};
/** 조각 윤곽 열쇠 — FNV-1a 로 w·h 와 칸마다 불투명(1)/투명(0, idx < 0)을 섞는다. 색은 안 본다. */
function 나무윤곽열쇠(fr) {
  if (!fr || !fr.idx) return null;
  var h = 0x811C9DC5;
  h = Math.imul((h ^ fr.w) >>> 0, 16777619) >>> 0;
  h = Math.imul((h ^ fr.h) >>> 0, 16777619) >>> 0;
  for (var i = 0; i < fr.idx.length; i++) h = Math.imul((h ^ (fr.idx[i] >= 0 ? 1 : 0)) >>> 0, 16777619) >>> 0;
  return h.toString(16);
}

/** mapObjects 의 네 검토 좌표에서 런타임 blockIndex 역할을 만들고 실제 조각만 역산한다.
 *  표본·역할 유일성·기존 검토 결과 수가 다르면 아무 것도 묶지 않는다. */
Renderer.prototype._FR08나무묶음찾기 = function (objs) {
  if (!this.nmap || this.nmap !== this._fr08TreeMapObject || !Array.isArray(objs)) return null;
  var W = this.nmap.W, H = this.nmap.H;
  if (!(W > 0 && H > 0)) return null;
  var at = Object.create(null), slots = Object.create(null), groups = Object.create(null);
  for (var i = 0; i < objs.length; i++) {
    var o = objs[i];
    if (!o || o.x < 0 || o.x >= W || o.y < 0 || o.y >= H) return null;
    var ck = o.x + ',' + o.y;
    if (at[ck]) return null;
    at[ck] = o;
  }
  /* ★ 모든 맵 공통 묶음 표가 있으면 그것으로 — 나무만이 아니라 여러 칸 사물 전부, 눕혀 둔 조각까지 (2026-10-03) */
  var 공통표 = root.G2오브젝트묶음틀;
  if (공통표 && 공통표.열쇠 && 공통표.틀크기 && !root.__오브젝트묶음끄기) return this._오브젝트묶음찾기(objs, 공통표);
  /* ★ FR08 계열 여덟 맵 밖 — 자동 나무 틀. 묶음마다 확인해 조각 자리가 겹친 묶음만 뺀다(맵 통째가 아니라) */
  var 맵이름 = this._fr08TreeMapName;
  if (맵이름 !== 'FR08' && !Object.prototype.hasOwnProperty.call(나무윤곽맵수, 맵이름)) {
    var 자동 = Object.create(null), 버림 = Object.create(null);
    for (var ai = 0; ai < objs.length; ai++) {
      var ap = objs[ai];
      if (!ap.frame || ap.frame.h < 48) continue;                          /* 도구와 같은 문턱 — 키 48 이상 조각 */
      var 칸자 = 나무자동틀[나무윤곽열쇠(ap.frame)];
      if (!칸자) continue;
      var 크 = 나무자동틀크기[칸자[0]], ax = ap.x - 칸자[1], ay = ap.y - 칸자[2], ak = 칸자[0] + ',' + ax + ',' + ay;
      var ag = 자동[ak] || (자동[ak] = { x: ax, y: ay, t: 칸자[0], W: 크[0], H: 크[1], parts: Object.create(null), count: 0 });
      var ask = 칸자[2] * 크[0] + 칸자[1];
      if (ag.parts[ask]) { 버림[ak] = 1; continue; }
      ag.parts[ask] = ap; ag.count++;
    }
    var 자동묶음 = Object.keys(자동).filter(function (k) { return !버림[k]; }).map(function (k) { return 자동[k]; });
    if (!자동묶음.length) return null;
    자동묶음.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.t - b.t; });
    return 자동묶음;
  }
  /* FR08 과 같은 나무를 쓰는 다른 맵 — 윤곽 열쇠로 나무 안 자리를 알고, 맵별 수가 맞을 때만 묶는다 */
  var 윤곽수 = this._fr08TreeMapName && this._fr08TreeMapName !== 'FR08' ? 나무윤곽맵수[this._fr08TreeMapName] : null;
  if (윤곽수) {
    var 쓴 = 0;
    for (var wi = 0; wi < objs.length; wi++) {
      var wp = objs[wi];
      if (!wp.frame || wp.frame.w !== 24 || wp.frame.h !== 96) continue;
      var 자리 = 나무윤곽틀[나무윤곽열쇠(wp.frame)];
      if (!자리) continue;
      var wx = wp.x - 자리[1], wy = wp.y - 자리[2], wk = 자리[0] + ',' + wx + ',' + wy;
      var wg = groups[wk] || (groups[wk] = { x: wx, y: wy, t: 자리[0], W: 5, H: 2, parts: Object.create(null), count: 0 });
      var wsk = 자리[2] * 5 + 자리[1];
      if (wg.parts[wsk]) return null;
      wg.parts[wsk] = wp; wg.count++; 쓴++;
    }
    var 윤곽묶음 = Object.keys(groups).map(function (k) { return groups[k]; });
    if (윤곽묶음.length !== 윤곽수[0] || 쓴 !== 윤곽수[1]) return null;
    윤곽묶음.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.t - b.t; });
    return 윤곽묶음;
  }
  /* ☆☆☆ 네째 표본을 (2,18) → (6,18) 로 바로잡았다 (2026-09-23)
   *   (2,18) 은 나무 둘이 우연히 맞물린 자리였다 — 그 차례로 묶으면
   *   줄기가 맨 왼쪽 끝에 붙고 오른쪽에 얇은 조각이 떨어져 떠 보인다.
   *   근거 — 그림 이음매(조각 끝 세로줄이 둘 다 불투명인 줄 수):
   *     제품 차례 67 68 69 70 71 — 안쪽이음 251 · 바깥이음 **74**
   *     바른 차례 71 67 68 69 70 — 안쪽이음 **325** · 바깥이음 **0**
   *   아랫줄(76 72 73 74 75)도 따로 재서 같은 답이고, 종류 0·1·2 는
   *   제품 차례가 바깥이음 0 이다(3/3 일치) — 잣대가 검산됐다.
   *   배치도 같은 말을 한다 — 바른 차례로 **온전한 나무가 8그루**,
   *   제품 차례로는 **딱 1그루**이며 그것이 예전 표본 (2,18) 이었다.
   *   ☆ 그래서 묶음 수가 79 → **73** 으로 바뀐다 (조각 640 은 그대로).
   *   사장님 승인 2026-09-23 · 근거 그림 FR08_나무대조.png */
  var samples = [[3, 16], [8, 16], [13, 16], [6, 18]];
  for (var t = 0; t < samples.length; t++) {
    var sx = samples[t][0], sy = samples[t][1];
    for (var dy = 0; dy < 2; dy++) for (var dx = 0; dx < 5; dx++) {
      var sample = at[(sx + dx) + ',' + (sy + dy)];
      if (!sample || !sample.frame || sample.frame.w !== 24 || sample.frame.h !== 96) return null;
      var bi = String(sample.blockIndex);
      if (Object.prototype.hasOwnProperty.call(slots, bi)) return null;
      slots[bi] = { t: t, dx: dx, dy: dy };
    }
  }
  var used = 0;
  for (var j = 0; j < objs.length; j++) {
    var part = objs[j], slot = slots[String(part.blockIndex)];
    if (!slot) continue;
    if (!part.frame || part.frame.w !== 24 || part.frame.h !== 96) return null;
    var gx = part.x - slot.dx, gy = part.y - slot.dy;
    var key = slot.t + ',' + gx + ',' + gy;
    var group = groups[key] || (groups[key] = { x: gx, y: gy, t: slot.t, W: 5, H: 2, parts: Object.create(null), count: 0 });
    var sk = slot.dy * 5 + slot.dx;
    if (group.parts[sk]) return null;
    group.parts[sk] = part; group.count++; used++;
  }
  var out = Object.keys(groups).map(function (k) { return groups[k]; });
  if (out.length !== 73 || used !== 640) return null;   /* 79 → 73 — 네째 표본 바로잡음 */
  out.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.t - b.t; });
  return out;
};

/**
 * ★★★ 모든 맵 공통 오브젝트 묶음 (2026-10-03 · 사장님 「맵에 있는 오브젝트 전수를 확인해서 겹치는 것들은 동일한
 *   방식으로 처리되게 … 인위적으로 전체나 일부를 눕혀놓은 부분들이 있어서 이것까지 포함해서 잡아야해」)
 *
 *   표 `06_패치/적용/오브젝트묶음틀.json` 은 `04_도구/오브젝트틀_전수.js` 가 전투 맵 256 원본 .MAP 에서 굽는다 —
 *   윤곽 열쇠 → [틀, 칸x, 칸y] · 틀크기[틀] = [폭칸, 높칸] · 뺌[맵] = 건물 칸에 걸친 묶음 · 맵수[맵] = 도구가 센 [묶음, 조각].
 *   도구와 같은 문턱 — 그림 키 17 이상 · 접는선 아래 · 같은 칸 둘이면 그 묶음만 버림 · 조각 둘 이상.
 *   FR08 계열·자동 나무 21맵은 예전 표와 조각 하나까지 같다(문서 맵_오브젝트_덩어리묶기.md §12).
 *   눕힌 조각이 든 묶음도 돌려준다 — 기울이면 한 판으로 세우고, 기울기 0 은 예전 그대로(_원본맵오브젝트짓기).
 *   끄는 스위치 `window.__오브젝트묶음끄기 = true` — 예전 나무 표로 돈다.
 */
Renderer.prototype._오브젝트묶음찾기 = function (objs, 표) {
  var 맵이름 = this._fr08TreeMapName, foldY = this._foldY | 0, 뺌 = Object.create(null), 묶 = Object.create(null), 버림 = Object.create(null);
  var nm = this.nmap, mapW = nm && nm.W, mapH = nm && nm.H, cells = nm && nm.layerB && nm.layerB.length;
  ((표.뺌 && 표.뺌[맵이름]) || []).forEach(function (k) { 뺌[k] = 1; });
  for (var i = 0; i < objs.length; i++) {
    var o = objs[i];
    if (!o.frame || !o.frame.idx || o.y < foldY) continue;
    /* 키 16 이하는 손으로 «세움» 지정한 조각만 받는다 (2026-10-14 사장님 「t00031같은게 … 아래쪽은 눕혀놓은거. 이런걸 묶어야하는거야」
     *   → 고르심 «실행기도 고치기»). 모양 열쇠만으로 받으면 같은 모양 바닥 조각이 딸려 온다 — 도구 오브젝트틀_전수.js 와 같은 조건 */
    if (o.frame.h < 17 && !(typeof this._원본오브젝트분류 === 'function' && this._원본오브젝트분류(o.blockIndex, o.height) === 'billboard')) continue;   /* 눕힘/세움 판단과 같은 차례(손 분류 → mapx.blocks) */
    var z = 표.열쇠[나무윤곽열쇠(o.frame)];
    if (!z) continue;
    var 크 = 표.틀크기[z[0]]; if (!크) continue;
    /* 틀의 슬롯 반복은 실제 디코드 MAP 안에서만 허용한다. 잘못된 표는 기존 2D 조각으로 남긴다. */
    if (!Number.isSafeInteger(mapW) || !Number.isSafeInteger(mapH) ||
        !Number.isSafeInteger(크[0]) || !Number.isSafeInteger(크[1]) ||
        크[0] < 1 || 크[1] < 1 || 크[0] > mapW || 크[1] > mapH ||
        !Number.isSafeInteger(크[0] * 크[1]) || 크[0] * 크[1] > cells ||
        !Number.isSafeInteger(z[1]) || !Number.isSafeInteger(z[2]) ||
        z[1] < 0 || z[2] < 0 || z[1] >= 크[0] || z[2] >= 크[1]) continue;
    var gx = o.x - z[1], gy = o.y - z[2], k = z[0] + ',' + gx + ',' + gy;
    if (뺌[k]) continue;
    var g = 묶[k] || (묶[k] = { x: gx, y: gy, t: z[0], W: 크[0], H: 크[1], parts: Object.create(null), count: 0 });
    var sk = z[2] * 크[0] + z[1];
    if (g.parts[sk]) { 버림[k] = 1; continue; }
    g.parts[sk] = o; g.count++;
  }
  /* 손 분류(지면화 도구)로 눕힌 조각은 판에서 뺀다 — 늘 눕힌 채 (2026-10-04 · 「난 분명히 눕혔는데」)
   *   묶음 표는 손 분류 없이 구워졌다 — 244묶음·1,332조각이 걸린다(SFT·ICE·CYRUPS·GREEK …). 사장님 선택 「연결만 하기」라 표는 그대로 */
  var 손 = root.G2블록분류, NN = root.G2Native;
  if (손 && nm && NN && NN.blockKey) Object.keys(묶).forEach(function (k) {
    var g = 묶[k], ps = g.parts;
    for (var pk in ps) { var kk = NN.blockKey(nm, ps[pk].blockIndex); if (kk && 손[kk] === 'flat') { delete ps[pk]; g.count--; } }   /* 손 눕힘 조각은 판에서 뺀다 */
  });
  /* ★★★★★ 눕혀 그리는 조각은 판에 넣지 않는다 (2026-10-04 · 사장님 「왜 자꾸 멋대로 세로 높이가
   *   일정이상인 블록을 세우는거야! 내가 손으로 일일히 다 지정했다고 했잖아! 왜 자꾸 세우는거야!」)
   *   묶음은 «이미 서 있는 조각끼리» 이어 붙이기만 한다 — 눕힘/세움 결정(_원본오브젝트분류 · 지면화 도구와 같은 차례)을 바꾸지 않는다 */
  /*   ⇒ 눕힌 조각은 묶음에서 빼 늘 눕힌 채 두고, 서 있는 조각만 판으로 잇는다(BEA 야자수처럼 밑동 몇 조각만 누운 나무도 서 있는 몸통은 묶인다) */
  var self분류 = this;
  if (typeof this._원본오브젝트분류 === 'function') Object.keys(묶).forEach(function (k) {
    var g = 묶[k], ps = g.parts;
    for (var pk in ps) if (self분류._원본오브젝트분류(ps[pk].blockIndex, ps[pk].height) === 'flat') { delete ps[pk]; g.count--; }
  });
  var out = Object.keys(묶).filter(function (k) { return !버림[k] && 묶[k].count >= 2; }).map(function (k) { return 묶[k]; });
  var 조각 = out.reduce(function (a, g) { return a + g.count; }, 0), 기대 = 표.맵수 && 표.맵수[맵이름];
  this._오브젝트묶음셈 = { 맵: 맵이름, 묶음: out.length, 조각: 조각, 기대: 기대 || null };
  if (기대 && (기대[0] !== out.length || 기대[1] !== 조각))
    console.warn('[맵] 오브젝트 묶음 수가 도구와 다르다:', 맵이름, out.length + '/' + 조각, '도구', 기대[0] + '/' + 기대[1]);
  /* ★★ 맵별 묶음 — 사장님이 지면화 도구에서 «세움/눕힘»으로 지정한 것만 따른다 (2026-10-18 사장님 「접근 방식을 바꿔.
   *   기존 지면화 도구에 묶음 반영하고 눕히거나 세우는걸 내가 지정할 수 있게 해」)
   *   후보 = 표 «그림묶음»[맵] = [왼칸, 윗칸, [[dx,dy]…], 카드번호, 카드열쇠, 갈래, 지금] — 04_도구/오브젝트묶음_검토굽기.js 가 굽는다
   *   지정 = root.G2묶음지정[카드열쇠].v — 06_패치/적용/블록분류.json «묶음» (지면화 도구가 저장 · GET /__블록분류)
   *     'billboard' 세움 — 한 판으로 세운다(틀 묶음이 이미 다 잡은 자리는 그대로 둔다). 바닥에 구운 낮은 눕힘 조각은 두 번 그려져 뺀다
   *     'flat'      눕힘 — 그 자리 조각을 틀 묶음에서도 뺀다(판으로 안 선다)
   *   지정이 없으면 예전 그대로(틀 묶음만). 기울기 0 은 늘 예전 조각 그대로(판은 기울일 때만). 끄기 `window.__그림묶음끄기 = true` */
  var 그림 = !root.__그림묶음끄기 && 표.그림묶음 && 표.그림묶음[맵이름], 지정 = root.G2묶음지정;
  if (Array.isArray(그림) && 그림.length && 지정) {
    var 칸에 = Object.create(null), 든 = new Map(), 새 = [], 눕힌 = 0;
    for (var ci = 0; ci < objs.length; ci++) { var co = objs[ci]; if (co.frame && co.frame.idx && co.y >= foldY) 칸에[co.x + ',' + co.y] = co; }
    out.forEach(function (g) { for (var pk in g.parts) 든.set(g.parts[pk], g); });
    var 틀에서빼기 = function (p) { var 옛 = 든.get(p); if (옛) for (var pk in 옛.parts) if (옛.parts[pk] === p) { delete 옛.parts[pk]; 옛.count--; } 든.set(p, 0); };   /* 0 = 지정 묶음이 가져갔다 */
    그림.forEach(function (r, ri) {
      if (!Array.isArray(r) || !Array.isArray(r[2])) return;
      var 값 = 지정[r[4]] && 지정[r[4]].v;
      if (값 !== 'billboard' && 값 !== 'flat') return;
      var 칸조각 = r[2].map(function (d) { return 칸에[(r[0] + d[0]) + ',' + (r[1] + d[1])]; }).filter(function (p) { return p && 든.get(p) !== 0; });
      if (값 === 'flat') { 칸조각.forEach(틀에서빼기); if (칸조각.length) 눕힌++; return; }
      if (r[6] === '묶임') return;                                              /* 틀 묶음이 이미 한 판으로 세운다 */
      var 조각들 = 칸조각.filter(function (p) {
        var 선다 = typeof self분류._원본오브젝트분류 === 'function' && self분류._원본오브젝트분류(p.blockIndex, p.height) !== 'flat';
        return 선다 || p.height > TH;                                           /* 바닥에 구운 낮은 눕힘 조각은 뺀다 */
      });
      if (조각들.length < 2) return;
      var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      조각들.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
      var g = { x: x0, y: y0, t: 100000 + ri, W: x1 - x0 + 1, H: y1 - y0 + 1, parts: Object.create(null), count: 0, 그림묶음: r[3] || true };
      조각들.forEach(function (p) { 틀에서빼기(p); g.parts[(p.y - y0) * g.W + (p.x - x0)] = p; g.count++; });
      새.push(g);
    });
    out = out.filter(function (g) { return g.count >= 2; }).concat(새);
    this._오브젝트묶음셈.그림묶음 = 새.length;
    this._오브젝트묶음셈.그림조각 = 새.reduce(function (a, g) { return a + g.count; }, 0);
    this._오브젝트묶음셈.눕힌묶음 = 눕힌;
  }
  if (!out.length) return null;
  out.sort(function (a, b) { return a.y - b.y || a.x - b.x || a.t - b.t; });
  return out;
};

/* 명시적으로 찾은 묶음의 디코드 조각만 읽는 비활성 순서 진단.
 * 평면 2D의 행·높이·열 순서와 숫자 slot 판 순서가 역전한 두 조각의
 * 공동 불투명 픽셀을 센다. CSS 이음새/실제 가림·소속 승인에는 쓰지 않는다. */
Renderer.prototype.map3D묶음순서진단 = function (group) {
  if (!group || !group.parts) return { status: 'no-group', displayAllowed: false };
  var slots = Object.keys(group.parts).map(function (k) { return group.parts[k]; });
  if (slots.length < 2) return { status: 'no-group', displayAllowed: false };
  var map = this.nmap, foldY = this._foldY || 0;
  var fx = (typeof root !== 'undefined' && root.G2Fx) || null, animated = [];
  for (var i = 0; i < slots.length; i++) {
    var o = slots[i], fr = o && o.frame;
    var anim = o && this.nmap && this.nmap.blockAnim && this.nmap.blockAnim[o.blockIndex];
    if (!fr || !fr.idx || !Number.isSafeInteger(fr.w) || !Number.isSafeInteger(fr.h) ||
        fr.w <= 0 || fr.h <= 0 || fr.idx.length < fr.w * fr.h ||
        !Number.isSafeInteger(o.x) || !Number.isSafeInteger(o.y) || o.y < foldY ||
        this._원본오브젝트분류(o.blockIndex, o.height) !== 'billboard')
      return { status: 'unproven', displayAllowed: false };
    if (anim && anim.length > 1) {
      /* Fx 번호만으로는 화면 적용 증거가 아니다. URL 실패면 번호만 앞서간다.
       * 기존 평면/묶음 DOM 대상 모두 현재 프레임 URL을 받은 경우에만 읽는다. */
      var k = fx && fx.objIdx && fx.objIdx[o.blockIndex];
      if (k == null && fx && fx.objFirst === false) k = 0;
      var currentBlock = Number.isSafeInteger(k) && anim[k];
      var targets = this.animObjEls && this.animObjEls[o.blockIndex];
      var url = Number.isSafeInteger(currentBlock) && this.blockUrl && this.blockUrl(currentBlock);
      if (!fx || fx.renderer !== this || fx._objAnimMap !== this.nmap ||
          !Number.isSafeInteger(k) || k < 0 || k >= anim.length ||
          !Number.isSafeInteger(currentBlock) || !url ||
          !targets || !targets.length || targets.some(function (it) {
            return !it || !it.el || !it.el.parentNode || it.el._animUrl !== url;
          })) return { status: 'unproven', displayAllowed: false };
      fr = this.nmap.decodeBlock(currentBlock);
      if (!fr || !fr.idx || !Number.isSafeInteger(fr.w) || !Number.isSafeInteger(fr.h) ||
          fr.w <= 0 || fr.h <= 0 || fr.idx.length < fr.w * fr.h)
        return { status: 'unproven', displayAllowed: false };
      animated.push({ blockIndex: o.blockIndex, index: k, block: currentBlock,
        url: url, targets: targets });
      slots[i] = { x: o.x, y: o.y, blockIndex: o.blockIndex,
        height: o.height, sortH: o.frame.h, frame: fr };
    }
  }
  // 명시 입력은 초안에서 총 디코드 픽셀을 제한한다. 쌍별 비교도 그
  // 입력 픽셀보다 많이 읽어야 하면 비활성 진단만 닫아 기존 2D를 막지 않는다.
  var sourcePixels = slots.reduce(function (n, o) { return n + o.frame.w * o.frame.h; }, 0);
  if (!Number.isSafeInteger(sourcePixels))
    return { status: 'unproven', displayAllowed: false };
  var comparisonPixels = 0;
  var legacy = slots.slice().sort(function (a, b) {
    return a.y - b.y || (a.sortH == null ? a.frame.h : a.sortH) -
      (b.sortH == null ? b.frame.h : b.sortH) || a.x - b.x;
  });
  var rank = new Map();
  legacy.forEach(function (o, n) { rank.set(o, n); });
  // 쌍별 사건 수는 기존 계약대로 두고, 같은 화면점을 여러 역전 쌍이
  // 공유하는 경우만 별도 고유 수치로 구분한다. 비교 순회는 위 sourcePixels 경계 안이다.
  var invertedPairs = 0, frameOverlapPairs = 0;
  var opaqueOverlapPixels = 0, opaqueInvertedPairs = 0;
  var frameOverlapPairsBySlot = slots.map(function () { return 0; });
  var frameOverlapPixelEventsBySlot = slots.map(function () { return 0; });
  var opaqueInvertedPairsBySlot = slots.map(function () { return 0; });
  var opaqueOverlapPixelEventsBySlot = slots.map(function () { return 0; });
  // 비교 가능한 점만 임시 64×64 비트 칸에 표시한다. 큰 진단에서 점마다
  // 'y,x' 문자열을 보유하지 않으며 MAP/표시 owner 상태를 만들지 않는다.
  var uniqueFrameTiles = new Map(), uniqueFrameCount = 0;
  var uniqueOpaqueTiles = new Map(), uniqueOpaqueCount = 0;
  var overlapMinX = Infinity, overlapMinY = Infinity;
  var overlapMaxX = -Infinity, overlapMaxY = -Infinity;
  var frameMinX = Infinity, frameMinY = Infinity;
  var frameMaxX = -Infinity, frameMaxY = -Infinity;
  for (var a = 0; a < slots.length; a++) for (var b = a + 1; b < slots.length; b++) {
    if (rank.get(slots[a]) < rank.get(slots[b])) continue;
    invertedPairs++;
    var one = slots[a], two = slots[b];
    var left = Math.max(one.x * TW, two.x * TW);
    var right = Math.min(one.x * TW + one.frame.w, two.x * TW + two.frame.w);
    var topOne = (one.y + 1) * TH - one.frame.h;
    var topTwo = (two.y + 1) * TH - two.frame.h;
    var top = Math.max(topOne, topTwo);
    var bottom = Math.min(topOne + one.frame.h, topTwo + two.frame.h);
    var pairFramePixels = Math.max(0, right - left) * Math.max(0, bottom - top);
    comparisonPixels += pairFramePixels;
    if (comparisonPixels > sourcePixels)
      return { status: 'unproven', displayAllowed: false };
    // 역전 쌍의 논리 프레임 교차 범위다. 아래 공동 불투명점 범위와 별개다.
    if (right > left && bottom > top) {
      frameOverlapPairs++;
      frameOverlapPairsBySlot[a]++;
      frameOverlapPairsBySlot[b]++;
      frameOverlapPixelEventsBySlot[a] += pairFramePixels;
      frameOverlapPixelEventsBySlot[b] += pairFramePixels;
      if (left < frameMinX) frameMinX = left;
      if (top < frameMinY) frameMinY = top;
      if (right > frameMaxX) frameMaxX = right;
      if (bottom > frameMaxY) frameMaxY = bottom;
    }
    var pairHasOpaque = false;
    for (var y = top; y < bottom; y++) for (var x = left; x < right; x++) {
      var tileY = Math.floor(y / 64), tileX = Math.floor(x / 64);
      var bit = (y - tileY * 64) * 64 + x - tileX * 64;
      var word = bit >>> 5, mask = 1 << (bit & 31);
      var frameTileRow = uniqueFrameTiles.get(tileY);
      if (!frameTileRow) { frameTileRow = new Map(); uniqueFrameTiles.set(tileY, frameTileRow); }
      var frameBits = frameTileRow.get(tileX);
      if (!frameBits) { frameBits = new Uint32Array(128); frameTileRow.set(tileX, frameBits); }
      if (!(frameBits[word] & mask)) { frameBits[word] |= mask; uniqueFrameCount++; }
      var p = one.frame.idx[(y - topOne) * one.frame.w + x - one.x * TW];
      var q = two.frame.idx[(y - topTwo) * two.frame.w + x - two.x * TW];
      if (p >= 0 && q >= 0) {
        opaqueOverlapPixels++;
        opaqueOverlapPixelEventsBySlot[a]++;
        opaqueOverlapPixelEventsBySlot[b]++;
        pairHasOpaque = true;
        var tileRow = uniqueOpaqueTiles.get(tileY);
        if (!tileRow) { tileRow = new Map(); uniqueOpaqueTiles.set(tileY, tileRow); }
        var bits = tileRow.get(tileX);
        if (!bits) { bits = new Uint32Array(128); tileRow.set(tileX, bits); }
        if (!(bits[word] & mask)) { bits[word] |= mask; uniqueOpaqueCount++; }
        if (x < overlapMinX) overlapMinX = x;
        if (y < overlapMinY) overlapMinY = y;
        if (x > overlapMaxX) overlapMaxX = x;
        if (y > overlapMaxY) overlapMaxY = y;
      }
    }
    if (pairHasOpaque) {
      opaqueInvertedPairs++;
      opaqueInvertedPairsBySlot[a]++;
      opaqueInvertedPairsBySlot[b]++;
    }
  }
  if (this.nmap !== map || (this._foldY || 0) !== foldY ||
      animated.length && (typeof root === 'undefined' || root.G2Fx !== fx) ||
      animated.some(function (one) {
    var anim = this.nmap.blockAnim[one.blockIndex];
    return !fx || fx.renderer !== this || fx._objAnimMap !== this.nmap ||
      (!fx.objIdx || (fx.objIdx[one.blockIndex] == null && fx.objFirst === false
        ? 0 : fx.objIdx[one.blockIndex]) !== one.index) ||
      !anim || anim[one.index] !== one.block ||
      this.animObjEls[one.blockIndex] !== one.targets ||
      one.targets.some(function (it) {
        return !it || !it.el || !it.el.parentNode || it.el._animUrl !== one.url;
      });
  }, this)) return { status: 'unproven', displayAllowed: false };
  return { status: 'diagnostic-only', invertedPairs: invertedPairs,
    frameOverlapPairs: frameOverlapPairs,
    frameOverlapPairsBySlot: Object.freeze(frameOverlapPairsBySlot),
    frameOverlapPixelEvents: comparisonPixels,
    frameOverlapPixelEventsBySlot: Object.freeze(frameOverlapPixelEventsBySlot),
    uniqueFrameOverlapPixels: uniqueFrameCount,
    opaqueInvertedPairs: opaqueInvertedPairs,
    opaqueInvertedPairsBySlot: Object.freeze(opaqueInvertedPairsBySlot),
    opaqueOverlapPixels: opaqueOverlapPixels,
    opaqueOverlapPixelEventsBySlot: Object.freeze(opaqueOverlapPixelEventsBySlot),
    uniqueOpaqueOverlapPixels: uniqueOpaqueCount,
    frameOverlapBounds: frameMinX < Infinity ? Object.freeze({
      x: frameMinX, y: frameMinY,
      w: frameMaxX - frameMinX, h: frameMaxY - frameMinY
    }) : null,
    opaqueOverlapBounds: opaqueOverlapPixels ? Object.freeze({
      x: overlapMinX, y: overlapMinY,
      w: overlapMaxX - overlapMinX + 1, h: overlapMaxY - overlapMinY + 1
    }) : null, displayAllowed: false };
};

/* 두 사용자 지정 묶음 사이에는 공통 판 slot 순서가 없다. 현재 화면에 적용된
 * 프레임의 2D 행 순서와 공동 불투명점만 읽으며 표시 승인으로 쓰지 않는다. */
Renderer.prototype.map3D두묶음행충돌진단 = function (first, second) {
  var closed = { status: 'unproven', displayAllowed: false };
  if (!first || !second || !first.parts || !second.parts || first === second) return closed;
  var map = this.nmap, fx = root.G2Fx, self = this, foldY = this._foldY || 0;
  if (!map || !Number.isSafeInteger(map.W) || !Number.isSafeInteger(map.H) ||
      !map.layerB || !map.blockAnim || typeof map.decodeBlock !== 'function') return closed;
  var groups = [first, second], entries = [], proofs = [], sourcePixels = 0,
    resizedFrameParts = 0;
  for (var gi = 0; gi < 2; gi++) {
    var parts = Object.keys(groups[gi].parts), seen = Object.create(null);
    if (!parts.length) return closed;
    for (var pi = 0; pi < parts.length; pi++) {
      var o = groups[gi].parts[parts[pi]], fr = o && o.frame;
      if (!o || !o.frame || !Number.isSafeInteger(o.frame.w) ||
          !Number.isSafeInteger(o.frame.h) || o.frame.w < 1 || o.frame.h < 1 ||
          !Number.isSafeInteger(o.x) || !Number.isSafeInteger(o.y) ||
          !Number.isSafeInteger(o.blockIndex) || o.x < 0 || o.y < 0 ||
          o.x >= map.W || o.y >= map.H || o.y < foldY ||
          map.layerB[o.y * map.W + o.x] - 1 !== o.blockIndex ||
          seen[o.x + ',' + o.y] ||
          self._원본오브젝트분류(o.blockIndex, o.height) !== 'billboard') return closed;
      seen[o.x + ',' + o.y] = true;
      var anim = map.blockAnim[o.blockIndex];
      if (anim && anim.length > 1) {
        var k = fx && fx.objIdx && fx.objIdx[o.blockIndex];
        if (k == null && fx && fx.objFirst === false) k = 0;
        var bi = Number.isSafeInteger(k) && anim[k], url =
          Number.isSafeInteger(bi) && this.blockUrl && this.blockUrl(bi);
        var targets = this.animObjEls && this.animObjEls[o.blockIndex];
        if (!fx || fx.renderer !== this || fx._objAnimMap !== map ||
            !Number.isSafeInteger(k) || k < 0 || k >= anim.length ||
            !Number.isSafeInteger(bi) || !url || !targets || !targets.length ||
            targets.some(function (it) {
              return !it || !it.el || !it.el.parentNode || it.el._animUrl !== url;
            })) return closed;
        fr = map.decodeBlock(bi);
        proofs.push({ blockIndex: o.blockIndex, index: k, block: bi,
          url: url, targets: targets });
      }
      if (!fr || !fr.idx || !Number.isSafeInteger(fr.w) ||
          !Number.isSafeInteger(fr.h) || fr.w < 1 || fr.h < 1 ||
          fr.idx.length < fr.w * fr.h) return closed;
      sourcePixels += fr.w * fr.h;
      if (!Number.isSafeInteger(sourcePixels)) return closed;
      if (fr.w !== o.frame.w || fr.h !== o.frame.h) resizedFrameParts++;
      entries.push({ group: gi, partKey: parts[pi], framePixelEvents: 0,
        framePixelTiles: new Map(), uniqueFramePixels: 0,
        frameDirectionPixelTiles: [new Map(), new Map(), new Map()],
        uniqueFramePixelsByDirection: [0, 0, 0],
        framePixelEventsByDirection: [0, 0, 0],
        frameOverlapPairParticipation: 0,
         frameOverlapPairParticipationByDirection: [0, 0, 0],
         opaquePairParticipation: 0, opaquePixelEvents: 0,
        opaquePixelTiles: new Map(), uniqueOpaquePixels: 0,
        opaqueDirectionPixelTiles: [new Map(), new Map(), new Map()],
        uniqueOpaquePixelsByDirection: [0, 0, 0],
        opaquePixelEventsByDirection: [0, 0, 0],
        opaquePairParticipationByDirection: [0, 0, 0], x: o.x, y: o.y, height: o.height, sortH: o.frame.h, frame: fr });
    }
  }
  var firstFrontPairs = 0, secondFrontPairs = 0,
    firstFrontCandidatePairs = 0, secondFrontCandidatePairs = 0,
    sameOrderCandidatePairs = 0,
    firstFrontFrameOverlapPairs = 0, secondFrontFrameOverlapPairs = 0,
    sameOrderFrameOverlapPairs = 0, pairPixelEvents = 0,
    frameDirectionPixelEvents = [0, 0, 0],
    frameOverlapMinX = Infinity, frameOverlapMinY = Infinity,
    frameOverlapMaxX = -Infinity, frameOverlapMaxY = -Infinity,
    frameDirectionEdges = [0, 1, 2].map(function () {
      return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }),
    firstFrontPixelEvents = 0, secondFrontPixelEvents = 0,
    sameOrderPixelEvents = 0,
    directionTiles = [new Map(), new Map(), new Map()],
    directionUnique = [0, 0, 0],
    directionEdges = [0, 1, 2].map(function () {
      return { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    }),
    frameDirectionTiles = [new Map(), new Map(), new Map()],
    frameDirectionUnique = [0, 0, 0],
    frameTiles = new Map(), uniqueFrameOverlapPixels = 0,
    overlapTiles = new Map(), overlapCount = 0, compared = 0,
    overlapMinX = Infinity, overlapMinY = Infinity,
    overlapMaxX = -Infinity, overlapMaxY = -Infinity;
  function markPixel(tiles, tileY, tileX, word, mask) {
    var tileRow = tiles.get(tileY);
    if (!tileRow) { tileRow = new Map(); tiles.set(tileY, tileRow); }
    var bits = tileRow.get(tileX);
    if (!bits) { bits = new Uint32Array(128); tileRow.set(tileX, bits); }
    if (bits[word] & mask) return false;
    bits[word] |= mask;
    return true;
  }
  for (var a = 0; a < entries.length; a++) for (var b = a + 1; b < entries.length; b++) {
    var one = entries[a], two = entries[b];
    if (one.group === two.group) continue;
    var order = one.y - two.y || one.sortH - two.sortH || one.x - two.x;
    if (order > 0) firstFrontCandidatePairs++;
    else if (order < 0) secondFrontCandidatePairs++;
    else sameOrderCandidatePairs++;
    var left = Math.max(one.x * TW, two.x * TW),
      right = Math.min(one.x * TW + one.frame.w, two.x * TW + two.frame.w),
      topOne = (one.y + 1) * TH - one.frame.h,
      topTwo = (two.y + 1) * TH - two.frame.h,
      top = Math.max(topOne, topTwo),
      bottom = Math.min(topOne + one.frame.h, topTwo + two.frame.h);
    var pairFramePixels = Math.max(0, right - left) * Math.max(0, bottom - top);
    compared += pairFramePixels;
    if (compared > sourcePixels) return closed;
    if (right <= left || bottom <= top) continue;
    if (left < frameOverlapMinX) frameOverlapMinX = left;
    if (top < frameOverlapMinY) frameOverlapMinY = top;
    if (right > frameOverlapMaxX) frameOverlapMaxX = right;
    if (bottom > frameOverlapMaxY) frameOverlapMaxY = bottom;
    var direction = order > 0 ? 0 : order < 0 ? 1 : 2;
    frameDirectionPixelEvents[direction] += pairFramePixels;
    one.framePixelEvents += pairFramePixels;
    two.framePixelEvents += pairFramePixels;
    one.framePixelEventsByDirection[direction] += pairFramePixels;
    two.framePixelEventsByDirection[direction] += pairFramePixels;
    var frameEdge = frameDirectionEdges[direction];
    if (left < frameEdge.minX) frameEdge.minX = left;
    if (top < frameEdge.minY) frameEdge.minY = top;
    if (right > frameEdge.maxX) frameEdge.maxX = right;
    if (bottom > frameEdge.maxY) frameEdge.maxY = bottom;
    one.frameOverlapPairParticipation++;
    two.frameOverlapPairParticipation++;
    one.frameOverlapPairParticipationByDirection[direction]++;
    two.frameOverlapPairParticipationByDirection[direction]++;
    if (order > 0) firstFrontFrameOverlapPairs++;
    else if (order < 0) secondFrontFrameOverlapPairs++;
    else sameOrderFrameOverlapPairs++;
    var pairOpaque = 0;
    for (var y = top; y < bottom; y++) for (var x = left; x < right; x++) {
      var tileY = Math.floor(y / 64), tileX = Math.floor(x / 64);
      var bit = (y - tileY * 64) * 64 + x - tileX * 64;
      var word = bit >>> 5, mask = 1 << (bit & 31);
      if (markPixel(frameTiles, tileY, tileX, word, mask)) uniqueFrameOverlapPixels++;
      if (markPixel(one.framePixelTiles, tileY, tileX, word, mask)) one.uniqueFramePixels++;
      if (markPixel(two.framePixelTiles, tileY, tileX, word, mask)) two.uniqueFramePixels++;
      if (markPixel(one.frameDirectionPixelTiles[direction], tileY, tileX, word, mask))
        one.uniqueFramePixelsByDirection[direction]++;
      if (markPixel(two.frameDirectionPixelTiles[direction], tileY, tileX, word, mask))
        two.uniqueFramePixelsByDirection[direction]++;
      if (markPixel(frameDirectionTiles[direction], tileY, tileX, word, mask))
        frameDirectionUnique[direction]++;
      if (one.frame.idx[(y - topOne) * one.frame.w + x - one.x * TW] >= 0 &&
          two.frame.idx[(y - topTwo) * two.frame.w + x - two.x * TW] >= 0) {
        pairOpaque++;
        if (markPixel(one.opaquePixelTiles, tileY, tileX, word, mask)) one.uniqueOpaquePixels++;
        if (markPixel(two.opaquePixelTiles, tileY, tileX, word, mask)) two.uniqueOpaquePixels++;
        if (markPixel(one.opaqueDirectionPixelTiles[direction], tileY, tileX, word, mask))
          one.uniqueOpaquePixelsByDirection[direction]++;
        if (markPixel(two.opaqueDirectionPixelTiles[direction], tileY, tileX, word, mask))
          two.uniqueOpaquePixelsByDirection[direction]++;
        if (markPixel(directionTiles[direction], tileY, tileX, word, mask)) {
          directionUnique[direction]++;
          var edge = directionEdges[direction];
          if (x < edge.minX) edge.minX = x;
          if (x > edge.maxX) edge.maxX = x;
          if (y < edge.minY) edge.minY = y;
          if (y > edge.maxY) edge.maxY = y;
        }
        if (markPixel(overlapTiles, tileY, tileX, word, mask)) {
          overlapCount++;
          if (x < overlapMinX) overlapMinX = x;
          if (x > overlapMaxX) overlapMaxX = x;
          if (y < overlapMinY) overlapMinY = y;
          if (y > overlapMaxY) overlapMaxY = y;
        }
      }
    }
    if (!pairOpaque) continue;
    one.opaquePixelEvents += pairOpaque;
    two.opaquePixelEvents += pairOpaque;
    one.opaquePixelEventsByDirection[direction] += pairOpaque;
    two.opaquePixelEventsByDirection[direction] += pairOpaque;
    one.opaquePairParticipation++;
    two.opaquePairParticipation++;
    one.opaquePairParticipationByDirection[direction]++;
    two.opaquePairParticipationByDirection[direction]++;
    pairPixelEvents += pairOpaque;
    if (order < 0) { secondFrontPairs++; secondFrontPixelEvents += pairOpaque; }
    else if (order > 0) { firstFrontPairs++; firstFrontPixelEvents += pairOpaque; }
    else sameOrderPixelEvents += pairOpaque;
  }
  if (this.nmap !== map || (this._foldY || 0) !== foldY ||
      proofs.length && root.G2Fx !== fx ||
      proofs.some(function (p) {
        var anim = map.blockAnim[p.blockIndex];
        return !fx || fx.renderer !== self || fx._objAnimMap !== map ||
          (!fx.objIdx || (fx.objIdx[p.blockIndex] == null && fx.objFirst === false
            ? 0 : fx.objIdx[p.blockIndex]) !== p.index) ||
          !anim || anim[p.index] !== p.block ||
          self.animObjEls[p.blockIndex] !== p.targets ||
          p.targets.some(function (it) {
            return !it || !it.el || !it.el.parentNode || it.el._animUrl !== p.url;
          });
      })) return closed;
  function uniqueBounds(direction) {
    if (!directionUnique[direction]) return null;
    var edge = directionEdges[direction];
    return Object.freeze({ x: edge.minX, y: edge.minY,
      w: edge.maxX - edge.minX + 1, h: edge.maxY - edge.minY + 1 });
  }
  function frameDirectionBounds(direction) {
    var edge = frameDirectionEdges[direction];
    return edge.minX < Infinity ? Object.freeze({
      x: edge.minX, y: edge.minY,
      w: edge.maxX - edge.minX, h: edge.maxY - edge.minY }) : null;
  }
  return { status: 'two-group-current-frame-row-only',
    frameOverlapPixelEvents: compared,
    firstFrontFrameOverlapPixelEvents: frameDirectionPixelEvents[0],
    secondFrontFrameOverlapPixelEvents: frameDirectionPixelEvents[1],
    sameOrderFrameOverlapPixelEvents: frameDirectionPixelEvents[2],
    uniqueFrameOverlapPixels: uniqueFrameOverlapPixels,
    firstFrontUniqueFrameOverlapPixels: frameDirectionUnique[0],
    secondFrontUniqueFrameOverlapPixels: frameDirectionUnique[1],
    sameOrderUniqueFrameOverlapPixels: frameDirectionUnique[2],
    resizedFrameParts: resizedFrameParts,
    firstFrontCandidatePairs: firstFrontCandidatePairs,
    secondFrontCandidatePairs: secondFrontCandidatePairs,
    sameOrderCandidatePairs: sameOrderCandidatePairs,
    firstFrontFrameOverlapPairs: firstFrontFrameOverlapPairs,
    secondFrontFrameOverlapPairs: secondFrontFrameOverlapPairs,
    sameOrderFrameOverlapPairs: sameOrderFrameOverlapPairs,
    frameOverlapBounds: frameOverlapMinX < Infinity ? Object.freeze({
      x: frameOverlapMinX, y: frameOverlapMinY,
      w: frameOverlapMaxX - frameOverlapMinX,
      h: frameOverlapMaxY - frameOverlapMinY }) : null,
    firstFrontFrameOverlapBounds: frameDirectionBounds(0),
    secondFrontFrameOverlapBounds: frameDirectionBounds(1),
    sameOrderFrameOverlapBounds: frameDirectionBounds(2),
    firstFrontPairs: firstFrontPairs, secondFrontPairs: secondFrontPairs,
    framePixelEventsByDirectionByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey,
          firstFrontEvents: one.framePixelEventsByDirection[0],
          secondFrontEvents: one.framePixelEventsByDirection[1],
          sameOrderEvents: one.framePixelEventsByDirection[2]
        }); }));
    })),
    uniqueFramePixelsByDirectionByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey,
          firstFrontPixels: one.uniqueFramePixelsByDirection[0],
          secondFrontPixels: one.uniqueFramePixelsByDirection[1],
          sameOrderPixels: one.uniqueFramePixelsByDirection[2]
        }); }));
    })),
    uniqueFramePixelsByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey, pixels: one.uniqueFramePixels
        }); }));
    })),
    framePixelEventsByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey, events: one.framePixelEvents
        }); }));
    })),
    frameOverlapPairParticipationByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey, pairs: one.frameOverlapPairParticipation
        }); }));
    })),
    frameOverlapPairDirectionParticipationByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey,
          firstFrontPairs: one.frameOverlapPairParticipationByDirection[0],
          secondFrontPairs: one.frameOverlapPairParticipationByDirection[1],
          sameOrderPairs: one.frameOverlapPairParticipationByDirection[2]
        }); }));
    })),
    opaquePixelEventsByDirectionByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey,
          firstFrontEvents: one.opaquePixelEventsByDirection[0],
          secondFrontEvents: one.opaquePixelEventsByDirection[1],
          sameOrderEvents: one.opaquePixelEventsByDirection[2]
        }); }));
    })),
    uniqueOpaquePixelsByDirectionByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey,
          firstFrontPixels: one.uniqueOpaquePixelsByDirection[0],
          secondFrontPixels: one.uniqueOpaquePixelsByDirection[1],
          sameOrderPixels: one.uniqueOpaquePixelsByDirection[2]
        }); }));
    })),
    uniqueOpaquePixelsByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey, pixels: one.uniqueOpaquePixels
        }); }));
    })),
    opaquePixelEventsByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey, events: one.opaquePixelEvents
        }); }));
    })),
    opaquePairParticipationByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey, pairs: one.opaquePairParticipation
        }); }));
    })),
    opaquePairDirectionParticipationByGroup: Object.freeze([0, 1].map(function (gi) {
      return Object.freeze(entries.filter(function (one) { return one.group === gi; })
        .map(function (one) { return Object.freeze({
          partKey: one.partKey,
          firstFrontPairs: one.opaquePairParticipationByDirection[0],
          secondFrontPairs: one.opaquePairParticipationByDirection[1],
          sameOrderPairs: one.opaquePairParticipationByDirection[2]
        }); }));
    })),
    opaqueOverlapPixels: overlapCount,
    opaqueOverlapBounds: overlapCount ? Object.freeze({
      x: overlapMinX, y: overlapMinY,
      w: overlapMaxX - overlapMinX + 1,
      h: overlapMaxY - overlapMinY + 1 }) : null,
    pairOpaquePixelEvents: pairPixelEvents,
    firstFrontOpaquePixelEvents: firstFrontPixelEvents,
    secondFrontOpaquePixelEvents: secondFrontPixelEvents,
    sameOrderOpaquePixelEvents: sameOrderPixelEvents,
    firstFrontUniqueOpaquePixels: directionUnique[0],
    secondFrontUniqueOpaquePixels: directionUnique[1],
    sameOrderUniqueOpaquePixels: directionUnique[2],
    firstFrontUniqueOpaqueBounds: uniqueBounds(0),
    secondFrontUniqueOpaqueBounds: uniqueBounds(1),
    sameOrderUniqueOpaqueBounds: uniqueBounds(2),
    boardOrderProven: false, displayAllowed: false };
};

/* 명시 입력의 두 지면과 한 축대만 기존 world에 비활성 진단한다.
 * 원본 MAP A/C·통행·선택·유닛 높이는 변경하지 않는다. */
Renderer.prototype.map3D지형진단 = function (spec) {
  if (this._map3dTerrainPreview) this._map3dTerrainPreview.remove();
  if (!spec) return null;
  var toggle = root.G2Map3DToggle, terrain = root.G2Map3DTerrainPreview;
  var map = this.nmap, name = this.mapx && this.mapx.sourceMap;
  if (!toggle || !terrain || !map || !name)
    return { status: 'not-admitted' };
  var shape, view;
  try {
    shape = spec.designatedTerrain
      ? terrain.designatedGeometry(map, spec.designatedTerrain) : terrain.geometry(map, spec);
    view = terrain.mount(this, shape);
  } catch (_) {
    if (view) view.remove();
    return { status: 'geometry-input-required' };
  }
  var self = this, closed = false, unsubscribe = null, extraCleanup = [];
  var handle = {
    status: 'preview-only', node: view.node,
    designated: shape.designated === true, heightScale: shape.heightScale, shape: shape,
    onRemove: function (fn) {
      if (closed) fn(); else extraCleanup.push(fn);
    },
    heightAt: function (x, y) {
      return handle.isCurrent() ? terrain.heightAt(shape, x, y) : null;
    },
    isCurrent: function () {
      return !closed && self.nmap === map && self.mapx &&
        self.mapx.sourceMap === name && view.node.isConnected &&
        toggle.resolve(name).terrainSurfaces.effective === 'preview';
    },
    remove: function () {
      if (closed) return;
      closed = true;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      extraCleanup.splice(0).forEach(function (fn) { try { fn(); } catch (_) {} });
      view.remove();
      if (self._map3dTerrainPreview === handle)
        self._map3dTerrainPreview = null;
      if (self.nmap === map && self.mapx && self.mapx.sourceMap === name &&
          toggle.resolve(name).terrainSurfaces.requested === 'preview')
        toggle.set(name, 'terrainSurfaces', 'off');
      Object.keys(self.unitEls || {}).forEach(function (id) {
        self._빌보드적용(self.unitEls[id]);
      });
      (self.objEls || []).forEach(function(e){if(e._billboardMode === 'vegetation') self._빌보드적용(e);});
      (self.fxEls || []).forEach(function (e) {
        if (e._terrainPreviewAnchor) self._빌보드적용(e);
      });
    }
  };
  try {
    toggle.set(name, 'terrainSurfaces', 'preview');
    if (!handle.isCurrent()) { handle.remove(); return { status: 'not-current' }; }
    unsubscribe = toggle.subscribe(function (changed) {
      if ((changed === null ||
          changed === String(name).replace(/\.MAP$/i, '').toUpperCase()) &&
          !handle.isCurrent()) handle.remove();
    });
    this._map3dTerrainPreview = handle;
    Object.keys(this.unitEls || {}).forEach(function (id) {
      self._빌보드적용(self.unitEls[id]);
    });
    (self.objEls || []).forEach(function(e){if(e._billboardMode === 'vegetation') self._빌보드적용(e);});
    (this.fxEls || []).forEach(function (e) {
      if (e._terrainPreviewAnchor) self._빌보드적용(e);
    });
    this._종료정리등록(handle.remove);
    return handle;
  } catch (_) {
    handle.remove(); return { status: 'not-admitted' };
  }
};

/* 현재 Source/U 완료 receipt에 실린 사용자 지정 지형만 명시적으로 미리 본다.
 * 일반 맵 생성 또는 원본 MAP 지형값에서 자동 호출하지 않는다. */
Renderer.prototype.map3D사용자지형진단 = function (surfaceId) {
  var store = this._mapSurfaceStore, gate = this._mapUPublishGate;
  var lease = store && store.currentSource();
  var completion = this._mapPrivateMapCompletion && this._mapPrivateMapCompletion();
  if (!lease || lease.map !== this.nmap || !completion || !gate ||
      typeof gate.lookupTerrain !== 'function')
    return { status: 'not-admitted' };
  var result = gate.lookupTerrain(surfaceId, lease, completion.receipt);
  if (result.status !== 'ready') return result;
  var handle = this.map3D지형진단({ areas: result.value.areas });
  if (!handle || handle.status !== 'preview-only') return handle;
  var revoke = gate.onRevoke(function () { handle.remove(); });
  handle.onRemove(revoke);
  return handle;
};

/* 현재 MAP의 사용자 건물/지형 프로필과 이미 구성된 2.5D 사물 묶음 목록.
 * 표시를 열거나 원본 지형값을 해석하지 않는다. */
/* 저장 GREEK 층/축대와 건물. 명시 비교에서만 GPU 표시, 실패 시 기존 DOM 복귀. */
Renderer.prototype.map3D지정전체미리보기 = function () {
  if (!this.mapx || !/^GREEK\.MAP$/i.test(this.mapx.sourceMap || '') ||
      this._map3dTerrainPreview || this._map3dMapxBuildingPreview)
    return {status:'not-admitted',displayAllowed:false};
  var query=new URLSearchParams(root.location ? root.location.search : '');
  // 저장 지정 지형과 건물을 함께 표시한다. 명시 GPU off는 기존 DOM 경로다.
  var terrain=this.map3D지형진단({designatedTerrain:this.mapx.terrain3d});
  if (terrain && terrain.status !== 'preview-only') return terrain;
  var buildings=this.map3D맵X건물전체미리보기();
  if (!buildings || !buildings.displayAllowed) {if(terrain)terrain.remove();return buildings;}
  var self=this;
  if(terrain)terrain.onRemove(function(){if(self._map3dGpuScene)self._map3dGpuScene.close();self.map3D맵X건물전체끄기();});
  if(root.G2Map3DGpuScene && query.get('map3dGPU')!=='off') {
    try {this._map3dGpuScene=root.G2Map3DGpuScene.mount(this,terrain,buildings);}
    catch(error){this._map3dGpuFailure=error.message;}
  }
  return {status:'preview-mounted',displayAllowed:true,terrain:terrain,buildings:buildings,
    isCurrent:function(){return (!terrain||terrain.isCurrent())&&buildings.isCurrent();},
    close:function(){if(self._map3dGpuScene)self._map3dGpuScene.close();if(terrain)terrain.remove();else self.map3D맵X건물전체끄기();}};
};

Renderer.prototype.map3D맵설정목록 = function () {
  var store = this._mapSurfaceStore, gate = this._mapUPublishGate;
  var lease = store && store.currentSource();
  var completion = this._mapPrivateMapCompletion && this._mapPrivateMapCompletion();
  var result = lease && lease.map === this.nmap && completion && gate &&
      typeof gate.listProfiles === 'function'
    ? gate.listProfiles(lease, completion.receipt)
    : { status: 'not-admitted' };
  var pairs = this._fr08TreePairs;
  var map = this.nmap;
  var groups = Array.isArray(pairs) ? pairs.filter(function (pair) {
    return pair.map === map && pair.merged && pair.merged.parentNode;
  }) : [];
  var profiles = result.status === 'ready' ? result.entries : Object.freeze([]);
  var settings = profiles.map(function (entry) {
    return Object.freeze({ kind: entry.kind, source: 'userOverride',
      surfaceId: entry.surfaceId, revision: entry.revision });
  });
  var terrain3d = this.mapx && this.mapx.terrain3d;
  if (terrain3d && terrain3d.schema === 'g2.mapx-terrain/1' &&
      Array.isArray(terrain3d.levelAreas) &&
      Array.isArray(terrain3d.retainingWallRects) &&
      terrain3d.width === (map && map.W) && terrain3d.height === (map && map.H)) {
    settings.push(Object.freeze({ kind: 'terrainStage', source: 'mapx',
      status: terrain3d.status,
      areaCount: terrain3d.levelAreas.length,
      retainingWallCount: terrain3d.retainingWallRects.length }));
  }
  groups.forEach(function (pair, index) {
    settings.push(Object.freeze({ kind: 'objectGroup', source: 'existing2D',
      ordinal: index, cellCount: Array.isArray(pair.cells) ? pair.cells.length : 0 }));
  });
  return Object.freeze({ status: result.status,
    profiles: profiles, existingObjectGroups: groups.length,
    settings: Object.freeze(settings) });
};

Renderer.prototype.map3D지형높이후보 = function (x, y) {
  var handle = this._map3dTerrainPreview;
  return handle ? handle.heightAt(x, y) : null;
};

/* 기존 나무 묶음은 기본 2.5D 표시 경로다. objectGroups preview는 이 경로의
 * 현재 조각 소속을 읽기만 하며 판·행 순서·숨김 상태를 바꾸지 않는다. */
Renderer.prototype.map3D사물묶음미리보기 = function () {
  this.map3D사물묶음끄기();
  var toggle = root.G2Map3DToggle, map = this.nmap;
  var name = this.mapx && this.mapx.sourceMap, pairs = this._fr08TreePairs;
  if (!toggle || !map || !name || !Array.isArray(pairs) || !pairs.length ||
      !pairs.every(function (pair) { return pair.map === map &&
        pair.merged && pair.merged.parentNode && Array.isArray(pair.cells); }))
    return { status: 'not-admitted' };
  var self = this, closed = false, unsubscribe = null;
  var groups = Object.freeze(pairs.map(function (pair) {
    return Object.freeze(pair.cells.map(function (cell) {
      return Object.freeze({ x: cell.x, y: cell.y });
    }));
  }));
  var handle = {
    status: 'preview-only', groups: groups,
    isCurrent: function () {
      return !closed && self.nmap === map && self._fr08TreePairs === pairs &&
        self.mapx && self.mapx.sourceMap === name &&
        toggle.resolve(name).objectGroups.effective === 'preview' &&
        pairs.every(function (pair) { return pair.map === map &&
          pair.merged && pair.merged.parentNode; });
    },
    remove: function () {
      if (closed) return;
      closed = true;
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      if (self._map3dObjectGroupPreview === handle)
        self._map3dObjectGroupPreview = null;
      if (self.nmap === map && self.mapx && self.mapx.sourceMap === name &&
          toggle.resolve(name).objectGroups.requested === 'preview')
        toggle.set(name, 'objectGroups', 'off');
    }
  };
  try {
    toggle.set(name, 'objectGroups', 'preview');
    if (!handle.isCurrent()) { handle.remove(); return { status: 'not-current' }; }
    unsubscribe = toggle.subscribe(function (changed) {
      if ((changed === null ||
          changed === String(name).replace(/\.MAP$/i, '').toUpperCase()) &&
          !handle.isCurrent())
        handle.remove();
    });
    this._map3dObjectGroupPreview = handle;
    this._종료정리등록(handle.remove);
    return handle;
  } catch (_) {
    handle.remove(); return { status: 'not-admitted' };
  }
};

Renderer.prototype.map3D사물묶음끄기 = function () {
  if (!this._map3dObjectGroupPreview) return false;
  this._map3dObjectGroupPreview.remove();
  return true;
};

/** FR08 나무 묶음은 카메라만 바뀔 때 DOM 을 다시 만들지 않고 표시 집합만 바꾼다. */
Renderer.prototype._FR08나무표시적용 = function () {
  var flat = !(this.cam && (this.cam.tilt || this.cam.rot));
  var buildingPreview = this._map3dMapxBuildingPreview;
  var previewIndices = buildingPreview && buildingPreview._silhouetteActive
    ? buildingPreview.silhouetteGroups || [buildingPreview.silhouetteGroup] : [];
  var modeKey = (flat ? 'flat' : 'raised') + ':' + previewIndices.join(',');
  if (this._fr08TreeModeKey === modeKey) return;
  this._fr08TreeModeKey = modeKey;
  this._fr08TreeFlat = flat;
  var self = this;
  function 표시(e, 값) {
    // 맵가리기가 직접 숨긴 조각은 새 FR08 상태를 복원값에만 반영한다.
    // strip/flatObjLayer 자식은 부모가 숨기므로 자식 display 는 그대로 갱신한다.
    if (self._맵가림 && e._옛display !== undefined) {
      e._옛display = 값;
      e.style.display = 'none';
    } else e.style.display = 값;
  }
  (this._fr08TreePairs || []).forEach(function (pair) {
    var showMerged = !flat && (pair.previewBuildingIndex == null ||
      previewIndices.includes(pair.previewBuildingIndex));
    표시(pair.merged, showMerged ? '' : 'none');
    /* 숨김은 두 쪽이 따로 건다 — 묶음(_묶음숨김)·줄 굽기(_세움숨김 · Z-75). 하나라도 숨기면 숨긴다 (2026-10-04)
     *   구조물 조각은 두 쪽이 다 만지므로 한쪽이 덮어쓰면 기울일 때 조각과 판이 겹쳐 보인다 */
    pair.legacy.forEach(function (e) { e._묶음숨김 = showMerged; 표시(e, (e._묶음숨김 || e._세움숨김) ? 'none' : ''); });
  });
};

/** 오브젝트 — mapObjects + decodeBlock + MAPX 분류. _buildObjects 의 native 판. */
Renderer.prototype._원본맵오브젝트짓기 = function () {
  this.map3D사물묶음끄기();
  // 현재 프레임 순서 숫자는 옛 애니 DOM의 적용 URL을 증거로 쓴다.
  // 팔레트 fallback과 같은 MAP SCE 재구성 모두 새 대상 등록 전에 폐기한다.
  var 순서초안 = root.G2Map3DUAuthoringDraft;
  if (순서초안 && typeof 순서초안.onObjectAnimationChanged === 'function')
    Object.keys(this.animObjEls || {}).forEach(function (bi) {
      try { 순서초안.onObjectAnimationChanged(this, Number(bi)); } catch (_) {}
    }, this);
  var self = this, objs = root.G2Native.mapObjects(this.nmap), tall = [], 큰눕힘들 = [], foldY = this._foldY || 0;   /* 큰눕힘들 — 정본 253 큰 눕힘 합치기 */
  var fr08Groups = null, fr08ByPart = new Map(), fr08Tall = new Set();
  try { fr08Groups = this._FR08나무묶음찾기(objs); }
  catch (error) {
    /* 명시 묶음 표 한 건의 오류가 기존 평면/flat MAP 조각을 지우지 않게 한다. */
    console.warn('[맵] 오브젝트 묶음 탐색 실패; 기존 2D 조각 유지:', error);
  }
  if (root.G2Map3DMapxObjectGroups)
    fr08Groups = root.G2Map3DMapxObjectGroups.groups(
      this.mapx, this.nmap, objs, fr08Groups,
      this._원본오브젝트분류.bind(this), root.G2Native);
  this._fr08TreePairs = []; this._fr08TreeFlat = null; this._fr08TreeModeKey = null;
  if (fr08Groups) fr08Groups.forEach(function (g) {
    Object.keys(g.parts).forEach(function (k) { fr08ByPart.set(g.parts[k], g); });
  });
  /* 묶음 조각이 기울기 0 에서 그려지는 요소를 모은다 — 세움 띠의 조각·눕힘 조각·구조물 어느 것이든 (2026-10-03)
   *   요소가 없는 조각(바닥에 구운 것)이 하나라도 있으면 그 묶음은 판으로 안 바꾼다 — 둘이 겹쳐 보이지 않게 */
  function 옛조각(o, e) { var gg = fr08ByPart.get(o); if (!gg) return;
    (gg._legacy = gg._legacy || []).push(e);
    (gg._legacySources = gg._legacySources || []).push({ source: o, element: e });
    gg._legacyN = (gg._legacyN | 0) + 1; }
  /* ★★★ **오브젝트 애니메이션**(원본 `0x7D824` · 진행기 `0x10A30`) — 2026-08-16
   *
   *   사용자: 「여기에는 필드에 **풀들이 움직이는 효과**가 있던걸로 기억해」(P01).
   *   바닥 애니(`0x7EBAC`)만 구현돼 있었는데, **표가 둘**이고 오브젝트 쪽이
   *   통째로 빠져 있었다. 맵마다 어느 쪽을 쓰는지가 다르다:
   *     `FR08` 폭포 = 바닥 9종 · `P01` 풀 = **오브젝트 10종 50칸** ·
   *     `AST` 8종 66칸 · `PAN` 8종 52칸
   *   `FR08` 만 보고 만든 탓이다(`fx.js` 주석에도 「지금 맵은 오브젝트 표가
   *   비어 있어」라고 적혀 있었다 — 그 맵만 보면 맞는 말이었다).
   *
   *   여기서는 **애니 블록으로 그려진 조각을 모아 두기만** 한다.
   *   프레임 교체는 `fx.js 오브젝트애니()` 가 한다. */
  var bAnim = (this.nmap && this.nmap.blockAnim) || null;
  this.animObjEls = {};                       // 블록번호 → [요소…]
  function 애니블록(bi) { var a = bAnim && bAnim[bi]; return !!(a && a.length > 1); }
  function 담기(bi, el2, w2, h2, 밑변, 이음새) {
    if (!애니블록(bi)) return;
    (self.animObjEls[bi] = self.animObjEls[bi] || []).push({ el: el2, w: w2, h: h2,
      bottom: 밑변, seam: 이음새 || 0 });
  }
  objs.forEach(function (o) {
    if (o.y < foldY) {
      /* ══════════════════════════════════════════════════════════════
       *  ★★★★★ **접어 올린 부분의 오브젝트 애니메이션** (2026-08-24)
       *
       *  사용자 지정: 「접히는 부분 애니메이션이 있는건 지금 기존 전투에서는
       *  **해당 타일을 위에 별도로 덧붙이는 형식**으로 해서 적용이 되었는데,
       *  **mapx 처리에서 접힌부분 애니메이션도 같이 처리**되면 좋겠어.
       *  **따로 하드코딩 하지 않고.**」 · 「**fr08맵 처럼 접어올린 부분에
       *  애니메이션이 있는경우**」
       *
       *  접는선 위는 `_가로띠합성(..., true)` 로 **한 장에 구워** 배경벽이 된다.
       *  구운 그림은 **첫 프레임에서 멈춘다** — 갈아 끼울 요소가 없기 때문이다.
       *
       *  ★ **타일 애니는 이미 같은 문제를 풀어 놨다** — `tileCell()` 이
       *    `y < foldY` 면 `backdropEl` 에 칸을 덧붙인다(그 함수 주석의 FR08 폭포).
       *    **오브젝트 애니에는 그 처리가 없었다.** 여기서 같은 수법을 쓴다.
       *
       *  ★ 배경벽은 `left:-mapW/2 · top:-mapH/2` 에 놓인 요소라 **그 안의 지역
       *    좌표는 그냥 `(x*TW, y*TH)`** 다(빼지 않는다). 부모가 `rotateX` 되므로
       *    함께 세워진다. 같은 평면이라 z 다툼이 나므로 살짝 띄운다.
       *
       *  ★ **맵마다 예외를 넣지 않는다** — 애니 블록인지만 보고 자동으로 붙인다.
       * ══════════════════════════════════════════════════════════════ */
      if (!self.backdropEl || !애니블록(o.blockIndex)) return;
      var ub = self._블록그림URL(o.blockIndex); if (!ub) return;
      var be = el('div', 'g2-backdrop-anim', self.backdropEl);
      be.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
        'left:' + (o.x * TW) + 'px;' +
        'top:'  + (o.y * TH + TH - o.frame.h) + 'px;' +
        'width:' + o.frame.w + 'px;height:' + o.frame.h + 'px;' +
        'transform:translateZ(0.05px);' +          /* 구운 그림과 같은 평면 — 살짝 띄운다 */
        bgcss(ub, o.frame.w, o.frame.h);
      담기(o.blockIndex, be, o.frame.w, o.frame.h);
      return;
    }
    var kind = self._원본오브젝트분류(o.blockIndex, o.height);
    if (kind === 'flat') {
      /* ★★★★★★★ **여러 행에 걸치는 눕힘은 「대열」에 올린다** (2026-09-04 · 사용자 지정)
       *
       *   > 사용자: 「**집 지붕위로 캐릭터가 올라감** — 원작에서는 지붕 뒷편 바닥
       *   >  기준이라 이동은 가능하고 **지붕에 가려짐**」
       *   > 「**전투에 적용되는 2.5d 맵에도 동일하게 적용**되어야해」
       *   > 선택: 「**누운 것도 개별 조각으로 대열에 (마을과 같게)**」
       *
       *   ☠ 눕힘은 「기울일 때 빌보드가 어긋나니 지면에 눕힌다」는 뜻일 뿐
       *     **앞뒤와 무관하다.** 구우면 대열에서 빠져 **늘 캐릭터 아래**가 된다.
       *
       *   ★ `useNativeMap`(1249 줄)과 행별 오버레이(1004 줄)에서 `h > 16` 을
       *     빼 두었으므로 **여기서 그린다.** 눕힌 모양 그대로(빌보드로 안 세운다)
       *     `flatObjLayer` 가 아니라 **`objLayer`(= spriteLayer)** 에 넣어
       *     `_sortSprites()` 의 `_row`·`_kind` 대열에 참여시킨다.
       *   ★★ `_billboardMode = 'floor'` — 행별 오버레이(1043 줄)와 같은 모드다.
       *     `_빌보드적용` 가 `transform: none` 을 주므로 **눕힌 채로** 남는다.
       *     그래서 사용자가 「덩어리가 어긋나서 눕혀 놨다」고 한 것이 그대로 지켜진다.
       *
       *   실측 (SCENARIO 231 장) — 여기로 오는 것 **평균 68 · 최다 772**(CYRUPS).
       *   전부 올리면 평균 263 · 최다 1483 이라 4 배 무겁다. */
      var 큰눕힘 = (o.height > TH) && !self._애니블록(o.blockIndex);
      if (큰눕힘) {
        /* [리마스터] 정본 253 — 요소는 반복 뒤 «큰 눕힘 합치기»가 만든다(같은 줄·같은 높이로 붙은 조각은 한 장 · 혼자면 예전 그대로) */
        큰눕힘들.push(o);
        return;
      }
      /* ★ 눕힘이지만 **움직이는** 블록 — 바닥에 굽지 않았으므로(useNativeMap)
       *   여기서 **눕힌 요소**로 만든다. 세우지 않으니 모양은 구운 것과 같고,
       *   요소가 있으니 `fx.js 오브젝트애니()` 가 프레임을 갈아 끼울 수 있다. */
      /* ★★★ 2026-08-27 — **움직이는 블록만** 여기 올리던 것을 넓혔다.
       *   가만히 있는 눕힘 오브젝트도 **애니 타일이 깔린 칸** 위에 있으면
       *   지면에 구워 봐야 애니가 덮어 버린다(사용자: 「칼로 자른것처럼 직각」).
       *   그런 칸은 여기서 요소로 만들어 **애니 타일보다 위**에 놓는다.
       *   `flatObjLayer` 는 `groundLayer` 안에서 애니 타일 **뒤에** 붙는 층이라
       *   순서가 원본(타일 → 오브젝트)과 같아진다. */
      var 애니칸 = self._애니깔린칸();
      var 덮일자리 = !!(애니칸 && 애니칸[o.x + ',' + o.y]);
      if (!self._애니블록(o.blockIndex) && !덮일자리) return;
      var u = self._블록그림URL(o.blockIndex); if (!u) return;
      var fe = el('div', 'g2-map-flatanim', self.flatObjLayer);
      fe.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
        'left:' + (o.x * TW - self.mapW / 2) + 'px;' +
        'top:'  + (o.y * TH + TH - o.frame.h - self.mapH / 2) + 'px;' +
        'width:' + o.frame.w + 'px;height:' + o.frame.h + 'px;' +
        bgcss(u, o.frame.w, o.frame.h);
      담기(o.blockIndex, fe, o.frame.w, o.frame.h);
      옛조각(o, fe);
      return;
    }
    var url = self._블록그림URL(o.blockIndex); if (!url) return;
    if (kind === 'structure') {                                  // 벽·성문 — 격자고정 수직면
      var s = el('div', 'g2-map-structure', self.objLayer);
      s.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
        'transform-origin:50% 100%;width:' + o.frame.w + 'px;height:' + o.frame.h + 'px;' +
        bgcss(url, o.frame.w, o.frame.h);
      self._빌보드놓기(s, o.x * TW, o.y * TH + TH, o.frame.h);
      s._billboardMode = 'vegetation';                            // 기울기만 반영(카메라 Z 안 좇음)
      s._sortY = o.y * TH + TH; s._row = o.y | 0; s._col = o.x | 0; s._kind = 0; self.objEls.push(s);
      담기(o.blockIndex, s, o.frame.w, o.frame.h);
      옛조각(o, s);
      return;
    }
    tall.push(o);                                                // billboard(나무·수풀) — 스트립 묶음
    if (fr08ByPart.has(o)) fr08Tall.add(o);
  });
  /* ★ [리마스터] 정본 253 — 큰 눕힘 합치기: 같은 줄·같은 높이로 나란히 붙은 조각은 한 장(한 그림)으로 그린다
   *   (2026-11-16 사장님 「fr시리즈 중 나무 길게 위로 솟아있는 맵 오브젝트 크기 보정 관련해서 깨지는 것 같아. 확인해줘.」·「fr04」 · 9-9 외눈의 용병)
   *   ☠ 조각(24×96 줄기 등)마다 따로 그림을 만들어 스케일러(xBRZ)도 조각마다 걸렸다 — 조각 경계에서 옆 화소를 못 봐 뿌리 대각선이 열마다 끊겨
   *     계단·세로 이음선이 났다(FR04 34~37열 높은 나무 · 서 있는 나무 띠는 1px 겹침으로 가렸지만 눕힘엔 그것도 없었다 · 원본은 화면 버퍼에 그대로 찍어 이음선이 없다)
   *   ⇒ 한 덩어리 번호판을 한 번에 키운다 · 혼자인 조각은 예전 그대로 · 팔레트 다시 칠하기(_오브젝트색칠하기)는 _블록URL역 의 «합키»로 합친 판을 칠한다 */
  큰눕힘들.sort(function (a, b) { return a.y - b.y || a.frame.h - b.frame.h || a.x - b.x; });
  var 큰무리 = [];
  큰눕힘들.forEach(function (o) {
    var g = 큰무리[큰무리.length - 1];
    if (!g || g.y !== o.y || g.h !== o.frame.h || g.끝px !== o.x * TW) { g = { y: o.y, h: o.frame.h, 끝px: 0, 들: [] }; 큰무리.push(g); }
    g.들.push(o); g.끝px = o.x * TW + o.frame.w;
  });
  /* 위아래로 겹치거나 맞닿고 열 범위가 같은 무리도 한 장으로 — 높은 나무 줄기(FR04 13·16·20줄 세 덩이)는 덩이 경계에서도 계단이 났다
   *   정렬 줄 = 맨 아래 덩이의 줄 · 칠하는 차례는 원본 줄 루프(0x12BEE)처럼 위 줄 먼저 → 아래 줄이 위에 덮는다 */
  큰무리.forEach(function (g) { var o0 = g.들[0]; g.x0 = o0.x * TW; g.위 = o0.y * TH + TH - g.h; g.아래 = o0.y * TH + TH; });
  큰무리.sort(function (a, b) { return a.x0 - b.x0 || a.끝px - b.끝px || a.y - b.y; });
  var 세로묶음 = [];
  큰무리.forEach(function (g) {
    var m = 세로묶음[세로묶음.length - 1];
    if (m && m.x0 === g.x0 && m.끝px === g.끝px && g.위 <= m.아래 && g.들.length > 1 && m.무리[0].들.length > 1) { m.무리.push(g); m.아래 = Math.max(m.아래, g.아래); m.위 = Math.min(m.위, g.위); }
    else 세로묶음.push({ x0: g.x0, 끝px: g.끝px, 위: g.위, 아래: g.아래, 무리: [g] });
  });
  큰무리 = 세로묶음.map(function (m) {
    if (m.무리.length === 1) return m.무리[0];
    var 들 = []; m.무리.forEach(function (g) { 들 = 들.concat(g.들); });
    var 맨아래 = m.무리[m.무리.length - 1].들[0];
    return { y: 맨아래.y, h: m.아래 - m.위, 끝px: m.끝px, 들: 들, x0: m.x0, 위: m.위, 아래: m.아래, 세로: true };
  });
  큰무리.forEach(function (g) {
    var 첫 = g.들[0], gx0 = 첫.x * TW, gw = g.끝px - gx0, gh = g.h, 위 = (g.위 != null) ? g.위 : (첫.y * TH + TH - gh), url = null;
    if (g.세로) 첫 = g.들.reduce(function (a, o) { return (o.y > a.y || (o.y === a.y && o.x < a.x)) ? o : a; }, g.들[0]);   /* 정렬 줄·이름은 맨 아래 덩이 */
    if (g.들.length > 1) {
      var 판 = { w: gw, h: gh, idx: new Int16Array(gw * gh), tr: -1 };
      for (var i0 = 0; i0 < 판.idx.length; i0++) 판.idx[i0] = -1;
      g.들.slice().sort(function (a, b) { return a.y - b.y || a.x - b.x; }).forEach(function (o) {   /* 위 줄 먼저 → 아래 줄이 덮는다 */
        var fr = o.frame, ox = o.x * TW - gx0, oy = o.y * TH + TH - fr.h - 위;
        for (var yy = 0; yy < fr.h; yy++) { var ry = oy + yy; if (ry < 0 || ry >= gh) continue;
          for (var xx = 0; xx < fr.w; xx++) {
            var v = fr.idx[yy * fr.w + xx], rx = ox + xx; if (v >= 0 && rx >= 0 && rx < gw) 판.idx[ry * gw + rx] = v;
          } }
      });
      var 합캔 = root.G2Native.frameToCanvas(판, self.nmap.palette);
      if (합캔) {
        url = 합캔.toDataURL();
        var 합키 = 'h' + 첫.y + '_' + 첫.x + '_' + gh;
        (self._큰눕힘판 || (self._큰눕힘판 = {}))[합키] = 판;
        (self._블록URL역 || (self._블록URL역 = {}))[url] = { bi: 첫.blockIndex, 합키: 합키, w: gw, h: gh };
        if (!self._palSaved && !self._음영바탕 && root.G2Scaler && root.G2Scaler.N() > 1) {   /* 팔레트 GPU 판의 바탕 — _블록그림URL 과 같은 규칙 */
          if (self.nmap._블록바탕필터 !== root.G2Scaler.cur()) { self.nmap._블록바탕 = {}; self.nmap._블록바탕필터 = root.G2Scaler.cur(); }
          var 블표 = self.nmap._블록바탕 || (self.nmap._블록바탕 = {});
          블표[root.G2Scaler.cur() + '|' + 합키] = { cv: 합캔, pal: self.nmap.palette, 필터: root.G2Scaler.cur() };
        }
      }
    }
    if (!url) {   /* 혼자이거나 합치기 실패 — 예전처럼 조각마다 */
      g.들.forEach(function (o) {
        var fu = self._블록그림URL(o.blockIndex); if (!fu) return;
        var fq = el('div', 'g2-map-flatpiece', self.objLayer);
        fq.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
          'left:' + (o.x * TW - self.mapW / 2) + 'px;' +
          'top:'  + (o.y * TH + TH - o.frame.h - self.mapH / 2) + 'px;' +
          'width:' + o.frame.w + 'px;height:' + o.frame.h + 'px;' +
          bgcss(fu, o.frame.w, o.frame.h);
        fq._billboardMode = 'floor';       /* ★ 세우지 않는다 — 눕힌 채로 (5849 줄) */
        fq._sortY = o.y * TH + TH;
        fq._row = o.y | 0; fq._col = o.x | 0;   /* _col — 원본 열 범위 규칙(0x10D4E 13열) */
        fq._kind = 0;                      /* 목록 A — 같은 행에서 유닛보다 먼저 */
        self.objEls.push(fq);
        담기(o.blockIndex, fq, o.frame.w, o.frame.h);
        옛조각(o, fq);
      });
      return;
    }
    var gq = el('div', 'g2-map-flatpiece g2-map-flatpiece-합', self.objLayer);
    gq.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
      'left:' + (gx0 - self.mapW / 2) + 'px;top:' + (위 - self.mapH / 2) + 'px;' +
      'width:' + gw + 'px;height:' + gh + 'px;' + bgcss(url, gw, gh);
    gq._billboardMode = 'floor'; gq._sortY = 첫.y * TH + TH;
    gq._row = 첫.y | 0; gq._col = 첫.x | 0; gq._kind = 0; gq._합열 = g.들.map(function (o) { return o.x | 0; });
    self.objEls.push(gq);
    g.들.forEach(function (o) { 옛조각(o, gq); });
  });
  /* 나무·수풀: 같은 행·높이의 연속 조각을 한 스트립으로 (원점 어긋남 방지) */
  tall.sort(function (a, b) { return a.y - b.y || a.frame.h - b.frame.h || a.x - b.x; });
  var strips = [];
  tall.forEach(function (o) {
    /* 가로등처럼 화면을 향해야 서 있는 원천만 mapx에서 지정한다.
     * 같은 행의 상자·나무와 한 띠로 합치면 이 회전이 함께 걸리므로 띠를 나눈다. */
    var facing = root.G2Map3DMapxObjectGroups &&
      typeof root.G2Map3DMapxObjectGroups.explicitFacing === 'function' &&
      root.G2Map3DMapxObjectGroups.explicitFacing(self.mapx, self.nmap,
        o.blockIndex, root.G2Native, o.x, o.y);
    var s = strips[strips.length - 1];
    /* 명시 카메라 향함은 조각마다 자기 밑변을 중심으로 돌린다. 서로 다른
     * 상자·항아리나 반복된 같은 사물을 한 판으로 묶으면 판 중심에서 함께 돈다. */
    if (!s || facing === 'camera' || facing === 'world' || s.y !== o.y || s.h !== o.frame.h || s.endX !== o.x ||
        s.facing !== facing) {
      s = { x: o.x, endX: o.x, y: o.y, h: o.frame.h, facing: facing,
        parts: [] }; strips.push(s);
    }
    s.parts.push(o); s.endX = o.x + Math.max(1, Math.ceil(o.frame.w / TW));
  });
  strips.forEach(function (s) {
    var width = (s.endX - s.x) * TW;
    var e = el('div', 'g2-map-object-strip', self.objLayer);
    e.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
      'transform-origin:50% 100%;width:' + width + 'px;height:' + s.h + 'px;';
    s.parts.forEach(function (o, pi) {
      var part = el('span', 'g2-map-object', e);
      /* 조각 사이 1px 겹침 — 인접 나무 조각 경계 이음새 제거 (마지막 조각 제외). */
      var pw = o.frame.w + (pi < s.parts.length - 1 ? 1 : 0);
      part.style.cssText = 'position:absolute;left:' + ((o.x - s.x) * TW) + 'px;top:0;' +
        'width:' + pw + 'px;height:' + o.frame.h + 'px;' +
        bgcss(self._세움그림URL(o), o.frame.w, o.frame.h);   /* [리마스터] 무덤 가시면 바닥 점을 뺀 그림 */
       담기(o.blockIndex, part, o.frame.w, o.frame.h, o.frame.h,
         pi < s.parts.length - 1 ? 1 : 0);
      part._col = o.x | 0; (e._colParts = e._colParts || []).push(part);   /* 원본은 칸마다 따로 그린다 — 열 범위 규칙은 조각마다 */
      옛조각(o, part);
    });
    self._빌보드놓기(e, s.x * TW, s.y * TH + TH, s.h);
    e._billboardMode = s.facing === 'camera' ? null : 'vegetation';
    e._sortY = s.y * TH + TH; e._row = s.y | 0; e._kind = 0; self.objEls.push(e);
  });
  /* FR08 검토 템플릿의 실제 조각만 120×112 판에 원래 상대좌표로 놓는다.
   * 평면 2D는 위에서 만든 기존 행별 span을 그대로 표시하고, 카메라를 기울이거나
   * 돌릴 때만 공통 앞행 pivot 판으로 바꾼다. 두 집합 모두 개별 span 애니를 유지한다. */
  (fr08Groups || []).forEach(function (g) {
    var members = Object.keys(g.parts).map(function (k) { return g.parts[k]; });
    var made = [];
    try {
    /* 조각마다 기울기 0 요소가 꼭 하나 — 세움(띠)이든 눕힘이든 (예전엔 «전부 세움»일 때만 묶었다) */
    if (!members.length || (g._legacyN | 0) !== members.length) return;
    /* ★ 판 크기는 틀에서 — 칸 (dx,dy) 조각의 밑변 = (dy+1)·TH, 윗변 = 밑변 − 높이 (2026-10-02 · 5×2 FR08 은 120×112 그대로 나온다) */
    var GW = g.W || 5, assets = [], 위 = Infinity, 아래 = 0, 폭 = 0;
    for (var n = 0; n < GW * (g.H || 2); n++) {
      var o = g.parts[n]; if (!o) continue;
      var url = self._블록그림URL(o.blockIndex); if (!url) return;
      var adx = n % GW, ady = (n / GW) | 0, 밑 = (ady + 1) * TH;
      위 = Math.min(위, 밑 - o.frame.h); 아래 = Math.max(아래, 밑); 폭 = Math.max(폭, adx * TW + o.frame.w);
      assets.push({ o: o, n: n, dx: adx, dy: ady, url: url });
    }
    if (!assets.length) return;
    폭 = Math.max(폭, GW * TW); 아래 = Math.max(아래, (g.H || 2) * TH);    /* 조각이 빠진 묶음도 판·밑변·돌림 중심은 틀 크기대로 (예전 120×112 와 같게) */
    var 판높 = 아래 - 위;
    /* 혼합 지붕·벽 원본 윤곽은 판 전체를 마지막 원천 행으로 정렬하면
     * 뒤쪽 지붕이 앞쪽 울타리까지 덮는다. 같은 회전 중심과 원천 좌표를
     * 공유하는 행별 투명 판으로 나눠 기존 spriteLayer 행 정렬을 쓴다. */
    var silhouette = g.presentation === 'buildingSilhouette';
    var rows = silhouette
      ? Array.from(new Set(assets.map(function (a) { return a.o.y; }))).sort(function (a, b) { return a - b; })
      : [null];
    rows.forEach(function (row) {
      var selected = row === null ? assets : assets.filter(function (a) { return a.o.y === row; });
      var e = el('div', 'g2-map-tree-composite', self.objLayer); made.push(e);
      e.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
        'transform-origin:50% ' + (판높 - (g.contactInsetPx || 0)) + 'px;width:' + 폭 + 'px;height:' + 판높 + 'px;';
      selected.forEach(function (a) {
        var child = el('span', 'g2-map-object', e), dx = a.dx, dy = a.dy;
        child._col = a.o.x | 0; child._row = a.o.y | 0;
        (e._colParts = e._colParts || []).push(child);
        child.style.cssText = 'position:absolute;left:' + (dx * TW) + 'px;top:' + ((dy + 1) * TH - a.o.frame.h - 위) + 'px;' +
          'width:' + a.o.frame.w + 'px;height:' + a.o.frame.h + 'px;' +
          bgcss(a.url, a.o.frame.w, a.o.frame.h);
        담기(a.o.blockIndex, child, a.o.frame.w, a.o.frame.h,
          (dy + 1) * TH - 위);
      });
      self._빌보드놓기(e, g.x * TW, g.y * TH + 아래, 판높);
      e._billboardMode = g.facing === 'camera' ? null : 'vegetation';
      e._sortY = row === null ? g.y * TH + 아래 : (row + 1) * TH;
      e._row = row === null ? (g.y + ((아래 / TH) | 0) - 1) | 0 : row;
      e._kind = 0; self.objEls.push(e);
      self._fr08TreePairs.push({ merged: e,
        legacy: row === null ? g._legacy || [] : (g._legacySources || []).filter(function (part) {
          return part.source.y === row;
        }).map(function (part) { return part.element; }),
        map: self.nmap, previewBuildingIndex: g.previewBuildingIndex,
        cells: selected.map(function (a) { return { x: a.o.x, y: a.o.y }; }) });
    });
    } catch (error) {
      /* 판 일부가 붙은 뒤 실패해도 기존 평면/flat 조각은 그대로 남긴다. */
      made.forEach(function (e) {
        Object.keys(self.animObjEls).forEach(function (bi) {
          var kept = self.animObjEls[bi].filter(function (item) {
            return Array.prototype.indexOf.call(e.children, item.el) < 0;
          });
          if (kept.length) self.animObjEls[bi] = kept;
          else delete self.animObjEls[bi];
        });
        var oi = self.objEls.indexOf(e);
        if (oi >= 0) self.objEls.splice(oi, 1);
        self._fr08TreePairs = self._fr08TreePairs.filter(function (pair) { return pair.merged !== e; });
        if (e.parentNode) e.parentNode.removeChild(e);
      });
      console.warn('[맵] 오브젝트 묶음 판 생성 실패; 기존 2D 조각 유지:', error);
    }
  });
  this._FR08나무표시적용();
};

/**
 * 스케일러가 바뀌거나 시트 확대가 준비되면 화면 자산을 다시 굽는다.
 * 배치 좌표계는 그대로이므로 **그림만** 다시 만든다. (여러 번 불려도 한 번만)
 */
/**
 * 스케일러가 바뀌면 자기 그림을 새 배율로 다시 굽는다.
 * @param {boolean} [즉시] `true` 면 **지연 없이 지금** 굽는다 — 전환 관문
 *   (`전투.html` 의 스케일러 차단막)이 화면을 가린 뒤에 부르므로 미룰 이유가 없다.
 *   기본(지연 50ms)은 연속 호출을 합치기 위한 것이다.
 */
Renderer.prototype.rebuildForScaler = function (즉시) {
  var self = this;
  function 본작업() {
    self._rebuildT = null;
    var map3dAgain = self._map3dPreview && self._map3dPreview.spec;
    self._blkCache = {};
    /* ★★★★★ **바닥 애니 타일 캐시도 비운다** (2026-08-30 · 사용자 지적 #15)
     *
     *   ☠ `_blkCache`(레이어B 블록)만 비우고 **`_tileURLCache`(레이어A 타일)는
     *     안 비웠다.** 배율을 바꿔도 먼저 구운 **1배 그림이 그대로 남아**
     *     용암 같은 애니 타일이 다른 배율 화면에 1배로 섞였다.
     *     (사용자: 「스케일러 적용시 킬러 등장효과 애니메이션 타일(용암) 깨져」)
     *
     *   `tileUrl()`(280줄)이 담는 창고다 — `fx.js:1205` 의 바닥 애니가 쓴다. */
    self._tileURLCache = {};
    /* ★ 그림자 캐시는 **키에 N·팔레트가 들어 있어** 저절로 갈린다(`_shadowKey`).
     *   그래도 옛 세대가 메모리에 남지 않도록 여기서 비운다. */
    self._shdURL = {};
    /* 유닛 프레임 그림도 새 배율로 다시 굽습니다 (원본 프레임 자체는 그대로) */
    self._uurl = {}; self._uspr = {}; self._footCache = {}; self._silCache = {};
    /* 상태이상 이펙트도 새 배율로 다시 굽는다 — 원본 프레임(_effcRaw)은 그대로 */
    self._effcURL = {};
    if (self._effcRaw && self._palette)
      self._effc = root.G2Native.spriteCanvasProvider(self._effcRaw, self._palette);
    Object.keys(self.unitEls).forEach(function (k) {
      var e = self.unitEls[k];
      if (e && e.parentNode) e.parentNode.removeChild(e);
      delete self.unitEls[k];
    });
    if (self.nmap) self.useNativeMap(self.nmap, self.mapx);      // 맵·바닥·오브젝트 재생성
    if (map3dAgain) { try { self.map3D건물진단(map3dAgain.source, map3dAgain.building,
      map3dAgain.policy, map3dAgain.options); }
      catch (e3d) { console.warn('[맵3D preview] 스케일러 재구성 실패:', e3d && e3d.message); } }
    if (self.b && self.b.units) self.b.units.forEach(function (u) { self.updateUnit(u); });
    self.apply();
  }
  if (즉시) {
    if (this._rebuildT) { this._시간취소(this._rebuildT); this._rebuildT = null; }
    본작업();
    return;
  }
  if (this._rebuildT) return;
  /* [원본없음] — 여러 번 들어온 다시그리기 요청을 **한 번으로 묶는** 지연이다.
   * 원본은 프레임마다 통째로 다시 그려 이런 묶기가 없다. */
  this._rebuildT = this._시간예약(본작업, 50);
};

/**
 * 앞뒤 가림 정렬 — **원본은 픽셀 y 가 아니라 「타일 행」 단위**입니다.
 *
 * ```
 * 0x12BEE  루프 edi = 0..0x10 (17행)
 *            0x10CBD 오브젝트 한 행 · 0x12567 유닛 한 행 · 0x18605 이펙트 한 행
 *            → 그 행의 목록을 즉시 출력  (한 행씩 수집→출력이라 자연히 y 정렬)
 * 0x12567  유닛 수집 조건 = `[유닛+1]`(**타일 y**)가 현재 행과 같은가
 * ```
 * 즉 정렬 키는 **타일 y 하나뿐**이고, 픽셀 오프셋이나 스프라이트 높이는
 * 들어가지 않습니다. 같은 행 안에서는 출력 순서가 **오브젝트 → 유닛**입니다.
 *
 * ★ 예전엔 `_ground`(= 박스 아래끝 픽셀)로 정렬했습니다. 그 값은 캐릭터마다
 *   다른 **격자 높이**가 섞인 값이라, 같은 행에 서 있어도 격자가 큰 캐릭터가
 *   더 아래로 판정돼 앞으로 나왔습니다 — 「뒤에 있는 캐릭터가 앞 캐릭터를
 *   가리는」 증상. 나무는 타일 밑변 기준이라 유닛과 기준 자체가 달라
 *   「나무 뒤에 섰는데 안 가려지는」 증상이 같이 났습니다.
 */
/* ★★ 같은 행 안의 순서는 원본 `0x12BEE` 의 **목록 순서** 그대로다
 *   (`그리기계열_분석.md` 「0x12BEE — 오브젝트/유닛 y정렬 그리기 본체」).
 *
 *   ```
 *   루프 (edi = 0..0x10, 17행):
 *      목록A(0x8B2E4)  → 0x5F3FD      오브젝트
 *      목록C(0xE4C8C)  → …            평상시 유닛 표
 *      목록B(0xE4854)  → …            ★ **공격 스프라이트 표**
 *   ```
 *
 *   `[+0x6B]`(공격 중 플래그)이 `0x12691` 에서 이 두 표를 가릅니다 —
 *   1 이면 `0xE4854`(B), 0 이면 `0xE4C8C`(C). B 가 **C 다음에** 그려지므로
 *   **같은 행에서 공격 중인 유닛이 평상시 유닛 위로 올라옵니다.**
 *
 *   사용자 지적(2026-08-13): 「상대방을 공격하면 내 공격 스프라이트가 상대방
 *   뒤로 가. 원작은 해당 공격자 스프라이트가 위로 올라와.」 — 이것이었습니다.
 *
 *   ※ `공격모션_분석.md` §1-e 에 「`[+0x6B]` 는 우리 구현에서 하는 일이 없다」고
 *     적어 뒀던 것은 **틀렸습니다.** 스프라이트 표만 바꾸는 게 아니라 **그리기
 *     순서**를 바꿉니다. 문서를 고쳤습니다.
 *
 *   ※ 행이 다르면 y정렬이 이깁니다 — 원본도 17행 루프가 바깥이라 같습니다.
 */
/**
 * ★★★★★ **유닛 하나를 화면에서 걷어낸다** — 원본 `0x1137A` (2026-08-25)
 *
 *   사용자 지적: 「이미 배치된 캐릭터 다시 선택시 … 원본은 **재선택하는 순간
 *   필드에서 사라져.**」
 *
 *   원본 `0x551E5`(목록 항목 클릭)는 배치된 항목을 누르면
 *     `0x11EE4` 맵 칸 점유 해제 → `0x1137A` **유닛 연결 리스트에서 제거**
 *   를 한다. 리스트에서 빠지면 그리기 루프가 더 이상 훑지 않으므로 **즉시** 사라진다.
 *
 *   우리는 유닛마다 DOM 요소(`unitEls[id]`)를 들고 있으므로 그 요소를 떼야 같은 결과가
 *   된다. `apply()` 는 **만들고 갱신할 뿐 떼지 않는다** — 그래서 `battle.units` 에서
 *   빼도 화면에는 남아 있었다(실측: 유닛 22→21 인데 요소는 75 그대로).
 */
Renderer.prototype.dropUnit = function (u) {
  if (!u || !this.unitEls) return this;
  var id = (u && u.id != null) ? u.id : u;
  var box = this.unitEls[id];
  if (box && box.parentNode) box.parentNode.removeChild(box);
  delete this.unitEls[id];
  /* 파생 캐시도 같이 버린다 — 같은 id 가 재사용될 때 옛 그림이 남지 않도록 */
  if (this._footCache) delete this._footCache[id];
  if (this._silCache) delete this._silCache[id];
  /* 체력 숫자 요소도 같이 거둔다 (showUnitValues 주석 · Z-26) */
  var ve = this.valueEls && this.valueEls[id];
  if (ve && ve.parentNode) ve.parentNode.removeChild(ve);
  if (this.valueEls) delete this.valueEls[id];
  return this;
};

/**
 * 초필살기 화면 리맵(0x454D5 · 밝기 keepPct %)을 «목록 밖» 유닛에만 건다 — 목록(시전자·등록 대상)은 원본이 리맵 뒤에 다시 그려 밝다.
 * 유닛 그림은 리맵 없는 팔레트로 칠해 두므로(_유닛쓸팔) 여기서 CSS 밝기로 낮춘다. null 이면 모두 되돌린다.
 * @param {Array|null} 밝은 목록 @param {number} keepPct 남길 밝기 %
 */
Renderer.prototype.연출밝은유닛 = function (밝은, keepPct) {
  var self = this;
  if (!this.unitEls) return this;
  var ids = {};
  (밝은 || []).forEach(function (u) { if (u && u.id != null) ids[u.id] = true; });
  var f = (밝은 == null) ? '' : ('brightness(' + ((keepPct == null ? 40 : keepPct) / 100) + ')');
  Object.keys(this.unitEls).forEach(function (k) {
    var e = self.unitEls[k]; if (!e || !e.style) return;
    var v = (밝은 == null || ids[k]) ? '' : f;
    if (e._연출밝기 !== v) { e.style.filter = v; e._연출밝기 = v; }
  });
  this._연출밝은 = (밝은 == null) ? null : { ids: ids, f: f };
  Object.keys(this.unitEls).forEach(function (k) { self._표시어둡기(k); });
  /* ★ 밝은 유닛(시전자·대상)은 맵 사물 «위»에 — 원본 화면 리맵 함수 0x454D5 가 매 프레임 리맵 뒤 등록 대상 전원(0x44DCC)을 다시 그린다
   *   (2026-11-13 EXE 직독 · 사장님 11-12 「초필살기 연출중에 오브젝트가 시전자나 적 캐릭터를 가리지 않았던 것 같은데 지금은 가려져」)
   *   유닛대열분류 가 _연출최후그림 이면 맨 뒤(위) 행으로 놓는다(천지 시전자와 같은 길) — 끝(null)에 원래 값으로 되돌린다. apply 의 재정렬이 반영한다. */
  var 목 = (this.b && this.b.units) || [];
  if (밝은 == null) {
    목.forEach(function (u) { if (u && u._연출최후그림전 !== undefined) { u._연출최후그림 = u._연출최후그림전; delete u._연출최후그림전; } });
  } else {
    목.forEach(function (u) { if (u && ids[u.id] && u._연출최후그림전 === undefined) { u._연출최후그림전 = !!u._연출최후그림; u._연출최후그림 = true; } });
  }
  try { this._스프라이트대열정렬(); } catch (e정) {}
  return this;
};

/**
 * 유닛 머리 위 상태 표시(집중 · 상태이상 — CHR_EFFC)는 원본이 치환 «앞»에 그린다(0x123E0 · 0x126FE).
 * 치환 뒤 다시 그리는 것은 유닛뿐이라(원본기록_필살_07_g1_d0: 상태 틀33~35 → 종19 → 유닛45 셋)
 * 표시는 밝은 유닛 것도 한 번 어두워진다. 표시는 유닛 박스의 자식이라 어두운 유닛은 박스 CSS 가 이미 걸리므로
 * 밝은 유닛의 표시에만 같은 밝기를 건다 — 어느 쪽이든 정확히 한 번 (2026-09-29).
 * @param {string|number} id 유닛 id
 */
Renderer.prototype._표시어둡기 = function (id) {
  var box = this.unitEls && this.unitEls[id];
  if (!box) return;
  var 연 = this._연출밝은;
  var v = (연 && 연.ids[id]) ? 연.f : '';
  var 표시 = [];
  if (box._chargeEl) 표시.push(box._chargeEl);
  if (box._ailEls) Object.keys(box._ailEls).forEach(function (k) { if (box._ailEls[k]) 표시.push(box._ailEls[k]); });
  표시.forEach(function (e) { if (e._연출밝기 !== v) { e.style.filter = v; e._연출밝기 = v; } });
};

/**
 * ★★★★★ **기울여도 원본 행 순서로 덮는다 — 1단계: 맵 오브젝트·캐릭터** (2026-10-04)
 *   사장님: 「기울였을때 기울이기 전과 그려지는 순서가 달라지는거(덮고 덮히는) 이거 근본해결이 필요하다고 했잖아.」 ·
 *           선택 「단계로 나눠 연결 (추천)」 · 시험 도구 04_도구/_맵3D/기울기순서_시험.html ③
 *   ☠ 뿌리 — `spriteLayer` 가 `world`(preserve-3d) 안이라 브라우저가 DOM 차례(= 원본 0x12BEE 행 순서 · _스프라이트대열정렬)를 버리고
 *     3D 깊이로 앞뒤를 정했다. 눕힌 벽은 바닥 평면이라 늘 캐릭터 아래 → 기울이면 캐릭터가 벽 위로 올라왔다(1-9 YOU01 (53,32)).
 *   ★ 기울이거나 돌렸을 때만 `spriteLayer` 를 `world` 바로 뒤의 **평면 판**(transform-style:flat)으로 옮기고 같은 원근을 준다.
 *     요소마다 «세계 변환(world 와 같은 문자열 · 원점 0,0) × 제자리(left·top) × 기존 국소 변환(제 원점)» 을 통째로 건다 —
 *     모양은 예전과 같고, 앞뒤는 DOM 차례만 따른다. 기울기·회전 0 이면 world 안으로 되돌려 예전 그대로.
 *   ★ 기존 코드가 요소 transform 을 다시 쓰면(값이 우리가 쓴 것과 다르면) 그것을 새 국소 변환으로 받아 다시 합친다.
 *   ☠ 기본 꺼짐(2026-10-04 · 링커맨드·이펙트 문제 보고) — 켜기 `window.__평면대열켜기 = true` · 끄기 `window.__평면대열끄기 = true`. */
/* ★★★★★ **2단계 — 세워진 그림이 들어가는 «모든» 판** (2026-10-05)
 *   사장님: 「기울였을때 연같은 잔상도 시전자를 덮는 문제가 있어」 · 「기울였을때 방패가 캐릭터에 가려지는 문제도 있고」 ·
 *           「1번 기울기 근본 해결 진행해」
 *   원작은 이펙트를 유닛 전체 그리기(0x12BEE) «앞»에 그리느냐 «뒤»에 그리느냐로만 앞뒤를 정한다 — 거리로 섞지 않는다.
 *   우리 판 차례(기울기 0 의 DOM 차례)가 곧 그 차례다. 기울이면 판 «안»이 preserve-3d 라 거리로 섞였다 —
 *     · 위 이펙트 판(fxTop) 안: 「연」 잔상 여러 장 중 앞줄 잔상이 지금 모습(시전자)을 덮었다(차례 = 연출요소층설정 i)
 *     · 월드 안: 캐릭터 판과 «캐릭터 사이» 판(fxLayer · 방패 SHIELD.VSP 0x1E86C)이 섞여 캐릭터가 방패를 덮었다
 *   ⇒ 기울이면 이 판들을 모두 평면 판으로 — 판 안 그림마다 «그 판의 변환 × 제자리 × 제 변환»을 씌운다(1단계 평면한요소 그대로).
 *   · 월드 안 판(spriteLayer·fxLayer)은 월드 바로 뒤로 «같은 차례로» 꺼낸다(월드에는 배경벽 등 다른 것도 있어 월드 변환은 못 지운다).
 *   · 따로 떠 있는 판(fxWorldUnder·fxTop·fxTopFront·캐릭터 위층)은 제자리에서 판 변환을 그림으로 옮기고 판은 평면으로.
 *   · 끌 때는 표시해 둔 원래 자리로 되돌린다(☠ 1단계는 world 맨 뒤에 붙여 기울기 0 차례가 바뀔 수 있었다). */
function 평면판되돌리기(e) {
  if (e._합친tf == null) return;
  if (e.style.transform === e._합친tf) e.style.transform = e._국소tf || '';
  if (e._국소원점 != null) e.style.transformOrigin = e._국소원점;
  ['--pl', '--pt', '--ox', '--oy', '--loc'].forEach(function (k) { e.style.removeProperty(k); });
  e._평면l = e._평면t = e._평면ox = e._평면oy = e._평면loc = undefined;   /* 변수를 지웠으니 «이미 씀» 기억도 지운다 — 다시 켤 때 새로 쓴다 */
  e._합친tf = null; e._국소tf = null; e._국소원점 = null; e._합친키 = null; e._합친세계 = null;
}
/** 판 하나를 평면으로 — 자식마다 tf 를 합치고, 그 뒤 바뀌는 것(새 자식·style)도 그리기 전에 합친다 */
Renderer.prototype._판평면켜기 = function (판, tf) {
  if (!판) return;
  /* ★ 세계 변환이 지난번과 같고 관찰기가 붙어 있으면 자식을 다시 훑지 않는다 — 바뀐 자식은 관찰기가 받는다
   *   (2026-10-08 성능 · apply 가 프레임당 2~3번이라 판 자식 452개를 매번 확인하던 몫) */
  var 같은판 = (!!판._평면준비 && !!판._평면관찰 && 판.style.transformStyle === 'flat');
  /* ★★★ **세계 변환은 판의 CSS 변수 --w 하나로 넘긴다 — 자식은 var(--w) 를 쓰는 고정 틀** (2026-10-08 · 사장님 「cpu말고 gpu쓰게하라고 했잖아」 · 「제대로 해결해.」)
   *   ☠ 전에는 카메라가 움직일 때마다 JS 가 자식 452개의 변환 문자열을 새로 만들어 썼다(헤드리스 실측 CPU 27~72%).
   *   ⇒ 이제 카메라가 움직여도 JS 쓰기는 이 한 줄뿐이다 — 각 그림의 변환 합성은 브라우저 합성기(GPU)가 한다. */
  if (판._평면tf !== tf) { 판._평면tf = tf; 판.style.setProperty('--w', tf); }
  판._평면준비 = true;
  if (판.style.transformStyle !== 'flat') 판.style.transformStyle = 'flat';
  if (판.style.perspective !== this.host.style.perspective)
    판.style.perspective = this.host.style.perspective;   /* 평면 판의 자식은 host 원근을 못 받는다 — 같은 값을 준다 */
  if (!같은판) for (var i = 0; i < 판.children.length; i++) if (판.children[i].style) 평면한요소(판.children[i], tf);
  if (!판._평면관찰 && typeof MutationObserver === 'function') {
    판._평면관찰 = new MutationObserver(function (기록) {
      if (!판._평면tf) return;
      /* ★ 한 묶음 안에서 같은 요소는 한 번만 — style 쓰기 하나가 기록 하나라 한 요소에 여러 개가 온다 (2026-10-08 성능) */
      var 본 = [];
      function 한번(e) { if (e._평면본 === 본) return; e._평면본 = 본; 평면한요소(e, 판._평면tf); }
      for (var k = 0; k < 기록.length; k++) {
        var q = 기록[k];
        if (q.type === 'childList') { for (var a = 0; a < q.addedNodes.length; a++) if (q.addedNodes[a].parentNode === 판 && q.addedNodes[a].style) 한번(q.addedNodes[a]); }
        else if (q.target.parentNode === 판) 한번(q.target);   /* 바뀐 것이 없으면 안에서 멈춘다 */
      }
    });
    판._평면관찰.observe(판, { childList: true, attributes: true, attributeFilter: ['style'], subtree: true });
  }
};
Renderer.prototype._판평면끄기 = function (판, 원래모양) {
  if (!판 || !판._평면tf) return;
  if (판._평면관찰) { 판._평면관찰.disconnect(); 판._평면관찰 = null; }
  Array.prototype.forEach.call(판.children, 평면판되돌리기);
  판._평면tf = null; 판._평면준비 = false; 판.style.removeProperty('--w');
  판.style.perspective = '';
  판.style.transformStyle = 원래모양 || 'preserve-3d';
};
Renderer.prototype._평면대열적용 = function (worldTf) {
  if (!this.world || !this.host) return;
  /* ☠ 2026-10-04 기본 꺼짐 — 사장님 「링커맨드 위치랑 이펙트랑 다 문제 생겼는데 너때문이야?」 · 원인 확정 전까지 켜기 스위치로만 돈다
   * ★ 2026-10-05 기본 켬 — 사장님(시험 탭 확인) 「방패랑 링커맨드는 해결된 것 같은데」 · 선택 「기본으로 켜기 (추천)」.
   *   끄기: 개발 패널 「기울기 평면 대열」 해제 또는 `window.__평면대열끄기 = true` */
  var c = this.cam || {}, 켬 = !root.__평면대열끄기 && !!(c.tilt || c.rot);
  var self = this;
  /* ① 월드 안 판 — 기울기 0 차례(spriteLayer → fxLayer) 그대로 월드 바로 뒤로 */
  var 안판 = [this.spriteLayer, this.fxLayer].filter(Boolean);
  /* ② 따로 떠 있는 판 — [판, 변환을 가진 겉 층] (캐릭터 위층은 겉 층 안의 그릇이 판이다) */
  var 겉판 = [[this.fxWorldUnderLayer, this.fxWorldUnderLayer], [this.fxTopLayer, this.fxTopLayer],
             [this.fxTopFrontLayer, this.fxTopFrontLayer], [this.unitTopSprite, this.unitTopLayer]]
    .filter(function (p) { return p[0] && p[1]; });
  if (!켬) {
    안판.forEach(function (L) {
      if (L.parentNode === self.world) return;
      self._판평면끄기(L, 'preserve-3d');
      L.style.left = ''; L.style.top = '';
      if (L._원래자리 && L._원래자리.parentNode === self.world) { self.world.insertBefore(L, L._원래자리); L._원래자리.parentNode.removeChild(L._원래자리); L._원래자리 = null; }
      else self.world.appendChild(L);
    });
    겉판.forEach(function (p) {
      var 판 = p[0], 겉 = p[1];
      if (!판._평면tf) return;
      self._판평면끄기(판, 판 === 겉 ? (판 === self.fxTopFrontLayer ? 'flat' : 'preserve-3d') : 'preserve-3d');
      if (판 !== 겉) 겉.style.transformStyle = 'preserve-3d';
      /* 겉 층 변환은 apply 가 이미 다시 썼다(이 함수는 apply 끝에서 돈다) */
    });
    return;
  }
  var 뒤 = this.world.nextSibling;
  안판.forEach(function (L) {
    if (L.parentNode === self.world) {
      if (!L._원래자리 && typeof document !== 'undefined') { L._원래자리 = document.createComment('평면판자리'); self.world.insertBefore(L._원래자리, L); }
      L.style.left = '50%'; L.style.top = '50%';
      self.host.insertBefore(L, 뒤);                    /* world 바로 뒤 · 기울기 0 과 같은 차례 */
    }
    뒤 = L.nextSibling;
    self._판평면켜기(L, worldTf);
  });
  겉판.forEach(function (p) {
    var 판 = p[0], 겉 = p[1];
    var tf = 겉.style.transform;                        /* apply 가 방금 쓴 그 층의 변환 */
    if (!tf || tf === 'none') return;
    겉.style.transform = 'none';                         /* 변환은 그림마다 옮겨 간다 */
    if (판 !== 겉) 겉.style.transformStyle = 'flat';
    self._판평면켜기(판, tf);
  });
  /* 옛 이름(1단계 시험·측정점)이 보는 관찰기 */
  this._평면관찰 = this.spriteLayer && this.spriteLayer._평면관찰;
};

/** 평면 대열 판의 요소 하나에 «세계 변환 × 제자리 × 기존 국소 변환(제 원점)» 을 건다 — _평면대열적용 · _빌보드적용 · 측정점이 같이 쓴다 (2026-10-04)
 *  ☠ 처음엔 apply 고리에서만 걸어, 놓자마자 재는 측정점(screenOfRendered 의 probe)이 세계 변환 없이 재였다 → 링커맨드·이펙트 자리가 틀어졌다
 *    (사장님 「링커맨드 위치랑 이펙트랑 다 문제 생겼는데 너때문이야?」 → 끄니 「지금은 잘 돼」) */
/* 고정 틀 — «세계 변환(--w) × 제자리(--pl·--pt) × 제 원점(--ox·--oy) 둘레 국소 변환(--loc)» · 모든 자식이 같은 문자열이라 한 번 정규화해 견준다 */
var 평면틀 = 'translate(calc(-1 * var(--pl)), calc(-1 * var(--pt))) var(--w) translate(var(--pl), var(--pt)) ' +
             'translate(var(--ox), var(--oy)) var(--loc) translate(calc(-1 * var(--ox)), calc(-1 * var(--oy)))';
function 평면한요소(e, worldTf) {
  var st = e.style;
  /* 변환·위치·크기가 그대로면 할 일 없음 — 관찰기가 우리 쓰기에 다시 불러도 여기서 멈춘다 (세계 변환은 판의 --w 라 여기서 안 본다) */
  var 키 = st.left + '|' + st.top + '|' + st.width + '|' + st.height + '|' + st.marginLeft + '|' + st.marginTop;
  /* ★ transform 문자열 읽기는 한 번에 2.4µs(헤드리스 실측) — 한 번만 읽어 쓴다 (2026-10-08 성능) */
  var 지금tf = st.transform, 지금원점 = st.transformOrigin;
  if (e._합친tf != null && 지금tf === e._합친tf && 지금원점 === '0px 0px' && e._합친키 === 키) return;
  var 국소바뀜 = (e._합친tf == null || 지금tf !== e._합친tf || 지금원점 !== '0px 0px');
  if (국소바뀜) {
    /* 기존 코드가 새로 건 국소 변환·원점을 받는다 */
    if (e._합친tf == null || 지금tf !== e._합친tf) e._국소tf = (지금tf && 지금tf !== 'none') ? 지금tf : '';
    if (지금원점 !== '0px 0px') e._국소원점 = 지금원점 || '';
  }
  e._합친키 = 키; e._합친세계 = worldTf;
  /* ★ 상자의 실제 왼위 = left/top + 여백 — 맵 아이템·방어 방패(_맵아이템그림)는 앵커를 margin 으로 민다 (2026-10-05)
   *   ☠ 여백을 빼면 그만큼이 세계 변환(확대·기울기)을 한 번 더 받아 보물상자·방패가 어긋났다
   *   (사장님 「방패 위치 상자 위치 다 어그러졌어 기존에 그리던 좌표에 그대로 그려야하는데 왜 바뀌는거야」 · 막을 때 방패 효과 · 맵 보물상자) */
  var l = (parseFloat(st.left) || 0) + (parseFloat(st.marginLeft) || 0), t = (parseFloat(st.top) || 0) + (parseFloat(st.marginTop) || 0);
  if (e._평면l !== l) { st.setProperty('--pl', l + 'px'); e._평면l = l; }
  if (e._평면t !== t) { st.setProperty('--pt', t + 'px'); e._평면t = t; }
  /* ★ 원점·국소는 매번 다시 계산한다(값이 같으면 안 씀) — «바뀔 때만» 조건이 길을 놓쳐 옛 원점이 남았다(헤드리스 대조 · 유닛 −12px) · 카메라 이동은 이 함수를 안 부르므로 비용이 작다 */
  {
    var w = parseFloat(st.width) || e.offsetWidth || 0, h = parseFloat(st.height) || e.offsetHeight || 0;
    var o = (e._국소원점 || '50% 50%').split(/\s+/), ox = 원점px(o[0], w), oy = 원점px(o[1] == null ? '50%' : o[1], h);
    if (e._평면ox !== ox) { st.setProperty('--ox', ox + 'px'); e._평면ox = ox; }
    if (e._평면oy !== oy) { st.setProperty('--oy', oy + 'px'); e._평면oy = oy; }
    var loc = e._국소tf || 'translate(0px, 0px)';
    if (e._평면loc !== loc) { st.setProperty('--loc', loc); e._평면loc = loc; }
  }
  if (지금원점 !== '0px 0px') st.transformOrigin = '0px 0px';   /* 같으면 안 쓴다 — 쓰기마다 관찰기 기록이 하나씩 생긴다 */
  if (지금tf !== e._합친tf || e._합친tf == null) {
    st.transform = 평면틀;
    e._합친tf = st.transform;                            /* 브라우저가 정규화한 문자열로 견준다 */
  }
  function 원점px(v, 길이) {
    if (v == null || v === '') return 길이 / 2;
    if (v === 'left' || v === 'top') return 0;
    if (v === 'right' || v === 'bottom') return 길이;
    if (v === 'center') return 길이 / 2;
    if (/%$/.test(v)) return 길이 * parseFloat(v) / 100;
    return parseFloat(v) || 0;
  }
}
/** 이 요소가 평면 대열 판(옮겨진 spriteLayer) 안이면 곧바로 합친다 */
Renderer.prototype._평면한요소 = function (e) {
  /* ★ 2단계 — 어느 평면 판이든 그 판의 변환으로 (측정점이 놓자마자 재도록 그 자리에서) */
  var 판 = e && e.parentNode;
  if (!판 || !판._평면tf) return;
  평면한요소(e, 판._평면tf);
};

/** 월드 스프라이트를 현재 원본 가림 순서에 맞춰 정렬한다. */
Renderer.prototype._스프라이트대열정렬 = function () {
  var all = this.objEls.slice(), self = this;
  /* ★★★★★ **맵 아이템(상자·아이콘)도 차례에 넣는다** — 원본 행 고리 0x12BEE 안에서 물체 → 아이템(0x12C44 아이콘 · 0x12CE3 상자) → 유닛 (2026-10-05)
   *   ☠ 빠져 있어 상자가 판 맨 뒤에 붙은 채 남아, 기울기 평면 방식에서 캐릭터 앞에 그려졌다
   *     (사장님 「상자와 열린상자가 캐릭터 앞으로 오는 문제가 있어. 캐릭터 아래로 내려가야해」)
   *   ★ `_kind` 는 아이템에서 'box'·'icon' 글자로 쓰이므로 정렬 종류는 따로 `_정렬종류` 0.5(물체 0 과 유닛 1 사이)로 둔다 */
  var 아이템칸 = this._itemEls || {};
  Object.keys(아이템칸).forEach(function (k) {
    var e = 아이템칸[k];
    if (!e || !e.parentNode || e.parentNode !== self.spriteLayer) return;
    e._row = e._칸y | 0; e._정렬종류 = 0.5;
    all.push(e);
  });
  Object.keys(this.unitEls).forEach(function (k) {
    var e = self.unitEls[k];
    if (e.style.display !== 'none') all.push(e);
  });
  function 정렬종류(e) { return (e._정렬종류 != null) ? e._정렬종류 : ((typeof e._kind === 'number') ? e._kind : 0); }
  all.sort(function (a, b) {
    var ar = a._row == null ? 0 : a._row, br = b._row == null ? 0 : b._row;
    if (ar !== br) return ar - br;                 // 0x12BEE 17행 루프
    var ak = 정렬종류(a), bk = 정렬종류(b);
    if (ak !== bk) return ak - bk;      // 같은 행: 오브젝트(0) → 평상시 유닛(1) → 공격 중 유닛(2)
    /* 같은 행·같은 종류의 유닛은 _유닛돔차례 와 같은 기준(칸 y → x)으로 — 다르면 두 정렬이 프레임마다 서로 뒤집어 전부 다시 붙였다 (2026-10-01) */
    if (a._칸 && b._칸) return (a._칸[1] - b._칸[1]) || (a._칸[0] - b._칸[0]);
    return 0;
  });
  /* 캐릭터 위층이 켜져 있으면 유닛은 그 층에 (오브젝트는 맵 층 그대로) — `유닛위층` 주석 */
  var 유닛층 = (this._유닛위층 && this.unitTopSprite) ? this.unitTopSprite : this.spriteLayer;
  /* ★ 차례가 이미 맞으면 다시 붙이지 않는다 — apply 마다 270개 남짓을 떼었다 붙여(실측 apply 3번에 828번),
   *   다시 붙은 요소마다 스타일을 처음부터 다시 계산했다. 적 사망 뒤 링이 다시 열릴 때 그 계산이 한 번에 554ms(요소 960)
   *   화면이 섰다 (2026-10-01 추적 기록 · 사장님 「뚝뚝끊기는 느낌」 · 「연이 이질감」).
   *   붙는 곳마다 «층 맨 뒤 차례 = 바라는 차례»면 건너뛰고, 아니면 예전처럼 차례대로 다시 붙인다(결과 차례는 같다). */
  var 무리 = new Map();
  all.forEach(function (e) {
    var p = (e.classList && e.classList.contains('g2-unit')) ? 유닛층 : self.spriteLayer;
    var g = 무리.get(p); if (!g) { g = []; 무리.set(p, g); } g.push(e);
  });
  무리.forEach(function (목, p) {
    var 자식 = p.children, n = 목.length, 시작 = 자식.length - n, 같다 = 시작 >= 0;
    for (var i = 0; 같다 && i < n; i++) if (자식[시작 + i] !== 목[i]) 같다 = false;
    if (같다) return;
    if (typeof p.insertBefore !== 'function') { 목.forEach(function (e) { p.appendChild(e); }); return; }   /* 가짜 DOM(시험) — 예전 길 */
    /* ★ 바뀐 것만 옮긴다 — 차례가 조금 바뀌어도(유닛 하나 죽음·한 줄 이동) 전부 다시 붙이면 960개를 다시 계산해 558ms 섰다 (2026-10-01 추적).
     *   지금 차례에서 «바라는 차례와 같은 순서로 이미 놓인 가장 긴 줄»(최장 증가 부분열)은 두고, 나머지만 다음 것 앞에 끼운다. */
    var 자리 = new Map(); 목.forEach(function (e, i) { 자리.set(e, i); });
    var 지금 = []; for (var k = 0; k < 자식.length; k++) { var q = 자식[k]; if (자리.has(q)) 지금.push(자리.get(q)); }
    var 끝값 = [], 끝번 = [], 앞 = new Array(지금.length);
    for (var a = 0; a < 지금.length; a++) {
      var v = 지금[a], lo = 0, hi = 끝값.length;
      while (lo < hi) { var mid = (lo + hi) >> 1; if (끝값[mid] < v) lo = mid + 1; else hi = mid; }
      앞[a] = lo > 0 ? 끝번[lo - 1] : -1;
      끝값[lo] = v; 끝번[lo] = a;
    }
    var 둠 = new Set(); for (var z = 끝번.length ? 끝번[끝번.length - 1] : -1; z >= 0; z = 앞[z]) 둠.add(목[지금[z]]);
    for (var j = n - 1; j >= 0; j--) {
      var e = 목[j];
      if (둠.has(e)) continue;
      if (j === n - 1) p.appendChild(e); else p.insertBefore(e, 목[j + 1]);
    }
  });
};

/**
 * ★★★★★ **캐릭터 위층** — 원본 «맵·오브젝트 → 연출 → 유닛» 차례를 3D 장면에서 낸다 (2026-09-24)
 *
 *   원본 그리기 기록(`04_도구/원본그리기기록.js` · TESTWCB 칸145 아토믹): 장마다 오브젝트(0x12DB7) 30건 →
 *   공(0x27B72) → 그림자·유닛(0x12E51·0x12E8E) → UI. 우리는 오브젝트와 유닛이 같은 3D 공간(spriteLayer)에서
 *   거리로 앞뒤가 정해져 «모든 오브젝트 위 · 모든 유닛 아래» 자리가 없었다(사장님 「오브젝트뒤에 가려」).
 *
 *   켜면: 유닛 요소만 `unitTopLayer`(맵 층과 **같은 변환** — 확대·기울기·원근·흔들림, apply() 가 준다)로 옮기고,
 *   유닛 아래 연출 층(screen-under · cam-plane-under)을 **맵 층 바로 뒤 · 위층 앞**으로 옮긴다.
 *     host: ground | world(맵·오브젝트) | [칸 A: 유닛 아래 연출] | unitTop(유닛) | overlay | fxTop · screen …(칸 B)
 *   끄면: 모두 제자리로. 같은 층 수법은 groundLayer·overlayLayer·fxTopLayer 와 같다(생성자 주석).
 *   ★ 좌표·앵커·배율은 안 바뀐다 — 부모만 바뀌고 변환은 같다.
 */
Renderer.prototype.유닛위층 = function (켤까) {
  켤까 = !!켤까;
  if (!!this._유닛위층 === 켤까) return this;
  var host = this.host, self = this;
  if (켤까) {
    if (!this.unitTopLayer) {
      this.unitTopLayer = el('div', 'g2-unit-top', host);
      this.unitTopLayer.style.cssText = 'position:absolute;left:50%;top:50%;transform-style:preserve-3d;pointer-events:none;';
      this.unitTopSprite = el('div', 'g2-unit-top-sprites', this.unitTopLayer);
      this.unitTopSprite.style.cssText = 'position:absolute;transform-style:preserve-3d;';   /* spriteLayer 생성 때 값 — 지금 값을 복사하면 평면 대열(_평면대열적용)이 옮긴 판의 left/top 50%·flat 까지 따라온다 (2026-10-04) */
    }
    if (!this.unitMidLayer) {                         /* 칸 A 의 카메라 판 — 지면 층과 같은 변환이어야 한다 */
      this.unitMidLayer = el('div', 'g2-unit-mid', host);
      this.unitMidLayer.style.cssText = 'position:absolute;left:50%;top:50%;transform-style:preserve-3d;pointer-events:none;';
    }
    this._유닛위층 = true;
    var 뒤 = this.world.nextSibling;
    this._유닛위층제자리 = [];
    var 기억 = function (e) { self._유닛위층제자리.push({ el: e, 부모: e.parentNode, 다음: e.nextSibling }); };
    /* 화면 고정 아래층(host 자식) → world 바로 뒤 */
    if (this.fxScreenUnderLayer && this.fxScreenUnderLayer.parentNode) { 기억(this.fxScreenUnderLayer); host.insertBefore(this.fxScreenUnderLayer, 뒤); }
    /* 카메라 판 아래층(지면 층 자식 — 맵 변환을 받는다) → 같은 변환의 중간 층 안으로 */
    host.insertBefore(this.unitMidLayer, 뒤);
    this.unitMidLayer.style.display = '';
    if (this.fxCamPlaneUnder && this.fxCamPlaneUnder.parentNode) { 기억(this.fxCamPlaneUnder); this.unitMidLayer.appendChild(this.fxCamPlaneUnder); }
    host.insertBefore(this.unitTopLayer, 뒤);         /* 칸 A 뒤 = 유닛 */
    this.unitTopLayer.style.display = '';
    Object.keys(this.unitEls).forEach(function (k) { var e = self.unitEls[k]; if (e) self.unitTopSprite.appendChild(e); });
  } else {
    this._유닛위층 = false;
    Object.keys(this.unitEls).forEach(function (k) { var e = self.unitEls[k]; if (e) self.spriteLayer.appendChild(e); });
    (this._유닛위층제자리 || []).slice().reverse().forEach(function (r) {
      if (r.다음 && r.다음.parentNode === r.부모) r.부모.insertBefore(r.el, r.다음); else r.부모.appendChild(r.el);
    });
    this._유닛위층제자리 = [];
    if (this.unitTopLayer) this.unitTopLayer.style.display = 'none';
    if (this.unitMidLayer) this.unitMidLayer.style.display = 'none';
    try { this._스프라이트대열정렬(); } catch (e정) {}
  }
  this.apply();
  return this;
};

/* ── 유닛 ─────────────────────────────────────────────────────────────── */
/**
 * ★★★★★ **원본 직독을 먼저 본다** (할일 19 · 2026-08-23)
 *
 *   전에는 추출 번들(`자산/bundle.js` 의 `G2.sprites`)을 **먼저** 봤다 —
 *   CLAUDE.md 「원본 직독 아키텍처 — 예외 없음」과 어긋난다.
 *
 *   ★★★ 번들에는 **13개**뿐이고 나머지는 이미 `_대체스프라이트정보`(원본 직독)로 떨어졌다.
 *     그 13개를 원본과 **전수 대조**하니 행·열·기준점·칸·발자국이 **전부 같았다**
 *     (`04_도구/전체실행기/스프라이트_번들_대조.js`). 그래서 순서를 바꿔도
 *     **그림이 안 바뀐다.**
 *
 *   ★ 번들은 **물러섬**으로만 남긴다 — 원본을 아직 못 읽었을 때(비동기 적재 중)
 *     빈 화면이 되지 않게. `_대체스프라이트정보` 가 `null` 을 주면 그때만 번들을 본다.
 */
Renderer.prototype.spriteMeta = function (u) {
  /* ① 원본 직독 (`_usprRaw` 에 이미 있으면 곧바로) */
  var m = this._대체스프라이트정보(u.sprIndex);
  if (m) return m;
  /* ② 아직 못 읽었으면 번들로 물러선다 — 값은 위 대조로 **같음이 확인됐다** */
  var sp = this.G2.sprites || {};
  return sp[u.sprIndex] || sp[String(u.sprIndex)] || null;
};

/**
 * `sprites.json` 에 없는 번호를 위한 최소 메타 (할일 19-e 로 가는 다리).
 *
 * ★ 추출본 `sprites.json` 은 **그 시나리오에 선 채로 등장하는** 유닛만 담는다
 *   (FR08 은 15개뿐). 그런데 **탈것이 죽어 탑승자가 내리면** 목록에 없는 보행
 *   그림이 필요해진다 — 암흑기사는 `1 = KNIGHT2.NC2` 인데 없어서 층이 0개가 되어
 *   **사람이 아예 안 보였다** (할일 3 · `전투데이터_추출.md` §`.RCR`).
 *
 * 파일명은 이미 원본에서 온다 — `_스프라이트표불러오기()`가 `COMBATII.EXE 0x75AA8`
 * 목록을 읽어 두고 `_spriteFile()` 이 `spriteIndexOf(번호)` 로 찾는다.
 * 격자는 `frameOf` 의 기본값과 같은 **4방향 × 11모션**이다
 * (`0x13175 frame = (방향 * 11 + 모션) * 13`).
 *
 * ★★★ **발자국·겹치기는 「불러올 때 로직으로」 낸다** (사용자 지정 2026-08-16).
 *   표나 추출 메타를 따로 두지 않는다 — **파일에서 그때 계산한다**:
 *     · `.NC2` → 발자국 `[1, 1]` 고정 (원본 `0x1188E` 가 그렇게 박는다)
 *     · 그 밖(`.RCR` 등 큰 것) → **프레임 헤더 15·16 의 `fw`/`fh`**
 *   프레임마다 실어 두고(`발자국`) 방향별 최대를 `발자국최대` 로 낸다 —
 *   원본이 프레임 단위로 읽기 때문이다.
 *   기준점·칸도 같은 자리에서 프레임 앵커·크기로 계산한다.
 *   ★ `G2.sprites` 에도 같이 등록한다 — 안 그러면 렌더러는 알고 셈은 모른다.
 */
/** 유닛을 그리기 전에 **꼭 있어야 하는 것**을 기다린다 — 지금은 스프라이트 이름표. */
Renderer.prototype.준비 = function () {
  return this._스프라이트표불러오기();
};

/** ★★★ **Renderer 를 만들기 전에** 불러 두는 정적 선로드 (2026-08-16)
 *
 *  생성자가 `_buildUnits()` 를 **먼저** 돌리고 `_원본맵초기화()`가 그 뒤에
 *  표를 읽어서, 첫 상자는 늘 `_대체스프라이트정보 = null` 로 만들어졌다.
 *  그래서 「나오다 안나오다」 했다 — **표를 먼저 받아 두면 한 번에 제대로 만들어진다.**
 *
 *      await G2Render.Renderer.스프라이트표준비();
 *      var R = new G2Render.Renderer(...);
 */
/**
 * ★★★★★ 원본 `WEA_EFFC.SYB` 120장을 한 번만 선로드한다.
 *
 * `COMBATII 0x11C47` 이 이 파일을 120장 표로 읽고, `0x1E2EA` 가
 * `.NC2` 앞머리 40B의 `frameNo` 로 그 표를 고른다. 즉 평타와 일부 필살기의
 * 흰 무기 궤적은 **별도 공용 자산**이다. 추출 PNG를 만들지 않고 원본을 직독한다.
 */
Renderer.무기스윙자산준비 = async function () {
  if (Renderer._무기스윙Raw && Renderer._무기스윙Raw.length) return Renderer._무기스윙Raw;
  if (Renderer._무기스윙P) return Renderer._무기스윙P;
  Renderer._무기스윙P = (async function () {
    try {
      var f = root.fetch || (typeof fetch !== 'undefined' ? fetch : null);
      if (!f || !root.G2Native) return null;
      var r = await f(G2URL('WEA_EFFC.SYB'));
      if (!r.ok) throw new Error('WEA_EFFC.SYB ' + r.status);
      var d = root.G2Native.decodeSYB(new Uint8Array(await r.arrayBuffer()));
      if (!d || !d.frames || d.frames.length < 120)
        throw new Error('WEA_EFFC.SYB 프레임 ' + (d && d.frames ? d.frames.length : 0));
      Renderer._무기스윙Raw = d.frames;
      console.log('[유닛] 원본 무기 스윙 WEA_EFFC.SYB 120장 선로드');
      return d.frames;
    } catch (e) {
      console.warn('[유닛] WEA_EFFC.SYB 선로드 실패:', e && e.message);
      Renderer._무기스윙P = null;
      return null;
    }
  })();
  return Renderer._무기스윙P;
};

/** ★★★ **전투에 나올 유닛 스프라이트를 전부 미리 받는다** (2026-08-16)
 *
 *  `_대체스프라이트정보` 는 이름표(`0x75AA8`)뿐 아니라 **`_usprRaw[file]`(스프라이트
 *  본문)** 도 있어야 메타를 만든다. 둘 중 하나라도 없으면 `null` 을 돌려
 *  **탈것 본체(말) 층이 빠진 채** 상자가 굳는다 — 「나오다 안나오다」의 원인.
 *
 *  그래서 `Renderer` 를 만들기 전에 **이름표 → 필요한 파일들**을 순서대로 받는다.
 *  `battle.units` 의 `sprIndex` 와 `rider.sprIndex` 를 전부 훑는다. */
Renderer.유닛자산준비 = async function (battle) {
  /* 스윙 자산은 전투에 들어가기 전에 같이 데운다. 실패해도 유닛 본체 로드는 계속한다. */
  try { await Renderer.무기스윙자산준비(); } catch (e0) {}
  var names = await Renderer.스프라이트표준비();
  if (!names || !battle || !battle.units || !root.G2Native) return null;
  var 번호 = {};
  /* ★ 2026-09-24 (사장님: 「알시온 아바레스트 소환의 경우 … 그대로 알시온 스프라이트로 나와」)
   *   마장기 그림은 **소환한 뒤에야** 필요해진다. 판에 없던 번호라 안 실려 있어
   *   메타가 null → 옛 사람 그림이 남았다(GARIUS.MAR·ABALEST.MAR). 부를 수 있는 캐릭터가
   *   있으면 그 마장기 그림(코드+299 · 0x17E7C)도 함께 싣는다. */
  var 마장기표 = (root.G2Combat && root.G2Combat.마장기소환표) || {};
  function 마장기그림(u) {
    var s = u && 마장기표[(u.charCode != null ? u.charCode : u.코드) | 0];   /* 배치목록은 `코드` */
    if (s) 번호[(s.code | 0) + 299] = 1;
    var 이급표 = (root.G2Combat && root.G2Combat.이급마장기표) || {};   /* [리마스터] 2급 소환 그림도 */
    var s2 = 이급표[(u && (u.charCode != null ? u.charCode : u.코드)) | 0];
    if (s2 != null) 번호[(s2 | 0) + 299] = 1;
  }
  battle.units.forEach(function (u) {
    if (u.sprIndex != null) 번호[u.sprIndex] = 1;
    if (u.rider && u.rider.sprIndex != null) 번호[u.rider.sprIndex] = 1;
    마장기그림(u);
  });
  /* ★★★ **이벤트로 등장할 유닛(op 0x03)의 그림도 싣는다** (2026-10-08 · 사장님 「아 씨발 뭘했길래 이제 이벤트로 등장해는 캐릭터가 제때 안나오고 그림자만 나와?」)
   *   op 0x03 유닛은 등장하는 순간 유닛등록(0x50E48~)으로 새로 만들어져 위 battle.units 에 없다 — 그림을 그때 받으니
   *   받기 전까지 몸 없이 그림자만 보였다(같은 날 «길이 한 칸뿐인 걷기 등장은 감추지 않는다»로 바꾸며 드러남).
   *   ⇒ 이 전투 .SCE 이벤트의 등장 레코드(136B · 그림 번호 +0x61 u16)와 부속 레코드를 함께 모은다. */
  try {
    var 살 = root.G2SceLive;
    ((살 && 살.sections) || []).forEach(function (s) {
      ((s && s.events) || []).forEach(function (e) {
        ((e && e.script) || []).forEach(function (c) {
          if (!c || c.op !== 3) return;
          [c.레코드, c.부속레코드].forEach(function (r) {
            if (r && r.length >= 0x63) { var no = r[0x61] | (r[0x62] << 8); if (no) 번호[no] = 1; }
          });
        });
      });
    });
  } catch (e등) { /* 이벤트가 없어도 본 적재는 계속한다 */ }
  /* ★★★★★ **배치 목록의 스프라이트도 싣는다** (2026-08-24)
   *
   *   사용자 지적: 「`.SCE` 에 있는 캐릭터를 불러오는 게 아니야. **월드에서 파티
   *   구성원에 있고 `.SCE` 에서 배치되지 않은 캐릭터들**이 목록에 나와야 해.」
   *
   *   그 캐릭터들은 `battle.units` 에 **없다** — `.SCE` 에 안 실렸기 때문이다.
   *   그래서 배치 화면 목록에 그림이 하나도 안 떴다
   *   (실측: 코드 5 = `MAGICIA1.NC2` 인데 `_uspr` 에는 SCE 유닛 6종뿐).
   *   ⇒ `battle.배치목록` 의 `sprIndex` 도 함께 모은다. */
  if (battle.배치목록 && battle.배치목록.length) {
    battle.배치목록.forEach(function (m) {
      if (m && m.sprIndex != null) 번호[m.sprIndex] = 1;
      마장기그림(m);
    });
    /* [리마스터] 배치 화면 마장기 쪽(베샤르·페리튼·로퍼) — 놓기 전에 그림 정보(발자국 2×2)가 실려 있어야 한다.
     *   ☠ 안 실린 채 놓으면 footOf 가 [1,1] 로 떨어져 한 칸만 차지했다 (2026-10-03 사장님 「3급 마장기 발자국이 이상해. 지금은 말처럼 나와」) */
    [0x07, 0x09, 0x0B].forEach(function (c) { 번호[c + 299] = 1; });
  }
  var 파일 = {};
  Object.keys(번호).forEach(function (no) {
    var i = root.G2Native.spriteIndexOf(no | 0);
    if (i >= 0 && names[i]) 파일[names[i]] = 1;
  });
  var 목록 = Object.keys(파일);
  var 받음 = 0;
  Renderer._선raw = Renderer._선raw || {};
  Renderer._선swing = Renderer._선swing || {};
  await Promise.all(목록.map(async function (f) {
    if (Renderer._선raw[f]) return;
    try {
      var r = await fetch(G2URL('CHARACTE/' + f));
      if (!r.ok) return;
      var b = new Uint8Array(await r.arrayBuffer());
      /* ★★★ **확장자로 디코더를 고르면 안 된다** (2026-08-16 · 「말도 이상해졌고」)
       *
       *   `_유닛프레임공급자`는 `.NC2`·`.BCR`·`.RCR`·`.MCR`·`.WCR`을 **전부 `decodeNC2`**
       *   로 푼다. 내가 선로드에서 `.NC2` 만 `decodeNC2`, 나머지를 `decodeNSP` 로
       *   갈랐더니 **말·비룡 프레임이 깨져** 크기가 터졌다. 같은 함수를 쓴다. */
      var d = root.G2Native.decodeNC2(b, f);      // 파일명 → 색인 리맵 (선로드도 같이)
      var fr = d && d.frames;
      if (fr && fr.length) {
        Renderer._선raw[f] = fr;
        if (d.weaponSwing) Renderer._선swing[f] = d.weaponSwing;
        받음++;
      }
    } catch (e) {}
  }));
  console.log('[유닛] 스프라이트 **선로드** ' + 받음 + '/' + 목록.length + '개 — ' +
              목록.slice(0, 6).join(' '));
  return Renderer._선raw;
};

/** 늦게 받은 선로드분(Renderer._선raw·_선swing)을 이 렌더러에도 넣는다 — 생성자는 만들 때 한 번만 옮겨 받는다
 *  (2026-10-08 · 이벤트 등장 유닛 그림 · battle_ui SCE 파싱 자리에서 부른다) */
Renderer.prototype.선로드반영 = function () {
  var f, r = Renderer._선raw || {}, w = Renderer._선swing || {};
  this._usprRaw = this._usprRaw || {}; this._usprSwing = this._usprSwing || {};
  for (f in r) if (!this._usprRaw[f]) this._usprRaw[f] = r[f];
  for (f in w) if (!this._usprSwing[f]) this._usprSwing[f] = w[f];
  return this;
};

Renderer.스프라이트표준비 = function () {
  var 정본 = 전투표시정본();
  if (!Renderer._표 && 정본) 전투표시정본설치(정본);
  if (Renderer._표) return Renderer._표P || Promise.resolve(Renderer._표);
  if (Renderer._표P) return Renderer._표P;
  Renderer._표P = (async function () {
    try {
      /* 통합 셸은 preload snapshot을 쓰므로 이 길은 독립 전투 fallback이다. */
      var snap = await 전투표시정본읽기(root.fetch);
      var names = snap && snap.compatibility && snap.compatibility.spriteNames;
      if (!names || names.length < 400) throw new Error('표 길이 ' + (names ? names.length : 0));
      Renderer._표 = names = 이름표바로잡기(names);
      console.log('[유닛] 스프라이트 파일명 표 **정본 선로드**:', names.length + '개 (0x75AA8)');
      return names;
    } catch (e) {
      console.warn('[유닛] 파일명 표 선로드 실패 — 생성 뒤 비동기로 다시 받는다:', e && e.message);
      return null;
    }
  })();
  return Renderer._표P;
};

/**
 * ★ 2026-09-24 [리마스터] 이름표 오타 한 자리 — COMBATII.EXE 0x76965 는 `ABALEST.MAR` 인데
 *   CD·설치 폴더의 파일은 `ABAREST.MAR` 다(CD 이미지 전수 — ABALEST 는 EXE 안에만 있다).
 *   원본 그대로면 알시온의 아바레스트 그림을 못 읽는다. 사장님: 「아바레스트 스프라이트가 나와야하는데」
 *   ⇒ 실제 파일 이름으로만 바꾼다(`리마스터_적용현황.md`).
 */
var 이름표오타 = { 'ABALEST.MAR': 'ABAREST.MAR' };
function 이름표바로잡기(names) {
  if (!names || !names.map) return names;
  return names.map(function (n) {
    var k = n && String(n).toUpperCase();
    return (k && 이름표오타[k]) ? 이름표오타[k] : n;
  });
}
/** 스프라이트 번호에 원본 메타가 없을 때 최소 호환 메타를 만든다. */
Renderer.prototype._대체스프라이트정보 = function (no) {
  if (no == null) return null;
  var names = this._sprNames;
  if (!names) { this._스프라이트표불러오기(); return null; }
  var i = root.G2Native.spriteIndexOf(no);
  if (!(i >= 0) || !names[i]) return null;
  var file = names[i];

  this._fbMeta = this._fbMeta || {};
  if (this._fbMeta[no] && this._fbMeta[no]['칸']) {
    var cached = this._fbMeta[no], shared = this.G2 && this.G2.sprites && this.G2.sprites[no];
    if (this.G2 && this.G2.sprites && (!shared || !shared['_원본직독'])) this.G2.sprites[no] = cached;
    return cached;
  }

  /* 그림이 아직이면 읽어 오게 하고, 이번엔 물러난다 (`_refreshUnits` 가 다시 부른다) */
  var frames = this._usprRaw && this._usprRaw[file];
  if (!frames) { this._유닛프레임정보(file, 0); return null; }

  /* ★ `칸`·`기준점` 은 **프레임 헤더에서 나오는 파생값**이다.
   *     기준점 = [max(−ax), max(−ay)]
   *     칸     = [기준점x + max(w + ax), 기준점y + max(h + ay)]
   *   추출본 `sprites.json` 과 **13/13 파일 전 프레임 일치**를 실측으로 확인했다
   *   (NC2 · BCR · MAR · RCR 전부). 그러니 이 값들 때문에 추출본을 볼 이유가 없다. */
  var ax = 0, ay = 0, rx = 0, ry = 0;
  frames.forEach(function (f) {
    if (-f.ax > ax) ax = -f.ax;
    if (-f.ay > ay) ay = -f.ay;
    if (f.w + f.ax > rx) rx = f.w + f.ax;
    if (f.h + f.ay > ry) ry = f.h + f.ay;
  });
  /* 격자 — **프레임 수에서 나온다.** 방향은 언제나 4다(`0x11EE4` 프레임 = 방향×방향당 + 모션).
   *     `.NC2` 44 = 4 × 11   ·   `.BCR`/`.MAR`/`.WCR`/`.RCR` 32 = 4 × 8
   *   예전엔 11 로 박아 뒀는데, 그러면 `.BCR` 의 방향이 통째로 어긋난다. */
  var 행 = 4, 열 = Math.max(1, (frames.length / 4) | 0);

  /* ★★ **발자국(차지하는 칸 수)** — `전투데이터_추출.md` §4.5.
   *   `.NC2` 는 `0x11871`~`0x1188E` 가 **1×1 로 박는다**(헤더에서 안 읽는다).
   *   `.BCR`/`.MAR`/`.WCR` 만 헤더 15·16번째 바이트를 표 `+0`·`+1` 로 쓴다 —
   *   `native.js decodeNC2` 가 `fw`·`fh` 로 실어 준다(gap 5 일 때만 있다).
   *
   *   이 칸이 비어 있으면 **탈것이 죽어 탑승자가 내려도 말의 발자국이 남는다** —
   *   `HORSE1.BCR` 은 2×1·1×2 라 두 칸을 차지한다. 「사이즈가 잘못됐다」의 정체가
   *   그림 크기가 아니라 **점유 칸 수**였다(사용자 지적 2026-08-13).
   *   쓰는 곳: `0x11EE4`(타일→유닛 지우기) · `0x1430E`(이동 범위) ·
   *            `0x16699`·`0x165C2`(배치 판정) · `0x49FE1`(선택 상자).
   *
   *   방향 안에서는 **모션이 달라도 값이 같다** — 448개 전수로 확인했다.
   *   그래서 방향마다 모션 0 의 값을 쓴다. */
  /* ★ 프레임 표도 넘긴다 — `frameMeta`(선택 상자 `0x49FE1`)가 **그 프레임의**
   *   `w·h·ax·ay` 를 봐야 한다. 없으면 시트 전체의 최대치(`칸`·`기준점`)로
   *   대신하는데, 그건 **가장 큰 프레임 기준**이라 상자가 실제보다 커진다.
   *   말이 죽어 탑승자가 내렸는데 상자가 말 크기로 남았던 원인이다.
   *   `발자국`(fw·fh)도 프레임마다 실어 둔다 — 원본이 프레임 단위로 읽는다. */
  var isNC2 = /\.NC2$/i.test(file);
  var 표 = frames.map(function (f) {
    var e = { w: f.w, h: f.h, ax: f.ax, ay: f.ay };
    if (isNC2) e['발자국'] = [1, 1];                                   // 0x1188E 가 박는다
    else if (f.fw > 0 && f.fh > 0) e['발자국'] = [f.fw | 0, f.fh | 0]; // 헤더 15·16
    return e;
  });

  var 발 = null, 발최대 = null;
  if (표[0] && 표[0]['발자국']) {
    발 = []; 발최대 = [1, 1];
    for (var d = 0; d < 행; d++) {
      var v = (표[d * 열] || 표[0])['발자국'] || [1, 1];
      발.push([v[0], v[1]]);
      if (v[0] > 발최대[0]) 발최대[0] = v[0];
      if (v[1] > 발최대[1]) 발최대[1] = v[1];
    }
  }

  this._fbMeta[no] = { '파일': file, '행': 행, '열': 열, '프레임': 표,
                       '기준점': [ax, ay], '칸': [ax + rx, ay + ry],
                       '발자국': 발, '발자국최대': 발최대,
                       '_원본직독': true };

  /* ★★ **셈 쪽에도 같이 등록한다.** `Battle.footOf` 는 `G2.sprites` 를 보는데
   *   (`state.js` 201행 `this.sprites = G2.sprites`, **같은 객체**), 여기서만
   *   들고 있으면 렌더러는 알고 셈은 모르는 상태가 된다 — 말이 죽어 탑승자가
   *   내려도 `footOf` 가 여전히 말 값을 못 찾아 1×1 로 떨어졌다. */
  /* ★★★★★ **원본 직독이 이긴다** (할일 19 · 2026-08-23)
   *   전에는 `!this.G2.sprites[no]` 라 **번들이 있으면 안 덮었다** —
   *   그러면 `Battle.footOf` 는 여전히 추출본을 본다.
   *   ★ 번들 13개를 원본과 **전수 대조**해 값이 같음을 확인했으므로
   *     덮어도 그림이 안 바뀐다 (`04_도구/전체실행기/스프라이트_번들_대조.js`).
   *   ★ 이미 원본 직독으로 채운 것은 **다시 안 덮는다**(같은 값이니 낭비다). */
  if (this.G2 && this.G2.sprites) {
    var 옛 = this.G2.sprites[no];
    if (!옛 || !옛['_원본직독']) this.G2.sprites[no] = this._fbMeta[no];
  }

  console.log('[유닛] sprites.json 에 없는 ' + no + ' → 원본 ' + file +
              ' ' + 행 + '×' + 열 + ' 기준점' + JSON.stringify([ax, ay]) +
              ' 칸' + JSON.stringify([ax + rx, ay + ry]) +
              ' 발자국' + JSON.stringify(발));
  return this._fbMeta[no];
};

/**
 * 이 유닛을 그릴 시트 목록 — 아래에서 위 순서.
 *
 * 탈것에 탄 유닛은 레코드가 **탈것**이고 사람은 `[+0x77]` 부속으로 붙습니다
 * (`03_분석/COMBATII/탈것_시스템.md`). 원본은 두 장을 겹쳐 그립니다.
 * ```
 * 0x13165  if ([+0x77] != 0 && [+0x5C] <= 6)                 ; 마장기(7 이상)는 통짜
 * 0x13175    frame = (탈것 [+0x63] 방향 * 11 + 탈것 [+0x64] 모션) * 13
 * 0x1319E    entry = 0xD66A8 + 탑승자[+0x60] 슬롯 * 572 + frame   ★ 슬롯만 탑승자 것
 * 0x131CB    x = 탈것기준x + byte[entry+4] + [탈것+0x65]
 * 0x131C6    y = 탈것기준y + byte[entry+5] + [탈것+0x66] + 높이보정
 * 0x131EB    0x5F3FD 로 출력
 * ```
 * ★★★ **틀렸다 — 기준점이 완전히 같지는 않다** (사용자 지적 2026-08-16).
 *   프레임 번호는 탈것의 방향·모션을 그대로 쓰는 것이 맞지만, **자리는 두 겹의
 *   오프셋이 더해진다** (`전투데이터_추출.md` §4.4 · `0x131CB`·`0x131C6`):
 *   ```asm
 *   0x131CB  x = 탈것기준x + s8[eax+4] + s8[esi+0x65]
 *   0x131C6  y = 탈것기준y + s8[eax+5] + s8[esi+0x66] + 높이보정
 *   ```
 *   ① `eax = 0xD66A8 + 탑승자스프라이트*572 + 프레임슬롯` 의 **프레임별** 오프셋
 *   ② **탈것 레코드 `+0x65`/`+0x66`** — ★ **말·마장기·비룡마다 다른 값**이다.
 *   지금 구현은 **둘 다 안 쓴다** — 그래서 탈것 종류가 달라도 같은 자리에 앉는다.
 *   `sce.js` 에 `탑승오프셋: [+0x65, +0x66]` 을 읽어 두었으니 여기서 쓰면 된다.
 *   ★ 탈것 분기도 있다: `[+0x5C]` 1~4 = 말 계열(`0x706D4`) · 5~6 = 마장기·비룡
 *     (`0x70896`) · **7 이상 = 통짜라 탑승자를 아예 안 그린다**(`0x1316F`).
 * 내보낸 시트는 칸 안의 `기준점` 을 (x*24+12, y*16−2) 에 대면 되도록 만들어져 있어
 * (`g2_export_battle.py`) 두 시트를 각자의 기준점으로 놓기만 하면 원본과 같아집니다.
 * 탑승자 RCR 번호는 `scene.json` 의 `탑승자.탑승자RCR` → state.js `u.rider.sprIndex`.
 */
Renderer.prototype.layersOf = function (u) {
  if (!u) return [];
  var sp = this.G2.sprites || {};
  var out = [];
  var m = this.spriteMeta(u);
  if (m) out.push({ meta: m, no: u.sprIndex, tag: '탈것/본체' });
  if (u.rider && (u.rider.sprIndex != null || u.rider.보행spr != null)) {
    /* ★★★ **탑승자도 폴백 메타를 쓴다** (2026-08-16 · 「2-5 말 타야하는데 없네」)
     *
     *   본체는 `spriteMeta(u)` 가 `_대체스프라이트정보` 로 떨어지는데 **탑승자만
     *   `sp[...]` 만 봐서**, 목록에 없는 번호면 층을 **아예 안 만들었다.**
     *   그래서 탈것 유닛이 **한 장(말)만** 그려지거나, 반대로 사람만 남았다.
     *   `.SCE` 는 멀쩡했다 — 2-5 의 탈것 10명 전부
     *   본체 `303`(=탈것4+299) · 직업 `99`(=4+95) · 탑승자 스프 별도였다. */
    var rno = u.rider.sprIndex;
    /* ★★★ **3급 마장기 조종사를 창세기전1 `PM*.MCR` 로 바꾼다** (리마스터 · 선택)
     *
     *   사용자 요청 2026-08-16: 「3급마장기도 말이나 비룡 타는 것처럼 pm 스프라이트
     *   사용해서 연결해줄 수 있어?」 · 「일단 토글 달아줘」.
     *
     *   원본은 `0x70896` 표로 `D*.RCR` 을 고르는데 그 표에는 **이름 있는 캐릭터만**
     *   있어서, 제국병·로열가드가 마장기를 타면 조종사가 **아예 안 그려진다.**
     *   창세기전1 에는 병종 조종사 그림이 있어 그걸 쓴다.
     *
     *   ★ 대응은 **탑승자의 보행 스프라이트 번호**로 가린다(`rider.보행spr`).
     *     `rider.sprIndex` 는 덧그릴 `.RCR` 번호라 「누구인지」를 모른다.
     *   ★ 끄면(기본) 원본대로 돈다. */
    var pmOn = false, pm고정;
    try {
      var C = (root.__Opt && root.__Opt.cfg) || {};
      pmOn = (C['PM조종사'] === '리마스터');
      pm고정 = (C['PM묶음'] === '자동' || C['PM묶음'] == null) ? undefined : (C['PM묶음'] | 0);
    } catch (e) { }
    if (pmOn && root.G2Native && root.G2Native.PM조종사) {
      var 보행 = (u.rider.보행spr != null) ? u.rider.보행spr : null;
      var pm = (보행 == null) ? null : root.G2Native.PM조종사(u.sprIndex, 보행, pm고정);
      if (pm != null) rno = pm;
    }
    /* 끈 상태에서 `탑승자RCR` 도 없으면(마장기) 원본대로 **안 그린다** */
    if (rno == null) return out;
    var r = sp[rno] || sp[String(rno)] || this._대체스프라이트정보(rno);
    if (r) { out.push({ meta: r, no: rno, tag: '탑승자', rider: true }); }
    else {
      /* 못 만들면 **조용히 넘기지 않는다** — 한 번만 알린다 */
      if (!this._riderWarned) this._riderWarned = {};
      if (!this._riderWarned[rno]) {
        this._riderWarned[rno] = 1;
        console.warn('[탑승자] 메타를 못 만들었다 — 스프라이트 ' + rno +
                     ' (탈것 본체는 ' + u.sprIndex + ')');
      }
    }
  }
  return out;
};

/** 전투 유닛의 본체·그림자·상태효과 빌보드 요소를 구성한다. */
Renderer.prototype._유닛상자전체짓기 = function () {
  var self = this;
  this.b.units.forEach(function (u) {
    self._유닛상자확보(u);
  });
};

/** id 로 유닛 찾기 — 층 재확인에 쓴다. */
Renderer.prototype._ID유닛찾기 = function (id) {
  var us = (this.b && this.b.units) || [];
  for (var i = 0; i < us.length; i++) if (String(us[i].id) === String(id)) return us[i];
  return null;
};

/** 분신·소환·하차로 전투 중 생긴 유닛도 초기 유닛과 같은 DOM 경로로 올립니다. */
Renderer.prototype._유닛상자확보 = function (u) {
    var old = this.unitEls[u.id];
    /* ★ 층 시그니처에 **3급 마장기 조종사 옵션**도 넣는다 (2026-08-16).
     *   PM 을 켜고 끄면 층 구성이 달라지는데, 예전 시그니처는 `sprIndex:riderSpr`
     *   뿐이라 **토글을 바꿔도 상자를 다시 안 지었다** — 패널만 바뀌고 화면은
     *   그대로였다. 마장기는 `riderSpr` 이 `null` 이라 더더욱 티가 안 났다. */
    var _pmSig = '';
    try {
      var _C = (root.__Opt && root.__Opt.cfg) || {};
      if (_C['PM조종사'] === '리마스터') _pmSig = ':PM' + (_C['PM묶음'] == null ? '자동' : _C['PM묶음']);
    } catch (e) { }
    var sig = (u.sprIndex | 0) + ':' + (u.rider && u.rider.sprIndex != null ? u.rider.sprIndex : '-')
            + (u.rider && u.rider.보행spr != null ? ':' + u.rider.보행spr : '') + _pmSig;
    /* ★ 층이 0개인 채로 굳은 상자는 다시 만든다. 메타가 아직 없을 때(원본 그림을
     *   비동기로 읽는 중) 만들어지면 `_layerSig` 가 같아 영영 안 고쳐졌다 —
     *   탈것에서 내린 탑승자가 **안 보이던** 자리다 (할일 3 · 19-e). */
    /* ★ 2026-08-16 — 「탑승자가 있으면 2층이어야 재사용」을 넣어 봤으나
     *   **오히려 나빠졌다**(번스타인·카슈타르마저 1층/0층이 됐고 `updateUnit`
     *   쪽과 얽혀 **무한 재귀**까지 났다). 되돌린다.
     *   제국장교 4기가 1층으로 굳는 문제는 **생성 순서·자산 준비** 쪽이다 —
     *   나중에 `layersOf` 를 부르면 2층이 정상으로 나온다. */
    /* ★★★★★ **탑승자가 있는데 한 층으로 굳었으면 다시 만든다** (2026-08-25)
     *
     *   사용자 지적: 「탈것 선택이 되고 잘 나오는데, **탑승이미지가 아닌 말 이미지로
     *   나와**.」 배치 화면에서 탈것을 태우면 `u.rider` 가 **유닛을 만든 뒤에** 붙는데,
     *   그 사이에 상자가 만들어지면 `layersOf()` 가 아직 탑승자를 몰라 **한 층**만
     *   만든다. `sig` 는 `rider.sprIndex` 를 포함하지만, 상자를 만든 뒤 rider 가
     *   붙으면 **sig 만 새로 계산되고 상자는 재사용**되어 영영 한 층으로 남았다
     *   (실측: `sig = "300:500:23"` 인데 `_layers = [300]`).
     *
     *   ★ 2026-08-16 에 「2층이어야 재사용」을 무조건 넣었다가 **무한 재귀**가 났다.
     *     그래서 여기서는 **탑승자가 있는데 1층인 상자**만, **유닛당 한 번만** 다시
     *     만든다(`_탑재시도`). 조건이 좁고 1회라 그 함정에 안 빠진다. */
    if (old && old._layerSig === sig && (old._layers || []).length) {
      var _탑있 = !!(u.rider && (u.rider.sprIndex != null || u.rider.보행spr != null));
      if (!(_탑있 && (old._layers || []).length < 2)) return old;
      /* ★ **지금 다시 재서 층이 늘어날 때만** 갈아엎는다.
       *   그림이 아직 안 읽혔으면 새로 만들어도 또 1층이라 무한히 다시 만들게 된다.
       *   `layersOf()` 는 상자를 만들지 않으므로 여기서 불러도 재귀가 없다. */
      if (this.layersOf(u).length <= (old._layers || []).length) return old;
    }
    var self = this;

    /* ★★ **층을 먼저 재 본다.** 여기서 곧바로 상자를 새로 만들면 무한 재귀가 난다.
     *
     *   `_대체스프라이트정보` 는 원본 그림이 아직 안 읽혔으면 읽기만 걸어 두고 `null` 을
     *   낸다(비동기). 그러면 `layersOf` 가 **빈 배열**을 내고 층 0개짜리 상자가
     *   만들어지는데, 끝에서 `updateUnit` 을 부르면 그쪽이 「층이 0개면 다시 짓는다」
     *   로 또 여기를 부른다 →
     *     _ensureUnit → updateUnit → _ensureUnit → …  **RangeError: Maximum call
     *     stack size exceeded** (render.js 233 에서 터짐)
     *
     *   실제 증상: **말을 죽이면 링커맨드가 뜬 채 멈춘다.** 탑승자 그림
     *   (`1 = KNIGHT2.NC2`)이 `sprites.json` 에 없어 원본에서 읽어야 하는데,
     *   그 사이에 이 순환에 빠졌다. (사용자 지적 2026-08-13) */
    var layers = self.layersOf(u);
    if (!layers.length) {
      /* 아직 그림이 없다 — 상자를 갈아엎지 않는다. `_refreshUnits` 가 그림이
       * 도착한 뒤 다시 부르고, 그때 층이 채워진다. */
      if (old) return old;
    }

    if (old && old.parentNode) old.parentNode.removeChild(old);
    var box = el('div', 'g2-unit', self.unitLayer);
    box._unit = u; /* 지형 preview의 발 위치 샘플만 참조; 논리 유닛은 변경하지 않는다. */
    /* ★ `preserve-3d` — **발밑 그림자를 지면에 눕히려면** 자식이 3D 공간에
     *   있어야 한다(`_빌보드적용` 의 `_shd` 처리). 층(`_layers`)은 전부 z=0 이라
     *   깊이 동률 → DOM 순서·`z-index` 로 정렬돼 예전과 같다. */
    box.style.cssText =
      'position:absolute;transform-origin:50% 100%;transform-style:preserve-3d;' +
      'image-rendering:' + rend() + ';';
    /* ★ 그림자를 **맨 먼저** 붙인다 — 원본도 본체보다 먼저 그린다(`0x130D5`) */
    box._shd = el('div', 'g2-shadow', box);
    box._shd.style.cssText = 'position:absolute;background-repeat:no-repeat;' +
                             'image-rendering:' + rend() + ';pointer-events:none;';
    box._layers = layers.map(function (L) {
      var im = el('div', '', box);
      /* 그림·크기·위치는 updateUnit 이 **프레임마다** 채웁니다 (원본 직독). */
      im.style.cssText = 'position:absolute;background-repeat:no-repeat;' +
                         'image-rendering:' + rend() + ';';
      return { el: im, meta: L.meta, no: L.no, rider: !!L.rider };
    });
    box._그림정보 = box._layers[0] ? box._layers[0].el : null;   // 옛 이름 유지
    box._meta = layers[0] ? layers[0].meta : null;
    box._layerSig = sig;
    self.unitEls[u.id] = box;
    /* ★ 층이 0개면 `updateUnit` 을 부르지 않는다 — 그쪽이 다시 여기로 와 무한 재귀. */
    if (box._layers.length) self.updateUnit(u);
    return box;
};

/**
 * ★★ [리마스터] 유닛이 **실제로 발을 딛는 맵 y** — 이펙트를 캐릭터에 붙일 때 쓴다.
 *
 * 원본은 2D 평면이라 이펙트 좌표를 원본 상수 그대로 쓰면 그대로 맞았지만, 우리는
 * 기울기·확대가 걸린 2.5D 빌보드라 **같은 좌표가 같은 그림을 만들지 않는다.**
 * 원본 숫자를 고집하면 오히려 원본과 다르게 **보인다**(파이어애로우 명중 불꽃이
 * 캐릭터 위로 떴다 — 사용자 지적 2026-08-15).
 *
 * 그래서 **메커니즘은 원본, 최종 접지는 실행기 기준**으로 나눈다.
 * `updateUnit` 이 `_빌보드놓기(box, …, py − oy + bh, bh)` 로 심어 둔 `_ground`
 * 가 곧 그 유닛의 접지선이다. 아직 안 그려졌으면 원본식(`y×16 − 2 + 13`)으로 낸다
 * — 13 은 캐릭터 249장 프레임0 하단 오프셋의 중앙값(전수 실측 2026-08-15).
 *
 * @returns {number} 맵 픽셀 y
 */
Renderer.prototype.unitFootMapY = function (u) {
  var box = u && this.unitEls && this.unitEls[u.id];
  /* ★ `_ground`(= 박스 아래끝)를 쓰면 **투명 여백만큼 아래**로 잡혀 이펙트가
   *   과하게 내려간다(사용자 지적 2026-08-15 「너무 낮아졌는데?」).
   *   회전축으로 쓰는 `_footY`(현재 표시 프레임의 실제 최하단 불투명 픽셀)가
   *   진짜 발끝이다. 박스 top 은 `_py − _oy`. */
  if (box && box._py != null && box._oy != null && box._footY != null)
    return (box._py | 0) - (box._oy | 0) + (box._footY | 0);
  /* 박스가 아직 없을 때의 대체값 — 칸 기준점 `ty * 16` 에서
   * `- 2 + 13` 만큼 내린 자리를 발끝으로 본다
   * (`03_분석/COMBATII/좌표_어긋남_원인규명.md` — 칸 안에서 접지선이 서는 자리).
   * ☐ `13` 이 어느 원본 값에서 나왔는지는 아직 못 찾았다 —
   *   위쪽 `_footY`(실제 표시 프레임의 발끝)가 있으면 그쪽이 이긴다. */
  return (u ? (u.y | 0) : 0) * TH - 2 + 13;
};

/**
 * ★★ [리마스터] 유닛 **몸통 한가운데**의 맵 y — 발이 아니라 몸에서 터지는
 *   연출(파이어볼 폭발 등)을 맞출 때 쓴다. 사용자 지정 2026-08-15:
 *   「파이어볼은 발에서 터지는 게 아니라서 … **중앙 보정**을 하는 게 좋아 보여.」
 *
 *   그림 상단(`_topY`)과 실제 발끝(`_footY`)의 가운데다. 둘 다 박스 안 좌표이고
 *   박스 top 은 `_py − _oy`. 아직 안 그려졌으면 원본식 절반으로 떨어진다.
 */
Renderer.prototype.unitMidMapY = function (u) {
  var box = u && this.unitEls && this.unitEls[u.id];
  if (box && box._py != null && box._oy != null &&
      box._footY != null && box._topY != null) {
    return (box._py | 0) - (box._oy | 0) +
           Math.round(((box._topY | 0) + (box._footY | 0)) / 2);
  }
  return (u ? (u.y | 0) : 0) * TH - 2 + 6;      // 13 의 절반쯤
};

/**
 * 연출이 선언한 놓는 뜻과 그림 기준점으로 최종 y 보정값을 낸다.
 * 표시 프레임의 발끝·몸통은 Renderer 결과이므로 이 아래층이 읽고, 연출에는 값만 돌려준다.
 * 산식은 옛 `magicfx.표시기준보정`과 같다. 접지 정책 자체는 바꾸지 않는다.
 */
Renderer.prototype.연출표시기준보정 = function (u, base, fr, 놓는뜻, 그림점) {
  if (!u || !fr || !fr.canvas) return 0;
  var 표시자리;
  if (놓는뜻 === '발끝') 표시자리 = this.unitFootMapY(u);
  else if (놓는뜻 === '몸통중앙') 표시자리 = this.unitMidMapY(u);
  else throw new Error('알 수 없는 연출 놓는 뜻: ' + 놓는뜻);
  if (그림점 !== '바닥' && 그림점 !== '중앙')
    throw new Error('알 수 없는 연출 그림점: ' + 그림점);
  if (표시자리 == null) return 0;
  var fh = fr.canvas.논리h || fr.canvas.height;
  var 그림자리 = 그림점 === '바닥' ? fh : Math.round(fh / 2);
  return (표시자리 | 0) - ((base.y | 0) + (fr.ay | 0) + 그림자리);
};

/** 유닛 한 명의 프레임·위치 갱신 (탈것 + 탑승자를 함께) */
/* ★ 지형 잠김 표 — 원본 `0x70A58` (`지형_이동효과_원본확정.md`).
 *   색인 = `(지형값 − 0x65) & 0x0F`. 값 = **잠기는 픽셀 수**.
 *   ★ 색인 **11~15 는 맵 341개 전수로 한 번도 안 쓰인다** (2026-08-27 확정 ·
 *     `04_도구/조사/지형니블_전수.js`). 그래서 0 으로 두어도 화면이 같다.
 *     실제로 쓰이는 것은 **0~10** 뿐이고, 가장 많은 것은 색인 10(눈 10001칸)이다.
 *     자세히: `03_분석/COMBATII/지형_이동효과_원본확정.md` §4 */
/* ★★★★★ **잠김 표 — EXE `0x70A58` 그대로** (2026-09-08 검산)
 *   `0x132F5 sub al,0x65` · `0x132F7 and al,0xF` 로 니블을 만들고
 *   `0x13303 mov al, [eax + 0x70A58]` 로 읽는다 ⇒ **색인 0~15 전부 쓸 수 있다.**
 *   실측 — `node 04_도구/EXE_표읽기.js 0x70A58 16` → `0 8 8 4 0 0 4 0 0 0 4 16 **49 81 32 1**`
 *   ☠ 2026-09-08 에 뒤 넷을 원본 값으로 채웠다가 **되돌렸다.** `and 0xF` 만 보면
 *     색인 0~15 를 다 쓸 수 있어 보이지만, **맵 341개를 전수로 훑어 색인 11~15 가
 *     한 번도 안 쓰이는 것이 확정돼 있다**(2026-08-27 · `04_도구/지형_잠김.test.js`).
 *     실제 데이터에 없으므로 0 이든 원본값이든 화면은 같고, 시험이 0 을 요구한다. */
Renderer.SINK_TABLE = [0, 8, 8, 4, 0, 0, 4, 0, 0, 0, 4, 0x10,
                       0, 0, 0, 0];   /* 0x0C~0x0F — **맵 341개 전수로 한 번도 안 쓰인다** (0x70A58) */

function 유닛대열분류(battle, u) {
  /* 천지 0x3446B~0x34674: 등록 대상들을 그린 뒤 시전자를 직접 다시 그린다.
   * 평상시 행 정렬을 이 도막에 적용하면 앞 행의 타겟이 시전자를 덮는다. */
  if (u._연출최후그림) return { 목록D: false, row: 0x7FFFFFF, kind: 4 };
  var 칸 = null;
  try { 칸 = battle && battle.tile ? battle.tile(u.x | 0, u.y | 0) : null; } catch (e) {}
  var 지형 = 칸 ? (칸['값'] | 0) : 0;
  var bl = (지형 < 0x64) ? (지형 & 0x0F) : 0;              /* 0x12637 · 0x1263E */
  var 목록D = (bl === 8);                                  /* 0x12659 */
  return { 목록D: 목록D,
           row: 목록D ? 0x7FFFFFF : (u.y | 0),
           kind: 목록D ? 3 : (u.attackPose ? 2 : 1) };
}

function 유닛층경계(층들) {
  var ox = 0, oy = 0, rx = 0, ry = 0;
  (층들 || []).forEach(function (l) {
    ox = Math.max(ox, l.meta['기준점'][0]);
    oy = Math.max(oy, l.meta['기준점'][1]);
    rx = Math.max(rx, l.meta['칸'][0] - l.meta['기준점'][0]);
    ry = Math.max(ry, l.meta['칸'][1] - l.meta['기준점'][1]);
  });
  return { ox: ox, oy: oy, w: ox + rx, h: oy + ry };
}

/* `0x12F3D`·`0x12F52`·`0x131CB`·`0x131C6`: 타일 위치와 걷기 픽셀 오프셋. */
function 유닛맵위치(renderer, u) {
  var m = renderer.mapOf(u);
  return { x: m.x + 12 + (u.ox | 0), y: m.y - 2 + (u.oy | 0) };
}

/* 층 앵커 경계에 피격·연출 픽셀 오프셋 `[+0x65]/[+0x66]`을 합친다. */
function 유닛상자경계(층들, u) {
  var 경계 = 유닛층경계(층들);
  return { ox: 경계.ox + (u.px | 0), oy: 경계.oy + (u.py | 0),
           w: 경계.w, h: 경계.h };
}

/* 계산 결과를 유닛 DOM 상자의 공통 위치·정렬 메타에 한 번에 반영한다. */
function 유닛상자기본반영(box, 위치, 대열, 경계) {
  box._px = 위치.x; box._py = 위치.y;
  box._목록D = 대열.목록D; box._row = 대열.row; box._kind = 대열.kind;
  box.style.width = 경계.w + 'px'; box.style.height = 경계.h + 'px';
}

/* 탑승자와 탈것 모두 유닛의 방향·모션을 사용한다 (`0x13175`·`0x1318A`). */
function 유닛프레임위치(메타, u) {
  메타 = 메타 || {};
  var 행 = 메타['행'] || 4;
  var 열 = 메타['열'] || 메타['방향당프레임'] || 11;
  var 방향 = ((u.dir | 0) % 행 + 행) % 행;
  var 모션 = Math.min(u.motion | 0, 열 - 1);
  return { 행: 행, 열: 열, 방향: 방향, 모션: 모션, 번호: 방향 * 열 + 모션 };
}

function 유닛표시여부(u, 사망연출중, 연출감춤) {
  return !!((u.alive || 사망연출중) && !연출감춤 && !u.감춤);
}

/* 일반 유닛 잠김 그리기 `0x13079`·`0x1308D`·`0x13090`의 층별 결과.
 * 실제 style 반영은 표시 계층인 updateUnit에 남긴다. */
function 유닛잠김층정보(현재위, 높이, 잠김, 한계) {
  var 옮긴위 = 현재위 + 잠김;                              /* 0x13079 */
  return { 위: 옮긴위, 아래자름: Math.max(0, 옮긴위 + 높이 - 한계) };
}

/* `0x13079`·`0x1308D`·`0x13090` 계산 결과를 층별 DOM에 적용한다. */
function 유닛잠김층반영(층들, 잠김, 한계) {
  층들.forEach(function (층) {
    if (!층.el || 층.el.style.display === 'none') return;
    var 정보 = 유닛잠김층정보(parseFloat(층.el.style.top) || 0,
                                parseFloat(층.el.style.height) || 0, 잠김, 한계);
    층.el._지형아래자름 = 정보.아래자름 | 0;
    층.el.style.top = 정보.위 + 'px';
    층.el.style.clipPath = 정보.아래자름 > 0
      ? ('inset(0 0 ' + 정보.아래자름 + 'px 0)') : '';
  });
}

function 유닛잠김층해제(층들) {
  층들.forEach(function (층) {
    if (!층.el) return;
    층.el._지형아래자름 = 0;
    if (층.el.style.clipPath) 층.el.style.clipPath = '';
  });
}

/* 소환 중에는 각 sprite만 dy+표시Y 이동한다. 원본 솟음 crop은 dy만으로 계산하고,
 * 지형 잠김도 같은 clipPath를 사용하므로 두 아래 자름만 합성한다. */
function 유닛솟음층반영(층들, dy, 표시Y) {
  dy = Math.max(0, dy | 0);
  표시Y = 표시Y | 0;
  if (!dy && !표시Y) return;
  층들.forEach(function (층) {
    var e = 층 && 층.el;
    if (!e || e.style.display === 'none') return;
    var 위 = parseFloat(e.style.top) || 0;
    var h = Math.max(0, parseFloat(e.style.height) || 0);
    var 지형자름 = Math.max(0, e._지형아래자름 | 0);
    var 아래자름 = Math.max(dy, 지형자름 + dy);
    if (h) 아래자름 = Math.min(h, 아래자름);
    /* `dy`는 원본 상승·crop이고 표시Y는 제품 몸체 기준점 보정이다.
     * 둘은 독립이며 crop의 보이는 행 수에는 표시Y를 섞지 않는다. */
    e.style.top = (위 + dy + 표시Y) + 'px';
    e.style.clipPath = 아래자름 > 0 ? ('inset(0 0 ' + 아래자름 + 'px 0)') : '';
  });
}

/* 정본 256 — 0x5F611 가로 솎기: xstep = 폭×100000÷목표폭(0x5F63C mul · 0x5F643 div) · 줄마다 esi = xstep(0x5F675)
 * 열마다 esi −= 100000(0x5F679) · 음수면 esi += xstep 하고 건너뜀(0x5F681) · 아니면 그린다(0x5F686). 그린 열 번호를 돌려준다. */
function 소멸가늘기열(폭, 목표폭) {
  폭 = 폭 | 0; 목표폭 = Math.max(1, 목표폭 | 0);
  var 걸음 = Math.floor(폭 * 100000 / 목표폭), 누적 = 걸음, 열 = [];
  for (var c = 0; c < 폭; c++) {
    누적 -= 100000;
    if (누적 < 0) 누적 += 걸음;
    else 열.push(c);
  }
  return 열;
}
Renderer.소멸가늘기열 = 소멸가늘기열;

/* 현재 유닛 프레임을 각 DOM 층에 반영한다. 프레임 선택 계산은
 * `유닛프레임위치`가 맡고, 이 함수는 표시 쓰기와 상단 측정만 맡는다. */
function 유닛층그리기(renderer, u, 층들, ox, oy) {
  var topY = null;
  층들.forEach(function (층, i) {
    var 메타 = 층.meta;
    var 위치 = 유닛프레임위치(메타, u);                 /* 0x13175 · 0x1318A */
    var 파일 = renderer._스프라이트파일(메타, 층.no);
    var 프레임 = renderer._유닛프레임정보(파일, 위치.번호);
    if (!프레임) { 층.el.style.display = 'none'; return; }
    층.el.style.display = '';

    var 발광 = renderer._glow && renderer._glow[u.id];
    var url = null, key = 프레임;
    var 가늘 = (u._소멸가늘기 | 0) > 0 && 프레임.canvas && typeof document !== 'undefined' ? (u._소멸가늘기 | 0) : 0;
    var 가늘열 = 가늘 ? 소멸가늘기열(프레임.w | 0, 가늘) : null;                       /* ★ 보통 몸은 그림 «객체»가 열쇠 — 팔레트가 바뀌면 캐시가 새 객체를 낸다 */
    if (발광 != null) {
      url = renderer._실루엣그림정보(프레임, 발광);       /* 0x5F517 단색 실루엣 */
      key = 프레임.url + '#발광' + 발광;
    } else if (u.치환표 === 2) {
      url = renderer._치환표2그림(파일, 위치.번호, 프레임);   /* 소울리콜 초록 몸 — 0x2B6AB~0x2B6DA 치환표 2 */
      key = 프레임.url + '#표2';
    }
    if (가늘) key = '가늘#' + 가늘 + '#' + (프레임.열쇠 || 프레임.url || 위치.번호);
    if (층.el._url !== key) {
      층.el._url = key;
      var 판 = 층.el._판;
      if (가늘) {
        /* 정본 256 — 0x5F611(목표폭 ecx = 가늘 · 목표높이 1): 줄은 다 그리고 가로만 열을 솎는다 · 솎인 열은 자리를 안 차지한다 */
        var 가폭 = 가늘열.length;
        층.el.style.cssText = 'position:absolute;width:' + 가폭 + 'px;height:' + 프레임.h + 'px;z-index:' + i + ';';
        if (!판) { 판 = 층.el._판 = document.createElement('canvas'); 층.el.appendChild(판); }
        var 가원 = 프레임.canvas, 가N = 가원.width / (가원.논리w || 가원.width);
        판.width = Math.max(1, Math.round(가폭 * 가N)); 판.height = 가원.height;
        var g가 = 판.getContext('2d');
        g가.clearRect(0, 0, 판.width, 판.height);
        /* 9인자 — 원본 사각형은 논리 좌표(스케일러가 N배로 바꾼다 · scaler.js drawImage 보정) */
        for (var 가j = 0; 가j < 가폭; 가j++)
          g가.drawImage(가원, 가늘열[가j], 0, 1, 가원.논리h || 가원.height, Math.round(가j * 가N), 0, Math.round(가N), 판.height);
        판.style.cssText = 'display:block;width:' + 가폭 + 'px;height:' + 프레임.h + 'px;image-rendering:' + rend() + ';';
      } else if (url == null && 프레임.canvas && typeof document !== 'undefined') {
        /* ★ 보통 몸 — PNG 로 굽지 않고 층 안 캔버스에 바로 칠한다 (2026-10-06 · 위 `_유닛프레임정보` 주석) */
        층.el.style.cssText = 'position:absolute;width:' + 프레임.w + 'px;height:' + 프레임.h + 'px;z-index:' + i + ';';
        if (!판) { 판 = 층.el._판 = document.createElement('canvas'); 층.el.appendChild(판); }
        if (판.width !== 프레임.canvas.width) 판.width = 프레임.canvas.width;
        if (판.height !== 프레임.canvas.height) 판.height = 프레임.canvas.height;
        var g판 = 판.getContext('2d');
        g판.clearRect(0, 0, 판.width, 판.height);
        /* ☠ 스케일러가 drawImage 를 가로챈다 — 원본 사각형은 논리 크기, 목적지는 실제 크기로 준다(_오브젝트색칠하기 와 같은 꼴) */
        var 원판 = 프레임.canvas;
        g판.drawImage(원판, 0, 0, 원판.논리w || 원판.width, 원판.논리h || 원판.height, 0, 0, 판.width, 판.height);
        판.style.cssText = 'display:block;width:' + 프레임.w + 'px;height:' + 프레임.h + 'px;image-rendering:' + rend() + ';';
      } else {
        if (판) 판.style.display = 'none';
        층.el.style.cssText = 'position:absolute;background-repeat:no-repeat;' +
          'image-rendering:' + rend() + ';' + bgcss(url || 프레임.url, 프레임.w, 프레임.h) +
          'width:' + 프레임.w + 'px;height:' + 프레임.h + 'px;z-index:' + i + ';';
      }
    }
    층.el.style.left = (ox + (프레임.ax | 0) + (가늘 >> 1)) + 'px';   /* 정본 256 — 0x469E0 sar eax,1 · 0x469F0 add eax,edx : x = X + 가늘/2 */
    var 위 = oy + (프레임.ay | 0);
    층.el.style.top = 위 + 'px';
    층.el.style.zIndex = i;
    if (topY == null || 위 < topY) topY = 위;
  });
  return topY;
}

/* 그림자 선택에 필요한 현재 본체 프레임. 메타 `+6` 그림자 번호와
 * 위치 메타 `+7/+8`은 이 프레임 한 장에서 함께 나온다. */
function 유닛그림자프레임(메타, 원본프레임표, u) {
  메타 = 메타 || {};
  var 파일 = 메타['파일'];
  var 프레임들 = 파일 && 원본프레임표 && 원본프레임표[파일];
  var 위치 = 유닛프레임위치(메타, u);
  var 프레임 = 프레임들 && 프레임들[위치.번호];
  return { 프레임: 프레임 || null,
           그림자번호: (프레임 && 프레임.그림자 != null) ? (프레임.그림자 | 0) : 0 };
}

/* `0x1309D`·`0x130AF`: 잠긴 유닛과 지형 니블 8은 그림자를 생략한다. */
function 유닛그림자표시가능(옵션값, 잠김, 지형니블) {
  return 옵션값 !== '끔' && (잠김 | 0) <= 0 && (지형니블 | 0) !== 8;
}

/* 지형 효과 발자국 폭. 큰 프레임만 헤더 `fw`를 쓰며 NC2는 1이다. */
function 유닛지형효과폭(본체메타, 원본프레임표, 방향, 모션) {
  var 파일 = 본체메타 && 본체메타['파일'];
  var 프레임들 = 파일 && 원본프레임표 && 원본프레임표[파일];
  var 열 = (본체메타 && (본체메타['열'] || 본체메타['방향당프레임'])) || 11;
  var 프레임 = 프레임들 && 프레임들[방향 * 열 + 모션];
  return (프레임 && 프레임.fw) ? Math.max(1, 프레임.fw | 0) : 1;
}

/* 0x133B1~0x13403: 잠김 지형의 MAP_EFFC 도막을 유닛 층 위에 반영한다.
 * 좌표·앵커·보정값은 기존 updateUnit의 값을 그대로 입력받는다. */
function 유닛지형효과그리기(renderer, box, 잠김, 지형니블, 본체메타,
                              방향, 모션, 바닥, ox, 그림자x, 층수) {
  var 칸들 = box._효과칸 || (box._효과칸 = []);
  if (!(잠김 > 0) || 지형니블 < 0) {
    칸들.forEach(function (c) { c.style.display = 'none'; });
    return;
  }
  var 폭 = 유닛지형효과폭(본체메타, renderer._usprRaw, 방향, 모션);
  var 애니 = (renderer._지형효과프레임 | 0) & 1;          /* [0xBA84C] */
  var sp = renderer._지형효과URL(지형니블, 애니);
  if (!sp) {
    칸들.forEach(function (c) { c.style.display = 'none'; });
    return;
  }
  var 무늬보정 = 4;
  var y = 바닥 + 무늬보정 + 잠김 + 2 + (sp.ay | 0);      /* 0x133BE · 0x5F3FD */
  for (var k = 0; k < 폭; k++) {
    var c = 칸들[k];
    if (!c) {
      c = el('div', 'g2-지형효과', box);
      c.style.position = 'absolute'; c.style.pointerEvents = 'none';
      c.style.imageRendering = rend();
      칸들[k] = c;
    }
    if (c._url !== sp.url) {
      c._url = sp.url;
      c.style.backgroundImage = 'url(' + sp.url + ')';
      c.style.backgroundSize = sp.w + 'px ' + sp.h + 'px';
      c.style.width = sp.w + 'px'; c.style.height = sp.h + 'px';
    }
    c.style.display = '';
    c.style.left = Math.round(ox + 그림자x + k * TW) + 'px'; /* 0x1329E · 0x133F4 */
    c.style.top = Math.round(y) + 'px';
    c.style.zIndex = String(층수 + 5);
  }
  for (var k2 = 폭; k2 < 칸들.length; k2++) 칸들[k2].style.display = 'none';
}

/* 0x1309D~0x130D5: 현재 본체 프레임의 그림자를 유닛 DOM 첫 층에 반영한다. */
function 유닛그림자그리기(renderer, u, box, 층들, ox, oy) {
  var e = box._shd; if (!e) return;
  var 그림자옵션 = null;
  try { var C = (root.__Opt && root.__Opt.cfg) || {}; 그림자옵션 = C['그림자']; } catch (x) {}
  if (!유닛그림자표시가능(그림자옵션, box._잠김, box._지형니블)) {
    e.style.display = 'none'; return;
  }
  /* ★ 2026-09-24 (사장님: 「소환 중간에 그림자가 먼저 나오는 문제」)
   *   0x21944 솟음 동안 원본은 몸체만 0x5F4AF 로 그린다 — 그림자는 맵 그리기(칸 점유)
   *   몫이라 연출이 끝나 자리에 선 뒤에야 나온다. 솟음 값이 걸린 동안은 그림자를 끈다. */
  if (box._소환솟음Dy || box._소환표시Y) { e.style.display = 'none'; return; }
  if (u._소멸가늘기) { e.style.display = 'none'; return; }   /* 정본 256 — 0x468BC 는 칸에서 뺀 뒤라 그림자(맵 그리기 몫)가 없다 */
  var m = 층들[0] && 층들[0].meta;
  var 정보 = 유닛그림자프레임(m, renderer._usprRaw, u);
  var f0 = 정보.프레임;
  e._shdNo = 정보.그림자번호;
  var sh = renderer._그림자그림정보(정보.그림자번호);
  if (!sh) { e.style.display = 'none'; return; }
  if (e._url !== sh) {
    e._url = sh;                                    /* ★ 그림 «객체»가 열쇠 — 팔레트가 바뀌면 캐시가 새 객체를 낸다 */
    e.style.width = sh.w + 'px'; e.style.height = sh.h + 'px';
    if (sh.canvas && typeof document !== 'undefined') {
      /* ★ PNG 로 굽지 않고 칸 안 캔버스에 바로 칠한다 (2026-10-06 · 선라이트 끊김) */
      e.style.backgroundImage = 'none';
      var 판 = e._판;
      if (!판) { 판 = e._판 = document.createElement('canvas'); e.appendChild(판); }
      if (판.width !== sh.canvas.width) 판.width = sh.canvas.width;
      if (판.height !== sh.canvas.height) 판.height = sh.canvas.height;
      판.style.cssText = 'display:block;width:' + sh.w + 'px;height:' + sh.h + 'px;image-rendering:' + rend() + ';';
      var g판 = 판.getContext('2d'); g판.clearRect(0, 0, 판.width, 판.height);
      g판.drawImage(sh.canvas, 0, 0, sh.canvas.논리w || sh.canvas.width, sh.canvas.논리h || sh.canvas.height, 0, 0, 판.width, 판.height);
    } else {
      if (e._판) e._판.style.display = 'none';
      e.style.backgroundImage = 'url(' + sh.url + ')';
      e.style.backgroundSize = sh.w + 'px ' + sh.h + 'px';
    }
  }
  e.style.display = '';
  e.style.zIndex = '';
  e.style.left = Math.round(ox + (f0 && f0.그림자x != null ? f0.그림자x : -(sh.w / 2))) + 'px'; /* 0x12FF6 · 0x130CB */
  e.style.top = Math.round(oy + (f0 && f0.그림자y != null ? f0.그림자y : -(sh.h / 2)) + 12) + 'px'; /* 0x13004 · 0x130C0 */
}

/* 표시 프레임의 발끝을 접지 메타와 회전축에 기록하고 최종 빌보드 위치를 반영한다.
 * mapOf 결과와 상자 경계를 그대로 받아 좌표 계산을 새로 만들지 않는다. */
function 유닛최종배치(renderer, box, 위치, 경계, 발끝) {
  box._footY = 발끝;
  box.style.transformOrigin = '50% ' + 발끝 + 'px';
  renderer._빌보드놓기(box, 위치.x - 경계.ox,
                           위치.y - 경계.oy + 경계.h, 경계.h);
}

/* 유닛 지형 표시 판정만 계산한다. DOM과 Renderer 인스턴스 상태를 쓰지 않는다.
 * 원본 일반 유닛 그리기 `0x12F2A`의 `0x13036`(전투 종류), `0x13043`(비행),
 * `0x13054`(지형값), `0x13068`(표 `0x70A58`) 갈래를 그대로 둔다. */
function 유닛지형표시정보(battle, u, 본체메타, 원본프레임표, 방향, 열수, 모션, 잠김표) {
  var 결과 = { 잠김: 0, 지형니블: -1, 그림자y: 0, 그림자x: 0 };
  try {
    if (!battle || (battle.battleKind | 0) >= 4 || ((u.f14 | 0) & 1)) return 결과;
    var 칸 = battle.tile ? battle.tile(u.x | 0, u.y | 0) : null;
    var 지형값 = 칸 ? (칸['값'] | 0) : 0;
    if (지형값 <= 0x64) return 결과;

    결과.지형니블 = (지형값 - 0x65) & 0x0F;
    var 파일 = 본체메타 && 본체메타['파일'];
    var 프레임들 = 파일 && 원본프레임표 && 원본프레임표[파일];
    var 프레임 = 프레임들 && 프레임들[방향 * 열수 + 모션];
    if (프레임) {
      결과.그림자y = 프레임['그림자y'] | 0;              /* 0x132AA · 0x13000 */
      결과.그림자x = 프레임['그림자x'] | 0;              /* 0x1329E · 0x12FF6 */
    }
    결과.잠김 = 잠김표[결과.지형니블] | 0;                /* 0x13068 · 0x70A58 */
    return 결과;
  } catch (e) {
    return { 잠김: 0, 지형니블: -1, 그림자y: 0, 그림자x: 0 };
  }
}

/** 화면에만 적용할 유닛 표시 상태를 기록한다. 모델 객체는 건드리지 않는다. */
Renderer.prototype.setUnitPresentation = function (u, state) {
  if (!u || !state) return;
  if (!this._unitPresentation) this._unitPresentation = Object.create(null);
  this._unitPresentation[u.id] = {
    motion: state.motion | 0, dir: state.dir | 0,
    ox: state.ox | 0, oy: state.oy | 0
  };
};

/** 지정 유닛의 화면 표시 대체를 해제한다. 다음 apply()가 모델을 다시 그린다. */
Renderer.prototype.clearUnitPresentation = function (units) {
  var shown = this._unitPresentation;
  if (!shown) return;
  (units || []).forEach(function (u) { if (u) delete shown[u.id]; });
};

/** 유닛 하나의 프레임·그림자·상태효과·최종 배치를 갱신한다. */
Renderer.prototype.updateUnit = function (u) {
  /* 원본은 0x287DD에서 화면을 그린 뒤 0x28802에서 모델을 민다.
   * 숫자 루프 중에는 대상의 직전 장 표시 상태만 투영하고 모델은 그대로 둔다. */
  var 표시 = this._unitPresentation && this._unitPresentation[u.id];
  if (표시) u = Object.assign({}, u, 표시);
  var box = this.unitEls[u.id];
  if (box) box._칸 = [u.x | 0, u.y | 0];   /* 겹침 차례(_유닛돔차례) — 같은 줄은 x 가 작은 쪽 먼저 */
  var sig = (u.sprIndex | 0) + ':' + (u.rider && u.rider.sprIndex != null ? u.rider.sprIndex : '-');
  /* 층이 0개면 다시 짓는다 — 메타가 아직 없을 때(원본 그림을 비동기로 읽는 중)
   * 만들어진 빈 상자가 sig 가 같다는 이유로 영영 안 고쳐졌다 (할일 3 · 19-e).
   * ★ `_ensureUnit` 은 층이 0개면 `updateUnit` 을 안 부르므로 여기서 순환하지 않는다. */
  /* ★ 여기서 층 수를 보면 `_ensureUnit → updateUnit → _ensureUnit` 무한 재귀가 된다
   *   (층이 영영 안 채워지는 경우). 층 수 판단은 **`_ensureUnit` 한 곳에서만** 한다. */
  if (!box || box._layerSig !== sig || !(box._layers || []).length)
    box = this._유닛상자확보(u);
  if (!box || !(box._layers || []).length) return;   // 그림이 아직 — 이번 프레임은 건너뛴다
  /* ★ `_hidden` — 연출이 유닛을 잠시 맵에서 지울 때 씁니다 (원본 `[+0x63] = 0` →
   *   `0x11EE4` 로 그 칸을 다시 그리는 자리). 여기서 매 프레임 display 를 되살리므로
   *   바깥에서 style 만 건드리면 곧바로 덮입니다 — 그래서 플래그로 둡니다.
   *   초필살기 12번(0x3AFED)이 `io.nsp` 를 대신 그리는 동안 켭니다. */
  /* ★ `_dying` — **사망 연출이 도는 동안**은 죽었어도 계속 그립니다.
   *   원본은 연출을 먼저 돌리고(`0x1DBB7` → `0x46A11`/`0x46B2C`) 리스트에서 빼는 건
   *   맨 끝(`0x1DD9C call 0x1137A`)입니다. 우리는 셈이 `alive = false` 를 먼저 넣으므로
   *   이 플래그가 없으면 **회전을 보기도 전에 사라집니다**(할일 4번의 증상). */
  /* ★★★ `u.감춤` — SCE `op 0x04` **모드 1**(`0x508E6(4)`)이 세우는
   *   **논리 상태**다. `_hidden` 은 연출용 임시 플래그라 새로 그리면 풀리지만,
   *   `감춤` 은 다른 명령이 되돌릴 때까지 남는다.
   *   ★ `alive` · 대기열 · 맵 점유는 **그대로**다 — 그림만 안 보인다.
   *   (`SCE_op04_퇴장_op6C_능력_원본확정.md` §12) */
  box.style.display = 유닛표시여부(u, this._dying[u.id], this._hidden[u.id]) ? '' : 'none';
  var L = box._layers || [];
  if (!L.length) return;
  /* 계측 — 화면에 «반영된» 모션·방향 (04_도구/우리그리기기록.js 유닛상태 · 원본은 화면 전송 때 레코드를 읽는다 — 모델만 바뀌고 반영 전이면 옛 그림이 보인다) */
  box._그린모션 = u.motion | 0; box._그린방향 = u.dir | 0;

  /* 기준점을 (x*24+12, y*16−2) 에 맞춥니다 — 0x12F2A · 0x10971 · 0x10988
   *
   * ★ 픽셀 오프셋 `u.ox` / `u.oy` 는 원본 유닛 구조의 `[+0x65]` / `[+0x66]` 입니다.
   *   걷기 연출(0x15C45)이 반 칸을 4px 씩 나눠 밀 때 여기에 쌓이고,
   *   `0x12124`(행동 소진 포즈)가 둘 다 0 으로 되돌립니다.
   *   타일만 보던 예전 구현은 칸 단위 순간이동이 될 수밖에 없었습니다. */
  /* 좌표 창구 `mapOf` + 그리기 앵커 보정 — `0x12F3D add eax, 0xC` · `0x12F52 sub eax, 2`.
   * `[+0x65]`·`[+0x66]` 밀림 오프셋(`u.ox`·`u.oy`)을 더한다(`0x131CB`·`0x131C6`). */
  var _위치 = 유닛맵위치(this, u);
  var px = _위치.x, py = _위치.y;
  /* 앞뒤 가림 정렬 키 — 원본 0x12567 은 **타일 y** 하나만 봅니다(픽셀 오프셋 X).
   * 같은 행에서는 오브젝트(0) 뒤에 유닛(1). (_sortSprites 주석 참고) */
  /* ★ `_kind` — 같은 행 안의 그리기 차례 (`0x12BEE` 목록 A → C → B).
   *   0 오브젝트 · 1 평상시 유닛(목록 C `0xE4C8C`) · **2 공격 중 유닛**(목록 B `0xE4854`).
   *   `u.attackPose` 가 원본 `[+0x6B]` 이고 `0x12691` 이 이 둘을 가른다.
   *   그래서 **공격 중인 유닛이 같은 행의 상대 위로 올라온다**(`_sortSprites` 주석). */
  /* ★★★★★ **목록 D — 절벽 위 유닛은 모든 행보다 위** (2026-08-27 · 작업지시 단계 5)
   *
   *   원본 `0x12567` 이 유닛을 세 목록으로 가른다 —
   *   ```asm
   *   0x12635  dl = [그 칸의 지형 바이트]
   *   0x12637  cmp dl, 0x64 / jae 0x12646   ; >= 0x64 면 bl = 0
   *   0x1263E  bl = dl & 0x0F               ;  <  0x64 면 하위 니블
   *   0x12659  cmp bl, 8 / jne 0x12680
   *   0x1266B    ecx = 0x74FB6              ; ★ **목록 D** — 행 루프 **밖**(0x12D33) = 맨 위
   *   0x12691  cmp [유닛+0x6B], 0
   *   0x1269C    != 0 → 목록 B (0x74FC4)    ;   공격 표를 쓰는 중
   *   0x126A8    == 0 → 목록 C (0x74FBE)    ;   평상시
   *   ```
   *   지형 니블 **8 = 절벽**(`native.js mapTerrain` 의 「지형8(절벽)」과 같은 값).
   *   높은 지대에 선 유닛이니 앞의 모든 것보다 위로 보이는 것이 맞다.
   *
   *   ★ `_sortSprites` 는 `_row` 를 먼저 보므로, D 는 `_row` 를 **맵보다 큰 값**으로
   *     두어 대열 맨 뒤(= 화면 맨 위)로 보낸다. `_row` 를 읽는 곳은 `_sortSprites`
   *     하나뿐이라(전수 확인) 다른 계산이 안 흔들린다. */
  var _대열 = 유닛대열분류(this.b, u);

  /* 상자 크기는 가장 큰 층에 맞추고, 상자 안 좌표는 **기준점을 원점**으로 잡습니다.
   * 층마다 자기 기준점만큼 왼쪽·위로 밀면 두 장이 자동으로 정렬됩니다. */
  var _경계 = 유닛상자경계(L, u);
  var ox = _경계.ox, oy = _경계.oy, bw = _경계.w, bh = _경계.h;
  /* ★★★ [원본] **유닛 픽셀 오프셋** `[+0x65]`(x) · `[+0x66]`(y) — 2026-08-26
   *
   *   `그리기계열_분석.md` §883 `0x12143 [+0x66]=0 · [+0x65]=0 ; 픽셀 오프셋 초기화` ·
   *   `SCE_op0A_HP증감_원본확정.md` §227 `[+0x65] -= tblX · [+0x66] -= tblY`(피격 흔들림).
   *   회복6 Revible 은 `0x59C49 dec [eax+0x66]` 로 **부활 대상을 매 프레임 1픽셀 띄운다** —
   *   반투명 판(`0x59EFD`) 아래에서 올라오는 것이 사용자가 말한 「실루엣이 드러났다가
   *   스프라이트가 확정」이다.
   *
   *   원본은 화면 좌표에 그대로 더하므로, 여기서도 박스 기준점에 더한다.
   *   `u.px`/`u.py` 가 없으면 0 이라 예전 동작 그대로다. */
  유닛상자기본반영(box, _위치, _대열, _경계);

  var self = this;
  /* 원본 프레임 선택·층 DOM 반영. 탑승자도 탈것의 방향·모션을 쓴다
   * (`0x13175`·`0x1318A`). 발광은 `0x5F517`의 단색 실루엣이다. */
  var topY = 유닛층그리기(this, u, L, ox, oy);

  box._ox = ox; box._oy = oy; box._topY = topY;
  /* ★ 상태이상 이펙트 — 0x12406 루프. 유닛 층 위에 겹친다. */
  this._상태효과놓기(u, box, ox, oy, L.length);
  /* ★ 회전축(발끝) = **현재 표시 프레임**의 실제 최하단 불투명 픽셀. 박스 아래끝(bh)은 투명여백,
   *   기준점(oy)은 몸통이라 둘 다 안 맞는다. 표시 프레임 발끝으로 고정 → 뜸·묻힘 없음. */
  var m0 = L[0].meta, 본체프레임위치 = 유닛프레임위치(m0, u);
  var cols0 = 본체프레임위치.열;
  var mainDir = 본체프레임위치.방향, mainMo = 본체프레임위치.모션;
  var footY = this._스프라이트발끝Y(box, L, mainDir, mainMo, bh);
  /* ★★★★★ **지형에 잠긴다** — `0x132C9`~`0x13318` · 표 `0x70A58` (2026-08-27)
   *
   *   > 사용자 ⑯: 「원본은 캐릭터가 올라가있는 **타일 종류에 따라 이동 효과**가
   *   >  나타나 (눈위에서는 **눈에 파묻힌것 같은 이펙트**, 용암 위에서는
   *   >  **용암에 일부가 잠긴 이펙트** 등)」
   *
   *   ```asm
   *   0x132C9  cmp al, 0x64 / jbe        ; 지형 <= 0x64 면 안 잠긴다
   *   0x132CD  test [edi+0x14], 0x1 / jne;  ★ **비행이면 안 잠긴다**
   *   0x13036  cmp [0xBA84E], 4 / jge    ;  ★ **전투 종류 >= 4 면 안 잠긴다**
   *   0x132F5  sub al, 0x65              ; ★★★ **0x65** — 발소리(0x16123)는 0x64 다
   *   0x132F7  and al, 0x0F
   *   0x13303  al = [eax + 0x70A58]      ; ★ 잠기는 **픽셀 수**
   *   0x133AC  call 0x5F4AF              ;   잘라 그리기 (보통은 0x5F3FD)
   *   0x133C9  그 뒤 지형 타일을 다리 위에 **덮어 그린다** (0x789AC 표)
   *   ```
   *   원본은 맵을 먼저 그리므로 「잘라 그리고 + 타일을 덮는다」인데, 우리는
   *   유닛이 맵 **위에** 있는 요소라 **아래를 잘라내면 결과가 같다.**
   *
   *   표 `0x70A58` (16바이트 · 색인 = `(지형 − 0x65) & 0x0F`)
   *   ```
   *   0x70a58: 00 08 08 04 00 00 04 00 00 00 04 10 31 51 20 01
   *   ```
   *   ★★★★★ **2026-08-29 — 뒤 네 칸도 같은 표다.** 「다른 표의 시작」이 아니다.
   *     색인이 `(지형 − 0x65) & 0x0F` 라 **0~15 · 열여섯 칸**이고,
   *     `0x70A58` + 16 = `0x70A68` 까지가 표 전체다. `31 51 20 01` 은 색인 **12~15** 다.
   *   ★ 주소 검산 — 이 표는 적용본에서도 **`0x70A58` 그대로**다(참조 4곳:
   *     `0x1278A` · `0x128DC` · `0x1306A` · `0x13305`). `0xE0A58` 로 보면 0곳이다.
   *     곧 **fixup 전 값이 아니다** — 오늘 여러 주소가 그래서 확인했다.
   *   ```
   *   ```
   *   ★ 발소리 쪽 니블과 **1 만큼 어긋난다** — 눈(발소리 니블 0x0B)은 여기서
   *     색인 0x0A = **4px**, 물(0x02·0x03)은 색인 0x01·0x02 = **8px**,
   *     색인 0x0B = **16px**(한 칸 높이 = 완전히 잠김).
   *   ★ 자르는 기준은 **박스 아래끝이 아니라 발끝**(`_footY`)이다 —
   *     박스 아래는 투명 여백이라 그대로 자르면 아무것도 안 잘린다. */
  /* ★★★★★ **높이 검사** — `0x132D3`~`0x132F3` (2026-08-27 · 사용자 지적으로 보강)
   *
   *   > 사용자: 「특정 타일에 나타나는 **지형효과가 제대로 적용되지 않은** 것 같아.
   *   >  원본에서 **가만히 서있을때도 적용이 되는지** 확인이 필요해.
   *   >  기억으로는 **이동할때** 나타났던 것 같아.」
   *
   *   ☠ 처음 구현은 지형·비행·전투종류 셋만 보고 **늘 잠갔다.** 원본에는 조건이
   *     하나 더 있다 — 그리고 거기에 **y 픽셀 오프셋이 들어간다.**
   *   ```asm
   *   0x132D3  edx = [메타+5]        ; 앵커y (본체 y 오프셋)
   *   0x132DB  bl  = [메타+3]        ; ★ 그림 **높이 h**
   *   0x132DE  ebx = h + 앵커y
   *   0x132E0  edx = [유닛+0x66]     ; ★★★ **y 픽셀 오프셋** — 걸을 때만 0 이 아니다
   *   0x132E6  ebx += y오프셋
   *   0x132E8  edx = [메타+8]        ; 그림자y
   *   0x132EE  edx += 0x11 (17)
   *   0x132F1  cmp ebx, edx / jle    ; ★ `h + 앵커y + y오프셋 <= 그림자y + 17` 이면 **안 잠긴다**
   *   ```
   *   ★ 메타 `+3` = **h 하위 바이트**임을 적재기에서 확정했다 —
   *     `0x117B7`(+3) · skip · `0x117DE`(+4=앵커x) · skip · `0x117FD`(+5=앵커y) ·
   *     skip · `0x1183F`(+7=그림자x) · `0x11861`(+8=그림자y) 순서로 파일 헤더
   *     6·7·8·9·10·11·12·13 을 읽는다 ⇒ `+3` = 헤더 6 = **h**.
   *
   *   ⇒ **정지 시에도 잠기고**(사람 실측: 사라 `22−7+0=15 > −8+17=9`),
   *     **북쪽으로 걷는 동안**(y오프셋 −8) 잠깐 안 잠긴다(`5 <= 9`).
   *     사용자가 「이동할 때 나타났다」고 기억한 것은 그 **변화**로 보인다.
   *   ★ 대형 스프라이트(`[+0x61] >= 0x12C`)는 `0x13016` 갈래라 **이 검사가 없다** —
   *     조건만 맞으면 늘 잠긴다. */
  /* ★ 그림자y ← 메타 `+8` (0x132AA) · **그림자x ← 메타 `+7`** (0x1329E · 2026-09-08) */
  var _지형정보 = 유닛지형표시정보(this.b, u, m0, this._usprRaw,
                                      mainDir, cols0, mainMo, Renderer.SINK_TABLE);
  var 잠김 = _지형정보.잠김;
  /* 정본 256 — 소멸 «위로»(0x468BC) 중에는 유닛이 이미 칸에서 빠져(0x4694C call 0x11EE4) 0x5F611 로 몸만 그린다 — 잠김·자르기·지형 효과 없음 */
  if (u._소멸가늘기) 잠김 = 0;
  var _지형니블 = _지형정보.지형니블;
  var _그림자y = _지형정보.그림자y;
  var _그림자x = _지형정보.그림자x;
  box._잠김 = 잠김;
  box._지형니블 = _지형니블;      /* ★ 그림자 갈래가 본다 (0x130AF cmp al, 8) */
  box._그림자y = _그림자y;        /* ★ 메타 `+8` (0x132AA) — 잠김·효과 자리를 재는 도구가 읽는다 */
  /* ★ 층마다 자른다 — 박스에 걸면 **그림자까지 잘린다**(그림자는 박스의 자식이다).
   *   ☠ 여기 「원본에서 그림자는 **잠김과 무관하게** 그려진다」라고 적어 두었다 —
   *     **틀렸다.** `0x1309D` 가 「잠김이 −1(없음)일 때만」 그린다(아래 §그림자). */
  /* [리마스터] 공격 모션(5~9)이면 지형 잠김의 아래 자르기를 하지 않는다 — 모든 유닛 (2026-10-13)
   *   사장님 「아수라 공격 관련해서 맵에 가려지는건 잘못인데 … 캐릭터 밑으로 들어오는건 괜찮은데(남쪽 공격식) 맵 아래에 잘리면 안돼」
   *   · 「사람크기 유닛도 공격할때 잠기지 않아야하는거 아닌가?」 → 고르심 ① 「공격할때 발이 잠깐 나왔다가 다시 잠긴다는 소리잖아? 괜찮을 것 같아」
   *   원본 0x12F2A(사람)·0x13016(큰 그림)은 눈밭 등에서 공격 자세에도 아래를 잘라, 남쪽으로 내리친 무기가 잘린다(1-1A 아수라 inset 40px).
   *   내리기(0x13079 top += 잠김)는 그대로 두고 자르기만 뺀다 — 둘 다 빼면 공격 순간 잠김만큼 위로 튄다 · 리마스터_적용현황 2026-10-13 */
  var _큰공격 = (mainMo | 0) >= 5 && (mainMo | 0) <= 9;   /* 이름은 처음(큰 그림만) 그대로 — 이제 모든 유닛 */
  if (잠김 > 0 && footY != null) {
    /* ★★★★★ **자르는 한계는 `바닥 − 잠김 + 8` 이다** — `0x13310`~`0x13321` (2026-08-28)
     *
     *   > 사용자 ②: 「**눈에 파묻힌 이펙트도 달라.**」 (원작/우리 확대 스크린샷 2장)
     *
     *   ```asm
     *   0x132FF  al = [esp+0x20]              ; 지형 니블
     *   0x13303  al = [eax + 0xA58]           ; 잠김 표
     *   0x1330B  [esp+0x18] = ax              ; ★ 잠김 픽셀
     *   0x13310  eax = [esp+0xc]              ; ★ **바닥 y**
     *   0x13318  eax −= ecx                   ;   − 스프라이트 y
     *   0x1331A  eax −= 잠김
     *   0x1331C  eax += 8                     ; ★★ **+8**
     *   0x13321  [esp+0x14] = ax              ; = `0x5F4AF` 의 「그릴 줄 수」
     *   ```
     *   그릴 줄 수 = `바닥 − 스프라이트y − 잠김 + 8`
     *   ⇒ **보이는 하한 = 바닥 − 잠김 + 8**
     *
     *   ☠ 여기 `footY − 잠김` 이었다 — **`+8` 이 빠져 8 px 더 잘랐다.** */
    /* ★★★★★ **좌표계 대응을 확정하고 원본 식을 그대로 옮긴다** (2026-08-28)
     *
     *   > 사용자 ②: 「좌표, 위치 맞출때'마다' 틀리잖아!」
     *   > 「추측 "절대" 금지! '원본 값 미확인'도 금지! 모르면 알때까지 찾아!」
     *
     *   ── ① 원본 좌표계 (끝까지 읽었다) ──────────────────────────────
     *   ```asm
     *   0x12F46  eax = (signed)[esi+1]        ; 유닛 칸 y
     *   0x12F4A  call 0x10988                 ; ★ 칸 → 화면 y
     *     0x10989  ax −= [0x4A83E]            ;   카메라 칸 y
     *     0x10997  eax <<= 4                  ;   × 16
     *     0x1099A  eax += [0x4A838]           ;   화면 원점
     *     0x1099C  eax += 4
     *   0x12F52  eax −= 2                     ; ★ **바닥**
     *   0x12F58  [esp+0xc] = eax
     *   ```
     *   ⇒ `[esp+0xc]` = **지면 y − 2** — 스프라이트 발끝이 **아니다.**
     *
     *   ── ② 우리 대응 ────────────────────────────────────────────────
     *   `box._py = _m.y − 2 + u.oy` (주석에 `0x12F52 sub eax, 2`) ·
     *   층은 `top = oy + fr.ay` · 박스 top 은 `_py − _oy`
     *   ⇒ 박스 안에서 바닥의 y = `_py − (_py − _oy)` = **`box._oy`**
     *   ☠ 이 대응을 못박기 전에 `footY`(최하단 불투명 픽셀)로 옮겼다가 **틀렸다.**
     *
     *   ── ③ 원본이 하는 일 (0x1338E~0x133BE) ─────────────────────────
     *   ```asm
     *   0x133A0  ecx += 잠김                  ; ★ **본체를 잠김만큼 아래로**
     *   0x13318  줄수 = 바닥 − 스프라이트위 − 잠김 + 8
     *   0x133AC  call 0x5F4AF(…, ecx = 줄수)  ;   그 줄 수만큼만 그린다
     *   ```
     *   보이는 하한 = (스프라이트위 + 잠김) + 줄수 = **바닥 + 8** — 잠김과 무관하다. */
    /* ★★★★★ **자를 때 쓰는 바닥은 그림자까지 더한 것**이다 (2026-08-30 · 지적 A-2)
     *   ```asm
     *   0x13225  [esp+8]  = 화면y − 2            ; 바닥(칸 기준)
     *   0x132AA  dx = (signed)[esi+8]        ; ★ 메타 `+8` = **그림자y**
     *   0x132AF  edx += [esp+8]
     *   0x132B3  edx += 0xC                  ; ★ **+12**
     *   0x132B6  [esp+0xC] = dx              ; ★★ **자를 때 읽는 바닥**
     *   0x13310  eax = [esp+0xC] − 좌상단 − 잠김 + 8
     *   ```
     *   ⇒ 보이는 하한 = **바닥 + 그림자y + 12 + 8**
     *   ☠ 여기 `box._oy + 8` 이었다 — `0x1331C add eax,8` 만 옮기고
     *     `0x132B3 add edx,0xC` 와 `[esi+8]` 을 **빠뜨렸다**.
     *     그림자y 는 실측 대개 −7~−10 이므로 빠진 양이 **약 4 px** 이고,
     *     눈밭 잠김이 **4** 라 **깊이가 두 배로** 보였다(지적 A-2).
     *   ★ `[esp+0xC]` 는 `0x12F58` 에서 한 번 채워졌다가 `0x132B6` 에서
     *     **덮어쓴다** — 자를 때 읽는 것은 덮어쓴 쪽이다. */
    /* ★★★★★ **바닥에 `+4`** — 무늬와 자르기가 **같은 바닥**을 써야 한다 (2026-09-05)
     *
     *   원본은 `[esp+0xC]` 하나로 둘을 낸다 —
     *     무늬 y = `[esp+0xC] + 잠김 + 2` (`0x133BE`) · 하한 = `[esp+0xC] + 8` (`0x1331C`)
     *   우리 `box._oy + 그림자y + 12` 가 그 `[esp+0xC]` 보다 **4 작았다.**
     *
     *   ☠ 그래서 무늬도 자르기도 4px 위였는데, 무늬만 눈에 띄어 한때
     *     **앵커(`sp.ay = −4`)를 빼서** 무늬만 내렸다. 그러자 자르기가 남아
     *     사용자가 「캐릭터 발쪽이 **이펙트 내려간 만큼 더 잘렸다**」고 지적했다.
     *
     *   ★ 두 관측이 이 값을 못박는다 —
     *     ㉠ 「무늬 라인 위치는 **맞다**」 (앵커를 되살리고 바닥을 +4 하면 그대로 35)
     *     ㉡ 「원본은 **자르는 티가 전혀 안 난다**」 (하한 37 → **41** 이라야 무늬가 발을 덮는다)
     *   실측 — 무늬 그림 8줄 중 **실제 픽셀은 4~6줄**뿐이고 위 4줄이 투명이다.
     *     그래서 `ay = −4` 가 그 투명 4줄을 정확히 상쇄한다(원본 `0x5F3FD` 가 앵커를 쓴다).
     *     ⇒ 무늬 보이는 윗선 = 바닥 + 잠김 + 2, 하한 = 바닥 + 8 ⇒ **2px 덮는다.** */
    var _바닥 = (box._oy | 0) + _그림자y + 12;        /* 0x132B3 */
    /* ★ 큰 그림([+0x61] ≥ 0x12C)은 지형 ≥ 0x64 면 0x13016 갈래 — 그림자y 대신 `[esp+0xC](칸y−2) + oy + 4` (2026-10-08 · 1-1A 아수라)
     *   0x12FD9 cmp [+0x61],0x12C / jl · 0x12FE0 cmp al,0x64 / jae 0x13016 · 0x1302C edx += 4 · 0x1302F ebx(oy) += edx
     *   ⇒ 우리 상자 기준으로 바닥 = box._oy + 4 (일반 갈래의 그림자y + 12 자리). 아수라 공격(그림자y −7)에서 자르는 선이 1px 달랐다. */
    var _큰그림 = (root.Rules && typeof root.Rules.isSpecialBody === 'function')
      ? !!root.Rules.isSpecialBody(u) : ((u.sprIndex | 0) >= 0x12C);
    if (_큰그림) _바닥 = (box._oy | 0) + 4;            /* 0x13016~0x13031 */
    /* ☠★★★★★ **`+4` 를 자르기에서 떼어 무늬로 옮겼다** (2026-09-06 · 사용자 지적)
     *
     *   > 사용자: 「눈밭에서 캐릭터가 **아래쪽으로 이동할 때** 높이가 일정해야
     *   >  하는데 **위아래로 움직이면서** 간다」 · 「**원작은 안 튄다**」
     *   >  「GS 는 멈췄는데 **사라·라그넘은 아직 출렁인다**」
     *
     *   ★ 원본 `0x1331C` 은 하한을 `[esp+0xC] + 8` 로 낸다 — 위 주석 그대로
     *     「보이는 하한 = (스프라이트위 + 잠김) + 줄수 = **바닥 + 8**」.
     *     잠기면 위를 내리고 그만큼 **아래를 잘라** 하한을 붙들어 둔다.
     *
     *   ☠ 그런데 `+4` 가 한계를 4px 내려 **잠김일 때 자를 것이 없어졌다.**
     *     실측 (라그넘 · 잠김 4) —
     *     ```
     *       층    top 24 · h 24 · 아래끝 48 · clip 없음
     *       한계  48                       ⇒ 자를 것이 없다
     *       잠김 0 이 되면  top 20 · 아래끝 44   ⇒ **4px 올라간다**
     *     ```
     *     그 4px 이 걷는 동안 두 프레임(`oy = −4·−8`)마다 나타나 **출렁였다.**
     *
     *   ★ 판정이 그 두 프레임에 풀리는 것 자체는 **원본에서도 그렇다** — 읽고 잰 것:
     *     · 메타 `0xD66A8 + spr×572 + (dir×11+mo)×13` 을 방향·모션별로 읽어 견줬다
     *     · 걷기 `oy` 를 원본 메모리에서 쟀다 — `−4, −8, +4, 0` 반복
     *     · 판정식 `0x132DE`·`0x132E6`·`0x132EE`·`0x132F1` · 잠김 표 `0x70A58`
     *     · 판정 호출부는 `0x59C36` 한 곳 (매 프레임)
     *     · 「오가 늘 9」인 캐릭터는 원본에도 있다 (spr 2)
     *     ⇒ 판정은 원본에서도 풀리는데 **화면이 안 움직인다.** 그 차이가 이 한 줄이다.
     *
     *   ☠ **아직 안 본 것** — 원본 `0x5F4AF`(잠김일 때 그리는 함수)를 머리부터
     *     읽지 않았다. 자르기 말고 다른 일도 하는지는 모른다.
     *
     *   ★ `+4` 는 **무늬 쪽으로 옮겼다**(`_무늬보정`) — 2026-09-05 에 무늬 자리를
     *     맞춘 값이라 그대로 살린다. 자르기 한계만 원본 관계(`바닥 + 8`)로 되돌린다. */
    /* ★★★★★★★ **한계 = 바닥 + 잠김 + 10** — 일반 갈래 `0x12F2A` 를 끝까지 읽었다
     *   (2026-09-07 · 사장님 「지면 이펙트와 잘린 부분 사이에 **간격**이 생겼어」)
     *
     *   ☠ `+8` 은 **부활 갈래**(`0x1331C`)의 값이었다. 일반 유닛은 식이 다르다 —
     *   ```asm
     *   0x12FB8  ecx = 화면y ; 0x12FC1 bx = [edi+5](앵커y) ; 0x12FC6 ebx = 화면y+앵커y
     *   0x12FC8  cx  = [esi+0x66](oy) ; 0x12FD1 **ecx = 화면y+앵커y+oy = 그리기 시작 y**
     *   0x13079  **ecx += 잠김**            ; ★ 시작을 잠김만큼 내린다 (아래 `_t` 가 그 일)
     *   0x1307E  ebx = 바닥 + oy + 잠김 + 2 ;   무늬 y
     *   0x13080  edx = ebx ; 0x13087 edx −= ecx ; 0x1308D **edx += 8**
     *            ⇒ 높이 = 바닥 + oy + 10 − 시작y
     *   ```
     *   ⇒ **아래끝 = 시작 + 높이 = 바닥 + oy + 잠김 + 10.**
     *     우리 `_바닥`(`box._oy + 그림자y + 12`)이 원본의 `바닥 + oy` 자리이므로
     *     **`_바닥 + 잠김 + 10`** 으로 옮긴다.
     *
     *   ★ 소스를 처음부터 읽는 것도 확인했다 — `0x5F4D5 lodsd` 가 시트를 헤더 다음부터
     *     훑고 `0x5F4EE dec [ebp−2]` 로 **줄 수만** 센다. 곧 시작을 내리면 그림이
     *     통째로 아래로 가고 아래가 잘린다.
     *
     *   실측(1-1A · 마을청년 `_바닥 26` · 잠김 4) —
     *     무늬 보이는 윗선 **36** (시트 위 4줄이 투명 · 줄별 `[0,0,0,0,24,24,17,0]`)
     *     옛 한계 `_바닥+8` = **34** → **2px 벌어졌다**  ← 사장님이 보신 것
     *     새 한계 `_바닥+잠김+10` = **40** → 무늬를 **4px 덮는다**
     *   ☐ 아직 안 본 것 — 잠기지 않는 지형에서 이 값이 어떻게 되는지는 안 쟀다. */
    /* ★★★★★ **아래끝 = `바닥 + oy + 10` — 잠김은 상쇄된다** (2026-09-08 · EXE 로 확정)
     *
     *   > 사장님: 「**눈이펙트 밑으로 발이 보여**」 · 「**지금 아직도 발 나와**」
     *
     *   ☠ 처음엔 `0x13070 ebx = [esp+0x18]` 이 무엇인지 모른 채 고쳤다가 되돌렸다.
     *     이번에는 **그 자리를 채우는 곳까지** 찾았다 (함수 `0x12F2A` 안) —
     *   ```asm
     *   0x12FFB  dx  = (signed)[edi+8]     ; 메타 +8 = 그림자y
     *   0x13000  edx += [esp+0xC]
     *   0x13004  edx += 0xC                ;   + 12
     *   0x13007  [esp+4] = edx             ; ★ 「바닥」
     *   0x1300F  dx  = (signed)[esi+0x66]  ;   u.oy
     *   0x13031  word[esp+0x18] = bx       ; ★★ [esp+0x18] = **바닥 + oy**
     *   ```
     *   그리고 자르기 —
     *   ```asm
     *   0x13070  ebx = [esp+0x18]          ;   바닥 + oy
     *   0x13074  word[esp+0x14] = dx       ; ★ 잠김을 따로 저장 (0x13068 에서 0x70A58 로 읽은 값)
     *   0x13079  ecx += edx                ;   시작y += 잠김
     *   0x1307B  edx += 2
     *   0x1307E  ebx += edx                ;   (바닥+oy) + 잠김 + 2
     *   0x13087  edx -= ecx                ;   … − 시작y
     *   0x13089  ebx = [esp+0x14]          ; ★ **잠김을 다시 꺼낸다**
     *   0x1308D  edx += 8
     *   0x13090  edx -= ebx                ; ★★★ **− 잠김**  ← 앞 주석이 이 줄을 빠뜨렸다
     *   ```
     *   ⇒ 높이 = (바닥+oy+잠김+2) − 시작y + 8 − 잠김 = **바닥+oy+10 − 시작y**
     *     **아래끝 = 바닥 + oy + 10.  잠김과 무관하다.**
     *   ★ 우리 `_바닥`(`box._oy + 그림자y + 12`)이 원본의 `바닥 + oy` 자리다.
     *   ☠ `+ 잠김` 이 들어 있어 눈밭(잠김 8)에서 **8px 더** 그렸다 — 발이 비어져 나왔다.
     *   ☐ 잠김이 큰 지형(물 8 · 완전잠김 16)에서 무늬가 그 위를 다 덮는지는 아직 안 쟀다. */
    var _한계 = _바닥 + 10;                           /* 0x13031 · 0x1308D · 0x13090 */
    /* 0x133A0 ecx += 잠김 — 매 프레임 새 top에 적용하므로 누적되지 않는다. */
    유닛잠김층반영(L, 잠김, _큰공격 ? Infinity : _한계);   /* 큰 그림 공격 — 잠김만큼 내리기는 그대로(튀지 않게) · 자르기만 안 함 */
  } else {
    유닛잠김층해제(L);
  }
  /* 0x219EB/0x21AA6/0x21AD5 → 0x5F4AF: 소환은 dstY=ground+h-t로
   * sprite를 아래 dy만큼 옮기고 위쪽 t행만 그린다. 현재 `box._소환솟음Dy = h-t`
   * 이므로 각 sprite 층을 같은 dy만큼 아래로 이동시키고 아래 dy행을 자른다.
   * 지형 자름과는 큰 쪽을 합성한다.
   * 별도 소환표시Y는 top에만 적용하며 crop에는 섞지 않는다. 부모 box를 움직이지
   * 않아 shadow와 HUD/상태 child는 제자리에 남는다. */
  유닛솟음층반영(L, box._소환솟음Dy | 0, box._소환표시Y | 0);
  /* ★★★★★ **지형 효과 스프라이트를 다리 위에 덧그린다** — `0x133C9` 루프
   *   (2026-08-27 · 사용자 지적 ㉗)
   *
   *   > 「타일효과 관련해서 **단순히 잠기는게 아니라 외부 스프라이트가 추가돼**
   *   >  `MAP_EFFC` 파일에 있을거야.」
   *
   *   ```asm
   *   0x133B9  y = 본체y + 잠김 + 2
   *   0x133C9 ┌ ecx = 0 .. [메타+0](**발자국 폭**)
   *   0x133CD │  bl = [0xBA84C]                    ; 애니 프레임 (0/1)
   *   0x133DE │  ebx = [ebx*4 + 니블*8 + 0x789AC]  ; MAP_EFFC 스프라이트
   *   0x133EF │  call 0x5F3FD(x, y, 시트)
   *   0x133F4 │  x += 24                           ;   가로로 한 칸씩
   *   0x13403 └  cmp cx, [메타+0] / jl
   *   ```
   *   ★ 잠김이 0 이면 안 그린다 — 잠기지 않은 유닛에는 효과가 없다.
   *   ★ **잘리지 않는다** — 자르는 것은 유닛 층뿐이고 이 요소는 그 위에 얹힌다. */
  /* [리마스터] 공격 모션(5~9) 동안은 지형 효과도 잠시 끈다 — 모션이 끝나면 다시 (2026-10-13 사장님 「공격시에는 지형효과도 잠시 끄고 모션이 끝나면 다시 키는게 자연스럽지 않을까」) */
  유닛지형효과그리기(this, box, _큰공격 ? 0 : 잠김, _지형니블, m0, mainDir, mainMo,
                       _바닥, ox, _그림자x, L.length);
  /* ★★★ 발밑 그림자 — 본체 **아래**에 깐다 (원본 `0x130D5` 가 `0x130FB` 보다 먼저) */
  유닛그림자그리기(this, u, box, L, ox, oy);


  유닛최종배치(this, box, _위치, _경계, footY);
};

/** 스프라이트 발끝 y (박스 top 기준) = **현재 표시 프레임(dir·motion)** 의 최하단 불투명 픽셀.
 *  프레임마다 최하단이 달라 한 프레임만 쓰면 다른 프레임이 뜨거나 묻힌다. 표시 중인 그 프레임을
 *  직접 재서 정확히 접지. png·dir·mo 별 캐시, 시트 이미지는 png 당 1회 로드. */
Renderer.prototype._스프라이트발끝Y = function (box, L, dir, mo, bh) {
  var lyr = L[0]; if (!lyr || !lyr.meta) return bh;
  var m = lyr.meta, file = this._스프라이트파일(m, lyr.no);
  var cols = m['열'] || m['방향당프레임'] || 11, n = dir * cols + mo;

  /* ★ 원본 인덱스 버퍼에서 바로 셉니다 — 캔버스를 다시 읽을 필요가 없고
   *   (tainted canvas 걱정도 없고) 「기록 안 된 픽셀 = 투명」이 정확합니다.
   *   예전엔 추출 시트를 캔버스에 그려 알파를 읽었는데, 그 시트는 검정을
   *   투명으로 구웠기 때문에 검정 신발·그림자가 발끝에서 빠졌습니다. */
  this._footCache = this._footCache || {};
  var key = file + '|' + n;
  var frames = this._usprRaw && this._usprRaw[file];
  if (this._footCache[key] == null) {
    if (!frames || !frames[n]) {
      this._유닛프레임공급자(file);               // 로딩 시작(이미 돌고 있으면 무시)
      var fr0 = this._유닛프레임정보(file, n);
      return (box._oy | 0) + (fr0 ? (fr0.ay | 0) + fr0.h : bh);   // 준비 전 임시
    }
    var f = frames[n], foot = f.h, yy, xx, op;
    for (yy = f.h - 1; yy >= 0; yy--) {
      op = false;
      for (xx = 0; xx < f.w; xx++) if (f.idx[yy * f.w + xx] >= 0) { op = true; break; }
      if (op) { foot = yy + 1; break; }
    }
    this._footCache[key] = foot;
  }
  /* 층 좌상단(박스 안) = 기준점 + 앵커y. 거기서 발끝만큼 내려간 자리. */
  var ff = frames && frames[n];
  return (box._oy | 0) + (ff ? (ff.ay | 0) : 0) + this._footCache[key];
};

/** 세워 놓는 요소의 배치. (left, groundY) 는 맵 픽셀 좌표. */
Renderer.prototype._빌보드놓기 = function (e, left, groundY, h) {
  e.style.left = (left - this.mapW / 2) + 'px';
  e._left = left; e._ground = groundY; e._h = h;
  /* ★ 2026-10-12 — 예전엔 top 을 '0px' 로 써 두고 다음 apply()(다음 프레임)의 _빌보드적용 이 진짜 자리를 썼다.
   *   그 한 프레임 동안 그림이 맨 위로 튀었다(죽으면서 대사가 뜰 때 · 사장님 「마지막층 안내인 죽으면서 대사나올때 스프라이트 위치가 튀는 애들이 몇명 있어」).
   *   헤드리스 실측 — 안내인의 방 노테니스 top −90px → 사망 처리 직후 0px → 다음 프레임 −90px. 그 자리에서 바로 최종 자리를 쓴다. */
  e._빌위 = null;
  this._빌보드적용(e);
};

/* ══════════════════════════════════════════════════════════════════════
 * 표시 보간 (리마스터 전용)
 *
 * 원본 논리는 한 프레임(이벤트 행진 9틱 ≈ 51ms)마다 유닛을 몇 픽셀씩
 * **점프**시킵니다. 원작은 320×200 화면이라 그 점프가 작아 자연스럽지만,
 * 우리는 4배 넘게 확대해 보여주므로 같은 점프가 크게 튀어 **뚝뚝 끊겨** 보입니다.
 *
 * 그래서 **논리는 그대로 두고 화면 좌표만** 프레임 사이를 채웁니다.
 *   · `u.x` · `u.ox` · 카메라 논리값 · 이벤트 타이밍은 하나도 안 바뀝니다.
 *   · 오직 DOM 에 찍는 픽셀만 「직전 자리 → 지금 자리」 사이를 t 로 섞습니다.
 * 스케일러와 같은 성격이라 원본 재현 원칙과 충돌하지 않습니다.
 * 녹화본과 프레임 단위로 대조할 때는 개발패널에서 끄면 됩니다.
 * ════════════════════════════════════════════════════════════════════ */
Renderer.prototype.lerpOn = true;
Renderer.prototype.lerpT = 1;
/** 렌더 루프가 매 rAF 마다 진행률(0~1)을 넣어 줍니다. */
Renderer.prototype.setLerp = function (t) {
  this.lerpT = this.lerpOn ? Math.max(0, Math.min(1, t)) : 1;
  return this;
};
/**
 * 논리 스텝 **직전** — 지금 자리를 기억합니다.
 * ★ 여기서만 찍습니다. `_빌보드놓기` 에서 찍으면 `apply()` 가 매 rAF
 *   유닛을 다시 배치할 때마다 기준이 덮여 보간이 무의미해집니다.
 */
Renderer.prototype.markLerp = function () {
  this._pcam = { cx: this.cam.cx, cy: this.cam.cy };
  var self = this;
  Object.keys(this.unitEls || {}).forEach(function (k) {
    var b = self.unitEls[k];
    if (b && b._left != null) { b._pl = b._left; b._pg = b._ground; }
  });
  return this;
};
/**
 * ★★ 유닛 하나를 **보간 없이 지금 자리로** 못 박습니다.
 *
 * 보간은 **걷기**를 위한 것입니다 — 원본이 한 프레임에 4px 씩 점프시키는 것을
 * `pumpFrames` 가 `markLerp()` → `setLerp(진행률)` 로 이어 줍니다.
 *
 * **연출 중에는 `pumpFrames` 가 안 돕니다.** 그래서 `lerpT` 가 마지막 값
 * (0~1 사이 아무 값)에 멈춰 있고, 그 상태에서 `ox`/`oy` 를 흔들면
 * **실제 이동량이 그 비율만큼 줄어들고** 매 rAF 마다 직전 자리와 섞여
 * 늘어졌다 줄었다 하는 잔상이 생깁니다.
 *
 * 실측 (2026-08-14) — `ox` 를 0 → −3 으로 바꿨는데 화면은 `−360px → −361.03px`,
 * 곧 **34% 만** 반영됐습니다(`lerpT ≈ 0.344`).
 *
 * 사용자 지적: 「블리자드 스톰 시전 중간 흔들림 이상해. 제국병 **허리쯤을
 * 기준으로 위아래로 안쪽으로 모였다가 벌어졌다 반복**해.」
 *
 * 밀림(`0x45F29`)과 초필살기 흔들림(`0x3ADE1`)은 **원본이 한 프레임에 한 번씩
 * 딱딱 옮기는 것**이므로 보간을 태우면 안 됩니다. 값을 바꾼 쪽에서 이걸 부릅니다.
 * (투사체도 같은 이유로 `e._pl`/`e._pg` 를 직접 찍고 있습니다.)
 */
Renderer.prototype.snapUnit = function (u) {
  var box = u && this.unitEls && this.unitEls[u.id];
  if (!box || box._left == null) return this;
  box._pl = box._left; box._pg = box._ground;
  this._빌보드적용(box);
  return this;
};
/** 보간된 값 (이전값이 없으면 지금 값 그대로) */
Renderer.prototype._보간값 = function (prev, cur) {
  return (prev == null || this.lerpT >= 1) ? cur : (prev + (cur - prev) * this.lerpT);
};
/* ══════════ ★★★ 캐릭터 발밑 그림자 — `SHADOW.SYB` ══════════════════════
 *
 *   원본: 적재 `0x11C0B`(7프레임, 표 `0xD6650`) · 그리기 `0x130C4`(본체) ·
 *   `0x1335C`(탑승자). **본체 스프라이트보다 먼저** 그린다(`0x130D5` → `0x130FB`).
 *   출력은 `0x5F3FD` = `rep movsd`, **합성이 없다.**
 *
 *   ★ **반투명이 아니라 체크무늬 디더링**이다 — `(x+y)` 홀짝 한쪽이 0 인 완전한
 *     1픽셀 격자라 사이로 바닥이 비친다. 그래서 CSS 알파로 흉내 내지 않고
 *     **원본 그림을 그대로** 쓴다(사용자 지시 2026-08-16).
 *
 *   어느 프레임을 쓸지는 **스프라이트 프레임 메타 `+6`**(`.BCR` 헤더 바이트 14)에
 *   들어 있다. `.NC2`(사람)는 그 자리가 없어 **0번**이다.
 *   자세한 것은 `03_분석/COMBATII/그리기계열_분석.md` 말미.
 * ══════════════════════════════════════════════════════════════════════ */
/* ★★★ 그림자 캐시 키 — **프레임 + scaler N + 활성 팔레트 해시** (2026-08-17)
 *
 *   사용자 지정(시나리오 6-B): 「단순히 `_shdURL = {}` 를 추가하는 것보다
 *   **캐시 키 자체를 안전하게** 만드는 것이 좋습니다. (…) 그림자는 인덱스 0 을
 *   실제 색으로 구운 이미지이므로 **scaler 뿐 아니라 활성 팔레트가 바뀌어도**
 *   다시 구워야 할 수 있습니다. 캐시 키에 팔레트가 없다면 **6-C 에서 다시 문제**가
 *   생깁니다.」
 *
 *   전에는 `_shdURL[no]` 로만 캐시해서, `rebuildForScaler()` 가 `_uurl`·`_uspr`·
 *   `_blkCache`·`_effcURL` 을 비우는 동안 **`_shdURL` 만 안 비웠다.**
 *   그래서 N 을 2·4 로 올려도 그림자는 **1배 그림 그대로**였다
 *   (실측: `N=2` 에서 CSS 24×16 은 맞는데 **내부 bitmap 도 24×16** — 48×32 여야 한다). */
Renderer.prototype._그림자캐시키 = function (no) {
  var N = (root.G2Scaler && root.G2Scaler.N) ? root.G2Scaler.N() : 1;
  var pal = this._유닛팔레트 ? this._유닛팔레트() : null;
  var h = 0x811c9dc5;
  if (pal) for (var i = 0; i < pal.length; i++) { h ^= pal[i]; h = (h * 0x01000193) >>> 0; }
  return (no | 0) + '|' + N + '|' + (pal ? h.toString(16) : '-');
};
/** 그림자 프레임 번호에 대응하는 원본 직독 URL을 반환한다. */
Renderer.prototype._그림자그림정보 = function (no) {
  no = no | 0;
  if (!this._shdURL) this._shdURL = {};
  var 키 = this._그림자캐시키(no);
  if (this._shdURL[키] !== undefined) return this._shdURL[키];
  if (this._shdLoading) return null;
  var self = this;
  if (!this._shd) {
    this._shdLoading = true;
    (async function () {
      try {
        var r = await self._가져오기(G2URL('SHADOW.SYB'));
        if (!r.ok) throw new Error('SHADOW.SYB ' + r.status);
        self._shd = root.G2Native.decodeShadow(new Uint8Array(await r.arrayBuffer()));
        console.log('[그림자] SHADOW.SYB 원본 직독 — ' + self._shd.frames.length + '프레임');
        self._유닛전체새로고침 && self._유닛전체새로고침();
      } catch (e) { console.warn('[그림자] 못 읽음:', e && e.message); self._shd = null; }
      self._shdLoading = false;
    })();
    return null;
  }
  var fr = this._shd && this._shd.frames[no];
  if (!fr) { this._shdURL[키] = null; return null; }
  var pal = this._유닛팔레트 ? this._유닛팔레트() : null;
  if (!pal) return null;
  var cv = root.G2Native.frameToCanvas({ w: fr.w, h: fr.h, idx: fr.idx, tr: null }, pal);
  /* ★ `w`·`h` 는 **논리 크기**다 — CSS 는 논리로 두고 bitmap 만 N배가 된다.
   *   (`frameToCanvas` 가 N배로 굽고 `논리w/논리h` 를 남긴다.) */
  /* ★ 주소는 «읽을 때» 굽는다 — 그림자 칸은 캔버스를 바로 칠한다 (2026-10-06 · 선라이트 끊김 · _유닛프레임정보 주석과 같은 까닭) */
  var o = { canvas: cv, w: (cv.논리w || cv.width), h: (cv.논리h || cv.height),
            ax: fr.ax | 0, ay: fr.ay | 0, N: (cv.논리w ? cv.width / cv.논리w : 1), _url: null };
  Object.defineProperty(o, 'url', { enumerable: true, configurable: true,
    get: function () { return this._url || (this._url = this.canvas.toDataURL()); },
    set: function (v) { this._url = v; } });
  this._shdURL[키] = o;
  return o;
};


/**
 * ★★★★★ **지형 효과 스프라이트** — `MAP_EFFC.SYB` (2026-08-27 · 사용자 지적 ㉗)
 *
 *   > 사용자: 「타일효과 관련해서 **단순히 잠기는게 아니라 외부 스프라이트가 추가돼**
 *   >  `MAP_EFFC` 파일에 있을거야.」
 *
 *   ★ 맞았다. 잠김(자르기) **뒤에** 그 지형의 스프라이트를 다리 위에 덧그린다 —
 *   그것이 「눈에 파묻힌 것 같은」·「용암에 잠긴 것 같은」 모양을 만든다.
 *
 *   ```asm
 *   ── 적재 (맵 로드) ──
 *   0x108B5  call 0x10420  ×**11번** (cx = 0..0x0B)   ; ★ 지형 니블 0~10
 *   0x10437  eax = 0x75A8C ("MAP_EFFC.SYB") ; 0x1043C call 0x4976F   파일 열기
 *   0x104CD  [esi + 0x789AC] = eax          ; esi = 프레임i×4 + 니블n×8
 *   0x104E6  cmp di, 2                      ; ★ 니블마다 **프레임 2개**
 *
 *   ── 그리기 (잠긴 유닛 뒤) ──
 *   0x133B9  y = 본체y + 잠김 + 2
 *   0x133C9 ┌ ecx = 0 .. [메타+0](**발자국 폭**)
 *   0x133CD │  bl = [0xBA84C]                    ; 애니 프레임 (0/1)
 *   0x133D3 │  al = 니블
 *   0x133DE │  ebx = [ebx*4 + eax*8 + 0x789AC]   ; ★ 그 스프라이트
 *   0x133EF │  call 0x5F3FD(x, y, 시트)
 *   0x133F4 │  x += 0x18 (24)                    ;   가로로 한 칸씩
 *   0x13403 └  cmp cx, [메타+0] / jl
 *   ```
 *   ⇒ **프레임 번호 = 니블 × 2 + 애니프레임** (0~21). 실측: 파일에 30프레임,
 *     전부 **24×8**. 앵커는 대부분 `(−12, −4)`, 니블 2(프레임 4·5)만 `(0,0)`.
 *
 *   ★★ **팔레트를 조심한다** (사용자 지적) —
 *     「추출해놓은 스프라이트는 팔레트가 잘못되어서 **검게 나오는 부분**이 있는데,
 *      이부분 유의해서 원본 직독할때 디코딩에 신경써야해」
 *     `.SYB` 는 `decodeSYB` 로 풀고(무압축 갈래가 있다 — `decodeNC2` 는 없다),
 *     팔레트는 **맵 팔레트**를 쓴다. 맵과 같은 평면에 그려지는 것이라
 *     104~ 색이 맵마다 다르다. 맵이 없으면 유닛 팔레트로 물러선다.
 *
 * @param {number} 니블  `(지형값 − 0x65) & 0x0F` — 잠김 색인과 같다
 * @param {number} 프레임 0 또는 1
 * @returns {{url,w,h,ax,ay}|null}
 */
Renderer.prototype._지형효과URL = function (니블, 프레임) {
  /* ★★★★★ **프레임 번호는 맵이 준다** — `0x1089B` · `0x10420` (2026-08-30 · A-1)
   *   `.MAP` 꼬리의 **니블 11칸 표**가 `MAP_EFFC.SYB` 의 시작 번호다.
   *     그림 번호 = **표[니블] + 애니(0/1)**   (`0x133DE`)
   *   ☠ 전에는 `니블 × 2` 로 지어냈다 — `SKY04` 는 표가 `[0,4,8,0,4,…]` 라
   *     니블 1 이 **4·5** 인데 2·3 을 그렸고, 니블 2 는 **8·9** 인데 4·5 를 그렸다.
   *   ★ 표가 없는 맵은 **그리지 않는다** — 지어내지 않는다. */
  var 표 = this.nmap && this.nmap['지형효과프레임'];
  if (!표) return null;
  var 시작 = 표[니블 | 0];
  if (시작 == null) return null;
  var n = ((시작 | 0) + ((프레임 | 0) & 1));      /* 0x133DE */
  if (!this._effURL) this._effURL = {};
  /* ★ 잠김 띠는 유닛 그리기(0x133B1)의 한 부분이다 — 유닛 몸과 같은 팔레트(_유닛쓸팔 · 없으면 지금 맵 팔레트)로 굽는다.
   *   캐시 열쇠에 «어느 팔레트로 구웠나»를 넣는다 — ☠ 전에는 열쇠가 그림 번호뿐이라 마법이 팔레트를 바꿔도
   *   처음 구운 색이 남아, 유닛만 물들고 물·눈·용암 띠는 원래 색으로 떴다
   *   (2026-10-02 사장님 「팔레트 변경시 캐릭터 잠기는 효과(눈, 물, 용암 등)에도 적용되어야 하는데」 · 「언급하지 않은 다른 잠기는 효과도 모두 적용되어야해」) */
  var pal = this._유닛쓸팔 || (this.nmap && this.nmap.palette) ||
            (this._유닛팔레트 ? this._유닛팔레트() : null);
  if (!pal) return null;
  var 팔번호표 = this._effPalId || (this._effPalId = new WeakMap());
  var 팔번호 = 팔번호표.get(pal);
  if (팔번호 == null) { 팔번호 = this._effPalSeq = (this._effPalSeq | 0) + 1; 팔번호표.set(pal, 팔번호); }
  if (this._effURL팔 !== 팔번호) { this._effURL = {}; this._effURL팔 = 팔번호; }   /* 팔레트가 바뀌면 옛 색 그림을 버린다(쌓이지 않게) */
  var 키 = n + '|' + (this.nmap ? (this.nmap.w || 0) : 0);
  if (this._effURL[키] !== undefined) return this._effURL[키];
  var self = this;
  if (!this._eff) {
    if (this._effLoading) return null;
    this._effLoading = true;
    (async function () {
      try {
        var 주소 = (typeof root.G2URL === 'function') ? root.G2URL('MAP_EFFC.SYB') : '/원본/MAP_EFFC.SYB';
        var r = await self._가져오기(주소);
        if (!r.ok) throw new Error('MAP_EFFC.SYB ' + r.status);
        self._eff = root.G2Native.decodeSYB(new Uint8Array(await r.arrayBuffer()));
        console.log('[지형효과] MAP_EFFC.SYB 원본 직독 — ' +
                    (self._eff && self._eff.frames ? self._eff.frames.length : 0) + '프레임');
        self._effURL = {};
        if (self._유닛전체새로고침) self._유닛전체새로고침();
      } catch (e) { console.warn('[지형효과] 못 읽음:', e && e.message); self._eff = null; }
      self._effLoading = false;
    })();
    return null;
  }
  var fr = this._eff && this._eff.frames && this._eff.frames[n];
  if (!fr) { this._effURL[키] = null; return null; }
  var cv = root.G2Native.frameToCanvas({ w: fr.w, h: fr.h, idx: fr.idx, tr: fr.tr }, pal);
  var o = { url: cv.toDataURL(), w: (cv.논리w || cv.width), h: (cv.논리h || cv.height),
            ax: fr.ax | 0, ay: fr.ay | 0 };
  this._effURL[키] = o;
  return o;
};
/** 화면에 실제로 쓰이는 카메라 좌표 — 맵 밖 계층(이펙트 등)이 맞춰 쓸 값. */
Renderer.prototype.viewCam = function () {
  return this._vcam || { cx: this.cam.cx, cy: this.cam.cy };
};

/* ── 이펙트 · 움직이는 타일 (js/fx.js 가 씁니다) ─────────────────────── */

/**
 * 움직이는 바닥 타일 한 칸.  fx/tiles.png 를 배경으로 깔고 칸 번호만 바꿉니다.
 *
 * ★ 접는선(foldY) **위**의 칸은 바닥이 아니라 **배경벽에 붙입니다**.
 *   원본(0x10A30 · 타일표 0x7EBAC)은 평면 한 장이라 이런 구분이 없지만, 우리는
 *   접는선 위를 세워 배경벽으로 만들기 때문에 애니 칸도 같이 세워야 합니다.
 *   바닥 평면에 두면 세워진 배경벽 뒤(아래)에 깔려 안 보입니다 —
 *   FR08 폭포가 그랬습니다: 애니 칸 9개 중 y=13·14·15 의 6개가 접는선(16) 위라
 *   멈춰 보이고, y=16 의 3개만 움직였습니다.
 *
 *   배경벽은 `left:-mapW/2, top:-mapH/2` 에 놓인 요소라 그 안의 지역 좌표는
 *   그냥 (x*TW, y*TH) 입니다. 부모가 rotateX 되므로 함께 세워집니다.
 *
 * @param {string} png   시트 경로 (자산/ 기준)
 * @param {number} x,y   타일 좌표
 */
Renderer.prototype.tileCell = function (png, x, y, 타일) {
  var k = x + ',' + y, e = this.tileEls[k];
  var onBackdrop = !!(this.backdropEl && y < (this._foldY || 0));
  var want = onBackdrop ? this.backdropEl : this.tileLayer;
  /* 배경벽이 늦게(비동기) 지어지거나 다시 지어지면 붙을 곳이 바뀝니다 —
   * 그때는 버리고 새로 답니다. 보여주던 칸 번호는 그대로 물려줍니다. */
  var keepBg = '';
  if (e && e.parentNode !== want) {
    keepBg = e.style.backgroundPosition || '';
    if (e.parentNode) e.parentNode.removeChild(e);
    e = null; delete this.tileEls[k];
  }
  /* 원본 맵 블록은 프레임마다 **그림 자체가 바뀝니다**(시트 칸 이동이 아님) —
   * data-URL 이면 매번 다시 걸어 줍니다. 추출 시트 경로는 예전처럼 한 번만. */
  /* ★ 캔버스도 받는다 — 그대로 열쇠로 쓰고 칸 안 캔버스에 칠한다 (2026-10-06 · tileCanvas) */
  var 캔칸 = !!(png && typeof png === 'object' && png.getContext);
  var url = 캔칸 ? png : ((png && png.indexOf('data:') === 0) ? png : this.base + png);
  if (!e) {
    e = el('div', 'g2-anim-tile', want);
    /* ★★★★★ **배율(스케일러)을 타게 한다** (2026-08-30 · 사용자 지적 #15)
     *
     *   ☠ 여기만 `bgcss()`·`rend()` 를 안 쓰고 `image-rendering` 을 박고
     *     `backgroundImage` 를 직접 걸었다. 그래서 배율을 켜면 애니 타일
     *     (용암 등)만 크기·보간이 어긋났다.
     *   ★ 다른 자리는 전부 `bgcss()` 를 쓴다 (688 · 1040 · 1283 · 1334 · 1593 …). */
    e.style.cssText =
      'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
      'width:' + TW + 'px;height:' + TH + 'px;' +
      'left:' + (onBackdrop ? x * TW : x * TW - this.mapW / 2) + 'px;' +
      'top:'  + (onBackdrop ? y * TH : y * TH - this.mapH / 2) + 'px;' +
      'background-repeat:no-repeat;' +
      /* 같은 평면이라 z 다툼이 납니다 — 아주 살짝 띄웁니다 */
      'transform:translateZ(0.05px);';
    if (keepBg) e.style.backgroundPosition = keepBg;
    this.tileEls[k] = e;
    e._url = null;
  }
  /* ★ 그림을 걸 때도 `bgcss()` 로 — N배 그림을 논리 크기(TW×TH)로 줄여 준다. */
  if (e._url !== url && 캔칸) {
    /* ★ PNG 로 굽지 않고 칸 안 캔버스에 바로 칠한다 — 스케일러가 drawImage 를 가로채므로 원본 사각형은 논리 크기 */
    e.style.backgroundImage = 'none';
    var 판 = e._판;
    if (!판) { 판 = e._판 = document.createElement('canvas'); 판.style.cssText = 'display:block;width:' + TW + 'px;height:' + TH + 'px;image-rendering:' + rend() + ';'; e.appendChild(판); }
    if (판.width !== png.width) 판.width = png.width;
    if (판.height !== png.height) 판.height = png.height;
    var g판 = 판.getContext('2d'); g판.clearRect(0, 0, 판.width, 판.height);
    g판.drawImage(png, 0, 0, png.논리w || png.width, png.논리h || png.height, 0, 0, 판.width, 판.height);
    e._url = url;
  } else if (e._url !== url) {
    if (e._판) { e.removeChild(e._판); e._판 = null; }
    var 조각 = bgcss(url, TW, TH);
    var 위치 = e.style.backgroundPosition;
    e.style.cssText = e.style.cssText.replace(/background-image:[^;]*;?/g, '')
                                     .replace(/background-size:[^;]*;?/g, '') + 조각;
    if (위치) e.style.backgroundPosition = 위치;
    e._url = url;
  }
  if (타일 != null) { e._타일 = 타일 | 0; e._x = x | 0; e._y = y | 0; }   /* 팔레트를 갈면 이 번호로 다시 붙인다 (_애니타일다시칠하기) */
  return e;
};

/** 팔레트를 간 뒤 — 공격·이동 범위 표시 그림(스타일 규칙 한 줄)을 새 팔레트로 맞춘다.
 *   ☠ 전에는 _범위리맵URL 만 비우고 규칙은 두어, 다음 addMark 전까지 옛 그림이 보였다 —
 *     흰 번쩍임 중에 구운 판이면 범위 칸이 하얀 상자로 남았다 (2026-10-01 사장님 「상자 하얗게 나오는 문제도 있고」)
 *   화면에 범위 칸이 있으면 바로 다시 굽고, 없으면 옛 그림을 걷는다(다음 addMark 가 굽는다). */
Renderer.prototype._범위리맵다시 = function () {
  if (typeof document === 'undefined') return this;
  /* ★ 팔레트 연출 중(_palSaved — 섞기·밝기가 원래 팔레트를 쥐고 있는 동안)에는 범위 바닥을 다시 굽지 않는다 (2026-10-09)
   *   그 굽기는 바닥 전체를 xBRZ 로 키우고 PNG 로 만들어 한 번에 ≈300ms(헤드리스 xbrz3 프로파일 — toDataURL·dist·paint 가 대부분).
   *   원본은 효과가 도는 동안 범위 칸을 지우고 그린다(0x13F8A). 연출이 끝나 되돌릴 때(clearPaletteMix → 팔레트만갈기)는 _palSaved 가 비어 다시 굽는다. */
  if (this._palSaved) return this;
  if (document.querySelector('.g2-mark.g2-범위리맵')) { this._범위리맵바닥(); return this; }
  var st = document.getElementById('g2-범위리맵-스타일');
  if (st) st.textContent = '';
  return this;
};

/** 팔레트를 간 뒤 — 이미 붙은 바닥 애니 칸을 새 팔레트로 다시 붙인다.
 *   애니는 한 걸음 넘어갈 때만 그림을 거는데, 연출·링 동안엔 걸음이 멈춰 옛 색이 남았다
 *   (흰 번쩍임 뒤 한 칸이 하얗게 · 링 음영 중 한 칸만 밝게 — 2026-10-01 사장님 「상자 하얗게 나오는 문제도 있고」) */
/* ★ 애니 칸을 «그룹 변수»로 (2026-10-10 사장님 「19-1 해전인데 일단 너무 느리고」)
 *   바다 맵(19-1)은 애니 칸이 3,600 — 물결 한 걸음마다 칸마다 스타일 글을 정규식으로 고쳐 써 메인 스레드가 내내 막혔다
 *   (헤드리스 실측: 가만히 있어도 한 장 255ms · CPU 71% 가 tileCell). 같은 그룹 칸은 같은 프레임이므로
 *   칸은 처음 한 번만 만들어 배경을 var(--g2at<그룹>) 로 두고, 걸음마다 host 의 변수 하나만 바꾼다 — 그림·자리는 tileCell 과 같다. */
/* ★★★★★ 바닥 애니 칸은 «맵 크기 캔버스 한 장»에 칠한다 (2026-10-10 사장님 「원본 기울기 원본 시야로 해도 느리다고. 지금 니가 처리하는 방식 자체가 문제가 있는거야」)
 *   원본 0x10A30 도 애니 칸을 화면 버퍼 한 장에 찍는다. 우리는 칸마다 DOM 요소(translateZ 로 저마다 GPU 층)를 두어
 *   바다 맵(19-1) 3,600칸이 3,600 층 — 물결이 바뀔 때마다 층마다 다시 그리고 합쳤다.
 *   ⇒ 접는선 아래 칸은 tileLayer 안 캔버스 하나에 그룹 그림이 바뀐 칸만 다시 칠한다(접는선 위 배경벽 칸만 예전 요소 길). */
Renderer.prototype.애니판그룹 = function (그룹, 타일, 칸목) {
  if (typeof document === 'undefined' || !this.tileLayer || !this.nmap) return false;
  var src = this.tileCanvas(타일);
  if (!src) return false;
  var 논w = src.논리w || src.width, N = Math.max(1, Math.round(src.width / (논w || TW)));
  var 판 = this._애니판;
  if (!판 || 판.parentNode !== this.tileLayer || 판._N !== N || 판._mapW !== this.mapW || 판._mapH !== this.mapH) {
    if (판 && 판.parentNode) 판.parentNode.removeChild(판);
    판 = this._애니판 = document.createElement('canvas');
    판.className = 'g2-anim-board';
    판.width = Math.round(this.mapW * N); 판.height = Math.round(this.mapH * N);
    판._N = N; 판._mapW = this.mapW; 판._mapH = this.mapH;
    판.style.cssText = 'position:absolute;pointer-events:none;image-rendering:' + rend() + ';' +
      'left:' + (-this.mapW / 2) + 'px;top:' + (-this.mapH / 2) + 'px;width:' + this.mapW + 'px;height:' + this.mapH + 'px;' +
      'transform:translateZ(0.05px);';
    this.tileLayer.appendChild(판);
    this._애니판타일 = {};                                   /* 새 판이면 모든 그룹을 다시 칠한다 */
  }
  (this._애니판목록 || (this._애니판목록 = {}))[그룹] = { 타일: 타일 | 0, 칸목: 칸목 };   /* 팔레트가 바뀌면 이것으로 곧바로 다시 칠한다 */
  var 지난 = this._애니판타일 || (this._애니판타일 = {});
  if (지난[그룹] === src) return true;                       /* 같은 그림(같은 팔레트·같은 프레임)이면 칠하지 않는다 */
  지난[그룹] = src;
  var g = 판.getContext('2d'), w = TW * N, h = TH * N, fold = this.backdropEl ? (this._foldY || 0) : 0, self = this, 벽url = null;
  for (var i = 0; i < 칸목.length; i++) {
    var x = 칸목[i][0] | 0, y = 칸목[i][1] | 0;
    if (y < fold) {                                                                     /* 배경벽 칸 — 예전 요소 길 */
      if (!벽url) { 벽url = self.tileUrl(타일); if (벽url) self.애니그룹그림(그룹, 벽url); }
      if (벽url) self.애니그룹칸(그룹, x, y, 타일, 벽url);
      continue;
    }
    var 옛 = self.tileEls[x + ',' + y];
    if (옛) { if (옛.parentNode) 옛.parentNode.removeChild(옛); delete self.tileEls[x + ',' + y]; }
    g.clearRect(x * w, y * h, w, h);
    g.drawImage(src, 0, 0, 논w, src.논리h || src.height, x * w, y * h, w, h);   /* 원본 사각형 = 논리 · 목적지 = 실제 (스케일러 drawImage 규약) */
  }
  return true;
};
Renderer.prototype.애니그룹그림 = function (그룹, url) {
  if (!this.host || !this.host.style) return false;
  var 값표 = this._애니그룹값 || (this._애니그룹값 = {});
  var 타표 = this._애니그룹주소 || (this._애니그룹주소 = {});
  if (타표[그룹] === url && 값표[그룹]) return true;
  /* ☠ data URL 안에 ';' 가 있다(data:image/png;base64,…) — url(…) 괄호째로 읽는다 */
  var m = /background-image:\s*(url\([^)]*\)|[^;]+)/.exec(bgcss(url, TW, TH));
  var 값 = m ? m[1] : ('url(' + url + ')');
  타표[그룹] = url;
  if (값표[그룹] !== 값) { 값표[그룹] = 값; this.host.style.setProperty('--g2at' + 그룹, 값); }
  return true;
};
Renderer.prototype.애니그룹칸 = function (그룹, x, y, 타일, url) {
  var k = x + ',' + y, e = this.tileEls[k];
  var onBackdrop = !!(this.backdropEl && y < (this._foldY || 0));
  var want = onBackdrop ? this.backdropEl : this.tileLayer;
  if (e && e._그룹 === 그룹 && e.parentNode === want) { e._타일 = 타일 | 0; return e; }
  if (e && e.parentNode) e.parentNode.removeChild(e);
  e = el('div', 'g2-anim-tile', want);
  /* 크기·보간은 bgcss 그대로 — 그림 자리만 변수로 바꾼다 */
  var 조각 = bgcss(url, TW, TH).replace(/background-image:\s*(url\([^)]*\)|[^;]+);?/, 'background-image:var(--g2at' + 그룹 + ');');
  e.style.cssText =
    'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
    'width:' + TW + 'px;height:' + TH + 'px;' +
    'left:' + (onBackdrop ? x * TW : x * TW - this.mapW / 2) + 'px;' +
    'top:'  + (onBackdrop ? y * TH : y * TH - this.mapH / 2) + 'px;' +
    'background-repeat:no-repeat;background-position:0 0;' +
    'transform:translateZ(0.05px);' + 조각;
  e._그룹 = 그룹; e._url = null; e._타일 = 타일 | 0; e._x = x | 0; e._y = y | 0;
  this.tileEls[k] = e;
  return e;
};
Renderer.prototype._애니타일다시칠하기 = function () {
  var 칸들 = this.tileEls || {}, self = this;
  /* SCE 가 layerA 를 바꾼 직후 팔레트가 먼저 오면 옛 칸 목록은 폐기돼 있다.
   * 현재 MAP 의 기존 Fx 첫 프레임을 한 번 계산해 새 칸으로 다시 칠한다. */
  var fx = root.G2Fx;
  if (this._애니판 && this._애니판목록 === null && fx && fx.renderer === this &&
      typeof fx.tileAnim === 'function') fx.tileAnim(null, 0);
  /* 애니 판(캔버스 한 장) — 그룹마다 지금 그림으로 곧바로 다시 칠한다 */
  if (this._애니판 && this._애니판목록) {
    this._애니판타일 = {};
    var 목 = this._애니판목록;
    Object.keys(목).forEach(function (g) { self.애니판그룹(g | 0, 목[g].타일, 목[g].칸목); });
  }
  /* 그룹 변수 칸은 변수만 다시 낸다(팔레트가 바뀌어 tileUrl 이 달라짐) */
  var 그룹타일 = {};
  Object.keys(칸들).forEach(function (k) { var e = 칸들[k]; if (e && e._그룹 != null) 그룹타일[e._그룹] = e._타일; });
  this._애니그룹주소 = {};
  Object.keys(그룹타일).forEach(function (g) { var u = self.tileUrl(그룹타일[g]); if (u) self.애니그룹그림(g, u); });
  Object.keys(칸들).forEach(function (k) {
    var e = 칸들[k];
    if (!e || e._타일 == null || e._그룹 != null) return;
    var url = self.tileUrl(e._타일);   /* ★ 주소 하나를 칸들이 나눠 쓴다 (2026-10-07 되돌림 · fx.js tileAnim 주석 — 칸마다 캔버스면 바다 맵이 966 층) */
    if (url) self.tileCell(url, e._x, e._y, e._타일);
  });
  return this;
};

/**
 * ★★★ **단색 실루엣 굽기** — 원본 그리기 `0x5F517` 을 그대로 옮긴 것.
 *
 * 원본은 스프라이트의 「건너뛸 픽셀 수 / 그릴 픽셀 수」만 읽고 **그림 데이터는
 * 건너뛴 채**(`0x5F555 esi += ecx*4`) 색 하나로 채운다(`0x5F55D rep stosd`).
 * 우리는 이미 구워진 프레임 캔버스가 있으므로 **알파만 남기고** 그 색으로 덮는다
 * (`source-in`) — 결과가 같다.
 *
 * @param {object} fr  `_unitFrameURL` 이 낸 프레임 `{url, w, h, ...}`
 * @param {number} idx 팔레트 인덱스 (`0x28332` 발광표의 값)
 */
/**
 * ★ 치환표 2 — 소울리콜로 되살린 유닛의 «초록 몸» (2026-09-25 · 원본 직독)
 *   전투 준비 0x55C82 edx=0xE · 0x55C87 eax=2 → 0x55C8C call 0x610B6(표 2, 색 14):
 *     0x60DDE  기준 팔레트(0xB824C · 6비트) 색 14 의 R·G·B 를 «가장 큰 값 대비 %»로 (가장 큰 값이 0 이면 100·100·100)
 *     0x60EE5  색 i 마다 밝기 L = ⌊(3R + 5G + 2B) / 10⌋ → (⌊L·R%/100⌋, ⌊L·G%/100⌋, ⌊L·B%/100⌋)
 *              → 256색 중 맨해튼 거리가 가장 작은 번호(같으면 앞 번호 · 0x60FF5 jge)
 *   소울리콜 0x2B6AB~0x2B6DA 가 되살린 유닛의 그림 44장 픽셀을 이 표로 한 번 바꾼다(0x100F2).
 *   ⇒ 우리는 «표를 거친 팔레트»(P2[i] = P[표[i]])로 같은 원본 번호 배열을 굽는다 — 결과가 같다.
 */
Renderer.prototype._치환표2 = function () {
  var P = this._palSaved || this._유닛팔레트();
  if (!P || P.length < 768) return null;
  if (this._표2 && this._표2팔 === P) return this._표2;
  var b = function (i, k) { return (P[i * 3 + k] | 0) >> 2; };      /* 8비트 → VGA 6비트 (decodePalette 의 역) */
  var R = b(14, 0), G = b(14, 1), B = b(14, 2), m = Math.max(R, G, B);
  var rp = 100, gp = 100, bp = 100;                                   /* 0x60E4D — 가장 큰 값이 0 이면 100 */
  if (m) { rp = Math.trunc(R * 100 / m); gp = Math.trunc(G * 100 / m); bp = Math.trunc(B * 100 / m); }   /* 0x60E6C~0x60EDA */
  var T = new Uint8Array(256);
  for (var i = 0; i < 256; i++) {
    var L = Math.trunc((b(i, 0) * 3 + b(i, 1) * 5 + b(i, 2) * 2) / 10);   /* 0x60F0B~0x60F42 */
    var r = Math.trunc(L * rp / 100), g = Math.trunc(L * gp / 100), bb = Math.trunc(L * bp / 100);   /* 0x60F44~0x60F8A */
    var 최소 = 0x7FFF, 번 = 0;
    for (var j = 0; j < 256; j++) {                                   /* 0x60F97~0x61006 */
      var dd = Math.abs(r - b(j, 0)) + Math.abs(g - b(j, 1)) + Math.abs(bb - b(j, 2));
      if (dd < 최소) { 최소 = dd; 번 = j; }
    }
    T[i] = 번;
  }
  this._표2 = T; this._표2팔 = P; this._표2캐 = {};
  return T;
};
/** 치환표 2 를 거친 유닛 그림 — 원본 번호 배열(_usprRaw)을 P2[i] = P[표2[i]] 팔레트로 굽는다 */
Renderer.prototype._치환표2그림 = function (file, n, fr) {
  var raw = this._usprRaw && this._usprRaw[file] && this._usprRaw[file][n];
  var T = this._치환표2(), P = this._유닛팔레트();
  if (!raw || !T || !P) return fr && fr.url;
  var N = (root.G2Scaler && root.G2Scaler.N()) || 1;
  this._표2캐 = this._표2캐 || {};
  var key = file + '#' + n + '#' + N;
  if (this._표2캐[key]) return this._표2캐[key];
  var P2 = new Uint8Array(768);
  for (var i = 0; i < 256; i++) for (var k = 0; k < 3; k++) P2[i * 3 + k] = P[T[i] * 3 + k];
  P2._기록바탕 = P._기록바탕 || P; /* 계측 전용 꼬리표 — 이 팔레트를 만든 원래 팔레트(암전 판정 · 04_도구/우리그리기기록.js · 2026-09-27) */
  return (this._표2캐[key] = root.G2Native.frameToCanvas(raw, P2).toDataURL());
};

Renderer.prototype._실루엣그림정보 = function (fr, idx) {
  if (!fr || !fr.url) return fr && fr.url;
  this._silCache = this._silCache || {};
  /* ★ 실루엣 색은 «섞기 전» 팔레트에서 — 암전(리맵·DAC 섞기) 뒤에 그리는 원본 0x5F517 은 색 40~46 이 섞기 범위(96~255) 밖이라 원래 밝기다
   *   (2026-09-26 사장님 「설화난영참 올라가고 내려올때 파란 이펙트도 음영처리 안되어야 할거야」 · 원본 기록 칸 03 치환 뒤 실루엣) */
  var P = this._유닛쓸팔 || this._유닛팔레트();
  var key = fr.url + '#' + idx + '#' + (P === this._palette ? 'p' : 'u');
  if (this._silCache[key]) return this._silCache[key];

  if (!P || P.length < 768) return fr.url;                 // 팔레트가 아직 — 원본 그대로
  var i3 = (idx | 0) * 3;
  var css = 'rgb(' + (P[i3] | 0) + ',' + (P[i3 + 1] | 0) + ',' + (P[i3 + 2] | 0) + ')';

  /* `fr.url` 은 data-URL(원본 직독) 이라 동기로 못 그린다 — 원본 캔버스를 쓴다. */
  var src = fr.canvas || (fr.img && fr.img.width ? fr.img : null);
  if (!src) return fr.url;
  var w = src.논리w || src.width, h = src.논리h || src.height;
  if (!w || !h) return fr.url;
  /* ★ 오래 쓰는 캐시 — 실루엣은 «윤곽(파일·그림 번호·크기)»과 «색»만으로 정해진다 (2026-10-01 사장님 「잔상 굽기 줄이는 것도 진행해줘」)
   *   위 _silCache 는 열쇠가 그림 주소 전체라, 필살 암전이 팔레트를 바꿔 유닛 그림을 다시 구우면(주소가 바뀜)
   *   같은 모양·같은 색을 매번 PNG 로 다시 구웠다(연 한 번 ≈300ms · 실루엣 한 장 15~50ms 계측).
   *   이 캐시는 팔레트가 바뀌어도 안 비운다 — 열쇠에 색(css)과 크기가 들어 있어 다른 것과 섞이지 않는다. */
  var 오래열쇠 = fr.열쇠 ? (fr.열쇠 + '#' + src.width + 'x' + src.height + '#' + css) : null;
  this._silKeep = this._silKeep || {};
  if (오래열쇠 && this._silKeep[오래열쇠]) return (this._silCache[key] = this._silKeep[오래열쇠]);

  var cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  var cx = cv.getContext('2d');
  /* ★★★ **5인자로 명시한다** — 3인자(목적지 크기 생략)로 부르면 `scaler.js` 의
   *   drawImage 몽키패치가 `src.논리w` 를 보고 **논리 크기로 줄여서** 그린다
   *   (그 패치는 「N배 캔버스를 원래 크기로 되돌린다」는 것이 목적이라, 여기처럼
   *   **N배 캔버스에 N배 그대로 복사하려는 자리**에서는 반대로 작동한다).
   *
   *   그러면 `72×72` 캔버스 좌상단에 `24×24` 로만 그려지고, 뒤이어
   *   `bgcss(url, fr.w, fr.h)` 가 background-size 를 **논리(24×24)** 로 누르므로
   *   화면에서는 결국 **1/N² (8×8)** 로 쪼그라든다.
   *   사용자가 본 「캐릭터보다 많이 작게 축소되어서 보여」가 바로 이것이다.
   *   (2026-08-16 확정. `_silCache` 초기화 문제인 줄 알고 두 번 헛짚었다.) */
  cx.drawImage(src, 0, 0, src.width, src.height);
  cx.globalCompositeOperation = 'source-in';               // ★ 알파만 남기고 단색으로
  cx.fillStyle = css;
  cx.fillRect(0, 0, cv.width, cv.height);

  var out = cv.toDataURL();
  this._silCache[key] = out;
  if (오래열쇠) this._silKeep[오래열쇠] = out;
  return out;
};

/**
 * ★★ 발광을 켜고 끈다 — `0x2914A` 의 8프레임 루프(`0x29230`)가 쓴다.
 * @param {object} u    대상 유닛
 * @param {number|null} idx 팔레트 인덱스. `null` 이면 원래 그림으로 되돌린다.
 */
Renderer.prototype.glowUnit = function (u, idx) {
  if (!u) return;
  this._glow = this._glow || {};
  if (idx == null) delete this._glow[u.id];
  else this._glow[u.id] = idx | 0;
  this.updateUnit(u);
};

/** 위층 이펙트 자산 소유자가 논리 시트 정보 읽기 함수를 연결한다. */
Renderer.prototype.이펙트시트정보포트 = function (읽기) {
  this._이펙트시트정보읽기 = (typeof 읽기 === 'function') ? 읽기 : null;
  return this;
};

/** 이펙트 자산 소유자가 준 동결 논리 크기 스냅샷을 읽는다. */
Renderer.prototype.이펙트시트정보 = function (url) {
  return this._이펙트시트정보읽기 ? this._이펙트시트정보읽기(url) : null;
};

/**
 * 이펙트 스프라이트 한 장. 유닛과 같은 빌보드다.
 * @param {string} png 그림 URL
 * @param {string} [자리] `top|screen-under|cam-plane|screen`. 생략 때만 앞 세대
 *   `fxLayer` 호환 부모를 쓴다. 호출자가 뜻을 아는 경우 반드시 명시한다.
 */
Renderer.prototype.fxSprite = function (png, 자리, 순서) {
  var kind = 자리 || 'attack-between';
  var host = this.FX층(kind);
  var e = el('div', 'g2-fx', host);
  e._fxLayerKind = kind;
  e._fxOrder = (순서 == null ? 0 : (순서 | 0));
  /* 원본 직독 이펙트는 data-URL 로 옵니다 (할일 19) — base 를 붙이면 안 됩니다 */
  var url = (png && png.indexOf('data:') === 0) ? png : this.base + png;
  /* ★ 스케일러가 켜져 있으면 시트가 **N배**로 구워져 있다(`fx.js packFrames`).
   *   `background-position`/`width`/`height` 는 전부 **논리** 좌표라,
   *   `background-size` 를 논리 크기로 눌러 담아야 자리가 맞는다.
   *   시트의 논리 크기는 캔버스에 `논리w`/`논리h` 로 달려 있다. */
  var sheet = this.이펙트시트정보(url);
  var size = (sheet && sheet.논리w)
    ? 'background-size:' + sheet.논리w + 'px ' + sheet.논리h + 'px;' : '';
  /* ★ 보간은 rend() — 스케일러가 켜지면 N배 그림을 화면 크기로 줄일 때 부드럽게(auto) · 꺼지면 pixelated.
   *   ☠ 여기만 pixelated 로 박혀 있어 N배 그림이 최근접으로 뽑혀 계단이 됐다 — 마법·초필살기 그림만 스케일러가 안 걸린 것처럼 보였다
   *   (11-09 사장님 「그리고 스케일러가 이펙트에는 제대로 안걸리는 것 같아. 초필살기에 스케일러 적용이 안되는 듯해」 · 애니 타일 8329 와 같은 갈래) */
  e.style.cssText =
    'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
    'transform-origin:50% 100%;background-repeat:no-repeat;' + size +
    'background-image:url(' + url + ');';
  this.연출요소층설정(e, kind, e._fxOrder);
  this.fxEls.push(e);
  return e;
};

/**
 * 연출 요소를 명시한 물리 레이어로 옮긴다.
 * `순서`는 **같은 레이어 안에서만** 작동한다. 좌표/배율/앵커/자세는 건드리지 않는다.
 */
Renderer.prototype.연출요소층설정 = function (e, kind, 순서) {
  if (!e) return false;
  var host = this.FX층(kind);
  if (!host) return false;
  var order = (순서 == null ? 0 : (순서 | 0));
  e._fxLayerKind = kind;
  e._fxOrder = order;
  /* 같은 층 안에서 order가 바뀐 경우도 재정렬되도록 우선 맨 뒤로 옮긴 뒤
   * 처음 만나는 더 큰 order 앞에 끼운다. 같은 order끼리는 기존 요소 뒤에 붙는다. */
  host.appendChild(e);
  var kids = host.children || [];
  for (var i = 0; i < kids.length; i++) {
    var q = kids[i];
    if (q === e) continue;
    var qo = (q._fxOrder == null ? 0 : (q._fxOrder | 0));
    if (qo > order) { host.insertBefore(e, q); break; }
  }
  return true;
};

/** 효과 빌보드를 월드 레이어와 렌더 추적에서 제거한다. */
Renderer.prototype.dropFxSprite = function (e) {
  var i = this.fxEls.indexOf(e);
  if (i >= 0) this.fxEls.splice(i, 1);
  if (e && e._shieldUnitId != null && this._방패요소) {
    var shieldKey = String(e._shieldUnitId);
    if (this._방패요소[shieldKey] === e) delete this._방패요소[shieldKey];
    if (!Object.keys(this._방패요소).length && this._방패정리해제) {
      this._방패정리해제(); this._방패정리해제 = null;
    }
  }
  if (e.parentNode) e.parentNode.removeChild(e);
};

/**
 * 이펙트 한 장을 맵 픽셀 좌표에 놓습니다.
 * (mapX, mapY) 는 그림의 **좌상단** 맵 픽셀 좌표입니다
 * (= 기준점 + 앵커.  0x30D90 : 화면x = 기준x + 앵커x).
 */
Renderer.prototype.placeFx = function (e, mapX, mapY, w, h) {
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  this._빌보드놓기(e, mapX, mapY + h, h);
  /* ★ 보간 기준도 새 자리로 — 재활용된 요소에 옛 _pl·_pg 가 남으면 연출 중(lerpT < 1) 옛 자리와 섞여 찍혔다
   *   (2026-09-26 무신멸뢰옥 휘두르기 0x1E2EA — 1·2단계 y 가 16 달라야 하는데 둘 다 116 · 원본 기록 칸 10) */
  e._pl = mapX; e._pg = mapY + h;
  /* 놓은 그 장에 곧바로 자리를 잡는다 — 다음 apply 를 기다리면 그 사이 한 장은 top 0 에 있다 (연출명령빌보드반영과 같게) */
  if (this._빌보드적용) this._빌보드적용(e);
};

/* 바닥에 닿는 명시 연출만 리마스터 preview 높이를 소비한다. 원본 연출 경로는 placeFx 그대로다. */
Renderer.prototype.placeTerrainGroundFx = function (e, mapX, mapY, w, h, tileX, tileY) {
  if (!e || !Number.isFinite(tileX) || !Number.isFinite(tileY))
    throw new TypeError('바닥 연출의 명시 칸이 필요하다');
  e._terrainPreviewAnchor = { x: tileX, y: tileY };
  this.placeFx(e, mapX, mapY, w, h);
  return e;
};

/**
 * 정본 §3 의미 명령으로 일반 월드 효과 한 장을 놓는다.
 * 첫 이관 경계는 기존 `placeFx`와 정확히 같은 맵 좌상단·세움·선택위 조합만 받는다.
 * 다른 뜻을 조용히 이 조합으로 떨어뜨리지 않고, 각 갈래가 이관될 때 명시적으로 넓힌다.
 */
Renderer.prototype.연출프레임명령놓기 = function (e, 명령, fr, scale, w, h) {
  연출명령계약.검사(명령);
  if (명령.공간 !== '맵' || 명령.앵커 !== '발밑' || 명령.y의뜻 !== '깊이' ||
      명령.자세 !== '세움' || 명령.아래위 !== '선택위')
    throw new Error('아직 지원하지 않는 연출 의미 명령 조합');
  var x = Math.round(명령.자리.x + fr.ax * scale);
  var y = Math.round(명령.자리.y + fr.ay * scale);
  return this.placeFx(e, x, y, w, h);
};

/** 맵 좌상단 선택위 빌보드의 배치·논리자리 기록·적용 순서를 한 번에 반영한다. */
Renderer.prototype.연출명령빌보드반영 = function (e, 명령, h) {
  연출명령계약.검사(명령);
  /* ★ `공격중간` 은 **공격자·대상 사이 층(`attack-between`)에 만든 요소일 때만** 받는다 (2026-10-03 명시 확장)
   *   비룡 평타 브레스(`0x4798A` · battle_main 브레스)가 이 뜻을 보내는데 여기는 `선택위` 만 받아
   *   680904b(09-26) 이관 뒤로 «아직 지원하지 않는 … 조합» 을 던졌고, 브레스가 그 오류를 삼켜 불이 한 번도 안 나왔다
   *   (사장님 「비룡탑승시 공격연출도 잘못 적용되었어.」 · 「불을 안뿝는다고」). 놓는 산식은 선택위와 같다 — 층은 fxSprite 종류가 정한다. */
  var 관계OK = 명령.아래위 === '선택위' ||
               (명령.아래위 === '공격중간' && e && e._fxLayerKind === 'attack-between');
  if (명령.공간 !== '맵' || 명령.앵커 !== '좌상단' || 명령.y의뜻 !== '깊이' ||
      명령.자세 !== '세움' || !관계OK)
    throw new Error('아직 지원하지 않는 연출 빌보드 의미 명령 조합');
  var x = 명령.자리.x, y = 명령.자리.y;
  this.빌보드놓기(e, x, y + h, h);
  e._pl = x;
  e._pg = y + h;
  this.빌보드적용(e);
  return true;
};

/* ── 표식 (이동 범위·커서) ────────────────────────────────────────────── */
/** 원경 위 표식 조각을 지금 있는 표식(marks)으로 다시 얹는다 — 조각 층이 표식보다 늦게 생겼을 때 (addMark 와 같은 자리·같은 크기) */
Renderer.prototype._fpm표식조각다시 = function () {
  var 층f = this._fpm표식층;
  if (!층f) return;
  층f.innerHTML = '';
  var fold = this._fpmFoldPx | 0;
  (this.marks || []).forEach(function (d) {
    if (!d || d._칸x == null) return;
    var x = d._칸x | 0, y = d._칸y | 0, fy = y * TH - fold;
    if (fy < 0) return;
    var f = el('div', 'g2-fpm리맵', 층f);
    f.style.cssText = 'left:' + (x * TW) + 'px;top:' + fy + 'px;width:' + (d.style.width || (TW + 'px')) + ';height:' + (d.style.height || (TH + 'px')) + ';' +
      'background-position:calc(var(--fpx) - ' + (x * TW) + 'px) calc(var(--fpy) - ' + fy + 'px);';
    d._fpm조각 = f;
  });
};
Renderer.prototype.clearMarks = function () {
  this.markLayer.innerHTML = '';
  if (this._표식위층) this._표식위층.innerHTML = '';   /* [리마스터] 무덤 가시 위 표식 (addMarkTop) */
  if (this._fpm표식층) this._fpm표식층.innerHTML = '';   /* [리마스터] 원경 위 표식 조각 (addMark) */
  this.marks = [];
  this._표식자리 = null;          /* ★ 이음새 메우기용 칸 → 요소 (addMark 주석) */
  if (this._탐색음영자리) this._탐색음영붙이기();   /* 탐색 음영은 끌 때까지 남는다 */
};
/** [리마스터] 오브젝트 «위»에 반투명 표식 — 용자의 무덤 가시(오브젝트 블록)가 바닥 표식을 덮는 칸용 (2026-10-12)
 *   사장님(원문) 「가시 위에 하이라이트표시(이동, 배치 표시가 안나와서 … 가시위에도 이동 가능하게 영역 표시되고 배치 영역도 표시되어야해」
 *   오버레이층(world 와 같은 변환 · facingGuide 와 같은 좌표)에 붙인다 · 리맵 바닥을 얹으면 가시 그림이 지워지므로 반투명만 · clearMarks 가 함께 지운다 */
Renderer.prototype.addMarkTop = function (x, y, cls, color) {
  if (!this._표식위층) {
    this._표식위층 = el('div', 'g2-mark-top-layer', this._오버레이층확보());
    this._표식위층.style.cssText = 'position:absolute;transform-style:preserve-3d;pointer-events:none;';
  }
  var d = el('div', 'g2-mark-top ' + (cls || ''), this._표식위층);
  d.style.cssText =
    'position:absolute;width:' + TW + 'px;height:' + TH + 'px;' +
    'left:' + (x * TW - this.mapW / 2) + 'px;' +
    'top:' + (y * TH - this.mapH / 2) + 'px;' +
    'pointer-events:none;';
  var 리맵 = this._가시리맵판();   /* 일반 칸 범위와 같은 리맵 색 — 없으면 반투명 */
  if (리맵) { d.className += ' g2-가시리맵'; d.style.backgroundPosition = (-(x * TW)) + 'px ' + (-(y * TH)) + 'px'; }   /* 그림은 스타일 규칙(_가시리맵판) — 요소는 자리만 */
  else d.style.background = color || 'rgba(255,255,255,.30)';
  /* [리마스터] 정본 255 — 이 위층은 인물(월드층)보다 위라 그 칸에 선 인물·커서 상자를 덮었다
   *   (2026-11-16 사장님 「그리고 하이라이트 영역에 캐릭터 이미지 잘리는것도 고쳐야해」·「하이라이트에 커서도 가려 제대로 처리해」 · 9-9 FR04 풀숲 칸)
   *   눕힌 큰 조각은 «맨 아래 줄»로 정렬돼 그 윗칸 인물보다 뒤에 그려지므로 DOM 차례만으로는 «조각 위 · 인물 아래»를 못 맞춘다
   *   ⇒ ① 커서 상자 층(boxLayer)보다는 아래 ② 그 칸에 겹친 인물 상자 자리는 오려 낸다(clip-path evenodd) — 인물은 안 덮고 나머지는 그대로 밝게 */
  var 오 = this.overlayLayer;
  if (오 && this.boxLayer && this.boxLayer.parentNode === 오 && this._표식위층.parentNode === 오 &&
      this._표식위층.nextSibling !== this.boxLayer && typeof 오.insertBefore === 'function') {
    var 뒤것 = this._표식위층.compareDocumentPosition ? (this._표식위층.compareDocumentPosition(this.boxLayer) & 2) : 0;   /* 2 = boxLayer 가 앞 */
    if (뒤것) 오.insertBefore(this._표식위층, this.boxLayer);
  }
  if (this._표식위층.children.length === 1 || !this._표식위유닛) {   /* 이 차례(clearMarks 뒤) 첫 칸에서 인물 상자를 한 번만 잰다 */
    var 목 = [], 유 = this.unitEls || {};
    Object.keys(유).forEach(function (k) {
      var b = 유[k]; if (!b || !b.style || b.style.display === 'none' || b._left == null || b._ground == null) return;
      var w = parseFloat(b.style.width) || 0, h = b._h || 0; if (!(w > 0 && h > 0)) return;
      목.push({ l: b._left, t: b._ground - h, r: b._left + w, b: b._ground });
    });
    this._표식위유닛 = 목;
  }
  var cx0 = x * TW, cy0 = y * TH, 구멍 = '';
  for (var ui = 0; ui < this._표식위유닛.length; ui++) {
    var q = this._표식위유닛[ui];
    var l = Math.max(cx0, q.l), t = Math.max(cy0, q.t), r = Math.min(cx0 + TW, q.r), bo = Math.min(cy0 + TH, q.b);
    if (r > l && bo > t) 구멍 += ' M' + (l - cx0) + ' ' + (t - cy0) + 'H' + (r - cx0) + 'V' + (bo - cy0) + 'H' + (l - cx0) + 'Z';
  }
  if (구멍) d.style.clipPath = "path(evenodd, 'M0 0H" + TW + 'V' + TH + 'H0Z' + 구멍 + "')";
  return d;
};
/** 지정 전투 칸에 종류와 색을 가진 범위 표식 하나를 추가한다. */
Renderer.prototype.addMark = function (x, y, cls, color) {
  var d = el('div', 'g2-mark ' + (cls || ''), this.markLayer);
  /* ★★★ 원본 `0x1547F` 는 **그 칸을 리맵**한다 — 반투명을 덮는 것이 아니다
   *   (`_범위리맵바닥()` 주석). 리맵판을 못 만들면 예전 반투명으로 떨어진다. */
  var 리맵 = this._범위리맵바닥();
  /* ★ 그림은 **스타일 규칙**이 들고 있다 (`_범위리맵바닥()` 주석) — 여기서는 자리만 */
  var 배경 = 리맵
    ? ('background-position:' + (-(x * TW)) + 'px ' + (-(y * TH)) + 'px;')
    : ('background:' + (color || 'rgba(255,255,255,.30)') + ';');
  if (리맵) d.className += ' g2-범위리맵';
  d.style.cssText =
    'position:absolute;width:' + TW + 'px;height:' + TH + 'px;' +
    'left:' + (x * TW - this.mapW / 2) + 'px;' +
    'top:' + (y * TH - this.mapH / 2) + 'px;' +
    배경 + 'pointer-events:none;';
  /* ★★★ **칸 사이에 실금이 보이던 것** (2026-09-22 사장님 지적)
   *   > 「이동영역, 타겟지정영역, 효과영역 처럼 지면 타일에 하이라이트 되는 부분에서
   *   >  **각 타일간에 경계가 표시**돼. **하나로 연결**되어야하는데」
   *
   *   원본 `0x1547F` 는 칸을 **한 장의 화면 위에서** 리맵하므로 경계가 아예 없다.
   *   우리는 칸마다 요소를 하나씩 놓으므로, 3D 변환·확대에서 **요소마다 따로 래스터**되어
   *   가장자리가 반투명해지고 그 틈으로 바닥이 비친다 — 그것이 실금이다.
   *   ⇒ 바닥 조각(`_원본바닥짓기` — 「이웃 타일과 1px 겹치게 늘린다」)과 **같은 수법**으로
   *     이웃 쪽으로만 1px 겹친다.
   *   ☠ **표시 영역 밖으로는 안 늘린다** — 이웃 칸이 같은 종류로 떠 있을 때만 늘린다.
   *     안 그러면 영역 테두리가 1px 씩 번져 모양이 달라진다. */
  var 자리 = this._표식자리 || (this._표식자리 = {});
  var 갈래 = (cls || '') + '|';
  자리[갈래 + x + ',' + y] = d;
  var 오른 = 자리[갈래 + (x + 1) + ',' + y], 왼 = 자리[갈래 + (x - 1) + ',' + y];
  var 아래 = 자리[갈래 + x + ',' + (y + 1)], 위 = 자리[갈래 + x + ',' + (y - 1)];
  /* [리마스터] 원경이 비치는 맵이면 같은 칸의 원경도 밝힌다 (_원경짓기 · 원본 0x10130 은 화면 버퍼째 리맵) */
  d._칸x = x; d._칸y = y;   /* 원경 조각을 나중에 다시 얹을 때 쓴다 (_fpm표식조각다시) */
  var 층f = this._fpm표식층, fy = y * TH - (this._fpmFoldPx | 0);
  if (층f && fy >= 0) {
    var f = el('div', 'g2-fpm리맵', 층f);
    f.style.cssText = 'left:' + (x * TW) + 'px;top:' + fy + 'px;width:' + TW + 'px;height:' + TH + 'px;' +
      'background-position:calc(var(--fpx) - ' + (x * TW) + 'px) calc(var(--fpy) - ' + fy + 'px);';
    d._fpm조각 = f;
  }
  if (오른) d.style.width = (TW + 1) + 'px';
  if (왼) 왼.style.width = (TW + 1) + 'px';
  if (아래) d.style.height = (TH + 1) + 'px';
  if (위) 위.style.height = (TH + 1) + 'px';
  [d, 왼, 위].forEach(function (q) { if (q && q._fpm조각) { q._fpm조각.style.width = q.style.width; q._fpm조각.style.height = q.style.height; } });
  this.marks.push(d);
  return d;
};

/* ── 행동 가능 표식 (깜빡이는 빛) — 0x12161 ───────────────────────────
 *
 * 원본은 맵을 그리는 `0x12161` 안에서 칸마다 그 자리에 선 유닛을 보고,
 * `[+0x56] == 0xFF` 면 **ETC.ICO 를 바닥에 덧그립니다** (0x12240 ~ 0x12273).
 *
 * ```
 * 0x12240  cmp byte [eax+0x56], 0xff   ; 행동 가능한 유닛만
 * 0x12246  cmp byte [eax+0x83], 0      ; AI 플래그
 * 0x1224F  cmp byte [eax+0x0e], 1      ; 진영
 * 0x12255    eax = [0xE518E]           ;  → 프레임 0~3   (파랑·흰 반짝임 15×13)
 * 0x12265    eax = [0xE518E] + 4       ;  → 프레임 4~7   (그 밖 = 적·AI)
 * 0x12268  eax *= 0xC ; edx = [eax + 0xBA858]   ; 0x44A4C 가 채운 ETC.ICO 0~7 표
 * ```
 * `[0xE518E]` 는 대기 모션과 같은 자리(0x120EF)에서 **30틱마다 (+1) & 3** 입니다.
 *
 * ── 칸 안 위치 확정 (2026-08-13) ────────────────────────────────────────
 * 마커 원점과 유닛 원점을 같은 기준으로 놓고 빼면 상수 하나가 남습니다.
 * ```
 * 마커 (0x12161)   x = [0x7001C] + i·24            y = [0xBA838] + 6 + j·16
 *   0x121B2  ax = word[0xBA838] ; 0x121BC  add eax, 6      ; Y 시작
 *   0x121A7  dx = word[0x7001C]                            ; X 시작
 *   0x121D0  add ebx, 0x18 (칸 폭) · 0x121EF  add eax, 0x10 (칸 높이)
 * 유닛 (0x12567)   x = [0x74FC2] − 12 + [+0x65]    y = [0x74FC0] + 4 + [+0x66]
 *   0x1238B  [0x74FC0] = word[0xBA838] + 2 · 0x125CD  [esp+0x14] = 그 값 + 4
 *   0x12397  [0x74FC2] = word[0x7001C] + 16 − min(카메라X,5)·24
 *   0x128FE  edi = [esp+0x38] − 0xC + [+0x65]  ; 0x12915  edx = [esp+0x14] + [+0x66]
 *   0x12B57  add ecx, 0x18                     ; 칸마다 X 원점 전진
 * ```
 즉 두 원점의 차는 **−4 / 0** 입니다(카메라 하위 픽셀이 양쪽에서 똑같이 빠집니다).
 *
 * ★ 다만 `0x128FE` 가 내는 (x, y) 가 **유닛의 어느 점인지**가 아직 안 잡혔습니다.
 *   `0x12567` 은 행마다 **두 번**(`0x12B85 cmp bx, 2`) 도는데, `0x128FE` 는
 *   `[esp+0x18] == 0` 인 **첫 번째 바퀴**만 타고 두 번째 바퀴는 `0x12866` 이
 *   `[esp+0x24] + … + 0xC` 라는 다른 식을 씁니다. 둘 중 어느 쪽이 캐릭터
 *   ★★★ **2026-08-29 — 두 바퀴의 식을 읽었다.**
 *     ```asm
 *     첫 바퀴 0x128FE  movsx dx, byte [esi+0x65] · **sub edi, 12** · add edi, edx
 *                      movsx dx, byte [esi+0x66] · …
 *     둘째    0x12866  edx = [esp+0x24] + [esp+0x28] · **add edx, 12**
 *                      movsx dx, byte [esi+0x66] · mov [esp+0x44], edx
 *     ```
 *     곧 두 바퀴가 **`[+0x65]` 와 `[+0x66]` 을 나눠 쓰고 ∓12** 를 한다.
 *     `[+0x65]` 는 이미 **「그리기 오프셋」**으로 확정돼 있다
 *     (`ultimate.js` §아수라 — 「미는 값은 `[유닛+0x65]`」).
 *     ⇒ **`[+0x65]` 를 쓰는 첫 바퀴가 캐릭터 스프라이트** 쪽으로 보인다.
 *   ☐ 그래도 화면과 어긋나므로(아래) 단정하지 않는다.
 *   그 상태로 −4/0 을 기준점에 적용했더니 마커가 캐릭터 **가운데 아래**로 가서
 *   원작(왼쪽 아래)과 어긋났습니다(사용자 관측).
 *
 * 그래서 위치는 **관측대로 스프라이트 왼쪽 아래**에 둡니다. 위 −4/0 은 두 원점의
 * 차로는 확실하니, 두 번째 바퀴 식을 풀면 그때 칸 기준으로 확정하면 됩니다.
 *
 * ★★ 집중 이펙트(charMarks)와 같은 이유로 **유닛 박스의 자식**으로 답니다.
 *   별도 레이어에 두면 회전 중심(transform-origin)이 유닛과 달라 기울였을 때
 *   유닛에서 떨어져 나갑니다. 자식이면 유닛과 똑같은 변환을 받습니다.
 *   다만 z 는 반대입니다 — 집중은 캐릭터 **뒤**(−1), 이 마커는 캐릭터
 *   **앞**(10). 원작 영상에서 체커가 캐릭터 그림 위로 겹쳐 보입니다.
 */
/**
 * 원본 `ETC.ICO` 프레임(0~7)을 받아 둡니다 — `0x44A4C` 가 `[0xBA858]` 에 채우는 그 표.
 * @param {{url:string,w:number,h:number}[]} icons
 */
/**
 * ★★★★★ **행동 가능 마커(턴 마커) 아이콘 — `Renderer` 가 새로 만들어져도 살아남는다** (2026-08-24)
 *
 *   사용자 지적: 「아직도 턴 마커는 표시 안돼. **아군 적 모두**」
 *
 *   원인: `battle_assets.js` 가 `ETC.ICO` 0~7 을 직독해 여기로 넘기는데,
 *   그 등록은 **부팅 때 한 번뿐**이다. 셸(`게임.html`)에서 시나리오가 체인되면
 *   `G2전투재구성()` 이 `new Renderer(...)` 로 **R 을 새로 만들어** `_etc` 가 null 이 된다.
 *   그러면 `readyMarks()` 가 요소는 만들되 `if (!ic)` 에서 **`display:none`** 으로 숨긴다
 *   — 그래서 2-4 에서는 보이던 마커가 2-4A 로 넘어가면 통째로 사라졌다.
 *   (실측: 체인 전 `R._etc` 8/8 → 체인 후 **null**, `.g2-ready` 요소는 있는데 안 보임)
 *
 *   ⇒ 넘어온 아이콘을 전역에 두고 **생성자가 스스로 되찾는다.**
 *   원본 마커 조건은 대기시간뿐이다 — `0x12240 cmp [eax+0x56],0xFF`,
 *   진영/AI 로 0~3 · 4~7 을 가른다 (`0x12246` / `0x1224F`).
 */
Renderer.prototype.setEtcIcons = function (icons) {
  this._etc = icons || null;
  if (icons) root.__G2_ETC_ICONS = icons;      /* ★ 재생성 대비 보관 */
  return this;
};

/**
 * 유닛을 맵에서 잠시 지웁니다 — 원본 `[+0x63] = 0` → `0x11EE4`(칸 다시 그리기).
 * 되돌리는 자리는 `0x3B570` / `0x3B562`.
 */
/**
 * 연출 동안 **HP 표시와 선택 상자를 통째로 잠급니다** — 원본 `0x103A8`
 * (`[0x70006] = 0`)이 정기 갱신을 멈추는 자리에 해당합니다.
 *
 * ★ 한 번 꺼 두는 것만으로는 안 됩니다. 마우스를 움직이면 hover 처리가
 *   `selectBox`/`showUnitValues` 를 곧바로 다시 켭니다. 그래서 **플래그**로
 *   두 함수 입구를 막습니다(원본도 전역 하나로 통째로 막습니다).
 */
Renderer.prototype.muteHud = function (on) {
  this._hudMuted = !!on;
  if (this._hudMuted) { this.showUnitValues(false); this.selectBox(null); }
  return this;
};

/** 유닛 본체·그림자·보조 표시를 지정 숨김 상태로 함께 전환한다. */
Renderer.prototype.hideUnit = function (u, on) {
  if (!u) return this;
  this._hidden[u.id] = !!on;
  this.updateUnit(u);
  return this;
};

/** 정본 256 — 소멸 «위로»(0x468BC)가 쓰는 지금 몸 프레임의 폭·앵커 y (0x468D7 esi = 0xD66A8 + 방향·모션 항목 · [esi+2] 폭 · [esi+5] 앵커 y) */
Renderer.prototype.소멸프레임 = function (u) {
  var box = u && this.unitEls && this.unitEls[u.id];
  var 층 = box && box._layers && box._layers[0];
  if (!층 || !층.meta) return null;
  var 위치 = 유닛프레임위치(층.meta, u);
  var fr = this._유닛프레임정보(this._스프라이트파일(층.meta, 층.no), 위치.번호);
  return fr ? { w: fr.w | 0, ay: fr.ay | 0 } : null;
};

/** 소환 유닛을 보이게 한 뒤 원본 솟음 오프셋을 기존 DOM 순서로 반영한다. */
Renderer.prototype.소환유닛솟음반영 = function (u, dy, 표시Y) {
  if (!u) return false;
  var y = Math.max(0, dy | 0);
  var 보정Y = 표시Y | 0;
  var box = this.unitEls && this.unitEls[u.id];
  if (!box && this._유닛상자확보) box = this._유닛상자확보(u);
  if (!box || !box.style) return false;
  if (y) box._소환솟음Dy = y;
  else delete box._소환솟음Dy;
  if (보정Y) box._소환표시Y = 보정Y;
  else delete box._소환표시Y;
  this.hideUnit(u, false);
  box = this.unitEls && this.unitEls[u.id] || box;
  /* 숨김 해제 중 상자가 다시 만들어졌다면 두 독립 순간값을 새 상자에도 심는다. */
  if (box && ((box._소환솟음Dy | 0) !== y || (box._소환표시Y | 0) !== 보정Y)) {
    if (y) box._소환솟음Dy = y; else delete box._소환솟음Dy;
    if (보정Y) box._소환표시Y = 보정Y; else delete box._소환표시Y;
    this.updateUnit(u);
  }
  if (!box || !box.style) return false;
  box.style.marginTop = '';
  box.style.opacity = (y || 보정Y) ? '1' : '';
  box.style.visibility = '';
  if (this._빌보드적용) this._빌보드적용(box);
  return true;
};

/** 소환 유닛의 지속 숨김 상태를 기록하고 남은 인라인 visibility를 걷는다. */
Renderer.prototype.소환유닛숨김반영 = function (u, 켤까) {
  if (!u) return false;
  this.hideUnit(u, !!켤까);
  var box = this.unitEls && this.unitEls[u.id];
  if (box && box.style) box.style.visibility = '';
  if (this._빌보드적용) this._빌보드적용(box);
  return true;
};

/**
 * 사망 연출이 도는 동안 계속 그리게 합니다 (할일 4).
 *
 * 원본 `0x1DB1D` 는 **연출을 먼저** 돌리고(`0x1DBB7 call 0x46B2C` ·
 * `0x1DBC0 call 0x46A11`) 리스트에서 빼는 건 **맨 끝**(`0x1DD9C call 0x1137A`)이다.
 * 우리는 셈(`kill()`)이 `alive = false` 를 먼저 넣으므로, 이 플래그가 없으면
 * `updateUnit` 이 매 프레임 숨겨 **회전 단계를 통째로 못 본다**.
 */
Renderer.prototype.dyingUnit = function (u, on) {
  if (!u) return this;
  if (on) this._dying[u.id] = true; else delete this._dying[u.id];
  this.updateUnit(u);
  return this;
};

/**
 * 「연출 중」 표시를 통째로 내립니다 — **시체가 남는 것**을 막는 안전장치.
 *
 * `dyingUnit(true)` 를 켠 유닛 중 연출이 끝나 `false` 를 못 받은 것이 있으면
 * 그 자리에 그림이 계속 남습니다. 실제로 그런 일이 있었다 —
 * 컨트롤러가 사망 연출이 **끝난 뒤** 부르는 `eventScan` 에 같은 사망자 목록을
 * 실어 보내, 받는 쪽이 표시를 다시 켰다.
 */
Renderer.prototype.clearDying = function () {
  var self = this, ids = Object.keys(this._dying);
  if (!ids.length) return this;
  this._dying = {};
  ids.forEach(function (id) {
    var u = (self.b && self.b.units || []).filter(function (x) { return String(x.id) === id; })[0];
    if (u) self.updateUnit(u);
  });
  return this;
};

/** 행동 가능한 유닛 목록에 준비 표식을 동기화한다. */
Renderer.prototype.readyMarks = function (list) {
  /* 화면 **가로 15칸 × 세로 13칸** — 값이 없을 때의 대체값이다.
   * 원본 `.NC2` 는 4방향 x 11프레임이라 `방향당프레임` 기본값 11 도 거기서 온다.
   * 원본 월드 화면은 12x13 임이 확인돼 있다 (`0x212F1`(+0xD) · `0x21348`(+0xC)).
   * 전투 화면 칸 수는 같은 자리를 봐야 한다. */
  var self = this, MW = 15, MH = 13;      // 기본값 — 실제 크기는 ETC.ICO 프레임에서
  list = list || [];
  var on = {};

  list.forEach(function (m) {
    var box = self.unitEls[m.id];
    if (!box) return;
    var e = box._readyEl;
    if (!e || e.parentNode !== box) {
      e = el('div', 'g2-ready', box);
      e.style.cssText = 'position:absolute;pointer-events:none;background-repeat:no-repeat;' +
        'image-rendering:' + rend() + ';' +
        'width:' + MW + 'px;height:' + MH + 'px;' +
        /* ★ 캐릭터 스프라이트(zIndex 0·1)보다 **앞**. 집중 이펙트(−1)와 반대쪽입니다. */
        'z-index:10;';
      box._readyEl = e;
    }
    var f = ((m.frame | 0) % 8 + 8) % 8;
    /* ★ 원본 `ETC.ICO` 직독. 예전엔 추출 PNG(`자산/ui/etc/etc_0N.png`)를 썼는데
     *   그 번들은 색 0(검정)을 투명으로 구워 테두리가 뚫립니다(할일 14-c 와 같은 병).
     *   전투.html 이 `G2Native.decodeNC2('ETC.ICO')` 결과를 `R.setEtcIcons()` 로
     *   넘겨 줍니다. 아직 안 왔으면 그 프레임은 안 그립니다. */
    var ic = self._etc && self._etc[f];
    if (!ic) { e.style.display = 'none'; on[m.id] = true; return; }
    if (e._png !== ic.url) {
      e._png = ic.url;
      e.style.backgroundImage = 'url(' + ic.url + ')';
      e.style.width = ic.w + 'px'; e.style.height = ic.h + 'px';
      /* 확대된 PNG의 일부가 잘리지 않게 논리 크기로 맞춘다. 부모 유닛 배율은 그대로. */
      e.style.backgroundSize = ic.w + 'px ' + ic.h + 'px';
    }

    /* ★★★★★ 자리 — 원본 화면에서 잰 값 (2026-09-26 · 사장님 「이상한건 턴마커 위치였어」)
     *   원본 2-3 화면(js-dos)에서 아군 다섯의 그림을 픽셀 일치로 찾아 그리기 기준점을 얻었다 —
     *     미카엘(15,29) 172,98 · 캐빈(14,30) 148,114 · 죠엘(12,30) 100,114 · 신디(16,30) 196,114 · 뮐러(15,31) 172,130 (칸 간격 24·16 정확)
     *   정확히 맞은 마커(ETC.ICO 3 · 일치 1.000)는 156,102 = 미카엘 기준점 + (−16, +4).
     *   원본은 미리 변환한 그림을 그 자리부터 찍는다(0x12273 call 0x10165 — 앵커를 안 더한다).
     *   ☠ 예전: 그림 상자 왼쪽 아래(−5, +2)에 눈대중으로 두었다 — 모션·그림마다 자리가 흔들렸다.
     *   상자 안 좌표에서 그리기 기준점은 (_ox, _oy) 다(유닛상자경계). */
    e.style.left = ((box._ox | 0) - 16) + 'px';
    e.style.top  = ((box._oy | 0) + 4) + 'px';
    /* ★ 원본은 턴마커를 유닛·오브젝트를 다 그린 «뒤»에 찍는다 — 0x454CB 0x12BEE(행 루프) → … → 0x45513 0x12161(마커).
     *   3D 층(preserve-3d)에서는 z-index 가 안 먹어 뒤 행 오브젝트에 가려졌다 — 살짝 띄워 앞에 둔다 */
    e.style.transform = 'translateZ(1px)';
    e.style.display = '';
    on[m.id] = true;
  });

  Object.keys(this.unitEls).forEach(function (k) {
    var b = self.unitEls[k];
    if (b && b._readyEl && !on[k]) b._readyEl.style.display = 'none';
  });
  return this;
};

/**
 * 유닛 위에 덧그리는 상태 그림 — `CHR_EFFC.SYB` (0x126FE).
 *
 * 원본은 유닛을 그리기 목록에 넣을 때 **한 칸을 더 넣습니다.**
 * ```asm
 * 0x126FE  if word[유닛+0x57] != 0                       ; ★ 집중 게이지가 0 이 아니면
 * 0x12709    프레임 = 0x21 + word[0xE4FB8]               ; 30틱마다 (+1)%3 (0x12100)
 * 0x1272E    x = 유닛화면x + 앵커x + sbyte[+0x65]
 * 0x1275D    y = 유닛화면y + 앵커y + sbyte[+0x66]
 * 0x12788    타일값 > 0x64 면 높이표 0x70A58[(타일−0x65)&0xF] 만큼 y 를 내리고
 * 0x127A8    비행([+0x14]&1) 이면 y −= 0x18
 * ```
 *
 * ★★ **유닛 박스의 자식으로 답니다.**
 *   예전엔 별도 레이어(`charLayer`)에 두고 이 요소에도 따로 빌보드 역회전을
 *   걸었습니다. 그런데 회전 중심(`transform-origin`)이 유닛은 **발끝**,
 *   이 요소는 기본값 **가운데** 라서, 기울기를 주면 회전 중심이 달라
 *   집중 불꽃만 유닛에서 떨어져 엉뚱한 자리에 떴습니다.
 *   자식으로 두면 유닛과 **똑같은 변환**을 받아 어떤 각도에서도 붙어 있고,
 *   `z-index:-1` 로 캐릭터 스프라이트가 항상 위에 옵니다.
 *   (원본은 2D 한 장이라 이런 구분이 없습니다 — 우리 2.5D 사정입니다.)
 *
 * @param {{id, png, ax, ay, w, h, fly}[]} list  id = 유닛 id · fly = 비행 여부
 */
Renderer.prototype.charMarks = function (list) {
  var self = this;
  list = list || [];
  var on = {};

  list.forEach(function (m) {
    var box = self.unitEls[m.id];
    if (!box) return;
    var e = box._chargeEl;
    /* 유닛 박스가 다시 만들어졌으면(_ensureUnit) 자식도 사라졌으니 새로 답니다 */
    if (!e || e.parentNode !== box) {
      e = el('div', 'g2-charfx', box);
      e.style.cssText = 'position:absolute;pointer-events:none;background-repeat:no-repeat;' +
                        'image-rendering:' + rend() + ';' +
                        /* ★ 캐릭터 스프라이트(zIndex 0·1)보다 뒤 — 캐릭터가 위에 올라옵니다 */
                        'z-index:-1;';
      box._chargeEl = e;
    }
    e._effcNo = m.frame == null ? null : (m.frame | 0);   // 0x12709 · CHR_EFFC.SYB 프레임 기록
    if (e._png !== m.png) { e._png = m.png; e.style.backgroundImage = 'url(' + m.png + ')'; }
    e.style.width = m.w + 'px'; e.style.height = m.h + 'px';
    /* ☠★★★★★ **N배 그림을 논리 크기로 눌러 담는다** — 스케일러 (2026-09-22 사장님 지적)
     *
     *   > 사장님: 「전투에서 **집중 이펙트도 제대로 표시안되는** 문제가 있어. 스케일러 문제 같아.」
     *
     *   `battle_assets` 가 `frameToCanvas` 로 굽는 `CHR_EFFC` 프레임은 스케일러가 켜지면
     *   **N배 캔버스**다(`m.w`·`m.h` 는 논리 크기 그대로다). `background-size` 를 안 걸면
     *   브라우저가 그림 원래 크기로 그려 **왼쪽 위 1/N** 만 보인다 —
     *   턴 마커(`readyMarks`)·무기 궤적과 **같은 병**이다. */
    e.style.backgroundSize = m.w + 'px ' + m.h + 'px';
    /* 0x12727 · 0x1274D — 원본은 「유닛 화면좌표 + 프레임 앵커 + 유닛 픽셀오프셋」.
     * 박스가 이미 화면좌표와 픽셀오프셋만큼 가 있으므로, 박스 안 좌표는
     * **앵커 + 유닛 기준점** 만 남습니다. (기준점 = 박스 좌상단에서 기준까지) */
    e.style.left = ((m.ax | 0) + (box._ox | 0)) + 'px';
    /* 0x127A8 — 비행 유닛은 0x18 위로 */
    e.style.top = ((m.ay | 0) + (box._oy | 0) - (m.fly ? 0x18 : 0)) + 'px';
    e.style.display = '';
    on[m.id] = true;
    self._표시어둡기(m.id);                         /* 암전 중이면 표시를 한 번만 어둡게 */
  });

  Object.keys(this.unitEls).forEach(function (k) {
    var b = self.unitEls[k];
    if (b && b._chargeEl && !on[k]) b._chargeEl.style.display = 'none';
  });
  return this;
};

/**
 * ★★★★★ **상태이상 아이콘** — `CHR_EFFC.SYB` 9~20 (2026-09-07 · 사장님 지적 M36)
 *
 * > 사장님: 「커스 … **피격대상 저주 효과도 나오지 않아**」
 * >  「스틸엠피 … **피격대상 침묵효과가 적용이 안돼**」
 *
 * ☠ 효과는 걸리고 있었다(실측 — `f1e` 가 `0 → 32`). **표시가 없었을 뿐이다.**
 *
 * 원본 `0x124AA`~`0x124E3` 의 놓는 식 —
 * ```asm
 * 0x124B1  bx = 화면X + [ebp+0x4B87C]   ; 프레임 앵커 X
 * 0x124C0  bx += [edx+0x65]             ; ★ 유닛 픽셀 오프셋 X (피격 밀림)
 * 0x124E3  … + [ebp+0x4B87E] + [edx+0x66]
 * ```
 * 우리는 그 오프셋이 **이미 유닛 박스에 걸려** 있으므로 박스 안에서는
 * **앵커 + 기준점**만 남는다 — `charMarks` 와 똑같은 셈이다.
 *
 * ★ `charMarks`(집중)와 **다른 요소**를 쓴다 — 둘이 함께 뜰 수 있기 때문이다.
 * ★ 한 유닛에 상태가 여럿이면 **여럿 뜬다**(원본 `0x124D8` 이 9바이트씩 쌓는다).
 *   같은 자리에 겹치지 않게 **하나마다 가로로 밀어** 놓는다 — 폭 + 1px.
 *   ☐ 원본이 여럿일 때 어떻게 늘어놓는지는 아직 못 읽었다.
 *
 * @param {Array} list `{ id, 이름, fly, png, ax, ay, w, h }`
 */
Renderer.prototype.ailMarks = function (list) {
  var self = this;
  list = list || [];
  var on = {}, 몇 = {};

  list.forEach(function (m) {
    var box = self.unitEls[m.id];
    if (!box) return;
    if (!box._ailEls) box._ailEls = {};
    var i = (몇[m.id] | 0); 몇[m.id] = i + 1;
    var key = '' + i;
    var e = box._ailEls[key];
    /* 유닛 박스가 다시 만들어졌으면(_ensureUnit) 자식도 사라졌으니 새로 단다 */
    if (!e || e.parentNode !== box) {
      e = el('div', 'g2-ailfx', box);
      e.style.cssText = 'position:absolute;pointer-events:none;background-repeat:no-repeat;' +
                        'image-rendering:' + rend() + ';' +
                        /* ★ 상태 표시는 캐릭터 **위**다 — 몸에 붙는 것이라 가리면 안 보인다 */
                        'z-index:2;';
      box._ailEls[key] = e;
    }
    if (e._png !== m.png) { e._png = m.png; e.style.backgroundImage = 'url(' + m.png + ')'; }
    e.style.width = m.w + 'px'; e.style.height = m.h + 'px';
    /* ★ 집중 이펙트와 같은 자리 — N배 그림을 논리 크기로 눌러 담는다 (2026-09-22) */
    e.style.backgroundSize = m.w + 'px ' + m.h + 'px';
    /* ★★★★★ **원본이 더하는 항은 둘뿐이다** (2026-09-07 · 오래 미확인이던 자리를 닫았다)
     *
     *   ```asm
     *   0x124AA  imul ebp, ebp, 0xC          ; 프레임 메타 **12바이트 레코드**
     *   0x124B1  bx = 화면X + [ebp+0xBB87C]  ; ★ 프레임 자체의 X 오프셋
     *   0x124C0  bx += [edx+0x65]            ; ★ 유닛 픽셀 오프셋 X
     *   0x124E3  … + [ebp+0xBB87E] + [edx+0x66]  ;  Y 도 같은 식
     *   ```
     *   `0x124AD`~`0x124D8` 을 훑었는데 **인덱스로 미는 항이 없다.**
     *   ☠ 그래서 `i × (폭+1)` 을 뺀다 — 원본에 없던 항이다.
     *
     *   ★ `[0xBB87C]`·`[0xBB87E]` 는 **`CHR_EFFC.SYB` 블록 머리의 앵커**다
     *     (`상태이상_원본확정.md` §6-4 — 「`ax`/`ay` 가 12바이트 레코드의 앞 두 워드」).
     *     표는 `0x11C6B mov edx, 0xBB878` · `0x11C70 "chr_effc.syb"` · `0x11C77 call 0x4F25F`
     *     가 **36칸**을 채운다. 파일에서 검산했다 —
     *     프레임 9·10·11(침묵 3장 애니) `w=10 h=8 ax=-14 ay=-9`
     *     ⇒ 우리 `m.ax`·`m.ay`(= `decodeSYB` 의 `sf.ax`·`sf.ay`)가 **같은 수**다.
     *
     *   ★ 「여럿이면 겹치지 않나」 — 상태마다 아이콘은 **하나**다.
     *     9·10·11 이 침묵 한 개의 3장 애니이고 12·13·14 혼란 · 15·16·17 저주 ·
     *     18·19·20 중독이다. 서로 다른 상태는 파일이 준 제 앵커로 갈린다.
     *   ☐ 상태 둘이 실제로 안 겹치는지는 **아직 화면으로 안 봤다.** */
    e.style.left = ((m.ax | 0) + (box._ox | 0)) + 'px';
    /* 0x127A8 과 같은 비행 보정 */
    e.style.top = ((m.ay | 0) + (box._oy | 0) - (m.fly ? 0x18 : 0)) + 'px';
    e.style.display = '';
    on[m.id + '/' + key] = true;
    self._표시어둡기(m.id);                         /* 암전 중이면 표시를 한 번만 어둡게 */
  });

  Object.keys(this.unitEls).forEach(function (k) {
    var b = self.unitEls[k];
    if (!b || !b._ailEls) return;
    Object.keys(b._ailEls).forEach(function (kk) {
      if (!on[k + '/' + kk]) b._ailEls[kk].style.display = 'none';
    });
  });
  return this;
};

/**
 * 원본 `MOVE.CUR` 직독 화살표 8장 (할일 19).
 * 첨자는 `[0xE5A90 + 방향*8 + 변형*4]` → **방향×2 + 변형**
 * (0·1 남 · 2·3 서 · 4·5 북 · 6·7 동). 변형은 30틱 단순 토글.
 *
 * 추출본은 색 0(검정 테두리)을 투명으로 구워 **8/8 프레임 288픽셀**이 뚫려 있었다.
 * @param {string[]} urls 8장의 data-URL
 */
Renderer.prototype.setMoveCursors = function (urls) {
  if (urls && urls.length === 8) {
    this.MOVECUR = urls;
    root.__G2_CURSORS = root.__G2_CURSORS || {};
    root.__G2_CURSORS.move = urls;            /* ★ 재생성 대비 보관 */
  }
  return this;
};

/* 이동 목적지 방향 확정 UI — 목적지 위 네모와 네 방향 화살표. */
Renderer.prototype.facingGuide = function (draft) {
  if (!this.facingLayer) {
    this.facingLayer = el('div', 'g2-facing-layer', this._오버레이층확보());
    this.facingLayer.style.cssText =
      'position:absolute;transform-style:preserve-3d;pointer-events:none;';
    this.facingBoxEl = el('div', 'g2-facing-box', this.facingLayer);
    this.facingBoxEl.style.cssText =
      'position:absolute;width:26px;height:18px;box-sizing:border-box;' +
      'transform-origin:50% 100%;';
    /* MOVE.CUR 0·2·4·6 = 남·서·북·동. 화살표는 하나만 그린다. */
    this.facingArrowEl = el('span', '', this.facingBoxEl);
    this.facingArrowEl.style.cssText =
      'position:absolute;width:17px;height:17px;image-rendering:pixelated;' +
      'background-position:center;background-size:17px 17px;background-repeat:no-repeat;';
  }
  var b = this.facingBoxEl;
  if (!draft) { b.style.display = 'none'; return this; }
  b.style.display = '';
  var a = this.facingArrowEl, d = draft.facing & 3;
  var p = draft.pointer || { x: 0, y: 0 };
  var clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };
  var px = p.x | 0, py = p.y | 0, M = 9;   // M = 박스 밖 여유(정사각 영역)
  /* ★ 화살표는 **박스+여유(M) 영역 안에서 커서를 자유롭게 따라간다**(박스 내부 포함).
   *   변에 슬라이딩하지 않아 조절이 답답하지 않다. 모양(frame)만 방향(d)에 따라 바뀐다. */
  var cxp = clamp(13 + px, -M, 26 + M), cyp = clamp(9 + py, -M, 18 + M);  // 박스 26×18, 중심 13,9
  /* ★ `−8` = 화살표 그림의 절반이다. **원본 `MOVE.CUR` 을 실제로 디코드해 쟀다**
   *   (2026-09-08 · 브라우저에서 `R.MOVECUR` 8장의 PNG IHDR 직독) — **8장 전부 17×17**.
   *   `17 >> 1 = 8`. 커서 자리에 그림 한가운데를 놓는다.
   *   ☠ 문서의 「화살표 54×17」과 **섞지 않는다** — 그것은 **전황도** 화살표다
   *     (`00_원본대조_재발방지.md` R98 에서 한 번 헛짚은 자리). */
  var left = Math.round(cxp) - 8, top = Math.round(cyp) - 8;              // MOVE.CUR 17×17 의 절반
  var frame = [0, 2, 4, 6][d & 3];                                       // 남·서·북·동
  a.style.left = left + 'px'; a.style.top = top + 'px';
  /* 그림은 원본 `MOVE.CUR` 직독뿐입니다 (할일 19-b) — 아직 안 왔으면 안 그립니다.
   * 눕히기(아래 `_ground`/`transform`)는 그대로입니다 — 화살표는 지면 평면에 눕습니다. */
  var url = this.MOVECUR && this.MOVECUR[frame];
  a.style.display = url ? '' : 'none';
  /* ★ 2026-09-24 (Z-40 「스케일러 관련 모든 요소」) 화살표도 필터를 탄다.
   *   `sheet()` 는 N배 그림을 굽는 동안 1배 URL 을 주고, 다 구우면 알린다.
   *   크기는 위 `background-size:17px 17px` 가 논리로 눌러 담는다. */
  if (url && root.G2Scaler && root.G2Scaler.sheet) {
    var 원 = url;
    url = root.G2Scaler.sheet(원, function () {
      if (a.dataset.원 === 원) a.style.backgroundImage = 'url(' + root.G2Scaler.sheet(원) + ')';
    });
    a.dataset.원 = 원;
    a.style.imageRendering = rend();
  }
  if (url) a.style.backgroundImage = 'url(' + url + ')';
  /* ★ 이동 목적지 UI(네모+화살표)는 **바닥에 눕힌다** — 지면 평면 그대로(원근 따라감). */
  b._ground = null;                                       // apply()의 _빌보드적용 스킵 → 눕힘 유지
  b.style.transformOrigin = '50% 50%';
  /* ☐ `−1` 은 네모 **테두리 폭**이다 — 다만 이것은 **코드 문맥으로 읽은 것**이고
   *   원본(`0xE5A90` 계열)에서 확인한 값이 아니다. 확인되면 주소를 단다.
   *   `− mapW/2`·`− mapH/2` 는 우리 박스 좌표계로 옮기는 것이라 원본과 무관하다. */
  b.style.left = (draft.x * TW - 1 - this.mapW / 2) + 'px';   /* ☐ −1 = 테두리 폭 (원본 미검증) */
  b.style.top = (draft.y * TH - 1 - this.mapH / 2) + 'px';    /* ☐ 같음 */
  b.style.transform = 'none';
  return this;
};

/* ── 선택 상자 (캐릭터 테두리) ────────────────────────────────────────
 *
 * 원본은 **바닥 타일을 칠하지 않습니다.** 커서 밑 유닛 둘레에 상자를 그립니다.
 *
 * ```
 * 0x49FE1(칸x, 칸y)   커서 밑 유닛 갱신.  유닛이 바뀌면 상자 크기를 다시 잽니다
 *     entry = 0xD66A8 + 슬롯*572 + 방향*143 + 모션*13     ; 스프라이트 표
 *     w0 = byte[entry+2]   h0 = byte[entry+3]             ; 그 프레임의 칸 크기
 *     ax = sbyte[entry+4]  ay = sbyte[entry+5]            ; 기준점 → 좌상단
 *     if (w0 < 24) { 폭 = 24; ox = ax + 12 - (24-w0)/2 } else { 폭 = w0; ox = ax + 12 }
 *     if (h0 < 24) { 높 = 24; oy = ay -  2 - (24-h0)/2 } else { 높 = h0; oy = ay -  2 }
 * 0x4A106            화면 사각형
 *     left = 칸x*24 + ox      top = 칸y*16 + oy
 *     x2 = left + 폭          y2 = top + 높
 *     x1 = left - 1           y1 = top - 1
 *     x1>=16 · y1>=4 · x2<=304 · y2<=195 로 클램프 (맵 뷰포트)
 * 0x49CB1(x1,y1,x2,y2)  실제로 그리는 곳
 *     0x5ECF2 로 1픽셀 테두리 사각형.  색은 [0x75024] 이고 그릴 때마다
 *     9 → 10 → 11 → 9 로 한 칸씩 돕니다 (= 깜빡입니다)
 *     네 귀퉁이에 MAIN.CUR 4~7 (8×7) 을 [0xFB070..7C] 에서 꺼내 덮습니다
 *        좌상 (x1-1, y1-1) · 우상 (x2-6, y1-1) · 좌하 (x1-1, y2-5) · 우하 (x2-6, y2-5)
 * ```
 * `04_도구/g2_export_battle.py` 가 뽑은 `sprites.json` 의 `프레임[]` 에
 * `w · h · ax · ay` 가 그대로 있으므로 위 계산을 그대로 씁니다.
 * **대형 유닛은 프레임 칸이 크므로 상자도 저절로 커집니다.**
 * -------------------------------------------------------------------- */
/** 선택 상자 테두리 색 — 팔레트에서 꺼낸다(전투 날씨가 걸린 값). 팔레트가 없으면 박힌 값. */
function 선택상자색(S, i) {
  var H = root.G2Hud;
  if (H && H.color) { try { return H.color(S.colorIdx[i]); } catch (e) {} }
  return S.colors[i];
}

Renderer.prototype.SELBOX = {
  /* MAIN.CUR 4~7 — 적재기 0x49B16 이 0xFB070[0..3] 에 넣고 0x49CB1 이 이 순서로 씁니다 */
  corner: ['ui/main_cur/main_cur_04.png',    // 좌상 [0xFB070]
           'ui/main_cur/main_cur_05.png',    // 우상 [0xFB074]
           'ui/main_cur/main_cur_06.png',    // 좌하 [0xFB078]
           'ui/main_cur/main_cur_07.png'],   // 우하 [0xFB07C]
  cw: 8, ch: 7,
  /* 팔레트 9·10·11 — 0x49D3D 가 이 셋을 돌립니다.
   * ☠★★★★★ **2026-09-10 — 색을 코드에 박아 두면 안 된다.** 전에는
   *   `['rgb(194,218,194)', …]` 로 박혀 있었는데 두 가지가 틀렸다 —
   *     ① 6→8비트 환산이 원본(`(v<<2)|(v>>4)`)과 **1씩 어긋났다** (194 vs **195**)
   *     ② 전투 **날씨 보정**(`0x1077A`)을 안 탄다 — 비·눈·모래바람·안개 27개 시나리오
   *   ⇒ 번호만 두고 색은 `선택상자색()` 이 팔레트에서 그때그때 꺼낸다. */
  colorIdx: [9, 10, 11],
  colors: ['rgb(195,219,195)', 'rgb(158,182,158)', 'rgb(117,142,117)'],   /* 팔레트가 없을 때만 */
  /* 원본은 상자를 다시 그릴 때마다 한 칸 돕니다. 메인 루프 0x5589F 의 주기가 15틱 */
  blinkMs: 15 / 175.47 * 1000
};

/** 이 유닛의 지금 프레임 메타 (w·h·ax·ay). 없으면 null. */
Renderer.prototype.frameMeta = function (u) {
  var m = this.spriteMeta(u);
  if (!m) return null;
  var rows = m['행'] || 4, cols = m['열'] || m['방향당프레임'] || 11;
  var dir = ((u.dir | 0) % rows + rows) % rows;
  var mo = Math.min(Math.max(u.motion | 0, 0), cols - 1);
  var fr = m['프레임'] && m['프레임'][dir * cols + mo];
  if (fr && fr.w != null) return fr;
  /* 프레임 표가 없으면 시트 칸 크기와 기준점으로 대신합니다 */
  return { w: m['칸'][0], h: m['칸'][1],
           ax: -m['기준점'][0], ay: -m['기준점'][1] };
};

/**
 * 상자의 맵 픽셀 사각형.
 * @param {object} t  유닛(`x·y·dir·motion`) 또는 `{x, y}` 칸 하나
 * @returns {{x1,y1,x2,y2,w,h}|null}
 */
Renderer.prototype.boxRect = function (t) {
  if (!t) return null;
  var ox, oy, w, h;
  /* ★★★★★ **칸 단위 발자국 상자** — 배치 방향 선택용 (2026-08-25 · 사용자 지적)
   *
   *   사용자: 「타일 박스가 **탑승물 발자국 크기**에 맞게 커져야 해. 방향을 전환하면
   *   탑승물 발자국에 따라 **타일 모양(방향)도 함께 변화**해야 해.」
   *   그리고: 「늘어난 박스도 **바닥에 눕혀져야** 기울인 화면에서 어긋나지 않아.」
   *
   *   원본 `0x163A4 call 0x49E4E(eax = 유닛)` 은 **스프라이트 픽셀 크기**로 상자를 잡는다
   *   (`0x49E9B` 갈래가 `0x666A8` 표를 읽는다). 원본은 2D 평면이라 그게 곧 바닥이지만,
   *   우리는 기울인 2.5D 라 **픽셀 상자를 세우면 바닥 격자와 어긋난다** —
   *   CLAUDE.md 「최종 접지 좌표는 실행기 기준으로 맞춘다」에 해당한다.
   *   ⇒ 발자국을 **칸 수**로 받아 `24 × 16` 격자에 맞춘 사각형을 만들고, `onUnit` 을
   *     안 태워 **눕힌 채로** 둔다(빈 칸 이동 타일과 같은 길).
   *   ★ `cellsOf()` 는 `y - j` 로 **위쪽**으로 늘어나므로 상자도 위로 키운다. */
  if (t.발자국) {
    var _fw = Math.max(1, t.발자국[0] | 0), _fh = Math.max(1, t.발자국[1] | 0);
    var _m0 = this.mapOf(t);
    var _l = _m0.x, _t0 = _m0.y - TH * (_fh - 1);
    var _w = TW * _fw, _h = TH * _fh;
    return { x1: _l - 1, y1: _t0 - 1, x2: _l + _w, y2: _t0 + _h, w: _w + 2, h: _h + 2 };
  }
  /* ★ 상자 크기는 **그 방향의 모션 0 프레임**으로 잰다 — 지금 모션이 아니다 (2026-09-26 · Z-69 ③)
   *   0x4A011 [+0x60] 슬롯 ×572 · 0x4A02E [+0x63] 방향 ×143 → 0xD66A8 표 · 0x4A043 +2 폭 · 0x4A04E +3 높이
   *   모션([+0x64]) 항이 없다 — 11프레임×13바이트 한 방향 묶음의 첫 칸(모션 0)을 읽는다.
   *   ☠ 전에는 지금 모션으로 재서 공격 자세면 상자가 그 폭으로 바뀌었다 (사장님 「선택박스 크기도 원본이랑 달라」) */
  var f = (t.sprIndex != null || t.id != null)
    ? this.frameMeta(t.motion ? Object.assign({}, t, { motion: 0 }) : t) : null;
  if (f) {
    var w0 = f.w | 0, h0 = f.h | 0;
    if (w0 < 24) { w = 24; ox = (f.ax | 0) + 12 - ((24 - w0) >> 1); }
    else         { w = w0; ox = (f.ax | 0) + 12; }
    if (h0 < 24) { h = 24; oy = (f.ay | 0) -  2 - ((24 - h0) >> 1); }
    else         { h = h0; oy = (f.ay | 0) -  2; }
  } else {
    /* 유닛이 없는 칸 — 0x49E4E 의 dl=5 (24×16 한 칸) + 0x49EEE 가 만드는 사각형과 같습니다 */
    w = TW; h = TH; ox = 0; oy = 0;
  }
  /* 좌표 창구 `mapOf` (= `0x10971`·`0x10988` 에서 카메라·뷰포트를 뺀 것).
   * `world` 안이므로 카메라 변환은 CSS 가 한다. */
  var m = this.mapOf(t);
  var left = m.x + ox, top = m.y + oy;
  return { x1: left - 1, y1: top - 1, x2: left + w, y2: top + h,
           w: w + 2, h: h + 2 };
};

/** 오버레이 레이어 — 월드 뒤(위에 합성)에 두고 apply()가 월드와 같은 변환을 준다.
 *  선택박스·방향화살표를 여기 담으면 캐릭터에 안 가리고, 지면 원근은 그대로 유지된다. */
Renderer.prototype._오버레이층확보 = function () {
  if (this.overlayLayer) return this.overlayLayer;
  var o = el('div', 'g2-overlay', this.host);          // world 다음에 추가 → 위에 합성
  o.style.cssText = 'position:absolute;left:50%;top:50%;transform-style:preserve-3d;pointer-events:none;';
  this.overlayLayer = o; this.apply();
  return o;
};
/**
 * ★★ 마법·필살기 이펙트 레이어 — **월드보다 위**에 합성한다.
 *
 * `fxLayer` 는 `world` 안이라 `preserve-3d` 공간의 z 순서로 정렬된다. 그래서
 * 평면일 때는 멀쩡하다가 **기울이면 이펙트가 캐릭터 뒤로 들어간다**
 * (사용자 지적 2026-08-15). 마법은 항상 캐릭터 위에 보여야 한다.
 *
 * `overlayLayer`(선택박스)와 같은 수법이다 — 월드 **다음에** 붙여 위에 합성하되,
 * `apply()` 가 월드와 **똑같은 변환**을 준다. 그래서 확대·기울기·원근은 그대로
 * 따라가면서 z 정렬만 분리된다.
 *
 * 선택박스(`overlayLayer`)보다도 뒤에 붙여 마법이 제일 위에 오게 한다.
 */
Renderer.prototype._연출위층확보 = function () {
  if (this.fxTopLayer) return this.fxTopLayer;
  this._오버레이층확보();                               // 순서: world → overlay → fxTop
  var o = el('div', 'g2-fxtop', this.host);
  o.style.cssText = 'position:absolute;left:50%;top:50%;' +
                    'transform-style:preserve-3d;pointer-events:none;';
  this.fxTopLayer = o; this.apply();
  return o;
};
/* 초필살기에서 마지막에 다시 그린 유닛을 3D 효과 조각보다 앞에 합성한다.
 * 위층과 카메라 변환은 같고, 기울기 때 필요한 호출에서만 늦게 만든다. */
Renderer.prototype._연출최상층확보 = function () {
  if (this.fxTopFrontLayer) return this.fxTopFrontLayer;
  this._연출위층확보();
  var o = el('div', 'g2-fxfront', this.host);
  o.style.cssText = 'position:absolute;left:50%;top:50%;' +
                    'transform-style:flat;pointer-events:none;';
  this.fxTopFrontLayer = o; this.apply();
  return o;
};
/**
 * ★★★ [리마스터] **화면 전역 연출용 평면 레이어** — `world` 변환을 **안 받는다**.
 *
 * `CLAUDE.md` 는 「모든 이펙트는 `world` 레이어에 세워서」라고 못 박았는데, 그건
 * **칸·유닛에 붙는 연출** 이야기다. 화염6 파티클·화염7 메테오/프로미넌스처럼
 * 원본이 **화면 좌표(0~319 × 0~199)에 직접 뿌리는** 연출은 성격이 다르다:
 *
 * - 원본은 2D 화면 버퍼에 그린다. 기울기·원근이 애초에 없다.
 * - `world` 에 얹으면 tilt(20°)·원근 때문에 화면 위아래로 갈수록 폭이 달라져
 *   **오른쪽 끝에 붙어야 할 불기둥이 화면 밖으로 벗어난다**
 *   (사용자 지적 2026-08-15 「오른쪽이 벗어난 느낌이야」).
 * - 배율(`cam.zoom`)을 바꾸면 어긋남의 크기도 같이 변한다 —
 *   「배율 달라졌을 때」 문제의 뿌리가 이것이다.
 *
 * 그래서 이 레이어는 **뷰포트에 딱 맞춘 평면**이고, 원본 320×200 좌표를
 * `화면배율()` 하나로 곧장 뷰포트 픽셀에 옮긴다. 배율을 어떻게 바꿔도
 * 연출은 **언제나 화면을 정확히 채운다.**
 */
/**
 * ★★★ [원본] **화면 전체를 한 색으로 물들인다** — 팔레트 페이드 `0x562C1` (2026-08-16)
 *
 * 사용자 지적: 「6단계는 … **화면이 붉게 번쩍이는 효과**가 빠졌고, 7단계도 **화면
 * 전체에 붉게 깜빡이는 효과**가 빠졌고」 · 「프로미넌스에도 있어 … **붉은 빛이
 * 깜빡거린다**」
 *
 * ── 원본 (`00_이어가기.md` §A · `연출_화면전역_공통.md`) ────────────────
 * ```
 * 0x5623E  mov [0xA233C], ax        ; 색 인덱스  화염 0x14(20) · 빙한 0x29(41)
 * 0x562C1  [0x550C] 를 3씩 올리며 0x56245 호출, ax==1 이 될 때까지 (상한 0x4B = 75)
 * 0x56245  팔레트 버퍼 256칸을 **그 색 하나**로 채우고
 *          0x5FC21 로 (단색 − 현재팔레트) = 델타 를 만든다
 * ```
 * 원본은 8비트 인덱스 화면이라 **팔레트만 바꿔** 전체 색을 돌린다. 우리는 트루컬러
 * 캔버스라 같은 그림을 만들려면 **화면 전체에 그 색을 알파로 덮는** 것이 등가다.
 *
 * ★ `world` **밖 평면**이다 — 기울기·확대를 안 받아야 원본처럼 화면을 꽉 덮는다
 *   (`fxScreenLayer` 와 같은 성질). HUD 프레임보다는 아래에 둔다.
 *
 * @param {Array<number>|null} rgb `[r,g,b]`. `null` 이면 끈다.
 * @param {number} a 0~1
 */
/**
 * ★★★★★ **화면을 반대각선으로 갈라 벌린다** — 아수라파천무 끝 `0x310DE` (2026-09-26 사장님 「마지막 화면 대각선을 줄 가고
 *   슬라이드되면서 잘리는 듯한 이펙트 … 적용되지 않아」)
 *
 * 원본: 화면 320×200 을 떠 두고(0x31100~0x3113C) 장마다 화면을 0 으로 지운 뒤(0x31177)
 *   · 윗왼쪽 조각 — 줄 y 의 앞 (200−y)×8/5 칸을 오른쪽으로 k · 위로 s 옮겨 찍는다 (0x31182~0x311DE)
 *   · 아랫오른쪽 조각 — 줄 y 의 뒤 y×8/5 칸을 왼쪽으로 k · 아래로 s 옮겨 찍는다 (0x311E4~0x31251)
 *   곧 오른쪽 위(320,0) ↔ 왼쪽 아래(0,200) 선으로 가른다. k = 0,8,…,48 · s = (k/8)×5 (0x3125C · 0x31269 cmp 0x32).
 * 우리: 화면(#view)을 한 벌 떠서(캔버스는 픽셀까지) 둘에 반씩 clip-path 를 걸고 반대로 옮긴다. 틈은 검정(원본 0 칠).
 *   선·이동량은 원본 논리 좌표 × 화면배율 — 창이 원본보다 넓으면 선이 그대로 이어진다(암전과 같은 뜻).
 * @param {number|null} k 가로 이동(논리 px) · null 이면 걷는다
 * @param {number} sy 세로 이동(논리 px)
 */
Renderer.prototype.화면대각가르기 = function (k, sy) {
  var host = this.host, 부모 = host && host.parentNode, g = this._대각;
  if (k == null) {
    if (g) {
      if (g.판 && g.판.parentNode) g.판.parentNode.removeChild(g.판);
      if (g.뒤 && g.뒤.parentNode) g.뒤.parentNode.removeChild(g.뒤);
      host.style.clipPath = g.옛clip || ''; host.style.translate = g.옛translate || '';
      this._대각 = null;
    }
    return this;
  }
  if (!host || !부모) return this;
  if (!g) {
    g = this._대각 = { 옛clip: host.style.clipPath, 옛translate: host.style.translate };
    /* 틈 — 원본은 화면을 0 으로 지운다(0x31177) */
    g.뒤 = document.createElement('div');
    g.뒤.style.cssText = 'position:absolute;inset:0;background:#000;pointer-events:none;';
    부모.insertBefore(g.뒤, host);
    /* 떠 둔 화면 — 캔버스는 cloneNode 가 픽셀을 안 옮기므로 따로 옮긴다 */
    var 판 = host.cloneNode(true);
    판.removeAttribute('id');
    판.style.cssText = host.style.cssText + ';position:absolute;inset:0;pointer-events:none;';
    var 원캔 = host.querySelectorAll('canvas'), 새캔 = 판.querySelectorAll('canvas');
    for (var i = 0; i < 원캔.length && i < 새캔.length; i++) {
      try { var c2 = 새캔[i].getContext('2d'); if (c2 && 원캔[i].width && 원캔[i].height) c2.drawImage(원캔[i], 0, 0); } catch (e캔) {}
    }
    부모.insertBefore(판, host.nextSibling);
    g.판 = 판;
  }
  var 배 = this.화면배율 ? this.화면배율() : { s: 1, ox: 0, oy: 0 };
  var S = 배.s || 1, ox = 배.ox || 0, oy = 배.oy || 0;
  /* 선 (320,0) → (0,200) 를 화면 px 로 · 멀리 늘인다 */
  var P1 = [ox + 320 * S, oy], P2 = [ox, oy + 200 * S], d = [P2[0] - P1[0], P2[1] - P1[1]];
  var A = [P1[0] - d[0] * 20, P1[1] - d[1] * 20], B = [P2[0] + d[0] * 20, P2[1] + d[1] * 20];
  var n = [-200 * S * 40, -320 * S * 40];                       /* 윗왼쪽을 가리키는 법선 */
  function 점(q) { return Math.round(q[0]) + 'px ' + Math.round(q[1]) + 'px'; }
  host.style.clipPath = 'polygon(' + [A, B, [B[0] + n[0], B[1] + n[1]], [A[0] + n[0], A[1] + n[1]]].map(점).join(',') + ')';
  g.판.style.clipPath = 'polygon(' + [A, B, [B[0] - n[0], B[1] - n[1]], [A[0] - n[0], A[1] - n[1]]].map(점).join(',') + ')';
  host.style.translate = ((k | 0) * S) + 'px ' + (-(sy | 0) * S) + 'px';     /* 윗왼쪽 — 오른쪽 위로 */
  g.판.style.translate = (-(k | 0) * S) + 'px ' + ((sy | 0) * S) + 'px';     /* 아랫오른쪽 — 왼쪽 아래로 */
  return this;
};

/** [리마스터] 화면을 «세로»로 가르는 틈선 — 폭풍검 수직 낙하 (2026-10-12)
 *   사장님(원문) 「떨어질때 잘려서 슬라이드되는게 대각선이 아니라 수직으로 적용 가능할까?」 · 고르심 「수직으로 바꾼다」
 *   2026-10-12 사장님 「잘릴때 시전자도 잘리는 문제가 있어. 세로로 가르되 위아래로 어긋나게 하지 말고」 · 고르심 「움직이지 않음」
 *   ⇒ 화면을 떠서 반쪽을 밀던 것(오른쪽 반이 멈춘 그림이라 선 위의 시전자가 갈렸다)을 걷고, 논리 x = 선x 에 검은 세로 틈만 긋는다.
 *     틈은 연출 위층(g2-fxtop) «앞»에 끼워 넣어 위층에 다시 그린 시전자가 틈을 덮는다(ultimate 폭풍검 화면가르기).
 *   k 는 켬 표시(값은 안 씀) · null 이면 걷는다 */
Renderer.prototype.화면세로가르기 = function (k, 선x) {
  var host = this.host;
  if (k == null) {
    if (this._세로틈 && this._세로틈.parentNode) this._세로틈.parentNode.removeChild(this._세로틈);
    this._세로틈 = null;
    return this;
  }
  if (!host) return this;
  var 위 = this._연출위층확보 ? this._연출위층확보() : null;
  var e = this._세로틈;
  if (!e) {
    e = this._세로틈 = document.createElement('div');
    e.className = 'g2-storm-split';
    e.style.cssText = 'position:absolute;top:0;height:100%;background:#000;pointer-events:none;';
    if (위 && 위.parentNode === host) host.insertBefore(e, 위); else host.appendChild(e);
  }
  var 배 = this.화면배율 ? this.화면배율() : { s: 1, ox: 0, oy: 0 };
  var S = 배.s || 1, ox = 배.ox || 0;
  var 폭 = Math.max(1, Math.round(2 * S));
  e.style.left = (Math.round(ox + (선x == null ? 160 : +선x) * S) - (폭 >> 1)) + 'px';
  e.style.width = 폭 + 'px';
  return this;
};

Renderer.prototype.화면색 = function (rgb, a) {
  var o = this._tintEl;
  if (!o) {
    o = this._tintEl = el('div', 'g2-tint', this.host);
    /* ★★★ **모든 이펙트보다 위** (2026-08-16 사용자 지적)
     *
     *   「프로미넌스 **페이드 레이어 순서도 잘못**되었어. 원작은 **모든 불 이펙트보다
     *   페이드가 더 위**에 있어.」
     *
     *   원본은 **팔레트를 통째로 바꾸는** 것이라 화면에 이미 그려진 **모든 픽셀**이
     *   물든다 — 불이든 캐릭터든 예외가 없다. 우리는 오버레이로 흉내 내므로
     *   **맨 위에 얹어야** 같은 그림이 된다.
     *   `fxScreenLayer`(연출)와 같은 `host` 자식이라 **DOM 순서**로 갈리는데,
     *   `play()` 가 페이드를 먼저 켜면 `_tintEl` 이 먼저 생겨 **연출이 위**가 됐다.
     *   → `z-index` 를 주고, 켤 때마다 **맨 뒤로 다시 붙인다.** */
    o.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
                      'pointer-events:none;display:none;z-index:60;';
  }
  if (!rgb || !(a > 0)) { o.style.display = 'none'; return this; }
  /* 켤 때마다 맨 뒤(= 맨 위)로 — 연출 레이어가 나중에 생겨도 가려지지 않는다 */
  if (o.parentNode === this.host && this.host.lastChild !== o) this.host.appendChild(o);
  o.style.display = 'block';
  o.style.background = 'rgb(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ')';
  o.style.opacity = Math.max(0, Math.min(1, a));
  return this;
};

/**
 * ★★★★★ **연출 물들임 — 이펙트 「아래」 층** (2026-09-04)
 *
 * 사용자 지적: 「벼락은 잘 나와. 그런데 아직 **이펙트 부족한 느낌**이야.」
 *
 * 원본 `0x30824` 는 팔레트 **96 ~ 255 만** 그 색으로 덮는다 —
 * ```asm
 * 0x30842  eax = 0x60(96)  ┐
 * 0x30860  movsw ; movsb    │ 96 ~ 255 만
 * 0x30863  cmp ax, 0x100   ┘   (0 ~ 95 는 **안 건드린다**)
 * ```
 * 그리고 THUN72.NSP 벼락 프레임의 색 인덱스를 전수로 세니 **전부 0~95** 였다
 * (프레임 0·3·6·9 에서 `96~255` 가 **0 개**, 상위색 40~45).
 * ⇒ **원본에서 벼락은 물들임에 안 걸린다.** 그래서 어두운 화면 위에 밝게 남는다.
 *
 * 우리 `_tintEl` 은 `z-index: 60` 으로 연출(`g2-fxscreen`) **위**에 있어서
 * 벼락까지 덮었다 — 그것이 「이펙트가 부족한 느낌」의 정체였다.
 *
 * ★ 팔레트 페이드(`0x562C1` · 프로미넌스)는 **팔레트 전체**를 바꾸므로 지금대로
 *   위에 둔다. 둘은 **다른 함수**다 — 한 레이어로 묶으면 안 된다.
 *
 * @param rgb 색 · a 알파 (0 이면 끈다)
 */
/**
 * ★★★★★ **붉기 필터** — 원본이 팔레트의 **R 성분만** 올리는 연출용 (2026-09-06)
 *
 *   메테오 `0x21E16` 은 화면을 붉게 물들이는데, 그 방식이 **한 색으로 덮는 것이
 *   아니다** —
 *   ```asm
 *   0x21E8C  call 0x5F945          ; 팔레트를 뜬다 (루프 밖에서 한 번)
 *   0x21EC0  lea ebx, [ebx+ebx*2]  ; ★ i×3 → **R 성분만**
 *   0x21EC6  cmp dl, 0x3E          ;   R >= 62 ?
 *   0x21ECB  inc cl                ; ★ R < 62 면  **R + 1**
 *   0x21ED6  sub dh, 0xA           ; ★ R >= 62 면 **R − 10**
 *   0x21EEC  call 0x5F9AE          ;   DAC 에 쓴다  (틱 5마다 · 0x21E7B)
 *   0x22119  mov ebx,0xB824C · call 0x5F9AE   ; 끝나면 되돌린다
 *   ```
 *   ⇒ **색마다 자기 R 에서 출발**한다. R 이 높은 색(흙)은 금세 62 에 닿아
 *     `−10` 으로 내려갔다 다시 오르고, R 이 낮은 색은 천천히 오른다.
 *
 *   ☠ **화면 오버레이로는 안 된다** (2026-09-06 해 보고 되돌렸다) —
 *     붉은 막을 씌우면 **모든 색에 같은 값**이 더해져 화면이 통째로 새빨개진다.
 *
 *   ★ `feComponentTransfer` 의 `feFuncR type="table"` 은 **입력 R 값마다 출력 R**
 *     을 지정한다. 64칸(6비트)을 「그 규칙을 N 번 적용한 값」으로 채우면
 *     원본과 같은 그림이 나온다. 화면으로 확인했다(`05_결과/굽기/svg대조/00_모아.png`).
 *
 *   ★ 원본도 **UI 까지 붉어진다** — 원본 캡처 실측:
 *     연출 전 `R138 G117 B102` → 연출 중 `R232 G97 B92` (R 만 크게 오른다).
 *     그래서 화면 캔버스 전체에 건다.
 *
 * @param {number|null} n  몇 번 적용했나. `null` 이면 필터를 뗀다(`0x22119`).
 */
Renderer.prototype.붉기필터 = function (n) {
  /* ★★★★★ **어디에 거나** — 둘 다 담는 **공통 조상**이어야 한다 (2026-09-06 실측)
   *
   *   화면은 두 갈래로 그려진다 —
   *   ```
   *   #화면 <CANVAS>  →  #판 → #무대 → BODY      (배경 캔버스)
   *   #view (host)    →  #stage → #판            (DOM 레이어들)
   *   ```
   *   ☠ `#화면` 에만 걸면 **DOM 레이어(맵·유닛)가 안 변하고**,
   *     `#view` 에만 걸면 **캔버스가 안 변한다** — 둘 다 화면으로 확인했다
   *     (`#view` 만 걸었을 때 붉기 R−G 가 30 → 35 밖에 안 올랐다. 원본은 35 → 108).
   *   ☠☠ **공통 조상 `#판` 에 거는 것도 틀렸다** (2026-09-06 실측) —
   *     새 쌓임 맥락이 생겨 **G·B 까지 내려갔다.**
   *     ```
   *       원본 포화   R233 G119 B 94   (R−G 114)
   *       #판 하나    R225 G 83 B 74   (R−G 142)   ← G·B 가 무너진다
   *       ★ 둘 각각   R225 G121 B104   (R−G 104)   ← 원본과 거의 같다
   *     ```
   *   ⇒ **`#화면` 과 `#view` 에 각각** 건다. 조상에 걸지 않는다.
   *   ★ 원본도 팔레트를 통째로 바꾸므로 UI 까지 물드는 것이 맞다
   *     (원본 실측 — 연출 중 UI 가 `R138→R232`). */
  var 목 = [];
  if (typeof document !== 'undefined') {
    var 캔 = document.getElementById('화면'); if (캔) 목.push(캔);
  }
  if (this.host && 목.indexOf(this.host) < 0) 목.push(this.host);
  if (!목.length) return this;
  var 화면 = 목[0];
  if (!화면) return this;
  var 나 = this;
  if (n == null) {                                   /* 0x22119 — 되돌린다 */
    if (나._붉기 != null) {
      목.forEach(function (e, i) { e.style.filter = (나._붉기앞 && 나._붉기앞[i]) || ''; });
      나._붉기 = null;
    }
    return this;
  }
  n = n | 0; if (n < 0) n = 0;
  if (this._붉기 === n) return this;                 /* 같은 단계면 다시 안 만든다 */
  if (this._붉기 == null) this._붉기앞 = 목.map(function (e) { return e.style.filter || ''; });
  this._붉기 = n;

  var NS = 'http://www.w3.org/2000/svg';
  var f = document.getElementById('g2-붉기-func');
  if (!f) {
    var svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('width', '0'); svg.setAttribute('height', '0');
    svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none';
    var flt = document.createElementNS(NS, 'filter');
    flt.setAttribute('id', 'g2-붉기');
    /* ★ sRGB 로 못박는다 — 기본값(linearRGB)이면 값이 어긋난다 */
    flt.setAttribute('color-interpolation-filters', 'sRGB');
    var ct = document.createElementNS(NS, 'feComponentTransfer');
    f = document.createElementNS(NS, 'feFuncR');
    f.setAttribute('id', 'g2-붉기-func');
    f.setAttribute('type', 'table');
    ct.appendChild(f);
    /* ★★★ **G·B 를 identity 로 못박는다** (2026-09-06 실측으로 잡았다)
     *   표준은 「빠뜨리면 identity」지만, 실제로는 **G·B 가 함께 내려갔다** —
     *     원본 포화  R233 G119 B94
     *     우리(빠뜨림) R223 **G83 B74**   ← R 은 맞는데 G·B 만 줄었다
     *   원본은 R 성분만 만지므로 G·B 는 그대로여야 한다. 그래서 명시한다. */
    ['feFuncG', 'feFuncB', 'feFuncA'].forEach(function (t) {
      var e = document.createElementNS(NS, t);
      e.setAttribute('type', 'identity');
      ct.appendChild(e);
    });
    flt.appendChild(ct); svg.appendChild(flt);
    (document.body || document.documentElement).appendChild(svg);
  }
  /* 6비트 R 0~63 각각에 규칙을 n 번 적용한 표 (0x21EC6~0x21ED9) */
  var t = new Array(64);
  for (var v = 0; v < 64; v++) {
    var r = v;
    for (var k = 0; k < n; k++) r = (r < 0x3E) ? (r + 1) : (r - 10);
    if (r < 0) r = 0; else if (r > 63) r = 63;
    t[v] = (r / 63).toFixed(4);
  }
  f.setAttribute('tableValues', t.join(' '));
  목.forEach(function (e) { e.style.filter = 'url(#g2-붉기)'; });
  return this;
};

/** 전투 연출이 요청한 화면 색조와 투명도를 합성한다. */
Renderer.prototype.연출물들임 = function (rgb, a) {
  var o = this._tintUnderEl;
  if (!o) {
    o = this._tintUnderEl = el('div', 'g2-tint-under', this.host);
    /* z 는 연출(`g2-fxscreen`)보다 **낮게** — 맵·유닛은 덮고 이펙트는 안 덮는다 */
    o.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
                      'pointer-events:none;display:none;z-index:40;';
  }
  if (!rgb || !(a > 0)) { o.style.display = 'none'; o.style.mixBlendMode = ''; return this; }
  o.style.display = 'block';
  o.style.background = 'rgb(' + (rgb[0] | 0) + ',' + (rgb[1] | 0) + ',' + (rgb[2] | 0) + ')';
  o.style.opacity = Math.max(0, Math.min(1, a));
  /* ★★★★★ **합성 모드** — 원본이 「한 색으로 덮는」 것과 「한 성분만 올리는」 것을
   *   가르기 때문이다 (2026-09-06 · 화염7 메테오 대조에서 나왔다).
   *
   *   메테오 `0x21E16` 는 **모든 색의 R 성분만** 만진다 —
   *     0x21EC0  lea ebx, [ebx+ebx*2]   ; i×3 → R 자리
   *     0x21EC6  cmp dl, 0x3E           ; R >= 62 ?
   *     0x21ECB  inc cl                 ;   아니면 R + 1
   *     0x21ED6  sub dh, 0xA            ;   맞으면 R − 10
   *   ☠ 이것을 **알파 겹치기**로 흉내 내면 G·B 가 함께 줄어 원본과 달라진다.
   *   ★ `screen(a,b) = 1 − (1−a)(1−b)` 이면 `rgb(v,0,0)` 을 겹칠 때
   *     **R 만 올라가고 G·B 는 그대로**다 — 원본의 `R += 1` 과 같은 결과다.
   *
   *   빙한7(`0x2323F mov esi, 0xB824F` = 색 1번으로 모든 칸을 채움)처럼
   *   **한 색으로 덮는** 연출은 지금까지대로 알파 겹치기가 맞다. */
  o.style.mixBlendMode = (arguments[2] === 'screen') ? 'screen' : '';
  /* ☠★★★★★ **모드 `'전체'` — 이펙트보다 **위**로 올린다** (2026-09-11 · §68)
   *
   *   원본에는 **두 가지 물들임**이 있고 덮는 범위가 다르다 —
   *   ```asm
   *   0x30824  eax = 0x60(96) … cmp ax,0x100   ; 팔레트 **96~255 만**  (메테오·전격7)
   *   0x5FD1C  eax = 0      … edx = 0x100     ; 팔레트 **256 칸 전부** (회복7·아마게돈·
   *                                            ;   빙한7·소환·전격6 번쩍·힐윈드·다크존)
   *   ```
   *   앞엣것은 벼락(THUN72 는 색 0~95)이 안 덮이므로 **이펙트 아래(z 40)** 가 맞다.
   *   ☠ 그런데 뒤엣것까지 같은 층에 깔아 두어서, **화면이 순백이 되어야 할 때
   *     이펙트와 유닛이 위에 남아** 밝기가 **230 언저리에서 멈췄다.**
   *     실측 2026-09-11 — 원본 절정 247~251 ↔ 우리 226~230 (회복7·전격6·아마게돈 공통)
   *   ⇒ `'전체'` 를 받으면 **z 70** 으로 올려 이펙트·유닛·글자까지 덮는다. */
  o.style.zIndex = (arguments[2] === '전체') ? 70 : 40;
  return this;
};

/**
 * ★★★★★ **화면 전역 연출의 「유닛 아래」 층** (2026-09-03)
 *
 * 사용자 지적: 「문라이트같은경우에 **배경이 계속 떠있고 그위에 적 캐릭터가 있고
 * 그 위로 기둥이 떨어져야** 하는데 순서도 엉망이고 지 멋대로 사라지고
 * **배경에 캐릭터는 덮이고**」
 *
 * 원본 `0x58619`(문라이트)의 그리기 순서가 그것을 못박는다 —
 * ```asm
 * 0x5873B  call 0x5EFB9    ; ① 얼음 테두리(배경)
 * 0x5874E  call 0x12F2A    ; ② **유닛**
 * 0x5876C  call 0x5EFB9    ; ③ 빛기둥
 * 0x58906 · 0x58919 · 0x589C3 도 같은 차례다.
 * ```
 * 그런데 `화면모드` 는 **모든 요소를 `fxScreenLayer`(유닛 위) 한 층**에 넣어
 * 배경이 캐릭터를 덮었다. 그래서 **화면층을 둘로** 나눈다 —
 * 이 층은 `groundLayer` 자식이라 `world`(유닛)보다 **아래**에 합성된다.
 */
/**
 * ★★★★★ **화면 좌표인데 캐릭터 아래에 깔리는 층** (문라이트 테두리 등)
 *
 * ☠ 2026-09-03 — 처음엔 이것을 **`groundLayer` 안**에 넣었다. **틀렸다.**
 *   `groundLayer` 는 `left:50%; top:50%; transform-style:preserve-3d` 이고
 *   `apply()` 로 **기울기·배율·원근 변환**을 받는다. 그 안에 화면 좌표 그림을
 *   넣으면 **기울어지고 자리도 절반만큼 밀린다.**
 *   사용자 지적 「**배경위로 캐릭터가 안올라오고**」가 이 자리다.
 *
 * ⇒ `_ensureFxScreen` 과 똑같이 **`host` 에 직접** 붙인다. 다만 `world`(캐릭터)
 *   **앞에** 끼워 넣어야 캐릭터가 그 위에 온다 — DOM 순서가 곧 위아래다.
 */
/**
 * ★★★★★ **화면 전체 배경이 깔리는 동안 맵 오브젝트를 그 아래로 내린다**
 *   (2026-09-03 · 사용자 지적 「문라이트 쓰는데 **오브젝트는 왜 배경위로 올라와**」)
 *
 * 원본 문라이트 도막 ③은 **지형·오브젝트를 다시 그리지 않는다** —
 * `0x58906` 테두리 → `0x58919` 유닛 전부, 그것뿐이다. 그래서 테두리가 이미 그려져
 * 있던 오브젝트를 **덮는다.**
 *
 * ☠ 우리는 오브젝트를 원본대로 **행마다 유닛과 같은 대열**에 넣었다
 *   (`0x12C26 call 0x10CBD` 오브젝트 한 행 → `0x12C2B call 0x12567` 유닛 한 행 —
 *   아랫줄 오브젝트가 윗줄 캐릭터를 덮는다). 그래서 `spriteLayer` 안에 있고,
 *   `host` 에 붙은 배경층보다 **위**로 온다.
 *
 * ⇒ 배경층이 살아 있는 동안만 오브젝트를 **배경 아래로 옮긴다.** 배경이 걷히면
 *   제자리로 돌려 놓아 가림 표현이 되살아난다.
 *   ★ 캐릭터는 `spriteLayer` 에 남으므로 배경 **위**에 그대로 있다.
 */
Renderer.prototype._오브젝트를배경아래로 = function (내릴까) {
  /* viewport-fixed 아래층과 camera-plane 아래층 중 실제 활성 배경을 고른다.
   * 두 층은 transform 계열만 다르고, 유닛보다 아래라는 합성 의미는 같다. */
  var 배경 = (this.fxCamPlaneUnder && this.fxCamPlaneUnder.childNodes && this.fxCamPlaneUnder.childNodes.length)
    ? this.fxCamPlaneUnder : this.fxScreenUnderLayer;
  if (!배경 || !this.spriteLayer) return;
  if (내릴까) {
    if (!this._내린오브젝트) this._내린오브젝트 = [];
    /* ★★★★★ **`g2-map-item` 도 내린다** (2026-09-04 · 사용자 지적)
     *
     *   > 사용자: 「**문라이트 쓰는데 오브젝트는 왜 배경위로 올라와?**」
     *
     *   ☠ 목록에 세 종류만 있었다. `spriteLayer`(= `objLayer`) 에는
     *     **`g2-map-item`**(바닥에 놓인 아이템 · `render.js:4555`)도 있는데
     *     빠져 있어서 **배경 위에 그대로 남았다.**
     *   ★ `g2-map-object` 는 `g2-map-object-strip` 의 **자식**이라 함께 내려간다.
     *   ★ `g2-map-flatanim` 은 `flatObjLayer`(= `groundLayer` 안)라 이미 배경 아래다. */
    var 목 = this.spriteLayer.querySelectorAll(
      '.g2-map-structure, .g2-map-object-strip, .g2-map-tree-composite, .g2-rowflat, .g2-map-item, .g2-map-flatpiece');
    for (var i = 0; i < 목.length; i++) {
      this._내린오브젝트.push({ el: 목[i], 다음: 목[i].nextSibling });
      배경.parentNode.insertBefore(목[i], 배경);   /* 배경 **앞** = 배경 아래 */
    }
  } else if (this._내린오브젝트 && this._내린오브젝트.length) {
    for (var k = 0; k < this._내린오브젝트.length; k++) {
      var r = this._내린오브젝트[k];
      /* ★ 내린 뒤 줄 세우기(_스프라이트대열정렬)가 형제들을 옮겨 두므로 «다음» 이 더는 spriteLayer 자식이 아닐 수 있다.
       *   ☠ 그대로 insertBefore 하면 예외로 되돌리기가 첫 요소에서 끊기고 _오브젝트내림 도 true 로 남아,
       *     줄에 없는 맵 아이템(상자)이 #view 에 남아 화면 기준으로 그려졌다
       *     (2026-10-02 사장님 「상자가 뷰포트에 그려지고있어」 · magicfx 가 예외를 삼켰다) */
      var 앞 = (r.다음 && r.다음.parentNode === this.spriteLayer) ? r.다음 : null;
      this.spriteLayer.insertBefore(r.el, 앞);
    }
    this._내린오브젝트.length = 0;
  }
};

/** 화면 아래쪽 연출을 담는 논리 평면 레이어를 한 번 구성한다. */
Renderer.prototype._연출화면아래층확보 = function () {
  if (this.fxScreenUnderLayer) return this.fxScreenUnderLayer;
  var o = document.createElement('div');
  o.className = 'g2-fxscreen-under';
  o.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
                    'overflow:hidden;pointer-events:none;transform-style:flat;';
  /* world 바로 앞 = 지면 위 · 캐릭터 아래 */
  if (this.world && this.world.parentNode === this.host) this.host.insertBefore(o, this.world);
  else this.host.appendChild(o);
  this.fxScreenUnderLayer = o;
  return o;
};

/**
 * ★★★★★ **카메라가 보는 칸에 붙은 판** — 화면 전역 연출을 얹는 자리
 *   (2026-09-09 · 사장님 지정: 「**카메라가 보는 칸에 붙은 판으로 해줘.**」)
 *
 * ── 왜 ─────────────────────────────────────────────────────────────
 * 원본은 화염6·화염7·빙한3/6/7·전격7·빙룡소환·화룡소환처럼 **화면 버퍼 전체**에
 * 뿌리는 연출이 있다(`03_분석/대조/00_분류.json` ② 뷰포트채움).
 * 지금까지는 그것을 `fxScreenLayer`(화면 고정 평면)에 얹었다. 그러면
 * **맵을 기울이거나 확대해도 연출만 제자리에 남아** 따로 논다.
 *
 * ⇒ 대신 **카메라가 보고 있는 칸에 320×200 짜리 판 하나를 붙이고** 거기에 그린다.
 *   판은 `fxTopLayer` 자식이라 `apply()` 의 월드 변환(배율·기울기·원근)을 그대로
 *   받고, 카메라를 향해 세워 둔다(빌보드) — 기울여도 그림 자체는 안 일그러진다.
 *
 * ── 좌표 ───────────────────────────────────────────────────────────
 * 판이 **정확히 320×200 논리 픽셀**이므로, 원본 화면 좌표(0~319 × 0~199)를
 * **그대로** `left`/`top` 에 쓰면 된다. `화면배율()` 로 뷰포트에 맞추던 계산이
 * 통째로 사라진다 — 그것이 「투영을 한 곳으로 모은다」의 실체다.
 *
 * ★ 레이어/배율 결합을 분리한 뒤에는 같은 카메라판 transform을 공유하는
 *   `cam-plane-under`/`cam-plane` 두 합성면을 사용한다. 둘은 위치·크기·배율이 같고
 *   유닛과의 합성 순서만 다르다.
 */
Renderer.prototype.칸판모드 = true;
/**
 * 카메라와 함께 움직이되 **유닛보다 아래**에 합성되는 320×200 논리 판.
 * 위쪽 `fxCamPlane`과 좌표/배율/앵커 계약은 동일하고 합성 순서만 다르다.
 * `groundLayer`와 `world`는 apply()에서 같은 transform을 받으므로 3D 카메라를 함께 따른다.
 */
Renderer.prototype._연출카메라아래평면확보 = function () {
  if (this.fxCamPlaneUnder) return this.fxCamPlaneUnder;
  var o = el('div', 'g2-fxcamplane-under', this.groundLayer);
  o.style.cssText = 'position:absolute;width:320px;height:200px;' +
                    'overflow:visible;pointer-events:none;transform-style:flat;';
  this.fxCamPlaneUnder = o;
  this._연출카메라아래평면놓기();
  return o;
};
/** 카메라와 함께 움직이는 연출 평면 레이어를 한 번 구성한다. */
Renderer.prototype._연출카메라평면확보 = function () {
  if (this.fxCamPlane) return this.fxCamPlane;
  var 위 = this._연출위층확보();
  var o = el('div', 'g2-fxcamplane', 위);
  /* ★★★★★ [리마스터] **판 밖으로 나가는 연출을 자르지 않는다** (2026-09-14 사장님 지시)
   *
   *   > 「지금 아마게돈의 **다크존 5개**가 커지는데, **원작화면상 경계쪽에서 잘려.**
   *   >  우리는 **배율이 적용될거라 자르지말고 다크존 5개를 다 그려야해.**」
   *
   *   원본 3클(`0x27C5A`)은 다섯 자리에 그린다 — `0x27D8E`(100,70) · `0x27E00`(232,70) ·
   *   `0x27E78`(166,100) · `0x27EE3`(100,130) · `0x27F4B`(232,130), 곧 **X 자**다.
   *   그림은 도막마다 커지므로(`0x5F570` 확대 블릿 열 자리) 232 쪽 둘은 **320 을 넘는다.**
   *   원본은 화면이 320×200 뿐이라 **거기서 잘렸다** — 그것은 «연출의 뜻»이 아니라
   *   **그 시절 화면의 한계**다.
   *
   *   ⇒ 우리 판은 320×200 논리 크기를 그대로 두되(좌표를 1:1 로 쓰기 위해서다)
   *     **자르지는 않는다.** 뷰포트가 넓으므로 다섯이 온전히 보인다.
   *   ☠ `width`/`height` 는 **건드리지 않는다** — 그것이 바뀌면 원본 화면 좌표를
   *     그대로 쓰는 전제가 깨진다. 자르기만 푼다.
   *   ※ `03_분석/리마스터_적용현황.md` 에 한 줄 남겼다. */
  o.style.cssText = 'position:absolute;width:320px;height:200px;' +
                    'overflow:visible;pointer-events:none;transform-style:flat;';
  this.fxCamPlane = o;
  this._연출카메라평면놓기();
  return o;
};
/**
 * ★★★★★ **아래쪽 칸판** — 유닛보다 아래·바닥보다 위에 깔리는 화면 전역 연출
 *   (문라이트 테두리 `0x58906` → `0x58919` 유닛 순서)
 *
 * `groundLayer` 의 **마지막 자식**으로 둔다 —
 *   · `groundLayer` 는 `world` 와 **같은 변환**을 받고 `world` 보다 **아래**에 합성된다
 *     ⇒ 유닛(`spriteLayer`)이 언제나 이 판 위에 온다
 *   · 바닥(`floorLayer`)보다 **뒤**에 붙이므로 바닥은 덮는다
 * ☠ 맵 오브젝트는 `spriteLayer`(= `world`) 에 있어 이 판 **위**로 온다.
 *   원본은 도막 ③에서 지형·오브젝트를 다시 안 그리므로 테두리가 덮어야 한다
 *   ⇒ `_오브젝트를배경아래로()` 가 그동안만 옮긴다.
 */
/** 판을 카메라가 보는 칸 한가운데에 놓고 카메라를 향해 세운다. `apply()` 가 매번 부른다. */
Renderer.prototype._연출카메라평면놓기 = function () {
  this._놓기한판(this.fxCamPlane);
};
Renderer.prototype._연출카메라아래평면놓기 = function () {
  this._놓기한판(this.fxCamPlaneUnder);
};
/** 한 연출 평면 요소의 논리 자리·크기·배경 맞춤을 화면에 반영한다. */
Renderer.prototype._놓기한판 = function (o) {
  if (!o) return;
  /* `world` 자식은 `left:50%` 기준이라 **맵 픽셀 − mapW/2** 가 제 자리다.
   *   판 한가운데를 카메라에 맞추므로 다시 절반(160·100)을 뺀다. */
  var v = this.viewCam();
  /* 아래 판(fxCamPlaneUnder)은 지면 그룹의 자식이라 흔들림을 물려받는다 — 연출은 흔들리지 않으므로 빼 둔다.
   *   위 판(fxCamPlane)은 이미 흔들림을 뺀 fxTopLayer 의 자식이라 빼지 않는다 (apply() 의 fxTopLayer 주석 · 2026-09-25)
   *   ☠ 처음엔 둘 다 뺐다 — 위 판이 흔들림 장마다 +2 로 밀렸다(빙한3 칸 27 층판 기록) */
  var 흔 = (o === this.fxCamPlaneUnder && this.shake) ? this.shake : { x: 0, y: 0 };
  o.style.left = (v.cx - this.mapW / 2 - 160 - (흔.x | 0)) + 'px';
  o.style.top = (v.cy - this.mapH / 2 - 100 - (흔.y | 0)) + 'px';
  /* 빌보드 — 부모가 건 기울기·회전을 되돌려 화면 정면을 보게 한다
   *   (`_빌보드적용` 의 마지막 갈래와 같은 식) */
  o.style.transform = (this.cam.rot || this.cam.tilt)
    ? ('rotateZ(' + (-this.cam.rot) + 'deg) rotateX(' + (-this.cam.tilt) + 'deg)')
    : 'none';
  /* ★ 기울이면 fxTopLayer 가 평면 대열이 된다 — 판마다 세계 변환을 합쳐야 한다. 안 합치면 카메라 판이 배율 1(320×169)로 작게
   *   한쪽에 그려졌다 (2026-10-19 리마스터 3D 연출 대조 · 기울인 2.5D 도 같았다 — 마법 75~77 등 카메라 판 연출) */
  this._평면한요소(o);
};
/**
 * 연출 평면의 배율 — **그 요소가 어느 층에 들어가느냐**로 갈린다.
 *
 * · **칸판**(카메라가 보는 칸에 붙은 판)에 들어가면 **1:1** — 판이 이미 320×200
 *   논리 픽셀이고 월드 변환(zoom)이 그것을 뷰포트 크기로 키운다.
 * · **화면 붙박이 평면**에 들어가면 `화면배율()`(뷰포트 높이 ÷ 200) 로 키워야 한다.
 *
 * 합성 순서와 transform 계열을 분리한다. `cam-plane-under`/`cam-plane`은 같은
 * 카메라판 배율을, `screen-under`/`screen`은 같은 뷰포트 배율을 쓴다.
 *
 * @param {string} [레이어] 물리 연출 레이어 kind
 */
Renderer.prototype.연출평면배율 = function (레이어) {
  /* 합성 순서(아래/위)가 아니라 **좌표층의 transform 계열**만 배율을 결정한다. */
  var 족 = 연출층계약.변환족(레이어 || 'screen');
  if (족 === '카메라판') return { s: 1, x: 1, y: 1, ox: 0, oy: 0, w: 320, h: 200 };
  return this.화면배율();
};

/**
 * 화면 좌표 연출 한 장의 자리·크기를 실제 DOM에 반영한다.
 * `연출평면배율()`의 층별 선택과 기존 산식을 한 표시 경계에서 소유한다.
 * @param {HTMLElement} e 표시 요소
 * @param {number} x 원본 화면 좌표 x
 * @param {number} y 원본 화면 좌표 y
 * @param {number} w 논리 폭
 * @param {number} h 논리 높이
 * @param {string} 레이어 물리 연출 레이어 kind
 * @param {boolean} 배경맞춤 배경 그림도 같은 크기로 맞추는가
 */
Renderer.prototype.연출평면놓기 = function (e, x, y, w, h, 레이어, 배경맞춤) {
  if (!e || !e.style) return null;
  var S = this.연출평면배율(레이어 || e._fxLayerKind);
  e.style.left = (S.ox + x * S.s) + 'px';
  e.style.top = (S.oy + y * S.s) + 'px';
  e.style.width = (w * S.s) + 'px';
  e.style.height = (h * S.s) + 'px';
  if (배경맞춤) e.style.backgroundSize = (w * S.s) + 'px ' + (h * S.s) + 'px';
  e.style.transform = 'none';
  return S;
};

/** 화면 평면의 여섯 뜻을 검사하고 기존 배율·배치 포트에 같은 값을 전달한다. */
Renderer.prototype.연출명령평면놓기 = function (e, 명령, w, h, 배경맞춤) {
  연출명령계약.검사(명령);
  var 아래 = 명령.아래위 === '화면아래';
  if (명령.공간 !== '화면' || 명령.앵커 !== '좌상단' || 명령.y의뜻 !== '화면세로' ||
      명령.자세 !== '세움' || (!아래 && 명령.아래위 !== '화면위'))
    throw new Error('아직 지원하지 않는 화면 평면 의미 명령 조합');
  /* 레이어는 요소가 이미 소유한다. 같은 좌표 명령이라도 camera-plane/screen transform은
   * 명시 레이어가 결정하고, 아래/위는 scale을 바꾸지 않는다. */
  return this.연출평면놓기(e, 명령.자리.x, 명령.자리.y, w, h, e._fxLayerKind, 배경맞춤);
};

/** fxSprite의 빌보드 변환을 화면 붙박이 평면 요소 규약으로 되돌린다. */
Renderer.prototype.연출평면요소초기화 = function (e) {
  if (!e || !e.style) return false;
  e.style.transform = 'none';
  e.style.transformStyle = 'flat';
  return true;
};

/** 색 판의 그림·색·투명도 캐시를 기존 조건과 순서로 반영한다. */
Renderer.prototype.연출판자료반영 = function (e, 색) {
  if (!e || !e.style) return false;
  if (e._murl !== 'PAN') { e.style.backgroundImage = 'none'; e._murl = 'PAN'; }
  if (e._pcol !== 색) { e.style.backgroundColor = 색; e._pcol = 색; }
  if (e._mop) { e.style.opacity = ''; e._mop = 0; }
  return true;
};

/** 연출 그림의 선택적 투명도와 캐시를 기존 조건·순서로 반영한다. */
Renderer.prototype.연출투명도반영 = function (e, 값) {
  if (!e || !e.style) return false;
  if (값 != null) {
    if (e._mop !== 값) { e.style.opacity = 값; e._mop = 값; }
  } else if (e._mop) {
    e.style.opacity = '';
    e._mop = 0;
  }
  return true;
};

/** 연출 요소를 뜻으로 고른 Renderer 층의 마지막 자식으로 옮긴다. */
Renderer.prototype.연출요소층이동 = function (e, 뜻) {
  var 층 = e && this.FX층(뜻);
  if (!층) return false;
  층.appendChild(e);
  return true;
};

/** 맵과 정합하는 전투 효과 캔버스를 창 안에 배율 적용해 놓는다. */
Renderer.prototype.전투효과캔버스놓기 = function (e, left, top, scale) {
  if (!e || !e.style) return false;
  e.style.left = left + 'px';
  e.style.top = top + 'px';
  e.style.transform = 'scale(' + scale + ')';
  return true;
};

/** URL이 바뀐 연출 그림의 자료와 논리 크기를 정해진 순서로 반영한다. */
/**
 * ★ 잔상(단색 실루엣 · 원본 0x5F517)을 판 안의 캔버스에 «바로» 그린다 (2026-10-01 사장님 「1로 진행해줘」 — 잔상 끊김 없애기)
 *   원본은 찍는 순간 점 색만 바꾼다(그림을 따로 안 만든다). 우리는 잔상마다 PNG 를 구워(toDataURL · 한 장 15~50ms) 화면이 섰다.
 *   ⇒ 판의 자리·크기·기울임(빌보드)은 그대로 두고, 그 안 캔버스에 원본 캔버스를 그린 뒤 색만 덮는다(source-in).
 *   ★ 기록기(04_도구/우리그리기기록.js)가 켜져 있으면 쓰지 않는다 — 기록기는 판의 배경 그림 주소로 그림을 알아본다(기록 결과 불변).
 *   색은 `_실루엣그림정보` 와 같은 팔레트(섞기 전 · `_유닛쓸팔`) · 캔버스는 원본(스케일러 N배) 크기 그대로, 화면 크기는 논리 w×h.
 * @returns {boolean} 그렸으면 true (못 그리면 부르는 쪽이 옛 길 — 그림 주소)
 */
Renderer.prototype.실루엣판반영 = function (e, fr, idx, w, h) {
  if (!e || !e.style || !fr || typeof document === 'undefined') return false;
  if (root.__우리기록 && root.__우리기록.켜짐) return false;
  var src = fr.canvas;
  if (!src || !src.width || !src.height) return false;
  var P = this._유닛쓸팔 || this._유닛팔레트();
  if (!P || P.length < 768) return false;
  var i3 = (idx | 0) * 3;
  var css = 'rgb(' + (P[i3] | 0) + ',' + (P[i3 + 1] | 0) + ',' + (P[i3 + 2] | 0) + ')';
  var cv = e._실판;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    e.appendChild(cv);
    e._실판 = cv;
  }
  /* 보간은 rend() — N배 그림을 pixelated 로 줄이면 계단이 된다 (11-09 사장님 「…초필살기에 스케일러 적용이 안되는 듯해」 · fxSprite 와 같은 갈래) */
  if (cv.style.imageRendering !== rend()) cv.style.imageRendering = rend();
  if (cv._원천 !== src || cv._색 !== css || cv.width !== src.width || cv.height !== src.height) {
    if (cv.width !== src.width) cv.width = src.width;
    if (cv.height !== src.height) cv.height = src.height;
    var cx = cv.getContext('2d');
    cx.globalCompositeOperation = 'copy';
    /* 5인자 — scaler.js drawImage 몽키패치가 논리 크기로 줄이지 않게 (_실루엣그림정보 주석) */
    cx.drawImage(src, 0, 0, src.width, src.height);
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = css;
    cx.fillRect(0, 0, cv.width, cv.height);
    cx.globalCompositeOperation = 'source-over';
    cv._원천 = src; cv._색 = css;
  }
  cv.style.display = '';
  e.style.backgroundImage = 'none';
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  e._murl = '실판#' + (fr.열쇠 || '') + '#' + css;
  return true;
};
/** 유닛 상자가 지금 걸고 있는 그림(배경 그림 주소)이 풀릴 때까지 — 연출 그림을 걷기 «전»에 기다린다.
 *   처음 보이는 자세 그림(연 끝 모션 5+카운터 · 혼 끝 모션 6)은 풀릴 때까지 한 프레임 비어, 연출 그림을 먼저 걷으면 그 프레임에 캐릭터가 사라졌다.
 *   최대 상한 ms(기본 100)에서 끊는다 — 기다림 동안 연출 그림과 진짜 캐릭터는 같은 자리·같은 그림이라 겹쳐도 안 보인다. */
Renderer.prototype.유닛그림풀림 = function (u, 상한) {
  var box = u && this.unitEls && this.unitEls[u.id];
  if (!box || typeof Image !== 'function') return Promise.resolve();
  var 주소 = [];
  [box].concat([].slice.call(box.querySelectorAll('*'))).forEach(function (e) {
    var bg = e.style && e.style.backgroundImage;
    var m = bg && /url\(["']?([^"')]+)["']?\)/.exec(bg);
    if (m && 주소.indexOf(m[1]) < 0) 주소.push(m[1]);
  });
  if (!주소.length) return Promise.resolve();
  var 풀기 = Promise.all(주소.map(function (s) {
    try { var im = new Image(); im.src = s; return im.decode ? im.decode().catch(function () {}) : null; } catch (e) { return null; }
  }));
  return Promise.race([풀기, new Promise(function (ok) { setTimeout(ok, 상한 == null ? 100 : (상한 | 0)); })]);
};

/** 연출 그림 한 장을 판(캔버스)에 «바로» 그린다 — 실루엣판반영 과 같은 판, 색 입히기만 없다.
 *   ☠ background-image 로 그림 주소를 바꿔 끼우면 브라우저가 그 그림을 풀 때까지 한 프레임 빈다 —
 *     연에서 본체가 숨은 채 그림이 안 나온 프레임을 실측했다(숨김 13ms · 첫 그림 31ms · 27ms 프레임 빔)
 *     (2026-10-01 사장님 「사라졌다가 나오는것처럼 뚝뚝끊기는 느낌」 · 「특히 연이 이질감이 있어」)
 *   기록기가 켜져 있으면 false — 그쪽은 그림 주소를 읽으므로 옛 길(연출그림자료반영)로 */
Renderer.prototype.연출판그림반영 = function (e, fr, w, h) {
  if (!e || !e.style || !fr || typeof document === 'undefined') return false;
  if (root.__우리기록 && root.__우리기록.켜짐) return false;
  var src = fr.canvas;
  if (!src || !src.width || !src.height) return false;
  var cv = e._실판;
  if (!cv) {
    cv = document.createElement('canvas');
    cv.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
    e.appendChild(cv);
    e._실판 = cv;
  }
  /* 보간은 rend() — N배 그림을 pixelated 로 줄이면 계단이 된다 (11-09 사장님 「…초필살기에 스케일러 적용이 안되는 듯해」 · fxSprite 와 같은 갈래) */
  if (cv.style.imageRendering !== rend()) cv.style.imageRendering = rend();
  if (cv._원천 !== src || cv._색 !== null || cv.width !== src.width || cv.height !== src.height) {
    if (cv.width !== src.width) cv.width = src.width;
    if (cv.height !== src.height) cv.height = src.height;
    var cx = cv.getContext('2d');
    cx.globalCompositeOperation = 'copy';
    cx.drawImage(src, 0, 0, src.width, src.height);     /* 5인자 — 실루엣판반영 과 같은 까닭 */
    cx.globalCompositeOperation = 'source-over';
    cv._원천 = src; cv._색 = null;
  }
  cv.style.display = '';
  e.style.backgroundImage = 'none';
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  e._murl = '판#' + (fr.열쇠 || fr.url || '');
  return true;
};
Renderer.prototype.연출그림자료반영 = function (e, url, w, h) {
  if (!e || !e.style) return false;
  if (e._실판) e._실판.style.display = 'none';      /* 잔상 캔버스(실루엣판반영)를 쓰던 판이면 숨긴다 — 같은 판을 보통 그림과 번갈아 쓴다 */
  e.style.backgroundImage = 'url(' + url + ')';
  e.style.backgroundPosition = '0 0';
  e.style.backgroundSize = w + 'px ' + h + 'px';
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  e._murl = url;
  return true;
};

/** 전투 시트의 한 프레임 크기와 시트 위치를 정해진 순서로 반영한다. */
Renderer.prototype.연출시트프레임반영 = function (e, rect) {
  if (!e || !e.style || !rect) return false;
  e.style.width = rect.w + 'px';
  e.style.height = rect.h + 'px';
  e.style.backgroundPosition = (-rect.x) + 'px ' + (-rect.y) + 'px';
  return true;
};

/** 소멸 링의 URL 캐시와 시트 그림을 기존 순서로 반영한다. */
Renderer.prototype.소멸링그림자료반영 = function (e, url, sheet) {
  if (!e || !e.style) return false;
  e._url2 = url;
  e.style.backgroundImage = 'url(' + url + ')';
  /* Fx 시트 rect는 논리 좌표이고 PNG만 N배다. 시트 전체를 논리 크기로 환산한다. */
  if (sheet) e.style.backgroundSize = sheet[0] + 'px ' + sheet[1] + 'px';
  return true;
};

/** 초필살 그림의 원본 방향별 반전과 중심축을 정해진 순서로 반영한다. */
Renderer.prototype.연출그림반전반영 = function (e, 변환) {
  if (!e || !e.style) return false;
  /* ★ 뒤집기를 요소에 적어 둔다 — 빌보드 변환(_빌보드적용)이 transform 을 통째로 다시 쓰므로 거기서 뒤에 붙인다
   *   ☠ 2026-09-26 까지 빌보드가 곧바로 'none' 으로 덮어 광룡탄 방향 2·3 뒤집기(0x5F1AB·0x5F0CF)가 한 번도 안 보였다 */
  e._반전tf = 변환 || '';
  e.style.transform = 변환;
  e.style.transformOrigin = '50% 50%';
  return true;
};

/** 초필살 파편 캔버스의 생성 시 표시 스타일을 반영한다. */
Renderer.prototype.연출파편요소초기화 = function (e) {
  if (!e || !e.style) return false;
  e.style.cssText = 'position:absolute;image-rendering:pixelated;' +
                    'pointer-events:none;transform-origin:50% 100%;';
  return true;
};

/** 초필살 파편 캔버스를 만들고 표시층·렌더 추적에 기존 순서로 등록한다. */
Renderer.prototype.연출파편캔버스열기 = function (층) {
  if (!층) return null;
  var e = document.createElement('canvas');
  this.연출파편요소초기화(e);
  층.appendChild(e);
  this.fxEls.push(e);
  return e;
};

/** 초필살 파편 캔버스를 DOM과 Renderer 추적 목록에서 함께 폐기한다. */
Renderer.prototype.연출파편캔버스닫기 = function (e) {
  if (!e) return false;
  this.dropFxSprite(e);
  return true;
};

/** 초필살 파편 캔버스의 CSS 논리 크기와 스케일러용 논리 크기를 반영한다. */
Renderer.prototype.연출파편크기반영 = function (e, w, h) {
  if (!e || !e.style) return false;
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  e.논리w = w;
  e.논리h = h;
  return true;
};

/** 연출 요소의 표시 크기(CSS 논리 px)만 정한다 — 파편 캔버스와 달리 논리w/h 꼬리표는 안 단다 (천지 빛띠 · 초필살_표시포트 «ultimate 직접 style 쓰기 0») */
Renderer.prototype.연출요소크기반영 = function (e, w, h) {
  if (!e || !e.style) return false;
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  return true;
};

/** 무대(#stage) 전체를 덮는 한 색 판 — 이름마다 하나 · a ≤ 0 이면 걷는다 (아수라 화면밝기 0x5FA2C 검은 판 · 폭풍검 흰 번쩍)
 *   z 100 — HUD·장식까지 덮는다(아수라 원본 DAC 전체 밝기와 같은 뜻). 옛 ultimate 안 직접 div 만들기를 옮겼다 */
Renderer.prototype.무대덮개 = function (이름, 색, a, 옵) {
  return this.화면한색(이름, 색, a, 옵);
};
/** ★ 화면 전체 한 색 — **공통 창구** (2026-10-13 · 팔레트 정리 ① · 03_분석/COMBATII/밝기_반투명_램프.md § 우리 실행기 창구 전수)
 *   원본이 DAC 256 색을 한 색으로 채우거나(0x2D48A 흰 번쩍 · 0x329E1) 한 색 쪽으로 페이드(0x49A3E · 0x1E565 붉은)하는 것은
 *   맵을 다시 칠하지 않고 #stage 위 DIV 한 장(이름마다 하나)의 불투명도로만 낸다 — 배율·기울기와 무관하고 가볍다.
 *   2026-10-13 사장님 「팔레트 관련해서 잘못 건드리면 느려지는 문제가 자꾸 생겨서 … 유형별로 모으고 그대로 적용하는게 좋겠어」
 *   옵.맨위 — 링·테두리까지 전부 덮는다(z 2147483000 · 필살 흰 번쩍) · 없으면 z 100(HUD·장식까지)
 *   이름 = 클래스 — 기록기(04_도구/우리그리기기록.js)가 옛 클래스 이름으로 찾으므로 이름은 바꾸지 않는다 */
Renderer.prototype.화면한색 = function (이름, 색, a, 옵) {
  var 표 = this._무대덮개 || (this._무대덮개 = {}), d = 표[이름];
  if (!(a > 0)) { try { if (d && d.parentNode) d.parentNode.removeChild(d); } catch (e제거) {} delete 표[이름]; return null; }
  var stage = this.host;
  while (stage && stage.id !== 'stage') stage = stage.parentNode;
  if (!stage) return null;
  if (!d || d.parentNode !== stage) {
    try { if (d && d.parentNode) d.parentNode.removeChild(d); } catch (e이동) {}
    d = (stage.ownerDocument || document).createElement('div');
    d.className = 'g2-stage-cover ' + 이름;   /* 이름 = 옛 클래스(g2-asura-stage-tint · g2-storm-flash) — 기록기(04_도구/우리그리기기록.js)가 그 이름으로 찾는다 */
    d.setAttribute('aria-hidden', 'true');
    d.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:' + ((옵 && 옵.맨위) ? 2147483000 : 100) + ';background:' + (색 || '#000') + ';';
    stage.appendChild(d);
    표[이름] = d;
  }
  if (색 && d._색 !== 색) { d.style.background = 색; d._색 = 색; }
  d.style.opacity = String(Math.max(0, Math.min(1, a)));
  return d;
};

/** 사망 연출의 1픽셀 파편 그림을 원본 색 또는 시트 픽셀로 초기화한다. */
Renderer.prototype.연출픽셀파편초기화 = function (e, 색, 배경, sx, sy) {
  if (!e || !e.style) return false;
  e.style.cssText = 'position:absolute;width:1px;height:1px;' + (색
    ? 'background-color:' + 색 + ';'
    : 'image-rendering:pixelated;background-image:' + 배경 + ';background-position:' +
      (-sx) + 'px ' + (-sy) + 'px;');
  return true;
};

/** 사망 연출의 1픽셀 파편 위치를 같은 순서로 반영한다. */
Renderer.prototype.연출픽셀파편놓기 = function (e, x, y) {
  if (!e || !e.style) return false;
  e.style.left = x + 'px';
  e.style.top = y + 'px';
  return true;
};

/** 사망 파편에 쓸 현재 유닛 프레임의 픽셀·논리 위치 스냅샷을 만든다. */
Renderer.prototype.사망파편자료 = function (u, 종류, 최대수) {
  var box = u && this.unitEls && this.unitEls[u.id];
  if (!box || !box.parentNode) return null;
  var 층 = box._layers || [], 위 = 층[층.length - 1] || 층[0];
  if (!위) return null;
  var fr = this.frameOf(위.meta, 위.no, u.dir, u.motion);
  var 왼쪽 = parseFloat(위.el.style.left) || 0, 위쪽 = parseFloat(위.el.style.top) || 0;
  var 모두 = [], self = this;
  층.forEach(function (L) {
    var px = self.framePixels(L.meta, L.no, u.dir, u.motion, 0);
    if (!px || !px.length) return;
    var dx = (parseFloat(L.el.style.left) || 0) - 왼쪽;
    var dy = (parseFloat(L.el.style.top) || 0) - 위쪽;
    px.forEach(function (q) { 모두.push({ x: q.x + dx, y: q.y + dy, c: q.c }); });
  });
  var cap = 종류 === 'large' ? 0 : (최대수 || 255);
  if (cap > 0 && 모두.length > cap) {
    var step = 모두.length / cap, cut = [];
    for (var i = 0; cut.length < cap && i < 모두.length; i += step) cut.push(모두[Math.floor(i)]);
    모두 = cut;
  }
  return {
    픽셀: 모두.length ? 모두 : null,
    폭: fr ? fr.w : 24, 높이: fr ? fr.h : 24,
    /* ★ 보통 몸은 이제 층 안 캔버스로 칠한다(유닛층그리기 · 2026-10-06) — 배경이 비었으면 그림 주소를 그때 굽는다 */
    왼쪽: 왼쪽, 위: 위쪽,
    배경: 위.el.style.backgroundImage || (fr && fr.url ? 'url(' + fr.url + ')' : '')
  };
};

/** 사망 파편 전용 표시 무대를 열고 본체를 숨긴다. 반환값은 Renderer 밖에서 해석하지 않는다. */
Renderer.prototype.사망파편무대열기 = function (u) {
  var box = u && this.unitEls && this.unitEls[u.id];
  if (!box || !box.parentNode) return null;
  var stage = box.cloneNode(false);
  /* ★ 평면 대열 판(기울기) 안이면 상자의 transform 글자에 세계 변환이 이미 합쳐져 있다 — 복제본은 국소 변환으로 되돌려 둔다 (2026-10-05)
   *   ☠ 안 그러면 판 관찰기가 합친 글자를 «국소»로 받아 세계 변환을 두 번 걸어, 큰 유닛 소거 연출(0x46B2C) 내내 아래로 튀었다
   *   (사장님 「2-4a에서 캐리어(임페리얼) 처치시 순간적으로 이미지가 아래쪽으로 튀는 문제도 있어. 곧 돌아오기는 하는데」 — 탑승자가 나오면 제자리) */
  if (box._합친tf != null && box.style.transform === box._합친tf) {
    stage.style.transform = box._국소tf || '';
    stage.style.transformOrigin = box._국소원점 || '';
  }
  stage.removeAttribute('id');
  stage.style.display = '';
  stage.style.pointerEvents = 'none';
  stage.style.zIndex = '35';
  box.parentNode.appendChild(stage);
  this._평면한요소(stage);                                /* 평면 판이면 그 자리에서 세계 변환 한 번 */
  box.style.display = 'none';
  return { 무대: stage, 본체: box };
};

/** 사망 파편 표시 무대에 1픽셀 조각 하나를 붙이고 최초 위치를 반영한다. */
Renderer.prototype.사망파편추가 = function (손잡이, 색, 배경, sx, sy, x, y) {
  if (!손잡이 || !손잡이.무대) return null;
  var q = document.createElement('div');
  this.연출픽셀파편초기화(q, 색, 배경, sx, sy);
  손잡이.무대.appendChild(q);
  this.연출픽셀파편놓기(q, x, y);
  return q;
};

/** 큰 유닛 사망 소거 단계에서 지정 파편을 숨긴다. */
Renderer.prototype.사망파편숨기기 = function (e) {
  if (!e || !e.style) return false;
  e.style.display = 'none';
  return true;
};

/** 사망 파편 표시 무대를 제거한다. */
Renderer.prototype.사망파편무대닫기 = function (손잡이, 본체되살림) {
  var stage = 손잡이 && 손잡이.무대;
  if (stage && stage.parentNode) stage.parentNode.removeChild(stage);
  /* 마장기 해제(0x46710)는 사라진 뒤 사람으로 다시 선다 — 그때만 본체를 되살린다 */
  if (본체되살림 && 손잡이.본체) 손잡이.본체.style.display = '';
};

/** 화면 사각형이 아닌 월드 판을 크기 지정 뒤 같은 순서로 빌보드 반영한다. */
Renderer.prototype.연출판월드놓기 = function (e, x, y, w, h) {
  if (!e || !e.style) return false;
  e.style.width = w + 'px';
  e.style.height = h + 'px';
  this.빌보드놓기(e, x, y + h, h);
  e._pl = x;
  e._pg = y + h;
  this.빌보드적용(e);
  return true;
};

/** 월드 색 판의 여섯 뜻을 검사하고 기존 판 배치 산식에 같은 값을 전달한다. */
Renderer.prototype.연출명령판월드놓기 = function (e, 명령, w, h) {
  연출명령계약.검사(명령);
  var 아래 = 명령.아래위 === '선택아래';
  if (명령.공간 !== '맵' || 명령.앵커 !== '좌상단' || 명령.y의뜻 !== '깊이' ||
      (아래 ? 명령.자세 !== '눕힘' : 명령.자세 !== '세움') ||
      (!아래 && 명령.아래위 !== '선택위'))
    throw new Error('아직 지원하지 않는 월드 판 의미 명령 조합');
  return this.연출판월드놓기(e, 명령.자리.x, 명령.자리.y, w, h);
};

/** 월드 그림의 선택적 확대·축소와 빌보드 반영 순서를 소유한다. */
Renderer.prototype.연출그림월드놓기 = function (e, x, y, w, h, 논리w, 논리h) {
  if (!e || !e.style) return false;
  if (w !== 논리w || h !== 논리h) {
    e.style.width = w + 'px';
    e.style.height = h + 'px';
    e.style.backgroundSize = w + 'px ' + h + 'px';
    e._연출확대 = true;
  } else if (e._연출확대) {
    /* ★ 확대했던 요소가 원래 크기로 돌아오면 크기를 되돌려 쓴다 — 안 쓰면 앞 크기가 남는다
     *   (2026-09-25 블랙홀 칸 141 끝 도막 원본 81×57 ↔ 우리 78×54 · 칸 142 ② 첫 장) */
    e.style.width = w + 'px';
    e.style.height = h + 'px';
    e.style.backgroundSize = w + 'px ' + h + 'px';
    e._연출확대 = false;
  }
  /* ★ «높이» 그림(기둥 조각·솟는 알갱이) — 밑동 바닥(e._높이바닥)에 세우고 그만큼 들어 올린다 (2026-09-26 · Z-83)
   *   사장님 「기둥 세우는 마법들이 원근이 적용되어서 위쪽이 좁아져. 소환이나 턴언데드가 그래 … 기둥은 세운것처럼 표현이 되어야 해」
   *   ☠ 전에는 조각마다 자기 밑변을 바닥의 «다른 깊이»에 대고 세워, 기울이면 위 조각일수록 뒤로 물러나 좁아졌다.
   *   기울기 0 에서는 top 이 같은 값이 되어 화면이 그대로다 (_빌보드적용 의 _들림) */
  if (e._높이바닥 != null && e._billboardMode !== 'floor') {
    var 바닥 = +e._높이바닥;
    this.빌보드놓기(e, x, 바닥, h);
    e._들림 = 바닥 - (y + h);
    e._pl = x;
    e._pg = 바닥;
    this.빌보드적용(e);
    return true;
  }
  e._들림 = 0;
  this.빌보드놓기(e, x, y + h, h);
  e._pl = x;
  e._pg = y + h;
  this.빌보드적용(e);
  return true;
};

/** 월드 그림의 여섯 뜻을 검사하고 기존 확대·배치 포트에 같은 값을 전달한다. */
Renderer.prototype.연출명령그림월드놓기 = function (e, 명령, w, h, 논리w, 논리h) {
  연출명령계약.검사(명령);
  var 아래 = 명령.아래위 === '선택아래';
  if (명령.공간 !== '맵' || 명령.앵커 !== '좌상단' || 명령.y의뜻 !== '깊이' ||
      (아래 ? 명령.자세 !== '눕힘' : 명령.자세 !== '세움') ||
      (!아래 && 명령.아래위 !== '선택위'))
    throw new Error('아직 지원하지 않는 월드 그림 의미 명령 조합');
  return this.연출그림월드놓기(e, 명령.자리.x, 명령.자리.y, w, h, 논리w, 논리h);
};

/**
 * 정본 §4에 따라 논리 놓는 점과 NSP 그림 기준점(ax/ay)을 분리해 월드 그림을 놓는다.
 * 확대 시 기준점 반올림은 기존 magicfx.sync와 같은 조건·순서로만 수행한다.
 */
Renderer.prototype.연출프레임그림월드놓기 = function (e, 명령, 그림기준점, w, h, 논리w, 논리h) {
  연출명령계약.검사(명령);
  var 관계OK = 명령.아래위 === '선택위' || 명령.아래위 === '선택아래' || 명령.아래위 === '공격중간';
  if (명령.공간 !== '맵' ||
      (명령.앵커 !== '발밑' && 명령.앵커 !== '좌상단' && 명령.앵커 !== '중앙') ||
      (명령.y의뜻 !== '깊이' && 명령.y의뜻 !== '높이') || !관계OK)
    throw new Error('아직 지원하지 않는 프레임 월드 그림 의미 명령 조합');
  var ax = 그림기준점.x | 0, ay = 그림기준점.y | 0;
  var fw = (논리w | 0) || 1, fh = (논리h | 0) || 1;
  if (w !== fw) ax = Math.round(ax * w / fw);
  if (h !== fh) ay = Math.round(ay * h / fh);
  return this.연출그림월드놓기(e, 명령.자리.x + ax, 명령.자리.y + ay,
                                w, h, 논리w, 논리h);
};

/** 화면 논리점과 NSP 그림 기준점을 분리해 기존 화면 평면 산식으로 놓는다. */
Renderer.prototype.연출프레임평면놓기 = function (e, 명령, 그림기준점, w, h, 논리w, 논리h) {
  연출명령계약.검사(명령);
  if (명령.공간 !== '화면' || (명령.앵커 !== '좌상단' && 명령.앵커 !== '중앙') ||
      명령.y의뜻 !== '화면세로' ||
      명령.자세 !== '세움' || (명령.아래위 !== '화면아래' && 명령.아래위 !== '화면위'))
    throw new Error('아직 지원하지 않는 프레임 화면 의미 명령 조합');
  var ax = 그림기준점.x | 0, ay = 그림기준점.y | 0;
  var fw = (논리w | 0) || 1, fh = (논리h | 0) || 1;
  if (w !== fw) ax = Math.round(ax * w / fw);
  if (h !== fh) ay = Math.round(ay * h / fh);
  /* 중앙점은 NSP ax/ay가 이미 그림 기준점에서 좌상단까지의 벡터를 가진다. */
  var bx = 명령.자리.x, by = 명령.자리.y;
  var 놓기명령 = 연출명령계약.명령만들기({
    공간: '화면', 자리: { x: bx + ax, y: by + ay },
    앵커: '좌상단', y의뜻: '화면세로', 자세: '세움', 아래위: 명령.아래위
  });
  return this.연출명령평면놓기(e, 놓기명령, w, h, true);
};

/** 화면 위쪽 연출을 담는 논리 평면 레이어를 한 번 구성한다. */
Renderer.prototype._연출화면층확보 = function () {
  if (this.fxScreenLayer) return this.fxScreenLayer;
  var o = el('div', 'g2-fxscreen', this.host);
  /* ★ z 50 — 연출 물들임(`g2-tint-under` z 40)보다 **위**, 팔레트 페이드(z 60)보다 **아래**.
   *   원본 `0x30824` 가 팔레트 96~255 만 덮고 벼락(0~95)은 안 덮는 것을 이렇게 흉내 낸다
   *   (2026-09-04 · `Renderer.prototype.연출물들임` 주석 참조). */
  o.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;' +
                    'overflow:hidden;pointer-events:none;z-index:50;';
  this.fxScreenLayer = o;
  return o;
};
/**
 * 원본 화면(320×200) → 뷰포트 픽셀 배율. 가로·세로를 **따로** 낸다.
 * 원본이 320×200 을 꽉 채우던 것을 우리 뷰포트도 꽉 채우게 한다.
 */
Renderer.prototype.화면배율 = function () {
  var w = (this.host && this.host.clientWidth) || 320;
  var h = (this.host && this.host.clientHeight) || 200;
  /* ★★ **원본 비율(320 : 200)을 지킨다.** 가로·세로 배율을 따로 잡으면 그림이
   *   옆으로 퍼지고 **전체가 한쪽으로 쏠려 보인다**(사용자 지적 2026-08-15
   *   「전체적으로 오른쪽으로 쏠린 느낌이야」).
   *
   *   **세로를 기준**으로 잡는다 — 원본이 화면 높이를 꽉 채우는 연출이고
   *   (프로미넌스 불기둥이 `68×198`), 가로는 남는 만큼 **가운데로 맞춘다**.
   *   마침 그 여백이 좌우 장식 기둥 자리와 거의 겹쳐, 연출이 전장 안쪽에 든다.
   *
   *   ★ 이 레이어는 `cam.zoom` 을 **안 받는다.** 배율을 어떻게 바꿔도
   *     화면 전역 연출은 언제나 같은 자리에 같은 크기로 나온다 —
   *     원본이 화면 버퍼에 그리던 것과 같은 성질이다. */
  var s = h / 200;
  return { s: s, x: s, y: s, ox: Math.round((w - 320 * s) / 2), oy: 0, w: w, h: h };
};
/** 선택 상자와 모서리 요소를 필요할 때 한 번 구성한다. */
Renderer.prototype._선택상자층확보 = function () {
  if (this.boxEl) return this.boxEl;
  if (!this.boxLayer) {
    this.boxLayer = el('div', '', this._오버레이층확보());
    this.boxLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';
  }
  /* ★ 체력 HUD 는 **오버레이 안에서** 선택박스보다 뒤에 와야 위에 그려집니다.
   *   예전엔 `world` 안의 fxLayer 를 맨 뒤로 옮겼는데, 선택박스는 world 가
   *   아니라 **overlayLayer**(world 다음에 합성) 안에 있어서 아무 소용이
   *   없었습니다 — 상자 코너가 HP 숫자를 덮었습니다.
   *   HP 값 요소는 `_ensureValueLayer()` 가 오버레이 맨 뒤에 답니다. */
  var S = this.SELBOX, self = this;
  var b = el('div', 'g2-selbox', this.boxLayer);
  b.style.cssText = 'position:absolute;pointer-events:none;box-sizing:border-box;' +
                    'transform-origin:50% 100%;border:1px solid ' + 선택상자색(S, 0) + ';';
  b._corners = S.corner.map(function (png) {
    var c = el('div', '', b);
    /* [11-09] 원본 MAIN.CUR(data-URL)만 쓴다 — 싣기 전이면 모서리를 안 그린다(추출 PNG 로 물러나지 않음 · 배포 묶음엔 PNG 가 없다) */
    var url = (png.indexOf('data:') === 0) ? png : null;
    c.style.cssText = 'position:absolute;image-rendering:pixelated;' +
      'width:' + S.cw + 'px;height:' + S.ch + 'px;' +
      (url ? 'background:url(' + url + ') no-repeat;background-size:' + S.cw + 'px ' + S.ch + 'px;' : '');
    c._원 = url;
    return c;
  });
  this.boxEl = b;
  this.boxEls = [b];
  this._boxColor = 0; this._boxAcc = 0;
  /* 상자를 새로 만들었으니 체력 숫자 층을 다시 맨 뒤(위)로 보냅니다 */
  if (this.valueLayer) this._값표시층확보();
  return b;
};

/**
 * 선택 상자를 그 대상에 맞춥니다.  `null` 이면 숨깁니다.
 * @param {object|null} t  유닛 또는 `{x, y}`
 * @param {object} [opt] `{force:true}`이면 연출 HUD mute 중에도 원본이 명시적으로
 *   `0x49EEE`를 호출한 특수 경로(예: 탐색 성공)에서 선택 상자를 표시한다.
 */
/* ★ 2026-09-24 (Z-40 「스케일러 관련 모든 요소」) 선택상자 귀퉁이(MAIN.CUR 4~7)도 필터를 탄다.
 *   상자는 한 번 만들고 계속 쓰므로, 필터가 바뀌었으면 그릴 때 다시 건다.
 *   크기는 background-size(논리 cw×ch)가 눌러 담는다. */
function 선택상자모서리필터(b) {
  var Sc = root.G2Scaler;
  var 키 = Sc && Sc.cur ? Sc.cur() : 'none';
  if (!b || !b._corners || b._필터 === 키) return;
  b._필터 = 키;
  b._corners.forEach(function (c) {
    if (!c._원) return;
    var 원 = c._원;
    var 걸기 = function (u) {
      if (b._필터 !== 키) return;
      c.style.backgroundImage = 'url(' + u + ')';
      c.style.imageRendering = rend();
    };
    if (Sc && Sc.sheet && Sc.N() > 1) 걸기(Sc.sheet(원, function (u) { 걸기(u); }));
    else 걸기(원);
  });
}
Renderer.prototype.selectBox = function (t, opt) {
  if (this._hudMuted && !(opt && opt.force)) t = null;  // 0x103A8 — 일반 연출 중에는 상자를 안 그립니다
  var b = this._선택상자층확보();
  var r = this.boxRect(t);
  if (!r) { b.style.display = 'none'; this.boxTarget = null; return this; }
  this.boxTarget = t;
  /* 선택 상자는 world 안에 있으므로 `cam.zoom`을 유닛과 정확히 한 번 같이 받습니다.
   * 별도 화면 픽셀 보정은 하지 않습니다(중복 확대 방지). */
  b.style.display = '';
  b.style.width = r.w + 'px';
  b.style.height = r.h + 'px';
  var S = this.SELBOX;
  /* 귀퉁이 — 원본(0x49CB1) 좌상(x1−1,y1−1)·우상(x2−6)·좌하(y2−5)·우하 를 상자 원점 기준으로.
   * box-sizing:border-box 의 1px 테두리가 자식 원점을 안쪽으로 밀어 화면상 1px 우하로 보이므로 −1 보정. */
  var at = [[-2, -2], [r.x2 - r.x1 - 7, -2],
            [-2, r.y2 - r.y1 - 6], [r.x2 - r.x1 - 7, r.y2 - r.y1 - 6]];
  b._corners.forEach(function (c, i) {
    c.style.left = at[i][0] + 'px'; c.style.top = at[i][1] + 'px';
  });
  선택상자모서리필터(b);
  /* ★ 캐릭터 위 → 세워서 감싸고(빌보드), 빈 칸(이동 타일) → 바닥에 눕힌다(지면 평면, 원근 따라감). */
  var onUnit = !!((t.sprIndex != null || t.id != null) && this.frameMeta(t));
  if (onUnit) {
    b.style.transformOrigin = '50% 100%';
    this._빌보드놓기(b, r.x1, r.y1 + r.h, r.h);      // 세움
    this._빌보드적용(b);
  } else {
    b._ground = null;                                    // apply()의 _빌보드적용 대상에서 제외 → 눕힘 유지
    b.style.transformOrigin = '50% 50%';
    b.style.left = (r.x1 - this.mapW / 2) + 'px';
    b.style.top = (r.y1 - this.mapH / 2) + 'px';
    b.style.transform = 'none';                          // world 평면 그대로 = 지면에 눕음
  }
  return this;
};

/** 현재 선택 상자를 숨기고 기존 선택상자 계약 결과를 반환한다. */
Renderer.prototype.hideSelectBox = function () { return this.selectBox(null); };

/** 테두리 색 돌리기 — 0x49D34.  dt 는 밀리초. */
Renderer.prototype.tickSelectBox = function (dt) {
  if (!this.boxEl || this.boxEl.style.display === 'none') return this;
  this._boxAcc += dt || 0;
  var S = this.SELBOX;
  while (this._boxAcc >= S.blinkMs) {
    this._boxAcc -= S.blinkMs;
    this._boxColor = (this._boxColor + 1) % S.colorIdx.length;
    this.boxEl.style.borderColor = 선택상자색(S, this._boxColor);
  }
  return this;
};

/* ── 전투 수치 표시 ────────────────────────────────────────────────────
 * 원작 링/행동 화면의 유닛 HP 숫자와 타격 직후의 부유 숫자를 월드 빌보드로 그립니다.
 * world 아래에 두므로 캐릭터·선택 상자와 동일하게 cam.zoom을 한 번만 받습니다. */
/* COMBATII 0x70A62 + 진영: 무소속·아군·우군·적군·몬스터. */
Renderer.prototype.HP_COLOR = [4, 16, 49, 81, 32];
/** 유닛의 현재 HP 비율에 대응하는 원본 게이지 색을 반환한다. */
Renderer.prototype.hpColor = function (u) {
  var side = u && (u.side | 0);
  return this.HP_COLOR[side >= 1 && side <= 4 ? side : 0];
};
/**
 * 체력 숫자 층 — **오버레이의 맨 뒤**(= 가장 위에 합성)에 둡니다.
 * 선택박스(boxLayer)도 같은 오버레이 안에 있으므로, 뒤에 달아야 상자 코너에
 * 가리지 않습니다. (원본 0x13517·0x13539 는 숫자를 상자 위에 찍습니다)
 */
Renderer.prototype._값표시층확보 = function () {
  var o = this._오버레이층확보();
  if (!this.valueLayer || this.valueLayer.parentNode !== o) {
    this.valueLayer = el('div', 'g2-valuelayer', o);
    this.valueLayer.style.cssText = 'position:absolute;transform-style:preserve-3d;';
  }
  /* 선택박스가 나중에 만들어졌으면 값 층을 다시 맨 뒤로 보냅니다 */
  if (o.lastChild !== this.valueLayer) o.appendChild(this.valueLayer);
  return this.valueLayer;
};
/**
 * ★★ **대상을 고르는 동안 HP 값을 감춥니다** (2026-08-16)
 *
 * 사용자 지정: 「**타겟 지정이나 효과 범위 보여줄 때 hp 표시하지 않아**」
 *
 * `muteHud` 와 같은 수법입니다 — 한 번 끄는 것만으로는 안 됩니다. 마우스를
 * 움직이면 hover 처리가 `showUnitValues(G2Ring.isOpen())` 를 곧바로 다시 켜므로
 * **플래그로 입구를 막습니다.**
 * ★ 원본 주소 미확인 — 관측으로 확정한 동작입니다.
 */
Renderer.prototype.muteValuesForTarget = function (on) {
  on = !!on;
  if (this._targetMute === on) return this;      // 바뀔 때만 다시 그립니다
  this._targetMute = on;
  if (this.refreshUnitValues) this.refreshUnitValues();
  return this;
};

/** 유닛 HP·MP 값 표시를 전체 또는 지정 유닛에만 전환한다.
 *  `opt.force` — 연출 감춤(`_hudMuted`)을 넘어 그린다. 원본이 정기 갱신(`0x103A8`)을 멈춘 채로
 *  **직접** 그리는 자리 전용이다(회복 게이지 `0x462A7` → `0x49FE1` → `0x13498`). */
Renderer.prototype.showUnitValues = function (show, onlyUnit, opt) {
  var 강제 = !!(opt && opt.force);
  /* ★ 마지막으로 정한 표시 조건을 기억해 둡니다 — `refreshUnitValues()` 가 씁니다. */
  this._valShow = { show: !!show, onlyUnit: onlyUnit || null, force: 강제, targetPick: !!(opt && opt.targetPick) };
  if (this._hudMuted && !강제) show = false;   // 0x103A8 — 연출 중에는 값 표시를 안 합니다
  if (this._targetMute && !(opt && opt.targetPick)) show = false; // 대상 지정·효과 범위; 원본 근거 예외는 호출부에서 한정
  this.valueEls = this.valueEls || {};
  var self = this;
  var layer = this._값표시층확보();
  /* ★ 2026-09-24 (사장님: 「비룡 배치후 취소시 맵에 해당 체력표시 hud가 버그처럼 남는」)
   *   아래 고리는 **지금 목록에 있는 유닛만** 켜고 끈다. 배치를 거두면(state.js 배치해제)
   *   유닛이 목록에서 빠지므로 그 숫자 요소는 아무도 안 꺼서 남았다 — 목록 밖 것은 치운다. */
  var 있는 = {};
  this.b.units.forEach(function (u) { 있는[u.id] = 1; });
  Object.keys(this.valueEls).forEach(function (id) {
    if (있는[id]) return;
    var e0 = self.valueEls[id];
    if (e0 && e0.parentNode) e0.parentNode.removeChild(e0);
    delete self.valueEls[id];
  });
  this.b.units.forEach(function (u) {
    var e = self.valueEls[u.id];
    if (e && e.parentNode !== layer) { e.parentNode.removeChild(e); e = null; delete self.valueEls[u.id]; }
    if (!e) {
      e = el('canvas', 'g2-unit-value', layer);
      e.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;' +
        'transform-origin:50% 100%;z-index:20;';
      self.valueEls[u.id] = e;
      self.fxEls.push(e);
    }
    /* ★★★★★ **죽는 중에도 값은 보인다** (2026-08-28 · 사용자 결과 피드백)
     *
     *   > 「hp0 이벤트 대사도 일반 대사처럼 … **캐릭터 포커싱되고 체력 나오고**」
     *   > 「**체력 0표시는 아직도 안돼.** 타원과 박스는 나와.」
     *
     *   원본은 `0x1DB50`(S4 대사) → `0x1DBA1`(사망 연출) 순서라 **대사 동안 유닛이
     *   맵에 있고 HP 0 이 보인다.** 우리는 `combat.kill()` 이 `alive = false` 를
     *   먼저 세우므로 `u.alive` 만 보면 값이 사라진다.
     *   ★ 스프라이트를 남기는 조건(`0x2227` `u.alive || this._dying[u.id]`)과 **같게** 한다. */
    var 살아보임 = u.alive || self._dying[u.id];
    var visible = show && 살아보임 && (!onlyUnit || onlyUnit.id === u.id);
    /* ★ 회복 게이지 중인 유닛은 표시 조건과 상관없이 보인다 — 원본 0x462A7 은 정기 갱신(0x103A8)을 멈춘 채 이 유닛 숫자를 직접 그린다(0x49FE1 → 0x13498)
     *   ☠ 게이지가 force 로 켠 뒤 대사창(화자만)·감춤이 표시 조건을 덮어, 게이지가 그 조건으로 다시 그려 0.2초 뒤부터 숫자가 꺼졌다
     *   (실측 11-09: HP 7100→10000 동안 display none · 사장님 「체력 회복하는 효과(숫자 올라가는거) 안나와」 · 「이벤트 회복」) */
    if (!visible && 살아보임 && self._게이지유닛 && self._게이지유닛 === u) visible = true;
    e.style.display = visible ? '' : 'none';
    if (!visible) return;
    var value = String(Math.max(0, Math.ceil((u.hp | 0) / 100)));
    /* ★ 값·색이 그대로면 **다시 굽지 않는다.** `e.width` 대입은 캔버스를 통째로
     *   비우므로, 매 호출마다 유닛 전원을 다시 구우면 회복 게이지처럼 3틱마다
     *   부르는 연출에서 깜빡여 보인다 (사용자 지적 2026-08-14 「HP 회복 수치가
     *   중간중간 사라졌다 보였다 뚝뚝 끊겨」). */
    var color = self.hpColor(u);
    /* ★ Z-44 (2026-09-24 · 「글자에도 적용」) — 글자 시트가 N배라 이 캔버스도 N배로 준비한다.
     *   1배 캔버스에 N배 시트를 줄여 넣으면 흐려진다. 크기(style)는 논리 그대로. */
    var 값N = (root.G2Scaler && root.G2Scaler.N) ? root.G2Scaler.N() : 1;
    var key = value + '|' + color + '|' + 값N + '|' +
              ((root.G2Scaler && root.G2Scaler.cur) ? root.G2Scaler.cur() : '');
    var 값w = value.length * 6 + 2, 값h = 7;
    if (e._valKey !== key) {
      e.width = 값w * 값N; e.height = 값h * 값N;
      e.style.width = 값w + 'px'; e.style.height = 값h + 'px';
      e.style.imageRendering = rend();                 /* 다른 N배 그림과 같은 보간 */
      var ec = e.getContext('2d'); ec.setTransform(값N, 0, 0, 값N, 0, 0);
      ec.imageSmoothingEnabled = false; ec.clearRect(0, 0, 값w, 값h);
      if (root.G2Hud && root.G2Hud.text) {
        /* 0x13517: 검정 그림자 (x+1,y), 0x13539: 진영색 본문 (x,y). */
        root.G2Hud.text(ec, value, 1, 0, 0, 1);
        root.G2Hud.text(ec, value, 0, 0, color, 1);
      }
      e._valKey = key;
    }
    /* 0x134DE~0x13501: 좌표 창구(0x10971·0x10988) + x2 · y6, 비행이면 y−0x18.
     * `world` 안이라 카메라·뷰포트 +4 를 안 뺀 `mapOf` 를 쓴다. */
    var m = self.mapOf(u);
    var px = m.x + 2;                                              // 0x134E9  add edx, 2
    var py = m.y + 6 - (((u.f14 | 0) & 1) ? 0x18 : 0);             // 0x134F6 · 0x134FE
    self._빌보드놓기(e, px, py + 값h, 값h);                        /* 논리 높이 (캔버스는 N배일 수 있다) */
    self._빌보드적용(e);
  });
  return this;
};

/**
 * 값만 다시 그립니다 — **표시 여부는 마지막에 정한 그대로.**
 *
 * 회복 게이지(`0x462A7`)처럼 3틱마다 부르는 연출이 `showUnitValues(조건)` 을
 * 직접 부르면, 그 조건이 화면 상태와 어긋날 때 **껐다 켰다** 하게 됩니다.
 *
 * 사용자 지적 2026-08-14: 「이벤트 체력 회복 수치 이상해. **중간중간 사라졌다
 * 보였다 뚝뚝 끊겨**.」 — 이벤트 중에는 링이 닫혀 있어 `G2Ring.isOpen()` 이
 * `false` 인데, 대사창 쪽은 `showUnitValues(true, 화자)` 로 켜 두기 때문에
 * 둘이 3틱마다 서로를 덮었습니다.
 */
/** 처음 실은 기본 팔레트(읽기 전용 공개 창구 · 렌더러_FX경계 — 소비자가 _palette 를 직접 안 읽게) */
Renderer.prototype.기본팔레트 = function () { return this._palette || null; };

Renderer.prototype.refreshUnitValues = function () {
  var s = this._valShow || { show: false, onlyUnit: null };
  return this.showUnitValues(s.show, s.onlyUnit, { force: !!s.force, targetPick: !!s.targetPick });
};

/* ══════════ 피해 숫자 — 글자마다 튀어오른다 (0x45BFB + 0x45CCB) ═══════════
 *
 * 자세한 사양은 `03_분석/COMBATII/피해숫자_연출.md`.
 *
 * 등록 `0x45BFB(eax = 유닛, edx = 피해값, bx = 슬롯)`
 *   0x45C50  q = 피해 / 0x64                    ★ **버림**(ceil 아님)
 *   0x45C5B  q>999→오프셋0 · q>99→1 · q>9→2 · 그 밖→3    ★ 4칸 우측정렬
 *   0x45CA9  기준선 = 화면y + 0x0A              ★ 칸 바닥 — 머리 위가 아니다
 *
 * 그리기 `0x45CCB(eax = 유닛, dx = 슬롯, bx = 프레임, cx = 색)`
 *   0x45D15  f <  5    : Y[0] -= 2
 *   0x45D25  f >= 0x14 : Y[3] += 2
 *   0x45D35  그 외     : k = (f−5)/5 ;  Y[k] += 2 ;  Y[k+1] -= 2
 *   0x45DDD  그림자 (x+1, y+1) 색 0   ·  0x45E0D  본 글자 (x, y) 색 cx
 *   0x45E0A  x += 6                            ★ TEXT.CHR 5px + 자간 1
 *
 * 곧 글자 하나가 **5프레임 올라(−10px) 5프레임 내려온다(+10px)**. 시작이 5프레임씩
 * 어긋나 **왼쪽부터 파도친다.** 포물선이 아니라 등속 왕복이다.
 *
 * 색은 **맞은 쪽 진영** — `byte[0x70A62 + [유닛+0x0E]]`. 머리 위 HP 와 같은 표다.
 * 「miss」는 `0x45E21` 갈래(진폭이 10→0 으로 줄어드는 떨림, 자간 0, 그림자 y 안 밀음).
 * ------------------------------------------------------------------------ */
Renderer.prototype.HIT_FRAMES = 0x19;              // 0x463DC  cmp bx, 0x19
Renderer.prototype.HIT_TICKS = 3;                  // 0x46378  eax = 3 → 0x1033B
Renderer.prototype.HIT_GLYPH_W = 6;                // 0x45E0A  add esi, 6 (5 + 자간 1)

/** 피해값(내부 단위) → 원본과 같은 4칸 우측정렬 글자 배열. `0` 은 빈 칸. */
Renderer.prototype.hitDigits = function (raw) {
  var buf = ['', '', '', ''];
  var v = raw | 0;
  if (v <= 0) return null;                          // 0x45C47 — 숫자 없음 = miss
  var q = Math.floor(v / 100);                      // 0x45C50  idiv 0x64 — ★ 버림
  var off = q > 999 ? 0 : (q > 99 ? 1 : (q > 9 ? 2 : 3));   // 0x45C5B
  var s = String(q);
  for (var i = 0; i < s.length && off + i < 4; i++) buf[off + i] = s[i];
  return buf;
};

/**
 * 원본 `0x45CCB` 의 프레임 f 에서 글자 i 의 Y 오프셋(기준선 대비).
 * 누적식이라 그대로 더해 가며 계산한다.
 */
Renderer.prototype.hitOffsets = function (f) {
  var y = [0, 0, 0, 0];
  for (var t = 0; t <= f; t++) {
    if (t < 5) y[0] -= 2;                            // 0x45D1B
    else if (t >= 0x14) y[3] += 2;                   // 0x45D2B
    else {
      var k = Math.floor((t - 5) / 5);               // 0x45D35
      y[k] += 2;                                     // 0x45D58
      if (k + 1 < 4) y[k + 1] -= 2;                  // 0x45D5B
    }
  }
  return y;
};

/**
 * 튀어오르는 피해 숫자 하나.
 * @param {object} u      맞은 유닛 (색과 자리를 여기서 뽑는다)
 * @param {number} raw    **내부 단위** 피해값 (표시값 × 100)
 * @param {object} [o]    `{ from:0|1, miss:true }` — `from` 은 시작 프레임
 *   (`0x46359` 는 0, 평타·마법·필살기 루프는 1 에서 시작한다)
 * @returns {Promise} 연출이 끝나면 resolve
 */
/**
 * ★★★★★ **유닛 머리 위 문구** — 원본 `0x48612` (2026-09-02 신설)
 *
 *   > 사용자 지적: 「필살기, 초필살기, 마법, 스킬 적용 효과와 **표시되는 이펙트**,
 *   >   이펙트 타이밍 등이 문제가 많아. 이부분은 특히 **꼼꼼하게 전수 확인**해야해.」
 *
 *   원본은 스킬·마법 게이트에서 **유닛 머리 위에 영문 문구**를 띄운다 —
 *   `Poison` · `Berserk!` · `Defense!` · `Wrong Spell!` · `No TP!` …
 *   우리는 그것을 `flash()`(디버그 텍스트)로만 흘려보내 **화면에 아예 안 떴다**.
 *   근거 전문은 `03_분석/00_누락기능_목록.md` §18 · §18-a~c.
 *
 *   ```asm
 *   0x48612  (ecx = 유닛, edx = 문자열, bx = 색)
 *   0x48620  eax = 3 · call 0x1033B            ; ★ 간격 **3틱**
 *   0x48632  x = 칸→화면(유닛.x) **+ 12**
 *   0x48645  y = 칸→화면(유닛.y) **− 16**
 *   0x48652 ┌ 0x484F9 그리기 · 0x499E4 한 프레임
 *   0x4867D └ cmp si, 0x24                     ; ★ **36프레임** (≈ 615 ms)
 *   ── 0x484F9 ──
 *   0x4851A  x −= strlen × 3                   ; ★ **가운데 맞춤**(글자폭 6 의 절반)
 *   0x48525  외곽선 = f < 8 ? 8 − f : min(f − 7, 6)  ; **7 → 1 → 6**
 *   0x4856D~0x485B3  (x±1, y) · (x, y±1) 네 번 ; **외곽선**
 *   0x485B8~0x485E3  본문색은 **따로 계산한다** (아래)
 *   0x48604  (x, y) 본문
 *   ```
 *
 *   ☠★★★★★ **2026-09-10 고침** — 여기 「외곽선은 본문과 같은 색」이라 적혀
 *     있었는데 **틀렸다.** `0x485AF mov edi,[esp+0x10]` 이 push 뒤라 esp 가 4
 *     내려가 있어 **프레임 원값**을 읽고, 본문은 8프레임째부터 갈라진다 —
 *     f 8·9 → 65·66(살구) · f 10·11 → 16·17(노랑) · f 12~36 → 예비색 **17**(노랑).
 *     부르는 자리 15곳(0x3BB69 등)이 전부 `mov ebx,0x11` 로 **17** 을 넘긴다.
 *     ⇒ 계산은 `hud.js 외침색()` 하나로 모았다.
 *
 *   ★★★ 색 1~7 은 밝기 순이다(실측 — 1 `rgb(255,255,255)` … 7 `rgb(28,36,52)`).
 *     그래서 `7 → 1` 은 **어둠에서 밝게 떠오르는** 것이고, 그 뒤 본문만 노랗게
 *     남고 외곽선이 6 까지 어두워져 **노란 글씨 + 어두운 테두리**로 자리잡는다.
 *
 *   @param {object} u 유닛
 *   @param {string} text 영문 문구
 *   @returns {Promise} 36프레임이 끝나면 풀린다
 */
Renderer.prototype.unitMsg = function (u, text) {
  if (!u || !text) return Promise.resolve();
  var self = this, TICK = (root.G2Anim && root.G2Anim.TICK_MS) || 5.6987;
  var m = this.mapOf(u);
  var baseX = m.x + 12, baseY = m.y - 16;            // 0x48632 · 0x48645
  /* 설계정본 §6: 유닛에 붙는 글자는 선택박스 위·선택위 연출 아래의 값 표시층이다. */
  var host = this._값표시층확보();
  var e = el('canvas', 'g2-unit-msg', host);
  var W = text.length * 6 + 4, H = 10;
  e.width = W; e.height = H;
  e.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;' +
                    'transform-origin:50% 100%;z-index:41;';
  this.fxEls.push(e);
  var ctx = e.getContext('2d');

  /* 0x484F9 — 프레임 f(1~36) → { 외곽선, 본문 }. 예비색 0x11 은 부르는 자리 15곳이
   * 전부 `mov ebx,0x11` 로 넘긴다 (0x3BB69 · 0x3BC1C · 0x3BEAF · 0x4C675 …) */
  function 색단계(f) { return root.G2Hud.외침색(f, 0x11); }

  function 그리기(f) {
    var c = 색단계(f);
    ctx.clearRect(0, 0, W, H);
    if (root.G2Hud && root.G2Hud.text) {
      /* 0x4856D~0x485B3 외곽선 넷 → 0x48604 본문 — **색이 다르다** */
      /* ★ 자간 1 — 0x484F9 는 다섯 번 모두 0x608E6 을 ecx = 1 로 부르고, 0x60931 add edi,5 · 0x60938 add edi,ecx 로 글자마다 6 전진한다
       *   (가운데 맞춤 0x4851A 글자당 3 과 같은 폭). ☠ 0 을 넘겨 5 씩 붙어 보였다 (2026-10-02 사장님 「빙룡소환, 화룡소환 문구 자간이 너무 가까운 문제」) */
      root.G2Hud.text(ctx, text, 1, 2, c['외곽선'], 1);   // (x−1, y)
      root.G2Hud.text(ctx, text, 3, 2, c['외곽선'], 1);   // (x+1, y)
      root.G2Hud.text(ctx, text, 2, 1, c['외곽선'], 1);   // (x, y−1)
      root.G2Hud.text(ctx, text, 2, 3, c['외곽선'], 1);   // (x, y+1)
      root.G2Hud.text(ctx, text, 2, 2, c['본문'], 1);     // 본문
    }
    /* 0x4851A — 가운데 맞춤: x 에서 길이 × 3 을 뺀다 */
    var x = baseX - text.length * 3;
    self._빌보드놓기(e, x, baseY + 7, 7);
    e._pl = x; e._pg = baseY + 7;
    self._빌보드적용(e);
  }

  return new Promise(function (done) {
    var f = 1, 예약 = null, 끝남 = false;
    function 끝() {
      if (끝남) return;
      끝남 = true;
      if (예약) self._시간취소(예약);
      var k = self.fxEls.indexOf(e); if (k >= 0) self.fxEls.splice(k, 1);
      if (e.parentNode) e.parentNode.removeChild(e);
      등록해제();
      done();
    }
    var 등록해제 = self._종료정리등록(끝);
    (function 프레임() {
      그리기(f);
      if (++f > 0x24) {                              // 0x4867D  cmp si, 0x24
        return 끝();
      }
      예약 = self._시간예약(프레임, 3 * TICK);       // 0x48620  eax = 3
    })();
  });
};

/** 피해·회복 수치를 유닛 위의 원본 숫자 연출로 표시한다. */
/** 0x2E896: 모델이 이미 옮긴 타일은 보존하고 출발점의 픽셀 오프셋만 감쇠한다. */
Renderer.prototype.필살넉백 = function (move) {
  if (!move || !move.unit || !move.from || !move.to || !(move.cells > 0)) return Promise.resolve(true);
  var self = this, u = move.unit, 예약 = null, 끝남 = false, f = 0;
  var tick = (root.G2Anim && root.G2Anim.TICK_MS) || 5.6987;
  u.ox = (move.from.x - move.to.x) * 좌표상수.타일가로;
  u.oy = (move.from.y - move.to.y) * 좌표상수.타일세로;
  u.motion = 10; // 0x2E8BC; 생존 검사는 원본에도 없다.
  return new Promise(function (resolve, reject) {
    function 끝(정상, 오류) {
      if (끝남) return;
      끝남 = true;
      if (예약) self._시간취소(예약);
      해제();
      u.ox = 0; u.oy = 0;
      u.motion = (needsLargeVisual(u) || (u.waitCount | 0) === 0xFF || ((u.f14 | 0) & 1)) ? 0 : 3;
      self.updateUnit(u); self.snapUnit(u); self.apply();
      if (오류) reject(오류); else resolve(정상);
    }
    var 해제 = self._종료정리등록(function () { 끝(false); });
    function frame() {
      if (끝남) return;
      try {
        // 0x2E9C4 그리기 → 정수 나눗셈70/100 → 0x2E9F0 7틱 대기, 총9회.
        // 표시 중인 값은 다음 그리기 경계까지 유지한다.
        if (f > 0) { u.ox = (u.ox * 70 / 100) | 0; u.oy = (u.oy * 70 / 100) | 0; }
        self.updateUnit(u); self.snapUnit(u); self.apply();
        f++;
        예약 = self._시간예약(function () { if (f < 9) frame(); else 끝(true); }, 7 * tick);
      } catch (e) { 끝(false, e); }
    }
    frame();
  });
};

Renderer.prototype.hitNumber = function (u, raw, o) {
  o = o || {};
  var self = this, TICK = (root.G2Anim && root.G2Anim.TICK_MS) || 5.6987;
  var digits = o.miss ? null : this.hitDigits(raw);
  var miss = !digits;
  var m = this.mapOf(u);
  var baseX = m.x, baseY = m.y + 10;                 // 0x45C19 · 0x45CA9
  var color = this.hpColor(u);                       // 0x70A62 + 진영 — 맞은 쪽
  /* 설계정본 §6: 피해 숫자도 선택박스 위·선택위 연출 아래의 값 표시층이다. */
  var host = this._값표시층확보();

  /* 글자마다 캔버스 하나 — 각자 Y 가 따로 움직인다 */
  var n = miss ? 1 : 4;
  var els = [];
  for (var i = 0; i < n; i++) {
    var ch = miss ? 'miss' : digits[i];
    var e = el('canvas', 'g2-hit-number', host);
    e.width = (miss ? 4 * 5 + 2 : self.HIT_GLYPH_W) + 2; e.height = 8;
    e.style.cssText = 'position:absolute;pointer-events:none;image-rendering:pixelated;' +
                      'transform-origin:50% 100%;z-index:40;';
    if (ch && root.G2Hud && root.G2Hud.text) {
      var ec = e.getContext('2d');
      /* 0x45DDD 그림자 — 숫자는 (x+1, y+1), miss 는 (x+1, y) · 자간 0 */
      root.G2Hud.text(ec, ch, 1, miss ? 0 : 1, 0, miss ? 0 : 1);
      root.G2Hud.text(ec, ch, 0, 0, color, miss ? 0 : 1);          // 0x45E0D
    }
    els.push({ el: e, x: baseX + i * self.HIT_GLYPH_W });
    this.fxEls.push(e);
  }

  function 그리기(f) {
    var off = miss
      /* 0x45E21 — 진폭이 10 → 0 으로 줄어드는 떨림 (짝수 프레임에만) */
      ? [(f % 2) ? 0 : -Math.max(0, Math.floor((0x14 - f) / 2))]
      : self.hitOffsets(f);
    for (var i = 0; i < els.length; i++) {
      var g = els[i], y = baseY + (off[i] | 0);
      self._빌보드놓기(g.el, g.x, y + 7, 7);
      g.el._pl = g.x; g.el._pg = y + 7;               /* 보간 없이 바로 */
      self._빌보드적용(g.el);
    }
  }

  var f = (o.from | 0), 예약 = null, 끝남 = false, 등록해제, 완료 = null;
  function 끝() {
    if (끝남) return;
    끝남 = true;
    if (예약) self._시간취소(예약);
    els.forEach(function (g) {
      var k = self.fxEls.indexOf(g.el); if (k >= 0) self.fxEls.splice(k, 1);
      if (g.el.parentNode) g.el.parentNode.removeChild(g.el);
    });
    if (등록해제) 등록해제();
    if (완료) 완료();
  }
  등록해제 = self._종료정리등록(끝);
  if (o.manual) {
    return {
      frame: function (step) {
        if (끝남) return;
        try { 그리기(step | 0); } catch (e) { 끝(); throw e; }
      },
      close: 끝
    };
  }
  return new Promise(function (done) {
    완료 = done;
    (function 프레임() {
      그리기(f);
      if (++f >= self.HIT_FRAMES) {
        // 0x463B9 대기 → 0x463D2 증가 → 0x463DC 종료 판정.
        // 마지막 장도 3틱 유지한다. 즉시 지우면 from0은 75가 아닌72틱에 끝난다.
        예약 = self._시간예약(끝, self.HIT_TICKS * TICK);
        return;
      }
      예약 = self._시간예약(프레임, self.HIT_TICKS * TICK); // 0x46378 — 3틱 간격
    })();
  });
};

/* ── 피격 밀림(흔들림) — `0x45ED2` 등록 + `0x45F29` 적용 ──────────────────
 *
 * 사용자 지적 2026-08-14: 「**말 탄 경우 흔들림 피격 판정**이 있어.」
 * 탈것 스프라이트(`.BCR` 32프레임)에는 피격 모션이 없어, 탄 유닛의 피격 반응은
 * 이 흔들림이 전부입니다. 도보 유닛도 모션 10 과 함께 같이 흔들립니다.
 *
 * **등록 `0x45ED2(bx = 슬롯, dl = 방향)`** — `0xF9C08 + 슬롯*6` 에 두 워드.
 * ```asm
 * 0x45ED7  eax = 슬롯 * 6                 ; shl 2 → sub → add self
 * 0x45EE0  [eax+0xF9C0A] = 0 ; [eax+0xF9C08] = 0
 * 0x45EEE  if (dl > 3) ret
 * 0x45EF9  jmp [edx*4 + 0x35EC2]
 *   0x45F01  방향 0 남 : dy = +5
 *   0x45F0B  방향 1 서 : dx = −6
 *   0x45F15  방향 2 북 : dy = −5
 *   0x45F1F  방향 3 동 : dx = +6
 * ```
 * 방향은 **공격자**의 `[+0x63]` 입니다 — `0x1E283 edx = [esi+0x60] sar 24`
 * (`[+0x60]` dword 의 최상위 바이트가 곧 `[+0x63]`).
 *
 * **적용 `0x45F29(ecx = 유닛, dx = 슬롯, bx = 프레임)`** — 반환 0 이면 끝.
 * ```asm
 * 0x45F9D  if (프레임 & 1) {                    ; ★ 홀수 프레임
 * 0x45FB2    ox -= vx ; oy -= vy                ;   한 번 밀고
 * 0x45FC4    vx 를 1 만큼 0 쪽으로 감쇠 (양수 dec · 음수 inc)
 * 0x45FF2    vy 도 마찬가지
 * 0x46020    ox -= vx ; oy -= vy                ;   감쇠된 값으로 또 한 번
 * 0x46037    if (vx == 0 && vy == 0) return 0   ;   둘 다 0 이면 끝
 *          } else {                             ; 짝수 프레임
 * 0x4605B    ox += vx * 2 ; oy += vy * 2        ;   되돌아온다
 *          }
 * 0x46078  0x1214F 피격 포즈 ; return 1
 * ```
 * 곧 **밀렸다 되돌아오기를 되풀이하면서 진폭이 1씩 줄어드는 진동**입니다.
 * 끝나면 `0x12124`(`poseRest`)가 오프셋을 0 으로 되돌립니다.
 *
 * @param {object} u    맞은 유닛
 * @param {number} dir  **맞은 쪽이 바라보는** 방향 (0 남 · 1 서 · 2 북 · 3 동).
 *                      적용부가 `sub` 라 **그 반대로** 밀린다 = 뒤로 자빠진다
 * @param {object} o    `{ from }` — 프레임 시작값 (평타는 1)
 */
/* 밀림 벡터 — `0x45F01`~`0x45F1F`. 값도 자리도 원본 그대로입니다.
 *   `0x45F01` 방향 0 남 : `+0x0A`(= `[+0x66]`, y) = **+5**
 *   `0x45F0B` 방향 1 서 : `+0x08`(= `[+0x65]`, x) = **−6**
 *   `0x45F15` 방향 2 북 : `+0x0A` = **−5**
 *   `0x45F1F` 방향 3 동 : `+0x08` = **+6**
 *
 * ★★ **방향은 「공격자·시전자가 바라보는 쪽」입니다.** 세 경로 모두 확정입니다 —
 *   평타 `0x1E283 mov edx,[esi+0x60] ; sar edx,0x18` (`esi` 는 `0x1E252` 로 공격자)
 *   마법 `0x28786 mov edx,[esi+0x60]` · 초필살기 `0x2CB62 mov edx,[ebp+0x60]`
 *
 *   적용부가 `sub` 라(`0x45FB8 sub [ecx+0x65], bl`) **바라보는 방향의 반대**로
 *   밀립니다. 사용자 확인 2026-08-14: 「일반 공격의 경우 **내가 바라보는 방향
 *   반대로 밀리는 게 맞고**」 — 「내가」가 공격자입니다. **원본 그대로입니다.**
 *
 *   참고 — 방향 규약(0 남 · 1 서 · 2 북 · 3 동)은 `0x49ABC` 로 확정입니다
 *   (`0x49ACF inc [edx]` y+1 남 · `0x49AD3 dec [eax]` x−1 서 ·
 *    `0x49AD7 dec [edx]` 북 · `0x49ADB inc [eax]` 동).
 *
 *   ★★★★★ **갈래-방향 배정이 확정됐다 (2026-08-29)** — 표는 **채워져 있었다.**
 *     ☠ 앞 기록이 표 주소를 `0x35EC2` 로 **한 자리 잘못** 적어
 *       엉뚱한 곳(BSS)을 보고 「EXE 안에 값이 없다」고 했다.
 *       실제 명령은 `0x45EF9  2e ff 24 95 c2 5e 04 00` = `jmp [edx*4 + **0x45EC2**]`.
 *     표(`0x45EC2`):
 *       | 방향 | 갈래 | 하는 일 |
 *       |---:|---|---|
 *       | 0 남 | `0x45F01` | `mov word [eax+0xA9C0A], **+5**` |
 *       | 1 서 | `0x45F0B` | `mov word [eax+0xA9C08], **−6**` |
 *       | 2 북 | `0x45F15` | `mov word [eax+0xA9C0A], **−5**` |
 *       | 3 동 | `0x45F1F` | `mov word [eax+0xA9C08], **+6**` |
 *     ⇒ 위에 적어 둔 순서와 **정확히 같다.** 화면과 맞았던 것이 우연이 아니었다.
 *
 *   ★ 초필살기도 이 밀림을 **씁니다** — `0x2CB8E call 0x287AF` 로 마법 숫자
 *     루프를 빌려 쓰고 그 안 `0x28802` 가 `0x45F29` 를 부릅니다.
 *     시전 중 좌우 흔들림(`ctx.shake` ← `0x3ADE1`/`0x3AE0B`)과는 **다른 것**이고,
 *     연출이 끝난 **뒤** 피해가 들어갈 때 한 번 돕니다. */
Renderer.prototype.KNOCK = [{ x: 0, y: 5 }, { x: -6, y: 0 },
                            { x: 0, y: -5 }, { x: 6, y: 0 }];   // 0x45F01~0x45F1F
/** 피격 유닛 빌보드에 방향별 흔들림 연출을 적용한다. */
Renderer.prototype.hitShake = function (u, dir, o) {
  o = o || {};
  if (!u) return Promise.resolve();
  var self = this, TICK = (root.G2Anim && root.G2Anim.TICK_MS) || 5.6987;
  var d = dir | 0;
  if (d < 0 || d > 3) return Promise.resolve();                 // 0x45EEE cmp dl,3 ; ja
  var v = { x: this.KNOCK[d].x, y: this.KNOCK[d].y };
  /** 1 만큼 0 쪽으로 — 0x45FCB~0x45FDF (양수 dec · 음수 inc · 0 은 그대로) */
  function 감쇠(n) { return n > 0 ? n - 1 : (n < 0 ? n + 1 : 0); }

  return new Promise(function (done) {
    var f = (o.from | 0), 예약 = null, 끝남 = false;
    function 끝() {
      if (끝남) return;
      끝남 = true;
      if (예약) self._시간취소(예약);
      u.ox = 0; u.oy = 0;
      self.updateUnit(u); self.snapUnit(u); self.apply();
      등록해제();
      done();
    }
    var 등록해제 = self._종료정리등록(끝);
    (function 프레임() {
      if (f & 1) {                                              // 0x45F9D
        u.ox = (u.ox | 0) - v.x; u.oy = (u.oy | 0) - v.y;        // 0x45FB2 · 0x45FBB
        v.x = 감쇠(v.x); v.y = 감쇠(v.y);                        // 0x45FC4 · 0x45FF2
        u.ox = (u.ox | 0) - v.x; u.oy = (u.oy | 0) - v.y;        // 0x46020 · 0x46029
        if (v.x === 0 && v.y === 0) {                            // 0x46037
          return 끝();                                            // 0x12124 이 되돌린다
        }
      } else {                                                   // 0x46051
        u.ox = (u.ox | 0) + v.x * 2; u.oy = (u.oy | 0) + v.y * 2;
      }
      /* ★ 보간을 태우지 않는다 — `snapUnit` 주석 참조 */
      self.updateUnit(u); self.snapUnit(u); self.apply();
      if (++f >= self.HIT_FRAMES) {                              // 0x463DC cmp bx,0x19
        return 끝();
      }
      예약 = self._시간예약(프레임, self.HIT_TICKS * TICK);      // 3틱 — 숫자와 같은 박자
    })();
  });
};

/** 옛 이름 — 호출부를 다 옮길 때까지 남겨 둔다. `text` 는 **표시값**이다. */
Renderer.prototype.floatingNumber = function (u, text, kind, ms) {
  if (!u) return null;
  if (kind === 'miss') return this.hitNumber(u, 0, { miss: true });
  return this.hitNumber(u, (parseInt(text, 10) || 0) * 100, {});
};

/* ── 카메라 ───────────────────────────────────────────────────────────── */
/*
 * ★ 링 커맨드가 잘리지 않게 하는 여백 (js/ring.js 의 (가))
 *
 * 원본 0x4AA42 는 화면 밖으로 나간 링 아이콘을 x 16~280 · y 4~172 로 **개별 클램프**
 * 합니다. 그래서 맵 끝에 선 캐릭터의 링은 한쪽이 눌려 원형이 찌그러집니다.
 * 원본 맵 배경에 테두리가 둘려 있는 것도, 카메라가 맵 끝까지 가도 캐릭터가 화면
 * 가장자리에 붙지 않도록 여백을 준 장치로 보입니다.
 * 맵 데이터 자체에도 좌우 2칸·상하 4칸은 유닛이 설 수 없는 제한이 있습니다(0x11F8C).
 *
 * 그래서 이 엔진은 **카메라를 맵 안에 가두지 않습니다.** center() 는 클램프가 없고,
 * 굳이 가둘 때 쓰는 centerClamped() 도 그 여백만큼은 맵 밖으로 나갈 수 있게 둡니다.
 * 링 쪽은 클램프 대신 링 전체를 평행이동합니다(G2Ring.Calc.safeCenter).
 */
Renderer.prototype.MARGIN = { x: 2 * TW, y: 4 * TH };   // 0x11F8C 와 같은 폭

/* ══════════ 좌표 창구 — `0x10971`(x) · `0x10988`(y) ═══════════════════════
 *
 * 사용자 지적(2026-08-13): 「애초에 캐릭터를 화면에 렌더할 때 그런 식으로
 * 불러오면 이후 계속 적용할 필요가 없어 보여. 하단뿐만 아니라 좌우 범위도
 * 정해 놓으면.」 — **원본이 정확히 그 구조다.**
 *
 * 타일 → 화면 좌표를 내는 함수는 원본에 딱 둘뿐이고, 그리는 쪽이 전부 그걸 부른다.
 * ```asm
 * 0x10971  ax −= [0xBA83C](카메라 타일x) ; imul 0x18 ; ax += [0x1C](흔들림) ; +4
 * 0x10988  ax −= [0xBA83E](카메라 타일y) ; shl 4     ; += [0xBA838](흔들림) ; +4
 * ```
 * 끝의 `+4` 는 **맵 뷰포트가 화면 (4,4) 부터 시작**한다는 뜻이다.
 *
 * 부르는 쪽과 각자의 덧셈:
 *
 * | 무엇 | 원본 | x 보정 | y 보정 |
 * |---|---|---|---|
 * | 유닛 그리기 앵커 | `0x12F2A` | **+12** (`0x12F3D add eax,0xC`) | **−2** (`0x12F52 sub eax,2`) |
 * | 머리 위 HP 숫자 | `0x13498` | **+2** (`0x134E9`) | **+6** (`0x134F6`), 비행이면 **−0x18** (`0x134FE`) |
 * | 대사창 타원 중심 | `0x482D9` | **+12** (`0x482E8`) | **+4** (`0x482F4`) |
 * | 피해 숫자 팝업 | `0x45C19` | 0 | **+10** (`0x45CA9`) |
 *
 * ★ **원본은 스프라이트 픽셀을 전혀 안 본다** — 전부 칸 좌표에서 나온다.
 *   유일한 예외가 HP 숫자의 비행 유닛 −24px 이고, 그것도 `[+0x14]` 비트일 뿐
 *   그림을 재서 정한 값이 아니다. 그래서 「투명 영역 때문에 어긋난다」는
 *   추측은 원본 기준으로는 원인이 아니다. 실제 원인은 우리 쪽에 있었다 —
 *   대사창이 `+4` 를 빼먹고 카메라 타일을 반올림하고 있었다(전투.html 참조).
 *
 * @param {object} u  유닛(또는 `{x, y}`)
 * @returns {{x:number, y:number}} **화면** 좌표(원본 320×200 기준, 뷰포트 +4 포함)
 */
Renderer.prototype.screenOf = function (u) {
  /* 우리 `cam` 은 「화면 중앙의 맵 픽셀」 하나로 들고 있다. 원본처럼 타일과
   * 픽셀 흔들림으로 쪼개지 않는다 — 그러니 **나누지 말고 그대로 뺀다.**
   * (나눠서 반올림하면 스크롤 중에 최대 12px 까지 튄다.) */
  /* ★★★★★ **뷰포트 `+4` 는 여기서 더한다** (2026-09-05 되돌림)
   *
   *   한때 이 `+4` 를 `mapOf` 로 옮겼다. 그러면 원본처럼 **모든 자리**가 +4 를
   *   받아 좋아 보였지만, 우리 **맵 타일은 `mapOf` 를 안 쓴다**
   *   (`render.js:1610` 등이 `x*TW`·`y*TH` 로 직접 놓는다). 그래서 유닛만
   *   4px 내려가 **맵과 어긋났다** — 사용자 지적 「동일한 맵 타일을 기준으로는
   *   우리 캐릭터가 더 아래에 있다」. ⇒ 원래대로 여기서만 더한다.
   *   ★ 화면 전체가 원본보다 4px 위인 것은 별개 항목이다(§맵 전체 이동). */
  var P = root.G2Projection;
  if (P && P.논리좌표)
    return P.논리좌표(this.cam, { TW: TW, TH: TH }, u);
  var m = this.mapOf(u); /* 독립 렌더러 하네스 호환 */
  return { x: m.x - (this.cam.cx - 320 / 2) + 4,
           y: m.y - (this.cam.cy - 200 / 2) + 4 };
};

/**
 * **맵 픽셀 좌표** — `world` 레이어 안에 놓는 것들이 쓴다.
 *
 * `world` 는 CSS 변환이 카메라를 대신하므로, 원본 식에서 **카메라와 뷰포트 +4 를
 * 뺀 것**이 곧 이 값이다. `screenOf` 와 값만 다르고 출처는 같은 `0x10971`/`0x10988`.
 *
 * 화면 평면 캔버스(대사창·HUD)는 `screenOf`, `world` 안(선택 상자·HP 숫자·피해
 * 숫자·유닛)은 `mapOf` — **이 둘 말고 좌표를 직접 계산하는 곳이 없어야 한다.**
 */
Renderer.prototype.mapOf = function (u) {
  /* ★★★★★ **원본의 뷰포트 `+4` 를 더한다** (2026-09-05 · 원본과 겹쳐 보고 잡았다)
   *
   *   > 사용자: 「가만히 서있을때 **우리 실행기가 더 많이 묻혀있어.**」
   *
   *   원본 `0x10971`(x) · `0x10988`(y) 은 화면 좌표에 **`+4`** 를 더한다
   *   (`0x10982`·`0x1099C add eax, 4`) — **뷰포트 여백**이다.
   *   ☠ 여기 `칸 × 24/16` 만 있었다. 주석에 「원본 식에서 카메라와 뷰포트 +4 를
   *     뺀 것」이라 적혀 있었지만, **그 +4 를 대신 넣어 주는 곳이 없었다** —
   *     `world` 층·조상 사슬을 전수로 봐도 `top:0 · transform:none` 이다.
   *
   *   실측 (칸 [16,33] · 카메라타일 [10,23] · `cam.cy` 468)
   *   ```
   *   mapOf.y 528 − (cam.cy − 100) 368 = 160      ← 칸 위
   *   우리 바닥 = 160 − 2 = 158
   *   원본 바닥 = 160 + 4 − 2 = 162               ★ 4px 어긋났다
   *   ```
   *   같은 유닛에 `screenOf` 는 **164**(= 160 + 4)로 원본과 정확히 같았다.
   *   곧 창구가 둘인데 **유닛만 `+4` 없는 쪽**을 쓰고 있었다.
   *
   *   ★ 맵 지면도 `+4` 가 없어 **맵과 유닛이 함께 4px 위**였다 — 서로의 관계는
   *     맞아서 여태 안 드러났고, **원본과 겹쳐 볼 때만** 보였다.
   *
   * ☠☠☠ **그래서 여기에 `+4` 를 넣었다가 되돌렸다** (2026-09-05 · 사용자 지적)
   *
   *   > 「**동일한 맵 타일을 기준으로는 우리 캐릭터가 더 아래에 있다**라는 거야.」
   *
   *   맵 타일은 `render.js:1610·1645·1664·3182·3313` 이 전부 `x*TW` · `y*TH` 로
   *   놓는다 — **`+4` 가 없다.** 유닛에만 넣으니 **유닛만 4px 내려가** 맵과 어긋났다.
   *   실측(`2-3.SCE` 칸 [13,27]) — `mapOf.y 436` ↔ 타일 기준 `432` 로 **4px 차이**.
   *   ⇒ 되돌린다. 맵과 유닛의 관계가 먼저다.
   *
   *   ★ 「화면 전체가 원본보다 4px 위」인 것은 **여전히 맞다.** 다만 그것은
   *     맵·유닛·이펙트를 **함께** 내려야 하는 별개 항목이다 —
   *     `groundLayer`(맵)와 `world`(유닛)는 형제이고 `apply()` 가 같은 변환을 준다.
   *     한쪽만 건드리면 이번처럼 어긋난다. */
  var P = root.G2Projection;
  return P && P.맵픽셀 ? P.맵픽셀({ TW: TW, TH: TH }, u)
                       : { x: (u.x | 0) * TW, y: (u.y | 0) * TH };
};

/**
 * **실제로 화면에 그려진 자리** — `world` 의 2.5D 변환을 거친 뒤의 좌표.
 *
 * ★★ `screenOf` 는 원본 식(평면 320×200)이다. 원본은 2D라 그게 곧 화면 위치지만,
 *   우리 `world` 는 기울기·회전·확대가 걸린 3D 레이어라 **같은 칸이라도 화면에서는
 *   다른 자리**에 보인다. 대사창은 평면 캔버스(HUD 와 같은 변환)에 그리므로,
 *   타원 중심을 `screenOf` 로 잡으면 캐릭터에서 벗어난다.
 *
 *   계측 결과(2026-08-13): `screenOf` 는 화자가 누구든 언제나 `(160, 104)` 를
 *   냈다 — 포커싱이 화자를 화면 중앙에 놓으니 **원본 기준으로는 정확**하다.
 *   그런데 화면에서는 캐릭터가 기울기 때문에 중앙에 안 보인다. 그래서
 *   「타원 뜨는 위치가 제각각」으로 보였다.
 *
 *   그래서 `world` 안에 **측정용 요소**를 하나 놓고 실제 rect 를 읽어, HUD 캔버스의
 *   320×200 좌표로 되돌린다. 원본 계산을 바꾸는 게 아니라 **원본 평면 좌표를
 *   우리 2.5D 화면으로 옮기는 변환**이다.
 *
 * @param {object} u  유닛
 * @param {number} [dx=0] @param {number} [dy=0]  맵 픽셀 기준 보정(예: 타원 +12,+4)
 * @returns {{x,y}|null}  못 재면 null (그때는 `screenOf` 로 물러난다)
 */
/**
 * ★★★★★ **탑승 전체 스프라이트의 정중앙** — 그리기 앵커 기준 오프셋 (2026-08-25 신설)
 *
 *   사용자 지적: 「탈 것 탑승후 링커맨드 센터링이 안맞아. 원작은 일반 캐릭터와
 *   동일하게 **캐릭터 정중앙**으로 포커싱이 돼. **탈 것 탑승한 전체 스프라이트를
 *   기준으로 정 중앙**에 들어가야해.」
 *
 *   링 중심은 지금까지 `screenOfRendered(u, 12, -2)` = **그리기 앵커**(0x12F2A)였다.
 *   일반 캐릭터는 앵커가 대략 몸통 한가운데 아래라 큰 차이가 없었는데,
 *   **탈것은 그림이 훨씬 커서** 앵커가 중앙에서 멀리 떨어진다 — 그래서 어긋났다.
 *
 *   `layersOf(u)` 의 **모든 층**(탈것 본체 + 탑승자)을 아우르는 합집합을 재서
 *   그 한가운데를 돌려준다. 층이 하나면 그 층의 중앙이므로 **일반 캐릭터도 같은 식**이다.
 *   (사용자가 말한 「일반 캐릭터와 동일하게」가 이 뜻이다.)
 *
 * @returns {{dx:number, dy:number}} 그리기 앵커(칸+12,-2)에서 중앙까지의 거리
 */
/**
 * ★★★★★ **맵 아이템(보물) 그리기** — 원본 `0x1862F` (2026-08-25 · 사용자 지적 11)
 *
 *   무엇을 그릴지는 `battle.mapItemLook(it)` 이 원본 규칙대로 정한다:
 *     조건 0 → `ITEM.SPR` 프레임 **코드−1** (아이콘) · 이미 먹었으면 안 그림
 *     조건 1 → `FLD_MISC.SYB` 0(닫힘) · 1(열림)   **나무상자**
 *     조건 2 → `FLD_MISC.SYB` 2 · 3               **금속상자**
 *     조건 3 → **안 그림**
 *
 *   ★ 유닛과 같은 **빌보드**로 세운다(CLAUDE.md 「눕히지 말고 세워서」).
 *     `FLD_MISC.SYB` 앵커는 실측 `(−12,−8)`·`(−12,−16)` 이라 **칸 가운데 아래**가
 *     기준이다 — 맵 픽셀 `(x*24+12, y*16+16)` 에 두면 칸에 정확히 앉는다.
 *
 *   ★★★ **2026-08-29 — 참조를 전수로 봤다. 둘은 같은 대역에서 그린다.**
 *     상자 `0xE4854` 7곳: `0x12698 0x12CE3 0x12D05 0x12DD2 0x12ED9 0x12EFB 0x18737`
 *     아이콘 `0x8B2E4` 6곳: `0x10D27 0x12A15 0x12C44 0x12DA0 0x12E3A 0x186DB`
 *     ⇒ 둘 다 **`0x12Axx`~`0x12Exx` 한 그리기 대역**에 섞여 있고,
 *       아이콘 쪽이 **먼저**(0x12A15 · 0x12C44) 나온다.
 *       곧 **층을 나누는 것이 아니라 같은 목록을 순서대로 훑는다**로 보인다.
 *   ☐ 그래도 `0x12567` 의 두 바퀴(위 §)와 어떻게 맞물리는지는 아직 —
 *     지금은 둘 다 `objLayer` 에 같은 방식으로 둔다.
 */
/** 원본 `0x1E460`: 장착 방패 ITEM.SPR 프레임을 공격 중 빌보드로 표시한다. */
Renderer.prototype.방패그리기 = function (u) {
  if (!u) return Promise.resolve(null);
  var self = this, key = String(u.id == null ? 'unit' : u.id);
  var code = ((u.gear || {}).shield | 0);
  var Item = root.G2Item, item = code > 0 && Item && Item.at ? Item.at(code) : null;
  if (!item || (item['종류'] | 0) !== 6) {
    var 이전 = this._방패요소 && this._방패요소[key];
    if (이전) this.dropFxSprite(이전);
    return Promise.resolve(null);
  }

  this._방패요소 = this._방패요소 || Object.create(null);
  var e = this._방패요소[key];
  if (!e || !e.parentNode) {
    e = this.fxSprite('', 'attack-between');
    e._shieldUnitId = key;
    e._kind = 'shield';
    this._방패요소[key] = e;
  }
  e._unit = u;
  e._칸x = u.x | 0; e._칸y = u.y | 0;
  if (!this._방패정리해제) {
    this._방패정리해제 = this._종료정리등록(function () {
      var 목록 = self._방패요소 || Object.create(null);
      Object.keys(목록).forEach(function (id) { self.dropFxSprite(목록[id]); });
      self._방패요소 = Object.create(null);
      self._방패정리해제 = null;
    });
  }
  return this._맵아이템그림(e, { file: 'ITEM.SPR', frame: code - 1, kind: 'shield' });
};

Renderer.prototype.syncMapItems = function (battle) {
  var self = this;
  this._itemEls = this._itemEls || {};
  if (!battle || !battle.mapItems) return this;
  battle.mapItems.forEach(function (it) {
    var look = battle.mapItemLook ? battle.mapItemLook(it) : null;
    var key = 'it' + it.idx;
    var e = self._itemEls[key];
    if (!look || look.kind === 'none' || look.frame < 0) {
      if (e && e.parentNode) { e.parentNode.removeChild(e); delete self._itemEls[key]; }
      return;
    }
    var 키2 = look.file + '#' + look.frame;
    if (e && (e._look === 키2 || e._대기 === 키2)) return;   /* 그대로거나 그리는 중이면 손대지 않는다 */
    if (e && e.parentNode) e.parentNode.removeChild(e);
    e = el('div', 'g2-map-item', self.objLayer);
    /* ★ `_look` 은 **그림이 실제로 붙은 뒤**에 세운다 — 팔레트가 아직 안 읽혔으면
     *   `_맵아이템그림` 이 그냥 돌아가는데, 여기서 미리 세워 두면 다음 `apply()` 가
     *   「그대로다」라고 판단해 **영영 안 그려진다.** */
    e._look = null; e._대기 = 키2;   /* 그리는 중 */
    e.style.cssText = 'position:absolute;image-rendering:' + rend() + ';pointer-events:none;' +
                      'transform-origin:50% 100%;';
    self._itemEls[key] = e;
    /* 그림은 비동기로 붙인다 — 원본 직독(`G2Native`) */
    /* ★★★★★ **세로 기준은 갈래마다 다르다** (2026-08-30 · 지적 A-3)
     *   그림을 읽어야 `h`·`ay` 를 알아 자리가 나온다 — 그래서
     *   **배치는 `_맵아이템그림` 안에서** 한다(아래 `자리잡기`).
     *   여기서는 그림이 오기 전 **가로만** 잡아 둔다. */
    e._칸x = it.x | 0; e._칸y = it.y | 0; e._kind = look.kind;
    /* ★ **아이콘은 눕히고 상자는 세운다** (2026-09-23 · 사장님 지정)
     *   `'floor'` 면 `_빌보드적용` 이 `transform:none` 으로 둬 지면에 눕는다.
     *   상자(`kind:'box'`)는 달지 않아 기본 빌보드로 선다. */
    e._billboardMode = (look.kind === 'icon') ? 'floor' : null;
    // apply 중 새 맵 아이템이 생겨도 기존 가림 목록에 넣어 해제 때 함께 복원한다.
    if (self._맵가림) self.맵가리기(true);
    self._맵아이템그림(e, look);
  });
  return this;
};

/** 팔레트가 바뀌면 맵 아이템(상자·아이콘)을 지금 팔레트로 다시 칠한다 — 만들 때 한 번만 칠하므로 (2026-09-25 사장님 「아이템 상자는 안덮히는데」 · 원본은 DAC 표 하나로 화면 전체가 같이 바뀐다) */
Renderer.prototype._맵아이템다시칠하기 = function () {
  var self = this, 칸 = this._itemEls; if (!칸) return;
  Object.keys(칸).forEach(function (k) {
    var ie = 칸[k]; if (!ie || !ie._look) return;
    var p = ie._look.split('#');
    self._맵아이템그림(ie, { file: p[0], frame: +p[1], kind: ie._kind });
  });
};
/** `ITEM.SPR` / `FLD_MISC.SYB` 한 프레임을 요소에 얹는다 — 원본 직독. */
Renderer.prototype._맵아이템그림 = function (e, look) {
  var self = this;
  var N = root.G2Native; if (!N) return Promise.resolve(null);
  this._itemSheets = this._itemSheets || {};
  var 캐시 = this._itemSheets;
  function 그리기(d) {
    var f = d && d.frames && d.frames[look.frame | 0];
    if (!f || !e.parentNode) { e._대기 = null; return null; }
    /* ★ 팔레트는 **유닛 것과 같은 것**을 쓴다 — .SPR/.SYB 에는 팔레트가 없다
     *   (그림자 0x2260 갈래와 같은 규칙: `_유닛팔레트()`). */
    var pal = (d && d.palette) || (self._유닛팔레트 ? self._유닛팔레트() : null);
    if (!pal) { e._대기 = null; return null; }           /* ★ 아직이면 대기를 풀어 다음 apply 때 다시 */
    var cv = N.frameToCanvas ? N.frameToCanvas({ w: f.w, h: f.h, idx: f.idx, tr: null }, pal) : null;
    if (!cv) { e._대기 = null; return null; }
    var w = cv['논리w'] || cv.width, h = cv['논리h'] || cv.height;   /* ★ 논리 크기 */
    e.style.width = w + 'px'; e.style.height = h + 'px';
    e.style.backgroundImage = 'url(' + cv.toDataURL() + ')';
    e.style.backgroundSize = w + 'px ' + h + 'px';
    e._look = look.file + '#' + look.frame; e._대기 = null;   /* ★ 붙고 나서 */
    /* 앵커를 더한 자리가 좌상단 — 유닛과 같은 규칙 */
    e.style.marginLeft = ((f.ax | 0)) + 'px';
    e.style.marginTop = ((f.ay | 0)) + 'px';
    /* ★★★★★ **자리잡기** — 원본 `0x1862F` 의 **두 식**을 그대로 (2026-08-30)
     *
     *   칸 → 화면:  x = (칸x−cam)×24 + … + 4   `0x10971`
     *              y = (칸y−cam)×16 + … + 4   `0x10988`
     *
     *   아이콘(`ITEM.SPR`)  `0x186BD`~`0x186E7`
     *     x = X + 12 + ax        y = Y + 16 − **h**
     *   상자(`FLD_MISC.SYB`) `0x18719`~`0x18734`
     *     x = X + **0**          y = Y + **ay + 6**   ← `+16` 을 **안 더한다**
     *
     *   ☠ 전에는 둘 다 `y*16+16` 에 `marginTop = ay` 만 붙였다 —
     *     아이콘은 `ay`(− 30 언저리)와 `h`(8~13)가 달라 **20 px 넘게 띄고**,
     *     상자는 **정확히 10 px** 내려갔다(지적 A-3).
     *   ★ `marginTop = ay` 는 그대로 두고 **기준점을 역으로 보정**한다:
     *     아이콘  ground = 칸y×16 + 16 − h − ay
     *     상자    ground = 칸y×16 + 6
     *   가로는 원본과 이미 같다 — 상자는 `ax` 가 전부 −12 라 `12 + ax = 0`. */
    var 칸x = e._칸x | 0, 칸y = e._칸y | 0;
    if (e._kind === 'shield') {
      var u = e._unit || {}, ox = u.ox | 0, oy = u.oy | 0;
      /* 0x1E460: 기준 x=칸x*24+16+ox, y=칸y*16+28+oy.
       * +24는 y 기준값에 포함되어 있으므로 CSS 여백으로 ITEM.SPR 축만 한 번 더한다. */
      var groundShield = 칸y * TH + 28 + oy;
      self._빌보드놓기(e, 칸x * TW + 16 + ox, groundShield, 0);
    } else {
      var ground = (e._kind === 'box')
            ? (칸y * TH + 6)                                  /* 0x18720 ay + 6 */
            : (칸y * TH + TH - (f.h | 0) - (f.ay | 0));        /* 0x186E7 −h */
      self._빌보드놓기(e, 칸x * TW + TW / 2, ground, 0);
    }
    self._빌보드적용(e);
    return e;
  }
  if (캐시[look.file]) return Promise.resolve(그리기(캐시[look.file]));
  var url = (typeof root.G2URL === 'function') ? root.G2URL(look.file) : ('/원본/' + look.file);
  return self._가져오기(url).then(function (r) { return r.arrayBuffer(); }).then(function (ab) {
    var u8 = new Uint8Array(ab);
    var d = /.SYB$/i.test(look.file) ? N.decodeSYB(u8) : N.decodeSPR(u8);
    /* [리마스터] 덧 아이템 아이콘(js/extitem.js · 코드 125~)을 ITEM.SPR 프레임 뒤에 끼운다 (2026-11-13) */
    if (/ITEM\.SPR$/i.test(look.file) && root.G2ExtItem && root.G2ExtItem.프레임끼우기) { try { root.G2ExtItem.프레임끼우기(d); } catch (e덧) {} }
    캐시[look.file] = d; return 그리기(d);
  }).catch(function () { e._대기 = null; return null; });
};

/** 현재 유닛 스프라이트의 논리 중심 보정값을 반환한다. */
Renderer.prototype.spriteCenterOffset = function (u) {
  var 층 = [];
  try { 층 = this.layersOf(u) || []; } catch (e) { 층 = []; }
  var x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (var i = 0; i < 층.length; i++) {
    var m = 층[i] && 층[i].meta; if (!m) continue;
    /* 층마다 방향·모션이 다를 수 있다 — 층이 들고 있으면 그것을 쓴다 */
    var rows = m['행'] || 4, cols = m['열'] || m['방향당프레임'] || 11;
    var dir = ((층[i].dir != null ? 층[i].dir : (u.dir | 0)) % rows + rows) % rows;
    var mo = Math.min(Math.max((층[i].motion != null ? 층[i].motion : (u.motion | 0)), 0), cols - 1);
    var fr = m['프레임'] && m['프레임'][dir * cols + mo];
    var ax, ay, w, h;
    if (fr && fr.w != null) { ax = fr.ax | 0; ay = fr.ay | 0; w = fr.w | 0; h = fr.h | 0; }
    else if (m['칸'] && m['기준점']) {
      ax = -(m['기준점'][0] | 0); ay = -(m['기준점'][1] | 0);
      w = m['칸'][0] | 0; h = m['칸'][1] | 0;
    } else continue;
    /* 층 자체 오프셋(탑승자를 안장 위로 올리는 등)이 있으면 더한다 */
    var lx = (층[i].ox | 0), ly = (층[i].oy | 0);
    if (ax + lx < x1) x1 = ax + lx;
    if (ay + ly < y1) y1 = ay + ly;
    if (ax + lx + w > x2) x2 = ax + lx + w;
    if (ay + ly + h > y2) y2 = ay + ly + h;
  }
  if (!isFinite(x1)) {
    /* 층을 못 재면 단층 메타로라도 */
    var f = null; try { f = this.frameMeta(u); } catch (e2) {}
    if (!f) return { dx: 0, dy: 0 };
    x1 = f.ax | 0; y1 = f.ay | 0; x2 = x1 + (f.w | 0); y2 = y1 + (f.h | 0);
  }
  return { dx: Math.round((x1 + x2) / 2), dy: Math.round((y1 + y2) / 2) };
};

/** 실제 그려진 유닛 자리를 논리 화면 좌표로 변환한다. */
Renderer.prototype.screenOfRendered = function (u, dx, dy) {
  var hud = root.G2Hud && root.G2Hud.hudCanvas && root.G2Hud.hudCanvas();
  if (!hud || !this.unitLayer || typeof hud.getBoundingClientRect !== 'function') return null;
  var h = hud.getBoundingClientRect();
  if (!(h.width > 0 && h.height > 0)) return null;

  var probe = this._probeEl;
  if (!probe || !probe.parentNode) {
    probe = this._probeEl = el('div', '', this.unitLayer);
    probe.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none;' +
                          'visibility:hidden;transform-origin:50% 100%;';
  }
  var m = this.mapOf(u);
  var lx = m.x + (dx | 0), gy = m.y + (dy | 0);
  /* 보간을 태우지 않는다 — 지금 이 자리를 재려는 것이다 */
  probe._pl = lx; probe._pg = gy;
  this._빌보드놓기(probe, lx, gy, 0);
  this._빌보드적용(probe);

  var r = probe.getBoundingClientRect();
  return { x: (r.left - h.left) * 320 / h.width,
           y: (r.top - h.top) * 200 / h.height };
};

/**
 * 유닛이 차지하는 사각형 — 좌·우·상·하 + 그리기 앵커. (「좌우 범위도 정해 놓으면」)
 * @param {object} u
 * @param {boolean} [화면]  true 면 화면 좌표, 기본은 맵 픽셀 좌표
 *
 * ★ 원본 기준이라 **프레임 헤더의 `w·h·ax·ay`** 를 쓴다 — 투명 픽셀을 재지 않는다.
 *   눈에 보이는 픽셀만으로 잡는 것은 원본에 없는 계산이라 리마스터 몫이다.
 */
Renderer.prototype.screenRect = function (u, 화면) {
  var s = 화면 ? this.screenOf(u) : this.mapOf(u), f = this.frameMeta(u);
  var ax = s.x + 12, ay = s.y - 2;                 // 0x12F3D · 0x12F52 그리기 앵커
  if (!f) return { x1: s.x, y1: s.y, x2: s.x + TW, y2: s.y + TH, ax: ax, ay: ay };
  return { x1: ax + (f.ax | 0), y1: ay + (f.ay | 0),
           x2: ax + (f.ax | 0) + (f.w | 0), y2: ay + (f.ay | 0) + (f.h | 0),
           ax: ax, ay: ay };
};

/**
 * 지정 전투 칸을 비추도록 카메라를 **즉시** 놓는다 (`0x1124A` 의 스크롤 없는 판).
 *
 * ☠☠☠★★★★★ **「칸 중심을 화면 중심에」가 아니다** (2026-09-15 · 사장님 지적)
 *
 *   > 사장님: 「애초부터 화면 비율이 미묘하게 달라. 우리 화면이 **가로로 약간 더
 *   >  길게 담는 것** 같아」 · 「좌표로 생각하면 안되고 **의미로 잡아야해**」
 *
 *   ☠ 여기서 `칸 × 24 + 12`(= 칸 **중심**)를 화면 한가운데에 두고 있었다.
 *     이 함수가 **전투를 세울 때(244행) 카메라를 정하는 자리**라, 그 뒤로 카메라가
 *     안 움직이는 판(마법 시전 등)에서는 이 값이 그대로 화면이 된다.
 *     실측 — 원본 GIF 와 겹치면 147칸이 하나같이 `−14, −1` 어긋났다.
 *
 *   원본은 카메라를 **좌상단 칸**으로 관리한다 —
 *     `0x11277`·`0x11281  sub 6`  ⇒ 좌상단 = 대상 − 6 (= `CAM_TILES / 2`)
 *   그 12×12 창을 논리 화면 한가운데 놓으므로(`camPixelOf` 주석), 대상 칸의
 *   **왼쪽 모서리**가 화면 160, 곧 칸 중심은 172 다. 우리는 중심을 160 에 뒀다.
 *
 *   ⇒ `camClamp` + `camPixelOf` 로 보낸다 — 식은 `camPixelOf` **한 곳**에만 있고,
 *     여백을 `(논리화면 − 창칸수 × 타일)/2` 로 스스로 구하므로 **해상도가 바뀌어도
 *     따라간다.**
 */
Renderer.prototype.center = function (tx, ty) {
  this._centerToken = (this._centerToken | 0) + 1;
  var c = this.camClamp((tx | 0) - (this.CAM_TILES >> 1), (ty | 0) - (this.CAM_TILES >> 1));
  var p = this.camPixelOf(c);                       // 0x1124A → 0x11003
  this.cam.cx = p.cx; this.cam.cy = p.cy;
};

/* ══════════════ 원본 카메라 — 좌상단 타일 기준 (0x11003 · 0x111BE) ══════
 *
 * 원본은 카메라를 **좌상단 타일**로 관리합니다.
 *   word[0xBA83C] = 카메라 X · word[0xBA83E] = 카메라 Y
 *   word[0xBA844] = 맵 폭    · word[0xBA840] = 맵 높이
 *
 * 대상을 「비출」 때는 **대상 − 6**을 좌상단으로 삼고 맵 안에 가둡니다.
 *   0x11277/0x11281  sub 6      (0x1124A 카메라 맞춤)
 *   0x529B7/0x529C0  sub 6      (0x0F 모드 3 유닛 중심)
 *   0x11023/0x11048  맵크기 − 0xC(12) 가 상한, 하한은 0
 * 화면이 320×200 = 13.3×12.5칸이라 6칸 안쪽이 「가운데」입니다.
 *
 * ★ `0x0F` 모드 0·1 의 좌표는 **이미 좌상단**입니다 — 6을 빼면 안 됩니다.
 *   0x50339 모드 1 이 그 값을 그대로 0x454B3(카메라 좌상단 인자)에 넘깁니다.
 *   (2-4A 4턴 `m1 35,18` → 화면 x35~48 이 적 시작 자리 x37~49 와 맞습니다)
 * -------------------------------------------------------------------- */
Renderer.prototype.CAM_TILES = 12;                    // 0x11003  sub 0xC

/** 맵 크기(타일). mapW/mapH 는 픽셀입니다. */
Renderer.prototype.tilesW = function () { return Math.round(this.mapW / TW); };
/** 현재 맵 논리 높이를 타일 행 수로 반환한다. */
Renderer.prototype.tilesH = function () { return Math.round(this.mapH / TH); };

/** 0x11003 — 좌상단 타일을 맵 안에 가둡니다. */
Renderer.prototype.camClamp = function (cx, cy) {
  var N = this.CAM_TILES;
  return { x: Math.max(0, Math.min(this.tilesW() - N, cx | 0)),
           y: Math.max(0, Math.min(this.tilesH() - N, cy | 0)) };
};

/** 좌상단 타일 → 우리 카메라(화면 중심의 맵 픽셀). */
Renderer.prototype.cameraTo = function (cx, cy) {
  var c = this.camClamp(cx, cy);
  this._centerToken = (this._centerToken | 0) + 1;
  /* ☠☠☠★★★★★ **화면 여백 — 좌상단 칸은 (16, 4) 에 놓인다** (2026-09-15 · EXE 직독)
   *
   *   > 사장님: 「애초부터 **화면 비율이 미묘하게 달라**. 우리 화면이 가로로 약간 더
   *   >  길게 담는 것 같아」
   *
   *   실측 — 원본 GIF 와 우리 GIF 를 겹치면 **147칸이 하나같이** 가로 `−14`·세로 `−1`
   *   만큼 어긋났다(그냥 겹치면 23.5%, 밀어서 맞추면 94.7%). 띠마다 재도 같은 값이라
   *   **배율 차이가 아니라 순수 평행이동**이다.
   *
   *   원본의 칸 → 화면 변환 (`0x10971` · `0x10988` 직독) —
   *   ```asm
   *   0x10971  sub ax, [0xba83c]     ; 칸x − 카메라좌상단x
   *   0x10978  imul eax, 0x18        ; × 24
   *   0x1097B  add ax, [0x7001c]     ; ★ + 12   (EXE 값 = 12)
   *   0x10982  add eax, 4            ; ★ + 4    ⇒ 합쳐서 **+16**
   *   ---
   *   0x10989  sub ax, [0xba83e]     ; 칸y − 카메라좌상단y
   *   0x10997  shl eax, 4            ; × 16
   *   0x1099A  add eax, [0xba838]    ; ★ + 0    (EXE 값 = 0)
   *   0x1099C  add eax, 4            ; ★ + 4    ⇒ 합쳐서 **+4**
   *   ```
   *   곧 원본 화면에는 **왼쪽 16px · 위 4px 여백**이 있고 맵은 그 안쪽부터 그려진다.
   *   우리는 여백 없이 `0, 0` 부터 그려서 그만큼 왼쪽·위로 밀려 있었다.
   *
   *   ☠☠★★★★★ **그 16·4 를 «숫자»로 박으면 안 된다** (2026-09-15 · 사장님 지적)
   *
   *   > 사장님: 「**좌표로 생각하면 안되고 의미로 잡아야해.** 우리 나중에 **해상도 변경**도
   *   >  가능해야하는데 저런식이어도 가능해?」
   *
   *   두 값을 풀어 보면 마법의 상수가 아니다 —
   *   ```
   *     가로  (320 − 12칸 × 24) / 2 = (320 − 288) / 2 = 16   = [0x7001c] 12 + 4
   *     세로  (200 − 12칸 × 16) / 2 = (200 − 192) / 2 =  4   = [0xba838]  0 + 4
   *   ```
   *   ⇒ 뜻은 **「카메라 창(`CAM_TILES`×`CAM_TILES` 칸)을 논리 화면 한가운데 놓는다」**.
   *     칸 크기나 논리 화면이 달라져도 이 식이 스스로 따라간다.
   *   ★ 논리 화면은 **원본 320×200**(`좌표상수.논리화면가로/세로`)을 쓴다 —
   *     창을 넓혀 늘어난 폭(`hud.js` 의 `logicalW`)은 리마스터가 덧댄 것이라
   *     원본 맵 창의 자리를 바꾸면 안 된다. 늘어난 좌우는 `cx` 가 따로 민다. */
  var p = this.camPixelOf(c);
  this.cam.cx = p.cx; this.cam.cy = p.cy;
  return c;
};

/**
 * ★ **좌상단 칸 → 카메라 픽셀** — 이 식은 **여기 한 곳**에만 둔다.
 *
 *   예전에는 `c.x * TW + 320/2` 가 **세 군데에 복사**돼 있어서 한 곳만 고치면
 *   나머지가 옛 자리로 되돌려 놓았다(실측 — `cameraTo` 만 고쳤더니 밀기가 안 변했다).
 *
 *   여백의 뜻은 위 `cameraTo` 주석 참조 — 「카메라 창을 논리 화면 한가운데」.
 */
Renderer.prototype.camPixelOf = function (c) {
  var 여백X = (좌표상수.논리화면가로 - this.CAM_TILES * TW) / 2;   // 0x1097B + 0x10982
  var 여백Y = (좌표상수.논리화면세로 - this.CAM_TILES * TH) / 2;   // 0x1099A + 0x1099C
  return { cx: c.x * TW + 좌표상수.논리화면가로 / 2 - 여백X,
           cy: c.y * TH + 좌표상수.논리화면세로 / 2 - 여백Y };
};

/** 0x1124A — 대상 타일을 비춥니다 (좌상단 = 대상 − 6). */
Renderer.prototype.focusTile = function (tx, ty) {
  return this.cameraTo((tx | 0) - 6, (ty | 0) - 6);
};

/**
 * 0x50339 모드 0 — 좌상단 타일까지 **등속 스크롤**.
 *
 * 단계값 정규화 (0x5035E~0x5036F):  0 → 1 · 3 → 8 · 그 밖 → ×2
 *
 * ★ **한 프레임 이동량 = 정규화값 `n` 픽셀** — 가로·세로가 같습니다.
 * ```
 *   0x50434/0x5043C  eax = ±cl        ; 목표가 현재보다 작으면 −
 *   0x50440          [0xA0580] = ax   ; X 프레임당 이동량
 *   0x50453/0x5045B  eax = ±cl
 *   0x5045F          [0xA057E] = ax   ; Y 프레임당 이동량
 * ```
 * ※ 예전 주석의 「가로 24/n · 세로 16/n」은 **오독**이었습니다. `0x5039F`
 *   (`eax=0x18`)·`0x503EE`(`eax=0x10`)가 있는 자리는 프레임당 이동량이 아니라
 *   `[0xA0584]`/`[0xA0582]` = **남은 총 이동량**(|Δ타일| × 24/n · 16/n)을
 *   구하는 곳입니다. 그 값을 쓰면 카메라가 원작보다 느려집니다 —
 *   step 3 이면 3px/2px 로 유닛(4px)보다 뒤처졌습니다. 원본은 8px 입니다.
 *
 * 프레임 간격은 걷기와 같은 5틱이라, 유닛(4px/프레임)과 견주면
 * step 3 → 8px 로 **카메라가 조금 빠르고**, step 2 → 4px 로 같습니다.
 */
Renderer.prototype.cameraScroll = function (cx, cy, step) {
  var c = this.camClamp(cx, cy);
  /* 0x52A2C — 스크롤이 아직 남아 있으면(`[0xA0584]`/`[0xA0582]` != 0) 새 스크롤을
   * 곧바로 걸지 않고 **0x52A48 이 16칸 링버퍼에 쌓아 두었다가 나중에** 처리합니다.
   *     0x52A57 모드 · 0x52A66 X · 0x52A73 Y · 0x52A83 step
   *     0x52A93 `idiv 0x10` → 인덱스 순환
   * 여기서는 큐 한 칸만 두고 진행 중이면 미룹니다(연속 명령이 목표를 덮어써
   * 왔다 갔다 누적되는 것을 막는 것이 이 구조의 목적입니다). */
  /* ★★★★★ **조건이 `and` 다 — `or` 가 아니다** (2026-08-28 · 원본 재직독)
   *
   *   > 사용자: 「**위 킬러 2명 등장후 카메라 위로 이동 없어야** 한다니까 …
   *   >  카메라가 **바로 내려가야하는데 올라갔다가 내려온다고**」
   *
   *   ```asm
   *   0x52A2C  cmp [0xA0584], 0 ; je 0x52B24   ; ★ X 남은 프레임이 0 이면 → **바로 건다**
   *   0x52A3A  cmp [0xA0582], 0 ; je 0x52B24   ; ★ Y 남은 프레임이 0 이면 → **바로 건다**
   *   0x52A48  …                                ;   둘 **다** 남아 있을 때만 큐에 쌓는다
   *   ```
   *   ☠ 우리는 `fx > 0 || fy > 0` 이라 **하나만 남아도 큐로 밀었다.**
   *     실측(1-5 · 셸) — `cameraScroll(50,41,2)` 이 위로 올라가는 중에
   *     `cameraScroll(49,50,2)`(아래)가 와서 **큐로 밀렸고**, 위로 가던 것이
   *     **끝까지 다 간 뒤에야** 아래로 내려갔다. 그것이 「올라갔다가 내려온다」다.
   *     20.6초 위로 시작 → 21.9초 아래 명령이 큐로 → **23.5초에야** 아래로.
   *
   *   ⇒ `&&` 로 고친다. 한 축이 끝나 있으면 **새 명령이 곧바로 이긴다.** */
  if (this._evCam && (((this._evCam.fx | 0) > 0) && ((this._evCam.fy | 0) > 0))) {
    this._camQueue = { cx: cx, cy: cy, step: step };
    return c;
  }
  /* ★ 여기는 센터링 설정을 **보지 않습니다**.
   *
   *   설정(즉시/부드럽게)은 「다른 캐릭터로 **전환**」할 때의 이야기입니다.
   *   이 스크롤은 전환이 아니라 **걸어가는 유닛을 따라가는** 것이고,
   *   원본도 0x50339 모드 0 에서 단계값에 따른 등속으로 함께 흐릅니다
   *   (바로 뒤에 오는 0x05 이동과 나란히 갑니다).
   *   즉시로 끊으면 유닛은 걷는데 카메라만 순간이동해 어색합니다. */
  var n = (step | 0) === 0 ? 1 : ((step | 0) === 3 ? 8 : (step | 0) * 2);
  /* ★★ 예전엔 여기서 자체 `setInterval(28.5ms)` 을 돌렸습니다. 유닛 걷기는
   *   `setTimeout` 체인(같은 28.5ms)이라 **위상이 정렬되지 않고 서서히 어긋나**,
   *   어떤 프레임엔 유닛만·다음엔 카메라만 움직였습니다. 화면상 상대 위치
   *   (유닛 − 카메라)가 앞뒤로 진동해 **가다 멈췄다 하는 흔들림**으로 보였습니다
   *   (가로 이동이면 좌우로, 세로 이동이면 위아래로).
   *
   *   원본은 유닛 이동과 카메라 스크롤이 **같은 프레임 루프** 안에서 함께
   *   갱신됩니다(0x50339 스크롤 ↔ 0x5E9E8 화면 갱신). 그래서 우리도
   *   목표·속도만 여기 적어 두고, **한 시계**(전투.html 의 게임 프레임 시계)가
   *   `stepCamScroll()` 로 굴립니다. */
  /* ★★ 원본은 **목표까지 가는 게 아니라 「정해진 프레임 수」만큼만** 갑니다.
   *   0x503B8 · 0x50407 이 남은 프레임 수를 이렇게 잡습니다(정수 나눗셈).
   *       X 프레임 수 = |Δ타일X| × (24 / n)
   *       Y 프레임 수 = |Δ타일Y| × (16 / n)
   *   그리고 0x5061F 가 프레임마다 하나씩 깎습니다.
   *
   *   n 이 24 보다 크면 `24/n` 이 **0** 이라 X 는 아예 안 움직입니다(Y 는 16 기준).
   *   목표까지 가도록 만들면 그 경우 카메라가 훅 날아가 화면을 벗어납니다 —
   *   실제로 그렇게 보였습니다. 원본대로 프레임 수만 세고 멈춥니다. */
  this._이벤트카메라목표설정(c, n);
  return c;
};

/**
 * ★★★★★ **`op 0F` 전용 스크롤 슬롯** — 포커스와 자리를 나눈다 (2026-08-27)
 *
 *   > 사용자: 「원작기준 **이벤트 대사가 먼저 → 카메라이동과 캐릭터 이동**인데,
 *   >  우리는 카메라이동 → 이벤트대사 → 캐릭터 이동이야.」
 *
 *   전에는 `op 0F`(`0x50339`)와 대사 화자 포커스(`0x1124A`)가 `_camTo` **한 칸**을
 *   같이 썼다. 그래서 대사가 뜨면 포커스가 `op 0F` 목표를 **통째로 지웠고**,
 *   이어지는 `op 0x05` 이동에서 카메라가 안 흘렀다
 *   (실측 1-4: 유닛이 18.8초부터 걷는데 cam 이 `352,692` 에 고정).
 *
 *   원본은 **저장소가 둘**이다 —
 *
 *     0x11255  eax = 8 ; si = [0x1E] ; di = [0x20]   ; ★ 포커스는 스크롤 속도를
 *     0x11268  call 0x10D9A                          ;   **저장했다 되돌린다**
 *     0x11003  …                                     ;   카메라 좌표 [0xBA83C] 직접
 *     0x50339  [0xA0584]/[0xA0582] 남은 이동량        ; ★ op 0F 는 자기 카운터
 *              [0xA0580]/[0xA057E] 프레임당 이동량
 *     0x52A48  16칸 링버퍼                            ;   밀린 명령을 쌓아 둔다
 *
 *   포커스가 속도를 **일부러 저장·복원**한다는 것이 곧 「`op 0F` 의 상태를
 *   건드리지 않는다」는 뜻이다. 그래서 포커스가 끝나면 `op 0F` 는 **새 자리에서**
 *   남은 프레임을 이어 굴린다 — 목표가 아니라 **프레임 수**를 세기 때문이다.
 *
 *   ★ `_flushCamDone()` 을 부르지 않는다. 그 약속은 **포커스 도착**을 기다리는
 *     대사창의 것이라 `op 0F` 가 풀면 안 된다.
 *
 * @param {{x:number,y:number}} c  이미 클램프한 좌상단 타일
 * @param {number} n  프레임당 픽셀
 */
Renderer.prototype._이벤트카메라목표설정 = function (c, n) {
  /* ★★★★★ **진행 중인 포커스 애니메이션을 먼저 죽인다** (2026-08-28)
   *
   *   `op 0F` 가 카메라를 맡는 순간, 앞서 걸린 「부드러운 화자 포커스」(`camTo`)가
   *   살아 있으면 **둘이 같은 `cam.cy` 를 두고 싸운다.** 실측에서 `op 0F` 가
   *   `cy 820` 까지 내려간 뒤 그 애니메이션이 `820 → 808` 로 **되밀었다.**
   *   원본에는 그런 겹침이 없다 — 포커스(`0x11003`)는 즉시 끝나기 때문이다.
   *   `_centerToken` 을 올리면 `camTo` 의 `frame()` 이 다음 프레임에 스스로 물러난다. */
  this._centerToken = (this._centerToken | 0) + 1;
  this._camAnim = false;
  /* ☠★★★★★ **지금 칸을 되계산하는 원점은 `camPixelOf({0,0})` 이다** (2026-09-22)
   *
   *   > 사장님: 「2-1 시나리오 시작시 **그대로 아래로 내려와야** 하는데
   *   >  우리는 **우측으로 이동한 다음에 내려와**」
   *
   *   여기만 **옛 화면 중심값 `160`·`100`** 으로 되계산하고 있었다. 2026-09-15 에
   *   **좌상단 칸을 (16, 4) 에 놓는다**고 확정했으므로(`cameraTo` 주석 · EXE 직독)
   *   원점은 `(160−16, 100−4) = (144, 96)` 이다. 옛 값으로 나누면 한 칸이 밀린다 —
   *   실측 2-1: `cam.cx = 192` 는 **칸 2**(목표와 같은 열)인데 `(192−160)/24 = 1.33`
   *   → 반올림 **1** 이라 `Δx = 1` 이 생겨 **오른쪽으로 한 칸 간 뒤** 내려왔다.
   *   ★ 형제 함수 `_포커스카메라목표설정` 은 이미 `camPixelOf({0,0})` 을 쓴다 —
   *     두 자리가 같은 원점을 봐야 한다. */
  var _영 = this.camPixelOf({ x: 0, y: 0 });
  var curX = Math.round((this.cam.cx - _영.cx) / TW), curY = Math.round((this.cam.cy - _영.cy) / TH);
  var dxT = c.x - curX, dyT = c.y - curY;
  this._evCam = { vx: (dxT < 0 ? -n : n), vy: (dyT < 0 ? -n : n),
                  fx: Math.abs(dxT) * Math.floor(TW / n),    // 0x503B8  |Δ| × (24/n)
                  fy: Math.abs(dyT) * Math.floor(TH / n) };  // 0x50407  |Δ| × (16/n)
  return this._evCam;
};

/** `op 0F` mode 1(즉시)이 오면 진행 중인 스크롤을 **대체**한다 — 원본도 같은 표를 덮는다 (0x52A57) */
Renderer.prototype.이벤트스크롤취소 = function () {
  this._evCam = null; this._camQueue = null;
  return this;
};

/**
 * 스크롤 목표를 세웁니다 — `cameraScroll`(0x50339 모드 0)과
 * `focusScroll`(0x1124A → 0x11003)이 함께 쓰는 자리입니다.
 * @param {{x:number,y:number}} c  이미 클램프한 **좌상단 타일**
 * @param {number} n  프레임당 픽셀
 */
/**
 * @param {{x,y}} c    이미 클램프한 좌상단 타일
 * @param {number} n   프레임당 픽셀
 * @param {boolean} [정확히]  true 면 **목표에 정확히 닿게** 한다 (`focusScroll` 전용)
 *
 * ★★ 원본에서 이 둘은 **다른 함수**다. 우리가 한 곳으로 합쳐 놨을 뿐이다.
 *
 *   `cameraScroll` = `0x50339`(이벤트 따라가기). 프레임 수 `0x503B8`
 *      `|Δ타일| × floor(24 / n)` — **n 이 24 를 넘으면 0 이라 X 가 아예 안 움직인다.**
 *      원본 그대로 둬야 한다(목표까지 가게 만들면 카메라가 훅 날아간다).
 *
 *   `focusScroll` = `0x1124A` → `0x11003`. 프레임 수 `0x11074` 는 같은 식이지만,
 *      `0x11255 eax = 8` 이 **속도를 8 로 못 박아** 언제나 `24/8 = 3` 이다.
 *      그래서 n>24 갈래가 애초에 없다.
 *
 * ★ 그리고 `정확히` 가 필요한 이유 (2026-08-13, 「타원 뜨는 위치가 제각각」):
 *   예전엔 둘 다 `curX = Math.round((cam.cx − 160) / 24)` 로 **타일로 나눠 반올림**
 *   했다. 원본이 그래도 되는 건 **원본 카메라가 늘 타일 경계에 정렬**돼 있기
 *   때문이다(스크롤이 전부 8px 단위이고 8은 24·16 의 약수).
 *   우리는 `camTo`(리마스터 부드러운 센터링)가 **임의 픽셀**로 옮기므로 정렬이
 *   깨진다. 그러면 반올림 탓에 스크롤이 끝나도 목표에서 **0~11px 어긋난 채**
 *   멈추고, 그 오차가 매번 달라 도착 뒤에 재는 타원 중심이 제각각이 된다.
 *   원본 `0x1110A` 도 실은 픽셀 오프셋을 직접 ±n 씩 굴리는 **픽셀 이동**이므로,
 *   목표 픽셀까지 세는 쪽이 오히려 원본에 가깝다.
 */
Renderer.prototype._포커스카메라목표설정 = function (c, n, 정확히) {
  this._카메라대기해제();                 /* 앞의 스크롤을 기다리던 약속은 여기서 풀어 줍니다 */
  var t;
  if (정확히) {
    var _mp = this.camPixelOf(c);
    var 목표X = _mp.cx, 목표Y = _mp.cy;   /* 여백은 camPixelOf 한 곳에 */
    var dpx = 목표X - this.cam.cx, dpy = 목표Y - this.cam.cy;
    t = { vx: (dpx < 0 ? -n : n), vy: (dpy < 0 ? -n : n),
          fx: Math.ceil(Math.abs(dpx) / n), fy: Math.ceil(Math.abs(dpy) / n),
          tx: 목표X, ty: 목표Y };          /* 마지막 칸에서 정확히 맞춘다 */
  } else {
    /* ★ 픽셀 → 좌상단 칸 — `camPixelOf` 의 역이다. 여백을 빼고 되돌린다. */
    var _영 = this.camPixelOf({ x: 0, y: 0 });
    var curX = Math.round((this.cam.cx - _영.cx) / TW), curY = Math.round((this.cam.cy - _영.cy) / TH);
    var dxT = c.x - curX, dyT = c.y - curY;
    t = { vx: (dxT < 0 ? -n : n), vy: (dyT < 0 ? -n : n),
          fx: Math.abs(dxT) * Math.floor(TW / n),    // 0x503B8  |Δ| × (24/n)
          fy: Math.abs(dyT) * Math.floor(TH / n) };  // 0x50407  |Δ| × (16/n)
  }
  /* ★ 이 자리는 이제 **포커스(0x1124A) 전용**이다. `op 0F` 는 `_evCamTo` 로 갔다
   *   (2026-08-27 — 슬롯을 나눠 1-4 「대사 → 카메라+이동」 순서를 맞췄다). */
  this._camTo = t;
  this._centerToken = (this._centerToken | 0) + 1;
  this._camScrolling = true;              /* [0x110584]/[0x110582] 에 해당 */
  return t;
};

/**
 * ★★★★★ **돌고 있는 카메라 움직임을 «앉힌다»** — 원본 포커스가 블로킹이라
 *   (2026-09-23 · 사장님 지적 A-2)
 *
 *   > 사장님: 「**적 이동시**에도 아군처럼 카메라가 따라가야하는데 우리는
 *   >  **적 위치에서 카메라가 멈추고 캐릭터만 이동**해.」
 *
 *   ☠ 원본 `0x11003` 은 **자기 프레임 루프를 도는 블로킹 스크롤**이다. 곧 걷기가
 *     시작될 때는 스크롤이 **이미 끝나 있다.** 우리는 rAF 로 굴리므로 **겹친다** —
 *     그래서 걷기 앞의 자리 맞춤(`focusTile`)이 「스크롤 도는 중」이라고 건너뛰어졌고,
 *     카메라가 엉뚱한 자리에 남아 `유닛칸 − 카메라 == 6`(`0x15EC8`)이 내내 안 맞았다.
 *     실측(3-3 · 미카엘 4칸) — 따라간 걸음 **0/4**, `d = 6,5 → 6,4 → 6,3` 으로 어긋났다.
 *
 *   ⇒ 「스크롤이 끝난 상태」를 만든다 — 목표가 있으면 **그 자리로 바로 옮기고** 끝낸다.
 *     목표를 모르면(`tx` 없음 · `op 0F` 꼴) 그냥 멈춘다. 기다리던 약속도 푼다.
 *   ★ **이벤트 카메라(`_evCam`)는 안 건드린다** — 그쪽은 `op 0F` 소유다.
 *
 * @returns {boolean} 끝낸 것이 있었나
 */
Renderer.prototype['카메라앉히기'] = function () {
  var 있었나 = false;
  /* ① 포커스 스크롤(`0x1124A`) — 목표가 있으면 **그 자리로 바로** 옮기고 끝낸다 */
  var t = this._camTo;
  if (t) {
    if (t.tx != null) { this.cam.cx = t.tx; this.cam.cy = t.ty; }
    this._camTo = null;
    있었나 = true;
  }
  if (this._camScrolling) { this._camScrolling = false; 있었나 = true; }
  /* ② 부드러운 센터링(`_camAnim`) — **다른 갈래다**(`camTo` 의 rAF 보간).
   *   ☠ 이것을 안 끄면 `카메라이동중인가()` 가 계속 참이라 걷기 추종이 죽는다 —
   *     실측(3-3 · 미카엘) 첫 걸음이 `막힘[포커스0 보간1 이벤트0]` 이었다.
   *   ★ 돌던 프레임은 `_centerToken` 이 바뀌면 **스스로 물러난다**(7283줄). */
  if (this._camAnim) {
    this._centerToken = (this._centerToken | 0) + 1;
    this._camAnim = false;
    있었나 = true;
  }
  if (있었나) { this.clampCamera(); this._카메라대기해제(); }
  return 있었나;
};

/** 스크롤 도착을 기다리던 약속들을 풉니다 (밀려서 취소돼도 풉니다 — 연출이 멈추지 않게). */
Renderer.prototype._카메라대기해제 = function () {
  var w = this._camDone; if (!w || !w.length) return;
  this._camDone = [];
  for (var i = 0; i < w.length; i++) w[i]();
};

/**
 * `0x1124A` — 대사창이 화자를 비추는 카메라. **즉시 이동이 아니라 스크롤**입니다.
 *
 * ```asm
 * 0x11255  eax = 8 ; si = [0x1E] ; di = [0x20]   ; 지금 스크롤 속도를 저장하고
 * 0x11268  call 0x10D9A                          ; [0x1E] = [0x20] = 8   ← 포커싱 전용 속도
 * 0x1126D  cmp [0x8DAEA], 0
 * 0x11275  jne → 0x111BE(x, y)                   ; 즉시 설정 + 0x454B3 다시 그리기
 *          je  → 0x11003(x−6, y−6)               ; ★ 8px/프레임 등속 스크롤
 * 0x112E7  [0x1E] = si ; [0x20] = di             ; 속도 복원
 * ```
 * `0x11003` 은 클램프만 하는 함수가 아니라 **스크롤 루프**입니다.
 * ```asm
 * 0x11074  eax = 0x18 ; idiv [0x1E] ; esi = |Δ타일X| × (24/8)   ; X 프레임 수
 * 0x110A8  eax = 0x10 ; idiv [0x20] ; edi = |Δ타일Y| × (16/8)   ; Y 프레임 수
 * 0x1110A  루프: [0x1C] += ±[0x1E] · [0xBA838] += ±[0x20] (24·16 넘으면 타일 한 칸)
 * 0x111AC       call 0x45577(카메라X, 카메라Y)                   ; 맵 그리기 + 화면 갱신
 * ```
 *
 * `[0x8DAEA]` 는 **GAME.CFG 첫 바이트**입니다 — `0x4FE8F` 가 거기로 읽고
 * `0x4FE9C` 가 0 이면 기본 스크롤 속도 4px, 아니면 8px 로 잡습니다(`0x10D9A`).
 * 옵션 화면 `0x4E3A8` 이 0↔1 로 토글합니다. **출하본 첫 바이트는 0** 이라
 * 원작은 화자에게 스르륵 밀려간 **뒤에** 대사창이 뜹니다.
 *
 * @param {number} tx,ty  화자 타일 (좌상단 = −6, 0x11277/0x11281)
 * @param {number} [px]   프레임당 픽셀 (기본 8 — 0x11255)
 * @returns {Promise} 도착하면 resolve.
 */
Renderer.prototype.FOCUS_PX = 8;                 // 0x11255  eax = 8 → 0x10D9A
/**
 * ★★★★★ **스크롤 스피드 옵션 `[0x8DAEA]`** — `0` 스크롤 · `≠0` **순간이동**
 *
 *   `0x1126D cmp [0x8DAEA], 0 / jne 0x11296 → call 0x111BE`.
 *   **`0x1124A`(카메라 맞춤)를 부르는 모든 곳**이 이 갈래를 탄다 — 호출부 20곳 이상,
 *   그 안에 **턴관리자의 캐릭터 전환 `0x19F32`** 도 있다.
 *   그래서 우리도 `0x1124A` 에 대응하는 세 창구가 전부 이 헬퍼를 본다:
 *   `focusScroll` · `goUnit` · `goFocus`.
 *
 *   ★ `camTo`·`goTile` 은 **원본 대응이 없는 범용 창구**다(걷기 추적·이벤트 행진).
 *     거기에 넣으면 `0x10D9A` 가장자리 스크롤까지 순간이동이 된다 —
 *     2026-08-25 에 실제로 그렇게 잘못 넣었다가 뺀 적이 있다.
 */
Renderer.prototype._스크롤빠름 = function () {
  try {
    return (typeof window !== 'undefined' && window.G2 && (window.G2['스크롤옵션'] | 0)) ? true : false;
  } catch (e) { return false; }
};
/**
 * ★★★★★ **유닛을 스프라이트 중심으로 비춘다 — 스크롤 판** (2026-08-26)
 *
 *   사용자 지적(두 번째): 「아직도 **탑승관련 포커스 안맞아**.
 *   지금은 비룡기준 **4칸중에 1칸**(배치할때 클릭하는 칸)에 포커스가 맞춰져 있어.」
 *
 *   ★ 처음에 `goUnit` 만 만들고 **링 열기 한 곳만** 바꿔서 나머지가 그대로였다.
 *     유닛을 아는 카메라 경로는 **여섯 곳**이다 —
 *     `battle_main` 1658 · 2449(사망) · 4547 · 3361(링) ·
 *     `battle_ui` 1360 · 1209~1211(대사창 화자).
 *     이제 **전부 이 판이나 `goUnit` 을 쓴다.**
 *
 *   보정량은 `spriteCenterOffset()`(모든 층 합집합 중앙) 이고,
 *   칸 단위 목적지에는 그것을 **칸으로 환산해** 더한다.
 *
 * @param {object} u  유닛
 * @param {number} [px] 걸음(생략하면 기본 8 — 0x11255)
 */
Renderer.prototype.focusUnit = function (u, px) {
  if (!u) return Promise.resolve(null);
  var 칸 = this._유닛중심칸(u);
  return this.focusScroll(칸.tx, 칸.ty, px);
};

/**
 * 유닛의 **스프라이트 중심**이 화면 한가운데 오도록 할 「칸」 좌표.
 *   그리기 앵커(칸 + 12, −2 · `0x12F2A`)에 `spriteCenterOffset` 을 더한 **맵 픽셀**을
 *   구하고, 그것을 칸으로 되돌린다. 일반 캐릭터는 오프셋이 거의 0 이라 제자리다.
 */
Renderer.prototype._유닛중심칸 = function (u) {
  /* ★★★★★ **되돌림 2026-08-26 — 카메라는 칸 그대로 둔다**
   *
   *   사용자: 「이동영역에서 화살표 확정이 되면 캐릭터로 시점이 이동하고 화면이
   *   **캐릭터를 따라가면서 이동**해야하는데 지금은 **화면은 제자리에 고정**되고
   *   캐릭터만 돌아다니고」
   *
   *   원인: `battle_main camFollows()` 는 카메라 좌상단과 유닛의 거리가
   *   **정확히 6칸**일 때만 좇는다 —
   *     `return ((t.x - cx) === 6) || ((t.y - cy) === 6);`
   *   내가 스프라이트 중심 보정으로 카메라를 1~3칸 옮겨 놓으니
   *   그 조건이 **영영 성립하지 않아** 추적이 죽었다.
   *
   *   ★ 애초에 사용자가 말한 「탈것 포커스」는 **링커맨드 위치**였고,
   *     그것은 `screenOfRendered(unit, 12+dx, -2+dy)`(카메라를 안 옮긴다)로
   *     이미 처리된다. **카메라까지 옮길 필요가 없었다.**
   *   ⇒ 칸을 그대로 돌려준다. 원본 `0x1124A` 도 칸 단위(`sub 6`)다. */
  return { tx: u.x | 0, ty: u.y | 0 };
};

/** 지정 칸을 향해 원본 걸음 크기로 카메라 스크롤을 진행한다. */
Renderer.prototype.focusScroll = function (tx, ty, px) {
  var self = this, n = (px | 0) || (this.FOCUS_PX | 0) || 8;
  /* ★★★★★ **가던 부드러운 카메라(camTo)를 끊는다** (2026-10-06)
   *   사장님 「gs 이제 멀지 않았습니다. … 이벤트 발동 전에 적이 움직이는데 그 중간에 발동하면서 우측 화면 끝으로 카메라가 튀는 문제」(4-3F)
   *   원본은 한 흐름이라 적 차례 카메라(0x1124A)가 다 끝나야 라운드 이벤트 대사(0x482B8 call 0x1124A)가 돈다.
   *   ☠ 우리는 AI 차례 카메라(camTo · 부드럽게)를 안 기다리고 넘어가, 대사 스크롤과 동시에 돌다가 camTo 가 끝까지 가서
   *     카메라가 그 적(맵 오른쪽 끝)에 멈췄다 — camTo 는 _centerToken 이 바뀌어야 멈추는데 이 함수가 안 바꿨다.
   *   ⇒ 새 카메라 명령이므로 그 표를 올려 앞 트윈을 끊는다(camTo 끼리와 같은 규칙). */
  this._centerToken = (this._centerToken | 0) + 1;
  this._camAnim = false;
  /* ★★★★★ **대기 중인 `op0F` 목표를 버린다** — 원본 `0x11003` 은 큐를 안 본다
   *   (2026-08-26 · 사용자 지적으로 끝까지 파서 확정)
   *
   *   사용자: 「2-4 이벤트에서 카메라가 **화면 끝까지 이동**하고 그 자리에서 대사가
   *   뜨고 **대사 넘길때 포커스가 듀란한테 이동**해」
   *
   *   원본 —
   *     0x482A5 대사창 진입 → **0x482B8 call 0x1124A**(첫 동작이 카메라 맞춤)
   *     0x1124A → 0x11003 : 0x1110A 루프가 `0x111AC call 0x45577`(= 한 프레임:
   *       맵 그리기 0x454B3 · 커서 · **화면 전송 0x5E9E8**)을 돌리며
   *       **남은 걸음이 0 이 될 때까지** 간다. 그 **뒤에** 상자·초상화·글자(0x482C3~).
   *     ⇒ 화자 포커스는 **끝까지 돌고**, 큐(`0x52A48` 16칸 링버퍼)를 **보지 않는다.**
   *       그 큐는 `op0F` 끼리의 것이다(`0x52A2C` 에서만 쌓고 꺼낸다).
   *
   *   우리는 `cameraScroll` 이 진행 중이면 `_camQueue` 에 목표를 쌓아 두는데,
   *   화자 포커스가 그 위에 스크롤을 걸어도 **끝나면 큐가 되살아나** 카메라가
   *   옛 `op0F` 목표로 **다시 튀었다.** 그래서 대사가 먼저 뜨고 넘길 때 포커스가 갔다. */
  /* ★ 되돌림 2026-08-26 — 큐를 비우면 op0F 목표가 사라져 **스크롤이 통째로 씹힌다.**
   *   사용자: 「느린스피드에서는 카메라 이동이 **완전히 씹히고** 대사로 넘어가고」
   *   순서(스크롤 → 화자)가 바로잡히기 전까지는 큐를 건드리지 않는다. */
  var c = this.camClamp((tx | 0) - 6, (ty | 0) - 6);
  /* ★★★★★ **스크롤 옵션이 ｢빠름｣이면 순간이동한다** — `0x1126D` (2026-08-26 · 원본 확정)
   *
   *   사용자: ｢원본관련해서 **캐릭터 전환시 스피드 빠르게 적용된 경우
   *   중간 이동과정없이 순간이동해서 포커싱** 되는데 지금은 그렇게 안된다고.｣
   *
   *   ```asm
   *   0x1124A  카메라 맞춤
   *     0x11255  mov eax, 8          ; 걸음 8 — 옵션의 4/8 을 안 탄다
   *     0x11268  call 0x10D9A
   *     0x1126D  cmp [0x8DAEA], 0    ; ★ 스크롤 옵션
   *     0x11275  jne 0x11296  ──┐
   *     0x1128F  call 0x11003     │  ; [0]  스크롤 루프 (한 걸음씩 그리며)
   *     0x1129C  call 0x111BE  ◄─┘  ; [≠0] ★ 즉시 설정 = 순간이동
   *     0x112B2  call 0x454B3        ;      맵 다시 그리기
   *   ```
   *   `0x111BE` 는 `sub eax,6 / sub edx,6` 으로 좌상단을 곧바로 `[0x4A83C]`·
   *   `[0x4A83E]` 에 넣고 **클램프만 하고 `ret`** 한다 — 루프가 없다.
   *
   *   `[0x8DAEA]` 참조 전수 (7곳) —
   *     0x4E3A8  옵션 메뉴 토글 `sete al` → 0 이면 `0x10D9A(4)` · 1 이면 `(8)`
   *     0x4DC37  메뉴 문구 `setne al / add eax,8` → 문구 8·9 두 벌
   *     0x4FE9C  설정 로더 (GAME.CFG 첫 바이트) — 같은 4/8
   *     ★ 0x1126D  **여기** — 순간이동 갈래
   *
   *   ★★★ **2026-08-25 에 절반을 지웠다.** 그때 ｢SCROLL 은 걸음 픽셀 수일 뿐이고
   *     `followMode` 를 바꾸는 건 다른 개념｣이라고 정정하면서 `0x4E3C5` 쪽만 남기고
   *     **`0x1126D` 갈래를 통째로 없앴다.** 둘 다 같은 변수를 보되 **하는 일이 다르다** —
   *     가장자리 스크롤은 걸음이 4/8 로 바뀌고, **카메라 맞춤은 스크롤 자체를 건너뛴다.**
   *     한 변수의 용례를 하나만 보고 단정하지 말 것.
   *
   *   ★ 이것은 `op0F` 이벤트 스크롤과 **무관하다.** op0F 는 자기 step(`0x50362`)을
   *     쓰는 별도 함수라 옵션을 안 탄다 (사용자 확인 2026-08-26: ｢이벤트는 잘 적용됐다｣). */
  if (this._스크롤빠름 && this._스크롤빠름()) {                                  /* 0x11296 → 0x111BE 즉시 설정 */
    /* ☠☠☠ **여기서 `_camTo` 를 지우는 것이 1-4 의 남은 절반이다** (2026-08-27)
     *
     *   > 「원작기준 **이벤트 대사가 먼저 → 카메라이동과 캐릭터 이동**인데,
     *   >  우리는 카메라이동 → 이벤트대사 → 캐릭터 이동이야.」
     *
     *   5-9(요청이 있을 때만 굴리기)로 **대사 중 정지**는 됐다. 그런데 그 뒤
     *   이동에서도 카메라가 안 흐른다 — 실측(1-4): 유닛이 18.8초부터 걷는데
     *   cam 이 `352,692` 에 **고정**. 대사가 화자를 비추며(`0x482B8 call 0x1124A`)
     *   이 갈래를 타서 진행 중이던 `op 0F` 목표를 통째로 지우기 때문이다.
     *
     *   원본은 저장소가 **둘**이다 —
     *     포커스 `0x1124A` → `0x11003` : 카메라 좌표 `[0xBA83C]` 를 직접 옮긴다
     *     `op 0F`          → `0x50339` : 자기 카운터 `[0x11057C]` + 16칸 링버퍼 `0x52A48`
     *   곧 포커스가 와도 `op 0F` 목표는 **살아남는다.**
     *
     *   ★ `if (!this._camTo || this._camTo.raf)` 로 보존하는 시도를 했다가
     *     **1-4 가 통째로 멈춰(28초간 한 걸음도 안 걸음) 되돌렸다.** 대사창이
     *     「진행 중인 스크롤이 끝나기를」 기다리는 길과 얽힌다.
     *   ⇒ 제대로 고치려면 **`op 0F` 전용 슬롯**을 따로 둔다. `00_남은일_전체.md` ①. */
    this._camScrolling = false; this._camTo = null;
    var _p = this.camPixelOf(c); this.cam.cx = _p.cx; this.cam.cy = _p.cy;   /* 여백은 camPixelOf 한 곳에 */
    /* 원본 0x11003은 마지막 좌표를 그린 뒤 반환한다. 연출 중 pumpFrames가 멈춰
     * `_pcam`이 오래된 값이면 표시 보간만 이전 카메라에 남으므로 카메라 기준만 맞춘다. */
    this._pcam = { cx: this.cam.cx, cy: this.cam.cy };
    this.apply();                               /* 0x112B2 call 0x454B3 다시 그리기 */
    this._카메라대기해제();                     /* 기다리던 쪽을 깨운다 */
    return Promise.resolve(c);
  }
  /* ★ `정확히` — 도착한 뒤에 화면 좌표를 재는 쪽(대사창 타원 `0x482D9`)이 있어서
   *   목표에 픽셀까지 딱 맞아야 한다. `_camScrollTo` 주석 참조. */
  var t = this._포커스카메라목표설정(c, n, true);
  /* 이미 그 자리면 스크롤할 것이 없습니다 (0x1110F → 0x111B6 즉시 탈출) */
  if (t.fx <= 0 && t.fy <= 0) {
    this._camScrolling = false; this._camTo = null;
    var _p = this.camPixelOf(c); this.cam.cx = _p.cx; this.cam.cy = _p.cy;   /* 여백은 camPixelOf 한 곳에 */
    this._pcam = { cx: this.cam.cx, cy: this.cam.cy };
    this.apply();
    return Promise.resolve(c);
  }
  /* ★ 이 스크롤만 **화면 갱신마다** 한 칸씩입니다 — 틱 대기가 없습니다.
   *   0x11003 루프는 `0x111AC call 0x45577` 하나로 한 바퀴를 끝냅니다.
   *   0x45577 = 0x454B3(맵) + 0x5D22E + 0x5D41E + 0x5E9E8(화면 갱신) + 0x5D570 —
   *   `0x1033B`/`0x499E4` 같은 **대기 호출이 없습니다.** 걷기(5틱)·이벤트 행진
   *   (9틱)과 달리 게임에서 가장 빠른 카메라 움직임입니다.
   *   그래서 게임 프레임 시계에 태우지 않고 rAF 로 굴립니다. */
  t.raf = true;

  /* ★★ **약속을 먼저 만든다.** 예전엔 `frame()` 을 먼저 돌리고 그 뒤에 약속을
   *   만들었는데, 첫 프레임에서 스크롤이 끝나 버리면 `_flushCamDone()` 이
   *   **아직 비어 있는 목록**을 비우고 지나가, 그 뒤에 밀어 넣은 `done` 이
   *   영영 안 불렸다 — 사망 연출이 카메라를 기다리다 그대로 멈춘다.
   *   (사용자 지적 2026-08-13 「사망 카메라 제대로 적용 안 되는 것 같아」) */
  var p = new Promise(function (done) { (self._camDone || (self._camDone = [])).push(done); });

  if (typeof requestAnimationFrame === 'function') {
    /* rAF 로 굴린다 — `0x11003` 이 화면 갱신마다 한 스텝이므로 이게 맞다.
     * ★ 다만 **탭이 뒤로 가면 브라우저가 rAF 를 아예 멈춘다.** 원본 게임 루프는
     *   멈출 일이 없으니, 감시 타이머를 하나 두고 rAF 가 한동안 안 오면 그때만
     *   대신 굴린다. **둘이 같이 굴리면 속도가 두 배가 되므로** 마지막으로 굴린
     *   시각을 보고 한쪽만 움직인다. */
    var alive = true, last = Date.now(), pump = null;
    var raf예약 = (typeof self._raf예약 === 'function')
      ? function (fn) { self._raf예약(fn); }
      : function (fn) { requestAnimationFrame(fn); };
    var 반복예약 = (typeof self._반복예약 === 'function')
      ? function (fn, ms) { return self._반복예약(fn, ms); }
      : function (fn, ms) { return setInterval(fn, ms); };
    var 반복취소 = (typeof self._반복취소 === 'function')
      ? function (h) { self._반복취소(h); }
      : function (h) { clearInterval(h); };
    var 정리 = function () { alive = false; if (pump) { 반복취소(pump); pump = null; } };
    var step = function () {
      last = Date.now();
      if (!alive || self._camTo !== t) { 정리(); return false; }        /* 밀렸다 */
      if (!self._카메라한칸()) { 정리(); return false; }
      return true;
    };
    var tick = function () { if (step()) raf예약(tick); };
    p = p.then(function (v) { 정리(); return v; }, function (e) { 정리(); throw e; });
    /* ★ 스크롤하는 동안 게임 시간을 멈춘다 (2026-09-27) — 원본 0x11003 루프는 화면 전송(0x5E9E8)만 하고 프레임 대기가 없어
     *   게임 시계(프레임 대기 합)로 0 틱이고, 그동안 게임은 막혀 있다. 스크롤은 제 rAF 로 도므로 멈춘 채로도 끝난다.
     *   ☠ 예전엔 스크롤 프레임마다 게임 시간이 흘러 풍아·광룡·화염인 연출이 원본보다 한 틱씩 늦었다 · 창구: battle_main 싣기(G2연출싣기) */
    if (typeof root.G2연출싣기 === 'function') root.G2연출싣기(p);

    /* ★ **첫 칸은 즉시** — 원본 `0x11003` 은 루프에 들어가자마자 한 칸 밀고
     *   `0x111AC call 0x45577` 로 그린다. 대기가 없다. */
    if (step()) {
      /* 브라우저에서만 감시 타이머를 단다 (Node 시험에는 rAF 가 흉내뿐이라 불필요) */
      if (typeof document !== 'undefined') {
        var WATCH = 60;                       /* rAF 가 이만큼 안 오면 멈춘 것으로 본다 */
        pump = 반복예약(function () {
          if (!alive || self._camTo !== t) { 정리(); return; }
          if (Date.now() - last >= WATCH) step();
        }, 16);
      }
      raf예약(tick);
    }
  } else { while (this._카메라한칸()) { /* 시험 코드 */ } }
  return p;
};

/**
 * 카메라 스크롤 한 프레임 — 게임 프레임 시계가 부릅니다.
 * @returns {boolean} 아직 가는 중이면 true
 */
Renderer.prototype.stepCamScroll = function () {
  /* 대사창 포커싱(0x1124A)은 틱이 아니라 **화면 갱신마다** 도므로 자기 rAF 로 굽니다 */
  if (this._camTo && this._camTo.raf) return this._camScrolling;
  return this._카메라한칸() || !!this._evCam;
};

/** 카메라 내부 슬롯의 읽기 전용 관찰 경계. 좌표나 진행 상태를 외부가 직접 쓰지 않는다. */
Renderer.prototype.카메라상태 = function () {
  var t = this._camTo || null;
  return Object.freeze({
    중심x: this.cam.cx,
    중심y: this.cam.cy,
    포커스이동중: !!this._camScrolling,
    부드러운이동중: !!this._camAnim,
    이벤트이동중: !!this._evCam,
    포커스목표있음: !!t,
    포커스자체RAF: !!(t && t.raf),
    포커스잔여x: t ? (t.fx | 0) : 0,
    포커스잔여y: t ? (t.fy | 0) : 0,
    포커스속도x: t ? (t.vx | 0) : 0,
    포커스속도y: t ? (t.vy | 0) : 0,
    이벤트큐있음: !!this._camQueue
  });
};

/** 카메라가 목표 위치를 향해 보간 중인지 판정한다. */
Renderer.prototype.카메라이동중인가 = function () {
  return !!(this._camScrolling || this._camAnim || this._evCam);
};

/** 스크롤 한 칸 — 게임 프레임 시계와 포커싱 rAF 가 함께 씁니다. */
Renderer.prototype._카메라한칸 = function () {
  var t = this._camTo;
  /* ★ 포커스(0x1124A)가 도는 중이면 `op 0F` 는 **쉰다.** 원본에서 `0x11003` 은
   *   자기 프레임 루프를 도는 **블로킹 함수**라 그동안 연출 루프가 멈춰 있다. */
  if (!t || !this._camScrolling) return this._이벤트카메라한칸();
  /* 0x505B6~0x5061F — X·Y 가 **각자의 남은 프레임 수**를 갖고 따로 깎입니다. */
  if (t.fx > 0) { this.cam.cx += t.vx; t.fx--; }
  if (t.fy > 0) { this.cam.cy += t.vy; t.fy--; }
  /* ★ 마지막 칸은 남은 거리만큼만 — 넘어가면 목표에서 어긋난 채 멈춘다.
   *   (원본은 카메라가 늘 타일 정렬이라 딱 떨어지지만 우리는 아니다.
   *    `_camScrollTo` 주석 참조.) */
  if (t.tx != null) {
    if (t.fx <= 0) this.cam.cx = t.tx;
    if (t.fy <= 0) this.cam.cy = t.ty;
  }
  if (t.fx <= 0 && t.fy <= 0) {
    this._camScrolling = false; this._camTo = null;
    this._카메라대기해제();               /* 0x1124A 를 기다리던 대사창을 깨웁니다 */
  }
  this.clampCamera();                      // 0x11003 — 맵 밖으로 나가지 않게
  /* 포커스 rAF의 최종 화면 전송은 논리 프레임 markLerp를 기다리지 않는다.
   * 마지막 좌표에서 카메라 보간 기준만 맞춰 최종 초점이 즉시 표시되게 한다. */
  /* ★ (2026-10-02) 끝에서만이 아니라 «걸음마다» 맞춘다 — 원본 0x11003 은 걸음마다 0x45577(맵·화면 전송)이라 보간이 없다.
   *   ☠ 스크롤 동안 게임 시간이 멈춰(G2연출싣기) 보간 비율이 굳어, 화면이 걸음의 일부만 따라오다 마지막 걸음에 나머지를 한꺼번에 뛰었다
   *   (실측 2-4A 연 뒤 시전자 비추기: 카메라 중심 360→368→376→384 인데 화면 709→681→673→585 · 사장님 「천천히 이동하다가 갑자기 순간이동」·「시전완료후 픽셀이 이동」) */
  if (t.raf) this._pcam = { cx: this.cam.cx, cy: this.cam.cy };
  this.apply();
  return this._camScrolling;
};

/**
 * `op 0F` 스크롤 한 프레임 — `0x505B6`~`0x5061F`.
 *
 * ★ 대사창이 떠 있는 동안에는 프레임 요청이 없어(5-9) **여기까지 오지 않는다.**
 *   그래서 목표가 살아 있는 채로 멈췄다가, 뒤따르는 `op 0x05` 이동이
 *   요청을 내는 순간 **유닛과 함께** 다시 흐른다 — 사용자가 말한 그 순서다.
 */
Renderer.prototype._이벤트카메라한칸 = function () {
  var e = this._evCam;
  if (!e) return false;
  if (e.fx > 0) { this.cam.cx += e.vx; e.fx--; }
  if (e.fy > 0) { this.cam.cy += e.vy; e.fy--; }
  if (e.fx <= 0 && e.fy <= 0) {
    this._evCam = null;
    /* 0x52A48 큐에 밀어 둔 다음 명령을 이어서 (한 칸만 둡니다) */
    var q = this._camQueue;
    if (q) { this._camQueue = null; this.cameraScroll(q.cx, q.cy, q.step); }
  }
  this.clampCamera();                      // 0x11003 — 맵 밖으로 나가지 않게
  this.apply();
  return !!this._evCam;
};

/* ══════════════ 센터링 — 즉시 이동 / 부드러운 스크롤 ═══════════════════
 *
 * 원본에 없는 리마스터 편의 기능입니다(개발패널 「센터링」).
 *
 * ★★ 카메라를 옮기는 **모든 경로가 여기 한 곳을 지나야** 합니다.
 *   예전엔 경로마다 제각각이라 설정이 반쪽만 먹었습니다 — 우클릭이
 *   설정대로 부드럽게 출발해도 곧바로 링 열기가 `center()` 로 스냅해
 *   덮어써서, 뭘 고르든 결과가 같았습니다.
 *
 * **도착 지점은 두 방식이 완전히 같습니다.** 가는 방법만 다릅니다.
 * 그래서 원본 좌표 계산(0x11003 클램프 · 0x1124A −6)은 그대로 쓰입니다.
 *
 * ★★ 설정이 걸리는 건 「**전환**」뿐입니다 — 다른 캐릭터로 시점을 옮기는 것.
 *   우클릭 순회 · 세션/링 열기 · AI 차례 · 화자 바뀜 · 0x0F 모드 1·3 등.
 *
 *   「**따라가기**」는 설정과 무관하게 늘 부드럽습니다 — 걸어가는 유닛을
 *   쫓는 카메라(0x0F 모드 0 = `cameraScroll`). 유닛은 걷는데 카메라만
 *   순간이동하면 어색하고, 원본도 여기선 등속으로 함께 흐릅니다.
 * ─────────────────────────────────────────────────────────────────────── */
Renderer.prototype.followMode = 'smooth';        // 'smooth' | 'instant'
Renderer.prototype.FOLLOW_MS = 320;

/**
 * 카메라 목표 지점(맵 픽셀)으로 이동 — **유일한 통로**.
 * @param {number} ex,ey  목표 카메라 중심
 * @param {object} [o]  `{ duration, linear, force }`
 *   `force:true` 는 설정을 무시하고 즉시 — 바로 뒤 원본 로직이 화면 좌표를
 *   재야 해서 도착해 있어야 하는 경우에만 씁니다.
 * @returns {Promise} 도착하면 resolve. 뒤따르는 연출이 기다릴 수 있습니다.
 *   (다른 이동 명령에 밀려 취소돼도 resolve 합니다 — 연출이 멈추지 않게.)
 */
Renderer.prototype.camTo = function (ex, ey, o) {
  o = o || {};
  var self = this;
  this._카메라대기해제();                /* 0x1124A 스크롤을 기다리던 쪽이 있으면 풀어 줍니다 */
  var token = this._centerToken = (this._centerToken | 0) + 1;
  /* ★★★★★ **이벤트가 도는 동안에는 언제나 즉시** (2026-08-28 · 사용자 결과 피드백)
   *
   *   > 「1-5 킬러 등장 이벤트중 카메라 이동 아직도 이상해. **위쪽 킬러 등장 이후
   *   >  카메라가 바로 아래쪽으로 이동해야하는데, 우리는 위쪽으로 이동했다가 아래로** 가.」
   *
   *   원본 화자 포커스는 `0x1124A → 0x11003` 이 **카메라 좌표 `[0xBA83C]` 를 직접
   *   써 넣는다** — 애니메이션이 아니라 **즉시**다.
   *   우리는 「부드럽게」(리마스터 편의)를 이벤트에도 걸어, `op 0F`(`_evCamTo`)가
   *   목표까지 내려간 **뒤에** 포커스 애니메이션이 남아 **위로 되밀었다.**
   *
   *   실측 (1-5 · 검증 크롬 9333)
   *     `_evCamTo((54,45),4)` 가 `cy 596 → 820` 으로 정확히 내려가 13.9초에 끝난다.
   *     15.79초 `cy 820 → 817` · 15.85초 `817 → 808`  ← **`_camAnim = true`**
   *     16.33초 다음 화자 포커스가 다시 아래로(`cy 840`)
   *   그 되밀림이 사용자가 본 「위로 갔다가 아래로」다.
   *
   *   ★ `op 0F`(모드 0)는 `cameraScroll → _evCamTo` 로 가고 여기를 안 지난다 —
   *     걸어가는 유닛을 따라가는 등속 스크롤은 그대로 살아 있다.
   *   ★ 「부드럽게」 설정은 **사람이 조작할 때**(우클릭 순회·링 열기)에만 남는다. */
  var _이벤트중 = false;
  try { _이벤트중 = !!(root.G2이벤트진행중 && root.G2이벤트진행중()); } catch (e이) {}
  var instant = o.force || this.followMode !== 'smooth' || _이벤트중;
  var near = Math.abs(ex - this.cam.cx) < 0.5 && Math.abs(ey - this.cam.cy) < 0.5;
  if (instant || near || typeof requestAnimationFrame !== 'function') {
    this.cam.cx = ex; this.cam.cy = ey; this._camAnim = false; this.apply();
    return Promise.resolve();
  }
  var sx = this.cam.cx, sy = this.cam.cy;
  /* ★★★★★ **원본은 고정 시간이 아니라 「고정 걸음」이다** — `0x11003` (2026-08-25)
   *
   *   사용자 지적: 「실제 원작에서는 **단순 스크롤 속도가 아니야.** 특히 전투에서는
   *   캐릭터간 포커스 이동시 빠르게 이동한다기 보다는 **순간이동처럼 특정 캐릭터에게
   *   바로 포커스가 꽂혀.**」
   *
   *   ```asm
   *   0x1124A                       ; ★ 「대상 비추기」 — 마법·이동·배치 등 거의 모든 곳이 부른다
   *     └ 0x11003                   ;   카메라를 목표로 옮기는 본체
   *        0x110CC/0x110D6  ax = [0x7001E]   ; ★ 한 걸음 **x 증분**
   *        0x110E8/0x110F2  ax = [0x70020]   ; ★ 한 걸음 **y 증분**
   *        0x1111D~         루프를 돌며 그 증분만큼 민다
   *   0x4E3A8 (SCROLL 속도)  →  0x10D9A(8) / 0x10D9A(4)
   *   0x10D9A  mov [0x70020], ax / mov [0x7001E], ax
   *   ```
   *   ⇒ 걸음이 **4 px 또는 8 px** 이고, 걸리는 **시간은 거리에 비례**한다.
   *     8 이면 절반 시간에 도착하므로 「순간이동처럼 꽂히는」 느낌이 난다.
   *
   *   우리는 `FOLLOW_MS`(320ms) **고정 시간**이라 거리와 무관했다 — 가까운 곳은
   *   느릿하고 먼 곳은 빨랐다. 원본 식으로 바꾼다.
   *   ★ `o.duration` 을 준 쪽(이벤트 스크롤 등)은 그대로 존중한다. */
  /* ★★★★★ **포커스 카메라는 옵션과 무관하게 언제나 8 이다** (2026-08-25 · 원본 확정)
   *
   *   사용자 지적: 「**이벤트 카메라 이동** 관련 버그가 있어. **옵션 스피드에 따라
   *   이부분이 변화해서 포커싱이 어긋나.** 옵션과 상관없이 이벤트 카메라는 동일한걸로
   *   알고있는데 원본 확인이 필요해」  ← **맞는 말이었다.**
   *
   *   `0x10D9A`(카메라 스크롤)를 부르는 곳은 EXE 전체에 **셋뿐**이고,
   *   걸음(`eax`)이 이렇다:
   *   ```
   *   0x11268 [0x1124A 카메라 맞춤]  mov eax, 8      ; ★ **고정**
   *   0x4E3C5 [0x4E0EE]              mov eax, 8      ; ★ **고정**
   *   0x4FEB2 [0x4FE74 설정 로더]    cmp [0xFDAEA],0 ; ★ **여기만** 옵션을 본다
   *                                  je → eax=4 / jne → eax=8
   *   ```
   *   곧 **SCROLL 옵션은 설정 로더가 한 번 반영하는 값**이고,
   *   대상을 비추는 카메라 맞춤(`0x1124A` — 이벤트·포커스·링 진입)은
   *   **언제나 걸음 8** 이다.
   *
   *   ★ 내가 2026-08-25 에 「스크롤 옵션이면 8, 아니면 4」를 여기 넣은 것이
   *     **이벤트 카메라까지 느리게 만들어** 포커싱이 어긋났다. 되돌린다.
   *     옵션은 **가장자리 스크롤**(`EDGE.pxPerSec`)에만 걸린다 — 그쪽은 그대로 둔다. */
  var 걸음 = 8;                                                   /* 0x11255 mov eax, 8 */
  var 거리 = Math.max(Math.abs(ex - sx), Math.abs(ey - sy));
  var 원본ms = 거리 / 걸음 * (1000 / 175.47);                     /* 틱당 한 걸음 */
  var ms = Math.max(60, o.duration | 0 || 원본ms), linear = !!o.linear;
  /* ★ 이벤트 스크롤(_camScrolling)과 **다른 플래그**다. 예전엔 둘이 같은 플래그를
   *   써서, 부드러운 센터링이 끝나기 전에 다른 명령이 오면 _camScrolling 이 true 인 채
   *   _camTo 는 null 인 **영구 잠김**이 생겼다. 그러면 stepCamScroll 이 바로 빠져나가
   *   이벤트 카메라가 아예 안 움직이고, camFollows 도 계속 false 가 된다. */
  this._camAnim = true;
  /* 함수 단위 계약 시험은 camTo만 떼어 가짜 렌더러에 붙인다. 제품에서는 주입
   * 시간원을 쓰고, 그 최소 하네스에서는 기존 네이티브 프레임을 보존한다. */
  var 프레임예약 = (typeof self._다음프레임 === 'function')
    ? function (fn, no) { self._다음프레임().then(fn, no); }
    : function (fn) { requestAnimationFrame(fn); };
  return new Promise(function (done, fail) {
    var start = null;
    function 실패(e) { self._camAnim = false; fail(e); }
    function frame(now) {
      if (token !== self._centerToken) { self._camAnim = false; done(); return; }   // 새 명령에 밀림
      if (start === null) start = now;
      var t = Math.min(1, (now - start) / ms);
      var q = linear ? t : t * t * (3 - 2 * t);      /* 등속 또는 smoothstep */
      self.cam.cx = sx + (ex - sx) * q;
      self.cam.cy = sy + (ey - sy) * q;
      self.apply();
      if (t < 1) 프레임예약(frame, 실패);
      else { self.cam.cx = ex; self.cam.cy = ey; self._camAnim = false; done(); }
    }
    프레임예약(frame, 실패);
  });
};

/** 타일 **중심**을 화면 한가운데로 — `center()` 의 설정 반영판. */
/**
 * ★★★★★ **유닛을 스프라이트 중심으로 비춘다** (2026-08-25 · 사용자 지적)
 *
 *   사용자: 「탑승관련 **포커스 안맞아**. 지금은 비룡기준 **4칸중에 1칸**
 *   (배치할때 클릭하는 칸)에 포커스가 맞춰져 있어. 원작기준 그 지점이 아닌,
 *   **캐릭터가 타고있는 스프라이트 전체를 기준으로 중심이 맞춰져.**」
 *
 *   원본 카메라 맞춤 `0x1124A` 는 **칸 단위**다 —
 *   ```
 *   0x11279  sub eax, 6      ; 대상 칸 Y − 6
 *   0x11281  sub eax, 6      ; 대상 칸 X − 6   → 좌상단
 *   0x1128F  call 0x11003    ;   맵 안으로 클램프
 *   ```
 *   스프라이트 크기를 **안 본다.** 그런데도 원작에서 중심이 맞는 까닭은,
 *   원본이 **320×200 평면**이고 `0x12F2A` 앵커가 칸 중앙 아래라
 *   음수 앵커(`ax`·`ay`)를 가진 큰 그림이 **그 칸을 감싸며** 그려지기 때문이다.
 *
 *   우리는 기울기·확대가 걸린 2.5D 빌보드라 **같은 칸이라도 그림이 다른 자리**에 온다.
 *   CLAUDE.md 의 예외 규정(「화면 기준 상수 — 카메라가 시전자를 두는 자리 등은
 *   **실행기에 맞춘다**」)에 따라, 칸이 아니라 **스프라이트 중심**으로 비춘다.
 *   `spriteCenterOffset()` 이 모든 층(탈것 본체 + 탑승자)의 합집합 중앙을 준다.
 *
 * @param {object} u  유닛
 * @param {object} [o] `goTile` 과 같은 옵션
 */
Renderer.prototype.goUnit = function (u, o) {
  if (!u) return Promise.resolve();
  /* ★ `focusUnit` 과 **같은 계산**을 쓴다 — 유닛의 스프라이트 중심이 화면
   *   한가운데 오도록 한 「칸」으로 옮긴다(`_유닛중심칸`). 예전에는 여기서만
   *   따로 픽셀 보정을 해서 다른 경로와 결과가 달랐다. */
  /* ★ `0x1126D` — 스피드 옵션이 ｢빠름｣이면 **중간 이동 없이 순간이동**한다.
   *   사용자 2026-08-26: ｢캐릭터 전환시 스피드 빠르게 적용된 경우
   *   중간 이동과정없이 순간이동해서 포커싱｣ — 턴관리자 `0x19F32 call 0x1124A`. */
  if (this._스크롤빠름 && this._스크롤빠름()) {
    o = o || {}; if (o.force == null) o = Object.assign({}, o, { force: true });
  }
  /* ★★★★★ **탈것은 칸이 아니라 「스프라이트 중앙」을 화면 한가운데** (2026-08-26)
   *
   *   사용자: 「탈 것 탑승후 **링커맨드 센터링이 안맞아**. 원작은 일반 캐릭터와
   *   동일하게 캐릭터 정중앙으로 포커싱이 돼. **탈 것 탑승한 전체 스프라이트를
   *   기준으로 정 중앙**에 들어가야해.」 · 「지금은 **비룡기준 4칸중에 1칸**
   *   (배치할때 클릭하는 칸)에 포커스가 맞춰져 있어」
   *
   *   비룡 실측(29-0 · 사라) — 층 `비룡 63×28@(17,25)` + `탑승자 35×23@(25,21)`,
   *   합집합 중앙 `(48.5, 37)`, 기준점 `(36, 72)` ⇒ `spriteCenterOffset = (13, −35)`.
   *   **35 px 위**다 — 칸 단위(`goTile`)로는 담을 수 없는 크기다.
   *
   *   ★ `_유닛중심칸()` 은 **되돌아가 있다**(칸을 그대로 준다). 그것을 되살리면
   *     `battle_main camFollows()` 의 `((t.x - cx) === 6)` **정확 조건**이 깨져
   *     이동 중 카메라 추적이 죽는다(2026-08-26 에 실제로 그랬다).
   *   ⇒ 그래서 **`goUnit` 안에서만** 픽셀 단위로 민다. 호출부는 둘뿐이고
   *     **둘 다 링·세션 유닛 센터링**이라(`battle_main` 3363 · `battle_ui` 1428)
   *     이동 추적과 무관하다.
   *
   *   좌표: 기준점(`0x12F2A` 화면x = 칸x*24+12 · 화면y = 칸y*16−2) + 중앙 오프셋.
   *   `goTile` 은 **타일 중심**(`x*24+12, y*16+8`)이라 y 가 10 px 아래다 —
   *   예전 `_up = 10` 보정이 그 차이였다. 여기서는 기준점을 직접 쓴다. */
  var _오프 = { dx: 0, dy: 0 };
  try { if (this.spriteCenterOffset) _오프 = this.spriteCenterOffset(u) || _오프; } catch (e중) {}
  /* ☠☠☠★★★★★ **화면 여백을 빠뜨렸다** (2026-09-15 · 사장님 「카메라 계속 말썽」)
   *
   *   아래 `_mx`·`_my` 는 **「그 맵 픽셀이 화면 한가운데 오게」** 라는 뜻인데,
   *   원본 화면은 카메라 창이 **여백 (16, 4)** 만큼 안으로 들어가 있다
   *   (`camPixelOf` 주석 — `0x1097B`·`0x10982`·`0x1099A`·`0x1099C`).
   *   그래서 이 길로 센터링하면 늘 그 여백만큼 어긋났다 —
   *   실측: 목표가 `8×24+12 = 204` 로 잡혀 카메라가 **205** 에서 멎었고,
   *   제자리는 **192** 였다(차 `+13`). 원본 GIF 와 겹치면 `−14, −1`.
   *   ★ `camPixelOf({x:0,y:0})` 가 곧 그 여백이다 — 해상도가 바뀌어도 따라간다. */
  /* ☠☠☠★★★★★ **바탕은 「칸 창」이다 — 픽셀로 직접 잡으면 안 된다** (2026-09-16)
   *
   *   > 사장님: 「카메라 계속 말썽이야」 · 「좌표로 생각하면 안되고 의미로 잡아야해」
   *
   *   원본 카메라(`0x1124A`)는 **좌상단 칸 = 대상 − 6** 하나로 정해진다. 픽셀을
   *   직접 만들지 않는다. 여기서 `칸×24+12`·`칸×16−2` 로 픽셀을 지어 넘기는 바람에
   *   칸 창 값과 어긋났다 — 실측 `189, 266` vs 칸 창 `192, 272`, 그만큼 맵이 밀렸다
   *   (원본 GIF 와 겹치면 `+2, +3`).
   *   ⇒ **칸 창을 바탕으로 두고**, 탈것용 스프라이트 보정만 그 위에 얹는다.
   *     보정이 0 인 보통 캐릭터는 원본과 정확히 같은 자리가 된다. */
  var _바탕 = this.camPixelOf(
    this.camClamp((u.x | 0) - (this.CAM_TILES >> 1), (u.y | 0) - (this.CAM_TILES >> 1)));
  /* ★ 보통 캐릭터는 보정이 0~1 이라 원본과 같다. 탈것(큰 스프라이트)만 얹는다 —
   *   원본에는 이 보정이 없으므로 **작은 스프라이트에는 걸지 않는다.** */
  var _큼 = needsLargeVisual(u);
  return this.camTo(_바탕.cx + (_큼 ? (_오프.dx | 0) : 0),
                    _바탕.cy + (_큼 ? (_오프.dy | 0) : 0), o);
};

/** 지정 전투 칸으로 카메라를 옵션에 맞춰 이동시킨다. */
/**
 * ☠☠☠★★★★★ **카메라는 「칸 중심 맞추기」가 아니라 「좌상단 창 맞추기」다** (2026-09-15)
 *
 *   > 사장님: 「애초부터 화면 비율이 미묘하게 달라. 우리 화면이 가로로 약간 더
 *   >  길게 담는 것 같아」 · 「**좌표로 생각하면 안되고 의미로 잡아야해**」
 *
 *   ☠ 여기서 `칸 × 24 + 12`(= 칸 **중심**)를 화면 한가운데에 놓고 있었다.
 *     원본은 그렇게 안 한다 — `0x1124A` 는 **좌상단 칸 = 대상 − 6** 으로 잡고,
 *     그 12×12 칸 창을 화면에 놓는다(`0x11277`·`0x11281  sub 6`).
 *     그 창은 화면 한가운데에 놓이므로 대상 칸의 **왼쪽 모서리**가
 *     `6칸 × 24 + 여백16 = 160`, 곧 칸 **중심**은 `172` 다.
 *     우리는 중심을 160 에 놓아 **가로 −12·세로 −8 만큼 어긋났다**
 *     (실측 어긋남은 스프라이트 앵커까지 겹쳐 `−14, −1`).
 *
 *   ⇒ `focusTile`(= `0x1124A` 이식본)로 보낸다. 여백·클램프가 그 안에 있고,
 *     식은 `camPixelOf` 한 곳에만 있다.
 *   ★ 이 길로 보내면 **해상도가 바뀌어도 따라간다** — `camPixelOf` 가
 *     `(논리화면 − 창칸수×타일)/2` 로 여백을 스스로 구하기 때문이다.
 */
Renderer.prototype.goTile = function (tx, ty, o) {
  var c = this.camClamp((tx | 0) - (this.CAM_TILES >> 1), (ty | 0) - (this.CAM_TILES >> 1));
  var p = this.camPixelOf(c);                       // 0x1124A → 0x11003
  return this.camTo(p.cx, p.cy, o);
};
/** **좌상단 타일** 기준 — `cameraTo()` 의 설정 반영판 (0x11003 클램프 그대로). */
Renderer.prototype.goCamTile = function (cx, cy, o) {
  var c = this.camClamp(cx, cy);
  var p = this.camPixelOf(c);        /* ★ 여백 식은 camPixelOf 한 곳에 (0x1124A) */
  return this.camTo(p.cx, p.cy, o);
};
/** 0x1124A 대상 비추기(좌상단 = 대상 − 6) 의 설정 반영판. */
Renderer.prototype.goFocus = function (tx, ty, o) {
  /* ★ `0x1126D` — 빠름이면 순간이동 (위 `_스크롤빠름` 주석 참조) */
  if (this._스크롤빠름 && this._스크롤빠름()) {
    o = o || {}; if (o.force == null) o = Object.assign({}, o, { force: true });
  }
  return this.goCamTile((tx | 0) - 6, (ty | 0) - 6, o);
};

/**
 * 예전 이름 — `goTile` 로 접었습니다. 설정이 'instant' 면 즉시 갑니다.
 * @param {boolean} [linear]  가감속 없이 **등속**으로 (기본은 smoothstep)
 *
 * ★ 이벤트에서 걸어가는 유닛을 따라갈 때는 반드시 `linear` 를 씁니다.
 *   유닛은 4px/프레임 등속(0x15EB5)인데 카메라만 smoothstep 이면 중간 구간에서
 *   카메라가 유닛을 앞질러 「이동보다 카메라가 빠른」 모양이 됩니다.
 */
Renderer.prototype.centerAnimated = function (tx, ty, duration, linear) {
  return this.goTile(tx, ty, { duration: duration, linear: linear });
};

/** 카메라를 맵 안에 가두되 위 여백만큼은 밖으로 나갈 수 있게 합니다. */
Renderer.prototype.centerClamped = function (tx, ty, viewW, viewH) {
  this.center(tx, ty);
  var mx = this.MARGIN.x + (viewW || 0) / 2;
  var my = this.MARGIN.y + (viewH || 0) / 2;
  this.cam.cx = Math.max(-mx, Math.min(this.mapW + mx, this.cam.cx));
  this.cam.cy = Math.max(-my, Math.min(this.mapH + my, this.cam.cy));
};

/** 링 중심으로 쓸 화면 좌표 — 카메라가 그 칸을 정확히 가운데 두므로 늘 화면 중앙입니다. */
Renderer.prototype.screenCenter = function () {
  return { x: this.host.clientWidth / 2, y: this.host.clientHeight / 2 };
};

/** 원작과 같은 크기가 되는 배율. 화면 높이 200 논리픽셀이 기준입니다. */
Renderer.prototype.nativeZoom = function () {
  var h = this.host.clientHeight || 200;
  return Math.max(1, h / 200);
};

/**
 * ★★★★★ **지형·맵 오브젝트를 가린다/되돌린다** — 「배경생성」 마법 (2026-09-07)
 *
 *   `맵가리기(true)` 면 **지면 그룹**(바닥·타일·표식)과 `spriteLayer` 안의
 *   **맵 조각들**(`g2-map-*`)만 감춘다. **유닛은 그대로 둔다** —
 *   원본이 `0x58919 call 0x12F2A` 로 유닛을 다시 그리기 때문이다.
 *
 *   ☠ `objLayer === spriteLayer` 라 층을 통째로 숨기면 유닛까지 사라진다(생성자 주석).
 *   ★ 되돌릴 때 **원래 `display` 를 기억했다가 넣는다** — 빈 문자열로 밀면
 *     CSS 로 숨겨져 있던 것이 되살아난다.
 */
Renderer.prototype.맵가리기 = function (켤까) {
  var 켬 = !!켤까;
  if (this._맵가림 === 켬 && !켬) return this;
  this._맵가림 = 켬;
  /* ★ 접어 세운 배경벽(backdropEl · g2-world 안)과 눕힌 오브젝트층(flatObjLayer)도 맵이다 — 0x30F98 은 화면을 통째로 0 으로 지운다.
   *   ☠ 빠져 있어 초필살기 검은 화면에서 성벽 아치 같은 배경벽·바닥 오브젝트가 그대로 보였다
   *   (2026-10-02 사장님 「스탐블링거 이벤트 있는 맵에서 초필살기 사용시 일부 맵과 오브젝트가 암전이나 팔레트 변경에 제대로 덮히지 않는 문제도 있어. 아수라파천무 사용시 그랬어.」 · 사진) */
  var 지면 = [this.floorLayer, this.tileLayer, this.markLayer, this.backdropEl, this.flatObjLayer,
              this._map3dPreview && this._map3dPreview.node,
              /* ★ 리마스터 3D 맵(WebGL 캔버스)과 그 가림판도 맵이다 — 0x5E9D0 화면 전체 0 칠(천지파열무·무신멸뢰옥)·아수라파천무 검은 화면에서
               *   3D 맵·앞 사물이 그대로 보였고 가림판이 시전자·대상을 덮었다 (2026-11-13 · 사장님 11-12 「초필살기 연출중에 오브젝트가 시전자나
               *   적 캐릭터를 가리지 않았던 것 같은데 지금은 가려져 … 아수라파천무의 암전은 아무것도 안보이는 까만색」) · 리마스터3D 갱신() 이 켬 상태를 되살리지 않게 _맵가림 을 본다 */
              this._리마스터3D && this._리마스터3D.캔버스, this._리마스터3D && this._리마스터3D.가림캔버스];
  if (this._map3dMapxBuildingPreview &&
      typeof this._map3dMapxBuildingPreview.forEachFaceNode === 'function')
    this._map3dMapxBuildingPreview.forEachFaceNode(function (node) { 지면.push(node); });
  for (var i = 0; i < 지면.length; i++) {
    var L = 지면[i];
    if (!L) continue;
    if (켬) { if (L._옛display === undefined) L._옛display = L.style.display; L.style.display = 'none'; }
    else { L.style.display = (L._옛display === undefined) ? '' : L._옛display; L._옛display = undefined; }
  }
  /* 맵 조각은 유닛과 한 층에 섞여 있으므로 **클래스로 갈라** 숨긴다.
   * ★ 목록은 **`render.js:4225` 의 것을 그대로** 쓴다 — 이 파일이 이미
   *   `.g2-map-structure, .g2-map-object-strip, .g2-rowflat, .g2-map-item, .g2-map-flatpiece`
   *   를 「맵 조각」으로 다루고 있다. `g2-map-object` 는 `-strip` 의 **자식**이라 함께 내려간다.
   * ☠ 처음에 `g2-map-object`·`g2-map-flatanim` 으로 적었다가 실측에서
   *   **`g2-map-object-strip` 23개와 `g2-rowflat` 32개가 그대로 보였다.** 이름을 짐작해서다. */
  var 맵조각 = 'g2-map-structure g2-map-object-strip g2-map-tree-composite g2-rowflat g2-map-item g2-map-flatpiece'.split(' ');
  /* ★ 되돌릴 때는 층을 다시 훑지 않고 **가린 목록**으로 되돌린다 (2026-10-08)
   *   ☠ 가린 뒤 `오브젝트배경아래(true)` 가 맵 조각을 배경 앞으로 옮기면, 끌 때 spriteLayer 를 훑어도 못 찾아
   *     `display:none` 이 그대로 남고 다시 올라와도 안 보였다 — 상자는 `syncMapItems` 가 「그대로다」로 넘겨 영영 사라졌다
   *     (사장님 「맵에 상자를 지우는 효과가 있어. 아마 마법이나 필살기 중 하니인 것 같아」 · 시험 탭 3-3 가림→내림→풀기→올림 = 상자 5→0) */
  var 층 = this.spriteLayer;
  if (!this._맵가린조각) this._맵가린조각 = [];
  if (켬 && 층) {
    for (var k = 0; k < 층.children.length; k++) {
      var e = 층.children[k], cn = ' ' + (e.className || '') + ' ', 맵인가 = false;
      for (var m = 0; m < 맵조각.length; m++) if (cn.indexOf(' ' + 맵조각[m] + ' ') >= 0) { 맵인가 = true; break; }
      if (!맵인가) continue;
      if (e._옛display === undefined) e._옛display = e.style.display;
      e.style.display = 'none';
      if (this._맵가린조각.indexOf(e) < 0) this._맵가린조각.push(e);
    }
  } else if (!켬) {
    for (var k2 = 0; k2 < this._맵가린조각.length; k2++) {
      var e2 = this._맵가린조각[k2];
      e2.style.display = (e2._옛display === undefined) ? '' : e2._옛display; e2._옛display = undefined;
    }
    this._맵가린조각.length = 0;
  }
  try {
    var 화면초안 = root.G2Map3DUAuthoringDraft;
    if (화면초안 && typeof 화면초안.onCameraChanged === 'function')
      화면초안.onCameraChanged(this);
  } catch (_) {}
  return this;
};

/**
 * ★★★★★ **아군을 잠깐 감춘다** — 문라이트 전용 (2026-09-08 · 사장님 지적 M8)
 *
 * > 「문라이트 배경 앞에 **적군만** 그려져야하는데, 아군도 그려지고」
 *
 * 원본은 그 도막에서 **적만 모은 목록**을 훑어 그린다 —
 * ```asm
 * 0x5890F  eax = [edx*4 + 0xF0BA8]   ; 그 배열의 유닛
 * 0x58919  call 0x12F2A              ;   그리기
 * 0x5891F  cmp dx, [0xF13AA]         ;   그 배열의 개수
 * ```
 * 그 배열은 채울 때 `0x585CC call 0x1201D`(진영 견주기)로 **적만** 담는다
 * (`magicfx.js:9506` · `00_지금조사_전격빙한.md:31`).
 *
 * ☠ 유닛 상자를 지우지 않고 `display` 만 만진다 — 되돌릴 때 원래 값으로 돌린다.
 */
Renderer.prototype.아군가리기 = function (켤까, 내편) {
  var 켬 = !!켤까;
  if (this._아군가림 === 켬) return this;
  this._아군가림 = 켬;
  var 편 = (내편 == null) ? 1 : (내편 | 0);
  /* ☠ `unitEls` 의 키는 **유닛 id** 이고 상자에는 유닛 참조가 없다(실측 2026-09-08).
   *   그래서 `battle.units` 에서 id 로 찾는다. */
  var els = this.unitEls || {};
  var 목록 = (this.b && this.b.units) || [];
  var byId = {};
  for (var n = 0; n < 목록.length; n++) if (목록[n]) byId['' + 목록[n].id] = 목록[n];
  /* ☠ `style.display` 만 만지면 `apply()` 가 매 프레임 되돌린다(실측 2026-09-08).
   *   `hideUnit` 은 `_hidden[id]` 에 표시해 **다시 그려도 유지**된다. */
  this._아군가림목록 = this._아군가림목록 || [];
  if (켬) {
    this._아군가림목록 = [];
    for (var n2 = 0; n2 < 목록.length; n2++) {
      var v = 목록[n2];
      if (!v || (v.side | 0) !== 편) continue;          /* 적은 그대로 둔다 */
      this._아군가림목록.push(v);
      if (this.hideUnit) { try { this.hideUnit(v, true); } catch (e1) {} }
    }
  } else {
    for (var n3 = 0; n3 < this._아군가림목록.length; n3++)
      if (this.hideUnit) { try { this.hideUnit(this._아군가림목록[n3], false); } catch (e2) {} }
    this._아군가림목록 = [];
  }
  return this;
};

/** 카메라 좌상단 칸 — `camPixelOf` 의 역 (원본 [0x4A83C]·[0x4A83E]). */
Renderer.prototype.카메라좌상단칸 = function () {
  var 여백X = (좌표상수.논리화면가로 - this.CAM_TILES * TW) / 2;
  var 여백Y = (좌표상수.논리화면세로 - this.CAM_TILES * TH) / 2;
  return { x: Math.round((this.cam.cx - 좌표상수.논리화면가로 / 2 + 여백X) / TW),
           y: Math.round((this.cam.cy - 좌표상수.논리화면세로 / 2 + 여백Y) / TH) };
};

/**
 * 연출이 «목록의 유닛만» 그리는 동안 나머지를 숨긴다 — `null` 이면 숨긴 것만 되돌린다.
 *   문라이트 ②③ 은 유닛을 안 그리고(0x58740~0x58776 테두리 둘뿐) ④ 는 [0x80BA8] 목록만 그린다(0x5890F).
 *   이미 숨어 있던 유닛(죽음·솟기 전 등)은 건드리지 않는다.
 */
Renderer.prototype.유닛만보이기 = function (보일) {
  var 목록 = (this.b && this.b.units) || [];
  var 숨김 = this._유닛만숨김 || [];
  var i;
  if (보일 == null) {
    for (i = 0; i < 숨김.length; i++) if (this.hideUnit) { try { this.hideUnit(숨김[i], false); } catch (e1) {} }
    this._유닛만숨김 = [];
    return this;
  }
  for (i = 0; i < 목록.length; i++) {
    var v = 목록[i];
    if (!v) continue;
    var 보임 = 보일.indexOf(v) >= 0, 내가숨김 = 숨김.indexOf(v) >= 0;
    if (!보임 && !내가숨김 && !this._hidden[v.id]) { 숨김.push(v); try { this.hideUnit(v, true); } catch (e2) {} }
    else if (보임 && 내가숨김) { 숨김.splice(숨김.indexOf(v), 1); try { this.hideUnit(v, false); } catch (e3) {} }
  }
  this._유닛만숨김 = 숨김;
  return this;
};

/** 현재 카메라·유닛·표식 상태를 전체 월드 표시에 반영한다. */
/** ★ 같은 줄(y) 유닛끼리 DOM 순서를 x 오름차순으로 (2026-09-27 · Z-98) — 원본 0x12BEE 는 줄마다 왼쪽부터 유닛을 그린다
 *   우리 유닛은 3D 깊이로 겹쳐 같은 줄이면 DOM 순서(만든 차례)대로 그려졌다(비연참 원본 … 9(9,21) 8(11,21) ↔ 우리 8 9)
 *   유닛 상자끼리만 제 자리(자리표)를 서로 바꾼다 — 다른 요소와의 순서는 안 건드린다 */
Renderer.prototype._유닛돔차례 = function () {
  var E = this.unitEls, 무리 = new Map();
  for (var k in E) { var b = E[k]; if (!b || !b.parentNode || !b._칸) continue; var g = 무리.get(b.parentNode); if (!g) { g = []; 무리.set(b.parentNode, g); } g.push(b); }
  무리.forEach(function (bs, p) {
    if (bs.length < 2) return;
    var 지금 = Array.prototype.filter.call(p.children, function (c) { return bs.indexOf(c) >= 0; });
    var 차 = 지금.slice().sort(function (a, c) { return (a._칸[1] - c._칸[1]) || (a._칸[0] - c._칸[0]); });
    var 같다 = true; for (var i = 0; i < 차.length; i++) if (차[i] !== 지금[i]) { 같다 = false; break; }
    if (같다) return;
    var 표 = 지금.map(function (b) { var m = document.createComment('u'); p.insertBefore(m, b); return m; });
    지금.forEach(function (b) { p.removeChild(b); });
    for (var j = 0; j < 표.length; j++) { p.insertBefore(차[j], 표[j]); p.removeChild(표[j]); }
  });
};
Renderer.prototype.apply = function () {
  /* ★★★★★ 정본 254 — 전투가 쥔 지형은 «지금 그리는 맵»의 것이어야 한다 (2026-11-16 사장님 「이벤트로 킬러들이랑 한조 나오는 시나리오인데 한조 위치도 이상해 이동할 수 없는 곳에 나와」·「원작에 저렇게 나오지 않아!」)
   *   ☠ 맵을 로딩 중 미리 지어 넘겨받는 길은 _nativeMap단계 «이동판정»(battle.map · 지형 = 이 맵 layerC)을 안 거쳐, 전투가 부팅 묶음 지형(G2.terrain · 57×53 다른 맵)을 그대로 썼다
   *     실측(측정 창 9-9 · FR04): 지나갈 수 있는 칸이 원본(12~26줄 풀밭)과 통째로 달라 어두운 숲(22~32줄)까지 갈 수 있었고, 방식 1 등장 자리(0x50D3A)도 틀린 판으로 셌다
   *     · 원본 지형 판 0x88BD4 = 우리 layerC 2109/2109 같음 ⇒ 다를 때만 맞춘다(같은 객체인지만 본다 · op 0x10·SF 3D 이동칸은 같은 맵 객체를 고치므로 안 건드린다) */
  if (this.b && this.nmap && this.b.map !== this.nmap && root.G2Native && root.G2Native.mapTerrain) {
    this.b.map = this.nmap;
    try { this.b.terrain = root.G2Native.mapTerrain(this.nmap); } catch (e지형) {}
  }
  var 결과 = this._apply본();
  if (this._map3dOnSpec) {
    var onSpec = this._map3dOnSpec, onToggle = root.G2Map3DToggle;
    if (!onToggle || !this.mapx ||
        onToggle.resolve(this.mapx.sourceMap).buildingSurfaces.effective !== 'on' ||
        !onSpec.spec.options.proofCurrent ||
        onSpec.spec.options.proofCurrent() !== true)
      this.map3D건물진단();
    else if (this.cam && this.cam.tilt === 0 && this._map3dPreview)
      this.map3D건물진단(null, null, null, { preserveFlatOn: true });
    else if (this.cam && this.cam.tilt !== 0 && !this._map3dPreview)
      this.map3D건물진단(onSpec.spec.source, onSpec.spec.building,
        onSpec.spec.policy, onSpec.spec.options);
  }
  /* 실제 B 보존 마스크를 단 명시 면은 정면 투영에서 벽이 접힌다.
   * 기울기 0으로 돌아오면 원래 조각을 같은 프레임에 복원한다. */
  if (!this._map3dOnSpec && this.cam && this.cam.tilt === 0 && this._map3dPreview &&
      this._map3dPreview.proofReceipt && this._map3dPreview.spec &&
      this._map3dPreview.spec.options && this._map3dPreview.spec.options.keepMasks)
    this.map3D건물진단();
  /* 기본 off에서는 아무것도 하지 않는다. 명시 지형 화면 수치만 시점 변경에 폐기한다. */
  try {
    var 초안 = root.G2Map3DUAuthoringDraft;
    if (초안 && typeof 초안.onCameraChanged === 'function') 초안.onCameraChanged(this);
  } catch (_) {}
  /* 겹침 차례는 apply 가 다 끝난 뒤에 — 안에서 유닛 층을 옮기며 번호 순으로 다시 붙인다(3248행 무렵) */
  try { if (typeof document !== 'undefined') this._유닛돔차례(); } catch (e차) {}
  if(this._map3dGpuScene)this._map3dGpuScene.draw();
  return 결과;
};
Renderer.prototype._apply본 = function () {
  if (this._칠밀림 && this._칠밀림.length) { try { this._밀린칠하기(); } catch (e밀) {} }   /* 스케일러 팔레트 — 화면에 들어온 조각을 칠한다 */
  /* ★ 맵 아이템(보물)도 함께 갱신한다 — 먹으면 상자가 열린 그림으로 바뀐다
   *   (원본 0x1862F 가 `sete al` 로 「이미 먹었나」를 인덱스에 더한다). */
  try { if (this.b && this.syncMapItems) this.syncMapItems(this.b); } catch (e아이템) {}
  var c = this.cam;
  this._FR08나무표시적용();
  try { this._세움표시적용(); } catch (e세움표시) {}
  /* 원근은 화면 크기에 비례해야 배율을 바꿔도 왜곡감이 일정합니다 */
  var persp = (this.host.clientHeight || 600) * (3.2 - c.fov / 34);
  this.host.style.perspective = Math.max(200, persp) + 'px';

  /* 표시 보간 — 카메라도 프레임 사이를 채웁니다 (논리 c.cx/cy 는 그대로).
   * ★ 결과를 `_vcam` 에 남겨 둡니다 — 맵 밖에서 도는 이펙트 캔버스(G2Fx)도
   *   같은 값을 써야 맵과 어긋나지 않습니다. */
  var pc = this._pcam;
  var vcx = this._보간값(pc && pc.cx, c.cx), vcy = this._보간값(pc && pc.cy, c.cy);
  this._vcam = { cx: vcx, cy: vcy };
  var dx = -(vcx - this.mapW / 2) + this.shake.x;
  var dy = -(vcy - this.mapH / 2) + this.shake.y;
  /* ★★★★★ **화면에 얹는 값은 정수 픽셀로 못 박는다** (2026-08-27 · 사용자 지적)
   *
   *   > 「**144hz 메인 모니터에서는 일렁거리는데, 다른 60hz 모니터에서는 일렁거리지
   *   >  않아.** 그림자 모양도 메인 화면에서는 이상한데, 다른데에서는 괜찮아.」
   *
   *   원본 카메라 `[0xBA83C]`/`[0xBA83E]` 는 **정수 픽셀**이다. 스크롤도 정수 걸음
   *   (`step → n` = 1·2·4·8)이라 소수점이 생길 자리가 없다.
   *   우리는 `camTo` 의 smoothstep·표시 보간 때문에 `493.91655600000183` 처럼
   *   **긴 소수 꼬리**가 붙는다. 그 값이 `translate3d` 로 들어가면 3D 합성기가
   *   **매 래스터마다 다른 서브픽셀에 샘플링**한다 — 주사율이 높을수록 래스터가
   *   잦아 눈에 **일렁거림**으로 보인다. 60 Hz 에서 안 보이던 이유가 이것이다.
   *
   *   ★ **논리 값(`c.cx`/`c.cy`)은 건드리지 않는다** — 보간·도착 판정이 그 값을 쓴다.
   *     화면에 얹는 `dx`·`dy` 만 정수로 만든다.
   *   ★ `_vcam` 도 같은 값으로 맞춘다 — 이펙트 캔버스가 맵과 어긋나면 안 된다.
   *   ★ 배율(`c.zoom`)이 정수가 아니어도, **정수 논리 픽셀**에서 확대하는 것은
   *     `image-rendering: pixelated` 가 안정적으로 처리한다. 문제는 **입력이
   *     소수일 때** 생긴다. */
  /* ☠ **논리 픽셀로 반올림하면 안 된다** (2026-08-27, 같은 날 고침)
   *   > 사용자: 「갑자기 왜이렇게 **버벅거리지?**」
   *   배율이 3.825 배라 논리 1 px 이 화면 3.8 px 이다. 논리 정수로 스냅하면
   *   스크롤이 **3.8 px 씩 계단**으로 뛴다 — 보간이 통째로 무의미해진다.
   *   ⇒ **장치 픽셀** 기준으로 맞춘다. 화면에서는 정수 픽셀에 앉으면서(서브픽셀
   *     재샘플링이 사라진다) 논리 걸음은 1/3.825 px 까지 잘게 남는다. */
  var _z = (c.zoom || 1) * ((root.devicePixelRatio || 1));
  if (_z > 0) { dx = Math.round(dx * _z) / _z; dy = Math.round(dy * _z) / _z; }
  this._vcam = { cx: this.mapW / 2 - dx + this.shake.x, cy: this.mapH / 2 - dy + this.shake.y };

  /* ★ 확대는 scale 로 합니다.  translateZ 는 뒤로 미는 것이라 커지지 않습니다. */
  var worldTf =
    'scale(' + c.zoom + ')' +
    ' translateZ(' + (-c.dist) + 'px)' +
    ' rotateX(' + c.tilt + 'deg)' +
    ' rotateZ(' + c.rot + 'deg)' +
    ' translate3d(' + dx + 'px,' + dy + 'px,0)';
  this.world.style.transform = worldTf;
  /* ★★★ **역변환용으로 그대로 남긴다** — `_worldInv()` 가 `getComputedStyle` 을
   *   부르지 않게 하려는 것이다. 그 호출은 **강제 스타일 재계산**을 일으켜
   *   `screenToTile()` 이 mousemove 마다 도는 우리 구조에서는 눈에 띄게 느려진다
   *   (사용자 지적 2026-08-25: 「작동은 정상인데 **처리가 너무 느린데?**」). */
  this._wiTf = worldTf;
  this._wiP = parseFloat(this.host.style.perspective) || 1000;
  /* 지면 그룹 — 월드와 **같은 변환**. 월드보다 앞이라 아래에 합성된다(생성자 주석). */
  if (this.groundLayer) this.groundLayer.style.transform = worldTf;
  if (this.fxWorldUnderLayer) this.fxWorldUnderLayer.style.transform = (this.shake.x || this.shake.y)
    ? worldTf.replace(/translate3d\([^)]*\)$/, 'translate3d(' + (dx - this.shake.x) + 'px,' + (dy - this.shake.y) + 'px,0)')
    : worldTf;
  /* 오버레이(선택박스·방향화살표) — 월드와 **같은 변환**을 쓰되 월드보다 뒤(위에 합성)에 둬서
   *   캐릭터에 가리지 않고 항상 보인다. 같은 변환이라 지면 원근·위치는 그대로. */
  if (this.overlayLayer) this.overlayLayer.style.transform = worldTf;
  /* 마법·필살기 이펙트 — 같은 변환, 월드보다 위에 합성(기울여도 캐릭터에 안 가린다)
   * ★★★★★ **단, 흔들림은 뺀다** (2026-09-25 · 원본 그리기 기록 대조)
   *   원본 흔들림 `[0xBA838]` 은 `0x10988`(칸y→화면y = (y−camY)×16 + [0xBA838] + 4)을 거쳐 **매 프레임 다시 계산되는
   *   맵·유닛에만** 걸린다. 연출은 자기 화면 자리에 그대로 그린다 — 파이어블래스트(0x20444 0↔−2)의 기둥은 늘 y −78,
   *   빙한3(4장마다 −2)의 결정도 흔들림 장에 제자리였다. 우리는 연출 층도 월드 변환(흔들림 포함)을 받아 같이 흔들렸다. */
  if (this.fxTopLayer) {
    this.fxTopLayer.style.transform = (this.shake.x || this.shake.y)
      ? worldTf.replace(/translate3d\([^)]*\)$/, 'translate3d(' + (dx - this.shake.x) + 'px,' + (dy - this.shake.y) + 'px,0)')
      : worldTf;
  }
  if (this.fxTopFrontLayer) this.fxTopFrontLayer.style.transform = this.fxTopLayer.style.transform;
  /* 아래 연출 층은 지면 그룹의 자식이라 흔들림을 물려받는다 — 반대로 옮겨 없앤다 */
  if (this.fxUnderLayer) this.fxUnderLayer.style.transform = (this.shake.x || this.shake.y)
    ? 'translate3d(' + (-this.shake.x) + 'px,' + (-this.shake.y) + 'px,0)' : '';
  /* 캐릭터 위층 — 맵 층과 같은 변환 (`유닛위층`) */
  if (this.unitTopLayer) this.unitTopLayer.style.transform = worldTf;
  if (this.unitMidLayer) this.unitMidLayer.style.transform = worldTf;
  /* ★ 화면 전역 연출을 얹는 카메라판은 아래/위 모두 같은 위치·배율을 쓴다. */
  if (this.fxCamPlaneUnder) this._연출카메라아래평면놓기();
  if (this.fxCamPlane) this._연출카메라평면놓기();

  /* 세워 놓은 것들(유닛·이펙트·선택 상자) — 부모 회전을 되돌려 화면 정면을 보게 합니다.
   * 바닥과 오브젝트는 눕힌 채 두므로 여기서 건드리지 않습니다. */
  var self = this;
  this.b.units.forEach(function (u) { self.updateUnit(u); });
  Object.keys(this.unitEls).forEach(function (k) { self._빌보드적용(self.unitEls[k]); });
  this.objEls.forEach(function (e) { self._빌보드적용(e); });
  /* ★ 원본은 서 있는 오브젝트를 «윗변이 화면 −80 이상 · 196 미만»일 때만 그린다 (2026-09-25)
   *   0x10CBD 목록 만들기: 0x10D13 윗변 = 행 화면 y − 높이 · 0x10D21 +0x50 · 0x10D2B cmp di,0x114 · jae(부호 없음) → 목록에서 뺌.
   *   원본 그리기 기록(칸 0·3·145): 원본 오브젝트는 모두 우리와 같은 자리였고, 우리에만 «윗변 −92» 줄이 더 있었다(화면 위 4px 걸침).
   *   카메라가 평면(원본 보기 — 기울기·회전 0)일 때만 건다. 화면 윗변 = 바닥y − 높이 − 카메라y + 100 + 흔들림 (camPixelOf 여백 4 · 0x10988 +4 가 상쇄) */
  /* (2026-09-25 한때 껐다가 — 아래 «다시 켰다» 참고) */
  /* ★ 다시 켰다 — «전부 감췄다»로 보인 것은 대조 도구의 눕힘 거르개 탓이었다. 식은 기록으로 확인했다:
   *   우리 기록(칸 42·43·44 · 455표본)에서 화면 윗변 = style.top − 보간 카메라 y + 흔들림 + 388(= 맵높이/2 + 100) 이 한 값으로 맞는다.
   *   눕힌 조각(시험 전장 벽 24×96)에도 건다 — 한 행을 한 장으로 묶은 띠(_rowFlatEls)는 낱개 윗변을 몰라 뺀다 */
  var _원본평면 = !(c.tilt || 0) && !(c.rot || 0);
  /* ★ [리마스터] 축소(배율 < 원작 배율)면 거르지 않는다 (2026-09-29 사장님 「배율을 축소한 뒤 맵을 스크롤하면 오브젝트가 깜빡거리는 문제도 있어」)
   *   축소하면 원본 화면(가운데 13열 × 200)이 보이는 창의 한가운데 작은 조각이 되고, 그 윗변 위도 창 안에 보인다.
   *   그래서 «원본 화면 윗변 −80 위에서 시작하는 오브젝트»가 창 한가운데서 사라졌다가, 스크롤로 13열 띠를 벗어나면 다시 나타났다.
   *   실측(2-3 · 배율 1/3 · 24px 걸음): g2-map-object 조각이 화면 x 295~359 에서 12걸음 동안 visibility:hidden → 다시 보임.
   *   원본에는 축소가 없다 — 원작 배율·확대에서는 그대로 거른다 */
  if (_원본평면 && typeof this.nativeZoom === 'function' && (c.zoom || 0) < this.nativeZoom() - 1e-6) _원본평면 = false;
  /* ★ [리마스터] 원작 배율·확대에서도 거르지 않는다 (2026-09-30 사장님 「오브젝트 깜빡거리는거 아직도 그렇잖아!」)
   *   실측(2-3 · 가로 4px×60 · 세로 4px×40 스크롤 · 보이는 창 안에서만 셈): 배율 2.07(원작) 에서 56번 보임↔숨김이 뒤집혔고
   *   그 가운데 47번이 이 거르기(키 큰 오브젝트가 윗변 −80 을 넘나들 때 통째로 나타났다 사라짐)였다. 축소(1.03)는 0번.
   *   원본도 같은 식으로 튀지만 사장님이 깜빡임으로 보셨으므로 늘 그린다 — `리마스터_적용현황.md` 에 한 줄. */
  _원본평면 = false;
  var _띠 = this._rowFlatEls || [];
  var _vcy = this._vcam ? this._vcam.cy : c.cy, _sy2 = (this.shake && this.shake.y) | 0;
  var _vcx = this._vcam ? this._vcam.cx : c.cx, 캠열 = Math.floor((_vcx - this.camPixelOf({ x: 0, y: 0 }).cx) / TW + 1e-6);   /* 원본 camX */
  /* ★★★★★ 거르기는 «원본 화면 안»에만 건다 (2026-09-26 사장님 「배율 확대시 오브젝트 자체가 보이는 화면에 다 그려지지 않고
   *   원본 창 범위에만 그려지는 문제도 있어」). 창이 원본 320×200 보다 넓으면 그 바깥은 원본에 없는 자리라 원본이 뺀 오브젝트도 그린다.
   *   · 열 거르기(13열)는 원본 화면 옆 바깥 열이다 → 거르지 않는다(그 열은 원본 화면에 안 든다)
   *   · 윗변 거르기는 원본 화면 안에 걸친 것만 — 원본 화면과 겹치는 열(0..12)에 있고 세로로 0..200 에 걸칠 때 */
  this.objEls.forEach(function (e) {
    if (!e || _띠.indexOf(e) >= 0) return;
    var 밖 = false;
    var _k = (e._col != null) ? (e._col - 캠열) : 0;
    var 열안 = _k >= 0 && _k <= 12;                         /* 0x10D4E cmp di,0xD — 원본 화면에 드는 13열 */
    if (_원본평면 && 열안) {
      var 윗변 = Math.round((parseFloat(e.style.top) || 0) + self.mapH / 2 - _vcy + 100 + _sy2);
      var 높이 = parseFloat(e.style.height) || 0;
      밖 = ((윗변 + 0x50) >>> 0) >= 0x114                   // 0x10D21 · 0x10D2B jae (부호 없음)
        && 윗변 < 200 && 윗변 + 높이 > 0;                    //   원본 화면 세로 안에 걸친 것만
    }
    if (밖 !== !!e._원본범위밖) { e._원본범위밖 = 밖; e.style.visibility = 밖 ? 'hidden' : ''; }
    if (e._colParts) e._colParts.forEach(function (pp) {
      /* 열 조각 — 부모가 원본 화면 안이라 감춰졌어도 원본 화면 옆 바깥 열 조각은 보인다 */
      var 조안 = (pp._col - 캠열) >= 0 && (pp._col - 캠열) <= 12;
      var 조밖 = 밖 && 조안;
      var v = 조밖 ? 'hidden' : (밖 ? 'visible' : '');
      if (pp._원본범위vis !== v) { pp._원본범위vis = v; pp._원본범위밖 = 조밖; pp.style.visibility = v; }
    });
  });
  /* 행동 가능 마커도 유닛 박스의 자식이라 유닛 변환을 물려받습니다 (readyMarks 참고) */
  this.fxEls.forEach(function (e) { self._빌보드적용(e); });
  /* 집중 이펙트는 유닛 박스의 자식이라 유닛 변환을 그대로 물려받습니다 —
   * 여기서 따로 걸지 않습니다(걸면 회전 중심이 달라 유닛에서 떨어집니다). */
  (this.boxEls || []).forEach(function (e) { self._빌보드적용(e); });
  /* ★★★★★ **맵 아이템도 다시 세운다 — 상자는 세우고 아이콘은 눕힌다** (2026-09-23)
   *
   *   > 사장님: 「전투맵의 **아이템 상자가 바닥에 눕혀져 있어서 기울였을때 모양이
   *   >  이상해.** 상자는 세우는게 좋겠어.」
   *   > 「상자는 **나무상자와 초록색상자(잠긴상자) 둘다** 확인해줘.
   *   >  **일반 아이템은 눕혀야해.**」
   *
   *   상자는 처음부터 빌보드로 만들었는데(`syncMapItems` → `_맵아이템그림`),
   *   ☠ `syncMapItems` 는 그림이 그대로면 **「손대지 않는다」로 빠져나간다.**
   *     그래서 카메라를 기울여도 `_빌보드적용` 이 다시 안 걸리고, 만들 때의
   *     변환(기울기 0 → `transform:none`)이 남아 **지면에 눕는다.**
   *   ★ 눕고 서는 것은 `_billboardMode` 가 가른다 — `syncMapItems` 에서
   *     아이콘(`ITEM.SPR`)에만 `'floor'` 를 달아 눕힌다.
   *     상자는 조건 1(나무 `FLD_MISC` 0·1) · 조건 2(금속·잠김 2·3) **둘 다**
   *     `kind:'box'` 라 함께 선다 (`state.js mapItemLook` · 0x18711·0x18719). */
  var 아이템칸 = this._itemEls;
  if (아이템칸) Object.keys(아이템칸).forEach(function (k) { self._빌보드적용(아이템칸[k]); });
  if (this.facingBoxEl) this._빌보드적용(this.facingBoxEl);
  /* 배경벽 — 접는선 경첩에서 tilt 를 되돌려 세운다(카메라 향함). tilt=0 이면 눕어 바닥과 연속. */
  if (this.backdropEl) this.backdropEl.style.transform = 'rotateX(' + (-c.tilt) + 'deg)';
  /* ★★★ 배경(FPM)은 **세우지 않는다** — 맵과 함께 눕는다 (2026-08-17 · 사용자 지정)
   *
   *   사용자: 「독립레이어로 하면 안돼. **안에 넣고 한번에 눕혀야해.**」
   *          「정확히는 **맵 바깥으로 배경이 삐져나오면 안된다**는 소리야.」
   *
   *   전에는 배경벽과 같은 `rotateX(−tilt)` 를 줘서 **세웠다**. 그러면 그 판이
   *   맵 평면 위로 솟아 **맵 바깥까지 뻗는다.** 지면화 전에는 배경 맵에 지면이
   *   0개(`foldY = mapH`)라 드러나지 않았을 뿐이다.
   *
   *   자체 회전을 안 걸면 `world` 변환만 받아 **맵 평면에 그대로 눕고**,
   *   크기가 `mapW×mapH` 라 맵 사각형과 정확히 겹친다.
   *   (배경벽 `backdropEl` 은 접는선에서 세우는 것이라 그대로 둔다.
   *    `foldY > 0` 이면서 `.FPM` 도 있는 맵은 지금 없다 — 생기면 다시 본다.) */
  if (this.fpmEl) this.fpmEl.style.transform = 'none';
  /* ★ 배경 **윗조각**은 배경벽과 **완전 동평면**으로 세운다 (2026-08-24 · 계획 §4).
   *   `foldY > 0` 이면서 `.FPM` 도 있는 맵 — 위 주석의 「생기면 다시 본다」가 이것이다.
   *   각도가 배경벽과 조금이라도 다르면 깊이가 갈려 **DOM 순서로 못 이긴다.** */
  if (this.fpmTopEl) this.fpmTopEl.style.transform = 'rotateX(' + (-c.tilt) + 'deg)';
  this._원경시차반영(vcx, vcy);
  this._스프라이트대열정렬();
  try { this._평면대열적용(worldTf); } catch (e평면) { if (root.console) console.warn('[평면대열]', e평면 && e평면.message); }
  if (this._map3dFaceOwnerProbe) this._map3dFaceOwnerProbe.sync();
  if (this._map3dMapxBuildingPreview &&
      typeof this._map3dMapxBuildingPreview.syncOwner === 'function')
    this._map3dMapxBuildingPreview.syncOwner();
  /* ★★★ **한 프레임의 배치가 끝난 자리** — 여기서 알린다 (2026-08-17 · §32-45)
   *
   *   `tickAilmentFx()` 만으로는 모자랐다. 유닛이 **움직이는 동안**에는
   *   게임 루프가 `updateUnit()` 을 직접 부르므로 훅이 안 걸려,
   *   미러의 **그림자 좌표가 1 px 씩 밀렸다**(실측 2026-08-17: 259프레임에
   *   **188건** — 유닛이 정지 상태였던 앞선 시험에서는 0건이라 「재현 실패」로
   *   적었던 바로 그것이다).
   *
   *   `apply()` 는 프레임당 한 번 도는 배치 마무리라 여기가 맞다. 붙는 쪽에서
   *   microtask 로 병합하므로 여러 번 불려도 동기는 한 번이다. */
  this._시각변경알림('apply');
};

/* ==================================================================== *
 *  배경 시차 — **지금은 쓰지 않는다** (2026-08-16)
 *
 *  배경을 화면에 고정해 두던 시절에는 카메라 진행률만큼 `background-position`
 *  을 옮겨 「먼 하늘이 천천히 흐르는」 효과를 냈다. 근거는 그림 크기뿐이었다
 *  (`SKY*.XCP` 960 = 화면 320 의 3배 · 맵 1536 보다는 작다).
 *
 *  이제 배경은 `world` 안 **맵 크기**로 깔리므로 맵과 **함께** 움직인다.
 *  시차를 또 주면 이중으로 흐른다. 원본이 시차를 주는지는 **미확인**이라,
 *  확인되기 전까지는 맵에 붙여 둔다.
 *
 *  ★ 헛짚은 기록: 화면 고정일 때 이 값을 `mapW − 320` 기준으로 계산했더니
 *    양끝이 34.6 % ~ 88.3 % 로 나와 배경이 끝까지 안 훑였다. 카메라가 실제로
 *    갈 수 있는 범위는 `clampCamera` 의 `(타일수 − CAM_TILES) × TW` 다.
 * ==================================================================== */
Renderer.prototype._원경시차반영 = function () {
  /* ★★★★★ **배경 줄 고르기 — 원본 식 그대로** `COMBATII 0x10B6D`~`0x10BDC`
   *
   *   > 사용자 ②: 「**원작은 원근이 적용되는 것처럼 보여.** 우리는 바닥과 함께
   *   >  구워져서 카메라가 이동하면 **그대로 따라오는데**, 원작은 카메라가 위에
   *   >  있을때 **산이 먼저 보이고** 아래로 내려오면서 **맵과 동일한 높이로
   *   >  내려오지 않아.**」
   *
   *   ```asm
   *   0x10AEB  함수 시작 — eax = 카메라 칸x · dx = 카메라 칸y
   *   0x10AF4  [esp+4] = dx                     ; ★ 칸y 를 여기 둔다
   *   0x10B71  cmp 칸y, S ; jge 0x10BB1         ;   S = [0x4A836]
   *   ── 위쪽 갈래 (칸y < S) ─────────────────────────────
   *   0x10B8E  eax = S − 칸y
   *   0x10B96  eax = (S − 칸y) × 4              ; ★ 칸당 **4줄**
   *   0x10B9C  ecx = 150 − 그것
   *   0x10B9E~0x10BA8  eax = T / 4              ;   T = 화면 원점 y (0 … −15)
   *   0x10BAD  줄 = ecx − T/4                   ; ★ 합쳐서 **1/4 속도**
   *   ── 아래쪽 갈래 (칸y ≥ S) ───────────────────────────
   *   0x10BC1  줄 = 칸y + 150 − S               ;   칸당 **1줄**
   *   ── 공통 ───────────────────────────────────────────
   *   0x10BCA  eax = 줄 × 15 ; 0x10BD7 eax <<= 5 = 줄 × **480** (.FPM 한 줄)
   *   0x10BDC  call 0x5EAE3                     ;   그 줄부터 화면(200줄)으로
   *   ```
   *
   *   ★ `T` 는 **칸 안 나머지의 음수**다 — `0x11180 cmp T,−0x10 / jg` 로
   *     −16 에서 되감으며 `칸y` 를 올린다. 곧 `T = −(화면위 y mod 16)`.
   *     위쪽 갈래에서 `−T/4` 가 칸 안에서 4 px 마다 1줄씩 더해, 한 칸(16 px)에
   *     정확히 **4줄** — 칸 경계의 `×4` 와 이어져 **끊김 없이 1/4** 이 된다.
   *
   *   ★ `S` 는 **맵 파일 꼬리의 2바이트**다(`0x10913` · `decodeMAP` 의 `배경.S`).
   *     실측: `IM05`(1-1) **14** · `SKY01` 13 · `SKY04` 19 · `AST`·`PAN`·`SPACE*` 0.
   *
   *   ── 우리 대응 ─────────────────────────────────────────────────────
   *   배경 요소는 `groundLayer` 안에 **맵과 함께 눕는다**(사용자 지정:
   *   「독립레이어로 하면 안돼」·「맵 바깥으로 삐져나오면 안된다」).
   *   그래서 **그림 크기는 원본대로 두고**(480×400), 화면 위 y 가 배경의 `줄` 을
   *   가리키도록 `background-position-y` 를 매 프레임 맞춘다:
   *
   *     화면위 y(vy) = cam.cy − 100         (cam.cy 는 화면 **가운데** 맵 y)
   *     background-position-y = vy − 줄 − (요소 원점의 맵 y)
   *
   *   ☠ 전에는 `calc(100% + cy×3/4)` 로 「1:1 을 1/4 로 줄이는」 보정을 했다.
   *     속도는 맞았지만 **기준선 `S` 도 그림 크기도 원본이 아니었다.** */
  var cam = this._vcam || this.cam;
  if (!cam) return;
  var vy = Math.round(cam.cy - 100);              /* 화면 맨 위의 맵 y */
  var 칸y = Math.floor(vy / TH);
  var 나머지 = vy - 칸y * TH;                     /* 0 … 15 */
  var S = (this._fpmS == null) ? -1 : (this._fpmS | 0);
  var 줄;
  if (칸y < S) {
    /* T = −나머지 · T/4 는 0 쪽으로 자른다(`sar` + `sbb` 보정) ⇒ −T/4 = ⌊나머지/4⌋ */
    줄 = 150 - (S - 칸y) * 4 + Math.floor(나머지 / 4);      /* 0x10BAD */
  } else {
    줄 = 칸y + 150 - S;                                     /* 0x10BC1 */
  }
  /* ★★★★★ **가로도 카메라를 따른다 — 칸당 2 px** (2026-09-05 신설)
   *
   *   > 사용자 (2026-09-04): 「1-1 같은 맵은 배경을 뒤에 깔고 위에 맵을
   *   >  얹어서 표현해. 그런데 이 **배경 위치가 잘못**되었어. 우리 맵이
   *   >  원작이 화면에 비추는 배경보다 **오른쪽을 비추고** 있어.」
   *
   *   ☠ 세로만 옮겨 있었다. **가로를 손대는 줄이 한 줄도 없었다** —
   *   `background-position: center` 로 **맵 폭 중앙에 고정**해 두고 있었다.
   *
   *   원본 `COMBATII 0x10AEB` —
   *   ```
   *   0x10AF9  [0xBA83C] = ax        ; 카메라 칸x 그대로 ebx 에도 남는다
   *   0x10B37  movsx eax, bx         ; ★ 칸x
   *   0x10B3A  add   eax, eax        ; ★ ×2   — 칸 하나에 배경 2 px
   *   0x10BD1  add   ebx, 0x8B3E8    ;   .FPM 버퍼 베이스
   *   0x10BDA  add   eax, ebx        ; ★ 시작 = 베이스 + 줄×480 + 칸x×2
   *   0x10BDC  call  0x5EAE3         ;   그 자리부터 화면으로
   *   ```
   *   칸 가로가 24 px 이므로 **1/12 속도**로 흔른다
   *   (세로는 칸당 4 px / 칸 높이 16 px = 1/4).
   *
   *   ★ `0x10B5C mov dx,[0x7001C] / test dx,dx / jg` 로 **1 px 더하는 갈래**가
   *     따로 있다. `[0x7001C]` 가 무엇인지 **아직 못 박았다** —
   *     실측은 칸x 23일 때 12 · 칸 6,14 일 때 −8 · 칸 10,23 일 때 12.
   *     칸 안 나머지로 설명이 안 된다. ⇒ **추측해 넣지 않는다**(CLAUDE.md §2-1).
   *     `0x24C1A add word [0x7001C],2` · `0x24C8F sub …,2` · `0x24C2C cmp …,4` 가
   *     있는 것으로 보아 **가로 스크롤 걸음**이다. 거기까지가 지금 아는 전부다. */
  var vx = Math.round(cam.cx - 160);              /* 화면 맨 왼쪽의 맵 x */
  var 칸x = Math.floor(vx / TW);
  var 시작px = 칸x * 2;                              /* 0x10B3A */

  var e = this.fpmEl;
  if (e) {
    e.style.backgroundPositionY = (vy - 줄 - (this._fpmFoldPx | 0)) + 'px';
    e.style.backgroundPositionX = (vx - 시작px + (this._fpm왼잘 | 0)) + 'px';   /* ★ 잘라 낸 검은 끝 열만큼 민다 — 원래 열은 제자리 (_원경짓기) */
  }
  var 층 = this._fpm표식층;
  if (층) {   /* [리마스터] 범위 표식의 원경 조각 — 원경과 같은 위치 (_원경짓기) */
    층.style.setProperty('--fpx', (vx - 시작px + (this._fpm왼잘 | 0)) + 'px');
    층.style.setProperty('--fpy', (vy - 줄 - (this._fpmFoldPx | 0)) + 'px');
  }
  var t = this.fpmTopEl;
  if (t) {
    t.style.backgroundPositionY = (vy - 줄) + 'px';
    t.style.backgroundPositionX = (vx - 시작px + (this._fpm왼잘 | 0)) + 'px';
  }
};


/** 세운 요소 하나의 최종 위치·회전. apply() 와 selectBox() 가 함께 씁니다. */
Renderer.prototype._빌보드적용 = function (e) {
  if (!e || e._ground == null) return;
  /* 표시 보간 — 논리 위치(_left/_ground)는 그대로, 화면 좌표만 섞습니다 */
  var gy = this._보간값(e._pg, e._ground);
  /* ★ 같은 값이면 안 쓴다 — 기울기 평면 대열에서는 style 쓰기마다 관찰기가 돌아 합친 변환을 다시 확인한다 (2026-10-08 성능) */
  var _왼 = (this._보간값(e._pl, e._left) - this.mapW / 2) + 'px';
  if (e._빌왼 !== _왼 || e.style.left !== _왼) { e.style.left = _왼; e._빌왼 = _왼; }
  var _들림 = e._들림 || 0;                          /* «높이» 그림 — 밑동에 세운 채 들어 올린다 (연출그림월드놓기 · Z-83) */
  var _지형좌표 = this._map3dTerrainPreview ? e._terrainPreviewAnchor : null;
  if (this._map3dTerrainPreview && !_지형좌표 && e._unit)
    _지형좌표 = { x: (e._unit.x | 0) + 0.5, y: (e._unit.y | 0) + 0.5 };
  /* 같은 저장 층에 놓인 세운 수목만 기존 접지 높이 창구로 옮긴다.
   * 여러 층을 가로지르는 띠와 눕힌 조각은 별도 소속 확인 전 보존한다. */
  if (!_지형좌표 && this._map3dTerrainPreview && this._map3dTerrainPreview.designated &&
      e._billboardMode === 'vegetation' && Number.isInteger(e._row)) {
    var _cols = (e._colParts || []).map(function(p){return p._col;});
    if (!_cols.length && Number.isInteger(e._col)) _cols.push(e._col);
    var _selfTerrain = this, _heights = _cols.map(function(x){
      return _selfTerrain.map3D지형높이후보(x+0.5,e._row+0.5);
    });
    if (_heights.length && _heights.every(function(h){return h === _heights[0];}))
      _지형좌표 = {x:_cols[0]+0.5,y:e._row+0.5};
  }
  var _지형높이 = _지형좌표 && this._map3dTerrainPreview
    ? this.map3D지형높이후보(_지형좌표.x, _지형좌표.y) : null;
  /* 명시 preview의 세로 투영 성분만 표시 좌표에 반영한다. 논리 접지는 그대로다. */
  var _지형들림 = (_지형높이 || 0) * Math.sin((this.cam.tilt || 0) * Math.PI / 180);
  e._terrainPreviewLift = _지형들림;
  var _위 = (gy - this.mapH / 2 - e._h - _들림 - _지형들림) + 'px';
  if (e._빌위 !== _위 || e.style.top !== _위) { e.style.top = _위; e._빌위 = _위; }
  if (_들림 || e._들림축) {                          /* 회전축 = 밑동 바닥 (밑변에서 _들림 만큼 아래) */
    e.style.transformOrigin = _들림 ? ('50% ' + (e._h + _들림) + 'px') : '50% 100%';
    e._들림축 = !!_들림;
  }
  /* 부모 회전의 실제 역행렬을 사용합니다. 각도 문자열을 반대로 나열하는 방식은
   * 회전이 함께 걸릴 때 오차가 누적되어 스프라이트가 지면에 눕습니다. */
  /* 나무/수풀은 기울기에 대해서만 세운다. Z 회전까지 역회전하면 바닥만 돌고
   * 숲은 화면을 향한 채 남아 서로 따로 노는 것처럼 보인다. */
  /* ★★★ **바닥 이펙트는 눕힌다** — 마법진·바닥 불 (2026-08-16)
   *
   *   사용자 지적: 「빙한 마법진은 **아직도 위에 표시**되는 것 같아」 →
   *   「화염도 **기울기 0에서는 아래에 깔리는데 기울기를 키우면 캐릭터 위로 올라와**」
   *
   *   그 한마디가 원인을 확정해 줬다. 빌보드는 **세워** 두므로, `preserve-3d`
   *   공간에서 화면 y 가 아래일수록 카메라에 **가깝다**. 바닥 이펙트는 발밑중앙
   *   보정으로 캐릭터보다 아래에 놓이니, **기울기가 커질수록 앞으로 튀어나온다.**
   *   DOM 순서(`spriteLayer` 앞)도 `translateZ(-2px)` 도 이 z 차이를 못 이긴다.
   *
   *   그래서 바닥 이펙트만 **세우지 않는다** — 회전을 안 걸면 `world` 의 기울기·
   *   회전을 그대로 받아 **지면 평면에 눕는다**. 지면 위에 선 캐릭터보다 언제나
   *   뒤다. `markLayer`(이동·공격 범위 표식)가 이미 이 방식이고 탈 없이 돈다.
   *   원본에서도 이 그림들은 **바닥에 깔리는 타원**이므로 눕는 쪽이 원본에 가깝다. */
  /* ★★★★★ **발밑 그림자는 눕힌다** — 「말 꼬리 뒤 픽셀 깨짐」 (2026-08-26)
   *
   *   사용자: 「초창기에 버그처럼 문제되었던 **말 꼬리 뒤에 버그로 화면 픽셀
   *   깨지는 것**까지 다시 나오네」 · 재현 조건 「2-4a 프리셋기본값에서 **기울기
   *   각도만 30** 정도주고 말이 **화면기준 상단**에 위치했을때 나타나」
   *
   *   ★ 정체는 **그림자였다.** 그림자를 끄면 격자가 통째로 사라진다(실측).
   *     원본 그림자(`SHADOW.SYB`)는 반투명이 없는 도스라 **체커보드 디더**다.
   *     그것이 유닛 상자 안에 있어 **빌보드로 같이 세워지고**, 기울기가 커지면
   *     상자 아래쪽(= 그림자)이 카메라 쪽으로 나와 **말 몸통·뒷다리 위로 겹쳤다.**
   *
   *   ★ **같은 함정을 2026-08-16 에 이미 겪었다** — 아래 `'floor'` 갈래가 그때 것이다
   *     (「화염도 기울기 0에서는 아래에 깔리는데 **기울기를 키우면 캐릭터 위로 올라와**」).
   *     원인도 해법도 똑같은데 그림자는 유닛 상자 **안**이라 그 갈래를 못 탔다.
   *
   *   ⇒ 상자가 건 빌보드 역회전을 **되돌려** 그림자만 지면 평면으로 돌린다.
   *     상자 변환을 정하는 바로 이 자리에서 함께 걸어야 카메라가 움직여도 어긋나지 않는다.
   *     (`updateUnit` 에서 걸면 기울기 슬라이더만 움직였을 때 갱신되지 않는다.) */
  var _shd = e._shd;
  if (_shd && _shd.style.display !== 'none') {
    /* ★★★★★ **그림자를 캐릭터와 **같이 세운다** (2026-08-27 · 사용자 승인)
     *
     *   > 사용자: 「그림자를 **캐릭터랑 같이 세워버리면** 어때?」 → 「그림자 캐릭터와
     *   >  같이 세우는걸로 하고」
     *
     *   ── 왜 이렇게 하나 ─────────────────────────────────────────────
     *   ① **원본에는 「기운 그림자」가 없다.** 원본은 320×200 2D 라 그림자를
     *      화면에 납작하게 찍을 뿐이다(`0x130D5` → `0x130FB`). 「기울였을 때
     *      어떤 모양이어야 하는가」는 **원본에 답이 없는 리마스터 문제**다.
     *      ⇒ 세워도 원본 충실도를 잃지 않는다.
     *   ② **일렁거림이 사라진다.** 그림자를 지면 평면(z=0)에 **정확히 눕히면**
     *      `world` 의 지면 조각과 **같은 깊이**가 되어 z-파이팅이 나고, 그 떨림이
     *      같은 `preserve-3d` 문맥의 **캐릭터까지** 흔들었다
     *      (사용자: 144 Hz 주 모니터에서만 보였다 — 합성 주기 문제).
     *      캐릭터와 같은 평면에 두면 겹칠 일이 없다.
     *   ③ **「캐릭터 위로 올라온다」도 같이 풀린다.** 서로 다른 평면이라 각도에
     *      따라 앞뒤가 뒤집혔다. 한 평면에 두면 **DOM 순서**가 결정한다 —
     *      그림자는 상자의 **첫 자식**이라 언제나 아래다(`_ensureUnit`).
     *      원본도 같은 유닛 그리기 안에서 그림자 → 본체 순서로 찍는다.
     *
     *   ── 어떻게 ─────────────────────────────────────────────────────
     *   자체 변환을 **걷어내면** 부모(상자)의 빌보드 변환을 그대로 받아
     *   캐릭터와 같이 선다. 그러면 「바닥에 누운」 느낌이 줄므로
     *   **세로로 `cos(tilt)` 만큼 눌러** 보정한다 — 2D 원본이 하던 일과 같다.
     *     tilt 0°  → 1.00 (원작 그대로)
     *     tilt 20° → 0.94
     *     tilt 52° → 0.62
     *   ★ 되돌리는 스위치: `window.__그림자눕히기 = true` (옛 눕힘 방식) */
    _shd.style.transformOrigin = '50% 50%';
    if (root.__그림자눕히기) {
      /* ☠ 옛 방식 — 지면에 눕힌다. z-파이팅과 일렁거림이 여기서 났다. */
      _shd.style.transform = 'rotateZ(' + this.cam.rot + 'deg) rotateX(' + this.cam.tilt + 'deg)';
    } else {
      var _tr = (this.cam.tilt || 0) * Math.PI / 180;
      var _sy = Math.cos(_tr);
      if (!(_sy > 0.05)) _sy = 0.05;                       /* 거의 눕힌 각도에서도 안 사라지게 */
      _shd.style.transform = 'scaleY(' + (Math.round(_sy * 1000) / 1000) + ')';
    }
  }

  /* ★★★★★ **기울기·회전이 0 이면 3D 변환을 아예 걸지 않는다** (2026-08-28)
   *
   *   > 사용자 ②: 「**맵타일과 오브젝트 사이에 경계선**이 보이는데 이부분도 안보여야해.」
   *
   *   `rotateX(0deg)` 는 회전이 없어도 **3D 합성 레이어**를 만든다. 그러면 브라우저가
   *   그 레이어를 따로 그린 뒤 합치면서 **가장자리에 1 px 반투명 띠**를 남기고,
   *   꽉 찬 그림(나무·바위 조각)에서는 그것이 **또렷한 경계선**으로 보인다.
   *   (스프라이트는 가장자리가 투명이라 티가 덜 난다 — 그래서 오브젝트만 눈에 띈다)
   *
   *   ★ 기울기 0 은 **원본과 같은 2D 화면**이다. 그 자리에서는 변환을 빼도
   *     결과가 똑같고, 합성 레이어가 안 생겨 경계선도 사라진다.
   *   ★ 원본에 없는 3D 를 우리가 얹은 데서 온 문제다 — 리마스터 항목. */
  var _기울 = this.cam ? (this.cam.tilt || 0) : 0;
  var _회전 = this.cam ? (this.cam.rot || 0) : 0;

  /* ★★★ 국소 변환을 먼저 문자열로 만든 뒤, **지난번과 같고 평면 대열이 합친 변환이 그대로면 다시 쓰지 않는다** (2026-10-08)
   *   ☠ apply 마다 모든 요소에 국소 변환을 덮어쓰고 → 평면 대열이 세계 변환과 다시 합쳐 쓰고 → 관찰기가 그 쓰기를 또 확인하는 핑퐁이
   *     기울기 45 에서 CPU 의 61~72% 를 먹었다 (헤드리스 실측 7-9 · 5초에 평면한요소 46만 번 · 프레임 평균 31~41ms)
   *     (사장님 「아씨발 근데 왜이렇게 버벅거려. 30년전 도스게임인데 왜 지금 최신사양에서도 버벅거리냐고」) */
  var _국 = (this._빌보드국소캐시 && this._빌보드국소캐시.키 === (_기울 + ',' + _회전)) ? this._빌보드국소캐시.값 : null;
  var _loc;
  if (e._billboardMode === 'floor') {
    _loc = 'none';
  } else if (e._billboardMode === 'vegetation') {
    _loc = _기울 ? ('rotateX(' + (-_기울) + 'deg)') : 'none';
  } else if (!_기울 && !_회전) {
    _loc = 'none';          /* ★ 항등 변환이면 걸지 않는다 */
  } else if (_국 != null) {
    _loc = _국;                                         /* 같은 기울기·회전이면 역행렬을 다시 안 만든다 */
  } else if (typeof DOMMatrix !== 'undefined') {
    var inv = new DOMMatrix()
      .rotateAxisAngle(1, 0, 0, this.cam.tilt)
      .rotateAxisAngle(0, 0, 1, this.cam.rot)
      .inverse();
    inv.m41 = inv.m42 = inv.m43 = 0;
    _loc = inv.toString();
    this._빌보드국소캐시 = { 키: _기울 + ',' + _회전, 값: _loc };
  } else {
    _loc = 'rotateZ(' + (-this.cam.rot) + 'deg) rotateX(' +
           (-this.cam.tilt) + 'deg)';
  }
  /* 연출 그림 뒤집기(연출그림반전반영) — 요소 제 평면에서 먼저 뒤집고 빌보드 회전을 건다 */
  if (e._반전tf) _loc = (_loc && _loc !== 'none' ? _loc + ' ' : '') + e._반전tf;
  var _판 = e.parentNode;
  var _합침그대로 = !!(_판 && _판._평면tf && e._합친tf != null && e.style.transform === e._합친tf);
  if (!(_합침그대로 && e._빌보드원문 === _loc)) { e.style.transform = _loc; e._빌보드원문 = _loc; }
  this._평면한요소(e);                                   /* 평면 대열 판이면 그 자리에서 세계 변환까지 (측정점이 곧바로 잰다) */
};

/**
 * 화면 방향으로 카메라를 밉니다 — 가장자리 스크롤(0x4A32C)에 씁니다.
 *
 * 원본은 2D 라 화면 방향 = 맵 방향이지만 여기서는 기울기·회전이 걸려 있으므로
 * `screenToTile` 의 역변환과 같은 식으로 화면 벡터를 맵 벡터로 되돌립니다.
 * @param {number} sx,sy  화면 픽셀 (배율 적용 전)
 */
Renderer.prototype.scrollScreen = function (sx, sy) {
  /* 사람이 화면 가장자리로 밀고 있으면 그게 우선입니다 — 가던 센터링을 끊습니다.
   * (안 끊으면 부드러운 스크롤과 서로 카메라를 당겨 덜덜 떨립니다.) */
  this._centerToken = (this._centerToken | 0) + 1;
  this._camAnim = false;
  var t = this.cam.tilt * Math.PI / 180, r = this.cam.rot * Math.PI / 180;
  var ct = Math.cos(t);
  var u = sx, v = sy / (Math.abs(ct) < 0.15 ? 0.15 : ct);
  var cr = Math.cos(-r), sr = Math.sin(-r);
  this.cam.cx += u * cr - v * sr;
  this.cam.cy += u * sr + v * cr;
  return this;
};

/** 카메라를 맵(+여백) 안으로 되돌립니다. 가장자리 스크롤이 무한히 나가지 않게 합니다. */
/**
 * 카메라를 맵 안에 가둡니다 — **원본 `0x11003` 과 같은 범위**.
 *
 * ```
 *   0x11023/0x11048  좌상단 타일 = clamp(값, 0, 맵크기 − 0xC)
 * ```
 * 픽셀 카메라(중심 기준)로 옮기면 `좌상단*24 + 160` 이므로
 * `160 ~ (맵타일 − 12)*24 + 160` 입니다.
 *
 * ★ 예전엔 `MARGIN`(2칸·4칸)만큼 **맵 밖으로 나갈 수 있게** 뒀습니다.
 *   그래서 이벤트에서 유닛을 따라가다 보면 화면이 맵 왼쪽 끝 바깥까지
 *   흘러가 검은 자리가 보였습니다. 원본은 카메라를 맵 안에 가두고,
 *   링이 잘리는 문제는 링 쪽을 평행이동해 풉니다(G2Ring.Calc.safeCenter).
 */
Renderer.prototype.clampCamera = function () {
  /* ★ 원본 0x11003 막힘은 카메라 «칸»으로 camX ∈ [0, 맵폭−12] · camY ∈ [0, 맵높이−12] 다(0x1100F~0x11056).
   *   카메라 칸 → 픽셀은 camPixelOf(여백 16·4 포함)이므로 한계도 그 식으로 낸다.
   *   ☠ 2026-09-25 — 예전 하한은 cx 160·cy 100 이라 맵 왼쪽·위 끝에서 원본(cx 144·cy 96)보다 16·4 px 덜 가 칸에 안 맞는 자리(0.67칸)에 섰다.
   *     원본 그리기 기록 대조: 대상이 맵 왼쪽(6칸)인 파이어블래스트·파이어필드 연출이 통째로 x 16 어긋났다. 오른쪽·아래 끝도 같은 만큼 밀려 있었다. */
  var N = this.CAM_TILES;
  var 최소 = this.camPixelOf({ x: 0, y: 0 });
  var 최대 = this.camPixelOf({ x: Math.max(0, this.tilesW() - N), y: Math.max(0, this.tilesH() - N) });
  this.cam.cx = Math.max(최소.cx, Math.min(최대.cx, this.cam.cx));
  this.cam.cy = Math.max(최소.cy, Math.min(최대.cy, this.cam.cy));
  return this;
};

/**
 * 화면 좌표 → 맵 타일.  마우스 조작에 씁니다.
 * world 변환의 역을 풀어야 하는데, 바닥은 z=0 평면이므로
 * 원근 나눗셈까지 포함해 닫힌 형태로 구할 수 있습니다.
 */
/**
 * ★★★★★ **화면 → 맵 픽셀, 실제 CSS 행렬로 역산** (2026-08-25 · 사용자 지적)
 *
 *   사용자: 「기울인 화면에서 **이동시 타일 선택이 제대로 안돼**」 ·
 *   「이동영역가능영역에 마우스가 따라다닐떄 **커서박스가 나타나는 위치가 마우스
 *    위치랑 달라**」
 *
 *   전에는 카메라 파라미터(tilt·dist·zoom)로 **손으로 역변환**했는데, 실제 화면은
 *   `world` 요소에 걸린 **CSS 행렬 + `view` 의 perspective** 로 만들어진다.
 *   둘이 조금만 어긋나도 먼 칸일수록 오차가 커진다 —
 *   실측(2-3 · tilt 20° · zoom 3.825): 아군 **1칸**, 화면 위쪽 고블린 **3칸** 어긋났다.
 *
 *   ⇒ **브라우저가 쓰는 그 행렬을 그대로 받아** 역산한다. 카메라 식이 바뀌어도 따라온다.
 *
 *   CSS 3D 파이프라인 (transform-origin `0 0` · perspective-origin = 중앙):
 *   ```
 *     (u, v, 0) --M--> (X, Y, Z)     M = world 의 matrix3d
 *     k = P / (P - Z)                P = view 의 perspective
 *     화면 = (X·k, Y·k) + 중앙
 *   ```
 *   미지수 u·v 둘, 식 둘이라 선형계로 정확히 풀린다:
 *   ```
 *     u(P·m11 + dx·m13) + v(P·m21 + dx·m23) = dx(P − m43) − P·m41
 *     u(P·m12 + dy·m13) + v(P·m22 + dy·m23) = dy(P − m43) − P·m42
 *   ```
 */
Renderer.prototype._월드역행렬 = function () {
  /* ★ `apply()` 가 남긴 값만 쓴다 — `getComputedStyle` 은 부르지 않는다(느리다). */
  var tf = this._wiTf, P = this._wiP;
  if (!tf || !(P > 0)) return null;
  var host = this.host;
  var key = tf + '|' + P + '|' + host.clientWidth + 'x' + host.clientHeight;
  if (this._wiKey === key) return this._wi;
  var M;
  try { M = (typeof DOMMatrix === 'function') ? new DOMMatrix(tf) : null; } catch (e) { M = null; }
  if (!M) return null;
  this._wiKey = key;
  this._wi = { M: M, P: P, ox: host.clientWidth / 2, oy: host.clientHeight / 2 };
  return this._wi;
};

/** 화면 좌표 → `world` 로컬 좌표 (= 맵 픽셀). 못 풀면 `null`. */
Renderer.prototype._화면에서월드로 = function (sx, sy) {
  var I = this._월드역행렬();
  if (!I) return null;
  var M = I.M, P = I.P;
  var dx = sx - I.ox, dy = sy - I.oy;
  /* DOMMatrix 는 열 우선이라 m11·m12·m13 이 첫 열(= u 계수)이다 */
  var a1 = P * M.m11 + dx * M.m13, b1 = P * M.m21 + dx * M.m23;
  var c1 = dx * (P - M.m43) - P * M.m41;
  var a2 = P * M.m12 + dy * M.m13, b2 = P * M.m22 + dy * M.m23;
  var c2 = dy * (P - M.m43) - P * M.m42;
  var det = a1 * b2 - a2 * b1;
  if (!det || !isFinite(det)) return null;
  var u = (c1 * b2 - c2 * b1) / det;
  var v = (a1 * c2 - a2 * c1) / det;
  if (!isFinite(u) || !isFinite(v)) return null;
  return { x: u, y: v };
};

/** 논리 화면 좌표를 현재 카메라의 전투 타일 좌표로 역변환한다. */
Renderer.prototype.screenToTile = function (sx, sy) {
  /* ★★★★★ **실제 CSS 행렬로 역산한다** (2026-08-25 · 사용자 지적)
   *
   *   사용자: 「기울인 화면에서 **이동시 타일 선택이 제대로 안돼**」 ·
   *   「이동영역가능영역에 마우스가 따라다닐떄 **커서박스가 나타나는 위치가 마우스
   *    위치랑 달라**」
   *
   *   아래 손계산은 원근 항이 근사라 **먼 칸일수록 어긋난다** —
   *   왕복 검산(2-3 · tilt 20° · zoom 3.825): 가까운 아군은 0칸, 화면 위쪽 고블린은
   *   **y 가 2칸** 밀렸다.
   *
   *   ⇒ 브라우저가 실제로 쓰는 `world` 의 `matrix3d` + `view` 의 perspective 로 푼다.
   *
   *   ★★★ **좌표계 대응** — 이걸 틀려서 한 번 되돌렸다(배치까지 깨졌다):
   *     · 요소 배치 `_빌보드적용`:  `left = 맵X − mapW/2` · `top = 맵Y − mapH/2 − h`
   *       ⇒ **행렬이 받는 (u,v) = 맵픽셀 − (mapW/2, mapH/2)**
   *     · 카메라는 **행렬 안에 있다** — `translate3d(dx, dy, 0)`,
   *       `dx = −(cx − mapW/2) + shake.x` (`apply()` `0x…` 아래 3950행대)
   *   ⇒ 후처리는 **`+ mapW/2` · `+ mapH/2` 뿐**이다. 카메라를 다시 더하면 **이중 적용**이 된다
   *     (처음에 그렇게 해서 x −7칸 · y +11칸 어긋났다). */
  var _w = this._화면에서월드로(sx, sy);
  if (_w) {
    var _px = _w.x + this.mapW / 2;
    var _py = _w.y + this.mapH / 2;
    return { x: Math.floor(_px / TW), y: Math.floor(_py / TH), px: _px, py: _py };
  }
  var c = this.cam;
  var W = this.host.clientWidth, H = this.host.clientHeight;
  var P = parseFloat(this.host.style.perspective) || 1000;
  /* 화면 중앙 기준 + 배율 되돌리기 */
  var x = (sx - W / 2) / c.zoom;
  var y = (sy - H / 2) / c.zoom;

  var t = c.tilt * Math.PI / 180, r = c.rot * Math.PI / 180;
  var ct = Math.cos(t), st = Math.sin(t);

  /* 평면 점 (u,v,0) → rotateX 후 (u, v·ct, −v·st) → translateZ(−dist)
   * 화면 = P/(P − z) 배.  z = −v·st − dist 이므로
   *   sx = u·k,  sy = v·ct·k,   k = P/(P + v·st + dist)
   * sy 식을 v 에 대해 풀면 되고, 그 다음 u 를 구합니다. */
  var denom = (ct * P - y * st);
  var v = (denom === 0) ? 0 : (y * (P + c.dist)) / denom;
  var k = P / (P + v * st + c.dist);
  var u = (k === 0) ? 0 : x / k;

  /* rotateZ 되돌리기 */
  var cr = Math.cos(-r), sr = Math.sin(-r);
  var mx = u * cr - v * sr, my = u * sr + v * cr;

  /* world 안의 좌표 → 맵 픽셀 */
  var px = mx + (c.cx - this.mapW / 2) - this.shake.x + this.mapW / 2;
  var py = my + (c.cy - this.mapH / 2) - this.shake.y + this.mapH / 2;
  return { x: Math.floor(px / TW), y: Math.floor(py / TH), px: px, py: py };
};

/* ── 외부 모듈용 렌더 경계 ────────────────────────────────────────────
 * 내부 캐시·DOM 조립 메서드 이름을 다른 모듈이 직접 알지 않게 한다.
 * 계산식과 레이어 선택은 기존 구현에 그대로 위임한다. */
Renderer.prototype.팔레트 = function () { return this._유닛팔레트(); };
/** 현재 기본·활성 팔레트의 외부 관찰용 상태를 반환한다. */
Renderer.prototype.팔레트상태 = function () {
  return Object.freeze({
    기본: this._palette || null,
    맵: (this.nmap && this.nmap.palette) || null,
    활성: this._유닛팔레트()
  });
};
/** 렌더러 기본 팔레트를 설정하고 실제 저장된 값을 반환한다. */
Renderer.prototype.기본팔레트설정 = function (pal) { this._palette = pal || null; return this._palette; };
/** 월드 요소에 논리 x·접지 y·높이 기준 빌보드 배치를 기록한다. */
Renderer.prototype.빌보드놓기 = function (e, x, groundY, h) { return this._빌보드놓기(e, x, groundY, h); };
/** 기록된 빌보드 배치를 현재 카메라·배율로 요소에 적용한다. */
Renderer.prototype.빌보드적용 = function (e) { return this._빌보드적용(e); };
/** 요청 종류에 맞는 렌더러 소유 FX 레이어를 반환한다. */
Renderer.prototype.FX층 = function (kind) {
  /* 물리층 선택만 한다. 좌표/앵커/배율/자세는 이 함수가 바꾸지 않는다. */
  if (kind === 'attack-between') return this.fxLayer;
  if (kind === 'under') return this.fxUnderLayer;
  if (kind === 'world-under') return this.fxWorldUnderLayer;
  if (kind === 'cam-plane-under') return this._연출카메라아래평면확보();
  if (kind === 'screen-under') return this._연출화면아래층확보();
  if (kind === 'cam-plane') return this._연출카메라평면확보();
  if (kind === 'screen') return this._연출화면층확보();
  if (kind === 'top-front') return this._연출최상층확보();
  if (kind === 'top' || !kind) return this._연출위층확보();
  throw new Error('알 수 없는 FX 레이어: ' + kind);
};
/** 오브젝트 배경 아래 연출 레이어의 표시 여부를 전환한다. */
Renderer.prototype.오브젝트배경아래 = function (on) {
  on = !!on;
  if (this._오브젝트내림 !== on) this._오브젝트를배경아래로(on);
  this._오브젝트내림 = on;
  var preview = this._map3dPreview && this._map3dPreview.node;
  if (preview) preview.style.visibility = on ? 'hidden' : '';
  if (this._map3dMapxBuildingPreview &&
      typeof this._map3dMapxBuildingPreview.forEachFaceNode === 'function')
    this._map3dMapxBuildingPreview.forEachFaceNode(function (node) {
      node.style.visibility = on ? 'hidden' : '';
    });
  return on;
};
/** 유닛 발자국 전체의 중심 타일 좌표를 반환한다. */
Renderer.prototype.유닛중심칸 = function (u) { return this._유닛중심칸(u); };
/** 현재 전투 유닛 표시 전부를 다시 동기화한다. */
Renderer.prototype.유닛새로고침 = function () { return this._유닛전체새로고침(); };
/** 번호에 대응하는 스프라이트 메타 또는 최소 호환 메타를 반환한다. */
Renderer.prototype.스프라이트확보 = function (no) { return this._대체스프라이트정보(no); };
/** 현재 맵 지면의 직독 준비·서명 상태를 외부에 반환한다. */
Renderer.prototype.지면상태 = function () {
  return Object.freeze({
    준비됨: !!this._floorURL,
    조각수: this.floorLayer ? this.floorLayer.children.length : 0,
    너비: this._floorW | 0,
    높이: this._floorH | 0
  });
};
/** 스케일러 재굽기 뒤 지면·유닛·그림자·오브젝트 표시 세대가 모두 준비됐는지 검사한다. */
Renderer.prototype.스케일러층상태검사 = function (N, 나쁨, 본) {
  나쁨 = 나쁨 || [];
  본 = 본 || {};
  var 지면 = this.지면상태();
  if (!지면.준비됨 || !지면.조각수) 나쁨.push('지면 없음');
  본.지면조각 = 지면.조각수;
  var 산유닛 = (this.b && this.b.units ? this.b.units.filter(function (u) { return !u.dead; }) : []);
  var 요소수 = Object.keys(this.unitEls).length;
  본.유닛 = 산유닛.length + '/' + 요소수;
  if (요소수 < 산유닛.length) 나쁨.push('유닛 요소 부족 ' + 요소수 + '<' + 산유닛.length);
  var 빈층 = 0, 그림자수 = 0, 그림자나쁨 = 0;
  Object.keys(this.unitEls).forEach(function (k) {
    var b = this.unitEls[k];
    [].forEach.call(b.children, function (e, j) {
      /* ★ 층 그림은 배경 그림이거나 «층 안 캔버스»다 — 캔버스 길이면 배경은 none/빈 값이다 (2026-10-10)
       *   ☠ 배경만 봐서 캔버스로 그린 유닛(19-1 배 열 척 전부)을 «그림 없음»으로 쳐 스케일러를 바꿀 때마다 4초 뒤 이전 값으로 되돌렸다
       *   (사장님 「스케일러는 왜 변경이 안되는거야? 계속 원래대로 복귀하잖아!」 · 헤드리스 실측: 나쁨 «그림 없는 유닛 층 10 · 그림자 세대 불일치 10») */
      var 배경 = (e.style.backgroundImage || '');
      var 캔 = e.querySelector ? e.querySelector('canvas') : null;
      var 캔있음 = !!(캔 && 캔.width > 0 && 캔.height > 0);
      var has = (배경 !== '' && 배경 !== 'none') || 캔있음;
      if (j === 0) {
        if (e.style.display !== 'none') {
          그림자수++;
          if (!has) 그림자나쁨++;
          else if (N > 1 && !캔있음 && !(e.style.backgroundSize || '').trim()) 그림자나쁨++;
        }
      } else if (!has) 빈층++;
    });
  }, this);
  본.빈층 = 빈층;
  본.그림자 = 그림자수 + '/' + 그림자나쁨;
  if (빈층) 나쁨.push('그림 없는 유닛 층 ' + 빈층);
  if (그림자나쁨) 나쁨.push('그림자 세대 불일치 ' + 그림자나쁨);
  var 오브빈 = 0, 조각수 = 0;
  this.objEls.forEach(function (e) {
    var 있 = (e.style.backgroundImage || '') !== '';
    if (있) { 조각수++; return; }
    var 자 = [].slice.call(e.children);
    if (!자.length) { 오브빈++; return; }
    /* ★ 캔버스 자식도 그림이다 — 행 오버레이는 PNG 배경 대신 캔버스를 붙인다(행캔버스붙이기 · 2026-09-25 Z-47).
     *   배경만 세면 전투 중 스케일러 전환이 늘 「준비 실패」로 되돌아가 먹통이 됐다(사장님 「전투에서 스케일러 변경시 먹통되는 문제」) */
    자.forEach(function (c) {
      조각수++;
      if (c.tagName === 'CANVAS') return;
      if ((c.style.backgroundImage || '') === '' && !(c.querySelector && c.querySelector('canvas'))) 오브빈++;
    });
  });
  본.오브 = this.objEls.length + '스트립/' + 조각수 + '조각/' + 오브빈 + '빈';
  if (오브빈) 나쁨.push('그림 없는 오브젝트 조각 ' + 오브빈);
  return { ok: 나쁨.length === 0, 나쁨: 나쁨, 본: 본, N: N };
};
/** 수동 스케일러 bitmap 전수 진단이 불러올 현재 표시층 URL·논리 크기 표본을 만든다. */
Renderer.prototype.스케일러비트맵표본 = function (표본) {
  var 목록 = [];
  function 담기(층, el, 원본w, 원본h) {
    var u = (el && el.style && el.style.backgroundImage) || '';
    if (!u || u === 'none') return;
    var cssW = parseFloat(el.style.width) || 0, cssH = parseFloat(el.style.height) || 0;
    목록.push({ 층: 층, url: u.slice(5, -2),
                원본: (원본w ? [원본w, 원본h || 0] : null), css: [cssW, cssH] });
  }
  var 지면 = this.지면상태();
  if (this.floorLayer.children[0]) 담기('지면', this.floorLayer.children[0], 지면.너비, 지면.높이);
  if (this.backdropEl) 담기('backdrop', this.backdropEl, this.mapW, null);
  var 조각 = [];
  this.objEls.forEach(function (e) {
    if ((e.style.backgroundImage || '') !== '') 조각.push(e);
    else [].forEach.call(e.children, function (c) { 조각.push(c); });
  });
  조각.slice(0, 표본 || 8).forEach(function (c, i) {
    담기('오브조각' + i, c, 24, parseFloat(c.style.height) || 0);
  });
  var 보병 = 0, 기병 = 0;
  Object.keys(this.unitEls).forEach(function (k) {
    var b = this.unitEls[k], 층수 = b.children.length - 1;
    if (층수 >= 2 && 기병 < 1) {
      기병++;
      담기('기병말', b.children[1]); 담기('기병탑승자', b.children[2]);
    } else if (층수 === 1 && 보병 < 1) {
      보병++; 담기('보병', b.children[1]);
    }
    if (b._shd && b._shd.style.display !== 'none' && 목록.every(function (m) { return m.층 !== '그림자'; }))
      담기('그림자', b._shd);
  }, this);
  return 목록;
};
/** BattleFreeze 진단이 비교할 렌더러 소유 전투·카메라·층 상태의 값 스냅샷을 만든다. */
Renderer.prototype.전투정지지문 = function () {
  var b = this.b;
  if (!b) return null;
  var fx = [];
  try {
    var fl = this.FX층 && this.FX층('attack-between'), ft = this.fxTopLayer;
    fx.push((fl ? fl.children.length : 0) + '/' + (ft ? ft.children.length : 0));
  } catch (e) { fx.push('?'); }
  var cs = this.카메라상태();
  return {
    mapId: this.nmap ? ((this.nmap.name || '') + '/' + this.nmap.W + 'x' + this.nmap.H) : '-',
    turn: [b.turn, b.phase, b.sideIdx, b.dayIdx, b.timeIdx].join(','),
    units: (b.units || []).map(function (u) {
      return [u.x, u.y, u.hp, u.dead ? 0 : 1, u.dir, u.motion | 0].join(',');
    }).join(';'),
    cam: [this.cam.cx, this.cam.cy, this.cam.tilt, this.cam.rot, this.cam.zoom,
          cs.부드러운이동중 ? 1 : 0, cs.포커스이동중 ? 1 : 0].join(','),
    fx: fx.join('|'),
    marks: this.markLayer ? this.markLayer.children.length : 0
  };
};
/** BattleFreeze가 보존할 표현용 카메라 보간 설정의 값 스냅샷을 반환한다. */
Renderer.prototype.보간설정스냅샷 = function () {
  return { lerpOn: this.lerpOn, lerpT: this.lerpT };
};

/** BattleFreeze 해제 때 저장했던 표현용 카메라 보간 설정을 복원한다. */
Renderer.prototype.보간설정복원 = function (저장) {
  if (!저장) return false;
  this.lerpOn = 저장.lerpOn;
  this.lerpT = 저장.lerpT;
  return true;
};
/** 개발 진단용 화면점이 지면만 덮고 있는지 현재 Renderer 층 요소로 판정한다. */
Renderer.prototype.순수지면점검 = function (PX, PY) {
  var 층 = [];
  function 덮나(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.width > 0 && PX >= r.left && PX < r.right && PY >= r.top && PY < r.bottom;
  }
  var 지면 = [];
  if (this.floorLayer) Array.prototype.forEach.call(this.floorLayer.children, function (e) {
    if (덮나(e)) 지면.push(e);
  });
  if (!지면.length) return { ok: false, 왜: 'no-floor', 층: 층 };
  층.push('floor');
  var 막 = null;
  (this.objEls || []).forEach(function (e) { if (덮나(e)) 막 = 막 || 'object'; });
  Object.keys(this.unitEls || {}).forEach(function (k) {
    var b = this.unitEls[k];
    if (덮나(b)) 막 = 막 || 'unit';
    else if (b._layers) b._layers.forEach(function (L) { if (덮나(L.el)) 막 = 막 || 'rider'; });
  }, this);
  if (this.markLayer) Array.prototype.forEach.call(this.markLayer.children, function (e) {
    if (덮나(e)) 막 = 막 || 'mark';
  });
  [this.FX층 && this.FX층('attack-between'), this.fxTopLayer, this.overlayLayer].forEach(function (L) {
    if (L) Array.prototype.forEach.call(L.children, function (e) { if (덮나(e)) 막 = 막 || 'fx'; });
  });
  if (막) return { ok: false, 왜: 막, 층: 층.concat([막]) };
  return { ok: true, 층: 층, 지면요소: 지면.length };
};
/** 화면 한 점이 유닛의 현재 원본 불투명 픽셀에 닿는지 판정한다. */
Renderer.prototype.유닛불투명픽셀인가 = function (u, clientX, clientY) {
  var box = this.unitEls && this.unitEls[u.id];
  if (!box || box.style.display === 'none') return false;
  var L = box._layers || [];
  var boxed = false;
  for (var i = L.length - 1; i >= 0; i--) {
    var e = L[i].el, m = L[i].meta;
    var r = e.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (clientX < r.left || clientX >= r.right ||
        clientY < r.top || clientY >= r.bottom) continue;
    boxed = true;
    var fr = this.frameOf(m, L[i].no, u.dir, u.motion);
    if (!fr || !fr.idx) continue;
    var lx = ((clientX - r.left) * fr.w / r.width) | 0;
    var ly = ((clientY - r.top) * fr.h / r.height) | 0;
    if (this.frameOpaqueAt(m, L[i].no, u.dir, u.motion, lx, ly)) return true;
  }
  return boxed && !L.some(function (l) {
    var f = this.frameOf(l.meta, l.no, u.dir, u.motion);
    return !!(f && f.idx);
  }, this);
};

/** 화면 한 점에 겹친 살아 있는 유닛 중 현재 표시 순서상 가장 앞의 유닛을 반환한다. */
Renderer.prototype.화면점유닛 = function (units, clientX, clientY) {
  if (!this.unitEls) return null;
  var best = null, bestZ = -Infinity;
  for (var i = 0; i < units.length; i++) {
    var u = units[i];
    if (!u.alive) continue;
    var el = this.unitEls[u.id];
    if (!el || !this.유닛불투명픽셀인가(u, clientX, clientY)) continue;
    var b = el.getBoundingClientRect();
    var z = parseFloat(el.style.zIndex) || 0;
    var key = z * 100000 + b.bottom;
    if (key > bestZ) { bestZ = key; best = u; }
  }
  return best;
};
/** MAP_EFFC 지형효과의 다음 원본 애니메이션 프레임을 적용한다. */
Renderer.prototype.지형효과다음프레임 = function () {
  this._지형효과프레임 = ((this._지형효과프레임 | 0) + 1) & 1;
  return this._지형효과프레임;
};
/** 배치 화면이 사용할 유닛·탈것 아이콘 프레임 제공자를 반환한다. */
Renderer.prototype.배치아이콘제공자 = function (u) {
  if (!u || u.sprIndex == null || !this._sprNames) return null;
  var 이름 = this._sprNames[u.sprIndex];
  return 이름 ? this._유닛프레임공급자(이름) : null;
};
/** 원본 프레임과 색인으로 실루엣 그림 URL을 만든다. */
Renderer.prototype.실루엣그림 = function (fr, idx) { return this._실루엣그림정보(fr, idx); };
/** 유닛 원본 파일과 프레임 번호의 직독 URL을 반환한다. */
Renderer.prototype.유닛프레임 = function (file, n) { return this._유닛프레임정보(file, n); };
/**
 * 연출이 쓰는 **그 유닛의 한 프레임** — 기존 `spriteMeta` · `_스프라이트파일` ·
 * `유닛프레임` 을 잇는 **얇은 adapter** 다. 새 디코더·새 캐시를 만들지 않는다.
 *
 * ★ 왜 `frameOf` 를 안 쓰나 — `frameOf` 는 `canvas` 를 떼고 돌려준다. 연출 쪽은
 *   `실루엣그림()` 과 `frameUrl()` 이 **원본 캔버스**를 써야 해서 `_유닛프레임정보`
 *   의 결과가 그대로 필요하다. 격자 계산은 `frameOf` 와 **같은 식**이다.
 *
 * ```asm
 * 0x13175  frame = (방향 * 11 + 모션) * 13      ; 서술자 0xD66A8 의 13바이트 레코드
 * ```
 * @returns {{url,canvas,w,h,ax,ay}|null} 아직 안 읽혔으면 null
 */
Renderer.prototype.연출유닛프레임 = function (u, dir, motion) {
  if (!u) return null;
  var meta = this.spriteMeta(u);
  if (!meta) return null;
  var 행 = meta['행'] || 4, 열 = meta['열'] || meta['방향당프레임'] || 11;
  var d = (((dir | 0) % 행) + 행) % 행;
  var m = Math.min(Math.max(motion | 0, 0), 열 - 1);
  var file = this._스프라이트파일(meta, u.sprIndex);
  if (!file) return null;
  return this._유닛프레임정보(file, d * 열 + m);
};
/**
 * `0x1E2EA`가 쓸 `.NC2` 무기 스윙 레코드를 현재 유닛에서 고른다.
 *
 * 메타 색인 = 방향 × 2 + (일반0/크리1).
 * `edx` 단계는 원본에서 **2일 때만 x2/y2**, 0·1이면 x1/y1 을 쓴다.
 * 프레임 −1은 원본과 같이 "그리지 않음"이다.
 */
Renderer.prototype.무기스윙정보 = function (u, 단계, critical) {
  if (!u) return null;
  var meta = this.spriteMeta(u);
  if (!meta) return null;
  var file = this._스프라이트파일(meta, u.sprIndex);
  if (!file) return null;
  var 표 = this._usprSwing && this._usprSwing[file];
  if (!표 && Renderer._선swing) 표 = Renderer._선swing[file];
  if (!표) return null;
  var d = ((u.dir | 0) & 3), row = 표[d];
  var rec = row && row[critical ? 1 : 0];
  if (!rec || (rec.frame | 0) < 0) return null;
  var 둘째 = ((단계 | 0) === 2);
  /* ★ 2026-09-24 (사장님: 「일반 공격시 검기가 두개로 나간다 … 캐릭터 위쪽에 하나가 더 생겨」)
   *   0x1E2F3 `dec edx`(단계−1) → 0x1E437 `add edx, 표.frame` → 0x1E449 `[×12 + 0xBBA30]`.
   *   곧 그림은 **표.frame + (단계 − 1)** 이다 — 단계 1 = 큰 궤적(f), 단계 2 = 꼬리 조각(f+1).
   *   WEA_EFFC 는 「큰 궤적 · 꼬리」가 짝으로 붙어 있다(0·1, 2·3 …). 전에는 늘 f 만 그려
   *   단계 2 에서 큰 궤적이 (x2,y2) 에 한 번 더 나왔다. */
  var 그림 = (rec.frame | 0) + ((단계 | 0) - 1);
  if (그림 < 0) return null;
  return { file: file, frame: 그림,
           xoff: (둘째 ? rec.x2 : rec.x1) | 0,
           yoff: (둘째 ? rec.y2 : rec.y1) | 0,
           dir: d, critical: !!critical, stage: 단계 | 0 };
};

/**
 * 원본 공용 무기 궤적 `0x1E2EA` 한 장을 그린다.
 * 좌표 = 타일 기준 `(x*24+12-xoff, y*16+2-yoff)` — WEA_EFFC 프레임의
 * 자체 앵커를 더하지 않는다. 원본도 표의 그림 포인터를 이 좌표에 바로 그린다.
 * @returns DOM element 또는 null. 호출자는 다음 원본 프레임 전에 제거한다.
 */
Renderer.prototype.무기스윙그리기 = function (u, 단계, critical, 자리유닛) {
  var info = this.무기스윙정보(u, 단계, critical);
  var raw = Renderer._무기스윙Raw;
  if (!info || !raw || !raw[info.frame] || !root.G2Native) return null;
  var pal = this._유닛팔레트();
  if (!pal) return null;
  if (!this._무기스윙제공자 || this._무기스윙팔 !== pal) {
    this._무기스윙제공자 = root.G2Native.spriteCanvasProvider(raw, pal);
    this._무기스윙팔 = pal;
    this._무기스윙URL = {};
  }
  var fr = this._무기스윙제공자(info.frame);
  if (!fr || !fr.canvas) return null;
  var url = this._무기스윙URL[info.frame];
  if (!url) url = this._무기스윙URL[info.frame] = fr.canvas.toDataURL();
  var e = this.fxSprite(url, 'attack-between');
  if (!e) return null;
  /* ☠★★★★★ **낱장 그림도 배경 크기를 눌러 담는다** — 스케일러 (2026-09-22)
   *
   *   > 사장님: 「**검 휘두루는 이펙트도 스케일러 적용시 깨져.**」
   *
   *   `fxSprite()` 는 **묶음 시트**(`fx.js packFrames`)일 때만 `이펙트시트정보()` 로
   *   논리 크기를 찾아 `background-size` 를 건다. 무기 궤적은 시트가 아니라
   *   `spriteCanvasProvider` 가 구운 **낱장 캔버스**라 그 표에 없어 `auto` 로 남았고,
   *   스케일러가 켜지면 그림만 N배라 **왼쪽 위 1/N 만** 보였다.
   *   ★ `fr.w`·`fr.h` 는 provider 가 주는 **논리 크기**다(N 과 무관). N=1 이면 무해하다. */
  e.style.backgroundSize = fr.w + 'px ' + fr.h + 'px';
  /* 무신멸뢰옥처럼 연출상 시전자가 다른 칸에 서 있지만 gameplay x/y는 아직
   * 원래 칸인 경우가 있다. 메타/방향은 `u`에서 읽고, 좌표만 `자리유닛`에서
   * 읽을 수 있게 한다. 일반 평타는 네 번째 인자를 생략하므로 기존 계약 그대로다. */
  var at = 자리유닛 || u;
  var m = this.mapOf({ x: at.x, y: at.y });
  this.placeFx(e, m.x + 12 - info.xoff, m.y + 2 - info.yoff, fr.w, fr.h);
  e._weaponSwing = info;
  return e;
};

Renderer.prototype.무기스윙지우기 = function (e) {
  if (e && this.dropFxSprite) this.dropFxSprite(e);
};

/** 선택 상자 네 모서리 그림과 논리 크기를 교체한다. */
Renderer.prototype.선택상자모서리설정 = function (urls, w, h) {
  if (!urls || !this.SELBOX) return false;
  var tgt = this.boxTarget;
  this.SELBOX.corner = urls; this.SELBOX.cw = w | 0; this.SELBOX.ch = h | 0;
  if (this.boxEl && this.boxEl.parentNode) this.boxEl.parentNode.removeChild(this.boxEl);
  this.boxEl = null; this.boxEls = null;
  if (tgt && this.selectBox) {
    this.selectBox(tgt);
    if (tgt.id != null && this.showUnitValues) this.showUnitValues(true, tgt);
  }
  return true;
};
root.G2Render = { Renderer: Renderer, EffectLayer: 연출층계약 };

})(typeof globalThis !== 'undefined' ? globalThis : window);
