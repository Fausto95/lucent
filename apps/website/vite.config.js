import { defineConfig } from "vite-plus";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin";
import lucent from "../../packages/lucent/package.json" with { type: "json" };
import { posts } from "./src/blog/posts.ts";
import { withPostMeta } from "./src/blog/meta.ts";

/**
 * Writes each blog post's page at its address, with the post's own meta tags:
 * link previews read them without running the app (Vercel serves a file
 * before its rewrite to index.html).
 */
const postPages = () => ({
  name: "lucent-post-pages",
  apply: "build",
  enforce: "post",
  generateBundle(_options, bundle) {
    const shell = bundle["index.html"];

    if (!shell || shell.type !== "asset") throw new Error("the build wrote no index.html");

    for (const post of posts) {
      this.emitFile({
        type: "asset",
        fileName: `blog/${post.slug}/index.html`,
        source: withPostMeta(String(shell.source), post),
      });
    }
  },
});

export default defineConfig({
  // The docs say which Lucent they were checked against (scripts/website.ts compiles their samples with it).
  define: { __LUCENT_VERSION__: JSON.stringify(lucent.version) },
  plugins: [stylex.vite({ useCSSLayers: { before: ["reset"] } }), react(), postPages()],
  server: { host: "127.0.0.1", strictPort: true },
  preview: { host: "127.0.0.1", strictPort: true },
});
