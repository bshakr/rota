import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // SOLSTICE badges are little candy pills: a touch taller and bolder than
  // stock so they read as cheerful stickers rather than metadata. Focus is a
  // solid offset outline in --ring, the same idiom as Button — not a
  // translucent /50 ring, which this system's own rule forbids and the contrast
  // checker cannot verify. Only ever visible when a badge is a link.
  "group/badge inline-flex h-[1.375rem] w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap transition-all outline-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 aria-invalid:border-destructive [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive dark:bg-destructive/20 [a]:hover:bg-destructive/20",
        // HouseRota additions. The SMS delivery log has four outcomes and stock
        // shadcn only ships one of them (destructive), so without these each
        // screen would hand-roll its own green. Tinted rather than solid, to
        // match `destructive` above — a whisper, per the status idiom.
        //   delivered -> success | queued/sending -> info
        //   pending/stale -> warning | failed -> destructive
        success: "bg-success/10 text-success dark:bg-success/20",
        warning: "bg-warning/10 text-warning dark:bg-warning/20",
        info: "bg-info/10 text-info dark:bg-info/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
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
