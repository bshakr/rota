import * as React from "react"

import { cn } from "@/lib/utils"

// HouseRota: raised from stock shadcn's h-8 to h-10, so an input and a
// default Button line up in a row and neither is a cramped target on a phone.
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
        // SOLSTICE: soft rounded rectangles, the same rounded-lg as the
        // buttons they sit beside.
        "h-10 w-full min-w-0 rounded-lg border border-input bg-transparent px-3.5 py-2 text-base transition-colors outline-hidden file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className
      )}
      {...props}
    />
  )
}

export { Input }
