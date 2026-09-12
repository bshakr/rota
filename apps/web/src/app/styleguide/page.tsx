import type { Metadata } from "next";
import Link from "next/link";

import { Gallery } from "@/app/styleguide/_components/gallery";
import {
  Demo,
  PaintFamily,
  Registers,
  Section,
  Swatch,
  SwatchGrid,
  type Pigment,
} from "@/app/styleguide/_components/spec";
import { Container } from "@/components/container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Styleguide" };

/* -------------------------------------------------------------------------- */
/* PAINT. Values are transcribed from globals.css, which is the source of truth. */
/*                                                                             */
/* The "never a raw colour" lint rule is switched off for this block alone, and */
/* nowhere else in the app. Rule one forbids a raw colour used AS a colour; a   */
/* styleguide that documents the pigment set has to print the pigments, and a   */
/* swatch page with the values redacted would be useless. The chips themselves  */
/* still paint from var(--token), so nothing here hard-codes a colour into the  */
/* rendered UI.                                                                 */
/* -------------------------------------------------------------------------- */
/* eslint-disable no-restricted-syntax */

const LAVENDER: readonly Pigment[] = [
  {
    token: "--lavender-50",
    value: "oklch(1 0 0)",
    hex: "#FFFFFF",
    role: "Cards, popovers, the admin sidebar panel.",
  },
  {
    token: "--lavender-100",
    value: "oklch(0.965 0.019 299)",
    hex: "#F5F1FF",
    role: "The page. Paper with a violet cast, never white.",
  },
  {
    token: "--lavender-200",
    value: "oklch(0.942 0.031 296)",
    hex: "#EDE8FF",
    role: "The quiet fill: recessed panels, table headers, skeletons.",
  },
  {
    token: "--lavender-300",
    value: "oklch(0.929 0.038 296)",
    hex: "#E9E3FF",
    role: "The hero pane, behind the landing and dashboard blobs.",
  },
];

const PLUM: readonly Pigment[] = [
  {
    token: "--plum-50",
    value: "oklch(0.96 0.015 300)",
    role: "Night text.",
  },
  {
    token: "--plum-200",
    value: "oklch(0.8 0.03 300)",
    role: "Night muted text.",
  },
  {
    token: "--plum-400",
    value: "oklch(0.52 0.066 301)",
    hex: "#6F6089",
    role: "Day muted text. 5.1:1 on the page.",
  },
  {
    token: "--plum-500",
    value: "oklch(0.62 0.05 300)",
    role: "Night control boundary.",
  },
  {
    token: "--plum-600",
    value: "oklch(0.38 0.05 300)",
    role: "Night hairline.",
  },
  {
    token: "--plum-700",
    value: "oklch(0.34 0.05 300)",
    role: "Night quiet fill.",
  },
  {
    token: "--plum-800",
    value: "oklch(0.3 0.074 300)",
    hex: "#34244D",
    role: "The ink. 12.6:1 on the page, and the text on every sticker.",
  },
  {
    token: "--plum-850",
    value: "oklch(0.29 0.055 300)",
    role: "Night card and sidebar panel.",
  },
  {
    token: "--plum-900",
    value: "oklch(0.235 0.055 300)",
    role: "Night page.",
  },
];

const GRAPE: readonly Pigment[] = [
  {
    token: "--grape-300",
    value: "oklch(0.8 0.12 290)",
    role: "The lifted cut. Links, icons and the focus ring at night.",
  },
  {
    token: "--grape-500",
    value: "oklch(0.48 0.216 290)",
    hex: "#6334CB",
    role: "The primary fill, identical in both registers. White on it is 7.3:1.",
  },
  {
    token: "--grape-600",
    value: "oklch(0.42 0.2 290)",
    hex: "#5325AF",
    role: "Pressed, and the focus ring by day.",
  },
];

