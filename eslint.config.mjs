import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

export default defineConfig([
  { ignores: ["main.js", "node_modules/**", "release/**", "tests/**", "styles/**", "*.mjs", "vitest.config.ts"] },
  ...obsidianmd.configs.recommended,
  {
    // The plugin's own name, Obsidian's SecretStorage and BYOK keep their casing; URLs are not sentences.
    rules: {
      "obsidianmd/ui/sentence-case": ["warn", {
        enforceCamelCaseLower: true,
        brands: [...DEFAULT_BRANDS, "Evidence Inbox", "SecretStorage"],
        acronyms: [...DEFAULT_ACRONYMS, "BYOK"],
        ignoreRegex: ["^https?://"]
      }]
    }
  },
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["eslint.config.*"]
        }
      }
    }
  }
]);
