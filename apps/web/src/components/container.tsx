import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * The page gutter — the ONE horizontal padding and max-width in the product.
 *
 * It exists because "generous spacing" needs a single definition to copy, or
 * five screens drift to px-4 / px-5 / px-8 (which is exactly what happened before
 * this component). The canonical value is `px-5 md:px-8`: 20px on a phone, 32px
 * from md up. `width` picks the measure:
 *
 *   admin   max-w-5xl  — dashboards and tables
 *   prose   max-w-2xl  — a rota editor, a settings form
 *   member  max-w-lg   — the single-column phone page
 *
 * `asChild` renders the gutter onto a semantic element you pass (a <main>, a
 * <section>) instead of an extra <div>. Vertical rhythm is separate: stack major
 * blocks with `space-y-10`, and let a Card own its inner padding via
 * --card-spacing.
 */
export function Container({
  width = "admin",
  asChild = false,
  className,
  ...props
}: React.ComponentProps<"div"> & {
  width?: "admin" | "prose" | "member";
  asChild?: boolean;
}) {
  const Comp = asChild ? Slot.Root : "div";
  return (
    <Comp
      className={cn(
        "mx-auto w-full px-5 md:px-8",
        width === "admin" && "max-w-5xl",
        width === "prose" && "max-w-2xl",
        width === "member" && "max-w-lg",
        className,
      )}
      {...props}
    />
  );
}
