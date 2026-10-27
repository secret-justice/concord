/* =============================================================================
 * 同律 CONCORD · viz/monochord.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   律尺 / 单弦（M2「律尺 · 一根弦上的宇宙」）。画一根弦与可移动的琴马，弦长比
 *   （振动弦长 / 全长）可拖动或用键盘 ←→ 调整（滑块语义 role="slider"，
 *   aria-valuenow / aria-valuetext 实时更新），并可点/键盘激活预设弦长比。
 *   组件只用 app 传入的 state.ratio / lens / hz / cents 渲染，不内置任何律制数值。
 *
 * API：
 *   var inst = Viz.monochord.init(el, opts);
 *     opts : {
 *       lang:'zh'|'en',
 *       reducedMotion:boolean,
 *       range:[min,max]         // 可选，弦长比滑块范围，默认 [0.5,1]（弦长比物理区间）
 *       scale:'linear'|'log'    // 可选，滑块位置映射，默认 'linear'
 *       step:number             // 可选，键盘步长，默认 (max-min)/400
 *       value:number            // 可选，初始 ratio（无 state 时用）
 *       onChange(ratio)         // 拖动/键盘/预设改变时回调（app 据此重算 state 并 update）
 *     }
 *   inst.update(state)
 *   inst.highlight(i|null)     // 高亮第 i 个预设（lens 索引）
 *   inst.resize() / inst.destroy() / inst.setLang(lang)
 *
 * state 契约：
 *   {
 *     ratio:number,                        // 弦长比（振动弦长 / 全长）
 *     lens:[{ label:string, ratio:number, hz?:number, cents?:number }],
 *     hz?:number, cents?:number, note?:string   // 可选：app 算好的当前值（有则优先显示）
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
  if (Viz.monochord) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'vz-monochord-style';
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
  /* 连分数 → 简单分数（仅在逼近时使用；通用数学，不是律制常量） */
  function toFraction(x, maxDen) {
    if (!isFinite(x) || x === 0) return null;
    var sign = x < 0 ? -1 : 1; x = Math.abs(x);
    var h0 = 0, h1 = 1, k0 = 1, k1 = 0, b = x, i = 0;
    while (i++ < 24) {
      var a = Math.floor(b);
      var h2 = a * h1 + h0, k2 = a * k1 + k0;
      h0 = h1; h1 = h2; k0 = k1; k1 = k2;
      if (k1 > maxDen) return null;
      if (Math.abs(x - h1 / k1) < 1e-9) return [sign * h1, k1];
      var frac = b - a;
      if (frac < 1e-12) return [sign * h1, k1];
      b = 1 / frac;
    }
    return null;
  }

  /* ---------- 文案 ---------- */
  var DICT = {
    zh: {
      group: '律尺：一根弦上的弦长比',
      slider: '弦长比',
      unitCents: '音分',
      unitHz: 'Hz',
      ratioK: '弦长比',
      centsK: '音分',
      hzK: '频率',
      lengthLbl: '振动弦长 = 弦长比 × 全长',
      nut: '岳山',
      bridge: '琴马',
      lensGroup: '预设弦长比',
      hint: '拖动滑块 / 点按预设 / 用 ← → 微调，Home 与 End 到两端',
      applied: '已应用预设 {label}（弦长比 {ratio}）',
      empty: '暂无预设',
      srValue: '弦长比 {ratio}，{cents} 音分'
    },
    en: {
      group: 'Monochord: string-length ratio',
      slider: 'String length ratio',
      unitCents: 'cents',
      unitHz: 'Hz',
      ratioK: 'ratio',
      centsK: 'cents',
      hzK: 'frequency',
      lengthLbl: 'sounding length = ratio × full length',
      nut: 'nut',
      bridge: 'bridge',
      lensGroup: 'Preset string-length ratios',
      hint: 'Drag the slider, pick a preset, or use ← → ; Home / End jump to the ends',
      applied: 'Preset {label} applied (ratio {ratio})',
      empty: 'No presets',
      srValue: 'ratio {ratio}, {cents} cents'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }

  var CSS = [
    '.vz-mono{position:relative;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-mono-head{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap;flex:0 0 auto;}',
    '.vz-mono-ratio{display:flex;align-items:baseline;gap:7px;}',
    '.vz-mono-ratio-v{font-size:26px;font-weight:700;color:var(--c-bronze,#C8A35A);letter-spacing:.5px;}',
    '.vz-mono-ratio-d{font-size:12px;opacity:.72;}',
    '.vz-mono-meta{display:flex;gap:14px;flex-wrap:wrap;align-items:baseline;}',
    '.vz-mono-meta-item{display:inline-flex;align-items:baseline;gap:5px;}',
    '.vz-mono-meta-item .k{font-size:11px;opacity:.62;}',
    '.vz-mono-meta-item .v{font-size:14px;color:var(--c-cyan,#6E8FA3);font-variant-numeric:tabular-nums;}',
    '.vz-mono-stage{position:relative;width:100%;height:126px;flex:0 0 auto;}',
    '.vz-mono-svg{position:absolute;inset:0;width:100%;height:100%;display:block;}',
    '.vz-mono-track{position:relative;height:34px;min-height:34px;flex:0 0 auto;margin:0 2px;cursor:pointer;touch-action:none;}',
    '.vz-mono-rail{position:absolute;left:0;right:0;top:15px;height:4px;border-radius:2px;background:rgba(240,236,226,.16);}',
    '.vz-mono-fill{position:absolute;left:0;top:15px;height:4px;border-radius:2px;background:var(--c-bronze,#C8A35A);opacity:.85;}',
    '.vz-mono-thumb{position:absolute;top:17px;width:18px;height:18px;margin:-9px 0 0 -9px;border-radius:50%;',
    'background:var(--c-bronze,#C8A35A);border:2px solid var(--c-ink,#0B0D10);box-shadow:0 0 0 2px rgba(200,163,90,.35);',
    'transition:transform 120ms ease, box-shadow 120ms ease;}',
    '.vz-mono-track:hover .vz-mono-thumb{box-shadow:0 0 0 4px rgba(200,163,90,.28);}',
    '.vz-mono-track:active .vz-mono-thumb{transform:scale(.94);}',
    '.vz-mono-track:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:4px;border-radius:4px;}',
    '.vz-mono-track:focus-visible .vz-mono-thumb{box-shadow:0 0 0 4px rgba(240,236,226,.35);}',
    '.vz-mono-tick{position:absolute;top:9px;width:1px;height:8px;background:rgba(240,236,226,.28);pointer-events:none;}',
    '.vz-mono-tick.is-lens{height:12px;top:7px;background:var(--c-cyan,#6E8FA3);opacity:.8;}',
    '.vz-mono-tick.is-active{background:var(--c-light,#F0ECE2);width:2px;opacity:1;}',
    '.vz-mono-lens{display:flex;flex-wrap:wrap;gap:6px;flex:0 0 auto;}',
    '.vz-mono-lens-btn{font:inherit;font-size:12px;color:var(--c-light,#F0ECE2);background:rgba(240,236,226,.05);',
    'border:1px solid rgba(240,236,226,.2);border-radius:6px;padding:3px 8px;cursor:pointer;line-height:1.5;',
    'transition:border-color 120ms linear, background-color 120ms linear;}',
    '.vz-mono-lens-btn:hover{border-color:var(--c-bronze,#C8A35A);background:rgba(200,163,90,.12);}',
    '.vz-mono-lens-btn:active{transform:translateY(1px);}',
    '.vz-mono-lens-btn:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:1px;}',
    '.vz-mono-lens-btn.is-active{border-color:var(--c-bronze,#C8A35A);background:rgba(200,163,90,.2);color:#fff;}',
    '.vz-mono-lens-btn .lr{opacity:.6;font-size:11px;margin-left:3px;}',
    '.vz-mono-hint{margin:0;font-size:11.5px;opacity:.62;line-height:1.5;flex:0 0 auto;}',
    '.vz-mono-empty{font-size:12px;opacity:.6;}',
    '.vz-mono-svg text{font-family:inherit;}',
    '.vz-mono-str{stroke:var(--c-light,#F0ECE2);stroke-opacity:.22;stroke-width:2;stroke-linecap:round;}',
    '.vz-mono-str-on{stroke:var(--c-bronze,#C8A35A);stroke-width:4;stroke-linecap:round;}',
    '.vz-mono-nut{fill:var(--c-cyan,#6E8FA3);}',
    '.vz-mono-bridge{fill:var(--c-bronze,#C8A35A);}',
    '.vz-mono-body{fill:rgba(240,236,226,.045);stroke:rgba(240,236,226,.16);stroke-width:1;}',
    '.vz-mono-bracket{stroke:var(--c-cyan,#6E8FA3);stroke-opacity:.7;stroke-width:1;fill:none;}',
    '.vz-mono-lbl{fill:var(--c-light,#F0ECE2);font-size:11px;opacity:.72;paint-order:stroke;stroke:var(--c-ink,#0B0D10);stroke-width:3px;stroke-linejoin:round;}',
    '.vz-mono-rm .vz-mono-thumb{transition:none;}',
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
    if (container.__vizMonochord) { try { container.__vizMonochord.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);

    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);
    var onChange = (typeof opts.onChange === 'function') ? opts.onChange : null;
    var range = (Array.isArray(opts.range) && isNum(opts.range[0]) && isNum(opts.range[1]) && opts.range[1] > opts.range[0])
      ? [opts.range[0], opts.range[1]] : [0.5, 1];
    var scaleMode = (opts.scale === 'log') ? 'log' : 'linear';
    var destroyed = false, ro = null, live = null;
    var state = { ratio: NaN, lens: [], hz: NaN, cents: NaN, note: '' };
    var curRatio = num(opts.value, (range[0] + range[1]) / 2);
    var lensEls = [], tickEls = [], activeLens = null;

    /* ---------- DOM ---------- */
    clear(container);
    var root = mk('div', 'vz-mono' + (reduced ? ' vz-mono-rm' : ''));
    root.setAttribute('role', 'group');

    var head = mk('div', 'vz-mono-head');
    var ratioBox = mk('div', 'vz-mono-ratio');
    var ratioV = mk('span', 'vz-mono-ratio-v', { text: '—' });
    var ratioD = mk('span', 'vz-mono-ratio-d', { text: '' });
    ratioBox.appendChild(ratioV); ratioBox.appendChild(ratioD);
    var meta = mk('div', 'vz-mono-meta');
    var centsK = mk('span', 'k'), centsV = mk('span', 'v');
    var metaCents = mk('span', 'vz-mono-meta-item');
    metaCents.appendChild(centsK); metaCents.appendChild(centsV);
    var hzK = mk('span', 'k'), hzV = mk('span', 'v');
    var metaHz = mk('span', 'vz-mono-meta-item');
    metaHz.appendChild(hzK); metaHz.appendChild(hzV);
    meta.appendChild(metaCents);
    meta.appendChild(metaHz);
    head.appendChild(ratioBox); head.appendChild(meta);

    var stage = mk('div', 'vz-mono-stage');
    var svg = mks('svg', { 'class': 'vz-mono-svg', viewBox: '0 0 640 126', preserveAspectRatio: 'none', 'aria-hidden': 'true', focusable: 'false' });
    stage.appendChild(svg);

    var track = mk('div', 'vz-mono-track');
    track.setAttribute('role', 'slider');
    track.setAttribute('tabindex', '0');
    track.setAttribute('aria-orientation', 'horizontal');
    var rail = mk('div', 'vz-mono-rail');
    var fill = mk('div', 'vz-mono-fill');
    var thumb = mk('div', 'vz-mono-thumb');
    track.appendChild(rail); track.appendChild(fill); track.appendChild(thumb);

    var lensBox = mk('div', 'vz-mono-lens');
    var hint = mk('p', 'vz-mono-hint');
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');

    root.appendChild(head); root.appendChild(stage); root.appendChild(track);
    root.appendChild(lensBox); root.appendChild(hint); root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }

    /* ---------- 位置映射 ---------- */
    function posOf(r) {
      var lo = range[0], hi = range[1];
      if (scaleMode === 'log' && lo > 0 && hi > 0 && r > 0) {
        var a = Math.log(lo) / LOG2, b = Math.log(hi) / LOG2;
        return clamp((Math.log(r) / LOG2 - a) / (b - a), 0, 1);
      }
      return clamp((r - lo) / (hi - lo), 0, 1);
    }
    function ratioOf(p) {
      var lo = range[0], hi = range[1];
      p = clamp(p, 0, 1);
      if (scaleMode === 'log' && lo > 0 && hi > 0) {
        var a = Math.log(lo) / LOG2, b = Math.log(hi) / LOG2;
        return Math.pow(2, a + (b - a) * p);
      }
      return lo + (hi - lo) * p;
    }
    function normCents(r) {
      /* 弦长比 → 相对全长（ratio=1）的音分：频率 ∝ 1/弦长。仅用于 app 未传 cents 时的显示兜底。 */
      if (!isFinite(r) || r <= 0) return NaN;
      return -1200 * Math.log(r) / LOG2;
    }
    function ensureRange(r) {
      if (!isFinite(r) || r <= 0) return;
      if (r < range[0]) range[0] = r * 0.98;
      if (r > range[1]) range[1] = r * 1.02;
      range[0] = Math.max(1e-6, range[0]);
    }

    /* ---------- 数值显示 ---------- */
    function ratioLabel(r) {
      var f = toFraction(r, 64);
      if (f && Math.abs(f[0] / f[1] - r) < 1e-6 && f[1] > 1) return f[0] + '/' + f[1];
      return fmt(r, 4);
    }
    function renderValues() {
      var dd = D();
      var r = isFinite(state.ratio) ? state.ratio : curRatio;
      var cents = isNum(state.cents) ? state.cents : normCents(r);
      var hz = num(state.hz, NaN);
      ratioV.textContent = ratioLabel(r);
      ratioD.textContent = (ratioLabel(r) === fmt(r, 4)) ? '' : ('= ' + fmt(r, 4));
      centsK.textContent = dd.centsK;
      centsV.textContent = (cents >= 0 ? '+' : '') + fmt(cents, 2);
      hzK.textContent = dd.hzK;
      hzV.textContent = isFinite(hz) ? (fmt(hz, 2) + ' ' + dd.unitHz) : '—';
      metaHz.style.display = isFinite(hz) ? '' : 'none';
      noteSpan.textContent = state.note ? String(state.note) : '';
      noteSpan.style.display = state.note ? '' : 'none';
      /* slider ARIA */
      track.setAttribute('aria-label', dd.slider);
      track.setAttribute('aria-valuemin', String(range[0]));
      track.setAttribute('aria-valuemax', String(range[1]));
      var now = isFinite(r) ? r : curRatio;
      track.setAttribute('aria-valuenow', fmt(now, 4));
      track.setAttribute('aria-valuetext', tpl(dd.srValue, {
        ratio: ratioLabel(now),
        cents: (isFinite(cents) ? (cents >= 0 ? '+' : '') + fmt(cents, 2) : '—')
      }));
      var p = posOf(now);
      fill.style.width = (p * 100).toFixed(3) + '%';
      thumb.style.left = (p * 100).toFixed(3) + '%';
      for (var i = 0; i < lensEls.length; i++) {
        var lr = num(state.lens[i].ratio, NaN);
        var near = isFinite(lr) && Math.abs(lr - now) <= Math.max(1e-6, Math.abs(now) * 5e-4);
        lensEls[i].classList.toggle('is-active', activeLens === i || (activeLens == null && near));
      }
      for (var t = 0; t < tickEls.length; t++) {
        var tr = num(state.lens[t] && state.lens[t].ratio, NaN);
        tickEls[t].classList.toggle('is-active', activeLens === t);
        tickEls[t].classList.toggle('is-lens', isFinite(tr));
      }
      drawString();
    }
    var noteSpan = mk('span', 'vz-mono-ratio-d');

    /* ---------- 弦图 ---------- */
    function drawString() {
      var w = stage.clientWidth || 640;
      var h = 126;
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      clear(svg);
      var dd = D();
      var x0 = 12, x1 = w - 12;
      var span = x1 - x0;
      var y = 46;
      var r = isFinite(state.ratio) ? state.ratio : curRatio;
      var rp = clamp(isFinite(r) ? r : 1, 0, 1);
      var bx = x0 + span * rp;
      /* 共鸣体 */
      svg.appendChild(mks('rect', { 'class': 'vz-mono-body', x: x0 - 8, y: 62, width: span + 16, height: 46, rx: 6 }));
      /* 整弦（琴马右侧的无效段） */
      svg.appendChild(mks('line', { 'class': 'vz-mono-str', x1: fmt(bx, 1), y1: y, x2: fmt(x1, 1), y2: y }));
      /* 振动弦段 */
      svg.appendChild(mks('line', { 'class': 'vz-mono-str-on', x1: fmt(x0, 1), y1: y, x2: fmt(bx, 1), y2: y }));
      /* 岳山 / 琴马 */
      svg.appendChild(mks('rect', { 'class': 'vz-mono-nut', x: x0 - 3, y: y - 14, width: 6, height: 28, rx: 1.5 }));
      svg.appendChild(mks('rect', { 'class': 'vz-mono-bridge', x: fmt(bx - 3.5, 1), y: y - 17, width: 7, height: 34, rx: 1.5 }));
      svg.appendChild(mks('path', { 'class': 'vz-mono-bridge', d: 'M' + fmt(bx - 10, 1) + ' ' + (y + 26) + ' L' + fmt(bx + 10, 1) + ' ' + (y + 26) + ' L' + fmt(bx, 1) + ' ' + (y + 17) + ' Z', opacity: '.55' }));
      /* 振动长度标注括号 */
      var by = y + 42;
      svg.appendChild(mks('path', {
        'class': 'vz-mono-bracket',
        d: 'M' + fmt(x0, 1) + ' ' + fmt(by - 5, 1) + ' V' + fmt(by, 1) + ' H' + fmt(bx, 1) + ' V' + fmt(by - 5, 1)
      }));
      var lbl = mks('text', { 'class': 'vz-mono-lbl', x: fmt((x0 + bx) / 2, 1), y: fmt(by - 9, 1), 'text-anchor': 'middle' });
      lbl.appendChild(doc.createTextNode(dd.lengthLbl));
      svg.appendChild(lbl);
      /* 岳山 / 琴马 文字 */
      var nutLbl = mks('text', { 'class': 'vz-mono-lbl', x: fmt(x0 + 2, 1), y: fmt(y - 20, 1), 'text-anchor': 'start' });
      nutLbl.appendChild(doc.createTextNode(dd.nut));
      svg.appendChild(nutLbl);
      var bridgeX = clamp(bx, x0 + 22, x1 - 22);
      var brLbl = mks('text', { 'class': 'vz-mono-lbl', x: fmt(bridgeX, 1), y: fmt(y - 24, 1), 'text-anchor': 'middle' });
      brLbl.appendChild(doc.createTextNode(dd.bridge));
      svg.appendChild(brLbl);
    }

    /* ---------- 设值 ---------- */
    function setRatio(r, silent) {
      if (!isFinite(r)) return;
      r = clamp(r, range[0], range[1]);
      curRatio = r;
      state.ratio = r;
      state.cents = num(state.centsGiven, normCents(r));
      renderValues();
      if (!silent && onChange) { try { onChange(r); } catch (e) {} }
    }
    function setRatioFromPointer(clientX) {
      var rect = track.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      var p = (clientX - rect.left) / rect.width;
      setRatio(ratioOf(p), false);
    }

    /* ---------- 事件 ---------- */
    var dragging = false;
    function onDown(ev) {
      if (destroyed || !ev) return;
      dragging = true;
      if (track.focus) track.focus();
      if (track.setPointerCapture && ev.pointerId != null) { try { track.setPointerCapture(ev.pointerId); } catch (e) {} }
      setRatioFromPointer(ev.clientX);
      if (ev.preventDefault) ev.preventDefault();
    }
    function onMove(ev) {
      if (!dragging || destroyed) return;
      setRatioFromPointer(ev.clientX);
      if (ev.preventDefault) ev.preventDefault();
    }
    function onUp(ev) {
      dragging = false;
      if (track.releasePointerCapture && ev && ev.pointerId != null) { try { track.releasePointerCapture(ev.pointerId); } catch (e) {} }
    }
    function onTrackKey(ev) {
      if (destroyed || !ev) return;
      var dd = D();
      var lo = range[0], hi = range[1];
      var stepDefault = isNum(opts.step) ? Math.abs(opts.step) : (hi - lo) / 400;
      var step = ev.shiftKey ? stepDefault * 10 : stepDefault;
      var r = isFinite(state.ratio) ? state.ratio : curRatio;
      var handled = true;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowUp') setRatio(r + step, false);
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowDown') setRatio(r - step, false);
      else if (ev.key === 'PageUp') setRatio(r + stepDefault * 20, false);
      else if (ev.key === 'PageDown') setRatio(r - stepDefault * 20, false);
      else if (ev.key === 'Home') setRatio(lo, false);
      else if (ev.key === 'End') setRatio(hi, false);
      else if (ev.key === 'Escape') { track.blur(); }
      else handled = false;
      if (handled && ev.preventDefault) ev.preventDefault();
    }
    function onLensKey(ev) {
      if (!ev) return;
      var list = lensEls;
      var i = list.indexOf(ev.currentTarget);
      if (i < 0) return;
      var nxt = -1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nxt = (i + 1) % list.length;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nxt = (i - 1 + list.length) % list.length;
      else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') { ev.preventDefault(); ev.currentTarget.click(); return; }
      if (nxt >= 0) { ev.preventDefault(); list[nxt].focus(); }
    }

    track.addEventListener('pointerdown', onDown);
    track.addEventListener('pointermove', onMove);
    track.addEventListener('pointerup', onUp);
    track.addEventListener('pointercancel', onUp);
    track.addEventListener('keydown', onTrackKey);

    /* ---------- 渲染预设 ---------- */
    function renderLens() {
      var dd = D();
      clear(lensBox);
      lensEls = []; tickEls = [];
      lensBox.setAttribute('role', 'group');
      lensBox.setAttribute('aria-label', dd.lensGroup);
      /* 滑轨刻度（装饰层：插入 track 尾部的视觉刻度） */
      var tw = track.querySelectorAll('.vz-mono-tick');
      for (var z = 0; z < tw.length; z++) track.removeChild(tw[z]);
      var totalCents = 0;
      for (var i = 0; i < state.lens.length; i++) {
        var L = state.lens[i] || {};
        var lr = num(L.ratio, NaN);
        var lcent = isNum(L.cents) ? L.cents : normCents(lr);
        var lbl = (L.label != null && L.label !== '') ? String(L.label) : ('—');
        var b = mk('button', 'vz-mono-lens-btn');
        b.type = 'button';
        b.setAttribute('aria-label', lbl + '，' + dd.ratioK + ' ' + ratioLabel(lr) +
          '，' + (isFinite(lcent) ? ((lcent >= 0 ? '+' : '') + fmt(lcent, 2) + ' ' + dd.unitCents) : ''));
        b.appendChild(doc.createTextNode(lbl));
        var lrSpan = mk('span', 'lr', { text: ratioLabel(lr) });
        b.appendChild(lrSpan);
        b.addEventListener('click', (function (val, label) {
          return function () {
            if (destroyed) return;
            var before = range[0] + ':' + range[1];
            ensureRange(val);
            if (before !== range[0] + ':' + range[1]) renderLens();
            setRatio(val, false);
            activeLens = null;
            renderValues();
            announce(tpl(D().applied, { label: label, ratio: ratioLabel(val) }));
          };
        })(lr, lbl));
        b.addEventListener('keydown', onLensKey);
        lensBox.appendChild(b);
        lensEls.push(b);
        if (isFinite(lr) && lr > 0) {
          var tick = mk('div', 'vz-mono-tick is-lens');
          tick.style.left = (posOf(lr) * 100).toFixed(3) + '%';
          track.appendChild(tick);
          tickEls.push(tick);
        }
      }
      hint.textContent = state.lens.length ? dd.hint : dd.empty;
    }

    function announce(msg) { if (live) live.textContent = msg; }

    function layout() {
      if (destroyed) return;
      drawString();
      renderValues();
    }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var ratio = num(next.ratio, NaN);
      state.ratio = ratio;
      state.lens = Array.isArray(next.lens) ? next.lens.filter(function (o) { return o && typeof o === 'object'; }).slice(0, 96) : [];
      state.hz = num(next.hz, NaN);
      state.centsGiven = num(next.cents, NaN);
      state.cents = state.centsGiven;
      state.note = next.note != null ? String(next.note) : '';
      if (isFinite(ratio)) ensureRange(ratio);
      if (isFinite(ratio)) curRatio = ratio;
      renderLens();
      renderValues();
    }

    function highlight(i) {
      if (destroyed) return;
      if (i == null || !isFinite(+i)) activeLens = null;
      else {
        var k = Math.round(+i);
        activeLens = (k < 0 || k >= state.lens.length) ? null : k;
      }
      renderValues();
    }

    /* 头部补一个音名 span（可选数据） */
    ratioBox.appendChild(noteSpan);

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: layout,
      destroy: function () {
        destroyed = true;
        if (ro) { ro.disconnect(); ro = null; }
        dragging = false;
        container.__vizMonochord = null;
        clear(container);
        lensEls = []; tickEls = [];
      },
      setLang: function (l) { lang = (l === 'en') ? 'en' : 'zh'; renderLens(); renderValues(); },
      getState: function () { return { ratio: state.ratio, lens: state.lens.slice(), cents: state.cents, hz: state.hz }; }
    };
    container.__vizMonochord = inst;
    ro = watchResize(stage, layout);
    /* 初始：无 state 时用 opts.value / 范围中点，保证 not-empty 可视化 */
    state.ratio = curRatio;
    state.cents = normCents(curRatio);
    state.centsGiven = NaN;
    renderLens();
    renderValues();
    return inst;
  }

  Viz.monochord = { version: '1.0.0', init: init };
})();
