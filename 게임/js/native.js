/* ============================================================================
 * 창세기전 2 — 원본 직독 계층 (native.js)
 *
 *   목표: 추출해 둔 PNG/JSON 이 아니라 **원본 게임 파일을 런타임에 직접 읽어**
 *         디코딩·렌더링한다. 리마스터 수정·추가분은 오버라이드 폴더에서 먼저 찾는다.
 *
 *   데이터 소스
 *     제품 기본 경로는 `G2Source` → `/원본/<상대경로>` 하나다. 실제 선택은 server.js가
 *     effective(패치→원본→세이브→CD) / originalOnly 정책으로 결정하고 응답 헤더에
 *     provenance를 붙인다. `Provider({orig,over})`의 별도 base는 시험·독립 도구 호환용이다.
 *     CD(BIN/CUE) 안의 .SCE·.MAP·오디오는 서버/source 경계가 필요할 때 선택한다.
 *
 *   폰트 근거: 03_분석/COMBATII/나머지대역_분석.md §4, COMBATII.EXE 0x5DD5B/0x5DAA8.
 * ==========================================================================*/
(function (root) {
'use strict';

/* ── 1. 데이터 제공자 — 제품은 G2Source 위임, custom base만 로컬 폴백 ─────── */
function Provider(opts) {
  opts = opts || {};
  /* SOURCE-001
   * 기본 실행기에서는 파일 선택을 G2Source 한 곳에 맡긴다.
   * `opts.orig`/`opts.over`를 명시한 시험·독립 도구만 옛 custom-base 경로를 유지한다. */
  this.origBase = opts.orig || null;
  this.overBase = opts.over || null;
  this.source = opts.source || root.G2Source || null;
  this.cache = {};
}

Provider.prototype._legacyURL = function (name) {
  if (this.origBase) return this.origBase + name;
  return (typeof root.G2URL === 'function') ? root.G2URL(name) : ('/원본/' + name);
};

/** 파일 하나와 출처 메타데이터를 함께 읽는다. */
Provider.prototype.read = function (name) {
  var self = this;
  var key = String(name || '').toUpperCase();

  /* 기본 제품 경로: source.js가 URL·mode·선택권위를 소유한다. */
  if (!this.origBase && !this.overBase && this.source && typeof this.source.read === 'function') {
    return this.source.read(name);
  }

  /* 명시 custom-base는 시험/독립 실행기 하위호환이다. */
  if (this.cache[key]) return Promise.resolve(this.cache[key]);
  function get(url) {
    return root.fetch(url).then(function (r) {
      if (!r.ok) return null;
      return r.arrayBuffer().then(function (ab) { return { response: r, ab: ab }; });
    }).catch(function () { return null; });
  }
  var first = this.overBase ? get(this.overBase + name) : Promise.resolve(null);
  return first.then(function (got) {
    if (got) return { got: got, role: 'customOverride' };
    return get(self._legacyURL(name)).then(function (x) { return { got: x, role: 'customOriginal' }; });
  }).then(function (x) {
    if (!x.got) throw new Error('원본 파일 없음: ' + name);
    var out = {
      bytes: new Uint8Array(x.got.ab),
      meta: { path: name, mode: 'custom', role: x.role, alias: 'unknown', sourceGeneration: 0,
              selectionPolicyId: 'custom-base' },
      response: x.got.response
    };
    self.cache[key] = out;
    return out;
  });
};

/** 파일 하나를 Uint8Array 로. 기본 제품은 G2Source의 선택/캐시 규칙을 그대로 따른다. */
Provider.prototype.bytes = function (name) {
  return this.read(name).then(function (r) { return r.bytes; });
};

/* ── 1.5 소리 `.VSP` / `.SSP` / `.BSP` ────────────────────────────────
 *
 * 셋 다 **헤더 `0x40` 을 건너뛴 8비트 무부호 PCM**, **22000Hz** 입니다.
 *   · `.VSP` 효과음 34개 (칼·활·비명 …) — `0x4F4CD` 가 번호로 재생
 *   · `.SSP` 연출음 — 연출 함수가 `0x4F460` 으로 번호 50·51·52 에 싣고 재생
 *   · `.BSP` 환경음 — `0x4F427` 이 반복 0x3E7 = 사실상 무한
 * 샘플레이트 근거는 `0x5C665 eax = 0x55F0`(= 22000)입니다.
 * (`04_도구/g2_export_fx.py` 머리말 32~40행에 같은 내용이 적혀 있습니다.
 *  거기 「11025Hz 로 잡으면 느리게 들린다」는 메모도 함께 있습니다.)
 *
 * 브라우저에서 바로 틀 수 있도록 **WAV 로 감싸** 돌려줍니다.
 * @returns {{sampleRate:number, samples:number, wav:Uint8Array}}
 */
var SND_HEADER = 0x40, SND_RATE = 22000;      // 0x5C665
function decodeSound(u8, 헤더) {
  /* ★★★ **`.VOC` 는 헤더가 없다** (2026-08-20 실측).
   *   `.VSP`/`.SSP`/`.BSP` 는 앞 `0x40` 이 헤더지만, 오프닝 `HICOM.VOC`·`SOFTMAX.VOC` 는
   *   **첫 바이트부터 파형**이다 — `HICOM` 첫 바이트가 `7e 7e 7e 7f 80 80 …` 로
   *   8비트 무부호 무음(`0x80`) 근처에서 시작한다. `0x40` 을 건너뛰면 앞 3ms 가 잘린다.
   *   그래서 **헤더 길이를 인자로** 받는다 (안 주면 예전대로 `0x40`).
   *   ★ 표본율은 같다 — 길이가 `.FLI` 와 맞는다
   *     (HICOM 142603/22000 = 6.48초 · SOFTMAX 3274020/22000 = 148.8초). */
  var H = (헤더 == null) ? SND_HEADER : 헤더;
  if (!u8 || u8.length <= H) return null;
  var pcm = H ? u8.subarray(H) : u8, n = pcm.length;
  var out = new Uint8Array(44 + n), dv = new DataView(out.buffer);
  function s(o, t) { for (var i = 0; i < t.length; i++) out[o + i] = t.charCodeAt(i); }
  s(0, 'RIFF'); dv.setUint32(4, 36 + n, true); s(8, 'WAVE');
  /* [형식] **RIFF/WAVE 표준 헤더** — 자리 번호는 전부 그 규격이다
   * (12 'fmt ' · 16 청크크기 · 20 PCM · 22 채널 · 24 표본율 ·
   *  28 바이트/초 · 32 블록정렬 · 34 비트수 · 36 'data' · 40 길이 · 44 자료).
   * 원본은 PCM 을 직접 재생한다 — 이 헤더는 **브라우저에 넘기려고** 우리가 짓는다. */
  s(12, 'fmt '); dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);                  // PCM
  dv.setUint16(22, 1, true);                  // 모노
  dv.setUint32(24, SND_RATE, true);
  dv.setUint32(28, SND_RATE, true);           // 바이트/초 = 8비트 모노라 같다
  dv.setUint16(32, 1, true);                  // 블록 정렬
  dv.setUint16(34, 8, true);                  // 비트
  s(36, 'data'); dv.setUint32(40, n, true);
  out.set(pcm, 44);
  return { sampleRate: SND_RATE, samples: n, wav: out };
}

/* ── 2. 팔레트 GENESIS.PAL — 256×3, 6bit VGA → 8bit ─────────────────── */
function decodePalette(u8) {
  var pal = new Uint8Array(256 * 3);
  for (var i = 0; i < 256 * 3; i++) {
    var v = u8[i] & 0x3F;                 // 0..63
    pal[i] = (v << 2) | (v >> 4);         // → 0..255
  }
  return pal;                             // [r,g,b, r,g,b, …]
}

/* ★★★★★ **날씨가 걸리면 원본은 팔레트를 바꿔 DAC 에 쓴다** (2026-09-06 · 실측 확정)
 *
 *   ☠ 왜 필요했나 — 원본과 화면을 견주니 **우리가 약 1.27배 밝았다.**
 *     끝까지 따라가니 원본은 날씨 전투에서 팔레트 자체를 바꾸는데
 *     우리는 `GENESIS.PAL` 값을 **그대로** 쓰고 있었다.
 *
 * ── 어떻게 쟀나 ──────────────────────────────────────────────────────
 *   원본 활성 팔레트 `0x12824C` 768바이트를 전투 중에 읽어
 *   `GENESIS.PAL` 파일(6비트)과 색인별로 세웠다.
 *   (DAC 코드 `0x5F9AE` 의 `ebx` 가 그 버퍼다 — `0x1076E mov ebx,0xb824c`,
 *    메모리 operand 라 `+0x70000`)
 *
 *   ★ 날씨냐 시각이냐를 **대조군으로 갈랐다** — 전 시나리오 327개의 `.SCE` 머리를
 *     훑어 짝을 찾았다:
 *       `1-7`(날씨0·시각0)   → 파일 그대로   ⇒ 시각 아님
 *       `3-9`(날씨2·시각255) → 어둡다        ⇒ 시각 아님
 *   ★ 그리고 **같은 맵에 날씨만 다른 짝**으로 맵 구간(104~255)까지 확인했다:
 *       `R01.MAP`  `12-6`(날씨0) ↔ `2-6`(비)     768/768
 *       `DES03.MA` `16-1`(날씨0) ↔ `15-2`(모래)  768/768
 *
 * ── 표 (`.SCE` 머리 `+0x04` = 날씨 · 전역 `[0xBA84D]` · 점프표 `0x45144`) ──
 *   | 0 없음     | `v`                       | —                             |
 *   | 1 비       | `floor(v * 4 / 5)`        | 768/768                       |
 *   | 2 눈       | `floor(v * 4 / 5)`        | 768/768 — **비와 완전히 같다** |
 *   | 3 모래바람 | `ceil(v + (56 - v) / 5)`  | 768/768                       |
 *   | 4 안개     | `floor((v + 42) / 2)`     | 312/312 (맵 구간은 짝이 없어 미검증) |
 *
 *   자세히 — `03_분석/표/json/날씨_팔레트변환.json`
 *
 * ☠ **아직 배선하지 않았다.** 원본은 DAC 전체를 바꾸므로 맵뿐 아니라
 *   스프라이트·UI 도 같이 어두워져야 한다(색인 0~103 도 변환된다 — 312/312).
 *   어느 자리에서 한 번에 걸지는 팔레트 파이프라인을 훑고 정한다.
 *
 * @param {Uint8Array} pal8  8비트 팔레트 768바이트 (`decodePalette` 결과)
 * @param {number} 날씨      0 없음 · 1 비 · 2 눈 · 3 모래바람 · 4 안개
 * @returns {Uint8Array} 새 팔레트 (원본은 안 건드린다)
 */
function 날씨팔레트(pal8, 날씨) {
  var w = 날씨 | 0;
  if (!pal8 || w < 1 || w > 4) return pal8;
  var out = new Uint8Array(pal8.length);
  for (var i = 0; i < pal8.length; i++) {
    /* 8비트 → 6비트로 되돌린다. `(v<<2)|(v>>4)` 는 단사라 `>>2` 가 정확한 역이다
     * (검산 — 50 → 203 → `203>>2` = 50). */
    var v = pal8[i] >> 2;
    var n;
    if (w === 1 || w === 2) n = Math.floor(v * 4 / 5);            /* 비 · 눈 */
    else if (w === 3)       n = Math.ceil(v + (56 - v) / 5);      /* 모래바람 */
    else                    n = Math.floor((v + 42) / 2);         /* 안개 */
    if (n < 0) n = 0; else if (n > 63) n = 63;
    out[i] = (n << 2) | (n >> 4);
  }
  return out;
}

/** 지금 전투의 날씨를 보고 팔레트를 바꿔 준다 — **전투 안에서만** 쓴다.
 *
 *  ★ 원본은 `0x1077A` 가 팔레트 **0~255 전부**를 DAC 에 쓴다. 곧 맵뿐 아니라
 *    스프라이트·초상화·HUD 도 같은 팔레트를 본다. ⇒ 전투에서 팔레트를 만드는
 *    자리마다 이것을 거쳐야 화면 전체가 원본과 같아진다.
 *
 *  ☠ **마을·시민 쪽에서는 부르지 않는다.** `decodePalette` 자체에 넣으면
 *    전투 밖에서도 걸려 버린다. 그래서 **전투 파일에서만 명시로** 부른다.
 *
 *  @param {Uint8Array} pal8  `decodePalette` 결과 (8비트 768바이트)
 *  @returns {Uint8Array} 날씨가 걸렸으면 바꾼 사본, 아니면 받은 그대로
 */
function 전투팔레트(pal8) {
  var s = (root.G2 && root.G2.scene) || null;
  var w = s ? (s['날씨'] | 0) : 0;
  return (w >= 1 && w <= 4) ? 날씨팔레트(pal8, w) : pal8;
}

/**
 * 팔레트 섞기 — `0x30824` + `0x5FD1C` 를 그대로.
 *
 * 원본은 화면을 8비트 인덱스로 그리므로 **팔레트만 바꿔** 색을 통째로 돌린다.
 * ```
 * 0x30831  0x5F945 로 지금 팔레트 256색을 저장 (DAC 0x3C7 → 0x3C9 읽기)
 * 0x30842  for (i = from; i < to; i++) 목표[i] = 원본[색번호]     ; RGB 3바이트 복사
 * 0x3087D  0x5FC21 : 목표[i] −= 원본[i]                          ; 목표가 「차이」가 된다
 * 0x30893  0x5FD1C : 새값 = 원본[i] + 차이[i] × 퍼센트 / 100      ; 0x5FD68·0x5FD78·0x5FD84
 *          → out 0x3C9 로 곧바로 DAC 에 쓴다 (0x5FD86)
 * 0x5FD30  퍼센트는 100 을 넘지 못한다
 * ```
 * **페이드가 아니라 한 번에 끝난다.** 블리자드 스톰은 `0x3B043 edx = 0x28`(40%) ·
 * `0x3B04D eax = 0`(0번 색 = 검정) 으로 부른다 → 인덱스 0x60~0xFF 만 40% 어두워진다.
 *
 * @param {Uint8Array} pal   768바이트 (RGB × 256)
 * @param {number} colorIdx  섞을 색 번호
 * @param {number} pct       0~100
 * @param {number} [from]    시작 인덱스 (기본 0x60 — 0x30842)
 * @param {number} [to]      끝 인덱스(미포함, 기본 0x100)
 * @returns {Uint8Array} 새 팔레트 (원본은 안 건드린다)
 */
function mixPalette(pal, colorIdx, pct, from, to) {
  var out = new Uint8Array(pal);
  if (!pal || pal.length < 768) return out;
  var f = (from == null ? 0x60 : from | 0), t = (to == null ? 0x100 : to | 0);
  var p = Math.min(100, Math.max(0, pct | 0));            // 0x5FD30
  var c = (colorIdx | 0) * 3;
  for (var i = f; i < t; i++) {
    for (var k = 0; k < 3; k++) {
      var base = pal[i * 3 + k];
      /* 0x5FC37 은 부호 있는 바이트로 뺀다 — 목표가 더 어두우면 음수가 된다.
       * 원본 팔레트가 6비트(0~63)라 차이도 −63~63 이고 바이트 안에 들어간다. */
      var diff = (pal[c + k] | 0) - base;
      out[i * 3 + k] = Math.max(0, Math.min(255, base + idiv(diff * p, 100)));
    }
  }
  return out;
}
function idiv(a, b) { var q = a / b; return q < 0 ? Math.ceil(q) : Math.floor(q); }

/**
 * 화면 밝기 리맵 — `0x5EE2B` 기록기 + `0x6106C` 가 만드는 256바이트 표.
 *
 * 원본은 화면을 **읽어서 표로 치환**한다(칠하는 게 아니다).
 * ```
 * 0x5EE33  call 0x5EB00(x, y)        화면 주소
 * 0x5EE3F  bl = [화면픽셀]           지금 색 인덱스
 * 0x5EE41  ebx += [0xB8550]          리맵 표 (0x6104A 가 베이스 + 단계×256 으로 고른다)
 * 0x5EE47  bl = [ebx] · 0x5EE49  [화면픽셀] = bl
 * ```
 * 표는 시작할 때 만들어 둔다 — `0x6106C(eax = 단계, bl = 강도, dx = 종류)`.
 * ```
 * 0x61074  ebx = 100 − 강도          ← **남길 밝기(%)**
 * 0x61097  call [0xB854C]            색 하나를 그 밝기의 가장 가까운 팔레트 색으로
 * 0x610A9  [베이스 + 단계*256 + i] = 결과
 * ```
 * 초기화 `0x55C68` 이 **단계 0 = 강도 60 → 남길 40%**, `0x55C71` 이 단계 1 = 30% 로 만든다.
 *
 * ★ 원본은 인덱스 팔레트라 「가장 가까운 색」으로 근사할 수밖에 없지만,
 *   우리는 트루컬러라 **그냥 곱하면 된다**(근사가 아니라 더 정확하다).
 *   화면을 훑는 대신 팔레트에 곱해 두면 결과가 같다.
 *
 * @param {Uint8Array} pal  768바이트
 * @param {number} pct      남길 밝기(%). 블리자드 스톰은 40 (단계 0)
 * @param {number} [from]   기본 0 — 리맵은 **전 인덱스**에 걸린다
 * @param {number} [to]     기본 0x100
 */
function scalePalette(pal, pct, from, to) {
  var out = new Uint8Array(pal);
  if (!pal || pal.length < 768) return out;
  var f = (from == null ? 0 : from | 0), t = (to == null ? 0x100 : to | 0);
  var p = Math.min(100, Math.max(0, pct | 0));
  for (var i = f * 3; i < t * 3; i++) out[i] = idiv(pal[i] * p, 100);
  return out;
}

/* ── 3. NEWASCII.FNT — 256자 × 16바이트(8×16, 1bpp, MSB 왼쪽) ────────── */
/**
 * PCX — `NOWLOAD.PCX`(320×200 8bpp) 직독.
 *
 * 원작은 QUICK LOAD 를 누르면 이 그림을 띄운다(사용자 화면 2026-08-15:
 * 검은 바탕에 Genesis 로고와 「Now Loading…」).
 *
 * 표준 ZSoft PCX 그대로다 — 헤더 128바이트, RLE(상위 2비트가 11 이면 반복),
 * 8bpp 이면 파일 끝 769바이트가 `0x0C` + 팔레트 768.
 *
 * @returns {{w,h,px:Uint8Array,pal:Uint8Array}} `pal` 은 0~255 (PAL 은 0~63)
 */
function decodePcx(u8) {
  if (!u8 || u8.length < 128 || u8[0] !== 0x0A) return null;
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  var x1 = dv.getUint16(4, true), y1 = dv.getUint16(6, true);
  var x2 = dv.getUint16(8, true), y2 = dv.getUint16(10, true);
  var w = x2 - x1 + 1, h = y2 - y1 + 1;
  var bpp = u8[3], planes = u8[65], bpl = dv.getUint16(66, true);
  if (bpp !== 8 || planes !== 1) return null;              // 8bpp 한 장만 쓴다
  var px = new Uint8Array(w * h), o = 128;
  for (var y = 0; y < h; y++) {
    var x = 0, row = y * w;
    while (x < bpl && o < u8.length) {
      var b = u8[o++], n = 1;
      if ((b & 0xC0) === 0xC0) { n = b & 0x3F; b = u8[o++]; }
      for (var i = 0; i < n; i++, x++) if (x < w) px[row + x] = b;
    }
  }
  /* [형식] **PCX 규격** — 256색 팔레트는 파일 **끝에서 769바이트**에 있고
   * 그 첫 바이트가 표시자 `0x0C`, 뒤이어 256 × 3 = 768바이트가 온다. */
  var pal = new Uint8Array(768), po = u8.length - 769;
  if (po > 0 && u8[po] === 0x0C) pal.set(u8.subarray(po + 1, po + 769));
  /* ★★★★★ **PCX 팔레트도 「6비트 × 4」다 — 화면 0~255 로 늘린다** (2026-09-02)
   *
   *   ☠ 전에는 「0~255 그대로 쓴다(PAL 과 달리 6비트가 아니다)」고 적어 두었다.
   *     그래서 PCX 를 쓰는 모든 화면이 원본보다 **조금씩 어두웠다.**
   *
   *   실측 — `AN02.PCX`(타이틀):
   *     색인 16  저장 `[252,244,176]`  ÷4 → `[63,61,44]`  → 화면 `[255,247,178]`
   *     색인  1  저장 `[252,252,252]`  ÷4 → `[63,63,63]`  → 화면 `[255,255,255]`
   *   ★ 저장값이 **전부 4의 배수**다 — 6비트 값을 4배해 적은 것이다.
   *   ★ 같은 색이 `GENESIS.PAL`(6비트 원본)에도 `[63,61,44]` 로 있다.
   *   ★ **원본을 js-dos 로 띄워 타이틀 글자를 재니 `[255,247,178]`** — 한 칸도 안 틀린다.
   *
   *   ★★ 같은 파일 `readFpm()` 은 **이미 맞게** 하고 있었다 —
   *     「팔레트는 0~252 (VGA 0~63 × 4) — 화면 0~255 로 늘린다」.
   *     `.FPM` 은 늘리고 `.PCX` 만 안 늘리던 것이다(한 파일 안의 모순 · **R58**).
   *
   *   ⇒ **여기서 한 번만** 늘려 둔다 — `pal` 을 받는 모든 곳
   *     (`pcxToCanvas` · `frameToCanvas` · 셀의 `것.팔레트` · 역룩업)이 함께 맞는다. */
  for (var pi = 0; pi < 768; pi++) { var pt = pal[pi] >> 2; pal[pi] = (pt << 2) | (pt >> 4); }
  return { w: w, h: h, px: px, pal: pal };
}

/** PCX 를 캔버스로.
 *
 * ★★★★★ **PCX 팔레트도 「6비트 × 4」다 — 화면 0~255 로 늘려야 한다** (2026-09-02 정정)
 *
 *   ☠ 여기 있던 주석 「팔레트는 0~255 **그대로** 쓴다(PAL 과 달리 6비트가 아니다)」는
 *     **틀렸다.** 그래서 PCX 를 쓰는 모든 화면이 원본보다 **조금씩 어두웠다.**
 *
 *   실측 — `AN02.PCX`(타이틀) 팔레트:
 *   ```
 *   색인 16  저장 [252,244,176]  ÷4 → [63,61,44]  → 화면 [255,247,178]
 *   색인  1  저장 [252,252,252]  ÷4 → [63,63,63]  → 화면 [255,255,255]
 *   ```
 *   ★ 저장값이 **전부 4의 배수**다 — 곧 6비트 값을 4배해 적어 둔 것이다.
 *   ★ 같은 색이 `GENESIS.PAL`(6비트 원본)에도 **`[63,61,44]`** 로 들어 있다.
 *   ★ **원본을 js-dos 로 띄워 타이틀 글자를 재니 `[255,247,178]`** 이었다 —
 *     늘린 값과 한 칸도 안 틀린다. (우리는 `[252,244,176]` 이었다)
 *
 *   ★★★ **같은 파일 `readFpm()` 이 이미 맞게 하고 있었다** — 993줄 주석:
 *     「팔레트는 0~252 (VGA 0~63 × 4) — 화면 0~255 로 늘린다」.
 *     `.FPM` 은 늘리고 `.PCX` 만 안 늘리던 것이다(한 파일 안의 모순 · **R58**).
 *
 *   ⇒ `decodePalette`·`readFpm` 과 **같은 식**을 쓴다: 상위 6비트를 쓰고 하위를 채운다. */
function pcxToCanvas(img) {
  if (!img || typeof document === 'undefined') return null;
  var c = document.createElement('canvas');
  c.width = img.w; c.height = img.h;
  var g = c.getContext('2d'), id = g.createImageData(img.w, img.h), d = id.data;
  /* ★ 팔레트는 `decodePcx` 가 **이미 화면 0~255 로 늘려** 둔다 — 여기서 또 늘리지 않는다 */
  for (var i = 0; i < img.px.length; i++) {
    var p = img.px[i] * 3, q = i * 4;
    d[q] = img.pal[p]; d[q + 1] = img.pal[p + 1]; d[q + 2] = img.pal[p + 2]; d[q + 3] = 255;
  }
  /* ★★★★★ **`.PCX` 도 스케일러를 탄다** (2026-09-22 사장님 지정)
   *
   *   > 사장님: 「**월드나 마을에도 스케일러 공통으로** 적용되어야해.」
   *
   *   `.PCX` 는 타이틀·챕터·옵션·전직 **배경**이다. 여기만 빼 두면 월드·마을에서
   *   인물(`frameToCanvas`)만 커지고 배경은 도트인 **섞인 화면**이 된다.
   *   ★ `toCanvas` 가 `논리w`/`논리h` 를 달아 주므로, 그리는 쪽은 공용 창구
   *     `논리그리기()`(게임.html)가 논리 크기로 눌러 담는다. N=1 이면 예전과 같다. */
  if (root.G2Scaler && root.G2Scaler.N && root.G2Scaler.N() > 1 && root.G2Scaler.toCanvas)
    return root.G2Scaler.toCanvas(id);
  g.putImageData(id, 0, 0);
  c['논리w'] = img.w; c['논리h'] = img.h;
  return c;
}

function decodeNewascii(u8) {
  var out = new Array(256);
  for (var c = 0; c < 256; c++) {
    var rows = new Array(16), o = c * 16;
    for (var y = 0; y < 16; y++) rows[y] = u8[o + y];   // 1바이트 = 8픽셀
    out[c] = { w: 8, h: 16, rows: rows, bpr: 1 };
  }
  return out;
}

/* ── 4. TEXT.CHR — 0x80 헤더 뒤 100자 × (8 건너뜀 + 29 본문) ──────────
 *   본문 29 = w(u16) h(u16) + w*h 바이트. 0xFF 투명. 글리프 = 문자코드-1.
 *   (0x5F874 · 0x608E6) */
function decodeTextchr(u8) {
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  var out = new Array(100), o = 0x80;
  for (var i = 0; i < 100; i++) {
    var b = o + 8;
    var w = dv.getUint16(b, true), h = dv.getUint16(b + 2, true);
    var px = u8.subarray(b + 4, b + 4 + w * h);
    out[i] = { w: w, h: h, px: px, tr: 0xFF };
    o += 37;
  }
  return out;
}

/* ── 5. NEWHAN.FNT — 조합형 한글 (16×16, 1bpp, 32바이트/글리프) ────────
 *   초성 8벌×20자 @0,  중성 4벌×22자 @5120,  종성 4벌×28자 @7936.
 *   COMBATII.EXE 0x5DD5B 가 세 벌을 OR 합성. §4-2. */
var NEWHAN = { CHO: 0, JUNG: 5120, JONG: 7936, CHO_N: 20, JUNG_N: 22, JONG_N: 28 };

/* COMBATII.EXE 에서 뽑은 벌/인덱스 표 (0x5D85A~0x5D90E). 폰트 조합 알고리즘의
 * 상수이므로 원본 렌더러(0x5DD5B)를 그대로 옮긴 것이다. */
var NH = {
  cho_bul_no:  [0,0,1,1,1,1,1,1,1,1,1,1,1,1,1,1,0,1,1,1],       // 받침 없음, 중성별
  cho_bul_yes: [0,2,3,3,3,3,3,3,3,3,3,3,3,3,3,3,2,3,3,3],       // 받침 있음
  jong_bul:    [0,0,2,0,2,1,2,1,2,3,0,2,1,3,3,1,2,1,3,3,1,1],   // 중성별
  jung_bul_no: [0,0,0,0,0,0,0,0,0,1,3,3,3,1,2,4,4,4,2,1,3,0],   // 초성별
  jung_bul_yes:[0,5,5,5,5,5,5,5,5,6,7,7,7,6,6,7,7,7,6,6,7,5]
};
function pick(tbl, i) { return tbl[i < 0 ? 0 : (i >= tbl.length ? tbl.length - 1 : i)] | 0; }

function decodeNewhan(u8) {
  /* 원시 벌 시트만 넘긴다. 글리프 32바이트는 필요할 때 잘라 쓴다. */
  return { data: u8 };
}
/** 벌·자 인덱스로 32바이트 글리프 하나를 꺼냅니다. */
function glyph32(font, part, bul, gi) {
  var per = part === 'cho' ? NEWHAN.CHO_N : part === 'jung' ? NEWHAN.JUNG_N : NEWHAN.JONG_N;
  var base = part === 'cho' ? NEWHAN.CHO : part === 'jung' ? NEWHAN.JUNG : NEWHAN.JONG;
  var idx = bul * per + gi;
  var off = base + idx * 32;
  return font.data.subarray(off, off + 32);   // 16행 × 2바이트
}
/**
 * 유니코드 한글 음절 → 16×16 비트맵(2바이트/행). 초·중·종 3벌 OR 합성.
 * 유니코드 자모 순서가 인덱스 표와 +1 대응함을 확인해 곧바로 씁니다.
 */
function composeSyllable(font, code) {
  var s = code - 0xAC00;
  var uCho = (s / 588) | 0, uJung = ((s % 588) / 28) | 0, uJong = s % 28;
  var choGi = uCho + 1, jungGi = uJung + 1, jongGi = uJong;   // 0 = 채움/없음
  var hasJong = uJong > 0;
  /* 벌 선택 — 원본 COMBATII 조합형 합성 루틴 0x5DD5B 를 직접 디스어셈블해 확정.
   * (표 이름이 실제 용도와 반대다: cho_bul 표는 '중성 벌', jung_bul 표는 '초성 벌'에 쓰인다.)
   *   초성 벌 = 받침없음 ? jung_bul_no[중성idx] : jung_bul_yes[중성idx]   ; 0x5de60/0x5de7e
   *   중성 벌 = 받침없음 ? cho_bul_no[초성idx]  : cho_bul_yes[초성idx]    ; 0x5de66/0x5de84
   *   종성 벌 = jong_bul[중성idx]                                          ; 0x5de50
   *   글리프 = 폰트 + 벌×(20/22/28×32) + idx×32   (초 0xb38f8·중 0xb4cf8·종 0xb57f8) */
  var choBul = pick(hasJong ? NH.jung_bul_yes : NH.jung_bul_no, jungGi);
  var jungBul = pick(hasJong ? NH.cho_bul_yes : NH.cho_bul_no, choGi);
  var jongBul = pick(NH.jong_bul, jungGi);

  var out = new Uint8Array(32);            // 16행 × 2바이트
  function or(g) { for (var i = 0; i < 32; i++) out[i] |= g[i]; }
  or(glyph32(font, 'cho', choBul, choGi));
  or(glyph32(font, 'jung', jungBul, jungGi));
  if (hasJong) or(glyph32(font, 'jong', jongBul, jongGi));
  return out;                              // rows[y] = out[y*2]<<8 | out[y*2+1]
}

/* ── 6. 렌더 — ctx 에 문자열 한 줄. ASCII=NEWASCII(8×16), 한글=NEWHAN(16×16).
 *   0x5DD5B 순서. rgb = [r,g,b]. 반환: 다음 x. ───────────────────────── */
/* ★★★★★ **자동 줄바꿈** — `CHP.EXE 0x2CFED` (2026-09-07 배선)
 *
 *   원본은 **글자를 찍는 함수 자체**가 줄을 넘긴다 —
 *     0x2D203  cmp al, 0x0A / jne              ; 줄바꿈 글자
 *     0x2D207    x = 처음 x ; y += [0x88582]
 *     0x2D23C  cmp [0x116502], 0x138(312)/jle  ; ★ ASCII 한계
 *     0x2D03F  cmp [0x116502], 0x130(304)/jle  ; ★ 한글 한계 — **8 작다**
 *     0x2D247  cmp [0x88584], 0 / je           ;   자동 줄바꿈 켬/끔
 *     0x2D251/0x2D054  x = 0 ; y += [0x88582]
 *   설정 칸 셋은 **바꾸는 자리가 없어 상수**다(문서가 전수로 확인) —
 *     [0x88580] = 16 (한글 폭 · ASCII 는 ÷2 = 8) · [0x88582] = 16 (줄 높이)
 *     [0x88584] = 1  (자동 줄바꿈 켬)
 *
 *   ☠ **한계가 ASCII 312 · 한글 304 로 다르다. 하나로 합치지 않는다**(문서 §6).
 *   ☠ **기본 동작은 안 바꾼다** — `drawText` 를 부르는 곳이 **37곳**이다.
 *     `옵션.자동줄바꿈` 을 준 자리에서만 넘기고, 그때만 `{x, y}` 를 돌려준다. */
var 글꼴상수 = {
  한글폭: 16,        /* [0x88580] */
  줄높이: 16,        /* [0x88582] */
  한계ASCII: 312,    /* 0x2D23C  0x138 */
  한계한글: 304      /* 0x2D03F  0x130 — ASCII 보다 8 작다 */
};

/* ★★★★★ **글자도 스케일러를 탄다** (2026-09-24 · Z-44)
 *   > 사장님: 「글자에도 적용.」
 *   글자는 1픽셀 `fillRect` 로 찍혀 N배 캔버스에서 **최근접 확대**만 됐다(필터 밖).
 *   ⇒ 글자 하나(글꼴·코드·색)를 1배로 찍고 지금 필터로 N배를 구워 캐시한 뒤
 *     논리 크기로 그린다. 자리(x·y·전진폭)는 그대로다.
 *   ★ 대상 캔버스가 **N배로 그려질 때만**(변환 배율 ≥ N) 이 길을 탄다 — 1배 임시
 *     캔버스에 N배 그림을 줄여 넣으면 흐려지므로 그쪽은 예전처럼 찍는다. */
var 글자캐시 = {}, 글자캐시필터 = null, 글자캐시듣는중 = false, 글꼴번호 = 0;
function 필터글자쓸까(ctx) {
  var S = root.G2Scaler;
  if (!S || typeof S.N !== 'function' || S.N() <= 1 || typeof document === 'undefined') return false;
  var m = null;
  try { m = ctx.getTransform ? ctx.getTransform() : null; } catch (e) { m = null; }
  /* [리마스터] 캔버스가 1배보다 크면 필터 글리프(N배)를 논리 크기로 눌러 그린다 — 전엔 «변환 배율 ≥ N» 이어야 해서
   *   셸(월드·마을) 캔버스 배율이 N 보다 작으면 대사 글자가 최근접 확대(도트)로 남았다 (11-13 사장님 마을 이벤트 대사 사진) */
  return !!(m && m.a > 1.01);
}
function 필터글자(종류, code, bits, w, h, rgb) {
  var S = root.G2Scaler, 키필터 = S.cur() + 'x' + S.N();
  if (!글자캐시듣는중 && typeof S.onChange === 'function') {
    글자캐시듣는중 = true;
    S.onChange(function () { 글자캐시 = {}; });          /* 좁힘 조절(이름 그대로)도 비운다 */
  }
  if (글자캐시필터 !== 키필터) { 글자캐시 = {}; 글자캐시필터 = 키필터; }
  var 키 = 종류 + code + '|' + rgb[0] + ',' + rgb[1] + ',' + rgb[2];
  var c = 글자캐시[키];
  if (c) return c;
  var t = document.createElement('canvas'); t.width = w; t.height = h;
  var g = t.getContext('2d'), im = g.createImageData(w, h);
  for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
    if (!bits(xx, yy)) continue;
    var q = (yy * w + xx) * 4;
    im.data[q] = rgb[0]; im.data[q + 1] = rgb[1]; im.data[q + 2] = rgb[2]; im.data[q + 3] = 255;
  }
  c = S.toCanvas(im);                                     /* 논리w·논리h 가 달린다 */
  글자캐시[키] = c;
  return c;
}

