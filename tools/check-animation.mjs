/**
 * check-animation.mjs —— 对**动画本体**的检查（不需要浏览器）。
 *
 *   node tools/check-animation.mjs [动画目录]
 *
 * 它做三件事，都是真跑代码而不是字符串匹配：
 *
 *   1. 把 inju-particles.html 里所有内联 <script> 抽出来做语法编译（vm.Script），
 *      抓注入 HUD 绘制代码时可能引入的语法错误。
 *   2. 用 vm 求值 inju.config.js，检查 DeepSeek Harness 身份层那几项配置。
 *   3. **把真正的 hudDraw() 抽出来，配一个会记账的假 2D 上下文跑一遍**，
 *      断言铭牌、命令行、遥测字段、进度条产品名、DSH 启动日志都真的被画了出来，
 *      并且铭牌在窄窗口下不会压到左边的命令行 / 右边的遥测。
 *      —— 没有浏览器时的替代方案：验证的是绘制调用，不是"字符串在不在文件里"。
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = dirname(HERE)
const positional = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
/**
 * 动画目录：显式参数 > 插件的上一级目录（插件就放在动画项目里时）> 插件自带的 assets 副本。
 * 第三种是为了让这个脚本在**独立 clone 出来的仓库里**也能跑（那里上一级目录没有动画）。
 */
const ANIMATION_DIR = resolve(
  positional[0]
  || (existsSync(join(dirname(PACKAGE_DIR), 'inju-particles.html')) ? dirname(PACKAGE_DIR) : join(PACKAGE_DIR, 'assets')),
)

let failures = 0
let checks = 0
function check(label, condition, detail = '') {
  checks++
  if (condition) console.log('  ok   ' + label)
  else {
    failures++
    console.log('  FAIL ' + label + (detail ? '  → ' + detail : ''))
  }
}

const htmlPath = join(ANIMATION_DIR, 'inju-particles.html')
const configPath = join(ANIMATION_DIR, 'inju.config.js')
if (!existsSync(htmlPath)) {
  console.error('找不到动画：' + htmlPath)
  process.exit(2)
}
const html = readFileSync(htmlPath, 'utf8')
const configSource = readFileSync(configPath, 'utf8')

/* ---------------------------------------------------------------- 1. 语法 */
console.log('\n[1] inju-particles.html 内联脚本语法')
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1])
check('抽到内联脚本', scripts.length >= 1, String(scripts.length))
scripts.forEach((source, i) => {
  try {
    new vm.Script(source, { filename: 'inline-' + i + '.js' })
    check('内联脚本 #' + (i + 1) + ' 编译通过（' + source.length + ' 字节）', true)
  } catch (error) {
    check('内联脚本 #' + (i + 1) + ' 编译通过', false, String(error && error.message ? error.message : error))
  }
})

/* ---------------------------------------------------------------- 2. 配置 */
console.log('\n[2] inju.config.js 的 DeepSeek Harness 身份层')
const configSandbox = { window: {}, location: { search: '' }, console }
new vm.Script(configSource, { filename: 'inju.config.js' }).runInNewContext(configSandbox, { timeout: 1000 })
const U = configSandbox.window.INJU_CONFIG
check('window.INJU_CONFIG 可求值', U !== null && typeof U === 'object')
const HUD_CFG = U.hud || {}
check('hud.brand.title = DEEPSEEK HARNESS', HUD_CFG.brand && HUD_CFG.brand.title === 'DEEPSEEK HARNESS', JSON.stringify(HUD_CFG.brand))
check('hud.brand 有副标题 / 出现时间 / 字距',
  typeof HUD_CFG.brand.subtitle === 'string' && typeof HUD_CFG.brand.at === 'number' && typeof HUD_CFG.brand.spacing === 'number')
check('hud.shell 是 dsh 启动命令行', typeof HUD_CFG.shell === 'string' && HUD_CFG.shell.includes('dsh --profile'), String(HUD_CFG.shell))
check('hud.extra 有 MODEL / RUNTIME',
  Array.isArray(HUD_CFG.extra) && HUD_CFG.extra.length === 2
  && HUD_CFG.extra[0][0] === 'MODEL' && HUD_CFG.extra[1][0] === 'RUNTIME', JSON.stringify(HUD_CFG.extra))
check('hud.progressLabel = DEEPSEEK HARNESS', HUD_CFG.progressLabel === 'DEEPSEEK HARNESS')
check('日志仍是 18 行', Array.isArray(HUD_CFG.log) && HUD_CFG.log.length === 18, String(HUD_CFG.log && HUD_CFG.log.length))
check('日志首行是 deepseek-harness 启动', String(HUD_CFG.log[0][1]).includes('deepseek-harness'), String(HUD_CFG.log[0][1]))
check('日志末行同时带上 DeepSeek Harness 与 INJU',
  String(HUD_CFG.log[17][1]).includes('DeepSeek Harness') && String(HUD_CFG.log[17][1]).includes('INJU'),
  String(HUD_CFG.log[17][1]))
