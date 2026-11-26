/* ============================================================
 *  세이브 내보내기·가져오기 — `G2세이브옮기기` (정본 480 · 2026-11-26 · [리마스터])
 *
 *  사장님 11-26 「세이브 내보내기 가져오기 만들어줘」 — PC 와 휴대폰을 오가며 세이브를 같이 쓰고 싶다는 문의
 *  ☠ 안드로이드는 세이브 폴더가 앱 안쪽(/data/user/0/…)이라 파일 관리자·PC 연결로 못 열어 옮길 길이 없었다
 *
 *  꾸러미 = 파일 하나(JSON) — 슬롯 1~5 마다 BLACKBOX.SVn · CHAPDATA/CONTIBAK.SVn · BLACKBOX.SVn.G2X(덧세이브)를 base64 로
 *  읽기 : GET /__환경(세이브파일 목록) → /원본/<이름>?state=1   (캐릭터 에디터와 같은 길 · 서버는 안 고침)
 *  쓰기 : POST /__세이브 { 번호, blackbox, contibak, g2x }   (게임 저장과 같은 창구 · 세 파일을 한꺼번에 · 실패하면 되돌림)
 *  내놓기 : PC — 내려받기(<a download>) · 휴대폰 — 본체 창구 POST 127.0.0.1:47861/saveexport 가
 *           원본 CD 파일을 넣던 보이는 폴더 옆 «세이브내보내기» 에 쓴다(안드로이드 Android/data/kr.genesis2.remaster/files · 아이폰 파일 앱 문서 폴더)
 *  가져오기 : 파일 고르기 → 무엇을 덮는지 보이고 «가져오기» 를 한 번 더 → 덮기 전에 지금 세이브를 먼저 내보내 둔다(이 기기에도 한 벌)
 * ============================================================ */
