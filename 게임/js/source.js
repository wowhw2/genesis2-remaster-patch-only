/* ============================================================================
 * G2Source — 원본/패치 파일 접근의 단일 브라우저 경계
 *
 * 목적:
 *   - 실행기 각 모듈이 `/원본/`, `?orig=1`, 패치 우선순위를 직접 조합하지 않는다.
 *   - 파일 선택은 서버 `OriginalSource` 경계(server.js: resolveGame)가 맡고,
 *     브라우저는 이 모듈을 통해 상대 경로와 mode만 전달한다.
 *   - 디코더(native.js, sce.js, item.js ...)는 바이트 의미만 해석한다.
 *
 * 이 모듈은 원본 파생 데이터를 저장하지 않는다. 메모리 캐시는 현재 페이지 수명에만 존재한다.
 * ========================================================================== */
(function (root) {
  'use strict';

  var 캐시 = Object.create(null);
  var manifestPromise = null;
  var epoch = 1;
  var mapLeaseEpoch = 1;
  var mapLeaseListeners = [];

  function 맵리스철회(reason) {
    mapLeaseEpoch++;
    mapLeaseListeners.slice().forEach(function (listener) {
      try { listener(reason || 'source-change', mapLeaseEpoch); } catch (e) {}
    });
    return mapLeaseEpoch;
  }
  function 맵리스철회구독(listener) {
    if (typeof listener !== 'function') throw new TypeError('MAP lease listener');
    mapLeaseListeners.push(listener);
    return function () {
      var i = mapLeaseListeners.indexOf(listener);
      if (i >= 0) mapLeaseListeners.splice(i, 1);
    };
  }

  function 경로정규화(name) {
    var s = String(name == null ? '' : name).replace(/\\/g, '/');
    /* 이 API는 원본 root 기준 상대 경로만 받는다. URL/질의가 들어오면 권위가 다시 갈라진다. */
    if (!s || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('?') >= 0 || s.indexOf('#') >= 0)
      throw new Error('G2Source: 원본 상대 경로가 아니다: ' + s);
    while (s.charAt(0) === '/') s = s.slice(1);
    var out = [];
    s.split('/').forEach(function (p) {
      if (!p || p === '.') return;
      if (p === '..') throw new Error('G2Source: 상위 경로는 허용하지 않는다: ' + s);
      out.push(p);
    });
    if (!out.length) throw new Error('G2Source: 빈 경로');
    return out.join('/');
  }

  function 현재모드(opts, name) {
    opts = opts || {};
    /* runtimeState 는 BLACKBOX.DAT / CONTIBAK.TMP 처럼 게임이 **써 가며 쓰는**
     * 현재 상태 파일 전용이다. 패치 자산 선택과 섞지 않는다. */
    if (opts.mode === 'runtimeState' || opts.kind === 'runtimeState') return 'runtimeState';
    if (opts.mode === 'effective' || opts.mode === 'originalOnly') return opts.mode;
    if (opts.originalOnly === true) return 'originalOnly';
    if (opts.originalOnly === false) return 'effective';
    var M = root.G2모드;
    /* 파일별 예외(늘패치)는 모드 모듈의 정책을 그대로 묻는다. */
    if (M && typeof M.소스모드 === 'function') return M.소스모드(name);
    if (M && typeof M.원본 === 'function' && M.원본()) return 'originalOnly';
    return 'effective';
  }

  function 주소(name, opts) {
    var p = 경로정규화(name), mode = 현재모드(opts, p);
    var u = '/원본/' + p.split('/').map(encodeURIComponent).join('/');
    /* ASCII query를 쓴다. `?원본=1`은 브라우저가 percent-encode해서 옛 서버 정규식과 어긋났다. */
    if (mode === 'originalOnly') u += '?orig=1';
    else if (mode === 'runtimeState') u += '?state=1';
    return u;
  }

  function 헤더값(headers, name) {
    try { return headers && typeof headers.get === 'function' ? headers.get(name) : null; }
    catch (e) { return null; }
  }

  function 인코딩경로(headers, name) {
    var value = 헤더값(headers, name);
    if (!value) return null;
    try { return 경로정규화(decodeURIComponent(value)); }
    catch (e) { return null; }
  }

  function 메타(response, path, mode) {
    var legacy = 헤더값(response && response.headers, 'X-Source');
    return {
      path: path,
      mode: 헤더값(response && response.headers, 'X-G2-Source-Mode') || mode,
      role: 헤더값(response && response.headers, 'X-G2-Source-Role') || legacy || null,
      alias: 헤더값(response && response.headers, 'X-G2-Source-Alias') || 'unknown',
      sourceGeneration: +(헤더값(response && response.headers, 'X-G2-Source-Generation') || 0),
      /* U 세대 비교에는 숫자 강제값을 쓰지 않는다. 기존 숫자 필드는 호환용이다. */
      sourceGenerationToken: 헤더값(response && response.headers, 'X-G2-Source-Generation') || null,
      actualRelativePath: 인코딩경로(response && response.headers, 'X-G2-Actual-Path'),
      mapResponseId: 헤더값(response && response.headers, 'X-G2-Map-Response-Id') || null,
      selectionPolicyId: 헤더값(response && response.headers, 'X-G2-Selection-Policy') || null,
      legacySource: legacy || null
    };
  }

  function 오류(path, response) {
    var e = new Error('원본 파일 없음/읽기 실패: ' + path +
      (response ? ' (' + response.status + ')' : ''));
    e.code = 'G2_SOURCE_READ_FAILED';
    e.path = path;
    if (response) e.status = response.status;
    return e;
  }

  /**
   * 상대 경로 하나를 읽는다.
   * @returns Promise<{bytes:Uint8Array, meta:Object, response:Response} | null>
   * `optional:true`이고 HTTP 실패면 null.
   */
  /* ── ★ 정본 504 — 원본 판 맞춤: 1.0(구버전) 원본을 받으면 «1.0 → 1.2(+우리 고침)» 차이를 덧입힌다 ─────────────
   *   사장님 11-27 휴대폰 «JOB-002: 기본 페이지 범위 밖 job=40 value=14947» — 1.0 원본 CHP.EXE 를 1.2 주소로 읽어 깨짐
   *   「버전 체크해서 1.0인경우에 패치도 다운로드받아지게 해줘」 → 차이(게임/원본판/1.0 · 04_도구/원본판10_차이.js)는 패치로 실려 온다
   *   받은 바이트의 크기·CRC 가 목록의 «바탕»(1.0 파일)과 같을 때만 덧입힌다 — 1.2 원본·고침 파일은 그대로 지나간다
   *   원본판() — CHP.EXE 를 받은 뒤 '1.2' · '1.0'(맞춤) · '모름' · null(아직) · 끄개 window.__원본판맞춤끔 */
  var 판목록약속 = null, 판 = null;
  var 판기준CRC = { 'CHP.EXE': 640644930 };   /* 1.2 CHP.EXE (526,751 B · 07_보관/pat12.exe 안 것과 같음) */
  function 판목록() {
    if (!판목록약속) 판목록약속 = Promise.resolve(root.fetch ? root.fetch('/' + encodeURIComponent('원본판') + '/1.0/' + encodeURIComponent('목록.json'), { cache: 'no-store' }) : null)
      .then(function (r) { return r && r.ok ? r.json() : null; })['catch'](function () { return null; });
    return 판목록약속;
  }
  function 원본판맞춤(path, bytes) {
    var 키 = String(path || '').toUpperCase();
    var CRC = root.G2G1Diff && root.G2G1Diff.crc32;
    if (root.__원본판맞춤끔 || !CRC) return Promise.resolve(bytes);
    var 판보기 = function (b, 맞춤) { if (키 === 'CHP.EXE') 판 = 맞춤 ? '1.0' : (CRC(b) === 판기준CRC['CHP.EXE'] ? '1.2' : '모름'); };
    return 판목록().then(function (목) {
      var 줄 = 목 && 목.파일 && 목.파일[키];
      if (!줄 || bytes.length !== 줄.바탕크기 || CRC(bytes) !== 줄.바탕CRC) { 판보기(bytes, false); return bytes; }
      return root.fetch('/' + encodeURIComponent('원본판') + '/1.0/' + 줄.차이.split('/').map(encodeURIComponent).join('/'))
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
        .then(function (ab) {
          var 새 = root.G2G1Diff.합치기(bytes, new Uint8Array(ab));
          판보기(새, true);
          if (root.console) console.info('[원본판] ' + 키 + ' — 1.0 원본을 1.2' + (줄.결과출처 === '적용' ? '(+고침)' : '') + ' 로 맞춰 읽는다');
          return 새;
        })['catch'](function (e) { if (root.console) console.warn('[원본판] ' + 키 + ' 맞춤 실패 — ' + (e && e.message)); 판보기(bytes, false); return bytes; });
    });
  }

  function 읽기(name, opts) {
    opts = opts || {};
    var path = 경로정규화(name), mode = 현재모드(opts, path);
    var useCache = opts.cache !== false;
    var key = epoch + '|' + mode + '|' + path.toUpperCase();
    if (useCache && 캐시[key]) return Promise.resolve(캐시[key]);

    var fetcher = opts.fetcher || root.fetch;
    if (typeof fetcher !== 'function') return Promise.reject(new Error('G2Source: fetch가 없다'));
    var u = 주소(path, { mode: mode });
    var init = opts.fetchInit || undefined;

    return Promise.resolve(fetcher(u, init)).then(function (r) {
      if (!r || !r.ok) {
        if (opts.optional) return null;
        throw 오류(path, r);
      }
      return r.arrayBuffer().then(function (ab) {
        return 원본판맞춤(path, new Uint8Array(ab));
      }).then(function (bytes) {
        var out = { bytes: bytes, meta: 메타(r, path, mode), response: r };
        if (useCache) 캐시[key] = out;
        return out;
      });
    });
  }

  function 바이트(name, opts) {
    return 읽기(name, opts).then(function (r) { return r ? r.bytes : null; });
  }

  /** 동일 MAP 응답의 바이트에서만 식별 hash를 만든다. 일반 read/캐시 의미는 유지한다.
   * hash·실제 상대 경로·손실 없는 세대가 없으면 U 공급자가 적용을 거부해야 한다. */
  function 맵식별읽기(name, opts) {
    var p = 경로정규화(name);
    if (!/^SCENARIO\/[^/]+\.MAP$/i.test(p))
      return Promise.reject(new TypeError('G2Source: MAP 상대 경로가 아니다'));
    var o = {};
    var requestedMapLeaseEpoch = mapLeaseEpoch;
    Object.keys(opts || {}).forEach(function (k) { o[k] = opts[k]; });
    if (o.mapTicket !== undefined) {
      if (typeof o.mapTicket !== 'string' || !/^[0-9a-f]{32}$/.test(o.mapTicket))
        return Promise.reject(new TypeError('G2Source: MAP 임대 ticket 형식 오류'));
      var oldInit = o.fetchInit || {};
      var nextHeaders = typeof root.Headers === 'function'
        ? new root.Headers(oldInit.headers || {})
        : Object.assign({}, oldInit.headers || {});
      if (typeof nextHeaders.set === 'function')
        nextHeaders.set('X-G2-U-Map-Ticket', o.mapTicket);
      else nextHeaders['X-G2-U-Map-Ticket'] = o.mapTicket;
      o.fetchInit = Object.assign({}, oldInit, { headers: nextHeaders });
    }
    o.cache = false; // 이전 root/세대의 응답을 새 MAP 세션에 재사용하지 않는다.
    return 읽기(p, o).then(function (r) {
      if (!r) return null;
      var subtle = root.crypto && root.crypto.subtle;
      if (!subtle && typeof require === 'function') {
        try { subtle = require('node:crypto').webcrypto.subtle; } catch (e) {}
      }
      if (!subtle) return Object.assign({}, r, { meta: Object.assign({}, r.meta,
        { contentHash: null, identityStatus: 'hash-unavailable' }) });
      return Promise.resolve(subtle.digest('SHA-256', r.bytes)).then(function (digest) {
        var hex = Array.from(new Uint8Array(digest), function (b) {
          return b.toString(16).padStart(2, '0');
        }).join('');
        var meta = Object.assign({}, r.meta, {
          contentHash: 'sha256:' + hex,
          mapLeaseEpoch: requestedMapLeaseEpoch,
          identityStatus: r.meta.actualRelativePath && r.meta.sourceGenerationToken &&
            (o.mapTicket === undefined || /^[0-9a-f]{32}$/.test(r.meta.mapResponseId || ''))
            ? 'ready' : 'source-meta-unavailable'
        });
        return Object.assign({}, r, { meta: meta });
      }, function () { return Object.assign({}, r, { meta: Object.assign({}, r.meta,
        { contentHash: null, identityStatus: 'hash-unavailable' }) }); });
    });
  }

  /** BLACKBOX.DAT / CONTIBAK.TMP 같은 **현재 게임 상태 파일** 전용 창구.
   * 패치 폴더는 보지 않고 game/save state root만 본다. */
  function 상태읽기(name, opts) {
    opts = opts || {};
    var o = {};
    Object.keys(opts).forEach(function (k) { o[k] = opts[k]; });
    o.mode = 'runtimeState';
    return 읽기(name, o);
  }
  function 상태바이트(name, opts) {
    return 상태읽기(name, opts).then(function (r) { return r ? r.bytes : null; });
  }

  /** 서버의 안전한 공개 source 상태. 절대경로나 원본 hash는 이 endpoint에 싣지 않는다. */
  function manifest(force, fetchInit) {
    if (!force && manifestPromise) return manifestPromise;
    var f = root.fetch;
    if (typeof f !== 'function') return Promise.resolve(null);
    var init = Object.assign({ cache: 'no-store' }, fetchInit || {});
    manifestPromise = f('/__source/manifest', init).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }, function () { return null; });
    var current = manifestPromise;
    if (init.signal && typeof init.signal.addEventListener === 'function') {
      var clearCanceled = function () {
        if (manifestPromise === current) manifestPromise = null;
      };
      if (init.signal.aborted) clearCanceled();
      else init.signal.addEventListener('abort', clearCanceled, { once: true });
      var removeAbort = function () {
        init.signal.removeEventListener('abort', clearCanceled);
      };
      current.then(removeAbort, removeAbort);
    }
    return current;
  }

  function 무효화(reason) {
    맵리스철회(reason || 'manual');
    캐시 = Object.create(null);
    manifestPromise = null;
    epoch++;
    return { epoch: epoch, reason: reason || 'manual' };
  }

  var API = {
    VERSION: 'source-boundary@2',
    normalizePath: 경로정규화,
    mode: 현재모드,
    url: 주소,
    read: 읽기,
    원본판: function () { return 판; },   /* 정본 504 — CHP.EXE 를 받은 뒤 '1.2' · '1.0'(맞춤) · '모름' */
    readMapIdentity: 맵식별읽기,
    bytes: 바이트,
    readState: 상태읽기,
    stateBytes: 상태바이트,
    metaFromResponse: 메타,
    manifest: manifest,
    invalidate: 무효화,
    revokeMapLease: 맵리스철회,
    onMapLeaseRevoked: 맵리스철회구독,
    mapLeaseEpoch: function () { return mapLeaseEpoch; },
    cacheEpoch: function () { return epoch; }
  };

  root.G2Source = API;

  /* 모드가 바뀌면 같은 경로가 다른 소스를 가리킬 수 있으므로 메모리 캐시를 폐기한다. */
  if (root.G2모드 && typeof root.G2모드.바뀌면 === 'function') {
    root.G2모드.바뀌면(function () { 무효화('mode-changed'); });
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof window !== 'undefined' ? window
   : (typeof globalThis !== 'undefined' ? globalThis : this));
