import { app, BrowserWindow, clipboard, ipcMain, desktopCapturer, globalShortcut, nativeImage, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import Tesseract from 'tesseract.js'
import axios from 'axios'

let mainWindow = null
let overlayWindow = null
let captureWindow = null
let currentShortcut = 'CommandOrControl+Shift+A'
let restoreMainWindowAfterCapture = false

const OCR_LANG = 'chi_sim+eng'
const OCR_TARGET_LANG = 'zh-CN'

const ocrState = {
  worker: null,
  warmingUp: false,
  ready: false,
  error: null
}

function getRendererBaseUrl() {
  return process.env.ELECTRON_RENDERER_URL || 'http://localhost:5173'
}

function getWorkerPath() {
  return path.join(app.getAppPath(), 'node_modules/tesseract.js/src/worker-script/node/index.js')
}

function getTessdataDir() {
  return path.join(app.getPath('userData'), 'tessdata')
}

function getSettingsPath() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function clearOcrCache() {
  const tessdataDir = getTessdataDir()
  if (!fs.existsSync(tessdataDir)) return

  for (const entry of fs.readdirSync(tessdataDir)) {
    const fullPath = path.join(tessdataDir, entry)
    try {
      fs.rmSync(fullPath, { recursive: true, force: true })
    } catch (error) {
      console.warn('清理 OCR 缓存失败:', fullPath, error.message)
    }
  }
}

async function createOcrWorker(cacheMethod = 'write') {
  const tessdataDir = getTessdataDir()
  ensureDirectory(tessdataDir)

  return Tesseract.createWorker(
    OCR_LANG,
    1,
    {
      workerPath: getWorkerPath(),
      cachePath: tessdataDir,
      cacheMethod,
      logger: (m) => {
        if (m.status) {
          emitCaptureSessionStatus('warming', `OCR 预热: ${m.status}`)
        }
      }
    }
  )
}

function readSettings() {
  try {
    const settingsPath = getSettingsPath()
    if (!fs.existsSync(settingsPath)) {
      return {}
    }
    const raw = fs.readFileSync(settingsPath, 'utf-8')
    return JSON.parse(raw)
  } catch (error) {
    console.warn('读取设置失败，使用默认设置:', error.message)
    return {}
  }
}

function writeSettings(nextSettings) {
  const settingsPath = getSettingsPath()
  const prev = readSettings()
  fs.writeFileSync(settingsPath, JSON.stringify({ ...prev, ...nextSettings }, null, 2), 'utf-8')
}

function emitCaptureSessionStatus(status, message = '') {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('capture-session-status', {
    status,
    message,
    timestamp: Date.now()
  })
}

async function warmupOcrWorker() {
  if (ocrState.ready && ocrState.worker) {
    return ocrState.worker
  }
  if (ocrState.warmingUp) {
    return null
  }

  ocrState.warmingUp = true
  ocrState.error = null
  emitCaptureSessionStatus('warming', 'OCR 引擎预热中...')

  try {
    let worker = null
    try {
      worker = await createOcrWorker('write')
    } catch (firstError) {
      console.warn('首次 OCR 预热失败，清理缓存后重试:', firstError.message)
      clearOcrCache()
      worker = await createOcrWorker('refresh')
    }

    ocrState.worker = worker
    ocrState.ready = true
    emitCaptureSessionStatus('ready', 'OCR 引擎已就绪')
    return worker
  } catch (error) {
    ocrState.error = error
    ocrState.ready = false
    emitCaptureSessionStatus('error', `OCR 预热失败: ${error.message}`)
    throw error
  } finally {
    ocrState.warmingUp = false
  }
}

async function ensureOcrWorkerReady() {
  if (ocrState.ready && ocrState.worker) {
    return ocrState.worker
  }
  return warmupOcrWorker()
}

async function terminateOcrWorker() {
  if (ocrState.worker) {
    await ocrState.worker.terminate()
    ocrState.worker = null
    ocrState.ready = false
  }
}

function isValidSelection(bounds) {
  if (!bounds) return false
  return bounds.width > 5 && bounds.height > 5
}

function toInt(n) {
  return Math.max(0, Math.round(n))
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(getRendererBaseUrl())
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

function getCaptureRouteURL() {
  if (process.env.NODE_ENV === 'development') {
    return `${getRendererBaseUrl()}/#/capture`
  }
  return null
}

function closeCaptureWindow() {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.close()
    captureWindow = null
  }
}

function hideMainWindowForCaptureIfNeeded() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const isVisible = mainWindow.isVisible() && !mainWindow.isMinimized()
  restoreMainWindowAfterCapture = isVisible
  if (isVisible) {
    mainWindow.hide()
  }
}

