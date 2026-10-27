/* =============================================================================
 * 同律 CONCORD · viz/worldmap.js
 * -----------------------------------------------------------------------------
 * 用途：
 *   世界律制地图（M5）。极简世界轮廓（SVG 自绘简化大陆轮廓，无任何位图/第三方
 *   地图数据）+ 各律制文化区域点；点击区域点或下方列表项切换选中并回调。
 *   区域坐标由 app 的 data 传入，支持三种坐标口径（自动识别 / 可强制指定）：
 *     - lonlat：x=经度[-180,180]，y=纬度[-90,90]（推荐，等距圆柱投影）
 *     - norm  ：x,y ∈ [0,1] 的归一化平面坐标
 *     - px    ：以 1000×500 设计画布为基准的坐标
 *   组件不内置任何律制数值；轮廓仅为地理示意（非测绘精度，不作地理断言）。
 *
 * API：
 *   var inst = Viz.worldmap.init(el, opts);
 *     opts : { lang:'zh'|'en', reducedMotion:boolean,
 *              coord:'auto'|'lonlat'|'norm'|'px',   // 默认 auto
 *              onSelect(id) }
 *   inst.update(state)
 *   inst.highlight(i|null)       // 程序化选中第 i 条（不触发 onSelect）
 *   inst.resize() / inst.destroy() / inst.setLang(lang)
 *
 * state 契约：
 *   {
 *     entries: [{ id:string, name_zh:string, name_en:string, culture:string,
 *                 region:{x:number, y:number} }],
 *     selected: string            // 选中 entry 的 id
 *   }
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
  var Viz = W.Viz = W.Viz || {};
  if (Viz.worldmap) return;

  var SVGNS = 'http://www.w3.org/2000/svg';
  var STYLE_ID = 'vz-worldmap-style';

  /* ---------- 工具 ---------- */
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function num(v, d) { var n = typeof v === 'number' ? v : parseFloat(v); return isFinite(n) ? n : d; }
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
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

  /* ---------- 极简大陆轮廓（[lon,lat] 折线，程序化投影；仅地理示意） ---------- */
  var LAND = [
    [[-168, 65], [-160, 70], [-145, 70], [-130, 70], [-115, 69], [-100, 69], [-85, 70], [-80, 63],
      [-64, 60], [-55, 52], [-66, 45], [-70, 42], [-75, 36], [-81, 26], [-84, 30], [-90, 29], [-97, 26],
      [-105, 22], [-110, 24], [-114, 30], [-120, 34], [-124, 40], [-124, 48], [-132, 55], [-145, 60], [-160, 58]],
    [[-97, 16], [-92, 15], [-84, 10], [-78, 8], [-77, 7], [-83, 13], [-88, 17], [-93, 18]],
    [[-45, 60], [-55, 68], [-60, 76], [-46, 83], [-28, 82], [-20, 72], [-32, 60]],
    [[-81, 8], [-76, 11], [-66, 11], [-60, 9], [-52, 5], [-50, 0], [-44, -3], [-38, -8], [-35, -14],
      [-39, -22], [-48, -25], [-54, -34], [-58, -39], [-62, -41], [-65, -47], [-68, -52], [-70, -55],
      [-73, -51], [-72, -42], [-71, -30], [-70, -18], [-75, -10], [-78, -2]],
    [[-17, 21], [-16, 12], [-8, 5], [0, 5], [6, 4], [9, 4], [9, -1], [12, -6], [13, -17], [15, -27],
      [18, -34], [25, -34], [32, -29], [35, -24], [40, -16], [40, -2], [43, 12], [37, 22], [34, 28],
      [32, 31], [25, 32], [11, 33], [0, 36], [-6, 36], [-10, 30]],
    [[-10, 36], [-9, 44], [-2, 43], [2, 50], [8, 54], [10, 58], [8, 63], [15, 68], [30, 71], [45, 68],
      [60, 72], [75, 75], [90, 76], [105, 76], [120, 74], [135, 72], [150, 70], [165, 69], [180, 65],
      [180, 61], [160, 60], [145, 55], [140, 45], [130, 42], [125, 33], [120, 23], [108, 19], [105, 10],
      [100, 2], [95, 8], [90, 22], [84, 8], [80, 8], [76, 8], [70, 20], [66, 24], [58, 26], [52, 24],
      [48, 30], [42, 37], [36, 37], [30, 41], [26, 40], [22, 38], [18, 41], [12, 45], [7, 44], [3, 43]],
    [[113, -22], [114, -32], [122, -34], [129, -32], [137, -35], [145, -38], [150, -35], [153, -28],
      [146, -18], [142, -11], [136, -12], [130, -11], [125, -14], [115, -20]],
    [[-180, -72], [-150, -74], [-120, -74], [-90, -73], [-60, -70], [-30, -72], [0, -70], [30, -70],
      [60, -70], [90, -70], [120, -70], [150, -72], [180, -72], [180, -86], [-180, -86]],
    [[130, 32], [132, 34], [136, 35], [140, 38], [142, 42], [145, 44], [141, 42], [137, 37], [133, 34]],
    [[-6, 50], [-5, 55], [-3, 58], [0, 57], [1, 53], [0, 51], [-3, 50]],
    [[-24, 64], [-18, 66], [-14, 65], [-18, 63]],
    [[43, -12], [50, -15], [50, -25], [45, -25]],
    [[172, -34], [178, -38], [174, -42], [167, -46], [166, -45]],
    [[95, 5], [100, 2], [106, -6], [102, -5], [96, 2]],
    [[105, -6], [114, -8], [114, -9], [105, -7]],
    [[109, 2], [117, 4], [119, -2], [113, -4], [109, 0]],
    [[131, -1], [141, -3], [150, -6], [147, -9], [138, -8]],
    [[80, 9], [82, 7], [80, 6], [79, 8]]
  ];

  /* ---------- 文案 ---------- */
  var DICT = {
    zh: {
      group: '世界律制地图',
      mapLabel: '世界律制分布示意地图（装饰性轮廓，非测绘精度）',
      listGroup: '律制条目（单选，方向键切换）',
      item: '{name}，{culture}',
      tip: '{name} · {culture}',
      empty: '暂无律制条目',
      hint: '点按地图区域点或下方条目切换；←→ 在列表内切换，Enter 选中',
      selected: '已选择 {name}（{culture}）'
    },
    en: {
      group: 'Map of tuning systems worldwide',
      mapLabel: 'Stylised world map of tuning systems (decorative outline, not a survey map)',
      listGroup: 'Tuning systems (single select, arrow keys)',
      item: '{name}, {culture}',
      tip: '{name} · {culture}',
      empty: 'No entries',
      hint: 'Click a region dot or a list item; ←→ moves within the list, Enter selects',
      selected: '{name} selected ({culture})'
    }
  };
  function dict(lang) { return DICT[lang === 'en' ? 'en' : 'zh']; }
  var PALETTE = ['var(--c-bronze,#C8A35A)', 'var(--c-cyan,#6E8FA3)', '#8FA98B', '#B08A6E', '#9C9AA8', '#7FA3A0', '#C0A0A0'];

  var CSS = [
    '.vz-map{position:relative;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-height:0;',
    'color:var(--c-light,#F0ECE2);font-family:var(--font-ui,"Segoe UI","Microsoft YaHei",system-ui,sans-serif);font-size:13px;line-height:1.45;}',
    '.vz-map-stage{position:relative;flex:1 1 auto;width:100%;min-height:170px;overflow:hidden;}',
    '.vz-map-svg{position:absolute;inset:0;width:100%;height:100%;display:block;}',
    '.vz-map-overlay{position:absolute;inset:0;pointer-events:none;}',
    '.vz-map-hit{cursor:pointer;}',
    '.vz-map-hit circle.hit{fill:transparent;stroke:none;}',
    '.vz-map-land{fill:rgba(240,236,226,.07);stroke:rgba(240,236,226,.2);stroke-width:1;stroke-linejoin:round;}',
    '.vz-map-grid{stroke:rgba(240,236,226,.09);stroke-width:1;fill:none;}',
    '.vz-map-grid-major{stroke:rgba(240,236,226,.14);}',
    '.vz-map-dot{fill:var(--c-cyan,#6E8FA3);stroke:var(--c-ink,#0B0D10);stroke-width:1.5;transition:r 140ms ease, fill 140ms linear;}',
    '.vz-map-dot.is-selected{fill:var(--c-bronze,#C8A35A);}',
    '.vz-map-ring{fill:none;stroke:var(--c-bronze,#C8A35A);stroke-width:2;opacity:0;transition:opacity 140ms linear;}',
    '.vz-map-ring.is-on{opacity:1;animation:vz-map-pulse 1.8s ease-in-out infinite;}',
    '@keyframes vz-map-pulse{0%,100%{stroke-opacity:1;}50%{stroke-opacity:.35;}}',
    '.vz-map-tip{position:absolute;left:0;top:0;transform:translate(-50%,-140%);pointer-events:none;',
    'background:rgba(11,13,16,.94);border:1px solid rgba(200,163,90,.5);border-radius:6px;padding:3px 8px;',
    'font-size:11.5px;white-space:nowrap;color:var(--c-light,#F0ECE2);box-shadow:0 4px 14px rgba(0,0,0,.45);',
    'opacity:0;transition:opacity 120ms linear;}',
    '.vz-map-tip.is-on{opacity:1;}',
    '.vz-map-list{display:flex;flex-wrap:wrap;gap:6px;}',
    '.vz-map-item{display:inline-flex;align-items:center;gap:6px;font:inherit;font-size:12px;',
    'color:var(--c-light,#F0ECE2);background:rgba(240,236,226,.05);border:1px solid rgba(240,236,226,.18);',
    'border-radius:6px;padding:3px 9px;cursor:pointer;line-height:1.5;transition:border-color 120ms linear, background-color 120ms linear;}',
    '.vz-map-item:hover{border-color:var(--c-bronze,#C8A35A);background:rgba(200,163,90,.1);}',
    '.vz-map-item:focus-visible{outline:2px solid var(--c-light,#F0ECE2);outline-offset:1px;}',
    '.vz-map-item[aria-checked="true"]{border-color:var(--c-bronze,#C8A35A);background:rgba(200,163,90,.22);color:#fff;}',
    '.vz-map-item .sw{width:7px;height:7px;border-radius:50%;background:var(--dot,var(--c-cyan,#6E8FA3));flex:0 0 auto;}',
    '.vz-map-hint{margin:0;font-size:11px;opacity:.58;line-height:1.5;}',
    '.vz-map-empty{font-size:12px;opacity:.6;padding:14px 4px;}',
    '.vz-map-rm .vz-map-dot,.vz-map-rm .vz-map-tip,.vz-map-rm .vz-map-ring{transition:none;}',
    '.vz-map-rm .vz-map-ring.is-on{animation:none;}',
    '@media (prefers-reduced-motion: reduce){.vz-map-dot,.vz-map-tip,.vz-map-ring{transition:none;}',
    '.vz-map-ring.is-on{animation:none;}}',
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
    if (container.__vizWorldmap) { try { container.__vizWorldmap.destroy(); } catch (e) {} }
    opts = opts || {};
    ensureStyle(STYLE_ID, CSS);
    var lang = pickLang(opts);
    var reduced = !motionAllowed(opts);
    var coordMode = (opts.coord === 'lonlat' || opts.coord === 'norm' || opts.coord === 'px') ? opts.coord : 'auto';
    var onSelect = (typeof opts.onSelect === 'function') ? opts.onSelect : null;

    var state = { entries: [], selected: null };
    var dots = [], itemEls = [], destroyed = false, ro = null, live = null;
    var stage = null, svg = null, overlay = null, tip = null, listEl = null, hintEl = null, emptyEl = null;

    clear(container);
    var root = mk('div', 'vz-map' + (reduced ? ' vz-map-rm' : ''));
    root.setAttribute('role', 'group');
    stage = mk('div', 'vz-map-stage');
    stage.setAttribute('role', 'img');
    svg = mks('svg', { 'class': 'vz-map-svg', 'aria-hidden': 'true', focusable: 'false' });
    overlay = mk('div', 'vz-map-overlay');
    tip = mk('div', 'vz-map-tip');
    tip.setAttribute('aria-hidden', 'true');
    stage.appendChild(svg); stage.appendChild(overlay);
    var bottom = mk('div', 'vz-map-bottom');
    listEl = mk('div', 'vz-map-list');
    listEl.setAttribute('role', 'radiogroup');
    hintEl = mk('p', 'vz-map-hint');
    emptyEl = mk('div', 'vz-map-empty');
    bottom.appendChild(listEl); bottom.appendChild(hintEl);
    root.appendChild(stage); root.appendChild(emptyEl); root.appendChild(bottom);
    live = mk('div', 'vz-sr');
    live.setAttribute('aria-live', 'polite');
    live.setAttribute('aria-atomic', 'true');
    root.appendChild(live);
    container.appendChild(root);

    function D() { return dict(lang); }
    function announce(msg) { if (live) live.textContent = msg; }
    function nameOf(e) {
      if (!e) return '—';
      if (lang === 'en') return e.name_en || e.name_zh || e.name || e.id;
      return e.name_zh || e.name_en || e.name || e.id;
    }
    function cultureOf(e) { return (e && e.culture != null) ? String(e.culture) : ''; }

    /* 坐标口径识别 */
    function modeFor(region) {
      if (coordMode !== 'auto') return coordMode;
      var x = num(region.x, NaN), y = num(region.y, NaN);
      if (!isFinite(x) || !isFinite(y)) return 'px';
      if (Math.abs(x) <= 1 && Math.abs(y) <= 1) return 'norm';
      if (Math.abs(x) <= 180 && Math.abs(y) <= 90) return 'lonlat';
      return 'px';
    }
    function project(region, w, h) {
      var mh = Math.min(h, w / 2), mw = mh * 2;
      var ox = (w - mw) / 2, oy = (h - mh) / 2;
      var mode = modeFor(region);
      var x = num(region.x, 0), y = num(region.y, 0);
      if (mode === 'lonlat') {
        return { x: ox + (clamp(x, -180, 180) + 180) / 360 * mw, y: oy + (90 - clamp(y, -90, 90)) / 180 * mh, mode: mode };
      }
      if (mode === 'norm') {
        return { x: ox + clamp(x, 0, 1) * mw, y: oy + clamp(y, 0, 1) * mh, mode: mode };
      }
      return { x: ox + clamp(x / 1000, 0, 1) * mw, y: oy + clamp(y / 500, 0, 1) * mh, mode: mode };
    }
    function projectLonLat(lon, lat, w, h) {
      var mh = Math.min(h, w / 2), mw = mh * 2;
      var ox = (w - mw) / 2, oy = (h - mh) / 2;
      return { x: ox + (lon + 180) / 360 * mw, y: oy + (90 - lat) / 180 * mh };
    }

    function drawMap() {
      var w = stage.clientWidth, h = stage.clientHeight;
      if (!w || !h) return false;
      svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
      clear(svg);
      /* 经纬网 */
      var grid = mks('g');
      for (var lon = -150; lon <= 150; lon += 30) {
        var a = projectLonLat(lon, 84, w, h), b = projectLonLat(lon, -84, w, h);
        grid.appendChild(mks('line', {
          'class': 'vz-map-grid' + (lon === 0 ? ' vz-map-grid-major' : ''),
          x1: a.x.toFixed(1), y1: a.y.toFixed(1), x2: b.x.toFixed(1), y2: b.y.toFixed(1)
        }));
      }
      for (var lat = -60; lat <= 60; lat += 30) {
        var c = projectLonLat(-180, lat, w, h), d = projectLonLat(180, lat, w, h);
        grid.appendChild(mks('line', {
          'class': 'vz-map-grid' + (lat === 0 ? ' vz-map-grid-major' : ''),
          x1: c.x.toFixed(1), y1: c.y.toFixed(1), x2: d.x.toFixed(1), y2: d.y.toFixed(1)
        }));
      }
      svg.appendChild(grid);
      /* 大陆轮廓 */
      var land = mks('g');
      for (var i = 0; i < LAND.length; i++) {
        var pts = LAND[i], dd = '';
        for (var j = 0; j < pts.length; j++) {
          var p = projectLonLat(pts[j][0], pts[j][1], w, h);
          dd += (j === 0 ? 'M' : 'L') + p.x.toFixed(1) + ' ' + p.y.toFixed(1);
        }
        land.appendChild(mks('path', { 'class': 'vz-map-land', d: dd + 'Z' }));
      }
      svg.appendChild(land);
      /* 区域点 + 选中环（SVG 指针交互；键盘/读屏走下方列表，避免重复 tab 停靠点） */
      var dotsG = mks('g');
      for (var k = 0; k < state.entries.length; k++) {
        var ent = state.entries[k];
        var pos = project(ent.region || {}, w, h);
        var sel = ent.id === state.selected;
        var hit = mks('g', { 'class': 'vz-map-hit', 'data-id': String(ent.id) });
        hit.appendChild(mks('circle', {
          'class': 'vz-map-ring' + (sel ? ' is-on' : ''),
          cx: pos.x.toFixed(1), cy: pos.y.toFixed(1), r: 10
        }));
        hit.appendChild(mks('circle', {
          'class': 'vz-map-dot' + (sel ? ' is-selected' : ''),
          cx: pos.x.toFixed(1), cy: pos.y.toFixed(1), r: sel ? 6 : 4.5,
          'data-id': String(ent.id)
        }));
        hit.appendChild(mks('circle', {
          'class': 'hit', cx: pos.x.toFixed(1), cy: pos.y.toFixed(1), r: 15
        }));
        hit.addEventListener('click', (function (id) {
          return function () { selectById(id, true); };
        })(ent.id));
        hit.addEventListener('mouseenter', (function (id) {
          return function () { showTip(id); };
        })(ent.id));
        hit.addEventListener('mouseleave', hideTip);
        dotsG.appendChild(hit);
      }
      svg.appendChild(dotsG);
      clear(overlay);
      overlay.appendChild(tip);
      /* 选中条目的提示牌 */
      if (state.selected != null) showTip(state.selected);
      else hideTip();
      return true;
    }

    function showTip(id) {
      var ent = null;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === id) ent = state.entries[i];
      if (!ent || !tip) { hideTip(); return; }
      var w = stage.clientWidth || 0, h = stage.clientHeight || 0;
      var pos = project(ent.region || {}, w, h);
      tip.textContent = tpl(D().tip, { name: nameOf(ent), culture: cultureOf(ent) });
      tip.style.left = clamp(pos.x, 60, Math.max(60, w - 60)).toFixed(1) + 'px';
      tip.style.top = clamp(pos.y, 30, Math.max(30, h - 8)).toFixed(1) + 'px';
      tip.classList.add('is-on');
    }
    function hideTip() { if (tip) tip.classList.remove('is-on'); }

    function selectedEntry() {
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === state.selected) return state.entries[i];
      return state.entries.length ? state.entries[0] : null;
    }

    function applySelection() {
      var dd = D();
      var sel = selectedEntry();
      if (!sel) { state.selected = null; }
      else if (state.selected !== sel.id) state.selected = sel.id;
      /* svg 点 */
      var dotsEls = svg.querySelectorAll('.vz-map-dot');
      var rings = svg.querySelectorAll('.vz-map-ring');
      for (var i = 0; i < dotsEls.length; i++) {
        var isSel = dotsEls[i].getAttribute('data-id') === String(state.selected);
        dotsEls[i].classList.toggle('is-selected', isSel);
        dotsEls[i].setAttribute('r', isSel ? '6' : '4.5');
        rings[i].classList.toggle('is-on', isSel);
      }
      /* 列表 */
      for (var k = 0; k < itemEls.length; k++) {
        var ent = state.entries[k];
        var on = ent && ent.id === state.selected;
        itemEls[k].setAttribute('aria-checked', on ? 'true' : 'false');
        itemEls[k].tabIndex = on ? 0 : -1;
      }
      if (state.selected != null) showTip(state.selected); else hideTip();
      if (sel && hintEl) hintEl.textContent = tpl(dd.selected, { name: nameOf(sel), culture: cultureOf(sel) }) + ' · ' + dd.hint;
    }

    function selectById(id, fire) {
      if (destroyed) return;
      var changed = id !== state.selected;
      state.selected = id;
      applySelection();
      var sel = selectedEntry();
      if (sel) announce(tpl(D().selected, { name: nameOf(sel), culture: cultureOf(sel) }));
      if (changed && fire && onSelect) { try { onSelect(id); } catch (e) {} }
    }

    function onItemKey(ev) {
      if (destroyed || !ev) return;
      var n = state.entries.length;
      if (!n) return;
      var i = itemEls.indexOf(ev.currentTarget);
      if (i < 0) i = 0;
      var nxt = -1;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') nxt = (i + 1) % n;
      else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') nxt = (i - 1 + n) % n;
      else if (ev.key === 'Home') nxt = 0;
      else if (ev.key === 'End') nxt = n - 1;
      else if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
        if (ev.preventDefault) ev.preventDefault();
        selectById(state.entries[i].id, true);
        return;
      }
      if (nxt >= 0) {
        if (ev.preventDefault) ev.preventDefault();
        selectById(state.entries[nxt].id, true);
        itemEls[nxt].focus();
      }
    }

    function buildList() {
      var dd = D();
      clear(listEl);
      itemEls = [];
      listEl.setAttribute('aria-label', dd.listGroup);
      if (!state.entries.length) {
        listEl.style.display = 'none';
        emptyEl.style.display = '';
        emptyEl.textContent = dd.empty;
        hintEl.textContent = '';
        stage.setAttribute('aria-label', dd.empty);
        return;
      }
      listEl.style.display = '';
      emptyEl.style.display = 'none';
      stage.setAttribute('aria-label', dd.mapLabel + ' · ' + dd.group + ' · ' + state.entries.length);
      for (var i = 0; i < state.entries.length; i++) {
        var ent = state.entries[i];
        var b = mk('button', 'vz-map-item');
        b.type = 'button';
        b.setAttribute('role', 'radio');
        b.setAttribute('data-i', String(i));
        b.setAttribute('aria-label', tpl(dd.item, { name: nameOf(ent), culture: cultureOf(ent) }));
        var sw = mk('span', 'sw');
        sw.setAttribute('aria-hidden', 'true');
        sw.style.setProperty('--dot', PALETTE[i % PALETTE.length]);
        b.appendChild(sw);
        b.appendChild(doc.createTextNode(nameOf(ent)));
        b.addEventListener('click', (function (id) {
          return function () { selectById(id, true); };
        })(ent.id));
        b.addEventListener('keydown', onItemKey);
        listEl.appendChild(b);
        itemEls.push(b);
      }
      hintEl.textContent = dd.hint;
    }

    function render() {
      if (destroyed) return;
      var dd = D();
      root.setAttribute('aria-label', dd.group);
      buildList();
      applySelection();
      drawMap();
    }

    function update(next) {
      if (destroyed) return;
      adoptHost(container);
      next = (next && typeof next === 'object') ? next : {};
      var arr = Array.isArray(next.entries) ? next.entries : [];
      state.entries = arr.filter(function (e) { return e && typeof e === 'object'; }).map(function (e, i) {
        var reg = (e.region && typeof e.region === 'object') ? e.region : {};
        return {
          id: (e.id != null) ? e.id : ('entry-' + i),
          name_zh: (e.name_zh != null) ? String(e.name_zh) : '',
          name_en: (e.name_en != null) ? String(e.name_en) : '',
          name: (e.name != null) ? String(e.name) : '',
          culture: (e.culture != null) ? String(e.culture) : '',
          region: { x: num(reg.x, 0), y: num(reg.y, 0), has: (reg.x != null && reg.y != null) }
        };
      }).slice(0, 200);
      var want = next.selected;
      var found = false;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i].id === want) { found = true; break; }
      if (found) state.selected = want;
      else if (state.selected == null || state.selected === undefined) state.selected = state.entries.length ? state.entries[0].id : null;
      render();
    }

    function highlight(i) {
      if (destroyed) return;
      if (i == null || !isFinite(+i)) return;
      var k = Math.round(+i);
      if (k < 0 || k >= state.entries.length) return;
      selectById(state.entries[k].id, false);
    }

    function layout() {
      if (destroyed) return;
      drawMap();
      applySelection();
    }

    function destroy() {
      destroyed = true;
      if (ro) { ro.disconnect(); ro = null; }
      container.__vizWorldmap = null;
      clear(container);
      dots = []; itemEls = [];
    }

    var inst = {
      version: '1.0.0',
      update: update,
      highlight: highlight,
      resize: layout,
      destroy: destroy,
      setLang: function (l) { lang = (l === 'en') ? 'en' : 'zh'; render(); },
      getState: function () { return { entries: state.entries.slice(), selected: state.selected }; }
    };
    container.__vizWorldmap = inst;
    ro = watchResize(stage, layout);
    var dd0 = dict(lang);
    root.setAttribute('aria-label', dd0.group);
    stage.setAttribute('aria-label', dd0.mapLabel);
    hintEl.textContent = dd0.hint;
    emptyEl.textContent = dd0.empty;
    render();
    return inst;
  }

  Viz.worldmap = { version: '1.0.0', init: init };
})();
