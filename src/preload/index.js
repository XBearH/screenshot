import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 触发截图会话
  startCaptureSession: (trigger = 'button') =>
    ipcRenderer.invoke('start-capture-session', trigger),

  // 兼容旧调用
  captureOcrTranslateOverlay: () =>
    ipcRenderer.invoke('capture-ocr-translate-overlay'),

  // 提交/取消选区
  submitCaptureSelection: (bounds, targetLang, options) =>
    ipcRenderer.invoke('submit-capture-selection', bounds, targetLang, options),
  cancelCaptureSession: () =>
    ipcRenderer.invoke('cancel-capture-session'),

  // 快捷键设置
  setCaptureShortcut: (shortcut) =>
    ipcRenderer.invoke('set-capture-shortcut', shortcut),
  getCaptureShortcut: () =>
    ipcRenderer.invoke('get-capture-shortcut'),

  // OCR 状态
  getOcrStatus: () =>
    ipcRenderer.invoke('get-ocr-status'),

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
  },

  // 监听截图会话状态
  onCaptureSessionStatus: (callback) => {
    ipcRenderer.on('capture-session-status', callback)
    return () => ipcRenderer.removeListener('capture-session-status', callback)
  }
})