function drawText(ctx, fonts, s, x, y, rgb, 옵션) {
  var 자동 = !!(옵션 && 옵션.자동줄바꿈);          /* [0x88584] — 준 자리에서만 */
  var 처음x = x, 줄높이 = (옵션 && 옵션.줄높이) || 글꼴상수.줄높이;
  var 필터 = 필터글자쓸까(ctx);
  var 벌 = 필터 ? (fonts.__글자번호 || (fonts.__글자번호 = ++글꼴번호)) : 0;   /* 글꼴 묶음마다 캐시를 가른다 */
  ctx.fillStyle = 'rgb(' + rgb[0] + ',' + rgb[1] + ',' + rgb[2] + ')';
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i);
    /* 0x2D203 — 줄바꿈 글자는 **처음 x** 로 돌아간다(0 이 아니다) */
    if (자동 && code === 0x0A) { x = 처음x; y += 줄높이; continue; }
    if (code >= 0xAC00 && code <= 0xD7A3) {               // 완성형 한글 16×16
      /* 0x2D03F — 한글은 **304** 를 넘으면 x=0 (0x2D054) */
      if (자동 && x > 글꼴상수.한계한글) { x = 0; y += 줄높이; }
      var gl = composeSyllable(fonts.newhan, code);
      if (필터) {
        ctx.drawImage(필터글자('H' + 벌 + ':', code, function (bx, by) {
          return ((gl[by * 2] << 8) | gl[by * 2 + 1]) & (0x8000 >> bx);
        }, 16, 16, rgb), x, y, 16, 16);
        x += 16;
        continue;
      }
      for (var yy = 0; yy < 16; yy++) {
        var word = (gl[yy * 2] << 8) | gl[yy * 2 + 1];
        for (var xx = 0; xx < 16; xx++)
          if (word & (0x8000 >> xx)) ctx.fillRect(x + xx, y + yy, 1, 1);
      }
      x += 16;
    } else if (code < 0x80) {                              // ASCII 8×16
      /* 0x2D23C — ASCII 는 **312** 를 넘으면 x=0 (0x2D251) */
      if (자동 && x > 글꼴상수.한계ASCII) { x = 0; y += 줄높이; }
      var ga = fonts.newascii[code];
      if (필터 && ga) {
        ctx.drawImage(필터글자('A' + 벌 + ':', code, function (bx, by) {
          return ga.rows[by] & (0x80 >> bx);
        }, 8, 16, rgb), x, y, 8, 16);
        x += 8;
        continue;
      }
      for (var ay = 0; ay < 16; ay++) {
        var bitsA = ga.rows[ay];
        for (var ax = 0; ax < 8; ax++)
          if (bitsA & (0x80 >> ax)) ctx.fillRect(x + ax, y + ay, 1, 1);
      }
      x += 8;
    } else { x += 8; }
  }
  /* ☠ 기본은 **예전 그대로 x 하나**를 돌려준다 — 37 곳이 그 값을 쓴다 */
  return 자동 ? { x: x, y: y } : x;
}

/* ── 7. 스프라이트 컨테이너 — NC2/BCR/RCR/… (캐릭터) · NSP (이펙트) ──────
 *   공통: 서명 "New Fast&Compress Sprite", 프레임 수 @0x42 (u16).
 *   NC2: 12B 헤더 + RLE 세그먼트(skip/dword/byte), 투명 0, stride 320.
 *        코덱 출처 CHP.EXE 0x1D874.
 *   NSP: 32B 헤더 + 무압축 [u16 w][u16 h][w*h], 투명 0xFF. PRO.NSP만 RLE(★ stride 480). */
var SPR_SIG = 'New Fast&Compress Sprite';
var SCREEN_W = 320;
/** ★ NSP RLE 의 화면 stride — 원본 `[0x755DA] = 480` (`0x5EB00` 주소 계산). */
var NSP_STRIDE = 480;
/* ★ 시도 순서 — 480(COMBATII 전투 화면) 을 먼저 본다. 기존 동작을 유지하려는 것이다.
 *   완전히 투명한 프레임은 어느 쪽이든 빈 줄 수가 같으므로 480 이 그대로 뽑힌다. */
var NSP_STRIDES = [480, 320];
function le16(u, o) { return u[o] | (u[o + 1] << 8); }
function le32(u, o) { return (u[o] | (u[o + 1] << 8) | (u[o + 2] << 16) | (u[o + 3] << 24)) >>> 0; }
function ls16(u, o) { var v = le16(u, o); return v >= 0x8000 ? v - 0x10000 : v; }
function isSprite(u8) {
  for (var i = 0; i < SPR_SIG.length; i++) if (u8[i] !== SPR_SIG.charCodeAt(i)) return false;
  return true;
}
function spriteFrameCount(u8) { return le16(u8, 0x42); }

function hdrAt(u8, o) {
  if (o + 12 > u8.length) return null;
  var sz = le32(u8, o), w = le16(u8, o + 4), h = le16(u8, o + 6), ax = ls16(u8, o + 8), ay = ls16(u8, o + 10);
  /* [원본없음] — **깨진 파일을 걸러내는 방어선**이다. 원본에는 이런 검사가 없다
   * (원본은 자기 자료만 읽으니 그럴 필요가 없다).
   * 4096 은 원본 최대 스프라이트(320x200)보다 넉넉히 큰 값으로 잡았다. */
  if (!(w > 0 && w <= 4096 && h > 0 && h <= 4096) || o + 12 + sz > u8.length) return null;
  return { offset: o, size: sz, w: w, h: h, ax: ax, ay: ay };
}
/** NC2 프레임 배치 판정 — 레이아웃 A(오프셋표) 우선, 실패 시 B(순차+gap) 탐색. */
/**
 * `.NC2` 파일 앞머리의 **무기 스윙 메타 40바이트**를 푼다.
 *
 * 원본 `COMBATII 0x11575` 로더:
 *   file+0x80  u8 flag
 *   flag != 0 이면 file+0x81 부터 40B
 *   = 4방향 × 2종(일반/크리티컬) × 5B
 *   = `(frameNo, x1, y1, x2, y2)`
 *
 * `frameNo == -1` 은 스윙 그림 없음. 나머지 네 값은 `0x1E2EA` 가
 * `movsx byte` 로 읽으므로 signed byte 다.
 *
 * ★ `.BCR/.RCR/...` 도 같은 decodeNC2 코덱을 쓰지만 이 40B 계약은 `.NC2` 전용이다.
 *   파일명이 없거나 `.NC2` 가 아니면 절대 추정하지 않는다.
 */
function decodeNC2SwingMeta(u8, 파일명) {
  if (!u8 || !파일명 || !/\.NC2$/i.test(String(파일명))) return null;
  if (u8.length < 0xA9 || !u8[0x80]) return null;
  function s8(v) { return v > 127 ? v - 256 : v; }
  var out = [];
  var p = 0x81;
  for (var d = 0; d < 4; d++) {
    var row = [];
    for (var c = 0; c < 2; c++) {
      var frame = s8(u8[p]);
      row.push({ frame: frame, x1: s8(u8[p + 1]), y1: s8(u8[p + 2]),
                 x2: s8(u8[p + 3]), y2: s8(u8[p + 4]) });
      p += 5;
    }
    out.push(row);
  }
  return out;
}

function parseNC2(u8) {
  var n = spriteFrameCount(u8), i, j, k;
  var offs = [], ok = true;
  for (i = 0; i < n; i++) { var o = 0x80 + i * 4; if (o + 4 > u8.length) { ok = false; break; } offs.push(le32(u8, o)); }
  if (ok) {
    var used = offs.filter(function (x) { return x; }), asc = true;
    for (j = 0; j < used.length - 1; j++) if (!(used[j] < used[j + 1])) asc = false;
    if (used.length && used[used.length - 1] < u8.length && asc) {
      var frA = [], good = true;
      for (k = 0; k < used.length; k++) { var f = hdrAt(u8, used[k]); if (!f) { good = false; break; } frA.push(f); }
      if (good && frA.length === used.length) return { gap: 0, frames: frA };
    }
  }
  var best = { gap: 0, frames: [] }, gaps = [5, 0, 2, 1, 3, 4, 8];
  for (var start = 0x80; start < Math.min(u8.length, 0x80 + 0x200); start++) {
    for (var gi = 0; gi < gaps.length; gi++) {
      var gap = gaps[gi], fr = [], oo = start;
      /* [형식] `.SPR`/`.NC2` 프레임 머리 **12바이트**씩 이어 붙는다 —
   * 폭·높이·앵커x·앵커y·픽셀 오프셋. (`0xF0DAA` 표와 같은 배치) */
  while (fr.length < n) { var f2 = hdrAt(u8, oo); if (!f2) break; fr.push(f2); oo += 12 + f2.size + gap; }
      if (fr.length === n && Math.abs(oo - u8.length) <= gap + 8) return { gap: gap, frames: fr };
      if (fr.length > best.frames.length) best = { gap: gap, frames: fr };
    }
  }
  return best;
}
/** RLE 세그먼트 스트림 → stride 폭 선형 버퍼.
 *  ★ 투명 = **기록 안 된(skip된) 픽셀**. copy된 픽셀은 값 0(검정)이라도 불투명.
 *    Int16 버퍼를 -1 로 초기화해 "미기록(-1)=투명 / 0~255=그린 색"으로 구분한다. */
function decodeRLE(body, h, stride) {
  stride = stride || SCREEN_W;
  var buf = new Int16Array(stride * (h + 4) + stride);
  buf.fill(-1);
  if (body.length < 2) return buf;
  var seg = le16(body, 0), p = 2, pos = 0;
  for (var s = 0; s < seg; s++) {
    if (p + 4 > body.length) break;
    var skip = le16(body, p), dw = body[p + 2], nb = body[p + 3]; p += 4;
    pos += skip; var cnt = dw * 4 + nb;
    if (p + cnt > body.length || pos + cnt > buf.length) break;
    for (var k = 0; k < cnt; k++) buf[pos + k] = body[p + k];    // 값 0 도 그대로 기록(검정)
    p += cnt; pos += cnt;
  }
  return buf;
}
function cropLinear(buf, w, h, stride) {
  stride = stride || SCREEN_W;
  var out = new buf.constructor(w * h);
  for (var y = 0; y < h; y++) out.set(buf.subarray(y * stride, y * stride + w), y * w);
  return out;
}
/**
 * NC2/BCR/… → {kind, frames:[{w,h,ax,ay,fw,fh,idx,tr}]}. idx=인덱스 버퍼, tr=투명색.
 *
 * ★ `fw`·`fh` = **발자국**(그 프레임이 차지하는 칸 수) — `전투데이터_추출.md` §4.5.
 *   적재기 `0x11575` 가 프레임 헤더를 읽는 순서 그대로다.
 *
 *   | 표 | 확장자 | 헤더 | 발자국 |
 *   |---|---|---|---|
 *   | 0 | `.NC2` | 14 (gap 2) | `0x11871`~`0x1188E` 가 **1×1 로 박는다** — 헤더에 없다 |
 *   | 1 | `.BCR` `.MAR` `.WCR` | 17 (gap 5) | **byte[+15] → 표 +0 · byte[+16] → 표 +1** |
 *   | 2 | `.RCR` | 12 (gap 0) | 안 쓴다 (탑승자 겹치기 전용) |
 *
 *   즉 **gap 이 5 일 때만** 헤더에 발자국이 있다. 그래서 `gap` 으로 가른다
 *   (파일명을 안 받아도 되도록). `.NC2` 는 호출부에서 1×1 로 채운다.
 */
/**
 * @param {Uint8Array} u8
 * @param {string} [파일명] 주면 **색인 리맵**(탈것 갑옷 색)이 걸린다.
 *   안 주면 원본 색인 그대로 — 기존 호출부는 바뀌지 않는다.
 */
/**
 * ★★★★★ **EXE 안 raw 비트맵** — `CHP.EXE 0x1D8D5` 형식 (2026-08-22 확정)
 *
 * `0x1D874`(RLE)와 **다른 코덱**이다. 압축이 없다.
 *
 * ```c
 * u16 width;    // +0
 * u16 height;   // +2
 * u8  px[w*h];  // +4   ★ 압축 없음
 * ```
 *
 * 원본이 머리를 **거꾸로** 읽어 헷갈렸다:
 * ```asm
 * 0x1D8EA  mov esi, ebx / add esi, 0x3     ; 끝에서 시작
 * 0x1D8F2  mov bl,[esi] / dec esi / shl bx,8 / mov bl,[esi]
 * 0x1D8FB  mov [ebp-0x4], bx               ; = u16LE(+2) = **높이**
 * 0x1D90D  mov [ebp-0x2], bx               ; = u16LE(+0) = **폭**
 * 0x1D911  add esi, 0x4                    ; ★ 픽셀 = +4
 * ```
 * 곧 **바이트 순서는 그냥 리틀엔디안**이고, 읽는 방향만 거꾸로였다.
 *
 * 원본은 클리핑도 한다 — `0x1D922 cmp bx,0x140`(x+폭 > 320 이면 자른다) ·
 * `0x1D943 cmp ax,0`(x 가 음수면 왼쪽을 버린다) · `0x1D958 cmp edx,0`(y 음수).
 * 캔버스로 옮기면 저절로 잘리므로 여기서는 **크기와 픽셀만** 낸다.
 *
 * 실측: `0x834E9` = **250×76** (아이템 상세 팝업 틀 · `0x2EFB0` 이 (36,59) 에 그린다).
 *
 * @param le `decodeLE` 결과 · @param va 그림 주소 (**fixup 후**)
 * @returns `{w, h, idx}` — `frameToCanvas` 에 바로 넣을 수 있다. 실패하면 null
 */
function decodeExeRaw(le, va) {
  var img = le.image || le.img || le, BASE = (le.base != null) ? le.base : 0x10000;
  var o = va - BASE;
  if (o < 0 || o + 4 > img.length) return null;
  var w = img[o] | (img[o + 1] << 8), h = img[o + 2] | (img[o + 3] << 8);
  if (w <= 0 || h <= 0 || w > 320 || h > 200) return null;
  if (o + 4 + w * h > img.length) return null;
  /* ★★★★★ **투명은 `0xFF` 다** — 원본 `0x1D98F` 직독 (2026-08-21 확정)
   *
   *   ```asm
   *   0x1D98F  mov al, [esi]      ; 픽셀
   *   0x1D991  cmp al, 0xFF
   *   0x1D993  je  0x1D997        ; ★ 0xFF 이면 **건너뛴다** = 투명
   *   0x1D995  mov [edi], al      ; 아니면 그대로 쓴다
   *   ```
   *
   *   ★★★ 한때 **0 을 투명**으로 보고 `[원본 미확인]` 이라 적어 두었는데 **틀렸다**.
   *     그래서 팝업 틀(`0x834E9`)의 0xFF 자리가 **팔레트 255(흰색)** 으로 칠해져
   *     테두리가 지저분한 흰 사각형이 됐다 — 사용자 지적 2026-08-21:
   *     「아이템 팝업창 프레임 렌더링 잘못되었고」
   *     「프레임 모양이 옆으로 튀어나오는 부분이 있어. 우리는 잘린것처럼 그려졌고」
   *   ★ 색 0 은 **불투명 검정**이다 (CLAUDE.md 의 추출 번들 결함과 같은 함정). */
  var idx = new Int16Array(w * h);
  for (var i = 0; i < w * h; i++) {
    var v = img[o + 4 + i];
    idx[i] = (v === 0xFF) ? -1 : v;      /* 0x1D991 cmp al,0xFF / je */
  }
  return { w: w, h: h, ax: 0, ay: 0, idx: idx };
}

/**
 * ★★★★★ **`CSTLDATACITIZEN1/2.SPR`** — 서명 없는 NC2 계열 (2026-08-22 확정)
 *
 * CHP 가 파티 6칸의 **작은 캐릭터 그림**을 여기서 가져온다
 * (`0x2E53E push 0x1CD8` = `".\cstldata\citizen2.spr"`).
 *
 * ## 파일 배치 — `0x2E56A`~`0x2E5AD`
 *
 * ```text
 * 0x00..0x3F   64 B  전부 0
 * 0x40         u16   0x3231 ("12")   ← ★ 실측 확인 (CITIZEN1·2 **둘 다** 0x3231)
 * 0x42         u16   **전체 레코드 수 = 3552**
 * 0x44..0x7F   60 B  건너뛴다 (0x2E5AD call 0x3A27A edx=0x3C)
 * 0x80..EOF    레코드 3552개 **연속** (오프셋 표가 없다)
 * ```
 *
 * ## 레코드
 *
 * ```c
 * u32 blockSize;         // 0x2E5E4 mov eax,[esp] → 0x39D0D 할당 크기
 * u8  block[blockSize];  // 0x2E5F5 mov [esi+8], eax  → 프레임 +8 = **이 블록**
 * u16 tail0..tail3;      // 8 B — ★★★ **배치는 검산됐다 (2026-08-29)**
 *                        //   레코드 3552개를 이 식으로 훑으면 **끝 오프셋이
 *                        //   파일 크기와 정확히 같다**(CITIZEN2 = 0x1DEE96).
 *                        //   값 분포(3552개): tail0 125종(1799×771 · 512×351 · 320×208)
 *                        //   tail1 122종(1799×1004 · 0×255) · tail2 **41종**(6·7·5·1 이 흔하다)
 *                        //   tail3 19종인데 **0 이 3414개** — 거의 안 쓴다.
 *                        //   ☐ 뜻은 아직. tail2 가 작은 수라 **개수·종류** 쪽으로 보인다.
 * ```
 * 다음 레코드 = `현재 + 4 + blockSize + 8` (`0x2E660`~`0x2E685` 가 건너뛰는 식과 같다)
 *
 * ## 블록 머리 (= NC2 프레임 머리와 같다)
 *
 * ```c
 * i16 width; i16 height; i16 anchorX; i16 anchorY;   // +0 +2 +4 +6
 * u8  압축픽셀[];                                     // +8
 * ```
 * 실측 첫 레코드(`0x80`): `blockSize=639` · `24×24` · 앵커 `(−12, −11)`.
 *
 * ★★★ 그리기 쪽 `0x30209 mov ebx,[eax+8]` 이 **블록을 통째로** 넘기는 까닭이
 *   블록 안에 머리가 들어 있기 때문이다. 외부 12 B 구조체의 `+4`/`+6` 은
 *   **앵커가 아니다** (`tail` 이다).
 *
 * ## ★ 스프라이트 번호 → 레코드 번호
 *
 * 로더는 **16개마다 첫 레코드만** 표(`0x9E34E`)에 넣는다 (`0x2E5A1` 의 `shr dx,4`,
 * 3552 / 16 = **222** 그룹). 곧 논리 번호 n 은 **레코드 n×16** 이다.
 *
 * ★ `CITIZEN1.SPR` 도 같은 구조다 (레코드 3552 · 222 그룹). 두 파일은
 *   **3216개가 같고 336개만 다르다** — 다른 포맷이 아니라 **일부 그림만 다른 판본**이다.
 *   CHP 는 `CITIZEN2`, PACK 은 `CITIZEN1` 을 쓴다.
 *
 * @param u8   파일 전체
 * @param 번호 **논리 스프라이트 번호** (내부에서 ×16 한다). 생략하면 전부 훑는다
 * @returns 번호를 주면 프레임 하나, 없으면 `{frames:[…]}`
 */
