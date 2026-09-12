import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Loader2Icon } from "lucide-react"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  // SOFT CLAY buttons are PILLS, set in Fredoka, and they behave like a thing
  // you press: hover lifts them a pixel, press squashes them (scale 0.97) and
  // ease-spring bounces the release. Focus stays a real 2px OUTLINE offset from
  // the control, in --ring, not a box-shadow ring: (1) an outline sits in a gap
  // of the surface colour so it stays visible on a grape fill; (2) Windows High
  // Contrast Mode strips box-shadow but keeps outline; (3) a solid outline can
  // be contrast-checked, a `/50` ring cannot.
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding font-heading text-sm font-semibold whitespace-nowrap transition-all duration-200 ease-spring outline-hidden select-none hover:-translate-y-px focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-0 active:not-aria-[haspopup]:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive motion-reduce:hover:translate-y-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // The CTA, and usually the only saturated thing on the screen: a grape
        // pill wearing its own clay. `shadow-grape` draws the highlight and the
        // squash INSIDE the fill and drops a grape shadow rather than a plum
        // one, so the button looks pressed out of the same material it sits on.
        // Hover DEEPENS to grape-600; it never fades the fill, because a
        // translucent primary stops being contrast-checkable.
        default:
          "bg-primary text-primary-foreground shadow-grape hover:bg-grape-deep aria-expanded:bg-grape-deep",
        // Lilac fill, plum label: "Cancel" reads as friendly rather than
        // administrative. The hover is a color-mix, not a deeper token, because
        // lilac is a pastel by day and a deep plum-violet at night, and one
        // fixed hover colour cannot serve both.
        secondary:
          "bg-secondary text-secondary-foreground shadow-xs hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)] aria-expanded:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_7%)]",
        // White clay with a real --input boundary (plum 55%, which clears 3:1).
        outline:
          "border-input bg-card shadow-xs hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        // Ghost hovers BLUSH LILAC (--accent), never grey. The signature hover.
        ghost:
          "hover:bg-accent hover:text-accent-foreground aria-expanded:bg-accent aria-expanded:text-accent-foreground",
        // The one saturated red in the system. --destructive is a real
        // destructive BUTTON, a different job from the blush "went wrong"
        // sticker (--danger) that Badge and Alert wear, so this one shouts.
        destructive:
          "bg-destructive text-destructive-foreground shadow-xs hover:bg-[color-mix(in_oklch,var(--destructive),var(--foreground)_12%)] focus-visible:outline-destructive",
        // text-link, not text-primary: the same grape doing a TEXT job, which
        // has to lift at night to stay legible on a deep plum page. A link does
        // not lift on hover, because it is type rather than a control.
        link: "text-link underline-offset-4 hover:translate-y-0 hover:underline",
      },
      // Every height here is one step up from stock shadcn, which tops out at
      // 36px even on `lg`. This product's primary surface is a phone tapped by
      // someone standing in a kitchen, and 36px is below the 44px minimum
      // comfortable touch target. `lg` is exactly 44px and is what the member
      // page's CTAs use; `default` at 40px is the admin workhorse; `xs` and `sm`
      // stay tight because table-row actions are mouse targets.
      //
      // Horizontal padding is 4px wider than it was as a rounded rectangle: a
      // pill eats its own corners, so the label needs the room back.
      //
      // If you re-run `shadcn add button --overwrite`, you will lose this. Put
      // it back.
      size: {
        default:
          "h-10 gap-2 px-6 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-3 text-xs has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-4 text-[0.8rem] has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-7 text-[0.9375rem] has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
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
    // A submit in flight, as in "Asking Raph to cover…". Every screen that POSTs
    // needs this, so it lives on Button rather than being re-invented five
    // times. It shows a spinner in place of any leading icon, disables the
    // button, and sets aria-busy so assistive tech announces the wait. The label
    // stays put so the button does not resize mid-click. Ignored when asChild (a
    // Slot renders an arbitrary child and cannot own a spinner).
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
          than one, so the spinner path is only taken for a real <button>. When
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
