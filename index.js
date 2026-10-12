/* =====================================================================================
   dsh-inju-boot · Host 半身
   -------------------------------------------------------------------------------------
   职责只有三件事：
     1. 拥有配置：内置默认值 ← cordis.patch.yml 的 config ← <DSH_HOME>/inju-boot/config.json
        （设置页写最后这一层，所以升级插件/改 YAML 都不会抹掉用户的选择）
     2. 托管动画：把「本项目目录下实现的 INJU 粒子动画」通过 /api/inju-boot/* 原样喂给
        浏览器半身（inju-particles.html / inju.config.js / inju-audio.js / flower.jpg）。
        inju.config.js 是**运行时合成**的：读取动画目录里那份配置对象，叠上插件覆盖，
        再序列化成 window.INJU_CONFIG = {...}，所以原文件一个字节都不用改。
     3. 暴露一个很小的 JSON API 给设置页读写配置。

   零外部依赖（只用 node: 内建模块），不 import 任何 @deepseek-ai/* 运行时包：
   宿主端的 API 面是会漂移的，能不依赖就不依赖。
   ===================================================================================== */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

export const name = 'dsh-inju-boot'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
/** 插件自带的动画副本（兜底：动画目录不可用时仍然能播）。 */
const PACKAGED_ASSETS = join(PACKAGE_DIR, 'assets')

const ROUTE_BASE = '/api/inju-boot'

/* ------------------------------------------------------------------ 内置默认值 */

/**
 * 内置的 10 个阶段时长（与 inju-particles.html 里的 STAGES 逐字一致）。
 * 只用于两件事：算出真实总时长，以及给设置页「结束阶段」下拉框提供时间点。
 * 真正的画面参数仍然全部由 inju.config.js / URL 参数决定。
 */
const BUILTIN_STAGES = [
  { label: '01 汇聚', dur: 3.2 },
  { label: '02 花体', dur: 2.6 },
  { label: '03 崩解', dur: 1.0 },
  { label: '04 重聚', dur: 2.4 },
  { label: '05 月球', dur: 2.4 },
  { label: '06 显影', dur: 2.7 },
  { label: '07 虚影', dur: 1.3 },
  { label: '08 闪切', dur: 0.75 },
  { label: '09 实体', dur: 3.6 },
  { label: '10 淡出', dur: 1.0 },
]

