"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

/**
 * `className` reaches the trigger Button, and exists for exactly one caller: the
 * super admin HQ band. Ghost's hover tint and focus ring are measured against the
 * PAGE, and the band is plum in both themes — the ring lands at 1.5:1 there by
 * day and the hover fill at 1.08:1 at night. A surface that opts out of the page
 * colours has to hand the control its own, and merging here is how, rather than
 * teaching the toggle about a surface it should know nothing about.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  // No `mounted` guard, and none is needed. The icon is swapped by CSS off the
  // .dark class, which next-themes stamps on <html> before React runs, so server
  // and client agree by construction. The menu is portalled and only mounts on
  // open, well after hydration, so reading `theme` there is safe.
  //
  // A RADIO GROUP, not plain items: a screen-reader user must be able to tell
  // which theme is active, and the old colour-only tint did not convey that.
  // Radix gives each item role="menuitemradio" with aria-checked from the value.
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* `relative` is load-bearing: the Moon below is absolutely positioned
            and would otherwise anchor to whatever ancestor happens to be
            positioned, which is a different element on every screen. */}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Change theme"
          className={cn("relative", className)}
        >
          <Sun className="size-[18px] scale-100 rotate-0 transition-transform dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute size-[18px] scale-0 rotate-90 transition-transform dark:scale-100 dark:rotate-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup
          value={theme}
          onValueChange={(value) => setTheme(value)}
        >
          {OPTIONS.map(({ value, label, icon: Icon }) => (
            <DropdownMenuRadioItem key={value} value={value}>
              <Icon className="size-4" />
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
