// Vercel function entry. Must be committed — Vercel plans api/ functions
// from the git snapshot, so generated files can't be entrypoints. The
// bundle it requires is built by tsdown during `vercel build` and is
// fully self-contained (see tsdown.config.ts).
const mod = require("./_bundle/index.cjs")

module.exports = mod.default ?? mod
