/**
 * dsh-inju-boot 浏览器半身自检：在 node 里模拟 shell 的 __ModuleLoader__，
 * 把 client.js 当作真正的 bundle 加载一遍，然后检查它导出的插件契约与插槽注册。
 *
 *   node tools/selftest-client.mjs
 *
 * 它不渲染 React（没有 DOM），但足以抓住：bundle id 写错、factory 抛错、
 * 导出的 name/inject/apply 缺失、插槽名或 id 拼错、注册顺序不对。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = dirname(HERE)
const source = readFileSync(join(PACKAGE_DIR, 'client.js'), 'utf8')

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

/* ---- 最小的 react / window 桩：组件本身不会被调用，只要符号存在 ---- */
const reactStub = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

const store = new Map()
let loaded = null
const sandbox = {
  console,
  fetch: () => Promise.resolve({ ok: false, json: () => Promise.resolve(null) }),
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail } },
  Date,
  JSON,
  Number,
  Promise,
  Object,
  Array,
  String,
  Boolean,
  Math,
  Error,
  window: {
    __ModuleLoader__: { load(spec) { loaded = spec } },
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    clearInterval,
    clearTimeout,
    setInterval,
    setTimeout,
    sessionStorage: {
      getItem: (key) => (store.has(key) ? store.get(key) : null),
      setItem: (key, value) => store.set(key, value),
    },
  },
}
sandbox.globalThis = sandbox
sandbox.window.window = sandbox.window

console.log('\n[1] bundle 外壳')
vm.runInNewContext(source, sandbox, { filename: 'client.js' })
check('调用了 window.__ModuleLoader__.load', loaded !== null)
check('bundle id = dsh-inju-boot', loaded && loaded.id === 'dsh-inju-boot', loaded && loaded.id)
check('factory 是函数', loaded && typeof loaded.factory === 'function')

console.log('\n[2] 插件契约')
const requireStub = (name) => {
  if (name === 'react') return reactStub
  throw new Error('unexpected require: ' + name)
}
const mod = loaded.factory(requireStub)
check('name = dsh-inju-boot', mod.name === 'dsh-inju-boot', mod.name)
check('inject 只依赖 slots', Array.isArray(mod.inject) && mod.inject.length === 1 && mod.inject[0] === 'slots', JSON.stringify(mod.inject))
check('apply 是函数', typeof mod.apply === 'function')

