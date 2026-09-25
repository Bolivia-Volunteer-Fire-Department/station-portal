import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves project sites from https://<user>.github.io/<repo-name>/,
// while local dev/preview runs at the root. BASE_PATH is set by the CI workflow
// (e.g. /station-portal/) so asset URLs resolve correctly once deployed.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [
    react(),
    tailwindcss(),
  ],
})