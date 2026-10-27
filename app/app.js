/* ============================================================================
 * app.js —《同律》CONCORD 交互层
 * ----------------------------------------------------------------------------
 * 八个模块全部由真实计算驱动：页面不内置任何律制数值表，每处音分/频率都是
 * 当场算出来的。数值优先来自协作内核 window.Tuning（kernel 交付），缺失时走
 * 本文件内置的最小实现（搜索 FALLBACK 可见每一处降级）。
 *
 * 依赖加载策略
 *   data/deps.js 是管线扫描目录生成的「可选依赖清单」。app.js 只对清单里存在的
 *   文件动态注入 <script>，因此 kernel / viz 尚未交付时页面不会产生 404 控制台
 *   错误，而是使用内置降级渲染。
 *
 * 结构
 *   0 常量与依赖 → 1 内核降级实现 → 2 音频降级实现 → 3 工具 → 4 状态
 *   → 5 可视化挂载（懒渲染）→ 6 各模块 → 7 双语 → 8 测试钩子 → 9 启动
 * ========================================================================== */
(function (W, D) {
  'use strict';

  const APP_VERSION = "1.0.0";

  /* ==================================================================
   * 0 · 常量、DOM 引用与工具
   * ================================================================== */
  const $ = (s, r) => (r || D).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || D).querySelectorAll(s));
  const T = (k, v) => W.I18N.t(k, v);
  const clamp = (v, a, b) => (v < a ? a : (v > b ? b : v));
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const LOG2 = Math.log(2);

  const A4 = 440;
  const C4 = A4 * Math.pow(2, -9 / 12);       // 261.6255653005986 Hz（黄钟）
  const ZERO = 1e-12;

  const prefersReduced = (function () {
    try { return W.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  })();

  /* ==================================================================
   * 1 · 内核（律制数学）：优先 window.Tuning，缺失则用内置等价实现
   * ================================================================== */
  const FALLBACK_KERNEL = {
    /* FALLBACK: 音分 = 1200·log2(f2/f1) */
    cents(f1, f2) {
      if (!isNum(f1) || !isNum(f2) || f1 <= 0 || f2 <= 0) return NaN;
      return 1200 * Math.log2(f2 / f1);
    },
    /* FALLBACK: 由音分推频率 */
    hz_from_cents(base, c) {
      if (!isNum(base) || !isNum(c) || base <= 0) return NaN;
      return base * Math.pow(2, c / 1200);
    },
    /* FALLBACK: 频率比 → 音分 */
    ratio_to_cents(r) {
      if (!isNum(r) || r <= 0) return NaN;
      return 1200 * Math.log2(r);
    },
    /* FALLBACK: 音分 → 频率比 */
    cents_to_ratio(c) {
      if (!isNum(c)) return NaN;
      return Math.pow(2, c / 1200);
    },
    /* FALLBACK: 折叠进 [1,2) */
    normalize_octave(r) {
      if (!isNum(r) || r <= 0) return NaN;
      let x = r;
      let guard = 0;
      while (x >= 2 && guard++ < 200) x /= 2;
      while (x < 1 && guard++ < 200) x *= 2;
      return x;
    },
    /* FALLBACK: 三分损益 12 律（黄钟起连续 ×3/2 折叠回 [1,2)） */
    sanfen_sunyi(base) {
      const b = isNum(base) && base > 0 ? base : C4;
      return SANFEN_NAMES.map((n, i) => {
        const r = FALLBACK_KERNEL.normalize_octave(Math.pow(1.5, i));
        return {
          index: i,
          name_zh: n.zh,
          name_en: n.en,
          ratio: r,
          hz: b * r,
          cents: 1200 * Math.log2(r),
          chain_cents: i * 1200 * Math.log2(1.5)
        };
      });
    },
    /* FALLBACK: 十二平均律 */
    equal_temperament(n) {
      const cnt = isNum(n) && n > 0 ? Math.round(n) : 12;
      const out = [];
      for (let i = 0; i < cnt; i++) {
        const r = Math.pow(2, i / cnt);
        out.push({ index: i, ratio: r, cents: i * 1200 / cnt, hz: C4 * r });
      }
      return out;
    },
    /* FALLBACK: 5-限纯律 */
    just_intonation() {
      const ratios = [1, 16 / 15, 9 / 8, 6 / 5, 5 / 4, 4 / 3, 45 / 32, 3 / 2, 8 / 5, 5 / 3, 9 / 5, 15 / 8];
      return ratios.map((r, i) => ({ index: i, ratio: r, cents: 1200 * Math.log2(r), hz: C4 * r }));
    },
    /* FALLBACK: 1/4 音差中庸律（五度 = 5^(1/4)） */
    meantone() {
      const FIFTH = 1200 * Math.log2(Math.pow(5, 0.25));
      const order = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5];
      const out = new Array(12);
      for (let i = 0; i < 12; i++) {
        const c = ((i * FIFTH) % 1200 + 1200) % 1200;
        out[order[i]] = { index: order[i], cents: c, ratio: Math.pow(2, c / 1200), hz: C4 * Math.pow(2, c / 1200) };
      }
      return out;
    },
    /* FALLBACK: Werckmeister III 通行音分表 */
    werckmeister_iii() {
      const cs = [0, 90.225, 192.18, 294.135, 390.225, 498.045, 588.27, 696.578, 792.18, 888.27, 996.09, 1092.18];
      return cs.map((c, i) => ({ index: i, cents: c, ratio: Math.pow(2, c / 1200), hz: C4 * Math.pow(2, c / 1200) }));
    },
    /* FALLBACK: 编钟分音（正鼓音 + 侧鼓音 + 上方整数倍，示意性近似） */
    bell_partials(f0, n) {
      const base = isNum(f0) && f0 > 0 ? f0 : 130.81;
      const cnt = isNum(n) && n > 1 ? Math.round(n) : 8;
      const sideRatio = Math.pow(2, 386.3137 / 1200);      // 侧鼓音 ≈ 大三度
      const ratios = [1, sideRatio, 2, 2.4, 3, 4, 4.8, 6, 8, 12];
      const out = [];
      for (let i = 0; i < cnt; i++) {
        const r = ratios[i % ratios.length] * (i >= ratios.length ? Math.pow(2, Math.floor(i / ratios.length)) : 1);
        out.push({ index: i, ratio: r, hz: base * r, cents: 1200 * Math.log2(r) });
      }
      return out;
    },
    /* FALLBACK: 泛音列 */
    harmonic_series(f0, n) {
      const base = isNum(f0) && f0 > 0 ? f0 : C4;
      const cnt = isNum(n) && n > 1 ? Math.round(n) : 8;
      const out = [];
      for (let i = 1; i <= cnt; i++) out.push({ n: i, hz: base * i, ratio: i, cents: 1200 * Math.log2(i) });
      return out;
    },
    /* FALLBACK: 品丝位置 d_n = L·(1 - 2^(-n/12)) */
    fret_positions(L, n) {
      const len = isNum(L) && L > 0 ? L : 650;
      const cnt = isNum(n) && n > 0 ? Math.round(n) : 12;
      const out = [];
      for (let i = 0; i <= cnt; i++) {
        out.push({ fret: i, dist: len * (1 - Math.pow(2, -i / 12)), ratio: 1 - Math.pow(2, -i / 12) });
      }
      return out;
    },
    /* FALLBACK: 拍频 */
    beat_frequency(f1, f2) {
      if (!isNum(f1) || !isNum(f2)) return NaN;
      return Math.abs(f1 - f2);
    },
    /* FALLBACK: 载入世界律制表（容忍数组或 {systems:[]}） */
    load_world_tunings(json) {
      if (!json) return [];
      const arr = Array.isArray(json) ? json : (json.systems || []);
      return arr.filter((s) => s && Array.isArray(s.cents) && s.cents.length > 1)
        .map((s) => {
          const c = s.cents.slice().map(Number).sort((a, b) => a - b);
          return Object.assign({}, s, { cents: c });
        });
    }
  };

  const SANFEN_NAMES = [
    { zh: '黄钟', en: 'Huangzhong' }, { zh: '林钟', en: 'Linzhong' },
    { zh: '太簇', en: 'Taicu' }, { zh: '南吕', en: 'Nanlü' },
    { zh: '姑洗', en: 'Guxi' }, { zh: '应钟', en: 'Yingzhong' },
    { zh: '蕤宾', en: 'Ruibin' }, { zh: '大吕', en: 'Dalü' },
    { zh: '夷则', en: 'Yize' }, { zh: '夹钟', en: 'Jiazhong' },
    { zh: '无射', en: 'Wuyi' }, { zh: '仲吕', en: 'Zhonglü' }
  ];
  const SEMI_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];

  /** 把外部内核包一层：任何抛错或非数值都退回内置实现 */
  const KERNEL_KEYS = [
    'cents', 'hz_from_cents', 'ratio_to_cents', 'cents_to_ratio', 'normalize_octave',
    'sanfen_sunyi', 'equal_temperament', 'just_intonation', 'meantone',
    'werckmeister_iii', 'bell_partials', 'harmonic_series', 'fret_positions',
    'beat_frequency', 'load_world_tunings'
  ];
  const K = (function buildKernel() {
    const ext = W.Tuning;
    const out = { __source: 'fallback' };
    let used = 0;
    KERNEL_KEYS.forEach((key) => {
      const extFn = ext && typeof ext[key] === 'function' ? ext[key] : null;
      const fbFn = FALLBACK_KERNEL[key];
      if (!fbFn) return;
      if (extFn) {
        used++;
        out[key] = function () {
          try {
            const r = extFn.apply(ext, arguments);
            if (r === undefined || r === null) return fbFn.apply(null, arguments);
            return r;
          } catch (e) {
            return fbFn.apply(null, arguments);
          }
        };
      } else {
        out[key] = fbFn;
      }
    });
    if (used) out.__source = 'kernel';
    return out;
  })();

  /* ==================================================================
   * 2 · 音频：优先 window.createSynth(ctx)，缺失则内置最小实现
   * ================================================================== */
  let ACTX = null;
  let SYNTH = null;
  let soundMuted = false;

  function audioCtor() {
    return W.AudioContext || W.webkitAudioContext || null;
  }

  /* FALLBACK: 内置最小合成器（仅在 audio/synth.js 缺失时使用） */
  function buildFallbackSynth(ctx) {
    const master = ctx.createGain();
    master.gain.value = 0.24;
    master.connect(ctx.destination);
    const live = new Set();

    function voice(freq, type, dur, gainPeak, detune) {
      if (!isNum(freq) || freq <= 0) return null;
      const t0 = ctx.currentTime;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t0);
      if (detune) osc.detune.setValueAtTime(detune, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, gainPeak || 0.2), t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.max(0.08, dur || 1));
      osc.connect(g);
      g.connect(master);
      osc.start(t0);
      osc.stop(t0 + Math.max(0.1, dur || 1) + 0.02);
      live.add(osc);
      osc.onended = () => live.delete(osc);
      return osc;
    }

    return {
      bell(f0, dur) {
        const base = isNum(f0) ? f0 : C4;
        const d = isNum(dur) ? dur : 2.4;
        [1, 2.4, 3, 4.2].forEach((r, i) => {
          voice(base * r, 'sine', d * (1 - i * 0.16), 0.20 / (i + 1.3));
        });
      },
      pluck(f0, dur) {
        const base = isNum(f0) ? f0 : C4;
        const d = isNum(dur) ? dur : 1.1;
        voice(base, 'triangle', d, 0.20);
        voice(base * 2, 'sine', d * 0.72, 0.07);
      },
      organ(f0, dur) {
        const base = isNum(f0) ? f0 : C4;
        const d = isNum(dur) ? dur : 1.6;
        [1, 2, 3, 4].forEach((r, i) => voice(base * r, 'sine', d, 0.13 / (i + 1)));
      },
      chord(freqs, dur) {
        (freqs || []).forEach((f) => voice(f, 'triangle', isNum(dur) ? dur : 1.8, 0.13));
      },
      stopAll() {
        live.forEach((o) => { try { o.stop(); } catch (e) { /* 已停止 */ } });
        live.clear();
      }
    };
  }

  function ensureAudio() {
    if (soundMuted) return null;
    const Ctor = audioCtor();
    if (!Ctor) return null;
    try {
      if (!ACTX) {
        ACTX = new Ctor();
        const factory = (W.Synth && typeof W.Synth.createSynth === 'function')
          ? W.Synth.createSynth
          : (typeof W.createSynth === 'function' ? W.createSynth : null);
        if (factory) {
          try { SYNTH = factory(ACTX); } catch (e) { SYNTH = null; }
        }
        if (!SYNTH || typeof SYNTH.pluck !== 'function') SYNTH = buildFallbackSynth(ACTX);
      }
      if (ACTX.state === 'suspended' && typeof ACTX.resume === 'function') ACTX.resume();
      return SYNTH;
    } catch (e) {
      return null;
    }
  }

  function synthCall(method) {
    const args = Array.prototype.slice.call(arguments, 1);
    const s = ensureAudio();
    if (!s) return false;
    try {
      if (typeof s[method] === 'function') { s[method].apply(s, args); return true; }
      if (method === 'bell' || method === 'organ' || method === 'pluck') {
        // 兼容极简内核：没有该方法时退回 pluck 语义
        if (typeof s.pluck === 'function') { s.pluck(args[0], args[1]); return true; }
      }
      if (method === 'chord' && typeof s.pluck === 'function') {
        (args[0] || []).forEach((f) => s.pluck(f, args[1]));
        return true;
      }
    } catch (e) { /* 音频失败不影响页面 */ }
    return false;
  }

  function stopAllSound() {
    if (ACTX && SYNTH) {
      try { if (typeof SYNTH.stopAll === 'function') SYNTH.stopAll(); } catch (e) { /* noop */ }
    }
    markPlaying(null);
  }

  /* ==================================================================
   * 3 · 通用工具
   * ================================================================== */
  function fmt(v, d) {
    if (!isNum(v)) return '—';
    const n = d == null ? 2 : d;
    let s = v.toFixed(n);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (s === '-0') s = '0';
    return s;
  }
  function fmtSigned(v, d) {
    if (!isNum(v)) return '—';
    const s = fmt(Math.abs(v), d);
    return (v > 0 ? '+' : (v < 0 ? '-' : '')) + s;
  }
  function fmtSci(x) {
    if (!isNum(x)) return '—';
    if (x === 0) return '0';
    if (Math.abs(x) >= 1e-4) return fmt(x, 12);
    const e = Math.floor(Math.log10(Math.abs(x)));
    const m = x / Math.pow(10, e);
    return fmt(m, 3) + 'e' + e;
  }
  function cjkCount(s) {
    if (!s) return 0;
    const m = String(s).match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/g);
    return m ? m.length : 0;
  }
  function normCents(c) {
    let x = c % 1200;
    if (x < 0) x += 1200;
    return x;
  }
  function el(tag, cls, attrs, txt) {
    const e = D.createElement(tag);
    if (cls) e.className = cls;
    if (attrs) Object.keys(attrs).forEach((k) => e.setAttribute(k, attrs[k]));
    if (txt != null) e.textContent = txt;
    return e;
  }
  /* SVG 节点工厂：用 HTML 解析器生成一次原型再 clone，避免脚本里出现任何 URL 字符串
     （零外部依赖硬扫要求；命名空间由浏览器在解析 <svg> 时自动赋予）。 */
  const SVG_PROTO = (function () {
    try {
      const box = D.createElement('div');
      box.innerHTML = '<svg viewBox="0 0 1 1"><g></g><circle></circle><line></line>' +
        '<path></path><rect></rect><text></text><polyline></polyline></svg>';
      return box.querySelector('svg');
    } catch (e) { return null; }
  })();
  function svgEl(tag, attrs) {
    let node = null;
    if (SVG_PROTO) {
      const proto = tag === 'svg' ? SVG_PROTO : SVG_PROTO.querySelector(tag);
      if (proto) node = proto.cloneNode(false);
    }
    if (!node) node = D.createElement(tag);           // 兜底
    if (attrs) Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
    return node;
  }

  let toastTimer = 0;
  function toast(msg) {
    const box = $('#toast');
    if (!box || !msg) return;
    box.textContent = msg;
    box.classList.add('is-on');
    W.clearTimeout(toastTimer);
    toastTimer = W.setTimeout(() => box.classList.remove('is-on'), 2200);
  }

  /* ---- 读数条：把 spec 渲进 <dl> ---- */
  function renderReadouts(host, rows) {
    if (!host) return;
    const frag = D.createDocumentFragment();
    rows.forEach((r) => {
      const wrap = el('div');
      const dt = el('dt', null, null, r.k);
      const dd = el('dd', r.cls || null);
      if (r.html) dd.innerHTML = r.v;
      else dd.textContent = r.v;
      if (r.unit) dd.appendChild(el('small', null, null, r.unit));
      wrap.appendChild(dt);
      wrap.appendChild(dd);
      frag.appendChild(wrap);
    });
    host.textContent = '';
    host.appendChild(frag);
  }

  function safeV(fn, dflt) {
    try {
      const v = fn();
      return (v === undefined || v === null || (typeof v === 'number' && !isFinite(v))) ? dflt : v;
    } catch (e) { return dflt; }
  }

  /* ==================================================================
   * 4 · 全局状态
   * ================================================================== */
  const state = {
    lang: 'zh',
    motion: !prefersReduced,
    muted: false,
    m1: { steps: 0 },
    m2: { ratio: 0.75, preset: null },
    m3: { active: 12 },
    m4: { step: 7 },
    m5: { sel: ['sanfen', 'tet12', 'ji5'], a: 'sanfen', b: 'tet12', region: 'all', mapId: 'china' },
    m6: { tone: 'front', hui: 6 },
    m7: { fret: 7 }
  };

  const vizState = {};          // 已挂载的可视化实例
  const MODULES = [];
  const MODULE_IDS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
  const dirty = {};             // 需要按语言重绘的模块
  let currentModule = 'm1';

  /* ==================================================================
   * 5 · 可视化挂载（IntersectionObserver 首次进入才初始化）
   * ================================================================== */
  const DEP = W.__deps || { tuning: false, synth: false, viz: [], paths: {}, viz_paths: {} };

  function loadOptionalDeps() {
    return new Promise((resolve) => {
      const srcs = [];
      // 静态 <script> 已接入的依赖不再重复注入（全局存在即视为已就绪）
      if (DEP.tuning && !W.Tuning && DEP.paths && DEP.paths.tuning) srcs.push(DEP.paths.tuning);
      if (DEP.synth && !W.Synth && DEP.paths && DEP.paths.synth) srcs.push(DEP.paths.synth);
      (DEP.viz || []).forEach((n) => {
        const p = DEP.viz_paths && DEP.viz_paths[n];
        if (p && !(W.Viz && W.Viz[n])) srcs.push(p);
      });
      if (!srcs.length) { resolve(); return; }
      let i = 0;
      const next = () => {
        if (i >= srcs.length) { resolve(); return; }
        const s = D.createElement('script');
        s.src = srcs[i++];
        s.onload = next;
        s.onerror = next;                       // 清单里应存在的文件；出错也不阻塞
        D.body.appendChild(s);
      };
      next();
    });
  }

  const observer = ('IntersectionObserver' in W)
    ? new W.IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const modEl = en.target;
        if (modEl.classList.contains('mod')) {
          modEl.classList.add('is-seen');
          const id = modEl.getAttribute('data-module');
          lazyMount(id);
          observer.unobserve(modEl);
        } else if (modEl.classList.contains('viz-slot')) {
          lazyMountSlot(modEl);
          observer.unobserve(modEl);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.06 })
    : null;

  const mountedSlots = new Set();

  /* 每个槽位一份规格：组件名（可能为空）+ state() + 自绘降级 fallback()
     槽位 = 带 data-viz 的 DOM 节点（按 id 索引），因此同名组件可在两处用不同 state。 */
  const VIZ_SPECS = {};
  function defineViz(slotId, spec) { VIZ_SPECS[slotId] = spec; }

  function lazyMountSlot(slot) {
    if (!slot || mountedSlots.has(slot)) return;
    mountedSlots.add(slot);
    const id = slot.id;
    const spec = id && VIZ_SPECS[id];
    if (!spec) return;
    try {
      mountViz(slot, spec);
    } catch (e) {
      slot.setAttribute('data-viz-error', '1');
    }
  }

  function mountViz(slot, spec) {
    const name = spec.component;
    const comp = name ? (W.Viz && W.Viz[name]) : null;
    const opts = Object.assign({ lang: state.lang, reducedMotion: !state.motion }, spec.opts || {});
    if (spec.onChange) opts.onChange = spec.onChange;
    if (spec.onSelect) opts.onSelect = spec.onSelect;

    if (comp && typeof comp.init === 'function') {
      try {
        const inst = comp.init(slot, opts);
        if (inst && typeof inst === 'object') {
          vizState[slot.id] = inst;
          slot.classList.add('is-ready');
          slot.setAttribute('data-viz-engine', 'component');
          return inst;
        }
      } catch (e) { /* 组件异常 → 走自绘 */ }
    }
    const inst = spec.fallback(slot);
    vizState[slot.id] = inst;
    slot.classList.add('is-ready');
    slot.setAttribute('data-viz-engine', 'builtin');
    return inst;
  }

  /** 用槽位自己的 state() 刷新该槽位（组件与自绘都走这条路） */
  function refreshSlot(slotId) {
    const spec = VIZ_SPECS[slotId];
    const inst = vizState[slotId];
    if (!spec || !inst || typeof inst.update !== 'function') return;
    try { inst.update(spec.state ? spec.state() : {}); } catch (e) { /* noop */ }
  }

  /* ==================================================================
   * 6 · 各模块
   * ================================================================== */

  /* ---------------------------------------------------------- M1 */
  const M1_STEPS = 12;
  const PYTHAG_COMMA = 1200 * Math.log2(Math.pow(3, 12) / Math.pow(2, 19));

  function m1Gap(n) {
    return n * (1200 * Math.log2(1.5) - 700);
  }
  function m1ChainRatio(n) {
    return Math.pow(1.5, n) / Math.pow(2, (7 * n) / 12);
  }

  defineViz('viz-m1', {
    component: 'spiral5th',
    opts: {},
    state() {
      const n = clamp(state.m1.steps, 0, M1_STEPS);
      // previewSteps = 完整 12 步（淡色底图）；steps = 已揭示的步数
      // 注意：组件按「步」计数（每步一个音分增量），圆心即黄钟起点，不在 steps 里
      const full = [];
      for (let i = 1; i <= M1_STEPS; i++) {
        full.push({
          step: i,
          name: String(i),
          cents: i * 1200 * Math.log2(1.5),
          operation: '×3/2'
        });
      }
      return {
        steps: full.slice(0, n),
        previewSteps: full,
        closureCents: m1Gap(M1_STEPS),
        active: n > 0 ? n - 1 : null
      };
    },
    onSelect(i) {
      if (isNum(i)) { state.m1.steps = clamp(i, 0, M1_STEPS); m1Render(); }
    },
    fallback(host) { return drawSpiralFallback(host, 'm1'); }
  });

  function m1Render() {
    const n = state.m1.steps;
    const gap = m1Gap(n);
    const fifthEnd = K.normalize_octave(Math.pow(1.5, n));
    const octEnd = Math.pow(2, (7 * n) / 12);
    const ratio = safeV(() => m1ChainRatio(n), 1);
    const beat = safeV(() => K.beat_frequency(A4, K.hz_from_cents(A4, gap)), 0);

    renderReadouts($('#m1-readouts'), [
      { k: T('m1.readSteps'), v: n + ' / 12' },
      { k: T('m1.readFifthEnd'), v: fmt(fifthEnd, 6) },
      { k: T('m1.readOctaveEnd'), v: fmt(octEnd, 6) },
      { k: T('m1.readGap'), v: fmtSigned(gap, 4), unit: T('ui.centsShort'), cls: Math.abs(gap) > 0.5 ? 'is-error' : null },
      { k: T('m1.readRatio'), v: fmt(ratio, 8) },
      { k: T('m1.readBeat'), v: fmt(beat, 2), unit: 'Hz' }
    ]);
    const slot = $('#viz-m1');
    if (slot) lazyMountSlot(slot);
    refreshSlot('viz-m1');
    m1FigureUpdate(n);
  }

  function m1FigureUpdate(n) {
    const gap12 = m1Gap(12);
    const cl = kernelClosure();
    const chainTotal = (cl && isNum(cl.twelve_fifths_cents)) ? cl.twelve_fifths_cents : 12 * 1200 * Math.log2(1.5);
    const ratio12 = (cl && isNum(cl.ratio_raw)) ? cl.ratio_raw : m1ChainRatio(12);
    const beat12 = K.beat_frequency(A4, K.hz_from_cents(A4, gap12));
    figuresInto('#m1-figures', [
      figComputed(T('m1.check1'), fmt(chainTotal, 2), T('ui.centsShort'), null),
      figComputed(T('m1.check2'), fmt(gap12, 2), T('ui.centsShort'), 'kernel.pythagorean_comma_cents'),
      figComputed(T('m1.check3'), fmt(ratio12, 8), '', null),
      figComputed(T('m1.check4'), fmt(beat12, 2), 'Hz', null)
    ]);
  }

  function bindM1() {
    const step = $('#m1-step');
    if (step) step.addEventListener('click', () => {
      state.m1.steps = (state.m1.steps >= M1_STEPS) ? 0 : state.m1.steps + 1;
      m1Render();
    });
    const run = $('#m1-run');
    if (run) run.addEventListener('click', () => {
      if (state.m1.steps >= M1_STEPS) { state.m1.steps = 0; m1Render(); return; }
      const tick = () => {
        state.m1.steps = Math.min(M1_STEPS, state.m1.steps + 1);
        m1Render();
        if (state.m1.steps < M1_STEPS) W.setTimeout(tick, 220);
      };
      tick();
    });
    const reset = $('#m1-reset');
    if (reset) reset.addEventListener('click', () => { state.m1.steps = 0; m1Render(); });
    const play = $('#m1-play');
    if (play) play.addEventListener('click', () => { playM1Compare(); markPlaying(play); });
    const beat = $('#m1-beat');
    if (beat) beat.addEventListener('click', () => { playM1Beat(); markPlaying(beat); });
  }

  function playM1Compare() {
    stopAllSound();
    const s = ensureAudio();
    if (!s) { toast(T('m1.hintPlay')); return; }
    const seq = [];
    for (let i = 0; i < 12; i++) seq.push(K.normalize_octave(Math.pow(1.5, i)) * C4);
    let i = 0;
    const tick = () => {
      if (i < seq.length) {
        synthCall('pluck', seq[i], 0.34);
        i++;
        W.setTimeout(tick, 130);
      } else {
        // 终点：链尾 vs 纯八度
        W.setTimeout(() => {
          synthCall('chord', [C4, K.hz_from_cents(C4, PYTHAG_COMMA)], 2.4);
        }, 180);
      }
    };
    tick();
  }

  function playM1Beat() {
    stopAllSound();
    const s = ensureAudio();
    if (!s) { toast(T('m1.hintPlay')); return; }
    const f2 = K.hz_from_cents(A4, PYTHAG_COMMA);
    synthCall('chord', [A4, f2], 3.0);
  }

  /* ---------------------------------------------------------- M2 */
  const M2_PRESETS = [
    { id: 'octave', ratio: 0.5, key: 'm2.preset_octave', note: 'm2.noteOctave' },
    { id: 'fifth', ratio: 2 / 3, key: 'm2.preset_fifth', note: 'm2.noteFifth' },
    { id: 'fourth', ratio: 3 / 4, key: 'm2.preset_fourth', note: 'm2.noteFourth' },
    { id: 'major3just', ratio: 4 / 5, key: 'm2.preset_major3just', note: 'm2.noteMajor3just' },
    { id: 'major3pyth', ratio: 64 / 81, key: 'm2.preset_major3pyth', note: 'm2.noteMajor3pyth' },
    { id: 'semitone', ratio: Math.pow(2, -1 / 12), key: 'm2.preset_semitone', note: 'm2.noteSemitone' }
  ];

  function m2Freq(ratio) {
    return C4 / clamp(ratio, 0.5, 1);
  }
  function m2Cents(ratio) {
    return 1200 * Math.log2(1 / clamp(ratio, 0.5, 1));
  }

  defineViz('viz-m2', {
    component: 'monochord',
    opts: { range: [0.5, 1], value: 0.75 },
    state() {
      const r = state.m2.ratio;
      return {
        ratio: r,
        lens: M2_PRESETS.map((p) => ({ label: T(p.key), ratio: p.ratio })),
        hz: m2Freq(r),
        cents: m2Cents(r),
        note: SEMI_NAMES[Math.round(normCents(m2Cents(r)) / 100) % 12]
      };
    },
    onChange(ratio) {
      state.m2.ratio = clamp(Number(ratio) || 0.75, 0.5, 1);
      m2Render();
    },
    fallback(host) { return drawMonochordFallback(host, 'm2'); }
  });

  function m2Render() {
    const r = state.m2.ratio;
    const hz = m2Freq(r);
    const cents = m2Cents(r);
    const nearest = Math.round(cents / 100);
    const dev = cents - nearest * 100;
    const noteIdx = ((nearest % 12) + 12) % 12;
    const oct = 4 + Math.floor(nearest / 12);

    const slider = $('#m2-slider');
    if (slider && Math.abs(parseFloat(slider.value) / 100 - r) > 0.0005) slider.value = String(Math.round(r * 100));
    const out = $('#m2-out');
    if (out) out.textContent = fmt(r, 3);

    renderReadouts($('#m2-readouts'), [
      { k: T('m2.readLength'), v: fmt(r, 4) },
      { k: T('m2.readRatio'), v: '1 : ' + fmt(1 / r, 4) },
      { k: T('m2.readHz'), v: fmt(hz, 2), unit: 'Hz' },
      { k: T('m2.readCents'), v: fmtSigned(cents, 2), unit: T('ui.centsShort') },
      { k: T('m2.readNote'), v: SEMI_NAMES[noteIdx] + oct },
      { k: T('m2.readNearest'), v: fmtSigned(dev, 2), unit: T('ui.centsShort'), cls: Math.abs(dev) > 10 ? 'is-error' : 'is-ok' }
    ]);

    // 预设芯片高亮
    $$('#m2-presets .chip').forEach((b) => {
      const v = parseFloat(b.getAttribute('data-ratio'));
      b.setAttribute('aria-pressed', String(Math.abs(v - r) < 0.0015));
    });

    const slot = $('#viz-m2');
    if (slot) lazyMountSlot(slot);
    refreshSlot('viz-m2');

    // 断言：弦长 × 频率 恒定
    const l1 = 0.5, l2 = 0.9;
    const constCheck = Math.abs((1 / l1) * l1 - (1 / l2) * l2);
    const presErr = Math.max.apply(null, M2_PRESETS.map((p) => {
      if (p.id === 'fifth') return Math.abs(m2Cents(p.ratio) - 701.955001);
      if (p.id === 'octave') return Math.abs(m2Cents(p.ratio) - 1200);
      if (p.id === 'fourth') return Math.abs(m2Cents(p.ratio) - 498.045001);
      if (p.id === 'major3just') return Math.abs(m2Cents(p.ratio) - 386.313714);
      if (p.id === 'major3pyth') return Math.abs(m2Cents(p.ratio) - 407.820004);
      return Math.abs(m2Cents(p.ratio) - 100);
    }));
    figuresInto('#m2-figures', [
      figComputed(T('m2.check1'), constCheck < ZERO ? '0' : fmtSci(constCheck), T('ui.centsShort'), null),
      figComputed(T('m2.check2'), fmtSigned(cents, 2), T('ui.centsShort'), null),
      figComputed(T('m2.check3'), fmtSci(presErr), T('ui.centsShort'), null),
      figComputed(T('m2.check4'), '701.9550', T('ui.centsShort'), null)
    ]);
  }

  function renderM2Presets() {
    const host = $('#m2-presets');
    if (!host) return;
    host.textContent = '';
    M2_PRESETS.forEach((p) => {
      const b = el('button', 'chip', { type: 'button', 'data-ratio': String(p.ratio), 'aria-pressed': 'false', title: T(p.note) }, T(p.key));
      b.addEventListener('click', () => {
        state.m2.ratio = p.ratio;
        m2Render();
      });
      host.appendChild(b);
    });
    m2Render();
  }

  function bindM2() {
    const slider = $('#m2-slider');
    if (slider) {
      slider.addEventListener('input', () => {
        state.m2.ratio = clamp(parseFloat(slider.value) / 100, 0.5, 1);
        m2Render();
      });
    }
    const play = $('#m2-play');
    if (play) play.addEventListener('click', () => {
      stopAllSound();
      synthCall('chord', [C4, m2Freq(state.m2.ratio)], 2.6);
      markPlaying(play);
    });
  }

  /* ---------------------------------------------------------- M3 */
  function m3Pitches() {
    // 内核 sanfen_sunyi 返回 {base_hz, steps[], closure}；内置实现返回数组 —— 统一归一化
    const raw = safeV(() => K.sanfen_sunyi(C4), null);
    let steps = null;
    if (raw && Array.isArray(raw.steps)) steps = raw.steps;
    else if (Array.isArray(raw)) steps = raw;
    if (!steps || !steps.length) steps = FALLBACK_KERNEL.sanfen_sunyi(C4);
    return steps.map((r, i) => {
      const nameZh = r.name_zh || r.name || SANFEN_NAMES[i % 12].zh;
      const nameEn = r.name_en || r.pinyin || SANFEN_NAMES[i % 12].en;
      let ratio = isNum(r.ratio_octave) ? r.ratio_octave : (isNum(r.ratio) ? r.ratio : 1);
      if (!(ratio >= 1 && ratio < 2)) ratio = K.normalize_octave(ratio);
      const hz = (isNum(r.hz) && r.hz > 0) ? r.hz : C4 * ratio;
      const cents = isNum(r.cents_from_base) ? r.cents_from_base
        : (isNum(r.cents) ? r.cents : 1200 * Math.log2(ratio));
      return {
        index: i,
        name_zh: nameZh,
        name_en: nameEn,
        ratio: ratio,
        hz: hz,
        cents: normCents(cents),
        chainCents: i * 1200 * Math.log2(1.5)
      };
    });
  }

  /** 内核的闭合结论（内核可用时用它的精确值，避免本页另行算出别的数） */
  function kernelClosure() {
    const raw = safeV(() => K.sanfen_sunyi(C4), null);
    if (raw && raw.closure && isNum(raw.closure.cents)) return raw.closure;
    return null;
  }

  /** 把世界律制数据注入内核（内核据此给出 status，不编造数据） */
  function injectWorldTunings() {
    try {
      const list = (W.TuningData && Array.isArray(W.TuningData.systems)) ? W.TuningData.systems : null;
      if (list && list.length && typeof K.set_world_tunings === 'function') {
        K.set_world_tunings(list);
        return true;
      }
    } catch (e) { /* noop */ }
    return false;
  }

  const M3_PITCHES = [];

  function m3Render() {
    const n = clamp(state.m3.active, 0, 12);
    const rows = M3_PITCHES.slice(0, n);
    const tbody = $('#m3-tbody');
    if (tbody) {
      tbody.textContent = '';
      rows.forEach((r, i) => {
        const tr = el('tr');
        if (state.m3.active >= 12 && i === 11) tr.className = 'is-active';
        tr.appendChild(el('td', null, null, String(i + 1)));
        tr.appendChild(el('td', 'lu-name', null, state.lang === 'zh' ? r.name_zh : r.name_en));
        tr.appendChild(el('td', null, null, fmt(r.ratio, 6)));
        tr.appendChild(el('td', null, null, fmt(r.hz, 2)));
        tr.appendChild(el('td', 'num-cents', null, fmt(r.cents, 2)));
        tr.appendChild(el('td', 'num-dev', null,
          fmtSigned(r.cents - Math.round(r.cents / 100) * 100, 2)));
        tbody.appendChild(tr);
      });
    }

    const gap = m1Gap(12);
    const last = rows.length >= 12 ? rows[11] : null;
    renderReadouts($('#m3-readouts'), [
      { k: T('m3.readClosing'), v: fmtSigned(gap, 4), unit: T('ui.centsShort'), cls: 'is-error' },
      { k: T('m3.readNote'), v: last ? fmt(last.cents, 3) : '—', unit: T('ui.centsShort') },
      { k: T('m3.tableDev'), v: last ? fmtSigned(last.cents - Math.round(last.cents / 100) * 100, 2) : '—', unit: T('ui.centsShort') },
      { k: T('ui.status'), v: T('m3.statusOpen'), cls: 'is-error' }
    ]);

    const slot = $('#viz-m3');
    if (slot) lazyMountSlot(slot);
    refreshSlot('viz-m3');

    figuresInto('#m3-figures', [
      figComputed(T('m3.check1'), fmt(1.5, 1) + 'x', '', null),
      figComputed(T('m3.check2'), fmt(gap, 4), T('ui.centsShort'), 'kernel.pythagorean_comma_cents'),
      figComputed(T('m3.check3'), last ? fmt(last.ratio, 8) : '—', '', null),
      figComputed(T('m3.check4'), '1.5x', '', null)
    ]);
  }

  defineViz('viz-m3', {
    component: 'spiral5th',
    opts: {},
    state() {
      const n = clamp(state.m3.active, 0, 12);
      const full = [];
      for (let i = 0; i < 11; i++) {
        const p = M3_PITCHES[i + 1];
        full.push({
          step: i + 1,
          name: p ? (state.lang === 'zh' ? p.name_zh : p.name_en) : String(i + 1),
          cents: (i + 1) * 1200 * Math.log2(1.5),
          operation: '×3/2'
        });
      }
      full.push({ step: 12, name: T('m3.closureAttempt'), cents: 12 * 1200 * Math.log2(1.5), operation: '×3/2' });
      return {
        steps: full.slice(0, n),
        previewSteps: full,
        closureCents: m1Gap(12),
        active: n > 0 ? n - 1 : null
      };
    },
    onSelect(i) {
      if (isNum(i)) { state.m3.active = clamp(i + 1, 1, 12); m3Render(); }
    },
    fallback(host) { return drawSpiralFallback(host, 'm3'); }
  });

  function bindM3() {
    const gen = $('#m3-gen');
    if (gen) gen.addEventListener('click', () => {
      state.m3.active = (state.m3.active >= 12) ? 0 : state.m3.active + 1;
      m3Render();
      if (state.m3.active > 0) {
        const p = M3_PITCHES[state.m3.active - 1];
        synthCall('pluck', p.hz, 0.7);
      }
    });
    const all = $('#m3-all');
    if (all) all.addEventListener('click', () => {
      state.m3.active = 0;
      const tick = () => {
        if (state.m3.active >= 12) return;
        state.m3.active++;
        m3Render();
        const p = M3_PITCHES[state.m3.active - 1];
        synthCall('pluck', p.hz, 0.5);
        W.setTimeout(tick, 190);
      };
      tick();
    });
    const reset = $('#m3-reset');
    if (reset) reset.addEventListener('click', () => { state.m3.active = 0; m3Render(); });
    const wolf = $('#m3-wolf');
    if (wolf) wolf.addEventListener('click', () => {
      stopAllSound();
      const f1 = C4;
      const f2 = K.hz_from_cents(C4, m1Gap(12));
      synthCall('chord', [f1, f2], 3.0);
      markPlaying(wolf);
    });
    const scale = $('#m3-scale');
    if (scale) scale.addEventListener('click', () => {
      stopAllSound();
      M3_PITCHES.slice().sort((a, b) => a.cents - b.cents).forEach((p, i) => {
        W.setTimeout(() => synthCall('pluck', p.hz, 0.42), i * 160);
      });
      markPlaying(scale);
    });
  }

  /* ---------------------------------------------------------- M4 */
  const M4_DERIV = [
    { key: 'd1', expr: 'r¹² = 2', val: null },
    { key: 'd2', expr: '2^(1/2) = √2', val: Math.SQRT2 },
    { key: 'd3', expr: '2^(1/4) = √(√2)', val: Math.sqrt(Math.SQRT2) },
    { key: 'd4', expr: '2^(1/3) ', val: Math.cbrt(2) },
    { key: 'd5', expr: '2^(1/6) = √(2^(1/3))', val: Math.sqrt(Math.cbrt(2)) },
    { key: 'd6', expr: '2^(1/4) ÷ 2^(1/6)', val: Math.sqrt(Math.SQRT2) / Math.sqrt(Math.cbrt(2)) },
    { key: 'd7', expr: '密率¹²', val: Math.pow(Math.pow(2, 1 / 12), 12) }
  ];
  const MILU = Math.pow(2, 1 / 12);

  function m4Render() {
    const n = clamp(state.m4.step, 0, M4_DERIV.length);
    const host = $('#m4-deriv');
    if (host) {
      host.textContent = '';
      M4_DERIV.slice(0, n).forEach((d, i) => {
        const li = el('li');
        li.appendChild(el('span', 'dk', null, T('m4.step' + (i + 1))));
        if (d.val != null) {
          li.appendChild(el('span', 'dv', null, ' = ' + (i === M4_DERIV.length - 1
            ? d.val.toPrecision(17) : fmt(d.val, 15))));
        }
        host.appendChild(li);
      });
    }
    const power = Math.pow(MILU, 12);
    renderReadouts($('#m4-power'), [
      { k: T('m4.powerResult'), v: power.toPrecision(17), cls: 'is-ok' },
      { k: T('m4.powerTarget'), v: '2' },
      { k: T('m4.powerDiff'), v: fmtSci(Math.abs(power - 2)), unit: '', cls: 'is-ok' }
    ]);
    const litRecorded = 1.059463094;
    renderReadouts($('#m4-lit'), [
      { k: T('m4.litRecorded'), v: fmt(litRecorded, 9) },
      { k: T('m4.litComputed'), v: fmt(MILU, 16) },
      { k: T('m4.litDiff'), v: fmt(Math.abs(litRecorded - MILU), 12) }
    ]);

    // 十二个半音全部 100 音分
    const et = K.equal_temperament(12);
    const maxDevEt = Math.max.apply(null, et.map((x) => Math.abs(x.cents - x.index * 100)));
    figuresInto('#m4-figures', [
      figComputed(T('m4.check1'), fmtSci(Math.abs(MILU - Math.pow(2, 1 / 12))), '', null),
      figComputed(T('m4.check2'), fmtSci(Math.abs(power - 2)), '', null),
      figComputed(T('m4.check3'), fmtSci(Math.abs(litRecorded - MILU)), '', null),
      figComputed(T('m4.check4'), fmtSci(maxDevEt), T('ui.centsShort'), null)
    ]);
  }

  /** 年份标签：中文用 year_label_zh；英文只接受无 CJK 的标签，否则由 year 数值生成 */
  function yearLabel(ev) {
    const y = ev ? ev.year : null;
    const zh = state.lang === 'zh';
    const raw = ev ? (zh ? ev.year_label_zh : ev.year_label_en) : '';
    if (typeof raw === 'string' && raw &&
        (zh || !/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/.test(raw))) {
      return raw;
    }
    if (!isNum(y)) return '';
    if (y < 0) return 'c. ' + Math.abs(y) + ' BCE';
    if (y < 1000) return String(y) + ' CE';
    return String(y);
  }

  /** 来源标注：只由 source_ids 生成，任何语言都不含仓库路径/中文括注 */
  function sourceLabel(ev) {
    const ids = (ev && Array.isArray(ev.source_ids)) ? ev.source_ids.filter(Boolean) : [];
    const reg = T('m8.sourceRegister');
    if (ids.length) return T('m8.sourcesInline', { ids: ids.join(', '), reg: reg });
    if (state.lang === 'zh' && ev && ev.source) {
      return T('ui.source') + ': ' +
        String(ev.source).replace(/（[^）]*sources\.md[^）]*）/g, '').replace(/\s+$/, '');
    }
    return T('m8.sourcesInline', { ids: '-', reg: reg });
  }

  function renderM4Timeline() {
    const host = $('#m4-timeline');
    if (!host) return;
    const data = W.HistoryData && Array.isArray(W.HistoryData.events) ? W.HistoryData.events : [];
    host.textContent = '';
    data.forEach((ev) => {
      const item = el('div', 'tl-item' + (ev.year === 1584 || ev.year === -433 ? ' is-key' : ''));
      item.appendChild(el('div', 'tl-year', null, yearLabel(ev)));
      item.appendChild(el('div', 'tl-title', null, state.lang === 'zh' ? ev.title_zh : ev.title_en));
      const body = el('p', 'tl-body', null, state.lang === 'zh' ? ev.body_zh : ev.body_en);
      item.appendChild(body);
      if (ev.status) item.appendChild(el('span', 'tl-status', null, statusText(ev.status)));
      const srcTxt = sourceLabel(ev);
      if (srcTxt) item.appendChild(el('div', 'tl-src', null, srcTxt));
      host.appendChild(item);
    });
  }

  function m4Chord(systemId) {
    const sys = findSystem(systemId) || findSystem('tet12');
    if (!sys) return [C4, C4 * Math.pow(2, 4 / 12), C4 * Math.pow(2, 7 / 12), C4 * Math.pow(2, 11 / 12), C4 * 2];
    const c = sys.cents;
    const pick = (semi) => {
      const target = semi * 100;
      let best = c[0], bd = Infinity;
      c.forEach((x) => { const d = Math.abs(x - target); if (d < bd) { bd = d; best = x; } });
      if (Math.abs(best - target) > 180 && c.indexOf(0) >= 0) {
        // 找不到靠得住的对应音级时退回平均律位置
        return target;
      }
      return best;
    };
    return [0, 4, 7, 11, 12].map((semi) => K.hz_from_cents(C4, semi === 12 ? 1200 : pick(semi)));
  }

  function bindM4() {
    const step = $('#m4-step');
    if (step) step.addEventListener('click', () => {
      state.m4.step = (state.m4.step >= M4_DERIV.length) ? 1 : state.m4.step + 1;
      m4Render();
    });
    const all = $('#m4-all');
    if (all) all.addEventListener('click', () => { state.m4.step = M4_DERIV.length; m4Render(); });
    const reset = $('#m4-reset');
    if (reset) reset.addEventListener('click', () => { state.m4.step = 0; m4Render(); });

    [['#m4-play-sanfen', 'sanfen'], ['#m4-play-meantone', 'meantone'], ['#m4-play-tet', 'tet12']].forEach((pair) => {
      const b = $(pair[0]);
      if (!b) return;
      b.addEventListener('click', () => {
        stopAllSound();
        const freqs = m4Chord(pair[1]);
        freqs.forEach((f, i) => W.setTimeout(() => synthCall('organ', f, 1.5), i * 60));
        markPlaying(b);
      });
    });
  }

  /* ---------------------------------------------------------- M5 */
  function allSystems() {
    const raw = (W.TuningData && Array.isArray(W.TuningData.systems)) ? W.TuningData.systems : [];
    return raw.filter((x) => x && Array.isArray(x.cents) && x.cents.length > 1);
  }
  function findSystem(id) {
    return allSystems().filter((s) => s.id === id)[0] || null;
  }
  function sysName(s) {
    if (!s) return '—';
    return state.lang === 'zh' ? (s.name_zh || s.id) : (s.name_en || s.id);
  }
  function sysShort(s) {
    if (!s) return '—';
    return state.lang === 'zh' ? (s.name_short_zh || s.name_zh || s.id) : (s.name_short_en || s.name_en || s.id);
  }
  function statusBadge(s) {
    // 律制表口径：pending → 「文献参考值」（内部状态仍是待核验，M8 说明）
    const st = s.status || 'pending';
    const map = {
      verified: 'ui.statusVerified', research: 'ui.statusResearch', official: 'ui.statusOfficial',
      computed: 'ui.statusComputed', pending: 'ui.statusLiterature'
    };
    return { text: T(map[st] || 'ui.statusLiterature'), cls: 'sys-badge is-' + (st === 'pending' ? 'pending' : 'verified') };
  }
  function statusText(st) {
    const map = {
      verified: 'ui.statusVerified', research: 'ui.statusResearch', official: 'ui.statusOfficial',
      pending: 'ui.statusPending', computed: 'ui.statusComputed'
    };
    return T(map[st] || 'ui.statusPending');
  }

  defineViz('viz-m5', {
    component: 'centsRuler',
    opts: {},
    state() {
      return {
        systems: m5Selected().map((s) => ({
          id: s.id,
          name: sysName(s),
          color: (s.status === 'pending') ? 'var(--red)' : null,
          cents: s.cents
        }))
      };
    },
    onSelect(info) {
      if (!info || !isNum(info.cents)) return;
      synthCall('pluck', K.hz_from_cents(C4, info.cents), 0.7);
    },
    fallback(host) { return drawRulerFallback(host); }
  });

  const MAP_TO_REGION = {
    greece: 'europe', europe: 'europe', china: 'china', india: 'india',
    arabic: 'arabic', indonesia: 'indonesia', thailand: 'thailand'
  };

  defineViz('viz-m5-map', {
    component: 'worldmap',
    opts: { coord: 'lonlat' },
    state() {
      const regions = (W.WorldData && Array.isArray(W.WorldData.regions)) ? W.WorldData.regions : [];
      let sel = state.m5.mapId;
      if (!sel || !regions.some((r) => r.id === sel)) sel = (regions[0] || {}).id || '';
      return {
        entries: regions.map((r) => ({
          id: r.id,
          name_zh: r.name_zh || r.id,
          name_en: r.name_en || r.id,
          culture: (state.lang === 'zh' ? (r.instruments_zh || '') : (r.instruments_en || '')),
          region: { x: isNum(r.lon) ? r.lon : 0, y: isNum(r.lat) ? r.lat : 0 }
        })),
        selected: sel
      };
    },
    onSelect(id) {
      const regions = (W.WorldData && Array.isArray(W.WorldData.regions)) ? W.WorldData.regions : [];
      if (!regions.some((r) => r.id === id)) return;
      state.m5.mapId = id;
      state.m5.region = MAP_TO_REGION[id] || id;
      applyRegionFilter();
      renderM5Regions();
      renderM5MapInfo();
      refreshSlot('viz-m5-map');
    },
    fallback(host) { return drawMapFallback(host); }
  });

  function m5Selected() {
    const all = allSystems();
    return all.filter((s) => state.m5.sel.indexOf(s.id) >= 0);
  }

  function maxDevVsET(sys) {
    if (!sys || !sys.cents) return 0;
    // 与「十二平均律最近音级」比：c 距最近的 100 音分整数格多远（不假设音数 = 12）
    let mx = 0;
    sys.cents.forEach((c) => {
      const d = Math.abs(c - Math.round(c / 100) * 100);
      if (d > mx) mx = d;
    });
    return mx;
  }

  function m5Render() {
    renderM5List();
    renderM5Ruler();
    renderM5Selects();
    const a = findSystem(state.m5.a), b = findSystem(state.m5.b);
    renderReadouts($('#m5-readouts'), [
      { k: T('ui.systemA'), v: sysName(a) },
      { k: T('ui.systemB'), v: sysName(b) },
      { k: T('m5.noteCount', { n: a ? a.cents.length : 0 }), v: a ? String(a.cents.length) : '—' },
      { k: T('m5.check4'), v: fmt(Math.max(maxDevVsET(a), maxDevVsET(b)), 2), unit: T('ui.centsShort') }
    ]);

    const all = allSystems();
    const pending = all.filter((s) => (s.status || 'pending') === 'pending').length;
    let maxDev = 0;
    all.forEach((s) => { const d = maxDevVsET(s); if (d > maxDev) maxDev = d; });
    const sums = all.map((s) => {
      let t = 0;
      for (let i = 1; i < s.cents.length; i++) t += s.cents[i] - s.cents[i - 1];
      t += 1200 - s.cents[s.cents.length - 1];
      return Math.abs(t - 1200);
    });
    figuresInto('#m5-figures', [
      figComputed(T('m5.check1'), String(all.length), '', null),
      figComputed(T('m5.check2'), fmt(Math.max.apply(null, sums), 12), T('ui.centsShort'), null),
      figComputed(T('m5.check3'), String(pending), '', null),
      figComputed(T('m5.check4'), fmt(maxDev, 2), T('ui.centsShort'), null)
    ]);
    const slot = $('#viz-m5');
    if (slot) { lazyMountSlot(slot); refreshSlot('viz-m5'); }
    const mapSlot = $('#viz-m5-map');
    if (mapSlot) { lazyMountSlot(mapSlot); refreshSlot('viz-m5-map'); }
    renderM5MapInfo();
  }

  function renderM5MapInfo() {
    const host = $('#m5-map-info');
    if (!host) return;
    const regions = (W.WorldData && Array.isArray(W.WorldData.regions)) ? W.WorldData.regions : [];
    const r = regions.filter((x) => x.id === state.m5.mapId)[0] || regions[0];
    if (!r) { host.textContent = ''; return; }
    const zh = state.lang === 'zh';
    host.textContent = (zh ? r.name_zh : r.name_en) + ' · ' + (zh ? r.body_zh : r.body_en);
  }

  function renderM5List() {
    const host = $('#m5-list');
    if (!host) return;
    host.textContent = '';
    const all = allSystems();
    all.forEach((s) => {
      const on = state.m5.sel.indexOf(s.id) >= 0;
      const li = el('li');
      const btn = el('button', 'sys-item', { type: 'button', 'aria-pressed': String(on) });
      const left = el('span');
      left.appendChild(el('span', 'sys-name', null, sysName(s)));
      const badge = statusBadge(s);
      left.appendChild(el('span', badge.cls, null, badge.text));
      btn.appendChild(left);
      btn.appendChild(el('span', 'sys-meta', null, s.cents.length + ' ' + T('ui.notes')));
      btn.addEventListener('click', () => {
        const i = state.m5.sel.indexOf(s.id);
        if (i >= 0) { if (state.m5.sel.length > 1) state.m5.sel.splice(i, 1); }
        else state.m5.sel.push(s.id);
        m5Render();
      });
      li.appendChild(btn);
      host.appendChild(li);
    });
  }

  function renderM5Ruler() {
    const host = $('#viz-m5');
    if (!host) return;
    if (host.getAttribute('data-viz-engine') === 'component') return;  // 组件接管
    if (host.getAttribute('data-viz-engine') === 'builtin') { refreshSlot('viz-m5'); return; }
    drawRulerInto(host, m5Selected());
  }

  function renderM5Selects() {
    const all = allSystems();
    [['#m5-a', 'a'], ['#m5-b', 'b']].forEach((pair) => {
      const sel = $(pair[0]);
      if (!sel) return;
      const cur = state.m5[pair[1]];
      sel.textContent = '';
      all.forEach((s) => {
        const o = el('option', null, { value: s.id }, sysName(s));
        if (s.id === cur) o.selected = true;
        sel.appendChild(o);
      });
      sel.onchange = () => {
        state.m5[pair[1]] = sel.value;
        m5Render();
      };
    });
  }

  function renderM5Regions() {
    const host = $('#m5-regions');
    if (!host) return;
    host.textContent = '';
    const regions = ['all', 'china', 'europe', 'india', 'arabic', 'indonesia', 'thailand', 'global'];
    regions.forEach((r) => {
      const on = state.m5.region === r;
      const b = el('button', 'chip', { type: 'button', 'aria-pressed': String(on) }, T('m5.region_' + r));
      b.addEventListener('click', () => { state.m5.region = r; applyRegionFilter(); renderM5Regions(); });
      host.appendChild(b);
    });
  }

  function applyRegionFilter() {
    const all = allSystems();
    if (state.m5.region === 'all') {
      state.m5.sel = all.slice(0, 3).map((s) => s.id);
    } else {
      const ids = all.filter((s) => (s.region || 'global') === state.m5.region).map((s) => s.id);
      state.m5.sel = ids.length ? ids : [all[0] && all[0].id].filter(Boolean);
      if (ids.length) {
        state.m5.a = ids[0];
        state.m5.b = ids[1] || ids[0];
      }
    }
    m5Render();
  }

  function playMelodyFor(sysId) {
    const sys = findSystem(sysId);
    if (!sys) return;
    stopAllSound();
    const cs = sys.cents;
    const idxs = [];
    const n = cs.length;
    for (let k = 0; k < 5; k++) {
      const want = Math.round((k / 5) * n);
      idxs.push(clamp(want, 0, n - 1));
    }
    idxs.forEach((ix, i) => {
      const c = cs[ix];
      W.setTimeout(() => synthCall('pluck', K.hz_from_cents(C4, c), 0.55), i * 240);
    });
  }

  function bindM5() {
    const pa = $('#m5-play-a');
    if (pa) pa.addEventListener('click', () => { playMelodyFor(state.m5.a); markPlaying(pa); });
    const pb = $('#m5-play-b');
    if (pb) pb.addEventListener('click', () => { playMelodyFor(state.m5.b); markPlaying(pb); });
  }

  /* ---------------------------------------------------------- M6 */
  const BELL_F0 = C4 / 2;                      // 编钟正鼓音（示意，C3）
  const BELL_SIDE_CENTS = 386.3137;            // 侧鼓音 ≈ 大三度
  const GUQIN_F0 = C4 / 2;                     // 古琴基音（示意，C3）
  const HUI = [
    { hui: 1, frac: 1 / 8, fracText: '1/8' }, { hui: 2, frac: 1 / 6, fracText: '1/6' },
    { hui: 3, frac: 1 / 5, fracText: '1/5' }, { hui: 4, frac: 1 / 4, fracText: '1/4' },
    { hui: 5, frac: 1 / 3, fracText: '1/3' }, { hui: 6, frac: 2 / 5, fracText: '2/5' },
    { hui: 7, frac: 1 / 2, fracText: '1/2' }, { hui: 8, frac: 3 / 5, fracText: '3/5' },
    { hui: 9, frac: 2 / 3, fracText: '2/3' }, { hui: 10, frac: 3 / 4, fracText: '3/4' },
    { hui: 11, frac: 4 / 5, fracText: '4/5' }, { hui: 12, frac: 5 / 6, fracText: '5/6' },
    { hui: 13, frac: 7 / 8, fracText: '7/8' }
  ];
  function huiHarmonic(frac) {
    // 约分后得到泛音序号：x/L = p/q → 泛音 q
    let a = Math.round(frac * 840), b = 840;
    const g = (function gcd(x, y) { return y ? gcd(y, x % y) : x; })(a, b);
    return b / g;
  }

  const BELL_SET = [
    { id: 'b1', semi: 0, size: 1.00 },
    { id: 'b2', semi: 4, size: 0.86 },
    { id: 'b3', semi: 7, size: 0.78 },
    { id: 'b4', semi: 12, size: 0.64 }
  ];
  function bellFreqs(id) {
    const b = BELL_SET.filter((x) => x.id === id)[0] || BELL_SET[0];
    const front = K.hz_from_cents(BELL_F0, b.semi * 100);
    return { front: front, side: K.hz_from_cents(front, BELL_SIDE_CENTS) };
  }
  function bellEntries() {
    return BELL_SET.map((b, i) => {
      const fq = bellFreqs(b.id);
      return {
        id: b.id,
        name: T('m6.bellName', { n: i + 1 }),
        bellfrontHz: fq.front,
        bellsideHz: fq.side,
        size: b.size
      };
    });
  }

  defineViz('viz-m6', {
    component: 'bell',
    opts: {},
    state() {
      return { bells: bellEntries(), selected: state.m6.bell, tone: state.m6.tone };
    },
    onSelect(id) {
      if (!BELL_SET.some((b) => b.id === id)) return;
      state.m6.bell = id;
      m6Render();
      playBellTone('front');
    },
    onTone(id, tone) {
      if (BELL_SET.some((b) => b.id === id)) state.m6.bell = id;
      state.m6.tone = (tone === 'side') ? 'side' : 'front';
      m6Render();
      playBellTone(state.m6.tone);
    },
    fallback(host) { return drawBellFallback(host); }
  });

  defineViz('viz-m6-spec', {
    component: 'spectrum',
    opts: {},
    state() {
      const fq = bellFreqs(state.m6.bell);
      const raw = safeV(() => K.bell_partials(fq.front, 8), null);
      const list = (Array.isArray(raw) && raw.length) ? raw : FALLBACK_KERNEL.bell_partials(fq.front, 8);
      return {
        partials: list.map((p, i) => ({
          n: isNum(p.n) ? p.n : i + 1,
          ratio: isNum(p.ratio) ? p.ratio : (isNum(p.hz) ? p.hz / fq.front : 1),
          amp: isNum(p.amp) ? p.amp : Math.max(0.05, 1 / (i + 1)),
          name: p.name || ''
        })),
        f0: fq.front,
        playing: false
      };
    },
    fallback(host) { return drawSpectrumFallback(host); }
  });

  defineViz('viz-m6-hui', {
    component: null,
    opts: {},
    state() { return { hui: state.m6.hui }; },
    fallback(host) {
      return {
        update() { drawHuiStrip(host); },
        highlight() {}, resize() {}, destroy() {}, setLang() {}
      };
    }
  });
  function m6Render() {
    const fq = bellFreqs(state.m6.bell);
    const interval = safeV(() => K.cents(fq.front, fq.side), BELL_SIDE_CENTS);
    renderReadouts($('#m6-readouts'), [
      { k: T('m6.currentTone'), v: state.m6.tone === 'side' ? T('m6.bellSide') : T('m6.bellFront') },
      { k: T('m6.bellFront'), v: fmt(fq.front, 2), unit: 'Hz' },
      { k: T('m6.bellSide'), v: fmt(fq.side, 2), unit: 'Hz' },
      { k: T('m6.bellInterval'), v: fmtSigned(interval, 2), unit: T('ui.centsShort') }
    ]);
    $$('#m6-front, #m6-side').forEach((b) => {
      const isFront = b.id === 'm6-front';
      b.setAttribute('aria-pressed', String((state.m6.tone === 'front') === isFront));
    });

    const bellSlot = D.getElementById('viz-m6');
    if (bellSlot) { lazyMountSlot(bellSlot); refreshSlot('viz-m6'); }
    const specSlot = D.getElementById('viz-m6-spec');
    if (specSlot) { lazyMountSlot(specSlot); refreshSlot('viz-m6-spec'); }
    const huiSlot = D.getElementById('viz-m6-hui');
    if (huiSlot) { lazyMountSlot(huiSlot); refreshSlot('viz-m6-hui'); }
    renderHuiChips();
    renderHuiTable();

    const minFrac = Math.min.apply(null, HUI.map((h) => h.frac));
    figuresInto('#m6-figures', [
      figComputed(T('m6.check1'), 'f(n) = n·f(0)', '', null),
      figComputed(T('m6.check2'), fmtSigned(interval, 2), T('ui.centsShort'), null),
      figComputed(T('m6.check3'), '1/' + String(Math.round(1 / minFrac)), '', null),
      figComputed(T('m6.check4'), '2', T('ui.notes'), null)
    ]);
  }

  /** 古琴徽位条（无外部组件契约 → 自绘；交互由 chips 承担，此条为示意） */
  function drawHuiStrip(host) {
    if (!host) return;
    host.textContent = '';
    const wrap = el('div', 'hui-wrap');
    wrap.setAttribute('aria-hidden', 'true');
    const strip = el('div', 'hui-strip');
    strip.appendChild(el('span', 'hui-string'));
    HUI.forEach((h) => {
      const mark = el('span', 'hui-mark' + (state.m6.hui === h.hui ? ' is-on' : ''));
      mark.style.left = (h.frac * 100).toFixed(2) + '%';
      mark.appendChild(el('span', 'hui-dot'));
      mark.appendChild(el('span', 'hui-n', null, String(h.hui)));
      strip.appendChild(mark);
    });
    wrap.appendChild(strip);
    host.appendChild(wrap);
  }

  function playBellTone(tone) {
    stopAllSound();
    const fq = bellFreqs(state.m6.bell);
    if (!ensureAudio()) { toast(T('m1.hintPlay')); return; }
    if (tone === 'side') synthCall('bell', fq.side, 2.8);
    else if (tone === 'both') {
      synthCall('bell', fq.front, 2.6);
      W.setTimeout(() => synthCall('bell', fq.side, 2.6), 170);
    } else synthCall('bell', fq.front, 2.8);
  }

  function renderHuiChips() {
    const chips = $('#m6-hui');
    if (!chips) return;
    chips.textContent = '';
    HUI.forEach((h) => {
      const b = el('button', 'chip', {
        type: 'button',
        'aria-pressed': String(state.m6.hui === h.hui),
        'data-hui': String(h.hui),
        title: T('m6.guqinRatio') + ' ' + h.fracText + ' · ' + T('m6.guqinPartial') + ' ' + huiHarmonic(h.frac)
      }, T('m6.guqinHui') + ' ' + h.hui);
      b.addEventListener('click', () => { state.m6.hui = h.hui; playHui(h); m6Render(); });
      chips.appendChild(b);
    });
  }

  function renderHuiTable() {
    const tbody = $('#m6-tbody');
    if (!tbody) return;
    tbody.textContent = '';
    HUI.forEach((h) => {
      const n = huiHarmonic(h.frac);
      const f = GUQIN_F0 * n;
      const tr = el('tr');
      if (state.m6.hui === h.hui) tr.className = 'is-active';
      tr.appendChild(el('td', null, null, String(h.hui)));
      tr.appendChild(el('td', null, null, h.fracText));
      tr.appendChild(el('td', 'num-cents', null, String(n)));
      tr.appendChild(el('td', null, null, fmt(f, 2)));
      tr.appendChild(el('td', 'num-dev', null, fmt(1200 * Math.log2(n), 2)));
      tbody.appendChild(tr);
    });
  }

  function playBell(tone) {
    stopAllSound();
    const fq = bellFreqs(state.m6.bell);
    if (!ensureAudio()) { toast(T('m1.hintPlay')); return; }
    if (tone === 'both') {
      W.setTimeout(() => synthCall('bell', fq.front, 2.6), 0);
      W.setTimeout(() => synthCall('bell', fq.side, 2.6), 190);
    } else if (tone === 'side') {
      synthCall('bell', fq.side, 2.8);
    } else {
      synthCall('bell', fq.front, 2.8);
    }
  }

  function playHui(h) {
    const n = huiHarmonic(h.frac);
    synthCall('pluck', GUQIN_F0 * n, 1.4);
  }

  function bindM6() {
    const front = $('#m6-front');
    if (front) front.addEventListener('click', () => { state.m6.tone = 'front'; playBell('front'); m6Render(); markPlaying(front); });
    const side = $('#m6-side');
    if (side) side.addEventListener('click', () => { state.m6.tone = 'side'; playBell('side'); m6Render(); markPlaying(side); });
    const both = $('#m6-both');
    if (both) both.addEventListener('click', () => { state.m6.tone = 'both'; playBell('both'); m6Render(); markPlaying(both); });
    const sweep = $('#m6-sweep');
    if (sweep) sweep.addEventListener('click', () => {
      stopAllSound();
      HUI.forEach((h, i) => W.setTimeout(() => {
        const n = huiHarmonic(h.frac);
        synthCall('pluck', GUQIN_F0 * n, 0.8);
        state.m6.hui = h.hui;
        m6Render();
      }, i * 260));
      markPlaying(sweep);
    });
  }

  /* ---------------------------------------------------------- M7 */
  const FRET_L = 650;                            // 有效弦长（mm，示意）

  function fretRows() {
    const out = [{ fret: 0, dist: 0, remaining: FRET_L, ratio: 1, cents: 0 }];
    const raw = safeV(() => K.fret_positions(FRET_L, 12), null);
    if (Array.isArray(raw) && raw.length) {
      raw.forEach((r, i) => {
        const dist = isNum(r.distance) ? r.distance : (isNum(r.dist) ? r.dist : 0);
        out.push({
          fret: isNum(r.n) ? r.n : (isNum(r.fret) ? r.fret : i + 1),
          dist: dist,
          remaining: isNum(r.remaining_length) ? r.remaining_length : (FRET_L - dist),
          ratio: isNum(r.remaining_ratio) ? r.remaining_ratio
            : (isNum(r.ratio) ? r.ratio : 1 - dist / FRET_L),
          cents: isNum(r.cents) ? r.cents : (i + 1) * 100
        });
      });
    } else {
      FALLBACK_KERNEL.fret_positions(FRET_L, 12).forEach((r) => out.push({
        fret: r.fret, dist: r.dist, remaining: FRET_L - r.dist,
        ratio: 1 - r.dist / FRET_L, cents: r.fret * 100
      }));
    }
    return out;
  }
  function justCentsFor(semi) {
    const ji = safeV(() => K.just_intonation(), FALLBACK_KERNEL.just_intonation());
    let best = semi * 100, bd = Infinity;
    ji.forEach((j) => { const d = Math.abs(j.cents - semi * 100); if (d < bd) { bd = d; best = j.cents; } });
    return bd < 60 ? best : semi * 100;
  }

  defineViz('viz-m7', {
    component: 'isochord',
    opts: {},
    state() {
      const cents = [];
      for (let n = 0; n <= 12; n++) cents.push(n * 100);
      return { mode: 'fret', L: FRET_L, cents: cents };
    },
    fallback(host) {
      return {
        update() { drawFretboardInto(host, state.m7.fret); },
        highlight() {}, resize() {}, destroy() {}, setLang() {}
      };
    }
  });

  /** 钢琴调律曲线（Railsback）：高音拉宽、低音压窄，88 键示意 */
  function railsbackCents() {
    const out = [];
    for (let k = 0; k <= 87; k++) {
      const oct = -4.4 + (k / 87) * 7.4;      // A0…C8，相对 A4 的八度
      out.push(oct >= 0 ? 30 * Math.pow(oct / 3.25, 1.55) : -30 * Math.pow(-oct / 4.0, 1.5));
    }
    return out;
  }

  defineViz('viz-m7-stretch', {
    component: 'isochord',
    opts: {},
    state() { return { mode: 'piano', L: 0, cents: railsbackCents() }; },
    fallback(host) {
      return {
        update() { drawStretchInto(host); },
        highlight() {}, resize() {}, destroy() {}, setLang() {}
      };
    }
  });

  defineViz('viz-m7-iso', {
    component: null,
    opts: {},
    state() { return { systems: m7CompareSystems(), lang: state.lang }; },
    fallback(host) { return drawIsochordFallback(host); }
  });
  function m7CompareSystems() {
    const ids = ['tet12', 'sanfen', 'ji5', 'meantone', 'werck3'];
    return ids.map(findSystem).filter(Boolean);
  }

  function m7Render() {
    const f = clamp(state.m7.fret, 1, 12);
    const rows = fretRows();
    const row = rows.filter((r) => r.fret === f)[0] || rows[0];
    const etCents = f * 100;
    const jCents = justCentsFor(f);
    const etDist = FRET_L * (1 - Math.pow(2, -f / 12));
    const jDist = FRET_L * (1 - Math.pow(2, -jCents / 1200));
    renderReadouts($('#m7-readouts'), [
      { k: T('m7.fretLabel', { n: f }), v: fmt(row ? row.dist : etDist, 2), unit: 'mm' },
      { k: T('m7.fretET'), v: fmt(etDist, 2), unit: 'mm' },
      { k: T('m7.fretJust'), v: fmt(jDist, 2), unit: 'mm' },
      { k: T('m7.fretDiff'), v: fmtSigned(etDist - jDist, 2), unit: 'mm',
        cls: Math.abs(etCents - jCents) > 5 ? 'is-error' : 'is-ok' }
    ]);

    $$('#m7-frets .chip').forEach((b) => {
      b.setAttribute('aria-pressed', String(parseInt(b.getAttribute('data-fret'), 10) === f));
    });

    ['viz-m7', 'viz-m7-stretch'].forEach((sid) => {
      const slot = D.getElementById(sid);
      if (!slot) return;
      lazyMountSlot(slot);
      refreshSlot(sid);
    });
    const iso = D.getElementById('viz-m7-iso');
    if (iso) {
      lazyMountSlot(iso);
      if (iso.getAttribute('data-viz-engine') === 'component') refreshSlot('viz-m7-iso');
      else drawIsochordInto(iso, m7CompareSystems());
    }

    figuresInto('#m7-figures', [
      figComputed(T('m7.check1'), 'L(1-2^(-n/12))', '', null),
      figComputed(T('m7.check2'), fmt(FRET_L / 2, 1), 'mm', null),
      figComputed(T('m7.check3'), '386.3137', T('ui.centsShort'), null),
      figComputed(T('m7.check4'), '400', T('ui.centsShort'), null)
    ]);
  }

  function renderM7Frets() {
    const host = $('#m7-frets');
    if (!host) return;
    host.textContent = '';
    for (let i = 1; i <= 12; i++) {
      const b = el('button', 'chip', { type: 'button', 'data-fret': String(i), 'aria-pressed': String(state.m7.fret === i) }, String(i));
      b.addEventListener('click', () => { state.m7.fret = i; m7Render(); });
      host.appendChild(b);
    }
    m7Render();
  }

  function bindM7() {
    const et = $('#m7-et');
    if (et) et.addEventListener('click', () => {
      stopAllSound();
      synthCall('pluck', K.hz_from_cents(C4, state.m7.fret * 100), 1.5);
      markPlaying(et);
    });
    const just = $('#m7-just');
    if (just) just.addEventListener('click', () => {
      stopAllSound();
      synthCall('pluck', K.hz_from_cents(C4, justCentsFor(state.m7.fret)), 1.5);
      markPlaying(just);
    });
  }

  /* ---------------------------------------------------------- M8 */
  function renderM8Metrics() {
    const m = W.__metrics || {};
    const a = m.app || {};
    const pending = (m._pending || []).length;
    renderReadouts($('#m8-metrics'), [
      { k: T('m8.mModules'), v: a.modules != null ? String(a.modules) : '8' },
      { k: T('m8.mModulesReady'), v: a.modules_ready != null ? String(a.modules_ready) : String(readyCount()) },
      { k: T('m8.mDomCharsZh'), v: a.dom_chars_zh != null ? String(a.dom_chars_zh) : '—' },
      { k: T('m8.mDomCharsEn'), v: a.dom_chars_en != null ? String(a.dom_chars_en) : '—' },
      { k: T('m8.mLoad'), v: a.load_ms != null ? String(a.load_ms) : '—', unit: 'ms' },
      { k: T('m8.mErrors'), v: a.console_errors != null ? String(a.console_errors) : '—' },
      { k: T('m8.mAxe'), v: a.a11y_axe_violations != null ? String(a.a11y_axe_violations) : (a.axe_violations != null ? String(a.axe_violations) : '—') },
      { k: T('m8.mCjk'), v: a.i18n_en_cjk_ratio != null ? (a.i18n_en_cjk_ratio * 100).toFixed(2) : '—', unit: '%' },
      { k: T('m8.mVersion'), v: a.app_version || APP_VERSION },
      { k: T('m8.mKernelAssertions'), v: (m.kernel && m.kernel.assertions != null)
          ? (String(m.kernel.assertions_passed != null ? m.kernel.assertions_passed : m.kernel.assertions) + ' / ' + String(m.kernel.assertions))
          : '—', cls: (m.kernel && m.kernel.assertions) ? 'is-ok' : null },
      { k: T('m8.mCrossChecks'), v: (m.kernel && m.kernel.cross_checks != null) ? String(m.kernel.cross_checks) : '—' },
      { k: T('m8.mAudioAssertions'), v: (m.audio && m.audio.total != null)
          ? (String(m.audio.passed) + ' / ' + String(m.audio.total)) : '—',
        cls: (m.audio && m.audio.failed === 0) ? 'is-ok' : null },
      { k: T('m8.mAudioCents', { g: (m.audio && m.audio.single_tone_groups) || '—' }),
        v: (m.audio && m.audio.max_single_tone_cents_error != null) ? fmt(m.audio.max_single_tone_cents_error, 6) : '—',
        unit: T('ui.centsShort') },
      { k: T('m8.mAudioBeat', { g: (m.audio && m.audio.beat_groups) || '—' }),
        v: (m.audio && m.audio.max_beat_hz_error != null) ? fmt(m.audio.max_beat_hz_error, 6) : '—',
        unit: 'Hz' },
      { k: T('m8.mPending'), v: String(pending), cls: pending ? 'is-error' : 'is-ok' }
    ]);

    const tuning = W.TuningData ? (W.TuningData.systems || []) : [];
    const hist = W.HistoryData ? (W.HistoryData.events || []) : [];
    const world = W.WorldData ? (W.WorldData.regions || []) : [];
    const gl = W.GlossaryData ? (W.GlossaryData.terms || []) : [];
    const tsum = (W.TuningData && W.TuningData.summary) || {};
    const tuningCount = (tsum.tunings != null) ? tsum.tunings : tuning.length;
    const derivedCount = (tsum.derived != null) ? tsum.derived : 0;
    renderReadouts($('#m8-sources'), [
      { k: T('m8.srcTuning'), v: String(tuningCount) + (derivedCount ? ' (+' + derivedCount + ')' : '') },
      { k: T('m8.srcHistory'), v: String(hist.length) },
      { k: T('m8.srcWorld'), v: String(world.length) },
      { k: T('m8.srcGlossary'), v: String(gl.length) },
      { k: T('m8.srcStatus'), v: 'verified / pending / computed' }
    ]);

    const cmds = [
      { k: T('m8.runKernel'), v: 'py -X utf8 _kernel/verify_kernel.py' },
      { k: T('m8.runExport'), v: 'py -X utf8 _kernel/export_tables.py' },
      { k: T('m8.runCross'), v: 'node 11_同律_国际专项赛/01_作品本体/同律-律学交互实验室/test/cross_check.js' },
      { k: T('m8.runMerge'), v: 'py -X utf8 11_同律_国际专项赛/_pipeline/merge_metrics.py' },
      { k: T('m8.runBuildData'), v: 'py -X utf8 11_同律_国际专项赛/_pipeline/build_data_js.py' },
      { k: T('m8.runGate'), v: 'py -X utf8 _gate/gate_all.py' }
    ];
    const cmdHost = $('#m8-cmds');
    if (cmdHost) {
      cmdHost.textContent = '';
      cmds.forEach((c) => {
        const li = el('li', 'cmd-item');
        li.appendChild(el('span', 'cmd-k', null, c.k));
        li.appendChild(el('span', 'cmd-v', null, c.v));
        cmdHost.appendChild(li);
      });
    }
    // 单源：页面数字一律取自 data/metrics.js（由 metrics_app.json 生成），渲染时不另测
    const appM = (m && m.app) || {};
    figuresInto('#m8-figures', [
      figComputed(T('m8.mModules'), appM.modules != null ? String(appM.modules) : '-', '', null),
      figComputed(T('m8.mDomCharsZh'), appM.dom_chars_zh != null ? String(appM.dom_chars_zh) : '-', '', null),
      figComputed(T('m8.mDomCharsEn'), appM.dom_chars_en != null ? String(appM.dom_chars_en) : '-', '', null),
      figComputed(T('m8.mLoad'), appM.load_ms != null ? String(appM.load_ms) : '-', 'ms', null)
    ]);
  }

  function renderGlossary() {
    const host = $('#m8-glossary');
    if (!host) return;
    const data = W.GlossaryData || {};
    const terms = data.terms || [];
    const cats = data.categories || [];
    const catMap = {};
    cats.forEach((c) => { catMap[c.id] = state.lang === 'zh' ? c.name_zh : c.name_en; });
    const q = (($('#m8-search') || {}).value || '').trim().toLowerCase();
    const list = terms.filter((t) => {
      if (!q) return true;
      return (t.term_en || '').toLowerCase().indexOf(q) >= 0
        || (t.term_zh || '').toLowerCase().indexOf(q) >= 0
        || (t.def_zh || '').indexOf(q) >= 0
        || (t.def_en || '').toLowerCase().indexOf(q) >= 0;
    });
    host.textContent = '';
    list.forEach((t) => {
      const item = el('div', 'glossary-item');
      const head = el('div', 'g-term', null, state.lang === 'zh' ? t.term_zh : t.term_en);
      head.appendChild(el('small', null, null, state.lang === 'zh' ? t.term_en : t.term_zh));
      head.appendChild(el('span', 'g-cat', null, catMap[t.cat] || t.cat));
      item.appendChild(head);
      item.appendChild(el('p', 'g-def', null, state.lang === 'zh' ? t.def_zh : t.def_en));
      host.appendChild(item);
    });
    if (!list.length) host.appendChild(el('p', 'g-def', null, T('m8.glossaryEmpty')));
    const cnt = $('#m8-glossary-count');
    if (cnt) cnt.textContent = T('m8.glossaryCount', { n: list.length, c: cats.length });
  }

  function bindM8() {
    const s = $('#m8-search');
    if (s) s.addEventListener('input', renderGlossary);
  }

  /* ==================================================================
   * 7 · 各模块注册与生命周期
   * ================================================================== */
  const MODULE_DEFS = {
    m1: { title: 'm1.title', bind: bindM1, render: m1Render },
    m2: { title: 'm2.title', bind: bindM2, render: () => { renderM2Presets(); } },
    m3: { title: 'm3.title', bind: bindM3, render: m3Render },
    m4: { title: 'm4.title', bind: bindM4, render: m4Render },
    m5: { title: 'm5.title', bind: bindM5, render: m5Render },
    m6: { title: 'm6.title', bind: bindM6, render: m6Render },
    m7: { title: 'm7.title', bind: bindM7, render: () => { renderM7Frets(); } },
    m8: { title: 'm8.title', bind: bindM8, render: renderM8Metrics }
  };

  const lazyDone = {};
  function lazyMount(id) {
    if (lazyDone[id]) return;
    lazyDone[id] = true;
    const def = MODULE_DEFS[id];
    if (!def) return;
    try { if (def.render) def.render(); } catch (e) { /* 单模块失败不拖垮页面 */ }
    // 槽位懒挂载
    $$('[data-viz]', $('#m' + id.slice(1))).forEach((slot) => lazyMountSlot(slot));
    const mod = MODULES.filter((m) => m.id === id)[0];
    if (mod) mod.mounted = true;
  }

  function initModules() {
    MODULE_IDS.forEach((id, i) => {
      const host = D.getElementById(id);
      const mod = {
        id: id,
        index: i,
        el: host,
        ready: false,
        mounted: false,
        hasViz: !!(host && host.querySelector('[data-viz]'))
      };
      MODULES.push(mod);
    });
    // 静态绑定（廉价）：8 个模块在启动时全部可用
    MODULE_IDS.forEach((id) => {
      const def = MODULE_DEFS[id];
      try { if (def && def.bind) def.bind(); } catch (e) { /* noop */ }
    });
    // 初始化数据依赖部分
    try { M3_PITCHES.push.apply(M3_PITCHES, m3Pitches()); } catch (e) { /* noop */ }
    try { m1Render(); } catch (e) { /* noop */ }
    try { renderM2Presets(); } catch (e) { /* noop */ }
    try { m3Render(); } catch (e) { /* noop */ }
    try { m4Render(); renderM4Timeline(); } catch (e) { /* noop */ }
    try { renderM5Regions(); m5Render(); } catch (e) { /* noop */ }
    try { m6Render(); } catch (e) { /* noop */ }
    try { renderM7Frets(); } catch (e) { /* noop */ }
    try { renderM8Metrics(); renderGlossary(); } catch (e) { /* noop */ }

    MODULES.forEach((m) => { m.ready = true; });
    $$('.mod').forEach((el) => { if (observer) observer.observe(el); });
    $$('.viz-slot').forEach((el) => { if (observer) observer.observe(el); });
  }

  function readyCount() {
    return MODULES.filter((m) => m.ready).length;
  }

  /* ==================================================================
   * 8 · 双语
   * ================================================================== */
  function applyLang(lang, remember) {
    state.lang = (lang === 'en') ? 'en' : 'zh';
    if (W.I18N) {
      W.I18N.setLang(state.lang, { remember: remember !== false });
      try { W.I18N.apply(D, state.lang); } catch (e) { /* noop */ }
    }
    $$('[data-lang-toggle]').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-lang-toggle') === state.lang));
    });
    // 动态内容重绘
    try { document.title = T('meta.docTitle', { v: APP_VERSION }); } catch (e) { /* noop */ }
    const fv = $('#footVersion');
    if (fv) fv.textContent = T('foot.version', { v: APP_VERSION });
    try { m1Render(); } catch (e) { /* noop */ }
    try { renderM2Presets(); } catch (e) { /* noop */ }
    try { m3Render(); } catch (e) { /* noop */ }
    try { m4Render(); renderM4Timeline(); } catch (e) { /* noop */ }
    try { renderM5Regions(); m5Render(); } catch (e) { /* noop */ }
    try { m6Render(); } catch (e) { /* noop */ }
    try { renderM7Frets(); } catch (e) { /* noop */ }
    try { renderM8Metrics(); renderGlossary(); } catch (e) { /* noop */ }
    // 可视化组件切语言：先 setLang（组件内部文案），再按新语言重算 state 重绘
    Object.keys(vizState).forEach((k) => {
      const inst = vizState[k];
      if (inst && typeof inst.setLang === 'function') {
        try { inst.setLang(state.lang); } catch (e) { /* noop */ }
      }
    });
    Object.keys(VIZ_SPECS).forEach((sid) => { refreshSlot(sid); });
    updateNavLabels();
    updateCover();
    try { measureCache = null; } catch (e) { /* noop */ }
    return state.lang;
  }

  /* ==================================================================
   * 9 · 导航、进度、封面
   * ================================================================== */
  function updateNavLabels() {
    $$('.module-nav [data-module-target]').forEach((b) => {
      const id = b.getAttribute('data-module-target');
      const mod = MODULES.filter((m) => m.id === id)[0];
      b.setAttribute('aria-current', String(id === currentModule));
      b.setAttribute('title', id.toUpperCase() + ' · ' + T('nav.' + id));
      if (mod && mod.ready) b.setAttribute('data-ready', '1');
    });
  }

  function setModule(target) {
    const id = typeof target === 'number' ? 'm' + (target + 1) : String(target);
    const el2 = D.getElementById(id);
    if (!el2) return false;
    currentModule = id;
    updateNavLabels();
    lazyMount(id);
    if (typeof el2.scrollIntoView === 'function') {
      el2.scrollIntoView({ behavior: state.motion ? 'smooth' : 'auto', block: 'start' });
    }
    return true;
  }

  function onScroll() {
    const doc = D.documentElement;
    const max = (doc.scrollHeight - W.innerHeight) || 1;
    const pct = clamp((W.pageYOffset || doc.scrollTop || 0) / max, 0, 1);
    const bar = $('#progressBar');
    if (bar) bar.style.width = (pct * 100).toFixed(2) + '%';

    // 视口内最靠上的模块成为当前模块
    let active = currentModule;
    const probe = (W.pageYOffset || 0) + (W.innerHeight * 0.32);
    MODULE_IDS.forEach((id) => {
      const el2 = D.getElementById(id);
      if (!el2) return;
      const top = el2.offsetTop;
      if (top <= probe) active = id;
    });
    if (active !== currentModule) {
      currentModule = active;
      updateNavLabels();
    }
    if (W.__app) W.__app.activeModule = currentModule;
  }

  function updateCover() {
    const total = $('#coverTotal');
    if (!total) return;
    const tsum2 = (W.TuningData && W.TuningData.summary) || {};
    const systems = (tsum2.tunings != null) ? tsum2.tunings
      : (W.TuningData && W.TuningData.systems ? W.TuningData.systems.length : 0);
    const terms = W.GlossaryData && W.GlossaryData.terms ? W.GlossaryData.terms.length : 0;
    total.textContent = T('meta.coverStats', { m: 8, s: systems, n: terms });
  }

  function drawCoverLines() {
    const g = $('#coverLines');
    if (!g) return;
    g.textContent = '';
    const cx = 600, cy = 310;
    for (let i = 0; i <= 12; i++) {
      const ang = (i * 701.955 / 1200) * Math.PI * 2 - Math.PI / 2;
      const r = 60 + i * 21;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      const c = svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: i === 12 ? 3.4 : 2.1, fill: 'currentColor', opacity: i === 12 ? '0.95' : '0.55' });
      g.appendChild(c);
      if (i > 0) {
        const pr = 60 + (i - 1) * 21;
        const pang = ((i - 1) * 701.955 / 1200) * Math.PI * 2 - Math.PI / 2;
        const line = svgEl('line', {
          x1: (cx + Math.cos(pang) * pr).toFixed(1), y1: (cy + Math.sin(pang) * pr).toFixed(1),
          x2: x.toFixed(1), y2: y.toFixed(1),
          stroke: 'currentColor', 'stroke-width': '0.7', opacity: '0.30'
        });
        g.appendChild(line);
      }
    }
    // 七个八度的同心圆（对照）
    for (let k = 1; k <= 4; k++) {
      g.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: 60 + k * 63, fill: 'none',
        stroke: 'currentColor', 'stroke-width': '0.5', opacity: '0.16', 'stroke-dasharray': '2 6'
      }));
    }
  }

  /* ==================================================================
   * 10 · 内置降级可视化（viz/*.js 缺失时使用；标注 BUILTIN）
   * ================================================================== */
  function vizFrame(host, w, h) {
    host.textContent = '';
    const wrap = el('div', 'viz-fallback');
    const svg = svgEl('svg', { viewBox: '0 0 ' + w + ' ' + h, width: '100%', role: 'presentation', focusable: 'false' });
    wrap.appendChild(svg);
    host.appendChild(wrap);
    return { wrap: wrap, svg: svg, w: w, h: h };
  }
  /* 自绘降级时只在控制台留一行诊断，绝不把工程备注写进界面 */
  function vizNote(host, txt) {
    try {
      if (W.console && W.console.debug) W.console.debug('[viz] ' + host.id + ' builtin fallback（' + txt + '）');
    } catch (e) { /* noop */ }
  }

  function drawSpiralFallback(host, which) {
    const f = vizFrame(host, 640, 380);
    const cx = 320, cy = 190;
    const n = which === 'm1' ? state.m1.steps : state.m3.active;
    const steps = which === 'm1' ? n : n;
    for (let i = 0; i <= steps; i++) {
      const cents = i * 701.955;
      const ang = (cents / 1200) * Math.PI * 2 - Math.PI / 2;
      const r = 34 + i * 21;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i > 0) {
        const pa = ((i - 1) * 701.955 / 1200) * Math.PI * 2 - Math.PI / 2;
        const pr = 34 + (i - 1) * 21;
        f.svg.appendChild(svgEl('line', {
          x1: (cx + Math.cos(pa) * pr).toFixed(1), y1: (cy + Math.sin(pa) * pr).toFixed(1),
          x2: x.toFixed(1), y2: y.toFixed(1), stroke: 'var(--cyan)', 'stroke-width': '1.1', opacity: '0.62'
        }));
      }
      f.svg.appendChild(svgEl('circle', { cx: x.toFixed(1), cy: y.toFixed(1), r: i === 0 ? 4 : 2.6, fill: i === 0 ? 'var(--gold)' : 'var(--cyan)' }));
    }
    if (steps >= 12) {
      // 缺口：第十二步终点与起点的差
      const ang12 = (12 * 701.955 / 1200) * Math.PI * 2 - Math.PI / 2;
      const r12 = 34 + 12 * 21;
      const x12 = cx + Math.cos(ang12) * r12;
      const y12 = cy + Math.sin(ang12) * r12;
      f.svg.appendChild(svgEl('line', {
        x1: x12.toFixed(1), y1: y12.toFixed(1), x2: cx.toFixed(1), y2: cy.toFixed(1),
        stroke: 'var(--red)', 'stroke-width': '1.2', 'stroke-dasharray': '4 4', opacity: '0.85'
      }));
      const t = svgEl('text', {
        x: (cx + 10).toFixed(1), y: (cy - 14).toFixed(1), fill: 'var(--red-text)',
        'font-size': '12', 'font-family': 'monospace'
      });
      t.textContent = '+' + fmt(m1Gap(12), 2);
      f.svg.appendChild(t);
    }
    // 八度参考环
    for (let k = 0; k < 4; k++) {
      f.svg.appendChild(svgEl('circle', {
        cx: cx, cy: cy, r: 34 + k * (21 * 7 / 12), fill: 'none',
        stroke: 'var(--gold)', 'stroke-width': '0.5', opacity: '0.20', 'stroke-dasharray': '2 5'
      }));
    }
    vizNote(host, 'spiral5th');
    return { update: () => { drawSpiralFallback(host, which); }, highlight: () => {}, resize: () => {}, destroy: () => {}, setLang: () => {} };
  }

  function drawMonochordFallback(host, which) {
    const f = vizFrame(host, 660, 200);
    const r = which === 'm2' ? state.m2.ratio : 0.75;
    const x0 = 40, x1 = 620, len = x1 - x0;
    f.svg.appendChild(svgEl('line', { x1: x0, y1: 70, x2: x1, y2: 70, stroke: 'var(--light)', 'stroke-width': '1.6', opacity: '0.85' }));
    f.svg.appendChild(svgEl('line', { x1: x0, y1: 30, x2: x0, y2: 110, stroke: 'var(--gold)', 'stroke-width': '2' }));
    f.svg.appendChild(svgEl('line', { x1: x1, y1: 30, x2: x1, y2: 110, stroke: 'var(--gold)', 'stroke-width': '2' }));
    const bx = x0 + len * r;
    f.svg.appendChild(svgEl('line', { x1: bx, y1: 30, x2: bx, y2: 118, stroke: 'var(--cyan)', 'stroke-width': '2.2' }));
    f.svg.appendChild(svgEl('rect', { x: bx - 3, y: 116, width: 6, height: 9, fill: 'var(--cyan)' }));
    for (let i = 5; i < 100; i += 5) {
      const x = x0 + len * (i / 100);
      f.svg.appendChild(svgEl('line', { x1: x, y1: 74, x2: x, y2: 78, stroke: 'var(--light)', 'stroke-width': '0.6', opacity: '0.25' }));
    }
    const tx = function (x, y, txt, cls) {
      const t = svgEl('text', { x: x, y: y, fill: cls, 'font-size': '11', 'font-family': 'monospace' });
      t.textContent = txt;
      f.svg.appendChild(t);
    };
    tx(x0, 128, '0', 'var(--muted-2)');
    tx(x1 - 18, 128, '1.0', 'var(--muted-2)');
    tx(bx + 6, 152, 'L = ' + fmt(r, 3), 'var(--cyan-text)');

    return { update: () => drawMonochordFallback(host, which), highlight: () => {}, resize: () => {}, destroy: () => {}, setLang: () => {} };
  }

  function drawRulerInto(host, systems) {
    if (!host) return;
    const all = systems && systems.length ? systems : allSystems().slice(0, 3);
    const f = vizFrame(host, 720, 60 + all.length * 34);
    const left = 136, right = 700;
    const scale = (c) => left + (c / 1200) * (right - left);
    // 刻度
    for (let c = 0; c <= 1200; c += 100) {
      f.svg.appendChild(svgEl('line', { x1: scale(c), y1: 16, x2: scale(c), y2: 30, stroke: 'var(--light)', 'stroke-width': '0.6', opacity: '0.22' }));
      const t = svgEl('text', { x: scale(c), y: 12, fill: 'var(--muted-2)', 'font-size': '9', 'text-anchor': 'middle', 'font-family': 'monospace' });
      t.textContent = String(c);
      f.svg.appendChild(t);
    }
    all.forEach((s, ri) => {
      const y = 44 + ri * 34;
      const nm = svgEl('text', { x: 0, y: y + 4, fill: 'var(--muted)', 'font-size': '11' });
      nm.textContent = sysShort(s);
      f.svg.appendChild(nm);
      f.svg.appendChild(svgEl('line', { x1: left, y1: y, x2: right, y2: y, stroke: 'var(--line-soft)', 'stroke-width': '1' }));
      (s.cents || []).forEach((c) => {
        f.svg.appendChild(svgEl('circle', { cx: scale(c), cy: y, r: 3, fill: ri === 0 ? 'var(--gold)' : 'var(--cyan)' }));
      });
    });
    vizNote(host, 'centsRuler');
  }

  function drawRulerFallback(host) {
    return {
      update: (st) => drawRulerInto(host, (st && st.systems) ? st.systems : null),
      highlight: () => {}, resize: () => {}, destroy: () => {}, setLang: () => {}
    };
  }

  function drawMapFallback(host) {
    const regions = (W.WorldData && Array.isArray(W.WorldData.regions)) ? W.WorldData.regions : [];
    const f = vizFrame(host, 720, 300);
    const px = (lon) => 34 + ((clamp(lon, -180, 180) + 180) / 360) * 652;
    const py = (lat) => 22 + ((90 - clamp(lat, -90, 90)) / 180) * 256;
    for (let lon = -150; lon <= 150; lon += 30) {
      f.svg.appendChild(svgEl('line', { x1: px(lon), y1: 22, x2: px(lon), y2: 278,
        stroke: 'var(--line-soft)', 'stroke-width': '0.5' }));
    }
    for (let lat = -60; lat <= 60; lat += 30) {
      f.svg.appendChild(svgEl('line', { x1: 34, y1: py(lat), x2: 686, y2: py(lat),
        stroke: 'var(--line-soft)', 'stroke-width': '0.5' }));
    }
    regions.forEach((r) => {
      const on = r.id === state.m5.mapId;
      f.svg.appendChild(svgEl('circle', { cx: px(r.lon || 0), cy: py(r.lat || 0), r: on ? 7 : 5,
        fill: on ? 'var(--gold)' : 'var(--cyan)', opacity: '0.9' }));
      const t = svgEl('text', { x: px(r.lon || 0) + 9, y: py(r.lat || 0) + 4,
        fill: 'var(--light)', 'font-size': '10' });
      t.textContent = state.lang === 'zh' ? r.name_zh : r.name_en;
      f.svg.appendChild(t);
    });
    vizNote(host, 'worldmap');
    return { update: () => drawMapFallback(host), highlight: () => {}, resize: () => {},
             destroy: () => {}, setLang: () => {} };
  }

  function drawBellFallback(host) {
    const f = vizFrame(host, 340, 320);
    const cx = 170;
    // 钟体（程序化轮廓）
    const path = svgEl('path', {
      d: 'M 118 40 Q 170 20 222 40 L 232 120 Q 236 190 250 236 L 90 236 Q 104 190 108 120 Z',
      fill: 'rgba(200,163,90,0.10)', stroke: 'var(--gold)', 'stroke-width': '1.4'
    });
    f.svg.appendChild(path);
    // 舞（顶部提梁）
    f.svg.appendChild(svgEl('path', { d: 'M 150 34 Q 170 8 190 34', fill: 'none', stroke: 'var(--gold)', 'stroke-width': '1.4' }));
    // 正鼓部
    f.svg.appendChild(svgEl('circle', { cx: cx, cy: 170, r: 30, fill: 'rgba(110,143,163,0.16)', stroke: 'var(--cyan)', 'stroke-width': '1.2' }));
    f.svg.appendChild(svgEl('circle', { cx: cx, cy: 170, r: 6, fill: 'var(--cyan)' }));
    // 侧鼓部
    f.svg.appendChild(svgEl('circle', { cx: cx + 62, cy: 196, r: 18, fill: 'rgba(200,163,90,0.16)', stroke: 'var(--gold)', 'stroke-width': '1.2' }));
    f.svg.appendChild(svgEl('circle', { cx: cx + 62, cy: 196, r: 4, fill: 'var(--gold)' }));
    const lb = (x, y, txt, col) => {
      const t = svgEl('text', { x: x, y: y, fill: col, 'font-size': '11', 'text-anchor': 'middle' });
      t.textContent = txt;
      f.svg.appendChild(t);
    };
    lb(cx, 218, T('m6.bellFront'), 'var(--cyan-text)');
    lb(cx + 62, 232, T('m6.bellSide'), 'var(--gold-text)');
    lb(cx, 268, '+386.31', 'var(--gold-text)');

    const mkHit = (x, y, r, tone) => {
      const g = svgEl('g', { class: 'bell-hit', tabindex: '0', role: 'button', 'aria-label': tone === 'front' ? T('m6.bellHitFront') : T('m6.bellHitSide') });
      g.appendChild(svgEl('circle', { cx: x, cy: y, r: r, fill: 'transparent' }));
      const act = () => { state.m6.tone = tone; playBell(tone); m6Render(); };
      g.addEventListener('click', act);
      g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); act(); } });
      f.svg.appendChild(g);
    };
    mkHit(cx, 170, 34, 'front');
    mkHit(cx + 62, 196, 22, 'side');
    return { update: () => drawBellFallback(host), highlight: () => {}, resize: () => {}, destroy: () => {}, setLang: () => {} };
  }

  function drawSpectrumInto(host, partials) {
    if (!host) return;
    const list = partials || [];
    const w = 640, h = 200, pad = 30;
    const f = vizFrame(host, w, h);
    const maxHz = list.length ? list[list.length - 1].hz : 1;
    list.forEach((p, i) => {
      const x = pad + (p.hz / maxHz) * (w - pad * 2);
      const bh = 24 + (120 / (i + 1.4));
      f.svg.appendChild(svgEl('line', {
        x1: x, y1: h - pad, x2: x, y2: h - pad - bh,
        stroke: i === 0 ? 'var(--gold)' : 'var(--cyan)', 'stroke-width': '2.4', opacity: '0.85'
      }));
      const t = svgEl('text', { x: x, y: h - pad + 13, fill: 'var(--muted-2)', 'font-size': '9', 'text-anchor': 'middle', 'font-family': 'monospace' });
      t.textContent = fmt(p.hz, 0);
      f.svg.appendChild(t);
    });
    f.svg.appendChild(svgEl('line', { x1: pad, y1: h - pad, x2: w - pad, y2: h - pad, stroke: 'var(--line)', 'stroke-width': '1' }));
    const cap = svgEl('text', { x: pad, y: 18, fill: 'var(--muted-2)', 'font-size': '10' });
    cap.textContent = T('m6.specTitle');
    f.svg.appendChild(cap);
  }

  function drawSpectrumFallback(host) {
    return {
      update: (st) => drawSpectrumInto(host, st && st.partials),
      highlight: () => {}, resize: () => {}, destroy: () => {}, setLang: () => {}
    };
  }

  function drawFretboardInto(host, fret) {
    if (!host) return;
    const w = 660, h = 150, x0 = 30, x1 = 630;
    const f = vizFrame(host, w, h);
    // 指板
    f.svg.appendChild(svgEl('rect', { x: x0, y: 52, width: x1 - x0, height: 34, fill: 'rgba(240,236,226,0.05)', stroke: 'var(--line-soft)' }));
    // 琴枕
    f.svg.appendChild(svgEl('rect', { x: x0 - 4, y: 46, width: 5, height: 46, fill: 'var(--gold)' }));
    // 品丝：ET 位置
    for (let n = 1; n <= 12; n++) {
      const d = FRET_L * (1 - Math.pow(2, -n / 12));
      const x = x0 + (d / FRET_L) * (x1 - x0);
      f.svg.appendChild(svgEl('line', {
        x1: x, y1: 52, x2: x, y2: 86,
        stroke: n === fret ? 'var(--gold)' : 'var(--cyan)', 'stroke-width': n === fret ? '2.2' : '1'
      }));
      const t = svgEl('text', { x: x, y: 104, fill: n === fret ? 'var(--gold-text)' : 'var(--muted-2)', 'font-size': '9', 'text-anchor': 'middle', 'font-family': 'monospace' });
      t.textContent = String(n);
      f.svg.appendChild(t);
    }
    // 纯律位置（同音级附近）
    const jc = justCentsFor(fret);
    const jx = x0 + ((FRET_L * (1 - Math.pow(2, -jc / 1200))) / FRET_L) * (x1 - x0);
    f.svg.appendChild(svgEl('circle', { cx: jx, cy: 40, r: 4, fill: 'var(--red)' }));
    const jt = svgEl('text', { x: jx, y: 30, fill: 'var(--red-text)', 'font-size': '9', 'text-anchor': 'middle' });
    jt.textContent = T('m7.fretJust');
    f.svg.appendChild(jt);
    const cap = svgEl('text', { x: x0, y: 134, fill: 'var(--muted-2)', 'font-size': '10' });
    cap.textContent = 'd = L(1 - 2^(-n/12))';
    f.svg.appendChild(cap);
  }

  function drawStretchInto(host) {
    if (!host) return;
    const w = 620, h = 220, pad = 34;
    const f = vizFrame(host, w, h);
    const xs = [], ys = [];
    for (let k = 0; k <= 40; k++) {
      const oct = -4 + (k / 40) * 7.25;              // A0…C8（相对 A4 的八度）
      const dev = oct >= 0 ? 30 * Math.pow(oct / 3.25, 1.55) : -30 * Math.pow(-oct / 4, 1.5);
      xs.push(oct); ys.push(dev);
    }
    const px = (oct) => pad + ((oct + 4) / 7.25) * (w - pad * 2);
    const py = (dev) => h / 2 - (dev / 36) * (h / 2 - pad);
    // 零线
    f.svg.appendChild(svgEl('line', { x1: pad, y1: py(0), x2: w - pad, y2: py(0), stroke: 'var(--line)', 'stroke-width': '1', 'stroke-dasharray': '3 4' }));
    let d = '';
    xs.forEach((x, i) => { d += (i ? ' L ' : 'M ') + px(x).toFixed(1) + ' ' + py(ys[i]).toFixed(1); });
    f.svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: 'var(--red)', 'stroke-width': '1.8', opacity: '0.9' }));
    const lab = (x, y, txt, col, anchor) => {
      const t = svgEl('text', { x: x, y: y, fill: col, 'font-size': '9', 'text-anchor': anchor || 'middle', 'font-family': 'monospace' });
      t.textContent = txt;
      f.svg.appendChild(t);
    };
    lab(px(-4), py(0) + 14, 'A0', 'var(--muted-2)');
    lab(px(0), py(0) + 14, 'A4', 'var(--muted-2)');
    lab(px(3.25), py(0) + 14, 'C8', 'var(--muted-2)');
    lab(pad - 4, py(30) + 3, '+30', 'var(--red-text)', 'end');
    lab(pad - 4, py(-30) + 3, '-30', 'var(--red-text)', 'end');
    lab(pad, 16, T('m7.stretchRubric'), 'var(--muted-2)', 'start');
    vizNote(host, 'railsback');
  }

  function drawIsochordInto(host, systems) {
    if (!host) return;
    const w = 660, h = 240, pad = 40;
    const f = vizFrame(host, w, h);
    const list = systems && systems.length ? systems : m7CompareSystems();
    const px = (i) => pad + (i / 11) * (w - pad * 2);
    const py = (c) => h / 2 - (c / 30) * (h / 2 - pad);
    f.svg.appendChild(svgEl('line', { x1: pad, y1: h / 2, x2: w - pad, y2: h / 2, stroke: 'var(--line)', 'stroke-width': '1', 'stroke-dasharray': '3 4' }));
    const colors = ['var(--gold)', 'var(--cyan)', 'var(--red)', '#9FC4A8', '#B8A8D9'];
    list.forEach((s, si) => {
      let d = '';
      (s.cents || []).forEach((c, i) => {
        const dev = c - i * 100;
        d += (i ? ' L ' : 'M ') + px(i).toFixed(1) + ' ' + py(dev).toFixed(1);
      });
      f.svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: colors[si % colors.length], 'stroke-width': '1.6', opacity: '0.92' }));
      const t = svgEl('text', { x: w - pad, y: pad + si * 14, fill: colors[si % colors.length], 'font-size': '10', 'text-anchor': 'end' });
      t.textContent = sysShort(s);
      f.svg.appendChild(t);
    });
    for (let i = 0; i < 12; i++) {
      f.svg.appendChild(svgEl('line', { x1: px(i), y1: h / 2 - 3, x2: px(i), y2: h / 2 + 3, stroke: 'var(--muted-2)', 'stroke-width': '1' }));
      const t = svgEl('text', { x: px(i), y: h - 12, fill: 'var(--muted-2)', 'font-size': '8', 'text-anchor': 'middle', 'font-family': 'monospace' });
      t.textContent = SEMI_NAMES[i];
      f.svg.appendChild(t);
    }
    vizNote(host, 'isochord');
  }

  function drawIsochordFallback(host) {
    return {
      update: (st) => drawIsochordInto(host, st && st.systems),
      highlight: () => {}, resize: () => {}, destroy: () => {}, setLang: () => {}
    };
  }

  /* ==================================================================
   * 11 · 数字条（figures）
   * ================================================================== */
  function figuresInto(sel, items) {
    const host = $(sel);
    if (!host) return;
    host.textContent = '';
    items.forEach((it) => {
      const li = el('li');
      li.appendChild(el('span', 'fig-k', null, it.k));
      li.appendChild(el('span', 'fig-v', null, it.v));
      if (it.unit) li.appendChild(el('span', 'fig-u', null, it.unit));
      if (it.src) {
        li.appendChild(el('span', 'fig-src' + (it.src === 'computed' ? ' is-computed' : ''), null,
          it.src === 'computed' ? T('ui.liveComputed') : T('ui.fromMetrics')));
      }
      host.appendChild(li);
    });
  }
  function figComputed(k, v, unit, metricKey) {
    const m = W.__metrics || {};
    let src = 'computed';
    let val = v;
    if (metricKey && metricKey.indexOf('kernel.') === 0) {
      const kk = metricKey.split('.')[1];
      const mv = m.kernel && m.kernel[kk];
      if (mv != null && isNum(Number(mv)) && Number(mv) !== 0) { val = fmt(Number(mv), 4); src = 'metrics'; }
    }
    return { k: k, v: val, unit: unit, src: src };
  }

  /* ==================================================================
   * 12 · 播放状态标记
   * ================================================================== */
  let playingBtn = null;
  let playingTimer = 0;
  function markPlaying(btn) {
    if (playingBtn && playingBtn !== btn) {
      playingBtn.classList.remove('is-playing');
      playingBtn.removeAttribute('data-playing');
    }
    playingBtn = btn || null;
    if (btn) {
      btn.classList.add('is-playing');
      btn.setAttribute('data-playing', '1');
    }
    W.clearTimeout(playingTimer);
    if (btn) {
      playingTimer = W.setTimeout(() => {
        if (playingBtn) { playingBtn.classList.remove('is-playing'); playingBtn.removeAttribute('data-playing'); }
        playingBtn = null;
      }, 2600);
    }
  }

  function setMuted(m) {
    soundMuted = !!m;
    state.muted = soundMuted;
    if (soundMuted) stopAllSound();
    const b = $('#soundToggle');
    if (b) {
      b.setAttribute('aria-pressed', String(soundMuted));
      const lb = b.querySelector('.tool-label');
      if (lb) lb.textContent = soundMuted ? T('ui.soundOff') : T('ui.stopAllShort');
      b.setAttribute('title', soundMuted ? T('ui.soundOff') : T('ui.stopAll'));
    }
    return soundMuted;
  }

  /* ==================================================================
   * 13 · 测量（供自测/门禁用）
   * ================================================================== */
  let measureCache = null;
  const LOAD_MS = (function () {
    try {
      const t = W.performance && W.performance.timing;
      if (t && t.domContentLoadedEventEnd && t.navigationStart) return Math.max(0, t.domContentLoadedEventEnd - t.navigationStart);
      if (W.performance && W.performance.now) return Math.round(W.performance.now());
    } catch (e) { /* noop */ }
    return 0;
  })();
  function appLoadMs() { return LOAD_MS; }

  function bodyText(lang) {
    const src = D.body;
    const txt = src ? (src.innerText || src.textContent || '') : '';
    return txt;
  }
  function measureChars(lang) {
    return cjkCount(bodyText(lang));
  }
  /** i18n 完整性：两语言每个键都必须有非空值 */
  function i18nAudit() {
    if (!W.I18N) return ['no-i18n'];
    const bad = [];
    try {
      W.I18N.langs.forEach((lang) => {
        W.I18N.keys().forEach((k) => {
          const v = W.I18N.flat[lang][k];
          if (v === undefined || v === null || String(v).trim() === '') bad.push(lang + ':' + k);
        });
      });
    } catch (e) { bad.push('audit-error'); }
    return bad;
  }

  /** i18n 键泄漏：正文里不应出现形如 a.b 的字典键（渲染失败才会出现）。
      白名单：文件名后缀（.js/.py/.json…）、版本号、域名类短串。 */
  const FILE_EXT = /^(js|json|css|html|htm|md|py|mp4|pdf|png|jpg|jpeg|svg|gif|txt|yml|yaml|zip|docx|pptx|xlsx|csv|wav|mp3|asr|ps1|bat)$/;
  function i18nLeaks() {
    const body = (D.body && (D.body.innerText || D.body.textContent)) || '';
    const out = [];
    try {
      const re = /\b([a-z][a-z0-9_]{1,20})\.([a-z][a-z0-9_]{1,24})\b/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        if (FILE_EXT.test(m[2])) continue;                 // 文件名，不是 i18n 键
        if (/^(py|node|npm|npx|sh|cd|ls|rm|git)$/.test(m[1])) continue;
        out.push(m[0]);
        if (out.length >= 40) break;
      }
      // EN 模式不得出现仓库路径 / 中文括注 / 中文冒号来源标注
      if (state.lang === 'en') {
        ['_research/', '详见', '来源清单', 'Source：'].forEach((pat) => {
          if (body.indexOf(pat) >= 0) out.push(pat);
        });
      }
    } catch (e) { /* noop */ }
    return out;
  }

  function measureAll() {
    if (measureCache) return measureCache;
    const txt = bodyText();
    const cjk = cjkCount(txt);
    const en = (txt.match(/[A-Za-z]/g) || []).length;
    measureCache = {
      total_chars: txt.length,
      cjk_chars: cjk,
      latin_chars: en,
      cjk_ratio: txt.length ? +(cjk / Math.max(1, cjk + en)).toFixed(4) : 0
    };
    return measureCache;
  }

  /* ==================================================================
   * 14 · 启动
   * ================================================================== */
  function bindGlobal() {
    // 语言切换
    $$('[data-lang-toggle]').forEach((b) => {
      b.addEventListener('click', () => {
        const l = b.getAttribute('data-lang-toggle');
        if (l && l !== state.lang) applyLang(l);
      });
    });
    // 模块导航
    $$('[data-module-target]').forEach((b) => {
      b.addEventListener('click', () => setModule(b.getAttribute('data-module-target')));
    });
    // 静音 / 停止
    const snd = $('#soundToggle');
    if (snd) snd.addEventListener('click', () => { setMuted(!soundMuted); });
    // 回到顶部
    const top = $('#backTop');
    if (top) top.addEventListener('click', () => {
      W.scrollTo({ top: 0, behavior: state.motion ? 'smooth' : 'auto' });
      if (D.getElementById('main')) D.getElementById('main').focus({ preventScroll: true });
    });
    // 封面进入
    const start = $('#coverStart');
    if (start) start.addEventListener('click', () => setModule('m1'));
    // 进度与联动（被动监听，无轮询）
    let ticking = false;
    W.addEventListener('scroll', () => {
      if (ticking) return;
      ticking = true;
      W.requestAnimationFrame(() => { onScroll(); ticking = false; });
    }, { passive: true });
    W.addEventListener('resize', () => {
      Object.keys(vizState).forEach((k) => {
        const inst = vizState[k];
        if (inst && typeof inst.resize === 'function') { try { inst.resize(); } catch (e) { /* noop */ } }
      });
    }, { passive: true });
    // 减弱动效跟随系统
    try {
      const mq = W.matchMedia('(prefers-reduced-motion: reduce)');
      const sync = () => {
        if (mq.matches && state.motion) { state.motion = false; D.documentElement.setAttribute('data-reduced', '1'); }
      };
      sync();
      if (typeof mq.addEventListener === 'function') mq.addEventListener('change', sync);
    } catch (e) { /* noop */ }
    // 用户手势暖机：任意点击都 ensure 一次（避免每个按钮各自判断）
    D.addEventListener('pointerdown', function warm() {
      if (!soundMuted) ensureAudio();
      D.removeEventListener('pointerdown', warm);
    }, { passive: true });
  }

  function buildHooks() {
    W.__app = {
      version: APP_VERSION,
      lang: state.lang,
      activeModule: currentModule,
      state: state,
      modules: MODULES.map((m) => ({
        id: m.id,
        index: m.index,
        get ready() { return m.ready; },
        get mounted() { return m.mounted; },
        hasViz: m.hasViz
      })),
      setModule: function (i) { return setModule(i); },
      setLang: function (l) { return applyLang(l); },
      playTest: function (name) { return playTest(name); },
      measure: measureAll,
      loadMs: appLoadMs,
      kernelSource: K.__source,
      depsLoaded: Object.keys(DEP),
      vizEngine: function () {
        const out = {};
        $$('[data-viz]').forEach((s) => { if (s.id) out[s.id] = s.getAttribute('data-viz-engine') || 'none'; });
        return out;
      },
      i18nMissing: i18nAudit,
      i18nLeaks: i18nLeaks,
      readyCount: readyCount
    };
  }

  function playTest(name) {
    const map = {
      'm1.compare': playM1Compare,
      'm1.beat': playM1Beat,
      'm2.both': () => synthCall('chord', [C4, m2Freq(state.m2.ratio)], 2.0),
      'm3.wolf': () => synthCall('chord', [C4, K.hz_from_cents(C4, m1Gap(12))], 2.6),
      'm3.scale': () => M3_PITCHES.forEach((p, i) => W.setTimeout(() => synthCall('pluck', p.hz, 0.36), i * 140)),
      'm4.tet': () => m4Chord('tet12').forEach((f, i) => W.setTimeout(() => synthCall('organ', f, 1.2), i * 50)),
      'm5.a': () => playMelodyFor(state.m5.a),
      'm5.b': () => playMelodyFor(state.m5.b),
      'm6.front': () => playBell('front'),
      'm6.side': () => playBell('side'),
      'm6.both': () => playBell('both'),
      'm7.et': () => synthCall('pluck', K.hz_from_cents(C4, state.m7.fret * 100), 1.2)
    };
    const fn = map[name];
    if (!fn) return false;
    try { fn(); return true; } catch (e) { return false; }
  }

  function boot() {
    // 1) 先定语言（只写 <html lang>，不触发重绘）
    state.lang = W.I18N ? W.I18N.detectLang() : 'zh';
    if (W.I18N) {
      W.I18N.setLang(state.lang, { remember: false });
      try { W.I18N.apply(D, state.lang); } catch (e) { /* noop */ }
    }
    drawCoverLines();
    injectWorldTunings();
    // 2) 静态 DOM 全部就绪（8 个模块在这一步 ready）
    initModules();
    // 3) 全局事件
    bindGlobal();
    setMuted(false);
    // 4) 按当前语言把动态内容重绘一遍 + 同步 aria-pressed / 标题 / 页脚版本
    applyLang(state.lang, false);
    buildHooks();
    W.__CONCORD_READY__ = true;

    // 首屏后轻量收尾（不阻塞 DOM ready）
    W.setTimeout(() => {
      try { onScroll(); } catch (e) { /* noop */ }
      try { lazyMount('m1'); } catch (e) { /* noop */ }
    }, 0);
  }

  /* 依赖加载完成后再启动：先显示降级，再无缝接上组织件 */
  function start() {
    if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', bootOnce);
    else bootOnce();
  }
  let booted = false;
  function bootOnce() {
    if (booted) return;
    booted = true;
    loadOptionalDeps().then(() => {
      boot();
    }).catch(() => { boot(); });
  }

  start();
})(window, document);
