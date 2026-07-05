import { defineConfig } from "tsdown"

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  target: "node24",
  outDir: "dist",
  // Bundle the workspace packages (they export raw ./src/*.ts) into the output.
  // Third-party deps stay external and are resolved from node_modules at runtime.
  deps: {
    alwaysBundle: [/^@gentic\//],
  },
})
