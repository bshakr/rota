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
