import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * COOP/COEP (needed for SharedArrayBuffer, which the multi-threaded
 * ffmpeg.wasm core needs — see loadFFmpeg in src/lib/content-studio/autoEdit.ts)
 * scoped to only the video editor route, matching vercel.json's prod
 * headers. NOT applied globally: COOP:same-origin is known to break
 * window.open()-based OAuth popups (Firebase Auth's signInWithPopup), so
 * every other route — including login — is left untouched.
 */
function coopCoepForEditorRoute(): Plugin {
  return {
    name: 'coop-coep-editor-route',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.startsWith('/content-studio/editing/')) {
          res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
          res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp')
        }
        next()
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), coopCoepForEditorRoute()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
