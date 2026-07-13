#!/usr/bin/env node
/**
 * Guards the promises the design system makes, all of which rot silently:
 *
 *   1. THEME PARITY — every semantic token defined for light is redefined for
 *      dark. Miss one and it inherits the light value: sand text on cocoa.
 *
 *   2. CONTRAST — every foreground/background pairing meets WCAG AA (4.5:1 text,
 *      3:1 control borders and focus rings) in BOTH themes, with TRANSLUCENT
 *      fills composited over their real backdrop first. A tinted `success/10`
 *      badge, a `/50` focus ring, an offset outline — their on-screen contrast
 *      depends on what is behind them, and measuring the opaque colour instead
 *      is how the first version of this checker printed a green tick for a focus
 *      ring that rendered at 2:1.
 *
 * Two deliberate choices, both learned the hard way:
 *
 *   - The stylesheet is parsed with POSTCSS, walking the real node tree, never
 *     regex. A regex `:root\{([^}]*)\}` folds a `:root` nested inside
 *     `@media (prefers-color-scheme: dark)` into the light scope and truncates
 *     at the first nested `}`. Tailwind v4 stylesheets have both. Only an actual
 *     parser gets the cascade right.
 *
 *   - Translucent values are COMPOSITED, not ignored and not rejected. A focus
 *     ring is legitimately drawn at partial opacity; the question is what it
 *     looks like over its backdrop, which is answerable, so we answer it.
 *
 * Run by `npm run check:tokens`, and in CI.
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postcss from "postcss";

const CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/app/globals.css",
);

// Paint is theme-independent by design: one pigment set, two mappings. Paint
// lives only in :root and must NOT be redeclared under .dark.
const PAINT = /^--(bone|clay|sage|amber|rust|dusk)-/;
// Not colour — geometry, type, spacing. Skipped by both parity and contrast.
const NON_COLOUR = /^--(font|text|radius|shadow|elevation|space)/;

const TEXT = 4.5; // WCAG AA, normal text
const UI = 3.0; //   WCAG AA, control boundaries and focus indicators

/* --- parse (postcss AST, never regex) -------------------------------------- */

/**
 * Custom-property declarations from every TOP-LEVEL rule matching the selector.
 * `rule.parent.type === "root"` is what keeps a `:root` nested inside an at-rule
 * (e.g. a `@media (prefers-color-scheme: dark)` block) out of the base scope.
 */
function declarationsForSelector(root, selectorTest) {
  const out = {};
  root.walkRules((rule) => {
    if (rule.parent.type !== "root") return;
    if (!rule.selectors.map((s) => s.trim()).some(selectorTest)) return;
    rule.walkDecls((decl) => {
      if (decl.prop.startsWith("--")) out[decl.prop] = decl.value.trim();
    });
  });
  return out;
}

/** Follow `var(--x)` chains to a literal value. */
function deref(prop, scope, seen = new Set()) {
  const value = scope[prop];
  if (value === undefined) return undefined;
  if (seen.has(prop)) throw new Error(`Circular var(): ${prop}`);
  seen.add(prop);
  const ref = value.match(/^var\(\s*(--[\w-]+)\s*\)$/);
  return ref ? deref(ref[1], scope, seen) : value;
}

/* --- colour ---------------------------------------------------------------- */

/** oklch(L C H) or oklch(L C H / A). Returns {L,C,H,alpha} or null. */
function parseOklch(value) {
  const m = value.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+%?)\s*)?\)$/,
  );
  if (!m) return null;
  const num = (s) => (s.endsWith("%") ? Number(s.slice(0, -1)) / 100 : Number(s));
  return {
    L: num(m[1]),
    C: Number(m[2]),
    H: Number(m[3]),
    alpha: m[4] === undefined ? 1 : num(m[4]),
  };
}

/** oklch -> clamped linear sRGB [r,g,b] in 0..1. */
function oklchToLinear({ L, C, H }) {
  const h = (H * Math.PI) / 180;
  const a = C * Math.cos(h);
  const b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ].map((x) => Math.min(1, Math.max(0, x)));
}

const encodeGamma = (c) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const decodeGamma = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;

