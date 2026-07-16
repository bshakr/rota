import type { Metadata } from "next";
import Link from "next/link";
import { Sparkles } from "lucide-react";

import { Gallery } from "@/app/styleguide/_components/gallery";
import {
  Demo,
  Section,
  Swatch,
  SwatchGrid,
} from "@/app/styleguide/_components/spec";
import { Container } from "@/components/container";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Styleguide" };

const SURFACES = [
  {
    swatchClass: "bg-background",
    token: "--background",
    util: "bg-background",
    role: "The page itself. Sunlit paper — never white, never grey.",
  },
  {
    swatchClass: "bg-card",
    token: "--card",
    util: "bg-card",
    role: "Anything that lifts off the page. Lighter than the page in BOTH themes.",
  },
  {
    swatchClass: "bg-popover",
    token: "--popover",
    util: "bg-popover",
    role: "Floating surfaces: dialog, dropdown, popover.",
  },
  {
    swatchClass: "bg-muted",
    token: "--muted",
    util: "bg-muted",
    role: "A recessed panel or a table header. Warm cream, stays in the sunbeam family.",
  },
  {
    swatchClass: "bg-sidebar",
    token: "--sidebar",
    util: "bg-sidebar",
    role: "The admin sidebar — frosted glass: translucent warm paper blurred over sunrise blobs, floating in the page. The brand hue survives as its lilac hover blush.",
  },
  {
    swatchClass: "bg-accent",
    token: "--accent",
    util: "bg-accent",
    role: "NOT the brand colour — the hover tint, and it blushes lilac instead of going grey.",
  },
];

const CONTENT = [
  {
    swatchClass: "bg-foreground",
    token: "--foreground",
    util: "text-foreground",
    role: "Body text. Deep violet ink — never black, never slate.",
  },
  {
    swatchClass: "bg-muted-foreground",
    token: "--muted-foreground",
    util: "text-muted-foreground",
    role: "Secondary text. Still clears 4.5:1 on every surface above.",
  },
];

const ACCENT = [
  {
    swatchClass: "bg-primary",
    token: "--primary",
    util: "bg-primary",
    role: "Iris — the action colour. CTAs, links, focus fill, the active nav item.",
  },
  {
    swatchClass: "bg-primary-foreground",
    token: "--primary-foreground",
    util: "text-primary-foreground",
    role: "Text on top of iris.",
  },
  {
    swatchClass: "bg-secondary",
    token: "--secondary",
    util: "bg-secondary",
    role: "A secondary button's lilac fill — friendly, not administrative.",
  },
  {
    swatchClass: "bg-secondary-foreground",
    token: "--secondary-foreground",
    util: "text-secondary-foreground",
    role: "Deep iris text on the lilac fill.",
  },
];

const STATUS = [
  {
    swatchClass: "bg-success",
    token: "--success",
    util: "text-success",
    role: "Meadow. SMS delivered; a turn completed. Badge: variant=\"success\".",
  },
  {
    swatchClass: "bg-warning",
    token: "--warning",
    util: "text-warning",
    role: "Sunshine. Sending, a stale reminder — and the today/tomorrow badge. Badge: variant=\"warning\".",
  },
  {
    swatchClass: "bg-info",
    token: "--info",
    util: "text-info",
    role: "Sky. Queued, or covering someone's turn. Badge: variant=\"info\".",
  },
  {
    swatchClass: "bg-destructive",
    token: "--destructive",
    util: "text-destructive",
    role: "Cherry. Carrier failure, or a destructive action. Badge: variant=\"destructive\".",
  },
];

const LINES = [
  {
    swatchClass: "bg-border",
    token: "--border",
    util: "border-border",
    role: "Decorative hairline: card edges, separators. Butter — low contrast on purpose.",
  },
  {
    swatchClass: "bg-input",
    token: "--input",
    util: "border-input",
    role: "A real control boundary — form fields. Darker, because WCAG wants 3:1 here.",
  },
  {
    swatchClass: "bg-ring",
    token: "--ring",
    util: "outline-ring",
    role: "Focus. A deeper iris, distinct from --primary, always drawn as an offset outline.",
  },
  {
    swatchClass: "bg-overlay",
    token: "--overlay",
    util: "bg-overlay",
    role: "The wash behind a modal. Violet ink in light, deep night in dark — never invisible.",
  },
];

