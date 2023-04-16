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
        main: resolve("web", "noted", "index.html"),
        // test: resolve("web", "test.html"),
        // github_success: resolve("web", "github_success.html"),
      },

      output: {
        manualChunks: {
          cm: ["codemirror"],
          langjavascript: ["@codemirror/lang-javascript"],
          langhtml: ["@codemirror/lang-html"],
          langcss: ["@codemirror/lang-css"],
          langjava: ["@codemirror/lang-java"],
          langvue: ["@codemirror/lang-vue"],
          langmarkdown: ["@codemirror/lang-markdown"],
          langxml: ["@codemirror/lang-xml"],
          langjson: ["@codemirror/lang-json"],
          langsvelte: ["@replit/codemirror-lang-svelte"],

          langrust: ["@codemirror/lang-rust"],
          langsql: ["@codemirror/lang-sql"],
          langpython: ["@codemirror/lang-python"],
          langphp: ["@codemirror/lang-php"],
          langcpp: ["@codemirror/lang-cpp"],

          langlegacy: [
            "@codemirror/legacy-modes/mode/lua",
            "@codemirror/legacy-modes/mode/go",
            "@codemirror/legacy-modes/mode/diff",
            "@codemirror/legacy-modes/mode/css",
            "@codemirror/legacy-modes/mode/octave",
            "@codemirror/legacy-modes/mode/shell",
            "@codemirror/legacy-modes/mode/clike",
            "@codemirror/legacy-modes/mode/ruby",
          ],
          cmlangs: [
            // "@codemirror/lang-angular",
            // "@codemirror/lang-wast",
            "@codemirror/theme-one-dark",
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