const DEFAULTS = {
  /* 总开关 */
  enabled: true,
  /** 同一次启动只播一次（会话级去重，避免开发时每次热重载都重播）。 */
  oncePerSession: true,

  /* 动画来源 */
  /** 空字符串 = 自动探测（插件上一级目录 → 插件自带 assets）。 */
  animationDir: '',

  /* 画面（这些直接映射到 URL 参数，优先级高于 inju.config.js） */
  text: 'INJU',
  count: 60000,
  size: 1.0,
  bloom: 1.0,
  intensity: 1.0,
  dist: 17.8,
  mode: 'flower3d',
  /**
   * 极客 HUD / 终端层 —— **可选配置，默认开启**。
   *
   * 画面上叠加：数字雨 + 跟随主体的目标框（含锁定动画）+ 扫描线（扫过的粒子
   * 会被真实照亮）+ 实时点云小图 + 终端日志 + 遥测 + hex dump。它画在 2D 画布上再作为
   * 纹理参与最终合成，所以是**画面的一部分**：会一起吃泛光、像素偏移闪切与 RGB 分离，
   * 也会被录进视频；不是贴在 DOM 上的 UI。
   *
   * 它不影响动画主体（花 → 月球 → 虚影文字 → LOGO），只决定要不要那层极客信息层。
   * 不想要极客风就在设置页关掉它，画面变成纯净全屏。台词在「HUD 终端台词」里改。
   */
  showHud: true,

  /* 背景音乐 / 音效 */
  /**
   * 背景音乐开关。关掉时直接给动画加 `?audio=0`，连音效引擎都不加载。
   *
   * 关于「自动播放」：动画的音频引擎只会在**首次用户手势**里创建 AudioContext
   * （inju-audio.js 的 init() 只从 unlock() 调用），所以光靠浏览器策略还不够 ——
   * 覆盖层会在动画文档就绪后**主动替它调用 unlock()**：
   *   · DSH Desktop 是 Electron，默认 autoplayPolicy = no-user-gesture-required，
   *     主动 unlock() 之后**不用点任何东西就会出声**；
   *   · 普通浏览器在用户与本域名交互过之前会把 AudioContext 挂起，
   *     这时靠「首次点击只解锁声音」那一下手势接上。
   */
  audio: true,
  /** 背景音乐音量（0~1），覆盖 inju.config.js 的 audio.master。 */
  audioVolume: 0.62,
  /** 自动播放被拦下时，在角落提示「点一下开启声音」。 */
  audioHint: true,
  /**
   * 首次点击 / 按键**只用来解锁声音**，不中断动画（默认开）。
   *
   * 这是「点了才有声音，但一点就把动画点没了」那个死结的解：第一次手势被吃掉，
   * 从第二次手势起才按下面的 skipOnClick / skipOnAnyKey 走。
   * 关掉它 = 第一次手势就按跳过规则处理。
   */
  firstGestureUnlocksAudioOnly: true,

  /* 播放 */
  /** 时间轴整体倍率：>1 更慢、<1 更快（等比拉伸每个阶段的时长）。 */
  durationScale: 1.0,
  /** 0 = 播完整个循环；1..10 = 播到第 N 个阶段末尾就结束。 */
  endStage: 0,
  fadeOutMs: 900,
  /** 兜底：无论发生什么都不要让覆盖层超过这么久。 */
  maxDurationMs: 90000,

  /* 交互 */
  skipOnClick: true,
  skipOnAnyKey: true,
  showSkipButton: true,
  skipLabel: '跳过 SKIP',

  /** 覆盖层底色（动画自己会铺满，这里只是首帧前的底）。 */
  backdrop: '#04060a',

  /* 窗口顶栏（Windows Electron） */
  /**
   * 让顶栏背景透明，融入动画。
   *
   * 右上角的最小化 / 最大化 / 关闭是 Chromium 原生的 Window Controls Overlay，CSS 碰不到
   * 按钮本身；但 Desktop preload 会用一个探针元素量出 `--dsw-specific-sidebar-fill`，
   * 再通过 `windowsAppearance` IPC 调 `setTitleBarOverlay()`。所以播放期间把这个变量改成
   * `transparent`，原生顶栏背景就变成 rgba(0,0,0,0)，动画从三个按钮后面透出来。
   * （DOM 里那条 40px 标题栏用的是同一个变量，一起透明。）
   */
  blendTitlebar: true,
  /**
   * 启动动画期间隐藏 Desktop 注入的「应用 / 编辑」菜单条。
   *
   * 它是 `div[data-windows-menu]`，`position:fixed; z-index:1100` 挂在 body 上；而
   * `shell.overlay` 的条目渲染在 `.BynINW_overlayLayer{z-index:20}` 这个层叠上下文里，
   * 所以覆盖层再高的 z-index 也压不住它 —— 只能先隐藏，播完自动恢复。
   */
  hideTitlebarMenu: true,

  /**
   * 高级：深度合并到 inju.config.js 之上。
   * 想改相机环绕、花瓣分层、月球半径、泛光阈值、终端台词……都写在这里，
   * 键名与 inju.config.js 完全一致。
   */
  advanced: {},
}

/* ------------------------------------------------------------------ 路径与文件 */