console.log('\n[3] 插槽注册')
const registrations = []
const injections = []
const ctx = {
  slots: {
    inject(slot, callback) {
      injections.push(slot)
      const dispose = callback()
      return typeof dispose === 'function' ? dispose : () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
}
mod.apply(ctx)

check('inject 了两个插槽', injections.length === 2, JSON.stringify(injections))
check('注册了 2 个条目', registrations.length === 2, String(registrations.length))

const overlay = registrations.find((entry) => entry.options.name === 'shell.overlay')
const page = registrations.find((entry) => entry.options.name === 'settings.section')
check('shell.overlay 条目存在', overlay !== undefined)
check('shell.overlay id = dsh-inju-boot-overlay', overlay && overlay.options.id === 'dsh-inju-boot-overlay', overlay && overlay.options.id)
check('shell.overlay 组件是函数', overlay && typeof overlay.component === 'function')
check('shell.overlay label 是函数', overlay && typeof overlay.options.label === 'function')
check('settings.section 条目存在', page !== undefined)
check('settings.section id = inju-boot', page && page.options.id === 'inju-boot', page && page.options.id)
check('settings.section 组件是函数', page && typeof page.component === 'function')
check('settings.section label = INJU 启动动画', page && page.options.label() === 'INJU 启动动画', page && page.options.label())
check('两条注册都带 order', overlay && typeof overlay.options.order === 'number' && page && typeof page.options.order === 'number')

console.log('\n[4] 组件能渲染出元素树（不挂载 DOM，只跑一次纯函数渲染）')
// 覆盖层：初始 phase = idle → 返回 null；设置页：draft 为空 → 返回加载态。
// 这里只断言「不抛异常且返回合法 React 元素或 null」。
for (const entry of registrations) {
  try {
    const tree = entry.component({})
    const kind = tree === null ? 'null' : typeof tree === 'object' ? 'element' : typeof tree
    check(entry.options.name + ' 渲染不抛异常（' + kind + '）', tree === null || typeof tree === 'object')
  } catch (error) {
    check(entry.options.name + ' 渲染不抛异常', false, String(error && error.message ? error.message : error))
  }
}

console.log('\n[5] 源码卫生')
check('没有 require 任何 Harness Client 包',
  !/require\(\s*['"]@deepseek-ai\//.test(source), '不允许 import @deepseek-ai/*')
check('没有往 document.body 追加节点', !/document\.body\.append/.test(source))

// 除 artwork 外，颜色必须全部来自主题令牌。允许的硬编码色：
//   #04060a / #000           覆盖层与 iframe 的底色（artwork）
//   #dfe9f7 / #cfe0f4 / #8fa2bb  跳过按钮、声音提示（压在 artwork 上的自绘控件）
//   #f9fafb / #0f1115        原生标题栏按钮的符号色 —— 与 Electron 主进程
//                            chromeFallbackFill() / symbolColor 用的是同一对常量
const ALLOWED_HEX = ['#04060a', '#000', '#dfe9f7', '#8fa2bb', '#cfe0f4', '#f9fafb', '#0f1115']
const hexColors = [...new Set(source.match(/#[0-9a-fA-F]{3,8}\b/g) || [])]
check('硬编码颜色只出现在 artwork 里',
  hexColors.every((color) => ALLOWED_HEX.includes(color)), hexColors.join(' '))

// 只用宿主 Theme.listTokens 列出的令牌，拼错会静默降级成「没颜色」。
const KNOWN_TOKENS = new Set([
  '--dsw-alias-bg-base', '--dsw-alias-bg-layer-1', '--dsw-alias-bg-layer-2', '--dsw-alias-bg-overlay',
  '--dsw-alias-border-l1', '--dsw-alias-border-l2', '--dsw-alias-brand-primary',
  '--dsw-alias-label-primary', '--dsw-alias-label-secondary',
  '--dsw-alias-state-error-primary', '--dsw-alias-state-idle-primary',
  '--dsw-alias-state-success-primary', '--dsw-alias-state-warn-primary',
  '--dsw-specific-sidebar-fill',
])
const usedTokens = [...new Set(source.match(/--dsw-[a-z0-9-]+/g) || [])]
check('只使用宿主列出的主题令牌',
  usedTokens.every((token) => KNOWN_TOKENS.has(token)),
  usedTokens.filter((token) => !KNOWN_TOKENS.has(token)).join(' '))
check('用到了主题令牌（不是纯硬编码）', usedTokens.length >= 8, String(usedTokens.length))

console.log('\n[6] 极客 HUD 是可选配置')
check('有 formatHudLog / parseHudLog', source.includes('function formatHudLog') && source.includes('function parseHudLog'))
check('台词按「秒 文本」逐行解析', /match\(\/\^\(\[0-9\]\+/.test(source))
check('台词框只在改过时才写回（不会被冻结）', source.includes('hudLogDirty'))
check('HUD 关闭时台词框会说明「这层不会显示」', source.includes('极客 HUD 关闭时这层不会显示'))
check('HUD 开关说明「可选，默认开启」', source.includes('可选，默认开启'))
check('提供一键「开启并预览」', source.includes('enableHudAndPreview') && source.includes('开启并预览'))
check('save/preview 可接收草稿覆盖（供一键开启用）',
  source.includes('async (override)') && source.includes('const base = override'))
// React 会把点击事件当第一个参数传进 onClick，裸传 save/preview 会把事件当成草稿覆盖。
check('onClick 没有裸传 save/preview（避免事件被当成草稿）',
  !/onClick:\s*(save|preview)\s*[,}]/.test(source), '发现了 onClick: save / onClick: preview')

console.log('\n[7] 背景音乐自动播放 + 手势策略')
check('有自动播放探测（新建 AudioContext 看 running/suspended）',
  source.includes('function autoplayAllowed') && source.includes("probe.state === 'running'"))
check('探测结果被缓存（第一次手势后不再代表自动播放）',
  source.includes('let autoplayProbe = null') && source.includes('if (autoplayProbe !== null) return autoplayProbe'))
check('有替动画调用 INJU_AUDIO.unlock() 的桥',
  source.includes('function unlockFrameAudio') && source.includes('engine.unlock()'))
check('iframe onLoad 时就主动解锁音频（Electron 下无需点击即出声）',
  /onFrameLoad[\s\S]{0,900}unlockFrameAudio\(frameRef\.current\)/.test(source))
check('有统一的手势入口 onGesture', source.includes('const onGesture = React.useCallback'))
check('首次手势被吃掉（只解锁声音，不中断动画）',
  source.includes('firstGestureUnlocksAudioOnly !== false && !gestureUsedRef.current'))
check('两个布尔按「缺省即开启」读（宿主半身是旧版本时音频修复依然成立）',
  source.includes('config.audio !== false && config.audioHint !== false')
  && source.includes('config.audio !== false && config.firstGestureUnlocksAudioOnly !== false'))
check('宿主半身过旧时明确提示要重启', source.includes('宿主半身是旧版本'))
check('手势额度会被标记用掉', source.includes('gestureUsedRef.current = true'))
check('第二次起才按 skipOnClick / skipOnAnyKey 走',
  source.includes("if (kind === 'key' && config.skipOnAnyKey !== true) return")
  && source.includes("if (kind === 'pointer' && config.skipOnClick !== true) return"))
check('Esc 始终能跳过', source.includes("event.key === 'Escape'"))
check('每次手势都再推一次解锁（幂等）',
  /onGesture = React\.useCallback[\s\S]{0,400}unlockFrameAudio\(frameRef\.current\)/.test(source))
check('只有真的被拦下才提示点击（提示带 CSS 类）',
  source.includes('dsh-inju-boot-hint') && source.includes('!autoplayAllowed()'))
check('提示文案说明这次点击不会中断动画', source.includes('这次点击不会中断动画'))
check('设置页有背景音乐开关与音量', source.includes('背景音乐 / 音效') && source.includes('背景音乐音量'))
check('设置页有「首次点击只解锁声音」', source.includes('首次点击只解锁声音'))
check('设置页有「点击中断动画」', source.includes('点击中断动画'))
check('设置页有「按键中断动画」', source.includes('按键中断动画'))

console.log('\n[8] 窗口顶栏（Windows Electron）')
check('有顶栏处理的 apply/remove 两个函数',
  source.includes('function applyChromeBlend') && source.includes('function removeChromeBlend'))
check('透明的是 --dsw-specific-sidebar-fill（原生顶栏背景色的来源）',
  source.includes('--dsw-specific-sidebar-fill:transparent !important'))
check('只在 Windows Electron 上生效（html[data-windows-titlebar]）',
  source.includes('html[data-windows-titlebar]{'))
check('同时把原生按钮的符号色按覆盖层底色调到看得清',
  source.includes('function contrastOn') && source.includes('--dsw-alias-label-primary:'))
check('隐藏 Desktop 注入的菜单条（z-index 1100 那条）',
  source.includes('div[data-windows-menu]{display:none !important;}'))
check('style 挂在 document.head（preload 的 MutationObserver 只观察 head）',
  /applyChromeBlend[\s\S]{0,1200}document\.head\.appendChild\(style\)/.test(source))
check('开播前就应用（避免闪一下不透明顶栏）',
  /begin = React\.useCallback[\s\S]{0,1400}applyChromeBlend\(config\)/.test(source))
check('finish 时立刻还原（不等淡出结束）',
  /finish = React\.useCallback[\s\S]{0,600}removeChromeBlend\(\)/.test(source))
check('组件卸载时也还原（不留透明顶栏）',
  /removeEventListener\(PLAY_EVENT, onPlay\)[\s\S]{0,300}removeChromeBlend\(\)/.test(source))
check('两个开关按「缺省即开启」读',
  source.includes('config.blendTitlebar !== false') && source.includes('config.hideTitlebarMenu !== false'))
check('设置页有「顶栏融入动画」', source.includes('顶栏融入动画'))
check('设置页有「隐藏「应用 / 编辑」菜单」', source.includes('隐藏「应用 / 编辑」菜单'))

console.log('\n' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' · 共 ' + checks + ' 项断言')
process.exit(failures === 0 ? 0 : 1)
