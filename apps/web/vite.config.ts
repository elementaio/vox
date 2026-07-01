import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Dev runs on :5180 — server.ts keys off this port to target the local relay
  // on :4000 (Vite serves the UI, Phoenix is the relay).
  server: { port: 5180, strictPort: true },
  resolve: {
    alias: {
      // Consume the workspace SDK (packages/sdk) by its package name, from TS
      // source. Flip this to the real node_module when @pochta-chat/sdk ships to npm.
      '@pochta-chat/sdk': fileURLToPath(new URL('../../packages/sdk/src/index.ts', import.meta.url)),
    },
  },
})
