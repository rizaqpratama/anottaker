import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backendPort = process.env.NERTATOR_SERVER_PORT || 4001

export default defineConfig({
  base: '/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': { target: `http://localhost:${backendPort}`, ws: false },
    },
  },
})
