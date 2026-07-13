import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// "Never a raw colour in a component" is rule one of the design system, and a
// rule nobody enforces is just a preference. Two things enforce it here:
//
//   1. The raw pigments in globals.css are deliberately kept OUT of Tailwind's
//      @theme, so no `bg-clay-500` utility is ever generated. The obvious escape
//      hatch does not exist.
//   2. This rule closes the other one — arbitrary values like `bg-[#b45024]`,
//      and inline style props.
//
// Both matter because five agents build five screens against this system, and
// one stray hex is how a design system starts to die.
const NO_RAW_COLOUR =
  "Raw colour. Use a semantic token — bg-primary, text-muted-foreground, " +
  "border-input. The pigments are intentionally unreachable from components; " +
  "see the three rules at /styleguide.";

// A Tailwind palette utility — bg-red-500, text-white, border-slate-800,
// bg-black/10. globals.css already tears the default palette out of @theme so
// these generate NO css, but a stray one should fail review, not merge and
// silently do nothing (or, worse, get "fixed" later by re-adding the palette).
// This is the fast feedback on top of the structural CSS reset.
//
// Matches `<utility>-<family>-<shade>` and the keyword colours white/black, with
// an optional `/opacity`. `family` is the Tailwind default palette, spelled out
// so semantic families (primary, muted, sidebar, …) never match.
const PALETTE_FAMILY =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|" +
  "teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITY_PREFIX =
  "bg|text|border|ring|fill|stroke|from|via|to|outline|divide|caret|accent|" +
  "decoration|shadow|ring-offset";
const PALETTE_UTILITY = new RegExp(
  `\\b(?:${UTILITY_PREFIX})-(?:(?:${PALETTE_FAMILY})-\\d{2,3}|white|black)(?:/\\d{1,3})?\\b`,
);
const NO_PALETTE_UTILITY =
  "Default Tailwind palette utility (e.g. bg-red-500, text-white). This is not " +
  "part of the design system — it generates no CSS and has no dark variant. Use " +
  "a semantic token. See /styleguide.";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,

  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          // #fff, #b45024, #b45024ff — in a className, a style prop, anywhere.
          selector:
            "Literal[value=/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/]",
          message: NO_RAW_COLOUR,
        },
        {
          // oklch(0.54 …), rgb(180 80 36), hsl(…). Requiring a digit after the
          // paren is what keeps `color-mix(in oklch, var(--secondary), …)` legal
          // — that names a colour SPACE and mixes two tokens, which is exactly
          // the right way to do it.
          selector:
            "Literal[value=/\\b(?:oklch|oklab|rgba?|hsla?)\\(\\s*[\\d.]/]",
          message: NO_RAW_COLOUR,
        },
        {
          selector:
            "TemplateElement[value.raw=/#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![0-9a-fA-F])/]",
          message: NO_RAW_COLOUR,
        },
        {
          selector: `Literal[value=/${PALETTE_UTILITY.source}/]`,
          message: NO_PALETTE_UTILITY,
        },
        {
          selector: `TemplateElement[value.raw=/${PALETTE_UTILITY.source}/]`,
          message: NO_PALETTE_UTILITY,
        },
      ],
    },
  },

  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
