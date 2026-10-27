/* ============================================================================
 * i18n.js —《同律》CONCORD 双语字典与渲染器
 * ----------------------------------------------------------------------------
 * 唯一文案真源：页面所有界面文字都必须来自这里（HTML 里只写 data-i18n 键名，
 * app.js 里只写 I18N.t('key')），不得在 JS 里散落裸中文。
 *
 * 用法
 *   I18N.t('m1.title')                → 当前语言的字符串
 *   I18N.t('m1.gap', { v: '23.46' })  → 插值：字典里写 {v}
 *   I18N.apply(document, 'en')        → 把 data-i18n* 属性全部重渲染 + 同步 <html lang>
 *   I18N.setLang('en')                → 记住选择（localStorage，失败静默）
 *
 * 支持属性
 *   data-i18n         → textContent
 *   data-i18n-html    → innerHTML（含 <b>/<em> 的行内强调）
 *   data-i18n-aria    → aria-label
 *   data-i18n-title   → title
 *   data-i18n-ph      → placeholder
 *
 * 依赖：无。零外部字体/网络请求。
 * ========================================================================== */
(function (W) {
  'use strict';

  /* ---------------------------------------------------------------- 词典 */
  var DICT = {
    /* ======================================================== 中文 zh */
    zh: {
      meta: {
        appName: '同律',
        appNameEn: 'CONCORD',
        docTitle: '同律 CONCORD · 律学交互实验室 v{v} — 一个八度的两种解法',
        subtitle: '一个八度的两种解法 —— 十二平均律的东西方之路',
        subtitleEn: 'One Octave, Two Solutions: The Eastern and Western Roads to Twelve-Tone Equal Temperament',
        kicker: '律学交互实验室 · 可听化 · 可复算',
        intro: '一个八度必须切成 12 个半音。用简单分数（3:2、2:1）一路叠下去，数学上永远回不到起点——差 23.46 音分。这件作品让你亲手算一遍、亲耳听一次：两个文明如何各自解开同一道题，而这一解今天被现代乐器与音乐工业的主流实践采用。',
        introHint: '建议顺序：先听见那不闭合的 23.46 音分，再看两个文明怎样各自解开它。',
        coverStats: '{m} 个模块 · {s} 套律制 · {n} 条术语'
      },

      a11y: {
        skip: '跳到主要内容',
        mainNav: '模块导航',
        langGroup: '语言 / Language',
        progress: '阅读进度',
        moduleList: '八个模块',
        demoRegion: '交互演示区',
        readouts: '实时读数',
        figures: '可核验数字',
        playGroup: '播放控制',
        toast: '状态提示',
        chart: '图表',
        aside: '补充说明'
      },

      ui: {
        zh: '中文',
        en: 'EN',
        play: '播放',
        stop: '停止',
        stopAll: '停止全部声音',
        stopAllShort: '静音',
        reset: '重置',
        next: '下一步',
        prev: '上一步',
        auto: '自动',
        run: '运行',
        playAll: '播放全部',
        compare: '对比播放',
        cents: '音分',
        centsShort: '音分',
        hz: 'Hz',
        step: '步',
        of: '/',
        notes: '音',
        source: '来源',
        statusVerified: '已核验',
        statusPending: '文献参考值',
        statusResearch: '已核验（文献）',
        statusOfficial: '已核验（官方）',
        statusLiterature: '文献参考值',
        statusComputed: '数学可复算',
        statusSeed: '种子数据',
        loading: '数据加载中',
        liveComputed: '实时计算',
        fromMetrics: '来自 metrics.json',
        reducedOn: '动效：已减弱',
        reducedOff: '动效：正常',
        motionToggle: '减弱动效',
        soundOn: '声音：开',
        soundOff: '声音：静音',
        keyboardHint: '键盘：Tab 遍历控件，空格/回车切换，方向键调滑块',
        version: '版本',
        close: '关闭',
        expand: '展开',
        collapse: '收起',
        selectTwo: '选择两套律制',
        systemA: '律制 A',
        systemB: '律制 B',
        melody: '旋律',
        chord: '和弦',
        interval: '音程',
        deviation: '偏差',
        diff: '差值',
        tick: '刻度',
        equal12: '十二平均律（对照基准）',
        worst: '最差音程',
        best: '最纯净音程',
        status: '状态',
        derived: '推导值',
        ratio: '比值'
      },

      nav: {
        brand: '同律',
        brandSub: 'CONCORD',
        m1: '序章',
        m2: '律尺',
        m3: '三分损益',
        m4: '密率',
        m5: '世界律制',
        m6: '编钟与琴',
        m7: '律与器',
        m8: '方法与证据',
        toc: '模块'
      },

      /* ---------------------------------------------------- M1 */
      m1: {
        kicker: '模块 01 · 问题',
        title: '序章 · 不闭合的八度',
        titleEn: 'Prologue · The Octave That Will Not Close',
        lead: '把 12 个纯五度（频率比 3:2）首尾相接，你大概会以为正好走到 7 个八度之外。实际不会：它比 7 个八度高出 23.46 音分。这个几乎听不出来的差值，是整部律学史的第一推动力。',
        demoTitle: '两条链，同一个终点？',
        demoDesc: '左链每步乘 3/2（纯五度），右链每步乘 2（八度）。走完 12 步五度、7 步八度后，两条链本应重合——请自己走一遍看差在哪里。',
        chainFifth: '12 个纯五度',
        chainOctave: '7 个八度',
        stepBtn: '叠一个五度',
        stepOctaveBtn: '叠一个八度',
        run12: '走完 12 步',
        reset: '回到起点',
        playCompare: '播放对比',
        playBeat: '播放拍音',
        readSteps: '已叠五度步数',
        readFifthEnd: '五度链终点（折叠后）',
        readOctaveEnd: '七倍八度终点',
        readGap: '缺口',
        readRatio: '两条链的长度比',
        readBeat: '拍频',
        beatNote: '两音同时发声时每秒相撞的次数',
        explainTitle: '这不是计算误差',
        explain: '3 是质数，2 也是质数：3^12/2^19 永远不可能等于 1。所以无论走多少步，五度链都走不到八度的整数倍。差值 531441/524288 = 1.013643…，即 23.46 音分，史称「毕达哥拉斯音差」。它不是近似算错，而是一个精确的数学事实——中外律学反复求解的都是它。',
        explainEq: '3^12/2^19',
        check1: '12 步纯五度累计音分',
        check2: '闭合误差（音分）',
        check3: '长度比 3^12/2^19',
        check4: '拍音（A4 与 +23.46 音分）',
        hintPlay: '声音需要你先点一下按钮才会响（浏览器安全策略）。'
      },

      /* ---------------------------------------------------- M2 */
      m2: {
        kicker: '模块 02 · 一根弦',
        title: '律尺 · 一根弦上的宇宙',
        titleEn: 'The Ruler · A Universe on One String',
        lead: '调音最原始的仪器是一根弦。把弦长截半，得到八度；截到三分之二，得到五度。所有律制都藏在这些分数里——拖动律尺，看它在频率和音分上变成什么。',
        demoTitle: '可移动的琴码',
        demoDesc: '拖动琴码改变被截取的弦长。弦越短，音越高：频率与弦长成反比。',
        sliderLabel: '弦长比（相对全弦）',
        presets: '音程预设',
        readLength: '弦长比',
        readRatio: '频率比',
        readHz: '频率',
        readCents: '音分（相对基准弦）',
        readNote: '最接近的音',
        readNearest: '与最近的十二平均律音差',
        baseLabel: '基准弦（黄钟 / C4）',
        stoppedLabel: '被截取的弦',
        invalid: '弦长比必须在 0.5 与 1 之间',
        explainTitle: '为什么是反比',
        explain: '频率 f = v/(2L)，速度 v 不变，所以 f ∝ 1/L。弦长减半（L→L/2）则 f→2f，就是八度；L→2L/3 则 f→3f/2，就是五度。音分则是把乘法变成加法：cents = 1200 x log2(f2/f1)。',
        explainEq: 'cents = 1200 x log2(f2/f1)',
        preset_octave: '八度 2:1',
        preset_fifth: '纯五度 3:2',
        preset_fourth: '纯四度 4:3',
        preset_major3just: '纯律大三度 5:4',
        preset_major3pyth: '毕氏大三度 81:64',
        preset_semitone: '平均律半音 2^(1/12)',
        noteOctave: '八度：弦长取一半',
        noteFifth: '五度：弦长取 2/3',
        noteFourth: '四度：弦长取 3/4',
        noteMajor3just: '纯律大三度：频率 5:4，弦长 4/5',
        noteMajor3pyth: '毕氏大三度：频率 81:64，弦长 64/81',
        noteSemitone: '平均律半音：频率 2^(1/12)，弦长 2^(-1/12)',
        playBoth: '同时发声',
        check1: '弦长与频率严格成反比',
        check2: '当前音分',
        check3: '预设表最大误差',
        check4: '五度 = 701.955 音分'
      },

      /* ---------------------------------------------------- M3 */
      m3: {
        kicker: '模块 03 · 中国解法之一',
        title: '三分损益 · 五度圈走不到头',
        titleEn: 'Sanfen Sunyi · The Circle That Cannot Close',
        lead: '中国古人用「三分损一、三分益一」交替生律：弦长乘 2/3 或 4/3，由黄钟先生出其余十一律。但这条路走不到头——把第 12 个五度叠上去时，它本应回到黄钟，实际却高出 23.46 音分。这个差值不是某两个律之间的距离，而是整条五度链绕行一周后的闭合误差。',
        demoTitle: '一步一生律',
        demoDesc: '每点一次「生一律」，按《吕氏春秋》的次序再叠一个纯五度，并把结果折叠回同一个八度内。',
        btnGen: '生一律',
        btnGenAll: '生成 12 律',
        btnReset: '重置',
        btnPlayWolf: '播放狼音',
        btnPlayScale: '播放十二律',
        tableStep: '步',
        tableName: '律名',
        tableRatio: '频率比',
        tableHz: '频率',
        tableCents: '音分',
        tableDev: '与平均律差',
        readClosing: '闭合误差',
        readNote: '第 12 律仲吕在黄钟上方',
        statusOpen: '未闭合',
        closureAttempt: '第 12 步',
        statusClosed: '已闭合',
        explainTitle: '每一步都是 3/2',
        explain: '生律规则：×3/2 后若超过八度就除 2 折回。黄钟经 11 次生律得到其余十一律（其中仲吕在黄钟上方 521.505 音分）；若以仲吕为起点再走第 12 步，本应回到黄钟，实际却高 23.46 音分。十二个五度累计 8423.46 音分，七个八度是 8400 音分，差正是 23.46。',
        wolfTitle: '「狼音」是什么',
        wolfDesc: '为了迁就这个缺口，历史上各律制留下某个格外刺耳的音程，乐师称之为「狼」。点「播放狼音」听一次：两个音几乎重合，每秒相撞二十几次，声音在抖。',
        check1: '十二律全部来自 3/2 链',
        check2: '闭合误差（音分）',
        check3: '第 12 律仲吕 / 黄钟',
        check4: '每步频率比',
        cellsLabel: '十二律表'
      },

      /* ---------------------------------------------------- M4 */
      m4: {
        kicker: '模块 04 · 中国解法之二',
        title: '密率 · 1584 年的第十二根',
        titleEn: 'The Cipher Ratio · The Twelfth Root, 1584',
        lead: '1584 年，朱载堉在《律学新说》中给出「新法密率」2^(1/12)：让第十二根弦正好是第一根的一半，八度由此可以被精确等分。同一时期，欧洲也在并行求解同一道题——本作品把两条路径并列展示，不作优先权断言。',
        demoTitle: '第十二根弦是怎么算出来的',
        demoDesc: '本页以平方根与立方根链演示与 2^(1/12) 等价的推导（朱载堉原著以珠算开方逐步求得同一数值）。每一步都能按一下复算。',
        stepBtn: '下一步推导',
        showAll: '显示全部推导',
        resetDerivation: '重新推导',
        stepsTitle: '推导步骤',
        litTitle: '文献抄录值 vs 本页计算',
        litRecorded: '文献抄录值',
        litComputed: '本页计算值',
        litDiff: '差',
        powerTitle: '闭合检验：12 次幂是否等于 2',
        powerResult: '密率^12',
        powerTarget: '目标',
        powerDiff: '误差',
        timelineTitle: '并行解题时间线',
        abTitle: '三种律制 A/B 听辨',
        abDesc: '同一段旋律（C–E–G–B–C），在三种律制下分别播放。',
        abSanfen: '三分损益',
        abMeantone: '中庸律',
        abTet: '十二平均律',
        abPlay: '播放这一段',
        abStop: '停止',
        whyTitle: '为什么开方就是解',
        whyBody: '若八度 = 2 倍频率，等分成 12 份，则相邻两音的公比 r 满足 r^12 = 2，故 r = 2^(1/12) = 1.0594630943592953。所谓「密率」就是这一位小数背后的严谨常量。',
        honorNote: '本节并列展示两条独立解题路径与可核验的数学结论，不对传播先后作出断言。',
        check1: '密率 = 2^(1/12) 误差',
        check2: '密率^12 与 2 的误差',
        check3: '文献值与计算值之差',
        check4: '十二个半音全部 = 100 音分',
        termHuangzhong: '黄钟', termLinzhong: '林钟', termTaicu: '太簇', termNanlü: '南吕',
        termGuxi: '姑洗', termYingzhong: '应钟', termRuibin: '蕤宾', termDalü: '大吕',
        termYize: '夷则', termJiazhong: '夹钟', termWuyi: '无射', termZhonglü: '仲吕',
        step1: '目标：把八度十二等分。设相邻两音的公比为 r，则 r^12 = 2',
        step2: '第一次开平方，得到半个八度',
        step3: '第二次开平方，得到四分之一个八度',
        step4: '另一支：对 2 开立方，得到三分之一个八度',
        step5: '再开平方，得到六分之一个八度',
        step6: '两者相除，得到十二分之一个八度，即密率',
        step7: '闭合检验：把密率自乘 12 次，应回到 2'
      },

      /* ---------------------------------------------------- M5 */
      m5: {
        kicker: '模块 05 · 世界',
        title: '世界律制 · 同一个八度，很多种切法',
        titleEn: 'World Tunings · One Octave, Many Cuts',
        lead: '八度必须被切开，但怎么切没有唯一答案。同一段旋律放进不同的切法里，会听见不同的「调」——甚至不同的情绪。',
        demoTitle: '把律制摊开在同一把尺子上',
        demoDesc: '横轴是 0–1200 音分。选中的律制各画一行，点的位置就是它的音级。可以叠加对比。',
        listTitle: '律制一览',
        compareTitle: 'A/B 对比',
        playAB: '播放 A',
        playB: '播放 B',
        stop: '停止',
        melodyNote: '同一段五声音阶旋律，只改变律制。',
        regionAll: '全部',
        region_all: '全部',
        region_china: '中国',
        region_europe: '欧洲',
        region_india: '印度',
        region_arabic: '阿拉伯世界',
        region_indonesia: '印度尼西亚',
        region_thailand: '泰国',
        region_global: '全球',
        noteCount: '{n} 音',
        rulerTitle: '音分刻度尺',
        mapTitle: '文化区域地图',
        mapHint: '点选区域查看该文化的律制与乐器；下方刻度尺同步。',
        pendingWarn: '本表含「文献参考值」条目：按已发表文献抄录显示，一手来源核验中，不作为对外结论。',
        compareHint: '选两套律制，听同一段旋律的差别。',
        check1: '已加载律制',
        check2: '每套律制音级合计 = 1200 音分',
        check3: '待核验条目',
        check4: '与十二平均律的最大偏差'
      },

      /* ---------------------------------------------------- M6 */
      m6: {
        kicker: '模块 06 · 一件乐器',
        title: '编钟与琴 · 一钟两音',
        titleEn: 'Bells and Zithers · Two Tones in One Bell',
        lead: '曾侯乙编钟的每一件钟能发出两个音：敲正鼓部一个，敲侧鼓部另一个，通常相距约一个大三度；中音区十二个半音齐备。但它不是等程律——把八度精确等分成十二份的数学解，要到 1584 年才由朱载堉以新法密率给出。古琴则用十三个徽位把弦长切成 1/2、1/3、1/4……泛音列就是它的数学。',
        bellTitle: '一钟双音',
        bellDesc: '点钟面上的两个敲击点：正鼓音（中央）与侧鼓音（侧边）。两音相距约 386 音分（≈大三度）——这是一件钟，不是一个组合。',
        bellFront: '正鼓音',
        bellSide: '侧鼓音',
        bellHitFront: '敲正鼓部',
        bellHitSide: '敲侧鼓部',
        bellPlayBoth: '两音对比',
        bellInterval: '正鼓音与侧鼓音的间距',
        bellSource: '测音结论学界有不同研究，本页数值为示意性近似，逐条来源见「方法与证据」。',
        guqinTitle: '古琴徽位与泛音列',
        guqinDesc: '在弦长的 1/2、1/3、1/4……处轻触并拨弦，得到第 2、3、4……泛音。徽位就是这些节点的标记。',
        guqinHui: '徽位',
        guqinRatio: '弦长比',
        guqinPartial: '泛音序号',
        guqinFreq: '频率',
        guqinCents: '相对基音',
        guqinSweep: '依次扫过全部徽位',
        guqinStop: '停止',
        specTitle: '频谱',
        specDesc: '把「一钟双音」的声音拆成频率成分：一钟两音不是一个音的泛音，而是两组分音并存。',
        check1: '泛音频率 = 基频 x n',
        check2: '正鼓音 / 侧鼓音间距',
        check3: '徽位最小比值',
        check4: '一钟双音（编钟）',
        bellCount: '曾侯乙编钟 65 件',
        bellName: '钟 {n}',
        currentTone: '当前发声'
      },

      /* ---------------------------------------------------- M7 */
      m7: {
        kicker: '模块 07 · 器物',
        title: '律与器 · 妥协的艺术',
        titleEn: 'Tuning and Instruments · The Art of Compromise',
        lead: '乐器不会按理论长。吉他品丝按 2^(-n/12) 排布，钢琴的高音区要拉宽、低音区要压窄——因为真实乐器要考虑自己的物理。所谓「标准音高」，是一场持续的妥协。',
        fretTitle: '吉他品丝：平均律的物证',
        fretDesc: '第 n 品到琴枕的距离 d(n) = L·(1 - 2^(-n/12))。把平均律与纯律并排看：不是所有音都能同时纯净。',
        fretLabel: '第 {n} 品',
        fretET: '平均律位置',
        fretJust: '纯律（同音级 5:4 大三度）位置',
        fretDiff: '差距',
        fretPlayET: '按平均律弹这个音',
        fretPlayJust: '按纯律弹这个音',
        stretchTitle: '钢琴调律曲线（Railsback 曲线）',
        stretchDesc: '实际钢琴调音时，高音区会比理论值偏高、低音区偏低，因为人的听觉偏好与琴弦的非谐性。曲线是「理论 vs 耳朵」的证据。',
        stretchRubric: '纵轴：相对十二平均律的偏差（音分）',
        stretchNote: '示意曲线：形状取自通行的 Railsback 曲线描述，具体数值随琴而异。',
        isochordTitle: '同一把尺子上的偏离',
        isochordDesc: '把各律制的十二个音对十二平均律的偏差画成图：平均律是一条直线（零偏差），其它律制上下起伏。',
        check1: '品丝位置公式 d(n) = L(1-2^(-n/12))',
        check2: '第 12 品应正好在弦长一半',
        check3: '纯律大三度 386.31 音分',
        check4: '平均律大三度 400 音分'
      },

      /* ---------------------------------------------------- M8 */
      m8: {
        kicker: '模块 08 · 证据',
        title: '方法与证据',
        titleEn: 'Method and Evidence',
        lead: '这一节把页面上的每个数字都交出来：算法、断言、来源、复跑命令、AI 使用情况。所有对外数字都来自同一份 metrics.json，页面不手写任何数字。',
        algoTitle: '算法说明（摘要）',
        algoBody1: '音分定义：cents(f₁,f₂) = 1200·log₂(f₂/f₁)。它是把频率的乘法关系转成加法关系的一步，全部律制比较都建立在它之上。',
        algoBody2: '三分损益：从黄钟起连续 ×3/2 并折叠进 [1,2)，得到 12 律；第 12 律与黄钟的差为 1200·log₂(3^12/2^19) = 23.4600 音分。',
        algoBody3: '新法密率：2^(1/12) = 1.0594630943592953；其 12 次幂与 2 的误差小于 1e-15。',
        algoBody4: '品丝位置：d(n) = L·(1 - 2^(-n/12))；泛音列：f(n) = n·f(0)；拍频：|f₁ - f₂|。',
        metricsTitle: '本页可核验数字',
        metricsNote: '以下数字由页面运行时从 data/metrics.js 读取；该文件由管线脚本从 _pipeline/metrics_app.json 与 metrics.json 生成，禁止手写。',
        mModules: '模块数',
        mModulesReady: '就绪模块',
        mDomCharsZh: '中文正文字符数',
        mDomCharsEn: '英文正文字符数',
        mLoad: '首屏 DOM 就绪',
        mErrors: '控制台错误',
        mAxe: 'axe 无障碍违规',
        mCjk: 'EN 模式中文字符占比',
        mVersion: '作品版本',
        mPending: '待生成指标',
        mKernelAssertions: '内核断言（通过 / 总数）',
        mCrossChecks: 'Python  /  JS 交叉校验组',
        mAudioAssertions: '音频断言（通过 / 总数）',
        mAudioCents: '单音 FFT 峰值误差（{g} 组）',
        mAudioBeat: '拍频包络误差（{g} 组）',
        sourcesTitle: '数据来源入口',
        sourcesNote: '律制数学表由定义直接计算（可复算）；文献类数值在界面标为「文献参考值」（内部状态仍为待核验），按已发表来源抄录，不作对外结论。完整来源清单见提交材料的《来源清单》。',
        srcTuning: '律制表',
        srcHistory: '历史时间线',
        srcWorld: '世界律制说明',
        srcGlossary: '术语库',
        tuningScope: '对外口径 {n} 种律制（另含 {d} 套派生对照表，页面共 {t} 张表）',
        srcStatus: '来源状态字段',
        sourceRegister: '来源清单',
        sourcesInline: '来源 {ids}（见{reg}）',
        runTitle: '复跑命令',
        runNote: '以下命令在仓库根目录的 PowerShell 中可直接运行（发行包内路径为相对路径）。',
        runKernel: '内核断言（Python 权威实现）',
        runExport: '导出律制表',
        runCross: 'Python  /  JS 交叉校验',
        runMerge: '汇总对外数字',
        runBuildData: '重建页面数据（本页 data/*.js）',
        runGate: '国一标准门禁总跑',
        aiTitle: 'AI 使用披露',
        aiBody1: '本作品的界面代码、可视化与文案由学生团队在 AI 编程助手辅助下完成；AI 参与部分已在提交材料的《人工智能工具使用情况说明》中逐项列明（工具名、环节、生成流程、人工修改）。',
        aiBody2: '页面中的律制数值不依赖 AI 生成：纯数学表由定义计算，文献表标注来源与核验状态。',
        aiBody3: '本页不含 AI 生成的图像素材；界面图形全部由代码程序化绘制（SVG/Canvas）。',
        originalTitle: '原创贡献',
        orig1: '自建律制数据集：11 套律制、22 音级的一手音分表，附来源状态字段。',
        orig2: '双内核交叉校验：Python 权威实现与 JS 同构实现逐值比对，误差 < 1e-12。',
        orig3: '可听化实验台：把音分、拍音、狼音从数字变成可听见的对比，全部离线运行。',
        orig4: '零外部依赖单页：不引用任何 CDN、在线字体或远程图片，双击即开。',
        honestyTitle: '诚实边界',
        honestyBody: '朱载堉与欧洲十二平均律的传播关系，学界存在不同观点；本作品并列展示两条解题路径与可核验的数学结论，不对优先权作出断言。编钟测音采用已发表研究并逐条标注来源。',
        glossaryTitle: '术语对照（中英）',
        glossaryDesc: '页面内术语库，可搜索。术语的英文列为对照用途，不改变中文释义。',
        glossarySearch: '搜索术语…',
        glossaryEmpty: '没有匹配的术语',
        glossaryCat: '门类',
        glossaryCount: '共 {n} 条 / {c} 类'
      },

      /* ---------------------------------------------------- 页脚 */
      foot: {
        line1: '《同律》CONCORD · 律学交互实验室',
        line2: '全国大学生数字媒体科技作品及创意竞赛 · 国际专项赛 · 2026',
        line3: '零外部依赖 · 离线双击即开 · 页面内每个数字都可复算',
        version: '版本 {v}',
        backTop: '回到顶部'
      }
    },

    /* ======================================================== English en */
    en: {
      meta: {
        appName: 'CONCORD',
        appNameEn: 'CONCORD',
        docTitle: 'CONCORD · Tuning Lab v{v} — One Octave, Two Solutions',
        subtitle: 'One Octave, Two Solutions: The Eastern and Western Roads to Twelve-Tone Equal Temperament',
        subtitleEn: 'One Octave, Two Solutions',
        kicker: 'An interactive, audible tuning laboratory',
        intro: 'Twelve semitones must fit inside one octave. Stack simple ratios (3:2, 2:1) and the circle never closes — it misses the start by 23.46 cents. This work lets you calculate it by hand and hear it by ear: how two civilisations solved the same problem, and how that solution became the tuning adopted by modern instruments and mainstream music-industry practice.',
        introHint: 'Suggested order: hear the unclosable 23.46 cents first, then watch two civilisations solve it.',
        coverStats: '{m} modules · {s} tuning systems · {n} glossary terms'
      },

      a11y: {
        skip: 'Skip to main content',
        mainNav: 'Module navigation',
        langGroup: 'Language',
        progress: 'Reading progress',
        moduleList: 'Eight modules',
        demoRegion: 'Interactive demonstration',
        readouts: 'Live readouts',
        figures: 'Verifiable figures',
        playGroup: 'Playback controls',
        toast: 'Status message',
        chart: 'Chart',
        aside: 'Further reading'
      },

      ui: {
        zh: '中文',
        en: 'EN',
        play: 'Play',
        stop: 'Stop',
        stopAll: 'Stop all sound',
        stopAllShort: 'Mute',
        reset: 'Reset',
        next: 'Next',
        prev: 'Back',
        auto: 'Auto',
        run: 'Run',
        playAll: 'Play all',
        compare: 'Compare',
        cents: 'cents',
        centsShort: 'ct',
        hz: 'Hz',
        step: 'Step',
        of: '/',
        notes: 'notes',
        source: 'Source',
        statusVerified: 'verified',
        statusPending: 'literature value',
        statusResearch: 'verified (literature)',
        statusOfficial: 'verified (official)',
        statusLiterature: 'literature value',
        statusComputed: 'computed',
        statusSeed: 'seed data',
        loading: 'Loading data',
        liveComputed: 'computed live',
        fromMetrics: 'from metrics.json',
        reducedOn: 'Motion: reduced',
        reducedOff: 'Motion: normal',
        motionToggle: 'Reduce motion',
        soundOn: 'Sound: on',
        soundOff: 'Sound: muted',
        keyboardHint: 'Keyboard: Tab through controls, Space/Enter to toggle, arrow keys for sliders',
        version: 'Version',
        close: 'Close',
        expand: 'Expand',
        collapse: 'Collapse',
        selectTwo: 'Choose two tunings',
        systemA: 'Tuning A',
        systemB: 'Tuning B',
        melody: 'Melody',
        chord: 'Chord',
        interval: 'Interval',
        deviation: 'Deviation',
        diff: 'Difference',
        tick: 'Tick',
        equal12: '12-TET (reference)',
        worst: 'Worst interval',
        best: 'Purest interval',
        status: 'Status',
        derived: 'Derived',
        ratio: 'Ratio'
      },

      nav: {
        brand: 'CONCORD',
        brandSub: '同律',
        m1: 'Prologue',
        m2: 'Ruler',
        m3: 'Sanfen Sunyi',
        m4: 'Cipher Ratio',
        m5: 'World Tunings',
        m6: 'Bells & Zithers',
        m7: 'Instruments',
        m8: 'Method',
        toc: 'Modules'
      },

      m1: {
        kicker: 'Module 01 · The problem',
        title: 'Prologue · The Octave That Will Not Close',
        titleEn: 'Prologue · The Octave That Will Not Close',
        lead: 'Stack twelve perfect fifths (ratio 3:2) end to end and you expect to land exactly seven octaves away. You do not: the chain ends 23.46 cents sharp. That barely audible gap is the engine behind the entire history of tuning.',
        demoTitle: 'Two chains, one destination?',
        demoDesc: 'The left chain multiplies by 3/2 (a perfect fifth) each step; the right one multiplies by 2 (an octave). After twelve fifths and seven octaves the two should coincide — step through it and see where they part.',
        chainFifth: '12 perfect fifths',
        chainOctave: '7 octaves',
        stepBtn: 'Add one fifth',
        stepOctaveBtn: 'Add one octave',
        run12: 'Run all 12 steps',
        reset: 'Back to start',
        playCompare: 'Play comparison',
        playBeat: 'Play the beating',
        readSteps: 'Fifths stacked',
        readFifthEnd: 'Fifth-chain end (folded)',
        readOctaveEnd: 'Seven-octave end',
        readGap: 'Gap',
        readRatio: 'Ratio of the two chain lengths',
        readBeat: 'Beat frequency',
        beatNote: 'How many times per second the two tones collide',
        explainTitle: 'This is not a rounding error',
        explain: '3 is prime and 2 is prime, so 3^12/2^19 can never equal 1. However many steps you take, the fifth chain can never reach a whole number of octaves. The gap 531441/524288 = 1.013643…, i.e. 23.46 cents, is the Pythagorean comma. It is an exact mathematical fact, not a computing mistake — and it is what theorists in China and Europe kept trying to solve.',
        explainEq: '3^12/2^19',
        check1: 'Twelve fifths, total',
        check2: 'Closure error (cents)',
        check3: 'Length ratio 3^12/2^19',
        check4: 'Beating (A4 vs +23.46 cents)',
        hintPlay: 'Sound only starts after you press a button — that is the browser security rule.'
      },

      m2: {
        kicker: 'Module 02 · One string',
        title: 'The Ruler · A Universe on One String',
        titleEn: 'The Ruler · A Universe on One String',
        lead: 'The oldest tuning instrument is one string. Halve its length and you get an octave; take two thirds and you get a fifth. Every tuning system is written inside fractions of string length — drag the ruler and see what they become in frequency and cents.',
        demoTitle: 'A movable bridge',
        demoDesc: 'Drag the bridge to change the sounding length. A shorter string sounds higher: frequency is inversely proportional to length.',
        sliderLabel: 'String length (fraction of full string)',
        presets: 'Interval presets',
        readLength: 'String length',
        readRatio: 'Frequency ratio',
        readHz: 'Frequency',
        readCents: 'Cents (against the reference string)',
        readNote: 'Nearest note name',
        readNearest: 'Distance to the nearest 12-TET note',
        baseLabel: 'Reference string (Huangzhong / C4)',
        stoppedLabel: 'Stopped string',
        invalid: 'String length must lie between 0.5 and 1',
        explainTitle: 'Why inversely proportional',
        explain: 'For a string, f = v/(2L); with fixed wave speed v, f is proportional to 1/L. Halving the length (L→L/2) gives 2f, the octave; L→2L/3 gives 3f/2, the fifth. Cents turn multiplication into addition: cents = 1200 x log2(f2/f1).',
        explainEq: 'cents = 1200 x log2(f2/f1)',
        preset_octave: 'Octave 2:1',
        preset_fifth: 'Perfect fifth 3:2',
        preset_fourth: 'Perfect fourth 4:3',
        preset_major3just: 'Just major third 5:4',
        preset_major3pyth: 'Pythagorean major third 81:64',
        preset_semitone: '12-TET semitone 2^(1/12)',
        noteOctave: 'Octave: half the string length',
        noteFifth: 'Fifth: two thirds of the string',
        noteFourth: 'Fourth: three quarters of the string',
        noteMajor3just: 'Just major third: ratio 5:4, length 4/5',
        noteMajor3pyth: 'Pythagorean major third: ratio 81:64, length 64/81',
        noteSemitone: '12-TET semitone: ratio 2^(1/12), length 2^(-1/12)',
        playBoth: 'Sound both together',
        check1: 'Length and frequency strictly inverse',
        check2: 'Cents right now',
        check3: 'Max preset-table error',
        check4: 'Fifth = 701.955 cents'
      },

      m3: {
        kicker: 'Module 03 · The first Chinese solution',
        title: 'Sanfen Sunyi · The Circle That Cannot Close',
        titleEn: 'Sanfen Sunyi · The Circle That Cannot Close',
        lead: 'Classical Chinese theorists generated pitches by alternately diminishing and augmenting the string by a third: multiply the length by 2/3, then by 4/3. Huangzhong generates the other eleven pitches. But the walk never returns: stacking the twelfth fifth should land back on Huangzhong, and instead overshoots by 23.46 cents. That figure is not the distance between two named pitches — it is the closure error of the whole chain.',
        demoTitle: 'One pitch per step',
        demoDesc: 'Each press adds one perfect fifth in the order recorded in the Lüshi Chunqiu, then folds the result back into the same octave.',
        btnGen: 'Generate one pitch',
        btnGenAll: 'Generate all twelve',
        btnReset: 'Reset',
        btnPlayWolf: 'Play the wolf interval',
        btnPlayScale: 'Play all twelve',
        tableStep: 'Step',
        tableName: 'Pitch',
        tableRatio: 'Ratio',
        tableHz: 'Frequency',
        tableCents: 'Cents',
        tableDev: 'vs 12-TET',
        readClosing: 'Closure error',
        readNote: 'Zhonglü (12th) above Huangzhong',
        statusOpen: 'not closed',
        closureAttempt: 'Step 12',
        statusClosed: 'closed',
        explainTitle: 'Every step is 3/2',
        explain: 'The rule: multiply by 3/2, and if the result leaves the octave divide by 2. Eleven steps generate the other eleven pitches from Huangzhong (Zhonglü sits 521.505 cents above it); taking the twelfth step from Zhonglü should return to Huangzhong, but lands 23.46 cents high. Twelve fifths total 8423.46 cents against 8400 cents for seven octaves — a difference of exactly 23.46.',
        wolfTitle: 'What a "wolf" is',
        wolfDesc: 'To absorb that gap, historical temperaments leave one interval badly out of tune; musicians called it a wolf. Press "Play the wolf interval": the two tones nearly coincide and collide about twenty times a second, so the sound wavers.',
        check1: 'All twelve pitches come from the 3/2 chain',
        check2: 'Closure error (cents)',
        check3: 'Pitch 12 Zhonglü / Huangzhong',
        check4: 'Ratio per step',
        cellsLabel: 'The twelve-pitch table'
      },

      m4: {
        kicker: 'Module 04 · The second Chinese solution',
        title: 'The Cipher Ratio · The Twelfth Root, 1584',
        titleEn: 'The Cipher Ratio · The Twelfth Root, 1584',
        lead: 'In 1584 Zhu Zaiyu published the "new-method cipher ratio" 2^(1/12): make the twelfth string exactly half of the first, so the octave can be divided exactly. In the same period Europe was solving the same problem in parallel — this work presents both paths side by side and makes no priority claim.',
        demoTitle: 'How the twelfth string was calculated',
        demoDesc: 'This page shows an equivalent derivation through square and cube roots (Zhu Zaiyu worked the same value step by step on the abacus). Each step can be recomputed with a button.',
        stepBtn: 'Next derivation step',
        showAll: 'Show the whole derivation',
        resetDerivation: 'Start over',
        stepsTitle: 'Derivation steps',
        litTitle: 'Recorded value vs value computed here',
        litRecorded: 'Recorded value',
        litComputed: 'Computed here',
        litDiff: 'Difference',
        powerTitle: 'Closure test: is the twelfth power equal to 2?',
        powerResult: 'Ratio^12',
        powerTarget: 'Target',
        powerDiff: 'Error',
        timelineTitle: 'Parallel solutions on a timeline',
        abTitle: 'A/B audition: three temperaments',
        abDesc: 'The same phrase (C–E–G–B–C) played in three different tunings.',
        abSanfen: 'Sanfen Sunyi',
        abMeantone: 'Meantone',
        abTet: '12-TET',
        abPlay: 'Play this phrase',
        abStop: 'Stop',
        whyTitle: 'Why a root is the answer',
        whyBody: 'If the octave is a factor of 2 and must be split into 12 equal parts, the ratio r between neighbours satisfies r^12 = 2, so r = 2^(1/12) = 1.0594630943592953. The "cipher ratio" is exactly this constant.',
        honorNote: 'This page presents two independent solution paths and verifiable mathematics side by side; it makes no claim about who came first.',
        check1: 'Cipher ratio vs 2^(1/12)',
        check2: 'Ratio^12 vs 2',
        check3: 'Recorded minus computed',
        check4: 'All twelve semitones = 100 cents',
        termHuangzhong: 'Huangzhong', termLinzhong: 'Linzhong', termTaicu: 'Taicu', termNanlü: 'Nanlü',
        termGuxi: 'Guxi', termYingzhong: 'Yingzhong', termRuibin: 'Ruibin', termDalü: 'Dalü',
        termYize: 'Yize', termJiazhong: 'Jiazhong', termWuyi: 'Wuyi', termZhonglü: 'Zhonglü',
        step1: 'Goal: divide the octave into twelve equal parts. With r the ratio between neighbours, r^12 = 2',
        step2: 'First square root: one half-octave',
        step3: 'Second square root: a quarter octave',
        step4: 'A second branch: cube root of 2, a third of an octave',
        step5: 'Square root again: a sixth of an octave',
        step6: 'Divide them: a twelfth of an octave, the cipher ratio',
        step7: 'Closure test: raise the cipher ratio to the twelfth power; it should return to 2'
      },

      m5: {
        kicker: 'Module 05 · The world',
        title: 'World Tunings · One Octave, Many Cuts',
        titleEn: 'World Tunings · One Octave, Many Cuts',
        lead: 'The octave must be cut somewhere, but there is no single answer. Put the same melody into different cuts and you hear a different key — and a different mood.',
        demoTitle: 'Every tuning on the same ruler',
        demoDesc: 'The x-axis is 0–1200 cents. Selected tunings each get a row; every dot is one pitch. Overlay them to compare.',
        listTitle: 'The systems',
        compareTitle: 'A/B comparison',
        playAB: 'Play A',
        playB: 'Play B',
        stop: 'Stop',
        melodyNote: 'The same pentatonic phrase, only the tuning changes.',
        regionAll: 'All',
        region_all: 'All',
        region_china: 'China',
        region_europe: 'Europe',
        region_india: 'India',
        region_arabic: 'Arabic world',
        region_indonesia: 'Indonesia',
        region_thailand: 'Thailand',
        region_global: 'Global',
        noteCount: '{n} notes',
        rulerTitle: 'Cents ruler',
        mapTitle: 'Cultural map',
        mapHint: 'Pick a region to see its tunings and instruments; the ruler below follows.',
        pendingWarn: 'This table contains literature-reference values: reproduced from published sources, first-hand verification in progress, not used in outward conclusions.',
        compareHint: 'Pick two tunings and hear the same phrase in both.',
        check1: 'Tunings loaded',
        check2: 'Every tuning sums to 1200 cents',
        check3: 'Items pending review',
        check4: 'Largest deviation from 12-TET'
      },

      m6: {
        kicker: 'Module 06 · One instrument',
        title: 'Bells and Zithers · Two Tones in One Bell',
        titleEn: 'Bells and Zithers · Two Tones in One Bell',
        lead: 'Each bell of the Marquis Yi of Zeng set sounds two pitches: strike the front boss for one, the side for the other, usually about a major third apart, and its mid register carries all twelve semitones. It is not equal temperament, however — the mathematical solution that divides the octave into twelve equal parts comes only in 1584, with Zhu Zaiyu. The guqin instead divides its string at 1/2, 1/3, 1/4… — its thirteen studs are the harmonic series made physical.',
        bellTitle: 'Two tones in one bell',
        bellDesc: 'Press the two strike points: the front tone (centre) and the side tone (edge). They sit about 386 cents apart — in one single bell, not a pair.',
        bellFront: 'Front tone',
        bellSide: 'Side tone',
        bellHitFront: 'Strike the front',
        bellHitSide: 'Strike the side',
        bellPlayBoth: 'Both together',
        bellInterval: 'Distance between front and side tone',
        bellSource: 'Published pitch measurements differ between studies; the value here is schematic. See "Method and Evidence" for sources.',
        guqinTitle: 'Guqin studs and the harmonic series',
        guqinDesc: 'Touch the string at 1/2, 1/3, 1/4… of its length and pluck: you get the 2nd, 3rd, 4th… harmonic. The studs mark exactly these nodes.',
        guqinHui: 'Stud',
        guqinRatio: 'Length ratio',
        guqinPartial: 'Harmonic',
        guqinFreq: 'Frequency',
        guqinCents: 'Above fundamental',
        guqinSweep: 'Sweep every stud',
        guqinStop: 'Stop',
        specTitle: 'Spectrum',
        specDesc: 'Break the two-tone bell into frequency components: the second tone is not a harmonic of the first; two sets of partials coexist.',
        check1: 'Harmonic frequency = fundamental x n',
        check2: 'Front / side tone distance',
        check3: 'Smallest stud ratio',
        check4: 'Two tones in one bell',
        bellCount: 'Zeng Houyi set: 65 bells',
        bellName: 'Bell {n}',
        currentTone: 'Now sounding'
      },

      m7: {
        kicker: 'Module 07 · The instrument',
        title: 'Tuning and Instruments · The Art of Compromise',
        titleEn: 'Tuning and Instruments · The Art of Compromise',
        lead: 'Instruments do not follow theory. Guitar frets are placed by 2^(-n/12); pianos stretch the treble up and the bass down, because a real instrument has to answer to its own physics. "Standard pitch" is a compromise that never stops being renegotiated.',
        fretTitle: 'Guitar frets: equal temperament made physical',
        fretDesc: 'The distance from nut to fret n is d(n) = L·(1 - 2^(-n/12)). Put equal temperament next to just intonation: not every interval can be pure at the same time.',
        fretLabel: 'Fret {n}',
        fretET: 'Equal-temperament position',
        fretJust: 'Just position (5:4 major third)',
        fretDiff: 'Difference',
        fretPlayET: 'Play this note at the ET position',
        fretPlayJust: 'Play this note at the just position',
        stretchTitle: 'Piano tuning curve (Railsback curve)',
        stretchDesc: 'Real piano tuning sharpens the treble and flattens the bass, because hearing prefers it and strings are inharmonic. The curve is the evidence of "theory vs the ear".',
        stretchRubric: 'Vertical axis: deviation from 12-TET (cents)',
        stretchNote: 'Schematic curve: the shape follows the published Railsback description; exact values vary per instrument.',
        isochordTitle: 'Deviation on one ruler',
        isochordDesc: 'Plot each tuning system\'s twelve pitches against 12-TET: equal temperament is a flat line at zero, everything else rises and falls.',
        check1: 'Fret formula d(n) = L(1-2^(-n/12))',
        check2: 'Fret 12 lands exactly at half the string',
        check3: 'Just major third = 386.31 cents',
        check4: '12-TET major third = 400 cents'
      },

      m8: {
        kicker: 'Module 08 · Evidence',
        title: 'Method and Evidence',
        titleEn: 'Method and Evidence',
        lead: 'This section hands over every number on the page: algorithms, assertions, sources, rerun commands and AI usage. All outward figures come from one metrics.json; the page hard-codes none of them.',
        algoTitle: 'Algorithms (summary)',
        algoBody1: 'Cents: cents(f1,f2) = 1200·log2(f2/f1). This single step turns the multiplication of frequencies into the addition of intervals, and every comparison in this work rests on it.',
        algoBody2: 'Sanfen sunyi: multiply by 3/2 repeatedly from Huangzhong and fold into [1,2) to obtain twelve pitches; pitch twelve differs from Huangzhong by 1200·log₂(3^12/2^19) = 23.4600 cents.',
        algoBody3: 'Cipher ratio: 2^(1/12) = 1.0594630943592953; the error of its twelfth power against 2 is below 1e-15.',
        algoBody4: 'Fret position: d(n) = L·(1 - 2^(-n/12)); harmonic series: f(n) = n·f(0); beating: |f₁ - f₂|.',
        metricsTitle: 'Verifiable figures on this page',
        metricsNote: 'The figures below are read at runtime from data/metrics.js, which the pipeline generates from _pipeline/metrics_app.json and metrics.json. Nothing here is typed by hand.',
        mModules: 'Modules',
        mModulesReady: 'Modules ready',
        mDomCharsZh: 'Chinese body characters',
        mDomCharsEn: 'English body characters',
        mLoad: 'DOM ready',
        mErrors: 'Console errors',
        mAxe: 'axe violations',
        mCjk: 'CJK ratio in EN mode',
        mVersion: 'App version',
        mPending: 'Pending metrics',
        mKernelAssertions: 'Kernel assertions (passed / total)',
        mCrossChecks: 'Python  /  JS cross-checks',
        mAudioAssertions: 'Audio assertions (passed / total)',
        mAudioCents: 'Single-tone FFT peak error ({g} groups)',
        mAudioBeat: 'Beat envelope error ({g} groups)',
        sourcesTitle: 'Where the data comes from',
        sourcesNote: 'Mathematical tuning tables are computed from their definitions (and can be recomputed). Literature values are labelled "literature value" in the interface (internally still pending review): they reproduce published sources and are not used in outward conclusions. The full source list ships with the submission materials.',
        srcTuning: 'Tuning tables',
        srcHistory: 'Historical timeline',
        srcWorld: 'World tunings notes',
        srcGlossary: 'Glossary',
        tuningScope: 'Outward figure: {n} tuning systems (+{d} derived comparison tables, {t} tables shown)',
        srcStatus: 'Source-status field',
        sourceRegister: 'Source Register',
        sourcesInline: 'Sources: {ids} (see {reg})',
        runTitle: 'Rerun commands',
        runNote: 'These commands run as-is from the repository root (the distributed package uses relative paths).',
        runKernel: 'Kernel assertions (authoritative Python)',
        runExport: 'Export tuning tables',
        runCross: 'Python  /  JS cross-check',
        runMerge: 'Merge outward figures',
        runBuildData: 'Rebuild page data (data/*.js)',
        runGate: 'Full national-first-class gate',
        aiTitle: 'AI usage disclosure',
        aiBody1: 'The interface code, visualisations and copy were produced by the student team with AI coding assistants; the assisted parts are itemised in the submission\'s AI Usage Statement (tool, stage, generation process, human edits).',
        aiBody2: 'The tuning figures do not depend on AI output: mathematical tables are computed from definitions, literature tables carry sources and review status.',
        aiBody3: 'This page contains no AI-generated imagery; every graphic is drawn procedurally in code (SVG/Canvas).',
        originalTitle: 'Original contributions',
        orig1: 'A self-built tuning dataset: 11 systems and a 22-pitch table, each entry tagged with source status.',
        orig2: 'Dual-kernel cross-check: an authoritative Python implementation compared value by value against a JS twin, error < 1e-12.',
        orig3: 'An audible laboratory: cents, beating and wolves turned from numbers into things you can hear, entirely offline.',
        orig4: 'A zero-dependency single page: no CDN, no web font, no remote image — double-click to run.',
        honestyTitle: 'Honest boundaries',
        honestyBody: 'The transmission relationship between Zhu Zaiyu and European equal temperament is debated. This work presents two solution paths and verifiable mathematics side by side and makes no priority claim. Bell pitch measurements follow published research and are attributed item by item.',
        glossaryTitle: 'Glossary (Chinese–English)',
        glossaryDesc: 'An in-page glossary with search. The English column is for reference and does not replace the Chinese definition.',
        glossarySearch: 'Search terms…',
        glossaryEmpty: 'No matching term',
        glossaryCat: 'Category',
        glossaryCount: '{n} terms / {c} categories'
      },

      foot: {
        line1: 'CONCORD · An interactive tuning laboratory',
        line2: 'National Student Digital Media Technology Competition · International Track · 2026',
        line3: 'Zero external dependencies · offline, double-click to open · every figure is recomputable',
        version: 'Version {v}',
        backTop: 'Back to top'
      }
    }
  };

  /* ---------------------------------------------------------------- 工具 */
  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }

  function flatten(src, prefix, out) {
    out = out || {};
    for (var k in src) {
      if (!Object.prototype.hasOwnProperty.call(src, k)) continue;
      var key = prefix ? prefix + '.' + k : k;
      if (isObj(src[k])) flatten(src[k], key, out);
      else out[key] = src[k];
    }
    return out;
  }

  var FLAT = { zh: flatten(DICT.zh, '', {}), en: flatten(DICT.en, '', {}) };

  function interpolate(str, vars) {
    if (!vars) return str;
    return String(str).replace(/\{(\w+)\}/g, function (m, name) {
      return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
    });
  }

  var LS_KEY = 'concord.lang';
  var current = 'zh';

  function safeGet(k) {
    try { return W.localStorage.getItem(k); } catch (e) { return null; }
  }
  function safeSet(k, v) {
    try { W.localStorage.setItem(k, v); } catch (e) { /* 静默 */ }
  }

  function paramLang() {
    // URL 语言参数：?lang=en / ?lang=zh（入口页「English」按钮、英文二维码用）
    var q = (W.location && W.location.search) || '';
    var m = /[?&]lang=(zh|en)\b/i.exec(q);
    if (!m) {
      var h = (W.location && W.location.hash) || '';
      m = /[#&]lang=(zh|en)\b/i.exec(h);
    }
    return m ? m[1].toLowerCase() : null;
  }

  function detectLang() {
    var fromUrl = paramLang();
    if (fromUrl) { safeSet(LS_KEY, fromUrl); return fromUrl; }
    var saved = safeGet(LS_KEY);
    if (saved === 'zh' || saved === 'en') return saved;
    var nav = (W.navigator && W.navigator.language) || '';
    return /^en/i.test(nav) && !/^zh/i.test(nav) ? 'en' : 'zh';
  }

  function t(key, vars) {
    var table = FLAT[current] || FLAT.zh;
    var v = table[key];
    if (v === undefined) {
      v = FLAT.zh[key];
      if (v === undefined) v = key;                    // 缺键回显键名，便于自测发现
    }
    return interpolate(v, vars);
  }

  function tIn(lang, key, vars) {
    var table = FLAT[lang] || FLAT.zh;
    var v = table[key] !== undefined ? table[key] : (FLAT.zh[key] !== undefined ? FLAT.zh[key] : key);
    return interpolate(v, vars);
  }

  var ATTR_MAP = {
    'data-i18n-aria': 'aria-label',
    'data-i18n-title': 'title',
    'data-i18n-ph': 'placeholder'
  };

  /** 把 root 子树内所有 data-i18n* 按当前语言重渲染 */
  function apply(root, lang) {
    if (lang) current = lang;
    var scope = root || W.document;
    if (!scope || !scope.querySelectorAll) return current;

    var nodes = scope.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var key = el.getAttribute('data-i18n');
      if (!key) continue;
      el.textContent = t(key);
    }
    var htmls = scope.querySelectorAll('[data-i18n-html]');
    for (var j = 0; j < htmls.length; j++) {
      htmls[j].innerHTML = t(htmls[j].getAttribute('data-i18n-html'));
    }
    for (var attr in ATTR_MAP) {
      if (!Object.prototype.hasOwnProperty.call(ATTR_MAP, attr)) continue;
      var list = scope.querySelectorAll('[' + attr + ']');
      for (var k = 0; k < list.length; k++) {
        list[k].setAttribute(ATTR_MAP[attr], t(list[k].getAttribute(attr)));
      }
    }
    return current;
  }

  function setLang(lang, opts) {
    if (lang !== 'zh' && lang !== 'en') lang = 'zh';
    current = lang;
    if (!opts || opts.remember !== false) safeSet(LS_KEY, lang);
    var html = W.document && W.document.documentElement;
    if (html) {
      html.setAttribute('lang', lang === 'en' ? 'en' : 'zh-CN');
      html.setAttribute('data-lang', lang);
    }
    return current;
  }

  /** 自测：找出缺失的键（zh/en 任一缺失即报） */
  function audit() {
    var missing = [];
    var zhKeys = Object.keys(FLAT.zh), enKeys = Object.keys(FLAT.en);
    for (var i = 0; i < zhKeys.length; i++) if (FLAT.en[zhKeys[i]] === undefined) missing.push('en:' + zhKeys[i]);
    for (var j = 0; j < enKeys.length; j++) if (FLAT.zh[enKeys[j]] === undefined) missing.push('zh:' + enKeys[j]);
    return missing;
  }

  var API = {
    dict: DICT,
    flat: FLAT,
    langs: ['zh', 'en'],
    t: t,
    tIn: tIn,
    apply: apply,
    setLang: setLang,
    detectLang: detectLang,
    audit: audit,
    keys: function () { return Object.keys(FLAT.zh); },
    get lang() { return current; }
  };

  current = detectLang();
  W.I18N = API;
})(typeof window !== 'undefined' ? window : this);