function restoreMainWindowIfNeeded() {
  if (!restoreMainWindowAfterCapture) return
  restoreMainWindowAfterCapture = false
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show()
    mainWindow.focus()
  }
}

async function startCaptureSession(trigger = 'button') {
  if (captureWindow && !captureWindow.isDestroyed()) {
    captureWindow.focus()
    return { success: true, reused: true }
  }

  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.close()
  }

  hideMainWindowForCaptureIfNeeded()

  const cursorPoint = screen.getCursorScreenPoint()
  const display = screen.getDisplayNearestPoint(cursorPoint)
  const { x, y, width, height } = display.bounds

  captureWindow = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  captureWindow.setAlwaysOnTop(true, 'screen-saver')
  captureWindow.setVisibleOnAllWorkspaces(true)
  emitCaptureSessionStatus('selecting', `请框选截图区域（触发方式: ${trigger}）`)

  if (process.env.NODE_ENV === 'development') {
    try {
      await captureWindow.loadURL(getCaptureRouteURL())
    } catch (error) {
      restoreMainWindowIfNeeded()
      throw error
    }
  } else {
    try {
      await captureWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
        hash: '/capture'
      })
    } catch (error) {
      restoreMainWindowIfNeeded()
      throw error
    }
  }

  captureWindow.on('closed', () => {
    captureWindow = null
    emitCaptureSessionStatus('idle', '截图会话已结束')
  })

  return { success: true, reused: false }
}

function registerCaptureShortcut(nextShortcut) {
  if (!nextShortcut || typeof nextShortcut !== 'string') {
    throw new Error('快捷键格式无效')
  }

  if (currentShortcut) {
    globalShortcut.unregister(currentShortcut)
  }

  const success = globalShortcut.register(nextShortcut, () => {
    startCaptureSession('shortcut').catch((error) => {
      console.error('快捷键触发截图失败:', error)
      emitCaptureSessionStatus('error', `快捷键触发失败: ${error.message}`)
    })
  })

  if (!success) {
    throw new Error('快捷键注册失败，可能与系统或其他应用冲突')
  }
  currentShortcut = nextShortcut
  writeSettings({ captureShortcut: nextShortcut })
}

// ============ 创建覆盖层窗口 ============
function createOverlayWindow(bounds, translatedText) {
  if (overlayWindow) {
    overlayWindow.close()
  }

  const display = screen.getPrimaryDisplay()
  const { width: screenWidth, height: screenHeight } = display.workAreaSize

  overlayWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: Math.min(bounds.width + 100, screenWidth - bounds.x),
    height: Math.min(bounds.height + 50, screenHeight - bounds.y),
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 加载覆盖层内容
  if (process.env.NODE_ENV === 'development') {
    overlayWindow.loadURL(`${getRendererBaseUrl()}/#/overlay`)
  } else {
    overlayWindow.loadFile(path.join(__dirname, '../renderer/index.html'), {
      hash: '/overlay'
    })
  }

  // 发送翻译文本到覆盖层
  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('set-overlay-text', {
      text: translatedText,
      bounds: bounds
    })
  })

  // 点击关闭
  overlayWindow.on('closed', () => {
    overlayWindow = null
  })
}

