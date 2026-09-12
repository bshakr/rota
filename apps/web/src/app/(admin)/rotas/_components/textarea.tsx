import * as React from "react";

import { cn } from "@/lib/utils";

// A multi-line control for the message template. shadcn's Textarea isn't in this
// project's `ui/` set, so this is a local one styled to match `Input`: same
// white fill, same --input boundary, same focus ring and invalid state, and the
// `text-base md:text-sm` that stops iOS Safari zooming on focus.
//
// The ONE deliberate difference is the radius. Every control in Soft Clay is a
// pill, but a pill is a shape for one line of text: at three rows the caret
// would start inside the curve. So this takes the card step (24px) instead,
// which is the nearest thing in the ramp to a pill that still has flat sides.
//
// Kept in the rota feature rather than added to the shared primitives, since the
// template editor is the only surface that needs it.
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input bg-card placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-destructive/25 min-h-24 w-full min-w-0 rounded-2xl border px-4 py-3 text-base shadow-xs transition-[color,box-shadow] outline-hidden focus-visible:ring-3 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
