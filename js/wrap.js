/*
 * 매일 한자 — 줄바꿈을 의미 덩어리로
 *
 * 한글은 띄어쓰기마다 줄이 바뀔 수 있어서 '짐작해 / 보세요', '할 수 / 있어요'처럼
 * 한 덩어리가 두 줄로 갈라지기도 해요. 화면이 그려질 때마다 글자를 살펴서
 * 함께 읽어야 하는 낱말들을 한 덩어리(줄바꿈 없음)로 묶어 줍니다.
 *   - 보조 용언: 해 보세요, 알려 줘요, 읽지 않고, 하고 싶어요, 써 두다 …
 *   - 의존 명사: 할 수, 읽을 때, 한 것, 갈 줄 …
 *   - 한 글자 낱말: 약 4분, 각 반, 몇 번 …
 *   - 따옴표 안: '가르칠 교'
 *   - 짧은 굵은 글씨·표시 글씨: <b>가르칠 교</b>
 */
(() => {
  'use strict';

  const AUX = /^(보|봐|봤|볼|봅|주|줘|줬|줍|드려|드리|드립|있|없|않|못|싶|버려|버리|버렸|놓|놔|두세|둬|되|돼|됐|될|된|됩)/;
  const AUX_END = /(아|어|여|해|워|와|게|지|고|러|려|야|서|쳐|져|겨|켜|혀|봐|줘|둬|놔|가|기|어야|아야)$/;
  const BOUND = /^(수|것|거|때|줄|데|만큼|뿐|적|중|번|개|명|자|살|권|장|시|분|초|일|달|년|해|쪽|곳|점)(?=[을를이가은는에도만의과와로으]|$|[.,!?…'’"”)]|요|예요|이에요|이다|입니다|이죠)/;
  const QUOTE_OPEN = /^['‘"“(「]/;
  const QUOTE_CLOSE = /['’"”)」]/;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'SVG', 'svg', 'CODE']);
  const done = new WeakSet();

  // 앞 낱말과 다음 낱말을 붙여야 하는지
  function glue(prev, next) {
    const p = prev.replace(/[.,!?…'’"”)]+$/, '');
    if (!p || !next) return false;
    if (/^[0-9]/.test(next) && /^(약|총|모두|겨우|단)$/.test(p)) return true;
    if (p.length === 1 && /[가-힣]/.test(p)) return true; // 약, 각, 몇, 한, 두, 첫 …
    if (BOUND.test(next) && /[가-힣]$/.test(p)) return true;
    if (AUX.test(next) && AUX_END.test(p)) return true;
    // 꾸며 주는 말 + 꾸밈 받는 말: 표시된 글자, 쓰인 한자, 배울 낱말
    const last = p.charCodeAt(p.length - 1) - 0xac00;
    if (p.length >= 2 && last >= 0 && last < 11172 && [4, 8].includes(last % 28) && !/[은는을를만]$/.test(p) && /^[가-힣]/.test(next) && !/[은는][.,!?]*$/.test(next)) return true;
    return false;
  }

  function chunk(text) {
    const parts = text.split(/( +)/);
    const words = [];
    for (let i = 0; i < parts.length; i += 2) words.push({ w: parts[i], sp: parts[i + 1] || '' });
    const groups = [];
    let cur = null;
    let inQuote = false;
    words.forEach((x, i) => {
      if (!x.w) { if (cur) cur.sp += x.sp; else groups.push({ text: '', sp: x.sp }); return; }
      const joinPrev = cur && (inQuote || (cur.n < 3 && (cur.text + x.w).length <= 14 && glue(words[i - 1].w, x.w)));
      if (joinPrev) {
        cur.text += cur.sp + x.w;
        cur.sp = x.sp;
        cur.n++;
      } else {
        cur = { text: x.w, sp: x.sp, n: 1 };
        groups.push(cur);
      }
      if (QUOTE_OPEN.test(x.w) && !QUOTE_CLOSE.test(x.w.slice(1))) inQuote = true;
      else if (inQuote && QUOTE_CLOSE.test(x.w)) inQuote = false;
    });
    return groups;
  }

  function processText(node) {
    const t = node.nodeValue;
    if (!t || t.indexOf(' ') < 0 || !/[가-힣]/.test(t)) return;
    const groups = chunk(t);
    if (!groups.some((g) => g.n > 1)) return;
    const frag = document.createDocumentFragment();
    groups.forEach((g) => {
      if (g.n > 1 && g.text.length <= 24) {
        const s = document.createElement('span');
        s.className = 'ck';
        s.textContent = g.text;
        done.add(s.firstChild);
        frag.appendChild(s);
      } else if (g.text) {
        const tn = document.createTextNode(g.text);
        done.add(tn);
        frag.appendChild(tn);
      }
      if (g.sp) { const sp = document.createTextNode(g.sp); done.add(sp); frag.appendChild(sp); }
    });
    node.parentNode.replaceChild(frag, node);
  }

  // 굵은 글씨 바로 앞뒤에 붙은 따옴표·조사도 함께 묶어요: '<b>틀림</b>'이라고 → 한 덩어리
  function glueSides(el) {
    if (!el.parentNode || el.parentNode.classList && el.parentNode.classList.contains('ck-wrap')) return;
    const prev = el.previousSibling;
    const next = el.nextSibling;
    const pm = prev && prev.nodeType === 3 ? prev.nodeValue.match(/[^\s]{1,3}$/) : null;
    const nm = next && next.nodeType === 3 ? next.nodeValue.match(/^[^\s]{1,8}/) : null;
    if (!pm && !nm) return;
    const wrap = document.createElement('span');
    wrap.className = 'ck ck-wrap';
    el.parentNode.insertBefore(wrap, el);
    if (pm) { const part = prev.splitText(prev.nodeValue.length - pm[0].length); done.add(part); wrap.appendChild(part); }
    wrap.appendChild(el);
    if (nm) { next.splitText(nm[0].length); done.add(next); wrap.appendChild(next); }
  }

  function walk(root) {
    if (!root || SKIP.has(root.nodeName) || (root.closest && root.closest('svg, textarea, input, .ck, .hanja, .big-hanja'))) return;
    // 짧은 굵은 글씨·표시 글씨는 한 덩어리로
    if (root.querySelectorAll) {
      root.querySelectorAll('b, strong, mark, em, .pos').forEach((el) => {
        if (el.textContent.length <= 12) { el.classList.add('ck'); glueSides(el); }
      });
      if (/^(B|STRONG|MARK|EM)$/.test(root.nodeName) && root.textContent.length <= 12) root.classList.add('ck');
    }
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (done.has(n) || !n.parentElement || n.parentElement.closest('script, style, textarea, svg, .ck') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const list = [];
    while (tw.nextNode()) list.push(tw.currentNode);
    list.forEach(processText);
  }

  const target = document.body;
  walk(target);
  new MutationObserver((muts) => {
    muts.forEach((m) => {
      if (m.type === 'characterData') { if (!done.has(m.target)) walk(m.target.parentElement); return; }
      m.addedNodes.forEach((n) => {
        if (n.nodeType === 3) { if (!done.has(n) && n.parentElement) walk(n.parentElement); }
        else if (n.nodeType === 1) walk(n);
      });
    });
  }).observe(target, { childList: true, subtree: true, characterData: true });

  window.__chunkText = chunk; // 시험용
})();
