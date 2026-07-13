import { nameList } from "./format";
import type { Group, Member, Rota, SmsMessage } from "./api/types";

/**
 * The dashboard's warning surface, as data. Rendering turns each entry into an
 * `Alert`; the judgement — which conditions deserve a warning, how loud, and in
 * what order — lives here where it can be tested without a DOM.
 *
 * The order is the priority: an unconfirmed timezone is the quietest and most
 * expensive failure (every text an hour wrong, forever, with no error), so it
 * leads. A failed text is the loudest (someone was owed a reminder and didn't get
 * it), so it `shouts` in the destructive tone. Drafts and unreachable people are
 * important but visible-by-nature, so they follow in the warning tone.
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

export interface DashboardWarningInput {
  group: Group;
  rotas: Rota[];
  members: Member[];
  /** SMS log rows already filtered to status=failed. */
  failedSms: SmsMessage[];
  /** Route of the group-settings screen (name + timezone). Owned by the rotas area. */
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
        `Until someone does, every text may be sent an hour off — silently.`,
      href: settingsHref,
      action: "Set the timezone",
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
        `A silently failed text is worse than no rota — check the carrier error.`,
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