function dshHome() {
  const fromEnv = typeof process.env.DSH_HOME === 'string' ? process.env.DSH_HOME.trim() : ''
  return fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

function configFile() {
  return join(dshHome(), 'inju-boot', 'config.json')
}

/** 极简深合并：对象递归，数组按下标合并（stages 只写要改的那几项就够了）。 */
function merge(base, patch) {
  if (patch === undefined || patch === null) return clone(base)
  if (Array.isArray(base) || Array.isArray(patch)) {
    if (!Array.isArray(base) || !Array.isArray(patch)) return clone(patch)
    const out = base.map(clone)
    for (let i = 0; i < patch.length; i++) out[i] = merge(base[i], patch[i])
    return out
  }
  if (typeof base === 'object' && typeof patch === 'object') {
    const out = { ...base }
    for (const [key, value] of Object.entries(patch)) out[key] = merge(base[key], value)
    return out
  }
  return clone(patch)
}

function clone(value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(clone)
  const out = {}
  for (const [key, inner] of Object.entries(value)) out[key] = clone(inner)
  return out
}

function readJsonFile(path) {
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeJsonFile(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', 'utf8')
}

/* ------------------------------------------------------------------ 配置归一化 */

const clamp = (value, min, max, fallback) => {
  const n = typeof value === 'number' ? value : Number.parseFloat(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

const bool = (value, fallback) => (typeof value === 'boolean' ? value : fallback)

function str(value, fallback, maxLength = 512) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed.slice(0, maxLength)
}

/** 只保留已知字段并做范围收敛——设置页与 YAML 都可能送进任意东西。 */
function normalizeConfig(input, base = DEFAULTS) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const mode = str(raw.mode, base.mode, 32)
  return {
    enabled: bool(raw.enabled, base.enabled),
    oncePerSession: bool(raw.oncePerSession, base.oncePerSession),
    animationDir: typeof raw.animationDir === 'string' ? raw.animationDir.trim().slice(0, 512) : base.animationDir,

    text: str(raw.text, base.text, 48),
    count: Math.round(clamp(raw.count, 1000, 400000, base.count)),
    size: clamp(raw.size, 0.3, 3, base.size),
    bloom: clamp(raw.bloom, 0, 2, base.bloom),
    intensity: clamp(raw.intensity, 0.1, 3.5, base.intensity),
    dist: clamp(raw.dist, 4, 80, base.dist),
    mode: mode === 'photo' ? 'photo' : 'flower3d',
    showHud: bool(raw.showHud, base.showHud),

    audio: bool(raw.audio, base.audio),
    audioVolume: clamp(raw.audioVolume, 0, 1, base.audioVolume),
    audioHint: bool(raw.audioHint, base.audioHint),
    firstGestureUnlocksAudioOnly: bool(raw.firstGestureUnlocksAudioOnly, base.firstGestureUnlocksAudioOnly),
    durationScale: clamp(raw.durationScale, 0.1, 5, base.durationScale),
    endStage: Math.round(clamp(raw.endStage, 0, BUILTIN_STAGES.length, base.endStage)),
    fadeOutMs: Math.round(clamp(raw.fadeOutMs, 0, 10000, base.fadeOutMs)),
    maxDurationMs: Math.round(clamp(raw.maxDurationMs, 3000, 600000, base.maxDurationMs)),

    skipOnClick: bool(raw.skipOnClick, base.skipOnClick),
    skipOnAnyKey: bool(raw.skipOnAnyKey, base.skipOnAnyKey),
    showSkipButton: bool(raw.showSkipButton, base.showSkipButton),
    skipLabel: str(raw.skipLabel, base.skipLabel, 32),

    backdrop: str(raw.backdrop, base.backdrop, 64),
    blendTitlebar: bool(raw.blendTitlebar, base.blendTitlebar),
    hideTitlebarMenu: bool(raw.hideTitlebarMenu, base.hideTitlebarMenu),

    advanced: raw.advanced && typeof raw.advanced === 'object' && !Array.isArray(raw.advanced)
      ? clone(raw.advanced)
      : clone(base.advanced ?? {}),
  }
}

/* ------------------------------------------------------------------ 动画目录 */

function hasAnimation(dir) {
  try {
    return typeof dir === 'string' && dir !== '' && existsSync(join(dir, 'inju-particles.html'))
  } catch {
    return false
  }
}

/**
 * 解析动画目录，优先级：
 *   1. 设置页显式指定的 animationDir
 *   2. 插件的上一级目录（插件就放在动画项目里时，自动用「本项目目录下实现的动画」）
 *   3. 插件自带的 assets/ 副本（兜底，保证任何机器上都能播）
 */
function resolveAnimation(cfg) {
  const explicit = typeof cfg.animationDir === 'string' ? cfg.animationDir.trim() : ''
  const candidates = []
  if (explicit !== '') candidates.push({ dir: resolve(explicit), source: 'configured' })
  candidates.push({ dir: dirname(PACKAGE_DIR), source: 'sibling' })
  candidates.push({ dir: PACKAGED_ASSETS, source: 'bundled' })
  for (const candidate of candidates) {
    if (hasAnimation(candidate.dir)) return { ...candidate, found: true }
  }
  return { dir: explicit !== '' ? resolve(explicit) : dirname(PACKAGE_DIR), source: 'none', found: false }
}

/* ------------------------------------------------------------------ 动画配置合成 */

/** 动画目录里的 inju.config.js 是普通 JS（`window.INJU_CONFIG = {...}`），在沙箱里取值。 */
function readBaseAnimationConfig(dir) {
  const file = join(dir, 'inju.config.js')
  try {
    if (!existsSync(file)) return {}
    const text = readFileSync(file, 'utf8')
    const sandbox = { window: {}, location: { search: '' }, console: { log() {}, warn() {}, error() {} } }
    new vm.Script(text, { filename: file }).runInNewContext(sandbox, { timeout: 500 })
    const value = sandbox.window && sandbox.window.INJU_CONFIG
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/**
 * 合成最终交给浏览器的 window.INJU_CONFIG：
 *   动画目录的 inju.config.js  ←  插件 advanced 覆盖  ←  时间轴倍率
 * 返回 { script, stages, total }：script 是可直接 <script> 的文本，
 * stages/total 是**真实**时间轴，给设置页和覆盖层判断「播到第几秒算完」用。
 */
function composeAnimationConfig(cfg) {
  const animation = resolveAnimation(cfg)
  const base = animation.found ? readBaseAnimationConfig(animation.dir) : {}
  const effective = merge(base, cfg.advanced ?? {})

  const stages = BUILTIN_STAGES.map((builtin, index) => {
    const override = Array.isArray(effective.stages) ? effective.stages[index] : undefined
    const dur = override && typeof override === 'object' ? clamp(override.dur, 0.05, 120, builtin.dur) : builtin.dur
    const label = override && typeof override === 'object' && typeof override.label === 'string'
      ? override.label
      : builtin.label
    return { label, dur: dur * cfg.durationScale }
  })

  if (cfg.durationScale !== 1) {
    const scaled = Array.isArray(effective.stages) ? effective.stages.map(clone) : []
    for (let i = 0; i < stages.length; i++) {
      scaled[i] = { ...(scaled[i] && typeof scaled[i] === 'object' ? scaled[i] : {}), dur: stages[i].dur }
    }
    effective.stages = scaled
  }

  // 背景音乐音量：插件设置是这一项的**最终决定者**（覆盖 inju.config.js 的 audio.master）。
  // 只动 master，enabled / defaultOn / duck / space 等仍由动画目录那份配置说了算。
  const audioSection = effective.audio && typeof effective.audio === 'object' && !Array.isArray(effective.audio)
    ? effective.audio
    : {}
  effective.audio = { ...audioSection, master: cfg.audioVolume }

  const total = stages.reduce((sum, stage) => sum + stage.dur, 0)
  const script = [
    '/* generated by dsh-inju-boot — do not edit; edit the animation project or the plugin settings */',
    'window.INJU_CONFIG = ' + JSON.stringify(effective, null, 2) + ';',
    '',
  ].join('\n')

  return { animation, script, stages, total, base: effective }
}

/* ------------------------------------------------------------------ HTTP 小工具 */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  })
  res.end(body)
}

function sendText(res, status, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function sendBuffer(res, status, buffer, contentType) {
  res.writeHead(status, {
    'content-type': contentType,
    'content-length': buffer.length,
    'cache-control': 'no-store',
  })
  res.end(buffer)
}

async function readJsonBody(req, limit = 512 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8')
  if (text.trim() === '') return {}
  const parsed = JSON.parse(text)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('body must be a JSON object')
  return parsed
}

function methodNotAllowed(res, allow) {
  res.writeHead(405, { allow })
  res.end()
}

/* ------------------------------------------------------------------ 插件本体 */

/**
 * @param ctx - 宿主 cordis 上下文。
 * @param patchConfig - cordis.patch.yml 那一行的 config（出厂种子）。
 */
export function apply(ctx, patchConfig = {}) {
  const seed = normalizeConfig(patchConfig, DEFAULTS)
  let fileConfig = readJsonFile(configFile())
  if (fileConfig === null) {
    // 第一次挂载就把种子落盘，用户/设置页有一个看得见、改得动的文件。
    try {
      writeJsonFile(configFile(), seed)
      fileConfig = {}
    } catch {
      fileConfig = {}
    }
  }

  let current = normalizeConfig(merge(seed, fileConfig), seed)

  const snapshot = () => {
    const composed = composeAnimationConfig(current)
    return {
      config: current,
      query: previewQuery(current),
      resolved: {
        animationDir: composed.animation.dir,
        animationSource: composed.animation.source,
        animationFound: composed.animation.found,
        configFile: configFile(),
        packagedAssets: PACKAGED_ASSETS,
        packageDir: PACKAGE_DIR,
        stages: composed.stages,
        total: Number(composed.total.toFixed(3)),
        /** 合成后的完整动画配置（动画目录那份 ← advanced 覆盖），设置页据此显示真实当前值。 */
        animationConfig: composed.base,
      },
    }
  }

  /** 落盘并换上新配置；返回错误文本或 null。 */
  const commit = (next) => {
    current = next
    try {
      writeJsonFile(configFile(), current)
      return null
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
  }

  /* ---------------- 动画资源 ---------------- */

  /** 只允许动画目录里的普通文件，拒绝任何跨目录/绝对路径。 */
  function safeAssetPath(dir, name) {
    if (typeof name !== 'string' || name === '') return null
    if (name.includes('\0') || name.includes('..') || name.includes('/') || name.includes('\\')) return null
    if (extname(name) === '') return null
    const target = resolve(dir, name)
    if (dirname(target) !== resolve(dir)) return null
    if (!existsSync(target)) return null
    try {
      if (!statSync(target).isFile()) return null
    } catch {
      return null
    }
    return target
  }

  function serveAsset(res, name, forcedType) {
    const composed = composeAnimationConfig(current)
    const target = safeAssetPath(composed.animation.dir, name)
    if (target === null) {
      sendText(res, 404, 'not found: ' + name)
      return
    }
    const type = forcedType ?? MIME[extname(name).toLowerCase()] ?? 'application/octet-stream'
    sendBuffer(res, 200, readFileSync(target), type)
  }

  /* ---------------- 路由 ---------------- */

  const routes = [
    {
      path: ROUTE_BASE + '/config',
      handler: async (req, res) => {
        if (req.method === 'GET') {
          sendJson(res, 200, { ok: true, ...snapshot() })
          return
        }
        if (req.method !== 'POST') {
          methodNotAllowed(res, 'GET, POST')
          return
        }
        let body
        try {
          body = await readJsonBody(req)
        } catch (error) {
          sendJson(res, 400, { ok: false, error: error instanceof Error ? error.message : String(error) })
          return
        }
        // body.reset === true → 回到出厂默认；body.replace === true → 整份替换
        // （设置页用整份替换，这样把「高级 JSON」清空才真的清得掉）；
        // 否则按补丁合并。
        const full = body.config ?? body
        const next = body.reset === true
          ? normalizeConfig(seed, DEFAULTS)
          : body.replace === true
            ? normalizeConfig(full, DEFAULTS)
            : normalizeConfig(merge(current, full), current)
        const failure = commit(next)
        sendJson(res, failure === null ? 200 : 500, {
          ok: failure === null,
          ...(failure === null ? {} : { error: failure }),
          ...snapshot(),
        })
      },
    },
    {
      path: ROUTE_BASE + '/preview-url',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          methodNotAllowed(res, 'GET')
          return
        }
        sendJson(res, 200, { ok: true, url: ROUTE_BASE + '/boot.html', query: previewQuery(current) })
      },
    },
    {
      path: ROUTE_BASE + '/inju.config.js',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          methodNotAllowed(res, 'GET')
          return
        }
        // 运行时合成，绝不改写动画目录里的原文件。
        sendText(res, 200, composeAnimationConfig(current).script, MIME['.js'])
      },
    },
    {
      path: ROUTE_BASE + '/boot.html',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          methodNotAllowed(res, 'GET')
          return
        }
        const composed = composeAnimationConfig(current)
        const target = safeAssetPath(composed.animation.dir, 'inju-particles.html')
        if (target === null) {
          sendText(res, 404, 'animation not found: inju-particles.html', MIME['.html'])
          return
        }
        sendBuffer(res, 200, readFileSync(target), MIME['.html'])
      },
    },
    {
      path: ROUTE_BASE + '/inju-audio.js',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          methodNotAllowed(res, 'GET')
          return
        }
        serveAsset(res, 'inju-audio.js', MIME['.js'])
      },
    },
    {
      path: ROUTE_BASE + '/inju-particles.html',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          methodNotAllowed(res, 'GET')
          return
        }
        serveAsset(res, 'inju-particles.html', MIME['.html'])
      },
    },
    {
      path: ROUTE_BASE + '/asset',
      handler: (req, res) => {
        if (req.method !== 'GET') {
          methodNotAllowed(res, 'GET')
          return
        }
        let name = ''
        try {
          name = new URL(req.url ?? '', 'http://127.0.0.1').searchParams.get('name') ?? ''
        } catch {
          name = ''
        }
        serveAsset(res, name)
      },
    },
  ]

  ctx.inject(['webServer'], (hostCtx) => {
    hostCtx.effect(() => {
      const disposers = routes.map((route) => hostCtx.webServer.register({
        kind: 'exact',
        path: route.path,
        handler: route.handler,
      }))
      return () => {
        for (const dispose of disposers) {
          try {
            dispose()
          } catch {
            /* 已经随宿主一起拆掉了 */
          }
        }
      }
    }, 'dsh-inju-boot: /api/inju-boot routes')
  })
}

