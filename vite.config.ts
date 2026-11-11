import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client build lands in dist/client, which the server serves. In dev, /api goes to the
// server on 8781 (or, with `pnpm dev:fake`, never leaves the browser).
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:8781' } },
})