function decodeCitizen(u8, 번호) {
  if (!u8 || u8.length < 0x84) return null;
  var dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  var 총 = dv.getUint16(0x42, true);                 /* 0x2E58x — 전체 레코드 수 */
  if (!총 || 총 > 100000) return null;
  var 찾 = (번호 == null) ? -1 : ((번호 | 0) * 16);   /* ★ 0x2E5A1 shr dx,4 의 역 */
  if (찾 >= 총) return null;

  function 프레임(pos) {
    var size = dv.getUint32(pos, true);
    var b = pos + 4;
    if (size < 8 || b + size > u8.length) return null;
    var w = dv.getInt16(b, true), h = dv.getInt16(b + 2, true);
    var ax = dv.getInt16(b + 4, true), ay = dv.getInt16(b + 6, true);
    if (w <= 0 || h <= 0 || w > 1024 || h > 1024) return null;
    var body = u8.subarray(b + 8, b + size);
    return { w: w, h: h, ax: ax, ay: ay, idx: cropLinear(decodeRLE(body, h), w, h) };
  }

  var pos = 0x80, i;
  if (찾 >= 0) {
    for (i = 0; i < 찾; i++) {                       /* 0x2E660~0x2E685 건너뛰기 */
      if (pos + 4 > u8.length) return null;
      pos += 4 + dv.getUint32(pos, true) + 8;
    }
    return 프레임(pos);
  }
  var out = [];
  for (i = 0; i < 총; i++) {
    if (pos + 4 > u8.length) break;
    var size = dv.getUint32(pos, true);
    if (i % 16 === 0) out.push(프레임(pos));         /* ★ 16개마다 첫 것만 */
    pos += 4 + size + 8;
  }
  return { frames: out, 총레코드: 총 };
}

function decodeNC2(u8, 파일명) {
  if (!isSprite(u8)) return null;
  var pr = parseNC2(u8), hs = 12 + pr.gap, out = [], hasFoot = (pr.gap === 5);
  for (var i = 0; i < pr.frames.length; i++) {
    var f = pr.frames[i], body = u8.subarray(f.offset + hs, f.offset + hs + f.size);
    var fr = { w: f.w, h: f.h, ax: f.ax, ay: f.ay,
               idx: cropLinear(decodeRLE(body, f.h), f.w, f.h) };                // 투명 = idx<0
    /* ★★★ **그림자 그릴 자리** — 헤더 바이트 12·13 → 프레임 메타 `+7`·`+8`
     *   (`전투데이터_추출.md` §4.5 「12·13 → +7·+8」 · **표 0·1 공통**)
     *
     *   원본 식 (`0x12FE4`~`0x13031` · 그리기 `0x130C0`·`0x130CB`):
     *   ```
     *   본체   x = 화면x + s8[메타+4] + 유닛ox     ; 0x12FBC  (+4 = 앵커 ax)
     *   본체   y = 화면y + s8[메타+5] + 유닛oy     ; 0x12FC8
     *   그림자 x = 화면x + s8[메타+7] + 유닛ox     ; 0x12FF6 → [esp+0x1C]
     *   그림자 y = 화면y + s8[메타+8] + 유닛oy + 12 ; 0x13004 `add edx,0xC`
     *   ```
     *   **본체와 같은 기준점**을 쓰고 오프셋만 다르다 — 발끝을 재서 맞출 필요가 없다. */
    var _s8 = function (v) { return v > 127 ? v - 256 : v; };
    fr.그림자x = _s8(u8[f.offset + 12]);
    fr.그림자y = _s8(u8[f.offset + 13]);
    if (hasFoot) {
      fr.fw = u8[f.offset + 15] | 0; fr.fh = u8[f.offset + 16] | 0;
      /* ★★★ **그림자 색인** — 헤더 바이트 14 → 프레임 메타 `+6` (2026-08-16 확정)
       *
       *   적재기 `0x118A2 lea edx,[eax+6]` 가 표 1·2 일 때만 이 자리를 읽는다
       *   (`0x11869 cmp [esp+0x18],0 ; jne`). `.NC2`(표 0)는 헤더가 14바이트라
       *   그 자리가 아예 없어 **0 으로 남는다.**
       *   그리기: `0x130B3 edx = [edi+3] >> 24` → `×12` → 표 `0xD6658`.
       *
       *   실측 (`SHADOW.SYB` 프레임 번호):
       *     `HORSE1.BCR` 말 → **2**(19×31 세로로 긴 것)
       *     `M-MECHA1/3.BCR` 마장기 → **3**(51×17 넓은 것)
       *     `IMPERIOR.MAR` · `INFTRP.WCR` → **1**(41×13)
       *     `WYV-A.BCR` 비룡 → 프레임마다 다르다 `[1,1,6,1,1,1,0,1]` — 날갯짓 따라
       *     `.NC2` 사람 → **0**(24×16 작은 것) */
      fr.그림자 = u8[f.offset + 14] | 0;
    }
    out.push(fr);
  }
  if (파일명) 색인리맵(out, 파일명);        // 탈것 갑옷 색 (표에 없으면 무시)
  return { kind: 'NC2', gap: pr.gap, frames: out,
           weaponSwing: decodeNC2SwingMeta(u8, 파일명) };
}

/* ★★★ **캐릭터 발밑 그림자 `SHADOW.SYB`** (2026-08-16 확정 · 사용자 「shadow.syb」)
 *
 *   원본 적재 `0x11C0B`: `ecx=7` · `edx=0xD6650`(12 B/항목) · `eax="shadow.syb"`.
 *   7프레임, **색인은 전부 `0`(검정) 하나뿐**, 앵커 모두 `(0,0)`.
 *
 *   ★ **반투명이 아니라 체크무늬 디더링이다.** `(x+y)` 홀짝을 세면 한쪽이 0 —
 *     완전한 1픽셀 격자라 **사이로 바닥이 그대로 비친다.**
 *     `0x5F3FD` 는 `rep movsd` 로 인덱스를 그대로 부으므로 합성이 없다.
 *     그러니 **CSS 알파·`box-shadow`·`filter` 로 흉내 내면 안 된다** — 원본 그림을
 *     그대로 쓴다(사용자 지시).
 *
 *   | # | 크기 | 채움 | 쓰는 곳 |
 *   |---|---|---|---|
 *   | 0 | 24×16 | 14 % | 사람(`.NC2`) |
 *   | 1 | 41×13 | 40 % | 캐리어 `.MAR` · `.WCR` |
 *   | 2 | 19×31 | 40 % | 말 `HORSE*.BCR` |
 *   | 3 | 51×17 | 40 % | 마장기 `M-MECH*.BCR` |
 *   | 4 | 53×29 | 39 % | (아직 쓰는 데 못 봄) |
 *   | 5 | 53×11 | 40 % | 〃 |
 *   | 6 | 27×11 | 41 % | 비룡 `WYV-A` 일부 프레임 |
 */
function decodeShadow(u8) { return decodeSYB ? decodeSYB(u8) : decodeNC2(u8); }
/* ★★★ **NSP 의 RLE stride 는 파일마다 다르다 — 480 또는 320** (2026-08-20)
 *
 *   기존 주석은 「NSP 의 RLE 경로(지금은 `PRO.NSP` 뿐)는 stride 480」이라고
 *   못박아 뒀는데, 그 근거(`0x5F3FD` → `[0x755DA] = 480`)는 **COMBATII.EXE**,
 *   곧 **전투 화면**의 값이다. 챕터 화면(`CHP.EXE`)과 마을(`PACK.EXE`)은
 *   **320 폭**이라 같은 코덱인데도 stride 가 다르다.
 *
 *   사용자 지적(2026-08-20) 「`CSTLDATA__SHADOW` `MAGICSPR__MEGATHUN` 이거 잘못되었고」
 *   「핸드는 게임 실행기에서는 그리고 있어」 → 실측으로 갈렸다:
 *
 *   | 파일 | stride 320 | stride 480 |
 *   |---|---|---|
 *   | `CHAPDATA/HAND.SPR`     | **빈줄 0/13**   ★ | 빈줄 8/13 |
 *   | `CSTLDATA/SHADOW.SPR`   | **빈줄 0/7**    ★ | 빈줄 4/7 |
 *   | `MAGICSPR/MEGATHUN.SPR` | **빈줄 0/1580** ★ | 빈줄 1051/1580 |
 *   | `MAGICSPR/PRO.NSP`      | 빈줄 4952/7384    | **빈줄 208/7384** ★ |
 *
 *   틀린 stride 로 읽으면 줄이 건너뛰어 **빈 줄이 대량으로** 생긴다(스캔라인처럼 끊긴다).
 *   그래서 **둘 다 풀어 보고 빈 줄이 적은 쪽**을 고른다. 차이가 극명해서 안전하다.
 *
 *   ★★★★★ **해소 (2026-08-29)** — 세 EXE 의 화면 stride 를 전부 찾았다.
 *     COMBATII `0x5EB00` 의 주소 계산 꼴
 *     (`add ecx,[x보정]` · `mov edx,[stride]` · `mul` · `add eax,[VGA밑]`)을
 *     바이트로 훑어 같은 자리를 짚었다.
 *
 *     | EXE | 주소 계산 | stride 전역 | 값 |
 *     |---|---|---|---:|
 *     | `COMBATII` | `0x5EB00` | `[0x755DA]` | **480** |
 *     | `CHP`      | `0x36D89` | `[0x8A366]` | **480** |
 *     | `PACK`     | `0x2B926` | `[0x5ECAE]` | **320** |
 *
 *     ★ **`PACK` 만 320 이다.** 곧 마을 그림을 480 으로 읽으면 줄이 어긋난다.
 *     ⇒ 자동 판별을 없애고 **읽는 쪽에 따라 상수로** 넘기는 것이 옳다(할일).
 *       지금은 관측으로 고르는 코드를 그대로 둔다 — 값을 바꾸면 마을·월드 그림이
 *       한꺼번에 달라지므로 **화면으로 확인한 뒤** 바꾼다.
 */
function NSP스트라이드(body, hw, hh) {
  var best = null;
  for (var i = 0; i < NSP_STRIDES.length; i++) {
    var st = NSP_STRIDES[i], buf = decodeRLE(body, hh, st), 빈 = 0;
    for (var y = 0; y < hh; y++) {
      var c = 0;
      for (var x = 0; x < hw; x++) if (buf[y * st + x] >= 0) c++;
      if (c === 0) 빈++;
    }
    if (!best || 빈 < best.빈) best = { st: st, 빈: 빈 };
    if (빈 === 0) break;                 // 더 볼 것 없다
  }
  return best ? best.st : NSP_STRIDE;
}

/* ★★★ **`.SPR` 은 NC2 와 NSP 가 섞여 있다 — 확장자로 못 가른다** (2026-08-20)
 *
 *   사용자 지적 「`CSTLDATA__SHADOW` `MAGICSPR__MEGATHUN` 이거 잘못되었고」에서 출발해
 *   `.SPR` 15개를 전수로 떠 보니 **두 포맷이 섞여** 있었다. `1_시트굽기.js` 와
 *   `fx.js` 는 「`.NSP` 가 아니면 `decodeNC2`」였으므로 NSP 쪽 4개가 전부 깨졌다.
 *
 *   판별은 **구조**로 한다 — 헤더 크기를 가정해 n 프레임을 훑고 **끝이 파일 크기와
 *   딱 맞는 쪽**이 정답이다. 실측(잔여 바이트, 0 이 정답):
 *
 *   | 파일 | 헤더 32(NSP) | 헤더 12(NC2) |
 *   |---|---|---|
 *   | `CHAPDATA/HAND.SPR`     | **0** ★ | 20 |
 *   | `CSTLDATA/SHADOW.SPR`   | **0** ★ | 20 |
 *   | `MAGICSPR/MEGATHUN.SPR` | **0** ★ | 파싱 실패 |
 *   | `MAGICSPR/PROMINAN.SPR` | **0** ★ | 파싱 실패 |
 *   | `CHAPDATA/POINT.SPR` · `FONT.SPR` · `CITIZEN1/2.SPR` · `ITEM.SPR` … (11개) | 파싱 실패 | **0** ★ |
 *
 *   ★ 칠 비율 같은 「그럴듯함」으로 고르지 않는다 — 구조가 딱 떨어지므로 그것만 본다.
 */
function SPR훑기(u8, n, hs) {
  var o = 0x80;
  for (var i = 0; i < n; i++) {
    if (o + hs > u8.length) return -1;
    var size = le32(u8, o), w = le16(u8, o + 4), h = le16(u8, o + 6);
    /* [원본없음] — **깨진 파일을 걸러내는 방어선**이다. 원본에는 이런 검사가 없다
   * (원본은 자기 자료만 읽으니 그럴 필요가 없다).
   * 4096 은 원본 최대 스프라이트(320x200)보다 넉넉히 큰 값으로 잡았다. */
  if (!(w > 0 && w <= 4096 && h > 0 && h <= 4096) || o + hs + size > u8.length) return -1;
    o += hs + size;
  }
  return u8.length - o;
}

/** `.SPR` 을 구조로 갈라 알맞은 디코더로 푼다. 판별이 안 되면 `decodeNC2`(기존 동작). */
function decodeSPR(u8, 파일명) {
  if (!isSprite(u8)) return decodeNC2(u8, 파일명);
  var n = spriteFrameCount(u8);
  if (SPR훑기(u8, n, 32) === 0) return decodeNSP(u8);
  /* [형식] 프레임 머리 **12바이트** — 위와 같은 배치다 */
  if (SPR훑기(u8, n, 12) === 0) return decodeNC2(u8, 파일명);
  return decodeNC2(u8, 파일명);
}

/** NSP(이펙트) → 무압축(투명 0xFF) 또는 RLE(투명 0). */
function decodeNSP(u8) {
  if (!isSprite(u8)) return null;
  var n = spriteFrameCount(u8), o = 0x80, out = [];
  for (var i = 0; i < n; i++) {
    /* [형식] `.BCR`/`.RCR` 레코드 머리 **36바이트** */
    if (o + 36 > u8.length) break;
    var size = le32(u8, o), hw = le16(u8, o + 4), hh = le16(u8, o + 6), ax = ls16(u8, o + 12), ay = ls16(u8, o + 14);
    var body = u8.subarray(o + 32, o + 32 + size); o += 32 + size;
    if (body.length < 4) continue;
    var w = le16(body, 0), h = le16(body, 2);
    if (w === hw && h === hh && w * h === size - 4) out.push({ w: w, h: h, ax: ax, ay: ay, idx: body.subarray(4), tr: 0xFF });
    /* ★★★ **`tr = 0xFF` 는 원본 확정이다** (2026-08-18 · 사용자 지적으로 재확인)
     *
     *   사용자: 「그림자처럼 다 검정으로 보이지만 **실제 검정이 아니었던 것처럼**
     *   이펙트 파일들 특히 잘 살펴봐야 해」 — 팔레트 리맵 마커일 가능성을 의심했다.
     *   **아니었다.** 원시 blitter **전 계열**이 `cmp dl,0xFF ; je` 로 **건너뛴다**:
     *     `0x5EE51`(클립없음·97회) `0x5EFB9`(클립·42회) `0x5F29D`(리맵·18회)
     *     `0x5F305`(리맵+클립) **`0x5F570`(확대)** **`0x5F611`(축소)** `0x5F6AA` `0x5F74F`
     *
     *   ★ **리맵보다 먼저 잘린다** — `0x5F2D2` 에서 255 면 `0x5F2F3` 으로 뛰어
     *     리맵표(`0x12764C`) 조회 자체를 건너뛴다. 그림자 기법과는 다른 길이다.
     *   ★ 방증 — `.NSP` 110개 무압축 프레임의 **65.8 %** 가 255 다
     *     (`ICER` f41 은 100 %). 불투명이라면 화면이 회색판으로 덮인다.
     *   ★ 헤더에 투명 색인 필드는 **없다** — 프레임 헤더 32B 를 1,838개 전수로 떠 보니
     *     `+8~+11`·`+16~+31` 이 전부 0. `0xFF` 는 코드에 박힌 상수다. */
    /* ★★★ NSP 의 RLE 경로(지금은 `PRO.NSP` 뿐)는 **stride 480** 이다 — 320 이 아니다.
     *   근거: 그리기 `0x5F3FD` → 화면 주소 `0x5EB00` 이
     *     `주소 = [0x755D0](0xA0000 VGA) + y × [0x755DA] + x + [0x755D6]`
     *   인데 **`[0x755DA] = 480`** 이다(직독 2026-08-15).
     *   320 으로 읽으면 `PRO` `68×198` 이 **3줄 중 1줄만** 채워져 스캔라인처럼 끊긴다
     *   (사용자 지적 「연속되어야 하는데 스캔라인마냥 끊어져 있잖아」).
     *   480 으로 읽으면 **빈 줄 0/198** 로 딱 맞고, 누적 위치 94,628 ÷ 480 ≈ 198 도 맞다.
     *   ※ NC2(캐릭터)는 `CHP.EXE 0x1D874` 코덱이고 320 으로 잘 나오므로 **안 건드린다.** */
    else if (hw > 0 && hw <= 640 && hh > 0 && hh <= 480) {
      var _st = NSP스트라이드(body, hw, hh);
      out.push({ w: hw, h: hh, ax: ax, ay: ay, idx: cropLinear(decodeRLE(body, hh, _st), hw, hh, _st), stride: _st });  // RLE: 투명=idx<0
    }
  }
  return { kind: 'NSP', frames: out };
}
/** SYB/SYF (포트레이트·UI·날씨) — NC2와 같은 코덱(12B 헤더 + RLE, 투명 0).
 *  PORTRAIT.SYF·MENUSTAT.SYB 는 오프셋표(Layout A), WEATHER.SYB 는 순차(Layout B).
 *  decodeNC2 가 두 배치를 모두 처리하므로 그대로 위임한다. */
/* ★★★ **`.SYB` 는 프레임마다 압축/무압축이 다르다** (2026-08-20 전수 확인)
 *
 *   `전투UI_사양.md §3` 이 「`TIME_GRA.SYB` 만 본문이 압축이 아니다
 *   (`size == w*h+4`, 앞 4바이트 = w,h, 투명색 `0xFF`)」라고 **이미 적어 뒀는데**,
 *   `decodeSYB` 가 `decodeNC2`(= 항상 RLE)를 그대로 부르고 있어 반영이 안 됐다.
 *
 *   그래서 우상단 구체(행동력 구슬 · 시계)가 이렇게 구워졌다 —
 *   사용자 지적 「내부 UI 관련된 게 추출 안 되었어. 대표적인 게 TP 구체」:
 *       프레임 0~4 (구슬 틀 · 시계 바탕)   칠 **6~7 %** 만
 *       프레임 5~12 (시간대 하늘 8종)      칠 **0 = 완전히 빔**
 *
 *   전수 조사 결과 무압축 프레임이 있는 파일은 **둘뿐**이다:
 *       `TIME_GRA.SYB` / `.SYF`   13/13 **전부**
 *       `BATTLE.SYB`              133 중 **2**
 *   나머지 12개(`MENUSTAT` `WEATHER` `FRAME` `SHADOW` …)는 전부 압축이라 멀쩡했다.
 *
 *   ★ 판별은 **크기와 본문 머리를 둘 다** 본다 — 크기만 보면 우연히 맞을 수 있다:
 *       body.length === w*h + 4   그리고   body[0..3] === (u16 w, u16 h)
 *   원본은 이 프레임들을 `0x5EE51` 로 그리고 `0x10031`(320→480 행 보정)을 안 건다.
 */
function SYB무압축인가(body, w, h) {
  return body.length === w * h + 4 &&
         body[0] === (w & 0xFF) && body[1] === ((w >> 8) & 0xFF) &&
         body[2] === (h & 0xFF) && body[3] === ((h >> 8) & 0xFF);
}

function SYB무압축풀기(body, w, h) {
  var n = w * h, idx = new Int16Array(n);
  for (var i = 0; i < n; i++) {
    var v = body[4 + i];
    idx[i] = (v === 0xFF) ? -1 : v;       // ★ 투명색은 0xFF (RLE 계열의 idx<0 규약에 맞춘다)
  }
  return idx;
}

function decodeSYB(u8, 파일명) {
  if (!isSprite(u8)) return null;
  var pr = parseNC2(u8), hs = 12 + pr.gap, out = [], hasFoot = (pr.gap === 5);
  var _s8 = function (v) { return v > 127 ? v - 256 : v; };
  for (var i = 0; i < pr.frames.length; i++) {
    var f = pr.frames[i], body = u8.subarray(f.offset + hs, f.offset + hs + f.size);
    var fr = { w: f.w, h: f.h, ax: f.ax, ay: f.ay,
               idx: SYB무압축인가(body, f.w, f.h)
                    ? SYB무압축풀기(body, f.w, f.h)
                    : cropLinear(decodeRLE(body, f.h), f.w, f.h) };
    fr.그림자x = _s8(u8[f.offset + 12]);
    fr.그림자y = _s8(u8[f.offset + 13]);
    if (hasFoot) {
      fr.fw = u8[f.offset + 15] | 0; fr.fh = u8[f.offset + 16] | 0;
      fr.그림자 = u8[f.offset + 14] | 0;
    }
    out.push(fr);
  }
  if (파일명) 색인리맵(out, 파일명);
  return { kind: 'NC2', gap: pr.gap, frames: out };
}
/* 정본 400 — frameToImageData 표 칠하기 도우미 */
var 리틀엔디언 = (function () { try { return new Uint8Array(new Uint32Array([1]).buffer)[0] === 1; } catch (e) { return false; } })();
function 옛한점(palette, c) {   /* 표 밖 색(256 이상) — 옛 고리처럼 팔레트 칸을 그대로 쓴다(없으면 0) · 알파 255 */
  var b = new Uint8ClampedArray(4); b[0] = palette[c * 3]; b[1] = palette[c * 3 + 1]; b[2] = palette[c * 3 + 2]; b[3] = 255;
  return new Uint32Array(b.buffer)[0];
}
/** 프레임(idx+tr) + 팔레트(768) → ImageData. */
function frameToImageData(ctx, fr, palette) {
  var im = ctx.createImageData(fr.w, fr.h), d = im.data, idx = fr.idx, tr = fr.tr, N = fr.w * fr.h;
  var useVal = (tr != null);           // NSP 무압축은 값(0xFF) 투명, RLE 계열은 idx<0 투명
  /* ★ `tr` 이 **배열**이면 그 값들이 전부 투명이다 (2026-09-10)
   *   BARRIER.NSP 처럼 색 0 도 화면에 안 나오는 그림을 시험하려고 열어 두었다. */
  var trA = Array.isArray(tr) ? tr : null;
  /* ★ 정본 400 — 색 256개를 4바이트 한 덩어리 표로 먼저 만들고 화소마다 한 번만 쓴다 (결과는 아래 옛 고리와 같다)
   *   ☠ 날씨가 바뀌는 1.2초 동안 걸음마다 맵 줄 덮개·사물 조각을 이것으로 다시 칠해 2D 한 걸음 43ms(PC)였다 — 이 함수가 그 70%
   *   표는 ImageData 와 같은 Uint8ClampedArray 에 써서 만든다(소수·범위 밖 값 자르기가 같다) · 리틀 엔디언에서만 · 끄기 G2Native.__표칠끔 */
  if (!(G2Native && G2Native.__표칠끔) && 리틀엔디언 && d.buffer && (d.byteOffset & 3) === 0) {
    var 표바 = new Uint8ClampedArray(1024), 표 = new Uint32Array(표바.buffer), d32 = new Uint32Array(d.buffer, d.byteOffset, N);
    for (var k = 0; k < 256; k++) { 표바[k * 4] = palette[k * 3]; 표바[k * 4 + 1] = palette[k * 3 + 1]; 표바[k * 4 + 2] = palette[k * 3 + 2]; 표바[k * 4 + 3] = 255; }
    if (trA) { for (var q = 0; q < trA.length; q++) if (trA[q] >= 0 && trA[q] < 256) 표[trA[q]] = 0; }
    else if (useVal && tr >= 0 && tr < 256) 표[tr] = 0;
    var 음투명 = !trA && !useVal;                 /* RLE 계열 — 음수는 늘 투명 */
    for (var j = 0; j < N; j++) {
      var cj = idx[j];
      if (cj >= 0 && cj < 256) d32[j] = 표[cj];
      else if (음투명 && cj < 0) d32[j] = 0;
      else d32[j] = (trA ? trA.indexOf(cj) >= 0 : (useVal ? cj === tr : cj < 0)) ? 0 : 옛한점(palette, cj);
    }
    return im;
  }
  for (var i = 0; i < N; i++) {
    var c = idx[i];
    if (trA ? (trA.indexOf(c) >= 0) : (useVal ? (c === tr) : (c < 0))) { d[i * 4 + 3] = 0; continue; }
    d[i * 4] = palette[c * 3]; d[i * 4 + 1] = palette[c * 3 + 1]; d[i * 4 + 2] = palette[c * 3 + 2]; d[i * 4 + 3] = 255;
  }
  return im;
}

/* ── 8. 맵 MAP — 지면(레이어A) / 오브젝트(레이어B) 분리 ────────────────
 *   COMBATII.EXE 0x105AD. 타일·격자 24×16.
 *     레이어A = 바닥 타일(1-based)      → 눕는 지면
 *     레이어B = 오브젝트 블록(1-based)  → 캐릭터처럼 세우는 빌보드(아래끝 정렬)
 *     레이어C = 지형/높이/통행
 *   블록 본문은 NC2와 같은 RLE(폭 24, 높이 = 헤더 tag). 2.5D 분류는 tag(높이)로.
 *   0~103 색은 항상 전역 GENESIS.PAL, 104~ 는 맵이 들고 있는 값. */
/* ── `.FPM` — 맵 뒤에 까는 **고정 배경** ────────────────────────────────
 *
 * 사용자 지적 2026-08-16: 「1-1 맵 상단쪽은 원작에 **fpm 파일을 검정색 뒷쪽에**
 * 깔게 되어있는 것 같아」. 모딩툴 표에도 26개가 전부 **「고정 배경」**으로 있다.
 *
 * ── 형식 (2026-08-16 확정) ──────────────────────────────────────────────
 *   `0x00` ~ `0x3B`      **60바이트 머리** — 모든 파일이 전부 `00` 이다
 *   `0x3C` ~ (끝−768)    **PCX RLE** 로 압축된 8비트 인덱스
 *   끝 **768바이트**      팔레트 (0~252 = VGA 0~63 을 ×4 한 값)
 *
 *   RLE 는 PCX 와 같다 — 바이트가 `0xC0` 이상이면 **개수 = `v & 0x3F`** 이고
 *   다음 바이트가 값, 아니면 그 자체가 값 하나.
 *
 *   풀면 **정확히 192,000 픽셀** 이 나온다(26개 전부 같다) = **480 × 400**.
 *   `320×200` · `640×300` 으로 그리면 줄이 어긋나고, `480` 에서 산맥·하늘이
 *   딱 맞는다(화면 실측).
 *
 *   파일은 `SCENARIO\` + 맵이름 + `.fpm` — **확장자가 소문자**다
 *   (`COMBATII.EXE 0x65A99` 에 `SCENARIO\` 와 `fpm` 이 따로 놓여 있다).
 *
 * ★★★ **원본 설치본에는 `.FPM` 이 하나뿐이다** (2026-08-22 · 브라우저 회귀에서 확인)
 *
 *   `01_원본게임/창세기전2/Genesis2/SCENARIO/` 296개 =
 *   `.SCE` 294 + **`ODS3.FPM` 하나** + `.MAP` 하나.
 *
 *   => 대부분의 맵은 고정 배경이 **없다.** `1-9`(맵 `YOU01`)를 열면
 *     `/원본/SCENARIO/YOU01.FPM` 이 **404** 인데 그것이 **정상**이다.
 *     모딩툴 표의 「26개」는 그 표의 이야기이고 설치본과 다르다.
 *
 *   ★ 그래서 브라우저 회귀(`단계8_브라우저회귀.js`)는 **자산 404 를 따로 센다** —
 *     조건 8(권위 중복)과 섞으면 엉뚱한 실패가 된다.
 * ==================================================================== */