(function (root) {
  'use strict';
  var 물음 = ''; try { 물음 = decodeURIComponent(location.search || ''); } catch (e) { 물음 = location.search || ''; }
  var 모바일 = /[?&]모바일=1/.test(물음);
  var 본체 = 'http://127.0.0.1:47861';
  var 표지 = '창세기전2 리마스터 세이브';
  var 앞자리열쇠 = 'g2.세이브가져오기전';   /* 가져오기 바로 앞 세이브 한 벌 — 되돌리기 */
  var 창 = null, 대기 = null;

  function b64(u8) { var s = '', C = 0x8000; for (var i = 0; i < u8.length; i += C) s += String.fromCharCode.apply(null, u8.subarray(i, i + C)); return btoa(s); }
  function 받기(이름, 없어도) {
    var url = '/원본/' + 이름.split('/').map(encodeURIComponent).join('/') + '?state=1';
    return fetch(url, { cache: 'no-store' }).then(function (r) {
      if (!r.ok) { if (없어도) return null; throw new Error(이름 + ' — HTTP ' + r.status); }
      return r.arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }, function (e) { if (없어도) return null; throw e; });
  }
  function 슬롯목록() {
    return fetch('/__환경', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (e) {
      return ((e && e.세이브파일) || []).filter(function (m) { return (m.번호 | 0) >= 1 && (m.번호 | 0) <= 5; });
    });
  }
  /** 지금 세이브 슬롯 전부 → 꾸러미 */
  function 묶기() {
    return 슬롯목록().then(function (목) {
      return Promise.all(목.map(function (m) {
        return Promise.all([받기(m.blackbox), 받기(m.contibak), 받기(m.blackbox + '.G2X', true)]).then(function (셋) {
          return { 번호: m.번호 | 0, 시각: m.시각 || null, blackbox: b64(셋[0]), contibak: b64(셋[1]), g2x: (셋[2] && 셋[2].length) ? b64(셋[2]) : null };
        });
      }));
    }).then(function (슬롯) {
      슬롯.sort(function (a, b) { return a.번호 - b.번호; });
      return { 종류: 표지, 판: root.G2리마스터판 || '', 때: new Date().toISOString(), 슬롯: 슬롯 };
    });
  }
  function 이름짓기(머리) {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return 머리 + '_' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '_' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + '.json';
  }
  /** 꾸러미를 파일로 내놓는다 → 놓은 곳 글 */
  function 내놓기(꾸러미, 이름) {
    var 글 = JSON.stringify(꾸러미);
    if (모바일) {
      return fetch(본체 + '/saveexport', { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ 이름: 이름, 글: 글 }) })
        .then(function (r) { return r.json(); })
        .then(function (j) { if (!j || !j.ok) throw new Error((j && j.말) || '파일을 쓰지 못했습니다'); return j.보이기 || j.길; });
    }
    var a = document.createElement('a'), u = URL.createObjectURL(new Blob([글], { type: 'application/json' }));
    a.href = u; a.download = 이름; document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(u); a.remove(); } catch (e) { } }, 4000);
    return Promise.resolve('내려받기(저장한 곳)');
  }
  /** 꾸러미가 맞는가 — 슬롯 번호 1~5 · 명부·지도 바이트가 있음 */
  function 살피기(j) {
    if (!j || j.종류 !== 표지 || !Array.isArray(j.슬롯)) throw new Error('창세기전 2 리마스터 세이브 파일이 아닙니다');
    var 본 = {};
    j.슬롯.forEach(function (s) {
      var n = s && (s.번호 | 0);
      if (!(n >= 1 && n <= 5) || 본[n] || !s.blackbox || !s.contibak) throw new Error('세이브 파일이 깨졌습니다 (슬롯 ' + (s && s.번호) + ')');
      본[n] = 1;
    });
    if (!j.슬롯.length) throw new Error('세이브 파일에 슬롯이 없습니다');
    return j;
  }
  function 쓰기(j) {
    var 차례 = Promise.resolve(), 쓴 = [];
    j.슬롯.forEach(function (s) {
      차례 = 차례.then(function () {
        var 몸 = { 번호: s.번호 | 0, blackbox: s.blackbox, contibak: s.contibak, g2x: s.g2x || null, 덧세이브비움: !s.g2x };
        return fetch('/__세이브', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(몸) })
          .then(function (r) { return r.json(); })
          .then(function (r) { if (!r || !r.ok) throw new Error('슬롯 ' + s.번호 + ' — ' + ((r && r.말) || '저장 실패')); 쓴.push(s.번호 | 0); });
      });
    });
    return 차례.then(function () {
      var A = root.__상태 && root.__상태.자산; if (A) A.세이브캐시 = null;   /* 불러오기 화면이 새 내용을 보게 (캐릭터 에디터와 같음) */
      return 쓴;
    });
  }
  function 슬롯글(s) { return '슬롯 ' + s.번호 + (s.시각 ? ' (' + s.시각 + ')' : ''); }

  /* ── 창 ─────────────────────────────────────────────────────────────── */
  function 알림(글, 빨강) { var e = 창 && 창.querySelector('.g2옮기기-알림'); if (e) { e.textContent = 글; e.style.color = 빨강 ? '#ff9a8a' : '#ffcf8a'; } }
  function 단추들(목) {
    var 줄 = 창.querySelector('.g2옮기기-단추'); 줄.innerHTML = '';
    목.forEach(function (b) {
      var bt = document.createElement('button'); bt.textContent = b[0]; bt.setAttribute('data-k', b[1]);
      bt.style.cssText = 'font:14px "Malgun Gothic",sans-serif;color:#f8e890;background:#4a5e4a;border:2px solid #1c1c1c;padding:6px 14px;cursor:pointer';
      bt.addEventListener('click', function (e) { e.stopPropagation(); 누름(b[1]); });
      줄.appendChild(bt);
    });
    var 첫 = 줄.querySelector('button'); if (첫) setTimeout(function () { try { 첫.focus(); } catch (e) { } }, 20);
  }
  function 처음단추() { 대기 = null; 단추들([['내보내기', '내보내기'], ['가져오기', '가져오기']].concat(앞자리있나() ? [['가져오기 전으로 되돌리기', '되돌리기']] : []).concat([['닫기 (Esc)', '닫기']])); }
  function 앞자리있나() { try { return !!localStorage.getItem(앞자리열쇠); } catch (e) { return false; } }
  function 열기() {
    if (창) return;
    창 = document.createElement('div');
    창.className = 'g2옮기기';
    창.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font:15px "Malgun Gothic",sans-serif;';
    창.innerHTML =
      '<div style="background:#1c2620;border:2px solid #7c9478;color:#f0e0a0;padding:18px 20px;width:min(560px,92vw);box-shadow:0 8px 30px #000">' +
      '<div style="font-size:19px;margin-bottom:8px">세이브 내보내기 · 가져오기</div>' +
      '<div class="g2옮기기-글" style="color:#c8b890;font-size:13px;line-height:1.6;margin-bottom:10px">' +
      '세이브 슬롯 1~5 를 파일 하나로 내보내고, 다른 기기(PC·휴대폰)에서 그 파일을 가져옵니다.<br>' +
      (모바일 ? '휴대폰은 내보낸 파일이 원본 CD 파일을 넣던 폴더 옆 «세이브내보내기» 폴더에 생깁니다.' : 'PC 는 저장할 곳을 묻거나 «다운로드» 폴더에 저장됩니다.') +
      '<br>가져오면 같은 번호 슬롯을 덮어씁니다 — 덮기 전에 지금 세이브를 먼저 내보내 둡니다.</div>' +
      '<input type="file" accept=".json,application/json" style="display:none">' +
      '<div class="g2옮기기-알림" style="min-height:20px;margin:8px 0;color:#ffcf8a;font-size:13px;word-break:break-all;white-space:pre-line"></div>' +
      '<div class="g2옮기기-단추" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"></div></div>';
    창.querySelector('input[type=file]').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; e.target.value = '';
      if (!f) return;
      알림('읽는 중…');
      var rd = new FileReader();
      rd.onload = function () {
        try { 대기 = 살피기(JSON.parse(String(rd.result))); }
        catch (e2) { 대기 = null; 알림('가져오지 못했습니다 — ' + (e2 && e2.message), true); return; }
        알림(f.name + (대기.판 ? ' · ' + 대기.판 : '') + '\n' + 대기.슬롯.map(슬롯글).join('\n') + '\n\n위 슬롯 번호를 덮어씁니다. 가져올까요?');
        단추들([['가져오기', '확정'], ['그만두기', '처음']]);
      };
      rd.onerror = function () { 알림('파일을 읽지 못했습니다', true); };
      rd.readAsText(f);
    });
    /* 창 안의 키·누름은 게임으로 새지 않게 · 방향키로 단추 사이를 옮긴다 (버그 신고 창과 같음) */
    ['keydown', 'keyup', 'keypress', 'mousedown', 'mouseup', 'click', 'wheel', 'contextmenu'].forEach(function (t) {
      창.addEventListener(t, function (e) {
        if (t === 'keydown') {
          if (e.key === 'Escape') 닫기();
          else if (/^Arrow(Left|Right|Up|Down)$/.test(e.key)) {
            var bs = Array.prototype.slice.call(창.querySelectorAll('.g2옮기기-단추 button')), i = bs.indexOf(document.activeElement);
            var n = bs.length; if (n) { i = (i < 0 ? 0 : (i + (/Left|Up/.test(e.key) ? n - 1 : 1)) % n); bs[i].focus(); }
            e.preventDefault();
          }
        }
        e.stopPropagation();
      });
    });
    document.body.appendChild(창);
    처음단추();
  }
  function 닫기() { if (창 && 창.parentNode) 창.parentNode.removeChild(창); 창 = null; 대기 = null; }
  function 누름(k) {
    if (k === '닫기') return 닫기();
    if (k === '처음') { 알림(''); return 처음단추(); }
    if (k === '가져오기') { var inp = 창.querySelector('input[type=file]'); if (inp) inp.click(); return; }
    if (k === '내보내기') {
      알림('묶는 중…');
      return 묶기().then(function (j) {
        if (!j.슬롯.length) throw new Error('내보낼 세이브가 없습니다');
        return 내놓기(j, 이름짓기('창세기전2세이브')).then(function (곳) { 알림('내보냈습니다 — ' + j.슬롯.map(function (s) { return '슬롯 ' + s.번호; }).join(' · ') + '\n' + 곳); });
      })['catch'](function (e) { 알림('내보내지 못했습니다 — ' + (e && e.message), true); });
    }
    if (k === '확정' && 대기) {
      var j = 대기; 대기 = null; 단추들([]);
      알림('지금 세이브를 먼저 내보내는 중…');
      return 묶기().then(function (앞) {
        try { localStorage.setItem(앞자리열쇠, JSON.stringify(앞)); } catch (e) { }   /* 되돌리기 한 벌 (이 기기) */
        /* 휴대폰은 파일로도 한 벌 · PC 는 저장 창을 또 띄우지 않는다(되돌리기 단추로 충분) */
        return (모바일 && 앞.슬롯.length) ? 내놓기(앞, 이름짓기('창세기전2세이브_가져오기전'))['catch'](function () { return null; }) : null;
      }).then(function (앞곳) {
        알림('가져오는 중…');
        return 쓰기(j).then(function (쓴) {
          알림('가져왔습니다 — 슬롯 ' + 쓴.join(' · ') + '\n불러오기에서 고르면 됩니다.' + (앞곳 ? '\n(가져오기 전 세이브: ' + 앞곳 + ')' : ''));
          처음단추();
        });
      })['catch'](function (e) { 알림('가져오지 못했습니다 — ' + (e && e.message), true); 처음단추(); });
    }
    if (k === '되돌리기') {
      var 앞 = null; try { 앞 = 살피기(JSON.parse(localStorage.getItem(앞자리열쇠))); } catch (e) { 알림('되돌릴 세이브가 없습니다', true); return; }
      대기 = 앞;
      알림('가져오기 바로 전 세이브(' + (앞.때 || '') + ')\n' + 앞.슬롯.map(슬롯글).join('\n') + '\n\n이것으로 되돌릴까요?');
      단추들([['되돌리기', '확정'], ['그만두기', '처음']]);
    }
  }

  var API = { 열기: 열기, 닫기: 닫기, 열림: function () { return !!창; }, 묶기: 묶기, 살피기: 살피기, 쓰기: 쓰기, 표지: 표지 };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.G2세이브옮기기 = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