const GRADIENTS = [
  {
    varName: "--gradient-sunrise",
    role: "The brand wash: the wordmark tile, empty-state coins, a shift card's date coin, the greeting swash. Pastel gold → pink → lilac by day; jewel tones after dark.",
  },
  {
    varName: "--gradient-page",
    role: "The barely-there peach-and-sky corners behind every screen (aurora in dark). Applied once, on <body> — never on a component.",
  },
];

// Each with the ONE thing it is for, so engineer #3 doesn't guess.
const RADII = [
  { cls: "rounded-md", label: "md", use: "badges, chips, menu items" },
  { cls: "rounded-lg", label: "lg · --radius (8px)", use: "buttons, inputs, nav items — the tappable default" },
  { cls: "rounded-xl", label: "xl", use: "cards, tiles, popovers" },
  { cls: "rounded-2xl", label: "2xl", use: "dialogs, empty states, date coins, hero bands" },
  { cls: "rounded-full", label: "full", use: "avatars and status dots — only the truly circular" },
];

const SHADOWS = [
  { cls: "shadow-xs", label: "xs", use: "a card resting on the page" },
  { cls: "shadow-sm", label: "sm", use: "a hovered/raised card, the date coin" },
  { cls: "shadow-md", label: "md", use: "popover, dropdown" },
  { cls: "shadow-lg", label: "lg", use: "dialog, sheet — floating over a scrim" },
  { cls: "shadow-primary", label: "primary", use: "the iris glow under a CTA — nothing else" },
];

const ICON_SIZES = [
  { px: "size-4 (16px)", use: "inside buttons and inputs — inline with text" },
  { px: "size-[18px]", use: "nav items and the wordmark tile" },
  { px: "size-5 (20px)", use: "a standalone icon button (hamburger)" },
  { px: "size-6 (24px)", use: "an empty-state / section glyph" },
];

