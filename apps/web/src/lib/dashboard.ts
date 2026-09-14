import { nameList } from "./format";
import type { Group, Member, Rota, SmsMessage } from "./api/types";

/**
 * The dashboard's warning surface, as data. Rendering turns each entry into an
 * `Alert`; the judgement — which conditions deserve a warning, how loud, and in
 * what order — lives here where it can be tested without a DOM.
 *
 * The order is the priority: an unconfirmed timezone is the quietest and most
 * expensive failure (every text an hour wrong, forever, with no error), so it
 * leads. A calendar that stopped syncing follows for the same reason: nothing
 * on screen says the members' page has gone stale. A failed text is the loudest
 * (someone was owed a reminder and didn't get it), so it `shouts` in the
 * destructive tone. Drafts and unreachable people are important but
 * visible-by-nature, so they follow in the warning tone.
 */

export type WarningSeverity = "warning" | "destructive";

export interface DashboardWarning {
  /** Stable key for React and for tests. */
  id: string;
  severity: WarningSeverity;
  title: string;
  description: string;
  /** Where "fix it" goes. */
  href: string;
  /** The link's label. */
  action: string;
}

/**
 * The two shapes below are NARROWED to what this collector actually reads, and
 * that is deliberate rather than fussy.
 *
 * The operator's console runs this exact function over the same house's facts, so
 * that the alerts on a group page are the alerts its own admins are looking at
 * (https://linear.app/bloombase/issue/BLO-1680). Rails composes those facts with
 * the house's own serializers and then makes two credential-shaped changes, both
 * of them mandated by the plan: `access_token` is dropped from every member (it
 * is a permanent login to somebody else's house), and a text's `body` comes back
 * null once the magic link has been struck out of an unsent row. Neither field is
 * read here. Demanding them anyway would mean either shipping a magic link to an
 * operator in order to type-check — the opposite of the rule — or writing a
 * second, parallel collector, which is exactly how the two screens would start
 * disagreeing about what is wrong with a house.
 *
 * The house's own dashboard passes whole `Member`s and `SmsMessage`s and is
 * unaffected: they satisfy these.
 */
export type WarningMember = Pick<Member, "name" | "active" | "contactable">;
export type WarningFailedSms = Pick<SmsMessage, "member">;

export interface DashboardWarningInput {
  group: Group;
  rotas: Rota[];
  members: WarningMember[];
  /** SMS log rows already filtered to status=failed. */
  failedSms: WarningFailedSms[];
  /**
   * Route of the group-settings screen (name, timezone, house calendar). Owned by
   * the rotas area. A fragment on it is replaced when a warning aims at one section.
   */
  settingsHref: string;
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function collectDashboardWarnings({
  group,
  rotas,
  members,
  failedSms,
  settingsHref,
}: DashboardWarningInput): DashboardWarning[] {
  const warnings: DashboardWarning[] = [];

  if (!group.timezone_confirmed) {
    warnings.push({
      id: "timezone",
      severity: "warning",
      title: "Confirm the group's timezone",
      description:
        `Reminders go out on ${group.timezone} time, but no one has confirmed that's right. ` +
        `Until someone does, every text may go out an hour off, silently.`,
      href: settingsHref,
      action: "Set the timezone",
    });
  }

  // A calendar that stopped syncing fails quietly: the members' page just goes
  // stale, with nothing on screen to say why. Quieter than a lost reminder,
  // louder than a draft rota.
  if (group.calendar?.failing) {
    warnings.push({
      id: "calendar-sync",
      severity: "warning",
      title: "House calendar isn't syncing",
      description:
        `${group.calendar.last_error ?? "The last few checks failed."} ` +
        `Events and away dates on the members' page may be out of date.`,
      // `settingsHref` may itself be an in-page anchor, so swap its fragment for
      // the calendar section rather than appending a second one.
      href: `${settingsHref.split("#")[0]}#house-calendar`,
      action: "Check the calendar link",
    });
  }

  // Count PEOPLE who missed a text, not rows — several failed reminders to one
  // person is still one person to chase.
  const failedNames = uniqueNames(failedSms.map((sms) => sms.member));
  if (failedNames.length > 0) {
    const n = failedNames.length;
    warnings.push({
      id: "failed-sms",
      severity: "destructive",
      title: `${n} ${plural(n, "person", "people")} didn't get a text`,
      description:
        `${nameList(failedNames)} had a reminder fail to send. ` +
        `A text that fails quietly is worse than no rota, so check the carrier error.`,
      href: "/sms",
      action: "Open the SMS log",
    });
  }

  const draftNames = rotas.filter((r) => r.draft).map((r) => r.name);
  if (draftNames.length > 0) {
    const n = draftNames.length;
    warnings.push({
      id: "draft-rotas",
      severity: "warning",
      title: `${n} ${plural(n, "rota", "rotas")} in draft`,
      description:
        `${nameList(draftNames)} ${plural(n, "has", "have")} no one on the roster, so ` +
        `${plural(n, "it sends", "they send")} nothing. Add members to start the rotation.`,
      href: "/rotas",
      action: "Open rotas",
    });
  }

  const unreachableNames = members
    .filter((m) => m.active && !m.contactable)
    .map((m) => m.name);
  if (unreachableNames.length > 0) {
    const n = unreachableNames.length;
    warnings.push({
      id: "uncontactable",
      severity: "warning",
      title: `${n} active ${plural(n, "person", "people")} won't get texts`,
      description:
        `${nameList(unreachableNames)} opted out of reminders, so they'll ` +
        `be skipped every time until that changes.`,
      href: "/members",
      action: "Review members",
    });
  }

  return warnings;
}

function uniqueNames(refs: { id: number; name: string }[]): string[] {
  const seen = new Set<number>();
  const names: string[] = [];
  for (const ref of refs) {
    if (seen.has(ref.id)) continue;
    seen.add(ref.id);
    names.push(ref.name);
  }
  return names;
}
