import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GroupMember, ReportMember } from "@/lib/api/super-admin-groups";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { MEMBER_STATUS_PILL, memberRotasNote } from "@/lib/hq-groups";
import { plural } from "@/lib/hq-overview";

import { Empty } from "./group-admins";

/**
 * Everyone in the house, active or not.
 *
 * **The phone number is here, in full, and the magic-link token is not.** Those
 * are opposite decisions about the same row and both are deliberate. "Why didn't
 * Alice get her text" is usually answered by looking at the number — a wrong
 * country code, a landline, the same number typed twice — and a masked number
 * answers none of them. The token is a permanent login to somebody else's house,
 * the operator never needs it to answer any question this console asks, and so it
 * is not omitted by remembering to: `SuperAdmin::MemberSerializer` is a different
 * class from the house's own, with no branch that could turn one into the other.
 * There is no copy-link button here for the same reason.
 *
 * Removed housemates are shown rather than filtered out. Leaving a house is a
 * deactivation and never a destroy — the person is still the record of who was
 * responsible for past shifts — and "where did Ciara go" is a question this page
 * should be able to answer.
 */
export function GroupMembers({
  members,
  now,
}: {
  members: (GroupMember | ReportMember)[];
  now: Date;
}) {
  const active = members.filter((member) => member.status === "active").length;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Housemates</CardTitle>
        <CardDescription>
          {members.length === 0
            ? "Nobody has been added yet, so there is nobody to put on a rota."
            : `${active} active of ${members.length} ${plural(members.length, "housemate", "housemates")}. Numbers in full; personal links are never shown here.`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {members.length === 0 ? (
          <Empty>No housemates yet.</Empty>
        ) : (
          <ul className="divide-border divide-y">
            {members.map((member) => (
              <MemberRow key={member.id} member={member} now={now} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

/** `report`'s extra column, when the payload carried it. */
function lastSeenOf(member: GroupMember | ReportMember): string | null | undefined {
  return "last_seen_at" in member ? member.last_seen_at : undefined;
}

function MemberRow({ member, now }: { member: GroupMember | ReportMember; now: Date }) {
  const pill = MEMBER_STATUS_PILL[member.status];
  const lastSeenAt = lastSeenOf(member);
  const lastSeen = lastSeenAt ? new Date(lastSeenAt) : null;

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 space-y-1">
        <p className="font-heading text-sm font-semibold break-words">{member.name}</p>
        <p className="text-muted-foreground font-mono text-xs break-all">{member.phone_e164}</p>
        <p className="text-muted-foreground text-xs break-words">
          {memberRotasNote(member.rotas)}
          {lastSeenAt !== undefined ? (
            <>
              {" · "}
              {lastSeen ? (
                <>
                  opened their link{" "}
                  <time dateTime={lastSeenAt ?? undefined} title={formatTimestamp(lastSeen)}>
                    {relativeTime(lastSeen, now)}
                  </time>
                </>
              ) : (
                // The only evidence the product has that a magic link ever
                // arrived. "Never opened" beside a failing number is most of the
                // answer to why a house thinks the texts are not working.
                "never opened their link"
              )}
            </>
          ) : null}
        </p>
      </div>
      <Badge variant={pill.tone}>{pill.label}</Badge>
    </li>
  );
}
