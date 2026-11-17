import { app, BrowserWindow, dialog, ipcMain, net, protocol, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataDirectory } from '../shared/portable-path'
import { resolveWindowBounds } from '../shared/window-state'
import type { AppDatabase } from './database'
import type { AppLogger } from './logger'
import type { AppRepository } from './repository'
import type { BackupService } from './backup-service'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
const startupStarted = performance.now()
let splashWindow: BrowserWindow | null = null
let mainCanPaint = false
let rendererReady = false
let startupComplete = false
let splashShownMs = 0
let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let repository: AppRepository | null = null
let backupService: BackupService | null = null
let logger: AppLogger | null = null
let windowStateTimer: NodeJS.Timeout | undefined

// note images live outside the asar and are served through this scheme
protocol.registerSchemesAsPrivileged([
  { scheme: 'coc-media', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function getDataDirectory(): string {
  return resolveDataDirectory({
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    executablePath: process.execPath,
    developmentRoot: app.isPackaged ? undefined : process.cwd()
  })
}

async function initializeServices(): Promise<void> {
  const [
    { AppDatabase },
    { registerIpc },
    { AppLogger },
    { AppRepository },
    { SeaLogService },
    { FileService },
    { TableExportService },
    { CharacterFileService },
    { BackupService },
    { NoteFileService }
  ] = await Promise.all([
    import('./database'),
    import('./ipc'),
    import('./logger'),
    import('./repository'),
    import('./sea-log-service'),
    import('./file-service'),
    import('./table-export-service'),
    import('./character-file-service'),
    import('./backup-service'),
    import('./note-file-service')
  ])
  const dataDirectory = getDataDirectory()
  fs.mkdirSync(dataDirectory, { recursive: true })
  logger = new AppLogger(path.join(dataDirectory, 'logs'))
  database = new AppDatabase(path.join(dataDirectory, 'coc.sqlite'))
  database.initialize()
  repository = new AppRepository(database, path.join(app.getPath('documents'), 'COC跑团记录'))
  const seaLogService = new SeaLogService(repository, path.join(dataDirectory, 'cache'), (input, init) =>
    net.fetch(input instanceof URL ? input.toString() : input, init)
  )
  const fileService = new FileService(repository, printHtmlToPdf)
  const tableExportService = new TableExportService(repository)
  const characterFileService = new CharacterFileService(repository, printHtmlToPdf)
  const noteFileService = new NoteFileService(dataDirectory)
  backupService = new BackupService(repository, dataDirectory, path.join(dataDirectory, 'cache'))
  registerIpc(
    repository,
    () => mainWindow,
    seaLogService,
    fileService,
    tableExportService,
    characterFileService,
    noteFileService,
    backupService,
    dataDirectory
  )
  protocol.handle('coc-media', (request) => {
    try {
      const url = new URL(request.url)
      const relative = decodeURIComponent(url.host + url.pathname).replace(/^\/+/, '')
      const target = noteFileService.absolutePath(relative)
      if (!fs.existsSync(target)) return new Response('', { status: 404 })
      return new Response(fs.readFileSync(target), {
        headers: { 'content-type': contentTypeFor(target) }
      })
    } catch {
      return new Response('', { status: 400 })
    }
  })
  backupService.startAutomaticBackups()
  logger.info('application-ready', { packaged: app.isPackaged, electron: process.versions.electron })
}

function contentTypeFor(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.bmp') return 'image/bmp'
  return 'image/png'
}

async function printHtmlToPdf(html: string): Promise<Buffer> {
  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, javascript: false }
  })
  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    return await printWindow.webContents.printToPDF({ printBackground: true, pageSize: 'A4' })
  } finally {
    printWindow.destroy()
  }
}

function getInitialBounds(): { x?: number; y?: number; width: number; height: number; maximized: boolean } {
  const saved = repository?.getSettings().windowState
  return resolveWindowBounds(
    saved,
    screen.getAllDisplays().map((display) => display.workArea)
  )
}

function saveWindowState(): void {
  if (!mainWindow || !repository || mainWindow.isMinimized()) return
  const maximized = mainWindow.isMaximized()
  const bounds = maximized ? mainWindow.getNormalBounds() : mainWindow.getBounds()
  repository.updateSettings({ windowState: { ...bounds, maximized } })
}

function scheduleWindowStateSave(): void {
  if (windowStateTimer) clearTimeout(windowStateTimer)
  windowStateTimer = setTimeout(saveWindowState, 250)
}

