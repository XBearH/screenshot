import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 截图 + OCR + 翻译 + 覆盖层
  captureOcrTranslateOverlay: (screenIndex, lang, targetLang) =>
    ipcRenderer.invoke('capture-ocr-translate-overlay', screenIndex, lang, targetLang),

  // 翻译
  translateText: (text, from, to) =>
    ipcRenderer.invoke('translate-text', text, from, to),

  // 获取屏幕列表
  getScreenList: () =>
    ipcRenderer.invoke('get-screen-list'),

  // 关闭覆盖层
  closeOverlay: () =>
    ipcRenderer.invoke('close-overlay'),

  // 监听覆盖层文本（用于 overlay 组件）
  onSetOverlayText: (callback) => {
    ipcRenderer.on('set-overlay-text', callback)
    return () => ipcRenderer.removeListener('set-overlay-text', callback)
  }
})