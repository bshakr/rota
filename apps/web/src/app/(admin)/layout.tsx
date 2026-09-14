import * as Sentry from "@sentry/nextjs";

import { HousePausedScreen } from "@/components/house-paused";
import { getGroup, getMe } from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import { isGroupSuspended } from "@/lib/api/paused";
import { requireHousehold } from "@/lib/auth/household";
import { isSuperAdmin } from "@/lib/auth/super-admin";

import { AdminShell } from "@/components/admin-shell";
import { SignOutButton } from "@/components/admin/sign-out-button";

/**
 * The proxy starts login for unauthenticated visitors. This guard also requires
 * a selected household; the API client repeats it because pages and layouts may
 * render concurrently. Setup and the member route live outside this layout.
 *
 * The super admin allowlist is read HERE, on the server, and only the boolean
 * crosses into the client shell — the ids themselves never reach the browser.
 * It is a display decision and nothing more: the area guards itself, and Rails
 * guards the data.
 *
 * IT ALSO ASKS WHETHER THE HOUSE IS PAUSED, and that question has to be asked of
 * a GATED route. A suspended house (https://linear.app/bloombase/issue/BLO-1675)
 * refuses every `/api/*` call with 403 `group_suspended` — except `/api/me`,
 * which stays open precisely so a paused screen can still name the house. A
 * layout that called only `/api/me` would therefore get a cheerful 200 and render
 * the ordinary shell over a house that has been switched off. `getGroup()` is the
 * gated call, and it is `cache()`d in the client so the dashboard below does not
 * fetch the same group a second time.
 *
 * Asked once, here, rather than in each page: otherwise the paused screen would
 * depend on which screen the admin happened to open, and every page that later
 * grew a Rails call would have to remember to handle it.
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
  //
  // BEFORE the paused question below, not after: the `/api/group` call is the
  // first thing here that can fail, and an error raised while asking whether a
  // house is suspended should be attributed like any other.
  Sentry.setUser({ id: user.id });
  Sentry.setTag("household", organizationId);

  try {
    await getGroup();
  } catch (error) {
    if (isGroupSuspended(error)) return <PausedHouse email={user.email} name={name} />;
    // A redirect (an expired session heading for /auth/reauth), a notFound(), or
    // a dead API host: all rethrown, because Next's control-flow errors must
    // never be swallowed and a fetch that never reached Rails is not an answer.
    if (!isApiError(error)) throw error;
    // Any other refusal from Rails is left alone. The page below makes its own
    // call and owns its own error state; this layout asks one question, and an
    // unanswered question is not a reason to replace the whole app.
  }

  return (
    <AdminShell
      account={<SignOutButton email={user.email} name={name} />}
      superAdmin={isSuperAdmin(user.id)}
    >
      {children}
    </AdminShell>
  );
}

/**
 * The house's NAME comes from `/api/me`, the one route a suspended house still
 * answers, and it is fetched only on this path — a running house pays nothing for
 * it. If even that call fails the screen says "This house": the fact is the
 * message and the name is the courtesy.
 *
 * The screen itself is `HousePausedScreen`, which is a component rather than JSX
 * here so that it can be rendered from a fixture — a real screenshot of it would
 * mean suspending a real house behind a real WorkOS session.
 */
async function PausedHouse({ email, name }: { email: string; name?: string }) {
  let house: string | null = null;
  try {
    house = (await getMe()).group.name;
  } catch {
    // Deliberately swallowed. The paused screen must render either way, and there
    // is nothing an admin could do with the reason this second call failed.
  }

  return (
    <HousePausedScreen name={house} account={<SignOutButton email={email} name={name} />} />
  );
}
