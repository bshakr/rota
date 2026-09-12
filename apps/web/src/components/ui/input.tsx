import * as React from "react"

import { cn } from "@/lib/utils"

// SOFT CLAY inputs are PILLS on white, bounded by --input (plum 55%, which is
// the one line in the system that has to clear 3:1 because it IS the control).
// Focus is a solid 2px ring in --ring plus a grape edge: solid rather than a
// translucent `/50`, because a translucent ring cannot be contrast-checked.
//
// Height is raised from stock shadcn's h-8 to h-10, so an input and a default
// Button line up in a row and neither is a cramped target on a phone. The pill
// eats its own corners, so horizontal padding grows to px-4.
//
// `text-base md:text-sm` is stock and must stay: below 16px, iOS Safari zooms
// the viewport when the field takes focus, which yanks the page sideways
// mid-typing. It is a phone bug fix wearing a font-size costume.
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-full border border-input bg-card px-4 py-2 text-base shadow-xs transition-colors outline-hidden file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
