import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  resolve: { alias: { '@tarojs/components': path.resolve(__dirname, 'taro-elements.ts') } },
  server: { host: '127.0.0.1', port: 10089, strictPort: true },
  build: { outDir: '../../output/ai-design-preview', emptyOutDir: true },
})
