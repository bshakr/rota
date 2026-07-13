import * as React from "react";

import { cn } from "@/lib/utils";

// A multi-line control for the message template. shadcn's Textarea isn't in this
// project's `ui/` set, so this is a local one styled to match `Input` exactly
// (same border, radius, focus ring, invalid state, and the `text-base md:text-sm`
// that stops iOS Safari zooming on focus). Kept in the rota feature rather than
// added to the shared primitives, since the template editor is the only surface
// that needs it.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-24 w-full min-w-0 rounded-lg border border-input bg-transparent px-3 py-2 text-base transition-colors outline-hidden placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