// ============ 翻译函数（内部调用） ============
async function translateText(text, from = 'auto', to = 'zh-CN') {
  try {
    if (!text || text.trim().length === 0) {
      return { translatedText: '', error: '文本为空' }
    }

    const response = await axios.post(
      'https://fanyi.youdao.com/translate_o?smartresult=dict&smartresult=rule',
      new URLSearchParams({
        i: text,
        from: from,
        to: to,
        smartresult: 'dict',
        client: 'fanyideskweb',
        doctype: 'json',
        version: '2.1',
        keyfrom: 'fanyi.web'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://fanyi.youdao.com/'
        }
      }
    )

    const translatedText = response.data.translateResult
      ?.map(item => item.map(t => t.tgt).join(' '))
      .join('\n') || ''

    return {
      success: true,
      originalText: text,
      translatedText,
      from,
      to
    }
  } catch (error) {
    console.error('翻译失败:', error.message)
    return {
      success: false,
      originalText: text,
      translatedText: text,
      error: '翻译服务暂时不可用，显示原文'
    }
  }
}

async function handleSelectionToTranslate(selectionBounds, targetLang = OCR_TARGET_LANG, options = {}) {
  if (!isValidSelection(selectionBounds)) {
    throw new Error('无效选区，请重新框选')
  }

  emitCaptureSessionStatus('processing', 'OCR 处理中...')

  const display = screen.getDisplayNearestPoint({ x: selectionBounds.x, y: selectionBounds.y })
  const displayBounds = display.bounds
  const physicalWidth = Math.round(displayBounds.width * display.scaleFactor)
  const physicalHeight = Math.round(displayBounds.height * display.scaleFactor)

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: physicalWidth, height: physicalHeight }
  })

  if (sources.length === 0) {
    throw new Error('未检测到任何屏幕')
  }

  const selectedSource = sources.find((source) => String(source.display_id) === String(display.id)) || sources[0]
  const image = selectedSource.thumbnail
  const imageSize = image.getSize()

  const scaleX = imageSize.width / displayBounds.width
  const scaleY = imageSize.height / displayBounds.height

  const cropRect = {
    x: toInt((selectionBounds.x - displayBounds.x) * scaleX),
    y: toInt((selectionBounds.y - displayBounds.y) * scaleY),
    width: toInt(selectionBounds.width * scaleX),
    height: toInt(selectionBounds.height * scaleY)
  }

  const croppedImage = image.crop(cropRect)
  const pngBuffer = croppedImage.toPNG()

  const tempDir = path.join(app.getPath('temp'), 'screenshot-tool')
  ensureDirectory(tempDir)
  const tempPath = path.join(tempDir, `ocr_${Date.now()}.png`)
  fs.writeFileSync(tempPath, pngBuffer)

  try {
    const worker = await ensureOcrWorkerReady()
    const { data: { text } } = await worker.recognize(tempPath)

    let translatedText = text
    if (text.trim().length > 0) {
      emitCaptureSessionStatus('processing', '翻译处理中...')
      const translation = await translateText(text, 'auto', targetLang)
      translatedText = translation.translatedText || text
    }

    let copied = false
    if (options.copyImageToClipboard) {
      clipboard.clear()
      clipboard.writeImage(nativeImage.createFromBuffer(pngBuffer))
      copied = !clipboard.readImage().isEmpty()
    }

    createOverlayWindow(selectionBounds, translatedText)
    if (options.copyImageToClipboard) {
      emitCaptureSessionStatus('done', copied ? '截图翻译完成，截图已复制到剪切板' : '截图翻译完成，但截图复制失败')
    } else {
      emitCaptureSessionStatus('done', '截图翻译完成')
    }

    return {
      success: true,
      originalText: text,
      translatedText,
      copied,
      overlayShown: true,
      bounds: selectionBounds
    }
  } finally {
    fs.unlinkSync(tempPath)
  }
}

app.whenReady().then(async () => {
  createWindow()

  try {
    const settings = readSettings()
    const shortcut = settings.captureShortcut || currentShortcut
    registerCaptureShortcut(shortcut)
  } catch (error) {
    console.error('注册快捷键失败，回退默认值:', error)
    try {
      registerCaptureShortcut('CommandOrControl+Shift+A')
    } catch (fallbackError) {
      console.error('默认快捷键注册也失败:', fallbackError)
      emitCaptureSessionStatus('error', '快捷键注册失败，请在设置中更换组合键')
    }
  }

  warmupOcrWorker().catch((error) => {
    console.error('OCR 预热失败:', error)
  })
})

