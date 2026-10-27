/* =============================================================================
 * 同律 CONCORD · viz/spectrum.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   频谱 / 泛音（M6「编钟与琴 · 泛音列」）。Canvas 柱状频谱：每根柱 = 一个分音
 *   （频率由 f0 × ratio 得，柱高 = 相对幅度），顶部标出整数泛音列（×1、×2、×3…）
 *   作为参照；落在整数倍附近的分音用铜金高亮，偏离整数的（如钟体非谐分音）用钟青。
 *   playing 时柱高做轻微起伏动画；reducedMotion 时只画静态终态。
 *   分音数据由 app 传入，组件不内置任何频谱数值。
 *
 * API：
 *   var inst = Viz.spectrum.init(el, opts);
 *     opts : { lang:'zh'|'en', reducedMotion:boolean }
 *   inst.update(state)
 *   inst.highlight(i|null)     // 高亮第 i 根柱（分音下标）
 *   inst.resize() / inst.destroy() / inst.setLang(lang)
 *
 * state 契约：
 *   { partials:[{ n:number, ratio:number, amp:number }], f0:number, playing:boolean }
 *   注：f0 缺失或 ≤0 时退化为按序号等距排布（仅布局兜底，不伪造频率）。
 *
 * 依赖：无（Canvas 2D，无外部资源），file:// 直接可用。
 * 样式：颜色从 CSS 变量读取（--c-bronze / --c-cyan / --c-light / --c-ink / --c-red，
 *       均有 fallback）。画布外的文字用 CSS；画布内文字用系统字体栈。
 * 复跑：浏览器打开 viz/_demo.html；静态自检 py -X utf8 viz/check_viz.py。
 * ========================================================================== */
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : null;
  if (!W || !W.document) return;
  var doc = W.document;
  var Viz = W.Viz = W.Viz || {};
  if (Viz.spectrum) return;

  var STYLE_ID = 'vz-spectrum-style';
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
      group: '频谱与泛音列',
      caption: '{n} 个分音 · f0 = {f0} Hz · 顶部刻度为整数泛音（×n）',
      captionNoF0: '{n} 个分音（未提供基频 f0，按序号排列）',
      playing: '播放中',
      stopped: '已停止',
      empty: '暂无分音数据',
      canvasLabel: '频谱图：{n} 根柱表示各分音相对幅度；顶部刻度为整数泛音列；{state}',
      listGroup: '分音数据表（读屏用）',
      item: '分音 {n}：频率比 {ratio}，频率 {hz} Hz，相对幅度 {amp}',
      hint: '柱高 = 相对幅度；铜金 = 接近整数泛音，钟青 = 非谐分音'
    },
    en: {
      group: 'Spectrum and harmonic series',
      caption: '{n} partials · f0 = {f0} Hz · top ticks mark integer harmonics (×n)',
      captionNoF0: '{n} partials (no f0 given; laid out by index)',
      playing: 'playing',
      stopped: 'stopped',
      empty: 'No partial data',
      canvasLabel: 'Spectrum: {n} bars show relative partial amplitudes; top ticks mark the harmonic series; {state}',
      listGroup: 'Partial data table (for screen readers)',
      item: 'Partial {n}: ratio {ratio}, frequency {hz} Hz, relative amplitude {amp}',
      hint: 'Bar height = relative amplitude; bronze = near an integer harmonic, cyan = inharmonic'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }

  var CSS = [
    '.vz-spec{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-spec-stage{position:relative;flex:1 1 auto;width:100%;min-height:140px;}',
    '.vz-spec-canvas{display:block;width:100%;height:100%;}',
    '.vz-spec-caption{display:flex;flex-wrap:wrap;gap:4px 14px;align-items:baseline;font-size:11.5px;opacity:.78;}',
    '.vz-spec-state{display:inline-flex;align-items:center;gap:5px;}',
    '.vz-spec-state .lamp{width:7px;height:7px;border-radius:50%;background:rgba(240,236,226,.3);}',
    '.vz-spec.is-playing .vz-spec-state .lamp{background:var(--c-bronze,#C8A35A);box-shadow:0 0 6px var(--c-bronze,#C8A35A);',
    'animation:vz-spec-lamp 1.6s ease-in-out infinite;}',
    '@keyframes vz-spec-lamp{0%,100%{opacity:1;}50%{opacity:.4;}}',
    '.vz-spec-hint{margin:0;font-size:10.5px;opacity:.55;line-height:1.5;}',
    '.vz-spec-rm .vz-spec-state .lamp{animation:none;}',
    '@media (prefers-reduced-motion: reduce){.vz-spec.is-playing .vz-spec-state .lamp{animation:none;}}',
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
    if (container.__vizSpectrum) { try { container.__vizSpectrum.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);
    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);

    var state = { partials: [], f0: NaN, playing: false };
    var destroyed = false, ro = null, raf = 0, live = null, highlightIdx = null;
    var root = null, stage = null, canvas = null, ctx = null, captionEl = null, hintEl = null;
    var srList = null;

    clear(container);
    root = mk('div', 'vz-spec' + (reduced ? ' vz-spec-rm' : ''));
    root.setAttribute('role', 'group');
    stage = mk('div', 'vz-spec-stage');
    canvas = mk('canvas', 'vz-spec-canvas');
    canvas.setAttribute('role', 'img');
    ctx = canvas.getContext ? canvas.getContext('2d') : null;
    stage.appendChild(canvas);
    captionEl = mk('div', 'vz-spec-caption');
    hintEl = mk('p', 'vz-spec-hint');
    srList = mk('div', 'vz-sr');
    srList.setAttribute('role', 'list');
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(stage); root.appendChild(captionEl); root.appendChild(hintEl);
    root.appendChild(srList); root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }
    function announce(msg) { if (live) live.textContent = msg; }

    function css(prop, fallback) {
      try {
        var v = W.getComputedStyle(stage).getPropertyValue(prop);
        v = v && v.trim();
        return v || fallback;
      } catch (e) { return fallback; }
    }
    var COL = {
      bronze: function () { return css('--c-bronze', '#C8A35A'); },
      cyan: function () { return css('--c-cyan', '#6E8FA3'); },
      light: function () { return css('--c-light', '#F0ECE2'); },
      ink: function () { return css('--c-ink', '#0B0D10'); }
    };

    function maxAmp() {
      var m = 0;
      for (var i = 0; i < state.partials.length; i++) m = Math.max(m, Math.abs(num(state.partials[i].amp, 0)));
      return m > 0 ? m : 1;
    }

    /* ---------- 绘制 ---------- */
    function draw() {
      if (destroyed || !ctx) return;
      var w = stage.clientWidth, h = stage.clientHeight;
      var dpr = W.devicePixelRatio || 1;
      if (!w || !h) return;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      var dd = D();
      var parts = state.partials;
      var n = parts.length;
      var padL = 30, padR = 14, padT = 26, padB = 26;
      var pw = Math.max(10, w - padL - padR), ph = Math.max(10, h - padT - padB);
      var baseY = padT + ph;
      var mMax = maxAmp();
      var f0 = num(state.f0, NaN);
      var hasF0 = isFinite(f0) && f0 > 0;
      /* 频率区间（对数轴）：f0×ratio；无 f0 时按序号等距 */
      var freqs = [];
      for (var i = 0; i < n; i++) {
        var ratio = num(parts[i].ratio, NaN);
        if (!isFinite(ratio) && isNum(parts[i].n)) ratio = parts[i].n;
        if (ratio == null || !isFinite(ratio) || ratio <= 0) ratio = i + 1;
        freqs.push(hasF0 ? f0 * ratio : ratio);
      }
      var useLog = hasF0;
      var fMin = useLog ? Math.min.apply(null, freqs) : 1;
      var fMax = useLog ? Math.max.apply(null, freqs) : n;
      if (!isFinite(fMin) || fMin <= 0) { fMin = 1; useLog = false; }
      if (!isFinite(fMax) || fMax <= fMin) fMax = fMin * 2;
      var lmin = Math.log(fMin), lmax = Math.log(fMax);
      if (lmax - lmin < 1e-6) lmax = lmin + 1e-6;
      function xOfFreq(f) {
        if (!useLog) {
          if (n <= 1) return padL + pw / 2;
          return padL + (Math.max(0, Math.min(n - 1, f - 1)) / (n - 1)) * pw;
        }
        var t = (Math.log(Math.max(f, fMin)) - lmin) / (lmax - lmin);
        return padL + clamp(t, 0, 1) * pw;
      }
      /* 振幅网格 */
      ctx.save();
      ctx.strokeStyle = 'rgba(240,236,226,.1)';
      ctx.lineWidth = 1;
      for (var g = 0; g <= 2; g++) {
        var y = padT + ph * (g / 2);
        ctx.beginPath(); ctx.moveTo(padL, y + 0.5); ctx.lineTo(padL + pw, y + 0.5); ctx.stroke();
      }
      ctx.restore();
      ctx.fillStyle = 'rgba(240,236,226,.5)';
      ctx.font = '9.5px "Segoe UI","Microsoft YaHei",system-ui,sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(fmt(mMax, 2), 3, padT + 4);
      ctx.fillText('0', 3, baseY - 1);
      /* 整数泛音刻度（顶部） */
      if (hasF0) {
        var maxHarm = Math.min(40, Math.floor(fMax / f0 + 0.001));
        var minLabelPx = 24;
        var lastLabelX = -999;
        for (var hm = 1; hm <= maxHarm; hm++) {
          var hf = f0 * hm;
          var hx = xOfFreq(hf);
          var col = hm % 2 === 0 ? 'rgba(110,143,163,.55)' : 'rgba(240,236,226,.4)';
          ctx.strokeStyle = col;
          ctx.beginPath(); ctx.moveTo(hx + 0.5, padT - 10); ctx.lineTo(hx + 0.5, padT + 3); ctx.stroke();
          if (hx - lastLabelX >= minLabelPx) {
            ctx.fillStyle = 'rgba(240,236,226,.55)';
            ctx.textAlign = (hx < 22) ? 'left' : (hx > w - 22 ? 'right' : 'center');
            ctx.fillText('×' + hm, hx, padT - 13);
            lastLabelX = hx;
          }
        }
      } else {
        ctx.fillStyle = 'rgba(240,236,226,.5)';
        ctx.textAlign = 'center';
        ctx.fillText('n = 1 … ' + n, padL + pw / 2, padT - 13);
      }
      /* 柱 */
      var t = W.performance && W.performance.now ? W.performance.now() / 1000 : Date.now() / 1000;
      var barW = clamp(pw / Math.max(1, n) * 0.62, 4, 18);
      for (var b = 0; b < n; b++) {
        var amp = Math.abs(num(parts[b].amp, 0));
        var rel = clamp(amp / mMax, 0, 1);
        var mod = 1;
        if (state.playing && !reduced) {
          mod = 0.82 + 0.18 * Math.sin(t * 3.1 + b * 0.9);
        }
        var bh = Math.max(1.5, rel * ph * mod);
        var bx = xOfFreq(freqs[b]) - barW / 2;
        var by = baseY - bh;
        var ratio = num(parts[b].ratio, isNum(parts[b].n) ? parts[b].n : b + 1);
        var nearHarm = isFinite(ratio) && ratio > 0 && Math.abs(ratio - Math.round(ratio)) < 0.01;
        ctx.fillStyle = nearHarm ? COL.bronze() : COL.cyan();
        ctx.globalAlpha = 0.92;
        ctx.fillRect(bx, by, barW, bh);
        ctx.globalAlpha = 1;
        if (highlightIdx === b) {
          ctx.strokeStyle = COL.light();
          ctx.lineWidth = 2;
          ctx.strokeRect(bx - 2.5, by - 2.5, barW + 5, bh + 5);
        }
      }
      /* 轴线 */
      ctx.strokeStyle = 'rgba(240,236,226,.34)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, baseY + 0.5); ctx.lineTo(padL + pw, baseY + 0.5); ctx.stroke();
      /* 频率轴标签 */
      ctx.fillStyle = 'rgba(240,236,226,.55)';
      ctx.font = '9.5px "Segoe UI","Microsoft YaHei",system-ui,sans-serif';
      ctx.textAlign = 'left';
      if (hasF0) {
        ctx.fillText(fmt(f0, 1) + ' Hz', padL, baseY + 11);
        ctx.textAlign = 'right';
        ctx.fillText(fmt(fMax, 1) + ' Hz', padL + pw, baseY + 11);
      }
    }

    function renderStatic() {
      draw();
    }

    /* ---------- 动画 ---------- */
    function loop() {
      raf = 0;
      if (destroyed) return;
      draw();
      if (state.playing && !reduced) {
        raf = W.requestAnimationFrame(loop);
      }
    }
    function startLoop() {
      if (reduced || destroyed || !state.playing) return;
      if (raf) return;
      raf = W.requestAnimationFrame(loop);
    }
    function stopLoop() {
      if (raf && W.cancelAnimationFrame) W.cancelAnimationFrame(raf);
      raf = 0;
    }

    /* ---------- 文本 ---------- */
    function renderCaption() {
      var dd = D();
      var n = state.partials.length;
      clear(captionEl);
      if (!n) {
        captionEl.textContent = dd.empty;
        return;
      }
      var f0 = num(state.f0, NaN);
      var txt = (isFinite(f0) && f0 > 0)
        ? tpl(dd.caption, { n: n, f0: fmt(f0, 2) })
        : tpl(dd.captionNoF0, { n: n });
      captionEl.appendChild(doc.createTextNode(txt));
      var st = mk('span', 'vz-spec-state');
      var lamp = mk('span', 'lamp');
      lamp.setAttribute('aria-hidden', 'true');
      st.appendChild(lamp);
      st.appendChild(doc.createTextNode(state.playing ? dd.playing : dd.stopped));
      captionEl.appendChild(st);
      hintEl.textContent = dd.hint;
      /* canvas 可访问名 */
      canvas.setAttribute('aria-label', tpl(dd.canvasLabel, {
        n: n, state: state.playing ? dd.playing : dd.stopped
      }));
      /* 读屏数据表 */
      clear(srList);
      srList.setAttribute('aria-label', dd.listGroup);
      for (var i = 0; i < state.partials.length; i++) {
        var p = state.partials[i];
        var ratio = num(p.ratio, isNum(p.n) ? p.n : i + 1);
        var hz = (isFinite(f0) && f0 > 0) ? f0 * ratio : NaN;
        var li = mk('div', '');
        li.setAttribute('role', 'listitem');
        li.textContent = tpl(dd.item, {
          n: num(p.n, i + 1), ratio: fmt(ratio, 4), hz: isFinite(hz) ? fmt(hz, 2) : '—',
          amp: fmt(num(p.amp, 0), 3)
        });
        srList.appendChild(li);
      }
    }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var arr = Array.isArray(next.partials) ? next.partials : [];
      state.partials = arr.filter(function (p) { return p && typeof p === 'object'; }).map(function (p, i) {
        return {
          n: num(p.n, i + 1),
          ratio: num(p.ratio, num(p.n, i + 1)),
          amp: num(p.amp, 0)
        };
      }).slice(0, 256);
      state.f0 = num(next.f0, NaN);
      var wasPlaying = state.playing;
      state.playing = !!next.playing;
      renderCaption();
      if (state.playing && !reduced) startLoop(); else { stopLoop(); renderStatic(); }
      if (wasPlaying !== state.playing) announce(state.playing ? D().playing : D().stopped);
    }

    function highlight(i) {
      if (destroyed) return;
      if (i == null || !isFinite(+i)) highlightIdx = null;
      else {
        var k = Math.round(+i);
        highlightIdx = (k < 0 || k >= state.partials.length) ? null : k;
      }
      draw();
    }

    function layout() {
      if (destroyed) return;
      draw();
    }

    function destroy() {
      destroyed = true;
      stopLoop();
      if (ro) { ro.disconnect(); ro = null; }
      container.__vizSpectrum = null;
      clear(container);
    }

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: layout,
      destroy: destroy,
      setLang: function (l) {
        lang = (l === 'en') ? 'en' : 'zh';
        var dd2 = D();
        root.setAttribute('aria-label', dd2.group);
        hintEl.textContent = dd2.hint;
        renderCaption();
        draw();
      },
      getState: function () { return { partials: state.partials.slice(), f0: state.f0, playing: state.playing }; }
    };
    container.__vizSpectrum = inst;
    ro = watchResize(stage, layout);
    var dd0 = dict(lang);
    root.setAttribute('aria-label', dd0.group);
    canvas.setAttribute('aria-label', tpl(dd0.canvasLabel, { n: 0, state: dd0.stopped }));
    hintEl.textContent = dd0.hint;
    renderCaption();
    draw();
    return inst;
  }

  Viz.spectrum = { version: '1.0.0', init: init };
})();