const LILAC: readonly Pigment[] = [
  {
    token: "--lilac-100",
    value: "oklch(0.945 0.03 296)",
    role: "The hover blush. A hovered row glows faintly grape.",
  },
  {
    token: "--lilac-200",
    value: "oklch(0.9 0.055 296)",
    hex: "#E0D7FF",
    role: "The secondary button fill, and the quiet day coin.",
  },
  {
    token: "--lilac-300",
    value: "oklch(0.86 0.08 296)",
    role: "The deeper chip, for a roster item that needs an edge.",
  },
  {
    token: "--lilac-night",
    value: "oklch(0.36 0.07 295)",
    role: "The secondary fill after dark.",
  },
  {
    token: "--lilac-night-hover",
    value: "oklch(0.32 0.06 295)",
    role: "The hover blush after dark.",
  },
];

const MINT: readonly Pigment[] = [
  {
    token: "--mint-300",
    value: "oklch(0.9 0.075 160)",
    hex: "#B3EECD",
    role: "Done. A delivered text, a turn taken.",
  },
  {
    token: "--mint-500",
    value: "oklch(0.72 0.13 160)",
    role: "The deeper cut, for chart series two.",
  },
];

const PEACH: readonly Pigment[] = [
  {
    token: "--peach-300",
    value: "oklch(0.9 0.07 60)",
    hex: "#FFD2AF",
    role: "Warmth, and the date coin on today's shift.",
  },
  {
    token: "--peach-400",
    value: "oklch(0.855 0.095 58)",
    hex: "#FFC091",
    role: "Deep peach, for the empty state coin.",
  },
  {
    token: "--peach-500",
    value: "oklch(0.74 0.13 58)",
    role: "The deeper cut, for chart series three.",
  },
];

const LEMON: readonly Pigment[] = [
  {
    token: "--lemon-300",
    value: "oklch(0.9 0.085 95)",
    hex: "#F9E8A7",
    role: "Now. Warnings, and tomorrow's day coin.",
  },
  {
    token: "--lemon-500",
    value: "oklch(0.76 0.13 95)",
    role: "The deeper cut.",
  },
];

const SKY: readonly Pigment[] = [
  {
    token: "--sky-300",
    value: "oklch(0.9 0.06 234)",
    hex: "#B8E5FF",
    role: "On its way. A queued text, a shift someone is covering.",
  },
  {
    token: "--sky-500",
    value: "oklch(0.7 0.12 234)",
    role: "The deeper cut, for chart series four.",
  },
];

const BLUSH: readonly Pigment[] = [
  {
    token: "--blush-300",
    value: "oklch(0.9 0.06 354)",
    hex: "#FFCEE0",
    role: "Went wrong. The sticker on a failed text.",
  },
  {
    token: "--blush-400",
    value: "oklch(0.78 0.2 15)",
    role: "The real destructive button after dark. Pulled to red, hue 15.",
  },
  {
    token: "--blush-500",
    value: "oklch(0.7 0.15 354)",
    role: "The deeper cut, for chart series five.",
  },
  {
    token: "--blush-600",
    value: "oklch(0.55 0.2 15)",
    role: "The real destructive button by day.",
  },
];

/* eslint-enable no-restricted-syntax */

/* -------------------------------------------------------------------------- */
/* SEMANTIC.                                                                   */
/* -------------------------------------------------------------------------- */

const SURFACES = [
  {
    swatchClass: "bg-background",
    token: "--background",
    util: "bg-background",
    role: "The page. Lavender paper by day, deep plum at night.",
  },
  {
    swatchClass: "bg-card",
    token: "--card",
    util: "bg-card",
    role: "Anything that lifts off the page. Lighter than the page in both registers.",
  },
  {
    swatchClass: "bg-popover",
    token: "--popover",
    util: "bg-popover",
    role: "Floating surfaces: dialog, sheet, dropdown, popover.",
  },
  {
    swatchClass: "bg-muted",
    token: "--muted",
    util: "bg-muted",
    role: "The quiet fill. A recessed panel, a table header, a skeleton.",
  },
  {
    swatchClass: "bg-sidebar",
    token: "--sidebar",
    util: "bg-sidebar",
    role: "The admin sidebar. A white clay panel, so the chrome stays in the paper family.",
  },
  {
    swatchClass: "bg-accent",
    token: "--accent",
    util: "bg-accent",
    role: "Not the brand colour. This is the hover tint, and it blushes lilac instead of going grey.",
  },
];