const SPACING = [
  { name: "Page gutter", value: "px-5 md:px-8", use: "every screen's left/right edge — use <Container>, never hand-rolled" },
  { name: "Section rhythm", value: "space-y-10 / gap-14", use: "between major blocks on a page" },
  { name: "Card padding", value: "--card-spacing (20px, 14px sm)", use: "inside a Card — owned by the component" },
  { name: "Control gap", value: "gap-2 / gap-3", use: "between a label and its input, buttons in a row" },
];

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
              Toggle the theme — every token below is defined in both.
            </span>
            <ThemeToggle />
          </div>
        </Container>
      </header>

      <Container asChild>
        <main className="flex-1 py-10 md:py-14">
          {/* The hero IS the pitch: sunrise band, Fraunces at full size, the
              whole personality in one card. */}
          <div className="animate-pop relative mb-14 overflow-hidden rounded-3xl bg-[image:var(--gradient-sunrise)] p-8 shadow-md md:p-12">
            <Badge variant="outline" className="border-foreground/20 bg-card/60 mb-5">
              <Sparkles aria-hidden />
              Solstice — the design language
            </Badge>
            <p className="font-heading font-wonky max-w-[16ch] text-[2.75rem] leading-[1.05] font-semibold text-balance md:text-6xl">
              Whose turn is it?
            </p>
            <p className="mt-5 max-w-prose text-sm text-pretty md:text-base">
              A chore rota that feels like the brightest day of the year: sunlit
              paper, violet ink, candy accents that mean something, softly
              rounded corners, and motion with a spring in its step. Friendly first —
              because the person reading it is standing in a kitchen, not
              sitting in a meeting.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <Button size="lg">Take your turn</Button>
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
              title="The three rules"
              intro="Everything else on this page follows from these."
            >
              <ol className="text-muted-foreground grid gap-3 text-sm sm:grid-cols-3">
                {[
                  {
                    n: "Never a raw colour.",
                    body: "No hex, no oklch(), no Tailwind palette utility. globals.css tears the default palette out of the compiler, so those utilities generate nothing, and lint fails the build on any that slip in. Reach for a semantic token instead.",
                  },
                  {
                    n: "Every hue has a job.",
                    body: "Iris acts, sunshine is now, meadow is done, sky is on its way, cherry went wrong, flamingo decorates. A colour doing another colour's job is a bug — and a screen needs at most one hue that isn't earning a meaning.",
                  },
                  {
                    n: "Mobile first.",
                    body: "The member page is a phone page that happens to work on desktop. Design at 375px, then let it breathe. Everything tappable is at least 44px, on softly rounded corners.",
                  },
                ].map((r) => (
                  <li
                    key={r.n}
                    className="border-border bg-card rounded-xl border p-4 shadow-xs"
                  >
                    <p className="text-foreground font-heading mb-1 font-semibold">{r.n}</p>
                    <p className="text-xs text-pretty">{r.body}</p>
                  </li>
                ))}
              </ol>
            </Section>

            <Section
              id="colour"
              title="Colour"
              intro="Sunlit paper, violet ink, and a small choir of confident hues that each carry a meaning. Every pairing below is verified to meet WCAG AA in both themes — 4.5:1 for text, 3:1 for control borders and focus rings — and `npm run check:tokens` fails CI if that regresses."
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
                  <h3 className="mb-4 text-sm font-medium">Action &amp; lilac</h3>
                  <SwatchGrid>
                    {ACCENT.map((s) => (
                      <Swatch key={s.token} {...s} />
                    ))}
                  </SwatchGrid>
                </div>
                <div>
                  <h3 className="mb-4 text-sm font-medium">The status choir</h3>
                  <SwatchGrid>
                    {STATUS.map((s) => (
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
              id="gradients"
              title="Gradients"
              intro="Two, each a token with a light and a dark voice — components reference the token, never the stops. Gradients are decoration only — the primary button is deliberately a solid: body text never sits on a gradient without a solid card between them."
            >
              <div className="grid gap-4 md:grid-cols-3">
                {GRADIENTS.map((g) => (
                  <div key={g.varName} className="flex flex-col gap-3">
                    <div
                      className="ring-border h-20 rounded-xl ring-1 ring-inset"
                      style={{ backgroundImage: `var(${g.varName})` }}
                      aria-hidden
                    />
                    <div>
                      <code className="block font-mono text-xs font-medium">
                        {g.varName}
                      </code>
                      <p className="text-muted-foreground mt-1 text-xs text-pretty">
                        {g.role}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            <Section
              id="type"
              title="Typography"
              intro="An expressive pairing. Fraunces — a warm, optical display serif set SOFT, with the wonky cut reserved for greetings — is the voice; Plus Jakarta Sans carries body copy with open, friendly counters; Space Mono handles machine strings (tokens, Twilio SIDs) with charm. Headings are semibold, never black-weight."
            >
              <div className="flex flex-col gap-4">
                <Demo label="Scale" className="block">
                  <div className="space-y-4">
                    <p className="text-display font-heading font-wonky font-semibold">
                      Hi Alice
                    </p>
                    <p className="font-heading text-2xl font-semibold">
                      Kitchen deep clean
                    </p>
                    <p className="text-base">
                      It&apos;s your turn on Saturday 5 July — and it&apos;s a lovely day for it.
                    </p>
                    <p className="text-muted-foreground text-sm">
                      Every 2 weeks · 4 members · next reminder in 3 days
                    </p>
                    <p className="text-muted-foreground font-mono text-xs">
                      SM1a2b3c4d5e6f · x7Kd2p
                    </p>
                  </div>
                </Demo>
                <Demo
                  label="The two voices"
                  hint="font-heading vs font-sans"
                  className="block"
                >
                  <p className="text-sm text-pretty">
                    <span className="font-heading text-base font-semibold">
                      Fraunces greets, names and celebrates
                    </span>{" "}
                    — greetings, card titles, dialog titles, the wordmark.{" "}
                    <span className="font-medium">Jakarta explains</span> —
                    everything else. If a sentence does work, it&apos;s Jakarta;
                    if it smiles, it&apos;s Fraunces. `font-wonky` (the
                    hand-drawn cut) is for the display greeting only.
                  </p>
                </Demo>
                <Demo label="Tabular numerals" hint="automatic in tables and <time>">
                  <div className="text-sm">
                    <p>
                      <time>Sat 5 Jul</time> · <time>Thu 10 Jul</time> ·{" "}
                      <time>Sat 19 Jul</time>
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
              title="Shape & elevation"
              intro="--radius is 0.5rem — soft rounded rectangles, not pills: buttons, inputs and nav share the 8px default, cards sit a step rounder, and only avatars and status dots are circles. Shadows are soft and VIOLET, never black or grey: a coloured shadow is what makes a light UI feel lit rather than printed. In dark they deepen to night. Each swatch names the ONE place it belongs."
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Demo label="Radius — assignment" className="block">
                  <ul className="w-full space-y-2.5">
                    {RADII.map((r) => (
                      <li key={r.cls} className="flex items-center gap-3">
                        <span
                          className={`bg-primary/15 ring-primary/30 size-9 shrink-0 ring-1 ${r.cls}`}
                        />
                        <span className="min-w-0 text-sm">
                          <code className="font-mono text-xs font-medium">
                            {r.label}
                          </code>
                          <span className="text-muted-foreground"> — {r.use}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Demo>
                <Demo label="Elevation — assignment" className="block">
                  <ul className="w-full space-y-2.5">
                    {SHADOWS.map((s) => (
                      <li key={s.cls} className="flex items-center gap-3">
                        <span className={`bg-card size-9 shrink-0 rounded-lg ${s.cls}`} />
                        <span className="min-w-0 text-sm">
                          <code className="font-mono text-xs font-medium">
                            {s.label}
                          </code>
                          <span className="text-muted-foreground"> — {s.use}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </Demo>
                <Demo label="Icon sizes — assignment" className="block">
                  <ul className="w-full space-y-2 text-sm">
                    {ICON_SIZES.map((i) => (
                      <li key={i.px}>
                        <code className="font-mono text-xs font-medium">{i.px}</code>
                        <span className="text-muted-foreground"> — {i.use}</span>
                      </li>
                    ))}
                  </ul>
                </Demo>
                <Demo label="Touch targets" className="block">
                  <p className="text-sm text-pretty">
                    Anything tapped on a phone is at least{" "}
                    <span className="font-medium">44px</span>: buttons at{" "}
                    <code className="font-mono text-xs">size=&quot;lg&quot;</code>,
                    icon buttons at{" "}
                    <code className="font-mono text-xs">size=&quot;icon-lg&quot;</code>{" "}
                    (the hamburger, the modal close). Table-row actions may be
                    smaller — they are mouse targets.
                  </p>
                </Demo>
              </div>
            </Section>

            <Section
              id="spacing"
              title="Spacing"
              intro="“Generous” needs a definition to copy, or five screens drift to five different paddings. Here it is, named. The page gutter lives in <Container>; the card padding lives in <Card>; the rest are conventions to reach for."
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
                      Admin —{" "}
                      <code className="font-mono text-xs font-normal">
                        app/(admin)/
                      </code>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground space-y-4">
                    <p className="text-pretty">
                      Floating frosted-glass sidebar on desktop, drawer on mobile, theme toggle,
                      five nav entries. Signed in via AuthKit. Start every screen
                      with <code className="font-mono text-xs">&lt;PageHeader&gt;</code>,
                      wrap it in <code className="font-mono text-xs">&lt;Container&gt;</code>,
                      and add your route to{" "}
                      <code className="font-mono text-xs">ADMIN_NAV</code> rather
                      than building your own nav.
                    </p>
                    <Button asChild size="sm" variant="outline">
                      <Link href="/dashboard">Open</Link>
                    </Button>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>
                      Member —{" "}
                      <code className="font-mono text-xs font-normal">
                        app/(member)/s/[token]
                      </code>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-muted-foreground space-y-4">
                    <p className="text-pretty">
                      No nav, no theme toggle, no account menu. A single column,
                      a comfortable measure, and one thing to do — greeted by
                      name, in Fraunces. The person holding this link did not
                      ask to be here and is not logged in. The theme follows
                      their phone.
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
