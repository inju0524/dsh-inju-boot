/* =====================================================================================
   INJU · 粒子动画  音效引擎（inju-audio.js）  v2 · 柔性气流版
   -------------------------------------------------------------------------------------
   Apple 发布会式声音设计：克制、未来感、与画面毫秒级同步。
   本版音色取向：【柔 / 气 / 融】——
     · 无钟声、无敲击、无硬起音；所有瞬态都是慢起音的正弦涌浪 + 滤波气流噪声
     · 事件之间由一条轻量空间延迟（类发布会大厅的柔混响）粘合，声音从画面里"浮"出来
     · 全程低通柔化处理，高频只保留空气感，绝不刺耳
   - 纯 Web Audio API 程序化合成，零音频文件、零外部依赖、离线可用（file:// 双击也行）。
   - 双层连续氛围床（Airy Pad 空气层 + Sub 低频层）随 10 个阶段连续呼吸；
     事件化瞬态（汇聚气流吸入 / 崩解柔爆 / 回吸上升涌浪 / 显影呼吸和声 /
     闪切柔化数字碎粒 / LOGO 浮现 + 扫光 / 循环呼气淡出）挂在阶段边界。
   - 音频时钟用 AudioContext.currentTime 追踪动画时间轴 T：
     * 暂停 / 拖进度条 / 跳段（1…0）→ 所有预定事件自动重对齐
     * 播放速度（- = 键）→ 床体音高与滤波实时跟速
     * 粒子亮度（[ ] 键）→ 床体明亮度联动
   - 视觉代码只插入 5 个探针调用（不改任何画面逻辑）：
       SFX.frame(stg, st, dt, T, playing)          每帧驱动
       SFX.notifyJump('stage'|'restart'|'scrub')   跳段 / 重播 / 拖条
       SFX.setBrightness(v) / SFX.setRate(v)       亮度 / 速度联动
       SFX.toggle()                                底部「音效」按钮
   - 配置入口：inju.config.js 里的 `audio` 段（音量、开关），URL 可用 ?audio=0 关闭。
   ===================================================================================== */
