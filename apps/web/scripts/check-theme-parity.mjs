#!/usr/bin/env node
/**
 * Guards the two promises the design system makes, both of which are the kind
 * that rot silently:
 *
 *   1. THEME PARITY — every semantic token defined for light is redefined for
 *      dark. Miss one and it does not crash; it inherits the light value and you
 *      get, say, sand-coloured text on a cocoa background. Nobody notices until
 *      a user does.
 *
 *   2. CONTRAST — every foreground/background pairing still clears WCAG AA
 *      (4.5:1 for text, 3:1 for control borders and focus rings) in BOTH themes.
 *      "Warm and friendly" is one careless nudge away from "beige on beige", and
 *      the member page is read on a phone, outdoors, by someone in a hurry.
 *
 * Run by `npm run check:tokens`, and in CI. Reads globals.css as the source of
 * truth — no duplicated colour table to drift out of sync.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/app/globals.css",
);

// Paint is theme-independent by design: one pigment set, two mappings. These
// live only in :root and must NOT be redeclared under .dark.
const PAINT = /^--(bone|clay|sage|amber|rust|dusk)-/;
// Geometry, not colour. Same in both themes.
const THEME_AGNOSTIC = new Set(["--radius"]);

/** Text needs 4.5:1; a control boundary or focus ring needs 3:1 (WCAG 1.4.11). */
const PAIRS = [
  ...["--background", "--card", "--muted", "--popover"].flatMap((surface) => [
    { fg: "--foreground", bg: surface, min: 4.5 },
    { fg: "--muted-foreground", bg: surface, min: 4.5 },
    { fg: "--primary", bg: surface, min: 4.5 },
    { fg: "--success", bg: surface, min: 4.5 },
    { fg: "--warning", bg: surface, min: 4.5 },
    { fg: "--info", bg: surface, min: 4.5 },
    { fg: "--destructive", bg: surface, min: 4.5 },
    { fg: "--input", bg: surface, min: 3 },
    { fg: "--ring", bg: surface, min: 3 },
  ]),
  { fg: "--primary-foreground", bg: "--primary", min: 4.5 },
  { fg: "--success-foreground", bg: "--success", min: 4.5 },
  { fg: "--warning-foreground", bg: "--warning", min: 4.5 },
  { fg: "--info-foreground", bg: "--info", min: 4.5 },
  { fg: "--destructive-foreground", bg: "--destructive", min: 4.5 },
  { fg: "--secondary-foreground", bg: "--secondary", min: 4.5 },
  { fg: "--accent-foreground", bg: "--accent", min: 4.5 },
  { fg: "--sidebar-foreground", bg: "--sidebar", min: 4.5 },
  { fg: "--sidebar-primary-foreground", bg: "--sidebar-primary", min: 4.5 },
  { fg: "--foreground", bg: "--sidebar", min: 4.5 },
  { fg: "--muted-foreground", bg: "--sidebar", min: 4.5 },
];

/* --- parsing --------------------------------------------------------------- */

/** Collect `--x: value;` declarations from every block with the given selector. */
function declarationsFor(css, selector) {
  const out = {};
  const blocks = css.matchAll(
    new RegExp(`${selector}\\s*\\{([^}]*)\\}`, "g"),
  );
  for (const [, body] of blocks) {
    for (const [, prop, value] of body.matchAll(
      /(--[\w-]+)\s*:\s*([^;]+);/g,
    )) {
      out[prop] = value.trim();
    }
  }
  return out;
}

/** Follow `var(--x)` chains down to a literal colour. */
function resolve_(prop, scope, seen = new Set()) {
  const value = scope[prop];
  if (value === undefined) return undefined;
  if (seen.has(prop)) throw new Error(`Circular var(): ${prop}`);
  seen.add(prop);

  const ref = value.match(/^var\((--[\w-]+)\)$/);
  return ref ? resolve_(ref[1], scope, seen) : value;
}

/* --- colour ---------------------------------------------------------------- */

function parseOklch(value) {
  const m = value.match(
    /oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.%]+)\s*)?\)/,
  );
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function oklchToSrgb([L, C, Hdeg]) {
  const h = (Hdeg * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);

  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;

  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];

  // Gamma-encode and clamp: a channel outside sRGB is what the screen will
  // actually show, so luminance must be measured after clipping, not before.
  return linear.map((x) => {
    const v =
      x <= 0.0031308 ? 12.92 * x : 1.055 * Math.max(x, 0) ** (1 / 2.4) - 0.055;
    return Math.min(1, Math.max(0, v));
  });
}

function luminance(oklch) {
  const [r, g, b] = oklchToSrgb(oklch).map((v) =>
    v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* --- checks ---------------------------------------------------------------- */

const css = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

const root = declarationsFor(css, ":root");
const darkOverrides = declarationsFor(css, "\\.dark");

// .dark only overrides; anything it omits inherits from :root. Modelling that
// cascade is the point — it is exactly how a missing token goes unnoticed.
const light = root;
const dark = { ...root, ...darkOverrides };

const failures = [];

// 1. Parity.
const semantic = Object.keys(root).filter(
  (p) => !PAINT.test(p) && !THEME_AGNOSTIC.has(p),
);
for (const prop of semantic) {
  if (!(prop in darkOverrides)) {
    failures.push(
      `parity: ${prop} is defined for light but never redefined under .dark — ` +
        `it will inherit the light value.`,
    );
  }
}
for (const prop of Object.keys(darkOverrides)) {
  if (!(prop in root)) {
    failures.push(
      `parity: ${prop} exists only under .dark. Typo, or a token light forgot?`,
    );
  }
  if (PAINT.test(prop)) {
    failures.push(
      `parity: ${prop} is paint and must not be redeclared under .dark — ` +
        `remap the semantic token instead.`,
    );
  }
}

// 2. Contrast, in both themes.
for (const [themeName, scope] of [
  ["light", light],
  ["dark", dark],
]) {
  for (const { fg, bg, min } of PAIRS) {
    const fgRaw = resolve_(fg, scope);
    const bgRaw = resolve_(bg, scope);

    if (fgRaw === undefined || bgRaw === undefined) {
      failures.push(
        `contrast: ${themeName} — ${fgRaw === undefined ? fg : bg} is not defined.`,
      );
      continue;
    }

    const fgColor = parseOklch(fgRaw);
    const bgColor = parseOklch(bgRaw);
    if (!fgColor || !bgColor) {
      failures.push(
        `contrast: ${themeName} — ${fg} on ${bg} is not a plain oklch() value, ` +
          `so it cannot be checked. Keep tokens as literal oklch().`,
      );
      continue;
    }

    const ratio = contrast(fgColor, bgColor);
    if (ratio < min) {
      failures.push(
        `contrast: ${themeName} — ${fg} on ${bg} is ${ratio.toFixed(2)}:1, ` +
          `below the required ${min}:1.`,
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`\n✗ ${failures.length} design-token problem(s):\n`);
  for (const f of failures) console.error(`  • ${f}`);
  console.error("\nSee the three rules at /styleguide.\n");
  process.exit(1);
}

console.log(
  `✓ ${semantic.length} semantic tokens defined in both themes; ` +
    `${PAIRS.length * 2} contrast pairs meet WCAG AA.`,
);
