// src/renderer/App.jsx
import Home from './Home'
import Overlay from './overlay'
import Capture from './capture'

export default function App() {
  const path = window.location.pathname
  const hash = window.location.hash

  if (path === '/overlay' || hash === '#/overlay') {
    return <Overlay />
  }

  if (path === '/capture' || hash === '#/capture') {
    return <Capture />
  }

  return <Home />
}