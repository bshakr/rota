import { ExternalLink } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GroupAdmin, ReportAdmin } from "@/lib/api/super-admin-groups";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { NO_EMAIL, workosUserUrl } from "@/lib/hq-groups";
import { plural } from "@/lib/hq-overview";

/**
 * Who runs the house.
 *
 * Two things here are decisions rather than layout.
 *
 * **"Not provided" rather than an address.** An AuthKit access token carries no
 * email unless the WorkOS JWT template was configured to add one, so a first
 * sighting is provisioned with a placeholder at an `.invalid` domain and Rails
 * serves that as null. Printing the placeholder would put an address on screen
 * that looks deliverable and is not, and somebody would eventually email it.
 *
 * **A link out to WorkOS rather than a button here.** Impersonation and password
 * resets live in the WorkOS dashboard, where they have an audit trail. Rebuilding
 * either in this console would mean building the audit trail too, so the console
 * hands over the id and gets out of the way — the plan's own decision.
 *
 * Last seen and the sign-in counts come from `report`
 * (https://linear.app/bloombase/issue/BLO-1679) and are simply omitted when that
 * key is not on the payload: they decorate a row whose identity comes from the
 * plain serializer, and a missing decoration is not a reason to show no admins.
 */
export function GroupAdmins({ admins, now }: { admins: (GroupAdmin | ReportAdmin)[]; now: Date }) {
  return (
    <Card>
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

/** `report`'s extra columns, when the payload carried them. */
function reportFields(admin: GroupAdmin | ReportAdmin): ReportAdmin | null {
  return "user_sign_in_count" in admin ? admin : null;
}

function AdminRow({ admin, now }: { admin: GroupAdmin | ReportAdmin; now: Date }) {
  const extra = reportFields(admin);
  const lastSeen = extra?.last_seen_at ? new Date(extra.last_seen_at) : null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p className="font-heading text-sm font-semibold break-words">{admin.name}</p>
        <p
          className={
            admin.email ? "text-muted-foreground text-xs break-all" : "text-muted-foreground text-xs"
          }
        >
          {admin.email ?? NO_EMAIL}
        </p>
        {extra ? (
          <p className="text-muted-foreground text-xs">
            {/* `user_`, and said out loud, because these are facts about the
                PERSON and not about this house: an admin of two houses shows the
                same count on both pages. A bare "12 sign-ins" on a page that is
                otherwise all about one house would read as "signed in to this
                house", which is exactly what it is not. */}
            {lastSeen ? (
              <>
                Last seen{" "}
                <time dateTime={extra.last_seen_at ?? undefined} title={formatTimestamp(lastSeen)}>
                  {relativeTime(lastSeen, now)}
                </time>
              </>
            ) : (
              // Not "Last seen nothing yet": a person who has never opened the app
              // has no last time, and the sentence has to say that rather than
              // fill the slot with a phrase that means nothing after "Last seen".
              "Never seen here"
            )}{" "}
            · {extra.user_sign_in_count_30d} sign-ins in the last 30 days,{" "}
            {extra.user_sign_in_count} all time, anywhere on Rota Monster
          </p>
        ) : null}
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
