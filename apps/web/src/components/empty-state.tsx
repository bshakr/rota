import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The "there is nothing here yet" panel. Members with no shifts, a group with no
 * rotas, an SMS log on day one, a rota still in draft — every list screen has an
 * empty state, and without a shared one each of the five would invent a different
 * layout, tone and button placement. This is the single answer.
 *
 * `action` is the way out of empty — "Add your first member". Keep it optional:
 * the member page's empty state is a reassurance ("You're all caught up"), not a
 * call to action.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-3 rounded-xl border border-dashed border-border px-6 py-14 text-center",
        className,
      )}
    >
      {Icon ? (
        // size-6 is the styleguide's documented empty-state glyph size; the
        // circle scales with it so the mark doesn't float in too much air.
        <span className="grid size-12 place-items-center rounded-full bg-muted text-muted-foreground">
          <Icon className="size-6" aria-hidden />
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="font-heading font-medium text-balance">{title}</p>
        {description ? (
          <p className="mx-auto max-w-sm text-sm text-muted-foreground text-pretty">
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
