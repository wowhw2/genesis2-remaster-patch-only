/* ============================================================================
 * 창세기전 2 — 팔레트 교체를 그래픽 카드(WebGL2)로   (2026-09-25 사장님 선택 ①)
 *
 * > 사장님: 「주로 xbrz 4배 좁힘 옵션을 사용하는데 너무 느려」 · 「칠하는 방식에 문제가 있는거 아니야?」
 * > 선택: 「① 그래픽 카드로 (권장)」
 *
 * 원본은 VGA DAC 표(256색)만 바꾸면 화면 전체 색이 한 번에 바뀐다(0x5F9AE · 0x5FD1C · out 0x3C9).
 * 우리는 스케일러가 확대한 트루컬러 그림이라 픽셀을 다시 칠해야 한다. CPU 로 칠하면 xBRZ 4배에서
 * 걸음마다 80ms 가 넘었다. 여기서는 그 계산을 그래픽 카드가 한다.
 *
 * ── 한 판(그림 하나) ──────────────────────────────────────────────────
 *   바탕  : 스케일러가 확대한 그림(바탕 팔레트로 칠한 것) — 맵을 지을 때 만든 것을 그대로 올린다
 *   번호  : 확대 전 원래 색 번호(논리 크기) — R = 번호, G = 불투명(255)/투명(0)
 *   팔레트: 바탕 팔레트 256색
 * ── 칠하기(걸음마다) ─────────────────────────────────────────────────
 *   새 팔레트 256색만 올리고, 픽셀마다
 *     A = 가장 가까운 불투명 원래 픽셀의 번호 (이웃 3×3)
 *     필터가 두 색을 섞은 픽셀이면 rgb ≈ (1−t)·A + t·B 가 되는 B·t 를 이웃에서 찾는다
 *     새 색 = 바탕 rgb + (1−t)·(새[A]−옛[A]) + t·(새[B]−옛[B])
 *   ☆ render.js 확대판만들기·확대판조각칠하기(CPU 길)와 같은 식이다 — WebGL 이 없으면 그쪽으로 물러난다.
 *
 * ★ [원본없음 · 파일전체] 스케일러(리마스터 전용)를 위한 것이다. 원본 색은 팔레트 표로만 정해진다.
 * ============================================================================ */
