import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";
import { signOutAction } from "@/lib/auth/actions";

/**
 * The admin's account footer: who is signed in, and the way out. A plain form
 * `action` (not an onClick handler) so sign-out works without client JS and the
 * server action owns the redirect.
 */
export function SignOutButton({ email }: { email?: string }) {
  return (
    <div className="flex flex-col gap-1">
      {email ? (
        <p className="text-muted-foreground truncate px-3 text-xs" title={email}>
          {email}
        </p>
      ) : null}
      <form action={signOutAction}>
        <Button
          type="submit"
          variant="ghost"
          className="text-muted-foreground w-full justify-start gap-2"
        >
          <LogOut className="size-4" aria-hidden />
          Sign out
        </Button>
      </form>
    </div>
  );
}
