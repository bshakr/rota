import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Repeat } from "lucide-react";

import { DashboardWarnings } from "@/components/dashboard-warnings";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  getGroup,
  listCalendarEvents,
  listGroupShifts,
  listMembers,
  listRotas,
  listSmsMessages,
} from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import type { CalendarEventsResponse, MemberRef } from "@/lib/api/types";
import type { FeedEvent } from "@/lib/calendar-view";
import { collectDashboardWarnings } from "@/lib/dashboard";
import { buildDayRows, eventsByDay, nextWeekRangeLabel } from "@/lib/day-rows";
import { compareCivil, groupToday, isNextWeek, isThisWeek } from "@/lib/group-dates";

import { DashboardHero } from "./_components/dashboard-hero";
import { GroupSettings } from "./_components/group-settings";
import { HouseholdEntryLink } from "./_components/household-entry-link";
import { NextWeek } from "./_components/next-week";
import { WeekGlance, type WeekShift } from "./_components/week-glance";

export const metadata: Metadata = { title: "Dashboard" };

// Live, per-request, behind auth — never statically prerendered.
export const dynamic = "force-dynamic";

// The unconfirmed-timezone warning links to the group-settings section on this
// same screen (below), so the complaint and the fix are never a navigation apart.
const SETTINGS_HREF = "#group-settings";

