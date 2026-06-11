import process from "node:process"

import { defineConfig } from "vite"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import viteReact from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { nitro } from "nitro/vite"

// On Vercel (VERCEL=1 is set during the build) Nitro emits the Vercel Build
// Output; locally and for the Docker image it targets the Bun server.
const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    nitro({ preset: process.env.VERCEL ? "vercel" : "bun" }),
    viteReact(),
  ],
})

export default config
