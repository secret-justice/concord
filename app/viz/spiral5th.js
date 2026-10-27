/* =============================================================================
 * 同律 CONCORD · viz/spiral5th.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   五度螺旋（对应 M1 序章 / M3 三分损益）。把 state.steps 里每一步的「音分增量」
 *   映射为绕原点的角度增量（可视化约定：1200 音分 = 360°，组件本身不内置任何律制
 *   数值），从中心向外画 n 个点；相邻角度差即纯五度。终点与起点之间的缺口用红色
 *   虚线 + state.closureCents 标注（「12 步回不到起点」）。
 *   播放时由 app 调 highlight(i) 沿链高亮。
 *
 * API：
 *   var inst = Viz.spiral5th.init(el, opts);
 *     el   : 容器 DOM（必填；尺寸可为 0，由 ResizeObserver 补布局）
 *     opts : { lang:'zh'|'en', reducedMotion:boolean, onSelect(i) }
 *   inst.update(state)       // 重绘
 *   inst.highlight(i|null)   // 高亮第 i 个点（0 基），null 取消
 *   inst.resize()            // 容器尺寸变化（已内置 ResizeObserver，一般不用手调）
 *   inst.destroy()           // 清理监听 / 动画 / DOM
 *   inst.setLang('zh'|'en')  // 可选：切换界面语言（也可直接 re-init）
 *
 * state 契约：
 *   {
 *     steps: [{ step?:number, name:string, cents:number, hz?:number, operation?:string }],
 *     closureCents: number,          // 终点相对起点的音分缺口（app 从内核传入）
 *     active?: number|null,          // 可选：当前步（等价于 update 后立即 highlight）
 *     playing?: boolean              // 可选：播放中（仅用于给高亮加轻微脉冲）
 *   }
 *   数值缺失时：角度按 360/n 均分、缺口按累积余量估算 —— 仅几何兜底，不冒充律制结论。
 *
 * 依赖：无。纯原生 JS + SVG/HTML，file:// 直接可用；零外部字体/图片/库。
 * 样式：颜色读 CSS 变量（组件内全部带 fallback，无 style.css 也不崩）：
 *   --c-light / --c-bronze / --c-cyan / --c-red / --c-ink / --font-ui
 * 复跑：浏览器直接打开 viz/_demo.html 目视验收；
 *       静态自检 py -X utf8 viz/check_viz.py；键盘/a11y 自检 py -X utf8 viz/_selftest.py。
 * ========================================================================== */
