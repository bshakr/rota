import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // Focus is a real 2px OUTLINE offset from the control, in --ring, not a
  // box-shadow ring. Three reasons, all from review: (1) an outline sits in a
  // gap of the surface colour so it is visible on a clay button, where a
  // same-colour ring was 1:1; (2) Windows High Contrast Mode strips box-shadow
  // but keeps outline, so a ring-only focus vanishes there; (3) a solid outline
  // can be contrast-checked, a `/50` ring cannot. Hover on solid variants
  // darkens via color-mix toward --foreground rather than fading with `/80`,
  // which washed the fill toward the page and failed AA.
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-hidden select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_14%)]",
        outline:
          "border-input bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
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
      //
      // If you re-run `shadcn add button --overwrite`, you will lose this. Put
      // it back.
      size: {
        default:
          "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-[min(var(--radius-md),12px)] px-3 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 text-[0.9375rem] has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-10",
        "icon-xs":
          "size-7 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-8 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
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
