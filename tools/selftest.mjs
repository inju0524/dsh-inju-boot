/**
 * dsh-inju-boot 自检：不需要 Harness、不需要浏览器，纯 node 跑完 Host 半身。
 *
 *   node tools/selftest.mjs
 *
 * 它做的事：
 *   1. 把 DSH_HOME 指向一个临时目录（不碰真实配置）
 *   2. 用假的 cordis ctx 挂载 index.js，收下它注册的全部 HTTP 路由
 *   3. 起一个真的 http 服务，把路由按 exact 路径派发，然后发真实请求断言
 *   4. 校验配置的读 / 写 / 替换 / 复位，以及动画资源与路径穿越防护
 */
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = dirname(HERE)

const home = mkdtempSync(join(tmpdir(), 'dsh-inju-boot-'))
process.env.DSH_HOME = home

let failures = 0
let checks = 0
function check(label, condition, detail = '') {
  checks++
  if (condition) {
    console.log('  ok   ' + label)
  } else {
    failures++
    console.log('  FAIL ' + label + (detail ? '  → ' + detail : ''))
  }
}

const routes = []
const ctx = {
  inject(services, callback) {
    if (!services.includes('webServer')) throw new Error('unexpected inject: ' + services.join(','))
    callback({
      effect(factory) { const dispose = factory(); return dispose },
      webServer: {
        register(route) { routes.push(route); return () => { routes.splice(routes.indexOf(route), 1) } },
      },
    })
  },
}

const plugin = await import(new URL('../index.js', import.meta.url).href)
plugin.apply(ctx, { enabled: true, oncePerSession: false })