window.INJU_AUDIO = (function () {
  'use strict';

  /* ---------------------------------- 配置 ---------------------------------- */
  const U = (window.INJU_CONFIG && window.INJU_CONFIG.audio) || {};
  const QS = new URLSearchParams(location.search);
  const num = (v, d) => (typeof v === 'number' && isFinite(v)) ? v : d;

  const CFG = {
    ENABLED:  QS.get('audio') !== '0' && U.enabled !== false,   // 总开关（首次手势后才出声）
    DEFAULT:  QS.get('audio') === '1' ? true : (U.defaultOn !== false),  // 页面默认是否开声音
    MASTER:   num(U.master, 0.62),        // 总音量（0~1，内部还有软限幅）
    BED:      num(U.bed, 1.0),            // 连续氛围床整体倍率
    SFX:      num(U.sfx, 1.0),            // 瞬态音效整体倍率
    UI:       num(U.ui, 1.0),             // 交互音（跳段/按钮）倍率
    DUCK:     num(U.duck, 0.30),          // 崩解时床体下潜深度（闪避，突出爆点）
    SPACE:    num(U.space, 0.5),          // 空间延迟（柔混响）发送量 0~1
  };

  /* ---------------------------------- 状态 ---------------------------------- */
  let ctx = null, master = null, comp = null, silk = null;
  let busBed = null, busSfx = null, busUi = null;
  let dly = null, dlyFb = null, dlyOut = null, dlyFlt = null;   // 空间延迟（柔混响）
  let pad = null, sub = null, air = null;
  let ready = false, suspended = true;
  let on = CFG.ENABLED && CFG.DEFAULT;
  let lastStage = -1;
  let pending = [];              // {at, fn} 预定在未来 T 轴上的事件（拖条/暂停时重排）
  let timelineT = 0, timelineV = 1, lastAudioT = 0;
  let fx = { bright: 1, rate: 1, camYaw: 0 };

  /* ---------------------------------- 小工具 ---------------------------------- */
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const now = () => ctx.currentTime;
  function env(g, t0, pts, curve) {          // pts: [[dt, v], …] 指数包络（防爆音）
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(Math.max(0.0001, pts[0][1]), t0);
    for (let i = 1; i < pts.length; i++) {
      const t = t0 + pts[i][0], v = Math.max(0.0001, pts[i][1]);
      if (curve === 'lin') g.gain.linearRampToValueAtTime(v, t);
      else g.gain.exponentialRampToValueAtTime(v, t);
    }
  }
  function noiseBuf(sec, color) {            // 生成噪声 buffer（'white'|'pink'|'brown'）
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (color === 'pink') {
        b0 = 0.99765 * b0 + w * 0.0990460; b1 = 0.96300 * b1 + w * 0.2965164; b2 = 0.57000 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.25;
      } else if (color === 'brown') {
        last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2;
      } else d[i] = w;
    }
    return buf;
  }
  function src(buf, rate) { const s = ctx.createBufferSource(); s.buffer = buf; s.playbackRate.value = rate || 1; return s; }
  function osc(type, f) { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; return o; }
  function g(v) { const x = ctx.createGain(); x.gain.value = v === undefined ? 0 : v; return x; }
  function flt(type, f, q) { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q || 0.7; return x; }
  function pan(v) { const x = ctx.createStereoPanner(); x.pan.value = clamp(v, -1, 1); return x; }

  /* ---------------------------------- 初始化（需用户手势） ---------------------------------- */
  function init() {
    if (ready || !CFG.ENABLED) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC({ latencyHint: 'interactive' });

    master = g(0); comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 26; comp.ratio.value = 3.5;
    comp.attack.value = 0.010; comp.release.value = 0.24;
    /* 总线"丝绸"低通：把一切瞬态的棱角磨圆，只留空气感 */
    silk = flt('lowpass', 9500, 0.3);
    master.connect(silk); silk.connect(comp); comp.connect(ctx.destination);

    busBed = g(0); busSfx = g(0); busUi = g(0);
    busBed.connect(master); busSfx.connect(master); busUi.connect(master);

    /* 轻量空间延迟：0.31s + 低通反馈 ≈ 发布会大厅的柔混响，把所有事件"融"进空间 */
    dly = ctx.createDelay(1.0); dly.delayTime.value = 0.31;
    dlyFlt = flt('lowpass', 2800, 0.4);
    dlyFb = g(0.38); dlyOut = g(0);
    busSfx.connect(dly); busUi.connect(dly);
    dly.connect(dlyFlt); dlyFlt.connect(dlyFb); dlyFb.connect(dly);
    dlyFlt.connect(dlyOut); dlyOut.connect(master);

    buildBed();
    ready = true; suspended = ctx.state === 'suspended';
    applyMaster();
  }
  function applyMaster() {
    if (!ready) return;
    const target = on ? CFG.MASTER : 0;
    master.gain.setTargetAtTime(target, now(), 0.3);
    busBed.gain.setTargetAtTime(on ? 0.9 * CFG.BED : 0, now(), 0.4);
    busSfx.gain.setTargetAtTime(on ? 1.0 * CFG.SFX : 0, now(), 0.08);
    busUi.gain.setTargetAtTime(on ? 0.7 * CFG.UI : 0, now(), 0.08);
    dlyOut.gain.setTargetAtTime(on ? 0.5 * CFG.SPACE : 0, now(), 0.4);
  }

  /* ================================ 连续氛围床 ================================
     三层：pad（双振荡微失谐和声垫，随阶段换和弦）/ sub（正弦低频锚点）/ air（滤波粉噪空气层）。
     每帧根据 stg.i 与 st（alpha/ghost/glitch/beam）连续调制，不做任何阶跃。
     v2：Pad 改用更柔的 triangle 基波 + 更慢的呼吸常数，整体更"绒"。 */
  const CHORDS = [                            // 每阶段的和声（Hz，极简、留白多）
    [174.61, 261.63, 349.23, 523.25],         // 01 汇聚   F 大调加九 —— 温暖唤起
    [174.61, 261.63, 349.23, 440.00],         // 02 花体   同系展开
    [155.56, 233.08, 311.13, 466.16],         // 03 崩解   降 E —— 失稳下坠
    [130.81, 196.00, 261.63, 392.00],         // 04 重聚   C 系回吸
    [130.81, 196.00, 329.63, 392.00],         // 05 月球   纯五度 + 大十度 —— 静默开阔
    [146.83, 220.00, 293.66, 440.00],         // 06 显影   D 系全息
    [146.83, 220.00, 349.23, 440.00],         // 07 虚影   轻微悬浮
    [138.59, 207.65, 277.18, 415.30],         // 08 闪切   半音压迫
    [174.61, 261.63, 349.23, 523.25],         // 09 实体   回归 F —— 揭示落定
    [130.81, 196.00, 261.63, 329.63],         // 10 淡出   收束
  ];
  const BED_LVL = [0.50, 0.42, 0.28, 0.46, 0.55, 0.42, 0.38, 0.32, 0.56, 0.40];
  const SUB_LVL = [0.15, 0.13, 0.18, 0.22, 0.28, 0.17, 0.13, 0.11, 0.24, 0.13];
  const SUB_FRQ = [43.65, 43.65, 38.89, 32.70, 32.70, 36.71, 36.71, 34.65, 43.65, 32.70];

  function buildBed() {
    pad = { oscs: [], gains: [], filter: flt('lowpass', 750, 0.3), out: g(0) };
    for (let v = 0; v < 4; v++) {
      /* triangle 基波 + 微失谐：比锯齿波柔得多，靠滤波低通过出"绒垫"感 */
      const oa = osc('triangle', 220), ob = osc('triangle', 220 * 1.005);
      const gg = g(0);
      oa.connect(gg); ob.connect(gg); gg.connect(pad.filter);
      pad.oscs.push([oa, ob]); pad.gains.push(gg);
      oa.start(); ob.start();
    }
    pad.filter.connect(pad.out); pad.out.connect(busBed);

    sub = { o: osc('sine', 43.65), out: g(0) };
    sub.o.connect(sub.out); sub.out.connect(busBed); sub.o.start();

    air = { s: src(noiseBuf(3, 'pink'), 1), f: flt('bandpass', 2200, 0.5), out: g(0) };
    air.s.loop = true; air.s.connect(air.f); air.f.connect(air.out); air.out.connect(busBed);
    air.s.start();
  }

  function bedFrame(stg, st, dt) {
    if (!ready || !on) return;
    const i = stg.i, p = stg.p;
    const iN = Math.min(i + 1, CHORDS.length - 1);
    const mix = p > 0.66 ? (p - 0.66) / 0.34 : 0;         // 阶段尾部 34% 预滑向下一和弦
    const chord = CHORDS[i], next = CHORDS[iN];
    const t = now(), tau = 0.6;                           // 更慢的呼吸，彻底无阶跃

    for (let v = 0; v < 4; v++) {
      const f = lerp(chord[v], next[v], mix) * Math.pow(2, (fx.rate - 1) * 0.5);
      pad.oscs[v][0].frequency.setTargetAtTime(f, t, tau);
      pad.oscs[v][1].frequency.setTargetAtTime(f * 1.005, t, tau);
    }
    let lvl = lerp(BED_LVL[i], BED_LVL[Math.min(iN, 9)], mix);
    lvl *= 0.55 + 0.45 * clamp(st.alpha, 0, 1.4) / 1.4;   // 粒子亮度 → 床体响度
    lvl *= 1 - CFG.DUCK * (i === 2 ? Math.sin(Math.PI * Math.min(1, p * 1.15)) : 0);   // 崩解下潜
    pad.out.gain.setTargetAtTime(0.075 * lvl * clamp(fx.bright, 0.25, 3), t, 0.4);
    pad.filter.frequency.setTargetAtTime(520 + 1900 * clamp(st.beam, 0, 1) * clamp(fx.bright, 0.3, 2.2), t, 0.5);

    const sf = lerp(SUB_FRQ[i], SUB_FRQ[Math.min(iN, 9)], mix);
    sub.o.frequency.setTargetAtTime(sf, t, 0.6);
    sub.out.gain.setTargetAtTime(0.095 * lerp(SUB_LVL[i], SUB_LVL[Math.min(iN, 9)], mix), t, 0.5);

    air.out.gain.setTargetAtTime(0.018 * (0.4 + 0.6 * clamp(st.ghost, 0, 1)) * (i >= 5 && i <= 7 ? 1.6 : 1), t, 0.6);
    air.f.frequency.setTargetAtTime(1600 + 2100 * clamp(st.ghost, 0, 1), t, 0.6);
  }

  /* ================================ 瞬态音效（全柔性） ================================
     设计要点：
       · 所有"涌浪"起音 ≥ 120ms，峰值低、尾巴长，经空间延迟后与床体融为一体
       · 用正弦 / 三角波，不用锯齿；噪声一律低通或带通柔化
       · 没有任何"敲击点"——阶段转换靠【气流方向 + 音簇涌浪】表达，不靠打击 */
  function schedule(delayFromNow, fn) { pending.push({ at: timelineT + delayFromNow, fn }); }

  /* —— 柔 · 音簇涌浪：一组正弦先后浮起，再缓缓落下（替代上一版的"定形钟"） —— */
  function swell(freqs, vel, atk, rel, spread, t0) {
    t0 = t0 || (now() + 0.02);
    freqs.forEach((f, k) => {
      const o = osc('sine', f), gg = g(0), pn = pan(((k % 3) - 1) * 0.28 + (spread || 0) * 0.5);
      o.connect(gg); gg.connect(pn); pn.connect(busSfx);
      const d = 0.06 * k;                                  // 声部依次浮起，像花瓣张开
      env(gg, t0 + d, [[0, 0.0001], [atk, vel / (1 + k * 0.35)], [atk + rel, 0.0001]]);
      o.start(t0 + d); o.stop(t0 + d + atk + rel + 0.1);
    });
  }

  /* —— 柔 · 气流：滤波粉噪做一次方向性呼吸（吸入 = 频率上扬；呼出 = 频率下落） —— */
  function breath(t0, dur, f0, f1, vel, q) {
    const n = src(noiseBuf(Math.max(1, dur + 0.5), 'pink')), f = flt('bandpass', f0, q || 0.9), gg = g(0);
    n.connect(f); f.connect(gg); gg.connect(busSfx);
    f.frequency.setValueAtTime(f0, t0);
    f.frequency.exponentialRampToValueAtTime(Math.max(60, f1), t0 + dur);
    env(gg, t0, [[0, 0.0001], [dur * 0.45, vel], [dur, 0.0001]]);
    n.start(t0); n.stop(t0 + dur + 0.3);
  }

  /* —— 柔 · 低频托底：正弦从高处缓缓滑落，给"质量"但不给"冲击" —— */
  function lowGlide(t0, f0, f1, dur, vel) {
    const o = osc('sine', f0), gg = g(0);
    o.frequency.setValueAtTime(f0, t0);
    o.frequency.exponentialRampToValueAtTime(Math.max(24, f1), t0 + dur * 0.8);
    o.connect(gg); gg.connect(busSfx);
    env(gg, t0, [[0, 0.0001], [dur * 0.25, vel], [dur, 0.0001]]);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }

  /* —— 柔 · 数字颗粒：极短的三角波小滴，低通后像远处服务器的水滴（闪切/虚影用） —— */
  function droplet(t0, f, vel, dur, p) {
    const o = osc('sine', f), gg = g(0), pn = pan(p || 0), lp = flt('lowpass', 3200, 0.4);
    o.frequency.setValueAtTime(f, t0);
    o.frequency.exponentialRampToValueAtTime(f * 0.7, t0 + dur);
    o.connect(lp); lp.connect(gg); gg.connect(pn); pn.connect(busSfx);
    env(gg, t0, [[0, 0.0001], [0.025, vel], [dur, 0.0001]]);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }

  /* —— 01 汇聚：长吸气流（画面在吸聚）→ 无声部"落钟"，只在成形点放一团温暖和声涌浪 —— */
  function sfxGather(dur) {
    const t0 = now() + 0.02, d = Math.max(1.6, dur);
    breath(t0, d, 240, 1500, 0.10, 1.1);                  // 吸入：气流随汇聚缓缓上扬
    lowGlide(t0 + d * 0.25, 87, 52, d * 0.75, 0.10);      // 质量感慢慢聚拢
    schedule(dur - 0.05, () => {                          // 成形：没有"叮"，只有和声像花瓣一样张开
      swell([349.23, 523.25, 698.46], 0.085, 0.55, 1.9, 0);
    });
  }

  /* —— 03 崩解：柔爆 —— 低频气流轰然散开（不带敲击），碎粒是远处的水滴 —— */
  function sfxBurst() {
    const t0 = now() + 0.01;
    lowGlide(t0, 110, 27, 0.9, 0.34);                     // 低频下滑：质量散开，不砸
    breath(t0, 1.1, 900, 220, 0.16, 0.8);                 // 气流从胸腔喷出后迅速变远
    breath(t0 + 0.05, 0.8, 2400, 700, 0.05, 1.4);         // 表层极轻的粒子气
    for (let k = 0; k < 6; k++) {                         // 稀疏碎粒：远处水滴，不成串
      const dt = 0.10 + k * 0.09 + Math.random() * 0.06;
      droplet(t0 + dt, 1100 + Math.random() * 1500, 0.020 + Math.random() * 0.012, 0.22 + Math.random() * 0.15, (Math.random() * 2 - 1) * 0.7);
    }
  }

  /* —— 04 重聚：上升涌浪 —— 三组正弦依次浮起，把画面"托"回月球 —— */
  function sfxReform(dur) {
    const t0 = now() + 0.02;
    breath(t0, Math.max(1.2, dur * 0.8), 300, 1100, 0.07, 1.0);   // 回吸气流（与汇聚呼应但更轻）
    [0, 0.45, 0.9].forEach((d, k) => {
      const f = 261.63 * Math.pow(1.26, k);
      const o = osc('sine', f), gg = g(0), pn = pan((k - 1) * 0.4);
      o.frequency.setValueAtTime(f, t0 + d);
      o.frequency.exponentialRampToValueAtTime(f * 1.19, t0 + d + dur * 0.7);
      o.connect(gg); gg.connect(pn); pn.connect(busSfx);
      env(gg, t0 + d, [[0, 0.0001], [0.5, 0.045], [dur * 0.85, 0.0001]]);
      o.start(t0 + d); o.stop(t0 + d + dur);
    });
    schedule(dur - 0.15, () => {                          // 月球成形：安静的五度涌浪
      swell([196.00, 293.66, 392.00], 0.075, 0.6, 2.2, 0);
    });
  }

  /* —— 06 显影：呼吸和声 —— 像显影液里慢慢浮出文字 —— */
  function sfxReveal() {
    const t0 = now() + 0.02;
    swell([293.66, 440.00, 587.33], 0.055, 1.1, 2.4, 0);  // 慢起音和声：没有"出现"，只有"浮现"
    breath(t0 + 0.3, 2.0, 500, 1600, 0.045, 1.2);         // 一层很轻的气流托着
    schedule(1.5, () => swell([880, 1174.66], 0.028, 0.7, 1.6, 0.2));  // 尾部一点高光
  }

  /* —— 07 虚影：漂浮闪烁（极稀疏水滴，由 frame 概率驱动） —— */
  function ghostTick(t) {
    if (Math.random() < 0.032) {
      droplet(now() + 0.01, 800 + Math.random() * 1400, 0.014 + Math.random() * 0.010, 0.35 + Math.random() * 0.3, Math.sin(t * 1.1) * 0.7);
    }
  }

  /* —— 08 闪切：柔化数字碎粒 —— 低通水滴串 + 一段气流扫带 + 中点温柔的"落位" —— */
  function sfxGlitch(dur) {
    const t0 = now() + 0.01;
    for (let k = 0; k < 7; k++) {                         // 碎粒：低通过的水滴，柔、疏、不扎耳
      const dt = 0.02 + k * 0.055 + (k % 2) * 0.022;
      droplet(t0 + dt, 1300 + ((k * 613) % 1700), 0.030, 0.10 + (k % 3) * 0.04, ((k % 5) - 2) * 0.35);
    }
    breath(t0, dur * 0.9, 1200, 2800, 0.05, 1.6);         // 静电被磨成一层气
    schedule(dur * 0.60, () => {                          // 硬切为实体 LOGO：不再"砸"，而是温柔落位
      lowGlide(now() + 0.01, 82, 41, 0.7, 0.22);
      swell([261.63, 392.00, 523.25], 0.08, 0.4, 1.8, 0);
    });
  }

  /* —— 09 实体：LOGO 浮现 + 扫光（扫光 = 气流感声像从左到右，不是泛音铃） —— */
  function sfxLogo() {
    const t0 = now() + 0.02;
    swell([349.23, 523.25, 698.46, 1046.5], 0.065, 0.7, 2.4, 0);   // 品牌落定：温暖和声
    const n = src(noiseBuf(2.2, 'pink')), f = flt('bandpass', 2600, 1.6), gg = g(0), pn = pan(-0.75);
    n.connect(f); f.connect(gg); gg.connect(pn); pn.connect(busSfx);
    pn.pan.setValueAtTime(-0.75, t0 + 0.4);
    pn.pan.linearRampToValueAtTime(0.75, t0 + 0.4 + 1.5); // 扫光：一束气从左耳滑到右耳
    f.frequency.setValueAtTime(1800, t0 + 0.4); f.frequency.exponentialRampToValueAtTime(3600, t0 + 1.2);
    f.frequency.exponentialRampToValueAtTime(2000, t0 + 1.9);
    env(gg, t0 + 0.4, [[0, 0.0001], [0.6, 0.030], [1.6, 0.0001]]);
    n.start(t0 + 0.4); n.stop(t0 + 2.3);
  }

  /* —— 10 循环淡出：一次完整的呼气 —— */
  function sfxFade(dur) {
    const t0 = now() + 0.02;
    breath(t0, Math.max(0.6, dur), 1400, 300, 0.05, 1.0); // 呼气：频率缓缓落下
    lowGlide(t0, 65, 33, dur, 0.08);                      // 低频随之沉底
  }

  /* —— UI 交互音（跳段 / 按钮）：柔水滴，不成"咔哒" —— */
  function uiTick(f) {
    if (!ready || !on) return;
    droplet(now() + 0.005, f || 1100, 0.035, 0.12, 0);
  }

  /* ================================ 主驱动 ================================ */
  function frame(stg, st, dt, T, playing) {
    if (!ready) return;
    const aT = now();
    if (playing && !suspended) {                          // 音频时钟追踪动画时间轴
      timelineT += (aT - lastAudioT) * (timelineV || 1);
      if (Math.abs(timelineT - T) > 0.6) timelineT = T;   // 拖条/跳段后硬对齐
    } else timelineT = T;
    lastAudioT = aT;
    fx.camYaw = (typeof HUD !== 'undefined' && HUD.yaw) || 0;

    /* 触发到期的预定事件 */
    for (let i = pending.length - 1; i >= 0; i--) {
      if (pending[i].at <= timelineT) { const e = pending.splice(i, 1)[0]; e.fn(); }
    }
    if (pending.length > 40) pending.splice(0, pending.length - 40);

    /* 阶段切换 → 触发该阶段的事件音效 */
    if (stg.i !== lastStage) {
      const prev = lastStage; lastStage = stg.i;
      if (on && playing) {
        const d = stg.s.dur;
        switch (stg.i) {
          case 0: if (prev >= 0) uiTick(740); sfxGather(d); break;
          case 1: break;                                  // 环绕巡游：只有床体（克制）
          case 2: sfxBurst(); break;
          case 3: sfxReform(d); break;
          case 4: break;                                  // 月球静默：留白
          case 5: sfxReveal(); break;
          case 6: break;                                  // 虚影：由下方 ghostTick 概率点缀
          case 7: sfxGlitch(d); break;
          case 8: sfxLogo(); break;
          case 9: sfxFade(d); break;
        }
      }
    }
    if (on && playing && stg.i === 6) ghostTick(T);       // 虚影阶段稀疏闪烁

    bedFrame(stg, st, dt);
  }

  /* ================================ 对外接口 ================================ */
  return {
    frame,
    get on() { return on; },
    get enabled() { return CFG.ENABLED; },
    unlock() {                                            // 首次用户手势：创建/恢复音频
      if (!CFG.ENABLED) return;
      init();
      if (ready && ctx.state === 'suspended') ctx.resume();
      suspended = false;
      lastAudioT = ctx ? now() : 0;
      if (on) uiTick(880);
    },
    toggle() {
      if (!CFG.ENABLED) return false;
      on = !on; applyMaster();
      if (on) uiTick(880);
      return on;
    },
    setOn(v) { if (CFG.ENABLED) { on = !!v; applyMaster(); } },
    setBrightness(v) { fx.bright = v; },
    setRate(v) { fx.rate = clamp(v, 0.15, 3); timelineV = fx.rate; },
    notifyJump(kind) {                                    // 拖条/跳段/重播：清空未触发事件并重对齐
      pending.length = 0;
      if (ready) timelineT = -1e9;                        // 下一帧与 T 硬对齐
      lastStage = -1;                                     // 强制重新触发当前阶段事件
      if (kind === 'stage') uiTick(1244.5);
      else if (kind === 'restart') uiTick(659.25);
      else if (kind === 'scrub') uiTick(987.77);
    },
  };
})();
