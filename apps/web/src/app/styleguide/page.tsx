import type { Metadata } from "next";
import Link from "next/link";

import { Gallery } from "@/app/styleguide/_components/gallery";
import {
  Demo,
  Section,
  Swatch,
  SwatchGrid,
} from "@/app/styleguide/_components/spec";
import { PageHeader } from "@/components/page-header";
import { ThemeToggle } from "@/components/theme-toggle";
import { Wordmark } from "@/components/wordmark";
import { Button } from "@/components/ui/button";

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
    util: "ring-ring",
    role: "Focus. Clay, so focus is always the accent colour.",
  },
];

const RADII = [
  { cls: "rounded-sm", label: "sm" },
  { cls: "rounded-md", label: "md" },
  { cls: "rounded-lg", label: "lg · --radius" },
  { cls: "rounded-xl", label: "xl" },
  { cls: "rounded-2xl", label: "2xl" },
];

const SHADOWS = [
  { cls: "shadow-xs", label: "xs" },
  { cls: "shadow-sm", label: "sm" },
  { cls: "shadow-md", label: "md" },
  { cls: "shadow-lg", label: "lg" },
];

export default function StyleguidePage() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="bg-background/85 border-border sticky top-0 z-20 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-5 py-3 md:px-8">
          <Link href="/">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground hidden text-xs sm:inline">
              Toggle the theme — every token below is defined in both.
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl flex-1 px-5 py-10 md:px-8 md:py-14">
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
                  body: "No hex, no oklch, no bg-orange-500 in a component. The raw pigments are deliberately kept out of Tailwind's theme, so no utility exists for them — the escape hatch is not there to take. Lint fails the build if you try.",
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
            intro="--radius is 0.875rem, a step rounder than shadcn's default. Shadows are warm brown in light — a black shadow on sand reads as grime — and go black in dark, where there is nothing to tint."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <Demo label="Radius" hint="--radius: 0.875rem">
                {RADII.map((r) => (
                  <span key={r.cls} className="flex flex-col items-center gap-2">
                    <span
                      className={`bg-primary/15 ring-primary/30 size-14 ring-1 ${r.cls}`}
                    />
                    <code className="text-muted-foreground font-mono text-[11px]">
                      {r.label}
                    </code>
                  </span>
                ))}
              </Demo>
              <Demo label="Elevation">
                {SHADOWS.map((s) => (
                  <span key={s.cls} className="flex flex-col items-center gap-2">
                    <span
                      className={`bg-card size-14 rounded-xl ${s.cls}`}
                    />
                    <code className="text-muted-foreground font-mono text-[11px]">
                      {s.label}
                    </code>
                  </span>
                ))}
              </Demo>
            </div>
          </Section>

          <Section
            id="layouts"
            title="The two layouts"
            intro="They are deliberately opposites, and the difference is the product."
          >
            <div className="grid gap-4 md:grid-cols-2">
              <div className="border-border bg-card rounded-xl border p-5">
                <h3 className="mb-1 font-medium">
                  Admin — <code className="font-mono text-xs">app/(admin)/</code>
                </h3>
                <p className="text-muted-foreground mb-4 text-sm text-pretty">
                  Sidebar on desktop, drawer on mobile, theme toggle, five nav
                  entries. Signed in via AuthKit. Start every screen with{" "}
                  <code className="font-mono text-xs">&lt;PageHeader&gt;</code>.
                  Add your route to{" "}
                  <code className="font-mono text-xs">ADMIN_NAV</code> rather
                  than building your own nav.
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/dashboard">Open</Link>
                </Button>
              </div>
              <div className="border-border bg-card rounded-xl border p-5">
                <h3 className="mb-1 font-medium">
                  Member —{" "}
                  <code className="font-mono text-xs">app/(member)/s/[token]</code>
                </h3>
                <p className="text-muted-foreground mb-4 text-sm text-pretty">
                  No nav, no theme toggle, no account menu. A single column, a
                  comfortable measure, and one thing to do. The person holding
                  this link did not ask to be here and is not logged in. The
                  theme follows their phone.
                </p>
                <Button asChild size="sm" variant="outline">
                  <Link href="/s/demo-token">Open</Link>
                </Button>
              </div>
            </div>
          </Section>

          <Gallery />
        </div>
      </main>
    </div>
  );
}