// ============ 新交互：开始截图会话 ============
ipcMain.handle('start-capture-session', async (event, trigger = 'button') => {
  try {
    return await startCaptureSession(trigger)
  } catch (error) {
    emitCaptureSessionStatus('error', `开启截图失败: ${error.message}`)
    throw error
  }
})

ipcMain.handle('cancel-capture-session', () => {
  closeCaptureWindow()
  restoreMainWindowIfNeeded()
  emitCaptureSessionStatus('idle', '已取消截图')
  return { success: true }
})

ipcMain.handle('submit-capture-selection', async (event, bounds, targetLang = OCR_TARGET_LANG, options = {}) => {
  try {
    emitCaptureSessionStatus('captured', '截图已确认，开始识别...')
    closeCaptureWindow()
    const result = await handleSelectionToTranslate(bounds, targetLang, options)
    restoreMainWindowIfNeeded()
    return result
  } catch (error) {
    console.error('❌ OCR+翻译失败:', error)
    restoreMainWindowIfNeeded()
    emitCaptureSessionStatus('error', `处理失败: ${error.message}`)
    throw error
  }
})

// 向后兼容旧按钮调用：改为进入截图会话
ipcMain.handle('capture-ocr-translate-overlay', async () => {
  return startCaptureSession('legacy-call')
})

ipcMain.handle('set-capture-shortcut', async (event, nextShortcut) => {
  const prev = currentShortcut
  try {
    registerCaptureShortcut(nextShortcut)
    return { success: true, shortcut: currentShortcut }
  } catch (error) {
    try {
      if (prev) {
        registerCaptureShortcut(prev)
      }
    } catch (rollbackError) {
      console.error('快捷键回滚失败:', rollbackError)
    }
    return { success: false, error: error.message, shortcut: prev }
  }
})

ipcMain.handle('get-capture-shortcut', async () => {
  return { success: true, shortcut: currentShortcut }
})

ipcMain.handle('get-ocr-status', async () => {
  return {
    ready: ocrState.ready,
    warmingUp: ocrState.warmingUp,
    error: ocrState.error?.message || null
  }
})

// ============ 翻译功能 ============
ipcMain.handle('translate-text', async (event, text, from = 'auto', to = 'zh-CN') => {
  try {
    if (!text || text.trim().length === 0) {
      return { translatedText: '', error: '文本为空' }
    }

    const response = await axios.post(
      'https://fanyi.youdao.com/translate_o?smartresult=dict&smartresult=rule',
      new URLSearchParams({
        i: text,
        from: from,
        to: to,
        smartresult: 'dict',
        client: 'fanyideskweb',
        doctype: 'json',
        version: '2.1',
        keyfrom: 'fanyi.web'
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Referer': 'https://fanyi.youdao.com/'
        }
      }
    )

    const translatedText = response.data.translateResult
      ?.map(item => item.map(t => t.tgt).join(' '))
      .join('\n') || ''

    return {
      success: true,
      originalText: text,
      translatedText,
      from,
      to
    }

  } catch (error) {
    console.error('翻译失败:', error.message)
    return {
      success: false,
      originalText: text,
      translatedText: text,
      error: '翻译服务暂时不可用，显示原文'
    }
  }
})

// ============ 关闭覆盖层 ============
ipcMain.handle('close-overlay', () => {
  if (overlayWindow) {
    overlayWindow.close()
    overlayWindow = null
  }
})

// ============ 获取屏幕列表 ============
ipcMain.handle('get-screen-list', async () => {
  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    return sources.map(source => ({
      id: source.display_id,
      name: source.name
    }))
  } catch (error) {
    console.error('获取屏幕列表失败:', error)
    return []
  }
})

// 窗口管理
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.on('will-quit', async () => {
  globalShortcut.unregisterAll()
  await terminateOcrWorker()
})