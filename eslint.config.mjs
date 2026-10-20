import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    // Local Claude Code state, including agent worktrees (full repo copies).
    ".claude/**",
    // Separate packages with their own toolchain (Cloudflare Worker).
    "deploy/**",
    "frontend/contracts.d.ts", "frontend/model-types.d.ts", "frontend/app/**", "frontend/components/**", "frontend/lib/**", "frontend/public/**", "frontend/.next/**", "lib/views/generated/**",
  ]),
]);

export default eslintConfig;
