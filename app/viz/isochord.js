/* =============================================================================
 * 同律 CONCORD · viz/isochord.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   律与器（M7「律与器 · 妥协的艺术」）。三种模式共用一套 API：
 *     - fret  ：吉他指板品丝。按 state.cents[] 的音分位置画品丝，并给出
 *               距弦枕距离 d = L × (1 − 2^(−cents/1200))（mm），同时显示与
 *               12 等分参考位置的偏差。L 为 app 传入的弦长 scale length。
 *     - piano ：钢琴调律偏差。每个键画一根相对 0 参考线的偏移条（cents 为
 *               相对 12 平均律的偏差，正 = 偏高）。
 *     - voice ：人声 / 无品弦乐器的自由调音示意。cents 为各时刻相对目标的偏差，
 *               画成漂移曲线（不做「等分格」锁定）。
 *   组件只渲染 app 传入的数据；12 等分仅作可视化参考线，不是律制结论。
 *
 * API：
 *   var inst = Viz.isochord.init(el, opts);
 *     opts : { lang:'zh'|'en', reducedMotion:boolean, onSelect(index) }
 *   inst.update(state)
 *   inst.highlight(i|null)     // 高亮第 i 个品/键/采样点
 *   inst.resize() / inst.destroy() / inst.setLang(lang)
 *
 * state 契约：
 *   { mode:'fret'|'piano'|'voice', L:number, cents:number[] }
 *
 * 依赖：无。纯原生 JS + SVG/DOM，file:// 直接可用。
 * 样式：--c-light / --c-bronze / --c-cyan / --c-red / --c-ink / --font-ui（均有 fallback）
 * 复跑：浏览器打开 viz/_demo.html；静态自检 py -X utf8 viz/check_viz.py。
 * ========================================================================== */
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : null;
  if (!W || !W.document) return;
  var doc = W.document;
  var Viz = W.Viz = window.Viz || {};
  if (Viz.isochord) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'vz-isochord-style';
  var LOG2 = Math.log(2);
  /* 音名口径按 M5 中庸律惯例取降号侧（wolf 在 G♯–E♭）：不用 D♯/A♯/E♯ */
  var NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];

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
      group: '律与器：品丝、调律与自由调音',
      modeFret: '吉他指板 · 品丝位置',
      modePiano: '钢琴调律偏差',
      modeVoice: '人声 / 无品弦乐器的自由调音',
      fretFormula: '品丝距弦枕 d = L × (1 − 2^(−cents/1200))',
      pianoNote: '偏移条 = 该音相对 12 平均律的偏差（音分）；虚线为 0 参考。',
      voiceNote: '可连续调音：音高围绕目标浮动，不必落在等分格上。',
      scaleLen: '弦长 L',
      unitMm: 'mm',
      unitCents: '音分',
      nut: '弦枕',
      bridge: '琴桥',
      open: '空弦',
      fretN: '第 {n} 品',
      fretRead: '第 {n} 品 · {cents} 音分 · 距弦枕 {mm} mm · 与 12 等分参考差 {dev} 音分',
      openRead: '空弦 · 0 音分',
      pianoRead: '{note} · 偏差 {dev} 音分（相对 12 平均律）',
      voiceRead: '第 {n} 个采样 · 偏差 {dev} 音分',
      hint: '← → 移动，Enter 选中当前项',
      empty: '暂无数据',
      dev0: '0 参考',
      sharp: '偏高',
      flat: '偏低'
    },
    en: {
      group: 'Instruments: frets, tuning and free intonation',
      modeFret: 'Guitar fretboard · fret positions',
      modePiano: 'Piano tuning deviation',
      modeVoice: 'Free intonation: voice / unfretted strings',
      fretFormula: 'fret distance from nut d = L × (1 − 2^(−cents/1200))',
      pianoNote: 'offset bars show each note’s deviation from 12-TET (cents); dashed line = 0.',
      voiceNote: 'Continuous intonation: pitch floats around the target instead of landing on a grid.',
      scaleLen: 'scale length L',
      unitMm: 'mm',
      unitCents: 'cents',
      nut: 'nut',
      bridge: 'bridge',
      open: 'open',
      fretN: 'fret {n}',
      fretRead: 'Fret {n} · {cents} cents · {mm} mm from the nut · {dev} cents vs 12-TET reference',
      openRead: 'Open string · 0 cents',
      pianoRead: '{note} · {dev} cents deviation (vs 12-TET)',
      voiceRead: 'Sample {n} · {dev} cents deviation',
      hint: '← → to move, Enter to select',
      empty: 'No data',
      dev0: '0 reference',
      sharp: 'sharp',
      flat: 'flat'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }

  var CSS = [
    '.vz-iso{position:relative;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-iso-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:6px 14px;}',
    '.vz-iso-title{font-size:13px;font-weight:600;color:var(--c-bronze,#C8A35A);}',
    '.vz-iso-sub{font-size:11.5px;opacity:.62;}',
    '.vz-iso-stage{position:relative;flex:1 1 auto;min-height:104px;display:flex;align-items:center;}',
    '.vz-iso-board{position:relative;width:100%;height:96px;border-radius:5px;',
    'background:linear-gradient(180deg,rgba(240,236,226,.05),rgba(240,236,226,.02));border:1px solid rgba(240,236,226,.14);}',
    '.vz-iso-string{position:absolute;left:0;right:0;height:1px;background:rgba(240,236,226,.2);pointer-events:none;}',
    '.vz-iso-nut{position:absolute;left:0;top:0;bottom:0;width:7px;background:var(--c-bronze,#C8A35A);opacity:.85;border-radius:3px 0 0 3px;pointer-events:none;}',
    '.vz-iso-fret{position:absolute;top:2px;bottom:2px;width:16px;margin-left:-8px;padding:0;border:0;',
    'background:transparent;cursor:pointer;color:inherit;-webkit-tap-highlight-color:transparent;}',
    '.vz-iso-wire{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:rgba(240,236,226,.42);border-radius:1px;',
    'transition:background-color 120ms linear, opacity 120ms linear;}',
    '.vz-iso-fret:hover .vz-iso-wire{background:var(--c-light,#F0ECE2);}',
    '.vz-iso-fret:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:1px;border-radius:3px;}',
    '.vz-iso-fret.is-active .vz-iso-wire{background:var(--c-bronze,#C8A35A);width:3px;margin-left:-1.5px;box-shadow:0 0 8px rgba(200,163,90,.7);}',
    '.vz-iso-fret-label{position:absolute;top:auto;bottom:-16px;left:50%;transform:translateX(-50%);font-size:9.5px;opacity:.6;pointer-events:none;white-space:nowrap;}',
    '.vz-iso-fret.is-active .vz-iso-fret-label,.vz-iso-fret:focus-visible .vz-iso-fret-label{opacity:1;color:var(--c-bronze,#C8A35A);}',
    '.vz-iso-bridge{position:absolute;right:0;top:-4px;bottom:-4px;width:8px;background:var(--c-cyan,#6E8FA3);opacity:.75;border-radius:2px;pointer-events:none;}',
    '.vz-iso-tag{position:absolute;font-size:10px;opacity:.5;pointer-events:none;white-space:nowrap;}',
    '.vz-iso-keys{display:flex;width:100%;gap:10px;align-items:stretch;}',
    '.vz-iso-axis{position:relative;flex:0 0 46px;height:132px;font-size:9.5px;opacity:.55;}',
    '.vz-iso-axis span{position:absolute;right:0;transform:translateY(-50%);white-space:nowrap;}',
    '.vz-iso-axis::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(240,236,226,.2);}',
    '.vz-iso-keyboard{position:relative;flex:1 1 auto;height:132px;display:flex;border:1px solid rgba(240,236,226,.2);border-radius:4px;overflow:hidden;}',
    '.vz-iso-key{position:relative;flex:1 1 0;border:0;border-right:1px solid rgba(240,236,226,.16);padding:0;',
    'background:rgba(240,236,226,.09);cursor:pointer;color:inherit;min-width:0;-webkit-tap-highlight-color:transparent;}',
    '.vz-iso-key:last-child{border-right:0;}',
    '.vz-iso-key:hover{background:rgba(240,236,226,.16);}',
    '.vz-iso-key:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:-2px;}',
    '.vz-iso-key.is-black{position:absolute;top:0;height:62%;background:#16181c;border:1px solid rgba(240,236,226,.22);',
    'border-radius:0 0 3px 3px;z-index:2;}',
    '.vz-iso-key.is-black:hover{background:#22262b;}',
    '.vz-iso-key.is-active{background:rgba(200,163,90,.32);}',
    '.vz-iso-key.is-black.is-active{background:rgba(200,163,90,.42);}',
    '.vz-iso-keyname{position:absolute;left:0;right:0;bottom:4px;text-align:center;font-size:10px;opacity:.66;pointer-events:none;}',
    '.vz-iso-ref{position:absolute;left:0;right:0;top:50%;height:0;border-top:1px dashed rgba(240,236,226,.34);pointer-events:none;z-index:3;}',
    '.vz-iso-mark{position:absolute;left:50%;width:9px;height:9px;margin-left:-4.5px;margin-top:-4.5px;border-radius:50%;',
    'background:var(--c-bronze,#C8A35A);pointer-events:none;transition:top 160ms ease;}',
    '.vz-iso-key.is-active .vz-iso-mark{background:var(--c-light,#F0ECE2);}',
    '.vz-iso-svg{position:absolute;inset:0;width:100%;height:100%;display:block;}',
    '.vz-iso-voicewrap{position:relative;width:100%;height:150px;}',
    '.vz-iso-ptbtn{position:absolute;width:24px;height:24px;margin:-12px 0 0 -12px;border:0;padding:0;',
    'background:transparent;border-radius:50%;cursor:pointer;-webkit-tap-highlight-color:transparent;}',
    '.vz-iso-ptbtn:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:0;}',
    '.vz-iso-readout{min-height:32px;border-top:1px solid rgba(240,236,226,.12);padding-top:6px;font-size:11.5px;',
    'opacity:.92;font-variant-numeric:tabular-nums;}',
    '.vz-iso-readout .dev{color:var(--c-bronze,#C8A35A);font-weight:600;}',
    '.vz-iso-hint{margin:0;font-size:10.5px;opacity:.55;line-height:1.5;}',
    '.vz-iso-empty{font-size:12px;opacity:.6;padding:18px 4px;}',
    '.vz-iso-rm .vz-iso-mark,.vz-iso-rm .vz-iso-wire{transition:none;}',
    '@media (prefers-reduced-motion: reduce){.vz-iso-mark,.vz-iso-wire{transition:none;}}',
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
    if (container.__vizIsochord) { try { container.__vizIsochord.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);
    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);
    var onSelect = (typeof opts.onSelect === 'function') ? opts.onSelect : null;

    var state = { mode: 'fret', L: NaN, cents: [] };
    var destroyed = false, ro = null, live = null, focusIdx = 0, activeIdx = null;
    var root = null, head = null, titleEl = null, subEl = null, stage = null, readout = null, hintEl = null, emptyEl = null;
    var items = [];      /* 可聚焦元素（品 / 键 / 采样点） */
    var fretCents = [];  /* 指板模式实际参与排布的品丝音分（已剔除首项空弦） */
    var baselineEls = []; /* 可选 */

    clear(container);
    root = mk('div', 'vz-iso' + (reduced ? ' vz-iso-rm' : ''));
    root.setAttribute('role', 'group');
    head = mk('div', 'vz-iso-head');
    titleEl = mk('span', 'vz-iso-title');
    subEl = mk('span', 'vz-iso-sub');
    head.appendChild(titleEl); head.appendChild(subEl);
    stage = mk('div', 'vz-iso-stage');
    emptyEl = mk('div', 'vz-iso-empty');
    readout = mk('div', 'vz-iso-readout');
    hintEl = mk('p', 'vz-iso-hint');
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(head); root.appendChild(stage); root.appendChild(emptyEl);
    root.appendChild(readout); root.appendChild(hintEl); root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }
    function announce(msg) { if (live) live.textContent = msg; }
    function centsArr() { return state.cents; }
    function devOf(i) { var v = num(centsArr()[i], NaN); return v; }

    function setReadout(nodes) {
      clear(readout);
      for (var i = 0; i < nodes.length; i++) readout.appendChild(nodes[i]);
    }
    function readText(txt) { return doc.createTextNode(txt); }
    function devSpan(v) {
      return mk('span', 'dev', { text: isFinite(v) ? ((v >= 0 ? '+' : '') + fmt(v, 2)) : '—' });
    }
    /* 模板里用 {x}；action='dev' 的占位换成样式化 <span> */
    function buildRead(tplStr, map, devKey, devVal) {
      var nodes = [], re = /\{(\w+)\}/g, last = 0, m;
      while ((m = re.exec(tplStr))) {
        if (m.index > last) nodes.push(readText(tplStr.slice(last, m.index)));
        if (m[1] === devKey) nodes.push(devSpan(devVal));
        else nodes.push(readText(map[m[1]] == null ? '' : String(map[m[1]])));
        last = re.lastIndex;
      }
      if (last < tplStr.length) nodes.push(readText(tplStr.slice(last)));
      return nodes;
    }

    /* ---------- 指板 ---------- */
    function renderFret() {
      var dd = D();
      var cents = centsArr();
      if (!cents.length) { renderEmpty(); return; }
      var board = mk('div', 'vz-iso-board');
      board.setAttribute('role', 'group');
      board.setAttribute('aria-label', dd.modeFret);
      /* 弦（装饰） */
      for (var s = 0; s < 6; s++) {
        var line = mk('div', 'vz-iso-string');
        line.style.top = (16 + s * 12) + 'px';
        line.setAttribute('aria-hidden', 'true');
        board.appendChild(line);
      }
      board.appendChild(mk('div', 'vz-iso-nut'));
      var nutTag = mk('div', 'vz-iso-tag', { text: dd.nut });
      nutTag.style.left = '10px'; nutTag.style.top = '-2px';
      board.appendChild(nutTag);
      var brTag = mk('div', 'vz-iso-tag', { text: dd.bridge });
      brTag.style.right = '12px'; brTag.style.top = '-2px';
      board.appendChild(brTag);
      /* 空弦（位置 0）：若 cents[0] ≈ 0，说明数据把空弦也列进来了 → 从第 2 项起算品丝 */
      var openBtn = makeFretBtn(null, 0, dd.open, 0, true);
      board.appendChild(openBtn);
      items.push(openBtn);
      var first = num(cents[0], NaN);
      var skipFirst = isFinite(first) && Math.abs(first) < 0.5 && cents.length > 1;
      fretCents = skipFirst ? cents.slice(1) : cents.slice();
      for (var i = 0; i < fretCents.length; i++) {
        var c = num(fretCents[i], NaN);
        if (!isFinite(c)) continue;
        var frac = clamp(1 - Math.pow(2, -c / 1200), 0.015, 0.97);
        var b = makeFretBtn(i, frac * 100, String(i + 1), c);
        board.appendChild(b);
        items.push(b);
      }
      stage.appendChild(board);
      titleEl.textContent = dd.modeFret;
      subEl.textContent = dd.fretFormula + (isFinite(state.L) && state.L > 0 ? (' · ' + dd.scaleLen + ' ' + fmt(state.L, 1) + ' ' + dd.unitMm) : '');
      /* 读数：默认显示第 1 品 */
      if (items.length > 1) showFretRead(0); else showFretRead(-1);
    }

    function makeFretBtn(index, leftPct, label, cents, isOpen) {
      var dd = D();
      var b = mk('button', 'vz-iso-fret');
      b.type = 'button';
      b.style.left = leftPct.toFixed(3) + '%';
      b.setAttribute('data-i', index == null ? 'open' : String(index));
      b.tabIndex = -1;
      var wire = mk('span', 'vz-iso-wire');
      b.appendChild(wire);
      var lb = mk('span', 'vz-iso-fret-label', { text: label });
      if (isOpen) { lb.style.left = '10px'; lb.style.transform = 'none'; lb.style.textAlign = 'left'; }
      b.appendChild(lb);
      var aria = (index == null || index < 0)
        ? dd.openRead
        : tpl(dd.fretRead, {
          n: index + 1,
          cents: fmt(cents, 2),
          mm: (isFinite(state.L) && state.L > 0) ? fmt(state.L * (1 - Math.pow(2, -cents / 1200)), 1) : '—',
          dev: isFinite(cents) ? (cents - Math.round(cents / 100) * 100) : 0
        });
      b.setAttribute('aria-label', aria);
      b.addEventListener('focus', function () { onItemFocus(b); });
      b.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); onItemPick(b); });
      b.addEventListener('keydown', onKeyNav);
      return b;
    }

    function showFretRead(i) {
      var dd = D();
      if (i < 0) { setReadout([readText(dd.openRead)]); return; }
      var c = num(fretCents[i], NaN);
      var dev = isFinite(c) ? c - Math.round(c / 100) * 100 : NaN;
      setReadout(buildRead(dd.fretRead, {
        n: i + 1,
        cents: isFinite(c) ? fmt(c, 2) : '—',
        mm: (isFinite(state.L) && state.L > 0 && isFinite(c)) ? fmt(state.L * (1 - Math.pow(2, -c / 1200)), 1) : '—'
      }, 'dev', dev));
    }

    /* ---------- 钢琴 ---------- */
    function renderPiano() {
      var dd = D();
      var cents = centsArr();
      if (!cents.length) { renderEmpty(); return; }
      var n = clamp(cents.length, 1, 48);
      var wrap = mk('div', 'vz-iso-keys');
      var maxDev = 0;
      for (var d = 0; d < n; d++) { var v = Math.abs(num(cents[d], 0)); if (v > maxDev) maxDev = v; }
      maxDev = Math.max(10, maxDev * 1.15);
      var axis = mk('div', 'vz-iso-axis');
      axis.setAttribute('aria-hidden', 'true');
      var topLbl = mk('span', '', { text: '+' + fmt(maxDev, 0) + ' ' + dd.unitCents });
      topLbl.style.top = '4px';
      var zeroLbl = mk('span', '', { text: dd.dev0 });
      zeroLbl.style.top = '50%';
      var botLbl = mk('span', '', { text: '−' + fmt(maxDev, 0) });
      botLbl.style.top = '96%';
      axis.appendChild(topLbl); axis.appendChild(zeroLbl); axis.appendChild(botLbl);
      var kb = mk('div', 'vz-iso-keyboard');
      kb.setAttribute('role', 'group');
      kb.setAttribute('aria-label', dd.modePiano);
      var octaves = Math.ceil(n / 12);
      var whiteCount = 0;
      for (var q = 0; q < n; q++) {
        var semi = q % 12;
        if (!isBlack(semi)) whiteCount++;
      }
      whiteCount = Math.max(1, whiteCount);
      /* 先白键（按顺序），再黑键（绝对定位） */
      for (var i = 0; i < n; i++) {
        var semi2 = i % 12;
        var dev = num(cents[i], 0);
        if (isBlack(semi2)) continue;
        var key = makePianoKey(i, false, dev, maxDev, NOTE_NAMES[semi2] + (Math.floor(i / 12) + 1));
        kb.appendChild(key);
      }
      /* 黑键定位：按所在白键边界 */
      var whitePos = {}; /* 半音索引 → 其前面白键数量 */
      var wc = 0;
      for (var k = 0; k < n; k++) {
        var sm = k % 12;
        whitePos[k] = wc;      /* 该半音处已有白键数 */
        if (!isBlack(sm)) wc++;
      }
      for (var m = 0; m < n; m++) {
        var sm2 = m % 12;
        if (!isBlack(sm2)) continue;
        var dev2 = num(cents[m], 0);
        var key2 = makePianoKey(m, true, dev2, maxDev, NOTE_NAMES[sm2] + (Math.floor(m / 12) + 1));
        var blackW = 100 / whiteCount * 0.62;
        var left = (whitePos[m]) * (100 / whiteCount) - blackW / 2;
        key2.style.left = left.toFixed(3) + '%';
        key2.style.width = blackW.toFixed(3) + '%';
        kb.appendChild(key2);
      }
      var ref = mk('div', 'vz-iso-ref');
      kb.appendChild(ref);
      wrap.appendChild(axis); wrap.appendChild(kb);
      stage.appendChild(wrap);
      titleEl.textContent = dd.modePiano;
      subEl.textContent = dd.pianoNote;
      if (items.length) showPianoRead(0);
    }

    function isBlack(semi) { return semi === 1 || semi === 3 || semi === 6 || semi === 8 || semi === 10; }

    function makePianoKey(index, black, dev, maxDev, noteLabel) {
      var dd = D();
      var b = mk('button', 'vz-iso-key' + (black ? ' is-black' : ''));
      b.type = 'button';
      b.setAttribute('data-i', String(index));
      b.tabIndex = -1;
      b.setAttribute('aria-label', tpl(dd.pianoRead, {
        note: noteLabel, dev: ((dev >= 0 ? '+' : '') + fmt(dev, 2))
      }));
      var off = clamp(dev / maxDev, -1, 1) * 40; /* 相对键高中心的百分比偏移 */
      var mark = mk('span', 'vz-iso-mark');
      mark.style.top = (50 - off).toFixed(2) + '%';
      b.appendChild(mark);
      if (!black) {
        var nm = mk('span', 'vz-iso-keyname', { text: noteLabel.replace(/\d+$/, '') });
        b.appendChild(nm);
      }
      b.addEventListener('focus', function () { onItemFocus(b); });
      b.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); onItemPick(b); });
      b.addEventListener('keydown', onKeyNav);
      items.push(b);
      return b;
    }

    function showPianoRead(i) {
      var dd = D();
      var dev = num(centsArr()[i], NaN);
      setReadout(buildRead(dd.pianoRead, {
        note: NOTE_NAMES[i % 12] + (Math.floor(i / 12) + 1)
      }, 'dev', dev));
    }

    /* ---------- 人声 / 自由调音 ---------- */
    function renderVoice() {
      var dd = D();
      var cents = centsArr();
      if (!cents.length) { renderEmpty(); return; }
      var wrap = mk('div', 'vz-iso-voicewrap');
      var svg = mks('svg', { 'class': 'vz-iso-svg', 'aria-hidden': 'true', focusable: 'false' });
      wrap.appendChild(svg);
      stage.appendChild(wrap);
      titleEl.textContent = dd.modeVoice;
      subEl.textContent = dd.voiceNote;
      drawVoice(svg);
      for (var i = 0; i < cents.length; i++) {
        var b = mk('button', 'vz-iso-ptbtn');
        b.type = 'button';
        b.setAttribute('data-i', String(i));
        b.tabIndex = -1;
        var dev = num(cents[i], NaN);
        b.setAttribute('aria-label', tpl(dd.voiceRead, {
          n: i + 1, dev: (isFinite(dev) ? ((dev >= 0 ? '+' : '') + fmt(dev, 2)) : '—')
        }));
        b.addEventListener('focus', function () { onItemFocus(this); });
        b.addEventListener('click', function (ev) { if (ev && ev.preventDefault) ev.preventDefault(); onItemPick(this); });
        b.addEventListener('keydown', onKeyNav);
        wrap.appendChild(b);
        items.push(b);
      }
      placeVoicePoints();
      if (items.length) showVoiceRead(0);
    }

    function voiceGeom() {
      var w = stage.clientWidth || 320, h = 150;
      return { w: w, h: h, padX: 16, padY: 16 };
    }
    function voicePointXY(i, n, maxDev) {
      var g = voiceGeom();
      var pts = n <= 1 ? [g.w / 2] : null;
      var x = pts ? pts[0] : g.padX + i * (g.w - g.padX * 2) / (n - 1);
      var dev = num(centsArr()[i], 0);
      var y = g.h / 2 - clamp(dev / maxDev, -1, 1) * (g.h / 2 - g.padY);
      return { x: x, y: y };
    }
    function voiceMaxDev() {
      var cents = centsArr(), maxDev = 0;
      for (var i = 0; i < cents.length; i++) maxDev = Math.max(maxDev, Math.abs(num(cents[i], 0)));
      return Math.max(10, maxDev * 1.15);
    }
    function drawVoice(svg) {
      var g = voiceGeom();
      var cents = centsArr();
      var n = cents.length, maxDev = voiceMaxDev();
      svg.setAttribute('viewBox', '0 0 ' + g.w + ' ' + g.h);
      clear(svg);
      /* 参考线 / 刻度 */
      var axisLines = [-1, -0.5, 0, 0.5, 1];
      for (var a = 0; a < axisLines.length; a++) {
        var v = axisLines[a];
        var y = g.h / 2 - v * (g.h / 2 - g.padY);
        svg.appendChild(mks('line', {
          'class': 'vz-iso-axisline',
          x1: 0, y1: y.toFixed(1), x2: g.w, y2: y.toFixed(1),
          stroke: v === 0 ? 'rgba(240,236,226,.4)' : 'rgba(240,236,226,.12)',
          'stroke-dasharray': v === 0 ? '4 5' : '2 6'
        }));
        var lbl = mks('text', {
          x: 2, y: (y - 3).toFixed(1), fill: 'rgba(240,236,226,.5)', 'font-size': '9.5'
        });
        lbl.appendChild(doc.createTextNode((v * maxDev >= 0 ? '+' : '−') + fmt(Math.abs(v * maxDev), 0)));
        svg.appendChild(lbl);
      }
      /* 漂移曲线 + 垂线 */
      var d = '';
      for (var i = 0; i < n; i++) {
        var p = voicePointXY(i, n, maxDev);
        d += (i === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        svg.appendChild(mks('line', {
          x1: p.x.toFixed(1), y1: (g.h / 2).toFixed(1), x2: p.x.toFixed(1), y2: p.y.toFixed(1),
          stroke: 'rgba(200,163,90,.35)', 'stroke-width': 1
        }));
      }
      svg.appendChild(mks('path', { d: d, fill: 'none', stroke: 'var(--c-bronze,#C8A35A)', 'stroke-width': 2.2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
      for (var k = 0; k < n; k++) {
        var q = voicePointXY(k, n, maxDev);
        svg.appendChild(mks('circle', { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: 3.6, fill: 'var(--c-bronze,#C8A35A)' }));
        if (k === activeIdx) {
          svg.appendChild(mks('circle', { cx: q.x.toFixed(1), cy: q.y.toFixed(1), r: 8, fill: 'none', stroke: 'var(--c-light,#F0ECE2)', 'stroke-width': 2 }));
        }
      }
    }
    function placeVoicePoints() {
      var maxDev = voiceMaxDev();
      var n = centsArr().length;
      for (var i = 0; i < items.length; i++) {
        var p = voicePointXY(i, n, maxDev);
        items[i].style.left = p.x.toFixed(1) + 'px';
        items[i].style.top = p.y.toFixed(1) + 'px';
      }
    }
    function showVoiceRead(i) {
      var dd = D();
      var dev = num(centsArr()[i], NaN);
      setReadout(buildRead(dd.voiceRead, { n: i + 1 }, 'dev', dev));
    }

    /* ---------- 公共交互 ---------- */
    function itemsOf() { return items; }

    function setFocusRoving() {
      var want = clamp(focusIdx, 0, Math.max(0, items.length - 1));
      for (var i = 0; i < items.length; i++) items[i].tabIndex = (i === want) ? 0 : -1;
    }

    function itemIndex(el) {
      var v = el && el.getAttribute ? el.getAttribute('data-i') : null;
      if (v === 'open') return -1;
      return num(v, -1);
    }

    function readForIdx(i) {
      if (state.mode === 'fret') showFretRead(i < 0 ? -1 : i);
      else if (state.mode === 'piano') { if (i >= 0) showPianoRead(i); }
      else { if (i >= 0) showVoiceRead(i); }
    }

    function onItemFocus(el) {
      if (destroyed) return;
      var i = itemIndex(el);
      activeIdx = i;
      var fi = items.indexOf(el);
      if (fi >= 0) { focusIdx = fi; setFocusRoving(); }
      readForIdx(i);
      if (state.mode === 'voice') {
        var svg = stage.querySelector('svg');
        if (svg) drawVoice(svg);
      }
    }
    function onItemPick(el) {
      if (destroyed) return;
      var i = itemIndex(el);
      activeIdx = i;
      readForIdx(i);
      if (onSelect && i >= 0) { try { onSelect(i); } catch (e) {} }
    }
    function onKeyNav(ev) {
      if (destroyed || !ev) return;
      var el = ev.currentTarget;
      var fi = items.indexOf(el);
      if (fi < 0) return;
      var nxt = -1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nxt = Math.min(items.length - 1, fi + 1);
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nxt = Math.max(0, fi - 1);
      else if (ev.key === 'Home') nxt = 0;
      else if (ev.key === 'End') nxt = items.length - 1;
      else if (ev.key === 'Escape') { el.blur(); return; }
      else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        if (ev.preventDefault) ev.preventDefault();
        onItemPick(el);
        return;
      }
      if (nxt >= 0) {
        if (ev.preventDefault) ev.preventDefault();
        items[nxt].focus();
      }
    }

    function renderEmpty() {
      var dd = D();
      clear(stage);
      stage.style.display = 'none';
      items = [];
      emptyEl.style.display = '';
      emptyEl.textContent = dd.empty;
      readout.textContent = '';
      titleEl.textContent = state.mode === 'piano' ? dd.modePiano : (state.mode === 'voice' ? dd.modeVoice : dd.modeFret);
      subEl.textContent = '';
      hintEl.textContent = dd.hint;
      root.setAttribute('aria-label', dd.group);
    }

    function build() {
      if (destroyed) return;
      var dd = D();
      root.setAttribute('aria-label', dd.group);
      clear(stage);
      items = [];
      activeIdx = null;
      emptyEl.style.display = 'none';
      stage.style.display = '';
      hintEl.textContent = dd.hint;
      if (state.mode === 'piano') renderPiano();
      else if (state.mode === 'voice') renderVoice();
      else renderFret();
      setFocusRoving();
    }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var mode = (next.mode === 'piano' || next.mode === 'voice' || next.mode === 'fret') ? next.mode : 'fret';
      var cents = Array.isArray(next.cents) ? next.cents.map(function (v) { return num(v, NaN); }).slice(0, 64) : [];
      state.mode = mode;
      state.L = num(next.L, NaN);
      state.cents = cents;
      build();
    }

    function highlight(i) {
      if (destroyed) return;
      if (i == null || !isFinite(+i)) {
        activeIdx = null;
        for (var k = 0; k < items.length; k++) items[k].classList.remove('is-active');
        return;
      }
      var idx = Math.round(+i);
      if (idx < 0 || idx >= items.length) return;
      activeIdx = itemIndex(items[idx]);
      for (var j = 0; j < items.length; j++) items[j].classList.toggle('is-active', j === idx);
      focusIdx = idx;
      setFocusRoving();
      readForIdx(activeIdx);
      if (state.mode === 'voice') { var svg = stage.querySelector('svg'); if (svg) drawVoice(svg); }
    }

    function layout() {
      if (destroyed) return;
      if (state.mode === 'voice') {
        var svg = stage.querySelector('svg');
        if (svg) { drawVoice(svg); placeVoicePoints(); }
      }
    }

    function destroy() {
      destroyed = true;
      if (ro) { ro.disconnect(); ro = null; }
      container.__vizIsochord = null;
      clear(container);
      items = [];
    }

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: layout,
      destroy: destroy,
      setLang: function (l) { lang = (l === 'en') ? 'en' : 'zh'; build(); },
      getState: function () { return { mode: state.mode, L: state.L, cents: state.cents.slice() }; }
    };
    container.__vizIsochord = inst;
    ro = watchResize(stage, layout);
    build();
    return inst;
  }

  Viz.isochord = { version: '1.0.0', init: init };
})();
