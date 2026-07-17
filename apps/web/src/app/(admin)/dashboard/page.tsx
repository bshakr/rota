import type { Metadata } from "next";
import Link from "next/link";
import { CalendarCheck, Repeat } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { getGroup, listMembers, listRotas, listShifts, listSmsMessages } from "@/lib/api/admin";
import { isApiError } from "@/lib/api/errors";
import type { Rota, Shift, SmsMessage } from "@/lib/api/types";
import { collectDashboardWarnings } from "@/lib/dashboard";
import { compareCivil, groupToday, isThisWeek } from "@/lib/group-dates";

import { DashboardHero } from "./_components/dashboard-hero";
import { DashboardWarnings } from "./_components/dashboard-warnings";
import { GroupSettings } from "./_components/group-settings";
import { WeekGlance, type WeekShift } from "./_components/week-glance";

export const metadata: Metadata = { title: "Dashboard" };

// Live, per-request, behind auth — never statically prerendered.
export const dynamic = "force-dynamic";

// The unconfirmed-timezone warning links to the group-settings section on this
// same screen (below), so the complaint and the fix are never a navigation apart.
const SETTINGS_HREF = "#group-settings";

type RotaWithShifts = { rota: Rota; shifts: Shift[] };

export default async function DashboardPage() {
  const [{ group }, { rotas }, { members }] = await Promise.all([
    getGroup(),
    listRotas(),
    listMembers(),
  ]);

  const today = groupToday(new Date(), group.timezone);

  // Only running rotas have shifts; a draft has no roster to generate them from.
  const runningRotas = rotas.filter((rota) => rota.active && !rota.draft);

  // One rota's shifts failing to load shouldn't blank the whole dashboard, so each
  // fetch swallows its own ApiError and drops out. It rethrows anything else —
  // notably the sign-in redirect the client throws on a 401 — which is exactly why
  // this isn't Promise.allSettled: that would capture the redirect and strand the
  // admin on a half-rendered page.
  const settled = await Promise.all(
    runningRotas.map(async (rota): Promise<RotaWithShifts | null> => {
      try {
        const { shifts } = await listShifts(rota.id);
        return { rota, shifts };
      } catch (error) {
        if (!isApiError(error)) throw error;
        return null;
      }
    }),
  );
  const shiftsByRota = settled.filter((entry): entry is RotaWithShifts => entry !== null);

  const weekShifts: WeekShift[] = shiftsByRota
    .flatMap(({ rota, shifts }) =>
      shifts
        .filter((shift) => isThisWeek(shift.due_on, today))
        .map((shift) => ({ ...shift, rotaName: rota.name })),
    )
    .sort((a, b) => compareCivil(a.due_on, b.due_on) || a.rotaName.localeCompare(b.rotaName));

  // A failed text is one of four warnings, not the spine of the page. If the log
  // endpoint hiccups, drop that one warning rather than blank the dashboard —
  // but never swallow the sign-in redirect the client throws on a 401.
  let failedSms: SmsMessage[] = [];
  try {
    ({ sms_messages: failedSms } = await listSmsMessages({ status: "failed", limit: 100 }));
  } catch (error) {
    if (!isApiError(error)) throw error;
  }

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

      <DashboardWarnings warnings={warnings} />

      {/* The week is the main column; group settings sit in a right rail on
          desktop so even a quiet week reads as a composed page rather than
          two lonely cards stacked on cream. */}
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,24rem)] lg:gap-8">
        {rotas.length === 0 ? (
          <EmptyState
            icon={Repeat}
            title="No rotas yet"
            description="A rota is a job that comes round — bins, cleaning, cooking. Create your first and HouseRota texts whoever's up."
            action={
              <Button asChild>
                <Link href="/rotas">Create your first rota</Link>
              </Button>
            }
          />
        ) : weekShifts.length === 0 ? (
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
          <WeekGlance shifts={weekShifts} today={today} />
        )}

        <GroupSettings group={group} />
      </div>
    </>
  );
}
