import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron loads the production renderer through file://, where root-relative
  // asset URLs resolve to the filesystem root instead of dist/assets.
  base: './',
  plugins: [react()],
})
