import Link from "next/link";
import { ArrowDown, Building2, ChevronRight, SearchX } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { GroupRow } from "@/lib/api/super-admin-groups";
import { formatTimestamp, relativeTime } from "@/lib/date";
import {
  GROUPS_HREF,
  GROUP_SORT_LABELS,
  GROUP_STATUS_PILL,
  type GroupSort,
  type GroupsFilters,
  NO_ACTIVITY,
  NO_FILTERS,
  groupsHref,
  hasNarrowingFilters,
  rotaCountsNote,
  textTroubleNote,
  timezoneNote,
} from "@/lib/hq-groups";
import { plural } from "@/lib/hq-overview";
import { cn } from "@/lib/utils";

import { GroupsFilters as FilterBar } from "./groups-filters";

/**
 * Every house on Rota Monster, one row each.
 *
 * Takes its rows, its filter state and its clock as arguments and fetches
 * nothing — the page owns the request and the failure, this owns the layout,
 * which is what lets the whole screen be rendered from a fixture for screenshots.
 *
 * TWO PRESENTATIONS OF ONE ROW. A table from `md` up, because eleven figures per
 * house is a comparison and a table is what a comparison is for; a card stack
 * below it, because eleven columns on a 390px screen is either a horizontal
 * scroll nobody finds the right-hand end of or type too small to read. Both are
 * built from the same `viewFor`, so they cannot drift.
 *
 * The whole row is the link. An operator scanning for a failing house is aiming
 * at the house, not at its name.
 */
export function GroupsScreen({
  groups,
  filters,
  now,
}: {
  groups: GroupRow[];
  filters: GroupsFilters;
  now: Date;
}) {
  const narrowed = hasNarrowingFilters(filters);

  return (
    <>
      <PageHeader
        title="Houses"
        description="Every house on Rota Monster, with what it has sent this week and whether anyone is still there. Open one for its admins, housemates, rotas and the actions."
        actions={
          <span className="text-muted-foreground text-xs">
            {groups.length} {plural(groups.length, "house", "houses")}
            {narrowed ? " matching" : ""}
          </span>
        }
      />

      <FilterBar filters={filters} />

      {groups.length === 0 ? (
        narrowed ? (
          <EmptyState
            icon={SearchX}
            title="No houses match these filters"
            description="Nothing here for this combination. Widen the status, drop a filter, or clear them all to see every house."
            action={
              <Button asChild variant="outline" size="sm">
                <Link href={groupsHref({ ...NO_FILTERS, sort: filters.sort })}>Clear filters</Link>
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={Building2}
            title="No houses yet"
            description="The first house to sign up will appear here, with its admins, its housemates and everything it sends."
          />
        )
      ) : (
        <>
          {/* md and up: the table, in a card-radius clay panel. */}
          <div className="border-border bg-card hidden overflow-hidden rounded-2xl border shadow-sm md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  {/* Seven columns, not eight. The shell's container is 64rem
                      wide, and the timezone earned its own column right up until
                      the status pill — the thing this list is scanned FOR — was
                      pushed off the right-hand edge by it. It now rides under the
                      slug, where it is beside the house it belongs to. */}
                  <SortableHead sort="name" filters={filters} />
                  <SortableHead sort="created" filters={filters} />
                  <TableHead className={CELL}>People</TableHead>
                  <TableHead className={CELL}>Rotas</TableHead>
                  <SortableHead sort="texts" filters={filters} />
                  <SortableHead sort="last_activity" filters={filters} />
                  <TableHead className={cn(CELL, "text-right")}>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <GroupTableRow key={group.id} group={group} now={now} />
                ))}
              </TableBody>
            </Table>
          </div>

          {/* below md: the card stack, from the same data. */}
          <div className="flex flex-col gap-3 md:hidden">
            {groups.map((group) => (
              <GroupCard key={group.id} group={group} now={now} />
            ))}
          </div>
        </>
      )}
    </>
  );
}

/**
 * Everything a row reads off a house, derived once so the table and the card
 * cannot disagree about the same figures.
 */
function viewFor(group: GroupRow, now: Date) {
  const activity = group.last_activity_at ? new Date(group.last_activity_at) : null;
  const created = new Date(group.created_at);

  return {
    pill: GROUP_STATUS_PILL[group.status],
    timezoneWarning: timezoneNote(group.timezone_confirmed),
    // Two lines in the table, one joined line on a card. The stacked form is what
    // lets seven columns fit a 64rem container without the pill falling off it.
    admins: `${group.admins_count} ${plural(group.admins_count, "admin", "admins")}`,
    actives: `${group.active_members_count} active`,
    people: `${group.admins_count} ${plural(group.admins_count, "admin", "admins")} · ${group.active_members_count} active`,
    rotas: rotaCountsNote(
      group.running_rotas_count,
      group.paused_rotas_count,
      group.draft_rotas_count,
    ),
    trouble: textTroubleNote(group.failed_texts_last_7_days, group.unsent_texts_last_7_days),
    created,
    createdNote: relativeTime(created, now),
    activity,
    activityNote: activity ? relativeTime(activity, now) : NO_ACTIVITY,
  };
}

/**
 * A column header that is also the way to sort by it.
 *
 * Only the four orders `SuperAdmin::GroupsController::SORTS` actually has are
 * offered, and each has ONE direction — the useful one (newest house, most texts,
 * most recent activity, names A to Z). A header that offered a direction the API
 * ignores would sort by name while claiming otherwise, which is worse than not
 * being sortable at all.
 */
