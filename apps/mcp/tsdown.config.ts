import { defineConfig } from "tsdown";

export default defineConfig([
  // Local build used by `pnpm start` / `pnpm dev`.
  {
    entry: ["src/**/*", "!src/**/*.test.*"],
    format: ["cjs"],
    outExtensions: () => ({
      js: ".cjs"
    })
  },
  // Vercel function: one self-contained bundle with every dependency
  // inlined. Vercel's node builder runs api/ files as-is (no bundling,
  // ESM needs exact extensions), so the function file itself must not
  // import anything at runtime.
  {
    entry: { index: "src/index.ts" },
    outDir: "api",
    format: ["cjs"],
    platform: "node",
    noExternal: () => true,
    outExtensions: () => ({
      js: ".cjs"
    })
  }
]);
