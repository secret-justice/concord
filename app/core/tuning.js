/* ============================================================================
 * core/tuning.js —《同律》CONCORD 律制数学内核（JS 同构版）
 * ----------------------------------------------------------------------------
 * 用途
 *   浏览器与 Node 双端的律学计算内核，函数名 / 语义 / 数值与 Python 权威实现
 *   `_kernel/tuning.py` **一一对应**（同一份规格的两个实现）。
 *   数值一致性由 `test/cross_check.js` 逐值校验（相对误差 < 1e-12）。
 *
 * 加载方式（作品本体是 file:// 双击即开的单页，**不得用 ESM import**）
 *   <script src="core/tuning.js"></script>      →  全局 window.Tuning
 *   const T = require('./core/tuning.js');      →  Node（测试/交叉校验）
 *
 * 输入 / 输出
 *   纯函数，无副作用、无 I/O、无定时器。频率单位 Hz，音分单位 cent。
 *   非法输入（0 / 负数 / 非数值 / 非有限值 / ratio<=0）一律 **throw**，
 *   不静默返回 NaN 或默认值 —— 与 Python 侧 `ValueError` 对应（JS 用 RangeError）。
 *
 * 数值口径（改这里必须同步改 tuning.py 与断言）
 *   基准音        A4 = 440 Hz；黄钟（C4）= 261.6255653005986 Hz
 *   音分          cents(f1,f2) = 1200*log2(f2/f1)
 *   八度折叠      normalize_octave(r) 折到 [1,2)
 *   三分损益      下生 = 弦长×2/3 → 频率×3/2；上生 = 弦长×4/3 → 频率×3/4
 *                 生律次序固定：黄钟→林钟→太簇→南吕→姑洗→应钟→蕤宾→大吕→
 *                 夷则→夹钟→无射→仲吕
 *   毕氏音差      3^12/2^19 = 531441/524288 = 23.4600103846 音分
 *   新法密率      2^(1/12) = 1.0594630943592953（朱载堉 1584《律学新说》）
 *
 * 复跑自检
 *   node 11_同律_国际专项赛/01_作品本体/同律-律学交互实验室/test/cross_check.js
 *
 * 注意（门禁 G1.6 静态扫描）：本文件是纯计算模块——不含动态代码执行、
 * 不含任何网络请求 API、不引用任何外部资源（本行刻意不写出那些 API 的标识符，
 * 免得被按字面扫描的静态检查误报）。
 * ========================================================================== */
