import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from 'electron'
import path from 'path'
import fs from 'fs'
import Tesseract from 'tesseract.js'
import axios from 'axios'

let mainWindow = null
let overlayWindow = null

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
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
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
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  })

  // 加载覆盖层内容
  if (process.env.NODE_ENV === 'development') {
    overlayWindow.loadURL('http://localhost:5173/overlay')
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

app.whenReady().then(createWindow)

// ============ 截图 + OCR + 翻译 + 覆盖层 ============
ipcMain.handle('capture-ocr-translate-overlay', async (event, screenIndex = 0, lang = 'chi_sim+eng', targetLang = 'zh-CN') => {
  try {
    // 1. 截图
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })

    if (sources.length === 0) {
      throw new Error('未检测到任何屏幕')
    }

    const selectedSource = sources[Math.min(screenIndex, sources.length - 1)]
    const image = selectedSource.thumbnail
    const pngBuffer = image.toPNG()

    // 2. 保存临时截图
    const tempDir = path.join(app.getPath('temp'), 'screenshot-tool')
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true })
    }

    const tempPath = path.join(tempDir, `ocr_${Date.now()}.png`)
    fs.writeFileSync(tempPath, pngBuffer)

// 3. OCR 识别
const worker = await Tesseract.createWorker({
  workerPath: path.join(__dirname, '../../node_modules/tesseract.js/dist/worker.min.js'),
  langPath: path.join(app.getPath('temp'), 'tessdata'),
  logger: m => console.log('OCR 进度:', m)
})

await worker.loadLanguage(lang)
await worker.initialize(lang)
const { data: { text, words } } = await worker.recognize(tempPath)
await worker.terminate()

    // 4. 翻译（直接调用内部函数）
    let translatedText = text
    if (text.trim().length > 0) {
      const translation = await translateText(text, 'auto', targetLang)
      translatedText = translation.translatedText || text
    }

    // 5. 计算文字边界（简化版，使用整个截图区域）
    const bounds = {
      x: 100,
      y: 100,
      width: 400,
      height: 200
    }

    // 6. 显示覆盖层
    createOverlayWindow(bounds, translatedText)

    // 7. 清理临时文件
    fs.unlinkSync(tempPath)

    return {
      success: true,
      originalText: text,
      translatedText,
      overlayShown: true
    }

  } catch (error) {
    console.error('❌ OCR+翻译失败:', error)
    throw error
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