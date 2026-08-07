import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendPort = env.VITE_BACKEND_PORT || process.env.PORT || '3000'
  const backendTarget = `http://localhost:${backendPort}`

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/join': {
          target: backendTarget,
          changeOrigin: true,
        },
        // Game WebSocket connection. Proxied by path (rather than the site
        // root) so it doesn't collide with Vite's own dev-server sockets.
        '/ws': {
          target: backendTarget,
          changeOrigin: true,
          ws: true,
        },
      },
    },
    build: {
      outDir: 'dist',
    },
  }
})

