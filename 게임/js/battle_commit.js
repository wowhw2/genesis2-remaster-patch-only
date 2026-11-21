/* ============================================================
 *  **`commitBattleResult()`** — 전투 결과를 영구 `characters[]` 로 (계약 §2-1)
 *
 *  ★★★ 계약 §2-1: **전투 → 영구 캐릭터로 넘어가는 길은 여기 하나뿐이다.**
 *  ```
 *  전투 시작:  characters[] ──복사──▶ scenario.battle.units   (battle_load.js)
 *  전투 중  :  battle.units 만 바뀐다. characters[] 는 손대지 않는다
 *  전투 끝  :  commitBattleResult()  ──▶ characters[]          ← ★ 여기서만
 *  ```
 *
 *  ── ★ 언제 부르나 — 계약의 `[unknown]` 을 풀었다 (2026-08-19) ────────────
 *  계약 §2-1 은 「패배·재도전 때 커밋하는지는 **[unknown]**. 원본 `0x50751`(패배 메뉴)이
 *  `0x4EC51` 을 거치는지 아직 안 읽었다. **확인 전까지는 커밋하지 않는다**」고 적어 뒀다.
 *
 *  `call 0x4EC51` 을 전 이미지에서 전수로 뜨면 **딱 두 곳**이다:
 *  | 호출부 | 무엇 |
 *  |---|---|
 *  | `0x5071A` | `0x506F3` = opcode **`0x01` 전투 종료(승리)** |
 *  | `0x52D55` | `0x52D33` = opcode **`0x12` 다음 시나리오** |
 *
 *  `0x50751`(opcode `0x65` 게임 오버 메뉴)에는 **없다.**
 *  → **패배는 커밋하지 않는다.** 보수적으로 정해 둔 것이 맞았다.
 *
 *  ── 회복 공식 — `0x4EAF3` 직독 ─────────────────────────────────────────
 *  ```asm
 *  0x4EB45  cmp 현재HP, 최대HP / je            ; ★ 만피면 HP 회복 건너뜀
 *  0x4EB4E  idiv 10                            ; ★ 최대HP / 10
 *  0x4EB58  현재HP += 그 값
 *  0x4EB6D  cmp 소속([+0x87]), [0x8DF85]       ; 현재 팀과 비교
 *  0x4EB6F  jne 0x4EB93 → 0x4EB96              ; ★ 소속 ≠ 현재 → **완전 회복**
 *  0x4EB7E  idiv 3                             ; 최대HP / 3
 *  0x4EB85  jg  0x4EB96                        ; ★ 최대/3 > 현재HP → **최대/3 으로** (아래 ★★★)
 *  0x4EB8C  jle → 그대로 / 아니면 최대로 clamp
 *  ```
 *
 *  ── ★★★ 헛짚은 기록 (2026-08-19 사용자 지적으로 잡힘) ────────────────────
 *  사용자: 「원작 기준 체력은 **완전히 회복되지 않아.** 특정 공식에 따라 **비율로 채워져.**
 *          현재 체력 0으로 사망했을 때 다음 시나리오에서 **100% 체력이 아닌 상태**로 시작해.
 *          마을 INN 에서 비용을 지불하면 회복되기도 하고.」
 *
 *  맞았다. `0x4EB96 mov [ecx+0x48], eax` 는 **두 경로가 공유**하는데 `eax` 가 서로 다르다:
 *  | 어디서 오나 | `eax` |
 *  |---|---|
 *  | `0x4EB85 jg` | `0x4EB7E idiv 3` 의 결과 = **최대HP / 3** |
 *  | `0x4EB93` | `mov eax,[ecx+0x4C]` = **최대HP** |
 *
 *  초판에 **둘 다 완전 회복**으로 읽었다. `CLAUDE.md` 가 경고한 바로 그 함정이다 —
 *  「`idiv` 는 몫이 `eax`. 그 뒤 어느 쪽을 쓰는지 **반드시** 확인한다」.
 *  ★ `00_전체실행기_계약.md` §2-1 도 「HP < 최대/3 → 완전 회복」이라 **틀리게** 적어 뒀고,
 *    그것을 그대로 옮겼다. 계약 문구도 함께 고쳤다.
 *
 *  → **HP 0 으로 죽으면** `0 + 최대/10 = 10%` → 33% 미만 → **최대/3(약 33%) 로 시작**한다.
 *    100% 가 아니다. 남은 HP 가 다음 시나리오로 이어진다.
 *
 *  ```asm
 *  0x4EB99  MP([+0x50]) = [+0x52]              ; ★ MP 를 최대로
 *  0x4EBC6  [+0x14] = 0                        ; 플래그14 해제
 *  0x4EBCA  [+0x1E] = 0                        ; ★ 상태이상 전부 해제
 *  0x4EBD3  [+0x15] = 0                        ; 버프 해제
 *  0x4EBD9~ [+0x1F + i*2] = 0xFFFF (i<4)       ; 지속 칸 비움 · [+0x16+i*2] 로 복사
 *  0x4EBFB  [+0x56] = 0 · [+0x57..58] = 0      ; 재행동 대기 · TP
 *  0x4EC05  [+0x83] = 0 · [+0x80] = 0xFF · [+0x82] = 0xFF
 *  ```
 *
 *  ── ★ 되쓰기 조건 — `0x4EC13` ──────────────────────────────────────────
 *  ```asm
 *  0x4EC13  mov bl, [ecx+0x12]        ; 소환자코드
 *  0x4EC1F  jne 0x4EC49               ; ★ 0 이 아니면 **되쓰지 않는다**
 *  0x4EC21  [+0x67] = 0 · [+0x84] = 0
 *  0x4EC44  write 136바이트           ; 0x4E26 + (코드−1)*136
 *  ```
 *  → **소환수(`[+0x12] != 0`)는 영구 캐릭터로 안 넘어간다.** 당연하다.
 *
 *  ── 누구를 도나 — `0x4EC80` ────────────────────────────────────────────
 *  `[0xCC990]` 목록(= 파티)을 `[+0x7B]` 로 이으며 돈다. 우리는 `_그룹 === 0` 으로 잡는다.
 * ============================================================ */
