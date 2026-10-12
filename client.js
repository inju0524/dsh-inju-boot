/**
 * dsh-inju-boot · 浏览器半身
 * -------------------------------------------------------------------------------------
 * 手写的 ModuleLoader bundle（无构建步骤、无外部依赖，只用 shell 已经提供的 react）。
 * 它给 Web 界面加两样东西：
 *
 *   1. `shell.overlay` 里的**启动覆盖层**：页面一加载就自动播一次
 *      `/api/inju-boot/boot.html`（就是本项目目录下那支 INJU 3D 粒子动画），
 *      播到设定位置后淡出，把界面交还给用户。
 *
 *   2. `settings.section` 里的**设置页**：文字 / 粒子数 / 亮度 / 泛光 / 机距 /
 *      时长倍率 / 结束阶段 / 音效 / 跳过方式 / 高级 JSON 覆盖，全部可调，
 *      带「立即预览」。配置由 Host 半身落盘在 <DSH_HOME>/inju-boot/config.json。
 *
 * 为什么覆盖层用 iframe：动画本身就是一支自带全局 CSS（html,body{overflow:hidden}）
 * 与 WebGL2 上下文的独立作品，直接塞进 React 树会污染宿主页面的全局样式。
 * iframe 把它隔离成一个独立的 artwork 文档，宿主主题不受影响；
 * 而设置页是纯 React + 主题令牌，跟宿主其它设置页同构。
 */