var FPM_HDR = 60, FPM_W = 480, FPM_H = 400, FPM_PAL = 768;

/**
 * ★★★ `.RPL` — **팔레트 애니메이션 표** (`03_분석/공통/RPL_팔레트애니메이션.md`)
 *
 * `MAGICSPR/` 에 넷뿐인 작은 파일이다(43~49 B).
 * ```
 * +0   u16   시작 인덱스 (전부 240)
 * +2   u16   끝 인덱스   (255 또는 253)
 * +4   …     색 목록 — 한 색이 RGB 3바이트 (VGA 6비트, 0~63)
 * ```
 * `색 수 = 끝 − 시작` 이고 본문 길이와 정확히 맞는다
 * (`49 − 4 = 45 = 15 × 3` · `43 − 4 = 39 = 13 × 3`).
 *
 * **왜 240~255인가** — `GENESIS.PAL` 의 240~253 이 전부 `(0,0,0)` 으로 비어 있다.
 * 거기가 **이펙트 전용 색 구간**이고 RPL 이 매 프레임 색을 한 칸씩 밀어 넣는다.
 * 실측으로 뒷받침된다 — `BARRIER.NSP` 는 색 `0 · 60 · 240~255` 만 쓰고,
 * 그중 240~255 가 그림의 거의 전부다(255 가 784 px = 별 몸통).
 *
 * 원본 창구: `0x20021` 로더 · `0x601E5(시작 인덱스)` 시작 ·
 * `0x602E3` 한 단계 · `0x602BF` 종료(되돌림).
 *
 * @param {Uint8Array} u8
 * @returns `{start, end, colors}` — `colors` 는 `[r,g,b]`(0~63) 배열. 실패하면 null
 */
function decodeRPL(u8) {
  if (!u8 || u8.length < 8) return null;
  var s = u8[0] | (u8[1] << 8), e = u8[2] | (u8[3] << 8);
  if (e <= s || s > 255 || e > 256) return null;
  var n = e - s;
  if (4 + n * 3 > u8.length) return null;
  var cols = [];
  for (var i = 0; i < n; i++) cols.push([u8[4 + i * 3], u8[4 + i * 3 + 1], u8[4 + i * 3 + 2]]);
  return { start: s, end: e, colors: cols };
}

/**
 * RPL 을 `단계` 만큼 **돌린 팔레트**를 만든다 (원본 `0x602E3` 한 단계).
 *
 * 원본은 `[시작 … 끝]` 구간에 색 목록을 넣고 **한 칸씩 민다**. 그래서
 * `단계` 가 색 수만큼 돌면 처음으로 돌아온다 — 「색이 왕복한다」는 문서의 관찰과 맞는다.
 *
 * @param {Uint8Array|Array} pal   원본 팔레트(768바이트, 0~63)
 * @param {object} rpl             `decodeRPL` 결과
 * @param {number} 단계
 * @returns 새 팔레트(원본은 건드리지 않는다)
 */
function rplPalette(pal, rpl, 단계) {
  if (!pal || !rpl || !rpl.colors.length) return pal;
  var out = (pal.slice ? pal.slice(0) : Array.prototype.slice.call(pal));
  /* ★★★ **비트 폭을 맞춘다** (2026-08-25 화면 확인에서 잡았다).
   *   `.RPL` 의 색은 VGA **6비트(0~63)** 인데 `R._palette` 는 `decodePalette` 가
   *   이미 **8비트(0~255)** 로 올려 둔 것이다(`(v << 2) | (v >> 4)`).
   *   그대로 넣으면 `(32,52,55)` 청록이 **거의 검정**이 되어 마법진이 까맣게 나온다 —
   *   BARRIER 를 화면에서 돌려 보고서야 잡았다. */
  var 최대 = 0, k2;
  for (k2 = 0; k2 < out.length; k2++) if (out[k2] > 최대) { 최대 = out[k2]; if (최대 > 63) break; }
  var 올림 = 최대 > 63;
  function 맞춤(v) { v = v & 0x3F; return 올림 ? (((v << 2) | (v >> 4)) & 0xFF) : v; }
  var n = rpl.colors.length, k = ((단계 | 0) % n + n) % n;
  for (var i = 0; i < n; i++) {
    var c = rpl.colors[(i + k) % n], p = (rpl.start + i) * 3;
    out[p] = 맞춤(c[0]); out[p + 1] = 맞춤(c[1]); out[p + 2] = 맞춤(c[2]);
  }
  return out;
}

function decodeFPM(u8) {
  if (!u8 || u8.length < FPM_HDR + FPM_PAL) return null;
  var 팔 = u8.subarray(u8.length - FPM_PAL);
  var body = u8.subarray(FPM_HDR, u8.length - FPM_PAL);
  var N = FPM_W * FPM_H;
  var idx = new Uint8Array(N);
  var o = 0, i = 0;
  while (i < body.length && o < N) {
    var v = body[i++];
    if (v >= 0xC0) {                       // 반복 — 개수는 하위 6비트
      var c = v & 0x3F, d = body[i++];
      while (c-- > 0 && o < N) idx[o++] = d;
    } else idx[o++] = v;                   // 그대로 한 픽셀
  }
  /* 팔레트는 0~252 (VGA 0~63 × 4) — 화면 0~255 로 늘린다.
   * `decodePalette` 와 같은 식: 상위 6비트를 쓰고 하위를 채운다. */
  var pal = new Uint8Array(FPM_PAL);
  for (var k = 0; k < FPM_PAL; k++) { var t = 팔[k] >> 2; pal[k] = (t << 2) | (t >> 4); }
  return { w: FPM_W, h: FPM_H, idx: idx, palette: pal, tr: null, 채운픽셀: o };
}

/* `.MAP` 형식 — 타일 한 칸 **24 x 16 = 384바이트**(`MAP_COL`).
 * 원본 `.MAP` 로더 `0x2163E` 가 `ebx = 0x180`(384) 으로 한 칸을 읽는다.
 * 머리 6바이트(`MAP_HDR`) · 블록 메타 20바이트(`MAP_BMETA`).
 * ☐ 머리 6 과 메타 20 은 아직 EXE 주소를 못 달았다 — 형식을 읽어 맞춘 값이다. */
var MAP_HDR = 6, MAP_COL = 384, MAP_BMETA = 20, TILE_W = 24, TILE_H = 16;
/* ══════════════ 블록 그림 열쇠(blockKey) ══════════════════════════════
 *
 * 맵 오브젝트(레이어B 블록)를 **그림 자체로** 식별하는 12자 열쇠다.
 * 블록 **번호는 맵마다 뜻이 다르므로**(FR02 의 0 과 FR08 의 0 은 다른 그림)
 * 「이 오브젝트는 눕힌다」를 여러 맵에 걸쳐 적으려면 그림으로 묶어야 한다.
 *
 *   실측 2026-08-24 — 맵 231개 · 블록 16694개 → **고유 그림 5759개**.
 *   41.5 % 가 두 맵 이상에서 쓰인다. 예: FR02 의 지면 경계 블록 0 은
 *   FR02·FR03·FR06·FR07·FR09·FR10·SEAL02 **7개 맵**에 같이 있다.
 *
 * ★ **팔레트 색까지 넣어 해싱한다** — 같은 인덱스라도 맵 팔레트가 다르면
 *   다른 그림이다. 투명 픽셀은 (255,0,255) 로 표시해 구멍 모양도 반영한다.
 * ★ FNV-1a 32bit 두 벌(정방향·역방향)로 48bit 를 만든다. 5759개에서 충돌은
 *   사실상 없다. **node 도구와 브라우저가 같은 값을 내야 하므로 여기 한 벌만 둔다.**
 * ══════════════════════════════════════════════════════════════════ */
function blockKey(map, bi) {
  if (!map || !map.blocks || !map.blocks[bi] || !map.decodeBlock) return null;
  if (!map._키캐시) map._키캐시 = {};
  if (map._키캐시[bi] !== undefined) return map._키캐시[bi];
  var fr = map.decodeBlock(bi);
  if (!fr) { map._키캐시[bi] = null; return null; }
  /* 2026-10-14 — 날씨 전투는 render.js 가 map.palette 를 날씨 색으로 바꾼다 → 열쇠가 달라져 손 지정(블록분류)을 못 찾고
   *   기본 «세움»이 됐다(2-6 R01 바위 · 사장님 「내가 손으로 지정한것만 일단 세운다고 … r01이야」). 열쇠는 날씨 전 바탕 팔레트로 */
  var h1 = 0x811C9DC5, h2 = 0x01000193, pal = map._날씨바탕팔레트 || map.palette, i, v, r, g, b;
  h1 = Math.imul((h1 ^ fr.w) >>> 0, 16777619) >>> 0;
  h1 = Math.imul((h1 ^ fr.h) >>> 0, 16777619) >>> 0;
  for (i = 0; i < fr.idx.length; i++) {
    v = fr.idx[i];
    if (v < 0) { r = 255; g = 0; b = 255; }            /* 투명 */
    else { r = pal[v * 3]; g = pal[v * 3 + 1]; b = pal[v * 3 + 2]; }
    h1 = Math.imul((h1 ^ r) >>> 0, 16777619) >>> 0;
    h1 = Math.imul((h1 ^ g) >>> 0, 16777619) >>> 0;
    h1 = Math.imul((h1 ^ b) >>> 0, 16777619) >>> 0;
    h2 = Math.imul((h2 ^ b) >>> 0, 2166136261) >>> 0;
    h2 = Math.imul((h2 ^ g) >>> 0, 2166136261) >>> 0;
    h2 = Math.imul((h2 ^ r) >>> 0, 2166136261) >>> 0;
  }
  var k = ("00000000" + h1.toString(16)).slice(-8) +
          ("0000" + (h2 >>> 16).toString(16)).slice(-4);
  map._키캐시[bi] = k;
  return k;
}

/**
 * ★★★★★ `.MAP` **꼬리** — 배경 그림 이름(16B) + 기준칸 `S`(2B) (2026-08-28)
 *
 *   근거 `COMBATII 0x108CC`~`0x1091B` — 전부 **같은 `.MAP` 핸들**에서 이어 읽는다.
 *   ```asm
 *   0x108CC  ebx = 0x10 ; call 0x619E2        ; ★ 이름 **16바이트**
 *   0x108E6  cmp bh, 0x2E                     ;   '.' 에서 자른다
 *   0x108EE  edx = 0x5AA3(".fpm")             ;   붙인다
 *   0x10900  edx = 0x1B3E8 ; call 0x10500     ;   .FPM 을 배경 버퍼로
 *   0x10913  edx = 0x4A836 ; call 0x619E2     ; ★ **2바이트 = S**  (ebx 는 2 그대로)
 *   0x10922  없으면 [0x4A836] = 0xFFFF (−1)
 *   ```
 *   `0x619E2` 는 `mov ah,0x3F / int 21h`(DOS 읽기)다.
 *
 *   ★★★ 이것이 오래 막혔던 **「`SKY07~09` 는 무슨 배경을 까나」**도 푼다 —
 *   맵이 **다른 그림을 가리키고 있었다**: `SKY07 → SKY02` · `SKY08 → SKY04` ·
 *   `SKY09 → SKY06` · `M07 → M06` · `ODS03_1 → ODS3-1`.
 *   배경이 있는 맵 **28개 전부** 실제 `.FPM` 이 있다(빠짐 0).
 *   표를 뽑는 도구: `04_도구/MAP_배경기준줄.js`
 *
 *   ★ 배경이 **없는** 맵은 그 자리에 다른 자료가 있어 읽으면 안 된다
 *     (`0x108C6 cmp eax,1 / je 0x10922`). 그래서 `이름.PCX` 꼴일 때만 인정한다.
 *
 *   @returns {{이름:string, S:number}|null}  `S` = 배경이 1/4 로 흐르는 **기준 칸 y**
 */
function mapBackdropTail(u8) {
  if (!u8 || u8.length < 18) return null;
  var 원 = '', i;
  for (i = u8.length - 18; i < u8.length - 2; i++) 원 += String.fromCharCode(u8[i]);
  var 이름 = 원.replace(/\u0000[\s\S]*$/, '');
  if (!/^[A-Za-z0-9_-]{1,12}\.PCX$/.test(이름)) return null;
  for (i = 이름.length; i < 16; i++) if (원.charCodeAt(i) !== 0) return null;
  var S = u8[u8.length - 2] | (u8[u8.length - 1] << 8);
  if (S & 0x8000) S -= 0x10000;
  if (S < 0 || S > 400) return null;                 /* 배경은 400줄이다 */
  return { 이름: 이름.replace(/\.PCX$/i, ''), S: S };
}

/**
 * ★★★★★ `.MAP` **지형효과 프레임 표** — 니블 11칸 (2026-08-30 · 지적 A-1)
 *
 *   근거 `COMBATII 0x1089B`~`0x108BE` — 같은 `.MAP` 핸들에서 **한 바이트씩 11번**
 *   읽어 `0x10420` 에 넘긴다. 그 값이 **`MAP_EFFC.SYB` 의 프레임 시작 번호**다.
 *   ```asm
 *   0x108A6  call 0x619E2      ; .MAP 에서 1 바이트
 *   0x108AD  eax = cx          ; 니블 번호 0..10
 *   0x108B0  dl  = 그 바이트
 *   0x108BA  cmp cx, 0xB       ; ★ 11 번
 *   ---
 *   0x1042A  cmp dx, 0x1C      ; 28
 *   0x10430  xor esi, edx      ; ★ 28 초과면 0
 *   0x10452  그 번호까지 프레임을 건너뛰고 **2 장**을 심는다
 *   ```
 *
 * ★ 자리는 **EOF 검사**로 갈린다 — `0x108C0 call 0x61C5B / cmp eax,1 / je`
 *   표를 읽은 직후가 **파일 끝**이면 배경 꼬리(이름 16 B + S 2 B)가 **없다**.
 *     배경 있음 → `길이 − 29 … 길이 − 18`
 *     배경 없음 → **파일 끝 11 바이트**
 *   실측: `SCENARIO/SKY04.MAP`(배경 O) `[0,4,8,0,4,0,0,0,0,0,0]` ·
 *         `CSTLDATA/AINAA.MAP`(배경 X) `[0,0,0,0,0,0,4,8,0,0,0]`
 *
 * ☠ 전에는 `니블 × 2` 로 **지어냈다** — 사용자가 본 「눈밭 이펙트가
 *   엉묵하다」는 그것이다(지적 A-1).
 * @returns {number[]|null} 11칸 (못 읽으면 null)
 */
function mapEffectFrames(u8) {
  if (!u8 || u8.length < 11) return null;
  var 배경 = mapBackdropTail(u8);
  var 끝 = 배경 ? (u8.length - 18) : u8.length;      /* 0x108C7 */
  var s = 끝 - 11;
  if (s < 0) return null;
  var t = [];
  for (var i = 0; i < 11; i++) {
    var v = u8[s + i] | 0;
    t.push(v > 0x1C ? 0 : v);                       /* 0x1042A · 0x10430 */
  }
  return t;
}

function decodeMAP(u8, basePalette) {
  var w = le16(u8, 0), p = MAP_HDR;
  var colsOff = p; p += w * MAP_COL;
  var n = le16(u8, p); p += 2;
  var blocks = [];
  for (var i = 0; i < n; i++) {
    var size = le32(u8, p); p += 4; p += 2; var tag = le16(u8, p); p += 2;
    blocks.push({ offset: p, size: size, tag: tag }); p += size;
  }
  var W = le16(u8, p), H = le16(u8, p + 2); p += 4;
  var cells = W * H, layerA = new Uint16Array(cells), layerB = new Uint16Array(cells), a;
  for (a = 0; a < cells; a++) layerA[a] = le16(u8, p + a * 2); p += cells * 2;
  for (a = 0; a < cells; a++) layerB[a] = le16(u8, p + a * 2); p += cells * 2;
  var layerCOff = p;                       /* ★ 레이어C 가 시작하는 «파일 자리» (2026-09-16) */
  var layerC = u8.subarray(p, p + cells); p += cells;
  /* 팔레트 768B 는 **레이어C 바로 뒤**에 있습니다 (parse 의 0x138+0x1c8 = 768 = 이 팔레트).
   * 이후 열메타(w×20)·블록메타(n×20) 가 이어지지만 렌더에는 안 씁니다. */
  var palette = new Uint8Array(768), v;
  for (i = 0; i < 768; i++) { v = u8[p + i] & 0x3F; palette[i] = (v << 2) | (v >> 4); }
  if (basePalette) palette.set(basePalette.subarray(0, 312), 0);   // 0~103색 = GENESIS.PAL
  p += 768;
  /* 애니메이션 프레임표 — 타일당/블록당 20B = u16×10, 0xFFFF(-1) 종료.
   * 원본 0x7EBAC(타일)·블록표. 30틱마다 다음 프레임으로 순환(폭포·불꽃 등). */
  function readAnim(base, count) {
    var arr = [];
    for (var k = 0; k < count; k++) {
      var frames = [], mo = base + k * MAP_BMETA;
      for (var f = 0; f < 10; f++) { var val = le16(u8, mo + f * 2); if (val === 0xFFFF) break; frames.push(val); }
      arr.push(frames);   // 길이 ≤1 이면 정지 타일, ≥2 면 애니메이션
    }
    return arr;
  }
  var tileAnim = readAnim(p, w);            // 열메타 — 레이어A 타일 애니
  var blockAnim = readAnim(p + w * MAP_BMETA, n);  // 블록메타 — 레이어B 오브젝트 애니
  function tile(i2) { return u8.subarray(colsOff + i2 * MAP_COL, colsOff + (i2 + 1) * MAP_COL); }
  function decodeBlock(bi) {
    var b = blocks[bi]; if (!b || b.tag <= 0 || b.tag > 512) return null;
    var body = u8.subarray(b.offset, b.offset + b.size);
    return { w: TILE_W, h: b.tag, ax: 0, ay: 0, idx: cropLinear(decodeRLE(body, b.tag), TILE_W, b.tag) };  // 투명 = idx<0
  }
  return { w: w, W: W, H: H, layerA: layerA, layerB: layerB, layerC: layerC,
           blocks: blocks, palette: palette, tile: tile, decodeBlock: decodeBlock,
           tileAnim: tileAnim, blockAnim: blockAnim, 배경: mapBackdropTail(u8),
           /* ★ **파일 안 자리** — 뷰어가 맵을 «제자리로» 고칠 때 쓴다 (2026-09-16).
            *   읽기에는 안 쓰이는 덤이라 기존 동작을 안 건드린다.
            *   `layerA` u16×cells → `layerB` u16×cells → `layerC` u8×cells 차례다. */
           자리: { 레이어A: layerCOff - cells * 4, 레이어B: layerCOff - cells * 2,
                  레이어C: layerCOff, 칸수: cells },
           지형효과프레임: mapEffectFrames(u8) };   /* 0x1089B · 지적 A-1 */
}
/** 레이어A 합성 → 눕는 지면 이미지 {w,h,idx,tr}.
 *  animPhase 를 주면 애니메이션 타일(폭포·물 등)을 그 위상의 프레임으로 교체합니다. */
function mapGround(map, animPhase) {
  var W = map.W, H = map.H, ow = W * TILE_W, oh = H * TILE_H, out = new Uint8Array(ow * oh), x, y, tx, ty;
  animPhase = animPhase | 0;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var ti = map.layerA[y * W + x] - 1; if (ti < 0 || ti >= map.w) continue;
    var an = map.tileAnim && map.tileAnim[ti];         // 애니메이션 프레임표
    if (an && an.length > 1) { var fi = an[animPhase % an.length]; if (fi >= 0 && fi < map.w) ti = fi; }
    var t = map.tile(ti);
    for (ty = 0; ty < TILE_H; ty++) for (tx = 0; tx < TILE_W; tx++) {
      var val = t[ty * TILE_W + tx]; if (val !== 0) out[(y * TILE_H + ty) * ow + x * TILE_W + tx] = val;
    }
  }
  return { w: ow, h: oh, idx: out, tr: 0 };
}
/** 레이어B 오브젝트 목록 → [{x,y,blockIndex,height,frame}]. 캐릭터처럼 빌보드로. */
function mapObjects(map) {
  var W = map.W, H = map.H, out = [], x, y;
  for (y = 0; y < H; y++) for (x = 0; x < W; x++) {
    var bi = map.layerB[y * W + x] - 1; if (bi < 0 || bi >= map.blocks.length) continue;
    var fr = map.decodeBlock(bi); if (!fr) continue;
    out.push({ x: x, y: y, blockIndex: bi, height: map.blocks[bi].tag, frame: fr });
  }
  return out;
}

/* ── 지형/이동 판정 — 원본 맵 layerC + EXE 이동비용표(0x70B0D). 추출 terrain.json 대체 ──
 *   EXE 0x1499C(이동범위계산)이 s8[0x70B0D + 이동타입×0x100 + 값]을 읽는다(값 = layerC 바이트).
 *   FF(-1) = 이동불가. terrain.json 과 18126셀(3021×6타입) 전수 일치 검증 완료. */
var MOVECOST = (function () {
  var b64 = '/wUGBgj/Cv//BwgIBwcICQAFBgYI/wr//wcICAcHCAkABQYGCP8K//8HCAgHBwgJAAUGBgj/Cv//BwgIBwcICQAFBgYI/wr//wcICAcHCAkABQYGCP8K//8HCAgHBwgJAAAAAAAHCv8KCAgICAgICgAAAAAABwr/CggICAgICAoAAAAAAAcK/woICAgICAgKAAAAAAAHCv8KCAgICAgICgAAAAAABwr/CggICAgICAoAAAAAAAcK/woICAgICAgKAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8FBQUF/wX//wUFBQUFBQUABQUFBf8F//8FBQUFBQUFAAUFBQX/Bf//BQUFBQUFBQAFBQUF/wX//wUFBQUFBQUABQUFBf8F//8FBQUFBQUFAAUFBQX/Bf//BQUFBQUFBQAAAAAABgb/BgYGBgYGBgYAAAAAAAYG/wYGBgYGBgYGAAAAAAAGBv8GBgYGBgYGBgAAAAAABgb/BgYGBgYGBgYAAAAAAAYG/wYGBgYGBgYGAAAAAAAGBv8GBgYGBgYGBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/BAYH//8I//8GBgYGBgYKAAQGB///CP//BgYGBgYGCgAEBgf//wj//wYGBgYGBgoABAYH//8I//8GBgYGBgYKAAQGB///CP//BgYGBgYGCgAEBgf//wj//wYGBgYGBgoAAAAAAAgI/wgICAgICAgKAAAAAAAICP8ICAgICAgICgAAAAAACAj/CAgICAgICAoAAAAAAAgI/wgICAgICAgKAAAAAAAICP8ICAgICAgICgAAAAAACAj/CAgICAgICAoAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/wQFBv//Bv//BgYGBgYGBgAEBQb//wb//wYGBgYGBgYABAUG//8G//8GBgYGBgYGAAQFBv//Bv//BgYGBgYGBgAEBQb//wb//wYGBgYGBgYABAUG//8G//8GBgYGBgYGAAAAAAAG//8GBgYGBgYGBgAAAAAABv//BgYGBgYGBgYAAAAAAAb//wYGBgYGBgYGAAAAAAAG//8GBgYGBgYGBgAAAAAABv//BgYGBgYGBgYAAAAAAAb//wYGBgYGBgYGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP8GBwcK/wz//wcICAcHCAUABgcHCv8M//8HCAgHBwgFAAYHBwr/DP//BwgIBwcIBQAGBwcK/wz//wcICAcHCAUABgcHCv8M//8HCAgHBwgFAAYHBwr/DP//BwgIBwcIBQAAAAAACQQECggICAgICAYAAAAAAAkEBAoICAgICAgGAAAAAAAJBAQKCAgICAgIBgAAAAAACQQECggICAgICAYAAAAAAAkEBAoICAgICAgGAAAAAAAJBAQKCAgICAgIBgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/BAQEBAQEBAYEBAQEBAQEAAQEBAQEBAQGBAQEBAQEBAAEBAQEBAQEBgQEBAQEBAQABAQEBAQEBAYEBAQEBAQEAAQEBAQEBAQGBAQEBAQEBAAEBAQEBAQEBgQEBAQEBAQAAAAAAAQEBAQEBAQEBAQEAAAAAAAEBAQEBAQEBAQEBAAAAAAABAQEBAQEBAQEBAQAAAAAAAQEBAQEBAQEBAQEAAAAAAAEBAQEBAQEBAQEBAAAAAAABAQEBAQEBAQEBAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
  var bin = atob(b64), a = new Int8Array(bin.length), v;
  for (var i = 0; i < bin.length; i++) { v = bin.charCodeAt(i); a[i] = v < 128 ? v : v - 256; }
  return a;                                   // [이동타입*256 + 값] (signed). -1 = 이동불가
})();
var TERRAIN_NAME = ['이동불가', '황지', '초지', '모래', '자갈', '바위', '늪지', '지형7', '절벽',
                    '지형9', '지형10', '지형11', '지형12', '지형13', '지형14', '해빙지'];
/** 원본 맵 → 이동/지형 데이터 (terrain.json 호환). 칸[y][x] = {값,세트,높이,지형,이름,비용[6]}.
 *  이동판정은 layerC(값)만으로 결정된다(원본 0x1499C). 나무 등 오브젝트 막힘도 지형값에 인코딩. */
function mapTerrain(map) {
  var W = map.W, H = map.H, 칸 = [], x, y, mt;
  for (y = 0; y < H; y++) {
    var row = [];
    for (x = 0; x < W; x++) {
      var val = map.layerC[y * W + x], set = val >= 0x64 ? 1 : 0, v2 = val - (set ? 0x64 : 0);
      var cost = [], pass = false;
      for (mt = 0; mt < 6; mt++) { var c = MOVECOST[mt * 256 + val]; c = c < 0 ? -1 : c; cost.push(c); if (c > 0) pass = true; }
      row.push({ 값: val, 세트: set, 높이: v2 >> 4, 지형: v2 & 0xF,
                 이름: pass ? (TERRAIN_NAME[v2 & 0xF] || ('지형' + (v2 & 0xF))) : '이동불가', 비용: cost });
    }
    칸.push(row);
  }
  return { 폭: W, 높이: H, 타일픽셀: [24, 16],
           이동타입: ['보행', '험지적응', '기마', '마장기', '수중', '비행'], 칸: 칸 };
}


/* ══════════════════════════════════════════════════════════════════════
 * LE 실행파일 · 스프라이트 파일명 표
 * ════════════════════════════════════════════════════════════════════ */

