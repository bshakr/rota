import { Suspense } from "react";
import * as Sentry from "@sentry/nextjs";

import { requireHousehold } from "@/lib/auth/household";
import { isSuperAdmin } from "@/lib/auth/super-admin";

import { AdminShell } from "@/components/admin-shell";
import { SignOutButton } from "@/components/admin/sign-out-button";

import { AdminRouteFallback } from "./_components/admin-route-fallback";
import { PausedGate } from "./_components/paused-gate";

/**
 * The proxy starts login for unauthenticated visitors. This guard also requires
 * a selected household; the API client repeats it because pages and layouts may
 * render concurrently. Setup and the member route live outside this layout.
 *
 * The super admin allowlist is read HERE, on the server, and only the boolean
 * crosses into the client shell: the ids themselves never reach the browser.
 * It is a display decision and nothing more, since the area guards itself and
 * Rails guards the data.
 *
 * THE SHELL IS THE FALLBACK, NOT THE FRAME (BLO-1697). The layout awaits nothing
 * of Rails itself. It renders a Suspense boundary whose fallback is the shell
 * with a neutral placeholder in the main column, so the nav, the wordmark and
 * the theme toggle are on screen on the first flush, before the group probe has
 * been answered. Inside the boundary `PausedGate` asks the one question the area
 * depends on and returns either the whole paused screen or the same shell around
 * the page.
 *
 * It has to be shaped that way round, because the paused screen REPLACES the
 * shell rather than sitting inside it: a suspended house has no route the nav
 * could usefully lead to. Rendering the gate inside an already-open `AdminShell`
 * would have given it a sidebar, two wordmarks, two sign-out buttons and a
 * nested `<main>`. The fallback shell and the resolved shell are handed the very
 * same `shellProps` object, so the swap is the same DOM with the middle filled
 * in and nothing visibly jumps.
 *
 * `requireHousehold()` and the Sentry scope stay OUTSIDE the boundary,
 * deliberately. The first is the auth guard: it redirects rather than renders,
 * and a redirect decided before anything is flushed is a real 307 instead of a
 * meta tag the browser has to act on. It costs no Rails call, since AuthKit
 * reads the session cookie. The second has to be in place before the gate's
 * `/api/group` call, which is the first thing on an admin route that can fail.
 *
 * WHAT THIS COSTS THE PAGE. The group probe and the page's own fetches are two
 * serial round trips to Rails, not one: the page below only starts once the gate
 * has resolved. For the dashboard that is the probe, and then rotas, members,
 * shifts, failed texts and the calendar preview together, the calendar included
 * because it chains off the same `cache()`d group promise the gate has already
 * resolved. The second wait is covered by the route's own `loading.tsx`, which
 * is why the fallback here can be neutral.
 */
export default async function AdminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { user, organizationId } = await requireHousehold();
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || undefined;

  // Who and which household, on every event this request produces. The Node SDK
  // scopes both to the request, so one admin's id never rides along on another's
  // error. The WorkOS user id ONLY: an email or a name would put a person into
  // Sentry, which the privacy contract rules out, and an opaque id is enough to
  // ask "is this one admin or all of them". The member layout and the household
  // entry page set nothing at all, deliberately.
  Sentry.setUser({ id: user.id });
  Sentry.setTag("household", organizationId);

  // Built once and passed to both renders of the shell. The account element is
  // the same object in the fallback and in the resolved tree, which is what
  // makes the swap a no-op for everything outside the main column.
  const shellProps = {
    account: <SignOutButton email={user.email} name={name} />,
    superAdmin: isSuperAdmin(user.id),
  };

  return (
    <Suspense
      fallback={
        <AdminShell {...shellProps}>
          <AdminRouteFallback />
        </AdminShell>
      }
    >
      <PausedGate shellProps={shellProps}>{children}</PausedGate>
    </Suspense>
  );
}
