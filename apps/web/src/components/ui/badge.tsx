import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // SOFT CLAY badges are STICKERS: a pill, a pastel tint, plum ink. They are the
  // quietest rung of the status idiom — an Alert is a message you must read, a
  // Badge is a label you glance at while scanning a table. Focus is a solid
  // offset outline in --ring, the same idiom as Button rather than a
  // translucent `/50` ring the contrast checker cannot verify. Only ever
  // visible when a badge is a link.
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-all outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        // The one loud sticker, for the label that has to win a row: grape fill,
        // white text, the soft clay rather than the primary button's own.
        default:
          "bg-primary text-primary-foreground shadow-xs [a]:hover:bg-grape-deep",
        // The workhorse: lilac tint, plum ink. "Active", "Fortnightly",
        // "covering Raph" all live here.
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        // The status stickers. `bg-success text-success-foreground` is ONE pair
        // of class names that is correct in both themes: by day the pastel is
        // the fill and plum is the ink, at night the fill drops to a 16% wash of
        // itself and the pastel becomes the ink. Never add an opacity modifier
        // here, or the night value gets washed twice.
        //   delivered -> success | queued/sending -> info
        //   pending/stale -> warning | failed -> destructive
        success: "bg-success text-success-foreground",
        warning: "bg-warning text-warning-foreground",
        info: "bg-info text-info-foreground",
        // Blush, not the saturated red: a failed text is a thing that WENT
        // WRONG, not a button that will destroy something. The variant keeps the
        // name `destructive` because every caller spells it that way, but it
        // wears --danger. The saturated --destructive belongs to Button.
        destructive: "bg-danger text-danger-foreground",
        outline:
          "border-border text-foreground [a]:hover:bg-accent [a]:hover:text-accent-foreground",
        ghost: "hover:bg-accent hover:text-accent-foreground",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
