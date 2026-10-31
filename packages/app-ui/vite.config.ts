import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Vite discovers its config only through a default export.
export default defineConfig({
  plugins: [react()],
})