(function (root) {
'use strict';

var gl = null, 캔버스 = null, 프로그램 = null, 위치 = {}, 실패 = false;
var 굽기프로그램 = null, 굽기위치 = {};      /* 섞임 표 굽기 (판마다 한 번 · 2026-10-06) */
var 팔텍 = null, 지금팔 = null;            /* 새 팔레트 텍스처 — 같은 팔레트면 다시 안 올린다 */
/* 문맥 세대 — 그래픽 카드 문맥을 잃으면 올라 있던 텍스처가 모두 사라진다. 세대가 바뀐 판은 칠하기 때 다시 올린다 (2026-09-26 사장님 「그래픽 카드 쓴다고 했던거. 지금 팔레트 변경 관련해서 마법 다시 느려졌는데?」) */
var 세대 = 0, 잃은수 = 0;
/* ★ 정본 436 — 올린 판 텍스처를 그래픽 메모리 예산 안에 둔다 (오래 안 쓴 판부터 버리고, 다시 쓰면 칠하기가 다시 올린다)
 *   신고(R0.1.93 PC · 9-8 · hq4x · 94명 «케릭터가그림자만남았어요»): 몸 캔버스 0점 · 그림자 1888점 · 문맥 잃음 0
 *   유닛 판은 파일×장마다 하나씩 쌓이고 전투 끝까지 안 버렸다(4배면 장 하나 바탕+섞임 표 수백 KB~MB) — 그래픽 메모리가 차면
 *   새 텍스처가 비어 «칠했다» 하고 빈 몸을 냈다(추정 · 신고 셋 모두 4배 스케일러) ⇒ 예산 + 올릴 때 오류를 보면 CPU 길로
 *   실측(측정 창 9-8 · hq4x · 89명): 전투 시작 때 맵 바닥만 판 32장 223MB · 예산 없이 팔레트 두 번 바꿔 유닛 장 2,872장을 칠하면 판 1,551장 695MB
 *   ⇒ 예산 384MB(맵 바닥 + 보이는 유닛 장이 넉넉히 들어감) */
var 예산 = 384 * 1048576, 산판 = [], 올린바이트 = 0, 버린수 = 0, 오류수 = 0, 쓴차례 = 0;
function 판바이트(판) { return 판.W * 판.H * 8 + 1024; }   /* 바탕 + 섞임 표(RGBA 둘) + 팔레트 */
function 판내리기(판) {   /* 텍스처만 지운다 — 판(바탕·번호)은 남아 다음 칠하기 때 다시 올린다 */
  ['tBase', 'tIdx', 'tPal0', 'tMix'].forEach(function (k) { if (판[k]) { if (gl && 판.세대 === 세대) gl.deleteTexture(판[k]); 판[k] = null; } });
  var i = 산판.indexOf(판); if (i >= 0) { 산판.splice(i, 1); 올린바이트 -= 판.바이트 || 0; }
  판.세대 = -1;
}
function 예산맞추기(더할) {
  if (올린바이트 + 더할 <= 예산) return;
  산판.sort(function (a, b) { return a.쓴때 - b.쓴때; });
  while (산판.length && 올린바이트 + 더할 > 예산 * 0.75) { 판내리기(산판[0]); 버린수++; }
}

var VS = '#version 300 es\n' +
  'in vec2 p; void main(){ gl_Position = vec4(p, 0.0, 1.0); }';
var FS = '#version 300 es\n' +
  'precision highp float; precision highp int;\n' +
  'uniform sampler2D uBase; uniform sampler2D uIdx; uniform sampler2D uPal0; uniform sampler2D uPal1;\n' +
  'uniform ivec2 uOff; uniform int uH; uniform float uN; uniform ivec2 uSrc; uniform ivec2 uBaseSize;\n' +
  'out vec4 o;\n' +
  'vec3 P0(int i){ return texelFetch(uPal0, ivec2(i, 0), 0).rgb; }\n' +
  'vec3 P1(int i){ return texelFetch(uPal1, ivec2(i, 0), 0).rgb; }\n' +
  'void main(){\n' +
  '  ivec2 q = ivec2(int(gl_FragCoord.x), uH - 1 - int(gl_FragCoord.y)) + uOff;\n' +
  '  if (q.x >= uBaseSize.x || q.y >= uBaseSize.y) { o = vec4(0.0); return; }\n' +
  '  vec4 s = texelFetch(uBase, q, 0);\n' +
  '  if (s.a <= 0.0) { o = vec4(0.0); return; }\n' +     /* 표: 투명 = 칠할 것 없음 */
  '  vec2 f = (vec2(q) + 0.5) / uN - 0.5;\n' +
  '  ivec2 c = ivec2(floor(vec2(q) / uN));\n' +
  '  int cand[9]; int nc = 0; int A = -1; float best = 1e9;\n' +
  '  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {\n' +
  '    ivec2 n = c + ivec2(dx, dy);\n' +
  '    if (n.x < 0 || n.y < 0 || n.x >= uSrc.x || n.y >= uSrc.y) continue;\n' +
  '    vec2 t = texelFetch(uIdx, n, 0).rg;\n' +
  '    if (t.g < 0.5) continue;\n' +
  '    int v = int(t.r * 255.0 + 0.5);\n' +
  '    vec2 d = vec2(n) - f; float dd = dot(d, d);\n' +
  '    if (dd < best) { best = dd; A = v; }\n' +
  '    bool had = false; for (int j = 0; j < 9; j++) { if (j >= nc) break; if (cand[j] == v) had = true; }\n' +
  '    if (!had) { cand[nc] = v; nc++; }\n' +
  '  }\n' +
  '  if (A < 0) { o = vec4(0.0); return; }\n' +          /* 표: 원래 번호 없음 = 바탕 그대로 */
  '  vec3 pa = P0(A); vec3 S = s.rgb - pa; float err = dot(S, S);\n' +
  '  int B = A; float wA = 1.0;\n' +
  '  if (err * 65025.0 > 12.0) {\n' +                       /* CPU 길의 문턱 12(0~255 제곱합)와 같다 */
  '    for (int k = 0; k < 9; k++) {\n' +
  '      if (k >= nc) break; int v2 = cand[k]; if (v2 == A) continue;\n' +
  '      vec3 vb = P0(v2) - pa; float vv = dot(vb, vb); if (vv <= 0.0) continue;\n' +
  '      float t = clamp(dot(S, vb) / vv, 0.0, 1.0); vec3 e = S - t * vb; float e2 = dot(e, e);\n' +
  '      if (e2 < err) { err = e2; B = v2; wA = 1.0 - t; }\n' +
  '    }\n' +
  '  }\n' +
  '  o = vec4(float(A) / 255.0, float(B) / 255.0, wA, 1.0);\n' +   /* ★ 섞임 표 — 팔레트와 무관하니 판마다 한 번만 */
  '}\n';
/* ★★★ **칠하기 셰이더 — 섞임 표만 읽는다** (2026-10-06)
 *   사장님(원문) 「일단 최대한 gpu로 옮기는 방법으로 해보자.」
 *   실측(9344 탭 3-3A): 걸음마다 칠하기 ~90번 · 픽셀마다 이웃 9칸 찾기가 대부분(4464×48 행 하나 0.053ms 중 복사 0.002ms).
 *   A·B·비율은 바탕 그림과 원래 번호만으로 정해진다 — 판을 올릴 때 위 셰이더(FS)로 한 번 구워 tMix 에 둔다.
 *   비율은 8비트로 담긴다 — CPU 길(확대판만들기 wt Uint8)과 같은 정밀도. */
var FS칠 = '#version 300 es\n' +
  'precision highp float; precision highp int;\n' +
  'uniform sampler2D uBase; uniform sampler2D uMix; uniform sampler2D uPal0; uniform sampler2D uPal1;\n' +
  'uniform ivec2 uOff; uniform int uH; uniform ivec2 uBaseSize;\n' +
  'out vec4 o;\n' +
  'vec3 P0(int i){ return texelFetch(uPal0, ivec2(i, 0), 0).rgb; }\n' +
  'vec3 P1(int i){ return texelFetch(uPal1, ivec2(i, 0), 0).rgb; }\n' +
  'void main(){\n' +
  '  ivec2 q = ivec2(int(gl_FragCoord.x), uH - 1 - int(gl_FragCoord.y)) + uOff;\n' +
  '  if (q.x >= uBaseSize.x || q.y >= uBaseSize.y) { o = vec4(0.0); return; }\n' +
  '  vec4 s = texelFetch(uBase, q, 0);\n' +
  '  if (s.a <= 0.0) { o = s; return; }\n' +
  '  vec4 m = texelFetch(uMix, ivec2(q.x, uBaseSize.y - 1 - q.y), 0);\n' +   /* 굽기 판은 아래가 0 줄 */
  '  if (m.a < 0.5) { o = s; return; }\n' +
  '  int A = int(m.r * 255.0 + 0.5), B = int(m.g * 255.0 + 0.5); float wA = m.b;\n' +
  '  vec3 dA = P1(A) - P0(A), dB = P1(B) - P0(B);\n' +
  '  o = vec4(clamp(s.rgb + wA * dA + (1.0 - wA) * dB, 0.0, 1.0), s.a);\n' +
  '}\n';

function 셰이더(종류, 글) {
  var s = gl.createShader(종류); gl.shaderSource(s, 글); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || '셰이더 실패');
  return s;
}
function 텍스처() {
  var t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
/** 팔레트(768바이트) → 256×1 RGBA 텍스처에 쓴다 */
function 팔올리기(t, pal) {
  var d = new Uint8Array(1024);
  for (var i = 0; i < 256; i++) { d[i * 4] = pal[i * 3]; d[i * 4 + 1] = pal[i * 3 + 1]; d[i * 4 + 2] = pal[i * 3 + 2]; d[i * 4 + 3] = 255; }
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, d);
}

/** 쓸 수 있나 — 처음 부를 때 문맥을 만든다. 실패하면 다시 시도하지 않는다(CPU 길로) */
function 문맥준비() {
  if (gl) return !gl.isContextLost();
  if (실패 || typeof document === 'undefined') return false;
  try {
    캔버스 = document.createElement('canvas'); 캔버스.width = 1; 캔버스.height = 1;
    gl = 캔버스.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: false,
                                      depth: false, stencil: false, preserveDrawingBuffer: true });
    if (!gl) { 실패 = true; return false; }
    /* 두 셰이더 — 굽기(섞임 표 · 판마다 한 번) · 칠하기(걸음마다). 꼭짓점 'p' 는 둘 다 0 번 자리 */
    function 짓기(fs) {
      var pr = gl.createProgram();
      gl.attachShader(pr, 셰이더(gl.VERTEX_SHADER, VS));
      gl.attachShader(pr, 셰이더(gl.FRAGMENT_SHADER, fs));
      gl.bindAttribLocation(pr, 0, 'p');
      gl.linkProgram(pr);
      if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(pr) || '링크 실패');
      return pr;
    }
    굽기프로그램 = 짓기(FS);
    프로그램 = 짓기(FS칠);
    ['uBase', 'uIdx', 'uPal0', 'uOff', 'uH', 'uN', 'uSrc', 'uBaseSize'].forEach(function (k) { 굽기위치[k] = gl.getUniformLocation(굽기프로그램, k); });
    ['uBase', 'uMix', 'uPal0', 'uPal1', 'uOff', 'uH', 'uBaseSize'].forEach(function (k) { 위치[k] = gl.getUniformLocation(프로그램, k); });
    var 버퍼 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, 버퍼);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);   /* 화면을 덮는 삼각형 하나 */
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.useProgram(굽기프로그램);
    gl.uniform1i(굽기위치.uBase, 0); gl.uniform1i(굽기위치.uIdx, 1); gl.uniform1i(굽기위치.uPal0, 2);
    gl.useProgram(프로그램);
    gl.uniform1i(위치.uBase, 0); gl.uniform1i(위치.uMix, 1); gl.uniform1i(위치.uPal0, 2); gl.uniform1i(위치.uPal1, 3);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.disable(gl.BLEND);
    팔텍 = 텍스처();
    캔버스.addEventListener('webglcontextlost', function (ev) {
      /* ☠ 예전: 한 번 잃으면 영영 CPU 길(느림)로 물러났다. 새 문맥을 다시 만든다 — 세 번 넘게 잃으면 그때 포기 */
      ev.preventDefault(); gl = null; 캔버스 = null; 지금팔 = null; 세대++; 잃은수++;
      산판 = []; 올린바이트 = 0;                                  /* 정본 436 — 잃은 문맥의 텍스처는 이미 없다 */
      if (잃은수 > 3) 실패 = true;
      root.__팔레트GPU잃음 = (root.__팔레트GPU잃음 | 0) + 1;   /* 까닭을 남긴다 — 이 뒤로는 CPU 길로 칠한다 */
      try { console.warn('[팔레트GPU] 그래픽 카드 문맥을 잃었다 — CPU 길로 칠한다'); } catch (x) {}
    });
    return true;
  } catch (e) {
    try { console.warn('[팔레트GPU] 못 쓴다 — CPU 길로 칠한다: ' + (e && e.message)); } catch (x) {}
    gl = null; 실패 = true; return false;
  }
}

