import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The "there is nothing here yet" panel. Members with no shifts, a group with
 * no rotas, an SMS log on day one — every list screen has an empty state, and
 * without a shared one each of the five would invent a different layout, tone
 * and button placement. This is the single answer.
 *
 * SOLSTICE makes it a small celebration rather than an apology: the icon sits
 * on a floating sunrise-gradient coin (gently bobbing — stilled under
 * reduced-motion), the title speaks in Fraunces, and the panel itself is a
 * soft card, not a dashed void.
 *
 * `action` is the way out of empty — "Add your first member". Keep it optional:
 * the member page's empty state is a reassurance ("You're all caught up"), not
 * a call to action.
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
        "flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-xs",
        className,
      )}
    >
      {Icon ? (
        <span className="grid size-14 shrink-0 animate-float place-items-center rounded-2xl bg-[image:var(--gradient-sunrise)] text-foreground shadow-sm">
          <Icon className="size-6" strokeWidth={2.25} aria-hidden />
        </span>
      ) : null}
      <div className="space-y-1.5">
        <p className="font-heading text-lg font-semibold text-balance">{title}</p>
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
