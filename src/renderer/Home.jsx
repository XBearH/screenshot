import { useEffect, useState } from 'react'

const ALLOWED_MAIN_KEYS = new Set([
  'Up', 'Down', 'Left', 'Right',
  'A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
])

function normalizeMainKey(event) {
  if (event.code?.startsWith('Key')) {
    return event.code.replace('Key', '').toUpperCase()
  }
  if (event.code?.startsWith('Digit')) {
    return event.code.replace('Digit', '')
  }
  if (/^F\d{1,2}$/i.test(event.key)) {
    return event.key.toUpperCase()
  }

  const keyMap = {
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right'
  }
  return keyMap[event.key] || null
}

function buildAcceleratorFromEvent(event) {
  const modifiers = []
  if (event.metaKey || event.ctrlKey) modifiers.push('CommandOrControl')
  if (event.altKey) modifiers.push('Alt')
  if (event.shiftKey) modifiers.push('Shift')

  const mainKey = normalizeMainKey(event)
  if (!mainKey || !ALLOWED_MAIN_KEYS.has(mainKey)) {
    return { valid: false, reason: '仅支持 字母/数字/F1-F12/方向键 作为主键' }
  }

  if (modifiers.length === 0) {
    return { valid: false, reason: '快捷键必须包含至少一个修饰键（Ctrl/Cmd/Alt/Shift）' }
  }

  return {
    valid: true,
    accelerator: [...modifiers, mainKey].join('+')
  }
}

export default function Home() {
  const [sessionStatus, setSessionStatus] = useState('idle')
  const [sessionMessage, setSessionMessage] = useState('')
  const [shortcutInput, setShortcutInput] = useState('CommandOrControl+Shift+A')
  const [ocrStatus, setOcrStatus] = useState({ ready: false, warmingUp: false, error: null })
  const [recordingShortcut, setRecordingShortcut] = useState(false)

  useEffect(() => {
    let unsubscribe = null

    const init = async () => {
      try {
        const shortcut = await window.electronAPI.getCaptureShortcut()
        if (shortcut?.shortcut) {
          setShortcutInput(shortcut.shortcut)
        }

        const nextOcrStatus = await window.electronAPI.getOcrStatus()
        setOcrStatus(nextOcrStatus)
      } catch (error) {
        setSessionStatus('error')
        setSessionMessage(error.message || '初始化失败')
      }
    }

    if (window.electronAPI?.onCaptureSessionStatus) {
      unsubscribe = window.electronAPI.onCaptureSessionStatus((event, payload) => {
        setSessionStatus(payload.status)
        setSessionMessage(payload.message || '')
      })
    }

    init()
    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const handleStartCapture = async () => {
    try {
      if (!window.electronAPI?.startCaptureSession) {
        throw new Error('Electron API 未注入：请确认使用 Electron 窗口启动，并重启 dev 进程使 preload 生效')
      }
      await window.electronAPI.startCaptureSession('button')
    } catch (error) {
      setSessionStatus('error')
      setSessionMessage(error.message || '启动截图失败')
    }
  }

  const handleSaveShortcut = async () => {
    try {
      const candidate = shortcutInput.trim()
      if (!candidate) {
        throw new Error('请先按下快捷键组合')
      }

      const result = await window.electronAPI.setCaptureShortcut(candidate)
      if (!result.success) {
        throw new Error(result.error || '快捷键保存失败')
      }
      setSessionStatus('ready')
      setSessionMessage(`快捷键已更新为 ${result.shortcut}`)
    } catch (error) {
      setSessionStatus('error')
      setSessionMessage(error.message || '快捷键保存失败')
    }
  }

  const handleShortcutKeyDown = (event) => {
    event.preventDefault()
    event.stopPropagation()

    if ((event.key === 'Backspace' || event.key === 'Delete') && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
      setShortcutInput('')
      setSessionMessage('快捷键已清空，按组合键重新录制')
      return
    }

    if (['Control', 'Meta', 'Alt', 'Shift'].includes(event.key)) {
      return
    }

    const parsed = buildAcceleratorFromEvent(event)
    if (!parsed.valid) {
      setSessionStatus('error')
      setSessionMessage(parsed.reason)
      return
    }

    setSessionStatus('ready')
    setShortcutInput(parsed.accelerator)
    setSessionMessage(`已录制：${parsed.accelerator}`)
  }

  const statusText = {
    idle: '待命',
    warming: '预热中',
    ready: '就绪',
    selecting: '框选中',
    processing: '处理中',
    done: '已完成',
    error: '错误'
  }[sessionStatus] || '未知'

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ color: '#333' }}>📸 截图翻译工具（原型）</h1>

      <div style={{ marginBottom: '16px' }}>
        <button
          onClick={handleStartCapture}
          style={{
            padding: '10px 20px',
            fontSize: '16px',
            backgroundColor: '#0078d4',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: 'pointer'
          }}
        >
          开始截图翻译
        </button>
      </div>

      <div style={{ marginBottom: '14px' }}>
        <label style={{ display: 'block', marginBottom: 6, color: '#444' }}>全局快捷键</label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            value={shortcutInput}
            readOnly
            onFocus={() => setRecordingShortcut(true)}
            onBlur={() => setRecordingShortcut(false)}
            onKeyDown={handleShortcutKeyDown}
            placeholder="点击后按下快捷键组合"
            style={{
              width: 320,
              padding: '8px 10px',
              border: '1px solid #ccc',
              borderRadius: 4,
              background: recordingShortcut ? '#eef6ff' : '#fff'
            }}
          />
          <button
            onClick={handleSaveShortcut}
            style={{
              padding: '8px 12px',
              border: 'none',
              borderRadius: 4,
              background: '#1a7f37',
              color: '#fff',
              cursor: 'pointer'
            }}
          >
            保存快捷键
          </button>
        </div>
      </div>

      <div
        style={{
          padding: '10px',
          borderRadius: 6,
          background: '#f7f7f7',
          color: '#333',
          lineHeight: 1.7
        }}
      >
        <div>会话状态：{statusText}</div>
        <div>会话消息：{sessionMessage || '无'}</div>
        <div>OCR状态：{ocrStatus.ready ? '已就绪' : (ocrStatus.warmingUp ? '预热中' : '未就绪')}</div>
        <div>快捷键录制：{recordingShortcut ? '录制中（按下组合键）' : '未录制'}</div>
        {ocrStatus.error && <div style={{ color: '#c0392b' }}>OCR错误：{ocrStatus.error}</div>}
      </div>
    </div>
  )
}