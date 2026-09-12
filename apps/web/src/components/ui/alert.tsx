import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  // SOFT CLAY alerts are a big sticker: the status tint fills the whole slab,
  // plum ink carries every word, and the icon sits on a COIN of its own (the raw
  // svg child is styled into a 36px rounded square with its own padding),
  // echoing the date coins and the empty-state coin instead of floating as a
  // bare glyph. 20px corners put it between a control and a card, and the soft
  // clay lifts it off the page without a border doing the work.
  "group/alert relative grid w-full gap-y-1 overflow-hidden rounded-[1.25rem] border px-4 py-3.5 text-left text-sm shadow-xs has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:rounded-xl *:[svg]:p-2 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-9",
  {
    variants: {
      // The "raised voice" tier of the status idiom. Where a Badge whispers
      // inline status, an Alert is a message the user must read, so it takes the
      // full sticker rather than a tint of it: `bg-warning text-warning-foreground`
      // is one pair of class names that is correct in both themes (pastel fill
      // with plum ink by day, a 16% wash with pastel ink at night). Never add an
      // opacity modifier to those, or the night value gets washed twice. The
      // icon coin is `bg-current/10`, a tint of whatever the ink currently is, so
      // it darkens by day and lightens at night without a second token.
      variant: {
        default:
          "border-border bg-card text-card-foreground *:[svg]:bg-muted",
        success: "border-transparent bg-success text-success-foreground *:[svg]:bg-current/10",
        warning: "border-transparent bg-warning text-warning-foreground *:[svg]:bg-current/10",
        info: "border-transparent bg-info text-info-foreground *:[svg]:bg-current/10",
        // Blush, the "went wrong" sticker, not the saturated red of a delete
        // BUTTON. The variant keeps the name every caller spells.
        destructive:
          "border-transparent bg-danger text-danger-foreground *:[svg]:bg-current/10",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Alert({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof alertVariants>) {
  return (
    <div
      data-slot="alert"
      role="alert"
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-title"
      className={cn(
        "font-heading font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3",
        className
      )}
      {...props}
    />
  )
}

function AlertDescription({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      // Inherit the alert's ink at 90% rather than dropping to
      // --muted-foreground: on a mint or lemon sticker the muted plum is the
      // wrong family, and at night it would fight the pastel ink.
      className={cn(
        "text-sm text-current/90 text-balance md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_p:not(:last-child)]:mb-4",
        className
      )}
      {...props}
    />
  )
}

function AlertAction({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-action"
      className={cn("absolute top-3 right-3", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, AlertAction }
