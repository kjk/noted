import copy from "rollup-plugin-copy";
import { defineConfig } from "vite";
import { resolve } from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  root: "./web",
  build: {
    // emptyOutDir: true,
    sourcemap: true,
    outDir: resolve("dist"),
    chunkSizeWarningLimit: 600000,
    rollupOptions: {
      input: {
        main: resolve("web", "index.html"),
        // test: resolve("web", "test.html"),
        // github_success: resolve("web", "github_success.html"),
      },

      output: {
        manualChunks: {
          cm: [
            "codemirror",
            "@codemirror/legacy-modes/mode/lua",
            "@codemirror/legacy-modes/mode/go",
            "@codemirror/legacy-modes/mode/diff",
            "@codemirror/legacy-modes/mode/css",
            "@codemirror/legacy-modes/mode/octave",
            "@codemirror/legacy-modes/mode/shell",
            "@codemirror/legacy-modes/mode/clike",
            "@codemirror/legacy-modes/mode/ruby",
            // "@codemirror/lang-angular",
            // "@codemirror/lang-wast",
            "@codemirror/theme-one-dark",
            "@codemirror/lang-javascript",
            "@codemirror/lang-html",
            "@codemirror/lang-css",
            "@codemirror/lang-java",
            "@codemirror/lang-vue",
            "@codemirror/lang-markdown",
            "@codemirror/lang-xml",
            "@codemirror/lang-json",
            "@replit/codemirror-lang-svelte",

            "@codemirror/lang-rust",
            "@codemirror/lang-sql",
            "@codemirror/lang-python",
            "@codemirror/lang-php",
            "@codemirror/lang-cpp",
          ],
        },
      },
    },
  },
  server: {
    // must be same as proxyURLStr in runServerDev
    port: 3047,
  },
  plugins: [svelte()],
});
