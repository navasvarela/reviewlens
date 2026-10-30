import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Vite discovers its config only through a default export.
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs let the built report open from any directory or CI artifact URL.
  base: "./",
})