/**
 * 판을 올린다 — 한 번만. 바탕 캔버스(확대된 것)의 `.논리w/논리h` 로 배율을 안다.
 * @param {HTMLCanvasElement} 바탕 확대된 그림(바탕 팔레트로 칠한 것)
 * @param {{w,h,idx,tr}} fr 확대 전 원래 색 번호
 * @param {Uint8Array} 바탕팔 바탕을 칠한 팔레트(768)
 */
function 판올리기(바탕, fr, 바탕팔) {
  if (!문맥준비() || !바탕 || !fr) return null;
  var lw = 바탕.논리w || fr.w, lh = 바탕.논리h || fr.h;
  if (lw !== fr.w || lh !== fr.h) return null;              /* 짝이 안 맞으면 쓰지 않는다 */
  var 판 = { W: 바탕.width, H: 바탕.height, lw: lw, lh: lh, 바탕팔: 바탕팔, 세대: 세대, 바탕: 바탕, fr: fr };
  return 텍스처올리기(판) ? 판 : null;
}
function 번호만들기(fr) {   /* native frameToImageData 와 같은 투명 규칙 */
  var n = fr.w * fr.h, 번호 = new Uint8Array(n * 2), src = fr.idx, tr = fr.tr, trA = Array.isArray(tr) ? tr : null;
  for (var i = 0; i < n; i++) {
    var c = src[i];
    var 투명 = trA ? trA.indexOf(c) >= 0 : (tr != null ? c === tr : c < 0);
    if (투명 || c < 0 || c > 255) continue;
    번호[i * 2] = c; 번호[i * 2 + 1] = 255;
  }
  return 번호;
}
/** 판의 텍스처를 (다시) 올린다 — 예산을 맞추고, 그래픽 카드가 오류(메모리 모자람 등)를 내면 지우고 false (그 판은 CPU 길로) */
function 텍스처올리기(판) {
  var lw = 판.lw, lh = 판.lh, fr = 판.fr, 번호 = 번호만들기(fr);
  판.바이트 = 판바이트(판);
  예산맞추기(판.바이트);
  /* 정본 400 — 앞의 오류 비우기(getError)는 하지 않는다: getError 는 그래픽 카드가 앞서 받은 일을 다 끝낼 때까지 기다리게 해(안드로이드에서 특히) 판마다 두 번 멈췄다
   *   (갤럭시 S24+ 기록 2-6 날씨 전환 한 걸음 638ms · 측정 크롬 휴대폰 흉내 첫 걸음 getError 494ms) · 묵은 오류가 있으면 아래 검사가 이 판을 CPU 길로 돌릴 뿐 — CPU 길도 같은 그림
   *   끄기 window.__팔레트GPU앞오류비움 */
  if (root.__팔레트GPU앞오류비움) { try { gl.getError(); } catch (e0) { } }
  판.세대 = 세대;
  판.tBase = 텍스처(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, 판.바탕);
  판.tIdx = 텍스처(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG8, fr.w, fr.h, 0, gl.RG, gl.UNSIGNED_BYTE, 번호);
  판.tPal0 = 텍스처(); 팔올리기(판.tPal0, 판.바탕팔);
  /* ★ 섞임 표를 한 번 굽는다 — 굽기 판(아래가 0 줄)에 그린다 (2026-10-06) */
  판.tMix = 텍스처(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 판.W, 판.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  var fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, 판.tMix, 0);
  gl.viewport(0, 0, 판.W, 판.H);
  gl.useProgram(굽기프로그램);
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, 판.tBase);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, 판.tIdx);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, 판.tPal0);
  gl.uniform2i(굽기위치.uOff, 0, 0);
  gl.uniform1i(굽기위치.uH, 판.H);
  gl.uniform1f(굽기위치.uN, 판.W / lw);
  gl.uniform2i(굽기위치.uSrc, lw, lh);
  gl.uniform2i(굽기위치.uBaseSize, 판.W, 판.H);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.deleteFramebuffer(fb);
  gl.useProgram(프로그램);
  gl.deleteTexture(판.tIdx); 판.tIdx = null;                  /* 표를 구웠으니 번호 텍스처는 더 안 쓴다 */
  if (모음) { 판.쓴때 = ++쓴차례; 산판.push(판); 올린바이트 += 판.바이트; 모음.push(판); return true; }   /* 정본 400 — 모아 올리기 중: 검사는 모아올리기끝() 에서 한 번 */
  var 오류 = 0; try { 오류 = gl.getError(); } catch (e1) { }
  if (오류 && !gl.isContextLost()) {                          /* 메모리 모자람 등 — 빈 텍스처로 «칠했다» 하지 않는다 */
    오류수++; 판내리기(판); 예산맞추기(예산);                    /* 남은 판도 줄여 둔다 */
    try { if (오류수 <= 3) console.warn('[팔레트GPU] 텍스처 올리기 오류 ' + 오류 + ' — 이 그림은 CPU 길로 칠한다 (올린 ' + Math.round(올린바이트 / 1048576) + 'MB)'); } catch (x) { }
    return false;
  }
  판.쓴때 = ++쓴차례; 산판.push(판); 올린바이트 += 판.바이트;
  return true;
}

