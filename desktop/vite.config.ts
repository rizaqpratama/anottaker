import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // npm workspaces links @nertator/shared via a symlink outside desktop/. Without
  // preserveSymlinks, Vite/Rollup resolve to the real path and its CJS build stops
  // being recognized as a node_modules dependency, breaking named-export detection.
  resolve: { preserveSymlinks: true },
})
