/* =====================================================================================
   INJU · 粒子动画  配置文件
   -------------------------------------------------------------------------------------
   直接改这里的文字与数字，保存后刷新页面即可生效（不需要重新构建，也不需要起服务器）。
   URL 参数依然可用，且优先级高于本文件，例如：
       inju-particles.html?text=ABC&n=90000&telemetry=0&t=9.5
   注意：本文件是普通 JS 脚本（不是 JSON），所以能离线双击打开也能用；
   语法上只需保持 window.INJU_CONFIG = { ... }; 的结构，不要在末尾漏掉分号。
   ===================================================================================== */
window.INJU_CONFIG = {

  /* ====================== 1. 文字 / 品牌 ====================== */
  text: 'INJU',                        // 虚影文字 + 实体 LOGO 的文字（任意长度，会自动缩放居中）
  fontStack: '"Arial Black","Segoe UI Black",Impact,"Helvetica Neue",Arial,sans-serif',
  letterSpacing: 26,                   // 字距（像素，基于 1280×512 的文字画布）
  textPlaneW: 12,                      // 文字 / LOGO 平面宽度（世界单位，越大字越大）

  /* ====================== 2. 粒子 ====================== */
  count: 60000,                        // 粒子总数（1000 ~ 400000；月球这种大体积建议 ≥ 60000）
  size: 1.0,                           // 全局粒子尺寸倍率（越小越细腻，越大越"实心"）
  intensity: 1.0,                      // 全局亮度倍率（页面里 [ ] 键也能实时调）

  /* ====================== 3. 时间轴 ====================== */
  /* 按数组下标对应阶段：0=01汇聚 1=02花体 2=03崩解 3=04重聚 4=05月球
                          5=06显影 6=07虚影 7=08闪切 8=09实体 9=10淡出
     只写想改的阶段即可。可改字段：
       label      阶段名（显示在页面与 HUD 遥测里）
       dur        时长（秒）
       size       该阶段的粒子尺寸
       alphaFrom / alphaTo     该阶段的亮度（0~2 左右）
       jitter     湍流抖动幅度（世界单位）
       stagger    错峰程度（0~0.8，越大越"波浪式"）
       burst      爆散冲量（只对崩解/重聚有意义）
       beamFrom / beamTo       背景体积光强度
       hud        极客 HUD 强度（0 = 该阶段隐藏 HUD）
   */
  stages: [
    { dur: 3.2 },                      // 01 汇聚：星尘聚成花形
    { dur: 2.6 },                      // 02 花体 · 环绕巡游（想多看环绕运镜就加大这个）
    { dur: 1.5 },                      // 03 崩解：爆散
    { dur: 2.0 },                      // 04 重聚：回吸成月球
    { dur: 2.4 },                      // 05 月球：静默自转
    { dur: 2.7 },                      // 06 显影：月球 → 虚影文字
    { dur: 1.3 },                      // 07 虚影：闪烁漂浮
    { dur: 0.75 },                     // 08 闪切：像素偏移 + RGB 分离
    { dur: 3.6 },                      // 09 实体：平面 LOGO
    { dur: 1.0 },                      // 10 淡出循环
  ],

  /* ====================== 4. 相机 ====================== */
  camera: {
    dist: 17.8,                        // 机距：越大画面整体越小、留白越多（越"精致"）
    fov: 38,                           // 视场角
    targetY: -1.25,                    // 环绕中心高度（让花与月球都居中）
    orbitYaw: 0.30,                    // 花形阶段的偏航环绕幅度（弧度，0 = 不环绕）
    orbitPitch: 0.09,                  // 花形阶段的俯仰环绕幅度
    dolly: 0.90,                       // 环绕时的推拉幅度
  },

  /* ====================== 5. 花（参数化 3D 雏菊） ====================== */
  flower: {
    headY: 1.75,                       // 花心高度
    tilt: 1.02,                        // 花头朝相机扳起的角度（弧度，0 = 平躺朝上）
    discR: 0.85,                       // 中心花心半径（越大花心越大）
    discBump: 0.20,                    // 花心隆起高度
    stemBot: -5.05,                    // 花茎底部高度
    soilY: -5.18,                      // 地面亮点高度
    light: [-0.42, 0.78, 0.46],        // 方向光方向（x,y,z）
    /* 花瓣分层：由外到内。每层可调：
         n      该层花瓣数（越多越密）
         baseR  花瓣根部半径
         len    花瓣长度
         wid    花瓣物理半宽（越大越宽）
         riseA / riseB   纵向姿态：riseB 越大尖端越向下弯
         cup    花瓣凹槽深度
         th     花瓣厚度（粒子填充的实体厚度）
         off    角度错位（相对一个花位的比例，用来层层交错） */
    layers: [
      { n: 30, baseR: 0.74, len: 2.10, wid: 0.44, riseA: 0.46, riseB: 0.78, cup: 0.13, th: 0.085, off: 0.00 },
      { n: 26, baseR: 0.68, len: 1.80, wid: 0.42, riseA: 0.46, riseB: 0.54, cup: 0.13, th: 0.080, off: 0.55 },
      { n: 22, baseR: 0.62, len: 1.48, wid: 0.38, riseA: 0.44, riseB: 0.32, cup: 0.12, th: 0.075, off: 0.30 },
      { n: 18, baseR: 0.56, len: 1.12, wid: 0.34, riseA: 0.40, riseB: 0.16, cup: 0.11, th: 0.070, off: 0.62 },
    ],
  },

  /* ====================== 6. 月球 ====================== */
  moon: {
    centerY: -1.15,                    // 球心高度
    radius: 2.20,                      // 半径（机距 17.8 时约占画面高度 40%）
    craters: 74,                       // 撞击坑数量（越多表面越碎）
    dust: 0.0025,                      // 月尘比例（离开表面的粒子占比，越小越干净）
    light: [-0.42, 0.78, 0.46],        // 方向光方向
  },

  /* ====================== 7. 画面 / 调色 ====================== */
  render: {
    bloom: 1.0,                        // 泛光强度（0 = 关）
    bloomThreshold: 0.78,              // 泛光阈值：越大只有更亮的地方才发光
    exposure: 1.06,                    // 曝光
    vignette: 1.0,                     // 暗角强度（0 = 关）
    scanline: 0.045,                   // 扫描线强度（0 = 关）
    grain: 0.028,                      // 颗粒噪点（0 = 关）
    beam: 0.30,                        // 背景体积光强度
    cool: [0.72, 0.86, 1.00],          // 粒子冷色（核心）
    warm: [1.00, 0.96, 0.86],          // 粒子暖色（高光）
  },

  /* ====================== 8. 极客 HUD / 终端层 ====================== */
  hud: {
    enabled: true,                     // false = 只剩纯粒子画面
    rain: true,                        // 背景数字雨

    /* ---------- DeepSeek Harness 身份层（启动动画的产品铭牌） ----------
       这是给「DeepSeek Harness 启动动画」用的身份：顶部铭牌 + 命令行 / 状态行 +
       遥测里的运行时字段 + 进度条上的产品名。
       风格刻意只用 HUD 已有的那套素材 —— 同一个 line() 绘制、同一套 DIM/HI/WARN 颜色、
       同一个 Consolas 等宽字体、同一套角框刻度语言 —— 所以它跟着 HUD 一起吃到泛光、
       像素偏移闪切与 RGB 分离，是「画面的一部分」，而不是贴上去的一块牌子。
       窄窗口会自动缩字号，再窄就不画；整层可以用 brand.enabled = false 一键关掉。 */
    brand: {
      enabled: true,
      title: 'DEEPSEEK HARNESS',       // 顶部中央的铭牌（按 spacing 逐字拉开）
      subtitle: 'agent runtime · cordis composition · profile desktop',
      at: 0.35,                        // 出现时间（秒，对齐阶段起点）
      fade: 0.7,                       // 淡入时长（秒）
      spacing: 0.34,                   // 字距（em，与页面 DOM 标题的 letter-spacing 一致）
    },
    shell: 'root@deepseek-harness:~# dsh --profile desktop',                 // 左上角命令行
    status: '[ok] cordis composition online  ·  sandbox: workspace-local',   // 左上角第二行
    guard: '[!!] approval: never  ·  telemetry: local  ·  sig 0x',           // 左上角第三行（末尾自动拼 0x+hex）
    /* 右上角遥测里追加的运行时字段：[标签, 值] */
    extra: [
      ['MODEL', 'deepseek-v4.1-flash'],
      ['RUNTIME', 'dsh 0.1.7 · node 22'],
    ],
    progressLabel: 'DEEPSEEK HARNESS', // 底部整段进度条上的产品名

    /* ---------- 终端日志 ---------- */
    /* [时间(秒), 文本]。想换台词、加梗、写自己的"攻防"内容，直接改这里。
       时间点建议对齐阶段起点：花 0s / 环绕 3.2s / 崩解 5.8s / 回吸 7.3s /
       月球 9.3s / 显影 11.7s / 虚影 14.4s / 闪切 15.7s / LOGO 16.45s。
       文本里的 `{text}` 会被换成真正的 LOGO 文字（含 ?text= 覆盖），
       所以改了 text 之后 rasterising "…" 那行会自动跟着变。 */
    log: [
      [0.05,  '[boot]  deepseek-harness 0.1.7 :: profile desktop'],
      [0.62,  '[ok]    cordis loader composed 6 bundles'],
      [1.60,  '[scan]  workspace index ......... 1284 files'],
      [2.55,  '[ok]    agent loop online :: deepseek-v4.1-flash'],
      [3.30,  '[lock]  session lock ............ 100%'],
      [4.60,  '[scan]  tool surface 42 schemas .. ready'],
      [5.85,  '[!!]    context window reshaping'],
      [6.55,  '[err]   stream renegotiated 1/1'],
      [6.90,  '[recon] provider route .......... ok'],
      [8.40,  '[scan]  memory snapshot 74 regions 0x4A2F'],
      [9.25,  '[lock]  workspace lock .......... 100%'],
      [10.40, '[ids]   sandbox policy .......... PASS'],
      [11.65, '[glyph] rasterising "{text}" ..... 60000 pts'],
      [13.20, '[net]   tls handshake ....... AES-256-GCM'],
      [14.35, '[warn]  chromatic desync incoming'],
      [15.65, '[glitch] slice offset injection'],
      [16.45, '[lock]  harness online'],
      [17.50, '[system] DeepSeek Harness · design by INJU'],
    ],
  },

  /* ====================== 9. 音效 ====================== */
  /* Apple 发布会式声音设计：双层氛围床（空气 Pad + Sub 低频）随阶段呼吸，
     事件化瞬态（汇聚 bloom / 崩解爆点 / 回吸上升 / 显影全息 / 闪切碎击 / LOGO 扫光）
     与画面毫秒级同步。纯 Web Audio 合成，零音频文件。
     页面底部有「音效」按钮（M 键切换），首次点击页面后才会出声（浏览器策略）。 */
  audio: {
    enabled: true,                     // false 或 URL 加 ?audio=0 → 彻底不加载声音
    defaultOn: true,                   // 页面默认开声音（用户可用按钮/M 键关）
    master: 0.62,                      // 总音量 0~1
    bed: 1.0,                          // 连续氛围床倍率
    sfx: 1.0,                          // 瞬态音效倍率
    ui: 1.0,                           // 交互音倍率
    duck: 0.30,                        // 崩解时床体下潜深度（闪避，突出爆点）
    space: 0.5,                        // 空间延迟（柔混响）发送量 0~1：把所有瞬态"融"进大厅
  },

  /* ====================== 10. 数据源 ====================== */
  mode: 'flower3d',                    // flower3d = 程序化 3D 花（默认）；photo = 照片粒子化
};