function SortableHead({ sort, filters }: { sort: GroupSort; filters: GroupsFilters }) {
  const active = filters.sort === sort;

  return (
    <TableHead className={CELL} aria-sort={active ? "descending" : "none"}>
      <Link
        href={groupsHref({ ...filters, sort })}
        scroll={false}
        className={cn(
          "inline-flex items-center gap-1 rounded-md outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          active ? "text-foreground" : "hover:text-foreground",
        )}
      >
        {GROUP_SORT_LABELS[sort]}
        {active ? <ArrowDown className="size-3 shrink-0" aria-hidden /> : null}
        {active ? <span className="sr-only">(sorted by this)</span> : null}
      </Link>
    </TableHead>
  );
}

/**
 * Tighter than the default cell, and allowed to WRAP.
 *
 * `Table`'s own cells are `px-4 whitespace-nowrap`, which is right for a log of
 * short values and wrong for seven columns of sentences inside a 64rem container:
 * the nowrap pushed the status pill past the right-hand edge, where the one thing
 * an operator scans this list for could not be seen at all.
 */
const CELL = "px-3 whitespace-normal";

function GroupTableRow({ group, now }: { group: GroupRow; now: Date }) {
  const view = viewFor(group, now);

  return (
    // `relative` so the name's link can stretch across the whole row: an operator
    // scanning for a failing house is aiming at the HOUSE, not at its name. The
    // accessible name stays the house's own, because only the anchor's own text is
    // read out — the overlay is a pseudo-element with nothing in it.
    <TableRow className="hover:bg-accent/60 relative">
      <TableCell className={cn(CELL, "font-medium")}>
        <Link
          href={`${GROUPS_HREF}/${group.id}`}
          className="after:absolute after:inset-0 relative rounded-md outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span className="font-heading font-semibold break-words">{group.name}</span>
        </Link>
        <span className="text-muted-foreground block font-mono text-xs break-all">
          {group.slug}
        </span>
        <span className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {group.timezone}
          {/* The sticker, not bare ink: `--warning-foreground` is plum by day and
              a pastel by night, and neither is a checked pairing against the
              page. The badge carries the token pair the system measures. */}
          {view.timezoneWarning ? <Badge variant="warning">{view.timezoneWarning}</Badge> : null}
        </span>
      </TableCell>
      <TableCell className={cn(CELL, "text-xs")}>
        <time dateTime={group.created_at} title={formatTimestamp(view.created)}>
          {view.createdNote}
        </time>
      </TableCell>
      <TableCell className={cn(CELL, "text-muted-foreground text-xs")}>
        <span className="block">{view.admins}</span>
        <span className="block">{view.actives}</span>
      </TableCell>
      <TableCell className={cn(CELL, "text-muted-foreground text-xs")}>{view.rotas}</TableCell>
      <TableCell className={CELL}>
        <span className="font-heading block font-semibold">{group.texts_last_7_days}</span>
        {view.trouble ? (
          <span className="text-destructive block text-xs font-medium">{view.trouble}</span>
        ) : null}
      </TableCell>
      <TableCell className={cn(CELL, "text-muted-foreground text-xs")}>
        {view.activity ? (
          <time dateTime={group.last_activity_at ?? undefined} title={formatTimestamp(view.activity)}>
            {view.activityNote}
          </time>
        ) : (
          view.activityNote
        )}
      </TableCell>
      <TableCell className={cn(CELL, "text-right")}>
        <Badge variant={view.pill.tone}>{view.pill.label}</Badge>
      </TableCell>
    </TableRow>
  );
}

function GroupCard({ group, now }: { group: GroupRow; now: Date }) {
  const view = viewFor(group, now);

  return (
    // `relative` so the stretched link below covers the whole card, exactly as the
    // table row does: on a phone the card IS the row.
    <Card size="sm" className="hover:bg-accent/40 relative transition-colors">
      <CardHeader>
        <CardTitle className="text-sm">
          <Link
            href={`${GROUPS_HREF}/${group.id}`}
            className="after:absolute after:inset-0 rounded-md outline-hidden focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            <span className="break-words">{group.name}</span>
          </Link>
        </CardTitle>
        <span className="text-muted-foreground block font-mono text-xs break-all">
          {group.slug}
        </span>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={view.pill.tone}>{view.pill.label}</Badge>
          <span className="text-muted-foreground text-xs">
            {group.timezone}
            {view.timezoneWarning ? ` · ${view.timezoneWarning}` : ""}
          </span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <Cell term="People" detail={view.people} />
          <Cell term="Rotas" detail={view.rotas} />
          <Cell
            term="Texts (7d)"
            detail={`${group.texts_last_7_days}${view.trouble ? ` · ${view.trouble}` : ""}`}
            alert={Boolean(view.trouble)}
          />
          <Cell term="Last activity" detail={view.activityNote} />
        </dl>
        <p className="text-muted-foreground flex items-center gap-1 text-xs">
          Created {view.createdNote}
          <ChevronRight className="ml-auto size-4 shrink-0" aria-hidden />
        </p>
      </CardContent>
    </Card>
  );
}

function Cell({ term, detail, alert }: { term: string; detail: string; alert?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className={cn("break-words", alert ? "text-destructive font-medium" : undefined)}>
        {detail}
      </dd>
    </div>
  );
}
