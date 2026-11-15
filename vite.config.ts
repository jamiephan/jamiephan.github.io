import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

// https://viteplus.dev/config/
export default defineConfig({
  plugins: lazyPlugins(() => [react()]),

  build: {
    target: "baseline-widely-available",
    // three.js is lazy-loaded in its own chunk and is legitimately large.
    chunkSizeWarningLimit: 800,
  },

  test: {
    include: ["src/**/*.test.{ts,tsx}"],
  },

  fmt: {
    ignorePatterns: ["dist/**", "dist-ssr/**", "pnpm-lock.yaml"],
  },

  lint: {
    ignorePatterns: ["dist/**", "dist-ssr/**"],
    plugins: ["react", "typescript", "oxc", "jsx-a11y"],
    rules: {
      "react/rules-of-hooks": "error",
      "react/only-export-components": ["warn", { allowConstantExport: true }],
      "vite-plus/prefer-vite-plus-imports": "error",
    },
    options: {
      typeAware: true,
      typeCheck: true,
    },
    jsPlugins: [
      {
        name: "vite-plus",
        specifier: "vite-plus/oxlint-plugin",
      },
    ],
  },
});
