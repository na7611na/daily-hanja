/*
 * 매일 한자 — 기록을 Firebase(Firestore)에 저장해 여러 기기에서 이어서 공부하기
 *
 * app.js는 지금처럼 localStorage에 읽고 쓰고, 이 파일이 그 내용을 Firestore와 맞춥니다.
 *   students/{이름}  { name, pw, state, t, deleted }   학생마다 한 문서
 *   meta/teacher      { pw, t }                         선생님 비밀번호
 * t는 마지막으로 고친 시각입니다. 기기와 서버 가운데 더 나중에 고친 쪽을 따릅니다.
 * 인터넷이 안 되거나 Firebase를 불러오지 못하면 이 기기에만 저장합니다.
 */
(() => {
  'use strict';

  const firebaseConfig = {
    apiKey: 'AIzaSyBqqfCLv0RSdUt37tX4XPq_mIzJ0KNlQKE',
    authDomain: 'daily-hanj.firebaseapp.com',
    projectId: 'daily-hanj',
    storageBucket: 'daily-hanj.firebasestorage.app',
    messagingSenderId: '53634582492',
    appId: '1:53634582492:web:b21ec45cf8cfeaf912f119',
  };

  const USERS_KEY = 'everyday-hanja:users';
  const PW_KEY = 'everyday-hanja:pw';
  const TEACHER_KEY = 'everyday-hanja:teacher';
  const STATE_PREFIX = 'everyday-hanja:v2:';
  const TIME_PREFIX = 'everyday-hanja:t:'; // 이름 → 이 기기에서 마지막으로 고친 시각
  const TEACHER_TIME = 'everyday-hanja:t-teacher';
  const TIMEOUT = 6000;

  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } };
  const del = (k) => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } };
  const json = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const localT = (name) => +get(TIME_PREFIX + name) || 0;
  const withTimeout = (p) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), TIMEOUT))]);

  let db = null;
  try {
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
  } catch (e) {
    console.warn('Firebase를 쓸 수 없어 이 기기에만 저장합니다.', e);
  }
  const students = () => db.collection('students');
  const docId = (name) => encodeURIComponent(name); // '/'가 들어간 이름도 저장할 수 있게

  /* ---------- 서버 → 기기 ---------- */
  function applyStudent(d) {
    const name = d.name;
    const list = json(USERS_KEY, []);
    const pws = json(PW_KEY, {});
    if (d.deleted) {
      if (!list.includes(name) && !(name in pws)) return false;
      set(USERS_KEY, JSON.stringify(list.filter((n) => n !== name)));
      delete pws[name];
      set(PW_KEY, JSON.stringify(pws));
      del(STATE_PREFIX + name);
      set(TIME_PREFIX + name, String(d.t || 0));
      return true;
    }
    if (!list.includes(name)) { list.push(name); set(USERS_KEY, JSON.stringify(list)); }
    if (d.pw) pws[name] = d.pw; else delete pws[name];
    set(PW_KEY, JSON.stringify(pws));
    if (d.state) set(STATE_PREFIX + name, d.state); else del(STATE_PREFIX + name);
    set(TIME_PREFIX + name, String(d.t || 0));
    return true;
  }
  // 한 학생: 서버가 더 새것이면 받아 오고, 기기가 더 새것이면 올립니다. 바뀌었으면 true
  function syncStudent(name, d) {
    const lt = localT(name);
    const hasLocal = json(USERS_KEY, []).includes(name);
    if (d && (d.t || 0) > lt) return applyStudent(d);
    if (hasLocal && (!d || lt > (d.t || 0))) pushStudent(name);
    return false;
  }

  async function pullAll() {
    if (!db) return false;
    let changed = false;
    const snap = await withTimeout(students().get());
    const seen = new Set();
    snap.forEach((doc) => {
      const d = doc.data();
      if (!d || !d.name) return;
      seen.add(d.name);
      if (syncStudent(d.name, d)) changed = true;
    });
    // 이 기기에만 있는 학생(예전 기록)은 서버로 올립니다.
    json(USERS_KEY, []).filter((n) => !seen.has(n)).forEach((n) => pushStudent(n));
    if (await syncTeacher()) changed = true;
    return changed;
  }

  async function pullOne(name) {
    if (!db || !name) return false;
    const doc = await withTimeout(students().doc(docId(name)).get());
    return syncStudent(name, doc.exists ? doc.data() : null);
  }

  async function syncTeacher() {
    const ref = db.collection('meta').doc('teacher');
    const doc = await withTimeout(ref.get());
    const d = doc.exists ? doc.data() : null;
    const lt = +get(TEACHER_TIME) || 0;
    if (d && (d.t || 0) > lt) {
      if (d.pw) set(TEACHER_KEY, d.pw); else del(TEACHER_KEY);
      set(TEACHER_TIME, String(d.t || 0));
      return true;
    }
    if (get(TEACHER_KEY) && (!d || lt > (d.t || 0))) pushTeacher();
    return false;
  }

  /* ---------- 기기 → 서버 ---------- */
  const waiting = new Set();
  let timer = null;
  function pushStudent(name) {
    if (!db) return;
    waiting.add(name);
    clearTimeout(timer);
    timer = setTimeout(flush, 800);
  }
  function flush() {
    clearTimeout(timer);
    if (!db) return;
    waiting.forEach((name) => {
      const pw = json(PW_KEY, {})[name];
      const live = json(USERS_KEY, []).includes(name) && pw;
      const data = live
        ? { name, pw, state: get(STATE_PREFIX + name) || '', t: localT(name) || Date.now(), deleted: false }
        : { name, pw: '', state: '', t: localT(name) || Date.now(), deleted: true };
      students().doc(docId(name)).set(data).catch((e) => console.warn('저장하지 못했어요', name, e));
    });
    waiting.clear();
  }
  function pushTeacher() {
    if (!db) return;
    db.collection('meta').doc('teacher')
      .set({ pw: get(TEACHER_KEY) || '', t: +get(TEACHER_TIME) || Date.now() })
      .catch((e) => console.warn('선생님 비밀번호를 저장하지 못했어요', e));
  }

  // app.js가 localStorage를 고칠 때마다 알려 줍니다.
  let lastPw = json(PW_KEY, {});
  function changed(key) {
    const now = String(Date.now());
    if (key.startsWith(STATE_PREFIX)) {
      const name = key.slice(STATE_PREFIX.length);
      set(TIME_PREFIX + name, now);
      pushStudent(name);
    } else if (key === PW_KEY) {
      const pws = json(PW_KEY, {});
      new Set([...Object.keys(pws), ...Object.keys(lastPw)]).forEach((name) => {
        if (pws[name] !== lastPw[name]) { set(TIME_PREFIX + name, now); pushStudent(name); }
      });
      lastPw = pws;
    } else if (key === TEACHER_KEY) {
      set(TEACHER_TIME, now);
      pushTeacher();
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });
  window.addEventListener('pagehide', flush);

  const safe = (f) => (...a) => f(...a).then((r) => { lastPw = json(PW_KEY, {}); return r; })
    .catch((e) => { console.warn('서버와 맞추지 못했어요', e); return false; });

  window.Cloud = {
    on: !!db,
    pullAll: safe(pullAll),
    pullOne: safe(pullOne),
    changed,
    flush,
  };
})();
