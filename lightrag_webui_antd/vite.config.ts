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
      // POST /query and /query/stream → backend; GET /query → frontend
      '/query': {
        target: 'http://localhost:9621',
        changeOrigin: true,
        bypass: (req) => {
          if (req.method === 'GET' && (req.url === '/query' || req.url === '/query/')) return req.url
          return null
        },
      },
      // /documents/something → backend; exact /documents → frontend
      '/documents/': { target: 'http://localhost:9621', changeOrigin: true },
      // /graph/something → backend; exact /graph → frontend
      '/graph/': { target: 'http://localhost:9621', changeOrigin: true },
      '/graphs': { target: 'http://localhost:9621', changeOrigin: true },
      '/health': { target: 'http://localhost:9621', changeOrigin: true },
      // POST /login → backend; GET /login → frontend
      '/login': {
        target: 'http://localhost:9621',
        changeOrigin: true,
        bypass: (req) => {
          if (req.method === 'GET') return req.url
          return null
        },
      },
      '/auth-status': { target: 'http://localhost:9621', changeOrigin: true },
      // /kbs, /users, /orgs → backend for API calls (has Authorization header)
      // but let browser navigation (no Authorization) reach the SPA
      '/kbs': {
        target: 'http://localhost:9621',
        changeOrigin: true,
        bypass: (req) => {
          if (req.method === 'GET' && !req.headers['authorization']) return req.url
          return null
        },
      },
      '/users': {
        target: 'http://localhost:9621',
        changeOrigin: true,
        bypass: (req) => {
          if (req.method === 'GET' && !req.headers['authorization']) return req.url
          return null
        },
      },
      '/orgs': {
        target: 'http://localhost:9621',
        changeOrigin: true,
        bypass: (req) => {
          if (req.method === 'GET' && !req.headers['authorization']) return req.url
          return null
        },
      },
      // /chat/sessions → backend (always requires Authorization)
      '/chat': { target: 'http://localhost:9621', changeOrigin: true },
    },
  },
  base: '/webui/',
  build: {
    outDir: path.resolve(__dirname, '../lightrag/api/webui'),
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: {
          'antd-vendor': ['antd', '@ant-design/icons'],
          'react-vendor': ['react', 'react-dom', 'react-router-dom'],
          'graph-vendor': ['sigma', 'graphology', 'graphology-layout-forceatlas2', 'graphology-layout'],
          'markdown-vendor': ['react-markdown', 'remark-gfm', 'rehype-raw', 'remark-math', 'rehype-katex'],
          'katex-vendor': ['katex'],
        },
      },
    },
  },
})
