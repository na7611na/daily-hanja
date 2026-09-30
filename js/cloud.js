/*
 * 매일 한자 — 기록을 Firebase(Firestore)에 저장해 여러 기기에서 이어서 공부하기
 *
 * app.js는 지금처럼 localStorage에 읽고 쓰고, 이 파일이 그 내용을 Firestore와 맞춥니다.
 *   students/{이름}  { name, pw, state, t, deleted }   학생마다 한 문서
 *   meta/teacher      { pw, t }                         선생님 비밀번호
 * t는 마지막으로 고친 시각입니다. 기기와 서버 가운데 더 나중에 고친 쪽을 따릅니다.
 * 저장할 때는 '이 기기가 마지막으로 본 서버 기록(updateTime)'이 그대로일 때만 씁니다.
 * 그 사이 다른 기기에서 기록이 바뀌었으면 덮어쓰지 않고 서버 기록을 받아 옵니다.
 * (어제부터 켜 둔 기기의 옛 화면이 오늘 공부한 기록을 덮어쓰지 않게 하려는 것)
 * 인터넷이 안 되면 이 기기에 먼저 저장해 두고, 다음에 연결될 때 맞춥니다.
 * Firebase SDK 대신 Firestore REST API(fetch)를 씁니다. 파일이 가볍고, 학교망처럼
 * 오래 열어 두는 연결을 막는 곳에서도 잘 됩니다.
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
  const SEEN_PREFIX = 'everyday-hanja:u:'; // 이름 → 이 기기가 마지막으로 본 서버 기록의 updateTime
  const TEACHER_TIME = 'everyday-hanja:t-teacher';
  const TIMEOUT = 8000;

  const get = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const set = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* 무시 */ } };
  const del = (k) => { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } };
  const json = (k, d) => { try { return JSON.parse(get(k)) || d; } catch (e) { return d; } };
  const localT = (name) => +get(TIME_PREFIX + name) || 0;

  const BASE = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents`;
  const KEY = `key=${firebaseConfig.apiKey}`;
  const db = typeof fetch === 'function';
  // 문서 이름: '/'가 들어간 이름도 저장할 수 있게 한 번 인코딩하고, 주소에 넣으려고 한 번 더 인코딩해요.
  const docUrl = (path) => `${BASE}/${path}?${KEY}`;
  const studentPath = (name) => `students/${encodeURIComponent(encodeURIComponent(name))}`;

  // Firestore 값 ↔ 자바스크립트 값
  function toFields(o) {
    const f = {};
    Object.keys(o).forEach((k) => {
      const v = o[k];
      f[k] = typeof v === 'boolean' ? { booleanValue: v } : typeof v === 'number' ? { integerValue: String(Math.round(v)) } : { stringValue: String(v) };
    });
    return { fields: f };
  }
  function fromDoc(doc) {
    const o = {};
    const f = (doc && doc.fields) || {};
    Object.keys(f).forEach((k) => {
      const v = f[k];
      o[k] = 'booleanValue' in v ? v.booleanValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? +v.doubleValue : v.stringValue;
    });
    o.updateTime = doc && doc.updateTime;
    return o;
  }
  async function request(url, opts) {
    const ctl = new AbortController();
    const tm = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      const r = await fetch(url, Object.assign({ signal: ctl.signal }, opts));
      if (r.status === 404) return null;
      if (r.status === 409 || r.status === 400) {
        const body = await r.text();
        const err = new Error(`Firestore ${r.status}`);
        err.conflict = r.status === 409 || body.includes('FAILED_PRECONDITION');
        throw err;
      }
      if (!r.ok) throw new Error(`Firestore ${r.status}`);
      return await r.json();
    } finally { clearTimeout(tm); }
  }
  const getDoc = async (path) => { const d = await request(docUrl(path)); return d ? fromDoc(d) : null; };
  // keepalive: 창을 닫는 순간에도 저장이 끝까지 가도록
  const setDoc = (path, data, cond = '') => request(docUrl(path) + cond, {
    method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toFields(data)),
  });

  /* ---------- 서버 → 기기 ---------- */
  const seenSet = (name, u) => { if (u) set(SEEN_PREFIX + name, u); else del(SEEN_PREFIX + name); };
  function applyStudent(d) {
    const name = d.name;
    seenSet(name, d.updateTime);
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
    if (d && (d.t || 0) === lt) seenSet(name, d.updateTime); // 같은 기록
    if (!d) seenSet(name, null);
    if (hasLocal && (!d || lt > (d.t || 0))) pushStudent(name);
    return false;
  }

  async function pullAll() {
    if (!db) return false;
    let changed = false;
    const seen = new Set();
    let token = '';
    do {
      const page = await request(`${BASE}/students?${KEY}&pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      ((page && page.documents) || []).forEach((doc) => {
        const d = fromDoc(doc);
        if (!d.name) return;
        seen.add(d.name);
        if (syncStudent(d.name, d)) changed = true;
      });
      token = page && page.nextPageToken;
    } while (token);
    // 이 기기에만 있는 학생(예전 기록)은 서버로 올립니다.
    json(USERS_KEY, []).filter((n) => !seen.has(n)).forEach((n) => pushStudent(n));
    if (await syncTeacher()) changed = true;
    return changed;
  }

  async function pullOne(name) {
    if (!db || !name) return false;
    return syncStudent(name, await getDoc(studentPath(name)));
  }

  async function syncTeacher() {
    const d = await getDoc('meta/teacher');
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
  const writing = {}; // 이름 → 진행 중인 저장 (한 학생의 저장은 차례대로)
  const conflictListeners = [];
  function flush() {
    clearTimeout(timer);
    if (!db) return;
    waiting.forEach((name) => {
      writing[name] = (writing[name] || Promise.resolve()).then(() => writeStudent(name));
    });
    waiting.clear();
  }
  async function writeStudent(name) {
    const pw = json(PW_KEY, {})[name];
    const live = json(USERS_KEY, []).includes(name) && pw;
    const data = live
      ? { name, pw, state: get(STATE_PREFIX + name) || '', t: localT(name) || Date.now(), deleted: false }
      : { name, pw: '', state: '', t: localT(name) || Date.now(), deleted: true };
    const seen = get(SEEN_PREFIX + name);
    const cond = seen ? `&currentDocument.updateTime=${encodeURIComponent(seen)}` : '&currentDocument.exists=false';
    try {
      const r = await setDoc(studentPath(name), data, cond);
      if (r && r.updateTime) seenSet(name, r.updateTime);
    } catch (e) {
      if (!e.conflict) {
        // 인터넷이 잠깐 끊긴 것: 조금 뒤에 다시 저장해요.
        console.warn('저장하지 못했어요. 잠시 뒤 다시 저장해요.', name, e);
        waiting.add(name);
        clearTimeout(timer);
        timer = setTimeout(flush, 10000);
        return;
      }
      // 다른 기기에서 먼저 바뀐 기록: 서버 기록을 따라요.
      const d = await getDoc(studentPath(name)).catch(() => null);
      if (d) applyStudent(d);
      else seenSet(name, null);
      lastPw = json(PW_KEY, {});
      conflictListeners.forEach((f) => f(name));
    }
  }
  function pushTeacher() {
    if (!db) return;
    setDoc('meta/teacher', { pw: get(TEACHER_KEY) || '', t: +get(TEACHER_TIME) || Date.now() })
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
    onConflict: (f) => conflictListeners.push(f),
    changed,
    flush,
  };
})();