(function () {
  'use strict';
  var W = typeof window !== 'undefined' ? window : null;
  if (!W || !W.document) return;
  var doc = W.document;
  var Viz = W.Viz = W.Viz || {};
  if (Viz.spiral5th) return; // 幂等：重复 <script> 不重复定义

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'vz-spiral5th-style';
  var DEG = Math.PI / 180;

  /* ---------- 通用小工具（各组件文件自带一份，保证单文件即插即用） ---------- */
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
      var v = attrs[k];
      if (v == null) continue;
      if (k === 'text') e.textContent = v; else e.setAttribute(k, v);
    }
    return e;
  }
  function mks(tag, attrs) {
    var e = doc.createElementNS(SVGNS, tag);
    if (attrs) for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (v == null) continue;
      e.setAttribute(k, v);
    }
    return e;
  }
  function clear(node) { while (node && node.firstChild) node.removeChild(node.firstChild); }
  function ensureStyle(id, css) {
    if (doc.getElementById(id)) return;
    var s = mk('style');
    s.id = id;
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
    if (l !== 'en' && l !== 'zh') {
      l = (doc.documentElement && doc.documentElement.lang === 'en') ? 'en' : 'zh';
    }
    return l;
  }
  function tpl(s, map) {
    return s.replace(/\{(\w+)\}/g, function (_, k) { return map[k] == null ? '' : String(map[k]); });
  }
  function safeStub() {
    return {
      version: '1.0.0', update: function () {}, highlight: function () {},
      resize: function () {}, destroy: function () {}, setLang: function () {},
      getState: function () { return null; }
    };
  }
  function watchResize(el, cb) {
    var raf = 0;
    var run = function () {
      if (raf) return;
      raf = W.requestAnimationFrame ? W.requestAnimationFrame(function () { raf = 0; cb(); }) : (cb(), 0);
    };
    if (typeof W.ResizeObserver === 'function') {
      var ro = new W.ResizeObserver(run);
      ro.observe(el);
      return { disconnect: function () { if (raf && W.cancelAnimationFrame) W.cancelAnimationFrame(raf); raf = 0; ro.disconnect(); } };
    }
    W.addEventListener('resize', run);
    W.addEventListener('orientationchange', run);
    return {
      disconnect: function () {
        if (raf && W.cancelAnimationFrame) W.cancelAnimationFrame(raf);
        raf = 0;
        W.removeEventListener('resize', run);
        W.removeEventListener('orientationchange', run);
      }
    };
  }

  /* ---------- 文案 ---------- */
  var DICT = {
    zh: {
      group: '五度螺旋：12 步纯五度无法回到起点',
      start: '起点',
      gap: '缺口 {v} 音分',
      caption: '{n} 步五度累积 {cum} 音分 = {oct} 个八度 + {rem} 音分；终点与起点相差 {gap} 音分（红虚线）',
      empty: '暂无音律数据',
      ghostCaption: '底图：{n} 步完整螺旋（低透明度）；已揭示 {rev}/{n} 步 · 起点与终点相差 {gap} 音分',
      announce: '第 {i} 步 {name}：累计 {cum} 音分{extra}'
    },
    en: {
      group: 'Circle of fifths spiral: twelve pure fifths do not close',
      start: 'origin',
      gap: 'gap {v} cents',
      caption: '{n} stacked fifths = {cum} cents = {oct} octaves + {rem} cents; the end point misses the origin by {gap} cents (red dashed line)',
      empty: 'No tuning data',
      ghostCaption: 'Preview: full {n}-step spiral (faded); revealed {rev}/{n} · end misses the origin by {gap} cents',
      announce: 'Step {i}, {name}: {cum} cents cumulative{extra}'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }

  var CSS = [
    '.vz-spiral{position:relative;display:flex;flex-direction:column;gap:6px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-spiral-stage{position:relative;flex:1 1 auto;width:100%;min-height:180px;overflow:hidden;}',
    '.vz-spiral-svg{position:absolute;inset:0;width:100%;height:100%;display:block;}',
    '.vz-spiral-overlay{position:absolute;inset:0;pointer-events:none;}',
    '.vz-spiral-node{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;padding:0;border:0;border-radius:50%;',
    'background:transparent;pointer-events:auto;cursor:pointer;color:inherit;-webkit-tap-highlight-color:transparent;}',
    '.vz-spiral-node:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:1px;}',
    '.vz-spiral-spoke{stroke:var(--c-cyan,#6E8FA3);stroke-opacity:.16;stroke-width:1;}',
    '.vz-spiral-path{fill:none;stroke:var(--c-cyan,#6E8FA3);stroke-width:2;stroke-linecap:round;stroke-linejoin:round;stroke-opacity:.72;}',
    '.vz-spiral-hi{fill:none;stroke:var(--c-bronze,#C8A35A);stroke-width:3.2;stroke-linecap:round;stroke-linejoin:round;opacity:0;transition:opacity 160ms linear;}',
    '.vz-spiral-hi.is-on{opacity:1;}',
    '.vz-spiral-path.is-ghost{stroke-opacity:.26;}',
    '.vz-spiral-rev{fill:none;stroke:var(--c-cyan,#6E8FA3);stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round;}',
    '.vz-spiral-pt.is-ghost{opacity:.4;}',
    '.vz-spiral-lbl.is-ghost{opacity:.48;font-weight:400;}',
    '.vz-spiral-pt{transition:opacity 160ms linear;}',
    '.vz-spiral.has-active .vz-spiral-pt:not(.is-active){opacity:.4;}',
    '.vz-spiral-pt .dot{fill:var(--c-ink,#0B0D10);stroke:var(--c-cyan,#6E8FA3);stroke-width:2;}',
    '.vz-spiral-pt.is-active .dot{fill:var(--c-bronze,#C8A35A);stroke:var(--c-light,#F0ECE2);stroke-width:2.4;}',
    '.vz-spiral-lbl{fill:var(--c-light,#F0ECE2);font-size:11px;font-family:inherit;opacity:.88;',
    'paint-order:stroke;stroke:var(--c-ink,#0B0D10);stroke-width:3px;stroke-linejoin:round;}',
    '.vz-spiral-pt.is-active .vz-spiral-lbl{fill:var(--c-bronze,#C8A35A);opacity:1;font-weight:700;}',
    '.vz-spiral-center{fill:var(--c-light,#F0ECE2);opacity:.55;}',
    '.vz-spiral-gap{fill:none;stroke:var(--c-red,#C0392B);stroke-width:2;stroke-dasharray:5 5;stroke-linecap:round;}',
    '.vz-spiral-gap-dot{fill:var(--c-red,#C0392B);}',
    '.vz-spiral-gap-label{fill:#E0604F;font-size:12px;font-weight:700;font-family:inherit;',
    'paint-order:stroke;stroke:var(--c-ink,#0B0D10);stroke-width:4px;stroke-linejoin:round;}',
    '.vz-spiral-caption{margin:0;font-size:12px;line-height:1.5;opacity:.86;}',
    '.vz-spiral.is-empty .vz-spiral-svg{display:none;}',
    '.vz-spiral.is-empty .vz-spiral-caption{opacity:.6;}',
    '.vz-spiral.is-playing .vz-spiral-pt.is-active .dot{animation:vz-spiral-pulse 1.4s ease-in-out infinite;}',
    '@keyframes vz-spiral-pulse{0%,100%{stroke-width:2px;}50%{stroke-width:4px;stroke-opacity:.5;}}',
    '.vz-rm .vz-spiral-pt,.vz-rm .vz-spiral-hi{transition:none;}',
    '.vz-rm .vz-spiral-pt.is-active .dot{animation:none;}',
    '@media (prefers-reduced-motion: reduce){',
    '.vz-spiral-pt,.vz-spiral-hi{transition:none;}',
    '.vz-spiral-pt.is-active .dot{animation:none;}}',
    '.vz-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0;}'
  ].join('');

  function smoothPath(pts) {
    if (!pts || !pts.length) return '';
    if (pts.length === 1) return 'M' + fmt(pts[0].x, 1) + ' ' + fmt(pts[0].y, 1);
    var d = 'M' + fmt(pts[0].x, 1) + ' ' + fmt(pts[0].y, 1);
    for (var i = 0; i < pts.length - 1; i++) {
      var p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
      var c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
      var c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
      d += 'C' + fmt(c1x, 1) + ' ' + fmt(c1y, 1) + ' ' + fmt(c2x, 1) + ' ' + fmt(c2y, 1) +
        ' ' + fmt(p2.x, 1) + ' ' + fmt(p2.y, 1);
    }
    return d;
  }

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
    if (container.__vizSpiral5th) { try { container.__vizSpiral5th.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);

    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);
    var state = { steps: [], previewSteps: [], closureCents: NaN, playing: false };
    var active = null, nodes = [], pts = [], deltas = [], destroyed = false;
    var ro = null, live = null, onSelect = (typeof opts.onSelect === 'function') ? opts.onSelect : null;

    /* ---------- DOM ---------- */
    clear(container);
    var root = mk('div', 'vz-spiral' + (reduced ? ' vz-rm' : '') + (reduced ? ' hi-static' : ''));
    root.setAttribute('role', 'group');
    var stage = mk('div', 'vz-spiral-stage');
    var svg = mks('svg', { 'class': 'vz-spiral-svg', 'aria-hidden': 'true', focusable: 'false' });
    var gSpokes = mks('g'), gPath = mks('path', { 'class': 'vz-spiral-path', d: '' });
    var gHi = mks('path', { 'class': 'vz-spiral-hi', d: '' });
    var gRev = mks('path', { 'class': 'vz-spiral-rev', d: '' });
    var gNodes = mks('g'), gGap = mks('g'), gCenter = mks('g');
    svg.appendChild(gSpokes); svg.appendChild(gPath); svg.appendChild(gRev); svg.appendChild(gHi);
    svg.appendChild(gNodes); svg.appendChild(gGap); svg.appendChild(gCenter);
    var overlay = mk('div', 'vz-spiral-overlay');
    stage.appendChild(svg); stage.appendChild(overlay);
    var caption = mk('p', 'vz-spiral-caption');
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(stage); root.appendChild(caption); root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }
    function announce(msg) { if (live) live.textContent = msg; }

    /* 像素几何：不用固定 viewBox，文字/线宽就是真实像素，缩放后仍清晰 */
    function geom() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return null;
      var m = Math.min(w, h);
      return {
        w: w, h: h, cx: w / 2, cy: h / 2,
        r0: Math.max(26, m * 0.13), rMax: Math.max(56, m * 0.42)
      };
    }

    /* 标签避让：近似矩形碰撞，沿径向逐级外推（不做力导向，确定性结果） */
    function placeLabels(items, g) {
      var placed = [];
      function hit(c, list) {
        for (var i = 0; i < list.length; i++) {
          var o = list[i];
          if (Math.abs(c.x - o.x) < (c.w + o.w) / 2 - 1 &&
              Math.abs(c.y - o.y) < (c.h + o.h) / 2 - 1) return true;
        }
        return false;
      }
      /* 先放缺口标签（优先级最高），再按半径从外到内放点名 */
      items.sort(function (a, b) {
        if (!!a.priority !== !!b.priority) return a.priority ? -1 : 1;
        return (b.r || 0) - (a.r || 0);
      });
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var textW = Math.min(130, it.text.length * 6.4 + 6);
        var cand = null;
        for (var attempt = 0; attempt < 3; attempt++) {
          var off = (it.baseOff || 17) + attempt * 10;
          var lx = clamp(it.x + it.dx * off, textW / 2 + 2, g.w - textW / 2 - 2);
          var ly = clamp(it.y + it.dy * off, 9, g.h - 9);
          var c = { x: lx, y: ly, w: textW, h: 13 };
          if (!hit(c, placed)) { cand = c; break; }
          cand = c;
        }
        it.lx = cand.x; it.ly = cand.y;
        placed.push(cand);
        it.el.setAttribute('x', fmt(cand.x, 1));
        it.el.setAttribute('y', fmt(cand.y, 1));
      }
    }

    /* ---------- 渲染（数据 + 像素尺寸 → 几何） ---------- */
    function render() {
      if (destroyed) return;
      var g = geom();
      var dd = D();
      var full = state.previewSteps.length ? state.previewSteps : state.steps;
      var nFull = full.length;
      var nRev = state.previewSteps.length ? Math.min(state.steps.length, nFull) : nFull;
      var ghostMode = state.previewSteps.length > 0 && nRev < nFull;
      root.setAttribute('aria-label', dd.group);
      clear(overlay); clear(gSpokes); clear(gNodes); clear(gGap); clear(gCenter);
      nodes = []; pts = []; deltas = [];
      gHi.setAttribute('d', ''); gHi.classList.remove('is-on');
      gPath.setAttribute('d', ''); gPath.classList.remove('is-ghost');
      if (gRev) { gRev.setAttribute('d', ''); gRev.style.display = 'none'; }
      svg.setAttribute('viewBox', g ? ('0 0 ' + g.w + ' ' + g.h) : '0 0 360 360');
      root.classList.toggle('is-empty', !g || !nFull);
      if (!g || !nFull) { caption.textContent = dd.empty; return; }

      /* 1) 每步音分增量 → 角度；数据缺失时均分兜底（仅几何兜底，非律制值） */
      var cum = 0;
      for (var i = 0; i < nFull; i++) {
        var c = num(full[i].cents, NaN);
        var prev = i === 0 ? 0 : num(full[i - 1].cents, NaN);
        var raw = (i === 0) ? c : (c - prev);
        var d;
        if (isFinite(raw)) d = ((raw % 1200) + 1200) % 1200;
        else d = 1200 / nFull;
        deltas.push(d);
        cum += d;
        var deg = -90 + (cum / 1200) * 360;
        var r = nFull === 1 ? (g.r0 + g.rMax) / 2 : (g.r0 + (g.rMax - g.r0) * (i / (nFull - 1)));
        pts.push({ x: g.cx + r * Math.cos(deg * DEG), y: g.cy + r * Math.sin(deg * DEG), r: r, deg: deg });
      }

      /* 2) 辐条 + 完整路径（ghost 模式下降透明度，另画已揭示段） */
      for (var j = 0; j < nFull; j++) {
        gSpokes.appendChild(mks('line', {
          'class': 'vz-spiral-spoke', x1: fmt(g.cx, 1), y1: fmt(g.cy, 1),
          x2: fmt(pts[j].x, 1), y2: fmt(pts[j].y, 1)
        }));
      }
      gPath.setAttribute('d', smoothPath(pts));
      if (ghostMode) {
        gPath.classList.add('is-ghost');
        if (gRev && nRev >= 2) {
          gRev.style.display = '';
          gRev.setAttribute('d', smoothPath(pts.slice(0, nRev)));
        }
      }

      /* 3) 中心起点标记 */
      gCenter.appendChild(mks('circle', { 'class': 'vz-spiral-center', cx: fmt(g.cx, 1), cy: fmt(g.cy, 1), r: 3 }));
      var labelItems = [];
      var startLbl = mks('text', { 'class': 'vz-spiral-lbl', x: fmt(g.cx + 9, 1), y: fmt(g.cy + 15, 1), 'font-size': '10.5' });
      startLbl.appendChild(doc.createTextNode(dd.start));
      gCenter.appendChild(startLbl);
      labelItems.push({
        el: startLbl, x: g.cx + 9, y: g.cy + 15, dx: 0, dy: 0,
        text: dd.start, r: 0, baseOff: 0, priority: false
      });

      /* 4) 点 + 名称标签：已揭示 = 正常；未揭示 = 低透明度 ghost（仅视觉，不进 Tab） */
      for (var k = 0; k < nFull; k++) {
        var st = full[k] || {};
        var revealed = k < nRev;
        var gpt = mks('g', {
          'class': 'vz-spiral-pt' + (revealed ? '' : ' is-ghost'), 'data-i': k,
          'aria-hidden': 'true'
        });
        var dot = mks('circle', { 'class': 'dot', cx: fmt(pts[k].x, 1), cy: fmt(pts[k].y, 1), r: revealed ? 5.5 : 4.5 });
        var name = (st.name != null) ? String(st.name) : ('#' + (k + 1));
        var short = name.length > 8 ? (name.slice(0, 8) + '…') : name;
        var dx = pts[k].x - g.cx, dy = pts[k].y - g.cy;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var lbl = mks('text', {
          'class': 'vz-spiral-lbl' + (revealed ? '' : ' is-ghost'),
          x: fmt(pts[k].x, 1), y: fmt(pts[k].y, 1),
          'text-anchor': 'middle', 'dominant-baseline': 'middle'
        });
        lbl.appendChild(doc.createTextNode(short));
        gpt.appendChild(dot); gpt.appendChild(lbl);
        gNodes.appendChild(gpt);
        nodes.push({
          g: gpt, dot: dot, label: lbl, x: pts[k].x, y: pts[k].y,
          revealed: revealed, name: name
        });
        labelItems.push({
          el: lbl, x: pts[k].x, y: pts[k].y, dx: dx / len, dy: dy / len,
          text: short, r: pts[k].r, baseOff: 17, priority: (k === nFull - 1)
        });
      }

      /* 5) 缺口：终点 → 起点 红虚线 + 数值 */
      var gap = num(state.closureCents, NaN);
      var total = cum;
      var computedGap = total - 1200 * Math.floor(total / 1200);
      if (computedGap > 600) computedGap -= 1200;
      if (!isFinite(gap)) gap = computedGap;
      var last = pts[nFull - 1], first = pts[0];
      gGap.appendChild(mks('path', {
        'class': 'vz-spiral-gap',
        d: 'M' + fmt(last.x, 1) + ' ' + fmt(last.y, 1) + ' L' + fmt(first.x, 1) + ' ' + fmt(first.y, 1)
      }));
      var mx = (last.x + first.x) / 2, my = (last.y + first.y) / 2;
      var vx = mx - g.cx, vy = my - g.cy, vlen = Math.sqrt(vx * vx + vy * vy) || 1;
      var gapLbl = mks('text', {
        'class': 'vz-spiral-gap-label', x: fmt(mx, 1), y: fmt(my, 1),
        'text-anchor': 'middle', 'dominant-baseline': 'middle'
      });
      gapLbl.appendChild(doc.createTextNode(tpl(dd.gap, { v: fmt(gap, 2) })));
      gGap.appendChild(gapLbl);
      gGap.appendChild(mks('circle', { 'class': 'vz-spiral-gap-dot', cx: fmt(last.x, 1), cy: fmt(last.y, 1), r: 3.4 }));
      labelItems.push({
        el: gapLbl, x: mx, y: my, dx: vx / vlen, dy: vy / vlen,
        text: tpl(dd.gap, { v: fmt(gap, 2) }), r: 0, baseOff: 26, priority: true
      });

      /* 6) 标签统一避让（含起点/点名/缺口），再画覆盖层按钮 */
      placeLabels(labelItems, g);

      /* 7) 覆盖层：只给已揭示的步建真实 <button>（Tab 可达、键盘 ←→、读屏有名字） */
      for (var b = 0; b < nRev; b++) {
        var step = state.steps[b] || full[b] || {};
        var sname = (step.name != null) ? String(step.name) : ('#' + (b + 1));
        var stepCum = 0;
        for (var q = 0; q <= b; q++) stepCum += deltas[q];
        var hz = num(step.hz, NaN);
        var albl = tpl(dd.announce, {
          i: (nFull > 1 && Math.abs(num(full[0].cents, 0)) < 0.5) ? b : b + 1, name: sname, cum: fmt(stepCum, 1),
          extra: isFinite(hz) ? ('，' + fmt(hz, 2) + ' Hz') : ''
        });
        var btn = mk('button', 'vz-spiral-node');
        btn.type = 'button';
        btn.setAttribute('aria-label', albl);
        btn.setAttribute('data-i', String(b));
        btn.addEventListener('focus', onFocus(b));
        btn.addEventListener('blur', onBlur);
        btn.addEventListener('mouseenter', onFocus(b));
        btn.addEventListener('mouseleave', onBlur);
        btn.addEventListener('click', onPick(b));
        btn.addEventListener('keydown', onKeyNav);
        overlay.appendChild(btn);
        if (nodes[b]) {
          nodes[b].btn = btn;
          nodes[b].cum = stepCum;
          nodes[b].hz = hz;
        }
      }

      /* 8) 说明文字：首点若为起点（增量≈0），「步数」按 n-1 计，避免把起点算成一步 */
      var oct = Math.floor(total / 1200);
      var rem = total - oct * 1200;
      var originFirst = (nFull > 1 && isFinite(deltas[0]) && Math.abs(deltas[0]) < 0.5);
      var stepCount = originFirst ? nFull - 1 : nFull;
      if (ghostMode) {
        caption.textContent = tpl(dd.ghostCaption, {
          n: stepCount, rev: Math.max(0, nRev - (originFirst ? 1 : 0)), gap: fmt(gap, 2)
        });
      } else {
        caption.textContent = tpl(dd.caption, {
          n: stepCount, cum: fmt(total, 2), oct: oct, rem: fmt(rem, 2), gap: fmt(gap, 2)
        });
      }
      if (reduced || !state.playing) root.classList.remove('is-playing');
      applyActive();
      place();
    }

    /* ---------- 交互 ---------- */
    function onFocus(i) {
      return function () {
        if (destroyed) return;
        highlight(i);
        var nd = nodes[i];
        if (nd && nd.btn) announce(nd.btn.getAttribute('aria-label'));
      };
    }
    function onBlur() {
      if (destroyed) return;
      if (doc.activeElement && overlay.contains(doc.activeElement)) return;
      highlight(null);
    }
    function onPick(i) {
      return function (ev) {
        if (destroyed) return;
        if (ev && ev.preventDefault) ev.preventDefault();
        highlight(i);
        if (onSelect) { try { onSelect(i); } catch (e) {} }
      };
    }
    function onKeyNav(ev) {
      if (destroyed || !ev) return;
      var n = state.steps.length;
      if (!n) return;
      var cur = num(ev.currentTarget && ev.currentTarget.getAttribute('data-i'), -1);
      var nxt = -1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nxt = (cur + 1) % n;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nxt = (cur - 1 + n) % n;
      else if (ev.key === 'Home') nxt = 0;
      else if (ev.key === 'End') nxt = n - 1;
      else if (ev.key === 'Escape') {
        highlight(null);
        if (ev.currentTarget) ev.currentTarget.blur();
        if (ev.preventDefault) ev.preventDefault();
        return;
      } else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        if (ev.preventDefault) ev.preventDefault();
        onPick(cur)();
        return;
      }
      if (nxt >= 0 && nodes[nxt] && nodes[nxt].btn) {
        if (ev.preventDefault) ev.preventDefault();
        nodes[nxt].btn.focus();
      }
    }

    function applyActive() {
      var has = active != null && active >= 0 && active < state.steps.length;
      root.classList.toggle('has-active', has);
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].g) nodes[i].g.classList.toggle('is-active', has && i === active);
      }
      if (has) {
        var sub = nodes.slice(0, active + 1).map(function (o) { return { x: o.x, y: o.y }; });
        gHi.setAttribute('d', smoothPath(sub));
        gHi.classList.add('is-on');
      } else {
        gHi.classList.remove('is-on');
        gHi.setAttribute('d', '');
      }
      if (reduced || !state.playing) root.classList.remove('is-playing');
      else root.classList.add('is-playing');
    }

    function highlight(i) {
      if (destroyed) return;
      var n = state.steps.length;
      if (i == null || !isFinite(+i)) active = null;
      else {
        var k = Math.round(+i);
        active = (k < 0 || k >= n) ? null : k;
      }
      applyActive();
    }

    /* 覆盖层按钮与像素坐标 1:1（无 viewBox 缩放） */
    function place() {
      if (destroyed || !nodes.length) return;
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        if (!nd.btn) continue;
        nd.btn.style.left = nd.x.toFixed(1) + 'px';
        nd.btn.style.top = nd.y.toFixed(1) + 'px';
      }
    }

    function layout() { render(); }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var arr = Array.isArray(next.steps) ? next.steps : [];
      state.steps = arr.filter(function (s) { return s && typeof s === 'object'; }).slice(0, 64);
      var pv = Array.isArray(next.previewSteps) ? next.previewSteps : (Array.isArray(opts.previewSteps) ? opts.previewSteps : []);
      state.previewSteps = pv.filter(function (s) { return s && typeof s === 'object'; }).slice(0, 64);
      state.closureCents = num(next.closureCents, NaN);
      state.playing = !!next.playing;
      if (next.active === null) active = null;
      else if (isNum(next.active)) active = clamp(Math.round(next.active), 0, Math.max(0, state.steps.length - 1));
      render();
    }

    function destroy() {
      destroyed = true;
      if (ro) { ro.disconnect(); ro = null; }
      container.__vizSpiral5th = null;
      clear(container);
      nodes = []; pts = [];
    }

    function setLang(l) { lang = (l === 'en') ? 'en' : 'zh'; render(); }

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: layout,
      destroy: destroy,
      setLang: setLang,
      getState: function () {
        return { steps: state.steps.slice(), previewSteps: state.previewSteps.slice(), closureCents: state.closureCents, active: active };
      }
    };
    container.__vizSpiral5th = inst;
    ro = watchResize(stage, layout);
    render();
    return inst;
  }

  Viz.spiral5th = { version: '1.0.0', init: init };
})();