const byPath = new Map(routes.map((route) => [route.path, route]))
const server = createServer(async (req, res) => {
  const path = (req.url ?? '').split('?')[0]
  const route = byPath.get(path)
  if (!route) {
    res.writeHead(404)
    res.end('no route')
    return
  }
  await route.handler(req, res)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = 'http://127.0.0.1:' + server.address().port
const get = (path) => fetch(base + path)
const postJson = (path, body) => fetch(base + path, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

try {
  console.log('\n[1] 路由注册')
  check('注册了 7 条 exact 路由', routes.length === 7, '实际 ' + routes.length)
  check('全部 kind=exact', routes.every((route) => route.kind === 'exact'))
  check('全部路径以 /api/inju-boot 开头', routes.every((route) => route.path.startsWith('/api/inju-boot')))

  console.log('\n[2] GET /config')
  const config = await (await get('/api/inju-boot/config')).json()
  check('ok=true', config.ok === true)
  check('默认启用', config.config.enabled === true)
  check('默认文字 INJU', config.config.text === 'INJU')
  check('默认 60000 粒子', config.config.count === 60000)
  check('极客 HUD 默认开启（可选配置）', config.config.showHud === true)
  check('HUD 开启 → telemetry=1', config.query.includes('telemetry=1'), config.query)
  check('DOM 装饰始终关掉（hud=0，否则会露出控制条）', config.query.includes('hud=0'), config.query)
  check('找到动画目录', config.resolved.animationFound === true, JSON.stringify(config.resolved.animationDir))
  check('来源是同级目录或自带副本',
    config.resolved.animationSource === 'sibling' || config.resolved.animationSource === 'bundled',
    config.resolved.animationSource)
  check('10 个阶段', Array.isArray(config.resolved.stages) && config.resolved.stages.length === 10)
  check('总时长 ≈ 21.05s（读的是动画目录那份 inju.config.js）',
    Math.abs(config.resolved.total - 21.05) < 0.01, String(config.resolved.total))
  check('预览查询串带上了画面参数',
    config.query.includes('n=60000') && config.query.includes('text=INJU'), config.query)
  check('配置文件落在临时 DSH_HOME 里',
    config.resolved.configFile === join(home, 'inju-boot', 'config.json'), config.resolved.configFile)
  check('回传了合成后的动画配置（设置页据此显示真实 HUD 台词）',
    config.resolved.animationConfig && Array.isArray(config.resolved.animationConfig.hud.log)
    && config.resolved.animationConfig.hud.log.length === 18,
    String(config.resolved.animationConfig && config.resolved.animationConfig.hud.log && config.resolved.animationConfig.hud.log.length))
  check('HUD 是可选的：关掉它也不丢内容，动画目录那份 hud 定义原样保留（随时可开）',
    config.resolved.animationConfig.hud.enabled === true
    && config.resolved.animationConfig.hud.rain === true)

  console.log('\n[2b] 背景音乐 / 音效')
  check('背景音乐默认开启', config.config.audio === true)
  check('默认音量 0.62', config.config.audioVolume === 0.62)
  check('「首次点击只解锁声音」默认开启', config.config.firstGestureUnlocksAudioOnly === true)
  check('自动播放被拦下时的提示默认开启', config.config.audioHint === true)
  check('audio=1 进了查询串', config.query.includes('audio=1'), config.query)
  check('合成配置里 audio.master 被插件音量接管，其它 audio 字段保持动画目录那份',
    config.resolved.animationConfig.audio.master === 0.62
    && config.resolved.animationConfig.audio.space === 0.5
    && config.resolved.animationConfig.audio.enabled === true,
    JSON.stringify(config.resolved.animationConfig.audio))

  console.log('\n[2c] 窗口顶栏（Windows Electron）')
  check('顶栏融入动画默认开启', config.config.blendTitlebar === true)
  check('隐藏「应用 / 编辑」菜单默认开启', config.config.hideTitlebarMenu === true)

  console.log('\n[2d] DeepSeek Harness 身份层随配置一起下发')
  const hudCfg = config.resolved.animationConfig.hud
  check('铭牌标题随配置下发', hudCfg.brand && hudCfg.brand.title === 'DEEPSEEK HARNESS', JSON.stringify(hudCfg.brand))
  check('副标题 / 出现时间 / 字距随配置下发',
    typeof hudCfg.brand.subtitle === 'string' && typeof hudCfg.brand.at === 'number' && typeof hudCfg.brand.spacing === 'number')
  check('dsh 启动命令行随配置下发', String(hudCfg.shell).includes('dsh --profile'), String(hudCfg.shell))
  check('遥测运行时字段随配置下发', Array.isArray(hudCfg.extra) && hudCfg.extra.length === 2, JSON.stringify(hudCfg.extra))
  check('进度条产品名随配置下发', hudCfg.progressLabel === 'DEEPSEEK HARNESS', String(hudCfg.progressLabel))
  check('DSH 启动日志随配置下发', String(hudCfg.log[0][1]).includes('deepseek-harness'), String(hudCfg.log[0][1]))

  console.log('\n[3] 动画资源托管')
  const boot = await get('/api/inju-boot/boot.html')
  const bootHtml = await boot.text()
  check('boot.html 200', boot.status === 200)
  check('boot.html 就是 inju-particles.html', bootHtml.includes('INJU') && bootHtml.includes('__ModuleLoader__') === false && bootHtml.includes('inju.config.js'))
  check('boot.html 内容与生效动画目录里的源文件逐字节一致',
    bootHtml === readFileSync(join(config.resolved.animationDir, 'inju-particles.html'), 'utf8'))

  const cfgJs = await (await get('/api/inju-boot/inju.config.js')).text()
  check('inju.config.js 是运行时合成的 window.INJU_CONFIG', cfgJs.includes('window.INJU_CONFIG = {'))
  check('合成配置继承了动画目录里的 stages（03=1.5s）',
    cfgJs.includes('"dur": 1.5'), '未找到 dur 1.5')
  check('合成配置继承了动画目录里的 audio 段', cfgJs.includes('"master": 0.62'))

  const audio = await get('/api/inju-boot/inju-audio.js')
  check('inju-audio.js 200', audio.status === 200 && (await audio.text()).includes('INJU_AUDIO'))

  const asset = await get('/api/inju-boot/asset?name=flower.jpg')
  check('asset?name=flower.jpg 200 + image/jpeg',
    asset.status === 200 && asset.headers.get('content-type') === 'image/jpeg')

  console.log('\n[4] 路径穿越防护')
  for (const evil of ['../index.js', '..\\index.js', 'C:/Windows/win.ini', 'nope.txt', '', 'sub/dir.js']) {
    const response = await get('/api/inju-boot/asset?name=' + encodeURIComponent(evil))
    check('拒绝 ' + JSON.stringify(evil), response.status === 404, 'status ' + response.status)
  }

  console.log('\n[5] POST /config（整份替换 + 关掉极客 HUD）')
  const saved = await (await postJson('/api/inju-boot/config', {
    replace: true,
    config: {
      text: 'CYBER',
      count: 120000,
      durationScale: 0.5,
      endStage: 9,
      showHud: false,
      audioVolume: 0.3,
      firstGestureUnlocksAudioOnly: false,
      advanced: {
        camera: { orbitYaw: 0.6 },
        moon: { radius: 2.6 },
        hud: {
          log: [[0.05, '[boot] inju boot animation'], [1.6, '[ok]  shader pipeline online']],
          brand: { title: 'MY OWN HARNESS' },
        },
      },
    },
  })).json()
  check('ok=true', saved.ok === true, JSON.stringify(saved.error ?? ''))
  check('text 生效', saved.config.text === 'CYBER')
  check('count 生效', saved.config.count === 120000)
  check('关掉极客 HUD 后 telemetry=0', saved.config.showHud === false && saved.query.includes('telemetry=0'), saved.query)
  check('音量设置生效', saved.config.audioVolume === 0.3)
  check('「首次点击只解锁声音」可关掉', saved.config.firstGestureUnlocksAudioOnly === false)
  check('advanced 生效', saved.config.advanced.camera.orbitYaw === 0.6)
  check('时长倍率拉短了总时长', Math.abs(saved.resolved.total - 21.05 * 0.5) < 0.01, String(saved.resolved.total))
  check('URL 参数跟着变', saved.query.includes('n=120000') && saved.query.includes('text=CYBER'), saved.query)

  const cfgJs2 = await (await get('/api/inju-boot/inju.config.js')).text()
  check('高级覆盖合并进了合成配置', cfgJs2.includes('"orbitYaw": 0.6') && cfgJs2.includes('"radius": 2.6'))
  check('倍率也写进了合成配置的 stages', cfgJs2.includes('"dur": 0.5'))
  check('HUD 终端台词覆盖生效（替换掉了动画自带的 18 行）',
    cfgJs2.includes('[boot] inju boot animation') && !cfgJs2.includes('particle_recon v3.1'))
  check('身份层也能被插件覆盖（铭牌换成 MY OWN HARNESS）',
    cfgJs2.includes('MY OWN HARNESS') && !cfgJs2.includes('"title": "DEEPSEEK HARNESS"'))
  check('音量设置写进了合成配置的 audio.master', cfgJs2.includes('"master": 0.3'))

  const onDisk = JSON.parse(readFileSync(join(home, 'inju-boot', 'config.json'), 'utf8'))
  check('配置真的落盘了', onDisk.text === 'CYBER' && onDisk.count === 120000)

  console.log('\n[5b] 背景音乐开关')
  const audioOff = await (await postJson('/api/inju-boot/config', { config: { audio: false } })).json()
  check('关掉背景音乐 → ?audio=0（连音效引擎都不加载）',
    audioOff.config.audio === false && audioOff.query.includes('audio=0'), audioOff.query)
  const audioOn = await (await postJson('/api/inju-boot/config', { config: { audio: true } })).json()
  check('打开背景音乐 → ?audio=1', audioOn.config.audio === true && audioOn.query.includes('audio=1'), audioOn.query)
  const volumeClamp = await (await postJson('/api/inju-boot/config', { config: { audioVolume: 9 } })).json()
  check('音量收敛到 0~1', volumeClamp.config.audioVolume === 1, String(volumeClamp.config.audioVolume))

  console.log('\n[5c] 极客 HUD 开关（默认开启，但两个方向都要能切）')
  const hudOff = await (await postJson('/api/inju-boot/config', { config: { showHud: false } })).json()
  check('关掉极客 HUD → telemetry=0',
    hudOff.config.showHud === false && hudOff.query.includes('telemetry=0'), hudOff.query)
  const hudOn = await (await postJson('/api/inju-boot/config', { config: { showHud: true } })).json()
  check('打开极客 HUD → telemetry=1',
    hudOn.config.showHud === true && hudOn.query.includes('telemetry=1'), hudOn.query)

  console.log('\n[5d] 窗口顶栏开关（两个方向都要能切）')
  const chromeOff = await (await postJson('/api/inju-boot/config', {
    config: { blendTitlebar: false, hideTitlebarMenu: false },
  })).json()
  check('两个开关都能关掉',
    chromeOff.config.blendTitlebar === false && chromeOff.config.hideTitlebarMenu === false,
    JSON.stringify({ blendTitlebar: chromeOff.config.blendTitlebar, hideTitlebarMenu: chromeOff.config.hideTitlebarMenu }))
  const chromeOn = await (await postJson('/api/inju-boot/config', {
    config: { blendTitlebar: true, hideTitlebarMenu: true },
  })).json()
  check('再打开也正常',
    chromeOn.config.blendTitlebar === true && chromeOn.config.hideTitlebarMenu === true)

  console.log('\n[6] 越界输入收敛')
  const clamped = await (await postJson('/api/inju-boot/config', {
    config: { count: 999999999, size: -5, dist: 0, mode: 'evil', endStage: 99, unknownKey: 1 },
  })).json()
  check('count 收敛到上限 400000', clamped.config.count === 400000, String(clamped.config.count))
  check('size 收敛到下限 0.3', clamped.config.size === 0.3, String(clamped.config.size))
  check('dist 收敛到下限 4', clamped.config.dist === 4, String(clamped.config.dist))
  check('mode 只允许 flower3d/photo', clamped.config.mode === 'flower3d', clamped.config.mode)
  check('endStage 收敛到 10', clamped.config.endStage === 10, String(clamped.config.endStage))
  check('未知字段被丢掉', clamped.config.unknownKey === undefined)

  console.log('\n[7] 复位与错误处理')
  const reset = await (await postJson('/api/inju-boot/config', { reset: true })).json()
  check('reset 回到出厂默认',
    reset.config.text === 'INJU' && reset.config.count === 60000 && reset.config.showHud === true,
    JSON.stringify({ text: reset.config.text, count: reset.config.count, showHud: reset.config.showHud }))
  check('reset 后 telemetry 回到默认的 1（极客 HUD 默认开启）', reset.query.includes('telemetry=1'), reset.query)
  check('reset 后背景音乐回到开启 + 音量 0.62 + 首次点击只解锁声音',
    reset.config.audio === true && reset.config.audioVolume === 0.62
    && reset.config.firstGestureUnlocksAudioOnly === true && reset.query.includes('audio=1'),
    JSON.stringify({ audio: reset.config.audio, volume: reset.config.audioVolume, first: reset.config.firstGestureUnlocksAudioOnly }))
  check('reset 后顶栏两项也回到开启',
    reset.config.blendTitlebar === true && reset.config.hideTitlebarMenu === true,
    JSON.stringify({ blendTitlebar: reset.config.blendTitlebar, hideTitlebarMenu: reset.config.hideTitlebarMenu }))
  check('reset 清掉了高级覆盖', Object.keys(reset.config.advanced).length === 0, JSON.stringify(reset.config.advanced))

  const badBody = await postJson('/api/inju-boot/config', ['not', 'an', 'object'])
  check('数组 body → 400', badBody.status === 400, 'status ' + badBody.status)
  const badMethod = await fetch(base + '/api/inju-boot/config', { method: 'DELETE' })
  check('DELETE → 405', badMethod.status === 405, 'status ' + badMethod.status)
  const badJson = await fetch(base + '/api/inju-boot/config', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{oops',
  })
  check('坏 JSON → 400', badJson.status === 400, 'status ' + badJson.status)

  console.log('\n[8] 纯函数')
  const merged = plugin.merge({ a: { b: 1, c: 2 }, list: [{ x: 1 }, { x: 2 }] }, { a: { c: 9 }, list: [{ x: 5 }] })
  check('merge 递归且数组按下标合并',
    merged.a.b === 1 && merged.a.c === 9 && merged.list[0].x === 5 && merged.list[1].x === 2)
  const auto = plugin.resolveAnimation({ animationDir: 'Z:\\definitely\\missing' })
  check('坏目录自动回退到可用目录', auto.found === true && auto.source !== 'configured', JSON.stringify(auto))
} catch (error) {
  failures++
  console.error('\n自检抛异常：', error)
} finally {
  server.close()
  rmSync(home, { recursive: true, force: true })
}

console.log('\n' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' · 共 ' + checks + ' 项断言')
process.exit(failures === 0 ? 0 : 1)
