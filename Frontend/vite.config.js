import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // During dev: proxy API calls to local Flask (python server.py)
  server: {
    port: 3000,
    proxy: {
      '/trigger':   'http://localhost:5001',
      '/deals':     'http://localhost:5001',
      '/settings':  'http://localhost:5001',
      '/crm':       'http://localhost:5001',
    },
  },
  // Production build goes into Pipeline/static/dist/
  // Flask serves this via the /app route
  build: {
    outDir: '../Pipeline/static/dist',
    emptyOutDir: true,
  },
})
