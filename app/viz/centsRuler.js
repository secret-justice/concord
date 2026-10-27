/* =============================================================================
 * 同律 CONCORD · viz/centsRuler.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   音分刻度尺叠加（M5「世界律制 · 同一个八度，很多种切法」）。横向 0–1200 音分
 *   刻度轴，多套律制各占一行、刻度叠放；鼠标悬停或键盘聚焦某个刻度时显示：
 *   该刻度相对「1200 音分 12 等分参考格线」的偏差，以及与其他律制最近刻度的差值。
 *   所有律制音分值由 app 从 data/kernel 传入，组件不内置任何律制数值。
 *
 * API：
 *   var inst = Viz.centsRuler.init(el, opts);
 *     opts : { lang:'zh'|'en', reducedMotion:boolean,
 *              onSelect({systemId, index, cents}) }   // 点选刻度
 *   inst.update(state)
 *   inst.highlight(i|null)      // 高亮：i 为「按 system 顺序展平」的刻度下标；
 *                               // 也接受 {systemId, index}
 *   inst.resize() / inst.destroy() / inst.setLang(lang)
 *
 * state 契约：
 *   { systems: [{ id:string, name:string, color?:string, cents:number[] }] }
 *   注：cents 应为 0–1200 音分上的位置；超出范围会在刻度尺上被夹到端点并标红，
 *       数值本身仍如实显示（不篡改数据）。
 *
 * 依赖：无。纯原生 JS + DOM/CSS，file:// 直接可用。
 * 样式：--c-light / --c-bronze / --c-cyan / --c-red / --c-ink / --font-ui（均有 fallback）
 * 复跑：浏览器打开 viz/_demo.html；静态自检 py -X utf8 viz/check_viz.py。
 * ========================================================================== */
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : null;
  if (!W || !W.document) return;
  var doc = W.document;
  var Viz = W.Viz = window.Viz || {};
  if (Viz.centsRuler) return;

  var STYLE_ID = 'vz-centsruler-style';
  var GRID = 1200 / 12; /* 仅作为参考格线（12 等分）的画法，不是律制数据 */

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
  function safeColor(c) {
    if (typeof c !== 'string') return null;
    var s = c.trim();
    if (/^#[0-9a-fA-F]{3,8}$/.test(s)) return s;
    if (/^rgba?\(\s*[\d.]+%?\s*[, ]\s*[\d.]+%?\s*[, ]\s*[\d.]+%?(\s*[,/]\s*[\d.]+%?)?\s*\)$/.test(s)) return s;
    return null;
  }

  /* ---------- 文案 ---------- */
  var DICT = {
    zh: {
      group: '音分刻度尺：多律制叠加',
      axis: '音分（0 = 同一个八度起点，1200 = 八度）',
      gridRef: '参考格线：八度 12 等分（每格 100 音分）',
      rowGroup: '{name}，{n} 个刻度',
      mark: '{name} 第 {i} 音：{cents} 音分',
      readout: '{name} · 第 {i} 音 · {cents} 音分　偏离参考格线 {dev} 音分',
      nearest: '与其他律制最近刻度：',
      vs: '{name} {d}',
      hint: '悬停 / 键盘聚焦刻度看差值；←→ 在本律制内移动，↑↓ 换行，Enter 选中',
      empty: '暂无律制数据',
      outOfRange: '（超出 0–1200）'
    },
    en: {
      group: 'Cents ruler: stacked tuning systems',
      axis: 'cents (0 = start of the octave, 1200 = octave)',
      gridRef: 'reference grid: octave divided into 12 (100 cents each)',
      rowGroup: '{name}, {n} marks',
      mark: '{name} note {i}: {cents} cents',
      readout: '{name} · note {i} · {cents} cents　{dev} cents from the reference grid',
      nearest: 'Nearest mark in other systems:',
      vs: '{name} {d}',
      hint: 'Hover or keyboard-focus a mark to compare; ←→ within a system, ↑↓ across systems, Enter selects',
      empty: 'No tuning data',
      outOfRange: ' (outside 0–1200)'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }

  var PALETTE = ['var(--c-bronze,#C8A35A)', 'var(--c-cyan,#6E8FA3)', '#8FA98B', '#B08A6E', '#9C9AA8', '#7FA3A0'];

  var CSS = [
    '.vz-ruler{position:relative;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-ruler-plot{position:relative;flex:1 1 auto;display:flex;flex-direction:column;min-height:120px;}',
    '.vz-ruler-rows{flex:1 1 auto;overflow-y:auto;overflow-x:hidden;padding:2px 0;min-height:0;scrollbar-gutter:stable;}',
    '.vz-ruler-row{display:flex;align-items:center;gap:8px;min-height:27px;}',
    '.vz-ruler-name{flex:0 0 96px;max-width:96px;font-size:11.5px;opacity:.86;text-align:right;overflow:hidden;',
    'text-overflow:ellipsis;white-space:nowrap;display:flex;align-items:center;gap:5px;justify-content:flex-end;}',
    '.vz-ruler-dot{width:7px;height:7px;border-radius:50%;background:var(--row-color,var(--c-bronze,#C8A35A));flex:0 0 auto;}',
    '.vz-ruler-track{position:relative;flex:1 1 auto;height:26px;border-left:1px solid rgba(240,236,226,.28);',
    'border-right:1px solid rgba(240,236,226,.28);}',
    '.vz-ruler-track::before{content:"";position:absolute;left:0;right:0;top:50%;height:1px;background:rgba(240,236,226,.14);}',
    '.vz-ruler-mark{position:absolute;top:50%;width:16px;height:22px;margin:-11px 0 0 -8px;padding:0;border:0;',
    'background:transparent;cursor:pointer;color:inherit;-webkit-tap-highlight-color:transparent;}',
    '.vz-ruler-mark::before{content:"";position:absolute;left:50%;top:3px;width:2px;height:16px;margin-left:-1px;',
    'background:var(--row-color,var(--c-bronze,#C8A35A));border-radius:1px;opacity:.85;transition:opacity 120ms linear, transform 120ms linear;}',
    '.vz-ruler-mark:hover::before{opacity:1;transform:scaleY(1.18);}',
    '.vz-ruler-mark:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:1px;border-radius:3px;}',
    '.vz-ruler-mark.is-active::before{opacity:1;width:3px;margin-left:-1.5px;box-shadow:0 0 6px var(--row-color,var(--c-bronze,#C8A35A));}',
    '.vz-ruler-mark.is-out::before{background:var(--c-red,#C0392B);}',
    '.vz-ruler-axis{position:relative;height:30px;margin:0 0 0 104px;border-top:1px solid rgba(240,236,226,.22);}',
    '.vz-ruler-tick{position:absolute;top:0;width:1px;height:5px;background:rgba(240,236,226,.3);}',
    '.vz-ruler-tick.is-major{height:8px;background:rgba(240,236,226,.5);}',
    '.vz-ruler-tick-lbl{position:absolute;top:10px;font-size:9.5px;opacity:.62;transform:translateX(-50%);',
    'font-variant-numeric:tabular-nums;white-space:nowrap;}',
    '.vz-ruler-tick-lbl.is-first{transform:none;}',
    '.vz-ruler-tick-lbl.is-last{transform:translateX(-100%);}',
    '.vz-ruler-guide-wrap{position:absolute;left:104px;right:0;top:0;bottom:30px;pointer-events:none;}',
    '.vz-ruler-guide{position:absolute;top:0;bottom:0;width:1px;background:var(--c-light,#F0ECE2);opacity:0;',
    'pointer-events:none;transition:opacity 120ms linear;}',
    '.vz-ruler-guide.is-on{opacity:.45;}',
    '.vz-ruler-readout{min-height:30px;border-top:1px solid rgba(240,236,226,.12);padding-top:5px;font-size:11.5px;opacity:.94;}',
    '.vz-ruler-readout .main{font-variant-numeric:tabular-nums;}',
    '.vz-ruler-readout .dev{color:var(--c-bronze,#C8A35A);font-variant-numeric:tabular-nums;}',
    '.vz-ruler-readout .cmp{display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:2px;font-size:11.5px;opacity:.8;}',
    '.vz-ruler-readout .cmp-k{opacity:.66;}',
    '.vz-ruler-readout .cmp-v{font-variant-numeric:tabular-nums;}',
    '.vz-ruler-hint{margin:0;font-size:10px;opacity:.66;line-height:1.45;}',
    '.vz-ruler-empty{font-size:12px;opacity:.6;padding:18px 4px;}',
    '.vz-ruler-rm .vz-ruler-mark::before,.vz-ruler-rm .vz-ruler-guide{transition:none;}',
    '@media (prefers-reduced-motion: reduce){.vz-ruler-mark::before,.vz-ruler-guide{transition:none;}}',
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
    if (container.__vizCentsRuler) { try { container.__vizCentsRuler.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);
    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);
    var onSelect = (typeof opts.onSelect === 'function') ? opts.onSelect : null;

    var state = { systems: [] };
    var marks = [];          /* 展平：{sysIndex, index, cents, el} */
    var rowEls = [], rowFocus = [];  /* 每行当前 tab 停靠的刻度下标 */
    var activeMark = null, destroyed = false, ro = null, live = null;
    var rowsBox = null, axisEl = null, plotEl = null, readoutEl = null, hintEl = null, guideEl = null, emptyEl = null;

    clear(container);
    var root = mk('div', 'vz-ruler' + (reduced ? ' vz-ruler-rm' : ''));
    root.setAttribute('role', 'group');
    plotEl = mk('div', 'vz-ruler-plot');
    rowsBox = mk('div', 'vz-ruler-rows');
    var guideWrap = mk('div', 'vz-ruler-guide-wrap');
    guideWrap.setAttribute('aria-hidden', 'true');
    guideEl = mk('div', 'vz-ruler-guide');
    guideWrap.appendChild(guideEl);
    axisEl = mk('div', 'vz-ruler-axis');
    axisEl.setAttribute('aria-hidden', 'true');
    plotEl.appendChild(rowsBox); plotEl.appendChild(guideWrap); plotEl.appendChild(axisEl);
    emptyEl = mk('div', 'vz-ruler-empty');
    readoutEl = mk('div', 'vz-ruler-readout');
    hintEl = mk('p', 'vz-ruler-hint');
    root.appendChild(emptyEl); root.appendChild(plotEl); root.appendChild(readoutEl); root.appendChild(hintEl);
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }
    function announce(msg) { if (live) live.textContent = msg; }

    function renderAxis() {
      var dd = D();
      clear(axisEl);
      axisEl.setAttribute('title', dd.gridRef);
      for (var c = 0; c <= 1200; c += GRID) {
        var p = c / 1200 * 100;
        var tk = mk('div', 'vz-ruler-tick' + (c % 300 === 0 ? ' is-major' : ''));
        tk.style.left = p.toFixed(3) + '%';
        axisEl.appendChild(tk);
        if (c % 100 === 0) {
          var lbl = mk('div', 'vz-ruler-tick-lbl' + (c === 0 ? ' is-first' : (c === 1200 ? ' is-last' : '')), { text: String(c) });
          lbl.style.left = p.toFixed(3) + '%';
          axisEl.appendChild(lbl);
        }
      }
    }

    function buildRows() {
      var dd = D();
      clear(rowsBox);
      rowEls = []; rowFocus = []; marks = [];
      activeMark = null;
      var total = 0;
      for (var s = 0; s < state.systems.length; s++) total += state.systems[s].cents.length;
      for (var i = 0; i < state.systems.length; i++) {
        var sys = state.systems[i];
        var color = safeColor(sys.color) || PALETTE[i % PALETTE.length];
        var row = mk('div', 'vz-ruler-row');
        row.setAttribute('role', 'group');
        row.setAttribute('aria-label', tpl(dd.rowGroup, { name: sys.name, n: sys.cents.length }));
        var nm = mk('div', 'vz-ruler-name');
        var dot = mk('span', 'vz-ruler-dot');
        dot.setAttribute('aria-hidden', 'true');
        nm.appendChild(dot);
        var nmTxt = mk('span', '', { text: sys.name });
        nm.appendChild(nmTxt);
        var track = mk('div', 'vz-ruler-track');
        track.style.setProperty('--row-color', color);
        row.appendChild(nm); row.appendChild(track);
        rowEls.push({ row: row, track: track, sysIndex: i, color: color });
        rowFocus.push(0);
        rowsBox.appendChild(row);
        for (var j = 0; j < sys.cents.length; j++) {
          var cents = num(sys.cents[j], NaN);
          var out = !isFinite(cents) || cents < 0 || cents > 1200;
          var p = isFinite(cents) ? (clamp(cents, 0, 1200) / 1200 * 100) : 0;
          var b = mk('button', 'vz-ruler-mark' + (out ? ' is-out' : ''));
          b.type = 'button';
          b.setAttribute('data-sys', String(i));
          b.setAttribute('data-i', String(j));
          b.style.left = p.toFixed(3) + '%';
          b.setAttribute('aria-label', tpl(dd.mark, {
            name: sys.name, i: j + 1, cents: isFinite(cents) ? fmt(cents, 2) : '—'
          }) + (out ? dd.outOfRange : ''));
          b.addEventListener('focus', onMarkFocus(i, j));
          b.addEventListener('mouseenter', onMarkFocus(i, j));
          b.addEventListener('blur', onMarkBlur);
          b.addEventListener('mouseleave', onMarkBlur);
          b.addEventListener('click', onMarkClick(i, j));
          b.addEventListener('keydown', onMarkKey);
          track.appendChild(b);
          marks.push({ sysIndex: i, index: j, cents: cents, el: b });
        }
        if (!sys.cents.length) {
          var none = mk('div', 'vz-ruler-tick-lbl', { text: '—' });
          none.style.left = '2%';
          track.appendChild(none);
        }
      }
      updateTabStops();
      clear(guideEl);
      readoutEl.textContent = '';
      if (!state.systems.length) {
        emptyEl.style.display = '';
        emptyEl.textContent = dd.empty;
        plotEl.style.display = 'none';
        hintEl.textContent = dd.hint;
      } else {
        emptyEl.style.display = 'none';
        plotEl.style.display = '';
        hintEl.textContent = dd.hint;
      }
    }

    function updateTabStops() {
      for (var s = 0; s < rowEls.length; s++) {
        var first = rowEls[s].track.querySelectorAll('.vz-ruler-mark');
        var want = clamp(rowFocus[s], 0, Math.max(0, first.length - 1));
        for (var k = 0; k < first.length; k++) first[k].tabIndex = (k === want) ? 0 : -1;
      }
    }

    function markAt(sysIndex, index) {
      for (var i = 0; i < marks.length; i++) {
        if (marks[i].sysIndex === sysIndex && marks[i].index === index) return marks[i];
      }
      return null;
    }

    function nearestOther(sysIndex, cents) {
      var out = [];
      if (!isFinite(cents)) return out;
      for (var s = 0; s < state.systems.length; s++) {
        if (s === sysIndex) continue;
        var arr = state.systems[s].cents, best = null, bd = Infinity;
        for (var j = 0; j < arr.length; j++) {
          var v = num(arr[j], NaN);
          if (!isFinite(v)) continue;
          var d = v - cents;
          if (Math.abs(d) < Math.abs(bd)) { bd = d; best = v; }
        }
        if (best != null) out.push({ name: state.systems[s].name, delta: bd });
      }
      out.sort(function (a, b) { return Math.abs(a.delta) - Math.abs(b.delta); });
      return out.slice(0, 4);
    }

    function showMark(m, announceIt) {
      var dd = D();
      var sys = state.systems[m.sysIndex];
      var cents = m.cents;
      var grid = isFinite(cents) ? cents - Math.round(cents / GRID) * GRID : NaN;
      clear(readoutEl);
      var main = mk('div', 'main');
      if (isFinite(cents)) {
        main.appendChild(doc.createTextNode(sys.name + ' · ' + (dd === DICT.en ? 'note ' : '第 ') + (m.index + 1) +
          (dd === DICT.en ? '' : ' 音') + ' · ' + fmt(cents, 2) + ' ' + (lang === 'en' ? 'cents' : '音分') + '　·　'));
        var dev = mk('span', 'dev', {
          text: (grid >= 0 ? '+' : '') + fmt(grid, 2) + ' ' + (lang === 'en' ? 'cents from grid' : '音分偏离参考格线')
        });
        main.appendChild(dev);
      } else {
        main.appendChild(doc.createTextNode(sys.name + ' · —'));
      }
      readoutEl.appendChild(main);
      var others = nearestOther(m.sysIndex, cents);
      if (others.length) {
        var cmp = mk('div', 'cmp');
        var k = mk('span', 'cmp-k', { text: dd.nearest });
        cmp.appendChild(k);
        for (var i = 0; i < others.length; i++) {
          var d = others[i].delta;
          var item = mk('span', '');
          item.appendChild(doc.createTextNode(others[i].name + ' '));
          var v = mk('span', 'cmp-v', { text: (d >= 0 ? '+' : '') + fmt(d, 2) });
          item.appendChild(v);
          cmp.appendChild(item);
        }
        readoutEl.appendChild(cmp);
      }
      /* 竖向导引线（guideWrap 与轨道同起点，left% 才对齐） */
      var canGuide = isFinite(cents);
      guideEl.classList.toggle('is-on', canGuide);
      if (canGuide) guideEl.style.left = (clamp(cents, 0, 1200) / 1200 * 100).toFixed(3) + '%';
      if (announceIt) announce(readoutEl.textContent.replace(/\s+/g, ' ').trim());
    }

    function hideMark() {
      /* 保留最后读数（避免读数区闪烁），只关导引线 */
      guideEl.classList.remove('is-on');
    }

    function onMarkFocus(sysIndex, index) {
      return function () {
        if (destroyed) return;
        var m = markAt(sysIndex, index);
        if (!m) return;
        rowFocus[sysIndex] = index;
        updateTabStops();
        activeMark = m;
        showMark(m, false);
      };
    }
    function onMarkBlur() {
      if (destroyed) return;
      var cur = doc.activeElement;
      if (cur && cur.classList && cur.classList.contains('vz-ruler-mark')) return;
      hideMark();
    }
    function onMarkClick(sysIndex, index) {
      return function (ev) {
        if (destroyed) return;
        if (ev && ev.preventDefault) ev.preventDefault();
        var m = markAt(sysIndex, index);
        if (!m) return;
        activeMark = m;
        showMark(m, true);
        if (onSelect && isFinite(m.cents)) {
          try { onSelect({ systemId: state.systems[sysIndex].id, index: index, cents: m.cents }); } catch (e) {}
        }
      };
    }
    function onMarkKey(ev) {
      if (destroyed || !ev) return;
      var el = ev.currentTarget;
      var si = num(el.getAttribute('data-sys'), -1);
      var j = num(el.getAttribute('data-i'), -1);
      if (si < 0) return;
      var track = rowEls[si].track;
      var list = track.querySelectorAll('.vz-ruler-mark');
      var nxt = null;
      if (ev.key === 'ArrowRight') nxt = list[Math.min(list.length - 1, j + 1)];
      else if (ev.key === 'ArrowLeft') nxt = list[Math.max(0, j - 1)];
      else if (ev.key === 'Home') nxt = list[0];
      else if (ev.key === 'End') nxt = list[list.length - 1];
      else if (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') {
        var target = ev.key === 'ArrowUp' ? si - 1 : si + 1;
        if (target >= 0 && target < rowEls.length) {
          var other = rowEls[target].track.querySelectorAll('.vz-ruler-mark');
          var want = clamp(rowFocus[target], 0, other.length - 1);
          /* 优先落到音分位置最近的那个刻度 */
          if (activeMark && isFinite(activeMark.cents) && other.length) {
            var best = 0, bd = Infinity;
            for (var q = 0; q < other.length; q++) {
              var c2 = num(state.systems[target].cents[num(other[q].getAttribute('data-i'), 0)], 0);
              if (Math.abs(c2 - activeMark.cents) < bd) { bd = Math.abs(c2 - activeMark.cents); best = q; }
            }
            want = best;
          }
          rowFocus[target] = want;
          updateTabStops();
          nxt = other[want] || null;
        }
      } else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        if (ev.preventDefault) ev.preventDefault();
        onMarkClick(si, j)();
        return;
      }
      if (nxt) {
        if (ev.preventDefault) ev.preventDefault();
        nxt.focus();
      }
    }

    function render() {
      if (destroyed) return;
      var dd = D();
      root.setAttribute('aria-label', dd.group);
      renderAxis();
      buildRows();
      if (state.systems.length) {
        var first = marks.length ? marks[0] : null;
        if (first && !readoutEl.firstChild) showMark(first, false);
      }
    }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var arr = Array.isArray(next.systems) ? next.systems : [];
      state.systems = arr.filter(function (s) { return s && typeof s === 'object'; }).map(function (s, i) {
        return {
          id: (s.id != null) ? s.id : ('sys-' + i),
          name: (s.name != null) ? String(s.name) : ('#' + (i + 1)),
          color: s.color,
          cents: Array.isArray(s.cents) ? s.cents.slice(0, 256) : []
        };
      }).slice(0, 24);
      var oldFocus = rowFocus.slice();
      render();
      for (var i = 0; i < Math.min(oldFocus.length, rowFocus.length); i++) rowFocus[i] = oldFocus[i];
      updateTabStops();
      if (marks.length) showMark(marks[0], false);
    }

    function highlight(i) {
      if (destroyed) return;
      var target = null;
      if (i && typeof i === 'object') {
        target = markAt(num(i.sysIndex != null ? i.sysIndex : i.systemIndex, -1), num(i.index, -1));
      } else if (i != null && isFinite(+i)) {
        var k = Math.round(+i);
        if (k >= 0 && k < marks.length) target = marks[k];
      }
      for (var m = 0; m < marks.length; m++) marks[m].el.classList.toggle('is-active', target === marks[m]);
      if (target) {
        activeMark = target;
        showMark(target, true);
      }
    }

    function destroy() {
      destroyed = true;
      if (ro) { ro.disconnect(); ro = null; }
      container.__vizCentsRuler = null;
      clear(container);
      marks = []; rowEls = []; rowFocus = [];
    }

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: function () {
        if (destroyed) return;
        /* 百分比定位无需重算；重算 tab 停靠与读数即可 */
        updateTabStops();
        if (activeMark) showMark(activeMark, false);
      },
      destroy: destroy,
      setLang: function (l) {
        lang = (l === 'en') ? 'en' : 'zh';
        var cur = activeMark;
        render();
        if (cur) {
          var m2 = markAt(cur.sysIndex, cur.index);
          if (m2) highlight(marks.indexOf(m2));
        }
      },
      getState: function () { return { systems: state.systems.slice() }; }
    };
    container.__vizCentsRuler = inst;
    ro = watchResize(rowsBox, function () { if (activeMark) showMark(activeMark, false); });
    var dd0 = dict(lang);
    root.setAttribute('aria-label', dd0.group);
    hintEl.textContent = dd0.hint;
    render();
    return inst;
  }

  Viz.centsRuler = { version: '1.0.0', init: init };
  /* 目录/调用方可能按 task 描述写成 cents-ruler：保留别名，避免集成时找不到 */
  Viz.cents_ruler = Viz.centsRuler;
})();
