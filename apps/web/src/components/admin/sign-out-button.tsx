import { LogOut } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";
import { avatarTint } from "@/lib/avatar-tint";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The admin's account footer: who is signed in, and the way out. An identity
 * row, with the same pastel-tinted avatar members get and the name and email
 * truncating beside it, over a quiet ghost sign-out pill. The sign-out is a
 * plain form `action` (not an onClick handler) so it works without client JS
 * and the server action owns the redirect.
 */
export function SignOutButton({ email, name }: { email?: string; name?: string }) {
  const seed = name || email || "?";

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2.5 px-1.5 py-1">
        <Avatar>
          <AvatarFallback
            className={cn(avatarTint(seed), "text-foreground text-xs font-semibold")}
          >
            {initials(seed)}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          {name ? <p className="truncate text-sm leading-tight font-medium">{name}</p> : null}
          {email ? (
            <p
              className={cn(
                "text-muted-foreground truncate",
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
          className="text-muted-foreground w-full justify-start gap-2"
        >
          <LogOut aria-hidden />
          Sign out
        </Button>
      </form>
    </div>
  );
}