/** DOS/4GW **LE** 실행파일 → 평탄 가상주소 이미지 `{img, base}`. (fixup 미적용) */
function decodeLE(d) {
  var le = le32(d, 0x3c), uu = function (o) { return le32(d, le + o); };
  var pageSize = uu(0x28), lastPage = uu(0x2c), objOff = le + uu(0x40), objCnt = uu(0x44),
      pmapOff = le + uu(0x48), dataOff = uu(0x80), modPages = uu(0x14);
  var objs = [], lo = null, hi = 0, i;
  for (i = 0; i < objCnt; i++) {
    /* [형식] **LE(Linear Executable) 오브젝트 표** — 레코드 24바이트.
     * +0 가상크기 · +4 재배치 base · +12 페이지맵 색인 · +16 페이지 수.
     * 형식 규격이 근거다 (`04_도구/le_fixup.js` 가 같은 표를 읽는다). */
    var b = objOff + i * 24, vsize = le32(d, b), base = le32(d, b + 4),
        pmi = le32(d, b + 12), pcnt = le32(d, b + 16);
    objs.push({ base: base, pmi: pmi, pages: pcnt });
    lo = lo == null ? base : Math.min(lo, base); hi = Math.max(hi, base + vsize);
  }
  var BASE = lo, img = new Uint8Array(hi - lo);
  var 쪽짝 = [];                       /* 이미지↔파일 페이지 짝 — 아래에서 채운다 */
  for (i = 0; i < objs.length; i++) {
    var o = objs[i];
    for (var k = 0; k < o.pages; k++) {
      var pm = pmapOff + (o.pmi - 1 + k) * 4; if (pm + 4 > d.length) continue;
      var pageno = (d[pm] << 16) | (d[pm + 1] << 8) | d[pm + 2]; if (!pageno) continue;
      var src = dataOff + (pageno - 1) * pageSize,
          n = (pageno === modPages) ? (lastPage || pageSize) : pageSize;
      var dst = o.base - BASE + k * pageSize; if (dst < 0 || dst >= img.length) continue;
      img.set(d.subarray(src, src + n), dst);
      /* ★★★ **이미지 → 파일 되짚기** (2026-09-16)
       *   이미지 오프셋으로 **파일의 어느 바이트인지**를 알아야 EXE 를 «제자리»로
       *   고칠 수 있다. 페이지 하나를 옮길 때마다 그 짝을 적어 둔다.
       *   ☠ 없으면 `va − base` 를 파일 오프셋으로 잘못 쓰게 된다 —
       *     CHP.EXE 는 파일 526,751 B 인데 이미지가 1,222,144 B 라 **전혀 다른 자리**다.
       *     (뷰어 `전직보기` 를 만들다 관문이 잡았다) */
      쪽짝.push({ img: dst, file: src, len: n });
    }
  }
  /* ★★★ **fixup(재배치)을 적용한다** (2026-08-16)
   *
   *   페이지만 이어 붙이면 코드·데이터 안의 **주소 상수 자리가 전부 0** 이다.
   *   그래서 「스프라이트 표」처럼 **포인터 배열**을 읽을 수가 없었고, 어쩔 수 없이
   *   문자열을 순서대로 긁어 `번호 − 77` 같은 **눈대중 오프셋**으로 맞춰 왔다.
   *   그 눈대중이 신(神) 구간에서 2 밀려 43-2 가 통째로 어긋났다.
   *
   *   타깃 플래그 비트 (여기를 반대로 알면 파싱이 통째로 깨진다):
   *     0x03 종류(0 내부) · 0x04 가산 있음 · 0x10 타깃 32비트 ·
   *     0x20 가산 32비트 · 0x40 오브젝트 번호 16비트
   *   손으로 푼 첫 레코드 `07 10 95 0e 02 3e a8 04 00`
   *     = 소스 0x0e95 · 오브젝트 2 · 타깃 0x4a83e → `[0x4a83e]`(카메라 Y). 맞다.
   *
   *   자세한 것과 CLI 는 `04_도구/le_fixup.js`. */
  var fpageOff = le + uu(0x68), frecOff = le + uu(0x6C);
  var 자리 = {};
  for (i = 0; i < objs.length; i++) {
    for (var k2 = 0; k2 < objs[i].pages; k2++) 자리[objs[i].pmi + k2] = objs[i].base - BASE + k2 * pageSize;
  }
  for (var pg = 1; pg <= modPages; pg++) {
    var dst0 = 자리[pg]; if (dst0 == null) continue;
    var q = frecOff + le32(d, fpageOff + (pg - 1) * 4), qe = frecOff + le32(d, fpageOff + pg * 4);
    while (q < qe) {
      var srcT = d[q], fl = d[q + 1]; q += 2;
      var 소스 = [];
      if (srcT & 0x20) { var cnt = d[q]; q += 1; for (var c2 = 0; c2 < cnt; c2++) { 소스.push((d[q] | (d[q + 1] << 8)) << 16 >> 16); q += 2; } }
      else { 소스.push((d[q] | (d[q + 1] << 8)) << 16 >> 16); q += 2; }
      var 값 = null, 종 = fl & 3;
      if (종 === 0) {
        var 오브 = (fl & 0x40) ? (d[q] | (d[q + 1] << 8)) : d[q]; q += (fl & 0x40) ? 2 : 1;
        var 타깃 = 0;
        if ((srcT & 0x0F) !== 2) { if (fl & 0x10) { 타깃 = le32(d, q); q += 4; } else { 타깃 = d[q] | (d[q + 1] << 8); q += 2; } }
        var oo = objs[오브 - 1]; if (oo) 값 = oo.base + 타깃;
      } else if (종 === 1) { q += (fl & 0x40) ? 2 : 1; q += (fl & 0x80) ? 1 : ((fl & 0x10) ? 4 : 2); }
      else if (종 === 2) { q += (fl & 0x40) ? 2 : 1; q += (fl & 0x10) ? 4 : 2; }
      else { q += (fl & 0x40) ? 2 : 1; }
      if (fl & 0x04) q += (fl & 0x20) ? 4 : 2;
      if (값 == null || (srcT & 0x0F) !== 7) continue;      // 32비트 오프셋만
      for (var si = 0; si < 소스.length; si++) {
        var at = dst0 + 소스[si]; if (at < 0 || at + 4 > img.length) continue;
        img[at] = 값 & 0xff; img[at + 1] = (값 >>> 8) & 0xff;
        /* [형식] RGBA 네 칸 조립 — `>>> 16`·`>>> 24` 는 자릿수다 */
  img[at + 2] = (값 >>> 16) & 0xff; img[at + 3] = (값 >>> 24) & 0xff;
      }
    }
  }
  /**
   * ★ **이미지 주소 → 파일 오프셋** — EXE 를 «제자리» 로 고칠 때 쓴다.
   *   못 찾으면 `-1` 을 낸다 (BSS 처럼 파일에 없는 자리).
   *   ☠ `va − base` 를 파일 오프셋으로 쓰면 안 된다 — LE 는 페이지 단위로 흩어져 있다.
   */
  function 파일자리(va) {
    var off = (va | 0) - BASE;
    for (var q = 0; q < 쪽짝.length; q++) {
      var z = 쪽짝[q];
      if (off >= z.img && off < z.img + z.len) return z.file + (off - z.img);
    }
    return -1;
  }
  return { img: img, base: BASE, 쪽짝: 쪽짝, 파일자리: 파일자리 };
}

/* ★★★ 스프라이트 번호 → 파일명 — **원본 표 세 개를 그대로 읽는다** (2026-08-16)
 *
 *   `0x11575` 가 `[+0x61]`(스프라이트 번호) 하나로 표 셋 중 하나를 고른다.
 *   각 표는 **널 종료 문자열을 가리키는 32비트 포인터 배열**이다.
 *
 *   | 번호 | 표 | 개수 | 확장자 |
 *   |---|---|---|---|
 *   | `0 ~ 224`   | `0x70024` | 225 | `.NC2` |
 *   | `300 ~ 426` | `0x703A8` | 127 | `.BCR` `.MAR` `.WCR` |
 *   | `500 ~ 575` | `0x705A4` | 76  | `.RCR` |
 *
 *   ★★★ **예전에는 이 표를 못 읽어서 눈대중으로 맞췄다.**
 *     `decodeLE` 가 fixup 을 적용하지 않아 포인터 자리가 전부 0 이었기 때문에,
 *     문자열을 파일 순서대로 긁어 놓고 `번호 − 77` 같은 상수로 끼워 맞췄다.
 *     그런데 표는 **재사용·결번**이 있어서(`312`·`313` 이 `M-MECHA3`·`M-MECHE3` 를
 *     다시 쓴다) 문자열 순서와 번호가 **일정한 차이로 대응하지 않는다.**
 *     신(神) 구간에서 그 차이가 79 로 벌어져 **2 씩 밀렸다** —
 *     43-2 에서 아트레우스 자리에 `ERGYAS`, 라에비우스 자리에 `SHAQBARI` 가
 *     나왔다(사용자 지적 「43-2 god 스프라이트 잘못된 것 같아」).
 *
 *     이제 fixup 을 적용하므로 **표를 그대로 읽는다.** 눈대중 상수는 없앴다.
 *     검증: 표가 `405 ATREIUS · 406 DIENE · 407 ERGYAS · 408 ERLGAMES ·
 *     409 KARATE · 410 LAEBIUS · 411 PRIOS · 412 SHAQBARI · 413 VIDGOSHU` 로,
 *     사용자가 불러 준 이름 순서와 **아홉 개 전부** 맞는다. */
var SPRTBL = [
  { base: 0x70024, n: 225, 첫번호: 0 },
  { base: 0x703A8, n: 127, 첫번호: 300 },
  { base: 0x705A4, n: 76,  첫번호: 500 }
];

/* ★★★ **색인 리맵 — 탈것 갑옷 색 바꾸기** (2026-08-18 · 사용자 요청
 *   「말이랑 비룡 스프라이트에서 갑옷 초록색 부분있는거 변경」 ·
 *    「지금 단계에서 매핑처럼 처리해서 일괄 적용한후 hd 변환 툴로 굽는게 수월」 ·
 *    「생각보다 쓰인 색은 많지 않아서 몇개만 리맵하면 바로 적용 가능할 것 같아서」)
 *
 *   ★ 이것은 **원본과 다르게 가는 것**이다 — `03_분석/리마스터_적용현황.md` ·
 *     자세한 실측은 `03_분석/탈것_갑옷색_리맵.md`.
 *
 *   **왜 색인 단계인가.** HD 굽기(xBRZ→AI)를 지나면 고유색이 285 → 4,926 으로
 *   퍼져서(실측) 색 범위로는 못 잡고 경계가 지저분해진다. 색인일 때 바꾸면
 *   **AI 가 바뀐 색을 보고 그리므로** 명암 램프가 그대로 유지된다.
 *   그래서 실행기와 `04_도구/HD굽기/` 가 **이 표 하나를 공유**한다.
 *
 *   **팔레트는 8단 램프로 정연하다** (0~103 전역 대역, 실측):
 *     `1~7` 무채(파랑빛) · `8~15` **초록빛 회색** · `16~23` 노랑~빨강 ·
 *     `24~31` 파랑 · `32~39` 보라빛 파랑 · `40~47` 파랑 · `48~55` **진초록(풀·나무)** ·
 *     `56~63` 청록 · `72~79` 살~갈색 · `80~87` 분홍~자주 · `88~95` 분홍~적갈 ·
 *     `96~103` 황토
 *
 *   **램프 → 램프로 1:1 로 옮긴다.** 8단을 8단에 대응시키면 계단이 보존된다.
 *   칸 수가 다른 대역으로 옮기면 명암이 뭉개진다.
 *   ★ `104~` 는 **맵이 들고 있어 쓸 수 없다** (`팔레트_104대역_문제.md`).
 *
 *   실측 — 어느 파일이 어느 대역을 쓰는가 (전 프레임 히스토그램):
 *     `HORSE3.BCR` **8~15 를 44.2%** ← 사용자가 말한 초록 마갑
 *     `HORSE1.BCR` 90~95(적갈) · `HORSE2.BCR` 1~7(무채) · `HORSE4.BCR` 5~7+90~93
 *     `WYV-A.BCR`  **40~47 = 파랑** — 사용자는 「초록」이라 했으나 실측은 파랑.
 *                  ★★★★★ **팔레트로 확정 (2026-08-29)** — 40~47 은 **정말 파랑**이다.
 *                  `GENESIS.PAL`(768B · 6비트 → ×4):
 *                    40 (200,240,252) · 41 (156,212,244) · 42 (112,180,236)
 *                    43 (76,144,216) · 44 (52,104,184) · 45 (24,68,148)
 *                    46 (8,40,112) · 47 (4,16,80)   ← 밝은 하늘색 → 짙은 남색
 *                  `WYV-A.BCR` 히스토그램 상위도 45×6720 · 46×6293 · 44×5366 …
 *                  으로 **그 대역**이다. 사용자가 본 것은 다른 파일일 것이다.
 *     `WYV-D.BCR` 과 `DDRAG.BCR` 은 히스토그램이 **완전히 같다** → 디코딩 실패 의심. */
function _램프(from, to, n) { var o = {}; for (var i = 0; i < n; i++) o[from + i] = to + i; return o; }

/* ★★ **실버애로우** (2026-08-18 · 사용자 요청 「실버애로우 색 전체를 바꾸어야해.
 *   **초록계통 갑옷**과 **흰색 엣지**, **파란색 계열 망토**로 바꾸면 좋겠어」)
 *
 *   파일은 넷뿐이다 — `.NC2` 225개에 `SILVER` 가 **없다.** 탑승 그림만 있다:
 *     `RSILVER.RCR`·`RSILVERW.RCR` (말 위 상반신 32장 26×33)
 *     `DSILVER.RCR`·`DSILVERW.RCR` (비룡 위 32장 44×34)
 *   `RSILVER` 는 `.RCR` 목록 **첫 항목 = 스프라이트 번호 500**
 *   (물리 색인은 **352** 다 — 「348」은 표를 못 읽던 시절의 옛 값이다.
 *    2026-08-25 포인터 전수 실측: `.NC2` 0~224 · `.RCR` **352~427**. `SPRTBL` 은 맞다.)
 *   (`전투데이터_추출.md` §691). 다음이 `RSILVERW` · `RDARK`(암흑기사 502).
 *
 *   **부위 실측** (진단 렌더 `HD테스트/갑옷색/실버애로우_진단_확대.png`):
 *   | 대역 | 비중 | 무엇 |
 *   |---|---:|---|
 *   | `1~7` 무채 | **53~58 %** | **망토** — ★ 창·무기·금속도 **같은 대역**이다 |
 *   | `56~63` 청록 | 20 % | **갑옷 본체·어깨** (원본이 이미 청록이다) |
 *   | `40~47` 파랑 | 15 % | 투구 깃털 장식 (`RSILVER`·`DSILVER`) |
 *   | `80~87` 자주 | 21~24 % | 투구 깃털 (`W` 판은 여기가 자주다) |
 *   | `72~79` 살색 | | 얼굴 |
 *
 *   ★★ **`W` 접미는 색 변형이다** — 깃털이 파랑(40~47) ↔ 자주(80~87).
 *
 *   ★★★ **알려진 한계**: 망토를 파랑으로 바꾸면 **창·무기도 파랑이 된다**
 *   (같은 무채 램프를 공유). 색인만으로는 분리할 수 없다 — 나누려면 픽셀 영역
 *   마스크가 필요하다. 사용자가 「색 전체를 바꾸어야해」라 했으므로 일단 그대로 둔다.
 *
 *   ★★★ **적용한 것 — 갑옷만 흰색 계통. 망토는 손대지 않는다** (2026-08-18 정정,
 *   사용자 「**다른거 바뀌면 안돼.** 망토 두고 **옷만 흰색느낌**이 나게 바꿔줘봐.
 *   명암이 있으니 **흰색과 밝은 회색 계통**으로」)
 *
 *   ★ 흰색은 사용자가 「생각보다 흰색 안어울리네」라 해서 **진한 네이비로 바꿨다**
 *     (「망토가 흰색이라 갑옷색을 진한 네이비로 바꾸어야하나」).
 *
 *   ```
 *   갑옷 56~63 → 26,27,28,29,30,31,31,31   (#9e9edb · #7d7dc7 · #5959aa ·
 *                                            #3c3c8e · #202071 · #0c0c59)
 *   ```
 *   **왜 `24~31` 이고 `40~47` 이 아닌가** — 투구 깃털이 이미 `40~47`(하늘파랑)이다.
 *   갑옷을 같은 대역에 넣으면 **깃털과 갑옷이 한 색으로 뭉친다.** `24~31` 은
 *   남보라 쪽이라 깃털과 구분된다 (후보 렌더에서 확인).
 *
 *   어두운 쪽 6칸에 담아 **진하게** 몰았다. 밝기 165 → 21.
 *   **망토·창·금속·비룡 날개(`1~7`)는 원본 그대로 남는다** — 앞서 파랑으로 옮겼다가
 *   창과 날개까지 파랑이 되는 부작용이 있었다(§3-3). 그 리맵은 되돌렸다.
 *
 *   8단을 4색에 2칸씩 나눠 담아 **밝은 쪽에 몰았다.** 명암 계단은 4단으로 줄지만
 *   그래야 「흰색과 밝은 회색」이 된다. 후보 7안 비교는
 *   `HD테스트/갑옷색/흰갑옷_후보.png` (A 무채1:1 · B 중간 · **C 적용** · D 초록빛 ·
 *   E 파랑빛 · F 흰+무채). */
/* ★★★ **갑옷만 회색으로 — 이것이 최종 확정이다** (2026-08-18 사용자 확정)
 *
 *   > 「그냥 이걸로 가자 **제일 깔끔한 것 같아**」
 *
 *   ★★★ **여기가 옛 표로 남아 있어서 사고가 났다** (사용자 지적:
 *     「말, 비룡 색상 변경 관련해서 **다른 거 두고 갑옷만 회색으로** 바꾸라고 했는데,
 *      지금은 **파란색**이 되었어. **애초에 니가 추출할 때 잘못 적용**한 것 같아」)
 *
 *   경위 — 색을 여러 번 바꿔 가며 고르던 중간 단계에서 갑옷을 **은청(`26~31`)** 으로
 *   뒀었다. 그 뒤 `04_도구/부위마스크/색배정.json` 쪽에서 **회색(`1~7`)** 으로 확정했는데,
 *   **`native.js` 의 이 표를 같이 안 고쳤다.** HD 굽기(`1_시트굽기.js`)는 이 표를
 *   쓰므로 736장이 전부 파란 갑옷으로 구워졌다.
 *
 *   ★ **두 곳이 같은 값을 봐야 한다** — 실행기는 이 표, HD 굽기도 이 표,
 *     부위마스크 도구는 `색배정.json`. 값을 바꿀 때 **둘 다** 고친다.
 *
 *   확정 내용 (`03_분석/말_탑승_채색_작업지시서.md` §8):
 *     갑옷 `56~63` → `1,2,3,4,5,6,7,7`   회색빛
 *     그 밖(망토·엣지·어깨띠·팔·무기·머리) → **손대지 않는다** */
var _실버 = {};
[1, 2, 3, 4, 5, 6, 7, 7].forEach(function (v, i) { _실버[56 + i] = v; });

/* ★★★ **말 탄 그림의 어깨 테두리 붉은색 → 흰색 계통** (2026-08-18 · 사용자
 *   「같은 조건으로 **말 탄 스프라이트는 엣지부분 붉은색**을 **비룡처럼 흰색계통**으로
 *    바꿔서 적용해줘」 · 「**어깨 주변**에 있는 붉은색 계통이야」)
 *
 *   **말(`R*`)에만 있는 대역을 비룡(`D*`)과 대조해 찾았다.**
 *
 *   | 대역 | 말 | 비룡 | 무엇 (진단 렌더로 확인) |
 *   |---|---:|---:|---|
 *   | **`88~95` 적갈** | **3~4 %** | **0 %** | **어깨 양쪽 테두리** ← 이것 |
 *   | `96~103` 황토 | 5 % | **0 %** | 어깨 아래 작은 장식 (붉은색이 아니라 **그대로 둔다**) |
 *
 *   `RSILVER` · `RSHURI` · `RALCIA` · `RCROW` 가 쓰고, 대응 비룡은 전부 0 % 다.
 *   `RSILVERW` · `RKAJA` · `RSARA` 는 말인데도 0 % — 표에 넣어도 무해하다.
 *   진단 렌더 `HD테스트/갑옷색/말엣지_진단.png` (빨강 = `88~95` · 노랑 = `96~103`).
 *
 *   `88~95`(`#ffe3e7` → `#41181c`) 8단을 무채 `1~7` 7단에 담는다. 가장 어두운
 *   두 칸이 `7` 로 합쳐진다.
 *
 *   ★ 비룡에는 걸지 않는다 — 어차피 0 % 지만, **말에만 있는 부위**라는 사실을
 *     코드에 남긴다. */
/* ★★★ **어깨 테두리는 손대지 않는다 — 껐다** (2026-08-18 사용자 확정)
 *
 *   붉은 계열이 **성별로 대역이 갈린다**(남 `88~95` 적갈 · 여 `80~87` 자주).
 *   게다가 같은 대역을 **화살통 화살**(96~100 %)·**머리카락**(`RDURAN` 79 %)·
 *   **투구 깃털**(`RSILVERW` 66 %)이 쓴다. 색인으로도 기하로도 못 가른다.
 *   자세한 것은 `03_분석/말_탑승_채색_작업지시서.md` §8.
 *   → 표는 남겨 두되 **아무 데도 엮지 않는다.** 성별 판정이 서면 그때 되살린다. */
var _말어깨_꺼둠 = { 88: 1, 89: 2, 90: 3, 91: 4, 92: 5, 93: 6, 94: 7, 95: 7 };

/* ★★★ **실버애로우 복장을 입은 탈것 스프라이트 42개** (전수 확정 2026-08-18)
 *
 *   사용자가 폴더에서 직접 찾아 준 목록(비룡 16 + 말 규칙)을 원본으로 대조했다.
 *   **비룡 16개는 사용자 목록과 정확히 일치**했고, 말 26개도 사용자 규칙
 *   (「d 를 r 로 교체 + 그것에 마지막 e 붙은 것 + rariana rs_e rs_ew」)대로
 *   16 + 7(E판) + 3 = 26 으로 딱 맞았다.
 *
 *   **표식은 `56~63` 청록(갑옷)이다.** `.RCR` 76개 중 청록을 5% 이상 쓰는 것이
 *   정확히 이 42개다. 사용자가 「나머지 비룡은 옷이 다를거야」라 한 것이 맞았다 —
 *   빠진 13개(`DDARK` `DGRAY` `DGS1/2` `DLACID1/2` `DIYOLINE` `DDBLADE` `DGRIUM`
 *   `DKARLS` `DKASHU` `DVUNSTA` `DIRUS`)는 **청록이 0%** 로 다른 복장이다.
 *
 *   ★ 캐릭터마다 **개인 색**(살색·자주·초록·갈색…)이 따로 있다. 공통은
 *     `1~7` 무채(망토·갑옷 바탕 50~88%) 와 `56~63` 청록(갑옷 8~44%) **둘뿐**이라,
 *     리맵은 그 두 대역만 건드린다. 개인 색은 그대로 둔다.
 *   ★★ 자주(`80~87`) → 파랑은 **`*SILVERW` · `RS_EW` 에만** 적용한다.
 *      다른 캐릭터의 `80~87` 은 개인 색이다 (`DARCION` 18% · `RROCARNO` 12%).
 *
 *   ★★★ **원본 버그** — 이름표(EXE)는 `RROBELE.RCR` 을 찾는데 **실제 파일은
 *   `RROVELE.RCR`**(B↔V)이다. 보행 쪽은 `S_ROVEL.NC2` 계열이라 `ROVEL` 이 맞고,
 *   `.RCR` 이름표만 `ROBEL` 로 적혀 있다 (`RROBEL` · `DROBEL` 은 파일도 B 라 정상).
 *   → 원본에서 이 한 장이 **로드되지 않는다.** 리마스터에서 고칠 거리.
 *   자세히는 `03_분석/탈것_갑옷색_리맵.md` §3-4. */
var _실버계열 = [
  /* 비룡 16 — 사용자 목록과 일치 */
  'DALCIA', 'DARCION', 'DCROW', 'DDURAN', 'DERICH', 'DGISHNE', 'DKAJA', 'DLANDAM',
  'DROBEL', 'DROBIN', 'DROCARNO', 'DSARA', 'DSHURI', 'DSILVER', 'DSILVERW', 'DSIREN',
  /* 말 16 (위의 d→r) */
  'RALCIA', 'RARCION', 'RCROW', 'RDURAN', 'RERICH', 'RGISHNE', 'RKAJA', 'RLANDAM',
  'RROBEL', 'RROBIN', 'RROCARNO', 'RSARA', 'RSHURI', 'RSILVER', 'RSILVERW', 'RSIREN',
  /* 말 E판 7 — ★ `RROVELE` 는 이름표의 `RROBELE` 와 철자가 다르다(위 버그) */
  'RARCIONE', 'RCROWE', 'RGISHNEE', 'RKAJAE', 'RROBINE', 'RROVELE', 'RSHURIE',
  /* 말 추가 3 — 사용자가 따로 짚어 준 것 */
  'RARIANA', 'RS_E', 'RS_EW'
];

/* ★★ **`E` 접미 = 이글(Eagle) 직업** (2026-08-18 · 사용자 「e접미는 이글 직업이야.
 *   **무기가 활로 바뀌어**」). 그래서 크기가 다르다 — 창 대신 활을 든다.
 *   `.NC2` 이름표 41~43 에 `EAGLE` · `EAGLED` · `EAGLEW` 가 있다.
 *   `RS_E`(실버+이글) · `RD_E`(암흑+이글) 처럼 `_E` 로 적힌 것도 같은 뜻.
 *   → **같은 캐릭터의 직업 변형**이므로 복장 색은 본판과 같이 간다. */

/** 자주 깃털을 파랑으로 옮길 것 — 실버애로우 본인 판만.
 *  ★ 갑옷을 흰색으로 바꾼 뒤에는 **쓰지 않는다** (사용자 「다른거 바뀌면 안돼」).
 *  되살릴 일이 있으면 아래 `_실버계열` 채우는 곳에서 다시 엮으면 된다. */
var _자주깃털 = {};

var 색인리맵표 = {
  /* 말 초록 마갑 → 강철 은청색. 8단 → 8단
     ★ 8~15 는 마갑만이 아니라 **말 몸통 전체**다 (`탈것_갑옷색_리맵.md` §3-2) */
  'HORSE3.BCR': _램프(8, 24, 8)

  /* 비룡(`WYV-A.BCR`)은 목표 색 **미정** — 실측이 파랑(40~47)이라 사용자 확인 대기.
     'WYV-A.BCR': _램프(40, 8, 8) */
};

/* 42개를 표에 채운다. **말(`R*`)에만** 어깨 테두리 리맵을 얹는다 */
/* ★ **갑옷(`56~63`)만** 바꾼다. 말이든 비룡이든 같다 — 어깨·깃털 예외 없음 */
_실버계열.forEach(function (n) { 색인리맵표[n + '.RCR'] = _실버; });
/* 정본 290 — 적용 폴더에 새로 만든 탑승 그림도 같은 갑옷(56~63 청록)을 쓴다 — 표에 빠져 리맵이 0화소였다
 *   캐빈 = RJOEL·DJOEL(알시온 RARCION·DARCION 에 색 입힘 · 1109 → 579·580) · 신디 = RCINDY·DCINDY · 실측 청록 4.7~5.7% · 적용 폴더 RALCIA·DALCIA 는 이미 표(_실버계열)에 있다
 *   (사장님 11-19 「탈것 팔레트 봐줘. 지금 적용 안된것 확인한건 캐빈, 신디 스프라이트야」) */
['RJOEL', 'DJOEL', 'RCINDY', 'DCINDY'].forEach(function (n) { 색인리맵표[n + '.RCR'] = _실버; });

