import Link from "next/link";
import { ChevronLeft } from "lucide-react";

import { SpendCard } from "@/components/spend-card";
import { Badge } from "@/components/ui/badge";
import type { GroupDetail, RedactedSms } from "@/lib/api/super-admin-groups";
import { formatTimestamp, relativeTime } from "@/lib/date";
import { groupToday } from "@/lib/group-dates";
import { GROUP_SECTION, type SmsLogFilters, UPCOMING_DAYS } from "@/lib/hq-group-report";
import { GROUPS_HREF, GROUP_STATUS_NOTE, GROUP_STATUS_PILL, timezoneNote } from "@/lib/hq-groups";
import type { HouseSpendWindow } from "@/lib/hq-spend";

import { GroupActions } from "./group-actions";
import { GroupAdmins } from "./group-admins";
import { GroupMembers } from "./group-members";
import { GroupNotes } from "./group-notes";
import { GroupRotas } from "./group-rotas";
import { GroupSmsLog } from "./group-sms-log";
import { GroupUpcoming } from "./group-upcoming";
import { GroupUsage } from "./group-usage";
import { GroupWarnings } from "./group-warnings";

/**
 * One house, as the operator sees it.
 *
 * Takes its payload and its clock as arguments and fetches nothing, so the page
 * owns the requests and the failure and this owns the layout — which is also what
 * lets the whole screen be rendered from a fixture for screenshots.
 *
 * THE ORDER IS THE PLAN'S (Group dashboard): header, warnings, admins, members,
 * rotas, upcoming shifts, usage, the delivery log, spend, the note. Read down the
 * page it answers, in that order: is this house in trouble, who is in it, what has
 * it set up, what happens next, is it still being used, and did the texts arrive.
 * The two-up rows pair cards that are read together and are of a size to sit side
 * by side; the sparklines and the log are full width, because a twelve-week series
 * and a five-column table both want the room and both stack cleanly on a phone.
 *
 * Every figure here comes from ONE payload and ONE instant. `now` is the page's
 * single clock, and the fortnight is measured from THIS HOUSE's today
 * (`groupToday`) rather than the server's — a house in Auckland must not be told
 * its Tuesday turn is "tomorrow" because London has not got there yet.
 */
export function GroupScreen({
  detail,
  now,
  smsMessages,
  smsFilters,
  spend,
}: {
  detail: GroupDetail;
  now: Date;
  smsMessages: RedactedSms[];
  smsFilters: SmsLogFilters;
  /**
   * The last ninety days narrowed to this house, or null when the spend payload
   * could not be counted. Null draws NO card rather than a zero: a cost that
   * failed to arrive and a house that cost nothing are opposite facts, and the
   * card has its own words for the second.
   */
  spend: HouseSpendWindow | null;
}) {
  const { group, report } = detail;
  const pill = GROUP_STATUS_PILL[group.status];
  const suspended = group.status === "suspended";
  const timezoneWarning = timezoneNote(group.timezone_confirmed);
  const created = new Date(group.created_at);
  const today = groupToday(now, group.timezone);

  return (
    <>
      <Link
        href={GROUPS_HREF}
        className="text-muted-foreground hover:text-foreground mb-4 -ml-1 inline-flex items-center gap-1 rounded-md text-sm outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronLeft className="size-4 shrink-0" aria-hidden />
        All houses
      </Link>

      {/* Anchored, because the unconfirmed-timezone warning sends the operator
          here: the fix is the "Rename & timezone" dialog in this block. */}
      <div
        id={GROUP_SECTION.header}
        className="mb-8 flex scroll-mt-24 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
      >
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
                <time
                  dateTime={group.suspended_at}
                  title={formatTimestamp(new Date(group.suspended_at))}
                >
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
            suspended={suspended}
          />
        </div>
      </div>

      <GroupWarnings input={report.warnings_input} />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        {/* `report.admins` and `report.members`, and no longer the plain top-level
            rows that used to ride beside them. They are the same people from the
            same serializers plus the columns only the report can know — last seen,
            and how often each admin has signed in — so reading both was two
            answers to one question. The duplicated keys have gone from the schema
            with them. */}
        <GroupAdmins admins={report.admins} now={now} />
        <GroupMembers members={report.members} now={now} />
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        <GroupRotas rotas={detail.rotas} timezone={group.timezone} suspended={suspended} />
        <GroupUpcoming
          shifts={report.upcoming_shifts}
          today={today}
          windowDays={UPCOMING_DAYS}
          suspended={suspended}
        />
      </div>

      <div className="mt-6 grid gap-6">
        <GroupUsage weeks={report.weekly} />

        <GroupSmsLog
          groupId={group.id}
          messages={smsMessages}
          filters={smsFilters}
          // Only the two primitives `SmsFilters` needs cross into the Client
          // Component. Handing it `report.members` would serialise every phone
          // number and last-seen stamp into the page's RSC payload to fill a
          // <select> with names.
          members={report.members.map(({ id, name }) => ({ id, name }))}
          rotas={detail.rotas.map(({ id, name }) => ({ id, name }))}
        />
      </div>

      {/* Spend, then the note — the plan's own last two. The card is fed from
          `getSpend(GROUP_SPEND_RANGE)` narrowed to this house
          (https://linear.app/bloombase/issue/BLO-1684) and NOT from
          `report.spend`, which Rails still sends as null: there is no per-group
          spend endpoint, so one house's figures are read out of the same payload
          the spend page draws, which is what stops the two ever disagreeing about
          what a house cost. */}
      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
        {spend ? <SpendCard spend={spend} houseName={group.name} /> : null}
        <GroupNotes notes={group.notes} />
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
