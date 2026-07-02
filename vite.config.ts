import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  build: {
    rollupOptions: {
      external: ['@libsql/client/web'],
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
