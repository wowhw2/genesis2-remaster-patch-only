/* ============================================================================
 *  **전투 ↔ 퀵세이브 파일** — 이음매 (계획 §7 단계 5)
 *
 *  사장님 확정 2026-09-14 —
 *   「**'가'로 하면돼**」 = 퀵세이브를 **원본 규격 파일**(`06_패치/적용/GENESIS.QSV`)로 쓴다
 *   「기본적으로 우리는 **적용 폴더를 우선시**하니 '나'를 사용하되 이 세이브는
 *    원본이 아닌 **적용폴더에 적용**」
 *
 *  ── 위계 (화살표는 위로만) ──────────────────────────────────────────────
 *   qsv.js(규격) · extsave.js(그릇)
 *        ↑
 *   extqsv.js(한 벌 · 꼬리 덧붙이기)
 *        ↑
 *   **battle_quicksave.js**  ← 여기. 전투 유닛 ↔ 파일 바이트
 *        ↑
 *   battle_main.js (quickSave / quickLoad)
 *
 *  ── 한 파일에 두 가지가 들어간다 ────────────────────────────────────────
 *  ```
 *  [ 원본 규격 QSV ]   이름 16B + 무리 넷 × 136B + 꼬리 69,359B
 *                      ★ 원본·옛 판이 **그대로 읽을 수 있는** 꼴이다
 *  [ 우리 꼬리 ]       RUNT 덩이 — 전투 런타임 값 (JSON)
 *                      ★ 원본은 앞만 읽으므로 **한 바이트도 안 깨진다**
 *  ```
 *
 *  ☠ **겹치는 값은 두 벌이 아니다.** 136B 는 «원본이 읽을 사본»이고 `RUNT` 는
 *    «우리가 되살릴 정본»이다. 되살릴 때는 **136B 를 깔고 `RUNT` 로 덮는다** —
 *    `alive`·`acted`·턴·사기처럼 **136B 안 자리를 모르는 칸**이 있기 때문이다.
 *    ★ 그 자리를 짐작해서 136B 에 넣지 않는다 (`CLAUDE.md` §4).
 *
 *  ── 이 파일이 하지 않는 것 ──────────────────────────────────────────────
 *  · 파일을 읽고 쓰지 않는다 — 바이트만 다룬다 (부르는 쪽이 서버에 보낸다)
 *  · 전투 규칙을 모른다 — 유닛의 어떤 칸을 되살릴지는 부르는 쪽이 준다
 * ============================================================================ */
