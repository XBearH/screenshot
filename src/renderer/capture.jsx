import { useEffect, useState } from 'react'

const MIN_SIZE = 24

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function normalizeRect(start, end) {
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)
  return { x, y, width, height }
}

function buildScreenBounds(rect) {
  return {
    x: Math.round(window.screenX + rect.x),
    y: Math.round(window.screenY + rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  }
}

function resizeRect(startRect, dx, dy, handle, maxWidth, maxHeight) {
  let { x, y, width, height } = startRect

  if (handle.includes('e')) width += dx
  if (handle.includes('s')) height += dy
  if (handle.includes('w')) {
    x += dx
    width -= dx
  }
  if (handle.includes('n')) {
    y += dy
    height -= dy
  }

  if (width < MIN_SIZE) {
    if (handle.includes('w')) x -= (MIN_SIZE - width)
    width = MIN_SIZE
  }
  if (height < MIN_SIZE) {
    if (handle.includes('n')) y -= (MIN_SIZE - height)
    height = MIN_SIZE
  }

  x = clamp(x, 0, maxWidth - MIN_SIZE)
  y = clamp(y, 0, maxHeight - MIN_SIZE)
  width = clamp(width, MIN_SIZE, maxWidth - x)
  height = clamp(height, MIN_SIZE, maxHeight - y)

  return { x, y, width, height }
}

export default function Capture() {
  const [selection, setSelection] = useState(null)
  const [action, setAction] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight

  const cancelSession = async () => {
    await window.electronAPI.cancelCaptureSession()
  }

  const submitSelection = async () => {
    if (!selection) {
      setError('请先框选区域')
      return
    }
    if (selection.width <= 5 || selection.height <= 5) {
      setError('选区太小，请重新框选')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      await window.electronAPI.submitCaptureSelection(buildScreenBounds(selection), 'zh-CN')
    } catch (submitError) {
      setSubmitting(false)
      setError(submitError.message || '提交选区失败')
    }
  }

  const startDraw = (event) => {
    if (submitting) return
    setError('')
    const point = { x: event.clientX, y: event.clientY }
    setAction({
      type: 'draw',
      startMouse: point,
      startRect: { x: point.x, y: point.y, width: 0, height: 0 }
    })
    setSelection({ x: point.x, y: point.y, width: 0, height: 0 })
  }

  const startMove = (event) => {
    if (!selection || submitting) return
    event.stopPropagation()
    setAction({
      type: 'move',
      startMouse: { x: event.clientX, y: event.clientY },
      startRect: selection
    })
  }

  const startResize = (event, handle) => {
    if (!selection || submitting) return
    event.stopPropagation()
    setAction({
      type: 'resize',
      handle,
      startMouse: { x: event.clientX, y: event.clientY },
      startRect: selection
    })
  }

  useEffect(() => {
    const handleMouseMove = (event) => {
      if (!action) return

      const dx = event.clientX - action.startMouse.x
      const dy = event.clientY - action.startMouse.y

      if (action.type === 'draw') {
        setSelection(normalizeRect(action.startMouse, { x: event.clientX, y: event.clientY }))
        return
      }

      if (action.type === 'move') {
        const nextX = clamp(action.startRect.x + dx, 0, viewportWidth - action.startRect.width)
        const nextY = clamp(action.startRect.y + dy, 0, viewportHeight - action.startRect.height)
        setSelection({ ...action.startRect, x: nextX, y: nextY })
        return
      }

      if (action.type === 'resize') {
        setSelection(resizeRect(action.startRect, dx, dy, action.handle, viewportWidth, viewportHeight))
      }
    }

    const handleMouseUp = () => {
      if (!action) return
      setAction(null)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [action, viewportWidth, viewportHeight])

  useEffect(() => {
    const handleKeyDown = async (event) => {
      if (event.key === 'Escape') {
        await cancelSession()
      } else if (event.key === 'Enter') {
        await submitSelection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  })

  const handleStyles = {
    n: { top: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
    s: { bottom: -5, left: '50%', transform: 'translateX(-50%)', cursor: 'ns-resize' },
    w: { left: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
    e: { right: -5, top: '50%', transform: 'translateY(-50%)', cursor: 'ew-resize' },
    nw: { left: -5, top: -5, cursor: 'nwse-resize' },
    ne: { right: -5, top: -5, cursor: 'nesw-resize' },
    sw: { left: -5, bottom: -5, cursor: 'nesw-resize' },
    se: { right: -5, bottom: -5, cursor: 'nwse-resize' }
  }

  const resizeHandles = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']

  return (
    <div
      role="presentation"
      onMouseDown={startDraw}
      style={{
        width: '100vw',
        height: '100vh',
        cursor: action?.type === 'draw' ? 'crosshair' : 'default',
        background: 'transparent',
        position: 'relative',
        userSelect: 'none'
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          color: '#fff',
          fontSize: 14,
          background: 'rgba(0, 0, 0, 0.52)',
          padding: '8px 10px',
          borderRadius: 6,
          zIndex: 20
        }}
      >
        拖拽框选，边框可拖动和缩放；Enter 确认，Esc 取消
      </div>

      {selection && (
        <div
          role="presentation"
          onMouseDown={startMove}
          style={{
            position: 'absolute',
            left: selection.x,
            top: selection.y,
            width: selection.width,
            height: selection.height,
            border: '2px solid #4da3ff',
            boxShadow: 'none',
            background: 'transparent',
            boxSizing: 'border-box',
            cursor: action?.type === 'move' ? 'grabbing' : 'move',
            zIndex: 30
          }}
        >
          {resizeHandles.map((handle) => (
            <div
              key={handle}
              role="presentation"
              onMouseDown={(event) => startResize(event, handle)}
              style={{
                position: 'absolute',
                width: 10,
                height: 10,
                borderRadius: 999,
                background: '#fff',
                border: '1px solid #4da3ff',
                ...handleStyles[handle]
              }}
            />
          ))}

          <div
            style={{
              position: 'absolute',
              right: 0,
              top: -40,
              display: 'flex',
              gap: 8
            }}
          >
            <button
              type="button"
              onClick={submitSelection}
              disabled={submitting}
              style={{
                background: '#1a7f37',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 10px',
                cursor: 'pointer'
              }}
            >
              确认
            </button>
            <button
              type="button"
              onClick={cancelSession}
              disabled={submitting}
              style={{
                background: '#d1242f',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '6px 10px',
                cursor: 'pointer'
              }}
            >
              关闭
            </button>
          </div>
        </div>
      )}

      {(submitting || error) && (
        <div
          style={{
            position: 'absolute',
            right: 16,
            bottom: 16,
            color: '#fff',
            fontSize: 13,
            background: error ? 'rgba(222, 54, 24, 0.9)' : 'rgba(0, 0, 0, 0.62)',
            padding: '8px 10px',
            borderRadius: 6,
            zIndex: 40
          }}
        >
          {error || '处理中...'}
        </div>
      )}
    </div>
  )
}