'use strict';
(function (root) {

  var Sce = root.G2Sce || (typeof require === 'function' ? require('./sce.js') : null);
  var BB  = root.G2Blackbox || (typeof require === 'function' ? require('./blackbox.js') : null);
  var 유닛크기 = 136;

  function u32읽기(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }
  function u32쓰기(b, o, v) {
    b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; b[o + 2] = (v >>> 16) & 0xFF; b[o + 3] = (v >>> 24) & 0xFF;
  }
  function u16읽기(b, o) { return b[o] | (b[o + 1] << 8); }
  function u16쓰기(b, o, v) { b[o] = v & 0xFF; b[o + 1] = (v >>> 8) & 0xFF; }

  /**
   * 한 유닛의 136B 레코드에 **전투 후 회복**을 적용한다 (원본 `0x4EAF3`).
   * @param rec      136바이트 (**제자리에서 고친다**)
   * @param 현재팀   `[0x8DF85]` 에 해당하는 값 (소속과 견준다)
   */
  function 회복적용(rec, 현재팀) {
    var 현재HP = u32읽기(rec, 0x48), 최대HP = u32읽기(rec, 0x4C);

    if (현재HP !== 최대HP) {                                  // 0x4EB45 만피면 건너뜀
      var 새HP = 현재HP + Math.trunc(최대HP / 10);            // 0x4EB4E idiv 10
      var 소속 = rec[0x87];
      if (소속 !== 현재팀) {
        /* 0x4EB6F jne → 0x4EB93 `mov eax,[ecx+0x4C]` → 0x4EB96 : eax = **최대HP** */
        새HP = 최대HP;                                        // 참전 안 한 캐릭터만 완전 회복
      } else {
        /* ★★★ 0x4EB85 jg → 0x4EB96 인데, 그때 `eax` 는 **최대HP/3** 이다
         *   (0x4EB7E `idiv 3` 결과가 그대로 남아 있다).
         *   → **완전 회복이 아니라 「최대의 1/3」 하한선 보정**이다. */
        var 삼분 = Math.trunc(최대HP / 3);                    // 0x4EB7E idiv 3
        if (삼분 > 새HP) 새HP = 삼분;                          // 0x4EB85 jg  → 하한선
        else if (새HP > 최대HP) 새HP = 최대HP;                // 0x4EB8E clamp
      }
      u32쓰기(rec, 0x48, 새HP);
    }

    u16쓰기(rec, 0x50, u16읽기(rec, 0x52));                   // 0x4EB99 MP = 최대MP
    /* ★★★ 0x4EBA1~0x4EBC6 — 원본을 직접 읽어 되살렸다 (2026-08-22)
     *   0x4EBA1  ah = [+0x14]
     *   0x4EBA8  test ah,1 / je 0x4EBB9      ← ★ 비행 플래그
     *   0x4EBAF    [+0x14] &= ~1
     *   0x4EBB5    dec **word** [+0x61]      ← ★ 비행 스프라이트 → 지상 스프라이트
     *   0x4EBB9  test [+0x14],2 / je 0x4EBC6
     *   0x4EBBF    [+0x83] = 0               (0x4EC05 가 무조건 다시 하므로 결과는 같다)
     *   0x4EBC6  [+0x14] = 0
     *
     *   ★ [+0x14] & 1 은 **비행**이다 — AI대역_분석.md:548 :
     *     「[+0x14] & 1 == 0 → [+0x61] += 1 ; [+0x60] = 재적재 ; [+0x14] |= 1」
     *     0x29B14 (cmp bx,6 / or byte[edx+0x14],1) 소환수 6 가고일도 같다.
     *     [+0x61] u16 = 스프라이트 번호(스키마 97..98) — 비행 그림이 지상 그림 +1 이다.
     *   ⇒ 이 처리가 없으면 **비행 중에 전투가 끝난 캐릭터의 스프라이트가 +1 인 채로
     *     BLACKBOX 에 저장**되어 다음 전투에서 엉뚱한 그림이 나온다.
     *     (GPT 3차 검수가 「+0x14 는 리셋 전에 읽힌다」고 짚어 준 것을 원본으로 확인) */
    var f14 = rec[0x14];
    rec[0x13] = 0;                                            // 0x4EBA4
    if (f14 & 1) {                                            // 0x4EBA8 비행 중이면
      rec[0x14] = f14 & 0xFE;                                 // 0x4EBAF 비행 비트 끄기
      u16쓰기(rec, 0x61, (u16읽기(rec, 0x61) - 1) & 0xFFFF);   // 0x4EBB5 dec word
    }
    if (rec[0x14] & 2) rec[0x83] = 0;                         // 0x4EBBF (0x4EC05 와 중복)
    rec[0x14] = 0;                                            // 0x4EBC6 플래그14
    rec[0x1E] = 0;                                            // 0x4EBCA ★ 상태이상 해제
    rec[0x15] = 0;                                            // 0x4EBD3 버프
    /* ★★★ 0x4EBD6~0x4EBF4 — 원본 명령 **순서**를 잘못 옮겼던 것을 고쳤다 (2026-08-22)
     *   0x4EBD6  movsx eax, dx
     *   0x4EBD9  mov word [ecx+eax*2+0x1F], 0xFFFF   ← ★ **먼저 지운다**
     *   0x4EBE0  mov si, [ecx+eax*2+0x1F]            ← ★ 그래서 si 는 이미 0xFFFF
     *   0x4EBE5  inc edx
     *   0x4EBE6  mov [ecx+eax*2+0x16], si            ← ★ 0xFFFF 를 쓴다 (복사가 아니다)
     *   0x4EBEB  cmp dx,4 / jl 0x4EBD6
     *   0x4EBF1  movsx eax, dx  (=4)
     *   0x4EBF4  mov word [ecx+eax*2+0x1F], 0xFFFF   ← +0x27 마지막 한 칸
     *
     *   ⇒ 결과는 **+0x16~+0x1D 와 +0x1F~+0x27 이 전부 0xFFFF**.
     *     앞서 「옛 지속값을 +0x16 으로 옮긴다」고 읽었던 것은 **틀렸다** —
     *     쓰기가 읽기보다 앞선다. (GPT 4차 검수가 순서를 짚어 줬고 원본으로 확인)
     *   ⇒ 그러므로 전투 런타임의 지속 칸은 커밋 전에 되돌릴 필요가 없다. */
    for (var i = 0; i < 5; i++) {                             // 0x4EBD6~0x4EBF4
      u16쓰기(rec, 0x1F + i * 2, 0xFFFF);                      // 0x4EBD9 (i=4 는 0x4EBF4)
      if (i < 4) u16쓰기(rec, 0x16 + i * 2, 0xFFFF);           // 0x4EBE6 (읽은 값이 곧 0xFFFF)
    }
    rec[0x56] = 0;                                            // 0x4EBFB 재행동 대기
    u16쓰기(rec, 0x57, 0);                                    // 0x4EBFF TP
    rec[0x83] = 0;                                            // 0x4EC05
    rec[0x80] = 0xFF;                                         // 0x4EC0C
    rec[0x82] = 0xFF;                                         // 0x4EC16

    /* ★★★ 0x4EC1D~0x4EC44 — 파일 쓰기 직전 정리. 통째로 빠져 있었다 (2026-08-22)
     *   0x4EC13  bl = [+0x12]  (소환자 코드)
     *   0x4EC1D  test bl,bl / jne 0x4EC49   ← ★ 소환수면 **아래를 전부 건너뛰고 저장도 안 한다**
     *   0x4EC21  mov dword [ecx+0x67], 0
     *   0x4EC2A  mov byte  [ecx+0x84], bl   (= 0)
     *   0x4EC30  call 0x12124               ← ★ 모션·픽셀오프셋 정리
     *   0x4EC44  call 0x6223f (ebx=0x88=136) ← BLACKBOX 에 136B 쓰기
     *
     *   0x12124 (직독):
     *     cmp word [eax+0x61], 0x12C ; jge → [+0x64] = 0
     *     cmp byte [eax+0x56], 0xFF  ; je  → [+0x64] = 0
     *     test [eax+0x14], 1         ; jne → [+0x64] = 0
     *     else                             → [+0x64] = 3
     *     [+0x66] = 0 ; [+0x65] = [+0x66]
     *   ★ 여기 오는 시점엔 0x4EBFB 로 [+0x56]=0 · 0x4EBC6 으로 [+0x14]=0 이라
     *     실질 판정은 **스프라이트 번호 < 300 인가** 하나뿐이다.
     *     (GPT 4차 검수 지적 → x86dis 로 0x12124 를 직접 읽어 확인) */
    if (rec[0x12] === 0) {                                    // 0x4EC1D 소환수가 아니면
      u32쓰기(rec, 0x67, 0);                                  // 0x4EC21
      rec[0x84] = 0;                                          // 0x4EC2A
      /* 0x12124 */
      rec[0x64] = (u16읽기(rec, 0x61) < 0x12C &&              // 0x12125 300 미만
                   rec[0x56] !== 0xFF &&                      // 0x1212D
                   !(rec[0x14] & 1)) ? 3 : 0;                 // 0x12133
      rec[0x66] = 0;                                          // 0x12143
      rec[0x65] = rec[0x66];                                  // 0x12147~0x1214A
    }
    return rec;
  }

  /** `G2Bridge` — 있으면 쓴다 (`02_실행기/게임/js/bridge.js`) */
  function 브리지() {
    if (typeof G2Bridge !== 'undefined' && G2Bridge) return G2Bridge;
    if (typeof window !== 'undefined' && window.G2Bridge) return window.G2Bridge;
    if (typeof require === 'function') { try { return require('./bridge.js'); } catch (e) {} }
    return null;
  }

  /**
   * 전투 중 바뀐 런타임 필드를 136B 레코드로 되돌린다 (커밋 전 동기화).
   *
   * ★★★ 2026-08-22 — **상태 브리지(3단계)로 넘겼다.**
   *   전에는 HP·MP·X·Y 넷만 되돌렸다. §A-1 (다) 표대로 성장·장비·경험치와
   *   **커밋이 리셋 전에 읽는 칸**(`+0x14` 비행 · `+0x61` 스프라이트 · `+0x87` 소속)까지
   *   `G2Bridge.되돌리기()` 가 옮긴다.
   *
   * ★ 대문자(`HP`/`MP`/`X`/`Y`)는 `battle_load` 사본의 이름이고,
   *   소문자(`hp`/`mp`/`x`/`y`)는 `G2State` 런타임 이름이다 — **둘 다 받는다.**
   *   (GPT 5차가 「그대로 넘기면 네 필드조차 동기화되지 않는다」고 짚은 자리다.)
   */
  /** 창고 배열의 빈 칸(0)을 제자리에서 걷는다 — 원본 창고는 «찬 것만 이어진» 버퍼다 (아래 획득 붙이기 주석) */
  function 빈칸걷기(목) {
    if (!Array.isArray(목)) return 목;
    var w = 0;
    for (var r = 0; r < 목.length; r++) if (목[r] | 0) 목[w++] = 목[r];
    목.length = w;
    return 목;
  }

  /* [리마스터 «적 능력 배율»] 적으로 등장해 배율(state.js 적HP배 — 레벨·최대 HP·최대 MP)이 걸린 유닛의 «배율 뺀» 값 — 명부에는 원래 값으로 쓴다.
   *   전향(0x0C)으로 합류했거나 그룹 0 에 적으로 섰던 명부 캐릭터가 늘어난 레벨·HP·MP 로 저장돼 다음 판부터 그대로 남았다
   *   (2026-11-14 사장님 「적으로 등장했던 명부의 캐릭터 능력치가 적 능력치 배율에 따라 늘어나서 저장되는것 같아.」·「늘려서 저장되어서 문제가 생겼다는거야!」 · 정본 197)
   *   ★ 배율을 건 뒤 실제로 더 오른 만큼(아군이 된 뒤 레벨업)은 남긴다 — 배율 계산값보다 큰 몫만 원래 값에 더한다. 힘·지·민·권은 순수 원장이라 배율이 안 남는다 */
  function 배율뺀값(u) {
    var 원 = u && u._원최대, k = u && +u._적HP배;
    if (!원 || !(k > 0) || k === 1) return null;
    var O = (typeof root !== 'undefined' && ((root.G2Opt && root.G2Opt.cfg) || (root.Opt && root.Opt.cfg))) || null, 풀림 = !!(O && O['상한해제'] === '리마스터') || (function () { try { var 덧 = (root.__상태 && root.__상태.ext && root.__상태.ext.덧값) || []; for (var i = 0; i < 덧.length; i++) if (덧[i] && 덧[i].열쇠 === 'LVCP' && 덧[i].값 && (덧[i].값[0] | 0)) return true; } catch (e) {} return false; })();   /* 정본 284 — 그 판 덧값 LVCP */
    var 레끝 = 풀림 ? 999 : 99, HP끝 = 풀림 ? 9999900 : 999900, MP끝 = 풀림 ? 99999 : 999;   /* state.js 적HP배 와 같은 상한 */
    var 배레 = (원.lv | 0) > 0 ? Math.max(1, Math.min(레끝, Math.round((원.lv | 0) * k))) : (u.level | 0);
    var 배HP = Math.min(HP끝, Math.max(100, Math.round((원.hp | 0) * k / 100) * 100)), 배MP = Math.min(MP끝, Math.round((원.mp | 0) * k));
    var 레 = (원.lv | 0) > 0 ? (원.lv | 0) + Math.max(0, (u.level | 0) - 배레) : (u.level | 0);
    var 최HP = (원.hp | 0) + Math.max(0, (u.maxHp | 0) - 배HP), 최MP = (원.mp | 0) + Math.max(0, (u.maxMp | 0) - 배MP);
    var 비 = (u.maxHp | 0) > 0 ? (u.hp | 0) / (u.maxHp | 0) : 1, 비m = (u.maxMp | 0) > 0 ? (u.mp | 0) / (u.maxMp | 0) : 1;
    return { level: 레, maxHp: 최HP, hp: (u.hp | 0) > 0 ? Math.min(최HP, Math.max(1, Math.round(최HP * 비))) : 0,
             maxMp: 최MP, mp: Math.min(최MP, Math.round(최MP * 비m)) };
  }

  function 동기화(u, 원본) {
    /* 셸의 옛 전투 사본은 `_원본`, 실제 전투 유닛은 `_raw._원본`을 가진다. */
    var rec = 원본 || u._원본 || (u._raw && u._raw._원본);
    if (!rec) throw new Error('유닛에 _원본 136B 가 없다');

    var B = 브리지();
    /* [리마스터 «적 능력 배율»] 배율 상태에서 레벨업한 유닛 — 원작 재계산(0x1796B)을 배율 끈 채 한 번 더 해 공격력·1차 능력치를 원래 값으로 (정본 199)
     *   (2026-11-14 사장님 「배율상태에서 명부에 있는 캐릭터가 적으로 나왔을때 그 캐릭터가 레벨업을 하면 어떻게 돼?」) */
    var _S = (typeof root !== 'undefined' && root.G2State) || null;
    if (u && u._배율중레벨업 && _S && typeof _S.레벨업재계산 === 'function') {
      u._적배끔 = true;
      try { _S.레벨업재계산(u); } catch (e배레) { if (typeof console !== 'undefined') console.warn('[적 배율] 저장 전 재계산 실패', e배레); }
      u._배율중레벨업 = false; u._배차 = { atk: 0, maxTp: 0 }; u._기준배차 = { atk: 0, maxTp: 0 };
    }
    if (B) {
      /* 사본 유닛(대문자)과 런타임 유닛(소문자)을 한 이름으로 모아 넘긴다 */
      var v = {};
      for (var k in u) if (Object.prototype.hasOwnProperty.call(u, k)) v[k] = u[k];
      var 뺀 = 배율뺀값(u);   /* [리마스터 «적 능력 배율»] 늘어난 레벨·HP·MP 는 명부에 안 쓴다 (정본 197) */
      if (뺀) { v.level = 뺀.level; v.maxHp = 뺀.maxHp; v.hp = 뺀.hp; v.maxMp = 뺀.maxMp; v.mp = 뺀.mp; }
      /* 공격력·최대 TP — 지금 배율 몫을 빼고 기준 때 몫을 더한다 · 브리지는 «base+장비 − 기준»을 저장값에 더하므로, 아군으로 시작해 대본으로 적이 된 유닛(캘리퍼)의 배율 몫이 «바뀐 만큼»으로 저장됐다 (정본 198) */
      var 배차 = u._배차 || { atk: 0, maxTp: 0 }, 기배 = u._기준배차 || { atk: 0, maxTp: 0 };
      if (u.base && ((배차.atk | 0) !== (기배.atk | 0) || (배차.maxTp | 0) !== (기배.maxTp | 0))) {
        v.base = Object.assign({}, u.base);
        v.base.atk = (u.base.atk | 0) - (배차.atk | 0) + (기배.atk | 0);
        v.base.maxTp = (u.base.maxTp | 0) - (배차.maxTp | 0) + (기배.maxTp | 0);
      }
      if (typeof u.HP === 'number' && v.hp == null) v.hp = Math.max(0, u.HP);
      if (typeof u.MP === 'number' && v.mp == null) v.mp = u.MP;
      if (typeof u.X === 'number' && v.x == null) v.x = u.X;
      if (typeof u.Y === 'number' && v.y == null) v.y = u.Y;
      B.되돌리기(v, rec);
      return rec;
    }

    /* 브리지가 없으면 옛 최소 동작 (넷만) */
    if (typeof u.HP === 'number') u32쓰기(rec, 0x48, Math.max(0, u.HP));
    if (typeof u.MP === 'number') u16쓰기(rec, 0x50, u.MP);
    if (typeof u.X === 'number') rec[0x00] = u.X & 0xFF;
    if (typeof u.Y === 'number') rec[0x01] = u.Y & 0xFF;
    return rec;
  }

  /**
   * ★★★ 전투 결과를 영구 `characters[]` 에 반영한다.
   *
   * @param 게임상태  `{characters:[…]}` — `characters[코드−1]._원본` 을 고친다
   * @param 전투사본  `battle_load.전투사본만들기()` 결과
   * @param 옵션      `{현재팀, 로그, 결과}` — `결과:'fail'` 이면 **아무것도 안 한다**
   */
  function 커밋(게임상태, 전투사본, 옵션) {
    옵션 = 옵션 || {};
    var 로그 = 옵션.로그 || null;
    var 현재팀 = (옵션.현재팀 != null) ? 옵션.현재팀
                : (게임상태 && 게임상태.progress ? 게임상태.progress.활동팀 : 0);

    /* ★ 패배는 커밋하지 않는다 — 호출부 전수(0x5071A·0x52D55)에 패배 경로가 없다 */
    if (옵션.결과 === 'fail') {
      if (로그) 로그.정보('commitBattleResult — 패배라 커밋하지 않는다 ' +
                          '(원본 0x50751 은 0x4EC51 을 안 부른다)');
      return { 반영: 0, 건너뜀: 0, 소환수: 0, 커밋안함: true };
    }
    if (!게임상태 || !게임상태.characters) throw new Error('characters[] 가 없다');
    if (!전투사본 || !전투사본.units) throw new Error('전투 사본이 없다');

    var 반영 = 0, 소환수 = 0, 밖 = 0, 목록 = [], 복귀 = 0;   /* 복귀 — [리마스터 아군 배치 복귀] 수 */
    전투사본.units.forEach(function (u) {
      var 그룹 = (u._그룹 != null) ? u._그룹 : u.그룹;
      /* ★ [리마스터] 그룹 0 밖(우군 등)에 두었다가 전향(0x0C · 0x525AA 팀 = 코드)으로 진행 팀이 된 캐릭터도 반영한다.
       *   원본은 파티 목록(그룹 0)만 쓰므로 전투 중 우군 합류가 남지 않는다 — 추가 합류 이벤트(3-3·4-3 라이어 · 7-3 쿠니)가 쓴다
       *   (2026-10-02 사장님 「라이어에게 아군 캐릭터가 접촉하면 아군으로 합류해야해」 · 리마스터_적용현황.md) */
      var 전향합류 = 그룹 !== 0 && u._전향합류 === true && u.팀 != null && 현재팀 != null && (u.팀 | 0) === (현재팀 | 0) && (u.side | 0) === 1;
      if (그룹 !== 0 && !전향합류) return;                     // 0x4EC80 파티 목록만
      /* [개발] 전투 중 «초기화»한 캐릭터 — 명부는 이미 처음 값으로 고쳤다 · 이 유닛 값으로 다시 덮지 않는다 (battle_main.js devCharReset · 정본 214) */
      if (u._개발초기화) { 밖++; if (로그) 로그.정보('  [개발] 초기화한 캐릭터라 명부에 쓰지 않는다 — ' + String(u.이름 || u.name || '').trim()); return; }

      /* ★★★ 0x113E4 — 커밋 대상 고르기 (2026-08-22 직독으로 되살렸다)
       *   0x113E9  edx = [eax+0x77]          부속(탑승자)
       *   0x113EE  test edx,edx / je
       *   0x113F0  eax = edx                 ★ **탑승자가 있으면 탑승자가 대상**
       *   0x113F2  cmp [eax+0x87],0 / je → return   소속 0 이면 건너뛴다
       *   0x1143C  [+0x5C] = 0               탈것 상태는 지운다
       *
       *   원본은 유닛이 **두 목록**에 있다(진영 0xCC968 · 파티 0xCC990). 0x113E4 가
       *   전장 레코드를 파티 레코드로 복사하고, 0x4EC80 부터 파티 목록만 커밋한다.
       *   우리는 목록이 하나라 **복사 자체는 필요 없고**, 고르는 규칙만 옮긴다.
       *   ★ 말 탄 캐릭터는 본체가 **탈것**이다 — 본체를 그대로 쓰면 BLACKBOX 에
       *     탈것 데이터가 저장된다. 실측: 그룹0 부속 171건(10-4.SCE 등 스프라이트 300+) */
      var 본체원본 = u._원본 || (u._raw && u._raw._원본);
      var 탑승자원본 = u._탑승자원본 ||
        (u._riderSnapshot && u._riderSnapshot._raw && u._riderSnapshot._raw._원본) ||
        (u._mechaSnapshot && u._mechaSnapshot._raw && u._mechaSnapshot._raw._원본) ||
        (u.rider && u.rider._raw && u.rider._raw._원본) || null;
      var 대상 = 탑승자원본 || 본체원본;                       // 0x113F0 탑승자 우선
      /* ★ 원본 기록이 없는 «아군 아닌» 그룹 0 유닛은 건너뛴다 — 2-5 처럼 적 전멸 뒤 증원으로 서는 적 장수(번스타인·카슈타르)는
       *   시나리오 파티 목록 칸에 있지만 세이브 파티원이 아니다(원본 0x113F2 는 소속 0 이면 건너뛴다).
       *   ☠ 예외를 던져 커밋이 멈추고 월드로 못 넘어갔다 (2026-10-03 사장님 「2-5 … 클리어 표시는 나지만 월드로 이동이 안돼」 ·
       *     「전멸 후 이동했는데 월드로 이동이 안됐어」 — 시험 탭 재현: 셸 틱예외 「유닛에 원본 136B가 없다」) */
      if (!대상 && (u.side | 0) !== 1) {
        밖++;
        if (로그) 로그.정보('  원본 기록이 없는 아군 아닌 유닛이라 건너뛴다 — ' + String(u.이름 || u.name || '').trim() + ' (진영 ' + (u.side | 0) + ')');
        return;
      }
      /* ★ 원본 기록이 없는 아군(소환수·전투 중 생긴 임시 유닛)은 건너뛴다 — 던지면 체인·결과 커밋이 통째로 서고 셸이 멈춘다
       *   (11-10 42-0A → 42-0B 체인 멈춤 조사 · 원본은 모든 유닛이 레코드를 가지므로 이 상황이 없고, 소환수는 0x4EC1F 가 안 쓴다) */
      if (!대상) {
        밖++;
        if (로그) 로그.경고('  원본 기록이 없는 아군 유닛이라 건너뛴다 — ' + String(u.이름 || u.name || '').trim());
        return;
      }
      if (대상[0x87] === 0) {                                  // 0x113F2 소속 0 이면 건너뜀
        밖++;
        if (로그) 로그.정보('  소속(+0x87)이 0 이라 건너뛴다 (0x113F2)');
        return;
      }

      /* ★★★ 탑승 중이면 **런타임 값을 탑승자에 합치지 않는다** (2026-08-22 정정)
       *   한때 본체의 HP·MP·X·Y 를 탑승자 레코드에 써 넣었는데 **원본에 근거가 없다.**
       *   하차 0x1808A 를 직독하니 방향이 분명하다:
       *     0x180AC~0x180D1  본체 → 탑승자로 옮기는 것은 x·y·[+0x6F]~[+0x73] 뿐
       *     0x180E8  edx = esi (탑승자)      ← 원본
       *     0x180EA  eax = ecx (본체)        ← 목적지
       *     0x180EC  call 0x61E59 (ebx=0x88) ← 136B 복사
       *   0x61E59 는 edi=eax · esi=edx · rep movsd 이므로 **탑승자 → 본체**다.
       *   ⇒ 하차하면 본체가 탑승자(원래 캐릭터)로 되돌아간다. **HP 는 옮기지 않는다.**
       *     탈것이 받은 피해는 캐릭터에게 이월되지 않는다 —
       *     스킬 16 마장기 0x3C548 이 원래 몸을 [+0x77] 에 **보관**하는 것과 같은 이치다.
       *   ⇒ 0x113E4 도 탑승자 136B 를 **그대로** 파티 레코드에 복사한다. 합치지 않는다.
       *   (GPT 6차 검수 지적 → 0x1808A·0x61E59 를 직접 읽어 확인) */
      /* ★★★ 단, 탄 동안 받은 경험치·레벨업은 보관된 사람 레코드(사본 객체)에 들었다 — 원본 0x179F4 가 [+0x77] 로 보낸다 (2026-10-05)
       *   그 사본을 사람 원본 기록에 되돌려 적는다(탈것 슬롯 값은 안 섞는다 — 위 원칙 그대로).
       *   ☠ 전에는 보존값만 써서 탄 채로 오른 레벨·능력치가 저장되지 않았다
       *   (사장님 「마장기 탑승 후 레벨업한 내용과 스탯이 탑승 해제했을때 적용되지 않아」 · 「타고 내리고 반복해도 계속 그대로 적용되어야해」) */
      var 몸객체 = u._mechaSnapshot || u._riderSnapshot || null;
      var 몸원본 = 몸객체 && 몸객체._raw && 몸객체._raw._원본;
      if (몸원본) 대상 = 몸원본;
      /* ★★★★★ 탈것을 «탄» 유닛이면 언제나 탑승자 기록 — 탈것 몸은 절대 동기화하지 않는다 (0x113E9~0x113F0 [+0x77]) (2026-10-11 탈것 전수)
       *   ☠ 배치 탑승(state.js 배치확정)·전투 중 탑승은 mount() 가 _raw 를 얕게 복사해 탑승자와 본체가 136B 버퍼를 함께 쓴다 →
       *     예전엔 «대상 === 본체원본» 으로 보고 탈것 몸(직업·그림)을 사람 기록에 썼다(탄 채 경험치 없이 끝난 경우 · 재현: 메이 직업 100 그림 303).
       *   ★ 탄 동안 얻은 경험치·레벨은 탑승자 사본(_riderSnapshot — combat.js 경험치받을이 · 보관몸)에 들고 위 갈래가 쓴다. */
      var 탄유닛 = !!(탑승자원본 && (u.rider || ((u.gear && u.gear.mount) | 0)));
      var rec = (몸원본 && 대상 === 몸원본) ? 회복적용(동기화(몸객체, 몸원본), 현재팀)
              : 탄유닛 ? 회복적용(대상, 현재팀)                 // 탑승자는 보존값 그대로
              : (대상 === 본체원본) ? 회복적용(동기화(u, 본체원본), 현재팀)
                                   : 회복적용(대상, 현재팀);   // 탑승자는 보존값 그대로
      rec[0x5C] = 0;                                           // 0x1143C 탈것 상태 지우기
      /* ★ 탑승자 기록을 쓸 때 — 전향(0x0C 갈래 0)이 바꾼 «탑승자 팀»은 기록에 남는다 (2026-10-11)
       *   원본 0x525B8 mov [edi+0x87], al — 부속([+0x77]) 136B 에 직접 쓴다. 우리 전향(sceapply 팀칸)은 rider.팀 에만 두므로 여기서 옮긴다.
       *   (23-2 랜담 — 마장기 본체 · 사람 탑승자 · 전향 코드 2 → 명부 팀 2 = 합류) */
      if (탑승자원본 && 대상 === 탑승자원본 && !몸원본 && (대상 !== 본체원본 || 탄유닛)) {
        var 탑객체 = (u.rider && u.rider._raw && u.rider._raw._원본 === 탑승자원본) ? u.rider : null;
        if (탑객체 && 탑객체.팀 != null && (rec[0x87] | 0) !== 0) rec[0x87] = 탑객체.팀 & 0xFF;   // 0x525A0 팀 0 이면 안 바꾼다
      }

      if (rec[0x12] !== 0) {                                   // 0x4EC1F 소환수는 안 쓴다
        소환수++;
        if (로그) 로그.정보('  소환수(코드 ' + rec[0x0F] + ') — BLACKBOX 에 쓰지 않는다');
        return;
      }
      /* ★ 0x4EC21 [+0x67]=0 · 0x4EC2A [+0x84]=0 · 0x12124 모션 정리는
       *   원본대로 **0x4EAF3 안**이므로 회복적용() 이 한다 (2026-08-22 중복 제거) */

      var 코드 = rec[0x0F];
      var ch = (코드 >= 1 && 코드 <= 게임상태.characters.length) ? 게임상태.characters[코드 - 1] : null;
      if (!ch || !ch._원본) {
        밖++;
        if (로그) 로그.경고('커밋: 캐릭터 코드 ' + 코드 + ' 가 characters[] 에 없다');
        return;
      }
      var 전HP = u32읽기(ch._원본, 0x48);
      /* 정본 365 — 명부 이름이 바뀌면 남긴다(이름 칸 +0x02~+0x0D). 레이몬드(코드 6)가 3-7 몬스터 «박쥐»(같은 코드 6) 이름으로 바뀐 신고가 있었는데
       *   처음 바뀐 때가 신고 콘솔에 없어 못 가렸다 (버그신고_20261121_144904 「라이어 박쥐로 변신 계속 박쥐로 나옴」) */
      (function () {
        var 다름 = false; for (var ni = 2; ni < 14; ni++) if ((ch._원본[ni] | 0) !== (rec[ni] | 0)) { 다름 = true; break; }
        if (!다름 || typeof console === 'undefined' || !console.warn) return;
        var S2 = (typeof root !== 'undefined' && root.G2Sce) || null, 이름 = function (b) { try { return S2 && S2.decodeJohab ? String(S2.decodeJohab(b, 2, 12)).trim() : ''; } catch (e) { return ''; } };
        console.warn('[명부] 코드 ' + 코드 + ' 이름이 바뀐다 «' + 이름(ch._원본) + '» → «' + 이름(rec) + '» · 유닛 ' + String(u.이름 || u.name || '').trim() + ' 그룹 ' + 그룹 + ' 진영 ' + (u.side | 0) + (전향합류 ? ' 전향합류' : '') + (u.summonerTag ? ' 소환수' : ''));
      })();
      ch._원본.set(rec.subarray ? rec.subarray(0, 유닛크기) : rec.slice(0, 유닛크기));  // ★ 136B 통째
      /* ★ [리마스터 규칙 «아군 배치 복귀»] 아군(그룹 0 · 진영 1)으로 배치돼 전투를 마쳤는데 명부 팀이 이 장면 소속표에서 아군(1)이 아니면 활동팀으로 합류.
       *   원작은 팀 칸을 통째로 복사만 한다(0x113E4 repne movs) — 번스타인(113)이 39-0A 에서 0x0C 코드 10(적 진영)으로 돌아선 뒤 43-0 에 아군 배치로
       *   돌아와도 명부 팀 10 그대로라 43-1 이후 후보(0x4EA35 소속표==1)에서 빠졌다 (2026-11-13 사장님 「이벤트로 번스타인 떠난후 흑태자 파티에 합류하지 않는 문제」).
       *   전수(34~44장 그룹 0 배치 중 팀 10 캐릭터) = 43-0 번스타인 하나 · 39-0A 는 전향 뒤 진영 2 라 안 걸린다 */
      (function () {
        var O = (typeof root !== 'undefined' && root.Opt && root.Opt.cfg) || null;
        if (O && O['아군배치복귀'] === '원작') return;
        var 표 = 옵션.소속표 || null, 팀지금 = ch._원본[0x87] | 0;
        if (!표 || 그룹 !== 0 || (u.side | 0) !== 1 || !현재팀 || !팀지금) return;
        if ((표[팀지금] | 0) === 1) return;
        ch._원본[0x87] = 현재팀 & 0xFF;
        복귀++;
        if (로그) 로그.정보('  [리마스터 아군 배치 복귀] 코드 ' + 코드 + ' 팀 ' + 팀지금 + '(소속표 ' + (표[팀지금] | 0) + ') → 활동팀 ' + 현재팀);
      })();
      /* G2X BASE는 136B 밖의 순수 능력치 원장이다. 전투 유닛의 성장값을 같이
       * 넘겨야 ExtSession 저장과 다음 시나리오가 장비 포함값을 역산하지 않는다. */
      var 성장원장 = (몸원본 && 대상 === 몸원본) ? 몸객체.순수 : (대상 === 본체원본) ? u.순수 : null;
      if (성장원장) ch.순수 = { str: 성장원장.str | 0, int: 성장원장.int | 0,
                                agi: 성장원장.agi | 0, cha: 성장원장.cha | 0 };
      /* ★ BLACKBOX 캐릭터를 SCE parser로 다시 읽지 않는다.
       * 두 포맷이 136B 레이아웃을 공유해도 **도메인 의미/필드명/문자열 계약**은 다르다.
       * 특히 SCE 쪽 이름 trim 경로가 BLACKBOX 고정폭 이름의 앞 공백을 잃게 했고,
       * `코드/팀`도 손보정이 필요했다. 이제 BLACKBOX가 자기 레코드를 다시 해석한다. */
      if (BB && BB.캐릭터동기화) BB.캐릭터동기화(ch);
      else if (Sce) {                                          // 구형 단독 테스트 호환 fallback
        var f = Sce.unitAt(ch._원본, 0);
        for (var k in f) if (Object.prototype.hasOwnProperty.call(f, k)) ch[k] = f[k];
        ch.코드 = ch._원본[0x0F];
        ch.팀   = ch._원본[0x87];
      }
      /* [개발 토글 «상한해제»] 레코드 레벨(+0x2B)은 255 에서 멈춘다 — 넘는 레벨은 명부 객체에 들고 저장 때 곁파일 BIG 으로 (정본 181) */
      (function () {
        var 몸 = (몸원본 && 대상 === 몸원본) ? 몸객체 : (대상 === 본체원본) ? u : null;
        if (!몸) return;
        var 뺀몸 = 배율뺀값(몸); if (뺀몸) 몸 = { level: 뺀몸.level, maxMp: 뺀몸.maxMp };   /* 적 배율로 늘어난 레벨·MP 는 큰 장부에도 안 쓴다 (정본 197) */
        /* ☠ 정본 191 — 레벨은 줄지 않는다: 유닛이 레코드의 255(멈춘 값)로 만들어진 경우에도 큰 레벨을 지우지 않는다 (2026-11-14 사장님 「아... 레벨 또 255 됐잖아.」) */
        if ((몸.level | 0) > Math.max(255, ch.큰레벨 | 0)) ch.큰레벨 = 몸.level | 0;
        if ((몸.maxMp | 0) > 65535) ch.큰MP = 몸.maxMp | 0; else if ((몸.maxMp | 0) < 65535) delete ch.큰MP;   /* 최대 MP — 레코드 2바이트 · 65535(멈춘 값)면 그대로 둔다 */
      })();
      목록.push({ 코드: 코드, HP: { from: 전HP, to: u32읽기(ch._원본, 0x48) } });
      반영++;
    });

    /* ★★★★★ **출전하지 않은 아군도 회복한다** — 원본 마스터 목록 0x4EA35~0x4EAD3 (2026-10-11 · CD본 직독)
     *   ```asm
     *   0x4EA35  di = 팀(1~) ; cmp [di×2 + 0x8DAF6], 1 / jne   ; ★ 시나리오 소속표[팀] == 1(아군)인 팀만
     *   0x4EA62~ BLACKBOX 레코드를 차례로 읽어 [+0x87] == di 이면                 ; 그 팀 캐릭터 «전원»
     *   0x4EAC1  [+0] x = 0xFF · 0x4EAC9 [+0x56] = 0xFF · 0x4EACF [+0x0E] = 1     ; 출전 안 함(x −1)
     *   0x4EAD3  call 0x1134F                                     ; 마스터 목록 [0xCC990] 에 넣는다
     *   ```
     *   전투 끝(승리·연결 0x4EC51)은 그 목록 «전원»에 0x4EAF3 을 건다 — 출전한 사람은 위 루프에서 이미 했다.
     *   (사장님 「왜 게임이 진행되는데 체력이 차지 않지? 출전하지않아도 체력이 회복되어야하는데?」)
     *   ☠ 우리는 전장 유닛(그룹 0)만 돌아, 출전 안 한 파티원·다른 아군 팀이 회복을 못 받았다. */
    var 소속표 = 옵션.소속표 || null;
    var 비출전 = 0;
    if (소속표) {
      var 한코드 = {};
      목록.forEach(function (m) { 한코드[m.코드 | 0] = 1; });
      게임상태.characters.forEach(function (ch, i) {
        if (!ch || !ch._원본) return;
        var 코드 = i + 1, 팀 = ch._원본[0x87] | 0;
        if (한코드[코드] || !팀 || (소속표[팀] | 0) !== 1) return;     /* 0x4EA35 · 0x4EA8D */
        if (ch._원본[0x12]) return;                                   /* 0x4EC1F 소환수는 안 쓴다 */
        var 전HP2 = u32읽기(ch._원본, 0x48);
        회복적용(ch._원본, 현재팀);                                  /* 0x4EAF3 — 같은 식 */
        if (BB && BB.캐릭터동기화) BB.캐릭터동기화(ch);
        목록.push({ 코드: 코드, 출전안함: true, HP: { from: 전HP2, to: u32읽기(ch._원본, 0x48) } });
        비출전++;
      });
      if (로그 && 비출전) 로그.정보('  출전 안 한 아군 ' + 비출전 + '명 회복 (0x4EA35 마스터 목록)');
    }

    /* ★ 전투 중 창고로 간 아이템 — `0x4ECE4` 가 `[0x8E4FF + 활동팀×0x1E]` 에 개수·코드−1 을 쌓고,
     *   `0x4E622` 가 팀 목록을 쓸 때 **옛 목록 뒤에 이어 쓴다** (`0x4E7DF cmp si,[esp]` → `0x4E807`).
     *   승리(`0x50715`)·체인(`0x52D50`)만 쓰고 패배(`0x50751`)는 안 쓴다 — 위 `fail` 조기 반환과 같다.
     *   (2026-10-02 사장님 「스토리 진행중 아이템 얻는 것도 적용 안돼」 — 전엔 battle 에 기록만 하고 버렸다) */
    var 획득 = (전투사본.획득아이템 || []).filter(function (c) { return (c | 0) > 0; });
    var 창고 = 게임상태.parties && 게임상태.parties[현재팀 | 0];
    if (획득.length && !전투사본._획득반영) {
      if (!창고 || !Array.isArray(창고.아이템))
        throw new Error('commitBattleResult — 활동팀 ' + 현재팀 + ' 창고가 없어 획득 아이템 ' + 획득.length + '개를 못 넣는다');
      /* ☠★★★★★ **빈 칸(0) 뒤에 붙이면 안 보인다** (2026-10-06)
       *   > 사장님: 「기존에 보조 슬롯에 엑스칼리버가 있었고 다른아이템을 먹으면서 기존 아이템을 창고로 보냈고 나와서 전직했는데 없어졌어」 ·
       *   >  「빈공간이 스크롤 아래에 두칸 생겼어 지혜의 반지도 함께 없어졌어」 · 「4번세이브에서 캘리퍼 깨고 빙룡성 깨고 발생한거라고」
       *   장비창은 창고에서 꺼낼 때 당기고 «맨 끝을 0»으로 남긴다(screens.js 목록압축) — 배열 길이는 그대로다.
       *   여기서 push 하면 획득 아이템이 그 0 들 «뒤»에 붙고, 창고 스크롤 상한(찬 칸 − 6)이 0 까지만 내려가 영영 안 보였다.
       *   원본은 «찬 개수 다음 자리»에 이어 쓴다(0x4E7DF cmp si,[esp] → 0x4E807) — 빈 칸을 먼저 걷는다. */
      빈칸걷기(창고.아이템);
      획득.forEach(function (c) { 창고.아이템.push(c | 0); });
      전투사본._획득반영 = true;
      if (로그) 로그.정보('  획득 아이템 ' + 획득.join(',') + ' → 팀 ' + 현재팀 + ' 창고 (0x4E807)');
    }

    /* [리마스터 동반합류] 전투 중 0x0C 로 팀이 바뀐 기준 캐릭터의 동료를 명부에서 따라 옮긴다 (extroster.js 동반규칙) */
    var _ER2 = (typeof root !== 'undefined' && root && root.G2ExtRoster) || null;
    if (_ER2 && _ER2.동반합류 && 전투사본.동반합류 && !전투사본._동반반영) {
      전투사본.동반합류.forEach(function (d) { _ER2.동반합류(게임상태.characters, d.기준, d.팀, 로그, { 시나리오: d.시나리오 }); });
      전투사본._동반반영 = true;
    }
    /* [리마스터] 맵에 없는 캐릭터의 명부 합류(SCE 0x0C kind 0x80 · sceapply 명부합류) — 동반 규칙도 함께 */
    if (전투사본.명부합류 && !전투사본._명부합류반영) {
      전투사본.명부합류.forEach(function (d) {
        var ch2 = 게임상태.characters[(d.코드 | 0) - 1];
        if (!ch2) return;
        /* [리마스터] 팀 0 = «지금 진행 팀»(현재팀 · [0x8DF85]) — 무덤처럼 들어오는 팀이 판마다 다를 때 (2026-10-12 안내인의 방 안내인 합류) */
        var 팀2 = (d.팀 | 0) || (현재팀 | 0);
        if (!팀2) return;
        ch2.팀 = 팀2;
        if (ch2._원본) ch2._원본[0x87] = 팀2 & 0xFF;
        if (로그) 로그.정보('  명부 합류 — 캐릭터 ' + d.코드 + ' → 팀 ' + 팀2);
        if (_ER2 && _ER2.동반합류) _ER2.동반합류(게임상태.characters, d.코드, 팀2, 로그);
      });
      전투사본._명부합류반영 = true;
    }
    if (로그) 로그.정보('commitBattleResult — ' + 반영 + '명 반영 · 소환수 ' + 소환수 +
                        (밖 ? ' · 범위 밖 ' + 밖 : ''));
    return { 반영: 반영, 소환수: 소환수, 범위밖: 밖, 목록: 목록, 획득: 획득.length, 커밋안함: false, 출전안함회복: 비출전 };
  }

  /**
   * ★ 전투가 끝날 때 날짜·시각을 BLACKBOX 로 되쓴다 — 원본 0x4E622 (2026-09-26 · Z-70)
   *   부르는 자리는 0x4EC51 커밋과 같다: 0x50715(op 0x01 승리) · 0x52D50(op 0x12 체인)
   *   ```asm
   *   0x4E646  call 0x19D47 (= [0xF0418] 틱) / div 900
   *   0x4E64F  나머지 ≠ 0 → [0xFDF84] = ([0xFDF84]+1) % 16
   *   0x4E672  짝수 → 시각>>1 · 홀수 → (시각>>1)+1        ; 0~15 → 세부틱 0~8
   *   0x4E692  cmp 7 / jbe — 7 넘으면 누적일+1 · 세부틱 0
   *   0x4E6C4  write 누적일 2B · 0x4E6DB write 세부틱 1B   ; BLACKBOX +1 · +3
   *   ```
   * @param bb    `G2Blackbox.파싱()` 결과 (누적일·일자세부틱·_원본)
   * @param 전투  turn·timeIdx·dayIdx 를 가진 전투 상태
   */
  function 날짜되쓰기(bb, 전투) {
    if (!bb || !전투) return null;
    var 시각 = (전투.timeIdx | 0) & 0xFF;
    var 날 = (전투.dayIdx | 0) & 0xFFFF;
    if (((전투.turn >>> 0) % 900) !== 0) 시각 = (시각 + 1) % 16;        // 0x4E64F
    시각 = (시각 & 1) ? (시각 >> 1) + 1 : (시각 >> 1);                    // 0x4E672
    if (시각 > 7) { 날 = (날 + 1) & 0xFFFF; 시각 = 0; }                   // 0x4E692
    bb.누적일 = 날;
    bb.일자세부틱 = 시각;
    bb.연 = 1207 + Math.floor(날 / 220);
    bb.일 = 날 % 220;
    if (bb._원본 && bb._원본.length > 3) {                                 // 런타임 DAT 뷰도 같이
      u16쓰기(bb._원본, 1, 날);
      bb._원본[3] = 시각;
    }
    return { 누적일: 날, 세부틱: 시각 };
  }

  var API = { 커밋: 커밋, 날짜되쓰기: 날짜되쓰기, 회복적용: 회복적용, 동기화: 동기화, 유닛크기: 유닛크기 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.G2BattleCommit = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
