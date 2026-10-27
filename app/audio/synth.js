/* ============================================================================
 * audio/synth.js —《同律》CONCORD 确定性 Web Audio 音色引擎
 * ----------------------------------------------------------------------------
 * 用途
 *   把律学数字变成可听的声部：钟（非谐分音 + 指数衰减）、琴弦（Karplus-Strong，
 *   固定 LCG 种子 → 确定性）、管风琴（谐波叠加）。渲染层（OfflineAudioContext）
 *   可无人值守跑；播放层才需用户手势——本文件**不做任何自动播放**，由应用在
 *   用户点击后创建 AudioContext 并调用。
 *
 * 加载方式（作品本体是 file:// 双击即开的单页，不得用 ESM import）
 *   <script src="core/tuning.js"></script>
 *   <script src="audio/synth.js"></script>          →  全局 window.Synth
 *   const Synth = require('./audio/synth.js');       →  Node（测试）
 *
 * 输入 / 输出
 *   createSynth(ctx, options?) -> {bell, pluck, organ, chord, stopAll, ...}
 *     ctx : BaseAudioContext（AudioContext 或 **OfflineAudioContext** 均可）
 *     每个发声函数返回 voice 句柄 {stop(t), gain, nodes}
 *   analyze(buffers, options?) -> [{rms, peakDb, peakFrequency, peakCents, …}]
 *   fft / peakFrequency / detectBeat / centsError —— 测试用的频谱辅助
 *
 * 确定性保证（门禁 G1.4）
 *   1. 不依赖 Math.random：Karplus-Strong 的噪声用固定种子的线性同余发生器；
 *   2. 所有振荡器频率由调用参数直接给定，无随机失谐、无时间戳；
 *   3. 同一串调用在 OfflineAudioContext 上渲染出的样本可逐位复现。
 *
 * 复跑自检
 *   node 11_同律_国际专项赛/01_作品本体/同律-律学交互实验室/test/verify_audio.js
 *
 * 注意（门禁 G1.6 静态扫描）：本文件不含动态代码执行、网络请求、外部资源引用。
 * ========================================================================== */
