import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split the big third-party dependencies out of the app bundle.
        //
        // These change far less often than the app code does, so giving them
        // their own hashed chunks means a normal deploy only invalidates the
        // app chunk — returning members keep the cached vendor ones instead of
        // re-downloading React and Leaflet every time.
        //
        // Leaflet especially: it's only needed on the screens that actually
        // draw a map (the alumni map inside Notable Old Boys, Business Directory,
        // and the business/job/event detail pages), so keeping it separate
        // means it isn't in the critical path for anyone who never opens one.
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-leaflet': ['leaflet', 'react-leaflet'],
          'vendor-supabase': ['@supabase/supabase-js'],
        },
      },
    },
  },
})