check('日志里的 glyph 行用 {text} 占位符', String(HUD_CFG.log[12][1]).includes('{text}'), String(HUD_CFG.log[12][1]))

/* ---------------------------------------------------------------- 3. 真跑 hudDraw */
console.log('\n[3] 真跑 hudDraw()（记账式假 2D 上下文）')

/** 从 HTML 里按花括号配对抽出一个函数源码。 */
function extractFunction(source, signature) {
  const start = source.indexOf(signature)
  if (start === -1) throw new Error('找不到 ' + signature)
  const open = source.indexOf('{', start + signature.length - 1)
  let depth = 0
  for (let i = open; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error('花括号不配对：' + signature)
}

const brandSource = html.slice(html.indexOf('const HUD_BRAND'), html.indexOf('const HUD_LOG'))
check('能抽出身份层配置块', brandSource.length > 200 && brandSource.includes('HUD_PROGRESS_LABEL'), String(brandSource.length))

const hudDrawSource = extractFunction(html, 'function hudDraw(st, stg)')
check('能抽出 hudDraw()', hudDrawSource.length > 4000, String(hudDrawSource.length))

/** 记账式假 2D 上下文：measureText 按等宽字体估算，其余调用全部记录。 */
function makeRecordingContext() {
  const calls = []
  const ctx = {
    _font: '12px Consolas',
    get font() { return this._font },
    set font(v) { this._font = v },
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    textAlign: 'left', textBaseline: 'top', globalCompositeOperation: 'source-over',
    _size() {
      const m = /(\d+(?:\.\d+)?)px/.exec(this._font)
      return m ? Number(m[1]) : 12
    },
    measureText(text) {
      // Consolas 的等宽步进约 0.55em，这里取 0.60em 做保守上界
      return { width: String(text).length * this._size() * 0.60 }
    },
    fillText(text, x, y) {
      calls.push({ text: String(text), x, y, size: this._size(), alpha: this.globalAlpha, color: this.fillStyle })
    },
    clearRect() {}, drawImage() {}, fillRect() {}, strokeRect() {},
    beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    createRadialGradient() { return { addColorStop() {} } },
  }
  return { ctx, calls }
}

/** 用真配置 + 真 hudDraw 渲染一帧，返回绘制记录。 */
function renderFrame({ W, H, time, stage = 1, label = '02 / 花体 · 环绕巡游', stageP = 0.4, glitch = 0 }) {
  const { ctx, calls } = makeRecordingContext()
  const HUD = {
    W, H, time, dt: 1 / 60, acc: 0,
    // hudDraw 用的是 HUD.lctx（不是自由变量 c），所以假上下文必须挂在这里
    rain: {}, rctx: {}, layer: {}, lctx: ctx, cols: [], tex: null, ready: true,
    target: { x: W / 2, y: H * 0.52, r: Math.min(W, H) * 0.22, k: 1, lockT: 0 },
    scanY: 0, scanAmt: 0, kA: 1, kB: 1, kMix: 0,
    phase: stage + 1, stageP,
    yaw: 0.123, pitch: 0.045, dist: 16.2,
  }
  const sandbox = {
    HUD,
    CFG: { BLOOM: 1, MODE: 'flower3d', TEXT: 'INJU' },
    PARTICLE_COUNT: 60000,
    TOTAL: 21.05,
    KEY_BOUNDS: [
      { c: [0, 0, -2], r: 19.0 }, { c: [0, -1.0, 0], r: 5.20 },
      { c: [0, 0, 0], r: 6.80 }, { c: [0, -1.15, 0], r: 2.35 },
    ],
    SUBJECT_SAMPLES: { n: 0, k0: null, k1: null, k2: null, k3: null },
    RAIN_CHARS: '01<>/\\[]{}#$%&*+-=:;ABCDEF'.split(''),
    clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
    Math, console,
  }
  // 先跑 HTML 里那段真实的身份层配置块（它自己会从 UH 里取值 / 兜默认）
  sandbox.UH = HUD_CFG
  new vm.Script(brandSource + '\nglobalThis.__brand = { HUD_BRAND, HUD_SHELL, HUD_STATUS, HUD_GUARD, HUD_EXTRA, HUD_PROGRESS_LABEL };')
    .runInNewContext(sandbox, { timeout: 1000 })
  Object.assign(sandbox, sandbox.__brand)
  // 日志（含 {text} 替换），与 HTML 里那段逻辑一致
  sandbox.HUD_LOG = HUD_CFG.log.map((row) => [row[0], String(row[1]).replace(/\{text\}/g, 'INJU')])
  const fn = new vm.Script('(' + hudDrawSource + ')').runInNewContext(sandbox, { timeout: 1000 })
  fn({ glitch, size: 2.4, hud: 0.7 }, { i: stage, s: { label } })
  return { calls, HUD }
}

const textOf = (calls) => calls.map((c) => c.text).join('')
const titleChars = 'DEEPSEEK HARNESS'.split('')

/** 逐字绘制的标题：用「首字左边缘 + 末字右边缘」算视觉中点（末字宽 = 字号 × 0.6）。 */
function glyphSpan(glyphs) {
  const first = glyphs[0]
  const last = glyphs[glyphs.length - 1]
  return { left: first.x, right: last.x + last.size * 0.60 }
}

console.log('\n  — 1920×1080（宽屏，铭牌应该完整出现） —')
{
  const { calls } = renderFrame({ W: 1920, H: 1080, time: 2.0 })
  const all = textOf(calls)
  const titleGlyphs = calls.filter((c) => c.text.length === 1 && titleChars.includes(c.text))
  check('铭牌标题逐字画了出来', titleGlyphs.length >= titleChars.length,
    '单字绘制 ' + titleGlyphs.length + ' 个')
  if (titleGlyphs.length >= titleChars.length) {
    const span = glyphSpan(titleGlyphs.slice(0, titleChars.length))
    check('标题是居中的（视觉中点 ≈ W/2）', Math.abs((span.left + span.right) / 2 - 960) < 2,
      '中点 ' + ((span.left + span.right) / 2).toFixed(1))
    check('标题有字距（不是挤在一起的等宽默认间距）', (span.right - span.left) > titleChars.length * 8,
      'span ' + (span.right - span.left).toFixed(1))
    check('标题在最上面一行', Math.abs(titleGlyphs[0].y - (18 * (1080 / 720) + 12 * (1080 / 720) * 0.10)) < 4,
      'y ' + titleGlyphs[0].y.toFixed(1))
  }
  check('副标题画了出来', calls.some((c) => c.text === HUD_CFG.brand.subtitle))
  check('命令行是 dsh 启动命令', all.includes(HUD_CFG.shell))
  check('状态行画了出来', all.includes(HUD_CFG.status))
  check('guard 行末尾带 0x + hex', /sig 0x[0-9A-F]{4}/.test(all), '未匹配')
  check('遥测里出现 MODEL 标签与值', all.includes('MODEL') && all.includes('deepseek-v4.1-flash'))
  check('遥测里出现 RUNTIME 标签与值', all.includes('RUNTIME') && all.includes('dsh 0.1.7 · node 22'))
  check('进度条上带产品名', all.includes('DEEPSEEK HARNESS') && /% {2}DEEPSEEK HARNESS/.test(all),
    '未匹配进度条标签')
  check('终端日志画了出来（含 harness online 之前的行）', all.includes('[ok]') || all.includes('[lock]'))
  check('回归：原有 HUD 元素仍在', all.includes('PHASE') && all.includes('PARTICLES') && all.includes('POINT CLOUD') && all.includes('TARGET'))
}

console.log('\n  — 1280×720（中等窗口） —')
{
  const { calls } = renderFrame({ W: 1280, H: 720, time: 2.0 })
  const all = textOf(calls)
  const glyphs = calls.filter((c) => c.text.length === 1 && titleChars.includes(c.text)).slice(0, titleChars.length)
  check('铭牌仍然画出来', glyphs.length >= titleChars.length, String(glyphs.length))
  check('铭牌没有压到左边的命令行', glyphs.every((c) => c.x > 18 + 12 * 0.6 * 0),
    'left ' + (glyphs[0] ? glyphs[0].x.toFixed(1) : 'n/a'))
  check('铭牌没有压到右边的遥测', glyphs.every((c) => c.x < 1280 - 18),
    'right ' + (glyphs[glyphs.length - 1] ? glyphs[glyphs.length - 1].x.toFixed(1) : 'n/a'))
  check('副标题也在', all.includes(HUD_CFG.brand.subtitle))
}

console.log('\n  — 640×400（窄窗口，应该缩字号或干脆不画，绝不能重叠） —')
{
  const { calls } = renderFrame({ W: 640, H: 400, time: 2.0 })
  const glyphs = calls.filter((c) => c.text.length === 1 && titleChars.includes(c.text)).slice(0, titleChars.length)
  const FS = Math.max(9, 12 * (400 / 720))
  const shellWidth = HUD_CFG.shell.length * FS * 0.60
  const statusWidth = HUD_CFG.status.length * FS * 0.60
  const gapLeft = Math.max(18 * (400 / 720) + 132 * (400 / 720), 18 * (400 / 720) + shellWidth, 18 * (400 / 720) + statusWidth) + 20 * (400 / 720)
  check('铭牌要么缩字号要么不画（没有溢出）',
    glyphs.length === 0 || (glyphs[0].x >= gapLeft && glyphs.every((c) => c.x < 640)),
    glyphs.length ? ('left ' + glyphs[0].x.toFixed(1) + ' gapLeft ' + gapLeft.toFixed(1)) : '未绘制')
  if (glyphs.length > 0) {
    const span = glyphSpan(glyphs)
    check('缩字号后仍然居中', Math.abs((span.left + span.right) / 2 - 320) < 3,
      '中点 ' + ((span.left + span.right) / 2).toFixed(1))
  }
}

console.log('\n  — 时间轴：淡入之前不出现，LOGO 阶段仍在 —')
{
  const before = renderFrame({ W: 1920, H: 1080, time: 0.10 })
  check('hud.brand.at 之前铭牌不出现',
    !before.calls.some((c) => c.text.length === 1 && titleChars.includes(c.text) && c.alpha > 0.02))
  const atLogo = renderFrame({ W: 1920, H: 1080, time: 18.5, stage: 8, label: '09 / 实体 · 平面 LOGO' })
  const all = textOf(atLogo.calls)
  check('LOGO 阶段铭牌仍在（跟着 HUD 一起被压暗，不是消失）',
    atLogo.calls.some((c) => c.text.length === 1 && titleChars.includes(c.text)))
  // 末行日志是"逐字打出来"的，所以只能断言前缀
  check('末行日志正在被逐字打出（DeepSeek Harness · design by INJU 的前缀）',
    atLogo.calls.some((c) => c.text.startsWith('[system] DeepSeek Har')),
    '未找到该行的任何前缀')
  const atGlyph = renderFrame({ W: 1920, H: 1080, time: 13.5, stage: 5, label: '06 / 显影 · 虚影文字 INJU' })
  const glyphText = textOf(atGlyph.calls)
  check('日志里的 {text} 已被替换成真实文字（rasterising "INJU"）',
    glyphText.includes('rasterising "INJU"') && !glyphText.includes('{text}'),
    '未匹配 rasterising "INJU"')
}

console.log('\n[4] 关掉身份层之后应该什么都不画')
{
  const original = HUD_CFG.brand.enabled
  HUD_CFG.brand.enabled = false
  const { calls } = renderFrame({ W: 1920, H: 1080, time: 2.0 })
  const all = textOf(calls)
  check('brand.enabled=false 时铭牌消失',
    !calls.some((c) => c.text.length === 1 && titleChars.includes(c.text) && c.alpha > 0.02))
  check('命令行 / 遥测 / 进度条仍然在（它们不归 brand 管）',
    all.includes(HUD_CFG.shell) && all.includes('MODEL') && all.includes('DEEPSEEK HARNESS'))
  HUD_CFG.brand.enabled = original
}

console.log('\n' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' · 共 ' + checks + ' 项断言')

/* ---------------------------------------------------------------- 可选：把某一帧的 HUD 排版打出来 */
if (process.argv.includes('--dump')) {
  const width = Number((process.argv.find((a) => a.startsWith('--w=')) || '--w=1920').slice(4))
  const height = Number((process.argv.find((a) => a.startsWith('--h=')) || '--h=1080').slice(4))
  const time = Number((process.argv.find((a) => a.startsWith('--t=')) || '--t=2.0').slice(4))
  const { calls } = renderFrame({ W: width, H: height, time })
  console.log('\n=== HUD 排版（' + width + '×' + height + '，t=' + time + 's）===')
  const rows = new Map()
  for (const call of calls) {
    if (call.text.trim() === '') continue
    const key = Math.round(call.y)
    if (!rows.has(key)) rows.set(key, [])
    rows.get(key).push(call)
  }
  for (const y of [...rows.keys()].sort((a, b) => a - b)) {
    const items = rows.get(y).sort((a, b) => a.x - b.x)
    // 逐字绘制的铭牌（模拟 letter-spacing 的那段循环）合并回一行显示
    const merged = []
    let lastWasSingle = false
    for (const item of items) {
      const single = item.text.length === 1
      if (single && lastWasSingle) merged[merged.length - 1].text += item.text
      else merged.push({ x: item.x, text: item.text })
      lastWasSingle = single
    }
    console.log('  y=' + String(y).padStart(4) + '  ' + merged
      .map((m) => '[' + Math.round(m.x) + ']' + m.text)
      .join('   '))
  }
}

process.exit(failures === 0 ? 0 : 1)
