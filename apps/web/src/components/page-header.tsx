import { cn } from "@/lib/utils";

/**
 * The top of every admin screen. Use it rather than hand-rolling an <h1>: it is
 * what keeps five separately-built screens looking like one product.
 *
 * `actions` is the right-hand slot — the primary button for the screen
 * ("Add member", "New rota"). It drops below the title on narrow screens.
 */
export function PageHeader({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
          {title}
        </h1>
        {description ? (
          <p className="text-muted-foreground max-w-prose text-sm">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