window.__ModuleLoader__.load({
  id: 'dsh-inju-boot',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/inju-boot'
    const BOOT_HTML = API + '/boot.html'
    /** 设置页 → 覆盖层 的「立即预览」通道（同一个页面里，用自定义事件最省事）。 */
    const PLAY_EVENT = 'dsh-inju-boot:play'
    const SESSION_KEY = 'dsh-inju-boot:played'
    const OVERLAY_Z = 2147483000
    /** 刚开播这段时间里的按键/点击不算「跳过」，避免启动时的一次点击直接把它掐掉。 */
    const GRACE_MS = 400

    /* ---------------------------------------------------------------- 主题令牌 */
    const T = {
      text: 'var(--dsw-alias-label-primary)',
      dim: 'var(--dsw-alias-label-secondary)',
      line: 'var(--dsw-alias-border-l1)',
      line2: 'var(--dsw-alias-border-l2)',
      base: 'var(--dsw-alias-bg-base)',
      layer1: 'var(--dsw-alias-bg-layer-1)',
      layer2: 'var(--dsw-alias-bg-layer-2)',
      brand: 'var(--dsw-alias-brand-primary)',
      ok: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
      err: 'var(--dsw-alias-state-error-primary)',
    }

    const CSS = [
      '.dsh-inju-boot-page{display:flex;flex-direction:column;gap:16px;color:var(--dsw-alias-label-primary);}',
      '.dsh-inju-boot-lead{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.7;}',
      '.dsh-inju-boot-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);}',
      '.dsh-inju-boot-card>h4{margin:0;padding:10px 14px;border-bottom:1px solid var(--dsw-alias-border-l1);font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--dsw-alias-label-primary);}',
      '.dsh-inju-boot-body{padding:4px 14px;}',
      '.dsh-inju-boot-row{display:flex;align-items:center;gap:14px;padding:9px 0;border-top:1px solid var(--dsw-alias-border-l1);}',
      '.dsh-inju-boot-row:first-child{border-top:0;}',
      '.dsh-inju-boot-row>.k{flex:0 0 172px;min-width:0;}',
      '.dsh-inju-boot-row>.k>b{display:block;font-weight:500;font-size:12.5px;}',
      '.dsh-inju-boot-row>.k>i{display:block;font-style:normal;font-size:11px;color:var(--dsw-alias-label-secondary);margin-top:2px;line-height:1.5;}',
      '.dsh-inju-boot-row>.v{flex:1;min-width:0;display:flex;align-items:center;gap:10px;}',
      '.dsh-inju-boot-input{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);padding:5px 8px;font:inherit;font-size:12px;width:100%;box-sizing:border-box;}',
      '.dsh-inju-boot-input:focus{outline:none;border-color:var(--dsw-alias-brand-primary);}',
      '.dsh-inju-boot-input[readonly]{color:var(--dsw-alias-label-secondary);}',
      '.dsh-inju-boot-num{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:6px;color:var(--dsw-alias-label-primary);padding:4px 6px;font:inherit;font-size:12px;width:76px;box-sizing:border-box;text-align:right;}',
      '.dsh-inju-boot-range{-webkit-appearance:none;appearance:none;height:3px;border-radius:2px;background:var(--dsw-alias-border-l1);flex:1;min-width:80px;margin:0;}',
      '.dsh-inju-boot-range::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-brand-primary);cursor:pointer;}',
      '.dsh-inju-boot-switch{flex:0 0 auto;width:36px;height:20px;border-radius:10px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);position:relative;cursor:pointer;padding:0;}',
      '.dsh-inju-boot-switch>span{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-bg-base);transition:left .15s ease;}',
      '.dsh-inju-boot-switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);}',
      '.dsh-inju-boot-switch[aria-checked="true"]>span{left:18px;}',
      '.dsh-inju-boot-btn{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-radius:6px;padding:5px 12px;font:inherit;font-size:12px;cursor:pointer;}',
      '.dsh-inju-boot-btn:hover{border-color:var(--dsw-alias-brand-primary);}',
      '.dsh-inju-boot-btn[disabled]{opacity:.5;cursor:default;}',
      '.dsh-inju-boot-btn.primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-bg-base);}',
      '.dsh-inju-boot-actions{display:flex;align-items:center;gap:10px;flex-wrap:wrap;}',
      '.dsh-inju-boot-status{font-size:11.5px;color:var(--dsw-alias-label-secondary);}',
      '.dsh-inju-boot-json{width:100%;min-height:132px;resize:vertical;font-family:ui-monospace,Consolas,"SF Mono",Menlo,monospace;font-size:11.5px;line-height:1.6;}',
      '.dsh-inju-boot-tag{font-size:11px;color:var(--dsw-alias-label-secondary);white-space:nowrap;}',
      '.dsh-inju-boot-hint{position:fixed;left:50%;transform:translateX(-50%);bottom:34px;',
      '  padding:8px 18px;border-radius:999px;border:1px solid rgba(200,220,255,.28);',
      '  background:rgba(8,12,18,.52);color:#cfe0f4;text-align:center;',
      '  font:11px/1.5 "JetBrains Mono",Consolas,Menlo,monospace;letter-spacing:.1em;',
      '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}',
      '.dsh-inju-boot-skip{position:fixed;right:26px;bottom:26px;padding:7px 16px;border-radius:999px;',
      '  border:1px solid rgba(200,220,255,.34);background:rgba(8,12,18,.42);color:#dfe9f7;',
      '  font:11px/1.4 "JetBrains Mono",Consolas,Menlo,monospace;letter-spacing:.16em;cursor:pointer;',
      '  -webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}',
      '.dsh-inju-boot-skip:hover{background:rgba(8,12,18,.66);border-color:rgba(220,235,255,.6);}',
      '.dsh-inju-boot-note{position:fixed;left:26px;bottom:30px;color:#8fa2bb;font:11px/1.4 "JetBrains Mono",Consolas,Menlo,monospace;letter-spacing:.12em;}',
    ].join('\n')

    function Style() {
      return h('style', { 'data-dsh-inju-boot': 'style' }, CSS)
    }

    /* ---------------------------------------------------------------- 配置读写 */
    let snapshotCache = null
    let inflight = null

    function fetchSnapshot(force) {
      if (!force && snapshotCache) return Promise.resolve(snapshotCache)
      if (inflight) return inflight
      inflight = fetch(API + '/config', { headers: { accept: 'application/json' } })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data && data.ok) snapshotCache = data
          return snapshotCache
        })
        .catch(() => null)
        .then((value) => {
          inflight = null
          return value
        })
      return inflight
    }

    function postConfig(body) {
      return fetch(API + '/config', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
        .then((response) => response.json())
        .then((data) => {
          if (data && data.ok) snapshotCache = data
          return data
        })
        .catch((error) => ({ ok: false, error: String(error && error.message ? error.message : error) }))
    }

    function bootUrl(snapshot) {
      const query = snapshot && typeof snapshot.query === 'string' && snapshot.query !== ''
        ? snapshot.query
        : 'hud=0&telemetry=0'
      return BOOT_HTML + '?' + query
    }

    /* ---------------------------------------------------------------- 窗口顶栏 */
    /**
     * Windows Electron 的窗口顶栏有两处会压在启动动画上面，这里在播放期间把它们抹掉。
     *
     * **为什么单靠 z-index 不行**：`shell.overlay` 的条目渲染在
     * `.BynINW_overlayLayer{position:absolute;z-index:20}` 里 —— 那是一个**层叠上下文**，
     * 所以我给覆盖层写多大的 z-index 都只在 20 这一层里有效。于是：
     *
     *   1. Desktop preload 注入的「应用 / 编辑」菜单条是 `div[data-windows-menu]`，
     *      `position:fixed; z-index:1100`，挂在 body 上 —— 必然盖住动画。
     *      只能让它先隐藏（播放结束再放出来）。
     *
     *   2. 右上角的最小化 / 最大化 / 关闭是 Chromium 原生的 Window Controls Overlay，
     *      CSS 碰不到按钮本身，但**它的背景色是可变的**：preload 里有一个探针元素，
     *      用 `background-color: var(--dsw-specific-sidebar-fill)` 量出色值，再通过
     *      `windowsAppearance` IPC 调 `setTitleBarOverlay()`。所以把这个变量改成
     *      `transparent`，原生顶栏背景就变成 `rgba(0, 0, 0, 0)`，动画从按钮后面透出来。
     *      DOM 里那 40px 的标题栏条（`.BynINW_frame::before`）用的是同一个变量，一起透明。
     *
     * 这个 `<style>` **必须挂在 `document.head`**：preload 的 MutationObserver 只观察
     * head 的 childList/subtree，挂在别处不会触发它重新量色，原生顶栏就不会变。
     * 代价是它是一次组件之外的 DOM 写入，所以每条退出路径都要 removeChromeBlend()。
     */
    const CHROME_STYLE_ID = 'dsh-inju-boot-chrome'

    /** 按覆盖层底色挑一个看得清的符号色（原生按钮的 glyph 颜色）。 */
    function contrastOn(backdrop) {
      const match = String(backdrop || '').trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
      if (!match) return '#f9fafb'
      const body = match[1].length === 3
        ? match[1].split('').map((c) => c + c).join('')
        : match[1]
      const r = Number.parseInt(body.slice(0, 2), 16)
      const g = Number.parseInt(body.slice(2, 4), 16)
      const b = Number.parseInt(body.slice(4, 6), 16)
      return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.55 ? '#0f1115' : '#f9fafb'
    }

    function removeChromeBlend() {
      try {
        const existing = document.getElementById(CHROME_STYLE_ID)
        if (existing) existing.remove()
      } catch {
        /* 文档正在卸载，无所谓了 */
      }
    }

    function applyChromeBlend(config) {
      removeChromeBlend()
      // 两个布尔都按「缺省即开启」读：宿主半身还是旧版本时，这边的修复依然成立。
      const wantTransparent = config.blendTitlebar !== false
      const wantHideMenu = config.hideTitlebarMenu !== false
      if (!wantTransparent && !wantHideMenu) return
      const rules = []
      if (wantTransparent) {
        // 只作用于 Windows Electron（preload 打的 data-windows-titlebar 标记），
        // macOS 的窗口本来就透明，浏览器里根本没有这些元素。
        rules.push('html[data-windows-titlebar]{'
          + '--dsw-specific-sidebar-fill:transparent !important;'
          + '--dsw-alias-label-primary:' + contrastOn(config.backdrop) + ' !important;}')
      }
      if (wantHideMenu) rules.push('div[data-windows-menu]{display:none !important;}')
      const style = document.createElement('style')
      style.id = CHROME_STYLE_ID
      style.textContent = rules.join('\n')
      document.head.appendChild(style)
    }

    /* ---------------------------------------------------------------- 背景音乐解锁 */
    /**
     * 这个文档能不能**不经手势**就出声？
     *
     * 判据是新建一个 AudioContext 看它是 `running` 还是 `suspended` —— Web Audio 的
     * 自动播放策略就是按这个状态体现的，而且策略是按**顶层文档**判定的，
     * 同源的 iframe 与之共享，所以父页面探到的答案对 iframe 同样成立。
     *
     *   · DSH Desktop（Electron）默认 autoplayPolicy = no-user-gesture-required → running
     *   · 普通浏览器在用户与本域名交互过之前 → suspended
     *
     * 只探一次并缓存：第一次手势之后的答案不再代表「自动播放」这件事。
     */
    let autoplayProbe = null
    function autoplayAllowed() {
      if (autoplayProbe !== null) return autoplayProbe
      try {
        const AC = window.AudioContext || window.webkitAudioContext
        if (!AC) {
          autoplayProbe = false
          return autoplayProbe
        }
        const probe = new AC()
        autoplayProbe = probe.state === 'running'
        try { probe.close() } catch { /* 关不掉也无所谓，它不带任何声音 */ }
      } catch {
        autoplayProbe = false
      }
      return autoplayProbe
    }

    /**
     * 替动画调用它自己的 `INJU_AUDIO.unlock()`。
     *
     * 这一步是「自动播放」的关键：动画的音频引擎只在 unlock() 里才 `new AudioContext()`
     * （inju-audio.js 的 init() 只从 unlock() 调用），光有宽松的自动播放策略它也不会自己开始。
     * 同源 iframe 可以直接拿到它的 window，所以父页面主动推它一把。
     *
     * @returns true 表示已经推到（音频引擎存在且 unlock 被调用）。
     */
    function unlockFrameAudio(frame) {
      try {
        const win = frame && frame.contentWindow
        const engine = win && win.INJU_AUDIO
        if (engine && typeof engine.unlock === 'function') {
          engine.unlock()
          return true
        }
      } catch {
        /* 还没加载好 / 拿不到，等下一次手势再试 */
      }
      return false
    }

    /* ---------------------------------------------------------------- 会话去重 */
    function alreadyPlayed() {
      try {
        return window.sessionStorage.getItem(SESSION_KEY) === '1'
      } catch {
        return false
      }
    }

    function markPlayed() {
      try {
        window.sessionStorage.setItem(SESSION_KEY, '1')
      } catch {
        /* 隐私模式下没有 sessionStorage，那就每次都播 */
      }
    }

    /** 「结束阶段」换算成进度阈值：0 = 整段播完，N = 播到第 N 个阶段末尾。 */
    function endProgressOf(config, resolved) {
      const stages = resolved && Array.isArray(resolved.stages) ? resolved.stages : []
      const total = stages.reduce((sum, stage) => sum + (Number(stage.dur) || 0), 0)
      const endStage = Number(config.endStage) || 0
      if (!(total > 0) || endStage < 1 || endStage > stages.length) return 1
      let acc = 0
      for (let i = 0; i < endStage; i++) acc += Number(stages[i].dur) || 0
      return Math.min(1, acc / total)
    }

    /* ---------------------------------------------------------------- 启动覆盖层 */
    function BootOverlay() {
      const [phase, setPhase] = React.useState('idle')      // idle | playing | fading | done
      const [snapshot, setSnapshot] = React.useState(null)
      const [src, setSrc] = React.useState('')
      const [hint, setHint] = React.useState(false)
      const frameRef = React.useRef(null)
      const cfgRef = React.useRef(null)
      const resolvedRef = React.useRef(null)
      const finishedRef = React.useRef(true)
      const startedAtRef = React.useRef(0)
      const lastProgressRef = React.useRef(-1)
      const watchRef = React.useRef(0)
      const guardRef = React.useRef(0)
      const fadeRef = React.useRef(0)
      /** 「首次手势只解锁声音」那一次额度是否已经用掉。 */
      const gestureUsedRef = React.useRef(false)

      const stopTimers = React.useCallback(() => {
        if (watchRef.current) { window.clearInterval(watchRef.current); watchRef.current = 0 }
        if (guardRef.current) { window.clearTimeout(guardRef.current); guardRef.current = 0 }
        if (fadeRef.current) { window.clearTimeout(fadeRef.current); fadeRef.current = 0 }
      }, [])

      const finish = React.useCallback((reason) => {
        if (finishedRef.current) return
        finishedRef.current = true
        stopTimers()
        // 立刻把顶栏还原（而不是等淡出结束）：淡出期间界面已经露出来了，颜色必须是应用自己的。
        removeChromeBlend()
        const config = cfgRef.current || {}
        const fadeOutMs = Number(config.fadeOutMs) || 0
        setPhase(fadeOutMs > 0 ? 'fading' : 'done')
        if (fadeOutMs > 0) fadeRef.current = window.setTimeout(() => setPhase('done'), fadeOutMs + 40)
        if (window.console && typeof window.console.debug === 'function') {
          console.debug('[dsh-inju-boot] overlay finished (' + reason + ')')
        }
      }, [stopTimers])

      const begin = React.useCallback((snap) => {
        const config = snap && snap.config ? snap.config : null
        if (!config || config.enabled !== true) return
        if (config.oncePerSession && alreadyPlayed()) return
        if (config.oncePerSession) markPlayed()

        cfgRef.current = config
        resolvedRef.current = snap.resolved || null
        finishedRef.current = false
        lastProgressRef.current = -1
        startedAtRef.current = Date.now()
        gestureUsedRef.current = false
        // 先处理顶栏，再让覆盖层出现 —— 否则会先闪一下那条不透明的标题栏。
        applyChromeBlend(config)
        setSnapshot(snap)
        setSrc(bootUrl(snap))
        setPhase('playing')
        // 只有「自动播放确实被拦下」时才提示点击；Electron 里通常探到 running，不会出现提示。
        // 两个布尔都按「缺省即开启」读：宿主半身若还是旧版本（配置里没有这几个键），
        // 客户端这边的音频修复依然成立，重启后由宿主下发的显式值接管。
        setHint(config.audio !== false && config.audioHint !== false && !autoplayAllowed())

        const endProgress = endProgressOf(config, snap.resolved)
        const maxDurationMs = Number(config.maxDurationMs) || 90000

        // 兜底：无论如何不要让覆盖层永久挡住界面。
        guardRef.current = window.setTimeout(() => finish('timeout'), maxDurationMs)

        // 读动画自己的进度条（它是动画公开的播放头：value = T/TOTAL*1000）。
        // `#scrub` 在动画的静态 HTML 里就有，所以「读不到元素」只可能是文档没起来；
        // 「读得到但一直是 0」只可能是动画卡住（例如没有 WebGL2）。两种情况都要收场，
        // 不能让覆盖层干等到底。
        watchRef.current = window.setInterval(() => {
          const frame = frameRef.current
          const elapsed = Date.now() - startedAtRef.current
          let progress = null
          try {
            const doc = frame && frame.contentDocument
            const scrub = doc && doc.getElementById('scrub')
            if (scrub) {
              const raw = Number.parseFloat(scrub.value)
              if (Number.isFinite(raw)) progress = raw / 1000
            }
          } catch {
            progress = null
          }
          if (progress === null) {
            if (elapsed > 8000) finish('no-document')
            return
          }
          if (progress < 0.001 && elapsed > 20000) { finish('stalled'); return }
          if (progress >= endProgress - 0.004) { finish('timeline'); return }
          const last = lastProgressRef.current
          if (last >= 0 && progress < last - 0.35) { finish('loop'); return }
          lastProgressRef.current = progress
        }, 200)

        if (window.console && typeof window.console.debug === 'function') {
          console.debug('[dsh-inju-boot] overlay started, endProgress=' + endProgress.toFixed(3)
            + ' maxDuration=' + maxDurationMs + 'ms')
        }
      }, [finish])

      // 自动播放（每次页面加载 = 每次启动 Harness），以及设置页的「立即预览」。
      React.useEffect(() => {
        let alive = true
        const onPlay = (event) => {
          const detail = event && event.detail
          if (detail && detail.config) begin(detail)
          else fetchSnapshot(true).then((snap) => { if (alive && snap) begin(snap) })
        }
        window.addEventListener(PLAY_EVENT, onPlay)
        fetchSnapshot().then((snap) => {
          if (!alive || !snap) return
          begin(snap)
        })
        return () => {
          alive = false
          window.removeEventListener(PLAY_EVENT, onPlay)
          stopTimers()
          // 组件被卸载（例如插件停用/热重载）时也要把顶栏还原，不能留下一个透明的标题栏。
          removeChromeBlend()
        }
      }, [begin, stopTimers])

      /**
       * 一次用户手势（点击或按键）的统一入口。
       *
       * 这是「点了才有声音，但一点就把动画点没了」的解：当 firstGestureUnlocksAudioOnly
       * 打开时，**第一次**手势被吃掉 —— 只用来把动画的音频引擎解锁，动画继续播；
       * 从第二次手势起才按 skipOnClick / skipOnAnyKey 走。
       */
      const onGesture = React.useCallback((kind) => {
        const config = cfgRef.current || {}
        // 每次手势都顺手再推一次解锁（幂等），这样哪怕引擎晚一点才就绪也能接上。
        unlockFrameAudio(frameRef.current)
        setHint(false)
        if (finishedRef.current) return
        if (Date.now() - startedAtRef.current < GRACE_MS) return
        if (config.audio !== false && config.firstGestureUnlocksAudioOnly !== false && !gestureUsedRef.current) {
          gestureUsedRef.current = true
          if (window.console && typeof window.console.debug === 'function') {
            console.debug('[dsh-inju-boot] first gesture consumed for audio unlock (' + kind + ')')
          }
          return
        }
        if (kind === 'key' && config.skipOnAnyKey !== true) return
        if (kind === 'pointer' && config.skipOnClick !== true) return
        finish(kind)
      }, [finish])

      // 按键：Esc 永远能跳过；其余按上面的手势规则走。
      React.useEffect(() => {
        if (phase !== 'playing') return undefined
        const onKey = (event) => {
          if (event.key === 'Escape') {
            setHint(false)
            finish('escape')
            return
          }
          onGesture('key')
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [phase, finish, onGesture])

      // 覆盖层盖住整页时点击落在 iframe 里，所以除了父窗口还要监听它自己的文档。
      React.useEffect(() => {
        if (phase !== 'playing') return undefined
        const onPointer = () => onGesture('pointer')
        window.addEventListener('pointerdown', onPointer, true)
        return () => window.removeEventListener('pointerdown', onPointer, true)
      }, [phase, onGesture])

      const onFrameLoad = React.useCallback(() => {
        // ① 文档一就绪就**主动替动画解锁音频** —— Electron（DSH Desktop 默认
        //    autoplayPolicy = no-user-gesture-required）下这一步之后音乐就直接响了，
        //    不需要任何点击。动画自己的 unlock 只在首次手势里被调用，所以必须由我们推。
        if (unlockFrameAudio(frameRef.current)) {
          if (window.console && typeof window.console.debug === 'function') {
            console.debug('[dsh-inju-boot] pushed INJU_AUDIO.unlock() on frame load, autoplayAllowed=' + autoplayAllowed())
          }
        }
        // ② 再挂一次手势监听，覆盖 iframe 内部的点击。
        try {
          const doc = frameRef.current && frameRef.current.contentDocument
          if (doc) doc.addEventListener('pointerdown', () => onGesture('pointer'))
        } catch {
          /* 跨源就拿不到，父窗口那层监听仍然有效 */
        }
      }, [onGesture])

      if (phase === 'idle' || phase === 'done') return null
      const config = (snapshot && snapshot.config) || {}
      const fading = phase === 'fading'

      return h(
        'div',
        {
          'data-dsh-inju-boot': 'overlay',
          style: {
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: OVERLAY_Z,
            background: config.backdrop || '#04060a',
            opacity: fading ? 0 : 1,
            transition: 'opacity ' + (Number(config.fadeOutMs) || 0) + 'ms ease',
            pointerEvents: fading ? 'none' : 'auto',
          },
        },
        h('iframe', {
          ref: frameRef,
          src,
          onLoad: onFrameLoad,
          title: 'INJU boot animation',
          allow: 'autoplay',
          style: { display: 'block', width: '100%', height: '100%', border: '0', background: '#04060a' },
        }),
        hint && !fading
          ? h('div', { className: 'dsh-inju-boot-hint' },
            '♪ 浏览器拦下了自动播放 · 点一下画面开启声音（这次点击不会中断动画）')
          : null,
        config.showSkipButton
          ? h('button', {
            type: 'button',
            className: 'dsh-inju-boot-skip',
            onClick: () => { setHint(false); finish('button') },
          }, config.skipLabel || '跳过 SKIP')
          : null,
      )
    }

    /* ---------------------------------------------------------------- 设置页控件 */
    function Row(props) {
      return h(
        'div',
        { className: 'dsh-inju-boot-row' },
        h('div', { className: 'k' },
          h('b', null, props.label),
          props.hint ? h('i', null, props.hint) : null),
        h('div', { className: 'v' }, props.children),
      )
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        className: 'dsh-inju-boot-switch',
        role: 'switch',
        'aria-checked': props.value ? 'true' : 'false',
        'aria-label': props.label,
        onClick: () => props.onChange(!props.value),
      }, h('span', null))
    }

    /**
     * 数字框保留一份输入中的文本，否则「清空再输」会被受控值立刻弹回去。
     * 只有当输入能解析成有限数时才写进草稿。
     */
    function NumberField(props) {
      const [text, setText] = React.useState(String(props.value))
      React.useEffect(() => { setText(String(props.value)) }, [props.value])
      return h('input', {
        type: 'number',
        className: 'dsh-inju-boot-num',
        value: text,
        min: props.min,
        max: props.max,
        step: props.step,
        onChange: (event) => {
          const next = event.target.value
          setText(next)
          const parsed = Number.parseFloat(next)
          if (Number.isFinite(parsed)) props.onChange(parsed)
        },
        onBlur: () => {
          const parsed = Number.parseFloat(text)
          if (!Number.isFinite(parsed)) setText(String(props.value))
        },
      })
    }

    function Slider(props) {
      return h('input', {
        type: 'range',
        className: 'dsh-inju-boot-range',
        value: props.value,
        min: props.min,
        max: props.max,
        step: props.step,
        onChange: (event) => props.onChange(event.target.value),
      })
    }

    /* ---------------------------------------------------------------- HUD 台词 */
    /** `hud.log` 的 [[秒, 文本], …] → 一行一条的纯文本。 */
    function formatHudLog(log) {
      if (!Array.isArray(log)) return ''
      return log
        .map((entry) => (Array.isArray(entry) && entry.length >= 2 ? String(entry[0]) + '  ' + String(entry[1]) : ''))
        .filter((line) => line !== '')
        .join('\n')
    }

    /** 一行一条：`秒  文本`。返回 { lines, error }。 */
    function parseHudLog(text) {
      const lines = []
      const rows = String(text).split(/\r?\n/)
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i].trim()
        if (row === '') continue
        const match = row.match(/^([0-9]+(?:\.[0-9]+)?)\s+(.+)$/)
        if (!match) {
          return {
            lines: [],
            error: '第 ' + (i + 1) + ' 行看不懂：需要「秒 文本」，例如 `0.05 [boot] particle_recon v3.1`',
          }
        }
        lines.push([Number.parseFloat(match[1]), match[2].trim()])
      }
      return { lines, error: '' }
    }

    /** 各阶段起点，用来提示台词该对齐到第几秒。 */
    function stageStarts(stages) {
      const out = []
      let acc = 0
      for (const stage of stages) {
        out.push({ label: stage.label, at: acc })
        acc += Number(stage.dur) || 0
      }
      return out
    }

    /* ---------------------------------------------------------------- 设置页 */
    function SettingsPage() {
      const [snapshot, setSnapshot] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [advancedText, setAdvancedText] = React.useState('{}')
      const [advancedError, setAdvancedError] = React.useState('')
      const [hudLogText, setHudLogText] = React.useState('')
      const [hudLogDirty, setHudLogDirty] = React.useState(false)
      const [hudLogError, setHudLogError] = React.useState('')
      const [status, setStatus] = React.useState('')
      const [busy, setBusy] = React.useState(false)

      const adopt = React.useCallback((snap) => {
        if (!snap) return
        setSnapshot(snap)
        setDraft(snap.config)
        setAdvancedText(JSON.stringify((snap.config && snap.config.advanced) || {}, null, 2))
        setAdvancedError('')
        // 台词框显示的是**合成后**的真实值（动画目录的 inju.config.js ← 插件覆盖），
        // 所以它跟画面里看到的 HUD 完全一致。没改过就不会被写进插件覆盖。
        const animation = (snap.resolved && snap.resolved.animationConfig) || {}
        setHudLogText(formatHudLog(animation.hud && animation.hud.log))
        setHudLogDirty(false)
        setHudLogError('')
      }, [])

      React.useEffect(() => {
        let alive = true
        fetchSnapshot(true).then((snap) => {
          if (!alive) return
          if (snap) adopt(snap)
          else setStatus('无法连接插件后端（/api/inju-boot/config）')
        })
        return () => { alive = false }
      }, [adopt])

      const set = React.useCallback((key, value) => {
        setDraft((previous) => (previous ? { ...previous, [key]: value } : previous))
      }, [])

      const setNumber = React.useCallback((key, value, fallback) => {
        const parsed = Number.parseFloat(value)
        set(key, Number.isFinite(parsed) ? parsed : fallback)
      }, [set])

      /** @param override - 可选的草稿覆盖（「开启并预览」用它一次提交一个改动后的草稿）。 */
      const save = React.useCallback(async (override) => {
        const base = override && typeof override === 'object' && !Array.isArray(override) ? override : draft
        if (!base) return null
        let advanced = {}
        const text = advancedText.trim()
        if (text !== '') {
          try {
            const parsed = JSON.parse(text)
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
              setAdvancedError('高级覆盖必须是一个 JSON 对象')
              return null
            }
            advanced = parsed
          } catch (error) {
            setAdvancedError('JSON 解析失败：' + (error && error.message ? error.message : String(error)))
            return null
          }
        }
        setAdvancedError('')

        // 台词框只在**被改过**时才写回：这样用户没动它，动画目录那份 inju.config.js
        // 的台词就仍然是最新的（不会被插件覆盖冻结住）。
        if (hudLogDirty) {
          const parsedLog = parseHudLog(hudLogText)
          if (parsedLog.error) {
            setHudLogError(parsedLog.error)
            return null
          }
          setHudLogError('')
          const hud = advanced.hud && typeof advanced.hud === 'object' && !Array.isArray(advanced.hud)
            ? { ...advanced.hud }
            : {}
          hud.log = parsedLog.lines
          advanced = { ...advanced, hud }
        }

        setBusy(true)
        const result = await postConfig({ replace: true, config: { ...base, advanced } })
        setBusy(false)
        if (result && result.ok) {
          adopt(result)
          // 宿主半身是旧版本时会把这些新键丢掉 —— 直说，别让用户以为设置没生效。
          setStatus(result.config && result.config.audioVolume === undefined
            ? '已保存 · 宿主半身是旧版本：重启 Harness 后「音量 / 首次点击只解锁声音 / 声音提示」才会生效'
            : '已保存 · ' + new Date().toLocaleTimeString())
          return result
        }
        setStatus('保存失败：' + ((result && result.error) || '未知错误'))
        return null
      }, [draft, advancedText, adopt, hudLogDirty, hudLogText])

      const reset = React.useCallback(async () => {
        setBusy(true)
        const result = await postConfig({ reset: true })
        setBusy(false)
        if (result && result.ok) {
          adopt(result)
          setStatus('已恢复出厂默认')
        } else {
          setStatus('恢复失败：' + ((result && result.error) || '未知错误'))
        }
      }, [adopt])

      const preview = React.useCallback(async (override) => {
        const result = await save(override)
        if (!result) return null
        setStatus('正在预览…')
        window.dispatchEvent(new CustomEvent(PLAY_EVENT, { detail: result }))
        return result
      }, [save])

      /** 极客 HUD 是可选项：一键开启并立刻看效果，省掉「先保存再预览」两步。 */
      const enableHudAndPreview = React.useCallback(async () => {
        if (!draft) return
        const next = { ...draft, showHud: true }
        setDraft(next)
        const result = await preview(next)
        if (result) setStatus('已开启极客 HUD 并预览 · 不喜欢可以直接关掉')
      }, [draft, preview])

      if (!draft) {
        return h('div', { className: 'dsh-inju-boot-page' },
          h(Style, null),
          h('div', { className: 'dsh-inju-boot-lead' }, status || '正在读取配置…'))
      }

      const resolved = snapshot && snapshot.resolved ? snapshot.resolved : {}
      const stages = Array.isArray(resolved.stages) ? resolved.stages : []
      const total = Number(resolved.total) || 0
      const starts = stageStarts(stages)
      const logHint = starts.length > 0
        ? '一行一条：`秒 文本`。建议对齐阶段起点 —— ' + starts.map((stage) => stage.label.split(' ')[0] + ' ' + stage.at.toFixed(2) + 's').join(' / ')
        : '一行一条：`秒 文本`'

      return h(
        'div',
        { className: 'dsh-inju-boot-page' },
        h(Style, null),
        h('div', { className: 'dsh-inju-boot-lead' },
          '每次启动 DeepSeek Harness 时，全屏播放本项目目录下那支 INJU 3D 粒子动画'
          + '（WebGL2 · 花 → 月球 → 虚影文字 → 实体 LOGO），播完自动淡出。'
          + '所有参数都可以在这里改，保存后立刻生效，下次启动沿用。'
          + '极客 HUD / 终端层是可选项，默认开启。'),

        h('div', { className: 'dsh-inju-boot-card' },
          h('h4', null, '播放'),
          h('div', { className: 'dsh-inju-boot-body' },
            h(Row, { label: '启用启动动画', hint: '关闭后启动不再播放，设置仍保留' },
              h(Switch, { label: '启用启动动画', value: draft.enabled, onChange: (v) => set('enabled', v) })),
            h(Row, { label: '每次启动只播一次', hint: '按浏览器会话去重，避免开发时热重载反复重播' },
              h(Switch, { label: '每次启动只播一次', value: draft.oncePerSession, onChange: (v) => set('oncePerSession', v) })),
            h(Row, {
              label: '背景音乐 / 音效',
              hint: '动画自带的 Web Audio 合成音（Apple 发布会式，零音频文件）。'
                + '关掉时连引擎都不加载。桌面端会自动播放：覆盖层在动画就绪后主动替它解锁音频',
            },
              h(Switch, { label: '背景音乐', value: draft.audio, onChange: (v) => set('audio', v) })),
            h(Row, { label: '背景音乐音量', hint: '覆盖动画配置文件里的 audio.master' },
              h(Slider, {
                value: draft.audioVolume, min: 0, max: 1, step: 0.01,
                onChange: (v) => setNumber('audioVolume', v, 0.62),
              }),
              h(NumberField, {
                value: draft.audioVolume, min: 0, max: 1, step: 0.01,
                onChange: (v) => setNumber('audioVolume', v, 0.62),
              })),
            h(Row, {
              label: '首次点击只解锁声音',
              hint: '推荐开启。动画的音频引擎只在首次手势里才创建 AudioContext，'
                + '开启后第一次点击/按键被吃掉（只用来出声），动画继续播；关掉则第一次手势就按下面的跳过规则处理',
            },
              h(Switch, {
                label: '首次点击只解锁声音',
                value: draft.firstGestureUnlocksAudioOnly,
                onChange: (v) => set('firstGestureUnlocksAudioOnly', v),
              })),
            h(Row, {
              label: '自动播放被拦下时提示',
              hint: '仅在浏览器确实拦下了自动播放时才出现（桌面端通常不会）',
            },
              h(Switch, { label: '声音提示', value: draft.audioHint, onChange: (v) => set('audioHint', v) })),
            h(Row, { label: '时长倍率', hint: '等比拉伸整条时间轴：>1 更慢、<1 更快' },
              h(Slider, {
                value: draft.durationScale, min: 0.2, max: 3, step: 0.05,
                onChange: (v) => setNumber('durationScale', v, 1),
              }),
              h(NumberField, {
                value: draft.durationScale, min: 0.2, max: 3, step: 0.05,
                onChange: (v) => setNumber('durationScale', v, 1),
              }),
              h('span', { className: 'dsh-inju-boot-tag' }, '×')),
            h(Row, { label: '结束阶段', hint: '播到第几个阶段末尾就淡出；总时长 ' + total.toFixed(2) + 's' },
              h('select', {
                className: 'dsh-inju-boot-input',
                value: String(draft.endStage),
                onChange: (event) => set('endStage', Number.parseInt(event.target.value, 10) || 0),
              },
                h('option', { value: '0' }, '播完整个循环（' + total.toFixed(2) + 's）'),
                stages.map((stage, index) => h('option', { key: index, value: String(index + 1) },
                  '到 ' + stage.label + ' 结束（' + stage.dur.toFixed(2) + 's）')))),
            h(Row, { label: '淡出时长', hint: '结束时的淡出毫秒数' },
              h(NumberField, {
                value: draft.fadeOutMs, min: 0, max: 10000, step: 50,
                onChange: (v) => setNumber('fadeOutMs', v, 900),
              }),
              h('span', { className: 'dsh-inju-boot-tag' }, 'ms')))),

        h('div', { className: 'dsh-inju-boot-card' },
          h('h4', null, '跳过'),
          h('div', { className: 'dsh-inju-boot-body' },
            h(Row, {
              label: '点击中断动画',
              hint: '在画面上点一下就结束动画。若上面「首次点击只解锁声音」是开的，'
                + '那第一次点击只用来出声、不会中断，从第二次起才生效',
            },
              h(Switch, { label: '点击中断动画', value: draft.skipOnClick, onChange: (v) => set('skipOnClick', v) })),
            h(Row, { label: '按键中断动画', hint: '按任意键结束动画（Esc 始终可跳过）' },
              h(Switch, { label: '按键中断动画', value: draft.skipOnAnyKey, onChange: (v) => set('skipOnAnyKey', v) })),
            h(Row, { label: '显示跳过按钮' },
              h(Switch, { label: '显示跳过按钮', value: draft.showSkipButton, onChange: (v) => set('showSkipButton', v) })),
            h(Row, { label: '按钮文字' },
              h('input', {
                className: 'dsh-inju-boot-input',
                value: draft.skipLabel,
                maxLength: 32,
                onChange: (event) => set('skipLabel', event.target.value),
              })))),

        h('div', { className: 'dsh-inju-boot-card' },
          h('h4', null, '画面'),
          h('div', { className: 'dsh-inju-boot-body' },
            h(Row, { label: 'LOGO / 虚影文字', hint: '虚影文字与最终实体 LOGO 都用它' },
              h('input', {
                className: 'dsh-inju-boot-input',
                value: draft.text,
                maxLength: 48,
                onChange: (event) => set('text', event.target.value),
              })),
            h(Row, { label: '粒子数量', hint: '1000 ~ 400000；越大越密实，也越吃显卡' },
              h(Slider, {
                value: draft.count, min: 10000, max: 400000, step: 5000,
                onChange: (v) => setNumber('count', v, 60000),
              }),
              h(NumberField, {
                value: draft.count, min: 1000, max: 400000, step: 5000,
                onChange: (v) => setNumber('count', v, 60000),
              })),
            h(Row, { label: '粒子尺寸' },
              h(Slider, {
                value: draft.size, min: 0.3, max: 3, step: 0.05,
                onChange: (v) => setNumber('size', v, 1),
              }),
              h(NumberField, {
                value: draft.size, min: 0.3, max: 3, step: 0.05,
                onChange: (v) => setNumber('size', v, 1),
              })),
            h(Row, { label: '粒子亮度' },
              h(Slider, {
                value: draft.intensity, min: 0.25, max: 3.5, step: 0.05,
                onChange: (v) => setNumber('intensity', v, 1),
              }),
              h(NumberField, {
                value: draft.intensity, min: 0.25, max: 3.5, step: 0.05,
                onChange: (v) => setNumber('intensity', v, 1),
              })),
            h(Row, { label: '泛光强度', hint: '0 = 关（看结构用）' },
              h(Slider, {
                value: draft.bloom, min: 0, max: 2, step: 0.05,
                onChange: (v) => setNumber('bloom', v, 1),
              }),
              h(NumberField, {
                value: draft.bloom, min: 0, max: 2, step: 0.05,
                onChange: (v) => setNumber('bloom', v, 1),
              })),
            h(Row, { label: '机距', hint: '越大画面整体越小、留白越多' },
              h(Slider, {
                value: draft.dist, min: 8, max: 40, step: 0.2,
                onChange: (v) => setNumber('dist', v, 17.8),
              }),
              h(NumberField, {
                value: draft.dist, min: 4, max: 80, step: 0.2,
                onChange: (v) => setNumber('dist', v, 17.8),
              })),
            h(Row, {
              label: '极客 HUD / 终端层',
              hint: '可选，默认开启。叠加：DeepSeek Harness 铭牌与启动命令行 + 数字雨 + 跟随主体的目标框（含锁定动画）'
                + ' + 扫描线（扫过的粒子会被真实照亮）+ 实时点云小图 + 终端日志 + 遥测 + hex dump。'
                + '它画在画布内、参与泛光与像素偏移闪切，是画面的一部分；'
                + '不影响动画主体（花 → 月球 → 文字 → LOGO）。关掉就是纯净全屏',
            },
              h(Switch, { label: '极客 HUD', value: draft.showHud, onChange: (v) => set('showHud', v) }),
              draft.showHud
                ? h('span', { className: 'dsh-inju-boot-tag', style: { color: T.ok } }, '已开启')
                : h('button', {
                  type: 'button',
                  className: 'dsh-inju-boot-btn',
                  disabled: busy,
                  onClick: enableHudAndPreview,
                }, '开启并预览')),
            h(Row, { label: '模式', hint: 'flower3d = 参数化 3D 雏菊；photo = 照片粒子化' },
              h('select', {
                className: 'dsh-inju-boot-input',
                value: draft.mode,
                onChange: (event) => set('mode', event.target.value),
              },
                h('option', { value: 'flower3d' }, 'flower3d · 程序化 3D 花（默认）'),
                h('option', { value: 'photo' }, 'photo · 照片粒子化'))),
            h(Row, { label: '覆盖层底色' },
              h('input', {
                className: 'dsh-inju-boot-input',
                value: draft.backdrop,
                maxLength: 64,
                onChange: (event) => set('backdrop', event.target.value),
              })))),

        h('div', { className: 'dsh-inju-boot-card' },
          h('h4', null, '高级'),
          h('div', { className: 'dsh-inju-boot-body' },
            h(Row, {
              label: '动画目录',
              hint: '留空 = 自动（插件上一级目录 → 插件自带 assets）',
            },
              h('input', {
                className: 'dsh-inju-boot-input',
                value: draft.animationDir,
                placeholder: '留空自动探测',
                onChange: (event) => set('animationDir', event.target.value),
              })),
            h(Row, { label: '当前生效', hint: resolved.configFile ? '配置文件：' + resolved.configFile : '' },
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 } },
                h('span', {
                  className: 'dsh-inju-boot-tag',
                  style: { color: resolved.animationFound ? T.ok : T.err, overflowWrap: 'anywhere' },
                }, (resolved.animationFound ? '✓ ' : '✗ ') + (resolved.animationDir || '(未找到)')
                  + '  ·  来源 ' + (resolved.animationSource || '?')),
                h('span', { className: 'dsh-inju-boot-tag' },
                  stages.length + ' 个阶段 · 总时长 ' + total.toFixed(2) + 's'))),
            h(Row, {
              label: '顶栏融入动画',
              hint: '仅 Windows 桌面端。右上角的最小化 / 最大化 / 关闭是系统原生按钮，'
                + '它们背后那条标题栏背景色来自主题变量；开启后动画期间把它改成透明，'
                + '三个按钮就浮在动画上，而不是压着一条色带',
            },
              h(Switch, {
                label: '顶栏融入动画',
                value: draft.blendTitlebar !== false,
                onChange: (v) => set('blendTitlebar', v),
              })),
            h(Row, {
              label: '隐藏「应用 / 编辑」菜单',
              hint: '仅 Windows 桌面端。这条菜单是 Desktop 注入的 DOM，挂在 body 上、'
                + 'z-index 1100，而启动覆盖层所在的浮动层只有 z-index 20 —— 它必然压在动画上面，'
                + '所以动画期间先把它隐藏，播完自动恢复',
            },
              h(Switch, {
                label: '隐藏「应用 / 编辑」菜单',
                value: draft.hideTitlebarMenu !== false,
                onChange: (v) => set('hideTitlebarMenu', v),
              })),
            h(Row, {
              label: 'HUD 终端台词',
              hint: (draft.showHud ? '' : '（极客 HUD 关闭时这层不会显示；先打开上面的开关）')
                + logHint,
            },
              h('div', { style: { width: '100%' } },
                h('textarea', {
                  className: 'dsh-inju-boot-input dsh-inju-boot-json',
                  spellCheck: false,
                  value: hudLogText,
                  onChange: (event) => {
                    setHudLogText(event.target.value)
                    setHudLogDirty(true)
                  },
                }),
                hudLogError
                  ? h('div', { className: 'dsh-inju-boot-status', style: { color: T.err } }, hudLogError)
                  : h('div', { className: 'dsh-inju-boot-status' },
                    '这就是画面里终端窗口逐行打出来的那些行（默认是 DeepSeek Harness 的启动序列）。'
                    + '文本里的 {text} 会被换成真正的 LOGO 文字。清空 = HUD 不再显示日志；'
                    + '改过之后保存才会写进插件覆盖，没改就跟着动画目录那份 inju.config.js 走'))),
            h(Row, {
              label: 'inju.config.js 覆盖',
              hint: 'JSON 深度合并到动画目录的 inju.config.js 之上：相机、花瓣分层、月球、泛光阈值、HUD 开关……键名与配置文件完全一致（hud.log 请用上面的台词编辑器）',
            },
              h('div', { style: { width: '100%' } },
                h('textarea', {
                  className: 'dsh-inju-boot-input dsh-inju-boot-json',
                  spellCheck: false,
                  value: advancedText,
                  onChange: (event) => setAdvancedText(event.target.value),
                }),
                advancedError
                  ? h('div', { className: 'dsh-inju-boot-status', style: { color: T.err } }, advancedError)
                  : h('div', { className: 'dsh-inju-boot-status' },
                    '例：{"camera":{"orbitYaw":0.6},"moon":{"radius":2.6},"hud":{"brand":{"title":"MY HARNESS"}}}'))))),

        h('div', { className: 'dsh-inju-boot-actions' },
          h('button', {
            type: 'button',
            className: 'dsh-inju-boot-btn primary',
            disabled: busy,
            onClick: () => { save() },
          }, '保存'),
          h('button', {
            type: 'button',
            className: 'dsh-inju-boot-btn',
            disabled: busy,
            onClick: () => { preview() },
          }, '保存并立即预览'),
          h('button', {
            type: 'button',
            className: 'dsh-inju-boot-btn',
            disabled: busy,
            onClick: reset,
          }, '恢复出厂默认'),
          h('span', { className: 'dsh-inju-boot-status' }, status)),
      )
    }

    /* ---------------------------------------------------------------- 注册 */
    const inject = ['slots']

    function apply(ctx) {
      // 启动覆盖层：frame-wide 浮动层，页面一加载就播。
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-inju-boot-overlay',
        order: 100,
        label: () => 'INJU 启动动画',
      }, BootOverlay))

      // 设置页：和宿主其它设置页并排的一个入口。
      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'inju-boot',
        order: 55,
        label: () => 'INJU 启动动画',
      }, SettingsPage))
    }

    return {
      name: 'dsh-inju-boot',
      inject,
      apply,
    }
  },
})