/**
 * 覆盖层 iframe 的查询串：URL 参数优先级高于 inju.config.js。
 *
 * ⚠ 两个「hud」是两件事，别搞混：
 *   · URL 的 `hud=0`      = 隐藏页面里的 DOM 装饰（标题 / 按键提示 / 底部控制条）。
 *                           覆盖层里必须给 0，否则底部会露出一个像播放器的控制条。
 *   · URL 的 `telemetry=` = **极客 HUD / 终端层**（画布内绘制的那一层）。
 *                           由 cfg.showHud 决定，默认开。
 * 两者互不影响：`hud=0&telemetry=1` = 干净全屏画面 + 完整极客 HUD。
 */
export function previewQuery(cfg) {
  const params = new URLSearchParams()
  params.set('hud', '0')                                   // 只关 DOM 装饰，不关极客 HUD
  params.set('telemetry', cfg.showHud ? '1' : '0')         // 极客 HUD / 终端层
  params.set('n', String(cfg.count))
  params.set('text', cfg.text)
  params.set('size', String(cfg.size))
  params.set('bloom', String(cfg.bloom))
  params.set('dist', String(cfg.dist))
  params.set('mode', cfg.mode)
  params.set('audio', cfg.audio ? '1' : '0')
  return params.toString()
}

export { DEFAULTS, BUILTIN_STAGES, composeAnimationConfig, normalizeConfig, resolveAnimation, merge }
