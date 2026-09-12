import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The "there is nothing here yet" panel. Members with no shifts, a group with
 * no rotas, an SMS log on day one: every list screen has an empty state, and
 * without a shared one each of the five would invent a different layout, tone
 * and button placement. This is the single answer.
 *
 * Soft Clay makes it a small welcome rather than an apology. The icon sits on a
 * PEACH COIN, 56px at an 18px radius, the same object the member page uses for
 * a date, and it bobs gently (stilled under reduced-motion). The title speaks in
 * Fredoka; the panel is a proper card, never a dashed void.
 *
 * `action` is the way out of empty, as in "Add your first member". Keep it
 * optional: the member page's empty state is a reassurance, not a call to
 * action.
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
        "flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-14 text-center shadow-sm",
        className,
      )}
    >
      {Icon ? (
        // text-plum, not text-foreground: the coin is a sticker and does not
        // invert, so its ink must not follow the theme either.
        <span className="grid size-14 shrink-0 animate-bob place-items-center rounded-xl bg-peach text-plum shadow-xs">
          <Icon className="size-6" strokeWidth={2.25} aria-hidden />
        </span>
      ) : null}
      <div className="space-y-1.5">
        <p className="font-heading text-lg font-semibold text-balance">
          {title}
        </p>
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
