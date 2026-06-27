import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    watch: {
      // Don't watch tool output / generated dirs. graphify-out alone holds ~860
      // files whose cache/ast/*.json are constantly rewritten; OneDrive then
      // re-syncs them. The resulting flood of FS events blocks Node's event loop
      // long enough that esbuild's heartbeat times out and Vite reports
      // "The service is no longer running". Ignoring these keeps the loop free.
      ignored: [
        '**/graphify-out/**',
        '**/supabase/**',
        '**/.git/**',
        '**/dist/**',
        '**/node_modules/**',
      ],
    },
  },
})
