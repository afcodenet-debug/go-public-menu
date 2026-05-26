import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  appType: 'spa',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },

  // IMPORTANT for Electron packaged build:
  // main process loads: file://${__dirname}/../renderer/index.html
  // so Vite must output to dist/renderer.
  build: {
    outDir: 'dist/renderer',
    // Avoid noisy devtools “Source map error” in packaged runs
    sourcemap: false
  },

  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        secure: false,
        timeout: 10000,
        ws: false
      }
    }
  }
})
