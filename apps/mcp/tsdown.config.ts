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
  // Payload for the Vercel function (api/index.cjs): one self-contained
  // bundle with every dependency inlined. Vercel's node builder runs api/
  // files as-is (no bundling, ESM needs exact extensions), so nothing the
  // function loads may need node_modules at runtime.
  {
    entry: { index: "src/index.ts" },
    outDir: "api/_bundle",
    format: ["cjs"],
    platform: "node",
    noExternal: () => true,
    outExtensions: () => ({
      js: ".cjs"
    })
  }
]);