function createWindow(): void {
  const bounds = getInitialBounds()
  mainWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    // Windows 10 风格：不透明直角窗口。thickFrame + resizable 交给系统原生
    // 隐形边框完成八方向缩放（原生、顺滑、遵守最小尺寸）。
    transparent: false,
    resizable: true,
    maximizable: true,
    thickFrame: true,
    hasShadow: false,
    roundedCorners: false,
    backgroundColor: '#e6e8ec',
    show: false,
    webPreferences: {
      preload: app.isPackaged
        ? path.join(process.resourcesPath, 'resources', 'preload.cjs')
        : path.join(process.cwd(), 'resources', 'preload.cjs'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
    logger?.error('preload-error', { preloadPath: path.basename(preloadPath), error: error.message })
  })

  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(path.join(currentDirectory, '../renderer/index.html'))

  if (bounds.maximized) mainWindow.maximize()
  mainWindow.once('ready-to-show', () => {
    mainCanPaint = true
    showReadyWindow()
  })
  mainWindow.on('resize', scheduleWindowStateSave)
  mainWindow.on('move', scheduleWindowStateSave)
  mainWindow.on('maximize', scheduleWindowStateSave)
  mainWindow.on('unmaximize', scheduleWindowStateSave)
  mainWindow.on('close', saveWindowState)
  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

function runSmokeTest(): void {
  const dataDirectory = getDataDirectory()
  fs.mkdirSync(dataDirectory, { recursive: true })
  fs.writeFileSync(
    path.join(dataDirectory, 'smoke-test.json'),
    JSON.stringify(
      {
        ok: true,
        packaged: app.isPackaged,
        dataDirectory,
        executablePath: process.execPath,
        electron: process.versions.electron,
        node: process.versions.node
      },
      null,
      2
    ),
    'utf8'
  )
  app.quit()
}

app.on('second-instance', () => {
  if (!mainWindow) {
    splashWindow?.show()
    splashWindow?.focus()
    return
  }
  if (!rendererReady) {
    splashWindow?.show()
    splashWindow?.focus()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

/** @returns 无返回值，仅在首屏已绘制且数据读取结束后切换到主窗口。 */
function showReadyWindow(): void {
  if (!mainWindow || !mainCanPaint || !rendererReady || startupComplete) return
  startupComplete = true
  mainWindow.show()
  splashWindow?.destroy()
  splashWindow = null
  logger?.info('startup-timing', {
    splashMs: splashShownMs,
    readyMs: Math.round(performance.now() - startupStarted)
  })
}

/** @returns 开屏首帧绘制后resolve，随后才加载业务服务和数据库。 */
async function showSplash(): Promise<void> {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 280,
    frame: false,
    resizable: false,
    show: false,
    backgroundColor: '#171321',
    webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true }
  })
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'resources', 'app-icon.png')
    : path.join(process.cwd(), 'build', 'icon.png')
  const icon = fs.existsSync(iconPath)
    ? `<img alt="" src="data:image/png;base64,${fs.readFileSync(iconPath).toString('base64')}">`
    : ''
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
    body{margin:0;min-height:280px;display:grid;place-content:center;text-align:center;background:#171321;color:#f0eafa;font-family:'Segoe UI','Microsoft YaHei',sans-serif;-webkit-app-region:drag}
    img{width:64px;height:64px;margin:0 auto 16px;border-radius:15px}h1{font-size:21px;margin:0 0 20px;font-weight:600}
    .track{height:3px;width:180px;background:#322842;margin:auto;overflow:hidden;border-radius:3px}.bar{height:100%;width:40%;background:#aa83ff;animation:slide 1s ease-in-out infinite}
    @keyframes slide{from{transform:translateX(-100%)}to{transform:translateX(350%)}}p{font-size:12px;color:#c7b9dc;margin:14px 0 0}
    @media(prefers-reduced-motion:reduce){.bar{animation:none;width:100%}}
    </style></head><body>${icon}<h1>COC 跑团记录簿</h1><div class="track" role="progressbar" aria-label="正在打开记录簿"><div class="bar"></div></div><p>正在打开记录簿…</p></body></html>`
  await splashWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  splashWindow.show()
  splashShownMs = Math.round(performance.now() - startupStarted)
  await splashWindow.webContents.executeJavaScript(
    'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))'
  )
}

ipcMain.handle('app:renderer-ready', (event) => {
  if (event.sender !== mainWindow?.webContents) return
  rendererReady = true
  showReadyWindow()
})

app.whenReady().then(async () => {
  if (process.argv.includes('--smoke-test')) {
    runSmokeTest()
    return
  }
  try {
    await showSplash()
    await initializeServices()
    createWindow()
  } catch (error) {
    dialog.showErrorBox('无法打开记录簿', error instanceof Error ? error.message : '启动失败，请重试。')
    app.quit()
  }
})

app.on('before-quit', () => {
  if (windowStateTimer) clearTimeout(windowStateTimer)
  saveWindowState()
})

app.on('will-quit', () => {
  backupService?.stopAutomaticBackups()
  backupService = null
  database?.close()
  database = null
})

app.on('window-all-closed', () => app.quit())
