/*
 * 매일 한자 — 평일 아침 5분 한자 학습
 *
 * 학습 흐름 (에빙하우스 망각 곡선에 맞춘 반복)
 *   월~금: ① 1일 후 복습(지난 학습일의 한자 + 틀렸던 한자)
 *          ② 오늘의 한자 + 활용 어휘 뜻 연결하기
 *          ③ 짧은 글짓기
 *          ④ 확인 퀴즈(음훈 쓰기, 활용 어휘가 아닌 것 고르기) → 풀이
 *   금요일: 위 과정 + ⑤ 이번 주 한자 전체 복습(일주일 복습)
 *   급수 완료: '급수 시험' 코너에서 전체 복습 → 시험(어휘 제시, 뜻과 음 쓰기)
 *
 * 저장: 브라우저 localStorage에 이름(아이디)별로 저장하고, js/cloud.js가 Firebase와 맞춰
 *       다른 기기에서도 이어서 공부할 수 있게 합니다.
 */
(() => {
  'use strict';

  const USERS_KEY = 'everyday-hanja:users';
  const CURRENT_KEY = 'everyday-hanja:current';
  const PW_KEY = 'everyday-hanja:pw';
  const TEACHER_KEY = 'everyday-hanja:teacher';
  const stateKey = (name) => `everyday-hanja:v2:${name}`;
  const DAY = ['일', '월', '화', '수', '목', '금', '토'];
  const MAX_EXTRA_REVIEW = 2; // 매일 복습에 더하는 '틀린 한자' 최대 개수

  const $app = document.getElementById('app');

  /* ================= 날짜 ================= */
  // ?date=2026-10-02 처럼 날짜를 바꿔 미리 볼 수 있습니다(테스트용).
  function today() {
    const q = new URLSearchParams(location.search).get('date');
    if (q && /^\d{4}-\d{2}-\d{2}$/.test(q)) return parseDate(q);
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  }
  function fmt(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function parseDate(s) {
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
  }
  function mondayOf(d) {
    const dow = d.getDay();
    return addDays(d, dow === 0 ? -6 : 1 - dow);
  }
  const isWeekday = (d) => d.getDay() >= 1 && d.getDay() <= 5;
  const koDate = (d) => `${d.getMonth() + 1}월 ${d.getDate()}일 ${DAY[d.getDay()]}요일`;
  const shortDate = (ds) => { const d = parseDate(ds); return `${d.getMonth() + 1}/${d.getDate()}(${DAY[d.getDay()]})`; };

  /* ================= 저장 (학생별) ================= */
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  const cloud = window.Cloud || { on: false, pullAll: async () => false, pullOne: async () => false, onConflict() {}, changed() {}, flush() {} };
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } cloud.changed(k); }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } cloud.changed(k); }

  function blankState() {
    return {
      // 진행 단계: level(레벨테스트) → study(틀린 한자 학습) → exam(급수 시험) → relearn(틀린 한자 다시 보기) → exam …
      phase: 'level',
      gradeIdx: 0,     // 지금 공부하는 급수
      queue: [],       // 이번 급수에서 배울 한자(레벨테스트에서 틀린 한자)
      relearn: [],     // 급수 시험에서 틀려 다시 볼 한자
      test: null,      // 진행 중인 레벨테스트·급수 시험
      known: {},       // idx -> 레벨테스트에서 이미 알았던 날짜
      passed: {},      // 급수 id -> 통과한 날짜
      levels: {},      // 급수 id -> { date, known, total }
      learned: {},     // idx -> 배운 날짜
      order: [],       // 배운 순서
      log: {},         // 날짜 -> { newIdx, reviews, week, done, quiz, extra }
      missed: [],      // 틀린 한자(다음 복습에 다시 나옴)
      weekly: {},      // 월요일 날짜 -> 주간 복습 완료
      exams: {},       // 급수 id -> { best, last, attempts, date }
      activity: [],    // 학습 활동 누적 기록
      writings: [],    // 짧은 글짓기 { date, idx, text }
      pending: [],     // 선생님 확인을 기다리는 애매한 답 { kind, grade, idx, m, s, date }
      oldSeen: {},     // idx -> '지난 급수 복습'으로 마지막에 본 날짜
      oldReviewDate: null, // 입장 복습을 마지막으로 한 날짜 (하루 한 번)
      yReviewDate: null,   // 입장 복습에서 어제 배운 한자 복습까지 한 날짜
      time: {},        // 날짜 -> 그날 실제로 공부한 시간(초)
      cheerDate: null, // 5분 격려를 보여 준 날짜
    };
  }
  function users() {
    try { return JSON.parse(lsGet(USERS_KEY)) || []; } catch (e) { return []; }
  }
  function loadState(name) {
    try {
      const raw = lsGet(stateKey(name));
      if (raw) {
        const st = Object.assign(blankState(), JSON.parse(raw));
        if (!JSON.parse(raw).phase) Object.assign(st, { phase: 'level', gradeIdx: 0, queue: [] }); // 예전 기록은 레벨테스트부터
        return st;
      }
    } catch (e) { /* 새로 시작 */ }
    return blankState();
  }

  // 비밀번호: 친구 기록에 들어가지 못하게 막는 정도의 간단한 보호입니다.
  function pwHash(name, pw) {
    const str = `everyday-hanja|${name}|${pw}`;
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }
  function passwords() {
    try { return JSON.parse(lsGet(PW_KEY)) || {}; } catch (e) { return {}; }
  }
  function setPassword(name, pw) {
    const all = passwords();
    all[name] = pwHash(name, pw);
    lsSet(PW_KEY, JSON.stringify(all));
  }
  const hasPassword = (name) => !!passwords()[name];
  const checkPassword = (name, pw) => passwords()[name] === pwHash(name, pw);
  const teacherSet = () => !!lsGet(TEACHER_KEY);
  const checkTeacher = (pw) => lsGet(TEACHER_KEY) === pwHash('__teacher__', pw);
  const setTeacher = (pw) => lsSet(TEACHER_KEY, pwHash('__teacher__', pw));

  let user = null;
  let S = blankState();
  let justEntered = true; // 앱을 막 열었거나 입장한 참 (지난 급수 복습을 띄울지 볼 때)
  function restoreUser() {
    user = lsGet(CURRENT_KEY);
    if (user && (!users().includes(user) || !hasPassword(user))) user = null;
    S = user ? loadState(user) : blankState();
  }
  function save() {
    if (user) lsSet(stateKey(user), JSON.stringify(S));
  }
  function addUser(name) {
    const list = users();
    if (!list.includes(name)) {
      list.push(name);
      lsSet(USERS_KEY, JSON.stringify(list));
    }
  }
  function removeUser(name) {
    lsSet(USERS_KEY, JSON.stringify(users().filter((n) => n !== name)));
    const all = passwords();
    delete all[name];
    lsSet(PW_KEY, JSON.stringify(all));
    lsDel(stateKey(name));
  }
  function login(name) {
    justEntered = true;
    user = name;
    lsSet(CURRENT_KEY, name);
    S = loadState(name);
    session = null;
    listGrade = null;
    teacherOk = false;
  }
  function logout() {
    user = null;
    lsDel(CURRENT_KEY);
    S = blankState();
    session = null;
  }
  function logActivity(a) {
    S.activity.push(Object.assign({ date: fmt(today()) }, a));
  }

  /* ================= 한자 도우미 ================= */
  const C = (i) => HANJA[i];
  const BY_CHAR = {};
  HANJA.forEach((c) => { BY_CHAR[c.h] = c; });
  const gradeOf = (c) => GRADES[c.gradeIdx];
  function hunum(c) {
    if (c.meanings.length === c.sounds.length) {
      return c.meanings.map((m, i) => `${m} ${c.sounds[i]}`).join(' / ');
    }
    return `${c.meanings.join(', ')} ${c.sounds.join(', ')}`;
  }
  const shuffle = (a) => {
    const x = a.slice();
    for (let i = x.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [x[i], x[j]] = [x[j], x[i]];
    }
    return x;
  };
  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const esc = (t) => String(t).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  // 어휘 속 한 글자의 음훈. 어휘에서 실제로 읽는 소리(두음 법칙 포함)에 맞춰 고릅니다.
  function charHunum(ch, syl) {
    let pairs;
    const c = BY_CHAR[ch];
    if (c) {
      if (c.meanings.length === c.sounds.length) pairs = c.meanings.map((m, i) => [m, c.sounds[i]]);
      else pairs = c.sounds.map((s) => [c.meanings.join('·'), s]);
    } else if (EXTRA_HUNUM[ch]) {
      pairs = EXTRA_HUNUM[ch].split('|').map((p) => {
        const k = p.lastIndexOf(' ');
        return [p.slice(0, k), p.slice(k + 1)];
      });
    } else {
      return { m: '', s: syl || '' };
    }
    for (const [m, s] of pairs) {
      if (syl === s) return { m, s };
      if (syl && syl === dueum(s)) return { m, s: syl };
    }
    return { m: pairs[0][0], s: pairs[0][1] };
  }
  function wordParts(w) {
    const read = w.read.replace(/\s/g, '');
    return [...w.word].map((ch, k) => Object.assign({ ch }, charHunum(ch, read[k])));
  }
  // 어휘 한자 + 각 글자 아래 작은 음훈
  function wordCharsHtml(w, target, showHunum = true) {
    return `<div class="wchars">${wordParts(w).map((p) => `
      <span class="wc${p.ch === target ? ' on' : ''}"><b class="hanja">${p.ch}</b>${showHunum ? `<small>${p.m} <strong>${p.s}</strong></small>` : ''}</span>`).join('')}</div>`;
  }


  // 다음에 배울 한자: 이번 급수 레벨테스트에서 틀린 한자 가운데 아직 배우지 않은 것
  // 다음에 배울 한자: 전날까지 틀려서 다시 배울 한자가 먼저, 그다음 아직 배우지 않은 한자
  function nextNewIdx() {
    if (S.phase !== 'study') return null;
    const ds = fmt(today());
    const redo = (S.redo || []).find((r) => r.date < ds);
    if (redo) return redo.idx;
    const i = S.queue.find((x) => !S.learned[x]);
    return i === undefined ? null : i;
  }
  const isRedo = (i) => (S.redo || []).some((r) => r.idx === i);
  const curGrade = () => GRADES[Math.min(S.gradeIdx, GRADES.length - 1)];
  // 남은 한자 = 아직 안 배운 한자 + 틀려서 다시 배울 한자 (완전 학습이 되어야 급수 시험)
  const queueLeft = () => S.queue.filter((x) => !S.learned[x]).length + (S.redo || []).length;
  // 틀린 한자를 모두 배우면 급수 시험 단계로 넘어갑니다.
  function syncPhase() {
    // 예전에 선생님 인정으로 100점이 되었는데 넘어가지 못한 기록도 고쳐요
    if (checkExamPass(S)) save();
    if (S.phase === 'study' && !queueLeft() && !(session && session.type !== 'review')) {
      S.phase = 'exam';
      save();
    }
  }
  function lastLearnedBefore(ds) {
    for (let k = S.order.length - 1; k >= 0; k--) {
      const i = S.order[k];
      if (S.learned[i] < ds) return i;
    }
    return null;
  }
  function weekDates(d) {
    const mon = mondayOf(d);
    return [0, 1, 2, 3, 4].map((n) => fmt(addDays(mon, n)));
  }
  function learnedInWeek(d) {
    const days = weekDates(d);
    return S.order.filter((i) => S.learned[i] >= days[0] && S.learned[i] <= days[4]);
  }


  function streak(st = S) {
    let d = today();
    let n = 0;
    if (!(st.log[fmt(d)] && st.log[fmt(d)].done)) d = addDays(d, -1);
    for (let guard = 0; guard < 4000; guard++) {
      if (isWeekday(d)) {
        const e = st.log[fmt(d)];
        if (e && e.done) n++;
        else break;
      }
      d = addDays(d, -1);
    }
    return n;
  }
  function addMissed(i) {
    if (!S.missed.includes(i)) S.missed.push(i);
  }
  function removeMissed(i) {
    S.missed = S.missed.filter((x) => x !== i);
  }

  /* ================= 채점 ================= */
  // 두음 법칙: 력→역, 녀→여, 락→낙 …
  const Y_VOWELS = [2, 3, 6, 7, 12, 17, 20]; // ㅑ ㅒ ㅕ ㅖ ㅛ ㅠ ㅣ
  function dueum(s) {
    const code = s.charCodeAt(0) - 0xac00;
    if (s.length !== 1 || code < 0 || code > 11171) return s;
    const cho = Math.floor(code / 588);
    const jung = Math.floor((code % 588) / 28);
    const jong = code % 28;
    let nc = cho;
    if (cho === 5) nc = Y_VOWELS.includes(jung) ? 11 : 2; // ㄹ → ㅇ / ㄴ
    else if (cho === 2 && Y_VOWELS.includes(jung)) nc = 11; // ㄴ → ㅇ
    return String.fromCharCode(0xac00 + nc * 588 + jung * 28 + jong);
  }
  function withJong(syl, jong) {
    const code = syl.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return null;
    return String.fromCharCode(0xac00 + code - (code % 28) + jong);
  }
  const jongOf = (syl) => (syl.charCodeAt(0) - 0xac00) % 28;
  const norm = (s) => (s || '').replace(/[\s.,!?·'"()~\-]/g, '');

  function soundOk(c, ans) {
    const a = norm(ans);
    if (!a) return false;
    return c.sounds.some((s) => a === s || a === dueum(s));
  }
  // '배울'은 '배우다', '곧을'은 '곧다', '큰'은 '크다'처럼 기본형도 정답으로 인정
  function meaningStems(m) {
    const last = m.slice(-1);
    const head = m.slice(0, -1);
    const stems = [m];
    if (last === '을') stems.push(head);
    const j = jongOf(last);
    if (j === 8 || j === 4) { // ㄹ, ㄴ 받침
      stems.push(head + withJong(last, 0));
      if (j === 4) stems.push(head + withJong(last, 8)); // 긴 → 길다
    }
    return stems;
  }
  function meaningOk(c, ans) {
    const a = norm((ans || '').trim().split(/\s+/)[0]);
    if (!a) return false;
    return c.meanings.some((m) => a === m || meaningStems(m).some((st) => a === st + '다'));
  }

  /* ================= 어휘 도우미 ================= */
  const ALL_WORDS = HANJA.flatMap((c) => c.words.map((w, k) => ({ ...w, owner: c.idx, k })));
  const BY_READ = {};
  ALL_WORDS.forEach((w) => { (BY_READ[w.read] = BY_READ[w.read] || []).push(w); });
  const plainRead = (w) => w.read.replace(/\s/g, '');
  // 어휘 속 오늘 한자의 자리(몇 번째 글자)와 그 소리
  function targetPos(c, w) {
    const k = [...w.word].indexOf(c.h);
    return { k, syl: plainRead(w)[k] };
  }
  // 한글 어휘에서 오늘 한자 자리만 색으로 표시
  function hangulMarked(c, w) {
    const { k } = targetPos(c, w);
    return [...plainRead(w)].map((ch, j) => (j === k ? `<mark>${ch}</mark>` : ch)).join('');
  }
  // 한글 어휘 + 각 글자 아래 음훈(한자 없이)
  function hangulPartsHtml(w, target) {
    return `<div class="wchars">${wordParts(w).map((p) => `
      <span class="wc${p.ch === target ? ' on' : ''}"><b>${p.s}</b><small>${p.m} <strong>${p.s}</strong></small></span>`).join('')}</div>`;
  }
  // 같은 소리를 가진 한자들(복습 보기용)
  const SOUND_INDEX = {};
  function addSound(ch, m, s) {
    [s, dueum(s)].forEach((x) => {
      (SOUND_INDEX[x] = SOUND_INDEX[x] || []);
      if (!SOUND_INDEX[x].some((e) => e.ch === ch)) SOUND_INDEX[x].push({ ch, t: `${m} ${s}` });
    });
  }
  HANJA.forEach((c) => c.sounds.forEach((s, i) => addSound(c.h, c.meanings[Math.min(i, c.meanings.length - 1)], s)));
  Object.entries(EXTRA_HUNUM).forEach(([ch, v]) => v.split('|').forEach((p) => {
    const k = p.lastIndexOf(' ');
    addSound(ch, p.slice(0, k), p.slice(k + 1));
  }));
  function blankSentence(c, k) {
    const s = SENTENCES[c.h][k];
    const r = c.words[k].read;
    const at = s.indexOf(r);
    return { before: s.slice(0, at), after: s.slice(at + r.length) };
  }

  /* ================= 문제 만들기 ================= */
  // 복습: 한글 어휘의 표시된 글자에 쓰인 한자의 음훈 고르기(소리가 같은 한자들 중에서)
  function soundQuestion(i, stage) {
    const c = C(i);
    const w = pick(c.words);
    const { syl } = targetPos(c, w);
    const own = charHunum(c.h, syl);
    const answer = `${own.m} ${own.s}`;
    const opts = [answer];
    shuffle(SOUND_INDEX[syl] || []).forEach((e) => {
      if (opts.length < 4 && e.ch !== c.h && !opts.includes(e.t)) opts.push(e.t);
    });
    shuffle(HANJA).forEach((x) => {
      const t = `${x.meanings[0]} ${x.sounds[0]}`;
      if (opts.length < 4 && x.idx !== i && !opts.includes(t)) opts.push(t);
    });
    return { kind: 'pick', type: 'sound', idx: i, stage, word: w, options: shuffle(opts), answer };
  }
  // 복습: 음훈을 보고 어휘의 뜻 고르기
  function meaningQuestion(i, stage) {
    const c = C(i);
    const w = pick(c.words);
    const pool = shuffle(ALL_WORDS.filter((x) => x.mean !== w.mean));
    const same = pool.filter((x) => C(x.owner).gradeIdx === c.gradeIdx);
    const opts = [w.mean];
    same.concat(pool).forEach((x) => { if (opts.length < 4 && !opts.includes(x.mean)) opts.push(x.mean); });
    return { kind: 'pick', type: 'meaning', idx: i, stage, word: w, options: shuffle(opts), answer: w.mean };
  }
  // 추론하기: 활용 어휘에 없던 새 어휘 가운데 오늘의 한자가 쓰인 어휘 고르기
  // 뜻풀이를 두 글자씩 끊어 비교합니다. '하는', '에서'처럼 흔한 조각은 뜻 비교에서 뺍니다.
  function rawBigrams(s) {
    const out = new Set();
    s.split(/[\s·(),]+/).forEach((t) => { for (let j = 0; j < t.length - 1; j++) out.add(t.slice(j, j + 2)); });
    return out;
  }
  const BIGRAM_DF = {};
  ALL_WORDS.forEach((w) => rawBigrams(w.mean).forEach((b) => { BIGRAM_DF[b] = (BIGRAM_DF[b] || 0) + 1; }));
  function bigrams(s) {
    return new Set([...rawBigrams(s)].filter((b) => (BIGRAM_DF[b] || 0) <= 12));
  }
  function inferQuestion(i) {
    const c = C(i);
    const sounds = new Set(c.sounds.flatMap((s) => [s, dueum(s)]));
    const own = new Set(c.words.map((w) => w.read));
    const ctx = bigrams(c.words.map((w) => w.mean).join(' ') + ' ' + c.meanings.join(' '));
    // 한글로만 보여 주므로, 같은 읽기의 다른 어휘에 오늘 한자가 쓰였다면 제외합니다. (예: 數 — 산수(山水)는 산수(算數)와 헷갈림)
    const usesToday = (w) => (BY_READ[w.read] || []).some((x) => x.word.includes(c.h));
    const [aw, ar, am] = INFER_WORDS[c.h];
    const answer = { word: aw, read: ar, mean: am };
    const ok = (w) => !usesToday(w) && !own.has(w.read) && w.read !== answer.read;
    // 다른 한자의 추론 어휘도 오답 후보로 씁니다. (예: 人 — 인천(仁川))
    const pool = ALL_WORDS.concat(Object.entries(INFER_WORDS).filter(([h]) => h !== c.h)
      .map(([h, [word, read, mean]]) => ({ word, read, mean, owner: BY_CHAR[h].idx })));
    let cands = pool.filter((w) => ok(w) && !w.word.includes(c.h) && [...plainRead(w)].some((ch) => sounds.has(ch)));
    if (!cands.length && INFER_DISTRACT[c.h]) {
      const [dw, dr, dm] = INFER_DISTRACT[c.h];
      const d = { word: dw, read: dr, mean: dm, native: !dw };
      return { kind: 'infer', idx: i, stage: 'infer', options: shuffle([answer, d]), answer: answer.read, other: d.read, chosen: null };
    }
    if (!cands.length) cands = ALL_WORDS.filter((w) => ok(w) && C(w.owner).gradeIdx <= c.gradeIdx);
    // 오늘 어휘들과 뜻이 겹치지 않는(헷갈리지 않는) 어휘를 고릅니다.
    // 어휘의 뜻뿐 아니라, 같은 소리 글자가 쓰인 다른 어휘들의 뜻까지 비교합니다. (예: 敎와 校는 둘 다 '선생님'과 관련 있어 제외)
    const overlap = (text) => { let n = 0; bigrams(text).forEach((b) => { if (ctx.has(b)) n++; }); return n; };
    const scored = cands.map((w) => {
      const p = wordParts(w).find((x) => sounds.has(x.s));
      const rel = p && BY_CHAR[p.ch] ? BY_CHAR[p.ch].words.map((x) => x.mean).join(' ') + ' ' + BY_CHAR[p.ch].meanings.join(' ') : (p ? p.m : '');
      // 뜻이 겹치지 않는 것이 먼저, 그다음 오늘 급수보다 쉬운(이미 배운) 어휘를 고릅니다.
      return { w, n: overlap(w.mean) * 2 + overlap(rel) + (C(w.owner).gradeIdx > c.gradeIdx ? 0.5 : 0) };
    }).sort((a, b) => a.n - b.n);
    const best = scored.filter((x) => x.n === scored[0].n);
    const odd = pick(best.length >= 2 ? best : scored.slice(0, 2)).w;
    // 2지선다: 오늘의 한자가 쓰인 새 어휘(정답) + 소리는 같지만 다른 한자가 쓰인 어휘
    return { kind: 'infer', idx: i, stage: 'infer', options: shuffle([answer, odd]), answer: answer.read, other: odd.read, chosen: null };
  }

  /* ================= 학습 세션 ================= */
  let session = null;
  let timerId = null;

  const STAGES = {
    review: { n: 0, t: '어제 배운 한자 복습', e: '🔁', c: 'review' },
    missed: { n: 0, t: '틀렸던 한자 다시 보기', e: '🔁', c: 'review' },
    learn: { n: 1, t: '오늘의 한자', e: '🌟', c: 's1' },
    match: { n: 2, t: '활용 어휘 ①', sub: '뜻 연결하기', e: '🔗', c: 's2' },
    cloze: { n: 3, t: '활용 어휘 ②', sub: '빈칸 채우기', e: '🧩', c: 's3' },
    check: { n: 4, t: '확인하기', e: '✅', c: 's4' },
    infer: { n: 5, t: '추론하기', e: '🔍', c: 's6' },
    write: { n: 6, t: '적용하기', sub: '짧은 글짓기', e: '✏️', c: 's5' },
    week: { n: 0, t: '일주일 복습', e: '⭐', c: 'week' },
    free: { n: 0, t: '자유 복습', e: '🎲', c: 'review' },
    old: { n: 0, t: '지난 급수 복습', e: '🔁', c: 'review' },
  };
  function stageHtml(key) {
    const s = STAGES[key];
    return `<div class="stage stage-${s.c}"><span class="stage-e">${s.e}</span>
      ${s.n ? `<span class="stage-n">${s.n}</span>` : ''}<b>${s.t}</b>${s.sub ? `<span class="stage-sub">${s.sub}</span>` : ''}</div>`;
  }

  function planToday() {
    const t = today();
    const ds = fmt(t);
    const entry = S.log[ds];
    // 오늘 학습 계획이 이미 있으면 그대로 (계획 없이 결과만 있는 예전 기록은 새로 계획해요)
    if (entry && entry.reviews) return entry;
    const newIdx = nextNewIdx();
    const reviews = [];
    const prev = lastLearnedBefore(ds);
    // 오늘 다시 배우는 한자는 복습 문제에서 빼요(1~6단계로 다시 배우니까요).
    if (prev !== null && prev !== newIdx) reviews.push(prev);
    for (const m of S.missed) {
      if (reviews.length >= 1 + MAX_EXTRA_REVIEW) break;
      if (!reviews.includes(m) && m !== newIdx && S.learned[m] && S.learned[m] < ds) reviews.push(m);
    }
    let week = [];
    if (t.getDay() === 5) {
      week = learnedInWeek(t).filter((i) => S.learned[i] < ds);
      if (newIdx !== null) week.push(newIdx);
      if (week.length < 2) week = [];
    }
    return { newIdx, reviews, week, done: false };
  }

  // 입장하면 하루 한 번 나오는 '지난 급수 복습': 아래 급수에서 앱으로 공부한 한자 3자 (숫자 한자는 너무 쉬워서 빼요)
  const TOO_EASY = '一二三四五六七八九十';
  const OLD_REVIEW_N = 3;
  function oldReviewList(n) {
    const pool = S.order.filter((i) => C(i).gradeIdx < S.gradeIdx && !TOO_EASY.includes(C(i).h));
    const seen = S.oldSeen || {};
    // 틀렸던 한자 먼저, 그다음 가장 오래전에 복습한 한자 (같으면 무작위)
    const rank = (i) => (S.missed.includes(i) ? '0' : '1') + (seen[i] || '');
    return shuffle(pool).sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : 0)).slice(0, n);
  }
  // 입장할 때 함께 하는 '어제 배운 한자 복습'(+ 틀렸던 한자): 평일, 공부 중이고 오늘 학습을 아직 안 했을 때
  function yesterdayReviews() {
    const t = today();
    if (S.phase !== 'study' || !isWeekday(t)) return [];
    const e = S.log[fmt(t)];
    if (e && (e.done || (e.reviews && S.learned[e.newIdx] === fmt(t)))) return []; // 오늘 학습을 이미 시작했으면 빼요
    return planToday().reviews;
  }
  // 그날 처음 입장하면 지난 급수 복습 + 어제 배운 한자 복습을 바로 해요 (하루 한 번)
  const oldReviewDue = () => S.oldReviewDate !== fmt(today()) && (oldReviewList(1).length > 0 || yesterdayReviews().length > 0);
  function buildOldReview() {
    const ds = fmt(today());
    const reviews = yesterdayReviews();
    const old = oldReviewList(OLD_REVIEW_N + reviews.length).filter((i) => !reviews.includes(i)).slice(0, OLD_REVIEW_N);
    const steps = old.map((i) => ({ kind: 'check', idx: i, stage: 'old', old: true, word: pick(C(i).words), m: '', s: '', graded: false }));
    reviews.forEach((i, k) => {
      const stage = k === 0 ? 'review' : 'missed';
      steps.push(soundQuestion(i, stage));
      if (k === 0) steps.push(meaningQuestion(i, stage));
    });
    if (reviews.length) S.yReviewDate = ds; // 오늘 학습에서는 어제 복습을 다시 하지 않아요
    steps.push({ kind: 'done' });
    return { type: 'oldreview', steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }
  function newCharSteps(i) {
    const c = C(i);
    const order = shuffle(c.words.map((_, k) => k));
    return [
      { kind: 'learn', idx: i, stage: 'learn' },
      { kind: 'match', idx: i, stage: 'match', order: shuffle(c.words.map((_, k) => k)), done: [], selL: null, selR: null },
      { kind: 'cloze', idx: i, stage: 'cloze', order, filled: [], cur: order[0] },
      { kind: 'check', idx: i, stage: 'check', word: pick(c.words), m: '', s: '', graded: false },
      inferQuestion(i),
      { kind: 'write', idx: i, stage: 'write', text: '' },
    ];
  }
  // '한 자 더 배우기': 복습 없이 새 한자 1~6단계만
  function buildExtra() {
    const i = nextNewIdx();
    const plan = { newIdx: i, reviews: [], week: [] };
    return { type: 'extra', plan, date: fmt(today()), steps: newCharSteps(i).concat([{ kind: 'done' }]), i: 0, correct: 0, total: 0, started: Date.now() };
  }
  // 급수 시험에서 틀린 한자 짧게 다시 보기: 오늘의 한자 + 뜻 연결 + 확인하기
  function buildRelearn() {
    const steps = [];
    S.relearn.forEach((i) => {
      const c = C(i);
      steps.push({ kind: 'learn', idx: i, stage: 'learn' });
      steps.push({ kind: 'match', idx: i, stage: 'match', order: shuffle(c.words.map((_, k) => k)), done: [], selL: null, selR: null });
      steps.push({ kind: 'check', idx: i, stage: 'check', word: pick(c.words), m: '', s: '', graded: false });
    });
    steps.push({ kind: 'done' });
    return { type: 'relearn', plan: { newIdx: null, reviews: [], week: [] }, date: fmt(today()), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildLesson() {
    const plan = planToday();
    const steps = [];
    // 입장할 때 어제 배운 한자 복습을 이미 했으면 바로 오늘의 한자부터
    if (S.yReviewDate !== fmt(today())) plan.reviews.forEach((i, k) => {
      const stage = k === 0 ? 'review' : 'missed';
      steps.push(soundQuestion(i, stage));
      if (k === 0) steps.push(meaningQuestion(i, stage));
    });
    if (plan.newIdx !== null && plan.newIdx !== undefined) steps.push(...newCharSteps(plan.newIdx));
    if (plan.week.length) {
      steps.push({ kind: 'weekIntro', list: plan.week, stage: 'week' });
      plan.week.filter((i) => i !== plan.newIdx).forEach((i) => steps.push(soundQuestion(i, 'week')));
      shuffle(plan.week).slice(0, 2).forEach((i) => steps.push(meaningQuestion(i, 'week')));
      steps.push({ kind: 'weekSummary', list: plan.week, stage: 'week' });
    }
    steps.push({ kind: 'done' });
    return { type: 'lesson', plan, date: fmt(today()), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildWeekly() {
    const t = today();
    const list = learnedInWeek(t);
    const steps = [{ kind: 'weekIntro', list, stage: 'week' }];
    list.forEach((i) => steps.push(soundQuestion(i, 'week')));
    shuffle(list).slice(0, 2).forEach((i) => steps.push(meaningQuestion(i, 'week')));
    steps.push({ kind: 'weekSummary', list, stage: 'week' });
    steps.push({ kind: 'done' });
    return { type: 'weekly', week: fmt(mondayOf(t)), steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function buildFreeReview() {
    const missed = S.missed.filter((i) => S.learned[i]);
    const rest = shuffle(S.order.filter((i) => !missed.includes(i)));
    const list = shuffle(missed).concat(rest).slice(0, 5);
    const steps = [];
    list.forEach((i, k) => steps.push(k % 2 ? meaningQuestion(i, 'free') : soundQuestion(i, 'free')));
    steps.push({ kind: 'done' });
    return { type: 'review', steps, i: 0, correct: 0, total: 0, started: Date.now() };
  }

  function commitLearn(i) {
    if (session.type === 'relearn') return;
    const ds = session.date;
    if (!S.learned[i]) {
      S.learned[i] = ds;
      S.order.push(i);
    } else if (S.learned[i] !== ds) {
      // 다시 배우는 한자: 오늘 배운 한자로 기록해 내일 1일 후 복습에 나오게 해요.
      S.learned[i] = ds;
      S.order = S.order.filter((x) => x !== i).concat([i]);
    }
    if (session.type === 'extra') {
      const e = S.log[ds] || { done: true };
      e.extra = (e.extra || []).filter((x) => x !== i).concat([i]);
      S.log[ds] = e;
    } else {
      S.log[ds] = Object.assign({}, session.plan, S.log[ds] || {}, { done: false });
    }
    save();
  }

  function finishSession() {
    const quiz = { correct: session.correct, total: session.total };
    if (['lesson', 'extra'].includes(session.type) && session.plan.newIdx !== null && session.plan.newIdx !== undefined) {
      const i = session.plan.newIdx;
      S.redo = (S.redo || []).filter((r) => r.idx !== i);
      if (session.failed) S.redo.push({ idx: i, date: session.date });
    }
    if (session.type === 'lesson') {
      const e = S.log[session.date] || Object.assign({}, session.plan);
      e.done = true;
      e.quiz = quiz;
      S.log[session.date] = e;
      if (session.plan.week.length) S.weekly[fmt(mondayOf(parseDate(session.date)))] = true;
      logActivity({ type: 'lesson', idx: session.plan.newIdx, week: session.plan.week.length > 0, ...quiz });
    } else if (session.type === 'extra') {
      logActivity({ type: 'lesson', idx: session.plan.newIdx, extra: true, ...quiz });
    } else if (session.type === 'relearn') {
      logActivity({ type: 'relearn', list: S.relearn.slice(), ...quiz });
      S.relearn = [];
      S.phase = 'exam';
    } else if (session.type === 'oldreview') {
      logActivity({ type: 'oldreview', ...quiz });
    } else if (session.type === 'weekly') {
      S.weekly[session.week] = true;
      logActivity({ type: 'weekly', ...quiz });
    } else {
      logActivity({ type: 'review', ...quiz });
    }
    save();
  }
  function score(ok, i) {
    session.total++;
    if (ok) { session.correct++; removeMissed(i); } else addMissed(i);
    // 새로 배우는 한자의 확인하기·추론하기를 틀리면 그 한자는 다음 학습일에 다시 배워요.
    const st = session.steps[session.i];
    if (!ok && session.plan && i === session.plan.newIdx && (st.kind === 'check' || st.kind === 'infer')) session.failed = true;
    save();
  }

  /* ================= 화면: 공통 ================= */
  function setTab(name) {
    document.querySelectorAll('.tabbar a').forEach((a) => a.classList.toggle('on', a.dataset.tab === name));
  }
  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }
  // 한자 카드(목록에서 누르면 보이는 정리 화면)
  function charCardHtml(c) {
    const words = c.words.map((w) => `
      <div class="word">
        ${wordCharsHtml(w, c.h)}
        <div class="word-r">${w.read}</div>
        <div class="word-m">${w.mean}</div>
      </div>`).join('');
    return `${charHeadHtml(c)}
      <h3 class="sec-title">활용 어휘</h3>
      <div class="words">${words}</div>`;
  }
  function charHeadHtml(c) {
    const pairs = c.meanings.length === c.sounds.length
      ? c.meanings.map((m, k) => [m, c.sounds[k]]) : [[c.meanings.join(', '), c.sounds.join(', ')]];
    return `
      <div class="char-card">
        <span class="pill">${c.gradeName}</span>
        <div class="big-hanja">${c.h}</div>
        <div class="hunum-boxes">${pairs.map(([m, s]) => `
          <div class="hb"><span class="hb-l">뜻(훈)</span><b>${m}</b></div>
          <div class="hb snd"><span class="hb-l">소리(음)</span><b>${s}</b></div>`).join('')}</div>
        <div class="hunum-read">"${hunum(c)}"</div>
      </div>`;
  }
  function bindOpen(root = $app) {
    root.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openCharModal(+b.dataset.open)));
  }
  function openCharModal(i) {
    const c = C(i);
    const back = document.createElement('div');
    back.className = 'modal-back';
    const when = S.learned[i] ? `<p class="small muted center">${S.learned[i].replace(/-/g, '.')} 학습</p>` : '';
    back.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${c.h} ${hunum(c)}">
      <button class="close-x" aria-label="닫기">✕</button>${charCardHtml(c)}${when}</div>`;
    const close = () => back.remove();
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    back.querySelector('.close-x').addEventListener('click', close);
    document.body.appendChild(back);
  }
  // 여러 한자 카드를 옆으로 넘겨 보기 (← → 버튼, 밀어서 넘기기, 키보드 화살표)
  function openCarousel(list, start = 0) {
    let k = start;
    const back = document.createElement('div');
    back.className = 'modal-back';
    const draw = () => {
      back.innerHTML = `<div class="modal carousel" role="dialog" aria-modal="true">
        <div class="car-head">
          <span class="car-title">오늘 배운 한자 <b>${k + 1}</b> / ${list.length}</span>
          <button class="close-x" aria-label="닫기">✕</button>
        </div>
        <div class="car-body">${charCardHtml(C(list[k]))}</div>
        ${list.length > 1 ? `<div class="car-nav">
          <button class="car-btn" data-d="-1" ${k === 0 ? 'disabled' : ''} aria-label="이전 한자">‹</button>
          <div class="car-dots">${list.map((i, j) => `<button class="dot${j === k ? ' on' : ''}" data-j="${j}" aria-label="${C(i).h}">${C(i).h}</button>`).join('')}</div>
          <button class="car-btn" data-d="1" ${k === list.length - 1 ? 'disabled' : ''} aria-label="다음 한자">›</button>
        </div>` : ''}
      </div>`;
      back.querySelector('.close-x').addEventListener('click', close);
      back.querySelectorAll('[data-d]').forEach((b) => b.addEventListener('click', () => go(k + +b.dataset.d)));
      back.querySelectorAll('[data-j]').forEach((b) => b.addEventListener('click', () => go(+b.dataset.j)));
    };
    const go = (n) => { if (n >= 0 && n < list.length && n !== k) { k = n; draw(); } };
    const onKey = (e) => { if (e.key === 'ArrowLeft') go(k - 1); if (e.key === 'ArrowRight') go(k + 1); if (e.key === 'Escape') close(); };
    function close() { back.remove(); document.removeEventListener('keydown', onKey); }
    let x0 = null;
    back.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    back.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 50) go(k + (dx < 0 ? 1 : -1));
      x0 = null;
    });
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    document.addEventListener('keydown', onKey);
    draw();
    document.body.appendChild(back);
  }
  function breakdown(w) {
    return `${w.read} = ${wordParts(w).map((p) => `<span class="hj">${p.ch}</span>(${p.m} ${p.s})`).join(' + ')} → <b>${w.mean}</b>`;
  }

  /* ================= 화면: 입장 ================= */
  let loginMode = 'in';
  function renderLogin() {
    document.body.classList.add('logged-out');
    const list = users();
    const isNew = loginMode === 'new';
    $app.innerHTML = `
      <div class="card hero login">
        <div class="login-mark">漢</div>
        <h1>매일 한자</h1>
        <p class="slogan">매일 5분<br><b>한자를 알면 어휘가 보인다</b></p>
        <div class="seg"><button class="${isNew ? '' : 'on'}" data-mode="in">입장하기</button><button class="${isNew ? 'on' : ''}" data-mode="new">처음 왔어요</button></div>
        <form id="login" autocomplete="off">
          <label for="name">이름(아이디)</label>
          <input id="name" class="text-input" maxlength="20" placeholder="예) 3학년 2반 김하늘" required>
          <label for="pw">비밀번호${isNew ? ' 만들기 (4글자 이상)' : ''}</label>
          <input id="pw" type="password" class="text-input" maxlength="30" required autocomplete="off">
          ${isNew ? `<label for="pw2">비밀번호 한 번 더</label>
          <input id="pw2" type="password" class="text-input" maxlength="30" required autocomplete="off">` : ''}
          <div id="fb"></div>
          <button class="btn block">${isNew ? '만들고 시작하기 🚀' : '입장하기 🚀'}</button>
        </form>
      </div>
      ${list.length && !isNew ? `<div class="card">
        <h3>함께 공부하는 친구들</h3>
        <p class="small muted">내 이름을 누르고 비밀번호를 넣으면 이어서 공부할 수 있어요.</p>
        <div class="name-list">${list.map((n) => `<button class="btn soft" data-name="${esc(n)}">${esc(n)}</button>`).join('')}</div>
      </div>` : ''}
      <p class="small muted center">학습 기록은 이름별로 인터넷에 저장돼요. 다른 기기에서도 이름과 비밀번호로 이어서 공부할 수 있어요.<br>
        비밀번호를 잊었다면 선생님께 말씀드리세요. · <a href="#/teacher">선생님 메뉴</a></p>`;
    const fb = (t) => { document.getElementById('fb').innerHTML = `<div class="feedback no">${t}</div>`; };
    const nameEl = document.getElementById('name');
    const pwEl = document.getElementById('pw');
    $app.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { loginMode = b.dataset.mode; renderLogin(); }));
    $app.querySelectorAll('[data-name]').forEach((b) => b.addEventListener('click', () => { nameEl.value = b.dataset.name; pwEl.focus(); }));
    let busy = false;
    document.getElementById('login').addEventListener('submit', async (e) => {
      e.preventDefault();
      const n = nameEl.value.trim().replace(/\s+/g, ' ');
      const pw = pwEl.value;
      const pw2 = isNew ? document.getElementById('pw2').value : '';
      if (!n || busy) return;
      // 다른 기기에서 만든 이름·비밀번호·기록을 먼저 받아 와요.
      busy = true;
      document.getElementById('fb').innerHTML = '<div class="small muted">확인하는 중…</div>';
      await cloud.pullOne(n);
      busy = false;
      document.getElementById('fb').innerHTML = '';
      if (isNew) {
        if (users().includes(n)) return fb('이미 있는 이름이에요. 다른 이름을 쓰거나 \'입장하기\'를 눌러 주세요.');
        if (pw.length < 4) return fb('비밀번호는 4글자 이상으로 만들어요.');
        if (pw !== pw2) return fb('두 비밀번호가 달라요. 다시 확인해 주세요.');
        addUser(n);
        setPassword(n, pw);
      } else {
        if (!users().includes(n)) return fb('처음 보는 이름이에요. 처음이라면 \'처음 왔어요\'를 눌러 주세요.');
        if (!hasPassword(n)) {
          // 비밀번호 기능 이전에 만든 이름: 이번에 쓴 비밀번호로 정해요.
          if (pw.length < 4) return fb('비밀번호를 새로 정해요. 4글자 이상으로 써 주세요.');
          setPassword(n, pw);
        } else if (!checkPassword(n, pw)) {
          return fb('비밀번호가 맞지 않아요.');
        }
      }
      loginMode = 'in';
      login(n);
      location.hash = '#/';
      route();
    });
  }

  /* ================= 화면: 홈 ================= */
  function phaseCard(t) {
    const g = curGrade();
    const total = g.end - g.start;
    const test = S.test || null;
    const contLabel = (x) => (x.finished ? '결과 확인하기' : `이어서 하기 (${x.i} / ${x.items.length})`);
    if (S.phase === 'done') {
      return `<div class="card hero">
        <div class="big-hanja">🏆</div>
        <h2>준비된 모든 급수를 통과했어요!</h2>
        <p class="muted">${GRADES.map((x) => x.name).join(' · ')} 완전 학습 완료! 새 급수가 준비되면 이어서 공부해요.</p>
        <a class="btn soft block" href="#/review">🎲 자유 복습</a></div>`;
    }
    if (S.phase === 'level') {
      const cont = test && test.kind === 'level';
      return `<div class="card hero phase-level">
        <div class="phase-ico">🧪</div>
        <h2>${g.name} 레벨테스트</h2>
        <p>한자와 활용 어휘 2개를 보고 <b>뜻과 음</b>을 써요.<br>이미 아는 한자는 건너뛰고, <b>틀린 한자만</b> 공부해요!</p>
        <p class="small muted">${total}문항 · 모르는 한자는 '몰라요'를 눌러 빨리 넘어가요.</p>
        <a class="btn block big" href="#/level">${cont ? contLabel(test) : '레벨테스트 시작!'}</a></div>`;
    }
    if (S.phase === 'exam') {
      const cont = test && test.kind === 'exam';
      const rec = S.exams[g.id];
      return `<div class="card hero phase-exam">
        <div class="phase-ico">🏆</div>
        <h2>${g.name} 급수 시험 볼 차례!</h2>
        <p>${g.name} ${total}자를 모두 봐요. <b>100점</b>이면 다음 급수로 올라가요.</p>
        ${rec ? `<p class="small muted">지난 시험 ${rec.last}점 · ${rec.attempts}번째 도전</p>` : ''}
        <a class="btn block big" href="#/test">${cont ? contLabel(test) : '급수 시험 시작!'}</a>
        <a class="btn soft block" href="#/exam" style="margin-top:10px">📖 ${g.name} 전체 복습 먼저 하기</a></div>`;
    }
    if (S.phase === 'relearn') {
      return `<div class="card hero phase-relearn">
        <div class="phase-ico">🔁</div>
        <h2>틀린 한자 다시 보기</h2>
        <p>급수 시험에서 틀린 <b>${S.relearn.length}자</b>를 다시 익히고, ${g.name} 급수 시험을 다시 봐요.</p>
        <div class="wk-list">${S.relearn.map((i) => `<span class="wk-char">${C(i).h}<small>${hunum(C(i))}</small></span>`).join('')}</div>
        <a class="btn block big" href="#/relearn">다시 보기 시작!</a></div>`;
    }
    // study
    const ds = fmt(t);
    const entry = S.log[ds];
    const left = queueLeft();
    const redoN = (S.redo || []).length;
    const head = `<div class="dayname">${g.name} · 공부할 한자 ${left}자 남음${redoN ? ` (다시 배울 한자 ${redoN}자 포함)` : ''}</div>`;
    if (!isWeekday(t)) {
      const wk = learnedInWeek(t);
      return `<div class="card hero">
        <div class="big-hanja">休</div>
        <div class="hunum-read">쉴 휴</div>
        <p class="muted">주말은 쉬는 날이에요. 월요일 아침에 새 한자로 만나요! 😊</p>
        ${wk.length >= 2 && !S.weekly[fmt(mondayOf(t))] ? `<p class="small">이번 주 <b>일주일 복습</b>을 아직 안 했어요.</p><a class="btn block" href="#/weekly">⭐ 일주일 복습 하기</a>` : ''}
        ${S.order.length ? `<a class="btn soft block" href="#/review" style="margin-top:10px">🎲 자유 복습 (5문제)</a>` : ''}
      </div>`;
    }
    if (entry && entry.done) {
      const todays = todaysNew(t);
      return `<div class="card hero">
        ${head}
        <div class="dayname">${DAY[t.getDay()]}요일 학습 완료! 🎉</div>
        ${todays.length ? `<div class="today-chars">${todays.map((i, k) => `<button class="tc" data-carousel="${k}"><span class="hanja">${C(i).h}</span><small>${hunum(C(i))}</small></button>`).join('')}</div>` : ''}
        <p class="muted">${t.getDay() === 5 ? '한 주 동안 수고했어요! 주말엔 푹 쉬어요.' : '잘했어요! 내일 아침에 복습으로 다시 만나요.'}</p>
        ${nextNewIdx() !== null ? `<a class="btn ghost block" href="#/extra">➕ 한 자 더 배우기</a>` : ''}
        ${(S.redo || []).length ? `<p class="small">🔁 다시 배울 한자: <span class="hanja">${S.redo.map((r) => C(r.idx).h).join(' ')}</span> (다음 학습일)</p>` : ''}
        <div class="btn-row">
          ${todays.length ? `<button class="btn soft" data-carousel="0">📖 다시 보기${todays.length > 1 ? ` (${todays.length}자)` : ''}</button>` : ''}
          <a class="btn soft" href="#/review">자유 복습</a>
        </div>
      </div>`;
    }
    const plan = planToday();
    const c = C(plan.newIdx);
    const started = !!(entry && entry.reviews);
    const rows = [];
    if (plan.reviews.length && S.yReviewDate !== fmt(t)) rows.push(['🔁', '', '어제 배운 한자 복습']);
    ['learn', 'match', 'cloze', 'check', 'infer', 'write'].forEach((k) => {
      const st = STAGES[k];
      rows.push([st.e, st.n, `${st.t}${st.sub ? ` <span class="muted">· ${st.sub}</span>` : ''}`, st.c]);
    });
    if (plan.week.length) rows.push(['⭐', '', `일주일 복습 · 이번 주 ${plan.week.length}자`, 'week']);
    return `<div class="card hero today-card">
      ${head}
      <div class="big-hanja mystery">${started || isRedo(c.idx) ? c.h : '?'}</div>
      <p class="muted">${isRedo(c.idx) ? `🔁 지난번에 틀린 문제가 있던 '${hunum(c)}'를 다시 배워요.` : started ? '하던 학습을 이어서 해요.' : '오늘은 어떤 한자를 만날까요?'}</p>
      <ol class="steps">${rows.map(([e, n, txt, cls]) => `<li class="${cls ? `st-${cls}` : ''}"><span class="num">${n || e}</span><span>${txt}</span></li>`).join('')}</ol>
      <a class="btn block big" href="#/lesson">${started ? '이어서 하기' : '오늘의 학습 시작!'} · 약 5분</a>
    </div>`;
  }

  // 오늘 새로 배운 한자(오늘의 한자 + 한 자 더 배우기)
  function todaysNew(t) {
    const ds = fmt(t);
    const e = S.log[ds];
    if (!e) return [];
    return [e.newIdx].concat(e.extra || [])
      .filter((i, k, a) => i !== null && i !== undefined && S.learned[i] === ds && a.indexOf(i) === k);
  }
  function todayCharsCard(t) {
    const todays = todaysNew(t);
    if (!todays.length) return '';
    return `<div class="card center">
      <h3>오늘 배운 한자</h3>
      <div class="today-chars">${todays.map((i, k) => `<button class="tc" data-carousel="${k}"><span class="hanja">${C(i).h}</span><small>${hunum(C(i))}</small></button>`).join('')}</div>
      <button class="btn soft block" data-carousel="0">📖 다시 보기${todays.length > 1 ? ` (${todays.length}자)` : ''}</button>
    </div>`;
  }

  function journeyHtml() {
    return `<div class="journey">${GRADES.map((g, k) => {
      const cls = S.passed[g.id] ? 'done' : k === S.gradeIdx && S.phase !== 'done' ? 'now' : '';
      return `<span class="jn ${cls}">${S.passed[g.id] ? '✓ ' : ''}${g.name}</span>`;
    }).join('<i></i>')}</div>`;
  }

  function renderHome(entering = false) {
    setTab('home');
    // 앱을 열거나 입장했을 때만, 그날 처음이면 지난 급수 복습부터 해요.
    // (시험·학습을 마치고 '홈으로'를 누를 때는 홈으로 가요)
    if (entering && oldReviewDue()) { goHash('#/oldreview'); return; }
    syncPhase();
    const t = today();
    let main = '';
    if (!S.order.length && !Object.keys(S.known).length && S.phase === 'level' && S.gradeIdx === 0 && !S.test) {
      main += `
      <div class="card welcome">
        <h2>반가워요, ${esc(user)}! 👋</h2>
        <p>먼저 <b>레벨테스트</b>로 내가 이미 아는 한자를 확인해요. 모르는 한자만 평일 아침 5분씩 공부하고,
        급수 시험에서 <b>100점</b>을 받으면 다음 급수로 올라가요!</p>
      </div>`;
    }
    main += journeyHtml();
    main += phaseCard(t);
    // 학습 완료 카드가 없는 단계(급수 시험 볼 차례 등)에서도 오늘 배운 한자를 다시 볼 수 있게
    const ent = S.log[fmt(t)];
    if (!(S.phase === 'study' && isWeekday(t) && ent && ent.done)) main += todayCharsCard(t);

    const g = curGrade();
    const total = g.end - g.start;
    let knownN = 0, learnedN = 0;
    for (let i = g.start; i < g.end; i++) { if (S.known[i]) knownN++; else if (S.learned[i]) learnedN++; }
    const ds = fmt(t);
    const cells = weekDates(t).map((d, k) => {
      const e = S.log[d];
      const idx = e && e.newIdx !== null && e.newIdx !== undefined && S.learned[e.newIdx] === d ? e.newIdx : null;
      const cls = [e && e.done ? 'done' : '', d === ds ? 'today' : ''].join(' ');
      return `<div class="d ${cls}"><div class="lbl">${DAY[k + 1]}</div>
        <div class="cell">${idx !== null ? `<button class="cell-in hanja" data-open="${idx}">${C(idx).h}</button>` : (e && e.done ? '✔' : '')}</div></div>`;
    }).join('');
    main += `
      <div class="card">
        <div class="row"><h3 style="margin:0">이번 주</h3><span class="spacer"></span>
          ${S.weekly[fmt(mondayOf(t))] ? '<span class="pill green">일주일 복습 완료</span>' : '<span class="pill gray">금요일: 일주일 복습</span>'}</div>
        <div class="week">${cells}</div>
      </div>
      <div class="card">
        <div class="stats">
          <div><b>${streak()}</b><span>🔥 연속 학습일</span></div>
          <div><b>${Object.keys(S.known).length}</b><span>💡 이미 아는 한자</span></div>
          <div><b>${S.order.length}</b><span>📚 공부한 한자</span></div>
        </div>
        <div class="row" style="margin-top:16px"><b>${g.name}</b><span class="spacer"></span>
          <span class="small muted">아는 ${knownN} + 공부 ${learnedN} / ${total}자</span></div>
        <div class="progress two" style="margin-top:6px"><span class="k" style="width:${(knownN / total) * 100}%"></span><span style="width:${(learnedN / total) * 100}%"></span></div>
      </div>`;
    $app.innerHTML = main;
    bindOpen();
    const todays = todaysNew(t);
    $app.querySelectorAll('[data-carousel]').forEach((b) => b.addEventListener('click', () => openCarousel(todays, +b.dataset.carousel)));
  }

  /* ================= 화면: 학습 세션 ================= */
  function startLesson(kind) {
    const t = today();
    if (kind === 'lesson') {
      const e = S.log[fmt(t)];
      if (!isWeekday(t) || (e && e.done) || (S.phase !== 'study' && !(e && e.newIdx !== null && e.newIdx !== undefined))) { location.hash = '#/'; return; }
      if (!session || session.type !== 'lesson' || session.date !== fmt(t)) session = buildLesson();
    } else if (kind === 'extra') {
      const e = S.log[fmt(t)];
      if (!session || session.type !== 'extra') {
        if (!(e && e.done) || nextNewIdx() === null) { location.hash = '#/'; return; }
        session = buildExtra();
      }
    } else if (kind === 'relearn') {
      if (!session || session.type !== 'relearn') {
        if (S.phase !== 'relearn' || !S.relearn.length) { location.hash = '#/'; return; }
        session = buildRelearn();
      }
    } else if (kind === 'oldreview') {
      if (!session || session.type !== 'oldreview') {
        if (!oldReviewDue()) { location.hash = '#/'; return; }
        session = buildOldReview();
        S.oldReviewDate = fmt(t); // 그만두어도 오늘은 다시 나오지 않아요
        save();
      }
    } else if (kind === 'weekly') {
      if (learnedInWeek(t).length === 0) { location.hash = '#/'; return; }
      if (!session || session.type !== 'weekly') session = buildWeekly();
    } else {
      if (!S.order.length) { location.hash = '#/'; return; }
      if (!session || session.type !== 'review') session = buildFreeReview();
    }
    document.body.classList.add('in-lesson');
    renderStep();
    stopTimer();
  }

  /* ================= 학습 시간 ================= */
  // 공부 화면(학습·복습·레벨테스트·급수 시험)을 실제로 보고 있는 시간만 셉니다.
  // 다른 창으로 가거나 화면이 꺼졌을 때, 2분 동안 아무 입력이 없을 때는 세지 않아요.
  const STUDY_SCREENS = ['lesson', 'extra', 'relearn', 'weekly', 'review', 'oldreview', 'level', 'test'];
  const IDLE_LIMIT = 120 * 1000;
  const CHEER_AT = 5 * 60;
  const CHEERS = [
    '벌써 5분이 넘었어요! 꾸준히 하는 힘이 진짜 실력이 돼요.',
    '5분 넘게 집중했어요! 오늘도 한 걸음 더 자랐어요.',
    '대단해요! 끝까지 해내는 모습이 정말 멋져요.',
    '5분을 넘겼어요! 이렇게 조금씩 쌓이면 어휘가 쑥쑥 늘어요.',
    '오늘 공부한 시간이 내일의 실력이 돼요. 계속 힘내요!',
    '와, 5분 넘게 공부했어요! 한자 박사가 되는 길에 성큼 다가섰어요.',
  ];
  let lastInput = Date.now();
  ['pointerdown', 'keydown', 'touchstart', 'input'].forEach((ev) => document.addEventListener(ev, () => { lastInput = Date.now(); }, true));
  const fmtTime = (sec) => {
    sec = Math.round(sec || 0);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s2 = sec % 60;
    return h ? `${h}시간 ${m}분` : m ? `${m}분${s2 ? ` ${s2}초` : ''}` : `${s2}초`;
  };
  const clock = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  const todaySecs = (st = S) => (st.time || {})[fmt(today())] || 0;
  const totalSecs = (st = S, upTo = null) => Object.keys(st.time || {}).filter((d) => !upTo || d <= upTo).reduce((n, d) => n + st.time[d], 0);
  const cheerOf = (ds) => CHEERS[[...ds].reduce((n, ch) => n + ch.charCodeAt(0), 0) % CHEERS.length];
  let unsaved = 0;
  setInterval(() => {
    const screen = location.hash.replace(/^#\/?/, '').split('/')[0];
    if (!user || !STUDY_SCREENS.includes(screen) || document.visibilityState !== 'visible') return;
    if (Date.now() - lastInput > IDLE_LIMIT) return;
    const ds = fmt(today());
    S.time = S.time || {};
    S.time[ds] = (S.time[ds] || 0) + 1;
    document.querySelectorAll('.study-clock').forEach((el) => { el.textContent = clock(S.time[ds]); });
    if (S.time[ds] >= CHEER_AT && S.cheerDate !== ds) {
      S.cheerDate = ds;
      showCheer(cheerOf(ds));
      save();
      unsaved = 0;
    } else if (++unsaved >= 15) { save(); unsaved = 0; }
  }, 1000);
  function showCheer(text) {
    document.querySelectorAll('.cheer-toast').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = 'cheer-toast';
    el.innerHTML = `<span class="ct-ico">🌟</span><span>${text}</span>`;
    document.body.appendChild(el);
    setTimeout(() => el.classList.add('out'), 5000);
    setTimeout(() => el.remove(), 5600);
  }
  const studyClock = () => `<span class="timer" title="오늘 공부한 시간">⏱ <span class="study-clock">${clock(todaySecs())}</span></span>`;
  // 끝 화면에 보여 주는 오늘 학습 시간과 격려
  function todayTimeHtml() {
    const sec = todaySecs();
    const ds = fmt(today());
    return `<div class="time-box">⏱ 오늘 공부한 시간 <b>${fmtTime(sec)}</b>
      ${sec >= CHEER_AT ? `<div class="cheer">🌟 ${cheerOf(ds)}</div>` : ''}</div>`;
  }

  function nextStep() {
    session.i++;
    renderStep();
    window.scrollTo(0, 0);
  }

  // 오늘 학습 1~6단계 진행 표시
  function trackerHtml(step) {
    if (!['lesson', 'extra'].includes(session.type) || session.plan.newIdx === null || session.plan.newIdx === undefined) return '';
    const cur = STAGES[step.stage] ? STAGES[step.stage].n : 0;
    const passed = step.kind === 'done' || step.stage === 'week';
    return `<div class="tracker">${['learn', 'match', 'cloze', 'check', 'infer', 'write'].map((k) => {
      const s = STAGES[k];
      const cls = passed || (cur && s.n < cur) ? 'done' : s.n === cur ? 'now' : '';
      return `<span class="tk tk-${s.c} ${cls}" title="${s.t}">${cls === 'done' ? '✓' : s.n}</span>`;
    }).join('<i></i>')}</div>`;
  }

  function renderStep() {
    const step = session.steps[session.i];
    const pct = (session.i / (session.steps.length - 1)) * 100;
    const head = step.kind === 'done' ? '' : `
      <div class="lesson-head">
        <button class="close-x" id="quit" aria-label="그만하기">✕</button>
        <div class="progress"><span style="width:${pct}%"></span></div>
        ${studyClock()}
      </div>${trackerHtml(step)}`;
    const R = {
      learn: renderLearn, match: renderMatch, cloze: renderCloze, check: renderCheck, write: renderWrite,
      infer: renderInfer, pick: renderPick, weekIntro: renderWeekIntro, weekSummary: renderWeekSummary, done: renderDone,
    };
    $app.innerHTML = head + R[step.kind](step);
    const quit = document.getElementById('quit');
    if (quit) quit.addEventListener('click', () => { location.hash = '#/'; });
    const B = {
      learn: () => document.getElementById('next').addEventListener('click', () => { commitLearn(step.idx); nextStep(); }),
      match: bindMatch, cloze: bindCloze, check: bindCheck, write: bindWrite, infer: bindInfer, pick: bindPick,
      weekIntro: () => document.getElementById('next').addEventListener('click', nextStep),
      weekSummary: () => document.getElementById('next').addEventListener('click', nextStep),
      // 이미 '#/extra' 주소에 있으면 주소가 바뀌지 않아 화면이 넘어가지 않으므로 직접 시작합니다.
      done: () => {
        const more = document.getElementById('more');
        if (more) more.addEventListener('click', () => goHash('#/extra'));
      },
    };
    if (B[step.kind]) B[step.kind](step);
    bindOpen();
  }
  const nextBtn = (label = '다음 →') => `<button class="btn block big" id="next">${label}</button>`;
  function bindNext() {
    const b = document.getElementById('next');
    if (b) { b.addEventListener('click', nextStep); b.focus({ preventScroll: true }); }
  }

  // 1. 오늘의 한자
  function renderLearn(step) {
    const c = C(step.idx);
    return `<div class="card lesson-card">${stageHtml('learn')}${charHeadHtml(c)}
      ${isRedo(c.idx) ? '<p class="center redo-note">🔁 다시 배우는 한자예요. 이번에는 끝까지 모두 맞혀 봐요!</p>' : ''}
      <p class="center tip">💡 <b>뜻</b>과 <b>소리</b>를 소리 내어 읽어 보세요.</p>
      ${nextBtn('활용 어휘 만나러 가기 →')}</div>`;
  }

  // 2. 활용 어휘 ① — 왼쪽(한자+음훈)과 오른쪽(뜻)을 선으로 연결
  function renderMatch(step) {
    const c = C(step.idx);
    const all = step.done.length === c.words.length;
    const left = c.words.map((w, k) => {
      const ok = step.done.includes(k);
      return `<button class="mbox ml${ok ? ' ok' : ''}${step.selL === k ? ' sel' : ''}" data-w="${k}" ${ok ? 'disabled' : ''}>
        ${wordCharsHtml(w, c.h)}<span class="dot"></span></button>`;
    }).join('');
    const right = step.order.map((k) => {
      const ok = step.done.includes(k);
      return `<button class="mbox mr${ok ? ' ok' : ''}${step.selR === k ? ' sel' : ''}" data-m="${k}" ${ok ? 'disabled' : ''}>
        <span class="dot"></span>${c.words[k].mean}</button>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('match')}
      <p class="guide">${all ? '🎉 모두 연결했어요! 한자의 <b>음훈</b>이 어휘의 <b>뜻</b>과 어떻게 이어지는지 살펴보세요.'
        : '한자 아래 <b>음훈</b>을 힌트로 어휘와 알맞은 <b>뜻</b>을 차례로 눌러 <b>선으로 연결</b>해요.'}</p>
      <div class="mboard" id="mboard">
        <div class="mcol">${left}</div>
        <div class="mcol">${right}</div>
        <svg class="mlines" id="mlines" aria-hidden="true"></svg>
      </div>
      <div id="fb"></div>
      ${all ? `<div class="sum-list">${c.words.map((w) => `<div>${breakdown(w)}</div>`).join('')}</div>${nextBtn('빈칸 채우기 →')}` : ''}
    </div>`;
  }
  const LINE_COLORS = ['var(--s2)', 'var(--s1)', 'var(--s4)', 'var(--s3)'];
  function drawLines() {
    const board = document.getElementById('mboard');
    const svg = document.getElementById('mlines');
    const step = session && session.steps[session.i];
    if (!board || !svg || !step || step.kind !== 'match') return;
    const b = board.getBoundingClientRect();
    svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
    svg.innerHTML = step.done.map((k, n) => {
      const L = board.querySelector(`[data-w="${k}"]`).getBoundingClientRect();
      const R = board.querySelector(`[data-m="${k}"]`).getBoundingClientRect();
      const x1 = L.right - b.left, y1 = L.top + L.height / 2 - b.top;
      const x2 = R.left - b.left, y2 = R.top + R.height / 2 - b.top;
      const col = LINE_COLORS[n % LINE_COLORS.length];
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${col}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="${x1}" cy="${y1}" r="6" fill="${col}"/><circle cx="${x2}" cy="${y2}" r="6" fill="${col}"/>`;
    }).join('');
  }
  window.addEventListener('resize', drawLines);
  function bindMatch(step) {
    const c = C(step.idx);
    requestAnimationFrame(drawLines);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawLines);
    if (step.done.length === c.words.length) { bindNext(); return; }
    const tryPair = () => {
      if (step.selL === null || step.selR === null) return renderStep();
      if (step.selL === step.selR) {
        step.done.push(step.selL);
        step.selL = step.selR = null;
        renderStep();
      } else {
        const w = c.words[step.selL];
        const L = $app.querySelector(`[data-w="${step.selL}"]`);
        const R = $app.querySelector(`[data-m="${step.selR}"]`);
        [L, R].forEach((x) => x.classList.add('shake', 'bad'));
        document.getElementById('fb').innerHTML = `<div class="feedback no">앗, 다시 생각해 봐요! 🤔
          <b>${w.read}</b> = ${wordParts(w).map((p) => `${p.m} ${p.s}`).join(' + ')}</div>`;
        step.selL = step.selR = null;
        setTimeout(() => { [L, R].forEach((x) => x.classList.remove('shake', 'bad', 'sel')); }, 600);
      }
    };
    $app.querySelectorAll('[data-w]').forEach((b) => b.addEventListener('click', () => { step.selL = +b.dataset.w; tryPair(); }));
    $app.querySelectorAll('[data-m]').forEach((b) => b.addEventListener('click', () => { step.selR = +b.dataset.m; tryPair(); }));
  }

  // 3. 활용 어휘 ② — 빈칸에 알맞은 어휘 넣기
  function renderCloze(step) {
    const c = C(step.idx);
    const all = step.filled.length === c.words.length;
    const bank = c.words.map((w, k) => {
      const used = step.filled.includes(k);
      return `<button class="chip bank${used ? ' used' : ''}" data-k="${k}" ${used || all ? 'disabled' : ''}>
        <b>${w.read}</b><small class="hanja">${w.word}</small></button>`;
    }).join('');
    const items = step.order.map((k, n) => {
      const { before, after } = blankSentence(c, k);
      const filled = step.filled.includes(k);
      const cur = !all && step.cur === k;
      return `<li class="cz${cur ? ' cur' : ''}${filled ? ' ok' : ''}" data-s="${k}"><span class="cz-n">${n + 1}</span>
        <span>${esc(before)}<span class="blank">${filled ? c.words[k].read : cur ? '?' : '&nbsp;&nbsp;&nbsp;'}</span>${esc(after)}</span></li>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('cloze')}
      <p class="guide">${all ? '🎉 빈칸을 모두 채웠어요!' : '빈칸에 들어갈 알맞은 <b>활용 어휘</b>를 위의 보기에서 골라요.'}</p>
      <div class="bank-wrap"><div class="bank-title">활용 어휘 (보기)</div><div class="chips">${bank}</div></div>
      <ol class="cloze">${items}</ol>
      <div id="fb"></div>
      ${all ? nextBtn('확인하기 →') : ''}
    </div>`;
  }
  function bindCloze(step) {
    const c = C(step.idx);
    if (step.filled.length === c.words.length) { bindNext(); return; }
    $app.querySelectorAll('[data-s]').forEach((li) => li.addEventListener('click', () => {
      const k = +li.dataset.s;
      if (!step.filled.includes(k)) { step.cur = k; renderStep(); }
    }));
    $app.querySelectorAll('.bank').forEach((b) => b.addEventListener('click', () => {
      const k = +b.dataset.k;
      if (k === step.cur) {
        step.filled.push(k);
        const left = step.order.filter((x) => !step.filled.includes(x));
        step.cur = left.length ? left[0] : null;
        renderStep();
      } else {
        const w = c.words[k];
        b.classList.add('shake', 'bad');
        setTimeout(() => b.classList.remove('shake', 'bad'), 600);
        document.getElementById('fb').innerHTML = `<div class="feedback no">🤔 '<b>${w.read}</b>'은(는) '${w.mean}'이라는 뜻이에요. 이 문장에 어울리는지 다시 생각해 봐요.</div>`;
      }
    }));
  }

  // 4. 확인하기 — 한글 어휘의 표시된 글자에 쓰인 한자의 뜻과 음 쓰기 (바로 채점, 틀리면 해설)
  function wordQuestionHtml(c, w) {
    return `<div class="quiz-q">
        <div class="qword">${hangulMarked(c, w)}</div>
        <div class="qhint">뜻: ${w.mean}</div>
        <div class="prompt"><mark>색으로 표시된 글자</mark>에 쓰인 한자의 <b>뜻(훈)</b>과 <b>음</b>을 쓰세요.</div>
      </div>`;
  }
  function renderCheck(step) {
    const c = C(step.idx);
    const next = session.steps[session.i + 1] || {};
    const nextLabel = next.kind === 'check' ? '다음 문제 →' : next.kind === 'infer' ? '추론하기 →' : '다음 →';
    return `<div class="card lesson-card">${stageHtml(step.stage)}
      ${step.old ? `<p class="small muted center">${c.gradeName}에서 공부한 한자예요</p>` : ''}
      ${wordQuestionHtml(c, step.word)}
      <form id="f" autocomplete="off">
        <div class="exam-inputs">
          <div><label for="m">뜻 (훈)</label><input id="m" lang="ko" value="${esc(step.m)}" ${step.graded ? 'readonly' : ''}></div>
          <div><label for="s">음 (소리)</label><input id="s" lang="ko" value="${esc(step.s)}" ${step.graded ? 'readonly' : ''}></div>
        </div>
        <div id="fb">${step.graded ? checkFeedback(step) : ''}</div>
        ${step.graded ? nextBtn(nextLabel) : '<button class="btn block big" id="go">정답 확인</button>'}
      </form>
    </div>`;
  }
  function checkFeedback(step) {
    const c = C(step.idx);
    const w = step.word;
    const { syl } = targetPos(c, w);
    const own = charHunum(c.h, syl);
    if (step.ok) return `<div class="feedback ok">⭕ 정답이에요! '${w.read}'의 '${syl}'은(는) <b>${own.m} ${own.s}</b>(<span class="hj">${c.h}</span>)예요.</div>`;
    const why = [];
    if (!step.okM) why.push(`뜻을 '<b>${esc(step.m)}</b>'(이)라고 썼어요. 이 글자의 뜻(훈)은 '<b>${c.meanings.join(', ')}</b>'이에요.`);
    if (!step.okS) why.push(`음을 '<b>${esc(step.s)}</b>'(이)라고 썼어요. 이 글자의 소리(음)는 '<b>${c.sounds.join(', ')}</b>'이에요.`);
    if (!c.sounds.includes(syl)) why.push(`'${w.read}'에서는 '${syl}'(으)로 읽지만 본래 소리는 '${c.sounds[0]}'이에요. (두음 법칙)`);
    return `<div class="feedback no">❌ 정답은 <b>${own.m} ${own.s}</b>(<span class="hj">${c.h}</span>)예요.</div>
      <div class="explain"><div class="why"><b>틀린 까닭</b> ${why.join(' ')}</div>
      <div class="solve"><b>해설</b> ${breakdown(w)}<br>'${w.read}'의 '${targetPos(c, w).syl}'은(는) <span class="hj">${c.h}</span>(${own.m} ${own.s})예요.</div></div>`;
  }
  function bindCheck(step) {
    if (step.graded) { bindNext(); return; }
    const c = C(step.idx);
    const m = document.getElementById('m');
    const s = document.getElementById('s');
    m.focus();
    document.getElementById('f').addEventListener('submit', (e) => {
      e.preventDefault();
      step.m = m.value.trim();
      step.s = s.value.trim();
      if (!step.m || !step.s) {
        document.getElementById('fb').innerHTML = '<div class="feedback no">뜻과 음을 모두 써 주세요. 모르면 짐작해서 써도 괜찮아요!</div>';
        (step.m ? s : m).focus();
        return;
      }
      step.okM = meaningOk(c, step.m);
      step.okS = soundOk(c, step.s);
      step.ok = step.okM && step.okS;
      step.graded = true;
      score(step.ok, step.idx);
      if (step.old) S.oldSeen = Object.assign(S.oldSeen || {}, { [step.idx]: fmt(today()) });
      // 오늘 학습 기록에만 남겨요 (급수 시험 뒤 '다시 보기'의 확인하기는 학습 계획이 아니에요)
      else if (S.log[session.date] && session.plan && step.idx === session.plan.newIdx) S.log[session.date].check = step.ok;
      save();
      renderStep();
    });
  }

  // 5. 적용하기 — 짧은 글짓기
  function usedWord(c, text) {
    const t = text.replace(/\s/g, '');
    return c.words.find((w) => t.includes(plainRead(w)) || t.includes(w.word)) || null;
  }
  function renderWrite(step) {
    const c = C(step.idx);
    const chips = c.words.map((w) => `<button type="button" class="chip" data-read="${w.read}"><b>${w.read}</b><small>${w.mean}</small></button>`).join('');
    return `<div class="card lesson-card">${stageHtml('write')}
      <p class="guide">오늘 배운 낱말을 <b>하나 이상</b> 넣어 짧은 글을 지어 보세요. 낱말을 누르면 글에 들어가요.</p>
      <div class="chips">${chips}</div>
      <textarea id="text" class="text-input" rows="3" maxlength="200" placeholder="예) ${esc(c.ex.replace(/\([^)]*\)/, ''))}">${esc(step.text)}</textarea>
      <div id="fb"></div>
      <button class="btn block big" id="save">글 저장하고 다음 →</button>
    </div>`;
  }
  function bindWrite(step) {
    const c = C(step.idx);
    const ta = document.getElementById('text');
    ta.addEventListener('input', () => { step.text = ta.value; });
    $app.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
      const pos = ta.selectionStart ?? ta.value.length;
      ta.value = ta.value.slice(0, pos) + b.dataset.read + ta.value.slice(ta.selectionEnd ?? pos);
      step.text = ta.value;
      ta.focus();
    }));
    document.getElementById('save').addEventListener('click', () => {
      const text = ta.value.trim();
      const fb = document.getElementById('fb');
      if (text.length < 5) {
        fb.innerHTML = '<div class="feedback no">조금 더 길게, 한 문장으로 써 보세요.</div>';
        return;
      }
      const w = usedWord(c, text);
      if (!w) {
        fb.innerHTML = `<div class="feedback no">배운 낱말(${c.words.map((x) => x.read).join(', ')}) 가운데 하나를 넣어 써 보세요.</div>`;
        return;
      }
      const ds = session.date;
      S.writings = S.writings.filter((x) => !(x.date === ds && x.idx === step.idx));
      S.writings.push({ date: ds, idx: step.idx, word: w.word, text });
      save();
      nextStep();
    });
  }

  // 5. 추론하기 — 처음 보는 어휘 2개 가운데 오늘의 한자가 쓰인 어휘 고르기 (보기는 한글만, 바로 채점, 맞아도 틀려도 해설)
  function renderInfer(step) {
    const c = C(step.idx);
    const answered = step.chosen !== null;
    const opts = step.options.map((w, k) => {
      let cls = '';
      if (answered && w.read === step.answer) cls = ' correct';
      else if (answered && w.read === step.chosen) cls = ' wrong';
      return `<button class="opt big-opt${cls}" data-k="${k}" ${answered ? 'disabled' : ''}><span class="opt-n">${k + 1}</span>${w.read}</button>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('infer')}
      <div class="quiz-q">
        <div class="today-chip"><span class="hanja">${c.h}</span> ${hunum(c)}</div>
        <div class="prompt">오늘의 한자 '<b>${hunum(c)}</b>'가 <b class="pos">쓰인</b> 어휘는 무엇일까요?</div>
        <div class="qhint">단어의 뜻을 생각해 보며 짐작해 보세요!</div>
      </div>
      <div class="options two">${opts}</div>
      <div id="fb">${answered ? inferFeedback(step) : ''}</div>
      ${answered ? nextBtn('적용하기 →') : ''}
    </div>`;
  }
  // 해설: 두 보기를 나란히 놓고, 오늘 한자의 음훈은 초록, 소리만 같은 다른 한자(또는 우리말)는 빨강으로 표시해요.
  function inferFeedback(step) {
    const c = C(step.idx);
    const ans = step.options.find((w) => w.read === step.answer);
    const oth = step.options.find((w) => w.read === step.other);
    const sounds = new Set(c.sounds.flatMap((s) => [s, dueum(s)]));
    const own = wordParts(ans).find((p) => p.ch === c.h);
    const look = oth.native ? null : wordParts(oth).find((p) => sounds.has(p.s));
    const ok = step.chosen === step.answer;
    const card = (w, good) => {
      const chars = w.native
        ? `<div class="ic-native"><span class="tag-red">우리말(고유어)</span><small>한자가 아니에요</small></div>`
        : `<div class="wchars">${wordParts(w).map((p) => {
          const cls = good && p.ch === c.h ? ' good' : !good && look && p.ch === look.ch ? ' bad' : '';
          return `<span class="wc${cls}"><b class="hanja">${p.ch}</b><small>${p.m} <strong>${p.s}</strong></small></span>`;
        }).join('')}</div>`;
      return `<div class="icard ${good ? 'ok' : 'no'}${w.read === step.chosen ? ' picked' : ''}">
        <div class="ic-top">${good ? '⭕ 오늘의 한자' : '✕ 소리만 같아요'}${w.read === step.chosen ? '<span class="mine">내가 고름</span>' : ''}</div>
        <div class="ic-word">${w.read}</div>
        ${chars}
        <div class="ic-mean">${w.mean}</div>
      </div>`;
    };
    const same = oth.native ? oth.read[0] : look ? look.s : own.s;
    const right = oth.native ? '우리말' : look ? `${look.ch} ${look.m} ${look.s}` : '다른 한자';
    return `<div class="feedback ${ok ? 'ok' : 'no'}">${ok ? '⭕ 정답이에요! 뜻을 잘 추론했어요.' : `❌ 정답은 '${ans.read}'예요.`}</div>
      <div class="icards">${card(ans, true)}${card(oth, false)}</div>
      <div class="ic-sum">같은 '<b>${same}</b>' 소리라도
        <span class="g">${c.h} ${own.m} ${own.s}</span> ≠ <span class="r">${right}</span></div>`;
  }
  function bindInfer(step) {
    if (step.chosen !== null) { bindNext(); return; }
    $app.querySelectorAll('.big-opt').forEach((b) => b.addEventListener('click', () => {
      step.chosen = step.options[+b.dataset.k].read;
      const ok = step.chosen === step.answer;
      score(ok, step.idx);
      if (S.log[session.date] && session.plan && step.idx === session.plan.newIdx) S.log[session.date].infer = ok;
      save();
      renderStep();
    }));
  }

  // 복습 문제(객관식, 바로 채점)
  function renderPick(step) {
    const c = C(step.idx);
    const w = step.word;
    let q;
    if (step.type === 'sound') {
      q = `<div class="qword">${hangulMarked(c, w)}</div><div class="qhint">뜻: ${w.mean}</div>
        <div class="prompt"><mark>색으로 표시된 글자</mark>에 쓰인 한자의 <b>음훈</b>은?</div>`;
    } else {
      q = `${hangulPartsHtml(w, c.h)}<div class="prompt">음훈을 보고 '<b>${w.read}</b>'의 <b>뜻</b>을 골라요.</div>`;
    }
    const answered = step.chosen !== undefined;
    const opts = step.options.map((o, k) => {
      let cls = '';
      if (answered && o === step.answer) cls = ' correct';
      else if (answered && o === step.chosen) cls = ' wrong';
      return `<button class="opt${cls}" data-k="${k}" ${answered ? 'disabled' : ''}>${o}</button>`;
    }).join('');
    let fb = '';
    if (answered) {
      const ok = step.chosen === step.answer;
      fb = `<div class="feedback ${ok ? 'ok' : 'no'}">${ok ? '⭕ 정답이에요!' : '❌ 아쉬워요. 다음 복습 때 다시 나와요.'}<br>${breakdown(w)}</div>${nextBtn()}`;
    }
    return `<div class="card lesson-card">${stageHtml(step.stage)}
      <div class="quiz-q">${q}</div>
      <div class="options">${opts}</div>
      <div id="fb">${fb}</div></div>`;
  }
  function bindPick(step) {
    if (step.chosen !== undefined) { bindNext(); return; }
    $app.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      step.chosen = step.options[+b.dataset.k];
      score(step.chosen === step.answer, step.idx);
      renderStep();
    }));
  }

  function renderWeekIntro(step) {
    const list = step.list.map((i) => `<span class="wk-char">${C(i).h}<small>${hunum(C(i))}</small></span>`).join('');
    return `<div class="card lesson-card center">${stageHtml('week')}
      <h2>이번 주에 배운 한자 ${step.list.length}자</h2>
      <div class="wk-list">${list}</div>
      <p class="muted small">일주일이 지나면 배운 내용을 많이 잊어버려요.<br>지금 한 번 더 떠올리면 기억이 훨씬 오래가요!</p>
      ${nextBtn('복습 시작 →')}</div>`;
  }

  function renderWeekSummary(step) {
    const rows = step.list.map((i) => {
      const c = C(i);
      const miss = S.missed.includes(i);
      return `<tr><td><button class="cell-in hanja${miss ? ' miss' : ''}" data-open="${i}">${c.h}</button></td>
        <td><b>${hunum(c)}</b> ${miss ? '<span class="pill">다시 보기</span>' : ''}<div class="ws">${c.words.map((w) => w.read).join(', ')}</div></td></tr>`;
    }).join('');
    return `<div class="card lesson-card">${stageHtml('week')}
      <h2>이번 주 한자 정리</h2>
      <table class="summary-table">${rows}</table>
      ${nextBtn('마치기 →')}</div>`;
  }

  function renderDone() {
    stopTimer();
    finishSession();
    if (S.phase === 'study' && !queueLeft()) { S.phase = 'exam'; save(); }
    document.body.classList.remove('in-lesson');
    const g = curGrade();
    let title = '오늘 학습 끝!';
    let msg = '잘했어요! 틀린 한자는 다음 복습에 다시 나와요.';
    let writing = '';
    let action = '';
    const learnedNew = ['lesson', 'extra'].includes(session.type) && session.plan.newIdx !== null && session.plan.newIdx !== undefined;
    if (learnedNew) {
      const wr = S.writings.find((x) => x.date === session.date && x.idx === session.plan.newIdx);
      if (wr) writing = `<div class="my-writing"><span class="lbl">✏️ 오늘 지은 글</span>${esc(wr.text)}</div>`;
      if (session.type === 'lesson' && !session.plan.week.length) msg = '내일 아침 복습에서 다시 만나요.';
    }
    if (session.type === 'lesson' && session.plan.week.length) title = '한 주 학습 끝!';
    if (session.type === 'extra') title = '한 자 더 배웠어요!';
    if (session.type === 'weekly') title = '일주일 복습 끝!';
    if (session.type === 'review') title = '복습 끝!';
    if (session.type === 'oldreview') { title = '복습 끝!'; msg = '틀린 한자는 다음 복습에 다시 나와요. 이제 오늘 공부하러 가요!'; }
    if (session.type === 'relearn') {
      title = '다시 보기 끝!';
      msg = `이제 ${g.name} 급수 시험을 다시 볼 차례예요. 100점에 도전해요!`;
      action = `<a class="btn block big" href="#/test">🏆 ${g.name} 급수 시험 다시 보기</a>`;
    } else if (S.phase === 'exam' && learnedNew) {
      action = `<div class="card notice" style="text-align:left;margin-top:16px">
        <h3>🎓 ${g.name}에서 공부할 한자를 모두 배웠어요!</h3>
        <p class="small muted">${g.name} ${g.end - g.start}자 전체로 급수 시험을 봐요. 100점이면 다음 급수로 올라가요.</p>
        <a class="btn block" href="#/test">🏆 급수 시험 도전</a></div>`;
    } else if (learnedNew && nextNewIdx() !== null) {
      action = `<button class="btn ghost block" id="more" style="margin-top:12px">➕ 한 자 더 배우기 (남은 한자 ${queueLeft()}자)</button>`;
    }
    // 확인하기·추론하기에서 틀리면 다음 학습일에 다시 배워요 (완전 학습).
    let redoNote = '';
    if (learnedNew && session.failed) {
      const rc = C(session.plan.newIdx);
      redoNote = `<div class="redo-note">🔁 틀린 문제가 있어서 <span class="hanja">${rc.h}</span>(${hunum(rc)})는
        <b>다음 학습일에 다시 배워요.</b><br><span class="small">모든 한자를 완전히 익혀야 급수 시험에 도전할 수 있어요.</span></div>`;
    }
    const html = `<div class="card celebrate">
      <div class="emoji">${session.failed ? '💪' : '🏅'}</div>
      <h2>${title}</h2>
      ${redoNote}
      ${session.total ? `<p>문제 <b>${session.correct} / ${session.total}</b> 정답</p>` : ''}
      ${todayTimeHtml()}
      ${writing}
      <p class="muted">${msg}</p>
      ${session.type === 'lesson' ? `<p class="streak">🔥 연속 학습 <b>${streak()}일</b></p>` : ''}
      ${session.type === 'relearn' ? action : `<a class="btn block big" href="#/">홈으로</a>${action}`}
    </div>`;
    session = null;
    return html;
  }

  /* ================= 화면: 한자 목록 ================= */
  let listGrade = null;
  function renderList() {
    setTab('list');
    if (listGrade === null) listGrade = Math.min(S.gradeIdx, GRADES.length - 1);
    const g = GRADES[listGrade];
    const tabs = GRADES.map((x, k) => `<button class="${k === listGrade ? 'on' : ''}" data-g="${k}">${x.name}</button>`).join('');
    const cells = HANJA.slice(g.start, g.end).map((c) => {
      const cls = S.missed.includes(c.idx) ? 'missed' : S.learned[c.idx] ? 'learned' : S.known[c.idx] ? 'known' : 'locked';
      return `<button class="cell-btn ${cls}" data-open="${c.idx}" aria-label="${c.h} ${hunum(c)}">
        <span class="hanja">${c.h}</span><span class="hu">${hunum(c)}</span></button>`;
    }).join('');
    $app.innerHTML = `
      <div class="card">
        <div class="row"><h2 style="margin:0">한자 목록</h2><span class="spacer"></span>
          <span class="small muted">배운 한자 ${S.order.length} / ${HANJA.length}</span></div>
      </div>
      <div class="tabs">${tabs}</div>
      <div class="card">
        <div class="row"><b>${g.name}</b>${S.passed[g.id] ? '<span class="pill green">통과 ✓</span>' : ''}</div>
        <div class="legend"><span><i style="background:var(--blue)"></i>이미 아는 한자</span><span><i style="background:var(--green)"></i>공부한 한자</span>
          <span><i style="background:var(--red)"></i>다시 볼 한자</span><span><i style="background:var(--line)"></i>아직 안 배움</span></div>
        <div class="grid">${cells}</div>
      </div>
      <p class="small muted center">준비 중: ${UPCOMING_GRADES.join(' · ')}</p>`;
    $app.querySelectorAll('[data-g]').forEach((b) => b.addEventListener('click', () => { listGrade = +b.dataset.g; renderList(); }));
    bindOpen();
  }

  /* ================= 화면: 학습 기록 ================= */
  function renderRecords() {
    setTab('records');
    const lessons = S.activity.filter((a) => a.type === 'lesson');
    const quizT = S.activity.reduce((n, a) => n + (a.total || 0), 0);
    const quizC = S.activity.reduce((n, a) => n + (a.correct || 0), 0);
    const byDate = {};
    S.activity.forEach((a) => { (byDate[a.date] = byDate[a.date] || []).push(a); });
    S.writings.forEach((w) => { (byDate[w.date] = byDate[w.date] || []).push({ type: 'writing', ...w }); });
    Object.keys(S.time || {}).forEach((d) => { byDate[d] = byDate[d] || []; });
    const dates = Object.keys(byDate).sort().reverse();
    const label = (a) => {
      if (a.type === 'lesson') {
        const c = a.idx !== null && a.idx !== undefined ? C(a.idx) : null;
        return `📘 ${c ? `<button class="linkbtn hanja" data-open="${c.idx}">${c.h}</button> ${hunum(c)} 학습` : '복습'}${a.extra ? ' (더 배우기)' : ''}${a.week ? ' · 일주일 복습' : ''} · 퀴즈 ${a.correct}/${a.total}`;
      }
      if (a.type === 'weekly') return `🗓 일주일 복습 · 퀴즈 ${a.correct}/${a.total}`;
      if (a.type === 'review') return `🔁 자유 복습 · 퀴즈 ${a.correct}/${a.total}`;
      if (a.type === 'oldreview') return `🔁 입장 복습(지난 급수·어제 배운 한자) · ${a.correct}/${a.total}`;
      if (a.type === 'exam') return `🏆 ${a.grade} 급수 시험 ${a.score}점 ${a.passed ? '(통과)' : ''}`;
      if (a.type === 'accept') return `👩‍🏫 선생님이 <span class="hanja">${C(a.idx).h}</span>의 답을 인정했어요`;
      if (a.type === 'level') return `🧪 ${a.grade} 레벨테스트 · 아는 한자 ${a.known}/${a.total}`;
      if (a.type === 'relearn') return `🔁 틀린 한자 다시 보기 ${(a.list || []).map((i) => C(i).h).join(' ')}`;
      if (a.type === 'writing') return `✏️ 글짓기: “${esc(a.text)}”`;
      return '';
    };
    const timeline = dates.map((d) => `<div class="tl-day"><div class="tl-date">${shortDate(d)}${(S.time || {})[d] ? `<span class="tl-time">⏱ ${fmtTime(S.time[d])}</span>` : ''}</div>
      <ul>${byDate[d].map((a) => `<li>${label(a)}</li>`).join('')}</ul></div>`).join('');

    $app.innerHTML = `
      <div class="card">
        <h2>${esc(user)}의 학습 기록</h2>
        <div class="stats" style="grid-template-columns:repeat(4,1fr)">
          <div><b>${lessons.length}</b><span>학습한 날</span></div>
          <div><b>${S.order.length}</b><span>공부한 한자</span></div>
          <div><b>${S.writings.length}</b><span>글짓기</span></div>
          <div><b>${quizT ? Math.round((quizC / quizT) * 100) : 0}%</b><span>퀴즈 정답률</span></div>
        </div>
        <div class="stats" style="grid-template-columns:repeat(2,1fr);margin-top:10px">
          <div><b>${fmtTime(todaySecs())}</b><span>오늘 공부한 시간</span></div>
          <div><b>${fmtTime(totalSecs())}</b><span>모두 합친 시간</span></div>
        </div>
      </div>
      <div class="card">
        <h3>날짜별 활동</h3>
        ${timeline || '<p class="muted small">아직 기록이 없어요. 오늘의 학습을 시작해 보세요!</p>'}
      </div>`;
    bindOpen();
  }

  /* ================= 레벨테스트 · 급수 시험 ================= */
  // 두 시험은 같은 모양입니다: 한자 1자 + 활용 어휘 2개(한자, 한글 읽기) → 뜻(훈)과 음 쓰기
  function makeTest(kind) {
    const g = curGrade();
    let idxs = HANJA.slice(g.start, g.end).map((c) => c.idx);
    if (kind === 'exam') idxs = shuffle(idxs);
    return {
      kind, grade: g.id, i: 0, finished: false, started: fmt(today()),
      items: idxs.map((i) => ({ idx: i, words: shuffle(C(i).words.map((_, k) => k)).slice(0, 2), m: '', s: '', skip: false, over: false })),
    };
  }
  const itemOk = (it) => !it.skip && soundOk(C(it.idx), it.s) && (it.over || meaningOk(C(it.idx), it.m));
  const testName = (t) => (t.kind === 'level' ? '레벨테스트' : '급수 시험');

  function startTest(kind) {
    const want = kind === 'level' ? 'level' : 'exam';
    if (S.phase !== want) { location.hash = '#/'; return; }
    if (!S.test || S.test.kind !== kind || S.test.grade !== curGrade().id) {
      S.test = makeTest(kind);
      save();
    }
    document.body.classList.add('in-lesson');
    renderTest();
  }

  function renderTest() {
    const t = S.test;
    if (t.i >= t.items.length) { renderTestResult(); return; }
    const it = t.items[t.i];
    const c = C(it.idx);
    const g = GRADES.find((x) => x.id === t.grade);
    const pct = (t.i / t.items.length) * 100;
    const words = it.words.map((k) => {
      const w = c.words[k];
      // 어휘 읽기에서 이 한자의 음만 빨간색
      const { k: pos } = targetPos(c, w);
      const read = [...plainRead(w)].map((ch, j) => (j === pos ? `<b class="tw-on">${ch}</b>` : ch)).join('');
      return `<span class="tw">${read}</span>`; // 한글만 보여 줘요
    }).join('');
    $app.innerHTML = `
      <div class="lesson-head">
        <button class="close-x" id="quit" aria-label="나중에 이어서 하기">✕</button>
        <div class="progress"><span style="width:${pct}%"></span></div>
        <span class="timer">${t.i + 1} / ${t.items.length}</span>${studyClock()}
      </div>
      <div class="card lesson-card">
        <div class="stage stage-${t.kind === 'level' ? 's3' : 'week'}"><span class="stage-e">${t.kind === 'level' ? '🧪' : '🏆'}</span><b>${g.name} ${testName(t)}</b></div>
        <div class="quiz-q">
          <div class="test-pair">
            <div class="test-hanja">${c.h}</div>
            <div class="test-words">${words}</div>
          </div>
          <div class="prompt">이 한자의 <b>뜻(훈)</b>과 <b>음</b>을 쓰세요.</div>
        </div>
        <form id="f" autocomplete="off">
          <div class="exam-inputs">
            <div><label for="m">뜻 (훈)</label><input id="m" lang="ko" enterkeyhint="next" value="${esc(it.m)}"></div>
            <div><label for="s">음 (소리)</label><input id="s" lang="ko" enterkeyhint="done" value="${esc(it.s)}"></div>
          </div>
          ${it.skip ? '<p class="small muted center" style="margin:8px 0 0">앞에서 \'몰라요\'로 넘긴 문제예요. 답을 쓰면 고칠 수 있어요.</p>' : ''}
          <div id="fb"></div>
          <div class="btn-row test-btns">
            <button type="button" class="btn ghost" id="prev" ${t.i === 0 ? 'disabled' : ''}>← 이전</button>
            <button type="button" class="btn soft" id="skip">🤔 몰라요</button>
            <button class="btn" id="go">다음 →</button>
          </div>
        </form>
        <p class="small muted center">${t.kind === 'level' ? '모르는 한자는 \'몰라요\'를 눌러요. 틀린 한자만 공부하게 돼요.' : '채점은 모든 문제를 푼 뒤에 해요.'}</p>
      </div>`;
    const m = document.getElementById('m');
    const s = document.getElementById('s');
    m.focus();
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); s.focus(); } });
    const advance = () => { t.i++; save(); renderTest(); window.scrollTo(0, 0); };
    document.getElementById('prev').addEventListener('click', () => {
      if (t.i === 0) return;
      // 지금 쓴 답은 남겨 두고 이전 문제로 돌아가 고칠 수 있어요.
      if (m.value.trim() || s.value.trim()) Object.assign(it, { m: m.value.trim(), s: s.value.trim(), skip: false });
      t.i--;
      save();
      renderTest();
      window.scrollTo(0, 0);
    });
    document.getElementById('quit').addEventListener('click', () => { location.hash = '#/'; });
    document.getElementById('skip').addEventListener('click', () => {
      Object.assign(it, { m: '', s: '', skip: true });
      advance();
    });
    document.getElementById('f').addEventListener('submit', (e) => {
      e.preventDefault();
      if (!m.value.trim() || !s.value.trim()) {
        document.getElementById('fb').innerHTML = '<div class="feedback no">뜻과 음을 모두 써 주세요. 모르면 \'몰라요\'를 눌러요.</div>';
        (m.value.trim() ? s : m).focus();
        return;
      }
      Object.assign(it, { m: m.value.trim(), s: s.value.trim(), skip: false });
      advance();
    });
  }

  // 음은 맞고 뜻을 다르게 쓴 답: 선생님이 확인해야 인정할 수 있어요.
  const isAmbiguous = (it) => !it.skip && !!it.m && !it.over && soundOk(C(it.idx), it.s) && !meaningOk(C(it.idx), it.m);
  let resultTeacher = false;
  function renderTestResult() {
    const t = S.test;
    const g = GRADES.find((x) => x.id === t.grade);
    t.finished = true;
    save();
    document.body.classList.remove('in-lesson');
    const wrong = t.items.filter((it) => !itemOk(it));
    const right = t.items.length - wrong.length;
    const scoreN = Math.round((right / t.items.length) * 100);
    const accepted = t.items.filter((it) => it.over).length;
    const amb = wrong.filter(isAmbiguous);
    const list = wrong.map((it) => {
      const c = C(it.idx);
      const k = t.items.indexOf(it);
      return `<li${isAmbiguous(it) ? ' class="amb"' : ''}><button class="cell-in hanja miss" data-open="${c.idx}">${c.h}</button>
        <div class="wl-body"><b>${hunum(c)}</b>
          <div class="small muted">내 답: ${it.skip ? '몰라요' : `${esc(it.m)} ${esc(it.s)}`}</div>
          ${isAmbiguous(it) ? (resultTeacher
            ? `<button class="btn soft small-btn" data-over="${k}">✔ 뜻 "${esc(it.m)}" 인정하기</button>`
            : '<span class="pill">🤔 선생님 확인 필요</span>') : ''}
        </div></li>`;
    }).join('');
    const head = t.kind === 'level'
      ? `<div class="score">${right}<small> / ${t.items.length}자</small></div>
         <p>이미 아는 한자 <b>${right}자</b> · 공부할 한자 <b>${wrong.length}자</b></p>
         <p class="small muted">${wrong.length ? `이제 공부할 한자 ${wrong.length}자만 평일 아침에 하루 한 자씩 배워요.` : `${g.name} 한자를 모두 알고 있어요! 바로 다음 급수로 올라가요.`}</p>`
      : `<div class="score">${scoreN}<small>점</small></div>
         <p>${t.items.length}문항 중 ${right}문항 정답</p>
         <div class="stamp ${scoreN === 100 ? 'pass' : 'fail'}">${scoreN === 100 ? '통과' : '다시 도전'}</div>
         <p class="small muted" style="margin-top:14px">${scoreN === 100 ? '완벽해요! 다음 급수 레벨테스트로 올라가요.' : `100점이어야 다음 급수로 올라가요. 틀린 ${wrong.length}자를 다시 익히고 급수 시험을 다시 봐요.`}</p>`;
    let teacherBox = '';
    if (amb.length && !resultTeacher) {
      teacherBox = `<div class="card notice">
        <h3>🤔 뜻을 다르게 쓴 답이 ${amb.length}개 있어요</h3>
        <p class="small">음은 맞았지만 뜻을 다른 말로 쓴 답이에요. 선생님께 보여 드리고 확인을 받으면 맞은 답으로 인정돼요.
          지금 확인하지 못하면 나중에 선생님이 선생님 메뉴에서 인정할 수 있어요.</p>
        ${teacherSet() ? `<form id="tchk" class="row" autocomplete="off">
            <input id="tpw" type="password" class="text-input" placeholder="선생님 비밀번호" style="flex:1;margin:0">
            <button class="btn">👩‍🏫 선생님 확인</button></form><div id="tfb"></div>`
          : '<p class="small muted">선생님 비밀번호가 아직 없어요. 선생님 메뉴에서 먼저 만들어 주세요.</p>'}
      </div>`;
    } else if (amb.length) {
      teacherBox = '<div class="card notice"><h3>👩‍🏫 선생님 확인 중</h3><p class="small">맞다고 판단한 답의 \'인정하기\'를 눌러 주세요. 인정하지 않은 답은 틀린 답으로 남아요.</p></div>';
    }
    $app.innerHTML = `
      <div class="card celebrate">
        <div class="stage-label">${g.name} ${testName(t)} 결과</div>
        ${head}
        ${accepted ? `<p class="small">👩‍🏫 선생님이 인정한 답 ${accepted}개</p>` : ''}
        <button class="btn block big" id="confirm">확인</button>
      </div>
      ${teacherBox}
      ${wrong.length ? `<div class="card"><h3>${t.kind === 'level' ? '공부할 한자' : '틀린 한자'} ${wrong.length}자</h3>
        <ul class="wrong-list">${list}</ul></div>` : ''}`;
    bindOpen();
    const tchk = document.getElementById('tchk');
    if (tchk) tchk.addEventListener('submit', (e) => {
      e.preventDefault();
      if (checkTeacher(document.getElementById('tpw').value)) { resultTeacher = true; renderTestResult(); }
      else document.getElementById('tfb').innerHTML = '<div class="feedback no">선생님 비밀번호가 맞지 않아요.</div>';
    });
    $app.querySelectorAll('[data-over]').forEach((b) => b.addEventListener('click', () => {
      t.items[+b.dataset.over].over = true;
      save();
      renderTestResult();
    }));
    document.getElementById('confirm').addEventListener('click', () => { resultTeacher = false; finalizeTest(); });
  }

  function passGrade(g, st = S) {
    st.passed[g.id] = fmt(today());
    st.gradeIdx = GRADES.indexOf(g) + 1;
    st.queue = [];
    st.relearn = [];
    if (st.test && st.test.grade === g.id) st.test = null;
    st.phase = st.gradeIdx >= GRADES.length ? 'done' : 'level';
  }
  // 마지막 급수 시험에서 아직 인정받지 못한 틀린 한자 수
  // (예전 기록은 틀린 한자 목록이 없어서, 점수와 그 뒤에 선생님이 인정한 한자로 셈해요)
  function examWrongLeft(st, g) {
    const rec = st.exams[g.id];
    if (!rec) return null;
    if (rec.wrong) return rec.wrong.length;
    const total = g.end - g.start;
    let n = Math.round(((100 - rec.last) / 100) * total);
    let k = -1;
    st.activity.forEach((a, j) => { if (a.type === 'exam' && a.grade === g.name) k = j; });
    const acc = new Set(st.activity.slice(k + 1)
      .filter((a) => a.type === 'accept' && a.kind === 'exam' && C(a.idx).gradeIdx === GRADES.indexOf(g)).map((a) => a.idx));
    return Math.max(0, n - acc.size);
  }
  // 급수 시험 뒤(다시 보기 전이든 후든) 선생님 인정으로 틀린 한자가 모두 없어졌으면 통과
  function checkExamPass(st) {
    if (!['exam', 'relearn'].includes(st.phase) || st.gradeIdx >= GRADES.length) return false;
    const g = GRADES[st.gradeIdx];
    const rec = st.exams[g.id];
    if (!rec || st.passed[g.id]) return false;
    if (examWrongLeft(st, g) !== 0) return false;
    rec.last = 100;
    rec.best = 100;
    passGrade(g, st);
    return true;
  }
  const goHash = (h) => { if (location.hash === h) route(); else location.hash = h; };
  function finalizeTest() {
    const t = S.test;
    const g = GRADES.find((x) => x.id === t.grade);
    const ds = fmt(today());
    const wrong = t.items.filter((it) => !itemOk(it)).map((it) => it.idx);
    const right = t.items.length - wrong.length;
    // 확인받지 못한 애매한 답은 선생님 메뉴에서 나중에 인정할 수 있게 모아 둡니다.
    S.pending = (S.pending || []).filter((p) => !(p.kind === t.kind && p.grade === g.id))
      .concat(t.items.filter(isAmbiguous).map((it) => ({ kind: t.kind, grade: g.id, idx: it.idx, m: it.m, s: it.s, date: ds })));
    let next;
    if (t.kind === 'level') {
      t.items.forEach((it) => { if (itemOk(it) && !S.learned[it.idx]) S.known[it.idx] = ds; });
      S.levels[g.id] = { date: ds, known: right, total: t.items.length };
      logActivity({ type: 'level', grade: g.name, known: right, total: t.items.length });
      if (!wrong.length) {
        passGrade(g);
        next = 'pass';
      } else {
        S.queue = wrong.sort((a, b) => a - b);
        S.phase = 'study';
        next = 'study';
      }
    } else {
      const scoreN = Math.round((right / t.items.length) * 100);
      const rec = S.exams[g.id] || { best: 0, attempts: 0 };
      // wrong: 아직 인정받지 못한 틀린 한자 (선생님이 인정하면 빠지고, 다 빠지면 통과)
      S.exams[g.id] = { best: Math.max(rec.best, scoreN), last: scoreN, attempts: rec.attempts + 1, date: ds, wrong: wrong.slice() };
      logActivity({ type: 'exam', grade: g.name, score: scoreN, passed: scoreN === 100, correct: right, total: t.items.length });
      wrong.forEach(addMissed);
      if (!wrong.length) {
        passGrade(g);
        next = 'pass';
      } else {
        S.relearn = wrong;
        S.phase = 'relearn';
        next = 'relearn';
      }
    }
    S.test = null;
    save();
    const ng = S.phase === 'done' ? null : curGrade();
    const body = next === 'pass'
      ? `<div class="emoji">🎉</div><h2>${g.name} 통과!</h2>
         ${ng ? `<p>이제 <b>${ng.name}</b> 레벨테스트를 볼 차례예요.</p><button class="btn block big" data-go="#/level">${ng.name} 레벨테스트 시작</button>`
              : '<p>준비된 모든 급수를 통과했어요! 정말 대단해요.</p>'}
         <a class="btn soft block" href="#/" style="margin-top:10px">나중에 하기</a>`
      : next === 'study'
        ? `<div class="emoji">📚</div><h2>공부할 한자 ${wrong.length}자</h2>
           <p>평일 아침에 하루 한 자씩 배워요. 다 배우면 ${g.name} 급수 시험을 봐요.</p><a class="btn block big" href="#/">홈으로</a>`
        : `<div class="emoji">💪</div><h2>틀린 한자 ${wrong.length}자 다시 보기</h2>
           <p>틀린 한자를 다시 익히고 ${g.name} 급수 시험을 다시 봐요.</p><button class="btn block big" data-go="#/relearn">다시 보기 시작</button>
           <a class="btn soft block" href="#/" style="margin-top:10px">나중에 하기</a>`;
    $app.innerHTML = `<div class="card celebrate">${body}${todayTimeHtml()}</div>`;
    // 이미 같은 주소(#/level)에 있어도 다음 레벨테스트가 시작되도록 직접 이동합니다.
    $app.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => goHash(b.dataset.go)));
  }

  /* ================= 화면: 급수 시험 탭 ================= */
  let hideHunum = false;
  function renderExamHome() {
    setTab('exam');
    const g = curGrade();
    const rows = GRADES.map((x, k) => {
      const lv = S.levels[x.id];
      const ex = S.exams[x.id];
      let status;
      if (S.passed[x.id]) status = '<span class="pill green">통과 ✓</span>';
      else if (k === S.gradeIdx) status = `<span class="pill">${{ level: '레벨테스트', study: '공부 중', exam: '시험 볼 차례', relearn: '다시 보기' }[S.phase] || ''}</span>`;
      else status = '<span class="pill gray">잠김</span>';
      return `<div class="card grade-item${k === S.gradeIdx && !S.passed[x.id] ? ' now' : ''}">
        <div class="gname">${x.name}</div>
        <div class="ginfo">${status}
          <div class="small muted">${lv ? `레벨테스트: 아는 한자 ${lv.known}/${lv.total}` : '레벨테스트 전'}${ex ? ` · 시험 ${ex.attempts}번, 최근 ${ex.last}점` : ''}</div>
        </div></div>`;
    }).join('');
    let review = '';
    if (S.phase !== 'level' && S.phase !== 'done') {
      const cells = HANJA.slice(g.start, g.end).map((c) => `
        <button class="cell-btn ${S.missed.includes(c.idx) ? 'missed' : S.known[c.idx] ? 'known' : S.learned[c.idx] ? 'learned' : 'locked'} ${hideHunum ? 'hide-hu' : ''}" data-open="${c.idx}">
          <span class="hanja">${c.h}</span><span class="hu">${hunum(c)}</span></button>`).join('');
      review = `<div class="card">
        <h2>📖 ${g.name} 전체 복습</h2>
        <p class="small muted">급수 시험은 ${g.name} ${g.end - g.start}자를 모두 봐요. 훑어보며 뜻과 음을 떠올려 보세요.</p>
        <label class="row small" style="margin:8px 0 12px"><input type="checkbox" class="switch" id="hide" ${hideHunum ? 'checked' : ''}> 뜻·음 가리고 스스로 떠올리기</label>
        <div class="grid">${cells}</div>
        ${S.phase === 'exam' ? '<a class="btn block big" href="#/test">🏆 급수 시험 보기</a>' : ''}
      </div>`;
    }
    $app.innerHTML = `
      <div class="card">
        <h2>급수 시험</h2>
        <p class="small muted" style="margin:0">레벨테스트 → 틀린 한자 공부 → 급수 시험(급수 전체) 순서로 진행해요.
          <b>100점</b>이어야 다음 급수로 올라가요. 틀리면 틀린 한자를 다시 익히고 다시 도전해요.</p>
      </div>
      ${review}
      ${rows}
      <div class="card"><h3>준비 중인 급수</h3><div>${UPCOMING_GRADES.map((n) => `<span class="pill gray" style="margin:3px">${n}</span>`).join('')}</div></div>`;
    const hide = document.getElementById('hide');
    if (hide) hide.addEventListener('change', (e) => { hideHunum = e.target.checked; renderExamHome(); });
    bindOpen();
  }

  /* ================= 화면: 설정 ================= */
  function renderSettings() {
    setTab('settings');
    $app.innerHTML = `
      <div class="card">
        <h2>설정</h2>
        <div class="setting">
          <div class="txt"><b>학생</b><div class="small muted">${esc(user)}</div></div>
          <button class="btn ghost" id="switch">로그아웃</button>
        </div>
        <form class="setting pw-form" id="pwf" autocomplete="off">
          <div class="txt"><b>비밀번호 바꾸기</b>
            <input id="pw0" type="password" class="text-input" placeholder="지금 비밀번호">
            <input id="pw1" type="password" class="text-input" placeholder="새 비밀번호 (4글자 이상)">
            <div id="pwfb"></div></div>
          <button class="btn ghost">바꾸기</button>
        </form>
        <div class="setting">
          <div class="txt"><b>선생님 메뉴</b><div class="small muted">학생 기록 보기, 비밀번호 초기화</div></div>
          <a class="btn ghost" href="#/teacher">열기</a>
        </div>
        <div class="setting">
          <div class="txt"><b>학습 기록 초기화</b><div class="small muted">${esc(user)}의 배운 한자, 글짓기, 시험 기록이 모두 지워져요.</div></div>
          <button class="btn ghost" id="reset">초기화</button>
        </div>
      </div>

      <div class="card">
        <h2>이렇게 공부해요</h2>
        <p class="small">독일의 심리학자 <b>에빙하우스</b>는 사람이 새로 배운 것을 하루만 지나도 절반 넘게 잊어버린다는
          <b>망각 곡선</b>을 발견했어요. 하지만 잊어버리기 전에 다시 떠올리면 기억이 점점 오래 남아요.</p>
        ${curveSvg()}
        <ol class="plain small">
          <li><b>🧪 레벨테스트</b> — 급수마다 먼저 한자와 활용 어휘 2개를 보고 뜻과 음을 써요. 이미 아는 한자는 건너뛰고 <b>틀린 한자만</b> 공부해요.</li>
          <li><b>① 오늘의 한자</b> — 뜻(훈)과 소리(음)를 익혀요.</li>
          <li><b>② 활용 어휘 ①</b> — 한자 아래 음훈을 힌트로 어휘와 뜻을 선으로 연결해요.</li>
          <li><b>③ 활용 어휘 ②</b> — 문장의 빈칸에 알맞은 활용 어휘를 넣어요.</li>
          <li><b>④ 확인하기</b> — 한글 어휘에 쓰인 오늘 한자의 뜻과 음을 써요.</li>
          <li><b>⑤ 추론하기</b> — 처음 보는 어휘 2개 가운데 오늘의 한자가 쓰인 어휘를 음훈으로 짐작해 골라요.</li>
          <li><b>⑥ 적용하기</b> — 배운 낱말을 넣어 짧은 글을 지어요.</li>
          <li><b>1일 후 복습</b> — 다음 학습일 아침에 바로 전 한자를 퀴즈로 떠올려요. (금요일 한자는 월요일에)</li>
          <li><b>일주일 복습</b> — 금요일마다 그 주의 한자 5자를 모두 다시 풀어요.</li>
          <li><b>틀린 한자</b> — 틀리면 '다시 볼 한자'로 모아 매일 복습에 최대 ${MAX_EXTRA_REVIEW}자씩 다시 나와요.</li>
          <li><b>🏆 급수 시험</b> — 틀린 한자를 다 배우면 급수 전체로 시험을 봐요. <b>100점</b>이면 다음 급수 레벨테스트로 올라가고, 아니면 틀린 한자를 다시 익히고 다시 도전해요. (완전 학습)</li>
        </ol>
      </div>

      <div class="card">
        <h2>수록 한자</h2>
        <p class="small">한국어문회 한자능력검정시험 배정 한자 기준으로 ${GRADES.map((g) => `${g.name} ${g.end - g.start}자`).join(', ')} —
          모두 <b>${HANJA.length}자</b>가 들어 있어요. 평일마다 한 자씩, 약 ${Math.round(HANJA.length / 5)}주 분량이에요.</p>
        <p class="small muted">준비 중: ${UPCOMING_GRADES.join(', ')}</p>
      </div>`;
    document.getElementById('switch').addEventListener('click', () => { logout(); location.hash = '#/'; route(); });
    document.getElementById('pwf').addEventListener('submit', (e) => {
      e.preventDefault();
      const fb = (t, ok) => { document.getElementById('pwfb').innerHTML = `<div class="feedback ${ok ? 'ok' : 'no'}">${t}</div>`; };
      const p0 = document.getElementById('pw0').value;
      const p1 = document.getElementById('pw1').value;
      if (!checkPassword(user, p0)) return fb('지금 비밀번호가 맞지 않아요.');
      if (p1.length < 4) return fb('새 비밀번호는 4글자 이상으로 만들어요.');
      setPassword(user, p1);
      document.getElementById('pw0').value = document.getElementById('pw1').value = '';
      fb('비밀번호를 바꿨어요.', true);
    });
    document.getElementById('reset').addEventListener('click', () => {
      if (confirm(`정말 ${user}의 모든 학습 기록을 지울까요? 되돌릴 수 없어요.`)) {
        S = blankState();
        save();
        session = null;
        listGrade = null;
        location.hash = '#/';
      }
    });
  }

  function curveSvg() {
    // 복습하지 않을 때(점선)와 1일·1주 뒤 복습할 때(실선)의 기억 비교 그림
    const W = 320, H = 150, x0 = 30, y0 = 12, w = 280, h = 110;
    const X = (d) => x0 + (d / 14) * w;
    const Y = (p) => y0 + (1 - p) * h;
    const decay = (t, s) => Math.exp(-t / s);
    let noRev = '';
    for (let d = 0; d <= 14; d += 0.25) noRev += `${d ? 'L' : 'M'}${X(d).toFixed(1)},${Y(0.25 + 0.75 * decay(d, 1.2)).toFixed(1)}`;
    const seg = (from, to, s) => {
      let p = '';
      for (let d = from; d <= to + 1e-9; d += 0.25) p += `${d === from ? 'M' : 'L'}${X(d).toFixed(1)},${Y(0.25 + 0.75 * decay(d - from, s)).toFixed(1)}`;
      return p;
    };
    const rev = seg(0, 1, 1.2) + seg(1, 4, 4) + seg(4, 14, 14);
    return `<svg class="curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="망각 곡선: 복습하면 기억이 오래 남아요">
      <line x1="${x0}" y1="${y0}" x2="${x0}" y2="${y0 + h}" stroke="currentColor" stroke-opacity=".3"/>
      <line x1="${x0}" y1="${y0 + h}" x2="${x0 + w}" y2="${y0 + h}" stroke="currentColor" stroke-opacity=".3"/>
      <path d="${noRev}" fill="none" stroke="var(--ink-soft)" stroke-width="2" stroke-dasharray="4 4"/>
      <path d="${rev}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>
      <text x="${X(1)}" y="${y0 + h + 14}" font-size="10" text-anchor="middle" fill="var(--accent)">1일 후</text>
      <text x="${X(4)}" y="${y0 + h + 14}" font-size="10" text-anchor="middle" fill="var(--accent)">금요일</text>
      <text x="${X(14)}" y="${y0 + h + 14}" font-size="10" text-anchor="end" fill="var(--ink-soft)">2주</text>
      <text x="${x0 - 4}" y="${y0 + 8}" font-size="10" text-anchor="end" fill="var(--ink-soft)">기억</text>
      <text x="${X(9)}" y="${Y(0.8)}" font-size="11" fill="var(--accent)">복습했을 때</text>
      <text x="${X(9)}" y="${Y(0.18)}" font-size="11" fill="var(--ink-soft)">복습 안 했을 때</text>
    </svg>`;
  }

  /* ================= 화면: 선생님 메뉴 ================= */
  // 선생님이 나중에 애매한 답을 인정하면 학생의 진도에 반영합니다.
  function acceptAnswer(st, q) {
    const g = GRADES.find((x) => x.id === q.grade);
    const cur = GRADES[Math.min(st.gradeIdx, GRADES.length - 1)];
    const ds = fmt(today());
    if (q.kind === 'level') {
      if (!st.learned[q.idx]) st.known[q.idx] = ds;
      st.queue = st.queue.filter((x) => x !== q.idx);
      if (st.levels[g.id]) st.levels[g.id].known++;
      // 공부할 한자가 하나도 남지 않으면(모두 아는 한자) 급수를 통과해요.
      if (cur === g && st.phase === 'study' && !st.queue.length) passGrade(g, st);
    }
    st.activity.push({ date: ds, type: 'accept', idx: q.idx, kind: q.kind });
    // 급수 시험: '틀린 한자 다시 보기'를 했든 안 했든, 인정으로 100점이 되면 다음 급수로
    if (q.kind === 'exam' && cur === g && ['relearn', 'exam'].includes(st.phase)) {
      const rec = st.exams[g.id];
      st.relearn = st.relearn.filter((x) => x !== q.idx);
      st.missed = st.missed.filter((x) => x !== q.idx);
      if (rec) {
        if (rec.wrong) rec.wrong = rec.wrong.filter((x) => x !== q.idx);
        const total = g.end - g.start;
        const scoreN = Math.round(((total - examWrongLeft(st, g)) / total) * 100);
        rec.last = scoreN;
        rec.best = Math.max(rec.best, scoreN);
      }
      if (!checkExamPass(st) && st.phase === 'relearn' && !st.relearn.length) st.phase = 'exam';
    }
  }
  let teacherOk = false;
  let teacherOpen = null;
  // 합격증: 새 창에 그려서 바로 인쇄 창을 열어요
  const CERT_KEY = 'everyday-hanja:cert';
  const certInfo = () => { try { return Object.assign({ school: '', teacher: '' }, JSON.parse(lsGet(CERT_KEY))); } catch (e) { return { school: '', teacher: '' }; } };
  function printCertificate(name, st, g) {
    const info = certInfo();
    const pd = st.passed[g.id];
    const d = parseDate(pd);
    const dateKo = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
    const sample = HANJA.slice(g.start, g.end).map((c) => c.h).join('');
    const w = window.open('', '_blank');
    if (!w) { alert('팝업이 막혀 있어요. 브라우저에서 이 사이트의 팝업을 허용해 주세요.'); return; }
    w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>합격증 - ${esc(name)} ${g.name}</title>
      <link href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@500;700;900&display=swap" rel="stylesheet">
      <style>
        @page { size: A4 portrait; margin: 0; }
        * { box-sizing: border-box; }
        body { margin: 0; font-family: 'Noto Serif KR', serif; color: #2b2118; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .page { width: 210mm; height: 297mm; padding: 14mm; margin: 0 auto; background: #fffdf6; }
        .frame { position: relative; height: 100%; border: 3mm double #b8862b; padding: 20mm 18mm; text-align: center; overflow: hidden; }
        .bg { position: absolute; inset: 30mm 10mm auto; font-size: 11mm; line-height: 1.6; color: rgba(184,134,43,.08); word-break: break-all; z-index: 0; }
        .in { position: relative; z-index: 1; height: 100%; display: flex; flex-direction: column; }
        .mark { width: 22mm; height: 22mm; margin: 0 auto 6mm; border-radius: 6mm; background: #e05a2b; color: #fff; font-size: 13mm; display: grid; place-items: center; }
        h1 { font-size: 22mm; letter-spacing: 8mm; margin: 0 0 4mm; font-weight: 900; }
        .sub { font-size: 5mm; color: #8a6a3a; margin-bottom: 18mm; }
        .row { font-size: 7mm; margin: 3mm 0; }
        .row b { font-size: 9mm; }
        .text { font-size: 6.2mm; line-height: 2; margin: 16mm 0 0; word-break: keep-all; }
        .info { font-size: 4.6mm; color: #6b5a44; margin-top: 10mm; }
        .foot { margin-top: auto; }
        .date { font-size: 6mm; margin-bottom: 10mm; }
        .sign { font-size: 7mm; font-weight: 700; }
        .seal { display: inline-grid; place-items: center; width: 16mm; height: 16mm; margin-left: 4mm; border: .8mm solid #d23; border-radius: 50%; color: #d23; font-size: 4mm; vertical-align: middle; transform: rotate(-10deg); }
        .noprint { text-align: center; padding: 8px; font-family: sans-serif; }
        @media print { .noprint { display: none; } .page { margin: 0; } }
      </style></head><body>
      <div class="noprint"><button onclick="print()">🖨 인쇄하기</button></div>
      <div class="page"><div class="frame"><div class="bg">${sample.repeat(3)}</div><div class="in">
        <div class="mark">漢</div>
        <h1>합격증</h1>
        <div class="sub">매일 한자 · 한자 급수 시험</div>
        <div class="row">이 름 &nbsp; <b>${esc(name)}</b></div>
        <div class="row">급 수 &nbsp; <b>${g.name}</b></div>
        <p class="text">위 학생은 꾸준히 한자를 익혀<br><b>${g.name}</b> 한자 ${g.end - g.start}자의 뜻과 음을 모두 알고<br>급수 시험에 합격하였으므로 이 증서를 드립니다.</p>
        <div class="info">총 학습 시간 ${fmtTime(totalSecs(st, pd))}</div>
        <div class="foot">
          <div class="date">${dateKo}</div>
          <div class="sign">${info.school ? `${esc(info.school)} ` : '매일 한자 '}${info.teacher ? `선생님 ${esc(info.teacher)}` : ''}<span class="seal">${info.teacher ? '인' : '漢'}</span></div>
        </div>
      </div></div></div>
      <script>document.fonts.ready.then(() => setTimeout(() => print(), 300));<\/script>
      </body></html>`);
    w.document.close();
  }
  const PHASE_NAME = { level: '레벨테스트', study: '공부 중', exam: '시험 볼 차례', relearn: '다시 보기', done: '모두 통과' };
  function renderTeacher() {
    setTab('settings');
    if (!user) document.body.classList.add('logged-out');
    const back = user ? '#/settings' : '#/';
    if (!teacherSet() || !teacherOk) {
      const first = !teacherSet();
      $app.innerHTML = `
        <div class="row" style="margin-bottom:10px"><a href="${back}" class="small">← 돌아가기</a></div>
        <div class="card">
          <h2>👩‍🏫 선생님 메뉴</h2>
          <p class="small muted">${first ? '처음 한 번 선생님 비밀번호를 정해요. 학생 비밀번호를 초기화하고 학생 기록을 볼 때 써요.' : '선생님 비밀번호를 넣어 주세요.'}</p>
          <form id="tf" autocomplete="off">
            <input id="t1" type="password" class="text-input" placeholder="${first ? '선생님 비밀번호 만들기 (4글자 이상)' : '선생님 비밀번호'}">
            ${first ? '<input id="t2" type="password" class="text-input" placeholder="한 번 더">' : ''}
            <div id="fb"></div>
            <button class="btn block" style="margin-top:12px">${first ? '만들기' : '들어가기'}</button>
          </form>
        </div>`;
      document.getElementById('tf').addEventListener('submit', (e) => {
        e.preventDefault();
        const fb = (t) => { document.getElementById('fb').innerHTML = `<div class="feedback no">${t}</div>`; };
        const p1 = document.getElementById('t1').value;
        if (first) {
          if (p1.length < 4) return fb('4글자 이상으로 만들어 주세요.');
          if (p1 !== document.getElementById('t2').value) return fb('두 비밀번호가 달라요.');
          setTeacher(p1);
        } else if (!checkTeacher(p1)) {
          return fb('비밀번호가 맞지 않아요.');
        }
        teacherOk = true;
        renderTeacher();
      });
      return;
    }
    const list = users();
    const rows = list.map((n) => {
      const st = n === user ? S : loadState(n);
      const g = GRADES[Math.min(st.gradeIdx, GRADES.length - 1)];
      const last = st.activity.length ? st.activity[st.activity.length - 1].date : null;
      const ex = st.exams[g.id];
      const left = st.phase === 'study' ? ` (${st.queue.filter((x) => !st.learned[x]).length}자 남음)` : '';
      const passedG = GRADES.filter((x) => st.passed[x.id]);
      const days = [];
      for (let d = today(), k = 0; k < 14; k++, d = addDays(d, -1)) if (isWeekday(d) || (st.time || {})[fmt(d)]) days.push(fmt(d));
      const detail = teacherOpen === n ? `<tr class="detail"><td colspan="8">
          <b>통과한 급수</b> ${passedG.length ? passedG.map((x) => `${x.name} <button class="btn soft small-btn" data-cert="${x.id}" data-st="${esc(n)}">🖨 합격증</button>`).join(' ') : '없음'}<br>
          <b>최근 2주 학습 시간</b> <span class="small muted">(모두 ${fmtTime(totalSecs(st))})</span>
          <div class="time-days">${days.slice().reverse().map((d) => `<span class="${(st.time || {})[d] ? '' : 'none'}"><small>${shortDate(d)}</small>${(st.time || {})[d] ? fmtTime(st.time[d]) : '-'}</span>`).join('')}</div>
          <b>선생님 확인을 기다리는 답</b>${(st.pending || []).length ? `<ul class="plain-list pend">${st.pending.map((q, k) => {
            const pc = C(q.idx);
            return `<li><span class="hanja">${pc.h}</span> ${hunum(pc)} — 학생 답 “<b>${esc(q.m)} ${esc(q.s)}</b>” <span class="small muted">(${GRADES.find((x) => x.id === q.grade).name} ${q.kind === 'level' ? '레벨테스트' : '급수 시험'}, ${shortDate(q.date)})</span>
              <span class="row" style="margin-top:4px"><button class="btn soft" data-acc="${k}" data-st="${esc(n)}">✔ 인정</button><button class="btn ghost" data-rej="${k}" data-st="${esc(n)}">인정 안 함</button></span></li>`;
          }).join('')}</ul>` : ' 없음<br>'}
          <b>최근 글짓기</b><ul class="plain-list">${st.writings.slice(-5).reverse().map((w) => `<li>${shortDate(w.date)} “${esc(w.text)}”</li>`).join('') || '<li>없음</li>'}</ul>
          <div class="row" style="margin-top:8px">
            <button class="btn soft" data-reset="${esc(n)}">비밀번호 초기화</button>
            <button class="btn ghost" data-del="${esc(n)}">학생 삭제</button>
          </div></td></tr>` : '';
      return `<tr><td><button class="linkbtn" data-open-st="${esc(n)}">${esc(n)}</button></td>
        <td>${st.phase === 'done' ? '완료' : g.name}<div class="small muted">${PHASE_NAME[st.phase] || ''}${left}</div>${(st.pending || []).length ? `<div class="pill">🤔 확인 ${st.pending.length}</div>` : ''}</td>
        <td>${Object.keys(st.known).length}</td><td>${st.order.length}</td>
        <td>${ex ? `${ex.last}점<div class="small muted">${ex.attempts}번</div>` : '-'}</td>
        <td>${todaySecs(st) ? fmtTime(todaySecs(st)) : '-'}</td><td>${fmtTime(totalSecs(st))}</td>
        <td>${last ? shortDate(last) : '-'}</td></tr>${detail}`;
    }).join('');
    $app.innerHTML = `
      <div class="row" style="margin-bottom:10px"><a href="${back}" class="small">← 돌아가기</a></div>
      <div class="card">
        <h2>👩‍🏫 선생님 메뉴</h2>
        <p class="small muted">공부한 학생 ${list.length}명 · 이름을 누르면 자세히 보고 비밀번호를 초기화할 수 있어요.</p>
        ${list.length ? `<div style="overflow-x:auto"><table class="class-table">
          <tr><th>이름</th><th>급수·단계</th><th>아는<br>한자</th><th>공부한<br>한자</th><th>급수<br>시험</th><th>오늘<br>시간</th><th>총<br>시간</th><th>최근</th></tr>${rows}</table></div>`
          : '<p class="muted">아직 학생이 없어요.</p>'}
      </div>
      <div class="card">
        <form class="setting" id="certf" autocomplete="off">
          <div class="txt"><b>합격증에 넣을 이름</b><div class="small muted">비워 두면 넣지 않아요. 이 기기에 저장돼요.</div>
            <input id="cschool" class="text-input" maxlength="30" placeholder="학교 이름 (예: 한빛초등학교)" value="${esc(certInfo().school)}">
            <input id="cteacher" class="text-input" maxlength="20" placeholder="선생님 이름" value="${esc(certInfo().teacher)}"><div id="cfb"></div></div>
          <button class="btn ghost">저장</button>
        </form>
      </div>
      <div class="card">
        <form class="setting" id="tpw" autocomplete="off">
          <div class="txt"><b>선생님 비밀번호 바꾸기</b><input id="tn" type="password" class="text-input" placeholder="새 비밀번호 (4글자 이상)"><div id="tfb"></div></div>
          <button class="btn ghost">바꾸기</button>
        </form>
        <button class="btn soft block" id="tout" style="margin-top:8px">선생님 메뉴 닫기</button>
      </div>`;
    $app.querySelectorAll('[data-open-st]').forEach((b) => b.addEventListener('click', () => {
      teacherOpen = teacherOpen === b.dataset.openSt ? null : b.dataset.openSt;
      renderTeacher();
    }));
    $app.querySelectorAll('[data-acc], [data-rej]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.st;
      const st = n === user ? S : loadState(n);
      const k = +(b.dataset.acc ?? b.dataset.rej);
      const q = st.pending[k];
      st.pending.splice(k, 1);
      if (b.dataset.acc !== undefined) acceptAnswer(st, q);
      lsSet(stateKey(n), JSON.stringify(st));
      renderTeacher();
    }));
    $app.querySelectorAll('[data-reset]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.reset;
      const pw = prompt(`${n}의 새 비밀번호를 입력하세요 (4글자 이상)`);
      if (pw === null) return;
      if (pw.length < 4) { alert('4글자 이상으로 입력해 주세요.'); return; }
      setPassword(n, pw);
      alert(`${n}의 비밀번호를 바꿨어요.`);
    }));
    $app.querySelectorAll('[data-cert]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.st;
      printCertificate(n, n === user ? S : loadState(n), GRADES.find((x) => x.id === b.dataset.cert));
    }));
    document.getElementById('certf').addEventListener('submit', (e) => {
      e.preventDefault();
      lsSet(CERT_KEY, JSON.stringify({ school: document.getElementById('cschool').value.trim(), teacher: document.getElementById('cteacher').value.trim() }));
      document.getElementById('cfb').innerHTML = '<div class="feedback ok">저장했어요.</div>';
    });
    $app.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
      const n = b.dataset.del;
      if (!confirm(`${n}의 모든 학습 기록을 지우고 학생을 삭제할까요? 되돌릴 수 없어요.`)) return;
      removeUser(n);
      if (n === user) logout();
      teacherOpen = null;
      renderTeacher();
    }));
    document.getElementById('tpw').addEventListener('submit', (e) => {
      e.preventDefault();
      const p = document.getElementById('tn').value;
      const ok = p.length >= 4;
      if (ok) setTeacher(p);
      document.getElementById('tfb').innerHTML = `<div class="feedback ${ok ? 'ok' : 'no'}">${ok ? '바꿨어요.' : '4글자 이상으로 입력해 주세요.'}</div>`;
    });
    document.getElementById('tout').addEventListener('click', () => { teacherOk = false; location.hash = back; });
  }

  /* ================= 라우터 ================= */
  function route() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    document.getElementById('today-label').textContent = koDate(today());
    const who = document.getElementById('who');
    who.textContent = user ? `👤 ${user}` : '';
    who.hidden = !user;
    document.getElementById('logout').hidden = !user;
    document.querySelectorAll('.modal-back').forEach((m) => m.remove());
    if (!['lesson', 'weekly', 'review', 'extra', 'relearn', 'oldreview'].includes(parts[0])) stopTimer();
    if (user && unsaved) { save(); unsaved = 0; }
    document.body.classList.remove('in-lesson', 'logged-out');
    window.scrollTo(0, 0);

    if (parts[0] === 'teacher') {
      renderTeacher();
      // 다른 기기에서 공부한 학생들의 기록도 받아 와요.
      cloud.pullAll().then((changed) => {
        if (changed && location.hash.replace(/^#\/?/, '').startsWith('teacher')) { restoreUser(); renderTeacher(); }
      });
      return;
    }
    if (!user) { stopTimer(); renderLogin(); return; }
    const entering = justEntered;
    justEntered = false;
    switch (parts[0]) {
      case 'lesson': startLesson('lesson'); break;
      case 'extra': startLesson('extra'); break;
      case 'relearn': startLesson('relearn'); break;
      case 'weekly': startLesson('weekly'); break;
      case 'review': startLesson('review'); break;
      case 'oldreview': startLesson('oldreview'); break;
      case 'level': startTest('level'); break;
      case 'test': startTest('exam'); break;
      case 'list': renderList(); break;
      case 'records': renderRecords(); break;
      case 'exam': renderExamHome(); break;
      case 'settings': renderSettings(); break;
      default: renderHome(entering);
    }
  }

  document.getElementById('who').addEventListener('click', () => { location.hash = '#/records'; });
  document.getElementById('logout').addEventListener('click', () => {
    if (!confirm('로그아웃할까요?')) return;
    stopTimer();
    cloud.flush();
    logout();
    goHash('#/');
  });
  window.addEventListener('hashchange', route);

  // 공부 중이 아닐 때 다시 화면으로 돌아오면, 다른 기기에서 공부한 기록을 받아 와요.
  const busyScreens = ['lesson', 'weekly', 'review', 'extra', 'relearn', 'oldreview', 'level', 'test'];
  function onScreen() { return location.hash.replace(/^#\/?/, '').split('/')[0]; }
  let lastRefresh = 0;
  async function refresh() {
    if (document.visibilityState !== 'visible' || busyScreens.includes(onScreen())) return;
    lastRefresh = Date.now();
    const was = user;
    const changed = onScreen() === 'teacher' ? await cloud.pullAll() : await cloud.pullOne(user);
    if (changed && !busyScreens.includes(onScreen())) {
      restoreUser();
      if (user !== was) session = null;
      route();
    }
  }
  document.addEventListener('visibilitychange', refresh);
  window.addEventListener('focus', () => { if (Date.now() - lastRefresh > 5000) refresh(); });
  // 켜 둔 채로 두는 교실 컴퓨터도 1분마다 새 기록을 확인해요.
  setInterval(() => { if (user) refresh(); }, 60000);

  // 다른 기기에서 먼저 바뀐 기록이 있어 이 기기의 저장을 멈추고 서버 기록을 받아 온 경우
  cloud.onConflict((name) => {
    if (name !== user) return;
    stopTimer();
    session = null;
    restoreUser();
    alert('다른 기기에서 공부한 기록이 있어서 그 기록으로 바꿨어요.');
    location.hash = '#/';
    route();
  });

  // 처음 열 때: 서버의 기록을 받아 온 뒤 화면을 그려요.
  (async () => {
    if (cloud.on) {
      $app.innerHTML = '<div class="card center"><p class="muted">기록을 불러오는 중…</p></div>';
      await cloud.pullAll();
    }
    restoreUser();
    route();
  })();
})();
