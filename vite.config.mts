import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Mesma porta padrão do servidor (src/server/index.ts).
const API_PORT = Number(process.env.PORT ?? 3100)

export default defineConfig({
  root: 'src/web',
  resolve: { alias: { '@shared': resolve('src/shared') } },
  plugins: [react()],
  build: { outDir: resolve('dist/web'), emptyOutDir: true },
  server: {
    port: 5173,
    host: '127.0.0.1',
    proxy: { '/api': `http://127.0.0.1:${API_PORT}` }
  }
})
