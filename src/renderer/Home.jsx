// src/renderer/Home.jsx
export default function Home() {
  const handleCaptureTranslate = async () => {
    try {
      console.log('点击了截图翻译按钮')
      const result = await window.electronAPI.captureOcrTranslateOverlay(0, 'chi_sim+eng', 'zh-CN')
      console.log('翻译结果:', result)
      alert('翻译完成！')
    } catch (error) {
      console.error('操作失败:', error)
      alert('操作失败：' + error.message)
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h1 style={{ color: '#333' }}>📸 截图翻译工具</h1>
      <button 
        onClick={handleCaptureTranslate}
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
        截图 + OCR + 翻译 + 覆盖层
      </button>
    </div>
  )
}