(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;
  } else if (typeof window !== 'undefined') {
    window.Synth = api;
  } else if (global) {
    global.Synth = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ======================================================================
   * §0 依赖解析：钟体分音表与律制内核
   *   浏览器：<script> 已把 window.Tuning 挂好
   *   Node  ：同目录相对 require（../core/tuning.js）
   * ==================================================================== */

  var _tuningCache = null;

  function _tuning() {
    if (_tuningCache) { return _tuningCache; }
    if (typeof Tuning !== 'undefined' && Tuning && Tuning.BELL_PARTIALS) {
      _tuningCache = Tuning;
      return _tuningCache;
    }
    if (typeof module === 'object' && module && typeof require === 'function') {
      try {
        _tuningCache = require('../core/tuning.js');   // 仅在 Node 下走这里
        if (_tuningCache && _tuningCache.BELL_PARTIALS) { return _tuningCache; }
      } catch (e) { /* 落到下面统一报错 */ }
    }
    throw new Error('synth.js 需要先加载 core/tuning.js（提供钟体分音表与律制常数）');
  }

  /* ======================================================================
   * §1 音色配方（工程常数；改这里要同步 test/audio_assertions.js 的期望）
   * ==================================================================== */

  var CFG = {
    // 主输出电平（线性），给多声部留 headroom
    masterGain: 0.7,
    // 起振/收尾时间（秒）
    attack: 0.004,
    release: 0.06,
    // 钟：每个分音的振幅缩放与衰减时间系数
    bellGain: 0.22,
    bellDecayScale: 1.2,
    bellDecayRolloff: 0.25,
    // 管风琴：谐波个数与幅度指数
    organHarmonics: 8,
    organAmpExp: 1.15,
    organGain: 0.34,
    // 琴弦：KS 衰减目标（dur 秒后残余幅度）
    pluckGain: 0.55,
    pluckTailRatio: 0.01,
    // 默认日程提前量（秒）：避免在 currentTime 边界调度的毛刺
    lead: 0.01
  };

  /* ======================================================================
   * §2 确定性噪声（线性同余发生器，固定种子 → 可复现的 Karplus-Strong 激励）
   * ==================================================================== */

  /** 32 位 LCG（Numerical Recipes 参数），返回 [0,1)。 */
  function makeLcg(seed) {
    var state = (seed === undefined ? 12345 : (seed >>> 0)) >>> 0;
    return function next() {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /* ======================================================================
   * §3 频谱工具（零依赖 FFT；测试与页面频谱图共用）
   * ==================================================================== */

  function nextPow2(n) {
    var p = 1;
    while (p < n) { p <<= 1; }
    return p;
  }

  /** 原地 radix-2 FFT；inverse=true 时做逆变换（不除 N，便于解析信号）。 */
  function fftComplex(re, im, inverse) {
    var n = re.length;
    if (n !== im.length || (n & (n - 1)) !== 0) {
      throw new RangeError('fftComplex: 长度必须为 2 的幂且 re/im 等长（收到 ' + n + '）');
    }
    var i, j, k, len, half, ang, wr, wi, cr, ci, ncr, ur, ui, vr, vi, t;
    for (i = 1, j = 0; i < n; i++) {
      var bit = n >> 1;
      for (; j & bit; bit >>= 1) { j ^= bit; }
      j ^= bit;
      if (i < j) {
        t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    var sign = inverse ? 1 : -1;
    for (len = 2; len <= n; len <<= 1) {
      half = len >> 1;
      ang = sign * 2 * Math.PI / len;
      wr = Math.cos(ang);
      wi = Math.sin(ang);
      for (i = 0; i < n; i += len) {
        cr = 1.0;
        ci = 0.0;
        for (k = 0; k < half; k++) {
          ur = re[i + k];
          ui = im[i + k];
          vr = re[i + k + half] * cr - im[i + k + half] * ci;
          vi = re[i + k + half] * ci + im[i + k + half] * cr;
          re[i + k] = ur + vr;
          im[i + k] = ui + vi;
          re[i + k + half] = ur - vr;
          im[i + k + half] = ui - vi;
          ncr = cr * wr - ci * wi;
          ci = cr * wi + ci * wr;
          cr = ncr;
        }
      }
    }
  }

  /** Hann 窗（返回到新数组上，长度 n）。 */
  function hannWindow(n) {
    var w = new Float64Array(n);
    for (var i = 0; i < n; i++) {
      w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (n - 1));
    }
    return w;
  }

  function toFloatArray(x) {
    if (!x) { throw new RangeError('需要 Float32Array/Float64Array/Array/AudioBuffer'); }
    if (typeof x.getChannelData === 'function') { return x.getChannelData(0); }  // AudioBuffer
    if (x instanceof Float64Array || x instanceof Float32Array || Array.isArray(x)) {
      return x;
    }
    if (typeof x.length === 'number') { return x; }
    throw new RangeError('不支持的缓冲类型: ' + typeof x);
  }

  /**
   * 幅值谱（Hann 窗 + 补零 FFT）。页面频谱图（M6）与测试找峰共用。
   * @returns {{mag:Float64Array, nfft:number, df:number, sampleRate:number}}
   *          mag 长度 nfft/2+1，第 i 根谱线频率 = i * df
   */
  function magnitudeSpectrum(buffers, sampleRate, options) {
    var opts = options || {};
    var x = toFloatArray(buffers);
    var n = x.length;
    var nfft = opts.nfft || nextPow2(n * 4);
    if ((nfft & (nfft - 1)) !== 0 || nfft < n) { nfft = nextPow2(Math.max(n, 1024)); }
    var w = hannWindow(n);
    var re = new Float64Array(nfft);
    var im = new Float64Array(nfft);
    var mean = 0;
    var i;
    for (i = 0; i < n; i++) { mean += x[i]; }
    mean /= n;
    for (i = 0; i < n; i++) { re[i] = (x[i] - mean) * w[i]; }
    fftComplex(re, im, false);
    var half = nfft >> 1;
    var mag = new Float64Array(half + 1);
    for (i = 0; i <= half; i++) { mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); }
    return { mag: mag, nfft: nfft, df: sampleRate / nfft, sampleRate: sampleRate };
  }

  /**
   * 单音基频测量（供门禁 G1.4 的「单音 FFT 峰值误差 < 0.5 音分」）。
   * 步骤：Hann 窗 → 补零到 2 的幂 → FFT → 幅值峰值 → 对数幅值抛物线插值。
   * @returns {{frequency:number, magnitude:number, peakDb:number, nfft:number}}
   */
  function peakFrequency(buffers, sampleRate, options) {
    var opts = options || {};
    var spec = magnitudeSpectrum(buffers, sampleRate, opts);
    var mag = spec.mag;
    var nfft = spec.nfft;
    var half = nfft >> 1;
    var fminBin = Math.max(1, Math.floor((opts.fmin || 20) * nfft / sampleRate));
    var fmaxBin = Math.min(half - 1, Math.ceil((opts.fmax || sampleRate / 2) * nfft / sampleRate));
    var best = -1;
    var bestMag = -1;
    for (var i = fminBin; i <= fmaxBin; i++) {
      if (mag[i] > bestMag) { bestMag = mag[i]; best = i; }
    }
    var freq = best * sampleRate / nfft;
    // 对数幅值抛物线插值（Hann 主瓣内精度远优于 1 bin）
    if (best > 0 && best < half) {
      var y0 = Math.log(mag[best - 1] + 1e-300);
      var y1 = Math.log(mag[best] + 1e-300);
      var y2 = Math.log(mag[best + 1] + 1e-300);
      var den = y0 - 2 * y1 + y2;
      if (den !== 0) { freq = (best + 0.5 * (y0 - y2) / den) * sampleRate / nfft; }
    }
    return {
      frequency: freq,
      magnitude: bestMag,
      peakDb: 20 * Math.log10(bestMag / (nfft * 0.25) + 1e-300),
      nfft: nfft
    };
  }

  /** 解析信号包络（Hilbert）：正频率 ×2、负频率清零、逆变换取模。 */
  function analyticEnvelope(buffers) {
    var x = toFloatArray(buffers);
    var n = x.length;
    var nfft = nextPow2(n);
    var re = new Float64Array(nfft);
    var im = new Float64Array(nfft);
    for (var i = 0; i < n; i++) { re[i] = x[i]; }
    fftComplex(re, im, false);
    // 正频率加倍、负频率清零（0 与 Nyquist 保持）
    for (i = 1; i < nfft / 2; i++) {
      re[i] *= 2; im[i] *= 2;
      re[nfft - i] = 0; im[nfft - i] = 0;
    }
    fftComplex(re, im, true);
    var env = new Float64Array(n);
    for (i = 0; i < n; i++) {
      env[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / nfft;   // 逆变换未除 N
    }
    return env;
  }

  /**
   * 拍频测量（供门禁 G1.4 的「拍频包络与解析值误差 ≤ 0.2 Hz」）。
   * 包络 → 去均值 → Hann → 补零 FFT → 抛物线插值，返回包络基频（Hz）。
   */
  function detectBeat(buffers, sampleRate, options) {
    var opts = options || {};
    var env = analyticEnvelope(buffers);
    var n = env.length;
    var mean = 0;
    for (var i = 0; i < n; i++) { mean += env[i]; }
    mean /= n;
    var nfft = opts.nfft || nextPow2(n * 2);
    if (nfft < n || (nfft & (nfft - 1)) !== 0) { nfft = nextPow2(n); }
    var w = hannWindow(n);
    var re = new Float64Array(nfft);
    var im = new Float64Array(nfft);
    for (i = 0; i < n; i++) { re[i] = (env[i] - mean) * w[i]; }
    fftComplex(re, im, false);
    var half = nfft >> 1;
    var mag = new Float64Array(half + 1);
    for (i = 0; i <= half; i++) { mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]); }
    var lo = Math.max(1, Math.floor((opts.fmin || 0.2) * nfft / sampleRate));
    var hi = Math.min(half - 1, Math.ceil((opts.fmax || 25.0) * nfft / sampleRate));
    var best = lo, bestMag = -1;
    for (i = lo; i <= hi; i++) { if (mag[i] > bestMag) { bestMag = mag[i]; best = i; } }
    var f = best * sampleRate / nfft;
    if (best > 0 && best < half) {
      var y0 = Math.log(mag[best - 1] + 1e-300);
      var y1 = Math.log(mag[best] + 1e-300);
      var y2 = Math.log(mag[best + 1] + 1e-300);
      var den = y0 - 2 * y1 + y2;
      if (den !== 0) { f = (best + 0.5 * (y0 - y2) / den) * sampleRate / nfft; }
    }
    return { beatHz: f, magnitude: bestMag, nfft: nfft, envelopeLength: n };
  }

  /** 两个频率之间的音分差（用于把频率误差换成音分误差）。 */
  function centsError(measuredHz, expectedHz) {
    return 1200 * Math.log2(measuredHz / expectedHz);
  }

  /**
   * 批量分析缓冲（`analyze(buffers)`）——测试做 FFT 的统一入口。
   * @param {Array|AudioBuffer} buffers 一组缓冲（AudioBuffer / Float32Array）
   * @param {{sampleRate:number, expected?:Array<number>, fmin?:number}} options
   * @returns {Array<object>} 每个缓冲一项
   */
  function analyze(buffers, options) {
    var opts = options || {};
    var sr = opts.sampleRate;
    if (!sr) { throw new RangeError('analyze: 必须给 options.sampleRate'); }
    var list = Array.isArray(buffers) ? buffers : [buffers];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var x = toFloatArray(list[i]);
      var sum = 0, sq = 0, peak = 0;
      for (var k = 0; k < x.length; k++) {
        var v = x[k];
        sum += v;
        sq += v * v;
        if (Math.abs(v) > peak) { peak = Math.abs(v); }
      }
      var rms = Math.sqrt(sq / Math.max(1, x.length));
      var pf = peakFrequency(x, sr, opts);
      var rec = {
        index: i,
        sampleRate: sr,
        length: x.length,
        duration: x.length / sr,
        rms: rms,
        dc: sum / Math.max(1, x.length),
        peakAbs: peak,
        peakFrequency: pf.frequency,
        peakMagnitude: pf.magnitude,
        peakDb: pf.peakDb,
        nfft: pf.nfft
      };
      if (opts.expected && typeof opts.expected[i] === 'number') {
        rec.expected = opts.expected[i];
        rec.centsError = centsError(pf.frequency, opts.expected[i]);
      }
      out.push(rec);
    }
    return out;
  }

  /* ======================================================================
   * §4 音色实现
   * ==================================================================== */

  /** 取一个可用的音频上下文（默认主输出）。 */
  function _ctxOf(ctx) {
    if (!ctx || typeof ctx.createOscillator !== 'function') {
      throw new TypeError('createSynth(ctx): ctx 必须是 AudioContext 或 OfflineAudioContext');
    }
    return ctx;
  }

  /**
   * 创建音色引擎。
   * @param {BaseAudioContext} ctx
   * @param {{gain?:number, lead?:number}} options
   */
  function createSynth(ctx, options) {
    var C = _ctxOf(ctx);
    var opts = options || {};
    var T = _tuning();

    var master = C.createGain();
    master.gain.value = (opts.gain === undefined) ? CFG.masterGain : opts.gain;
    master.connect(C.destination);

    var voices = [];

    function t0Now() {
      var lead = (opts.lead === undefined) ? CFG.lead : opts.lead;
      return (C.currentTime || 0) + lead;
    }

    function registerVoice(nodes, sources, startTime) {
      var v = {
        nodes: nodes,
        sources: sources,
        startTime: startTime,
        stop: function (when) {
          var t = (when === undefined) ? (C.currentTime || 0) : when;
          for (var i = 0; i < sources.length; i++) {
            try { sources[i].stop(t); } catch (e) { /* 已停止 */ }
          }
          for (var j = 0; j < nodes.length; j++) {
            try { nodes[j].disconnect(); } catch (e2) { /* 已断开 */ }
          }
        }
      };
      voices.push(v);
      return v;
    }

    /* ---------------------------------------------------------------- 钟
     * 非谐分音（取自 core/tuning.js 的 BELL_PARTIALS）+ 每分音独立指数衰减。
     *
     * 为什么在 JS 里算样本、再用 AudioBufferSourceNode 播放（而不是每分音一个
     * OscillatorNode）：Chromium 的振荡器 + AudioParam 自动化在 float32 内部累积，
     * 同一串调用两次渲染会差 1 ULP —— 那样「确定性」只能精确到 −120 dBFS。
     * 钟的分音**本来就是数值可算的**（ratio × f0、指数衰减），直接算成缓冲后
     * 两次渲染**逐位相同**，门禁 G1.4 的确定性才是一个干净的真命题。
     */
    function bell(f0, dur, o) {
      var f = Number(f0);
      var d = Math.max(0.05, Number(dur) || 1.5);
      var oo = o || {};
      var sr = C.sampleRate;
      var parts = T.bell_partials(f, Math.min(T.BELL_PARTIALS.length, oo.partials || 12));
      var total = Math.max(9, Math.round(sr * (d + CFG.release)));
      var buf = new Float32Array(total);
      var attackS = Math.max(1, Math.round(CFG.attack * sr));
      var releaseS = Math.max(1, Math.round(CFG.release * sr));
      var relStart = Math.max(0, total - releaseS);
      for (var k = 0; k < parts.length; k++) {
        var p = parts[k];
        if (p.hz >= sr / 2) { continue; }             // 超过 Nyquist 的分音丢弃
        var amp = CFG.bellGain * p.amp;
        // 高分音衰减更快（钟体的高频辐射更"干"）
        var tauS = d * Math.min(1.0, CFG.bellDecayScale /
          (1.0 + CFG.bellDecayRolloff * (p.n - 1))) * 0.35;
        var omega = 2.0 * Math.PI * p.hz / sr;
        var decayPerSample = Math.exp(-1.0 / (tauS * sr));
        var env = 1.0;
        for (var i = 0; i < total; i++) {
          var a = 1.0;
          if (i < attackS) { a = i / attackS; }        // 起振（防爆音）
          if (i > relStart) { a *= (total - i) / releaseS; }  // 收尾淡出（防截断咔哒）
          buf[i] += amp * a * env * Math.sin(omega * i);
          env *= decayPerSample;
        }
      }
      // 归一化到 ±1 内（多分音相加可能超过 1）
      var peak = 0;
      for (var j = 0; j < total; j++) { var q = buf[j] < 0 ? -buf[j] : buf[j]; if (q > peak) { peak = q; } }
      if (peak > 1.0) {
        var inv = 1.0 / peak;
        for (j = 0; j < total; j++) { buf[j] *= inv; }
      }
      var audioBuf = C.createBuffer(1, total, sr);
      if (typeof audioBuf.copyToChannel === 'function') {
        audioBuf.copyToChannel(buf, 0);
      } else {
        audioBuf.getChannelData(0).set(buf);
      }
      var src = C.createBufferSource();
      src.buffer = audioBuf;
      var g = C.createGain();
      var t0 = t0Now();
      g.gain.setValueAtTime(1.0, t0);
      src.connect(g);
      g.connect(master);
      src.start(t0);
      src.stop(t0 + d + CFG.release + 0.01);
      return registerVoice([g], [src], t0);
    }

    /* ---------------------------------------------------------------- 弦
     * Karplus-Strong：噪声激励 + 延迟线低通反馈。为了**确定性**与**精确音高**
     * （Web Audio 的反馈回路最小延迟是一个渲染量子 128 样本，会量化音高），
     * 这里在 JS 里直接把波形算出来再交给 AudioBufferSourceNode 播放。
     */
    function pluck(f0, dur, o) {
      var f = Number(f0);
      var d = Math.max(0.05, Number(dur) || 1.5);
      var oo = o || {};
      var sr = C.sampleRate;
      // 延迟线长度：减去环路低通（两点平均）固有的 0.5 样本相位延迟，否则音会偏低；
      // 用**分数延迟**（线性插值）让音高不受整数样本量化限制。
      var Dtarget = Math.max(2.0, sr / f - 0.5);
      var N = Math.max(2, Math.floor(Dtarget));
      var frac = Dtarget - N;
      if (frac < 0) { frac = 0; }
      var total = Math.max(N + 3, Math.round(sr * (d + CFG.release)));
      var rnd = makeLcg(oo.seed === undefined ? 12345 : oo.seed);
      var buf = new Float32Array(total);
      // 激励：固定种子白噪声（确定性），并去掉均值 —— 环路对直流增益为 1，
      // 若激励有直流分量，拨弦会留下一个缓慢衰减的直流偏移（听感上是「扑」一下
      // 的低频撞击，测量上是 |dc| 偏大）。真实弦的位移期望为零，故这里显式归零。
      var i;
      var noiseSum = 0;
      for (i = 0; i < N; i++) { buf[i] = rnd() * 2 - 1; noiseSum += buf[i]; }
      var noiseMean = noiseSum / N;
      for (i = 0; i < N; i++) { buf[i] -= noiseMean; }
      // 反馈：y[n] = g * ( x[n-D] + x[n-D-1] ) / 2，x[·] 用线性插值分数延迟读出
      var g = Math.pow(CFG.pluckTailRatio, 1.0 / (sr * d));
      for (i = N; i < total; i++) {
        var i1 = Math.max(0, i - N - 1);
        var i2 = Math.max(0, i - N - 2);
        var v = (1 - frac) * buf[i - N] + frac * buf[i - N - 1 < 0 ? 0 : i - N - 1];
        var w = (1 - frac) * buf[i1] + frac * buf[i2];
        buf[i] = g * 0.5 * (v + w);
      }
      // 归一化到 ±1 内（KS 输出幅度随 N 变化）
      var peak = 0;
      for (i = 0; i < total; i++) { var a = Math.abs(buf[i]); if (a > peak) { peak = a; } }
      var norm = peak > 0 ? (CFG.pluckGain / peak) : CFG.pluckGain;
      for (i = 0; i < total; i++) { buf[i] *= norm; }

      var audioBuf = C.createBuffer(1, total, sr);
      if (typeof audioBuf.copyToChannel === 'function') {
        audioBuf.copyToChannel(buf, 0);
      } else {
        audioBuf.getChannelData(0).set(buf);
      }
      var src = C.createBufferSource();
      src.buffer = audioBuf;
      var gg = C.createGain();
      var t0 = t0Now();
      // 收尾淡出，避免截断产生咔哒声
      gg.gain.setValueAtTime(1.0, t0);
      gg.gain.setValueAtTime(1.0, t0 + Math.max(0.0, d - CFG.release));
      gg.gain.linearRampToValueAtTime(0.0, t0 + d);
      src.connect(gg);
      gg.connect(master);
      src.start(t0);
      src.stop(t0 + d + 0.01);
      return registerVoice([gg], [src], t0);
    }

    /* ---------------------------------------------------------------- 管风琴
     * 谐波叠加（严格整数倍 → FFT 上是等间距谱线；与钟的非谐分音形成对照）。
     */
    function organ(f0, dur, o) {
      var f = Number(f0);
      var d = Math.max(0.05, Number(dur) || 1.5);
      var oo = o || {};
      var t0 = t0Now();
      var nHarm = oo.harmonics || CFG.organHarmonics;
      var ampScale = (oo.amp === undefined) ? 1.0 : oo.amp;
      var nodes = [], srcs = [];
      var norm = 0;
      var h;
      for (h = 1; h <= nHarm; h++) { norm += Math.pow(h, -CFG.organAmpExp); }
      for (h = 1; h <= nHarm; h++) {
        var hz = f * h;
        if (hz >= C.sampleRate / 2) { continue; }
        var osc = C.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = hz;
        var g = C.createGain();
        var amp = CFG.organGain * ampScale * Math.pow(h, -CFG.organAmpExp) / norm;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(amp, t0 + CFG.attack);
        g.gain.setValueAtTime(amp, t0 + Math.max(CFG.attack, d - CFG.release));
        g.gain.linearRampToValueAtTime(0.0001, t0 + d);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + d + CFG.release);
        nodes.push(g); srcs.push(osc);
      }
      return registerVoice(nodes, srcs, t0);
    }

    /* ---------------------------------------------------------------- 和弦
     * 同音色多音叠加（等幅，便于拍音实验：两音等幅时包络= |2A cos(πΔf t)|）。
     */
    function chord(freqs, dur, o) {
      var list = Array.isArray(freqs) ? freqs.slice() : [freqs];
      var d = Math.max(0.05, Number(dur) || 1.5);
      var oo = o || {};
      var each = 1.0 / Math.max(1, list.length);
      var vs = [];
      for (var i = 0; i < list.length; i++) {
        var sub = {};
        for (var key in oo) { if (Object.prototype.hasOwnProperty.call(oo, key)) { sub[key] = oo[key]; } }
        sub.amp = each;
        vs.push(organ(list[i], d, sub));
      }
      var nodes = [], srcs = [];
      for (var j = 0; j < vs.length; j++) {
        nodes = nodes.concat(vs[j].nodes);
        srcs = srcs.concat(vs[j].sources);
      }
      return registerVoice(nodes, srcs, vs.length ? vs[0].startTime : t0Now());
    }

    /** 立即停止所有已排程声部（离线渲染中通常不需要）。 */
    function stopAll() {
      for (var i = 0; i < voices.length; i++) { voices[i].stop(); }
      voices.length = 0;
    }

    /** 主输出电平（0..1）。 */
    function setGain(v) {
      var g = Number(v);
      if (!isFinite(g) || g < 0) { throw new RangeError('setGain: 需要非负有限数'); }
      master.gain.value = g;
      return g;
    }

    return {
      ctx: C,
      master: master,
      bell: bell,
      pluck: pluck,
      organ: organ,
      chord: chord,
      stopAll: stopAll,
      setGain: setGain,
      getVoiceCount: function () { return voices.length; }
    };
  }

  /* ======================================================================
   * §5 导出
   * ==================================================================== */

  return {
    VERSION: VERSION,
    CONFIG: CFG,
    createSynth: createSynth,
    // 确定性噪声（测试可用同一种子复现激励）
    makeLcg: makeLcg,
    // 频谱与测量辅助
    nextPow2: nextPow2,
    fftComplex: fftComplex,
    hannWindow: hannWindow,
    magnitudeSpectrum: magnitudeSpectrum,
    peakFrequency: peakFrequency,
    analyticEnvelope: analyticEnvelope,
    detectBeat: detectBeat,
    centsError: centsError,
    analyze: analyze,
    // camelCase 别名
    create_synth: createSynth,
    next_pow2: nextPow2,
    magnitude_spectrum: magnitudeSpectrum,
    peak_frequency: peakFrequency,
    analytic_envelope: analyticEnvelope,
    detect_beat: detectBeat,
    cents_error: centsError
  };
});
