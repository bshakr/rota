import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The admin's account footer: who is signed in, and the way out. An identity
 * row — the same chart-choir-tinted avatar members get, with the name and
 * email truncating beside it — over a quiet ghost sign-out. The sign-out is a
 * plain form `action` (not an onClick handler) so it works without client JS
 * and the server action owns the redirect.
 */
export function SignOutButton({ email, name }: { email?: string; name?: string }) {
  const seed = name || email || "?";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 px-2 py-1">
        <Avatar>
          <AvatarFallback
            className={cn(avatarTint(seed), "text-xs font-semibold text-foreground")}
          >
            {initials(seed)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          {name ? <p className="truncate text-sm leading-tight font-medium">{name}</p> : null}
          {email ? (
            <p
              className={cn(
                "truncate text-muted-foreground",
                name ? "text-xs leading-tight" : "text-sm leading-tight font-medium",
              )}
              title={email}
            >
              {email}
            </p>
          ) : null}
        </div>
      </div>
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 px-2 text-muted-foreground"
        >
          <LogOut aria-hidden />
          Sign out
        </Button>
      </form>
    </div>
  );
}
