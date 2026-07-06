// Vercel function entry. Must be committed (Vercel plans api/ functions
// from the source tree) and must be .js — .cjs files are not detected
// as functions. The bundle it imports is built by tsdown during
// `vercel build` and is fully self-contained (see tsdown.config.ts).
import mod from "./_bundle/index.cjs"

export default mod.default ?? mod
