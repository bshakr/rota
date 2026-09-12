"use client"

import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

// Toasts are the status idiom at its most fleeting: a 20px clay lozenge that
// takes the sticker for its tone, so "Text sent" arrives on mint and "Couldn't
// send" arrives on blush, with plum ink on both. Sonner writes its own inline
// styles, so the tone classes carry `!` to win.
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "1.25rem",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast rounded-[1.25rem]! font-sans! shadow-md!",
          // `bg-success text-success-foreground` is one pair that is correct in
          // both themes: pastel fill with plum ink by day, a 16% wash of itself
          // with pastel ink at night. No opacity modifier, or night washes twice.
          success: "bg-success! text-success-foreground! border-transparent!",
          info: "bg-info! text-info-foreground! border-transparent!",
          warning: "bg-warning! text-warning-foreground! border-transparent!",
          // Blush, the "went wrong" sticker, not the saturated delete red.
          error: "bg-danger! text-danger-foreground! border-transparent!",
          description: "text-current/85!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
