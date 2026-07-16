import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // SOLSTICE buttons are soft rounded rectangles (rounded-lg, 8px — never
  // pills), and they are tactile: hover lifts them a hair (with a bigger,
  // softer shadow), press squashes them (scale 0.97, via ease-spring so the
  // release bounces back). Focus stays a real 2px OUTLINE offset from the
  // control, in --ring, not a box-shadow ring: (1) an outline sits in a gap
  // of the surface colour so it is visible on an iris button; (2) Windows
  // High Contrast Mode strips box-shadow but keeps outline; (3) a solid
  // outline can be contrast-checked, a `/50` ring cannot.
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-all duration-200 ease-spring outline-hidden select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive motion-reduce:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The CTA: a confident solid iris with an inset top highlight and a
        // soft iris glow (both live in --elevation-primary). Hover deepens
        // the fill a touch and swells the glow.
        default:
          "bg-primary text-primary-foreground shadow-primary hover:-translate-y-0.5 hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_8%)] hover:shadow-primary-lg active:translate-y-0",
        outline:
          "border-input bg-card hover:-translate-y-0.5 hover:bg-accent hover:text-accent-foreground hover:shadow-sm active:translate-y-0 aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:bg-input/30 dark:hover:bg-input/50",
        // Lilac fill, deep iris text: "Cancel" stays friendly.
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        // Ghost hovers BLUSH LILAC (--accent), not grey — the signature hover.
        ghost:
          "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground dark:hover:bg-accent/60",
        // Solid, per the status idiom: a destructive button is a consequential
        // action and should shout. This is the sole use of --destructive-foreground.
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_12%)] focus-visible:outline-destructive",
        link: "text-primary underline-offset-4 hover:underline",
      },
      // HouseRota: every height here is one step up from stock shadcn, which
      // tops out at 36px even on `lg`. This product's primary surface is a phone
      // tapped by someone standing in a kitchen, and 36px is below the 44px
      // minimum comfortable touch target. `lg` is exactly 44px and is what the
      // member page's CTAs use; `default` at 40px is the admin workhorse; `xs`
      // and `sm` stay tight because table-row actions are mouse targets.
      // Every size shares the rounded-lg base radius.
      //
      // If you re-run `shadcn add button --overwrite`, you will lose this. Put
      // it back.
      size: {
        default:
          "h-10 gap-2 px-5 has-data-[icon=inline-end]:pr-3.5 has-data-[icon=inline-start]:pl-3.5",
        xs: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3.5 text-[0.8rem] has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-6 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    // A submit in flight — "Asking Bob to cover…". Every screen that POSTs needs
    // this, so it lives on Button rather than being re-invented five times. It
    // shows a spinner in place of any leading icon, disables the button, and sets
    // aria-busy so assistive tech announces the wait. The label stays put so the
    // button does not resize mid-click. Ignored when asChild (a Slot renders an
    // arbitrary child and cannot own a spinner).
    loading?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled ?? (!asChild && loading)}
      aria-busy={!asChild && loading ? true : undefined}
      {...props}
    >
      {/* asChild forwards a SINGLE child to Radix's Slot, which throws on more
          than one — so the spinner path is only taken for a real <button>. When
          asChild, children pass through untouched (loading is ignored, as its
          jsdoc says). */}
      {asChild ? (
        children
      ) : (
        <>
          {loading ? <Loader2Icon className="animate-spin" aria-hidden /> : null}
          {children}
        </>
      )}
    </Comp>
  )
}

export { Button, buttonVariants }
