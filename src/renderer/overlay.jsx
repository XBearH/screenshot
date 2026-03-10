import { useEffect, useState } from 'react'

export default function Overlay() {
  const [text, setText] = useState('加载中...')

  useEffect(() => {
    // 通过 preload 暴露的 API 监听
    const unsubscribe = window.electronAPI.onSetOverlayText((event, data) => {
      setText(data.text || '无翻译内容')
    })

    return () => {
      if (unsubscribe) unsubscribe()
    }
  }, [])

  const handleClose = () => {
    window.electronAPI.closeOverlay()
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        backgroundColor: 'rgba(255, 255, 255, 0.95)',
        border: '2px solid #0078d4',
        borderRadius: '8px',
        padding: '10px',
        fontSize: '14px',
        color: '#333',
        overflow: 'auto',
        cursor: 'move',
        userSelect: 'text',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)'
      }}
      onDoubleClick={handleClose}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '8px',
          borderBottom: '1px solid #ddd',
          paddingBottom: '5px'
        }}
      >
        <span style={{ fontWeight: 'bold', color: '#0078d4' }}>📋 翻译结果</span>
        <button
          onClick={handleClose}
          style={{
            background: '#ff4d4f',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            padding: '2px 8px',
            cursor: 'pointer',
            fontSize: '12px'
          }}
        >
          ✕ 关闭
        </button>
      </div>

      <div
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          lineHeight: '1.6'
        }}
      >
        {text}
      </div>

      <div
        style={{
          marginTop: '10px',
          fontSize: '12px',
          color: '#999',
          textAlign: 'center'
        }}
      >
        💡 双击或点击关闭按钮隐藏
      </div>
    </div>
  )
}