/**
 * 판의 (논리) 사각형을 새 팔레트로 칠해 2D 캔버스 c 에 옮긴다. c 는 실제 크기(확대된 크기)다.
 * @returns {boolean} 칠했나
 */
function 칠하기(판, pal, c, sx, sy) {
  if (!판 || 판.버림 || !문맥준비() || !c || !c.width || !c.height) return false;
  if (판.세대 !== 세대) {                                    /* 문맥을 잃었다 되찾았다 · 예산으로 내렸다 — 텍스처를 다시 올린다 */
    if (!텍스처올리기(판)) return false;                     /* 못 올리면 부르는 쪽이 CPU 길로 */
  }
  판.쓴때 = ++쓴차례;
  /* 그리기 판은 키우기만 한다 — 크기를 바꾸면 버퍼를 새로 잡아 한 번에 0.2ms 남짓 들었다(오브젝트 35개).
   *   그릴 곳은 판의 왼쪽 위(GL 좌표로는 위쪽 끝)다 */
  if (캔버스.width < c.width || 캔버스.height < c.height) { 캔버스.width = Math.max(캔버스.width, c.width); 캔버스.height = Math.max(캔버스.height, c.height); }
  gl.viewport(0, 캔버스.height - c.height, c.width, c.height);
  if (지금팔 !== pal) { 팔올리기(팔텍, pal); 지금팔 = pal; }
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, 판.tBase);
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, 판.tMix);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, 판.tPal0);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, 팔텍);
  var N = 판.W / 판.lw;
  gl.uniform2i(위치.uOff, Math.round((sx || 0) * N), Math.round((sy || 0) * N));
  gl.uniform1i(위치.uH, 캔버스.height);   /* gl_FragCoord.y 는 판 전체 기준 — 뒤집으면 0 ~ c.height−1 */
  gl.uniform2i(위치.uBaseSize, 판.W, 판.H);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  var g = c.getContext('2d');
  g.clearRect(0, 0, c.width, c.height);
  g.drawImage(캔버스, 0, 0, c.width, c.height, 0, 0, c.width, c.height);   /* 9인자·논리w 없음 — 스케일러 몽키패치를 안 탄다 */
  return true;
}

