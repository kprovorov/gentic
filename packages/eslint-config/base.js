import { defineConfig, globalIgnores } from "eslint/config"
import tseslint from "typescript-eslint"

const config = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores(["dist/**", "build/**", "coverage/**"]),
])

export default config
