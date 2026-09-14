import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ReportAdmin } from "@/lib/api/super-admin-groups";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { ADMIN_SIGN_INS_LABEL, GROUP_SECTION } from "@/lib/hq-group-report";
import { adminLabel, workosUserUrl } from "@/lib/hq-groups";
import { plural } from "@/lib/hq-overview";
import { cn } from "@/lib/utils";

/**
 * Who runs the house.
 *
 * Four things here are decisions rather than layout.
 *
 * **"Not provided" rather than an address.** An AuthKit access token carries no
 * email unless the WorkOS JWT template was configured to add one, so a first
 * sighting is provisioned with a placeholder at an `.invalid` domain and Rails
 * serves that as null. Printing the placeholder would put an address on screen
 * that looks deliverable and is not, and somebody would eventually email it.
 *
 * **A row where WorkOS never sent a NAME either.** The same token carries no
 * `name` claim unless the template adds one, so `users.name` can be null too and
 * Rails serves it as null. The heading falls back to the address, and to "No name
 * yet" when there is not even one — `adminLabel` in src/lib/hq-groups.ts owns the
 * decision, because the two lines swap roles and that is logic, not layout
 * (https://linear.app/bloombase/issue/BLO-1694).
 *
 * **A link out to WorkOS rather than a button here.** Impersonation and password
 * resets live in the WorkOS dashboard, where they have an audit trail. Rebuilding
 * either in this console would mean building the audit trail too, so the console
 * hands over the id and gets out of the way — the plan's own decision.
 *
 * **Last seen and the two sign-in counts are always here.** They come from
 * `report.admins` (https://linear.app/bloombase/issue/BLO-1679), which is the
 * house's own `SuperAdmin::AdminSerializer` row plus the three columns a plain
 * serializer has no way to know. This card used to take either shape and degrade;
 * it does not any more, because the page dropped the duplicated top-level
 * `admins` read in favour of this one. One list of people, one answer.
 *
 * The sign-in counts are said in full — "sign-ins, all houses" — rather than
 * printed as bare numbers. They are facts about the PERSON, every organization
 * and none (Rails' own `user_` prefix says so), so an admin of two houses shows
 * the same figure on both pages. A bare "12 sign-ins" on a page that is otherwise
 * entirely about one house reads as "signed in to this house", which is exactly
 * what it is not.
 */
export function GroupAdmins({ admins, now }: { admins: ReportAdmin[]; now: Date }) {
  return (
    <Card id={GROUP_SECTION.admins} className="scroll-mt-24">
      <CardHeader>
        <CardTitle>Admins</CardTitle>
        <CardDescription>
          {admins.length === 0
            ? "Nobody administers this house, which should not be possible: a house is created by its first admin."
            : `${admins.length} ${plural(admins.length, "person", "people")} can change this house's rotas and housemates.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {admins.length === 0 ? (
          <Empty>No admins on this house.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {admins.map((admin) => (
              <AdminRow key={admin.id} admin={admin} now={now} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function AdminRow({ admin, now }: { admin: ReportAdmin; now: Date }) {
  const lastSeen = admin.last_seen_at ? new Date(admin.last_seen_at) : null;
  // Both lines at once, because which fact goes in which slot depends on which
  // of the two we actually hold. See `adminLabel` in src/lib/hq-groups.ts.
  const label = adminLabel(admin);

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p
          className={cn(
            "font-heading text-sm font-semibold",
            label.headingIsEmail ? "break-all" : "break-words",
            // Muted only when the heading is the phrase itself: an address
            // standing in for a name is still a fact about this person.
            label.headingIsPlaceholder && "text-muted-foreground font-normal",
          )}
        >
          {label.heading}
        </p>
        <p
          className={cn("text-muted-foreground text-xs", label.note === admin.email && "break-all")}
        >
          {label.note}
        </p>
        <p className="text-muted-foreground text-xs text-pretty">
          {lastSeen ? (
            <>
              Last seen{" "}
              <time dateTime={admin.last_seen_at ?? undefined} title={formatTimestamp(lastSeen)}>
                {relativeTime(lastSeen, now)}
              </time>
            </>
          ) : (
            // Not "Last seen nothing yet": a person who has never opened the app
            // has no last time, and the sentence has to say that rather than fill
            // the slot with a phrase that means nothing after "Last seen".
            "Never seen here"
          )}{" "}
          · {ADMIN_SIGN_INS_LABEL}: {admin.user_sign_in_count_30d} in the last 30 days,{" "}
          {admin.user_sign_in_count} all time
        </p>
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Badge variant="secondary">{admin.role}</Badge>
        <a
          href={workosUserUrl(admin.workos_user_id)}
          target="_blank"
          rel="noreferrer"
          className="text-link inline-flex items-center gap-1 rounded-md text-xs underline underline-offset-4 outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          WorkOS
          <ExternalLink className="size-3 shrink-0" aria-hidden />
          <span className="sr-only">(opens the WorkOS dashboard in a new tab)</span>
        </a>
      </div>
    </li>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-muted-foreground bg-muted/60 rounded-xl px-4 py-6 text-center text-sm">
      {children}
    </p>
  );
}