(function (global, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module && module.exports) {
    module.exports = api;                            // Node（cross_check / verify / 打包脚本）
  } else if (typeof window !== 'undefined') {
    window.Tuning = api;                             // 浏览器（<script> 直接加载）
  } else if (global) {
    global.Tuning = api;                             // 其它宿主（Web Worker 等）
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.0.0';

  /* ======================================================================
   * §0 常量（与 tuning.py §0 逐项对应）
   * ==================================================================== */

  var A4_HZ = 440.0;
  var C4_HZ = A4_HZ / Math.pow(2.0, 9.0 / 12.0);   // = 261.6255653005986
  var EQUAL_TEMPERED_SEMITONE_CENTS = 100.0;
  var PYTHAGOREAN_COMMA_NUM = 531441;              // = 3^12
  var PYTHAGOREAN_COMMA_DEN = 524288;              // = 2^19
  var PYTHAGOREAN_COMMA_RATIO = 531441 / 524288;   // 1.0136432647705078…
  var PYTHAGOREAN_COMMA_CENTS = 1200.0 * Math.log2(Math.pow(3, 12) / Math.pow(2, 19));
  var PYTHAGOREAN_FIFTH_CENTS = 1200.0 * Math.log2(1.5);
  var SYNTONIC_COMMA_NUM = 81;
  var SYNTONIC_COMMA_DEN = 80;
  var SYNTONIC_COMMA_RATIO = 81 / 80;
  var SYNTONIC_COMMA_CENTS = 1200.0 * Math.log2(81.0 / 80.0);
  var JI_MAJOR_THIRD_CENTS = 1200.0 * Math.log2(5.0 / 4.0);

  var LU_NAMES = ['黄钟', '林钟', '太簇', '南吕', '姑洗', '应钟',
    '蕤宾', '大吕', '夷则', '夹钟', '无射', '仲吕'];
  var LU_PITCH = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'A#', 'F'];
  var LU_PINYIN = ['huangzhong', 'linzhong', 'taicu', 'nanlv', 'guxi', 'yingzhong',
    'ruibin', 'dalv', 'yize', 'jiazhong', 'wushe', 'zhonglv'];
  var CHROMATIC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  //: 中庸律音名（降号侧口径，与 cents 升序一一对应；与通行文献表一致）
  var MEANTONE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

  //: 纯律（5-limit）十二半音比值：[num, den]（与 tuning.py JI_RATIOS 一致）
  var JI_RATIOS = [[1, 1], [16, 15], [9, 8], [6, 5], [5, 4], [4, 3],
    [45, 32], [3, 2], [8, 5], [5, 3], [9, 5], [15, 8]];

  //: M2「律尺」预设（弦长比 → 频率比见 length_to_ratio）
  var STRING_PRESETS = [
    { label_zh: '八度 1/2', label_en: 'Octave 1/2', length_ratio: 0.5, note: '2:1' },
    { label_zh: '纯五度 2/3', label_en: 'Fifth 2/3', length_ratio: 2.0 / 3.0, note: '3:2' },
    { label_zh: '纯四度 3/4', label_en: 'Fourth 3/4', length_ratio: 3.0 / 4.0, note: '4:3' },
    { label_zh: '纯律大三度 4/5', label_en: 'JI major third 4/5', length_ratio: 4.0 / 5.0, note: '5:4' },
    { label_zh: '纯律大六度 5/8', label_en: 'JI major sixth 5/8', length_ratio: 5.0 / 8.0, note: '8:5' },
    { label_zh: '毕氏大三度 64/81', label_en: 'Pythagorean major third 64/81',
      length_ratio: 64.0 / 81.0, note: '81:64' },
    { label_zh: '密率 2^(-1/12)', label_en: 'Mi-lü 2^(-1/12)',
      length_ratio: Math.pow(2.0, -1.0 / 12.0), note: '2^(1/12)' }
  ];

  //: 钟体分音（前 5 个为标准分音结构，其余为工程近似；与 tuning.py BELL_PARTIALS 一致）
  var BELL_PARTIALS = [
    { n: 1, name: 'hum', name_zh: '嗡音', ratio: 0.500, amp: 0.42 },
    { n: 2, name: 'prime', name_zh: '基音', ratio: 1.000, amp: 1.00 },
    { n: 3, name: 'tierce', name_zh: '三度音', ratio: 1.200, amp: 0.55 },
    { n: 4, name: 'quint', name_zh: '五度音', ratio: 1.500, amp: 0.38 },
    { n: 5, name: 'nominal', name_zh: '名义音', ratio: 2.000, amp: 0.62 },
    { n: 6, name: 'deciem', name_zh: '上八度', ratio: 2.500, amp: 0.20 },
    { n: 7, name: 'undeciem', name_zh: '上九度', ratio: 2.667, amp: 0.16 },
    { n: 8, name: 'duodeciem', name_zh: '上十度', ratio: 3.011, amp: 0.13 },
    { n: 9, name: 'upper1', name_zh: '高 1', ratio: 3.596, amp: 0.09 },
    { n: 10, name: 'upper2', name_zh: '高 2', ratio: 4.166, amp: 0.07 },
    { n: 11, name: 'upper3', name_zh: '高 3', ratio: 5.433, amp: 0.05 },
    { n: 12, name: 'upper4', name_zh: '高 4', ratio: 6.796, amp: 0.035 }
  ];

  /* ======================================================================
   * §1 输入校验（对应 tuning.py §1；非法输入一律 throw）
   * ==================================================================== */

  function _fail(msg) {
    throw new RangeError(msg);
  }

  function _num(x, name) {
    if (typeof x === 'string' || typeof x === 'boolean') {
      _fail(name + ' 必须是数值，收到 ' + typeof x + ': ' + String(x) +
        '（字符串/布尔不自动转换）');
    }
    if (typeof x !== 'number') {
      _fail(name + ' 必须是数值，收到 ' + (x === null ? 'null' : typeof x));
    }
    if (!isFinite(x)) { _fail(name + ' 必须是有限数，收到 ' + String(x)); }
    return x;
  }

  function _pos(x, name) {
    var v = _num(x, name);
    if (v <= 0.0) { _fail(name + ' 必须 > 0（收到 ' + v + '）——频率/比值/长度不存在非正值'); }
    return v;
  }

  function _intPos(x, name, minimum) {
    var min = (minimum === undefined) ? 1 : minimum;
    if (typeof x !== 'number' || !Number.isInteger(x)) {
      _fail(name + ' 必须是整数，收到 ' + (typeof x) + ': ' + String(x));
    }
    if (x < min) { _fail(name + ' 必须 >= ' + min + '，收到 ' + x); }
    return x;
  }

  function _intRange(x, name, lo, hi) {
    if (typeof x !== 'number' || !Number.isInteger(x)) {
      _fail(name + ' 必须是整数，收到 ' + (typeof x) + ': ' + String(x));
    }
    if (x < lo || x > hi) { _fail(name + ' 必须在 ' + lo + '..' + hi + '，收到 ' + x); }
    return x;
  }

  /* ======================================================================
   * §2 基础换算
   * ==================================================================== */

  function cents(f1, f2) {
    var a = _pos(f1, 'f1'), b = _pos(f2, 'f2');
    return 1200.0 * Math.log2(b / a);
  }

  function hz_from_cents(base_hz, cents_value) {
    var base = _pos(base_hz, 'base_hz');
    var c = _num(cents_value, 'cents_value');
    return base * Math.pow(2.0, c / 1200.0);
  }

  function ratio_to_cents(ratio) {
    return 1200.0 * Math.log2(_pos(ratio, 'ratio'));
  }

  function cents_to_ratio(cents_value) {
    return Math.pow(2.0, _num(cents_value, 'cents_value') / 1200.0);
  }

  function normalize_octave(ratio) {
    var r = _pos(ratio, 'ratio');
    var n = Math.floor(Math.log2(r));
    var r2 = r / Math.pow(2.0, n);
    if (r2 >= 2.0) { r2 /= 2.0; } else if (r2 < 1.0) { r2 *= 2.0; }
    return r2;
  }

  function length_to_ratio(length_ratio) {
    return 1.0 / _pos(length_ratio, 'length_ratio');
  }

  function midi_to_hz(midi, a4_hz) {
    var m = _num(midi, 'midi');
    var a4 = (a4_hz === undefined) ? A4_HZ : _pos(a4_hz, 'a4_hz');
    return a4 * Math.pow(2.0, (m - 69.0) / 12.0);
  }

  function hz_to_midi(hz, a4_hz) {
    var a4 = (a4_hz === undefined) ? A4_HZ : _pos(a4_hz, 'a4_hz');
    return 69.0 + 12.0 * Math.log2(_pos(hz, 'hz') / a4);
  }

  /* ======================================================================
   * §3 三分损益（整数精确运算：num/den 均为可精确表示的整数，最后一次除法）
   * ==================================================================== */

  /** 第 step 律相对上一律的生成方向（古典弦长口径）：null=起点。 */
  function _sanfenOp(step) {
    if (step === 1) { return null; }
    return (step % 2 === 0) ? '下生' : '上生';
  }

  /** 第 step 律相对黄钟的未折叠频率比，返回 [num, den]（整数，精确）。 */
  function _sanfenFrac(step) {
    _intPos(step, 'step');
    if (step > 12) {
      _fail('三分损益只有 12 律（step 1..12），收到 step=' + step +
        '；闭环检验请用 sanfen_sunyi().closure');
    }
    var num = 1, den = 1;
    for (var k = 2; k <= step; k++) {
      if (_sanfenOp(k) === '下生') { num *= 3; den *= 2; }   // 频率 ×3/2
      else { num *= 3; den *= 4; }                            // 频率 ×3/4
    }
    return [num, den];
  }

  /** 把 [num, den] 折到 [1,2)（整数域折叠，与 Python 结果逐位一致）。 */
  function _foldFrac(num, den) {
    while (num >= 2 * den) { den *= 2; }
    return [num, den];
  }

  function sanfen_ratio(step) {
    var f = _foldFrac.apply(null, _sanfenFrac(step));
    return f[0] / f[1];
  }

  function sanfen_hz(step, base_hz) {
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    return base * sanfen_ratio(step);
  }

  function sanfen_sunyi(base_hz) {
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    var steps = [];
    for (var i = 1; i <= 12; i++) {
      var op = _sanfenOp(i);
      var raw = _sanfenFrac(i);
      var fold = _foldFrac(raw[0], raw[1]);
      var rOct = fold[0] / fold[1];
      var rRaw = raw[0] / raw[1];
      var lenNum = raw[1], lenDen = raw[0];          // 弦长比 = 频率比倒数
      steps.push({
        step: i,
        name: LU_NAMES[i - 1],
        pitch: LU_PITCH[i - 1],
        pinyin: LU_PINYIN[i - 1],
        operation: op === null ? null : (op + '×' + (op === '下生' ? '2/3' : '4/3')),
        operation_freq: op === null ? null : ('×' + (op === '下生' ? '3/2' : '3/4')),
        length_ratio: lenNum / lenDen,
        ratio_delta: op === null ? null : (op === '下生' ? 1.5 : 0.75),
        ratio_raw: rRaw,
        ratio_expr: raw[0] + '/' + raw[1],
        ratio_octave: rOct,
        hz: base * rOct,
        cents_from_base: 1200.0 * Math.log2(rOct)
      });
    }
    var r12 = _foldFrac.apply(null, _sanfenFrac(12));
    var cloNum = r12[0] * 3, cloDen = r12[1] * 4;     // 上生 ×3/4
    var cloFold = _foldFrac(cloNum, cloDen);
    var cloRatio = cloFold[0] / cloFold[1];
    var twelveFifths = 12.0 * PYTHAGOREAN_FIFTH_CENTS;
    var sevenOctaves = 7.0 * 1200.0;
    return {
      base_hz: base,
      steps: steps,
      closure: {
        next_operation: '上生×4/3',
        next_operation_freq: '×3/4',
        ratio_raw: cloRatio,
        ratio_expr: cloFold[0] + '/' + cloFold[1],
        cents: 1200.0 * Math.log2(cloRatio),
        twelve_fifths_cents: twelveFifths,
        seven_octaves_cents: sevenOctaves,
        cents_from_fifths: twelveFifths - sevenOctaves
      },
      closure_cents: 1200.0 * Math.log2(cloRatio)
    };
  }

  /* ======================================================================
   * §4 n 等分八度律（12-TET / 19 / 24 / 53 …）
   * ==================================================================== */

  function et_step_cents(divisions) {
    var d = _intPos(divisions === undefined ? 12 : divisions, 'divisions');
    return 1200.0 / d;
  }

  function et_ratio(index, divisions) {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      _fail('index 必须是整数，收到 ' + (typeof index) + ': ' + String(index));
    }
    var d = _intPos(divisions === undefined ? 12 : divisions, 'divisions');
    return Math.pow(2.0, index / d);
  }

  function et_cents(index, divisions) {
    if (typeof index !== 'number' || !Number.isInteger(index)) {
      _fail('index 必须是整数，收到 ' + (typeof index) + ': ' + String(index));
    }
    var d = _intPos(divisions === undefined ? 12 : divisions, 'divisions');
    return 1200.0 * index / d;
  }

  function et_hz(index, divisions, base_hz) {
    var d = (divisions === undefined) ? 12 : divisions;
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    return base * et_ratio(index, d);
  }

  function equal_temperament(divisions, base_hz) {
    var d = _intPos(divisions === undefined ? 12 : divisions, 'divisions');
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    var out = [];
    for (var i = 0; i < d; i++) {
      var r = Math.pow(2.0, i / d);
      out.push({
        index: i,
        cents: 1200.0 * i / d,
        ratio: r,
        hz: base * r,
        name: (d === 12) ? CHROMATIC_NAMES[i % 12] : (i + '/' + d),
        pitch: (d === 12) ? CHROMATIC_NAMES[i % 12] : (i + '/' + d),
        octave: (d === 12) ? Math.floor(i / 12) : 0
      });
    }
    return out;
  }

  /* ======================================================================
   * §5 纯律（5-limit just intonation）
   * ==================================================================== */

  function ji_ratio(index) {
    _intRange(index, 'index', 0, 11);
    return JI_RATIOS[index][0] / JI_RATIOS[index][1];
  }

  function ji_cents(index) {
    return 1200.0 * Math.log2(ji_ratio(index));
  }

  function just_intonation(base_hz) {
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    var out = [];
    for (var i = 0; i < 12; i++) {
      var num = JI_RATIOS[i][0], den = JI_RATIOS[i][1];
      var r = num / den;
      var c = 1200.0 * Math.log2(r);
      out.push({
        index: i,
        cents: c,
        ratio: r,
        ratio_expr: num + '/' + den,
        hz: base * r,
        name: CHROMATIC_NAMES[i],
        deviation_from_et_cents: c - (1200.0 * i / 12)
      });
    }
    return out;
  }

  /* ======================================================================
   * §6 中庸律（默认 1/4 音差）
   * ==================================================================== */

  function mt_fifth_cents(comma_fraction) {
    var f = _num(comma_fraction === undefined ? 0.25 : comma_fraction, 'comma_fraction');
    if (!(f >= 0.0 && f <= 1.0)) { _fail('comma_fraction 必须在 [0,1]，收到 ' + f); }
    return PYTHAGOREAN_FIFTH_CENTS - f * SYNTONIC_COMMA_CENTS;
  }

  function _meantoneCentsTable(comma_fraction) {
    var f = (comma_fraction === undefined) ? 0.25 : comma_fraction;
    var fifth = mt_fifth_cents(f);
    var raw = [];
    // 取音范围 = 五度链 E♭ … G♯（链序号 k = −3 … +8），与通行文献表 / research 数据
    // 同一口径（降号侧）。用升号侧（D♯/E♯/A♯）会在 3 个音上差 128/125 = 41.0589 音分。
    for (var k = -3; k <= 8; k++) { raw.push([_mod1200(k * fifth), k]); }
    raw.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
    return raw.map(function (t) { return t[0]; });
  }

  /** 折到 [0,1200)：JS 的 % 对负数返回负值，必须显式归一（与 Python 语义对齐）。 */
  function _mod1200(x) {
    var m = x % 1200.0;
    return m < 0 ? m + 1200.0 : m;
  }

  function mt_cents(index, comma_fraction) {
    _intRange(index, 'index', 0, 11);
    return _meantoneCentsTable(comma_fraction)[index];
  }

  function mt_ratio(index, comma_fraction) {
    return Math.pow(2.0, mt_cents(index, comma_fraction) / 1200.0);
  }

  function meantone(comma_fraction, base_hz) {
    var f = _num(comma_fraction === undefined ? 0.25 : comma_fraction, 'comma_fraction');
    if (!(f >= 0.0 && f <= 1.0)) { _fail('comma_fraction 必须在 [0,1]，收到 ' + f); }
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    var list = _meantoneCentsTable(f);
    var wolf = 8400.0 - 11.0 * mt_fifth_cents(f);
    var out = [];
    for (var i = 0; i < 12; i++) {
      var r = Math.pow(2.0, list[i] / 1200.0);
      out.push({
        index: i,
        cents: list[i],
        ratio: r,
        hz: base * r,
        name: MEANTONE_NAMES[i],
        fifth_cents: mt_fifth_cents(f),
        wolf_fifth_cents: wolf
      });
    }
    return out;
  }

  /* ======================================================================
   * §7 威克迈斯特 III（Werckmeister, 1691）
   * ==================================================================== */

  var _WM3_TEMPERED_FIFTHS = [1, 2, 3, 6];   // C-G, G-D, D-A, B-F#
  var _WM3_COMPENSATION_CENTS = PYTHAGOREAN_COMMA_CENTS / 4.0;

  function _wm3CentsTable() {
    var fifth = PYTHAGOREAN_FIFTH_CENTS;
    var narrow = _WM3_COMPENSATION_CENTS;
    var acc = 0.0;
    var chain = [];
    for (var k = 1; k <= 12; k++) {
      var step = fifth - (_WM3_TEMPERED_FIFTHS.indexOf(k) >= 0 ? narrow : 0.0);
      acc += step;
      if (k < 12) { chain.push([acc % 1200.0, k]); }
    }
    chain.push([0.0, 0]);
    chain.sort(function (a, b) { return (a[0] - b[0]) || (a[1] - b[1]); });
    return chain.map(function (t) { return t[0]; });
  }

  function wm_cents(index) {
    _intRange(index, 'index', 0, 11);
    return _wm3CentsTable()[index];
  }

  function wm_ratio(index) {
    return Math.pow(2.0, wm_cents(index) / 1200.0);
  }

  function werckmeister_iii(base_hz) {
    var base = (base_hz === undefined) ? C4_HZ : _pos(base_hz, 'base_hz');
    var list = _wm3CentsTable();
    var out = [];
    for (var i = 0; i < 12; i++) {
      var r = Math.pow(2.0, list[i] / 1200.0);
      out.push({
        index: i, cents: list[i], ratio: r, hz: base * r, name: CHROMATIC_NAMES[i]
      });
    }
    return out;
  }

  /* ======================================================================
   * §8 钟体分音 / 泛音列 / 品丝 / 拍频
   * ==================================================================== */

  function bell_ratio(index) {
    _intRange(index, 'index', 0, BELL_PARTIALS.length - 1);
    return BELL_PARTIALS[index].ratio;
  }

  function bell_amp(index) {
    _intRange(index, 'index', 0, BELL_PARTIALS.length - 1);
    return BELL_PARTIALS[index].amp;
  }

  function bell_hz(index, f0) {
    return _pos(f0, 'f0') * bell_ratio(index);
  }

  function bell_partials(f0, n) {
    var f = _pos(f0, 'f0');
    var k = _intPos(n === undefined ? 12 : n, 'n');
    if (k > BELL_PARTIALS.length) {
      _fail('n 最多 ' + BELL_PARTIALS.length + '（分音表长度），收到 ' + k);
    }
    var out = [];
    for (var i = 0; i < k; i++) {
      var p = BELL_PARTIALS[i];
      out.push({
        n: p.n, ratio: p.ratio, hz: f * p.ratio,
        amp: p.amp, name: p.name, name_zh: p.name_zh
      });
    }
    return out;
  }

  function harmonic_ratio(n) {
    return _intPos(n, 'n');
  }

  function harmonic_hz(n, f0) {
    var k = _intPos(n, 'n');
    var base = (f0 === undefined) ? C4_HZ : _pos(f0, 'f0');
    return k * base;
  }

  function harmonic_series(f0, n) {
    var f = _pos(f0, 'f0');
    var k = _intPos(n === undefined ? 12 : n, 'n');
    var out = [];
    for (var i = 1; i <= k; i++) {
      out.push({
        n: i, ratio: i, hz: f * i, amp: 1.0 / i,
        cents_from_f0: 1200.0 * Math.log2(i)
      });
    }
    return out;
  }

  function fret_remaining_ratio(n) {
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      _fail('n 必须是整数，收到 ' + (typeof n) + ': ' + String(n));
    }
    return Math.pow(2.0, -n / 12.0);
  }

  function fret_distance(length, n) {
    var L = _pos(length, 'length');
    if (typeof n !== 'number' || !Number.isInteger(n)) {
      _fail('n 必须是整数，收到 ' + (typeof n) + ': ' + String(n));
    }
    return L * (1.0 - Math.pow(2.0, -n / 12.0));
  }

  function fret_positions(length, n) {
    var L = _pos(length, 'length');
    var k = _intPos(n === undefined ? 12 : n, 'n');
    var out = [];
    for (var i = 1; i <= k; i++) {
      var rem = Math.pow(2.0, -i / 12.0);
      out.push({
        n: i,
        distance: L * (1.0 - rem),
        remaining_length: L * rem,
        remaining_ratio: rem,
        cents: 100.0 * i
      });
    }
    return out;
  }

  function beat_frequency(f1, f2) {
    return Math.abs(_pos(f1, 'f1') - _pos(f2, 'f2'));
  }

  /* ======================================================================
   * §9 通用表校验（与 tuning.py validate_cents_table 同义）
   * ==================================================================== */

  function validate_cents_table(table, expected_total) {
    if (!table || typeof table.length !== 'number') {
      _fail('validate_cents_table: 输入必须是数组/类数组');
    }
    var vals = [];
    for (var i = 0; i < table.length; i++) {
      var row = table[i];
      if (row && typeof row === 'object') {
        if (!('cents' in row)) {
          _fail('validate_cents_table: 第 ' + i + ' 项 dict 缺少 cents 键');
        }
        vals.push(_num(row.cents, 'table[' + i + '].cents'));
      } else if (typeof row === 'number') {
        vals.push(_num(row, 'table[' + i + ']'));
      } else {
        _fail('validate_cents_table: 第 ' + i + ' 项既不是对象也不是数值（' + typeof row + '）');
      }
    }
    var errors = [];
    if (vals.length < 2) { errors.push('音数过少：' + vals.length + '（至少 2）'); }
    for (var j = 0; j < vals.length; j++) {
      if (!(vals[j] >= -1e-9 && vals[j] < 1200.0 + 1e-9)) {
        errors.push('第 ' + j + ' 项音分 ' + vals[j] + ' 未归一到 [0,1200)');
      }
    }
    for (var m = 1; m < vals.length; m++) {
      if (!(vals[m] > vals[m - 1])) {
        errors.push('非严格递增：第 ' + (m - 1) + '=' + vals[m - 1] + ' → 第 ' + m + '=' + vals[m]);
      }
    }
    var steps = [];
    for (var s = 1; s < vals.length; s++) { steps.push(vals[s] - vals[s - 1]); }
    var wrap = 0.0, coverage = 0.0, span = 0.0;
    if (vals.length) {
      wrap = (vals[0] + 1200.0) - vals[vals.length - 1];
      coverage = steps.reduce(function (a, b) { return a + b; }, 0.0) + wrap;
      span = vals[vals.length - 1] - vals[0];
    }
    if (vals.length && Math.abs(coverage - 1200.0) > 1e-9) {
      errors.push('八度覆盖量 ' + coverage.toFixed(12) + ' != 1200（差 ' +
        (coverage - 1200.0).toExponential(3) + '）');
    }
    if (expected_total !== undefined && expected_total !== null) {
      var et = _num(expected_total, 'expected_total');
      if (Math.abs(coverage - et) > 1e-9) {
        errors.push('覆盖量 ' + coverage.toFixed(12) + ' != expected_total ' + et);
      }
    }
    if (errors.length) {
      throw new RangeError('validate_cents_table 未通过：\n  - ' + errors.join('\n  - '));
    }
    var allSteps = steps.concat(vals.length ? [wrap] : []);
    return {
      ok: true,
      n: vals.length,
      span: span,
      coverage: coverage,
      step_min: Math.min.apply(null, allSteps),
      step_max: Math.max.apply(null, allSteps),
      steps: allSteps,
      first: vals[0],
      last: vals[vals.length - 1]
    };
  }

  /* ======================================================================
   * §10 世界律制数据接入（数据归 research；JS 无文件系统，由调用方注入）
   * ==================================================================== */

  var _worldTunings = null;
  var _worldTuningsStatus = 'pending';

  /** 注入世界律制数据（应用在启动时把 data/tuning_data.js 的内容传进来）。 */
  function set_world_tunings(data) {
    if (data === null || data === undefined) {
      _worldTunings = null;
      _worldTuningsStatus = 'pending';
      return load_world_tunings();
    }
    if (typeof data !== 'object') { _fail('set_world_tunings: 需要一个对象或数组'); }
    _worldTunings = data;
    _worldTuningsStatus = 'ok';
    return load_world_tunings();
  }

  /** 查询世界律制数据状态（与 Python load_world_tunings 同义；不编造数据）。 */
  function load_world_tunings() {
    var items = [];
    if (_worldTunings) {
      items = Array.isArray(_worldTunings) ? _worldTunings
        : (_worldTunings.tunings || _worldTunings.items || []);
    }
    return {
      status: _worldTuningsStatus,
      data: _worldTunings,
      n_tunings: items.length,
      reason: _worldTuningsStatus === 'pending'
        ? '世界律制数据未注入（等待 research 成员产出 _research/data_tuning.json）'
        : ''
    };
  }

  /* ======================================================================
   * §11 标量便捷封装（交叉校验的标量入口）
   * ==================================================================== */

  function pythagorean_comma_cents() { return PYTHAGOREAN_COMMA_CENTS; }
  function syntonic_comma_cents() { return SYNTONIC_COMMA_CENTS; }

  /* ======================================================================
   * §12 导出（snake_case 与 Python 同名；camelCase 供应用层书写方便）
   * ==================================================================== */

  var api = {
    VERSION: VERSION,
    // 常量
    A4_HZ: A4_HZ,
    C4_HZ: C4_HZ,
    BASE_HZ: C4_HZ,
    EQUAL_TEMPERED_SEMITONE_CENTS: EQUAL_TEMPERED_SEMITONE_CENTS,
    PYTHAGOREAN_COMMA_NUM: PYTHAGOREAN_COMMA_NUM,
    PYTHAGOREAN_COMMA_DEN: PYTHAGOREAN_COMMA_DEN,
    PYTHAGOREAN_COMMA_RATIO: PYTHAGOREAN_COMMA_RATIO,
    PYTHAGOREAN_COMMA_CENTS: PYTHAGOREAN_COMMA_CENTS,
    PYTHAGOREAN_FIFTH_CENTS: PYTHAGOREAN_FIFTH_CENTS,
    SYNTONIC_COMMA_NUM: SYNTONIC_COMMA_NUM,
    SYNTONIC_COMMA_DEN: SYNTONIC_COMMA_DEN,
    SYNTONIC_COMMA_RATIO: SYNTONIC_COMMA_RATIO,
    SYNTONIC_COMMA_CENTS: SYNTONIC_COMMA_CENTS,
    JI_MAJOR_THIRD_CENTS: JI_MAJOR_THIRD_CENTS,
    LU_NAMES: LU_NAMES,
    LU_PITCH: LU_PITCH,
    LU_PINYIN: LU_PINYIN,
    CHROMATIC_NAMES: CHROMATIC_NAMES,
    MEANTONE_NAMES: MEANTONE_NAMES,
    JI_RATIOS: JI_RATIOS,
    STRING_PRESETS: STRING_PRESETS,
    BELL_PARTIALS: BELL_PARTIALS,

    // 基础
    cents: cents,
    hz_from_cents: hz_from_cents,
    ratio_to_cents: ratio_to_cents,
    cents_to_ratio: cents_to_ratio,
    normalize_octave: normalize_octave,
    length_to_ratio: length_to_ratio,
    midi_to_hz: midi_to_hz,
    hz_to_midi: hz_to_midi,

    // 三分损益
    sanfen_ratio: sanfen_ratio,
    sanfen_hz: sanfen_hz,
    sanfen_sunyi: sanfen_sunyi,

    // 等分律
    et_step_cents: et_step_cents,
    et_ratio: et_ratio,
    et_cents: et_cents,
    et_hz: et_hz,
    equal_temperament: equal_temperament,

    // 纯律 / 中庸律 / 良好律
    ji_ratio: ji_ratio,
    ji_cents: ji_cents,
    just_intonation: just_intonation,
    mt_fifth_cents: mt_fifth_cents,
    mt_cents: mt_cents,
    mt_ratio: mt_ratio,
    meantone: meantone,
    wm_cents: wm_cents,
    wm_ratio: wm_ratio,
    werckmeister_iii: werckmeister_iii,

    // 物理
    bell_ratio: bell_ratio,
    bell_amp: bell_amp,
    bell_hz: bell_hz,
    bell_partials: bell_partials,
    harmonic_ratio: harmonic_ratio,
    harmonic_hz: harmonic_hz,
    harmonic_series: harmonic_series,
    fret_remaining_ratio: fret_remaining_ratio,
    fret_distance: fret_distance,
    fret_positions: fret_positions,
    beat_frequency: beat_frequency,

    // 校验与数据
    validate_cents_table: validate_cents_table,
    load_world_tunings: load_world_tunings,
    set_world_tunings: set_world_tunings,
    pythagorean_comma_cents: pythagorean_comma_cents,
    syntonic_comma_cents: syntonic_comma_cents
  };

  // ---- camelCase 别名（应用层可写 T.hzFromCents(...)）----
  api.hzFromCents = hz_from_cents;
  api.ratioToCents = ratio_to_cents;
  api.centsToRatio = cents_to_ratio;
  api.normalizeOctave = normalize_octave;
  api.lengthToRatio = length_to_ratio;
  api.sanfenSunyi = sanfen_sunyi;
  api.equalTemperament = equal_temperament;
  api.justIntonation = just_intonation;
  api.werckmeisterIII = werckmeister_iii;
  api.bellPartials = bell_partials;
  api.harmonicSeries = harmonic_series;
  api.fretPositions = fret_positions;
  api.beatFrequency = beat_frequency;
  api.validateCentsTable = validate_cents_table;
  api.c4Hz = C4_HZ;
  api.a4Hz = A4_HZ;

  return api;
});
