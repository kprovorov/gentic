#!/usr/bin/env node
// Stages the publishable npm package for the gentic worker CLI into
// dist/npm/, ready for `npm publish`. The `npm` job in
// .github/workflows/release.yml runs this after a release is cut; see
// packaging/npm/README.md for the full pipeline.
//
// Usage:
//   node scripts/build-npm-package.mjs [--out <dir>]
//
// Two things make this more than "copy dist/ and publish":
//
//  1. The CLI imports workspace packages (@gentic/validators) that are not
//     published to npm and whose `exports` even point at raw .ts sources, so
//     `tsc` output alone is unusable off the workspace. esbuild bundles those
//     into the single output file while leaving every real npm dependency
//     external, so users install normal, deduplicable packages.
//  2. The published manifest is generated, not the workspace one: it drops
//     `private`, drops workspace deps, and carries the registry name. The
//     workspace package stays private so nothing can publish it by accident.
//
// The ACP agent sidecars (@agentclientprotocol/*) stay external on purpose.
// src/session.ts spawns them as child processes, resolving them through
// `require.resolve` — which works precisely because npm installs them into a
// real node_modules. That is the same fallback path used when running from
// source, so npm installs need none of the vendored sidecar binaries that
// the compiled-binary builds (scripts/build-binary.sh) carry.

import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { build } from "esbuild"

/** Name the CLI is published under. `gentic` itself is taken by another package. */
const PACKAGE_NAME = "gentic-cli"
/** Oldest Node the published bundle is supported on. */
const NODE_ENGINE = ">=20.19.0"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const appDir = resolve(scriptDir, "..")
const repoRoot = resolve(appDir, "../..")

const args = process.argv.slice(2)
const outArg = args.includes("--out")
  ? args[args.indexOf("--out") + 1]
  : "dist/npm"
if (!outArg) {
  console.error("usage: build-npm-package.mjs [--out <dir>]")
  process.exit(1)
}
const outDir = resolve(appDir, outArg)

const manifest = JSON.parse(
  await readFile(join(appDir, "package.json"), "utf8")
)

// Workspace deps are bundled (they have no registry counterpart); everything
// else is a real npm package and must stay external so npm installs it.
const dependencies = Object.fromEntries(
  Object.entries(manifest.dependencies ?? {}).filter(
    ([, range]) => !range.startsWith("workspace:")
  )
)

await rm(outDir, { recursive: true, force: true })
await mkdir(join(outDir, "bin"), { recursive: true })

console.log(`==> Bundling gentic CLI -> ${outDir}/bin/gentic.js`)
await build({
  entryPoints: [join(appDir, "src/cli.ts")],
  outfile: join(outDir, "bin/gentic.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20.19",
  external: Object.keys(dependencies),
  // npm links bin entries as symlinks, so the file is executed directly and
  // needs its own shebang — the workspace's tsc build gets away without one
  // only because pnpm writes a `node`-invoking shell wrapper instead.
  banner: { js: "#!/usr/bin/env node" },
  logLevel: "info",
})
await chmod(join(outDir, "bin/gentic.js"), 0o755)

console.log("==> Writing package manifest and README")
await writeFile(
  join(outDir, "package.json"),
  JSON.stringify(
    {
      name: PACKAGE_NAME,
      version: manifest.version,
      description: manifest.description,
      keywords: ["gentic", "coding-agent", "claude-code", "codex", "acp"],
      homepage: "https://gentic.chat",
      repository: {
        type: "git",
        url: "git+https://github.com/kprovorov/gentic.git",
        directory: "apps/gentic",
      },
      bugs: { url: "https://github.com/kprovorov/gentic/issues" },
      license: "MIT",
      type: "module",
      bin: { gentic: "bin/gentic.js" },
      files: ["bin", "README.md"],
      engines: { node: NODE_ENGINE },
      dependencies,
      publishConfig: { access: "public" },
    },
    null,
    2
  ) + "\n"
)
await cp(
  join(repoRoot, "packaging/npm/package-readme.md"),
  join(outDir, "README.md")
)

console.log(`==> Done: ${outDir}`)
