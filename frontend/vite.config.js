import copy from "rollup-plugin-copy";
import { defineConfig } from "vite";
import { resolve } from "path";
import { svelte } from "@sveltejs/vite-plugin-svelte";

// https://vitejs.dev/config/
export default defineConfig({
  root: "./src",
  build: {
    // emptyOutDir: true,
    sourcemap: true,
    outDir: resolve("dist"),
    chunkSizeWarningLimit: 600000,
    rollupOptions: {
      input: {
        main: resolve("src", "index.html"),
        not_found: resolve("src", "404.html"),
        // test: resolve("src", "test.html"),
      },

      output: {
        manualChunks: {
          // TODO: why this generates 2 chunks?
          emoji: ["src/plugs/emoji/emoji.js", "src/plugs/emoji/emoji-opt.js"],
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
            "@codemirror/legacy-modes/mode/python",
            "@codemirror/legacy-modes/mode/javascript",
            "@codemirror/legacy-modes/mode/sql",
            "@codemirror/legacy-modes/mode/xml",
            "@codemirror/legacy-modes/mode/rust",
            "@codemirror/legacy-modes/mode/toml",
            "@codemirror/legacy-modes/mode/protobuf",
            "@codemirror/legacy-modes/mode/yaml",
            "@codemirror/legacy-modes/mode/simple-mode",
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
