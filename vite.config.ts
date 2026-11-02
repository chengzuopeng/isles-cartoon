import { defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    port: 5280,
    strictPort: true,
  },
  optimizeDeps: {
    entries: ['index.html'],
  },
  build: {
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
