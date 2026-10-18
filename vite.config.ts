import { defineConfig } from "vite";

export default defineConfig({
  build: {
    rollupOptions: { input: { main: "index.html", backdrop: "backdrop.html" } },
  },
  server: {
    host: "127.0.0.1",
    port: 1420,
    strictPort: true,
    // Only interface files need live reload. Rust locks its build outputs on Windows.
    watch: { ignored: ["**/src-tauri/**", "**/.tools/**", "**/.cache/**", "**/docs/**"] },
  },
});