/** 판을 버린다(맵이 바뀔 때) */
function 버리기(판) {
  if (!판) return;
  판.버림 = true;
  판내리기(판);   /* 잃은 문맥의 텍스처는 이미 없다 — 판내리기가 세대를 보고 지우지 않는다 */
}

/* 정본 400 — 모아 올리기: 판 여럿을 올리는 동안 올린 뒤 검사(getError · 그래픽 카드 기다림)를 미루고 끝에 한 번만 한다
 *   오류가 났으면 모아 올린 판을 모두 내린다(세대 −1) — 칠할 때 하나씩 다시 올리며 검사하고, 그래도 안 되면 CPU 길(같은 그림)
 *   (갤럭시 S24+ 2-6 날씨 전환 첫 걸음 · 측정 크롬: 한 걸음에 판 72개 = getError 72번) · 부르는 쪽 render.js _행오버레이_다시칠하기 */
var 모음 = null;
function 모아올리기시작() { if (!모음) 모음 = []; }
function 모아올리기끝() {
  var 목 = 모음; 모음 = null;
  if (!목 || !목.length || !gl) return 0;
  var 오류 = 0; try { 오류 = gl.getError(); } catch (e1) { }
  if (!오류 || gl.isContextLost()) return 0;
  오류수++; 목.forEach(판내리기); 예산맞추기(예산);
  try { if (오류수 <= 3) console.warn('[팔레트GPU] 모아 올리기 오류 ' + 오류 + ' — 판 ' + 목.length + '개를 내려 하나씩 다시 올린다'); } catch (e2) { }
  return 목.length;
}

root.G2PaletteGPU = { 준비: 문맥준비, 판올리기: 판올리기, 칠하기: 칠하기, 버리기: 버리기, 모아올리기시작: 모아올리기시작, 모아올리기끝: 모아올리기끝,
                      쓰나: function () { return !!gl && !실패; },
                      /* [개발] 문맥 잃기 시험 — 잃었다 다시 잇는 길을 확인한다 */
                      잃어보기: function () { var e = gl && gl.getExtension('WEBGL_lose_context'); if (e) e.loseContext(); return !!e; },
                      상태: function () { return { 세대: 세대, 잃은수: 잃은수, 실패: 실패, 있음: !!gl, 판수: 산판.length, 올린MB: Math.round(올린바이트 / 1048576), 예산MB: Math.round(예산 / 1048576), 버린수: 버린수, 오류수: 오류수 }; },
                      _예산: function (mb) { if (mb != null) 예산 = mb * 1048576; return 예산; } };   /* _ 붙은 것은 시험용 */
if (typeof module !== 'undefined' && module.exports) module.exports = root.G2PaletteGPU;
})(typeof globalThis !== 'undefined' ? globalThis : this);
