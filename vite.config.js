import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // Emit relative asset paths (./assets/...) instead of absolute (/assets/...)
  // so the built HTML works when loaded from a chrome-extension:// origin.
  base: './',
  plugins: [react()],
  build: {
    rollupOptions: {
      // Each key is an HTML entry point Vite builds into dist/.
      // Add more here later (e.g. an options page).
      input: {
        sidepanel: fileURLToPath(new URL('./sidepanel.html', import.meta.url)),
      },
    },
  },
})
