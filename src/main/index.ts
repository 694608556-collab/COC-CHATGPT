import { app, BrowserWindow, net, screen } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveDataDirectory } from '../shared/portable-path'
import { resolveWindowBounds } from '../shared/window-state'
import { AppDatabase } from './database'
import { registerIpc } from './ipc'
import { AppLogger } from './logger'
import { AppRepository } from './repository'
import { SeaLogService } from './sea-log-service'
import { FileService } from './file-service'
import { TableExportService } from './table-export-service'
import { CharacterFileService } from './character-file-service'
import { BackupService } from './backup-service'

const currentDirectory = path.dirname(fileURLToPath(import.meta.url))
let mainWindow: BrowserWindow | null = null
let database: AppDatabase | null = null
let repository: AppRepository | null = null
let backupService: BackupService | null = null
let logger: AppLogger | null = null
let windowStateTimer: NodeJS.Timeout | undefined

const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()

function getDataDirectory(): string {
  return resolveDataDirectory({
    portableExecutableDir: process.env.PORTABLE_EXECUTABLE_DIR,
    executablePath: process.execPath,
    developmentRoot: app.isPackaged ? undefined : process.cwd()
  })
}

function initializeServices(): void {
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
  backupService = new BackupService(repository, dataDirectory, path.join(dataDirectory, 'cache'))
  registerIpc(
    repository,
    () => mainWindow,
    seaLogService,
    fileService,
    tableExportService,
    characterFileService,
    backupService,
    dataDirectory
  )
  backupService.startAutomaticBackups()
  logger.info('application-ready', { packaged: app.isPackaged, electron: process.versions.electron })
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
    minWidth: 1024,
    minHeight: 720,
    frame: false,
    show: false,
    backgroundColor: repository?.getSettings().theme === 'dark' ? '#0f1115' : '#e6e8ec',
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
  mainWindow.once('ready-to-show', () => mainWindow?.show())
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
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
})

app.disableHardwareAcceleration()

app.whenReady().then(() => {
  if (process.argv.includes('--smoke-test')) {
    runSmokeTest()
    return
  }
  initializeServices()
  createWindow()
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
