import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Reload the whole page whenever a source file is saved. Fast-refresh keeps old canvas drawings
// and component state around, which made edits look like they "didn't apply".
const fullReloadOnSave = (): Plugin => ({
  name: 'full-reload-on-save',
  handleHotUpdate({ server }) {
    server.ws.send({ type: 'full-reload' })
    return []
  },
})

export default defineConfig({ plugins: [react(), fullReloadOnSave()], build: { chunkSizeWarningLimit: 1500 } })
