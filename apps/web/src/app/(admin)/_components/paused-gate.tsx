import { AdminShell } from "@/components/admin-shell";
import { HousePausedScreen } from "@/components/house-paused";
import { getGroup, getMe } from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import { isGroupSuspended } from "@/lib/api/paused";

/** Everything `AdminShell` takes except its children, so the two renders cannot drift apart. */
export type AdminShellProps = Omit<React.ComponentProps<typeof AdminShell>, "children">;

/**
 * "Is this house paused?", asked of a GATED route, with the answer standing in front of every
 * admin screen.
 *
 * A suspended house (https://linear.app/bloombase/issue/BLO-1675) refuses every `/api/*` call with
 * 403 `group_suspended`, except `/api/me`, which stays open precisely so a paused screen can still
 * name the house. Asking only `/api/me` would get a cheerful 200 and render the ordinary shell
 * over a house that has been switched off, so `getGroup()` is the call that has to be made. It is
 * `cache()`d in the client, so the dashboard below does not fetch the same group a second time.
 *
 * THIS COMPONENT OWNS THE SHELL, not the layout (BLO-1697). Either answer is a whole screen: a
 * running house gets `AdminShell` around the page, and a paused one gets `HousePausedScreen`
 * INSTEAD of it, with no sidebar behind it, exactly as the layout itself used to return it. It
 * suspends, so the layout can flush the same shell as a fallback first and the nav, the wordmark
 * and the theme toggle are on screen while Rails is still answering; when the question is settled
 * the fallback is swapped for the real shell plus the page, whose own loading.tsx then covers the
 * wait for the page's data.
 *
 * What crosses this boundary untouched:
 *
 *   - a `redirect()` (an expired session heading for /auth/reauth). Thrown inside a Suspense
 *     boundary it is not lost: once the shell has been flushed Next emits the redirect as a meta
 *     tag for the client to follow rather than as a 307, which is the documented behaviour of
 *     `redirect` in a streaming context. That meta refresh carries a one second delay, so an
 *     expired session shows the placeholder for about a second before it bounces;
 *   - a `notFound()`, and a dead API host: Next's control-flow errors must never be swallowed, and
 *     a fetch that never reached Rails is not an answer.
 *
 * Any OTHER refusal from Rails is left alone: this component asks one question, the page below
 * makes its own call and owns its own error state, and an unanswered question is not a reason to
 * replace the whole app.
 */
export async function PausedGate({
  shellProps,
  children,
}: Readonly<{ shellProps: AdminShellProps; children: React.ReactNode }>) {
  try {
    await getGroup();
  } catch (error) {
    if (isGroupSuspended(error)) return <PausedHouse account={shellProps.account} />;
    if (!isApiError(error)) throw error;
  }

  return <AdminShell {...shellProps}>{children}</AdminShell>;
}

/**
 * The house's NAME comes from `/api/me`, the one route a suspended house still answers, and it is
 * fetched only on this path, so a running house pays nothing for it. If even that call fails the
 * screen says "This house": the fact is the message and the name is the courtesy.
 *
 * The way out is the shell's own account control, handed straight through: the sign-out button an
 * admin would have found in the sidebar is the one they find under the notice, and there is only
 * one place in the layout that decides what it says.
 *
 * The screen itself is `HousePausedScreen`, which is a component rather than JSX here so that it
 * can be rendered from a fixture: a real screenshot of it would mean suspending a real house
 * behind a real WorkOS session.
 */
async function PausedHouse({ account }: { account: React.ReactNode }) {
  let house: string | null = null;
  try {
    house = (await getMe()).group.name;
  } catch {
    // Deliberately swallowed. The paused screen must render either way, and there is nothing an
    // admin could do with the reason this second call failed.
  }

  return <HousePausedScreen name={house} account={account} />;
}