/**
 * `src` (possibly translucent) composited over an already-linear OPAQUE dst,
 * returned as linear sRGB. The blend happens in GAMMA-ENCODED sRGB, not linear,
 * because that is what a browser actually does: CSS alpha compositing is defined
 * in the non-linear display space. The canonical proof is `rgba(0,0,0,.5)` over
 * white rendering `#808080` — the gamma midpoint — not the linear `#bcbcbc`.
 * Blending in linear light was the first rewrite's bug: it over-reported a
 * dark-text-on-light-tint pair and green-ticked two sub-AA status badges, the
 * exact false-pass this file exists to catch.
 */
function over(src, dstLinear) {
  const s = oklchToLinear(src).map(encodeGamma);
  const d = dstLinear.map(encodeGamma);
  const a = src.alpha;
  return [0, 1, 2].map((k) => decodeGamma(s[k] * a + d[k] * (1 - a)));
}

function relLuminance(lin) {
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}

function contrast(linA, linB) {
  const [hi, lo] = [relLuminance(linA), relLuminance(linB)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* --- token resolution ------------------------------------------------------ */

/** "--success 0.10" resolves the token then forces alpha to 0.10. */
function resolveToken(spec, scope) {
  const [name, alphaOverride] = spec.split(/\s+/);
  const raw = deref(name, scope);
  if (raw === undefined) return { error: `${name} is not defined` };
  const parsed = parseOklch(raw);
  if (!parsed) return { error: `${name} is \`${raw}\`, not a literal oklch()` };
  if (alphaOverride !== undefined) parsed.alpha = Number(alphaOverride);
  return { parsed };
}

/** A background stack [nearest … opaqueBase] -> one opaque linear colour. */
function flattenBackground(stack, scope) {
  const specs = Array.isArray(stack) ? stack : [stack];
  const layers = [];
  for (const spec of specs) {
    const r = resolveToken(spec, scope);
    if (r.error) return r;
    layers.push(r.parsed);
  }
  const base = layers[layers.length - 1];
  if (base.alpha !== 1) return { error: `background base ${specs.at(-1)} must be opaque` };
  let lin = oklchToLinear(base);
  for (let i = layers.length - 2; i >= 0; i--) lin = over(layers[i], lin);
  return { linear: lin };
}

/* --- pair spec ------------------------------------------------------------- */
//
// bg is a token, or a stack [nearest … opaqueBase]. "--x 0.10" forces alpha.
// kind "sep" pairs are surface-separation checks: reported, never gated, because
// this system separates surfaces with border and shadow, not a garish lightness
// gap.

const surfaces = ["--background", "--card", "--muted"];

const PAIRS = [
  ...surfaces.flatMap((bg) => [
    { fg: "--foreground", bg, min: TEXT },
    { fg: "--muted-foreground", bg, min: TEXT },
    { fg: "--primary", bg, min: TEXT, note: "primary as link/icon" },
  ]),

  // Solid fills: foreground on its own fill.
  { fg: "--primary-foreground", bg: "--primary", min: TEXT },
  { fg: "--secondary-foreground", bg: "--secondary", min: TEXT },
  { fg: "--accent-foreground", bg: "--accent", min: TEXT },
  // success/warning/info are tint-only in the settled idiom, so they have no
  // solid foreground to check. Only the destructive button is solid.
  { fg: "--destructive-foreground", bg: "--destructive", min: TEXT, note: "destructive button" },

  // Tinted status badges: text-STATUS over STATUS@10% over the surface. The pair
  // the first checker never modelled. The Alert's description is a TRANSLUCENT
  // foreground (text-STATUS/90) over that tint — strictly lower, and it composites
  // the foreground too.
  ...["--success", "--warning", "--info", "--destructive"].flatMap((s) => [
    { fg: s, bg: [`${s} 0.10`, "--card"], min: TEXT, note: "tinted badge on card" },
    { fg: s, bg: [`${s} 0.10`, "--background"], min: TEXT, note: "tinted badge on page" },
    { fg: `${s} 0.90`, bg: [`${s} 0.10`, "--card"], min: TEXT, note: "alert description on card" },
  ]),

  // Control borders — real UI boundary.
  ...surfaces.map((bg) => ({ fg: "--input", bg, min: UI, note: "input border" })),

  // Focus outline, measured against the surface its offset gap exposes.
  { fg: "--ring", bg: "--background", min: UI, note: "focus on page" },
  { fg: "--ring", bg: "--card", min: UI, note: "focus on card" },
  { fg: "--sidebar-ring", bg: "--sidebar", min: UI, note: "focus on sidebar" },

  // Sidebar.
  { fg: "--sidebar-foreground", bg: "--sidebar", min: TEXT },
  { fg: "--muted-foreground", bg: "--sidebar", min: TEXT, note: "sidebar meta" },
  { fg: "--sidebar-primary-foreground", bg: "--sidebar-primary", min: TEXT, note: "active nav item" },

  // Surface separation — informational only.
  { fg: "--card", bg: "--background", kind: "sep" },
  { fg: "--popover", bg: "--background", kind: "sep" },
  { fg: "--muted", bg: "--card", kind: "sep" },
  { fg: "--sidebar", bg: "--background", kind: "sep" },
];

/* --- run ------------------------------------------------------------------- */

const root = postcss.parse(readFileSync(CSS_PATH, "utf8"));
const lightDecls = declarationsForSelector(root, (s) => s === ":root");
const darkDecls = declarationsForSelector(root, (s) => s === ".dark");

const light = lightDecls;
const dark = { ...lightDecls, ...darkDecls }; // .dark overrides; rest cascades.

const failures = [];
const info = [];

// 1. Parity.
const semantic = Object.keys(lightDecls).filter(
  (p) => !PAINT.test(p) && !NON_COLOUR.test(p) && p !== "--radius",
);
for (const prop of semantic) {
  if (!(prop in darkDecls)) {
    failures.push(
      `parity: ${prop} is defined for light but never redefined under .dark — it inherits the light value.`,
    );
  }
}
for (const prop of Object.keys(darkDecls)) {
  if (NON_COLOUR.test(prop) || prop === "--radius") continue;
  if (!(prop in lightDecls)) {
    failures.push(`parity: ${prop} exists only under .dark. Typo, or a token light forgot?`);
  }
  if (PAINT.test(prop)) {
    failures.push(`parity: ${prop} is paint and must not be redeclared under .dark.`);
  }
}

// 2. Contrast, both themes.
let checked = 0;
for (const [themeName, scope] of [
  ["light", light],
  ["dark", dark],
]) {
  for (const pair of PAIRS) {
    const bg = flattenBackground(pair.bg, scope);
    if (bg.error) {
      failures.push(`contrast: ${themeName} — ${bg.error}.`);
      continue;
    }
    const fg = resolveToken(pair.fg, scope);
    if (fg.error) {
      failures.push(`contrast: ${themeName} — foreground ${fg.error}.`);
      continue;
    }
    // A translucent foreground (e.g. a /50 ring) composites over its backdrop.
    const fgLinear =
      fg.parsed.alpha === 1 ? oklchToLinear(fg.parsed) : over(fg.parsed, bg.linear);

    const ratio = contrast(fgLinear, bg.linear);
    const bgLabel = Array.isArray(pair.bg) ? pair.bg.join(" / ") : pair.bg;
    const label = `${pair.fg} on ${bgLabel}${pair.note ? ` (${pair.note})` : ""}`;

    if (pair.kind === "sep") {
      info.push(`  ${themeName}: ${label} — ${ratio.toFixed(2)}:1`);
      continue;
    }
    checked++;
    if (ratio < pair.min) {
      failures.push(
        `contrast: ${themeName} — ${label} is ${ratio.toFixed(2)}:1, below the required ${pair.min}:1.`,
      );
    }
  }
}

if (info.length) {
  console.log("Surface separation (carried by border + shadow, not gated):");
  for (const line of info) console.log(line);
  console.log("");
}

if (failures.length > 0) {
  console.error(`✗ ${failures.length} design-token problem(s):\n`);
  for (const f of failures) console.error(`  • ${f}`);
  console.error("\nSee the three rules at /styleguide.\n");
  process.exit(1);
}

console.log(
  `✓ ${semantic.length} semantic tokens defined in both themes; ` +
    `${checked} contrast pairs meet WCAG AA (translucent fills composited over their backdrop).`,
);