/* ★★★ **말에서 잘라 만든 PM 도 같은 리맵을 받아야 한다** (2026-08-18)
 *
 *   `PM*SILV`·`PM*SILW` 는 `RSILVER`·`RSILVERW` 를 **잘라낸 것**이라 갑옷 색인
 *   `56~63` 청록을 그대로 물려받는다. 표에 안 넣으면 **말은 회색인데 마장기
 *   조종사만 청록**으로 남는다 — 같은 사람이 탈것만 바꿨는데 색이 달라진다.
 *   ★ `PM*DARK` 는 넣지 않는다. `RDARK` 가 애초에 `_실버계열` 이 아니다
 *     (다크아머는 청록 0 % — 다른 복장이다). */
for (var _묶 = 0; _묶 < 3; _묶++) {
  색인리맵표['PM' + _묶 + 'SILV.MCR'] = _실버;
  색인리맵표['PM' + _묶 + 'SILW.MCR'] = _실버;
}

/** 색인 리맵을 끌 수 있다 — 원본 기준으로 볼 때 `false`. 리마스터는 `true`. */
var 색인리맵켬 = true;

/**
 * 디코딩된 프레임의 색인을 표대로 바꾼다. 표에 없는 파일은 손대지 않는다.
 * 투명(`idx<0`)은 건드리지 않는다.
 * @param {Array} frames `decodeNC2(...).frames`
 * @param {string} 파일명 예 `'HORSE3.BCR'` (대소문자·경로 무시)
 * @returns {number} 바꾼 픽셀 수 (표에 없으면 0)
 */
function 색인리맵(frames, 파일명) {
  if (!색인리맵켬 || !frames || !파일명) return 0;
  var 이름 = String(파일명).replace(/^.*[\/\\]/, '').toUpperCase();
  var 표 = 색인리맵표[이름]; if (!표) return 0;
  /* 256칸 룩업으로 펴 둔다 — 프레임마다 객체 조회하면 느리다 */
  var lut = new Int16Array(256); for (var i = 0; i < 256; i++) lut[i] = i;
  for (var k in 표) if (Object.prototype.hasOwnProperty.call(표, k)) lut[k | 0] = 표[k] | 0;
  var 바꿈 = 0;
  for (var fi = 0; fi < frames.length; fi++) {
    var idx = frames[fi] && frames[fi].idx; if (!idx) continue;
    for (var p = 0; p < idx.length; p++) {
      var v = idx[p];
      if (v >= 0 && v < 256 && lut[v] !== v) { idx[p] = lut[v]; 바꿈++; }
    }
  }
  return 바꿈;
}

/* ★★★ **리마스터 전용 스프라이트 대역 — 900~** (2026-08-16 · 사용자 지정)
 *
 *   원본 표 셋은 `0 ~ 224` · `300 ~ 426` · `500 ~ 575` 로 꽉 차 있다.
 *   원본에 없던 그림(다른 게임에서 가져온 것 등)은 **900번대**에 둔다 —
 *   원본 번호와 섞이지 않고, 뒤로 얼마든지 이어 붙일 수 있다.
 *
 *   파일은 `06_패치/적용/CHARACTE/` 에 둔다. 서버가 그 폴더를 원본보다 먼저
 *   보므로(`server.js`) 실행기 쪽은 평소처럼 `/원본/CHARACTE/<이름>` 을 부르면 된다.
 *
 *   | 번호 | 파일 | 어디서 왔나 |
 *   |---|---|---|
 *   | 900 | `HGS.NC2` | **창세기전 1** — GS 가 스탬블링거를 얻은 뒤 모습.
 *   |     |           | `04_도구/g1_스프라이트_굽기.js` 로 G2 팔레트에 맞춰 구웠다.
 *   |     |           | 자세한 것은 `03_분석/창세기전1_스프라이트_컨버팅.md`.
 *
 *   ★ 원본과 다른 것이므로 `03_분석/리마스터_적용현황.md` 에도 적혀 있다. */
/* ★★★★★ **리마스터 번호 대역** — 원본 기준으로 **추가된 것들** (2026-08-22 재배치)
 *
 *   > 「잠깐 **pm은 더 늘어날거야**. 대역 아주 뒤로 옮기는게 좋겠어. **1200번대** 정도로」
 *   > 「**원본기준 추가된 대역들 모두**」
 *
 *   원본 표 셋은 `0~224` · `300~426` · `500~575` 로 꽉 차 있다.
 *   추가분은 처음에 **900번대**에 몰아 뒀는데, PM 조종사가 `901 + 묶음*N + 캐릭터`
 *   로 **개수만큼 뻗는 대역**이라 새 번호를 붙일 때마다 충돌 위험이 있었다
 *   (실제로 여성판 노랑을 910 에 뒀다가 `PM0ARC` 를 덮었다).
 *
 *   ⇒ **대역을 상수로 빼고 서로 멀리 떨어뜨린다.**
 *
 *   | 대역 | 무엇 | 여유 |
 *   |---|---|---|
 *   | **1100~** | 개별 추가 캐릭터 (창1 `HGS` 등) | 100칸 |
 *   | **1200~** | **여성판** 팔레트 리맵 | 100칸 |
 *   | **901~** | **PM 조종사**(사용자 지정) | 개수만큼 |
 *   | **576~** | 말·비룡 탑승 추가 그림(사용자 지정) | 개수만큼 |
 *
 *   ★ 새 번호를 붙일 때는 반드시 **여기 상수를 통해** 잡는다. 숫자를 직접 쓰지 않는다. */
var 대역_개별 = 1100;      /* 창1 등에서 가져온 개별 캐릭터 */
var 대역_여성판 = 1200;    /* 팔레트 리맵으로 만든 여성판 */
var 대역_PM = 901;         /* 3급 마장기 조종사 — 사용자 지정 시작 번호 */

/* [원본없음] — 아래 번호(576~ · 901~ · 1101~ · 1200~)는 **리마스터가 새로 붙인 자리**다.
 * 원본 스프라이트 표는 0~224 · 300~426 · 500~575 세 구간뿐이라(`SPRTBL`)
 * 그 **밖의 빈 대역**을 골라 쓴다. 원본 EXE 를 파도 이 번호는 안 나온다. */
var 리마스터_스프라이트 = {
  1101: 'HGS.NC2',        // 보행 (44프레임, .NC2)
  576: 'RHGS.RCR',        // 말 위 상반신 — 추가 탑승 그림 대역은 576부터
  /* ★ 2026-10-12 사장님(원문) 「… 원본 스프라이트의 말, 비룡 탑승 스프라이트에 적용 스프라이트의 색상을 반영해서 탑승용 스프라이트(말, 비룡) 파일을 적용폴더에 만들어주고 연결해주면 좋겠어.」
   *   04_도구/탑승그림_색입히기.js — 바탕 보행 ↔ 색 바꾼 보행의 색 대응을 바탕 탑승 그림(.RCR 덧그림)에 입힘 */
  577: 'RCINDY.RCR',  578: 'DCINDY.RCR',     // 신디(CINDY 1107 ← 사라 SIREN) — RSIREN·DSIREN 색 입힘
  579: 'RJOEL.RCR',   580: 'DJOEL.RCR',      // 캐빈(JOEL 1109 ← 알시온 창 L_ARCION) — RARCION·DARCION 색 입힘
  581: 'RICE.RCR',    582: 'DICE.RCR',       // 아이스(ICE 1108 ← 라시드 킹 NS_LACID) — RLACID2·DLACID2 색 입힘

  /* ★★★ **`KILLER3` — 네 번째 색 변형** (2026-08-18 사용자 지정)
   *   > 「`killer0~2` 캐릭터를 토대로 **색깔이 변하는 부분(옷 부분과 눈 부분) 영역을
   *   >  마스킹으로 추출**하고, 이 부분에 **`hanzo` 캐릭터의 스프라이트 참조**해서
   *   >  **옷은 파란색, 눈은 노란색 계통**으로 전환해서 `killer3` 파일도 만들어 줘」
   *
   *   원본은 `103 KILLER0` · `104 KILLER1` · `105 KILLER2` 세 벌뿐이다(옷·눈 색만 다르다).
   *   `04_도구/킬러_색변형.js` 가 세 벌을 앵커 기준으로 겹쳐 **변하는 자리**를 마스크로
   *   뽑고, 거기에 `HANJO`(199) 의 파랑 `40~47`·노랑 `16~23` 램프를 넣어 만들었다.
   *   ★ 색인만으로는 못 가른다 — `KILLER0` 의 눈 대역 `75~79` 는 **살색이기도 하다.** */
  1103: 'KILLER3.NC2',

  /* ★★★ 사장님 지정 2026-09-14 — 「**스프라이트 1100번대에 적용폴더에 있는
   *   strider.nc2 연결**해줘」
   *   파일 : `06_패치/적용/CHARACTE/STRIDER.NC2` (25,624B · **44프레임** 보행)
   *   ☠ **원본 이름표(0x75AA8)에는 STRIDER 가 없다** — 실측으로 확인했다.
   *     그래서 원본 번호를 빼앗지 않고 리마스터 일반 대역에 붙인다. */
  1104: 'STRIDER.NC2',

  /* ★★★ 사장님 지정 2026-09-16 — **창1 발탄솔져를 «남성» 발탄솔져로**
   *   > 「창1 스프라이트 중에서 **발탄솔져 스프라이트(2개, 비행+지상)** 찾아서
   *   >  2용으로 컨버팅하고 창2에 적용해야해.」
   *   > 「**남자쪽으로 창1솔져→창2어절트→창2로드, 여자쪽으로 창2솔져→창2E어절트→
   *   >  창2E로드** 순으로 맞추라는거야」
   *
   *   ★ **컨버팅이 필요 없었다** — 창1·창2 `.NC2` 가 같은 포맷이다
   *     (둘 다 `New Fast&Compress Sprite Ver3.0 for 13h mode`).
   *     발탄 6개 중 **솔져 둘만 창1·창2가 다르고**(SG 28504↔28552 · SF 35031↔35659)
   *     어설트·로드 넷은 바이트까지 같다.
   *   ★ 파일은 이름이 겹치지 않게 `G1VALTSG/SF` 로 넣었다
   *     (`06_패치/적용/CHARACTE/`).
   *   ★ 지상/비행이 **짝수·홀수로 이어지는 규칙**을 지킨다 —
   *     83 SG/84 SF · 85 AG/86 AF · 87 LG/88 LF · 89 E_AG/90 E_AF · 91 E_LG/92 E_LF
   *     ⇒ 1105 지상 · 1106 비행. */
  1105: 'G1VALTSG.NC2',   // 창1 발탄솔져 지상 — 남성 발탄솔져
  1106: 'G1VALTSF.NC2',   // 창1 발탄솔져 비행
  1107: 'CINDY.NC2',      // 적용 전용 보행 — 신디
  1108: 'ICE.NC2',        // 적용 전용 보행 — 아이스
  1109: 'JOEL.NC2',       // 적용 전용 보행 — 캐빈 (파일 이름 JOEL · 사장님 11-21 「1109 스프라이트 캐빈으로 바꿔줘」)
  /* ★ 사장님 2026-11-09 「필요시 가리우스와 라는 비행형 파일을 만들어줘. 다른 마장기들 보면 군단전투형과
   *   같은데 순서만 재조정된걸로 보여」 — 원본 비행형은 ARO·ASU·DUN·ELJ 넷뿐.
   *   04_도구/마장기_비행형_만들기.js 가 GAR-S·RA-S 칸을 비행형 순서·앵커·그림자로 옮겨 굽는다.
   *   41-3A 랜담(가리우스)·카심(라)이 쓴다 (battle_main 비행마장기보정한). 본체 의미는 원본 328·329 와 같이 SPECIAL. */
  1110: 'GAR-F.BCR',      // 가리우스 비행형 (← 328 GAR-S)
  1111: 'RA-F.BCR',       // 라 비행형 (← 329 RA-S)
  1112: 'ABA-F.BCR',      // 아발레스트 비행형 (← 323 ABA-S) — 사장님 「라, 가리우스 외에도 빠진 마장기들 확인해서 적용해줘. 아스모데우스는 제외」
  1113: 'YAN-F.BCR',      // 야누스 비행형 (← 330 YAN-S)

  /* ★★★ **여성 짝이 없는 직업의 여성판 — 팔레트 리맵** (2026-08-22 · 사용자 지정)
   *   > 「남녀 구분없는 캐릭터들(**드루이드, 비숍, 네크로맨서, 리치**) …
   *   >  **팔레트 맵핑으로 다른 이미지로 만들어두면 안돼?**」
   *
   *   원본은 이 넷에 남녀 **같은 조형**을 준다. 그래서 여성이 전직하면 남자로
   *   보이고, 계열 역산까지 남성 행을 집었다(`jobchange.js 성별교정행`).
   *
   *   규칙은 **원본 `WIZARD1 → WIZARD2`(남→여)에서 실측**했다 —
   *   팔레트는 **8색 램프** 단위이고 남녀 짝은 **램프를 통째로 옮긴 것**이다.
   *   `24~31 파랑 → 48~55 초록` · `72~79 → 80~87 분홍`.
   *   ⇒ **주 옷 램프를 초록(48~55)으로**, 이미 초록·청록이면 **분홍(80~87)** 으로.
   *
   *   | 번호 | 파일 | 원본 | 옮긴 램프 |
   *   |---|---|---|---|
   *   | 903 | `DRUIDW.NC2`    | `DRUID` 66    | 88~95 적갈 → 48~55 초록 |
   *   | 904 | `BISHOPW.NC2`   | `BISHOP` 67   | 16~23 주황 → 48~55 초록 |
   *   | 905 | `NECROMANW.NC2` | `NECROMAN` 74 | 88~95 적갈 → 48~55 초록 |
   *   | 906 | `LICHW.NC2`     | `LICH` 75     | 56~63 청록 → 80~87 분홍 |
   *
   *   ★ 파일은 `04_도구/여성판_색변형.js` 가 굽는다 → `06_패치/적용/CHARACTE/`.
   *   ★ **전직창 조형**(`CITIZEN2.SPR`)에는 이 번호가 없다 — 조형은 파일이 아니라
   *     한 장의 SPR 이라 프레임을 늘릴 수 없다. 그래서 `여성판_조형` 표를 따로 두고
   *     **그릴 때 리맵**한다(바로 아래).
   *   ★ 원본과 다른 것이므로 `03_분석/리마스터_적용현황.md` 에 적혀 있다. */
  /* 여성판은 아래 `여성판_규칙`(1201~)에서 **자동으로 채운다** —
   *   파일명을 두 곳에 적으면 한쪽만 고쳐진다(실제로 그랬다). */
};
/* 비행형 마장기는 원본 328·329 처럼 큰 본체(SPECIAL) — 리마스터 등록 번호의 기본값 ORDINARY 를 덮는다 (sprite_semantics.js 계약) */
(root.G2SpriteSemanticOverrides = root.G2SpriteSemanticOverrides || {})[1110] = 'SPECIAL';
root.G2SpriteSemanticOverrides[1111] = 'SPECIAL';
root.G2SpriteSemanticOverrides[1112] = 'SPECIAL';
root.G2SpriteSemanticOverrides[1113] = 'SPECIAL';

/* ★★★ **3급 마장기 조종사 — 창세기전1 `PM*.MCR`** (2026-08-16 · 사용자 요청
 *   「3급마장기도 말이나 비룡 타는 것처럼 pm 스프라이트 사용해서 연결해줄 수 있어?」)
 *
 *   ★ 이것은 **원본과 다르게 가는 것**이다 (`리마스터_적용현황.md` 참고).
 *     원본 창세기전2 는 마장기 조종사를 `0x70896` 표로 골라 `D*.RCR` 로 그리는데,
 *     그 표에는 **이름 있는 캐릭터만** 있다. 그래서 제국병·로열가드 같은 일반
 *     병종이 마장기를 타면 **조종사가 아예 안 그려진다.**
 *     창세기전1 에는 병종 조종사 그림(`SOL`·`LAN`·`GEN`)이 있어서 그걸 쓴다.
 *
 *   파일은 `PM{0|1|2}{캐릭터}.MCR` — 마장기 3종 × 캐릭터 19종 = **57개**.
 *   창세기전2 `CHARACTE` 에도 같은 파일이 md5 까지 같게 들어 있지만 **아무도
 *   안 부른다**(EXE 에 `MCR` 문자열이 없다). 팔레트는 창세기전1 사양이라
 *   `04_도구/g1_스프라이트_굽기.js` 로 구워 `06_패치/적용/CHARACTE/` 에 뒀다.
 *
 *   번호: **901 + 마장기종류(0~2) × 47 + 캐릭터색인(0~46)** → 901 ~ 1041. */
var PM_캐릭터 = ['ARC', 'CRO', 'GEND', 'GENE', 'GENEW', 'GISH', 'GS', 'IYO', 'KAJA',
                 'LACI', 'LAN1', 'LAND', 'LANW', 'ROB', 'ROV', 'SHUR', 'SOL1', 'SOLD', 'SOLW',
                 /* ★★★ **2026-08-18 추가 — 진영별 3종 + 캐릭터 4종** (사용자 지정)
                  *
                  *   > 「pm계열(3급 마장기 탑승) 관련하여 **실버애로우와 다크아머
                  *   >  스프라이트 제작**하면 좋겠어. 말·비룡처럼 직업별이 아닌
                  *   >  **진영별**(`rsilver rsilverw rdark`) 이미지를 토대로」
                  *
                  *   `SILV`·`SILW`·`DARK` 는 **말 탑승 `.RCR` 에서** 잘라 만들었다
                  *   (`04_도구/탑승그림_말에서.js`). 보행 `.NC2` 가 아예 없는 진영
                  *   복장이라 다른 길이 없었다.
                  *   `HGS`·`GRAY`·`KARLS`·`KASHU` 는 보행에서 잘랐다
                  *   (`04_도구/탑승그림_생성.js`). */
                 'SILV', 'SILW', 'DARK', 'HGS', 'GRAY', 'KARLS', 'KASHU',
                 /* ★ 2026-09-20 — 전용 보행 스프라이트가 있는 캐릭터는 진영판 대신
                  *   그 전용 정지 자세에서 자른다. PM 파일명은 DOS 8.3을 지키려고
                  *   `PM0` 뒤의 키를 다섯 글자 이하로 둔다. */
                 'YLACI', 'KLACI', 'DURAN', 'ROCAR', 'SIREN', 'CINDY', 'STEIN', 'BP',
                 'ALCIA', 'LANDM', 'DICUS', 'ERICH', 'IRUS', 'DBLAD', 'GRIUM', 'VUNST',
                 'STRID', 'SARA', 'KASHI', 'ICE', 'JOEL'];
/* 창세기전1 `CHRSYS.EXE 0x562FC` 에 `PM<벌><캐릭터>.MCR` 이 나란히 있다 —
 * **세 벌(PM0·PM1·PM2) × 19명**으로 벌마다 수가 같다.
 * 확인: `node 04_도구/CHRSYS_PM표.js` */
var PM_원본수 = 19;                    // 앞 19종이 창세기전1 원본, 그 뒤는 생성

/* 마장기 스프라이트 번호 → PM 묶음 (0·1·2).
 *   306 `M-MECHA1` · 307 `M-MECHE1` → 0
 *   308 `M-MECHA2` · 309 `M-MECHE2` → 1
 *   310 `M-MECHA3` · 311 `M-MECHE3` → 2   (312·313 은 3급 재사용이라 같이 2) */
function PM묶음(탈것번호, 고정) {
  var n = 탈것번호 | 0;
  var 마장기 = (n >= 306 && n <= 313);
  if (!마장기) return -1;                        // 3급 마장기가 아니다
  /* ★★★★★ **2026-08-29 — 사용자가 답을 줬다. 확정.**
   *
   *   > 「**PM 조종사 관련은 원작에는 없어. 리마스터 사양이고
   *   >   1, 2, 3은 각각 베샤르, 페리튼, 로퍼 탑승 이미지야.**」
   *   > 「**창세기전1에서 적용되던 게 그대로 넘어왔는데,
   *   >   2에는 적용이 안 된 거야.**」
   *
   *   ⇒ **[원본없음]** — 창세기전2 는 이 그림을 **안 쓴다.**
   *     `CHRSYS.EXE`(창세기전1)에 `PM<벌><캐릭터>.MCR` 이 남아 있고
   *     파일이 그대로 넘어왔을 뿐이다. 그래서 `COMBATII.EXE` 를
   *     아무리 파도 이 배선은 안 나온다 — **파도 안 나오는 것이 맞다.**
   *
   *   ⇒ **PM 벌 0·1·2 = 마장기 1·2·3급 = 베샤르 · 페리튼 · 로퍼.**
   *     아래 배선(306·307 → 0 / 308·309 → 1 / 310~313 → 2)이 그대로 맞다.
   *     ★ 이 파일에 이미 실측이 적혀 있었고 **정확히 맞아떨어진다** —
   *       「베샤르 306 · 페리튼 308 · 로퍼 310」.
   *
   *   ☠ **한때 「306 이 틀렸다」고 볼 뻔했다** — 내 도구
   *     `EXE_스프라이트이름표.js` 가 428칸을 **0부터 연속**으로 매겨
   *     `M-MECHA1` 을 231 이라고 냈다. 실제 표는 **세 구간**이고
   *     225칸 뒤에서 번호가 **300 으로 뛴다**(`SPRTBL`) — 그래서 306 이다.
   *     (`03_분석/_보관/옛지적/00_보류_증상목록.md` B-17 · 도구는 고쳤다)
   *
   *   ☐ 세 벌이 서로 무엇이 다른지(자세? 방향? 판본?)는 아직 안 봤다 —
   *     `CHRSYS.EXE 0x562FC` 부터 세 벌 × 19명이 나란히 있고
   *     파일 크기가 다 다르다(IYO: PM0 9968 · PM1 10000 · PM2 …).
   *     곧 **같은 캐릭터의 서로 다른 그림**이다.
   *     `node 04_도구/CHRSYS_PM표.js` 로 다시 볼 수 있다.
   *     ★ 리마스터 사양이라 **원본에 정답이 없다** — 사용자가 눈으로 고른다. */
  if (고정 === 0 || 고정 === 1 || 고정 === 2) return 고정;
  if (n === 306 || n === 307) return 0;
  if (n === 308 || n === 309) return 1;
  return 2;                                     // 310~313 (3급 재사용 포함)
}

/* 창세기전2 탑승자 스프라이트 번호 → PM 캐릭터 키.
 *   병종은 이름이 그대로 겹친다(`SOLDIER1`·`LANCER1`·`GENERA` …).
 *   이름 있는 캐릭터는 `0x70896` 표(`D*.RCR`)에서 역추적했다. */
var PM_대응 = {
  20: 'SOL1', 21: 'SOLD', 22: 'SOLW',          // SOLDIER1 · SOLDIER2 · SOLDIERW
  23: 'LAN1', 24: 'LAND', 25: 'LANW',          // LANCER1 · LANCER2 · LANCERW  ★ 캐빈 = 23
  26: 'GENE', 27: 'GEND', 28: 'GENEW',         // GENERA · GENERAL2 · GENERAW
  136: 'GS',                                   // S_GS (NS_GS 141은 아래 스타이너 전용)
  146: 'LACI', 150: 'LACI', 151: 'LACI',       // S_LACIDE · HLACID · NS_LACIDE
  155: 'IYO', 159: 'ROB', 163: 'KAJA', 167: 'GISH',
  171: 'SHUR', 175: 'CRO', 179: 'ARC', 183: 'ROV',
  /* ★★★ **진영별 조종사 — 말 표(`0x706D4`)가 정하는 그대로** (2026-08-18)
   *
   *   원본은 말을 태울 때 **캐릭터가 아니라 진영 복장**으로 그림을 고른다:
   *     `word[0x706D4 + 탑승자*2] + 500` → 500 `RSILVER` · 501 `RSILVERW` · 502 `RDARK`
   *   실측한 전수(EXE 직독):
   *     500 실버애로우 남 ← 0 KNIGHT1 · 3 PARADIN · 23 LANCER1 · 26 GENERA · 31 ROYALG · 33 EARTHQ
   *     501 실버애로우 여 ← 2 KNIGHTW · 5 PARADINW · 25 LANCERW · 28 GENERAW · 32 ROYALGW · 34 EARTHQW
   *     502 다크아머     ← 1 KNIGHT2 · 4 IMPEPARA · 24 LANCER2 · 27 GENERAL2
   *
   *   이 중 **창세기전1 원본 PM 이 있는 것**(23·24·25·26·27·28·1·31)은 위 항목이
   *   이미 잡고 있다. 아래는 **아무도 없어서 마장기를 타면 조종사가 안 보이던** 8명이다.
   *   → 말과 같은 진영 그림에서 잘라낸 `SILV`·`SILW`·`DARK` 를 붙인다. */
  0: 'SILV',   3: 'SILV',   33: 'SILV',        // KNIGHT1 · PARADIN · EARTHQ
  2: 'SILW',   5: 'SILW',   32: 'SILW', 34: 'SILW',  // KNIGHTW · PARADINW · ROYALGW · EARTHQW
  1: 'DARK', 4: 'DARK',                        // KNIGHT2 · IMPEPARA
  31: 'SILV',                                  // ROYALG — 기사와 함께 진영판

  /* 기존 배선만 유지한다. 새 전용 캐릭터 배선은 번호 적용 뒤 별도 작업한다. */
  202: 'KARLS',                                // KARLS
  204: 'KASHU',                                // KASHUTAR (적용본이 색만 다른 같은 그림)
  216: 'GRAY', 217: 'GRAY', 218: 'GRAY', 219: 'GRAY',  // SGRAY·LGRAY·BGRAY·MGRAY 무기별 4벌
  1101: 'HGS'                                 // 리마스터 개별 대역 — ★ 전엔 'GS' 로 때웠다
};

/* ★★★ **`PM2` 만 `LAN1` 이 아니라 `LAN2` 다** (2026-08-16 · 사용자 지적 「로퍼도 확인했어?」)
 *
 *   세 묶음이 같은 19종을 반복한다고 보고 이름을 기계로 만들었더니
 *   **`PM2LAN1.MCR` 은 존재하지 않아** 캐빈(로퍼 = `310 M-MECHA3` + `LANCER1`)만
 *   조종사가 안 붙었다. 파일 목록을 전수로 보면 **딱 이 한 칸만** 다르다:
 *
 *     PM0 · PM1 → … LACI **LAN1** LAND LANW …
 *     PM2       → … LACI **LAN2** LAND LANW …
 *
 *   원본 제작 쪽 오타로 보이지만 파일이 그러니 그대로 따른다.
 *   (사용자가 먼저 「pm1lan1 또는 **pm2lan2**」라고 했다 — 목록을 보고 한 말이었다.) */
function PM파일키(묶, 키) {
  if (묶 === 2 && 키 === 'LAN1') return 'LAN2';
  return 키;
}

/** 마장기 조종사 스프라이트 번호. 3급 마장기가 아니거나 대응이 없으면 null. */
function PM조종사(탈것번호, 탑승자번호, 고정) {
  var 묶 = PM묶음(탈것번호, 고정); if (묶 < 0) return null;
  var 키 = PM_대응[탑승자번호 | 0]; if (!키) return null;
  var i = PM_캐릭터.indexOf(키); if (i < 0) return null;
  /* [원본없음] — 901 은 리마스터가 고른 빈 대역이다(위 `대역_PM`).
   * 원본 스프라이트 번호는 0~224 · 300~426 · 500~575 뿐이다. */
  return 대역_PM + 묶 * PM_캐릭터.length + i;
}

