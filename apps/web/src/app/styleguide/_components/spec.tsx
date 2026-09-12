import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20">
      <div className="border-border mb-6 border-b pb-3">
        <h2 className="font-heading text-xl font-semibold tracking-tight">
          {title}
        </h2>
        {intro ? (
          <p className="text-muted-foreground mt-1.5 max-w-prose text-sm text-pretty">
            {intro}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/**
 * A labelled panel around a live component. It IS a <Card>, so the reference for
 * "what a panel looks like" is the same component every screen uses rather than
 * a look-alike that can drift away from it.
 */
export function Demo({
  label,
  hint,
  className,
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="border-border bg-muted/60 flex items-baseline justify-between gap-4 border-b px-4 py-2">
        <span className="text-xs font-medium">{label}</span>
        {hint ? (
          <code className="text-muted-foreground font-mono text-[11px]">
            {hint}
          </code>
        ) : null}
      </div>
      <div className={cn("flex flex-wrap items-center gap-3 p-5", className)}>
        {children}
      </div>
    </Card>
  );
}

/**
 * One SEMANTIC token: the chip, the token name, the utility to reach for, and
 * what it is for. The last line is the one that matters. A token without a
 * stated job gets misused.
 */
export function Swatch({
  swatchClass,
  token,
  util,
  role,
}: {
  swatchClass: string;
  token: string;
  util: string;
  role: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={cn(
          "ring-border size-11 shrink-0 rounded-xl shadow-xs ring-1 ring-inset",
          swatchClass,
        )}
        aria-hidden
      />
      <div className="min-w-0">
        <code className="block font-mono text-xs font-medium">{token}</code>
        <code className="text-muted-foreground block font-mono text-[11px]">
          {util}
        </code>
        <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
          {role}
        </p>
      </div>
    </div>
  );
}

export function SwatchGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
  );
}

export type Pigment = {
  /** The custom property, exactly as globals.css spells it. */
  token: string;
  /** The value, exactly as globals.css spells it. */
  value: string;
  /** The hex the value was authored from, where there is one. */
  hex?: string;
  /** The one job this cut does. */
  role: string;
};

/**
 * One PAINT family. Pigments are deliberately absent from `@theme`, so there is
 * no `bg-grape-500` to reach for and these chips have to paint themselves from
 * the raw custom property. That is the point of the layer boundary, and drawing
 * it this way keeps the page honest about it.
 */
export function PaintFamily({
  name,
  role,
  pigments,
}: {
  name: string;
  role: string;
  pigments: readonly Pigment[];
}) {
  return (
    <div className="border-border bg-card rounded-2xl border p-5 shadow-xs">
      <div className="mb-4">
        <h4 className="font-heading text-base font-semibold">{name}</h4>
        <p className="text-muted-foreground mt-0.5 text-xs text-pretty">
          {role}
        </p>
      </div>
      <ul className="space-y-3">
        {pigments.map((p) => (
          <li key={p.token} className="flex items-start gap-3">
            <span
              className="ring-border mt-0.5 size-9 shrink-0 rounded-xl shadow-xs ring-1 ring-inset"
              style={{ background: `var(${p.token})` }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <code className="block font-mono text-[11px] font-medium">
                {p.token}
                {p.hex ? (
                  <span className="text-muted-foreground"> · {p.hex}</span>
                ) : null}
              </code>
              <code className="text-muted-foreground block font-mono text-[11px]">
                {p.value}
              </code>
              <span className="text-muted-foreground block text-xs text-pretty">
                {p.role}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The same thing, twice: once in the register the page is currently set to, and
 * once forced into the night register by a nested `.dark` wrapper. The dark
 * class sets the whole semantic block on the element it sits on, so everything
 * inside it resolves against night values while the rest of the page stays put.
 *
 * The forcing only works in one direction. `:root` owns the day values, so a
 * nested element cannot climb back out of dark mode. Read the left column with
 * the page in light mode, and use the header toggle to check it at night.
 */
export function Registers({
  children,
  dayLabel = "This page's register",
  nightLabel = "Clay at night, forced",
}: {
  children: React.ReactNode;
  dayLabel?: string;
  nightLabel?: string;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="border-border bg-background rounded-3xl border p-5">
        <p className="text-muted-foreground mb-4 text-[11px] font-medium tracking-wide uppercase">
          {dayLabel}
        </p>
        {children}
      </div>
      <div className="dark border-border bg-background text-foreground rounded-3xl border p-5">
        <p className="text-muted-foreground mb-4 text-[11px] font-medium tracking-wide uppercase">
          {nightLabel}
        </p>
        {children}
      </div>
    </div>
  );
}
