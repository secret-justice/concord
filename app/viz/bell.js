/* =============================================================================
 * 同律 CONCORD · viz/bell.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   编钟双音（M6「编钟与琴 · 一钟两音」）。用极简 SVG 画一排编钟（钟体 / 枚 /
 *   篆 / 钮），每件钟可点选或键盘选择；钟体左右两半对应「正鼓音 / 侧鼓音」，
 *   用两个按钮切换正在发声的一侧，并显示两音频率与差值（音分 / Hz）。
 *   一钟双音是曾侯乙编钟的关键证据；本组件只渲染 app 传入的数据，不内置测音值。
 *
 * API：
 *   var inst = Viz.bell.init(el, opts);
 *     opts : { lang:'zh'|'en', reducedMotion:boolean,
 *              onSelect(id)            // 选中某件钟
 *              onTone(id,'front'|'side') // 切换发声部位
 *              selected:string, tone:'front'|'side' }  // 可选初始态
 *   inst.update(state)
 *   inst.highlight(i|null)    // 程序化选中第 i 件（不触发 onSelect）
 *   inst.resize() / inst.destroy() / inst.setLang(lang)
 *
 * state 契约：
 *   {
 *     bells: [{ id:string, name:string, bellfrontHz:number, bellsideHz:number, size:number }],
 *     selected: string,          // 选中钟的 id（匹配不到则取第一件）
 *     tone?: 'front'|'side'      // 可选：当前发声部位，默认 'front'
 *   }
 *
 * 依赖：无。纯原生 JS + SVG/HTML，file:// 直接可用。
 * 样式：--c-light / --c-bronze / --c-cyan / --c-red / --c-ink / --font-ui（均有 fallback）
 * 复跑：浏览器打开 viz/_demo.html；静态自检 py -X utf8 viz/check_viz.py。
 * ========================================================================== */
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : null;
  if (!W || !W.document) return;
  var doc = W.document;
  var Viz = W.Viz = W.Viz || {};
  if (Viz.bell) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'vz-bell-style';
  var LOG2 = Math.log(2);

  /* ---------- 工具 ---------- */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function fmt(v, d) {
    if (!isFinite(v)) return '—';
    var s = v.toFixed(d == null ? 2 : d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }
  function mk(tag, cls, attrs) {
    var e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k]; if (v == null) continue;
      if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    return e;
  }
  function mks(tag, attrs) {
    var e = doc.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k]; if (v == null) continue;
      e.setAttribute(k, v);
    }
    return e;
  }
  function clear(n) { while (n && n.firstChild) n.removeChild(n.firstChild); }
  function ensureStyle(id, css) {
    if (doc.getElementById(id)) return;
    var s = mk('style'); s.id = id;
    s.appendChild(doc.createTextNode(css));
    (doc.head || doc.documentElement).appendChild(s);
  }
  function motionAllowed(opts) {
    if (opts && typeof opts.reducedMotion === 'boolean') return !opts.reducedMotion;
    if (W.matchMedia) return !W.matchMedia('(prefers-reduced-motion: reduce)').matches;
    return true;
  }
  function pickLang(opts) {
    var l = opts && opts.lang;
    if (l !== 'en' && l !== 'zh') l = (doc.documentElement && doc.documentElement.lang === 'en') ? 'en' : 'zh';
    return l;
  }
  function tpl(s, map) { return s.replace(/\{(\w+)\}/g, function (_, k) { return map[k] == null ? '' : String(map[k]); }); }
  function safeStub() {
    return {
      version: '1.0.0', update: function () {}, highlight: function () {}, resize: function () {},
      destroy: function () {}, setLang: function () {}, getState: function () { return null; }
    };
  }
  function watchResize(el, cb) {
    var raf = 0;
    var run = function () {
      if (raf) return;
      raf = W.requestAnimationFrame ? W.requestAnimationFrame(function () { raf = 0; cb(); }) : (cb(), 0);
    };
    if (typeof W.ResizeObserver === 'function') {
      var ro = new W.ResizeObserver(run); ro.observe(el);
      return { disconnect: function () { if (raf && W.cancelAnimationFrame) W.cancelAnimationFrame(raf); raf = 0; ro.disconnect(); } };
    }
    W.addEventListener('resize', run);
    return {
      disconnect: function () {
        if (raf && W.cancelAnimationFrame) W.cancelAnimationFrame(raf);
        raf = 0; W.removeEventListener('resize', run);
      }
    };
  }

  /* ---------- 文案 ---------- */
  var DICT = {
    zh: {
      group: '编钟双音：一钟两音',
      bellGroup: '编钟（单选，←→ 切换）',
      front: '正鼓音',
      side: '侧鼓音',
      toneGroup: '选择发声部位',
      diff: '两音相差',
      hz: 'Hz',
      unitCents: '音分',
      selectFirst: '请选择一件编钟',
      empty: '暂无编钟数据',
      hint: '点按或用 ← → 选择编钟；「正鼓 / 侧鼓」切换同一钟的两个基音',
      sel: '已选 {name}：正鼓音 {front} Hz，侧鼓音 {side} Hz，相差 {cents} 音分',
      frontSr: '正鼓音 {hz} Hz，已发声',
      sideSr: '侧鼓音 {hz} Hz，已发声'
    },
    en: {
      group: 'Two-tone bells: one bell, two pitches',
      bellGroup: 'Bells (single select, arrow keys)',
      front: 'front-strike pitch',
      side: 'side-strike pitch',
      toneGroup: 'Choose struck spot',
      diff: 'difference',
      hz: 'Hz',
      unitCents: 'cents',
      selectFirst: 'Select a bell',
      empty: 'No bell data',
      hint: 'Click or use ← → to pick a bell; “front / side” toggles the two pitches of one bell',
      sel: '{name} selected: front {front} Hz, side {side} Hz, {cents} cents apart',
      frontSr: 'Front-strike pitch {hz} Hz, sounding',
      sideSr: 'Side-strike pitch {hz} Hz, sounding'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }

  /* 钟体几何：viewBox 100×150，左右两半沿中线分开，方便分别着色 */
  var BODY_OUTLINE = 'M50,26 L66,26 C70,52 76,74 74,92 C72,114 64,130 60,138 L40,138 C36,130 28,114 26,92 C24,74 30,52 34,26 Z';
  var BODY_FRONT = 'M50,26 L34,26 C30,52 24,74 26,92 C28,114 36,130 40,138 L50,138 Z';
  var BODY_SIDE = 'M50,26 L66,26 C70,52 76,74 74,92 C72,114 64,130 60,138 L50,138 Z';

  function bellSvg() {
    var svg = mks('svg', { viewBox: '0 0 100 150', 'aria-hidden': 'true', focusable: 'false', 'class': 'vz-bell-svg' });
    /* 钮 */
    svg.appendChild(mks('circle', { 'class': 'vz-bell-hook', cx: 50, cy: 9, r: 4.5 }));
    svg.appendChild(mks('path', { 'class': 'vz-bell-hook', d: 'M45,18 L55,18 L55,12 Q50,6 45,12 Z' }));
    /* 舞（顶板） */
    svg.appendChild(mks('path', { 'class': 'vz-bell-plate', d: 'M34,26 L66,26 L62,17 L38,17 Z' }));
    /* 钟体左右两半 */
    svg.appendChild(mks('path', { 'class': 'vz-bell-half front', d: BODY_FRONT }));
    svg.appendChild(mks('path', { 'class': 'vz-bell-half side', d: BODY_SIDE }));
    svg.appendChild(mks('path', { 'class': 'vz-bell-outline', d: BODY_OUTLINE }));
    /* 篆（两道横向条带） */
    svg.appendChild(mks('path', { 'class': 'vz-bell-band', d: 'M31,58 Q50,54 69,58' }));
    svg.appendChild(mks('path', { 'class': 'vz-bell-band', d: 'M29,69 Q50,65 71,69' }));
    /* 枚（钟体上的乳突） */
    var studs = [[39, 46], [39, 54], [39, 62], [61, 46], [61, 54], [61, 62], [43, 82], [57, 82]];
    for (var i = 0; i < studs.length; i++) {
      svg.appendChild(mks('circle', { 'class': 'vz-bell-stud', cx: studs[i][0], cy: studs[i][1], r: 2.1 }));
    }
    /* 中缝（一钟两音的分界） */
    svg.appendChild(mks('line', { 'class': 'vz-bell-seam', x1: 50, y1: 27, x2: 50, y2: 137 }));
    /* 钟口唇 */
    svg.appendChild(mks('path', { 'class': 'vz-bell-lip', d: 'M38,134 Q50,142 62,134' }));
    svg.appendChild(mks('path', { 'class': 'vz-bell-lip', d: 'M36,138 Q50,147 64,138' }));
    return svg;
  }

  var CSS = [
    '.vz-bell{position:relative;display:flex;flex-direction:column;gap:10px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-bell-row{position:relative;display:flex;align-items:flex-end;gap:14px;padding:26px 4px 2px;overflow-x:auto;',
    'overflow-y:hidden;flex:1 1 auto;min-height:118px;scrollbar-width:thin;}',
    '.vz-bell-row::before{content:"";position:absolute;left:0;right:0;top:14px;height:3px;border-radius:2px;',
    'background:rgba(200,163,90,.4);box-shadow:0 1px 0 rgba(0,0,0,.45);}',
    '.vz-bell-item{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;flex:0 0 auto;',
    'background:transparent;border:0;padding:0 2px 2px;cursor:pointer;color:inherit;border-radius:8px;',
    '-webkit-tap-highlight-color:transparent;transition:transform 120ms ease;}',
    '.vz-bell-item::before{content:"";position:absolute;top:-12px;left:50%;width:1px;height:14px;background:rgba(240,236,226,.28);}',
    '.vz-bell-item:hover{transform:translateY(-2px);}',
    '.vz-bell-item:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:3px;}',
    '.vz-bell-svg{display:block;overflow:visible;}',
    '.vz-bell-name{font-size:10.5px;opacity:.82;max-width:84px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
    '.vz-bell-item.is-selected .vz-bell-name{opacity:1;color:var(--c-bronze,#C8A35A);font-weight:700;}',
    '.vz-bell-hook{fill:none;stroke:var(--c-bronze,#C8A35A);stroke-width:2.4;stroke-linecap:round;}',
    '.vz-bell-plate{fill:rgba(240,236,226,.1);stroke:rgba(240,236,226,.3);stroke-width:1.4;}',
    '.vz-bell-half{stroke:none;transition:fill 160ms linear, opacity 160ms linear;}',
    '.vz-bell-half.front{fill:rgba(110,143,163,.14);}',
    '.vz-bell-half.side{fill:rgba(110,143,163,.14);}',
    '.vz-bell-outline{fill:none;stroke:rgba(240,236,226,.42);stroke-width:1.6;stroke-linejoin:round;}',
    '.vz-bell-item.is-selected .vz-bell-outline{stroke:var(--c-bronze,#C8A35A);stroke-width:2;}',
    '.vz-bell-item.is-selected .vz-bell-half{fill:rgba(200,163,90,.16);}',
    '.vz-bell-band{fill:none;stroke:rgba(240,236,226,.3);stroke-width:1;}',
    '.vz-bell-item.is-selected .vz-bell-band{stroke:rgba(240,236,226,.5);}',
    '.vz-bell-stud{fill:rgba(240,236,226,.34);}',
    '.vz-bell-item.is-selected .vz-bell-stud{fill:rgba(200,163,90,.75);}',
    '.vz-bell-seam{stroke:rgba(240,236,226,.3);stroke-width:1;stroke-dasharray:2 3;}',
    '.vz-bell-lip{fill:none;stroke:rgba(240,236,226,.45);stroke-width:2;stroke-linecap:round;}',
    '.vz-bell.is-tone-front .vz-bell-item.is-selected .vz-bell-half.front{fill:rgba(200,163,90,.5);}',
    '.vz-bell.is-tone-side .vz-bell-item.is-selected .vz-bell-half.side{fill:rgba(110,163,180,.55);}',
    '.vz-bell.is-tone-front .vz-bell-item.is-selected .vz-bell-half.side{fill:rgba(110,143,163,.08);opacity:.6;}',
    '.vz-bell.is-tone-side .vz-bell-item.is-selected .vz-bell-half.front{fill:rgba(200,163,90,.08);opacity:.6;}',
    '.vz-bell.is-tone-front .vz-bell-item.is-selected .vz-bell-half.front,.vz-bell.is-tone-side .vz-bell-item.is-selected .vz-bell-half.side{',
    'animation:vz-bell-glow 1.6s ease-in-out infinite;}',
    '@keyframes vz-bell-glow{0%,100%{opacity:1;}50%{opacity:.55;}}',
    '.vz-bell-rm .vz-bell-item.is-selected .vz-bell-half{animation:none !important;}',
    '.vz-bell-rm .vz-bell-item{transition:none;}',
    '@media (prefers-reduced-motion: reduce){',
    '.vz-bell-item{transition:none;}',
    '.vz-bell-item.is-selected .vz-bell-half{animation:none !important;}}',
    '.vz-bell-panel{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:center;border-top:1px solid rgba(240,236,226,.12);padding-top:6px;}',
    '.vz-bell-tones{display:inline-flex;gap:0;border:1px solid rgba(240,236,226,.24);border-radius:7px;overflow:hidden;}',
    '.vz-bell-tone{font:inherit;font-size:12px;color:var(--c-light,#F0ECE2);background:transparent;border:0;',
    'padding:5px 12px;cursor:pointer;line-height:1.5;}',
    '.vz-bell-tone+.vz-bell-tone{border-left:1px solid rgba(240,236,226,.24);}',
    '.vz-bell-tone[aria-pressed="true"]{background:rgba(200,163,90,.28);color:#fff;}',
    '.vz-bell-tone[aria-pressed="true"][data-tone="side"]{background:rgba(110,163,180,.34);}',
    '.vz-bell-tone:hover{background:rgba(240,236,226,.08);}',
    '.vz-bell-tone:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:-2px;}',
    '.vz-bell-nums{display:flex;flex-wrap:wrap;gap:6px 16px;align-items:baseline;}',
    '.vz-bell-num{display:inline-flex;align-items:baseline;gap:5px;}',
    '.vz-bell-num .k{font-size:11px;opacity:.62;}',
    '.vz-bell-num .v{font-size:13px;color:var(--c-cyan,#6E8FA3);font-variant-numeric:tabular-nums;}',
    '.vz-bell-num.is-front .v{color:var(--c-bronze,#C8A35A);}',
    '.vz-bell-diff .v{color:var(--c-light,#F0ECE2);font-weight:600;}',
    '.vz-bell-hint{margin:0;font-size:10.5px;opacity:.68;line-height:1.45;}',
    '.vz-bell-empty{font-size:12px;opacity:.6;padding:18px 4px;}',
    '.vz-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;}'
  ].join('');

  /* 宿主容器的可访问语义接管：外部常把挂载位写成 role="img"（静态图语义），
     但组件内部有可聚焦控件，axe 会报 nested-interactive（role=img 不允许可聚焦后代）。
     组件是交互控件，这里把宿主 role 换成 group（保留外部 aria-label 作为组名）。
     注：index.html 若把 .viz-slot 的 role="img" 去掉会更干净，本函数只是组件的自保。 */
  function adoptHost(el) {
    if (!el || !el.getAttribute) return;
    var role = (el.getAttribute('role') || '').toLowerCase();
    /* img/figure 等静态图语义不允许包含可聚焦控件（axe nested-interactive）；
       button/link/application 会把整块变成一个可聚焦大控件，同样不符合本组件
       「一组独立控件」的模型。统一退回中性分组语义，保留宿主的 aria-label 作组名。 */
    if (role === 'img' || role === 'figure' || role === 'button' || role === 'link' || role === 'application') {
      el.setAttribute('role', 'group');
    }
    if (el.hasAttribute('tabindex')) el.removeAttribute('tabindex');
  }

  function init(container, opts) {
    if (!container || !container.nodeType) return safeStub();
    adoptHost(container);
    if (container.__vizBell) { try { container.__vizBell.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);
    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);
    var onSelect = (typeof opts.onSelect === 'function') ? opts.onSelect : null;
    var onTone = (typeof opts.onTone === 'function') ? opts.onTone : null;

    var state = { bells: [], selected: null, tone: (opts.tone === 'side') ? 'side' : 'front' };
    var itemEls = [], destroyed = false, live = null, ro = null;
    var row = null, emptyEl = null, panel = null, toneBtns = [], numFront = null, numSide = null, numDiff = null, hintEl = null;

    clear(container);
    var root = mk('div', 'vz-bell' + (reduced ? ' vz-bell-rm' : ''));
    root.setAttribute('role', 'group');
    row = mk('div', 'vz-bell-row');
    row.setAttribute('role', 'radiogroup');
    emptyEl = mk('div', 'vz-bell-empty');
    root.appendChild(row);
    root.appendChild(emptyEl);

    /* 读数面板 */
    panel = mk('div', 'vz-bell-panel');
    var toneBox = mk('div', 'vz-bell-tones');
    toneBox.setAttribute('role', 'group');
    var dd0 = dict(lang);
    toneBox.setAttribute('aria-label', dd0.toneGroup);
    function makeTone(tone, label) {
      var b = mk('button', 'vz-bell-tone', { text: label });
      b.type = 'button';
      b.setAttribute('data-tone', tone);
      b.setAttribute('aria-pressed', state.tone === tone ? 'true' : 'false');
      b.addEventListener('click', function () {
        if (destroyed || !bells().length) return;
        state.tone = tone;
        applyTone();
        var cur = currentBell();
        if (cur && onTone) { try { onTone(cur.id, tone); } catch (e) {} }
        announceTone();
      });
      return b;
    }
    var dd = dict(lang);
    toneBtns.push(makeTone('front', dd.front));
    toneBtns.push(makeTone('side', dd.side));
    toneBox.appendChild(toneBtns[0]); toneBox.appendChild(toneBtns[1]);
    var nums = mk('div', 'vz-bell-nums');
    var numKeyEls = [];   /* 读数区三个标签（正鼓/侧鼓/相差），切语言时同步 */
    function numBox(cls, k) {
      var wrap = mk('div', 'vz-bell-num ' + cls);
      var kk = mk('span', 'k', { text: k });
      var vv = mk('span', 'v');
      wrap.appendChild(kk); wrap.appendChild(vv);
      nums.appendChild(wrap);
      numKeyEls.push(kk);
      return vv;
    }
    numFront = numBox('is-front', dd.front);
    numSide = numBox('', dd.side);
    numDiff = numBox('vz-bell-diff', dd.diff);
    panel.appendChild(toneBox); panel.appendChild(nums);
    hintEl = mk('p', 'vz-bell-hint');
    root.appendChild(panel);
    root.appendChild(hintEl);
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }
    function bells() { return state.bells; }
    function currentBell() {
      for (var i = 0; i < state.bells.length; i++) if (state.bells[i].id === state.selected) return state.bells[i];
      return state.bells.length ? state.bells[0] : null;
    }
    function selIndex() {
      for (var i = 0; i < state.bells.length; i++) if (state.bells[i].id === state.selected) return i;
      return -1;
    }
    function announce(msg) { if (live) live.textContent = msg; }
    function announceSel() {
      var dd = D();
      var b = currentBell();
      if (!b) { announce(dd.empty); return; }
      var f = num(b.bellfrontHz, NaN), s = num(b.bellsideHz, NaN);
      var cents = (isFinite(f) && isFinite(s) && f > 0 && s > 0) ? 1200 * Math.log(s / f) / LOG2 : NaN;
      announce(tpl(dd.sel, {
        name: b.name || b.id,
        front: isFinite(f) ? fmt(f, 2) : '—',
        side: isFinite(s) ? fmt(s, 2) : '—',
        cents: isFinite(cents) ? ((cents >= 0 ? '+' : '') + fmt(cents, 1)) : '—'
      }));
    }
    function announceTone() {
      var dd = D();
      var b = currentBell();
      if (!b) return;
      var hz = state.tone === 'front' ? num(b.bellfrontHz, NaN) : num(b.bellsideHz, NaN);
      announce(tpl(state.tone === 'front' ? dd.frontSr : dd.sideSr, { hz: isFinite(hz) ? fmt(hz, 2) : '—' }));
    }

    function applyTone() {
      if (!root) return;
      var dd = D();
      root.classList.toggle('is-tone-front', state.tone === 'front');
      root.classList.toggle('is-tone-side', state.tone === 'side');
      for (var i = 0; i < toneBtns.length; i++) {
        toneBtns[i].setAttribute('aria-pressed', toneBtns[i].getAttribute('data-tone') === state.tone ? 'true' : 'false');
      }
      var b = currentBell();
      renderNums(b);
      if (hintEl) hintEl.textContent = dd.hint;
    }

    function renderNums(b) {
      var dd = D();
      var f = b ? num(b.bellfrontHz, NaN) : NaN;
      var s = b ? num(b.bellsideHz, NaN) : NaN;
      numFront.textContent = isFinite(f) ? (fmt(f, 2) + ' ' + dd.hz) : '—';
      numSide.textContent = isFinite(s) ? (fmt(s, 2) + ' ' + dd.hz) : '—';
      var cents = (isFinite(f) && isFinite(s) && f > 0 && s > 0) ? 1200 * Math.log(s / f) / LOG2 : NaN;
      var dhz = (isFinite(f) && isFinite(s)) ? Math.abs(s - f) : NaN;
      numDiff.textContent = isFinite(cents)
        ? ((cents >= 0 ? '+' : '') + fmt(cents, 1) + ' ' + dd.unitCents + ' · ' + fmt(dhz, 2) + ' ' + dd.hz)
        : '—';
    }

    /* 选择（不改数据，只改态） */
    function selectIndex(i, fire) {
      if (destroyed || i < 0 || i >= state.bells.length) return;
      var nextId = state.bells[i].id;
      var changed = nextId !== state.selected;
      state.selected = nextId;
      for (var k = 0; k < itemEls.length; k++) {
        var sel = k === i;
        itemEls[k].classList.toggle('is-selected', sel);
        itemEls[k].setAttribute('aria-checked', sel ? 'true' : 'false');
        itemEls[k].tabIndex = sel ? 0 : -1;
      }
      applyTone();
      if (changed) announceSel();
      if (changed && fire && onSelect) { try { onSelect(nextId); } catch (e) {} }
    }

    function onItemKey(ev) {
      if (destroyed || !ev) return;
      var n = state.bells.length;
      if (!n) return;
      var i = itemEls.indexOf(ev.currentTarget);
      if (i < 0) i = selIndex();
      var nxt = -1;
      var cols = 1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nxt = (i + cols) % n;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nxt = (i - 1 + n) % n;
      else if (ev.key === 'Home') nxt = 0;
      else if (ev.key === 'End') nxt = n - 1;
      else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        if (ev.preventDefault) ev.preventDefault();
        selectIndex(i, true);
        return;
      }
      if (nxt >= 0) {
        if (ev.preventDefault) ev.preventDefault();
        selectIndex(nxt, true);
        if (itemEls[nxt]) itemEls[nxt].focus();
      }
    }

    function render() {
      if (destroyed) return;
      var dd = D();
      root.setAttribute('aria-label', dd.group);
      row.setAttribute('aria-label', dd.bellGroup);
      clear(row);
      itemEls = [];
      var list = state.bells;
      if (!list.length) {
        row.style.display = 'none';
        emptyEl.style.display = '';
        emptyEl.textContent = dd.empty;
        panel.style.display = 'none';
        hintEl.textContent = dd.hint;
        return;
      }
      row.style.display = '';
      emptyEl.style.display = 'none';
      panel.style.display = '';
      /* 尺寸归一：size 越大钟越大 */
      var maxSize = 0;
      for (var i = 0; i < list.length; i++) maxSize = Math.max(maxSize, num(list[i].size, 1));
      if (!(maxSize > 0)) maxSize = 1;
      var idx = selIndex();
      if (idx < 0) { state.selected = list[0].id; idx = 0; }
      for (var k = 0; k < list.length; k++) {
        var b = list[k];
        var sizeNorm = clamp(num(b.size, 1) / maxSize, 0.55, 1.35);
        var w = Math.round(42 + 22 * sizeNorm);
        var h = Math.round(w * 1.48);
        var btn = mk('button', 'vz-bell-item');
        btn.type = 'button';
        btn.setAttribute('role', 'radio');
        btn.setAttribute('aria-checked', k === idx ? 'true' : 'false');
        btn.tabIndex = (k === idx) ? 0 : -1;
        var f = num(b.bellfrontHz, NaN), s = num(b.bellsideHz, NaN);
        var cents = (isFinite(f) && isFinite(s) && f > 0 && s > 0) ? 1200 * Math.log(s / f) / LOG2 : NaN;
        btn.setAttribute('aria-label', (b.name != null ? String(b.name) : String(b.id)) + '，' + dd.front + ' ' +
          (isFinite(f) ? fmt(f, 2) : '—') + ' ' + dd.hz + '，' + dd.side + ' ' +
          (isFinite(s) ? fmt(s, 2) : '—') + ' ' + dd.hz +
          (isFinite(cents) ? ('，' + dd.diff + ' ' + (cents >= 0 ? '+' : '') + fmt(cents, 1) + ' ' + dd.unitCents) : ''));
        btn.setAttribute('data-id', String(b.id));
        var svg = bellSvg();
        svg.setAttribute('width', String(w));
        svg.setAttribute('height', String(h));
        btn.appendChild(svg);
        var nm = mk('span', 'vz-bell-name', { text: (b.name != null ? String(b.name) : String(b.id)) });
        btn.appendChild(nm);
        btn.addEventListener('click', (function (j) {
          return function () { selectIndex(j, true); };
        })(k));
        btn.addEventListener('keydown', onItemKey);
        if (k === idx) btn.classList.add('is-selected');
        row.appendChild(btn);
        itemEls.push(btn);
      }
      applyTone();
      hintEl.textContent = dd.hint;
    }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var arr = Array.isArray(next.bells) ? next.bells : [];
      state.bells = arr.filter(function (b) { return b && typeof b === 'object'; })
        .map(function (b, i) {
          return {
            id: (b.id != null) ? b.id : ('bell-' + i),
            name: (b.name != null) ? String(b.name) : ('#' + (i + 1)),
            bellfrontHz: num(b.bellfrontHz, NaN),
            bellsideHz: num(b.bellsideHz, NaN),
            size: num(b.size, 1)
          };
        }).slice(0, 128);
      var want = next.selected;
      var found = -1;
      for (var i = 0; i < state.bells.length; i++) if (state.bells[i].id === want) found = i;
      if (found >= 0) state.selected = want;
      else if (!state.bells.length) state.selected = null;
      else if (selIndex() < 0) state.selected = state.bells[0].id;
      if (next.tone === 'front' || next.tone === 'side') state.tone = next.tone;
      render();
    }

    function highlight(i) {
      if (destroyed) return;
      if (i == null || !isFinite(+i)) return;
      var k = Math.round(+i);
      selectIndex(k, false);
    }

    function destroy() {
      destroyed = true;
      if (ro) { ro.disconnect(); ro = null; }
      container.__vizBell = null;
      clear(container);
      itemEls = []; toneBtns = [];
    }

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: function () { /* 布局为纯 CSS 自适应，无需重算 */ },
      destroy: destroy,
      setLang: function (l) {
        lang = (l === 'en') ? 'en' : 'zh';
        var dd2 = dict(lang);
        toneBtns[0].textContent = dd2.front;
        toneBtns[1].textContent = dd2.side;
        toneBtns[0].parentNode.setAttribute('aria-label', dd2.toneGroup);
        if (numKeyEls[0]) numKeyEls[0].textContent = dd2.front;
        if (numKeyEls[1]) numKeyEls[1].textContent = dd2.side;
        if (numKeyEls[2]) numKeyEls[2].textContent = dd2.diff;
        var b = currentBell();
        if (b) renderNums(b);
        render();
      },
      getState: function () { return { bells: state.bells.slice(), selected: state.selected, tone: state.tone }; }
    };
    container.__vizBell = inst;
    var ddRoot = dict(lang);
    root.setAttribute('aria-label', ddRoot.group);
    emptyEl.textContent = ddRoot.empty;
    hintEl.textContent = ddRoot.hint;
    /* 首次无数据时也给出可聚焦的占位？—— 不造无意义 tab 停靠点，直接空态提示 */
    render();
    return inst;
  }

  Viz.bell = { version: '1.0.0', init: init };
})();
