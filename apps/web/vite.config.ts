import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "wasm-mime",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith(".wasm")) {
            res.setHeader("Content-Type", "application/wasm")
          }
          next()
        })
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    // Fixed port so stray/zombie Vite processes can't silently re-home us
    // on 5174/5175/etc. `strictPort: true` makes Vite fail loudly if 5573
    // is already taken, rather than jump to the next free port.
    port: 5573,
    strictPort: true,
    // Bind on all interfaces so the app is reachable via either
    // `http://localhost:5573` or `http://127.0.0.1:5573` (Windows 11 has
    // been resolving `localhost` to ::1 only by default, which left 127.*
    // unreachable in some browsers).
    host: true,
    // Proxy the API through Vite instead of calling the backend cross-origin
    // from the browser. Same-origin means no CORS complexity and the session
    // cookie (Lax default) is always sent back on subsequent requests.
    // `api.ts` then uses `VITE_API_URL=/api/v1` (a relative path) so the
    // browser hits `http://<same-host>:5173/api/v1/...` and Vite forwards it.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
        // Strip the browser's Origin header before forwarding. The backend's
        // CORS middleware treats missing Origin as same-origin and allows it.
        // Without this, Vite would pass the page origin (e.g. localhost:5174
        // if 5173 was already taken) and the API would 403 on preflight.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin');
          });
        },
      },
    },
    // COOP+COEP used to be set to enable SharedArrayBuffer for the
    // @sqlite.org/sqlite-wasm client. Dropped because `COEP: require-corp`
    // blocks cross-origin fetches even with correct CORS. The sqlite client
    // falls back to OPFS + async mode without SAB and still works.
    headers: {},
  },
})