/* ★★★ **리마스터 스프라이트가 탈것을 탈 때** (2026-08-16 · 사용자 지정
 *   「말이나 비룡탈때, 기존 GS 가 타는 파일로 연결되게」)
 *
 *   원본은 탑승자 그림을 **표로** 고른다 (`0x11B77` · `전투데이터_추출.md` §4.4):
 *   ```
 *     탈것 [+0x5C] 1~4  → word[0x706D4 + 탑승자스프라이트*2] + 500   ; 말 계열
 *     탈것 [+0x5C] 5~6  → word[0x70896 + 탑승자스프라이트*2] + 500   ; 마장기·비룡
 *     탈것 [+0x5C] ≥ 7  → 0 (탑승자를 따로 안 그린다 — 통짜)
 *   ```
 *   그 표는 **번호 0~224 짜리**라 900번대는 색인이 아예 없다. 그래서 여기에 둔다.
 *
 *   원본 `S_GS`(136)가 어떻게 풀리는지 읽어서 맞췄다:
 *     `0x706D4[136] = 9`  → **509 `RGS1.RCR`** (말)
 *     `0x70896[136] = 51` → **551 `DGS1.RCR`** (마장기·비룡)
 *
 *   | | 900 (창세기전1 GS) | 왜 |
 *   |---|---|---|
 *   | 말 | **576 `RHGS.RCR`** | 창세기전1에 **그 캐릭터의 말 탄 그림이 있다**. 같이 구웠다. |
 *   | 마장기·비룡 | **551 `DGS1.RCR`** | 창세기전1에는 비룡 탑승 그림이 **없다**. 기존 GS 것을 그대로 쓴다. |
 *
 *   ★ 창세기전1 `CHARACTE` 의 `.RCR` 24개를 훑어도 비룡·마장기용은 없다
 *     (`REAGLE` 계열이 새 탈것). 그래서 마장기·비룡은 원본 GS 로 잇는다. */
var 리마스터_탑승 = {
  1101: { 말: 576, 비룡: 551 },  /* HGS — 추가 말 그림은 576(RHGS), 비룡은 원본 551 */
  1107: { 말: 577, 비룡: 578 },  /* 신디 CINDY — 색 입힌 RCINDY·DCINDY (2026-10-12) */
  1109: { 말: 579, 비룡: 580 },  /* 캐빈 JOEL — 색 입힌 RJOEL·DJOEL */
  1108: { 말: 581, 비룡: 582 }   /* 아이스 ICE — 색 입힌 RICE·DICE */
};

/* ★★★ **여성판 조형** — `CITIZEN2.SPR` 은 프레임을 늘릴 수 없어 **그릴 때 리맵**한다
 *
 *   `spriteNames` 의 900대는 `.NC2` 파일이 있어 그대로 읽히지만, 전직창·캐릭터
 *   목록이 보는 **조형**(`CITIZEN2.SPR` · `0x9E34E` 표)은 한 장짜리 SPR 이라
 *   새 번호를 넣을 자리가 없다. 그래서 **원본 조형 번호 + 램프 이동**으로 적어 두고,
 *   그리는 쪽이 `여성판조형()` 을 불러 색인을 바꾼다.
 *
 *   램프 값은 `.NC2` 쪽과 **같아야 한다** — 전직창에서 본 색과 전장에서 나오는
 *   색이 달라지면 안 된다.
 *
 *   ★★★★★ 그래서 **규칙을 여기 한 곳에만 둔다** (2026-08-22 통합).
 *     `04_도구/여성판_색변형.js` 도 이 표를 읽어 `.NC2` 를 굽는다. 두 벌로
 *     적어 두었더니 조형 쪽이 **초기 규칙(초록)에 멈춰 있었다** — `.NC2` 는
 *     분홍·보라·네이비로 여러 번 고쳤는데 전직창만 초록이었다.
 *
 *   ── 옮김 항목 `{주, 로, 칸?, 밀기?}` ─────────────────────────────
 *     `주`   옮길 램프의 첫 색인 (8의 배수)
 *     `로`   옮겨 갈 램프의 첫 색인
 *     `칸`   `[a, b]` — 램프 안 인덱스 a~b 만 (기본 0~7 전부)
 *            ★★ **`0~7` 램프는 `[0]` 이 검정, `[1]` 이 흰색**이다. 통째로 옮기면
 *               눈동자·외곽선까지 물든다 — 반드시 `[2, 7]` 로 자른다.
 *     `밀기` 목적지 인덱스를 민다. **음수면 밝은 쪽**(0~7 로 clamp).
 *
 *   ★ 옮김은 **적은 순서대로** 겹쳐 적용된다. 앞의 것이 목적지를 비워 주면
 *     뒤의 것이 그 자리에 들어간다(비숍: 분홍 → 보라, 그 뒤 주황 → 분홍). */
var 여성판_규칙 = {
  /* Druid — 후드만 핑크. 망토(72~79)는 원본 그대로 (사용자 「망토 원래대로」) */
  /* [원본없음] — 1200 대역은 **팔레트 리맵으로 만든 여성판**이다.
   * 원본에 없는 그림이라 번호도 원본 표 밖에서 골랐다.
   * `옮김`의 색 번호(주/로)는 팔레트 실측값이다 — `탈것_갑옷색_리맵.md` 참조. */
  1201: { 파일: 'DRUIDW.NC2', 원본파일: 'DRUID', 조형: 66, 뜻: "후드 → 핑크 (망토·얼굴은 원본 그대로)",
         옮김: [{ 주: 88, 로: 80 }] },
  /* Bishop — 원래 분홍을 보라로 **먼저** 밀고, 그 자리에 주황 법의를 넣는다 */
  1202: { 파일: 'BISHOPW.NC2', 원본파일: 'BISHOP', 조형: 67, 뜻: "주황 법의 → 분홍 (원래 분홍은 보라로)",
         옮김: [{ 주: 80, 로: 32 }, { 주: 16, 로: 80 }] },
  /* Necromancer — 적갈 망토 → 보라. 골격·두건(0~7)은 원본 그대로 */
  1203: { 파일: 'NECROMANW.NC2', 원본파일: 'NECROMAN', 조형: 74, 뜻: "적갈 망토 → 보라 (골격·두건은 원본 그대로)",
         옮김: [{ 주: 88, 로: 32 }] },
  /* Lich — 청록 망토 → 네이비. `0~7` 은 **해골 얼굴**이라 손대지 않는다 */
  1204: { 파일: 'LICHW.NC2', 원본파일: 'LICH', 조형: 75, 뜻: "청록 망토 → 네이비 (해골 0~7 은 그대로)",
         옮김: [{ 주: 56, 로: 24 }] },
  /* Wizard — 남성판 `WIZARD1`(58)에서 굽는다. 원본 여성판 59(초록)는 그대로 남는다 */
  1205: { 파일: 'WIZARDW.NC2', 원본파일: 'WIZARD1', 조형: 58, 뜻: "파랑 로브 → 분홍 · 그늘 → 분홍 음영 · 지팡이 보석 → 진빨강",
         옮김: [{ 주: 24, 로: 80 },                          /* 로브 → 분홍 */
                { 주: 0, 로: 88, 칸: [2, 7], 밀기: -1 },      /* 그늘 → 분홍 음영 */
                { 주: 40, 로: 88, 밀기: 2 }] },               /* 지팡이 보석 → 진빨강 */

  /* ★★★ Assassin — **세 벌을 다 쓴다** (사용자 2026-08-22: 「셋다 괜찮네.
   *   일단 셋다 확정하고. **남성 파랑으로, 여성, 흰색으로**」)
   *     908 흰색 = **여성** · 909 파랑 = **남성** · 994 노랑 = 예비
   *   원본 `ASSASIN`(9)의 자주 갑옷(80~87)과 초록 장식(48~55)을 함께 옮긴다.
   *
   *   ★★ PM 조종사 대역은 **901~1041** 이다
   *     (`901 + 묶음*47 + 캐릭터`, 3 × 47 = 141). 덮어쓰면 마장기 조종사가 사라진다.
   *     ⇒ 그 **뒤인 994** 로. 새 번호를 붙일 때는 `spriteNames` 를 찍어 빈자리를
   *       확인한다. */
  1206: { 파일: 'ASSASINW2.NC2', 원본파일: 'ASSASIN', 조형: 9, 뜻: "자주 갑옷 → 흰색 · 초록 장식 → 어두운 회색  [여성]",
         옮김: [{ 주: 80, 로: 0 }, { 주: 48, 로: 0, 밀기: 2 }] },
  1207: { 파일: 'ASSASINW3.NC2', 원본파일: 'ASSASIN', 조형: 9, 뜻: "자주 갑옷 → 하늘색 · 초록 장식 → 짙은 남색  [남성]",
         옮김: [{ 주: 80, 로: 40 }, { 주: 48, 로: 24, 밀기: 2 }] },
  1208: { 파일: 'ASSASINW.NC2', 원본파일: 'ASSASIN', 조형: 9, 뜻: "자주 갑옷 → 노랑 · 초록 장식 → 밝은 노랑  [예비]",
         옮김: [{ 주: 80, 로: 16, 밀기: 1 }, { 주: 48, 로: 16, 밀기: -3 }] }
};

/**
 * 여성판 번호 → `{조형, 옮김}`. 여성판이 아니면 null.
 * ★ 옛 이름 `여성판조형` 을 그대로 둔다 — 부르는 쪽이 있다.
 */
/* ★ 규칙의 파일명을 `리마스터_스프라이트` 에 얹는다 — 한 곳에서만 적기 위해 */
for (var _여 in 여성판_규칙)
  if (Object.prototype.hasOwnProperty.call(여성판_규칙, _여))
    리마스터_스프라이트[_여 | 0] = 여성판_규칙[_여].파일;

function 여성판조형(번호) {
  var r = 여성판_규칙[번호 | 0];
  return r ? { 원본: r.조형, 옮김: r.옮김 } : null;
}

/** 색인 하나를 옮김 규칙 하나에 통과시킨다. 해당 없으면 -1. */
function _옮김한칸(v, g) {
  var 칸 = g.칸 || [0, 7];
  var i = v - g.주;
  if (i < 칸[0] || i > 칸[1]) return -1;
  var j = i + (g.밀기 | 0);
  if (j < 0) j = 0; else if (j > 7) j = 7;
  return g.로 + j;
}

/** 옮김 배열 → 256칸 룩업. 앞에서부터 겹쳐 넣는다. */
function 여성판룩업(옮김) {
  var lut = new Int16Array(256);
  for (var i = 0; i < 256; i++) lut[i] = i;
  if (!옮김) return lut;
  for (var k = 0; k < 옮김.length; k++) {
    var g = 옮김[k];
    for (var v = g.주; v < g.주 + 8; v++) {
      var t = _옮김한칸(v, g);
      if (t >= 0) lut[v] = t;
    }
  }
  return lut;
}

/**
 * 프레임 하나의 색인을 옮긴 **사본**을 만든다. 원본은 건드리지 않는다.
 * @param 프레임 `{w,h,idx,ax,ay}`
 * @param 옮김 `[{주,로,칸?,밀기?}, …]` — 옛 호출을 위해 `(프레임, 주, 로)` 도 받는다
 */
function 램프옮긴사본(프레임, 옮김, 로) {
  if (!프레임 || !프레임.idx) return 프레임;
  if (typeof 옮김 === 'number') 옮김 = [{ 주: 옮김, 로: 로 }];   /* 옛 호출 */
  var lut = 여성판룩업(옮김);
  var idx = (프레임.idx.slice) ? 프레임.idx.slice() : Array.prototype.slice.call(프레임.idx);
  for (var i = 0; i < idx.length; i++) {
    var v = idx[i];
    if (v >= 0 && v < 256) idx[i] = lut[v];
  }
  var o = {};
  for (var k in 프레임) if (Object.prototype.hasOwnProperty.call(프레임, k)) o[k] = 프레임[k];
  o.idx = idx;
  return o;
}

/** 리마스터 번호가 탈것에 탈 때 쓸 탑승자 스프라이트 번호. 없으면 null. */
function 리마스터탑승(스프라이트번호, 탈것코드) {
  var t = 리마스터_탑승[스프라이트번호 | 0]; if (!t) return null;
  var c = 탈것코드 | 0;
  if (c >= 1 && c <= 4) return t.말;
  if (c >= 5 && c <= 6) return t.비룡;
  return 0;                                   // 7 이상 = 통짜, 탑승자를 안 그린다
}

/** LE 이미지에서 번호 → 파일명 사전을 만든다. (fixup 적용된 이미지여야 한다) */
/**
 * ★★★★★ **직업명 표** — `COMBATII.EXE 0x71118` · 레코드 **16 B** (2026-08-24)
 *
 *   배치 화면 정보 띠의 직업 칸이 이 표에서 온다:
 *     `0x5478A  al = [edi+0x11]`   (BLACKBOX 레코드 +0x11 = 직업)
 *     `0x5478D  shl eax, 4`        ×16
 *     `0x54793  add eax, 0x1118`   ★ fixup `+0x70000` → **0x71118**
 *     `0x547A9  call 0x60944`      서식 `"%s"`(`0x78056`)
 *
 *   실측: 0 Knight · 1 Paladin · 2 Death lord · 3 Dragon knight · 4 King ·
 *         5 Dragon slayer · 6 Fighter · 7 Assassin … **26 Magician** · 27 Alchemist
 *   (미카엘의 직업이 26 이고 원본 화면이 `MAGICIAN` 이다 — 일치)
 *
 * @param leImg `decodeLE(COMBATII.EXE)` 결과
 * @returns {string[]} 직업 번호로 색인하는 이름 배열
 */
function jobNames(leImg) {
  var img = leImg.img, BASE = leImg.base, out = [];
  var p0 = 0x71118 - BASE;
  if (p0 < 0) return out;
  for (var i = 0; i < 256; i++) {
    var o = p0 + i * 16;
    if (o + 16 > img.length) break;
    var s = '';
    for (var k = 0; k < 16 && img[o + k]; k++) s += String.fromCharCode(img[o + k]);
    out.push(s);
  }
  return out;
}

/**
 * ★★★★★ **직업표 `0x731AC` — 항목 15 B** (2026-08-25 신설)
 *
 *   `0x548BC` 가 `직업*16 − 직업 = 직업*15` 로 색인해 `[+0]` 을 읽는다:
 *   ```asm
 *   0x548B9  dl = [edi+0x11]          ; 직업
 *   0x548BE  eax = 직업 << 4
 *   0x548C1  eax -= 직업              ; = 직업 * 15
 *   0x548C3  dh = [eax + 0x31AC]      ; ★ 0x731AC + 직업*15  (fixup +0x70000)
 *   0x548C9  cmp dh, 1  ; jne 0x548D6
 *   0x548CE  cmp dh, [0x4A84E] ; jge 0x548E3   ; ★ 탈것 UI 를 띄운다
 *   0x548D6  cmp [0x4A84E], 4  ; jl  0x549DC   ;   또는 맵 수준 4 이상
 *   ```
 *   실측 `[+0] == 1` 인 직업: **0~5 · 15~17 · 19 · 20 · 23** (그 밖은 0).
 *   `[0x4A84E]` 는 `.SCE 0x06` 이다 (`0x4ED60` 대역의 읽기 순서로 확정).
 *
 * @returns {number[]} 직업별 `[+0]` (탈것 가능 = 1)
 */
function jobRideFlags(leImg) {
  var img = leImg.img, BASE = leImg.base, out = [];
  var p0 = 0x731AC - BASE;
  if (p0 < 0) return out;
  for (var i = 0; i < 64; i++) {
    var o = p0 + i * 15;
    if (o >= img.length) break;
    out.push(img[o] | 0);
  }
  return out;
}

/**
 * ★ 탈것 프레임 표 `0x75496` (u16 × 18) — `0x54950`.
 *   `프레임 = u16[X*3 + 종류 + 1] + 6` · `X = 수준>=4 ? 수준−3 : 0`
 *   (원본이 32비트로 읽고 `sar 16` 하므로 **한 칸 뒤**의 u16 이 값이다)
 *   실측: 0,0,1,2,-1,3,2,4,5,2,-1,6,7,1,2,5,0,0x31
 */
function vehicleFrames(leImg) {
  var img = leImg.img, BASE = leImg.base, out = [];
  var p0 = 0x75496 - BASE;
  if (p0 < 0) return out;
  for (var i = 0; i < 18; i++) out.push(img[p0 + i * 2] | (img[p0 + i * 2 + 1] << 8));
  return out;
}

/**
 * ★ 탈것 가격표 `0x754C8` (u32 × 12) — `0x55022`·`0x55038`.
 *   `값 = u32[행*3 + 종류]`
 *   실측 행0 **100 · 150 · 500** · 행1 0/100/500 · 행2 100/200/500 · 행3 0/200/500
 *
 * ★★★★★ **행을 고르는 두 전역이 확정됐다** (2026-09-02 · `0x55010`~`0x5503D`)
 *   ☠ 전에는 「`행 = 수준>=4 ? 수준−4 : 0`」이라고만 적고 **그 「수준」이 어느 값인지**를
 *     안 달았다(`CLAUDE.md` §2-1 — 주소 없는 값은 미완성이다).
 *   ```asm
 *   0x55010  **bh = [0xBA84E]**            ; ★ **전투 종류** (turn.js 시각올리기 와 같은 칸)
 *   0x5501D  **cmp bh, 4 / jge 0x55029**   ; ★ 종류 **4 미만이면**
 *   0x55022    ebp = 0x754C8               ;   **무조건 행 0**
 *   0x55029  ── 종류 4 이상 ──
 *   0x5502F  **edx = [0xBA84B] ; sar edx, 0x18**   ; ★ **수준** = 그 칸의 **최상위 바이트**
 *   0x55032  **sub edx, 4** ; 0x55035 **imul edx, 0xC(12)**   ; (수준 − 4) × 12 B = 3 칸
 *   0x5503D  ebp = 0x754C8 + edx
 *   ```
 *   ⇒ **가르는 것은 `[0xBA84E]`(전투 종류)** 이고, **행을 잡는 것은 `[0xBA84B]>>24`(수준)** 다.
 *   ★ 그 셋은 한 덩이다 — `[0xBA84B]` 수준 · `[0xBA84D]` 날씨 · `[0xBA84E]` 전투 종류.
 *   ✅ **교차 확인** — `00_누락기능_목록.md:53` 이 **2026-08-31 에 이미**
 *     「수준은 `[0xBA84B] sar 24`」로 확정해 두었다(같은 대역의 총액 `0xFE36F` ·
 *     코드표 `0x754AE` 와 **같은 4×3 구조**). ⇒ **서로 다른 길로 같은 답**이 나왔다.
 *   ☐ 행을 고르는 코드는 **아직 안 넣었다** — 배치 화면 UI 가 없어 쓸 곳이 없다
 *     (`SCE_배치마스크.md` §6-6). 이 함수는 **12 칸을 통째로** 돌려준다.
 */
function vehiclePrices(leImg) {
  var img = leImg.img, BASE = leImg.base, out = [];
  var p0 = 0x754C8 - BASE;
  if (p0 < 0) return out;
  for (var i = 0; i < 12; i++) {
    var o = p0 + i * 4;
    out.push((img[o] | (img[o+1] << 8) | (img[o+2] << 16) | (img[o+3] << 24)) >>> 0);
  }
  return out;
}

/**
 * ★★★★★ **탑승자 RCR 표** — `0x706D4`(말 ≤4) · `0x70896`(비룡 5~6) (2026-08-25)
 *
 *   사용자 지적: 「탈것 선택이 되고 잘 나오는데, **탑승이미지가 아닌 말 이미지로 나와**」
 *
 *   원본 `0x11B77` 이 탑승자의 덧그릴 그림 번호를 고른다:
 *   ```asm
 *   0x11B79  edx = [eax+0x77]          ; 탑승자 레코드
 *   0x11B7C  bl  = [eax+0x5C]          ; 탈것 코드
 *   0x11B7F  dx  = [edx+0x61]          ; ★ 탑승자의 **스프라이트 번호**
 *   0x11B83  cmp bl,4 / ja  → ≤4  : ax = u16[0x6D4 + spr*2]     (말 계열)
 *   0x11B95  cmp bl,6 / jbe → 5~6 : ax = u16[0x896 + spr*2]     (비룡)
 *   0x11B9A                  ≥7   : 0 = **안 그린다**(마장기는 통짜)
 *   0x11BAA  eax += 0x1F4 (500)        ; ★ **+500** 이 실제 RCR 번호
 *   ```
 *   ★ 표 주소는 데이터 fixup 을 받아 `disp + 0x70000` 이다.
 *   ★ `0xFFFF` 는 **없음**(그 스프라이트는 탈것에 못 탄다).
 *   두 표의 간격이 `0x1C2`(450 B) = **225 항목**이라 그만큼 읽는다.
 */
var RIDER_RCR = { 말: 0x706D4, 비룡: 0x70896, N: 225, 더하기: 500 };
function riderRcrTables(leImg) {
  var img = leImg.img, BASE = leImg.base;
  function 한표(base) {
    var out = [], p0 = base - BASE;
    if (p0 < 0) return out;
    for (var i = 0; i < RIDER_RCR.N; i++) {
      var o = p0 + i * 2;
      if (o + 2 > img.length) break;
      var v = img[o] | (img[o + 1] << 8);
      out.push(v === 0xFFFF ? null : v);          /* 0xFFFF = 없음 */
    }
    return out;
  }
  return { 말: 한표(RIDER_RCR.말), 비룡: 한표(RIDER_RCR.비룡) };
}
/** 탈것 코드·탑승자 스프라이트 번호 → 덧그릴 RCR 번호 (없으면 null). `0x11B77` */
/* ★ [리마스터] 탑승 그림 «캐릭터» 지정 — 원본 표 값보다 앞선다 (2026-10-12)
 *   사장님(원문) 「… 카심은 RDARK DDARK로 연결해줘. … 특별히 지정하는경우만 다크아머로 해줘.」
 *   카심(115 · KASHIM 203)은 원본 표가 말·비룡 둘 다 RSILVER(말 위 그림)라 비룡에서 깨졌다. */
var 탑승캐릭터지정 = {
  115: { 말: 502, 비룡: 549 }      /* 카심 — RDARK · DDARK */
};
/* ★ [리마스터] 원본 표에 없는 보행 그림의 대체 — 성별로 실버애로우 (2026-10-12)
 *   사장님(원문) 「메이와 리젤의 경우 여성 글래디에이터 스프라이트인데, 말이나 비룡을 타면 이미지가 깨져. RSILVERW DSILVERW로 연결해줘.
 *    선장도 깨지는데, 선장은 RSILVER, DSILVER로 … 여성은 실버애로우여성으로, 남성은 실버애로우남성으로」
 *   번호: RSILVER 500 · RSILVERW 501 · DSILVER 547 · DSILVERW 548 (spriteNames 실측) */
var 탑승대체 = { 남: { 말: 500, 비룡: 547 }, 여: { 말: 501, 비룡: 548 } };

/**
 * 탑승자 덧그림 번호 — 원본 0x11B77 + 리마스터 순서 (2026-10-12)
 *   ① 리마스터 그림 지정(리마스터_탑승 · HGS 1101 → 말 576 RHGS · 비룡 551 DGS1)
 *   ② 캐릭터 지정(탑승캐릭터지정 · 카심)  ③ 원본 표(0x706D4 말 · 0x70896 비룡 · +500)
 *   ④ 표에 없으면 성별 대체(탑승대체 · race 1 = 여)
 *   ☠ ①의 표·함수(리마스터탑승)는 만들어 놓고 아무도 안 불러 HGS 말 그림이 안 나왔다 (사장님 「현재 말도 적용 안돼」)
 * @param 옵션 `{race, charCode}` — 없으면 ①③ 만(옛 동작)
 */
function riderRcrOf(tables, 탈것코드, 탑승자spr, 옵션) {
  var c = 탈것코드 | 0, spr = 탑승자spr | 0;
  if (c < 1 || c > 6) return null;                  /* 0x11B9A — 마장기(7~)는 안 그린다 */
  var 말 = c <= 4;
  var 리 = 리마스터_탑승[spr];                       /* ① */
  if (리) return 말 ? 리.말 : 리.비룡;
  var 지정 = 옵션 && 탑승캐릭터지정[옵션.charCode | 0];   /* ② */
  if (지정) return 말 ? 지정.말 : 지정.비룡;
  var t = tables ? (말 ? tables.말 : tables.비룡) : null;
  var v = t ? t[spr] : null;                        /* ③ */
  if (v != null) return v + RIDER_RCR.더하기;       /* 0x11BAA +500 */
  if (!옵션) return null;
  var 쪽 = ((옵션.race | 0) === 1) ? 탑승대체.여 : 탑승대체.남;   /* ④ */
  return 말 ? 쪽.말 : 쪽.비룡;
}

/**
 * ★★★★★ **탈것 슬롯 → 실제 탈것 코드** — `0x754AE` (2026-08-25)
 *
 *   사용자: 「비룡도 탑승 이미지랑 발자국 확인해줘」
 *
 *   배치 화면의 슬롯은 **0·1·2** 세 개이고(`0x549D2 cmp ax,3`), 목록 항목의
 *   `[+0x5C]` 에는 `슬롯+1`(= **1·2·3**)이 들어간다(`0x55077 inc`).
 *   그런데 **탑승할 때 표로 한 번 더 변환**한다:
 *   ```asm
 *   0x55286  bl = [0x4A84E]                 ; 탈것 수준
 *   0x5528C  cmp bl, 4 / jge 0x552AA
 *   0x55291  dl = [edi+0x5C]                ; 1~3
 *   0x55296  dl = [edx*2 + 0x754AE]         ; ★ 변환 (수준 < 4 → 행 0)
 *   0x55329~ (수준 >= 4)  dl = [탈것값*2 + (수준-3)*6 + 0x754AE]
 *   0x55351  call 0x17E6D                   ; mount(eax = 유닛, edx = **코드**)
 *   ```
 *   실측 표(u16):
 *   ```
 *   행0 (수준 < 4) : [1]=1  [2]=2  [3]=5
 *   행1 (수준 4)   : [1]=0  [2]=49 [3]=32
 *   행2 (수준 5)   : [1]=51 [2]=53 [3]=32
 *   행3 (수준 6)   : [1]=0  [2]=58 [3]=?
 *   ```
 *   ⇒ **세 번째 슬롯은 코드 3 이 아니라 5** 다.
 *     스프라이트는 `코드 + 299`(`0x17E81`)이므로
 *     `300 HORSE1 · 301 HORSE2 · 302 HORSE3 · 303 HORSE4 · **304 WYV-A** · 305 WYV-D`
 *     — 곧 **비룡은 304**, 우리가 쓰던 302 는 `HORSE3`(말)였다.
 *   ★ 수준 ≥4 의 큰 값(32·49·51·53·58)은 **마장기**다.
 */
function vehicleCodeTable(leImg) {
  var img = leImg.img, BASE = leImg.base, out = [];
  var p0 = 0x754AE - BASE;
  if (p0 < 0) return out;
  for (var i = 0; i < 24; i++) {
    var o = p0 + i * 2;
    if (o + 2 > img.length) break;
    out.push(img[o] | (img[o + 1] << 8));
  }
  return out;
}
/** 슬롯값(`[+0x5C]` = 1~3)과 탈것 수준 → 실제 탈것 코드. `0x55296` · `0x55342` */
function vehicleCodeOf(tbl, 수준, 슬롯값) {
  var v = 슬롯값 | 0;
  if (!tbl || !tbl.length || v <= 0) return v;
  var 행 = ((수준 | 0) >= 4) ? ((수준 | 0) - 3) : 0;      /* 0x5528C */
  var idx = 행 * 3 + v;                                   /* u16 인덱스 */
  var c = tbl[idx];
  return (c == null) ? v : (c | 0);
}

