import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  // SOLSTICE alerts are not stock tinted rectangles. Three bespoke moves:
  //   1. A leading ACCENT RAIL in the status hue (the before: bar, drawn in
  //      currentColor so each variant colours it for free) — the eye-catch.
  //   2. The icon sits on a soft tinted COIN (the raw svg child is styled
  //      into a 36px rounded square with its own padding), echoing the date
  //      coins and avatar chips, instead of floating as a bare glyph.
  //   3. Card-tier geometry: rounded-xl, a soft violet shadow, and roomier
  //      padding, so the alert belongs beside the cards it interrupts.
  "group/alert relative grid w-full gap-y-1 overflow-hidden rounded-xl border px-4 py-3.5 text-left text-sm shadow-xs before:absolute before:inset-y-3 before:left-0 before:w-[3px] before:rounded-r-full before:bg-current has-data-[slot=alert-action]:pr-18 has-[>svg]:grid-cols-[auto_1fr] has-[>svg]:gap-x-3 *:[svg]:row-span-2 *:[svg]:rounded-lg *:[svg]:p-2 *:[svg]:text-current *:[svg:not([class*='size-'])]:size-9",
  {
    // The "raised voice" tier of the status idiom. Where a Badge whispers inline
    // status, an Alert is a message the user must read — so the status variants
    // are strongly tinted AND bordered in the status colour (a --border hairline
    // wouldn't carry the urgency). The icon and title take the full status
    // colour; the description drops to /90 so the block stays readable; the
    // icon coin sits one tint deeper (/15) than the panel (/10). The BLO-1053
    // "confirm your timezone" warning is exactly this.
    variants: {
      variant: {
        default: "bg-card text-card-foreground *:[svg]:bg-muted",
        success:
          "border-success/30 bg-success/10 text-success *:[svg]:bg-success/15 *:data-[slot=alert-description]:text-success/90",
        warning:
          "border-warning/30 bg-warning/10 text-warning *:[svg]:bg-warning/15 *:data-[slot=alert-description]:text-warning/90",
        info: "border-info/30 bg-info/10 text-info *:[svg]:bg-info/15 *:data-[slot=alert-description]:text-info/90",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive *:[svg]:bg-destructive/15 *:data-[slot=alert-description]:text-destructive/90",
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
        "font-semibold group-has-[>svg]/alert:col-start-2 [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground",
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
      className={cn(
        "text-sm text-balance text-muted-foreground md:text-pretty [&_a]:underline [&_a]:underline-offset-3 [&_a]:hover:text-foreground [&_p:not(:last-child)]:mb-4",
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
