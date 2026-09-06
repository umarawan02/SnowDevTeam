import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // ServiceNow server-side scripts — authored against platform globals
    // (gs, GlideRecord, Class); linted by src/lib/nativeengine/lint.ts, not eslint.
    "src/lib/nativeengine/serverscript/**",
  ]),
]);

export default eslintConfig;