function spriteNames(leImg) {
  var img = leImg.img, BASE = leImg.base, out = [];
  for (var t = 0; t < SPRTBL.length; t++) {
    var T = SPRTBL[t], p0 = T.base - BASE;
    if (p0 < 0 || p0 + T.n * 4 > img.length) continue;
    for (var i = 0; i < T.n; i++) {
      var va = img[p0 + i * 4] | (img[p0 + i * 4 + 1] << 8) | (img[p0 + i * 4 + 2] << 16) | (img[p0 + i * 4 + 3] << 24);
      var o = (va >>> 0) - BASE; if (o < 0 || o >= img.length) continue;
      var s = ''; while (o < img.length && img[o]) s += String.fromCharCode(img[o++]);
      if (s) out[T.첫번호 + i] = s;
    }
  }
  /* 리마스터 전용 대역을 얹는다 — 원본 표를 건드리지 않는다 */
  for (var 번호 in 리마스터_스프라이트) out[번호 | 0] = 리마스터_스프라이트[번호];
  /* 3급 마장기 조종사 901~ (PM 묶음 3 × 캐릭터 수) */
  for (var 묶 = 0; 묶 < 3; 묶++)
    for (var ci = 0; ci < PM_캐릭터.length; ci++)
      /* `대역_PM`(901)부터 PM 묶음 3 × 캐릭터 수가 이어진다. */
      out[대역_PM + 묶 * PM_캐릭터.length + ci] = 'PM' + 묶 + PM파일키(묶, PM_캐릭터[ci]) + '.MCR';
  return out;
}

/** 번호 → 파일명 표의 인덱스. **이제 번호가 곧 색인이다** (표를 직접 읽으므로). */
function spriteIndexOf(no) { return no | 0; }


/* ══════════════════════════════════════════════════════════════════
 *  ★★★★★ **CHP.EXE 안에 박힌 8×8 비트맵 글꼴** (2026-08-21 원본 확정)
 *
 *  월드맵의 **날짜판 숫자 · 하단 「N Days Remain」 · town** 을 그리는 글꼴이다.
 *  지점 이름을 그리는 `FONT.SPR`(0x18047 · 알파벳 전용)과 **완전히 다르다.**
 *
 *  ★ 헛짚은 기록: 처음에 「날짜판 = 0x17F88 → 0x18047」이라 적었는데 **틀렸다.**
 *    실제로는 `0x17FA7 call 0x17FB2` 다. `call` 목적지를 계산하지 않고 짐작했다.
 *    ★ 그리고 `0x18047` 은 `0x18075 cmp dl,'A' / jb 0x180D4` 로 **숫자를 건너뛴다** —
 *      그 함수로는 날짜를 애초에 못 그린다.
 *
 *  경로 (CHP.EXE · x86dis 미적용 주소):
 *    0x17F88(eax=x, edx=y, ebx=값)  숫자 그리기
 *      0x17F9A  call 0x3A3EC              ; itoa(값, 버퍼, 10)
 *      0x17FA7  call 0x17FB2              ; ★ 문자열 출력
 *    0x17FB2(eax=x, edx=y, ebx=문자열)
 *      0x17FB2  mov [0x4C4FE],ax          ; 커서 x
 *      0x17FB8  mov [0x4C500],dx          ; 커서 y
 *      0x17FD8  call 0x17E6A              ; 한 글자
 *    0x17E6A(al = 글자)
 *      0x17E79  sub dl,0x20               ; ★ 코드 − 32
 *      0x17E96  shl eax,3 / add eax,행
 *      0x17EA0  mov al,[eax + 0xAB1C]     ; ★★★ **글꼴 표** (글자당 8바이트)
 *      0x17EAF  test eax,ebx              ; bl = 0x80 부터 비트 검사
 *      0x17EE0  mov bl,[0xAE1D]           ; ★ **글자 색**
 *      0x17F22  mov bl,[0xAE1C]           ; ★ 그림자 색 ([0x4C502]==1 일 때만)
 *      0x17EC8  cmp eax,0x13C(316)        ; 화면 범위
 *    폭: 0x17FED  mov dl,[edx + 0xAA9C]   ; ★ **뺄셈 없이 코드 그대로**
 *
 *  ★ fixup 적용 주소는 +0x50000 (`0x5AA9C` · `0x5AB1C` · `0x5AE1C/D`).
 *  ★ 실측 (EXE 안에 **데이터가 그대로 있다** — BSS 아님):
 *      폭 표  0x5AA9C + 코드      ('0'~'9' = 6 · 'I'/'i' = 2 · ' ' = 6)
 *      글꼴   0x5AB1C ~ 0x5AE1B   (95자 × 8B = 760B · 코드 0x20~0x7E)
 *      그림자색 [0x5AE1C] = 0 · **글자색 [0x5AE1D] = 1**
 *    글자 모양은 실제로 **5행 5열**만 쓴다(아래 3행은 0).
 * ══════════════════════════════════════════════════════════════════ */
var EXE글꼴 = { 폭표: 0x5AA9C, 글꼴: 0x5AB1C, 그림자색: 0x5AE1C, 글자색: 0x5AE1D,
                첫코드: 0x20, 끝코드: 0x7E };

/** CHP.EXE(LE) 에서 8×8 글꼴을 뽑는다. `le` 는 `decodeLE` 결과. */
function decodeExeFont8(le) {
  var img = le.image || le.img || le, BASE = (le.base != null) ? le.base : 0x10000;
  var 폭 = [], 비트 = [];
  for (var c = 0; c <= 0xFF; c++) 폭[c] = img[EXE글꼴.폭표 - BASE + c] | 0;
  for (var k = EXE글꼴.첫코드; k <= EXE글꼴.끝코드; k++) {
    var o = EXE글꼴.글꼴 - BASE + (k - EXE글꼴.첫코드) * 8;
    var r = []; for (var i = 0; i < 8; i++) r.push(img[o + i] | 0);
    비트[k] = r;
  }
  return { 폭: 폭, 비트: 비트,
           그림자색: img[EXE글꼴.그림자색 - BASE] | 0,
           글자색: img[EXE글꼴.글자색 - BASE] | 0 };
}

/**
 * ★★★★★ **직업명 표** — `CHP.EXE` 안에 박힌 164개 (2026-08-22 확정)
 *
 * ```asm
 * 0x30232  mov bl, [esi + 0x548C9]   ; 캐릭터 레코드 +0x11 = 직업
 * 0x30238  shl ebx, 4                ; ★ 항목 **16 B**
 * 0x3023B  add ebx, 0x38788          ; ★ 표 (fixup 미적용) ⇒ 실제 **0x88788**
 * 0x30244  mov edi,ebx / repne scasb ; 길이 재기(중앙정렬용)
 * 0x30268  call 0x17FB2              ; ② EXE 내장 8×8 로 그린다
 * ```
 *
 * ★ `0x38788` 은 **fixup 미적용 값**이다 — obj2 이므로 `+0x50000`.
 *   그대로 읽으면 코드 영역이 나와 쓰레기가 보인다(실제로 그랬다).
 * ★ 164 개까지가 이름이고 그 뒤는 다른 표(포인터)다.
 *   근거: `jobchange.js` 의 직업표8 도 `[164]` 다.
 *
 * @param le `decodeLE` 결과
 * @returns `string[164]`
 */
function decodeJobNames(le) {
  var img = le.image || le.img || le, BASE = (le.base != null) ? le.base : 0x10000;
  var T = 0x88788 - BASE, 것 = [];
  for (var i = 0; i < 164; i++) {
    var o = T + i * 16, s = '';
    for (var k = 0; k < 16 && img[o + k]; k++) s += String.fromCharCode(img[o + k]);
    것.push(s);
  }
  /* ★ [리마스터] 추가 직업 이름 (extjob · 201~) */
  return (typeof G2ExtJob !== 'undefined' && G2ExtJob.이름채우기) ? G2ExtJob.이름채우기(것) : 것;
}

/** 글꼴로 문자열 폭을 잰다 — `CHP.EXE 0x17FE0` (`[코드 + 0xAA9C]` 누적). */
function exeFontWidth(f, s) {
  var w = 0; for (var i = 0; i < s.length; i++) w += f.폭[s.charCodeAt(i) & 0xFF] | 0;
  return w;
}

/**
 * 글꼴을 캔버스에 그린다 — `CHP.EXE 0x17FB2` + `0x17E6A`.
 * `팔` 은 팔레트(`[r,g,b] × 256`), 없으면 흰색으로 그린다.
 * ★ 원본과 같이 **왼쪽 위 기준**이고 커서가 폭만큼 나아간다.
 */
/**
 * ★★★ 색 인덱스는 **원본이 `0x1802C` 로 정한다** — `[0xAE1D]` 에 팔레트 인덱스를 넣는다.
 *   CHP 화면 실측: `HP:` **27** · `MP:` **33** · `LV: EXP:` **17** · 숫자 **1**
 *   (`0x2EBDB`·`0x2EBFB`·`0x2EC1C`·`0x2EC3C` — STATUS,
 *    `0x30793`·`0x307B1`·`0x307CF`·`0x307E3` — EQUIPMENT. **같은 색이다**)
 * @param 색인 팔레트 인덱스. 없으면 `f.글자색`
 */
function exeFontToCanvas(f, s, 팔, 색인) {
  var w = exeFontWidth(f, s) || 1, h = 8;
  var cv = (typeof document !== 'undefined') ? document.createElement('canvas') : null;
  if (!cv) return null;
  cv.width = w; cv.height = h;
  var ctx = cv.getContext('2d'), im = ctx.createImageData(w, h);
  var ci = (색인 != null) ? (색인 | 0) : (f.글자색 | 0);
  var r = 255, g = 255, b = 255;
  /* ★ 팔레트는 `[[r,g,b],…]` 또는 평탄 `Uint8Array(768)` 둘 다 온다 */
  if (팔) {
    if (팔[ci] && 팔[ci].length >= 3) { r = 팔[ci][0]; g = 팔[ci][1]; b = 팔[ci][2]; }
    else if (팔.length >= 768) { r = 팔[ci*3]; g = 팔[ci*3+1]; b = 팔[ci*3+2]; }
  }
  var x = 0;
  for (var i = 0; i < s.length; i++) {
    var code = s.charCodeAt(i) & 0xFF;
    var rows = f.비트[code];
    if (rows) {
      for (var y = 0; y < 8; y++) {
        var v = rows[y] | 0;
        for (var k = 0; k < 8; k++) {
          if (!(v & (0x80 >> k))) continue;
          var px = x + k; if (px < 0 || px >= w) continue;
          var q = (y * w + px) * 4;
          im.data[q] = r; im.data[q + 1] = g; im.data[q + 2] = b; im.data[q + 3] = 255;
        }
      }
    }
    x += f.폭[code] | 0;
  }
  /* ★ Z-44 글자도 필터 — 소비처는 논리 크기로 그린다(`논리그리기` · 9인자 실제폭) */
  if (root.G2Scaler && root.G2Scaler.N && root.G2Scaler.N() > 1 && root.G2Scaler.toCanvas)
    return root.G2Scaler.toCanvas(im);
  ctx.putImageData(im, 0, 0);
  cv.논리w = w; cv.논리h = h;
  return cv;
}


/* ══════════════════════════════════════════════════════════════════
 *  ★★★★★ **NEWASCII.FNT 8×16 글꼴로 문자열 그리기** (2026-08-21 확정)
 *
 *  월드맵 하단 「N Days Remain」의 **남은 일수 숫자**를 그리는 글꼴이다.
 *  CHP.EXE 의 **세 번째** 글꼴계다 (지점 이름 `FONT.SPR` · 날짜판 EXE 내장 8×8 과 별개).
 *
 *  로더 `CHP.EXE 0x2CD20`~`0x2CD8F` — 크기 검산이 **정확히** 맞는다:
 *    0x2CD21  mov edx,0xC27B4 / call 0x39A60      ; open  NEWHAN.FNT
 *    0x2CD31  mov ebx,0x1400(5120) → 0xC27B4      ;   초성 5120
 *    0x2CD3D  mov edx,0xC3BB4 / ebx,0xB00(2816)   ;   중성 2816
 *    0x2CD4E  mov edx,0xC46B4 / ebx,0xE00(3584)   ;   종성 3584   (합 **11,520** = 파일 크기)
 *    0x2CD61  close
 *    0x2CD6C  mov edx,0xC54B4 / call 0x39A60      ; open  NEWASCII.FNT
 *    0x2CD7C  mov ebx,0x1000(4096) → 0xC54B4      ;   **4096** = 256글자 × 16 B = 파일 크기
 *
 *  쓰는 곳 `0x2CFED`:
 *    0x2D026  cmp al,0x7F / jbe 0x2D203           ; ASCII 는 여기, 초과는 조합형 한글
 *    0x2D275  mov edx,0xC54B4 / 0x2D27A shl eax,4 ; ★ 코드 × 16
 *    0x2D27D  mov ebx,0x10(16)                    ;   높이 16
 * ══════════════════════════════════════════════════════════════════ */
function newasciiToCanvas(glyphs, s, rgb) {
  if (typeof document === "undefined" || !glyphs || !s) return null;
  var w = s.length * 8, h = 16;
  var cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  var ctx = cv.getContext("2d"), im = ctx.createImageData(w, h);
  var r = rgb ? rgb[0] : 255, g = rgb ? rgb[1] : 255, b = rgb ? rgb[2] : 255;
  for (var i = 0; i < s.length; i++) {
    var gl = glyphs[s.charCodeAt(i) & 0xFF];
    if (!gl) continue;
    for (var y = 0; y < 16; y++) {
      var v = gl.rows[y] | 0;
      for (var k = 0; k < 8; k++) {
        if (!(v & (0x80 >> k))) continue;
        var q = (y * w + i * 8 + k) * 4;
        im.data[q] = r; im.data[q + 1] = g; im.data[q + 2] = b; im.data[q + 3] = 255;
      }
    }
  }
  /* ★ Z-44 글자도 필터 — 소비처는 논리 크기로 그린다(`논리그리기` · 9인자 실제폭) */
  if (root.G2Scaler && root.G2Scaler.N && root.G2Scaler.N() > 1 && root.G2Scaler.toCanvas)
    return root.G2Scaler.toCanvas(im);
  ctx.putImageData(im, 0, 0);
  cv.논리w = w; cv.논리h = h;
  return cv;
}
/* ── 내보내기 ────────────────────────────────────────────────────────── */

/* ══════════════════════════════════════════════════════════════════
 *  ★★★ **EXE 안에 박힌 그림** — `CHP.EXE 0x1D874` 형식 (2026-08-20)
 *
 *  월드맵 **맵 이름 장식 박스**는 파일이 아니라 **EXE 안**에 있다:
 *    0x1FC5D  맵 이름 그리기 함수
 *      0x1FC61  mov eax, 0x34      ; x = 52
 *      0x1FC66  mov ebx, 0x309A4   ; ★ 그림 (fixup 적용본 0x809A4)
 *      0x1FC71  mov edx, eax       ; y = 52
 *      0x1FC73  call 0x1D874       ; 그린다
 *
 *  형식 (`0x1D8B5`~`0x1D8CF` 직독):
 *    word  줄수
 *    줄마다: dword { 하위 word = skip · al = dword 수 · ah = 나머지 바이트 수 }
 *            그 뒤 (dword수*4 + 나머지) 바이트가 **팔레트 인덱스 픽셀**
 *
 *  ★★★ `skip` 은 **화면 포인터의 누적 이동**이다 (`0x1D8C1 add edi, ebx`).
 *    줄마다 초기화하지 않으므로 **줄바꿈까지 포함**된 값이다.
 *    그래서 320 폭 화면 버퍼에 그대로 그려야 그림이 나온다
 *    (폭 320 은 `0x1D898 shl ecx,8` + `0x1D89D shr ecx,2`).
 *
 *  ★ 실측: `0x809A4` → 62줄 · x 52~259 · y 52~81 (폭 208 · 높이 30).
 *    원본 화면에서 잰 보라 바탕 y 59~77 과 맞는다.
 * ══════════════════════════════════════════════════════════════════ */
function decodeExeSprite(le, va, x, y) {
  var img = le.image || le.img || le, BASE = (le.base != null) ? le.base : 0x10000;
  var W = 320, H = 200;
  var o = va - BASE;
  var 줄수 = img[o] | (img[o + 1] << 8); o += 2;
  var buf = new Uint8Array(W * H);
  /* ★★★★★ **칠한 자리 마스크** — 색 0(검정)과 「안 칠함」을 구분한다.
   *   CLAUDE.md 경고 그대로다: 원본은 **기록 안 된 픽셀만 투명**이고
   *   값 0 으로 칠한 픽셀은 **불투명한 검정**이다.
   *   ★ 이것이 없어서 소지금 박스(`0x2E0D2`)의 **검은 배경이 통째로 사라졌다**
   *     (사용자 지적 2026-08-21: 「돈 표시되는 박스 뒤에 검정색 배경도 없고」). */
  var 칠 = new Uint8Array(W * H);
  var pos = (y | 0) * W + (x | 0);
  var x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
  for (var i = 0; i < 줄수; i++) {
    if (o + 4 > img.length) break;
    var skip = img[o] | (img[o + 1] << 8);
    var dwn = img[o + 2], byn = img[o + 3];
    o += 4;
    var len = dwn * 4 + byn;
    pos += skip;
    for (var k = 0; k < len; k++) {
      var q = pos + k;
      if (q >= 0 && q < buf.length) {
        buf[q] = img[o + k];
        칠[q] = 1;
        var px = q % W, py = (q / W) | 0;
        if (px < x0) x0 = px;
        if (px > x1) x1 = px;
        if (py < y0) y0 = py;
        if (py > y1) y1 = py;
      }
    }
    o += len; pos += len;
  }
  if (y0 === 1e9) { y0 = 0; x0 = 0; }
  return { w: W, h: H, px: buf, 칠: 칠, x0: x0, y0: y0, x1: x1, y1: y1, 줄수: 줄수 };
}

/**
 * `decodeExeSprite` 결과에서 **칠한 부분만** 캔버스로.
 *
 * ★★★ 투명 판정은 **마스크**(`r.칠`)로 한다 — 색 0 은 **검정**이지 투명이 아니다.
 *   마스크가 없는 옛 결과에는 종전대로 `!v` 를 쓴다(하위 호환).
 */
function exeSpriteToCanvas(r, pal) {
  var w = r.x1 - r.x0 + 1, h = r.y1 - r.y0 + 1;
  if (w <= 0 || h <= 0 || typeof document === 'undefined') return null;
  var cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  var ctx = cv.getContext('2d'), im = ctx.createImageData(w, h), d = im.data;
  for (var yy = 0; yy < h; yy++) for (var xx = 0; xx < w; xx++) {
    var q2 = (yy + r.y0) * r.w + (xx + r.x0);
    var v = r.px[q2], i = (yy * w + xx) * 4;
    var 칠했나 = r.칠 ? !!r.칠[q2] : !!v;
    if (!칠했나) { d[i + 3] = 0; continue; }
    d[i] = pal[v * 3]; d[i + 1] = pal[v * 3 + 1]; d[i + 2] = pal[v * 3 + 2]; d[i + 3] = 255;
  }
  /* ★ 2026-09-24 (Z-40 「스케일러 관련 모든 요소」) EXE 안 그림(월드 성·방패·맵이름 상자·
   *   옵션 단추·대사 장식)도 필터를 탄다. 그리는 쪽은 전부 `논리w`/`논리h` 로 눌러 담는다
   *   (`게임.html 논리그리기` · 월드 마커 9인자 drawImage). ☠ 전에는 1배라 이 그림만 도트였다. */
  if (root.G2Scaler && root.G2Scaler.N && root.G2Scaler.N() > 1 && root.G2Scaler.toCanvas) {
    var up = root.G2Scaler.toCanvas(im);
    up.칠한x = r.x0; up.칠한y = r.y0;
    return up;
  }
  ctx.putImageData(im, 0, 0);
  cv.논리w = w; cv.논리h = h; cv.칠한x = r.x0; cv.칠한y = r.y0;
  return cv;
}

var 캔세대 = { n: 0, 걸림: false };   /* frameToCanvas캐시 — 스케일러가 바뀌면(onChange) n 이 올라 옛 캔버스를 버린다 (정본 349) */
var G2Native = {
  isSprite: isSprite, spriteFrameCount: spriteFrameCount,
  parseNC2: parseNC2,   /* [11-09] 설치엔진.js 가 프레임 몸통 자리를 찾아 색 바꿈표를 입힌다 */
  decodeNC2: decodeNC2, decodeNC2SwingMeta: decodeNC2SwingMeta, decodeSPR: decodeSPR, decodeCitizen: decodeCitizen, decodeExeRaw: decodeExeRaw, decodeNSP: decodeNSP, decodeSYB: decodeSYB, decodeShadow: decodeShadow, frameToImageData: frameToImageData,
  /* 탈것 갑옷 색인 리맵 — HD 굽기 툴이 같은 표를 공유한다 (`탈것_갑옷색_리맵.md`) */
  색인리맵: 색인리맵, 색인리맵표: 색인리맵표,
  색인리맵켬: function (v) { if (v !== undefined) 색인리맵켬 = !!v; return 색인리맵켬; },
  /** 프레임 → 캔버스. 스케일러가 켜져 있으면 N배로 굽고 `.논리w/논리h` 에 원래 크기를 남긴다.
   *  배치 좌표는 언제나 논리 크기를 쓰므로 호출부는 `.논리w/논리h` 만 보면 된다. */
  frameToCanvas: function (fr, palette) {
    var c = document.createElement('canvas');
    c.width = fr.w; c.height = fr.h;
    /* ★ 2026-09-25 CPU 캔버스(willReadFrequently) — 이 그림은 곧 PNG(toDataURL)로 구워진다. GPU 캔버스는 되읽기가 한 장 1.5~4ms 라
     *   팔레트가 바뀔 때마다(Z-47) 유닛·그림자만 26ms 를 먹었다. CPU 캔버스는 0.08ms (크롬 실측 39×37) · 픽셀은 같다 */
    var g = c.getContext('2d', { willReadFrequently: true });
    var im = frameToImageData(g, fr, palette);
    if (root.G2Scaler && root.G2Scaler.N() > 1) return root.G2Scaler.toCanvas(im);
    g.putImageData(im, 0, 0);
    c.논리w = fr.w; c.논리h = fr.h;
    return c;
  },
  /** frameToCanvas 를 프레임에 붙여 둔다 — 같은 팔레트·같은 스케일러면 지난 캔버스 (정본 349)
   *  마을은 인물·오브젝트를 장마다 새로 굽고 xBRZ 를 돌려 아이패드에서 장마다 약 34ms 를 먹었다.
   *  ★ 돌려받은 캔버스에 그리지 않는 곳(그리기 원본으로만 쓰는 곳)에서만 쓴다. */
  frameToCanvas캐시: function (fr, palette) {
    var SC = root.G2Scaler;
    if (SC && SC.onChange && !캔세대.걸림) { 캔세대.걸림 = true; SC.onChange(function () { 캔세대.n++; }); }
    var 키 = 캔세대.n + '|' + (SC ? SC.cur() + '|' + SC.N() : '-'), 옛 = fr && fr.__캔;
    if (옛 && 옛.팔 === palette && 옛.키 === 키) return 옛.cv;
    var cv = this.frameToCanvas(fr, palette);
    try { fr.__캔 = { 팔: palette, 키: 키, cv: cv }; } catch (e) {}
    return cv;
  },
  decodeRPL: decodeRPL, rplPalette: rplPalette,   /* .RPL 팔레트 애니메이션 (0x20021 · 0x602E3) */
  decodeFPM: decodeFPM,
  mapEffectFrames: mapEffectFrames,
  날씨팔레트: 날씨팔레트, 전투팔레트: 전투팔레트,   /* 날씨별 팔레트 변환 (0x12824C 실측) */
  decodeMAP: decodeMAP, mapGround: mapGround, mapObjects: mapObjects, mapTerrain: mapTerrain,
  blockKey: blockKey,
  decodeLE: decodeLE, decodeExeSprite: decodeExeSprite,
  decodeExeFont8: decodeExeFont8, decodeJobNames: decodeJobNames, decodeExeSprite: decodeExeSprite, exeFontWidth: exeFontWidth, exeFontToCanvas: exeFontToCanvas, EXE글꼴: EXE글꼴, exeSpriteToCanvas: exeSpriteToCanvas, spriteNames: spriteNames, jobNames: jobNames, jobRideFlags: jobRideFlags, vehicleFrames: vehicleFrames, vehiclePrices: vehiclePrices, vehicleCodeTable: vehicleCodeTable, vehicleCodeOf: vehicleCodeOf, riderRcrTables: riderRcrTables, riderRcrOf: riderRcrOf, RIDER_RCR: RIDER_RCR, spriteIndexOf: spriteIndexOf, SPRTBL: SPRTBL,
  리마스터탑승: 리마스터탑승, 리마스터_스프라이트: 리마스터_스프라이트, 여성판조형: 여성판조형, 여성판_규칙: 여성판_규칙, 여성판룩업: 여성판룩업, 램프옮긴사본: 램프옮긴사본,
  PM조종사: PM조종사, PM묶음: PM묶음, PM_대응: PM_대응, PM_캐릭터: PM_캐릭터,
  /** 디코드된 프레임들 → 지연 캔버스 공급자 fn(n) → {canvas,ax,ay,w,h}. (포트레이트·UI 등) */
  spriteCanvasProvider: function (frames, palette) {
    var cache = {}, cacheN = 1;
    return function (n) {
      if (n < 0 || n >= frames.length) return null;
      /* ★ 스케일러 배율이 바뀌면 캐시를 통째로 버린다 — 클로저 안이라
       *   밖에서 비울 수 없어, 옛 배율 캔버스가 그대로 남던 자리다. */
      var N = (root.G2Scaler && root.G2Scaler.N()) || 1;
      if (N !== cacheN) { cache = {}; cacheN = N; }
      if (cache[n]) return cache[n];
      var fr = frames[n], c = G2Native.frameToCanvas(fr, palette);
      /* w·h 는 **논리(원본) 크기** — drawImage 목적지 크기로 그대로 쓴다. */
      return (cache[n] = { canvas: c, ax: fr.ax, ay: fr.ay, w: fr.w, h: fr.h });
    };
  },
  Provider: Provider,
  decodeSound: decodeSound, SND_HEADER: SND_HEADER, SND_RATE: SND_RATE,
  decodePalette: decodePalette, mixPalette: mixPalette, scalePalette: scalePalette,
  decodeNewascii: decodeNewascii, newasciiToCanvas: newasciiToCanvas,
  decodeTextchr: decodeTextchr, decodeNewhan: decodeNewhan,
  decodePcx: decodePcx, pcxToCanvas: pcxToCanvas,
  composeSyllable: composeSyllable, glyph32: glyph32, drawText: drawText, 필터글자쓸까: 필터글자쓸까, 필터글자: 필터글자,   /* Z-44 글자 필터 도우미 */
  NEWHAN: NEWHAN, NH: NH,
  /** 폰트 3종을 원본에서 읽어 디코딩해 한 번에 돌려줍니다. */
  loadFonts: function (provider) {
    return Promise.all([
      provider.bytes('NEWHAN.FNT').then(decodeNewhan),
      provider.bytes('NEWASCII.FNT').then(decodeNewascii),
      provider.bytes('TEXT.CHR').then(decodeTextchr),
      provider.bytes('GENESIS.PAL').then(decodePalette)
    ]).then(function (a) {
      return { newhan: a[0], newascii: a[1], textchr: a[2], palette: a[3] };
    });
  }
};

if (typeof module !== 'undefined' && module.exports) module.exports = G2Native;
root.G2Native = G2Native;
})(typeof globalThis !== 'undefined' ? globalThis : this);
