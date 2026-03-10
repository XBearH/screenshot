// electron.vite.config.mjs
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    // 主进程配置（保持默认即可）
  },
  preload: {
    // 预加载脚本配置（保持默认即可）
  },
  renderer: {
    root: 'src/renderer',  // ← 关键！指定 renderer 目录
    plugins: [react()],    // ← react 插件放这里
  },
})