# npm packaging for the gentic host

The gentic host CLI is distributed on npm as
[`gentic-cli`](https://www.npmjs.com/package/gentic-cli), so users can
`npm install -g gentic-cli`. This directory owns the published README
([`package-readme.md`](./package-readme.md)); the package itself is staged by
[`apps/gentic/scripts/build-npm-package.mjs`](../../apps/gentic/scripts/build-npm-package.mjs).

The registry name is `gentic-cli` rather than `gentic` because `gentic` on
npm is an unrelated package owned by someone else. The binary it installs is
still `gentic`.

## How it works

The `npm` job in [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
runs after the GitHub Release is published and:

1. checks out the release commit (whose `apps/gentic/package.json` the
   `prepare` job already bumped to the release version),
2. runs `pnpm --filter @gentic/gentic build:npm`, which stages
   `apps/gentic/dist/npm/`, and
3. publishes that directory with `npm publish --provenance`, skipping the
   publish if that version is already on the registry.

The staged package is **not** the workspace package. `apps/gentic` stays
`private: true` so nothing can publish it by accident; the build script
generates a fresh manifest carrying the registry name, the bumped version,
and only the dependencies npm can actually install.

## Why the package is bundled

The CLI imports `@gentic/validators`, a workspace package that is not on npm
and whose `exports` point at raw `.ts` sources, so the plain `tsc` output does
not run outside this repo. The build script bundles the CLI with esbuild:
workspace packages are inlined into `bin/gentic.js`, every real npm
dependency stays external and is installed normally.

The ACP agent sidecars (`@agentclientprotocol/claude-agent-acp`,
`@agentclientprotocol/codex-acp`) must stay external: `apps/gentic/src/session.ts`
spawns them as child processes located with `require.resolve`, which works
because npm gives them a real `node_modules`. That is the same path a
from-source checkout takes, which is why an npm install needs none of the
vendored sidecar binaries that `scripts/build-binary.sh` compiles for the
standalone binaries, tarballs, and Linux packages. Those artifacts still ship
on every GitHub Release for machines without Node.

## One-time setup (required for the automation)

The `npm` job publishes through [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers):
npm trusts the GitHub Actions OIDC token for this repository, so no registry
token is stored anywhere and the account's 2FA policy is not involved.

1. The package must already exist on npm (Trusted Publishing cannot create
   it). The first version was published manually from a maintainer's machine.
2. On npmjs.com, open the `gentic-cli` package → **Settings** → **Trusted
   Publisher** and add a GitHub Actions publisher with:
   - Organization or user: `kprovorov`
   - Repository: `gentic`
   - Workflow filename: `release.yml`
   - Environment: `Production`

The `npm` job declares `environment: Production` and `id-token: write` to
match. `--provenance` is generated from the same OIDC token and additionally
needs a public repository. Trusted Publishing requires npm >= 11.5.1, so the
job upgrades npm before publishing.

## Building and publishing locally

```bash
pnpm install
pnpm --filter @gentic/gentic build:npm
npm pack --dry-run ./apps/gentic/dist/npm    # inspect the tarball contents
npm publish ./apps/gentic/dist/npm           # normally CI's job
```

To smoke-test the staged bundle without publishing:

```bash
node apps/gentic/dist/npm/bin/gentic.js --version
```
