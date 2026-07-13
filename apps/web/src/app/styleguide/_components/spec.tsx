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

/** A labelled panel around a live component, so the demo never floats loose. */
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
    <div className="border-border bg-card overflow-hidden rounded-xl border">
      <div className="border-border bg-muted/40 flex items-baseline justify-between gap-4 border-b px-4 py-2">
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
    </div>
  );
}

/**
 * One colour token: the chip, the semantic name, the utility to reach for, and
 * what it is FOR. The last column is the one that matters — a token without a
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
          "ring-border size-11 shrink-0 rounded-lg ring-1 ring-inset",
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
