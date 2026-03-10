import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './assets/base.css'

const rootElement = document.getElementById('root')
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
} else {
  console.error('❌ 找不到 root 元素')
}