const CONTENT = [
  {
    swatchClass: "bg-foreground",
    token: "--foreground",
    util: "text-foreground",
    role: "Body text. Plum ink, never black and never slate.",
  },
  {
    swatchClass: "bg-muted-foreground",
    token: "--muted-foreground",
    util: "text-muted-foreground",
    role: "Secondary text. Still clears 4.5:1 on every surface above.",
  },
];

const ACTION = [
  {
    swatchClass: "bg-primary",
    token: "--primary",
    util: "bg-primary",
    role: "Grape. The one action colour, as a FILL. Identical in both registers.",
  },
  {
    swatchClass: "bg-primary-foreground",
    token: "--primary-foreground",
    util: "text-primary-foreground",
    role: "The label on grape. White, at 7.3:1.",
  },
  {
    swatchClass: "bg-link",
    token: "--link",
    util: "text-link",
    role: "The same colour doing a TEXT job, so it lifts at night. Reach for this on links and icons, never text-primary.",
  },
  {
    swatchClass: "bg-secondary",
    token: "--secondary",
    util: "bg-secondary",
    role: "The lilac fill under a secondary button, so Cancel reads friendly rather than administrative.",
  },
  {
    swatchClass: "bg-secondary-foreground",
    token: "--secondary-foreground",
    util: "text-secondary-foreground",
    role: "Plum ink on the lilac fill.",
  },
  {
    swatchClass: "bg-ring",
    token: "--ring",
    util: "outline-ring",
    role: "Focus, with its own colour. A deeper grape by day, the lifted cut at night, always drawn as an offset outline.",
  },
];

const STICKERS = [
  {
    swatchClass: "bg-success",
    token: "--success",
    util: "bg-success text-success-foreground",
    role: "Mint. Done: a text delivered, a turn taken.",
  },
  {
    swatchClass: "bg-warning",
    token: "--warning",
    util: "bg-warning text-warning-foreground",
    role: "Lemon. Now: attention, a shift due tomorrow, a schedule that needs confirming.",
  },
  {
    swatchClass: "bg-info",
    token: "--info",
    util: "bg-info text-info-foreground",
    role: "Sky. On its way: queued, sending, covering someone else's turn.",
  },
  {
    swatchClass: "bg-danger",
    token: "--danger",
    util: "bg-danger text-danger-foreground",
    role: "Blush. Went wrong: a carrier failure. It whispers, and it is not a button.",
  },
  {
    swatchClass: "bg-destructive",
    token: "--destructive",
    util: "bg-destructive text-destructive-foreground",
    role: "The real destructive BUTTON, which is a different job from the blush sticker. Saturated, because it has to shout.",
  },
];

const LINES = [
  {
    swatchClass: "bg-border",
    token: "--border",
    util: "border-border",
    role: "A decorative hairline: card edges, separators, table rules. Plum at 12%, so it tints rather than draws.",
  },
  {
    swatchClass: "bg-input",
    token: "--input",
    util: "border-input",
    role: "A real control boundary on a form field, carried at plum 55% because WCAG wants 3:1 here.",
  },
  {
    swatchClass: "bg-overlay",
    token: "--overlay",
    util: "bg-overlay",
    role: "The wash behind a modal. Plum ink at 55% by day, a heavier night wash after dark.",
  },
];

/* -------------------------------------------------------------------------- */

const RADII = [
  { cls: "rounded-sm", label: "sm · 6px", use: "the smallest garnish" },
  { cls: "rounded-md", label: "md · 9px", use: "a chip nested inside a control" },
  { cls: "rounded-lg", label: "lg · 12px, --radius", use: "the base step" },
  { cls: "rounded-xl", label: "xl · 18px", use: "date coins, empty state coins" },
  { cls: "rounded-2xl", label: "2xl · 24px", use: "cards" },
  {
    cls: "rounded-3xl",
    label: "3xl · 28px",
    use: "dialogs, sheets, popovers, dropdowns, panes",
  },
  {
    cls: "rounded-4xl",
    label: "4xl · 32px",
    use: "the admin sidebar panel and the hero band",
  },
  {
    cls: "rounded-full",
    label: "full",
    use: "every control, plus avatars and dots",
  },
];

/* The clay recipes, transcribed verbatim from the light register so the page can
   show the actual shadow rather than a paraphrase of it. Same lint exception,
   same reason: these are documentation, not a style being applied. */
