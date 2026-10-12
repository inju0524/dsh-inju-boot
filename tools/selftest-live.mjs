/**
 * dsh-inju-boot 在线自检：对着**正在运行的 Harness** 打真实 HTTP 请求。
 * 它验证的是「装完之后浏览器真正拿得到什么」，而不是源码。
 *
 *   node tools/selftest-live.mjs [baseUrl]
 *
 * 默认 baseUrl = http://127.0.0.1:19387（DSH_WEB_URL 优先）。
 */
import vm from 'node:vm'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR = dirname(HERE)
const PROFILE_DIR = process.env.DSH_PROFILE_DIR
  || join(process.env.DSH_HOME || join(process.env.USERPROFILE || '', '.dsh'), 'profiles', process.env.DSH_PROFILE || 'desktop')

const base = (process.argv[2] || process.env.DSH_WEB_URL || 'http://127.0.0.1:19387').replace(/\/$/, '')
const api = base + '/api/inju-boot'

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

const get = async (url) => {
  const response = await fetch(url, { redirect: 'follow' })
  return { status: response.status, type: response.headers.get('content-type') || '', body: await response.text() }
}

try {
  console.log('\n目标：' + base)

  console.log('\n[1] Host 路由在线')
  const config = await get(api + '/config')
  check('/config 200', config.status === 200, 'status ' + config.status)
  const snapshot = JSON.parse(config.body)
  check('ok=true', snapshot.ok === true)
  check('找到动画目录', snapshot.resolved.animationFound === true, snapshot.resolved.animationDir)
  check('10 个阶段 · 总时长 ' + snapshot.resolved.total + 's',
    snapshot.resolved.stages.length === 10 && snapshot.resolved.total > 0)
  check('配置文件路径指向 DSH_HOME', /[\\/]inju-boot[\\/]config\.json$/.test(snapshot.resolved.configFile), snapshot.resolved.configFile)
  const liveQuery = new URLSearchParams(snapshot.query)
  check('极客 HUD 是可选配置：开关与 telemetry 一一对应',
    (liveQuery.get('telemetry') === '1') === (snapshot.config.showHud === true),
    'showHud=' + snapshot.config.showHud + ' telemetry=' + liveQuery.get('telemetry'))
  check('DOM 装饰始终关掉（hud=0，否则会露出控制条）', liveQuery.get('hud') === '0', snapshot.query)
  check('背景音乐开关与 ?audio= 一一对应',
    (liveQuery.get('audio') === '1') === (snapshot.config.audio === true),
    'audio=' + snapshot.config.audio + ' ?audio=' + liveQuery.get('audio'))

  console.log('\n[2] 动画本体可被浏览器取到')
  const boot = await get(api + '/boot.html')
  check('/boot.html 200 + text/html', boot.status === 200 && boot.type.includes('text/html'), boot.type)
  check('是真正的 inju-particles.html',
    boot.body.includes('<canvas id="gl">') && boot.body.includes('inju.config.js') && boot.body.includes('inju-audio.js'))
  // 动画本体是**按请求现读**项目目录那份文件的，所以身份层一改就立刻生效，不用重启 Harness。
  check('服务出去的动画本体已经带 DeepSeek Harness 身份层',
    boot.body.includes('DEEPSEEK HARNESS') && boot.body.includes('HUD_BRAND') && boot.body.includes('HUD_PROGRESS_LABEL'))
  const hudDrawBody = boot.body.slice(
    boot.body.indexOf('function hudDraw(st, stg)'),
    boot.body.indexOf('function hudUpdate('),
  )
  check('身份层由 HUD 自己的绘制函数画出（所以会一起吃到泛光与闪切）',
    hudDrawBody.includes('HUD_BRAND') && hudDrawBody.includes('HUD_SHELL') && hudDrawBody.includes('HUD_PROGRESS_LABEL')
    && hudDrawBody.length > 1000,
    'hudDraw 片段 ' + hudDrawBody.length + ' 字节')
  check('日志支持 {text} 占位符替换', /replace\(\/\\\{text\\\}\/g, CFG\.TEXT\)/.test(boot.body))

  const audio = await get(api + '/inju-audio.js')
  check('/inju-audio.js 200 + javascript', audio.status === 200 && audio.type.includes('javascript'), audio.type)
  check('音效引擎内容正确', audio.body.includes('window.INJU_AUDIO'))
  // 覆盖层的音频桥靠 iframe.contentWindow.INJU_AUDIO.unlock()：这个函数必须真的存在，
  // 否则「主动解锁 → 自动播放」整条链就断了。
  check('音效引擎确实暴露了 unlock()（音频桥的目标）',
    /unlock\(\)\s*\{/.test(audio.body) && audio.body.includes('function init()'))
  check('音效引擎只在 unlock() 里创建 AudioContext（所以必须由覆盖层主动推一把）',
    (audio.body.match(/new AC\(/g) || []).length === 1)

  console.log('\n[3] 合成配置是合法 JS 且合并正确')
  const cfg = await get(api + '/inju.config.js')
  check('/inju.config.js 200 + javascript', cfg.status === 200 && cfg.type.includes('javascript'), cfg.type)
  const sandbox = { window: {}, location: { search: '' }, console }
  let evaluated = null
  try {
    new vm.Script(cfg.body, { filename: 'inju.config.js (served)' }).runInNewContext(sandbox, { timeout: 1000 })
    evaluated = sandbox.window.INJU_CONFIG
  } catch (error) {
    check('合成配置可执行', false, String(error && error.message ? error.message : error))
  }
  check('window.INJU_CONFIG 是个对象', evaluated !== null && typeof evaluated === 'object')
  if (evaluated) {
    check('继承了动画目录的 stages（03 = 1.5s）',
      Array.isArray(evaluated.stages) && Math.abs(evaluated.stages[2].dur - 1.5) < 1e-9,
      JSON.stringify(evaluated.stages && evaluated.stages[2]))
    check('继承了动画目录的 audio 段（master = 0.62）',
      evaluated.audio && Math.abs(evaluated.audio.master - 0.62) < 1e-9, JSON.stringify(evaluated.audio))
    check('继承了动画目录的 camera 段（dist = 17.8）',
      evaluated.camera && Math.abs(evaluated.camera.dist - 17.8) < 1e-9, JSON.stringify(evaluated.camera))
    check('text 来自插件设置', typeof evaluated.text === 'string' && evaluated.text.length > 0, evaluated.text)

    // 用动画自己的判定逻辑复算一遍：TELEMETRY = QS.get('telemetry') !== '0' && UH.enabled !== false
    // （inju-particles.html 第 110 行）。这条断言与默认值无关，验证的是「开关真的接通了」。
    const query = new URLSearchParams(snapshot.query)
    const telemetry = query.get('telemetry') !== '0' && (evaluated.hud ? evaluated.hud.enabled !== false : true)
    check('动画自己的 TELEMETRY 判定 = 插件里的极客 HUD 开关',
      telemetry === (snapshot.config.showHud === true),
      'telemetry=' + query.get('telemetry') + ' showHud=' + snapshot.config.showHud
      + ' hud.enabled=' + (evaluated.hud ? evaluated.hud.enabled : 'undefined'))
    check('HUD 台词始终就绪（关掉 HUD 也不丢，随时可以开）',
      Array.isArray(evaluated.hud && evaluated.hud.log) && evaluated.hud.log.length >= 10,
      String(evaluated.hud && evaluated.hud.log && evaluated.hud.log.length))
    check('身份层随配置到达浏览器（铭牌 / 命令行 / 运行时字段 / 进度条产品名）',
      evaluated.hud.brand && evaluated.hud.brand.title === 'DEEPSEEK HARNESS'
      && String(evaluated.hud.shell).includes('dsh --profile')
      && Array.isArray(evaluated.hud.extra) && evaluated.hud.extra.length === 2
      && evaluated.hud.progressLabel === 'DEEPSEEK HARNESS',
      JSON.stringify({ title: evaluated.hud.brand && evaluated.hud.brand.title, label: evaluated.hud.progressLabel }))
    check('终端日志是 DSH 启动序列',
      String(evaluated.hud.log[0][1]).includes('deepseek-harness')
      && String(evaluated.hud.log[17][1]).includes('DeepSeek Harness'),
      String(evaluated.hud.log[0][1]))
  }

  console.log('\n[4] 资源路由与路径穿越防护')
  const image = await get(api + '/asset?name=flower.jpg')
  check('/asset?name=flower.jpg 200 + image/jpeg', image.status === 200 && image.type.includes('image/jpeg'), image.type)
  for (const evil of ['../index.js', '..\\index.js', '../../package.json']) {
    const response = await get(api + '/asset?name=' + encodeURIComponent(evil))
    check('拒绝 ' + JSON.stringify(evil), response.status === 404, 'status ' + response.status)
  }

  console.log('\n[5] 浏览器半身：bundle 解析链')
  // 页面本身（GET /）在 DSH 的浏览器鉴权栅栏后面，命令行取不到（401），
  // 这是预期的，不是插件问题。bundle 的 URL 形如
  //   /plugins/??dsh-inju-boot/client.js&rev=<mtime/ctime/size 的哈希>
  // rev 由宿主在运行时算出来，命令行复现不了，所以这里只验证
  // 「加载器一定找得到这个文件」这条链：manifest → exports → 文件 → bundle id。
  const index = await get(base + '/')
  if (index.status === 401) {
    console.log('  skip GET / 需要浏览器鉴权（401），bundle URL 带运行时 rev，命令行无法构造')
  } else {
    check('GET / 200', index.status === 200, 'status ' + index.status)
    check('index 里出现了 inju-boot 的客户端 bundle 引用', index.body.includes('inju-boot'))
  }

  const manifest = JSON.parse(readFileSync(join(PACKAGE_DIR, 'package.json'), 'utf8'))
  check('manifest 声明了 dsh.client.platform = web', manifest.dsh?.client?.platform === 'web')
  check('manifest 声明了 dsh.client.immediately', manifest.dsh?.client?.immediately === true)
  check('manifest 声明了 dsh.bundle.patch', typeof manifest.dsh?.bundle?.patch === 'string')
  const clientRel = manifest.exports?.['./client']
  check('exports["./client"] 存在', typeof clientRel === 'string', String(clientRel))
  if (typeof clientRel === 'string') {
    const clientAbs = join(PACKAGE_DIR, clientRel)
    check('exports["./client"] 指向真实文件', existsSync(clientAbs), clientAbs)
    const bundleSource = readFileSync(clientAbs, 'utf8')
    check('bundle id = dsh-inju-boot', /__ModuleLoader__/.test(bundleSource) && bundleSource.includes("id: 'dsh-inju-boot'"))
    check('bundle 注册了覆盖层与设置页',
      bundleSource.includes('dsh-inju-boot-overlay') && bundleSource.includes("id: 'inju-boot'"))
  }
  check('包已装进 profile（node_modules 里是软链或副本）',
    existsSync(join(PROFILE_DIR, 'node_modules', 'dsh-inju-boot')), join(PROFILE_DIR, 'node_modules', 'dsh-inju-boot'))
  const profileManifest = JSON.parse(readFileSync(join(PROFILE_DIR, 'package.json'), 'utf8'))
  check('profile 的 dsh.profile.bundles 里有 dsh-inju-boot',
    (profileManifest.dsh?.profile?.bundles ?? []).includes('dsh-inju-boot'))

  console.log('\n[6] 客户端插槽（真正的「它跑起来了」证据）')
  console.log('  覆盖层与设置页的注册状态请用 cordis_inspect_query 确认：')
  console.log('    platform=client provider=Slots method=listSubTree input={"root":"shell.overlay"}')
  console.log('      → occupants 里应有 registrant=dsh-inju-boot / id=dsh-inju-boot-overlay')
  console.log('    platform=client provider=Slots method=listSubTree input={"root":"settings.section"}')
  console.log('      → occupants 里应有 registrant=dsh-inju-boot / id=inju-boot')
  console.log('  bundle 只有在浏览器里真的执行了 apply()，这两个占用者才会出现 —— 这是比抓 HTML 更硬的证据。')
} catch (error) {
  failures++
  console.error('\n在线自检抛异常：', error)
}

console.log('\n' + (failures === 0 ? '全部通过' : failures + ' 项失败') + ' · 共 ' + checks + ' 项断言')
process.exit(failures === 0 ? 0 : 1)
