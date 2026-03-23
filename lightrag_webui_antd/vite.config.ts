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
  server: {
    port: 5174,
    proxy: {
      '/query': { target: 'http://localhost:9621', changeOrigin: true },
      '/documents': { target: 'http://localhost:9621', changeOrigin: true },
      '/graph': { target: 'http://localhost:9621', changeOrigin: true },
      '/graphs': { target: 'http://localhost:9621', changeOrigin: true },
      '/health': { target: 'http://localhost:9621', changeOrigin: true },
      '/login': { target: 'http://localhost:9621', changeOrigin: true },
      '/auth-status': { target: 'http://localhost:9621', changeOrigin: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'antd-vendor': ['antd', '@ant-design/icons'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'graph-vendor': ['sigma', 'graphology', 'graphology-layout-forceatlas2', 'graphology-layout'],
          'markdown-vendor': ['react-markdown', 'remark-gfm', 'rehype-raw'],
        },
      },
    },
  },
})