/* eslint-disable no-restricted-syntax */
const CLAY = [
  {
    cls: "shadow-xs",
    label: "xs · soft",
    use: "chips, coins, the things that barely lift",
    recipe:
      "inset 0 1px 0 rgb(255 255 255 / 0.9), inset 0 -3px 0 rgb(52 36 77 / 0.08)",
  },
  {
    cls: "shadow-sm",
    label: "sm · card",
    use: "cards, list rows, toasts",
    recipe:
      "inset 0 2px 0 rgb(255 255 255 / 0.95), inset 0 -5px 0 rgb(52 36 77 / 0.07), 0 22px 34px -22px rgb(52 36 77 / 0.38), 0 2px 6px -3px rgb(52 36 77 / 0.08)",
  },
  {
    cls: "shadow-md",
    label: "md · lift",
    use: "dialogs, popovers, a card under the cursor",
    recipe:
      "inset 0 2px 0 rgb(255 255 255 / 0.95), inset 0 -6px 0 rgb(52 36 77 / 0.06), 0 30px 48px -26px rgb(52 36 77 / 0.4), 0 4px 10px -4px rgb(52 36 77 / 0.08)",
  },
];
/* eslint-enable no-restricted-syntax */

const CLAY_EXTRAS = [
  {
    cls: "shadow-lg",
    label: "lg",
    use: "the biggest panels. Lift, with the drop carried to half alpha.",
  },
  {
    cls: "shadow-grape",
    label: "grape",
    use: "the primary button, and nothing else. The highlight and squash are drawn inside the grape fill and the drop is grape too, so the button looks pressed out of the material it sits on.",
  },
];

const TYPE_SCALE = [
  {
    cls: "text-display",
    label: "text-display · 2.75rem / 1.05 / -0.02em",
    use: "the member greeting and the landing headline, in Fredoka",
  },
  { cls: "text-2xl", label: "text-2xl", use: "a page title" },
  { cls: "text-lg", label: "text-lg", use: "a card title" },
  { cls: "text-base", label: "text-base", use: "body copy on a phone" },
  { cls: "text-sm", label: "text-sm", use: "the admin workhorse size" },
  { cls: "text-xs", label: "text-xs", use: "table meta, hints, timestamps" },
];

const SPACING = [
  {
    name: "Page gutter",
    value: "px-5 md:px-8",
    use: "every screen's left and right edge. Use <Container>, never a hand-rolled padding.",
  },
  {
    name: "Measure",
    value: "max-w-5xl / max-w-2xl / max-w-lg",
    use: "<Container width=\"admin\" | \"prose\" | \"member\">. The member page is the narrow one.",
  },
  {
    name: "Section rhythm",
    value: "space-y-10 / gap-14",
    use: "between major blocks on a page",
  },
  {
    name: "Card padding",
    value: "--card-spacing, 20px, or 14px on size=\"sm\"",
    use: "inside a Card. The component owns it, so do not add your own.",
  },
  {
    name: "Control gap",
    value: "gap-2 / gap-3",
    use: "between a label and its input, or buttons in a row",
  },
];

const BLOBS = [
  { cls: "bg-peach", size: "size-24", pos: "top-2 left-6", delay: "0s" },
  { cls: "bg-mint", size: "size-20", pos: "top-10 left-28", delay: "1.2s" },
  { cls: "bg-lilac", size: "size-16", pos: "top-4 left-48", delay: "2.4s" },
];

const BLOB_SHAPE = "58% 42% 45% 55% / 55% 48% 52% 45%";