'use strict';
(function (root) {

  var Q = root.G2Qsv || (typeof require === 'function' ? require('./qsv.js') : null);
  var X = root.G2ExtSave || (typeof require === 'function' ? require('./extsave.js') : null);
  var EQ = root.G2ExtQsv || (typeof require === 'function' ? require('./extqsv.js') : null);
  var BR = root.G2Bridge ||
           (typeof require === 'function' ? require('./bridge.js') : null);
  var BC = root.G2BattleCommit ||
           (typeof require === 'function' ? require('./battle_commit.js') : null);

  var 레코드크기 = 136;

  function 글자를바이트로(s) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(s);
    var b = Buffer.from(s, 'utf8');                 /* node */
    return new Uint8Array(b.buffer, b.byteOffset, b.length);
  }
  function 바이트를글자로(u8) {
    if (typeof TextDecoder === 'function') return new TextDecoder().decode(u8);
    return Buffer.from(u8).toString('utf8');
  }

  /**
   * **전투 → 한 파일 바이트.**
   *
   * @param {object} 전투    `{units:[…], S:{…}, turn, …}` — `units[i]._원본`·`_그룹` 이 있어야 한다
   * @param {Uint8Array} 바탕  바탕이 될 QSV 바이트 (원본 `GENESIS.QSV`). **꼬리를 여기서 물려받는다**
   * @param {object} 런타임   `RUNT` 로 담을 것 (턴·사기·유닛별 alive/acted …)
   * @param {string} [만든때]
   * @returns {Uint8Array}
   */
  function 담기(전투, 바탕, 런타임, 만든때) {
    if (!전투 || !전투.units) throw new Error('퀵세이브: 전투 유닛이 없다');
    if (!바탕 || !바탕.length) throw new Error('퀵세이브: 바탕 QSV 가 없다');

    /* ★ 바탕에 우리 꼬리가 붙어 있을 수 있다 — 떼고 앞부분만 쓴다 */
    var 앞 = EQ.떼어내기(바탕).앞바이트;
    var 판;
    /* 정본 364 — 바탕(지난 퀵세이브)을 못 읽으면 빈 틀로 — 바탕이 없을 때(battle_main 바탕QSV받기)와 같은 길
     *   ☠ 옛 판이 쓴 GENESIS.QSV 가 «무리 0 6번째 탑승자 자리가 (3,27) — 탑승자 레코드가 아니다(옛 꼴)» 로 안 읽혀
     *     그 뒤 퀵세이브가 매번 «저장할 수 없습니다» (신고 버그신고_20261121_140044·141331 · 회색의 레인저 2-1·2-3 · 측정 창 재현) */
    try { 판 = Q.파싱(앞); }
    catch (e바탕) {
      if (typeof console !== 'undefined' && console.warn) console.warn('[퀵세이브] 바탕 QSV 를 못 읽어 빈 틀로 씁니다 — ' + (e바탕 && e바탕.message));
      앞 = new Uint8Array(16 + 4 * 2);
      판 = Q.파싱(앞);
    }

    /* ══════════════════════════════════════════════════════════════════
     *  ① 유닛의 «지금 상태»를 136B 에 반영한다
     *
     *  ☠☠ **런타임 유닛(`battle.units`)에는 `_원본`·`_그룹` 이 없다** (2026-09-15 실측).
     *    그 둘은 «전투 사본»(`battle_load.전투사본만들기()`)의 필드다. 런타임 쪽은
     *    소문자·한글 필드를 쓴다 — `그룹`·`charCode`·`hp`·`x`·`y` …
     *    처음에 `u._원본` 을 보다가 **무리가 전부 0명으로 담겼다.**
     *
     *  ⇒ 136바이트는 **`battle.S['유닛그룹']`**(= `.SCE` 배치)에서 가져온다.
     *    거기에 전투 시작 때의 레코드가 무리별로 들어 있다.
     *    그 **사본**에 `bridge.되돌리기` 로 지금 값을 덮는다 — 원본을 안 건드린다.
     * ══════════════════════════════════════════════════════════════════ */
    var 무리별 = [[], [], [], []];
    var 배치 = (전투.S && 전투.S['유닛그룹']) || [];
    /** 코드로 배치 레코드를 찾는다 — 같은 무리 안에서 먼저 보고, 없으면 전체에서 */
    function 배치찾기(코드, 무리) {
      코드 = 코드 | 0;
      var 순서 = [무리].concat([0, 1, 2, 3].filter(function (g) { return g !== 무리; }));
      for (var i = 0; i < 순서.length; i++) {
        var 들 = 배치[순서[i]] || [];
        for (var k = 0; k < 들.length; k++) {
          var s = 들[k];
          var rec = s && (s._원본 || s);
          if (rec && rec.length === 레코드크기 && (rec[0x0F] | 0) === 코드) return rec;
        }
      }
      return null;
    }
    var 못담은것 = [];
    전투.units.forEach(function (u) {
      if (!u) return;
      var g = (u['그룹'] != null ? u['그룹'] : u._그룹) | 0;
      if (g < 0 || g >= 무리별.length) g = 0;
      var 바탕rec = u._원본 || 배치찾기(u.charCode != null ? u.charCode : u['캐릭터코드'], g);
      if (!바탕rec) {
        /* ☐ 전투 중에 생긴 유닛(소환·분신)은 배치에 없다 — 136B 가 없어
         *   **꼬리 `RUNT` 에만** 남는다. 적어만 두고 막지 않는다. */
        못담은것.push(u.id);
        return;
      }
      var 사본 = Uint8Array.from(바탕rec);
      try {
        if (BR && BR.되돌리기) BR.되돌리기(u, 사본);      /* 지금 HP·자리·상태를 덮는다 */
        else if (BC && BC.동기화 && u._원본) BC.동기화(u);
      } catch (e) { /* 못 덮어도 배치 레코드는 담는다 */ }
      /* 정본 289 — 탈것이면 탑승자 136B 를 바로 뒤에 붙인다 · 없으면 [+0x77] 을 0 으로(원본 0x4FA33 이 그 칸을 보고 136B 를 더 읽는다)
       *   탑승자 레코드 = 전투 중 탄 사람(_riderSnapshot) 또는 .SCE 배치부터 탄 사람(rider._raw) */
      var 탑원 = (u._riderSnapshot && u._riderSnapshot._raw && u._riderSnapshot._raw._원본) || (u.rider && u.rider._raw && u.rider._raw._원본) || null;
      if (탑원 && 탑원.length >= 136) {
        사본.탑승자 = Uint8Array.from(탑원.subarray ? 탑원.subarray(0, 136) : 탑원.slice(0, 136));
        if (!(사본[0x77] | 사본[0x78] | 사본[0x79] | 사본[0x7A])) 사본[0x77] = 1;   /* 원본은 포인터 · 0 아닌 값이면 된다 */
      } else { 사본[0x77] = 사본[0x78] = 사본[0x79] = 사본[0x7A] = 0; }
      무리별[g].push(사본);
    });
    if (못담은것.length && 런타임) 런타임._136B없음 = 못담은것;

    /* ② 무리 넷을 새로 짠다 — `qsv.빼기` 가 앞을 다시 만들고 꼬리를 그대로 붙인다 */
    판.무리들 = 무리별.map(function (들) {
      return 들.map(function (rec) { return { 자리: -1, u: null, _원본: rec, 탑승자: rec.탑승자 ? { 자리: -1, u: null, _원본: rec.탑승자 } : null }; });   /* 정본 289 */
    });
    var 새앞 = Q.빼기(판, function () { return false; }).바이트;

    /* ★★★ **시나리오 이름을 지금 전투 것으로** — 원본이 `0x00` 16B 에 담는다.
     *   ☠ 안 바꾸면 바탕(원본 QSV)의 이름이 그대로 남아, 다음에 열 때
     *     **다른 전투의 기록**으로 잘못 판정된다. 원본도 이 이름으로 가른다. */
    var 이름 = String((전투.S && (전투.S['맵파일'] || 전투.S['시나리오'])) || '');
    for (var i = 0; i < 16; i++)
      새앞[i] = i < 이름.length ? (이름.charCodeAt(i) & 0xff) : 0;

    /* ③ 런타임 값을 꼬리 덩이로 */
    if (!런타임) return 새앞;
    var 것 = X.새것(새앞, 만든때);                 /* ★ 손도장은 «앞부분» 으로 찍는다 */
    X.덩이넣기(것, 'RUNT', 글자를바이트로(JSON.stringify(런타임)));
    return EQ.덧붙이기(새앞, X.굽기(것));
  }

  /**
   * **한 파일 바이트 → 전투에 쓸 것.**
   *
   * @param {Uint8Array} 바이트
   * @returns {{쓸수있나:boolean, 판:object|null, 무리별:Array<Array<Uint8Array>>|null,
   *            런타임:object|null, 까닭:string}}
   */
  function 풀기(바이트) {
    if (!바이트 || !바이트.length)
      return { 쓸수있나: false, 판: null, 무리별: null, 런타임: null, 까닭: '저장된 것이 없습니다.' };

    var 쪼갠것 = EQ.떼어내기(바이트);
    var 판;
    try { 판 = Q.파싱(쪼갠것.앞바이트); }
    catch (e) {
      return { 쓸수있나: false, 판: null, 무리별: null, 런타임: null,
               까닭: '퀵세이브를 못 읽었습니다 — ' + (e && e.message || e) };
    }

    var 무리별 = 판.무리들.map(function (들) {
      return 들.map(function (s) { var r = Uint8Array.from(s._원본); if (s.탑승자) r.탑승자 = Uint8Array.from(s.탑승자._원본); return r; });   /* 정본 289 — 탑승자 136B 는 꼬리표로 */
    });

    /* ★ 꼬리가 없어도 **연다** — 원본이 만든 파일이 그렇다 (136B 만으로 되살린다) */
    var 런타임 = null;
    if (쪼갠것.g2x) {
      try {
        var 곁 = X.뜯기(쪼갠것.g2x);
        var 봄 = X.맞나(곁, 쪼갠것.앞바이트);
        if (!봄.맞나)
          return { 쓸수있나: false, 판: 판, 무리별: 무리별, 런타임: null,
                   까닭: '다른 퀵세이브의 추가 정보입니다 — ' + 봄.까닭 };
        var c = X.덩이(곁, 'RUNT');
        if (c && c.내용 && c.내용.length) 런타임 = JSON.parse(바이트를글자로(c.내용));
      } catch (e) {
        return { 쓸수있나: false, 판: 판, 무리별: 무리별, 런타임: null,
                 까닭: '추가 정보를 못 읽었습니다 — ' + (e && e.message || e) };
      }
    }

    return { 쓸수있나: true, 판: 판, 무리별: 무리별, 런타임: 런타임, 까닭: '' };
  }

  /* ══════════════════════════════════════════════════════════════════════
   * ④ **QSV → 살아 있는 Battle 복원** — 2026-09-21
   *
   *   `풀기()` 는 오래전부터 원본 QSV-only도 받아들이고 `무리별` 136B를 내줬다.
   *   그런데 제품 `quickLoad()` 는 `RUNT` 가 없으면 바로 종료하고, 있어도 기존
   *   JS 유닛에 RUNT 필드만 덮었다. 따라서 이 파일 머리의 계약
   *
   *      136B 먼저 깐다 → RUNT 로 웹 런타임 값을 덮는다
   *
   *   가 실제 제품에서는 지켜지지 않았다.
   *
   *   이 함수가 그 계약을 한 곳에 모은다. 화면/입력 정책은 알지 않는다.
   *   renderer·SCE runtime 은 옵션으로 받은 최소 창구만 쓴다.
   *
   *   ★ QSV-only: 136B 유닛은 복원하고, 턴/사기처럼 위치를 모르는 값은 현재 값을
   *     유지한다. 모르는 꼬리를 짐작해서 해석하지 않는다.
   *   ★ RUNT: 저장 이후 생긴 현재 런타임 유닛은 버리고, 저장 당시에만 있던
   *     소환/분신은 `_원본136` seed 가 있으면 다시 만든다.
   * ====================================================================== */

  function _깊은사본(v) {
    if (v == null || typeof v !== 'object') return v;
    return JSON.parse(JSON.stringify(v));
  }

  function _b64풀기(s) {
    if (!s) return null;
    try {
      if (typeof atob === 'function') {
        var t = atob(String(s)), out = new Uint8Array(t.length);
        for (var i = 0; i < t.length; i++) out[i] = t.charCodeAt(i) & 0xFF;
        return out;
      }
      if (typeof Buffer !== 'undefined') {
        var b = Buffer.from(String(s), 'base64');
        return new Uint8Array(b.buffer, b.byteOffset, b.length).slice();
      }
    } catch (e) {}
    return null;
  }

  function _제자리교체(dst, src, id) {
    if (!dst) { src.id = id; return src; }
    Object.keys(dst).forEach(function (k) { if (k !== 'id') delete dst[k]; });
    Object.keys(src).forEach(function (k) { if (k !== 'id') dst[k] = src[k]; });
    dst.id = id;
    return dst;
  }

  function _새유닛(raw, 그룹, id, S, ST) {
    if (!raw || raw.length < 레코드크기) throw new Error('퀵로드: 136B 유닛 seed 가 없다');
    if (!S || typeof S.unitAt !== 'function') throw new Error('퀵로드: G2Sce.unitAt 이 없다');
    if (!ST || typeof ST.makeUnit !== 'function') throw new Error('퀵로드: G2State.makeUnit 이 없다');
    var rec = S.unitAt(raw, 0);
    rec['그룹'] = 그룹 | 0;                         /* qsv 그룹이 정본 */
    if (raw.탑승자 && raw.탑승자.length >= 레코드크기) { try { rec['탑승자'] = S.unitAt(raw.탑승자, 0); rec['탑승자']['그룹'] = 그룹 | 0; } catch (e탑) {} }   /* 정본 289 — .SCE 부속유닛과 같이 makeUnit 이 rider 로 */
    var u = ST.makeUnit(rec, id);
    if (ST.derive) ST.derive(u);
    u.id = id;
    return u;
  }

  function _격자다시(전투) {
    var W = 전투.W | 0, H = 전투.H | 0;
    전투.grid = new Array(Math.max(0, W * H)).fill(null);
    var 충돌 = [];
    (전투.units || []).forEach(function (u) {
      if (!u) return;
      u._cells = null;
      if (u.alive === false) return;
      if (typeof 전투.cellsOf === 'function') {
        var cs = 전투.cellsOf(u, u.x, u.y, u.dir);
        for (var i = 0; i < cs.length; i++) {
          var x = cs[i][0] | 0, y = cs[i][1] | 0;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          var 옛 = 전투.grid[y * W + x];
          if (옛 && 옛 !== u) 충돌.push({ x: x, y: y, a: 옛.id, b: u.id });
        }
      }
      if (typeof 전투.place === 'function') 전투.place(u, u.x, u.y, u.dir);
      else if (typeof 전투.setAt === 'function') 전투.setAt(u.x, u.y, u);
    });
    return 충돌;
  }

  /**
   * `풀기()` 결과를 현재 Battle 객체에 복원한다.
   * @returns {{기본유닛:number, 런타임유닛:number, 재생성:number, 누락:Array,
   *            격자충돌:Array, qsvOnly:boolean}}
   */
  function 복원(전투, 푼것, 옵션) {
    옵션 = 옵션 || {};
    if (!전투 || !전투.units) throw new Error('퀵로드: Battle 이 없다');
    if (!푼것 || !푼것.쓸수있나 || !푼것.무리별) throw new Error('퀵로드: 쓸 수 있는 QSV 판이 아니다');

    var S = 옵션.sce || root.G2Sce || (typeof require === 'function' ? require('./sce.js') : null);
    var ST = 옵션.state || root.G2State || (typeof require === 'function' ? require('./state.js') : null);
    var R = 옵션.renderer || null;
    var old = 전투.units.slice();
    var oldById = {};
    old.forEach(function (u) { if (u && u.id != null) oldById[u.id] = u; });

    /* ① QSV 136B 네 무리를 실제 런타임 유닛으로 만든다. id 는 원본 SCE와 같은
     *    그룹 순서의 평탄화 번호다. 기존 객체가 같은 id 로 있으면 **제자리 교체**해
     *    SCE/화면 쪽의 안전한 참조는 최대한 보존한다. */
    var 새 = [], id = 0;
    for (var g = 0; g < 푼것.무리별.length; g++) {
      var 들 = 푼것.무리별[g] || [];
      for (var k = 0; k < 들.length; k++, id++) {
        var nu = _새유닛(들[k], g, id, S, ST);
        새.push(_제자리교체(oldById[id] || null, nu, id));
      }
    }
    전투.units = 새;

    /* 저장 이후 현재 전투에서만 생긴 소환/분신 DOM 은 여기서 없앤다. */
    if (R && typeof R.dropUnit === 'function') {
      old.forEach(function (u) {
        if (!u) return;
        var 남 = 새.some(function (n) { return n === u; });
        if (!남) { try { R.dropUnit(u); } catch (e) {} }
      });
    }

    /* ② 우리 추가 런타임 정본을 덮는다. */
    var j = 푼것.런타임;
    var 재생성 = 0, 누락 = [];
    if (j && Array.isArray(j.units)) {
      j.units.forEach(function (sv) {
        if (!sv || sv.id == null) return;
        var uid = sv.id | 0;
        var u = null;
        for (var i = 0; i < 전투.units.length; i++) {
          if (전투.units[i] && (전투.units[i].id | 0) === uid) { u = 전투.units[i]; break; }
        }
        if (!u) {
          var seed = _b64풀기(sv._원본136);
          /* 옛 RUNT 에 seed 가 없더라도 같은 판에서 아직 살아 있는 객체가 있으면
           * id 를 근거로 재사용한다. 저장에 없던 유닛은 j.units 자체에 없으므로 여기 안 온다. */
          if (!seed && oldById[uid]) u = oldById[uid];
          if (!u && seed && seed.length >= 레코드크기) {
            u = _새유닛(seed, sv['그룹'] == null ? 0 : sv['그룹'], uid, S, ST);
            재생성++;
          }
          if (u) 전투.units.push(u);
          else { 누락.push(uid); return; }
        }
        Object.keys(sv).forEach(function (key) {
          if (key === 'id' || key === '_원본136') return;
          u[key] = _깊은사본(sv[key]);
        });
        /* ★ 정본 440 — 최대 MP 접기 표시(state.js 최대MP계산 _계산MP)와 view 캐시(combat.js _cv)는 «지금 판»의 것이다 — 저장한 값과 섞지 않는다
         *   남겨 두면 다음 계산이 «저장된 최대 MP − 지금 판 표시»를 밖에서 바꾼 것으로 보고 순수 MP 에 또 더했다
         *   (신고 R0.1.93 신디 나이트 Lv55 MP 660 — 원작 성장대로면 255: 새로 시작한 전투(120)에서 255 를 불러오면 390 · 다시 저장·불러오면 660 ·
         *    미카엘 Lv35 MP 9,760 · 사장님 전달 신고 「렙업하면 mp가 엄청나게 올라요」·「신디 나이트인데 레벨업하면 HP보다 MP가 더 오르는 버그」)
         *   ⇒ 표시를 비워 «순수 + 장비»로 새로 잡게 한다 · 순수 MP 가 저장에 없으면(옛 기록) 지금 판 순수도 버리고 저장된 최대 MP 에서 다시 잡는다 */
        if (Object.prototype.hasOwnProperty.call(sv, 'maxMp') || Object.prototype.hasOwnProperty.call(sv, '순수MP')) {
          u._계산MP = null;
          if (!Object.prototype.hasOwnProperty.call(sv, '순수MP')) u.순수MP = null;
        }
        u._cv = null;
        if (u.gear && ST && ST.reequip) ST.reequip(u, null, null);
      });
    }

    /* 저장에 없는 현재 런타임 유닛은 위 136B 재구성에서 이미 빠졌다. id 생성기는
     * 실제 최대 id 다음으로 옮긴다 — 배열 길이를 id 로 가정하지 않는다. */
    var maxId = -1;
    전투.units.forEach(function (u) { if (u && (u.id | 0) > maxId) maxId = u.id | 0; });
    전투._다음유닛id = maxId + 1;

    /* ③ Battle 장기 상태. QSV-only 에서는 모르는 값을 **현재 값 그대로 둔다.** */
    if (j) {
      if (j.turn != null) 전투.turn = j.turn | 0;
      if (j.timeIdx != null) 전투.timeIdx = j.timeIdx | 0;
      if (j.시각흐름 != null) 전투.시각흐름 = !!j.시각흐름;
      if (Array.isArray(j.획득아이템)) 전투.획득아이템 = j.획득아이템.map(function (c) { return c | 0; });   /* 창고로 갈 아이템 — 이어하기 뒤에도 (11-09) */
      if (j.dayIdx != null) 전투.dayIdx = j.dayIdx | 0;
      if (j.sideIdx != null) 전투.sideIdx = j.sideIdx | 0;
      if (j.phase != null) 전투.phase = j.phase;
      if (j.morale && 전투.morale) {
        if (j.morale.ally != null) 전투.morale.ally = j.morale.ally;
        if (j.morale.enemy != null) 전투.morale.enemy = j.morale.enemy;
      }
      if (j['탐색커서'] != null) 전투['탐색커서'] = j['탐색커서'] | 0;
      if (Array.isArray(j.mapItems) && Array.isArray(전투.mapItems)) {
        var taken = {};
        j.mapItems.forEach(function (x) { if (x && x.idx != null) taken[x.idx | 0] = !!x.taken; });
        전투.mapItems.forEach(function (x) {
          if (x && Object.prototype.hasOwnProperty.call(taken, x.idx | 0)) x.taken = taken[x.idx | 0];
        });
      }
      /* SCE 발동표는 안전 경계에서만 직렬화한다. 큐/Promise/연출 중간은 저장하지 않는다. */
      var rt = 옵션.sceRuntime || null;
      if (j.sceFired && rt && typeof rt.발동표 === 'function') {
        var 표 = rt.발동표();
        if (표 && typeof 표 === 'object') {
          Object.keys(표).forEach(function (key) { delete 표[key]; });
          Object.keys(j.sceFired).forEach(function (key) { 표[key] = j.sceFired[key] | 0; });
        }
      }
    }

    /* ★ 정본 439·429 — 행동 대기열(turn.js readyQueue · 원본 0xF041C)은 저장하지 않는다 — 복원 앞 판의 유닛 «객체»를 들고 있다
     *   전투 중 합류한 유닛(신고 2-3 의 21~25 미카엘·죠엘…)은 위에서 새 객체로 다시 만들어지는데, 대기열에는 옛 객체가 남아
     *   readyPlayerUnits 가 옛 것 + 새 것을 함께 내 차례 줄에 같은 얼굴이 둘 나오고(신고 「퀵세이브 후 로드하면 하단에 조엘턴이 2번 표시되듯이」)
     *   옛 객체(복원 앞 대기 값)는 R2 로도 골라졌다(429 「차례가 안 온 캐릭터도 R2 로 골라짐」)
     *   ⇒ 지금 유닛 집합에 있는 객체만 남기고, 없는 것은 같은 id 의 지금 객체로 바꾼다(겹치면 하나) — 대기 값 판정은 readyPlayerUnits 가 다시 한다 */
    if (Array.isArray(전투.readyQueue)) {
      var 지금id = {};
      전투.units.forEach(function (u) { if (u && u.id != null) 지금id[u.id] = u; });
      var 새큐 = [];
      전투.readyQueue.forEach(function (u) {
        var n = u && (전투.units.indexOf(u) >= 0 ? u : (u.id != null ? 지금id[u.id] : null));
        if (n && 새큐.indexOf(n) < 0) 새큐.push(n);
      });
      전투.readyQueue = 새큐;
    }

    /* 저장 전 타임라인에서 계산해 둔 파생 캐시는 복원 상태와 섞으면 안 된다. */
    전투.critBags = {};                            /* 유닛 critSeed 에서 다시 만든다 */
    try { delete 전투.__전멸훑음; } catch (e3) { 전투.__전멸훑음 = null; }
    var 충돌 = _격자다시(전투);

    /* ④ 화면은 새 unit 집합을 기준으로 다시 확보/갱신한다. */
    if (R) {
      전투.units.forEach(function (u) {
        try { if (R.updateUnit) R.updateUnit(u); } catch (e) {}
      });
      try { if (R.apply) R.apply(); } catch (e2) {}
    }

    return { 기본유닛: 새.length, 런타임유닛: 전투.units.length,
             재생성: 재생성, 누락: 누락, 격자충돌: 충돌, qsvOnly: !j };
  }

  /** 우리 퀵세이브가 사는 자리 — **적용 폴더**다 (사장님 확정) */
  var 파일이름 = 'GENESIS.QSV';

  var API = { 담기: 담기, 풀기: 풀기, 복원: 복원, 파일이름: 파일이름,
              상수: { 레코드크기: 레코드크기 } };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.G2BattleQuickSave = API;

})(typeof globalThis !== 'undefined' ? globalThis : this);
