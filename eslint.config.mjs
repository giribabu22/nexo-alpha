// Lint rules that catch bugs, not style (formatting is left to editors).
// Run with `pnpm lint`.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";

export default tseslint.config(
  {
    // fixtures/ holds sample code that tests scan as-is (e.g. a deliberate `let`).
    ignores: ["**/dist/**", "**/node_modules/**", "**/.turbo/**", "**/.nexo/**", "**/fixtures/**", "packages/create-nexo-app/test-app/**"]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser }
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      // Hooks called conditionally break React at runtime.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Unused code; prefix with "_" to mark something unused on purpose.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", destructuredArrayIgnorePattern: "^_", caughtErrors: "none" }
      ],
      // The codebase uses `any` at a few framework boundaries on purpose.
      "@typescript-eslint/no-explicit-any": "off"
    }
  },
  {
    // Tests: node:test files and fixtures.
    files: ["**/test/**/*.{js,mjs}", "**/type-tests/**"],
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-unused-expressions": "off",
      // Expected CLI table output is matched with literal runs of spaces.
      "no-regex-spaces": "off"
    }
  },
  {
    // nexoComp({ render }) calls `render` as the component body, so hooks there
    // are valid; the rule cannot tell, because the function is named "render".
    // Do not combine hooks with `dsa.lruCache`, which can skip `render`.
    files: [
      "packages/frontend/src/components/NexoCard.tsx",
      "packages/frontend/src/components/NexoKnowledgeInspector.tsx",
      "packages/frontend/src/components/NexoMemoryBrowser.tsx",
      "packages/frontend/src/components/NexoMetricsDashboard.tsx",
      "packages/frontend/src/components/NexoProjectSwitcher.tsx",
      "packages/frontend/src/components/NexoServerStatus.tsx",
      "packages/frontend/src/components/NexoTabs.tsx",
      "packages/frontend/src/components/NexoTerminal.tsx",
      "packages/frontend/src/components/NexoWorkflowCatalog.tsx",
      "packages/frontend/src/components/NexoWorkflowRuns.tsx",
      "examples/fullstack-react/src/components/NexoStudio.tsx"
    ],
    rules: { "react-hooks/rules-of-hooks": "off" }
  }
);