export default function StyleguidePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-background/85 border-border sticky top-0 z-20 border-b backdrop-blur">
        <Container className="flex items-center justify-between py-3">
          <Link href="/">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden text-xs sm:inline">
              Toggle the register. Every token below is defined in both.
            </span>
            <ThemeToggle />
          </div>
        </Container>
      </header>

      <Container asChild>
        <main className="flex-1 py-10 md:py-14">
          {/* The hero is the pitch. A lavender pane, Fredoka at full size, and
              the whole personality in one band. No blobs here: those belong to
              the landing and dashboard heroes, and are demonstrated below. */}
          <div className="bg-lavender-pane animate-pop relative mb-14 overflow-hidden rounded-4xl p-8 shadow-md md:p-12 dark:bg-card">
            <Badge variant="secondary" className="mb-5">
              Soft Clay
            </Badge>
            <p className="font-heading text-display text-foreground max-w-[16ch] font-semibold text-balance">
              Whose turn? Sorted.
            </p>
            <p className="text-muted-foreground mt-5 max-w-prose text-sm text-pretty md:text-base">
              A chore rota should feel like a fridge magnet, not enterprise
              software. Lavender paper, plum ink, one grape action colour, and a
              sheet of pastel stickers that each carry a meaning. Surfaces are
              pillowy: lit from above, squashed below, dropped onto the page with
              a soft plum shadow. Nothing here is grey, and nothing is a
              gradient.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg">Set up your house</Button>
              <Button size="lg" variant="secondary">
                Maybe later
              </Button>
              <Badge variant="warning">today</Badge>
              <Badge variant="success">Delivered</Badge>
            </div>
          </div>

          <div className="flex flex-col gap-14">
            <Section
              id="rules"
              title="The four rules"
              intro="Everything else on this page follows from these."
            >
              <ol className="text-muted-foreground grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
                {[
                  {
                    n: "Never a raw colour.",
                    body: "No hex, no oklch(), no utility from Tailwind's own palette. globals.css tears that palette out of the compiler, so those utilities generate nothing at all, and lint fails the build on any that slip in. Reach for a semantic token, or a named pastel when the colour is pure decoration.",
                  },
                  {
                    n: "Every sticker has a job.",
                    body: "Mint is done, lemon is now, sky is on its way, blush went wrong, peach is warmth, lilac is quiet. A sticker doing another sticker's job is a bug, and one screen wants at most one hue that is not earning a meaning.",
                  },
                  {
                    n: "Nothing grey, nothing gradient.",
                    body: "Every shadow carries plum, every surface is lit from above and squashed below, and no fill is a gradient. No frosted glass, and no left-border accent cards.",
                  },
                  {
                    n: "Mobile first.",
                    body: "The member page is a phone page that happens to work on a desktop. Design at 390px, then let it breathe. Everything tappable is at least 44px, and it is a pill.",
                  },
                ].map((r) => (
                  <li
                    key={r.n}
                    className="border-border bg-card rounded-2xl border p-4 shadow-xs"
                  >
                    <p className="text-foreground font-heading mb-1 font-semibold">
                      {r.n}
                    </p>
                    <p className="text-xs text-pretty">{r.body}</p>
                  </li>
                ))}
              </ol>
            </Section>

            <Section
              id="paint"
              title="Paint"
              intro="Layer one: raw pigment, defined outside @theme so no utility is generated from the ramp. There is no bg-grape-500. Components reach for the semantic tokens below, or for the short list of pastels published by name. The six pastels are ONE OKLCH family, at L 0.90 and C 0.06 to 0.085, with only the hue moving. Because they share a lightness, plum ink reads on every one of them at about 10:1, and a sticker looks the same at night as it does by day."
            >
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                <PaintFamily
                  name="Lavender"
                  role="The paper family. White cards floating on a lavender page, with a deeper pane behind heroes."
                  pigments={LAVENDER}
                />
                <PaintFamily
                  name="Plum"
                  role="The ink family by day, and the whole sky at night. The violet cast is what keeps dark mode cosy."
                  pigments={PLUM}
                />
                <PaintFamily
                  name="Grape"
                  role="The one action colour: buttons, focus, the active nav item."
                  pigments={GRAPE}
                />
                <PaintFamily
                  name="Lilac"
                  role="Grape gone quiet. Secondary buttons, the hover blush, the later day coin."
                  pigments={LILAC}
                />
                <PaintFamily
                  name="Mint"
                  role="Done, at hue 160."
                  pigments={MINT}
                />
                <PaintFamily
                  name="Peach"
                  role="Warmth and date coins, at hue 60. The friendliest pigment in the set."
                  pigments={PEACH}
                />
                <PaintFamily
                  name="Lemon"
                  role="Now, at hue 95."
                  pigments={LEMON}
                />
                <PaintFamily
                  name="Sky"
                  role="On its way, at hue 234."
                  pigments={SKY}
                />
                <PaintFamily
                  name="Blush"
                  role="Went wrong, at hue 354. The family carries a second job too: the two saturated cuts at hue 15 are the real destructive button, pulled towards red so nobody mistakes delete this for a message failed."
                  pigments={BLUSH}
                />
              </div>
            </Section>

            <Section
              id="semantic"
              title="Semantic tokens"
              intro="Layer two: what a colour MEANS. This is the only layer a component may reach for when the colour carries a meaning. Every pairing is verified to meet WCAG AA in both registers, 4.5:1 for text and 3:1 for control borders and focus rings, with translucent fills composited over their real backdrop. npm run check:tokens re-checks it and fails CI on a regression."
            >
              <div className="flex flex-col gap-8">
                <div>
                  <h3 className="mb-4 text-sm font-medium">Surfaces</h3>
                  <SwatchGrid>
                    {SURFACES.map((s) => (
                      <Swatch key={s.token} {...s} />
                    ))}
                  </SwatchGrid>
                </div>
                <div>
                  <h3 className="mb-4 text-sm font-medium">Content</h3>
                  <SwatchGrid>
                    {CONTENT.map((s) => (
                      <Swatch key={s.token} {...s} />
                    ))}
                  </SwatchGrid>
                </div>
                <div>
                  <h3 className="mb-4 text-sm font-medium">
                    Action, and the fill versus text split
                  </h3>
                  <SwatchGrid>
                    {ACTION.map((s) => (
                      <Swatch key={s.token} {...s} />
                    ))}
                  </SwatchGrid>
                </div>
                <div>
                  <h3 className="mb-4 text-sm font-medium">The sticker sheet</h3>
                  <p className="text-muted-foreground mb-4 max-w-prose text-sm text-pretty">
                    Status is a sticker: the pastel is the fill and the paired
                    foreground is the text on it. By day that text is plum ink.
                    At night the fill drops to a 16% wash of itself and the
                    pastel becomes the text, so one pair of class names is
                    correct in both registers.
                  </p>
                  <SwatchGrid>
                    {STICKERS.map((s) => (
                      <Swatch key={s.token} {...s} />
                    ))}
                  </SwatchGrid>
                </div>
                <div>
                  <h3 className="mb-4 text-sm font-medium">Lines</h3>
                  <SwatchGrid>
                    {LINES.map((s) => (
                      <Swatch key={s.token} {...s} />
                    ))}
                  </SwatchGrid>
                </div>
              </div>
            </Section>

            <Section
              id="registers"
              title="The two registers"
              intro="The right column is forced into the night register by a nested dark wrapper, so both can be read at once with the page in light mode. The day values live on :root, so the forcing only works in one direction: use the toggle in the header to check the left column at night."
            >
              <Registers>
                <div className="flex flex-col gap-4">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="success">Delivered</Badge>
                    <Badge variant="info">Queued</Badge>
                    <Badge variant="warning">Sending</Badge>
                    <Badge variant="destructive">Failed</Badge>
                    <Badge variant="secondary">Fortnightly</Badge>
                    <Badge variant="outline">Draft</Badge>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm">Add member</Button>
                    <Button size="sm" variant="secondary">
                      Cancel
                    </Button>
                    <Button size="sm" variant="outline">
                      Export
                    </Button>
                    <Button size="sm" variant="ghost">
                      Dismiss
                    </Button>
                    <Button size="sm" variant="destructive">
                      Deactivate
                    </Button>
                  </div>
                  <Card size="sm">
                    <CardHeader>
                      <CardTitle>Kitchen deep clean</CardTitle>
                    </CardHeader>
                    <CardContent className="text-muted-foreground">
                      Raph is up on Saturday.
                    </CardContent>
                  </Card>
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="bg-peach text-plum font-heading flex size-14 shrink-0 flex-col items-center justify-center rounded-xl leading-none font-semibold shadow-xs">
                      <span className="text-lg">4</span>
                      <span className="text-[10px] tracking-wide uppercase">
                        Jul
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs text-pretty">
                      The peach date coin is a sticker, so it is deliberately
                      theme independent. Pair a pastel fill with text-plum, never
                      with text-foreground, or the numerals go white at night.
                    </span>
                  </div>
                </div>
              </Registers>
            </Section>

            <Section
              id="type"
              title="Typography"
              intro="A rounded pairing. Fredoka is a soft, wide-shouldered display face with a width axis, set at weight 600 and wdth 108 so it looks pressed out of clay. Outfit is a clean geometric sans whose round bowls sit under Fredoka without competing. Space Mono handles machine strings, and even those get a little charm."
            >
              <div className="flex flex-col gap-4">
                <Demo label="The three voices" hint="font-heading · font-sans · font-mono" className="block">
                  <div className="w-full space-y-5">
                    <div>
                      <p className="font-heading text-2xl font-semibold">
                        Fredoka greets, names and celebrates
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        font-heading · greetings, headings, card titles, dialog
                        titles, buttons, date numerals, the wordmark
                      </p>
                    </div>
                    <div>
                      <p className="text-base">
                        Outfit explains. It carries body copy, tables, forms and
                        labels, at 400 to 700.
                      </p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        font-sans · if a sentence does work it is Outfit, and if
                        it smiles it is Fredoka
                      </p>
                    </div>
                    <div>
                      <p className="font-mono text-sm">SM1a2b3c4d5e6f · x7Kd2p</p>
                      <p className="text-muted-foreground mt-1 text-xs">
                        font-mono · machine strings only: magic-link tokens and
                        Twilio SIDs
                      </p>
                    </div>
                  </div>
                </Demo>

                <Demo label="Scale" hint="the utilities the system uses" className="block">
                  <ul className="w-full space-y-4">
                    {TYPE_SCALE.map((t) => (
                      <li key={t.cls}>
                        <p
                          className={`font-heading font-semibold ${t.cls} ${
                            t.cls === "text-display" ? "leading-none" : ""
                          }`}
                        >
                          Hi Ciara
                        </p>
                        <p className="text-muted-foreground mt-1 text-xs">
                          <code className="font-mono">{t.label}</code> ·{" "}
                          {t.use}
                        </p>
                      </li>
                    ))}
                  </ul>
                </Demo>

                <Demo label="In place" className="block">
                  <div className="w-full space-y-4">
                    <p className="text-display font-heading leading-none font-semibold">
                      Hi Ciara
                    </p>
                    <p className="text-base">
                      Here&apos;s what&apos;s coming up for you, across every
                      rota.
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Every 2 weeks · 4 people · next text in 3 days
                    </p>
                  </div>
                </Demo>

                <Demo label="Tabular numerals" hint="automatic in tables and <time>">
                  <div className="text-sm">
                    <p>
                      <time>Sat 4 Jul</time> · <time>Tue 7 Jul</time> ·{" "}
                      <time>Thu 9 Jul</time>
                    </p>
                    <p className="text-muted-foreground mt-1 text-xs">
                      Dates and counts never jitter as they change.
                    </p>
                  </div>
                </Demo>
              </div>
            </Section>

            <Section
              id="shape"
              title="Shape"
              intro="--radius is 0.75rem, and the ramp reaches the four sizes the system actually uses. Anything tappable is a PILL rather than a step on the ramp: buttons, inputs, selects, badges, chips, tabs triggers and menu items are all rounded-full."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Demo label="Radius ramp" hint="--radius: 0.75rem" className="block">
                  <ul className="w-full space-y-2.5">
                    {RADII.map((r) => (
                      <li key={r.cls} className="flex items-center gap-3">
                        <span
                          className={`bg-lilac ring-border size-9 shrink-0 ring-1 ring-inset ${r.cls}`}
                          aria-hidden
                        />
                        <span className="min-w-0 text-sm">
                          <code className="font-mono text-xs font-medium">
                            {r.label}
                          </code>
                          <span className="text-muted-foreground">
                            {" "}
                            · {r.use}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Demo>

                <Demo
                  label="Blobs"
                  hint="landing and dashboard heroes only"
                  className="block"
                >
                  <div className="w-full">
                    <div className="bg-lavender-pane relative h-44 overflow-hidden rounded-4xl">
                      {BLOBS.map((b) => (
                        <span
                          key={b.cls}
                          className={`animate-bob absolute ${b.pos} ${b.size} ${b.cls} shadow-xs`}
                          style={{
                            borderRadius: BLOB_SHAPE,
                            animationDelay: b.delay,
                          }}
                          aria-hidden
                        />
                      ))}
                    </div>
                    <p className="text-muted-foreground mt-3 text-xs text-pretty">
                      Organic pastel shapes on an asymmetric border-radius,
                      wearing the soft clay. They bob on a 6s ease-in-out loop
                      that translates only, so nothing wobbles, and
                      prefers-reduced-motion stills them outright rather than
                      speeding them up.
                    </p>
                  </div>
                </Demo>
              </div>
            </Section>

            <Section
              id="clay"
              title="The clay recipe"
              intro="Three strengths, wired to --elevation-* so shadow-xs, shadow-sm and shadow-md pick them up. Every surface is lit from above by a white inset highlight and squashed below by a plum inset shadow, then dropped on a long, soft plum shadow. Nothing here is grey and nothing is black. At night the highlight falls to 8% white, the squash goes black, and the drop becomes true night."
            >
              <div className="flex flex-col gap-4">
                {CLAY.map((c) => (
                  <Demo key={c.cls} label={c.label} hint={c.cls} className="block">
                    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-center">
                      <span
                        className={`bg-card size-16 shrink-0 rounded-2xl ${c.cls}`}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="text-sm">{c.use}</p>
                        <code className="text-muted-foreground mt-1 block font-mono text-[11px] break-words">
                          {c.recipe}
                        </code>
                      </div>
                    </div>
                  </Demo>
                ))}
                <Demo label="The other two" className="block">
                  <ul className="w-full space-y-4">
                    {CLAY_EXTRAS.map((c) => (
                      <li key={c.cls} className="flex items-start gap-3">
                        <span
                          className={`bg-card size-12 shrink-0 rounded-2xl ${c.cls}`}
                          aria-hidden
                        />
                        <span className="min-w-0 text-sm">
                          <code className="font-mono text-xs font-medium">
                            {c.cls}
                          </code>
                          <span className="text-muted-foreground">
                            {" "}
                            · {c.use}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Demo>
              </div>
            </Section>

            <Section
              id="spacing"
              title="Spacing"
              intro="Generous needs a definition to copy, or five screens drift to five different paddings. Here it is, named. The page gutter lives in Container, the card padding lives in Card, and the rest are conventions to reach for."
            >
              <Demo label="The spacing system" className="block">
                <ul className="w-full space-y-3">
                  {SPACING.map((s) => (
                    <li key={s.name} className="text-sm">
                      <span className="font-medium">{s.name}</span>{" "}
                      <code className="text-muted-foreground font-mono text-xs">
                        {s.value}
                      </code>
                      <p className="text-muted-foreground text-xs text-pretty">
                        {s.use}
                      </p>
                    </li>
                  ))}
                </ul>
              </Demo>
            </Section>

            <Section
              id="layouts"
              title="The two layouts"
              intro="They are deliberately opposites, and the difference is the product."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Admin ·{" "}
                      <code className="font-mono text-xs font-normal">
                        app/(admin)/
                      </code>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground space-y-4">
                    <p className="text-pretty">
                      A white clay sidebar panel on desktop, a drawer on mobile,
                      pill nav items with a lilac fill and a grape icon on the
                      active one, the wordmark top left. Start every screen with{" "}
                      <code className="font-mono text-xs">
                        &lt;PageHeader&gt;
                      </code>
                      , wrap it in{" "}
                      <code className="font-mono text-xs">
                        &lt;Container&gt;
                      </code>
                      , and add your route to{" "}
                      <code className="font-mono text-xs">ADMIN_NAV</code>{" "}
                      rather than building a nav of your own.
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/dashboard">Open</Link>
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Member ·{" "}
                      <code className="font-mono text-xs font-normal">
                        app/(member)/s/[token]
                      </code>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground space-y-4">
                    <p className="text-pretty">
                      No nav, no theme toggle, no account menu. One column, a
                      comfortable measure, and one thing to do, greeted by name
                      in Fredoka. The person holding this link opened it from a
                      text, is not signed in, and did not ask to be here. Their
                      phone picks the register.
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/s/demo-token">Open</Link>
                    </Button>
                  </CardContent>
                </Card>
              </div>
            </Section>

            <Gallery />
          </div>
        </main>
      </Container>
    </div>
  );
}
