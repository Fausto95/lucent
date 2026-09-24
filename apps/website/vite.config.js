import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import lucent from "../../packages/lucent/package.json" with { type: "json" };

export default defineConfig({
  // The docs say which Lucent they were checked against (scripts/website.ts compiles their samples with it).
  define: { __LUCENT_VERSION__: JSON.stringify(lucent.version) },
  plugins: [stylex.vite({ useCSSLayers: { before: ["reset"] } }), react()],
  server: { host: "127.0.0.1", strictPort: true },
  preview: { host: "127.0.0.1", strictPort: true },
});