export default async function DashboardPage() {
  // ONE WAVE (BLO-1697). Every call the dashboard needs starts here, together, rather than in
  // four rounds of waiting: the house, its rotas, its people, every upcoming turn, and the failed
  // texts. The turns used to be one request per running rota, which made the slowest screen in the
  // app get slower as a house got busier. The group is asked for again rather than passed down:
  // `getGroup()` is `cache()`d, so the (admin) layout's paused probe has already answered this and
  // it costs no second round trip.
  const groupPromise = getGroup();

  // The one call that genuinely depends on an answer: there is no calendar to preview until the
  // group says it has one. Chaining it off the group promise starts it the instant the group lands
  // instead of after the rest of the wave, and an unconnected house pays nothing for the question.
  const calendarPromise: Promise<CalendarEventsResponse> = groupPromise.then(({ group }) =>
    group.calendar ? listCalendarEvents(30) : { events: [] },
  );

  // Three of the six may fail softly. They fall back to an empty list rather than blanking a
  // screen the admin could still use, and every one of them rethrows anything that is not an
  // ApiError, notably the sign-in redirect the client throws on a 401. That is also why this is
  // not Promise.allSettled: settling would capture the redirect and strand the admin on a
  // half-rendered page. The group, the rotas and the people still throw; without them there is no
  // dashboard to draw.
  //
  // The trade the single request buys: a failed shifts call now drops EVERY rota's turns rather
  // than one rota's. One round trip for the whole house is worth it, and the failure it replaces
  // was never partial in practice (the calls shared a token, a host and a response time).
  const [
    { group },
    { rotas },
    { members },
    { shifts },
    { sms_messages: failedSms },
    { events: calendarEvents },
  ] = await Promise.all([
    groupPromise,
    listRotas(),
    listMembers(),
    listGroupShifts().catch(emptyOnApiError({ shifts: [] })),
    listSmsMessages({ status: "failed", limit: 100 }).catch(emptyOnApiError({ sms_messages: [] })),
    calendarPromise.catch(emptyOnApiError({ events: [] })),
  ]);

  // One instant for the whole render: `today` is the group's own calendar day, and
  // `now` is what the calendar card measures "last checked" against. Reading the
  // clock once means the two cannot disagree, and passing the instant to the client
  // rather than letting it call Date.now() is what keeps the rendered string
  // identical on both sides of hydration.
  const now = new Date();
  const today = groupToday(now, group.timezone);

  // Every upcoming turn, ordered once. Each one arrives already carrying the NAME of the job it
  // belongs to, so nothing here has to resolve it against the rotas list: a rota that changed
  // state between two answers used to take its turns off this screen without saying so.
  //
  // The endpoint is already bounded to today and later and already sorted, and the sort is
  // repeated here so the order is the client's own comparison in both windows; the two windows
  // below are cut from this one list, so the glance and the Next week section can never disagree
  // about which day a shift belongs to.
  const upcomingShifts: WeekShift[] = shifts
    .map((shift) => ({ ...shift, rotaName: shift.rota_name }))
    .sort((a, b) => compareCivil(a.due_on, b.due_on) || a.rotaName.localeCompare(b.rotaName));

  const weekShifts = upcomingShifts.filter((shift) => isThisWeek(shift.due_on, today));
  const nextWeekShifts = upcomingShifts.filter((shift) => isNextWeek(shift.due_on, today));

  // Only the names cross to the client. A Member also carries its magic-link
  // access_token, which has no business in a page payload — which is why the glance is
  // handed plain MemberRefs and, below, resolved FeedEvents rather than members at all.
  const memberNames: Record<number, string> = {};
  for (const member of members) memberNames[member.id] = member.name;
  const memberRefs: MemberRef[] = members.map(({ id, name }) => ({ id, name }));

  // The house calendar's rows, keyed by day, exactly as the member feed builds them:
  // a trip already under way lands on today, one that has ended is gone. Empty when no
  // calendar is connected, so the glance below never has to ask whether there is one.
  const eventDays = eventsByDay(calendarEvents, today, memberRefs);
  const thisWeekDays = buildDayRows(weekShifts, daysWithin(eventDays, today, isThisWeek));
  const nextWeekDays = buildDayRows(nextWeekShifts, daysWithin(eventDays, today, isNextWeek));

  const warnings = collectDashboardWarnings({
    group,
    rotas,
    members,
    failedSms,
    settingsHref: SETTINGS_HREF,
  });

  return (
    <>
      <DashboardHero
        groupName={group.name}
        todayCount={weekShifts.filter((shift) => shift.due_on === today).length}
        weekCount={weekShifts.length}
        coveredCount={weekShifts.filter((shift) => shift.covered).length}
        memberCount={members.filter((member) => member.active).length}
      />

      <HouseholdEntryLink slug={group.slug} />

      <DashboardWarnings warnings={warnings} />

      {/* The week is the main column; group settings sit in a right rail on
          desktop so even a quiet week reads as a composed page rather than
          two lonely cards stacked on lavender. */}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:gap-8">
        {rotas.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="No rotas yet"
            description="A rota is a job that comes round: Bins, Kitchen deep clean, Bathroom. Create your first and Rota Monster texts whoever's up."
            action={
              <Button asChild>
                <Link href="/rotas">Create your first rota</Link>
              </Button>
            }
          />
        ) : (
          <div className="space-y-8">
            {/* A week with nothing at all in it is empty; a week whose only row is a
                trip is not, and saying "no one's up" over the top of it would be a
                lie the hand-off sheet then acts on. */}
            {thisWeekDays.length === 0 ? (
              <EmptyState
                icon={CalendarCheck}
                title="No one's up this week"
                description="Nothing falls in the next seven days. Every upcoming turn is on the Shifts screen."
                action={
                  <Button asChild variant="outline">
                    <Link href="/shifts">See upcoming shifts</Link>
                  </Button>
                }
              />
            ) : (
              <WeekGlance days={thisWeekDays} today={today} />
            )}

            {/* Folded away by default: the dashboard's job is the seven days in front
                of you, and the header answers "is next week busy?" without opening. */}
            <div className="border-border border-t pt-6">
              <NextWeek label={nextWeekRangeLabel(today)} turnCount={nextWeekShifts.length}>
                {nextWeekDays.length === 0 ? (
                  <p className="text-muted-foreground text-sm">No turns next week</p>
                ) : (
                  <WeekGlance days={nextWeekDays} today={today} />
                )}
              </NextWeek>
            </div>
          </div>
        )}

        <GroupSettings
          group={group}
          calendarEvents={calendarEvents}
          memberNames={memberNames}
          now={now.toISOString()}
        />
      </div>
    </>
  );
}

/**
 * The event days that fall inside one of the dashboard's two rolling windows.
 *
 * The calendar preview is fetched once, for thirty days, because it also feeds the
 * settings card's "What we found". Each window then takes its own slice, rather than
 * each asking the API for its own range.
 */
function daysWithin(
  eventDays: Map<string, FeedEvent[]>,
  today: string,
  within: (dueOn: string, today: string) => boolean,
): Map<string, FeedEvent[]> {
  return new Map([...eventDays].filter(([due_on]) => within(due_on, today)));
}

/**
 * The soft-failure rule, in one place: an ApiError means "this part of the page is unavailable",
 * anything else is control flow or an outage and belongs to whoever threw it. A failed text log or
 * a calendar preview that will not load is a missing warning, not a blank dashboard; a 401 is a
 * redirect that must reach Next untouched.
 */
function emptyOnApiError<T>(fallback: T): (error: unknown) => T {
  return (error: unknown) => {
    if (!isApiError(error)) throw error;
    return fallback;
  };
}
