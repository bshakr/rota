import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { GroupDetail } from "@/lib/api/super-admin-groups";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { GROUPS_HREF, GROUP_STATUS_NOTE, GROUP_STATUS_PILL, timezoneNote } from "@/lib/hq-groups";

import { GroupActions } from "./group-actions";
import { GroupAdmins } from "./group-admins";
import { GroupMembers } from "./group-members";
import { GroupNotes } from "./group-notes";
import { GroupRotas } from "./group-rotas";

/**
 * One house, as the operator sees it.
 *
 * Takes its payload and its clock as arguments and fetches nothing, so the page
 * owns the request and the failure and this owns the layout — which is also what
 * lets the whole screen be rendered from a fixture for screenshots.
 *
 * FIRST CUT (https://linear.app/bloombase/issue/BLO-1676). The header, the three
 * actions, and who is in the house: admins, housemates, rotas, the note. What
 * this house is DOING — the warnings its own admins see, the next fortnight of
 * turns, twelve weeks of sparklines and the delivery log — is
 * https://linear.app/bloombase/issue/BLO-1680, and its data already arrives on
 * this payload under `report`. The slots are marked below rather than mocked: an
 * empty card promising a chart is a worse lie than a page that does not mention
 * one.
 */
export function GroupScreen({ detail, now }: { detail: GroupDetail; now: Date }) {
  const { group } = detail;
  const pill = GROUP_STATUS_PILL[group.status];
  const timezoneWarning = timezoneNote(group.timezone_confirmed);
  const created = new Date(group.created_at);

  // The report's rows carry two columns the plain serializers cannot know — when
  // an admin was last seen, and how often that person has signed in. Optional on
  // purpose (see the schema), so this page degrades to the identity columns
  // rather than blanking itself if that key ever goes away.
  const admins = detail.report?.admins ?? detail.admins;
  const members = detail.report?.members ?? detail.members;

  return (
    <>
      <Link
        href={GROUPS_HREF}
        className="text-muted-foreground hover:text-foreground mb-4 -ml-1 inline-flex items-center gap-1 rounded-md text-sm outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        All houses
      </Link>

      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <h1 className="font-heading text-2xl font-semibold tracking-[-0.01em] break-words">
              {group.name}
            </h1>
            <Badge variant={pill.tone}>{pill.label}</Badge>
          </div>

          <p className="text-muted-foreground max-w-prose text-sm text-pretty">
            {GROUP_STATUS_NOTE[group.status]}
            {group.suspended_at ? (
              <>
                {" "}
                Paused{" "}
                <time dateTime={group.suspended_at} title={formatTimestamp(new Date(group.suspended_at))}>
                  {relativeTime(new Date(group.suspended_at), now)}
                </time>
                .
              </>
            ) : null}
          </p>

          <dl className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
            <Fact term="Entry page">
              {/* The house's own public address. An operator chasing "my
                  housemates can't get a link" needs to be able to open the exact
                  page they were sent. */}
              <Link href={`/h/${group.slug}`} className="text-link font-mono break-all underline">
                /h/{group.slug}
              </Link>
            </Fact>
            <Fact term="Timezone">
              <span className="font-mono">{group.timezone}</span>
            </Fact>
            <Fact term="Created">
              <time dateTime={group.created_at} title={formatTimestamp(created)}>
                {relativeTime(created, now)}
              </time>
            </Fact>
            {timezoneWarning ? (
              <Badge variant="warning">Timezone {timezoneWarning.toLowerCase()}</Badge>
            ) : null}
          </dl>
        </div>

        {/* Primitives, not the payload: `GroupActions` is a Client Component and
            the operator API module it would otherwise pull in is server-only. */}
        <div className="shrink-0">
          <GroupActions
            groupId={group.id}
            name={group.name}
            timezone={group.timezone}
            notes={group.notes}
            suspended={group.status === "suspended"}
          />
        </div>
      </div>

      {/*
        BLO-1680 slots, deliberately empty rather than mocked:
          - Warnings, from `report.warnings_input` through `collectDashboardWarnings`,
            so the operator sees exactly the alerts the house admin sees.
          - Upcoming shifts: `report.upcoming_shifts`, the next 14 days with covers marked.
          - Usage sparklines: `report.weekly`, texts and covers per week for 12 weeks.
          - The delivery log: `recent_sms_messages` here, the filtered log at
            GET /api/super_admin/groups/:id/sms_messages.
          - Spend: `report.spend`, null until https://linear.app/bloombase/issue/BLO-1684.
        All five already ride on this payload. https://linear.app/bloombase/issue/BLO-1680
      */}

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="grid gap-6">
          <GroupAdmins admins={admins} now={now} />
          <GroupMembers members={members} now={now} />
        </div>

        <div className="grid gap-6">
          <GroupNotes notes={group.notes} />
          <GroupRotas rotas={detail.rotas} timezone={group.timezone} />
        </div>
      </div>
    </>
  );
}

/**
 * One header fact, as a real definition pair rather than a run of prose — so a
 * screen reader hears "Timezone, Europe/London" and not one long sentence with
 * four values in it. The `div` wrapper around each pair is what HTML allows a
 * `dl` for exactly this grouping.
 */
function Fact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5">
      <dt>{term}</dt>
      <dd className="text-foreground">{children}</dd>
    </div>
  );
}
