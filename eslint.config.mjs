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
  ]),
  {
    // The newer eslint-plugin-react-hooks ships strict rules that flag
    // patterns this codebase uses on purpose:
    //
    //   set-state-in-effect — we hydrate from localStorage on mount,
    //     which is the recommended client-only React pattern.
    //   refs — we read .current inside JSX style attributes for
    //     intentional one-shot effects (drag tilt, etc.).
    //
    // We downgrade these to warnings rather than errors so genuine bugs
    // (purity, rules-of-hooks, exhaustive-deps) still fail the lint.
    rules: {
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/refs": "warn",
    },
  },
]);

export default eslintConfig;
