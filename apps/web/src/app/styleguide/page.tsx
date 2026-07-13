import type { Metadata } from "next";
import Link from "next/link";

import { Gallery } from "@/app/styleguide/_components/gallery";
import {
  Demo,
  Section,
  Swatch,
  SwatchGrid,
} from "@/app/styleguide/_components/spec";
import { Container } from "@/components/container";
import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Styleguide" };

const SURFACES = [
  {
    swatchClass: "bg-background",
    token: "--background",
    util: "bg-background",
    role: "The page itself. Sand, never white.",
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
    role: "A recessed panel or a table header. Also --secondary.",
  },
  {
    swatchClass: "bg-sidebar",
    token: "--sidebar",
    util: "bg-sidebar",
    role: "The admin sidebar, one step deeper than the page.",
  },
  {
    swatchClass: "bg-accent",
    token: "--accent",
    util: "bg-accent",
    role: "NOT the brand colour — this is shadcn's hover tint. The accent you want is --primary.",
  },
];

const CONTENT = [
  {
    swatchClass: "bg-foreground",
    token: "--foreground",
    util: "text-foreground",
    role: "Body text. Warm near-black — ink, never pure black.",
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
    role: "The one confident accent. Clay. CTAs, links, focus rings — and nothing else.",
  },
  {
    swatchClass: "bg-primary-foreground",
    token: "--primary-foreground",
    util: "text-primary-foreground",
    role: "Text on top of clay.",
  },
];

const STATUS = [
  {
    swatchClass: "bg-success",
    token: "--success",
    util: "text-success",
    role: "SMS delivered. Badge: variant=\"success\".",
  },
  {
    swatchClass: "bg-warning",
    token: "--warning",
    util: "text-warning",
    role: "Sending, or a reminder gone stale. Badge: variant=\"warning\".",
  },
  {
    swatchClass: "bg-info",
    token: "--info",
    util: "text-info",
    role: "Queued. Badge: variant=\"info\".",
  },
  {
    swatchClass: "bg-destructive",
    token: "--destructive",
    util: "text-destructive",
    role: "Carrier failure, or a destructive action. Badge: variant=\"destructive\".",
  },
];

const LINES = [
  {
    swatchClass: "bg-border",
    token: "--border",
    util: "border-border",
    role: "Decorative hairline: card edges, separators. Low contrast on purpose.",
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
    role: "Focus. A deeper clay, distinct from --primary, always drawn as an offset outline so it shows on a clay button.",
  },
  {
    swatchClass: "bg-overlay",
    token: "--overlay",
    util: "bg-overlay",
    role: "The wash behind a modal. Warm ink in light, strong black in dark — never invisible.",
  },
];

// Each with the ONE thing it is for, so engineer #3 doesn't guess.
const RADII = [
  { cls: "rounded-sm", label: "sm", use: "inputs, badges' inner chips" },
  { cls: "rounded-md", label: "md", use: "buttons, menu items" },
  { cls: "rounded-lg", label: "lg · --radius", use: "the default" },
  { cls: "rounded-xl", label: "xl", use: "cards, dialogs, popovers" },
  { cls: "rounded-2xl", label: "2xl", use: "the member page's hero" },
];

const SHADOWS = [
  { cls: "shadow-xs", label: "xs", use: "a card resting on the page" },
  { cls: "shadow-sm", label: "sm", use: "a hovered/raised card" },
  { cls: "shadow-md", label: "md", use: "popover, dropdown" },
  { cls: "shadow-lg", label: "lg", use: "dialog, sheet — floating over a scrim" },
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
  { name: "Card padding", value: "--card-spacing (16px, 12px sm)", use: "inside a Card — owned by the component" },
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
        <PageHeader
          title="Styleguide"
          description="The contract for every HouseRota screen. If you are building BLO-1051 through BLO-1055, this page is the spec — take the tokens and components from here rather than inventing your own."
          actions={
            <Button asChild variant="outline">
              <Link href="/dashboard">See the admin shell</Link>
            </Button>
          }
        />

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
                  n: "One accent.",
                  body: "Clay, via --primary. A screen with a second saturated colour is a screen that has gone wrong. Status colours are the sole exception, and only for status.",
                },
                {
                  n: "Mobile first.",
                  body: "The member page is a phone page that happens to work on desktop. Design at 375px, then let it breathe.",
                },
              ].map((r) => (
                <li
                  key={r.n}
                  className="border-border bg-card rounded-xl border p-4"
                >
                  <p className="text-foreground mb-1 font-medium">{r.n}</p>
                  <p className="text-xs text-pretty">{r.body}</p>
                </li>
              ))}
            </ol>
          </Section>

          <Section
            id="colour"
            title="Colour"
            intro="Warm sand base, ink-not-black text, one clay accent. Every pairing below is verified to meet WCAG AA in both themes — 4.5:1 for text, 3:1 for control borders and focus rings — and `npm run check:tokens` fails CI if that regresses."
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
                <h3 className="mb-4 text-sm font-medium">Accent</h3>
                <SwatchGrid>
                  {ACCENT.map((s) => (
                    <Swatch key={s.token} {...s} />
                  ))}
                </SwatchGrid>
              </div>
              <div>
                <h3 className="mb-4 text-sm font-medium">Status</h3>
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
            id="type"
            title="Typography"
            intro="Figtree throughout — a geometric humanist with open apertures and a tall x-height. It reads friendly rather than corporate, and holds up on a phone at arm's length, which is the only place the member page is ever seen. Geist was rejected for being Vercel's typeface: using it lands us straight back in the dev-tool aesthetic."
          >
            <div className="flex flex-col gap-4">
              <Demo label="Scale" className="block">
                <div className="space-y-4">
                  <p className="text-display font-heading font-semibold">
                    Whose turn is it?
                  </p>
                  <p className="font-heading text-2xl font-semibold tracking-tight">
                    Kitchen deep clean
                  </p>
                  <p className="text-base">
                    Hi Alice! It&apos;s your turn on Saturday 5 July.
                  </p>
                  <p className="text-muted-foreground text-sm">
                    Every 2 weeks · 4 members · next reminder in 3 days
                  </p>
                  <p className="text-muted-foreground font-mono text-xs">
                    SM1a2b3c4d5e6f · x7Kd2p
                  </p>
                </div>
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
            intro="--radius is 0.875rem, a step rounder than shadcn's default. Shadows are warm brown in light — a black shadow on sand reads as grime — and go black in dark, where there is nothing to tint. Each swatch names the ONE place it belongs, so five screens round and lift things the same way."
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
                    Sidebar on desktop, drawer on mobile, theme toggle, five nav
                    entries. Signed in via AuthKit. Start every screen with{" "}
                    <code className="font-mono text-xs">&lt;PageHeader&gt;</code>,
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
                    No nav, no theme toggle, no account menu. A single column, a
                    comfortable measure, and one thing to do. The person holding
                    this link did not ask to be here and is not logged in. The
                    theme follows their phone.
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
